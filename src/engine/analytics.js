// src/analytics.js
// Single Task: Trajectory RMSD Calculations

const _A = new Float64Array(16);
const _V = new Float64Array(16);
const _K = new Float64Array(16);

/**
 * Closed-form Horn unit-quaternion least-squares alignment and RMSD computation.
 * Superposes mobile coords onto refCoords using fitIndices, and computes RMSD on calcIndices.
 *
 * @param {Float32Array|Array<number>} coords - Mobile coordinate buffer (N * 3)
 * @param {Float32Array|Array<number>} refCoords - Reference coordinate buffer (N * 3)
 * @param {Array<number>} [fitIndices] - Atom indices used to compute superposition alignment
 * @param {Array<number>} [calcIndices] - Atom indices used to compute final RMSD (defaults to fitIndices)
 * @param {boolean} [needAlignedCoords=true] - If false, skips allocating alignedCoords and atom rotation outside calcIndices
 * @returns {{ rmsd: number, alignedCoords: Float32Array|null }}
 */
export function hornSuperpose(coords, refCoords, fitIndices = null, calcIndices = null, needAlignedCoords = true) {
    if (!coords || !refCoords) {
        return { rmsd: 0, alignedCoords: needAlignedCoords ? new Float32Array(0) : null };
    }

    const nCoords = Math.floor(coords.length / 3);
    const hasFit = fitIndices && fitIndices.length > 0;
    const nFit = hasFit ? fitIndices.length : nCoords;

    if (nFit === 0) {
        return {
            rmsd: 0,
            alignedCoords: needAlignedCoords ? new Float32Array(coords) : null
        };
    }

    const hasCalc = calcIndices && calcIndices.length > 0;
    const nCalc = hasCalc ? calcIndices.length : nFit;

    // 1. Compute Centroids over fitIndices
    let mx0 = 0, my0 = 0, mz0 = 0;
    let mx1 = 0, my1 = 0, mz1 = 0;

    if (hasFit) {
        for (let k = 0; k < nFit; k++) {
            const idx3 = fitIndices[k] * 3;
            mx0 += refCoords[idx3];
            my0 += refCoords[idx3 + 1];
            mz0 += refCoords[idx3 + 2];

            mx1 += coords[idx3];
            my1 += coords[idx3 + 1];
            mz1 += coords[idx3 + 2];
        }
    } else {
        for (let k = 0; k < nFit; k++) {
            const idx3 = k * 3;
            mx0 += refCoords[idx3];
            my0 += refCoords[idx3 + 1];
            mz0 += refCoords[idx3 + 2];

            mx1 += coords[idx3];
            my1 += coords[idx3 + 1];
            mz1 += coords[idx3 + 2];
        }
    }

    mx0 /= nFit; my0 /= nFit; mz0 /= nFit;
    mx1 /= nFit; my1 /= nFit; mz1 /= nFit;

    // 2. Construct 3x3 Covariance Matrix H
    let h11 = 0, h12 = 0, h13 = 0;
    let h21 = 0, h22 = 0, h23 = 0;
    let h31 = 0, h32 = 0, h33 = 0;

    if (hasFit) {
        for (let k = 0; k < nFit; k++) {
            const idx3 = fitIndices[k] * 3;
            const x0 = refCoords[idx3]     - mx0;
            const y0 = refCoords[idx3 + 1] - my0;
            const z0 = refCoords[idx3 + 2] - mz0;

            const x1 = coords[idx3]     - mx1;
            const y1 = coords[idx3 + 1] - my1;
            const z1 = coords[idx3 + 2] - mz1;

            h11 += x1 * x0; h12 += x1 * y0; h13 += x1 * z0;
            h21 += y1 * x0; h22 += y1 * y0; h23 += y1 * z0;
            h31 += z1 * x0; h32 += z1 * y0; h33 += z1 * z0;
        }
    } else {
        for (let k = 0; k < nFit; k++) {
            const idx3 = k * 3;
            const x0 = refCoords[idx3]     - mx0;
            const y0 = refCoords[idx3 + 1] - my0;
            const z0 = refCoords[idx3 + 2] - mz0;

            const x1 = coords[idx3]     - mx1;
            const y1 = coords[idx3 + 1] - my1;
            const z1 = coords[idx3 + 2] - mz1;

            h11 += x1 * x0; h12 += x1 * y0; h13 += x1 * z0;
            h21 += y1 * x0; h22 += y1 * y0; h23 += y1 * z0;
            h31 += z1 * x0; h32 += z1 * y0; h33 += z1 * z0;
        }
    }

    // 3. Construct 4x4 Horn Matrix K in module-scoped _K
    _K[0]  = h11 + h22 + h33;  _K[1]  = h23 - h32;        _K[2]  = h31 - h13;        _K[3]  = h12 - h21;
    _K[4]  = h23 - h32;        _K[5]  = h11 - h22 - h33;  _K[6]  = h12 + h21;        _K[7]  = h31 + h13;
    _K[8]  = h31 - h13;        _K[9]  = h12 + h21;        _K[10] = -h11 + h22 - h33; _K[11] = h23 + h32;
    _K[12] = h12 - h21;        _K[13] = h31 + h13;        _K[14] = h23 + h32;        _K[15] = -h11 - h22 + h33;

    // 4. Exact Cyclic Jacobi Eigensolve on 4x4 Symmetric Horn Matrix
    const { maxEigenvector: q } = eigensolveSymmetric4x4(_K);

    // 5. Construct 3x3 Rotation Matrix R from Quaternion q
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const r11 = 1 - 2*(y*y + z*z), r12 = 2*(x*y - w*z),     r13 = 2*(x*z + w*y);
    const r21 = 2*(x*y + w*z),     r22 = 1 - 2*(x*x + z*z), r23 = 2*(y*z - w*x);
    const r31 = 2*(x*z - w*y),     r32 = 2*(y*z + w*x),     r33 = 1 - 2*(x*x + y*y);

    if (needAlignedCoords) {
        // 6. Rotate Coordinates
        const alignedCoords = new Float32Array(coords.length);
        for (let i = 0; i < nCoords; i++) {
            const i3 = i * 3;
            const dx = coords[i3]     - mx1;
            const dy = coords[i3 + 1] - my1;
            const dz = coords[i3 + 2] - mz1;

            alignedCoords[i3]     = r11 * dx + r12 * dy + r13 * dz + mx0;
            alignedCoords[i3 + 1] = r21 * dx + r22 * dy + r23 * dz + my0;
            alignedCoords[i3 + 2] = r31 * dx + r32 * dy + r33 * dz + mz0;
        }

        // 7. Calculate RMSD on calcIndices
        let sumSq = 0;
        if (hasCalc) {
            for (let k = 0; k < nCalc; k++) {
                const idx3 = calcIndices[k] * 3;
                const diffX = alignedCoords[idx3]     - refCoords[idx3];
                const diffY = alignedCoords[idx3 + 1] - refCoords[idx3 + 1];
                const diffZ = alignedCoords[idx3 + 2] - refCoords[idx3 + 2];
                sumSq += diffX * diffX + diffY * diffY + diffZ * diffZ;
            }
        } else if (hasFit) {
            for (let k = 0; k < nFit; k++) {
                const idx3 = fitIndices[k] * 3;
                const diffX = alignedCoords[idx3]     - refCoords[idx3];
                const diffY = alignedCoords[idx3 + 1] - refCoords[idx3 + 1];
                const diffZ = alignedCoords[idx3 + 2] - refCoords[idx3 + 2];
                sumSq += diffX * diffX + diffY * diffY + diffZ * diffZ;
            }
        } else {
            for (let k = 0; k < nCoords; k++) {
                const idx3 = k * 3;
                const diffX = alignedCoords[idx3]     - refCoords[idx3];
                const diffY = alignedCoords[idx3 + 1] - refCoords[idx3 + 1];
                const diffZ = alignedCoords[idx3 + 2] - refCoords[idx3 + 2];
                sumSq += diffX * diffX + diffY * diffY + diffZ * diffZ;
            }
        }

        const rmsd = nCalc > 0 ? Math.sqrt(sumSq / nCalc) : 0;
        return {
            rmsd: parseFloat(rmsd.toFixed(3)),
            alignedCoords
        };
    } else {
        // RMSD-only fast path (no alignedCoords allocation or extra atom rotations)
        let sumSq = 0;
        if (hasCalc) {
            for (let k = 0; k < nCalc; k++) {
                const idx3 = calcIndices[k] * 3;
                const dx = coords[idx3]     - mx1;
                const dy = coords[idx3 + 1] - my1;
                const dz = coords[idx3 + 2] - mz1;

                const rx = r11 * dx + r12 * dy + r13 * dz + mx0;
                const ry = r21 * dx + r22 * dy + r23 * dz + my0;
                const rz = r31 * dx + r32 * dy + r33 * dz + mz0;

                const diffX = rx - refCoords[idx3];
                const diffY = ry - refCoords[idx3 + 1];
                const diffZ = rz - refCoords[idx3 + 2];
                sumSq += diffX * diffX + diffY * diffY + diffZ * diffZ;
            }
        } else if (hasFit) {
            for (let k = 0; k < nFit; k++) {
                const idx3 = fitIndices[k] * 3;
                const dx = coords[idx3]     - mx1;
                const dy = coords[idx3 + 1] - my1;
                const dz = coords[idx3 + 2] - mz1;

                const rx = r11 * dx + r12 * dy + r13 * dz + mx0;
                const ry = r21 * dx + r22 * dy + r23 * dz + my0;
                const rz = r31 * dx + r32 * dy + r33 * dz + mz0;

                const diffX = rx - refCoords[idx3];
                const diffY = ry - refCoords[idx3 + 1];
                const diffZ = rz - refCoords[idx3 + 2];
                sumSq += diffX * diffX + diffY * diffY + diffZ * diffZ;
            }
        } else {
            for (let k = 0; k < nCoords; k++) {
                const idx3 = k * 3;
                const dx = coords[idx3]     - mx1;
                const dy = coords[idx3 + 1] - my1;
                const dz = coords[idx3 + 2] - mz1;

                const rx = r11 * dx + r12 * dy + r13 * dz + mx0;
                const ry = r21 * dx + r22 * dy + r23 * dz + my0;
                const rz = r31 * dx + r32 * dy + r33 * dz + mz0;

                const diffX = rx - refCoords[idx3];
                const diffY = ry - refCoords[idx3 + 1];
                const diffZ = rz - refCoords[idx3 + 2];
                sumSq += diffX * diffX + diffY * diffY + diffZ * diffZ;
            }
        }

        const rmsd = nCalc > 0 ? Math.sqrt(sumSq / nCalc) : 0;
        return {
            rmsd: parseFloat(rmsd.toFixed(3)),
            alignedCoords: null
        };
    }
}

