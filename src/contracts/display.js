/**
 * src/contracts/display.js
 * Single source of truth for display representation styles and polymer definitions.
 * Zero imports.
 */

export const STYLE_OPTIONS = Object.freeze([
    { value: "cartoon", short: "Ca", label: "Cartoon" },
    { value: "licorice", short: "Li", label: "Licorice" },
    { value: "surface", short: "Su", label: "Surface" },
    { value: "ball+stick", short: "BS", label: "Ball & Stick" },
    { value: "spacefill", short: "Sp", label: "Spacefill" },
    { value: "hyperball", short: "Hy", label: "Hyperball" },
    { value: "head-ball-tail-stick", short: "HT", label: "Head-Ball & Tail-Stick" },
    { value: "ribbon", short: "Rb", label: "Ribbon" },
    { value: "tube", short: "Tu", label: "Tube" },
    { value: "rope", short: "Rp", label: "Rope" },
    { value: "rocket", short: "Rk", label: "Rocket" },
    { value: "base", short: "Ba", label: "Base" },
    { value: "line", short: "Ln", label: "Wireframe" },
    { value: "point", short: "Pt", label: "Points" },
    { value: "backbone", short: "Bb", label: "Backbone" },
    { value: "trace", short: "Tr", label: "Trace" }
]);

export const POLYMER_GROUPS = Object.freeze([
    { key: 'proteins', label: '🥩 Proteins', unitLabel: 'res', focusGroupSele: 'protein and not (water or ion)',
      focusChainSele: (c) => `(:${c}) and (protein or polymer)`, styleType: 'protein', defaultColor: '#3b82f6',
      titlePrefix: '', titleFocus: 'Proteins' },
    { key: 'rna', label: '🧬 Nucleic Acids: RNA', unitLabel: 'nt', focusGroupSele: 'rna and not (water or ion)',
      focusChainSele: (c) => `(:${c}) and (rna or nucleic)`, styleType: 'nucleic', defaultColor: '#10b981',
      titlePrefix: 'RNA ', titleFocus: 'RNA' },
    { key: 'dna', label: '🧬 Nucleic Acids: DNA', unitLabel: 'nt', focusGroupSele: 'dna and not (water or ion)',
      focusChainSele: (c) => `(:${c}) and (dna or nucleic)`, styleType: 'nucleic', defaultColor: '#f59e0b',
      titlePrefix: 'DNA ', titleFocus: 'DNA' }
]);

export const ENTITY_STYLES = Object.freeze({
    protein: Object.freeze(["cartoon", "licorice", "surface", "ribbon", "spacefill", "backbone", "rocket"]),
    nucleic: Object.freeze(["cartoon", "base", "licorice", "surface", "spacefill", "ribbon"]),
    ligand: Object.freeze(["ball+stick", "licorice", "spacefill", "surface"]),
    membrane: Object.freeze(["licorice", "head-ball-tail-stick", "hyperball", "spacefill", "ball+stick", "surface"]),
    saccharide: Object.freeze(["hyperball", "ball+stick", "licorice", "spacefill"]),
    ion: Object.freeze(["spacefill", "ball+stick", "point"]),
    water: Object.freeze(["line", "licorice", "spacefill"]),
    custom: null
});

export const DEFAULT_CHAIN_PALETTE = Object.freeze([
    "#3b82f6", // Blue (Chain 1 / A)
    "#10b981", // Emerald (Chain 2 / B)
    "#f59e0b", // Amber (Chain 3 / C)
    "#ec4899", // Pink (Chain 4 / D)
    "#8b5cf6", // Purple (Chain 5 / E)
    "#06b6d4", // Cyan (Chain 6 / F)
    "#f97316", // Orange (Chain 7 / G)
    "#14b8a6", // Teal (Chain 8 / H)
    "#a855f7", // Violet (Chain 9 / I)
    "#e11d48", // Rose (Chain 10 / J)
    "#84cc16", // Lime (Chain 11 / K)
    "#6366f1"  // Indigo (Chain 12 / L)
]);

export function getChainDefaultColor(index = 0) {
    return DEFAULT_CHAIN_PALETTE[index % DEFAULT_CHAIN_PALETTE.length];
}

export const DEFAULT_LIPID_PALETTE = Object.freeze([
    "#10b981", // Emerald (Lipid Species 1: e.g. POPC/POPE)
    "#14b8a6", // Teal (Lipid Species 2: e.g. POPG)
    "#f97316", // Orange (Lipid Species 3: e.g. CHOL)
    "#a855f7", // Purple (Lipid Species 4: e.g. TOCL/Cardiolipin)
    "#3b82f6", // Blue (Lipid Species 5: e.g. DPSM)
    "#ec4899", // Pink (Lipid Species 6: e.g. POPS)
    "#eab308", // Golden Yellow (Lipid Species 7: e.g. PIP2)
    "#06b6d4", // Cyan (Lipid Species 8: e.g. DMPC)
    "#f43f5e", // Rose (Lipid Species 9: e.g. DPPC)
    "#84cc16", // Lime (Lipid Species 10: e.g. DOPE)
    "#6366f1", // Indigo (Lipid Species 11)
    "#d97706"  // Amber (Lipid Species 12)
]);

export function getLipidDefaultColor(index = 0) {
    return DEFAULT_LIPID_PALETTE[index % DEFAULT_LIPID_PALETTE.length];
}

