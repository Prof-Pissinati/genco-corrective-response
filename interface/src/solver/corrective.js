// src/solver/corrective.js
// Funções puras para exibir a resposta corretiva (resposta do endpoint /corrective do backend) na interface.
// A resposta traz três estados completos da rede: `pre` (antes das falhas), `postFault` (após as falhas, com a geração redistribuída
// automaticamente) e `after` (após o plano: redespacho + corte mínimo de carga), mais o `plan` e um `summary`.
import { toInterfaceResult } from './backendClient.js';

export const STAGES = [
    { key: 'pre', label: 'Pré-falta' },
    { key: 'postFault', label: 'Pós-falta' },
    { key: 'after', label: 'Com plano' },
];

/** Estado de uma etapa no formato da interface ({ nodes, lines, summary }). */
export function stageResult(data, key, branches) {
    return toInterfaceResult(data[key], branches);
}

/** Cortes de carga do plano: Map(número da barra -> { mw, pct }). */
export function shedByBus(data) {
    return new Map((data.plan?.shed || []).map(s => [s.bus, { mw: s.mw, pct: s.pct }]));
}

/** Números de cada etapa para o painel (sobrecargas, violações, carga atendida, maior carregamento). */
export function stageSummary(data, key) {
    const ev = data[key];
    const total = data.summary.loadTotalMW;
    const served = key === 'after' ? data.summary.servedMW : ev.servedMW;
    const loadings = (ev.branches || []).map(b => b.loading);
    return {
        converged: ev.converged,
        overloads: ev.violations.overload.length,
        voltage: ev.violations.voltage.length,
        pgen: (ev.violations.pgen || []).length,
        servedMW: served,
        servedPct: total > 0 ? served / total : 0,
        maxLoadingPct: loadings.length ? Math.max(...loadings) * 100 : 0,
    };
}

/** Resumo do plano para texto: redespacho (maiores mudanças) e corte (maiores cortes). */
export function planDigest(data, top = 6) {
    const redispatch = [...(data.plan?.redispatch || [])]
        .map(r => ({ ...r, delta: r.pgAfter - r.pgBefore }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const shed = [...(data.plan?.shed || [])].sort((a, b) => b.mw - a.mw);
    return {
        needsAction: !!data.needsAction,
        shedTotalMW: data.plan?.totalShedMW || 0,
        shedPctOfLoad: data.summary.loadTotalMW > 0 ? (data.plan?.totalShedMW || 0) / data.summary.loadTotalMW : 0,
        redispatchTotalMW: data.plan?.totalRedispatchMW || 0,
        redispatchCount: redispatch.length,
        topRedispatch: redispatch.slice(0, top),
        topShed: shed.slice(0, top),
        shedCount: shed.length,
    };
}
