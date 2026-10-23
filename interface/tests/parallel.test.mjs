// Parallel lines: groups, letters, shared bends and offset path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parallelGroups, branchName, shareWaypoints, syncParallelWaypoints, offsetPolyline, effectivePath, pointsToPath, distToPolyline, snapToPolyline, nodeHeightPx, parallelGapPx } from '../src/utils/parallel.js';

const P = (x, y) => ({ x, y });
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const caso = JSON.parse(fs.readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
const branches118 = caso.branch.map((b, i) => ({ id: i, from: b[0], to: b[1] }));

test('IEEE 118: 7 parallel pairs, circuit A = smallest index', () => {
    const g = parallelGroups(branches118);
    assert.equal(g.size, 14);
    const pares = new Set([...g.values()].map(m => m.key));
    assert.deepEqual([...pares].sort(), ['42-49', '49-54', '49-66', '56-59', '77-80', '89-90', '89-92']);
    assert.equal(g.get(74).letter, 'A'); assert.equal(g.get(75).letter, 'B');
    assert.equal(branchName(branches118[74], g), '49–54 A');
    assert.equal(branchName(branches118[75], g), '49–54 B');
    assert.equal(branchName(branches118[7], g), '8–5');                   // no parallel: no letter
});

test('more than two circuits: A, B, C; and a branch written backwards is recognized as the same pair', () => {
    const br = [{ id: 3, from: 1, to: 2 }, { id: 5, from: 2, to: 1 }, { id: 9, from: 1, to: 2 }, { id: 1, from: 7, to: 8 }];
    const g = parallelGroups(br);
    assert.deepEqual([3, 5, 9].map(id => g.get(id).letter), ['A', 'B', 'C']);
    assert.equal(g.get(5).reversed, true);
    assert.equal(g.get(3).reversed, false);
    assert.equal(g.has(1), false);
});

test('shared bends: the whole pair gets the same list (in the orientation of each branch)', () => {
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 2, to: 1 }];
    const g = parallelGroups(br);
    const w = shareWaypoints({ 1: [P(5, 0), P(9, 0)] }, g);                // only branch 1 (reversed) had bends
    assert.deepEqual(w[1], [P(5, 0), P(9, 0)]);
    assert.deepEqual(w[0], [P(9, 0), P(5, 0)]);                            // branch 0 receives them in its own orientation
    const w2 = shareWaypoints({ 0: [P(1, 1)] }, g);
    assert.deepEqual(w2[1], [P(1, 1)]);
    assert.deepEqual(shareWaypoints({}, g), {});                          // without bends, nothing changes
});

test('synchronization: editing one circuit is copied to its sibling, without a loop', () => {
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 1, to: 2 }, { id: 2, from: 5, to: 6 }];
    const g = parallelGroups(br);
    const prev = { 0: [P(1, 1)], 1: [P(1, 1)], 2: [P(9, 9)] };
    const cur = { 0: [P(1, 1), P(4, 4)], 1: [P(1, 1)], 2: [P(9, 9)] };     // the user added a bend to circuit 0
    const r = syncParallelWaypoints(prev, cur, g);
    assert.equal(r.changed, true);
    assert.deepEqual(r.next[1], [P(1, 1), P(4, 4)]);
    assert.deepEqual(r.next[2], [P(9, 9)]);                               // a line without a parallel is not touched
    const again = syncParallelWaypoints(r.next, r.next, g);
    assert.equal(again.changed, false);
    const erased = syncParallelWaypoints({ 0: [P(1, 1)], 1: [P(1, 1)] }, { 0: [], 1: [P(1, 1)] }, g);
    assert.deepEqual(erased.next[1], []);                                  // removing the bend also propagates
});

test('offset of a straight line: parallel to the original, at the requested distance', () => {
    const r = offsetPolyline([P(0, 0), P(100, 0)], 6);
    assert.ok(close(r[0].x, 0) && close(r[0].y, 6) && close(r[1].x, 100) && close(r[1].y, 6));
    const neg = offsetPolyline([P(0, 0), P(100, 0)], -6);
    assert.ok(close(neg[0].y, -6));
});

test('offset with a 90° corner: miter (intersection), with no cut or overshoot', () => {
    // path: (0,0) -> (100,0) -> (100,100); offset 10 to the left of the direction of travel
    const r = offsetPolyline([P(0, 0), P(100, 0), P(100, 100)], 10);
    assert.equal(r.length, 3);
    assert.ok(close(r[1].x, 90) && close(r[1].y, 10));                    // the inner corner goes up and inward
    const out = offsetPolyline([P(0, 0), P(100, 0), P(100, 100)], -10);
    assert.ok(close(out[1].x, 110) && close(out[1].y, -10));              // a externa se afasta
    // the offset segments remain parallel to the originals
    assert.ok(close(r[0].y, 10) && close(r[2].x, 90));
});

test('a very sharp corner becomes a bevel (no huge spike) and a repeated point is ignored', () => {
    const r = offsetPolyline([P(0, 0), P(100, 0), P(0, 4)], 6);            // turns back almost onto itself
    assert.equal(r.length, 4);
    assert.ok(r.every(p => Math.abs(p.x) < 200 && Math.abs(p.y) < 50));
    assert.equal(offsetPolyline([P(0, 0), P(0, 0), P(10, 0)], 5).length, 2);
});

