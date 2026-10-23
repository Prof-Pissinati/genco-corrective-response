// src/solver/recovery.js
// Repair and block-by-block load reconnection (/recovery endpoint): request, repair order and pure functions to display the timeline.
// The response carries `events` (initial plan, repairs, adjustments and reconnected blocks), each with the complete AC state of the network (`state`).
import { BACKEND_URL, toInterfaceResult } from './backendClient.js';
import { REPLAY, replayData, lookupRecovery } from './replay.js';
import { parallelGroups, branchName } from '../utils/parallel.js';

export const KIND_LABEL = { plan: 'Plan', repair: 'Repair', cut: 'Adjustment', reconnect: 'Reconnection' };

/** Current faults of the interface as repairable items: [{ type: 'line'|'bus', id, label }]. */
export function faultItems(branches, faultNodes) {
    const groups = parallelGroups(branches);
    const lines = branches.filter(b => b.state === 0).map(b => ({ type: 'line', id: b.id, label: `line ${branchName(b, groups)}` }));
    const buses = [...faultNodes].map(Number).map(n => ({ type: 'bus', id: n, label: `bus ${n}` }));
    return [...lines, ...buses];
}

/** Moves item `i` of the repair order by one position (dir = -1 up, +1 down). */
export function moveItem(order, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return order;
    const out = [...order];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

export function buildRecoveryRequest(transmission, order, options = {}) {
    const faults = { branchOut: order.filter(x => x.type === 'line').map(x => x.id), busOut: order.filter(x => x.type === 'bus').map(x => x.id) };
    const base = { faults, repairOrder: order.map(({ type, id }) => ({ type, id })), options };
    return transmission.gridName ? { ...base, grid: transmission.gridName } : { ...base, case: transmission.mpc };
}

export async function backendRecovery(request, signal, baseUrl = BACKEND_URL) {
    if (REPLAY) return lookupRecovery(await replayData(request.grid), request);
    const r = await fetch(`${baseUrl}/recovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* no body */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/** State of step `i` in the interface format ({ nodes, lines, summary }). */
export function eventResult(data, i, branches) {
    return toInterfaceResult(data.events[i].state, branches);
}

/** Shedding of the step: Map(bus number -> { mw, pct }). */
export function eventShed(data, i) {
    return new Map((data.events[i].shed || []).map(s => [s.bus, { mw: s.mw, pct: s.pct }]));
}

/** Remaining topology (faults not yet repaired) at step `i`. */
export function eventRemaining(data, i) {
    return data.events[i].remaining;
}

/** Points of the step chart of the unserved load: [{ t, mw, kind }] and the limits. */
export function unservedSeries(data) {
    const pts = data.events.map(e => ({ t: e.tHours, mw: e.unservedMW, kind: e.kind }));
    return { pts, tMax: Math.max(...pts.map(p => p.t), 1e-9), mwMax: Math.max(...pts.map(p => p.mw), 1e-9) };
}

/** Summary text for the panel. */
export function recoverySummaryText(data) {
    const s = data.summary;
    const parts = [s.restored ? `Network restored in ${s.totalHours.toFixed(2)} h` : `Not fully restored (${s.finalUnservedMW.toFixed(0)} MW unserved)`,
        `ENS ${s.ensMWh.toFixed(0)} MWh`, `${s.blocks} blocks reconnected`];
    if (s.blocksWithOverload > 0) parts.push(`${s.blocksWithOverload} with transient overload`);
    return parts.join(' · ');
}
