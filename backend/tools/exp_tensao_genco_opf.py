"""Does GENCO-OPF fix the voltage after the plan? Test against our AC, with Step 0 (PowerModels) as the reference.

For each single contingency that requires a plan and for which the backend plan ends with voltage out of range:
  1. builds the post-fault state (line or bus out) with the loads ALREADY shed by the plan and the plan dispatch;
  2. GENCO-OPF (authors checkpoint) predicts the dispatch and generator voltages in that state;
  3. what it predicts is APPLIED in our AC and we count what remains:
       G1  only the GENCO generator voltage (Vg), with the plan dispatch (it is the Vg adjustment of Step 0 / V2);
       G2  despacho e Vg do GENCO.
  The GENCO-OPF output has voltage within the range by construction; the test measures whether, in the real AC, the violations go away.
Reference: docs/escala/tensao_<network>.json (Step 0: PowerModels AC-OPF; how many contingencies have a solution).

Runs in the GENCO environment (gridfm-graphkit + torch), from the repository root:
    python backend/tools/exp_tensao_genco_opf.py --modelo models/case118_genco_opf_small_autores --dst docs/escala/tensao_genco_opf_case118_ieee.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
sys.path.insert(0, str(ROOT / "tools"))
from app.acpf import solve_ac, solve_dc            # noqa: E402
from app.corrective import plan_corrective         # noqa: E402
from app.evaluate import TOL_VOLTAGE, evaluate     # noqa: E402
from app.network import load_case, topology_masks  # noqa: E402
from app.screening import screen                   # noqa: E402
from genco_escala import tabelas                   # noqa: E402
from genco_opf_inferencia import GencoOPF          # noqa: E402
from genco_tensao import entrada_genco, vg_do_genco  # noqa: E402
from genco_screening import gencost_from_m         # noqa: E402


def violacoes(ev, net):
    """Counts for the AC state `ev` (evaluate output): voltage (and the largest excess, pu), overload, generator reactive power."""
    if not ev["converged"]:
        return {"converge": False}
    bmap = {b["id"]: b["vm"] for b in ev["buses"]}
    lim = {int(net.bus_no[i]): (net.vmin[i], net.vmax[i]) for i in range(net.nb)}
    exc = [max(bmap[n] - lim[n][1], lim[n][0] - bmap[n]) for n in bmap if bmap[n] > lim[n][1] + TOL_VOLTAGE or bmap[n] < lim[n][0] - TOL_VOLTAGE]
    carga = max((x["loading"] for x in ev["branches"]), default=0.0)
    return {"converge": True, "tensao": len(exc), "maiorExcessoPu": round(max(exc, default=0.0), 4), "sobrecargas": len(ev["violations"]["overload"]), "maiorCarregamentoPct": round(carga * 100, 2),
            "reativoGeradores": len(ev["violations"]["qgen"]), "potenciaGeradores": len(ev["violations"]["pgen"])}


def main(a):
    data = ROOT / "interface" / "src" / "data"
    net = load_case(data / f"{a.rede}.json")
    cost = gencost_from_m(data / f"pglib_opf_{a.rede}.m")
    g = GencoOPF(Path(a.modelo), "cpu", pesos=a.pesos)
    ref0 = json.loads((ROOT / "docs" / "escala" / f"tensao_{a.rede}.json").read_text(encoding="utf-8"))
    pm = {c["label"]: c for c in ref0["contingencias"]}

    casos, tops = [], []
    for c in screen(net)["contingencias" if False else "contingencies"]:
        if not c["needsAction"]:
            continue
        bo, bu = ([c["id"]], []) if c["type"] == "line" else ([], [c["id"]])
        r = plan_corrective(net, bo, bu)
        v0 = violacoes(r["after"], net)
        if not v0.get("converge") or v0["tensao"] == 0:
            continue
        pd2 = net.pd.copy()
        for s in r["plan"]["shed"]:
            pd2[net.bus_index([s["bus"]])[0]] -= s["mw"]
        qd2 = net.qd * np.where(net.pd > 1e-9, pd2 / np.where(net.pd > 1e-9, net.pd, 1.0), 1.0)
        pg_plan = np.zeros(len(net.gen_bus))
        for gg in r["after"]["gens"]:
            pg_plan[gg["id"]] = gg["pg"]
        # GENCO input state: load and generation of the buses that are out are zeroed; the lines that are out get br_status 0
        idx_bu = net.bus_index(bu) if bu else np.array([], dtype=int)
        pd_in, qd_in = pd2.copy(), qd2.copy()
        pd_in[idx_bu] = 0.0; qd_in[idx_bu] = 0.0
        gen_on = net.gen_on & ~np.isin(net.gen_bus, idx_bu)
        n2 = replace(net, pd=pd_in, qd=qd_in, gen_on=gen_on, gen_pg=np.where(gen_on, pg_plan, 0.0))
        bm, brm = topology_masks(n2, bo, bu)
        ac, dc = solve_ac(n2, bm, brm), solve_dc(n2, bm, brm)
        if not ac["converged"]:
            continue
        tops.append(tabelas(n2, cost, brm, ac, dc))
        casos.append({"c": c, "bo": bo, "bu": bu, "pd2": pd2, "qd2": qd2, "pg_plan": pg_plan, "v0": v0, "plano": r["plan"]["totalShedMW"]})
    t0 = time.perf_counter()
    pred = g.prever_opf(tops, lote=16)
    ms = (time.perf_counter() - t0) * 1000 / max(len(tops), 1)

    linhas = []
    for i, k in enumerate(casos):
        vm = pred["vm"][i]
        vg = net.gen_vg.copy()
        for gi in range(len(net.gen_bus)):
            b = net.gen_bus[gi]
            vg[gi] = float(np.clip(vm[b], net.vmin[b], net.vmax[b]))
        res = {"label": k["c"]["label"], "cortePlanoMW": round(k["plano"], 2), "plano": k["v0"],
               "powermodelsViavelSoVg": bool(pm.get(k["c"]["label"], {}).get("V2", {}).get("viavel")), "powermodelsViavelLivre": bool(pm.get(k["c"]["label"], {}).get("V1", {}).get("viavel"))}
        for nome, pg_use in (("G1", k["pg_plan"]), ("G2", np.where(net.gen_on, pred["pg_gen"][i], 0.0))):
            net3 = replace(net, gen_vg=vg)
            ev = evaluate(net3, k["bo"], k["bu"], "ac", pg=pg_use, pd=k["pd2"], qd=k["qd2"])
            res[nome] = violacoes(ev, net)
        # reference: what PowerModels computed (with the thermal limit as a constraint), applied in the SAME AC
        for nome, chave, usa_pg in (("P1", "V2", False), ("P2", "V1", True)):
            ref = pm.get(k["c"]["label"], {}).get(chave, {})
            if ref.get("viavel") and ref.get("vg"):
                vgp = np.array([x if x is not None else net.gen_vg[gi] for gi, x in enumerate(ref["vg"])])
                pgp = np.where(net.gen_on, np.array(ref["pgMW"]), 0.0) if usa_pg else k["pg_plan"]
                ev = evaluate(replace(net, gen_vg=vgp), k["bo"], k["bu"], "ac", pg=pgp, pd=k["pd2"], qd=k["qd2"])
                res[nome] = violacoes(ev, net)
        res["despachoGencoMudaMW"] = round(float(np.abs(np.where(net.gen_on, pred["pg_gen"][i], 0.0) - k["pg_plan"]).sum() / 2), 1)
        res["vgMudaMedioPu"] = round(float(np.abs(vg - net.gen_vg)[net.gen_on].mean()), 4)
        linhas.append(res)
        print(f"{res['label']:>12}: plan {k['v0']['tensao']} viol (max {k['v0']['maiorExcessoPu']}) | G1 {res['G1'].get('tensao')} overl {res['G1'].get('sobrecargas')} Q {res['G1'].get('reativoGeradores')} | "
              f"G2 {res['G2'].get('tensao')} | PM Vg-only {res['powermodelsViavelSoVg']}", flush=True)

    # L: Vg from GENCO-OPF, then the power plan is REDONE with that voltage (the LP uses the AC reactive power); repeats until it settles (at most 3 rounds)
    for i, k in enumerate(casos):
        r = plan_corrective(net, k["bo"], k["bu"])
        res = linhas[i]
        net_k = net
        for volta in range(1, a.voltas + 1):
            tab = entrada_genco(net_k, cost, k["bo"], k["bu"], r)
            if tab is None:
                break
            vg = vg_do_genco(net, g.prever_opf([tab], lote=1)["vm"][0])
            net_k = replace(net, gen_vg=vg)
            r = plan_corrective(net_k, k["bo"], k["bu"])
            v = violacoes(r["after"], net)
            res["L"] = {**v, "voltas": volta, "corteMW": round(r["plan"]["totalShedMW"], 2), "corteOriginalMW": round(k["plano"], 2),
                        "redespachoMW": round(r["plan"]["totalRedispatchMW"], 1), "nota": r.get("note")}
            if v.get("converge") and v["tensao"] == 0 and v["sobrecargas"] == 0:
                break

    def conta(nome, campo="tensao", zero=True):
        return sum(1 for r in linhas if r[nome].get("converge") and (r[nome][campo] == 0) == zero)

    resumo = {"rede": a.rede, "modelo": Path(a.modelo).name, "pesos": a.pesos, "contingencias": len(linhas), "msPorCenarioGenco": round(ms, 1),
              "tensaoResolvida": {"planoOriginal": 0, "G1_soVg": conta("G1"), "G2_despachoEVg": conta("G2")},
              "powermodelsResolve": {"soVg": sum(r["powermodelsViavelSoVg"] for r in linhas), "livre": sum(r["powermodelsViavelLivre"] for r in linhas)},
              "powermodelsNoNossoAC": {n: {"casos": sum(1 for r in linhas if n in r), "tensaoResolvida": sum(1 for r in linhas if n in r and r[n].get("converge") and r[n]["tensao"] == 0),
                                           "carregamentoMaxMediano": (lambda a: sorted(a)[len(a) // 2] if a else None)([r[n]["maiorCarregamentoPct"] for r in linhas if n in r and r[n].get("converge")]),
                                           "acimaDe100": sum(1 for r in linhas if n in r and r[n].get("converge") and r[n]["maiorCarregamentoPct"] > 100.01)} for n in ("P1", "P2")},
              "laco": {"casos": sum(1 for r in linhas if "L" in r),
                       "tensaoResolvida": sum(1 for r in linhas if "L" in r and r["L"].get("converge") and r["L"]["tensao"] == 0),
                       "semSobrecarga": sum(1 for r in linhas if "L" in r and r["L"].get("converge") and r["L"]["sobrecargas"] == 0),
                       "resolveTudo": sum(1 for r in linhas if "L" in r and r["L"].get("converge") and r["L"]["tensao"] == 0 and r["L"]["sobrecargas"] == 0),
                       "voltasMedias": round(float(np.mean([r["L"]["voltas"] for r in linhas if "L" in r])), 2),
                       "corteIgualOuMenor": sum(1 for r in linhas if "L" in r and r["L"]["corteMW"] <= r["L"]["corteOriginalMW"] + 0.5),
                       "corteTotalMW": [round(sum(r["L"]["corteOriginalMW"] for r in linhas if "L" in r), 1), round(sum(r["L"]["corteMW"] for r in linhas if "L" in r), 1)],
                       "reativoForaDoLimiteMedio": [round(float(np.mean([r["plano"]["reativoGeradores"] for r in linhas])), 2), round(float(np.mean([r["L"]["reativoGeradores"] for r in linhas if "L" in r and r["L"].get("converge")])), 2)]},
              "novasSobrecargasG1": sum(1 for r in linhas if r["G1"].get("converge") and r["G1"]["sobrecargas"] > r["plano"]["sobrecargas"]),
              "carregamentoMaxG1": {"acimaDe100": sum(1 for r in linhas if r["G1"].get("converge") and r["G1"]["maiorCarregamentoPct"] > 100.01),
                                    "acimaDe101": sum(1 for r in linhas if r["G1"].get("converge") and r["G1"]["maiorCarregamentoPct"] > 101),
                                    "acimaDe105": sum(1 for r in linhas if r["G1"].get("converge") and r["G1"]["maiorCarregamentoPct"] > 105),
                                    "maximo": max((r["G1"]["maiorCarregamentoPct"] for r in linhas if r["G1"].get("converge")), default=0)},
              "carregamentoMaxPlano": max((r["plano"]["maiorCarregamentoPct"] for r in linhas), default=0),
              "reativoForaDoLimiteG1": sum(1 for r in linhas if r["G1"].get("converge") and r["G1"]["reativoGeradores"] > r["plano"]["reativoGeradores"]),
              "naoConvergeuG1": sum(1 for r in linhas if not r["G1"].get("converge")), "naoConvergeuG2": sum(1 for r in linhas if not r["G2"].get("converge"))}
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    Path(a.dst).write_text(json.dumps({"resumo": resumo, "contingencias": linhas}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rede", default="case118_ieee")
    ap.add_argument("--modelo", default=str(ROOT / "models" / "case118_genco_opf_small_autores"))
    ap.add_argument("--pesos", default="last.pt")
    ap.add_argument("--dst", required=True)
    ap.add_argument("--voltas", type=int, default=3, help="rounds of the GENCO Vg -> power plan loop")
    main(ap.parse_args())
