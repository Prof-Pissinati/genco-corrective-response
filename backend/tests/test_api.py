"""Topology/islands, evaluation and API (FastAPI TestClient)."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.evaluate import evaluate
from app.main import app
from app.network import load_case

ROOT = Path(__file__).resolve().parents[2]
CASE118 = ROOT / "interface" / "src" / "data" / "case118_ieee.json"
client = TestClient(app)


@pytest.fixture(scope="module")
def net():
    return load_case(CASE118)


def test_base_case_ac_converges_and_serves_all_the_load(net):
    r = evaluate(net, [], [], "ac")
    assert r["converged"] and r["lostMW"] == 0 and abs(r["servedMW"] - 4242.0) < 1e-6
    assert len(r["energized"]) == 118 and len(r["branches"]) == 186
    gen_total = sum(g["pg"] for g in r["gens"])
    assert 4242.0 < gen_total < 4242.0 * 1.06                       # perdas AC positivas e pequenas
    # the dispatch comes from the PowerModels AC-OPF (rateA and voltages respected): the base case has NO violations
    assert all(v == [] for v in r["violations"].values())        # overload, voltage, generator Q and P
    assert max(b["loading"] for b in r["branches"]) <= 1.0 + 1e-4


def test_faults_81_and_100_lose_339_MW_as_in_the_interface(net):
    """Same value shown by the interface (and checked in the browser): 339.0 MW lost and 106 buses energized."""
    for solver in ("ac", "dc"):
        r = evaluate(net, [], [81, 100], solver)
        assert r["converged"]
        assert abs(r["lostMW"] - 339.0) < 1e-6
        assert len(r["energized"]) == 106
        assert 81 not in r["energized"] and 100 not in r["energized"]


def test_faulted_reference_bus_energizes_nothing(net):
    r = evaluate(net, [], [69], "ac")
    assert r["energized"] == [] and abs(r["lostMW"] - 4242.0) < 1e-6


def test_branch_out_zeroes_the_flow_and_the_loading_excludes_the_branch(net):
    r = evaluate(net, [7], [], "ac")
    assert 7 not in [b["id"] for b in r["branches"]]
    assert len(r["branches"]) == 185


def test_ac_loading_uses_the_larger_end_over_rateA(net):
    r = evaluate(net, [], [], "ac")
    b = r["branches"][0]
    import math
    s = max(math.hypot(b["pf"], b["qf"]), math.hypot(b["pt"], b["qt"]))
    assert abs(b["loading"] - s / net.br_rate[b["id"]]) < 1e-4


def test_api_health_and_cases():
    h = client.get("/health").json()
    assert h["status"] == "ok" and "case118_ieee" in h["cases"] and "ac" in h["solvers"]
    assert "case118_ieee" in client.get("/cases").json()["cases"]


def test_api_evaluate_in_batch():
    req = {"grid": "case118_ieee", "solver": "ac", "topologies": [{}, {"busOut": [100]}, {"branchOut": [3, 4]}]}
    r = client.post("/evaluate", json=req)
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res) == 3 and all(x["converged"] for x in res)
    assert res[0]["lostMW"] == 0 and res[1]["lostMW"] > 0


def test_api_verify_and_auto_use_ac():
    a = client.post("/verify", json={"grid": "case118_ieee", "solver": "dc", "topologies": [{}]}).json()["results"][0]
    b = client.post("/evaluate", json={"grid": "case118_ieee", "solver": "auto", "topologies": [{}]}).json()["results"][0]
    assert a["solver"] == "ac" and b["solver"] == "ac"


def test_api_errors():
    assert client.post("/evaluate", json={"grid": "nao_existe", "topologies": [{}]}).status_code == 404
    assert client.post("/evaluate", json={"topologies": [{}]}).status_code == 422
    assert client.post("/evaluate", json={"grid": "case118_ieee", "topologies": [{"branchOut": [999]}]}).status_code == 422
    assert client.post("/evaluate", json={"grid": "case118_ieee", "topologies": [{"busOut": [999]}]}).status_code == 422
    assert client.post("/evaluate", json={"grid": "case118_ieee", "solver": "genco", "topologies": [{}]}).status_code == 501


def test_api_inline_case_with_matpower_tables():
    d = json.loads(CASE118.read_text(encoding="utf-8"))
    mpc = {k: d[k] for k in ("baseMVA", "bus", "gen", "branch")}
    r = client.post("/evaluate", json={"case": mpc, "solver": "dc", "topologies": [{"busOut": [100]}]})
    assert r.status_code == 200
    assert abs(r.json()["results"][0]["lostMW"] - 339.0) < 1e-6


def test_case_name_in_the_json_equals_the_file_name():
    """The backend registers the case by file name and the interface requests it by the JSON `name`: the two must match."""
    from app.main import _case_files
    for name, path in _case_files().items():
        assert json.loads(path.read_text(encoding="utf-8"))["name"] == name


def test_base_dispatch_equals_the_powermodels_ac_opf(net):
    """The base-case generation is that of the PowerModels AC-OPF (published PGLib objective: 97213.61) and it matches the load plus losses."""
    r = evaluate(net, [], [], "ac")
    geracao = sum(g["pg"] for g in r["gens"])
    assert abs(sum(net.gen_pg[net.gen_on]) - 4380.69) < 0.01
    assert 4242.0 < geracao < 4242.0 * 1.05                      # perdas AC de ~3%
    assert max(b["loading"] for b in r["branches"]) > 0.99        # there are branches exactly at the limit (active OPF constraint)


def test_branch_at_the_limit_does_not_count_as_overload(net):
    from app.evaluate import TOL_LOADING
    assert TOL_LOADING >= 1e-5
