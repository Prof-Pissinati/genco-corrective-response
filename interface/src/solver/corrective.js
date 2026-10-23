// src/solver/corrective.js
// Pure functions to display the corrective response (response of the backend /corrective endpoint) in the interface.
// The response carries three complete network states: `pre` (before the faults), `postFault` (after the faults, with the generation redistributed
// automatically) and `after` (after the plan: redispatch + minimum load shedding), plus the `plan` and a `summary`.
import { toInterfaceResult } from './backendClient.js';
import { parallelGroups, branchName } from '../utils/parallel.js';

export const STAGES = [
    { key: 'pre', label: 'Pre-fault' },
    { key: 'postFault', label: 'Post-fault' },
    { key: 'after', label: 'With plan' },
];

/** State of a stage in the interface format ({ nodes, lines, summary }). */
export function stageResult(data, key, branches) {
    return toInterfaceResult(data[key], branches);
}

/** Load shedding of the plan: Map(bus number -> { mw, pct }). */
export function shedByBus(data) {
    return new Map((data.plan?.shed || []).map(s => [s.bus, { mw: s.mw, pct: s.pct }]));
}

/** Text of the analysis faults: "line 108–109" / "bus 68" (uses the interface branches for the bus numbers). */
export function faultsText(data, branches) {
    const f = data?.faults || { branchOut: [], busOut: [] };
    const byId = new Map(branches.map(b => [b.id, b]));
    const groups = parallelGroups(branches);
    const parts = [
        ...f.branchOut.map(id => { const b = byId.get(id); return b ? `line ${branchName(b, groups)}` : `line ${id}`; }),
        ...f.busOut.map(n => `bus ${n}`),
    ];
    return parts.join(' + ');
}

/** Buses with a generator whose dispatch changes in the plan (|ΔPg| > 0.05 MW): Set of bus numbers. */
export function redispatchBuses(data) {
    const byBus = new Map();
    (data?.plan?.redispatch || []).forEach(r => byBus.set(r.bus, (byBus.get(r.bus) || 0) + (r.pgAfter - r.pgBefore)));
    return new Set([...byBus].filter(([, d]) => Math.abs(d) > 0.05).map(([bus]) => bus));
}

/**
 * What the plan achieved, for the verdict and the caption:
 *   'none'     no action needed (the automatic generation response is enough);
 *   'solved'   the plan eliminates the overloads and the AC confirms;
 *   'partial'  best-effort plan: overloads remain after it;
 *   'noconv'   the AC power flow does not converge with the plan applied (it could not be confirmed);
 *   'failed'   the optimization found no plan (the network stays as in the post-fault state).
 * `overloads` and `maxLoadingPct` are those of the "With plan" stage.
 */
export function planStatus(data) {
    const after = data?.after;
    const overloads = after?.violations?.overload?.length || 0;
    const loadings = (after?.branches || []).map(b => b.loading);
    const maxLoadingPct = loadings.length ? Math.max(...loadings) * 100 : 0;
    let kind;
    if (!data?.needsAction) kind = 'none';
    else if (/no solution/.test(data.note || '')) kind = 'failed';
    else if (after && after.converged === false) kind = 'noconv';
    else if (overloads > 0) kind = 'partial';
    else kind = 'solved';
    return { kind, overloads, maxLoadingPct, note: data?.note || null };
}

/**
 * Generator voltage adjustment (`voltage` block of the response; it only exists in plans where GENCO-OPF was consulted, see docs/TENSAO_GENCO_OPF.md).
 * Returns null when there is no block. `gens` is sorted by the largest Vg change.
 */
export function voltageSummary(data) {
    const v = data?.voltage;
    if (!v) return null;
    const gens = [...(v.gens || [])].map(g => ({ ...g, delta: g.vgAfter - g.vgBefore })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return {
        applied: !!v.applied,
        model: v.model || '',
        loops: v.loops,
        before: v.violationsBefore,
        after: v.violationsAfter,
        excessBeforePu: v.maxExcessBeforePu,
        excessAfterPu: v.maxExcessAfterPu,
        resolved: v.violationsAfter === 0,
        shedBeforeMW: v.shedBeforeMW,
        shedAfterMW: v.shedAfterMW,
        gens,
    };
}

const joinE = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(''));

/** Caption of the displayed stage, for the panel and the Play. */
export function stageCaption(data, stage, faults) {
    const plan = data?.plan;
    if (stage === 'pre') return 'Full network, no faults.';
    if (stage === 'postFault') return `Fault: ${faults}. The generation redistributes itself using the headroom.`;
    const st = planStatus(data);
    if (st.kind === 'failed') return `No feasible plan: the optimization found no solution. The fault remains (${faults}) and so do the ${st.overloads} overload(s).`;
    if (st.kind === 'noconv') return `The AC power flow does not converge with the plan applied, so it could not be confirmed. The fault remains (${faults}).`;
    const parts = [];
    if (plan?.totalRedispatchMW > 0) parts.push(`redispatch of ${plan.totalRedispatchMW.toLocaleString('en-US', { maximumFractionDigits: 1 })} MW`);
    if (plan?.totalShedMW > 0) parts.push(`shedding of ${plan.totalShedMW.toLocaleString('en-US', { maximumFractionDigits: 1 })} MW of load`);
    const vs = voltageSummary(data);
    if (vs?.applied && vs.gens.length) parts.push(`voltage adjustment at ${vs.gens.length} generator(s)`);
    if (st.kind === 'partial') return `Best-effort plan${parts.length ? `: ${joinE(parts)}` : ''}. ${st.overloads} overload(s) remain (max ${Math.round(st.maxLoadingPct)}%). The fault remains (${faults}).`;
    return parts.length ? `Plan applied: ${joinE(parts)}. The fault remains (${faults}).` : `No action needed. The fault remains (${faults}).`;
}

/** Numbers of each stage for the panel (overloads, violations, load served, highest loading). */
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

/** Plan summary for text: redispatch (largest changes) and shedding (largest cuts). */
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
