// src/solver/backendClient.js
// Adaptador de solver: conversa com o backend (FastAPI, docs/CONTRATO_API.md) e converte a resposta para o formato que a interface já
// usa em powerFlowResults ({ nodes, lines, summary }). Os módulos de cálculo locais (DC em JS, NR de distribuição) não dependem disto.

import { REPLAY, replayData, lookupEvaluate, lookupCorrective } from './replay.js';

export const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) || 'http://127.0.0.1:8000';

/** Topologia atual da interface no formato da API: ramos abertos (id) e barras em falta (número MATPOWER). */
export function topologyFromState(branches, faultNodes) {
    return {
        branchOut: branches.filter(b => b.state === 0).map(b => b.id),
        busOut: [...faultNodes].map(Number),
    };
}

/** Corpo do pedido: usa o nome do caso quando ele existe no backend; senão envia as tabelas MATPOWER (casos importados). */
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
    if (REPLAY) return lookupEvaluate(await replayData(), request);
    const r = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* sem corpo */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/** Pedido de resposta corretiva: falhas (linhas e barras) e opções. */
export function buildCorrectiveRequest(transmission, faults, options = {}) {
    const base = { faults, options };
    return transmission.gridName ? { ...base, grid: transmission.gridName } : { ...base, case: transmission.mpc };
}

export async function backendCorrective(request, signal, baseUrl = BACKEND_URL) {
    if (REPLAY) return lookupCorrective(await replayData(), request);
    const r = await fetch(`${baseUrl}/corrective`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
    });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* sem corpo */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/**
 * Converte um item de `results` do backend para o formato da interface.
 * @param {object} res    item de results (um por topologia)
 * @param {Array}  branches  ramos da interface (id, rateA, ...)
 */
export function toInterfaceResult(res, branches) {
    const nodes = {};
    (res.buses || []).forEach(b => { nodes[b.id] = { v: b.vm, angle: b.va, unit: 'MW' }; });

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
            current: Math.max(s, 0.002),                 // MVA (evita a cor de "desenergizado" com fluxo ~ 0)
            percentage: r.loading * 100,                 // % do limite térmico (rateA)
            pFlow: r.pf * 1000, qFlow: r.qf * 1000,      // kW / kVAr, como o resto da interface
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
