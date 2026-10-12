import test from 'node:test';
import assert from 'node:assert/strict';
import { faultItems, moveItem, buildRecoveryRequest, eventShed, unservedSeries, recoverySummaryText } from '../src/solver/recovery.js';

test('falhas atuais viram itens reparáveis (linhas abertas e barras em falta)', () => {
    const branches = [{ id: 0, from: 1, to: 2, state: 1 }, { id: 7, from: 8, to: 5, state: 0 }];
    const items = faultItems(branches, new Set([68]));
    assert.deepEqual(items, [{ type: 'line', id: 7, label: 'linha 8–5' }, { type: 'bus', id: 68, label: 'barra 68' }]);
});

test('mover itens da ordem de reparo respeita as pontas', () => {
    const o = ['a', 'b', 'c'];
    assert.deepEqual(moveItem(o, 1, -1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(o, 0, -1), o);
    assert.deepEqual(moveItem(o, 2, 1), o);
    assert.deepEqual(o, ['a', 'b', 'c'], 'não altera a lista original');
});

test('pedido separa linhas e barras e mantém a ordem dos reparos', () => {
    const order = [{ type: 'bus', id: 68, label: 'x' }, { type: 'line', id: 7, label: 'y' }];
    const r = buildRecoveryRequest({ gridName: 'case118_ieee' }, order, { blockMW: 40 });
    assert.deepEqual(r.faults, { branchOut: [7], busOut: [68] });
    assert.deepEqual(r.repairOrder, [{ type: 'bus', id: 68 }, { type: 'line', id: 7 }]);
    assert.equal(r.grid, 'case118_ieee');
    assert.deepEqual(buildRecoveryRequest({ gridName: null, mpc: { a: 1 } }, order).case, { a: 1 });
});

test('série da carga não suprida e texto-resumo', () => {
    const data = {
        events: [{ tHours: 0, unservedMW: 148, kind: 'plan', shed: [{ bus: 15, mw: 90, pct: 1 }] }, { tHours: 2, unservedMW: 148, kind: 'repair', shed: [] }, { tHours: 2.5, unservedMW: 0, kind: 'reconnect', shed: [] }],
        summary: { restored: true, totalHours: 2.5, ensMWh: 296, blocks: 1, blocksWithOverload: 0, finalUnservedMW: 0 },
    };
    const s = unservedSeries(data);
    assert.equal(s.tMax, 2.5); assert.equal(s.mwMax, 148); assert.equal(s.pts.length, 3);
    assert.equal(eventShed(data, 0).get(15).mw, 90);
    assert.match(recoverySummaryText(data), /restaurada em 2\.50 h · ENS 296 MWh · 1 blocos/);
    assert.match(recoverySummaryText({ ...data, summary: { ...data.summary, restored: false, finalUnservedMW: 12, blocksWithOverload: 2 } }), /Não restaurada.*2 com sobrecarga/);
});
