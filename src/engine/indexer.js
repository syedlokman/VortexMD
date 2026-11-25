// src/indexer.js
// Single Task: Multi-Format Binary Header Scanner & Parallel Multi-Worker Trajectory Indexer

export function computeDeltaTimeAndCalibration(frameTimes) {
    if (!frameTimes || frameTimes.length < 2) {
        return { detectedDeltaTime: 100.0, isTimeCalibrated: false };
    }

    const validDiffs = [];
    for (let k = 1; k < frameTimes.length; k++) {
        const rawDiff = frameTimes[k] - frameTimes[k - 1];
        const diff = Math.round(rawDiff * 10000) / 10000;
        if (diff > 0.0001) {
            validDiffs.push(diff);
        }
    }

    if (validDiffs.length === 0) {
        return { detectedDeltaTime: 100.0, isTimeCalibrated: false };
    }

    validDiffs.sort((a, b) => a - b);
    const mid = Math.floor(validDiffs.length / 2);
    let median;
    if (validDiffs.length % 2 !== 0) {
        median = validDiffs[mid];
    } else {
        median = (validDiffs[mid - 1] + validDiffs[mid]) / 2;
    }

    const detectedDeltaTime = Math.round(median * 10000) / 10000;
    return {
        detectedDeltaTime,
        isTimeCalibrated: true
    };
}

/**
 * Single source of truth for XTC frame header validation.
 * Checks:
 *   1. Magic bytes 0x000007CB
 *   2. Atom count (natoms > 0, < 100000000, and matches expectedAtoms if expectedAtoms > 0)
 *   3. Step & Time (step >= prevStep if prevStep !== null, time >= 0, not NaN, and time >= prevTime if prevTime !== null)
 *   4. Positive simulation box diagonals (vxx, vyy, vzz > 0 and not NaN)
 *   5. Payload size bounds (minPayload 4 <= lsize <= maxPayload)
 * 
 * @param {DataView} dataView 
 * @param {number} offset 
 * @param {number} [expectedAtoms=0] 
 * @param {Object} [options={}]
 * @returns {null|{valid: boolean, natoms: number, step: number, time: number, box: number[], isBoxValid: boolean, lsize: number, paddedLsize: number, totalFrameBytes: number}}
 */
export function validateXtcHeader(dataView, offset, expectedAtoms = 0, options = {}) {
    if (!dataView || offset + 92 > dataView.byteLength) {
        return null;
    }

    const {
        prevStep = null,
        prevTime = null,
        validateBox = true,
        checkPayload = true
    } = options;

    // 1. Magic bytes 0x000007CB
    const magic = dataView.getUint32(offset, false);
    if (magic !== 0x000007CB) {
        return null;
    }

    // 2. Natoms check
    const natoms = dataView.getUint32(offset + 4, false);
    if (natoms === 0 || natoms >= 100000000) {
        return null;
    }
    if (expectedAtoms > 0 && natoms !== expectedAtoms) {
        return null;
    }

    // 3. Step & Time check
    const step = dataView.getUint32(offset + 8, false);
    if (prevStep !== null && step < prevStep) {
        return null;
    }

    const time = dataView.getFloat32(offset + 12, false);
    if (isNaN(time) || time < 0) {
        return null;
    }
    if (prevTime !== null && time < prevTime) {
        return null;
    }

    // 4. Box diagonals
    const vxx = dataView.getFloat32(offset + 16, false);
    const vyy = dataView.getFloat32(offset + 32, false);
    const vzz = dataView.getFloat32(offset + 48, false);
    const isBoxValid = (vxx > 0 && vyy > 0 && vzz > 0 && !isNaN(vxx) && !isNaN(vyy) && !isNaN(vzz));
    if (validateBox && !isBoxValid) {
        return null;
    }

    // 5. Payload length bounds check
    const lsize = dataView.getUint32(offset + 88, false);
    const minPayload = 4;
    const maxPayload = expectedAtoms > 0 ? (expectedAtoms * 12 + 1024) : 0x7FFFFFFF;
    if (checkPayload && (lsize < minPayload || lsize > maxPayload)) {
        return null;
    }

    const paddedLsize = (lsize + 3) & ~3;
    const totalFrameBytes = 92 + paddedLsize;

    return {
        valid: true,
        natoms,
        step,
        time,
        box: [vxx, vyy, vzz],
        isBoxValid,
        lsize,
        paddedLsize,
        totalFrameBytes
    };
}

/**
 * Attaches metadata properties (frameTimes, detectedDeltaTime, isTimeCalibrated)
 * as non-enumerable properties on the frameOffsets array.
 *
 * @param {Array<number>} offsets 
 * @param {Float32Array|Array<number>|null} [frameTimes=null] 
 * @param {number} [detectedDeltaTime=0] 
 * @param {boolean} [isTimeCalibrated=false] 
 * @returns {Array<number>}
 */
