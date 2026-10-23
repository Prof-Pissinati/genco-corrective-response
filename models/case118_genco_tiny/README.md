# GENCO Tiny trained on IEEE 118 (reduced training)

Weights of the **GENCO Tiny** model (`GNS_heterogeneous`, `hidden_size: 12`, 12 layers, ~1.3 M parameters) for the network **`case118_ieee`**, **PowerFlow** task. Trained by the collaborator `leonardp315` with `gridfm-graphkit` (branch `genco-paper-repro`).

| File | What for |
|---|---|
| `best_model_state_dict.pt` | weights of the best validation point (5.3 MB) |
| `normalizer_stats.pt` | normalizer statistics, **needed** at inference |
| `config.yaml` | configuration used in training (`configs/train118_gpu_100ep.yaml`) |
| `case118_ieee_scenario_splits.json` | training/validation/test scenarios (by scenario index) |

SHA-256:
```
2ede897013c63f517be27bf5052250080e7042375b10a57bae2b18174eac0b0d  best_model_state_dict.pt
9e0885eb0ff3bb7593937b5745b4933f29aba0d5a6a0a7feb8c2e8f2d17d9adc  normalizer_stats.pt
```

## How it was trained
- Data: `configs/data_case118.yaml` (gridfm-datakit, PF mode, contingencies up to N-2, **3200 samples**: 800 load scenarios × 4 topology variants, `seed: 0`). Split 2560/320/320.
- Training: 100 epochs, batch 32, GPU (RTX 5060), 34 min. Validation loss 0.030 → 0.0038.
- Test (320 never-seen scenarios): Vm RMSE ≈ 0.0013 p.u. (PQ buses), 0.014 p.u. (reference); Va RMSE ≈ 0.056 rad; mean active-power residual ≈ 1.9 MW.
- Comparison with the DC and timings: see section 4 of the project history (mean line loading error: GENCO 1.9 × DC 2.9 % points; 2.3 ms/scenario on the GPU).

## How to use
Environment: Python 3.12, `torch<2.9`, `gridfm-graphkit` from the `genco-paper-repro` branch, `torch_scatter` shim (`tools/torch_scatter_shim/`). On GPU on Windows, also apply `tools/patch_graphkit_windows_gpu.py`. Details in the root `README.md`.

The data must exist in datakit format (`data/case118/case118_ieee/raw`, generated with `configs/data_case118.yaml`). Predictions (Vm, Va, Pg, Qg per bus) for the test scenarios:

```bash
export MLFLOW_ALLOW_FILE_STORE=true MLFLOW_DISABLE_AGENT_HINT=1 PYTHONIOENCODING=utf-8
gridfm_graphkit predict --config models/case118_genco_tiny/config.yaml \
  --model_path models/case118_genco_tiny/best_model_state_dict.pt \
  --normalizer_stats models/case118_genco_tiny/normalizer_stats.pt \
  --data_path data/case118 --num_workers 0 --output_path saida_predict
# produces saida_predict/case118_ieee_predictions.parquet (columns Vm_pred, Va_pred in rad, ...)
```

The **per-line flow** does not come directly from the model: it is computed from `Vm_pred`/`Va_pred` and the admittances (`Yff`, `Yft`) of `branch_data` (function `genco_flows` in `app/export_data.py`; with the real voltages it reproduces the AC with error < 0.01 MW). To measure inference time: `tools/measure_genco_inference.py`.

## Limitations
- **Reduced training** (the paper uses 250 thousand samples and 200 epochs): it improves on the DC, but still misses overloads near the limit; use with AC confirmation.
- Valid **only for IEEE 118** (GENCO is trained per network) and for the load/topology distribution of the dataset (N-0/N-1/N-2, scaled loads).
- The datakit avoids islands; topologies with de-energized islands are **outside the training**.