/**
 * Exact cyclic Jacobi eigenvalue and eigenvector solver for a 4x4 real symmetric matrix.
 * Solves A * v = lambda * v with guaranteed quadratic convergence to machine precision.
 *
 * @param {Array<Array<number>>|Float64Array|Array<number>} matrix - 4x4 real symmetric matrix (2D 4x4 or flat 16 elements)
 * @returns {{ maxEigenvalue: number, maxEigenvector: [number, number, number, number] }}
 */
export function eigensolveSymmetric4x4(matrix) {
    if (matrix.length === 4 && (Array.isArray(matrix[0]) || (matrix[0] && matrix[0].length === 4))) {
        for (let i = 0; i < 4; i++) {
            const row = matrix[i];
            const i4 = i * 4;
            _A[i4]     = row[0];
            _A[i4 + 1] = row[1];
            _A[i4 + 2] = row[2];
            _A[i4 + 3] = row[3];
        }
    } else {
        _A.set(matrix);
    }

    _V.fill(0);
    _V[0] = 1; _V[5] = 1; _V[10] = 1; _V[15] = 1;

    const maxSweeps = 50;
    const eps = 1e-15;

    for (let sweep = 0; sweep < maxSweeps; sweep++) {
        let offDiagSum = Math.abs(_A[1])  + Math.abs(_A[2])  + Math.abs(_A[3])
                       + Math.abs(_A[6])  + Math.abs(_A[7])
                       + Math.abs(_A[11]);

        if (offDiagSum < eps) {
            break;
        }

        for (let p = 0; p < 3; p++) {
            const p4 = p * 4;
            for (let q = p + 1; q < 4; q++) {
                const q4 = q * 4;
                const apq = _A[p4 + q];
                if (Math.abs(apq) < 1e-15) continue;

                const app = _A[p4 + p];
                const aqq = _A[q4 + q];
                const theta = (aqq - app) / (2 * apq);
                const t = theta >= 0 
                    ? 1 / (theta + Math.sqrt(1 + theta * theta)) 
                    : -1 / (-theta + Math.sqrt(1 + theta * theta));
                const c = 1 / Math.sqrt(1 + t * t);
                const s = t * c;
                const tau = s / (1 + c);

                _A[p4 + p] = app - t * apq;
                _A[q4 + q] = aqq + t * apq;
                _A[p4 + q] = 0;
                _A[q4 + p] = 0;

                for (let r = 0; r < 4; r++) {
                    if (r !== p && r !== q) {
                        const r4 = r * 4;
                        const arp = _A[r4 + p];
                        const arq = _A[r4 + q];
                        _A[r4 + p] = arp - s * (arq + tau * arp);
                        _A[p4 + r] = _A[r4 + p];
                        _A[r4 + q] = arq + s * (arp - tau * arq);
                        _A[q4 + r] = _A[r4 + q];
                    }
                }

                for (let r = 0; r < 4; r++) {
                    const r4 = r * 4;
                    const vrp = _V[r4 + p];
                    const vrq = _V[r4 + q];
                    _V[r4 + p] = vrp - s * (vrq + tau * vrp);
                    _V[r4 + q] = vrq + s * (vrp - tau * vrq);
                }
            }
        }
    }

    let maxVal = -Infinity;
    let maxCol = 0;
    for (let i = 0; i < 4; i++) {
        const val = _A[i * 4 + i];
        if (val > maxVal) {
            maxVal = val;
            maxCol = i;
        }
    }

    let q0 = _V[maxCol];
    let q1 = _V[4 + maxCol];
    let q2 = _V[8 + maxCol];
    let q3 = _V[12 + maxCol];

    const norm = Math.hypot(q0, q1, q2, q3) || 1;
    q0 /= norm; q1 /= norm; q2 /= norm; q3 /= norm;
    if (q0 < 0) {
        q0 = -q0; q1 = -q1; q2 = -q2; q3 = -q3;
    }

    return { maxEigenvalue: maxVal, maxEigenvector: [q0, q1, q2, q3] };
}


