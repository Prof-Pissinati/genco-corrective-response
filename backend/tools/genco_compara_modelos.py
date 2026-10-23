"""Compares GENCO checkpoints with the AC on MULTIPLE line outages (N-k), with the base dispatch and the reference bus absorbing the imbalance.

The authors' checkpoints were trained only up to N-1; ours (`case118_genco_tiny_n10`) up to N-10. For each k we draw sets of k lines (fixed seed),
we discard those that island buses or for which the AC does not converge, and measure the loading error per line (in % points) of each model and of the DC against the AC.

Runs in the GENCO environment (gridfm-graphkit + torch), from the repository root:
    python backend/tools/genco_compara_modelos.py --modelo models/case118_genco_tiny_n10 --modelo models/case118_genco_tiny_autores [--por-k 80] [--dst arquivo.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
sys.path.insert(0, str(ROOT / "tools"))
from app.acpf import solve_ac, solve_dc                       # noqa: E402
from app.network import load_case, topology_masks             # noqa: E402
import genco_screening as gs                                   # noqa: E402
from genco_screening import gencost_from_m, scenario_rows       # noqa: E402
from genco_verifica_planos import carga_ac, tabelas           # noqa: E402

KS = (1, 2, 3, 5, 8, 10)


def main(modelos, por_k, dst, seed):
    from genco_inferencia_exemplo import GencoEmMemoria, carregamento
    net = load_case(gs.CASE_JSON)
    cost = gencost_from_m(gs.CASE_M)
    rate = net.br_rate
    rng = np.random.default_rng(seed)
    linhas = [k for k in range(net.nl) if net.br_on[k]]

    estados = []
    for k in KS:
        achados, tentativas = 0, 0
        while achados < por_k and tentativas < por_k * 40:
            tentativas += 1
            outs = sorted(int(x) for x in rng.choice(linhas, size=k, replace=False))
            bm, brm = topology_masks(net, outs, [])
            if not bm.all():
                continue
            ac = solve_ac(net, bm, brm)
            if not ac["converged"]:
                continue
            dc = solve_dc(net, bm, brm)
            estados.append({"k": k, "outs": outs, "ac": ac, "dc": dc, "brm": brm, "tab": tabelas(net, cost, brm, ac, dc)})
            achados += 1
    print(f"{len(estados)} estados sorteados ({', '.join(f'N-{k}' for k in KS)})")

    tops = [e["tab"] for e in estados]
    preds = {}
    for m in modelos:
        g = GencoEmMemoria(Path(m), "cpu")
        preds[Path(m).name] = g.prever(tops, lote=160)

    res = {"seed": seed, "porK": por_k, "modelos": list(preds), "k": {}}
    for k in KS:
        sel = [i for i, e in enumerate(estados) if e["k"] == k]
        if not sel:
            continue
        linha = {"estados": len(sel)}
        err = {n: [] for n in preds}
        err["dc"] = []
        maxerr = {n: [] for n in preds}
        maxerr["dc"] = []
        for i in sel:
            e = estados[i]
            on = e["brm"]
            la = carga_ac(e["ac"], rate, on)
            ld = np.where(on & (rate > 0), np.abs(e["dc"]["pf"]) / np.where(rate > 0, rate, 1.0), 0.0)
            err["dc"].append(np.abs(ld[on] - la[on]))
            maxerr["dc"].append(abs(ld.max() - la.max()))
            for n, (vm, va) in preds.items():
                lg = carregamento(vm[i], va[i], e["tab"][2])
                err[n].append(np.abs(lg[on] - la[on]))
                maxerr[n].append(abs(lg.max() - la.max()))
        for n in err:
            todos = np.concatenate(err[n])
            linha[n] = {"maePct": round(float(todos.mean() * 100), 3), "p95Pct": round(float(np.percentile(todos, 95) * 100), 2),
                        "maxPct": round(float(todos.max() * 100), 1), "erroDoMaximoMedianoPct": round(float(np.median(maxerr[n]) * 100), 2)}
        res["k"][str(k)] = linha
    dst.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"gravado {dst}")
    for k, v in res["k"].items():
        print(f"N-{k} ({v['estados']} states): " + " | ".join(f"{n} MAE {v[n]['maePct']} (p95 {v[n]['p95Pct']}, max {v[n]['maxPct']})" for n in list(preds) + ["dc"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", action="append", required=True, help="pasta do checkpoint; pode repetir")
    ap.add_argument("--por-k", type=int, default=80)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dst", default=str(ROOT / "docs" / "genco_comparacao_multiplas_saidas.json"))
    a = ap.parse_args()
    main(a.modelo, a.por_k, Path(a.dst), a.seed)
