// Design layouts of the four networks: they cover all buses, the bends point to existing lines and the line crossing count is the expected one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findIntersections } from '../src/utils/autoLayout.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url)));

// expected crossings in each design layout (IEEE 57 has 2: 9–13 × 10–12 and 11–13 × 10–51; if they are eliminated, change to 0)
const CRUZAMENTOS = { 14: 0, 30: 0, 57: 2, 118: 0 };

for (const n of [14, 30, 57, 118]) {
    test(`IEEE ${n}: the design layout covers all buses and the bends belong to lines that exist`, () => {
        const caso = load(`case${n}_ieee.json`), lay = load(`layout_case${n}_ieee.json`);
        assert.equal(lay.case, `case${n}_ieee`);
        assert.ok(caso.bus.every(b => lay.positions[String(b[0])] && Number.isFinite(lay.positions[String(b[0])].x) && Number.isFinite(lay.positions[String(b[0])].y)));
        assert.ok(Object.keys(lay.waypoints).every(k => +k >= 0 && +k < caso.branch.length));
        const pts = Object.values(lay.positions).map(p => `${p.x},${p.y}`);
        assert.equal(new Set(pts).size, pts.length, 'no bus on top of another');
    });

    test(`IEEE ${n}: line crossings of the design layout (with the bends): ${CRUZAMENTOS[n]}`, () => {
        const caso = load(`case${n}_ieee.json`), lay = load(`layout_case${n}_ieee.json`);
        const branches = caso.branch.map((b, i) => ({ id: i, from: b[0], to: b[1] }));
        const cruz = findIntersections(lay.positions, branches, lay.waypoints);
        assert.equal(cruz.length, CRUZAMENTOS[n], `${cruz.length} cruzamento(s): ${cruz.map(c => `${c.b1} × ${c.b2}`).join('; ')}`);
    });
}
