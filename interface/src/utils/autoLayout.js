import * as d3 from 'd3-force';

// =============================================================================
// GENERIC GEOMETRY TOOLS (Performance Optimization)
// =============================================================================

export function getBoundingBox(pos, targetNodes, padding = 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    targetNodes.forEach(id => {
        const p = pos[id];
        if (p) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
    });
    return {
        minX: minX === Infinity ? 0 : minX - padding,
        maxX: maxX === -Infinity ? 0 : maxX + padding,
        minY: minY === Infinity ? 0 : minY - padding,
        maxY: maxY === -Infinity ? 0 : maxY + padding
    };
}

export function getCentroid(pos, targetNodes) {
    let cx = 0, cy = 0, count = 0;
    targetNodes.forEach(id => {
        const p = pos[id];
        if (p) { cx += p.x; cy += p.y; count++; }
    });
    return count > 0 ? { x: cx / count, y: cy / count } : { x: 0, y: 0 };
}

const D3_DEFAULTS = { distance: 10, charge: -40, openWeight: 0.65, collide: 40 };

export function getDistToSegment(p, a, b) {
    if (!p || !a || !b) return Infinity;
    const l2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(p.x - a.x, 2) + Math.pow(p.y - a.y, 2));
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t)); 
    const projX = a.x + t * (b.x - a.x);
    const projY = a.y + t * (b.y - a.y);
    return Math.sqrt(Math.pow(p.x - projX, 2) + Math.pow(p.y - projY, 2));
}

const segmentsIntersect = (p1, p2, p3, p4) => {
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false;
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
};

const dist = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

function applyProportionalScaling(nodesArray, branchesArray, actualPositions, targetGridSize) {
    if (!actualPositions || Object.keys(actualPositions).length === 0) return actualPositions;
    let edgeLengths = [];
    branchesArray.forEach(b => {
        const p1 = actualPositions[b.from], p2 = actualPositions[b.to];
        if (p1 && p2) edgeLengths.push(dist(p1, p2));
    });
    edgeLengths.sort((a, b) => a - b);
    let currentGrid = edgeLengths.length > 0 ? edgeLengths[Math.floor(edgeLengths.length / 2)] : targetGridSize;
    if (currentGrid < 10) currentGrid = targetGridSize;
    const rawScale = targetGridSize / currentGrid;
    const scale = Math.min(Math.max(rawScale, 0.2), 3.0);
    let cx = 0, cy = 0;
    nodesArray.forEach(id => { cx += actualPositions[id]?.x || 0; cy += actualPositions[id]?.y || 0; });
    cx /= nodesArray.length || 1; cy /= nodesArray.length || 1;
    const scaledPos = {};
    nodesArray.forEach(id => {
        scaledPos[id] = { x: cx + ((actualPositions[id]?.x || 0) - cx) * scale, y: cy + ((actualPositions[id]?.y || 0) - cy) * scale };
    });
    return scaledPos;
}

// =============================================================================
// FORCE ENGINE (ORGANIC) - WITH SELECTION FREEZING
// =============================================================================
export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // 👇 Absolute guarantee that the variables are defined 👇
    const distVal = config.distance !== undefined ? config.distance : 10;
    const targetCharge = config.charge !== undefined ? config.charge : -40; 
    const col = config.collide !== undefined ? config.collide : 40;
    const openWeight = config.openWeight !== undefined ? config.openWeight : 0.65; 
    const currentPos = config.currentPos || {};

    const selectedSet = config.selectedNodes?.length > 0 ? new Set(config.selectedNodes.map(String)) : null;

    const nodeDegree = {};
    (nodesArray || []).forEach(id => nodeDegree[String(id)] = 0);
    (branchesArray || []).forEach(b => {
        nodeDegree[String(b.from)] = (nodeDegree[String(b.from)] || 0) + 1;
        nodeDegree[String(b.to)] = (nodeDegree[String(b.to)] || 0) + 1;
    });

    const d3Nodes = (nodesArray || []).map(id => {
        const strId = String(id);
        const nodeObj = { id: strId, isSource: (sourcesArray || []).map(String).includes(strId), degree: nodeDegree[strId] || 0 };
        if (currentPos[strId]) { 
            nodeObj.x = currentPos[strId].x; 
            nodeObj.y = currentPos[strId].y; 
            // Freezes the unselected buses
            if (selectedSet && !selectedSet.has(strId)) {
                nodeObj.fx = nodeObj.x;
                nodeObj.fy = nodeObj.y;
            }
        }
        return nodeObj;
    });
    
    const d3Links = (branchesArray || []).map(b => ({ source: String(b.from), target: String(b.to), isOpen: b.state === 0 }));

    const chargeForce = d3.forceManyBody()
        .strength(d => targetCharge * (1 + (d.degree * 5)))
        .distanceMax(distVal * 6);

    const linkForce = d3.forceLink(d3Links).id(d => d.id).distance(d => {
        const degSource = nodeDegree[d.source.id || d.source] || 0;
        const degTarget = nodeDegree[d.target.id || d.target] || 0;
        return (d.isOpen ? distVal * 1.5 : distVal) + ((degSource + degTarget) * 10);
    }).strength(d => d.isOpen ? openWeight : ((nodeDegree[d.source.id] <= 2 || nodeDegree[d.target.id] <= 2) ? 1.5 : 1));

    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", linkForce).force("charge", chargeForce)
        .force("center", d3.forceCenter(0, 0))
        .force("collide", d3.forceCollide().radius(col)).stop();

    const maxChargeMulti = 5; 
    const totalTicks = 500; 
    const phaseTicks = totalTicks / 3;

    for (let i = 0; i < totalTicks; ++i) {
        let currentAlpha = 1; let phaseMultiplier;
        if (i < phaseTicks) { phaseMultiplier = 1 + (maxChargeMulti - 1) * (i / phaseTicks); } 
        else if (i < phaseTicks * 2) { phaseMultiplier = maxChargeMulti; } 
        else {
            const progress = (i - phaseTicks * 2) / phaseTicks;
            phaseMultiplier = maxChargeMulti - (maxChargeMulti - 1) * progress;
            currentAlpha = 1 - progress; 
        }
        chargeForce.strength(d => targetCharge * (1 + (d.degree * 5)) * phaseMultiplier);
        simulation.alpha(Math.max(0.01, currentAlpha)).tick(); 
    }

    const positions = {};
    d3Nodes.forEach(n => positions[String(n.id)] = { x: n.x, y: n.y });
    return positions;
}

// =========================================================
// PHASE 4: SMART GLOBAL SWAP
// =========================================================
function applySmartGlobalSwap(pos, nodesArray, branchesArray, sourcesArray, feederMap, getLocalCost, getSystemCost) {
    let improved = false;
    
    const levels = {};
    const adj = {};
    nodesArray.forEach(id => adj[id] = []);
    branchesArray.forEach(b => {
        if (b.state === 1) {
            if (adj[b.from]) adj[b.from].push(b.to);
            if (adj[b.to]) adj[b.to].push(b.from);
        }
    });
    
    const queue = [...sourcesArray].map(id => ({id, depth: 0}));
    const visited = new Set(sourcesArray);
    sourcesArray.forEach(id => levels[id] = 0);

    while(queue.length > 0) {
        const {id, depth} = queue.shift();
        if(adj[id]) {
            adj[id].forEach(nxt => {
                if(!visited.has(nxt)) {
                    visited.add(nxt);
                    levels[nxt] = depth + 1;
                    queue.push({id: nxt, depth: depth + 1});
                }
            });
        }
    }

    let evaluations = 0;
    let bestSystemCost = getSystemCost(pos);

    for (let i = 0; i < nodesArray.length; i++) {
        if (evaluations > 5000) break;
        
        for (let j = i + 1; j < nodesArray.length; j++) {
            if (evaluations > 5000) break;

            const idA = nodesArray[i];
            const idB = nodesArray[j];

            const sameLevel = levels[idA] !== undefined && levels[idA] === levels[idB];
            const sameFeeder = feederMap[idA] !== undefined && feederMap[idA] === feederMap[idB];

            if (sameLevel || sameFeeder) {
                evaluations++;
                
                const posA = pos[idA];
                const posB = pos[idB];

                const localCostBefore = getLocalCost(idA, posA.x, posA.y, pos) + getLocalCost(idB, posB.x, posB.y, pos);
                const localCostAfter = getLocalCost(idA, posB.x, posB.y, pos) + getLocalCost(idB, posA.x, posA.y, pos);

                if ((localCostAfter - localCostBefore) < 20000) {
                    pos[idA] = posB;
                    pos[idB] = posA;
                    
                    const newSystemCost = getSystemCost(pos);
                    
                    if (newSystemCost < bestSystemCost) {
                        bestSystemCost = newSystemCost;
                        improved = true;
                    } else {
                        pos[idA] = posA;
                        pos[idB] = posB;
                    }
                }
            }
        }
    }
    return improved;
}

