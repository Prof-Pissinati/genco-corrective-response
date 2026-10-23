"""N-1 LINE screening with GENCO: builds the data in gridfm-datakit format from OUR states (base case and each line out),
runs GENCO (gridfm-graphkit) and compares with the backend AC (and with the DC) to measure overload detection, error and speed.

Roda no ambiente do GENCO (gridfm-graphkit + torch). Passos (veja docs/GENCO_VARREDURA.md):
    python backend/tools/genco_screening.py build   --out data/genco_n1
    <run GENCO over data/genco_n1; the `run` script does this>
    python backend/tools/genco_screening.py analyze --out data/genco_n1 --pred <predictions.parquet> --timing <ms_por_cenario>

State of each scenario = what GENCO saw in training: AC-OPF base dispatch, one line out and the REFERENCE absorbing the imbalance
(no redispatch). Lines whose outage islands buses are left out (the datakit avoids islands; the AC handles those cases).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.acpf import solve_ac, solve_dc          # noqa: E402
from app.network import load_case, topology_masks  # noqa: E402

MODEL_LABEL = "GENCO Tiny N-10 (models/case118_genco_tiny_n10: 39,761 samples, up to N-10, 42 epochs)"      # text shown in the interface; change it when validating another model (--model-label)
DATA = ROOT / "interface" / "src" / "data"
CASE = "case118_ieee"                                  # network in use; change with set_case() or --case (e.g. case14_ieee, case30_ieee, case57_ieee)
CASE_JSON = DATA / f"{CASE}.json"
CASE_M = DATA / f"pglib_opf_{CASE}.m"


def set_case(name: str):
    """Chooses the network: files `<name>.json` and `pglib_opf_<name>.m` in interface/src/data/."""
    global CASE, CASE_JSON, CASE_M
    CASE, CASE_JSON, CASE_M = name, DATA / f"{name}.json", DATA / f"pglib_opf_{name}.m"


def model_tag(modelo) -> str:
    """File suffix from the model folder: `autores` or `n10` when the name indicates it; otherwise the name itself."""
    n = Path(str(modelo)).name
    return "autores" if "autores" in n else ("n10" if "n10" in n else n)


def gencost_from_m(path: Path):
    """Quadratic costs (c2, c1, c0) per generator, in the order of the gen table of the PGLib .m."""
    txt = re.sub(r"%.*", "", path.read_text(encoding="utf-8"))
    body = re.search(r"mpc\.gencost\s*=\s*\[(.*?)\]\s*;", txt, re.S).group(1)
    rows = [[float(v) for v in r.split()] for r in body.split(";") if r.strip()]
    out = []
    for r in rows:
        n = int(r[3])
        c = r[4:4 + n]
        c = [0.0] * (3 - len(c)) + c                        # (c2, c1, c0)
        out.append(c)
    return np.array(out)


def ybus_entries(net, br_mask):
    """Non-zero Ybus entries (pu) of the topology: list of (i, j, G, B)."""
    n = net.nb
    Y = np.zeros((n, n), dtype=complex)
    for k in np.flatnonzero(br_mask):
        ys = 1.0 / (net.br_r[k] + 1j * net.br_x[k])
        tap = net.br_tap[k] * np.exp(1j * np.deg2rad(net.br_shift[k]))
        ytt = ys + 1j * net.br_b[k] / 2
        f, t = net.br_f[k], net.br_t[k]
        Y[f, f] += ytt / (tap * np.conj(tap)); Y[f, t] += -ys / np.conj(tap); Y[t, f] += -ys / tap; Y[t, t] += ytt
    for i in range(n):
        Y[i, i] += (net.gs[i] + 1j * net.bs[i]) / net.base_mva
    return Y


def branch_y(net, k):
    ys = 1.0 / (net.br_r[k] + 1j * net.br_x[k])
    tap = net.br_tap[k] * np.exp(1j * np.deg2rad(net.br_shift[k]))
    ytt = ys + 1j * net.br_b[k] / 2
    return ytt / (tap * np.conj(tap)), -ys / np.conj(tap), -ys / tap, ytt            # Yff, Yft, Ytf, Ytt


def scenario_rows(net, cost, brm, ac, dc, sid):
    """Rows (bus, gen, branch) of ONE scenario in the datakit format. `net` carries the dispatch (gen_pg) and the loads (pd, qd) of the state;
    `ac`/`dc` are the solutions of that state and `brm` the mask of connected branches."""
    ref = net.ref
    bus_rows, gen_rows, br_rows = [], [], []
    pg_bus = np.bincount(net.gen_bus, weights=np.where(net.gen_on, ac["pg"], 0), minlength=net.nb)
    qg_bus = np.bincount(net.gen_bus, weights=np.where(net.gen_on, ac["qg"], 0), minlength=net.nb)
    pg_bus_dc = np.bincount(net.gen_bus, weights=np.where(net.gen_on, dc["pg"], 0), minlength=net.nb)
    # DC: the reference absorbs the imbalance
    pg_bus_dc[ref] += net.pd.sum() - pg_bus_dc.sum()
    for i in range(net.nb):
        bus_rows.append({"scenario": sid, "load_scenario_idx": 0, "bus": i, "Pd": net.pd[i], "Qd": net.qd[i], "Pg": pg_bus[i], "Qg": qg_bus[i],
                         "Vm": ac["vm"][i], "Va": ac["va"][i], "PQ": int(net.bus_type[i] == 1), "PV": int(net.bus_type[i] == 2), "REF": int(i == ref),
                         "vn_kv": net.base_kv[i], "min_vm_pu": net.vmin[i], "max_vm_pu": net.vmax[i], "GS": net.gs[i] / net.base_mva, "BS": net.bs[i] / net.base_mva,
                         "Va_dc": dc["va"][i], "Pg_dc": pg_bus_dc[i]})
    for g in range(len(net.gen_bus)):
        on_ref = net.gen_bus[g] == ref
        gen_rows.append({"scenario": sid, "load_scenario_idx": 0, "idx": g, "bus": int(net.gen_bus[g]), "p_mw": ac["pg"][g], "q_mvar": ac["qg"][g],
                         "min_p_mw": net.gen_pmin[g], "max_p_mw": net.gen_pmax[g], "min_q_mvar": net.gen_qmin[g], "max_q_mvar": net.gen_qmax[g],
                         "cp0_eur": cost[g][2], "cp1_eur_per_mw": cost[g][1], "cp2_eur_per_mw2": cost[g][0], "in_service": int(net.gen_on[g]),
                         "is_slack_gen": int(on_ref), "p_mw_dc": dc["pg"][g]})
    for k in range(net.nl):
        on = bool(brm[k])
        yff, yft, ytf, ytt = branch_y(net, k) if on else (0j, 0j, 0j, 0j)
        br_rows.append({"scenario": sid, "load_scenario_idx": 0, "idx": k, "from_bus": int(net.br_f[k]), "to_bus": int(net.br_t[k]),
                        "pf": ac["pf"][k], "qf": ac["qf"][k], "pt": ac["pt"][k], "qt": ac["qt"][k], "r": net.br_r[k], "x": net.br_x[k], "b": net.br_b[k],
                        "Yff_r": yff.real, "Yff_i": yff.imag, "Yft_r": yft.real, "Yft_i": yft.imag, "Ytf_r": ytf.real, "Ytf_i": ytf.imag,
                        "Ytt_r": ytt.real, "Ytt_i": ytt.imag, "tap": net.br_tap[k], "shift": net.br_shift[k], "ang_min": -30.0, "ang_max": 30.0,
                        "rate_a": net.br_rate[k], "br_status": int(on), "pf_dc": dc["pf"][k], "pt_dc": dc["pt"][k]})
    return bus_rows, gen_rows, br_rows


def build(out: Path):
    net = load_case(CASE_JSON)
    cost = gencost_from_m(CASE_M)
    ref = net.ref
    scen = [("base", [])] + [(f"line {k}", [k]) for k in range(net.nl)]
    bus_rows, gen_rows, br_rows, meta, skipped = [], [], [], [], []
    sid = 0
    for nome, outs in scen:
        bm, brm = topology_masks(net, outs, [])
        if not bm.all():
            skipped.append({"name": nome, "branchOut": outs, "reason": "islanding"})
            continue
        ac = solve_ac(net, bm, brm)
        if not ac["converged"]:
            skipped.append({"name": nome, "branchOut": outs, "reason": "AC did not converge"})
            continue
        dc = solve_dc(net, bm, brm)
        rb, rg, rl = scenario_rows(net, cost, brm, ac, dc, sid)
        bus_rows += rb; gen_rows += rg; br_rows += rl
        meta.append({"scenario": sid, "name": nome, "branchOut": outs, "ac_ms": None})
        sid += 1

    raw = out / CASE / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for name, rows in (("bus_data", bus_rows), ("gen_data", gen_rows), ("branch_data", br_rows)):
        df = pd.DataFrame(rows)
        df["scenario_partition"] = (df["scenario"] // 1000).astype("int64")
        for c in ("bus", "from_bus", "to_bus", "idx"):
            if c in df:
                df[c] = df[c].astype("int64")
        df.to_parquet(raw / f"{name}.parquet", partition_cols=["scenario_partition"], index=False)
    (raw / "n_scenarios.txt").write_text(str(sid), encoding="utf-8")

    import torch
    sp = out / "splits"
    sp.mkdir(exist_ok=True)
    torch.save(torch.tensor([0], dtype=torch.long), sp / "train.pt")          # the model is already trained; the splits only choose what to predict
    torch.save(torch.tensor([0], dtype=torch.long), sp / "val.pt")
    torch.save(torch.tensor(list(range(sid)), dtype=torch.long), sp / "test.pt")
    (out / "scenarios.json").write_text(json.dumps({"scenarios": meta, "skipped": skipped, "baseMVA": net.base_mva}, indent=1), encoding="utf-8")
    print(f"{sid} scenarios written to {raw} | skipped: {len(skipped)} {[s['name'] for s in skipped]}")


def predict(out: Path, modelo: Path, pred_path: Path, device: str = "cpu"):
    """Runs a checkpoint (folder with config.yaml, best_model_state_dict.pt and normalizer_stats.pt) over the `build` scenarios and writes the predictions
    of Vm/Va in the format that `analyze` reads. In-memory inference (tools/genco_inferencia_exemplo.py); prints the ms per scenario."""
    import time
    sys.path.insert(0, str(ROOT / "tools"))
    from genco_inferencia_exemplo import GencoEmMemoria, ler_cenario
    raw = out / CASE / "raw"
    n = int((raw / "n_scenarios.txt").read_text(encoding="utf-8"))
    topologias = [ler_cenario(raw, k) for k in range(n)]
    g = GencoEmMemoria(modelo, device)
    g.prever(topologias[:2], lote=2)                                         # aquecimento
    tempos = []
    for _ in range(3):                                                        # median of 3 runs (CPU time varies from one run to another)
        t0 = time.perf_counter()
        vm, va = g.prever(topologias, lote=160)
        tempos.append((time.perf_counter() - t0) * 1000 / n)
    ms = float(np.median(tempos))
    pred_path.with_suffix(".ms.txt").write_text(f"{ms:.3f}", encoding="utf-8")   # `analyze` reads this value when --genco-ms is not given
    nb = vm.shape[1]
    df = pd.DataFrame({"scenario": np.repeat(np.arange(n), nb), "bus": np.tile(np.arange(nb), n), "Vm_pred": vm.reshape(-1), "Va_pred": va.reshape(-1)})
    df.to_parquet(pred_path, index=False)
    print(f"{n} scenarios predicted with {modelo.name}: {ms:.1f} ms per scenario (CPU); predictions in {pred_path}")
    return ms


def genco_loading(pred, br):
    """Loading (larger end / rateA) per branch, in a scenario, from predicted Vm/Va and the branch_data admittances."""
    v = pred.Vm_pred.to_numpy() * np.exp(1j * pred.Va_pred.to_numpy())
    f, t = br.from_bus.to_numpy(), br.to_bus.to_numpy()
    yff, yft = br.Yff_r.to_numpy() + 1j * br.Yff_i.to_numpy(), br.Yft_r.to_numpy() + 1j * br.Yft_i.to_numpy()
    ytf, ytt = br.Ytf_r.to_numpy() + 1j * br.Ytf_i.to_numpy(), br.Ytt_r.to_numpy() + 1j * br.Ytt_i.to_numpy()
    sf = np.abs(v[f] * np.conj(yff * v[f] + yft * v[t]))
    st = np.abs(v[t] * np.conj(ytf * v[f] + ytt * v[t]))
    rate = br.rate_a.to_numpy() / 100.0
    on = br.br_status.to_numpy() == 1
    return np.where(on & (rate > 0), np.maximum(sf, st) / np.where(rate > 0, rate, 1.0), 0.0)


def analyze(out: Path, pred_path: Path, genco_ms: float, dst: Path | None = None, model_label: str = MODEL_LABEL, tag: str = "modelo"):
    import time
    if not genco_ms and pred_path.with_suffix(".ms.txt").exists():
        genco_ms = float(pred_path.with_suffix(".ms.txt").read_text(encoding="utf-8"))
    meta = json.loads((out / "scenarios.json").read_text(encoding="utf-8"))
    raw = out / CASE / "raw"
    br = pd.read_parquet(raw / "branch_data.parquet")
    pred = pd.read_parquet(pred_path)
    net = load_case(CASE_JSON)
    rate = net.br_rate
    rows, ac_all, dc_all, ge_all = [], [], [], []
    for m in meta["scenarios"]:
        sid = m["scenario"]
        b = br[br.scenario == sid].sort_values("idx")
        on = b.br_status.to_numpy() == 1
        ac = np.where(on & (rate > 0), np.maximum(np.hypot(b.pf, b.qf), np.hypot(b.pt, b.qt)).to_numpy() / np.where(rate > 0, rate, 1), 0.0)
        dc = np.where(on & (rate > 0), np.abs(b.pf_dc.to_numpy()) / np.where(rate > 0, rate, 1), 0.0)
        ge = genco_loading(pred[pred.scenario == sid].sort_values("bus"), b)
        ac_all.append(ac[on]); dc_all.append(dc[on]); ge_all.append(ge[on])
        rows.append({"id": m["branchOut"][0] if m["branchOut"] else None, "name": m["name"], "ac": ac, "dc": dc, "genco": ge, "on": on})
    A, D, G = np.concatenate(ac_all), np.concatenate(dc_all), np.concatenate(ge_all)
    mae = lambda x: float(np.mean(np.abs(x - A)) * 100)

    def confusion(truth, est, th, margin=0.0):
        t_ = truth >= th - 1e-9
        e_ = est >= th - margin
        tp, fp, fn, tn = int((t_ & e_).sum()), int((~t_ & e_).sum()), int((t_ & ~e_).sum()), int((~t_ & ~e_).sum())
        return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "recall": tp / max(tp + fn, 1), "precision": tp / max(tp + fp, 1), "flagged": int(e_.sum())}

    # scenario level: it needs action if any line exceeds 100% (AC); screening = any line estimated >= 100% - margin
    cen = [(r["ac"].max(), r["dc"].max(), r["genco"].max()) for r in rows[1:]]     # without the base case
    cA, cD, cG = (np.array([c[i] for c in cen]) for i in range(3))
    sc_metrics = {}
    for name, est in (("genco", cG), ("dc", cD)):
        sc_metrics[name] = {str(int(mg * 100)): confusion(cA, est, 1.0 + 1e-4, mg) for mg in (0.0, 0.05, 0.10)}
    line_metrics = {"genco": {str(th): confusion(A, G, th) for th in (0.9, 1.0)}, "dc": {str(th): confusion(A, D, th) for th in (0.9, 1.0)}}

    # backend AC and DC time on the same scenarios
    t0 = time.perf_counter()
    for m in meta["scenarios"]:
        bm, brm = topology_masks(net, m["branchOut"], [])
        solve_ac(net, bm, brm)
    ac_ms = (time.perf_counter() - t0) * 1000 / len(meta["scenarios"])
    t0 = time.perf_counter()
    for m in meta["scenarios"]:
        bm, brm = topology_masks(net, m["branchOut"], [])
        solve_dc(net, bm, brm)
    dc_ms = (time.perf_counter() - t0) * 1000 / len(meta["scenarios"])

    lines = []
    for r in rows[1:]:
        k = r["id"]
        on = r["on"]
        pick = lambda x: round(float(x.max() * 100), 2)
        cnt = lambda x: int((x[on] > 1.0 + 1e-4).sum())
        lines.append({"id": k, "from": int(net.bus_no[net.br_f[k]]), "to": int(net.bus_no[net.br_t[k]]),
                      "ac": {"maxPct": pick(r["ac"]), "overloads": cnt(r["ac"])}, "dc": {"maxPct": pick(r["dc"]), "overloads": cnt(r["dc"])},
                      "genco": {"maxPct": pick(r["genco"]), "overloads": cnt(r["genco"])}})
    result = {
        "case": CASE, "model": model_label,
        "state": "post-fault of ONE line, AC-OPF base dispatch, reference absorbs the imbalance (no redispatch), as in the training data",
        "scenarios": len(rows) - 1, "skipped": meta["skipped"],
        "base": {"acMaxPct": round(float(rows[0]["ac"].max() * 100), 2), "gencoMaxPct": round(float(rows[0]["genco"].max() * 100), 2)},
        "loadingMAE_pct": {"genco": round(mae(G), 3), "dc": round(mae(D), 3)},
        "loadingMAX_pct": {"genco": round(float(np.max(np.abs(G - A)) * 100), 2), "dc": round(float(np.max(np.abs(D - A)) * 100), 2)},
        "lineLevel": line_metrics, "scenarioLevel": sc_metrics,
        "msPerScenario": {"genco_cpu_este_pc": round(genco_ms, 2), "ac_backend": round(ac_ms, 2), "dc_backend": round(dc_ms, 2)},
        "lines": lines,
    }
    dst = dst or DATA / f"screening_{CASE}_{tag}.json"
    dst.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"gravado {dst} ({dst.stat().st_size // 1024} KB)")
    print(f"mean loading error (% points): GENCO {mae(G):.2f} | DC {mae(D):.2f}  | max: GENCO {np.max(np.abs(G - A)) * 100:.1f} DC {np.max(np.abs(D - A)) * 100:.1f}")
    for name in ("genco", "dc"):
        for th, c in line_metrics[name].items():
            print(f"per line, threshold {float(th)*100:.0f}% [{name}]: recall {c['recall']:.3f} precision {c['precision']:.3f} (TP {c['tp']} FP {c['fp']} FN {c['fn']})")
    for name in ("genco", "dc"):
        for mg, c in sc_metrics[name].items():
            print(f"scenario >=100% [{name}, margin {mg}pt]: recall {c['recall']:.3f} precision {c['precision']:.3f} | sent to the AC {c['flagged']}/{len(cA)} (true {c['tp'] + c['fn']})")
    print(f"time per scenario: GENCO(CPU) {genco_ms:.1f} ms | AC {ac_ms:.1f} ms | DC {dc_ms:.1f} ms")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["build", "predict", "analyze"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--pred")
    ap.add_argument("--genco-ms", type=float, default=0.0)
    ap.add_argument("--modelo", help="predict: pasta do checkpoint (config.yaml, best_model_state_dict.pt, normalizer_stats.pt)")
    ap.add_argument("--model-label", default=MODEL_LABEL, help="model description, shown in the interface")
    ap.add_argument("--dst", help="analyze output file (default: interface/src/data/screening_<network>_<tag>.json)")
    ap.add_argument("--tag", default="modelo", help="suffix of the analyze output file (e.g. autores, n10)")
    ap.add_argument("--case", default="case118_ieee", help="network: case14_ieee, case30_ieee, case57_ieee or case118_ieee")
    a = ap.parse_args()
    set_case(a.case)
    if a.stage == "build":
        build(Path(a.out))
    elif a.stage == "predict":
        predict(Path(a.out), Path(a.modelo), Path(a.pred))
    else:
        analyze(Path(a.out), Path(a.pred), a.genco_ms, Path(a.dst) if a.dst else None, a.model_label, a.tag)
