import { useCallback } from 'react';
import { runAsyncLayout } from '../utils/runLayoutWorker';
import { parseMatpower } from '../utils/matpowerParser';
import { buildTransmissionSystem } from '../utils/transmission';

export function useFileImport({
    showToast,
    setIsCalculatingLayout,
    setLayoutProgress,
    applySystemData // 👈 A Engine
}) {

    // Importação de caso MATPOWER (.m) -> modo transmissão (.m) -> modo transmissão
    const handleMatpowerFileUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const mpc = parseMatpower(event.target.result);
                const sys = buildTransmissionSystem(mpc, { name: file.name.replace(/\.m$/i, '') });

                if (setIsCalculatingLayout) setIsCalculatingLayout(true);
                if (setLayoutProgress) setLayoutProgress({ passes: 0, msg1: "Desenhando Diagrama...", msg2: "Calculando layout da rede de transmissão" });
                await new Promise(resolve => setTimeout(resolve, 50));
                const nodes = mpc.bus.map(r => r[0]);
                const autoPositions = await runAsyncLayout('force', nodes, sys.branches, sys.sources, {
                    distance: 40, charge: -120,
                    onProgress: (passes, msg1, msg2) => { if (setLayoutProgress) setLayoutProgress({ passes, msg1, msg2 }); }
                });
                if (setIsCalculatingLayout) setIsCalculatingLayout(false);

                sys.positionsProject = autoPositions;
                applySystemData(sys, `MATPOWER ${file.name}`);
                showToast(sys.transmission.dispatchAdjusted
                    ? `Caso ${file.name} importado (${nodes.length} barras). O despacho do arquivo não fecha com a carga e foi rebalanceado.`
                    : `Caso ${file.name} importado (${nodes.length} barras).`, "success");
            } catch (err) {
                if (setIsCalculatingLayout) setIsCalculatingLayout(false);
                alert("❌ Erro ao processar o arquivo MATPOWER: " + err.message);
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }, [applySystemData, showToast, setIsCalculatingLayout, setLayoutProgress]);

    return { handleMatpowerFileUpload };
}