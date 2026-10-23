// Actually renders the components that show the load shedding (via Vite in SSR mode, no browser) and checks the result.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server, SvgTooltips, GraphNode;
before(async () => {
    server = await createServer({ configFile: false, plugins: [(await import('@vitejs/plugin-react')).default()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
    SvgTooltips = (await server.ssrLoadModule('/src/components/SvgTooltips.jsx')).default;
    GraphNode = (await server.ssrLoadModule('/src/components/GraphNode.jsx')).default;
});
after(async () => { await server?.close(); });

const texts = (html) => [...html.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, '')).join(' | ');

function tooltip(id, { shed = null, gen = null, load = { p: 90000, q: 30000 } } = {}) {
    const props = {
        pinnedCards: [{ type: 'node', id, x: 0, y: 0 }], setPinnedCards: () => {}, branches: [], lineCurrents: {}, loads: {}, sses: {}, feedersList: [], sources: [69],
        systemLoads: { [id]: load }, nodeData: { [id]: { v: 1.047, angle: -31.63, unit: 'MW', ...(gen ? { pg: gen.pg, qg: gen.qg } : {}) } },
        generatorBuses: gen ? new Map([[id, { pgBase: 0, pmax: gen.pmax, pmin: 0, qmax: 30, qmin: -10 }]]) : new Map(),
        shedBuses: shed ? new Map([[id, shed]]) : new Map(), currentScale: 1,
    };
    return texts(renderToStaticMarkup(React.createElement(SvgTooltips, props)));
}

test('load bus tooltip with partial shedding: load served and load shed', () => {
    const t = tooltip(33, { shed: { mw: 10, pct: 0.44 }, load: { p: 23000, q: 9000 } });
    assert.match(t, /Bus 33/);
    assert.match(t, /Load P: \| 12\.9 MW/);                 // 23 MW x (1 - 0.44)
    assert.match(t, /shed: 10\.0 MW \(44%\)/);
});

test('tooltip of a bus without shedding does not change', () => {
    const t = tooltip(33, { load: { p: 23000, q: 9000 } });
    assert.match(t, /Load P: \| 23\.0 MW/);
    assert.doesNotMatch(t, /shed:/);
});

test('tooltip of the generator that also has shed load (bus 15): stage generation, load 0 and 90 MW shed', () => {
    const t = tooltip(15, { shed: { mw: 90, pct: 1 }, gen: { pg: 0, qg: -4.3, pmax: 0 } });
    assert.match(t, /Generator 15/);
    assert.match(t, /Generation P: \| 0\.0 MW/);
    assert.match(t, /Generation Q: \| -4\.3 MVAr/);
    assert.match(t, /Load P: \| 0\.0 MW/);
    assert.match(t, /shed: 90\.0 MW \(100%\)/);
});

test('tooltip of the redispatched generator shows the stage dispatch (bus 111: 18.5 MW, 23.4% of Pmax)', () => {
    const t = tooltip(111, { gen: { pg: 18.5, qg: -2.4, pmax: 79 }, load: { p: 0, q: 0 } });
    assert.match(t, /Generator 111/);
    assert.match(t, /Generation P: \| 18\.5 MW/);
    assert.match(t, /Loading: | 23.4%\| 23\.5%/);
});

const node = (extra) => renderToStaticMarkup(React.createElement('svg', null, React.createElement(GraphNode, {
    nodeId: 13, pos: { x: 0, y: 0 }, isSource: false, isFeeder: false, color: '#0a84ff', isHighlighted: false, darkMode: true, isEditMode: false,
    isRestoringLayout: false, showLabels: false, nodeLoad: null, hasShunt: false, onMouseDown() {}, onClick() {}, onMouseEnter() {}, onMouseLeave() {},
    currentScale: 1, isSimplified: false, ...extra,
})));

test('bus with full shedding: hollow shape with a dashed outline, in the energized color (not orange)', () => {
    const h = node({ shedPct: 1 });
    assert.match(h, /stroke-dasharray="5 3"/);
    assert.match(h, /fill="#101014"/);
    assert.match(h, /stroke="#0a84ff"/);
    assert.doesNotMatch(h, /#ff8f00/);
});

test('bus with partial shedding: filled, with a light dashed outline; without shedding: no dashes', () => {
    const p = node({ shedPct: 0.44 });
    assert.match(p, /stroke-dasharray="5 3"/);
    assert.match(p, /fill="#0a84ff"/);
    const s = node({ shedPct: 0 });
    assert.doesNotMatch(s, /stroke-dasharray/);
});

// ---- floating windows and panels ----
test('floating window: renders title and content; collapsed shows only the title', async () => {
    const FloatingPanel = (await server.ssrLoadModule('/src/components/FloatingPanel.jsx')).default;
    const h = renderToStaticMarkup(React.createElement(FloatingPanel, { id: 'test', title: 'My panel', darkMode: true, testId: 'x', onClose: () => {} }, React.createElement('p', null, 'panel content')));
    assert.match(h, /My panel/);
    assert.match(h, /panel content/);
    assert.match(h, /position:fixed/);
    assert.match(h, /resize:both/);              // resizable
    assert.match(h, /Drag to move/);
});

test('corrective panel: fixed columns (no overlap), redispatch list with "see all" and load served on two lines', async () => {
    const fs = await import('node:fs');
    const data = JSON.parse(fs.readFileSync(new URL('./fixtures/corrective_linha7.json', import.meta.url)));
    const CorrectivePanel = (await server.ssrLoadModule('/src/components/CorrectivePanel.jsx')).default;
    const h = renderToStaticMarkup(React.createElement(CorrectivePanel, { darkMode: true, busy: false, data, stage: 'after', setStage() {}, playing: false, setPlaying() {}, onRun() {}, onClear() {}, caption: 'legenda' }));
    assert.match(h, /table-layout:fixed/);
    assert.match(h, /<col style="width:33%"/);
    assert.doesNotMatch(h, /voltage-adjust/);                                      // plan without the voltage block: no adjustment on screen
    assert.match(h, /4,094 MW<br\/>/);                                            // load served: value and percentage on separate lines
    assert.match(h, /see all 10/);                                            // the 4 generators that did not fit are now accessible
    assert.match(h, /Load shedding/);
});

test('corrective panel: the voltage adjustment block only appears with the voltage block, and the Voltage column shows the buses out of range', async () => {
    const fs = await import('node:fs');
    const data = JSON.parse(fs.readFileSync(new URL('./fixtures/corrective_linha7.json', import.meta.url)));
    const CorrectivePanel = (await server.ssrLoadModule('/src/components/CorrectivePanel.jsx')).default;
    const props = { darkMode: false, busy: false, data, stage: 'after', setStage() {}, playing: false, setPlaying() {}, onRun() {}, onClear() {}, caption: '' };
    const sem = renderToStaticMarkup(React.createElement(CorrectivePanel, props));
    assert.doesNotMatch(sem, /voltage-adjust/);
    assert.match(sem, /Voltage<\/th>/);
    assert.match(sem, /Voltage violations are only reported/);
    const voltage = { model: 'm', applied: true, loops: 1, violationsBefore: 2, violationsAfter: 0, maxExcessBeforePu: 0.0107, maxExcessAfterPu: 0, qgenBefore: 16, qgenAfter: 4, overloadsAfter: 0,
        shedBeforeMW: 148, shedAfterMW: 148, gens: [{ gen: 1, bus: 10, vgBefore: 1.05, vgAfter: 1.03 }] };
    const com = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, data: { ...data, voltage } }));
    assert.match(com, /data-testid="voltage-adjust"/);
    assert.match(com, /Generator voltage adjustment \(GENCO-OPF\)/);
    assert.match(com, /2 buses/);
    assert.match(com, /1\.050 → 1\.030 pu/);
    assert.match(com, /Voltage adjusted by GENCO-OPF and checked by the AC/);
    const nao = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, data: { ...data, voltage: { ...voltage, applied: false, violationsAfter: 2, gens: [] } } }));
    assert.match(nao, /the original plan is kept/);
});

