import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { analyzeTopology, calculateLoads } from './utils/topology';
import { THEME } from './utils/theme';
import Sidebar from './components/Sidebar';
import FaultPanel from './components/FaultPanel';
import MapArea from './components/MapArea';
import GraphArea from './components/GraphArea';
import EditSidebar from './components/editSidebar'; 
import { exportSVG } from './utils/exportUtils';
import './index.css';
import { useFileImport } from './hooks/useFileImport';

import { runAsyncLayout } from './utils/runLayoutWorker';
import { expandTopology, contractTopology, relaxExpandedNodes, findIntersections, compactPositions } from './utils/autoLayout';

import { useShortcuts } from './hooks/useShortcuts';
import { useColorIntelligence, getBaseColor } from './hooks/useColorIntelligence';
import { buildTransmissionSystem, solveTransmissionDC } from './utils/transmission';
import { backendEvaluate, buildRequest, topologyFromState, toInterfaceResult, backendCorrective, buildCorrectiveRequest } from './solver/backendClient';
import { stageResult, shedByBus, faultsText, redispatchBuses, stageCaption } from './solver/corrective';
import CorrectivePanel from './components/CorrectivePanel';
import ScreeningPanel from './components/ScreeningPanel';
import RecoveryPanel from './components/RecoveryPanel';
import { REPLAY } from './solver/replay';
import { loadGencoLines, outageKey, storedState, composeStoredResult, gencoErrorPoints, referenceGeneration } from './solver/gencoLines';
import { NETWORKS, networkOf, systemOptions } from './networks';
import ContactCard from './components/ContactCard';
import { resetAllPanels } from './utils/floatingPanel';
import { faultItems, buildRecoveryRequest, backendRecovery, eventResult, eventShed, eventRemaining } from './solver/recovery';
import { verificationFor } from './solver/verification';
import { branchesForDisplay } from './utils/displayBranches';
import { buildScreenRequest, backendScreen } from './solver/screening';



