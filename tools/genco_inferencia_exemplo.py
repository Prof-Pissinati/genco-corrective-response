"""Minimal example of GENCO IN-MEMORY inference, without reading the whole dataset from disk.

Loads weights + normalization and predicts Vm/Va (and the loading per line) for a LIST of topologies assembled in memory.
Here the topologies are "the base state and each line out", starting from the rows of ONE datakit scenario; to use it in the backend,
just pass DataFrames in the same format (bus_data, gen_data, branch_data of a scenario) built from your states.

Usage (environment with gridfm-graphkit; --device cuda or cpu):
  python tools/genco_inferencia_exemplo.py --modelo models/case118_genco_tiny_n10 --raw data/case118_grande/case118_ieee/raw \
         --cenario 5 --device cuda

Format expected per topology (datakit columns):
  bus_df    one row per bus (sorted by `bus` = 0..n-1): Pd, Qd, Pg, Qg, Vm, Va, PQ, PV, REF, vn_kv, min_vm_pu, max_vm_pu, GS, BS, + min_q_mvar, max_q_mvar (sums of the generators at the bus)
  gen_df    one row per generator: bus, p_mw, q_mvar, min/max_p_mw, min/max_q_mvar, cp0/cp1/cp2, in_service, is_slack_gen
  branch_df one row per branch: from_bus, to_bus, Yff/Yft/Ytf/Ytt (r e i), tap, shift, ang_min, ang_max, rate_a, br_status, ...
Line out = br_status 0 (and zeroed admittances). The "target" columns (Vm, Va, pf...) do not influence the prediction: they are masked.
"""
import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import yaml
from torch_geometric.data import Batch

from gridfm_graphkit.datasets.globals import VA_OUT, VM_OUT
from gridfm_graphkit.datasets.hetero_preprocess import build_hetero_data_for_scenario
from gridfm_graphkit.io.param_handler import NestedNamespace, get_task, get_task_transforms, load_normalizer
from gridfm_graphkit.training.callbacks import adapt_state_dict_for_model


class GencoEmMemoria:
    """Model + normalizer + task transformations, ready to predict lists of topologies."""

    def __init__(self, pasta_modelo, device="cpu", pesos="best_model_state_dict.pt"):
        pasta = Path(pasta_modelo)
        self.args = NestedNamespace(**yaml.safe_load((pasta / "config.yaml").read_text(encoding="utf-8")))
        rede = self.args.data.networks[0]
        self.normalizador = load_normalizer(args=self.args)
        stats = torch.load(pasta / "normalizer_stats.pt", map_location="cpu", weights_only=True)
        self.normalizador.fit_from_dict(stats[rede])
        self.tarefa = get_task(self.args, [self.normalizador])
        estado = adapt_state_dict_for_model(torch.load(pasta / pesos, map_location="cpu"), self.tarefa)
        self.tarefa.load_state_dict(estado)
        self.device = torch.device(device)
        self.tarefa.eval().to(self.device)
        self.transformacoes = get_task_transforms(self.args)

    tempos = None            # if it is a dict {"montagem": 0.0, "modelo": 0.0}, `prever` adds here the seconds spent building the graphs and in the model

    @torch.no_grad()
    def prever(self, topologias, lote=160):
        """topologias: list of (bus_df, gen_df, branch_df). Returns (Vm, Va) with shape (n_topologies, n_buses); Va in radians."""
        vms, vas = [], []
        for i in range(0, len(topologias), lote):
            t0 = time.perf_counter()
            grafos = []
            for k, (b, g, br) in enumerate(topologias[i:i + lote]):
                d = build_hetero_data_for_scenario(i + k, b, g, br)
                self.normalizador.transform(data=d)          # same order as the dataset: normalizes and then applies the masks
                grafos.append(self.transformacoes(d))
            batch = Batch.from_data_list(grafos).to(self.device)
            t1 = time.perf_counter()
            saida = self.tarefa.forward(x_dict=batch.x_dict, edge_index_dict=batch.edge_index_dict,
                                        edge_attr_dict=batch.edge_attr_dict, mask_dict=batch.mask_dict)
            self.normalizador.inverse_output(saida, batch)    # back to the original units (pu and rad)
            if self.tempos is not None:
                self.tempos["montagem"] += t1 - t0
                self.tempos["modelo"] += time.perf_counter() - t1
            n = len(grafos)
            vms.append(saida["bus"][:, VM_OUT].reshape(n, -1).cpu().numpy())
            vas.append(saida["bus"][:, VA_OUT].reshape(n, -1).cpu().numpy())
        return np.concatenate(vms), np.concatenate(vas)


