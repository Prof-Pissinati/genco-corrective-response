import React from 'react';
import { isOverloaded as overloadedPct } from '../utils/loading';
import { parallelGroups } from '../utils/parallel';
import { voltageLevel, formatVoltage } from '../utils/voltage';

const TOOLTIP_W = 160;
const TOOLTIP_H_LINE = 105;
const TOOLTIP_H_NODE_SM = 70;
const TOOLTIP_H_NODE_LOAD = 90;
const TOOLTIP_H_NODE_SOURCE = 120; // 👈 Extra height to fit the voltage in Substations and Feeders

function smartOffset(anchorX, anchorY, tooltipW, tooltipH, bounds, invScale = 1) {
    // Scales the size and the 20px "breathing room" so it does not stick to the mouse when zoomed out
    const actualW = tooltipW * invScale;
    const actualH = tooltipH * invScale;
    const offset = 20 * invScale;

    if (!bounds) return { dx: offset, dy: offset };
    
    const dx = (anchorX + offset + actualW > bounds.right)  ? -(actualW + offset) : offset;
    const dy = (anchorY + offset + actualH > bounds.bottom) ? -(actualH + offset) : offset;
    return { dx, dy };
}

export default function SvgTooltips({
    isHoveringSVG,
    localHoveredLine,
    hoveredBranch,
    hoveredLineData,
    localHoveredNode,
    hoveredNodeInfo,
    manualPositions,
    animPositions,
    sources,
    branches,
    lineCurrents,
    loads,
    systemLoads,
    sses,
    feedersList = [],
    busLimits = null,
    svgWorldBounds,
    pinnedCards = [],
    setPinnedCards,
    nodeData,
    generatorBuses = null, // Map(bus -> {pgBase, pmax, ...}) in transmission
    shedBuses = null,      // Map(bus -> {mw, pct}) load shed by the plan in the displayed stage
    mouseSvgPt, // 👈 Mouse tracking coming from GraphArea
    currentScale
}) {
    
    const invScale = 1 / (currentScale || 1);
    const lineGroups = parallelGroups(branches);

    const removeCard = (id, type) => {
        setPinnedCards(prev => prev.filter(c => !(String(c.id) === String(id) && c.type === type)));
    };

    // =======================================================================
    // 1. LINE CARD RENDERER
    // =======================================================================
    const renderLineCard = (branchId, x, y, isPinned, hoverBranch = null, hoverData = null) => {
        const branch = hoverBranch || branches.find(b => b.id === branchId);
        if (!branch) return null;
        
        const data = hoverData || (lineCurrents && lineCurrents[branchId]) || { pFlow: 0, qFlow: 0, current: 0, percentage: 0 };
        const isOpen = branch.state === 0;
        const cg = lineGroups.get(branch.id);
        const circuit = cg ? ` ${cg.letter}` : '';                  // circuit A/B of the parallel lines
        
        const pMW = data.pFlow / 1000;
        const qMVAr = data.qFlow / 1000;
        
        // 1. Does the math say the Parent -> Child flow reversed? (DG exceeded the load)
        const mathReversed = pMW < 0;
        
        // 2. Was the Geometry (registry) drawn reversed? (From = Leaf)
        // NOTE: since the Reducer/Expander may not easily expose the parentId here in the UI,
        // but we do have the real voltages (nodeData), physics gives us the absolute truth!
        // Energy ALWAYS flows from the node with the HIGHER voltage to the node with the LOWER voltage.
        
        let isReverse = mathReversed; // Fallback in case we do not have nodeData

        if (nodeData && nodeData[branch.from] && nodeData[branch.to]) {
            const vFrom = nodeData[branch.from].v;
            const vTo = nodeData[branch.to].v;
            // If V_from < V_to, the PHYSICAL energy is flowing To -> From
            isReverse = vFrom < vTo;
        }

        const flowFrom = isReverse ? branch.to : branch.from;
        const flowTo = isReverse ? branch.from : branch.to;
        const displayP = Math.abs(pMW);
        
        // Keeps the vector coherence of Q with the main P flow
        const displayQ = isReverse ? -qMVAr : qMVAr;

        const safePercent = isNaN(data.percentage) ? 0 : Math.max(0, data.percentage);
        const barWidth = 130;
        const fillWidth = barWidth * Math.min(safePercent, 100) / 100;
        const fillColor = overloadedPct(safePercent) ? '#d32f2f' : (safePercent > 80 ? '#ff9800' : '#4caf50');
        const isOverloaded = overloadedPct(safePercent);

        return (
            <g transform={`translate(${x}, ${y}) scale(${invScale})`} pointerEvents={isPinned ? "all" : "none"} className={isPinned ? "pinned-card" : "svg-tooltip"} data-id={branch.id} data-type="line" key={isPinned ? `pin-line-${branch.id}` : `hov-line-${branch.id}`}>
                
                {/* Card Background (bright blue border if pinned) */}
                <rect x="0" y="0" width={TOOLTIP_W} height={TOOLTIP_H_LINE} rx="6" fill="rgba(18,18,18,0.96)" stroke={isPinned ? "#001aff" : "#444"} strokeWidth={isPinned ? "1.5" : "1"} cursor={isPinned ? "grab" : "default"} />
                
                {/* Subtle Close button */}
                {isPinned && (
                    <text x={TOOLTIP_W - 16} y="16" fill="#888" fontSize="12" cursor="pointer" onMouseDown={(e) => { e.stopPropagation(); removeCard(branch.id, 'line'); }}>✖</text>
                )}

                <text x={TOOLTIP_W / 2} y="20" fill={isOverloaded ? "#f44336" : "#00bcd4"} fontSize="12" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
                    {isOpen ? `${branch.from} - ${branch.to}${circuit} (OPEN)` : isOverloaded ? `${flowFrom}➔ ${flowTo}${circuit} (Overload)` : `${flowFrom} ➔ ${flowTo}${circuit}`}
                </text>
                <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />

                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">P (Active):</text>
                <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isOpen ? "0.00 MW" : `${displayP.toFixed(2)} MW`}</text>

                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Q (Reactive):</text>
                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isOpen ? "0.00 MVAr" : `${displayQ.toFixed(2)} MVAr`}</text>

                <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">{data.unit === 'MW' ? 'Flow P:' : 'Current:'}</text>
                <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isOpen ? (data.unit === 'MW' ? "0.0 MW" : "0.0 A") : `${data.current.toFixed(1)} ${data.unit === 'MW' ? 'MW' : 'A'}`}</text>

                <rect x="15" y="80" width={barWidth} height="14" rx="3" fill="#2a2a2a" />
                <rect x="15" y="80" width={isOpen ? 0 : fillWidth} height="14" rx="3" fill={fillColor} />
                <text x={15 + barWidth / 2} y="91" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{isOpen ? "0.0%" : (isNaN(safePercent) ? 'N/A' : `${safePercent.toFixed(1)}%`)}</text>
            </g>
        );
    };

    // =======================================================================
    // 2. BUS (NODE) CARD RENDERER
    // =======================================================================
    const renderNodeCard = (nodeId, x, y, isPinned, hoverInfo = null) => {
        const nodeInfo = hoverInfo || (nodeData && nodeData[nodeId]) || { v: 0, angle: 0 };
        const isMW = Object.values(nodeData || {})[0]?.unit === 'MW'; // transmission: powers in MW
        const fP = (kw) => isMW ? `${(kw / 1000).toFixed(1)} MW` : `${kw.toFixed(1)} kW`;
        const fQ = (kvar) => isMW ? `${(kvar / 1000).toFixed(1)} MVAr` : `${kvar.toFixed(1)} kVAr`;

        const isMainSource = sources.includes(nodeId);
        const isFeeder     = feedersList.includes(nodeId);
        const isSource     = isMainSource || isFeeder;
        const hoveredLoad  = systemLoads && systemLoads[nodeId];
        // bus with a generator (not the substation/reference): same card as the substation, with the dispatch of the displayed stage
        const gen = !isSource && generatorBuses && generatorBuses.get ? generatorBuses.get(Number(nodeId)) : null;
        const isGen = !!gen;
        const showSrc = isSource || isGen;
        const shed = shedBuses && shedBuses.get ? shedBuses.get(Number(nodeId)) : null;                 // load shed at this bus
        const shedFrac = shed && shed.pct ? shed.pct : 0;
        const showShedRow = !!shed && !!hoveredLoad;

        let totalP = 0, totalQ = 0, sApparent = 0, loadingPercent = 0;
        let sLimit = 1000;

        if (isSource && lineCurrents) {
            if (isMainSource) {
                branches.forEach(b => {
                    if (b.state === 1 && lineCurrents[b.id]) {
                        if      (b.from === nodeId) { totalP += lineCurrents[b.id].pFlow; totalQ += lineCurrents[b.id].qFlow; }
                        else if (b.to   === nodeId) { totalP -= lineCurrents[b.id].pFlow; totalQ -= lineCurrents[b.id].qFlow; }
                    }
                });
                totalP = Math.abs(totalP); totalQ = Math.abs(totalQ);
            } else {
                let sumP = 0, sumQ = 0;
                branches.forEach(b => {
                    if (b.state === 1 && lineCurrents[b.id] && (b.from === nodeId || b.to === nodeId)) {
                        sumP += Math.abs(lineCurrents[b.id].pFlow);
                        sumQ += Math.abs(lineCurrents[b.id].qFlow);
                    }
                });
                totalP = sumP / 2; totalQ = sumQ / 2;
            }

            sLimit         = sses?.[nodeId] ?? 1000;
            sApparent      = Math.sqrt(totalP ** 2 + totalQ ** 2);
            loadingPercent = (sApparent / sLimit) * 100;
        }
        if (isGen) {
            const pgMW = nodeInfo.pg !== undefined ? nodeInfo.pg : gen.pgBase;      // MW of the displayed stage (the card formats kW -> MW)
            totalP = pgMW * 1000; totalQ = (nodeInfo.qg || 0) * 1000;
            loadingPercent = gen.pmax > 0 ? (pgMW / gen.pmax) * 100 : 0;            // fraction of the capacity (Pmax)
        }

        // generators with load: two extra lines (load served and, if any, the shed load); load buses with shedding: one extra line
        const baseH = showSrc ? TOOLTIP_H_NODE_SOURCE : (hoveredLoad ? TOOLTIP_H_NODE_LOAD : TOOLTIP_H_NODE_SM);
        const cardH = baseH + (isGen && hoveredLoad ? 16 : 0) + (showShedRow ? 16 : 0);

        const vPu      = nodeInfo.v !== undefined ? formatVoltage(nodeInfo.v, !!busLimits) : '1.000';
        const angle    = nodeInfo.angle !== undefined ? nodeInfo.angle.toFixed(2)  : '0.00';
        const vLevel  = voltageLevel(nodeInfo.v, busLimits ? busLimits[nodeId] || null : null);
        const vColor   = vLevel === 'bad' ? '#ff5252' : (vLevel === 'warn' ? '#ffd600' : '#4caf50');
        const loadColor = overloadedPct(loadingPercent) ? '#f44336' : (loadingPercent > 80 ? '#ff9800' : '#4caf50');

        const titleColor = (isMainSource || isGen) ? '#00bcd4' : (isFeeder ? '#4caf50' : '#ff9800');
        const titleLabel = isMainSource ? `Substation ${nodeId}` : isGen ? `Generator ${nodeId}` : isFeeder ? `Feeder ${nodeId}` : `Bus ${nodeId}`;

        return (
            <g transform={`translate(${x}, ${y}) scale(${invScale})`} pointerEvents={isPinned ? "all" : "none"} className={isPinned ? "pinned-card" : "svg-tooltip"} data-id={nodeId} data-type="node" key={isPinned ? `pin-node-${nodeId}` : `hov-node-${nodeId}`}>
                
                <rect x="0" y="0" width={TOOLTIP_W} height={cardH} rx="6" fill="rgba(18,18,18,0.96)" stroke={isPinned ? "#001aff" : "#444"} strokeWidth={isPinned ? "1.5" : "1"} cursor={isPinned ? "grab" : "default"} />
                
                {isPinned && (
                    <text x={TOOLTIP_W - 16} y="16" fill="#888" fontSize="12" cursor="pointer" onMouseDown={(e) => { e.stopPropagation(); removeCard(nodeId, 'node'); }}>✖</text>
                )}

                <text x="12" y="20" fill={titleColor} fontSize="12" fontWeight="bold" fontFamily="monospace">{titleLabel}</text>
                <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />

                {!showSrc && (
                    <>
                        <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">V:</text>
                        <text x="25" y="44" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{vPu} pu</text>
                        <text x="95" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">θ:</text>
                        <text x="110" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{angle}°</text>
                    </>
                )}

                {/* 👇 ADDED: Voltage and Angle adjusted in Substations and Feeders 👇 */}
                {showSrc && (
                    <>
                        <text x="12" y="42" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demand P:' : 'Generation P:'}</text>
                        <text x="148" y="42" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{fP(totalP)}</text>
                        <text x="12" y="56" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demand Q:' : 'Generation Q:'}</text>
                        <text x="148" y="56" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{fQ(totalQ)}</text>
                        <text x="12" y="70" fill="#aaa" fontSize="11" fontFamily="monospace">Loading:</text>
                        <text x="148" y="70" fill={loadColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{loadingPercent.toFixed(1)}%</text>
                        {/* Loading Bar */}
                        <rect x="12" y="78" width="136" height="8" rx="3" fill="#2a2a2a" />
                        <rect x="12" y="78" width={Math.min(136, (loadingPercent / 100) * 136)} height="8" rx="3" fill={loadColor} style={{ transition: 'width 0.3s ease' }} />
                        <line x1="10" y1="94" x2="150" y2="94" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                        <text x="12" y="110" fill="#aaa" fontSize="11" fontFamily="monospace">V:</text>
                        <text x="25" y="110" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{vPu} pu</text>
                        <text x="95" y="110" fill="#aaa" fontSize="11" fontFamily="monospace">θ:</text>
                        <text x="110" y="110" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{angle}°</text>
                        {isGen && hoveredLoad && (
                            <>
                                <line x1="10" y1="118" x2="150" y2="118" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                                <text x="12" y="132" fill="#aaa" fontSize="11" fontFamily="monospace">Load P:</text>
                                <text x="148" y="132" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{fP(Math.max(0, hoveredLoad.p * (1 - shedFrac)))}</text>
                                {shed && (<text x="12" y="146" fill="#ffb74d" fontSize="10" fontFamily="monospace">{`✂ shed: ${fP(shed.mw * 1000)} (${Math.round(shedFrac * 100)}%)`}</text>)}
                            </>
                        )}
                    </>
                )}

                {!showSrc && hoveredLoad && (
                    <>
                        <line x1="10" y1="52" x2="150" y2="52" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                        <text x="12" y="66" fill="#aaa" fontSize="11" fontFamily="monospace">Load P:</text>
                        <text x="148" y="66" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isMW ? fP(hoveredLoad.p * (1 - shedFrac)) : `${hoveredLoad.p.toFixed(0)} kW`}</text>
                        <text x="12" y="80" fill="#aaa" fontSize="11" fontFamily="monospace">Load Q:</text>
                        <text x="148" y="80" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isMW ? fQ(hoveredLoad.q * (1 - shedFrac)) : `${hoveredLoad.q.toFixed(0)} kVAr`}</text>
                        {shed && (<text x="12" y="94" fill="#ffb74d" fontSize="10" fontFamily="monospace">{`✂ shed: ${fP(shed.mw * 1000)} (${Math.round(shedFrac * 100)}%)`}</text>)}
                    </>
                )}
            </g>
        );
    };

    return (
        <>
            {/* RENDERS THE PINNED POST-ITS FIRST */}
            {pinnedCards && pinnedCards.map(card => {
                if (card.type === 'line') return renderLineCard(card.id, card.x, card.y, true);
                if (card.type === 'node') return renderNodeCard(card.id, card.x, card.y, true);
                return null;
            })}

            {/* 👇 RENDERS THE HOVER TOOLTIP (NOW TRACKS THE MOUSE) 👇 */}
            {localHoveredLine !== null && hoveredBranch && (() => {
                const isPinned = pinnedCards.some(c => String(c.id) === String(hoveredBranch.id) && c.type === 'line');
                if (isPinned) return null;

                const ptX = mouseSvgPt?.x || 0;
                const ptY = mouseSvgPt?.y || 0;
                const { dx, dy } = smartOffset(ptX, ptY, TOOLTIP_W, TOOLTIP_H_LINE, svgWorldBounds, invScale);

                return renderLineCard(hoveredBranch.id, ptX + dx, ptY + dy, false, hoveredBranch, hoveredLineData);
            })()}

            {localHoveredNode !== null && hoveredNodeInfo && (() => {
                const isPinned = pinnedCards.some(c => String(c.id) === String(localHoveredNode) && c.type === 'node');
                if (isPinned) return null;

                const isMainSource = sources.includes(localHoveredNode);
                const isFeeder     = feedersList.includes(localHoveredNode);
                const isSource     = isMainSource || isFeeder;
                const hoveredLoad  = systemLoads && systemLoads[localHoveredNode];
                
                const tooltipH = (isSource || (generatorBuses && generatorBuses.has && generatorBuses.has(Number(localHoveredNode)))) ? TOOLTIP_H_NODE_SOURCE : (hoveredLoad ? TOOLTIP_H_NODE_LOAD : TOOLTIP_H_NODE_SM);
                
                const ptX = mouseSvgPt?.x || 0;
                const ptY = mouseSvgPt?.y || 0;
                const { dx, dy } = smartOffset(ptX, ptY, TOOLTIP_W, TOOLTIP_H_LINE, svgWorldBounds, invScale);

                return renderNodeCard(localHoveredNode, ptX + dx, ptY + dy, false, hoveredNodeInfo);
            })()}
        </>
    );
}