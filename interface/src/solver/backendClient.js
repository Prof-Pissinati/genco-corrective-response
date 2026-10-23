// src/solver/backendClient.js
// Solver adapter: talks to the backend (FastAPI, docs/CONTRATO_API.md) and converts the response to the format the interface already
// uses in powerFlowResults ({ nodes, lines, summary }). The local calculation modules (DC in JS, distribution NR) do not depend on this.

import { REPLAY, replayData, lookupEvaluate, lookupCorrective } from './replay.js';

export const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) || 'http://127.0.0.1:8000';

/** Current topology of the interface in the API format: open branches (id) and faulted buses (MATPOWER number). */
export function topologyFromState(branches, faultNodes) {
    return {
        branchOut: branches.filter(b => b.state === 0).map(b => b.id),
        busOut: [...faultNodes].map(Number),
    };
}

/** Request body: uses the case name when it exists in the backend; otherwise sends the MATPOWER tables (imported cases). */
export function buildRequest(transmission, solver, topologies) {
    const base = { solver, topologies };
    return transmission.gridName ? { ...base, grid: transmission.gridName } : { ...base, case: transmission.mpc };
}

export async function backendHealth(signal, baseUrl = BACKEND_URL) {
    const r = await fetch(`${baseUrl}/health`, { signal });
    if (!r.ok) throw new Error(`backend respondeu ${r.status}`);
    return r.json();
}

export async function backendEvaluate(request, signal, baseUrl = BACKEND_URL) {
    if (REPLAY) return lookupEvaluate(await replayData(request.grid), request);
    const r = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* no body */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/** Corrective response request: faults (lines and buses) and options. */
export function buildCorrectiveRequest(transmission, faults, options = {}) {
    const base = { faults, options };
    return transmission.gridName ? { ...base, grid: transmission.gridName } : { ...base, case: transmission.mpc };
}

export async function backendCorrective(request, signal, baseUrl = BACKEND_URL) {
    if (REPLAY) return lookupCorrective(await replayData(request.grid), request);
    const r = await fetch(`${baseUrl}/corrective`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* no body */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/**
 * Converts an item of the backend `results` to the interface format.
 * @param {object} res    results item (one per topology)
 * @param {Array}  branches  interface branches (id, rateA, ...)
 */
export function toInterfaceResult(res, branches) {
    const nodes = {};
    (res.buses || []).forEach(b => { nodes[b.id] = { v: b.vm, angle: b.va, unit: 'MW' }; });
    // generation per bus (MW, MVAr) in the displayed state: the inspector and the generator tooltip show the stage's dispatch, not the base case's
    (res.gens || []).forEach(g => {
        const n = nodes[g.bus];
        if (n) { n.pg = (n.pg || 0) + g.pg; n.qg = (n.qg || 0) + (g.qg || 0); }
    });

    const byId = new Map((res.branches || []).map(b => [b.id, b]));
    const lines = {};
    branches.forEach(br => {
        const r = byId.get(br.id);
        if (!r) {
            lines[br.id] = { current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent: br.rateA || 0, unit: 'MW' };
            return;
        }
        const s = Math.max(Math.hypot(r.pf, r.qf), Math.hypot(r.pt, r.qt));
        lines[br.id] = {
            current: Math.max(s, 0.002),                 // MVA (avoids the "de-energized" color with flow ~ 0)
            percentage: r.loading * 100,                 // % of the thermal limit (rateA)
            pFlow: r.pf * 1000, qFlow: r.qf * 1000,      // kW / kVAr, like the rest of the interface
            limitCurrent: br.rateA || 0,
            unit: 'MW',
        };
    });

    const genMW = (res.gens || []).reduce((s, g) => s + g.pg, 0);
    return {
        nodes, lines,
        summary: {
            mode: res.solver === 'ac' ? 'AC' : 'DC', source: 'backend', servedMW: res.servedMW, lostMW: res.lostMW, genMW,
            energizedBuses: (res.energized || []).length, ms: res.ms, violations: res.violations || { overload: [], voltage: [], qgen: [] },
        },
    };
}
