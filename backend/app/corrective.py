"""Corrective response to contingencies: generation redispatch and, if a violation remains, the MINIMUM load shedding.

Fluxo (docs/ARQUITETURA.md):
  1. post-fault state, with the lost/surplus generation redistributed among the generators using their headroom (automatic response);
  2. if overloads remain (or generation is short), a linear problem chooses the redispatch and load shedding that minimize the shed load
     respecting the thermal limits (DC sensitivities over the AC state) and the generator limits;
  3. the plan is verified by the AC; if an overload remains, the limits of the violated branches are tightened and the problem is solved again.

Any load can be shed (per bus, from 0 to 100%). Voltage violations are only reported.
"""
from __future__ import annotations

import time
from dataclasses import replace

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix, csc_matrix
from scipy.sparse.linalg import splu

from .acpf import solve_ac, solve_dc
from .evaluate import TOL_LOADING, evaluate
from .network import Network, topology_masks

SHED_COST = 1.0           # custo por MW cortado
REDISPATCH_COST = 1e-3    # custo por MW redespachado (preferir redespachar a cortar)
MIN_PU_CAP = 0.05         # minimum P limit on a branch, as a fraction of rateA (avoids a degenerate constraint)
VIOLATION_COST = 10.0     # best-effort plan: cost per MW of line-limit violation = VIOLATION_COST x total load (more expensive than shedding all the load)


def proportional_redispatch(net: Network, bus_mask, br_mask) -> np.ndarray:
    """Dispatch after the fault: the imbalance the reference would absorb is redistributed among the other generators using their headroom
    (up to Pmax if generation is short; down to Pmin if there is a surplus). Returns Pg per generator (all of them, in table order)."""
    pg = net.gen_pg.copy()
    sol = solve_ac(net, bus_mask, br_mask)
    if not sol["converged"]:
        sol = solve_dc(net, bus_mask, br_mask)
    on = np.flatnonzero(net.gen_on & bus_mask[net.gen_bus])
    ref_gens = [g for g in on if net.gen_bus[g] == net.ref]
    others = np.array([g for g in on if net.gen_bus[g] != net.ref], dtype=int)
    if not len(ref_gens) or not len(others):
        return pg
    delta = float(sol["pg"][ref_gens].sum() - net.gen_pg[ref_gens].sum())      # MW the reference would need to give up/receive
    if abs(delta) < 1e-6:
        return pg
    if delta > 0:
        room = np.clip(net.gen_pmax[others] - pg[others], 0, None)
    else:
        room = np.clip(pg[others] - net.gen_pmin[others], 0, None)
    need = abs(delta)
    alloc = np.zeros(len(others))
    for _ in range(len(others) + 1):                                           # water-filling (respects saturations)
        free = room - alloc > 1e-9
        if need < 1e-9 or not free.any():
            break
        w = np.where(free, room, 0.0)
        step = np.minimum(need * w / w.sum(), room - alloc)
        alloc += step
        need -= step.sum()
    pg[others] += np.sign(delta) * alloc
    return pg


def _ptdf(net: Network, bus_mask, br_mask):
    """Sensitivity of the flow (P, at the `from` end) of each active branch to the injection at each bus of the island; reference as slack.
    Returns (bus_indices, active_branches, S[n_active_branches, n_island_buses])."""
    idx = np.flatnonzero(bus_mask)
    n = len(idx)
    remap = -np.ones(net.nb, dtype=int)
    remap[idx] = np.arange(n)
    bi = np.flatnonzero(br_mask)
    f, t = remap[net.br_f[bi]], remap[net.br_t[bi]]
    y = 1.0 / (net.br_x[bi] * net.br_tap[bi])
    B = coo_matrix((np.r_[y, y, -y, -y], (np.r_[f, t, f, t], np.r_[f, t, t, f])), shape=(n, n)).tocsc()
    ref = remap[net.ref]
    keep = np.flatnonzero(np.arange(n) != ref)
    lu = splu(csc_matrix(B[keep][:, keep]))
    X = np.zeros((n, n))
    X[np.ix_(keep, keep)] = lu.solve(np.eye(len(keep)))
    S = (X[f, :] - X[t, :]) * y[:, None]
    return idx, bi, S


