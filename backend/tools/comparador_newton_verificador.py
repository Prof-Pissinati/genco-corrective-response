"""Classical comparator for the plan verifier: Newton–Raphson steps from the pre-outage AC solution, used as the verifier instead of GENCO (IEEE 118).

Same 89 contingencies and 623 states as `genco_verifica_planos.py` (no plan, partial plan and plans with a 0 to 10 point margin, all with the line out), rebuilt here;
for each state, 1 and 2 Newton steps from the base-case point (without iterating to convergence) estimate the maximum line loading, and that estimate is judged like the
GENCO and DC estimates: the highest approval threshold (80 to 100 %, integer steps) at which no insufficient plan is approved, how many insufficient plans a 100 %
threshold approves by mistake, and how many safe plans (with a margin) are approved. The ground truth is the converged AC.

Runs in the GENCO environment (it reuses the state builder of the verification; torch is not used), from the repository root, about 2 minutes:
    python backend/tools/comparador_newton_verificador.py [--dst docs/escala/newton_verificador_case118_ieee.json]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
sys.path.insert(0, str(ROOT / "tools"))
from app.corrective import plan_corrective, proportional_redispatch      # noqa: E402
from app.network import load_case, topology_masks                         # noqa: E402
import genco_screening as gs                                              # noqa: E402
from genco_verifica_planos import FOLGAS, carga_ac, estado, estado_do_plano   # noqa: E402
from comparador_newton_um_passo import loading, newton_steps               # noqa: E402

TOL = 100.01


def main(dst, steps=2):
    net = load_case(gs.CASE_JSON)
    rate = net.br_rate
    rows = {}                                                              # contingency -> variant -> {"ac":, 1:, 2:}
    for k in range(net.nl):
        if not net.br_on[k]:
            continue
        bm, brm0 = topology_masks(net, [k], [])
        if not bm.all():
            continue
        base = plan_corrective(net, [k], [])
        if not base["needsAction"]:
            continue
        pg1 = proportional_redispatch(net, bm, brm0)
        planos = {f: (base if f == 0.0 else plan_corrective(net, [k], [], margin=f)) for f in FOLGAS}
        s0 = estado_do_plano(net, bm, brm0, k, planos[0.0])
        variantes = [("semPlano", (pg1, net.pd, net.qd)), ("parcial", tuple(a + 0.5 * (b - a) for a, b in zip((pg1, net.pd, net.qd), s0)))]
        variantes += [(f"folga{int(round(f * 100))}", estado_do_plano(net, bm, brm0, k, planos[f])) for f in FOLGAS]
        for nome, (pg, pd_, qd) in variantes:
            n2, brm, ac, dc = estado(net, [k], pg, pd_, qd)
            if not ac["converged"]:
                continue
            on = brm & (rate > 0)
            la = carga_ac(ac, rate, brm)
            Vs, _, parts = newton_steps(n2, brm, steps)
            r = {"ac": round(float(la.max() * 100), 2)}              # rounded to 0.01 point like the verification JSON, so the counts are comparable
            for j, V in enumerate(Vs, 1):
                r[j] = round(float(loading(n2, V, parts)[on].max() * 100), 2)
            rows.setdefault(k, {})[nome] = r
        print("contingency", k, flush=True) if len(rows) % 20 == 0 else None
    names = ["semPlano", "parcial"] + [f"folga{int(round(f * 100))}" for f in FOLGAS]
    states = [(c, v, r) for c, d in rows.items() for v, r in d.items()]
    insuf = [(c, v, r) for c, v, r in states if v in ("semPlano", "parcial") and r["ac"] > TOL]
    res = {"contingencies": len(rows), "states": len(states), "insufficientPlans": len(insuf), "methods": {}}
    for j in range(1, steps + 1):
        wrong100 = sum(r[j] <= 100 for _, _, r in insuf)
        ok = [t for t in range(80, 101) if not any(r[j] <= t for _, _, r in insuf)]
        T = max(ok) if ok else None
        safe = {n: int(sum(d[n][j] <= T for d in rows.values() if n in d)) if T else 0 for n in names[2:]}
        err = np.array([abs(r[j] - r["ac"]) for _, _, r in states])
        res["methods"][f"newton_{j}_step"] = {"approvedByMistakeAt100": int(wrong100), "highestThresholdWithNoMistake": T, "safePlansApprovedAtThatThreshold": safe,
                                              "maxLoadingErrorMedian": round(float(np.median(err)), 3), "maxLoadingErrorP90": round(float(np.percentile(err, 90)), 3),
                                              "maxLoadingErrorMax": round(float(err.max()), 3)}
    Path(dst).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dst", default=str(ROOT / "docs" / "escala" / "newton_verificador_case118_ieee.json"))
    main(ap.parse_args().dst)
