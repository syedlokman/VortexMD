// src/engine/display-config.js
// Single Task: Default Display Config Schema & Factory

export function createDefaultDisplayConfig() {
    return {
        showPbcBox: false,
        pbcColor: "#64748b",
        proteins: { visible: true, style: "cartoon", chains: {} },
        rna: { visible: true, style: "cartoon", chains: {} },
        dna: { visible: true, style: "cartoon", chains: {} },
        ligands: { visible: true, style: "ball+stick", items: {} },
        membrane: { visible: true, style: "licorice", species: {}, color: "element", opacity: 0.85, radius: 0.15 },
        saccharides: { visible: true, style: "hyperball", color: "element" },
        ions: { visible: true, style: "spacefill", color: "#eab308" },
        water: { visible: false, style: "line", color: "#06b6d4" },
        customSelections: []
    };
}
