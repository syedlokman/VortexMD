// src/engine/trajectory.js
// Single Task: Ring Buffer Coordinate Provider, Catmull-Rom Spline Interpolation & RMSD Superposition

import * as NGL from 'ngl';
import { calculateMemoryBudget, getDynamicMemoryLimit, logSystemMemoryBudget } from './memory-budget.js';
import { Gatekeeper } from './gatekeeper.js';
import { logger } from '../shared/logger.js';
import { hornSuperpose } from './analytics.js';
import { report } from '../shared/guard.js';

/**
 * 60 FPS Catmull-Rom Cubic Spline Interpolation
 * Computes intermediate sub-frame positions t in [0, 1] between adjacent frames (i-1, i, i+1, i+2).
 */
export function interpolateCatmullRom(cPrev, c0, c1, cNext, t, outBuffer = null) {
    if (t <= 0.001 || !c1) return c0;
    if (t >= 0.999) return c1;

    const pPrev = cPrev || c0;
    const p0 = c0;
    const p1 = c1;
    const pNext = cNext || c1;

    const len = p0.length;
    const out = (outBuffer && outBuffer.length === len) ? outBuffer : new Float32Array(len);

    const t2 = t * t;
    const t3 = t2 * t;

    const wPrev = -0.5 * t3 + t2 - 0.5 * t;
    const w0    =  1.5 * t3 - 2.5 * t2 + 1.0;
    const w1    = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
    const wNext =  0.5 * t3 - 0.5 * t2;

    for (let i = 0; i < len; i++) {
        out[i] = wPrev * pPrev[i] + w0 * p0[i] + w1 * p1[i] + wNext * pNext[i];
    }
    return out;
}

/**
 * Resolves default superposition atom indices with fallback ladder:
 * customQuery / protein CA -> nucleic P -> uniform atom stride
 */
export function getDefaultSuperposeIndices(comp, customQuery = null, numAtoms = 0) {
    const structure = comp?.structure;
    if (!structure || typeof structure.getAtomIndices !== 'function') {
        if (numAtoms > 0) {
            const step = Math.max(1, Math.floor(numAtoms / 2000));
            const indices = [];
            for (let i = 0; i < numAtoms; i += step) {
                indices.push(i);
            }
            return indices;
        }
        return null;
    }

    const query = customQuery || 'protein and .CA';
    let indices = structure.getAtomIndices(new NGL.Selection(query));
    if ((!indices || indices.length === 0) && !customQuery) {
        indices = structure.getAtomIndices(new NGL.Selection('nucleic and .P'));
    }

    if (!indices || indices.length === 0) {
        const total = numAtoms || structure.atomCount || 0;
        const step = Math.max(1, Math.floor(total / 2000));
        indices = [];
        for (let i = 0; i < total; i += step) {
            indices.push(i);
        }
    }
    return indices;
}

/**
 * Rigid-Body Horn Closed-Form Unit-Quaternion Superposition
 * Aligns frame coordinates onto reference frame 0 (initialCoords) to eliminate rotational/translational tumbling.
 */
export function superposeCoordinates(coords, refCoords, seleIndices = null, comp = null) {
    if (!coords || !refCoords || coords.length !== refCoords.length) return coords;

    const numAtoms = coords.length / 3;
    let indices = seleIndices;

    if (!indices || indices.length === 0) {
        indices = getDefaultSuperposeIndices(comp, null, numAtoms);
    }

    const nSel = indices ? indices.length : 0;
    if (nSel === 0) return coords;

    return hornSuperpose(coords, refCoords, indices, indices).alignedCoords;
}

