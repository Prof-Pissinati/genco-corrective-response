"""N-1 screening ("risk map"): for each line and each bus, the post-fault state with the automatic generation response
(redistribution using the headroom) and what it requires, computed by the AC. The full plan (redispatch + shedding) is requested per contingency in /corrective."""
from __future__ import annotations

import time

import numpy as np

from .corrective import _needs_action, proportional_redispatch
from .evaluate import evaluate
from .network import Network, topology_masks


def screen(net: Network, scope: str = "both") -> dict:
    """Returns the single contingencies sorted by severity (highest post-fault loading)."""
    t0 = time.perf_counter()
    ref_no = int(net.bus_no[net.ref])
    cases = []
    if scope in ("both", "lines"):
        cases += [("line", k, f"line {net.line_name(k)}", [k], []) for k in range(net.nl) if net.br_on[k]]
    if scope in ("both", "buses"):
        cases += [("bus", int(n), f"bus {int(n)}", [], [int(n)]) for n in net.bus_no if int(n) != ref_no]
    rows = []
    for kind, ident, label, bo, bu in cases:
        bm, brm = topology_masks(net, bo, bu)
        pg = proportional_redispatch(net, bm, brm)
        ev = evaluate(net, bo, bu, "ac", pg=pg)
        loadings = [b["loading"] for b in ev["branches"]]
        rows.append({
            "type": kind, "id": ident, "label": label, "converged": ev["converged"],
            "overloads": len(ev["violations"]["overload"]), "voltage": len(ev["violations"]["voltage"]),
            "maxLoadingPct": round(max(loadings) * 100, 1) if loadings else 0.0,
            "isolatedMW": round(float(net.pd[~bm].sum() - (net.pd[net.bus_index(bu)].sum() if bu else 0.0)), 2),
            "needsAction": bool(_needs_action(ev)),
        })
    rows.sort(key=lambda r: (not r["needsAction"], -r["overloads"], -r["maxLoadingPct"]))
    return {
        "grid": net.name, "count": len(rows), "needAction": sum(r["needsAction"] for r in rows),
        "noAction": sum(not r["needsAction"] for r in rows), "ms": round((time.perf_counter() - t0) * 1000, 1), "contingencies": rows,
    }
