// Esquema de cores da transmissão (decisão: carregamento > tensão; escala que não depende de verde x vermelho).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadingColor, loadingWidth, voltageColor } from '../src/hooks/useColorIntelligence.js';

const rgb = (s) => s.match(/\d+/g).map(Number);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('carregamento: extremos e pontos de referência', () => {
    assert.deepEqual(rgb(loadingColor(0)), [74, 120, 194]);            // folgado: azul
    assert.deepEqual(rgb(loadingColor(82)), [255, 210, 63]);           // atenção: amarelo
    assert.deepEqual(rgb(loadingColor(100)), [213, 0, 0]);             // limite: vermelho
    assert.deepEqual(rgb(loadingColor(250)), [213, 0, 0]);             // acima de 100% satura
    assert.deepEqual(rgb(loadingColor(-5)), rgb(loadingColor(0)));
    assert.deepEqual(rgb(loadingColor(undefined)), rgb(loadingColor(0)));
});

test('carregamento: nunca usa verde (a escala não depende de distinguir verde de vermelho)', () => {
    for (let p = 0; p <= 100; p += 1) {
        const [r, g, b] = rgb(loadingColor(p));
        assert.ok(!(g > r + 40 && g > b + 40), `${p}%: ${r},${g},${b} é esverdeado`);
    }
});

test('carregamento: a largura da linha cresce com a carga (redundância para daltônicos)', () => {
    assert.equal(loadingWidth(0), 2.5);
    assert.equal(loadingWidth(60), 2.5);
    assert.equal(loadingWidth(100), 6);
    assert.equal(loadingWidth(300), 6);
    let anterior = 0;
    for (let p = 0; p <= 120; p += 5) { assert.ok(loadingWidth(p) >= anterior); anterior = loadingWidth(p); }
});

test('carregamento: de 82% a 100% a luminosidade cai (laranja/vermelho distinguível do amarelo mesmo sem cor)', () => {
    assert.ok(lum(rgb(loadingColor(82))) > lum(rgb(loadingColor(95))));
    assert.ok(lum(rgb(loadingColor(95))) > lum(rgb(loadingColor(100))));
});

test('tensão: claro em 1,0 pu, azul abaixo e vermelho acima, saturando nos limites do caso', () => {
    assert.deepEqual(rgb(voltageColor(1.0, 0.94, 1.06, true)), [236, 236, 236]);
    assert.deepEqual(rgb(voltageColor(0.94, 0.94, 1.06, true)), [33, 102, 172]);
    assert.deepEqual(rgb(voltageColor(1.06, 0.94, 1.06, true)), [178, 24, 43]);
    assert.deepEqual(rgb(voltageColor(0.90, 0.94, 1.06, true)), [33, 102, 172]);   // fora do limite satura
    const meio = rgb(voltageColor(1.03, 0.94, 1.06, true));
    assert.ok(meio[0] > 178 && meio[0] < 236 && meio[2] < 236);                      // entre o claro e o vermelho
});
