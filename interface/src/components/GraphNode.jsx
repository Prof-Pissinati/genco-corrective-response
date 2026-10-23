import React, { memo, useMemo } from 'react';

/**
 * GraphNode — Renders a bus of the electrical system in the SVG diagram.
 */
const GraphNode = memo(function GraphNode({
    nodeId,
    pos,
    isSource,
    isFeeder,
    hasGD,        // Boolean: indicates whether this node has a registered DG
    gdActive,     // Boolean: indicates whether the DG is on
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
    isSimplified,
    shedPct = 0   // fraction of the load shed by the plan (0 to 1); the bus stays energized
}) {

    const inverseScale = Math.min(1 / (currentScale || 1), 3);

    // 👇 SMOOTH TRANSITION (Lerp) 👇
    // Computes a factor 't' going from 1 (maximum zoom, LOD0) to 0 (minimum zoom, LOD2)
    const t = Math.max(0, Math.min(1, (currentScale - 0.6) / 0.6));

    // Interpolated dynamic sizes (SVG maximum ➔ Canvas minimum)
    const baseSourceR = 15 + t * 16; // Progressively drops from 31 to 15
    
    // FIX: gives a slight "pop" when the mouse is over it, but keeps the zoom proportion!
    const sourceR = isHighlighted ? baseSourceR + 4 : baseSourceR; 
    
    const feederR = 15 + t * 16;                        
    const shuntR = 12 + t * 13;                         
    const loadW = 18 + t * 22;                          
    const loadH = 10 + t * 12;                          

    // 👇 FIX: the font also shrinks dynamically with the bus 👇
    // Substation: goes from 16px to 10px. Normal bus: goes from 13px to 8px.
    const idFontSize = isSource ? `${10 + t * 6}px` : `${8 + t * 5}px`;

    // Dynamic distance of the "MW" label so it does not float away from the bus
    const labelY = (loadH / 2) + 12;

    const isDetailed = !isSimplified || isHighlighted; 

    // Highlight outline on hover / selection
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

    // load shed: the bus stays energized (same color), but without the load. Full shed = hollow shape; partial = filled. Always a dashed outline.
    const isShed = shedPct > 0;
    const fullShed = shedPct >= 0.99;
    const fillColor = fullShed ? (darkMode ? '#101014' : '#ffffff') : color;
    const outline = isShed ? (fullShed ? color : (darkMode ? '#ffffff' : '#222222')) : strokeColor;
    const outlineW = isShed ? Math.max(strokeWidth, 3) : strokeWidth;
    const dash = isShed ? '5 3' : undefined;
    const idColor = fullShed && !darkMode ? '#222' : 'white';

    const hexPoints = useMemo(() => {
        return Array.from({ length: 6 }, (_, i) => {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            return `${(feederR * Math.cos(a)).toFixed(2)},${(feederR * Math.sin(a)).toFixed(2)}`;
        }).join(' ');
    }, [feederR]); // 👈 Now the useMemo recomputes when the radius shrinks

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
                /* MAIN SUBSTATION */
                <g style={shapeStyle}>
                    <circle cx="0" cy="0" r={sourceR} fill={fillColor} stroke={outline} strokeWidth={outlineW} strokeDasharray={dash} />
                </g>
            ) : isFeeder ? (
                /* FEEDER */
                <g style={shapeStyle}>
                    <polygon points={hexPoints} fill={fillColor} stroke={outline} strokeWidth={outlineW} strokeDasharray={dash} />
                </g>
            ) : hasShunt ? (
                /* CAPACITOR / SHUNT */
                <polygon points={shuntPoints} fill={fillColor} stroke={outline} strokeWidth={outlineW} strokeDasharray={dash} style={shapeStyle} />
            ) :  (
                /* NORMAL LOAD */
                <g>
                    {/* The hitbox stays fixed and invisible to guarantee the click */}
                    <rect x="-28" y="-16" width="56" height="32" fill="transparent" /> 
                    
                    {/* 👇 Centers dynamically using the computed width/height 👇 */}
                    <rect 
                        x={-loadW / 2} 
                        y={-loadH / 2} 
                        width={loadW} 
                        height={loadH} 
                        rx="4" 
                        fill={fillColor} 
                        stroke={outline} 
                        strokeWidth={outlineW} 
                        strokeDasharray={dash} 
                        style={shapeStyle} 
                    />
                </g>
            )}

            {isDetailed && (
                <text
                    x="0" y="0"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={idColor}
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