// =============================================================================
// INTELLIGENCE ENGINE: CONSTRAINED VNS (THE CROSSING GATEKEEPER)
// =============================================================================

/**
 * Counts only run-overs (bus on top of a line) — separate from X crossings.
 * Used as a HARD constraint: any move that increases this number is vetoed.
 */
function countNodeOverlaps(positions, branches, nodeIds) {
    let count = 0;
    const ids = nodeIds || Object.keys(positions);
    for (const b of branches) {
        const A = positions[b.from];
        const B = positions[b.to];
        if (!A || !B) continue;
        for (const nId of ids) {
            if (String(nId) === String(b.from) || String(nId) === String(b.to)) continue;
            const P = positions[nId];
            if (!P) continue;
            if (getDistToSegment(P, A, B) < 5) count++;
        }
    }
    return count;
}

export async function applySmartCompaction(pos, nodesArrayRaw, branchesArrayRaw, sourcesArrayRaw, gridSize, maxIter, onProgress, config = {}) {
    const nodesArray = (nodesArrayRaw || []).map(String);
    const branchesArray = (branchesArrayRaw || []).map(b => ({ ...b, from: String(b.from), to: String(b.to) }));
    const sourcesArray = (sourcesArrayRaw || []).map(String);

    const selectedSet = config.selectedNodes?.length > 0 ? new Set(config.selectedNodes.map(String)) : null;
    const movableNodes = selectedSet ? nodesArray.filter(id => selectedSet.has(id)) : nodesArray;

    // 👇 LOG 1: SELECTION CHECK 👇
    console.log(`%c[TELEMETRY] Starting Compactor. Total Buses: ${nodesArray.length} | Buses in Selection (movableNodes): ${movableNodes.length}`, "color: #00bcd4; font-weight: bold;");

    const getGlobalCrossings = (currentPos) => findIntersections(currentPos, branchesArray).length;
    const initialCrossings = getGlobalCrossings(pos);
    console.log(`%c[AUDIT] Initial Crossings: ${initialCrossings}`, "color: #ffeb3b; font-weight: bold;");

    const myEdgesMap = {}; 
    const otherEdgesMap = {};
    nodesArray.forEach(id => {
        myEdgesMap[id] = branchesArray.filter(b => b.from === id || b.to === id);
        otherEdgesMap[id] = branchesArray.filter(b => b.from !== id && b.to !== id);
    });

    const getLocalCost = (id, testX, testY, currentPos) => {
        let cost = 0; const testPos = { x: testX, y: testY };
        const myEdges = myEdgesMap[id]; const otherEdges = otherEdgesMap[id];

        for (const b of myEdges) {
            const isFrom = b.from === id;
            const p1 = isFrom ? testPos : currentPos[b.from];
            const p2 = isFrom ? currentPos[b.to] : testPos;

            const distance = Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
            // All lines have the same weight now
            cost += distance;

            const dx = Math.abs(p1.x - p2.x); const dy = Math.abs(p1.y - p2.y);
            if (dx > 0.1 && dy > 0.1) cost += Math.abs(dx - dy) < 0.1 ? 2000 : 20000;

            for (const oId of nodesArray) {
                if (oId !== b.from && oId !== b.to && getDistToSegment(currentPos[oId], p1, p2) < 5) {
                    cost += sourcesArray.includes(oId) ? 500000 : 200000;
                }
            }
            for (const ob of otherEdges) {
                const p3 = currentPos[ob.from], p4 = currentPos[ob.to];
                if (p3 && p4 && segmentsIntersect(p1, p2, p3, p4)) {
                    cost += 100000; 
                }
            }
        }
        return cost;
    };

    const getSystemCost = (currentPos) => {
        let cost = 0;
        branchesArray.forEach(b => {
            const p1 = currentPos[b.from], p2 = currentPos[b.to];
            if (!p1 || !p2) return;
            const distance = Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
            cost += distance;
        });
        return cost;
    };

    let passes = 0;
    let improved = true;
    let currentTotalCrossings = initialCrossings;

    while (improved && passes < maxIter) {
        improved = false;
        passes++;
        await new Promise(r => setTimeout(r, 0));
        if (onProgress) onProgress(passes, "Compacting...", `Crossings: ${currentTotalCrossings}`);

        // Computes the BBox
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        movableNodes.forEach(id => {
            const p = pos[id];
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });

        // 👇 LOG 2: BOX (BBOX) CHECK 👇
        if (passes === 1) {
            console.log(`%c[BBOX TELEMETRY] Width: ${maxX - minX}px | Height: ${maxY - minY}px (From X:${minX} to X:${maxX} / From Y:${minY} to Y:${maxY})`, "color: #ff9800; font-weight: bold;");
        }

        const isOccupied = (tx, ty, currentPos) => nodesArray.some(n => currentPos[n].x === tx && currentPos[n].y === ty);

        for (const id of movableNodes) {
            const orig = { ...pos[id] };
            const currentMyCost = getLocalCost(id, orig.x, orig.y, pos);
            let bestLocalCost = currentMyCost;
            let bestPos = null;

            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const tx = orig.x + dx * gridSize, ty = orig.y + dy * gridSize;
                    if (tx < (minX - gridSize*2) || tx > (maxX + gridSize*2) || ty < (minY - gridSize*2) || ty > (maxY + gridSize*2)) continue;

                    if (!isOccupied(tx, ty, pos)) {
                        const testPos = { ...pos, [id]: { x: tx, y: ty } };
                        const testCrossings = getGlobalCrossings(testPos);
                        if (testCrossings > currentTotalCrossings) continue;

                        const testCost = getLocalCost(id, tx, ty, pos);
                        if (testCrossings < currentTotalCrossings || testCost < bestLocalCost - 5) {
                            bestLocalCost = testCost;
                            bestPos = { x: tx, y: ty };
                            currentTotalCrossings = testCrossings;
                        }
                    }
                }
            }
            if (bestPos) { pos[id] = bestPos; improved = true; }
        }

        let currentSystemCost = getSystemCost(pos);

        const trySlice = (slice, axis, step, isGreater = false) => {
            const candidatePos = {};
            nodesArray.forEach(id => {
                candidatePos[id] = { ...pos[id] };
                if (!selectedSet || selectedSet.has(id)) {
                    if (isGreater ? candidatePos[id][axis] <= slice : candidatePos[id][axis] >= slice) {
                        candidatePos[id][axis] += step;
                    }
                }
            });

            const spots = new Set();
            for (const id of nodesArray) {
                const key = `${Math.round(candidatePos[id].x)},${Math.round(candidatePos[id].y)}`;
                if (spots.has(key)) return; 
                spots.add(key);
            }

            const testCrossings = getGlobalCrossings(candidatePos);
            if (testCrossings > currentTotalCrossings) return;

            const cost = getSystemCost(candidatePos);
            if (testCrossings < currentTotalCrossings || cost < currentSystemCost - 1) {
                currentSystemCost = cost;
                currentTotalCrossings = testCrossings;
                Object.assign(pos, candidatePos);
                improved = true;
            }
        };

        // BBox sweep (acts only inside the selected box!)
        for(let s=maxX; s>minX; s-=gridSize) trySlice(s, 'x', -gridSize);
        for(let s=minX; s<maxX; s+=gridSize) trySlice(s, 'x', gridSize, true);
        for(let s=maxY; s>minY; s-=gridSize) trySlice(s, 'y', -gridSize);
        for(let s=minY; s<maxY; s+=gridSize) trySlice(s, 'y', gridSize, true);
    }
    
    console.log(`%c[AUDIT] Finished. Final Crossings: ${currentTotalCrossings}`, "color: #4caf50; font-weight: bold;");
    return pos;
}

