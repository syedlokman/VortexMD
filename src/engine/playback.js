import { RingBufferManager } from './trajectory.js';
import { EVENTS } from '../contracts/events.js';
import { report } from '../shared/guard.js';

export function formatPhysicalTime(ps) {
    if (ps < 0) ps = 0;
    if (ps >= 1000000) {
        return `${(ps / 1000000).toFixed(2)} µs`;
    } else if (ps >= 1000) {
        return `${(ps / 1000).toFixed(2)} ns`;
    } else {
        return `${ps.toFixed(2)} ps`;
    }
}

export const BASE_FRAMES_PER_SECOND = 30;

export class PlaybackController {
    constructor(engine) {
        this.engine = engine;
    }

    setEngineMode(mode) {
        this.engine.engineMode = mode;
        if (this.engine.ringBuffer) {
            this.engine.ringBuffer.engineMode = mode;
        }
    }

    setPlaybackDirection(direction) {
        if (['forward', 'backward', 'bounce'].includes(direction)) {
            this.engine.playbackDirection = direction;
            if (direction === 'bounce') {
                this.engine.bounceDirection = 1;
                this.setLoop(true);
            }
        }
    }

    setPlaybackSpeed(speed) {
        const val = parseFloat(speed);
        if (!isNaN(val) && val > 0) {
            this.engine.speedMultiplier = val;
        }
    }

    setFrameStep(step) {
        const parsed = parseInt(step, 10);
        if ([1, 2, 5, 10].includes(parsed)) {
            this.engine._frameStep = parsed;
        }
    }

    setSplineInterpolation(enabled) {
        this.engine.useSplineInterpolation = !!enabled;
    }

    setSuperpose(enabled, customQuery = null) {
        this.engine.superpose = !!enabled;
        if (customQuery !== null && customQuery !== undefined) {
            this.engine.customSuperposeQuery = customQuery;
            if (this.engine.ringBuffer) {
                this.engine.ringBuffer.customSuperposeQuery = customQuery;
                this.engine.ringBuffer.superposeIndices = null;
            }
        }
        this.renderFrame(this.engine._currentFrame, this.engine.subframe);
    }

    setPhysicalTimeConfig(deltaTimePs, timeOffsetPs) {
        if (deltaTimePs !== undefined && deltaTimePs !== null) {
            const dt = typeof deltaTimePs === 'number' ? deltaTimePs : parseFloat(deltaTimePs);
            if (Number.isFinite(dt) && dt > 0) {
                this.engine._deltaTime = dt;
            }
        }
        if (timeOffsetPs !== undefined && timeOffsetPs !== null) {
            const to = typeof timeOffsetPs === 'number' ? timeOffsetPs : parseFloat(timeOffsetPs);
            if (Number.isFinite(to)) {
                this.engine._timeOffset = to;
            }
        }

        this.engine.emit(EVENTS.TIME_CONFIG_CHANGED, {
            deltaTime: this.engine.deltaTime,
            timeOffset: this.engine.timeOffset,
            isTimeCalibrated: Boolean(this.engine.isTimeCalibrated)
        });

        this.renderFrame(this.engine._currentFrame, this.engine.subframe || 0);
    }

