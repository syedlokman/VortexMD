// src/representations.js
// Single Task: Full Capability Representation Rules, Hyperball/Rocket/Base Specializations, Advanced Colormakers & Validation

import * as NGL from 'ngl';
import { DEFAULT_CHAIN_PALETTE, getChainDefaultColor, DEFAULT_LIPID_PALETTE, getLipidDefaultColor } from '../contracts/display.js';

// STRICT NGL BRACKET SYNTAX & EXPANDED SELECTION KEYWORDS
export const SELE_NON_SOLVENT  = "not (water or ion or [SOL] or [WAT] or [TIP3] or [SPC] or [H2O] or [NA] or [CL])";
export const SELE_MACROMOLECULES = "polymer or protein or nucleic";
export const SELE_WATER          = "water or [SOL] or [WAT] or [TIP3] or [TIP4] or [SPC] or [SPCE] or [H2O]";
export const SELE_ION            = "ion or [CL] or [NA] or [CLA] or [SOD] or [MG] or [K] or [CA] or [ZN] or [CAL]";
export const SELE_LIPID          = "[POPC] or [POPE] or [DPPC] or [DOPC] or [POPG] or [POPS] or [PLPC] or [SOPC] or [CHOL] or [CARD] or [TOCL] or [TOCL1] or [TOCL2] or [TLCL] or [DLPE] or [DMPE] or [DPPE] or [DOPE] or [DMPC] or [DSPC] or [DLPC] or [CHL1] or [CER] or [SM]";
export const SELE_SACCHARIDE     = "saccharide or [NAG] or [MAN] or [BMA] or [FUL] or [GAL] or [GLC] or [SIA] or [SLN] or [FUC]";
export const SELE_LIGAND         = `(ligand or not (${SELE_MACROMOLECULES} or ${SELE_WATER} or ${SELE_ION} or ${SELE_LIPID} or ${SELE_SACCHARIDE})) and not (${SELE_WATER} or ${SELE_ION} or ${SELE_MACROMOLECULES} or ${SELE_LIPID} or ${SELE_SACCHARIDE})`;


const KNOWN_WATERS = [
    "SOL", "WAT", "HOH", "H2O", "TIP", "TIP3", "TIP3P", "TIP4", "TIP4P", "TIP5P", "SPC", "SPCE", "DOD", "W"
];
const KNOWN_IONS        = ["CL", "NA", "CLA", "SOD", "MG", "K", "CA", "ZN", "CAL", "POT", "CL-", "NA+"];
const KNOWN_LIPID_NAMES = new Set([
    "POPC", "POPE", "DPPC", "DOPC", "POPG", "POPS", "PLPC", "SOPC", "CHOL", 
    "CARD", "TOCL", "TOCL1", "TOCL2", "TLCL", "DLPE", "DMPE", "DPPE", "DOPE", 
    "DMPC", "DSPC", "DLPC", "CHL1", "CER", "SM", "DODC", "DOPS", "DOPG", 
    "POPI", "PI", "PIP2", "LPPC", "LPPE"
]);
const KNOWN_SACCHARIDES = ["NAG", "MAN", "BMA", "FUL", "GAL", "GLC", "SIA", "SLN", "FUC", "BGC", "NDG"];

const isLikelyLipid = (name) => {
    if (!name) return false;
    const u = name.toUpperCase();
    return KNOWN_LIPID_NAMES.has(u) || 
           u.startsWith("DPP") || u.startsWith("POP") || u.startsWith("DOP") ||
           u.startsWith("TOCL") || u.startsWith("CARD") || u.startsWith("CHL") || u === "CHOL";
};

