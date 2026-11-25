// src/engine/session.js
// Single Task: Session State Serialization, Schema Validation & .vortexmd Workspace State Exporter

import * as NGL from 'ngl';
import { logger } from '../shared/logger.js';
import { generateIndexKey, saveCachedIndex } from './index-cache.js';
import { WorkerManager } from './worker-manager.js';
import { setMouseScheme } from './camera.js';
import { downloadBlob } from '../shared/download.js';
import { EVENTS } from '../contracts/events.js';
import { SESSION_SCHEMA_VERSION } from '../contracts/session.js';


export function serializeSessionPayload(payload) {
    const offsets = payload.trajectory?.offsets;
    const frameTimes = payload.trajectory?.frameTimes;
    const hasOffsets = Array.isArray(offsets) && offsets.length > 0;
    const hasFrameTimes = Array.isArray(frameTimes) && frameTimes.length > 0;

    if (hasOffsets || hasFrameTimes) {
        const offsetsPlaceholder = "__TRAJECTORY_OFFSETS_INLINE__";
        const timesPlaceholder = "__TRAJECTORY_FRAMETIMES_INLINE__";

        if (hasOffsets) payload.trajectory.offsets = offsetsPlaceholder;
        if (hasFrameTimes) payload.trajectory.frameTimes = timesPlaceholder;

        // Stringify metadata with indentation
        let json = JSON.stringify(payload, null, 2);

        // Replace placeholders with compact, single-line arrays
        if (hasOffsets) {
            json = json.replace(`"${offsetsPlaceholder}"`, JSON.stringify(offsets));
            payload.trajectory.offsets = offsets;
        }
        if (hasFrameTimes) {
            json = json.replace(`"${timesPlaceholder}"`, JSON.stringify(frameTimes));
            payload.trajectory.frameTimes = frameTimes;
        }
        return json;
    }
    return JSON.stringify(payload, null, 2);
}

export class SessionManager extends EventTarget {
    constructor(player = null) {
        super();
        this.player = player;
        this.createdAt = new Date().toISOString();
    }

    setPlayer(player) {
        this.player = player;
    }

    /**
     * Generates a unique session identifier
     */
    generateSessionId() {
        const timestamp = Date.now().toString(36);
        const randomStr = Math.random().toString(36).substring(2, 9);
        return `session_${timestamp}_${randomStr}`;
    }

