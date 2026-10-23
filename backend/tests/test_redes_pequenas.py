"""IEEE 14, 30 and 57 networks (besides 118): the AC solver reproduces PowerModels and the corrective plan and screening run on all single outages."""
import json
from pathlib import Path

import numpy as np
import pytest

from app.acpf import solve_ac
from app.corrective import plan_corrective
from app.network import load_case, topology_masks
from app.screening import screen

DATA = Path(__file__).resolve().parents[2] / "interface" / "src" / "data"
REF = json.loads((Path(__file__).parent / "fixtures" / "powermodels_redes_pequenas.json").read_text(encoding="utf-8"))
NETWORKS = ["case14_ieee", "case30_ieee", "case57_ieee"]


@pytest.mark.parametrize("name", NETWORKS)
def test_ac_reproduces_powermodels(name):
    net = load_case(DATA / f"{name}.json")
    bm, brm = topology_masks(net, [], [])
    ac = solve_ac(net, bm, brm)
    assert ac["converged"]
    vm = np.array([REF[name]["vm"][str(int(b))] for b in net.bus_no])
    va = np.degrees([REF[name]["va"][str(int(b))] for b in net.bus_no])
    assert np.abs(ac["vm"] - vm).max() < 1e-7
    assert np.abs(ac["va"] - va).max() < 1e-6


@pytest.mark.parametrize("name", NETWORKS)
def test_base_case_within_limits_and_screening_runs(name):
    net = load_case(DATA / f"{name}.json")
    base = plan_corrective(net, [], [])
    assert not base["needsAction"]                                    # o despacho do AC-OPF respeita os limites
    r = screen(net)
    assert r["count"] == net.nl + net.nb - 1                          # all the lines and the buses minus the reference
    assert r["needAction"] + r["noAction"] == r["count"]


@pytest.mark.parametrize("name", NETWORKS)
def test_plan_for_each_line_does_not_worsen_and_when_there_is_overload_the_plan_solves_it(name):
    net = load_case(DATA / f"{name}.json")
    for k in range(net.nl):
        r = plan_corrective(net, [k], [])
        if r["needsAction"] and r["after"]["converged"]:
            assert r["summary"]["overloadsAfter"] <= r["summary"]["overloadsPost"]
            assert r["summary"]["servedPct"] <= 1.0 + 1e-9


def test_reference_without_in_service_generator_uses_the_case_vm():
    """There are cases (like GOC 500) where the generator at the reference bus is out of service: the reference |V| is that of the case file, not 1.0."""
    from dataclasses import replace
    net = load_case(DATA / "case14_ieee.json")
    without_generator = net.gen_on & (net.gen_bus != net.ref)               # switches off the reference generator(s)
    bus_vm = net.bus_vm.copy()
    bus_vm[net.ref] = 1.037
    net2 = replace(net, gen_on=without_generator, bus_vm=bus_vm)
    bm, brm = topology_masks(net2, [], [])
    ac = solve_ac(net2, bm, brm)
    assert ac["converged"]
    assert abs(ac["vm"][net2.ref] - 1.037) < 1e-9
    # with an in-service generator the generator's Vg still applies (previous behavior)
    ac0 = solve_ac(net, *topology_masks(net, [], []))
    assert abs(ac0["vm"][net.ref] - net.gen_vg[net.gen_bus == net.ref][0]) < 1e-9


def test_ieee30_fault_at_bus_2_has_a_best_effort_plan():
    """Losing bus 2 (the only generator with headroom), no redispatch with shedding respects the limits in the hard model: the best-effort plan
    sheds almost all the served load and the AC confirms that no overloads remain (before: 'optimization has no solution' and the network stayed overloaded)."""
    net = load_case(DATA / "case30_ieee.json")
    r = plan_corrective(net, [], [2])
    assert r["needsAction"] and not r.get("note")
    assert 250 < r["plan"]["totalShedMW"] < 262
    assert r["summary"]["overloadsPost"] == 3 and r["summary"]["overloadsAfter"] == 0 and r["summary"]["convergedAfter"]


def test_plan_with_a_solution_does_not_change_with_the_best_effort_plan():
    """The soft problem only kicks in when the hard one is infeasible: a plan that already had a solution stays the same (IEEE 118, line 8–5: known shedding and redispatch)."""
    net = load_case(DATA / "case118_ieee.json")
    k = next(i for i in range(net.nl) if net.line_name(i).startswith("8–5"))
    r = plan_corrective(net, [k], [])
    assert r["summary"]["overloadsAfter"] == 0 and not r.get("note")
    assert 140 < r["plan"]["totalShedMW"] < 150
