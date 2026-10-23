"""Step 0 of the voltage correction: what would an AC-OPF (with voltage limits) do in the contingencies where our plan ends with voltage out of range?

For each network and each SINGLE contingency (line or bus) that requires a plan:
  1. backend plan (active-power LP + AC verification): which buses end up outside the voltage range;
  2. for those that do, PowerModels AC-OPF (Ipopt) on the post-fault network, with the loads ALREADY shed by our plan, in two versions:
       V1  free dispatch and voltages (redispatch + generator reference voltage);
       V2  dispatch FIXED at the values of our plan (only the reference bus absorbs) and only the generator voltage free = what a Vg adjustment would do.
  3. compares: feasibility, generation cost, how far the dispatch is from our plan.
The AC-OPF respects the voltage limits by construction; what is measured is whether a solution exists and at what cost.

Runs in the GENCO environment (gridfm-datakit + Julia/PowerModels via juliacall), from the repository root:
    python backend/tools/exp_tensao_opf.py --rede case118_ieee --dst docs/escala/tensao_case118_ieee.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tools"))
from app.corrective import plan_corrective        # noqa: E402
from app.evaluate import TOL_VOLTAGE              # noqa: E402
from app.network import load_case                 # noqa: E402
from app.screening import screen                  # noqa: E402
from genco_screening import gencost_from_m        # noqa: E402

JULIA = r'''
using PowerModels, Ipopt
const JuMP = PowerModels.JuMP          # JuMP comes with PowerModels (it is not a direct package of this environment)
PowerModels.silence()
function pos_falta(path::String, branch_out::Vector{Int}, bus_out::Vector{Int}, lbus::Vector{Int}, lpd::Vector{Float64}, lqd::Vector{Float64},
                   fixgen::Vector{Int}, fixpg::Vector{Float64}, tlim::Float64)
    data = PowerModels.parse_file(path)
    base = data["baseMVA"]
    for k in branch_out; data["branch"][string(k)]["br_status"] = 0; end
    for b in bus_out; data["bus"][string(b)]["bus_type"] = 4; end
    for (id, l) in data["load"]
        i = findfirst(==(l["load_bus"]), lbus)
        if i !== nothing; l["pd"] = lpd[i] / base; l["qd"] = lqd[i] / base; end
    end
    for (j, g) in enumerate(fixgen)                       # V2: fixed dispatch (pmin = pmax = plan value)
        gen = data["gen"][string(g)]
        p = fixpg[j] / base
        gen["pmin"] = p; gen["pmax"] = p
    end
    PowerModels.propagate_topology_status!(data)
    PowerModels.select_largest_component!(data)
    opt = JuMP.optimizer_with_attributes(Ipopt.Optimizer, "print_level" => 0, "max_cpu_time" => tlim)
    res = PowerModels.solve_ac_opf(data, opt)
    return res
end
'''


def custo(net, cost, pg):
    on = net.gen_on
    return float(sum(cost[g][0] * pg[g] ** 2 + cost[g][1] * pg[g] + cost[g][2] for g in range(len(pg)) if on[g]))


def main(a):
    from juliacall import Main as jl
    from juliacall import convert as jconv
    import gridfm_datakit  # noqa: F401  (inicializa o ambiente Julia)
    jl.seval(JULIA)
    data = ROOT / "interface" / "src" / "data"
    caso_m = (data / f"pglib_opf_{a.rede}.m").resolve().as_posix()
    net = load_case(data / f"{a.rede}.json")
    cost = gencost_from_m(data / f"pglib_opf_{a.rede}.m")
    ref_bus_gens = [g for g in range(len(net.gen_bus)) if net.gen_bus[g] == net.ref]
    lbus = [int(net.bus_no[i]) for i in range(net.nb)]

    def vec(T, xs):
        return jconv(jl.Vector[T], list(xs))

    scr = screen(net)
    cont = [c for c in scr["contingencies"] if c["needsAction"]]
    linhas = []
    t0 = time.perf_counter()
    for c in cont:
        bo, bu = ([c["id"]], []) if c["type"] == "line" else ([], [c["id"]])
        r = plan_corrective(net, bo, bu)
        after = r["after"]
        if not after["converged"]:
            continue
        bmap = {b["id"]: b["vm"] for b in after["buses"]}
        lim = {int(net.bus_no[i]): (net.vmin[i], net.vmax[i]) for i in range(net.nb)}
        exc = [(max(bmap[n] - lim[n][1], lim[n][0] - bmap[n]), n) for n in bmap if bmap[n] > lim[n][1] + TOL_VOLTAGE or bmap[n] < lim[n][0] - TOL_VOLTAGE]
        linha = {"label": c["label"], "tipo": c["type"], "violacoesTensao": len(exc), "maiorExcessoPu": round(max([e for e, _ in exc], default=0.0), 4),
                 "cortePlanoMW": r["plan"]["totalShedMW"], "sobrecargasApos": r["summary"]["overloadsAfter"]}
        linhas.append(linha)
        if not exc or a.so_contar:
            continue
        # plan loads (MW per bus) and plan dispatch (MW per generator)
        pd2 = net.pd.copy()
        for s in r["plan"]["shed"]:
            pd2[net.bus_index([s["bus"]])[0]] -= s["mw"]
        scale = np.where(net.pd > 1e-9, pd2 / np.where(net.pd > 1e-9, net.pd, 1.0), 1.0)
        qd2 = net.qd * scale
        pg_plan = np.zeros(len(net.gen_bus))
        for g in after["gens"]:
            pg_plan[g["id"]] = g["pg"]
        cost_plan = custo(net, cost, pg_plan)
        linha["custoPlano"] = round(cost_plan, 1)
        bo_j = vec(jl.Int, [k + 1 for k in bo]); bu_j = vec(jl.Int, bu)
        for nome, fix in (("V1", False), ("V2", True)):
            fixg = [g for g in range(len(net.gen_bus)) if net.gen_on[g] and net.gen_bus[g] != net.ref and net.gen_bus[g] not in bu] if fix else []
            try:
                res = jl.pos_falta(caso_m, bo_j, bu_j, vec(jl.Int, lbus), vec(jl.Float64, pd2), vec(jl.Float64, qd2),
                                   vec(jl.Int, [g + 1 for g in fixg]), vec(jl.Float64, [pg_plan[g] for g in fixg]), 60.0)
                status = str(res["termination_status"])
                ok = status in ("LOCALLY_SOLVED", "ALMOST_LOCALLY_SOLVED")
                out = {"status": status, "viavel": bool(ok)}
                if ok:
                    sol = res["solution"]
                    vms = [float(v["vm"]) for v in sol["bus"].values()]
                    pgs = {int(k): float(v["pg"]) * 100.0 for k, v in sol["gen"].items()}
                    pg_opf = np.array([pgs.get(g + 1, 0.0) for g in range(len(net.gen_bus))])
                    bus_sol = sol["bus"]
                    out["vg"] = [round(float(bus_sol[str(int(net.bus_no[net.gen_bus[g]]))]["vm"]), 6) if str(int(net.bus_no[net.gen_bus[g]])) in bus_sol else None
                                 for g in range(len(net.gen_bus))]     # voltage at each generator's bus (case table); None if the bus was isolated (outside the solution)
                    out["pgMW"] = [round(float(pgs.get(g + 1, 0.0)), 3) for g in range(len(net.gen_bus))]
                    out.update({"custo": round(float(res["objective"]), 1), "custoRelativoAoPlano": round(float(res["objective"]) / cost_plan - 1, 4) if cost_plan > 0 else None,
                                "despachoMudaMW": round(float(np.abs(pg_opf - pg_plan).sum() / 2), 2), "vmMin": round(min(vms), 4), "vmMax": round(max(vms), 4)})
                linha[nome] = out
            except Exception as e:  # noqa: BLE001
                linha[nome] = {"viavel": False, "status": f"error: {type(e).__name__}: {str(e)[:80]}"}
        print(f"{a.rede} {c['label']:>14}: voltage viol {len(exc)} (max {linha['maiorExcessoPu']}) shed {linha['cortePlanoMW']:.1f} MW | V1 {linha['V1'].get('viavel')} V2 {linha['V2'].get('viavel')}", flush=True)
    viol = [l for l in linhas if l["violacoesTensao"] > 0]
    resumo = {"rede": a.rede, "contingenciasComPlano": len(linhas), "comViolacaoDeTensao": len(viol),
              "planosComCorteECViol": sum(1 for l in viol if l["cortePlanoMW"] > 0.05),
              "V1viavel": sum(1 for l in viol if l.get("V1", {}).get("viavel")), "V2viavel": sum(1 for l in viol if l.get("V2", {}).get("viavel")),
              "segundos": round(time.perf_counter() - t0, 1)}
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    Path(a.dst).write_text(json.dumps({"resumo": resumo, "contingencias": linhas}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rede", default="case118_ieee")
    ap.add_argument("--dst", required=True)
    ap.add_argument("--so-contar", action="store_true", help="only counts the voltage violations of the plans, without running the AC-OPF")
    main(ap.parse_args())
