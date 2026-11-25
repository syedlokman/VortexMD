import * as NGL from 'ngl';
import { logger } from '../shared/logger.js';
import { EVENTS } from '../contracts/events.js';
import { report } from '../shared/guard.js';

export class InteractionManager {
    constructor(stage = null, shadowRoot = null, component = null, emit = null) {
        this.stage = stage;
        this.shadowRoot = shadowRoot;
        this.comp = component;
        this.emit = emit;
        this.mode = 'inspect'; // 'inspect', 'center', 'measure'
        this.labelFormat = '%[qualified]s';

        this.measurements = []; // List of { id, type, atoms, atomLabels, value, unit, representation, visible }
        this.nextId = 1;
        this.pickingQueue = []; // Unified queue of selected atoms for building measurements/picking
        this.isPicking = false;
        this.pickType = 'distance';

        this.hoveredAtom = null;
        this.popoverEl = null;
        this.isMouseOverPopover = false;
        this.isPointerDown = false;
        this.pointerDownPos = { x: 0, y: 0 };
        this.rafId = null;
        this._lastPopoverAtomIndex = null;

        this._initNGLMeasurementDefaults();
        this.initPopoverUI();
        this.setupPickingEvents();
        this.setupDirectPointerTracking();
    }

    _initNGLMeasurementDefaults() {
        try {
            if (typeof NGL.setMeasurementDefaultParams === 'function') {
                NGL.setMeasurementDefaultParams({
                    color: "#f43f5e",
                    labelColor: "#ffffff",
                    labelSize: 2.2,
                    labelBackground: true,
                    labelBackgroundColor: "#0f172a",
                    labelBackgroundOpacity: 0.95,
                    labelBackgroundMargin: 0.6,
                    labelBorder: true,
                    labelBorderColor: "#334155",
                    labelBorderWidth: 0.3,
                    labelsdf: true,
                    labelFontWeight: "bold",
                    linewidth: 3.0
                });
            }
        } catch (e) {
            // Safe fallback if NGL method not available
        }
    }

    setStage(stage) {
        this.stage = stage;
        this.setupPickingEvents();
        this.setupDirectPointerTracking();
    }

    setComponent(comp) {
        if (this.comp !== comp) {
            this.clearMeasurements();
            this.comp = comp;
        }
    }

    setMode(mode) {
        if (['inspect', 'center', 'measure'].includes(mode)) {
            this.mode = mode;
            if (mode !== 'measure') {
                this.pickingQueue = [];
            }
        }
    }

    setViewportCursor(cursorStyle) {
        const vp = this.shadowRoot?.getElementById('viewport');
        if (vp) vp.style.cursor = cursorStyle;
        const canvas = this.stage?.viewer?.renderer?.domElement;
        if (canvas) canvas.style.cursor = cursorStyle;
    }

    startMeasurementPick(type = 'distance') {
        this.pickType = type;
        this.isPicking = true;
        this.pickingQueue = [];
        this.setMode('measure');
        this.setViewportCursor('crosshair');
        this.dispatchMeasureEvent(EVENTS.PICK_MODE_CHANGED, { active: true, type });
    }

    cancelPick() {
        const wasPicking = this.isPicking;
        this.isPicking = false;
        this.pickingQueue = [];
        this.setMode('inspect');
        this.setViewportCursor('grab');
        if (wasPicking) {
            this.dispatchMeasureEvent(EVENTS.PICK_MODE_CHANGED, { active: false, type: this.pickType });
            this.dispatchMeasureEvent(EVENTS.NOTICE, { level: 'info', message: 'Measurement pick mode cancelled.' });
        }
        return wasPicking;
    }

    initPopoverUI() {
        if (!this.shadowRoot || typeof document === 'undefined') return;

        let popover = this._popoverEl || (this.shadowRoot.querySelector ? this.shadowRoot.querySelector('#picking-popover') : null);
        if (!popover) {
            popover = document.createElement('div');
            this._popoverEl = popover;
            popover.id = 'picking-popover';
            popover.className = 'picking-popover-card';
            popover.style.cssText = `
                position: absolute;
                display: none;
                z-index: 50;
                background: rgba(15, 23, 42, 0.94);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                padding: 6px 10px;
                color: #f8fafc;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 11px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
                pointer-events: none;
                white-space: nowrap;
                transform: translate(-50%, calc(-100% - 14px));
                user-select: none;
            `;
            this.shadowRoot.appendChild(popover);

            popover.addEventListener('pointerenter', () => {
                this.isMouseOverPopover = true;
            });
            popover.addEventListener('pointerleave', () => {
                this.isMouseOverPopover = false;
            });
        }
        this.popoverEl = popover;
    }

