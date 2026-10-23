// Corrective response in the interface: conversion of the three stages, shedding per bus and panel summaries (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTransmissionSystem } from '../src/utils/transmission.js';
import { buildCorrectiveRequest } from '../src/solver/backendClient.js';
import { STAGES, stageResult, shedByBus, stageSummary, planDigest, voltageSummary, stageCaption } from '../src/solver/corrective.js';

const caseData = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const data = JSON.parse(fs.readFileSync(new URL('./fixtures/corrective_linha7.json', import.meta.url)));
const sys = buildTransmissionSystem(caseData, { gridName: 'case118_ieee' });

test('request: built-in case by name, faults and options', () => {
    const req = buildCorrectiveRequest(sys.transmission, { branchOut: [7], busOut: [] }, { maxIter: 5 });
    assert.equal(req.grid, 'case118_ieee');
    assert.deepEqual(req.faults, { branchOut: [7], busOut: [] });
    assert.equal(req.options.maxIter, 5);
});

test('the three stages become results in the interface format, with line 7 carrying no post-fault flow', () => {
    assert.deepEqual(STAGES.map(s => s.key), ['pre', 'postFault', 'after']);
    for (const { key } of STAGES) {
        const r = stageResult(data, key, sys.branches);
        assert.equal(Object.keys(r.lines).length, 186);
        assert.equal(Object.keys(r.nodes).length, 118);
    }
    assert.ok(stageResult(data, 'pre', sys.branches).lines[7].percentage > 0);        // before: line 7 carries load
    assert.equal(stageResult(data, 'postFault', sys.branches).lines[7].percentage, 0); // after the fault: out of service
});

test('the plan eliminates the overloads and sheds load (line 7)', () => {
    const pre = stageSummary(data, 'pre');
    const post = stageSummary(data, 'postFault');
    const after = stageSummary(data, 'after');
    assert.equal(pre.overloads, 0);
    assert.ok(post.overloads > 0, 'the fault causes overload even after the automatic generation response');
    assert.equal(after.overloads, 0);
    assert.ok(after.maxLoadingPct <= 100.01);
    assert.ok(after.servedMW < pre.servedMW && after.servedPct < 1 && after.servedPct > 0.95);   // corte pequeno (~3,5%)
});

test('shedding per bus: adds up to the plan total and stays between 0 and 100% of the load of each bus', () => {
    const m = shedByBus(data);
    assert.ok(m.size > 0);
    let soma = 0;
    for (const [bus, { mw, pct }] of m) {
        soma += mw;
        assert.ok(pct > 0 && pct <= 1, `bus ${bus}: ${pct}`);
        assert.ok(Math.abs(mw - pct * caseData.bus.find(r => r[0] === bus)[2]) < 0.01, `bus ${bus}: mw x pct`);
    }
    assert.ok(Math.abs(soma - data.plan.totalShedMW) < 0.01);
});

test('panel summary: largest shedding and redispatch in descending order', () => {
    const d = planDigest(data, 3);
    assert.equal(d.needsAction, true);
    assert.ok(d.shedTotalMW > 0 && d.shedPctOfLoad > 0 && d.shedPctOfLoad < 0.1);
    assert.ok(d.topShed.length <= 3 && d.topShed.every((s, i, a) => i === 0 || a[i - 1].mw >= s.mw));
    assert.ok(d.topRedispatch.every((r, i, a) => i === 0 || Math.abs(a[i - 1].delta) >= Math.abs(r.delta)));
    assert.ok(d.redispatchCount > 0);
});

test('redispatched generators: only those that change by more than 0.05 MW (bus 111 goes up, the reference goes down)', async () => {
    const { redispatchBuses } = await import('../src/solver/corrective.js');
    const s = redispatchBuses(data);
    assert.ok(s.size > 0);
    for (const r of data.plan.redispatch) assert.equal(s.has(r.bus), Math.abs(r.pgAfter - r.pgBefore) > 0.05);
    assert.equal(redispatchBuses({ plan: { redispatch: [{ bus: 5, pgBefore: 10, pgAfter: 10.01 }] } }).size, 0);
    assert.equal(redispatchBuses(null).size, 0);
});

test('fault text and caption of each stage', async () => {
    const { faultsText, stageCaption } = await import('../src/solver/corrective.js');
    const br = sys.branches;
    const f = faultsText({ faults: { branchOut: [7], busOut: [68] } }, br);
    assert.equal(f, `line ${br[7].from}–${br[7].to} + bus 68`);
    assert.equal(faultsText(null, br), '');
    assert.match(stageCaption(data, 'pre', f), /no faults/);
    assert.match(stageCaption(data, 'postFault', f), /Fault: .*redistributes/);
    assert.match(stageCaption(data, 'after', f), /Plan applied: redispatch of .* MW and shedding of .* MW of load/);
    assert.match(stageCaption({ plan: { totalRedispatchMW: 0, totalShedMW: 0 } }, 'after', f), /No action needed/);
});

