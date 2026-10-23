"""Evaluates topologies (branches/buses out) with the chosen solver and builds the contract response (docs/CONTRATO_API.md)."""
from __future__ import annotations

import time
from dataclasses import replace

import numpy as np

from .acpf import solve_ac, solve_dc
from .network import Network, topology_masks

SOLVERS = {"ac": solve_ac, "dc": solve_dc}

# Violation tolerances: an OPF leaves branches/voltages exactly AT the limit (active constraint); the recomputed power flow gives
# 100.0003% or 1.0600001 pu from numerical noise, which is not a violation.
TOL_LOADING = 1e-4      # ratio (0.01% of rateA)
TOL_VOLTAGE = 5e-4      # pu (the interface uses the same value in interface/src/utils/voltage.js)
TOL_QGEN = 1e-3         # MVAr
TOL_PGEN = 1e-3         # MW


def _r(x, nd=6):
    return [round(float(v), nd) for v in x]


def evaluate(net: Network, branch_out=(), bus_out=(), solver: str = "ac", pg=None, pd=None, qd=None) -> dict:
    """Returns the electrical state of the topology. Buses by MATPOWER number; branches by the index in the `branch` table.

    `pg` (per generator), `pd` and `qd` (per bus) replace the dispatch and loads of the case (used by the corrective plan: redispatch and shedding).
    """
    if pg is not None or pd is not None or qd is not None:
        net = replace(net, gen_pg=net.gen_pg if pg is None else np.asarray(pg, float),
                      pd=net.pd if pd is None else np.asarray(pd, float), qd=net.qd if qd is None else np.asarray(qd, float))
    if solver not in SOLVERS:
        raise ValueError(f"solver desconhecido: {solver}")
    t0 = time.perf_counter()
    bus_mask, br_mask = topology_masks(net, branch_out, bus_out)
    total_pd = float(net.pd.sum())

    if not bus_mask.any():                                    # reference faulted: nothing energized
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
        return {**base, "error": f"did not converge in {sol['iterations']} iterations (error {sol['mismatch']:.2e})", "buses": [],
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
