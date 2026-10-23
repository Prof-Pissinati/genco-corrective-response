"""AC (Newton-Raphson, polar coordinates) and DC power flow with fixed dispatch, over the energized island.

The reference bus absorbs the imbalance (and the losses); PV generators keep P and |V|. No Q limits (like the PowerModels
`compute_ac_pf` used by gridfm-datakit in the GENCO training data); Q violations are only reported.
"""
from __future__ import annotations

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix, diags, bmat
from scipy.sparse.linalg import spsolve

from .network import Network


def _branch_admittances(net: Network, bi: np.ndarray):
    ys = 1.0 / (net.br_r[bi] + 1j * net.br_x[bi])
    bc = net.br_b[bi]
    tap = net.br_tap[bi] * np.exp(1j * np.deg2rad(net.br_shift[bi]))
    ytt = ys + 1j * bc / 2.0
    yff = ytt / (tap * np.conj(tap))
    yft = -ys / np.conj(tap)
    ytf = -ys / tap
    return yff, yft, ytf, ytt


def solve_ac(net: Network, bus_mask: np.ndarray, br_mask: np.ndarray, gen_mask: np.ndarray | None = None,
             tol: float = 1e-8, max_it: int = 30, init: str = "flat"):
    """Solves the AC power flow on the energized island. Returns a dict with arrays in the ORIGINAL sizes (zeros outside the island).

    `init`: "flat" (default) starts from flat voltages at the PQ buses and zero angles; "case" starts from the point stored in the case (AC-OPF Vm and Va),
    as an operations tool does when recomputing a contingency from the base case (warm start). It does not change the solution, only the path."""
    nb_full, nl_full, ng_full = net.nb, net.nl, len(net.gen_bus)
    idx = np.flatnonzero(bus_mask)
    n = len(idx)
    remap = -np.ones(nb_full, dtype=int)
    remap[idx] = np.arange(n)
    base = net.base_mva

    bi = np.flatnonzero(br_mask)
    f, t = remap[net.br_f[bi]], remap[net.br_t[bi]]
    yff, yft, ytf, ytt = _branch_admittances(net, bi)
    nl = len(bi)
    rows = np.arange(nl)
    Cf = csr_matrix((np.ones(nl), (rows, f)), shape=(nl, n))
    Ct = csr_matrix((np.ones(nl), (rows, t)), shape=(nl, n))
    Yf = diags(yff) @ Cf + diags(yft) @ Ct
    Yt = diags(ytf) @ Cf + diags(ytt) @ Ct
    ysh = (net.gs[idx] + 1j * net.bs[idx]) / base
    Ybus = (Cf.T @ Yf + Ct.T @ Yt + diags(ysh)).tocsr()

    # in-service generators inside the island
    gmask = net.gen_on & bus_mask[net.gen_bus]
    if gen_mask is not None:
        gmask &= gen_mask
    gi = np.flatnonzero(gmask)
    gb = remap[net.gen_bus[gi]]
    has_gen = np.bincount(gb, minlength=n) > 0

    typ = net.bus_type[idx].copy()
    typ[(typ == 2) & ~has_gen] = 1              # PV without an in-service generator becomes PQ
    ref = remap[net.ref]
    typ[ref] = 3
    typ[(typ == 3) & (np.arange(n) != ref)] = 2
    pv = np.flatnonzero(typ == 2)
    pq = np.flatnonzero(typ == 1)
    pvpq = np.r_[pv, pq]

    # initial/specified voltages: |V| = Vg of the first in-service generator at the PV/ref buses
    vm = np.ones(n)
    first_vg = {}
    for g, b in zip(gi, gb):
        first_vg.setdefault(int(b), net.gen_vg[g])
    for b, vg in first_vg.items():
        if typ[b] in (2, 3):
            vm[b] = vg
    if getattr(net, "bus_vm", None) is not None and not has_gen[ref]:      # reference without an in-service generator (there are such cases, like GOC 500): the case's |V| applies
        vm[ref] = net.bus_vm[idx][ref]
    va = np.zeros(n)
    if init == "case" and getattr(net, "bus_va", None) is not None and getattr(net, "bus_vm", None) is not None:      # initial guess: the case point (AC-OPF), not flat voltages
        va = np.radians(net.bus_va[idx] - net.bus_va[idx][ref])
        vm[pq] = net.bus_vm[idx][pq]
    V = vm * np.exp(1j * va)

    # specified injections (pu): P of all generators - load; Q only at the PQ buses (Qg from the file)
    pg_bus = np.bincount(gb, weights=net.gen_pg[gi], minlength=n)
    qg_bus = np.bincount(gb, weights=net.gen_qg[gi], minlength=n)
    Sbus = ((pg_bus - net.pd[idx]) + 1j * (np.where(typ == 1, qg_bus, 0.0) - net.qd[idx])) / base

    converged, it, err = False, 0, np.inf
    for it in range(max_it + 1):
        Ibus = Ybus @ V
        mis = V * np.conj(Ibus) - Sbus
        F = np.r_[mis[pvpq].real, mis[pq].imag]
        err = float(np.max(np.abs(F))) if len(F) else 0.0
        if err < tol:
            converged = True
            break
        if it == max_it:
            break
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

    out = _empty(nb_full, nl_full, ng_full)
    out.update(converged=converged, iterations=it, mismatch=err)
    if not converged:
        return out

    # buses
    out["vm"][idx] = np.abs(V)
    out["va"][idx] = np.rad2deg(np.angle(V) - np.angle(V[ref]))
    S = V * np.conj(Ybus @ V) * base                       # net injection (MW, MVAr)
    # generators: P of the reference bus and Q of the PV/ref buses come out of the balance
    pg = np.zeros(ng_full)
    qg = np.zeros(ng_full)
    pg[gi] = net.gen_pg[gi]
    qg[gi] = net.gen_qg[gi]
    for b in np.flatnonzero((typ == 3) | (typ == 2)):
        on_b = gi[gb == b]
        if len(on_b) == 0:
            continue
        q_total = S[b].imag + net.qd[idx][b]
        rng = np.maximum(net.gen_qmax[on_b] - net.gen_qmin[on_b], 1e-9)
        qg[on_b] = q_total * rng / rng.sum() if len(on_b) > 1 else q_total
        if typ[b] == 3:
            p_total = S[b].real + net.pd[idx][b]
            pg[on_b] = p_total * np.maximum(net.gen_pmax[on_b], 1e-9) / np.maximum(net.gen_pmax[on_b], 1e-9).sum() if len(on_b) > 1 else p_total
    out["pg"], out["qg"] = pg, qg

    # branch flows (MW, MVAr), at both ends
    Sf = V[f] * np.conj(Yf @ V) * base
    St = V[t] * np.conj(Yt @ V) * base
    out["pf"][bi], out["qf"][bi] = Sf.real, Sf.imag
    out["pt"][bi], out["qt"][bi] = St.real, St.imag
    return out


