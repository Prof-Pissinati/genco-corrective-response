"""Gera o JSON de um caso MATPOWER para a interface (despacho base + layout) e a referência DC para testes.

O arquivo do PGLib é um caso de OPF: os geradores vêm com Pg = 0 (o despacho sai de resolver o OPF). Este script resolve um
AC-OPF no caso base (pandapower; se falhar, DC-OPF) e grava o despacho no lugar do Pg. O layout do diagrama usa
networkx.kamada_kawai_layout (o mesmo critério do painel de contingências).

Uso (ambiente do backend, a partir da raiz do repositório):
    python backend/tools/export_case.py <caso.m> interface/src/data/case118_ieee.json [--ref interface/tests/case118_dc_ref.json]
"""
import argparse
import json
import pathlib
import sys
import warnings

import networkx as nx
import numpy as np
import pandapower as pp
from matpowercaseframes import CaseFrames
from pandapower.converter.pypower.from_ppc import from_ppc

warnings.filterwarnings("ignore")

ap = argparse.ArgumentParser()
ap.add_argument("case_m")
ap.add_argument("out_json")
ap.add_argument("--ref", help="grava a referência DC (fluxos por ramo) para testar o solver em JS")
ap.add_argument("--dispatch", help="JSON do AC-OPF do PowerModels (backend/tools/opf_powermodels.py): usa o despacho e as tensões dele. RECOMENDADO: o OPF do pandapower abaixo NÃO respeita os limites térmicos (rateA)")
args = ap.parse_args()

cf = CaseFrames(args.case_m)
bus = cf.bus.to_numpy(float)
gen = cf.gen.to_numpy(float)
branch = cf.branch.to_numpy(float)
gencost = cf.gencost.to_numpy(float) if hasattr(cf, "gencost") else None
base_mva = float(cf.baseMVA)

# ---- despacho base: AC-OPF (pandapower) -> fallback DC-OPF -> fallback proporcional
ppc = {"version": "2", "baseMVA": base_mva, "bus": bus.copy(), "gen": gen.copy(), "branch": branch.copy()}
if gencost is not None:
    ppc["gencost"] = gencost.copy()
method = "proporcional"
pg = gen[:, 1].copy()
DISPATCH = json.load(open(args.dispatch, encoding="utf-8")) if args.dispatch else None
try:
    if DISPATCH is not None:
        raise StopIteration                       # usa o despacho externo; não roda o OPF do pandapower
    net = from_ppc(ppc, f_hz=60, validate_conversion=False)
    try:
        pp.runopp(net)
        method = "AC-OPF (pandapower)"
    except Exception:
        pp.rundcopp(net)
        method = "DC-OPF (pandapower)"
    # ordem dos geradores: ext_grid (slack) + gen, na mesma ordem das linhas ativas da tabela gen
    res = []
    for g in range(len(gen)):
        res.append(None)
    pg_slack = float(net.res_ext_grid.p_mw.sum()) if len(net.ext_grid) else 0.0
    gens_pp = net.gen.sort_index()
    pg_gen = net.res_gen.loc[gens_pp.index, "p_mw"].to_numpy(float)
    # associa por barra (pode haver mais de um gerador na mesma barra: divide proporcionalmente a Pmax)
    bus_ids = bus[:, 0].astype(int)
    pg = np.zeros(len(gen))
    by_bus = {}
    for i, g in enumerate(gen):
        by_bus.setdefault(int(g[0]), []).append(i)
    ext_bus = {int(net.bus.index[net.bus.index == b][0]) for b in net.ext_grid.bus} if len(net.ext_grid) else set()
    # barras PV do pandapower: usa o resultado por barra
    gen_bus_p = {}
    for idx, row in gens_pp.iterrows():
        b = int(row["bus"])
        gen_bus_p[b] = gen_bus_p.get(b, 0.0) + float(net.res_gen.at[idx, "p_mw"])
    for _, row in net.ext_grid.iterrows():
        b = int(row["bus"])
        gen_bus_p[b] = gen_bus_p.get(b, 0.0) + pg_slack
    # o índice de barra do pandapower (from_ppc) é o próprio número da barra do MATPOWER (BUS_I)
    pp_to_no = {int(b): int(b) for b in bus[:, 0]}
    for b_pp, p_val in gen_bus_p.items():
        no = pp_to_no.get(int(b_pp), None)
        if no is None or no not in by_bus:
            continue
        rows = by_bus[no]
        pmax = np.array([max(gen[r, 8], 1e-9) for r in rows])
        for r, w in zip(rows, pmax / pmax.sum()):
            pg[r] = p_val * w
except StopIteration:
    pass
except Exception as exc:  # noqa: BLE001
    print("AVISO: OPF falhou (", type(exc).__name__, str(exc)[:80], ") -> despacho proporcional", file=sys.stderr)
    method = "proporcional"

if method == "proporcional":
    load = bus[:, 2].sum()
    pmax = gen[:, 8].clip(min=0)
    pg = pmax / pmax.sum() * load if pmax.sum() > 0 else pg

if DISPATCH is not None:
    method = "AC-OPF (PowerModels)"
    pg = np.array(DISPATCH["pg"], dtype=float)
    vm = {int(k): float(v) for k, v in DISPATCH["vm"].items()}
    va = {int(k): float(v) for k, v in DISPATCH["va"].items()}
    for r in range(len(gen)):
        gen[r, 5] = vm[int(gen[r, 0])]                  # tensão de referência de cada gerador = a do ponto ótimo
    for r in range(len(bus)):
        bus[r, 7] = vm[int(bus[r, 0])]
        bus[r, 8] = float(np.degrees(va[int(bus[r, 0])]))
