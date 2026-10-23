// Tests of the transmission support. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMatpower } from '../src/utils/matpowerParser.js';
import { buildTransmissionSystem, solveTransmissionDC } from '../src/utils/transmission.js';

const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const ref = JSON.parse(fs.readFileSync(new URL('./case118_dc_ref.json', import.meta.url)));
const mFile = fs.readFileSync(new URL('../src/data/pglib_opf_case118_ieee.m', import.meta.url), 'utf8');

test('MATPOWER parser: the .m tables match those of the exported JSON', () => {
    const mpc = parseMatpower(mFile);
    assert.equal(mpc.baseMVA, 100);
    assert.equal(mpc.bus.length, 118);
    assert.equal(mpc.branch.length, 186);
    assert.equal(mpc.gen.length, 54);
    // the JSON carries the AC-OPF optimal point in Vm/Va (columns 7 and 8 of the bus table); the rest of the table is the file's
    const semTensao = (tabela) => tabela.map(r => r.filter((_, k) => k !== 7 && k !== 8));
    assert.deepEqual(semTensao(mpc.bus), semTensao(caso.bus));
    assert.deepEqual(mpc.branch, caso.branch);
});

test('conversion: reference, sources, loads in kW and branches', () => {
    const sys = buildTransmissionSystem(caso, { layout: caso.layout, name: 'IEEE 118' });
    assert.equal(sys.mode, 'transmission');
    assert.deepEqual(sys.sources, [69]);
    assert.equal(sys.branches.length, 186);
    assert.ok(Math.abs(Object.values(sys.loads).reduce((s, l) => s + l.p, 0) - 4242000) < 1e-6);
    assert.equal(Object.keys(sys.positionsProject).length, 118);
});

test('the dispatch in the file does not match the load: rebalances to the total load, without exceeding Pmax', () => {
    const mpc = parseMatpower(mFile);
    const sys = buildTransmissionSystem(mpc);
    const pg = sys.transmission.gens.reduce((s, g) => s + g.pg, 0);
    assert.ok(Math.abs(pg - 4242) < 1e-6, `Pg total = ${pg}`);
    assert.ok(sys.transmission.dispatchAdjusted);
    sys.transmission.gens.forEach(g => assert.ok(g.pg <= Math.max(g.pmax, 0) + 1e-9, `gerador ${g.id} acima de Pmax`));
    // the exported OPF dispatch already matches: it must not be changed
    const ok = buildTransmissionSystem(caso);
    assert.equal(ok.transmission.dispatchAdjusted, false);
});

for (const c of ref.cases) {
    test(`JS DC solver = independent reference (${c.name})`, () => {
        const sys = buildTransmissionSystem(caso, { layout: caso.layout });
        sys.branches.forEach(b => { if (c.outBranches.includes(b.id)) b.state = 0; });
        const res = solveTransmissionDC(sys.branches, new Set(c.outBuses), sys);
        assert.equal(Object.keys(res.nodes).length, c.energized.length, 'same set of energized buses');
        c.energized.forEach(n => assert.ok(res.nodes[n], `bus ${n} energized`));
        let maxErr = 0;
        c.flows.forEach((f, i) => { maxErr = Math.max(maxErr, Math.abs(res.lines[i].pFlow / 1000 - f)); });
        assert.ok(maxErr < 1e-3, `maximum flow error ${maxErr} MW`);
    });
}

test('bus fault: the load of the bus and of the isolated islands counts as lost', () => {
    const sys = buildTransmissionSystem(caso);
    const base = solveTransmissionDC(sys.branches, new Set(), sys);
    assert.ok(Math.abs(base.summary.lostMW) < 1e-6);
    assert.ok(Math.abs(base.summary.servedMW - 4242) < 1e-6);
    const r = solveTransmissionDC(sys.branches, new Set([59]), sys);   // 204 MW bus in IEEE 118
    assert.ok(r.summary.lostMW >= sys.loads[59].p / 1000 - 1e-9);
    assert.ok(Math.abs(r.summary.servedMW + r.summary.lostMW - 4242) < 1e-6);
});

test('faulted reference bus: nothing energized', () => {
    const sys = buildTransmissionSystem(caso);
    const r = solveTransmissionDC(sys.branches, new Set([69]), sys);
    assert.equal(Object.keys(r.nodes).length, 0);
    assert.ok(Math.abs(r.summary.lostMW - 4242) < 1e-6);
});

test('solver: energized buses carry unit MW (the interface shows MW)', () => {
    const sys = buildTransmissionSystem(caso);
    const r = solveTransmissionDC(sys.branches, new Set(), sys);
    assert.equal(r.nodes[10].unit, 'MW');
    assert.equal(r.lines[0].unit, 'MW');
});

test('built-in case name = file name (it is the name the backend knows)', () => {
    assert.equal(caso.name, 'case118_ieee');
});

test('DC solver: the generation per bus matches the load served and the reference absorbs the imbalance', () => {
    const sys = buildTransmissionSystem(caso);
    for (const faults of [new Set(), new Set([100]), new Set([81, 11])]) {
        const r = solveTransmissionDC(sys.branches, faults, sys);
        const total = Object.values(r.nodes).reduce((s, n) => s + (n.pg || 0), 0);
        assert.ok(Math.abs(total - r.summary.servedMW) < 1e-6, `faults ${[...faults]}`);
    }
});
