// src/shape-manager.js
// Single Task: Custom Geometric Primitives (Shape), Vector Arrows & Bounding Box Overlays Engine

import * as NGL from 'ngl';
import { logger } from '../shared/logger.js';

export class ShapeManager {
    constructor(stage = null) {
        this.stage = stage;
        this.shapesList = []; // List of { id, type, name, sele, params, color, opacity, visible, dimensions, shapeComp }
        this.nextId = 1;
    }

    setStage(stage) {
        if (this.stage !== stage) {
            this.clearAll();
            this.stage = stage;
        }
    }

    /**
     * Helper to convert color formats (hex string, rgb array, NGL.Color) to [r,g,b] normalized (0..1).
     */
    static normalizeColor(colorVal) {
        if (Array.isArray(colorVal) && colorVal.length >= 3) return colorVal;
        const c = new NGL.Color(colorVal || '#2563eb');
        return [c.r, c.g, c.b];
    }

    _createItemComponent(item) {
        if (!this.stage) return;
        if (item.shapeComp) {
            try {
                this.stage.removeComponent(item.shapeComp);
            } catch (e) {}
            item.shapeComp = null;
        }

        const shape = new NGL.Shape(`Shape_${item.id}`);
        const p = item.params;
        if (item.type === 'box') {
            shape.addBox(p.position, p.color, p.size, p.heightAxis, p.depthAxis, item.name);
        }

        try {
            item.shapeComp = this.stage.addComponentFromObject(shape);
            const opacity = item.opacity !== undefined ? item.opacity : 0.8;
            item.shapeComp.addRepresentation("buffer", { opacity });
            item.shapeComp.setVisibility(item.visible !== false);
            if (this.stage.viewer) this.stage.viewer.requestRender();
        } catch (err) {
            logger.log('warn', 'SHAPE', `Error creating ShapeComponent: ${err.message}`);
        }
    }

    /**
     * Adds a 3D Box (`addBox`) or Oriented Bounding Box around a selection.
     */
    addBoundingBox(comp, selectionStr, options = {}) {
        if (!comp || !comp.structure) return null;

        const seleQuery = (selectionStr && selectionStr.trim()) ? selectionStr.trim() : 'all';
        const sele = new NGL.Selection(seleQuery);
        const view = comp.structure.getView(sele);
        if (!view || view.atomCount === 0) return null;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        view.eachAtom(a => {
            if (a.x < minX) minX = a.x;
            if (a.x > maxX) maxX = a.x;
            if (a.y < minY) minY = a.y;
            if (a.y > maxY) maxY = a.y;
            if (a.z < minZ) minZ = a.z;
            if (a.z > maxZ) maxZ = a.z;
        });

        // Add padding
        const padding = options.padding !== undefined ? options.padding : 0.8;
        minX -= padding; minY -= padding; minZ -= padding;
        maxX += padding; maxY += padding; maxZ += padding;

        const com = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;

        const colorHex = options.color || '#3b82f6';
        const normColor = ShapeManager.normalizeColor(colorHex);
        const opacity = options.opacity !== undefined ? options.opacity : 0.8;
        const name = options.name || (seleQuery === 'all' ? 'Full System Box' : `Box (${seleQuery})`);

        const id = `shape_${this.nextId++}`;
        const item = {
            id,
            type: 'box',
            name,
            sele: seleQuery,
            color: colorHex,
            opacity,
            visible: true,
            dimensions: [dx, dy, dz],
            shapeComp: null,
            params: {
                position: com,
                color: normColor,
                size: dx,
                heightAxis: [0, dy, 0],
                depthAxis: [0, 0, dz]
            }
        };

        this.shapesList.push(item);
        this._createItemComponent(item);
        logger.log('info', 'SHAPE', `Added Bounding Box around "${seleQuery}" dimensions [${dx.toFixed(1)} x ${dy.toFixed(1)} x ${dz.toFixed(1)}] Å (opacity: ${opacity})`);
        return item;
    }

    /**
     * Sets visibility of a shape overlay by ID.
     */
    setShapeVisible(id, visible) {
        const item = this.shapesList.find(s => s.id === id);
        if (item) {
            item.visible = Boolean(visible);
            if (item.shapeComp) {
                item.shapeComp.setVisibility(item.visible);
                if (this.stage && this.stage.viewer) {
                    this.stage.viewer.requestRender();
                }
            }
            return item.visible;
        }
        return false;
    }

    /**
     * Toggles visibility of a shape overlay by ID.
     */
    toggleVisibility(id) {
        const item = this.shapesList.find(s => s.id === id);
        if (item) {
            return this.setShapeVisible(id, !item.visible);
        }
        return false;
    }

    /**
     * Removes a single shape overlay by ID.
     */
    removeShape(id) {
        const idx = this.shapesList.findIndex(s => s.id === id);
        if (idx !== -1) {
            const item = this.shapesList[idx];
            if (item.shapeComp && this.stage) {
                try {
                    this.stage.removeComponent(item.shapeComp);
                } catch (e) {}
            }
            this.shapesList.splice(idx, 1);
            if (this.stage && this.stage.viewer) {
                this.stage.viewer.requestRender();
            }
            logger.log('info', 'SHAPE', `Removed shape overlay ID: ${id}`);
            return true;
        }
        return false;
    }

    /**
     * Clears all custom shape overlays.
     */
    clearAll() {
        this.shapesList.forEach(item => {
            if (item.shapeComp && this.stage) {
                try {
                    this.stage.removeComponent(item.shapeComp);
                } catch (e) {}
            }
        });
        this.shapesList = [];
        if (this.stage && this.stage.viewer) {
            this.stage.viewer.requestRender();
        }
        logger.log('info', 'SHAPE', `Cleared all custom shape overlays`);
    }

    /**
     * Returns plain records of all shapes (isolated from internal components).
     */
    getShapes() {
        return this.shapesList.map(s => ({
            id: s.id,
            type: s.type,
            name: s.name,
            sele: s.sele,
            color: s.color,
            opacity: s.opacity,
            visible: s.visible,
            dimensions: s.dimensions ? [...s.dimensions] : null
        }));
    }
}

