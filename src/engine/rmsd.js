import * as NGL from 'ngl';
import { hornSuperpose } from './analytics.js';
import { logger } from '../shared/logger.js';
import { EVENTS } from '../contracts/events.js';

export class RmsdController {
    constructor(engine) {
        this.engine = engine;
        this.runs = [];
        this.lastSeries = null;
        this.config = {
            fit: 'protein and .CA',
            calc: 'protein and .CA',
            stride: 'auto'
        };
        this.activeTaskId = null;
    }

    getRmsdConfig() {
        return { ...this.config };
    }

    setRmsdConfig(patch = {}) {
        this.config = { ...this.config, ...patch };
    }

    countAtoms(selection) {
        if (!this.engine?.comp?.structure || !selection) return 0;
        try {
            const indices = this.engine.comp.structure.getAtomIndices(new NGL.Selection(selection));
            return indices ? indices.length : 0;
        } catch {
            return 0;
        }
    }

    getRmsdRuns() {
        return this.runs.map(r => ({
            id: r.id,
            name: r.name,
            fitQuery: r.fitQuery,
            calcQuery: r.calcQuery,
            stats: { ...r.stats },
            totalFrames: r.totalFrames,
            pointCount: r.series?.length || 0
        }));
    }

    getRmsdRun(id) {
        const run = this.runs.find(r => r.id === id);
        if (!run) return null;
        return {
            id: run.id,
            name: run.name,
            fitQuery: run.fitQuery,
            calcQuery: run.calcQuery,
            stats: { ...run.stats },
            totalFrames: run.totalFrames,
            calculatedFrames: [...(run.calculatedFrames || [])],
            series: Object.freeze(run.series.map(pt => ({ ...pt })))
        };
    }

    cancelRmsd() {
        if (this.activeTaskId) {
            this.activeTaskId = null;
            this.engine.emit(EVENTS.ENGINE_BUSY, { busy: false, task: 'rmsd' });
        }
    }

    clear() {
        this.runs = [];
        this.lastSeries = null;
        this.activeTaskId = null;
        if (this.engine) {
            this.engine.lastRmsdSeries = null;
            this.engine.rmsdRuns = [];
        }
    }

