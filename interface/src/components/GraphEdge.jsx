import React, { memo } from 'react';

/**
 * GraphEdge — Renderiza uma linha/ramal do sistema elétrico.
 *
 * Funcionalidades:
 *   - Seta de direção de fluxo no ponto médio da linha energizada
 *   - Linha tracejada para ramais abertos
 *   - Pontos de controle (waypoints) visíveis no modo edição
 *
 * Props adicionadas em relação à versão anterior:
 *   flowDir  {number}  +1 = fluxo de from→to | -1 = fluxo to→from | 0 = sem fluxo
 *   p1, p2   {object}  Posições {x,y} dos extremos (para calcular ponto médio)
 */

/**
 * Retorna a posição e ângulo no ponto médio de um caminho multi-segmento.
 * Necessário para posicionar a seta de direção de fluxo corretamente
 * mesmo quando a linha possui pontos intermediários (waypoints).
 *
 * @param {{x,y}} p1          Ponto inicial
 * @param {{x,y}[]} waypoints  Pontos intermediários
 * @param {{x,y}} p2          Ponto final
 * @returns {{x, y, angle}}
 */
function getMidpointInfo(p1, waypoints, p2) {
    const pts = [p1, ...waypoints, p2];

    // Comprimento total do caminho
    let totalLen = 0;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i].x;
        const dy = pts[i + 1].y - pts[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segs.push({ p: pts[i], dx, dy, len });
        totalLen += len;
    }

    // Caminha até a metade do comprimento total
    let target = totalLen / 2;
    for (const seg of segs) {
        if (target <= seg.len) {
            const f = target / (seg.len || 1);
            return {
                x: seg.p.x + f * seg.dx,
                y: seg.p.y + f * seg.dy,
                angle: Math.atan2(seg.dy, seg.dx) * (180 / Math.PI),
            };
        }
        target -= seg.len;
    }

    // Fallback: retorna o ponto final
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2] || pts[0];
    return {
        x: last.x,
        y: last.y,
        angle: Math.atan2(last.y - prev.y, last.x - prev.x) * (180 / Math.PI),
    };
}

const GraphEdge = memo(function GraphEdge({
    branch,
    pathString,
    color,
    isHighlighted,
    isEditMode,
    isRestoringLayout,
    waypoints,
    selectedEditWaypoints,
    dragInfoType,
    // Props de fluxo (novas)
    flowDir,   // +1 | -1 | 0
    p1,        // posição {x,y} do nó 'from'
    p2,        // posição {x,y} do nó 'to'
    // Handlers
    onLineMouseDown,
    onLineClick,
    onLineDoubleClick,
    onLineMouseEnter,
    onLineMouseLeave,
    onWaypointMouseDown,
    onWaypointDoubleClick,
    widthOverride,
}) {
    const strokeWidth = isHighlighted ? 6 : (widthOverride || (branch.state === 1 ? 3 : 2));
    const shadowFilter = isHighlighted ? `drop-shadow(0 0 5px ${color})` : 'none';

    // Mostra seta somente em ramais energizados com fluxo ativo e posições disponíveis
    const showArrow = branch.state === 1 && flowDir !== 0 && p1 && p2;
    const safeWaypoints = Array.isArray(waypoints) ? waypoints : [];

    // Posição e ângulo do ponto médio (para a seta)
    const mid = showArrow ? getMidpointInfo(p1, safeWaypoints, p2) : null;

    // Se o fluxo é invertido (to→from), rotaciona a seta 180°
    const arrowAngle = mid ? (flowDir === -1 ? mid.angle + 180 : mid.angle) : 0;

    return (
        <g>
            {/* ── Área de hit transparente (facilita clique em linhas finas) ── */}
            <path
                d={pathString}
                stroke="transparent"
                strokeWidth="20"
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ cursor: isEditMode ? 'move' : 'pointer' }}
                onMouseDown={(e) => onLineMouseDown(e, branch.id)}
                onClick={(e) => onLineClick(e, branch.id)}
                onDoubleClick={(e) => onLineDoubleClick(e, branch.id)}
                onMouseEnter={() => onLineMouseEnter(branch.id)}
                onMouseLeave={() => onLineMouseLeave(branch.id)}
            />

            {/* ── Linha visível ── */}
            <path
                d={pathString}
                stroke={color}
                strokeWidth={strokeWidth}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={branch.state === 1 ? 'none' : '8,6'}
                pointerEvents="none"
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{
                    transition: isRestoringLayout
                        ? 'd 0.4s cubic-bezier(0.25, 1, 0.5, 1), stroke 0.3s ease'
                        : 'stroke 0.3s ease',
                    filter: shadowFilter,
                    opacity: branch.state === 1 ? 1 : 0.65,
                }}
                /*// A classe CSS para animação de fluxo só é aplicada em linhas energizadas com fluxo ativo
                className={
                    branch.state === 1 && flowDir !== 0
                        ? (flowDir === 1 ? 'edge-flow' : 'edge-flow-rev')
                        : 'edge-line'
                }*/
            />

            {/* ── Seta de direção de fluxo (chevron) ── */}
            {/*showArrow && mid && (
                <g
                    transform={`translate(${mid.x}, ${mid.y}) rotate(${arrowAngle})`}
                    pointerEvents="none"
                    style={{ opacity: 0.8 }}
                >
                    {/*
                     * Chevron ">" centrado na origem local.
                     * Tamanho proporcional à espessura da linha para não poluir o diagrama.
                     
                    <polyline
                        points="-5,-4 0,0 -5,4"
                        stroke={color}
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                </g>
            )*/}

            {/* ── Pontos de controle / waypoints (somente no modo edição) ── */}
            {isEditMode && safeWaypoints.map((wp, wpIndex) => {
                const wpKey = `${branch.id}-${wpIndex}`;
                const isSelectedWp = selectedEditWaypoints.has(wpKey);
                return (
                    <circle
                        key={`wp-${wpKey}`}
                        cx={wp.x} cy={wp.y}
                        r={isSelectedWp ? '8' : '6'}
                        fill={isSelectedWp ? '#2962ff' : '#ff9800'}
                        stroke="#fff"
                        strokeWidth="2"
                        style={{
                            cursor: dragInfoType === 'waypoint' ? 'grabbing' : 'grab',
                            transition: isRestoringLayout
                                ? 'cx 0.4s cubic-bezier(0.25, 1, 0.5, 1), cy 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
                                : 'none',
                        }}
                        onMouseDown={(e) => onWaypointMouseDown(e, branch.id, wpIndex, wpKey, wp)}
                        onDoubleClick={(e) => onWaypointDoubleClick(e, branch.id, wpIndex)}
                    />
                );
            })}
        </g>
    );
});

export default GraphEdge;
