"""Generator voltage adjustment in a loop with the power plan (fake Vg provider: GENCO-OPF only runs offline)."""
from pathlib import Path

import numpy as np
import pytest

from app.corrective import plan_corrective
from app.network import load_case
from app.voltage import plan_with_voltage, vg_changes, voltage_stats

CASE118 = Path(__file__).resolve().parents[2] / "interface" / "src" / "data" / "case118_ieee.json"


@pytest.fixture(scope="module")
def net():
    return load_case(CASE118)


def sem_tempo(x):
    """AC state without the `ms` field (computation time, varies from one run to another)."""
    return {k: v for k, v in x.items() if k != "ms"}


def baixa(delta):
    return lambda n, bo, bu, r: n.gen_vg - delta


def test_without_provider_or_without_violation_returns_the_original_plan(net):
    assert "voltage" not in plan_with_voltage(net, [7], [], None)
    chamadas = []
    r = plan_with_voltage(net, [100], [], lambda *a: chamadas.append(1))      # line 100: the plan ends with no voltage out of range
    assert "voltage" not in r and not chamadas


def test_vg_adjustment_clears_the_voltage_violation_and_the_ac_confirms(net):
    r0 = plan_corrective(net, [7], [])
    assert voltage_stats(r0["after"], net)["violations"] == 1
    r = plan_with_voltage(net, [7], [], baixa(0.02), model="falso")
    v = r["voltage"]
    assert v["applied"] and v["model"] == "falso" and v["loops"] == 1
    assert v["violationsBefore"] == 1 and v["violationsAfter"] == 0 and v["overloadsAfter"] == 0
    assert v["maxExcessBeforePu"] > 0.01 and v["maxExcessAfterPu"] == 0.0
    assert r["after"]["converged"] and r["summary"]["overloadsAfter"] == 0
    assert voltage_stats(r["after"], net)["violations"] == 0                  # checked again, outside the module
    assert len(v["gens"]) > 0 and all(abs(g["vgAfter"] - g["vgBefore"]) > 1e-4 for g in v["gens"])
    assert {g["gen"] for g in v["gens"]} <= set(np.flatnonzero(net.gen_on))


def test_pre_and_post_fault_stay_those_of_the_original_voltage(net):
    r0 = plan_corrective(net, [7], [])
    r = plan_with_voltage(net, [7], [], baixa(0.02))
    assert sem_tempo(r["pre"]) == sem_tempo(r0["pre"]) and sem_tempo(r["postFault"]) == sem_tempo(r0["postFault"])
    assert r["summary"]["overloadsPost"] == r0["summary"]["overloadsPost"] > 0
    assert set(r) >= set(r0) and r["needsAction"] == r0["needsAction"]


def test_if_the_adjustment_worsens_it_keeps_the_original_plan(net):
    r0 = plan_corrective(net, [7], [])
    r = plan_with_voltage(net, [7], [], lambda n, bo, bu, r: n.gen_vg + 0.03)
    v = r["voltage"]
    assert not v["applied"] and v["gens"] == [] and v["violationsAfter"] == v["violationsBefore"]
    assert r["plan"] == r0["plan"] and sem_tempo(r["after"]) == sem_tempo(r0["after"])


def test_provider_without_response_does_not_break_the_plan(net):
    r = plan_with_voltage(net, [7], [], lambda *a: None)
    assert not r["voltage"]["applied"] and r["after"]["converged"]


def test_vg_changes_ignores_out_of_service_generators_and_minimal_changes(net):
    from dataclasses import replace
    vg = net.gen_vg.copy()
    vg[0] += 0.01
    vg[1] += 1e-6
    ch = vg_changes(net, replace(net, gen_vg=vg))
    assert [c["gen"] for c in ch] == [0] and ch[0]["bus"] == int(net.bus_no[net.gen_bus[0]])
