// src/solver/replay.js
// REPLAY mode (static version for the jury, no backend): the /evaluate, /corrective, /screen and /recovery responses come from a file
// precomputed (backend/tools/export_replay.py). Enabled in the build with `npm run build:replay` (VITE_REPLAY=1). No imports: there is no cycle.

export const REPLAY = typeof import.meta !== 'undefined' && !!import.meta.env && import.meta.env.VITE_REPLAY === '1';

const cache = new Map();
/** Loads the replay file of network `grid` (e.g. 'case118_ieee'; dynamic import: only enters the replay build). */
export async function replayData(grid) {
    if (!grid) throw new Error('Replay mode: imported cases require the backend.');
    if (!cache.has(grid)) {
        let mod;
        try { mod = await import(`../data/replay_${grid}.json`); } catch { throw new Error(`Replay mode: there are no precomputed results for ${grid}.`); }
        cache.set(grid, mod.default);
    }
    return cache.get(grid);
}

const ids = (a) => [...(a || [])].map(Number).sort((x, y) => x - y).join(',');
/** Key of a combination of faults (same as in export_replay.py). */
export const faultKey = (faults) => `c:${ids(faults?.branchOut)}|${ids(faults?.busOut)}`;
/** Key of a repair order: [{type:'line'|'bus', id}] (order matters). */
export const recoveryKey = (order) => `r:${(order || []).map(o => `${o.type}${o.id}`).join(',')}`;

const MSG = 'Replay: only precomputed results are available. Pick a contingency marked with ● in the N-1 screening, or run the backend (README).';

function check(data, request) {
    if (request.grid && request.grid !== data.case) throw new Error(`Replay mode: only case ${data.case} is available.`);
    if (!request.grid) throw new Error('Replay mode: imported cases require the backend.');
}

export function lookupEvaluate(data, request) {
    check(data, request);
    const topos = request.topologies || [];
    if (topos.some(t => (t.branchOut || []).length || (t.busOut || []).length)) throw new Error('Replay mode: the AC is only available for the network without faults.');
    return { grid: data.case, results: topos.map(() => data.base) };
}

export function lookupCorrective(data, request) {
    check(data, request);
    const e = data.corrective[faultKey(request.faults)];
    if (!e) throw new Error(MSG);
    return { grid: data.case, ...e, pre: data.base };
}

export function lookupScreen(data, request) {
    check(data, request);
    return data.screen;
}

export function lookupRecovery(data, request) {
    check(data, request);
    const e = data.recovery[recoveryKey(request.repairOrder)];
    if (!e) throw new Error(MSG);
    return { grid: data.case, faults: request.faults, ...e };       // `faults` comes from the request (the real endpoint returns it)
}
