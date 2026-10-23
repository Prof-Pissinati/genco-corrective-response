import React, { useState } from 'react';
import { STAGES, stageSummary, planDigest, planStatus, voltageSummary } from '../solver/corrective';
import FloatingPanel from './FloatingPanel';

const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * "Corrective response" panel (transmission): the operator marks faulted buses/lines and the system proposes the generation redispatch and,
 * if overloads remain, the minimum load shedding. The diagram shows the selected stage (pre-fault, post-fault, with plan).
 */
export default function CorrectivePanel({ darkMode, busy, data, stage, setStage, playing, setPlaying, onRun, onClear, onOpenScreening, onOpenRecovery, caption, verification = null }) {
    const [showAllPlan, setShowAllPlan] = useState(false);     // full list of redispatch and shedding (by default, only the largest)
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const btn = (color, extra = {}) => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', ...extra });

    if (!data) {
        return (
            <FloatingPanel id="corrective" testId="corrective-panel" title="🛠️ Corrective response" width={340} darkMode={darkMode} defaultPos={{ left: 340, top: 58 }}>
                <div style={{ color: muted, marginBottom: 8 }}>Mark faulted buses or lines in the diagram and analyze: the system proposes the generation redispatch and, if overloads remain, the minimum load shedding.</div>
                <button style={btn('#00c853', { width: '100%', opacity: busy ? 0.6 : 1 })} disabled={busy} onClick={onRun}>{busy ? 'Analyzing…' : '▶ Analyze faults'}</button>
                {onOpenRecovery && <button style={btn('#00c853', { width: '100%', marginTop: 6 })} onClick={onOpenRecovery} title="Repair order and block-by-block load reconnection">🔧 Repair and block reconnection</button>}
                {onOpenScreening && <button style={btn('#2979ff', { width: '100%', marginTop: 6 })} onClick={onOpenScreening} title="Evaluates every line and bus, one at a time">📊 N-1 screening (risk map)</button>}
            </FloatingPanel>
        );
    }

    const dg = planDigest(data, showAllPlan ? 1000 : 6);
    const s = data.summary;
    const rows = STAGES.map(st => ({ ...st, ...stageSummary(data, st.key) }));
    const ps = planStatus(data);
    const vs = voltageSummary(data);
    const fmtShed = `${fmt(dg.shedTotalMW, 1)} MW of load (${fmt(dg.shedPctOfLoad * 100, 2)}% of the total)`;
    const verdict = ps.kind === 'none'
        ? 'No action needed: the automatic generation response keeps the network within limits.'
        : ps.kind === 'failed'
            ? `No plan was found: the optimization has no solution for this fault. The network still has ${ps.overloads} overload(s) (max ${fmt(ps.maxLoadingPct, 0)}%).`
            : ps.kind === 'noconv'
                ? 'The AC power flow does not converge with the plan applied: the plan could not be confirmed.'
                : ps.kind === 'partial'
                    ? `Best-effort plan (${dg.shedTotalMW > 0 ? `redispatch and shed ${fmtShed}` : 'redispatch generation'}): ${ps.overloads} overload(s) remain, max ${fmt(ps.maxLoadingPct, 0)}%.`
                    : dg.shedTotalMW > 0
                        ? `Plan: redispatch generation and shed ${fmtShed}.`
                        : 'Plan: redispatch generation only (no load shedding).';
    const servedWarning = (ps.kind === 'solved' || ps.kind === 'partial') && data.summary.servedPct < 0.5 ? ` Warning: only ${fmt(data.summary.servedPct * 100, 1)}% of the load is still served.` : '';
    const verdictColor = ps.kind === 'none' || ps.kind === 'solved' ? (ps.kind === 'none' ? '#4caf50' : '#ffb300') : '#ff5252';

    return (
        <FloatingPanel id="corrective" testId="corrective-panel" title="🛠️ Corrective response" width={340} darkMode={darkMode} defaultPos={{ left: 340, top: 58 }}
            onClose={onClear} closeTitle="Close and go back to the current state"
            actions={<>
                <button style={btn('#00c853', { padding: '2px 8px' })} onClick={() => { setStage('pre'); setPlaying(true); }} title="Steps through pre-fault, post-fault and with plan">▶ Play</button>
                {onOpenRecovery && <button style={btn('#00c853', { padding: '2px 8px' })} onClick={onOpenRecovery} title="Repair and block reconnection">🔧</button>}
                {onOpenScreening && <button style={btn('#2979ff', { padding: '2px 8px' })} onClick={onOpenScreening} title="N-1 screening (risk map)">📊</button>}
            </>}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {STAGES.map(st => (
                    <button key={st.key} onClick={() => { setPlaying(false); setStage(st.key); }}
                        style={btn(stage === st.key ? '#2979ff' : muted, { flex: 1, background: stage === st.key ? 'rgba(41,121,255,0.15)' : 'transparent' })}>{st.label}</button>
                ))}
            </div>
            {caption && <div style={{ marginBottom: 8, padding: '5px 8px', borderLeft: '3px solid #2979ff', background: 'rgba(41,121,255,0.08)', borderRadius: 4 }} data-testid="stage-caption">{caption}</div>}

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8, tableLayout: 'fixed' }}>
                <colgroup><col style={{ width: '22%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '33%' }} /></colgroup>
                <thead><tr style={{ color: muted, textAlign: 'right', verticalAlign: 'bottom' }}><th style={{ textAlign: 'left', paddingBottom: 2 }}>Stage</th><th>Overl.</th><th title="Buses with voltage outside the range">Voltage</th><th>Max.</th><th>Served</th></tr></thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.key} style={{ textAlign: 'right', background: stage === r.key ? (darkMode ? 'rgba(41,121,255,0.12)' : 'rgba(41,121,255,0.08)') : 'transparent', borderTop: `1px solid ${line}` }}>
                            <td style={{ textAlign: 'left', padding: '4px 2px', whiteSpace: 'normal' }}>{r.label}</td>
                            <td style={{ color: r.overloads > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }}>{r.converged ? r.overloads : '—'}</td>
                            <td style={{ color: r.voltage > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }} title="Buses with voltage outside the range">{r.converged ? r.voltage : '—'}</td>
                            <td>{r.converged ? `${fmt(r.maxLoadingPct, 0)}%` : '—'}</td>
                            <td style={{ lineHeight: 1.25 }}>{fmt(r.servedMW, 0)} MW<br /><span style={{ color: muted }}>({fmt(r.servedPct * 100, 1)}%)</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ padding: '6px 8px', border: `1px solid ${line}`, borderRadius: 6, marginBottom: 8, color: verdictColor }} data-testid="plan-verdict" title={data.note || undefined}>{verdict}{servedWarning}</div>

            {vs && (
                <div data-testid="voltage-adjust" style={{ padding: '6px 8px', border: `1px solid ${line}`, borderRadius: 6, marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>⚡ Generator voltage adjustment (GENCO-OPF)</div>
                    <div>
                        Voltage out of range: <b style={{ color: '#ff5252' }}>{vs.before} bus{vs.before === 1 ? '' : 'es'}</b> (max excess {fmt(vs.excessBeforePu, 4)} pu)
                        {' → '}<b style={{ color: vs.resolved ? '#4caf50' : '#ff8f00' }}>{vs.after}</b>{vs.after > 0 && ` (max ${fmt(vs.excessAfterPu, 4)} pu)`}
                    </div>
                    {vs.applied ? (
                        <>
                            <div style={{ color: muted, marginBottom: 2 }}>
                                {vs.gens.length} generator(s) with a changed reference voltage; power plan redone {vs.loops} time{vs.loops === 1 ? '' : 's'}
                                {vs.shedAfterMW !== vs.shedBeforeMW && `; shedding ${fmt(vs.shedBeforeMW, 1)} → ${fmt(vs.shedAfterMW, 1)} MW`}.
                            </div>
                            {(showAllPlan ? vs.gens : vs.gens.slice(0, 6)).map(g => (
                                <div key={g.gen} style={{ display: 'flex', justifyContent: 'space-between', color: muted }}>
                                    <span>Bus {g.bus}</span><span style={{ color: fg }}>{fmt(g.vgBefore, 3)} → {fmt(g.vgAfter, 3)} pu</span>
                                </div>
                            ))}
                            {vs.gens.length > 6 && <button style={btn(muted, { padding: '1px 8px', marginTop: 3 })} onClick={() => setShowAllPlan(v => !v)}>{showAllPlan ? '▴ show only the largest' : `▾ see all ${vs.gens.length}`}</button>}
                        </>
                    ) : (
                        <div style={{ color: '#ff8f00' }}>The adjustment did not improve the plan; the original plan is kept.</div>
                    )}
                    <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>GENCO-OPF only chooses the generators' reference voltage (not the dispatch); the power plan is redone with it and the AC power flow confirms. Precomputed, not live.</div>
                </div>
            )}

            {verification && (
                <div data-testid="genco-verification" style={{ padding: '6px 8px', border: `1px solid ${line}`, borderRadius: 6, marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>🧠 GENCO verifies the plan</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                        <colgroup><col style={{ width: '34%' }} /><col style={{ width: '14%' }} /><col style={{ width: '17%' }} /><col style={{ width: '14%' }} /><col style={{ width: '21%' }} /></colgroup>
                        <thead><tr style={{ color: muted, textAlign: 'right' }}><th style={{ textAlign: 'left' }}>Network max</th><th>AC</th><th>GENCO</th><th>DC</th><th>Verdict</th></tr></thead>
                        <tbody>
                            {verification.rows.map(r => (
                                <tr key={r.key} style={{ textAlign: 'right', borderTop: `1px solid ${line}` }} title={r.hint}>
                                    <td style={{ textAlign: 'left', padding: '3px 2px', whiteSpace: 'normal' }}>{r.label}</td>
                                    <td style={{ color: r.acSafe ? '#4caf50' : '#ff5252', fontWeight: 'bold' }}>{fmt(r.ac, 0)}%</td>
                                    <td style={{ fontWeight: 'bold' }}>{fmt(r.genco, 0)}%</td>
                                    <td style={{ color: muted }}>{fmt(r.dc, 0)}%</td>
                                    <td style={{ color: r.gencoApproves ? '#4caf50' : '#ff8f00', fontWeight: 'bold' }}>{r.gencoApproves ? '✓ approves' : '✗ rejects'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>AC = ground truth. GENCO never saw load shedding or redispatch in training. The exact plan tends to sit at 100% of the limit, and an approximate verifier only approves it with margin (the plan with margin uses {verification.folgaPct} points). GENCO approves when it estimates up to {verification.threshold}% of the limit. The final plan is always confirmed by the AC.{vs?.applied && ` This verification was done on the power plan BEFORE the voltage adjustment.`}</div>
                </div>
            )}

            {s.isolatedMW > 0 && <div style={{ color: muted, marginBottom: 6 }}>Load isolated by the faults (no supply): <b style={{ color: fg }}>{fmt(s.isolatedMW, 1)} MW</b></div>}

            {dg.redispatchCount > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>Redispatch ({fmt(dg.redispatchTotalMW, 1)} MW at {dg.redispatchCount} generators)</div>
                    {dg.topRedispatch.map(r => (
                        <div key={r.gen} style={{ display: 'flex', justifyContent: 'space-between', color: muted }}>
                            <span>Bus {r.bus}</span><span style={{ color: fg }}>{fmt(r.pgBefore, 0)} → {fmt(r.pgAfter, 0)} MW ({r.delta > 0 ? '+' : ''}{fmt(r.delta, 0)})</span>
                        </div>
                    ))}
                    {dg.redispatchCount > 6 && <button style={btn(muted, { padding: '1px 8px', marginTop: 3 })} onClick={() => setShowAllPlan(v => !v)}>{showAllPlan ? '▴ show only the largest' : `▾ see all ${dg.redispatchCount}`}</button>}
                </div>
            )}

            {dg.shedCount > 0 && (
                <div style={{ marginBottom: 4 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2, color: '#ff8f00' }}>Load shedding ({fmt(dg.shedTotalMW, 1)} MW at {dg.shedCount} buses)</div>
                    {dg.topShed.map(r => (
                        <div key={r.bus} style={{ display: 'flex', justifyContent: 'space-between', color: muted }}>
                            <span>Bus {r.bus}</span><span style={{ color: fg }}>−{fmt(r.mw, 1)} MW ({fmt(r.pct * 100, 0)}% of the load)</span>
                        </div>
                    ))}
                    {dg.shedCount > 6 && <button style={btn(muted, { padding: '1px 8px', marginTop: 3 })} onClick={() => setShowAllPlan(v => !v)}>{showAllPlan ? '▴ show only the largest' : `▾ see all ${dg.shedCount} buses`}</button>}
                </div>
            )}

            <div style={{ color: muted, fontSize: 11, marginTop: 6 }}>Plan verified by the AC power flow in {fmt(s.ms, 0)} ms ({data.plan.iterations} iteration{data.plan.iterations === 1 ? '' : 's'}). {vs?.applied ? 'Voltage adjusted by GENCO-OPF and checked by the AC.' : 'Voltage violations are only reported.'}</div>
            {playing && <div style={{ color: '#2979ff', marginTop: 4 }}>▶ playing…</div>}
        </FloatingPanel>
    );
}
