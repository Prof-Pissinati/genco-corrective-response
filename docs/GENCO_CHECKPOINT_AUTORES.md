# The authors' checkpoint against our training (IEEE 118)

On 2026-10-21 we gained, next to our GENCO Tiny N-10 (`models/case118_genco_tiny_n10`, the collaborator's training), the **GENCO Tiny published by the authors**
(`models/case118_genco_tiny_autores`, see the folder's `README.md`: origin, license and what was not verified). Same architecture (H=12, 12 layers).
We ran the **same** project evaluations with both, against the backend AC. Results in `interface/src/data/*_autores.json` and `docs/genco_comparacao_multiplas_saidas.json`.

## Summary
- The authors' model is **better than ours on everything we measured**: on average 5 to 9 times less loading error on single-line outages, and less error also with several lines out,
  even though (according to the guide we received, not confirmed by the card) it was trained only up to N-1.
- Our training (39,761 samples, 42 epochs) has a much smaller budget than theirs (250,000 samples, 200 epochs, according to its `config.yaml`). **We have no accuracy advantage with our training.**
- The authors' model has almost no bias; ours overestimates the loading by about 3 points. That is why the plan verifier behaves differently (below).

## 1. N-1 screening (177 line outages, base dispatch, no redispatch)
| Metric | Our N-10 | **Authors** | DC |
|---|---|---|---|
| Mean loading error (% points) | 0.93 | **0.11** | 2.95 |
| Largest error on a line (% points) | 136.5 | **16.9** | 132.0 |
| Lines ≥ 90% detected (recall / precision) | 98.8% / 98.9% | **99.5% / 99.6%** | 78.0% / 98.0% |
| Lines ≥ 100% detected (recall / precision) | 52.0% / 78.6% | **56.2% / 92.6%** | 13.3% / 83.9% |
| Critical scenarios detected without margin (sent to the AC, out of 177) | 99.2% (172) | 86.6% (129) | 26.9% (34) |
| With a 5-point margin (sent to the AC) | 177 | 177 | 177 |
| Time per scenario on CPU (this computer; varies from one run to another) | ~18 ms | ~20 to 30 ms | 0.6 ms |

Reading: the authors' model gets the values and the high lines right much more often, but **the screening still does not save AC**: with a 5-point margin every scenario goes to the AC
(on this network almost every scenario has some line near the limit). Without margin, the authors' model lets more critical scenarios through than ours (86.6% against 99.2%), because ours overestimates and, unintentionally, is more cautious.
On CPU neither is faster than the AC (14 to 16 ms).

## 2. Several lines out (random N-k, 80 states per k, seed 0)
Mean loading error per line (% points), against the AC, base dispatch and reference absorbing the imbalance:

| Lines out | Our N-10 | **Authors** | DC |
|---|---|---|---|
| 1 | 1.01 | **0.13** | 3.02 |
| 2 | 1.08 | **0.20** | 3.05 |
| 3 | 1.64 | **0.40** | 3.24 |
| 5 | 1.51 | **0.48** | 3.18 |
| 8 | 2.40 | **1.12** | 3.67 |
| 10 | 2.50 | **1.19** | 3.69 |

The error of both grows with the number of lines out. The authors' model, trained (as far as is known) only up to N-1, stays below ours in every range, including N-10.
The largest isolated errors remain high in both (for example 463 points in one N-3 state for the authors' model and 153 in ours): there are extreme cases that neither gets right.

## 3. Plan verifier (89 contingencies, 623 states with redispatch and load shedding that neither saw)
| | Our N-10 | **Authors** | DC |
|---|---|---|---|
| Mean error per line (% points) | 1.03 | **0.21** | 2.92 |
| Bias of the maximum loading (estimated minus AC) | +3.0 | **+0.6** | −2 to −5 |
| Insufficient plans approved by mistake with a 100% threshold (out of 173) | **0** | 17 | 121 |
| Highest threshold with no wrongful approval | 100% | 99% | 95% |
| Safe plans approved at the safe threshold, margin 0 / 3 / 5 / 8 / 10 points (out of 89) | 3 / 45 / 75 / 82 / 82 | **0 / 83 / 86 / 88 / 88** | 0 / 1 / 0 / 0 / 78 |

- The 17 insufficient plans that the authors' model approves at 100% are **very close** to the limit: the AC gives 100.4% on average (from 100.02% to 104.3%). Since the model has no bias, it errs in both directions.
  With a 99% threshold there was **no wrongful approval in 173**.
- **Same safety level (zero wrongful approvals):** the authors' model needs a 3-point margin in the plan (99% threshold) to approve 83 of 89 plans, with **total shedding of 263 MW and mean redispatch of 80 MW**;
  ours, a 5-point margin (100% threshold) to approve 75 of 89, with **289 MW and 97 MW**. The DC only gets there with a 10-point margin (78 of 89; 367 MW and 157 MW).
- Caveats: the safe threshold was chosen looking at the same data, equally for the three models (it favors all of them the same way). "0 of 173" bounds the error rate at about 1.7% (95% confidence). One network, one seed of each model.
  The worst error on the maximum loading of the authors' model is still 17 to 27 points in isolated cases (contingency 68–69).

## What this changes
- For the **quality** of what we show, the authors' checkpoint is the best GENCO we have. Using it is legitimate (Apache 2.0, citing the paper) and requires stating clearly **which model belongs to whom**.
- Our N-10 training remains useful as a **record of exploration** (training with a smaller budget, report, independent validation), but **not as an accuracy advantage**.
- The interface now shows the **authors' checkpoint** as the main model (`screening_case118_ieee_autores.json` and `verificacao_planos_case118_ieee_autores.json`), with a comparison line with our N-10 (`*_n10.json`). With it, the verifier's approval criterion is "estimated up to 99% of the limit" (safe threshold read from the file), and the recommended margin is 3 points.

## Reproduce
```bash
# screening (uses the `build` already generated; see docs/GENCO_VARREDURA.md)
python backend/tools/genco_screening.py predict --out <folder> --modelo models/case118_genco_tiny_autores --pred <predictions.parquet>
python backend/tools/genco_screening.py analyze --out <folder> --pred <predictions.parquet> --dst <output.json> --model-label "<description>"
# plan verifier
python backend/tools/genco_verifica_planos.py --modelo models/case118_genco_tiny_autores --dst <output.json>
# several lines out
python backend/tools/genco_compara_modelos.py --modelo models/case118_genco_tiny_n10 --modelo models/case118_genco_tiny_autores
```