export function attachIndexMetadata(offsets, frameTimes = null, detectedDeltaTime = 0, isTimeCalibrated = false) {
    if (!offsets || !Array.isArray(offsets)) return offsets;

    Object.defineProperties(offsets, {
        frameTimes: {
            value: frameTimes,
            enumerable: false,
            writable: true,
            configurable: true
        },
        detectedDeltaTime: {
            value: detectedDeltaTime,
            enumerable: false,
            writable: true,
            configurable: true
        },
        isTimeCalibrated: {
            value: isTimeCalibrated,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });

    return offsets;
}

export async function scanTrajectoryBinary(file, expectedAtoms, fileSize, onProgress, ext = 'xtc') {

    const chunkSize = 10 * 1024 * 1024; // 10MB
    let offset = 0;
    let highestByteReached = 0;
    let frameOffsets = [];
    let frameTimesList = [];
    let lastReportedCount = 0;
    let carryoverBytes = 0;
    let prevStep = null;
    let prevTime = null;
    // Overlap window (128 bytes) serves as defensive rewind when a chunk cuts off midway through
    // an unparsed 92-byte header (i + 92 > byteLength). In contrast, carryoverBytes handles frames
    // whose headers were recognized but payloads span across chunk boundaries. The monotonic offset
    // guard (currentFrameOffset > lastOffset) deduplicates re-scanned headers during overlap rewinds.
    const overlap = 128;

    const format = (ext || 'xtc').toLowerCase();

    while (true) {
        if (fileSize && offset >= fileSize) break;

        const end = fileSize ? Math.min(offset + chunkSize, fileSize) : offset + chunkSize;
        let arrayBuffer;

        try {
            if (file) {
                if (typeof file.slice === 'function') {
                    const slice = file.slice(offset, end);
                    arrayBuffer = slice.arrayBuffer ? (await slice.arrayBuffer()) : slice;
                } else if (file instanceof ArrayBuffer) {
                    arrayBuffer = file.slice(offset, end);
                }
            }
        } catch (err) {
            offset = highestByteReached;
            break;
        }

        if (!arrayBuffer) {
            offset = highestByteReached;
            break;
        }

        const uintData = new Uint8Array(arrayBuffer);
        if (uintData.length === 0) {
            offset = highestByteReached;
            break;
        }

        highestByteReached = Math.max(highestByteReached, offset + uintData.length);
        const dataView = new DataView(arrayBuffer);

        let startI = 0;
        if (carryoverBytes > 0) {
            if (carryoverBytes >= uintData.length) {
                carryoverBytes -= uintData.length;
                offset += uintData.length;
                continue;
            } else {
                startI = carryoverBytes;
                carryoverBytes = 0;
            }
        }

        let i = startI;
        while (i < uintData.length) {
            if (i + 92 > dataView.byteLength) {
                break;
            }

            if (uintData[i] === 0x00 && uintData[i+1] === 0x00 && uintData[i+2] === 0x07 && uintData[i+3] === 0xCB) {
                const header = validateXtcHeader(dataView, i, expectedAtoms, { prevStep, prevTime, validateBox: false });
                if (!header) {
                    i++;
                    continue;
                }

                const currentFrameOffset = offset + i;
                const frameEnd = currentFrameOffset + header.totalFrameBytes;
                if (fileSize && frameEnd > fileSize) {
                    break;
                }

                if (frameOffsets.length === 0 || currentFrameOffset > frameOffsets[frameOffsets.length - 1]) {
                    frameOffsets.push(currentFrameOffset);
                    frameTimesList.push(header.time);
                }
                prevStep = header.step;
                prevTime = header.time;

                if (i + header.totalFrameBytes > uintData.length) {
                    carryoverBytes = (i + header.totalFrameBytes) - uintData.length;
                    break;
                } else {
                    i += header.totalFrameBytes;
                    continue;
                }
            } else {
                i++;
            }
        }

        if (uintData.length < chunkSize) {
            offset = highestByteReached;
            break;
        }

        if (carryoverBytes > 0) {
            // Header was found and remainder of payload was carried over into next chunk
            offset += uintData.length;
        } else {
            // Defensive rewind: rewinds 128 bytes to catch headers cut short by chunk boundary;
            // duplicate frame entries are prevented by the strict offset monotonicity check.
            offset += (chunkSize - overlap);
        }

        if (onProgress) {
            const newOffsets = frameOffsets.slice(lastReportedCount);
            onProgress({
                framesFound: frameOffsets.length,
                bytesIndexed: highestByteReached,
                percent: fileSize ? Math.min(100, Math.round((highestByteReached / fileSize) * 100)) : null,
                offsetBase: lastReportedCount,
                newOffsets: newOffsets
            });
            lastReportedCount = frameOffsets.length;
        }
    }

    if (frameOffsets.length === 0) {
        frameOffsets.push(0);
    }

    if (frameOffsets[frameOffsets.length - 1] !== highestByteReached) {
        frameOffsets.push(highestByteReached);
    }

    const frameTimes = new Float32Array(frameTimesList);
    const { detectedDeltaTime, isTimeCalibrated } = computeDeltaTimeAndCalibration(frameTimes);

    return attachIndexMetadata(frameOffsets, frameTimes, detectedDeltaTime, isTimeCalibrated);
}
