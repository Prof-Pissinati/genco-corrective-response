"""GENCO scale study: GENCO error and TIME against the AC on single-line outages (N-1), on a network of any size.

For a network, draws `--n` line outages (fixed seed) that do not island buses and for which our AC converges, and measures:
  - loading error per line (% points) of GENCO and of the DC against the AC (base dispatch, reference bus absorbing the imbalance, no redispatch);
  - time per scenario of our AC (sparse Newton-Raphson, solve_ac), of the DC and of GENCO on CPU, separating the graph assembly and the model itself.
The state of each scenario is the same as in the screening (genco_screening.scenario_rows). The checkpoint is the one the GENCO authors published for the network.
The case must be the project JSON (backend/tools/export_case.py) and the PGLib `.m` (generator costs).

Runs in the GENCO environment (gridfm-graphkit + torch), from the repository root:
    python backend/tools/genco_escala.py --rede case500_goc --json <case.json> --m interface/src/data/pglib_opf_case500_goc.m \\
        --modelo models/case500_goc_genco_tiny_autores --n 60 --dst docs/escala/case500_goc.json
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
sys.path.insert(0, str(ROOT / "tools"))
from app.acpf import solve_ac, solve_dc                         # noqa: E402
from app.network import load_case, topology_masks               # noqa: E402
from genco_screening import gencost_from_m, scenario_rows       # noqa: E402


def tabelas(net, cost, brm, ac, dc):
    rb, rg, rl = scenario_rows(net, cost, brm, ac, dc, 0)
    bus, gen, br = pd.DataFrame(rb), pd.DataFrame(rg), pd.DataFrame(rl)
    agg = gen.groupby("bus")[["min_q_mvar", "max_q_mvar"]].sum().reset_index()
    return bus.merge(agg, on="bus", how="left").fillna(0), gen, br


def main(a):
    import torch
    from genco_inferencia_exemplo import GencoEmMemoria, carregamento
    t_total = time.perf_counter()
    net = load_case(a.json)
    cost = gencost_from_m(Path(a.m))
    rate = net.br_rate
    rng = np.random.default_rng(a.seed)
    print(f"{a.rede}: {net.nb} buses, {net.nl} lines, {len(net.gen_bus)} generators")

    bm0, brm0 = topology_masks(net, [], [])
    t0 = time.perf_counter()
    ac0 = solve_ac(net, bm0, brm0)
    print(f"AC do caso base: {(time.perf_counter() - t0) * 1000:.0f} ms", flush=True)
    base = {"convergePartidaPlana": bool(ac0["converged"]), "iteracoesPartidaPlana": int(ac0["iterations"])}
    if not ac0["converged"]:                                                 # the flat start diverges on some large networks; the case-point start serves to check the model
        ac0 = solve_ac(net, bm0, brm0, init="case")
        base["residuoDoPontoDoCaso"] = float(ac0["mismatch"])                # ~1e-11: the AC-OPF point satisfies our equations
    base["converged"] = bool(ac0["converged"])
    if a.referencia and ac0["converged"]:                                    # checks our AC against the PowerModels solution on the base case
        ref = json.loads(Path(a.referencia).read_text(encoding="utf-8"))
        vm = np.array([ref["vm"][str(int(b))] for b in net.bus_no])
        va = np.degrees([ref["va"][str(int(b))] for b in net.bus_no])
        base["maxDVm"] = float(np.abs(ac0["vm"] - vm).max())
        base["maxDVaGraus"] = float(np.abs((ac0["va"] - ac0["va"][net.ref]) - (va - va[net.ref])).max())      # angles relative to the reference (the absolute angle of the reference is arbitrary)
    print("caso base:", base)

    linhas = [k for k in range(net.nl) if net.br_on[k]]
    rng.shuffle(linhas)
    estados, pulados = [], {"ilhamento": 0, "AC não convergiu": 0}
    t_ac, t_dc, t_flat, flat_ok = [], [], [], []
    for k in linhas:
        if len(estados) >= a.n:
            break
        bm, brm = topology_masks(net, [k], [])
        if not bm.all():
            pulados["ilhamento"] += 1
            continue
        t0 = time.perf_counter()
        ac = solve_ac(net, bm, brm, init="case")                       # partida a quente: do ponto do caso base (a plana diverge em algumas redes grandes)
        dt_ac = time.perf_counter() - t0
        if len(t_flat) < a.flat_n and ac["converged"]:                 # flat-start time, on the first scenarios (and if it converges)
            t0 = time.perf_counter()
            fl = solve_ac(net, bm, brm, init="flat")
            t_flat.append((time.perf_counter() - t0) * 1000); flat_ok.append(bool(fl["converged"]))
        if not ac["converged"]:
            pulados["AC não convergiu"] += 1
            continue
        t0 = time.perf_counter()
        dc = solve_dc(net, bm, brm)
        dt_dc = time.perf_counter() - t0
        t_ac.append(dt_ac * 1000); t_dc.append(dt_dc * 1000)
        t0 = time.perf_counter()
        estados.append({"k": k, "ac": ac, "dc": dc, "brm": brm, "tab": tabelas(net, cost, brm, ac, dc)})
        print(f"  scenario {len(estados)}/{a.n} (line {k}): AC {dt_ac * 1000:.0f} ms, DC {dt_dc * 1000:.0f} ms, build tables {(time.perf_counter() - t0) * 1000:.0f} ms", flush=True)
    print(f"{len(estados)} scenarios ready; skipped: {pulados}")

    print("scenarios ready; loading GENCO and predicting...", flush=True)
    g = GencoEmMemoria(Path(a.modelo), a.device)
    g.prever([e["tab"] for e in estados[:1]], lote=1)                        # aquecimento
    if a.device.startswith("cuda"):
        torch.cuda.synchronize()
    tops = [e["tab"] for e in estados]
    g.tempos = {"montagem": 0.0, "modelo": 0.0}
    t0 = time.perf_counter()
    vm, va = g.prever(tops, lote=a.lote)
    if a.device.startswith("cuda"):
        torch.cuda.synchronize()
    t_genco = (time.perf_counter() - t0) * 1000 / len(tops)

    err_g, err_d, err_max_g, err_max_d = [], [], [], []
    for i, e in enumerate(estados):
        on = e["brm"]
        s = np.maximum(np.hypot(e["ac"]["pf"], e["ac"]["qf"]), np.hypot(e["ac"]["pt"], e["ac"]["qt"]))
        la = np.where(on & (rate > 0), s / np.where(rate > 0, rate, 1.0), 0.0)
        ld = np.where(on & (rate > 0), np.abs(e["dc"]["pf"]) / np.where(rate > 0, rate, 1.0), 0.0)
        lg = carregamento(vm[i], va[i], e["tab"][2])
        err_g.append(np.abs(lg[on] - la[on])); err_d.append(np.abs(ld[on] - la[on]))
        err_max_g.append(abs(lg.max() - la.max())); err_max_d.append(abs(ld.max() - la.max()))
    Eg, Ed = np.concatenate(err_g) * 100, np.concatenate(err_d) * 100
    n = len(estados)
    res = {
        "rede": a.rede, "barras": int(net.nb), "linhas": int(net.nl), "geradores": int(len(net.gen_bus)), "cenarios": n, "pulados": pulados, "seed": a.seed, "casoBase": base,
        "modelo": Path(a.modelo).name,
        "erro": {"genco": {"maePct": round(float(Eg.mean()), 3), "p95Pct": round(float(np.percentile(Eg, 95)), 2), "maxPct": round(float(Eg.max()), 1),
                           "erroDoMaximoMedianoPct": round(float(np.median(err_max_g) * 100), 2)},
                 "dc": {"maePct": round(float(Ed.mean()), 3), "p95Pct": round(float(np.percentile(Ed, 95)), 2), "maxPct": round(float(Ed.max()), 1),
                        "erroDoMaximoMedianoPct": round(float(np.median(err_max_d) * 100), 2)}},
        "acPartidaPlana": {"testados": len(flat_ok), "convergiram": int(sum(flat_ok)),
                           "msMediano": round(float(np.median([t for t, ok in zip(t_flat, flat_ok) if ok])), 1) if any(flat_ok) else None},
        "msPorCenario": {"acNosso": round(float(np.median(t_ac)), 1), "dc": round(float(np.median(t_dc)), 2), "gencoTotal": round(t_genco, 1),
                         "gencoMontagemDoGrafo": round(g.tempos["montagem"] * 1000 / n, 1), "gencoModelo": round(g.tempos["modelo"] * 1000 / n, 1), "lote": a.lote},
        "maquina": {"dispositivoDoGenco": a.device, "gpu": torch.cuda.get_device_name(0) if a.device.startswith("cuda") else None, "cpuLogicas": os.cpu_count(), "plataforma": platform.platform(), "torch": torch.__version__, "threadsTorch": torch.get_num_threads()},
        "totalS": round(time.perf_counter() - t_total, 1),
    }
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    Path(a.dst).write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("rede", "barras", "cenarios", "erro", "msPorCenario", "acPartidaPlana")}, ensure_ascii=False))
    print(f"gravado {a.dst}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rede", required=True)
    ap.add_argument("--json", required=True, help="caso no formato do projeto (export_case.py)")
    ap.add_argument("--m", required=True, help="PGLib case (.m), for the generator costs")
    ap.add_argument("--modelo", required=True, help="pasta do checkpoint (config.yaml, best_model_state_dict.pt, normalizer_stats.pt)")
    ap.add_argument("--referencia", help="PowerModels AC-OPF JSON (opf_powermodels.py), to check our AC on the base case")
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--lote", type=int, default=16)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="cpu", help="cpu or cuda (the AC always runs on CPU)")
    ap.add_argument("--flat-n", type=int, default=8, help="how many scenarios are also solved with a flat start, just to measure the time")
    ap.add_argument("--dst", required=True)
    main(ap.parse_args())
