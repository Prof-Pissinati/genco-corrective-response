// src/utils/matpowerParser.js
// Reads a MATPOWER case (.m) and returns { baseMVA, bus, gen, branch, gencost } with the numeric tables (one row per array).
// Columns (MATPOWER standard):
//   bus:    [BUS_I, TYPE, PD, QD, GS, BS, AREA, VM, VA, BASE_KV, ZONE, VMAX, VMIN]
//   gen:    [BUS, PG, QG, QMAX, QMIN, VG, MBASE, STATUS, PMAX, PMIN, ...]
//   branch: [F_BUS, T_BUS, R, X, B, RATE_A, RATE_B, RATE_C, TAP, SHIFT, STATUS, ANGMIN, ANGMAX]

export function parseMatpower(text) {
    // removes comments (% ...) keeping the line breaks
    const clean = text.split(/\r?\n/).map(l => l.replace(/%.*$/, '')).join('\n');

    const baseMatch = clean.match(/mpc\.baseMVA\s*=\s*([-+0-9.eE]+)/);
    if (!baseMatch) throw new Error('Invalid MATPOWER file: mpc.baseMVA not found.');

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
    if (!bus || !branch) throw new Error('Invalid MATPOWER file: the mpc.bus and/or mpc.branch tables are missing.');
    if (bus.some(r => r.length < 13) || branch.some(r => r.length < 11)) {
        throw new Error('Invalid MATPOWER file: bus/branch rows with missing columns.');
    }
    return { baseMVA: Number(baseMatch[1]), bus, gen: gen || [], branch, gencost: table('gencost') || [] };
}
