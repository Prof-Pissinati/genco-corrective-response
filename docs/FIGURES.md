# Figures and numbers: where each one comes from

Everything in the contest post can be traced to a file in this repository. This page lists, for each figure, what it shows, the data file, the script that produced the data, and how to repeat it. The numbers quoted in the text, with their sources, are in [`NUMBERS.md`](NUMBERS.md). The figures themselves are in [`figures/`](figures/).

## Common ground

- **Reference ("ground truth"):** our own sparse Newton–Raphson AC power flow (`backend/app/acpf.py`), checked against pandapower in the tests. Corrective plans are built with a linear program (HiGHS, `backend/app/corrective.py`) and always confirmed by that AC solver.
- **GENCO models:** the checkpoints published by the GENCO authors (`gridfm/genco-pf-datakit`, Tiny, `seed0`) for each network, kept with their SHA-256 in `models/*_autores/`, and the GENCO-OPF Small checkpoint for the IEEE 118 (`models/case118_genco_opf_small_autores/`). Our own N-10 model (`models/case118_genco_tiny_n10/`) is an exploration log (`RELATORIO_TREINO_N10.md`), not used in the figures.
- **State used to compare methods:** the one GENCO saw in training: AC-OPF base dispatch (PowerModels, PGLib cases), one line out, the reference bus absorbing the imbalance, no redispatch. Outages that island buses are left out.
- **Loading error:** mean absolute difference, per line, of the loading in % of the rating (percentage points), GENCO vs AC and DC vs AC.
- **GENCO environment:** the scripts below need `gridfm-graphkit` and `torch` (see `docs/TREINO_GENCO.md`); the rest of the repository runs without them.

## Static demo vs the full tool

The online demo is static: GitHub Pages cannot run a server, so it **replays results precomputed by the backend** (`interface/src/data/replay_*.json`). That is a hosting limit, not a limit of the tool: with the backend running (see the README), any fault on any of the four networks is computed live. The GENCO numbers shown in the interface are also precomputed (`genco_lines_*.json`, `screening_*`, `verificacao_planos_*`).

## Figure by figure

| Figure | Shows | Data | Script (repository root) |
|---|---|---|---|
| **F1** overview | The pipeline: fault → GENCO screens → corrective LP → GENCO verifies → GENCO-OPF sets voltages, with the AC confirming | none (diagram) | `tools/make_figures.py` |
| **F2** states | IEEE 118, line 8–5: intact, tripped, with the plan | screenshots of the static demo; numbers from `replay_case118_ieee.json` (`corrective["c:7\|"]`) | `tools/captura/f2_estados.mjs`, then `tools/make_figures.py` |
| **F3** corrective panel | The panel the operator reads, next to the plan on the diagram | same replay | `tools/captura/f3_f4_paineis.mjs` |
| **F4** N-1 sweep | 303 single contingencies (210 need a plan) and the GENCO tab with the checkpoint's metrics | `replay_case118_ieee.json` (`screen`), `screening_case118_ieee_autores.json`, `verificacao_planos_case118_ieee_autores.json` | `tools/captura/f3_f4_paineis.mjs` |
| **F5** accuracy | Mean loading error, GENCO vs DC, from IEEE 14 to GOC 10,000 | IEEE: `screening_case{14,30,57,118}_ieee_autores.json`; GOC: `docs/escala/case{500,2000,10000}_goc.json` | `backend/tools/genco_screening.py`, `backend/tools/genco_escala.py` |
| **F6** verifier | Insufficient plans approved by mistake; sufficient plans approved by margin (IEEE 118) | `verificacao_planos_case118_ieee_autores.json` | `backend/tools/genco_verifica_planos.py` |
| **F7** voltage | Violations and load shed before/after GENCO-OPF sets the generator voltages (13 plans) | `replay_case118_ieee.json` (`corrective.*.voltage`); the 43-outage test in `docs/escala/tensao_genco_opf_case118_ieee.json` | `backend/tools/export_replay.py --voltage-genco …`, `backend/tools/exp_tensao_genco_opf.py` |
| **F8** reconnection | Repair order and block-by-block load reconnection, with the energy not supplied | `replay_case118_ieee.json` (`recovery["r:line7"]`) | `tools/captura/f8_religacao.mjs` |
| **F9** AC vs GENCO | The same state seen by the AC and by GENCO, and the 185 line loadings (the outaged line excluded) against each other. F9: a typical outage with no overload (line 76–77, flows change a lot, error close to the median of the 177 outages). F9b: an outage with overloads (line 8–5) | `genco_lines_case118_ieee.json` (`outages[117]`, `outages[7]`) | `backend/tools/export_genco_lines.py`, `tools/captura/f9_ac_genco.mjs` |
| **F10** layouts | The three states of the left menu and the right menu (element directory) | screenshots | `tools/captura/f10_layouts.mjs` |

