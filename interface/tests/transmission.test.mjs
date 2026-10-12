// Testes do suporte a transmissão. Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMatpower } from '../src/utils/matpowerParser.js';
import { buildTransmissionSystem, solveTransmissionDC } from '../src/utils/transmission.js';

const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const ref = JSON.parse(fs.readFileSync(new URL('./case118_dc_ref.json', import.meta.url)));
const mFile = fs.readFileSync(new URL('../src/data/pglib_opf_case118_ieee.m', import.meta.url), 'utf8');

test('parser MATPOWER: tabelas do .m coincidem com as do JSON exportado', () => {
    const mpc = parseMatpower(mFile);
    assert.equal(mpc.baseMVA, 100);
    assert.equal(mpc.bus.length, 118);
    assert.equal(mpc.branch.length, 186);
    assert.equal(mpc.gen.length, 54);
    // o JSON traz o ponto ótimo do AC-OPF em Vm/Va (colunas 7 e 8 da tabela de barras); o resto da tabela é o do arquivo
    const semTensao = (tabela) => tabela.map(r => r.filter((_, k) => k !== 7 && k !== 8));
    assert.deepEqual(semTensao(mpc.bus), semTensao(caso.bus));
    assert.deepEqual(mpc.branch, caso.branch);
});

test('conversão: referência, fontes, cargas em kW e ramos', () => {
    const sys = buildTransmissionSystem(caso, { layout: caso.layout, name: 'IEEE 118' });
    assert.equal(sys.mode, 'transmission');
    assert.deepEqual(sys.sources, [69]);
    assert.equal(sys.branches.length, 186);
    assert.ok(Math.abs(Object.values(sys.loads).reduce((s, l) => s + l.p, 0) - 4242000) < 1e-6);
    assert.equal(Object.keys(sys.positionsProject).length, 118);
});

test('despacho do arquivo não fecha com a carga: rebalanceia para a carga total, sem passar de Pmax', () => {
    const mpc = parseMatpower(mFile);
    const sys = buildTransmissionSystem(mpc);
    const pg = sys.transmission.gens.reduce((s, g) => s + g.pg, 0);
    assert.ok(Math.abs(pg - 4242) < 1e-6, `Pg total = ${pg}`);
    assert.ok(sys.transmission.dispatchAdjusted);
    sys.transmission.gens.forEach(g => assert.ok(g.pg <= Math.max(g.pmax, 0) + 1e-9, `gerador ${g.id} acima de Pmax`));
    // despacho do OPF exportado já fecha: não deve ser alterado
    const ok = buildTransmissionSystem(caso);
    assert.equal(ok.transmission.dispatchAdjusted, false);
});

for (const c of ref.cases) {
    test(`solver DC em JS = referência independente (${c.name})`, () => {
        const sys = buildTransmissionSystem(caso, { layout: caso.layout });
        sys.branches.forEach(b => { if (c.outBranches.includes(b.id)) b.state = 0; });
        const res = solveTransmissionDC(sys.branches, new Set(c.outBuses), sys);
        assert.equal(Object.keys(res.nodes).length, c.energized.length, 'mesmo conjunto de barras energizadas');
        c.energized.forEach(n => assert.ok(res.nodes[n], `barra ${n} energizada`));
        let maxErr = 0;
        c.flows.forEach((f, i) => { maxErr = Math.max(maxErr, Math.abs(res.lines[i].pFlow / 1000 - f)); });
        assert.ok(maxErr < 1e-3, `erro máximo de fluxo ${maxErr} MW`);
    });
}

test('falta em barra: carga da barra e das ilhas isoladas conta como perdida', () => {
    const sys = buildTransmissionSystem(caso);
    const base = solveTransmissionDC(sys.branches, new Set(), sys);
    assert.ok(Math.abs(base.summary.lostMW) < 1e-6);
    assert.ok(Math.abs(base.summary.servedMW - 4242) < 1e-6);
    const r = solveTransmissionDC(sys.branches, new Set([59]), sys);   // barra de 204 MW no IEEE 118
    assert.ok(r.summary.lostMW >= sys.loads[59].p / 1000 - 1e-9);
    assert.ok(Math.abs(r.summary.servedMW + r.summary.lostMW - 4242) < 1e-6);
});

test('barra de referência em falta: nada energizado', () => {
    const sys = buildTransmissionSystem(caso);
    const r = solveTransmissionDC(sys.branches, new Set([69]), sys);
    assert.equal(Object.keys(r.nodes).length, 0);
    assert.ok(Math.abs(r.summary.lostMW - 4242) < 1e-6);
});

test('solver: barras energizadas trazem unit MW (a interface mostra MW)', () => {
    const sys = buildTransmissionSystem(caso);
    const r = solveTransmissionDC(sys.branches, new Set(), sys);
    assert.equal(r.nodes[10].unit, 'MW');
    assert.equal(r.lines[0].unit, 'MW');
});

test('nome do caso embutido = nome do arquivo (é o nome que o backend conhece)', () => {
    assert.equal(caso.name, 'case118_ieee');
});
