import React, { useEffect, useRef, useState } from 'react';
import { KIND_LABEL, moveItem, recoverySummaryText, unservedSeries } from '../solver/recovery';
import FloatingPanel from './FloatingPanel';

const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Step chart of the unserved load (MW) over time (h), with the current step marked. */
function Chart({ data, index, color, muted }) {
    const { pts, tMax, mwMax } = unservedSeries(data);
    const W = 396, H = 84, L = 34, B = 16, T = 6;
    const x = (t) => L + (t / tMax) * (W - L - 6);
    const y = (mw) => T + (1 - mw / mwMax) * (H - T - B);
    let path = `M ${x(pts[0].t)} ${y(pts[0].mw)}`;
    for (let i = 1; i < pts.length; i++) path += ` H ${x(pts[i].t)} V ${y(pts[i].mw)}`;
    const cur = pts[index];
    return (
        <svg width={W} height={H} style={{ display: 'block', marginBottom: 6 }}>
            <line x1={L} y1={H - B} x2={W - 6} y2={H - B} stroke={muted} strokeWidth="1" />
            <line x1={L} y1={T} x2={L} y2={H - B} stroke={muted} strokeWidth="1" />
            <text x={2} y={T + 8} fontSize="9" fill={muted}>{fmt(mwMax, 0)} MW</text>
            <text x={2} y={H - B} fontSize="9" fill={muted}>0</text>
            <text x={L} y={H - 3} fontSize="9" fill={muted}>0 h</text>
            <text x={W - 36} y={H - 3} fontSize="9" fill={muted}>{fmt(tMax, 1)} h</text>
            <path d={path} fill="none" stroke="#ff8f00" strokeWidth="2" />
            {pts.map((p, i) => p.kind === 'repair' && <line key={i} x1={x(p.t)} y1={T} x2={x(p.t)} y2={H - B} stroke="#00c853" strokeDasharray="3 3" strokeWidth="1" />)}
            <circle cx={x(cur.t)} cy={y(cur.mw)} r="4.5" fill={color} stroke="#fff" strokeWidth="1.2" />
        </svg>
    );
}

/**
 * "Repair and block reconnection" panel: sets the repair order, simulates and steps through the timeline. The diagram shows the chosen step
 * (remaining faults, shed load in orange and the AC state of that step).
 */
