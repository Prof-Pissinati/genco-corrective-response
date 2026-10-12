import React, { useState } from 'react';
import { STAGES, stageSummary, planDigest } from '../solver/corrective';

const fmt = (v, d = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Painel "Resposta corretiva" (transmissão): o operador marca barras/linhas com defeito e o sistema propõe o redespacho da geração e,
 * se ainda houver sobrecarga, o corte mínimo de carga. O diagrama mostra a etapa selecionada (pré-falta, pós-falta, com plano).
 */
export default function CorrectivePanel({ darkMode, busy, data, stage, setStage, playing, setPlaying, onRun, onClear, onOpenScreening, onOpenRecovery }) {
    const [collapsed, setCollapsed] = useState(false);
    const bg = darkMode ? 'rgba(24,24,28,0.96)' : 'rgba(255,255,255,0.97)';
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const box = {
        position: 'fixed', left: 340, top: 58, width: 336, maxHeight: '72vh', overflowY: 'auto', zIndex: 900, background: bg, color: fg,
        border: `1px solid ${line}`, borderRadius: 10, padding: 12, fontSize: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.35)', lineHeight: 1.45,
    };
    const btn = (color, extra = {}) => ({ background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', ...extra });

    if (!data) {
        return (
            <div style={box} data-testid="corrective-panel">
                <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>🛠️ Resposta corretiva</div>
                <div style={{ color: muted, marginBottom: 8 }}>Marque barras ou linhas com defeito no diagrama e analise: o sistema propõe o redespacho da geração e, se ainda houver sobrecarga, o corte mínimo de carga.</div>
                <button style={btn('#00c853', { width: '100%', opacity: busy ? 0.6 : 1 })} disabled={busy} onClick={onRun}>{busy ? 'Analisando…' : '▶ Analisar falhas'}</button>
                {onOpenRecovery && <button style={btn('#00c853', { width: '100%', marginTop: 6 })} onClick={onOpenRecovery} title="Ordem dos reparos e religação da carga por blocos">🔧 Reparo e religação por blocos</button>}
                {onOpenScreening && <button style={btn('#2979ff', { width: '100%', marginTop: 6 })} onClick={onOpenScreening} title="Avalia todas as linhas e barras, uma a uma">📊 Varredura N-1 (mapa de risco)</button>}
            </div>
        );
    }

    const dg = planDigest(data);
    const s = data.summary;
    const rows = STAGES.map(st => ({ ...st, ...stageSummary(data, st.key) }));
    const verdict = !dg.needsAction
        ? 'Nenhuma ação necessária: a resposta automática da geração mantém a rede dentro dos limites.'
        : dg.shedTotalMW > 0
            ? `Plano: redespachar a geração e cortar ${fmt(dg.shedTotalMW, 1)} MW de carga (${fmt(dg.shedPctOfLoad * 100, 2)}% do total).`
            : 'Plano: apenas redespachar a geração (sem corte de carga).';

    return (
        <div style={box} data-testid="corrective-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>🛠️ Resposta corretiva</b>
                <span>
                    <button style={btn('#00c853', { padding: '3px 8px', marginRight: 6 })} onClick={() => { setStage('pre'); setPlaying(true); }} title="Percorre pré-falta, pós-falta e com plano">▶ Play</button>
                    {onOpenRecovery && <button style={btn('#00c853', { padding: '3px 8px', marginRight: 6 })} onClick={onOpenRecovery} title="Reparo e religação por blocos">🔧</button>}
                    {onOpenScreening && <button style={btn('#2979ff', { padding: '3px 8px', marginRight: 6 })} onClick={onOpenScreening} title="Varredura N-1 (mapa de risco)">📊</button>}
                    <button style={btn(muted, { padding: '3px 8px', marginRight: 6 })} onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expandir' : 'Recolher (mostra só o cabeçalho)'}>{collapsed ? '▸' : '▾'}</button>
                    <button style={btn(muted, { padding: '3px 8px' })} onClick={onClear} title="Fechar e voltar ao estado atual">✖</button>
                </span>
            </div>

            {!collapsed && (<>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {STAGES.map(st => (
                    <button key={st.key} onClick={() => { setPlaying(false); setStage(st.key); }}
                        style={btn(stage === st.key ? '#2979ff' : muted, { flex: 1, background: stage === st.key ? 'rgba(41,121,255,0.15)' : 'transparent' })}>{st.label}</button>
                ))}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead><tr style={{ color: muted, textAlign: 'right' }}><th style={{ textAlign: 'left' }}>Etapa</th><th>Sobrecargas</th><th>Carregam. máx.</th><th>Carga atendida</th></tr></thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.key} style={{ textAlign: 'right', background: stage === r.key ? (darkMode ? 'rgba(41,121,255,0.12)' : 'rgba(41,121,255,0.08)') : 'transparent', borderTop: `1px solid ${line}` }}>
                            <td style={{ textAlign: 'left', padding: '3px 2px' }}>{r.label}</td>
                            <td style={{ color: r.overloads > 0 ? '#ff5252' : '#4caf50', fontWeight: 'bold' }}>{r.converged ? r.overloads : '—'}</td>
                            <td>{r.converged ? `${fmt(r.maxLoadingPct, 0)}%` : '—'}</td>
                            <td>{fmt(r.servedMW, 0)} MW ({fmt(r.servedPct * 100, 1)}%)</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ padding: '6px 8px', border: `1px solid ${line}`, borderRadius: 6, marginBottom: 8, color: dg.needsAction ? '#ffb300' : '#4caf50' }}>{verdict}</div>

            {s.isolatedMW > 0 && <div style={{ color: muted, marginBottom: 6 }}>Carga isolada pelas falhas (sem alimentação): <b style={{ color: fg }}>{fmt(s.isolatedMW, 1)} MW</b></div>}

            {dg.redispatchCount > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>Redespacho ({fmt(dg.redispatchTotalMW, 1)} MW em {dg.redispatchCount} geradores)</div>
                    {dg.topRedispatch.map(r => (
                        <div key={r.gen} style={{ display: 'flex', justifyContent: 'space-between', color: muted }}>
                            <span>Barra {r.bus}</span><span style={{ color: fg }}>{fmt(r.pgBefore, 0)} → {fmt(r.pgAfter, 0)} MW ({r.delta > 0 ? '+' : ''}{fmt(r.delta, 0)})</span>
                        </div>
                    ))}
                    {dg.redispatchCount > dg.topRedispatch.length && <div style={{ color: muted }}>… e mais {dg.redispatchCount - dg.topRedispatch.length}</div>}
                </div>
            )}

            {dg.shedCount > 0 && (
                <div style={{ marginBottom: 4 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2, color: '#ff8f00' }}>Corte de carga ({fmt(dg.shedTotalMW, 1)} MW em {dg.shedCount} barras)</div>
                    {dg.topShed.map(r => (
                        <div key={r.bus} style={{ display: 'flex', justifyContent: 'space-between', color: muted }}>
                            <span>Barra {r.bus}</span><span style={{ color: fg }}>−{fmt(r.mw, 1)} MW ({fmt(r.pct * 100, 0)}% da carga)</span>
                        </div>
                    ))}
                    {dg.shedCount > dg.topShed.length && <div style={{ color: muted }}>… e mais {dg.shedCount - dg.topShed.length} barras</div>}
                </div>
            )}

            <div style={{ color: muted, fontSize: 11, marginTop: 6 }}>Plano verificado pelo fluxo AC em {fmt(s.ms, 0)} ms ({data.plan.iterations} iteração{data.plan.iterations === 1 ? '' : 'ões'}). Violações de tensão são apenas reportadas.</div>
            {data.note && <div style={{ color: '#ffb300', marginTop: 4 }}>{data.note}</div>}
            {playing && <div style={{ color: '#2979ff', marginTop: 4 }}>▶ reproduzindo…</div>}
            </>)}
        </div>
    );
}