else:
    print("AVISO: sem --dispatch o despacho vem do OPF do pandapower, que não impõe rateA; use opf_powermodels.py", file=sys.stderr)

gen_out = gen.copy()
gen_out[:, 1] = pg
print(f"Despacho base: {method} | geração {pg.sum():.1f} MW | carga {bus[:,2].sum():.1f} MW | perdas {pg.sum()-bus[:,2].sum():.1f} MW")

# ---- layout (kamada_kawai), escalado para o canvas da interface
g = nx.Graph()
g.add_nodes_from(int(b) for b in bus[:, 0])
for br in branch:
    if br[10] > 0:
        g.add_edge(int(br[0]), int(br[1]))
pos = nx.kamada_kawai_layout(g)
xs = np.array([p[0] for p in pos.values()]); ys = np.array([p[1] for p in pos.values()])
sx = 1700 / (xs.max() - xs.min()); sy = 1100 / (ys.max() - ys.min())
layout = {str(n): [round(float((p[0] - xs.min()) * sx + 60), 1), round(float((p[1] - ys.min()) * sy + 60), 1)] for n, p in pos.items()}

out = {
    "name": pathlib.Path(args.out_json).stem,           # = nome do caso na API (o backend registra pelo nome do arquivo)
    "baseMVA": base_mva,
    "bus": bus.tolist(),
    "gen": gen_out.tolist(),
    "branch": branch.tolist(),
    "layout": layout,
    "dispatchMethod": method,
}
json.dump(out, open(args.out_json, "w", encoding="utf-8"), separators=(",", ":"))
print("gravado:", args.out_json)

# ---- referência DC (pandapower) para validar o solver em JS: caso base e algumas contingências
if args.ref:
    from pandapower.pypower.makeBdc import makeBdc
    from pandapower.pypower.idx_brch import F_BUS, T_BUS, BR_X, TAP, SHIFT, BR_STATUS

    def dc_flows(out_branch_idx=(), out_buses=()):
        """DC com despacho fixo; a barra de referência absorve o desbalanço. Retorna fluxo (MW) por ramo ou None."""
        nb = {int(b): i for i, b in enumerate(bus[:, 0])}
        ref = int([b for b in bus if b[1] == 3][0][0])
        dead = set(out_buses)
        act = [k for k in range(len(branch)) if branch[k, 10] > 0 and k not in out_branch_idx
               and int(branch[k, 0]) not in dead and int(branch[k, 1]) not in dead]
        gg = nx.Graph(); gg.add_nodes_from(nb)
        for k in act:
            gg.add_edge(int(branch[k, 0]), int(branch[k, 1]))
        if ref in dead:
            return None
        comp = nx.node_connected_component(gg, ref)
        nodes = sorted(comp); idx = {n: i for i, n in enumerate(nodes)}
        n = len(nodes)
        B = np.zeros((n, n)); inj = np.zeros(n)
        for k in act:
            f, t = int(branch[k, 0]), int(branch[k, 1])
            if f in comp and t in comp:
                tap = branch[k, 8] if branch[k, 8] != 0 else 1.0
                b = 1.0 / (branch[k, 3] * tap)
                B[idx[f], idx[f]] += b; B[idx[t], idx[t]] += b; B[idx[f], idx[t]] -= b; B[idx[t], idx[f]] -= b
        for r, row in enumerate(gen_out):
            if row[7] > 0 and int(row[0]) in comp:
                inj[idx[int(row[0])]] += row[1] / base_mva
        for row in bus:
            if int(row[0]) in comp:
                inj[idx[int(row[0])]] -= row[2] / base_mva
        keep = [i for i in range(n) if nodes[i] != ref]
        theta = np.zeros(n)
        theta[keep] = np.linalg.solve(B[np.ix_(keep, keep)], inj[keep])
        flows = np.zeros(len(branch))
        for k in act:
            f, t = int(branch[k, 0]), int(branch[k, 1])
            if f in comp and t in comp:
                tap = branch[k, 8] if branch[k, 8] != 0 else 1.0
                flows[k] = (theta[idx[f]] - theta[idx[t]]) / (branch[k, 3] * tap) * base_mva
        return {"flows": flows.round(6).tolist(), "energized": sorted(comp)}

    cases = [{"name": "base", "outBranches": [], "outBuses": []}]
    rng = np.random.default_rng(0)
    for k in rng.choice(len(branch), 6, replace=False):
        cases.append({"name": f"N-1 ramo {int(k)}", "outBranches": [int(k)], "outBuses": []})
    cases.append({"name": "N-3 ramos", "outBranches": [int(x) for x in rng.choice(len(branch), 3, replace=False)], "outBuses": []})
    cases.append({"name": "barra 59 fora", "outBranches": [], "outBuses": [59]})
    cases.append({"name": "barras 11 e 80 fora", "outBranches": [], "outBuses": [11, 80]})
    ref_out = []
    for c in cases:
        r = dc_flows(tuple(c["outBranches"]), tuple(c["outBuses"]))
        if r is not None:
            ref_out.append({**c, **r})
    json.dump({"baseMVA": base_mva, "cases": ref_out}, open(args.ref, "w", encoding="utf-8"), separators=(",", ":"))
    print("referência DC:", args.ref, "|", len(ref_out), "casos")
