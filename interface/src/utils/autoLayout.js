import * as d3 from 'd3-force';

// =============================================================================
// FERRAMENTAS GENÉRICAS DE GEOMETRIA (Otimização de Performance)
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
// MOTOR FORCE (ORGÂNICO) - COM CONGELAMENTO DE SELEÇÃO
// =============================================================================
export function calculateForceLayout(nodesArray, branchesArray, sourcesArray, config = {}) {
    // 👇 Garantia absoluta de definição das variáveis 👇
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
            // Congela as barras não selecionadas
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
// FASE 4: SWAP GLOBAL INTELIGENTE
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
// MOTOR DE INTELIGÊNCIA: VNS RESTRITO (O GATEKEEPER DE CRUZAMENTOS)
// =============================================================================

/**
 * Conta apenas atropelamentos (barra sobre linha) — separado dos cruzamentos X.
 * Usado como restrição DURA: qualquer movimento que aumente esse número é vetado.
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

    // 👇 LOG 1: VERIFICAÇÃO DE SELEÇÃO 👇
    console.log(`%c[TELEMETRIA] Iniciando Compactador. Total de Barras: ${nodesArray.length} | Barras na Seleção (movableNodes): ${movableNodes.length}`, "color: #00bcd4; font-weight: bold;");

    const getGlobalCrossings = (currentPos) => findIntersections(currentPos, branchesArray).length;
    const initialCrossings = getGlobalCrossings(pos);
    console.log(`%c[AUDITORIA] Cruzamentos Iniciais: ${initialCrossings}`, "color: #ffeb3b; font-weight: bold;");

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
            // Todas as linhas têm o mesmo peso agora
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
        if (onProgress) onProgress(passes, "Compactando...", `Cruzamentos: ${currentTotalCrossings}`);

        // Calcula a BBox
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        movableNodes.forEach(id => {
            const p = pos[id];
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });

        // 👇 LOG 2: VERIFICAÇÃO DA CAIXA (BBOX) 👇
        if (passes === 1) {
            console.log(`%c[TELEMETRIA BBOX] Largura: ${maxX - minX}px | Altura: ${maxY - minY}px (De X:${minX} até X:${maxX} / De Y:${minY} até Y:${maxY})`, "color: #ff9800; font-weight: bold;");
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

        // Varredura da BBox (Atua apenas dentro da caixa selecionada!)
        for(let s=maxX; s>minX; s-=gridSize) trySlice(s, 'x', -gridSize);
        for(let s=minX; s<maxX; s+=gridSize) trySlice(s, 'x', gridSize, true);
        for(let s=maxY; s>minY; s-=gridSize) trySlice(s, 'y', -gridSize);
        for(let s=minY; s<maxY; s+=gridSize) trySlice(s, 'y', gridSize, true);
    }
    
    console.log(`%c[AUDITORIA] Finalizado. Cruzamentos Finais: ${currentTotalCrossings}`, "color: #4caf50; font-weight: bold;");
    return pos;
}

// =============================================================================
// MOTOR ORTOGONAL (Expansão Geométrica + Snap + Compactador)
// =============================================================================
export async function calculateOrthogonalLayout(nodesArrayRaw, branchesArrayRaw, sourcesArrayRaw, config = {}) {
    // Blindagem de tipos
    const nodesArray = (nodesArrayRaw || []).map(String);
    const branchesArray = (branchesArrayRaw || []).map(b => ({ ...b, from: String(b.from), to: String(b.to) }));
    const sourcesArray = (sourcesArrayRaw || []).map(String);
    
    const gridSize = config.gridSize || 100;
    const selectedSet = config.selectedNodes?.length > 0 ? new Set(config.selectedNodes.map(String)) : null;
    const movableNodes = selectedSet ? nodesArray.filter(id => selectedSet.has(id)) : nodesArray;

    // 1. Inicializa posições (lê da interface ou zera)
    let pos = {};
    if (config.currentPos) {
        Object.keys(config.currentPos).forEach(k => pos[String(k)] = { ...config.currentPos[k] });
    } else {
        nodesArray.forEach(id => pos[id] = { x: 0, y: 0 });
    }

    if (movableNodes.length === 0) return pos;

    // ==========================================
    // FASE 1: EXPANSÃO GEOMÉTRICA (Afastamento)
    // ==========================================
    if (config.onProgress) config.onProgress(1, "Ortogonal", "Afastando barras muito próximas...");

    // Acha o centro da massa das barras que vão se mover
    let cx = 0, cy = 0;
    movableNodes.forEach(id => { cx += pos[id].x; cy += pos[id].y; });
    cx /= movableNodes.length; 
    cy /= movableNodes.length;

    let minDist = 0;
    let limitador = 0;

    // Expande 10% em relação ao centroide enquanto houver barras mais perto que o gridSize
    while (minDist < gridSize && limitador < 100) {
        minDist = Infinity;
        for (let i = 0; i < movableNodes.length; i++) {
            for (let j = i + 1; j < movableNodes.length; j++) {
                const idA = movableNodes[i];
                const idB = movableNodes[j];
                const d = Math.sqrt((pos[idA].x - pos[idB].x)**2 + (pos[idA].y - pos[idB].y)**2);
                
                // Ignora distâncias menores que 1 (casos em que as barras nasceram no mesmo pixel 0,0)
                if (d < minDist && d > 1) {
                    minDist = d;
                }
            }
        }

        // Força uma pequena separação inicial se a distância calculada foi nula
        if (minDist === Infinity || minDist === 0) minDist = 10; 

        // Se ainda está espremido, aplica o "Zoom Out" de 10%
        if (minDist < gridSize) {
            movableNodes.forEach(id => {
                pos[id].x = cx + (pos[id].x - cx) * 1.1;
                pos[id].y = cy + (pos[id].y - cy) * 1.1;
            });
        }
        limitador++;
    }

    // ==========================================
    // FASE 2: ENQUADRAMENTO NO GRID (Snap)
    // ==========================================
    if (config.onProgress) config.onProgress(2, "Ortogonal", "Enquadrando no Grid absoluto...");
    const occupied = new Set();

    // Trava as paredes fixas (nós não selecionados) no grid mais próximo
    nodesArray.forEach(id => {
        if (selectedSet && !selectedSet.has(id)) {
            const snapX = Math.round(pos[id].x / gridSize) * gridSize;
            const snapY = Math.round(pos[id].y / gridSize) * gridSize;
            occupied.add(`${snapX},${snapY}`);
            pos[id] = { x: snapX, y: snapY };
        }
    });

    // Ordena os nós móveis: do centro para a borda (evita que a periferia roube vagas centrais)
    const sortedIds = [...movableNodes].sort((a, b) => {
        return (Math.pow(pos[a].x - cx, 2) + Math.pow(pos[a].y - cy, 2)) -
               (Math.pow(pos[b].x - cx, 2) + Math.pow(pos[b].y - cy, 2));
    });

    // Acha um slot vazio no grid com busca em espiral (anéis radiais)
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
            if(ring > 200) break; // Trava de emergência para mapas titânicos
        }
    });

    // ==========================================
    // FASE 3: COMPACTAÇÃO INTELIGENTE
    // ==========================================
    if (config.onProgress) config.onProgress(3, "Ortogonal", "Iniciando compactação...");
    return await applySmartCompaction(pos, nodesArray, branchesArray, sourcesArray, gridSize, 8, config.onProgress, config);
}
// =============================================================================
// VND — Variable Neighborhood Descent para redes de distribuição
// Opera no grafo COMPLETO usando a estrutura topológica como vizinhanças.
// Nunca retorna resultado pior que o layout original.
// =============================================================================

/**
 * Extrai a estrutura de vizinhança do grafo sem remover nenhum nó.
 * Reutiliza a lógica do contractTopology mas apenas para análise.
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

    // Âncoras: fontes, feeders, e nós com grau ≠ 2
    const anchors = new Set();
    nodesArray.forEach(id => {
        if (sourceSet.has(id) || adj[id].size !== 2) anchors.add(id);
    });

    // Cadeias: sequências de nós com grau 2 entre duas âncoras
    const chains = [];
    const inChain = new Set();
    const visited = new Set();

    nodesArray.forEach(startId => {
        if (visited.has(startId) || anchors.has(startId) || adj[startId].size !== 2) return;

        // Rastreia a cadeia nos dois sentidos a partir do startId
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

        // Encontra as duas âncoras da cadeia percorrendo nos dois sentidos
        const neighbors = [...adj[startId]];
        if (neighbors.length !== 2) return;

        // Percorre para o lado 0
        const side0 = [];
        let prev0 = startId, curr0 = neighbors[0];
        while (curr0 && !anchors.has(curr0) && !visited.has(curr0)) {
            side0.push(curr0);
            const nbs = [...adj[curr0]].filter(n => n !== prev0);
            prev0 = curr0;
            curr0 = nbs.length === 1 ? nbs[0] : null;
        }
        const anchor0 = curr0;

        // Percorre para o lado 1
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

        // Monta a cadeia completa: anchor0 → side0(reversed) → startId → side1 → anchor1
        const fullChain = [...side0.reverse(), startId, ...side1];
        fullChain.forEach(n => { visited.add(n); inChain.add(n); });

        chains.push({ chain: fullChain, anchors: [anchor0, anchor1] });
    });

    // Folhas: nós com grau 1 que não são fontes
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
 * Coleta os IDs dos nós envolvidos nos cruzamentos detectados.
 * Usado para focar N4 apenas em âncoras relevantes.
 */
function getCrossingNodes(intersections) {
    const nodes = new Set();
    intersections.forEach(ix => {
        // ix.b1 e ix.b2 têm formato "from-to" ou "Barra X"
        [ix.b1, ix.b2].forEach(ref => {
            if (!ref) return;
            if (ref.startsWith('Barra ')) {
                nodes.add(ref.replace('Barra ', ''));
            } else {
                const parts = ref.split('-');
                if (parts.length >= 2) { nodes.add(parts[0]); nodes.add(parts[1]); }
            }
        });
    });
    return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIZINHANÇAS DO VND
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES DO NOVO VND MULTIOBJETIVO
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

// Garante que o Euclidean spacing respeite o gridSize!
function isPositionOccupied(tx, ty, pos, ignoreIds, minDist) {
    const minSq = (minDist * 0.9) ** 2; // Tolerância de 10% do grid
    for (const [id, p] of Object.entries(pos)) {
        if (ignoreIds.has(id)) continue;
        const distSq = (p.x - tx) ** 2 + (p.y - ty) ** 2;
        if (distSq < minSq) return true;
    }
    return false;
}

// O Otimizador de Distância e Estética (O Peso do Centroide agora está FORTE!)
function getLayoutCost(pos, branchesArray, centroidWeight = 0.20) { // 👈 Aumentado para 20%
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
            
            // Dá bônus de 15% de desconto se a linha for perfeitamente horizontal ou vertical!
            const orthoBonus = (dx < 1 || dy < 1) ? 0.85 : 1.0; 
            cost += dist * orthoBonus;
        }
    });

    // Puxa a rede toda para o centro de gravidade com força
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

    // Aceita se reduziu os erros, OU se manteve os erros zerados mas melhorou a distância/estética!
    if (c < currentCrossings || (c === currentCrossings && cost < currentCost - 1)) {
        return { accept: true, crossings: c, cost: cost, overlaps: newOverlaps };
    }
    return { accept: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// VIZINHANÇAS DO VND ATUALIZADAS
// ─────────────────────────────────────────────────────────────────────────────

function applyN1(pos, nodesArray, branchesArray, gridSize, currentCrossings, currentCost, currentOverlaps, radius, adj, crossingNodes) {
    let improved = false;
    let bCross = currentCrossings; let bCost = currentCost; let bOver = currentOverlaps;

    const candidates = expandCandidates(crossingNodes, adj, nodesArray, 1);
    // Se não há cruzamentos, otimiza TODOS os nós buscando aproximar do centro e endireitar!
    const nodesToTest = candidates.length > 0 ? candidates : nodesArray; 

    for (const id of nodesToTest) {
        if (!pos[id]) continue;
        const orig = pos[id];

        // 👇 A MÁGICA DO GRID: A âncora de teste agora é a Malha Absoluta, e não a flutuante! 👇
        const snapX = Math.round(orig.x / gridSize) * gridSize;
        const snapY = Math.round(orig.y / gridSize) * gridSize;

        // Testa todas as células no grid absoluto ao redor do nó
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                
                const tx = snapX + dx * gridSize; 
                const ty = snapY + dy * gridSize;

                // Se a posição de teste for EXATAMENTE a que o nó já está, pula.
                // Mas se o nó estiver fora do grid, dx=0 e dy=0 vai forçar ele a entrar no grid!
                if (Math.abs(tx - orig.x) < 1 && Math.abs(ty - orig.y) < 1) continue;

                // Respeita o distanciamento da grade (Euclidiano)
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
        if (crossingNodes.size > 0 && !relevant) continue; // Pula se houver cruzamentos em outro lugar

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
// MOTOR PRINCIPAL VND
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

    if (onProgress) onProgress(1, 'VND', `Iniciando: ${currentCrossings} Cruzamentos`);

    let k = 1;           
    let iter = 0;
    let n1Radius = 2;    

    while (k <= 4 && iter < maxIter) {
        iter++;
        await new Promise(resolve => setTimeout(resolve, 0)); 

        const intersections  = findIntersections(pos, branchesArray);
        const crossingNodes  = getCrossingNodes(intersections);

        if (onProgress) onProgress(iter, `VND N${k}`, `${currentCrossings} cruzamento(s) | Custo: ${Math.round(currentCost)}`);

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

    if (onProgress) onProgress('Concluído', 'VND', `Custo final alcançado.`);
    return pos;
}

export function classifyTopology(nodesArray, branchesArray) {
    // 1. Contagem Básica
    const nodesCount = nodesArray.length;
    const edgesCount = branchesArray.length;
    
    let openSwitches = 0;
    let closedEdges = 0;

    const adj = {};
    nodesArray.forEach(n => adj[String(n)] = []);
    
    // Filtramos para entender o que é o esqueleto (fechado) e o que são as tie-lines (abertas)
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

    // 2. Análise de Ilhas (Componentes Elétricos / Alimentadores isolados)
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

    // 3. Fórmula de Euler para Grafos (Calcula se existem anéis elétricos fechados)
    const electricalLoops = closedEdges - nodesCount + components;

    // =========================================================
    // 4. A ÁRVORE DE DECISÃO: Como um Engenheiro escolhe o Layout
    // =========================================================
    let recommendedEngine = 'force'; // Default: Nosso motor poderoso
    let typeName = "Desconhecida";

    if (electricalLoops > 0) {
        typeName = `Malhado (${electricalLoops} Anéis Fechados)`;
        // Sistemas de transmissão malhados. Precisam de física se forem grandes.
        recommendedEngine = nodesCount > 80 ? 'force' : 'vns';
        
    } else if (openSwitches > 0 || components > 1) {
        typeName = `Radial Interligado (${components} Alimentadores, ${openSwitches} Chaves Abertas)`;
        // O cenário clássico de Distribuição (IEEE 33, 69, 123...). 
        // O Force é OBRIGATÓRIO aqui para forçar os alimentadores a se afastarem!
        recommendedEngine = 'force';
        
    } else {
        typeName = "Radial Simples (Árvore Pura)";
        // Sem chaves abertas e apenas 1 raiz.
        if (nodesCount < 30) {
            recommendedEngine = 'orthogonal'; // Pequeno? Fica bonito como diagrama unifilar quadrado.
        } else if (nodesCount < 80) {
            recommendedEngine = 'vns';        // Médio? O VNS ajusta no grid sem esmagar.
        } else {
            recommendedEngine = 'force';      // Muito grande? Só a física resolve sem sobrepor.
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
// GRAPH COARSENING HÍBRIDO (PODA + CONTRAÇÃO DE CADEIAS)
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
    // FASE 1: PODA DE RAMOS TERMINAIS (Folhas)
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
        
        // 👇 A MÁGICA ENTRA AQUI 👇
        // Se o pai for uma Fonte/Subestação, nós não engolimos esse nó!
        // Ele sobrevive no mapa e atua como o "toco" (âncora) para o ramal.
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

    // FASE 2: CONTRAÇÃO DE CADEIAS (Ligação Direta)
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
                    // 👇 A MÁGICA: A aresta sabe quantos pedaços ela representa!
                    __weight: chain.length + 1 
                });
            }
            
            chainMap[macroId] = { chain: chain, anchors: ancArray };
        }
    });

    // ==========================================
    // FASE 3: A GUILHOTINA
    // ==========================================
    const finalBranches = branchesArray.filter(b => 
        activeNodes.has(String(b.from)) && activeNodes.has(String(b.to))
    );
    finalBranches.push(...macroEdges);

    // 👇 RESTAURADOR DE TIPAGEM PARA O REACT 👇
    // Converte os IDs numéricos de volta para Number para o React reconhecer as Subestações
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

    // 1. Expansão Linear Simples (O Trilho)
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
                        // Matemática Pura: Alinha perfeitamente sem erros!
                        finalPos[nodeId] = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
                    });
                }
            } else if (anchors.length === 1) {
                const p1 = coarsePos[anchors[0]] || originalPos[anchors[0]];
                if (p1) chain.forEach(nodeId => finalPos[nodeId] = { ...p1 });
            }
        });
    }

    // 2. Expansão das Folhas (Poda)
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
// RELAXAMENTO FÍSICO COM EIXOS RESTRITOS (A Sua Ideia!)
// =========================================================
export function relaxExpandedNodes(expandedPositions, skeletonNodeIds, allNodesArray, branchesArray, coarseData) {
    const skeletonSet = new Set(skeletonNodeIds.map(String));

    // 1. Prepara a inteligência das Sanfonas (O Trilho Base e a Normal)
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
                        // Guarda a regra imutável para cada barra da sanfona
                        chainNodesInfo[String(nodeId)] = { p1, p2, t, nx, ny };
                    });
                }
            }
        });
    }

    // 2. Prepara os nós para o motor físico
    const d3Nodes = allNodesArray.map(id => {
        const strId = String(id);
        const pos = expandedPositions[id] || expandedPositions[strId] || { x: 0, y: 0 };
        const isFixed = skeletonSet.has(strId);

        return {
            id: strId,
            x: pos.x, y: pos.y,
            fx: isFixed ? pos.x : null,
            fy: isFixed ? pos.y : null,
            chainInfo: chainNodesInfo[strId] // Anexa as regras ao nó!
        };
    });

    const d3Links = branchesArray
        .filter(b => b.state === 1 || b.initialState === 1)
        .map(b => ({ source: String(b.from), target: String(b.to) }));

    // 3. Configura o motor físico (Repulsão forte!)
    const simulation = d3.forceSimulation(d3Nodes)
        .force("link", d3.forceLink(d3Links).id(d => d.id).distance(30).strength(0.8))
        .force("charge", d3.forceManyBody().strength(-250)) // Afasta nós sobrepostos
        .force("collide", d3.forceCollide().radius(25));

    // 👇 4. A MÁGICA: FORÇA CUSTOMIZADA TRANSVERSAL 👇
    // A cada milissegundo, essa força intercepta o cálculo da física:
    simulation.force("transversal", () => {
        for (let i = 0; i < d3Nodes.length; i++) {
            const node = d3Nodes[i];
            if (node.chainInfo) {
                const { p1, p2, t, nx, ny } = node.chainInfo;

                // A posição longitudinal imutável no trilho
                const baseX = p1.x + (p2.x - p1.x) * t;
                const baseY = p1.y + (p2.y - p1.y) * t;

                // O quanto a física tentou empurrar o nó para longe
                const vx = node.x - baseX;
                const vy = node.y - baseY;

                // Captura APENAS a força que atuou para os lados (Produto Escalar na Normal)
                const distTransversal = vx * nx + vy * ny;

                // Limita a "barriga" a no máximo 100 pixels para não voar para fora da tela
                const clampedDist = Math.max(-100, Math.min(100, distTransversal));

                // Sobrescreve a posição final: Anula zigue-zagues!
                node.x = baseX + clampedDist * nx;
                node.y = baseY + clampedDist * ny;
                
                // Reduz inércia para o nó não tremer na tela
                node.vx *= 0.1;
                node.vy *= 0.1;
            }
        }
    });

    simulation.stop();

    // 5. Roda a física instantaneamente
    for (let i = 0; i < 150; ++i) {
        simulation.tick();
    }

    // 6. Devolve posições perfeitas
    const relaxedPositions = {};
    d3Nodes.forEach(n => {
        const originalId = isNaN(n.id) ? n.id : Number(n.id);
        relaxedPositions[originalId] = { x: n.x, y: n.y };
    });

    return relaxedPositions;
}

