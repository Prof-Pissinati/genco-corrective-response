"""Base dispatch by PowerModels AC-OPF (the same engine gridfm-datakit uses), with thermal (rate_a) and voltage limits.

Writes, for the given case, the dispatch (MW per generator, in the order of the `gen` table) and the bus voltages/angles of the optimal point.
Needs the GENCO environment (gridfm-datakit + Julia/PowerModels via juliacall), not the lightweight backend environment.

Uso (ambiente do GENCO):
    python backend/tools/opf_powermodels.py <pglib_opf_case118_ieee.m> opf_pm.json
Then:
    python backend/tools/export_case.py <caso.m> interface/src/data/case118_ieee.json --dispatch opf_pm.json --ref interface/tests/case118_dc_ref.json
"""
import json
import sys
from pathlib import Path

import gridfm_datakit  # noqa: F401  (inicializa o ambiente Julia do datakit)
from juliacall import Main as jl

if len(sys.argv) != 3:
    sys.exit(__doc__)
caso = Path(sys.argv[1]).resolve().as_posix()          # Julia: forward slashes, never "\"
saida = Path(sys.argv[2])

jl.seval("using PowerModels, Ipopt")
jl.seval("PowerModels.silence()")
res = jl.seval(f'PowerModels.solve_ac_opf("{caso}", Ipopt.Optimizer)')
status = str(res["termination_status"])
if status != "LOCALLY_SOLVED":
    sys.exit(f"AC-OPF did not converge: {status}")

gens = res["solution"]["gen"]
ngen = len(jl.seval(f'PowerModels.parse_file("{caso}")')["gen"])                 # generators in the case table (includes the out-of-service ones, which the solution does not list)
pg = [float(gens[str(i)]["pg"]) * 100.0 if str(i) in gens else 0.0 for i in range(1, ngen + 1)]      # pu -> MW (baseMVA = 100); out-of-service generator = 0
bus = dict(res["solution"]["bus"])
saida.write_text(json.dumps({
    "status": status, "objetivo": float(res["objective"]), "pg": pg,
    "vm": {int(k): float(v["vm"]) for k, v in bus.items()}, "va": {int(k): float(v["va"]) for k, v in bus.items()},
}), encoding="utf-8")
print(f"{saida}: {status}, objective {float(res['objective']):.2f}, {len(pg)} generators, generation {sum(pg):.2f} MW")