test('corrective panel shows the GENCO verification when there is data, and does not show it without', async () => {
    const fs = await import('node:fs');
    const data = JSON.parse(fs.readFileSync(new URL('./fixtures/corrective_linha7.json', import.meta.url)));
    const verif = JSON.parse(fs.readFileSync(new URL('../src/data/verificacao_planos_case118_ieee_autores.json', import.meta.url)));
    const verifAlt = JSON.parse(fs.readFileSync(new URL('../src/data/verificacao_planos_case118_ieee_n10.json', import.meta.url)));
    const { verificationFor } = await server.ssrLoadModule('/src/solver/verification.js');
    const CorrectivePanel = (await server.ssrLoadModule('/src/components/CorrectivePanel.jsx')).default;
    const ScreeningPanel = (await server.ssrLoadModule('/src/components/ScreeningPanel.jsx')).default;
    const props = { darkMode: false, busy: false, data, stage: 'after', setStage() {}, playing: false, setPlaying() {}, onRun() {}, onClear() {}, caption: '' };
    const sem = renderToStaticMarkup(React.createElement(CorrectivePanel, props));
    assert.doesNotMatch(sem, /genco-verification/);
    const com = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, verification: verificationFor(verif, { branchOut: [verif.lines[0].id], busOut: [] }) }));
    assert.match(com, /data-testid="genco-verification"/);
    assert.match(com, /GENCO verifies the plan/);
    assert.match(com, /No plan/); assert.match(com, /Exact plan/); assert.match(com, /Plan with margin/);
    assert.match(com, /(approves|rejects)/);
    assert.doesNotMatch(com, /BEFORE the voltage adjustment/);
    const voltage = { model: 'm', applied: true, loops: 1, violationsBefore: 1, violationsAfter: 0, maxExcessBeforePu: 0.01, maxExcessAfterPu: 0, shedBeforeMW: 1, shedAfterMW: 1, gens: [] };
    const withAdjustment = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, data: { ...data, voltage }, verification: verificationFor(verif, { branchOut: [verif.lines[0].id], busOut: [] }) }));
    assert.match(withAdjustment, /BEFORE the voltage adjustment/);                           // the verification is of the original power plan
    const resumo = renderToStaticMarkup(React.createElement(ScreeningPanel, { darkMode: false, busy: false, data: null, genco: null, verif, verifAlt, onRun() {}, onClose() {}, onSelect() {}, initialTab: 'genco' }));
    assert.match(resumo, /data-testid="verification-summary"/);
    assert.match(resumo, /GENCO as a plan verifier/);
    assert.match(resumo, /by mistake/);
    assert.match(resumo, /Comparison/);                                              // comparison line with our training
    assert.match(resumo, /authors/);
    // tabs: the contingency list (default) and the GENCO summary live in separate tabs, without nested scrolling
    const listaAba = renderToStaticMarkup(React.createElement(ScreeningPanel, { darkMode: false, busy: false, data: null, genco: null, verif, verifAlt, onRun() {}, onClose() {}, onSelect() {} }));
    assert.match(listaAba, /data-testid="screening-tab-lista"/); assert.match(listaAba, /data-testid="screening-tab-genco"/);
    assert.match(listaAba, /Run the screening/);
    assert.doesNotMatch(listaAba, /verification-summary/);
    assert.doesNotMatch(resumo, /Run the screening/);
    const dados = { count: 2, noAction: 0, needAction: 2, ms: 10, contingencies: [{ type: 'line', id: 1, label: 'line 1–2', overloads: 2, converged: true, maxLoadingPct: 156, isolatedMW: 0, needsAction: true }, { type: 'bus', id: 2, label: 'bus 2', overloads: 3, converged: true, maxLoadingPct: 246, isolatedMW: 0, needsAction: true }] };
    const withTable = renderToStaticMarkup(React.createElement(ScreeningPanel, { darkMode: false, busy: false, data: dados, genco: null, onRun() {}, onClose() {}, onSelect() {} }));
    assert.doesNotMatch(withTable, /max-height:38vh/, 'the table has no scrolling of its own inside the panel');
    assert.match(withTable, /<th style="position:sticky;top:-10px/, 'fixed table header');
    assert.match(withTable, /line 1–2/);
    const nada = renderToStaticMarkup(React.createElement(ScreeningPanel, { darkMode: false, busy: false, data: null, genco: null, onRun() {}, onClose() {}, onSelect() {} }));
    assert.doesNotMatch(nada, /verification-summary/);
});

