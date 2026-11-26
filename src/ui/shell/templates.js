// src/ui/shell/templates.js
// Single Task: Centralized Dynamic UI Template Generators

import { refreshIcons } from './icons.js';

export const PILLS = [
    {
        id: 'speed',
        icon: 'gauge',
        label: 'Speed',
        defaultText: '1×',
        title: 'Playback Speed',
        selectId: 'speed-select',
        labelId: 'speed-label',
        options: [
            { value: '1', label: 'Speed: 1×', selected: true },
            { value: '0.25', label: 'Speed: 0.25×' },
            { value: '0.5', label: 'Speed: 0.5×' },
            { value: '2', label: 'Speed: 2×' },
            { value: '5', label: 'Speed: 5×' }
        ]
    },
    {
        id: 'loop',
        icon: 'repeat',
        label: 'Loop',
        defaultText: 'Off',
        title: 'Loop Mode',
        selectId: 'loop-mode-select',
        labelId: 'loop-mode-label',
        extraLabelClasses: 'truncate max-w-[80px]',
        options: [
            { value: 'off', label: 'Loop: Off', selected: true },
            { value: 'full', label: 'Loop: All' },
            { value: 'set-a', label: 'Set Start [A]' },
            { value: 'set-b', label: 'Set End [B]' },
            { value: 'clear', label: 'Clear A/B' }
        ]
    },
    {
        id: 'direction',
        icon: 'play',
        label: 'Playback',
        defaultText: 'F',
        title: 'Playback Direction',
        selectId: 'direction-select',
        labelId: 'direction-mode-label',
        options: [
            { value: 'forward', label: 'Forward', selected: true },
            { value: 'backward', label: 'Reverse' },
            { value: 'bounce', label: 'Bounce' }
        ]
    },
    {
        id: 'mouse',
        icon: 'mouse-pointer',
        label: 'Mouse',
        defaultText: 'WebGL',
        title: 'Mouse Navigation Scheme',
        selectId: 'mouse-scheme-select',
        labelId: 'mouse-scheme-label',
        options: [
            { value: 'default', label: 'WebGL', selected: true },
            { value: 'pymol', label: 'PyMOL' },
            { value: 'coot', label: 'Coot' }
        ]
    },
    {
        id: 'bg',
        icon: 'palette',
        label: 'BG',
        defaultText: 'White',
        title: 'Background Color',
        selectId: 'export-bg-select',
        labelId: 'bg-color-label',
        options: [
            { value: 'white', label: 'White', selected: true },
            { value: 'black', label: 'Black' }
        ]
    }
];

export const PRESETS = [
    ['🥩 Protein', [
        ['ca', 'Cα', 'protein and .CA', 'protein and .CA', true],
        ['backbone', 'Backbone', 'backbone and not hydrogen', 'backbone and not hydrogen', true],
        ['heavy', 'All Heavy', 'protein and not hydrogen', 'protein and not hydrogen', true],
        ['sidechains', 'Sidechains', 'backbone and not hydrogen', 'protein and not backbone and not hydrogen', false]
    ]],
    ['💊 Drug Discovery', [
        ['ligand', 'Ligand in Pocket', 'protein and .CA', 'hetero and not (water or ion or hydrogen)', false],
        ['lig-internal', 'Ligand Internal', 'hetero and not (water or ion or hydrogen)', 'hetero and not (water or ion or hydrogen)', true],
        ['pocket', 'Binding Site (5Å)', 'protein and .CA', 'byres (hetero around 5.0) and protein and not hydrogen', false]
    ]],
    ['🧬 Nucleic Acids', [
        ['rna', 'Phosphate (P)', 'nucleic and .P', 'nucleic and .P', true],
        ['nuc-backbone', 'Backbone', 'nucleic and backbone and not hydrogen', 'nucleic and backbone and not hydrogen', true],
        ['nuc-bases', 'Bases', 'nucleic and .P', 'nucleic and not backbone and not hydrogen', false]
    ]],
    ['🧈 Membrane', [
        ['tm', 'TM Helices', 'helix and protein and .CA', 'helix and protein and .CA', true],
        ['lipid', 'Lipid Bilayer (P)', 'lipid and .P', 'lipid and .P', true]
    ]]
];

export const ZENODO = [
    [21475591, '1. Chalcone Protein–Drug Complex', 'All-atom GROMACS MD trajectory of a chalcone derivative complex (37,006 atoms, 10,001 frames; E. W. de Alencar Pereira, 2026).', ['solv_ions_EM1.gro', '1.7 MB'], ['md_rep1_noPBC_em1.xtc', '1.3 GB']],
    [5111905, '2. SARS-CoV-2 RBD–Fab Complex (7NX6)', 'All-atom MD simulation of the SARS-CoV-2 P.1 variant RBD–Fab complex (222,853 atoms, 110 frames; Oliveira et al., 2021).', ['traj_7nx6.gro', '15.4 MB'], ['traj_7nx6.xtc', '834.0 MB']],
    [13984201, '3. POPE/TOCL Lipid Bilayer Mixture', 'All-atom GROMACS trajectory of a POPE/TOCL lipid membrane bilayer (58,500 atoms, 26,501 frames; M. Doktorova, 2023).', ['PE_CL_Run.gro', '4.0 MB'], ['PE_CL_530Run.xtc', '5.8 GB']]
];

