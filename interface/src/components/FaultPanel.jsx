import React, { useState, useMemo } from 'react';
import { parallelGroups } from '../utils/parallel';

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
    setHoveredLineId,
    getNodeShed = null
}) {
    const groups = useMemo(() => parallelGroups(branches), [branches]);      // parallel lines: circuits A, B, ...
    const [unlockFixed, setUnlockFixed] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const getStatusText = (id) => {
        if (faultNodes.has(id)) return 'FAULTED';
        if (loopNodes && loopNodes.has(id)) return 'IN LOOP';
        
        const feeds = nodeFeeds[id];
        if (!feeds || feeds.size === 0) return 'DE-ENERGIZED';
        
        // corrective plan: the bus stays energized, but part (or all) of the load was shed
        const sh = getNodeShed ? getNodeShed(id) : 0;
        if (sh > 0) return sh >= 0.99 ? 'LOAD SHED' : `SHED ${Math.round(sh * 100)}%`;
        
        return 'ENERGIZED';
    };

    // FILTERING LOGIC
    const term = searchTerm.toLowerCase().trim();

    const matchNode = (id, prefix) => {
        if (!term) return true;
        const textToSearch = `${prefix} ${id}`.toLowerCase();
        return textToSearch.includes(term) || id.toString().includes(term);
    };

    const matchBranch = (branch) => {
        if (!term) return true;
        const letter = groups.get(branch.id)?.letter || '';
        const textToSearch = `line ${branch.from}-${branch.to} ${branch.to}-${branch.from} ${letter}`.toLowerCase();
        return textToSearch.includes(term) || branch.from.toString() === term || branch.to.toString() === term;
    };

    const filteredSources = sources.filter(id => matchNode(id, 'sub'));
    const filteredFeeders = feedersList.filter(id => matchNode(id, 'feeder'));
    const filteredLoads = loadNodes.filter(id => matchNode(id, 'bus'));

    const sorter = (a, b) => {
        const minA = Math.min(a.from, a.to); const minB = Math.min(b.from, b.to);
        if (minA !== minB) return minA - minB;
        return Math.max(a.from, a.to) - Math.max(b.from, b.to);
    };

    const filteredSwitchable = branches.filter(b => b.hasSwitch && matchBranch(b)).sort(sorter);
    const filteredFixed = branches.filter(b => !b.hasSwitch && matchBranch(b)).sort(sorter);

    const hasNoResults = filteredSources.length === 0 && filteredFeeders.length === 0 && 
                         filteredLoads.length === 0 && filteredSwitchable.length === 0 && filteredFixed.length === 0;

    // The 'flex: 1' property is what defines the text space. 
    // We set a 'maxWidth' to make sure it does not push the button.
    const itemContainerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: '4px' };
    const labelStyle = { fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, maxWidth: '100px', fontWeight: '500' };

    // Logic to suppress the text: if the ID is long (>= 4 digits) or the line is complex, the prefix is dropped
    const formatName = (prefix, id) => {
        const str = String(id);
        return str.length >= 4 ? str : `${prefix} ${str}`;
    };

    return (
        <div className={`right-sidebar ${isFaultSidebarOpen ? 'open' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
             
             {/* ================= FIXED HEADER WITH SEARCH ================= */}
             <div style={{padding:'15px', borderBottom:'1px solid var(--border-color)', flexShrink:0, background: 'var(--bg-color)', zIndex: 10 }}>
                <h2 style={{fontSize:'16px', margin:'0 0 12px 0'}}>Element Directory</h2>
                
                <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '14px' }}>🔍</span>
                    <input 
                        type="text" 
                        placeholder="Search bus, line or sub..." 
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
             
             {/* ================= SINGLE SCROLL FOR THE LISTS ================= */}
             <div className="fault-list custom-scrollbar" style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                
                {hasNoResults && (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--eng-gray)', fontSize: '13px' }}>
                        No element found for "<b>{searchTerm}</b>".
                    </div>
                )}

                {/* --- SUBSTATIONS --- */}
                {filteredSources.length > 0 && (
                    <>
                        <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', marginBottom:'6px', marginTop:'4px', letterSpacing: '0.5px'}}>MAIN SUBSTATIONS</div>
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

                {/* --- FEEDERS --- */}
                {filteredFeeders.length > 0 && (
                    <>
                        <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', margin:'15px 0 6px 0', letterSpacing: '0.5px'}}>FEEDERS</div>
                        {filteredFeeders.map(id => (
                            <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                                onClick={() => setSelectedElement({ type: 'node', id: id })}
                                onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                                onMouseLeave={() => { setHoveredNodeId(null); }}
                                style={itemContainerStyle}>
                                <span style={labelStyle}>{formatName('Feeder', id)}</span>
                                <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                        style={{ background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white', minWidth: '105px', flexShrink: 0, padding: '4px 6px', fontSize: '11px' }} 
                                        onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                                    {getStatusText(id)}
                                </button>
                            </div>
                        ))}
                    </>
                )}
                
                {/* --- LOAD BUSES --- */}
                {filteredLoads.length > 0 && (
                    <>
                        <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', margin:'15px 0 6px 0', letterSpacing: '0.5px'}}>LOAD BUSES</div>
                        {filteredLoads.map(id => (
                            <div key={id} className={`fault-item ${selectedElement?.id === id ? 'selected' : ''}`}
                                onClick={() => setSelectedElement({ type: 'node', id: id })}
                                onMouseEnter={() => { setHoveredNodeId(id); setSelectedElement({ type: 'node', id: id }); }} 
                                onMouseLeave={() => { setHoveredNodeId(null); }}
                                style={itemContainerStyle}>
                                <span style={labelStyle}>{formatName('Bus', id)}</span>
                                <button className={`fault-btn-rect ${faultNodes.has(id)?'is-fault':''}`} 
                                        style={{ ...((getNodeShed ? getNodeShed(id) : 0) > 0 && !faultNodes.has(id) ? { background: 'transparent', color: getNodeColor(id), border: `2px dashed ${getNodeColor(id)}` } : { background: faultNodes.has(id) ? '' : getNodeColor(id), color: faultNodes.has(id) || getNodeColor(id) !== (darkMode ? THEME.dark.de : THEME.light.de) ? 'black' : 'white' }), minWidth: '105px', flexShrink: 0, padding: '4px 6px', fontSize: '11px' }} 
                                        onClick={(e) => { e.stopPropagation(); toggleFault(id); }}>
                                    {getStatusText(id)}
                                </button>
                            </div>
                        ))}
                    </>
                )}

                {/* ================= SOFT DIVIDER ================= */}
                {(filteredSources.length > 0 || filteredFeeders.length > 0 || filteredLoads.length > 0) && (filteredSwitchable.length > 0 || filteredFixed.length > 0) && (
                    <div style={{ borderTop: `1px solid ${darkMode ? '#333' : '#ddd'}`, margin: '20px 0 15px 0' }}></div>
                )}

                {/* --- SWITCHES AND LINES --- */}
                {(filteredSwitchable.length > 0 || filteredFixed.length > 0) && (
                    <div style={{fontSize:'11px', fontWeight:'bold', color:'var(--eng-gray)', marginBottom:'6px', letterSpacing: '0.5px'}}>SWITCHES AND LINES</div>
                )}

                {(() => {
                    const renderItem = (branch, isFixedType) => {
                        const nodeColor = getNodeColor ? getNodeColor(branch.from) : '#4caf50';
                        const isOn = branch.state === 1;
                        const byFault = !!branch.openByFault;                    // open because a bus connected to it is faulted: it cannot be closed from here
                        const canClick = (!isFixedType || unlockFixed) && !byFault; 
                        const isSelected = selectedElement?.type === 'edge' && selectedElement?.data?.id === branch.id;

                        // 👇 NEW LINE NAME LOGIC 👇
                        const circuit = groups.get(branch.id);
                        const lineStr = `${Math.min(branch.from, branch.to)}-${Math.max(branch.from, branch.to)}${circuit ? ` ${circuit.letter}` : ''}`;
                        // If the number string is long (e.g. "101-102" has 7 chars), the word "Line" is hidden
                        const displayLabel = lineStr.length >= 7 ? lineStr : `Line ${lineStr}`;

                        return (
                            <div key={branch.id} className={`fault-item ${isSelected ? 'selected' : ''}`} 
                                 onClick={() => setSelectedElement({ type: 'edge', data: branch })}
                                 onMouseEnter={() => { setSelectedElement({ type: 'edge', data: branch }); setHoveredLineId(branch.id); }} 
                                 onMouseLeave={() => setHoveredLineId(null)}
                                 style={itemContainerStyle}>
                                 
                                {/* 👇 The title shows the full tooltip on mouse hover 👇 */}
                                <span style={labelStyle} title={`Line ${lineStr}`}>{displayLabel}</span>
                                
                                <button 
                                    className={`fault-btn-rect`} 
                                    title={byFault ? 'Opened by a fault at a bus connected to it' : undefined}
                                    onClick={(e) => { e.stopPropagation(); if (canClick) toggleSwitch(branch.id); }}
                                    style={{
                                        background: canClick ? (isOn ? nodeColor : (darkMode ? '#333' : '#eee')) : 'transparent', 
                                        color: canClick ? (isOn ? '#000' : (darkMode ? '#aaa' : '#666')) : '#999',
                                        border: canClick ? 'none' : '1px solid #555', cursor: canClick ? 'pointer' : 'default', opacity: canClick ? 1 : 0.6,
                                        minWidth: '85px', flexShrink: 0, padding: '4px 6px', fontSize: '11px', fontWeight: 'bold' // Adjusted for CLOSED/OPEN
                                    }}
                                >
                                    {/* 👇 THE STATUS TEXT 👇 */}
                                    {byFault ? 'OPEN' : (!canClick ? 'FIXED' : (isOn ? 'CLOSED' : 'OPEN'))}
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
                                        {unlockFixed ? '🔒 Lock Fixed Buses' : '🔓 Enable Switching (Fixed)'}
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