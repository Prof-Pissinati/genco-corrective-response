"""Varredura N-1 de LINHAS com o GENCO: monta os dados no formato do gridfm-datakit a partir dos NOSSOS estados (caso base e cada linha fora),
roda o GENCO (gridfm-graphkit) e compara com o AC do backend (e com o DC) para medir detecção de sobrecarga, erro e velocidade.

Roda no ambiente do GENCO (gridfm-graphkit + torch). Passos (veja docs/GENCO_VARREDURA.md):
    python backend/tools/genco_screening.py build   --out data/genco_n1
    <rodar o GENCO sobre data/genco_n1; o script `run` faz isso>
    python backend/tools/genco_screening.py analyze --out data/genco_n1 --pred <predictions.parquet> --timing <ms_por_cenario>

Estado de cada cenário = o que o GENCO viu no treino: despacho base do AC-OPF, uma linha fora e a REFERÊNCIA absorvendo o desbalanço
(sem redespacho). Linhas cuja saída isola barras ficam de fora (o datakit evita ilhas; o AC trata esses casos).
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

CASE_JSON = ROOT / "interface" / "src" / "data" / "case118_ieee.json"
CASE_M = ROOT / "interface" / "src" / "data" / "pglib_opf_case118_ieee.m"


def gencost_from_m(path: Path):
    """Custos quadráticos (c2, c1, c0) por gerador, na ordem da tabela gen do .m do PGLib."""
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
    """Entradas não nulas da Ybus (pu) da topologia: lista de (i, j, G, B)."""
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


def build(out: Path):
    net = load_case(CASE_JSON)
    cost = gencost_from_m(CASE_M)
    ref = net.ref
    scen = [("base", [])] + [(f"linha {k}", [k]) for k in range(net.nl)]
    bus_rows, gen_rows, br_rows, meta, skipped = [], [], [], [], []
    sid = 0
    for nome, outs in scen:
        bm, brm = topology_masks(net, outs, [])
        if not bm.all():
            skipped.append({"name": nome, "branchOut": outs, "reason": "ilhamento"})
            continue
        ac = solve_ac(net, bm, brm)
        if not ac["converged"]:
            skipped.append({"name": nome, "branchOut": outs, "reason": "AC não convergiu"})
            continue
        dc = solve_dc(net, bm, brm)
        pg_bus = np.bincount(net.gen_bus, weights=np.where(net.gen_on, ac["pg"], 0), minlength=net.nb)
        qg_bus = np.bincount(net.gen_bus, weights=np.where(net.gen_on, ac["qg"], 0), minlength=net.nb)
        pg_bus_dc = np.bincount(net.gen_bus, weights=np.where(net.gen_on, dc["pg"], 0), minlength=net.nb)
        # DC: a referência absorve o desbalanço
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
        meta.append({"scenario": sid, "name": nome, "branchOut": outs, "ac_ms": None})
        sid += 1

    raw = out / "case118_ieee" / "raw"
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
    torch.save(torch.tensor([0], dtype=torch.long), sp / "train.pt")          # o modelo já está treinado; os splits só escolhem o que prever
    torch.save(torch.tensor([0], dtype=torch.long), sp / "val.pt")
    torch.save(torch.tensor(list(range(sid)), dtype=torch.long), sp / "test.pt")
    (out / "scenarios.json").write_text(json.dumps({"scenarios": meta, "skipped": skipped, "baseMVA": net.base_mva}, indent=1), encoding="utf-8")
    print(f"{sid} cenários gravados em {raw} | pulados: {len(skipped)} {[s['name'] for s in skipped]}")


def genco_loading(pred, br):
    """Carregamento (maior ponta / rateA) por ramo, em um cenário, a partir de Vm/Va previstos e das admitâncias do branch_data."""
    v = pred.Vm_pred.to_numpy() * np.exp(1j * pred.Va_pred.to_numpy())
    f, t = br.from_bus.to_numpy(), br.to_bus.to_numpy()
    yff, yft = br.Yff_r.to_numpy() + 1j * br.Yff_i.to_numpy(), br.Yft_r.to_numpy() + 1j * br.Yft_i.to_numpy()
    ytf, ytt = br.Ytf_r.to_numpy() + 1j * br.Ytf_i.to_numpy(), br.Ytt_r.to_numpy() + 1j * br.Ytt_i.to_numpy()
    sf = np.abs(v[f] * np.conj(yff * v[f] + yft * v[t]))
    st = np.abs(v[t] * np.conj(ytf * v[f] + ytt * v[t]))
    rate = br.rate_a.to_numpy() / 100.0
    on = br.br_status.to_numpy() == 1
    return np.where(on & (rate > 0), np.maximum(sf, st) / np.where(rate > 0, rate, 1.0), 0.0)


def analyze(out: Path, pred_path: Path, genco_ms: float):
    import time
    meta = json.loads((out / "scenarios.json").read_text(encoding="utf-8"))
    raw = out / "case118_ieee" / "raw"
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

    # nível do cenário: ele precisa de ação se alguma linha passar de 100% (AC); triagem = alguma linha estimada >= 100% - margem
    cen = [(r["ac"].max(), r["dc"].max(), r["genco"].max()) for r in rows[1:]]     # sem o caso base
    cA, cD, cG = (np.array([c[i] for c in cen]) for i in range(3))
    sc_metrics = {}
    for name, est in (("genco", cG), ("dc", cD)):
        sc_metrics[name] = {str(int(mg * 100)): confusion(cA, est, 1.0 + 1e-4, mg) for mg in (0.0, 0.05, 0.10)}
    line_metrics = {"genco": {str(th): confusion(A, G, th) for th in (0.9, 1.0)}, "dc": {str(th): confusion(A, D, th) for th in (0.9, 1.0)}}

    # tempo do AC e do DC do backend nos mesmos cenários
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
        "case": "case118_ieee", "model": "GENCO Tiny reduzido (models/case118_genco_tiny: 3.200 amostras, até N-2)",
        "state": "pós-falta de UMA linha, despacho base do AC-OPF, referência absorve o desbalanço (sem redespacho), como nos dados de treino",
        "scenarios": len(rows) - 1, "skipped": meta["skipped"],
        "base": {"acMaxPct": round(float(rows[0]["ac"].max() * 100), 2), "gencoMaxPct": round(float(rows[0]["genco"].max() * 100), 2)},
        "loadingMAE_pct": {"genco": round(mae(G), 3), "dc": round(mae(D), 3)},
        "loadingMAX_pct": {"genco": round(float(np.max(np.abs(G - A)) * 100), 2), "dc": round(float(np.max(np.abs(D - A)) * 100), 2)},
        "lineLevel": line_metrics, "scenarioLevel": sc_metrics,
        "msPerScenario": {"genco_cpu_este_pc": round(genco_ms, 2), "ac_backend": round(ac_ms, 2), "dc_backend": round(dc_ms, 2)},
        "lines": lines,
    }
    dst = ROOT / "interface" / "src" / "data" / "screening_case118_ieee.json"
    dst.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"gravado {dst} ({dst.stat().st_size // 1024} KB)")
    print(f"erro médio de carregamento (pontos %): GENCO {mae(G):.2f} | DC {mae(D):.2f}  | máx: GENCO {np.max(np.abs(G - A)) * 100:.1f} DC {np.max(np.abs(D - A)) * 100:.1f}")
    for name in ("genco", "dc"):
        for th, c in line_metrics[name].items():
            print(f"por linha, limiar {float(th)*100:.0f}% [{name}]: recall {c['recall']:.3f} precisão {c['precision']:.3f} (TP {c['tp']} FP {c['fp']} FN {c['fn']})")
    for name in ("genco", "dc"):
        for mg, c in sc_metrics[name].items():
            print(f"cenário >=100% [{name}, margem {mg}pt]: recall {c['recall']:.3f} precisão {c['precision']:.3f} | enviados ao AC {c['flagged']}/{len(cA)} (verdadeiros {c['tp'] + c['fn']})")
    print(f"tempo por cenário: GENCO(CPU) {genco_ms:.1f} ms | AC {ac_ms:.1f} ms | DC {dc_ms:.1f} ms")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["build", "analyze"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--pred")
    ap.add_argument("--genco-ms", type=float, default=0.0)
    a = ap.parse_args()
    if a.stage == "build":
        build(Path(a.out))
    else:
        analyze(Path(a.out), Path(a.pred), a.genco_ms)
