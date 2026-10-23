# Data and API contract (interface ↔ backend)

> Version 0.5 — 2026-10-12 (`/evaluate`, `/corrective`, `/screen` and `/recovery` implemented; see §7 to §10).
> The interface and the backend only talk through this contract; swapping the evaluator (AC → GENCO) changes **nothing** here.

## 1. Conventions
- **Indices from 0** in the API, equal to the position in the `bus` and `branch` tables of the MATPOWER file. Branch `id` = row of the `branch` table (same convention as the `app/data.json` of the contingency panel).
- **Bus numbering in the interface:** the interface shows and uses the **MATPOWER bus number** (`BUS_I`, from 1 to 118 in IEEE 118), which engineers recognize (e.g. line 38–65). The API uses the index from 0; each bus carries `number` (`BUS_I`) to convert. The current contingency panel shows indices from 0 (e.g. "37–64" for line 38–65); worth aligning.
- **Units:** active power in **MW**, reactive in **MVAr**, apparent in **MVA**, voltage in **pu**, angle in **degrees**, time in **minutes**, energy not supplied (ENS) in **MWh**.
- **Loading** of a branch = `max(S_from, S_to) / rateA` (ratio; 1.0 = 100%), the same calculation used in the GENCO contingency scripts. The backend computes it; do not use pandapower's `loading_percent` (it reclassifies branches and converts the limit).
- **Bus faults:** a faulted bus removes the bus and **all incident branches**; its load and generation are lost.
- **Energization:** only the **island that contains the reference bus (REF)** is energized and computed. Islands without the reference are de-energized and their load counts as lost (consistent with the GENCO training, which avoids islands; islands with their own generation are out of scope).
- **Generation dispatch:** fixed; the loss of generators or load is absorbed by the reference bus (and, if needed, redistributed proportionally). No OPF.

## 2. Objects
**Topology** (state to evaluate):
```json
{ "branchOut": [12, 40], "busOut": [7] }
```
**Network** (`GET /grid/{name}` or static `grid.json`):
```json
{
  "name": "case118_ieee", "baseMVA": 100,
  "buses":    [{"id":0,"type":"PQ|PV|REF","pd":0,"qd":0,"gs":0,"bs":0,"vmin":0.94,"vmax":1.06,"x":0.32,"y":0.99}],
  "branches": [{"id":0,"from":0,"to":1,"r":0.03,"x":0.07,"b":0.02,"tap":0,"shift":0,"rateA":151,"angmin":-360,"angmax":360}],
  "gens":     [{"id":0,"bus":3,"pg":0,"pmin":0,"pmax":100,"qmin":-30,"qmax":30,"vm":1.0}]
}
```
`x`,`y` are the diagram drawing (generated once; the current panel uses `kamada_kawai`).

## 3. Endpoints
### `POST /evaluate` — electrical state of several topologies
Request:
```json
{ "grid": "case118_ieee", "solver": "ac | dc | genco | auto", "topologies": [ {"branchOut":[],"busOut":[7]} ] }
```
Response (one item per topology, same order):
```json
{ "results": [ {
  "solver": "genco", "converged": true, "ms": 4.2,
  "energized": [0,1,2],  "lostBuses": [7],
  "servedMW": 3980.4, "lostMW": 261.6,
  "buses":    [{"id":0,"vm":1.01,"va":-2.1}],
  "branches": [{"id":0,"pf":120.3,"qf":10.1,"pt":-119.8,"qt":-9.7,"loading":0.82}],
  "violations": {"overload":[5,9], "voltage":[3]}
} ] }
```
`solver:"auto"` = GENCO in the screening; the backend reports in `solver` what it actually used.
### `POST /verify` — same as `/evaluate` with `solver:"ac"` (exact confirmation, pandapower).
## 4. Interface modes
| Mode | Data source |
|---|---|
| `dc` | Local DC in JavaScript (transmission), always available |
| `backend` | Calls above to the local FastAPI |
| `replay` | Precomputed JSON (same response formats) served on GitHub Pages |