// =============================================================================
// ORTHOGONAL ENGINE (Geometric Expansion + Snap + Compactor)
// =============================================================================
export async function calculateOrthogonalLayout(nodesArrayRaw, branchesArrayRaw, sourcesArrayRaw, config = {}) {
    // Type hardening
    const nodesArray = (nodesArrayRaw || []).map(String);
    const branchesArray = (branchesArrayRaw || []).map(b => ({ ...b, from: String(b.from), to: String(b.to) }));
    const sourcesArray = (sourcesArrayRaw || []).map(String);
    
    const gridSize = config.gridSize || 100;
    const selectedSet = config.selectedNodes?.length > 0 ? new Set(config.selectedNodes.map(String)) : null;
    const movableNodes = selectedSet ? nodesArray.filter(id => selectedSet.has(id)) : nodesArray;

    // 1. Initializes positions (reads from the interface or zeroes)
    let pos = {};
    if (config.currentPos) {
        Object.keys(config.currentPos).forEach(k => pos[String(k)] = { ...config.currentPos[k] });
    } else {
        nodesArray.forEach(id => pos[id] = { x: 0, y: 0 });
    }

    if (movableNodes.length === 0) return pos;

    // ==========================================
    // PHASE 1: GEOMETRIC EXPANSION (Spreading apart)
    // ==========================================
    if (config.onProgress) config.onProgress(1, "Orthogonal", "Moving apart buses that are too close...");

    // Finds the center of mass of the buses that will move
    let cx = 0, cy = 0;
    movableNodes.forEach(id => { cx += pos[id].x; cy += pos[id].y; });
    cx /= movableNodes.length; 
    cy /= movableNodes.length;

    let minDist = 0;
    let limitador = 0;

    // Expands 10% relative to the centroid while there are buses closer than the gridSize
    while (minDist < gridSize && limitador < 100) {
        minDist = Infinity;
        for (let i = 0; i < movableNodes.length; i++) {
            for (let j = i + 1; j < movableNodes.length; j++) {
                const idA = movableNodes[i];
                const idB = movableNodes[j];
                const d = Math.sqrt((pos[idA].x - pos[idB].x)**2 + (pos[idA].y - pos[idB].y)**2);
                
                // Ignores distances smaller than 1 (cases where the buses were born on the same 0,0 pixel)
                if (d < minDist && d > 1) {
                    minDist = d;
                }
            }
        }

        // Forces a small initial separation if the computed distance was zero
        if (minDist === Infinity || minDist === 0) minDist = 10; 

        // If still squeezed, applies a 10% "Zoom Out"
        if (minDist < gridSize) {
            movableNodes.forEach(id => {
                pos[id].x = cx + (pos[id].x - cx) * 1.1;
                pos[id].y = cy + (pos[id].y - cy) * 1.1;
            });
        }
        limitador++;
    }

    // ==========================================
    // PHASE 2: GRID SNAPPING (Snap)
    // ==========================================
    if (config.onProgress) config.onProgress(2, "Orthogonal", "Snapping to the absolute Grid...");
    const occupied = new Set();

    // Snaps the fixed walls (unselected nodes) to the nearest grid point
    nodesArray.forEach(id => {
        if (selectedSet && !selectedSet.has(id)) {
            const snapX = Math.round(pos[id].x / gridSize) * gridSize;
            const snapY = Math.round(pos[id].y / gridSize) * gridSize;
            occupied.add(`${snapX},${snapY}`);
            pos[id] = { x: snapX, y: snapY };
        }
    });

    // Sorts the movable nodes: from the center to the edge (prevents the periphery from stealing central spots)
    const sortedIds = [...movableNodes].sort((a, b) => {
        return (Math.pow(pos[a].x - cx, 2) + Math.pow(pos[a].y - cy, 2)) -
               (Math.pow(pos[b].x - cx, 2) + Math.pow(pos[b].y - cy, 2));
    });

    // Finds an empty slot on the grid with a spiral search (radial rings)
    sortedIds.forEach(id => {
        let baseX = Math.round(pos[id].x / gridSize) * gridSize;
        let baseY = Math.round(pos[id].y / gridSize) * gridSize;
        let ring = 0; let found = false;

        while (!found) {
            for (let dx = -ring; dx <= ring && !found; dx++) {
                for (let dy = -ring; dy <= ring && !found; dy++) {
                    if (Math.abs(dx) === ring || Math.abs(dy) === ring) {
                        let checkX = baseX + (dx * gridSize);
                        let checkY = baseY + (dy * gridSize);
                        let key = `${checkX},${checkY}`;
                        
                        if (!occupied.has(key)) {
                            occupied.add(key); 
                            pos[id] = { x: checkX, y: checkY }; 
                            found = true;
                        }
                    }
                }
            }
            ring++;
            if(ring > 200) break; // Emergency stop for titanic maps
        }
    });

    // ==========================================
    // PHASE 3: INTELLIGENT COMPACTION
    // ==========================================
    if (config.onProgress) config.onProgress(3, "Orthogonal", "Starting compaction...");
    return await applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, 8, config.onProgress, config);
}
// =============================================================================
// VND — Variable Neighborhood Descent for distribution networks
// Operates on the COMPLETE graph using the topological structure as neighborhoods.
// Never returns a result worse than the original layout.
// =============================================================================

/**
 * Extracts the neighborhood structure of the graph without removing any node.
 * Reuses the contractTopology logic but only for analysis.
 */
function analyzeTopology(nodesArray, branchesArray, sourcesArray) {
    const adj = {};
    nodesArray.forEach(id => { adj[id] = new Set(); });
    branchesArray.forEach(b => {
        if (b.state !== 1) return;
        const u = String(b.from), v = String(b.to);
        if (adj[u] && adj[v]) { adj[u].add(v); adj[v].add(u); }
    });

    const sourceSet = new Set(sourcesArray.map(String));

    // Anchors: sources, feeders, and nodes with degree ≠ 2
    const anchors = new Set();
    nodesArray.forEach(id => {
        if (sourceSet.has(id) || adj[id].size !== 2) anchors.add(id);
    });

    // Chains: sequences of degree-2 nodes between two anchors
    const chains = [];
    const inChain = new Set();
    const visited = new Set();

    nodesArray.forEach(startId => {
        if (visited.has(startId) || anchors.has(startId) || adj[startId].size !== 2) return;

        // Traces the chain in both directions from startId
        const buildChain = (start) => {
            const chain = [];
            let prev = null, curr = start;
            while (curr && !anchors.has(curr) && !visited.has(curr)) {
                visited.add(curr);
                chain.push(curr);
                const neighbors = [...adj[curr]].filter(n => n !== prev);
                prev = curr;
                curr = neighbors.length === 1 ? neighbors[0] : null;
            }
            return { chain, endAnchor: curr };
        };

        // Finds the two anchors of the chain by walking in both directions
        const neighbors = [...adj[startId]];
        if (neighbors.length !== 2) return;

        // Walks toward side 0
        const side0 = [];
        let prev0 = startId, curr0 = neighbors[0];
        while (curr0 && !anchors.has(curr0) && !visited.has(curr0)) {
            side0.push(curr0);
            const nbs = [...adj[curr0]].filter(n => n !== prev0);
            prev0 = curr0;
            curr0 = nbs.length === 1 ? nbs[0] : null;
        }
        const anchor0 = curr0;

        // Walks toward side 1
        const side1 = [];
        let prev1 = startId, curr1 = neighbors[1];
        while (curr1 && !anchors.has(curr1) && !visited.has(curr1)) {
            side1.push(curr1);
            const nbs = [...adj[curr1]].filter(n => n !== prev1);
            prev1 = curr1;
            curr1 = nbs.length === 1 ? nbs[0] : null;
        }
        const anchor1 = curr1;

        if (!anchor0 || !anchor1) return;

        // Builds the complete chain: anchor0 → side0(reversed) → startId → side1 → anchor1
        const fullChain = [...side0.reverse(), startId, ...side1];
        fullChain.forEach(n => { visited.add(n); inChain.add(n); });

        chains.push({ chain: fullChain, anchors: [anchor0, anchor1] });
    });

    // Leaves: degree-1 nodes that are not sources
    const leaves = [];
    nodesArray.forEach(id => {
        if (adj[id].size === 1 && !sourceSet.has(id)) {
            const anchor = [...adj[id]][0];
            leaves.push({ leaf: id, anchor });
        }
    });

    return { chains, leaves, anchors, adj };
}

/**
 * Collects the IDs of the nodes involved in the detected crossings.
 * Used to focus N4 only on relevant anchors.
 */
