# Scale study: GENCO on networks from 14 to 10,000 buses

Question: does GENCO keep its accuracy and gain speed as the network grows? We measured, on **seven networks** (IEEE 14, 30, 57, 118 and GOC 500, 2000 and 10000), the loading error and the **time per scenario**
of the checkpoint published by the authors (`gridfm/genco-pf-datakit`, Tiny, `seed0`; Apache 2.0) against our AC, on randomly drawn **single-line** outages (seed 0).
Results in `docs/escala/<network>.json`; tool `backend/tools/genco_escala.py` (script `backend/tools/rodar_estudo_escala.sh`).

## Summary (read this first)
1. **Accuracy:** on the IEEE networks (14 to 118 buses) GENCO errs by 0.004 to 0.12 % points of loading, about 25 to 500 times less than the DC. **On the three GOC networks (500, 2000 and 10000) GENCO's error is equal to the DC's or worse** (2.4 to 3.4 % points),
   and the error already exists in the base case, with no contingency at all.
2. **Speed:** on CPU GENCO was **2 to 4.5 times slower** than our AC on every network, including the 10,000-bus one. We found no speed gain. **We did not measure on GPU** (the environment here only has PyTorch for CPU);
   the authors measure on an H100 GPU.
3. **Consequence for the project:** GOC stays **out of the interface**; it enters the text as a measurement and a limitation, without claiming a scale gain.

