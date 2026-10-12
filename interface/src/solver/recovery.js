// src/solver/recovery.js
// Reparo e religação da carga por blocos (endpoint /recovery): pedido, ordem dos reparos e funções puras para exibir a linha do tempo.
// A resposta traz `events` (plano inicial, reparos, ajustes e blocos religados), cada um com o estado AC completo da rede (`state`).
import { BACKEND_URL, toInterfaceResult } from './backendClient.js';
import { REPLAY, replayData, lookupRecovery } from './replay.js';

export const KIND_LABEL = { plan: 'Plano', repair: 'Reparo', cut: 'Ajuste', reconnect: 'Religação' };

/** Falhas atuais da interface como itens reparáveis: [{ type: 'line'|'bus', id, label }]. */
export function faultItems(branches, faultNodes) {
    const lines = branches.filter(b => b.state === 0).map(b => ({ type: 'line', id: b.id, label: `linha ${b.from}–${b.to}` }));
    const buses = [...faultNodes].map(Number).map(n => ({ type: 'bus', id: n, label: `barra ${n}` }));
    return [...lines, ...buses];
}

/** Move o item `i` da ordem de reparo uma posição (dir = -1 sobe, +1 desce). */
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
    if (REPLAY) return lookupRecovery(await replayData(), request);
    const r = await fetch(`${baseUrl}/recovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* sem corpo */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/** Estado do passo `i` no formato da interface ({ nodes, lines, summary }). */
export function eventResult(data, i, branches) {
    return toInterfaceResult(data.events[i].state, branches);
}

/** Cortes do passo: Map(número da barra -> { mw, pct }). */
export function eventShed(data, i) {
    return new Map((data.events[i].shed || []).map(s => [s.bus, { mw: s.mw, pct: s.pct }]));
}

/** Topologia restante (falhas ainda não reparadas) no passo `i`. */
export function eventRemaining(data, i) {
    return data.events[i].remaining;
}

/** Pontos do gráfico em degraus da carga não suprida: [{ t, mw, kind }] e os limites. */
export function unservedSeries(data) {
    const pts = data.events.map(e => ({ t: e.tHours, mw: e.unservedMW, kind: e.kind }));
    return { pts, tMax: Math.max(...pts.map(p => p.t), 1e-9), mwMax: Math.max(...pts.map(p => p.mw), 1e-9) };
}

/** Texto-resumo para o painel. */
export function recoverySummaryText(data) {
    const s = data.summary;
    const parts = [s.restored ? `Rede restaurada em ${s.totalHours.toFixed(2)} h` : `Não restaurada por completo (${s.finalUnservedMW.toFixed(0)} MW sem atender)`,
        `ENS ${s.ensMWh.toFixed(0)} MWh`, `${s.blocks} blocos religados`];
    if (s.blocksWithOverload > 0) parts.push(`${s.blocksWithOverload} com sobrecarga transitória`);
    return parts.join(' · ');
}
