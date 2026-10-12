import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { analyzeTopology, calculateLoads } from './utils/topology';
import { THEME } from './utils/theme';
import Sidebar from './components/Sidebar';
import FaultPanel from './components/FaultPanel';
import MapArea from './components/MapArea';
import GraphArea from './components/GraphArea';
import EditSidebar from './components/editSidebar'; 
import { exportSVG } from './utils/exportUtils';
import './index.css';
import { useFileImport } from './hooks/useFileImport';

import { runAsyncLayout } from './utils/runLayoutWorker';
import { expandTopology, contractTopology, relaxExpandedNodes, findIntersections, compactPositions } from './utils/autoLayout';

import { useShortcuts } from './hooks/useShortcuts';
import { useColorIntelligence, getBaseColor } from './hooks/useColorIntelligence';
import CASE118 from './data/case118_ieee.json';
import { buildTransmissionSystem, solveTransmissionDC } from './utils/transmission';
import { backendEvaluate, buildRequest, topologyFromState, toInterfaceResult, backendCorrective, buildCorrectiveRequest } from './solver/backendClient';
import { stageResult, shedByBus } from './solver/corrective';
import CorrectivePanel from './components/CorrectivePanel';
import ScreeningPanel from './components/ScreeningPanel';
import RecoveryPanel from './components/RecoveryPanel';
import { REPLAY } from './solver/replay';
import { faultItems, buildRecoveryRequest, backendRecovery, eventResult, eventShed, eventRemaining } from './solver/recovery';
import SCREENING_118 from './data/screening_case118_ieee.json';
import { buildScreenRequest, backendScreen } from './solver/screening';