test('effective path: the circuits of the pair stay a "gap" distance from each other, around the central path', () => {
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 1, to: 2 }];
    const g = parallelGroups(br);
    const a = effectivePath(br[0], P(0, 0), P(100, 0), [], g.get(0), 12);
    const b = effectivePath(br[1], P(0, 0), P(100, 0), [], g.get(1), 12);
    assert.ok(close(Math.abs(a[0].y - b[0].y), 12));
    assert.ok(close(a[0].y + b[0].y, 0));                                  // symmetric about the center
    assert.ok(close(a[0].x, 0) && close(a[1].x, 100));
    const plain = effectivePath({ id: 9, from: 3, to: 4 }, P(0, 0), P(100, 0), [], undefined, 12);
    assert.deepEqual(plain, [P(0, 0), P(100, 0)]);                           // no parallel: central path, not offset
});

test('bends serve both circuits: both go around the same path, side by side, with mitered corners', () => {
    const br = [{ id: 0, from: 1, to: 2 }, { id: 1, from: 1, to: 2 }];
    const g = parallelGroups(br);
    const bends = [P(0, 100), P(100, 100)];                                // desce, atravessa e sobe: caminho em "U"
    const a = effectivePath(br[0], P(0, 0), P(100, 0), bends, g.get(0), 12);
    const b = effectivePath(br[1], P(0, 0), P(100, 0), bends, g.get(1), 12);
    assert.equal(a.length, 4); assert.equal(b.length, 4);
    for (let i = 0; i < 3; i++) {                                           // in the middle of each stretch of B, the distance to A's path is the requested one (they are true parallels)
        const mid = P((b[i].x + b[i + 1].x) / 2, (b[i].y + b[i + 1].y) / 2);
        assert.ok(close(distToPolyline(mid, a), 12), `trecho ${i}`);
    }
    assert.ok(close(a[0].y, 0) && close(b[0].y, 0));                       // the ends stay at the bus height, side by side
});

test('the same circuit stays on the same side even if the branch is written backwards', () => {
    const direct = { id: 0, from: 1, to: 2 }, reversed = { id: 1, from: 2, to: 1 };
    const g = parallelGroups([direct, reversed]);
    const a = effectivePath(direct, P(0, 0), P(100, 0), [], g.get(0), 12);          // A: 1 -> 2
    const b = effectivePath(reversed, P(100, 0), P(0, 0), [], g.get(1), 12);       // B: 2 -> 1 (traversed backwards)
    assert.ok(a[0].y * b[0].y < 0, 'A and B stay on opposite sides');
    assert.ok(close(Math.abs(a[0].y - b[0].y), 12));
});

test('IEEE 118: no parallel circuit overlaps another (minimum distance = gap)', () => {
    const g = parallelGroups(branches118);
    const pos = { 49: P(300, 100), 54: P(100, 100) };
    const A = effectivePath(branches118[74], pos[49], pos[54], [], g.get(74), 10);
    const B = effectivePath(branches118[75], pos[49], pos[54], [], g.get(75), 10);
    assert.ok(close(distToPolyline(A[0], B), 10));
});

test('mouse radar and bend: distance to the polyline and nearest point on the central path', () => {
    const path = [P(0, 0), P(100, 0), P(100, 100)];
    assert.ok(close(distToPolyline(P(50, 7), path), 7));
    assert.ok(close(distToPolyline(P(107, 50), path), 7));                // follows the vertical stretch (which the old straight line ignored)
    assert.deepEqual(snapToPolyline(P(50, 7), path), P(50, 0));
    assert.equal(pointsToPath(path), 'M 0 0 L 100 0 L 100 100');
    assert.equal(pointsToPath([P(1, 1)]), '');
});

test('distance between circuits follows the bus size: shrinks zoomed out and grows zoomed in, without jumps', () => {
    assert.ok(close(nodeHeightPx(0.2), 5.6));                                              // canvas: proporcional ao zoom (28 unidades de altura)
    assert.ok(Math.abs(nodeHeightPx(0.35) - 10) < 0.3);                                    // e emenda com os 10 px do SVG
    assert.ok(close(nodeHeightPx(0.5), 10) && close(nodeHeightPx(0.6), 10));
    assert.ok(close(nodeHeightPx(1.2), 22) && close(nodeHeightPx(5), 22));                 // maximum height
    assert.ok(close(parallelGapPx(1.2), 13.2) && close(parallelGapPx(0.5), 6));
    assert.ok(parallelGapPx(0.1) < parallelGapPx(0.2) && parallelGapPx(0.2) < parallelGapPx(0.35));   // no canvas, proporcional ao zoom
    assert.ok(parallelGapPx(0.5) < parallelGapPx(0.9) && parallelGapPx(0.9) < parallelGapPx(1.2));    // in the SVG, grows with the bus
    assert.ok(Math.abs(parallelGapPx(0.3499) - parallelGapPx(0.3501)) < 0.2, 'no jump when switching canvas/SVG');
    assert.ok(parallelGapPx(0.2) > 0 && parallelGapPx(0) > 0);                              // an invalid scale neither zeroes nor breaks
});

