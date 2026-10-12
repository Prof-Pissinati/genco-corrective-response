import React, { useEffect, useRef, useState } from 'react';
import { KIND_LABEL, moveItem, recoverySummaryText, unservedSeries } from '../solver/recovery';

const fmt = (v, d = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Gráfico em degraus da carga não suprida (MW) ao longo do tempo (h), com o passo atual marcado. */
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
 * Painel "Reparo e religação por blocos": define a ordem dos reparos, simula e percorre a linha do tempo. O diagrama mostra o passo escolhido
 * (falhas que restam, carga cortada em laranja e o estado AC daquele passo).
 */
export default function RecoveryPanel({ darkMode, busy, items, order, setOrder, options, setOptions, data, index, setIndex, playing, setPlaying, onRun, onReset, onClose }) {
    const bg = darkMode ? 'rgba(24,24,28,0.97)' : 'rgba(255,255,255,0.98)';
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const box = { position: 'fixed', left: 340, top: 58, width: 424, maxHeight: '82vh', overflowY: 'auto', zIndex: 905, background: bg, color: fg,
        border: `1px solid ${line}`, borderRadius: 10, padding: 12, fontSize: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.35)', lineHeight: 1.45 };
    const btn = (color, extra = {}) => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', ...extra });
    const activeRow = useRef(null);
    useEffect(() => { activeRow.current?.scrollIntoView({ block: 'nearest' }); }, [index, data]);
    const [showAll, setShowAll] = useState(true);
    const num = (k, v) => setOptions(o => ({ ...o, [k]: Number(v) }));
    const inp = { width: 54, background: 'transparent', color: fg, border: `1px solid ${line}`, borderRadius: 4, padding: '2px 4px', fontSize: 12 };

    return (
        <div style={box} data-testid="recovery-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>🔧 Reparo e religação por blocos</b>
                <button style={btn(muted)} onClick={onClose} title="Fechar e voltar às falhas marcadas">✖</button>
            </div>

            {!data && (
                <>
                    <div style={{ color: muted, marginBottom: 6 }}>Cada falha é reparada na ordem abaixo. A cada reparo o plano é recalculado e a carga cortada é religada em blocos, cada bloco verificado pelo AC.</div>
                    {items.length === 0 && <div style={{ color: '#ffb300', marginBottom: 6 }}>Marque ao menos uma falha (barra em falta ou linha aberta) no diagrama.</div>}
                    {order.map((it, i) => (
                        <div key={`${it.type}-${it.id}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', borderTop: i ? `1px solid ${line}` : 'none' }}>
                            <b style={{ width: 18 }}>{i + 1}.</b><span style={{ flex: 1 }}>{it.label}</span>
                            <button style={btn(muted, { padding: '1px 7px' })} onClick={() => setOrder(moveItem(order, i, -1))} disabled={i === 0}>▲</button>
                            <button style={btn(muted, { padding: '1px 7px' })} onClick={() => setOrder(moveItem(order, i, 1))} disabled={i === order.length - 1}>▼</button>
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
                        <label>horas entre reparos <input style={inp} type="number" min="0" step="0.5" value={options.repairHours} onChange={e => num('repairHours', e.target.value)} /></label>
                        <label>min por manobra <input style={inp} type="number" min="0" step="1" value={options.blockMinutes} onChange={e => num('blockMinutes', e.target.value)} /></label>
                        <label>bloco máx. (MW) <input style={inp} type="number" min="1" step="5" value={options.blockMW} onChange={e => num('blockMW', e.target.value)} /></label>
                    </div>
                    <div style={{ color: muted, marginBottom: 8 }}>Tempos de reparo e de manobra são dados de entrada (sintéticos), usados só para a energia não suprida (ENS).</div>
                    <button style={btn('#00c853', { width: '100%', padding: '7px', opacity: busy || !order.length ? 0.6 : 1 })} disabled={busy || !order.length} onClick={onRun}>{busy ? 'Simulando…' : '▶ Simular reparo e religação'}</button>
                </>
            )}

            {data && (
                <>
                    <div style={{ marginBottom: 6, fontWeight: 'bold', color: data.summary.restored ? '#4caf50' : '#ffb300' }}>{recoverySummaryText(data)}</div>
                    <Chart data={data} index={index} color="#2979ff" muted={muted} />
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(0); }} title="Início">⏮</button>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(Math.max(0, index - 1)); }} title="Passo anterior">◀</button>
                        <button style={btn('#00c853')} onClick={() => { if (index >= data.events.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? '⏸ Pausar' : '▶ Play'}</button>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(Math.min(data.events.length - 1, index + 1)); }} title="Próximo passo">▶</button>
                        <button style={btn(muted)} onClick={() => { setPlaying(false); setIndex(data.events.length - 1); }} title="Fim">⏭</button>
                        <span style={{ color: muted, marginLeft: 'auto' }}>passo {index + 1}/{data.events.length}</span>
                        <button style={btn('#2979ff')} onClick={onReset} title="Voltar a escolher a ordem dos reparos">↺</button>
                    </div>
                    <label style={{ color: muted }}><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> mostrar todos os passos</label>
                    <div style={{ maxHeight: '30vh', overflowY: 'auto', border: `1px solid ${line}`, borderRadius: 6, marginTop: 4 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr style={{ color: muted, textAlign: 'right', position: 'sticky', top: 0, background: bg }}>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Passo</th><th>t (h)</th><th>Sem atender</th><th>Sobrec.</th>
                            </tr></thead>
                            <tbody>
                                {data.events.map((e, i) => (showAll || e.kind !== 'reconnect' || i === index) && (
                                    <tr key={e.i} ref={i === index ? activeRow : null} onClick={() => { setPlaying(false); setIndex(i); }}
                                        style={{ cursor: 'pointer', textAlign: 'right', borderTop: `1px solid ${line}`, background: i === index ? 'rgba(41,121,255,0.18)' : 'transparent' }}>
                                        <td style={{ textAlign: 'left', padding: '3px 6px' }}>{e.kind === 'plan' ? e.label : <><span style={{ color: muted }}>{KIND_LABEL[e.kind]}: </span>{e.label.replace(/^(Reparo: |Religa )/, '')}</>}</td>
                                        <td>{fmt(e.tHours, 2)}</td>
                                        <td>{fmt(e.unservedMW, 0)} MW</td>
                                        <td style={{ color: e.overloads > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }} title={`carregamento máximo ${fmt(e.maxLoadingPct, 0)}%`}>{e.converged ? e.overloads : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ color: muted, marginTop: 6 }}>Sobrecarga num passo é transitória: logo após um reparo o despacho ainda é o do plano anterior. O estado de cada plano é verificado pelo AC; o final é a rede sem falhas.</div>
                </>
            )}
        </div>
    );
}