    renderFrame(frameIndex, subframe = 0) {
        if (!this.engine.comp) return;

        if (!this.engine.ringBuffer || this.engine.ringBuffer.frameCount === 0) {
            this.engine._currentFrame = 0;
            this.engine.subframe = 0;
            this.engine.emit(EVENTS.FRAME_UPDATE, {
                frame: 0,
                frameIndex: 0,
                subframe: 0,
                physTimePs: 0,
                physTimeFormatted: '0.00 ps',
                isTimeCalibrated: this.engine.isTimeCalibrated,
                direction: this.engine.playbackDirection,
                step: this.engine.frameStep,
                superpose: this.engine.superpose
            });
            return;
        }

        const options = this._frameOptions || (this._frameOptions = { subframe: 0, interpolateType: 'none', superpose: false });
        options.subframe = subframe;
        options.interpolateType = this.engine.useSplineInterpolation ? 'spline' : 'none';
        options.superpose = this.engine.superpose;

        const p = this.engine.ringBuffer.getFrameCoords(frameIndex, options, (coords) => {
            if (!this.engine.comp || !this.engine.comp.structure || this.engine.ringBuffer?.disposed) return;
            if (coords) {
                this.engine.comp.structure.updatePosition(coords);
                this.engine.comp.updateRepresentations({ position: true });
                
                try {
                    this.engine.interactionManager?.updateValues();
                } catch (e) {
                    report('engine:measurement', e);
                }

                this.engine._currentFrame = frameIndex;
                this.engine.subframe = subframe;

                const displayFrame = frameIndex + 1;

                let physPs;
                if (this.engine.frameTimes && this.engine.frameTimes.length > frameIndex) {
                    const tCurrent = this.engine.frameTimes[frameIndex];
                    if (subframe !== 0 && frameIndex + 1 < this.engine.frameTimes.length) {
                        const tNext = this.engine.frameTimes[frameIndex + 1];
                        physPs = this.engine.timeOffset + tCurrent + (tNext - tCurrent) * subframe;
                    } else {
                        physPs = this.engine.timeOffset + tCurrent + subframe * this.engine.deltaTime;
                    }
                } else {
                    physPs = this.engine.timeOffset + (frameIndex + subframe) * this.engine.deltaTime;
                }
                const formattedTime = formatPhysicalTime(physPs);

                const detail = this._frameUpdateDetail || (this._frameUpdateDetail = {});
                detail.frame = displayFrame;
                detail.frameIndex = frameIndex;
                detail.subframe = subframe;
                detail.physTimePs = physPs;
                detail.physTimeFormatted = formattedTime;
                detail.isTimeCalibrated = this.engine.isTimeCalibrated;
                detail.direction = this.engine.playbackDirection;
                detail.step = this.engine.frameStep;
                detail.superpose = this.engine.superpose;

                this.engine.emit(EVENTS.FRAME_UPDATE, detail);
            }
        });

        if (p && typeof p.catch === 'function') {
            p.catch((err) => {
                report('engine:playback', err);
                if (this.engine.isPlaying) {
                    this.pause();
                }
            });
        }
    }

