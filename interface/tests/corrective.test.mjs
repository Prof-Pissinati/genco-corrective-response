// Resposta corretiva na interface: conversão das três etapas, cortes por barra e resumos do painel (sem rede).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTransmissionSystem } from '../src/utils/transmission.js';
import { buildCorrectiveRequest } from '../src/solver/backendClient.js';
import { STAGES, stageResult, shedByBus, stageSummary, planDigest } from '../src/solver/corrective.js';

const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const data = JSON.parse(fs.readFileSync(new URL('./fixtures/corrective_linha7.json', import.meta.url)));
const sys = buildTransmissionSystem(caso, { gridName: 'case118_ieee' });

test('pedido: caso embutido pelo nome, falhas e opções', () => {
    const req = buildCorrectiveRequest(sys.transmission, { branchOut: [7], busOut: [] }, { maxIter: 5 });
    assert.equal(req.grid, 'case118_ieee');
    assert.deepEqual(req.faults, { branchOut: [7], busOut: [] });
    assert.equal(req.options.maxIter, 5);
});

test('as três etapas viram resultados no formato da interface, com a linha 7 sem fluxo pós-falta', () => {
    assert.deepEqual(STAGES.map(s => s.key), ['pre', 'postFault', 'after']);
    for (const { key } of STAGES) {
        const r = stageResult(data, key, sys.branches);
        assert.equal(Object.keys(r.lines).length, 186);
        assert.equal(Object.keys(r.nodes).length, 118);
    }
    assert.ok(stageResult(data, 'pre', sys.branches).lines[7].percentage > 0);        // antes: a linha 7 carrega
    assert.equal(stageResult(data, 'postFault', sys.branches).lines[7].percentage, 0); // depois da falha: fora de serviço
});

test('o plano elimina as sobrecargas e corta carga (linha 7)', () => {
    const pre = stageSummary(data, 'pre');
    const post = stageSummary(data, 'postFault');
    const after = stageSummary(data, 'after');
    assert.equal(pre.overloads, 0);
    assert.ok(post.overloads > 0, 'a falha causa sobrecarga mesmo após a resposta automática da geração');
    assert.equal(after.overloads, 0);
    assert.ok(after.maxLoadingPct <= 100.01);
    assert.ok(after.servedMW < pre.servedMW && after.servedPct < 1 && after.servedPct > 0.95);   // corte pequeno (~3,5%)
});

test('cortes por barra: somam o total do plano e ficam entre 0 e 100% da carga de cada barra', () => {
    const m = shedByBus(data);
    assert.ok(m.size > 0);
    let soma = 0;
    for (const [bus, { mw, pct }] of m) {
        soma += mw;
        assert.ok(pct > 0 && pct <= 1, `barra ${bus}: ${pct}`);
        assert.ok(Math.abs(mw - pct * caso.bus.find(r => r[0] === bus)[2]) < 0.01, `barra ${bus}: mw x pct`);
    }
    assert.ok(Math.abs(soma - data.plan.totalShedMW) < 0.01);
});

test('resumo do painel: maiores cortes e redespachos em ordem decrescente', () => {
    const d = planDigest(data, 3);
    assert.equal(d.needsAction, true);
    assert.ok(d.shedTotalMW > 0 && d.shedPctOfLoad > 0 && d.shedPctOfLoad < 0.1);
    assert.ok(d.topShed.length <= 3 && d.topShed.every((s, i, a) => i === 0 || a[i - 1].mw >= s.mw));
    assert.ok(d.topRedispatch.every((r, i, a) => i === 0 || Math.abs(a[i - 1].delta) >= Math.abs(r.delta)));
    assert.ok(d.redispatchCount > 0);
});
