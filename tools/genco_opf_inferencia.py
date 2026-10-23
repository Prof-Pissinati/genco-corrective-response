"""In-memory inference of GENCO in OPF mode (optimal dispatch and voltages), in the same table format as `genco_inferencia_exemplo.py`.

In OPF mode the model receives the loads, the limits and the costs and PREDICTS: the voltage (Vm, Va) of each bus, the active power of each in-service generator and the
reactive power of the generation buses. The voltage of each bus is limited by construction (sigmoid) between `min_vm_pu` and `max_vm_pu`, and the dispatch of each generator
between `min_p_mw` and `max_p_mw`: the model never returns voltage out of range. What it can get wrong is the power balance, so the output must be checked in an AC power flow.

Usage (environment with gridfm-graphkit):
    from genco_opf_inferencia import GencoOPF
    g = GencoOPF("models/case118_genco_opf_small_autores", pesos="last.pt")
    r = g.prever_opf(topologias)      # topologias = list of (bus_df, gen_df, branch_df)
    r["vm"], r["va"] (n, n_buses; va in radians), r["pg_gen"] (n, n_generators of the table; 0 for out-of-service), r["qg_bus"] (n, n_buses)
"""
import sys
from pathlib import Path

import numpy as np
import torch
from torch_geometric.data import Batch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from genco_inferencia_exemplo import GencoEmMemoria   # noqa: E402
from gridfm_graphkit.datasets.globals import PG_OUT_GEN, QG_OUT, VA_OUT, VM_OUT   # noqa: E402
from gridfm_graphkit.datasets.hetero_preprocess import build_hetero_data_for_scenario   # noqa: E402


class GencoOPF(GencoEmMemoria):
    """Loader of an OPF checkpoint (config.yaml with `task_name: OptimalPowerFlow`)."""

    @torch.no_grad()
    def prever_opf(self, topologias, lote=64):
        vms, vas, qgs, pgs = [], [], [], []
        for i in range(0, len(topologias), lote):
            grafos, ativos, ngen = [], [], []
            for k, (b, g, br) in enumerate(topologias[i:i + lote]):
                d = build_hetero_data_for_scenario(i + k, b, g, br)
                self.normalizador.transform(data=d)
                grafos.append(self.transformacoes(d))
                ativos.append(np.flatnonzero(g["in_service"].to_numpy() == 1))      # the graph only has in-service generators, in table order
                ngen.append(len(g))
            batch = Batch.from_data_list(grafos).to(self.device)
            saida = self.tarefa.forward(x_dict=batch.x_dict, edge_index_dict=batch.edge_index_dict,
                                        edge_attr_dict=batch.edge_attr_dict, mask_dict=batch.mask_dict)
            self.normalizador.inverse_output(saida, batch)
            n = len(grafos)
            vms.append(saida["bus"][:, VM_OUT].reshape(n, -1).cpu().numpy())
            vas.append(saida["bus"][:, VA_OUT].reshape(n, -1).cpu().numpy())
            qgs.append(saida["bus"][:, QG_OUT].reshape(n, -1).cpu().numpy())
            pg_todos = saida["gen"][:, PG_OUT_GEN].cpu().numpy()
            gb = batch["gen"].batch.cpu().numpy()
            for j in range(n):
                v = np.zeros(ngen[j])
                v[ativos[j]] = pg_todos[gb == j]
                pgs.append(v)
        return {"vm": np.concatenate(vms), "va": np.concatenate(vas), "qg_bus": np.concatenate(qgs), "pg_gen": np.array(pgs)}
