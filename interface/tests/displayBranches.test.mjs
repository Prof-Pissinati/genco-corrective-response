// Bus fault: the lines connected to it appear open in the display, without changing the original data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { branchesForDisplay } from '../src/utils/displayBranches.js';

const br = [
    { id: 0, from: 1, to: 2, state: 1 }, { id: 1, from: 2, to: 3, state: 1 },
    { id: 2, from: 3, to: 4, state: 0 }, { id: 3, from: 9, to: 2, state: 1 },
];

test('without a faulted bus returns the same list (without recreating objects)', () => {
    assert.equal(branchesForDisplay(br, new Set()), br);
    assert.equal(branchesForDisplay(br, null), br);
    assert.equal(branchesForDisplay(br, new Set([77])), br, 'bus without connected lines: nothing changes');
});

test('the lines connected to the faulted bus (at both ends) become open; the others do not', () => {
    const out = branchesForDisplay(br, new Set([2]));
    assert.deepEqual(out.map(b => b.state), [0, 0, 0, 0]);
    assert.deepEqual(out.map(b => !!b.openByFault), [true, true, false, true], 'the one that was already open is not marked as opened by fault');
    assert.equal(br[0].state, 1, 'the original data is not changed');
    assert.equal(branchesForDisplay(br, new Set([4]))[3], br[3], 'unaffected lines keep the same object');
});

test('accepts bus numbers as text or number', () => {
    assert.deepEqual(branchesForDisplay(br, new Set(['9'])).map(b => b.state), [1, 1, 0, 0]);
});

test('IEEE 118, fault at bus 68: opens the 4 lines connected to it', () => {
    const caso = JSON.parse(readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
    const branches = caso.branch.map((b, i) => ({ id: i, from: b[0], to: b[1], state: 1 }));
    const out = branchesForDisplay(branches, new Set([68]));
    const abertas = out.filter(b => b.openByFault).map(b => `${b.from}-${b.to}`).sort();
    assert.deepEqual(abertas, ['65-68', '68-116', '68-69', '68-81']);
    assert.equal(out.filter(b => b.state === 0).length, 4, 'only those stay open');
});
