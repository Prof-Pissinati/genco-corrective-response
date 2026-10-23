"""Corrective response: redispatch + minimum load shedding, verified by the AC."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.corrective import plan_corrective, proportional_redispatch
from app.evaluate import evaluate
from app.main import app
from app.network import load_case, topology_masks
from pathlib import Path

CASE118 = Path(__file__).resolve().parents[2] / "interface" / "src" / "data" / "case118_ieee.json"
client = TestClient(app)


@pytest.fixture(scope="module")
def net():
    return load_case(CASE118)


def test_no_faults_nothing_to_do(net):
    r = plan_corrective(net, [], [])
    assert not r["needsAction"] and r["plan"]["shed"] == [] and r["plan"]["redispatch"] == []
    assert r["summary"]["servedPct"] == 1.0


def test_line_7_requires_shedding_and_the_plan_solves_it_by_the_AC(net):
    """Losing line 7 overloads the network even after the automatic redispatch: the plan sheds load and the AC confirms no overload."""
    r = plan_corrective(net, [7], [])
    s = r["summary"]
    assert r["needsAction"] and s["overloadsPost"] > 0
    assert r["after"]["converged"] and s["overloadsAfter"] == 0
    assert 50 < s["shedMW"] < 300                                    # ~148 MW (3.5% of the 4242 MW load)
    assert abs(s["servedMW"] - (s["loadTotalMW"] - s["isolatedMW"] - s["shedMW"])) < 0.01
    assert all(0 < x["pct"] <= 1.0 for x in r["plan"]["shed"])


def test_the_shedding_is_minimal_there_is_no_room_to_shed_less(net):
    """If the plan shed much less than computed, the AC would flag an overload: the shedding is not overly conservative."""
    r = plan_corrective(net, [7], [])
    shed = {x["bus"]: x["mw"] for x in r["plan"]["shed"]}
    pd = net.pd.copy()
    qd = net.qd.copy()
    pg = net.gen_pg.copy()
    for g in r["plan"]["redispatch"]:
        pg[g["gen"]] = g["pgAfter"]
    for bus, mw in shed.items():
        i = int(net.bus_index([bus])[0])
        f = (pd[i] - 0.5 * mw) / pd[i]                             # sheds only half of what the plan shed
        pd[i] *= f
        qd[i] *= f
    meio = evaluate(net, [7], [], "ac", pg=pg, pd=pd, qd=qd)
    assert len(meio["violations"]["overload"]) > 0


def test_redispatch_only_when_it_suffices(net):
    """There are contingencies where simply redistributing the generation solves it (without shedding load)."""
    achou = False
    for i in range(0, net.nl, 4):
        r = plan_corrective(net, [i], [])
        if r["needsAction"] and r["plan"]["totalShedMW"] == 0:
            assert r["summary"]["overloadsAfter"] == 0 and r["plan"]["redispatch"]
            achou = True
            break
    assert achou


@pytest.mark.parametrize("faults", [([3], []), ([37], []), ([6, 40], []), ([], [8]), ([], [26]), ([20], [68]), ([], [100])])
def test_properties_across_several_contingencies(net, faults):
    """In each case: converges, no overload at the end, generation within Pmax/Pmin and the load served never exceeds the available one."""
    r = plan_corrective(net, faults[0], faults[1])
    s = r["summary"]
    assert s["convergedAfter"] and s["overloadsAfter"] == 0
    assert r["after"]["violations"]["pgen"] == []
    assert s["servedMW"] <= s["loadTotalMW"] - s["isolatedMW"] + 1e-6
    assert s["shedMW"] >= 0 and all(x["mw"] >= 0 for x in r["plan"]["shed"])


def test_faulted_reference_energizes_nothing(net):
    r = plan_corrective(net, [], [int(net.bus_no[net.ref])])
    assert r["summary"]["servedMW"] == 0 and "reference" in r["note"]


def test_proportional_redispatch_respects_limits_and_closes_the_balance(net):
    bm, brm = topology_masks(net, [], [100])                         # perde 653 MW de capacidade
    pg = proportional_redispatch(net, bm, brm)
    on = np.flatnonzero(net.gen_on & bm[net.gen_bus])
    # tolerance of 1e-3 MW: the OPF itself (Ipopt) leaves generators ~5e-6 MW above Pmax
    assert np.all(pg[on] <= net.gen_pmax[on] + 1e-3) and np.all(pg[on] >= net.gen_pmin[on] - 1e-3)
    assert pg[on].sum() > net.gen_pg[on].sum()                       # the remaining generation goes up to cover the lost one


def test_api_corrective():
    r = client.post("/corrective", json={"grid": "case118_ieee", "faults": {"branchOut": [7]}})
    assert r.status_code == 200
    d = r.json()
    assert d["needsAction"] and d["summary"]["overloadsAfter"] == 0 and d["plan"]["shed"]
    assert {"pre", "postFault", "after", "plan", "summary", "faults"} <= set(d)
    assert client.post("/corrective", json={"grid": "case118_ieee", "faults": {"branchOut": [999]}}).status_code == 422
    assert client.post("/corrective", json={"grid": "nao_existe"}).status_code == 404
    assert client.get("/health").json()["version"] == "0.5.0"


def test_n1_screening_counts_the_contingencies_and_sorts_by_severity(net):
    from app.screening import screen
    r = screen(net, "both")
    assert r["count"] == 186 + 117 and r["needAction"] + r["noAction"] == r["count"]
    assert 200 <= r["needAction"] <= 220                              # 210 no caso corrigido (IEEE 118)
    cs = r["contingencies"]
    assert all(c["converged"] for c in cs)
    assert all(c["needsAction"] for c in cs[:r["needAction"]]) and not any(c["needsAction"] for c in cs[r["needAction"]:])
    assert cs[0]["overloads"] >= cs[r["needAction"] - 1]["overloads"]
    # line 7 (buses 8-5) is one of those that require shedding: it must appear among those needing action
    assert any(c["type"] == "line" and c["id"] == 7 and c["needsAction"] for c in cs)


def test_api_screen_by_scope():
    d = client.post("/screen", json={"grid": "case118_ieee", "scope": "lines"}).json()
    assert d["count"] == 186 and all(c["type"] == "line" for c in d["contingencies"])
    assert client.post("/screen", json={"grid": "nao_existe"}).status_code == 404


def test_block_reconnection_ends_restored_and_never_sheds_more_than_the_plan(net):
    from app.recovery import recover
    r = recover(net, [("line", 7)], block_mw=50.0)
    ev = r["events"]
    assert [e["kind"] for e in ev][:2] == ["plan", "repair"] and all(e["kind"] == "reconnect" for e in ev[2:])
    assert r["summary"]["restored"] and ev[-1]["unservedMW"] < 0.5 and ev[-1]["overloads"] == 0
    assert abs(ev[0]["unservedMW"] - 148.0) < 1.0                       # the initial plan is the minimum shedding of line 7
    assert all(e["block"]["mw"] <= 50.0 + 1e-6 for e in ev if e["kind"] == "reconnect")
    served = [e["servedMW"] for e in ev[1:]]
    assert served == sorted(served)                                      # the reconnection only increases the load served
    assert all(e["converged"] for e in ev)
    t = [e["tHours"] for e in ev]
    assert t == sorted(t) and abs(r["summary"]["ensMWh"] - sum((t[i + 1] - t[i]) * ev[i]["unservedMW"] for i in range(len(ev) - 1))) < 0.1


def test_reconnection_with_two_faults_and_repair_order(net):
    from app.recovery import recover
    a = recover(net, [("line", 7), ("bus", 68)])
    b = recover(net, [("bus", 68), ("line", 7)])
    for r in (a, b):
        assert r["summary"]["restored"] and [e["kind"] for e in r["events"]].count("repair") == 2
    assert a["events"][0]["unservedMW"] == b["events"][0]["unservedMW"]           # the initial plan does not depend on the order
    assert a["summary"]["ensMWh"] != b["summary"]["ensMWh"]                       # the repair order changes the energy not supplied


def test_api_recovery():
    body = {"grid": "case118_ieee", "faults": {"branchOut": [7]}, "options": {"blockMW": 100}}
    r = client.post("/recovery", json=body)
    assert r.status_code == 200
    d = r.json()
    assert d["summary"]["restored"] and d["events"][0]["kind"] == "plan" and d["repairOrder"][0]["label"] == "line 8–5"
    ok = {"grid": "case118_ieee", "faults": {"branchOut": [7], "busOut": [68]}}
    assert client.post("/recovery", json={**ok, "repairOrder": [{"type": "bus", "id": 68}, {"type": "line", "id": 7}]}).status_code == 200
    assert client.post("/recovery", json={**ok, "repairOrder": [{"type": "line", "id": 7}]}).status_code == 422
    assert client.post("/recovery", json={"grid": "case118_ieee"}).status_code == 422
    assert client.post("/recovery", json={"grid": "case118_ieee", "faults": {"branchOut": [999]}}).status_code == 422


def test_parallel_lines_carry_the_circuit_letter(net):
    """IEEE 118 has 7 pairs of parallel lines; each circuit appears as A or B in the results."""
    nomes = [net.line_name(k) for k in range(net.nl)]
    com_letra = [n for n in nomes if n[-2:] in (" A", " B")]
    assert len(com_letra) == 14
    assert net.line_name(74) == "49–54 A" and net.line_name(75) == "49–54 B"
    assert net.line_name(7) == "8–5"                                           # no parallel: no letter
    from app.screening import screen
    labels = {c["label"] for c in screen(net, "lines")["contingencies"]}
    assert {"line 49–54 A", "line 49–54 B", "line 8–5"} <= labels
    from app.recovery import recover
    r = recover(net, [("line", 75)])
    assert r["repairOrder"][0]["label"] == "line 49–54 B"
    assert "Repair: line 49–54 B" in [e["label"] for e in r["events"]]