function getCrossingNodes(intersections) {
    const nodes = new Set();
    intersections.forEach(ix => {
        // ix.b1 and ix.b2 have the format "from-to" or "Bus X"
        [ix.b1, ix.b2].forEach(ref => {
            if (!ref) return;
            if (ref.startsWith('Bus ')) {
                nodes.add(ref.replace('Bus ', ''));
            } else {
                const parts = ref.split('-');
                if (parts.length >= 2) { nodes.add(parts[0]); nodes.add(parts[1]); }
            }
        });
    });
    return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// VND NEIGHBORHOODS
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS OF THE NEW MULTI-OBJECTIVE VND
// ─────────────────────────────────────────────────────────────────────────────

function expandCandidates(seedNodes, adj, nodesArray, hops) {
    const candidates = new Set(seedNodes);
    let frontier = new Set(seedNodes);
    for (let h = 0; h < hops; h++) {
        const next = new Set();
        frontier.forEach(id => {
            (adj[id] || new Set()).forEach(nb => {
                if (!candidates.has(nb)) { candidates.add(nb); next.add(nb); }
            });
        });
        frontier = next;
    }
    const nodeSet = new Set(nodesArray);
    return [...candidates].filter(id => nodeSet.has(id));
}

// Ensures the Euclidean spacing respects the gridSize!
function isPositionOccupied(tx, ty, pos, ignoreIds, minDist) {
    const minSq = (minDist * 0.9) ** 2; // 10% grid tolerance
    for (const [id, p] of Object.entries(pos)) {
        if (ignoreIds.has(id)) continue;
        const distSq = (p.x - tx) ** 2 + (p.y - ty) ** 2;
        if (distSq < minSq) return true;
    }
    return false;
}

// The Distance and Aesthetics Optimizer (the Centroid Weight is now STRONG!)
function getLayoutCost(pos, branchesArray, centroidWeight = 0.20) { // 👈 Increased to 20%
    let cost = 0;
    let cx = 0, cy = 0, count = 0;
    Object.values(pos).forEach(p => { cx += p.x; cy += p.y; count++; });
    if (count > 0) { cx /= count; cy /= count; }

    branchesArray.forEach(b => {
        const p1 = pos[b.from], p2 = pos[b.to];
        if (p1 && p2) {
            const dx = Math.abs(p1.x - p2.x);
            const dy = Math.abs(p1.y - p2.y);
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Gives a 15% discount bonus if the line is perfectly horizontal or vertical!
            const orthoBonus = (dx < 1 || dy < 1) ? 0.85 : 1.0; 
            cost += dist * orthoBonus;
        }
    });

    // Pulls the whole network strongly toward the center of gravity
    Object.values(pos).forEach(p => {
        cost += Math.sqrt((p.x - cx)**2 + (p.y - cy)**2) * centroidWeight;
    });

    return cost;
}

function evaluateMove(testPos, branchesArray, nodesArray, currentCrossings, currentCost, currentOverlaps) {
    const newOverlaps = countNodeOverlaps(testPos, branchesArray, nodesArray);
    if (newOverlaps > currentOverlaps) return { accept: false }; // Hard Constraint

    const c = findIntersections(testPos, branchesArray).length;
    if (c > currentCrossings) return { accept: false }; // Hard Constraint

    const cost = getLayoutCost(testPos, branchesArray);

    // Accepts if it reduced the errors, OR kept the errors at zero but improved the distance/aesthetics!
    if (c < currentCrossings || (c === currentCrossings && cost < currentCost - 1)) {
        return { accept: true, crossings: c, cost: cost, overlaps: newOverlaps };
    }
    return { accept: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATED VND NEIGHBORHOODS
// ─────────────────────────────────────────────────────────────────────────────

function applyN1(pos, nodesArray, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, radius, adj, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const candidates = expandCandidates(crossingNodes, adj, nodesArray, 1);
    // If there are no crossings, optimizes ALL nodes trying to bring them closer to the center and straighten them!
    const nodesToTest = candidates.length > 0 ? candidates : nodesArray; 

    for (const id of nodesToTest) {
        if (!pos[id]) continue;
        const orig = pos[id];

        // 👇 THE GRID TRICK: the test anchor is now the Absolute Grid, not the floating one! 👇
        const snapX = Math.round(orig.x / gridSize) * gridSize;
        const snapY = Math.round(orig.y / gridSize) * gridSize;

        // Tests all cells on the absolute grid around the node
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                
                const tx = snapX + dx * gridSize; 
                const ty = snapY + dy * gridSize;

                // If the test position is EXACTLY where the node already is, skips.
                // But if the node is off the grid, dx=0 and dy=0 will force it onto the grid!
                if (Math.abs(tx - orig.x) < 1 && Math.abs(ty - orig.y) < 1) continue;

                // Respects the grid spacing (Euclidean)
                if (isPositionOccupied(tx, ty, pos, new Set([id]), gridSize)) continue;

                const testPos = { ...pos, [id]: { x: tx, y: ty } };
                const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

                if (ev.accept) {
                    bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
                    pos[id] = { x: tx, y: ty };
                    improved = true;
                }
            }
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}

function applyN2(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, maxSteps, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const directions = [];
    for (let s = 1; s <= maxSteps; s++) directions.push([s, 0], [-s, 0], [0, s], [0, -s], [s, s], [-s, s], [s, -s], [-s, -s]);

    for (const { chain, anchors } of chains) {
        if (anchors.length !== 2) continue;
        const [a0, a1] = anchors;
        if (!pos[a0] || !pos[a1]) continue;

        const relevant = [...chain, a0, a1].some(id => crossingNodes.has(id));
        if (crossingNodes.size > 0 && !relevant) continue; // Skips if there are crossings elsewhere

        for (const [ddx, ddy] of directions) {
            const ox = ddx * gridSize, oy = ddy * gridSize;
            const newPositions = {}; let collision = false; const chainSet = new Set(chain);

            chain.forEach(id => {
                const np = { x: (pos[id]?.x || 0) + ox, y: (pos[id]?.y || 0) + oy };
                if (isPositionOccupied(np.x, np.y, pos, chainSet, gridSize)) collision = true;
                else newPositions[id] = np;
            });
            if (collision) continue;

            const testPos = { ...pos, ...newPositions };
            const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

            if (ev.accept) {
                bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
                Object.assign(pos, newPositions);
                improved = true; break;
            }
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}

function applyN3(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    for (const { chain, anchors } of chains) {
        if (anchors.length !== 2 || chain.length < 2) continue;
        const [a0, a1] = anchors;
        if (!pos[a0] || !pos[a1]) continue;

        const p0 = pos[a0], p1 = pos[a1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;

        const reflected = {};
        chain.forEach(id => {
            const p = pos[id]; if (!p) return;
            const t = ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / len2;
            const projX = p0.x + t * dx, projY = p0.y + t * dy;
            reflected[id] = { x: 2 * projX - p.x, y: 2 * projY - p.y };
        });

        const chainSet = new Set(chain);
        let collision = false;
        for (const np of Object.values(reflected)) {
            if (isPositionOccupied(np.x, np.y, pos, chainSet, gridSize)) { collision = true; break; }
        }
        if (collision) continue;

        const testPos = { ...pos, ...reflected };
        const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

        if (ev.accept) {
            bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
            Object.assign(pos, reflected);
            improved = true;
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}

function applyN4(pos, nodesArray, branchesArray, currentCrossings, currentCost, currentOverlaps, crossingNodes, adj) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const candidates = expandCandidates(crossingNodes, adj, nodesArray, 1);
    const nodesToTest = candidates.length > 1 ? candidates : nodesArray; 

    for (let i = 0; i < nodesToTest.length; i++) {
        for (let j = i + 1; j < nodesToTest.length; j++) {
            const idA = nodesToTest[i], idB = nodesToTest[j];
            if (!pos[idA] || !pos[idB]) continue;

            const testPos = { ...pos, [idA]: pos[idB], [idB]: pos[idA] };
            const ev = evaluateMove(testPos, branchesArray, nodesArray, bCross, bCost, bOver);

            if (ev.accept) {
                bCross = ev.crossings; bCost = ev.cost; bOver = ev.overlaps;
                const tmp = pos[idA]; pos[idA] = pos[idB]; pos[idB] = tmp;
                improved = true;
            }
        }
    }
    return { improved, crossings: bCross, cost: bCost, overlaps: bOver };
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN VND ENGINE
// ─────────────────────────────────────────────────────────────────────────────
export async function calculateVNSLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    nodesArray    = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({
        ...b, id: String(b.id), from: String(b.from), to: String(b.to)
    }));
    sourcesArray = sourcesArray.map(String);

    const gridSize   = config.gridSize || 100;
    const maxIter    = config.maxIter  || 50;
    const onProgress = config.onProgress || null;

    const originalPos = config.currentPos
        ? Object.fromEntries(Object.entries(config.currentPos).map(([k, v]) => [k, { ...v }]))
        : null;
        
    let pos = originalPos ? Object.fromEntries(Object.entries(originalPos).map(([k, v]) => [k, { ...v }])) : {};

    const { chains, leaves, anchors, adj } = analyzeTopology(nodesArray, branchesArray, sourcesArray);

    let currentCrossings = originalPos ? findIntersections(originalPos, branchesArray).length : Infinity;
    let currentCost = getLayoutCost(pos, branchesArray);
    let currentOverlaps = countNodeOverlaps(pos, branchesArray, nodesArray);

    if (onProgress) onProgress(1, 'VND', `Starting: ${currentCrossings} Crossings`);

    let k = 1;           
    let iter = 0;
    let n1Radius = 2;    

    while (k <= 4 && iter < maxIter) {
        iter++;
        await new Promise(resolve => setTimeout(resolve, 0)); 

        const intersections  = findIntersections(pos, branchesArray);
        const crossingNodes  = getCrossingNodes(intersections);

        if (onProgress) onProgress(iter, `VND N${k}`, `${currentCrossings} crossing(s) | Cost: ${Math.round(currentCost)}`);

        let result;
        if (k === 1) {
            result = applyN1(pos, nodesArray, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, n1Radius, adj, crossingNodes);
        } else if (k === 2) {
            result = applyN2(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, 3, crossingNodes);
        } else if (k === 3) {
            result = applyN3(pos, nodesArray, chains, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, crossingNodes);
        } else {
            result = applyN4(pos, nodesArray, branchesArray, currentCrossings, currentCost, currentOverlaps, crossingNodes, adj);
        }

        if (result.improved) {
            currentCrossings = result.crossings;
            currentCost = result.cost;
            currentOverlaps = result.overlaps;
            k = 1;          
            n1Radius = 2;   
        } else {
            if (k === 1 && n1Radius < 5) n1Radius++;
            else { k++; n1Radius = 2; }
        }
    }

    if (onProgress) onProgress('Done', 'VND', `Final cost reached.`);
    return pos;
}

export function classifyTopology(nodesArray, branchesArray) {
    // 1. Basic Count
    const nodesCount = nodesArray.length;
    const edgesCount = branchesArray.length;
    
    let openSwitches = 0;
    let closedEdges = 0;

    const adj = {};
    nodesArray.forEach(n => adj[String(n)] = []);
    
    // We filter to understand what is the skeleton (closed) and what are the tie-lines (open)
    branchesArray.forEach(b => {
        const isOpen = String(b.state) === '0' || String(b.initialState) === '0';
        if (isOpen) {
            openSwitches++;
        } else {
            closedEdges++;
            const u = String(b.from);
            const v = String(b.to);
            if (!adj[u]) adj[u] = [];
            if (!adj[v]) adj[v] = [];
            adj[u].push(v);
            adj[v].push(u);
        }
    });

    // 2. Island Analysis (Electrical Components / isolated Feeders)
    const visited = new Set();
    let components = 0;

    nodesArray.forEach(n => {
        const nodeId = String(n);
        if (!visited.has(nodeId)) {
            components++;
            const queue = [nodeId];
            visited.add(nodeId);
            while (queue.length > 0) {
                const curr = queue.shift();
                (adj[curr] || []).forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            }
        }
    });

    // 3. Euler's Formula for Graphs (computes whether closed electrical loops exist)
    const electricalLoops = closedEdges - nodesCount + components;

    // =========================================================
    // 4. THE DECISION TREE: how an Engineer chooses the Layout
    // =========================================================
    let recommendedEngine = 'force'; // Default: our powerful engine
    let typeName = "Desconhecida";

    if (electricalLoops > 0) {
        typeName = `Meshed (${electricalLoops} Closed Loops)`;
        // Meshed transmission systems. They need physics if they are large.
        recommendedEngine = nodesCount > 80 ? 'force' : 'vns';
        
    } else if (openSwitches > 0 || components > 1) {
        typeName = `Interconnected Radial (${components} Feeders, ${openSwitches} Open Switches)`;
        // The classic Distribution scenario (IEEE 33, 69, 123...). 
        // Force is MANDATORY here to push the feeders apart!
        recommendedEngine = 'force';
        
    } else {
        typeName = "Simple Radial (Pure Tree)";
        // No open switches and only 1 root.
        if (nodesCount < 30) {
            recommendedEngine = 'orthogonal'; // Small? It looks nice as a square one-line diagram.
        } else if (nodesCount < 80) {
            recommendedEngine = 'vns';        // Medium? The VNS adjusts on the grid without crushing.
        } else {
            recommendedEngine = 'force';      // Very large? Only physics solves it without overlap.
        }
    }

    return { 
        type: typeName,
        electricalLoops, 
        components, 
        nodesCount, 
        edgesCount, 
        openSwitches,
        recommendedEngine 
    };
}

export function applyBarycenterSweep(positions, nodesArray, branchesArray, sourcesArray, gridSize = 100) {
    const adj = {};
    nodesArray.forEach(n => adj[n] = []);
    branchesArray.forEach(b => {
        if (b.state === 1 || b.initialState === 1) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push(b.to);
            adj[b.to].push(b.from);
        }
    });

    const levels = {};
    const nodeLevel = {};
    const visited = new Set();
    const queue = [];

    sourcesArray.forEach(s => {
        if (nodesArray.includes(s)) {
            visited.add(s);
            queue.push({ id: s, lvl: 0 });
            nodeLevel[s] = 0;
            if (!levels[0]) levels[0] = [];
            levels[0].push(s);
        }
    });

    nodesArray.forEach(n => {
        if (!visited.has(n) && queue.length === 0) {
            visited.add(n);
            queue.push({ id: n, lvl: 0 });
            nodeLevel[n] = 0;
            if (!levels[0]) levels[0] = [];
            levels[0].push(n);
        }
    });

    while (queue.length > 0) {
        const { id, lvl } = queue.shift();
        const nextLvl = lvl + 1;
        (adj[id] || []).forEach(neighbor => {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                nodeLevel[neighbor] = nextLvl;
                if (!levels[nextLvl]) levels[nextLvl] = [];
                levels[nextLvl].push(neighbor);
                queue.push({ id: neighbor, lvl: nextLvl });
            }
        });
    }

    const newPositions = JSON.parse(JSON.stringify(positions));
    const maxLvl = Math.max(...Object.keys(levels).map(Number));

    if (levels[0]) {
        const startX0 = -((levels[0].length - 1) * gridSize * 3) / 2;
        levels[0].forEach((subId, idx) => {
            if (newPositions[subId]) {
                newPositions[subId].x = startX0 + idx * (gridSize * 3);
                newPositions[subId].y = 0; 
            }
        });
    }

    for (let l = 1; l <= maxLvl; l++) {
        const currentLevelNodes = levels[l];
        if (!currentLevelNodes) continue;

        const barycenters = currentLevelNodes.map(nodeId => {
            const parents = (adj[nodeId] || []).filter(neighbor => nodeLevel[neighbor] === l - 1);
            if (parents.length === 0) {
                return { id: nodeId, barycenter: newPositions[nodeId]?.x || 0 }; 
            }
            const sumX = parents.reduce((sum, p) => sum + (newPositions[p]?.x || 0), 0);
            return { id: nodeId, barycenter: sumX / parents.length };
        });

        barycenters.sort((a, b) => a.barycenter - b.barycenter);

        const avgBarycenter = barycenters.reduce((sum, item) => sum + item.barycenter, 0) / (barycenters.length || 1);
        const startX = avgBarycenter - ((barycenters.length - 1) * gridSize) / 2;

        barycenters.forEach((item, index) => {
            if (newPositions[item.id]) {
                newPositions[item.id].x = startX + index * gridSize;
                newPositions[item.id].y = l * (gridSize * 1.5); 
            }
        });
    }

    return newPositions;
}

// =========================================================
// HYBRID GRAPH COARSENING (PRUNING + CHAIN CONTRACTION)
// =========================================================

export function contractTopology(nodesArray, branchesArray, sourcesArray) {
    const adj = {};
    nodesArray.forEach(id => adj[String(id)] = new Set());
    
    branchesArray.forEach(b => {
        const u = String(b.from), v = String(b.to);
        if (adj[u] && adj[v]) {
            adj[u].add(v); adj[v].add(u);
        }
    });

    const sourceSet = new Set(sourcesArray.map(String));
    let activeNodes = new Set(nodesArray.map(String));

    // ==========================================
    // PHASE 1: PRUNING OF TERMINAL BRANCHES (Leaves)
    // ==========================================
    const prunedMap = {};
    const leaves = [];
    activeNodes.forEach(id => {
        if (adj[id].size === 1 && !sourceSet.has(id)) leaves.push(id);
    });

    while (leaves.length > 0) {
        const leaf = leaves.shift();
        if (adj[leaf].size !== 1) continue;

        const parent = Array.from(adj[leaf])[0];
        
        // 👇 THE TRICK GOES HERE 👇
        // If the parent is a Source/Substation, we do not swallow this node!
        // It survives on the map and acts as the "stump" (anchor) for the branch.
        if (sourceSet.has(parent)) {
            continue; 
        }
        // 👆 ======================= 👆

        activeNodes.delete(leaf);
        adj[leaf].delete(parent); 
        if (adj[parent]) adj[parent].delete(leaf);

        if (!prunedMap[parent]) prunedMap[parent] = { nodes: [] };
        prunedMap[parent].nodes.push(leaf);
        
        if (prunedMap[leaf]) {
            prunedMap[parent].nodes.push(...prunedMap[leaf].nodes);
            delete prunedMap[leaf];
        }

        if (adj[parent] && adj[parent].size === 1 && !sourceSet.has(parent)) leaves.push(parent);
    }

    // PHASE 2: CHAIN CONTRACTION (Direct Link)
    const chainMap = {};
    let macroCounter = 1;
    const visited = new Set();
    const macroEdges = [];

    Array.from(activeNodes).forEach(startNode => {
        if (visited.has(startNode) || sourceSet.has(startNode) || adj[startNode].size !== 2) return;

        const chain = [];
        const queue = [startNode];
        visited.add(startNode);

        while (queue.length > 0) {
            const curr = queue.shift();
            chain.push(curr);
            adj[curr].forEach(neighbor => {
                if (adj[neighbor].size === 2 && !sourceSet.has(neighbor) && !visited.has(neighbor)) {
                    visited.add(neighbor); queue.push(neighbor);
                }
            });
        }

        const chainSet = new Set(chain);
        const anchors = new Set();
        chain.forEach(node => {
            adj[node].forEach(neighbor => { if (!chainSet.has(neighbor)) anchors.add(neighbor); });
        });

        if (chain.length > 0 && anchors.size > 0) {
            const macroId = `__CHAIN_${macroCounter++}`;
            
            chain.forEach(n => activeNodes.delete(n)); 
            
            const ancArray = Array.from(anchors);
            if (ancArray.length === 2) {
                macroEdges.push({ 
                    id: `__EDGE_${macroId}_DIRECT`, 
                    from: ancArray[0], 
                    to: ancArray[1], 
                    state: 1, 
                    __isMacroEdge: true,
                    // 👇 THE TRICK: the edge knows how many pieces it represents!
                    __weight: chain.length + 1 
                });
            }
            
            chainMap[macroId] = { chain: chain, anchors: ancArray };
        }
    });

    // ==========================================
    // PHASE 3: THE GUILLOTINE
    // ==========================================
    const finalBranches = branchesArray.filter(b => 
        activeNodes.has(String(b.from)) && activeNodes.has(String(b.to))
    );
    finalBranches.push(...macroEdges);

    // 👇 TYPE RESTORER FOR REACT 👇
    // Converts the numeric IDs back to Number so React recognizes the Substations
    const restoreType = (val) => isNaN(val) ? val : Number(val);

    const safeNodes = Array.from(activeNodes).map(restoreType);
    const safeBranches = finalBranches.map(b => ({
        ...b,
        from: restoreType(b.from),
        to: restoreType(b.to)
    }));

    return {
        coarseNodesArray: safeNodes,
        coarseBranchesArray: safeBranches,
        coarseData: { prunedMap, chainMap }
    };
}


export function expandTopology(coarsePos, coarseData, originalPos) {
    const finalPos = { ...coarsePos };
    if (!coarseData) return finalPos; 
    
    const { prunedMap, chainMap } = coarseData;

    // 1. Simple Linear Expansion (The Rail)
    if (chainMap) {
        Object.keys(chainMap).forEach(macroId => {
            const { chain, anchors } = chainMap[macroId];
            if (anchors.length === 2) {
                const p1 = coarsePos[anchors[0]] || originalPos[anchors[0]];
                const p2 = coarsePos[anchors[1]] || originalPos[anchors[1]];
                if (p1 && p2) {
                    const segments = chain.length + 1;
                    chain.forEach((nodeId, idx) => {
                        const t = (idx + 1) / segments;
                        // Pure Math: aligns perfectly without errors!
                        finalPos[nodeId] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
                    });
                }
            } else if (anchors.length === 1) {
                const p1 = coarsePos[anchors[0]] || originalPos[anchors[0]];
                if (p1) chain.forEach(nodeId => finalPos[nodeId] = { ...p1 });
            }
        });
    }

    // 2. Leaf Expansion (Pruning)
    if (prunedMap) {
        Object.keys(prunedMap).forEach(anchor => {
            const anchorNewPos = finalPos[anchor] || coarsePos[anchor];
            const anchorOldPos = originalPos[anchor];
            if (anchorNewPos && anchorOldPos) {
                const deltaX = anchorNewPos.x - anchorOldPos.x;
                const deltaY = anchorNewPos.y - anchorOldPos.y;
                prunedMap[anchor].nodes.forEach(nodeId => {
                    const oldP = originalPos[nodeId];
                    if (oldP) finalPos[nodeId] = { x: oldP.x + deltaX, y: oldP.y + deltaY };
                });
            }
        });
    }

    return finalPos;
}

// =========================================================
// PHYSICAL RELAXATION WITH CONSTRAINED AXES (Your Idea!)
// =========================================================
export function relaxExpandedNodes(expandedPositions, skeletonNodeIds, allNodesArray, branchesArray, coarseData) {
    const skeletonSet = new Set(skeletonNodeIds.map(String));

    // 1. Prepares the Accordion intelligence (the Base Rail and the Normal)
    const chainNodesInfo = {};
    if (coarseData && coarseData.chainMap) {
        Object.values(coarseData.chainMap).forEach(macro => {
            const { chain, anchors } = macro;
            if (anchors.length === 2) {
                const p1 = expandedPositions[anchors[0]];
                const p2 = expandedPositions[anchors[1]];
                if (p1 && p2) {
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const nx = -dy / len; // Eixo Transversal X (Normal)
                    const ny = dx / len;  // Eixo Transversal Y (Normal)
                    const segments = chain.length + 1;

                    chain.forEach((nodeId, idx) => {
                        const t = (idx + 1) / segments;
                        // Stores the immutable rule for each bus of the accordion
                        chainNodesInfo[String(nodeId)] = { p1, p2, t, nx, ny };
                    });
                }
            }
        });
    }

    // 2. Prepares the nodes for the physics engine
    const d3Nodes = allNodesArray.map(id => {
        const strId = String(id);
        const pos = expandedPositions[id] || expandedPositions[strId] || { x: 0, y: 0 };
        const isFixed = skeletonSet.has(strId);

        return {
            id: strId,
            x: pos.x, y: pos.y,
            fx: isFixed ? pos.x : null,
            fy: isFixed ? pos.y : null,
            chainInfo: chainNodesInfo[strId] // Attaches the rules to the node!
        };
    });

    const d3Links = branchesArray
        .filter(b => b.state === 1 || b.initialState === 1)
        .map(b => ({ source: String(b.from), target: String(b.to) }));

    // 3. Configures the physics engine (strong repulsion!)
    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", d3.forceLink(d3Links).id(d => d.id).distance(30).strength(0.8))
        .force("charge", d3.forceManyBody().strength(-250)) // Pushes apart overlapping nodes
        .force("collide", d3.forceCollide().radius(25));

    // 👇 4. THE TRICK: CUSTOM TRANSVERSAL FORCE 👇
    // Every millisecond, this force intercepts the physics computation:
    simulation.force("transversal", () => {
        for (let i = 0; i < d3Nodes.length; i++) {
            const node = d3Nodes[i];
            if (node.chainInfo) {
                const { p1, p2, t, nx, ny } = node.chainInfo;

                // The immutable longitudinal position on the rail
                const baseX = p1.x + (p2.x - p1.x) * t;
                const baseY = p1.y + (p2.y - p1.y) * t;

                // How far the physics tried to push the node away
                const vx = node.x - baseX;
                const vy = node.y - baseY;

                // Captures ONLY the force that acted sideways (Dot Product on the Normal)
                const distTransversal = vx * nx + vy * ny;

                // Limits the "belly" to at most 100 pixels so it does not fly off the screen
                const clampedDist = Math.max(-100, Math.min(100, distTransversal));

                // Overwrites the final position: cancels zigzags!
                node.x = baseX + clampedDist * nx;
                node.y = baseY + clampedDist * ny;
                
                // Reduces inertia so the node does not shake on screen
                node.vx *= 0.1;
                node.vy *= 0.1;
            }
        }
    });

    simulation.stop();

    // 5. Runs the physics instantly
    for (let i = 0; i < 150; ++i) {
        simulation.tick();
    }

    // 6. Returns perfect positions
    const relaxedPositions = {};
    d3Nodes.forEach(n => {
        const originalId = isNaN(n.id) ? n.id : Number(n.id);
        relaxedPositions[originalId] = { x: n.x, y: n.y };
    });

    return relaxedPositions;
}

// =========================================================
// POLISHING TOOLS (CROSSINGS AND COMPACTION)
// =========================================================

// =========================================================
// 1. Detects crossings and run-overs (Edge-Node)
// =========================================================
/**
 * Path of a branch in segments: origin bus -> bend points (waypoints[id]) -> destination bus.
 * Each segment says at which bus it ends (`from`/`to`, or null in the middle of the path).
 */
export function branchSegments(branch, positions, waypoints = {}) {
    const A = positions[branch.from];
    const B = positions[branch.to];
    if (!A || !B) return null;
    const bends = (waypoints && Array.isArray(waypoints[branch.id]) ? waypoints[branch.id] : []).filter(w => w && Number.isFinite(w.x) && Number.isFinite(w.y));
    const pts = [A, ...bends, B];
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], from: i === 0 ? String(branch.from) : null, to: i === pts.length - 2 ? String(branch.to) : null });
    }
    return segs;
}