// =========================================================
// FERRAMENTAS DE POLIMENTO (CRUZAMENTOS E COMPACTAÇÃO)
// =========================================================

// =========================================================
// 1. Detecta cruzamentos e atropelamentos (Aresta-Nó)
// =========================================================
export function findIntersections(positions, branches) {
    const intersections = [];
    const activeBranches = branches;
    const nodeIds = Object.keys(positions);

    for (let i = 0; i < activeBranches.length; i++) {
        const b1 = activeBranches[i];
        const A = positions[b1.from]; 
        const B = positions[b1.to];

        if (!A || !B) continue;

        // 👇 1. NOVO RASTREIO: Detecta Linha passando por cima de Barra (ou linhas colineares) 👇
        for (let k = 0; k < nodeIds.length; k++) {
            const nId = nodeIds[k];
            
            // Ignora as pontas da própria linha (onde ela nasce e morre)
            if (nId === String(b1.from) || nId === String(b1.to)) continue;

            const P = positions[nId];
            if (!P) continue;

            // Se uma barra de terceiros estiver a menos de 5 pixels da linha, é um atropelamento!
            if (getDistToSegment(P, A, B) < 5) {
                intersections.push({
                    x: P.x,
                    y: P.y,
                    b1: `${b1.from}-${b1.to}`,
                    b2: `Barra ${nId}` // O Tooltip vai avisar quem atropelou quem!
                });
            }
        }

        // 👇 2. RASTREIO CLÁSSICO: Cruzamento de duas linhas em "X" 👇
        for (let j = i + 1; j < activeBranches.length; j++) {
            const b2 = activeBranches[j];

            // Se compartilham o mesmo nó, não formam um X. 
            // Se fossem sobrepostas (colineares), o rastreio 1 já teria pegado!
            if (b1.from === b2.from || b1.from === b2.to || b1.to === b2.from || b1.to === b2.to) continue;

            const C = positions[b2.from]; const D = positions[b2.to];
            if (!C || !D) continue;

            // Fórmula de Interseção de Linhas de Bézier/Planares
            const den = (A.x - B.x) * (C.y - D.y) - (A.y - B.y) * (C.x - D.x);
            if (den === 0) continue; // Linhas paralelas

            const t = ((A.x - C.x) * (C.y - D.y) - (A.y - C.y) * (C.x - D.x)) / den;
            const u = -((A.x - B.x) * (A.y - C.y) - (A.y - B.y) * (A.x - C.x)) / den;

            // Se t e u estão entre 0 e 1 (exclusivo), houve cruzamento real no meio do trecho!
            if (t > 0 && t < 1 && u > 0 && u < 1) {
                intersections.push({
                    x: A.x + t * (B.x - A.x),
                    y: A.y + t * (B.y - A.y),
                    b1: `${b1.from}-${b1.to}`,
                    b2: `${b2.from}-${b2.to}`
                });
            }
        }
    }
    
    // 👇 FILTRO DE SEGURANÇA: Remove alvos duplicados no mesmo pixel
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
// EXPANSOR/COMPACTADOR MANUAL (SEMPRE ENQUADRADO NO GRID DA INTERFACE)
// =============================================================================
export function compactPositions(positions, factor = 0.90) { 
    let cx = 0, cy = 0, count = 0;
    const FIXED_GRID = 10; // O grid visual da sua GraphArea
    
    // Calcula o Centro de Massa (Centroide)
    Object.values(positions).forEach(p => {
        cx += p.x; cy += p.y; count++;
    });
    if (count > 0) {
        cx /= count; cy /= count;
    }

    const newPos = {};
    Object.keys(positions).forEach(id => {
        const p = positions[id];
        
        // 1. Aplica o fator de escala (Gera o número quebrado)
        const rawX = cx + (p.x - cx) * factor;
        const rawY = cy + (p.y - cy) * factor;

        // 2. Trava a nova coordenada no múltiplo de 10px mais próximo!
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

            // ignora endpoints legítimos
            if (
                b.from === nodeId ||
                b.to === nodeId
            ) continue;

            const a = pos[b.from];
            const c = pos[b.to];

            if (!a || !c) continue;

            // linha vertical
            if (a.x === c.x) {

                if (
                    p.x === a.x &&
                    p.y > Math.min(a.y, c.y) &&
                    p.y < Math.max(a.y, c.y)
                ) {
                    overlaps++;
                }
            }

            // linha horizontal
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
// MOTOR DE BUSCA PERIFÉRICA (Peripheral Search Layout)
// Substitui o motor hierárquico.
//
// Função objetivo:
//   custo = w_angular * penalidade_angular
//         + w_caixa   * penalidade_caixa
//         + w_dist    * comprimento_total_arestas
//
// Ângulos sem penalidade: 0°, 45°, 90°, 135° (ortogonais e diagonais)
// Cruzamentos: hard constraint — nunca aumenta; se reduz, atualiza o limite
//
// Busca:
//   1. Começa pelas subestações, move em direção ao interior da caixa
//   2. Propaga em cadeia pelos vizinhos (menor grau primeiro)
//   3. Aceita movimentos neutros (mesmo custo) e volta à vizinhança anterior (VND)
// =============================================================================

// Pesos da função objetivo
const PSL_W_ANGULAR = 3.0;  // penalidade de ângulo proibido (domina)
const PSL_W_CAIXA   = 1.0;  // tamanho da bounding box
const PSL_W_DIST    = 0.5;  // comprimento total das arestas (leve)

/**
 * Penalidade angular de uma aresta.
 * 0 para horizontal, vertical, 45° e 135°.
 * 1 para qualquer outro ângulo.
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
 * Função de custo global do layout.
 */
function pslCost(pos, branchesArray, targetNodes) {
    let angular = 0, distTotal = 0;

    branchesArray.forEach(b => {
        const p1 = pos[String(b.from)], p2 = pos[String(b.to)];
        if (!p1 || !p2) return;
        angular += angularPenalty(p1, p2);
        distTotal += Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    });

    // Penalidade de caixa calculada APENAS para os nós móveis
    const bb = calcBBox(pos, targetNodes);
    const caixa = (bb.w + bb.h) / Math.max(targetNodes.length, 1);

    return PSL_W_ANGULAR * angular
         + PSL_W_CAIXA   * caixa
         + PSL_W_DIST    * distTotal;
}

/**
 * Testa um movimento e retorna se deve ser aceito.
 * Nunca aumenta cruzamentos. Aceita melhora ou empate no custo.
 */
function pslEvaluate(testPos, branchesArray, nodesArray, currentCrossings, currentCost) {
    const newCross = findIntersections(testPos, branchesArray).length;
    if (newCross > currentCrossings) return null; // hard constraint
    const newCost = pslCost(testPos, branchesArray, nodesArray);
    if (newCost <= currentCost + 0.001) { // aceita melhora ou neutro
        return { crossings: newCross, cost: newCost };
    }
    return null;
}

/**
 * Verifica se uma posição está ocupada por outro nó.
 */
function pslOccupied(tx, ty, pos, excludeId) {
    return Object.entries(pos).some(
        ([id, p]) => id !== String(excludeId) && Math.abs(p.x - tx) < 0.5 && Math.abs(p.y - ty) < 0.5
    );
}

/**
 * Gera candidatos de movimento para um nó:
 * posições na grade ao redor do nó, priorizando movimentos
 * em direção ao interior da bounding box.
 */
function pslCandidates(id, pos, bbox, gridSize, radius) {
    const p = pos[id];
    if (!p) return [];

    // Centro da bounding box
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;

    const candidates = [];
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            if (dx === 0 && dy === 0) continue;
            const tx = Math.round(p.x / gridSize) * gridSize + dx * gridSize;
            const ty = Math.round(p.y / gridSize) * gridSize + dy * gridSize;
            // Calcula se o movimento aproxima do centro (prioridade mais alta)
            const distBefore = (p.x - cx) ** 2 + (p.y - cy) ** 2;
            const distAfter  = (tx - cx) ** 2 + (ty - cy) ** 2;
            const priority   = distBefore - distAfter; // positivo = aproxima
            candidates.push({ tx, ty, priority });
        }
    }
    // Ordena: movimentos que aproximam do centro primeiro
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates;
}

/**
 * Ordena os nós para a busca periférica:
 * 1. Subestações/fontes (para mover em direção ao interior)
 * 2. Folhas (grau 1) na borda da bounding box
 * 3. Demais nós por grau crescente
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
 * Motor principal de Busca Periférica.
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

    // 👇 SELEÇÃO: O motor enxerga o mapa inteiro para colisões, mas só otimiza os selecionados
    const selectedSet = config.selectedNodes?.length > 0 ? new Set(config.selectedNodes.map(String)) : null;
    const movableNodes = selectedSet ? nodesArray.filter(id => selectedSet.has(id)) : nodesArray;

    const originalPos = config.currentPos ? Object.fromEntries(Object.entries(config.currentPos).map(([k, v]) => [k, { ...v }])) : null;
    if (!originalPos) return {};
    let pos = { ...originalPos };

    if (movableNodes.length === 0) return pos;

    // 👇 LIMITADOR DE BUSCA (Clipping Box) com 2 grids de margem de manobra
    const clippingBox = calcBBox(pos, movableNodes);
    clippingBox.minX -= gridSize * 2; clippingBox.maxX += gridSize * 2;
    clippingBox.minY -= gridSize * 2; clippingBox.maxY += gridSize * 2;

    const originalCrossings = findIntersections(pos, branchesArray).length;
    let currentCrossings    = originalCrossings;
    let currentCost         = pslCost(pos, branchesArray, movableNodes);

    if (onProgress) onProgress(0, 'PSL', `Custo inicial: ${currentCost.toFixed(1)}`);

    let iter = 0;
    let globalImproved = true;
    const searchRadius = 2; 

    while (globalImproved && iter < maxIter) {
        globalImproved = false;
        iter++;
        await new Promise(resolve => setTimeout(resolve, 0));

        const currentBBox = calcBBox(pos, movableNodes);
        const nodeOrder = pslNodeOrder(movableNodes, branchesArray, sourcesArray, pos, currentBBox, gridSize);

        if (onProgress) onProgress(iter, 'PSL', `Iter ${iter} | Custo ${currentCost.toFixed(1)}`);

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
                // 👇 CORTA A BUSCA NO INFINITO: Se a coordenada de teste sair da caixa, ignora!
                if (tx < clippingBox.minX || tx > clippingBox.maxX || ty < clippingBox.minY || ty > clippingBox.maxY) {
                    continue;
                }
                
                // Trata todo o resto da rede que não foi selecionada como paredes sólidas
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

    if (onProgress) config.onProgress("Concluído", "Busca Periférica Finalizada", "-");
    return pos;
}