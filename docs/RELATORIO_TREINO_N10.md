# Report of the final GENCO Tiny training (IEEE 118, up to N-10)

> Result of the script `docs/TREINO_GENCO.md`. Executed on 2026-10-19. Weights in `models/case118_genco_tiny_n10/`.

## 1. Summary
- **Model:** GENCO Tiny (`GNS_heterogeneous`, H=12, 12 layers, ~1.3 M parameters), trained on **39,761 samples** of IEEE 118 (N-0 to N-10, seed 42), **42 epochs** (early stopping), **3 h 16 min** on a laptop RTX 5060.
- **External validation (177 line outages, the same as for the reduced model):** mean loading error **0.93 % points** (reduced model: 2.08; DC: 2.95); lines ≥ 90% detected **98.8%** (95%; DC 78%); lines ≥ 100% detected **52%** (25%; DC 13%); scenarios that require action (≥ 100%) detected without margin **99.2%** (58%; DC 27%).
- **Training test set (3,974 scenarios, N-0 to N-10, widely varied loads):** mean error **2.02 % points** (DC 3.27); lines ≥ 90% detected **84%** (DC 69%); ≥ 100% **65%** (DC 56%). The error **grows with the number of outages** (1.40 at N-0 to 2.84 at N-6 to N-10).
- **The targets suggested by the script were NOT all reached** (see section 5): overall mean error 2.02 (target ≤ 1.0) and 2.84 at N-6 to N-10 (target ≤ 2.0); per-line detection at 90% on the training test 84% (target ≥ 95%). On the external validation (base state with one line out) the detection at 90% is 98.8%.
- **Speed:** GENCO 2.5 to 3.4 ms per scenario on the GPU (batches 32 to 320) and 8 to 8.5 ms on CPU, against 4.6 ms for the datakit AC and 1.75 ms for the DC on the same scenarios. **On IEEE 118 GENCO still has no speed advantage over the classical AC**; the gain is in accuracy over the DC.

