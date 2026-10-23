# GENCO validation on the N-1 screening (IEEE 118)

Result and recipe to reproduce it. Data and numbers are in `interface/src/data/screening_case118_ieee_n10.json` (**GENCO Tiny N-10**, our training). The "N-1 screening" panel now uses the authors' checkpoint (`screening_case118_ieee_autores.json`, see `docs/GENCO_CHECKPOINT_AUTORES.md`);
the earlier reduced model was archived in `screening_case118_ieee_reduzido.json`.

## What was measured
For each **line outage** of IEEE 118 (177 of the 186; 9 island buses and the datakit avoids islands) we built the state GENCO saw in training:
AC-OPF base dispatch, one line out and the **reference bus absorbing the imbalance** (no redispatch). We ran GENCO on those states
and compared the predicted loading (computed from the predicted Vm/Va) with the **backend AC** and with the **DC**.

| Metric (177 scenarios, post-fault state without redispatch) | **GENCO Tiny N-10** | GENCO Tiny reduced | DC |
|---|---|---|---|
| Training | 39,761 samples, up to N-10, 42 epochs | 3,200 samples, up to N-2, 100 epochs | – |
| Mean loading error | **0.93 % points** | 2.08 | 2.95 |
| Lines ≥ 90% detected (recall / precision) | **98.8%** / 98.9% | 95% / 97.5% | 78% / 98.0% |
| Lines ≥ 100% detected (recall / precision) | **52%** / 78.6% | 25% | 13% / 83.9% |
| Scenarios that require action (≥ 100%; 119 of 177) detected, no margin | **99.2%** (172 of 177 go to the AC) | 58% | 27% |
| With a 5-point margin | 100% (177/177 go to the AC) | 100% | 100% |
| Time per scenario, CPU (project computer) | 18.9 ms (backend AC 17.6; DC 1.1) | 49.5 ms (another computer) | 1.1 ms |

Independent check: the collaborator's numbers (report in `docs/RELATORIO_TREINO_N10.md`) were **reproduced** on the project computer with the delivered weights
(`models/case118_genco_tiny_n10/`, SHA-256 checked): same metrics; the largest difference in the predicted loading of a line was 0.01 % points.

## Honest reading
- The larger training **improves GENCO a lot**: the mean error falls from 2.08 to 0.93 and detection at 100% rises from 25% to 52%. The DC stays far behind (13%).
- Even so, **48% of the lines that are really ≥ 100% are still not detected** by GENCO alone: the base case already has lines **exactly at the limit** (active OPF constraint), and an error of 1 to 2 points flips the classification. That is why the final plan is always **confirmed by the AC**.
- **Hybrid screening:** per scenario, GENCO without margin catches 99.2% of the critical scenarios, but with a 5-point margin almost all of them go to the AC (on this network almost every scenario has some line near the limit): there is no AC saving.
- **Speed:** on CPU GENCO (18.9 ms) is slightly slower than the backend's own AC (17.6 ms). The collaborator measured, on the GPU, 2.5 ms per scenario against 4.6 ms for the datakit AC and 1.75 ms for the DC. The 118-bus network is too small for the gain to show.
- Outside what GENCO saw: 9 lines island buses and were left out; states with redispatch or load shedding (those of the corrective plan) are also not part of the training. How it fares on those states is in `docs/GENCO_VERIFICACAO.md`.

## With the authors' checkpoint
The GENCO Tiny published by the authors (`models/case118_genco_tiny_autores`) gives a mean error of 0.11 % points on the same 177 outages, against 0.93 for our N-10: see `docs/GENCO_CHECKPOINT_AUTORES.md`.

## How to reproduce
In the GENCO environment (`gridfm-graphkit` + `torch`), from the repository root (the data are generated in `<folder>`):
```bash
# 1) builds the data in datakit format (base case + each line out)
python backend/tools/genco_screening.py build --out <folder>
# 2) runs GENCO on <folder> (configuration with data.split_from_existing_files=<folder>/splits and split_by_load_scenario_idx=false;
#    same architecture as the training: models/case118_genco_tiny_n10/config.yaml); note the ms/scenario
GENCO_N=178 python tools/measure_genco_inference.py --config <cfg.yaml> \
  --model_path models/case118_genco_tiny_n10/best_model_state_dict.pt --normalizer_stats models/case118_genco_tiny_n10/normalizer_stats.pt \
  --data_path <folder> --num_workers 0 --log_dir <logs> --exp_name n10 --run_name verif
# 3) compares with the AC and the DC and writes the JSON used by the interface
python backend/tools/genco_screening.py analyze --out <folder> --pred <predictions.parquet> --genco-ms <ms per scenario> \
  [--dst <file>] [--model-label "<model description>"]
```
By default the result is written to `interface/src/data/screening_case118_ieee.json` (pass `--dst` with the model name, for example `screening_case118_ieee_n10.json`); use `--dst` to avoid overwriting (for example, to check another model).

## Where it appears in the interface
**N-1 screening** panel (📊 button in the "Corrective response" panel): lists the 303 single contingencies sorted by severity (AC, after the automatic redispatch) and, for lines, the maximum loading estimated by GENCO (without redispatch); it shows the table above. Clicking a row applies the fault and opens the corrective response.
