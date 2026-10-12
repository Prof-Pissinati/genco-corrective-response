"""Despacho base por AC-OPF do PowerModels (o mesmo motor que o gridfm-datakit usa), com limites térmicos (rate_a) e de tensão.

Grava, para o caso informado, o despacho (MW por gerador, na ordem da tabela `gen`) e as tensões/ângulos das barras do ponto ótimo.
Precisa do ambiente do GENCO (gridfm-datakit + Julia/PowerModels via juliacall), não do ambiente leve do backend.

Uso (ambiente do GENCO):
    python backend/tools/opf_powermodels.py <pglib_opf_case118_ieee.m> opf_pm.json
Depois:
    python backend/tools/export_case.py <caso.m> interface/src/data/case118_ieee.json --dispatch opf_pm.json --ref interface/tests/case118_dc_ref.json
"""
import json
import sys
from pathlib import Path

import gridfm_datakit  # noqa: F401  (inicializa o ambiente Julia do datakit)
from juliacall import Main as jl

if len(sys.argv) != 3:
    sys.exit(__doc__)
caso = Path(sys.argv[1]).resolve().as_posix()          # Julia: barras normais, nunca "\"
saida = Path(sys.argv[2])

jl.seval("using PowerModels, Ipopt")
jl.seval("PowerModels.silence()")
res = jl.seval(f'PowerModels.solve_ac_opf("{caso}", Ipopt.Optimizer)')
status = str(res["termination_status"])
if status != "LOCALLY_SOLVED":
    sys.exit(f"AC-OPF não convergiu: {status}")

gens = res["solution"]["gen"]
pg = [float(gens[str(i)]["pg"]) * 100.0 for i in range(1, len(gens) + 1)]      # pu -> MW (baseMVA = 100)
bus = dict(res["solution"]["bus"])
saida.write_text(json.dumps({
    "status": status, "objetivo": float(res["objective"]), "pg": pg,
    "vm": {int(k): float(v["vm"]) for k, v in bus.items()}, "va": {int(k): float(v["va"]) for k, v in bus.items()},
}), encoding="utf-8")
print(f"{saida}: {status}, objetivo {float(res['objective']):.2f}, {len(pg)} geradores, geração {sum(pg):.2f} MW")
