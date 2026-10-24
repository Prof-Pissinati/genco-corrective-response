# A classical baseline: Newton–Raphson from the base case (IEEE 118)

The two uses of GENCO that we evaluate against the AC (screening and plan verification) are compared in the post with the DC approximation. An expert will also ask: *"and what about a couple of Newton–Raphson steps started from the pre-outage solution?"* This page answers that on the IEEE 118. **In this test the classical baseline is more accurate and faster than the authors' GENCO checkpoint.** We report it because it changes how GENCO should be read here, and because the tool we built does not depend on the answer: it is a way to see, check and use the outputs of GENCO (or of any estimator) in operator terms.

## What was compared

Same states as the rest of the study. For every single-line outage that does not island the grid, the state is the AC-OPF base dispatch, one line out, the reference bus absorbing the imbalance, no redispatch (screening: 177 outages), and the 623 states of the plan verification (89 contingencies; 173 insufficient plans, those where the AC shows an overload). The baseline starts Newton–Raphson from the base-case point (the AC-OPF voltages stored in the case, i.e. the state *before* the outage), takes 1, 2 or 3 steps **without iterating to convergence**, and computes the line loadings from those voltages. The reference is the converged AC.

The baseline needs a solved base case, which exists here. It uses the same sparse Newton–Raphson code as our AC check (`backend/app/acpf.py`).

## Screening (177 single-line outages)

| Method | Mean loading error (pt) | Lines ≥ 90% found | Lines ≥ 100% found | Time per scenario (CPU) |
|---|---|---|---|---|
| DC | 2.955 | 78.0% | 13.4% | ~0.5 ms |
| GENCO (authors' checkpoint) | 0.105 | 99.5% | 56.2% | ~20 ms |
| Newton, 1 step | 0.060 | 99.2% | 93.2% | 1.5 ms |
| Newton, 2 steps | 0.004 | 99.9% | 100% | 3.1 ms |
| Newton, 3 steps | 0.000 | 100% | 100% | 4.7 ms |

Source: `docs/escala/newton_um_passo_case118_ieee.json`, produced by `backend/tools/comparador_newton_um_passo.py` (numpy and scipy only, about 10 s). The GENCO and DC rows are the ones of the screening (`interface/src/data/screening_case118_ieee_autores.json`); the times come from different runs on CPU, so read them as orders of magnitude.

## Plan verification (89 contingencies, 623 states, 173 insufficient plans)

Same procedure as `docs/GENCO_VERIFICACAO.md`: a plan is approved if the method's estimate of its maximum loading is at or below a threshold; the safe threshold is the highest one (integer percent) with no insufficient plan approved.

| Method | Insufficient plans approved by mistake at 100% | Highest threshold with no mistake | Sufficient plans approved, margin 3 pt | Margin 0 |
|---|---|---|---|---|
| DC | 121 | — | 1 of 89 | — |
| GENCO | 17 | 99% | 83 of 89 | 0 of 89 |
| Newton, 1 step | 7 | 99% | 87 of 89 | 4 of 89 |
| Newton, 2 steps | 0 | 100% | 89 of 89 | 84 of 89 |

Source: `docs/escala/newton_verificador_case118_ieee.json`, produced by `backend/tools/comparador_newton_verificador.py` (needs the GENCO environment because it rebuilds the 623 states; about 2 min). Error of the estimated maximum loading, Newton 1 step: median 0.03, 90th percentile 0.44, maximum 15.6 points; 2 steps: median 0, maximum 0.44.

## What this does and does not show

- On the IEEE 118, for single-line outages and for plans close to the base case, a Newton–Raphson started from the base case is more accurate than the authors' GENCO checkpoint and about an order of magnitude cheaper on CPU. GENCO's advantage in our results is over the DC approximation, not over a warm-started Newton.
- **Not tested:** outages with many lines out (N-k) or clustered outages, where the states are far from the base case and a few Newton steps can fail (entries #7 and #8 of the challenge discuss this); larger networks; **GPU**: we have no GPU, so we could not test GENCO batched on one, where its time per scenario could change. The comparison is CPU only, one network, one seed.
- The conclusion we draw is limited accordingly: the evidence in this repository supports GENCO as a better-than-DC estimator inside an operator tool, with the exact AC solver keeping the last word. It does not support "better than the classical solver".

Reproduce:

```bash
python backend/tools/comparador_newton_um_passo.py          # backend environment
python backend/tools/comparador_newton_verificador.py       # GENCO environment (rebuilds the 623 states)
```
