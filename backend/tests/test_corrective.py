"""Resposta corretiva: redespacho + corte mínimo de carga, verificada pelo AC."""
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


def test_sem_falhas_nada_a_fazer(net):
    r = plan_corrective(net, [], [])
    assert not r["needsAction"] and r["plan"]["shed"] == [] and r["plan"]["redispatch"] == []
    assert r["summary"]["servedPct"] == 1.0


def test_linha_7_exige_corte_e_o_plano_resolve_pelo_AC(net):
    """Perder a linha 7 sobrecarrega a rede mesmo após o redespacho automático: o plano corta carga e o AC confirma sem sobrecarga."""
    r = plan_corrective(net, [7], [])
    s = r["summary"]
    assert r["needsAction"] and s["overloadsPost"] > 0
    assert r["after"]["converged"] and s["overloadsAfter"] == 0
    assert 50 < s["shedMW"] < 300                                    # ~148 MW (3,5% da carga de 4242 MW)
    assert abs(s["servedMW"] - (s["loadTotalMW"] - s["isolatedMW"] - s["shedMW"])) < 0.01
    assert all(0 < x["pct"] <= 1.0 for x in r["plan"]["shed"])


def test_o_corte_e_minimo_nao_ha_folga_para_cortar_menos(net):
    """Se o plano cortasse bem menos que o calculado, o AC acusaria sobrecarga: o corte não é conservador demais."""
    r = plan_corrective(net, [7], [])
    shed = {x["bus"]: x["mw"] for x in r["plan"]["shed"]}
    pd = net.pd.copy()
    qd = net.qd.copy()
    pg = net.gen_pg.copy()
    for g in r["plan"]["redispatch"]:
        pg[g["gen"]] = g["pgAfter"]
    for bus, mw in shed.items():
        i = int(net.bus_index([bus])[0])
        f = (pd[i] - 0.5 * mw) / pd[i]                             # corta só metade do que o plano cortou
        pd[i] *= f
        qd[i] *= f
    meio = evaluate(net, [7], [], "ac", pg=pg, pd=pd, qd=qd)
    assert len(meio["violations"]["overload"]) > 0


def test_so_redespacho_quando_basta(net):
    """Há contingências em que só redistribuir a geração resolve (sem cortar carga)."""
    achou = False
    for i in range(0, net.nl, 4):
        r = plan_corrective(net, [i], [])
        if r["needsAction"] and r["plan"]["totalShedMW"] == 0:
            assert r["summary"]["overloadsAfter"] == 0 and r["plan"]["redispatch"]
            achou = True
            break
    assert achou


@pytest.mark.parametrize("falhas", [([3], []), ([37], []), ([6, 40], []), ([], [8]), ([], [26]), ([20], [68]), ([], [100])])
def test_propriedades_em_varias_contingencias(net, falhas):
    """Em cada caso: converge, sem sobrecarga ao fim, geração dentro de Pmax/Pmin e a carga atendida nunca passa da disponível."""
    r = plan_corrective(net, falhas[0], falhas[1])
    s = r["summary"]
    assert s["convergedAfter"] and s["overloadsAfter"] == 0
    assert r["after"]["violations"]["pgen"] == []
    assert s["servedMW"] <= s["loadTotalMW"] - s["isolatedMW"] + 1e-6
    assert s["shedMW"] >= 0 and all(x["mw"] >= 0 for x in r["plan"]["shed"])


def test_referencia_em_falta_nao_energiza_nada(net):
    r = plan_corrective(net, [], [int(net.bus_no[net.ref])])
    assert r["summary"]["servedMW"] == 0 and "referência" in r["note"]


def test_redespacho_proporcional_respeita_limites_e_fecha_o_balanco(net):
    bm, brm = topology_masks(net, [], [100])                         # perde 653 MW de capacidade
    pg = proportional_redispatch(net, bm, brm)
    on = np.flatnonzero(net.gen_on & bm[net.gen_bus])
    # tolerância de 1e-3 MW: o próprio OPF (Ipopt) deixa geradores ~5e-6 MW acima do Pmax
    assert np.all(pg[on] <= net.gen_pmax[on] + 1e-3) and np.all(pg[on] >= net.gen_pmin[on] - 1e-3)
    assert pg[on].sum() > net.gen_pg[on].sum()                       # a geração restante sobe para cobrir a perdida