test('corrective panel: when the optimization finds no plan, the verdict says so and not "no action needed"', async () => {
    const fs = await import('node:fs');
    const data = JSON.parse(fs.readFileSync(new URL('./fixtures/corrective_linha7.json', import.meta.url)));
    const CorrectivePanel = (await server.ssrLoadModule('/src/components/CorrectivePanel.jsx')).default;
    const props = { darkMode: false, busy: false, stage: 'after', setStage() {}, playing: false, setPlaying() {}, onRun() {}, onClear() {}, caption: '' };
    const failedPlan = { ...data, needsAction: true, note: 'optimization has no solution (HiGHS infeasible)', plan: { ...data.plan, shed: [], redispatch: [], totalShedMW: 0, totalRedispatchMW: 0 },
        after: { ...data.after, violations: { ...data.after.violations, overload: [1, 2, 3] } } };
    const h = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, data: failedPlan }));
    assert.match(h, /No plan was found/);
    assert.match(h, /3 overload/);
    assert.doesNotMatch(h, /No action needed/);
    assert.doesNotMatch(h, /redispatch generation only/);
    const ok = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, data }));
    assert.doesNotMatch(ok, /No plan was found/);
    assert.doesNotMatch(ok, /Warning: only/, 'a plan that serves most of the load does not carry the blackout warning');
    const nearBlackout = renderToStaticMarkup(React.createElement(CorrectivePanel, { ...props, data: { ...data, summary: { ...data.summary, servedPct: 0.008 } } }));
    assert.match(nearBlackout, /Warning: only 0\.8% of the load is still served/);
});

