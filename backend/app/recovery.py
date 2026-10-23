"""Repair and block-by-block load reconnection (Phase 4b).

Given the set of faults and the ORDER in which they are repaired, builds the timeline:
  initial plan (redispatch + minimum shedding) -> repair 1 -> reconnection of the shed load in blocks (each block verified by the AC)
  -> repair 2 -> ... -> restored network.

After each repair the plan is recomputed for the remaining faults (`plan_corrective`); the load that the new plan allows serving is reconnected
in blocks of at most `block_mw` MW, choosing at each step the block that leaves the network least loaded (fewest overloads, lowest maximum
loading). The repair and switching times are input data (synthetic), used only to compute the energy not supplied (ENS).
"""
from __future__ import annotations

import math
import time
import numpy as np

from .corrective import plan_corrective
from .evaluate import evaluate
from .network import Network, topology_masks

MIN_MW = 0.01       # below this the load difference is ignored


def _split(items):
    return [k for t, k in items if t == "line"], [n for t, n in items if t == "bus"]


def _label(net: Network, item) -> str:
    t, k = item
    return f"line {net.line_name(k)}" if t == "line" else f"bus {int(k)}"


def _targets(net: Network, plan: dict, bo, bu):
    """Load to serve (MW per bus; zero in the islands) and dispatch of plan `plan`."""
    pd = net.pd.copy()
    for s in plan["plan"]["shed"]:
        pd[net.bus_index([s["bus"]])[0]] -= s["mw"]
    bus_mask, _ = topology_masks(net, bo, bu)
    pg = net.gen_pg.copy()
    for g in plan["after"].get("gens", []):
        pg[g["id"]] = g["pg"]
    return np.where(bus_mask, pd, 0.0), pg


def _qd(net: Network, pd):
    return net.qd * np.where(net.pd > 1e-9, pd / np.where(net.pd > 1e-9, net.pd, 1.0), 1.0)


def _state(net: Network, bo, bu, pg_plan, pd):
    """Intermediate state: dispatch of the plan (optimized for the limits) and partial load; the reference bus absorbs the difference.
    (I tried redistributing this imbalance among the generators: it got worse, because it undoes the plan's redispatch.)"""
    return evaluate(net, bo, bu, "ac", pg=pg_plan, pd=pd, qd=_qd(net, pd))


def _score(ev):
    loads = [b["loading"] for b in ev["branches"]]
    return (not ev["converged"], len(ev["violations"]["overload"]), max(loads) if loads else 0.0)


def recover(net: Network, repairs, block_mw: float = 50.0, repair_hours: float = 2.0, block_minutes: float = 10.0) -> dict:
    """`repairs`: list [("line", index) | ("bus", number)] in repair order (all the faults)."""
    t0 = time.perf_counter()
    total_pd = float(net.pd.sum())
    events: list[dict] = []
    t = 0.0

    def add(kind, label, ev, cur, bo, bu, t_now, extra=None):
        bus_mask, _ = topology_masks(net, bo, bu)
        shed = [{"bus": int(net.bus_no[b]), "mw": round(float(net.pd[b] - cur[b]), 3), "pct": round(float((net.pd[b] - cur[b]) / net.pd[b]), 5)}
                for b in np.flatnonzero(bus_mask & (net.pd - cur > MIN_MW))]
        loads = [b["loading"] for b in ev["branches"]]
        served = float(cur[bus_mask].sum())
        events.append({
            "i": len(events), "kind": kind, "label": label, "tHours": round(t_now, 4),
            "remaining": {"branchOut": [int(x) for x in bo], "busOut": [int(x) for x in bu]},
            "shed": shed, "servedMW": round(served, 3), "unservedMW": round(total_pd - served, 3),
            "overloads": len(ev["violations"]["overload"]), "converged": bool(ev["converged"]),
            "maxLoadingPct": round(max(loads) * 100, 1) if loads else 0.0, "state": ev, **(extra or {}),
        })

    bo, bu = _split(repairs)
    plan = plan_corrective(net, bo, bu)
    cur, pg = _targets(net, plan, bo, bu)
    add("plan", "Initial plan (redispatch and minimum shedding)", plan["after"], cur, bo, bu, t)

    for k, item in enumerate(repairs):
        bo, bu = _split(repairs[k + 1:])
        t += repair_hours
        # state right after the repair: new topology, load and dispatch still those of the previous plan
        ev = _state(net, bo, bu, pg, cur)
        add("repair", f"Repair: {_label(net, item)}", ev, cur, bo, bu, t)

        plan = plan_corrective(net, bo, bu)
        tgt, pg = _targets(net, plan, bo, bu)
        less = np.minimum(cur, tgt)
        if (cur - less).max() > MIN_MW:                                        # the new plan asks for less load at some bus
            cur = less
            ev = _state(net, bo, bu, pg, cur)
            add("cut", "Plan adjustment (additional shedding)", ev, cur, bo, bu, t)

        pending = {}
        for b in np.flatnonzero(tgt - cur > MIN_MW):
            amt = float(tgt[b] - cur[b])
            n = max(1, math.ceil(amt / block_mw - 1e-9))
            pending[int(b)] = [amt / n] * n
        while pending:
            best = None
            for b, chunks in pending.items():
                cand = cur.copy()
                cand[b] += chunks[0]
                ev = _state(net, bo, bu, pg, cand)
                sc = _score(ev)
                if best is None or sc < best[0]:
                    best = (sc, b, cand, ev)
            _, b, cur, ev = best
            mw = pending[b].pop(0)
            if not pending[b]:
                del pending[b]
            t += block_minutes / 60.0
            add("reconnect", f"Reconnects {mw:.1f} MW at bus {int(net.bus_no[b])}", ev, cur, bo, bu, t, {"block": {"bus": int(net.bus_no[b]), "mw": round(mw, 3)}})

    ens = sum((events[i + 1]["tHours"] - events[i]["tHours"]) * events[i]["unservedMW"] for i in range(len(events) - 1))
    blocks = [e for e in events if e["kind"] == "reconnect"]
    return {
        "repairOrder": [{"type": t_, "id": int(k_), "label": _label(net, (t_, k_))} for t_, k_ in repairs],
        "options": {"blockMW": block_mw, "repairHours": repair_hours, "blockMinutes": block_minutes},
        "events": events,
        "summary": {
            "loadTotalMW": round(total_pd, 3), "ensMWh": round(float(ens), 2), "totalHours": events[-1]["tHours"],
            "initialShedMW": round(events[0]["unservedMW"], 3), "finalUnservedMW": events[-1]["unservedMW"],
            "blocks": len(blocks), "blocksWithOverload": sum(1 for e in blocks if e["overloads"] > 0),
            "eventsWithOverload": sum(1 for e in events if e["overloads"] > 0),
            "restored": bool(events[-1]["unservedMW"] < 0.5 and events[-1]["converged"] and events[-1]["overloads"] == 0),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        },
    }