def test_api_corrective():
    r = client.post("/corrective", json={"grid": "case118_ieee", "faults": {"branchOut": [7]}})
    assert r.status_code == 200
    d = r.json()
    assert d["needsAction"] and d["summary"]["overloadsAfter"] == 0 and d["plan"]["shed"]
    assert {"pre", "postFault", "after", "plan", "summary", "faults"} <= set(d)
    assert client.post("/corrective", json={"grid": "case118_ieee", "faults": {"branchOut": [999]}}).status_code == 422
    assert client.post("/corrective", json={"grid": "nao_existe"}).status_code == 404
    assert client.get("/health").json()["version"] == "0.5.0"


def test_varredura_n1_conta_as_contingencias_e_ordena_por_severidade(net):
    from app.screening import screen
    r = screen(net, "both")
    assert r["count"] == 186 + 117 and r["needAction"] + r["noAction"] == r["count"]
    assert 200 <= r["needAction"] <= 220                              # 210 no caso corrigido (IEEE 118)
    cs = r["contingencies"]
    assert all(c["converged"] for c in cs)
    assert all(c["needsAction"] for c in cs[:r["needAction"]]) and not any(c["needsAction"] for c in cs[r["needAction"]:])
    assert cs[0]["overloads"] >= cs[r["needAction"] - 1]["overloads"]
    # a linha 7 (barras 8-5) é uma das que exigem corte: deve aparecer entre as que precisam de ação
    assert any(c["type"] == "line" and c["id"] == 7 and c["needsAction"] for c in cs)


def test_api_screen_por_escopo():
    d = client.post("/screen", json={"grid": "case118_ieee", "scope": "lines"}).json()
    assert d["count"] == 186 and all(c["type"] == "line" for c in d["contingencies"])
    assert client.post("/screen", json={"grid": "nao_existe"}).status_code == 404


def test_religacao_por_blocos_termina_restaurada_e_nunca_corta_mais_que_o_plano(net):
    from app.recovery import recover
    r = recover(net, [("line", 7)], block_mw=50.0)
    ev = r["events"]
    assert [e["kind"] for e in ev][:2] == ["plan", "repair"] and all(e["kind"] == "reconnect" for e in ev[2:])
    assert r["summary"]["restored"] and ev[-1]["unservedMW"] < 0.5 and ev[-1]["overloads"] == 0
    assert abs(ev[0]["unservedMW"] - 148.0) < 1.0                       # o plano inicial é o corte mínimo da linha 7
    assert all(e["block"]["mw"] <= 50.0 + 1e-6 for e in ev if e["kind"] == "reconnect")
    served = [e["servedMW"] for e in ev[1:]]
    assert served == sorted(served)                                      # a religação só aumenta a carga atendida
    assert all(e["converged"] for e in ev)
    t = [e["tHours"] for e in ev]
    assert t == sorted(t) and abs(r["summary"]["ensMWh"] - sum((t[i + 1] - t[i]) * ev[i]["unservedMW"] for i in range(len(ev) - 1))) < 0.1


def test_religacao_com_duas_falhas_e_ordem_dos_reparos(net):
    from app.recovery import recover
    a = recover(net, [("line", 7), ("bus", 68)])
    b = recover(net, [("bus", 68), ("line", 7)])
    for r in (a, b):
        assert r["summary"]["restored"] and [e["kind"] for e in r["events"]].count("repair") == 2
    assert a["events"][0]["unservedMW"] == b["events"][0]["unservedMW"]           # o plano inicial não depende da ordem
    assert a["summary"]["ensMWh"] != b["summary"]["ensMWh"]                       # a ordem dos reparos muda a energia não suprida


def test_api_recovery():
    body = {"grid": "case118_ieee", "faults": {"branchOut": [7]}, "options": {"blockMW": 100}}
    r = client.post("/recovery", json=body)
    assert r.status_code == 200
    d = r.json()
    assert d["summary"]["restored"] and d["events"][0]["kind"] == "plan" and d["repairOrder"][0]["label"] == "linha 8–5"
    ok = {"grid": "case118_ieee", "faults": {"branchOut": [7], "busOut": [68]}}
    assert client.post("/recovery", json={**ok, "repairOrder": [{"type": "bus", "id": 68}, {"type": "line", "id": 7}]}).status_code == 200
    assert client.post("/recovery", json={**ok, "repairOrder": [{"type": "line", "id": 7}]}).status_code == 422
    assert client.post("/recovery", json={"grid": "case118_ieee"}).status_code == 422
    assert client.post("/recovery", json={"grid": "case118_ieee", "faults": {"branchOut": [999]}}).status_code == 422
