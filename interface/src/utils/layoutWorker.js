import { calculateForceLayout, calculateOrthogonalLayout, calculateVNSLayout, calculateHierarchicalLayout, classifyTopology, findIntersections } from './autoLayout';

// =========================================================
// CENTER POINT LOCK
// Prevents the system from drifting away from the screen,
// but strictly RESPECTS the absolute 10px grid!
// =========================================================
function lockLayoutCenter(initialPos, calculatedPos, nodesArray) {
    if (!initialPos || Object.keys(initialPos).length === 0) return calculatedPos;

    let minX_old = Infinity, maxX_old = -Infinity, minY_old = Infinity, maxY_old = -Infinity;
    let minX_new = Infinity, maxX_new = -Infinity, minY_new = Infinity, maxY_new = -Infinity;

    nodesArray.forEach(id => {
        const pOld = initialPos[id];
        if (pOld) {
            minX_old = Math.min(minX_old, pOld.x); maxX_old = Math.max(maxX_old, pOld.x);
            minY_old = Math.min(minY_old, pOld.y); maxY_old = Math.max(maxY_old, pOld.y);
        }
        const pNew = calculatedPos[id];
        if (pNew) {
            minX_new = Math.min(minX_new, pNew.x); maxX_new = Math.max(maxX_new, pNew.x);
            minY_new = Math.min(minY_new, pNew.y); maxY_new = Math.max(maxY_new, pNew.y);
        }
    });

    const deltaX = (minX_old + (maxX_old - minX_old)/2) - (minX_new + (maxX_new - minX_new)/2);
    const deltaY = (minY_old + (maxY_old - minY_old)/2) - (minY_new + (maxY_new - minY_new)/2);

    const snappedDX = Math.round(deltaX / 10) * 10;
    const snappedDY = Math.round(deltaY / 10) * 10;

    const lockedPos = {};
    nodesArray.forEach(id => {
        if (calculatedPos[id]) {
            lockedPos[id] = {
                x: calculatedPos[id].x + snappedDX,
                y: calculatedPos[id].y + snappedDY
            };
        }
    });
    return lockedPos;
}

// =========================================================
// COMMUNICATION WITH REACT AND EXECUTION
// ==========================================
self.onmessage = async (e) => {
    const { type, nodesArray, branchesArray, sourcesArray, config, jobId } = e.data;

    if (config && config.reportProgress) {
        config.onProgress = (passes, msg1, msg2) => {
            self.postMessage({ type: 'progress', jobId, passes, msg1, msg2 });
        };
    }

    try {
        let actualType = type;

        // 1. FEEDER MAP (BFS)
        const feederMap = {};
        if (config && config.feeders) {
            const queue = [...config.feeders];
            config.feeders.forEach(f => feederMap[f] = String(f));
            const adj = {};
            branchesArray.forEach(b => {
                if (b.state === 1) {
                    if (!adj[b.from]) adj[b.from] = [];
                    if (!adj[b.to])   adj[b.to]   = [];
                    adj[b.from].push(b.to);
                    adj[b.to].push(b.from);
                }
            });
            let head = 0;
            while (head < queue.length) {
                const currId = queue[head++];
                const myFeeder = feederMap[currId];
                if (adj[currId]) {
                    adj[currId].forEach(nxt => {
                        if (!feederMap[nxt] && !sourcesArray.includes(nxt)) {
                            feederMap[nxt] = myFeeder;
                            queue.push(nxt);
                        }
                    });
                }
            }
        }
        config.feederMap = feederMap;

        // Topology auto-classification
        if (type === 'auto') {
            const analysis = classifyTopology(nodesArray, branchesArray, config);
            actualType = analysis.recommendedEngine;
            if (config.onProgress) config.onProgress(0, `Topology: ${analysis.type}`, `Engine: ${actualType}`);
        }

        // ==========================================
        // PARTIAL SELECTION PREPARATION
        // The engine receives the COMPLETE system (to see the walls), 
        // but is guided by the flags in 'config'.
        // ==========================================
        const selectionFilter = config.selectedNodes && config.selectedNodes.length > 0
            ? new Set(config.selectedNodes.map(String))
            : null;

        const fullPos = config.currentPos || {};

        if (selectionFilter) {
            // If there is a selection, isolates the boundary lines (which connect the selection to the rest of the network)
            const boundaryBranches = branchesArray.filter(b =>
                selectionFilter.has(String(b.from)) !== selectionFilter.has(String(b.to))
            );
            config.boundaryBranches = boundaryBranches;
        }

        // 👇 VITAL FIX: the engine receives ALL the nodes so it does not run over invisible walls!
        let targetNodes = nodesArray;
        let targetBranches = branchesArray;

        // ==========================================
        // ENGINE EXECUTION
        // ==========================================
        let result;

        if (actualType === 'force') {
            result = calculateForceLayout(targetNodes, targetBranches, sourcesArray, config);
        } else if (actualType === 'vns') {
            result = await calculateVNSLayout(targetNodes, targetBranches, sourcesArray, config);
        } else if (actualType === 'orthogonal') {
            result = await calculateOrthogonalLayout(targetNodes, targetBranches, sourcesArray, config);
        } else if (actualType === 'hierarchical') {
            result = await calculateHierarchicalLayout(targetNodes, targetBranches, sourcesArray, config);
        } else {
            throw new Error(`Unrecognized engine: ${actualType}`);
        }

        // ==========================================
        // PARTIAL SELECTION POST-PROCESSING
        // Guarantees that the unselected buses did not move even 1 millimeter.
        // ==========================================
        if (selectionFilter) {
            const merged = { ...fullPos };
            Object.keys(result).forEach(id => {
                // Overwrites ONLY the nodes that were allowed to move
                if (selectionFilter.has(String(id))) {
                    merged[id] = result[id];
                }
            });
            result = merged;
        }

        // ==========================================
        // CENTER POINT LOCK
        // Prevents the whole network from sliding off the grid
        // ==========================================
        if (config && fullPos && Object.keys(fullPos).length > 0) {
            result = lockLayoutCenter(fullPos, result, nodesArray);
        }

        // Returns the map ready for the screen
        self.postMessage({ type: 'success', jobId, result });

    } catch (error) {
        // 👇 NOW THE WORKER SHOWS THE EXACT ERROR LINE IN THE CONSOLE 👇
        console.error("🚨 [WORKER] Internal engine failure:", error);
        const detailedError = error.stack || error.message || String(error);
        self.postMessage({ type: 'error', jobId, error: detailedError });
    }
};