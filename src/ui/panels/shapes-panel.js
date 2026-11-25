// src/ui/panels/shapes-panel.js
// Isolated UI Panel for Geometric Shapes & Bounding Box Overlays

import { EVENTS } from '../../contracts/events.js';
import { $id, escapeHtml } from '../shell/dom-utils.js';

function renderEyeButton(id, isVis, extraClass = '', dataAttrs = '', title = '') {
    const idAttr = id ? `id="${id}"` : '';
    const titleAttr = title ? `title="${title}"` : '';
    const iconId = isVis ? '#icon-eye-open' : '#icon-eye-closed';
    return `
        <button ${idAttr} class="p-1 rounded hover:bg-slate-700/50 ${extraClass}" ${dataAttrs} ${titleAttr} aria-label="${title || (isVis ? 'Hide' : 'Show')}">
            <svg class="w-3.5 h-3.5 ${isVis ? 'text-slate-300' : 'text-slate-600'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <use href="${iconId}"/>
            </svg>
        </button>
    `;
}

export function initShapesPanel({ engine, listen }) {
    const shapeSeleInput = $id('shape-sele-input');
    const shapeColorPicker = $id('shape-color-picker');
    const shapeOpacitySlider = $id('shape-opacity-slider');
    const shapeOpacityLabel = $id('shape-opacity-label');
    const btnAddShape = $id('btn-add-shape-overlay');
    const shapeListContainer = $id('shape-list-container');
    const btnClearShapes = $id('btn-clear-shape-overlays');

    if (shapeOpacitySlider) {
        listen(shapeOpacitySlider, 'input', (e) => {
            if (shapeOpacityLabel) {
                const val = parseFloat(e.target.value);
                shapeOpacityLabel.innerText = `${Math.round(val * 100)}%`;
            }
        });
    }

    const updateShapeListUI = (shapeList) => {
        if (!shapeListContainer) return;
        const shapes = Array.isArray(shapeList) ? shapeList : (engine.getShapes() || []);
        if (shapes.length === 0) {
            shapeListContainer.innerHTML = '<span style="color: #94a3b8; font-style: italic; text-align: center; padding: 4px;">No bounding box overlays active</span>';
            return;
        }
        shapeListContainer.innerHTML = '';
        shapes.forEach(s => {
            const isVis = s.visible !== false;
            const row = document.createElement('div');
            row.className = `ui-item-row row-purple ${isVis ? 'active' : 'dimmed'}`;
            
            const dimStr = s.dimensions ? ` [${s.dimensions.map(d => Number(d).toFixed(1)).join('×')} Å]` : '';
            const seleStr = escapeHtml(s.sele || 'all');
            const nameStr = escapeHtml(s.name);
            const idStr = escapeHtml(s.id);
            const opPercent = Math.round((s.opacity ?? 0.8) * 100);

            row.innerHTML = `
                <div style="display: flex; flex-direction: column; overflow: hidden; flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${s.color || '#3b82f6'}; flex-shrink: 0;"></span>
                        <span style="font-weight: 700; color: #6b21a8; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameStr}</span>
                    </div>
                    <span style="font-size: 9px; font-family: monospace; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${seleStr}${dimStr} (${opPercent}%)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                    ${renderEyeButton('', isVis, 'shape-vis-btn', `data-id="${idStr}" data-vis="${isVis}"`, isVis ? 'Hide Overlay' : 'Show Overlay')}
                    <button class="del-shape-btn ui-del-btn" data-id="${idStr}" title="Delete Overlay" aria-label="Delete Overlay">✕</button>
                </div>
            `;

            shapeListContainer.appendChild(row);
        });
    };

    if (shapeListContainer) {
        listen(shapeListContainer, 'click', (e) => {
            const delBtn = e.target.closest('.del-shape-btn');
            if (delBtn) {
                e.stopPropagation();
                const id = delBtn.getAttribute('data-id');
                if (id) engine.removeShape(id);
                return;
            }
            const visBtn = e.target.closest('.shape-vis-btn');
            if (visBtn) {
                e.stopPropagation();
                const id = visBtn.getAttribute('data-id');
                const isVis = visBtn.getAttribute('data-vis') === 'true';
                if (id) engine.setShapeVisible(id, !isVis);
                return;
            }
        });
    }

    if (btnAddShape) {
        listen(btnAddShape, 'click', () => {
            const rawSele = shapeSeleInput?.value?.trim() || '';
            const sele = rawSele === '' ? 'all' : rawSele;
            const color = shapeColorPicker?.value || '#3b82f6';
            const opacity = shapeOpacitySlider ? parseFloat(shapeOpacitySlider.value) : 0.8;

            engine.addBoundingBox(sele, {
                color,
                opacity,
                name: sele === 'all' ? 'Full System Box' : `Box (${sele})`
            });
        });
    }

    if (btnClearShapes) {
        listen(btnClearShapes, 'click', () => {
            engine.clearShapes();
        });
    }

    // Listen to engine shape and lifecycle events
    listen(engine, EVENTS.SHAPES_CHANGED, (e) => {
        updateShapeListUI(e.detail?.shapes);
    });

    listen(engine, EVENTS.TOPOLOGY_CLEARED, () => {
        updateShapeListUI([]);
    });

    listen(engine, EVENTS.SESSION_RESTORED, () => {
        updateShapeListUI();
    });

    // Initial render
    updateShapeListUI();
}
