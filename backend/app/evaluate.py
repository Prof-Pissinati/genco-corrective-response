"""Avalia topologias (ramos/barras fora) com o solver escolhido e monta a resposta do contrato (docs/CONTRATO_API.md)."""
from __future__ import annotations

import time
from dataclasses import replace

import numpy as np

from .acpf import solve_ac, solve_dc
from .network import Network, topology_masks

SOLVERS = {"ac": solve_ac, "dc": solve_dc}

# Tolerâncias das violações: um OPF deixa ramos/tensões exatamente NO limite (restrição ativa); o fluxo de potência refeito dá
# 100,0003% ou 1,0600001 pu por ruído numérico, o que não é violação.
TOL_LOADING = 1e-4      # razão (0,01% do rateA)
TOL_VOLTAGE = 1e-4      # pu
TOL_QGEN = 1e-3         # MVAr
TOL_PGEN = 1e-3         # MW


def _r(x, nd=6):
    return [round(float(v), nd) for v in x]


def evaluate(net: Network, branch_out=(), bus_out=(), solver: str = "ac", pg=None, pd=None, qd=None) -> dict:
    """Retorna o estado elétrico da topologia. Barras pelo número MATPOWER; ramos pelo índice da tabela `branch`.

    `pg` (por gerador), `pd` e `qd` (por barra) substituem o despacho e as cargas do caso (usado pelo plano corretivo: redespacho e corte).
    """
    if pg is not None or pd is not None or qd is not None:
        net = replace(net, gen_pg=net.gen_pg if pg is None else np.asarray(pg, float),
                      pd=net.pd if pd is None else np.asarray(pd, float), qd=net.qd if qd is None else np.asarray(qd, float))
    if solver not in SOLVERS:
        raise ValueError(f"solver desconhecido: {solver}")
    t0 = time.perf_counter()
    bus_mask, br_mask = topology_masks(net, branch_out, bus_out)
    total_pd = float(net.pd.sum())

    if not bus_mask.any():                                    # referência em falta: nada energizado
        return {"solver": solver, "converged": True, "ms": round((time.perf_counter() - t0) * 1000, 3), "energized": [],
                "lostBuses": [int(n) for n in net.bus_no], "servedMW": 0.0, "lostMW": round(total_pd, 6), "buses": [], "branches": [],
                "gens": [], "violations": {"overload": [], "voltage": [], "qgen": [], "pgen": []}}

    sol = SOLVERS[solver](net, bus_mask, br_mask)
    ms = round((time.perf_counter() - t0) * 1000, 3)
    served = float(net.pd[bus_mask].sum())
    base = {"solver": solver, "converged": bool(sol["converged"]), "ms": ms,
            "energized": [int(n) for n in net.bus_no[bus_mask]], "lostBuses": [int(n) for n in net.bus_no[~bus_mask]],
            "servedMW": round(served, 6), "lostMW": round(total_pd - served, 6)}
    if not sol["converged"]:
        return {**base, "error": f"não convergiu em {sol['iterations']} iterações (erro {sol['mismatch']:.2e})", "buses": [],
                "branches": [], "gens": [], "violations": {"overload": [], "voltage": [], "qgen": [], "pgen": []}}

    bi = np.flatnonzero(br_mask)
    s_from = np.hypot(sol["pf"], sol["qf"])
    s_to = np.hypot(sol["pt"], sol["qt"])
    loading = np.where(net.br_rate > 0, np.maximum(s_from, s_to) / np.where(net.br_rate > 0, net.br_rate, 1.0), 0.0)
    overload = [int(i) for i in bi if loading[i] > 1.0 + TOL_LOADING]

    bidx = np.flatnonzero(bus_mask)
    voltage = []
    if solver == "ac":
        voltage = [int(net.bus_no[i]) for i in bidx if sol["vm"][i] < net.vmin[i] - TOL_VOLTAGE or sol["vm"][i] > net.vmax[i] + TOL_VOLTAGE]
    gon = np.flatnonzero(net.gen_on & bus_mask[net.gen_bus])
    qgen, pgen = [], []
    if solver == "ac":
        pgen = [int(g) for g in gon if sol["pg"][g] > net.gen_pmax[g] + TOL_PGEN or sol["pg"][g] < net.gen_pmin[g] - TOL_PGEN]
        qgen = [int(g) for g in gon if sol["qg"][g] < net.gen_qmin[g] - TOL_QGEN or sol["qg"][g] > net.gen_qmax[g] + TOL_QGEN]

    return {
        **base,
        "buses": [{"id": int(net.bus_no[i]), "vm": round(float(sol["vm"][i]), 6), "va": round(float(sol["va"][i]), 5)} for i in bidx],
        "branches": [{"id": int(i), "pf": round(float(sol["pf"][i]), 4), "qf": round(float(sol["qf"][i]), 4),
                      "pt": round(float(sol["pt"][i]), 4), "qt": round(float(sol["qt"][i]), 4), "loading": round(float(loading[i]), 5)}
                     for i in bi],
        "gens": [{"id": int(g), "bus": int(net.bus_no[net.gen_bus[g]]), "pg": round(float(sol["pg"][g]), 4),
                  "qg": round(float(sol["qg"][g]), 4)} for g in gon],
        "violations": {"overload": overload, "voltage": voltage, "qgen": qgen, "pgen": pgen},
    }
