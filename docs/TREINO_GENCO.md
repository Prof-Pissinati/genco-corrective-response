# Final GENCO training script (IEEE 118)

> **STATUS (2026-10-19): training delivered** (39,761 samples, up to N-10, 42 epochs): weights in `models/case118_genco_tiny_n10/`, report in `docs/RELATORIO_TREINO_N10.md`, independent validation in `docs/GENCO_VARREDURA.md`. The script below is kept as a record of what was requested.
>
> For whoever does the heavier training. Written on 2026-10-08 and **updated on 2026-10-12** (the project scope changed from
> "restoration by switching" to **corrective response to contingencies**; see `docs/ARQUITETURA.md`).

## 1. Why this training
The system evaluates **many contingencies** (the network with some lines/buses out: the N-1 screening of all lines and buses and the combinations the operator marks, typically N-1 to N-3) and needs a fast evaluator that is **accurate near the loading limits**. The current model is a reduced training: good for validating the workflow, but **weak exactly at the 100% limit** (see §2). The final plan is always confirmed by the AC; GENCO serves for screening.

## 2. Starting point (already measured, IEEE 118, GENCO Tiny)
The weights of this reduced training are already published in `models/case118_genco_tiny/` (see the folder's README). **The GENCO integration in the interface can start with them** and swap in the final weights later, without changing the contract.

| Item | Current value |
|---|---|
| Data | 3,200 samples (800 load scenarios × 4 variants), contingencies up to **N-2** (`configs/data_case118.yaml`) |
| Training | 100 epochs, batch 32, RTX 5060 GPU: **34 min** (~22 s/epoch; CPU ~54 s/epoch) |
| Validation loss | 0.030 → **0.0038** |
| Mean line loading error (320 test scenarios) | **GENCO 1.94 % points** × DC 2.88 |
| Overload detection (90% threshold) | **GENCO 86%** × DC 67% (at 100%: 54% × 46%) |
| Inference | GPU 2.34 ms/scenario, CPU 7.43; exact AC 5.0; DC 1.07 |

**External validation done by the project (Oct 12):** 177 line outages of IEEE 118 (AC-OPF base dispatch, one line out, the reference bus absorbing the imbalance, no redispatch), compared with the backend AC (`docs/GENCO_VARREDURA.md`):

| Metric | GENCO Tiny reduced | DC |
|---|---|---|
| Mean loading error | **2.08 % points** | 2.95 |
| Lines ≥ 90% detected | **95%** (precision 97.5%) | 78% |
| Lines ≥ 100% detected | **25%** | 13% |
| Scenarios that require action (≥ 100%) detected, no margin | 58% | 27% |
| Time per scenario (CPU, this project) | 49.5 ms (backend AC 15.4; DC 0.9) | |

**Limitation:** near the limit the model still misses many overloads. This is hard by nature here: the IEEE 118 base case already has lines **exactly at the limit** (active OPF constraint), so an error of 1 to 2 % points flips the classification. The goal of the larger training is to improve the **detection at 100% in N-1 to N-3** and the error in those ranges.

## 3. What to train (proposal; the person in charge can adjust it and must record what changes)
- **Model:** GENCO **Tiny** (as in the paper). If time remains, compare with **Small** (H=24, ~5M parameters); record cost and gain.
- **Data:** `configs/data_case118_grande.yaml` → **40,000 samples** (10,000 scenarios × 4 variants), contingencies up to **N-10**, with N-0 at 10% (the repaired state) and N-1/N-2 at 13% each, `seed: 42`.
- **Training:** `configs/train118_grande.yaml` → up to **60 epochs**, batch 64, early stopping with patience 15, GPU.
- **Why N-10:** the paper trains up to N-2 and tests up to N-20 (GENCO generalizes, but with a larger residual). Training with more lines out covers combined contingencies better. **If time is short, prioritize N-1 to N-3** (it is what the interface uses most).
- **Out of scope for this training:** separately energized islands, OPF and other networks (see §7).

### Time budget (estimate, from 22 s/epoch with 2,560 samples ≈ 8.6 ms/sample/epoch on the RTX 5060)
| Samples | Epochs | Estimated training time |
|---|---|---|
| 20,000 | 50 | ~2.4 h |
| **40,000** | **60** | **~5.7 h** (recommended) |
| 100,000 | 50 | ~12 h |

Generating the data took ~164 s for 3,200 samples with 16 processes (≈ 50 ms/sample); 40,000 samples should take ~35 min to 1 h (estimate; high N-k may take longer). **Measure the first epoch and re-evaluate the plan.**

## 4. Step by step
Environment: the same as the machine with a GPU (PyTorch 2.8 + CUDA 12.8; graphkit from the `genco-paper-repro` branch; `tools/patch_graphkit_windows_gpu.py` applied; `torch_scatter` shim). Variables: `MLFLOW_ALLOW_FILE_STORE=true`, `PYTHONIOENCODING=utf-8`. Run it from Bash.
```bash
# 1) data (creates data/case118_grande/case118_ieee/raw)
gridfm_datakit generate configs/data_case118_grande.yaml

# 2) training
gridfm_graphkit train --config configs/train118_grande.yaml --data_path data/case118_grande \
  --num_workers 0 --exp_name final118 --run_name tiny_n10

# 3) evaluation with saved predictions and reference AC/DC metrics
gridfm_graphkit evaluate --config configs/train118_grande.yaml --data_path data/case118_grande --num_workers 0 \
  --model_path <run>/artifacts/model/best_model_state_dict.pt \
  --normalizer_stats <run>/artifacts/stats/normalizer_stats.pt \
  --compute_dc_ac_metrics --save_output --exp_name final118 --run_name tiny_n10_eval
```
If the validation loss is still falling at the end of the epochs, continue with `finetune` (same arguments + `--model_path`).

## 5. How to evaluate (mandatory report)
Reuse the validated per-line flow formula (`app/export_data.py`) and compare **GENCO × DC × exact AC**, on the test set (split by load scenario), **separating by number of outages** (N-0, N-1, N-2, N-3…N-5, N-6…N-10):
1. Mean and maximum line loading error (% points).
2. Overload detection at the 80%, 90% and 100% thresholds: hits, misses and false alarms.
3. Voltage error (Vm, Va) and power balance residual.
4. Inference time (GPU and CPU, per scenario, with batches of 32/160/320) and the exact AC as a reference.

**Suggested targets (proposals, not results):** mean loading error ≤ 1.0 % point overall and ≤ 2.0 on N-6…N-10; detection at 90% ≥ 95%. If they are not reached, report what was obtained; the final plan is always confirmed by the AC.

## 6. What to deliver (and where)
1. **Weights** `best_model_state_dict.pt` and **`normalizer_stats.pt`** (without the statistics the model does not work outside training), following the convention already used in this repository: folder **`models/case118_genco_tiny_n10/`** (suggested name; the `.gitignore` already allows `models/**/*.pt`) with `config.yaml`, the splits file, and a `README.md` with SHA-256, data, metrics and usage instructions, following `models/case118_genco_tiny/README.md`. Do not overwrite the reduced-training folder. If any file exceeds ~50 MB (e.g. the Small model), use a **GitHub Release** or **Hugging Face** and leave the link in the folder's README.
2. **Exact configurations** used (the two YAML files + any change) and the **seed**.
3. **Versions:** `gridfm-graphkit` commit (`genco-paper-repro` branch), `gridfm-datakit` version, PyTorch/CUDA.
4. **Metrics report** (§5), in `docs/` and with the table by number of outages.
5. **Dataset:** if possible publish it on Hugging Face (reproducibility, a challenge criterion); otherwise, describe how to regenerate it (config + seed).
6. **Minimal in-memory inference example** (a script that loads weights + normalization and predicts for a list of topologies **without** reading the whole dataset from disk). It is what the backend needs to call GENCO in the screening. `tools/measure_genco_inference.py` currently uses graphkit's `evaluate`.
7. **Tell the group** when the weights are in the repository. The **validation on the 177 line outages can be redone here in a few minutes, with inference only** (no training needed): `backend/tools/genco_screening.py` (see `docs/GENCO_VARREDURA.md`).

**Deadlines:** the backend starts integrating GENCO on **Oct 18** (Phase 5). **Weights delivered by Oct 18; absolute limit Oct 21** (after that the submission uses the classical evaluator and GENCO stays as a partial result (the submission text already states the result of the reduced training)).

## 7. Open points (decide with the group)
- **Partial/islanded states:** the datakit avoids islands, so GENCO never saw isolated buses. The interface evaluates only the island with the reference bus; 9 of the 186 lines island buses and were left out of the validation (the backend AC handles them). If GENCO is used in those cases, measure the error and, if it turns out bad, always confirm with the AC.
- **Larger network (e.g. GOC-500):** the current measurement showed that, on IEEE 118, GENCO is only ~2× faster than the AC and ~2× slower than the DC, and the hybrid screening sent ~99% of the scenarios to the AC (no time saved). The speed argument may require a larger network or evaluation in large batches; decide whether it is worth training a larger network too or whether the submission's argument will be accuracy.
- **Generation redispatch (OPF):** out of scope; the dispatch is fixed.
- **Small × Tiny:** only if there is time.