export class RingBufferManager {
    constructor(xtcFile, fileOffsets, expectedAtoms, comp, workerOrManager, trajExt = 'xtc', onError = null) {
        this.xtcFile = xtcFile;
        this.fileOffsets = fileOffsets;
        this.atomCount = expectedAtoms;
        this.frameCount = fileOffsets.length - 1;
        this.interpBuffer = this.atomCount ? new Float32Array(this.atomCount * 3) : null;
        this.workerManager = (workerOrManager && workerOrManager.getNextWorker) ? workerOrManager : null;
        this.worker = (workerOrManager && !workerOrManager.getNextWorker) ? workerOrManager : (this.workerManager ? this.workerManager.getNextWorker() : null);
        this.comp = comp;
        this.trajExt = trajExt || 'xtc';
        this.onError = onError;
        this.initialCoords = null;
        this.activeChunks = new Set();
        this.pendingFrameListeners = new Map(); // frameIndex -> Set<Function>
        this.playbackDirection = 'forward';
        this.currentFrame = 0;

        // FIFO Request Queue & Concurrency Management
        this.pendingChunkQueue = [];
        this.activeChunkJobs = 0;

        // NGL Native Signals & Counter for tracking active chunk processing
        this.signals = {
            frameChanged: new NGL.Signal(),
            countChanged: new NGL.Signal()
        };
        this.counter = new NGL.Counter();

        const budget = calculateMemoryBudget(this.atomCount, this.frameCount);
        this.maxCacheBytes = budget.maxCacheBytes;

        logSystemMemoryBudget(`Trajectory TrajectoryManager: ${this.frameCount} frames, ${this.atomCount} atoms`);

        this.gatekeeper = new Gatekeeper();
        this.frameBuffer = new Map();
        this.trajElement = null;
        this.trajectory = null;
        this.superposeIndices = null;
        this.customSuperposeQuery = null;
    }


    getSuperposeIndices() {
        if (this.superposeIndices && this.superposeIndices.length > 0) {
            return this.superposeIndices;
        }
        const indices = getDefaultSuperposeIndices(this.comp, this.customSuperposeQuery, this.atomCount);
        if (indices && indices.length > 0) {
            this.superposeIndices = indices;
        }
        return indices;
    }

    getChunkParams() {
        const atomCount = this.atomCount || 1;
        const frameBytes = atomCount * 12; // 3 floats * 4 bytes
        const TEN_MB = 10 * 1024 * 1024;
        const maxCacheBytes = this.maxCacheBytes || getDynamicMemoryLimit();

        const fetchSize = Math.max(1, Math.min(20, Math.floor(TEN_MB / frameBytes)));
        const maxCachedFrames = Math.max(1, Math.floor(maxCacheBytes / frameBytes));
        const prefetchBlocks = Math.max(1, Math.min(3, Math.floor(maxCachedFrames / fetchSize) - 1));

        return { fetchSize, prefetchBlocks };
    }

