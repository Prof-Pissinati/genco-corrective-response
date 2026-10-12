// src/solver/replay.js
// Modo REPLAY (versão estática para o júri, sem backend): as respostas de /evaluate, /corrective, /screen e /recovery vêm de um arquivo
// pré-calculado (backend/tools/export_replay.py). Ativado no build com `npm run build:replay` (VITE_REPLAY=1). Sem imports: não há ciclo.

export const REPLAY = typeof import.meta !== 'undefined' && !!import.meta.env && import.meta.env.VITE_REPLAY === '1';

let cache = null;
/** Carrega o arquivo de replay (import dinâmico: só entra no build de replay). */
export async function replayData() {
    if (!cache) cache = (await import('../data/replay_case118_ieee.json')).default;
    return cache;
}

const ids = (a) => [...(a || [])].map(Number).sort((x, y) => x - y).join(',');
/** Chave de uma combinação de falhas (igual à do export_replay.py). */
export const faultKey = (faults) => `c:${ids(faults?.branchOut)}|${ids(faults?.busOut)}`;
/** Chave de uma ordem de reparos: [{type:'line'|'bus', id}] (a ordem importa). */
export const recoveryKey = (order) => `r:${(order || []).map(o => `${o.type}${o.id}`).join(',')}`;

const MSG = 'Replay: só há resultados pré-calculados. Escolha uma contingência marcada com ● na varredura N-1, ou rode o backend (README).';

function check(data, request) {
    if (request.grid && request.grid !== data.case) throw new Error(`Modo replay: só o caso ${data.case} está disponível.`);
    if (!request.grid) throw new Error('Modo replay: casos importados exigem o backend.');
}

export function lookupEvaluate(data, request) {
    check(data, request);
    const topos = request.topologies || [];
    if (topos.some(t => (t.branchOut || []).length || (t.busOut || []).length)) throw new Error('Modo replay: o AC só está disponível para a rede sem falhas.');
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
    return { grid: data.case, faults: request.faults, ...e };       // `faults` vem do pedido (o endpoint real o devolve)
}
