# Other networks: IEEE 14, 30 and 57 (besides 118)

The interface opens four transmission networks. For each one we use the **GENCO Tiny (`seed0`) checkpoint published by the authors**
(`gridfm/genco-pf-datakit`, Apache 2.0; origin and SHA-256 in `models/case<N>_genco_tiny_autores/`). We trained nothing for networks 14, 30 and 57.
All the numbers below were **measured by us** with the tools in this repository (the guide of another prototype that we received had similar numbers; they match).

| Network | Buses | Lines | Single contingencies | Require a plan (AC) |
|---|---|---|---|---|
| IEEE 14 | 14 | 20 | 33 | 2 (1 line, 1 bus) |
| IEEE 30 | 30 | 41 | 70 | 43 (18 lines, 25 buses) |
| IEEE 57 | 57 | 80 | 136 | 80 (62 lines, 18 buses) |
| IEEE 118 | 118 | 186 | 303 | 210 |

## Preparation of each network
1. PGLib v23.07 case (`pglib_opf_case<N>_ieee.m`, CC BY 4.0) in `interface/src/data/`.
2. Base dispatch by **PowerModels AC-OPF** (`backend/tools/opf_powermodels.py`); the objectives (2178.08; 8208.52; 37589.34) match the PGLib reference ones.
3. Case for the interface (`backend/tools/export_case.py`, which also writes an automatic layout). **The drawing the interface uses is the design layout made by the author** (`interface/src/data/layout_case<N>_ieee.json`, positions and bends): line crossings, by the project's detector: 0 on 14, on 30 and on 118; 2 on 57 (9–13 × 10–12 and 11–13 × 10–51).
4. **Validation of our AC solver against PowerModels** on the base case: maximum |V| difference of 1e-11 and angle difference of 5e-10 degrees on the four networks (test `backend/tests/test_redes_pequenas.py`).
5. The AC-OPF dispatch respects the limits: the corrective plan without faults asks for no action on any network.

## GENCO on single-line outages (base dispatch, no redispatch, against the AC)
| Network | Outages evaluated | Mean error GENCO / DC (% points) | Largest error GENCO / DC | Lines ≥ 100% detected (GENCO / DC) |
|---|---|---|---|---|
| IEEE 14 | 19 of 20 | **0.01** / 1.99 | 0.2 / 62.0 | 1 of 1 / 1 of 1 |
| IEEE 30 | 38 of 41 | **0.04** / 3.19 | 0.5 / 34.3 | 80.6% of 31 / 16.1% |
| IEEE 57 | 78 of 80 | **0.03** / 2.30 | 1.5 / 29.1 | 4 of 4 / 4 of 4 |
| IEEE 118 | 177 of 186 | **0.11** / 2.95 | 16.9 / 132.0 | 56.2% of 354 / 13.3% |

Outages that island buses are left out (GENCO did not see islands). On CPU GENCO takes 14 to 21 ms per scenario, on the same order as the AC (10 to 15 ms): on small networks **there is no speed gain**.

## GENCO as a plan verifier (states with redispatch and shedding, which it did not see in training)
| Network | Line contingencies with a plan | Insufficient plans (AC > 100%) | Mean error per line GENCO / DC | Approved by mistake at 100%: GENCO / DC | Safe threshold GENCO / DC |
|---|---|---|---|---|---|
| IEEE 14 | 1 | 2 | 0.53 / 2.72 | 0 / 0 | 100% / 100% |
| IEEE 30 | 15 | 30 | 0.17 / 2.95 | 7 / 23 | 99% / 92% |
| IEEE 57 | 61 | 4 | 0.04 / 2.28 | 0 / 0 | 100% / 100% |
| IEEE 118 | 89 | 173 | 0.21 / 2.92 | 17 / 121 | 99% / 95% |

**Honest reading:** only IEEE 118 (173 insufficient plans) and, with caution, IEEE 30 (30) have a sample large enough to conclude anything about the verifier. On IEEE 14 there is a single contingency and on IEEE 57
only 4 insufficient states (the plans stay far from the limit): there the result is only illustrative. The interface shows a small-sample warning in those cases.
On all four networks GENCO errs far less than the DC; on the two with a sample the pattern repeats: near 100% GENCO errs in both directions, and an approval threshold one point lower (99%) avoids approving insufficient plans.

## Out of scope (of the interface)
GOC 500, 2000 and 10000 (the authors publish checkpoints) were left out of the interface, but were **measured** in a scale study (`docs/GENCO_ESCALA.md`): there GENCO does not beat the DC and, on CPU, is not faster than our AC. The checkpoint of each network only serves that network and was trained (according to the guide we received, not confirmed by the model card) only up to N-1.

## Reproduce (one network; example IEEE 30)
```bash
python backend/tools/opf_powermodels.py interface/src/data/pglib_opf_case30_ieee.m opf.json                       # GENCO environment (Julia/PowerModels)
python backend/tools/export_case.py interface/src/data/pglib_opf_case30_ieee.m interface/src/data/case30_ieee.json --dispatch opf.json   # backend environment
python backend/tools/genco_screening.py build   --case case30_ieee --out <folder>                                 # GENCO environment from here on
python backend/tools/genco_screening.py predict --case case30_ieee --out <folder> --modelo models/case30_genco_tiny_autores --pred <predictions.parquet>
python backend/tools/genco_screening.py analyze --case case30_ieee --out <folder> --pred <predictions.parquet> --tag autores --model-label "<description>"
python backend/tools/genco_verifica_planos.py --case case30_ieee --modelo models/case30_genco_tiny_autores --model-label "<description>"
python backend/tools/export_replay.py --case case30_ieee                                                          # backend environment
```
For a new network, add it to `interface/src/networks.js`.
