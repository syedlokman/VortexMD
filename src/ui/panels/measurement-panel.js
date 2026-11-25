// src/ui/panels/measurement-panel.js
// Isolated UI Panel for 3D Interatomic Measurement Suite

import { downloadBlob } from '../../shared/download.js';
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

export function initMeasurementPanel({ engine, listen }) {
    const measTypeSelect = $id('meas-type-select');
    const measAtomsInput = $id('meas-atoms-input');
    const btnMeasAtomPicker = $id('btn-meas-atom-picker');
    const measPickerStatus = $id('meas-picker-status');
    const btnAddManualMeas = $id('btn-add-manual-meas');
    const measInspectorTable = $id('meas-inspector-table');
    const btnExportMeasCsv = $id('btn-export-meas-csv');
    const btnExportMeasJson = $id('btn-export-meas-json');
    const btnClearMeasSuite = $id('btn-clear-meas-suite');

    let isAtomPickingActive = false;

    const updatePickerUI = (active, currentType) => {
        if (!btnMeasAtomPicker) return;
        if (active) {
            btnMeasAtomPicker.style.background = '#2563eb';
            btnMeasAtomPicker.style.color = '#ffffff';
            btnMeasAtomPicker.style.borderColor = '#1d4ed8';
            btnMeasAtomPicker.style.boxShadow = '0 0 0 2px rgba(37, 99, 235, 0.25)';
            btnMeasAtomPicker.setAttribute('aria-pressed', 'true');
            if (measPickerStatus) {
                measPickerStatus.style.display = 'block';
                const type = currentType || measTypeSelect?.value || 'distance';
                const targetCount = type === 'angle' ? 3 : (type === 'dihedral' ? 4 : 2);
                measPickerStatus.innerText = `🎯 Pick mode ON: Click ${targetCount} atoms in 3D canvas to measure ${type}`;
            }
        } else {
            btnMeasAtomPicker.style.background = '#ffffff';
            btnMeasAtomPicker.style.color = '#2563eb';
            btnMeasAtomPicker.style.borderColor = '#cbd5e1';
            btnMeasAtomPicker.style.boxShadow = 'none';
            btnMeasAtomPicker.setAttribute('aria-pressed', 'false');
            if (measPickerStatus) {
                measPickerStatus.style.display = 'none';
            }
        }
    };

    if (btnMeasAtomPicker) {
        listen(btnMeasAtomPicker, 'click', () => {
            if (isAtomPickingActive) {
                engine.cancelPick();
            } else {
                const type = measTypeSelect?.value || 'distance';
                engine.startMeasurementPick(type);
            }
        });
    }

    if (measTypeSelect) {
        listen(measTypeSelect, 'change', () => {
            if (isAtomPickingActive) {
                const type = measTypeSelect.value || 'distance';
                engine.startMeasurementPick(type);
            }
        });
    }

    if (btnAddManualMeas) {
        listen(btnAddManualMeas, 'click', () => {
            const type = measTypeSelect?.value || 'distance';
            const rawAtoms = measAtomsInput?.value?.trim() || '';
            try {
                engine.addMeasurement(type, rawAtoms);
            } catch (err) {
                engine.notify('warning', err.message || 'Failed to add measurement');
            }
        });
    }

    if (btnExportMeasCsv) {
        listen(btnExportMeasCsv, 'click', () => {
            const csv = engine.exportMeasurements('csv');
            const blob = new Blob([csv], { type: 'text/csv' });
            downloadBlob(blob, 'VortexMD_Measurements.csv');
        });
    }

    if (btnExportMeasJson) {
        listen(btnExportMeasJson, 'click', () => {
            const json = engine.exportMeasurements('json');
            const blob = new Blob([json], { type: 'application/json' });
            downloadBlob(blob, 'VortexMD_Measurements.json');
        });
    }

    if (btnClearMeasSuite) {
        listen(btnClearMeasSuite, 'click', () => {
            engine.clearMeasurements();
            if (measPickerStatus && isAtomPickingActive) {
                const type = measTypeSelect?.value || 'distance';
                const targetCount = type === 'angle' ? 3 : (type === 'dihedral' ? 4 : 2);
                measPickerStatus.innerText = `🎯 Pick mode ON: Click ${targetCount} atoms in 3D canvas to measure ${type}`;
            }
        });
    }

    const renderTable = () => {
        if (!measInspectorTable) return;
        const data = engine.getMeasurements();
        if (data.length === 0) {
            measInspectorTable.innerHTML = '<span style="color: #94a3b8; font-style: italic;">No measurements added. Click atoms in viewport or enter above.</span>';
            return;
        }
        measInspectorTable.innerHTML = '';
        data.forEach((m, i) => {
            const isVis = m.visible !== false;
            const row = document.createElement('div');
            row.className = `ui-item-row ${isVis ? 'active' : 'dimmed'}`;
            row.title = "Click to focus 3D view on measurement";
            row.setAttribute('data-id', m.id);
            const typeStr = escapeHtml(m.type);
            const labelStr = escapeHtml(m.label);
            const unitStr = escapeHtml(m.unit);
            row.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1px; overflow: hidden; flex: 1; min-width: 0;">
                    <span style="font-weight: 700; color: ${isVis ? '#1d4ed8' : '#64748b'}; text-transform: uppercase; font-size: 9px;">${typeStr}</span>
                    <span style="color: #475569; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${labelStr}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 4px;">
                    <strong data-meas-val="${escapeHtml(m.id)}" data-meas-index="${i}" data-type="${typeStr}" data-unit="${unitStr}" style="color: ${isVis ? '#1e40af' : '#64748b'}; font-size: 11px;">${m.value.toFixed(m.type === 'distance' ? 2 : 1)} ${unitStr}</strong>
                    ${renderEyeButton('', isVis, 'toggle-meas-vis-btn', `data-id="${escapeHtml(m.id)}"`, isVis ? 'Hide Measurement' : 'Show Measurement')}
                    <button class="del-meas-btn ui-del-btn" data-id="${escapeHtml(m.id)}" title="Delete Measurement" aria-label="Delete Measurement">✕</button>
                </div>
            `;
            measInspectorTable.appendChild(row);
        });
    };

    if (measInspectorTable) {
        listen(measInspectorTable, 'click', (e) => {
            const delBtn = e.target.closest('.del-meas-btn');
            if (delBtn) {
                e.stopPropagation();
                const id = delBtn.getAttribute('data-id');
                if (id) engine.removeMeasurement(id);
                return;
            }
            const visBtn = e.target.closest('.toggle-meas-vis-btn');
            if (visBtn) {
                e.stopPropagation();
                const id = visBtn.getAttribute('data-id');
                if (id) engine.setMeasurementVisible(id);
                return;
            }
            const row = e.target.closest('.ui-item-row');
            if (row) {
                const id = row.getAttribute('data-id');
                if (id) engine.focusMeasurement(id);
            }
        });
    }

    listen(engine, EVENTS.PICK_MODE_CHANGED, (e) => {
        const detail = e.detail || {};
        isAtomPickingActive = Boolean(detail.active);
        updatePickerUI(isAtomPickingActive, detail.type);
    });

    listen(engine, EVENTS.MEASUREMENTS_CHANGED, () => {
        renderTable();
    });

    listen(engine, EVENTS.ATOM_PICKED, (e) => {
        const detail = e.detail;
        if (!detail || !isAtomPickingActive) return;
        const { resno, chain, atomname, queued, needed } = detail;
        if (queued > 0) {
            const atomToken = `${resno}:${chain}.${atomname}`;
            if (queued === 1) {
                if (measAtomsInput) measAtomsInput.value = atomToken;
            } else {
                if (measAtomsInput) measAtomsInput.value += `, ${atomToken}`;
            }

            if (queued >= needed) {
                if (measPickerStatus) {
                    measPickerStatus.style.display = 'block';
                    measPickerStatus.innerText = `✅ Measured ${(measTypeSelect?.value || 'distance').toUpperCase()}! Pick mode completed.`;
                }
            } else {
                if (measPickerStatus) {
                    measPickerStatus.style.display = 'block';
                    measPickerStatus.innerText = `🎯 Picked ${queued}/${needed} atoms (${measAtomsInput?.value || ''}). Click next atom...`;
                }
            }
        }
    });

    listen(engine, EVENTS.FRAME_UPDATE, () => {
        if (!measInspectorTable) return;
        const panel = document.getElementById('tab-panel-annotation');
        if (!panel || !panel.classList.contains('active')) return;

        const values = engine.getMeasurementValues();
        if (!values || values.length === 0) return;

        const valEls = measInspectorTable.querySelectorAll('[data-meas-index]');
        for (let i = 0; i < valEls.length && i < values.length; i++) {
            const el = valEls[i];
            const type = el.getAttribute('data-type');
            const unit = el.getAttribute('data-unit') || '';
            const val = values[i];
            const text = `${val.toFixed(type === 'distance' ? 2 : 1)} ${unit}`;
            if (el.textContent !== text) {
                el.textContent = text;
            }
        }
    });

    listen(engine, EVENTS.UI_DRAWER_TOGGLE, (e) => {
        if (!e.detail?.open && isAtomPickingActive) {
            engine.cancelPick();
        }
    });

    renderTable();
}
