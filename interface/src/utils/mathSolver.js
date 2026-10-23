/**
 * Solves a linear system Ax = b using Gaussian Elimination with Partial Pivoting.
 * @param {Array<Array<number>>} A - Square Matrix (N x N)
 * @param {Array<number>} b - Result vector (N)
 * @returns {Array<number>} x - Solution vector
 */
export function solveLinearSystem(A, b) {
    const n = A.length;
    // Creates copies so the originals are not changed
    const M = A.map(row => [...row]);
    const x = [...b];
    const map = new Array(n).fill(0).map((_, i) => i); // Permutation map

    for (let i = 0; i < n; i++) {
        // 1. Pivoting (find the largest value in the column to avoid division by zero)
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
                maxRow = k;
            }
        }

        // Swaps rows in the Matrix and in the Vector
        [M[i], M[maxRow]] = [M[maxRow], M[i]];
        [x[i], x[maxRow]] = [x[maxRow], x[i]];

        // 2. Elimination (zero out the elements below the pivot)
        for (let k = i + 1; k < n; k++) {
            // ANTI-NAN GUARD 2: if the pivot is zero, skips so the math does not blow up
            if (Math.abs(M[i][i]) < 1e-12) continue; 
            
            const factor = M[k][i] / M[i][i];
            x[k] -= factor * x[i];
            for (let j = i; j < n; j++) {
                M[k][j] -= factor * M[i][j];
            }
        }
    }

    // 3. Back Substitution
    const result = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
            sum += M[i][j] * result[j];
        }
        // ANTI-NAN GUARD 3: prevents NaN in the final result
        result[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : (x[i] - sum) / M[i][i]; 
    }

    return result;
}