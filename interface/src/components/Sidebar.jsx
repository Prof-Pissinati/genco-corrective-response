import React from 'react';
import { parallelGroups } from '../utils/parallel';
import { voltageLevel, formatVoltage } from '../utils/voltage';
import { isOverloaded } from '../utils/loading';

// Function to convert power quantities automatically
const formatPower = (kw, isMini = false) => {
    if (kw >= 1000000) return (kw / 1000000).toFixed(1) + (isMini ? 'G' : ' GW');
    if (kw >= 1000) return (kw / 1000).toFixed(1) + (isMini ? 'M' : ' MW');
    return kw.toFixed(0) + (isMini ? 'k' : ' kW');
};

/** Small caption above a selector. */
function SelectorCaption({ children, muted, show }) {
    if (!show) return <div style={{ height: 4 }} />;
    return <div style={{ fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', color: muted, margin: '6px 2px 2px', fontWeight: 'bold' }}>{children}</div>;
}

/** Text-only segmented control (one option active). options: [{ key, label, color, active, dim, title }]. */
function Segmented({ options, onPick, testId, vertical = false, darkMode }) {
    return (
        <div data-testid={testId} role="group" style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', border: `1.5px solid ${darkMode ? '#4a4a52' : '#bbb'}`, borderRadius: 8, overflow: 'hidden' }}>
            {options.map((o, i) => (
                <button key={o.key} data-testid={`${testId}-${o.key}`} aria-pressed={o.active} title={o.title} onClick={() => onPick(o.key)}
                    style={{ flex: 1, minWidth: 0, padding: '6px 2px', fontSize: 12, cursor: 'pointer', border: 'none', borderLeft: !vertical && i > 0 ? `1px solid ${darkMode ? '#4a4a52' : '#bbb'}` : 'none', borderTop: vertical && i > 0 ? `1px solid ${darkMode ? '#4a4a52' : '#bbb'}` : 'none',
                        background: o.active ? o.color : 'transparent', color: o.active ? '#fff' : o.color, fontWeight: o.active ? 'bold' : 'normal', opacity: o.dim && !o.active ? 0.5 : 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip' }}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export default function Sidebar({
    sidebarMode,
    darkMode,
    setDarkMode,
    resetSystem,
    onResetLayout = null,
    calcMethod = 'NR',
    setCalcMethod = () => console.warn("setCalcMethod function not connected!"),
    onExportPDF = () => console.warn("onExportPDF function not connected!"),
    showLabels,
    setShowLabels,
    selectedElement,
    sources,
    loads,
    faultNodes,
    disconnectedStats,
    branches,
    getNodeColor,
    systemSize,
    lineCurrents,
    feedersList = [],
    nodeData,
    shedBuses = null,
    transmission = null,
    solverTitle = '',
    solverMode = 'ac',
    onSolverMode = () => {},
    acOffline = false,
    gencoAvailable = false,
    gencoNote = '',
    nodeColorMode = 'state',
    setNodeColorMode = () => {},
    voltageAvailable = false,
    systemLoads,
    systemShunts,
    vBase,
    sBase,
    sses,
    handleTapChange,
    handleShuntChange,
    viewMode,
    setViewMode,
    systemGD,
    toggleGD,
    handleGDChange
}) {
    const isMini = sidebarMode !== 'full';
    const sbGroups = parallelGroups(branches);
    const circuitOf = (b) => (sbGroups.get(b.id) ? ` ${sbGroups.get(b.id).letter}` : '');   // circuit A/B of the parallel lines // 👈 Variable that identifies the compact state (not full)

    const getVoltage = (id) => {
        if (!nodeData || !nodeData[id]) return { v: 0, angle: 0 };
        return nodeData[id];
    };

    const getLoadColor = (percentage) => {
        const p = Math.max(0, Math.min(100, percentage));
        const hue = ((100 - p) * 1.2).toFixed(0); 
        return `hsl(${hue}, 100%, 40%)`;
    };

    return (
        <div className={`sidebar ${sidebarMode}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            
            {/* FIXED, ADAPTIVE HEADER */}
            <div className="sidebar-header" style={{ flexShrink: 0 }}>
                {!isMini && (
                <h1 style={{ marginTop: '-10px', marginBottom: '10px', fontSize: isMini ? '16px' : '24px', textAlign: 'center' }}>
                    {`⚡Sys. ${systemSize} Buses`}
                </h1>
                )}
                

                {/* Actions (2 columns; 1 column in mini mode) and the two selectors: calculation method and bus color */}
                <div style={{ display: 'grid', gridTemplateColumns: isMini ? '1fr' : '1fr 1fr', gap: isMini ? '4px' : '4px', marginBottom: '6px' }}>
                    <button className="sidebar-action-btn" style={{ '--btn-color': darkMode ? '#aaaaaa' : '#555555' }} onClick={() => setDarkMode(!darkMode)} title="Toggle between the dark and the light theme">
                        {darkMode ? '☀' : '☾'}{!isMini && ' Theme'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#FFC107' }} onClick={onExportPDF} title="Export the diagram to PDF">
                        ⤓{!isMini && ' PDF'}
                    </button>
                    <button className="sidebar-action-btn" style={{ '--btn-color': '#4caf50' }} onClick={resetSystem} title="Restart the system: remove the faults and close the switches">
                        ↺{!isMini && ' Reset'}
                    </button>
                    {onResetLayout && <button className="sidebar-action-btn" style={{ '--btn-color': '#ab47bc' }} onClick={onResetLayout} title="Restore the position and size of the floating panels (Corrective response, Screening, Repair)">
                        ⧉{!isMini && ' Panels'}
                    </button>}
                    <button className="sidebar-action-btn" aria-pressed={showLabels} style={{ '--btn-color': '#9e9e9e', gridColumn: isMini ? undefined : '1 / -1', outline: showLabels ? '1px solid #9e9e9e' : 'none' }} onClick={() => setShowLabels(!showLabels)} title="Show or hide the labels of the buses and lines">
                        Aa{!isMini && (showLabels ? ' Labels: on' : ' Labels: off')}
                    </button>
                    {!transmission && <button className="sidebar-action-btn" style={{ '--btn-color': calcMethod === 'NR' ? '#ff6d00' : '#2979ff', gridColumn: '1 / -1' }} onClick={() => setCalcMethod(calcMethod === 'NR' ? 'GS' : 'NR')} title={solverTitle || `Click to switch. Current: ${calcMethod}`}>
                        {calcMethod === 'NR' ? '⚡' : '〰'}{!isMini && ` ${calcMethod}`}
                    </button>}
                    {!transmission && <button className="sidebar-action-btn" style={{ '--btn-color': viewMode === 'schematic' ? '#e91e63' : '#00bcd4', gridColumn: '1 / -1' }} onClick={() => setViewMode(viewMode === 'schematic' ? 'map' : 'schematic')} title="Toggle View">
                        {viewMode === 'schematic' ? '🗺' : '▦'}{!isMini && (viewMode === 'schematic' ? ' View Map' : ' Diagram')}
                    </button>}
                </div>
                {transmission && (
                    <>
                        <SelectorCaption muted={darkMode ? '#8a8a8a' : '#777'} show={!isMini}>Calculation</SelectorCaption>
                        <Segmented testId="solver-selector" vertical={isMini} onPick={onSolverMode} darkMode={darkMode} options={[
                            { key: 'dc', label: 'DC', color: '#2979ff', active: solverMode === 'dc', title: 'Local DC power flow (JavaScript): instant, no backend, no losses.' },
                            { key: 'ac', label: acOffline && solverMode === 'ac' ? 'AC*' : 'AC', color: '#00c853', active: solverMode === 'ac', title: acOffline ? `Backend unavailable (${solverTitle || 'offline'}): showing the local DC. Click to retry.` : 'Exact AC power flow (backend; precomputed in the static demo for the intact network and for single-line outages).' },
                            { key: 'genco', label: 'GENCO', color: '#7e57c2', active: solverMode === 'genco', dim: !gencoAvailable, title: gencoNote || 'GENCO estimate (precomputed).' },
                        ]} />
                        <SelectorCaption muted={darkMode ? '#8a8a8a' : '#777'} show={!isMini}>Bus color</SelectorCaption>
                        <Segmented testId="color-selector" vertical={isMini} onPick={(k) => (k === 'voltage' ? voltageAvailable && setNodeColorMode('voltage') : setNodeColorMode('state'))} darkMode={darkMode} options={[
                            { key: 'state', label: 'State', color: '#2166ac', active: !(nodeColorMode === 'voltage' && voltageAvailable), title: 'Color the buses by their state (energized, faulted, load shed, generator redispatched).' },
                            { key: 'voltage', label: 'Voltage', color: '#b2182b', active: nodeColorMode === 'voltage' && voltageAvailable, dim: !voltageAvailable, title: voltageAvailable ? 'Color the buses by their voltage (blue = low, red = high).' : 'Coloring by voltage needs the AC (or the GENCO view): pick AC or GENCO above.' },
                        ]} />
                    </>
                )}
            </div>

            {/* LOAD PANEL (Summary) */}
            <div className="load-display custom-scrollbar" style={{ flexShrink: 0, marginTop: '0px', maxHeight: isMini ? 'none' : '320px', overflowY: 'auto', paddingBottom: '5px', display: isMini ? 'flex' : 'grid', flexDirection: isMini ? 'column' : 'row' }}> 
                {(() => {
                    const renderLoadCard = (subId, isFeeder) => {
                        let totalP = 0; let totalQ = 0;
                        if (lineCurrents) {
                            if (!isFeeder) {
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === subId || b.to === subId) {
                                            totalP += Math.abs(lineCurrents[b.id].pFlow);
                                            totalQ += Math.abs(lineCurrents[b.id].qFlow);
                                        }
                                    }
                                });
                            } else {
                                let sumP = 0, sumQ = 0;
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === subId || b.to === subId) {
                                            sumP += Math.abs(lineCurrents[b.id].pFlow); sumQ += Math.abs(lineCurrents[b.id].qFlow);
                                        }
                                    }
                                });
                                totalP = sumP / 2; totalQ = sumQ / 2;
                            }
                        }

                        const currentVBase = vBase || 13.8; 
                        const S = Math.sqrt((totalP)**2 + (totalQ)**2);
                        const I = S / (Math.sqrt(3) * currentVBase);
                        const inFault = faultNodes.has(subId);
                        const cardColor = getNodeColor ? getNodeColor(subId) : 'var(--eng-orange)';
                        
                        const nodeCount = loads[subId]?.nodes || 0;

                        return (
                            <div key={subId} className={`load-card lc-${subId}`} style={{ borderTop: `4px solid ${cardColor}` }} title={`${isFeeder ? 'FEEDER' : 'SUB'} ${subId}`}>
                                <div className="load-card-title" style={{ color: cardColor, fontSize: isMini ? '9px' : '10px' }}>
                                    {isMini ? `S${subId}` : (isFeeder ? `FEEDER ${subId}` : `SUB ${subId}`)}
                                </div>
                                <span className="load-card-value" style={{ fontSize: isMini ? '12px' : '16px' }}>{inFault ? '—' : formatPower(totalP, isMini)}</span>
                                
                                <div className="load-card-subtitle" style={{ fontSize: isMini ? '9px' : '10px' }}>
                                    {inFault ? '—' : (isMini ? `${nodeCount} bus` : (transmission ? 'reference bus' : `${I.toFixed(0)} A`))}
                                </div>
                                
                                {!isMini && (
                                    <div className="load-card-subtitle">
                                        {inFault ? '—' : `${nodeCount} buses`}
                                    </div>
                                )}
                            </div>
                        );
                    };

                    return (
                        <>
                            {sources.map(id => renderLoadCard(id, false))}
                            {disconnectedStats && (
                                <div key="200" className="load-card" style={{ borderTop: '4px solid #757575', opacity: disconnectedStats.count > 0 ? 1 : 0.4, transition: 'opacity 0.3s ease' }} title="Disconnected Substation">
                                    <div className="load-card-title" style={{ color: '#757575', fontSize: isMini ? '9px' : '10px' }}>{isMini ? 'OFF' : 'SUB (Off)'}</div>
                                    <span className="load-card-value" style={{ fontSize: isMini ? '12px' : '16px' }}>{formatPower(disconnectedStats.p, isMini)}</span>
                                    <div className="load-card-subtitle" style={{ fontSize: isMini ? '9px' : '10px' }}>{isMini ? `${disconnectedStats.count} bus` : (transmission ? `${disconnectedStats.count} buses` : `${disconnectedStats.current.toFixed(0)} A`)}</div>
                                    {!isMini && !transmission && <div className="load-card-subtitle">{disconnectedStats.count} buses</div>}
                                </div>
                            )}
                            {feedersList.map(id => renderLoadCard(id, true))}
                        </>
                    );
                })()}
            </div>

            {/* STATISTICS */}
            <div className="stats-panel" style={{ flexShrink: 0, padding: isMini ? '5px' : '15px' }}>
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: isMini ? '1fr' : 'repeat(3, 1fr)', gap: isMini ? '4px' : '10px' }}>
                    <div className="stat-item" style={{ padding: isMini ? '4px' : '10px' }}>
                        <div className="stat-label" style={{ fontSize: isMini ? '9px' : '11px' }}>{isMini ? 'CLOSED' : 'Closed Lines'}</div>
                        <div className="stat-value good" style={{ fontSize: isMini ? '14px' : '18px' }}>{branches.filter(b => b.state === 1).length}</div>
                    </div>
                    <div className="stat-item" style={{ padding: isMini ? '4px' : '10px' }}>
                        <div className="stat-label" style={{ fontSize: isMini ? '9px' : '11px' }}>{isMini ? 'OPEN' : 'Open Lines'}</div>
                        <div className="stat-value" style={{ fontSize: isMini ? '14px' : '18px' }}>{branches.filter(b => b.state === 0).length}</div>
                    </div>
                    <div className="stat-item" style={{ padding: isMini ? '4px' : '10px' }}>
                        <div className="stat-label" style={{ fontSize: isMini ? '9px' : '11px' }}>{isMini ? 'FAULTS' : 'Active Faults'}</div>
                        <div className={`stat-value ${faultNodes.size > 0 ? 'bad' : ''}`} style={{ fontSize: isMini ? '14px' : '18px' }}>{faultNodes.size}</div>
                    </div>
                </div>
            </div>

            {/* ================= INSPECTOR (Hidden in mini mode via CSS) ================= */}
            <div className="inspector custom-scrollbar" style={{ flex: 1, minHeight: '300px', background: 'transparent', padding: isMini ? '15px 5px' : '20px 25px', overflowY: 'auto', display: 'flex', flexDirection: 'column', borderTop: `1px solid ${darkMode ? '#333' : '#ddd'}` }}>
                {selectedElement ? (
                    selectedElement.type === 'node' ? (
                    (() => {
                        const { v, angle } = getVoltage(selectedElement.id);
                        const vLim = transmission ? transmission.buses[selectedElement.id] || null : null;      // bus voltage range (transmission)
                        const puVal = formatVoltage(v, !!transmission);
                        const vLevel = voltageLevel(v, vLim);
                        const vColor = vLevel === 'bad' ? '#d50000' : (vLevel === 'warn' ? '#ffd600' : '#4caf50');
                        const isMainSource = sources.includes(selectedElement.id);
                        const isFeeder = feedersList.includes(selectedElement.id);
                        const isSource = isMainSource || isFeeder; 
                        
                        let totalP = 0, totalQ = 0, totalS = 0;
                        if (isSource && lineCurrents) {
                            if (isMainSource) {
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === selectedElement.id || b.to === selectedElement.id) {
                                            totalP += Math.abs(lineCurrents[b.id].pFlow);
                                            totalQ += Math.abs(lineCurrents[b.id].qFlow);
                                        }
                                    }
                                });
                            } else if (isFeeder) {
                                let sumP = 0, sumQ = 0;
                                branches.forEach(b => {
                                    if (b.state === 1 && lineCurrents[b.id]) {
                                        if (b.from === selectedElement.id || b.to === selectedElement.id) { sumP += Math.abs(lineCurrents[b.id].pFlow); sumQ += Math.abs(lineCurrents[b.id].qFlow); }
                                    }
                                });
                                totalP = sumP / 2; totalQ = sumQ / 2;
                            }
                            totalS = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
                        }

                        let sLimit = 1000, loadingPercent = 0, loadColor = vColor;
                        if (isSource) {
                            sLimit = (sses && sses[selectedElement.id]) ? sses[selectedElement.id] : 1000;
                            loadingPercent = (totalS / sLimit) * 100;
                            loadColor = loadingPercent > 100 ? '#d50000' : (loadingPercent > 75 ? '#ff9800' : '#4caf50');
                        }

                        const titleColor = isMainSource ? '#00bcd4' : (isFeeder ? '#4caf50' : '#ff9800');
                        
                        // 👇 MINI INSPECTOR FOR BUSES (WITH VERTICAL GAUGES) 👇
                        if (isMini) return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center', width: '100%' }}>
                                {/* TITLE */}
                                <div style={{ color: titleColor, fontSize: '11px', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>
                                    {isMainSource ? 'SUB' : (isFeeder ? 'FEEDER' : 'BUS')}<br/>
                                    <span style={{ fontSize: '15px', color: darkMode ? '#fff' : '#000' }}>{selectedElement.id}</span>
                                </div>

                                {/* VERTICAL BARS CONTAINER */}
                                <div style={{ display: 'flex', flexDirection: 'row', gap: '15px', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                                    
                                    {/* COLUMN 1: VOLTAGE */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ fontSize: '11px', fontWeight: 'bold', color: vColor }}>{puVal}</div>
                                        <div style={{ position: 'relative', height: '70px', width: '8px', background: darkMode ? '#333' : '#ddd', borderRadius: '4px' }}>
                                            <div style={{ position: 'absolute', bottom: '25%', height: '50%', width: '100%', background: darkMode ? 'rgba(76, 175, 80, 0.2)' : 'rgba(76, 175, 80, 0.3)' }}></div>
                                            <div style={{ position: 'absolute', bottom: '50%', width: '10px', left: '-1px', height: '1px', background: darkMode ? '#666' : '#999' }}></div>
                                            <div style={{ position: 'absolute', bottom: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, left: '-3px', right: '-3px', height: '4px', background: vColor, borderRadius: '2px', transform: 'translateY(50%)', transition: 'bottom 0.4s' }}></div>
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#888', fontWeight: 'bold' }}>V (pu)</div>
                                    </div>

                                    {/* COLUMN 2: LOADING (Sources only) */}
                                    {isSource && (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: loadColor }}>{loadingPercent.toFixed(0)}%</div>
                                            <div style={{ position: 'relative', height: '70px', width: '12px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '6px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, overflow: 'hidden' }}>
                                                <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.min(loadingPercent, 100)}%`, background: loadColor, transition: 'height 0.4s' }}></div>
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#888', fontWeight: 'bold' }}>LOAD</div>
                                        </div>
                                    )}

                                    {/* COLUMN 3: SHUNT BANK (If it exists) */}
                                    {systemShunts && systemShunts[selectedElement.id] && (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#00bcd4' }}>{systemShunts[selectedElement.id].steps}</div>
                                            <input 
                                                type="range" min="0" max={systemShunts[selectedElement.id].maxSteps} step="1" 
                                                value={systemShunts[selectedElement.id].steps}
                                                onChange={(e) => {
                                                    const newVal = parseInt(e.target.value);
                                                    if(handleShuntChange) handleShuntChange(selectedElement.id, newVal - systemShunts[selectedElement.id].steps);
                                                }}
                                                style={{ WebkitAppearance: 'slider-vertical', width: '12px', height: '70px', accentColor: '#00bcd4', cursor: 'pointer', margin: 0 }}
                                            />
                                            <div style={{ fontSize: '9px', color: '#00bcd4', fontWeight: 'bold' }}>BC</div>
                                        </div>
                                    )}
                                
                                
                                {/* DG — toggle + compact Pg */}
                                {systemGD && systemGD[selectedElement.id] && (() => {
                                    const gd = systemGD[selectedElement.id];
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                                            {/* clickable status dot */}
                                            <div
                                                onClick={() => toggleGD(selectedElement.id)}
                                                title={gd.active ? 'Deactivate DG' : 'Activate DG'}
                                                style={{
                                                    width: '20px', height: '20px', borderRadius: '50%',
                                                    background: gd.active ? 'rgba(255,193,7,0.2)' : 'transparent',
                                                    border: `2px solid ${gd.active ? '#ffc107' : (darkMode ? '#555' : '#ccc')}`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                                                }}
                                            >
                                                <span style={{ fontSize: '10px', lineHeight: 1 }}>⚡</span>
                                            </div>
                                            {/* Compact Pg */}
                                            <div style={{ fontSize: '10px', fontWeight: 'bold', color: gd.active ? '#ffd700' : (darkMode ? '#555' : '#bbb'), fontFamily: 'monospace', textAlign: 'center', lineHeight: 1 }}>
                                                {gd.active ? `${gd.pg.toFixed(0)}k` : 'OFF'}
                                            </div>
                                            <div style={{ fontSize: '8px', color: '#888', fontWeight: 'bold' }}>DG</div>
                                        </div>
                                    );
                                })()}

                                </div>

                                {/* FOOTER: ANGLE */}
                                <div style={{ fontSize: '10px', color: '#888', fontFamily: 'monospace', marginTop: '-5px' }}>θ: {angle.toFixed(1)}°</div>
                            </div>
                        );
                        // 👆 END OF INJECTION 👆
                        
                        return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {/* 1. TITLE */}
                                <div className="inspector-title" style={{ fontSize: '18px', margin: -5, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{isMainSource ? 'Substation' : (isFeeder ? 'Feeder' : 'Bus')}</span>
                                    <span>{selectedElement.id}</span>
                                </div>

                                {/* 2. MAIN CHART (Loading or Voltage) */}
                                <div style={{ paddingBottom: isSource ? '0px' : '20px', borderBottom: isSource ? `1px dashed ${darkMode ? '#444' : '#ccc'}` : `1px dashed ${darkMode ? '#555' : '#ddd'}` }}>
                                    {isSource ? (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                                                <span style={{ color: darkMode ? '#aaa' : '#666' }}>Loading</span>
                                                <b style={{ color: loadColor }}>{loadingPercent.toFixed(1)}%</b>
                                            </div>
                                            <div style={{ height: '22px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '11px', overflow: 'hidden', border: `1px solid ${darkMode ? '#444' : '#ccc'}` }}>
                                                <div style={{ width: `${Math.min(loadingPercent, 100)}%`, height: '100%', background: loadColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#000', fontWeight: 'bold', transition: 'width 0.4s ease, background 0.4s ease' }}>
                                                    {loadingPercent > 15 ? `${loadingPercent.toFixed(1)}%` : ''}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'center', fontSize: '12px', marginTop: '8px', color: loadingPercent >= 100 ? '#d50000' : (loadingPercent > 80 ? '#ff9800' : (darkMode ? '#aaa' : '#666')), fontWeight: loadingPercent > 80 ? 'bold' : 'normal' }}>
                                                {loadingPercent >= 100 ? '⚠️ OVERLOAD' : (loadingPercent > 80 ? 'High Load' : 'Normal Operation')}
                                            </div>
                                            <div className="inspector-row" style={{ marginTop: '8px', borderTop: '1px dashed #444', paddingTop: '8px' }}>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(V)</span>
                                                <span style={{ fontSize: '15px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>{puVal} pu</span>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(θ)</span>
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', color: darkMode ? '#ccc' : '#444', fontFamily: 'monospace' }}>{angle.toFixed(2)}°</span>
                                            </div>
                                            </>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: '#888',marginTop: '4px', marginBottom: '4px', fontFamily: 'monospace' }}><span>0.90</span><span>1.00</span><span>1.10</span></div>
                                            <div style={{ position: 'relative', height: '4px', background: darkMode ? '#333' : '#e0e0e0', borderRadius: '2px' }}>
                                                <div style={{ position: 'absolute', left: '25%', width: '50%', height: '100%', background: darkMode ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.25)', borderRadius: '2px' }}></div>
                                                <div style={{ position: 'absolute', left: '50%', top: '-3px', bottom: '-3px', width: '1px', background: darkMode ? '#666' : '#999' }}></div>
                                                <div style={{ position: 'absolute', top: '-5px', bottom: '-5px', left: `${Math.max(0, Math.min(100, ((v - 0.90) / 0.20) * 100))}%`, width: '4px', background: vColor, borderRadius: '2px', transform: 'translateX(-50%)', transition: 'left 0.4s cubic-bezier(0.25, 1, 0.5, 1), background 0.4s ease'}}></div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(V)</span>
                                                <span style={{ fontSize: '15px', fontWeight: 'bold', color: vColor, fontFamily: 'monospace' }}>{puVal} pu</span>
                                                <span style={{ fontSize: '13px', color: darkMode ? '#aaa' : '#666' }}>(θ)</span>
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', color: darkMode ? '#ccc' : '#444', fontFamily: 'monospace' }}>{angle.toFixed(2)}°</span>
                                            </div>
                                            </>
                                    )}
                                </div>

                                {/* 3. CONTROLS (Shunt Capacitor) */}
                                {systemShunts && systemShunts[selectedElement.id] && (
                                    (() => {
                                        const shunt = systemShunts[selectedElement.id];
                                        const maxKvar = shunt.maxSteps * shunt.stepSize;
                                        const curKvar = shunt.steps * shunt.stepSize;
                                        
                                        return (
                                            <div style={{ paddingBottom: '10px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', whiteSpace: 'nowrap' }}>Shunt Bank</span>
                                                    <b style={{ color: '#00bcd4', fontSize: '13px' }}>{curKvar} <span style={{fontSize: '10px', color: '#888'}}>/ {maxKvar} kVAr</span></b>
                                                </div>
                                                
                                                <input type="range" min="0" max={shunt.maxSteps} step="1" value={shunt.steps}
                                                    onChange={(e) => {
                                                        const newVal = parseInt(e.target.value);
                                                        const diff = newVal - shunt.steps;
                                                        if(handleShuntChange) handleShuntChange(selectedElement.id, diff);
                                                    }}
                                                    style={{ width: '100%', accentColor: '#00bcd4', cursor: 'pointer', height: '4px', background: darkMode ? '#333' : '#ddd', borderRadius: '2px', appearance: 'auto' }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: darkMode ? '#777' : '#999', marginTop: '4px' }}>
                                                    <span>0</span><span>Step {shunt.steps}</span><span>{shunt.maxSteps}</span>
                                                </div>
                                            </div>
                                        );
                                    })()
                                )}

                                {/* 3.5 CONTROLS (Distributed Generation) */}
                                {systemGD && systemGD[selectedElement.id] && (() => {
                                    const gd = systemGD[selectedElement.id];
                                    const sMax = gd.sMax || 1000;

                                    // Correct physical limits:
                                    // Qg_max = sqrt(Smax² - Pg²)  — capacity ellipse
                                    const qMaxPhysical = Math.sqrt(Math.max(0, sMax * sMax - gd.pg * gd.pg));
                                    // Pg_max = min(Smax, Smax) — without Q it could go up to Smax
                                    // but we limit by the minimum PF: Pg_min_fp = |S| * fpMin
                                    const fpMin = gd.fpMin || 0;

                                    // Current apparent power and current PF
                                    const sAtual = Math.sqrt(gd.pg * gd.pg + gd.qg * gd.qg);
                                    const fpAtual = sAtual > 0 ? gd.pg / sAtual : 1;
                                    const fpViolation = fpMin > 0 && fpAtual < fpMin - 0.001;

                                    // PF color: green ok, yellow near the limit, red violation
                                    const fpColor = fpViolation ? '#f44336' : (fpAtual < fpMin + 0.02 ? '#ff9800' : '#4caf50');

                                    // Percentage of Smax in use (capacity semicircle)
                                    const sUsoPct = Math.min(100, (sAtual / sMax) * 100);
                                    const sUsoColor = sUsoPct > 95 ? '#f44336' : (sUsoPct > 80 ? '#ff9800' : '#ffd700');

                                    return (
                                        <div style={{
                                            borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}`,
                                            marginTop: '4px',
                                            paddingBottom: '14px',
                                        }}>
                                            {/* HEADER WITH TOGGLE */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#b8860b', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                    ⚡ GD
                                                </span>
                                                {/* Toggle pill */}
                                                <div
                                                    onClick={() => toggleGD(selectedElement.id)}
                                                    title={gd.active ? 'Click to deactivate the DG' : 'Click to activate the DG'}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '5px',
                                                        background: gd.active ? 'rgba(255,193,7,0.15)' : (darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                                                        border: `1px solid ${gd.active ? '#ffc107' : (darkMode ? '#555' : '#ccc')}`,
                                                        borderRadius: '20px', padding: '3px 10px 3px 7px',
                                                        cursor: 'pointer', transition: 'all 0.2s',
                                                        userSelect: 'none',
                                                    }}
                                                >
                                                    {/* status dot */}
                                                    <div style={{
                                                        width: '7px', height: '7px', borderRadius: '50%',
                                                        background: gd.active ? '#ffc107' : (darkMode ? '#555' : '#bbb'),
                                                        boxShadow: gd.active ? '0 0 6px #ffc107' : 'none',
                                                        transition: 'all 0.2s',
                                                        flexShrink: 0,
                                                    }}/>
                                                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: gd.active ? '#ffc107' : (darkMode ? '#666' : '#999') }}>
                                                        {gd.active ? 'ACTIVE' : 'OFF'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* CONTENT (dimmed when deactivated) */}
                                            <div style={{ opacity: gd.active ? 1 : 0.35, pointerEvents: gd.active ? 'all' : 'none', transition: 'opacity 0.25s', display: 'flex', flexDirection: 'column', gap: '12px' }}>

                                                {/* ── ACTIVE POWER (Pg) ── */}
                                                <div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
                                                        <span style={{ fontSize: '11px', color: darkMode ? '#aaa' : '#777' }}>Pg (active)</span>
                                                        {/* Direct numeric input */}
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                                                            <input
                                                                type="number" min="0" max={sMax} step="1"
                                                                value={Math.round(gd.pg)}
                                                                onChange={(e) => {
                                                                    const v = Math.max(0, Math.min(sMax, parseFloat(e.target.value) || 0));
                                                                    handleGDChange(selectedElement.id, 'pg', v - gd.pg);
                                                                }}
                                                                style={{
                                                                    width: '58px', textAlign: 'right',
                                                                    background: 'transparent',
                                                                    border: 'none', borderBottom: `1px solid ${darkMode ? '#555' : '#ccc'}`,
                                                                    color: '#ffd700', fontSize: '14px', fontWeight: 'bold',
                                                                    fontFamily: 'monospace', outline: 'none', padding: '0 2px',
                                                                }}
                                                            />
                                                            <span style={{ fontSize: '10px', color: '#888' }}>kW</span>
                                                        </div>
                                                    </div>
                                                    <input type="range" min="0" max={sMax} step="1"
                                                        value={gd.pg}
                                                        onChange={(e) => {
                                                            const v = parseFloat(e.target.value);
                                                            handleGDChange(selectedElement.id, 'pg', v - gd.pg);
                                                        }}
                                                        style={{ width: '100%', accentColor: '#ffd700', cursor: 'pointer', height: '3px', appearance: 'auto' }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: darkMode ? '#555' : '#bbb', marginTop: '2px' }}>
                                                        <span>0</span><span>{sMax} kW</span>
                                                    </div>
                                                </div>

                                                {/* ── REACTIVE POWER (Qg) ── */}
                                                <div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
                                                        <span style={{ fontSize: '11px', color: darkMode ? '#aaa' : '#777' }}>Qg (reactive)</span>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                                                            <input
                                                                type="number" min={-qMaxPhysical} max={qMaxPhysical} step="1"
                                                                value={Math.round(gd.qg)}
                                                                onChange={(e) => {
                                                                    const v = Math.max(-qMaxPhysical, Math.min(qMaxPhysical, parseFloat(e.target.value) || 0));
                                                                    handleGDChange(selectedElement.id, 'qg', v - gd.qg);
                                                                }}
                                                                style={{
                                                                    width: '58px', textAlign: 'right',
                                                                    background: 'transparent',
                                                                    border: 'none', borderBottom: `1px solid ${darkMode ? '#555' : '#ccc'}`,
                                                                    color: '#ffd700', fontSize: '14px', fontWeight: 'bold',
                                                                    fontFamily: 'monospace', outline: 'none', padding: '0 2px',
                                                                }}
                                                            />
                                                            <span style={{ fontSize: '10px', color: '#888' }}>kVAr</span>
                                                        </div>
                                                    </div>
                                                    <input type="range" min={-qMaxPhysical} max={qMaxPhysical} step="1"
                                                        value={Math.max(-qMaxPhysical, Math.min(qMaxPhysical, gd.qg))}
                                                        onChange={(e) => {
                                                            const v = parseFloat(e.target.value);
                                                            handleGDChange(selectedElement.id, 'qg', v - gd.qg);
                                                        }}
                                                        style={{ width: '100%', accentColor: '#ffd700', cursor: 'pointer', height: '3px', appearance: 'auto' }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: darkMode ? '#555' : '#bbb', marginTop: '2px' }}>
                                                        <span>{-Math.round(qMaxPhysical)}</span><span>0</span><span>+{Math.round(qMaxPhysical)} kVAr</span>
                                                    </div>
                                                </div>

                                                {/* ── CAPACITY BAR (S/Smax) + PF ── */}
                                                <div style={{
                                                    background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                                                    borderRadius: '6px', padding: '8px 10px',
                                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                                }}>
                                                    {/* current S / Smax */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '10px', color: darkMode ? '#888' : '#999' }}>S used</span>
                                                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: sUsoColor, fontFamily: 'monospace' }}>
                                                            {sAtual.toFixed(0)} <span style={{ fontSize: '9px', color: '#888', fontWeight: 'normal' }}>/ {sMax} kVA</span>
                                                        </span>
                                                    </div>
                                                    {/* S progress bar */}
                                                    <div style={{ height: '4px', background: darkMode ? '#333' : '#ddd', borderRadius: '2px', overflow: 'hidden' }}>
                                                        <div style={{ width: `${sUsoPct}%`, height: '100%', background: sUsoColor, transition: 'width 0.3s, background 0.3s', borderRadius: '2px' }} />
                                                    </div>
                                                    {/* current PF */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                                        <span style={{ fontSize: '10px', color: darkMode ? '#888' : '#999' }}>
                                                            Current PF
                                                            {fpMin > 0 && <span style={{ color: darkMode ? '#666' : '#bbb' }}> (min {fpMin.toFixed(2)})</span>}
                                                        </span>
                                                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: fpColor, fontFamily: 'monospace' }}>
                                                            {fpAtual.toFixed(3)}
                                                            {fpViolation && <span style={{ fontSize: '9px', marginLeft: '4px' }}>⚠️</span>}
                                                        </span>
                                                    </div>
                                                </div>

                                            </div>
                                        </div>
                                    );
                                })()}
                                
                                {/* 4. RAW DATA */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <div className="inspector-row"><span>Type:</span><b>{transmission ? (transmission.buses[selectedElement.id]?.type === 3 ? 'Reference (swing)' : (transmission.buses[selectedElement.id]?.type === 2 ? 'Generator (PV)' : (transmission.gens.some(g => g.bus === selectedElement.id && g.status) ? 'Load + generator' : 'Load (PQ)'))) : (isMainSource ? 'Main Substation' : (isFeeder ? 'Feeder' : (systemShunts && systemShunts[selectedElement.id] ? 'Shunt Load' : 'Load')))}</b></div>

                                    {!isSource && systemLoads[selectedElement.id] && (
                                        <>
                                            {(() => {
                                                const sh = shedBuses && shedBuses.get ? shedBuses.get(Number(selectedElement.id)) : null;
                                                const f = sh && sh.pct ? 1 - sh.pct : 1;                       // fraction served in the displayed stage
                                                const L = systemLoads[selectedElement.id];
                                                return (
                                                    <>
                                                        <div className="inspector-row"><span>Load P{sh ? ' (served)' : ''}:</span><b>{transmission ? `${(L.p * f / 1000).toFixed(1)} MW` : `${L.p.toFixed(1)} kW`}</b></div>
                                                        <div className="inspector-row"><span>Load Q{sh ? ' (served)' : ''}:</span><b>{transmission ? `${(L.q * f / 1000).toFixed(1)} MVAr` : `${L.q.toFixed(1)} kVAr`}</b></div>
                                                        {sh && (
                                                            <>
                                                                <div className="inspector-row"><span>Load shed:</span><b style={{ color: '#ffb74d' }}>✂ {sh.mw.toFixed(1)} MW ({Math.round(sh.pct * 100)}%)</b></div>
                                                                <div className="inspector-row"><span>State:</span><b>Energized, {sh.pct >= 0.99 ? 'no load' : 'reduced load'}</b></div>
                                                            </>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </>
                                    )}

                                    {transmission && (() => {
                                        const id = selectedElement.id;
                                        const gens = transmission.gens.filter(g => g.bus === id && g.status);
                                        const tb = transmission.buses[id];
                                        const energizada = !!(nodeData && nodeData[id]);
                                        const sum = (k) => gens.reduce((s, g) => s + (g[k] || 0), 0);
                                        return (
                                            <>
                                                {gens.length > 0 && (
                                                    <>
                                                        <div className="inspector-row"><span>Generation P (dispatch):</span><b>{energizada ? `${(nodeData[id].pg !== undefined ? nodeData[id].pg : sum('pg')).toFixed(1)} MW` : '0 MW (out of service)'}</b></div>
                                                        {energizada && nodeData[id].pg !== undefined && Math.abs(nodeData[id].pg - sum('pg')) > 0.05 && (
                                                            <div className="inspector-row"><span>Change (plan):</span><b style={{ color: '#ab47bc' }}>{nodeData[id].pg - sum('pg') > 0 ? '+' : ''}{(nodeData[id].pg - sum('pg')).toFixed(1)} MW (base {sum('pg').toFixed(1)})</b></div>
                                                        )}
                                                        {energizada && nodeData[id].qg !== undefined && <div className="inspector-row"><span>Generation Q:</span><b>{nodeData[id].qg.toFixed(1)} MVAr</b></div>}
                                                        <div className="inspector-row"><span>Pmax / Pmin:</span><b>{sum('pmax').toFixed(0)} / {sum('pmin').toFixed(0)} MW</b></div>
                                                        <div className="inspector-row"><span>Q range:</span><b>{sum('qmin').toFixed(0)} a {sum('qmax').toFixed(0)} MVAr</b></div>
                                                        <div className="inspector-row"><span>Reference voltage:</span><b>{gens[0].vg.toFixed(3)} pu</b></div>
                                                    </>
                                                )}
                                                {tb && <div className="inspector-row"><span>Voltage range:</span><b>{tb.vmin.toFixed(2)} a {tb.vmax.toFixed(2)} pu ({tb.baseKV} kV)</b></div>}
                                                {!energizada && <div className="inspector-row"><span>State:</span><b style={{ color: '#9e9e9e' }}>De-energized</b></div>}
                                            </>
                                        );
                                    })()}

                                    {isSource && (
                                        <>
                                            <div className="inspector-row"><span>{isFeeder ? 'Demand P:' : 'Generation P:'}</span><b>{transmission ? `${(totalP / 1000).toFixed(1)} MW` : `${totalP.toFixed(1)} kW`}</b></div>
                                            <div className="inspector-row"><span>{isFeeder ? 'Demand Q:' : 'Generation Q:'}</span><b>{transmission ? `${(totalQ / 1000).toFixed(1)} MVAr` : `${totalQ.toFixed(1)} kVAr`}</b></div>
                                            <div className="inspector-row"><span>{isFeeder ? 'Demand S:' : 'Generation S:'}</span><b>{transmission ? `${(totalS / 1000).toFixed(1)} MVA` : `${totalS.toFixed(1)} kVA`}</b></div>
                                            <div className="inspector-row"><span>{transmission ? 'Installed capacity:' : 'Limit (SSE):'}</span><b>{transmission ? `${(sLimit / 1000).toFixed(0)} MW` : `${sLimit.toFixed(0)} kVA`}</b></div>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })()
                    ) : (
                        (() => {
                            const liveBranch = branches.find(b => b.id === selectedElement.data.id) || selectedElement.data;
                            const currentInfo = lineCurrents[liveBranch.id];
                            if(!currentInfo) return null;
                            const barColor = getLoadColor(currentInfo.percentage);

                            // 👇 MINI INSPECTOR FOR LINES (WITH VERTICAL GAUGES) 👇
                            if (isMini) return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center', width: '100%' }}>
                                    {/* TITLE */}
                                    <div style={{ color: '#aaa', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>
                                        LINE<br/>
                                        <span style={{ fontSize: '14px', color: darkMode ? '#fff' : '#000' }}>{liveBranch.from}-{liveBranch.to}{circuitOf(liveBranch)}</span>
                                    </div>

                                    {/* VERTICAL BARS CONTAINER */}
                                    <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                                        
                                        {/* COLUMN 1: LOADING */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 'bold', color: liveBranch.state === 1 ? barColor : '#f44336' }}>
                                                {liveBranch.state === 1 ? `${currentInfo.percentage.toFixed(0)}%` : 'OFF'}
                                            </div>
                                            <div style={{ position: 'relative', height: '80px', width: '14px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '7px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, overflow: 'hidden', opacity: liveBranch.state === 1 ? 1 : 0.3 }}>
                                                <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.min(currentInfo.percentage, 100)}%`, background: barColor, transition: 'height 0.4s' }}></div>
                                            </div>
                                            <div style={{ fontSize: '9px', color: '#888', fontWeight: 'bold' }}>LOAD</div>
                                        </div>

                                        {/* COLUMN 2: TAP (If it is a regulator) */}
                                        {liveBranch.isRegulator && (
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#00bcd4' }}>
                                                    {liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap}
                                                </div>
                                                <input 
                                                    type="range" min={-liveBranch.maxTaps} max={liveBranch.maxTaps} step="1" 
                                                    value={liveBranch.currentTap}
                                                    onChange={(e) => {
                                                        const newVal = parseInt(e.target.value);
                                                        if(handleTapChange) handleTapChange(liveBranch.id, newVal - liveBranch.currentTap);
                                                    }}
                                                    style={{ WebkitAppearance: 'slider-vertical', width: '14px', height: '80px', accentColor: '#00bcd4', cursor: 'pointer', margin: 0 }}
                                                />
                                                <div style={{ fontSize: '9px', color: '#00bcd4', fontWeight: 'bold' }}>TAP</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                            // 👆 END OF INJECTION 👆

                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {/* 1. TITLE */}
                                    <div className="inspector-title" style={{ fontSize: '18px', margin: -5, display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Line </span>
                                        <span>{liveBranch.from}-{liveBranch.to}{circuitOf(liveBranch)}</span>
                                    </div>
                                    
                                    {/* 2. MAIN CHART (Line Loading) */}
                                    {liveBranch.state === 1 && (
                                        <div style={{ paddingBottom: '8px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                                                <span style={{ color: darkMode ? '#aaa' : '#666' }}>Loading</span>
                                                <b style={{ color: barColor }}>{currentInfo.percentage.toFixed(1)}%</b>
                                            </div>
                                            <div style={{ height: '22px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '11px', overflow: 'hidden', border: `1px solid ${darkMode ? '#444' : '#ccc'}` }}>
                                                <div style={{ width: `${Math.min(currentInfo.percentage, 100)}%`, height: '100%', background: barColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#000', fontWeight: 'bold', transition: 'width 0.4s ease, background 0.4s ease' }}>
                                                    {currentInfo.percentage > 15 ? `${currentInfo.percentage.toFixed(1)}%` : ''}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'center', fontSize: '12px', marginTop: '8px', color: isOverloaded(currentInfo.percentage) ? '#d50000' : (currentInfo.percentage > 80 ? '#ff9800' : (darkMode ? '#aaa' : '#666')), fontWeight: currentInfo.percentage > 80 ? 'bold' : 'normal' }}>
                                                {isOverloaded(currentInfo.percentage) ? '⚠️ OVERLOAD' : (currentInfo.percentage > 80 ? 'High Load' : 'Normal Operation')}
                                            </div>
                                        </div>
                                    )}

                                    {/* 3. CONTROLS (voltage regulator TAP) */}
                                    {liveBranch.isRegulator && (
                                        <div style={{ paddingBottom: '10px', borderBottom: `1px dashed ${darkMode ? '#444' : '#ccc'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                <span style={{ fontSize: '12px', color: darkMode ? '#aaa' : '#666', whiteSpace: 'nowrap' }}>Regulator (TAP)</span>
                                                <b style={{ color: '#00bcd4', fontSize: '13px' }}>{liveBranch.currentTap > 0 ? `+${liveBranch.currentTap}` : liveBranch.currentTap} <span style={{fontSize: '10px', color: '#888'}}>/ ±{liveBranch.maxTaps}</span></b>
                                            </div>
                                            
                                            <input type="range" min={-liveBranch.maxTaps} max={liveBranch.maxTaps} step="1" value={liveBranch.currentTap}
                                                onChange={(e) => {
                                                    const newVal = parseInt(e.target.value);
                                                    const diff = newVal - liveBranch.currentTap;
                                                    if(handleTapChange) handleTapChange(liveBranch.id, diff);
                                                }}
                                                style={{ width: '100%', accentColor: '#00bcd4', cursor: 'pointer', height: '4px', background: darkMode ? '#333' : '#ddd', borderRadius: '2px', appearance: 'auto' }}
                                            />
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: darkMode ? '#777' : '#999', marginTop: '4px' }}>
                                                <span>-{liveBranch.maxTaps}</span><span>Position {liveBranch.currentTap}</span><span>+{liveBranch.maxTaps}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* 4. RAW DATA */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
                                        <div className="inspector-row"><span>Status:</span><b style={{ color: liveBranch.state === 1 ? '#4caf50' : '#f44336' }}>{liveBranch.state === 1 ? 'CLOSED' : (liveBranch.openByFault ? 'OPEN (faulted bus)' : 'OPEN')}</b></div>
                                        {currentInfo.unit === 'MW' ? (<div className="inspector-row"><span>Reactance (X):</span><b>{liveBranch.xpu} pu</b></div>) : (<>
                                        <div className="inspector-row"><span>Resistance (R):</span><b>{liveBranch.r} Ω</b></div>
                                        <div className="inspector-row"><span>Reactance (X):</span><b>{liveBranch.x} Ω</b></div>
                                        </>)}
                                        <div className="inspector-row"><span>{currentInfo.unit === 'MW' ? 'Limit (rateA):' : 'Limit (Imax):'}</span><b>{currentInfo.limitCurrent ? `${currentInfo.limitCurrent.toFixed(0)} ${currentInfo.unit === 'MW' ? 'MVA' : 'A'}` : '—'}</b></div>
                                        
                                        {liveBranch.state === 1 && (
                                            <>
                                                {/* 👇 POWERS INSERTED HERE (Magnitude in kW/kVAr) 👇 */}
                                                <div className="inspector-row"><span>Power P:</span><b>{currentInfo.unit === 'MW' ? `${(Math.abs(currentInfo.pFlow) / 1000).toFixed(1)} MW (DC)` : `${Math.abs(currentInfo.pFlow).toFixed(2)} kW`}</b></div>
                                                {currentInfo.unit !== 'MW' && <div className="inspector-row"><span>Power Q:</span><b>{Math.abs(currentInfo.qFlow).toFixed(2)} kVAr</b></div>}
                                                
                                                {currentInfo.unit !== 'MW' && (<>
                                                <div className="inspector-row"><span>Current:</span><b>{currentInfo.current.toFixed(1)} A</b></div>
                                                <div className="inspector-row"><span>Losses (I²R):</span><b>{(3 * Math.pow(currentInfo.current, 2) * liveBranch.r / 1000).toFixed(2)} kW</b></div>
                                                </>)}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })()
                    )
                ) : (
                    <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, textAlign: 'center', color: darkMode ? '#aaa' : '#666' }}>
                        <span style={{ fontSize: isMini ? '24px' : '45px', marginBottom: isMini ? '0' : '15px' }}>🖱️</span>
                        {!isMini && (
                            <>
                                <span style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>Element Inspector</span>
                                <span style={{ fontSize: '13px' }}>Click or hover over<br/>a bus or line.<br/> Use Ctrl + Click to pin </span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}