// ---- what the plan achieved (planStatus) and the corresponding messages ----
test('planStatus: no action, solved, best effort, AC not converging and optimization without a solution', async () => {
    const { planStatus, stageCaption } = await import('../src/solver/corrective.js');
    const base = (extra) => ({ needsAction: true, plan: { totalShedMW: 10, totalRedispatchMW: 5 }, after: { converged: true, violations: { overload: [] }, branches: [{ loading: 0.9 }, { loading: 0.97 }] }, ...extra });
    assert.equal(planStatus(base({ needsAction: false })).kind, 'none');
    assert.equal(planStatus(base({})).kind, 'solved');
    const parcial = planStatus(base({ after: { converged: true, violations: { overload: [3, 4] }, branches: [{ loading: 1.4 }] } }));
    assert.equal(parcial.kind, 'partial'); assert.equal(parcial.overloads, 2); assert.equal(Math.round(parcial.maxLoadingPct), 140);
    assert.equal(planStatus(base({ after: { converged: false, violations: { overload: [] }, branches: [] } })).kind, 'noconv');
    const failed = base({ note: 'optimization has no solution (The problem is infeasible.)', after: { converged: true, violations: { overload: [1, 2, 3] }, branches: [{ loading: 2.46 }] } });
    assert.equal(planStatus(failed).kind, 'failed');
    // the caption never says "no action needed" when there is an overload or failure
    for (const d of [failed, base({ after: { converged: true, violations: { overload: [3] }, branches: [{ loading: 1.2 }] } }), base({ after: { converged: false, violations: { overload: [] }, branches: [] } })]) {
        assert.doesNotMatch(stageCaption(d, 'after', 'bus 2'), /No action needed/);
    }
    assert.match(stageCaption(failed, 'after', 'bus 2'), /No feasible plan/);
    assert.match(stageCaption(base({}), 'after', 'bus 2'), /Plan applied/);
    assert.match(stageCaption(base({ needsAction: false, plan: { totalShedMW: 0, totalRedispatchMW: 0 } }), 'after', 'bus 2'), /No action needed/);
});

test('IEEE 30, fault at bus 2: before there was no plan (infeasible optimization); now there is a best-effort plan that sheds almost all the load and eliminates the overloads', async () => {
    const { planStatus } = await import('../src/solver/corrective.js');
    const rep = JSON.parse(fs.readFileSync(new URL('../src/data/replay_case30_ieee.json', import.meta.url)));
    const e = rep.corrective['c:|2'];
    const st = planStatus(e);
    assert.equal(st.kind, 'solved');
    assert.ok(e.plan.totalShedMW > 250 && e.plan.totalShedMW < 262, 'sheds almost all the served load (261.7 MW)');
    assert.equal(e.after.violations.overload.length, 0);
});

// ---- generator voltage adjustment (GENCO-OPF), `voltage` block of the response ----
const withVoltage = { ...data, voltage: {
    model: 'm/last.pt', applied: true, loops: 2, violationsBefore: 3, violationsAfter: 0, maxExcessBeforePu: 0.0107, maxExcessAfterPu: 0, qgenBefore: 16, qgenAfter: 4,
    overloadsAfter: 0, shedBeforeMW: 148, shedAfterMW: 150.5,
    gens: [{ gen: 1, bus: 10, vgBefore: 1.05, vgAfter: 1.04 }, { gen: 2, bus: 12, vgBefore: 0.99, vgAfter: 1.03 }, { gen: 3, bus: 25, vgBefore: 1.05, vgAfter: 1.049 }],
} };

test('voltageSummary: without a block returns null; with a block sorts the generators by the largest Vg change', () => {
    assert.equal(voltageSummary(data), null);
    assert.equal(voltageSummary(null), null);
    const v = voltageSummary(withVoltage);
    assert.deepEqual([v.applied, v.before, v.after, v.resolved, v.loops], [true, 3, 0, true, 2]);
    assert.deepEqual(v.gens.map(g => g.bus), [12, 10, 25]);
    assert.ok(Math.abs(v.gens[0].delta - 0.04) < 1e-9);
});

test('voltageSummary: an adjustment not applied or with remaining violations does not count as solved', () => {
    const notApplied = voltageSummary({ ...withVoltage, voltage: { ...withVoltage.voltage, applied: false, violationsAfter: 3, gens: [] } });
    assert.equal(notApplied.applied, false);
    assert.equal(notApplied.resolved, false);
    assert.equal(voltageSummary({ ...withVoltage, voltage: { ...withVoltage.voltage, violationsAfter: 1 } }).resolved, false);
});

test('plan caption mentions the voltage adjustment only when it was applied', () => {
    assert.doesNotMatch(stageCaption(data, 'after', 'line 7'), /voltage/);
    assert.match(stageCaption(withVoltage, 'after', 'line 7'), /voltage adjustment at 3 generator\(s\)/);
    assert.doesNotMatch(stageCaption({ ...withVoltage, voltage: { ...withVoltage.voltage, applied: false, gens: [] } }, 'after', 'line 7'), /voltage/);
    assert.match(stageCaption(withVoltage, 'after', 'line 7'), /redispatch of .* MW, shedding of .* MW of load and voltage/);
});