    getFrameCoords(frameIndex, optionsOrCallback, callback) {
        let options = {};
        let cb = callback;
        if (typeof optionsOrCallback === 'function') {
            cb = optionsOrCallback;
        } else if (optionsOrCallback) {
            options = optionsOrCallback;
        }

        if (frameIndex < 0 || frameIndex >= this.frameCount) {
            return Promise.resolve(null);
        }

        this.currentFrame = frameIndex;

        const requestSequence = this.gatekeeper.nextSequence();
        const subframe = options.subframe || 0;
        const interpolateType = options.interpolateType || 'spline';

        const processAndReturn = (c0) => {
            if (!this.initialCoords && c0) {
                this.initialCoords = new Float32Array(c0);
            }

            let finalCoords = c0;

            // 1. Spline Frame Interpolation
            if (subframe > 0.001 && interpolateType === 'spline' && this.frameBuffer.has(frameIndex + 1)) {
                const cPrev = this.frameBuffer.get(frameIndex - 1) || c0;
                const c1 = this.frameBuffer.get(frameIndex + 1);
                const cNext = this.frameBuffer.get(frameIndex + 2) || c1;
                if (!this.interpBuffer || this.interpBuffer.length !== c0.length) {
                    this.interpBuffer = new Float32Array(c0.length);
                }
                finalCoords = interpolateCatmullRom(cPrev, c0, c1, cNext, subframe, this.interpBuffer);
            }

            // 2. RMSD Superposition against Frame 0
            if (options.superpose && this.initialCoords) {
                const seleIndices = options.superposeIndices || this.getSuperposeIndices();
                finalCoords = superposeCoordinates(finalCoords, this.initialCoords, seleIndices, this.comp);
            }

            // Signal hook dispatch
            if (this.signals && this.signals.frameChanged) {
                this.signals.frameChanged.dispatch(frameIndex, finalCoords);
            }

            if (cb) cb(finalCoords);
            return finalCoords;
        };

        return new Promise((resolve, reject) => {
            // 1. Buffer Hit
            if (this.frameBuffer.has(frameIndex)) {
                const coords = this.frameBuffer.get(frameIndex);

                const activeBufferBytes = this.atomCount * 3 * 4 * this.frameBuffer.size;
                if (activeBufferBytes > this.maxCacheBytes && this.frameBuffer.size > 1) {
                    const candidateKeys = Array.from(this.frameBuffer.keys())
                        .filter(k => k !== 0 && k !== frameIndex && !this.activeChunks.has(k) && !this.pendingFrameListeners.has(k))
                        .sort((a, b) => Math.abs(b - frameIndex) - Math.abs(a - frameIndex));

                    for (const key of candidateKeys) {
                        this.frameBuffer.delete(key);
                        if (this.atomCount * 3 * 4 * this.frameBuffer.size <= this.maxCacheBytes) {
                            break;
                        }
                    }
                }

                // Continuous, Direction-Aware Lookahead Prefetching
                const { fetchSize } = this.getChunkParams();
                const lookaheadThreshold = fetchSize * 2;
                const direction = (options && (options.direction || options.playbackDirection)) || this.playbackDirection || 'forward';

                if (direction === 'backward' || direction === 'reverse') {
                    let lowestCachedFrame = frameIndex;
                    for (const key of this.frameBuffer.keys()) {
                        if (typeof key === 'number' && key <= frameIndex && key < lowestCachedFrame) {
                            lowestCachedFrame = key;
                        }
                    }
                    if ((frameIndex - lowestCachedFrame) < lookaheadThreshold && lowestCachedFrame > 0) {
                        this.requestChunk(Math.max(0, lowestCachedFrame - fetchSize));
                    }
                } else {
                    let highestCachedFrame = frameIndex;
                    for (const key of this.frameBuffer.keys()) {
                        if (typeof key === 'number' && key >= frameIndex && key > highestCachedFrame) {
                            highestCachedFrame = key;
                        }
                    }
                    if ((highestCachedFrame - frameIndex) < lookaheadThreshold && highestCachedFrame < this.frameCount - 1) {
                        this.requestChunk(highestCachedFrame + 1);
                    }
                }

                resolve(processAndReturn(coords));
                return;
            }

            // 2. Buffer Miss -> Event-Driven Promise Resolution
            this.requestChunk(frameIndex);

            if (!this.pendingFrameListeners.has(frameIndex)) {
                this.pendingFrameListeners.set(frameIndex, new Set());
            }

            let timeoutId = null;

            const onFrameLoaded = (coords, error) => {
                if (timeoutId) clearTimeout(timeoutId);
                if (error) {
                    reject(error);
                    return;
                }
                if (!coords) {
                    reject(new Error(`Failed to load coordinates for frame ${frameIndex}`));
                    return;
                }
                if (!this.gatekeeper.isCurrentSequence(requestSequence)) {
                    resolve(null);
                    return;
                }
                resolve(processAndReturn(coords));
            };

            this.pendingFrameListeners.get(frameIndex).add(onFrameLoaded);

            // Safety timeout guard
            timeoutId = setTimeout(() => {
                if (this.pendingFrameListeners.has(frameIndex)) {
                    this.pendingFrameListeners.get(frameIndex).delete(onFrameLoaded);
                    if (this.pendingFrameListeners.get(frameIndex).size === 0) {
                        this.pendingFrameListeners.delete(frameIndex);
                    }
                    console.warn(`Stream timeout on frame ${frameIndex}.`);
                    // Zero Fake Data Policy: Reject promise, do NOT inject fallback coords!
                    const err = new Error(`Stream timeout on frame ${frameIndex}`);
                    const { fetchSize } = this.getChunkParams();
                    this.handleUnrecoverableChunkFailure(frameIndex, frameIndex + fetchSize, err);
                    reject(err);
                }
            }, 30000);
        });
    }