    async computeRmsd(options = {}) {
        if (this.engine?.isIndexing) {
            this.engine.notify?.('warning', 'Indexing in progress. Please wait until indexing completes.');
            this.engine.emit?.(EVENTS.ENGINE_BUSY, { busy: false, task: 'rmsd' });
            throw new Error('Indexing in progress');
        }

        const fitQ = options.fit || options.fitQuery || this.config.fit || 'protein and .CA';
        const calcQ = options.calc || options.calcQuery || this.config.calc || 'protein and .CA';
        const rawStride = options.stride !== undefined ? options.stride : this.config.stride;
        const onProgress = options.onProgress;

        this.setRmsdConfig({ fit: fitQ, calc: calcQ, stride: rawStride });

        if (this.engine.isPlaying) this.engine.playbackController?.pause();

        if (!this.engine.comp || !this.engine.comp.structure) {
            this.engine.notify('warning', 'No active structure loaded for RMSD calculation.');
            this.engine.emit?.(EVENTS.ENGINE_BUSY, { busy: false, task: 'rmsd' });
            return [];
        }

        const totalFrames = this.engine.ringBuffer?.frameCount || (this.engine.fileOffsets && this.engine.fileOffsets.length > 1 ? this.engine.fileOffsets.length - 1 : 0);
        if (totalFrames <= 0) {
            this.engine.notify('warning', 'No trajectory frames loaded for RMSD calculation.');
            this.engine.emit?.(EVENTS.ENGINE_BUSY, { busy: false, task: 'rmsd' });
            return [];
        }

        let fitIndices = [];
        let calcIndices = [];
        try {
            fitIndices = this.engine.comp.structure.getAtomIndices(new NGL.Selection(fitQ)) || [];
            calcIndices = this.engine.comp.structure.getAtomIndices(new NGL.Selection(calcQ)) || [];
        } catch (e) {
            console.warn('[RMSD] Selection parse error:', e);
        }

        if (!fitIndices || fitIndices.length === 0 || !calcIndices || calcIndices.length === 0) {
            this.engine.notify('error', 'Selection matched 0 atoms. Check your query.');
            this.engine.emit?.(EVENTS.ENGINE_BUSY, { busy: false, task: 'rmsd' });
            return [];
        }

        const currentTaskId = Date.now() + Math.random();
        this.activeTaskId = currentTaskId;
        this.engine.activeAnalysisTaskId = currentTaskId;

        this.engine.emit(EVENTS.ENGINE_BUSY, { busy: true, task: 'rmsd' });

        let selectedStride = null;
        if (rawStride !== 'auto' && rawStride !== null && rawStride !== undefined) {
            const parsed = parseInt(rawStride, 10);
            if (!isNaN(parsed) && parsed > 0) {
                selectedStride = parsed;
            }
        }

        const frameStride = (selectedStride !== null && selectedStride > 0)
            ? Math.max(1, Math.floor(selectedStride))
            : (totalFrames > 2500 ? Math.ceil(totalFrames / 2500) : 1);
        const dt = this.engine.deltaTime || 100;

        try {
            // 1. Reference Frame 0
            const refCoordsAll = (typeof this.engine.ringBuffer.getFrameCoords === 'function')
                ? await this.engine.ringBuffer.getFrameCoords(0)
                : null;

            if (!refCoordsAll) {
                return [];
            }

            const isCancelled = () => (
                this.activeTaskId !== currentTaskId ||
                (this.engine && this.engine.activeAnalysisTaskId !== currentTaskId)
            );

            if (isCancelled()) {
                return [];
            }

            // Map and pre-filter unique atoms involved in fit and calc groups
            const uniqueIndices = Array.from(new Set([...fitIndices, ...calcIndices]));
            const numUnique = uniqueIndices.length;
            const indexMap = new Map();
            for (let i = 0; i < numUnique; i++) {
                indexMap.set(uniqueIndices[i], i);
            }
            const localFitIndices = fitIndices.map(idx => indexMap.get(idx));
            const localCalcIndices = calcIndices.map(idx => indexMap.get(idx));

            // Extract lightweight pre-filtered reference coordinates
            const refFiltered = new Float32Array(numUnique * 3);
            for (let i = 0; i < numUnique; i++) {
                const src3 = uniqueIndices[i] * 3;
                const dst3 = i * 3;
                refFiltered[dst3]     = refCoordsAll[src3];
                refFiltered[dst3 + 1] = refCoordsAll[src3 + 1];
                refFiltered[dst3 + 2] = refCoordsAll[src3 + 2];
            }

            const targetFrames = [];
            for (let f = 0; f < totalFrames; f += frameStride) {
                targetFrames.push(f);
            }

            const batchSize = 25;
            const batches = [];
            for (let i = 0; i < targetFrames.length; i += batchSize) {
                batches.push(targetFrames.slice(i, i + batchSize));
            }

            const resultsByFrame = new Map();
            const maxConcurrency = 2;
            let batchIdx = 0;
            let activeCount = 0;

            const workerPool = this.engine.workerManager?.pool || this.engine.workerManager;
            const allOffsets = this.engine.ringBuffer?.fileOffsets || this.engine.fileOffsets || [];
            const allFrameTimes = this.engine.ringBuffer?.frameTimes || this.engine.frameTimes || [];

            const runBatch = async (batch) => {
                if (isCancelled()) return;

                const bStart = batch[0];
                const bEnd = batch[batch.length - 1];

                let batchResults = null;

                if (workerPool) {
                    const worker = typeof workerPool.getNextWorker === 'function'
                        ? workerPool.getNextWorker()
                        : workerPool;

                    if (worker) {
                        const slicedOffsets = (allOffsets && allOffsets.length > bStart)
                            ? allOffsets.slice(bStart, bEnd + 2)
                            : [];
                        const slicedTimes = (allFrameTimes && allFrameTimes.length > bStart)
                            ? allFrameTimes.slice(bStart, bEnd + 1)
                            : [];

                        const workerPayload = {
                            type: 'stream_compute_rmsd',
                            file: this.engine.ringBuffer?.xtcFile || this.engine.xtcFile,
                            startFrame: bStart,
                            endFrame: bEnd,
                            targetFrames: batch,
                            filteredBatch: batch.map(f => ({ frame: f + 1 })),
                            stride: frameStride,
                            frameOffsets: slicedOffsets,
                            offsetBase: bStart,
                            refFiltered: refFiltered,
                            fitIndices: localFitIndices,
                            calcIndices: localCalcIndices,
                            uniqueIndices: uniqueIndices,
                            frameTimes: slicedTimes,
                            timeBase: bStart,
                            dt: dt,
                            expectedAtoms: this.engine.ringBuffer?.atomCount || this.engine.comp?.structure?.atomCount || 0,
                            fileSize: this.engine.ringBuffer?.xtcFile?.size || this.engine.xtcFile?.size,
                            ext: this.engine.ringBuffer?.trajExt || this.engine.trajExt || 'xtc'
                        };

                        let res;
                        try {
                            res = await worker.post(workerPayload);
                        } catch (wErr) {
                            throw new Error(`RMSD worker failed: ${wErr?.message || wErr}`);
                        }

                        if (isCancelled()) return;
                        if (res && res.error) {
                            throw new Error(`RMSD worker failed: ${res.error}`);
                        }
                        if (res && (res.results?.length || res.rmsdSeries?.length)) {
                            batchResults = res.results || res.rmsdSeries;
                        }
                    }
                }

                // Bounded fallback for non-worker environments (e.g., node / headless tests with mock ringBuffer)
                if (!batchResults && !isCancelled() && typeof this.engine.ringBuffer?.getFrameCoords === 'function') {
                    batchResults = [];
                    const compactCoords = new Float32Array(numUnique * 3);
                    for (const f of batch) {
                        if (isCancelled()) break;
                        let frameCoords = null;
                        try {
                            frameCoords = await this.engine.ringBuffer.getFrameCoords(f);
                        } catch (e) {
                            continue;
                        }
                        if (!frameCoords) continue;

                        for (let i = 0; i < numUnique; i++) {
                            const src3 = uniqueIndices[i] * 3;
                            const dst3 = i * 3;
                            compactCoords[dst3]     = frameCoords[src3];
                            compactCoords[dst3 + 1] = frameCoords[src3 + 1];
                            compactCoords[dst3 + 2] = frameCoords[src3 + 2];
                        }

                        const { rmsd } = hornSuperpose(compactCoords, refFiltered, localFitIndices, localCalcIndices, false);
                        const timeNs = (((f) * dt) / 1000).toFixed(2);
                        batchResults.push({ frame: f + 1, timeNs, rmsd });

                        if (f !== 0 && this.engine.ringBuffer && this.engine.ringBuffer.frameBuffer && typeof this.engine.ringBuffer.frameBuffer.delete === 'function') {
                            this.engine.ringBuffer.frameBuffer.delete(f);
                        }
                    }
                }

                if (isCancelled()) return;

                if (batchResults) {
                    for (const item of batchResults) {
                        resultsByFrame.set(item.frame, item);
                    }
                }
            };

            const promises = [];
            while (batchIdx < batches.length && !isCancelled()) {
                while (activeCount >= maxConcurrency && !isCancelled()) {
                    await new Promise(r => setTimeout(r, 10));
                }
                if (isCancelled()) break;

                const currentBatch = batches[batchIdx++];
                activeCount++;
                const p = runBatch(currentBatch).finally(() => {
                    activeCount--;
                    if (!isCancelled()) {
                        const completedCount = resultsByFrame.size;
                        const totalTarget = targetFrames.length;
                        const pct = Math.min(100, Math.round((completedCount / totalTarget) * 100));
                        const currentTrajectoryFrame = completedCount > 0
                            ? (targetFrames[Math.min(targetFrames.length - 1, completedCount - 1)] + 1)
                            : 1;

                        const progressDetail = {
                            frame: currentTrajectoryFrame,
                            totalFrames: totalFrames,
                            point: completedCount,
                            totalPoints: totalTarget,
                            percent: pct
                        };

                        if (typeof onProgress === 'function') {
                            onProgress(progressDetail);
                        }

                        this.engine.emit(EVENTS.RMSD_PROGRESS, progressDetail);
                    }
                });
                promises.push(p);
            }

            await Promise.all(promises);

            if (isCancelled()) {
                return [];
            }

            const rmsdSeries = targetFrames.map(f => resultsByFrame.get(f + 1)).filter(Boolean);
            this.lastSeries = rmsdSeries;
            if (this.engine) {
                this.engine.lastRmsdSeries = rmsdSeries;
            }

            const vals = rmsdSeries.map(s => s.rmsd);
            const minV = vals.length ? Math.min(...vals).toFixed(2) : '0.00';
            const maxV = vals.length ? Math.max(...vals).toFixed(2) : '0.00';
            const avgV = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '0.00';

            const runName = `${calcQ}` + (calcQ !== fitQ ? ` (fit: ${fitQ})` : '');
            const runId = `rmsd_run_${Date.now()}`;
            const newRun = Object.assign([...rmsdSeries], {
                id: runId,
                name: runName,
                fitQuery: fitQ,
                calcQuery: calcQ,
                series: rmsdSeries,
                stats: { min: parseFloat(minV), max: parseFloat(maxV), avg: parseFloat(avgV) },
                totalFrames: totalFrames,
                calculatedFrames: rmsdSeries.map(s => s.frame)
            });

            this.runs.push(newRun);
            if (this.engine) {
                this.engine.rmsdRuns = this.runs;
            }

            this.engine.emit(EVENTS.RMSD_COMPUTED, {
                runId: newRun.id,
                series: rmsdSeries,
                fitQuery: fitQ,
                calcQuery: calcQ
            });

            if (frameStride > 1) {
                this.engine.notify('success', `Computed RMSD for ${rmsdSeries.length} points (stride: every ${frameStride} frames)`);
            } else {
                this.engine.notify('success', `Computed RMSD across ${rmsdSeries.length} frames`);
            }

            return newRun;
        } catch (err) {
            logger.log('error', 'RMSD', 'Error computing RMSD time series', err);
            this.engine.notify('error', err?.message || 'Error during RMSD calculation');
            throw err;
        } finally {
            if (this.activeTaskId === currentTaskId) {
                this.activeTaskId = null;
            }
            if (this.engine.activeAnalysisTaskId === currentTaskId) {
                this.engine.activeAnalysisTaskId = null;
            }
            this.engine.emit(EVENTS.ENGINE_BUSY, { busy: false, task: 'rmsd' });
        }
    }
}
