// src/utils/transmission.js
// Suporte a sistemas de TRANSMISSÃO (malhados, com barras PV e geradores) na interface do simulador.
//  - buildTransmissionSystem: converte um caso MATPOWER (tabelas numéricas) para o formato interno (systemData).
//  - solveTransmissionDC: fluxo DC com despacho fixo, por ilha energizada (a ilha que contém a barra de referência).
//
// Convenções (ver docs/CONTRATO_API.md): potência em MW na lógica elétrica; o simulador original guarda cargas em kW, então
// systemData.loads/pFlow ficam em kW e Sbase em kVA (a interface já divide por 1000 para exibir MW).
// Só a ilha com a barra de referência é energizada; ilhas sem ela ficam desenergizadas (carga perdida).
import { solveLinearSystem } from './mathSolver.js';

const REF_TYPE = 3;

/**
 * @param {{baseMVA:number, bus:number[][], gen:number[][], branch:number[][]}} mpc  tabelas MATPOWER
 * @param {{layout?:Object<string,[number,number]>, name?:string, gridName?:string}} [extras]  layout {numeroDaBarra:[x,y]}; gridName = caso do backend
 */
export function buildTransmissionSystem(mpc, extras = {}) {
    const { baseMVA, bus, gen, branch } = mpc;
    const name = extras.name || 'Sistema de transmissão';

    const refRow = bus.find(r => r[1] === REF_TYPE) || bus[0];
    const refBus = refRow[0];
    const vbase = refRow[9] || 138;

    // geradores; casos de OPF (PGLib) trazem um Pg inicial que NÃO fecha com a carga (ou zero). Se o despacho difere da carga em mais de 10% (perdas de um OPF ficam em ~3%, e a referência as absorve),
    // rebalanceia: escala o Pg existente (respeitando Pmax) ou, se não houver, distribui a carga proporcionalmente a Pmax.
    const gens = gen.map((g, i) => ({
        id: i, bus: g[0], pg: g[1], qg: g[2], qmax: g[3], qmin: g[4], vg: g[5],
        status: g[7] > 0 ? 1 : 0, pmax: g[8], pmin: g[9],
    }));
    const totalLoad = bus.reduce((s, r) => s + r[2], 0);
    const active = gens.filter(g => g.status);
    const pgSum = active.reduce((s, g) => s + g.pg, 0);
    let dispatchAdjusted = false;
    if (active.length && totalLoad > 0 && Math.abs(pgSum - totalLoad) > 0.10 * totalLoad) {
        const pmaxSum = active.reduce((s, g) => s + Math.max(g.pmax, 0), 0);
        const k = pgSum > 1e-6 ? totalLoad / pgSum : 0;
        const scaled = active.map(g => g.pg * k);
        const fits = k > 0 && active.every((g, i) => scaled[i] <= Math.max(g.pmax, 0) + 1e-9);
        active.forEach((g, i) => {
            g.pg = fits ? scaled[i] : (pmaxSum > 0 ? (Math.max(g.pmax, 0) / pmaxSum) * totalLoad : 0);
        });
        dispatchAdjusted = true;
    }

    const zbase = (vbase * vbase) / baseMVA; // ohm
    const branches = branch.map((b, i) => {
        const status = b[10] > 0 ? 1 : 0;
        const tap = b[8] && b[8] !== 0 ? b[8] : 1;
        return {
            id: i, from: b[0], to: b[1],
            r: b[2] * zbase, x: b[3] * zbase,          // ohm (só para compatibilidade com o restante do código)
            rpu: b[2], xpu: b[3], bch: b[4], tap, shift: b[9] || 0,
            rateA: b[5], imax: b[5],                    // MVA; 0 = sem limite
            angmin: b[11], angmax: b[12],
            state: status, initialState: status, hasSwitch: true,
        };
    });

    const loads = {};
    const busInfo = {};
    bus.forEach(r => {
        loads[r[0]] = { p: r[2] * 1000, q: r[3] * 1000, type: r[1] }; // kW / kVAr
        busInfo[r[0]] = { type: r[1], gs: r[4], bs: r[5], baseKV: r[9], vmax: r[11], vmin: r[12] };
    });

    const positions = {};
    if (extras.layout) {
        Object.entries(extras.layout).forEach(([no, xy]) => { positions[no] = { x: xy[0], y: xy[1] }; });
    }
    const pmaxTotal = gens.filter(g => g.status).reduce((s, g) => s + Math.max(g.pmax, 0), 0);

    return {
        metadata: { name, isImported: true, version: '1.0', mode: 'transmission' },
        mode: 'transmission',
        Vbase: vbase,
        Sbase: baseMVA * 1000,                           // kVA
        constraints: { vMin: Math.min(...bus.map(r => r[12])), vMax: Math.max(...bus.map(r => r[11])) },
        sources: [refBus],
        sses: { [refBus]: pmaxTotal * 1000 },
        loads,
        branches,
        shunts: {},
        positionsProject: Object.keys(positions).length ? positions : null,
        transmission: {
            name, baseMVA, refBus, buses: busInfo, gens, dispatchAdjusted,
            gridName: extras.gridName || null,              // caso existente no backend (vai pelo nome); null = enviar as tabelas
            mpc: { baseMVA, bus, gen, branch },             // tabelas MATPOWER originais (para o backend avaliar casos importados)
        },
    };
}