    /**
     * Dynamically scaled, FIFO-queued multi-worker prefetch pipeline
     */
    requestChunk(startIndex) {
        const { fetchSize, prefetchBlocks } = this.getChunkParams();

        for (let b = 0; b < prefetchBlocks; b++) {
            const chunkStart = Math.max(0, startIndex + (b * fetchSize));
            const chunkEnd = Math.min(chunkStart + fetchSize, this.frameCount);
            if (chunkStart >= chunkEnd) break;

            const isAlreadyActive = this.activeChunks.has(chunkStart) ||
                Array.from(this.activeChunks).some(start => Math.max(chunkStart, start) < Math.min(chunkEnd, start + fetchSize));

            const isAlreadyPending = this.pendingChunkQueue.some(task =>
                task.chunkStart === chunkStart ||
                Math.max(chunkStart, task.chunkStart) < Math.min(chunkEnd, task.chunkEnd)
            );

            if (b === 0 && (isAlreadyActive || isAlreadyPending)) {
                break;
            }

            if (isAlreadyActive || isAlreadyPending) {
                continue;
            }

            let allFramesCached = true;
            for (let f = chunkStart; f < chunkEnd; f++) {
                if (!this.frameBuffer.has(f)) {
                    allFramesCached = false;
                    break;
                }
            }
            if (allFramesCached) {
                continue;
            }

            let ownsGate = false;
            if (b === 0) {
                if (this.gatekeeper.shouldQueue(chunkStart)) {
                    break;
                }
                ownsGate = true;
            }

            this.pendingChunkQueue.push({ chunkStart, chunkEnd, ownsGate });
        }

        this.processNextQueuedChunk();
    }

    _finishTask(task) {
        if (!task || !task.ownsGate) return;
        task.ownsGate = false;
        const nextRequest = this.gatekeeper.unlock();
        if (nextRequest !== null) {
            this.requestChunk(nextRequest);
        }
    }

    processNextQueuedChunk() {
        while (this.activeChunkJobs < 2 && this.pendingChunkQueue.length > 0) {
            const task = this.pendingChunkQueue.shift();
            if (this.activeChunks.has(task.chunkStart)) {
                this._finishTask(task);
                continue;
            }

            let allCached = true;
            for (let f = task.chunkStart; f < task.chunkEnd; f++) {
                if (!this.frameBuffer.has(f)) {
                    allCached = false;
                    break;
                }
            }
            if (allCached) {
                this._finishTask(task);
                continue;
            }

            this.activeChunkJobs++;
            this.activeChunks.add(task.chunkStart);
            this.counter.increment();

            this.fetchChunkWithRetry(task, 0);
        }
    }

    async fetchChunkWithRetry(task, attempt = 0) {
        if (this.disposed) return;
        const { chunkStart, chunkEnd } = task;
        const maxRetries = 3;

        try {
            const result = await this.performChunkFetch(chunkStart, chunkEnd);
            if (this.disposed) return;
            if (result && result.type === 'chunk_error') {
                throw new Error(result.error || 'Chunk fetch failed');
            }
            this.activeChunkJobs--;
            this.activeChunks.delete(chunkStart);
            this.counter.decrement();

            if (result && result.coords) {
                this.handleParsedCoords(chunkStart, result.coords, result.engineMode, result.parseTimeMs);
            }
            this._finishTask(task);
            this.processNextQueuedChunk();
        } catch (err) {
            if (this.disposed) return;
            const nativeError = err instanceof Error ? err : new Error(String(err));

            if (attempt < maxRetries) {
                const backoff = 500 * Math.pow(2, attempt) + Math.random() * 100;
                await new Promise(res => setTimeout(res, backoff));
                if (this.disposed) return;
                return this.fetchChunkWithRetry(task, attempt + 1);
            } else {
                this.activeChunkJobs--;
                this.activeChunks.delete(chunkStart);
                this.counter.decrement();

                this.handleUnrecoverableChunkFailure(chunkStart, chunkEnd, nativeError);
                this._finishTask(task);
                this.processNextQueuedChunk();
            }
        }
    }

