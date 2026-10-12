import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import SvgTooltips from './SvgTooltips';
import GraphEdge from './GraphEdge';
import GraphNode from './GraphNode';
import CanvasOverlay from './CanvasOverlay'; // 👈 Adicione este import

const FIXED_GRID_SIZE = 10;

function getClosestSegmentIndex(p1, p2, waypoints, clickPt) {
    if (!p1 || !p2 || !clickPt) return 0; 
    const pts = [p1, ...waypoints, p2];
    let minIdx = 0; let minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]; const b = pts[i + 1];
        const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
        let t = l2 === 0 ? 0 : ((clickPt.x - a.x) * (b.x - a.x) + (clickPt.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        const dist = Math.sqrt(Math.pow(clickPt.x - proj.x, 2) + Math.pow(clickPt.y - proj.y, 2));
        if (dist < minDist) { minDist = dist; minIdx = i; }
    }
    return minIdx;
}

// 👇 MATEMÁTICA DE RAYCASTING (FASE 2 DO CANVAS) 👇
const getEuclideanDist = (x1, y1, x2, y2) => Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

const getDistToSegment = (p, v, w) => {
    const l2 = Math.pow(w.x - v.x, 2) + Math.pow(w.y - v.y, 2);
    if (l2 === 0) return getEuclideanDist(p.x, p.y, v.x, v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return getEuclideanDist(p.x, p.y, v.x + t * (w.x - v.x), v.y + t * (w.y - v.y));
};

export default function GraphArea({
    branches = [], allNodes = [], sources = [], showLabels, getEdgeColor, getEdgeWidth, generatorBuses, getNodeColor, toggleSwitch, toggleFault, setSelectedElement,
    selectedElement, hoveredLineId, setHoveredLineId, hoveredNodeId, setHoveredNodeId, maintenanceMode,
    activePositions = {}, activeWaypoints = {}, lineCurrents = {}, nodeData = {}, isEditMode, setIsEditMode, darkMode,
    printFrameMode, isFaultSidebarOpen, onSaveLayoutToHistory, children, onExportRequest, loads,
    systemLoads, sses, feedersList = [], systemShunts, nodeFeeds, clusterThreshold = 0.35, faultNodes = new Set(), 
    systemGD, toggleGD, intersections = [], showCrossings,
    vMinLimit = 0.95, vMaxLimit = 1.05
}) {
    const svgRef = useRef(null);
    const measureRef = useRef(null); 
    
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    // Níveis de Detalhe
    const isDetailed = transform.scale > 0.9; // LOD 0: Componentes SVG Completos
    const isSimplified = transform.scale <= 0.9 && transform.scale >= 0.35; // LOD 1: SVG Simplificado (Ativo apenas no "meio do caminho")
    const isCanvas = transform.scale < 0.35;  // LOD 2: Renderizador de Alta Performance (Canvas)

    // 👇 ANTENA DE RASTREIO DO MOUSE NO SVG 👇
    const [mouseSvgPt, setMouseSvgPt] = useState({ x: 0, y: 0 });

    const [renderPositions, setRenderPositions] = useState(activePositions);
    const [renderWaypoints, setRenderWaypoints] = useState(activeWaypoints);

    const [manualPositions, setManualPositions] = useState({});
    const [manualWaypoints, setManualWaypoints] = useState({}); 

    const manualPosRef = useRef({});
    const renderPosRef = useRef({});
    const manualWpRef = useRef({});
    const renderWpRef = useRef({});

    const [pinnedCards, setPinnedCards] = useState([]);
    const [draggingCard, setDraggingCard] = useState(null);

    useEffect(() => {
        manualPosRef.current = manualPositions;
        renderPosRef.current = renderPositions;
        manualWpRef.current = manualWaypoints;
        renderWpRef.current = renderWaypoints;
    });

    useEffect(() => {
        let startTime = null; let animationFrameId;

        const startPositions = {};
        Object.keys(activePositions).forEach(id => {
            startPositions[id] = manualPosRef.current[id] || renderPosRef.current[id] || activePositions[id];
        });

        const startWaypoints = {};
        const safeActiveWps = activeWaypoints || {};
        const allWpKeys = new Set([...Object.keys(manualWpRef.current), ...Object.keys(renderWpRef.current), ...Object.keys(safeActiveWps)]);
        allWpKeys.forEach(k => {
            startWaypoints[k] = manualWpRef.current[k] || renderWpRef.current[k] || safeActiveWps[k] || [];
        });

        setManualPositions({});
        setManualWaypoints({});

        const duration = 600;

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            let progress = (timestamp - startTime) / duration;
            if (progress > 1) progress = 1;

            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            
            const currentPositions = {};
            for (let key in activePositions) {
                const startP = startPositions[key] || activePositions[key];
                const endP = activePositions[key];
                currentPositions[key] = { x: startP.x + (endP.x - startP.x) * ease, y: startP.y + (endP.y - startP.y) * ease };
            }

            const currentWaypoints = {};
            for (let key in safeActiveWps) {
                const endWpArray = safeActiveWps[key] || [];
                const startWpArray = startWaypoints[key] || [];
                
                if (startWpArray.length !== endWpArray.length) {
                    currentWaypoints[key] = endWpArray.map(wp => ({ ...wp })); 
                } else {
                    currentWaypoints[key] = endWpArray.map((endWp, idx) => {
                        const startWp = startWpArray[idx];
                        if (startWp) {
                            return { x: startWp.x + (endWp.x - startWp.x) * ease, y: startWp.y + (endWp.y - startWp.y) * ease };
                        }
                        return { ...endWp }; 
                    });
                }
            }

            setRenderPositions(currentPositions);
            setRenderWaypoints(currentWaypoints);

            if (progress < 1) animationFrameId = requestAnimationFrame(animate);
        };

        animationFrameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePositions, activeWaypoints]); 

    const [dragInfo, setDragInfo] = useState(null); 
    const wasDragged = useRef(false);

    const [selectedEditNodes, setSelectedEditNodes] = useState(new Set());
    const [selectedEditWaypoints, setSelectedEditWaypoints] = useState(new Set()); 
    const [selectionBox, setSelectionBox] = useState(null);
    const isSelecting = useRef(false);
    const [isRestoringLayout, setIsRestoringLayout] = useState(false);
    const restoreTimeout = useRef(null);

    const [isHoveringSVG, setIsHoveringSVG] = useState(false);
    const [localHoveredNode, setLocalHoveredNode] = useState(null);
    const [localHoveredLine, setLocalHoveredLine] = useState(null);

    const [isAnimatingZoom, setIsAnimatingZoom] = useState(false);
    const zoomTimeout = useRef(null);

    const lastMouseUpdate = useRef(0); // 👈 Controle de FPS para o Tooltip

    const stopAnimation = useCallback(() => {
        if (isAnimatingZoom) setIsAnimatingZoom(false);
        if (zoomTimeout.current) {
            clearTimeout(zoomTimeout.current);
            zoomTimeout.current = null;
        }
    }, [isAnimatingZoom]);

    const [containerSize, setContainerSize] = useState({ w: 900, h: 650 });
    
    useEffect(() => {
        const updateSize = () => {
            if (measureRef.current) {
                const rect = measureRef.current.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    setContainerSize({ w: rect.width, h: rect.height });
                }
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        const timer = setTimeout(updateSize, 350); 
        return () => { window.removeEventListener('resize', updateSize); clearTimeout(timer); };
    }, [printFrameMode, isFaultSidebarOpen, isEditMode]);

    useEffect(() => {
        if (!isEditMode) {
            setSelectedEditNodes(new Set());
            setSelectedEditWaypoints(new Set());
            setSelectionBox(null);
        }
    }, [isEditMode]);

    const getCurrentFullLayout = useCallback(() => {
        const fullPositions = {};
        allNodes.forEach(id => { fullPositions[id] = manualPositions[id] || renderPositions[id]; });
        
        const fullWaypoints = {};
        const allWpKeys = new Set([...Object.keys(manualWaypoints), ...Object.keys(renderWaypoints)]);
        allWpKeys.forEach(k => {
            fullWaypoints[k] = manualWaypoints[k] || renderWaypoints[k];
        });

        return { positions: fullPositions, waypoints: JSON.parse(JSON.stringify(fullWaypoints)) };
    }, [allNodes, manualPositions, renderPositions, manualWaypoints, renderWaypoints]);

    useEffect(() => {
        const handleApplyLayout = (e) => {
            setIsRestoringLayout(true);
            if (restoreTimeout.current) clearTimeout(restoreTimeout.current);
            restoreTimeout.current = setTimeout(() => setIsRestoringLayout(false), 400);
        };
        
        const handleResetLayout = () => {
            setIsRestoringLayout(true);
            if (restoreTimeout.current) clearTimeout(restoreTimeout.current);
            restoreTimeout.current = setTimeout(() => setIsRestoringLayout(false), 400);
        };

        const handleTriggerExport = () => {
            const fullLayout = getCurrentFullLayout();
            if (onExportRequest) onExportRequest(fullLayout.positions, fullLayout.waypoints);
        };

        const handleSaveHistory = () => {
            if (onSaveLayoutToHistory) onSaveLayoutToHistory(getCurrentFullLayout().positions, getCurrentFullLayout().waypoints);
        };

        const handleGetLatestLayout = (e) => {
            if (e.detail && e.detail.callback) {
                const fullPositions = {};
                allNodes.forEach(id => {
                    fullPositions[id] = manualPosRef.current[id] || renderPosRef.current[id] || activePositions[id];
                });
                
                const fullWaypoints = {};
                const allWpKeys = new Set([...Object.keys(manualWpRef.current), ...Object.keys(renderWpRef.current)]);
                allWpKeys.forEach(k => {
                    fullWaypoints[k] = manualWpRef.current[k] || renderWpRef.current[k] || (activeWaypoints ? activeWaypoints[k] : []);
                });

                e.detail.callback({
                    positions: fullPositions,
                    waypoints: JSON.parse(JSON.stringify(fullWaypoints)),
                    selectedNodes: selectedEditNodes.size > 0 ? [...selectedEditNodes].map(String) : null,
                });
            }
        };

        window.addEventListener('applyGraphLayout', handleApplyLayout);
        window.addEventListener('resetGraphLayout', handleResetLayout);
        window.addEventListener('requestLayoutExport', handleTriggerExport);
        window.addEventListener('getLatestLayout', handleGetLatestLayout);
        window.addEventListener('saveLayoutToHistory', handleSaveHistory);
        
        return () => { 
            window.removeEventListener('applyGraphLayout', handleApplyLayout); 
            window.removeEventListener('resetGraphLayout', handleResetLayout); 
            window.removeEventListener('requestLayoutExport', handleTriggerExport);
            window.removeEventListener('getLatestLayout', handleGetLatestLayout);
            window.removeEventListener('saveLayoutToHistory', handleSaveHistory);
        };
    }, [getCurrentFullLayout, onExportRequest, onSaveLayoutToHistory]);

    const isPanning = useRef(false);
    const hasMoved = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    
    const getRawSVGPoint = useCallback((clientX, clientY) => {
        const svg = svgRef.current;
        if (!svg) return { x: clientX, y: clientY };
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }, []);

    const getTransformedPoint = useCallback((clientX, clientY) => {
        const rawPt = getRawSVGPoint(clientX, clientY);
        return { x: (rawPt.x - transform.x) / transform.scale, y: (rawPt.y - transform.y) / transform.scale };
    }, [getRawSVGPoint, transform.x, transform.y, transform.scale]);

    const contextRef = useRef({});
    useEffect(() => {
        contextRef.current = {
            isEditMode, maintenanceMode, toggleSwitch, toggleFault,
            selectedEditNodes, selectedEditWaypoints,
            manualPositions, renderPositions, manualWaypoints, renderWaypoints,
            onSaveLayoutToHistory, getCurrentFullLayout, branches, dragInfo, setSelectedElement
        };
    });
    
    const handleLineMouseDown = useCallback((e, branchId) => {
        e.preventDefault();
        const ctx = contextRef.current;

        if (!ctx.isEditMode) {
            if (e.shiftKey) {
                const branch = ctx.branches.find(b => b.id === branchId);
                if (branch) ctx.setSelectedElement({ type: 'edge', data: branch });
                e.stopPropagation();
            }
            return; 
        }

        const branch = ctx.branches.find(b => b.id === branchId);
        if (branch) ctx.setSelectedElement({ type: 'edge', data: branch });

        e.stopPropagation(); 
        wasDragged.current = false;
        
        const svgPt = getTransformedPoint(e.clientX, e.clientY);
        if (ctx.onSaveLayoutToHistory) ctx.onSaveLayoutToHistory(ctx.getCurrentFullLayout().positions, ctx.getCurrentFullLayout().waypoints);
        
        const p1 = ctx.manualPositions[branch.from] || ctx.renderPositions[branch.from];
        const p2 = ctx.manualPositions[branch.to] || ctx.renderPositions[branch.to];
        const wps = ctx.manualWaypoints[branchId] || ctx.renderWaypoints[branchId] || [];
        const waypoints = Array.isArray(wps) ? wps : [];
        
        const insertIdx = getClosestSegmentIndex(p1, p2, waypoints, svgPt);
        setDragInfo({ type: 'line', branchId, insertIdx, startX: svgPt.x, startY: svgPt.y });
    }, [getTransformedPoint]);

    const handleLineClick = useCallback((e, branchId) => {
        e.stopPropagation();
        const ctx = contextRef.current;
        if (ctx.isEditMode) return;

        if (e.ctrlKey || e.metaKey) {
            const branch = ctx.branches.find(b => b.id === branchId);
            ctx.setSelectedElement({ type: 'edge', data: branch });
            return; // SEM tooltip, SEM toggleSwitch
        }
        if (e.shiftKey) {
            const branch = ctx.branches.find(b => b.id === branchId);
            ctx.setSelectedElement({ type: 'edge', data: branch });
            const rawPt = getRawSVGPoint(e.clientX, e.clientY);
            const spawnX = (rawPt.x - transform.x) / transform.scale;
            const spawnY = (rawPt.y - transform.y) / transform.scale;
            
            // 👇 CORREÇÃO: Aplica a escala para casar perfeitamente com o Hover 👇
            const offset = 20 / transform.scale; 

            setPinnedCards(prev => {
                const exists = prev.find(p => p.id === branchId && p.type === 'line');
                if (exists) return prev.filter(p => !(p.id === branchId && p.type === 'line'));
                return [...prev, { id: branchId, type: 'line', x: spawnX + offset, y: spawnY + offset }]; // 👈 Usa o offset
            });
            return;
        }
        const branch = ctx.branches.find(b => b.id === branchId);
        if (branch.hasSwitch || ctx.maintenanceMode) ctx.toggleSwitch(branchId);
    }, [getRawSVGPoint, transform]);

    const handleLineDoubleClick = useCallback((e, branchId) => {
        const ctx = contextRef.current;
        if (!ctx.isEditMode) return;
        if (ctx.onSaveLayoutToHistory) ctx.onSaveLayoutToHistory(ctx.getCurrentFullLayout().positions, ctx.getCurrentFullLayout().waypoints);
        e.stopPropagation();
        const svgPt = getTransformedPoint(e.clientX, e.clientY);
        
        const branch = ctx.branches.find(b => b.id === branchId);
        const p1 = ctx.manualPositions[branch.from] || ctx.renderPositions[branch.from];
        const p2 = ctx.manualPositions[branch.to] || ctx.renderPositions[branch.to];
        const wps = ctx.manualWaypoints[branchId] || ctx.renderWaypoints[branchId] || [];
        const waypoints = Array.isArray(wps) ? wps : [];
        
        const insertIdx = getClosestSegmentIndex(p1, p2, waypoints, svgPt);
        
        const baseWps = ctx.manualWaypoints[branchId] ? ctx.manualWaypoints[branchId] : (ctx.renderWaypoints[branchId] || []);
        const currentWps = Array.isArray(baseWps) ? [...baseWps] : [];
        currentWps.splice(insertIdx, 0, { x: svgPt.x, y: svgPt.y });
        
        setManualWaypoints(prev => ({ ...prev, [branchId]: currentWps }));

        const finalLayout = ctx.getCurrentFullLayout();
        finalLayout.waypoints[branchId] = currentWps;
        window.dispatchEvent(new CustomEvent('applyGraphLayout', { 
            detail: { positions: finalLayout.positions, waypoints: finalLayout.waypoints } 
        }));
    }, [getTransformedPoint]);

    const handleWaypointDoubleClick = useCallback((e, branchId, wpIndex) => {
        const ctx = contextRef.current;
        if (!ctx.isEditMode) return;
        if (ctx.onSaveLayoutToHistory) ctx.onSaveLayoutToHistory(ctx.getCurrentFullLayout().positions, ctx.getCurrentFullLayout().waypoints);
        e.stopPropagation();

        const baseWps = ctx.manualWaypoints[branchId] ? ctx.manualWaypoints[branchId] : (ctx.renderWaypoints[branchId] || []);
        const currentWps = Array.isArray(baseWps) ? [...baseWps] : [];
        currentWps.splice(wpIndex, 1);
        
        setManualWaypoints(prev => ({ ...prev, [branchId]: currentWps }));

        const finalLayout = ctx.getCurrentFullLayout();
        finalLayout.waypoints[branchId] = currentWps;
        window.dispatchEvent(new CustomEvent('applyGraphLayout', { 
            detail: { positions: finalLayout.positions, waypoints: finalLayout.waypoints } 
        }));
    }, []);
    
    const handleLineMouseEnter = useCallback((branchId) => {
        setHoveredLineId(branchId); setLocalHoveredLine(branchId);
    }, [setHoveredLineId]);

    const handleLineMouseLeave = useCallback(() => {
        setHoveredLineId(null); setLocalHoveredLine(null);
    }, [setHoveredLineId]);
    
    const handleWaypointMouseDown = useCallback((e, branchId, wpIndex, wpKey, wp) => {
        e.preventDefault();
        const ctx = contextRef.current;
        e.stopPropagation(); wasDragged.current = false;
        if (ctx.onSaveLayoutToHistory) ctx.onSaveLayoutToHistory(ctx.getCurrentFullLayout().positions, ctx.getCurrentFullLayout().waypoints);
        const svgPt = getTransformedPoint(e.clientX, e.clientY);
        
        let currentWps = new Set(ctx.selectedEditWaypoints);
        let currentSelection = new Set(ctx.selectedEditNodes);
        
        if (!currentWps.has(wpKey)) {
            if (!e.shiftKey) { currentWps.clear(); currentSelection.clear(); }
            currentWps.add(wpKey); 
            setSelectedEditWaypoints(currentWps); setSelectedEditNodes(currentSelection);
        }
        
        const groupNodes = {}; 
        currentSelection.forEach(id => { const p = ctx.manualPositions[id] || ctx.renderPositions[id]; if (p) groupNodes[id] = { ...p }; });
        
        const groupWps = {}; 
        currentWps.forEach(key => { 
            const [bId, idxStr] = key.split('-'); const idx = parseInt(idxStr); 
            let baseWps = ctx.manualWaypoints[bId];
            if (!baseWps || baseWps.length === 0) baseWps = ctx.renderWaypoints[bId];
            if (baseWps && baseWps[idx]) groupWps[key] = { ...baseWps[idx] }; 
        });
        
        setDragInfo({ type: 'mixed', leaderType: 'waypoint', leaderId: wpKey, initialX: wp.x, initialY: wp.y, startX: svgPt.x, startY: svgPt.y, groupNodes, groupWps });
    }, [getTransformedPoint]);

    const handleNodeMouseDown = useCallback((e, nodeId) => {
        e.preventDefault();
        const ctx = contextRef.current;

        if (!ctx.isEditMode) {
            if (e.shiftKey) {
                ctx.setSelectedElement({ type: 'node', id: nodeId });
                e.stopPropagation();
            }
            return; 
        }

        ctx.setSelectedElement({ type: 'node', id: nodeId });

        e.stopPropagation(); 
        wasDragged.current = false;
        if (ctx.onSaveLayoutToHistory) ctx.onSaveLayoutToHistory(ctx.getCurrentFullLayout().positions, ctx.getCurrentFullLayout().waypoints);
        
        const svgPt = getTransformedPoint(e.clientX, e.clientY);
        
        let currentSelection = new Set(ctx.selectedEditNodes);
        let currentWps = new Set(ctx.selectedEditWaypoints);
        
        if (!currentSelection.has(nodeId)) {
            if (!e.shiftKey) { currentSelection.clear(); currentWps.clear(); }
            currentSelection.add(nodeId);
            setSelectedEditNodes(currentSelection); 
            setSelectedEditWaypoints(currentWps);
        }
        
        const groupNodes = {}; 
        currentSelection.forEach(id => { const p = ctx.manualPositions[id] || ctx.renderPositions[id]; if (p) groupNodes[id] = { ...p }; });
        const groupWps = {}; 
        currentWps.forEach(key => { 
            const [bId, idxStr] = key.split('-'); const idx = parseInt(idxStr); 
            let baseWps = ctx.manualWaypoints[bId];
            if (!baseWps || baseWps.length === 0) baseWps = ctx.renderWaypoints[bId];
            if (baseWps && baseWps[idx]) groupWps[key] = { ...baseWps[idx] }; 
        });
        
        setDragInfo({ type: 'mixed', leaderType: 'node', leaderId: nodeId, startX: svgPt.x, startY: svgPt.y, groupNodes, groupWps });
    }, [getTransformedPoint]);

    const handleNodeClick = useCallback((e, nodeId) => {
        e.stopPropagation();
        const ctx = contextRef.current;
        if (ctx.isEditMode || wasDragged.current) return;

        if (e.ctrlKey || e.metaKey) {
            ctx.setSelectedElement({ type: 'node', id: nodeId });
            return; // SEM tooltip, SEM toggleFault
        }
        if (e.shiftKey) {
            ctx.setSelectedElement({ type: 'node', id: nodeId });
            const rawPt = getRawSVGPoint(e.clientX, e.clientY);
            const spawnX = (rawPt.x - transform.x) / transform.scale;
            const spawnY = (rawPt.y - transform.y) / transform.scale;
            
            // 👇 CORREÇÃO: Escala sincronizada 👇
            const offset = 20 / transform.scale;

            setPinnedCards(prev => {
                const exists = prev.find(p => p.id === nodeId && p.type === 'node');
                if (exists) return prev.filter(p => !(p.id === nodeId && p.type === 'node'));
                return [...prev, { id: nodeId, type: 'node', x: spawnX + offset, y: spawnY + offset }]; // 👈 Usa o offset
            });
            return;
        }
        ctx.toggleFault(nodeId);
    }, [getRawSVGPoint, transform]);

    const handleNodeMouseEnter = useCallback((nodeId) => {
        const ctx = contextRef.current;
        if(!ctx.dragInfo) { setHoveredNodeId(nodeId); setLocalHoveredNode(nodeId); }
    }, [setHoveredNodeId]);

    const handleNodeMouseLeave = useCallback((nodeId) => {
        const ctx = contextRef.current;
        if(!ctx.dragInfo) { setHoveredNodeId(null); setLocalHoveredNode(null); }
    }, [setHoveredNodeId]);


    const isPaper = printFrameMode !== 'none';
    const isLandscape = printFrameMode === 'landscape';
    
    // 👇 O SVG agora usa os pixels reais da tela (containerSize), alinhando 100% com o Canvas!
    const vbW = isPaper ? (isLandscape ? 2970 : 2100) : (containerSize.w || 2970);
    const vbH = isPaper ? (isLandscape ? 2100 : 2970) : (containerSize.h || 2100);

    const handleZoomExtents = useCallback(() => {
    const { positions, waypoints } = getCurrentFullLayout();
    const nodeIds = Object.keys(positions);
    if (nodeIds.length === 0) return;

    // Lê dimensões reais do container no momento da chamada
    // Evita usar containerSize desatualizado na montagem e na volta do MapArea
    let currentW = containerSize.w;
    let currentH = containerSize.h;
    if (measureRef.current) {
        const rect = measureRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            currentW = rect.width;
            currentH = rect.height;
        }
    }
    const localVbW = isPaper ? (isLandscape ? 2970 : 2100) : currentW;
    const localVbH = isPaper ? (isLandscape ? 2100 : 2970) : currentH;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeIds.forEach(id => {
        const p = positions[id];
        if (!p) return;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    Object.values(waypoints).forEach(branchWps => {
        branchWps.forEach(wp => {
            if (!wp) return;
            if (wp.x < minX) minX = wp.x;
            if (wp.x > maxX) maxX = wp.x;
            if (wp.y < minY) minY = wp.y;
            if (wp.y > maxY) maxY = wp.y;
        });
    });

    if (minX === Infinity) return;

    const paddingX = localVbW * 0.1;
    const paddingTop = localVbH * 0.1;
    const paddingBottom = localVbH * 0.15;

    const width = maxX - minX;
    const height = maxY - minY;

    const scaleX = (localVbW - paddingX * 2) / (width || 1);
    const scaleY = (localVbH - (paddingTop + paddingBottom)) / (height || 1);

    const newScale = Math.max(0.02, Math.min(scaleX, scaleY, 2.0));

    const centerX = minX + width / 2;
    const centerY = minY + height / 2;

    const newX = (localVbW / 2) - (centerX * newScale);

    const usefulCenterY = paddingTop + ((localVbH - paddingTop - paddingBottom) / 2);
    const newY = usefulCenterY - (centerY * newScale);

    setIsAnimatingZoom(true);
    setTransform({ x: newX, y: newY, scale: newScale });

    if (zoomTimeout.current) clearTimeout(zoomTimeout.current);
    zoomTimeout.current = setTimeout(() => { setIsAnimatingZoom(false); }, 500);
}, [getCurrentFullLayout, containerSize, measureRef, isPaper, isLandscape]);

    useEffect(() => { 
        if (printFrameMode !== 'none') {
            handleZoomExtents(); 
        } else {
            setTimeout(() => handleZoomExtents(), 150);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [printFrameMode]);

    useEffect(() => {
        const handleZoom = () => handleZoomExtents(); 
        window.addEventListener('triggerZoomExtents', handleZoom);
        return () => window.removeEventListener('triggerZoomExtents', handleZoom);
    }, [handleZoomExtents]);

    const handleWheel = useCallback((e) => {
        stopAnimation(); 
        e.preventDefault(); 
        const scaleMultiplier = e.deltaY > 0 ? 0.9 : 1.1;
        setTransform(prev => {
            const newScale = Math.max(0.1, Math.min(4, prev.scale * scaleMultiplier));
            const rawPt = getRawSVGPoint(e.clientX, e.clientY);
            const groupX = (rawPt.x - prev.x) / prev.scale;
            const groupY = (rawPt.y - prev.y) / prev.scale;
            const newX = rawPt.x - (groupX * newScale);
            const newY = rawPt.y - (groupY * newScale);
            return { x: newX, y: newY, scale: newScale };
        });
    }, [stopAnimation, getRawSVGPoint]);

    useEffect(() => {
        const svg = svgRef.current;
        if (svg) {
            svg.addEventListener('wheel', handleWheel, { passive: false });
            return () => svg.removeEventListener('wheel', handleWheel);
        }
    }, [handleWheel]);

    const handleMouseDown = (e) => {
        stopAnimation(); 
        if (e.button === 1) { e.preventDefault(); handleZoomExtents(); return; }
        const svgPt = getTransformedPoint(e.clientX, e.clientY);
        const isBackgroundClick = e.target.tagName === 'svg' || e.target.id === 'bg-grid-rect';

        // 👇 LÓGICA DO ARRASTO DO POST-IT CORRIGIDA 👇
        const closestCard = e.target.closest('.pinned-card');
        if (closestCard) {
            const cardId = closestCard.getAttribute('data-id');
            const cardType = closestCard.getAttribute('data-type');
            setDraggingCard({ id: cardId, type: cardType, startX: svgPt.x, startY: svgPt.y });
            e.stopPropagation();
            return;
        }

        if (isBackgroundClick) {
            if (isEditMode && isCanvas && localHoveredNode !== null) {
                // A genialidade da reutilização: chamamos a função original do SVG!
                handleNodeMouseDown(e, localHoveredNode);
                return; // Aborta para não abrir a selectionBox
            }
            
            if (isEditMode && e.shiftKey) {
                isSelecting.current = true;
                setSelectionBox({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
            } else {
                isPanning.current = true; hasMoved.current = false;
                const rawPt = getRawSVGPoint(e.clientX, e.clientY);
                dragStart.current = { x: rawPt.x - transform.x, y: rawPt.y - transform.y };
                if (isEditMode && !e.shiftKey) {
                    setSelectedEditNodes(new Set());
                    setSelectedEditWaypoints(new Set());
                }
            }
        }
    };

    const handleMouseMove = (e) => {
        const svgPt = getTransformedPoint(e.clientX, e.clientY);

        // 👇 THROTTLING: Limita a atualização visual a ~30 FPS para não travar o PC 👇
        const now = Date.now();
        if (now - lastMouseUpdate.current > 30) {
            setMouseSvgPt(svgPt); 
            lastMouseUpdate.current = now;

            // 👇 MOTOR DE RAYCASTING DO CANVAS (LOD 2) 👇
            // Só executa se estivermos no Canvas e não estivermos arrastando a tela
            if (isCanvas && !isPanning.current && !draggingCard) {
                const hitTolerance = 12 / transform.scale; // "Gordura" magnética para facilitar o clique
                let hoveredNode = null;
                let minDist = hitTolerance;

                // 1. Radar de Nós (Barras)
                for (let i = 0; i < allNodes.length; i++) {
                    const nodeId = allNodes[i];
                    const pos = manualPositions[nodeId] || renderPositions[nodeId];
                    if (!pos) continue;
                    
                    const d = getEuclideanDist(svgPt.x, svgPt.y, pos.x, pos.y);
                    if (d < minDist) {
                        minDist = d;
                        hoveredNode = nodeId;
                    }
                }

                if (hoveredNode) {
                    if (localHoveredNode !== hoveredNode) {
                        setHoveredNodeId(hoveredNode); setLocalHoveredNode(hoveredNode);
                        setHoveredLineId(null); setLocalHoveredLine(null);
                    }
                } else {
                    if (localHoveredNode) {
                        setHoveredNodeId(null); setLocalHoveredNode(null);
                    }

                    // 2. Radar de Linhas (Executa só se o mouse não bateu em nenhum nó)
                    let hoveredEdge = null;
                    let minEdgeDist = hitTolerance;

                    for (let i = 0; i < branches.length; i++) {
                        const b = branches[i];
                        const p1 = manualPositions[b.from] || renderPositions[b.from];
                        const p2 = manualPositions[b.to] || renderPositions[b.to];
                        if (!p1 || !p2) continue;

                        const d = getDistToSegment(svgPt, p1, p2);
                        if (d < minEdgeDist) {
                            minEdgeDist = d;
                            hoveredEdge = b.id;
                        }
                    }

                    if (localHoveredLine !== hoveredEdge) {
                        setHoveredLineId(hoveredEdge); setLocalHoveredLine(hoveredEdge);
                    }
                }
            }
            // 👆 FIM DO RAYCASTING 👆
        }

        // 👇 MOTOR DE ARRASTO DO POST-IT 👇
        if (draggingCard) {
            const dx = svgPt.x - draggingCard.startX;
            const dy = svgPt.y - draggingCard.startY;
            setPinnedCards(prev => prev.map(card => {
                // A conversão String() protege o motor contra erro de tipagem no ID
                if (String(card.id) === String(draggingCard.id) && card.type === draggingCard.type) {
                    return { ...card, x: card.x + dx, y: card.y + dy };
                }
                return card;
            }));
            setDraggingCard({ ...draggingCard, startX: svgPt.x, startY: svgPt.y });
            return;
        }

        if (isSelecting.current && isEditMode) {
            setSelectionBox(prev => ({ ...prev, x2: svgPt.x, y2: svgPt.y }));
        }
        else if (dragInfo && isEditMode) {
            const rawDx = (svgPt.x - dragInfo.startX);
            const rawDy = (svgPt.y - dragInfo.startY);
            const snap = (v) => Math.round(v / FIXED_GRID_SIZE) * FIXED_GRID_SIZE;

            if (dragInfo.type === 'mixed') {
                let actualDx = 0, actualDy = 0;
                if (dragInfo.leaderType === 'node') {
                    const leaderInitial = dragInfo.groupNodes[dragInfo.leaderId];
                    const leaderTargetX = snap(leaderInitial.x + rawDx);
                    const leaderTargetY = snap(leaderInitial.y + rawDy);
                    actualDx = leaderTargetX - leaderInitial.x;
                    actualDy = leaderTargetY - leaderInitial.y;
                } else {
                    const leaderTargetX = snap(dragInfo.initialX + rawDx);
                    const leaderTargetY = snap(dragInfo.initialY + rawDy);
                    actualDx = leaderTargetX - dragInfo.initialX;
                    actualDy = leaderTargetY - dragInfo.initialY;
                }
                if (Math.abs(actualDx) > 0 || Math.abs(actualDy) > 0) wasDragged.current = true;
                if (Object.keys(dragInfo.groupNodes).length > 0) {
                    setManualPositions(prev => {
                        const nextPos = { ...prev };
                        Object.keys(dragInfo.groupNodes).forEach(id => {
                            nextPos[id] = { x: dragInfo.groupNodes[id].x + actualDx, y: dragInfo.groupNodes[id].y + actualDy };
                        });
                        return nextPos;
                    });
                }
                if (Object.keys(dragInfo.groupWps).length > 0) {
                    setManualWaypoints(prev => {
                        const nextWps = JSON.parse(JSON.stringify(prev));
                        Object.keys(dragInfo.groupWps).forEach(key => {
                            const [bId, idxStr] = key.split('-');
                            const idx = parseInt(idxStr);
                            
                            if (!nextWps[bId] || nextWps[bId].length === 0) {
                                const ctx = contextRef.current;
                                nextWps[bId] = ctx.renderWaypoints[bId] ? JSON.parse(JSON.stringify(ctx.renderWaypoints[bId])) : [];
                            }
                            
                            if (nextWps[bId]) {
                                nextWps[bId][idx] = { x: dragInfo.groupWps[key].x + actualDx, y: dragInfo.groupWps[key].y + actualDy };
                            }
                        });
                        return nextWps;
                    });
                }
            } else if (dragInfo.type === 'line') {
                if (Math.abs(rawDx) > 5 || Math.abs(rawDy) > 5) {
                    wasDragged.current = true;
                    setManualWaypoints(prev => {
                        const ctx = contextRef.current;
                        const baseWps = prev[dragInfo.branchId] ? prev[dragInfo.branchId] : (ctx.renderWaypoints[dragInfo.branchId] || []);
                        const currentWps = Array.isArray(baseWps) ? [...baseWps] : [];
                        currentWps.splice(dragInfo.insertIdx, 0, { x: dragInfo.startX, y: dragInfo.startY });
                        return { ...prev, [dragInfo.branchId]: currentWps };
                    });
                    const wpKey = `${dragInfo.branchId}-${dragInfo.insertIdx}`;
                    setDragInfo({
                        type: 'mixed', leaderType: 'waypoint', leaderId: wpKey, startX: dragInfo.startX, startY: dragInfo.startY,
                        initialX: dragInfo.startX, initialY: dragInfo.startY, groupNodes: {}, groupWps: { [wpKey]: { x: dragInfo.startX, y: dragInfo.startY } }
                    });
                }
            }
        } 
        else if (isPanning.current) {
            hasMoved.current = true;
            const rawPt = getRawSVGPoint(e.clientX, e.clientY);
            setTransform(p => ({ ...p, x: rawPt.x - dragStart.current.x, y: rawPt.y - dragStart.current.y }));
        }
    };

    const handleMouseUp = (e) => {
        if (draggingCard) {
            setDraggingCard(null);
            return;
        }

        if (isSelecting.current && selectionBox) {
            const minX = Math.min(selectionBox.x1, selectionBox.x2);
            const maxX = Math.max(selectionBox.x1, selectionBox.x2);
            const minY = Math.min(selectionBox.y1, selectionBox.y2);
            const maxY = Math.max(selectionBox.y1, selectionBox.y2);
            const newSelection = new Set(); const newWpSelection = new Set(); 
            allNodes.forEach(id => {
                const pos = manualPositions[id] || activePositions[id] || renderPositions[id];
                if (!pos) return;
                if (pos && pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) newSelection.add(id);
            });
            const allWpKeysSelection = new Set([...Object.keys(manualWaypoints), ...Object.keys(renderWaypoints)]);
            allWpKeysSelection.forEach(branchId => {
                const wps = manualWaypoints[branchId] || renderWaypoints[branchId];
                if (Array.isArray(wps)) {
                    wps.forEach((wp, index) => {
                        if (wp && wp.x >= minX && wp.x <= maxX && wp.y >= minY && wp.y <= maxY) newWpSelection.add(`${branchId}-${index}`);
                    });
                }
            });
            setSelectedEditNodes(newSelection); setSelectedEditWaypoints(newWpSelection);
            setSelectionBox(null); isSelecting.current = false;
        }
        
        if (dragInfo) { 
            const finalLayout = getCurrentFullLayout();
            window.dispatchEvent(new CustomEvent('applyGraphLayout', { 
                detail: { 
                    positions: finalLayout.positions, 
                    waypoints: finalLayout.waypoints 
                } 
            }));
            
            setDragInfo(null); 
            setTimeout(() => { wasDragged.current = false; }, 50); 
        }
        
        isPanning.current = false;
        const isBackgroundClick = e.target.tagName === 'svg' || e.target.id === 'bg-grid-rect';
        if (isBackgroundClick && !hasMoved.current && !isEditMode) {
            // 👇 FASE 3: INTERCEPTADOR DE CLIQUES DO CANVAS 👇
            if (isCanvas) {
                if (localHoveredNode !== null) {
                    handleNodeClick(e, localHoveredNode);
                } else if (localHoveredLine !== null) {
                    handleLineClick(e, localHoveredLine);
                } else {
                    setSelectedElement(null); // Clique no vazio limpa o painel
                }
            } else {
                setSelectedElement(null); // Comportamento padrão do SVG (LOD 0 e 1)
            }
            // 👆 FIM DA FASE 3 👆
        }
        hasMoved.current = false;
    };

    const getPathData = (p1, p2, waypoints = []) => {
        if (!p1 || !p2) return ''; 
        if (!Array.isArray(waypoints) || waypoints.length === 0) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
        let d = `M ${p1.x} ${p1.y} `;
        waypoints.forEach(wp => { if(wp && wp.x) d += `L ${wp.x} ${wp.y} `; });
        d += `L ${p2.x} ${p2.y}`;
        return d;
    };

    const hoveredBranch = localHoveredLine !== null ? branches.find(b => b.id === localHoveredLine) : null;
    const hoveredLineData = localHoveredLine !== null ? (lineCurrents[localHoveredLine] || { current: 0, percentage: 0, pFlow: 0, qFlow: 0 }) : null;
    // 👇 FILTRO DE TENSÃO PARA BARRAS DESENERGIZADAS 👇
    const isHoveredDead = nodeFeeds && (!nodeFeeds[localHoveredNode] || nodeFeeds[localHoveredNode].size === 0);
    
    let hoveredNodeInfo = null;
    if (localHoveredNode !== null) {
        // Clona os dados do Newton-Raphson
        hoveredNodeInfo = { ...(nodeData[localHoveredNode] || { v: 0, ang: 0, p: 0, q: 0 }) };
        // Se a barra estiver morta, zera a tensão para ignorar o "Flat Start" do algoritmo
        if (isHoveredDead) {
            hoveredNodeInfo.v = 0;
            hoveredNodeInfo.ang = 0;
        }
    }

    const svgWorldBounds = {
        left:   (-transform.x) / transform.scale,
        right:  (containerSize.w - transform.x) / transform.scale,
        top:    (-transform.y) / transform.scale,
        bottom: (containerSize.h - transform.y) / transform.scale,
    };

    const svgCursor = isPanning.current ? 'grabbing' : (isEditMode ? 'default' : 'pointer');
    
    const paperRatio = isLandscape ? 297 / 210 : 210 / 297;
    const containerRatio = (containerSize.w || 1) / (containerSize.h || 1);
    
    let calcWidth = '100%';
    let calcHeight = '100%';
    
    if (isPaper && containerSize.w && containerSize.h) {
        if (containerRatio > paperRatio) {
            calcHeight = Math.max(0, containerSize.h - 40);
            calcWidth = calcHeight * paperRatio;
        } else {
            calcWidth = Math.max(0, containerSize.w - 40);
            calcHeight = calcWidth / paperRatio;
        }
    }

    const paperStyle = {
        position: 'relative',
        width: isPaper ? `${calcWidth}px` : '100%',
        height: isPaper ? `${calcHeight}px` : '100%',
        margin: 'auto',
        boxShadow: isPaper ? '0 20px 60px rgba(0,0,0,0.5)' : 'none',
        border: isPaper ? '1px solid #333' : 'none',
        backgroundColor: darkMode ? '#121212' : '#ffffff',
        transition: 'width 0.3s, height 0.3s, background-color 0.3s',
        overflow: 'hidden'
    };

    // 👇 VIEWPORT CULLING COM HISTERESE (Zonas Mortas O-X-Z) 👇
    const [visibleBounds, setVisibleBounds] = useState({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity });
    const lastCullingTransform = useRef({ x: 0, y: 0, scale: 1 });

    useEffect(() => {
        // No modo impressão, desenha tudo para o PDF sair perfeito
        if (printFrameMode !== 'none') {
            setVisibleBounds({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity });
            return;
        }
        
        if (!containerSize || containerSize.w === 0) return;

        const t = transform;
        const prev = lastCullingTransform.current;

        // Zona "O" (Tolerância): Só recalcula se arrastar mais de 30% do tamanho da tela
        const toleranceX = (containerSize.w / t.scale) * 0.3;
        const toleranceY = (containerSize.h / t.scale) * 0.3;

        const dx = Math.abs((t.x - prev.x) / t.scale);
        const dy = Math.abs((t.y - prev.y) / t.scale);
        const scaleChanged = Math.abs(t.scale - prev.scale) > 0.05; // Atualiza imediatamente se der zoom
        // Se saiu da zona de tolerância (cruzou a fronteira O -> X), recalcula o Culling!
        if (scaleChanged || dx > toleranceX || dy > toleranceY || visibleBounds.minX === -Infinity) {
            
            // 👇 SUA OTIMIZAÇÃO: Se tolera 30%, a margem só precisa ser 40% 👇
            const marginX = (containerSize.w / t.scale) * 0.4;
            const marginY = (containerSize.h / t.scale) * 0.4;

            setVisibleBounds({
                minX: (-t.x) / t.scale - marginX,
                minY: (-t.y) / t.scale - marginY,
                maxX: (-t.x + containerSize.w) / t.scale + marginX,
                maxY: (-t.y + containerSize.h) / t.scale + marginY,
            });
            // Salva a posição da câmera deste último corte
            lastCullingTransform.current = t;
        }
    }, [transform, containerSize, printFrameMode, visibleBounds.minX]);
    // 👆 FIM DA HISTERESE 👆

    // 👇 MOTOR SIMPLIFICADO (LOD 0 e LOD 1 apenas) 👇
    const displayData = useMemo(() => {
        return { visibleNodes: allNodes, visibleBranches: branches };
    }, [allNodes, branches]);

    return (
        <div className="graph-container" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div ref={measureRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: -1 }}></div>

                <div className="paper-container" style={paperStyle}>
                    
                    {/* 👇 NOVO: CAMADA DE PERFORMANCE (LOD 2) 👇 */}
                    {isCanvas && (
                        <CanvasOverlay 
                            allNodes={allNodes}
                            branches={branches}
                            activePositions={activePositions}
                            activeWaypoints={activeWaypoints}
                            transform={transform}
                            getNodeColor={getNodeColor}
                            getEdgeColor={getEdgeColor}
                            generatorBuses={generatorBuses}
                            width={containerSize.w}
                            height={containerSize.h}
                            darkMode={darkMode}
                            sources={sources} 
                            feedersList={feedersList}
                            systemShunts={systemShunts}
                            draggedNodeId={dragInfo?.type === 'mixed' && dragInfo.leaderType === 'node' ? dragInfo.leaderId : null}
                        />
                    )}
                        
                    <svg id="sistema-eletrico-svg" className="graph-svg" viewBox={`0 0 ${vbW} ${vbH}`} 
                        preserveAspectRatio="xMidYMid meet" 
                        ref={svgRef}
                        style={{ width: '100%', height: '100%', display: 'block', cursor: svgCursor, position: 'relative', zIndex: 10 }}
                        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} 
                        onMouseEnter={() => setIsHoveringSVG(true)}
                        onMouseLeave={() => { setIsHoveringSVG(false); isPanning.current = false; isSelecting.current = false; setHoveredLineId(null); setHoveredNodeId(null); setLocalHoveredNode(null); setLocalHoveredLine(null); if(dragInfo) setDragInfo(null); if(draggingCard) setDraggingCard(null); }}
                    >
                    <g 
                        transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
                        style={{ transition: isAnimatingZoom ? 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)' : 'none' }}
                    >
                    {!isCanvas && (
                        <>
                            {isEditMode && (
                                <g>
                                    <defs>
                                        <pattern id={`bg-grid-${FIXED_GRID_SIZE}`} width={FIXED_GRID_SIZE} height={FIXED_GRID_SIZE} patternUnits="userSpaceOnUse">
                                            <path d={`M ${FIXED_GRID_SIZE} 0 L 0 0 0 ${FIXED_GRID_SIZE}`} fill="none" stroke={darkMode ? '#333' : '#e0e0e0'} strokeWidth="1"/>
                                        </pattern>
                                    </defs>
                                    <rect id="bg-grid-rect" x="-10000" y="-10000" width="20000" height="20000" fill={`url(#bg-grid-${FIXED_GRID_SIZE})`} />
                                </g>
                            )}

                            {displayData.visibleBranches.map(b => {
                                // 1. Calcula as posições dos extremos (p1 e p2)
                                const p1 = manualPositions[b.from] || renderPositions[b.from];
                                const p2 = manualPositions[b.to] || renderPositions[b.to];
                                if (!p1 || !p2) return null;

                                // 2. Culling de Linhas (Protege a performance)
                                const p1Out = p1.x < visibleBounds.minX || p1.x > visibleBounds.maxX || p1.y < visibleBounds.minY || p1.y > visibleBounds.maxY;
                                const p2Out = p2.x < visibleBounds.minX || p2.x > visibleBounds.maxX || p2.y < visibleBounds.minY || p2.y > visibleBounds.maxY;
                                if (p1Out && p2Out) return null;

                                // 3. Captura os waypoints e o caminho do SVG
                                const wps = manualWaypoints[b.id] || renderWaypoints[b.id] || [];
                                const waypoints = Array.isArray(wps) ? wps : [];
                                const pathString = getPathData(p1, p2, waypoints);
                                
                                // 4. Captura a cor oficial da linha
                                const color = getEdgeColor ? getEdgeColor(b) : (darkMode ? '#888' : '#666');
                                
                                const isHovered = hoveredLineId === b.id || localHoveredLine === b.id;
                                const isSelected = selectedElement && selectedElement.type === 'edge' && selectedElement.data.id === b.id;

                                const lineData = lineCurrents[b.id];
                                const flowDir = (!lineData || lineData.current < 0.01) ? 0 : (lineData.pFlow >= 0 ? 1 : -1);

                                return (
                                    <GraphEdge 
                                        key={b.id} branch={b} pathString={pathString} color={color}
                                        widthOverride={getEdgeWidth ? getEdgeWidth(b) : undefined}
                                        isHighlighted={isHovered || isSelected} isEditMode={isEditMode}
                                        isRestoringLayout={isRestoringLayout} waypoints={waypoints}
                                        selectedEditWaypoints={selectedEditWaypoints} dragInfoType={dragInfo?.type}
                                        flowDir={flowDir} p1={p1} p2={p2}
                                        onLineMouseDown={handleLineMouseDown} onLineClick={handleLineClick}
                                        onLineDoubleClick={handleLineDoubleClick} onLineMouseEnter={handleLineMouseEnter}
                                        onLineMouseLeave={handleLineMouseLeave} onWaypointMouseDown={handleWaypointMouseDown}
                                        onWaypointDoubleClick={handleWaypointDoubleClick}
                                    />
                                );
                            })}

                            {/* 👇 COLE O RADAR EXATAMENTE AQUI 👇 */}
                            {/* RENDERIZADOR DE CRUZAMENTOS (RADAR) */}
                            {isEditMode && showCrossings && intersections && intersections.length > 0 && intersections.map((pt, idx) => (
                                <g key={`cross-${idx}`} transform={`translate(${pt.x}, ${pt.y})`} style={{ pointerEvents: 'none' }}>
                                    <circle r="12" fill="rgba(244, 67, 54, 0.2)" />
                                    <path d="M-6,-6 L6,6 M6,-6 L-6,6" stroke="#f44336" strokeWidth="3" strokeLinecap="round" />
                                    <title>Cruzamento: {pt.b1} com {pt.b2}</title>
                                </g>
                            ))}
                            {/* 👆 FIM DO RADAR 👆 */}


                            {displayData.visibleNodes.map(nodeId => {
                                const pos = manualPositions[nodeId] || renderPositions[nodeId];
                                if (!pos) return null;

                                // 👇 CULLING DAS BARRAS 👇
                                // Se a barra estiver totalmente fora da área expandida, não renderiza
                                if (pos.x < visibleBounds.minX || pos.x > visibleBounds.maxX ||
                                    pos.y < visibleBounds.minY || pos.y > visibleBounds.maxY) {
                                    return null; // Aborta a renderização desta barra
                                }
                                // 👆 FIM DO CULLING 👆
                                
                                const color = getNodeColor(nodeId); // Movido para cima

                                // 👇 IDENTIFICA OS "MARCOS" DO SISTEMA 👇
                            const isSource = sources.includes(nodeId);
                            const isFeeder = feedersList.includes(nodeId);


                            const isSelectedEdit = selectedEditNodes.has(nodeId);
                            const isHighlighted = hoveredNodeId === nodeId || localHoveredNode === nodeId || isSelectedEdit || (!isEditMode && selectedElement?.id === nodeId);
                            const nodeLoad = systemLoads && systemLoads[nodeId] ? (systemLoads[nodeId].p / 1000).toFixed(1) : null;

                            const v_pu = nodeData[nodeId]?.v;
                            const hasViolation = v_pu && (v_pu < vMinLimit || v_pu > vMaxLimit);

                            const shuntData = systemShunts && systemShunts[nodeId];
                            const hasShunt = !!shuntData;
                            const isShuntOn = hasShunt && shuntData.steps > 0;
                            const injectedQ = hasShunt ? shuntData.steps * shuntData.stepSize : 0;

                            return (
                                <g key={`wrapper-${nodeId}`} className={hasViolation ? "voltage-glow-wrapper" : ""}>
                                    <GraphNode
                                        key={nodeId} nodeId={nodeId} pos={pos} isSource={isSource}
                                        isFeeder={isFeeder} color={color} isHighlighted={isHighlighted}
                                        darkMode={darkMode} isEditMode={isEditMode} isRestoringLayout={isRestoringLayout}
                                        showLabels={showLabels} nodeLoad={nodeLoad} hasShunt={hasShunt || !!(generatorBuses && generatorBuses.has(Number(nodeId)))} 
                                        onMouseDown={handleNodeMouseDown} onClick={handleNodeClick}
                                        onMouseEnter={handleNodeMouseEnter} onMouseLeave={handleNodeMouseLeave}
                                        currentScale={transform.scale} isSimplified={isSimplified}
                                        hasGD={!!systemGD[nodeId]} gdActive={systemGD[nodeId]?.active}                                        
                                    />
                                    {hasShunt && (
                                        <g transform={`translate(${pos.x + 18}, ${pos.y - 18})`} style={{ cursor: isEditMode ? 'default' : 'pointer', pointerEvents: 'all' }}>
                                            <title>{`Banco de Capacitores (${injectedQ} kVAr)\nPassos LIGADOS: ${shuntData.steps} de ${shuntData.maxSteps}`}</title>
                                            <circle cx="0" cy="0" r="12" fill={isShuntOn ? (darkMode ? 'rgba(0, 188, 212, 0.2)' : 'rgba(0, 188, 212, 0.15)') : (darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')} stroke={isShuntOn ? '#00bcd4' : (darkMode ? '#555' : '#aaa')} strokeWidth="1.5" />
                                            <text x="0" y="3" textAnchor="middle" fontSize="9" fontWeight="bold" fill={isShuntOn ? '#00bcd4' : (darkMode ? '#888' : '#aaa')} pointerEvents="none">
                                                {shuntData.steps}
                                            </text>
                                        </g>
                                    )}
                                    {/* Badge GD — mesmo padrão visual do BC */}
                                    {systemGD[nodeId] && (
                                        <g
                                            transform={`translate(${pos.x + (hasShunt ? 38 : 18)}, ${pos.y - 18})`}
                                            style={{ cursor: isEditMode ? 'default' : 'pointer', pointerEvents: 'all' }}
                                            onClick={(e) => { if (!isEditMode) { e.stopPropagation(); toggleGD(nodeId); } }}
                                        >
                                            <title>{systemGD[nodeId].active ? `GD Ativa — Pg: ${systemGD[nodeId].pg} kW / Qg: ${systemGD[nodeId].qg} kVAr\nClique para desativar` : `GD Desativada — Pg: ${systemGD[nodeId].pg} kW\nClique para ativar`}</title>
                                            {/* Círculo de fundo — idêntico ao BC */}
                                            <circle
                                                cx="0" cy="0" r="12"
                                                fill={systemGD[nodeId].active
                                                    ? (darkMode ? 'rgba(212, 212, 0, 0.2)' : 'rgba(212, 212, 0, 0.2)')
                                                    : (darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')}
                                                stroke={systemGD[nodeId].active ? '#ffee00' : (darkMode ? '#555' : '#aaa')}
                                                strokeWidth="1.5"
                                            />
                                            {/* Raio SVG — ziguezague simétrico no lugar do número */}
                                            <path
                                                d="M 1.5,-5.5 L -2,0 L 0.5,0 L -1.5,5.5 L 2,0 L -0.5,0 Z"
                                                fill={systemGD[nodeId].active ? '#ffee00' : (darkMode ? '#888' : '#aaa')}
                                                pointerEvents="none"
                                            />
                                        </g>
                                    )}
                                </g>
                            );
                        })}

                        {selectionBox && (
                            <rect x={Math.min(selectionBox.x1, selectionBox.x2)} y={Math.min(selectionBox.y1, selectionBox.y2)} width={Math.abs(selectionBox.x2 - selectionBox.x1)} height={Math.abs(selectionBox.y2 - selectionBox.y1)} fill="rgba(41, 98, 255, 0.1)" stroke="#2962ff" strokeWidth="2" strokeDasharray="5,5" pointerEvents="none" />
                        )}
                    </>
                    )}

                        {/* 👇 FANTASMA INTERATIVO DO CANVAS (HOVER UNIVERSAL) 👇 */}
                        {isCanvas && (localHoveredNode || hoveredNodeId) && (() => {
                            const activeNodeId = localHoveredNode || hoveredNodeId; 
                            const pos = manualPositions[activeNodeId] || renderPositions[activeNodeId];
                            if (!pos) return null;
                            
                            // Separação de Tipos
                            const isSource = sources.includes(activeNodeId);
                            const isFeeder = feedersList.includes(activeNodeId);
                            const hasShunt = !!systemShunts[activeNodeId] || !!(generatorBuses && generatorBuses.has(Number(activeNodeId)));
                            
                            const color = getNodeColor(activeNodeId);
                            
                            // 👇 O pulo do gato: removemos o /transform.scale do strokeWidth 
                            // para ele não explodir de tamanho no zoom out 👇
                            const strokeW = 4; 
                            const hoverProps = { fill: color, stroke: "#fff", strokeWidth: strokeW, pointerEvents: "none", className: "voltage-glow-wrapper", style: { transition: 'all 0.1s ease-out' } };

                            if (isSource) {
                                // Raio 42 (igual ao CanvasOverlay) + um chorinho pro brilho
                                return <circle cx={pos.x} cy={pos.y} r={46} {...hoverProps} />;
                            } else if (isFeeder) {
                                const hexR = 46;
                                const points = Array.from({length: 6}).map((_, i) => {
                                    const angle = (Math.PI / 3) * i - (Math.PI / 6);
                                    return `${pos.x + hexR * Math.cos(angle)},${pos.y + hexR * Math.sin(angle)}`;
                                }).join(' ');
                                return <polygon points={points} {...hoverProps} />;
                            } else if (hasShunt) {
                                const rhoR = 38;
                                const points = `${pos.x},${pos.y - rhoR} ${pos.x + rhoR},${pos.y} ${pos.x},${pos.y + rhoR} ${pos.x - rhoR},${pos.y}`;
                                return <polygon points={points} {...hoverProps} />;
                            } else {
                                // O mesmo tamanho 50x28 + chorinho + o mesmo raio 14
                                const w = 56; const h = 34;
                                return <rect x={pos.x - w/2} y={pos.y - h/2} width={w} height={h} rx={14} {...hoverProps} />;
                            }
                        })()}

                        {isCanvas && (localHoveredLine || hoveredLineId) && (() => {
                            const activeLineId = localHoveredLine || hoveredLineId; // 👈 Escuta o Mapa OU o Painel
                            const branch = branches.find(b => b.id === activeLineId);
                            if (!branch) return null;

                            const p1 = manualPositions[branch.from] || renderPositions[branch.from];
                            const p2 = manualPositions[branch.to] || renderPositions[branch.to];
                            if (!p1 || !p2) return null;

                            const wps = manualWaypoints[branch.id] || renderWaypoints[branch.id] || [];

                            return (
                                <path 
                                    d={getPathData(p1, p2, wps)}
                                    stroke="#ffffff"
                                    strokeWidth={4.5 / transform.scale}
                                    fill="none"
                                    pointerEvents="none"
                                    style={{ filter: 'drop-shadow(0px 0px 4px rgba(255,255,255,0.8))' }}
                                />
                            );
                        })()}
                        {/* 👆 FIM DO FANTASMA INTERATIVO 👆 */}
                        
                        {/* 👇 ATOR SUBSTITUTO DO ARRASTO NO CANVAS (SVG TEMPORÁRIO) 👇 */}
                        {isCanvas && dragInfo?.type === 'mixed' && dragInfo.leaderType === 'node' && (() => {
                            const nodeId = dragInfo.leaderId;
                            const nodeIdNum = Number(nodeId); // Garante a matemática estrita
                            
                            const pos = manualPositions[nodeId] || activePositions[nodeId];
                            if (!pos) return null;

                            const connectedBranches = branches.filter(b => Number(b.from) === nodeIdNum || Number(b.to) === nodeIdNum);
                            const isSource = sources.includes(nodeId) || feedersList.includes(nodeId);
                            const hasShunt = !!systemShunts[nodeId] || !!(generatorBuses && generatorBuses.has(Number(nodeId)));
                            const r = 10 / transform.scale; 

                            return (
                                <g className="canvas-drag-ghost" style={{ pointerEvents: 'none' }}>
                                    {/* 1. As Linhas de Borracha */}
                                    {connectedBranches.map(b => {
                                        const p1 = b.from === nodeId ? pos : (activePositions[b.from]);
                                        const p2 = b.to === nodeId ? pos : (activePositions[b.to]);
                                        const wps = manualWaypoints[b.id] || activeWaypoints[b.id] || [];
                                        if (!p1 || !p2) return null;
                                        return (
                                            <path
                                                key={`drag-line-${b.id}`}
                                                d={getPathData(p1, p2, wps)}
                                                stroke={getEdgeColor(b)}
                                                strokeWidth={2.5 / transform.scale}
                                                fill="none"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeDasharray={b.state === 0 ? "5,5" : "none"}
                                            />
                                        );
                                    })}
                                    
                                    {/* 2. O Nó sendo Arrastado (Mantendo Geometria do Canvas) */}
                                    {(() => {
                                        const isSource = sources.includes(nodeId);
                                        const isFeeder = feedersList.includes(nodeId);
                                        const hasShunt = !!systemShunts[nodeId] || !!(generatorBuses && generatorBuses.has(Number(nodeId)));
                                        
                                        const color = getNodeColor(nodeId);
                                        const hoverProps = { fill: color, stroke: "#fff", strokeWidth: 3 };

                                        if (isSource) {
                                            return <circle cx={pos.x} cy={pos.y} r={42} {...hoverProps} />;
                                        } else if (isFeeder) {
                                            const hexR = 42;
                                            const points = Array.from({length: 6}).map((_, i) => {
                                                const angle = (Math.PI / 3) * i - (Math.PI / 6);
                                                return `${pos.x + hexR * Math.cos(angle)},${pos.y + hexR * Math.sin(angle)}`;
                                            }).join(' ');
                                            return <polygon points={points} {...hoverProps} />;
                                        } else if (hasShunt) {
                                            const rhoR = 34;
                                            const points = `${pos.x},${pos.y - rhoR} ${pos.x + rhoR},${pos.y} ${pos.x},${pos.y + rhoR} ${pos.x - rhoR},${pos.y}`;
                                            return <polygon points={points} {...hoverProps} />;
                                        } else {
                                            const w = 50; const h = 28;
                                            return <rect x={pos.x - w/2} y={pos.y - h/2} width={w} height={h} rx={14} {...hoverProps} />;
                                        }
                                    })()}
                                </g>
                            );
                        })()}
                        {/* 👆 FIM DO ATOR SUBSTITUTO 👆 */}

                        {isCanvas && localHoveredLine && hoveredLineData && (
                            <path 
                                d={getPathData(
                                    manualPositions[hoveredBranch?.from] || renderPositions[hoveredBranch?.from], 
                                    manualPositions[hoveredBranch?.to] || renderPositions[hoveredBranch?.to], 
                                    manualWaypoints[hoveredBranch?.id] || renderWaypoints[hoveredBranch?.id] || []
                                )}
                                stroke="#ffffff"
                                strokeWidth={4.5 / transform.scale}
                                fill="none"
                                pointerEvents="none"
                                style={{ filter: 'drop-shadow(0px 0px 4px rgba(255,255,255,0.8))' }}
                            />
                        )}
                        {/* 👆 FIM DO FANTASMA INTERATIVO 👆 */}
                        {!dragInfo && !isEditMode && !selectionBox && (
                            <SvgTooltips 
                                isHoveringSVG={isHoveringSVG}
                                localHoveredLine={localHoveredLine}
                                hoveredBranch={hoveredBranch}
                                hoveredLineData={hoveredLineData}
                                localHoveredNode={localHoveredNode}
                                hoveredNodeInfo={hoveredNodeInfo}
                                manualPositions={manualPositions}
                                animPositions={renderPositions}
                                sources={sources}
                                branches={branches}
                                lineCurrents={lineCurrents}
                                loads={loads}
                                systemLoads={systemLoads}
                                sses={sses}
                                feedersList={feedersList}
                                svgWorldBounds={svgWorldBounds}
                                pinnedCards={pinnedCards}
                                setPinnedCards={setPinnedCards}
                                nodeData={nodeData}
                                mouseSvgPt={mouseSvgPt}
                                currentScale={transform.scale} // 👈 Mantém essa linha!
                            />
                        )}
                    </g>
                </svg>
                {children}
            </div>
        </div>
    );
};