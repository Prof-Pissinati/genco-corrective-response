"""Exports the electrical state that the GENCO checkpoint estimates (loading, active/reactive flow and voltage), next to the AC, for the intact network and for every single-line outage.

The interface uses it for the "GENCO" view (and for the AC view of the static demo): the diagram is colored by the loading each method gives for the same state.
State of each scenario = the one GENCO saw in training and the project's N-1 screening uses: AC-OPF base dispatch, one line out, the REFERENCE bus absorbing the
imbalance, no redispatch. Outages that island buses (or where the AC does not converge) are left out.

GENCO (PF mode) predicts only the bus voltage (Vm, Va). Everything else is computed from it with the same admittances the AC uses: the branch flows
(S = V conj(Y V)), the reference-bus generation and the reactive generation of the PV buses (from the power balance of the predicted voltages). The other
generators keep the dispatch that is an INPUT of the model.

Output: interface/src/data/genco_lines_<network>.json
    { case, model, busNo[], genBus[], refBus, loadMW, base: {...}, outages: { "<branch index>": {...} }, skipped[] }
  each state: for method in ac / genco:
    <method>      loading per branch in % of rateA (0 for a branch that is out)
    <method>Pf/Qf active (MW) and reactive (MVAr) flow at the "from" end of each branch
    <method>Vm/Va bus voltage (pu) and angle (degrees, relative to the reference bus)
    <method>Pg/Qg active and reactive generation (MW, MVAr) at each bus of genBus

Runs in the GENCO environment (gridfm-graphkit + torch), from the repository root:
    python backend/tools/export_genco_lines.py --case case118_ieee --modelo models/case118_genco_tiny_autores
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
sys.path.insert(0, str(ROOT / "tools"))
from app.acpf import _branch_admittances, solve_ac, solve_dc   # noqa: E402
from app.network import load_case, topology_masks  # noqa: E402
import genco_screening as gs                        # noqa: E402
from genco_inferencia_exemplo import GencoEmMemoria, carregamento   # noqa: E402

DATA = ROOT / "interface" / "src" / "data"


def tabelas(net, cost, brm, ac, dc):
    """(bus, gen, branch) of the state in the datakit format (same code as the screening)."""
    rb, rg, rl = gs.scenario_rows(net, cost, brm, ac, dc, 0)
    bus, gen, br = pd.DataFrame(rb), pd.DataFrame(rg), pd.DataFrame(rl)
    agg = gen.groupby("bus")[["min_q_mvar", "max_q_mvar"]].sum().reset_index()
    return bus.merge(agg, on="bus", how="left").fillna(0), gen, br


def fluxos(net, brm, V):
    """Branch flows at the `from` end (MW, MVAr) and net bus injection S (MW, MVAr) for complex voltages V, with the admittances of the AC solver."""
    base = net.base_mva
    bi = np.flatnonzero(brm)
    f, t = net.br_f[bi], net.br_t[bi]
    yff, yft, ytf, ytt = _branch_admittances(net, bi)
    sf = V[f] * np.conj(yff * V[f] + yft * V[t]) * base
    st = V[t] * np.conj(ytf * V[f] + ytt * V[t]) * base
    pf, qf = np.zeros(net.nl), np.zeros(net.nl)
    pf[bi], qf[bi] = sf.real, sf.imag
    S = np.zeros(net.nb, dtype=complex)
    np.add.at(S, f, sf)
    np.add.at(S, t, st)
    S += np.abs(V) ** 2 * np.conj(net.gs + 1j * net.bs)                 # shunts (MW, MVAr at 1 pu)
    return pf, qf, S


def main(a):
    gs.set_case(a.case)
    net = load_case(gs.CASE_JSON)
    cost = gs.gencost_from_m(gs.CASE_M)
    rate = net.br_rate

    estados, chaves, topologias, skipped = [], [], [], []
    for nome, outs in [("base", [])] + [(str(k), [k]) for k in range(net.nl) if net.br_on[k]]:
        bm, brm = topology_masks(net, outs, [])
        if not bm.all():
            skipped.append({"id": int(nome) if outs else None, "reason": "islanding"})
            continue
        ac = solve_ac(net, bm, brm)
        if not ac["converged"]:
            skipped.append({"id": int(nome) if outs else None, "reason": "AC did not converge"})
            continue
        dc = solve_dc(net, bm, brm)
        topologias.append(tabelas(net, cost, brm, ac, dc))
        estados.append((ac, brm))
        chaves.append(nome)

    g = GencoEmMemoria(Path(a.modelo), "cpu", pesos=a.pesos)
    t0 = time.perf_counter()
    vm, va = g.prever(topologias, lote=64)
    ms = (time.perf_counter() - t0) * 1000 / len(topologias)

    r1 = lambda x: [round(float(v), 1) for v in x]            # noqa: E731
    r2 = lambda x: [round(float(v), 2) for v in x]            # noqa: E731
    r4 = lambda x: [round(float(v), 4) for v in x]            # noqa: E731
    gen_buses = sorted({int(b) for b, on in zip(net.gen_bus, net.gen_on) if on})
    pv = np.array([net.bus_type[b] in (2, 3) or b == net.ref for b in gen_buses])
    saida, erros, dpf, dslack = {}, [], [], []
    for i, (nome, (ac, brm), (bus_df, gen_df, br_df)) in enumerate(zip(chaves, estados, topologias)):
        s_ac = np.maximum(np.hypot(ac["pf"], ac["qf"]), np.hypot(ac["pt"], ac["qt"]))
        l_ac = np.where(brm & (rate > 0), s_ac / np.where(rate > 0, rate, 1.0), 0.0) * 100
        l_ge = carregamento(vm[i], va[i], br_df) * 100
        erros.append(np.abs(l_ge - l_ac)[brm])
        V_ac = ac["vm"] * np.exp(1j * np.radians(ac["va"]))
        V_ge = vm[i] * np.exp(1j * (va[i] - va[i][net.ref]))
        pf_ac, qf_ac, S_ac = fluxos(net, brm, V_ac)
        pf_ge, qf_ge, S_ge = fluxos(net, brm, V_ge)
        pg_ac = np.array([sum(ac["pg"][g] for g in range(len(net.gen_bus)) if net.gen_bus[g] == b and net.gen_on[g]) for b in gen_buses])
        qg_ac = np.array([sum(ac["qg"][g] for g in range(len(net.gen_bus)) if net.gen_bus[g] == b and net.gen_on[g]) for b in gen_buses])
        d = S_ge - S_ac                                                   # error of the injection implied by the predicted voltages
        pg_ge = pg_ac + np.array([d[b].real if b == net.ref else 0.0 for b in gen_buses])      # only the reference absorbs the imbalance
        qg_ge = qg_ac + np.array([d[b].imag if keep else 0.0 for b, keep in zip(gen_buses, pv)])
        dpf.append(np.abs(pf_ge - pf_ac)[brm])
        dslack.append(abs(d[net.ref].real))
        saida[nome] = {"ac": r1(l_ac), "genco": r1(l_ge),
                       "acPf": r1(pf_ac), "acQf": r1(qf_ac), "gencoPf": r1(pf_ge), "gencoQf": r1(qf_ge),
                       "acVm": r4(ac["vm"]), "gencoVm": r4(vm[i]), "acVa": r2(ac["va"]), "gencoVa": r2(np.degrees(va[i] - va[i][net.ref])),
                       "acPg": r1(pg_ac), "acQg": r1(qg_ac), "gencoPg": r1(pg_ge), "gencoQg": r1(qg_ge)}
    e = np.concatenate(erros)
    out = {"case": a.case, "model": a.rotulo, "state": "AC-OPF base dispatch, reference bus absorbs the imbalance, no redispatch (single-line outages and the intact network)",
           "busNo": [int(x) for x in net.bus_no], "genBus": [int(net.bus_no[b]) for b in gen_buses], "loadMW": round(float(net.pd.sum()), 1), "refBus": int(net.bus_no[net.ref]), "branches": int(net.nl), "base": saida.pop("base"), "outages": saida, "skipped": skipped}
    dst = Path(a.dst) if a.dst else DATA / f"genco_lines_{a.case}.json"
    dst.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {dst.name}: {dst.stat().st_size // 1024} KB, {len(saida)} outages + base, {len(skipped)} skipped; mean |GENCO - AC| loading = {e.mean():.3f} points; mean |P flow| error = {np.concatenate(dpf).mean():.2f} MW; reference-bus P error: mean {np.mean(dslack):.1f} MW, max {np.max(dslack):.1f} MW ({ms:.1f} ms per scenario)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", default="case118_ieee", help="network: case14_ieee, case30_ieee, case57_ieee or case118_ieee")
    ap.add_argument("--modelo", required=True, help="checkpoint folder (config.yaml, weights, normalizer_stats.pt)")
    ap.add_argument("--pesos", default="best_model_state_dict.pt")
    ap.add_argument("--rotulo", default="GENCO Tiny from the authors (gridfm/genco-pf-datakit)", help="model description stored in the file")
    ap.add_argument("--dst")
    main(ap.parse_args())