    /**
     * Serializes active workspace state into a standardized JSON payload
     * @param {string} [customName='Session'] - Optional name for the session
     * @returns {Object} Validated session payload
     */
    serialize(customName = 'Session') {
        const sessionName = (typeof customName === 'string' && customName.trim()) 
            ? customName.trim() 
            : 'Session';
        const exportedAt = new Date().toISOString();
        const sessionId = this.generateSessionId();

        // 1. Structure & Topology info
        const structureName = this.player?.structureName 
            || this.player?.comp?.structure?.name 
            || (this.player?.comp ? 'Loaded Structure' : 'Unnamed Structure');
        const atomCount = this.player?.atomCount 
            || this.player?.comp?.structure?.atomCount 
            || 0;

        // 2. Playback State
        const currentFrame = (this.player?.currentFrame !== undefined) 
            ? this.player.currentFrame 
            : (this.player?._currentFrame !== undefined ? this.player._currentFrame + 1 : 0);
        
        let totalFrames = 0;
        if (typeof this.player?.frameCount === 'number' && this.player.frameCount > 0) {
            totalFrames = this.player.frameCount;
        } else if (this.player?.ringBuffer?.frameCount) {
            totalFrames = this.player.ringBuffer.frameCount;
        } else if (this.player?.fileOffsets && this.player.fileOffsets.length > 1) {
            totalFrames = this.player.fileOffsets.length - 1;
        } else if (typeof this.player?.totalFrames === 'number') {
            totalFrames = this.player.totalFrames;
        }

        const deltaTime = (this.player?.deltaTime !== undefined) ? this.player.deltaTime : 100;
        const timeOffset = (this.player?.timeOffset !== undefined) ? this.player.timeOffset : 0;
        const speedMultiplier = (this.player?.speed !== undefined) 
            ? this.player.speed 
            : (this.player?.speedMultiplier !== undefined ? this.player.speedMultiplier : 1.0);
        const playbackDirection = this.player?.direction || this.player?.playbackDirection || 'forward';
        const isLooping = (this.player?.isLooping !== undefined) ? Boolean(this.player.isLooping) : false;
        const loopRange = this.player?.loopRange;
        const loopStartFrame = (loopRange?.loopStartFrame !== undefined)
            ? loopRange.loopStartFrame
            : ((this.player?.loopStartFrame !== undefined) ? this.player.loopStartFrame : 0);
        const loopEndFrame = (loopRange?.loopEndFrame !== undefined)
            ? loopRange.loopEndFrame
            : ((this.player?.loopEndFrame !== undefined) ? this.player.loopEndFrame : null);

        // Trajectory byte offsets index & ext (only persist if not actively indexing)
        let offsets = [];
        if (!this.player?.isIndexing) {
            if (Array.isArray(this.player?.fileOffsets)) {
                offsets = Array.from(this.player.fileOffsets);
            } else if (this.player?.fileOffsets && (this.player.fileOffsets instanceof Uint32Array || this.player.fileOffsets instanceof Float64Array)) {
                offsets = Array.from(this.player.fileOffsets);
            }
        }

        let frameTimes = null;
        if (this.player?.frameTimes && (Array.isArray(this.player.frameTimes) || ArrayBuffer.isView(this.player.frameTimes))) {
            frameTimes = Array.from(this.player.frameTimes).map(t => Number(Number(t).toPrecision(9)));
        }

        const trajectoryFingerprint = this.player?.trajectoryFingerprint || null;
        const isTimeCalibrated = Boolean(this.player?.isTimeCalibrated);

        let trajExt = this.player?.trajExt || 'xtc';
        if (!trajExt && typeof this.player?.trajectoryName === 'string') {
            trajExt = (this.player.trajectoryName.split('.').pop() || 'xtc').toLowerCase();
        }

        // 3. Timeline Pins array [{ frame, label }]
        let timelinePins = [];
        const rawPins = this.player?.getPins ? this.player.getPins() : (this.player?.pins || []);
        if (Array.isArray(rawPins) && rawPins.length > 0) {
            timelinePins = rawPins.map(p => ({ frame: p.frame, label: p.label || `Frame ${p.frame}` }));
        }

        // 4. Visual State
        const rawConfig = this.player?.getDisplayConfig ? this.player.getDisplayConfig() : (this.player?.displayConfig || {});
        const displayConfig = JSON.parse(JSON.stringify(rawConfig));

        const stage = this.player?.stage || this.player?.viewportManager?.stage;
        let backgroundColor = 'white';
        let cameraProjection = 'perspective';

        if (stage?.getParameters) {
            const params = stage.getParameters() || {};
            if (params.backgroundColor) backgroundColor = params.backgroundColor;
            if (params.cameraType) cameraProjection = params.cameraType;
        }

        // Depth slicing value (read from player instance property)
        const depthSlicing = this.player?.depthSlicing ?? 0;

        // Mouse Scheme
        const mouseScheme = this.player?.mouseScheme || 'default';

        // 5. Camera Orientation Extraction
        let cameraOrientation = null;
        if (stage?.viewerControls?.getOrientation) {
            try {
                const rawOrientation = stage.viewerControls.getOrientation();
                if (rawOrientation) {
                    if (rawOrientation.elements) {
                        cameraOrientation = Array.from(rawOrientation.elements);
                    } else if (Array.isArray(rawOrientation)) {
                        cameraOrientation = [...rawOrientation];
                    } else if (typeof rawOrientation.toArray === 'function') {
                        cameraOrientation = rawOrientation.toArray();
                    } else {
                        cameraOrientation = rawOrientation;
                    }
                }
            } catch (e) {
                console.warn('Camera orientation extraction skipped:', e);
            }
        }

        // 6. Objects: Measurements, Shapes
        let measurements = [];
        const rawMeas = this.player?.interactionManager?.measurements || this.player?.interactionManager?.getMeasurementData?.() || [];

        if (Array.isArray(rawMeas)) {
            measurements = rawMeas.map(m => {
                const atomIndices = (m.atomIndices || (m.atoms || []).map(a => typeof a === 'number' ? a : a?.index)).filter(idx => typeof idx === 'number');
                return {
                    id: m.id,
                    type: m.type,
                    label: m.label || (m.atomLabels ? m.atomLabels.join(' - ') : undefined),
                    atomIndices,
                    atoms: atomIndices,
                    value: typeof m.value === 'number' ? Number(m.value.toFixed(2)) : m.value,
                    unit: m.unit || (m.type === 'distance' ? 'Å' : '°'),
                    visible: m.visible !== false
                };
            });
        }

        let shapes = [];
        const rawShapes = this.player?.getShapes ? this.player.getShapes() : (this.player?.shapeManager?.getShapes ? this.player.shapeManager.getShapes() : []);

        if (Array.isArray(rawShapes)) {
            shapes = rawShapes.map(s => ({
                id: s.id,
                type: s.type,
                name: s.name,
                sele: s.sele,
                color: s.color,
                opacity: s.opacity,
                visible: s.visible !== false,
                dimensions: Array.isArray(s.dimensions) ? [...s.dimensions] : undefined,
                params: s.params ? JSON.parse(JSON.stringify(s.params)) : {}
            }));
        }

        // 7. Calculated Analytics: RMSD
        const rmsdConfig = this.player?.getRmsdConfig ? this.player.getRmsdConfig() : null;
        let rmsdFitQuery = rmsdConfig?.fit 
            || this.player?.rmsdFitQuery 
            || this.player?.rmsdRuns?.[0]?.fitQuery
            || 'protein and .CA';
        let rmsdCalcQuery = rmsdConfig?.calc 
            || this.player?.rmsdCalcQuery 
            || this.player?.rmsdRuns?.[0]?.calcQuery
            || 'protein and .CA';

        let rmsdSeries = [];
        if (Array.isArray(this.player?.lastRmsdSeries)) {
            rmsdSeries = JSON.parse(JSON.stringify(this.player.lastRmsdSeries));
        }

        let rmsdRuns = [];
        const activeRuns = this.player?.getRmsdRuns ? this.player.getRmsdRuns() : this.player?.rmsdRuns;

        if (Array.isArray(activeRuns) && activeRuns.length > 0) {
            rmsdRuns = JSON.parse(JSON.stringify(activeRuns));
        } else if (rmsdSeries.length > 0) {
            const vals = rmsdSeries.map(s => Number(s.rmsd) || 0);
            const minV = vals.length ? Math.min(...vals) : 0;
            const maxV = vals.length ? Math.max(...vals) : 0;
            const avgV = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            rmsdRuns = [{
                id: 'rmsd_run_1',
                name: `RMSD: ${rmsdCalcQuery}`,
                fitQuery: rmsdFitQuery,
                calcQuery: rmsdCalcQuery,
                series: rmsdSeries,
                stats: { min: minV, max: maxV, avg: avgV },
                calculatedFrames: rmsdSeries.map(s => s.frame)
            }];
        }

        const analytics = {
            rmsd: {
                series: rmsdSeries,
                runs: rmsdRuns,
                fitQuery: rmsdFitQuery,
                calcQuery: rmsdCalcQuery,
                calculatedFrames: rmsdSeries.map(s => s.frame)
            }
        };

        // Assemble unified session payload adhering to schema
        const payload = {
            version: SESSION_SCHEMA_VERSION,
            app: "VortexMD",
            sessionId,
            sessionName,
            createdAt: this.createdAt,
            exportedAt,

            // 1. Structure & Trajectory
            structure: {
                name: this.player?.structureName || this.player?.comp?.structure?.name || 'structure',
                atomCount: atomCount
            },
            trajectory: {
                name: this.player?.trajectoryName || this.player?.xtcFile?.name || null,
                frameCount: totalFrames || (this.player?.ringBuffer?.frameCount || 0),
                ext: trajExt,
                fingerprint: trajectoryFingerprint,
                isTimeCalibrated,
                frameTimes: frameTimes,
                offsets: offsets
            },

            // 2. Playback & Timeline Pins
            playback: {
                currentFrame,
                totalFrames,
                deltaTime,
                timeOffset,
                speedMultiplier,
                playbackDirection,
                isLooping,
                loopRange: {
                    loopStartFrame,
                    loopEndFrame
                },
                pins: timelinePins
            },

            // 3. Visual State & Camera Orientation
            visualState: {
                displayConfig,
                backgroundColor,
                cameraProjection,
                depthSlicing,
                mouseScheme,
                cameraOrientation
            },

            // 4. Objects: Measurements & Shapes
            objects: {
                measurements,
                shapes
            },

            // 5. Calculated Analytics: RMSD
            analytics
        };

        return payload;
    }

