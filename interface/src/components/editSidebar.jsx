import React, { useState, useRef, useEffect } from 'react';
import { runAsyncLayout } from '../utils/runLayoutWorker';

export default function EditSidebar({
    isEditMode,
    setIsEditMode,
    darkMode,
    onUndo = () => {},
    canUndo = false,
    branches, allNodes, sources, currentPositions,
    setIsCalculatingLayout,
    setLayoutProgress,
    selectedNodes = []
}) {

    const [algoMode, setAlgoMode] = useState('force');
    const [forceDist, setForceDist] = useState(10);
    const [forceCharge, setForceCharge] = useState(40); 
    const [radialStep, setRadialStep] = useState(50);
    const [openWeight, setOpenWeight] = useState(65); 
    const fileInputRef = useRef(null);
    
    // VNS state
    const [vnsRunning, setVnsRunning]     = useState(false);
    const [vnsProgress, setVnsProgress]   = useState(null); 
    const [vnsGridSize, setVnsGridSize]   = useState(100);
    const [vnsMaxIter,  setVnsMaxIter]    = useState(30);
    const [usePhysics, setUsePhysics]     = useState(false); 

    // State for the coarsened-graph view mode (Debug)
    const [visualDebug, setVisualDebug] = useState(false);

    const handleApplyGenerator = async () => {
        let actualPositions = { ...currentPositions };
        let actualSelection = selectedNodes ? [...selectedNodes] : [];
        
        window.dispatchEvent(new CustomEvent('getLatestLayout', { 
            detail: (layout) => { 
                if (layout) {
                    if (layout.positions) actualPositions = { ...layout.positions };
                    if (layout.selectedNodes && layout.selectedNodes.length > 0) {
                        actualSelection = [...layout.selectedNodes];
                    }
                }
            } 
        }));

        let finalSelection = (actualSelection.length > 1) ? actualSelection : null;

        try {
            if (setIsCalculatingLayout) setIsCalculatingLayout(true);
            if (setLayoutProgress) setLayoutProgress({ passes: 0, msg1: "Starting...", msg2: "" });

            const safeNodes = allNodes || [];
            const safeBranches = branches || [];
            const safeSources = sources || [];

            const response = await runAsyncLayout(algoMode, safeNodes, safeBranches, safeSources, { 
                gridSize: radialStep, 
                distance: forceDist, 
                charge: -forceCharge, 
                openWeight: openWeight / 100,
                currentPos: actualPositions,
                useForce: usePhysics,
                selectedNodes: finalSelection, 
                visualizeCoarsened: visualDebug,
                onProgress: (passes, msg1, msg2) => { if (setLayoutProgress) setLayoutProgress({ passes, msg1, msg2 }); }
            });

            const newPositions = response.type === 'success' ? response.result : response;

            if (newPositions && Object.keys(newPositions).length > 0 && !response.error) {
                window.dispatchEvent(new CustomEvent('saveLayoutToHistory'));
                window.dispatchEvent(new CustomEvent('applyOrganicLayout', { 
                    detail: { positions: newPositions, waypoints: response.waypoints || {} } 
                }));
            } else {
                console.error("Worker returned an error:", response.error);
                alert("Layout failure: " + (response.error || "Unknown error"));
            }
        } catch (error) {
            console.error("Critical error instantiating the Worker:", error);
            alert("Fatal communication error.");
        } finally {
            // 1st: tells App.jsx to turn off the loading screen BEFORE erasing the data
            if (setIsCalculatingLayout) setIsCalculatingLayout(false);
            // 2nd: now it safely destroys the object to remove the "glass wall"
            if (setLayoutProgress) setLayoutProgress(null);
        }
    };

    const handleApplyVNS = async () => {
        if (vnsRunning) return;

        let actualLayout = { positions: currentPositions, waypoints: {} };
        window.dispatchEvent(new CustomEvent('getLatestLayout', {
            detail: { callback: (layout) => { actualLayout = layout; } }
        }));
        window.dispatchEvent(new CustomEvent('saveToHistory', { detail: actualLayout }));

        setVnsRunning(true);
        if (setIsCalculatingLayout) setIsCalculatingLayout(true);
        if (setLayoutProgress) setLayoutProgress({ passes: 0, msg1: "Optimizing Layout...", msg2: "Running VNS" });

        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const response = await runAsyncLayout('vns', allNodes, branches, sources, {
                gridSize: vnsGridSize,
                maxIter: vnsMaxIter,
                currentPos: actualLayout.positions,
                selectedNodes: actualLayout.selectedNodes || null,
                visualizeCoarsened: visualDebug, // 👈 DEBUG FLAG
                onProgress: (iter, cost, crossings) => {
                    setVnsProgress({ iter, cost: cost, crossings });
                    if (setLayoutProgress) setLayoutProgress({ passes: iter, msg1: "VNS Fine Tuning", msg2: `Attempt ${iter} | Remaining crossings: ${crossings}` });
                },
            });
            
            // 👇 ANTI-BUG SAFETY BELT 👇
            if (visualDebug && response.macroData) {
                window.dispatchEvent(new CustomEvent('applyMacroGraph', { detail: response }));
            } else {
                const finalPos = response.positions ? response.positions : response;
                window.dispatchEvent(new CustomEvent('applyOrganicLayout', { detail: { positions: finalPos } }));
            }
            window.dispatchEvent(new CustomEvent('triggerZoomExtents'));
        } catch (error) {
            console.error("VNS Worker error:", error);
        } finally {
            setVnsRunning(false);
            if (setIsCalculatingLayout) setIsCalculatingLayout(false);
            if (setLayoutProgress) setLayoutProgress(null); // Add this line!
        }
    };

    const handleVisualCompact = async () => {
        let actualLayout = { positions: currentPositions, waypoints: {} };
        window.dispatchEvent(new CustomEvent('getLatestLayout', { detail: { callback: (layout) => { actualLayout = layout; } } }));

        if (setIsCalculatingLayout) setIsCalculatingLayout(true);
        if (setLayoutProgress) setLayoutProgress({ passes: 0, msg1: "Compact View", msg2: "Collapsing the network..." });

        try {
            const response = await runAsyncLayout(algoMode, allNodes, branches, sources, { 
                gridSize: 100, maxIter: 1, currentPos: actualLayout.positions,
                visualizeCoarsened: true, debugPhase: 'before', 
                onProgress: (passes, msg1, msg2) => { if (setLayoutProgress) setLayoutProgress({ passes, msg1, msg2 }); }
            });

            // 👇 THE VITAL SAFETY BELT 👇
            if (response && response.macroData) {
                window.dispatchEvent(new CustomEvent('applyMacroGraph', { detail: response }));
            } else {
                console.warn("⚠️ The Worker could not generate the skeleton (macroData missing).", response);
                alert("Warning: the visual compaction could not be generated at this time.");
            }
        } catch (error) { 
            console.error("Visual compaction error:", error);
        } finally { 
            if (setIsCalculatingLayout) setIsCalculatingLayout(false); 
            if (setLayoutProgress) setLayoutProgress(null); // Add this line!
        }
    };

    // --- Shortcuts and Rotation remain untouched below ---
    useEffect(() => {
        const handleRotateShortcut = (e) => handleRotate(e.detail);
        window.addEventListener('triggerRotate', handleRotateShortcut);
        return () => window.removeEventListener('triggerRotate', handleRotateShortcut);
    }, [currentPositions]);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.positions || data.layout) {
                    window.dispatchEvent(new CustomEvent('applyGraphLayout', { detail: data }));
                    alert("✅ Project imported successfully!");
                } else {
                    alert("❌ Invalid file.");
                }
            } catch (err) {
                alert("❌ Error reading the JSON file.");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    };

    const handleRotate = (angleDegrees) => {
        let actualLayout = { positions: currentPositions, waypoints: {} };
        window.dispatchEvent(new CustomEvent('getLatestLayout', { detail: { callback: (layout) => { actualLayout = layout; } } }));

        const currentPos = actualLayout.positions;
        const currentWps = actualLayout.waypoints;
        if (!currentPos || Object.keys(currentPos).length === 0) return;

        let sumX = 0, sumY = 0;
        const keys = Object.keys(currentPos);
        keys.forEach(id => { sumX += currentPos[id].x; sumY += currentPos[id].y; });
        const cx = sumX / keys.length; const cy = sumY / keys.length;

        const angleRad = angleDegrees * (Math.PI / 180);
        const cosA = Math.cos(angleRad); const sinA = Math.sin(angleRad);

        const newPos = {};
        keys.forEach(id => {
            const nx = currentPos[id].x - cx; const ny = currentPos[id].y - cy;
            newPos[id] = { x: nx * cosA - ny * sinA + cx, y: nx * sinA + ny * cosA + cy };
        });

        const newWps = {};
        Object.keys(currentWps).forEach(branchId => {
            newWps[branchId] = currentWps[branchId].map(wp => {
                if (!wp) return wp;
                const nx = wp.x - cx; const ny = wp.y - cy;
                return { x: nx * cosA - ny * sinA + cx, y: nx * sinA + ny * cosA + cy };
            });
        });
        
        window.dispatchEvent(new CustomEvent('saveLayoutToHistory'));
        window.dispatchEvent(new CustomEvent('applyOrganicLayout', { detail: { positions: newPos, waypoints: newWps } }));
        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 600);
    };

    if (!isEditMode) return null;

    const glassContainerStyle = { background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)', borderLeft: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)'}`, display: 'flex', flexDirection: 'column', width: '230px', height: '100%', boxSizing: 'border-box', overflow: 'hidden', boxShadow: darkMode ? '-5px 0 20px rgba(0,0,0,0.4)' : '-5px 0 15px rgba(0,0,0,0.05)', transition: 'background 0.3s, border 0.3s' };
    const ghostBtnOrangeStyle = { background: 'transparent', border: '1.5px solid #ff9800', color: '#ff9800', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', padding: '10px 4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s ease-in-out', width: '100%', marginBottom: '10px' };
    const shortcutBadgeStyle = { display: 'inline-block', background: darkMode ? 'rgba(255,152,0,0.2)' : '#FFE0B2', color: darkMode ? '#ffb74d' : '#E65100', borderRadius: '5px', padding: '2px 6px', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '11px', margin: '0 2px' };
    const shortcuts = [ { keys: ['P'], desc: 'Full Screen/A4' }, { keys: ['Ctrl', 'P'], desc: 'Print PDF' }, { keys: ['E'], desc: 'Leave Editing' }, { keys: ['Z'], desc: 'Center' }, { keys: ['Ctrl', 'Z'], desc: 'Undo' }, { keys: ['D'], desc: 'Dark Theme' }, { keys: ['Shift', 'Drag'], desc: 'Multiple Selection' } ];

    return (
        <div className="edit-sidebar" style={glassContainerStyle}>
            <style>
                {`
                .edit-ghost-btn:hover { background-color: var(--hover-color, #ff9800) !important; color: #ffffff !important; transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); }
                .edit-ghost-btn:active { transform: translateY(1px); }
                .edit-ghost-btn:disabled { opacity: 0.3 !important; cursor: not-allowed !important; pointer-events: none; }
                `}
            </style>

            <div style={{ padding: '20px', borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`, background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }}>
                <h2 style={{ color: '#ff9800', margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>✏️ Edit Mode</h2>
            </div>

            <div style={{ padding: '15px', flex: 1, overflowY: 'auto' }}>
                <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleFileUpload} />
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, border: '1.5px solid #00bcd4', color: '#00bcd4', '--hover-color': '#00bcd4', margin: 0}} onClick={() => fileInputRef.current.click()}>📂 Import</button>
                    <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, border: '1.5px solid #4caf50', color: '#4caf50', '--hover-color': '#4caf50', margin: 0}} onClick={() => window.dispatchEvent(new CustomEvent('requestLayoutExport'))}>💾 Export</button>
                </div>

                <div style={{ height: '1px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)', margin: '15px 0' }}></div>

                <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, '--hover-color': '#ff9800'}} onClick={onUndo} disabled={!canUndo}>↩️ Undo Move</button>
                <div style={{ display: 'flex', gap: '10px', width: '100%', marginBottom: '15px' }}>
                    <button onClick={() => handleRotate(-10)} style={{ flex: 1, padding: '10px', border: '2px solid #00bcd4', borderRadius: '8px', cursor: 'pointer', background: 'transparent', color: '#00bcd4', fontWeight: 'bold', fontSize: '14px', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#00bcd4'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#00bcd4'; }}>↺ -10°</button>
                    <button onClick={() => handleRotate(10)} style={{ flex: 1, padding: '10px', border: '2px solid #00bcd4', borderRadius: '8px', cursor: 'pointer', background: 'transparent', color: '#00bcd4', fontWeight: 'bold', fontSize: '14px', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#00bcd4'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#00bcd4'; }}>+10° ↻</button>
                </div>
            
                <div style={{ height: '1px', background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)', margin: '15px 0' }}></div>
                
                <button className="edit-ghost-btn" style={{...ghostBtnOrangeStyle, background: 'rgba(255, 152, 0, 0.05)', '--hover-color': '#ff9800'}} onClick={() => setIsEditMode(false)}>🚪 Exit and Save</button>

                {/* Button to see the BEFORE */}
                <button onClick={handleVisualCompact} style={{ width: '100%', padding: '8px', marginTop: '12px', marginBottom: '12px', background: '#ff5722', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                    👁️ View Skeleton (Before Layout)
                </button>
                
                {/* Checkbox to modify the AFTER */}
                <div style={{ marginBottom: '15px', padding: '10px', background: darkMode ? 'rgba(255, 87, 34, 0.1)' : 'rgba(255, 87, 34, 0.05)', borderRadius: '8px', border: `1px solid ${darkMode ? 'rgba(255, 87, 34, 0.3)' : 'rgba(255, 87, 34, 0.4)'}` }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#ff5722', fontWeight: 'bold', fontSize: '13px' }}>
                        <input type="checkbox" checked={visualDebug} onChange={e => setVisualDebug(e.target.checked)} style={{ accentColor: '#ff5722', width: '16px', height: '16px', cursor: 'pointer' }} />
                        👁️ Keep Skeleton (Post-Layout)
                    </label>
                    <p style={{ margin: '5px 0 0 24px', fontSize: '10px', color: darkMode ? '#aaa' : '#666' }}>If active, the engine will apply the layout and freeze the screen on the skeleton.</p>
                </div>

                <div style={{ padding: '15px', background: darkMode ? '#2a2a2a' : '#f5f5f5', borderRadius: '8px', marginBottom: '15px', border: `1px solid ${darkMode ? '#444' : '#ddd'}` }}>
                    <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#ff9800' }}>🛠️ Geometric Generator</h3>
                    
                    <select value={algoMode} onChange={(e) => setAlgoMode(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '4px', background: darkMode ? '#111' : '#fff', color: darkMode ? '#fff' : '#000', border: '1px solid #555' }}>
                        <option value="force">Organic (D3 Force)</option>
                        <option value="orthogonal">Orthogonal (Grid Expansion)</option>
                        <option value="vns">VNS Compactor</option>
                        <option value="hierarchical">Hierarchical (Sugiyama Tree)</option>
                    </select>

                    {algoMode === 'force' && (
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label>Line Distance: {forceDist}px
                                <input type="range" min="1" max="50" value={forceDist} onChange={e=>setForceDist(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                            <label>Repulsion (Magnet): {forceCharge}
                                <input type="range" min="10" max="300" value={forceCharge} onChange={e=>setForceCharge(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                            <label>Open Switch Strength: {openWeight}%
                                <input type="range" min="0" max="100" value={openWeight} onChange={e=>setOpenWeight(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                        </div>
                    )}

                    {algoMode === 'orthogonal' && (
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#ff9800', fontWeight: 'bold' }}>
                                <input type="checkbox" checked={usePhysics} onChange={e => setUsePhysics(e.target.checked)} />
                                Use prior physical repulsion
                            </label>
                            <label style={{ color: '#00bcd4', fontWeight: 'bold' }}>Grid Size: {radialStep}px
                                <input type="range" min="10" max="150" step="5" value={radialStep} onChange={e=>setRadialStep(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                        </div>
                    )}

                    {algoMode === 'hierarchical' && (
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ color: '#00bcd4', fontWeight: 'bold' }}>Tree Spacing: {radialStep}px
                                <input type="range" min="30" max="250" step="10" value={radialStep} onChange={e=>setRadialStep(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                        </div>
                    )}

                    {algoMode === 'vns' && (
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label>Cell size (grid): {vnsGridSize}px
                                <input type="range" min="40" max="200" step="10" value={vnsGridSize} onChange={e => setVnsGridSize(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                            <label>VNS Iterations: {vnsMaxIter}
                                <input type="range" min="10" max="100" step="5" value={vnsMaxIter} onChange={e => setVnsMaxIter(Number(e.target.value))} style={{width:'100%'}}/>
                            </label>
                        </div>
                    )}

                    {algoMode === 'vns' ? (
                        <button onClick={handleApplyVNS} disabled={vnsRunning} style={{ width: '100%', padding: '8px', marginTop: '12px', background: vnsRunning ? '#555' : '#7c4dff', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: vnsRunning ? 'wait' : 'pointer' }}>
                            {vnsRunning ? `⏳ Iter ${vnsProgress?.iter ?? 0} | ✂️ ${vnsProgress?.crossings ?? '?'} crossings` : '🧬 Run VNS'}
                        </button>
                    ) : (
                        <button onClick={handleApplyGenerator} style={{ width: '100%', padding: '8px', marginTop: '12px', background: '#00bcd4', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                            Apply Layout
                        </button>
                    )}
                    
                </div>
                
                <div style={{ background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '10px', padding: '15px', marginTop: '20px' }}>
                    <h4 style={{ margin: '0 0 15px 0', color: darkMode ? '#eee' : '#333', fontSize: '13px', borderBottom: `1px solid ${darkMode ? '#444' : '#ccc'}`, paddingBottom: '8px' }}>⌨️ Shortcuts:</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {shortcuts.map((shortcut, index) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                <div style={{ display: 'flex', gap: '3px' }}>{shortcut.keys.map((key, kIndex) => <span key={kIndex} style={shortcutBadgeStyle}>{key}</span>)}</div>
                                <div style={{ fontSize: '11px', color: darkMode ? '#aaa' : '#555', textAlign: 'right', flex: 1 }}>{shortcut.desc}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}