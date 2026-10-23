"""Generates the data of the interface STATIC REPLAY (version for the jury, no backend): precomputed results for IEEE 118.

Content of `interface/src/data/replay_<network>.json` (default: case118_ieee; use --case for the others):
  base       AC state of the case without faults (same in all analyses; stored once)
  screen     complete N-1 screening (303 contingencies)
  corrective corrective response (post-fault and with plan) of each chosen contingency
  recovery   repair and block-reconnection timeline of those that require shedding and of two combined scenarios
The keys follow `interface/src/solver/replay.js` (function `faultKey` / `recoveryKey`).

Usage (from the repository root, in the backend Python):
    python backend/tools/export_replay.py [--case case118_ieee] [--top 25]

With `--voltage-genco <OPF checkpoint folder>` the plans that end with voltage out of range go through the GENCO-OPF Vg adjustment (app/voltage.py + tools/genco_tensao.py)
and carry the `voltage` block. This option needs torch and gridfm-graphkit (GENCO environment); the rest runs in the backend Python:
    python backend/tools/export_replay.py --case case118_ieee --voltage-genco models/case118_genco_opf_small_autores
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.evaluate import evaluate               # noqa: E402
from app.network import load_case               # noqa: E402
from app.recovery import recover                # noqa: E402
from app.screening import screen                # noqa: E402
from app.voltage import plan_with_voltage       # noqa: E402

DATA = ROOT / "interface" / "src" / "data"
DEMOS_118 = [  # combined demo scenarios for IEEE 118 (lines by branch index; buses by number)
    {"branchOut": [7], "busOut": [68]},
    {"branchOut": [7, 29], "busOut": [8]},
]


def demos_para(scr) -> list:
    """Combined scenarios for the other networks: the two most severe lines together and the most severe line with the most severe bus (if they exist)."""
    lines = [c["id"] for c in scr["contingencies"] if c["type"] == "line" and c["needsAction"]]
    buses = [c["id"] for c in scr["contingencies"] if c["type"] == "bus" and c["needsAction"]]
    out = []
    if len(lines) >= 2:
        out.append({"branchOut": sorted(lines[:2]), "busOut": []})
    if lines and buses:
        out.append({"branchOut": [lines[0]], "busOut": [buses[0]]})
    return out


def fault_key(branch_out, bus_out) -> str:
    return "c:" + ",".join(str(x) for x in sorted(branch_out)) + "|" + ",".join(str(x) for x in sorted(bus_out))


def recovery_key(order) -> str:
    return "r:" + ",".join(f"{t}{i}" for t, i in order)


def compact(ev: dict) -> dict:
    """Only what the interface uses, with fewer decimal places."""
    r = lambda x, n: round(float(x), n)       # noqa: E731
    return {
        "solver": ev["solver"], "converged": ev["converged"], "ms": r(ev["ms"], 1), "energized": ev["energized"], "lostBuses": ev["lostBuses"],
        "servedMW": r(ev["servedMW"], 3), "lostMW": r(ev["lostMW"], 3),
        "buses": [{"id": b["id"], "vm": r(b["vm"], 6), "va": r(b["va"], 3)} for b in ev["buses"]],
        "branches": [{"id": b["id"], "pf": r(b["pf"], 3), "qf": r(b["qf"], 3), "pt": r(b["pt"], 3), "qt": r(b["qt"], 3), "loading": r(b["loading"], 4)} for b in ev["branches"]],
        "gens": [{"id": g["id"], "bus": g["bus"], "pg": r(g["pg"], 3), "qg": r(g["qg"], 3)} for g in ev["gens"]],
        "violations": ev["violations"],
    }


def pack_corrective(resp: dict) -> dict:
    out = {k: v for k, v in resp.items() if k not in ("pre", "postFault", "after")}
    out["postFault"] = compact(resp["postFault"])
    out["after"] = compact(resp["after"])               # `pre` = base (preenchido na leitura)
    return out


def pack_recovery(resp: dict) -> dict:
    out = dict(resp)
    out["events"] = [{**e, "state": compact(e["state"])} for e in resp["events"]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=25, help="how many of the most severe contingencies (besides those that require shedding) get a corrective response")
    ap.add_argument("--case", default="case118_ieee", help="network: case14_ieee, case30_ieee, case57_ieee or case118_ieee")
    ap.add_argument("--voltage-genco", default=None, help="GENCO-OPF checkpoint folder: adjusts the generator voltage in plans with voltage out of range")
    ap.add_argument("--pesos", default="last.pt", help="weights file inside the --voltage-genco folder")
    args = ap.parse_args()
    t0 = time.perf_counter()
    CASE, OUT = DATA / f"{args.case}.json", DATA / f"replay_{args.case}.json"
    net = load_case(CASE)
    scr = screen(net, "both")
    provedor, nome_modelo = None, ""
    if args.voltage_genco:
        sys.path.insert(0, str(ROOT / "backend" / "tools"))
        from genco_tensao import make_vg_provider           # noqa: E402  (importa torch)
        from genco_screening import gencost_from_m          # noqa: E402
        provedor = make_vg_provider(Path(args.voltage_genco), gencost_from_m(DATA / f"pglib_opf_{args.case}.m"), pesos=args.pesos)
        nome_modelo = f"{Path(args.voltage_genco).name}/{args.pesos}"
    plano = lambda bo, bu: plan_with_voltage(net, bo, bu, provedor, model=nome_modelo)      # noqa: E731
    print(f"screening: {scr['count']} contingencies, {scr['needAction']} need a plan ({scr['ms'] / 1000:.1f} s)")

    need = [c for c in scr["contingencies"] if c["needsAction"]]
    plans, chosen = {}, []
    for c in need:                                                        # plan for all those that require action: separates those that shed load
        bo, bu = ([c["id"]], []) if c["type"] == "line" else ([], [c["id"]])
        plans[(c["type"], c["id"])] = plano(bo, bu)
    shed = [c for c in need if plans[(c["type"], c["id"])]["plan"]["totalShedMW"] > 0.05]
    rest = [c for c in need if c not in shed][: args.top]
    chosen = shed + rest
    print(f"chosen: {len(shed)} with shedding + {len(rest)} most severe")

    corrective, recovery = {}, {}
    for c in chosen:
        bo, bu = ([c["id"]], []) if c["type"] == "line" else ([], [c["id"]])
        corrective[fault_key(bo, bu)] = pack_corrective(plans[(c["type"], c["id"])])
    for c in shed:
        order = [(c["type"], c["id"])]
        recovery[recovery_key(order)] = pack_recovery(recover(net, order))
    for d in (DEMOS_118 if args.case == "case118_ieee" else demos_para(scr)):
        order = [("line", k) for k in d["branchOut"]] + [("bus", n) for n in d["busOut"]]
        corrective[fault_key(d["branchOut"], d["busOut"])] = pack_corrective(plano(d["branchOut"], d["busOut"]))
        recovery[recovery_key(order)] = pack_recovery(recover(net, order))

    key_has = lambda c: fault_key(*(([c["id"]], []) if c["type"] == "line" else ([], [c["id"]]))) in corrective        # noqa: E731
    for c in scr["contingencies"]:
        c["hasPlan"] = bool(key_has(c))
        c["hasRecovery"] = recovery_key([(c["type"], c["id"])]) in recovery
    data = {
        "version": 1, "case": net.name, "note": "results precomputed by the backend (AC); generated by backend/tools/export_replay.py",
        "base": compact(evaluate(net, [], [], "ac")), "screen": scr, "corrective": corrective, "recovery": recovery,
    }
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} KB ({len(corrective)} corrective responses, {len(recovery)} reconnections) in {time.perf_counter() - t0:.0f} s")


if __name__ == "__main__":
    main()
