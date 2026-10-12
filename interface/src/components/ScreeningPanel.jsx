import React, { useState } from 'react';
import { filterRows, gencoSummary, gencoIndex } from '../solver/screening';

const fmt = (v, d = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Painel "Varredura N-1" (mapa de risco): todas as linhas e barras, com o que cada falha simples exige (AC, com a resposta automática
 * da geração). Clicar numa linha aplica a falha e abre a resposta corretiva. Mostra também a validação do GENCO em saídas de linha.
 */
export default function ScreeningPanel({ darkMode, busy, data, genco, onRun, onClose, onSelect }) {
    const [onlyAction, setOnlyAction] = useState(true);
    const [kind, setKind] = useState('all');
    const [onlyReady, setOnlyReady] = useState(true);
    const bg = darkMode ? 'rgba(24,24,28,0.97)' : 'rgba(255,255,255,0.98)';
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const box = { position: 'fixed', right: 330, top: 58, width: 440, maxHeight: '78vh', overflowY: 'auto', zIndex: 910, background: bg, color: fg,
        border: `1px solid ${line}`, borderRadius: 10, padding: 12, fontSize: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.35)', lineHeight: 1.45 };
    const btn = (color, extra = {}) => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', ...extra });
    const gs = gencoSummary(genco);
    const gi = gencoIndex(genco);
    const replay = !!data?.contingencies?.some(c => c.hasPlan !== undefined);   // versão estática: só parte das contingências tem resposta pré-calculada
    const rows = filterRows(data, { onlyAction, kind, onlyReady: replay && onlyReady });

    return (
        <div style={box} data-testid="screening-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>📊 Varredura N-1 (mapa de risco)</b>
                <button style={btn(muted)} onClick={onClose}>✖</button>
            </div>

            {!data && (
                <>
                    <div style={{ color: muted, marginBottom: 8 }}>Avalia, pelo fluxo AC, a perda de cada linha e de cada barra e diz o que cada uma exige: nada, redespacho ou corte de carga.</div>
                    <button style={btn('#00c853', { width: '100%', padding: '7px', opacity: busy ? 0.6 : 1 })} disabled={busy} onClick={onRun}>{busy ? 'Varrendo… (cerca de 10 s)' : '▶ Executar a varredura'}</button>
                </>
            )}

            {data && (
                <>
                    <div style={{ marginBottom: 6 }}>
                        <b>{data.count}</b> contingências simples: <b style={{ color: '#4caf50' }}>{data.noAction}</b> sem ação | <b style={{ color: '#ffb300' }}>{data.needAction}</b> exigem plano
                        <span style={{ color: muted }}> ({fmt(data.ms / 1000, 1)} s)</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <label style={{ color: muted }}><input type="checkbox" checked={onlyAction} onChange={e => setOnlyAction(e.target.checked)} /> só as que exigem plano</label>
                        {replay && <label style={{ color: muted }} title="No replay só estas têm o plano pré-calculado"><input type="checkbox" checked={onlyReady} onChange={e => setOnlyReady(e.target.checked)} /> só com plano ●</label>}
                        <select value={kind} onChange={e => setKind(e.target.value)} style={{ background: 'transparent', color: fg, border: `1px solid ${line}`, borderRadius: 4, fontSize: 12 }}>
                            <option value="all">linhas e barras</option><option value="line">só linhas</option><option value="bus">só barras</option>
                        </select>
                        <button style={btn('#2979ff', { marginLeft: 'auto' })} onClick={onRun} title="Refazer a varredura">↻</button>
                    </div>
                    <div style={{ maxHeight: '34vh', overflowY: 'auto', border: `1px solid ${line}`, borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr style={{ color: muted, textAlign: 'right', position: 'sticky', top: 0, background: bg }}>
                                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Falha</th><th>Sobrec.</th><th>Máx.</th><th>Isolada</th><th title="Estimativa do GENCO (estado sem redespacho)">GENCO*</th>
                            </tr></thead>
                            <tbody>
                                {rows.slice(0, 80).map(c => {
                                    const g = c.type === 'line' ? gi.get(c.id) : null;
                                    return (
                                        <tr key={`${c.type}-${c.id}`} onClick={() => onSelect(c)} style={{ cursor: 'pointer', textAlign: 'right', borderTop: `1px solid ${line}` }}
                                            title="Clique para aplicar esta falha e ver a resposta corretiva">
                                            <td style={{ textAlign: 'left', padding: '3px 6px', opacity: c.hasPlan === false ? 0.55 : 1 }}>{c.hasPlan ? <span style={{ color: '#00c853' }} title="plano pré-calculado">● </span> : null}{c.label}</td>
                                            <td style={{ color: c.overloads > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }}>{c.converged ? c.overloads : '—'}</td>
                                            <td>{c.converged ? `${fmt(c.maxLoadingPct, 0)}%` : '—'}</td>
                                            <td>{c.isolatedMW > 0 ? `${fmt(c.isolatedMW, 0)} MW` : '—'}</td>
                                            <td style={{ color: muted }} title={g ? `AC (sem redespacho): ${fmt(g.ac.maxPct, 0)}% | DC: ${fmt(g.dc.maxPct, 0)}%` : ''}>{g ? `${fmt(g.genco.maxPct, 0)}%` : '·'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{ padding: '4px 6px', color: muted, borderTop: `1px solid ${line}` }}>Sobrec./Máx.: AC após o redespacho automático. *GENCO: carregamento máximo estimado <i>sem</i> redespacho (só linhas).</div>
                        {rows.length > 80 && <div style={{ padding: 4, color: muted }}>… mostrando 80 de {rows.length}</div>}
                    </div>
                </>
            )}

            {gs && (
                <div style={{ marginTop: 8, padding: 8, border: `1px solid ${line}`, borderRadius: 6 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>GENCO × AC × DC em {gs.scenarios} saídas de linha</div>
                    <div style={{ color: muted }}>{gs.model}. Estado pós-falta <i>sem redespacho</i> (como nos dados de treino).</div>
                    <div>Erro médio de carregamento: <b>GENCO {fmt(gs.maeGenco, 1)} pt</b> · DC {fmt(gs.maeDc, 1)} pt</div>
                    <div>Linhas ≥ 90% detectadas: <b>GENCO {gs.recall90.genco}%</b> · DC {gs.recall90.dc}% | ≥ 100%: GENCO {gs.recall100.genco}% · DC {gs.recall100.dc}%</div>
                    <div>Tempo por cenário (CPU deste computador): GENCO {fmt(gs.ms.genco_cpu_este_pc, 0)} ms · AC {fmt(gs.ms.ac_backend, 0)} ms · DC {fmt(gs.ms.dc_backend, 1)} ms</div>
                    <div style={{ color: '#ffb300', marginTop: 2 }}>Modelo reduzido: melhora o DC, mas ainda não substitui o AC perto do limite (100%). Um treino maior deve ajudar.</div>
                </div>
            )}
        </div>
    );
}