export default function RecoveryPanel({ darkMode, busy, items, order, setOrder, options, setOptions, data, index, setIndex, playing, setPlaying, onRun, onReset, onClose }) {
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const bg = darkMode ? 'rgba(24,24,28,0.97)' : 'rgba(255,255,255,0.98)';
    const thS = { position: 'sticky', top: -10, background: bg, zIndex: 1 };          // table header fixed while the panel scrolls (-10 compensates for the panel's inner padding)
    const btn = (color, extra = {}) => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', ...extra });
    const activeRow = useRef(null);
    useEffect(() => { activeRow.current?.scrollIntoView({ block: 'nearest' }); }, [index, data]);
    const [showAll, setShowAll] = useState(true);
    const num = (k, v) => setOptions(o => ({ ...o, [k]: Number(v) }));
    const inp = { width: 54, background: 'transparent', color: fg, border: `1px solid ${line}`, borderRadius: 4, padding: '2px 4px', fontSize: 12 };

    return (
        <FloatingPanel id="recovery" testId="recovery-panel" title="🔧 Repair and block reconnection" width={440} darkMode={darkMode} onClose={onClose}
            closeTitle="Close and go back to the marked faults" defaultPos={{ left: 340, top: 58 }}>

            {!data && (
                <>
                    <div style={{ color: muted, marginBottom: 6 }}>Each fault is repaired in the order below. After each repair the plan is recomputed and the shed load is reconnected in blocks, each block checked by the AC.</div>
                    {items.length === 0 && <div style={{ color: '#ffb300', marginBottom: 6 }}>Mark at least one fault (faulted bus or open line) in the diagram.</div>}
                    {order.map((it, i) => (
                        <div key={`${it.type}-${it.id}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', borderTop: i ? `1px solid ${line}` : 'none' }}>
                            <b style={{ width: 18 }}>{i + 1}.</b><span style={{ flex: 1 }}>{it.label}</span>
                            <button style={btn(muted, { padding: '1px 7px' })} onClick={() => setOrder(moveItem(order, i, -1))} disabled={i === 0}>▲</button>
                            <button style={btn(muted, { padding: '1px 7px' })} onClick={() => setOrder(moveItem(order, i, 1))} disabled={i === order.length - 1}>▼</button>
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
                        <label>hours between repairs <input style={inp} type="number" min="0" step="0.5" value={options.repairHours} onChange={e => num('repairHours', e.target.value)} /></label>
                        <label>min per switching <input style={inp} type="number" min="0" step="1" value={options.blockMinutes} onChange={e => num('blockMinutes', e.target.value)} /></label>
                        <label>max block (MW) <input style={inp} type="number" min="1" step="5" value={options.blockMW} onChange={e => num('blockMW', e.target.value)} /></label>
                    </div>
                    <div style={{ color: muted, marginBottom: 8 }}>Repair and switching times are input data (synthetic), used only for the energy not supplied (ENS).</div>
                    <button style={btn('#00c853', { width: '100%', padding: '7px', opacity: busy || !order.length ? 0.6 : 1 })} disabled={busy || !order.length} onClick={onRun}>{busy ? 'Simulating…' : '▶ Simulate repair and reconnection'}</button>
                </>
            )}

            {data && (
                <>
                    <div style={{ marginBottom: 6, fontWeight: 'bold', color: data.summary.restored ? '#4caf50' : '#ffb300' }}>{recoverySummaryText(data)}</div>
                    <Chart data={data} index={index} color="#2979ff" muted={muted} />
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(0); }} title="Start">⏮</button>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(Math.max(0, index - 1)); }} title="Previous step">◀</button>
                        <button style={btn('#00c853')} onClick={() => { if (index >= data.events.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? '⏸ Pause' : '▶ Play'}</button>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(Math.min(data.events.length - 1, index + 1)); }} title="Next step">▶</button>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(data.events.length - 1); }} title="End">⏭</button>
                        <span style={{ color: muted, marginLeft: 'auto' }}>step {index + 1}/{data.events.length}</span>
                        <button style={btn('#2979ff')} onClick={onReset} title="Go back to choosing the repair order">↺</button>
                    </div>
                    <label style={{ color: muted }}><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> show all steps</label>
                    <div style={{ border: `1px solid ${line}`, borderRadius: 6, marginTop: 4 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr style={{ color: muted, textAlign: 'right' }}>
                                <th style={{ ...thS, textAlign: 'left', padding: '3px 6px' }}>Step</th><th style={thS}>t (h)</th><th style={thS}>Unserved</th><th style={thS}>Overl.</th>
                            </tr></thead>
                            <tbody>
                                {data.events.map((e, i) => (showAll || e.kind !== 'reconnect' || i === index) && (
                                    <tr key={e.i} ref={i === index ? activeRow : null} onClick={() => { setPlaying(false); setIndex(i); }}
                                        style={{ cursor: 'pointer', textAlign: 'right', scrollMarginTop: 30, borderTop: `1px solid ${line}`, background: i === index ? 'rgba(41,121,255,0.18)' : 'transparent' }}>
                                        <td style={{ textAlign: 'left', padding: '3px 6px' }}>{e.kind === 'plan' ? e.label : <><span style={{ color: muted }}>{KIND_LABEL[e.kind]}: </span>{e.label.replace(/^(Repair: |Reconnects )/, '')}</>}</td>
                                        <td>{fmt(e.tHours, 2)}</td>
                                        <td>{fmt(e.unservedMW, 0)} MW</td>
                                        <td style={{ color: e.overloads > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }} title={`maximum loading ${fmt(e.maxLoadingPct, 0)}%`}>{e.converged ? e.overloads : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ color: muted, marginTop: 6 }}>An overload in a step is transient: right after a repair the dispatch is still that of the previous plan. The state of each plan is checked by the AC; the final one is the network without faults.</div>
                </>
            )}
        </FloatingPanel>
    );
}
