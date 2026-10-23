"""Exports gridfm-datakit scenarios (PowerModels = reference AC solution) as a small JSON for the backend tests.

Each scenario carries the INPUTS (loads, dispatch, generator voltages, already perturbed admittances, branches out of service)
and the reference SOLUTION (Vm, Va, flows per branch). This way the tests compare our AC with PowerModels' without Julia/Parquet.

Usage (GENCO environment, which has pandas/pyarrow), from the repository root:
    python backend/tools/export_datakit_fixture.py <pasta .../case118_ieee/raw> backend/tests/fixtures/datakit_case118.json
Bus/branch/generator indices follow the datakit: from 0 (bus = MATPOWER number - 1).
"""
import json
import sys
from pathlib import Path

import pandas as pd

if len(sys.argv) != 3:
    sys.exit(__doc__)

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
bus = pd.read_parquet(raw / "bus_data.parquet")
gen = pd.read_parquet(raw / "gen_data.parquet")
br = pd.read_parquet(raw / "branch_data.parquet")

scenarios = []
for sid in sorted(bus.scenario.unique()):
    b = bus[bus.scenario == sid].sort_values("bus")
    g = gen[gen.scenario == sid].sort_values("idx")
    k = br[br.scenario == sid].sort_values("idx")
    scenarios.append({
        "scenario": int(sid),
        "bus": [{"i": int(r.bus), "type": 3 if r.REF == 1 else (2 if r.PV == 1 else 1), "pd": float(r.Pd), "qd": float(r.Qd),
                 "gs": float(r.GS), "bs": float(r.BS), "vm": float(r.Vm), "va": float(r.Va)} for r in b.itertuples()],
        "gen": [{"bus": int(r.bus), "pg": float(r.p_mw), "qg": float(r.q_mvar), "qmin": float(r.min_q_mvar), "qmax": float(r.max_q_mvar),
                 "on": int(r.in_service), "slack": int(r.is_slack_gen)} for r in g.itertuples()],
        "branch": [{"from": int(r.from_bus), "to": int(r.to_bus), "r": float(r.r), "x": float(r.x), "b": float(r.b),
                    "tap": float(r.tap), "shift": float(r.shift), "on": int(r.br_status), "rate": float(r.rate_a),
                    "pf": float(r.pf), "qf": float(r.qf), "pt": float(r.pt), "qt": float(r.qt)} for r in k.itertuples()],
    })

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"baseMVA": 100.0, "scenarios": scenarios}, separators=(",", ":")), encoding="utf-8")
print(f"{out}: {len(scenarios)} scenarios, {out.stat().st_size / 1024:.0f} KB")
