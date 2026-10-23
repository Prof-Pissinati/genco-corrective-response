// Per-line GENCO and AC loading for the intact network and single-line outages (data of backend/tools/export_genco_lines.py) and its use in the diagram.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { outageKey, storedState, gencoErrorPoints, composeStoredResult, referenceGeneration } from '../src/solver/gencoLines.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url)));
const KEYS = ['case14_ieee', 'case30_ieee', 'case57_ieee', 'case118_ieee'];

test('outageKey: intact network, exactly one open line, anything else', () => {
    const br = [{ id: 0, state: 1 }, { id: 1, state: 1 }, { id: 2, state: 1 }];
    assert.equal(outageKey(br, new Set()), 'base');
    assert.equal(outageKey(br.map(b => (b.id === 1 ? { ...b, state: 0 } : b)), new Set()), '1');
    assert.equal(outageKey(br.map(b => ({ ...b, state: 0 })), new Set()), null, 'several open lines');
    assert.equal(outageKey(br, new Set([5])), null, 'a faulted bus');
    assert.equal(outageKey(br.map(b => (b.id === 2 ? { ...b, state: 0, openByFault: true } : b)), new Set()), 'base', 'a line opened by a bus fault is not a user outage');
});

test('storedState: base, an outage and a missing one', () => {
    const d = { base: { x: 1 }, outages: { 7: { x: 2 } } };
    assert.equal(storedState(d, 'base').x, 1);
    assert.equal(storedState(d, '7').x, 2);
    assert.equal(storedState(d, '8'), null);
    assert.equal(storedState(null, 'base'), null);
    assert.equal(storedState(d, null), null);
});

test('composeStoredResult: everything comes from the file (loading, flows, voltages, generation) and a branch that is out carries zeros', () => {
    const data = { busNo: [1, 2], genBus: [1], refBus: 1, loadMW: 90 };
    const entry = {
        ac: [55, 0], acPf: [-50, 0], acQf: [10, 0], acVm: [1.02, 0.99], acVa: [0, -3], acPg: [91], acQg: [12],
        genco: [57, 0], gencoPf: [-52, 0], gencoQf: [11, 0], gencoVm: [1.03, 0.98], gencoVa: [0, -3.5], gencoPg: [93], gencoQg: [14],
    };
    const br = [{ id: 0, rateA: 100 }, { id: 1, rateA: 100 }];
    const g = composeStoredResult(entry, 'genco', br, data);
    assert.equal(g.lines[0].percentage, 57);
    assert.ok(Math.abs(g.lines[0].current - 57) < 1e-9);
    assert.deepEqual([g.lines[0].pFlow, g.lines[0].qFlow], [-52000, 11000]);
    assert.deepEqual([g.lines[1].percentage, g.lines[1].current, g.lines[1].pFlow], [0, 0, 0], 'branch out');
    assert.deepEqual([g.nodes[1].v, g.nodes[2].v, g.nodes[2].angle, g.nodes[1].pg, g.nodes[1].qg], [1.03, 0.98, -3.5, 93, 14]);
    assert.equal(g.nodes[2].pg, undefined, 'only generator buses carry generation');
    assert.deepEqual([g.summary.mode, g.summary.source, g.summary.servedMW, g.summary.genMW], ['GENCO', 'precomputed', 90, 93]);
    const a = composeStoredResult(entry, 'ac', br, data);
    assert.deepEqual([a.lines[0].percentage, a.lines[0].pFlow, a.nodes[1].pg], [55, -50000, 91]);
    assert.deepEqual(referenceGeneration(entry, data), { bus: 1, ac: 91, genco: 93, diff: 2 });
});

test('gencoErrorPoints: ignores the lines that are out', () => {
    const e = gencoErrorPoints({ ac: [100, 0, 50], genco: [101, 5, 48] });
    assert.deepEqual([e.lines, Math.round(e.mean * 100) / 100, e.max], [2, 1.5, 2]);
});

for (const key of KEYS) {
    test(`${key}: the file is consistent with the case, the screening and the published error of the authors' checkpoint`, () => {
        const d = read(`genco_lines_${key}.json`);
        const mpc = read(`${key}.json`);
        const scr = read(`screening_${key}_autores.json`);
        assert.equal(d.case, key);
        assert.equal(d.branches, mpc.branch.length);
        assert.deepEqual(d.busNo, mpc.bus.map(r => r[0]));
        assert.equal(d.base.ac.length, d.branches);
        assert.equal(d.base.acVm.length, d.busNo.length);
        for (const m of ['ac', 'genco']) {
            assert.equal(d.base[`${m}Pf`].length, d.branches);
            assert.equal(d.base[`${m}Pg`].length, d.genBus.length);
            assert.equal(d.base[`${m}Va`].length, d.busNo.length);
        }
        assert.ok(d.genBus.includes(d.refBus), 'the reference bus is a generator bus');
        assert.ok(Math.abs(d.base.acPg.reduce((x, y) => x + y, 0) - d.loadMW) < 0.08 * d.loadMW, 'generation ≈ load plus losses (within 8%)');
        assert.equal(Object.keys(d.outages).length, scr.scenarios, 'one entry per validated outage');
        for (const l of scr.lines) {
            const e = d.outages[String(l.id)];
            assert.ok(e, `outage ${l.id}`);
            assert.equal(e.ac[l.id], 0, 'the line that is out carries nothing');
            assert.ok(Math.abs(Math.max(...e.genco) - l.genco.maxPct) < 0.15, `GENCO max loading, outage ${l.id}`);
            assert.ok(Math.abs(Math.max(...e.ac) - l.ac.maxPct) < 0.15, `AC max loading, outage ${l.id}`);
        }
        const mean = Object.values(d.outages).map(e => gencoErrorPoints(e).mean).reduce((a, b) => a + b, 0) / Object.keys(d.outages).length;
        assert.ok(mean < 0.2, `mean |GENCO − AC| ${mean}`);
        const dPf = Object.values(d.outages).map(e => e.acPf.reduce((acc, v, i) => acc + Math.abs(e.gencoPf[i] - v), 0) / e.acPf.filter(v => v !== 0).length);
        assert.ok(dPf.reduce((x, y) => x + y, 0) / dPf.length < 1, 'mean |P flow| error below 1 MW');
        const dRef = Object.values(d.outages).map(e => Math.abs(referenceGeneration(e, d).diff));
        assert.ok(dRef.reduce((x, y) => x + y, 0) / dRef.length < 10, 'mean error of the reference-bus generation below 10 MW');
    });
}
