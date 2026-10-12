import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScreenRequest, filterRows, gencoIndex, gencoSummary } from '../src/solver/screening.js';

const genco = JSON.parse(readFileSync(new URL('../src/data/screening_case118_ieee.json', import.meta.url)));

test('pedido usa o nome do caso quando existe, senão as tabelas', () => {
    assert.deepEqual(buildScreenRequest({ gridName: 'case118_ieee', mpc: {} }), { scope: 'both', grid: 'case118_ieee' });
    assert.deepEqual(buildScreenRequest({ gridName: null, mpc: { a: 1 } }, 'lines'), { scope: 'lines', case: { a: 1 } });
});

test('filtros da lista de contingências', () => {
    const data = { contingencies: [
        { type: 'line', id: 1, needsAction: true }, { type: 'bus', id: 2, needsAction: true }, { type: 'line', id: 3, needsAction: false },
    ] };
    assert.equal(filterRows(data).length, 2);
    assert.equal(filterRows(data, { onlyAction: false }).length, 3);
    assert.deepEqual(filterRows(data, { onlyAction: false, kind: 'line' }).map(c => c.id), [1, 3]);
    assert.deepEqual(filterRows(null), []);
    const rep = { contingencies: [{ type: 'line', id: 1, needsAction: true, hasPlan: true }, { type: 'line', id: 2, needsAction: true, hasPlan: false }] };
    assert.deepEqual(filterRows(rep, { onlyReady: true }).map(c => c.id), [1]);
    assert.equal(filterRows(rep).length, 2);
    assert.equal(filterRows(data, { onlyReady: true }).length, 2, 'sem hasPlan (backend ao vivo) tudo conta como disponível');
});

test('resumo do GENCO bate com o arquivo gerado pela validação', () => {
    const g = gencoSummary(genco);
    assert.equal(g.scenarios, genco.scenarios);
    assert.ok(g.maeGenco < g.maeDc, 'GENCO deve ter erro médio menor que o DC');
    assert.ok(g.recall90.genco > g.recall90.dc);
    assert.equal(gencoSummary(null), null);
    assert.equal(gencoIndex(genco).size, genco.lines.length);
});
