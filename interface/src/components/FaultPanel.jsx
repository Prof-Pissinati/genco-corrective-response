import React, { useState } from 'react';

export default function FaultPanel({
    isFaultSidebarOpen,
    setFaultSidebarOpen,
    sources,
    loadNodes,
    faultNodes,
    nodeFeeds,
    loopNodes, 
    toggleFault,
    selectedElement,
    setSelectedElement,
    setHoveredNodeId,
    getNodeColor,
    darkMode,
    THEME,
    branches,
    feedersList = [],
    toggleSwitch,
    setHoveredLineId
}) {
    const [unlockFixed, setUnlockFixed] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const getStatusText = (id) => {
        if (faultNodes.has(id)) return 'EM FALTA';
        if (loopNodes && loopNodes.has(id)) return 'EM LOOP';
        
        const feeds = nodeFeeds[id];
        if (!feeds || feeds.size === 0) return 'DESENERGIZADO';
        
        return 'ENERGIZADO';
    };

    // LÓGICA DE FILTRAGEM
    const term = searchTerm.toLowerCase().trim();

    const matchNode = (id, prefix) => {
        if (!term) return true;
        const textToSearch = `${prefix} ${id}`.toLowerCase();
        return textToSearch.includes(term) || id.toString().includes(term);
    };

    const matchBranch = (branch) => {
        if (!term) return true;
        const textToSearch = `linha ${branch.from}-${branch.to} ${branch.to}-${branch.from}`.toLowerCase();
        return textToSearch.includes(term) || branch.from.toString() === term || branch.to.toString() === term;
    };

    const filteredSources = sources.filter(id => matchNode(id, 'sub'));
    const filteredFeeders = feedersList.filter(id => matchNode(id, 'alim'));
    const filteredLoads = loadNodes.filter(id => matchNode(id, 'barra'));

    const sorter = (a, b) => {
        const minA = Math.min(a.from, a.to); const minB = Math.min(b.from, b.to);
        if (minA !== minB) return minA - minB;
        return Math.max(a.from, a.to) - Math.max(b.from, b.to);
    };

    const filteredSwitchable = branches.filter(b => b.hasSwitch && matchBranch(b)).sort(sorter);
    const filteredFixed = branches.filter(b => !b.hasSwitch && matchBranch(b)).sort(sorter);

    const hasNoResults = filteredSources.length === 0 && filteredFeeders.length === 0 && 
                         filteredLoads.length === 0 && filteredSwitchable.length === 0 && filteredFixed.length === 0;

    // A propriedade 'flex: 1' é o que define o espaço do texto. 
    // Colocamos um 'maxWidth' para garantir que ele não empurre o botão.
    const itemContainerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: '4px' };
    const labelStyle = { fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, maxWidth: '100px', fontWeight: '500' };

    // Lógica para suprimir o texto: Se o ID for grande (>= 4 dígitos) ou for linha complexa, suprime o prefixo
    const formatName = (prefix, id) => {
        const str = String(id);
        return str.length >= 4 ? str : `${prefix} ${str}`;
    };

    return (
        <div className={`right-sidebar ${isFaultSidebarOpen ? 'open' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
             
             {/* ================= HEADER FIXO COM BUSCA ================= */}
             <div style={{padding:'15px', borderBottom:'1px solid var(--border-color)', flexShrink:0, background: 'var(--bg-color)', zIndex: 10 }}>
                <h2 style={{fontSize:'16px', margin:'0 0 12px 0'}}>Diretório de Elementos</h2>
                
                <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '14px' }}>🔍</span>
                    <input 
                        type="text" 
                        placeholder="Buscar barra, linha ou sub..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 8px 8px 32px',
                            borderRadius: '6px',
                            border: `1px solid ${darkMode ? '#444' : '#ccc'}`,
                            background: darkMode ? '#1a1a1a' : '#fff',
                            color: darkMode ? '#eee' : '#222',
                            fontSize: '13px',
                            outline: 'none',
                            transition: 'border-color 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#00bcd4'}
                        onBlur={(e) => e.target.style.borderColor = darkMode ? '#444' : '#ccc'}
                    />
                    {searchTerm && (
                        <button 
                            onClick={() => setSearchTerm('')}
                            style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px' }}
                        >
                            ✖
                        </button>
                    )}
                </div>
             </div>
             
             {/* ================= SCROLL ÚNICO PARA AS LISTAS ================= */}
             <div className="fault-list custom-scrollbar" style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                
                {hasNoResults && (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--eng-gray)', fontSize: '13px' }}>
                        Nenhum elemento encontrado para "<b>{searchTerm}</b>".
                    </div>
                )}

                {/* --- SUBESTAÇÕES --- */}
                {filteredSources.length > 0 && (
                    <>
                        <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', marginBottom:'6px', marginTop:'4px', letterSpacing: '0.5px'}}>SUBESTAÇÕES PRINCIPAIS</div>
                        {filteredSources.map(id => (
                            <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                                onClick={() => setSelectedElement({ type: 'node', id: id })}
                                onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                                onMouseLeave={() => { setHoveredNodeId(null); }}
                                style={itemContainerStyle}>
                                <span style={labelStyle}>{formatName('SUB', id)}</span>
                                <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                        style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '105px', flexShrink: 0, padding: '4px 6px', fontSize: '11px' }} 
                                        onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                                    {getStatusText(id)}
                                </button>
                            </div>
                        ))}
                    </>
                )}

                {/* --- ALIMENTADORES --- */}
                {filteredFeeders.length > 0 && (
                    <>
                        <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', margin:'15px 0 6px 0', letterSpacing: '0.5px'}}>ALIMENTADORES</div>
                        {filteredFeeders.map(id => (
                            <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                                onClick={() => setSelectedElement({ type: 'node', id: id })}
                                onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                                onMouseLeave={() => { setHoveredNodeId(null); }}
                                style={itemContainerStyle}>
                                <span style={labelStyle}>{formatName('Alim.', id)}</span>
                                <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                        style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '105px', flexShrink: 0, padding: '4px 6px', fontSize: '11px' }} 
                                        onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                                    {getStatusText(id)}
                                </button>
                            </div>
                        ))}
                    </>
                )}
                
                {/* --- BARRAS DE CARGA --- */}
                {filteredLoads.length > 0 && (
                    <>
                        <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', margin:'15px 0 6px 0', letterSpacing: '0.5px'}}>BARRAS DE CARGA</div>
                        {filteredLoads.map(id => (
                            <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                                onClick={() => setSelectedElement({ type: 'node', id: id })}
                                onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                                onMouseLeave={() => { setHoveredNodeId(null); }}
                                style={itemContainerStyle}>
                                <span style={labelStyle}>{formatName('Barra', id)}</span>
                                <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                        style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '105px', flexShrink: 0, padding: '4px 6px', fontSize: '11px' }} 
                                        onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                                    {getStatusText(id)}
                                </button>
                            </div>
                        ))}
                    </>
                )}

                {/* ================= DIVISÓRIA SUAVE ================= */}
                {(filteredSources.length > 0 || filteredFeeders.length > 0 || filteredLoads.length > 0) && (filteredSwitchable.length > 0 || filteredFixed.length > 0) && (
                    <div style={{ borderTop: `1px solid ${darkMode ? '#333' : '#ddd'}`, margin: '20px 0 15px 0' }}></div>
                )}

                {/* --- CHAVES E LINHAS --- */}
                {(filteredSwitchable.length > 0 || filteredFixed.length > 0) && (
                    <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', marginBottom:'6px', letterSpacing: '0.5px'}}>CHAVES E LINHAS</div>
                )}

                {(() => {
                    const renderItem = (branch, isFixedType) => {
                        const nodeColor = getNodeColor ? getNodeColor(branch.from) : '#4caf50';
                        const isOn = branch.state === 1;
                        const canClick = !isFixedType || unlockFixed; 
                        const isSelected = selectedElement?.type === 'edge' && selectedElement?.data?.id === branch.id;

                        // 👇 NOVA LÓGICA DE NOME DA LINHA 👇
                        const lineStr = `${Math.min(branch.from, branch.to)}-${Math.max(branch.from, branch.to)}`;
                        // Se a string de números for grande (ex: "101-102" tem 7 chars), oculta a palavra "Linha"
                        const displayLabel = lineStr.length >= 7 ? lineStr : `Linha ${lineStr}`;

                        return (
                            <div key={branch.id} className={`fault-item ${isSelected ? 'selected' : ''}`} 
                                 onClick={() => setSelectedElement({ type: 'edge', data: branch })}
                                 onMouseEnter={() => { setSelectedElement({ type: 'edge', data: branch }); setHoveredLineId(branch.id); }} 
                                 onMouseLeave={() => setHoveredLineId(null)}
                                 style={itemContainerStyle}>
                                 
                                {/* 👇 O title exibe a dica completa no hover do mouse 👇 */}
                                <span style={labelStyle} title={`Linha ${lineStr}`}>{displayLabel}</span>
                                
                                <button 
                                    className={`fault-btn-rect`} 
                                    onClick={(e) => { e.stopPropagation(); if (canClick) toggleSwitch(branch.id); }}
                                    style={{
                                        background: canClick ? (isOn ? nodeColor : (darkMode ? '#333' : '#eee')) : 'transparent', 
                                        color: canClick ? (isOn ? '#000' : (darkMode ? '#aaa' : '#666')) : '#999',
                                        border: canClick ? 'none' : '1px solid #555', cursor: canClick ? 'pointer' : 'default', opacity: canClick ? 1 : 0.6,
                                        minWidth: '85px', flexShrink: 0, padding: '4px 6px', fontSize: '11px', fontWeight: 'bold' // Ajustado para FECHADO/ABERTO
                                    }}
                                >
                                    {/* 👇 O NOVO TEXTO EM PORTUGUÊS 👇 */}
                                    {!canClick ? 'FIXO' : (isOn ? 'FECHADO' : 'ABERTO')}
                                </button>
                            </div>
                        );
                    };

                    return (
                        <>
                            {filteredSwitchable.map(b => renderItem(b, false))}
                            
                            {filteredFixed.length > 0 && (
                                <div style={{ justifyContent: 'center', background: 'transparent', padding: '15px 0 10px 0' }}>
                                    <button onClick={() => setUnlockFixed(!unlockFixed)}
                                        style={{ width: '100%', padding: '8px', background: unlockFixed ? '#d32f2f' : 'transparent', color: unlockFixed ? '#fff' : '#888', border: '1px dashed #555', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.3s' }}>
                                        {unlockFixed ? '🔒 Bloquear Barras Fixas' : '🔓 Habilitar Manobra (Fixas)'}
                                    </button>
                                </div>
                            )}
                            
                            {filteredFixed.map(b => renderItem(b, true))}
                        </>
                    );
                })()}
             </div>
        </div>
    );
}