/**
 * Crossings and run-overs. `waypoints` (optional) = bend points per branch: the test uses the drawn path, not the straight segment
 * between the buses. Without `waypoints` the behavior is the old one (straight lines).
 */
export function findIntersections(positions, branches, waypoints = {}) {
    const intersections = [];
    const activeBranches = branches;
    const nodeIds = Object.keys(positions);
    const paths = activeBranches.map(br => branchSegments(br, positions, waypoints));

    for (let i = 0; i < activeBranches.length; i++) {
        const b1 = activeBranches[i];
        const segs1 = paths[i];
        if (!segs1) continue;

        // 1. Line passing over a bus (or collinear lines): a third party's bus within 5 px of any stretch of the path
        for (let k = 0; k < nodeIds.length; k++) {
            const nId = nodeIds[k];
            if (nId === String(b1.from) || nId === String(b1.to)) continue;      // the line's own endpoints
            const P = positions[nId];
            if (!P) continue;
            if (segs1.some(s => getDistToSegment(P, s.a, s.b) < 5)) {
                intersections.push({ x: P.x, y: P.y, b1: `${b1.from}-${b1.to}`, b2: `Bus ${nId}` });
            }
        }

        // 2. Crossing of two paths in an "X": stretches of different lines that cut each other in the middle
        for (let j = i + 1; j < activeBranches.length; j++) {
            const b2 = activeBranches[j];
            const segs2 = paths[j];
            if (!segs2) continue;
            const shared = [String(b1.from), String(b1.to)].filter(n => n === String(b2.from) || n === String(b2.to));

            for (const s1 of segs1) {
                for (const s2 of segs2) {
                    // stretches that meet at the bus the two lines share do not form an X
                    if (shared.some(n => (s1.from === n || s1.to === n) && (s2.from === n || s2.to === n))) continue;
                    const A = s1.a, B = s1.b, C = s2.a, D = s2.b;
                    const den = (A.x - B.x) * (C.y - D.y) - (A.y - B.y) * (C.x - D.x);
                    if (den === 0) continue;                                          // parallel (collinear ones fall under check 1)
                    const t = ((A.x - C.x) * (C.y - D.y) - (A.y - C.y) * (C.x - D.x)) / den;
                    const u = -((A.x - B.x) * (A.y - C.y) - (A.y - B.y) * (A.x - C.x)) / den;
                    if (t > 0 && t < 1 && u > 0 && u < 1) {
                        intersections.push({ x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y), b1: `${b1.from}-${b1.to}`, b2: `${b2.from}-${b2.to}` });
                    }
                }
            }
        }
    }

    // 👇 SAFETY FILTER: removes duplicate targets on the same pixel
    const uniqueIntersections = [];
    const seen = new Set();
    intersections.forEach(pt => {
        const key = `${Math.round(pt.x)},${Math.round(pt.y)}-${pt.b1}-${pt.b2}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueIntersections.push(pt);
        }
    });

    return uniqueIntersections;
}

// =============================================================================
// MANUAL EXPANDER/COMPACTOR (ALWAYS SNAPPED TO THE INTERFACE GRID)
// =============================================================================
export function compactPositions(positions, factor = 0.90) { 
    let cx = 0, cy = 0, count = 0;
    const FIXED_GRID = 10; // The visual grid of your GraphArea
    
    // Computes the Center of Mass (Centroid)
    Object.values(positions).forEach(p => {
        cx += p.x; cy += p.y; count++;
    });
    if (count > 0) {
        cx /= count; cy /= count;
    }

    const newPos = {};
    Object.keys(positions).forEach(id => {
        const p = positions[id];
        
        // 1. Applies the scale factor (generates the fractional number)
        const rawX = cx + (p.x - cx) * factor;
        const rawY = cy + (p.y - cy) * factor;

        // 2. Snaps the new coordinate to the nearest multiple of 10px!
        newPos[id] = {
            x: Math.round(rawX / FIXED_GRID) * FIXED_GRID,
            y: Math.round(rawY / FIXED_GRID) * FIXED_GRID
        };
    });
    
    return newPos;
}

function countNodeEdgeOverlaps(pos, branchesArray, nodesArray) {

    let overlaps = 0;

    for (const nodeId of nodesArray) {

        const p = pos[nodeId];
        if (!p) continue;

        for (const b of branchesArray) {

            // ignores legitimate endpoints
            if (
                b.from === nodeId ||
                b.to === nodeId
            ) continue;

            const a = pos[b.from];
            const c = pos[b.to];

            if (!a || !c) continue;

            // vertical line
            if (a.x === c.x) {

                if (
                    p.x === a.x &&
                    p.y > Math.min(a.y, c.y) &&
                    p.y < Math.max(a.y, c.y)
                ) {
                    overlaps++;
                }
            }

            // horizontal line
            else if (a.y === c.y) {

                if (
                    p.y === a.y &&
                    p.x > Math.min(a.x, c.x) &&
                    p.x < Math.max(a.x, c.x)
                ) {
                    overlaps++;
                }
            }
        }
    }

    return overlaps;
}
// =============================================================================
// PERIPHERAL SEARCH ENGINE (Peripheral Search Layout)
// Replaces the hierarchical engine.
//
// Objective function:
//   cost = w_angular * angular_penalty
//         + w_box     * box_penalty
//         + w_dist    * comprimento_total_arestas
//
// Angles without penalty: 0°, 45°, 90°, 135° (orthogonal and diagonal)
// Crossings: hard constraint — never increases; if it decreases, updates the limit
//
// Search:
//   1. Starts at the substations, moves toward the interior of the box
//   2. Propagates in a chain through the neighbors (lowest degree first)
//   3. Accepts neutral moves (same cost) and goes back to the previous neighborhood (VND)
// =============================================================================

// Objective function weights
const PSL_W_ANGULAR = 3.0;  // forbidden angle penalty (dominates)
const PSL_W_BOX     = 1.0;  // bounding box size
const PSL_W_DIST    = 0.5;  // total edge length (light)

/**
 * Angular penalty of an edge.
 * 0 for horizontal, vertical, 45° and 135°.
 * 1 for any other angle.
 */
function angularPenalty(p1, p2) {
    if (!p1 || !p2) return 0;
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    if (dx < 0.5 || dy < 0.5) return 0;           // horizontal ou vertical
    if (Math.abs(dx - dy) < 0.5) return 0;         // 45° ou 135°
    return 1;
}

/**
 * Bounding box do layout.
 */
function calcBBox(pos, targetNodes) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    targetNodes.forEach(id => {
        const p = pos[id];
        if (!p) return;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    return { minX, maxX, minY, maxY, w: maxX === -Infinity ? 0 : maxX - minX, h: maxY === -Infinity ? 0 : maxY - minY };
}

/**
 * Global cost function of the layout.
 */
function pslCost(pos, branchesArray, targetNodes) {
    let angular = 0, distTotal = 0;

    branchesArray.forEach(b => {
        const p1 = pos[String(b.from)], p2 = pos[String(b.to)];
        if (!p1 || !p2) return;
        angular += angularPenalty(p1, p2);
        distTotal += Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    });

    // Box penalty computed ONLY for the movable nodes
    const bb = calcBBox(pos, targetNodes);
    const boxTerm = (bb.w + bb.h) / Math.max(targetNodes.length, 1);

    return PSL_W_ANGULAR * angular
         + PSL_W_BOX     * boxTerm
         + PSL_W_DIST    * distTotal;
}

/**
 * Tests a move and returns whether it should be accepted.
 * Never increases crossings. Accepts an improvement or a tie in cost.
 */
function pslEvaluate(testPos, branchesArray, nodesArray, currentCrossings, currentCost) {
    const newCross = findIntersections(testPos, branchesArray).length;
    if (newCross > currentCrossings) return null; // hard constraint
    const newCost = pslCost(testPos, branchesArray, nodesArray);
    if (newCost <= currentCost + 0.001) { // accepts improvement or neutral
        return { crossings: newCross, cost: newCost };
    }
    return null;
}

/**
 * Checks whether a position is occupied by another node.
 */
function pslOccupied(tx, ty, pos, excludeId) {
    return Object.entries(pos).some(
        ([id, p]) => id !== String(excludeId) && Math.abs(p.x - tx) < 0.5 && Math.abs(p.y - ty) < 0.5
    );
}

/**
 * Generates move candidates for a node:
 * positions on the grid around the node, prioritizing moves
 * toward the interior of the bounding box.
 */
function pslCandidates(id, pos, bbox, gridSize, radius) {
    const p = pos[id];
    if (!p) return [];

    // Center of the bounding box
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;

    const candidates = [];
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            if (dx === 0 && dy === 0) continue;
            const tx = Math.round(p.x / gridSize) * gridSize + dx * gridSize;
            const ty = Math.round(p.y / gridSize) * gridSize + dy * gridSize;
            // Computes whether the move gets closer to the center (highest priority)
            const distBefore = (p.x - cx) ** 2 + (p.y - cy) ** 2;
            const distAfter  = (tx - cx) ** 2 + (ty - cy) ** 2;
            const priority   = distBefore - distAfter; // positive = gets closer
            candidates.push({ tx, ty, priority });
        }
    }
    // Sorts: moves that get closer to the center first
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates;
}

/**
 * Sorts the nodes for the peripheral search:
 * 1. Substations/sources (to move toward the interior)
 * 2. Leaves (degree 1) on the edge of the bounding box
 * 3. Remaining nodes by ascending degree
 */
function pslNodeOrder(targetNodes, branchesArray, sourcesArray, pos, bbox, gridSize) {
    const sourceSet = new Set(sourcesArray.map(String));
    const degree = {};
    targetNodes.forEach(id => { degree[id] = 0; });
    branchesArray.forEach(b => {
        if (b.state === 1) {
            if (degree[String(b.from)] !== undefined) degree[String(b.from)]++;
            if (degree[String(b.to)] !== undefined) degree[String(b.to)]++;
        }
    });

    const isPeripheral = (id) => {
        const p = pos[id];
        if (!p) return false;
        return (
            Math.abs(p.x - bbox.minX) < gridSize * 1.5 ||
            Math.abs(p.x - bbox.maxX) < gridSize * 1.5 ||
            Math.abs(p.y - bbox.minY) < gridSize * 1.5 ||
            Math.abs(p.y - bbox.maxY) < gridSize * 1.5
        );
    };

    const sources    = targetNodes.filter(id => sourceSet.has(id));
    const peripheral = targetNodes.filter(id => !sourceSet.has(id) && isPeripheral(id));
    const interior   = targetNodes.filter(id => !sourceSet.has(id) && !isPeripheral(id));

    peripheral.sort((a, b) => (degree[a] || 0) - (degree[b] || 0));
    interior.sort((a, b)   => (degree[a] || 0) - (degree[b] || 0));

    return [...sources, ...peripheral, ...interior];
}

/**
 * Main Peripheral Search engine.
 */
export async function calculateHierarchicalLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    nodesArray    = nodesArray.map(String);
    branchesArray = branchesArray.map(b => ({
        ...b, id: String(b.id), from: String(b.from), to: String(b.to)
    }));
    sourcesArray = sourcesArray.map(String);

    const gridSize   = config.gridSize || 100;
    const maxIter    = config.maxIter  || 60;
    const onProgress = config.onProgress || null;

    // 👇 SELECTION: the engine sees the whole map for collisions, but only optimizes the selected ones
    const selectedSet = config.selectedNodes?.length > 0 ? new Set(config.selectedNodes.map(String)) : null;
    const movableNodes = selectedSet ? nodesArray.filter(id => selectedSet.has(id)) : nodesArray;

    const originalPos = config.currentPos ? Object.fromEntries(Object.entries(config.currentPos).map(([k, v]) => [k, { ...v }])) : null;
    if (!originalPos) return {};
    let pos = { ...originalPos };

    if (movableNodes.length === 0) return pos;

    // 👇 SEARCH LIMITER (Clipping Box) with 2 grids of maneuvering margin
    const clippingBox = calcBBox(pos, movableNodes);
    clippingBox.minX -= gridSize * 2; clippingBox.maxX += gridSize * 2;
    clippingBox.minY -= gridSize * 2; clippingBox.maxY += gridSize * 2;

    const originalCrossings = findIntersections(pos, branchesArray).length;
    let currentCrossings    = originalCrossings;
    let currentCost         = pslCost(pos, branchesArray, movableNodes);

    if (onProgress) onProgress(0, 'PSL', `Initial cost: ${currentCost.toFixed(1)}`);

    let iter = 0;
    let globalImproved = true;
    const searchRadius = 2; 

    while (globalImproved && iter < maxIter) {
        globalImproved = false;
        iter++;
        await new Promise(resolve => setTimeout(resolve, 0));

        const currentBBox = calcBBox(pos, movableNodes);
        const nodeOrder = pslNodeOrder(movableNodes, branchesArray, sourcesArray, pos, currentBBox, gridSize);

        if (onProgress) onProgress(iter, 'PSL', `Iter ${iter} | Cost ${currentCost.toFixed(1)}`);

        const visited  = new Set();
        const queue    = [...nodeOrder];
        const adj = {};
        movableNodes.forEach(id => { adj[id] = []; });
        branchesArray.forEach(b => {
            if (b.state === 1) {
                if (adj[b.from]) adj[b.from].push(b.to);
                if (adj[b.to]) adj[b.to].push(b.from);
            }
        });

        let qi = 0;
        while (qi < queue.length) {
            const id = queue[qi++];
            if (visited.has(id)) continue;
            visited.add(id);

            const candidates = pslCandidates(id, pos, currentBBox, gridSize, searchRadius);

            for (const { tx, ty } of candidates) {
                // 👇 CUTS THE SEARCH AT INFINITY: if the test coordinate leaves the box, ignores it!
                if (tx < clippingBox.minX || tx > clippingBox.maxX || ty < clippingBox.minY || ty > clippingBox.maxY) {
                    continue;
                }
                
                // Treats the rest of the network that was not selected as solid walls
                if (pslOccupied(tx, ty, pos, id)) continue;

                const testPos = { ...pos, [id]: { x: tx, y: ty } };
                const eval_   = pslEvaluate(testPos, branchesArray, movableNodes, currentCrossings, currentCost);

                if (eval_ !== null) {
                    pos[id]          = { x: tx, y: ty };
                    const improved   = eval_.cost < currentCost - 0.001;
                    currentCost      = eval_.cost;
                    if (eval_.crossings < currentCrossings) currentCrossings = eval_.crossings;
                    if (improved) globalImproved = true;

                    (adj[id] || []).forEach(nbId => { if (!visited.has(nbId)) queue.push(nbId); });
                    break; 
                }
            }
        }
    }

    if (onProgress) config.onProgress("Done", "Peripheral Search Finished", "-");
    return pos;
}