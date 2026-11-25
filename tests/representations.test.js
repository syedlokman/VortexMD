import { describe, it, expect, vi } from 'vitest';
import { extractMoleculeTree, applyCustomRepresentation } from '../src/engine/representations.js';
import { createDefaultDisplayConfig } from '../src/engine/display-config.js';
import { STYLE_OPTIONS, ENTITY_STYLES, DEFAULT_LIPID_PALETTE, getLipidDefaultColor } from '../src/contracts/display.js';

describe('Molecular Tree & Custom Selection Representation System', () => {
    it('creates a proper default displayConfig structure with distinct categories', () => {
        const config = createDefaultDisplayConfig();
        expect(config).toBeDefined();
        expect(config.proteins).toEqual({ visible: true, style: 'cartoon', chains: {} });
        expect(config.rna).toEqual({ visible: true, style: 'cartoon', chains: {} });
        expect(config.dna).toEqual({ visible: true, style: 'cartoon', chains: {} });
        expect(config.ligands).toEqual({ visible: true, style: 'ball+stick', items: {} });
        expect(config.membrane).toBeDefined();
        expect(config.saccharides).toBeDefined();
        expect(config.ions).toBeDefined();
        expect(config.water).toBeDefined();
        expect(config.customSelections).toEqual([]);
    });

    it('extracts protein, rna, dna, and individual ligands correctly', () => {
        const mockResiduesChainA = [
            { resname: 'ALA', resno: 1, chainname: 'A', isProtein: () => true, isNucleic: () => false, isRna: () => false, isDna: () => false },
            { resname: 'GLY', resno: 2, chainname: 'A', isProtein: () => true, isNucleic: () => false, isRna: () => false, isDna: () => false },
            { resname: 'ATP', resno: 500, chainname: 'A', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, atomCount: 31 },
            { resname: 'MG', resno: 501, chainname: 'A', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, isIon: () => true },
            { resname: 'SOL', resno: 502, chainname: 'A', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, isWater: () => true }
        ];

        const mockResiduesChainB = [
            { resname: 'A', resno: 1, chainname: 'B', isProtein: () => false, isNucleic: () => true, isRna: () => true, isDna: () => false },
            { resname: 'U', resno: 2, chainname: 'B', isProtein: () => false, isNucleic: () => true, isRna: () => true, isDna: () => false }
        ];

        const mockResiduesChainC = [
            { resname: 'DA', resno: 1, chainname: 'C', isProtein: () => false, isNucleic: () => true, isRna: () => false, isDna: () => true },
            { resname: 'DT', resno: 2, chainname: 'C', isProtein: () => false, isNucleic: () => true, isRna: () => false, isDna: () => true }
        ];

        const allResidues = [...mockResiduesChainA, ...mockResiduesChainB, ...mockResiduesChainC];

        const mockComp = {
            structure: {
                eachChain: (fn) => {
                    fn({ chainname: 'A', eachResidue: (rFn) => mockResiduesChainA.forEach(rFn) });
                    fn({ chainname: 'B', eachResidue: (rFn) => mockResiduesChainB.forEach(rFn) });
                    fn({ chainname: 'C', eachResidue: (rFn) => mockResiduesChainC.forEach(rFn) });
                },
                eachResidue: (fn) => allResidues.forEach(fn)
            }
        };

        const tree = extractMoleculeTree(mockComp);
        expect(tree.proteinChains.length).toBe(1);
        expect(tree.proteinChains[0].name).toBe('A');
        expect(tree.proteinChains[0].type).toBe('Protein');

        expect(tree.rnaChains.length).toBe(1);
        expect(tree.rnaChains[0].name).toBe('B');
        expect(tree.rnaChains[0].type).toBe('RNA');

        expect(tree.dnaChains.length).toBe(1);
        expect(tree.dnaChains[0].name).toBe('C');
        expect(tree.dnaChains[0].type).toBe('DNA');

        expect(tree.ligands.length).toBe(1);
        expect(tree.ligands[0].resname).toBe('ATP');
        expect(tree.ligands[0].resno).toBe(500);
        expect(tree.ligands[0].sele).toBe('[ATP] and 500:A');

        expect(tree.hasIons).toBe(true);
        expect(tree.hasWater).toBe(true);
    });

    it('applies representations for proteins, rna, dna, ligands, and custom selection objects', () => {
        const addedReps = [];
        const mockComp = {
            removeAllRepresentations: vi.fn(),
            addRepresentation: vi.fn((style, params) => {
                addedReps.push({ style, params });
            }),
            reprList: ['dummy']
        };

        const config = createDefaultDisplayConfig();
        config.proteins.chains = {
            'A': { visible: true, style: 'cartoon', customColor: '#ff0000', type: 'Protein' }
        };
        config.rna.chains = {
            'B': { visible: true, customColor: '#00ff00', type: 'RNA' }
        };
        config.dna.chains = {
            'C': { visible: true, customColor: '#0000ff', type: 'DNA' }
        };
        config.ligands.items = {
            'ATP_A_500': { visible: true, style: 'ball+stick', color: 'element', sele: '[ATP] and 500:A' }
        };
        config.customSelections = [
            { id: 'custom_1', label: 'Active Site', sele: ':A and 10-50', style: 'surface', color: '#a855f7', opacity: 0.8, visible: true }
        ];

        applyCustomRepresentation(mockComp, config);

        expect(mockComp.removeAllRepresentations).toHaveBeenCalled();
        expect(addedReps.length).toBeGreaterThanOrEqual(5);

        const proteinRep = addedReps.find(r => r.style === 'cartoon' && r.params.sele.includes(':A'));
        expect(proteinRep).toBeDefined();
        expect(proteinRep.params.color).toBe('#ff0000');

        const rnaRep = addedReps.find(r => r.style === 'cartoon' && r.params.sele.includes(':B'));
        expect(rnaRep).toBeDefined();
        expect(rnaRep.params.color).toBe('#00ff00');

        const dnaRep = addedReps.find(r => r.style === 'cartoon' && r.params.sele.includes(':C'));
        expect(dnaRep).toBeDefined();
        expect(dnaRep.params.color).toBe('#0000ff');

        const ligRep = addedReps.find(r => r.style === 'ball+stick' && r.params.sele === '[ATP] and 500:A');
        expect(ligRep).toBeDefined();
        expect(ligRep.params.multipleBond).toBe(true);

        const customRep = addedReps.find(r => r.style === 'surface' && r.params.sele === ':A and 10-50');
        expect(customRep).toBeDefined();
        expect(customRep.params.surfaceType).toBe('ses');
        expect(customRep.params.opacity).toBe(0.8);
        expect(customRep.params.color).toBe('#a855f7');
    });

    it('extracts distinct lipid species and isolates them from ligands', () => {
        const mockResidues = [
            { resname: 'ALA', resno: 1, chainname: 'A', isProtein: () => true, isNucleic: () => false, isRna: () => false, isDna: () => false },
            { resname: 'POPC', resno: 10, chainname: 'M', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, atomCount: 134 },
            { resname: 'POPC', resno: 11, chainname: 'M', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, atomCount: 134 },
            { resname: 'TOCL2', resno: 12, chainname: 'M', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, atomCount: 156 },
            { resname: 'BEN', resno: 100, chainname: 'A', isProtein: () => false, isNucleic: () => false, isRna: () => false, isDna: () => false, atomCount: 12 }
        ];

        const mockComp = {
            structure: {
                eachChain: (fn) => fn({ chainname: 'A', eachResidue: (rFn) => mockResidues.forEach(rFn) }),
                eachResidue: (fn) => mockResidues.forEach(fn)
            }
        };

        const tree = extractMoleculeTree(mockComp);
        expect(tree.hasLipids).toBe(true);
        expect(tree.lipidSpecies.length).toBe(2);

        const popc = tree.lipidSpecies.find(l => l.resname === 'POPC');
        expect(popc).toBeDefined();
        expect(popc.count).toBe(2);
        expect(popc.totalAtoms).toBe(268);

        const tocl2 = tree.lipidSpecies.find(l => l.resname === 'TOCL2');
        expect(tocl2).toBeDefined();
        expect(tocl2.count).toBe(1);

        expect(tree.ligands.length).toBe(1);
        expect(tree.ligands[0].resname).toBe('BEN');
    });

    it('supports hyperball and head-ball-tail-stick in membrane styles and renders them properly', () => {
        expect(ENTITY_STYLES.membrane).toContain('head-ball-tail-stick');
        expect(ENTITY_STYLES.membrane).toContain('hyperball');

        const htOpt = STYLE_OPTIONS.find(o => o.value === 'head-ball-tail-stick');
        expect(htOpt).toBeDefined();
        expect(htOpt.short).toBe('HT');
        expect(htOpt.label).toBe('Head-Ball & Tail-Stick');

        const addedReps = [];
        const mockComp = {
            removeAllRepresentations: vi.fn(),
            addRepresentation: vi.fn((style, params) => {
                addedReps.push({ style, params });
            })
        };

        const config = createDefaultDisplayConfig();
        config.membrane.species = {
            'POPC': { visible: true, style: 'head-ball-tail-stick', color: 'element' },
            'DOPE': { visible: true, style: 'hyperball', customColor: '#10b981' }
        };

        applyCustomRepresentation(mockComp, config);

        const popcLicorice = addedReps.find(r => r.style === 'licorice' && r.params.sele === '[POPC]');
        expect(popcLicorice).toBeDefined();
        expect(popcLicorice.params.radius).toBe(0.14);
        expect(popcLicorice.params.opacity).toBe(0.85);

        const popcHead = addedReps.find(r => r.style === 'spacefill' && r.params.sele.includes('_P or _N or .P* or .N*'));
        expect(popcHead).toBeDefined();
        expect(popcHead.params.scale).toBe(0.85);
        expect(popcHead.params.opacity).toBe(1.0);
        expect(config.water.visible).toBe(false);

        const dopeHyperball = addedReps.find(r => r.style === 'hyperball' && r.params.sele === '[DOPE]');
        expect(dopeHyperball).toBeDefined();
        expect(dopeHyperball.params.color).toBe('#10b981');
        expect(dopeHyperball.params.shrink).toBe(0.2);
        expect(dopeHyperball.params.opacity).toBe(0.9);
    });

    it('assigns different colors to different lipid species by default', () => {
        expect(DEFAULT_LIPID_PALETTE.length).toBeGreaterThanOrEqual(5);
        expect(getLipidDefaultColor(0)).not.toBe(getLipidDefaultColor(1));
        expect(getLipidDefaultColor(1)).not.toBe(getLipidDefaultColor(2));

        const addedReps = [];
        const mockComp = {
            removeAllRepresentations: vi.fn(),
            addRepresentation: vi.fn((style, params) => {
                addedReps.push({ style, params });
            })
        };

        const config = createDefaultDisplayConfig();
        config.membrane.species = {
            'POPC': { visible: true, style: 'licorice' },
            'POPE': { visible: true, style: 'licorice' },
            'CHOL': { visible: true, style: 'licorice' }
        };

        applyCustomRepresentation(mockComp, config);

        const popcRep = addedReps.find(r => r.params.sele === '[POPC]');
        const popeRep = addedReps.find(r => r.params.sele === '[POPE]');
        const cholRep = addedReps.find(r => r.params.sele === '[CHOL]');

        expect(popcRep).toBeDefined();
        expect(popeRep).toBeDefined();
        expect(cholRep).toBeDefined();

        expect(popcRep.params.color).toBe(getLipidDefaultColor(0));
        expect(popeRep.params.color).toBe(getLipidDefaultColor(1));
        expect(cholRep.params.color).toBe(getLipidDefaultColor(2));
        expect(popcRep.params.color).not.toBe(popeRep.params.color);
        expect(popeRep.params.color).not.toBe(cholRep.params.color);
    });
});