// ---- parallel lines ----
test('parallel line tooltip carries the circuit letter (49 ➔ 54 A / B), and a line without a parallel does not change', async () => {
    const branches = [{ id: 74, from: 49, to: 54, state: 1 }, { id: 75, from: 49, to: 54, state: 1 }, { id: 7, from: 8, to: 5, state: 1 }];
    const cur = { pFlow: 1000, qFlow: 0, current: 10, percentage: 25, limitCurrent: 99, unit: 'MW' };
    const card = (id) => texts(renderToStaticMarkup(React.createElement(SvgTooltips, {
        pinnedCards: [{ type: 'line', id, x: 0, y: 0 }], setPinnedCards: () => {}, branches, lineCurrents: { 74: cur, 75: cur, 7: cur }, loads: {}, sses: {},
        feedersList: [], sources: [69], systemLoads: {}, nodeData: {}, currentScale: 1,
    })));
    assert.match(card(74), /49 ➔ 54 A/);
    assert.match(card(75), /49 ➔ 54 B/);
    assert.doesNotMatch(card(7), /➔ \d+ [AB]\b/);
});

test('line click area: 20 px by default and narrower on parallel circuits (each receives only its own click)', async () => {
    const GraphEdge = (await server.ssrLoadModule('/src/components/GraphEdge.jsx')).default;
    const base = { branch: { id: 1, from: 1, to: 2, state: 1 }, pathString: 'M 0 0 L 10 0', color: '#fff', isHighlighted: false, isEditMode: false, isRestoringLayout: false,
        waypoints: [], selectedEditWaypoints: new Set(), flowDir: 0, p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, onLineMouseDown() {}, onLineClick() {}, onLineDoubleClick() {},
        onLineMouseEnter() {}, onLineMouseLeave() {}, onWaypointMouseDown() {}, onWaypointDoubleClick() {} };
    const hit = (extra) => renderToStaticMarkup(React.createElement('svg', null, React.createElement(GraphEdge, { ...base, ...extra }))).match(/stroke="transparent"[^>]*stroke-width="(\d+)"|stroke-width="(\d+)"[^>]*stroke="transparent"/);
    const w = (m) => Number(m[1] || m[2]);
    assert.equal(w(hit({})), 20);
    assert.equal(w(hit({ hitWidth: 10 })), 10);
});
