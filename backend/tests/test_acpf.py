"""AC: against PowerModels (gridfm-datakit) and against pandapower; DC: against the reference used in the interface tests."""
import json
from pathlib import Path

import numpy as np
import pytest

from app.acpf import solve_ac, solve_dc
from app.network import load_case, topology_masks
from tests.helpers import load_datakit_scenarios, network_from_scenario

ROOT = Path(__file__).resolve().parents[2]
CASE118 = ROOT / "interface" / "src" / "data" / "case118_ieee.json"


@pytest.mark.parametrize("sc", load_datakit_scenarios()["scenarios"], ids=lambda s: f"datakit_{s['scenario']}")
def test_ac_matches_powermodels(sc):
    """6 datakit scenarios (perturbed loads/dispatch/admittances, 0 to 7 lines out): backend AC = PowerModels AC."""
    net = network_from_scenario(sc)
    bus_mask, br_mask = topology_masks(net)
    r = solve_ac(net, bus_mask, br_mask)
    assert r["converged"]
    vm = np.array([b["vm"] for b in sc["bus"]])
    va = np.array([b["va"] for b in sc["bus"]])
    va = va - va[net.ref]
    assert np.max(np.abs(r["vm"] - vm)) < 1e-8
    assert np.max(np.abs(r["va"] - va)) < 1e-6
    on = np.array([k["on"] for k in sc["branch"]]) > 0
    for campo in ("pf", "qf", "pt", "qt"):
        ref = np.array([k[campo] for k in sc["branch"]])
        assert np.max(np.abs(r[campo] - ref)[on]) < 1e-5, campo
        assert np.all(r[campo][~on] == 0)


def test_ac_matches_pandapower_on_the_base_case():
    """Cross-validation: backend AC voltages = pandapower.runpp on IEEE 118 (PGLib with the AC-OPF dispatch)."""
    pp = pytest.importorskip("pandapower")
    from pandapower.converter.pypower.from_ppc import from_ppc

    d = json.loads(CASE118.read_text(encoding="utf-8"))
    ppc = {"version": "2", "baseMVA": d["baseMVA"], "bus": np.array(d["bus"], float), "gen": np.array(d["gen"], float),
           "branch": np.array(d["branch"], float)}
    net = from_ppc(ppc, f_hz=60, validate_conversion=False)
    pp.runpp(net, numba=False)
    net_b = load_case(CASE118)
    bus_mask, br_mask = topology_masks(net_b)
    r = solve_ac(net_b, bus_mask, br_mask)
    assert r["converged"]
    vm_pp = net.res_bus.vm_pu.reindex(net_b.bus_no).to_numpy()          # pandapower bus index = MATPOWER number
    assert np.max(np.abs(r["vm"] - vm_pp)) < 1e-6
    assert abs(r["pg"][np.flatnonzero(net_b.gen_bus == net_b.ref)].sum() - net.res_ext_grid.p_mw.sum()) < 1e-3   # reference bus


def test_dc_matches_the_interface_reference():
    """The backend DC flows = independent reference that validates the interface JS solver (10 cases)."""
    ref = json.loads((ROOT / "interface" / "tests" / "case118_dc_ref.json").read_text(encoding="utf-8"))
    net = load_case(CASE118)
    for c in ref["cases"]:
        bus_mask, br_mask = topology_masks(net, c["outBranches"], c["outBuses"])
        r = solve_dc(net, bus_mask, br_mask)
        assert sorted(int(n) for n in net.bus_no[bus_mask]) == c["energized"], c["name"]
        assert np.max(np.abs(r["pf"] - np.array(c["flows"]))) < 1e-6, c["name"]
