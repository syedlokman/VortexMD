// src/ui/panels/display-tree-panel.js
// Isolated UI Panel for PyMOL Molecular Object Tree and Unified Custom Selection System
// In-place row updates for style/visibility changes; full rebuild only on structural changes.

import { STYLE_OPTIONS, POLYMER_GROUPS, ENTITY_STYLES, getLipidDefaultColor } from '../../contracts/display.js';
import { EVENTS } from '../../contracts/events.js';
import { escapeHtml } from '../shell/dom-utils.js';


export { STYLE_OPTIONS, POLYMER_GROUPS, ENTITY_STYLES };

export function getStyleShortCode(val) {
    const opt = STYLE_OPTIONS.find(o => o.value === val);
    if (opt && opt.short) return opt.short;
    if (!val) return "Ca";
    return val.slice(0, 2).toUpperCase();
}

export function getStyleLabel(val) {
    const opt = STYLE_OPTIONS.find(o => o.value === val);
    return opt ? opt.label : (val || "Cartoon");
}

const SUB_KEYS = { proteins: 'chains', rna: 'chains', dna: 'chains', ligands: 'items', membrane: 'species' };

const countSpan = (text) => `<span class="text-[10px] font-medium text-slate-500">${text}</span>`;
const dAttrs = (t) => `data-target="${t.target}"${t.id !== undefined ? ` data-id="${t.id}"` : ''}`;

