// Transmission color scheme (decision: loading > voltage; scale that does not depend on green vs red).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadingColor, loadingWidth, voltageColor } from '../src/hooks/useColorIntelligence.js';

const rgb = (s) => s.match(/\d+/g).map(Number);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('loading: extremes and reference points', () => {
    assert.deepEqual(rgb(loadingColor(0)), [74, 120, 194]);            // folgado: azul
    assert.deepEqual(rgb(loadingColor(82)), [255, 210, 63]);           // attention: yellow
    assert.deepEqual(rgb(loadingColor(100)), [230, 81, 0]);             // at the limit: deep orange (red is only for an overload)
    assert.deepEqual(rgb(loadingColor(250)), [230, 81, 0]);             // above 100% it saturates (the overload red is applied by getEdgeColor)
    assert.deepEqual(rgb(loadingColor(-5)), rgb(loadingColor(0)));
    assert.deepEqual(rgb(loadingColor(undefined)), rgb(loadingColor(0)));
});

test('loading: never uses green (the scale does not depend on telling green from red)', () => {
    for (let p = 0; p <= 100; p += 1) {
        const [r, g, b] = rgb(loadingColor(p));
        assert.ok(!(g > r + 40 && g > b + 40), `${p}%: ${r},${g},${b} is greenish`);
    }
});

test('loading: the line width grows with the load (redundancy for color-blind users)', () => {
    assert.equal(loadingWidth(0), 2.5);
    assert.equal(loadingWidth(60), 2.5);
    assert.equal(loadingWidth(100), 6);
    assert.equal(loadingWidth(300), 6);
    let anterior = 0;
    for (let p = 0; p <= 120; p += 5) { assert.ok(loadingWidth(p) >= anterior); anterior = loadingWidth(p); }
});

test('loading: from 82% to 100% the luminosity drops (orange/red distinguishable from yellow even without color)', () => {
    assert.ok(lum(rgb(loadingColor(82))) > lum(rgb(loadingColor(95))));
    assert.ok(lum(rgb(loadingColor(95))) > lum(rgb(loadingColor(100))));
});

test('voltage: light at 1.0 pu, blue below and red above, saturating at the case limits', () => {
    assert.deepEqual(rgb(voltageColor(1.0, 0.94, 1.06, true)), [236, 236, 236]);
    assert.deepEqual(rgb(voltageColor(0.94, 0.94, 1.06, true)), [33, 102, 172]);
    assert.deepEqual(rgb(voltageColor(1.06, 0.94, 1.06, true)), [178, 24, 43]);
    assert.deepEqual(rgb(voltageColor(0.90, 0.94, 1.06, true)), [33, 102, 172]);   // beyond the limit it saturates
    const meio = rgb(voltageColor(1.03, 0.94, 1.06, true));
    assert.ok(meio[0] > 178 && meio[0] < 236 && meio[2] < 236);                      // between the light and the red
});
