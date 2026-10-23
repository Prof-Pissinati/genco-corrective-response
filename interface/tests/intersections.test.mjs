// Detector de cruzamentos com pontos de dobra (waypoints) e layout de projeto do IEEE 118.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findIntersections, branchSegments } from '../src/utils/autoLayout.js';
import { buildTransmissionSystem } from '../src/utils/transmission.js';

const P = (x, y) => ({ x, y });

test('branch path: bus -> bends -> bus, with the endpoints identified', () => {
    const pos = { 1: P(0, 0), 2: P(100, 100) };
    const segs = branchSegments({ id: 7, from: 1, to: 2 }, pos, { 7: [P(100, 0)] });
    assert.equal(segs.length, 2);
    assert.deepEqual([segs[0].from, segs[0].to, segs[1].from, segs[1].to], ['1', null, null, '2']);
    assert.equal(branchSegments({ id: 7, from: 1, to: 9 }, pos), null);                  // bus without a position
    assert.equal(branchSegments({ id: 7, from: 1, to: 2 }, pos, { 7: [{ x: NaN, y: 1 }, null] }).length, 1);   // invalid bends are ignored
});

test('a straight line over buses is a run-over; going around with bends, it stops being one (the image case: 25 -> 23 with 115 and 114 in between)', () => {
    const pos = { 25: P(0, 0), 115: P(0, 100), 114: P(0, 200), 23: P(0, 300) };
    const br = [{ id: 0, from: 25, to: 23 }];
    const reta = findIntersections(pos, br);
    assert.deepEqual(reta.map(x => x.b2).sort(), ['Bus 114', 'Bus 115']);
    const bends = { 0: [P(150, 0), P(150, 300)] };                                       // goes out to the right, down and back
    assert.equal(findIntersections(pos, br, bends).length, 0);
});

test('an X crossing changes when one of the lines is diverted by bends', () => {
    const pos = { 1: P(0, 0), 2: P(100, 100), 3: P(0, 100), 4: P(100, 0) };
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 3, to: 4 }];
    assert.equal(findIntersections(pos, br).length, 1);                                    // as diagonais se cortam
    const desvia = { 0: [P(-50, 0), P(-50, 150), P(100, 150)] };                           // 1-2 goes around the outside (left and below)
    assert.equal(findIntersections(pos, br, desvia).length, 0);
});

test('bends can create a new crossing that the straight segment did not have', () => {
    const pos = { 1: P(0, 0), 2: P(100, 0), 3: P(50, 50), 4: P(50, 100) };
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 3, to: 4 }];
    assert.equal(findIntersections(pos, br).length, 0);                                    // retas: a 1-2 corre por cima, longe da 3-4
    const desce = { 0: [P(60, 90)] };                                                      // com a dobra, a 1-2 desce e corta a 3-4
    const r = findIntersections(pos, br, desce);
    assert.equal(r.length, 1);
    assert.ok(Math.abs(r[0].x - 50) < 1e-6 && Math.abs(r[0].y - 75) < 1e-6);
});

test('lines that share a bus only cross away from it (with bends)', () => {
    const pos = { 1: P(0, 0), 2: P(100, 0), 3: P(0, 100) };
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 1, to: 3 }];
    assert.equal(findIntersections(pos, br).length, 0);                                    // they only meet at bus 1
    const volta = { 1: [P(50, -50), P(50, 100)] };                                         // a 1-3 sobe e desce cortando a 1-2 no meio do caminho
    assert.equal(findIntersections(pos, br, volta).length, 1);
});

test('without the bends argument the old behavior (straight lines) is kept', () => {
    const pos = { 1: P(0, 0), 2: P(100, 100), 3: P(0, 100), 4: P(100, 0) };
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 3, to: 4 }];
    assert.equal(findIntersections(pos, br).length, findIntersections(pos, br, {}).length);
});

// ---- layout de projeto do IEEE 118 ----
const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const layout = JSON.parse(fs.readFileSync(new URL('../src/data/layout_case118_ieee.json', import.meta.url)));

test('design layout: all 118 buses have a position and the bend points point to existing branches', () => {
    const buses = caso.bus.map(b => String(b[0]));
    assert.deepEqual(Object.keys(layout.positions).sort(), [...buses].sort());
    assert.ok(Object.values(layout.positions).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    for (const [id, pts] of Object.entries(layout.waypoints)) {
        assert.ok(Number(id) >= 0 && Number(id) < caso.branch.length, `branch ${id}`);
        assert.ok(pts.length > 0 && pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
    assert.ok(Object.keys(layout.waypoints).length > 0);
});

test('the transmission system loads the design layout (positions and bends) instead of the automatic one', () => {
    const sys = buildTransmissionSystem(caso, { layout: layout.positions, waypoints: layout.waypoints, gridName: 'case118_ieee' });
    assert.equal(Object.keys(sys.positionsProject).length, 118);
    assert.deepEqual(sys.positionsProject['1'], layout.positions['1']);
    assert.deepEqual(sys.waypointsProject, layout.waypoints);
    assert.notEqual(sys.waypointsProject, layout.waypoints);                               // copy: editing on screen does not change the file
    const antigo = buildTransmissionSystem(caso, { layout: { 1: [10, 20] } });             // formato antigo [x,y] segue valendo
    assert.deepEqual(antigo.positionsProject['1'], { x: 10, y: 20 });
    assert.deepEqual(antigo.waypointsProject, {});
});

test('in the real layout: considering the bends never increases the reported crossings relative to the old straight path', () => {
    const br = caso.branch.map((b, i) => ({ id: i, from: b[0], to: b[1] }));
    const reto = findIntersections(layout.positions, br).length;
    const real = findIntersections(layout.positions, br, layout.waypoints).length;
    console.log(`    crossings in the design layout: straight path = ${reto}, with the bends = ${real}`);
    assert.ok(real <= reto);
});
