// Testes do adaptador do backend (sem rede): conversão da resposta real da API para o formato da interface.
// Rodar: node --test tests/backend_client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTransmissionSystem } from '../src/utils/transmission.js';
import { toInterfaceResult, topologyFromState, buildRequest } from '../src/solver/backendClient.js';

const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const resp = JSON.parse(fs.readFileSync(new URL('./fixtures/backend_ac_case118.json', import.meta.url)));
const sys = buildTransmissionSystem(caso, { gridName: 'case118_ieee' });

test('topologia da interface -> API', () => {
    const br = sys.branches.map(b => ({ ...b }));
    br[3].state = 0; br[10].state = 0;
    const t = topologyFromState(br, new Set([100, '81']));
    assert.deepEqual(t.branchOut, [3, 10]);
    assert.deepEqual(t.busOut, [100, 81]);
});

test('pedido: caso embutido vai pelo nome; caso importado leva as tabelas MATPOWER', () => {
    assert.deepEqual(buildRequest(sys.transmission, 'ac', [{}]).grid, 'case118_ieee');
    const imported = buildTransmissionSystem({ baseMVA: caso.baseMVA, bus: caso.bus, gen: caso.gen, branch: caso.branch }, {});
    const req = buildRequest(imported.transmission, 'dc', [{}]);
    assert.equal(req.grid, undefined);
    assert.equal(req.case.bus.length, 118);
});

test('resposta AC do caso base -> formato da interface (tensões reais, carregamento em %, MW)', () => {
    const r = toInterfaceResult(resp.results[0], sys.branches);
    assert.equal(Object.keys(r.nodes).length, 118);
    assert.equal(Object.keys(r.lines).length, 186);
    assert.equal(r.summary.mode, 'AC');
    // AC traz tensões diferentes de 1,0 pu (o DC fixa 1,0)
    assert.ok(Object.values(r.nodes).some(n => Math.abs(n.v - 1) > 0.01));
    const api = resp.results[0].branches[5];
    assert.ok(Math.abs(r.lines[api.id].percentage - api.loading * 100) < 1e-9);
    assert.ok(Math.abs(r.lines[api.id].pFlow - api.pf * 1000) < 1e-9);
    assert.equal(r.lines[api.id].unit, 'MW');
});

test('resposta com faltas 81+100: 106 barras e ramos isolados com fluxo zero', () => {
    const res = resp.results[1];
    const r = toInterfaceResult(res, sys.branches);
    assert.equal(Object.keys(r.nodes).length, 106);
    assert.equal(r.nodes[100], undefined);
    assert.equal(r.summary.lostMW, 339);
    const ativos = new Set(res.branches.map(b => b.id));
    sys.branches.forEach(b => { if (!ativos.has(b.id)) assert.equal(r.lines[b.id].percentage, 0); });
});
