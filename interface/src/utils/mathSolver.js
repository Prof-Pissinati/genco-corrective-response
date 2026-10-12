/**
 * Resolve um sistema linear Ax = b usando Eliminação Gaussiana com Pivoteamento Parcial.
 * @param {Array<Array<number>>} A - Matriz Quadrada (N x N)
 * @param {Array<number>} b - Vetor de resultados (N)
 * @returns {Array<number>} x - Vetor solução
 */
export function solveLinearSystem(A, b) {
    const n = A.length;
    // Cria cópias para não alterar os originais
    const M = A.map(row => [...row]);
    const x = [...b];
    const map = new Array(n).fill(0).map((_, i) => i); // Mapa de permutação

    for (let i = 0; i < n; i++) {
        // 1. Pivoteamento (Encontrar o maior valor na coluna para evitar divisão por zero)
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
                maxRow = k;
            }
        }

        // Troca linhas na Matriz e no Vetor
        [M[i], M[maxRow]] = [M[maxRow], M[i]];
        [x[i], x[maxRow]] = [x[maxRow], x[i]];

        // 2. Eliminação (Zerar elementos abaixo do pivô)
        for (let k = i + 1; k < n; k++) {
            // TRAVA ANTI-NAN 2: Se o pivô for zero, pula para não explodir a matemática
            if (Math.abs(M[i][i]) < 1e-12) continue; 
            
            const factor = M[k][i] / M[i][i];
            x[k] -= factor * x[i];
            for (let j = i; j < n; j++) {
                M[k][j] -= factor * M[i][j];
            }
        }
    }

    // 3. Substituição Regressiva (Back Substitution)
    const result = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
            sum += M[i][j] * result[j];
        }
        // TRAVA ANTI-NAN 3: Previne NaN no resultado final
        result[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : (x[i] - sum) / M[i][i]; 
    }

    return result;
}