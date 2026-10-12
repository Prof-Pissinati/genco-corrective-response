import { calculateForceLayout, calculateOrthogonalLayout, calculateVNSLayout, calculateHierarchicalLayout, classifyTopology, findIntersections } from './autoLayout';

// =========================================================
// TRAVA DO PONTO CENTRAL
// Impede que o sistema se movimente para longe da tela,
// mas RESPEITA rigorosamente a malha absoluta de 10px!
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
// COMUNICAÇÃO COM O REACT E EXECUÇÃO
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

        // 1. MAPA DE ALIMENTADORES (BFS)
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

        // Auto-classificação de topologia
        if (type === 'auto') {
            const analysis = classifyTopology(nodesArray, branchesArray, config);
            actualType = analysis.recommendedEngine;
            if (config.onProgress) config.onProgress(0, `Topologia: ${analysis.type}`, `Motor: ${actualType}`);
        }

        // ==========================================
        // PREPARAÇÃO DA SELEÇÃO PARCIAL
        // O motor recebe o sistema COMPLETO (para enxergar as paredes), 
        // mas é guiado pelas flags no 'config'.
        // ==========================================
        const selectionFilter = config.selectedNodes && config.selectedNodes.length > 0
            ? new Set(config.selectedNodes.map(String))
            : null;

        const fullPos = config.currentPos || {};

        if (selectionFilter) {
            // Se há seleção, isola as linhas de fronteira (que conectam a seleção ao resto da rede)
            const boundaryBranches = branchesArray.filter(b =>
                selectionFilter.has(String(b.from)) !== selectionFilter.has(String(b.to))
            );
            config.boundaryBranches = boundaryBranches;
        }

        // 👇 CORREÇÃO VITAL: O motor recebe TODOS os nós para não atropelar paredes invisíveis!
        let targetNodes = nodesArray;
        let targetBranches = branchesArray;

        // ==========================================
        // EXECUÇÃO DOS MOTORES
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
            throw new Error(`Motor não reconhecido: ${actualType}`);
        }

        // ==========================================
        // PÓS-PROCESSAMENTO DA SELEÇÃO PARCIAL
        // Garante que as barras não selecionadas não moveram nem 1 milímetro.
        // ==========================================
        if (selectionFilter) {
            const merged = { ...fullPos };
            Object.keys(result).forEach(id => {
                // Sobrescreve APENAS os nós que podiam se mover
                if (selectionFilter.has(String(id))) {
                    merged[id] = result[id];
                }
            });
            result = merged;
        }

        // ==========================================
        // TRAVA DO PONTO CENTRAL
        // Impede a rede inteira de deslizar para fora do grid
        // ==========================================
        if (config && fullPos && Object.keys(fullPos).length > 0) {
            result = lockLayoutCenter(fullPos, result, nodesArray);
        }

        // Devolve o mapa pronto para a tela
        self.postMessage({ type: 'success', jobId, result });

    } catch (error) {
        // 👇 AGORA O WORKER MOSTRA A LINHA EXATA DO ERRO NO CONSOLE 👇
        console.error("🚨 [WORKER] Falha interna no motor:", error);
        const detailedError = error.stack || error.message || String(error);
        self.postMessage({ type: 'error', jobId, error: detailedError });
    }
};