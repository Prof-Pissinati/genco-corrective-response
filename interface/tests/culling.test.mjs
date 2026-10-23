// Visibility culling of the diagram: the area must be recomputed when the window changes size (buses used to vanish when the window grew).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cullingBounds, cullingNeedsUpdate, isCulled } from '../src/utils/culling.js';

const t = { x: -300, y: 20, scale: 1.125 };
const pequena = { w: 900, h: 650 }, grande = { w: 1340, h: 1206 };

test('visible area with a margin of 40% of the window', () => {
    const b = cullingBounds({ x: 0, y: 0, scale: 1 }, { w: 1000, h: 500 });
    assert.deepEqual(b, { minX: -400, minY: -200, maxX: 1400, maxY: 700 });
    assert.equal(isCulled({ x: 1400, y: 700 }, b), false);
    assert.equal(isCulled({ x: 1401, y: 100 }, b), true);
    assert.equal(isCulled({ x: -401, y: 100 }, b), true);
});

test('with no previous computation, recomputes', () => {
    assert.equal(cullingNeedsUpdate(null, t, pequena), true);
});

test('window size changed: recomputes (the bug was not recomputing, and the buses beyond the old area vanished)', () => {
    const last = { t, size: pequena };
    assert.equal(cullingNeedsUpdate(last, t, pequena), false, 'nada mudou');
    assert.equal(cullingNeedsUpdate(last, t, grande), true, 'larger window with the same camera');
    assert.equal(cullingNeedsUpdate(last, t, { w: 900, h: 651 }), true, 'basta 1 pixel');
    // with the area recomputed for the large window, the corner buses are drawn
    const velha = cullingBounds(t, pequena), nova = cullingBounds(t, grande);
    const canto = { x: (-t.x + grande.w * 0.95) / t.scale, y: (-t.y + grande.h * 0.95) / t.scale };      // perto do canto inferior direito da janela grande
    assert.equal(isCulled(canto, velha), true);
    assert.equal(isCulled(canto, nova), false);
});

test('dragging a little does not recompute; dragging more than 30% of the window or changing the zoom by more than 0.05 does', () => {
    const last = { t, size: pequena };
    assert.equal(cullingNeedsUpdate(last, { ...t, x: t.x - 100 }, pequena), false);
    assert.equal(cullingNeedsUpdate(last, { ...t, x: t.x - 400 }, pequena), true);
    assert.equal(cullingNeedsUpdate(last, { ...t, y: t.y + 300 }, pequena), true);
    assert.equal(cullingNeedsUpdate(last, { ...t, scale: t.scale + 0.04 }, pequena), false);
    assert.equal(cullingNeedsUpdate(last, { ...t, scale: t.scale + 0.06 }, pequena), true);
});
