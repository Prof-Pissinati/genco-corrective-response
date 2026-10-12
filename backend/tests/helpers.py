"""Utilitários dos testes: monta a rede do backend a partir dos cenários do datakit (PowerModels = referência AC)."""
import json
from pathlib import Path

from app.network import from_mpc

FIXTURES = Path(__file__).parent / "fixtures"


def load_datakit_scenarios():
    return json.loads((FIXTURES / "datakit_case118.json").read_text(encoding="utf-8"))


def network_from_scenario(sc, base_mva=100.0):
    """Entradas do cenário (cargas, despacho, tensão dos geradores, admitâncias perturbadas, ramos fora) -> Network."""
    vm_of = {b["i"]: b["vm"] for b in sc["bus"]}
    # o datakit guarda GS/BS em pu; a tabela MATPOWER usa MW/MVAr a 1 pu
    bus = [[b["i"] + 1, b["type"], b["pd"], b["qd"], b["gs"] * base_mva, b["bs"] * base_mva, 1, 1.0, 0.0, 138.0, 1, 1.06, 0.94] for b in sc["bus"]]
    gen = [[g["bus"] + 1, g["pg"], g["qg"], g["qmax"], g["qmin"], vm_of[g["bus"]], 100.0, g["on"], max(g["pg"], 0) + 1.0, 0.0]
           for g in sc["gen"]]
    branch = [[k["from"] + 1, k["to"] + 1, k["r"], k["x"], k["b"], k["rate"], k["rate"], k["rate"], k["tap"], k["shift"], k["on"], -360, 360]
              for k in sc["branch"]]
    return from_mpc({"baseMVA": base_mva, "bus": bus, "gen": gen, "branch": branch}, name=f"datakit_{sc['scenario']}", rebalance=False)
