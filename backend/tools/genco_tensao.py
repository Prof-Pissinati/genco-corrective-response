"""Generator voltage provider based on GENCO-OPF (offline: needs torch and gridfm-graphkit).

Connects GENCO-OPF to the `app.voltage.plan_with_voltage` loop: for the post-fault state of a plan, builds the model's input tables,
asks for the voltage of each bus and returns, per generator, the reference voltage (Vg) limited to the bus range. Only the voltage is used; the dispatch that the
model predicts is NOT applied (see docs/TENSAO_GENCO_OPF.md).

    from genco_tensao import make_vg_provider
    provedor = make_vg_provider("models/case118_genco_opf_small_autores", cost)
    r = plan_with_voltage(net, bo, bu, provedor, model="genco-opf-small")
"""
from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))
from app.acpf import solve_ac, solve_dc            # noqa: E402
from app.network import topology_masks             # noqa: E402
from genco_escala import tabelas                   # noqa: E402


def entrada_genco(net, cost, bo, bu, r):
    """GENCO-OPF tables for the post-fault state of plan `r` (shed loads and plan dispatch). None if the AC of that state does not converge."""
    pd2 = net.pd.copy()
    for s in r["plan"]["shed"]:
        pd2[net.bus_index([s["bus"]])[0]] -= s["mw"]
    qd2 = net.qd * np.where(net.pd > 1e-9, pd2 / np.where(net.pd > 1e-9, net.pd, 1.0), 1.0)
    pg_plan = np.zeros(len(net.gen_bus))
    for gg in r["after"]["gens"]:
        pg_plan[gg["id"]] = gg["pg"]
    idx_bu = net.bus_index(bu) if bu else np.array([], dtype=int)
    pd_in, qd_in = pd2.copy(), qd2.copy()
    pd_in[idx_bu] = 0.0; qd_in[idx_bu] = 0.0              # load and generation of the buses that are out are zeroed; the lines that are out get br_status 0
    gen_on = net.gen_on & ~np.isin(net.gen_bus, idx_bu)
    n2 = replace(net, pd=pd_in, qd=qd_in, gen_on=gen_on, gen_pg=np.where(gen_on, pg_plan, 0.0))
    bm, brm = topology_masks(n2, bo, bu)
    ac, dc = solve_ac(n2, bm, brm), solve_dc(n2, bm, brm)
    return tabelas(n2, cost, brm, ac, dc) if ac["converged"] else None


def vg_do_genco(net, vm):
    """Reference voltage per generator from the predicted voltage per bus, limited to the bus range."""
    vg = net.gen_vg.copy()
    for gi in range(len(net.gen_bus)):
        b = net.gen_bus[gi]
        vg[gi] = float(np.clip(vm[b], net.vmin[b], net.vmax[b]))
    return vg


def make_vg_provider(modelo, cost, pesos: str = "last.pt", device: str = "cpu"):
    """Provider for `plan_with_voltage` using the OPF checkpoint in `modelo`."""
    from genco_opf_inferencia import GencoOPF

    g = GencoOPF(Path(modelo), device, pesos=pesos)

    def provedor(net_k, bo, bu, r):
        tab = entrada_genco(net_k, cost, bo, bu, r)
        if tab is None:
            return None
        return vg_do_genco(net_k, g.prever_opf([tab], lote=1)["vm"][0])

    return provedor