def carregamento(vm, va, branch_df, base_mva=100.0):
    """Loading per branch (larger end / rateA) from predicted Vm/Va and the branch_df admittances (validated formula)."""
    v = vm * np.exp(1j * va)
    f, t = branch_df.from_bus.to_numpy(), branch_df.to_bus.to_numpy()
    c = lambda a, b: branch_df[a].to_numpy() + 1j * branch_df[b].to_numpy()
    sf = np.abs(v[f] * np.conj(c("Yff_r", "Yff_i") * v[f] + c("Yft_r", "Yft_i") * v[t]))
    st = np.abs(v[t] * np.conj(c("Ytf_r", "Ytf_i") * v[f] + c("Ytt_r", "Ytt_i") * v[t]))
    rate = branch_df.rate_a.to_numpy()
    return np.where((branch_df.br_status.to_numpy() == 1) & (rate > 0), np.maximum(sf, st) * base_mva / np.where(rate > 0, rate, 1), 0.0)


def topologias_n1(bus_df, gen_df, branch_df):
    """Base state + one line out at a time (the admittances of the line out are zeroed)."""
    cols_y = [c for c in branch_df.columns if c.startswith(("Yff", "Yft", "Ytf", "Ytt"))]
    out = [(bus_df, gen_df, branch_df)]
    for k in branch_df.index[branch_df.br_status == 1]:
        br = branch_df.copy()
        br.loc[k, "br_status"] = 0
        br.loc[k, cols_y] = 0.0
        out.append((bus_df, gen_df, br))
    return out


def ler_cenario(raw: Path, cenario: int):
    """Reads ONLY the rows of one scenario (Parquet filter), without loading the whole dataset."""
    f = [("scenario", "==", cenario)]
    bus = pd.read_parquet(raw / "bus_data.parquet", filters=f).sort_values("bus").reset_index(drop=True)
    gen = pd.read_parquet(raw / "gen_data.parquet", filters=f).sort_values("idx").reset_index(drop=True)
    br = pd.read_parquet(raw / "branch_data.parquet", filters=f).sort_values("idx").reset_index(drop=True)
    agg = gen.groupby("bus")[["min_q_mvar", "max_q_mvar"]].sum().reset_index()
    bus = bus.merge(agg, on="bus", how="left").fillna(0)             # same preprocessing as the graphkit
    return bus, gen, br


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", required=True, help="folder with config.yaml, best_model_state_dict.pt and normalizer_stats.pt")
    ap.add_argument("--raw", required=True, help="datakit raw folder (we only read one scenario)")
    ap.add_argument("--cenario", type=int, default=0)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--lote", type=int, default=160)
    a = ap.parse_args()

    bus, gen, br = ler_cenario(Path(a.raw), a.cenario)
    topologias = topologias_n1(bus, gen, br)
    modelo = GencoEmMemoria(a.modelo, a.device)
    modelo.prever(topologias[:2], lote=2)                              # warm-up
    if a.device.startswith("cuda"):
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    vm, va = modelo.prever(topologias, lote=a.lote)
    if a.device.startswith("cuda"):
        torch.cuda.synchronize()
    dt = time.perf_counter() - t0
    print(f"{len(topologias)} topologies (base + N-1) in {dt * 1000:.1f} ms = {dt * 1000 / len(topologias):.2f} ms per topology ({a.device})")

    # checks against the datakit AC solution for the base state (scenario read from disk just for this comparison)
    c0 = carregamento(vm[0], va[0], br)
    ac = np.maximum(np.hypot(br.pf, br.qf), np.hypot(br.pt, br.qt)).to_numpy() / br.rate_a.to_numpy()
    print(f"base state: mean loading error {np.mean(np.abs(c0 - ac)) * 100:.2f} pts %, |dVm| max {np.max(np.abs(vm[0] - bus.Vm.to_numpy())):.4f} pu")
    pior = [(float(carregamento(vm[i], va[i], topologias[i][2]).max()), i) for i in range(1, len(topologias))]
    pior.sort(reverse=True)
    print("5 line outages with the highest predicted maximum loading:")
    for ld, i in pior[:5]:
        k = [j for j in range(len(br)) if br.br_status[j] == 1 and topologias[i][2].br_status[j] == 0][0]   # the line that THIS topology opened (the base scenario may already have others out)
        print(f"  line {int(br.from_bus[k])}-{int(br.to_bus[k])}: maximum loading {ld * 100:.1f}%")