function App() {

    const [macroGraph, setMacroGraph] = useState(null);
    // Listens for the event coming from the Sidebar button
    useEffect(() => {
        const handleApplyMacro = (e) => setMacroGraph(e.detail);
        window.addEventListener('applyMacroGraph', handleApplyMacro);
        return () => window.removeEventListener('applyMacroGraph', handleApplyMacro);
    }, []);
    
    // Base system settings (unified)
    const [vBase, setVBase] = useState(13.8);
    const [sBase, setSBase] = useState(1000);
    const [sses, setSses] = useState({});
    const [vMinLimit, setVMinLimit] = useState(0.95);
    const [vMaxLimit, setVMaxLimit] = useState(1.05);

    const [darkMode, setDarkMode] = useState(true); 
    // View control: 'schematic' (SVG diagram) or 'map' (georeferenced Leaflet)
    const [viewMode, setViewMode] = useState('schematic');
    
    // The system now starts empty, with no switches and no weight in memory
    const [branches, setBranches] = useState([]);
    const initialBranchesRef = useRef([]);
    
    
    const [faultNodes, setFaultNodes] = useState(new Set());

    
    const [activeSources, setActiveSources] = useState([]);
    const [systemShunts, setSystemShunts] = useState({});
    const [systemFeeders, setSystemFeeders] = useState([]);
    const [systemLoads, setSystemLoads] = useState({});
    const [systemGD, setSystemGD] = useState({}); // 👈 New state for DG
    // Transmission view: 'ac' = backend (Python; default), 'dc' = local (JS, always available) or 'genco' = precomputed GENCO estimate. If the backend fails, falls back to the local DC.
    const [solverMode, setSolverMode] = useState('ac');
    const [backendResult, setBackendResult] = useState(null);
    const [backendStatus, setBackendStatus] = useState('idle'); // idle | loading | online | offline
    const [backendMsg, setBackendMsg] = useState('');
    // Corrective response (transmission): { data: /corrective response, stage: 'pre' | 'postFault' | 'after' }
    const [corrective, setCorrective] = useState(null);
    const [correctiveBusy, setCorrectiveBusy] = useState(false);
    const [screening, setScreening] = useState(null);       // result of the N-1 screening (/screen)
    const [screeningBusy, setScreeningBusy] = useState(false);
    const [screeningOpen, setScreeningOpen] = useState(false);
    // Repair and block-by-block reconnection: { data: /recovery response, index: displayed step }
    const [recoveryOpen, setRecoveryOpen] = useState(false);
    const [recovery, setRecovery] = useState(null);
    const [recoveryBusy, setRecoveryBusy] = useState(false);
    const [recoveryPlaying, setRecoveryPlaying] = useState(false);
    const [repairOrder, setRepairOrder] = useState([]);
    const [recoveryOptions, setRecoveryOptions] = useState({ repairHours: 2, blockMinutes: 10, blockMW: 50 });
    const recoverySync = useRef(false);   // true when the change of faults comes from the timeline itself (does not invalidate the analysis)
    const [correctivePlaying, setCorrectivePlaying] = useState(false);
    const [nodeColorMode, setNodeColorMode] = useState('state'); // 'state' | 'voltage' (buses colored by voltage, AC only)
    const [transmission, setTransmission] = useState(null); // transmission data (transmission mode: DC flow, see utils/transmission.js)
    const [projectPositions, setProjectPositions] = useState({});
    const [projectWaypoints, setProjectWaypoints] = useState({});
    const [geoPositions, setGeoPositions] = useState({});
    // 👇 NEW STATES LIFTED FROM THE MAP ROUTES 👇
    const [routedPaths, setRoutedPaths] = useState({});
    const [manualWaypoints, setManualWaypoints] = useState({});
    const [straightSegments, setStraightSegments] = useState({});
    

    const [selectedElement, setSelectedElement] = useState(null);
    const [showLabels, setShowLabels] = useState(false);
    const [showLegend, setShowLegend] = useState(true); 
    const [toast, setToast] = useState(null);
    const [calcMethod, setCalcMethod] = useState('NR'); 
    const [isEditMode, setIsEditMode] = useState(false);
    const [showCrossings, setShowCrossings] = useState(true);

    const [layoutHistory, setLayoutHistory] = useState([]); 
    const [layoutMode, setLayoutMode] = useState('project'); 
    const [organicPositions, setOrganicPositions] = useState(null);

    const [organicWaypoints, setOrganicWaypoints] = useState({});

    const [isCalculatingLayout, setIsCalculatingLayout] = useState(false);
    // 👇 DEBUG CAMERA 1: watches the black-screen variable
    useEffect(() => {
        console.log(`🎥 [App.jsx] isCalculatingLayout changed to: ${isCalculatingLayout ? '🟢 ON' : '🔴 OFF'}`);
    }, [isCalculatingLayout]);

    const activePositions = useMemo(() => {
        if (macroGraph) return macroGraph.positions; // 👈 The collapsed position takes priority
        return layoutMode === 'project' ? projectPositions : (organicPositions || projectPositions);
    }, [layoutMode, projectPositions, organicPositions, macroGraph]);

    
    // ==========================================
    // 🎯 CROSSINGS RADAR (CALCULATOR)
    // ==========================================
    
    // 1. Creates a geometric "signature". It only changes if a line is created or deleted, 
    // completely ignoring whether the switch opened or closed (b.state).
    const branchesTopologyHash = branches.map(b => `${b.from}-${b.to}`).join('|');

    const activeWaypoints = useMemo(() => layoutMode === 'project' ? projectWaypoints : (organicWaypoints || projectWaypoints), [layoutMode, projectWaypoints, organicWaypoints]);

    const intersections = useMemo(() => {
        // 2. Extreme Performance Barrier: 
        // Only runs the heavy math if we are in Edit Mode AND the Radar is on!
        if (!isEditMode || !showCrossings || !activePositions || !branches) return [];
        
        return findIntersections(activePositions, branches, activeWaypoints);   // considers the real path (with the bends)
        
    // We ignore React's warning about the branches array to force our geometric rule
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePositions, activeWaypoints, branchesTopologyHash, isEditMode, showCrossings]);

    
    const [printFrameMode, setPrintFrameMode] = useState('none'); 
    const [showShortcuts, setShowShortcuts] = useState(false);
    
    const [sidebarMode, setSidebarMode] = useState('full');
    const [isFaultSidebarOpen, setFaultSidebarOpen] = useState(true);
    const [hoveredLineId, setHoveredLineId] = useState(null);
    const [hoveredNodeId, setHoveredNodeId] = useState(null);
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);
    const matFileInputRef = useRef(null);
    // 👇 INFINITE LOOP PROTECTION 👇
    const allNodes = useMemo(() => 
        Array.from(new Set(branches.flatMap(b => [b.from, b.to]))).sort((a, b) => a - b)
    , [branches]);
    
    const sources = activeSources;
    
    const loadNodes = useMemo(() => 
        allNodes.filter(n => !sources.includes(n) && !systemFeeders.includes(n))
    , [allNodes, sources, systemFeeders]);
    
    // Sources and feeders (barrier for fault propagation)
    const allBoundaryNodes = useMemo(() => [...sources, ...systemFeeders], [sources, systemFeeders]);
    
    
    const [layoutProgress, setLayoutProgress] = useState({ passes: 0, msg1: '', msg2: '' });
    
    // 👇 SMART BLACK START (Loop Grouping) 👇
    const runBlackStart = useCallback((targetBranches, targetSources, targetFeeders) => {
        
        const feederNodes = new Set((targetFeeders || []).map(Number));
        const allSources = (targetSources || []).map(Number);
        
        // 1. The true root is whatever is a Source but NOT a Feeder
        const trueRoots = allSources.filter(s => !feederNodes.has(s));
        if (trueRoots.length === 0) {
            console.warn("⚠️ WARNING: No main source found! Check the data file.");
        }
        const rootSourcesSet = new Set(trueRoots.length > 0 ? trueRoots : allSources);

        // 2. Identification of the master switches and blackout generation
        const rootBranches = [];
        const blackoutState = targetBranches.map(b => {
            const isMasterSwitch = rootSourcesSet.has(Number(b.from)) || rootSourcesSet.has(Number(b.to));
            if (b.state === 1 && isMasterSwitch) {
                rootBranches.push(b);
                return { ...b, state: 0 }; 
            }
            return { ...b };
        });

        // =========================================================
        // 🧠 3. LOOP INTELLIGENCE: topological grouping
        // =========================================================
        const rootBranchIds = new Set(rootBranches.map(b => b.id));
        const adj = {};
        
        // 3a. Builds a connection map ONLY with the internal network (ignoring the master switches)
        targetBranches.forEach(b => {
            if (b.state === 1 && !rootBranchIds.has(b.id)) {
                if (!adj[b.from]) adj[b.from] = [];
                if (!adj[b.to]) adj[b.to] = [];
                adj[b.from].push(b.to);
                adj[b.to].push(b.from);
            }
        });

        const nodeComponent = {};
        let compCounter = 0;
        
        // 3b. Search algorithm (BFS) to map islands
        const getComponent = (startNode) => {
            if (nodeComponent[startNode] !== undefined) return nodeComponent[startNode];
            compCounter++;
            const queue = [startNode];
            nodeComponent[startNode] = compCounter;
            
            let head = 0;
            while(head < queue.length) {
                const u = queue[head++];
                if (adj[u]) {
                    adj[u].forEach(v => {
                        if (nodeComponent[v] === undefined) {
                            nodeComponent[v] = compCounter;
                            queue.push(v);
                        }
                    });
                }
            }
            return compCounter;
        };

        const groupsMap = {};
        rootBranches.forEach(b => {
            // Takes the switch node that is "inside" the network (not at the substation)
            const networkNode = rootSourcesSet.has(Number(b.from)) ? Number(b.to) : Number(b.from);
            const compId = getComponent(networkNode);
            
            if (!groupsMap[compId]) groupsMap[compId] = [];
            groupsMap[compId].push(b.id); // Groups the switches that touch the same island
        });

        // Converts the map into an array of switch groups
        const rootBranchGroups = Object.values(groupsMap);
        // =========================================================

        // Switches off the substation
        setBranches(blackoutState);

        // 4. Religamento em Cascata (Agrupado por Ilha/Loop)
        let index = 0;
        const interval = setInterval(() => {
            if (index >= rootBranchGroups.length) {
                clearInterval(interval);
                return;
            }

            const groupToClose = rootBranchGroups[index]; // Array with 1 or more switch IDs
            
            // 4a. Closes ALL the switches of the group simultaneously
            setBranches(prev => prev.map(b => 
                groupToClose.includes(b.id) ? { ...b, state: 1 } : b
            ));
            
            // 4b. Wakes up Newton-Raphson with the nodes of all closed switches
            const nodesToWake = new Set();
            targetBranches.forEach(b => {
                if (groupToClose.includes(b.id)) {
                    nodesToWake.add(b.from);
                    nodesToWake.add(b.to);
                }
            });
            //if (nodesToWake.size > 0) setLastEventNodes(nodesToWake);

            index++;
        }, 50);
    }, []);

    // 👇 UNIFIED LOADING FUNCTION 👇
    const applySystemData = useCallback((data, sourceName = "External") => {
        const targetBranches = data.branches ? data.branches.map((b, idx) => ({ 
            ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
        })) : [];

        setBranches(targetBranches);
        if (initialBranchesRef) initialBranchesRef.current = JSON.parse(JSON.stringify(targetBranches)); 
        
        setSystemLoads(data.loads || {}); 
        setSystemShunts(data.shunts || {});
        setActiveSources(data.sources || []); 
        setSystemFeeders(data.feeders || []);
        setSystemGD(data.systemGD || data.gd || {}); // 👈 Injeta a GD vinda do Parser ou JSON
        setTransmission(data.transmission || null);
        if (data.transmission) setViewMode('schematic'); // no geographic coordinates in transmission cases

        // 👇 ADDED: support for variable names from both JSON and DAT
        setVBase(data.Vbase || data.baseKV || 13.8);
        setSBase(data.Sbase || data.sBase || 1000);
        setSses(data.sses || data.Sses || {});
        // Tries to read from data.constraints, otherwise uses the default values
        setVMinLimit(data.constraints?.vMin ?? 0.95);
        setVMaxLimit(data.constraints?.vMax ?? 1.05);

        const layoutData = data.layout || data;
        setProjectPositions(layoutData.positionsProject || layoutData.positions || {});
        setProjectWaypoints(layoutData.waypointsProject || layoutData.waypoints || {});
        setGeoPositions(layoutData.geoPositions || data.geoPositions || {});
        // 👇 IMPORTS THE ROUTES FROM THE FILE (OR RESETS IF IT IS A NEW SYSTEM) 👇
        setRoutedPaths(layoutData.routes || data.routes || {});
        setManualWaypoints(layoutData.manualWaypoints || data.manualWaypoints || {});
        setStraightSegments(layoutData.straightSegments || data.straightSegments || {});

        setFaultNodes(new Set(data.faults || []));
        setIsProjectLoaded(true);

        runBlackStart(targetBranches, data.sources || [], data.feeders || []);

        console.log(`⚙️ System [${sourceName}] loaded successfully in the Unified Engine.`);
        // 👇 TRACE LOGS 👇
        console.log("====================================");
        console.log(`📥 [IMPORT] Loading data from source: ${sourceName}`);
        console.log("📦 Full object received:", data);
        console.log("🎯 Constraints found:", data?.constraints);
        console.log("====================================");

        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 50);
        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 650);
    }, [runBlackStart]);

    // 👇 ASYNC ORGANIC LAYOUT EFFECT 👇
    useEffect(() => {
        if (layoutMode === 'organic' && !organicPositions && allNodes.length > 0 && !isCalculatingLayout) {
            const calculateAsync = async () => {
                setIsCalculatingLayout(true);
                setLayoutProgress({ passes: 0, msg1: "Starting physics engine...", msg2: "Preparing nodes" });
                
                try {
                    // Calls the outsourced worker!
                    const newLayout = await runAsyncLayout('auto', allNodes, branches, sources, { 
                        gridSize: 100, 
                        maxIter: 30,
                        currentPos: projectPositions,
                        onProgress: (passes, msg1, msg2) => {
                            setLayoutProgress({ passes, msg1, msg2 });
                        }
                    });
                    setOrganicPositions(newLayout);
                } catch (error) {
                    console.error("Layout Worker error:", error);
                    showToast("Error computing the organic layout.", "error");
                } finally {
                    setIsCalculatingLayout(false);
                }
            };
            calculateAsync();
        }
    }, [layoutMode, organicPositions, allNodes, branches, sources]);

    useEffect(() => {
        setOrganicPositions(null);
        setLayoutMode('project');
    }, [allNodes.length]);

    useEffect(() => {
        const timer1 = setTimeout(() => { window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }, 50);
        const timer2 = setTimeout(() => { window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }, 700);
        return () => { clearTimeout(timer1); clearTimeout(timer2); };
    }, [layoutMode]);

    useEffect(() => {
        if (darkMode) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
    }, [darkMode]);

    const handleUndoLayout = useCallback(() => {
        if (layoutHistory.length === 0) return;
        const lastState = layoutHistory[layoutHistory.length - 1];
        if (layoutMode === 'organic') {
            setOrganicPositions(lastState.positions);
            if (lastState.waypoints) setOrganicWaypoints(lastState.waypoints); 
        } else {
            setProjectPositions(lastState.positions);
            setProjectWaypoints(lastState.waypoints);
        }
        setLayoutHistory(prev => prev.slice(0, -1));
    }, [layoutHistory, layoutMode]);

    const saveLayoutToHistory = useCallback((positions, waypoints) => {
        const currentState = JSON.parse(JSON.stringify({ positions: positions, waypoints: waypoints }));
        setLayoutHistory(prev => [...prev, currentState].slice(-20)); 
    }, []);

    useEffect(() => {
        const handleSaveToHistory = (e) => { saveLayoutToHistory(e.detail.positions, e.detail.waypoints); };
        window.addEventListener('saveToHistory', handleSaveToHistory);
        return () => window.removeEventListener('saveToHistory', handleSaveToHistory);
    }, [saveLayoutToHistory]);

    const handleResetToOriginalLayout = useCallback(() => {
        if (window.confirm("🚨 Are you sure you want to reset the layout to the file default? All unsaved changes will be lost.")) {
            window.dispatchEvent(new CustomEvent('resetGraphLayout'));
            setLayoutHistory([]); 
        }
    }, []);

    const sysData = useMemo(() => ({
        sources: activeSources, 
        feeders: systemFeeders,
        loads: systemLoads, 
        gd: systemGD, 
        Vbase: vBase, 
        Sbase: sBase, 
        shunts: systemShunts || {}, 
        sses: sses,
        vMin: vMinLimit,
        vMax: vMaxLimit,
        transmission
    }), [activeSources, systemLoads, systemShunts, systemFeeders, vBase, sBase, sses, systemGD, vMinLimit, vMaxLimit, transmission]);

    const topology = useMemo(() => analyzeTopology(branches, faultNodes, sysData), [branches, faultNodes, sysData]);
    const { nodeFeeds, loopNodes } = topology; // We extract what the App and the Panel need
    
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes, sysData), [nodeFeeds, faultNodes, sysData]);
    
    const disconnectedStats = useMemo(() => {
        let totalP = 0, totalQ = 0, count = 0;
        loadNodes.forEach(nodeId => {
            const feeds = nodeFeeds[nodeId];
            if ((!feeds || feeds.size === 0) && !faultNodes.has(nodeId)) {
                // 👇 FIX: uses the 'systemLoads' that came from the import, not the fixed file!
                const load = systemLoads[nodeId]; 
                if (load) { totalP += load.p || 0; totalQ += load.q || 0; count++; }
            }
        });
        const sKVA = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
        // 👇 Uses the dynamic vBase
        const estimatedCurrent = sKVA / (Math.sqrt(3) * vBase); 
        return { p: totalP, q: totalQ, current: estimatedCurrent || 0, count: count };
    }, [loadNodes, nodeFeeds, faultNodes, systemLoads, vBase]);

    // GENCO (and static AC) per-line values for the intact network and for single-line outages (backend/tools/export_genco_lines.py)
    const [gencoLines, setGencoLines] = useState(null);
    useEffect(() => {
        let alive = true;
        setGencoLines(null);
        if (transmission?.gridName) loadGencoLines(transmission.gridName).then(d => { if (alive) setGencoLines(d); });
        return () => { alive = false; };
    }, [transmission?.gridName]);
    const storedKey = useMemo(() => (transmission ? outageKey(branches, faultNodes) : null), [transmission, branches, faultNodes]);
    const storedEntry = useMemo(() => storedState(gencoLines, storedKey), [gencoLines, storedKey]);

    // Block updated with the Warm Start memory
    const powerFlowResults = useMemo(() => {
        // If there are no branches, there is nothing to compute
        if (!branches || branches.length === 0) return { nodes: {}, lines: {} };

        // Transmission: local DC flow per energized island, or backend AC, or a stage of an analysis
        if (sysData.transmission) {
            if (recovery) return eventResult(recovery.data, recovery.index, branches);          // step of the repair timeline
            if (corrective) return stageResult(corrective.data, corrective.stage, branches);   // stage of the corrective response being displayed
            if (solverMode === 'ac' && backendResult) return backendResult;
            if (solverMode === 'genco' && storedEntry) return composeStoredResult(storedEntry, 'genco', branches, gencoLines);
            if (solverMode === 'ac' && REPLAY && storedEntry && storedKey !== 'base') return composeStoredResult(storedEntry, 'ac', branches, gencoLines);
            return solveTransmissionDC(branches, faultNodes, sysData);
        }

        return { nodes: {}, lines: {} };   // there is only a solver for transmission (local DC or backend AC)
    }, [branches, faultNodes, sysData, solverMode, backendResult, corrective, recovery, storedEntry, storedKey, gencoLines]);

    const lineCurrents = powerFlowResults.lines;
    const nodeData = powerFlowResults.nodes;

    // Uses the official React State
    // in transmission, lines connected to a faulted bus appear open (the original data does not change)
    const gencoNet = useMemo(() => (transmission ? networkOf(transmission.gridName)?.genco || null : null), [transmission]);     // GENCO results for the open network
    const displayBranches = useMemo(() => (transmission ? branchesForDisplay(branches, faultNodes) : branches), [transmission, branches, faultNodes]);
    const gencoView = solverMode === 'genco' && !!storedEntry;
    const voltageOk = (solverMode === 'ac' && backendStatus === 'online') || gencoView;
    const voltageMode = !!transmission && voltageOk && nodeColorMode === 'voltage';
    const gencoError = useMemo(() => (gencoView ? gencoErrorPoints(storedEntry) : null), [gencoView, storedEntry]);
    const gencoRef = useMemo(() => (gencoView ? referenceGeneration(storedEntry, gencoLines) : null), [gencoView, storedEntry, gencoLines]);
    const voltageLimits = useMemo(() => (transmission ? transmission.buses : null), [transmission]);
    const shedBuses = useMemo(() => {
        if (recovery) return eventShed(recovery.data, recovery.index);
        return corrective && corrective.stage === 'after' ? shedByBus(corrective.data) : null;
    }, [corrective, recovery]);
    const shedNodes = useMemo(() => (shedBuses && shedBuses.size ? new Set(shedBuses.keys()) : null), [shedBuses]);
    // fraction of the load shed by the plan at the bus (0 to 1); the bus stays energized
    const getNodeShed = useCallback((id) => (shedBuses ? (shedBuses.get(Number(id))?.pct || 0) : 0), [shedBuses]);
    const generatorBuses = useMemo(() => {
        if (!transmission) return null;
        const m = new Map();
        transmission.gens.filter(g => g.status).forEach(g => {
            const cur = m.get(g.bus) || { pgBase: 0, pmax: 0, pmin: 0, qmax: 0, qmin: 0 };
            m.set(g.bus, { pgBase: cur.pgBase + g.pg, pmax: cur.pmax + g.pmax, pmin: cur.pmin + g.pmin, qmax: cur.qmax + g.qmax, qmin: cur.qmin + g.qmin });
        });
        return m;
    }, [transmission]);
    // corrective plan: generators whose dispatch changes (only in the "With plan" stage)
    const redispatchNodes = useMemo(() => {
        if (recovery || !corrective || corrective.stage !== 'after') return null;
        const s = redispatchBuses(corrective.data);
        return s.size ? s : null;
    }, [corrective, recovery]);
    const { getNodeColor, getEdgeColor, getEdgeWidth } = useColorIntelligence({
        faultNodes, activeSources, lineCurrents, darkMode, topology, transmission: !!transmission,
        nodeData, voltageMode, voltageLimits, redispatchNodes
    });

    const effectiveHoveredLineId = hoveredLineId;

    const displayElement = useMemo(() => {
        if (hoveredNodeId !== null) return { type: 'node', id: hoveredNodeId };
        if (effectiveHoveredLineId !== null) return { type: 'edge', data: branches.find(b => b.id === effectiveHoveredLineId) };
        if (selectedElement?.type === 'edge' && selectedElement.data) {
            return { type: 'edge', data: branches.find(b => b.id === selectedElement.data.id) || selectedElement.data };
        }
        return selectedElement;
    }, [hoveredNodeId, effectiveHoveredLineId, selectedElement, branches]);

    const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

    // Backend AC (transmission): re-evaluates the topology on each change, with a small delay and cancellation of the previous request
    useEffect(() => {
        if (!transmission || solverMode !== 'ac') { setBackendResult(null); setBackendStatus('idle'); return undefined; }
        if (REPLAY && storedEntry && storedKey !== 'base') { setBackendResult(null); setBackendMsg('precomputed'); setBackendStatus('online'); return undefined; }   // static demo: AC precomputed for single-line outages
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            setBackendStatus('loading');
            try {
                const topo = topologyFromState(branches, faultNodes);
                const data = await backendEvaluate(buildRequest(transmission, 'ac', [topo]), ctrl.signal);
                const res = data.results[0];
                if (!res.converged) throw new Error(res.error || 'the AC did not converge');
                setBackendResult(toInterfaceResult(res, branches));
                setBackendMsg(`${res.ms} ms`);
                setBackendStatus('online');
            } catch (e) {
                if (e.name === 'AbortError') return;
                setBackendResult(null);
                setBackendMsg(e.message || String(e));
                setBackendStatus('offline');
            }
        }, 80);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [transmission, solverMode, branches, faultNodes, storedEntry, storedKey]);

    // warns once when the backend goes down (or the AC does not converge) and the screen falls back to the local DC
    const prevBackendStatus = useRef('idle');
    useEffect(() => {
        if (backendStatus === 'offline' && prevBackendStatus.current !== 'offline') {
            showToast(`AC unavailable (${backendMsg}). Showing the local DC.`, 'warning');
        }
        prevBackendStatus.current = backendStatus;
    }, [backendStatus, backendMsg]);

    // Corrective response: analyzes the marked faults (faulted buses and open lines) in the backend and shows pre-fault -> post-fault -> with plan
    const runCorrective = async () => {
        if (!transmission) return;
        const topo = topologyFromState(branches, faultNodes);
        if (!topo.branchOut.length && !topo.busOut.length) {
            showToast('Mark at least one fault (faulted bus or open line) before analyzing.', 'warning');
            return;
        }
        setCorrectiveBusy(true);
        try {
            const data = await backendCorrective(buildCorrectiveRequest(transmission, topo));
            setCorrective({ data, stage: 'pre' });
            setCorrectivePlaying(true);
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend unavailable for the analysis (${e.message}). Start the backend (start-local.bat).`, 'error');
        } finally {
            setCorrectiveBusy(false);
        }
    };
    const clearCorrective = () => {
        if (corrective && !recovery) applyRemaining(corrective.data.faults);      // the Pre-fault stage showed the network without the faults
        setCorrective(null); setCorrectivePlaying(false);
    };
    // each stage shows the corresponding topology: pre-fault = full network; post-fault and with plan = faults applied (open lines)
    useEffect(() => {
        if (!corrective || recovery) return;
        applyRemaining(corrective.stage === 'pre' ? { branchOut: [], busOut: [] } : corrective.data.faults);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [corrective?.stage, corrective?.data]);

    // N-1 screening: every line and bus, one at a time
    const runScreening = async () => {
        if (!transmission) return;
        setScreeningBusy(true);
        try {
            setScreening(await backendScreen(buildScreenRequest(transmission)));
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend unavailable for the screening (${e.message}). Start the backend (start-local.bat).`, 'error');
        } finally {
            setScreeningBusy(false);
        }
    };
    // Clicking a screening contingency: applies only that fault to the diagram and requests the corrective response
    const selectContingency = async (c) => {
        const branchOut = c.type === 'line' ? [c.id] : [];
        const busOut = c.type === 'bus' ? [c.id] : [];
        setBranches(prev => prev.map(b => ({ ...b, state: branchOut.includes(b.id) ? 0 : (b.initialState !== undefined ? b.initialState : 1) })));
        setFaultNodes(new Set(busOut));
        setCorrectiveBusy(true);
        try {
            const data = await backendCorrective(buildCorrectiveRequest(transmission, { branchOut, busOut }));
            // the fault changes above invalidate the analysis (effect below); applies the result after them
            setTimeout(() => { setCorrective({ data, stage: 'pre' }); setCorrectivePlaying(true); }, 0);
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend unavailable for the analysis (${e.message}).`, 'error');
        } finally {
            setCorrectiveBusy(false);
        }
    };

    // any change to the faults invalidates the previous analysis
    useEffect(() => {
        if (recoverySync.current) { recoverySync.current = false; return; }
        setCorrective(null); setCorrectivePlaying(false); setRecovery(null); setRecoveryPlaying(false);
    }, [branches, faultNodes]);

    // Repair and reconnection: current faults -> repair order; simulation; the diagram follows the step (shows only the remaining faults)
    const currentFaultItems = useMemo(() => (transmission ? faultItems(branches, faultNodes) : []), [transmission, branches, faultNodes]);
    useEffect(() => {
        if (recovery) return;
        setRepairOrder(prev => {
            const key = (x) => `${x.type}-${x.id}`;
            const kept = prev.filter(p => currentFaultItems.some(c => key(c) === key(p)));
            return [...kept, ...currentFaultItems.filter(c => !kept.some(k => key(k) === key(c)))];
        });
    }, [currentFaultItems, recovery]);
    const applyRemaining = (rem) => {
        recoverySync.current = true;
        setBranches(prev => prev.map(b => ({ ...b, state: rem.branchOut.includes(b.id) ? 0 : (b.initialState !== undefined ? b.initialState : 1) })));
        setFaultNodes(new Set(rem.busOut));
    };
    const runRecovery = async () => {
        if (!transmission || !repairOrder.length) return;
        setRecoveryBusy(true);
        try {
            const data = await backendRecovery(buildRecoveryRequest(transmission, repairOrder, recoveryOptions));
            setRecovery({ data, index: 0, original: { branchOut: data.faults.branchOut, busOut: data.faults.busOut } });
            setRecoveryPlaying(true);
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend unavailable for the simulation (${e.message}). Start the backend (start-local.bat).`, 'error');
        } finally {
            setRecoveryBusy(false);
        }
    };
    // goes back to the original faults (when redoing or closing) without erasing the corrective analysis
    const resetRecovery = () => {
        if (recovery) applyRemaining(recovery.original);
        setRecovery(null); setRecoveryPlaying(false);
    };
    const closeRecovery = () => { resetRecovery(); setRecoveryOpen(false); };
    const setRecoveryIndex = (i) => setRecovery(r => (r ? { ...r, index: i } : r));
    // the diagram follows the displayed step
    useEffect(() => {
        if (recovery) applyRemaining(eventRemaining(recovery.data, recovery.index));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recovery?.index, recovery?.data]);
    useEffect(() => {
        if (!recovery || !recoveryPlaying) return undefined;
        if (recovery.index >= recovery.data.events.length - 1) { setRecoveryPlaying(false); return undefined; }
        const t = setTimeout(() => setRecovery(r => (r ? { ...r, index: r.index + 1 } : r)), 900);
        return () => clearTimeout(t);
    }, [recovery, recoveryPlaying]);

    // playback: pre-fault -> post-fault -> with plan
    useEffect(() => {
        if (!corrective || !correctivePlaying) return undefined;
        const ordem = ['pre', 'postFault', 'after'];
        const i = ordem.indexOf(corrective.stage);
        if (i >= ordem.length - 1) { setCorrectivePlaying(false); return undefined; }
        const t = setTimeout(() => setCorrective(c => (c ? { ...c, stage: ordem[i + 1] } : c)), 2400);
        return () => clearTimeout(t);
    }, [corrective, correctivePlaying]);
    
    const { handleMatpowerFileUpload } = useFileImport({
        showToast,
        setIsCalculatingLayout, 
        setLayoutProgress,
        applySystemData // We pass the Engine to the importer.
    });

    const toggleSwitch = (branchId) => {

        setBranches(prev => prev.map(b => b.id === branchId ? { ...b, state: b.state === 1 ? 0 : 1 } : b));
        showToast('Switch changed', 'success');
    };

    const toggleGD = useCallback((nodeId) => {
        setSystemGD(prev => {
            if (!prev[nodeId]) return prev;
            return { ...prev, [nodeId]: { ...prev[nodeId], active: !prev[nodeId].active } };
        });
        // Junk removed from here!
    }, []);

    // Function to adjust the Distributed Generation value dynamically
    const handleGDChange = useCallback((nodeId, field, increment) => {
        setSystemGD(prev => {
            const gd = prev[nodeId];
            if (!gd) return prev;
            
            let newPg = gd.pg;
            let newQg = gd.qg;
            const sMax = gd.sMax || 0;

            if (field === 'pg') {
                newPg += increment;
                
                // Minimum and maximum clamp for the active power (P)
                if (newPg < 0) newPg = 0;
                if (newPg > sMax) newPg = sMax;
                
                // 🛡️ Elliptical constraint for Q: Qmax = sqrt(Smax² - P²)
                // Re-clamps Q automatically if the new P takes up apparent power
                const qLimit = Math.sqrt(Math.max(0, sMax ** 2 - newPg ** 2));
                if (newQg > qLimit) newQg = qLimit;
                if (newQg < -qLimit) newQg = -qLimit;
                
            } else if (field === 'qg') {
                newQg += increment;
                
                // 🛡️ Elliptical constraint based on the machine's current P
                const qLimit = Math.sqrt(Math.max(0, sMax ** 2 - newPg ** 2));
                
                // Minimum and maximum clamp for the reactive power (Q), allowing negative values
                if (newQg > qLimit) newQg = qLimit;
                if (newQg < -qLimit) newQg = -qLimit;
            }
            
            // If no value was actually changed (it was already at the limit), ignore
            if (newPg === gd.pg && newQg === gd.qg) return prev; 
            
            return {
                ...prev,
                [nodeId]: { ...gd, pg: newPg, qg: newQg }
            };
        });
        
        // 🚨 IMPORTANT: "setLastEventNodes" was banned from the code!
    }, []);

    const handleTapChange = useCallback((branchId, increment) => {

        // 👇 LIVE MODE 👇
        setBranches(prev => prev.map(b => {
            if (b.id === branchId && b.isRegulator) {
                let newTap = b.currentTap + increment;
                if (newTap > b.maxTaps) newTap = b.maxTaps;
                if (newTap < -b.maxTaps) newTap = -b.maxTaps;
                return { ...b, currentTap: newTap };
            }
            return b;
        }));
    }, []);

    const handleShuntChange = useCallback((nodeId, increment) => {

        // LIVE MODE
        setSystemShunts(prev => {
            const shunt = prev[nodeId];
            if (!shunt) return prev;
            
            let newSteps = shunt.steps + increment;
            if (newSteps < 0) newSteps = 0;
            if (newSteps > shunt.maxSteps) newSteps = shunt.maxSteps;
            
            if (newSteps === shunt.steps) return prev; // Nothing changed
            
            return {
                ...prev,
                [nodeId]: { ...shunt, steps: newSteps }
            };
        });
    }, []);
    
    const toggleFault = (nodeId) => {

        if (faultNodes.has(nodeId)) {
            setFaultNodes(prev => { const newSet = new Set(prev); newSet.delete(nodeId); return newSet; });
            showToast(`Fault removed from bus ${nodeId}`, 'success');
        } else {
            setFaultNodes(prev => { const newSet = new Set(prev); newSet.add(nodeId); return newSet; });
            
            setBranches(prevBranches => {
                const branchesToOpen = new Set();
                const visitedNodes = new Set([nodeId]);
                const queue = [nodeId];

                while (queue.length > 0) {
                    const curr = queue.shift();
                    const connected = prevBranches.filter(b => b.state === 1 && (b.from === curr || b.to === curr));
                    connected.forEach(b => {
                        const neighbor = b.from === curr ? b.to : b.from;
                        if (!visitedNodes.has(neighbor)) {
                            if (b.hasSwitch) { 
                                branchesToOpen.add(b.id); 
                            } else if (allBoundaryNodes.includes(neighbor)) {
                                // 👇 IMPASSABLE BARRIER (LIVE): the Substation busbar does not let the fault through! 👇
                                visitedNodes.add(neighbor);
                            } else { 
                                visitedNodes.add(neighbor); 
                                queue.push(neighbor); 
                            }
                        }
                    });
                }

                if (branchesToOpen.size > 0) {
                    showToast(`Protection tripped! ${branchesToOpen.size} breaker(s) opened to isolate the fault.`, 'warning');
                    return prevBranches.map(b => branchesToOpen.has(b.id) ? { ...b, state: 0 } : b);
                } else {
                    showToast(`Warning: no breaker found to isolate the fault at bus ${nodeId}!`, 'error');
                    return prevBranches;
                }
            });
        }
    };

    // restores only the layout of the floating panels (Reset takes care of the electrical network)
    const resetPanelLayout = () => { resetAllPanels(); showToast('Panels restored to the default layout', 'success'); };

    const resetSystem = () => {
        if (window.confirm("Remove the faults and return the switches to their initial position?")) {
            setFaultNodes(new Set());
            if (initialBranchesRef.current && initialBranchesRef.current.length > 0) {
                setBranches(JSON.parse(JSON.stringify(initialBranchesRef.current)));
            } else {
                setBranches(prev => prev.map(b => ({ ...b, state: 1 })));
            }
             showToast("System restarted successfully!", "success");
        }
    };

    // Start screen buttons now just call the loader:
    const handleLoadNetwork = (n) => applySystemData(buildTransmissionSystem(n.mpc, systemOptions(n)), `${n.label} (transmission)`);

    const handleExportFullState = useCallback((positions, waypoints) => {
        const exportData = {
            version: "1.0", systemName: "Saved System", Vbase: vBase, Sbase: sBase,
            constraints: { vMin: vMinLimit, vMax: vMaxLimit },
            sources: activeSources, 
            feeders: systemFeeders,
            sses: sses,
            shunts: systemShunts,
            loads: systemLoads,
            gd: systemGD, // 👈 Saves the DG in the JSON
            branches: branches, 
            faults: Array.from(faultNodes), 
            layout: { positions: positions, waypoints: waypoints, geoPositions: geoPositions, routes: routedPaths, manualWaypoints: manualWaypoints, straightSegments: straightSegments }
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", "meu_sistema_salvo.json");
        document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove();
        showToast("Project exported successfully!", "success");
    }, [branches, faultNodes, sources]);

    useEffect(() => {
        const handleApplyFullState = (e) => {
            const data = e.detail;
            
            if (data.feeders) setSystemFeeders(data.feeders);
            if (data.sses) setSses(data.sses);
            if (data.shunts) setSystemShunts(data.shunts);
            if (data.gd) setSystemGD(data.gd);

            if (data.branches) setBranches(data.branches);
            if (data.faults) setFaultNodes(new Set(data.faults));
            
            const layoutData = data.layout || data;

            // 👇 1. MACRO MODE (SKELETON) PROTECTION 👇
            if (macroGraph) {
                if (layoutData.positions) {
                    setMacroGraph(prev => ({ ...prev, positions: layoutData.positions }));
                }
                return; // 👈 Prevents the original positions from being overwritten by the "collapsed" ones
            }

            // 👇 2. NORMAL UPDATE 👇
            if (layoutData.positions) {
                if (layoutMode === 'organic') setOrganicPositions(layoutData.positions);
                else setProjectPositions(layoutData.positions);
            }
            if (layoutData.waypoints) {
                if (layoutMode === 'organic') setOrganicWaypoints(layoutData.waypoints);
                else setProjectWaypoints(layoutData.waypoints);
            }
        };
        
        window.addEventListener('applyGraphLayout', handleApplyFullState);
        return () => window.removeEventListener('applyGraphLayout', handleApplyFullState);
        
    }, [layoutMode, macroGraph]); // 👈 IMPORTANT: add macroGraph to the array here!

    useEffect(() => {
        const handleApplyOrganic = (e) => { 
            setOrganicPositions(e.detail.positions); 
            if (e.detail.waypoints) setOrganicWaypoints(e.detail.waypoints);
            setLayoutMode('organic'); 
        };
        window.addEventListener('applyOrganicLayout', handleApplyOrganic);
        return () => window.removeEventListener('applyOrganicLayout', handleApplyOrganic);
    }, []);

    useEffect(() => {
        const handleBeforeUnload = (e) => { if (isProjectLoaded) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => { window.removeEventListener('beforeunload', handleBeforeUnload); };
    }, [isProjectLoaded]);

    const handleExportSVG = () => { 
        exportSVG('sistema-eletrico-svg', 'system_diagram.svg', calcMethod, sources, systemFeeders, darkMode); 
        showToast('Vector diagram downloaded!', 'success'); 
    };
    
    const handleExportPDF = () => { 
        setSelectedElement(null); setTimeout(() => window.print(), 100); 
    };

    useShortcuts({ 
        setShowShortcuts, setPrintFrameMode, setDarkMode, setShowLabels, 
        setCalcMethod, resetSystem, setIsEditMode, handleUndoLayout,
        handleExportSVG 
    });

    if (!isProjectLoaded) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', backgroundColor: darkMode ? '#121212' : '#f0f2f5', color: darkMode ? '#ffffff' : '#333333', fontFamily: 'sans-serif', transition: 'background-color 0.3s' }}>
                <button onClick={() => setDarkMode(!darkMode)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer' }}> {darkMode ? '☀️' : '🌙'} </button>
                <div style={{ background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255, 255, 255, 0.9)', padding: '50px 40px', borderRadius: '16px', boxShadow: darkMode ? '0 10px 40px rgba(0,0,0,0.5)' : '0 10px 40px rgba(0,0,0,0.1)', backdropFilter: 'blur(10px)', textAlign: 'center', maxWidth: '450px', width: '90%', border: darkMode ? '1px solid #333' : '1px solid #fff' }}>
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>⚡</div>
                    <h1 style={{ margin: '0 0 10px 0', fontSize: '22px', color: darkMode ? '#eee' : '#222' }}>Power Systems Simulator</h1>
                    <p style={{ margin: '0 0 30px 0', fontSize: '14px', color: darkMode ? '#aaa' : '#666', lineHeight: '1.5' }}>Generic engine for simulating and visualizing power flow and protection response.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {NETWORKS.map(n => (
                            <React.Fragment key={n.key}>
                          <button onClick={() => handleLoadNetwork(n)} style={{ width: '100%', padding: '14px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: '#ffb300', transition: 'background 0.2s' }} onMouseOver={e => e.target.style.background = darkMode ? '#333' : '#e0e0e0'} onMouseOut={e => e.target.style.background = 'transparent'}> ⚡ Start {n.label} (transmission) </button>
                            </React.Fragment>
                        ))}
                        <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', color: darkMode ? '#555' : '#aaa' }}><div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div><span style={{ padding: '0 10px', fontSize: '12px' }}> OR </span><div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div></div>
                        <input type="file" ref={matFileInputRef} accept=".m" style={{ display: 'none' }} onChange={handleMatpowerFileUpload} />
                        <button onClick={() => matFileInputRef.current.click()} style={{ width: '100%', padding: '14px', border: `1px solid #ffb300`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: '#ffb300' }}> 📥 Import MATPOWER case (.m) — transmission </button>
                    </div>
                    <ContactCard darkMode={darkMode} variant="footer" />
                </div>

                {isCalculatingLayout && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', backdropFilter: 'blur(5px)' }}>
                        <div style={{ fontSize: '50px', animation: 'spin 2s linear infinite', marginBottom: '20px' }}>⚙️</div>
                        <h2 style={{ color: '#00bcd4', marginBottom: '10px' }}>{layoutProgress.msg1}</h2>
                        <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>{layoutProgress.msg2}</p>
                        
                        <div style={{ width: '300px', height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (layoutProgress.passes / 30) * 100)}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                        </div>
                        <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Iteration {layoutProgress.passes} of 30</p>
                        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="app-container">
            <style>
                {`
                .app-container { display: flex !important; flex-direction: row !important; width: 100vw; height: 100vh; overflow: hidden; background-color: ${darkMode ? '#121212' : '#f0f2f5'}; }
                .graph-wrapper { flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; background-color: ${printFrameMode !== 'none' ? (darkMode ? '#080808' : '#cfd3d6') : 'transparent'}; transition: background-color 0.3s ease; }
                .right-panel-wrapper { position: relative; width: ${isFaultSidebarOpen ? '230px' : '0px'}; transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1); flex-shrink: 0; border-left: ${isFaultSidebarOpen ? '1px solid #333' : 'none'}; }
                .right-panel-wrapper > div.panel-content { position: absolute !important; left: 0 !important; top: 0 !important; width: 230px !important; height: 100vh !important; overflow: hidden; background: ${darkMode ? '#1e1e1e' : '#fff'}; }
                .tool-btn:hover { background-color: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}; transform: translateY(-1px); }
                .tool-btn:active { transform: translateY(1px); }
                @media print {
                    @page { size: ${printFrameMode === 'portrait' ? 'portrait' : 'landscape'}; margin: 0mm; }
                    body, html, .app-container { width: 100% !important; height: 100% !important; margin: 0 !important; display: block !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important; }
                    .hide-on-print { display: none !important; }
                    .graph-wrapper { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: transparent !important; display: block !important; }
                    .graph-wrapper, .graph-svg, .graph-svg text {user-select: none !important; -webkit-user-select: none !important; -moz-user-select: none !important; -ms-user-select: none !important; }
                    .paper-container { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; border: none !important; box-shadow: none !important; aspect-ratio: auto !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important;}
                    .graph-svg { width: 100% !important; height: 100% !important; }
                }
                .voltage-glow-wrapper { filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.9)); transition: filter 0.4s ease-in-out; }
                `}
            </style>

            <div className="hide-on-print" style={{ borderRight: '1px solid #333', zIndex: 100 }}>
                {!isEditMode ? (
                    <Sidebar 
                        sidebarMode={sidebarMode} 
                        darkMode={darkMode} 
                        setDarkMode={setDarkMode} 
                        resetSystem={resetSystem} 
                        onResetLayout={transmission ? resetPanelLayout : null}
                        maintenanceMode={maintenanceMode} 
                        setMaintenanceMode={setMaintenanceMode} 
                        showLabels={showLabels} 
                        setShowLabels={setShowLabels} 
                        selectedElement={displayElement} 
                        sources={sources} 
                        loads={loads} 
                        faultNodes={faultNodes} 
                        branches={displayBranches} 
                        toggleSwitch={toggleSwitch} 
                        setSelectedElement={setSelectedElement} 
                        setHoveredLineId={setHoveredLineId} 
                        calcMethod={transmission ? (solverMode === 'ac' ? (backendStatus === 'offline' ? 'DC*' : 'AC') : (solverMode === 'genco' ? 'GENCO' : 'DC')) : calcMethod} 
                        solverMode={solverMode} 
                        onSolverMode={setSolverMode} 
                        acOffline={backendStatus === 'offline'} 
                        gencoAvailable={!!storedEntry} 
                        gencoNote={gencoLines ? (gencoView ? 'GENCO estimate, precomputed for this state.' : 'GENCO estimates are precomputed for the intact network and for single-line outages (not for bus faults or several faults).') : 'GENCO estimates are not available for this network.'} 
                        transmission={transmission} 
                        nodeColorMode={nodeColorMode} 
                        setNodeColorMode={setNodeColorMode} 
                        voltageAvailable={voltageOk} 
                        setCalcMethod={transmission ? () => setSolverMode(m => (m === 'ac' ? 'dc' : 'ac')) : setCalcMethod} 
                        solverTitle={transmission ? (solverMode === 'ac' ? (backendStatus === 'online' ? `Backend AC (${backendMsg}). Click to go back to the local DC.` : (backendStatus === 'offline' ? `Backend unavailable: ${backendMsg}. Showing local DC (*). Click to go back to the DC.` : 'Querying the backend...')) : 'Local DC (JavaScript). Click to use the backend AC.') : ''} 
                        onExportSVG={handleExportSVG} 
                        onExportPDF={handleExportPDF} 
                        getNodeColor={getNodeColor} 
                        getEdgeColor={getEdgeColor} 
                        systemSize={Math.max(0, allNodes.length)} 
                        disconnectedStats={disconnectedStats} 
                        lineCurrents={lineCurrents} 
                        feedersList={systemFeeders}
                        nodeData={nodeData}
                        shedBuses={shedBuses}
                        systemLoads={systemLoads}
                        systemShunts={systemShunts}
                        setViewMode={setViewMode}
                        sBase={sBase}
                        sses={sses}
                        handleTapChange={handleTapChange}
                        handleShuntChange={handleShuntChange}
                        viewMode={viewMode}
                        vBase={vBase} 
                        systemGD={systemGD}
                        toggleGD={toggleGD}
                        handleGDChange={handleGDChange}
                    />
                ) : (
                    <EditSidebar 
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        darkMode={darkMode} 
                        onUndo={handleUndoLayout} 
                        canUndo={layoutHistory.length > 0} 
                        onReset={handleResetToOriginalLayout} 
                        branches={branches} 
                        allNodes={allNodes} 
                        sources={sources} 
                        currentPositions={activePositions}
                        setIsCalculatingLayout={setIsCalculatingLayout}
                        setLayoutProgress={setLayoutProgress}
                    />
                )}
            </div>

            {macroGraph && (
                <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, background: '#ff5722', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', display: 'flex', gap: '15px', alignItems: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
                    <span>⚠️ Debug Mode: Coarsened Graph</span>
                    
                    {/* 👇 APPLY BUTTON 👇 */}
                    <button 
                        onClick={() => {
                            const basePos = layoutMode === 'organic' ? (organicPositions || projectPositions) : projectPositions;
                            
                            let coarseInfo = macroGraph.macroData?.coarseData;
                            
                            // Safeguard 1: deterministic recomputation
                            if (!coarseInfo || (!coarseInfo.prunedMap && !coarseInfo.chainMap)) {
                                console.log("⚙️ Rebuilding the skeleton pruning map...");
                                const contraction = contractTopology(allNodes, branches, sources);
                                coarseInfo = contraction.coarseData;
                            }
                            
                            // Unfolds the skeleton back to the 54 nodes
                            const newFullPositions = expandTopology(
                                macroGraph.positions,
                                coarseInfo, 
                                basePos
                            );

                            
                            // 👇 SAFEGUARD 2: cliff prevention
                            const safeFullPositions = { ...basePos, ...newFullPositions };
                            
                            // 👇 THE ENGINEERING MASTERSTROKE 👇
                            const skeletonIds = Object.keys(macroGraph.positions);
                            
                            // ❌ We removed the accordion capture from here! 
                            // Now ONLY the Skeleton anchors get "lead boots"
                            const fixedIds = [...skeletonIds];
                            
                            // Runs the CONSTRAINED physics (now passing coarseInfo)
                            const finalRelaxedPositions = relaxExpandedNodes(
                                safeFullPositions, 
                                fixedIds, // Only the skeleton is locked
                                allNodes, 
                                branches,
                                coarseInfo // 👈 IMPORTANT: pass the pruning memory here!
                            );
                            
                            // Saves the RELAXED positions in the official state
                            if (layoutMode === 'organic') {
                                setOrganicPositions(finalRelaxedPositions);
                            } else {
                                setProjectPositions(finalRelaxedPositions);
                            }
                            
                            // Ends the debug mode
                            setMacroGraph(null);
                        }} 
                        style={{ background: '#4caf50', color: '#fff', border: 'none', borderRadius: '15px', padding: '5px 15px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }} 
                        onMouseOver={e => e.target.style.transform='scale(1.05)'} 
                        onMouseOut={e => e.target.style.transform='scale(1)'}
                    >
                        ✔ Expand and Save
                    </button>

                    {/* 👇 DISCARD BUTTON 👇 */}
                    <button 
                        onClick={() => setMacroGraph(null)} 
                        style={{ background: '#fff', color: '#ff5722', border: 'none', borderRadius: '15px', padding: '5px 15px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }} 
                        onMouseOver={e => e.target.style.transform='scale(1.05)'} 
                        onMouseOut={e => e.target.style.transform='scale(1)'}
                    >
                        ❌ Discard
                    </button>
                </div>
            )}

            <div className="graph-wrapper">
                {/* ... Floating buttons kept ... */}
                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', top: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px', borderRadius: '14px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Left Menu" onClick={() => {if (isEditMode) setIsEditMode(false); else setSidebarMode(p => p === 'full' ? 'mini' : (p === 'mini' ? 'hidden' : 'full'))}}>≡</button>
                    <div style={{ height: '1px', width: '70%', margin: '2px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: isEditMode ? '#ff9800' : (darkMode ? '#fff' : '#333'), transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Edit Mode" onClick={() => setIsEditMode(!isEditMode)}>✏️</button>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Shortcuts" onClick={() => setShowShortcuts(true)}>⌨️</button>
                    
                </div>

                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', bottom: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px 6px', borderRadius: '20px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Center the Chart" onClick={() => window.dispatchEvent(new CustomEvent('triggerZoomExtents'))}>🎯</button>
                    <div style={{ height: '1px', width: '60%', margin: '4px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', flexDirection: 'column' }} title="Toggle Sheet / Full Screen" onClick={() => setPrintFrameMode(prev => prev === 'none' ? 'landscape' : (prev === 'landscape' ? 'portrait' : 'none'))}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: printFrameMode !== 'none' ? '#ff9800' : 'inherit' }}>A4</span>
                        <span style={{ opacity: 0.8, fontSize: '10px' }}>{printFrameMode === 'none' ? '🔲' : (printFrameMode === 'landscape' ? '↔' : '↕')}</span>
                    </button>
                    <div style={{ height: '1px', width: '60%', margin: '4px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', opacity: showLegend ? 1 : 0.4 }} title="Show/Hide Legend" onClick={() => setShowLegend(!showLegend)}>👁️</button>
                </div>

                {printFrameMode !== 'none' && (
                    <div className="hide-on-print" style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 9000, background: '#ff9800', color: '#000', padding: '6px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}> Print Preview: {printFrameMode === 'landscape' ? 'Landscape' : 'Portrait'} (Ctrl+P to Print) </div>
                )}

                {/* 👇 NEW PANEL 👇 */}
                {/* LAYOUT POLISHING PANEL (ONLY APPEARS IN EDIT MODE) */}
                {isEditMode && (
                    <div className="hide-on-print" style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', gap: '15px', alignItems: 'center', background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255,255,255,0.8)', padding: '10px 20px', borderRadius: '30px', backdropFilter: 'blur(10px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                        
                        {/* Crossings indicator (now an interactive button) */}
                        <button 
                            onClick={() => setShowCrossings(!showCrossings)}
                            title="Show/Hide crossing markers"
                            style={{ 
                                background: intersections.length > 0 ? (showCrossings ? '#f44336' : '#d32f2f') : '#4caf50', 
                                color: '#fff', 
                                padding: '6px 12px', 
                                borderRadius: '20px', 
                                fontSize: '12px', 
                                fontWeight: 'bold', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '5px',
                                border: 'none',
                                cursor: intersections.length > 0 ? 'pointer' : 'default',
                                transition: 'all 0.2s',
                                opacity: showCrossings || intersections.length === 0 ? 1 : 0.6
                            }}
                            onMouseOver={e => intersections.length > 0 && (e.target.style.transform='scale(1.05)')}
                            onMouseOut={e => intersections.length > 0 && (e.target.style.transform='scale(1)')}
                        >
                            {intersections.length > 0 
                                ? `⚠️ ${intersections.length} Crossings ${showCrossings ? '(Hide)' : '(Show)'}` 
                                : '✅ No Crossings'}
                        </button>

                        {/* Compactor Engine */}
                        <button 
                            onClick={() => {
                                const newPos = compactPositions(activePositions, 0.90); // 0.90 = Shrinks 10%
                                if (layoutMode === 'organic') setOrganicPositions(newPos);
                                else setProjectPositions(newPos);
                            }}
                            title="Moves the buses 10% toward the center"
                            style={{ background: '#00bcd4', color: '#000', border: 'none', borderRadius: '20px', padding: '6px 15px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseOver={e => e.target.style.transform='scale(1.05)'}
                            onMouseOut={e => e.target.style.transform='scale(1)'}
                        >
                            🗜️ Compactar (10%)
                        </button>

                        {/* Expander Engine (NEW) */}
                        <button 
                            onClick={() => {
                                const newPos = compactPositions(activePositions, 1.10); // 1.10 = Expands 10%
                                if (layoutMode === 'organic') setOrganicPositions(newPos);
                                else setProjectPositions(newPos);
                            }}
                            title="Moves the buses 10% away from the center"
                            style={{ background: '#00bcd4', color: '#000', border: 'none', borderRadius: '20px', padding: '6px 15px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseOver={e => e.target.style.transform='scale(1.05)'}
                            onMouseOut={e => e.target.style.transform='scale(1)'}
                        >
                            🌌 Expand (10%)
                        </button>
                    </div>
                )}
                {/* 👆 END OF PANEL 👆 */}

                {/* 👇 VIEW SWITCHING HAPPENS HERE 👇 */}
                {viewMode === 'schematic' ? (
                    <GraphArea 
                        darkMode={darkMode}
                        getNodeShed={getNodeShed} shedBuses={shedBuses}
                        printFrameMode={printFrameMode} 
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        branches={macroGraph?.macroData?.branches || displayBranches} 
                        allNodes={macroGraph?.macroData?.nodes || allNodes} 
                        sources={sources} showLabels={showLabels} 
                        getEdgeColor={getEdgeColor} 
                        getEdgeWidth={getEdgeWidth} 
                        generatorBuses={generatorBuses} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        selectedElement={selectedElement} 
                        hoveredLineId={effectiveHoveredLineId} 
                        setHoveredLineId={setHoveredLineId} 
                        hoveredNodeId={hoveredNodeId} 
                        setHoveredNodeId={setHoveredNodeId} 
                        maintenanceMode={maintenanceMode} 
                        activePositions={activePositions} 
                        activeWaypoints={activeWaypoints} 
                        lineCurrents={lineCurrents} 
                        nodeData={nodeData} 
                        nodeFeeds={nodeFeeds}
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        onSaveLayoutToHistory={saveLayoutToHistory} 
                        loads={loads} systemLoads={systemLoads} 
                        onExportRequest={handleExportFullState} 
                        sses={sses} 
                        feedersList={systemFeeders} 
                        handleTapChange={handleTapChange}
                        systemShunts={systemShunts} 
                        handleShuntChange={handleShuntChange}
                        systemGD={systemGD}    // 👈 Add this line
                        toggleGD={toggleGD}    // 👈 Add this line (if used inside GraphArea)
                        intersections={intersections}
                        showCrossings={showCrossings}
                        vMinLimit={vMinLimit}
                        vMaxLimit={vMaxLimit}
                        busLimits={voltageLimits}
                    >
                        {showLegend && (
                            <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                                <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                    <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                    <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                        <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> DESIGN </button>
                                        <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGANIC </button>
                                    </div>
                                </div>
                                
                                {sources.map(s => (
                                    <div key={s} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...systemFeeders], darkMode) }}></div> {transmission ? 'Reference bus' : `SUB ${s}`}</div>
                                ))}
                                {systemFeeders.map(f => (
                                    <div key={f} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...systemFeeders], darkMode) }}></div> FEEDER {f}</div>
                                ))}

                                {transmission && (<div className="legend-item"><svg width="14" height="14" viewBox="-7 -7 14 14"><polygon points="0,-6 6,0 0,6 -6,0" fill="#5b8bd6" /></svg> Generator</div>)}
                                {shedNodes && (<div className="legend-item"><div className="legend-dot" style={{ background: 'transparent', border: '2px dashed #0a84ff', boxSizing: 'border-box' }}></div> Load shed (bus stays energized)</div>)}
                                {redispatchNodes && (<div className="legend-item"><div className="legend-dot" style={{ background: '#ab47bc' }}></div> Redispatched generator</div>)}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Fault/Overload</div>
                                {transmission && (<div className="legend-item" title="Line loading as % of the thermal limit (rateA); the line also gets thicker with load. Above 100% it turns red (overload)."><div style={{ width: 54, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, rgb(74,120,194), rgb(110,185,235) 50%, rgb(236,236,226) 68%, rgb(255,210,63) 82%, rgb(255,122,26) 95%, rgb(230,81,0))' }}></div> Load 0 → 100%</div>)}
                                {voltageMode && (<div className="legend-item" title="Bus voltage: blue = low, light = 1.0 pu, red = high (case limits)"><div style={{ width: 54, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, rgb(33,102,172), rgb(236,236,236), rgb(178,24,43))' }}></div> Voltage (buses)</div>)}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> De-energized</div>
                            </div>
                        )}
                    </GraphArea>
                ) : (
                    <MapArea 
                        darkMode={darkMode}
                        branches={branches} 
                        sources={sources} 
                        feedersList={systemFeeders} 
                        sses={sses}
                        getEdgeColor={getEdgeColor} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        nodeData={nodeData}
                        lineCurrents={lineCurrents}
                        isEditMode={isEditMode}
                        systemShunts={systemShunts}
                        hoveredLineId={hoveredLineId}
                        setHoveredLineId={setHoveredLineId}
                        hoveredNodeId={hoveredNodeId}
                        setHoveredNodeId={setHoveredNodeId}
                        loads={loads}
                        systemLoads={systemLoads}
                        allNodes={allNodes}
                        svgPositions={activePositions}
                        geoPositions={geoPositions}
                        setGeoPositions={setGeoPositions}
                        routedPaths={routedPaths}
                        setRoutedPaths={setRoutedPaths}
                        manualWaypoints={manualWaypoints}
                        setManualWaypoints={setManualWaypoints}
                        straightSegments={straightSegments}
                        setStraightSegments={setStraightSegments}
                        systemGD={systemGD}
                        toggleGD={toggleGD}
                    >
                        {/* 👇 THE LEGEND IS NOW SENT INSIDE THE MAP 👇 */}
                        {showLegend && (
                            <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                                <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                    <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                    <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                        <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> DESIGN </button>
                                        <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGANIC </button>
                                    </div>
                                </div>
                                {sources.map(s => (
                                    <div key={s} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...systemFeeders], darkMode) }}></div> SUB {s}</div>
                                ))}
                                {systemFeeders.map(f => (
                                    <div key={f} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...systemFeeders], darkMode) }}></div> FEEDER {f}</div>
                                ))}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Fault/Overload</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> De-energized</div>
                            </div>
                        )}
                    </MapArea>
                )}
            </div>

            <div className="hide-on-print right-panel-wrapper" style={{ zIndex: 100 }}>
                <div onClick={() => setFaultSidebarOpen(!isFaultSidebarOpen)} title={isFaultSidebarOpen ? "Hide Panel" : "Element Directory"} style={{ position: 'absolute', left: '-28px', top: 'calc(50% - 35px)', width: '28px', height: '70px', background: darkMode ? '#1e1e1e' : '#fff', borderTop: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderBottom: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderLeft: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderRadius: '12px 0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', color: '#ff9800', zIndex: 101, transition: 'background-color 0.2s' }}> {isFaultSidebarOpen ? '▶' : '⚡'} </div>
                <div className="panel-content">
                    <FaultPanel 
                        getNodeShed={getNodeShed}
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        setFaultSidebarOpen={setFaultSidebarOpen} 
                        sources={sources} 
                        loadNodes={loadNodes} 
                        faultNodes={faultNodes} 
                        nodeFeeds={nodeFeeds} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        selectedElement={displayElement} 
                        setHoveredNodeId={setHoveredNodeId} 
                        getNodeColor={getNodeColor} 
                        darkMode={darkMode} 
                        THEME={THEME} 
                        branches={displayBranches} 
                        feedersList={systemFeeders}
                        
                        // 👇 ADDED FOR THE SWITCH LIST THAT NOW LIVES HERE 👇
                        toggleSwitch={toggleSwitch}
                        setHoveredLineId={setHoveredLineId}
                        loopNodes={loopNodes}
                    />
                </div>
            </div>

            {showShortcuts && (
                <div className="hide-on-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setShowShortcuts(false)}>
                    <div style={{ background: darkMode ? '#222' : '#fff', color: darkMode ? '#fff' : '#000', padding: '25px', borderRadius: '12px', width: '350px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #555', paddingBottom: '10px' }}>Keyboard Shortcuts</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '2' }}>
                            <li><strong style={{ color: '#00bcd4' }}>Click (Switch)</strong> - Open/Close Switch</li>
                            <li><strong style={{ color: '#00bcd4' }}>Click (Bus)</strong> - Add/Remove Fault</li>
                            <li><strong style={{ color: '#ff9800' }}>Ctrl + Click</strong> - Inspect Element (Fixed Selection)</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Click</strong> - Pin/Unpin Tooltip (Post-it)</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Drag Background</strong> - Multiple Selection (Edit Mode)</li>
                            <li><strong style={{ color: '#ff9800' }}>Double Click (Line)</strong> - Add/Remove Bend (Edit Mode)</li>
                            <hr style={{ borderColor: '#444', margin: '8px 0' }} />
                            <li><strong style={{ color: '#4caf50' }}>Z</strong> - Center Diagram on Screen</li>
                            <li><strong style={{ color: '#4caf50' }}>P</strong> - Toggle Landscape/Portrait (Print)</li>
                            <li><strong style={{ color: '#4caf50' }}>Ctrl + P</strong> - Print / Save PDF</li>
                            <li><strong style={{ color: '#4caf50' }}>E</strong> - Enter/Leave Edit Mode</li>
                            <li><strong style={{ color: '#4caf50' }}>D</strong> - Toggle Theme (Dark/Light)</li>
                            <li><strong style={{ color: '#4caf50' }}>L</strong> - Show/Hide Labels</li>
                            <li><strong style={{ color: '#4caf50' }}>M</strong> - Toggle Method (NR / GS)</li>
                            <li><strong style={{ color: '#4caf50' }}>R</strong> - Restart System (Clear Faults)</li>
                        </ul>
                        <button onClick={() => setShowShortcuts(false)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: '#00bcd4', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>Close</button>
                    </div>
                </div>
            )}
            
            
            {toast && <div className="toast">{toast.message}</div>}
            {transmission && <ContactCard darkMode={darkMode} />}
            {transmission && solverMode === 'genco' && (
                <div data-testid="genco-view-chip" style={{ position: 'fixed', top: REPLAY ? 38 : 8, left: '50%', transform: 'translateX(-50%)', zIndex: 949, background: 'rgba(103,58,183,0.95)', color: '#fff', padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 'bold', maxWidth: '80vw', textAlign: 'center' }}
                    title="Everything shown comes from the voltages that GENCO (Tiny checkpoint from the authors) predicts for this state (AC-OPF base dispatch, no redispatch): the line flows and the reference-bus generation are computed from them with the same admittances as the AC.">
                    {gencoView
                        ? `🧠 GENCO estimate (precomputed) · loading error vs AC: mean ${gencoError.mean.toFixed(2)} pt, max ${gencoError.max.toFixed(1)} pt${gencoRef ? ` · reference bus ${gencoRef.bus}: ${gencoRef.genco.toFixed(0)} MW (AC ${gencoRef.ac.toFixed(0)} MW)` : ''}`
                        : '🧠 GENCO view needs the intact network or exactly one line out (no bus faults) · showing the local DC'}
                </div>
            )}
            {REPLAY && transmission && (
                <div style={{ position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 950, background: 'rgba(255,143,0,0.95)', color: '#000', padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 'bold' }}
                    title="This page is static: GitHub Pages has no server, so it replays results precomputed by the backend (AC). It is a hosting limit, not a limit of the tool: with the backend running (README) any fault is computed live.">STATIC DEMO · precomputed results ({networkOf(transmission.gridName)?.label || transmission.gridName}) · pick a fault in the N-1 screening 📊</div>
            )}
            {transmission && !recoveryOpen && (
                <CorrectivePanel darkMode={darkMode} busy={correctiveBusy} data={corrective?.data || null} stage={corrective?.stage || 'pre'}
                    caption={corrective ? stageCaption(corrective.data, corrective.stage, faultsText(corrective.data, branches)) : ''}
                    setStage={(s) => setCorrective(c => (c ? { ...c, stage: s } : c))} playing={correctivePlaying} setPlaying={setCorrectivePlaying}
                    verification={verificationFor(gencoNet?.verification, corrective?.data?.faults)}
                    onRun={runCorrective} onClear={clearCorrective} onOpenScreening={() => setScreeningOpen(true)} onOpenRecovery={() => setRecoveryOpen(true)} />
            )}
            {transmission && recoveryOpen && (
                <RecoveryPanel darkMode={darkMode} busy={recoveryBusy} items={currentFaultItems} order={repairOrder} setOrder={setRepairOrder}
                    options={recoveryOptions} setOptions={setRecoveryOptions} data={recovery?.data || null} index={recovery?.index || 0}
                    setIndex={setRecoveryIndex} playing={recoveryPlaying} setPlaying={setRecoveryPlaying}
                    onRun={runRecovery} onReset={resetRecovery} onClose={closeRecovery} />
            )}
            {transmission && screeningOpen && (
                <ScreeningPanel darkMode={darkMode} busy={screeningBusy} data={screening} genco={gencoNet?.screening || null} verif={gencoNet?.verification || null} verifAlt={gencoNet?.verificationAlt || null}
                    onRun={runScreening} onClose={() => setScreeningOpen(false)} onSelect={selectContingency} />
            )}


            {/* 👇 WORKER LOADING SCREEN 👇 */}
            {isCalculatingLayout && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', backdropFilter: 'blur(5px)' }}>
                    <div style={{ fontSize: '50px', animation: 'spin 2s linear infinite', marginBottom: '20px' }}>⚙️</div>
                    <h2 style={{ color: '#00bcd4', marginBottom: '10px' }}>{layoutProgress.msg1}</h2>
                    <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>{layoutProgress.msg2}</p>
                    
                    <div style={{ width: '300px', height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (layoutProgress.passes / 30) * 100)}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                    </div>
                    <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Iteration {layoutProgress.passes} of 30</p>
                    <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}
        </div>
    );
}

export default App;