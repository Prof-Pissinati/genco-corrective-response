// src/utils/matpowerParser.js
// Lê um caso MATPOWER (.m) e devolve { baseMVA, bus, gen, branch, gencost } com as tabelas numéricas (uma linha por array).
// Colunas (padrão MATPOWER):
//   bus:    [BUS_I, TYPE, PD, QD, GS, BS, AREA, VM, VA, BASE_KV, ZONE, VMAX, VMIN]
//   gen:    [BUS, PG, QG, QMAX, QMIN, VG, MBASE, STATUS, PMAX, PMIN, ...]
//   branch: [F_BUS, T_BUS, R, X, B, RATE_A, RATE_B, RATE_C, TAP, SHIFT, STATUS, ANGMIN, ANGMAX]

export function parseMatpower(text) {
    // remove comentários (% ...) mantendo as quebras de linha
    const clean = text.split(/\r?\n/).map(l => l.replace(/%.*$/, '')).join('\n');

    const baseMatch = clean.match(/mpc\.baseMVA\s*=\s*([-+0-9.eE]+)/);
    if (!baseMatch) throw new Error('Arquivo MATPOWER inválido: mpc.baseMVA não encontrado.');

    const table = (name) => {
        const m = clean.match(new RegExp(`mpc\\.${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`));
        if (!m) return null;
        return m[1]
            .split(';')
            .map(r => r.trim())
            .filter(Boolean)
            .map(r => r.split(/[\s,]+/).filter(Boolean).map(Number));
    };

    const bus = table('bus');
    const gen = table('gen');
    const branch = table('branch');
    if (!bus || !branch) throw new Error('Arquivo MATPOWER inválido: faltam as tabelas mpc.bus e/ou mpc.branch.');
    if (bus.some(r => r.length < 13) || branch.some(r => r.length < 11)) {
        throw new Error('Arquivo MATPOWER inválido: linhas de bus/branch com colunas faltando.');
    }
    return { baseMVA: Number(baseMatch[1]), bus, gen: gen || [], branch, gencost: table('gencost') || [] };
}