    setupPickingEvents() {
        if (!this.stage || !this.stage.signals) return;

        this.stage.signals.hovered.add((pickingProxy) => {
            if (pickingProxy && pickingProxy.atom) {
                this.hoveredAtom = pickingProxy.atom;
                const canvas = this.stage.viewer && this.stage.viewer.renderer ? this.stage.viewer.renderer.domElement : null;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();

                const m = pickingProxy.mouse || (this.stage.mouseObserver ? this.stage.mouseObserver : {});
                let mouseX = rect.width / 2;
                let mouseY = rect.height / 2;

                if (m.canvasPosition && m.canvasPosition.x !== undefined) {
                    mouseX = m.canvasPosition.x;
                    mouseY = rect.height - m.canvasPosition.y;
                } else if (m.clientX !== undefined && m.clientY !== undefined) {
                    mouseX = m.clientX - rect.left;
                    mouseY = m.clientY - rect.top;
                }

                this.showPopover(pickingProxy.atom, mouseX, mouseY);
            } else if (!this.isMouseOverPopover) {
                this.hoveredAtom = null;
                this.hidePopover();
            }
        });

        this.stage.signals.clicked.add((pickingProxy) => {
            if (!pickingProxy || !pickingProxy.atom) return;
            this.handleAtomClick(pickingProxy.atom);
        });

        this.setupDoubleClickHandler();
    }

    setupDoubleClickHandler() {
        const viewport = this.shadowRoot ? this.shadowRoot.getElementById('viewport') : null;
        const domCanvas = this.stage && this.stage.viewer && this.stage.viewer.renderer ? this.stage.viewer.renderer.domElement : null;

        if (this._onDblClick) {
            if (viewport && typeof viewport.removeEventListener === 'function') viewport.removeEventListener('dblclick', this._onDblClick);
            if (domCanvas && typeof domCanvas.removeEventListener === 'function') domCanvas.removeEventListener('dblclick', this._onDblClick);
        }

        this._onDblClick = (e) => {
            this.handleDoubleClick(e);
        };

        if (viewport && typeof viewport.addEventListener === 'function') {
            viewport.addEventListener('dblclick', this._onDblClick);
        }
        if (domCanvas && domCanvas !== viewport && typeof domCanvas.addEventListener === 'function') {
            domCanvas.addEventListener('dblclick', this._onDblClick);
        }
    }

    handleDoubleClick(e) {
        const now = performance.now();
        if (this._lastDblClickHandled && (now - this._lastDblClickHandled < 250)) {
            return;
        }
        this._lastDblClickHandled = now;

        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        let targetAtom = null;
        if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
            const pickingProxy = this.raycastAtCoords(e.clientX, e.clientY);
            if (pickingProxy && pickingProxy.atom) {
                targetAtom = pickingProxy.atom;
            }
        }
        if (!targetAtom) {
            targetAtom = this.hoveredAtom;
        }

