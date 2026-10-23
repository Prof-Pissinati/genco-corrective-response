# GENCO Tiny trained on IEEE 118 (final training, up to N-10)

Weights of the **GENCO Tiny** (`GNS_heterogeneous`, `hidden_size: 12`, 12 layers, ~1.3 M parameters) for the network **`case118_ieee`**, **PowerFlow** task, trained on **39,761 samples** (contingencies up to N-10). For use in the interface, it replaces the reduced training of `models/case118_genco_tiny/` (which stays intact). Full report: `docs/RELATORIO_TREINO_N10.md`.

| File | What for |
|---|---|
| `best_model_state_dict.pt` | weights of the best point (**epoch 26**, best last-layer residual), 5.3 MB |
| `normalizer_stats.pt` | normalizer statistics, **needed** at inference (without it the model does not work) |
| `config.yaml` | configuration used in training (`configs/train118_grande.yaml`, no changes) |
| `case118_ieee_scenario_splits.json` | training/validation/test scenarios (by scenario index; test = 3,974) |

SHA-256:
```
ddde2b2bdb95452c240b75777a4d587de4ff8d96bb086e694998e7498fd068b3  best_model_state_dict.pt
ee9ab4ef26763b3174547c2f000f5d7a46999800412d491f620b40872f0f2fa2  normalizer_stats.pt
```

## How it was trained
- **Data:** `configs/data_case118_grande.yaml` (gridfm-datakit 1.1.0, PF mode, `k: 10`, `seed: 42`; outage probabilities N-0 10%, N-1 13%, N-2 13%, N-3 to N-10 8%). It yielded **39,761 samples** in ~7 min (the datakit discards the topologies in which the AC does not converge, so the high ranges have fewer: N-9 708, N-10 155). Dataset **not published**; to regenerate, run the command above with the same configuration.
- **Training:** batch 64, up to 60 epochs, `learning_rate 0.0005`, patience 15; GPU (RTX 5060). It stopped at epoch 42 (early stopping); 3 h 16 min. The saved weights are those of epoch 26, chosen by graphkit through the metric `Validation layer_11_residual`.
- **Versions:** PyTorch 2.8.0+cu128; `gridfm-graphkit` branch `genco-paper-repro`, commit `95b90eecc7f5c2c86a9dd776f0c3f40434def22f`; `gridfm-datakit` 1.1.0; Lightning 2.6.6; Python 3.12.

## Results (summary; tables by number of outages in the report)
- **External validation, 177 line outages** (base dispatch, one line out, no redispatch): mean loading error **0.93 % points** (reduced 2.08; DC 2.95); lines ≥ 90% detected **98.8%**; ≥ 100% **52%** (reduced 25%; DC 13%); scenarios that require action detected without margin **99.2%** (precision 68.6%).
- **Training test (3,974 scenarios, N-0 to N-10):** mean error 2.02 % points (DC 3.27), from 1.40 at N-0 to 2.84 at N-6 to N-10; lines ≥ 90% detected 84% (DC 69%); ≥ 100% 65% (DC 56%).
- **Speed:** 2.5 to 3.4 ms per scenario on the GPU and ~8 ms on CPU (includes reading from disk and assembling batches); datakit AC 4.6 ms; DC 1.75 ms. No speed advantage over the AC on IEEE 118.

## How to use
Environment: Python 3.12, `torch==2.8.0`, `gridfm-graphkit` from the `genco-paper-repro` branch (commit above), `torch_scatter` shim (`tools/torch_scatter_shim/`); on GPU on Windows, `tools/patch_graphkit_windows_gpu.py`. Details in the root `README.md`.

**In memory** (without reading the whole dataset; it is what the backend needs): `tools/genco_inferencia_exemplo.py` loads weights + normalization and predicts Vm/Va for a list of topologies assembled in memory (`GencoEmMemoria.prever`); the loading per line comes from `carregamento(vm, va, branch_df)`:
```bash
python tools/genco_inferencia_exemplo.py --modelo models/case118_genco_tiny_n10 --raw data/case118_grande/case118_ieee/raw --cenario 15848 --device cuda
```

**Through graphkit** (dataset test set):
```bash
export MLFLOW_ALLOW_FILE_STORE=true MLFLOW_DISABLE_AGENT_HINT=1 PYTHONIOENCODING=utf-8
gridfm_graphkit evaluate --config models/case118_genco_tiny_n10/config.yaml \
  --model_path models/case118_genco_tiny_n10/best_model_state_dict.pt \
  --normalizer_stats models/case118_genco_tiny_n10/normalizer_stats.pt \
  --data_path data/case118_grande --num_workers 0 --save_output
```

The **per-line flow** does not come directly from the model: it is computed from `Vm_pred`/`Va_pred` and the `branch_data` admittances (with the real voltages it reproduces the AC with error < 0.01 MW).

## Limitations
- **It does not replace the AC:** near the limit (≥ 100%) it detects only 52% (external validation) to 65% (test) of the lines; the final plan must be confirmed by the AC.
- Valid **only for IEEE 118** and for the load/topology distribution of the dataset. Isolated buses (islands) were **outside the training**.
- **Unstable training** (spikes in the validation loss) and an error that grows with the number of outages (2.84 % points at N-6 to N-10); the N-9/N-10 ranges have few samples.