## 2. Data
- Configuration: `configs/data_case118_grande.yaml` (**no changes**): 10,000 load scenarios × 4 topology variants, `k: 10`, outage probabilities `[0.10; 0.13; 0.13; 0.08 × 8]`, `seed: 42`, `num_processes: 16`.
- **Samples generated: 39,761** (the datakit discards the topologies in which the AC power flow does not converge). Generation time: **428 s** (7 min) on the local machine; **530 s** on the 16-core server. Both machines gave **exactly the same number of samples** (seed reproducibility).
- **Distribution by number of lines out** (a result, not the goal): N-0 6,675 (16.8%), N-1 7,422 (18.7%), N-2 5,828 (14.7%), N-3 4,297 (10.8%), N-4 3,943 (9.9%), N-5 3,552 (8.9%), N-6 3,198 (8.0%), N-7 2,478 (6.2%), N-8 1,505 (3.8%), N-9 708 (1.8%), **N-10 155 (0.4%)**. The high ranges ended up under-represented because topologies with many lines out tend not to converge; N-1 to N-3 (the interface's focus) have thousands of samples each.
- Split (by load scenario, `split_by_load_scenario_idx: true`): 80% training, 10% validation, **10% test (3,974 scenarios)**.

## 3. Training
- Configuration: `configs/train118_grande.yaml` (**no changes**): batch 64, up to 60 epochs, `learning_rate 0.0005`, `lr_decay 0.7`, `lr_patience 5`, early stopping with patience 15, GPU, `--num_workers 0`, `seed: 0`.
- **Duration:** 11,773 s (3 h 16 min), **42 epochs** (of 60): ~3.1 min per epoch in steady state (498 iterations at ~2.7 it/s). The first epoch took 8 min 53 s because of other tasks on the same machine; a computer suspension stopped the training for ~39 min at epoch 20.
- **Weight selection rule (from graphkit):** the saved point and the early stopping use the metric **`Validation layer_11_residual`** (power balance residual of the last layer), **not** the validation loss. The best point was **epoch 26** (0.0176); with no improvement in the next 15 epochs, it stopped after epoch 41. **The delivered weights are those of epoch 26.** The lowest validation loss (0.0042) occurred at epoch 41, with a worse residual (0.0183).
- **Validation loss curve** (epochs 0 to 41): 0.0235; 0.0200; 0.0141; 0.0133; 0.0108; 0.0099; 0.0438; 0.0243; 0.0087; 0.0087; 0.0069; 0.0082; 0.0225; 0.0075; 0.0451; 0.0079; 0.0067; 0.0285; 0.0064; 0.0052; 0.0080; 0.0092; 0.0070; 0.0051; 0.0095; 0.0057; 0.0049; 0.0064; 0.0044; 0.0054; **0.1002**; 0.0086; 0.0078; 0.0069; 0.0064; 0.0054; 0.0055; 0.0055; 0.0047; 0.0068; 0.0084; 0.0042. **The training is unstable**: there are spikes (up to 0.1002 at epoch 30) that recover in 1 to 2 epochs, and the loss oscillates between 0.004 and 0.009 from epoch 20 on, with no clear decrease. Perhaps a larger batch or a smaller learning rate would stabilize it; it was not tested.
- Final graphkit test (epoch 26 weights, 3,974 scenarios, all outages): Vm RMSE 0.0021 pu (PQ buses), 0.0132 pu (reference); Va RMSE 0.064 rad; mean active-power residual 2.24 MW; **maximum PBE 499.5 MW** (isolated extreme cases).

## 4. Versions and environment
- PyTorch **2.8.0+cu128**, CUDA 12.8; `gridfm-graphkit` branch `genco-paper-repro`, commit **`95b90eecc7f5c2c86a9dd776f0c3f40434def22f`** (with `tools/patch_graphkit_windows_gpu.py` applied); `gridfm-datakit` **1.1.0**; `lightning` 2.6.6; `torch-geometric` 2.8.0; `juliacall` 0.9.36; Python 3.12; `torch_scatter` through the substitute `tools/torch_scatter_shim/`.
- Local machine: Windows 11, NVIDIA RTX 5060 Laptop (8 GB), Intel Core Ultra 9 275HX. Replica server: Ubuntu, NVIDIA L40S (shared GPU, 16 GB of VRAM, 16 reserved cores).
- Note: graphkit installs `torchaudio 2.11.0` together with `torch 2.8.0` (not pinned); no effect was observed in training or inference.

## 5. Results on the training test set, by number of outages
All tables come from `tools/avaliar_por_saidas.py` (3,974 scenarios; **outages = lines with `br_status` 0**; generator outages do not count). Definitions: AC loading = larger end / rateA (ground truth); GENCO = flow computed from the predicted Vm/Va and the admittances; DC = datakit DC flow. **Per line:** "real" = AC ≥ threshold, "detected" = estimate ≥ threshold, no margin. **Per scenario:** critical = some line above the threshold (at 100%: > 1 + 1e-4); "5-pt margin" sends the scenario to the AC if any estimate ≥ threshold − 5 points.

**Reading:** GENCO is better than the DC in **every** range and on every error and recall metric; the mean error, however, rises from 1.40 (N-0) to 2.84 % points (N-6 to N-10) and the precision drops. At 100% the per-line recall goes from 47% (N-0) to 73% (N-6 to N-10): the base case already has lines at the exact limit, and an error of 1 to 2 points changes the classification. Per scenario, at 90% GENCO detects 100% of the critical scenarios, but **almost every scenario has some line near the limit**, so the 5-point margin sends ~100% to the AC (the per-scenario screening does not save work on this network, as already measured).

| Outages | Scenarios | Lines | Mean error GENCO / DC (% pts) | Max error GENCO / DC | Vm RMSE (pu) | Va RMSE (rad) | Mean P residual (MW) |
|---|---|---|---|---|---|---|---|
| N-0 | 649 | 120714 | **1.40** / 2.97 | 59.8 / 56.3 | 0.0013 | 0.035 | 1.69 |
| N-1 | 747 | 138195 | **1.54** / 3.05 | 153.2 / 128.2 | 0.0014 | 0.040 | 1.80 |
| N-2 | 582 | 107088 | **1.71** / 3.14 | 71.6 / 65.7 | 0.0015 | 0.045 | 1.94 |
| N-3 | 444 | 81252 | **2.06** / 3.29 | 236.6 / 123.0 | 0.0017 | 0.062 | 2.35 |
| N-4 to N-5 | 729 | 132301 | **2.39** / 3.42 | 175.0 / 117.0 | 0.0021 | 0.077 | 2.59 |
| N-6 to N-10 | 823 | 147282 | **2.84** / 3.67 | 235.9 / 198.0 | 0.0029 | 0.089 | 2.93 |
| Overall | 3974 | 726832 | **2.02** / 3.27 | 236.6 / 198.0 | 0.0020 | 0.063 | 2.24 |

**Detection per line, threshold 80%** (recall / precision; misses and false alarms in parentheses)

| Outages | Actual lines | GENCO recall | GENCO precision | GENCO (misses / FP) | DC recall | DC precision | DC (misses / FP) |
|---|---|---|---|---|---|---|---|
| N-0 | 5024 | **92%** | 95% | 389 / 254 | 81% | 98% | 978 / 92 |
| N-1 | 6154 | **92%** | 94% | 491 / 352 | 81% | 97% | 1189 / 140 |
| N-2 | 5067 | **90%** | 94% | 488 / 269 | 80% | 98% | 1024 / 87 |
| N-3 | 4123 | **90%** | 93% | 398 / 293 | 80% | 97% | 819 / 89 |
| N-4 to N-5 | 7210 | **89%** | 93% | 808 / 497 | 81% | 97% | 1380 / 174 |
| N-6 to N-10 | 8840 | **87%** | 91% | 1107 / 732 | 81% | 97% | 1704 / 218 |
| Overall | 36418 | **90%** | 93% | 3681 / 2397 | 81% | 97% | 7094 / 800 |

**Detection per line, threshold 90%** (recall / precision; misses and false alarms in parentheses)

| Outages | Actual lines | GENCO recall | GENCO precision | GENCO (misses / FP) | DC recall | DC precision | DC (misses / FP) |
|---|---|---|---|---|---|---|---|
| N-0 | 3376 | **88%** | 95% | 416 / 168 | 67% | 98% | 1117 / 50 |
| N-1 | 4172 | **86%** | 94% | 566 / 228 | 66% | 98% | 1426 / 61 |
| N-2 | 3482 | **84%** | 95% | 541 / 167 | 67% | 98% | 1146 / 48 |
| N-3 | 2858 | **85%** | 92% | 430 / 198 | 70% | 97% | 865 / 59 |
| N-4 to N-5 | 5100 | **83%** | 92% | 874 / 376 | 72% | 97% | 1437 / 97 |
| N-6 to N-10 | 6338 | **82%** | 91% | 1161 / 531 | 72% | 97% | 1796 / 160 |
| Overall | 25326 | **84%** | 93% | 3988 / 1668 | 69% | 97% | 7787 / 475 |

**Detection per line, threshold 100%** (recall / precision; misses and false alarms in parentheses)

| Outages | Actual lines | GENCO recall | GENCO precision | GENCO (misses / FP) | DC recall | DC precision | DC (misses / FP) |
|---|---|---|---|---|---|---|---|
| N-0 | 1411 | **47%** | 60% | 742 / 447 | 43% | 64% | 806 / 346 |
| N-1 | 1748 | **56%** | 65% | 776 / 532 | 46% | 65% | 940 / 435 |
| N-2 | 1643 | **60%** | 73% | 664 / 363 | 50% | 76% | 821 / 258 |
| N-3 | 1479 | **67%** | 77% | 490 / 302 | 57% | 80% | 634 / 207 |
| N-4 to N-5 | 2950 | **69%** | 82% | 912 / 459 | 60% | 88% | 1189 / 242 |
| N-6 to N-10 | 3894 | **73%** | 84% | 1059 / 557 | 63% | 91% | 1437 / 233 |
| Overall | 13125 | **65%** | 76% | 4643 / 2660 | 56% | 81% | 5827 / 1721 |

**Detection per scenario, threshold 80%** (critical scenario = some line above the threshold; margin = % points below the threshold that already send the scenario to the AC)

| Outages | Critical | GENCO no margin | GENCO 5-pt margin (sent to the AC) | DC no margin | DC 5-pt margin (sent to the AC) |
|---|---|---|---|---|---|
| N-0 | 649 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-1 | 747 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-2 | 582 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-3 | 444 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-4 to N-5 | 729 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-6 to N-10 | 823 | **100%** | 100% (100%) | 100% | 100% (100%) |
| Overall | 3974 | **100%** | 100% (100%) | 100% | 100% (100%) |

**Detection per scenario, threshold 90%** (critical scenario = some line above the threshold; margin = % points below the threshold that already send the scenario to the AC)

| Outages | Critical | GENCO no margin | GENCO 5-pt margin (sent to the AC) | DC no margin | DC 5-pt margin (sent to the AC) |
|---|---|---|---|---|---|
| N-0 | 648 | **100%** | 100% (100%) | 99% | 100% (100%) |
| N-1 | 747 | **99%** | 100% (100%) | 99% | 100% (100%) |
| N-2 | 580 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-3 | 443 | **100%** | 100% (100%) | 99% | 100% (100%) |
| N-4 to N-5 | 729 | **100%** | 100% (100%) | 100% | 100% (100%) |
| N-6 to N-10 | 822 | **100%** | 100% (100%) | 100% | 100% (100%) |
| Overall | 3969 | **100%** | 100% (100%) | 99% | 100% (100%) |

**Detection per scenario, threshold 100%** (critical scenario = some line above the threshold; margin = % points below the threshold that already send the scenario to the AC)

| Outages | Critical | GENCO no margin | GENCO 5-pt margin (sent to the AC) | DC no margin | DC 5-pt margin (sent to the AC) |
|---|---|---|---|---|---|
| N-0 | 119 | **95%** | 100% (98%) | 93% | 98% (93%) |
| N-1 | 598 | **90%** | 99% (98%) | 85% | 95% (94%) |
| N-2 | 520 | **92%** | 100% (99%) | 87% | 97% (96%) |
| N-3 | 407 | **95%** | 100% (99%) | 90% | 98% (97%) |
| N-4 to N-5 | 703 | **95%** | 99% (99%) | 90% | 97% (96%) |
| N-6 to N-10 | 797 | **97%** | 99% (99%) | 94% | 98% (98%) |
| Overall | 3144 | **94%** | 99% (99%) | 90% | 97% (96%) |


## 6. External validation on the 177 line outages (comparable to the reduced model)
State GENCO saw in training: **AC-OPF base dispatch, one line out, the reference absorbing the imbalance, no redispatch** (`backend/tools/genco_screening.py`; 177 of the 186 lines, 9 island buses and are left out). Raw result in `interface/src/data/screening_case118_ieee.json` (it is the active result; the reduced model's was archived in `screening_case118_ieee_reduzido.json`).

| Metric (177 scenarios) | **GENCO Tiny N-10 (this training)** | GENCO Tiny reduced | DC |
|---|---|---|---|
| Mean loading error (% points) | **0.93** | 2.08 | 2.95 |
| Maximum error (% points), one *outlier* | 136.5 | 256.6 | 132.0 |
| Lines ≥ 90% detected (recall / precision) | **98.8%** / 98.9% | 95% / 97.5% | 78% / 98.0% |
| Lines ≥ 100% detected (recall / precision) | **52%** / 78.6% | 25% | 13.3% / 83.9% |
| Scenarios that require action (≥ 100%; 119 of 177) detected, no margin | **99.2%** (precision 68.6%; 172/177 sent to the AC) | 58% | 27% |
| Same, with a 5-point margin | 100% (177/177 go to the AC) | 100% (177/177) | 100% |
| Time per scenario on CPU (this computer) | 7.1 ms | 49.5 ms (another computer) | 0.4 ms |
| Backend exact AC (this computer) | 7.2 ms | | |

**Honest reading:** the larger training **improves accuracy a lot** relative to the reduced model: the mean error falls from 2.08 to 0.93 and the detection at 100% rises from 25% to 52%. The DC is much worse (13%). Even so, **48% of the lines that are really ≥ 100% are still not detected** by GENCO alone, so the final plan still requires confirmation by the AC. The CPU time numbers are not comparable with those of the reduced model (different computers).

## 7. Inference time (3,974 test scenarios; includes reading the scenarios from disk, assembling the batches and the forward pass; warm-up pass discarded)
| Device | Batch | ms per scenario |
|---|---|---|
| GPU RTX 5060 | 32 | 3.41 |
| GPU RTX 5060 | 160 | 2.78 |
| GPU RTX 5060 | 320 | **2.54** |
| CPU (Core Ultra 9 275HX) | 32 | 8.51 |
| CPU | 160 | 8.08 |
| **Exact AC** (PowerModels, datakit, on the same scenarios) | | **4.59** |
| **DC** (datakit) | | **1.75** |
| Project backend AC / backend DC (178 base+N-1 scenarios) | | 7.2 / 0.4 |

On IEEE 118 GENCO on the GPU is about **1.8 times faster than the datakit AC** and **1.5 times slower than the DC**; on CPU it is slower than the AC. The network is too small for the speed gain to appear, which agrees with the project's earlier measurements.

Minimal **in-memory** inference example (without reading the whole dataset): `tools/genco_inferencia_exemplo.py` (base + 182 N-1 outages of a scenario in ~1.5 s on the GPU; it matches `evaluate` to ~1e-6 in Vm/Va).

## 8. What changed relative to the script and what is pending
**Changes:**
- **Dates:** the script planned the weights delivery for Oct 18; the training was done on Oct 19 (absolute limit Oct 21).
- **Data generation:** 7 min (the script estimated 35 min to 1 h).
- **Epochs:** 42, not 60: early stopping (patience 15) on the last layer's residual.
- **Weights:** those of epoch 26 (best residual), not those of the last epoch nor those of lowest validation loss.
- **Configurations:** both YAML files were used **without changes** (copies in `models/case118_genco_tiny_n10/config.yaml` and `configs/`).
- **Replica server (Ubuntu, shared GPU):** the training was ~18 times slower (0.14 it/s) due to too many PyTorch threads in a container with 16 cores of a 192-core server (fixed by limiting `OMP_NUM_THREADS=4`, 2.6 to 2.9 it/s, same as the laptop). Batch 256 measured 115 s per epoch against ~172 s for batch 64 (competing with another run). These speed tests **do not change the delivered weights**.

**Pending:**
- **Replica on the server** (same configuration, another machine, 2.6 to 2.9 it/s): in progress at the time of writing; its results are not in this report.
- **Dataset on Hugging Face / GitHub Release:** **not published** (awaiting authorization). To regenerate: `gridfm_datakit generate configs/data_case118_grande.yaml` (`seed: 42`, 39,761 samples, ~7 min).
- **Unstable training:** spikes in the validation loss; a larger batch or a smaller learning rate is worth testing.
- **N-9/N-10 ranges** with few samples (708 and 155) and error targets not reached in the high ranges.
- **Comparison with the Small model (H=24):** not done (no time).
- **Islands:** GENCO never saw isolated buses; 9 of the 186 lines island buses and were left out of the validation.