## 7. `/evaluate` in detail (v0.2) and decisions
- **Identification (replaces what is in §1 and in the examples):** in the API **buses are identified by the MATPOWER number** (`BUS_I`) in `busOut`, `energized`, `lostBuses` and `buses[].id` (not by the index from 0); **branches** go by the row index in the `branch` table (from 0) in `branchOut` and `branches[].id`. This way the backend and the interface speak the same numbering.
- **Request:** `grid` (case name in `/cases`) **or** `case` (MATPOWER tables `{baseMVA, bus, gen, branch}`, for imported cases; the dispatch is rebalanced as in the interface if it differs from the load by more than 10%); `solver` ∈ `ac | dc | auto | genco`; up to 2000 topologies per request.
- **Solvers:** `ac` (Newton-Raphson), `dc`; `auto` = AC for now (it will be GENCO in the screening, Phase 5); `genco` answers **501** until Phase 5. The `solver` field of the response reports what was used.
- **Response per topology:** `converged`, `ms`, `energized`, `lostBuses`, `servedMW`, `lostMW`, `buses[{id, vm, va}]`, `branches[{id, pf, qf, pt, qt, loading}]` (active branches only), `gens[{id, bus, pg, qg}]` and `violations{overload, voltage, qgen}` (`overload`: branches with loading > 1.0; `voltage`: buses outside [vmin, vmax]; `qgen`: generators outside [qmin, qmax]; the last two only in the AC). If the AC does not converge, `converged:false` and `error` describe the reason.
- **Errors:** 404 (nonexistent case), 422 (nonexistent branch/bus, invalid case, missing `grid`/`case`), 413 (large batches), 501 (`genco`).

## 8. Corrective response (v0.3, Phase 3): `POST /corrective`
> **Scope change (2026-10-09):** in transmission (meshed, no normally open branches) there is no room for restoration switching. `/restore`, `/plan` and `/scenario` (§3) are **replaced** by `/corrective`: the operator marks faults on **lines and/or buses** and the system proposes the **generation redispatch** and, if a violation remains, the **minimum load shedding** (any load can be shed), verified by the AC. Voltage violations are only reported.

Request:
```json
{ "grid": "case118_ieee",
  "faults": { "branchOut": [7], "busOut": [] },
  "options": { "maxIter": 8, "margin": 0.0 } }
```
`grid` or `case` (MATPOWER tables), as in `/evaluate`. `faults.busOut` uses the MATPOWER number; `faults.branchOut` the branch index.

Response:
```json
{ "grid": "case118_ieee", "faults": {"branchOut":[7],"busOut":[]}, "needsAction": true,
  "pre": { ...result of /evaluate without faults... },
  "postFault": { ...after the faults, with the generation redistributed using the headroom (automatic response)... },
  "after": { ...after the plan (redispatch + shedding), verified by the AC... },
  "plan": { "shed": [{"bus":15,"mw":90.0,"pct":1.0}], "redispatch": [{"gen":3,"bus":66,"pgBefore":38,"pgAfter":748}],
            "totalShedMW": 148.0, "totalRedispatchMW": 1078.9, "iterations": 2 },
  "summary": { "loadTotalMW": 4242, "isolatedMW": 0, "shedMW": 148.0, "servedMW": 4094, "servedPct": 0.965,
               "overloadsPost": 5, "overloadsAfter": 0, "convergedAfter": true, "ms": 210 } }
```
- Each state (`pre`, `postFault`, `after`) has the same format as an `/evaluate` item, and `violations` gained `pgen` (generators outside [Pmin, Pmax]).
- `needsAction=false` when the automatic generation response already keeps the limits: the plan comes empty and `after` = `postFault`.
- `note` (optional) explains a plan that did not solve everything: `best-effort plan: N overload(s) remain…` (no redispatch and shedding respects all the line limits; the plan minimizes the shedding and the violations), `the AC power flow does not converge with the plan applied…` (the plan could not be confirmed) or `optimization has no solution…` (no plan; `after` = `postFault`). The interface must not say "no action needed" when `needsAction=true`.
- `voltage` (optional, only in responses where the voltage adjustment ran; today only in the IEEE 118 replay, see `docs/TENSAO_GENCO_OPF.md`): `{model, applied, loops, violationsBefore, violationsAfter, maxExcessBeforePu, maxExcessAfterPu, qgenBefore, qgenAfter, overloadsAfter, shedBeforeMW, shedAfterMW, gens:[{gen, bus, vgBefore, vgAfter}]}`.
  `violations*` count the buses outside the voltage range in the `after` stage; `applied=false` means that the adjustment did not improve the plan and the response is the original one. With `applied=true`, `plan`, `after` and `summary` are those of the plan redone with the new generator voltage; `pre`, `postFault` and `summary.overloadsPost` remain those of the original voltage.
