// src/utils/parallel.js
// Parallel lines (circuits between the same two buses): groups, letters A/B, shared bends and offset path for drawing.
// Pure functions (no React), tested in tests/parallel.test.mjs. IEEE 118 has 7 pairs: 42–49, 49–54, 49–66, 56–59, 77–80, 89–90 and 89–92.

export const CIRCUIT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const EPS = 1e-9;

const num = (v) => Number(v);
const sameJson = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const reversed = (list) => [...list].reverse().map(p => ({ x: p.x, y: p.y }));
const copy = (list) => list.map(p => ({ x: p.x, y: p.y }));

/**
 * Groups of parallel lines. Returns Map(branchId -> { key, index, size, letter, leaderId, reversed, members }) only for branches that have a sibling.
 * `index` follows the id order (the smallest is circuit A); `reversed` says whether the branch is written backwards relative to the leader (the one with the smallest id).
 */
export function parallelGroups(branches) {
    const byKey = new Map();
    (branches || []).forEach(b => {
        const a = num(b.from), c = num(b.to);
        const key = `${Math.min(a, c)}-${Math.max(a, c)}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(b);
    });
    const out = new Map();
    byKey.forEach((list, key) => {
        if (list.length < 2) return;
        const sorted = [...list].sort((x, y) => num(x.id) - num(y.id));
        const leader = sorted[0];
        const members = sorted.map((b, i) => ({
            id: b.id, index: i, size: sorted.length, letter: CIRCUIT_LETTERS[i] || String(i + 1), key, leaderId: leader.id,
            reversed: num(b.from) !== num(leader.from),
        }));
        members.forEach(m => out.set(m.id, { ...m, members }));
    });
    return out;
}

/** Line name to display: "49–54", or "49–54 A" / "49–54 B" when there are parallel circuits. */
export function branchName(branch, groups, sep = '–') {
    const g = groups && groups.get ? groups.get(branch.id) : null;
    return `${branch.from}${sep}${branch.to}${g ? ` ${g.letter}` : ''}`;
}

/** Shared bends (waypoints): all circuits of a group get the same list (in each one's orientation). */
export function shareWaypoints(waypoints, groups) {
    const next = { ...(waypoints || {}) };
    const done = new Set();
    groups.forEach(g => {
        if (done.has(g.key)) return;
        done.add(g.key);
        let canon = null;
        for (const m of g.members) {
            const l = next[m.id];
            if (Array.isArray(l) && l.length) { canon = m.reversed ? reversed(l) : copy(l); break; }
        }
        if (!canon) return;
        g.members.forEach(m => { next[m.id] = m.reversed ? reversed(canon) : copy(canon); });
    });
    return next;
}

/**
 * Propagates the edit of one circuit to its siblings: compares `prev` and `cur`; if a member changed, copies its list to the others.
 * Returns { next, changed }.
 */
export function syncParallelWaypoints(prev, cur, groups) {
    const next = { ...(cur || {}) };
    let changed = false;
    const done = new Set();
    groups.forEach(g => {
        if (done.has(g.key)) return;
        done.add(g.key);
        const src = g.members.find(m => !sameJson((prev || {})[m.id], (cur || {})[m.id]));
        if (!src) return;
        const canon = src.reversed ? reversed((cur || {})[src.id] || []) : copy((cur || {})[src.id] || []);
        g.members.forEach(m => {
            if (m.id === src.id) return;
            const target = m.reversed ? reversed(canon) : copy(canon);
            if (!sameJson(next[m.id], target)) { next[m.id] = target; changed = true; }
        });
    });
    return { next, changed };
}

function dedupe(points) {
    const out = [];
    points.forEach(p => {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push({ x: p.x, y: p.y });
    });
    return out;
}

/**
 * Offsets a polyline `d` units to the side (normal to the left of each segment, in the direction of the path).
 * At the corners it uses the intersection of the offset segments (miter); if the corner is too sharp (> miterLimit × |d|), it bevels.
 */
export function offsetPolyline(points, d, miterLimit = 3) {
    const pts = dedupe(points);
    if (pts.length < 2 || d === 0) return pts;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len;
        segs.push({ ux, uy, nx: -uy, ny: ux });
    }
    const out = [{ x: pts[0].x + segs[0].nx * d, y: pts[0].y + segs[0].ny * d }];
    for (let i = 1; i < pts.length - 1; i++) {
        const s0 = segs[i - 1], s1 = segs[i], V = pts[i];
        const A = { x: V.x + s0.nx * d, y: V.y + s0.ny * d };
        const B = { x: V.x + s1.nx * d, y: V.y + s1.ny * d };
        const cross = s0.ux * s1.uy - s0.uy * s1.ux;
        if (Math.abs(cross) < EPS) {
            if (s0.ux * s1.ux + s0.uy * s1.uy > 0) out.push(A);                  // same direction: goes straight
            else out.push(A, B);                                                 // 180° turn: bevel
            continue;
        }
        const t = ((B.x - A.x) * s1.uy - (B.y - A.y) * s1.ux) / cross;
        const M = { x: A.x + t * s0.ux, y: A.y + t * s0.uy };
        if (Math.hypot(M.x - V.x, M.y - V.y) > miterLimit * Math.abs(d)) out.push(A, B);
        else out.push(M);
    }
    const last = segs[segs.length - 1], L = pts[pts.length - 1];
    out.push({ x: L.x + last.nx * d, y: L.y + last.ny * d });
    return out;
}

/**
 * Drawn path of a line: p1 -> bends -> p2, offset to the side when the line has a parallel circuit.
 * `gapWorld` = distance between neighboring circuits in drawing units (on screen, use px / scale).
 * The side is the same for the same circuit, whatever the (from/to) orientation of the branch.
 */
export function effectivePath(branch, p1, p2, waypoints, group, gapWorld) {
    if (!p1 || !p2) return null;
    const bends = (Array.isArray(waypoints) ? waypoints : []).filter(w => w && Number.isFinite(w.x) && Number.isFinite(w.y));
    const base = [p1, ...bends, p2];
    if (!group || !(gapWorld > 0)) return base;
    const side = num(branch.from) > num(branch.to) ? -1 : 1;
    const d = (group.index - (group.size - 1) / 2) * gapWorld * side;
    return offsetPolyline(base, d);
}

// Size of the buses in the diagram, so the distance between circuits follows it (same ranges as GraphNode and CanvasOverlay):
// canvas (scale < 0.35): bus 28 units tall, proportional to the zoom; SVG: 10 px, growing to 22 px from scale 0.6.
export const CANVAS_BELOW_SCALE = 0.35;
export const PARALLEL_GAP_RATIO = 0.6;      // distance between circuits = 60% of the bus height

/** Bus height, in screen pixels, at the given zoom scale. */
export function nodeHeightPx(scale) {
    const s = scale > 0 ? scale : 1;
    if (s < CANVAS_BELOW_SCALE) return 28 * s;
    const t = Math.max(0, Math.min(1, (s - 0.6) / 0.6));
    return 10 + 12 * t;
}

/** Distance between parallel circuits, in screen pixels: varies with the bus size (smaller zoomed out, larger zoomed in). */
export function parallelGapPx(scale) {
    return PARALLEL_GAP_RATIO * nodeHeightPx(scale);
}

export function pointsToPath(pts) {
    if (!pts || pts.length < 2) return '';
    return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
}

function nearestOnSegment(p, a, b) {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    let t = l2 === 0 ? 0 : ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return { q, dist: Math.hypot(p.x - q.x, p.y - q.y) };
}

/** Distance from a point to the polyline. */
export function distToPolyline(p, pts) {
    if (!pts || pts.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, nearestOnSegment(p, pts[i], pts[i + 1]).dist);
    return best;
}

/** Point of the polyline closest to `p` (used to put a bend on the central path, not on the offset line). */
export function snapToPolyline(p, pts) {
    if (!pts || pts.length < 2) return { x: p.x, y: p.y };
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
        const r = nearestOnSegment(p, pts[i], pts[i + 1]);
        if (!best || r.dist < best.dist) best = r;
    }
    return best.q;
}