        if (targetAtom) {
            this.centerOnAtom(targetAtom);
        } else {
            if (this.stage && typeof this.stage.autoView === 'function') {
                this.stage.autoView(500);
            }
        }
    }

    setupDirectPointerTracking() {
        if (!this.shadowRoot) return;
        const viewport = this.shadowRoot.getElementById('viewport');
        if (!viewport) return;

        if (this._onPointerDown) {
            viewport.removeEventListener('pointerdown', this._onPointerDown);
            viewport.removeEventListener('pointermove', this._onPointerMove);
            viewport.removeEventListener('pointerup', this._onPointerUp);
            viewport.removeEventListener('pointerleave', this._onPointerLeave);
        }

        this._lastClickTime = 0;
        this._lastClickPos = { x: 0, y: 0 };

        this._onPointerDown = (e) => {
            this.isPointerDown = true;
            this.pointerDownPos = { x: e.clientX, y: e.clientY };
        };

        this._onPointerMove = (e) => {
            if (this.isPointerDown) {
                const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
                if (dist > 3) {
                    if (!this.isMouseOverPopover) {
                        this.hidePopover();
                    }
                    return;
                }
            }

            if (this.isMouseOverPopover) {
                return;
            }

            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
            }

            this.rafId = requestAnimationFrame(() => {
                this.performRaycast(e.clientX, e.clientY);
            });
        };

        this._onPointerUp = (e) => {
            const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
            this.isPointerDown = false;

            if (dist < 5 && !this.isMouseOverPopover) {
                const now = performance.now();
                const timeSinceLastClick = now - (this._lastClickTime || 0);
                const distFromLastClick = Math.hypot(e.clientX - (this._lastClickPos?.x || 0), e.clientY - (this._lastClickPos?.y || 0));

                if (timeSinceLastClick < 350 && distFromLastClick < 15) {
                    this._lastClickTime = 0;
                    this.handleDoubleClick(e);
                    return;
                } else {
                    this._lastClickTime = now;
                    this._lastClickPos = { x: e.clientX, y: e.clientY };
                }

                const pickingProxy = this.raycastAtCoords(e.clientX, e.clientY);
                if (pickingProxy && pickingProxy.atom) {
                    this.handleAtomClick(pickingProxy.atom);
                }
            }
        };

        this._onPointerLeave = () => {
            this.isPointerDown = false;
            if (!this.isMouseOverPopover) {
                this.hoveredAtom = null;
                this.hidePopover();
                if (this.stage && this.stage.signals && this.stage.signals.hovered) {
                    this.stage.signals.hovered.dispatch(null);
                }
            }
        };

        viewport.addEventListener('pointerdown', this._onPointerDown);
        viewport.addEventListener('pointermove', this._onPointerMove);
        viewport.addEventListener('pointerup', this._onPointerUp);
        viewport.addEventListener('pointerleave', this._onPointerLeave);
        this.setupDoubleClickHandler();
    }

    raycastAtCoords(clientX, clientY) {
        if (!this.stage || !this.stage.viewer || !this.stage.viewer.renderer) return null;
        const canvas = this.stage.viewer.renderer.domElement;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }

        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const glY = rect.height - mouseY;

        if (this.stage.pickingControls && typeof this.stage.pickingControls.pick === 'function') {
            return this.stage.pickingControls.pick(mouseX, glY);
        }
        return null;
    }

    performRaycast(clientX, clientY) {
        if (!this.stage || !this.stage.viewer || !this.stage.viewer.renderer) return;
        const canvas = this.stage.viewer.renderer.domElement;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            if (this.hoveredAtom && !this.isMouseOverPopover) {
                this.hoveredAtom = null;
                this.hidePopover();
            }
            return;
        }

        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const glY = rect.height - mouseY;

        let pickingProxy = null;
        if (this.stage.pickingControls && typeof this.stage.pickingControls.pick === 'function') {
            pickingProxy = this.stage.pickingControls.pick(mouseX, glY);
        }

        if (pickingProxy && pickingProxy.atom) {
            this.hoveredAtom = pickingProxy.atom;
            this.showPopover(pickingProxy.atom, mouseX, mouseY);
        } else {
            if (this.hoveredAtom && !this.isMouseOverPopover) {
                this.hoveredAtom = null;
                this.hidePopover();
            }
        }
    }

    showPopover(atom, canvasX, canvasY) {
        if (!this.popoverEl) return;

        const atomIndex = atom.index !== undefined ? atom.index : 0;
        if (this._lastPopoverAtomIndex !== atomIndex) {
            this._lastPopoverAtomIndex = atomIndex;
            const qualifiedId = InteractionManager.getAtomLabel(atom);

            this.popoverEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                    <span style="font-weight: 800; color: #38bdf8; font-family: monospace; font-size: 12px;">${qualifiedId}</span>
                    <span style="background: rgba(56, 189, 248, 0.2); color: #7dd3fc; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 700; white-space: nowrap;">Atom #${atomIndex + 1}</span>
                </div>
            `;
        }

        const viewport = this.shadowRoot ? this.shadowRoot.getElementById('viewport') : null;
        const vpWidth = viewport ? viewport.clientWidth : window.innerWidth;
        const vpHeight = viewport ? viewport.clientHeight : window.innerHeight;

        let left = Math.max(100, Math.min(canvasX, vpWidth - 100));
        let top = Math.max(40, Math.min(canvasY, vpHeight - 20));

        this.popoverEl.style.left = `${left}px`;
        this.popoverEl.style.top = `${top}px`;
        this.popoverEl.style.display = 'block';
    }

    hidePopover() {
        this._lastPopoverAtomIndex = null;
        if (this.popoverEl) {
            this.popoverEl.style.display = 'none';
        }
    }

    centerOnAtom(atom) {
        if (!this.stage || !atom) return;
        try {
            const atomPos = new NGL.Vector3(atom.x ?? 0, atom.y ?? 0, atom.z ?? 0);
            if (this.stage.animationControls && typeof this.stage.animationControls.move === 'function') {
                this.stage.animationControls.move(atomPos, 500);
            } else if (this.stage.animationControls && typeof this.stage.animationControls.zoomMove === 'function') {
                const zoom = this.stage.getZoom ? this.stage.getZoom() : undefined;
                this.stage.animationControls.zoomMove(atomPos, zoom, 500);
            }
            if (this.stage.trackballControls) {
                if (!this.stage.trackballControls.target) {
                    this.stage.trackballControls.target = atomPos.clone();
                } else {
                    this.stage.trackballControls.target.copy(atomPos);
                }
            }
            if (this.stage.viewerControls && typeof this.stage.viewerControls.center === 'function') {
                this.stage.viewerControls.center(atomPos);
            }
            if (this.stage.viewer) {
                this.stage.viewer.requestRender();
            }
        } catch (err) {
            console.warn("Failed to center on atom:", err);
        }
    }

    handleAtomClick(atom) {
        if (!atom) return;
        const id = InteractionManager.getAtomLabel(atom);
        const targetCount = this.pickType === 'angle' ? 3 : (this.pickType === 'dihedral' ? 4 : 2);

        if (this.isPicking) {
            if (this.pickingQueue.length > 0 && this.pickingQueue[this.pickingQueue.length - 1].index === atom.index) {
                this.dispatchMeasureEvent(EVENTS.NOTICE, { level: 'warning', message: 'Please click a different atom.' });
                return;
            }

            this.pickingQueue.push(atom);

            this.dispatchMeasureEvent(EVENTS.ATOM_PICKED, {
                label: id,
                resname: atom.resname || 'RES',
                resno: atom.resno || 0,
                chain: atom.chainname || 'A',
                atomname: atom.atomname || 'CA',
                index: atom.index !== undefined ? atom.index : 0,
                queued: this.pickingQueue.length,
                needed: targetCount
            });

            if (this.pickingQueue.length >= targetCount) {
                const atomsToMeasure = this.pickingQueue.splice(0, targetCount);
                const type = this.pickType;
                this.isPicking = false;
                this.setMode('inspect');
                this.setViewportCursor('grab');
                this.dispatchMeasureEvent(EVENTS.PICK_MODE_CHANGED, { active: false, type });

                try {
                    const record = this._createMeasurementRecord(type, atomsToMeasure);
                    const valStr = record && record.value !== undefined ? ` (${record.value.toFixed(2)} ${record.unit})` : '';
                    this.dispatchMeasureEvent(EVENTS.NOTICE, { level: 'success', message: `Measured ${type.toUpperCase()}${valStr}! Pick mode completed.` });
                } catch (err) {
                    this.dispatchMeasureEvent(EVENTS.NOTICE, { level: 'warning', message: `Failed to measure: ${err.message}` });
                }
            }
        } else {
            this.dispatchMeasureEvent(EVENTS.ATOM_PICKED, {
                label: id,
                resname: atom.resname || 'RES',
                resno: atom.resno || 0,
                chain: atom.chainname || 'A',
                atomname: atom.atomname || 'CA',
                index: atom.index !== undefined ? atom.index : 0,
                queued: 0,
                needed: 0
            });

            if (this.mode !== 'measure') {
                this.centerOnAtom(atom);
            }
        }
    }

    dispatchMeasureEvent(type, detail) {
        if (typeof this.emit === 'function') {
            this.emit(type, detail);
        } else if (this.shadowRoot && this.shadowRoot.host) {
            this.shadowRoot.host.dispatchEvent(new CustomEvent(type, { detail }));
        }
    }

    // --- Geometric Calculation Utilities ---
    static calcDistance(p1, p2) {
        if (!p1 || !p2) return 0;
        const x1 = p1.x ?? 0, y1 = p1.y ?? 0, z1 = p1.z ?? 0;
        const x2 = p2.x ?? 0, y2 = p2.y ?? 0, z2 = p2.z ?? 0;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    static calcAngle(p1, p2, p3) {
        if (!p1 || !p2 || !p3) return 0;
        const x1 = p1.x ?? 0, y1 = p1.y ?? 0, z1 = p1.z ?? 0;
        const x2 = p2.x ?? 0, y2 = p2.y ?? 0, z2 = p2.z ?? 0;
        const x3 = p3.x ?? 0, y3 = p3.y ?? 0, z3 = p3.z ?? 0;

        const v1x = x1 - x2, v1y = y1 - y2, v1z = z1 - z2;
        const v2x = x3 - x2, v2y = y3 - y2, v2z = z3 - z2;

        const len1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z) || 1e-6;
        const len2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z) || 1e-6;

        const dot = (v1x * v2x + v1y * v2y + v1z * v2z) / (len1 * len2);
        const clampedDot = Math.max(-1.0, Math.min(1.0, dot));
        return (Math.acos(clampedDot) * 180.0) / Math.PI;
    }

    static calcDihedral(p1, p2, p3, p4) {
        if (!p1 || !p2 || !p3 || !p4) return 0;
        const x1 = p1.x ?? 0, y1 = p1.y ?? 0, z1 = p1.z ?? 0;
        const x2 = p2.x ?? 0, y2 = p2.y ?? 0, z2 = p2.z ?? 0;
        const x3 = p3.x ?? 0, y3 = p3.y ?? 0, z3 = p3.z ?? 0;
        const x4 = p4.x ?? 0, y4 = p4.y ?? 0, z4 = p4.z ?? 0;

        const b1 = { x: x2 - x1, y: y2 - y1, z: z2 - z1 };
        const b2 = { x: x3 - x2, y: y3 - y2, z: z3 - z2 };
        const b3 = { x: x4 - x3, y: y4 - y3, z: z4 - z3 };

        const n1 = {
            x: b1.y * b2.z - b1.z * b2.y,
            y: b1.z * b2.x - b1.x * b2.z,
            z: b1.x * b2.y - b1.y * b2.x
        };

        const n2 = {
            x: b2.y * b3.z - b2.z * b3.y,
            y: b2.z * b3.x - b2.x * b3.z,
            z: b2.x * b3.y - b2.y * b3.x
        };

        const lenB2 = Math.sqrt(b2.x * b2.x + b2.y * b2.y + b2.z * b2.z) || 1e-6;
        const normB2 = { x: b2.x / lenB2, y: b2.y / lenB2, z: b2.z / lenB2 };

        const m1 = {
            x: n1.y * normB2.z - n1.z * normB2.y,
            y: n1.z * normB2.x - n1.x * normB2.z,
            z: n1.x * normB2.y - n1.y * normB2.x
        };

        const x = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
        const y = m1.x * n2.x + m1.y * n2.y + m1.z * n2.z;

        return (-Math.atan2(y, x) * 180.0) / Math.PI;
    }

    static getAtomLabel(atom) {
        if (!atom) return 'UNKNOWN';
        const resname = atom.resname || 'RES';
        const resno = atom.resno || 0;
        const chainname = atom.chainname || 'A';
        const atomname = atom.atomname || 'CA';
        return `[${resname}]${resno}:${chainname}.${atomname}`;
    }

    static getAtomSelection(atom) {
        if (!atom) return '';
        if (atom.index !== undefined && atom.index !== null) {
            return `@${atom.index}`;
        }
        if (atom.resno !== undefined && atom.chainname && atom.atomname) {
            return `${atom.resno}:${atom.chainname}.${atom.atomname}`;
        }
        return '';
    }

    // --- NGL Measurement Representations ---
    _createMeasurementRep(type, tupleKey, tupleValue, options = {}, defaultColor = "#f43f5e") {
        if (!this.comp) return null;
        try {
            const config = {
                [tupleKey]: tupleValue,
                color: options.color || defaultColor,
                labelColor: options.labelColor || "#ffffff",
                labelSize: options.labelSize || 2.2,
                labelVisible: options.labelVisible !== undefined ? options.labelVisible : true,
                linewidth: options.linewidth || 3.0,
                useWideLines: true,
                sdf: true,
                useSdf: true,
                labelsdf: true,
                labelFontFamily: options.fontFamily || "sans-serif",
                labelFontWeight: "bold",
                labelBackground: true,
                labelBackgroundColor: options.backgroundColor || "#0f172a",
                labelBackgroundOpacity: options.backgroundOpacity !== undefined ? options.backgroundOpacity : 0.95,
                labelBackgroundMargin: options.backgroundMargin !== undefined ? options.backgroundMargin : 0.6,
                labelBorder: true,
                labelBorderColor: options.borderColor || "#334155",
                labelBorderWidth: options.borderWidth !== undefined ? options.borderWidth : 0.3,
                showBackground: true,
                backgroundColor: options.backgroundColor || "#0f172a",
                backgroundOpacity: 0.95,
                backgroundMargin: 0.6,
                showBorder: true,
                borderColor: options.borderColor || "#334155",
                borderWidth: 0.3
            };
            if (type === "distance") {
                config.labelUnit = "angstrom";
            }
            const rep = this.comp.addRepresentation(type, config);
            if (options.visible === false && rep && typeof rep.setVisibility === 'function') {
                rep.setVisibility(false);
            }
            return rep;
        } catch (err) {
            report('engine:measurement', err);
            logger.log('warn', 'MEASURE', `${type.charAt(0).toUpperCase() + type.slice(1)} representation error: ${err.message}`);
            return null;
        }
    }

    _createMeasurementRecord(type, resolvedAtoms, options = {}) {
        let val = 0;
        let tupleKey = 'atomPair';
        let defaultColor = '#f43f5e';

        if (type === 'distance') {
            val = InteractionManager.calcDistance(resolvedAtoms[0], resolvedAtoms[1]);
            tupleKey = 'atomPair';
            defaultColor = '#f43f5e';
        } else if (type === 'angle') {
            val = InteractionManager.calcAngle(resolvedAtoms[0], resolvedAtoms[1], resolvedAtoms[2]);
            tupleKey = 'atomTriple';
            defaultColor = '#3b82f6';
        } else if (type === 'dihedral') {
            val = InteractionManager.calcDihedral(resolvedAtoms[0], resolvedAtoms[1], resolvedAtoms[2], resolvedAtoms[3]);
            tupleKey = 'atomQuad';
            defaultColor = '#a855f7';
        }

        const selList = resolvedAtoms.map(a => InteractionManager.getAtomSelection(a));
        const labelList = resolvedAtoms.map(a => InteractionManager.getAtomLabel(a));

        const rep = this._createMeasurementRep(type, tupleKey, [selList], options, defaultColor);

        const id = `meas_${this.nextId++}`;
        const unit = type === 'distance' ? 'Å' : '°';
        const isVisible = options.visible !== false;

        const record = {
            id,
            type,
            atomLabels: labelList,
            atoms: resolvedAtoms,
            value: val,
            unit,
            representation: rep,
            visible: isVisible
        };

        this.measurements.push(record);
        if (this.stage?.viewer?.requestRender) this.stage.viewer.requestRender();
        logger.log('info', 'MEASURE', `${type.toUpperCase()}: ${labelList.join(' - ')} = ${val.toFixed(type === 'distance' ? 2 : 1)} ${unit}`);

        this.dispatchMeasureEvent(EVENTS.MEASUREMENTS_CHANGED, { count: this.measurements.length });

        return {
            id,
            type,
            label: labelList.join(' - '),
            value: Number(val.toFixed(type === 'distance' ? 2 : 1)),
            unit,
            visible: isVisible,
            atoms: [...labelList]
        };
    }

    addMeasurement(type, atomSpecs) {
        if (!this.comp || !this.comp.structure) {
            throw new Error('No structure loaded for measurement');
        }

        const validTypes = ['distance', 'angle', 'dihedral'];
        if (!validTypes.includes(type)) {
            throw new Error(`Invalid measurement type: ${type}`);
        }

        let specs = [];
        if (typeof atomSpecs === 'string') {
            specs = atomSpecs.split(',').map(s => s.trim()).filter(Boolean);
        } else if (Array.isArray(atomSpecs)) {
            specs = atomSpecs;
        } else {
            throw new Error('Atom selections must be specified as strings');
        }

        const needed = type === 'angle' ? 3 : (type === 'dihedral' ? 4 : 2);
        const resolvedAtoms = [];

        for (const spec of specs) {
            if (!spec) continue;
            if (typeof spec === 'object' && spec.index !== undefined && spec.x !== undefined) {
                resolvedAtoms.push(spec);
                continue;
            }
            const selStr = String(spec).trim();
            if (!selStr) continue;
            try {
                const sele = new NGL.Selection(selStr);
                const view = this.comp.structure.getView(sele);
                if (view && view.atomCount > 0) {
                    let firstAtom = null;
                    view.eachAtom(a => {
                        if (!firstAtom) {
                            firstAtom = {
                                index: a.index,
                                x: a.x,
                                y: a.y,
                                z: a.z,
                                resname: a.resname,
                                resno: a.resno,
                                chainname: a.chainname,
                                atomname: a.atomname
                            };
                        }
                    });
                    if (firstAtom) resolvedAtoms.push(firstAtom);
                }
            } catch (e) {
                // Ignore syntax error
            }
        }

        if (resolvedAtoms.length < needed) {
            throw new Error(`Need ${needed} valid atom selections for ${type}`);
        }

        return this._createMeasurementRecord(type, resolvedAtoms.slice(0, needed));
    }

    restoreMeasurement({ type, atomIndices, visible = true }) {
        if (!this.comp || !this.comp.structure) {
            return null;
        }
        const needed = type === 'angle' ? 3 : (type === 'dihedral' ? 4 : 2);
        if (!Array.isArray(atomIndices) || atomIndices.length < needed) {
            throw new Error(`Need ${needed} atom indices to restore ${type}`);
        }
        const resolvedAtoms = atomIndices.slice(0, needed).map(idx => {
            const ap = this.comp.structure.getAtomProxy(idx);
            if (ap) {
                ap.index = idx;
                return {
                    index: ap.index !== undefined ? ap.index : idx,
                    x: ap.x ?? 0,
                    y: ap.y ?? 0,
                    z: ap.z ?? 0,
                    resname: ap.resname || 'RES',
                    resno: ap.resno || 0,
                    chainname: ap.chainname || 'A',
                    atomname: ap.atomname || 'CA'
                };
            }
            return { index: idx, x: 0, y: 0, z: 0, resname: 'RES', resno: 0, chainname: 'A', atomname: 'CA' };
        });
        return this._createMeasurementRecord(type, resolvedAtoms, { visible });
    }

    addDistance(atom1, atom2, options = {}) {
        if (!this.comp || !atom1 || !atom2) return null;
        return this._createMeasurementRecord('distance', [atom1, atom2], options);
    }

    addAngle(atom1, atom2, atom3, options = {}) {
        if (!this.comp || !atom1 || !atom2 || !atom3) return null;
        return this._createMeasurementRecord('angle', [atom1, atom2, atom3], options);
    }

    addDihedral(atom1, atom2, atom3, atom4, options = {}) {
        if (!this.comp || !atom1 || !atom2 || !atom3 || !atom4) return null;
        return this._createMeasurementRecord('dihedral', [atom1, atom2, atom3, atom4], options);
    }

    updateValues() {
        if (!this.comp || !this.comp.structure) return;
        const ap = this.comp.structure.getAtomProxy();
        this.measurements.forEach(m => {
            if (!m.atoms || m.atoms.length === 0) return;
            const coords = m.atoms.map(a => {
                ap.index = a.index;
                return { x: ap.x, y: ap.y, z: ap.z };
            });

            if (m.type === 'distance' && coords.length >= 2) {
                m.value = InteractionManager.calcDistance(coords[0], coords[1]);
            } else if (m.type === 'angle' && coords.length >= 3) {
                m.value = InteractionManager.calcAngle(coords[0], coords[1], coords[2]);
            } else if (m.type === 'dihedral' && coords.length >= 4) {
                m.value = InteractionManager.calcDihedral(coords[0], coords[1], coords[2], coords[3]);
            }
        });
    }

    setMeasurementVisible(id, visible = null) {
        const item = this.measurements.find(m => m.id === id);
        if (item) {
            item.visible = (visible !== null && visible !== undefined) ? !!visible : !item.visible;
            if (item.representation && typeof item.representation.setVisibility === 'function') {
                item.representation.setVisibility(item.visible);
            }
            if (this.stage?.viewer?.requestRender) {
                this.stage.viewer.requestRender();
            }
            logger.log('info', 'MEASURE', `Measurement ID ${id} visibility set to ${item.visible}`);
            this.dispatchMeasureEvent(EVENTS.MEASUREMENTS_CHANGED, { count: this.measurements.length });
            return item.visible;
        }
        return false;
    }

    toggleVisibility(id, visible = null) {
        return this.setMeasurementVisible(id, visible);
    }

    removeMeasurement(id) {
        const index = this.measurements.findIndex(m => m.id === id);
        if (index !== -1) {
            const item = this.measurements[index];
            if (item.representation && this.comp) {
                try {
                    this.comp.removeRepresentation(item.representation);
                } catch(e) {}
            }
            this.measurements.splice(index, 1);
            if (this.stage?.viewer?.requestRender) this.stage.viewer.requestRender();
            logger.log('info', 'MEASURE', `Removed measurement ID: ${id}`);
            this.dispatchMeasureEvent(EVENTS.MEASUREMENTS_CHANGED, { count: this.measurements.length });
            return true;
        }
        return false;
    }

    clearMeasurements() {
        this.measurements.forEach(item => {
            if (item.representation && this.comp) {
                try {
                    this.comp.removeRepresentation(item.representation);
                } catch(e) {}
            }
        });
        this.measurements = [];
        this.pickingQueue = [];
        if (this.stage?.viewer?.requestRender) this.stage.viewer.requestRender();
        logger.log('info', 'MEASURE', `Cleared all measurements`);
        this.dispatchMeasureEvent(EVENTS.MEASUREMENTS_CHANGED, { count: 0 });
    }

    getMeasurements() {
        return this.measurements.map(m => ({
            id: m.id,
            type: m.type,
            label: m.atomLabels.join(' - '),
            value: Number(m.value.toFixed(m.type === 'distance' ? 2 : 1)),
            unit: m.unit,
            visible: m.visible !== false,
            atoms: [...m.atomLabels]
        }));
    }

    getMeasurementValues() {
        const len = this.measurements.length;
        if (!this._valuesBuffer || this._valuesBuffer.length !== len) {
            this._valuesBuffer = new Float64Array(len);
        }
        for (let i = 0; i < len; i++) {
            this._valuesBuffer[i] = this.measurements[i].value;
        }
        return this._valuesBuffer;
    }

    focusMeasurement(id, duration = 600) {
        const item = this.measurements.find(m => m.id === id);
        if (!item || !item.atoms || item.atoms.length === 0) return;

        let sumX = 0, sumY = 0, sumZ = 0;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        item.atoms.forEach(a => {
            const x = (typeof a.x === 'number') ? a.x : 0;
            const y = (typeof a.y === 'number') ? a.y : 0;
            const z = (typeof a.z === 'number') ? a.z : 0;
            sumX += x; sumY += y; sumZ += z;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        });

        const count = item.atoms.length;
        const center = new NGL.Vector3(sumX / count, sumY / count, sumZ / count);

        if (this.comp && this.comp.matrix) {
            center.applyMatrix4(this.comp.matrix);
        }

        const padding = 8.0;
        const box = new NGL.Box3(
            new NGL.Vector3(minX - padding, minY - padding, minZ - padding),
            new NGL.Vector3(maxX + padding, maxY + padding, maxZ + padding)
        );
        if (this.comp && this.comp.matrix) {
            box.applyMatrix4(this.comp.matrix);
        }

        if (this.stage) {
            if (this.stage.animationControls && typeof this.stage.animationControls.zoomMove === 'function') {
                const zoom = (typeof this.stage.getZoomForBox === 'function') ? this.stage.getZoomForBox(box) : -25;
                this.stage.animationControls.zoomMove(center, zoom, duration);
            } else if (this.comp && typeof this.comp.autoView === 'function') {
                const sel = item.atoms.map(a => `@${a.index}`).join(' or ');
                this.comp.autoView(sel, duration);
            }
        }
        logger.log('info', 'MEASURE', `Focused viewport on measurement ${id} (${item.atomLabels.join(' - ')})`);
    }

    getMeasurementData() {
        return this.measurements.map(m => ({
            id: m.id,
            type: m.type,
            label: m.atomLabels.join(' - '),
            atoms: m.atoms,
            atomLabels: m.atomLabels,
            value: Number(m.value.toFixed(2)),
            unit: m.unit,
            visible: m.visible !== false
        }));
    }

    exportMeasurements(format = 'csv') {
        if (format === 'json') {
            return this.exportJSON();
        }
        return this.exportCSV();
    }

    exportJSON() {
        return JSON.stringify(this.getMeasurements(), null, 2);
    }

    exportCSV() {
        const data = this.getMeasurements();
        if (data.length === 0) return 'ID,Type,Atoms,Value,Unit\n';

        let csv = 'ID,Type,Atoms,Value,Unit\n';
        data.forEach(row => {
            const atomsStr = `"${row.atoms.join(' | ')}"`;
            csv += `${row.id},${row.type},${atomsStr},${row.value},${row.unit}\n`;
        });
        return csv;
    }

    dispose() {
        this.clearMeasurements();
        if (this.popoverEl && this.popoverEl.parentNode) {
            this.popoverEl.parentNode.removeChild(this.popoverEl);
        }
        const viewport = this.shadowRoot ? this.shadowRoot.getElementById('viewport') : null;
        if (viewport && this._onDblClick) {
            viewport.removeEventListener('dblclick', this._onDblClick);
        }
        const domCanvas = this.stage?.viewer?.renderer?.domElement;
        if (domCanvas && this._onDblClick) {
            domCanvas.removeEventListener('dblclick', this._onDblClick);
        }
        this._onDblClick = null;
    }
}
