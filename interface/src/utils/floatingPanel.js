// src/utils/floatingPanel.js
// Pure functions and persistence for the floating windows (position, collapsed). No React dependency, so it can be tested in Node.

const KEY = (id) => `genco.panel.${id}`;
let zCounter = 1100;   // above the diagram legend (1000), below the banners and modals

/** Next z-index: the clicked window goes in front of the others. */
export const nextPanelZ = () => ++zCounter;

const viewport = () => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 800 });

/** Keeps the window title inside the screen (at least 80 px in view horizontally and the title bar vertically). */
export function clampPosition(pos, width, vp = viewport()) {
    const maxLeft = Math.max(0, vp.w - 80);
    const maxTop = Math.max(0, vp.h - 40);
    const minLeft = -(width - 80);
    return { left: Math.round(Math.min(maxLeft, Math.max(minLeft, pos.left))), top: Math.round(Math.min(maxTop, Math.max(0, pos.top))) };
}

/** Initial position: `{left, top}` or `{right, top}` (distance from the right edge of the browser window). */
export function resolveDefaultPosition(def, width, vp = viewport()) {
    if (def.right !== undefined) return { left: Math.max(8, vp.w - def.right - width), top: def.top };
    return { left: def.left, top: def.top };
}

export function loadPanelState(id) {
    try {
        const v = JSON.parse(localStorage.getItem(KEY(id)));
        return v && v.pos && Number.isFinite(v.pos.left) && Number.isFinite(v.pos.top) ? v : null;
    } catch { return null; }
}

/** Event that the open windows listen to in order to go back to the default layout. */
export const PANEL_RESET_EVENT = 'genco:reset-panels';

/** Restores the default layout of all windows: erases what was saved and notifies the open ones. */
export function resetAllPanels() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('genco.panel.')) keys.push(k); }
        keys.forEach(k => localStorage.removeItem(k));
    } catch { /* storage unavailable: only the open windows go back to the default */ }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(PANEL_RESET_EVENT));
}

export function savePanelState(id, state) {
    try { localStorage.setItem(KEY(id), JSON.stringify(state)); } catch { /* storage unavailable: carries on without remembering */ }
}