    // Unified Physics Clock Render Loop (30 FPS base rate)
    playLoop(timestamp) {
        if (!this.engine.isPlaying || !this.engine.ringBuffer) return;

        let scheduled = false;
        const schedule = () => {
            if (!scheduled && this.engine.isPlaying) {
                scheduled = true;
                this.engine.playTimer = requestAnimationFrame((ts) => this.playLoop(ts));
            }
        };

        try {
            if (!this.engine.lastFrameTime) this.engine.lastFrameTime = timestamp || performance.now();
            const rawElapsed = (timestamp || performance.now()) - this.engine.lastFrameTime;
            this.engine.lastFrameTime = timestamp || performance.now();
            const elapsed = Math.min(Math.max(0, rawElapsed), 100);

            const totalFrames = this.engine.ringBuffer.frameCount;
            if (totalFrames <= 0) return;

            const dirSign = (this.engine.playbackDirection === 'bounce')
                ? (this.engine.bounceDirection || 1)
                : (this.engine.playbackDirection === 'backward' ? -1 : 1);

            const step = Math.max(1, this.engine.frameStep);
            const speed = this.engine.speedMultiplier;
            const framesToAdvance = (elapsed / 1000) * BASE_FRAMES_PER_SECOND * speed * step * dirSign;

            if (this.engine.useSplineInterpolation) {
                this.engine.subframe += framesToAdvance;

                if (this.engine.subframe >= 1.0) {
                    const advance = Math.floor(this.engine.subframe);
                    this.engine._currentFrame += advance;
                    this.engine.subframe -= advance;
                } else if (this.engine.subframe < 0.0) {
                    const drop = Math.floor(Math.abs(this.engine.subframe)) + 1;
                    this.engine._currentFrame -= drop;
                    this.engine.subframe += drop;
                }
            } else {
                this.engine.frameTimeAccumulator += framesToAdvance;
                const wholeSteps = Math.trunc(this.engine.frameTimeAccumulator);
                if (wholeSteps !== 0) {
                    this.engine._currentFrame += wholeSteps;
                    this.engine.frameTimeAccumulator -= wholeSteps;
                    this.engine.subframe = 0;
                } else {
                    schedule();
                    return;
                }
            }

            // Handle trajectory boundaries (forward, backward, bounce, loop)
            const minBound = this.engine.loopStartFrame;
            const maxBound = (this.engine.loopEndFrame !== null) ? Math.min(this.engine.loopEndFrame, totalFrames - 1) : (totalFrames - 1);

            if (this.engine.playbackDirection === 'bounce') {
                if (this.engine._currentFrame >= maxBound) {
                    this.engine._currentFrame = maxBound;
                    this.engine.bounceDirection = -1;
                    if (this.engine.subframe > 0) this.engine.subframe = 0;
                } else if (this.engine._currentFrame <= minBound) {
                    this.engine._currentFrame = minBound;
                    this.engine.bounceDirection = 1;
                    if (this.engine.subframe < 0) this.engine.subframe = 0;
                }
            } else if (this.engine._currentFrame >= maxBound) {
                if (this.engine.isLooping) {
                    this.engine._currentFrame = minBound;
                    this.engine.subframe = 0;
                } else if (this.engine.isIndexing) {
                    // Background indexing in progress: wait at current indexed boundary for new frames
                    this.engine._currentFrame = maxBound;
                    this.engine.subframe = 0;
                    this.renderFrame(this.engine._currentFrame, 0);
                    schedule();
                    return;
                } else {
                    this.engine._currentFrame = maxBound;
                    this.engine.subframe = 0;
                    this.renderFrame(this.engine._currentFrame, 0);
                    this.pause();
                    this.engine.emit(EVENTS.PLAYBACK_ENDED);
                    return;
                }
            } else if (this.engine._currentFrame <= minBound) {
                if (this.engine.playbackDirection === 'backward') {
                    if (this.engine.isLooping) {
                        this.engine._currentFrame = maxBound;
                        this.engine.subframe = 0;
                    } else {
                        this.engine._currentFrame = minBound;
                        this.engine.subframe = 0;
                        this.renderFrame(this.engine._currentFrame, 0);
                        this.pause();
                        this.engine.emit(EVENTS.PLAYBACK_ENDED);
                        return;
                    }
                } else {
                    this.engine._currentFrame = minBound;
                    if (this.engine.subframe < 0) this.engine.subframe = 0;
                }
            }

            this.renderFrame(this.engine._currentFrame, this.engine.subframe);
            schedule();
        } catch (err) {
            report('engine:playback', err);
        } finally {
            if (this.engine.isPlaying && !scheduled) {
                schedule();
            }
        }
    }

    hasSurfaceRepresentation() {
        if (!this.engine.displayConfig) return false;
        const cfg = this.engine.displayConfig;
        if (cfg.proteins?.visible && (cfg.proteins.style === 'surface' || Object.values(cfg.proteins.chains || {}).some(c => c && c.visible && c.style === 'surface'))) return true;
        if (cfg.rna?.visible && (cfg.rna.style === 'surface' || Object.values(cfg.rna.chains || {}).some(c => c && c.visible && c.style === 'surface'))) return true;
        if (cfg.dna?.visible && (cfg.dna.style === 'surface' || Object.values(cfg.dna.chains || {}).some(c => c && c.visible && c.style === 'surface'))) return true;
        if (cfg.ligands?.visible && (cfg.ligands.style === 'surface' || Object.values(cfg.ligands.items || {}).some(l => l && l.visible && l.style === 'surface'))) return true;
        if (cfg.membrane?.visible && cfg.membrane.style === 'surface') return true;
        if (cfg.saccharides?.visible && cfg.saccharides.style === 'surface') return true;
        if (cfg.ions?.visible && cfg.ions.style === 'surface') return true;
        if (cfg.water?.visible && cfg.water.style === 'surface') return true;
        if (cfg.customSelections && cfg.customSelections.some(s => s && s.visible !== false && s.style === 'surface')) return true;
        return false;
    }

