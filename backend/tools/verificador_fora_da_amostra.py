"""Held-out check of the plan-verifier threshold (IEEE 118).

In `genco_verifica_planos.py` the safe approval threshold of each method is the highest one (80 to 100 % of the line limit, in integer steps) at which
no insufficient plan is approved, chosen on ALL the 89 contingencies and then evaluated on the same ones. Here the threshold is chosen on some
contingencies and tested on others the choice never saw:
  - leave-one-contingency-out: the threshold is chosen on 88 contingencies and tested on the one left out (all 89 in turn);
  - random split: the threshold is chosen on half of the contingencies and tested on the other half (many random splits, fixed seed).
A plan is "insufficient" if the AC shows an overload (no plan and partial plan); approving one is the serious mistake. Plans with a margin are all
safe in the AC; approving them is what the verifier is for. The data are the per-state results already computed by the verification
(`interface/src/data/verificacao_planos_case118_ieee_autores.json`), so this runs without torch.

    python backend/tools/verificador_fora_da_amostra.py [--splits 2000] [--dst docs/escala/verificador_fora_da_amostra_case118_ieee.json]
"""
import argparse
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "interface" / "src" / "data" / "verificacao_planos_case118_ieee_autores.json"
TOL = 100.01                                  # an overload is above the limit plus 0.01 % (TOL_LOADING in backend/app/evaluate.py)
GRID = []                                   # candidate thresholds, filled by main(): integer steps (as in the verification) and steps of 0.1 point
MARGINS = ["folga0", "folga3", "folga5", "folga8", "folga10"]


def load():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    lines = d["lines"]
    data = {}
    for m in ("genco", "dc"):
        insuf = []                            # per contingency: estimates of the method on its insufficient states
        safe = {n: [] for n in MARGINS}       # per contingency: estimate on the plan with that margin
        for l in lines:
            insuf.append([l[v][m]["maxPct"] for v in ("semPlano", "parcial") if l[v]["ac"]["maxPct"] > TOL])
            for n in MARGINS:
                safe[n].append(l[n][m]["maxPct"])
        data[m] = (insuf, safe)
    return data, len(lines)


def pick(insuf, idx):
    """Highest threshold with no wrongful approval among the insufficient states of the contingencies idx (None if there is none)."""
    est = [x for i in idx for x in insuf[i]]
    ok = [t for t in GRID if not any(e <= t + 1e-9 for e in est)]
    return max(ok) if ok else GRID[0] - 1


def evaluate(insuf, safe, calib, test, shift=0):
    t = pick(insuf, calib) - shift
    wrong = sum(e <= t + 1e-9 for i in test for e in insuf[i])
    n_insuf = sum(len(insuf[i]) for i in test)
    appr = {n: sum(safe[n][i] <= t + 1e-9 for i in test) for n in MARGINS}
    return t, wrong, n_insuf, appr, len(test)


def summarize(rows):
    t = np.array([r[0] for r in rows], float)
    wrong = np.array([r[1] for r in rows], float)
    n_insuf = np.array([r[2] for r in rows], float)
    out = {"thresholdMean": round(float(t.mean()), 2), "thresholdMin": round(float(t.min()), 1), "thresholdMax": round(float(t.max()), 1),
           "thresholdP5": round(float(np.percentile(t, 5)), 1), "thresholdP95": round(float(np.percentile(t, 95)), 1),
           "wrongApprovalsTotal": int(wrong.sum()), "insufficientTested": int(n_insuf.sum()),
           "wrongApprovalRatePct": round(float(wrong.sum() / n_insuf.sum() * 100), 2),
           "shareOfSplitsWithWrongApproval": round(float((wrong > 0).mean()), 3), "safeApprovedPct": {}}
    for n in MARGINS:
        a = sum(r[3][n] for r in rows)
        tot = sum(r[4] for r in rows)
        out["safeApprovedPct"][n] = round(a / tot * 100, 1)
    return out