    performChunkFetch(chunkStart, chunkEnd) {
        return new Promise((resolve, reject) => {
            // Ensure offsets are valid 64-bit numbers (safeguard against >2GB files and incomplete index arrays)
            const startByte = this.fileOffsets[chunkStart];
            const endByte = this.fileOffsets[chunkEnd];

            if (startByte === undefined || endByte === undefined || isNaN(startByte) || isNaN(endByte)) {
                reject(new Error(`Invalid byte offset range for frame chunk ${chunkStart}-${chunkEnd}. Indexing may not be complete.`));
                return;
            }

            const payload = {
                type: 'fetch_chunk',
                file: this.xtcFile,
                startByte: startByte,
                endByte: endByte,
                frameIndex: chunkStart,
                expectedAtoms: this.atomCount,
                ext: this.trajExt || 'xtc',
                engineMode: 'autoload'
            };

            const targetWorker = this.workerManager ? this.workerManager.getNextWorker() : this.worker;

            if (!targetWorker) {
                reject(new Error("No worker thread available to decode XTC trajectory chunk. All XTC decoding must execute in dedicated worker threads."));
                return;
            }

            let timer = null;
            let finished = false;

            const cleanup = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (targetWorker && targetWorker.removeEventListener) {
                    targetWorker.removeEventListener('message', handler);
                }
            };

            const finishResolve = (val) => {
                if (finished) return;
                finished = true;
                cleanup();
                resolve(val);
            };

            const finishReject = (err) => {
                if (finished) return;
                finished = true;
                cleanup();
                reject(err);
            };

            timer = setTimeout(() => {
                finishReject(new Error(`Timeout waiting for chunk ${chunkStart}-${chunkEnd} after 30s`));
            }, 30000);

            const handler = (msg) => {
                const data = msg.data || (msg.detail ? msg.detail : msg);
                if (!data) return;

                if (data.type === 'chunk_parsed' && data.startFrameIndex === chunkStart) {
                    finishResolve({ coords: data.coords, engineMode: data.engineMode, parseTimeMs: data.parseTimeMs });
                } else if (data.type === 'chunk_fetched' && data.startFrameIndex === chunkStart) {
                    finishReject(new Error(`Worker thread returned zero parsed frames for XTC chunk ${chunkStart}-${chunkEnd}.`));
                } else if (data.type === 'chunk_error' && (data.frameIndex === chunkStart || data.startFrameIndex === chunkStart)) {
                    finishReject(new Error(data.error || 'Worker returned chunk_error'));
                }
            };

            targetWorker.addEventListener('message', handler);
            if (targetWorker.post) {
                const p = targetWorker.post(payload);
                if (p && typeof p.catch === 'function') {
                    p.catch((err) => {
                        finishReject(err instanceof Error ? err : new Error(String(err)));
                    });
                }
            } else if (targetWorker.postMessage) {
                try {
                    targetWorker.postMessage(payload);
                } catch (err) {
                    finishReject(err instanceof Error ? err : new Error(String(err)));
                }
            }
        });
    }

    handleParsedCoords(startFrameIndex, coords, engineMode, parseTimeMs) {
        if (parseTimeMs !== undefined) {
            logger.recordParseMetric(engineMode, parseTimeMs, coords.length);
        }

        if (Array.isArray(coords)) {
            coords.forEach((coordArray, i) => {
                const fIdx = startFrameIndex + i;
                this.frameBuffer.set(fIdx, coordArray);
                if (fIdx === 0 && !this.initialCoords) {
                    this.initialCoords = new Float32Array(coordArray);
                }

                if (this.pendingFrameListeners.has(fIdx)) {
                    const listeners = this.pendingFrameListeners.get(fIdx);
                    this.pendingFrameListeners.delete(fIdx);
                    listeners.forEach(listener => {
                        if (typeof listener === 'function') {
                            listener(coordArray, null);
                        } else if (listener && typeof listener.resolve === 'function') {
                            listener.resolve(coordArray);
                        }
                    });
                }
            });

            // Enforce dynamic adaptive RAM cache budget on every chunk insertion
            const activeBufferBytes = this.atomCount * 3 * 4 * this.frameBuffer.size;
            const maxCacheBytes = this.maxCacheBytes || getDynamicMemoryLimit();

            if (activeBufferBytes > maxCacheBytes && this.frameBuffer.size > 2) {
                const playhead = (typeof this.currentFrame === 'number') ? this.currentFrame : startFrameIndex;
                const candidateKeys = Array.from(this.frameBuffer.keys())
                    .filter(k => k !== 0 && k !== playhead && !this.activeChunks.has(k) && !this.pendingFrameListeners.has(k))
                    .sort((a, b) => Math.abs(b - playhead) - Math.abs(a - playhead));

                for (const key of candidateKeys) {
                    this.frameBuffer.delete(key);
                    if (this.atomCount * 3 * 4 * this.frameBuffer.size <= maxCacheBytes) {
                        break;
                    }
                }
            }
        }
    }

    handleUnrecoverableChunkFailure(chunkStart, chunkEnd, error) {
        const errorMsg = error?.message || 'Unrecoverable trajectory chunk failure';
        if (this.engine?.notify) {
            this.engine.notify('error', `Trajectory decoder error: ${errorMsg}`);
        }

        if (typeof this.onError === 'function') {
            this.onError(errorMsg);
        }

        // 3. Flush pending promises across startFrameIndex to startFrameIndex + fetchSize
        for (let fIdx = chunkStart; fIdx < chunkEnd; fIdx++) {
            if (this.pendingFrameListeners.has(fIdx)) {
                const listeners = this.pendingFrameListeners.get(fIdx);
                this.pendingFrameListeners.delete(fIdx);
                listeners.forEach(listener => {
                    if (typeof listener === 'function') {
                        listener(null, error);
                    } else if (listener && typeof listener.reject === 'function') {
                        listener.reject(error);
                    }
                });
            }
        }
    }

    /**
     * Initializes native NGL.CallbackTrajectory
     */
    initCallbackTrajectory(params = {}) {
        if (!this.comp || typeof this.comp.addTrajectory !== 'function') return null;

        const requestCallback = (responseCallback, frameIdx) => {
            if (this.disposed || (this.trajElement && this.trajElement.trajectory && this.trajElement.trajectory._disposed)) {
                return;
            }
            if (frameIdx === undefined || frameIdx === null) {
                if (!this.disposed && !(this.trajElement?.trajectory?._disposed)) {
                    responseCallback(this.frameCount);
                }
                return;
            }

            const options = {
                superpose: !!params.superpose
            };

            const p = this.getFrameCoords(frameIdx, options);
            if (p && typeof p.then === 'function') {
                p.then((coords) => {
                    if (this.disposed || !this.trajElement || (this.trajElement.trajectory && this.trajElement.trajectory._disposed)) {
                        return;
                    }
                    if (coords) {
                        responseCallback(frameIdx, undefined, coords, this.frameCount);
                    }
                }).catch((err) => {
                    report('engine:trajectory', err);
                });
            }
        };

        if (this.trajElement && this.comp) {
            try {
                this.comp.removeTrajectory(this.trajElement);
            } catch (e) {
                // ignore
            }
        }

        this.trajElement = this.comp.addTrajectory(requestCallback, {
            initialFrame: 0,
            defaultStep: params.step || 1,
            defaultTimeout: params.timeout || 50,
            defaultInterpolateType: params.interpolateType || 'spline'
        });

        if (this.trajElement && this.trajElement.trajectory) {
            this.trajectory = this.trajElement.trajectory;
        }

        return this.trajElement;
    }

    dispose() {
        this.disposed = true;
        if (this.gatekeeper) {
            this.gatekeeper.reset();
        }
        if (this.trajElement && this.comp) {
            try {
                this.comp.removeTrajectory(this.trajElement);
            } catch (e) {
                // ignore
            }
            this.trajElement = null;
            this.trajectory = null;
        }
        if (this.counter) {
            this.counter.dispose();
        }
        if (this.signals) {
            if (this.signals.frameChanged) this.signals.frameChanged.dispose();
            if (this.signals.countChanged) this.signals.countChanged.dispose();
        }
        this.frameBuffer.clear();
        this.activeChunks.clear();
        this.pendingChunkQueue = [];
        this.activeChunkJobs = 0;
        this.pendingFrameListeners.clear();
        this.initialCoords = null;
        this.superposeIndices = null;
        this.customSuperposeQuery = null;
    }
}

