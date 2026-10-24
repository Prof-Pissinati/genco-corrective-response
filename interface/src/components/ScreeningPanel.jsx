import React, { useState } from 'react';
import { filterRows, gencoSummary, gencoIndex } from '../solver/screening';
import { verificationSummary } from '../solver/verification';
import FloatingPanel from './FloatingPanel';

const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * "N-1 screening" panel (risk map): every line and bus, with what each single fault requires (AC, with the automatic response
 * of the generation). Clicking a row applies the fault and opens the corrective response. It also shows the GENCO validation on line outages.
 */
export default function ScreeningPanel({ darkMode, busy, data, genco, verif = null, verifAlt = null, onRun, onClose, onSelect, initialTab = 'lista' }) {
    const [onlyAction, setOnlyAction] = useState(true);
    const [kind, setKind] = useState('all');
    const [onlyReady, setOnlyReady] = useState(true);
    const [tab, setTab] = useState(initialTab);          // 'lista' (contingencies) | 'genco' (GENCO and verifier summary)
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const bg = darkMode ? 'rgba(24,24,28,0.97)' : 'rgba(255,255,255,0.98)';
    const btn = (color, extra = {}) => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', ...extra });
    const thS = { position: 'sticky', top: -10, background: bg, zIndex: 1 };          // table header fixed while the panel scrolls (-10 compensates for the panel's inner padding)
    const gs = gencoSummary(genco);
    const gi = gencoIndex(genco);
    const vs = verificationSummary(verif);
    const va = verificationSummary(verifAlt);
    const replay = !!data?.contingencies?.some(c => c.hasPlan !== undefined);   // static version: only some of the contingencies have a precomputed response
    const rows = filterRows(data, { onlyAction, kind, onlyReady: replay && onlyReady });

    return (
        <FloatingPanel id="screening" testId="screening-panel" title="📊 N-1 screening (risk map)" width={460} darkMode={darkMode} onClose={onClose}
            defaultPos={{ right: 330, top: 58 }}>

            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }} role="tablist">
                {[['lista', '📋 Contingencies'], ['genco', '🧠 GENCO']].map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} data-testid={`screening-tab-${k}`} onClick={() => setTab(k)}
                        style={btn(tab === k ? '#2979ff' : muted, { flex: 1, background: tab === k ? 'rgba(41,121,255,0.15)' : 'transparent' })}>{label}</button>
                ))}
            </div>

            {tab === 'lista' && (
                <>
            {!data && (
                <>
                    <div style={{ color: muted, marginBottom: 8 }}>Evaluates, with the AC power flow, the loss of each line and each bus and says what each one requires: nothing, redispatch or load shedding.</div>
                    <button style={btn('#00c853', { width: '100%', padding: '7px', opacity: busy ? 0.6 : 1 })} disabled={busy} onClick={onRun}>{busy ? 'Scanning… (about 10 s)' : '▶ Run the screening'}</button>
                </>
            )}

            {data && (
                <>
                    <div style={{ marginBottom: 6 }}>
                        <b>{data.count}</b> single contingencies: <b style={{ color: '#4caf50' }}>{data.noAction}</b> no action | <b style={{ color: '#ffb300' }}>{data.needAction}</b> need a plan
                        <span style={{ color: muted }}> ({fmt(data.ms / 1000, 1)} s)</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <label style={{ color: muted }}><input type="checkbox" checked={onlyAction} onChange={e => setOnlyAction(e.target.checked)} /> only those that need a plan</label>
                        {replay && <label style={{ color: muted }} title="In the replay only these have a precomputed plan"><input type="checkbox" checked={onlyReady} onChange={e => setOnlyReady(e.target.checked)} /> only with plan ●</label>}
                        <select value={kind} onChange={e => setKind(e.target.value)} style={{ background: 'transparent', color: fg, border: `1px solid ${line}`, borderRadius: 4, fontSize: 12 }}>
                            <option value="all">lines and buses</option><option value="line">lines only</option><option value="bus">buses only</option>
                        </select>
                        <button style={btn('#2979ff', { marginLeft: 'auto' })} onClick={onRun} title="Redo the screening">↻</button>
                    </div>
                    <div style={{ border: `1px solid ${line}`, borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr style={{ color: muted, textAlign: 'center' }}>
                                <th style={{ ...thS, textAlign: 'left', padding: '3px 6px' }}>Fault</th><th style={thS}>Overl.</th><th style={thS}>Max.</th><th style={thS}>Isolated</th><th style={thS} title="GENCO estimate (state without redispatch)">GENCO*</th>
                            </tr></thead>
                            <tbody>
                                {rows.map(c => {
                                    const g = c.type === 'line' ? gi.get(c.id) : null;
                                    return (
                                        <tr key={`${c.type}-${c.id}`} onClick={() => onSelect(c)} style={{ cursor: 'pointer', textAlign: 'center', borderTop: `1px solid ${line}` }}
                                            title="Click to apply this fault and see the corrective response">
                                            <td style={{ textAlign: 'left', padding: '3px 6px', opacity: c.hasPlan === false ? 0.55 : 1 }}>{c.hasPlan ? <span style={{ color: '#00c853' }} title="precomputed plan">● </span> : null}{c.label}</td>
                                            <td style={{ color: c.overloads > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }}>{c.converged ? c.overloads : '—'}</td>
                                            <td>{c.converged ? `${fmt(c.maxLoadingPct, 0)}%` : '—'}</td>
                                            <td>{c.isolatedMW > 0 ? `${fmt(c.isolatedMW, 0)} MW` : '—'}</td>
                                            <td style={{ color: muted }} title={g ? `AC (no redispatch): ${fmt(g.ac.maxPct, 0)}% | DC: ${fmt(g.dc.maxPct, 0)}%` : ''}>{g ? `${fmt(g.genco.maxPct, 0)}%` : '·'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{ padding: '4px 6px', color: muted, borderTop: `1px solid ${line}` }}>Overl./Max.: AC after the automatic redispatch. *GENCO: maximum loading estimated <i>without</i> redispatch (lines only).</div>
                    </div>
                </>
            )}

                </>
            )}

            {tab === 'genco' && (
                <>
            {gs && (
                <div style={{ marginTop: 8, padding: 8, border: `1px solid ${line}`, borderRadius: 6 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>GENCO × AC × DC on {gs.scenarios} line outages</div>
                    <div style={{ color: muted }}>{gs.model}. Post-fault state <i>without redispatch</i> (as in the training data).</div>
                    <div>Mean loading error: <b>GENCO {fmt(gs.maeGenco, 2)} pt</b> · DC {fmt(gs.maeDc, 2)} pt</div>
                    <div>Lines ≥ 90% detected: <b>GENCO {gs.recall90.genco}%</b> · DC {gs.recall90.dc}% | ≥ 100%: GENCO {gs.recall100.genco}% · DC {gs.recall100.dc}%</div>
                    <div>Time per scenario (CPU of the validation computer): GENCO {fmt(gs.ms.genco_cpu_este_pc, 0)} ms · AC {fmt(gs.ms.ac_backend, 0)} ms · DC {fmt(gs.ms.dc_backend, 1)} ms</div>
                    <div style={{ color: '#ffb300', marginTop: 2 }}>Improves on the DC (mean error {fmt(gs.maeGenco, 2)} vs {fmt(gs.maeDc, 2)} pt), but detects {gs.recall100.genco}% of the lines ≥ 100%: the final plan is always confirmed by the AC.</div>
                </div>
            )}

            {vs && (
                <div data-testid="verification-summary" style={{ marginTop: 8, padding: 8, border: `1px solid ${line}`, borderRadius: 6 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>🧠 GENCO as a plan verifier</div>
                    <div style={{ color: muted }}>{vs.model}. {vs.contingencies} line contingencies that need a plan, {vs.states} states with the line out (no plan, partial plan, and plans with a margin of 0 to 10 points). States with redispatch and shedding that GENCO never saw in training.</div>
                    <div>Mean error per line in these states: <b>GENCO {fmt(vs.maeGenco, 2)} pt</b> · DC {fmt(vs.maeDc, 2)} pt</div>
                    <div>Insufficient plans approved by mistake (out of {vs.insufficient}), approving up to 100% of the limit: <b>GENCO {vs.wrongAt100}</b> · <b style={{ color: '#ff5252' }}>DC {vs.wrongDc}</b>
                        {vs.threshold < 100 && <>. Approving up to <b>{vs.threshold}%</b>, GENCO approves none: <b style={{ color: '#4caf50' }}>0</b></>}</div>
                    <div>Plan with a margin of {vs.margin.pct} points: GENCO approves <b>{vs.margin.approved} of {vs.margin.plans}</b> (shedding {fmt(vs.margin.shedMW, 0)} MW in total, mean redispatch {fmt(vs.margin.redispatchMW, 0)} MW).</div>
                    <div>The DC is only safe approving up to {vs.dcSafeThreshold}%, and then needs a 10-point margin: it approves {vs.dcSafe.approved} of {vs.dcSafe.plans} (shedding {fmt(vs.dcSafe.shedMW, 0)} MW, mean redispatch {fmt(vs.dcSafe.redispatchMW, 0)} MW).</div>
                    {va && <div style={{ color: muted, marginTop: 2 }}>Comparison, {va.model}: error {fmt(va.maeGenco, 2)} pt; approves {va.margin.approved} of {va.margin.plans} with a margin of {va.margin.pct} points (at its safe threshold of {va.threshold}%).</div>}
                    <div style={{ color: '#ffb300', marginTop: 2 }}>{vs.ruleOfThree <= 10
                        ? `Zero wrongful approvals in ${vs.insufficient} plans means, with 95% confidence, an error rate below ${fmt(vs.ruleOfThree, 1)}%.`
                        : `Only ${vs.insufficient} insufficient plans in this network: sample too small to estimate the error rate (IEEE 118 has 173).`} One model, lines that do not island buses; the safe threshold was chosen on the same data. The AC remains the final confirmation.</div>
                </div>
            )}
                    {!gs && !vs && <div style={{ color: muted }}>No GENCO results for this network.</div>}
                </>
            )}
        </FloatingPanel>
    );
}
