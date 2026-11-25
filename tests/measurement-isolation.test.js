import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionManager } from '../src/engine/measurement.js';
import { EVENTS } from '../src/contracts/events.js';
import { PUBLIC_API } from '../src/contracts/engine-api.js';
import { mountPanel } from '../src/ui/shell/boundary.js';
import { initMeasurementPanel } from '../src/ui/panels/measurement-panel.js';

describe('Phase 5 — Measurement Isolation & Engine API', () => {
    let mockStage;
    let mockComp;
    let emitFn;
    let emittedEvents;
    let mgr;

    beforeEach(() => {
        emittedEvents = [];
        emitFn = (type, detail) => {
            emittedEvents.push({ type, detail });
        };

        mockStage = {
            signals: {
                hovered: { add: vi.fn(), dispatch: vi.fn() },
                clicked: { add: vi.fn(), dispatch: vi.fn() }
            },
            viewer: {
                requestRender: vi.fn(),
                renderer: {
                    domElement: {
                        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
                        style: {},
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn()
                    }
                }
            },
            animationControls: {
                zoomMove: vi.fn()
            }
        };

        // Mock Structure with atoms
        const atoms = [
            { index: 0, x: 0, y: 0, z: 0, resname: 'ALA', resno: 1, chainname: 'A', atomname: 'CA' },
            { index: 1, x: 3, y: 4, z: 0, resname: 'GLY', resno: 2, chainname: 'A', atomname: 'CA' }, // distance = 5
            { index: 2, x: 3, y: 0, z: 0, resname: 'VAL', resno: 3, chainname: 'A', atomname: 'CA' },
            { index: 3, x: 0, y: 5, z: 5, resname: 'LEU', resno: 4, chainname: 'A', atomname: 'CA' }
        ];

        mockComp = {
            structure: {
                getAtomProxy: (idx) => {
                    const a = atoms[idx || 0];
                    return { ...a };
                },
                getView: (selection) => {
                    const selStr = selection?.string || '';
                    const resMatch = selStr.match(/\d+/);
                    const resno = resMatch ? parseInt(resMatch[0], 10) : null;
                    const matched = atoms.filter(a => (resno !== null && a.resno === resno) || selStr.includes(`@${a.index}`));
                    if (matched.length > 0) {
                        return {
                            atomCount: matched.length,
                            eachAtom: (fn) => matched.forEach(fn)
                        };
                    }
                    return null;
                }
            },
            addRepresentation: vi.fn().mockImplementation((type, config) => ({
                type,
                config,
                setVisibility: vi.fn()
            })),
            removeRepresentation: vi.fn()
        };

        const shadow = {
            getElementById: vi.fn().mockReturnValue({ style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), appendChild: vi.fn() }),
            host: {
                dispatchEvent: vi.fn()
            }
        };

        mgr = new InteractionManager(mockStage, shadow, mockComp, emitFn);
    });

    it('PUBLIC_API contains all 9 measurement methods', () => {
        const required = [
            'addMeasurement',
            'removeMeasurement',
            'setMeasurementVisible',
            'focusMeasurement',
            'clearMeasurements',
            'getMeasurements',
            'exportMeasurements',
            'startMeasurementPick',
            'cancelPick'
        ];
        for (const method of required) {
            expect(PUBLIC_API).toContain(method);
        }
    });

    it('addMeasurement parses user strings and returns a plain record', () => {
        const record = mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        expect(record).toBeDefined();
        expect(record.id).toMatch(/^meas_/);
        expect(record.type).toBe('distance');
        expect(record.value).toBe(5);
        expect(record.unit).toBe('Å');
        expect(record.visible).toBe(true);
        expect(record.atoms).toHaveLength(2);
        expect(typeof record.label).toBe('string');

        // Check MEASUREMENTS_CHANGED emitted
        const changeEvent = emittedEvents.find(e => e.type === EVENTS.MEASUREMENTS_CHANGED);
        expect(changeEvent).toBeDefined();
        expect(changeEvent.detail.count).toBe(1);
    });

    it('addMeasurement throws user-readable error on invalid inputs', () => {
        expect(() => mgr.addMeasurement('distance', ['999.ZZ'])).toThrow('Need 2 valid atom selections');
        expect(() => mgr.addMeasurement('invalid_type', ['1.CA', '2.CA'])).toThrow('Invalid measurement type');
    });

    it('getMeasurements returns plain records without NGL representations', () => {
        mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        const list = mgr.getMeasurements();
        expect(list).toHaveLength(1);
        const item = list[0];
        expect(item.representation).toBeUndefined();
        expect(item.id).toBeDefined();
        expect(item.type).toBe('distance');
        expect(item.value).toBe(5);
        expect(Array.isArray(item.atoms)).toBe(true);
        expect(typeof item.atoms[0]).toBe('string');
    });

    it('setMeasurementVisible updates visibility and emits MEASUREMENTS_CHANGED', () => {
        const rec = mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        emittedEvents.length = 0;

        const vis = mgr.setMeasurementVisible(rec.id, false);
        expect(vis).toBe(false);
        expect(mgr.getMeasurements()[0].visible).toBe(false);

        const changeEvt = emittedEvents.find(e => e.type === EVENTS.MEASUREMENTS_CHANGED);
        expect(changeEvt).toBeDefined();
    });

    it('removeMeasurement removes record and emits MEASUREMENTS_CHANGED', () => {
        const rec = mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        emittedEvents.length = 0;

        const removed = mgr.removeMeasurement(rec.id);
        expect(removed).toBe(true);
        expect(mgr.getMeasurements()).toHaveLength(0);

        const changeEvt = emittedEvents.find(e => e.type === EVENTS.MEASUREMENTS_CHANGED);
        expect(changeEvt).toBeDefined();
        expect(changeEvt.detail.count).toBe(0);
    });

    it('clearMeasurements purges all and emits MEASUREMENTS_CHANGED with count 0', () => {
        mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        emittedEvents.length = 0;

        mgr.clearMeasurements();
        expect(mgr.getMeasurements()).toHaveLength(0);

        const changeEvt = emittedEvents.find(e => e.type === EVENTS.MEASUREMENTS_CHANGED);
        expect(changeEvt).toBeDefined();
        expect(changeEvt.detail.count).toBe(0);
    });

    it('exportMeasurements exports csv and json format strings', () => {
        mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        const csv = mgr.exportMeasurements('csv');
        expect(csv).toContain('ID,Type,Atoms,Value,Unit');
        expect(csv).toContain('distance');

        const json = mgr.exportMeasurements('json');
        const parsed = JSON.parse(json);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed[0].type).toBe('distance');
    });

    it('picking flow emits plain data ATOM_PICKED without NGL objects', () => {
        mgr.startMeasurementPick('distance');
        expect(mgr.isPicking).toBe(true);

        const atom1 = { index: 0, resname: 'ALA', resno: 1, chainname: 'A', atomname: 'CA', x: 0, y: 0, z: 0 };
        mgr.handleAtomClick(atom1);

        const pickedEvt1 = emittedEvents.find(e => e.type === EVENTS.ATOM_PICKED);
        expect(pickedEvt1).toBeDefined();
        expect(pickedEvt1.detail.queued).toBe(1);
        expect(pickedEvt1.detail.needed).toBe(2);
        expect(pickedEvt1.detail.atom).toBeUndefined(); // No AtomProxy crosses boundary
        expect(pickedEvt1.detail.label).toContain('ALA');

        // Click 2nd atom completes measurement
        const atom2 = { index: 1, resname: 'GLY', resno: 2, chainname: 'A', atomname: 'CA', x: 3, y: 4, z: 0 };
        mgr.handleAtomClick(atom2);

        expect(mgr.isPicking).toBe(false);
        expect(mgr.getMeasurements()).toHaveLength(1);
        const noticeEvt = emittedEvents.find(e => e.type === EVENTS.NOTICE && e.detail.level === 'success');
        expect(noticeEvt).toBeDefined();
    });

    it('_createMeasurementRep handles representation error safely without throwing', () => {
        mockComp.addRepresentation.mockImplementationOnce(() => {
            throw new Error('WebGL shader compile failure');
        });

        // Does not throw out of addMeasurement half-built
        let rec;
        expect(() => {
            rec = mgr.addMeasurement('distance', ['1.CA', '2.CA']);
        }).not.toThrow();

        expect(rec).toBeDefined();
        expect(rec.value).toBe(5);
        expect(mgr.getMeasurements()).toHaveLength(1);
    });

    it('fault drill: 5 errors in measurement panel frame handler stops only that panel', () => {
        const engine = new EventTarget();
        let frameCount = 0;
        let mockRmsdFrameCount = 0;

        // Mock other panel listening to frame updates
        engine.addEventListener(EVENTS.FRAME_UPDATE, () => {
            mockRmsdFrameCount++;
        });

        // Mount a failing measurement panel simulating a throw in frame handler
        mountPanel('MeasurementPanel', ({ engine, listen }) => {
            listen(engine, EVENTS.FRAME_UPDATE, () => {
                frameCount++;
                throw new Error('Simulated measurement computation fault');
            });
        }, engine);

        // Dispatch 10 frame updates
        for (let i = 0; i < 10; i++) {
            engine.dispatchEvent(new CustomEvent(EVENTS.FRAME_UPDATE, { detail: { frame: i } }));
        }

        // Fault counter stops MeasurementPanel after 5 faults
        expect(frameCount).toBe(5);

        // Meanwhile other panels (and playback) continued through all 10 frames
        expect(mockRmsdFrameCount).toBe(10);
    });

    it('getAtomSelection returns @${atom.index} to uniquely identify atoms with repeated residue numbers', () => {
        const atom1 = { index: 42, resno: 10, chainname: 'A', atomname: 'CA' };
        const atom2 = { index: 142, resno: 10, chainname: 'A', atomname: 'CA' }; // same residue, different atom index
        const atomWithoutIndex = { resno: 5, chainname: 'B', atomname: 'CB' };

        expect(InteractionManager.getAtomSelection(atom1)).toBe('@42');
        expect(InteractionManager.getAtomSelection(atom2)).toBe('@142');
        expect(InteractionManager.getAtomSelection(atomWithoutIndex)).toBe('5:B.CB');
        expect(InteractionManager.getAtomSelection(null)).toBe('');
    });
});
