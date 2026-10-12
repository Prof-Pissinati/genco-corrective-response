import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { faultKey, recoveryKey, lookupCorrective, lookupEvaluate, lookupRecovery, lookupScreen } from '../src/solver/replay.js';
import { stageResult, stageSummary } from '../src/solver/corrective.js';
import { eventResult } from '../src/solver/recovery.js';

const data = JSON.parse(readFileSync(new URL('../src/data/replay_case118_ieee.json', import.meta.url)));
const mpc = JSON.parse(readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const branches = mpc.branch.map((b, i) => ({ id: i, from: b[0], to: b[1], rateA: b[5], state: 1 }));

test('chaves independem da ordem das falhas e distinguem a ordem dos reparos', () => {
    assert.equal(faultKey({ branchOut: [29, 7], busOut: [8] }), faultKey({ branchOut: [7, 29], busOut: [8] }));
    assert.notEqual(recoveryKey([{ type: 'line', id: 7 }, { type: 'bus', id: 68 }]), recoveryKey([{ type: 'bus', id: 68 }, { type: 'line', id: 7 }]));
});

test('replay: linha 7 tem resposta corretiva completa e o estado inicial é o caso base', () => {
    const r = lookupCorrective(data, { grid: 'case118_ieee', faults: { branchOut: [7], busOut: [] } });
    assert.ok(r.needsAction && r.plan.totalShedMW > 100 && r.summary.overloadsAfter === 0);
    assert.deepEqual(r.pre, data.base);
    for (const k of ['pre', 'postFault', 'after']) {
        const res = stageResult(r, k, branches);                                  // formato da interface
        assert.equal(Object.keys(res.lines).length, branches.length);
        assert.equal(stageSummary(r, k).converged, true);
    }
    assert.equal(stageSummary(r, 'after').overloads, 0);
});

test('replay: religação, varredura e AC do caso base; o resto avisa que exige o backend', () => {
    const rec = lookupRecovery(data, { grid: 'case118_ieee', faults: { branchOut: [7], busOut: [] }, repairOrder: [{ type: 'line', id: 7 }] });
    assert.deepEqual(rec.faults, { branchOut: [7], busOut: [] });
    assert.ok(rec.summary.restored && rec.events.length >= 3);
    assert.equal(Object.keys(eventResult(rec, 1, branches).lines).length, branches.length);
    const s = lookupScreen(data, { grid: 'case118_ieee' });
    assert.equal(s.count, 303);
    assert.ok(s.contingencies.some(c => c.hasPlan) && s.contingencies.some(c => c.hasPlan === false));
    assert.equal(lookupEvaluate(data, { grid: 'case118_ieee', topologies: [{ branchOut: [], busOut: [] }] }).results.length, 1);
    assert.throws(() => lookupEvaluate(data, { grid: 'case118_ieee', topologies: [{ branchOut: [7], busOut: [] }] }), /sem falhas/);
    assert.throws(() => lookupCorrective(data, { grid: 'case118_ieee', faults: { branchOut: [0, 1, 2], busOut: [] } }), /pré-calculados/);
    assert.throws(() => lookupCorrective(data, { case: {}, faults: { branchOut: [7] } }), /backend/);
});

test('todo plano marcado como disponível existe nos dados (●) e tem religação quando corta carga', () => {
    const s = data.screen.contingencies.filter(c => c.hasPlan);
    assert.ok(s.length >= 40);
    for (const c of s) {
        const faults = c.type === 'line' ? { branchOut: [c.id], busOut: [] } : { branchOut: [], busOut: [c.id] };
        assert.ok(data.corrective[faultKey(faults)], c.label);
    }
});
