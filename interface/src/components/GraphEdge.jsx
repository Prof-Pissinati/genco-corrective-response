import React, { memo } from 'react';

/**
 * GraphEdge — Renders a line/branch of the electrical system.
 *
 * Funcionalidades:
 *   - Flow-direction arrow at the midpoint of the energized line
 *   - Dashed line for open branches
 *   - Control points (waypoints) visible in edit mode
 *
 * Props added relative to the previous version:
 *   flowDir  {number}  +1 = flow from→to | -1 = flow to→from | 0 = no flow
 *   p1, p2   {object}  Endpoint {x,y} positions (to compute the midpoint)
 */

/**
 * Returns the position and angle at the midpoint of a multi-segment path.
 * Needed to position the flow-direction arrow correctly
 * even when the line has intermediate points (waypoints).
 *
 * @param {{x,y}} p1          Start point
 * @param {{x,y}[]} waypoints  Intermediate points
 * @param {{x,y}} p2          End point
 * @returns {{x, y, angle}}
 */
function getMidpointInfo(p1, waypoints, p2) {
    const pts = [p1, ...waypoints, p2];

    // Total path length
    let totalLen = 0;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i].x;
        const dy = pts[i + 1].y - pts[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segs.push({ p: pts[i], dx, dy, len });
        totalLen += len;
    }

    // Walks to half of the total length
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

    // Fallback: returns the end point
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
    // Flow props (new)
    flowDir,   // +1 | -1 | 0
    p1,        // {x,y} position of the 'from' node
    p2,        // {x,y} position of the 'to' node
    // Handlers
    onLineMouseDown,
    onLineClick,
    onLineDoubleClick,
    onLineMouseEnter,
    onLineMouseLeave,
    onWaypointMouseDown,
    onWaypointDoubleClick,
    widthOverride,
    hitWidth = 20,   // width of the click area (smaller on parallel circuits, so each receives only its own click)
}) {
    const strokeWidth = isHighlighted ? 6 : (widthOverride || (branch.state === 1 ? 3 : 2));
    const shadowFilter = isHighlighted ? `drop-shadow(0 0 5px ${color})` : 'none';

    // Shows the arrow only on energized branches with active flow and available positions
    const showArrow = branch.state === 1 && flowDir !== 0 && p1 && p2;
    const safeWaypoints = Array.isArray(waypoints) ? waypoints : [];

    // Midpoint position and angle (for the arrow)
    const mid = showArrow ? getMidpointInfo(p1, safeWaypoints, p2) : null;

    // If the flow is reversed (to→from), rotates the arrow 180°
    const arrowAngle = mid ? (flowDir === -1 ? mid.angle + 180 : mid.angle) : 0;

    return (
        <g>
            {/* ── Transparent hit area (makes clicking thin lines easier) ── */}
            <path
                d={pathString}
                stroke="transparent"
                strokeWidth={hitWidth}
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ cursor: isEditMode ? 'move' : 'pointer' }}
                onMouseDown={(e) => onLineMouseDown(e, branch.id)}
                onClick={(e) => onLineClick(e, branch.id)}
                onDoubleClick={(e) => onLineDoubleClick(e, branch.id)}
                onMouseEnter={() => onLineMouseEnter(branch.id)}
                onMouseLeave={() => onLineMouseLeave(branch.id)}
            />

            {/* ── Visible line ── */}
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
                /*// The CSS class for the flow animation is only applied to energized lines with active flow
                className={
                    branch.state === 1 && flowDir !== 0
                        ? (flowDir === 1 ? 'edge-flow' : 'edge-flow-rev')
                        : 'edge-line'
                }*/
            />

            {/* ── Flow-direction arrow (chevron) ── */}
            {/*showArrow && mid && (
                <g
                    transform={`translate(${mid.x}, ${mid.y}) rotate(${arrowAngle})`}
                    pointerEvents="none"
                    style={{ opacity: 0.8 }}
                >
                    {/*
                     * Chevron ">" centered on the local origin.
                     * Size proportional to the line thickness so as not to clutter the diagram.
                     
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

            {/* ── Control points / waypoints (edit mode only) ── */}
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
