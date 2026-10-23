# Voltage correction: Step 0 (what an AC-OPF would do on the plans that end with voltage out of range)

Question: our corrective plan (active-power LP) leaves buses with voltage out of range, almost always **overvoltage after shedding load**. If a voltage control existed,
how many of these cases would it solve? Before building it, we measured the potential with an **AC-OPF** (which has the voltage limits as a constraint and chooses the generators' reference voltage).
Tool: `backend/tools/exp_tensao_opf.py` (PowerModels/Ipopt); results per contingency in `docs/escala/tensao_<network>.json`.

## How it was done
For each single contingency (line or bus) that requires a plan, on the four IEEE networks:
1. The backend plan and the AC state after it are computed; the buses out of range are stored (tolerance of 0.0005 pu, the project's).
2. On the contingencies with a voltage violation, the PowerModels AC-OPF is solved on the **post-fault network, with the loads already shed by our plan** (the shedding is not re-optimized), in two versions:
   - **V1:** free dispatch and generator voltages (redispatch + voltage control);
   - **V2:** dispatch **fixed** at the values of our plan (only the reference bus absorbs) and **only the generator voltage free**: exactly what a Vg adjustment would do.
3. The generation cost and the feasibility are compared with the plan.

## Results
| Network | Contingencies with a plan | Plan ends with voltage out of range | AC-OPF feasible with free dispatch and Vg (V1) | **Feasible only by adjusting Vg (V2)** |
|---|---|---|---|---|
| IEEE 14 | 2 | 2 | 1 | 1 |
| IEEE 30 | 43 | 8 | 6 | **6** |
| IEEE 57 | 76 | 51 | 19 | **4** |
| IEEE 118 | 210 | 43 | 42 | **42** |

- **IEEE 118 (the main case):** of the 43 contingencies, in **42 adjusting only the generator voltage solves it**, without touching the dispatch or the shedding, at a practically equal generation cost (median 0.00%). The only exception is the fault at bus 37 (78 MW shed).
  The violations are **mild**: median of 1 bus per plan and median maximum excess of 0.0013 pu.
- **IEEE 30:** 6 of 8 solved with Vg only (V1 and V2 tie). The two that are not: the fault at bus 10 (excess of 0.087 pu) and at bus 12.
- **IEEE 14:** 1 of 2; the fault at bus 2, which sheds 225 MW, has no solution.
- **IEEE 57 is quite different:** 51 of 76 plans end with voltage out of range, and the violations are **large** (median excess of 0.025 pu, up to 0.32; **low** voltages predominate). With free dispatch the AC-OPF solves 19, with Vg only just 4.
  The rest would need other resources (capacitor banks and transformer taps, which are fixed here, or reactive shedding), or simply has no solution.

## Reading
- For the networks where the plan already leaves the network in a reasonable condition (IEEE 118, 30 and 14), **a voltage control by Vg adjustment is promising**: it solves the vast majority of the violations at no dispatch cost.
- It is not enough on networks (or contingencies) where the network already comes out of the post-fault state with very low voltage, as on IEEE 57.

## Limits of the test
- The load shedding comes from our LP and is **not re-optimized** with the voltage; a joint optimization could solve more cases.
- "Infeasible" is Ipopt's `LOCALLY_INFEASIBLE` status (it found no feasible point); **it is not proof of global infeasibility**.
- Taps and capacitor banks stay fixed in the AC-OPF too; they were not tested as controls.
- On a bus fault, PowerModels keeps the **largest connected component**; our model keeps the island of the reference bus (they coincide in the tested cases, but we did not check all of them).
- At this step we **did not check** the AC-OPF solutions in our AC solver (apply its dispatch and voltages and confirm zero violations); that was done in the next step (`docs/TENSAO_GENCO_OPF.md`).
- The costs use the cost curves of the PGLib case; one network, one data seed of the plan.

## Next steps if it is built
(1) check the solutions in our AC; (2) `evaluate` accepting a new Vg; (3) a Vg correction step after the power plan (a small LP over the Jacobian sensitivities, 3 to 5 iterations with the AC);
(4) response and screen with the voltage adjustment; (5) tests, count of the violations before and after, and replays; (6) optionally, GENCO as a voltage verifier (it gets 18 of the 19 real violations right on IEEE 118).

## Reproduce
```bash
python backend/tools/exp_tensao_opf.py --rede case118_ieee --dst docs/escala/tensao_case118_ieee.json     # GENCO environment (Julia/PowerModels); ~2 min on the 118
python backend/tools/exp_tensao_opf.py --rede case57_ieee --so-contar --dst <file>                        # only counts the voltage violations of the plans
```