    play() {
        if (this.engine.activeAnalysisTaskId) {
            this.engine.activeAnalysisTaskId = null;
        }
        if (this.engine.isPlaying) return;
        if (!this.engine.ringBuffer || this.engine.ringBuffer.frameCount <= 0) return;
        if (this.hasSurfaceRepresentation()) {
            this.engine.notify('info', "Notice: Surface calculation is optimized for static figure export. Playback is paused. Use 'Spacefill' (Sp) for 60 FPS dynamic volume visualization.");
            return;
        }
        this.engine._isPlaying = true;
        this.engine.lastFrameTime = 0;
        if (this.engine.viewportManager) {
            this.engine.viewportManager.setAdaptiveQuality(true);
        }
        this.engine.playTimer = requestAnimationFrame((ts) => this.playLoop(ts));
        this.engine.emit(EVENTS.PLAYBACK_STARTED);
    }

    pause() {
        if (!this.engine.isPlaying && !this.engine.playTimer) return;
        this.engine._isPlaying = false;
        if (this.engine.playTimer) {
            cancelAnimationFrame(this.engine.playTimer);
            this.engine.playTimer = null;
        }
        this.engine.lastFrameTime = 0;
        this.engine.frameTimeAccumulator = 0;
        if (this.engine.viewportManager) {
            this.engine.viewportManager.setAdaptiveQuality(false);
        }
        this.engine.emit(EVENTS.PLAYBACK_PAUSED);
    }

    setLoop(enabled) {
        this.engine._isLooping = Boolean(enabled);
    }

    setLoopRange(start, end) {
        this.engine.loopStartFrame = Math.max(0, start !== null ? start : 0);
        this.engine.loopEndFrame = end !== null ? end : null;
    }

    clearLoopRange() {
        this.engine.loopStartFrame = 0;
        this.engine.loopEndFrame = null;
    }

    jumpToFrame(frameIndex) {
        if (this.engine.activeAnalysisTaskId) {
            this.engine.activeAnalysisTaskId = null;
        }
        if (this.engine.ringBuffer && this.engine.ringBuffer.frameCount > 0) {
            const targetIdx = frameIndex >= 1 ? Math.min(frameIndex - 1, this.engine.ringBuffer.frameCount - 1) : 0;
            this.engine._currentFrame = targetIdx;
            this.engine.subframe = 0;
            this.renderFrame(targetIdx, 0);
        } else {
            this.engine._currentFrame = 0;
            this.engine.subframe = 0;
            this.renderFrame(0, 0);
        }
    }

    initBufferPipeline(atomCount, ext = 'xtc') {
        if (!this.engine.comp || this.engine.fileOffsets.length === 0) return;
        if (this.engine.ringBuffer) this.engine.ringBuffer.dispose();

        this.engine.ringBuffer = new RingBufferManager(
            this.engine.xtcFile,
            this.engine.fileOffsets,
            atomCount,
            this.engine.comp,
            this.engine.workerManager,
            ext || this.engine.trajExt,
            (message) => {
                this.engine.emit(EVENTS.STREAM_ERROR, { message });
            }
        );
        this.engine.ringBuffer.engine = this.engine;
        this.engine.ringBuffer.engineMode = this.engine.engineMode;
        if (this.engine.customSuperposeQuery) {
            this.engine.ringBuffer.customSuperposeQuery = this.engine.customSuperposeQuery;
        }

        // Initialize CallbackTrajectory
        this.engine.ringBuffer.initCallbackTrajectory({
            step: this.engine.frameStep,
            direction: this.engine.playbackDirection,
            interpolateType: this.engine.useSplineInterpolation ? 'spline' : ''
        });

        this.engine._currentFrame = 0;
        this.engine.subframe = 0;
        this.renderFrame(0, 0);
    }
}
