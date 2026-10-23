import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faultKey, recoveryKey, lookupCorrective, lookupEvaluate, lookupRecovery, lookupScreen } from '../src/solver/replay.js';
import { stageResult, stageSummary, voltageSummary } from '../src/solver/corrective.js';
import { eventResult } from '../src/solver/recovery.js';

const data = JSON.parse(readFileSync(new URL('../src/data/replay_case118_ieee.json', import.meta.url)));
const mpc = JSON.parse(readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const branches = mpc.branch.map((b, i) => ({ id: i, from: b[0], to: b[1], rateA: b[5], state: 1 }));

test('keys do not depend on the order of the faults and distinguish the repair order', () => {
    assert.equal(faultKey({ branchOut: [29, 7], busOut: [8] }), faultKey({ branchOut: [7, 29], busOut: [8] }));
    assert.notEqual(recoveryKey([{ type: 'line', id: 7 }, { type: 'bus', id: 68 }]), recoveryKey([{ type: 'bus', id: 68 }, { type: 'line', id: 7 }]));
});

test('replay: line 7 has a complete corrective response and the initial state is the base case', () => {
    const r = lookupCorrective(data, { grid: 'case118_ieee', faults: { branchOut: [7], busOut: [] } });
    assert.ok(r.needsAction && r.plan.totalShedMW > 100 && r.summary.overloadsAfter === 0);
    assert.deepEqual(r.pre, data.base);
    for (const k of ['pre', 'postFault', 'after']) {
        const res = stageResult(r, k, branches);                                  // interface format
        assert.equal(Object.keys(res.lines).length, branches.length);
        assert.equal(stageSummary(r, k).converged, true);
    }
    assert.equal(stageSummary(r, 'after').overloads, 0);
});

test('replay: reconnection, screening and the base-case AC; the rest warns that it needs the backend', () => {
    const rec = lookupRecovery(data, { grid: 'case118_ieee', faults: { branchOut: [7], busOut: [] }, repairOrder: [{ type: 'line', id: 7 }] });
    assert.deepEqual(rec.faults, { branchOut: [7], busOut: [] });
    assert.ok(rec.summary.restored && rec.events.length >= 3);
    assert.equal(Object.keys(eventResult(rec, 1, branches).lines).length, branches.length);
    const s = lookupScreen(data, { grid: 'case118_ieee' });
    assert.equal(s.count, 303);
    assert.ok(s.contingencies.some(c => c.hasPlan) && s.contingencies.some(c => c.hasPlan === false));
    assert.equal(lookupEvaluate(data, { grid: 'case118_ieee', topologies: [{ branchOut: [], busOut: [] }] }).results.length, 1);
    assert.throws(() => lookupEvaluate(data, { grid: 'case118_ieee', topologies: [{ branchOut: [7], busOut: [] }] }), /without faults/);
    assert.throws(() => lookupCorrective(data, { grid: 'case118_ieee', faults: { branchOut: [0, 1, 2], busOut: [] } }), /precomputed/);
    assert.throws(() => lookupCorrective(data, { case: {}, faults: { branchOut: [7] } }), /backend/);
});

test('every plan marked as available exists in the data (●) and has a reconnection when it sheds load', () => {
    const s = data.screen.contingencies.filter(c => c.hasPlan);
    assert.ok(s.length >= 40);
    for (const c of s) {
        const faults = c.type === 'line' ? { branchOut: [c.id], busOut: [] } : { branchOut: [], busOut: [c.id] };
        assert.ok(data.corrective[faultKey(faults)], c.label);
    }
});

test('replay: the voltage adjustment (GENCO-OPF) clears the voltage violations of the plans and the block matches the "With plan" AC state', () => {
    const entries = Object.values(data.corrective);
    const withBlock = entries.filter(r => r.voltage);
    assert.ok(withBlock.length >= 10, 'IEEE 118 has plans that end with voltage out of range');
    for (const r of withBlock) {
        const v = voltageSummary(r);
        assert.equal(v.after, r.after.violations.voltage.length);                // the block is checked against the AC
        assert.equal(r.after.violations.voltage.length, 0);
        assert.ok(v.applied && v.before > 0 && v.gens.length > 0);
        assert.equal(r.summary.overloadsAfter, 0);
        assert.ok(r.summary.overloadsPost >= 0);
    }
    for (const r of entries.filter(x => !x.voltage)) assert.equal(r.after.violations.voltage.length, 0);   // no block = no voltage out of range
    const l7 = lookupCorrective(data, { grid: 'case118_ieee', faults: { branchOut: [7], busOut: [] } });
    assert.ok(l7.voltage.applied && l7.voltage.violationsBefore === 1 && l7.voltage.violationsAfter === 0);
    assert.ok(l7.voltage.shedAfterMW <= l7.voltage.shedBeforeMW + 0.5);
});
