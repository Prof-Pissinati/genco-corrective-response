// GENCO as a plan verifier: reading of the results and display rules, for the main model (authors) and our N-10.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verificationFor, verificationIndex, verificationRows, verificationSummary, safeThreshold, recommendedFolga } from '../src/solver/verification.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../src/data/verificacao_planos_case118_ieee_${n}.json`, import.meta.url)));
const data = load('autores');       // main model (authors checkpoint)
const n10 = load('n10');            // nosso treino

test('safe threshold and recommended margin come from the file of each model', () => {
    assert.equal(safeThreshold(data), 99, 'the authors model has almost no bias: safe approving up to 99%');
    assert.equal(safeThreshold(n10), 100, 'our N-10 overestimates: safe approving up to 100%');
    assert.equal(recommendedFolga(data), 3);
    assert.equal(recommendedFolga(n10), 8);
    assert.equal(safeThreshold(null), 100);
    assert.equal(recommendedFolga(null), 0);
});

test('only a single line out (no buses) has a verification', () => {
    const k = data.lines[0].id;
    assert.equal(verificationFor(data, { branchOut: [k], busOut: [] }).id, k);
    assert.equal(verificationFor(data, { branchOut: [k, 9999], busOut: [] }), null);
    assert.equal(verificationFor(data, { branchOut: [k], busOut: [5] }), null);
    assert.equal(verificationFor(data, { branchOut: [], busOut: [5] }), null);
    assert.equal(verificationFor(data, null), null);
    assert.equal(verificationFor(null, { branchOut: [k], busOut: [] }), null);
    assert.equal(verificationFor(data, { branchOut: [123456], busOut: [] }), null, 'a line that needs no plan or that islands buses is not in the file');
});

test('table rows: AC, GENCO and DC per state, and the GENCO verdict at the safe threshold', () => {
    const v = verificationFor(data, { branchOut: [data.lines[0].id], busOut: [] });
    assert.deepEqual(v.rows.map(r => r.key), ['semPlano', 'folga0', 'folga3']);
    assert.equal(v.threshold, 99); assert.equal(v.folgaPct, 3);
    const noPlan = v.rows[0];
    assert.equal(noPlan.ac, data.lines[0].semPlano.ac.maxPct);
    assert.equal(noPlan.gencoApproves, noPlan.genco <= 99);
    assert.equal(noPlan.acSafe, false, 'the no-plan state of a contingency that needs action is overloaded');
    assert.deepEqual(verificationRows(null, data), []);
    const v10 = verificationFor(n10, { branchOut: [n10.lines[0].id], busOut: [] });
    assert.deepEqual(v10.rows.map(r => r.key), ['semPlano', 'folga0', 'folga8']);
});

test('at the safe threshold of each model, GENCO never approves a state that the AC flags as overloaded', () => {
    for (const d of [data, n10]) {
        let wrong = 0, total = 0;
        for (const l of verificationIndex(d).values()) {
            for (const r of verificationRows(l, d)) { total++; if (r.gencoApproves && !r.acSafe) wrong++; }
        }
        assert.ok(total > 200);
        assert.equal(wrong, 0, d.model);
    }
});

test('summary: numbers consistent with the file and with the statements of the panel', () => {
    const s = verificationSummary(data), a = verificationSummary(n10);
    assert.equal(s.contingencies, data.lines.length);
    assert.equal(s.states, data.estados);
    assert.ok(s.maeGenco < s.maeDc && a.maeGenco < a.maeDc, 'GENCO has a smaller mean error per line than the DC');
    assert.ok(s.maeGenco < a.maeGenco, 'the authors checkpoint errs less than our N-10');
    assert.equal(a.wrongAt100, 0, 'our N-10, approving up to 100%, does not approve an insufficient plan');
    assert.ok(s.wrongAt100 > 0 && s.threshold === 99, 'the authors one needs a 99% threshold for zero wrongful approvals');
    assert.ok(s.wrongDc > 50, 'com o limiar de 100% o DC aprova muitos planos insuficientes');
    assert.ok(s.margin.approved / s.margin.plans > 0.9, 'with the recommended margin GENCO approves more than 90% of the plans');
    assert.ok(s.margin.pct < a.margin.pct, 'the authors model needs less margin (costs less) than our N-10');
    assert.ok(s.margin.shedMW < a.margin.shedMW);
    assert.ok(s.dcSafe.shedMW > s.margin.shedMW && s.dcSafe.redispatchMW > s.margin.redispatchMW, 'the DC is only safe with a larger margin, which costs more');
    assert.equal(verificationSummary(null), null);
});

test('file consistency: plans with margin stay below the limit in the AC; contingencies that island were left out', () => {
    for (const d of [data, n10]) {
        for (const l of d.lines) {
            assert.ok(l.folga5.ac.maxPct <= 100, `line ${l.id}`);
            assert.ok(l.semPlano.ac.maxPct >= l.folga0.ac.maxPct - 1e-9, 'the plan does not worsen the network');
        }
        assert.equal(d.pulados.length, 9);
    }
    assert.deepEqual(data.lines.map(l => l.id), n10.lines.map(l => l.id), 'the same 89 contingencies in both models');
});