- **How the plan is computed:** (1) post-fault AC with the imbalance redistributed using the generators' headroom; (2) if overloads remain, a linear problem (HiGHS) minimizes the shed load (cost 1 per MW) with a small redispatch cost (1e-3 per MW), subject to the thermal limits of the branches (DC sensitivities applied over the AC flows, with the Q headroom) and to the generators' Pmin/Pmax limits; (3) the AC verifies and, if an overload remains, the limits of the violated branches are tightened and the problem is solved again (up to `maxIter`).
- **Known limits:** the shedding minimizes MW and so may concentrate on a few buses (100% of their load); there is no priority between loads; the `/corrective` plan does not correct voltage violations (no voltage/reactive control; the Vg adjustment is an optional step in `app/voltage.py`, see `voltage` above); the redispatch does not consider generation costs; the dense inversion of the sensitivities serves networks of up to a few thousand buses.
- Errors: 404 (nonexistent case), 422 (nonexistent branch/bus).

## 9. N-1 screening (v0.4, Phase 4a): `POST /screen`
Request: `{ "grid": "case118_ieee", "scope": "both" }` (`grid` or `case`; `scope` = `both` | `lines` | `buses`; the reference bus is not included).

Response:
```json
{ "grid": "case118_ieee", "count": 303, "needAction": 210, "noAction": 93, "ms": 11900,
  "contingencies": [ { "type": "line", "id": 7, "label": "line 8–5", "converged": true, "overloads": 5, "voltage": 0,
                       "maxLoadingPct": 177.0, "isolatedMW": 0.0, "needsAction": true } ] }
```
- Each contingency is evaluated by the AC **after the automatic generation response** (redistribution using the headroom). `needsAction` = a violation still has to be corrected (the full plan comes from `/corrective`).
- Sorting: those that require action first, by number of overloads and maximum loading. `id` = branch index (`line`) or MATPOWER number (`bus`).
- Time: ~12 s for the 303 contingencies of IEEE 118 (one core).


## 10. Repair and block reconnection (v0.5, Phase 4b): `POST /recovery`
Request:
```json
{ "grid": "case118_ieee",
  "faults": { "branchOut": [7], "busOut": [68] },
  "repairOrder": [ {"type": "bus", "id": 68}, {"type": "line", "id": 7} ],
  "options": { "blockMW": 50, "repairHours": 2, "blockMinutes": 10 } }
```
`repairOrder` (optional) must be a permutation of the faults; the default is lines and then buses. `repairHours` and `blockMinutes` are **synthetic** input data (they only enter the ENS calculation).

Response: `{ grid, faults, repairOrder:[{type,id,label}], options, events:[...], summary }`.
- `events`: step 0 = **initial plan** (redispatch + minimum shedding, as in `/corrective`); then, for each repair, a `repair` event (new topology, still with the load and dispatch of the previous plan), a `cut` if the new plan asks for less load at some bus and the `reconnect` events (blocks of up to `blockMW`, choosing at each step the block that leaves the fewest overloads and the lowest maximum loading). Each event carries `kind`, `label`, `tHours`, `remaining` (remaining faults), `shed` (`bus`, `mw`, `pct`), `servedMW`, `unservedMW`, `overloads`, `maxLoadingPct`, `converged`, `block` (in the `reconnect` events) and `state` (complete AC state, same format as an `/evaluate` item).
- `summary`: `ensMWh` (integral of the unserved load over time), `totalHours`, `blocks`, `blocksWithOverload`, `eventsWithOverload`, `restored` (all load served, no overload, at the end) and `ms`.
- **How it works:** after each repair it runs `plan_corrective` for the remaining faults; the load that the new plan allows serving is reconnected in blocks. The dispatch of the blocks is that of the new plan; the reference bus absorbs the difference (redistributing it among the generators was tested and made things worse).
- **Known limit:** intermediate states (right after a repair and a few blocks) may have a **transient** overload; only the state of each plan is verified as overload-free. `blocksWithOverload` and `eventsWithOverload` report how many.
- Errors: 422 (nonexistent fault, `repairOrder` that is not a permutation, no faults, faulted reference bus), 404 (nonexistent case).

**Names of parallel lines.** When two or more lines connect the same two buses (IEEE 118 has 7 pairs: 42–49, 49–54, 49–66, 56–59, 77–80, 89–90 and 89–92), the `label` of `/screen` and `/recovery` carries the circuit letter in the order of the branches in the table: `line 49–54 A` (branch 74) and `line 49–54 B` (branch 75). Lines without a parallel keep no letter (`line 8–5`). The interface uses the same rule (`interface/src/utils/parallel.js`).