### How the data of each plot was produced

- **F5, IEEE 14–118.** For every single-line outage that does not island the grid (19, 38, 78 and 177 scenarios), the state is built as above, GENCO predicts the bus voltages, and the line loadings come from them with the same admittances the AC uses; the same state is solved by the AC and by the DC approximation. GENCO checkpoints are the authors' (one per network).
- **F5, GOC 500 / 2,000 / 10,000.** `genco_escala.py` draws 60 / 30 / 12 random single-line outages (fixed seed) and measures the same error and the time per scenario on CPU. The IEEE 118 also appears in `docs/escala/case118_ieee.json` (60 scenarios, error 0.124); the post and F5 use the full sweep (177 scenarios, error 0.105).
- **F6.** For each of the 89 line outages that need a plan on the IEEE 118, five post-fault states are built: no plan (automatic generation response only), a partial plan (half way), and the corrective LP plan computed to stay 0, 3, 5, 8 and 10 points below the limit: 623 states in total. The AC is the ground truth; GENCO and the DC each give a verdict "can approve the plan (maximum loading ≤ threshold)". A plan is *insufficient* when the AC shows an overload (173 states). The 99% threshold for GENCO and 95% for the DC were chosen on the same data, so the result is a single-network, single-seed observation (zero errors in 173 gives an upper bound of about 1.7% at 95% confidence, rule of three).
- **F7.** In the replay, the plans that ended with voltage out of the band go through `backend/app/voltage.py`: the GENCO-OPF checkpoint predicts the generator voltages, the power plan is redone with them and the AC confirms; the result is adopted only if it is better. 13 plans had violations (15 in total); after the adjustment there are none and no new overload. The wider test (43 outages) is `exp_tensao_genco_opf.py`.
- **F9 / F9b.** The comparison state is the one GENCO saw in training (no redispatch). F9 uses a typical outage chosen for being unremarkable in error (about the median, 0.05 points over the 177 outages) while changing the flows a lot, so the agreement is not an artifact of a trivial case; F9b adds an outage with overloads, to show that AC and GENCO flag the same lines. `export_genco_lines.py` exports, for the intact network and every single-line outage, what the AC and GENCO give for the same state. GENCO predicts only the bus voltages; flows and generation are computed from them.
- **Colors in the diagrams.** The loading scale goes from blue to deep orange at the line limit (100%); red is reserved for an overload. The tool counts a line as overloaded only above the limit plus a 0.01% tolerance (`TOL_LOADING` in `backend/app/evaluate.py`, `interface/src/utils/loading.js`), because a plan from the OPF/LP leaves lines exactly at the limit. So in F2 a line that is red is overloaded (panel 2) and a line at the limit is orange.
- **Screenshots (F2, F3, F4, F8, F9, F10).** Taken from the static demo with a scripted browser (`tools/captura/`, which needs `playwright-core` installed outside the repository). The figure layout is composed by `tools/make_figures.py`, which also writes `NUMBERS.md`.

## Regenerating

```bash
# data (GENCO environment; each script documents its own options)
python backend/tools/genco_screening.py ...        # see docs/GENCO_VARREDURA.md
python backend/tools/genco_verifica_planos.py --modelo models/case118_genco_tiny_autores
python backend/tools/export_genco_lines.py --case case118_ieee --modelo models/case118_genco_tiny_autores
python backend/tools/export_replay.py --case case118_ieee --voltage-genco models/case118_genco_opf_small_autores
# figures and numbers (needs matplotlib)
python tools/make_figures.py
```

## Honest limits (repeated here on purpose)

GENCO does not replace the AC; it is not faster on CPU in our tests (GPU not tested); on the GOC networks its error is about the same as the DC or worse; it never saw load shedding or redispatch in training; the GENCO view exists for the intact network and single-line outages without islanding; voltage setting exists only for the IEEE 118; repair times in the reconnection simulation are synthetic; the N-10 dataset is not published (configuration in `configs/data_case118_grande.yaml`, seed 42).
