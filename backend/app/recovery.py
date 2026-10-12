"""Reparo e religação da carga por blocos (Fase 4b).

Dado o conjunto de falhas e a ORDEM em que são reparadas, monta a linha do tempo:
  plano inicial (redespacho + corte mínimo) -> reparo 1 -> religação da carga cortada em blocos (cada bloco verificado pelo AC)
  -> reparo 2 -> ... -> rede restaurada.

A cada reparo o plano é recalculado para as falhas que restam (`plan_corrective`); a carga que o novo plano permite atender é religada
em blocos de, no máximo, `block_mw` MW, escolhendo a cada passo o bloco que deixa a rede menos carregada (menos sobrecargas, menor carregamento
máximo). Os tempos de reparo e de manobra são dados de entrada (sintéticos), usados só para calcular a energia não suprida (ENS).
"""
from __future__ import annotations

import math
import time
import numpy as np

from .corrective import plan_corrective
from .evaluate import evaluate
from .network import Network, topology_masks

MIN_MW = 0.01       # abaixo disto a diferença de carga é ignorada


def _split(items):
    return [k for t, k in items if t == "line"], [n for t, n in items if t == "bus"]


def _label(net: Network, item) -> str:
    t, k = item
    return f"linha {int(net.bus_no[net.br_f[k]])}–{int(net.bus_no[net.br_t[k]])}" if t == "line" else f"barra {int(k)}"


def _targets(net: Network, plan: dict, bo, bu):
    """Carga a atender (MW por barra; zero nas ilhas) e despacho do plano `plan`."""
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
    """Estado intermediário: despacho do plano (otimizado para os limites) e carga parcial; a barra de referência absorve a diferença.
    (Testei redistribuir esse desbalanço pelos geradores: piorou, pois desfaz o redespacho do plano.)"""
    return evaluate(net, bo, bu, "ac", pg=pg_plan, pd=pd, qd=_qd(net, pd))


def _score(ev):
    loads = [b["loading"] for b in ev["branches"]]
    return (not ev["converged"], len(ev["violations"]["overload"]), max(loads) if loads else 0.0)


def recover(net: Network, repairs, block_mw: float = 50.0, repair_hours: float = 2.0, block_minutes: float = 10.0) -> dict:
    """`repairs`: lista [("line", índice) | ("bus", número)] na ordem de reparo (todas as falhas)."""
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
    add("plan", "Plano inicial (redespacho e corte mínimo)", plan["after"], cur, bo, bu, t)

    for k, item in enumerate(repairs):
        bo, bu = _split(repairs[k + 1:])
        t += repair_hours
        # estado logo após o reparo: topologia nova, carga e despacho ainda os do plano anterior
        ev = _state(net, bo, bu, pg, cur)
        add("repair", f"Reparo: {_label(net, item)}", ev, cur, bo, bu, t)

        plan = plan_corrective(net, bo, bu)
        tgt, pg = _targets(net, plan, bo, bu)
        less = np.minimum(cur, tgt)
        if (cur - less).max() > MIN_MW:                                        # o novo plano pede menos carga em alguma barra
            cur = less
            ev = _state(net, bo, bu, pg, cur)
            add("cut", "Ajuste do plano (corte adicional)", ev, cur, bo, bu, t)

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
            add("reconnect", f"Religa {mw:.1f} MW na barra {int(net.bus_no[b])}", ev, cur, bo, bu, t, {"block": {"bus": int(net.bus_no[b]), "mw": round(mw, 3)}})

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
