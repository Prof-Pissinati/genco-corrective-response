// src/solver/verification.js
// GENCO as a verifier of the corrective plans: reads the result of backend/tools/genco_verifica_planos.py
// (src/data/verificacao_planos_<network>_<model>.json). Pure functions, tested without a network.
// The numbers that decide what is "safe" (approval threshold and recommended margin) come from the file itself, because they depend on the model:
// a model with an upward bias (overestimates) is safe at 100%; one without bias needs a slightly lower threshold.

const LIMIT = 100;                      // the AC considers overload above 100% of the limit

/** Highest approval threshold (in % of the limit) with no wrongful approval of insufficient plans; 100 if the file does not say. */
export function safeThreshold(data) {
    return data?.seguranca?.genco?.limiarSeguroPct ?? LIMIT;
}

/** Margins (points) available in the file, in ascending order. */
function folgas(data) {
    return (data?.folgas || []).map(f => f.folgaPct).sort((a, b) => a - b);
}

/** Smallest margin at which GENCO, at the safe threshold, approves at least `share` of the plans; if none gets there, the largest. */
export function recommendedFolga(data, share = 0.9) {
    const por = data?.seguranca?.genco?.aprovadosNoLimiarSeguro || {};
    const lista = folgas(data).filter(p => p > 0);
    for (const p of lista) {
        const f = data.folgas.find(x => x.folgaPct === p);
        if (f && (por[`folga${p}`] ?? 0) >= share * f.planos) return p;
    }
    return lista.length ? lista[lista.length - 1] : 0;
}

/** The three states shown in the corrective response panel. */
export function verificationStates(data) {
    const pct = recommendedFolga(data);
    return [
        { key: 'semPlano', label: 'No plan', hint: 'automatic generation response only' },
        { key: 'folga0', label: 'Exact plan', hint: 'LP plan, which sits at the limit (AC ≈ 100%)' },
        { key: `folga${pct}`, label: 'Plan with margin', hint: `plan computed to stay ${pct} points below the limit`, folgaPct: pct },
    ];
}

/** Index per line: Map(branch id -> { semPlano, parcial, folga0 … folga10 }). */
export function verificationIndex(data) {
    return new Map((data?.lines || []).map(l => [l.id, l]));
}

/** Table rows: maximum loading (%) by the AC, GENCO and DC and the GENCO verdict (approves if the estimate stays within the safe threshold). */
export function verificationRows(entry, data) {
    if (!entry) return [];
    const th = safeThreshold(data);
    return verificationStates(data).filter(s => entry[s.key]).map(s => {
        const r = entry[s.key];
        return {
            ...s, ac: r.ac.maxPct, genco: r.genco.maxPct, dc: r.dc.maxPct, shedMW: r.shedMW, redispatchMW: r.redespachoMW,
            acSafe: r.ac.maxPct <= LIMIT + 0.01, gencoApproves: r.genco.maxPct <= th, dcApproves: r.dc.maxPct <= LIMIT,
        };
    });
}

/** For faults = exactly ONE line (no buses): { id, rows, threshold, folgaPct, model }; otherwise null. */
export function verificationFor(data, faults) {
    if (!data || !faults) return null;
    const bo = faults.branchOut || [], bu = faults.busOut || [];
    if (bo.length !== 1 || bu.length !== 0) return null;
    const entry = verificationIndex(data).get(bo[0]);
    if (!entry) return null;
    return { id: entry.id, rows: verificationRows(entry, data), threshold: safeThreshold(data), folgaPct: recommendedFolga(data), model: data.model };
}

/** Numbers of the overall summary, ready to display. */
export function verificationSummary(data) {
    if (!data) return null;
    const s = data.seguranca, th = safeThreshold(data), pct = recommendedFolga(data);
    const fx = (p) => data.folgas.find(f => f.folgaPct === p);
    const f0 = fx(0), fr = fx(pct), f10 = fx(10);
    const dcTh = s.dc.limiarSeguroPct;
    return {
        model: data.model, contingencies: data.contingencias, states: data.estados, skipped: (data.pulados || []).length,
        maeGenco: data.loadingMAE_pct.genco, maeDc: data.loadingMAE_pct.dc,
        insufficient: s.insuficientes, ruleOfThree: s.regraDeTres95,
        threshold: th, wrongAt100: s.genco.aprovadasPorEngano100, wrongDc: s.dc.aprovadasPorEngano100, dcSafeThreshold: dcTh,
        exact: { approved: s.genco.aprovadosNoLimiarSeguro.folga0 ?? 0, plans: f0.planos, shedMW: f0.corteTotalMW, redispatchMW: f0.redespachoMedioMW },
        margin: { pct: pct, approved: s.genco.aprovadosNoLimiarSeguro[`folga${pct}`] ?? 0, plans: fr.planos, shedMW: fr.corteTotalMW, redispatchMW: fr.redespachoMedioMW },
        dcSafe: { approved: s.dc.aprovadosNoLimiarSeguro[`folga10`] ?? 0, plans: f10.planos, shedMW: f10.corteTotalMW, redispatchMW: f10.redespachoMedioMW },
        ms: data.ms.genco_cpu_este_pc,
    };
}
