// src/solver/screening.js
// Varredura N-1 ("mapa de risco"): pedido ao backend (/screen), filtros e o resumo da validação do GENCO (arquivo estático gerado por
// backend/tools/genco_screening.py). Funções puras, testadas sem rede.
import { BACKEND_URL } from './backendClient.js';
import { REPLAY, replayData, lookupScreen } from './replay.js';

export function buildScreenRequest(transmission, scope = 'both') {
    const base = { scope };
    return transmission.gridName ? { ...base, grid: transmission.gridName } : { ...base, case: transmission.mpc };
}

export async function backendScreen(request, signal, baseUrl = BACKEND_URL) {
    if (REPLAY) return lookupScreen(await replayData(), request);
    const r = await fetch(`${baseUrl}/screen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json()).detail; } catch { /* sem corpo */ }
        throw new Error(`backend ${r.status}${detail ? `: ${detail}` : ''}`);
    }
    return r.json();
}

/** Linhas da varredura filtradas: `onlyAction` (só as que exigem plano), `kind` ('all' | 'line' | 'bus') e `onlyReady` (no replay, só as com plano pré-calculado: `hasPlan`). */
export function filterRows(data, { onlyAction = true, kind = 'all', onlyReady = false } = {}) {
    return (data?.contingencies || []).filter(c => (!onlyAction || c.needsAction) && (kind === 'all' || c.type === kind) && !(onlyReady && c.hasPlan === false));
}

/** Índice da validação do GENCO por linha: Map(id do ramo -> { ac, dc, genco, from, to }). */
export function gencoIndex(staticData) {
    return new Map((staticData?.lines || []).map(l => [l.id, l]));
}

/** Números do resumo do GENCO (validação em saídas de linha), prontos para exibir. */
export function gencoSummary(staticData) {
    if (!staticData) return null;
    const m = staticData.scenarioLevel;
    const l = staticData.lineLevel;
    const pct = (x) => Math.round(x * 100);
    return {
        scenarios: staticData.scenarios,
        model: staticData.model,
        maeGenco: staticData.loadingMAE_pct.genco, maeDc: staticData.loadingMAE_pct.dc,
        recall90: { genco: pct(l.genco['0.9'].recall), dc: pct(l.dc['0.9'].recall) },
        recall100: { genco: pct(l.genco['1.0'].recall), dc: pct(l.dc['1.0'].recall) },
        scenarioRecall: { genco: pct(m.genco['0'].recall), dc: pct(m.dc['0'].recall) },
        scenarioFlaggedWith5pt: m.genco['5'].flagged,
        ms: staticData.msPerScenario,
        skipped: (staticData.skipped || []).length,
    };
}
