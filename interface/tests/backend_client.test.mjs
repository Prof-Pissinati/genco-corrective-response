// Tests of the backend adapter (no network): conversion of the real API response to the interface format.
// Rodar: node --test tests/backend_client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTransmissionSystem } from '../src/utils/transmission.js';
import { toInterfaceResult, topologyFromState, buildRequest } from '../src/solver/backendClient.js';

const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const resp = JSON.parse(fs.readFileSync(new URL('./fixtures/backend_ac_case118.json', import.meta.url)));
const sys = buildTransmissionSystem(caso, { gridName: 'case118_ieee' });

test('interface topology -> API', () => {
    const br = sys.branches.map(b => ({ ...b }));
    br[3].state = 0; br[10].state = 0;
    const t = topologyFromState(br, new Set([100, '81']));
    assert.deepEqual(t.branchOut, [3, 10]);
    assert.deepEqual(t.busOut, [100, 81]);
});

test('request: built-in case goes by name; imported case carries the MATPOWER tables', () => {
    assert.deepEqual(buildRequest(sys.transmission, 'ac', [{}]).grid, 'case118_ieee');
    const imported = buildTransmissionSystem({ baseMVA: caso.baseMVA, bus: caso.bus, gen: caso.gen, branch: caso.branch }, {});
    const req = buildRequest(imported.transmission, 'dc', [{}]);
    assert.equal(req.grid, undefined);
    assert.equal(req.case.bus.length, 118);
});

test('AC response of the base case -> interface format (real voltages, loading in %, MW)', () => {
    const r = toInterfaceResult(resp.results[0], sys.branches);
    assert.equal(Object.keys(r.nodes).length, 118);
    assert.equal(Object.keys(r.lines).length, 186);
    assert.equal(r.summary.mode, 'AC');
    // AC brings voltages different from 1.0 pu (the DC fixes 1.0)
    assert.ok(Object.values(r.nodes).some(n => Math.abs(n.v - 1) > 0.01));
    const api = resp.results[0].branches[5];
    assert.ok(Math.abs(r.lines[api.id].percentage - api.loading * 100) < 1e-9);
    assert.ok(Math.abs(r.lines[api.id].pFlow - api.pf * 1000) < 1e-9);
    assert.equal(r.lines[api.id].unit, 'MW');
});

test('response with faults 81+100: 106 buses and isolated branches with zero flow', () => {
    const res = resp.results[1];
    const r = toInterfaceResult(res, sys.branches);
    assert.equal(Object.keys(r.nodes).length, 106);
    assert.equal(r.nodes[100], undefined);
    assert.equal(r.summary.lostMW, 339);
    const ativos = new Set(res.branches.map(b => b.id));
    sys.branches.forEach(b => { if (!ativos.has(b.id)) assert.equal(r.lines[b.id].percentage, 0); });
});

test('backend result carries the generation per bus (the dispatch of the stage) and it matches the load served', () => {
    const r = toInterfaceResult(resp.results[0], sys.branches);
    const gens = resp.results[0].gens;
    const porBarra = new Map();
    gens.forEach(g => porBarra.set(g.bus, (porBarra.get(g.bus) || 0) + g.pg));
    for (const [bus, pg] of porBarra) {
        assert.ok(Math.abs(r.nodes[bus].pg - pg) < 1e-9, `bus ${bus}`);
        assert.equal(typeof r.nodes[bus].qg, 'number');
    }
    const total = Object.values(r.nodes).reduce((s, n) => s + (n.pg || 0), 0);
    assert.ok(Math.abs(total - r.summary.genMW) < 1e-6);
});