export const TABS = [
    { id: 'tree', label: 'Components', miniLabel: 'Components', title: 'Molecular Components & Shapes', icon: 'box', active: true },
    { id: 'annotation', label: 'Measurements', miniLabel: 'Measure', title: 'Distance, Angle, & Dihedral Measurements', icon: 'ruler', active: false },
    { id: 'rmsd', label: 'RMSD', miniLabel: 'RMSD', title: 'Trajectory RMSD Analysis', icon: 'trending-up', active: false }
];

export function renderPlayerPills(container) {
    if (!container) return;
    container.innerHTML = PILLS.map(p => `
        <div class="control-pill" title="${p.title}">
            <i data-lucide="${p.icon}" class="w-3.5 h-3.5 text-slate-500 shrink-0"></i>
            <span class="text-slate-500 font-bold text-[11px] select-none">${p.label}:</span>
            <span id="${p.labelId}" class="text-slate-800 font-bold text-[11px] select-none ${p.extraLabelClasses || ''}">${p.defaultText}</span>
            <select id="${p.selectId}" class="invisible-select-overlay" title="${p.title}">
                ${p.options.map(opt => `<option value="${opt.value}" ${opt.selected ? 'selected' : ''}>${opt.label}</option>`).join('')}
            </select>
        </div>`).join('');
}

export function renderRmsdPresets(container) {
    if (!container) return;
    container.innerHTML = PRESETS.map(([title, chips]) => `
        <div class="flex flex-col gap-0.5">
            <span class="text-[9px] font-extrabold text-slate-700 uppercase">${title}</span>
            <div class="flex flex-wrap gap-1">${chips.map(([id, label, fit, calc, same]) =>
                `<button type="button" class="preset-chip" id="preset-rmsd-${id}" data-fit="${fit}" data-calc="${calc}" data-same="${same}">${label}</button>`
            ).join('')}</div>
        </div>`).join('');
}

export function renderZenodoCards(container) {
    if (!container) return;
    const fileBtn = (id, [name, size], icon, color) => `
        <a href="https://zenodo.org/records/${id}/files/${name}?download=1" target="_blank" download="${name}" class="flex-1 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-slate-700 hover:text-blue-600 rounded-lg py-1.5 px-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 transition shadow-2xs">
            <i data-lucide="${icon}" class="w-3 h-3 ${color}"></i><span>${name}</span>
            <span class="text-[9px] font-mono text-slate-400 font-normal">${size}</span></a>`;

    container.innerHTML = ZENODO.map(([id, title, desc, gro, xtc]) => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 hover:border-blue-300 transition">
            <div class="flex items-start justify-between gap-2">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-slate-900">${title}</span>
                        <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">#${id}</span>
                    </div>
                    <p class="text-[11px] text-slate-600 mt-0.5 leading-snug">${desc}</p>
                </div>
                <a href="https://zenodo.org/records/${id}" target="_blank" rel="noopener noreferrer" class="text-slate-400 hover:text-blue-600 p-1" title="View Zenodo Record #${id}"><i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>
            </div>
            <div class="flex items-center gap-2 pt-1 border-t border-slate-200/60">
                ${fileBtn(id, gro, 'file-box', 'text-blue-500')}${fileBtn(id, xtc, 'database', 'text-indigo-500')}
            </div>
        </div>`).join('');
}

export function renderTabs(miniContainer, drawerContainer) {
    if (miniContainer) {
        miniContainer.innerHTML = TABS.map(tab => `
            <button id="btn-mini-tab-${tab.id}" class="mini-btn ${tab.active ? 'active' : ''}" data-mini-tab="${tab.id}" title="${tab.title}" aria-label="${tab.title}">
                <i data-lucide="${tab.icon}" class="w-4.5 h-4.5"></i>
                <span class="mini-btn-label">${tab.miniLabel}</span>
            </button>`).join('');
    }
    if (drawerContainer) {
        drawerContainer.innerHTML = TABS.map(tab => `
            <button class="drawer-tab-btn ${tab.active ? 'active' : ''}" data-tab="${tab.id}" id="tab-btn-${tab.id}" role="tab" aria-selected="${tab.active}" aria-controls="tab-panel-${tab.id}" tabindex="${tab.active ? '0' : '-1'}">${tab.label}</button>`).join('');
    }
}

export function initTemplates() {
    renderPlayerPills(document.getElementById('player-pills-container'));
    renderRmsdPresets(document.getElementById('rmsd-presets-container'));
    renderZenodoCards(document.getElementById('zenodo-cards-container'));
    renderTabs(
        document.getElementById('mini-bar-tabs-container'),
        document.getElementById('drawer-tabs-container')
    );
    refreshIcons();
}