## How the test was done
- State of each scenario: AC-OPF base dispatch (PowerModels), **one line out**, reference bus absorbing the imbalance, no redispatch (the same state as the project's N-1 screening). Outages that island buses are left out.
- **AC = ground truth**: our sparse Newton-Raphson (`backend/app/acpf.py`). Before using it we checked the base case against the PowerModels solution (flat start): voltage difference of 4e-16 to 1e-10 pu and angle difference of up to 7e-9 degrees on the first six networks; on GOC 10000, where the flat start diverges, the check is by the residual of the PowerModels point in our equations (3e-11).
- **Error**: mean, 95th percentile and maximum of the absolute loading difference per line (% points of the limit), GENCO and DC against the AC; and the median error of the network's **maximum loading** (what the screening uses).
- **Time**: median per scenario. AC and DC on CPU, essentially one core. GENCO on CPU with 10 PyTorch threads, building the graph from the tables and running the model, in batches of 16 (4 to 8 on the larger networks). Machine: Windows 11, 12 logical processors, PyTorch 2.8 CPU.
- **AC start:** the "warm" AC times start from the case point (AC-OPF), as an operations tool does when recomputing a contingency. We also measured the flat start, which converges on every network **except GOC 10000**
  (it diverges on 8 of 8 scenarios and on the base case; the case point, however, has a residual of 3e-11, i.e. our model is consistent with PowerModels there too).
- Samples: 60 scenarios (14 to 500 buses; IEEE 14 has only 19 valid outages), 30 (2000) and 12 (10000).

## Accuracy
| Network | Buses | Scenarios | Mean error GENCO / DC (% points) | p95 GENCO / DC | Median error of the maximum loading GENCO / DC | GENCO mean error on the base case (N-0) |
|---|---|---|---|---|---|---|
| IEEE 14 | 14 | 19 | **0.004** / 2.02 | 0.02 / 6.4 | 0.01 / 4.2 | — |
| IEEE 30 | 30 | 38 | **0.033** / 3.20 | 0.11 / 9.3 | 0.05 / 7.6 | — |
| IEEE 57 | 57 | 60 | **0.033** / 2.25 | 0.10 / 8.5 | 0.00 / 1.9 | — |
| IEEE 118 | 118 | 60 | **0.124** / 2.99 | 0.39 / 9.9 | 0.15 / 4.2 | — |
| GOC 500 | 500 | 60 | 2.42 / 2.67 | 8.9 / 8.7 | 0.45 / 2.4 | 2.41 |
| GOC 2000 | 2000 | 30 | 3.37 / 3.40 | 11.8 / 14.1 | **17.2** / 5.0 | 3.34 |
| GOC 10000 | 10000 | 12 | 2.95 / **2.47** | 11.3 / 10.4 | **82.4** / 35.1 | 2.94 |

- On the GOC networks GENCO does not beat the DC on average and, on 2000 and 10000, **it errs on the maximum loading far more than the DC**.
- The base-case error is practically the same as the N-1 one: it **does not come from the contingencies**, it comes from what the model predicts for the network.
- The largest wrong voltage is at the **reference bus**, whose voltage the model treats as an unknown (changing the value we pass does not change the prediction): an error of 0.015 pu on the 500 (predicted 1.0629, AC 1.0476),
  0.045 on the 2000 and 0.039 at the reference of the 10000 (0.074 at the worst point). We did not prove that this explains all of the loading error; we only show where the largest voltage error is.
- The metrics **published by the authors themselves** (their test set) already show the difference: mean active-power residual of 0.004, 0.008, 0.020 and 0.166 MW (IEEE 14, 30, 57 and 118) against **0.76, 0.91 and 1.04 MW** (GOC 500, 2000 and 10000),
  with a worst case of 638, 199 and 3994 MW on the GOC networks.
- Training according to each checkpoint's `config.yaml`: 250,000 scenarios on the IEEE networks and on GOC 500; **20,000** on GOC 2000 and 10000 (less data on the larger ones).

## Speed (ms per scenario, CPU)
| Network | Warm AC | AC flat start | DC | **GENCO total** | = building the graph + model | GENCO / warm AC |
|---|---|---|---|---|---|---|
| IEEE 14 | 12.5 | 15.8 | 0.6 | 28.7 | 15.5 + 13.1 | 2.3× |
| IEEE 30 | 11.9 | 10.1 | 0.6 | 26.5 | 10.2 + 16.3 | 2.2× |
| IEEE 57 | 8.1 | 9.2 | 0.4 | 17.4 | 7.9 + 9.4 | 2.1× |
| IEEE 118 | 8.0 | 10.5 | 0.5 | 30.4 | 12.7 + 17.8 | 3.8× |
| GOC 500 | 14.4 | 20.4 | 1.2 | 64.2 | 19.5 + 44.7 | 4.5× |
| GOC 2000 | 56.7 | 98.3 | 5.2 | 179.3 | 24.8 + 154.5 | 3.2× |
| GOC 10000 | 247.7 | **diverges** (0 of 8) | 20.2 | 986.9 | 59.6 + 927.1 | 4.0× |

GENCO's cost grows with the network in almost the same proportion as that of the sparse AC, and the model (not the graph building) dominates on the large networks. CPU time varies from one run to another (we saw differences of up to 50% between runs, for example on IEEE 118).
One point in GENCO's favor that the measurements show: it does not depend on the initial guess, and the Newton flat start **diverges** on GOC 10000. But with the error above there is no way to use that.

## What this shows and what it does not
- **It shows:** with this checkpoint, these inputs and this CPU, there is no gain in speed or scale, and on the GOC networks the accuracy stops being better than the DC's.
- It does **not** show that GENCO is bad on large networks. Some limits of the test:
  - **GPU not tested.** The authors measure speed on an H100 GPU. The script accepts `DEVICE=cuda` and can be repeated by anyone with a GPU (the collaborator has an RTX 5060).
  - **State outside the training distribution?** We tested the nominal AC-OPF point with one line out. We did not test samples from the authors' own dataset (`gridfm/pf_small_*`), so we did not separate "model limit" from "state different from what it saw".
  - Our AC is a sparse Newton in Python/SciPy, not the PowerModels/datakit one; their AC times may differ.
  - Small samples on the large networks (30 and 12 scenarios); one model and one seed per network.
  - The GOC 10000 checkpoint used is `last.pt` (the card says to use it), copied as `best_model_state_dict.pt`.

## Reproduce
```bash
# cases, dispatches and checkpoints: see docs/REDES_ADICIONAIS.md (IEEE) and the READMEs of the folders models/case{500,2000,10000}_goc_genco_tiny_autores
bash backend/tools/rodar_estudo_escala.sh <python of the GENCO environment> <folder of cases and dispatches>
DEVICE=cuda DST=<folder> bash backend/tools/rodar_estudo_escala.sh <python of the environment with GPU> <folder>     # GENCO on the GPU
```
For the GOC networks: `backend/tools/opf_powermodels.py` (dispatch; 40 s to a few minutes), `backend/tools/export_case.py --no-layout` (the `kamada_kawai` layout is infeasible on large networks) and
`pglib_opf_case<N>_goc.m` in `interface/src/data/`. Why the interface does not include the GOC networks: the corrective plan uses a dense n×n matrix (about 800 MB on the 10000), the N-1 screening of the 10000 would have ~22 thousand
contingencies, the layout does not scale and the replay would not fit in a single file.
