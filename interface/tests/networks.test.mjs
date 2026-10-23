// Network registry: each network has a case, layout, GENCO results and replay consistent with each other.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'vite';

let server, networks;
before(async () => {
    server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
    networks = await server.ssrLoadModule('/src/networks.js');
});
after(async () => { await server?.close(); });

const data = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url)));

test('four networks (14, 30, 57 and 118) and lookup by name', () => {
    assert.deepEqual(networks.NETWORKS.map(n => n.key), ['case14_ieee', 'case30_ieee', 'case57_ieee', 'case118_ieee']);
    assert.equal(networks.networkOf('case30_ieee').label, 'IEEE 30');
    assert.equal(networks.networkOf('other'), null);
    assert.equal(networks.networkOf(null), null);
});

test('each network: same names in case, GENCO results and replay; lines in the results exist in the case', () => {
    for (const n of networks.NETWORKS) {
        assert.equal(n.mpc.name, n.key);
        assert.equal(n.genco.screening.case, n.key, `screening of ${n.key}`);
        assert.equal(n.genco.verification.case, n.key, `verification of ${n.key}`);
        assert.ok(existsSync(new URL(`../src/data/replay_${n.key}.json`, import.meta.url)), `replay de ${n.key}`);
        assert.equal(data(`replay_${n.key}.json`).case, n.key);
        const nl = n.mpc.branch.length;
        assert.ok(n.genco.screening.lines.every(l => l.id >= 0 && l.id < nl));
        assert.ok(n.genco.verification.lines.every(l => l.id >= 0 && l.id < nl));
        assert.match(n.genco.screening.model, /authors/, 'the main model is the authors checkpoint');
    }
});

test('opening options: all networks open with the design layout (positions and bends)', () => {
    for (const n of networks.NETWORKS) {
        const o = networks.systemOptions(n);
        assert.equal(Object.keys(o.layout).length, n.mpc.bus.length, `layout of ${n.key} covers all buses`);
        assert.ok(o.waypoints && typeof o.waypoints === 'object', `bends of ${n.key}`);
        assert.equal(o.gridName, n.key);
    }
    assert.equal(Object.keys(networks.systemOptions(networks.networkOf('case57_ieee')).waypoints).length, 2, 'the 57 has two lines with a bend');
});

test('the GENCO error is much smaller than the DC one in all networks (screening and verifier)', () => {
    for (const n of networks.NETWORKS) {
        assert.ok(n.genco.screening.loadingMAE_pct.genco < n.genco.screening.loadingMAE_pct.dc / 3, `varredura ${n.key}`);
        assert.ok(n.genco.verification.loadingMAE_pct.genco < n.genco.verification.loadingMAE_pct.dc / 3, `verification ${n.key}`);
    }
});
