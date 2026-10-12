import React, { memo, useMemo } from 'react';

/**
 * GraphNode — Renderiza uma barra do sistema elétrico no diagrama SVG.
 */
const GraphNode = memo(function GraphNode({
    nodeId,
    pos,
    isSource,
    isFeeder,
    hasGD,        // Booleano: indica se este nó tem GD cadastrada
    gdActive,     // Booleano: indica se a GD está ligada
    color,
    isHighlighted,
    darkMode,
    isEditMode,
    isRestoringLayout,
    showLabels,
    nodeLoad,
    hasShunt,
    onMouseDown,
    onClick,
    onMouseEnter,
    onMouseLeave,
    currentScale,
    isSimplified
}) {

    const inverseScale = Math.min(1 / (currentScale || 1), 3);

    // 👇 A MÁGICA DA TRANSIÇÃO SUAVE (Lerp) 👇
    // Calcula um fator 't' que vai de 1 (Zoom Máximo LOD0) até 0 (Zoom Mínimo LOD2)
    const t = Math.max(0, Math.min(1, (currentScale - 0.6) / 0.6));

    // Tamanhos dinâmicos interpolados (Máximo do SVG ➔ Mínimo do Canvas)
    const baseSourceR = 15 + t * 16; // Cai progressivamente de 31 para 15
    
    // CORREÇÃO: Dá um leve "pop" se o mouse estiver em cima, mas mantém a proporção do zoom!
    const sourceR = isHighlighted ? baseSourceR + 4 : baseSourceR; 
    
    const feederR = 15 + t * 16;                        
    const shuntR = 12 + t * 13;                         
    const loadW = 18 + t * 22;                          
    const loadH = 10 + t * 12;                          

    // 👇 CORREÇÃO: A fonte também encolhe dinamicamente com a barra 👇
    // Subestação: vai de 16px para 10px. Barra normal: vai de 13px para 8px.
    const idFontSize = isSource ? `${10 + t * 6}px` : `${8 + t * 5}px`;

    // Distância dinâmica do rótulo "MW" para não ficar flutuando longe da barra
    const labelY = (loadH / 2) + 12;

    const isDetailed = !isSimplified || isHighlighted; 

    // Contorno de destaque ao hover / seleção
    const strokeColor = isHighlighted
        ? 'rgba(255,255,255,0.35)'
        : (darkMode ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)');
    
    const strokeWidth = isHighlighted ? 3 : (isDetailed ? 1.5 : 1); 

    const shadowFilter = isHighlighted
        ? `drop-shadow(0 0 10px ${color})`
        : 'none';

    const shapeStyle = { 
        filter: isDetailed ? shadowFilter : 'none', 
        transition: 'all 0.1s linear' 
    };

    const hexPoints = useMemo(() => {
        return Array.from({ length: 6 }, (_, i) => {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            return `${(feederR * Math.cos(a)).toFixed(2)},${(feederR * Math.sin(a)).toFixed(2)}`;
        }).join(' ');
    }, [feederR]); // 👈 Agora o useMemo recalcula quando o raio diminui

    const shuntPoints = `0,-${shuntR} ${shuntR},0 0,${shuntR} -${shuntR},0`;

    return (
        <g
            style={{
                transform: `translate(${pos.x}px, ${pos.y}px) scale(${inverseScale})`,
                cursor: isEditMode ? 'grab' : 'pointer',
                transition: isRestoringLayout
                    ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
                    : 'none',
            }}
            onMouseDown={(e) => onMouseDown(e, nodeId)}
            onClick={(e) => onClick(e, nodeId)}
            onMouseEnter={() => onMouseEnter(nodeId)}
            onMouseLeave={() => onMouseLeave(nodeId)}
        >
            {isSource ? (
                /* SUBESTAÇÃO PRINCIPAL */
                <g style={shapeStyle}>
                    <circle cx="0" cy="0" r={sourceR} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} />
                </g>
            ) : isFeeder ? (
                /* ALIMENTADOR */
                <g style={shapeStyle}>
                    <polygon points={hexPoints} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} />
                </g>
            ) : hasShunt ? (
                /* CAPACITOR / SHUNT */
                <polygon points={shuntPoints} fill={color} stroke={strokeColor} strokeWidth={strokeWidth} style={shapeStyle} />
            ) :  (
                /* CARGA NORMAL */
                <g>
                    {/* A hitbox continua fixa e invisível para garantir o clique */}
                    <rect x="-28" y="-16" width="56" height="32" fill="transparent" /> 
                    
                    {/* 👇 Centraliza dinamicamente usando a largura/altura calculada 👇 */}
                    <rect 
                        x={-loadW / 2} 
                        y={-loadH / 2} 
                        width={loadW} 
                        height={loadH} 
                        rx="4" 
                        fill={color} 
                        stroke={strokeColor} 
                        strokeWidth={strokeWidth} 
                        style={shapeStyle} 
                    />
                </g>
            )}

            {isDetailed && (
                <text
                    x="0" y="0"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize={idFontSize}
                    fontWeight="bold"
                    pointerEvents="none"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                >
                    {nodeId}
                </text>
            )}

            {isDetailed && showLabels && !isSource && !isFeeder && nodeLoad && (
                <text x="0" y={labelY} textAnchor="middle" fill={darkMode ? '#aaa' : '#666'} fontSize={`${7 + t * 2}px`} pointerEvents="none" >
                    {nodeLoad} MW
                </text>
            )}
        </g>
    );
});

export default GraphNode;