function App() {

    const [macroGraph, setMacroGraph] = useState(null);
    // Escuta o evento que vem do botão da Sidebar
    useEffect(() => {
        const handleApplyMacro = (e) => setMacroGraph(e.detail);
        window.addEventListener('applyMacroGraph', handleApplyMacro);
        return () => window.removeEventListener('applyMacroGraph', handleApplyMacro);
    }, []);
    
    // Configurações Base do Sistema (Unificadas)
    const [vBase, setVBase] = useState(13.8);
    const [sBase, setSBase] = useState(1000);
    const [sses, setSses] = useState({});
    const [vMinLimit, setVMinLimit] = useState(0.95);
    const [vMaxLimit, setVMaxLimit] = useState(1.05);

    const [darkMode, setDarkMode] = useState(true); 
    // Controle de Visualização: 'schematic' (Diagrama SVG) ou 'map' (Georreferenciado Leaflet)
    const [viewMode, setViewMode] = useState('schematic');
    
    // O sistema agora nasce vazio, sem chaves e sem peso na memória
    const [branches, setBranches] = useState([]);
    const initialBranchesRef = useRef([]);
    
    
    const [faultNodes, setFaultNodes] = useState(new Set());

    
    const [activeSources, setActiveSources] = useState([]);
    const [systemShunts, setSystemShunts] = useState({});
    const [systemFeeders, setSystemFeeders] = useState([]);
    const [systemLoads, setSystemLoads] = useState({});
    const [systemGD, setSystemGD] = useState({}); // 👈 Novo estado para GD
    // Solver em transmissão: 'dc' = local (JS, sempre disponível) | 'ac' = backend (Python). Se o backend falhar, volta ao DC local.
    const [solverMode, setSolverMode] = useState('dc');
    const [backendResult, setBackendResult] = useState(null);
    const [backendStatus, setBackendStatus] = useState('idle'); // idle | loading | online | offline
    const [backendMsg, setBackendMsg] = useState('');
    // Resposta corretiva (transmissão): { data: resposta de /corrective, stage: 'pre' | 'postFault' | 'after' }
    const [corrective, setCorrective] = useState(null);
    const [correctiveBusy, setCorrectiveBusy] = useState(false);
    const [screening, setScreening] = useState(null);       // resultado da varredura N-1 (/screen)
    const [screeningBusy, setScreeningBusy] = useState(false);
    const [screeningOpen, setScreeningOpen] = useState(false);
    // Reparo e religação por blocos: { data: resposta de /recovery, index: passo exibido }
    const [recoveryOpen, setRecoveryOpen] = useState(false);
    const [recovery, setRecovery] = useState(null);
    const [recoveryBusy, setRecoveryBusy] = useState(false);
    const [recoveryPlaying, setRecoveryPlaying] = useState(false);
    const [repairOrder, setRepairOrder] = useState([]);
    const [recoveryOptions, setRecoveryOptions] = useState({ repairHours: 2, blockMinutes: 10, blockMW: 50 });
    const recoverySync = useRef(false);   // true quando a mudança de falhas vem da própria linha do tempo (não invalida a análise)
    const [correctivePlaying, setCorrectivePlaying] = useState(false);
    const [nodeColorMode, setNodeColorMode] = useState('state'); // 'state' | 'voltage' (barras pela tensão, só com AC)
    const [transmission, setTransmission] = useState(null); // dados de transmissão (modo transmissão: fluxo DC, ver utils/transmission.js)
    const [projectPositions, setProjectPositions] = useState({});
    const [projectWaypoints, setProjectWaypoints] = useState({});
    const [geoPositions, setGeoPositions] = useState({});
    // 👇 NOVOS ESTADOS ELEVADOS DAS ROTAS DO MAPA 👇
    const [routedPaths, setRoutedPaths] = useState({});
    const [manualWaypoints, setManualWaypoints] = useState({});
    const [straightSegments, setStraightSegments] = useState({});
    

    const [selectedElement, setSelectedElement] = useState(null);
    const [showLabels, setShowLabels] = useState(false);
    const [showLegend, setShowLegend] = useState(true); 
    const [toast, setToast] = useState(null);
    const [calcMethod, setCalcMethod] = useState('NR'); 
    const [isEditMode, setIsEditMode] = useState(false);
    const [showCrossings, setShowCrossings] = useState(true);

    const [layoutHistory, setLayoutHistory] = useState([]); 
    const [layoutMode, setLayoutMode] = useState('project'); 
    const [organicPositions, setOrganicPositions] = useState(null);

    const [organicWaypoints, setOrganicWaypoints] = useState({});

    const [isCalculatingLayout, setIsCalculatingLayout] = useState(false);
    // 👇 CÂMERA DE SEGURANÇA 1: Monitora a Variável da Tela Preta
    useEffect(() => {
        console.log(`🎥 [App.jsx] A variável isCalculatingLayout mudou para: ${isCalculatingLayout ? '🟢 LIGADA' : '🔴 DESLIGADA'}`);
    }, [isCalculatingLayout]);

    const activePositions = useMemo(() => {
        if (macroGraph) return macroGraph.positions; // 👈 Posição amassada ganha prioridade
        return layoutMode === 'project' ? projectPositions : (organicPositions || projectPositions);
    }, [layoutMode, projectPositions, organicPositions, macroGraph]);

    
    // ==========================================
    // 🎯 RADAR DE CRUZAMENTOS (CALCULADOR)
    // ==========================================
    
    // 1. Cria uma "assinatura" geométrica. Ela só muda se uma linha for criada ou deletada, 
    // ignorando totalmente se a chave abriu ou fechou (b.state).
    const branchesTopologyHash = branches.map(b => `${b.from}-${b.to}`).join('|');

    const intersections = useMemo(() => {
        // 2. Barreira de Performance Extrema: 
        // Só roda a matemática pesada se estivermos no Modo Edição E o Radar estiver ligado!
        if (!isEditMode || !showCrossings || !activePositions || !branches) return [];
        
        return findIntersections(activePositions, branches);
        
    // Ignoramos o aviso do React sobre o array de branches para forçar a nossa regra geométrica
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePositions, branchesTopologyHash, isEditMode, showCrossings]);

    const activeWaypoints = useMemo(() => layoutMode === 'project' ? projectWaypoints : (organicWaypoints || projectWaypoints), [layoutMode, projectWaypoints, organicWaypoints]);
    
    const [printFrameMode, setPrintFrameMode] = useState('none'); 
    const [showShortcuts, setShowShortcuts] = useState(false);
    
    const [sidebarMode, setSidebarMode] = useState('full');
    const [isFaultSidebarOpen, setFaultSidebarOpen] = useState(true);
    const [hoveredLineId, setHoveredLineId] = useState(null);
    const [hoveredNodeId, setHoveredNodeId] = useState(null);
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);
    const matFileInputRef = useRef(null);
    // 👇 BLINDAGEM CONTRA LOOP INFINITO 👇
    const allNodes = useMemo(() => 
        Array.from(new Set(branches.flatMap(b => [b.from, b.to]))).sort((a, b) => a - b)
    , [branches]);
    
    const sources = activeSources;
    
    const loadNodes = useMemo(() => 
        allNodes.filter(n => !sources.includes(n) && !systemFeeders.includes(n))
    , [allNodes, sources, systemFeeders]);
    
    // Fontes e alimentadores (barreira para a propagação de faltas)
    const allBoundaryNodes = useMemo(() => [...sources, ...systemFeeders], [sources, systemFeeders]);
    
    
    const [layoutProgress, setLayoutProgress] = useState({ passes: 0, msg1: '', msg2: '' });
    
    // 👇 BLACK START INTELIGENTE (Agrupamento de Loops) 👇
    const runBlackStart = useCallback((targetBranches, targetSources, targetFeeders) => {
        
        const feederNodes = new Set((targetFeeders || []).map(Number));
        const allSources = (targetSources || []).map(Number);
        
        // 1. A verdadeira raiz é quem é Source mas NÃO É Alimentador
        const trueRoots = allSources.filter(s => !feederNodes.has(s));
        if (trueRoots.length === 0) {
            console.warn("⚠️ ALERTA: Nenhuma fonte principal encontrada! Verifique o arquivo de dados.");
        }
        const rootSourcesSet = new Set(trueRoots.length > 0 ? trueRoots : allSources);

        // 2. Identificação das Chaves Mestras e geração do Blackout
        const rootBranches = [];
        const blackoutState = targetBranches.map(b => {
            const isMasterSwitch = rootSourcesSet.has(Number(b.from)) || rootSourcesSet.has(Number(b.to));
            if (b.state === 1 && isMasterSwitch) {
                rootBranches.push(b);
                return { ...b, state: 0 }; 
            }
            return { ...b };
        });

        // =========================================================
        // 🧠 3. INTELIGÊNCIA DE LOOPS: Agrupamento Topológico
        // =========================================================
        const rootBranchIds = new Set(rootBranches.map(b => b.id));
        const adj = {};
        
        // 3a. Cria mapa de conexões APENAS com a rede interna (ignorando as chaves mestras)
        targetBranches.forEach(b => {
            if (b.state === 1 && !rootBranchIds.has(b.id)) {
                if (!adj[b.from]) adj[b.from] = [];
                if (!adj[b.to]) adj[b.to] = [];
                adj[b.from].push(b.to);
                adj[b.to].push(b.from);
            }
        });

        const nodeComponent = {};
        let compCounter = 0;
        
        // 3b. Algoritmo de Busca (BFS) para mapear Ilhas
        const getComponent = (startNode) => {
            if (nodeComponent[startNode] !== undefined) return nodeComponent[startNode];
            compCounter++;
            const queue = [startNode];
            nodeComponent[startNode] = compCounter;
            
            let head = 0;
            while(head < queue.length) {
                const u = queue[head++];
                if (adj[u]) {
                    adj[u].forEach(v => {
                        if (nodeComponent[v] === undefined) {
                            nodeComponent[v] = compCounter;
                            queue.push(v);
                        }
                    });
                }
            }
            return compCounter;
        };

        const groupsMap = {};
        rootBranches.forEach(b => {
            // Pega o nó da chave que está "dentro" da rede (e não na subestação)
            const networkNode = rootSourcesSet.has(Number(b.from)) ? Number(b.to) : Number(b.from);
            const compId = getComponent(networkNode);
            
            if (!groupsMap[compId]) groupsMap[compId] = [];
            groupsMap[compId].push(b.id); // Agrupa as chaves que tocam a mesma ilha
        });

        // Converte o mapa em um Array de grupos de chaves
        const rootBranchGroups = Object.values(groupsMap);
        // =========================================================

        // Desliga a subestação
        setBranches(blackoutState);

        // 4. Religamento em Cascata (Agrupado por Ilha/Loop)
        let index = 0;
        const interval = setInterval(() => {
            if (index >= rootBranchGroups.length) {
                clearInterval(interval);
                return;
            }

            const groupToClose = rootBranchGroups[index]; // Array com 1 ou mais IDs de chaves
            
            // 4a. Liga TODAS as chaves do grupo simultaneamente
            setBranches(prev => prev.map(b => 
                groupToClose.includes(b.id) ? { ...b, state: 1 } : b
            ));
            
            // 4b. Acorda o Newton-Raphson com os nós de todas as chaves fechadas
            const nodesToWake = new Set();
            targetBranches.forEach(b => {
                if (groupToClose.includes(b.id)) {
                    nodesToWake.add(b.from);
                    nodesToWake.add(b.to);
                }
            });
            //if (nodesToWake.size > 0) setLastEventNodes(nodesToWake);

            index++;
        }, 50);
    }, []);

    // 👇 FUNÇÃO DE CARREGAMENTO UNIFICADA 👇
    const applySystemData = useCallback((data, sourceName = "Externo") => {
        const targetBranches = data.branches ? data.branches.map((b, idx) => ({ 
            ...b, id: idx, state: (b.initialState !== undefined ? b.initialState : (b.state !== undefined ? b.state : 1)) 
        })) : [];

        setBranches(targetBranches);
        if (initialBranchesRef) initialBranchesRef.current = JSON.parse(JSON.stringify(targetBranches)); 
        
        setSystemLoads(data.loads || {}); 
        setSystemShunts(data.shunts || {});
        setActiveSources(data.sources || []); 
        setSystemFeeders(data.feeders || []);
        setSystemGD(data.systemGD || data.gd || {}); // 👈 Injeta a GD vinda do Parser ou JSON
        setTransmission(data.transmission || null);
        if (data.transmission) setViewMode('schematic'); // sem coordenadas geográficas em casos de transmissão

        // 👇 ADICIONADO: Suporte para nomes de variáveis tanto do JSON quanto do DAT
        setVBase(data.Vbase || data.baseKV || 13.8);
        setSBase(data.Sbase || data.sBase || 1000);
        setSses(data.sses || data.Sses || {});
        // Tenta ler de data.constraints, senão usa os valores padrão
        setVMinLimit(data.constraints?.vMin ?? 0.95);
        setVMaxLimit(data.constraints?.vMax ?? 1.05);

        const layoutData = data.layout || data;
        setProjectPositions(layoutData.positionsProject || layoutData.positions || {});
        setProjectWaypoints(layoutData.waypointsProject || layoutData.waypoints || {});
        setGeoPositions(layoutData.geoPositions || data.geoPositions || {});
        // 👇 IMPORTA AS ROTAS DO ARQUIVO (OU ZERA SE FOR UM SISTEMA NOVO) 👇
        setRoutedPaths(layoutData.routes || data.routes || {});
        setManualWaypoints(layoutData.manualWaypoints || data.manualWaypoints || {});
        setStraightSegments(layoutData.straightSegments || data.straightSegments || {});

        setFaultNodes(new Set(data.faults || []));
        setIsProjectLoaded(true);

        runBlackStart(targetBranches, data.sources || [], data.feeders || []);

        console.log(`⚙️ Sistema [${sourceName}] carregado com sucesso na Engine Unificada.`);
        // 👇 ADICIONE ESTES LOGS DE RASTREIO AQUI 👇
        console.log("====================================");
        console.log(`📥 [IMPORTAÇÃO] Carregando dados da fonte: ${sourceName}`);
        console.log("📦 Objeto completo recebido:", data);
        console.log("🎯 Constraints encontradas:", data?.constraints);
        console.log("====================================");

        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 50);
        setTimeout(() => window.dispatchEvent(new CustomEvent('triggerZoomExtents')), 650);
    }, [runBlackStart]);

    // 👇 EFEITO DO LAYOUT ORGÂNICO ASYNC 👇
    useEffect(() => {
        if (layoutMode === 'organic' && !organicPositions && allNodes.length > 0 && !isCalculatingLayout) {
            const calculateAsync = async () => {
                setIsCalculatingLayout(true);
                setLayoutProgress({ passes: 0, msg1: "Iniciando Motor Físico...", msg2: "Preparando nós" });
                
                try {
                    // Chama o operário terceirizado!
                    const newLayout = await runAsyncLayout('auto', allNodes, branches, sources, { 
                        gridSize: 100, 
                        maxIter: 30,
                        currentPos: projectPositions,
                        onProgress: (passes, msg1, msg2) => {
                            setLayoutProgress({ passes, msg1, msg2 });
                        }
                    });
                    setOrganicPositions(newLayout);
                } catch (error) {
                    console.error("Erro no Worker de Layout:", error);
                    showToast("Erro ao calcular layout orgânico.", "error");
                } finally {
                    setIsCalculatingLayout(false);
                }
            };
            calculateAsync();
        }
    }, [layoutMode, organicPositions, allNodes, branches, sources]);

    useEffect(() => {
        setOrganicPositions(null);
        setLayoutMode('project');
    }, [allNodes.length]);

    useEffect(() => {
        const timer1 = setTimeout(() => { window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }, 50);
        const timer2 = setTimeout(() => { window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }, 700);
        return () => { clearTimeout(timer1); clearTimeout(timer2); };
    }, [layoutMode]);

    useEffect(() => {
        if (darkMode) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
    }, [darkMode]);

    const handleUndoLayout = useCallback(() => {
        if (layoutHistory.length === 0) return;
        const lastState = layoutHistory[layoutHistory.length - 1];
        if (layoutMode === 'organic') {
            setOrganicPositions(lastState.positions);
            if (lastState.waypoints) setOrganicWaypoints(lastState.waypoints); 
        } else {
            setProjectPositions(lastState.positions);
            setProjectWaypoints(lastState.waypoints);
        }
        setLayoutHistory(prev => prev.slice(0, -1));
    }, [layoutHistory, layoutMode]);

    const saveLayoutToHistory = useCallback((positions, waypoints) => {
        const currentState = JSON.parse(JSON.stringify({ positions: positions, waypoints: waypoints }));
        setLayoutHistory(prev => [...prev, currentState].slice(-20)); 
    }, []);

    useEffect(() => {
        const handleSaveToHistory = (e) => { saveLayoutToHistory(e.detail.positions, e.detail.waypoints); };
        window.addEventListener('saveToHistory', handleSaveToHistory);
        return () => window.removeEventListener('saveToHistory', handleSaveToHistory);
    }, [saveLayoutToHistory]);

    const handleResetToOriginalLayout = useCallback(() => {
        if (window.confirm("🚨 Tem certeza que deseja resetar o layout para o padrão do arquivo? Todas as alterações não salvas serão perdidas.")) {
            window.dispatchEvent(new CustomEvent('resetGraphLayout'));
            setLayoutHistory([]); 
        }
    }, []);

    const sysData = useMemo(() => ({
        sources: activeSources, 
        feeders: systemFeeders,
        loads: systemLoads, 
        gd: systemGD, 
        Vbase: vBase, 
        Sbase: sBase, 
        shunts: systemShunts || {}, 
        sses: sses,
        vMin: vMinLimit,
        vMax: vMaxLimit,
        transmission
    }), [activeSources, systemLoads, systemShunts, systemFeeders, vBase, sBase, sses, systemGD, vMinLimit, vMaxLimit, transmission]);

    const topology = useMemo(() => analyzeTopology(branches, faultNodes, sysData), [branches, faultNodes, sysData]);
    const { nodeFeeds, loopNodes } = topology; // Extraímos o que o App e o Painel precisam
    
    const loads = useMemo(() => calculateLoads(nodeFeeds, faultNodes, sysData), [nodeFeeds, faultNodes, sysData]);
    
    const disconnectedStats = useMemo(() => {
        let totalP = 0, totalQ = 0, count = 0;
        loadNodes.forEach(nodeId => {
            const feeds = nodeFeeds[nodeId];
            if ((!feeds || feeds.size === 0) && !faultNodes.has(nodeId)) {
                // 👇 CORREÇÃO: Usa o 'systemLoads' que veio da importação, não o arquivo fixo!
                const load = systemLoads[nodeId]; 
                if (load) { totalP += load.p || 0; totalQ += load.q || 0; count++; }
            }
        });
        const sKVA = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
        // 👇 Usa o vBase dinâmico
        const estimatedCurrent = sKVA / (Math.sqrt(3) * vBase); 
        return { p: totalP, q: totalQ, current: estimatedCurrent || 0, count: count };
    }, [loadNodes, nodeFeeds, faultNodes, systemLoads, vBase]);

    // Bloco atualizado com a memória do Warm Start
    const powerFlowResults = useMemo(() => {
        // Se não há ramos, não há o que calcular
        if (!branches || branches.length === 0) return { nodes: {}, lines: {} };

        // Transmissão: fluxo DC local por ilha energizada, ou AC do backend, ou a etapa de uma análise
        if (sysData.transmission) {
            if (recovery) return eventResult(recovery.data, recovery.index, branches);          // passo da linha do tempo de reparo
            if (corrective) return stageResult(corrective.data, corrective.stage, branches);   // etapa da resposta corretiva em exibição
            if (solverMode === 'ac' && backendResult) return backendResult;
            return solveTransmissionDC(branches, faultNodes, sysData);
        }

        return { nodes: {}, lines: {} };   // só há solver para transmissão (DC local ou AC no backend)
    }, [branches, faultNodes, sysData, solverMode, backendResult, corrective, recovery]);

    const lineCurrents = powerFlowResults.lines;
    const nodeData = powerFlowResults.nodes;

    // Usa o Estado Oficial do React
    const voltageMode = !!transmission && solverMode === 'ac' && backendStatus === 'online' && nodeColorMode === 'voltage';
    const voltageLimits = useMemo(() => (transmission ? transmission.buses : null), [transmission]);
    const shedBuses = useMemo(() => {
        if (recovery) return eventShed(recovery.data, recovery.index);
        return corrective && corrective.stage === 'after' ? shedByBus(corrective.data) : null;
    }, [corrective, recovery]);
    const shedNodes = useMemo(() => (shedBuses && shedBuses.size ? new Set(shedBuses.keys()) : null), [shedBuses]);
    const generatorBuses = useMemo(() => (transmission ? new Set(transmission.gens.filter(g => g.status).map(g => g.bus)) : null), [transmission]);
    const { getNodeColor, getEdgeColor, getEdgeWidth } = useColorIntelligence({
        faultNodes, activeSources, lineCurrents, darkMode, topology, transmission: !!transmission,
        nodeData, voltageMode, voltageLimits, shedNodes
    });

    const effectiveHoveredLineId = hoveredLineId;

    const displayElement = useMemo(() => {
        if (hoveredNodeId !== null) return { type: 'node', id: hoveredNodeId };
        if (effectiveHoveredLineId !== null) return { type: 'edge', data: branches.find(b => b.id === effectiveHoveredLineId) };
        if (selectedElement?.type === 'edge' && selectedElement.data) {
            return { type: 'edge', data: branches.find(b => b.id === selectedElement.data.id) || selectedElement.data };
        }
        return selectedElement;
    }, [hoveredNodeId, effectiveHoveredLineId, selectedElement, branches]);

    const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

    // AC no backend (transmissão): reavalia a topologia a cada mudança, com pequeno atraso e cancelamento do pedido anterior
    useEffect(() => {
        if (!transmission || solverMode !== 'ac') { setBackendResult(null); setBackendStatus('idle'); return undefined; }
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            setBackendStatus('loading');
            try {
                const topo = topologyFromState(branches, faultNodes);
                const data = await backendEvaluate(buildRequest(transmission, 'ac', [topo]), ctrl.signal);
                const res = data.results[0];
                if (!res.converged) throw new Error(res.error || 'o AC não convergiu');
                setBackendResult(toInterfaceResult(res, branches));
                setBackendMsg(`${res.ms} ms`);
                setBackendStatus('online');
            } catch (e) {
                if (e.name === 'AbortError') return;
                setBackendResult(null);
                setBackendMsg(e.message || String(e));
                setBackendStatus('offline');
            }
        }, 80);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [transmission, solverMode, branches, faultNodes]);

    // avisa uma vez quando o backend cai (ou o AC não converge) e a tela volta ao DC local
    const prevBackendStatus = useRef('idle');
    useEffect(() => {
        if (backendStatus === 'offline' && prevBackendStatus.current !== 'offline') {
            showToast(`AC indisponível (${backendMsg}). Mostrando o DC local.`, 'warning');
        }
        prevBackendStatus.current = backendStatus;
    }, [backendStatus, backendMsg]);

    // Resposta corretiva: analisa as falhas marcadas (barras em falta e linhas abertas) no backend e mostra pré-falta -> pós-falta -> com plano
    const runCorrective = async () => {
        if (!transmission) return;
        const topo = topologyFromState(branches, faultNodes);
        if (!topo.branchOut.length && !topo.busOut.length) {
            showToast('Marque ao menos uma falha (barra em falta ou linha aberta) antes de analisar.', 'warning');
            return;
        }
        setCorrectiveBusy(true);
        try {
            const data = await backendCorrective(buildCorrectiveRequest(transmission, topo));
            setCorrective({ data, stage: 'pre' });
            setCorrectivePlaying(true);
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend indisponível para a análise (${e.message}). Inicie o backend (iniciar-local.bat).`, 'error');
        } finally {
            setCorrectiveBusy(false);
        }
    };
    const clearCorrective = () => { setCorrective(null); setCorrectivePlaying(false); };

    // Varredura N-1: todas as linhas e barras, uma a uma
    const runScreening = async () => {
        if (!transmission) return;
        setScreeningBusy(true);
        try {
            setScreening(await backendScreen(buildScreenRequest(transmission)));
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend indisponível para a varredura (${e.message}). Inicie o backend (iniciar-local.bat).`, 'error');
        } finally {
            setScreeningBusy(false);
        }
    };
    // Clicar numa contingência da varredura: aplica só essa falha no diagrama e pede a resposta corretiva
    const selectContingency = async (c) => {
        const branchOut = c.type === 'line' ? [c.id] : [];
        const busOut = c.type === 'bus' ? [c.id] : [];
        setBranches(prev => prev.map(b => ({ ...b, state: branchOut.includes(b.id) ? 0 : (b.initialState !== undefined ? b.initialState : 1) })));
        setFaultNodes(new Set(busOut));
        setCorrectiveBusy(true);
        try {
            const data = await backendCorrective(buildCorrectiveRequest(transmission, { branchOut, busOut }));
            // as mudanças de falhas acima invalidam a análise (efeito abaixo); aplica o resultado depois delas
            setTimeout(() => { setCorrective({ data, stage: 'pre' }); setCorrectivePlaying(true); }, 0);
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend indisponível para a análise (${e.message}).`, 'error');
        } finally {
            setCorrectiveBusy(false);
        }
    };

    // qualquer mudança nas falhas invalida a análise anterior
    useEffect(() => {
        if (recoverySync.current) { recoverySync.current = false; return; }
        setCorrective(null); setCorrectivePlaying(false); setRecovery(null); setRecoveryPlaying(false);
    }, [branches, faultNodes]);

    // Reparo e religação: falhas atuais -> ordem dos reparos; simulação; o diagrama acompanha o passo (mostra só as falhas que restam)
    const currentFaultItems = useMemo(() => (transmission ? faultItems(branches, faultNodes) : []), [transmission, branches, faultNodes]);
    useEffect(() => {
        if (recovery) return;
        setRepairOrder(prev => {
            const key = (x) => `${x.type}-${x.id}`;
            const kept = prev.filter(p => currentFaultItems.some(c => key(c) === key(p)));
            return [...kept, ...currentFaultItems.filter(c => !kept.some(k => key(k) === key(c)))];
        });
    }, [currentFaultItems, recovery]);
    const applyRemaining = (rem) => {
        recoverySync.current = true;
        setBranches(prev => prev.map(b => ({ ...b, state: rem.branchOut.includes(b.id) ? 0 : (b.initialState !== undefined ? b.initialState : 1) })));
        setFaultNodes(new Set(rem.busOut));
    };
    const runRecovery = async () => {
        if (!transmission || !repairOrder.length) return;
        setRecoveryBusy(true);
        try {
            const data = await backendRecovery(buildRecoveryRequest(transmission, repairOrder, recoveryOptions));
            setRecovery({ data, index: 0, original: { branchOut: data.faults.branchOut, busOut: data.faults.busOut } });
            setRecoveryPlaying(true);
        } catch (e) {
            showToast(REPLAY ? e.message : `Backend indisponível para a simulação (${e.message}). Inicie o backend (iniciar-local.bat).`, 'error');
        } finally {
            setRecoveryBusy(false);
        }
    };
    // volta às falhas originais (ao refazer ou fechar) sem apagar a análise corretiva
    const resetRecovery = () => {
        if (recovery) applyRemaining(recovery.original);
        setRecovery(null); setRecoveryPlaying(false);
    };
    const closeRecovery = () => { resetRecovery(); setRecoveryOpen(false); };
    const setRecoveryIndex = (i) => setRecovery(r => (r ? { ...r, index: i } : r));
    // o diagrama acompanha o passo exibido
    useEffect(() => {
        if (recovery) applyRemaining(eventRemaining(recovery.data, recovery.index));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recovery?.index, recovery?.data]);
    useEffect(() => {
        if (!recovery || !recoveryPlaying) return undefined;
        if (recovery.index >= recovery.data.events.length - 1) { setRecoveryPlaying(false); return undefined; }
        const t = setTimeout(() => setRecovery(r => (r ? { ...r, index: r.index + 1 } : r)), 900);
        return () => clearTimeout(t);
    }, [recovery, recoveryPlaying]);

    // reprodução: pré-falta -> pós-falta -> com plano
    useEffect(() => {
        if (!corrective || !correctivePlaying) return undefined;
        const ordem = ['pre', 'postFault', 'after'];
        const i = ordem.indexOf(corrective.stage);
        if (i >= ordem.length - 1) { setCorrectivePlaying(false); return undefined; }
        const t = setTimeout(() => setCorrective(c => (c ? { ...c, stage: ordem[i + 1] } : c)), 2400);
        return () => clearTimeout(t);
    }, [corrective, correctivePlaying]);
    
    const { handleMatpowerFileUpload } = useFileImport({
        showToast,
        setIsCalculatingLayout, 
        setLayoutProgress,
        applySystemData // Passamos o Motor para o importador.
    });

    const toggleSwitch = (branchId) => {

        setBranches(prev => prev.map(b => b.id === branchId ? { ...b, state: b.state === 1 ? 0 : 1 } : b));
        showToast('Chave alterada', 'success');
    };

    const toggleGD = useCallback((nodeId) => {
        setSystemGD(prev => {
            if (!prev[nodeId]) return prev;
            return { ...prev, [nodeId]: { ...prev[nodeId], active: !prev[nodeId].active } };
        });
        // Lixo removido daqui!
    }, []);

    // Função para ajustar o valor da Geração Distribuída dinamicamente
    const handleGDChange = useCallback((nodeId, field, increment) => {
        setSystemGD(prev => {
            const gd = prev[nodeId];
            if (!gd) return prev;
            
            let newPg = gd.pg;
            let newQg = gd.qg;
            const sMax = gd.sMax || 0;

            if (field === 'pg') {
                newPg += increment;
                
                // Trava Mínima e Máxima para a Potência Ativa (P)
                if (newPg < 0) newPg = 0;
                if (newPg > sMax) newPg = sMax;
                
                // 🛡️ Restrição Elíptica para Q: Qmax = sqrt(Smax² - P²)
                // Re-clampa o Q automaticamente se o novo P roubar espaço aparente
                const qLimit = Math.sqrt(Math.max(0, sMax ** 2 - newPg ** 2));
                if (newQg > qLimit) newQg = qLimit;
                if (newQg < -qLimit) newQg = -qLimit;
                
            } else if (field === 'qg') {
                newQg += increment;
                
                // 🛡️ Restrição Elíptica baseada no P atual da máquina
                const qLimit = Math.sqrt(Math.max(0, sMax ** 2 - newPg ** 2));
                
                // Trava Mínima e Máxima para a Potência Reativa (Q) permitindo valores negativos
                if (newQg > qLimit) newQg = qLimit;
                if (newQg < -qLimit) newQg = -qLimit;
            }
            
            // Se nenhum valor foi efetivamente alterado (já estava no limite), ignora
            if (newPg === gd.pg && newQg === gd.qg) return prev; 
            
            return {
                ...prev,
                [nodeId]: { ...gd, pg: newPg, qg: newQg }
            };
        });
        
        // 🚨 IMPORTANTE: O "setLastEventNodes" foi banido do código!
    }, []);

    const handleTapChange = useCallback((branchId, increment) => {

        // 👇 MODO AO VIVO 👇
        setBranches(prev => prev.map(b => {
            if (b.id === branchId && b.isRegulator) {
                let newTap = b.currentTap + increment;
                if (newTap > b.maxTaps) newTap = b.maxTaps;
                if (newTap < -b.maxTaps) newTap = -b.maxTaps;
                return { ...b, currentTap: newTap };
            }
            return b;
        }));
    }, []);

    const handleShuntChange = useCallback((nodeId, increment) => {

        // MODO AO VIVO
        setSystemShunts(prev => {
            const shunt = prev[nodeId];
            if (!shunt) return prev;
            
            let newSteps = shunt.steps + increment;
            if (newSteps < 0) newSteps = 0;
            if (newSteps > shunt.maxSteps) newSteps = shunt.maxSteps;
            
            if (newSteps === shunt.steps) return prev; // Nada mudou
            
            return {
                ...prev,
                [nodeId]: { ...shunt, steps: newSteps }
            };
        });
    }, []);
    
    const toggleFault = (nodeId) => {

        if (faultNodes.has(nodeId)) {
            setFaultNodes(prev => { const newSet = new Set(prev); newSet.delete(nodeId); return newSet; });
            showToast(`Falta removida da barra ${nodeId}`, 'success');
        } else {
            setFaultNodes(prev => { const newSet = new Set(prev); newSet.add(nodeId); return newSet; });
            
            setBranches(prevBranches => {
                const branchesToOpen = new Set();
                const visitedNodes = new Set([nodeId]);
                const queue = [nodeId];

                while (queue.length > 0) {
                    const curr = queue.shift();
                    const connected = prevBranches.filter(b => b.state === 1 && (b.from === curr || b.to === curr));
                    connected.forEach(b => {
                        const neighbor = b.from === curr ? b.to : b.from;
                        if (!visitedNodes.has(neighbor)) {
                            if (b.hasSwitch) { 
                                branchesToOpen.add(b.id); 
                            } else if (allBoundaryNodes.includes(neighbor)) {
                                // 👇 BARREIRA INTRANSPONÍVEL (AO VIVO): O barramento da Subestação não permite a falta passar! 👇
                                visitedNodes.add(neighbor);
                            } else { 
                                visitedNodes.add(neighbor); 
                                queue.push(neighbor); 
                            }
                        }
                    });
                }

                if (branchesToOpen.size > 0) {
                    showToast(`Proteção atuou! ${branchesToOpen.size} disjuntor(es) aberto(s) para isolar a falta.`, 'warning');
                    return prevBranches.map(b => branchesToOpen.has(b.id) ? { ...b, state: 0 } : b);
                } else {
                    showToast(`Atenção: Nenhum disjuntor encontrado para isolar a falta na barra ${nodeId}!`, 'error');
                    return prevBranches;
                }
            });
        }
    };

    const resetSystem = () => {
        if (window.confirm("Deseja remover as faltas e voltar as chaves para a posição inicial?")) {
            setFaultNodes(new Set());
            if (initialBranchesRef.current && initialBranchesRef.current.length > 0) {
                setBranches(JSON.parse(JSON.stringify(initialBranchesRef.current)));
            } else {
                setBranches(prev => prev.map(b => ({ ...b, state: 1 })));
            }
             showToast("Sistema reiniciado com sucesso!", "success");
        }
    };

    // Botões da Tela Inicial agora apenas chamam o carregador:
    const handleLoadCase118 = () => applySystemData(buildTransmissionSystem(CASE118, { layout: CASE118.layout, name: 'IEEE 118 (transmissão)', gridName: CASE118.name }), "IEEE 118 (transmissão)");

    const handleExportFullState = useCallback((positions, waypoints) => {
        const exportData = {
            version: "1.0", systemName: "Sistema Salvo", Vbase: vBase, Sbase: sBase,
            constraints: { vMin: vMinLimit, vMax: vMaxLimit },
            sources: activeSources, 
            feeders: systemFeeders,
            sses: sses,
            shunts: systemShunts,
            loads: systemLoads,
            gd: systemGD, // 👈 Salva a GD no JSON
            branches: branches, 
            faults: Array.from(faultNodes), 
            layout: { positions: positions, waypoints: waypoints, geoPositions: geoPositions, routes: routedPaths, manualWaypoints: manualWaypoints, straightSegments: straightSegments }
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr); downloadAnchorNode.setAttribute("download", "meu_sistema_salvo.json");
        document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove();
        showToast("Projeto exportado com sucesso!", "success");
    }, [branches, faultNodes, sources]);

    useEffect(() => {
        const handleApplyFullState = (e) => {
            const data = e.detail;
            
            if (data.feeders) setSystemFeeders(data.feeders);
            if (data.sses) setSses(data.sses);
            if (data.shunts) setSystemShunts(data.shunts);
            if (data.gd) setSystemGD(data.gd);

            if (data.branches) setBranches(data.branches);
            if (data.faults) setFaultNodes(new Set(data.faults));
            
            const layoutData = data.layout || data;

            // 👇 1. PROTEÇÃO DO MODO MACRO (ESQUELETO) 👇
            if (macroGraph) {
                if (layoutData.positions) {
                    setMacroGraph(prev => ({ ...prev, positions: layoutData.positions }));
                }
                return; // 👈 Impede que as posições originais sejam sobrescritas pelas "amassadas"
            }

            // 👇 2. ATUALIZAÇÃO NORMAL 👇
            if (layoutData.positions) {
                if (layoutMode === 'organic') setOrganicPositions(layoutData.positions);
                else setProjectPositions(layoutData.positions);
            }
            if (layoutData.waypoints) {
                if (layoutMode === 'organic') setOrganicWaypoints(layoutData.waypoints);
                else setProjectWaypoints(layoutData.waypoints);
            }
        };
        
        window.addEventListener('applyGraphLayout', handleApplyFullState);
        return () => window.removeEventListener('applyGraphLayout', handleApplyFullState);
        
    }, [layoutMode, macroGraph]); // 👈 IMPORTANTE: Adicione o macroGraph aqui no array!

    useEffect(() => {
        const handleApplyOrganic = (e) => { 
            setOrganicPositions(e.detail.positions); 
            if (e.detail.waypoints) setOrganicWaypoints(e.detail.waypoints);
            setLayoutMode('organic'); 
        };
        window.addEventListener('applyOrganicLayout', handleApplyOrganic);
        return () => window.removeEventListener('applyOrganicLayout', handleApplyOrganic);
    }, []);

    useEffect(() => {
        const handleBeforeUnload = (e) => { if (isProjectLoaded) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => { window.removeEventListener('beforeunload', handleBeforeUnload); };
    }, [isProjectLoaded]);

    const handleExportSVG = () => { 
        exportSVG('sistema-eletrico-svg', 'diagrama_sistema.svg', calcMethod, sources, systemFeeders, darkMode); 
        showToast('Diagrama vetorizado baixado!', 'success'); 
    };
    
    const handleExportPDF = () => { 
        setSelectedElement(null); setTimeout(() => window.print(), 100); 
    };

    useShortcuts({ 
        setShowShortcuts, setPrintFrameMode, setDarkMode, setShowLabels, 
        setCalcMethod, resetSystem, setIsEditMode, handleUndoLayout,
        handleExportSVG 
    });

    if (!isProjectLoaded) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', backgroundColor: darkMode ? '#121212' : '#f0f2f5', color: darkMode ? '#ffffff' : '#333333', fontFamily: 'sans-serif', transition: 'background-color 0.3s' }}>
                <button onClick={() => setDarkMode(!darkMode)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer' }}> {darkMode ? '☀️' : '🌙'} </button>
                <div style={{ background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255, 255, 255, 0.9)', padding: '50px 40px', borderRadius: '16px', boxShadow: darkMode ? '0 10px 40px rgba(0,0,0,0.5)' : '0 10px 40px rgba(0,0,0,0.1)', backdropFilter: 'blur(10px)', textAlign: 'center', maxWidth: '450px', width: '90%', border: darkMode ? '1px solid #333' : '1px solid #fff' }}>
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>⚡</div>
                    <h1 style={{ margin: '0 0 10px 0', fontSize: '22px', color: darkMode ? '#eee' : '#222' }}>Simulador de Sistemas de Potência</h1>
                    <p style={{ margin: '0 0 30px 0', fontSize: '14px', color: darkMode ? '#aaa' : '#666', lineHeight: '1.5' }}>Motor genérico para simulação e visualização de fluxo de carga e atuação de proteção.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <button onClick={handleLoadCase118} style={{ width: '100%', padding: '14px', border: `1px solid ${darkMode ? '#444' : '#ccc'}`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: '#ffb300', transition: 'background 0.2s' }} onMouseOver={e => e.target.style.background = darkMode ? '#333' : '#e0e0e0'} onMouseOut={e => e.target.style.background = 'transparent'}> ⚡ Iniciar IEEE 118 (transmissão) </button>
                        <div style={{ margin: '15px 0', display: 'flex', alignItems: 'center', color: darkMode ? '#555' : '#aaa' }}><div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div><span style={{ padding: '0 10px', fontSize: '12px' }}> OU </span><div style={{ flex: 1, height: '1px', background: darkMode ? '#444' : '#ddd' }}></div></div>
                        <input type="file" ref={matFileInputRef} accept=".m" style={{ display: 'none' }} onChange={handleMatpowerFileUpload} />
                        <button onClick={() => matFileInputRef.current.click()} style={{ width: '100%', padding: '14px', border: `1px solid #ffb300`, borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', background: 'transparent', color: '#ffb300' }}> 📥 Importar caso MATPOWER (.m) — transmissão </button>
                    </div>
                </div>

                {isCalculatingLayout && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', backdropFilter: 'blur(5px)' }}>
                        <div style={{ fontSize: '50px', animation: 'spin 2s linear infinite', marginBottom: '20px' }}>⚙️</div>
                        <h2 style={{ color: '#00bcd4', marginBottom: '10px' }}>{layoutProgress.msg1}</h2>
                        <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>{layoutProgress.msg2}</p>
                        
                        <div style={{ width: '300px', height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, (layoutProgress.passes / 30) * 100)}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                        </div>
                        <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Iteração {layoutProgress.passes} de 30</p>
                        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="app-container">
            <style>
                {`
                .app-container { display: flex !important; flex-direction: row !important; width: 100vw; height: 100vh; overflow: hidden; background-color: ${darkMode ? '#121212' : '#f0f2f5'}; }
                .graph-wrapper { flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; background-color: ${printFrameMode !== 'none' ? (darkMode ? '#080808' : '#cfd3d6') : 'transparent'}; transition: background-color 0.3s ease; }
                .right-panel-wrapper { position: relative; width: ${isFaultSidebarOpen ? '230px' : '0px'}; transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1); flex-shrink: 0; border-left: ${isFaultSidebarOpen ? '1px solid #333' : 'none'}; }
                .right-panel-wrapper > div.panel-content { position: absolute !important; left: 0 !important; top: 0 !important; width: 230px !important; height: 100vh !important; overflow: hidden; background: ${darkMode ? '#1e1e1e' : '#fff'}; }
                .tool-btn:hover { background-color: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}; transform: translateY(-1px); }
                .tool-btn:active { transform: translateY(1px); }
                @media print {
                    @page { size: ${printFrameMode === 'portrait' ? 'portrait' : 'landscape'}; margin: 0mm; }
                    body, html, .app-container { width: 100% !important; height: 100% !important; margin: 0 !important; display: block !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important; }
                    .hide-on-print { display: none !important; }
                    .graph-wrapper { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: transparent !important; display: block !important; }
                    .graph-wrapper, .graph-svg, .graph-svg text {user-select: none !important; -webkit-user-select: none !important; -moz-user-select: none !important; -ms-user-select: none !important; }
                    .paper-container { position: absolute !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; border: none !important; box-shadow: none !important; aspect-ratio: auto !important; background-color: ${darkMode ? '#121212' : '#ffffff'} !important;}
                    .graph-svg { width: 100% !important; height: 100% !important; }
                }
                .voltage-glow-wrapper { filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.9)); transition: filter 0.4s ease-in-out; }
                `}
            </style>

            <div className="hide-on-print" style={{ borderRight: '1px solid #333', zIndex: 100 }}>
                {!isEditMode ? (
                    <Sidebar 
                        sidebarMode={sidebarMode} 
                        darkMode={darkMode} 
                        setDarkMode={setDarkMode} 
                        resetSystem={resetSystem} 
                        maintenanceMode={maintenanceMode} 
                        setMaintenanceMode={setMaintenanceMode} 
                        showLabels={showLabels} 
                        setShowLabels={setShowLabels} 
                        selectedElement={displayElement} 
                        sources={sources} 
                        loads={loads} 
                        faultNodes={faultNodes} 
                        branches={branches} 
                        toggleSwitch={toggleSwitch} 
                        setSelectedElement={setSelectedElement} 
                        setHoveredLineId={setHoveredLineId} 
                        calcMethod={transmission ? (solverMode === 'ac' ? (backendStatus === 'offline' ? 'DC*' : 'AC') : 'DC') : calcMethod} 
                        transmission={transmission} 
                        nodeColorMode={nodeColorMode} 
                        setNodeColorMode={setNodeColorMode} 
                        voltageAvailable={solverMode === 'ac' && backendStatus === 'online'} 
                        setCalcMethod={transmission ? () => setSolverMode(m => (m === 'ac' ? 'dc' : 'ac')) : setCalcMethod} 
                        solverTitle={transmission ? (solverMode === 'ac' ? (backendStatus === 'online' ? `AC no backend (${backendMsg}). Clique para voltar ao DC local.` : (backendStatus === 'offline' ? `Backend indisponível: ${backendMsg}. Mostrando DC local (*). Clique para voltar ao DC.` : 'Consultando o backend...')) : 'DC local (JavaScript). Clique para usar o AC do backend.') : ''} 
                        onExportSVG={handleExportSVG} 
                        onExportPDF={handleExportPDF} 
                        getNodeColor={getNodeColor} 
                        getEdgeColor={getEdgeColor} 
                        systemSize={Math.max(0, allNodes.length)} 
                        disconnectedStats={disconnectedStats} 
                        lineCurrents={lineCurrents} 
                        feedersList={systemFeeders}
                        nodeData={nodeData}
                        systemLoads={systemLoads}
                        systemShunts={systemShunts}
                        setViewMode={setViewMode}
                        sBase={sBase}
                        sses={sses}
                        handleTapChange={handleTapChange}
                        handleShuntChange={handleShuntChange}
                        viewMode={viewMode}
                        vBase={vBase} 
                        systemGD={systemGD}
                        toggleGD={toggleGD}
                        handleGDChange={handleGDChange}
                    />
                ) : (
                    <EditSidebar 
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        darkMode={darkMode} 
                        onUndo={handleUndoLayout} 
                        canUndo={layoutHistory.length > 0} 
                        onReset={handleResetToOriginalLayout} 
                        branches={branches} 
                        allNodes={allNodes} 
                        sources={sources} 
                        currentPositions={activePositions}
                        setIsCalculatingLayout={setIsCalculatingLayout}
                        setLayoutProgress={setLayoutProgress}
                    />
                )}
            </div>

            {macroGraph && (
                <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, background: '#ff5722', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', display: 'flex', gap: '15px', alignItems: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
                    <span>⚠️ Modo de Depuração: Grafo Compactado (Coarsening)</span>
                    
                    {/* 👇 BOTÃO DE APLICAR (A MÁGICA) 👇 */}
                    <button 
                        onClick={() => {
                            const basePos = layoutMode === 'organic' ? (organicPositions || projectPositions) : projectPositions;
                            
                            let coarseInfo = macroGraph.macroData?.coarseData;
                            
                            // Blindagem 1: Recálculo Determinístico
                            if (!coarseInfo || (!coarseInfo.prunedMap && !coarseInfo.chainMap)) {
                                console.log("⚙️ Reconstruindo mapa de poda do esqueleto...");
                                const contraction = contractTopology(allNodes, branches, sources);
                                coarseInfo = contraction.coarseData;
                            }
                            
                            // Desdobra o esqueleto de volta para os 54 nós
                            const newFullPositions = expandTopology(
                                macroGraph.positions,
                                coarseInfo, 
                                basePos
                            );

                            
                            // 👇 BLINDAGEM 2: Prevenção de Abismo
                            const safeFullPositions = { ...basePos, ...newFullPositions };
                            
                            // 👇 O TOQUE DE MESTRE DA ENGENHARIA 👇
                            const skeletonIds = Object.keys(macroGraph.positions);
                            
                            // ❌ Removemos a captura das sanfonas daqui! 
                            // Agora SOMENTE as âncoras do Esqueleto ganham "chumbo nos pés"
                            const fixedIds = [...skeletonIds];
                            
                            // Roda a física RESTRITA (agora passando o coarseInfo)
                            const finalRelaxedPositions = relaxExpandedNodes(
                                safeFullPositions, 
                                fixedIds, // Apenas esqueleto travado
                                allNodes, 
                                branches,
                                coarseInfo // 👈 IMPORTANTE: Passe a memória da poda aqui!
                            );
                            
                            // Salva no estado oficial as posições RELAXADAS
                            if (layoutMode === 'organic') {
                                setOrganicPositions(finalRelaxedPositions);
                            } else {
                                setProjectPositions(finalRelaxedPositions);
                            }
                            
                            // Encerra o modo de depuração
                            setMacroGraph(null);
                        }} 
                        style={{ background: '#4caf50', color: '#fff', border: 'none', borderRadius: '15px', padding: '5px 15px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }} 
                        onMouseOver={e => e.target.style.transform='scale(1.05)'} 
                        onMouseOut={e => e.target.style.transform='scale(1)'}
                    >
                        ✔ Expandir e Salvar
                    </button>

                    {/* 👇 BOTÃO DE DESCARTAR 👇 */}
                    <button 
                        onClick={() => setMacroGraph(null)} 
                        style={{ background: '#fff', color: '#ff5722', border: 'none', borderRadius: '15px', padding: '5px 15px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }} 
                        onMouseOver={e => e.target.style.transform='scale(1.05)'} 
                        onMouseOut={e => e.target.style.transform='scale(1)'}
                    >
                        ❌ Descartar
                    </button>
                </div>
            )}

            <div className="graph-wrapper">
                {/* ... Botões flutuantes mantidos ... */}
                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', top: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px', borderRadius: '14px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Menu Esquerdo" onClick={() => {if (isEditMode) setIsEditMode(false); else setSidebarMode(p => p === 'full' ? 'mini' : (p === 'mini' ? 'hidden' : 'full'))}}>≡</button>
                    <div style={{ height: '1px', width: '70%', margin: '2px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: isEditMode ? '#ff9800' : (darkMode ? '#fff' : '#333'), transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Modo Edição" onClick={() => setIsEditMode(!isEditMode)}>✏️</button>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Atalhos" onClick={() => setShowShortcuts(true)}>⌨️</button>
                    
                </div>

                <div className="hide-on-print" style={{ background: darkMode ? 'rgba(30, 30, 30, 0.65)' : 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', position: 'absolute', bottom: '20px', left: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', padding: '12px 6px', borderRadius: '20px' }}>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px' }} title="Centralizar Gráfico" onClick={() => window.dispatchEvent(new CustomEvent('triggerZoomExtents'))}>🎯</button>
                    <div style={{ height: '1px', width: '60%', margin: '4px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', flexDirection: 'column' }} title="Alternar Folha / Tela Cheia" onClick={() => setPrintFrameMode(prev => prev === 'none' ? 'landscape' : (prev === 'landscape' ? 'portrait' : 'none'))}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: printFrameMode !== 'none' ? '#ff9800' : 'inherit' }}>A4</span>
                        <span style={{ opacity: 0.8, fontSize: '10px' }}>{printFrameMode === 'none' ? '🔲' : (printFrameMode === 'landscape' ? '↔' : '↕')}</span>
                    </button>
                    <div style={{ height: '1px', width: '60%', margin: '4px auto', background: darkMode ? '#555' : '#e0e0e0' }}></div>
                    <button className="tool-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: darkMode ? '#fff' : '#333', transition: 'all 0.2s ease', minWidth: '40px', minHeight: '40px', opacity: showLegend ? 1 : 0.4 }} title="Mostrar/Ocultar Legenda" onClick={() => setShowLegend(!showLegend)}>👁️</button>
                </div>

                {printFrameMode !== 'none' && (
                    <div className="hide-on-print" style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 9000, background: '#ff9800', color: '#000', padding: '6px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}> Visualização de Impressão: {printFrameMode === 'landscape' ? 'Paisagem' : 'Retrato'} (Ctrl+P para Imprimir) </div>
                )}

                {/* 👇 COLE O NOVO PAINEL AQUI 👇 */}
                {/* PAINEL DE POLIMENTO DE LAYOUT (SÓ APARECE NO MODO EDIÇÃO) */}
                {isEditMode && (
                    <div className="hide-on-print" style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', gap: '15px', alignItems: 'center', background: darkMode ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255,255,255,0.8)', padding: '10px 20px', borderRadius: '30px', backdropFilter: 'blur(10px)', border: `1px solid ${darkMode ? '#444' : '#ddd'}`, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                        
                        {/* Indicador de Cruzamentos (Agora é um botão interativo) */}
                        <button 
                            onClick={() => setShowCrossings(!showCrossings)}
                            title="Mostrar/Ocultar marcadores de cruzamento"
                            style={{ 
                                background: intersections.length > 0 ? (showCrossings ? '#f44336' : '#d32f2f') : '#4caf50', 
                                color: '#fff', 
                                padding: '6px 12px', 
                                borderRadius: '20px', 
                                fontSize: '12px', 
                                fontWeight: 'bold', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '5px',
                                border: 'none',
                                cursor: intersections.length > 0 ? 'pointer' : 'default',
                                transition: 'all 0.2s',
                                opacity: showCrossings || intersections.length === 0 ? 1 : 0.6
                            }}
                            onMouseOver={e => intersections.length > 0 && (e.target.style.transform='scale(1.05)')}
                            onMouseOut={e => intersections.length > 0 && (e.target.style.transform='scale(1)')}
                        >
                            {intersections.length > 0 
                                ? `⚠️ ${intersections.length} Cruzamentos ${showCrossings ? '(Ocultar)' : '(Mostrar)'}` 
                                : '✅ Sem Cruzamentos'}
                        </button>

                        {/* Motor Compactador */}
                        <button 
                            onClick={() => {
                                const newPos = compactPositions(activePositions, 0.90); // 0.90 = Encolhe 10%
                                if (layoutMode === 'organic') setOrganicPositions(newPos);
                                else setProjectPositions(newPos);
                            }}
                            title="Aproxima as barras em 10% para o centro"
                            style={{ background: '#00bcd4', color: '#000', border: 'none', borderRadius: '20px', padding: '6px 15px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseOver={e => e.target.style.transform='scale(1.05)'}
                            onMouseOut={e => e.target.style.transform='scale(1)'}
                        >
                            🗜️ Compactar (10%)
                        </button>

                        {/* Motor Expansor (NOVO) */}
                        <button 
                            onClick={() => {
                                const newPos = compactPositions(activePositions, 1.10); // 1.10 = Expande 10%
                                if (layoutMode === 'organic') setOrganicPositions(newPos);
                                else setProjectPositions(newPos);
                            }}
                            title="Afasta as barras em 10% a partir do centro"
                            style={{ background: '#00bcd4', color: '#000', border: 'none', borderRadius: '20px', padding: '6px 15px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'transform 0.2s' }}
                            onMouseOver={e => e.target.style.transform='scale(1.05)'}
                            onMouseOut={e => e.target.style.transform='scale(1)'}
                        >
                            🌌 Expandir (10%)
                        </button>
                    </div>
                )}
                {/* 👆 FIM DO PAINEL 👆 */}

                {/* 👇 A MÁGICA ACONTECE AQUI: ALTERNÂNCIA DE TELAS 👇 */}
                {viewMode === 'schematic' ? (
                    <GraphArea 
                        darkMode={darkMode}
                        printFrameMode={printFrameMode} 
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        branches={macroGraph?.macroData?.branches || branches} 
                        allNodes={macroGraph?.macroData?.nodes || allNodes} 
                        sources={sources} showLabels={showLabels} 
                        getEdgeColor={getEdgeColor} 
                        getEdgeWidth={getEdgeWidth} 
                        generatorBuses={generatorBuses} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        selectedElement={selectedElement} 
                        hoveredLineId={effectiveHoveredLineId} 
                        setHoveredLineId={setHoveredLineId} 
                        hoveredNodeId={hoveredNodeId} 
                        setHoveredNodeId={setHoveredNodeId} 
                        maintenanceMode={maintenanceMode} 
                        activePositions={activePositions} 
                        activeWaypoints={activeWaypoints} 
                        lineCurrents={lineCurrents} 
                        nodeData={nodeData} 
                        nodeFeeds={nodeFeeds}
                        isEditMode={isEditMode} 
                        setIsEditMode={setIsEditMode} 
                        onSaveLayoutToHistory={saveLayoutToHistory} 
                        loads={loads} systemLoads={systemLoads} 
                        onExportRequest={handleExportFullState} 
                        sses={sses} 
                        feedersList={systemFeeders} 
                        handleTapChange={handleTapChange}
                        systemShunts={systemShunts} 
                        handleShuntChange={handleShuntChange}
                        systemGD={systemGD}    // 👈 Adicione esta linha
                        toggleGD={toggleGD}    // 👈 Adicione esta linha (se for usar dentro do GraphArea)
                        intersections={intersections}
                        showCrossings={showCrossings}
                        vMinLimit={vMinLimit}
                        vMaxLimit={vMaxLimit}
                    >
                        {showLegend && (
                            <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                                <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                    <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                    <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                        <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> PROJETO </button>
                                        <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGÂNICO </button>
                                    </div>
                                </div>
                                
                                {sources.map(s => (
                                    <div key={s} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...systemFeeders], darkMode) }}></div> {transmission ? 'Barra de referência' : `SUB ${s}`}</div>
                                ))}
                                {systemFeeders.map(f => (
                                    <div key={f} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...systemFeeders], darkMode) }}></div> ALIM {f}</div>
                                ))}

                                {transmission && (<div className="legend-item"><svg width="14" height="14" viewBox="-7 -7 14 14"><polygon points="0,-6 6,0 0,6 -6,0" fill="#5b8bd6" /></svg> Gerador</div>)}
                                {shedNodes && (<div className="legend-item"><div className="legend-dot" style={{ background: '#ff8f00' }}></div> Carga cortada</div>)}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                                {transmission && (<div className="legend-item" title="Carregamento da linha em % do limite térmico (rateA); a linha também engrossa com a carga"><div style={{ width: 54, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, rgb(74,120,194), rgb(110,185,235) 50%, rgb(236,236,226) 68%, rgb(255,210,63) 82%, rgb(255,122,26) 95%, rgb(213,0,0))' }}></div> Carga 0 → 100%</div>)}
                                {voltageMode && (<div className="legend-item" title="Tensão da barra: azul = baixa, claro = 1,0 pu, vermelho = alta (limites do caso)"><div style={{ width: 54, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, rgb(33,102,172), rgb(236,236,236), rgb(178,24,43))' }}></div> Tensão (barras)</div>)}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                            </div>
                        )}
                    </GraphArea>
                ) : (
                    <MapArea 
                        darkMode={darkMode}
                        branches={branches} 
                        sources={sources} 
                        feedersList={systemFeeders} 
                        sses={sses}
                        getEdgeColor={getEdgeColor} 
                        getNodeColor={getNodeColor} 
                        toggleSwitch={toggleSwitch} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        nodeData={nodeData}
                        lineCurrents={lineCurrents}
                        isEditMode={isEditMode}
                        systemShunts={systemShunts}
                        hoveredLineId={hoveredLineId}
                        setHoveredLineId={setHoveredLineId}
                        hoveredNodeId={hoveredNodeId}
                        setHoveredNodeId={setHoveredNodeId}
                        loads={loads}
                        systemLoads={systemLoads}
                        allNodes={allNodes}
                        svgPositions={activePositions}
                        geoPositions={geoPositions}
                        setGeoPositions={setGeoPositions}
                        routedPaths={routedPaths}
                        setRoutedPaths={setRoutedPaths}
                        manualWaypoints={manualWaypoints}
                        setManualWaypoints={setManualWaypoints}
                        straightSegments={straightSegments}
                        setStraightSegments={setStraightSegments}
                        systemGD={systemGD}
                        toggleGD={toggleGD}
                    >
                        {/* 👇 A LEGENDA AGORA É ENVIADA PARA DENTRO DO MAPA 👇 */}
                        {showLegend && (
                            <div className="legend" style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 1000, pointerEvents: 'all', background: darkMode ? '#121212' : '#ffffff', border: '1px solid #444', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.2)' }} onMouseDown={e=>e.stopPropagation()} onMouseUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} >
                                <div style={{marginBottom:'10px', paddingBottom:'8px', borderBottom:'1px solid #444'}}>
                                    <div style={{fontSize:'9px', color:'#888', fontWeight:'bold', marginBottom:'4px', letterSpacing:'1px'}}>LAYOUT</div>
                                    <div style={{display:'flex', gap:'2px', background:'#222', padding:'2px', borderRadius:'4px'}}>
                                        <button onClick={() => setLayoutMode('project')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'project' ? '#00bcd4' : 'transparent', color: layoutMode === 'project' ? '#000' : '#666', transition: 'all 0.2s' }}> PROJETO </button>
                                        <button onClick={() => setLayoutMode('organic')} style={{ flex:1, border:'none', borderRadius:'2px', padding:'4px', cursor:'pointer', fontSize:'10px', fontWeight:'bold', background: layoutMode === 'organic' ? '#00bcd4' : 'transparent', color: layoutMode === 'organic' ? '#000' : '#666', transition: 'all 0.2s' }}> ORGÂNICO </button>
                                    </div>
                                </div>
                                {sources.map(s => (
                                    <div key={s} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(s, [...sources, ...systemFeeders], darkMode) }}></div> SUB {s}</div>
                                ))}
                                {systemFeeders.map(f => (
                                    <div key={f} className="legend-item"><div className="legend-dot" style={{ background: getBaseColor(f, [...sources, ...systemFeeders], darkMode) }}></div> ALIM {f}</div>
                                ))}
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.fault }}></div> Falta/Sobrecarga</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.loop }}></div> Loop</div>
                                <div className="legend-item"><div className="legend-dot" style={{ background: THEME.light.de }}></div> Desenergizado</div>
                            </div>
                        )}
                    </MapArea>
                )}
            </div>

            <div className="hide-on-print right-panel-wrapper" style={{ zIndex: 100 }}>
                <div onClick={() => setFaultSidebarOpen(!isFaultSidebarOpen)} title={isFaultSidebarOpen ? "Ocultar Painel" : "Diretório de Elementos"} style={{ position: 'absolute', left: '-28px', top: 'calc(50% - 35px)', width: '28px', height: '70px', background: darkMode ? '#1e1e1e' : '#fff', borderTop: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderBottom: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderLeft: `1px solid ${darkMode ? '#333' : '#ccc'}`, borderRadius: '12px 0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', color: '#ff9800', zIndex: 101, transition: 'background-color 0.2s' }}> {isFaultSidebarOpen ? '▶' : '⚡'} </div>
                <div className="panel-content">
                    <FaultPanel 
                        isFaultSidebarOpen={isFaultSidebarOpen} 
                        setFaultSidebarOpen={setFaultSidebarOpen} 
                        sources={sources} 
                        loadNodes={loadNodes} 
                        faultNodes={faultNodes} 
                        nodeFeeds={nodeFeeds} 
                        toggleFault={toggleFault} 
                        setSelectedElement={setSelectedElement} 
                        selectedElement={displayElement} 
                        setHoveredNodeId={setHoveredNodeId} 
                        getNodeColor={getNodeColor} 
                        darkMode={darkMode} 
                        THEME={THEME} 
                        branches={branches} 
                        feedersList={systemFeeders}
                        
                        // 👇 ADICIONADO PARA A LISTA DE CHAVES QUE AGORA FICA AQUI 👇
                        toggleSwitch={toggleSwitch}
                        setHoveredLineId={setHoveredLineId}
                        loopNodes={loopNodes}
                    />
                </div>
            </div>

            {showShortcuts && (
                <div className="hide-on-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setShowShortcuts(false)}>
                    <div style={{ background: darkMode ? '#222' : '#fff', color: darkMode ? '#fff' : '#000', padding: '25px', borderRadius: '12px', width: '350px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #555', paddingBottom: '10px' }}>Atalhos de Teclado</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '2' }}>
                            <li><strong style={{ color: '#00bcd4' }}>Clique (Chave)</strong> - Abrir/Fechar Chave</li>
                            <li><strong style={{ color: '#00bcd4' }}>Clique (Barra)</strong> - Inserir/Remover Falta</li>
                            <li><strong style={{ color: '#ff9800' }}>Ctrl + Clique</strong> - Inspecionar Elemento (Seleção Fixa)</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Clique</strong> - Fixar/Desafixar Tooltip (Post-it)</li>
                            <li><strong style={{ color: '#ff9800' }}>Shift + Arrastar Fundo</strong> - Seleção Múltipla (Modo Edição)</li>
                            <li><strong style={{ color: '#ff9800' }}>Duplo Clique (Linha)</strong> - Criar/Remover Joelho (Modo Edição)</li>
                            <hr style={{ borderColor: '#444', margin: '8px 0' }} />
                            <li><strong style={{ color: '#4caf50' }}>Z</strong> - Centralizar Diagrama na Tela</li>
                            <li><strong style={{ color: '#4caf50' }}>P</strong> - Alterar Paisagem/Retrato (Impressão)</li>
                            <li><strong style={{ color: '#4caf50' }}>Ctrl + P</strong> - Imprimir / Salvar PDF</li>
                            <li><strong style={{ color: '#4caf50' }}>E</strong> - Entrar/Sair do Modo de Edição</li>
                            <li><strong style={{ color: '#4caf50' }}>D</strong> - Alternar Tema (Escuro/Claro)</li>
                            <li><strong style={{ color: '#4caf50' }}>L</strong> - Mostrar/Ocultar Labels</li>
                            <li><strong style={{ color: '#4caf50' }}>M</strong> - Alternar Método (NR / GS)</li>
                            <li><strong style={{ color: '#4caf50' }}>R</strong> - Reiniciar Sistema (Limpar Faltas)</li>
                        </ul>
                        <button onClick={() => setShowShortcuts(false)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: '#00bcd4', border: 'none', borderRadius: '6px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>Fechar</button>
                    </div>
                </div>
            )}
            
            
            {toast && <div className="toast">{toast.message}</div>}
            {REPLAY && transmission && (
                <div style={{ position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 950, background: 'rgba(255,143,0,0.95)', color: '#000', padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 'bold' }}
                    title="Resultados pré-calculados pelo backend (AC). Para analisar qualquer falha, rode o backend (README).">REPLAY · resultados pré-calculados (IEEE 118) · escolha as falhas na varredura N-1 📊</div>
            )}
            {transmission && !recoveryOpen && (
                <CorrectivePanel darkMode={darkMode} busy={correctiveBusy} data={corrective?.data || null} stage={corrective?.stage || 'pre'}
                    setStage={(s) => setCorrective(c => (c ? { ...c, stage: s } : c))} playing={correctivePlaying} setPlaying={setCorrectivePlaying}
                    onRun={runCorrective} onClear={clearCorrective} onOpenScreening={() => setScreeningOpen(true)} onOpenRecovery={() => setRecoveryOpen(true)} />
            )}
            {transmission && recoveryOpen && (
                <RecoveryPanel darkMode={darkMode} busy={recoveryBusy} items={currentFaultItems} order={repairOrder} setOrder={setRepairOrder}
                    options={recoveryOptions} setOptions={setRecoveryOptions} data={recovery?.data || null} index={recovery?.index || 0}
                    setIndex={setRecoveryIndex} playing={recoveryPlaying} setPlaying={setRecoveryPlaying}
                    onRun={runRecovery} onReset={resetRecovery} onClose={closeRecovery} />
            )}
            {transmission && screeningOpen && (
                <ScreeningPanel darkMode={darkMode} busy={screeningBusy} data={screening} genco={transmission.gridName === 'case118_ieee' ? SCREENING_118 : null}
                    onRun={runScreening} onClose={() => setScreeningOpen(false)} onSelect={selectContingency} />
            )}


            {/* 👇 TELA DE CARREGAMENTO DO WORKER 👇 */}
            {isCalculatingLayout && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', backdropFilter: 'blur(5px)' }}>
                    <div style={{ fontSize: '50px', animation: 'spin 2s linear infinite', marginBottom: '20px' }}>⚙️</div>
                    <h2 style={{ color: '#00bcd4', marginBottom: '10px' }}>{layoutProgress.msg1}</h2>
                    <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>{layoutProgress.msg2}</p>
                    
                    <div style={{ width: '300px', height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (layoutProgress.passes / 30) * 100)}%`, height: '100%', background: '#00bcd4', transition: 'width 0.3s' }}></div>
                    </div>
                    <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Iteração {layoutProgress.passes} de 30</p>
                    <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}
        </div>
    );
}

export default App;