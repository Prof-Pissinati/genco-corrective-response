"""Classical comparator for the N-1 screening: a few Newton–Raphson steps started from the pre-outage AC solution (IEEE 118).

The question an expert asks of a neural triage is "and one Newton step from the base case?". For every single-line outage that does not island the grid
(the same 177 states as the screening: AC-OPF base dispatch, one line out, the reference bus absorbing the imbalance, no redispatch), this starts Newton–Raphson
from the base-case point (the AC-OPF Vm and Va stored in the case, the state before the outage), takes 1, 2 or 3 steps WITHOUT iterating to convergence,
and compares the line loadings with the converged AC (the same way as the screening compares GENCO and the DC). It also times the steps.

Runs with the backend environment (numpy and scipy only):  python backend/tools/comparador_newton_um_passo.py [--dst docs/escala/newton_um_passo_case118_ieee.json]
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.sparse import bmat, csr_matrix, diags
from scipy.sparse.linalg import spsolve

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.acpf import _branch_admittances, solve_ac, solve_dc          # noqa: E402
from app.network import load_case, topology_masks                      # noqa: E402

CASE_JSON = ROOT / "interface" / "src" / "data" / "case118_ieee.json"
GENCO_JSON = ROOT / "interface" / "src" / "data" / "screening_case118_ieee_autores.json"


def newton_steps(net, br_mask, max_steps):
    """Voltages after 1..max_steps Newton steps from the case point; returns [V1, V2, ...] and the time of each step (ms). The grid is not islanded."""
    n = net.nb
    base = net.base_mva
    bi = np.flatnonzero(br_mask)
    f, t = net.br_f[bi], net.br_t[bi]
    yff, yft, ytf, ytt = _branch_admittances(net, bi)
    nl = len(bi)
    rows = np.arange(nl)
    Cf = csr_matrix((np.ones(nl), (rows, f)), shape=(nl, n))
    Ct = csr_matrix((np.ones(nl), (rows, t)), shape=(nl, n))
    Yf = diags(yff) @ Cf + diags(yft) @ Ct
    Yt = diags(ytf) @ Cf + diags(ytt) @ Ct
    ysh = (net.gs + 1j * net.bs) / base
    Ybus = (Cf.T @ Yf + Ct.T @ Yt + diags(ysh)).tocsr()
    gi = np.flatnonzero(net.gen_on)
    gb = net.gen_bus[gi]
    has_gen = np.bincount(gb, minlength=n) > 0
    typ = net.bus_type.copy()
    typ[(typ == 2) & ~has_gen] = 1
    ref = net.ref
    typ[ref] = 3
    typ[(typ == 3) & (np.arange(n) != ref)] = 2
    pv, pq = np.flatnonzero(typ == 2), np.flatnonzero(typ == 1)
    pvpq = np.r_[pv, pq]
    vm = np.ones(n)
    first_vg = {}
    for g, b in zip(gi, gb):
        first_vg.setdefault(int(b), net.gen_vg[g])
    for b, vg in first_vg.items():
        if typ[b] in (2, 3):
            vm[b] = vg
    va = np.radians(net.bus_va - net.bus_va[ref])
    vm[pq] = net.bus_vm[pq]
    pg_bus = np.bincount(gb, weights=net.gen_pg[gi], minlength=n)
    qg_bus = np.bincount(gb, weights=net.gen_qg[gi], minlength=n)
    Sbus = ((pg_bus - net.pd) + 1j * (np.where(typ == 1, qg_bus, 0.0) - net.qd)) / base
    V = vm * np.exp(1j * va)
    out, times = [], []
    for _ in range(max_steps):
        t0 = time.perf_counter()
        Ibus = Ybus @ V
        mis = V * np.conj(Ibus) - Sbus
        F = np.r_[mis[pvpq].real, mis[pq].imag]
        diagV, diagI = diags(V), diags(Ibus)
        diagVn = diags(V / np.abs(V))
        dS_dVm = diagV @ np.conj(Ybus @ diagVn) + np.conj(diagI) @ diagVn
        dS_dVa = 1j * diagV @ np.conj(diagI - Ybus @ diagV)
        J = bmat([[dS_dVa[pvpq][:, pvpq].real, dS_dVm[pvpq][:, pq].real],
                  [dS_dVa[pq][:, pvpq].imag, dS_dVm[pq][:, pq].imag]], format="csc")
        dx = spsolve(J, -F)
        va[pvpq] += dx[:len(pvpq)]
        vm[pq] += dx[len(pvpq):]
        V = vm * np.exp(1j * va)
        times.append((time.perf_counter() - t0) * 1000)
        out.append(V.copy())
    return out, times, (Yf, Yt, f, t, bi)


def loading(net, V, parts):
    Yf, Yt, f, t, bi = parts
    Sf = V[f] * np.conj(Yf @ V) * net.base_mva
    St = V[t] * np.conj(Yt @ V) * net.base_mva
    load = np.zeros(net.nl)
    rate = net.br_rate[bi]
    load[bi] = np.where(rate > 0, np.maximum(np.abs(Sf), np.abs(St)) / np.where(rate > 0, rate, 1), 0.0)
    return load


def main(dst, steps=3):
    net = load_case(CASE_JSON)
    rate = net.br_rate
    errs = {k: [] for k in range(1, steps + 1)}
    errs_dc = []
    ac_all, nr_all, dc_all = [], {k: [] for k in range(1, steps + 1)}, []
    maxes = {"ac": [], "dc": [], **{k: [] for k in range(1, steps + 1)}}
    ms = {k: [] for k in range(1, steps + 1)}
    n_scen = 0
    skipped = []
    for k in range(net.nl):
        bm, brm = topology_masks(net, [k], [])
        if not bm.all():
            skipped.append(k)
            continue
        ac = solve_ac(net, bm, brm)
        if not ac["converged"]:
            skipped.append(k)
            continue
        dc = solve_dc(net, bm, brm)
        on = brm & (rate > 0)
        la = np.where(on, np.maximum(np.hypot(ac["pf"], ac["qf"]), np.hypot(ac["pt"], ac["qt"])) / np.where(rate > 0, rate, 1), 0.0)
        ld = np.where(on, np.abs(dc["pf"]) / np.where(rate > 0, rate, 1), 0.0)
        Vs, times, parts = newton_steps(net, brm, steps)
        ac_all.append(la[on]); dc_all.append(ld[on]); maxes["ac"].append(la.max()); maxes["dc"].append(ld.max())
        for j, V in enumerate(Vs, 1):
            ln = loading(net, V, parts)
            nr_all[j].append(ln[on]); maxes[j].append(ln.max()); ms[j].append(sum(times[:j]))
        n_scen += 1
    A = np.concatenate(ac_all)

    def mae(x):
        return float(np.mean(np.abs(np.concatenate(x) - A)) * 100)

    def recall(x, th):
        P = np.concatenate(x)
        return float(((P >= th) & (A >= th)).sum() / max((A >= th).sum(), 1) * 100), float(((P >= th) & (A >= th)).sum() / max((P >= th).sum(), 1) * 100)

    def referred(m, margin):
        return int((np.array(m) * 100 >= 100 - margin).sum())

    res = {"scenarios": n_scen, "skipped": len(skipped), "methods": {}}
    gj = json.loads(GENCO_JSON.read_text(encoding="utf-8"))
    res["methods"]["genco_authors"] = {"maePct": gj["loadingMAE_pct"]["genco"], "recall90": round(gj["lineLevel"]["genco"]["0.9"]["recall"] * 100, 1),
                                       "recall100": round(gj["lineLevel"]["genco"]["1.0"]["recall"] * 100, 1),
                                       "scenariosFlagged": {m: gj["scenarioLevel"]["genco"][m]["flagged"] for m in ("0", "5", "10")}}
    res["methods"]["dc"] = {"maePct": round(mae(dc_all), 3), "recall90": round(recall(dc_all, 0.9)[0], 1), "recall100": round(recall(dc_all, 1.0)[0], 1),
                            "scenariosFlagged": {str(m): referred(maxes["dc"], m) for m in (0, 5, 10)}}
    for j in range(1, steps + 1):
        res["methods"][f"newton_{j}_step"] = {"maePct": round(mae(nr_all[j]), 3), "recall90": round(recall(nr_all[j], 0.9)[0], 1),
                                              "recall100": round(recall(nr_all[j], 1.0)[0], 1),
                                              "scenariosFlagged": {str(m): referred(maxes[j], m) for m in (0, 5, 10)},
                                              "msPerScenario": round(float(np.mean(ms[j])), 2)}
    res["scenariosCritical"] = int((np.array(maxes["ac"]) * 100 > 100.01).sum())
    Path(dst).write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"{n_scen} scenarios ({len(skipped)} skipped), critical (AC max loading > 100%): {res['scenariosCritical']}")
    print(f"{'method':16s} {'MAE pt':>7s} {'recall>=90%':>12s} {'recall>=100%':>13s}  flagged (margin 0/5/10)   ms")
    for name, r in res["methods"].items():
        fl = r["scenariosFlagged"]
        print(f"{name:16s} {r['maePct']:7.3f} {r['recall90']:11.1f}% {r['recall100']:12.1f}%  {fl.get('0')}/{fl.get('5')}/{fl.get('10')}        {r.get('msPerScenario', '')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dst", default=str(ROOT / "docs" / "escala" / "newton_um_passo_case118_ieee.json"))
    a = ap.parse_args()
    main(a.dst)
