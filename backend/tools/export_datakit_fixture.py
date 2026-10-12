"""Exporta cenários do gridfm-datakit (PowerModels = solução AC de referência) como um JSON pequeno para os testes do backend.

Cada cenário traz as ENTRADAS (cargas, despacho, tensões dos geradores, admitâncias já perturbadas, ramos fora de serviço)
e a SOLUÇÃO de referência (Vm, Va, fluxos por ramo). Assim os testes comparam o nosso AC com o do PowerModels sem Julia/Parquet.

Uso (ambiente do GENCO, que tem pandas/pyarrow), a partir da raiz do repositório:
    python backend/tools/export_datakit_fixture.py <pasta .../case118_ieee/raw> backend/tests/fixtures/datakit_case118.json
Índices de barra/ramo/gerador seguem o datakit: a partir de 0 (barra = número MATPOWER - 1).
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
print(f"{out}: {len(scenarios)} cenários, {out.stat().st_size / 1024:.0f} KB")
