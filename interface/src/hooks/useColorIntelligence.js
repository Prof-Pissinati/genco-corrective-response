import { useCallback } from 'react';
import { THEME } from '../utils/theme.js';

export const PALETTE_HUES = [210, 120, 30, 280, 180, 320, 85, 240, 150, 15];

export const getBaseColor = (id, allRoots, darkMode) => {
    const sortedRoots = [...(allRoots || [])].sort((a, b) => a - b);
    let idx = sortedRoots.indexOf(id);
    if (idx === -1) idx = 0; 
    
    const h = PALETTE_HUES[idx % PALETTE_HUES.length];
    return `hsl(${h}, 95%, ${darkMode ? 50 : 35}%)`;
};

// 👇 Recebe a "topology" pronta de bandeja 👇
// ---- Esquema de cores da transmissão (decisão: carregamento > tensão; escala que não depende de distinguir verde de vermelho) ----
// Carregamento (% de rateA): azul -> azul-céu -> quase-branco -> amarelo -> laranja -> vermelho (>= 100%), sem passar por verde. A largura da linha também cresce com a carga.
const LOADING_STOPS = [[0, [74, 120, 194]], [50, [110, 185, 235]], [68, [236, 236, 226]], [82, [255, 210, 63]], [95, [255, 122, 26]], [100, [213, 0, 0]]];
export function loadingColor(pct) {
    const p = Math.max(0, Math.min(100, pct || 0));
    for (let i = 1; i < LOADING_STOPS.length; i++) {
        const [p1, c1] = LOADING_STOPS[i];
        const [p0, c0] = LOADING_STOPS[i - 1];
        if (p <= p1) {
            const f = (p - p0) / (p1 - p0);
            return `rgb(${c0.map((v, k) => Math.round(v + f * (c1[k] - v))).join(',')})`;
        }
    }
    return 'rgb(213,0,0)';
}
export function loadingWidth(pct) {
    const f = Math.max(0, Math.min(1, ((pct || 0) - 60) / 40));
    return 2.5 + 3.5 * f; // 2,5 px (folgado) até 6 px (>= 100%)
}
// Tensão (pu), divergente azul (baixa) - claro (1,0) - vermelho (alta), com os limites vmin/vmax da barra.
export function voltageColor(v, vmin, vmax, darkMode) {
    const lo = Math.max(1 - vmin, 1e-6), hi = Math.max(vmax - 1, 1e-6);
    const t = Math.max(-1, Math.min(1, v >= 1 ? (v - 1) / hi : (v - 1) / lo));
    const mid = darkMode ? [236, 236, 236] : [200, 200, 200];
    const end = t < 0 ? [33, 102, 172] : [178, 24, 43];
    const f = Math.abs(t);
    return `rgb(${mid.map((m, k) => Math.round(m + f * (end[k] - m))).join(',')})`;
}

export function useColorIntelligence({ faultNodes, activeSources, lineCurrents, darkMode, topology, transmission = false, nodeData = null, voltageMode = false, voltageLimits = null, shedNodes = null }) {
    
    // Extrai o que precisa do pacote
    const { nodeFeeds, nodeZones, edgeZones, loopNodes, loopEdges, colorRoots } = topology;

    const getNodeColor = useCallback((nodeId) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        if (faultNodes.has(nodeId)) return colors.fault;
        if (loopNodes.has(nodeId)) return colors.loop;
        // plano corretivo: barras com carga cortada em laranja
        if (shedNodes && shedNodes.has(Number(nodeId))) return '#ff8f00';
        // transmissão com AC: pintar pela tensão (opcional); barras sem resultado ficam como desenergizadas
        if (transmission && voltageMode && nodeData) {
            const nd = nodeData[nodeId];
            if (!nd) return colors.de;
            const lim = voltageLimits?.[nodeId] || { vmin: 0.94, vmax: 1.06 };
            return voltageColor(nd.v, lim.vmin, lim.vmax, darkMode);
        }
        
        let sourceToUse = null;
        if ((activeSources || []).includes(nodeId)) {
            sourceToUse = nodeId;
        } else {
            const feeds = nodeFeeds[nodeId];
            if (!feeds || feeds.size === 0) return colors.de;
            sourceToUse = Array.from(feeds)[0];
        }
        
        const zone = nodeZones[nodeId] || sourceToUse;
        return getBaseColor(zone, colorRoots, darkMode);
    }, [darkMode, faultNodes, loopNodes, activeSources, nodeFeeds, nodeZones, colorRoots, transmission, voltageMode, nodeData, voltageLimits, shedNodes]);

    const getEdgeColor = useCallback((branch) => {
        const colors = darkMode ? THEME.dark : THEME.light;
        
        if (branch.state === 0) return colors.de;
        
        const current = lineCurrents[branch.id];
        if (!current || current.current < 0.001) return colors.de; 
        if (current.percentage >= 100) return '#d50000'; 
        if (transmission) return loadingColor(current.percentage);
        if (loopEdges.has(branch.id)) return colors.loop; 
        
        const pVal = current.p !== undefined ? current.p : (current.pFlow || 0);
        const isReverse = pVal < 0; 
        const sendingNode = isReverse ? branch.to : branch.from;
        
        let zone = nodeZones[sendingNode] || edgeZones[branch.id];
        
        if (!zone && colorRoots) {
            zone = colorRoots.includes(sendingNode) ? sendingNode : colorRoots[0];
        }
        
        const p = Math.min((current.percentage || 0) / 100, 1.0);
        const alpha = 0.45 + (0.55 * Math.sqrt(p)); 
        
        const sortedRoots = [...(colorRoots || [])].sort((a, b) => a - b);
        let idx = sortedRoots.indexOf(zone);
        if (idx === -1) idx = 0; 
        
        const hue = PALETTE_HUES[idx % PALETTE_HUES.length] || 0;
        
        return `hsla(${hue}, 95%, ${darkMode ? 55 : 35}%, ${alpha.toFixed(3)})`; 
    }, [darkMode, lineCurrents, loopEdges, nodeZones, edgeZones, colorRoots, transmission]);

    const getEdgeWidth = useCallback((branch) => {
        if (!transmission || branch.state === 0) return undefined;
        const c = lineCurrents[branch.id];
        return c ? loadingWidth(c.percentage) : undefined;
    }, [transmission, lineCurrents]);

    return { getNodeColor, getEdgeColor, getEdgeWidth };
}