"""Voltage correction: adjustment of the generators' reference voltage (Vg) in a loop with the power plan.

The corrective plan (`corrective.plan_corrective`) handles only active power and thermal limits; the voltage stays as it came from the base case and often ends up outside the
range after shedding load. This module adds the Vg adjustment:

  1. power plan as today;
  2. a PROVIDER chooses the voltage of each generator for the state of that plan (in the project, GENCO-OPF, offline; see backend/tools/genco_tensao.py);
  3. the voltage enters the network and the power plan is REDONE (the LP uses the AC reactive powers, which changed) and checked by the AC;
  4. repeats until there is no voltage violation or overload (at most `max_loops` rounds).

The loop result is only adopted if it is better than the original plan (fewer voltage violations plus overloads). The `pre` and `postFault` states of the response remain those of
the network with the ORIGINAL voltage (the adjustment is an action of the plan, after the fault). The module depends on neither torch nor GENCO: the provider is any function
`provider(net_with_vg, branch_out, bus_out, plan_response) -> Vg vector per generator (or None)`.
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from .corrective import plan_corrective
from .evaluate import TOL_VOLTAGE
from .network import Network

VG_TOL = 1e-4          # a Vg change below this does not count as an adjustment


def voltage_stats(ev: dict, net: Network) -> dict:
    """Counts for the AC state `ev` (evaluate output): buses outside the voltage range and the largest excess (pu), overloads and generators outside the reactive limit."""
    if not ev.get("converged"):
        return {"converge": False, "violations": 0, "maxExcessPu": 0.0, "overloads": 0, "qgen": 0}
    bmap = {b["id"]: b["vm"] for b in ev["buses"]}
    lim = {int(net.bus_no[i]): (net.vmin[i], net.vmax[i]) for i in range(net.nb)}
    exc = [max(bmap[n] - lim[n][1], lim[n][0] - bmap[n]) for n in bmap if bmap[n] > lim[n][1] + TOL_VOLTAGE or bmap[n] < lim[n][0] - TOL_VOLTAGE]
    return {"converge": True, "violations": len(exc), "maxExcessPu": round(float(max(exc, default=0.0)), 4),
            "overloads": len(ev["violations"]["overload"]), "qgen": len(ev["violations"]["qgen"])}


def vg_changes(net_before: Network, net_after: Network, tol: float = VG_TOL) -> list[dict]:
    """In-service generators whose reference voltage changed: [{gen, bus, vgBefore, vgAfter}]."""
    out = []
    for g in range(len(net_before.gen_bus)):
        if net_before.gen_on[g] and abs(net_after.gen_vg[g] - net_before.gen_vg[g]) > tol:
            out.append({"gen": int(g), "bus": int(net_before.bus_no[net_before.gen_bus[g]]),
                        "vgBefore": round(float(net_before.gen_vg[g]), 4), "vgAfter": round(float(net_after.gen_vg[g]), 4)})
    return out


def _custo(s: dict) -> tuple:
    return (s["violations"] + s["overloads"], s["violations"])


def plan_with_voltage(net: Network, branch_out=(), bus_out=(), provider=None, model: str = "", max_loops: int = 3, **plan_kwargs) -> dict:
    """Corrective plan with generator voltage adjustment. Without a provider, or without a voltage violation in the original plan, it returns the original plan (without the `voltage` field).

    With a violation: returns the plan response with a `voltage` field:
      { model, applied, loops, violationsBefore, violationsAfter, maxExcessBeforePu, maxExcessAfterPu, qgenBefore, qgenAfter,
        overloadsAfter, shedBeforeMW, shedAfterMW, gens: [{gen, bus, vgBefore, vgAfter}] }
    `applied` is false when the loop did not improve the original plan (then the response is the original).
    """
    r0 = plan_corrective(net, branch_out, bus_out, **plan_kwargs)
    if provider is None:
        return r0
    s0 = voltage_stats(r0["after"], net)
    if not s0["converge"] or s0["violations"] == 0:
        return r0

    r, net_k = r0, net
    best = None                                   # (cost, response, network, stats, round)
    loops = 0
    for loops in range(1, max_loops + 1):
        vg = provider(net_k, branch_out, bus_out, r)
        if vg is None:
            break
        net_k = replace(net, gen_vg=np.asarray(vg, dtype=float))
        r = plan_corrective(net_k, branch_out, bus_out, **plan_kwargs)
        s = voltage_stats(r["after"], net)
        if s["converge"] and (best is None or _custo(s) < best[0]):
            best = (_custo(s), r, net_k, s, loops)
        if s["converge"] and s["violations"] == 0 and s["overloads"] == 0:
            break

    base = {"model": model, "loops": loops, "violationsBefore": s0["violations"], "maxExcessBeforePu": s0["maxExcessPu"], "qgenBefore": s0["qgen"],
            "shedBeforeMW": r0["plan"]["totalShedMW"]}
    if best is None or best[0] >= _custo({**s0, "overloads": r0["summary"]["overloadsAfter"]}):
        return {**r0, "voltage": {**base, "applied": False, "violationsAfter": s0["violations"], "maxExcessAfterPu": s0["maxExcessPu"], "qgenAfter": s0["qgen"],
                                  "overloadsAfter": r0["summary"]["overloadsAfter"], "shedAfterMW": r0["plan"]["totalShedMW"], "gens": []}}
    _, rb, net_b, sb, volta = best
    out = dict(rb)
    out["pre"], out["postFault"] = r0["pre"], r0["postFault"]                       # the fault and the previous state are those of the network with the original voltage
    out["summary"] = {**rb["summary"], "overloadsPost": r0["summary"]["overloadsPost"]}
    out["voltage"] = {**base, "applied": True, "loops": volta, "violationsAfter": sb["violations"], "maxExcessAfterPu": sb["maxExcessPu"], "qgenAfter": sb["qgen"],
                      "overloadsAfter": sb["overloads"], "shedAfterMW": rb["plan"]["totalShedMW"], "gens": vg_changes(net, net_b)}
    return out