export function applyCustomRepresentation(comp, config) {
    if (!comp) return;

    try {
        comp.removeAllRepresentations();

        // PBC Box
        if (config.showPbcBox) {
            comp.addRepresentation("unitcell", {
                colorValue: config.pbcColor || "#64748b",
                radiusSize: 0.08,
                wireframe: true,
                linewidth: 3.0,
                useWideLines: true
            });
        }

        // 1-3. BIOLOGICAL POLYMERS (PROTEINS, RNA, DNA)
        const polymerGroups = [
            { key: 'proteins', macro: 'protein or polymer' },
            { key: 'rna', macro: 'rna or nucleic' },
            { key: 'dna', macro: 'dna or nucleic' }
        ];

        polymerGroups.forEach(({ key, macro }) => {
            const grp = config[key];
            if (grp && grp.visible && grp.chains) {
                Object.entries(grp.chains).forEach(([chainName, chainCfg], idx) => {
                    if (chainCfg && chainCfg.visible) {
                        const hasChain = comp.structure && comp.structure.getAtomIndices
                            ? comp.structure.getAtomIndices(new NGL.Selection(`:${chainName}`)).length > 0
                            : Boolean(chainName && chainName.trim());
                        const sele = hasChain ? `(:${chainName}) and (${macro})` : macro;
                        comp.addRepresentation(chainCfg.style || "cartoon", {
                            sele: sele,
                            color: chainCfg.customColor || getChainDefaultColor(idx)
                        });
                    }
                });
            }
        });

        // 4. INDIVIDUAL LIGANDS & COFACTORS
        if (config.ligands && config.ligands.visible && config.ligands.items) {
            Object.entries(config.ligands.items).forEach(([ligId, ligCfg]) => {
                if (ligCfg && ligCfg.visible) {
                    comp.addRepresentation(ligCfg.style || "ball+stick", {
                        sele: ligCfg.sele,
                        color: ligCfg.customColor || ligCfg.color || "element",
                        multipleBond: true
                    });
                }
            });
        }

        // 5. LIPID MEMBRANE (Species-Aware)
        if (config.membrane && config.membrane.visible && config.membrane.species) {
            Object.entries(config.membrane.species).forEach(([lipName, lipCfg], idx) => {
                if (lipCfg && lipCfg.visible) {
                    const style = lipCfg.style || "licorice";
                    const color = lipCfg.customColor || (lipCfg.color && lipCfg.color !== "element" ? lipCfg.color : getLipidDefaultColor(idx));

                    if (style === "head-ball-tail-stick") {
                        // A. Render Hydrocarbon Acyl Tails in Slim Licorice Sticks
                        comp.addRepresentation("licorice", {
                            sele: `[${lipName}]`,
                            color: color,
                            radius: 0.14,
                            opacity: 0.85
                        });

                        // B. Universal Headgroup Atom Selection (_P/_N elements + .P*/.N*/.O1P/.O2P/.OP1/.OP2/.O11 etc.)
                        // Catches CHARMM36, Amber, Gromacs POPC, POPE, TOCL, TOCL2, CARD, CHOL headgroups without syntax errors!
                        const headGroupSele = `[${lipName}] and (_P or _N or .P* or .N* or .O1P or .O2P or .OP1 or .OP2 or .O11 or .O12 or .O13 or .O14 or .O21 or .O22 or .O23 or .O24 or .O3 or .O4 or .C11 or .C12)`;
                        
                        comp.addRepresentation("spacefill", {
                            sele: headGroupSele,
                            color: color,
                            scale: 0.85, // Prominent 3D headgroup balls
                            opacity: 1.0
                        });
                    } else if (style === "hyperball") {
                        comp.addRepresentation("hyperball", {
                            sele: `[${lipName}]`,
                            color: color,
                            shrink: 0.2,
                            opacity: 0.9
                        });
                    } else {
                        comp.addRepresentation(style, {
                            sele: `[${lipName}]`,
                            color: color,
                            radius: 0.15,
                            opacity: 0.85
                        });
                    }
                }
            });
        }

        // 6. GLYCANS / SACCHARIDES
        if (config.saccharides && config.saccharides.visible) {
            comp.addRepresentation(config.saccharides.style || "hyperball", {
                sele: SELE_SACCHARIDE,
                color: config.saccharides.color || "element"
            });
        }

        // 7. IONS
        if (config.ions && config.ions.visible) {
            comp.addRepresentation(config.ions.style || "spacefill", {
                sele: SELE_ION,
                color: config.ions.color || "#eab308",
                scale: 0.35
            });
        }

        // 8. SOLVENT (WATER)
        if (config.water && config.water.visible) {
            comp.addRepresentation(config.water.style || "line", {
                sele: SELE_WATER,
                color: config.water.color || "#06b6d4",
                opacity: 0.35
            });
        }

        // 9. ⭐ CUSTOM SELECTION OBJECTS
        if (Array.isArray(config.customSelections)) {
            config.customSelections.forEach(custom => {
                if (custom.visible && custom.sele) {
                    const repParams = {
                        sele: custom.sele,
                        color: custom.color || "#3b82f6",
                        opacity: custom.opacity !== undefined ? parseFloat(custom.opacity) : 1.0
                    };
                    if (custom.style === "surface") {
                        repParams.surfaceType = "ses";
                        repParams.useWorker = true;
                    } else if (custom.style === "ball+stick" || custom.style === "licorice") {
                        repParams.multipleBond = true;
                    }
                    comp.addRepresentation(custom.style || "cartoon", repParams);
                }
            });
        }

        // Check if the user intentionally turned off all visibility
        const isMembraneHidden = !config.membrane || !config.membrane.visible || 
            (config.membrane.species && Object.keys(config.membrane.species).length > 0 && Object.values(config.membrane.species).every(s => s && !s.visible));

        const isEverythingHidden = 
            (!config.proteins || !config.proteins.visible || Object.values(config.proteins.chains || {}).every(c => c && !c.visible)) &&
            (!config.rna || !config.rna.visible || Object.values(config.rna.chains || {}).every(c => c && !c.visible)) &&
            (!config.dna || !config.dna.visible || Object.values(config.dna.chains || {}).every(c => c && !c.visible)) &&
            (!config.ligands || !config.ligands.visible || Object.values(config.ligands.items || {}).every(l => l && !l.visible)) &&
            isMembraneHidden &&
            (!config.saccharides || !config.saccharides.visible) &&
            (!config.ions || !config.ions.visible) &&
            (!config.water || !config.water.visible) &&
            (!config.customSelections || config.customSelections.every(s => !s.visible));

        // Only apply safety fallback if representations are empty AND the user has NOT explicitly hidden everything
        if (!isEverythingHidden && (!comp.reprList || comp.reprList.length === 0)) {
            const seleNonSolvent = SELE_NON_SOLVENT;
            const hasNonSolvent = comp.structure ? comp.structure.getAtomIndices(new NGL.Selection(seleNonSolvent)) : null;
            if (hasNonSolvent && hasNonSolvent.length > 0) {
                comp.addRepresentation("ball+stick", { sele: seleNonSolvent, color: "element" });
            } else {
                comp.addRepresentation("ball+stick", { sele: "all", color: "element" });
            }
        }

    } catch (err) {
        console.warn("applyCustomRepresentation error:", err);
    }
}

