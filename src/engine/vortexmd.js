import * as NGL from 'ngl';
import { generateIndexKey, getCachedIndex, saveCachedIndex, clearIndexCache, getFileFingerprint } from './index-cache.js';
import { WorkerManager } from './worker-manager.js';
import { ViewportManager } from './viewport.js';
import { applyCustomRepresentation, extractMoleculeTree, SELE_NON_SOLVENT } from './representations.js';
import { getChainDefaultColor, getLipidDefaultColor } from '../contracts/display.js';
import { createDefaultDisplayConfig } from './display-config.js';
import { getFormatInfo } from './parser-router.js';
import { InteractionManager } from './measurement.js';
import { setMouseScheme } from './camera.js';
import { logger } from '../shared/logger.js';
import { report } from '../shared/guard.js';
import { ShapeManager } from './shapes.js';
import { exportViewportImage } from './exporter.js';
import { validateTrajectoryCompatibility } from './trajectory-validator.js';
import { SessionManager } from './session.js';

import { PlaybackController, formatPhysicalTime } from './playback.js';
import { RmsdController } from './rmsd.js';
import { EVENTS } from '../contracts/events.js';

const BaseElement = typeof HTMLElement !== 'undefined' 
    ? HTMLElement 
    : (typeof EventTarget !== 'undefined' ? EventTarget : class {});

const VIEWPORT_CSS = `
:host { display: block; width: 100%; height: 100%; min-height: 400px; position: relative; overflow: hidden; box-sizing: border-box; }
*, *::before, *::after { box-sizing: inherit; }
#viewport { width: 100%; height: 100%; position: absolute; inset: 0; background: white; touch-action: none; cursor: grab; }
`;

let sharedSheet = null; // one parsed stylesheet shared by every instance
function getSharedSheet() {
    if (sharedSheet || typeof CSSStyleSheet === 'undefined') return sharedSheet;
    try {
        sharedSheet = new CSSStyleSheet();
        sharedSheet.replaceSync(VIEWPORT_CSS);
    } catch {
        sharedSheet = null;
    }
    return sharedSheet;
}

export class VortexMD extends BaseElement {
    get controls() {
        return this.hasAttribute('controls') && this.getAttribute('controls') !== 'false';
    }

