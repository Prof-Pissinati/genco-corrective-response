import React, { useRef, useEffect } from 'react';

const CanvasOverlay = ({ 
    allNodes, branches, activePositions, activeWaypoints, 
    transform, getNodeColor, getEdgeColor, width, height, darkMode,
    sources = [], feedersList = [], systemShunts = {}, generatorBuses = null, getNodeShed = null, getEdgePoints = null,
    draggedNodeId, isEditMode, draggedWaypointKey
}) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);

        const dragIdNum = draggedNodeId ? Number(draggedNodeId) : null;
        const draggedBranchIdStr = draggedWaypointKey ? draggedWaypointKey.substring(0, draggedWaypointKey.lastIndexOf('-')) : null;

        // 1. DRAW LINES
        branches.forEach(b => {
            if (dragIdNum !== null && (Number(b.from) === dragIdNum || Number(b.to) === dragIdNum)) return;
            if (draggedBranchIdStr !== null && String(b.id) === draggedBranchIdStr) return;

            const p1 = activePositions[b.from];
            const p2 = activePositions[b.to];
            if (!p1 || !p2) return;

            ctx.beginPath();
            const pts = getEdgePoints ? getEdgePoints(b) : null;      // effective path (with bends and, on parallel lines, offset)
            if (pts && pts.length > 1) {
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            } else {
                ctx.moveTo(p1.x, p1.y);
                const wps = activeWaypoints[b.id] || [];
                wps.forEach(wp => ctx.lineTo(wp.x, wp.y));
                ctx.lineTo(p2.x, p2.y);
            }

            ctx.strokeStyle = getEdgeColor(b);
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (b.state === 0) ctx.setLineDash([5, 5]);
            else ctx.setLineDash([]);
            ctx.stroke();
        });

        // 2. DRAW WAYPOINTS (EDIT MODE)
        if (isEditMode) {
            branches.forEach(b => {
                if (draggedBranchIdStr !== null && String(b.id) === draggedBranchIdStr) return;
                const wps = activeWaypoints[b.id];
                if (!Array.isArray(wps)) return;

                wps.forEach(wp => {
                    ctx.fillStyle = '#ff9800';
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1.5 / transform.scale;
                    ctx.beginPath();
                    ctx.arc(wp.x, wp.y, 4 / transform.scale, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
            });
        }

        // 3. DRAW BUSES (STANDARDIZED, HARDENED GEOMETRY)
        allNodes.forEach(nodeId => {
            const numId = Number(nodeId);
            if (dragIdNum !== null && numId === dragIdNum) return;

            const pos = activePositions[nodeId];
            if (!pos) return;

            // TYPE HARDENING: converts everything to number before comparing
            const isSource = sources.some(s => Number(s) === numId);
            const isFeeder = feedersList.some(f => Number(f) === numId);
            const hasShunt = !!systemShunts[nodeId] || !!systemShunts[numId] || !!(generatorBuses && generatorBuses.has(Number(nodeId))); // generator (transmission): diamond
            
            const baseR = 10 / transform.scale;
            // ... (isSource, isFeeder, hasShunt code)

            const baseColor = getNodeColor(nodeId);
            const shed = getNodeShed ? getNodeShed(nodeId) : 0;      // load shed: stays energized; full shed = hollow, always with a dashed outline
            ctx.fillStyle = shed >= 0.99 ? (darkMode ? '#101014' : '#ffffff') : baseColor;
            ctx.beginPath();

            if (isSource) {
                // SUBSTATION: Circle (radius 42 -> exactly 25px at zoom 0.6)
                ctx.arc(pos.x, pos.y, 42, 0, Math.PI * 2);
            } else if (isFeeder) {
                // FEEDER: Hexagon (radius 42)
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i - (Math.PI / 6);
                    const px = pos.x + 42 * Math.cos(angle);
                    const py = pos.y + 42 * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
            } else if (hasShunt) {
                // SHUNT: Diamond (radius 34)
                ctx.moveTo(pos.x, pos.y - 34);
                ctx.lineTo(pos.x + 34, pos.y);
                ctx.lineTo(pos.x, pos.y + 34);
                ctx.lineTo(pos.x - 34, pos.y);
                ctx.closePath();
            } else {
                // REGULAR BUS: Rounded Rectangle 
                // (50x28 -> exactly 30x16px at zoom 0.6)
                const w = 50;
                const h = 28;
                const radius = 14;
                if (ctx.roundRect) {
                    ctx.roundRect(pos.x - w/2, pos.y - h/2, w, h, radius);
                } else {
                    ctx.rect(pos.x - w/2, pos.y - h/2, w, h);
                }
            }
            
            ctx.fill();
            
            // Bus outline
            ctx.strokeStyle = shed > 0 ? (shed >= 0.99 ? baseColor : (darkMode ? '#ffffff' : '#222222')) : (darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.15)');
            
            ctx.lineWidth = shed > 0 ? 5 : 3; 
            if (shed > 0) ctx.setLineDash([9, 6]);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        ctx.restore();
        
    }, [allNodes, branches, activePositions, activeWaypoints, transform, getNodeColor, getNodeShed, getEdgePoints, getEdgeColor, width, height, darkMode, sources, feedersList, systemShunts, draggedNodeId, isEditMode, draggedWaypointKey]);

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />;
};

export default CanvasOverlay;