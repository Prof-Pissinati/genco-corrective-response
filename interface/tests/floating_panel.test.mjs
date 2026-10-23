// Position and persistence of the floating windows (pure functions; no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPosition, resolveDefaultPosition, loadPanelState, savePanelState, nextPanelZ } from '../src/utils/floatingPanel.js';

const vp = { w: 1280, h: 720 };

test('clampPosition: the title never leaves the screen and the window does not vanish', () => {
    assert.deepEqual(clampPosition({ left: 100, top: 100 }, 340, vp), { left: 100, top: 100 });
    assert.deepEqual(clampPosition({ left: 5000, top: 5000 }, 340, vp), { left: 1200, top: 680 });
    assert.deepEqual(clampPosition({ left: -9999, top: -50 }, 340, vp), { left: -260, top: 0 });   // 80 px remain in view
});

test('initial position from the left or from the right', () => {
    assert.deepEqual(resolveDefaultPosition({ left: 340, top: 58 }, 400, vp), { left: 340, top: 58 });
    assert.deepEqual(resolveDefaultPosition({ right: 330, top: 58 }, 460, vp), { left: 490, top: 58 });
    assert.equal(resolveDefaultPosition({ right: 5000, top: 1 }, 460, vp).left, 8);                  // narrow window: does not go outside
});

test('persistence: saves, reads, and tolerates missing or corrupted storage', () => {
    const mem = {};
    globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    assert.equal(loadPanelState('a'), null);
    savePanelState('a', { pos: { left: 10, top: 20 }, collapsed: true });
    assert.deepEqual(loadPanelState('a'), { pos: { left: 10, top: 20 }, collapsed: true });
    mem['genco.panel.b'] = '{not json';
    assert.equal(loadPanelState('b'), null);
    mem['genco.panel.c'] = JSON.stringify({ pos: { left: 'x' } });
    assert.equal(loadPanelState('c'), null);
    globalThis.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
    assert.equal(loadPanelState('a'), null);
    assert.doesNotThrow(() => savePanelState('a', { pos: { left: 1, top: 1 } }));
    delete globalThis.localStorage;
});

test('z-index always increasing: the clicked window goes to the front', () => {
    const a = nextPanelZ(); const b = nextPanelZ();
    assert.ok(b > a);
});

test('restore layout: erases only the panel keys, notifies the open windows and tolerates blocked storage', async () => {
    const { resetAllPanels, PANEL_RESET_EVENT } = await import('../src/utils/floatingPanel.js');
    const mem = { 'genco.panel.corrective': '{}', 'genco.panel.screening': '{}', 'other.thing': 'stays' };
    globalThis.localStorage = {
        get length() { return Object.keys(mem).length; },
        key: (i) => Object.keys(mem)[i] ?? null,
        getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; },
    };
    const alvo = new EventTarget(); let avisos = 0;
    alvo.addEventListener(PANEL_RESET_EVENT, () => { avisos++; });
    globalThis.window = alvo;
    resetAllPanels();
    assert.deepEqual(Object.keys(mem), ['other.thing']);          // does not touch what does not belong to the panels
    assert.equal(avisos, 1);
    globalThis.localStorage = { get length() { throw new Error('bloqueado'); } };
    assert.doesNotThrow(() => resetAllPanels());                   // without storage: still notifies the open windows
    assert.equal(avisos, 2);
    delete globalThis.window; delete globalThis.localStorage;
});
