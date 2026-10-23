// src/utils/topology.js
// Topology analysis: which sources energize each bus and which buses/branches are in a loop, and the load summary per source.
// Used by the diagram (colors and panels) in both transmission and generic mode. The power flow lives in
// `transmission.js` (DC local) e no backend (AC).

// 👇 THE UNIFIED BRAIN: propagation with hierarchical dependency 👇
export function analyzeTopology(branches, faultNodes, sysData) {
    const { sources = [], feeders = [] } = sysData || {};
    const nZ = {}; const eZ = {};
    const loopN = new Set(); const loopE = new Set();
    const nodeFeeds = {}; 
    const colorRoots = [...sources, ...feeders]; // The color palette still needs all of them

    // 1. THE REVOLUTION: the Big Bang starts ONLY at the Substations
    let queue = [...sources];
    sources.forEach(s => {
        nodeFeeds[s] = new Set([s]);
        nZ[s] = s;
    });

    const adj = {};
    branches.forEach(b => {
        if (b.state === 1 && !faultNodes.has(b.from) && !faultNodes.has(b.to)) {
            if (!adj[b.from]) adj[b.from] = [];
            if (!adj[b.to]) adj[b.to] = [];
            adj[b.from].push({ node: b.to, edgeId: b.id });
            adj[b.to].push({ node: b.from, edgeId: b.id });
        }
    });

    // 2. Unified Breadth-First Search (BFS)
    while(queue.length > 0) {
        const curr = queue.shift();
        
        let zonesToPropagate;
        
        // 👇 THE TOLL 👇
        // If the energy reached a Feeder, it takes "parenthood" of the wave from here on
        if (feeders.includes(curr)) {
            zonesToPropagate = new Set([curr]);
            nZ[curr] = curr; // The feeder itself takes its characteristic color
            nodeFeeds[curr].add(curr); 
        } else {
            zonesToPropagate = nodeFeeds[curr];
        }

        if (adj[curr]) {
            adj[curr].forEach(({ node: neighbor, edgeId }) => {
                if (sources.includes(neighbor)) return; // Never invades the parent Substation back

                if (!nodeFeeds[neighbor]) {
                    // New energy arrives at the bus
                    nodeFeeds[neighbor] = new Set(zonesToPropagate);
                    nZ[neighbor] = Array.from(zonesToPropagate)[0];
                    eZ[edgeId] = nZ[neighbor];
                    queue.push(neighbor);
                } else {
                    // CHECK VALVE (Salmon Effect)
                    const neighborHasSource = Array.from(nodeFeeds[neighbor]).some(s => sources.includes(s));
                    const tryingToPropagateFeeder = Array.from(zonesToPropagate).some(f => feeders.includes(f));
                    
                    if (tryingToPropagateFeeder && neighborHasSource) {
                        return; // Topological barrier triggered!
                    }

                    let isNewConflict = false;
                    zonesToPropagate.forEach(z => {
                        if (!nodeFeeds[neighbor].has(z)) {
                            nodeFeeds[neighbor].add(z);
                            isNewConflict = true;
                        }
                    });
                    if (isNewConflict) queue.push(neighbor);
                }
            });
        }
    }

    // 3. Determine Nodes in a Loop
    Object.keys(nodeFeeds).forEach(nStr => {
        const node = Number(nStr);
        const zones = Array.from(nodeFeeds[node]);

        let sourceCount = 0; let feederCount = 0;
        zones.forEach(z => {
            if (sources.includes(z)) sourceCount++;
            if (feeders.includes(z)) feederCount++;
        });

        // True Topological Loop: 2 main sources OR 2 feeders.
        if (sourceCount >= 2 || feederCount >= 2) {
            loopN.add(node);
            
            // Feedback: pulls the roots that caused the clash into yellow too
            zones.forEach(z => loopN.add(z)); 
        }
    });

    // 4. Determine Edges in a Loop
    branches.forEach(b => {
        if (b.state === 1) {
            if (loopN.has(b.from) && loopN.has(b.to)) {
                loopE.add(b.id);
            } else {
                const zF = Array.from(nodeFeeds[b.from] || []);
                const zT = Array.from(nodeFeeds[b.to] || []);
                
                if (zF.length > 0 && zT.length > 0 && zF[0] !== zT[0]) {
                    const isSourceF = sources.includes(zF[0]);
                    const isSourceT = sources.includes(zT[0]);
                    const isFeederF = feeders.includes(zF[0]);
                    const isFeederT = feeders.includes(zT[0]);

                    if ((isSourceF && isSourceT) || (isFeederF && isFeederT)) {
                        loopE.add(b.id); loopN.add(b.from); loopN.add(b.to);
                    }
                }
            }
        }
    });

    return { nodeFeeds, nodeZones: nZ, edgeZones: eZ, loopNodes: loopN, loopEdges: loopE, colorRoots };
}

// 👇 LOAD CALCULATION (With Multiple Hierarchical Counting) 👇
export function calculateLoads(nodeFeeds, faultNodes, sysData) {
    const subs = {};
    const { sources = [], feeders = [], loads = {}, shunts = {} } = sysData || {};
    
    // Initializes the panels (SUB and FEEDER)
    const allSources = [...sources, ...feeders];
    allSources.forEach(s => {
        subs[s] = { p: 0, q: 0, nodes: 0 };
    });

    Object.keys(nodeFeeds).forEach(n => {
        const id = parseInt(n);
        if (!allSources.includes(id) && !faultNodes.has(id)) {
            const feeds = nodeFeeds[id];
            
            if (feeds && feeds.size > 0) {
                // Computes the bus P and Q only once
                let nodeP = 0;
                let nodeQ = 0;
                
                if (loads[id]) {
                    nodeP += loads[id].p || 0;
                    nodeQ += loads[id].q || 0;
                }
                
                if (shunts[id] && shunts[id].steps > 0) {
                    nodeQ -= (shunts[id].steps * shunts[id].stepSize);
                }

                // 👇 THE DG OFFSETS THE LOAD IN kW BEFORE ADDING IT TO THE FEEDER 👇
                if (sysData.gd && sysData.gd[id] && sysData.gd[id].active) {
                    nodeP -= sysData.gd[id].pg;
                    nodeQ -= sysData.gd[id].qg;
                }
                
                // 👇 THE TRICK: adds the bus to ALL the sources that feed it! 👇
                feeds.forEach(s => {
                    if (subs[s]) {
                        subs[s].nodes++; 
                        subs[s].p += nodeP;
                        subs[s].q += nodeQ;
                    }
                });
            }
        }
    });

    return subs;
}