    /**
     * Validates an imported session JSON object or string
     * @param {Object|string} json - Session object or raw JSON string
     * @returns {{ valid: boolean, error?: string }} Validation result
     */
    static validate(json) {
        let data = json;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                return { valid: false, error: `Invalid JSON format: ${e.message}` };
            }
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { valid: false, error: 'Session payload must be a valid JSON object.' };
        }

        if (data.app !== "VortexMD") {
            return { valid: false, error: `Invalid application signature: expected "VortexMD", found "${data.app}".` };
        }

        if (data.version !== SESSION_SCHEMA_VERSION) {
            return { valid: false, error: `Unsupported session schema version: "${data.version}". Expected "${SESSION_SCHEMA_VERSION}".` };
        }

        const displayConfig = data.visualState?.displayConfig;
        if (!displayConfig || typeof displayConfig !== 'object' || Array.isArray(displayConfig)) {
            return { valid: false, error: 'Missing or invalid visualState.displayConfig structure in session payload.' };
        }

        return { valid: true };
    }

    /**
     * Instance validate wrapper
     * @param {Object|string} json
     * @returns {{ valid: boolean, error?: string }}
     */
    validate(json) {
        return SessionManager.validate(json);
    }

    /**
     * Exports active workspace state as a formatted .json file download
     * @param {string} [customName] - Session file basename
     * @returns {{ payload: Object, filename: string, blob: Blob }}
     */
    exportToFile(customName) {
        const payload = this.serialize(customName);
        const sessionName = (typeof customName === 'string' && customName.trim()) 
            ? customName.trim() 
            : (payload.sessionName || 'Session');

        const jsonString = serializeSessionPayload(payload);
        const blob = new Blob([jsonString], { type: 'application/json' });

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        const safeSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${safeSessionName}_${dateStr}.json`;

        try {
            downloadBlob(blob, filename);
            logger.log('info', 'SESSION', `Exported workspace session: ${filename}`);
        } catch (err) {
            console.error('Session export error:', err);
            logger.log('error', 'SESSION', `Failed to export session: ${err.message}`);
        }

        return { payload, filename, blob };
    }

    /**
     * Instantly saves or overwrites the current session state.
     * If FileSystemFileHandle is provided, writes directly to disk.
     * Otherwise triggers instant download with existing filename.
     * @param {Object} [options]
     * @param {FileSystemFileHandle} [options.handle]
     * @param {string} [options.filename]
     * @param {string} [options.customName]
     */
    async saveToFile(options = {}) {
        const { handle, filename, customName } = options;
        const baseName = customName || (filename ? filename.replace(/\.json$/i, '') : 'Session');
        const payload = this.serialize(baseName);
        const jsonString = serializeSessionPayload(payload);

        if (handle && typeof handle.createWritable === 'function') {
            try {
                const writable = await handle.createWritable();
                await writable.write(jsonString);
                await writable.close();
                logger.log('info', 'SESSION', `Instantly wrote updated state to file handle`);
                return { success: true, payload, filename: handle.name || filename, method: 'handle' };
            } catch (err) {
                console.warn('File handle write failed, falling back to download:', err);
            }
        }

        const targetFilename = filename || `${baseName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
        const finalFilename = targetFilename.endsWith('.json') ? targetFilename : `${targetFilename}.json`;
        const blob = new Blob([jsonString], { type: 'application/json' });
        downloadBlob(blob, finalFilename);
        logger.log('info', 'SESSION', `Saved updated session: ${finalFilename}`);
        return { success: true, payload, filename: finalFilename, method: 'download' };
    }

    /**
     * Restores session state into player instance.
     * When restored with a matching topology and trajectory, applies pre-computed byte offsets to bypass re-indexing entirely (0s instant restore).
     * If files are not present in browser memory, triggers the Re-Link Modal (#relink-session-modal) with zero console warnings.
     * @param {Object|string} sessionData
     * @param {Object} [targetPlayer]
     * @returns {Promise<boolean>}
     */
    async restoreSession(sessionData, targetPlayer = this.player) {
        let data = sessionData;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                logger.log('error', 'SESSION', `Invalid JSON session format: ${e.message}`);
                return false;
            }
        }

        const validation = SessionManager.validate(data);
        if (!validation.valid) {
            logger.log('error', 'SESSION', `Session validation failed: ${validation.error}`);
            return false;
        }

        const player = targetPlayer || this.player;
        const curStructName = player?.comp?.structure?.name || player?.structureName;
        const expStructName = data.structure?.name;
        const curAtoms = player?.comp?.structure?.atomCount || player?.atomCount || 0;
        const expAtoms = data.structure?.atomCount ?? 0;
        const hasStructure = Boolean(player?.comp?.structure);

        // Check if matching structure is already loaded in browser memory:
        // Structure is loaded AND expected atom count matches (or is 0)
        const atomsMatch = hasStructure && (expAtoms === 0 || curAtoms === expAtoms);

        if (!hasStructure || !atomsMatch) {
            // Cache session data on player for when structure/trajectory are re-linked
            if (player) {
                player._cachedSessionData = data;
            }

            const relinkDetail = {
                structureName: expStructName || '',
                trajectoryName: data.trajectory?.name || null,
                expectedAtoms: expAtoms
            };

            // Dispatch relink-required CustomEvent for outer shell / host application
            const relinkEvent = new CustomEvent(EVENTS.RELINK_REQUIRED, { detail: relinkDetail });
            if (player && typeof player.emit === 'function') {
                player.emit(EVENTS.RELINK_REQUIRED, relinkDetail);
            } else if (player && typeof player.dispatchEvent === 'function' && player !== this) {
                player.dispatchEvent(relinkEvent);
            }

            // Also dispatch on this (SessionManager) for standalone tests
            this.dispatchEvent(new CustomEvent(EVENTS.RELINK_REQUIRED, { detail: data }));

            // In headless/unattached contexts, hydrate playback/visual state on the player
            if (!hasStructure) {
                await SessionManager.hydrate(player, data);
            }

            return true;
        }

        // Filename check: if atom count matches but filename differs, notify warning and proceed
        const nameMatches = curStructName && expStructName &&
            (curStructName.toLowerCase() === expStructName.toLowerCase() ||
             curStructName.replace(/\.[^.]+$/, '').toLowerCase() === expStructName.replace(/\.[^.]+$/, '').toLowerCase());

        if (!nameMatches && expStructName) {
            player.notify?.('warning', `Structure file name "${curStructName}" differs from session ("${expStructName}"), but atom count matches (${curAtoms}). Proceeding with restoration.`);
        }

        return await SessionManager.hydrate(player, data);
    }

    hydrate(player = this.player, data) {
        return SessionManager.hydrate(player, data);
    }

    /**
     * Unified session state hydration: restores workspace visual state, playback configs,
     * timeline pins, camera orientation, 3D measurements, shapes, and analytics.
     * @param {Object} player
     * @param {Object} data
     * @returns {Promise<boolean>}
     */
    static async hydrate(player, data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid session data provided.');
        }

        if (!player) return false;

        player.isImportingSession = true;
        player.sessionId = data.sessionId || null;
        if (player.sessionManager && data.sessionId) {
            player.sessionManager.sessionId = data.sessionId;
        }

        logger.log('info', 'SESSION', `Restoring workspace session "${data.sessionName || 'Unnamed'}" (version: ${data.version || 'unknown'})`);

        const hasStructure = Boolean(player.comp && player.comp.structure);
        if (!hasStructure) {
            player._cachedSessionData = data;
        }

        // 0. Pre-computed Trajectory Byte Offsets & Fast RingBuffer Init
        const trajOffsets = data.trajectory?.offsets;
        const trajFile = player.xtcFile;
        const savedFingerprint = data.trajectory?.fingerprint;

        if (Array.isArray(trajOffsets) && trajOffsets.length > 1) {
            if (trajFile) {
                // Validate fingerprint, monotonicity, and size if trajectory file is already loaded
                let validOffsets = true;
                if (savedFingerprint && player.trajectoryFingerprint && savedFingerprint !== player.trajectoryFingerprint) {
                    validOffsets = false;
                }
                const terminalSize = trajOffsets[trajOffsets.length - 1];
                if (trajFile.size && terminalSize !== trajFile.size) {
                    validOffsets = false;
                }
                for (let i = 1; i < trajOffsets.length; i++) {
                    if (trajOffsets[i] <= trajOffsets[i - 1]) {
                        validOffsets = false;
                        break;
                    }
                }

                if (validOffsets) {
                    const offsetsArr = Array.from(trajOffsets);
                    let frameTimes = null;
                    if (Array.isArray(data.trajectory?.frameTimes)) {
                        frameTimes = new Float32Array(data.trajectory.frameTimes);
                    }
                    if (typeof player._applyIndexMetadata === 'function') {
                        player._applyIndexMetadata(offsetsArr, {
                            frameTimes,
                            isTimeCalibrated: Boolean(data.trajectory?.isTimeCalibrated)
                        });
                    } else {
                        player.fileOffsets = offsetsArr;
                        player.frameTimes = frameTimes;
                        player.isTimeCalibrated = Boolean(data.trajectory?.isTimeCalibrated);
                    }

                    if (player.workerManager) {
                        player.workerManager.terminate();
                        player.workerManager = new WorkerManager();
                    }
                    player.isIndexing = false;
                    if (hasStructure && typeof player.initBufferPipeline === 'function') {
                        player.initBufferPipeline(player.comp.structure.atomCount, data.trajectory.ext || player.trajExt || 'xtc');
                    }
                    const totalFrames = trajOffsets.length - 1;
                    player.emit(EVENTS.INDEXING_COMPLETE, { totalFrames, cached: true });
                } else {
                    player.notify?.('warning', 'Cached trajectory offsets in session did not match the trajectory file. Re-indexing trajectory...');
                    if (hasStructure && typeof player.loadTrajectory === 'function') {
                        player.loadTrajectory(trajFile, player.comp.structure.atomCount);
                    }
                }
            } else {
                // No trajectory file in memory yet: cache session data and do not populate player.fileOffsets
                player._cachedSessionData = data;
            }
        }

        // 1. Display Configuration & Representations
        const displayConfig = data.visualState?.displayConfig;
        if (displayConfig) {
            player.displayConfig = JSON.parse(JSON.stringify(displayConfig));
            if (hasStructure) {
                player.rebuildTreeUI?.();
                player.updateCustomRepresentations?.();
            }
        }

        // 2. Physical Time Configuration (deltaTime, timeOffset)
        const dt = data.playback?.deltaTime !== undefined ? data.playback.deltaTime : null;
        const to = data.playback?.timeOffset !== undefined ? data.playback.timeOffset : null;

        if (player.setPhysicalTimeConfig) {
            player.setPhysicalTimeConfig(dt ?? player.deltaTime ?? 100, to ?? player.timeOffset ?? 0);
        }

        // 3. Playback Parameters
        const speed = data.playback?.speedMultiplier !== undefined ? data.playback.speedMultiplier : 1.0;
        player.setPlaybackSpeed?.(speed);

        const direction = data.playback?.playbackDirection || 'forward';
        player.setPlaybackDirection?.(direction);

        const isLooping = data.playback?.isLooping !== undefined ? Boolean(data.playback.isLooping) : false;
        player.setLoop?.(isLooping);

        const loopStart = data.playback?.loopRange?.loopStartFrame !== undefined 
            ? data.playback.loopRange.loopStartFrame 
            : 0;
        const loopEnd = data.playback?.loopRange?.loopEndFrame !== undefined 
            ? data.playback.loopRange.loopEndFrame 
            : null;
        player.setLoopRange?.(loopStart, loopEnd);

        // 4. Timeline Pins
        const pins = data.playback?.pins || [];
        if (player.setPins) {
            player.setPins(pins);
        } else {
            player.pins = Array.isArray(pins) ? JSON.parse(JSON.stringify(pins)) : [];
        }

        // 5. Visual State & Stage Settings
        const stage = player.stage || player.viewportManager?.stage;
        const bgColor = data.visualState?.backgroundColor;
        if (bgColor) {
            player.setBackgroundColor?.(bgColor);
        }

        const cameraProj = data.visualState?.cameraProjection;
        if (cameraProj) {
            player.setCameraType?.(cameraProj);
        }

        const depthSlice = data.visualState?.depthSlicing;
        if (depthSlice !== undefined) {
            player.setDepthSlicing?.(depthSlice);
        }

        const mouseScheme = data.visualState?.mouseScheme;
        if (mouseScheme) {
            player.setMouseScheme?.(mouseScheme);
        }

        // Camera Orientation Matrix (4x4 element array)
        const cameraOrientation = data.visualState?.cameraOrientation;
        if (cameraOrientation && Array.isArray(cameraOrientation) && cameraOrientation.length === 16 && stage) {
            try {
                const matrix = new NGL.Matrix4();
                matrix.fromArray(cameraOrientation);
                if (typeof stage.viewerControls?.orient === 'function') {
                    stage.viewerControls.orient(matrix);
                } else if (typeof stage.animationControls?.orient === 'function') {
                    stage.animationControls.orient(matrix);
                }
            } catch (err) {
                console.warn('Could not restore camera orientation matrix:', err);
            }
        }

        const emitEvent = (type, detail) => {
            if (typeof player.emit === 'function') {
                player.emit(type, detail);
            } else if (typeof player.dispatchEvent === 'function') {
                player.dispatchEvent(new CustomEvent(type, { detail }));
            }
        };

        if (!hasStructure) {
            player.notify?.('info', "Session configuration loaded. Please load the matching structure file.");
            emitEvent(EVENTS.DISPLAY_CONFIG_CHANGED, {
                config: player.getDisplayConfig?.() ?? player.displayConfig,
                structural: true
            });
            emitEvent(EVENTS.MEASUREMENTS_CHANGED, { count: 0 });
            emitEvent(EVENTS.SHAPES_CHANGED, { shapes: [] });
            emitEvent(EVENTS.PINS_UPDATED, {
                pins: player.getPins?.() ?? (player.pins || [])
            });
            emitEvent(EVENTS.TIME_CONFIG_CHANGED, {
                deltaTime: player.deltaTime ?? 100,
                timeOffset: player.timeOffset ?? 0,
                isTimeCalibrated: Boolean(player.isTimeCalibrated)
            });
            emitEvent(EVENTS.SESSION_RESTORED, { session: data });
            return true;
        }

        // 6. 3D Interatomic Measurement Suite
        const measurements = data.objects?.measurements || [];
        player.clearMeasurements?.();

        if (Array.isArray(measurements) && measurements.length > 0) {
            for (const m of measurements) {
                const atomIndices = m.atomIndices || (Array.isArray(m.atoms) ? m.atoms.map(a => typeof a === 'number' ? a : a?.index).filter(idx => typeof idx === 'number') : []);
                player.restoreMeasurement?.({
                    type: m.type,
                    atomIndices,
                    visible: m.visible !== false
                });
            }
        }

        // 7. Shapes & Geometric Overlays
        const shapes = data.objects?.shapes || [];
        player.clearShapes?.();

        if (Array.isArray(shapes) && shapes.length > 0) {
            for (const s of shapes) {
                if (s.type === 'bounding_box' || s.type === 'box') {
                    if (s.sele && player.comp) {
                        player.addBoundingBox?.(s.sele, s);
                    }
                }
            }
        }

        // 8. Analytics Restoration: RMSD
        if (data.analytics?.rmsd) {
            const rmsdData = data.analytics.rmsd;
            const fitQ = rmsdData.fitQuery || 'protein and .CA';
            const calcQ = rmsdData.calcQuery || 'protein and .CA';

            player.setRmsdConfig?.({ fit: fitQ, calc: calcQ });

            if (Array.isArray(rmsdData.series) && rmsdData.series.length > 0) {
                player.lastRmsdSeries = JSON.parse(JSON.stringify(rmsdData.series));
                player.rmsdRuns = Array.isArray(rmsdData.runs) && rmsdData.runs.length > 0
                    ? JSON.parse(JSON.stringify(rmsdData.runs))
                    : [{
                        id: 'rmsd_run_restored_1',
                        name: `RMSD: ${calcQ}`,
                        fitQuery: fitQ,
                        calcQuery: calcQ,
                        series: player.lastRmsdSeries,
                        calculatedFrames: player.lastRmsdSeries.map(s => s.frame)
                    }];

                if (player.rmsdController) {
                    player.rmsdController.runs = player.rmsdRuns;
                    player.rmsdController.lastSeries = player.lastRmsdSeries;
                    player.rmsdController.setRmsdConfig?.({ fit: fitQ, calc: calcQ });
                }
            }
        }

        // 9. Jump to target frame
        const targetFrame = data.playback?.currentFrame !== undefined ? data.playback.currentFrame : 1;
        if (targetFrame > 0) {
            if (player.playbackController?.jumpToFrame) {
                player.playbackController.jumpToFrame(targetFrame);
            } else {
                player.jumpToFrame?.(targetFrame);
            }
        }

        player.notify?.('success', `Session "${data.sessionName || 'Session'}" restored successfully.`);

        // 10. Emit lifecycle and rebuild events in strict sequence
        emitEvent(EVENTS.DISPLAY_CONFIG_CHANGED, {
            config: player.getDisplayConfig?.() ?? player.displayConfig,
            structural: true
        });

        const finalMeasCount = player.getMeasurements?.()?.length ?? 0;
        emitEvent(EVENTS.MEASUREMENTS_CHANGED, { count: finalMeasCount });

        const finalShapes = player.getShapes?.() ?? [];
        emitEvent(EVENTS.SHAPES_CHANGED, { shapes: finalShapes });

        emitEvent(EVENTS.PINS_UPDATED, {
            pins: player.getPins?.() ?? (player.pins || [])
        });

        emitEvent(EVENTS.TIME_CONFIG_CHANGED, {
            deltaTime: player.deltaTime ?? 100,
            timeOffset: player.timeOffset ?? 0,
            isTimeCalibrated: Boolean(player.isTimeCalibrated)
        });

        emitEvent(EVENTS.SESSION_RESTORED, { session: data });
        return true;
    }
}
