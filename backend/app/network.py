"""Transmission network model (MATPOWER tables) and topology handling (branches/buses out, islands).

Conventions (docs/CONTRATO_API.md): buses identified by the MATPOWER NUMBER (BUS_I); branches by the row index in the
`branch` table (from 0); powers in MW/MVAr; voltage in pu; angles in degrees.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import breadth_first_order

REF = 3


@dataclass
class Network:
    name: str
    base_mva: float
    # buses
    bus_no: np.ndarray      # MATPOWER number
    bus_type: np.ndarray
    pd: np.ndarray
    qd: np.ndarray
    gs: np.ndarray
    bs: np.ndarray
    vmin: np.ndarray
    vmax: np.ndarray
    base_kv: np.ndarray
    # geradores
    gen_bus: np.ndarray     # internal bus index (0..nb-1)
    gen_pg: np.ndarray
    gen_qg: np.ndarray
    gen_vg: np.ndarray
    gen_qmin: np.ndarray
    gen_qmax: np.ndarray
    gen_pmin: np.ndarray
    gen_pmax: np.ndarray
    gen_on: np.ndarray
    # branches
    br_f: np.ndarray        # internal index
    br_t: np.ndarray
    br_r: np.ndarray
    br_x: np.ndarray
    br_b: np.ndarray
    br_tap: np.ndarray
    br_shift: np.ndarray
    br_on: np.ndarray
    br_rate: np.ndarray
    ref: int = 0
    dispatch_adjusted: bool = False
    bus_vm: np.ndarray | None = None      # |V| of each bus in the case file; used at the reference when it has no in-service generator and as the AC initial guess
    bus_va: np.ndarray | None = None      # angle (degrees) of each bus in the case file; AC initial guess

    @property
    def nb(self) -> int:
        return len(self.bus_no)

    @property
    def nl(self) -> int:
        return len(self.br_f)

    def line_name(self, k: int) -> str:
        """Branch name to display: "49–54", or "49–54 A" / "49–54 B" when there are parallel circuits between the same buses
        (the letter follows the branch order in the table: the first is A). Same rule as the interface (utils/parallel.js)."""
        a, b = int(self.bus_no[self.br_f[k]]), int(self.bus_no[self.br_t[k]])
        par = {a, b}
        same = [i for i in range(self.nl) if {int(self.bus_no[self.br_f[i]]), int(self.bus_no[self.br_t[i]])} == par]
        return f"{a}–{b}" + (f" {chr(ord('A') + same.index(k))}" if len(same) > 1 else "")

    def bus_index(self, numbers) -> np.ndarray:
        lookup = {int(n): i for i, n in enumerate(self.bus_no)}
        return np.array([lookup[int(n)] for n in numbers], dtype=int)


def from_mpc(mpc: dict, name: str = "case", rebalance: bool = True) -> Network:
    """Creates the network from MATPOWER tables {baseMVA, bus, gen, branch} (lists of numeric rows).

    If the dispatch in the file differs from the total load by more than 10% (PGLib OPF cases come with an initial Pg that does not match),
    it rebalances: scales the existing Pg respecting Pmax or, if it does not fit, distributes the load proportionally to Pmax.
    It is the same rule as interface/src/utils/transmission.js.
    """
    bus = np.array(mpc["bus"], dtype=float)
    gen = np.array(mpc["gen"], dtype=float).reshape(-1, 10) if len(mpc["gen"]) else np.zeros((0, 10))
    br = np.array(mpc["branch"], dtype=float)
    no = bus[:, 0].astype(int)
    lookup = {int(n): i for i, n in enumerate(no)}

    gen_pg = gen[:, 1].copy()
    gen_pmax = gen[:, 8].copy()
    gen_on = gen[:, 7] > 0
    adjusted = False
    total_load = bus[:, 2].sum()
    pg_sum = gen_pg[gen_on].sum()
    if rebalance and gen_on.any() and total_load > 0 and abs(pg_sum - total_load) > 0.10 * total_load:
        pmax_sum = np.clip(gen_pmax[gen_on], 0, None).sum()
        k = total_load / pg_sum if pg_sum > 1e-6 else 0.0
        scaled = gen_pg[gen_on] * k
        fits = k > 0 and np.all(scaled <= np.clip(gen_pmax[gen_on], 0, None) + 1e-9)
        if fits:
            gen_pg[gen_on] = scaled
        else:
            gen_pg[gen_on] = np.clip(gen_pmax[gen_on], 0, None) / pmax_sum * total_load if pmax_sum > 0 else 0.0
        adjusted = True

    ref_rows = np.flatnonzero(bus[:, 1] == REF)
    ref = int(ref_rows[0]) if len(ref_rows) else 0
    tap = np.where(br[:, 8] != 0, br[:, 8], 1.0)
    return Network(
        name=name, base_mva=float(mpc["baseMVA"]),
        bus_no=no, bus_type=bus[:, 1].astype(int), pd=bus[:, 2], qd=bus[:, 3], gs=bus[:, 4], bs=bus[:, 5],
        vmin=bus[:, 12], vmax=bus[:, 11], base_kv=bus[:, 9],
        gen_bus=np.array([lookup[int(b)] for b in gen[:, 0]], dtype=int), gen_pg=gen_pg, gen_qg=gen[:, 2],
        gen_vg=gen[:, 5], gen_qmin=gen[:, 4], gen_qmax=gen[:, 3], gen_pmin=gen[:, 9], gen_pmax=gen_pmax, gen_on=gen_on,
        br_f=np.array([lookup[int(b)] for b in br[:, 0]], dtype=int), br_t=np.array([lookup[int(b)] for b in br[:, 1]], dtype=int),
        br_r=br[:, 2], br_x=br[:, 3], br_b=br[:, 4], br_tap=tap, br_shift=br[:, 9], br_on=br[:, 10] > 0, br_rate=br[:, 5],
        ref=ref, dispatch_adjusted=adjusted, bus_vm=bus[:, 7].copy(), bus_va=bus[:, 8].copy(),
    )


def load_case(path: str | Path) -> Network:
    """Reads a case JSON (generated by backend/tools/export_case.py): {name, baseMVA, bus, gen, branch, ...}.
    The dispatch in the file already comes from an AC-OPF, so it is not rebalanced."""
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    return from_mpc(d, name=d.get("name", Path(path).stem), rebalance=False)


def topology_masks(net: Network, branch_out=(), bus_out=()):
    """Returns (bus_mask, br_mask): energized buses and active branches.

    Only the island that contains the reference bus is energized (see contract). A faulted bus goes out together with all its incident branches.
    """
    dead = np.zeros(net.nb, dtype=bool)
    if len(bus_out):
        dead[net.bus_index(bus_out)] = True
    br_active = net.br_on.copy()
    if len(branch_out):
        br_active[np.array(list(branch_out), dtype=int)] = False
    br_active &= ~dead[net.br_f] & ~dead[net.br_t]

    if dead[net.ref]:
        return np.zeros(net.nb, dtype=bool), np.zeros(net.nl, dtype=bool)

    idx = np.flatnonzero(br_active)
    adj = coo_matrix((np.ones(len(idx)), (net.br_f[idx], net.br_t[idx])), shape=(net.nb, net.nb)).tocsr()
    order = breadth_first_order(adj, net.ref, directed=False, return_predecessors=False)
    bus_mask = np.zeros(net.nb, dtype=bool)
    bus_mask[order] = True
    br_mask = br_active & bus_mask[net.br_f] & bus_mask[net.br_t]
    return bus_mask, br_mask
