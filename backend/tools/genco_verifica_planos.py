"""GENCO as a VERIFIER of the corrective plans.

For each contingency, the backend computes a plan (redispatch + minimum load shedding) and checks it with the AC. Here we ask: can a model trained only on
topologies (WITHOUT redispatch and WITHOUT load shedding in the training data) tell, in one shot and in milliseconds, whether the plan solves the overloads?

For each line contingency that requires action (and does not island buses) we build post-fault states, always with the line out:
  no plan         only the automatic generation response (proportional redistribution);
  partial plan    half the way between "no plan" and the plan (redispatch and shedding x 0.5);
  plan with margin the LP plan computed to stay `margin` below the limit (0 = touches the limit; 3, 5, 8 and 10 % points).
The AC is the ground truth. We measure (1) the loading error of GENCO and of the DC in those states and (2) the verdict "can approve the plan (maximum loading <= 100%)":
  - INSUFFICIENT plans (no plan and partial, all really overloaded): how many the verifier rejects (approving one of them is the serious mistake);
  - plans WITH MARGIN (all really safe): how many the verifier approves, and with what extra cost in redispatch and shedding.

Runs in the GENCO environment (gridfm-graphkit + torch), from the repository root:
    python backend/tools/genco_verifica_planos.py [--modelo models/case118_genco_tiny_n10] [--device cpu] [--dst arquivo.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
sys.path.insert(0, str(ROOT / "tools"))
from app.acpf import solve_ac, solve_dc                         # noqa: E402
from app.corrective import plan_corrective, proportional_redispatch   # noqa: E402
from app.evaluate import TOL_LOADING                            # noqa: E402
from app.network import load_case, topology_masks               # noqa: E402
import genco_screening as gs                                    # noqa: E402
from genco_screening import MODEL_LABEL, gencost_from_m, model_tag, scenario_rows   # noqa: E402

FOLGAS = (0.0, 0.03, 0.05, 0.08, 0.10)       # plan margin relative to the limit (fraction of rateA)


def estado(net, branch_out, pg, pd_, qd):
    """Network with the state (pg per generator, pd/qd per bus) and the line out: also returns the branch mask and the AC and DC solutions."""
    n2 = replace(net, gen_pg=np.asarray(pg, float), pd=np.asarray(pd_, float), qd=np.asarray(qd, float))
    bm, brm = topology_masks(n2, branch_out, [])
    return n2, brm, solve_ac(n2, bm, brm), solve_dc(n2, bm, brm)


def tabelas(n2, cost, brm, ac, dc):
    """(bus, gen, branch) of the state, in the datakit format (same code as the screening)."""
    rb, rg, rl = scenario_rows(n2, cost, brm, ac, dc, 0)
    bus, gen, br = pd.DataFrame(rb), pd.DataFrame(rg), pd.DataFrame(rl)
    agg = gen.groupby("bus")[["min_q_mvar", "max_q_mvar"]].sum().reset_index()
    return bus.merge(agg, on="bus", how="left").fillna(0), gen, br          # same preprocessing as the graphkit


def carga_ac(ac, rate, on):
    s = np.maximum(np.hypot(ac["pf"], ac["qf"]), np.hypot(ac["pt"], ac["qt"]))
    return np.where(on & (rate > 0), s / np.where(rate > 0, rate, 1.0), 0.0)


def estado_do_plano(net, bm, br_mask, k, plano):
    """Rebuilds (pg, pd, qd) of the plan: proportional response + redispatch and shedding listed in the plan."""
    pg = proportional_redispatch(net, bm, br_mask)
    for r in plano["plan"]["redispatch"]:
        pg[r["gen"]] = r["pgAfter"]
    pd_ = net.pd.copy()
    for r in plano["plan"]["shed"]:
        pd_[net.bus_index([r["bus"]])[0]] -= r["mw"]
    sc = np.where(net.pd > 1e-9, pd_ / np.where(net.pd > 1e-9, net.pd, 1.0), 1.0)
    return pg, pd_, net.qd * sc


def main(modelo: Path, device: str, dst: Path, label: str):
    from genco_inferencia_exemplo import GencoEmMemoria, carregamento       # exige torch + gridfm-graphkit
    net = load_case(gs.CASE_JSON)
    cost = gencost_from_m(gs.CASE_M)
    rate = net.br_rate

    t0 = time.perf_counter()
    estados, tops, pulados = [], [], []
    for k in range(net.nl):
        if not net.br_on[k]:
            continue
        bm, brm0 = topology_masks(net, [k], [])
        if not bm.all():
            pulados.append({"id": k, "motivo": "islanding (GENCO did not see islands in training)"})
            continue
        base = plan_corrective(net, [k], [])
        if not base["needsAction"]:
            continue
        pg1 = proportional_redispatch(net, bm, brm0)
        planos = {f: (base if f == 0.0 else plan_corrective(net, [k], [], margin=f)) for f in FOLGAS}
        s0 = estado_do_plano(net, bm, brm0, k, planos[0.0])
        variantes = [("semPlano", (pg1, net.pd, net.qd), None), ("parcial", tuple(a + 0.5 * (b - a) for a, b in zip((pg1, net.pd, net.qd), s0)), None)]
        variantes += [(f"folga{int(round(f * 100))}", estado_do_plano(net, bm, brm0, k, planos[f]), planos[f]) for f in FOLGAS]
        for nome, (pg, pd_, qd), plano in variantes:
            n2, brm, ac, dc = estado(net, [k], pg, pd_, qd)
            if not ac["converged"]:
                continue
            tops.append(tabelas(n2, cost, brm, ac, dc))
            estados.append({"k": k, "variante": nome, "ac": ac, "dc": dc, "brm": brm, "shedMW": float((net.pd - pd_).sum()),
                            "redespachoMW": float(np.abs(pg - pg1).sum() / 2), "ix": len(tops) - 1})
    t_planos = time.perf_counter() - t0

    modelo_g = GencoEmMemoria(modelo, device)
    modelo_g.prever(tops[:2], lote=2)                                       # aquecimento
    t0 = time.perf_counter()
    vm, va = modelo_g.prever(tops, lote=160)
    ms = (time.perf_counter() - t0) * 1000 / len(tops)

    A, G, D, linhas = [], [], [], {}
    for e in estados:
        on, ac, dc = e["brm"], e["ac"], e["dc"]
        la = carga_ac(ac, rate, on)
        ld = np.where(on & (rate > 0), np.abs(dc["pf"]) / np.where(rate > 0, rate, 1.0), 0.0)
        lg = carregamento(vm[e["ix"]], va[e["ix"]], tops[e["ix"]][2])
        A.append(la[on]); D.append(ld[on]); G.append(lg[on])
        f = lambda x, th=1 + TOL_LOADING: {"maxPct": round(float(x.max() * 100), 2), "overloads": int((x[on] > th).sum())}
        e["r"] = {"ac": f(la), "genco": f(lg), "dc": f(ld), "shedMW": round(e["shedMW"], 2), "redespachoMW": round(e["redespachoMW"], 1)}
        linhas.setdefault(e["k"], {})[e["variante"]] = e["r"]

    Aa, Ga, Da = np.concatenate(A), np.concatenate(G), np.concatenate(D)
    mae = lambda x: round(float(np.mean(np.abs(x - Aa)) * 100), 3)

    def grupo(nomes):
        return [e["r"] for e in estados if e["variante"] in nomes]

    lista_tmp = [v for _, v in sorted(linhas.items())]
    # (1) insufficient plans (no plan and partial) in which the AC flags overload: the ideal verifier rejects all of them; approving one is the serious mistake
    insuf = [r for r in grupo({"semPlano", "parcial"}) if r["ac"]["maxPct"] > 100 + 100 * TOL_LOADING]
    nomes_folga = [f"folga{int(round(f * 100))}" for f in FOLGAS]
    seguranca = {"insuficientes": len(insuf), "regraDeTres95": round(3 / max(len(insuf), 1) * 100, 2)}      # 0 erros em n: limite superior de ~3/n (95%)
    for nm in ("genco", "dc"):
        erradas = lambda th: sum(r[nm]["maxPct"] <= th for r in insuf)
        seguro = max([t for t in range(80, 101) if erradas(t) == 0], default=None)               # highest approval threshold with no wrongful approval
        seguranca[nm] = {"limiarSeguroPct": seguro, "aprovadasPorEngano100": int(erradas(100)),
                         "aprovadosNoLimiarSeguro": {n: int(sum(v[n][nm]["maxPct"] <= seguro for v in lista_tmp)) for n in nomes_folga} if seguro else {}}
    # (2) plans with margin: all safe in the AC; how many the verifier approves (100% threshold) and the extra cost of each margin
    escada = []
    for f in FOLGAS:
        nome = f"folga{int(round(f * 100))}"
        rs = grupo({nome})
        item = {"folgaPct": int(round(f * 100)), "planos": len(rs),
                "corteTotalMW": round(sum(r["shedMW"] for r in rs), 1), "corteMedioMW": round(float(np.mean([r["shedMW"] for r in rs])), 2),
                "redespachoMedioMW": round(float(np.mean([r["redespachoMW"] for r in rs])), 1),
                "acMaxMedioPct": round(float(np.mean([r["ac"]["maxPct"] for r in rs])), 1), "acMaxPct": round(max(r["ac"]["maxPct"] for r in rs), 1)}
        for nm in ("genco", "dc"):
            item[nm] = {"aprovados100": sum(r[nm]["maxPct"] <= 100 for r in rs)}
        escada.append(item)
    erro_max = {}
    for nome in ["semPlano", "parcial"] + [f"folga{int(round(f * 100))}" for f in FOLGAS]:
        rs = grupo({nome})
        eg = np.array([abs(r["genco"]["maxPct"] - r["ac"]["maxPct"]) for r in rs]); ed = np.array([abs(r["dc"]["maxPct"] - r["ac"]["maxPct"]) for r in rs])
        erro_max[nome] = {"n": len(rs), "genco_mediana": round(float(np.median(eg)), 2), "genco_p90": round(float(np.percentile(eg, 90)), 2), "genco_max": round(float(eg.max()), 2),
                          "dc_mediana": round(float(np.median(ed)), 2), "dc_p90": round(float(np.percentile(ed, 90)), 2), "dc_max": round(float(ed.max()), 2)}

    lista = [{"id": k, "from": int(net.bus_no[net.br_f[k]]), "to": int(net.bus_no[net.br_t[k]]), **v} for k, v in sorted(linhas.items())]
    saida = {
        "case": gs.CASE, "model": label,
        "descricao": "post-fault states of ONE line (no plan, partial plan and plans with a margin of 0 to 10 points) evaluated by AC (ground truth), GENCO and DC",
        "contingencias": len(lista), "estados": len(estados), "pulados": pulados,
        "loadingMAE_pct": {"genco": mae(Ga), "dc": mae(Da)},
        "loadingMAX_pct": {"genco": round(float(np.max(np.abs(Ga - Aa)) * 100), 2), "dc": round(float(np.max(np.abs(Da - Aa)) * 100), 2)},
        "seguranca": seguranca, "folgas": escada, "erroDoMaximo": erro_max,
        "ms": {"genco_cpu_este_pc": round(ms, 2), "planos_backend_total_s": round(t_planos, 1)},
        "lines": lista,
    }
    dst.write_text(json.dumps(saida, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {dst} ({dst.stat().st_size // 1024} KB) | {len(lista)} contingencies, {len(estados)} states, {len(pulados)} skipped due to islanding")
    print(f"mean error per line (% points): GENCO {mae(Ga):.2f} | DC {mae(Da):.2f}   max: GENCO {saida['loadingMAX_pct']['genco']:.1f} DC {saida['loadingMAX_pct']['dc']:.1f}")
    print("seguranca:", json.dumps(seguranca, ensure_ascii=False))
    for it in escada:
        print(it)
    for n, v in erro_max.items():
        print(n, v)
    print("ms/estado GENCO (CPU):", round(ms, 1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default=str(ROOT / "models" / "case118_genco_tiny_n10"), help="pasta do checkpoint (config.yaml, best_model_state_dict.pt, normalizer_stats.pt)")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--case", default="case118_ieee", help="network: case14_ieee, case30_ieee, case57_ieee or case118_ieee")
    ap.add_argument("--dst", help="output file (default: interface/src/data/verificacao_planos_<network>_<model>.json)")
    ap.add_argument("--model-label", default=MODEL_LABEL)
    a = ap.parse_args()
    gs.set_case(a.case)
    dst = Path(a.dst) if a.dst else gs.DATA / f"verificacao_planos_{a.case}_{model_tag(a.modelo)}.json"
    main(Path(a.modelo), a.device, dst, a.model_label)
