#!/usr/bin/env bash
# Runs the scale study (backend/tools/genco_escala.py) on the seven networks, in sequence, in the GENCO environment.
# Prerequisites per network: case in JSON (export_case.py), PGLib case (.m), PowerModels dispatch (opf_powermodels.py) and the checkpoint in models/.
# Optional variables: DEVICE=cuda (GENCO on the GPU; the AC stays on CPU), DST=<output folder> (default docs/escala).
# Usage (repository root):  bash backend/tools/rodar_estudo_escala.sh <python of the GENCO environment> <folder of cases and dispatches>
#   <folder> must have casos/case{500,2000,10000}_goc.json and opf_case{14,30,57,500_goc,2000_goc,10000_goc}.json; for the 118 it uses interface/src/data and the opf given in OPF118.
PY="${1:?informe o python do ambiente do GENCO}"
D="${2:?give the folder of cases and dispatches}"
OPF118="${OPF118:-$D/opf_case118.json}"
export PYTHONIOENCODING=utf-8
DATA=interface/src/data
run() {  # rede json m modelo opf n lote
    echo "=================== $1"
    "$PY" -u backend/tools/genco_escala.py --rede "$1" --json "$2" --m "$3" --modelo "$4" --referencia "$5" --n "$6" --lote "$7" --device "${DEVICE:-cpu}" --dst "${DST:-docs/escala}/$1.json" 2>&1 | grep -v "Warning\|assert (bus"
}
mkdir -p "${DST:-docs/escala}"
run case14_ieee  $DATA/case14_ieee.json  $DATA/pglib_opf_case14_ieee.m  models/case14_genco_tiny_autores  "$D/opf_case14.json"  60 16
run case30_ieee  $DATA/case30_ieee.json  $DATA/pglib_opf_case30_ieee.m  models/case30_genco_tiny_autores  "$D/opf_case30.json"  60 16
run case57_ieee  $DATA/case57_ieee.json  $DATA/pglib_opf_case57_ieee.m  models/case57_genco_tiny_autores  "$D/opf_case57.json"  60 16
run case118_ieee $DATA/case118_ieee.json $DATA/pglib_opf_case118_ieee.m models/case118_genco_tiny_autores "$OPF118"            60 16
run case500_goc  "$D/casos/case500_goc.json"   $DATA/pglib_opf_case500_goc.m   models/case500_goc_genco_tiny_autores   "$D/opf_case500_goc.json"   60 16
run case2000_goc "$D/casos/case2000_goc.json"  $DATA/pglib_opf_case2000_goc.m  models/case2000_goc_genco_tiny_autores  "$D/opf_case2000_goc.json"  30 8
run case10000_goc "$D/casos/case10000_goc.json" $DATA/pglib_opf_case10000_goc.m models/case10000_goc_genco_tiny_autores "$D/opf_case10000_goc.json" 12 4
echo FIM