def plan_corrective(net: Network, branch_out=(), bus_out=(), max_iter: int = 8, margin: float = 0.0) -> dict:
    """Corrective plan for the topology with the given faults. See the module."""
    t0 = time.perf_counter()
    bus_mask, br_mask = topology_masks(net, branch_out, bus_out)
    pre = evaluate(net, [], [], "ac")
    if not bus_mask.any():                                                      # reference faulted: nothing to do
        lost = evaluate(net, branch_out, bus_out, "ac")
        return _pack(net, branch_out, bus_out, pre, lost, lost, net.gen_pg, net.gen_pg, net.pd, net.pd, 0, t0, "the reference bus is faulted: no island is energized")

    # 1) automatic generation response
    pg1 = proportional_redispatch(net, bus_mask, br_mask)
    post = evaluate(net, branch_out, bus_out, "ac", pg=pg1)
    need = _needs_action(post)
    if not need:
        return _pack(net, branch_out, bus_out, pre, post, post, pg1, pg1, net.pd, net.pd, 0, t0)

    # 2) LP: minimum shedding + redispatch
    idx, bi, S = _ptdf(net, bus_mask, br_mask)
    pos = -np.ones(net.nb, dtype=int)
    pos[idx] = np.arange(len(idx))
    pbr = {b["id"]: b for b in post["branches"]} if post["converged"] else None
    if pbr is None:                                                             # AC did not converge: DC baseline
        dc = solve_dc(net, bus_mask, br_mask)
        p_from = dc["pf"][bi]; q_from = np.zeros(len(bi)); p_to = dc["pt"][bi]; q_to = np.zeros(len(bi))
        pg_now = pg1.copy()
    else:
        p_from = np.array([pbr[i]["pf"] for i in bi]); q_from = np.array([pbr[i]["qf"] for i in bi])
        p_to = np.array([pbr[i]["pt"] for i in bi]); q_to = np.array([pbr[i]["qt"] for i in bi])
        pg_now = pg1.copy()
        for g in post["gens"]:
            pg_now[g["id"]] = g["pg"]                                           # includes what the reference started generating

    gens = np.flatnonzero(net.gen_on & bus_mask[net.gen_bus])
    loads = np.flatnonzero(bus_mask & (net.pd > 1e-9))
    ng, nl_ = len(gens), len(loads)
    rate = net.br_rate[bi]
    has_lim = rate > 0
    margins = np.full(len(bi), float(margin))
    best = None
    iterations = 0
    for iterations in range(1, max_iter + 1):
        cap_f = np.sqrt(np.maximum((rate * (1 - margins)) ** 2 - q_from ** 2, (MIN_PU_CAP * rate) ** 2))
        cap_t = np.sqrt(np.maximum((rate * (1 - margins)) ** 2 - q_to ** 2, (MIN_PU_CAP * rate) ** 2))
        # variables: [u_g (up), d_g (down), s_b (shed)]
        nvar = 2 * ng + nl_
        c = np.r_[np.full(2 * ng, REDISPATCH_COST), np.full(nl_, SHED_COST)]
        # net injection of each bus: generator (u-d) and shedding (+s)
        M = np.zeros((len(idx), nvar))
        for k, g in enumerate(gens):
            M[pos[net.gen_bus[g]], k] = 1.0
            M[pos[net.gen_bus[g]], ng + k] = -1.0
        for k, b in enumerate(loads):
            M[pos[b], 2 * ng + k] = 1.0
        F = S @ M                                                               # change of the `from` flow per variable
        lim = np.flatnonzero(has_lim)
        A_ub = np.vstack([F[lim], -F[lim], -F[lim], F[lim]])                    # |pf0+ΔF| <= cap_f  e  |pt0-ΔF| <= cap_t
        b_ub = np.r_[cap_f[lim] - p_from[lim], cap_f[lim] + p_from[lim], cap_t[lim] - p_to[lim], cap_t[lim] + p_to[lim]]
        A_eq = np.ones((1, nvar))
        A_eq[0, ng:2 * ng] = -1.0
        A_eq[0, :ng] = 1.0
        bounds = ([(0, max(net.gen_pmax[g] - pg_now[g], 0)) for g in gens] + [(0, max(pg_now[g] - net.gen_pmin[g], 0)) for g in gens]
                  + [(0, float(net.pd[b])) for b in loads])
        res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=[0.0], bounds=bounds, method="highs")
        if res.status != 0:
            # no redispatch and shedding respects all the line limits: BEST-EFFORT plan, with limit violations at a very high cost
            # (only gets here when the hard problem is infeasible, so plans that already have a solution do not change)
            nlim = len(lim)
            A_soft = np.hstack([A_ub, np.zeros((A_ub.shape[0], nlim))])
            for blk in range(4):
                A_soft[blk * nlim + np.arange(nlim), nvar + np.arange(nlim)] = -1.0
            c_soft = np.r_[c, np.full(nlim, VIOLATION_COST * max(float(net.pd.sum()), 1.0))]
            res = linprog(c_soft, A_ub=A_soft, b_ub=b_ub, A_eq=np.hstack([A_eq, np.zeros((1, nlim))]), b_eq=[0.0], bounds=bounds + [(0, None)] * nlim, method="highs")
        if res.status != 0:
            return _pack(net, branch_out, bus_out, pre, post, post, pg1, pg1, net.pd, net.pd, iterations, t0, f"optimization has no solution ({res.message})")
        x = res.x[:nvar]
        pg2 = pg_now.copy()
        pg2[gens] = pg_now[gens] + x[:ng] - x[ng:2 * ng]
        shed = np.zeros(net.nb)
        shed[loads] = x[2 * ng:]
        pd2 = net.pd - shed
        scale = np.where(net.pd > 1e-9, pd2 / np.where(net.pd > 1e-9, net.pd, 1.0), 1.0)
        qd2 = net.qd * scale
        after = evaluate(net, branch_out, bus_out, "ac", pg=pg2, pd=pd2, qd=qd2)
        best = (after, pg2, pd2)
        if not after["converged"]:
            break
        over = after["violations"]["overload"]
        if not over:
            break
        ld = {b["id"]: b["loading"] for b in after["branches"]}                 # tightens the branches the AC still flags
        for k, i in enumerate(bi):
            if i in over:
                margins[k] += (ld[i] - 1.0) + 0.003
    after, pg2, pd2 = best
    note = None
    if not after["converged"]:
        note = "the AC power flow does not converge with the plan applied: the plan could not be confirmed"
    elif after["violations"]["overload"]:
        note = f"best-effort plan: {len(after['violations']['overload'])} overload(s) remain that the model could not eliminate"
    return _pack(net, branch_out, bus_out, pre, post, after, pg1, pg2, net.pd, pd2, iterations, t0, note)


