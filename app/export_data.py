"""Exporta um dataset do gridfm-datakit (parquet) para app/data.json, lido pelo painel (app/index.html).

Uso (a partir da raiz do repositório):
    python app/export_data.py data/est118/case118_ieee/raw app/data.json

Por cenário guarda, para cada linha: fluxo AC (MVA), fluxo DC (MW) e estado (1 = ligada, 0 = desligada).
Com um terceiro argumento (parquet de previsões do `gridfm_graphkit evaluate --save_output`, colunas
`scenario, bus, Vm_pred, Va_pred`), o painel passa a mostrar só os cenários de teste (que o modelo nunca viu) e
calcula o fluxo previsto de cada linha pelas admitâncias (validado: com as tensões reais reproduz o AC com erro < 0,01 MW):
    python app/export_data.py data/case118/case118_ieee/raw app/data.json <.../test/case118_ieee_predictions.parquet>
Alternativamente, uma coluna `pf_genco` no branch_data também é aceita. Sem GENCO, o painel mostra "–".
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
    # Previsões do GENCO (tabela por barra: Vm_pred, Va_pred em rad). Só existem para o conjunto de teste.
    pred = pd.read_parquet(pred_file).sort_values(["scenario", "bus"])
    br = br[br.scenario.isin(pred.scenario.unique())]


def genco_flows(sid, d):
    """Fluxo aparente (MVA) em cada linha a partir das tensões previstas, com as admitâncias do branch_data."""
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
print(f"{out}: {len(buses)} barras, {len(lines)} linhas, {len(scenarios)} cenários, GENCO={'sim' if has_genco else 'não'}")
