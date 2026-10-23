# Voltage correction with GENCO-OPF (IEEE 118)

Continuation of Step 0 (`docs/TENSAO_PASSO0.md`). Question: can **GENCO in OPF mode** indicate the generators' reference voltage that eliminates the voltage violations that our plan leaves after a fault?

Model: OPF checkpoint published by the authors (`gridfm/genco-opf-datakit`, `case118_ieee/small/seed0`, `last.pt`, Apache 2.0; `models/case118_genco_opf_small_autores/`).
Tools: `tools/genco_opf_inferencia.py` (in-memory inference) and `backend/tools/exp_tensao_genco_opf.py` (experiment). Results per contingency in `docs/escala/tensao_genco_opf_case118_ieee.json`.

## What the OPF model does
Given the loads, the limits and the costs, it **predicts** the dispatch of each generator and the voltage of each bus. The voltage of each bus is limited **by construction** (a sigmoid keeps it between `vmin` and `vmax`) and the dispatch of each generator between `Pmin` and `Pmax`:
the model never returns voltage out of range. What it can get wrong is the power balance and the flows, so what it predicts is **always applied and checked in our AC**.

**Sanity check on the base case** (no fault): the predicted dispatch differs from PowerModels' by 3.2 MW (RMSE; the one published by the authors is 17.7 MW) and the cost by 0.22% (published: 1.68%).

## The test
The 43 single contingencies in which the backend plan ends with voltage out of range (out of 210 that require a plan). For each one, the post-fault state has the loads already shed by the plan. What GENCO-OPF predicts is applied in our AC.
Reference: Step 0 (PowerModels), with its solutions applied **in the same AC**.

| Who chooses the adjustment | Voltage out of range solved | Highest line loading (median) | Lines above 100% | Note |
|---|---|---|---|---|
| Original plan (no adjustment) | 0 of 43 | 100.0% | 0 | 48 voltage violations in total; on average 9.7 generators with reactive power outside the limit |
| **PowerModels, Vg only** (reference) | **42 of 42** feasible | 100.0% | **0** | validates Step 0 in our AC |
| **GENCO-OPF, Vg only** (G1) | **41 of 43** | **104.3%** (max 105.0%) | 39 cases | fixes the voltage, but breaks the thermal limit |
| GENCO-OPF, dispatch and Vg (G2) | 41 of 43 | 103.4% (max 161%) | 35 cases | the GENCO dispatch makes it worse; do not use |
| **GENCO-OPF, Vg only, redoing the power plan** (loop) | **41 of 43** | ≤ 100% (no overload) | **0** | 1.09 rounds on average; total shedding 797 → 759 MW |

### The loop that works
1. The backend plan (active-power LP) is computed as today.
2. GENCO-OPF predicts the generator voltage for the state of that plan.
3. That voltage enters the network and **the power plan is redone** (the LP uses the AC reactive powers, which changed) and checked in the AC.
4. Repeats until there is no voltage violation or overload (at most 3 rounds).

Results of the loop on the 43 contingencies: **voltage out of range and overload cleared in 41**; in 41 of them a single round is enough and the other two use three. The voltage violations (sum) drop from 48 to 2.
The load shedding **does not increase** (797.5 → 759.3 MW in total; 41 of 43 with equal or lower shedding). The generator reactive violations drop from 9.7 to 0.4 per plan.
The two cases that do not close: the fault of line 53–54 (remaining excess of 0.0006 pu) and of bus 54 (0.0067 pu); PowerModels solves them.

## Reading
- The voltage adjustment by GENCO-OPF **is feasible** and closes almost all the IEEE 118 cases when combined with the power plan and the check in the AC.
- GENCO's prediction **alone is not enough**: the voltage it predicts fixes the voltage but shifts the reactive flows and the lines, which the plan leaves tight, exceed the limit (about 4%). Redoing the power plan afterwards solves it.
- The dispatch that GENCO-OPF predicts **must not be used** in this case (it reaches 161% loading); only the generator voltage.
- PowerModels with the thermal limit as a constraint solves 42 of 42 without overload, but it is slow and needs Julia; GENCO-OPF takes about 35 to 90 ms per scenario on CPU.

## Integration into the product (2026-10-22)
The loop became part of the backend and of the IEEE 118 replay:
- `backend/app/voltage.py`: `plan_with_voltage(net, branch_out, bus_out, provider, ...)` is the loop above, **with no dependency on torch**: the Vg provider is a function (in the project, `backend/tools/genco_tensao.py`, which uses GENCO-OPF).
  It only adopts the result if it is better than the original plan (fewer voltage violations plus overloads); `pre` and `postFault` remain those of the original voltage. The response gains the `voltage` block (see `docs/CONTRATO_API.md`).
- `backend/tools/export_replay.py --voltage-genco <OPF checkpoint folder>` applies the loop to the plans that end with voltage out of range (GENCO environment, with torch).
- Interface: **Voltage** column in the stage table and the "⚡ Generator voltage adjustment (GENCO-OPF)" block in the corrective panel (violations before → after, changed generators, shedding before → after).
- Result in the IEEE 118 replay (42 corrective responses): **13** ended with voltage out of range; with the adjustment, **15 violations become 0**, no overload, total shedding of those 13 plans **901.8 → 866.2 MW** and the AC confirms all of them (the `replay.test.mjs` test checks the block against the "With plan" state).
- Example: fault on line 7: 1 bus with an excess of 0.0107 pu → 0, in one round; shedding 148.0 → 136.2 MW; reactive power out of limit at 16 → 1 generator.

**What the screen honestly shows:** GENCO-OPF does not make the minimal adjustment; it proposes the reference voltage of **all** in-service generators (54 on the 118, sometimes −0.06 pu), always within the range of each bus. The AC confirms the result, but the operator should see it as a proposal, not as the smallest possible intervention.

## Limits of the test
- One network (IEEE 118), 43 contingencies, one checkpoint (Small, seed 0).
- The load shedding is still decided by our LP (GENCO-OPF has no shedding variable); states with shed load may be outside what it saw in training.
- GENCO runs outside the backend (it needs torch): in the interface the result enters precomputed (replay), like the screening and the verifier. The live backend (without torch) does **not** make the adjustment; it only accepts a Vg provider.
- The reconnection timeline (`recovery`) does **not** consider the voltage adjustment, and the GENCO verification (`verificacao_planos_*`) was computed on the original power plans (the screen warns when the plan has an adjustment).
- The 2 remaining cases and the other networks (IEEE 57 has large violations and Step 0 showed that generator voltage alone is not enough) were not addressed.
- The final check is always our AC (voltage tolerance of 0.0005 pu).

## Reproduce
```bash
python backend/tools/exp_tensao_opf.py --rede case118_ieee --dst docs/escala/tensao_case118_ieee.json                                 # Step 0 (PowerModels)
python backend/tools/exp_tensao_genco_opf.py --dst docs/escala/tensao_genco_opf_case118_ieee.json                                     # this experiment
python backend/tools/export_replay.py --case case118_ieee --voltage-genco models/case118_genco_opf_small_autores                      # replay with the adjustment (GENCO environment; ~2 min)
```