/**
 * Fluxo DC com despacho fixo. A barra de referência absorve o desbalanço.
 * Retorna { nodes, lines, summary } no formato esperado pela interface (como runPowerFlow).
 */
export function solveTransmissionDC(branches, faultNodes, sysData) {
    const T = sysData.transmission;
    const faults = faultNodes instanceof Set ? faultNodes : new Set(faultNodes || []);
    const base = T.baseMVA;
    const ref = T.refBus;
    const loadsKW = sysData.loads || {};

    const lines = {};
    const zeroLine = (b) => ({ current: 0, percentage: 0, pFlow: 0, qFlow: 0, limitCurrent: b.rateA || 0, unit: 'MW' });
    branches.forEach(b => { lines[b.id] = zeroLine(b); });

    const totalLoadMW = Object.values(loadsKW).reduce((s, l) => s + (l.p || 0), 0) / 1000;
    const emptyResult = () => ({ nodes: {}, lines, summary: { mode: 'DC', servedMW: 0, lostMW: totalLoadMW, genMW: 0, slackMW: 0, energizedBuses: 0 } });
    if (faults.has(ref)) return emptyResult();

    // ramos ativos (fechados e com as duas pontas sem falta) e BFS a partir da referência
    const active = branches.filter(b => b.state === 1 && !faults.has(b.from) && !faults.has(b.to));
    const adj = new Map();
    const link = (u, v) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push(v); };
    active.forEach(b => { link(b.from, b.to); link(b.to, b.from); });

    const energized = new Set([ref]);
    const queue = [ref];
    for (let h = 0; h < queue.length; h++) {
        (adj.get(queue[h]) || []).forEach(v => { if (!energized.has(v)) { energized.add(v); queue.push(v); } });
    }

    const order = [...energized];
    const idx = new Map(order.map((n, i) => [n, i]));
    const n = order.length;

    // injeções líquidas em pu (geração - carga) nas barras energizadas
    const inj = new Array(n).fill(0);
    let genMW = 0;
    T.gens.forEach(g => {
        if (g.status && energized.has(g.bus) && !faults.has(g.bus)) { inj[idx.get(g.bus)] += g.pg / base; genMW += g.pg; }
    });
    let servedMW = 0;
    order.forEach(no => {
        const pd = (loadsKW[no]?.p || 0) / 1000;
        inj[idx.get(no)] -= pd / base;
        servedMW += pd;
    });

    // matriz B' (susceptâncias 1/(x*tap)) e solução com a referência em θ = 0
    const B = Array.from({ length: n }, () => new Array(n).fill(0));
    const usable = active.filter(b => energized.has(b.from) && energized.has(b.to) && b.xpu !== 0);
    usable.forEach(b => {
        const y = 1 / (b.xpu * b.tap);
        const i = idx.get(b.from), j = idx.get(b.to);
        B[i][i] += y; B[j][j] += y; B[i][j] -= y; B[j][i] -= y;
    });
    const keep = order.map((no, i) => i).filter(i => order[i] !== ref);
    const theta = new Array(n).fill(0);
    if (keep.length > 0) {
        const A = keep.map(i => keep.map(j => B[i][j]));
        const rhs = keep.map(i => inj[i]);
        const sol = solveLinearSystem(A, rhs);
        keep.forEach((i, k) => { theta[i] = sol[k]; });
    }

    const nodes = {};
    order.forEach((no, i) => { nodes[no] = { v: 1.0, angle: theta[i] * (180 / Math.PI), unit: 'MW' }; });

    usable.forEach(b => {
        const flowMW = ((theta[idx.get(b.from)] - theta[idx.get(b.to)]) / (b.xpu * b.tap)) * base;
        const abs = Math.abs(flowMW);
        lines[b.id] = {
            current: Math.max(abs, 0.002),                // MW (evita cair na cor de "desenergizado" com fluxo ~ 0)
            percentage: b.rateA > 0 ? (abs / b.rateA) * 100 : 0,
            pFlow: flowMW * 1000,                          // kW, como o restante da interface
            qFlow: 0,
            limitCurrent: b.rateA || 0,
            unit: 'MW',                                    // a interface mostra MW/MVA em vez de A
        };
    });

    const lostMW = totalLoadMW - servedMW;
    return { nodes, lines, summary: { mode: 'DC', servedMW, lostMW, genMW, slackMW: servedMW - genMW, energizedBuses: n } };
}
