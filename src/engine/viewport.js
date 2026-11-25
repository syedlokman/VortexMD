// src/viewport.js
// Single Task: NGL Stage Lifecycle, WebGL Context Loss Restoration & Automated DSSP / Bond Inference

import * as NGL from 'ngl';
import { setupCameraControls } from './camera.js';
import { logger } from '../shared/logger.js';
import { SELE_NON_SOLVENT } from './representations.js';

export class ViewportManager {
    constructor(viewportElement, onContextRestored) {
        this.viewport = viewportElement;
        this.onContextRestored = onContextRestored;
        this.stage = null;
        this.structureComponent = null;

        this.isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this._rebuilding = false;

        let resizeTimer = null;
        const debouncedResize = () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (this.stage) {
                    this.stage.handleResize();
                }
            }, 120);
        };
        this.resizeHandler = debouncedResize;
        if (typeof window !== 'undefined') {
            window.addEventListener("resize", this.resizeHandler);
        }

        if (typeof ResizeObserver !== 'undefined' && this.viewport) {
            this.resizeObserver = new ResizeObserver(() => {
                debouncedResize();
            });
            this.resizeObserver.observe(this.viewport);
        }

        this.initStage();
    }

    initStage() {
        const initialQuality = this.isMobile ? "low" : "high";
        const initialSampleLevel = 0;

        this.stage = new NGL.Stage(this.viewport, { 
            backgroundColor: "white",
            tooltip: false, 
            impostor: true, 
            quality: initialQuality,
            sampleLevel: initialSampleLevel,
            ambientIntensity: 0.35,
            lightIntensity: 0.9,
            ambientColor: 0xffffff,
            lightColor: 0xffffff
        });

        // Disable NGL default keyboard controls & behavior (prevents 'a', 'r', 'i', 'k', 'p' triggers)
        if (this.stage.keyControls) {
            this.stage.keyControls.clear();
            this.stage.keyControls.disabled = true;
        }
        if (this.stage.keyBehavior && typeof this.stage.keyBehavior.dispose === 'function') {
            this.stage.keyBehavior.dispose();
        }
        if (this.stage.viewer && this.stage.viewer.renderer && this.stage.viewer.renderer.domElement) {
            this.stage.viewer.renderer.domElement.removeAttribute('tabindex');
        }

        if (this.isMobile) {
            this.stage.setParameters({ sampleLevel: 0, quality: 'low' });
        }

        // PHASE 1: WebGL EXT_frag_depth Hardware Extension Fallback Check
        this.hasFragDepth = this.checkFragDepthSupport();
        if (!this.hasFragDepth) {
            console.warn("[Viewport] EXT_frag_depth extension missing on WebGL context. Falling back to SphereGeometryBuffer and CylinderGeometryBuffer.");
            this.stage.setParameters({ impostor: false });
        } else {
            this.stage.setParameters({ impostor: true });
        }

        // Ensure single-pass direct WebGL shading with balanced ambient fill
        this.stage.setParameters({
            sampleLevel: 0,
            ambientIntensity: 0.35,
            lightIntensity: 0.9,
            ambientColor: 0xffffff,
            lightColor: 0xffffff
        });

        // Adjust default camera framing:
        // 1. Molecules appear 20% smaller when loaded/centered (0.8x visual size -> zoom / 0.8)
        if (this.stage && typeof this.stage.getZoomForBox === 'function') {
            const origGetZoomForBox = this.stage.getZoomForBox.bind(this.stage);
            this.stage.getZoomForBox = (box) => {
                const origZoom = origGetZoomForBox(box);
                return origZoom / 0.8;
            };
        }

        // 2. Position molecule 10% above the current view center and horizontally centered
        // in the space between the expanded 320px left sidebar and 360px right drawer:
        // Center of space = 320px + (W - 360px - 320px)/2 = W/2 - 20px (shift 20px left of screen center)
        if (this.stage && this.stage.animationControls && typeof this.stage.animationControls.zoomMove === 'function') {
            const origZoomMove = this.stage.animationControls.zoomMove.bind(this.stage.animationControls);
            this.stage.animationControls.zoomMove = (center, zoom, duration) => {
                let targetCenter = center;
                if (center && typeof center.clone === 'function') {
                    targetCenter = center.clone();
                    const z = typeof zoom === 'number' ? zoom : (typeof this.stage.getZoom === 'function' ? this.stage.getZoom() : -100);
                    const dist = Math.abs(z);
                    const fov = (this.stage.viewer && this.stage.viewer.perspectiveCamera && this.stage.viewer.perspectiveCamera.fov) || 40;
                    const radFov = (fov * Math.PI) / 180;
                    const visibleHeight = 2 * dist * Math.tan(radFov / 2);
                    const clientH = (this.viewport && this.viewport.clientHeight) || window.innerHeight || 800;
                    const unitsPerPixel = visibleHeight / clientH;

                    // Horizontal centering matches camera optical axis (offset handled dynamically by setDrawerOffset)
                    const offsetX = 0;
                    const offsetY = 0.10 * visibleHeight; // 10% upward vertical shift relative to visible height

                    // Offset target center in camera space
                    const rotQuat = this.stage.viewer?.rotationGroup?.quaternion;
                    const offsetVec = new NGL.Vector3(offsetX, offsetY, 0);
                    if (rotQuat) {
                        const invQuat = rotQuat.clone();
                        if (typeof invQuat.invert === 'function') invQuat.invert();
                        else if (typeof invQuat.conjugate === 'function') invQuat.conjugate();
                        offsetVec.applyQuaternion(invQuat);
                    }
                    targetCenter.sub(offsetVec);
                }
                return origZoomMove(targetCenter, zoom, duration);
            };
        }

        setupCameraControls(this.viewport, this.stage);
        this.setupShadowDomMouseObserver();
        this.setupContextHandlers();

        setTimeout(() => {
            if (this.stage) this.stage.handleResize();
        }, 100);

        this.logCanvasAndLightingDiagnostics('Stage Initialization');
    }

    /**
     * Ensures the 3D camera remains centered on screen at all times.
     */
    setDrawerOffset(isOpen, animate = true) {
        if (!this.stage || !this.stage.viewer) return;
        const viewer = this.stage.viewer;
        const cameras = [viewer.perspectiveCamera, viewer.orthographicCamera];
        cameras.forEach(cam => {
            if (cam && typeof cam.clearViewOffset === 'function') {
                cam.clearViewOffset();
            }
        });
        viewer.requestRender();
    }

    /**
     * Comprehensive WebGL Canvas, GPU Hardware, and Lighting Diagnostics Logger
     */
    logCanvasAndLightingDiagnostics(context = 'Current State') {
        if (!this.stage || !this.stage.viewer) return;
        try {
            const renderer = this.stage.viewer.renderer;
            const gl = renderer ? renderer.getContext() : null;
            let glVersion = 'Unknown';
            let gpuVendor = 'Unknown';
            let gpuRenderer = 'Unknown';

            if (gl) {
                glVersion = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 'WebGL 2.0' : 'WebGL 1.0';
                const dbgExt = gl.getExtension('WEBGL_debug_renderer_info');
                if (dbgExt) {
                    gpuVendor = gl.getParameter(dbgExt.UNMASKED_VENDOR_WEBGL) || 'Unknown';
                    gpuRenderer = gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) || 'Unknown';
                } else {
                    gpuVendor = gl.getParameter(gl.VENDOR) || 'Unknown';
                    gpuRenderer = gl.getParameter(gl.RENDERER) || 'Unknown';
                }
            }

            const stageParams = typeof this.stage.getParameters === 'function' ? this.stage.getParameters() : {};
            const canvas = renderer ? renderer.domElement : null;
            const width = canvas ? canvas.width : (this.viewport ? this.viewport.clientWidth : 0);
            const height = canvas ? canvas.height : (this.viewport ? this.viewport.clientHeight : 0);
            const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

            if (logger.isDebugEnabled && logger.isDebugEnabled()) {
                logger.log('debug', 'VIEWPORT', `WebGL: ${glVersion} | EXT_frag_depth: ${this.hasFragDepth} | GPU: ${gpuVendor} — ${gpuRenderer} | Resolution: ${width}x${height} (DPR: ${dpr})`);
            }

            logger.log('info', 'VIEWPORT', `WebGL ${glVersion} initialized (${gpuRenderer}) | Anti-Darkening Active (sampleLevel: 0, ambient: 0.35)`);
        } catch (e) {
            logger.log('warn', 'VIEWPORT', `Could not log lighting diagnostics: ${e?.message || e}`);
        }
    }

    /**
     * Patch NGL MouseObserver to correctly identify canvas target across Shadow DOM boundaries
     */
    setupShadowDomMouseObserver() {
        if (!this.stage || !this.stage.mouseObserver) return;
        const mo = this.stage.mouseObserver;
        const domElem = this.stage.viewer && this.stage.viewer.renderer ? this.stage.viewer.renderer.domElement : null;
        if (!domElem) return;

        const isDomTarget = (e) => {
            if (!e) return false;
            if (e.target === domElem || e.target === this.viewport) return true;
            if (e.composedPath && typeof e.composedPath === 'function') {
                const path = e.composedPath();
                if (path && (path.includes(domElem) || path.includes(this.viewport))) return true;
            }
            return false;
        };

        const origOnMousemove = mo._onMousemove.bind(mo);
        mo._onMousemove = (t) => {
            if (isDomTarget(t)) {
                mo.overElement = true;
            } else {
                mo.overElement = false;
            }
            origOnMousemove(t);
        };
    }

    /**
     * Check GPU EXT_frag_depth extension support for GPU fragment shader raycasting
     */
    checkFragDepthSupport() {
        if (!this.stage || !this.stage.viewer || !this.stage.viewer.renderer) return true;
        try {
            const gl = this.stage.viewer.renderer.getContext();
            if (!gl) return true;
            if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
                return true;
            }
            const NGLGlobal = NGL;
            const ext = (NGLGlobal.glUtils && typeof NGLGlobal.glUtils.getExtension === 'function')
                ? NGLGlobal.glUtils.getExtension(gl, 'EXT_frag_depth')
                : (gl.getExtension ? gl.getExtension('EXT_frag_depth') : null);
            return !!ext;
        } catch (e) {
            console.warn("WebGL EXT_frag_depth detection warning:", e);
            return true;
        }
    }

    /**
     * PHASE 3: Retrieve live WebGL performance stats (FPS & ms render time)
     */
    getPerformanceMetrics() {
        if (!this.stage || !this.stage.viewer || !this.stage.viewer.stats) {
            return { fps: null, durationMs: null };
        }
        const stats = this.stage.viewer.stats;
        const fps = isFinite(stats.lastFps) && stats.lastFps > 0 
            ? stats.lastFps 
            : (isFinite(stats.fps) && stats.fps > 0 ? stats.fps : null);
        const durationMs = isFinite(stats.lastDuration) && stats.lastDuration > 0 
            ? stats.lastDuration 
            : (isFinite(stats.renderTime) && stats.renderTime > 0 ? stats.renderTime : null);
        return { fps, durationMs };
    }

    setupContextHandlers() {
        const domElem = this.stage?.viewer?.renderer?.domElement;
        if (!domElem) return;
        
        domElem.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            console.warn("WebGL Context Lost. Halting pipeline...");
        });

        domElem.addEventListener("webglcontextrestored", () => {
            logger.log("info", "VIEWPORT", "WebGL Context Restored. Re-instantiating Stage...");
            this.rebuild();
        });
    }

    rebuild() {
        if (this._rebuilding) return;
        this._rebuilding = true;

        // Capture snapshot before disposing old stage
        let snapshot = null;
        if (this.stage) {
            try {
                let orientation = null;
                if (this.stage.viewerControls?.getOrientation) {
                    const raw = this.stage.viewerControls.getOrientation();
                    if (raw?.elements) orientation = Array.from(raw.elements);
                    else if (Array.isArray(raw)) orientation = [...raw];
                    else if (typeof raw?.toArray === 'function') orientation = raw.toArray();
                }
                const params = typeof this.stage.getParameters === 'function' ? this.stage.getParameters() : {};
                snapshot = {
                    orientation,
                    backgroundColor: params.backgroundColor || 'white',
                    cameraType: params.cameraType || 'perspective',
                    focus: params.focus ?? 0
                };
            } catch (err) {
                console.warn('Failed capturing snapshot during rebuild:', err);
            }
            try {
                this.stage.dispose();
            } catch (e) {
                console.warn('Old stage dispose warning:', e);
            }
            this.stage = null;
        }

        this.initStage();

        if (snapshot && this.stage) {
            try {
                if (snapshot.backgroundColor) this.setBackgroundColor(snapshot.backgroundColor);
                if (snapshot.cameraType) this.setCameraType(snapshot.cameraType);
                if (snapshot.focus && typeof this.stage.setFocus === 'function') {
                    this.stage.setFocus(snapshot.focus);
                }
                if (snapshot.orientation && Array.isArray(snapshot.orientation) && snapshot.orientation.length === 16) {
                    const matrix = new NGL.Matrix4();
                    matrix.fromArray(snapshot.orientation);
                    if (typeof this.stage.viewerControls?.orient === 'function') {
                        this.stage.viewerControls.orient(matrix);
                    }
                }
            } catch (err) {
                console.warn('Failed restoring stage snapshot during rebuild:', err);
            }
        }

        try {
            if (this.onContextRestored) {
                this.onContextRestored(snapshot);
            }
        } finally {
            this._rebuilding = false;
        }
    }

    async loadStructure(fileOrUrl, options = {}) {
        this.stage.removeAllComponents();
        const loadOpts = { ...options };

        // Support inferBonds: 'all' | 'none' | 'auto'
        if (options.inferBonds !== undefined) {
            loadOpts.inferBonds = options.inferBonds === 'all' ? true : (options.inferBonds === 'none' ? false : 'auto');
        }

        const comp = await this.stage.loadFile(fileOrUrl, loadOpts);
        this.structureComponent = comp;
        
        // PHASE 4: Automated Secondary Structure Calculation (DSSP) for structures lacking explicit headers
        if (comp && comp.structure) {
            this.calculateSecondaryStructure(comp, options.forceDssp || false);

            // PIVOT CENTERING FIX: Instantly updates stage & trackball pivot to structure centroid
            const seleNonSolvent = SELE_NON_SOLVENT;
            const nonSolventAtoms = comp.structure ? comp.structure.getAtomIndices(new NGL.Selection(seleNonSolvent)) : null;
            const targetSele = (nonSolventAtoms && nonSolventAtoms.length > 0) ? seleNonSolvent : "all";

            comp.autoView(targetSele, 0);
            this.stage.autoView(0);
        }
        
        return comp;
    }

    /**
     * Automated Secondary Structure Calculation (DSSP)
     * Automatically calculates helices, sheets, and turns for structures missing sstruc headers
     */
    calculateSecondaryStructure(comp = null, force = false) {
        const targetComp = comp || this.structureComponent;
        if (!targetComp || !targetComp.structure) return false;

        const struct = targetComp.structure;
        const NGLGlobal = NGL;

        // Check if secondary structure calculation function is available in NGL
        const calcFunc = NGLGlobal.calculateSecondaryStructure || (NGLGlobal.Structure && NGLGlobal.Structure.prototype && NGLGlobal.Structure.prototype.calculateSecondaryStructure);

        try {
            if (typeof calcFunc === 'function') {
                calcFunc(struct);
                logger.log('info', 'VIEWPORT', `Automated DSSP secondary structure calculation executed on ${struct.name}.`);
                return true;
            } else if (typeof struct.calculateSecondaryStructure === 'function') {
                struct.calculateSecondaryStructure();
                logger.log('info', 'VIEWPORT', `Structure method calculateSecondaryStructure executed on ${struct.name}.`);
                return true;
            } else {
                logger.log('debug', 'VIEWPORT', "calculateSecondaryStructure handled natively during parser load in NGL.");
                return false;
            }
        } catch (e) {
            logger.log('warn', 'VIEWPORT', `Secondary structure calculation warning: ${e?.message || e}`);
            return false;
        }
    }

    focusOnSelection(comp, selectionStr = "all", duration = 500) {
        if (!this.stage) return;
        try {
            if (comp && comp.autoView) {
                comp.autoView(selectionStr, duration);
            } else if (this.stage.autoView) {
                this.stage.autoView(duration);
            }
            if (this.stage.viewer) {
                this.stage.viewer.requestRender();
            }
        } catch (err) {
            console.warn("Focus animation warning:", err);
            if (comp && comp.autoView) comp.autoView(selectionStr, 0);
        }
    }

    // PHASE 2: Viewport Background Color
    setBackgroundColor(color = 'white') {
        if (!this.stage) return;
        try {
            this.stage.setParameters({ backgroundColor: color });
            if (this.stage.viewer) {
                if (typeof this.stage.viewer.setBackground === 'function') {
                    this.stage.viewer.setBackground(color);
                }
                if (typeof this.stage.viewer.requestRender === 'function') {
                    this.stage.viewer.requestRender();
                }
            }
        } catch (err) {
            console.warn("Failed setting backgroundColor:", err);
        }
    }

    // PHASE 3: Camera Projection Geometry Modes
    setCameraType(cameraType = 'perspective') {
        if (!this.stage) return;
        try {
            this.stage.setParameters({ cameraType: cameraType });
            if (this.stage.viewer) this.stage.viewer.requestRender();
        } catch (err) {
            console.warn("Failed setting cameraType:", err);
        }
    }



    // PHASE 5: Adaptive Supersampling Antialiasing & Dynamic Quality Scaling
    setAdaptiveQuality(isDynamicPlayback = false) {
        if (!this.stage) return;
        try {
            this.stage.setParameters({
                sampleLevel: 0,
                quality: isDynamicPlayback ? 'medium' : 'high'
            });
            if (this.stage.viewer) this.stage.viewer.requestRender();
        } catch (err) {
            console.warn("Failed setting adaptive quality:", err);
        }
    }

    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.resizeHandler && typeof window !== 'undefined') {
            window.removeEventListener("resize", this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.stage) {
            try {
                this.stage.dispose();
            } catch (e) {
                console.warn('Stage dispose error:', e);
            }
            this.stage = null;
        }
    }
}