def other_networks(thresholds):
    """The thresholds fixed on the IEEE 118 (integer steps), applied without refitting to the other networks' verification results
    (authors' checkpoint of each network). Few insufficient plans on the small networks: read the counts, not the rates."""
    out = {}
    for case in ("14", "30", "57"):
        d = json.loads((ROOT / "interface" / "src" / "data" / f"verificacao_planos_case{case}_ieee_autores.json").read_text(encoding="utf-8"))
        lines = d["lines"]
        out[case] = {"contingencies": len(lines)}
        for m, t in thresholds.items():
            insuf = [l[v][m]["maxPct"] for l in lines for v in ("semPlano", "parcial") if l[v]["ac"]["maxPct"] > TOL]
            out[case][m] = {"frozenThresholdPct": t, "insufficientPlans": len(insuf),
                            "approvedByMistakeAtFrozenThreshold": sum(e <= t for e in insuf),
                            "approvedByMistakeAt100": sum(e <= 100 for e in insuf),
                            "safePlansApproved": {n: sum(l[n][m]["maxPct"] <= t for l in lines) for n in MARGINS}}
    return out


def main(splits, dst):
    global GRID
    data, n = load()
    res = {"contingencies": n, "splits": splits, "seed": 0, "steps": {}}
    for step_name, step in (("integer", 1.0), ("tenth", 0.1)):
        GRID = [round(80 + i * step, 1) for i in range(int(round(20 / step)) + 1)]
        rng = np.random.default_rng(0)
        r_step = {}
        for m in ("genco", "dc"):
            insuf, safe = data[m]
            full = pick(insuf, range(n))
            r_step[m] = {"thresholdOnAllData": full}
            for shift in (0, 1):                   # 1 = one extra point of safety under the chosen threshold
                tag = "" if shift == 0 else "MinusOnePoint"
                loo = [evaluate(insuf, safe, [j for j in range(n) if j != i], [i], shift) for i in range(n)]
                r_step[m]["leaveOneOut" + tag] = summarize(loo)
                rs = []
                for _ in range(splits):
                    p = rng.permutation(n)
                    rs.append(evaluate(insuf, safe, p[: n // 2], p[n // 2:], shift))
                r_step[m]["half" + tag] = summarize(rs)
        res["steps"][step_name] = r_step
    res["otherNetworks"] = other_networks({m: res["steps"]["integer"][m]["thresholdOnAllData"] for m in ("genco", "dc")})
    Path(dst).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print("##### thresholds fixed on the IEEE 118, applied to other networks")
    for case, r in res["otherNetworks"].items():
        for m in ("genco", "dc"):
            x = r[m]
            print(f"  IEEE {case} {m.upper()} T={x['frozenThresholdPct']}%: insufficient {x['insufficientPlans']}, approved by mistake {x['approvedByMistakeAtFrozenThreshold']} (at 100%: {x['approvedByMistakeAt100']}); safe approved {x['safePlansApproved']} of {r['contingencies']}")
    for step_name, r_step in res["steps"].items():
        print(f"##### thresholds in {step_name} steps")
        for m in ("genco", "dc"):
            r = r_step[m]
            print(f"== {m.upper()} (threshold on all the data: {r['thresholdOnAllData']}%)")
            for k in ("leaveOneOut", "half", "leaveOneOutMinusOnePoint", "halfMinusOnePoint"):
                s_ = r[k]
                print(f"  {k:26s} T mean {s_['thresholdMean']:5.1f} [p5 {s_['thresholdP5']}, p95 {s_['thresholdP95']}, min {s_['thresholdMin']}]  wrong approvals {s_['wrongApprovalsTotal']}/{s_['insufficientTested']} "
                      f"({s_['wrongApprovalRatePct']}%), splits with a mistake {s_['shareOfSplitsWithWrongApproval']*100:.1f}%  safe approved: "
                      + " ".join(f"{n_[5:]}:{v}%" for n_, v in s_["safeApprovedPct"].items()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--splits", type=int, default=2000)
    ap.add_argument("--dst", default=str(ROOT / "docs" / "escala" / "verificador_fora_da_amostra_case118_ieee.json"))
    a = ap.parse_args()
    main(a.splits, a.dst)
