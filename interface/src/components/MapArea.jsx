import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Tooltip, Polyline, Marker, useMapEvents, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { fetchStreetRoute } from '../utils/geoRouting';
import { useGridInteraction } from '../hooks/useGridInteraction';
import GeoImportModal from './GeoImportModal';

// 👇 IMPORTAMOS O SEU COMPONENTE INTACTO 👇
import SvgTooltips from './SvgTooltips'; 

// 👇 MAPA BLINDADO: Agora ele checa a trava antes de limpar a seleção!
function MapBackgroundEvents({ setSelectedElement, isEditMode, ignoreMapClickRef }) {
    useMapEvents({
        click: () => {
            setSelectedElement(null);
            if (ignoreMapClickRef.current) return;
            if (!isEditMode) {
                setSelectedElement(null);
            }
        }
    });
    return null;
}

// 👇 COMPONENTE NOVO: Rastreia o mouse para a "antena" do SvgTooltips
function MapMouseTracker({ setMouseSvgPt }) {
    useMapEvents({
        mousemove: (e) => {
            // Usa os pixels da tela (containerPoint) em vez de Lat/Lng
            setMouseSvgPt(e.containerPoint); 
        }
    });
    return null;
}

export default function MapArea({ 
    darkMode, branches, sources, feedersList, getNodeColor, 
    getEdgeColor, setSelectedElement, toggleSwitch, toggleFault,
    nodeData, lineCurrents, systemShunts, children, isEditMode,
    selectedElement, hoveredLineId, setHoveredLineId, hoveredNodeId, setHoveredNodeId,
    // 👇 Novas props necessárias para o SvgTooltips 👇
    loads, systemLoads, sses, allNodes, svgPositions, geoPositions, setGeoPositions, routedPaths, setRoutedPaths,
    manualWaypoints, setManualWaypoints, straightSegments, setStraightSegments,
    systemGD, toggleGD
}) {

    const [showGeoModal, setShowGeoModal] = useState(false);

    useEffect(() => {
        // Se a rede estiver vazia, não faz nada
        if (!allNodes || allNodes.length === 0) return;

        // Conta quantas barras atuais possuem latitude/longitude válidas
        const covered = allNodes.filter(id => geoPositions[String(id)] || geoPositions[id]).length;
        const coverage = covered / allNodes.length;

        // Se menos da metade da rede tiver coordenadas geográficas...
        if (coverage < 0.5) {
            setShowGeoModal(true); // 🚨 Abre o modal pedindo ajuda ao usuário!
        }
    }, [allNodes, geoPositions]);

    const center = [-20.4319, -51.3425];
    const mapTileUrl = darkMode 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
   
    const [recalculatingBranchId, setRecalculatingBranchId] = useState(null);
    const fileInputRef = useRef(null);

    // TRAVA DE CLIQUE (LATCH)
    const ignoreMapClickRef = useRef(false);
    const containerRef = useRef(null); // Ref para medir o tamanho da tela

    // ==========================================
    // 💡 ESTADOS DO SCADA (TOOLTIPS E POST-ITS)
    // ==========================================
    const [mouseSvgPt, setMouseSvgPt] = useState({ x: 0, y: 0 });
    const [pinnedCards, setPinnedCards] = useState([]);
    const [draggingCard, setDraggingCard] = useState(null);
    const [svgBounds, setSvgBounds] = useState({ left: 0, right: 1000, top: 0, bottom: 800 });

    useEffect(() => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setSvgBounds({ left: 0, top: 0, right: rect.width, bottom: rect.height });
        }
    }, [isEditMode]);

    // 👇 SOLUÇÃO DO OFFSET: Força o Leaflet a recalcular a tela toda vez que ela muda 👇
    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            if (containerRef.current) {
                // Acessa a instância interna do mapa escondida pelo React-Leaflet (se disponível)
                const mapInstance = containerRef.current.querySelector('.leaflet-container')?._leaflet_map;
                if (mapInstance) {
                    mapInstance.invalidateSize();
                }
            }
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    // 👇 Função chamada pelo Hook ao usar Shift+Click
    const handlePinCard = (type, id, event) => {
        const pt = event.containerPoint; // Ponto da tela onde ocorreu o clique
        setPinnedCards(prev => {
            const exists = prev.find(p => String(p.id) === String(id) && p.type === type);
            if (exists) return prev.filter(p => !(String(p.id) === String(id) && p.type === type)); // Remove se já existir
            return [...prev, { id, type, x: pt.x + 20, y: pt.y + 20 }]; // Cria deslocado para o lado
        });
    };

    const { handleNodeClick, handleEdgeClick } = useGridInteraction({
        isEditMode, setSelectedElement, toggleSwitch, toggleFault, onPinCard: handlePinCard
    });

    // ==========================================
    // 💡 MOTOR DE ARRASTO DOS POST-ITS
    // ==========================================
    const handleSvgMouseDown = (e) => {
        const closestCard = e.target.closest('.pinned-card');
        if (closestCard) {
            const cardId = closestCard.getAttribute('data-id');
            const cardType = closestCard.getAttribute('data-type');
            const rect = e.currentTarget.getBoundingClientRect();
            setDraggingCard({ id: cardId, type: cardType, startX: e.clientX - rect.left, startY: e.clientY - rect.top });
            e.stopPropagation();
        }
    };

    const handleSvgMouseMove = (e) => {
        if (draggingCard) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const dx = x - draggingCard.startX;
            const dy = y - draggingCard.startY;

            setPinnedCards(prev => prev.map(card => {
                if (String(card.id) === String(draggingCard.id) && card.type === draggingCard.type) {
                    return { ...card, x: card.x + dx, y: card.y + dy };
                }
                return card;
            }));
            setDraggingCard({ ...draggingCard, startX: x, startY: y });
        }
    };

    const handleSvgMouseUp = () => { if (draggingCard) setDraggingCard(null); };

    const getBranchId = (branch) => `${branch.from}-${branch.to}`;

    const getClickedSegmentIndex = (map, latlng, points) => {
        const clickPt = map.latLngToLayerPoint(latlng);
        const pts = points.map(p => map.latLngToLayerPoint(L.latLng(p.lat, p.lng)));
        let minIdx = 0; let minD = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
            const d = L.LineUtil.pointToSegmentDistance(clickPt, pts[i], pts[i+1]);
            if (d < minD) { minD = d; minIdx = i; }
        }
        return minIdx;
    };

    const calculateBranchPath = async (branchObj, currentWps, branchStrSegs) => {
        const p1 = geoPositions[branchObj.from];
        const p2 = geoPositions[branchObj.to];
        if (!p1 || !p2) return null;
        
        const points = [p1, ...currentWps, p2];
        let fullPath = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i+1];
            
            if (branchStrSegs.includes(i)) {
                if (i === 0) fullPath.push([start.lat, start.lng]);
                fullPath.push([end.lat, end.lng]);
            } else {
                const route = await fetchStreetRoute([start, end]);
                if (route && route.length > 0) {
                    if (i > 0 && fullPath.length > 0) fullPath.push(...route.slice(1));
                    else fullPath.push(...route);
                } else {
                    if (i === 0) fullPath.push([start.lat, start.lng]);
                    fullPath.push([end.lat, end.lng]);
                }
            }
        }
        return fullPath;
    };

    const forceRecalculateBranch = async (branchObj, overrideWps = null, overrideStrSegs = null) => {
        const bId = getBranchId(branchObj);
        setRecalculatingBranchId(bId);
        
        const wps = overrideWps || manualWaypoints[bId] || [];
        const strSegs = overrideStrSegs || straightSegments[bId] || [];
        
        const path = await calculateBranchPath(branchObj, wps, strSegs);
        if (path) setRoutedPaths(prev => ({ ...prev, [bId]: path }));
        
        setRecalculatingBranchId(null);
    };

    const handleImportRoutes = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const routes = data.routes || data; 
                if (Object.keys(routes).length === 0) { alert("❌ Arquivo vazio."); return; }
                
                setRoutedPaths(routes);
                setManualWaypoints(data.waypoints || {});
                setStraightSegments(data.straightSegments || {});
                alert(`✅ Sucesso! Rotas importadas.`);
            } catch (err) { alert("❌ Arquivo JSON inválido."); }
        };
        reader.readAsText(file);
        event.target.value = ''; 
    };

    const handleExportRoutes = () => {
        const exportData = { routes: routedPaths, waypoints: manualWaypoints, straightSegments };
        let jsonString = JSON.stringify(exportData, null, 2);
        jsonString = jsonString.replace(/\[\s+([-0-9.]+),\s+([-0-9.]+)\s+\]/g, '[$1, $2]');
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "systemRoutes.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleAddWaypoint = (e, branch) => {
        const bId = getBranchId(branch);
        const map = e.target._map;
        const p1 = geoPositions[branch.from];
        const p2 = geoPositions[branch.to];
        const wps = manualWaypoints[bId] || [];
        const points = [p1, ...wps, p2];
        
        const segIdx = getClickedSegmentIndex(map, e.latlng, points);
        const newWp = { id: Date.now(), lat: e.latlng.lat, lng: e.latlng.lng };
        
        const newWps = [...wps];
        newWps.splice(segIdx, 0, newWp);
        
        const oldStrSegs = straightSegments[bId] || [];
        const newStrSegs = [];
        for (let s of oldStrSegs) {
            if (s < segIdx) newStrSegs.push(s);
            if (s === segIdx) { newStrSegs.push(s); newStrSegs.push(s+1); } 
            if (s > segIdx) newStrSegs.push(s+1);
        }
        
        setStraightSegments(prev => ({ ...prev, [bId]: newStrSegs }));
        setManualWaypoints(prev => ({ ...prev, [bId]: newWps }));
        setRoutedPaths(prev => { const p = {...prev}; delete p[bId]; return p; });
    };

    const handleRemoveWaypoint = (branchObj, wpId) => {
        const bId = getBranchId(branchObj);
        const wps = manualWaypoints[bId] || [];
        const wpIndex = wps.findIndex(w => w.id === wpId);
        if (wpIndex === -1) return;
        
        const newWps = wps.filter(w => w.id !== wpId);
        const oldStrSegs = straightSegments[bId] || [];
        const newStrSegs = [];
        const seg1Straight = oldStrSegs.includes(wpIndex);
        const seg2Straight = oldStrSegs.includes(wpIndex + 1);
        
        for (let s of oldStrSegs) {
            if (s < wpIndex) newStrSegs.push(s);
            if (s > wpIndex + 1) newStrSegs.push(s - 1);
        }
        if (seg1Straight && seg2Straight) newStrSegs.push(wpIndex);
        
        setStraightSegments(prev => ({ ...prev, [bId]: [...new Set(newStrSegs)] }));
        setManualWaypoints(prev => ({ ...prev, [bId]: newWps }));
        setRoutedPaths(prev => { const p = {...prev}; delete p[bId]; return p; });
    };

    const handleUpdateWaypoint = (branchObj, wpId, newLatLng) => {
        const bId = getBranchId(branchObj);
        const newWps = (manualWaypoints[bId] || []).map(w => w.id === wpId ? { ...w, lat: newLatLng.lat, lng: newLatLng.lng } : w);
        setManualWaypoints(prev => ({ ...prev, [bId]: newWps }));
        setRoutedPaths(prev => { const p = {...prev}; delete p[bId]; return p; });
    };

    const createCustomIcon = (nodeId, color, type, v_pu, hasGD, gdActive, hasShunt, shuntSteps) => {
        let shape = '';
        const strokeColor = darkMode ? '#121212' : '#ffffff';
        const isBadVoltage = v_pu < 0.93 || v_pu > 1.05;
        const glowStyle = isBadVoltage ? `filter="drop-shadow(0px 0px 6px red)"` : '';

        if (type === 'sub') shape = `<circle cx="10" cy="10" r="8" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;
        else if (type === 'feeder') shape = `<polygon points="10,1 18,5 18,15 10,19 2,15 2,5" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;
        else if (type === 'shunt') shape = `<polygon points="10,2 18,10 10,18 2,10" fill="${color}" stroke="${strokeColor}" stroke-width="2.5" ${glowStyle}/>`;
        else shape = `<rect x="3" y="6" width="14" height="8" rx="1.5" fill="${color}" stroke="${strokeColor}" stroke-width="1.5" ${glowStyle}/>`;

        // Badge GD — mesmo padrão visual do GraphArea: círculo teal + raio SVG
        const gdBadge = hasGD ? `
            <circle cx="18" cy="2" r="5"
                fill="${gdActive ? 'rgba(212, 212, 0, 0.2)' : 'rgba(80,80,80,0.2)'}"
                stroke="${gdActive ? '#ffee00' : '#555'}"
                stroke-width="1.2"/>
            <path d="M17.8,-1.5 L16.2,1.8 L17.2,1.8 L16,5.5 L17.8,2.2 L16.8,2.2 Z"
                fill="${gdActive ? '#ffee00' : '#666'}"/>
        ` : '';

        // Badge Shunt — círculo azul + número de passos
        const shuntBadge = hasShunt ? `
            <circle cx="${hasGD ? 25 : 18}" cy="2" r="5"
                fill="rgba(0,188,212,0.2)"
                stroke="#00bcd4"
                stroke-width="1.2"/>
            <text x="${hasGD ? 25 : 18}" y="5.5"
                text-anchor="middle"
                font-size="5.5"
                font-weight="bold"
                fill="#00bcd4"
                font-family="sans-serif">
                ${shuntSteps}
            </text>
        ` : '';

        return L.divIcon({ className: 'custom-node', html: `<svg width="20" height="20" viewBox="0 0 20 20" style="overflow: visible;">${shape}${gdBadge}${shuntBadge}</svg>`, iconSize: [20, 20], iconAnchor: [10, 10] });
    };

    const waypointIcon = L.divIcon({ className: 'custom-waypoint', html: `<div style="background-color: #ff9800; width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 1 }}>
            
            {/* 👇 O MODAL GEOGRÁFICO ENTRA AQUI 👇 */}
            {showGeoModal && (
                <GeoImportModal
                    isOpen={showGeoModal}
                    onConfirm={(newGeoPositions) => {
                        setGeoPositions(newGeoPositions);
                        setShowGeoModal(false);
                    }}
                    onCancel={() => setShowGeoModal(false)}
                    allNodes={allNodes}
                    svgPositions={svgPositions} // 👈 Props vindas do App.jsx
                    darkMode={darkMode}
                />
            )}
            {/* 👆 FIM DO MODAL 👆 */}
            
            <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: darkMode ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)', padding: '10px 20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', display: 'flex', gap: '10px', backdropFilter: 'blur(5px)' }}>
                <input type="file" ref={fileInputRef} onChange={handleImportRoutes} style={{ display: 'none' }} accept=".json" />
                
                {isEditMode && (
                    <>
                        <button onClick={() => fileInputRef.current.click()} style={{ background: '#2196f3', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>📥 Importar systemRoutes.json</button>
                        <button onClick={handleExportRoutes} style={{ background: '#ff9800', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>💾 Exportar Rotas</button>
                        <button onClick={() => { const formattedPositions = "{\n" + Object.keys(geoPositions).sort((a,b)=>parseInt(a)-parseInt(b)).map(k => `    "${k}": { "lat": ${geoPositions[k].lat}, "lng": ${geoPositions[k].lng} }`).join(",\n") + "\n}"; console.log(formattedPositions); alert("Coordenadas no Console! Aperte F12 para copiar."); }} style={{ background: '#4caf50', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>💾 Exportar Posições</button>
                    </>
                )}
            </div>

            {recalculatingBranchId !== null && (
                <div style={{ position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#e91e63', color: 'white', padding: '8px 16px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 10px rgba(233,30,99,0.4)', animation: 'pulse 1.5s infinite' }}>🛰️ Roteando trecho...</div>
            )}

            {/* 👇 OVERLAY SVG INVISÍVEL PARA OS TOOLTIPS E POST-ITS 👇 */}
            {!isEditMode && (
                <div 
                    onMouseDown={handleSvgMouseDown}
                    onMouseMove={handleSvgMouseMove}
                    onMouseUp={handleSvgMouseUp}
                    onMouseLeave={handleSvgMouseUp}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, margin: 0, padding: 0, zIndex: 2000, pointerEvents: draggingCard ? 'all' : 'none' }}
                >
                    <svg style={{ width: '100%', height: '100%' }}>
                        <SvgTooltips 
                            isHoveringSVG={true} // Força ativo no mapa
                            localHoveredLine={hoveredLineId}
                            hoveredBranch={branches.find(b => b.id === hoveredLineId)}
                            hoveredLineData={lineCurrents[hoveredLineId]}
                            localHoveredNode={hoveredNodeId}
                            hoveredNodeInfo={nodeData[hoveredNodeId]}
                            manualPositions={{}} // HUD não usa grid SVG
                            animPositions={{}}   // HUD não usa grid SVG
                            sources={sources}
                            branches={branches}
                            lineCurrents={lineCurrents}
                            loads={loads}
                            systemLoads={systemLoads}
                            sses={sses}
                            feedersList={feedersList}
                            svgWorldBounds={svgBounds}
                            pinnedCards={pinnedCards}
                            setPinnedCards={setPinnedCards}
                            nodeData={nodeData}
                            mouseSvgPt={mouseSvgPt} 
                        />
                    </svg>
                </div>
            )}

            <MapContainer center={center} zoom={15} zoomControl={false} style={{ width: '100%', height: '100%', background: darkMode ? '#121212' : '#f0f2f5' }}>

                <ZoomControl position="topright" />
                
                {/* 👇 MAPA OUVE CLIQUES VAZIOS (E RESPEITA A TRAVA) */}
                <MapBackgroundEvents setSelectedElement={setSelectedElement} isEditMode={isEditMode} ignoreMapClickRef={ignoreMapClickRef} />
                
                {/* O RASTREADOR ALIMENTA A ANTENA DO SCADA */}
                {!isEditMode && <MapMouseTracker setMouseSvgPt={setMouseSvgPt} />}

                <TileLayer url={mapTileUrl} attribution='&copy; OSM' />

                {branches.map(branch => {
                    const bId = getBranchId(branch);
                    const p1 = geoPositions[branch.from];
                    const p2 = geoPositions[branch.to];
                    if (!p1 || !p2) return null;

                    const lineData = lineCurrents[bId] || lineCurrents[branch.id]; 
                    const isClosed = (branch.state !== undefined ? branch.state : branch.initialState) === 1;
                    
                    let displayColor = getEdgeColor(branch); 

                    if (!isClosed) {
                        displayColor = '#777'; 
                    } else if (lineData) {
                        if (lineData.hasLoop) {
                            displayColor = '#ffff00'; 
                        } else if (lineData.percentage > 100) {
                            displayColor = '#ff0000'; 
                        }
                    }

                    const path = routedPaths[bId] || [[p1.lat, p1.lng], [p2.lat, p2.lng]];
                    const isSelected = selectedElement?.type === 'edge' && (
                        (branch.id !== undefined && String(selectedElement?.data?.id) === String(branch.id)) || 
                        (String(selectedElement?.data?.from) === String(branch.from) && String(selectedElement?.data?.to) === String(branch.to))
                    );
                    
                    const isHovered = hoveredLineId === bId || hoveredLineId === branch.id;
                    const isRecalculating = recalculatingBranchId === bId;
                    
                    const lineColor = isRecalculating ? '#e91e63' : (isSelected || isHovered ? '#fff' : displayColor);
                    const lineWeight = isSelected || isHovered ? 8 : (lineData?.percentage > 100 ? 6 : 5);
                    const lineOpacity = isRecalculating ? 0.5 : (isSelected || isHovered ? 1.0 : (isClosed ? 0.9 : 0.4));

                    return (
                        <Polyline 
                            key={`branch-${bId}-${isClosed}-${displayColor}-${isHovered}`} 
                            positions={path} 
                            color={lineColor} 
                            weight={lineWeight} 
                            opacity={lineOpacity} 
                            dashArray={isClosed ? null : "10, 10"}
                            eventHandlers={{
                                mouseover: () => { if (setHoveredLineId) setHoveredLineId(branch.id !== undefined ? branch.id : bId); if (setHoveredNodeId) setHoveredNodeId(null);},
                                mouseout: () => { if (setHoveredLineId) setHoveredLineId(null); },

                                click: async (e) => { 
                                    // 👇 FECHA O SEMÁFORO! O clique no mapa será ignorado.
                                    ignoreMapClickRef.current = true;
                                    setTimeout(() => { ignoreMapClickRef.current = false; }, 100);

                                    if (isEditMode) {
                                        const map = e.target._map;
                                        const points = [p1, ...(manualWaypoints[bId] || []), p2];
                                        const segIdx = getClickedSegmentIndex(map, e.latlng, points);
                                        const isCtrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                                        let newBranchStrSegs = straightSegments[bId] || [];
                                        if (isCtrl) {
                                            if (!newBranchStrSegs.includes(segIdx)) newBranchStrSegs = [...newBranchStrSegs, segIdx];
                                        } else {
                                            if (newBranchStrSegs.includes(segIdx)) newBranchStrSegs = newBranchStrSegs.filter(i => i !== segIdx);
                                        }
                                        setStraightSegments(prev => ({ ...prev, [bId]: newBranchStrSegs }));
                                        await forceRecalculateBranch(branch, (manualWaypoints[bId] || []), newBranchStrSegs);
                                    } else {
                                        handleEdgeClick(branch, bId, e); 
                                    }
                                },
                                contextmenu: (e) => handleAddWaypoint(e, branch) 
                            }}
                        >
                            {/* O Tooltip antigo só aparece no Modo de Edição agora */}
                            {isEditMode && (
                                <Tooltip direction="center" sticky>
                                    <div style={{ textAlign: 'center' }}>
                                        <strong>Linha {branch.from}-{branch.to}</strong><br/>
                                        <span style={{fontSize: '10px', color: '#00bcd4'}}><strong>Ctrl+Click:</strong> Linha Reta NESTE trecho<br/><strong>Click Simples:</strong> Rota de Rua NESTE trecho</span>
                                    </div>
                                </Tooltip>
                            )}
                        </Polyline>
                    );
                })}

                {isEditMode && Object.keys(manualWaypoints).map(bId => {
                    const branchObj = branches.find(b => getBranchId(b) === bId);
                    return manualWaypoints[bId].map(wp => (
                        <Marker 
                            key={`wp-${wp.id}`} position={[wp.lat, wp.lng]} draggable={true} icon={waypointIcon}
                            eventHandlers={{ 
                                dragend: (e) => handleUpdateWaypoint(branchObj, wp.id, e.target.getLatLng()),
                                click: () => handleRemoveWaypoint(branchObj, wp.id) 
                            }}
                        ><Tooltip direction="top">Arraste para mover<br/>Clique p/ apagar</Tooltip></Marker>
                    ));
                })}

                {Object.keys(geoPositions).map(nodeId => {
                    const pos = geoPositions[nodeId];
                    const numId = parseInt(nodeId);
                    const v_pu = nodeData[nodeId]?.v || 1.0;
                    
                    const isSource = sources.includes(numId);
                    const isFeeder = feedersList.includes(numId);
                    
                    const isPassedShunt = systemShunts && (systemShunts[nodeId] || systemShunts[String(numId)]);
                    const hasShunt = !!isPassedShunt;
                    
                    const gdEntry = systemGD && (systemGD[nodeId] || systemGD[String(numId)]);
                    const hasGD   = !!gdEntry;
                    const gdActive = hasGD && gdEntry.active;

                    const isHovered = String(hoveredNodeId) === String(numId);
                    const isSelected = selectedElement?.type === 'node' && String(selectedElement?.id) === String(numId);
                    
                    const baseColor = getNodeColor(numId);
                    const color = isSelected || isHovered ? '#fff' : baseColor;
                    const type = isSource ? 'sub' : (isFeeder ? 'feeder' : (hasShunt ? 'shunt' : 'load'));

                    return (
                        <Marker 
                            key={`node-${nodeId}-${isHovered}-${gdActive}-${systemShunts?.[nodeId]?.steps}`}
                            position={[pos.lat, pos.lng]} draggable={isEditMode} icon={createCustomIcon(nodeId, color, type, v_pu, hasGD, gdActive, hasShunt, systemShunts?.[nodeId]?.steps ?? systemShunts?.[String(numId)]?.steps ?? '')}
                            eventHandlers={{ 
                                mouseover: () => { if (setHoveredNodeId) setHoveredNodeId(numId); if (setHoveredLineId) setHoveredLineId(null);},
                                mouseout: () => { if (setHoveredNodeId) setHoveredNodeId(null); },

                                dragend: (e) => setGeoPositions(prev => ({ ...prev, [nodeId]: { lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng } })),
                                
                                click: async (e) => { 
                                    ignoreMapClickRef.current = true;
                                    setTimeout(() => { ignoreMapClickRef.current = false; }, 100);

                                    if (isEditMode) {
                                        const isCtrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
                                        if (isCtrl) {
                                            const connectedBranches = branches.filter(b => b.from === numId || b.to === numId);
                                            for (const b of connectedBranches) await forceRecalculateBranch(b);
                                        }
                                        return;
                                    }
                                    // Alt+Click: toggle GD (se existir)
                                    if (e.originalEvent.altKey && hasGD && toggleGD) {
                                        toggleGD(numId);
                                        return;
                                    }
                                    handleNodeClick(numId, e); 
                                }
                            }}
                        >
                            {/* O Tooltip antigo só aparece no Modo de Edição agora */}
                            {isEditMode && (
                                <Tooltip direction="top" offset={[0, -8]}>
                                    <div style={{ textAlign: 'center' }}>
                                        <strong style={{ color: color }}>{type === 'shunt' ? 'CAPACITOR' : (isSource ? 'SUB' : (isFeeder ? 'ALIM' : 'BARRA'))} {nodeId}</strong><br/>
                                        <br/><span style={{fontSize: '9px', color: '#00bcd4'}}>Ctrl+Click: Recalcular Ruas conectadas</span>
                                    </div>
                                </Tooltip>
                            )}
                        </Marker>
                    );
                })}
            </MapContainer>
            {children}
        </div>
    );
}