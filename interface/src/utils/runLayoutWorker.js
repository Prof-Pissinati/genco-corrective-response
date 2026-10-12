// 1. Importe o worker no topo do arquivo com a flag mágica do Vite
import AutoLayoutWorker from "./layoutWorker.js?worker&inline";

// src/utils/runLayoutWorker.js
export function runAsyncLayout(type, nodesArray, branchesArray, sourcesArray, config = {}) {
    return new Promise((resolve, reject) => {
        // 1. Acorda um novo Web Worker
        const worker = new AutoLayoutWorker();
        const jobId = Date.now().toString();

        // 2. Retira funções do Config (pois funções quebram a clonagem do postMessage)
        const { onProgress, ...safeConfig } = config;
        if (onProgress) safeConfig.reportProgress = true;

        // 3. Fica ouvindo o rádio aguardando resposta
        worker.onmessage = (e) => {
            // 👇 Adicionamos o macroData aqui na extração de variáveis
            const { type: responseType, result, error, passes, msg1, msg2, jobId: responseJobId, macroData } = e.data;
            if (responseJobId !== jobId) return;

            if (responseType === 'progress' && onProgress) {
                onProgress(passes, msg1, msg2); // Atualiza barra de progresso no React
            } else if (responseType === 'success') {
                // 👇 A mágica do pacote duplo acontece aqui 👇
                if (macroData) {
                    resolve({ positions: result, macroData: macroData });
                } else {
                    resolve(result);
                }
                worker.terminate(); // Demite o operário (Libera RAM)
            } else if (responseType === 'error') {
                reject(new Error(error));
                worker.terminate();
            }
        };

        worker.onerror = (err) => {
            reject(err);
            worker.terminate();
        };

        // 4. Manda a caixa de dados para o universo paralelo!
        worker.postMessage({ 
            type, nodesArray, branchesArray, sourcesArray, config: safeConfig, jobId 
        });
    });
}