function renderStyleOptions(selectedStyle, category = null) {
    const allowed = (category && ENTITY_STYLES[category]) ? ENTITY_STYLES[category] : null;
    const options = allowed ? STYLE_OPTIONS.filter(opt => allowed.includes(opt.value)) : STYLE_OPTIONS;
    return options.map(opt =>
        `<option value="${opt.value}" ${opt.value === selectedStyle ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
}

function renderStyleControl(dataAttrs, selectedStyle, extraId = '', category = null) {
    const label = getStyleLabel(selectedStyle);
    return `
        <div class="tree-style-container style-select-container" title="Style: ${label}">
            <span class="style-badge-label">${getStyleShortCode(selectedStyle)}</span>
            <select class="absolute inset-0 size-full opacity-0 cursor-pointer z-[2] m-0 p-0" ${extraId ? `id="${extraId}"` : ''} ${dataAttrs} title="Style: ${label}">
                ${renderStyleOptions(selectedStyle, category)}
            </select>
        </div>
    `;
}

export function renderEyeButton(id, isVis, extraClass = '', dataAttrs = '', title = '') {
    const defaultTitle = title || (isVis ? 'Hide' : 'Show');
    const iconId = isVis ? '#icon-eye-open' : '#icon-eye-closed';
    return `
        <button type="button" class="eye-toggle-btn ${isVis ? 'active' : ''} ${extraClass}" ${id ? `id="${id}"` : ''} ${dataAttrs} title="${defaultTitle}" aria-label="${defaultTitle}">
            <svg viewBox="0 0 24 24" class="pointer-events-none" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <use href="${iconId}"/>
            </svg>
        </button>
    `.trim();
}

function renderRow({ t, cls = '', label, sub, sele, title, color, style, category, visible, visTitle, ids = {} }) {
    const d = dAttrs(t);
    return `
        <div class="pymol-row">
            <span class="focus-label cursor-pointer ${cls}" data-sele="${escapeHtml(sele)}" title="Click to Focus ${escapeHtml(title)}">${label}${sub ? ' ' + countSpan(sub) : ''}</span>
            <div class="pymol-controls">
                ${color ? `<input type="color" ${ids.color ? `id="${ids.color}"` : ''} class="color-swatch-input" data-act="color" ${d} value="${color}" title="Color">` : ''}
                ${renderStyleControl(`data-act="style" ${d}`, style, ids.style || '', category)}
                ${renderEyeButton(ids.vis || '', visible, '', `data-act="vis" ${d}`, visTitle)}
            </div>
        </div>
    `;
}

const atomsText = (n) => `${Number(n).toLocaleString()} atoms`;

const PRESET_CHIPS = [
    [':A and 10-50'],
    ['protein and not backbone', 'sidechains'],
    ['PHE or TYR or TRP', 'aromatic'],
    ['helix'],
    ['sheet'],
    ['resname ATP'],
    ['backbone']
];

const ENTITY_GROUPS = [
    ...POLYMER_GROUPS.map(g => ({
        key: g.key,
        subKey: 'chains',
        label: g.label,
        cls: 'font-bold',
        childCls: '',
        styleType: g.styleType,
        defaultStyle: 'cartoon',
        getSele: () => g.focusGroupSele,
        title: g.titleFocus,
        visTitle: (vis) => `${vis ? 'Hide' : 'Show'} all ${g.titleFocus} chains`,
        ids: { style: `${g.key}-style-select`, vis: `${g.key}-vis-toggle` },
        formatGroupSub: (items, totalAtoms) => {
            const res = Object.values(items).reduce((a, c) => a + (c?.resCount || 0), 0);
            return `(${res.toLocaleString()} ${g.unitLabel}, ${atomsText(totalAtoms)})`;
        },
        childLabel: (c, id) => `${g.titlePrefix}Chain ${id}`,
        formatSub: (c) => `(${(c.resCount || 0).toLocaleString()} ${g.unitLabel}, ${atomsText(c.atomCount || 0)})`,
        childSele: (c, id) => g.focusChainSele(id),
        childTitle: (c, id) => `${g.titlePrefix}Chain ${id}`,
        childColor: (c) => c.customColor || g.defaultColor
    })),
    {
        key: 'ligands',
        subKey: 'items',
        label: '💊 Ligands & Cofactors',
        cls: 'font-bold',
        childCls: 'text-[11px]',
        styleType: 'ligand',
        defaultStyle: 'ball+stick',
        getSele: () => 'hetero and not (water or ion or lipid or saccharide)',
        title: 'Ligands',
        visTitle: (vis) => vis ? 'Hide all ligands' : 'Show all ligands',
        ids: { style: 'ligands-style-select', vis: 'ligands-vis-toggle' },
        formatGroupSub: (items, totalAtoms) => `(${atomsText(totalAtoms)})`,
        childLabel: (l, id) => l.resname || id,
        formatSub: (l) => {
            const molStr = (l.count || 0) > 1 ? `${l.count} molecules, ` : '';
            return `(${molStr}${atomsText(l.atomCount || 0)})`;
        },
        childSele: (l, id) => l.sele || `[${l.resname || id}]`,
        childTitle: (l, id) => l.resname || id,
        childColor: (l) => l.customColor || (l.color && l.color !== 'element' ? l.color : '#f97316')
    },
    {
        key: 'membrane',
        subKey: 'species',
        label: '🧈 Lipid Membrane',
        cls: 'font-bold',
        childCls: 'text-[11px]',
        styleType: 'membrane',
        defaultStyle: 'licorice',
        getSele: (keys) => keys.map(k => `[${k}]`).join(' or '),
        title: 'Lipids',
        visTitle: (vis) => vis ? 'Hide all lipids' : 'Show all lipids',
        ids: { style: 'membrane-style-select', vis: 'membrane-vis-toggle' },
        formatGroupSub: (items, totalAtoms) => {
            const mol = Object.values(items).reduce((a, l) => a + (l?.count || 0), 0);
            return `(${mol.toLocaleString()} lipids, ${atomsText(totalAtoms)})`;
        },
        childLabel: (l, id) => (l.label && l.count === undefined) ? l.label : id,
        formatSub: (l) => (l.label && l.count === undefined) ? '' : `(${(l.count || 0).toLocaleString()} lipids, ${atomsText(l.atomCount || 0)})`,
        childSele: (l, id) => l.sele || `[${id}]`,
        childTitle: (l, id) => id,
        childColor: (l, id, idx) => l.customColor || (l.color && l.color !== 'element' ? l.color : getLipidDefaultColor(idx))
    }
];

function buildTreeHTML(cfg) {
    if (!cfg) return '';
    const isSolventOrIonsVisible = Boolean(cfg.water?.visible || cfg.ions?.visible);
    let html = `
        <div class="flex gap-1.5 mb-2">
            <button id="btn-open-add-custom" class="btn-panel-primary">
                <svg class="size-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><use href="#icon-plus"/></svg>
                Add Selection
            </button>
            <button id="btn-toggle-solvent-all" class="btn-panel-secondary" title="${isSolventOrIonsVisible ? 'Hide Water & Ions' : 'Make all objects and solvent visible'}">
                ${isSolventOrIonsVisible ? '👁️ Hide Solvent/Ions' : '↺ Show All'}
            </button>
        </div>

        <div id="card-add-custom" class="hidden flex-col gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2.5">
            <div class="flex justify-between items-center">
                <span class="text-[11px] font-extrabold text-blue-800 uppercase">⭐ Create Custom Selection Object</span>
                <button id="btn-cancel-add-custom" class="text-xs font-bold text-slate-500 cursor-pointer">✕</button>
            </div>
            <div class="flex gap-1.5 items-center justify-between bg-white border border-blue-100 rounded-md px-2 py-1.5">
                <div class="flex flex-col gap-0.5">
                    <label class="form-label-xs">Style</label>
                    <select id="select-custom-style" class="text-slate-700">${renderStyleOptions("cartoon", "custom")}</select>
                </div>
                <div class="flex flex-col gap-0.5 items-center">
                    <label class="form-label-xs">Color</label>
                    <input type="color" id="picker-custom-color" value="#3b82f6" class="color-swatch-input">
                </div>
                <div class="flex flex-col gap-0.5 flex-1 ml-1">
                    <div class="flex justify-between form-label-xs"><span>Opacity</span><span id="label-custom-opacity">100%</span></div>
                    <input type="range" id="slider-custom-opacity" min="0.1" max="1.0" step="0.05" value="1.0" class="w-full">
                </div>
            </div>
            <div class="flex flex-col gap-[3px]">
                <label class="form-label-xs">Label / Object Name</label>
                <input type="text" id="input-custom-label" placeholder="e.g. Cas9 Catalytic Dyad, sgRNA Seed">
            </div>
            <div class="flex flex-col gap-[3px]">
                <label class="form-label-xs">Selection Query (NGL Syntax)</label>
                <input type="text" id="input-custom-sele" placeholder="e.g. :A and 10-50, .CA, [ATP]" class="font-mono">
                <div id="badge-custom-matches" class="text-[10px] font-mono font-bold text-sky-600">0 atoms matched</div>
            </div>
            <div class="bg-white border border-blue-100 rounded-md px-2 py-1.5 flex flex-col gap-1">
                <span class="text-[10px] font-bold text-slate-600">Quick Syntax Presets:</span>
                <div class="flex flex-wrap gap-1">
                    ${PRESET_CHIPS.map(([sele, label]) => `<button type="button" class="preset-chip" data-sele="${escapeHtml(sele)}">${escapeHtml(label || sele)}</button>`).join('')}
                </div>
            </div>
            <div class="flex gap-1.5 mt-0.5">
                <button id="btn-confirm-add-custom" class="flex-1 rounded-md bg-blue-700 p-1.5 text-[11px] font-bold text-white cursor-pointer">Add to Scene</button>
                <button id="btn-cancel-add-custom-2" class="rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">Cancel</button>
            </div>
        </div>
    `;

    // Custom selection objects
    if (cfg.customSelections?.length > 0) {
        html += `
            <div class="bg-purple-50 border border-purple-200 rounded-lg p-2 mb-2 flex flex-col gap-1.5">
                <div class="text-[11px] font-extrabold text-purple-700 uppercase">⭐ Custom Selection Objects</div>
                <div class="flex flex-col gap-1.5">`;
        cfg.customSelections.forEach(c => {
            const d = `data-target="custom" data-id="${escapeHtml(c.id)}"`;
            const op = c.opacity !== undefined ? c.opacity : 1.0;
            const labelText = escapeHtml(c.label || c.sele);
            const seleText = escapeHtml(c.sele);
            html += `
                <div class="pymol-row tree-sub-row">
                    <div class="flex flex-col overflow-hidden mr-1.5 flex-1">
                        <span class="focus-label cursor-pointer font-bold text-purple-800 text-[11px] truncate" data-sele="${seleText}" title="Click to Focus">${labelText}</span>
                        <span class="text-[9px] font-mono text-slate-400 truncate">${seleText}</span>
                    </div>
                    <div class="pymol-controls">
                        <input type="color" class="color-swatch-input" data-act="color" ${d} value="${c.color || '#3b82f6'}" title="Color">
                        ${renderStyleControl(`data-act="style" ${d}`, c.style || "cartoon", '', 'custom')}
                        <input type="range" class="w-[34px]" data-act="opacity" ${d} min="0.1" max="1.0" step="0.05" value="${op}" title="Opacity (${Math.round(op * 100)}%)">
                        ${renderEyeButton('', c.visible !== false, '', `data-act="vis" ${d}`)}
                        <button class="tree-del-btn" data-act="del" ${d} title="Remove Selection Object">✕</button>
                    </div>
                </div>`;
        });
        html += `</div></div>`;
    }

    // Unified Entity Groups: Proteins, RNA, DNA, Ligands, Membrane
    ENTITY_GROUPS.forEach(g => {
        const grp = cfg[g.key];
        const items = grp?.[g.subKey];
        const keys = items ? Object.keys(items) : [];
        if (keys.length === 0) return;

        const totalAtoms = Object.values(items).reduce((a, c) => a + (c?.atomCount || 0), 0);
        const vis = Boolean(grp.visible);

        html += renderRow({
            t: { target: g.key }, cls: g.cls, label: g.label,
            sub: g.formatGroupSub(items, totalAtoms),
            sele: g.getSele(keys), title: g.title,
            style: grp.style || items[keys[0]]?.style || g.defaultStyle, category: g.styleType,
            visible: vis, visTitle: g.visTitle(vis), ids: g.ids
        }) + `<div class="tree-indent">`;

        keys.forEach((id, idx) => {
            const item = items[id];
            html += renderRow({
                t: { target: g.key, id }, cls: g.childCls, label: g.childLabel(item, id),
                sub: g.formatSub(item, id), sele: g.childSele(item, id), title: g.childTitle(item, id),
                color: g.childColor(item, id, idx), style: item.style || g.defaultStyle,
                category: g.styleType, visible: Boolean(item.visible)
            });
        });
        html += `</div>`;
    });

    // Simple categories: Glycans, Ions, Water
    const sac = cfg.saccharides;
    if (sac && (sac.species && Object.keys(sac.species).length > 0 || sac.present || sac.atomCount > 0)) {
        html += renderRow({
            t: { target: 'saccharides' }, cls: 'font-bold', label: '🍬 Glycans / Saccharides',
            sub: `(${atomsText(sac.atomCount || 0)})`, sele: sac.sele || 'saccharide', title: 'Glycans',
            color: sac.color && sac.color !== 'element' ? sac.color : '#a855f7', style: sac.style || "hyperball",
            category: 'saccharide', visible: Boolean(sac.visible),
            ids: { color: 'saccharide-color-picker', style: 'saccharide-style-select', vis: 'saccharide-toggle' }
        });
    }
    const ions = cfg.ions;
    if (ions && (ions.present || ions.count > 0)) {
        html += renderRow({
            t: { target: 'ions' }, cls: 'font-bold', label: '🧪 Ions',
            sub: `(${(ions.count || 0).toLocaleString()} ions, ${atomsText(ions.atomCount || 0)})`,
            sele: ions.sele || 'ion', title: 'Ions', color: ions.color || '#eab308', style: ions.style || "spacefill",
            category: 'ion', visible: Boolean(ions.visible),
            ids: { color: 'ion-color-picker', style: 'ion-style-select', vis: 'ion-toggle' }
        });
    }
    const water = cfg.water;
    if (water && (water.present || water.count > 0)) {
        html += renderRow({
            t: { target: 'water' }, cls: 'font-bold', label: '💧 Solvent (Water)',
            sub: `(${(water.count || 0).toLocaleString()} molecules, ${atomsText(water.atomCount || 0)})`,
            sele: water.sele || 'water', title: 'Water', color: water.color || '#06b6d4', style: water.style || "line",
            category: 'water', visible: Boolean(water.visible),
            ids: { color: 'water-color-picker', style: 'water-style-select', vis: 'water-toggle' }
        });
    }
    return html;
}

function resolveTarget(el, cfg) {
    const { target, id } = el.dataset;
    if (target === 'custom') {
        const idx = (cfg.customSelections || []).findIndex(c => c.id === id);
        return { custom: true, index: idx, item: cfg.customSelections?.[idx] };
    }
    const grp = cfg[target];
    if (!grp) return null;
    const subKey = SUB_KEYS[target];
    if (id === undefined) return { grp, subKey, item: grp, isGroup: true };
    return { grp, subKey, item: grp[subKey]?.[id] };
}

function syncStyleBadge(el) {
    const parent = el.closest?.('.style-select-container');
    if (!parent) return;
    const label = `Style: ${getStyleLabel(el.value)}`;
    const badge = parent.querySelector('.style-badge-label');
    if (badge) badge.textContent = getStyleShortCode(el.value);
    parent.title = label;
    el.title = label;
}

function updateEyeButton(btn, isVis) {
    if (!btn || !btn.classList) return;
    if (typeof btn.classList.toggle === 'function') {
        btn.classList.toggle('active', isVis);
    }
    const useEl = typeof btn.querySelector === 'function' ? btn.querySelector('use') : null;
    if (useEl && typeof useEl.setAttribute === 'function') {
        useEl.setAttribute('href', isVis ? '#icon-eye-open' : '#icon-eye-closed');
    }
    btn.title = isVis ? 'Hide' : 'Show';
}

function updateSolventButtonText(container, cfg) {
    if (!container || typeof container.querySelector !== 'function' || !cfg) return;
    const btn = container.querySelector('#btn-toggle-solvent-all');
    if (!btn) return;
    const isSolventOrIonsVisible = Boolean(cfg.water?.visible || cfg.ions?.visible);
    btn.innerText = isSolventOrIonsVisible ? '👁️ Hide Solvent/Ions' : '↺ Show All';
    btn.title = isSolventOrIonsVisible ? 'Hide Water & Ions' : 'Make all objects and solvent visible';
}

export function initDisplayTreePanel({ engine, listen, container: customContainer }) {
    const container = customContainer || (typeof document !== 'undefined' ? document.getElementById('tree-container') : null);
    if (!container) return;

    let displayConfig = engine.getDisplayConfig?.() || null;
    const $ = (id) => container.querySelector(`#${id}`);

    const setCardOpen = (open) => {
        const card = $('card-add-custom');
        if (!card) return;
        card.classList.toggle('hidden', !open);
        card.classList.toggle('flex', open);
    };

    const updateMatchBadge = (query) => {
        const badge = $('badge-custom-matches');
        if (!badge) return;
        const q = query ? query.trim() : '';
        let text = '0 atoms matched', color = '#64748b';
        if (q) {
            let count = 0;
            if (typeof engine.getSelectionAtomCount === 'function') {
                count = engine.getSelectionAtomCount(q);
            }
            if (count < 0) {
                text = 'Syntax error in selection';
                color = '#e11d48';
            } else {
                text = `${count} atoms matched`;
                color = count > 0 ? '#0284c7' : '#e11d48';
            }
        }
        badge.innerText = text;
        badge.style.color = color;
    };

    const confirmAddCustom = () => {
        const seleQuery = $('input-custom-sele')?.value?.trim() || '';
        if (!seleQuery) {
            const badge = $('badge-custom-matches');
            if (badge) { badge.innerText = 'Please enter a selection query'; badge.style.color = '#e11d48'; }
            return;
        }
        const cfg = displayConfig || engine.getDisplayConfig?.() || {};
        const sliderOp = $('slider-custom-opacity');
        const newCustom = {
            id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            label: $('input-custom-label')?.value?.trim() || seleQuery,
            sele: seleQuery,
            style: $('select-custom-style')?.value || 'cartoon',
            color: $('picker-custom-color')?.value || '#3b82f6',
            opacity: sliderOp ? parseFloat(sliderOp.value) : 1.0,
            visible: true
        };

        const updated = [...(cfg.customSelections || []), newCustom];
        cfg.customSelections = updated;

        engine.updateDisplay(['customSelections'], updated);
        container.innerHTML = buildTreeHTML(cfg);
    };

    const toggleSolventOrShowAll = () => {
        const cfg = displayConfig || engine.getDisplayConfig?.() || {};
        if (cfg.water?.visible || cfg.ions?.visible) {
            if (cfg.water) cfg.water.visible = false;
            if (cfg.ions) cfg.ions.visible = false;
            engine.updateDisplay([], cfg);
        } else {
            Object.entries(SUB_KEYS).forEach(([key, subKey]) => {
                const grp = cfg[key];
                if (!grp) return;
                grp.visible = true;
                if (grp[subKey]) Object.values(grp[subKey]).forEach(i => { if (i) i.visible = true; });
            });
            ['saccharides', 'ions', 'water'].forEach(k => { 
                if (cfg[k]) {
                    cfg[k].visible = true;
                }
            });
            cfg.customSelections?.forEach(c => { 
                if (c) c.visible = true;
            });
            engine.updateDisplay([], cfg);
        }
        container.innerHTML = buildTreeHTML(cfg);
    };

    const render = (cfg) => {
        displayConfig = cfg || engine.getDisplayConfig?.() || null;
        if (!displayConfig) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = buildTreeHTML(displayConfig);
    };

    // ---- Event delegation: focus, presets, add card, visibility, delete, inputs, style ----
    listen(container, 'click', (e) => {
        const t = e.target;
        const focus = t.closest('.focus-label');
        if (focus) {
            const sele = focus.dataset.sele || 'all';
            engine.focusSelection(sele, 500);
            return;
        }

        const chip = t.closest('.preset-chip');
        if (chip) {
            const sele = chip.getAttribute('data-sele');
            const input = $('input-custom-sele');
            if (input && sele) { input.value = sele; updateMatchBadge(sele); }
            return;
        }

        const btn = t.closest('button[id]');
        if (btn) {
            if (btn.id === 'btn-open-add-custom') return setCardOpen($('card-add-custom')?.classList.contains('hidden'));
            if (btn.id === 'btn-cancel-add-custom' || btn.id === 'btn-cancel-add-custom-2') return setCardOpen(false);
            if (btn.id === 'btn-confirm-add-custom') return confirmAddCustom();
            if (btn.id === 'btn-toggle-solvent-all') return toggleSolventOrShowAll();
        }

        const actEl = t.closest('[data-act]');
        const act = actEl?.dataset.act;
        if (act !== 'vis' && act !== 'del') return;

        const cfg = displayConfig || engine.getDisplayConfig?.() || {};
        if (act === 'del') {
            cfg.customSelections = (cfg.customSelections || []).filter(c => c.id !== actEl.dataset.id);
            engine.updateDisplay(['customSelections'], cfg.customSelections);
            container.innerHTML = buildTreeHTML(cfg);
            return;
        }

        // Visibility toggle: update in-place
        const r = resolveTarget(actEl, cfg);
        if (!r?.item) return;

        const { target, id } = actEl.dataset;
        if (r.custom) {
            const newVis = r.item.visible === false;
            r.item.visible = newVis;
            updateEyeButton(actEl, newVis);
            engine.updateDisplay(['customSelections', r.index], { visible: newVis });
        } else if (r.isGroup) {
            const newVis = !r.item.visible;
            r.item.visible = newVis;
            updateEyeButton(actEl, newVis);
            if (r.subKey && r.grp[r.subKey]) {
                Object.values(r.grp[r.subKey]).forEach(i => { if (i) i.visible = newVis; });
                const row = typeof actEl.closest === 'function' ? actEl.closest('.pymol-row') : null;
                const indent = row?.nextElementSibling?.classList?.contains?.('tree-indent') ? row.nextElementSibling : null;
                if (indent && typeof indent.querySelectorAll === 'function') {
                    indent.querySelectorAll('[data-act="vis"]').forEach(childBtn => updateEyeButton(childBtn, newVis));
                }
            }
            engine.updateDisplay([target], { visible: newVis });
        } else {
            const newVis = !r.item.visible;
            r.item.visible = newVis;
            updateEyeButton(actEl, newVis);
            const parentVis = Object.values(r.grp[r.subKey]).some(i => i && i.visible);
            r.grp.visible = parentVis;
            const groupEye = typeof container?.querySelector === 'function' 
                ? container.querySelector(`[data-target="${target}"][data-act="vis"]:not([data-id])`)
                : null;
            if (groupEye) updateEyeButton(groupEye, parentVis);

            engine.updateDisplay([target, r.subKey, id], { visible: newVis });
        }
        updateSolventButtonText(container, cfg);
    });

    listen(container, 'input', (e) => {
        const el = e.target;
        if (el.id === 'input-custom-sele') return updateMatchBadge(el.value);
        if (el.id === 'slider-custom-opacity') {
            const label = $('label-custom-opacity');
            if (label) label.innerText = `${Math.round(parseFloat(el.value) * 100)}%`;
            return;
        }
        const act = el.dataset.act;
        if (act !== 'color' && act !== 'opacity') return;

        const cfg = displayConfig || engine.getDisplayConfig?.() || {};
        const r = resolveTarget(el, cfg);
        if (!r?.item) return;

        const { target, id } = el.dataset;
        if (act === 'opacity') {
            const val = parseFloat(el.value);
            r.item.opacity = val;
            el.title = `Opacity (${Math.round(val * 100)}%)`;
            if (r.custom) {
                engine.updateDisplay(['customSelections', r.index], { opacity: val });
            }
        } else if (r.custom) {
            r.item.color = el.value;
            engine.updateDisplay(['customSelections', r.index], { color: el.value });
        } else if (r.isGroup) {
            r.item.color = el.value;
            engine.updateDisplay([target], { color: el.value });
        } else {
            r.item.customColor = el.value;
            if (r.subKey !== 'chains') r.item.color = el.value;
            engine.updateDisplay([target, r.subKey, id], { customColor: el.value });
        }
    });

    listen(container, 'change', (e) => {
        const el = e.target;
        if (el.id === 'select-custom-style') {
            syncStyleBadge(el);
            return;
        }
        if (el.dataset.act !== 'style') return;
        syncStyleBadge(el);

        const cfg = displayConfig || engine.getDisplayConfig?.() || {};
        const r = resolveTarget(el, cfg);
        if (!r?.item) return;

        const { target, id } = el.dataset;
        r.item.style = el.value;

        const cascades = r.isGroup && r.subKey && r.grp[r.subKey];
        if (cascades) {
            Object.values(r.grp[r.subKey]).forEach(i => { if (i) i.style = el.value; });
            const row = el.closest('.pymol-row');
            const indent = row?.nextElementSibling?.classList.contains('tree-indent') ? row.nextElementSibling : null;
            if (indent) {
                indent.querySelectorAll('select[data-act="style"]').forEach(childSelect => {
                    childSelect.value = el.value;
                    syncStyleBadge(childSelect);
                });
            }
        }

        if (r.custom) {
            engine.updateDisplay(['customSelections', r.index], { style: el.value });
        } else if (r.isGroup) {
            engine.updateDisplay([target], { style: el.value });
        } else {
            engine.updateDisplay([target, r.subKey, id], { style: el.value });
        }
    });

    listen(engine, EVENTS.TOPOLOGY_LOADED, () => {
        render();
    });

    listen(engine, EVENTS.TOPOLOGY_CLEARED, () => {
        container.innerHTML = '';
        displayConfig = null;
    });

    listen(engine, EVENTS.SESSION_RESTORED, () => {
        render();
    });

    listen(engine, EVENTS.DISPLAY_CONFIG_CHANGED, (e) => {
        const path = e.detail?.path;
        if (!path || path.length === 0 || e.detail?.structural) {
            render(e.detail?.config);
        } else {
            displayConfig = e.detail?.config || engine.getDisplayConfig?.() || null;
        }
    });

    if (engine.hasStructure || engine.getDisplayConfig?.()) {
        render();
    }
}
