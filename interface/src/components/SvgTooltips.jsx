import React from 'react';

const TOOLTIP_W = 160;
const TOOLTIP_H_LINE = 105;
const TOOLTIP_H_NODE_SM = 70;
const TOOLTIP_H_NODE_LOAD = 90;
const TOOLTIP_H_NODE_SOURCE = 120; // 👈 Altura extra para caber a tensão nas Subestações e Alimentadores

function smartOffset(anchorX, anchorY, tooltipW, tooltipH, bounds, invScale = 1) {
    // Escala o tamanho e o "respiro" de 20px para não ficar grudado no mouse de longe
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
    svgWorldBounds,
    pinnedCards = [],
    setPinnedCards,
    nodeData,
    mouseSvgPt, // 👈 Rastreio do mouse vindo do GraphArea
    currentScale
}) {
    
    const invScale = 1 / (currentScale || 1);

    const removeCard = (id, type) => {
        setPinnedCards(prev => prev.filter(c => !(String(c.id) === String(id) && c.type === type)));
    };

    // =======================================================================
    // 1. RENDERIZADOR DE CARDS DE LINHA
    // =======================================================================
    const renderLineCard = (branchId, x, y, isPinned, hoverBranch = null, hoverData = null) => {
        const branch = hoverBranch || branches.find(b => b.id === branchId);
        if (!branch) return null;
        
        const data = hoverData || (lineCurrents && lineCurrents[branchId]) || { pFlow: 0, qFlow: 0, current: 0, percentage: 0 };
        const isOpen = branch.state === 0;
        
        const pMW = data.pFlow / 1000;
        const qMVAr = data.qFlow / 1000;
        
        // 1. A Matemática diz que inverteu o fluxo Pai -> Filho? (GD superou a carga)
        const mathReversed = pMW < 0;
        
        // 2. A Geometria (cadastro) foi desenhada invertida? (From = Leaf)
        // OBS: Como o Redutor/Expansor pode não expor o parentId facilmente aqui na UI,
        // mas nós temos as tensões reais (nodeData), a física nos dá a verdade absoluta!
        // A energia SEMPRE flui do nó com MAIOR tensão para o nó com MENOR tensão.
        
        let isReverse = mathReversed; // Fallback caso não tenhamos nodeData

        if (nodeData && nodeData[branch.from] && nodeData[branch.to]) {
            const vFrom = nodeData[branch.from].v;
            const vTo = nodeData[branch.to].v;
            // Se V_from < V_to, a energia FÍSICA está fluindo To -> From
            isReverse = vFrom < vTo;
        }

        const flowFrom = isReverse ? branch.to : branch.from;
        const flowTo = isReverse ? branch.from : branch.to;
        const displayP = Math.abs(pMW);
        
        // Mantém a coerência vetorial do Q com o fluxo principal de P
        const displayQ = isReverse ? -qMVAr : qMVAr;

        const safePercent = isNaN(data.percentage) ? 0 : Math.max(0, data.percentage);
        const barWidth = 130;
        const fillWidth = barWidth * Math.min(safePercent, 100) / 100;
        const fillColor = safePercent >= 100 ? '#d32f2f' : (safePercent > 80 ? '#ff9800' : '#4caf50');
        const isOverloaded = safePercent > 100;

        return (
            <g transform={`translate(${x}, ${y}) scale(${invScale})`} pointerEvents={isPinned ? "all" : "none"} className={isPinned ? "pinned-card" : "svg-tooltip"} data-id={branch.id} data-type="line" key={isPinned ? `pin-line-${branch.id}` : `hov-line-${branch.id}`}>
                
                {/* Fundo do Card (Borda azul vivido se estiver fixado) */}
                <rect x="0" y="0" width={TOOLTIP_W} height={TOOLTIP_H_LINE} rx="6" fill="rgba(18,18,18,0.96)" stroke={isPinned ? "#001aff" : "#444"} strokeWidth={isPinned ? "1.5" : "1"} cursor={isPinned ? "grab" : "default"} />
                
                {/* Botão de Fechar sutil */}
                {isPinned && (
                    <text x={TOOLTIP_W - 16} y="16" fill="#888" fontSize="12" cursor="pointer" onMouseDown={(e) => { e.stopPropagation(); removeCard(branch.id, 'line'); }}>✖</text>
                )}

                <text x={TOOLTIP_W / 2} y="20" fill={isOverloaded ? "#f44336" : "#00bcd4"} fontSize="12" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
                    {isOpen ? `${branch.from} - ${branch.to} (ABERTA)` : isOverloaded ? `${flowFrom}➔ ${flowTo} (Sobrecarga)` : `${flowFrom} ➔ ${flowTo}`}
                </text>
                <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />

                <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">P (Ativa):</text>
                <text x="148" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isOpen ? "0.00 MW" : `${displayP.toFixed(2)} MW`}</text>

                <text x="12" y="58" fill="#aaa" fontSize="11" fontFamily="monospace">Q (Reativa):</text>
                <text x="148" y="58" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isOpen ? "0.00 MVAr" : `${displayQ.toFixed(2)} MVAr`}</text>

                <text x="12" y="72" fill="#aaa" fontSize="11" fontFamily="monospace">{data.unit === 'MW' ? 'Fluxo P:' : 'Corrente:'}</text>
                <text x="148" y="72" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isOpen ? (data.unit === 'MW' ? "0.0 MW" : "0.0 A") : `${data.current.toFixed(1)} ${data.unit === 'MW' ? 'MW' : 'A'}`}</text>

                <rect x="15" y="80" width={barWidth} height="14" rx="3" fill="#2a2a2a" />
                <rect x="15" y="80" width={isOpen ? 0 : fillWidth} height="14" rx="3" fill={fillColor} />
                <text x={15 + barWidth / 2} y="91" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{isOpen ? "0.0%" : (isNaN(safePercent) ? 'N/A' : `${safePercent.toFixed(1)}%`)}</text>
            </g>
        );
    };

    // =======================================================================
    // 2. RENDERIZADOR DE CARDS DE BARRAS (NÓS)
    // =======================================================================
    const renderNodeCard = (nodeId, x, y, isPinned, hoverInfo = null) => {
        const nodeInfo = hoverInfo || (nodeData && nodeData[nodeId]) || { v: 0, angle: 0 };
        const isMW = Object.values(nodeData || {})[0]?.unit === 'MW'; // transmissão: potências em MW
        const fP = (kw) => isMW ? `${(kw / 1000).toFixed(1)} MW` : `${kw.toFixed(1)} kW`;
        const fQ = (kvar) => isMW ? `${(kvar / 1000).toFixed(1)} MVAr` : `${kvar.toFixed(1)} kVAr`;

        const isMainSource = sources.includes(nodeId);
        const isFeeder     = feedersList.includes(nodeId);
        const isSource     = isMainSource || isFeeder;
        const hoveredLoad  = systemLoads && systemLoads[nodeId];

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

        const cardH = isSource ? TOOLTIP_H_NODE_SOURCE : (hoveredLoad ? TOOLTIP_H_NODE_LOAD : TOOLTIP_H_NODE_SM);

        const vPu      = nodeInfo.v !== undefined ? nodeInfo.v.toFixed(3)     : '1.000';
        const angle    = nodeInfo.angle !== undefined ? nodeInfo.angle.toFixed(2)  : '0.00';
        const vColor   = (nodeInfo.v < 0.93 || nodeInfo.v > 1.05) ? '#ff5252' : (nodeInfo.v < 0.95 ? '#ffd600' : '#4caf50');
        const loadColor = loadingPercent > 100 ? '#f44336' : (loadingPercent > 80 ? '#ff9800' : '#4caf50');

        const titleColor = isMainSource ? '#00bcd4' : (isFeeder ? '#4caf50' : '#ff9800');
        const titleLabel = isMainSource ? `Subestação ${nodeId}` : isFeeder ? `Alim. ${nodeId}` : `Barra ${nodeId}`;

        return (
            <g transform={`translate(${x}, ${y}) scale(${invScale})`} pointerEvents={isPinned ? "all" : "none"} className={isPinned ? "pinned-card" : "svg-tooltip"} data-id={nodeId} data-type="node" key={isPinned ? `pin-node-${nodeId}` : `hov-node-${nodeId}`}>
                
                <rect x="0" y="0" width={TOOLTIP_W} height={cardH} rx="6" fill="rgba(18,18,18,0.96)" stroke={isPinned ? "#001aff" : "#444"} strokeWidth={isPinned ? "1.5" : "1"} cursor={isPinned ? "grab" : "default"} />
                
                {isPinned && (
                    <text x={TOOLTIP_W - 16} y="16" fill="#888" fontSize="12" cursor="pointer" onMouseDown={(e) => { e.stopPropagation(); removeCard(nodeId, 'node'); }}>✖</text>
                )}

                <text x="12" y="20" fill={titleColor} fontSize="12" fontWeight="bold" fontFamily="monospace">{titleLabel}</text>
                <line x1="10" y1="28" x2="150" y2="28" stroke="#555" strokeWidth="1" />

                {!isSource && (
                    <>
                        <text x="12" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">V:</text>
                        <text x="25" y="44" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{vPu} pu</text>
                        <text x="95" y="44" fill="#aaa" fontSize="11" fontFamily="monospace">θ:</text>
                        <text x="110" y="44" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{angle}°</text>
                    </>
                )}

                {/* 👇 ADICIONADO: Tensão e Ângulo ajustados nas Subestações e Alimentadores 👇 */}
                {isSource && (
                    <>
                        <text x="12" y="42" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demanda P:' : 'Geração P:'}</text>
                        <text x="148" y="42" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{fP(totalP)}</text>
                        <text x="12" y="56" fill="#aaa" fontSize="11" fontFamily="monospace">{isFeeder ? 'Demanda Q:' : 'Geração Q:'}</text>
                        <text x="148" y="56" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{fQ(totalQ)}</text>
                        <text x="12" y="70" fill="#aaa" fontSize="11" fontFamily="monospace">Carregamento:</text>
                        <text x="148" y="70" fill={loadColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{loadingPercent.toFixed(1)}%</text>
                        {/* Barrinha de Carregamento */}
                        <rect x="12" y="78" width="136" height="8" rx="3" fill="#2a2a2a" />
                        <rect x="12" y="78" width={Math.min(136, (loadingPercent / 100) * 136)} height="8" rx="3" fill={loadColor} style={{ transition: 'width 0.3s ease' }} />
                        <line x1="10" y1="94" x2="150" y2="94" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                        <text x="12" y="110" fill="#aaa" fontSize="11" fontFamily="monospace">V:</text>
                        <text x="25" y="110" fill={vColor} fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{vPu} pu</text>
                        <text x="95" y="110" fill="#aaa" fontSize="11" fontFamily="monospace">θ:</text>
                        <text x="110" y="110" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="start">{angle}°</text>
                    </>
                )}

                {!isSource && hoveredLoad && (
                    <>
                        <line x1="10" y1="52" x2="150" y2="52" stroke="#444" strokeWidth="1" strokeDasharray="3,3" />
                        <text x="12" y="66" fill="#aaa" fontSize="11" fontFamily="monospace">Carga P:</text>
                        <text x="148" y="66" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isMW ? fP(hoveredLoad.p) : `${hoveredLoad.p.toFixed(0)} kW`}</text>
                        <text x="12" y="80" fill="#aaa" fontSize="11" fontFamily="monospace">Carga Q:</text>
                        <text x="148" y="80" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="end">{isMW ? fQ(hoveredLoad.q) : `${hoveredLoad.q.toFixed(0)} kVAr`}</text>
                    </>
                )}
            </g>
        );
    };

    return (
        <>
            {/* RENDERIZA OS POST-ITS FIXADOS PRIMEIRO */}
            {pinnedCards && pinnedCards.map(card => {
                if (card.type === 'line') return renderLineCard(card.id, card.x, card.y, true);
                if (card.type === 'node') return renderNodeCard(card.id, card.x, card.y, true);
                return null;
            })}

            {/* 👇 RENDERIZA O TOOLTIP HOVER (AGORA RASTREA O MOUSE) 👇 */}
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
                
                const tooltipH = isSource ? TOOLTIP_H_NODE_SOURCE : (hoveredLoad ? TOOLTIP_H_NODE_LOAD : TOOLTIP_H_NODE_SM);
                
                const ptX = mouseSvgPt?.x || 0;
                const ptY = mouseSvgPt?.y || 0;
                const { dx, dy } = smartOffset(ptX, ptY, TOOLTIP_W, TOOLTIP_H_LINE, svgWorldBounds, invScale);

                return renderNodeCard(localHoveredNode, ptX + dx, ptY + dy, false, hoveredNodeInfo);
            })()}
        </>
    );
}