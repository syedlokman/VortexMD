// src/trajectory-validator.js
// Single Task: Pre-load Trajectory Header Probing & Topology Compatibility Validation

import { validateXtcHeader } from './indexer.js';

/**
 * Probes the binary header from an ArrayBuffer or Uint8Array slice to extract
 * atom count and basic header metadata without loading the entire trajectory.
 * 
 * @param {ArrayBuffer|Uint8Array} buffer 
 * @param {string} [ext='xtc'] 
 * @returns {Promise<{ found: boolean, format: string, natoms?: number, step?: number, time?: number, box?: number[], error?: string }>}
 */
export async function probeTrajectoryHeader(buffer, ext = 'xtc') {
    const cleanExt = (ext || 'xtc').replace(/^\./, '').toLowerCase();
    if (cleanExt !== 'xtc') {
        return {
            found: false,
            format: cleanExt,
            error: "VortexMD v1 is purpose-built and optimized for GROMACS (.xtc). For other formats, please convert to .xtc (e.g., using MDAnalysis or VMD) before loading."
        };
    }

    const arrayBuf = (buffer instanceof Uint8Array) ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    if (!arrayBuf || arrayBuf.byteLength < 92) {
        return { found: false, format: 'xtc', error: 'Buffer too small to contain valid trajectory header' };
    }

    const uint8 = new Uint8Array(arrayBuf);
    const dataView = new DataView(arrayBuf);

    for (let i = 0; i <= uint8.length - 92; i++) {
        const header = validateXtcHeader(dataView, i, 0, { validateBox: false, checkPayload: false });
        if (header) {
            return {
                found: true,
                format: 'xtc',
                natoms: header.natoms,
                step: header.step,
                time: header.time,
                box: header.box
            };
        }
    }

    return { found: false, format: 'xtc', error: 'Could not detect trajectory header in slice' };
}

/**
 * Validates whether a trajectory (file or URL) matches the expected atom count
 * of the currently loaded topology before indexing or streaming starts.
 * 
 * @param {File|Blob|string} fileOrUrl - Trajectory File, Blob, or URL
 * @param {number} expectedAtoms - Active topology atom count
 * @param {string} [ext] - Trajectory extension
 * @returns {Promise<{ valid: boolean, error?: string, trajAtoms?: number, expectedAtoms: number, format: string }>}
 */
export async function validateTrajectoryCompatibility(fileOrUrl, expectedAtoms, ext = 'xtc') {
    let cleanExt = (ext || '').replace(/^\./, '').toLowerCase();
    if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        if (fileOrUrl.name) {
            const parts = fileOrUrl.name.toLowerCase().split('.');
            if (parts.length > 1) cleanExt = parts.pop();
        }
    } else if (typeof fileOrUrl === 'string') {
        const cleanPath = fileOrUrl.split('?')[0].split('#')[0];
        const parts = cleanPath.toLowerCase().split('.');
        if (parts.length > 1) cleanExt = parts.pop();
    }
    if (!cleanExt) cleanExt = 'xtc';

    if (cleanExt !== 'xtc') {
        const err = "VortexMD v1 is purpose-built and optimized for GROMACS (.xtc). For other formats, please convert to .xtc (e.g., using MDAnalysis or VMD) before loading.";
        return {
            valid: false,
            error: err,
            expectedAtoms: Number(expectedAtoms) || 0,
            format: cleanExt
        };
    }

    const numExpected = Number(expectedAtoms);
    if (!numExpected || isNaN(numExpected) || numExpected <= 0) {
        const err = 'No active topology structure loaded. Please load a topology structure (.pdb, .gro) first.';
        return {
            valid: false,
            error: err,
            expectedAtoms: 0,
            format: 'xtc'
        };
    }

    let sliceBuffer = null;
    const probeSliceBytes = 256 * 1024; // 256 KB slice is ample for frame 0 header

    try {
        if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
            const slice = fileOrUrl.slice(0, Math.min(fileOrUrl.size, probeSliceBytes));
            sliceBuffer = await slice.arrayBuffer();
        } else if (fileOrUrl && typeof fileOrUrl.slice === 'function') {
            const slice = fileOrUrl.slice(0, probeSliceBytes);
            sliceBuffer = slice.arrayBuffer ? (await slice.arrayBuffer()) : slice;
        } else if (fileOrUrl instanceof ArrayBuffer) {
            sliceBuffer = fileOrUrl.slice(0, probeSliceBytes);
        } else {
            const err = 'Invalid trajectory file format. Expected a File or Blob.';
            return {
                valid: false,
                error: err,
                expectedAtoms: numExpected,
                format: 'xtc'
            };
        }
    } catch (err) {
        const errMsg = `Failed to read trajectory header: ${err.message}`;
        return {
            valid: false,
            error: errMsg,
            expectedAtoms: numExpected,
            format: 'xtc'
        };
    }

    if (!sliceBuffer || sliceBuffer.byteLength === 0) {
        const err = 'Trajectory file or stream is empty.';
        return {
            valid: false,
            error: err,
            expectedAtoms: numExpected,
            format: 'xtc'
        };
    }

    const probe = await probeTrajectoryHeader(sliceBuffer, 'xtc');

    if (probe.found && probe.natoms) {
        if (probe.natoms !== numExpected) {
            const err = `Trajectory atom count mismatch: Trajectory file contains ${probe.natoms.toLocaleString()} atoms, but loaded topology structure has ${numExpected.toLocaleString()} atoms.`;
            return {
                valid: false,
                error: err,
                trajAtoms: probe.natoms,
                expectedAtoms: numExpected,
                format: probe.format || 'xtc'
            };
        }

        if (probe.box && (probe.box[0] <= 0 || probe.box[1] <= 0 || probe.box[2] <= 0 || isNaN(probe.box[0]) || isNaN(probe.box[1]) || isNaN(probe.box[2]))) {
            const err = 'Trajectory header contains invalid simulation box dimensions.';
            return {
                valid: false,
                error: err,
                trajAtoms: probe.natoms,
                expectedAtoms: numExpected,
                format: probe.format || 'xtc'
            };
        }

        return {
            valid: true,
            trajAtoms: probe.natoms,
            expectedAtoms: numExpected,
            format: probe.format || 'xtc'
        };
    }

    // If binary probe could not decisively extract natoms, allow indexing to proceed
    // with indexer-level validation
    return {
        valid: true,
        trajAtoms: numExpected,
        expectedAtoms: numExpected,
        format: 'xtc',
        note: 'Header probe skipped or unconstrained'
    };
}