def solve_dc(net: Network, bus_mask: np.ndarray, br_mask: np.ndarray, gen_mask: np.ndarray | None = None):
    """DC power flow with fixed dispatch; the reference absorbs the imbalance. Same formulation as interface/src/utils/transmission.js."""
    nb_full, nl_full, ng_full = net.nb, net.nl, len(net.gen_bus)
    idx = np.flatnonzero(bus_mask)
    n = len(idx)
    remap = -np.ones(nb_full, dtype=int)
    remap[idx] = np.arange(n)
    base = net.base_mva
    bi = np.flatnonzero(br_mask)
    f, t = remap[net.br_f[bi]], remap[net.br_t[bi]]
    y = 1.0 / (net.br_x[bi] * net.br_tap[bi])
    B = (coo_matrix((np.r_[y, y, -y, -y], (np.r_[f, t, f, t], np.r_[f, t, t, f])), shape=(n, n))).tocsc()

    gmask = net.gen_on & bus_mask[net.gen_bus]
    if gen_mask is not None:
        gmask &= gen_mask
    gi = np.flatnonzero(gmask)
    inj = np.bincount(remap[net.gen_bus[gi]], weights=net.gen_pg[gi], minlength=n) - net.pd[idx]
    inj = inj / base
    ref = remap[net.ref]
    keep = np.flatnonzero(np.arange(n) != ref)
    theta = np.zeros(n)
    if len(keep):
        theta[keep] = spsolve(B[keep][:, keep].tocsc(), inj[keep])

    out = _empty(nb_full, nl_full, ng_full)
    out.update(converged=True, iterations=1, mismatch=0.0)
    out["vm"][idx] = 1.0
    out["va"][idx] = np.rad2deg(theta)
    flow = (theta[f] - theta[t]) * y * base
    out["pf"][bi], out["pt"][bi] = flow, -flow
    pg = np.zeros(ng_full)
    pg[gi] = net.gen_pg[gi]
    out["pg"] = pg
    return out


def _empty(nb, nl, ng):
    return {"vm": np.zeros(nb), "va": np.zeros(nb), "pf": np.zeros(nl), "qf": np.zeros(nl), "pt": np.zeros(nl),
            "qt": np.zeros(nl), "pg": np.zeros(ng), "qg": np.zeros(ng), "converged": False, "iterations": 0, "mismatch": float("nan")}