def _needs_action(ev: dict) -> bool:
    if not ev["converged"]:
        return True
    v = ev["violations"]
    return bool(v["overload"] or v["pgen"])


def _pack(net, branch_out, bus_out, pre, post, after, pg_before, pg_after, pd_before, pd_after, iterations, t0, note=None):
    """Builds the response: states (pre-fault, post-fault, with plan) and the plan (redispatch and shedding)."""
    shed = pd_before - pd_after
    shed_rows = [{"bus": int(net.bus_no[b]), "mw": round(float(shed[b]), 4), "pct": round(float(shed[b] / pd_before[b]), 5)}
                 for b in np.flatnonzero(shed > 1e-6)]
    gens_changed = np.flatnonzero(np.abs(pg_after - pg_before) > 0.05)
    redispatch = [{"gen": int(g), "bus": int(net.bus_no[net.gen_bus[g]]), "pgBefore": round(float(pg_before[g]), 3), "pgAfter": round(float(pg_after[g]), 3)}
                  for g in gens_changed]
    total_pd = float(net.pd.sum())
    bus_mask, _ = topology_masks(net, branch_out, bus_out)
    isolated = float(net.pd[~bus_mask].sum())
    shed_total = float(shed.sum())
    served = total_pd - isolated - shed_total
    return {
        "faults": {"branchOut": [int(b) for b in branch_out], "busOut": [int(b) for b in bus_out]},
        "needsAction": bool(shed_rows or redispatch or _needs_action(post)),
        "pre": pre, "postFault": post, "after": after,
        "plan": {"shed": sorted(shed_rows, key=lambda r: -r["mw"]), "redispatch": redispatch, "totalShedMW": round(shed_total, 4),
                 "totalRedispatchMW": round(float(np.abs(pg_after - pg_before).sum() / 2), 3), "iterations": int(iterations)},
        "summary": {"loadTotalMW": round(total_pd, 3), "isolatedMW": round(isolated, 3), "shedMW": round(shed_total, 3),
                    "servedMW": round(served, 3), "servedPct": round(served / total_pd, 5) if total_pd else 0.0,
                    "overloadsPost": len(post["violations"]["overload"]), "overloadsAfter": len(after["violations"]["overload"]),
                    "convergedAfter": bool(after["converged"]), "ms": round((time.perf_counter() - t0) * 1000, 1)},
        **({"note": note} if note else {}),
    }
