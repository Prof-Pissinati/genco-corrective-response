"""Topologia/ilhas, avaliação e API (FastAPI TestClient)."""
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


def test_caso_base_ac_converge_e_atende_toda_a_carga(net):
    r = evaluate(net, [], [], "ac")
    assert r["converged"] and r["lostMW"] == 0 and abs(r["servedMW"] - 4242.0) < 1e-6
    assert len(r["energized"]) == 118 and len(r["branches"]) == 186
    gen_total = sum(g["pg"] for g in r["gens"])
    assert 4242.0 < gen_total < 4242.0 * 1.06                       # perdas AC positivas e pequenas
    # o despacho vem do AC-OPF do PowerModels (rateA e tensões respeitados): o caso base NÃO tem violações
    assert all(v == [] for v in r["violations"].values())        # sobrecarga, tensão, Q e P dos geradores
    assert max(b["loading"] for b in r["branches"]) <= 1.0 + 1e-4


def test_faltas_81_e_100_perdem_339_MW_como_na_interface(net):
    """Mesmo valor mostrado pela interface (e conferido no navegador): 339,0 MW perdidos e 106 barras energizadas."""
    for solver in ("ac", "dc"):
        r = evaluate(net, [], [81, 100], solver)
        assert r["converged"]
        assert abs(r["lostMW"] - 339.0) < 1e-6
        assert len(r["energized"]) == 106
        assert 81 not in r["energized"] and 100 not in r["energized"]


def test_barra_de_referencia_em_falta_nao_energiza_nada(net):
    r = evaluate(net, [], [69], "ac")
    assert r["energized"] == [] and abs(r["lostMW"] - 4242.0) < 1e-6


def test_ramo_fora_zera_o_fluxo_e_o_carregamento_nao_inclui_o_ramo(net):
    r = evaluate(net, [7], [], "ac")
    assert 7 not in [b["id"] for b in r["branches"]]
    assert len(r["branches"]) == 185


def test_carregamento_ac_usa_a_maior_ponta_sobre_rateA(net):
    r = evaluate(net, [], [], "ac")
    b = r["branches"][0]
    import math
    s = max(math.hypot(b["pf"], b["qf"]), math.hypot(b["pt"], b["qt"]))
    assert abs(b["loading"] - s / net.br_rate[b["id"]]) < 1e-4


def test_api_health_e_cases():
    h = client.get("/health").json()
    assert h["status"] == "ok" and "case118_ieee" in h["cases"] and "ac" in h["solvers"]
    assert "case118_ieee" in client.get("/cases").json()["cases"]


def test_api_evaluate_em_lote():
    req = {"grid": "case118_ieee", "solver": "ac", "topologies": [{}, {"busOut": [100]}, {"branchOut": [3, 4]}]}
    r = client.post("/evaluate", json=req)
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res) == 3 and all(x["converged"] for x in res)
    assert res[0]["lostMW"] == 0 and res[1]["lostMW"] > 0


def test_api_verify_e_auto_usam_ac():
    a = client.post("/verify", json={"grid": "case118_ieee", "solver": "dc", "topologies": [{}]}).json()["results"][0]
    b = client.post("/evaluate", json={"grid": "case118_ieee", "solver": "auto", "topologies": [{}]}).json()["results"][0]
    assert a["solver"] == "ac" and b["solver"] == "ac"


def test_api_erros():
    assert client.post("/evaluate", json={"grid": "nao_existe", "topologies": [{}]}).status_code == 404
    assert client.post("/evaluate", json={"topologies": [{}]}).status_code == 422
    assert client.post("/evaluate", json={"grid": "case118_ieee", "topologies": [{"branchOut": [999]}]}).status_code == 422
    assert client.post("/evaluate", json={"grid": "case118_ieee", "topologies": [{"busOut": [999]}]}).status_code == 422
    assert client.post("/evaluate", json={"grid": "case118_ieee", "solver": "genco", "topologies": [{}]}).status_code == 501


def test_api_caso_inline_com_tabelas_matpower():
    d = json.loads(CASE118.read_text(encoding="utf-8"))
    mpc = {k: d[k] for k in ("baseMVA", "bus", "gen", "branch")}
    r = client.post("/evaluate", json={"case": mpc, "solver": "dc", "topologies": [{"busOut": [100]}]})
    assert r.status_code == 200
    assert abs(r.json()["results"][0]["lostMW"] - 339.0) < 1e-6


def test_nome_do_caso_no_json_e_igual_ao_nome_do_arquivo():
    """O backend registra o caso pelo nome do arquivo e a interface o pede por `name` do JSON: os dois precisam coincidir."""
    from app.main import _case_files
    for nome, caminho in _case_files().items():
        assert json.loads(caminho.read_text(encoding="utf-8"))["name"] == nome


def test_despacho_base_igual_ao_ac_opf_do_powermodels(net):
    """A geração do caso base é a do AC-OPF do PowerModels (objetivo publicado do PGLib: 97213,61) e ela fecha a carga mais as perdas."""
    r = evaluate(net, [], [], "ac")
    geracao = sum(g["pg"] for g in r["gens"])
    assert abs(sum(net.gen_pg[net.gen_on]) - 4380.69) < 0.01
    assert 4242.0 < geracao < 4242.0 * 1.05                      # perdas AC de ~3%
    assert max(b["loading"] for b in r["branches"]) > 0.99        # há ramos exatamente no limite (restrição ativa do OPF)


def test_ramo_no_limite_nao_conta_como_sobrecarga(net):
    from app.evaluate import TOL_LOADING
    assert TOL_LOADING >= 1e-5
