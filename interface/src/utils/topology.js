// src/utils/topology.js
// Análise de topologia: quais fontes energizam cada barra e quais barras/ramos estão em laço, e o resumo de carga por fonte.
// Usada pelo diagrama (cores e painéis) tanto no modo de transmissão quanto no genérico. O fluxo de potência fica em
// `transmission.js` (DC local) e no backend (AC).

// 👇 O CÉREBRO UNIFICADO: Propagação com Dependência Hierárquica 👇
export function analyzeTopology(branches, faultNodes, sysData) {
    const { sources = [], feeders = [] } = sysData || {};
    const nZ = {}; const eZ = {};
    const loopN = new Set(); const loopE = new Set();
    const nodeFeeds = {}; 
    const colorRoots = [...sources, ...feeders]; // A paleta de cores continua precisando de todos

    // 1. A REVOLUÇÃO: O Big Bang começa APENAS nas Subestações
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

    // 2. Busca em Largura (BFS) Unificada
    while(queue.length > 0) {
        const curr = queue.shift();
        
        let zonesToPropagate;
        
        // 👇 A MÁGICA DO PEDÁGIO 👇
        // Se a energia alcançou um Alimentador, ele assume a "paternidade" da onda daqui pra frente
        if (feeders.includes(curr)) {
            zonesToPropagate = new Set([curr]);
            nZ[curr] = curr; // O próprio alimentador assume sua cor característica
            nodeFeeds[curr].add(curr); 
        } else {
            zonesToPropagate = nodeFeeds[curr];
        }

        if (adj[curr]) {
            adj[curr].forEach(({ node: neighbor, edgeId }) => {
                if (sources.includes(neighbor)) return; // Nunca invade a Subestação Mãe de volta

                if (!nodeFeeds[neighbor]) {
                    // Energia nova chega na barra
                    nodeFeeds[neighbor] = new Set(zonesToPropagate);
                    nZ[neighbor] = Array.from(zonesToPropagate)[0];
                    eZ[edgeId] = nZ[neighbor];
                    queue.push(neighbor);
                } else {
                    // VÁLVULA DE RETENÇÃO (Efeito Salmão)
                    const neighborHasSource = Array.from(nodeFeeds[neighbor]).some(s => sources.includes(s));
                    const tryingToPropagateFeeder = Array.from(zonesToPropagate).some(f => feeders.includes(f));
                    
                    if (tryingToPropagateFeeder && neighborHasSource) {
                        return; // Barreira topológica acionada!
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

    // 3. Determinar Nós em Loop
    Object.keys(nodeFeeds).forEach(nStr => {
        const node = Number(nStr);
        const zones = Array.from(nodeFeeds[node]);

        let sourceCount = 0; let feederCount = 0;
        zones.forEach(z => {
            if (sources.includes(z)) sourceCount++;
            if (feeders.includes(z)) feederCount++;
        });

        // Loop Topológico Verdadeiro: 2 fontes principais OU 2 alimentadores.
        if (sourceCount >= 2 || feederCount >= 2) {
            loopN.add(node);
            
            // Retroalimentação: puxa as raízes que causaram o choque para o amarelo também
            zones.forEach(z => loopN.add(z)); 
        }
    });

    // 4. Determinar Arestas em Loop
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

// 👇 CÁLCULO DE CARGA (Com Contagem Hierárquica Múltipla) 👇
export function calculateLoads(nodeFeeds, faultNodes, sysData) {
    const subs = {};
    const { sources = [], feeders = [], loads = {}, shunts = {} } = sysData || {};
    
    // Inicializa os painéis (SUB e ALIM)
    const allSources = [...sources, ...feeders];
    allSources.forEach(s => {
        subs[s] = { p: 0, q: 0, nodes: 0 };
    });

    Object.keys(nodeFeeds).forEach(n => {
        const id = parseInt(n);
        if (!allSources.includes(id) && !faultNodes.has(id)) {
            const feeds = nodeFeeds[id];
            
            if (feeds && feeds.size > 0) {
                // Calcula P e Q da barra uma única vez
                let nodeP = 0;
                let nodeQ = 0;
                
                if (loads[id]) {
                    nodeP += loads[id].p || 0;
                    nodeQ += loads[id].q || 0;
                }
                
                if (shunts[id] && shunts[id].steps > 0) {
                    nodeQ -= (shunts[id].steps * shunts[id].stepSize);
                }

                // 👇 A GD ABATE A CARGA EM kW ANTES DE SOMAR NO ALIMENTADOR 👇
                if (sysData.gd && sysData.gd[id] && sysData.gd[id].active) {
                    nodeP -= sysData.gd[id].pg;
                    nodeQ -= sysData.gd[id].qg;
                }
                
                // 👇 A MÁGICA: Adiciona a barra em TODAS as fontes que a alimentam! 👇
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