    set controls(val) {
        if (val && val !== 'false') {
            this.setAttribute('controls', '');
        } else {
            this.removeAttribute('controls');
        }
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    constructor() {
        super();
        if (typeof this.attachShadow === 'function') {
            this.attachShadow({ mode: 'open' });
        } else if (!this.shadowRoot) {
            this.shadowRoot = {
                getElementById: () => null,
                querySelectorAll: () => [],
                querySelector: () => null,
                innerHTML: ''
            };
        }
        this._viewportEl = null;
        this.renderUI();
        
        this.fileOffsets = [];
        this.workerManager = new WorkerManager(this);
        this.viewportManager = null;

        // Core Managers
        this.interactionManager = new InteractionManager(null, null, null, (type, detail) => this.emit(type, detail));
        this.shapeManager = new ShapeManager(null);
        this.sessionManager = new SessionManager(this);

        // Subsystem Controllers
        this.playbackController = new PlaybackController(this);
        this.rmsdController = new RmsdController(this);
        
        this.xtcFile = null;
        this.trajExt = 'xtc';
        
        this.comp = null;
        this.ringBuffer = null;
        this._structureName = '';
        this._trajectoryName = '';
        this._isPlaying = false;
        this._isLooping = false;
        this.loopStartFrame = 0;
        this.loopEndFrame = null; // null means last frame
        this.playTimer = null;
        this.lastFrameTime = 0;
        this._currentFrame = 0;
        this.subframe = 0;
        this.engineMode = 'autoload';

        // Playback & Trajectory Physics Engine Config
        this._deltaTime = 100; // ps per frame
        this._timeOffset = 0;  // ps initial offset
        this.frameTimes = null; // Float32Array of exact simulation timestamps (ps)
        this.isTimeCalibrated = false;
        this.playbackDirection = 'forward'; // 'forward' | 'backward' | 'bounce'
        this.bounceDirection = 1; // 1 = forward, -1 = reverse (for bounce mode)
        this.speedMultiplier = 1.0;
        this._frameStep = 1;   // 1, 2, 5, 10
        this.useSplineInterpolation = true; // 60 FPS Catmull-Rom Spline
        this.frameTimeAccumulator = 0;
        this.superpose = false; // RMSD Superposition against Frame 0
        this.customSuperposeQuery = null;
        this._depthSlicing = 0;
        this._mouseScheme = 'default';
        this.rmsdFitQuery = 'protein and .CA';
        this.rmsdCalcQuery = 'protein and .CA';

        this.displayConfig = createDefaultDisplayConfig();

        // Analytics State (RMSD & Interactions / Contacts)
        this.activeAnalysisTaskId = null;
        this.rmsdRuns = [];
        this.lastRmsdSeries = [];
    }

    connectedCallback() {
        this.renderUI();
        const viewport = this._viewportEl || this.shadowRoot?.getElementById('viewport');
        if (viewport && !this.viewportManager) {
            try {
                this.viewportManager = new ViewportManager(viewport, (snapshot) => this.handleContextRestored(snapshot));
                this.interactionManager = new InteractionManager(this.viewportManager.stage, this.shadowRoot, this.comp, (type, detail) => this.emit(type, detail));
                if (this.shapeManager && this.viewportManager.stage) {
                    this.shapeManager.setStage(this.viewportManager.stage);
                }
            } catch (err) {
                console.warn("[VortexMD] ViewportManager initialization warning:", err?.message || err);
            }
        }

        // Direct Viewport Canvas Drag-and-Drop Ingestion
        if (viewport && !viewport._dragListenersAttached) {
            viewport._dragListenersAttached = true;
            viewport.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
            });
            viewport.addEventListener('drop', (e) => {
                e.preventDefault();
                const files = e.dataTransfer?.files;
                if (!files || !files.length) return;
                const file = files[0];
                const formatInfo = getFormatInfo(file);
                const ext = (formatInfo.ext || file.name.split('.').pop() || '').toLowerCase();
                const category = (formatInfo.category === 'trajectory' || ext === 'xtc' || ext === 'trr' || ext === 'dcd')
                    ? 'trajectory'
                    : 'topology';
                this.emit(EVENTS.FILE_DROPPED, { file, category });
            });
        }
    }

    _teardown() {
        this.playbackController?.pause();
        if (this.ringBuffer) {
            this.ringBuffer.dispose();
            this.ringBuffer = null;
        }
        if (this.workerManager) {
            this.workerManager.terminate();
        }
        if (this.interactionManager) {
            this.interactionManager.dispose();
            this.interactionManager = null;
        }
        if (this.shapeManager) {
            this.shapeManager.setStage(null);
        }
        if (this.viewportManager) {
            this.viewportManager.dispose();
            this.viewportManager = null;
        }
        this.comp = null;
    }

    disconnectedCallback() {
        Promise.resolve().then(() => {
            if (!this.isConnected) {
                this._teardown();
            }
        });
    }

    clear() {
        this.playbackController?.pause();
        this.isIndexing = false;
        this.isImportingSession = false;
        this.sessionId = null;
        this._cachedSessionData = null;
        this._structureName = '';
        this._trajectoryName = '';
        this.trajectoryFingerprint = null;
        this._indexToken = (this._indexToken || 0) + 1;

        if (this.sessionManager) {
            this.sessionManager.sessionId = null;
        }

        if (this.workerManager) {
            this.workerManager.terminate();
            this.workerManager = new WorkerManager(this);
        }

        if (this.ringBuffer) {
            this.ringBuffer.dispose();
            this.ringBuffer = null;
        }

        this.customSuperposeQuery = null;
        this.superposeIndices = null;

        // Complete purge of file and trajectory index states
        this.fileOffsets = [];
        this.frameTimes = null;
        this.isTimeCalibrated = false;
        this.xtcFile = null;
        this.trajExt = 'xtc';
        this._currentFrame = 0;
        this.subframe = 0;
        this.loopStartFrame = 0;
        this.loopEndFrame = null;
        this.playbackDirection = 'forward';
        this.speedMultiplier = 1.0;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.pins = [];

        // Purge analytics
        if (this.rmsdController) {
            this.rmsdController.clear();
        } else {
            this.lastRmsdSeries = null;
        }

        // Purge measurements, shapes, selections
        if (this.interactionManager) {
            this.interactionManager.clearMeasurements();
            this.interactionManager.setComponent(null);
        }
        if (this.shapeManager) {
            this.shapeManager.clearAll();
        }
        if (this.sessionManager) {
            this.sessionManager = new SessionManager(this);
        }

        if (this.viewportManager && this.viewportManager.stage) {
            this.viewportManager.stage.removeAllComponents();
        }
        this.comp = null;

        this.displayConfig = createDefaultDisplayConfig();
        const clearCfg = typeof this.getDisplayConfig === 'function' ? this.getDisplayConfig() : this.displayConfig;
        if (typeof this.emit === 'function') {
            this.emit(EVENTS.DISPLAY_CONFIG_CHANGED, { config: clearCfg, structural: true });
            this.emit(EVENTS.SHAPES_CHANGED, { shapes: [] });
        } else if (typeof this.dispatchEvent === 'function') {
            this.dispatchEvent(new CustomEvent(EVENTS.DISPLAY_CONFIG_CHANGED, { detail: { config: clearCfg, structural: true } }));
            this.dispatchEvent(new CustomEvent(EVENTS.SHAPES_CHANGED, { detail: { shapes: [] } }));
        }

        if (typeof this.emit === 'function') {
            this.emit(EVENTS.TOPOLOGY_CLEARED);
        } else if (typeof this.dispatchEvent === 'function') {
            this.dispatchEvent(new CustomEvent(EVENTS.TOPOLOGY_CLEARED));
        }
    }

    initBufferPipeline(atomCount, ext = 'xtc') {
        return this.playbackController.initBufferPipeline(atomCount, ext);
    }

    renderFrame(frameIndex, subframe = 0) {
        return this.playbackController.renderFrame(frameIndex, subframe);
    }

    play() {
        return this.playbackController.play();
    }

    pause() {
        return this.playbackController.pause();
    }

    setLoop(enabled) {
        return this.playbackController.setLoop(enabled);
    }

    setLoopRange(start, end) {
        return this.playbackController.setLoopRange(start, end);
    }

    clearLoopRange() {
        return this.playbackController.clearLoopRange();
    }

    setPlaybackSpeed(speed) {
        return this.playbackController.setPlaybackSpeed(speed);
    }

    setPlaybackDirection(direction) {
        return this.playbackController.setPlaybackDirection(direction);
    }

    setFrameStep(step) {
        return this.playbackController.setFrameStep(step);
    }

    setSplineInterpolation(enabled) {
        return this.playbackController.setSplineInterpolation(enabled);
    }

    setSuperpose(enabled, query = null) {
        return this.playbackController.setSuperpose(enabled, query);
    }

    setPhysicalTimeConfig(deltaTime, timeOffset) {
        return this.playbackController.setPhysicalTimeConfig(deltaTime, timeOffset);
    }

    jumpToFrame(frame) {
        return this.playbackController.jumpToFrame(frame);
    }

    get currentFrame() {
        if (!this.ringBuffer || this.ringBuffer.frameCount <= 0) return 0;
        return (this._currentFrame || 0) + 1;
    }

    get frameCount() {
        return this.ringBuffer?.frameCount ?? 0;
    }

    get hasStructure() {
        return Boolean(this.comp && this.comp.structure);
    }

    get hasTrajectory() {
        return Boolean((this.ringBuffer && this.ringBuffer.frameCount > 0) || (this.fileOffsets && this.fileOffsets.length > 1));
    }

    get atomCount() {
        return this.comp?.structure?.atomCount ?? 0;
    }

    get loopRange() {
        return {
            start: this.loopStartFrame || 0,
            end: (this.loopEndFrame !== null && this.loopEndFrame !== undefined) ? this.loopEndFrame : null
        };
    }

    get speed() {
        return this.speedMultiplier ?? 1.0;
    }

    get direction() {
        return this.playbackDirection ?? 'forward';
    }

    get structureName() {
        return this._structureName ?? '';
    }

    get trajectoryName() {
        return this._trajectoryName ?? '';
    }

    get isPlaying() {
        return Boolean(this._isPlaying);
    }

    get isLooping() {
        return Boolean(this._isLooping);
    }

    get frameStep() {
        return this._frameStep ?? 1;
    }

    get deltaTime() {
        return this._deltaTime ?? 100;
    }

    get timeOffset() {
        return this._timeOffset ?? 0;
    }

    get mouseScheme() {
        return this._mouseScheme ?? 'default';
    }

    get depthSlicing() {
        return this._depthSlicing ?? 0;
    }

    renderUI() {
        const root = this.shadowRoot;
        if (!root) return;

        // Already rendered into the real shadow root: nothing to do.
        if (this._viewportEl && this._viewportEl.parentNode === root) return;

        const sheet = root.adoptedStyleSheets !== undefined ? getSharedSheet() : null;
        if (sheet) {
            root.adoptedStyleSheets = [sheet];
            root.innerHTML = '<div id="viewport"></div>';
        } else {
            // fallback: old browsers and the test shim
            root.innerHTML = `<style>${VIEWPORT_CSS}</style><div id="viewport"></div>`;
        }
        this._viewportEl = root.firstElementChild?.id === 'viewport'
            ? root.firstElementChild
            : (root.querySelector?.('#viewport') ?? (root.getElementById?.('viewport') ?? null));
    }

    // --- VIEWPORT, TOPOLOGY & TRAJECTORY LOADING ---

    centerView() {
        if (!this.viewportManager || !this.viewportManager.stage || !this.comp) return;

        const stage = this.viewportManager.stage;
        stage.handleResize();

        const seleNonSolvent = SELE_NON_SOLVENT;
        const nonSolventAtoms = this.comp.structure ? this.comp.structure.getAtomIndices(new NGL.Selection(seleNonSolvent)) : null;

        const targetSele = (nonSolventAtoms && nonSolventAtoms.length > 0) ? seleNonSolvent : "all";

        this.viewportManager.focusOnSelection(this.comp, targetSele, 500);
    }

    focusSelection(selectionStr = "all", duration = 500) {
        if (this.viewportManager && this.comp) {
            this.viewportManager.focusOnSelection(this.comp, selectionStr, duration);
        }
    }

    async loadTopology(fileOrUrl, options = {}) {
        const prevCachedSession = this._cachedSessionData;
        this.clear();
        this._topologySource = fileOrUrl;
        this._topologyOptions = { ...options };
        this._structureName = fileOrUrl instanceof File ? fileOrUrl.name : fileOrUrl;

        let input = fileOrUrl;
        const format = getFormatInfo(input);
        const loadOpts = { ...options };
        if (format.ext && !loadOpts.ext) {
            loadOpts.ext = format.ext;
        }

        this.comp = await this.viewportManager.loadStructure(input, loadOpts);

        // Preserve cached session if atom count matches
        if (prevCachedSession) {
            const expAtoms = prevCachedSession.structure?.atomCount ?? 0;
            const curAtoms = this.comp?.structure?.atomCount ?? 0;
            if (expAtoms === 0 || curAtoms === expAtoms) {
                this._cachedSessionData = prevCachedSession;
            } else {
                this.notify('warning', `Loaded structure has ${curAtoms} atoms, but pending session expects ${expAtoms} atoms.`);
            }
        }

        // Attach component to active managers
        this.interactionManager.setComponent(this.comp);
        if (this.viewportManager && this.viewportManager.stage) {
            this.shapeManager.setStage(this.viewportManager.stage);
            this.interactionManager.setStage(this.viewportManager.stage);
        }

        const tree = extractMoleculeTree(this.comp);

        let chainColorIdx = 0;
        const mapChains = (targetConfig, chains, hasAny, typeLabel) => {
            targetConfig.chains = {};
            chains?.forEach(chainObj => {
                if (chainObj && chainObj.name) {
                    targetConfig.chains[chainObj.name] = { 
                        visible: true, 
                        style: "cartoon", 
                        customColor: getChainDefaultColor(chainColorIdx++),
                        resCount: chainObj.resCount,
                        atomCount: chainObj.atomCount,
                        type: typeLabel 
                    };
                }
            });
            targetConfig.visible = !!hasAny;
        };

        mapChains(this.displayConfig.proteins, tree.proteinChains, tree.hasProteins, "Protein");
        mapChains(this.displayConfig.rna, tree.rnaChains, tree.hasRna, "RNA");
        mapChains(this.displayConfig.dna, tree.dnaChains, tree.hasDna, "DNA");

        this.displayConfig.ligands.items = {};
        tree.ligands.forEach(ligObj => {
            if (ligObj && ligObj.id) {
                this.displayConfig.ligands.items[ligObj.id] = {
                    visible: true,
                    style: "ball+stick",
                    color: "element",
                    resname: ligObj.resname,
                    resno: ligObj.resno,
                    chainname: ligObj.chainname,
                    sele: ligObj.sele,
                    count: ligObj.count,
                    atomCount: ligObj.totalAtoms || ligObj.atomCount
                };
            }
        });
        this.displayConfig.ligands.visible = tree.hasLigands;

        this.displayConfig.membrane.species = {};
        if (tree.lipidSpecies) {
            tree.lipidSpecies.forEach((lip, idx) => {
                const assignedColor = getLipidDefaultColor(idx);
                this.displayConfig.membrane.species[lip.resname] = {
                    visible: true,
                    style: "licorice",
                    color: assignedColor,
                    customColor: assignedColor,
                    label: lip.label,
                    sele: lip.sele,
                    count: lip.count,
                    atomCount: lip.totalAtoms
                };
            });
        }
        this.displayConfig.membrane.visible = tree.hasLipids;

        this.displayConfig.saccharides = {
            present: tree.hasSaccharides,
            visible: tree.hasSaccharides,
            style: "hyperball",
            color: "#a855f7",
            atomCount: tree.glycanSpecies ? tree.glycanSpecies.reduce((acc, g) => acc + g.totalAtoms, 0) : 0,
            sele: tree.glycanSpecies && tree.glycanSpecies.length > 0 ? tree.glycanSpecies.map(g => g.sele).join(' or ') : 'saccharide'
        };

        this.displayConfig.ions = {
            present: tree.hasIons,
            visible: tree.hasIons,
            style: "spacefill",
            color: "#eab308",
            count: tree.ionStats ? tree.ionStats.count : 0,
            atomCount: tree.ionStats ? tree.ionStats.totalAtoms : 0,
            sele: tree.ionStats ? tree.ionStats.sele : 'ion'
        };

        this.displayConfig.water = {
            present: tree.hasWater,
            visible: false,
            style: "line",
            color: "#06b6d4",
            count: tree.waterStats ? tree.waterStats.count : 0,
            atomCount: tree.waterStats ? tree.waterStats.totalAtoms : 0,
            sele: tree.waterStats ? tree.waterStats.sele : 'water'
        };
        this.displayConfig.water.visible = false;

        this.updateCustomRepresentations();
        this.emit(EVENTS.DISPLAY_CONFIG_CHANGED, { config: this.getDisplayConfig(), structural: true });
        this.centerView();
        this.updateRmsdAtomCounts?.();
        
        const fileName = input instanceof File ? input.name : (typeof input === 'string' ? input.split('/').pop() : 'structure');
        this.emit(EVENTS.TOPOLOGY_LOADED, { 
            count: this.comp.structure.atomCount, 
            name: fileName 
        });

        return this.comp.structure.atomCount;
    }

    notify(level, message) {
        const levels = ['info', 'success', 'warning', 'error'];
        let lvl = 'info';
        let msg = '';
        if (levels.includes(level)) {
            lvl = level;
            msg = message || '';
        } else if (levels.includes(message)) {
            lvl = message;
            msg = level || '';
        } else {
            msg = level || '';
        }
        this.emit(EVENTS.NOTICE, { level: lvl, message: String(msg) });
    }

    async relinkTrajectory(file) {
        if (!file) return;
        this.xtcFile = file;
        this._trajectoryName = file.name;
        this.trajExt = getFormatInfo(file).ext || (file.name.split('.').pop() || 'xtc').toLowerCase();
        try {
            this.trajectoryFingerprint = await getFileFingerprint(file);
        } catch (e) {
            this.trajectoryFingerprint = null;
        }
        const hasOffsets = (this._cachedSessionData?.trajectory?.offsets?.length > 1) || (this.fileOffsets?.length > 1);
        if (!hasOffsets && this.comp && this.comp.structure) {
            this.loadTrajectory(file, this.comp.structure.atomCount);
        }
    }

    async saveSession(options = {}) {
        const name = options?.name || options?.customName || 'Session';
        if (this.sessionManager) {
            return await this.sessionManager.saveToFile({ ...options, customName: name });
        }
        return null;
    }

    exportSessionFile(name) {
        if (this.sessionManager) {
            return this.sessionManager.exportToFile(name);
        }
        return null;
    }

    getSessionSummary() {
        const runs = (Array.isArray(this.rmsdRuns) && this.rmsdRuns.length > 0)
            ? this.rmsdRuns
            : (Array.isArray(this.lastRmsdSeries) && this.lastRmsdSeries.length > 0
                ? [{ id: 'rmsd_run_1', name: 'RMSD Run', series: this.lastRmsdSeries }]
                : []);

        const formattedRuns = runs.map((r, i) => ({
            id: r.id || `rmsd_run_${i + 1}`,
            label: r.name || r.label || (r.calcQuery ? `RMSD: ${r.calcQuery}` : `Run ${i + 1}`),
            points: r.series ? r.series.length : (Array.isArray(r.points) ? r.points.length : (typeof r.points === 'number' ? r.points : 0)),
            series: r.series || [],
            fitQuery: r.fitQuery || 'protein and .CA',
            calcQuery: r.calcQuery || 'protein and .CA',
            stats: r.stats || null
        }));

        return {
            sessionId: this.sessionId || this.sessionManager?.sessionId || null,
            createdAt: this.sessionManager?.createdAt || new Date().toISOString(),
            structureName: this.structureName || this.comp?.structure?.name || null,
            trajectoryName: this.trajectoryName || this.xtcFile?.name || null,
            atomCount: this.atomCount || (this.comp?.structure?.atomCount || 0),
            frameCount: this.frameCount || (this.fileOffsets && this.fileOffsets.length > 1 ? this.fileOffsets.length - 1 : (this.ringBuffer?.frameCount || 0)),
            measurementCount: this.interactionManager ? this.interactionManager.getMeasurements().length : 0,
            shapeCount: this.shapeManager ? this.shapeManager.getShapes().length : 0,
            rmsdRuns: formattedRuns
        };
    }

    updateCustomRepresentations() {
        if (this.comp) {
            applyCustomRepresentation(this.comp, this.displayConfig);
        }
    }

    async loadTrajectory(file, atomCount, onProgress, onDone) {
        const expected = atomCount || (this.comp && this.comp.structure ? this.comp.structure.atomCount : 0);
        this.trajExt = getFormatInfo(file).ext || 'xtc';

        // Pre-load trajectory header validation
        const validation = await validateTrajectoryCompatibility(file, expected, this.trajExt);
        if (!validation.valid) {
            const errorMsg = validation.error || 'Trajectory is incompatible with loaded topology.';
            logger.log('error', 'TRAJECTORY', errorMsg);
            this.notify('error', errorMsg);
            this.emit(EVENTS.TRAJECTORY_INVALID, { ...validation, message: errorMsg });
            this.emit(EVENTS.INDEXING_FAILED, { message: errorMsg });
            return false;
        }

        this.xtcFile = file;
        this._trajectoryName = file.name;
        try {
            this.trajectoryFingerprint = await getFileFingerprint(file);
        } catch (e) {
            this.trajectoryFingerprint = null;
        }

        this.startIndexing(expected, { type: 'index', file: this.xtcFile, expectedAtoms: expected, fileSize: file.size, ext: this.trajExt }, onProgress, onDone);
        return true;
    }

    _applyIndexMetadata(offsets, meta = {}) {
        const frameTimes = meta.frameTimes ?? offsets.frameTimes ?? null;
        const detectedDeltaTime = meta.detectedDeltaTime ?? offsets.detectedDeltaTime ?? 0;
        const isTimeCalibrated = meta.isTimeCalibrated ?? offsets.isTimeCalibrated ?? Boolean(detectedDeltaTime > 0 && frameTimes?.length > 0);

        this.fileOffsets = offsets;
        this.frameTimes = frameTimes;
        this.isTimeCalibrated = isTimeCalibrated;

        if (detectedDeltaTime > 0) {
            this._deltaTime = detectedDeltaTime;
            this.renderFrame(this._currentFrame, this.subframe);
        }

        this.emit(EVENTS.TIME_CONFIG_CHANGED, {
            deltaTime: this.deltaTime,
            timeOffset: this.timeOffset,
            isTimeCalibrated: this.isTimeCalibrated
        });
    }

    async startIndexing(atomCount, workerPayload, onProgress, onDone) {
        this.isIndexing = true;
        const indexToken = (this._indexToken || 0) + 1;
        this._indexToken = indexToken;

        // Step A: Persistent IndexedDB Cache Check via trajectory fingerprint
        const cacheKey = generateIndexKey(this.xtcFile, workerPayload.fileSize);
        if (cacheKey && this.trajectoryFingerprint) {
            try {
                const cachedOffsets = await getCachedIndex(cacheKey, this.trajectoryFingerprint);
                if (cachedOffsets && cachedOffsets.length > 1) {
                    if (this._indexToken !== indexToken) return;
                    this.isIndexing = false;
                    this._applyIndexMetadata(cachedOffsets, cachedOffsets);
                    const totalFrames = this.fileOffsets.length - 1;
                    if (onDone) onDone(totalFrames);
                    this.initBufferPipeline(atomCount, workerPayload.ext || this.trajExt);
                    this.emit(EVENTS.INDEXING_COMPLETE, { totalFrames, cached: true });
                    this.notify('success', `Loaded ${totalFrames} frames from index cache (0s instant load)`);
                    return;
                }
            } catch (e) {
                console.warn('Index cache lookup error:', e);
            }
        }

        // Step C: Progressive Streaming Indexing (2-Second Time-to-First-Frame)
        let pipelineStarted = false;
        let totalEstimatedFrames = 0;
        const accumulatedOffsets = [];

        const worker = this.workerManager?.getNextWorker?.() || (typeof this.workerManager?.getNextWorker === 'function' ? this.workerManager.getNextWorker() : null);
        if (!worker) {
            this.isIndexing = false;
            const errorMsg = 'No available WebWorker in execution pool';
            logger.log('error', 'INDEXER', errorMsg);
            this.emit(EVENTS.INDEXING_FAILED, { error: errorMsg });
            return;
        }

        const onIndexReply = (err, data) => {
            if (this._indexToken !== indexToken) return;

            let actualData = data;
            let actualErr = err;
            if (data === undefined && err && !(err instanceof Error) && (err.type || err.postId)) {
                actualData = err;
                actualErr = null;
            }

            if (actualErr) {
                this.isIndexing = false;
                const errorMsg = actualErr?.message || String(actualErr);
                logger.log('error', 'INDEXER', `Worker error: ${errorMsg}`);
                this.emit(EVENTS.INDEXING_FAILED, { error: errorMsg });
                return;
            }

            if (!actualData) return;

            try {
                if (actualData.type === 'progress') {
                    const { framesFound, bytesIndexed, percent, offsetBase, newOffsets } = actualData;
                    if (onProgress) onProgress(percent, framesFound, bytesIndexed);

                    if (Array.isArray(newOffsets) && newOffsets.length > 0) {
                        if (offsetBase === accumulatedOffsets.length) {
                            for (let i = 0; i < newOffsets.length; i++) {
                                accumulatedOffsets.push(newOffsets[i]);
                            }
                        } else {
                            // If base doesn't match, replace or re-sync
                            accumulatedOffsets.length = offsetBase;
                            for (let i = 0; i < newOffsets.length; i++) {
                                accumulatedOffsets.push(newOffsets[i]);
                            }
                        }
                        this.fileOffsets = accumulatedOffsets;

                        const totalSize = workerPayload.fileSize || 0;
                        if (totalSize > 0 && bytesIndexed > 0) {
                            totalEstimatedFrames = Math.max(framesFound, Math.round(framesFound * (totalSize / bytesIndexed)));
                        } else {
                            totalEstimatedFrames = framesFound;
                        }

                        if (!pipelineStarted) {
                            pipelineStarted = true;
                            this.initBufferPipeline(atomCount, workerPayload.ext || this.trajExt);
                        } else if (this.ringBuffer) {
                            this.ringBuffer.fileOffsets = this.fileOffsets;
                            this.ringBuffer.frameCount = this.fileOffsets.length - 1;
                        }

                        this.emit(EVENTS.INDEXING_PROGRESS, {
                            indexedFrames: framesFound,
                            totalEstimatedFrames: totalEstimatedFrames,
                            percent: percent
                        });
                    }
                } else if (actualData.type === 'done') {
                    this.isIndexing = false;
                    this._applyIndexMetadata(actualData.offsets, actualData);
                    const totalFrames = this.fileOffsets.length - 1;

                    if (cacheKey && this.trajectoryFingerprint) {
                        saveCachedIndex(cacheKey, actualData.offsets, workerPayload.fileSize, this.trajectoryFingerprint, this.frameTimes)
                            .catch(e => console.warn('Failed to save index cache:', e));
                    }

                    if (!pipelineStarted) {
                        pipelineStarted = true;
                        this.initBufferPipeline(atomCount, workerPayload.ext || this.trajExt);
                    } else if (this.ringBuffer) {
                        this.ringBuffer.fileOffsets = actualData.offsets;
                        this.ringBuffer.frameCount = totalFrames;
                    }

                    if (onDone) onDone(totalFrames);
                    this.emit(EVENTS.INDEXING_COMPLETE, { totalFrames, cached: false });
                } else if (actualData.type === 'error') {
                    this.isIndexing = false;
                    const errorMsg = actualData.error || 'Indexing error';
                    logger.log('error', 'INDEXER', `Indexing failed: ${errorMsg}`);
                    this.emit(EVENTS.INDEXING_FAILED, { error: errorMsg });
                }
            } catch (err) {
                this.isIndexing = false;
                const errorMsg = err?.message || String(err);
                logger.log('error', 'INDEXER', `Worker message handling error: ${errorMsg}`);
                this.emit(EVENTS.INDEXING_FAILED, { error: errorMsg });
            }
        };

        const postPromise = worker.post({ ...workerPayload }, [], onIndexReply);
        if (postPromise && typeof postPromise.catch === 'function') {
            postPromise.catch(err => {
                if (this._indexToken !== indexToken) return;
                this.isIndexing = false;
                const errorMsg = err?.message || String(err);
                logger.log('error', 'INDEXER', `Worker post error: ${errorMsg}`);
                this.emit(EVENTS.INDEXING_FAILED, { error: errorMsg });
            });
        }
    }

    async handleContextRestored(snapshot = null) {
        this.notify('warning', 'WebGL context lost. Restoring 3D scene...');
        try {
            // 1. Snapshot measurements and shapes before stage attachment
            const rawMeas = this.interactionManager ? this.interactionManager.getMeasurements() : [];
            const measSnapshot = Array.isArray(rawMeas) ? rawMeas.map(m => ({
                type: m.type,
                atomIndices: m.atomIndices || (Array.isArray(m.atoms) ? m.atoms.map(a => typeof a === 'number' ? a : a?.index).filter(idx => typeof idx === 'number') : []),
                visible: m.visible !== false
            })) : [];

            const rawShapes = this.shapeManager ? this.shapeManager.getShapes() : [];
            const shapesSnapshot = Array.isArray(rawShapes) ? rawShapes.map(s => ({
                type: s.type,
                sele: s.sele,
                color: s.color,
                opacity: s.opacity,
                name: s.name,
                visible: s.visible !== false
            })) : [];

            // Preserve frame position
            const preservedFrame = this._currentFrame;
            const preservedSubframe = this.subframe;

            // 2. Re-load structure on new stage
            if (this._topologySource && this.viewportManager) {
                const format = getFormatInfo(this._topologySource);
                const loadOpts = { ...(this._topologyOptions || {}) };
                if (format.ext && !loadOpts.ext) {
                    loadOpts.ext = format.ext;
                }
                this.comp = await this.viewportManager.loadStructure(this._topologySource, loadOpts);
            }

            // 3. Re-attach managers to stage
            const stage = this.viewportManager?.stage;
            if (this.shapeManager && stage) {
                this.shapeManager.setStage(stage);
            }
            if (this.interactionManager) {
                this.interactionManager.setComponent(this.comp);
                if (stage) this.interactionManager.setStage(stage);
            }

            // 4. Re-apply display representations
            if (this.comp) {
                this.updateCustomRepresentations();
                this.emit(EVENTS.DISPLAY_CONFIG_CHANGED, { config: this.getDisplayConfig(), structural: true });
            }

            // 5. Restore measurements
            if (measSnapshot.length > 0) {
                this.clearMeasurements();
                for (const m of measSnapshot) {
                    this.restoreMeasurement(m);
                }
            }

            // 6. Restore shapes
            if (shapesSnapshot.length > 0) {
                this.clearShapes();
                for (const s of shapesSnapshot) {
                    if (s.sele && this.comp) {
                        this.addBoundingBox(s.sele, s);
                    }
                }
            }

            // 7. Restore camera orientation and viewport properties
            if (this.mouseScheme) {
                this.setMouseScheme(this.mouseScheme);
            }
            if (this.depthSlicing !== undefined) {
                this.setDepthSlicing(this.depthSlicing);
            }
            if (snapshot?.orientation && Array.isArray(snapshot.orientation) && snapshot.orientation.length === 16 && stage?.viewerControls?.orient) {
                const matrix = new NGL.Matrix4();
                matrix.fromArray(snapshot.orientation);
                stage.viewerControls.orient(matrix);
            }

            // 8. Restore buffer pipeline and render preserved frame
            if (this.comp && this.fileOffsets && this.fileOffsets.length > 1) {
                this.initBufferPipeline(this.comp.structure.atomCount, this.trajExt);
                this.renderFrame(preservedFrame, preservedSubframe);
            } else if (this.comp) {
                this.centerView();
            }

            this.notify('success', '3D scene restored successfully.');
        } catch (err) {
            report('engine:vortexmd', err);
            this.notify('error', `Scene restoration failed: ${err?.message || err}`);
        }
    }

    addMeasurement(type, atomSpecs) {
        if (!this.interactionManager) throw new Error('InteractionManager not initialized');
        return this.interactionManager.addMeasurement(type, atomSpecs);
    }

    removeMeasurement(id) {
        return this.interactionManager?.removeMeasurement(id) ?? false;
    }

    setMeasurementVisible(id, visible) {
        return this.interactionManager?.setMeasurementVisible(id, visible) ?? false;
    }

    focusMeasurement(id) {
        this.interactionManager?.focusMeasurement(id);
    }

    clearMeasurements() {
        if (this.interactionManager) this.interactionManager.clearMeasurements();
    }

    restoreMeasurement({ type, atomIndices, visible = true }) {
        if (!this.interactionManager) return null;
        return this.interactionManager.restoreMeasurement({ type, atomIndices, visible });
    }

    getMeasurements() {
        return this.interactionManager ? this.interactionManager.getMeasurements() : [];
    }

    getMeasurementValues() {
        return this.interactionManager ? this.interactionManager.getMeasurementValues() : new Float64Array(0);
    }

    exportMeasurements(format = 'csv') {
        if (!this.interactionManager) return '';
        return this.interactionManager.exportMeasurements(format);
    }

    startMeasurementPick(type) {
        this.interactionManager?.startMeasurementPick(type);
    }

    cancelPick() {
        return this.interactionManager?.cancelPick() ?? false;
    }

    addBoundingBox(selectionStr, options = {}) {
        if (!this.comp || !this.comp.structure) {
            this.notify('warning', 'No structure loaded for overlay bounding box');
            return null;
        }
        const rawSele = selectionStr?.trim() || '';
        const sele = rawSele === '' ? 'all' : rawSele;
        const color = options.color || '#3b82f6';
        const opacity = options.opacity !== undefined ? Number(options.opacity) : 0.8;
        const name = options.name || (sele === 'all' ? 'Full System Box' : `Box (${sele})`);

        const shape = this.shapeManager.addBoundingBox(this.comp, sele, {
            color,
            opacity,
            name
        });
        if (!shape) {
            this.notify('warning', `No atoms found matching selection "${sele}"`);
            return null;
        }
        this.notify('success', `Added bounding box overlay for ${sele === 'all' ? 'full system' : sele}`);
        this.emit(EVENTS.SHAPES_CHANGED, { shapes: this.getShapes() });
        return shape;
    }

    removeShape(id) {
        if (!this.shapeManager) return false;
        const removed = this.shapeManager.removeShape(id);
        if (removed) {
            this.emit(EVENTS.SHAPES_CHANGED, { shapes: this.getShapes() });
        }
        return removed;
    }

    setShapeVisible(id, visible) {
        if (!this.shapeManager) return false;
        const res = this.shapeManager.setShapeVisible(id, visible);
        this.emit(EVENTS.SHAPES_CHANGED, { shapes: this.getShapes() });
        return res;
    }

    clearShapes() {
        if (this.shapeManager) {
            this.shapeManager.clearAll();
            this.emit(EVENTS.SHAPES_CHANGED, { shapes: this.getShapes() });
        }
    }

    getShapes() {
        return this.shapeManager ? this.shapeManager.getShapes() : [];
    }

    getDisplayConfig() {
        return this.displayConfig ? JSON.parse(JSON.stringify(this.displayConfig)) : null;
    }

    updateDisplay(path, patch) {
        if (!patch) return;

        // Requirement 6: Surface rule in engine
        if (patch.style === 'surface' && this.isPlaying) {
            this.pause();
            this.notify('info', "Notice: Surface calculation is optimized for static figure export. Playback is paused. Use 'Spacefill' (Sp) for 60 FPS dynamic volume visualization.");
        }

        if (!this.displayConfig) {
            this.displayConfig = createDefaultDisplayConfig();
        }

        const SUB_KEYS = { proteins: 'chains', rna: 'chains', dna: 'chains', ligands: 'items', membrane: 'species' };

        if (!path || path.length === 0) {
            Object.assign(this.displayConfig, patch);
        } else {
            let curr = this.displayConfig;
            for (let i = 0; i < path.length - 1; i++) {
                const key = path[i];
                if (!curr[key]) curr[key] = {};
                curr = curr[key];
            }
            const lastKey = path[path.length - 1];
            if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) {
                curr[lastKey] = patch;
            } else if (curr[lastKey] && typeof curr[lastKey] === 'object') {
                Object.assign(curr[lastKey], patch);
            } else {
                curr[lastKey] = patch;
            }

            // Cascade down if group visible or style changed
            if (path.length === 1 && SUB_KEYS[path[0]] && curr[lastKey]) {
                const subKey = SUB_KEYS[path[0]];
                const grp = curr[lastKey];
                if (grp[subKey]) {
                    if (patch.visible !== undefined && !patch[subKey]) {
                        Object.values(grp[subKey]).forEach(item => { if (item) item.visible = patch.visible; });
                    }
                    if (patch.style !== undefined && !patch[subKey]) {
                        Object.values(grp[subKey]).forEach(item => { if (item) item.style = patch.style; });
                    }
                }
            }

            // Auto-sync parent group visible when individual child visibility changes
            if (path.length === 3 && (path[1] === 'chains' || path[1] === 'items' || path[1] === 'species')) {
                const grp = this.displayConfig[path[0]];
                if (grp && grp[path[1]]) {
                    grp.visible = Object.values(grp[path[1]]).some(item => item && item.visible);
                }
            }
        }

        this.updateCustomRepresentations();
        this.emit(EVENTS.DISPLAY_CONFIG_CHANGED, {
            config: this.getDisplayConfig(),
            path: Array.isArray(path) ? [...path] : [],
            patch
        });
    }

    getSelectionAtomCount(selectionQuery) {
        if (!this.comp || !this.comp.structure) return 0;
        try {
            const sele = new NGL.Selection(selectionQuery);
            const idx = this.comp.structure.getAtomIndices(sele);
            return idx ? idx.length : 0;
        } catch {
            return -1;
        }
    }

    validateSession(json) {
        return SessionManager.validate(json);
    }

    async restoreSession(data) {
        const payload = data || this._cachedSessionData;
        if (!payload) return false;
        if (this.sessionManager) {
            return await this.sessionManager.restoreSession(payload, this);
        }
        return await SessionManager.hydrate(this, payload);
    }

    getPins() {
        return Array.isArray(this.pins) ? this.pins.map(p => ({ ...p })) : [];
    }

    setPins(list) {
        this.pins = Array.isArray(list) ? list.map(p => ({ ...p })) : [];
        this.emit(EVENTS.PINS_UPDATED, { pins: this.getPins() });
    }

    resetView(duration = 500) {
        if (this.viewportManager?.stage) {
            this.viewportManager.stage.autoView(duration);
        }
    }

    setCameraType(cameraType = 'perspective') {
        if (this.viewportManager && typeof this.viewportManager.setCameraType === 'function') {
            this.viewportManager.setCameraType(cameraType);
        } else if (this.stage) {
            this.stage.setParameters({ cameraType });
        }
    }

    setBackgroundColor(color = 'white') {
        if (this.viewportManager && typeof this.viewportManager.setBackgroundColor === 'function') {
            this.viewportManager.setBackgroundColor(color);
        } else if (this.stage) {
            this.stage.setParameters({ backgroundColor: color });
            if (this.stage.viewer?.setBackground) this.stage.viewer.setBackground(color);
            if (this.stage.viewer?.requestRender) this.stage.viewer.requestRender();
        }
    }

    setMouseScheme(scheme = 'default') {
        this._mouseScheme = scheme;
        const stage = this.viewportManager?.stage;
        if (stage) {
            setMouseScheme(stage, scheme);
        }
    }

    setDepthSlicing(val = 0) {
        this._depthSlicing = val;
        const stage = this.viewportManager?.stage;
        if (stage && typeof stage.setFocus === 'function') {
            stage.setFocus(val);
        }
    }

    setSpin(active) {
        if (this.viewportManager?.stage) {
            this.viewportManager.stage.setSpin(active);
        }
    }

    setRock(active) {
        if (this.viewportManager?.stage) {
            this.viewportManager.stage.setRock(active);
        }
    }

    getCanvas() {
        return this.viewportManager?.stage?.viewer?.renderer?.domElement || null;
    }

    getPerformanceMetrics() {
        if (this.viewportManager && typeof this.viewportManager.getPerformanceMetrics === 'function') {
            return this.viewportManager.getPerformanceMetrics();
        }
        return { fps: null, durationMs: null };
    }

    getBufferLength() {
        return (this.ringBuffer && this.ringBuffer.frameBuffer) ? this.ringBuffer.frameBuffer.size : 0;
    }

    get stage() {
        return this.viewportManager ? this.viewportManager.stage : null;
    }

    async exportSnapshot(options = {}) {
        const stage = this.stage || this.viewportManager?.stage;
        if (!stage) {
            this.notify('warning', 'No active 3D viewport to capture image.');
            return null;
        }

        const {
            factor,
            res,
            resolution,
            backgroundColor,
            cameraType,
            antialias = true,
            transparent = false,
            filename = 'snapshot.png',
            ...rest
        } = options;

        let prevBg, prevCam;
        const hasParams = typeof stage.getParameters === 'function';
        if (hasParams) {
            const currentParams = stage.getParameters();
            prevBg = currentParams?.backgroundColor;
            prevCam = currentParams?.cameraType;
        }

        try {
            if (backgroundColor) {
                this.setBackgroundColor(backgroundColor);
            }
            if (cameraType) {
                this.setCameraType(cameraType);
            }

            this.notify('info', 'Capturing viewport image...');

            const blob = await exportViewportImage(stage, filename, {
                factor,
                res,
                resolution,
                antialias,
                transparent,
                ...rest
            });

            this.notify('success', `Saved image as ${filename}`);
            logger.log('info', 'EXPORTER', `Exported viewport screenshot (${filename})`);
            return blob;
        } catch (err) {
            console.error('Image export error:', err);
            this.notify('error', `Image export failed: ${err.message}`);
            logger.log('error', 'EXPORTER', `Image export error: ${err.message}`);
            return null;
        } finally {
            if (hasParams) {
                if (prevBg !== undefined) this.setBackgroundColor(prevBg);
                if (prevCam !== undefined) this.setCameraType(prevCam);
            }
        }
    }

    // RMSD Public API
    computeRmsd(options) {
        return this.rmsdController.computeRmsd(options);
    }

    cancelRmsd() {
        return this.rmsdController.cancelRmsd();
    }

    getRmsdRuns() {
        return this.rmsdController.getRmsdRuns();
    }

    getRmsdRun(id) {
        return this.rmsdController.getRmsdRun(id);
    }

    getRmsdConfig() {
        return this.rmsdController.getRmsdConfig();
    }

    setRmsdConfig(patch) {
        return this.rmsdController.setRmsdConfig(patch);
    }

    countAtoms(selection) {
        return this.rmsdController.countAtoms(selection);
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('vortexmd-engine')) {
    customElements.define('vortexmd-engine', VortexMD);
}


