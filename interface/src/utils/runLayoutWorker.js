// 1. Import the worker at the top of the file with Vite's special flag
import AutoLayoutWorker from "./layoutWorker.js?worker&inline";

// src/utils/runLayoutWorker.js
export function runAsyncLayout(type, nodesArray, branchesArray, sourcesArray, config = {}) {
    return new Promise((resolve, reject) => {
        // 1. Wakes up a new Web Worker
        const worker = new AutoLayoutWorker();
        const jobId = Date.now().toString();

        // 2. Strips functions from the Config (since functions break postMessage cloning)
        const { onProgress, ...safeConfig } = config;
        if (onProgress) safeConfig.reportProgress = true;

        // 3. Keeps listening to the radio waiting for a response
        worker.onmessage = (e) => {
            // 👇 We add macroData here in the variable extraction
            const { type: responseType, result, error, passes, msg1, msg2, jobId: responseJobId, macroData } = e.data;
            if (responseJobId !== jobId) return;

            if (responseType === 'progress' && onProgress) {
                onProgress(passes, msg1, msg2); // Updates the progress bar in React
            } else if (responseType === 'success') {
                // 👇 The double-package trick happens here 👇
                if (macroData) {
                    resolve({ positions: result, macroData: macroData });
                } else {
                    resolve(result);
                }
                worker.terminate(); // Fires the worker (frees RAM)
            } else if (responseType === 'error') {
                reject(new Error(error));
                worker.terminate();
            }
        };

        worker.onerror = (err) => {
            reject(err);
            worker.terminate();
        };

        // 4. Sends the data box to the parallel universe!
        worker.postMessage({ 
            type, nodesArray, branchesArray, sourcesArray, config: safeConfig, jobId 
        });
    });
}