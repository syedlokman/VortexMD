// src/worker.js
// Single Task: Pure Headless Worker Thread Router for Binary Indexing & Float32Array Math

import { scanTrajectoryBinary } from './indexer.js';
import { hornSuperpose } from './analytics.js';
import { decodeHeadlessXtcFrames } from './headless-xtc.js';

self.onmessage = async function(e) {
    const data = e.data || {};
    const postId = data.postId;

    try {
        if (data.type === 'stream_compute_rmsd') {
            const {
                file,
                startFrame = 0,
                endFrame = 0,
                targetFrames,
                stride = 1,
                frameOffsets = [],
                offsetBase = 0,
                refFiltered,
                fitIndices,
                calcIndices,
                uniqueIndices,
                frameTimes,
                timeBase = 0,
                dt = 100,
                expectedAtoms = 0,
                fileSize,
                ext = 'xtc'
            } = data;

            const frameStride = Math.max(1, Math.floor(stride || 1));
            const stepDt = dt || 100;
            const fitIdx = fitIndices || (refFiltered ? Array.from({ length: refFiltered.length / 3 }, (_, i) => i) : []);
            const calcIdx = calcIndices || fitIdx;

            const targets = Array.isArray(targetFrames)
                ? targetFrames
                : (() => {
                    const list = [];
                    for (let f = startFrame; f <= endFrame; f++) {
                        if (f % frameStride === 0) list.push(f);
                    }
                    return list;
                })();

            const format = (ext || 'xtc').toLowerCase();
            const results = [];

            if (format === 'xtc' && file) {
                const targetCoords = (uniqueIndices && uniqueIndices.length > 0) ? new Float32Array(uniqueIndices.length * 3) : null;
                const numU = uniqueIndices ? uniqueIndices.length : 0;

                for (const f of targets) {
                    const fOffsetIdx = offsetBase !== undefined ? (f - offsetBase) : f;
                    const a = (frameOffsets && frameOffsets.length > fOffsetIdx) ? frameOffsets[fOffsetIdx] : undefined;
                    let b = (frameOffsets && frameOffsets.length > fOffsetIdx + 1) ? frameOffsets[fOffsetIdx + 1] : undefined;
                    if (b === undefined && fileSize) {
                        b = fileSize;
                    } else if (b === undefined && typeof file.size === 'number') {
                        b = file.size;
                    }

                    if (a === undefined || b === undefined || b <= a) continue;

                    let frameBuf = null;
                    try {
                        if (typeof file.slice === 'function') {
                            const slice = file.slice(a, b);
                            frameBuf = slice.arrayBuffer ? (await slice.arrayBuffer()) : slice;
                        } else if (file instanceof ArrayBuffer) {
                            frameBuf = file.slice(a, b);
                        }
                    } catch (sliceErr) {
                        continue;
                    }
                    if (!frameBuf) continue;

                    const rawFrames = decodeHeadlessXtcFrames(frameBuf, expectedAtoms);
                    frameBuf = null;
                    if (!rawFrames || !rawFrames[0]) continue;
                    const frameCoords = rawFrames[0];

                    let coordsToUse;
                    if (targetCoords) {
                        for (let i = 0; i < numU; i++) {
                            const src3 = uniqueIndices[i] * 3;
                            const dst3 = i * 3;
                            targetCoords[dst3]     = frameCoords[src3];
                            targetCoords[dst3 + 1] = frameCoords[src3 + 1];
                            targetCoords[dst3 + 2] = frameCoords[src3 + 2];
                        }
                        coordsToUse = targetCoords;
                    } else {
                        coordsToUse = frameCoords;
                    }

                    const { rmsd } = hornSuperpose(coordsToUse, refFiltered, fitIdx, calcIdx, false);

                    const fTimeIdx = timeBase !== undefined ? (f - timeBase) : f;
                    let timeNs;
                    if (frameTimes && frameTimes.length > fTimeIdx && typeof frameTimes[fTimeIdx] === 'number' && !isNaN(frameTimes[fTimeIdx]) && frameTimes[fTimeIdx] !== 0) {
                        timeNs = (frameTimes[fTimeIdx] / 1000).toFixed(2);
                    } else {
                        timeNs = ((f * stepDt) / 1000).toFixed(2);
                    }

                    results.push({
                        frame: f + 1,
                        timeNs: timeNs,
                        rmsd: rmsd
                    });
                }
            }

            self.postMessage({
                postId: postId,
                type: 'stream_rmsd_chunk_done',
                results: results,
                chunkStart: startFrame,
                chunkEnd: endFrame
            });
            return;
        }

        if (data.type === 'index') {
            const { file, expectedAtoms, fileSize, ext } = data;
            const offsets = await scanTrajectoryBinary(file, expectedAtoms, fileSize, (progress) => {
                self.postMessage({ postId: postId, type: 'progress', ...progress });
            }, ext || 'xtc');
            const frameTimes = offsets.frameTimes || new Float32Array(0);
            const transferables = (frameTimes && frameTimes.buffer instanceof ArrayBuffer) ? [frameTimes.buffer] : [];
            self.postMessage({
                postId: postId,
                type: 'done',
                offsets: offsets,
                frameTimes: frameTimes,
                detectedDeltaTime: offsets.detectedDeltaTime,
                isTimeCalibrated: offsets.isTimeCalibrated
            }, transferables);
            return;
        }

        if (data.type === 'fetch_chunk') {
            const { file, startByte, endByte, frameIndex, expectedAtoms, ext } = data;
            const startTime = performance.now();

            try {
                let buffer;
                if (file) {
                    if (typeof file.slice === 'function') {
                        const slice = file.slice(startByte, endByte);
                        buffer = slice.arrayBuffer ? (await slice.arrayBuffer()) : slice;
                    } else if (file instanceof ArrayBuffer) {
                        buffer = file.slice(startByte, endByte);
                    }
                }

                if (!buffer) {
                    throw new Error("Empty buffer slice fetched");
                }

                const coords = decodeHeadlessXtcFrames(buffer, expectedAtoms);
                const parseTimeMs = performance.now() - startTime;
                if (coords && coords.length > 0) {
                    const transferables = coords.map(c => c.buffer);
                    self.postMessage({
                        postId: postId,
                        type: 'chunk_parsed',
                        startFrameIndex: frameIndex,
                        coords: coords,
                        engineMode: 'worker_headless_xtc',
                        parseTimeMs: parseTimeMs
                    }, transferables);
                } else {
                    // Fallback to chunk_fetched if headless decode produced no frames
                    self.postMessage({
                        postId: postId,
                        type: 'chunk_fetched',
                        startFrameIndex: frameIndex,
                        buffer: buffer,
                        ext: 'xtc',
                        parseTimeMs: parseTimeMs
                    }, [buffer]);
                }
            } catch (err) {
                self.postMessage({
                    postId: postId,
                    type: 'chunk_error',
                    frameIndex: frameIndex,
                    error: err.message
                });
            }
        }
    } catch (err) {
        self.postMessage({
            postId: postId,
            type: 'error',
            error: err?.message || String(err)
        });
    }
};
