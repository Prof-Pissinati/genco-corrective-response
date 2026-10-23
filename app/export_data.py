"""Exports a gridfm-datakit dataset (parquet) to app/data.json, read by the panel (app/index.html).

Usage (from the repository root):
    python app/export_data.py data/est118/case118_ieee/raw app/data.json

Per scenario it stores, for each line: AC flow (MVA), DC flow (MW) and state (1 = connected, 0 = disconnected).
With a third argument (predictions parquet from `gridfm_graphkit evaluate --save_output`, columns
`scenario, bus, Vm_pred, Va_pred`), the panel shows only the test scenarios (which the model never saw) and
computes the predicted flow of each line from the admittances (validated: with the real voltages it reproduces the AC with error < 0.01 MW):
    python app/export_data.py data/case118/case118_ieee/raw app/data.json <.../test/case118_ieee_predictions.parquet>
Alternatively, a `pf_genco` column in branch_data is also accepted. Without GENCO, the panel shows "–".
"""
import json
import math
import sys
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

if len(sys.argv) not in (3, 4):
    sys.exit(__doc__)

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
pred_file = Path(sys.argv[3]) if len(sys.argv) == 4 else None
bus = pd.read_parquet(raw / "bus_data.parquet")
br = pd.read_parquet(raw / "branch_data.parquet")
rt = pd.read_parquet(raw / "runtime_data.parquet").set_index("scenario")

first = br[br.scenario == br.scenario.min()].sort_values("idx")
lines = [
    {"id": int(r.idx), "from": int(r.from_bus), "to": int(r.to_bus), "rate": float(r.rate_a)}
    for r in first.itertuples()
]

g = nx.Graph()
g.add_edges_from((l["from"], l["to"]) for l in lines)
pos = nx.kamada_kawai_layout(g)
buses = [{"id": int(b), "x": float(pos[b][0]), "y": float(pos[b][1])} for b in sorted(g.nodes)]

BASE_MVA = 100.0
pred = None
if pred_file is not None:
    # GENCO predictions (per-bus table: Vm_pred, Va_pred in rad). They only exist for the test set.
    pred = pd.read_parquet(pred_file).sort_values(["scenario", "bus"])
    br = br[br.scenario.isin(pred.scenario.unique())]


def genco_flows(sid, d):
    """Apparent flow (MVA) on each line from the predicted voltages, with the branch_data admittances."""
    b = pred[pred.scenario == sid]
    v = b.Vm_pred.to_numpy() * np.exp(1j * b.Va_pred.to_numpy())
    f, t = d.from_bus.to_numpy(), d.to_bus.to_numpy()
    cur = (d.Yff_r.to_numpy() + 1j * d.Yff_i.to_numpy()) * v[f] + (d.Yft_r.to_numpy() + 1j * d.Yft_i.to_numpy()) * v[t]
    return np.abs(v[f] * np.conj(cur)) * BASE_MVA * (d.br_status.to_numpy() == 1)


has_genco = pred is not None or "pf_genco" in br.columns
scenarios = []
for sid, d in br.groupby("scenario"):
    d = d.sort_values("idx")
    status = d.br_status.astype(int).tolist()
    ac = [round(math.hypot(p, q), 3) for p, q in zip(d.pf, d.qf)]
    sc = {
        "id": int(sid),
        "out": [int(i) for i, s in zip(d.idx, status) if s == 0],
        "ac": ac,
        "dc": [round(abs(x), 3) for x in d.pf_dc],
        "ac_ms": round(float(rt.loc[sid, "ac"]) * 1000, 3),
        "dc_ms": round(float(rt.loc[sid, "dc"]) * 1000, 3),
    }
    if pred is not None:
        sc["genco"] = [round(float(x), 3) for x in genco_flows(sid, d)]
    elif has_genco:
        sc["genco"] = [round(abs(x), 3) for x in d.pf_genco]
    scenarios.append(sc)

timing_file = Path(__file__).with_name("inference_time.json")
timing = json.loads(timing_file.read_text(encoding="utf-8")) if timing_file.exists() and has_genco else None

data = {
    "network": raw.parent.name,
    "timing": timing,
    "buses": buses,
    "lines": lines,
    "scenarios": scenarios,
    "genco_available": has_genco,
}
out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
print(f"{out}: {len(buses)} buses, {len(lines)} lines, {len(scenarios)} scenarios, GENCO={'yes' if has_genco else 'no'}")