// Fast JS Residue Inspection & Decomposition into First-Class Biological Categories
export function extractMoleculeTree(comp) {
    const tree = {
        proteinChains: [], // [{ name: "A", resCount: 315, atomCount: 2480, type: "Protein" }]
        rnaChains: [],     // [{ name: "A", resCount: 115, atomCount: 3710, type: "RNA" }]
        dnaChains: [],     // [{ name: "C", resCount: 30, atomCount: 950, type: "DNA" }]
        lipidSpecies: [],  // [{ id: "LIP_POPE", resname: "POPE", label: "POPE", count: 60, totalAtoms: 7500, sele: "[POPE]" }]
        ligands: [],       // [{ id: "LIG_GTP", resname: "GTP", label: "GTP", count: 1, totalAtoms: 32, sele: "[GTP] and 1:A" }]
        glycanSpecies: [], // [{ id: "GLY_NAG", resname: "NAG", label: "NAG", count: 4, totalAtoms: 112, sele: "[NAG]" }]
        ionStats: { count: 0, totalAtoms: 0, sele: "" },
        waterStats: { count: 0, totalAtoms: 0, sele: "" },
        hasProteins: false,
        hasRna: false,
        hasDna: false,
        hasLipids: false,
        hasLigands: false,
        hasSaccharides: false,
        hasWater: false,
        hasIons: false
    };

    if (!comp || !comp.structure) return tree;

    // 1. Classify Protein, RNA, DNA Chains with exact atom counts
    comp.structure.eachChain(chain => {
        let proteinCount = 0, rnaCount = 0, dnaCount = 0, totalRes = 0;
        let chainAtoms = chain.atomCount || 0;

        chain.eachResidue(res => {
            totalRes++;
            if (!chain.atomCount && res.atomCount) chainAtoms += res.atomCount;
            if (res.isProtein && res.isProtein()) proteinCount++;
            else if (res.isRna && res.isRna()) rnaCount++;
            else if (res.isDna && res.isDna()) dnaCount++;
            else if (res.isNucleic && res.isNucleic()) dnaCount++;
        });

        const cName = chain.chainname ? chain.chainname.trim() : "";
        if (totalRes > 0) {
            if (proteinCount >= rnaCount && proteinCount >= dnaCount && proteinCount > 0) {
                tree.hasProteins = true;
                tree.proteinChains.push({ name: cName, resCount: proteinCount, atomCount: chainAtoms, type: "Protein" });
            } else if (rnaCount >= dnaCount && rnaCount > 0) {
                tree.hasRna = true;
                tree.rnaChains.push({ name: cName, resCount: rnaCount, atomCount: chainAtoms, type: "RNA" });
            } else if (dnaCount > 0) {
                tree.hasDna = true;
                tree.dnaChains.push({ name: cName, resCount: dnaCount, atomCount: chainAtoms, type: "DNA" });
            }
        }
    });

    // 2. Scan Lipids, Ligands, Glycans, Ions, Water
    const lipidMap = new Map();
    const ligandMap = new Map();
    const glycanMap = new Map();
    const ionResnames = new Set();
    const waterResnames = new Set();

    comp.structure.eachResidue(res => {
        const rName = res.resname ? res.resname.trim().toUpperCase() : "";
        const cName = res.chainname ? res.chainname.trim() : "";
        const aCount = res.atomCount || 0;

        if ((res.isWater && res.isWater()) || KNOWN_WATERS.includes(rName)) {
            tree.hasWater = true;
            tree.waterStats.count++;
            tree.waterStats.totalAtoms += aCount;
            waterResnames.add(`[${rName}]`);
        } else if ((res.isIon && res.isIon()) || KNOWN_IONS.includes(rName)) {
            tree.hasIons = true;
            tree.ionStats.count++;
            tree.ionStats.totalAtoms += aCount;
            ionResnames.add(`[${rName}]`);
        } else if (isLikelyLipid(rName)) {
            tree.hasLipids = true;
            if (!lipidMap.has(rName)) lipidMap.set(rName, { resname: rName, count: 0, totalAtoms: 0 });
            const e = lipidMap.get(rName);
            e.count++;
            e.totalAtoms += aCount;
        } else if ((res.isSaccharide && res.isSaccharide()) || KNOWN_SACCHARIDES.includes(rName)) {
            tree.hasSaccharides = true;
            if (!glycanMap.has(rName)) glycanMap.set(rName, { resname: rName, count: 0, totalAtoms: 0 });
            const e = glycanMap.get(rName);
            e.count++;
            e.totalAtoms += aCount;
        } else if (rName.length > 0 && (!res.isProtein || !res.isProtein()) && (!res.isNucleic || !res.isNucleic())) {
            tree.hasLigands = true;
            if (!ligandMap.has(rName)) {
                ligandMap.set(rName, { resname: rName, count: 0, totalAtoms: 0, firstResno: res.resno, firstChain: cName });
            }
            const e = ligandMap.get(rName);
            e.count++;
            e.totalAtoms += aCount;
        }
    });

    tree.ionStats.sele = Array.from(ionResnames).join(' or ') || 'ion';
    tree.waterStats.sele = Array.from(waterResnames).join(' or ') || 'water';

    lipidMap.forEach((val, rName) => {
        tree.lipidSpecies.push({
            id: `LIP_${rName}`,
            resname: rName,
            label: rName,
            count: val.count,
            totalAtoms: val.totalAtoms,
            sele: `[${rName}]`
        });
    });

    glycanMap.forEach((val, rName) => {
        tree.glycanSpecies.push({
            id: `GLY_${rName}`,
            resname: rName,
            label: rName,
            count: val.count,
            totalAtoms: val.totalAtoms,
            sele: `[${rName}]`
        });
    });

    ligandMap.forEach((val, rName) => {
        const chainPart = val.firstChain ? `:${val.firstChain}` : '';
        const idChain = val.firstChain ? `_${val.firstChain}` : '';
        tree.ligands.push({
            id: val.count === 1 ? `LIG_${rName}_${val.firstResno}${idChain}` : `LIG_${rName}`,
            resname: rName,
            resno: val.firstResno,
            chainname: val.firstChain || '',
            label: rName,
            count: val.count,
            totalAtoms: val.totalAtoms,
            atomCount: val.totalAtoms,
            sele: val.count === 1 ? `[${rName}] and ${val.firstResno}${chainPart}` : `[${rName}]`
        });
    });

    return tree;
}

