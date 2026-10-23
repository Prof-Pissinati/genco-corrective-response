// src/utils/culling.js
// Visibility culling of the diagram: only buses inside the window plus a margin are drawn. To avoid recomputing on every movement,
// the area is only recomputed when the camera leaves a tolerance zone. RULE: it must also be recomputed when the window SIZE changes
// (otherwise, when the window grows, the buses beyond the old area disappear and the lines end in the void).

export const CULL_TOLERANCE = 0.3;   // fraction of the window that can be dragged without recomputing
export const CULL_MARGIN = 0.4;      // margin beyond the window (fraction of the window)

/** Visible area, in diagram units, with margin. `t` = { x, y, scale }, `size` = { w, h } in pixels. */
export function cullingBounds(t, size, margin = CULL_MARGIN) {
    const mx = (size.w / t.scale) * margin, my = (size.h / t.scale) * margin;
    return { minX: (-t.x) / t.scale - mx, minY: (-t.y) / t.scale - my, maxX: (-t.x + size.w) / t.scale + mx, maxY: (-t.y + size.h) / t.scale + my };
}

/**
 * Does the area need recomputing? `last` = { t, size } of the last computation (or null if there was none yet).
 * Yes when: there is no previous computation; the window size changed; the zoom changed by more than 0.05; or it was dragged beyond the tolerance.
 */
export function cullingNeedsUpdate(last, t, size, tolerance = CULL_TOLERANCE) {
    if (!last) return true;
    if (last.size.w !== size.w || last.size.h !== size.h) return true;
    if (Math.abs(t.scale - last.t.scale) > 0.05) return true;
    const dx = Math.abs((t.x - last.t.x) / t.scale), dy = Math.abs((t.y - last.t.y) / t.scale);
    return dx > (size.w / t.scale) * tolerance || dy > (size.h / t.scale) * tolerance;
}

/** Is a point outside the area? */
export function isCulled(p, b) {
    return p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY;
}
