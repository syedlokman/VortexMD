import { describe, it, expect, vi } from 'vitest';
import { SessionManager, serializeSessionPayload } from '../src/engine/session.js';

function createRestorePlayerMock(overrides = {}) {
    const mockStage = {
        setParameters: vi.fn(),
        viewerControls: { orient: vi.fn() }
    };
    const player = {
        comp: { structure: { name: '2MB5.pdb', atomCount: 1400 } },
        stage: mockStage,
        displayConfig: {},
        deltaTime: 10,
        timeOffset: 0,
        speedMultiplier: 1.0,
        playbackDirection: 'forward',
        isLooping: false,
        loopStartFrame: 0,
        loopEndFrame: null,
        pins: [],
        depthSlicing: 0,
        mouseScheme: 'default',
        setBackgroundColor: vi.fn((c) => mockStage.setParameters({ backgroundColor: c })),
        setCameraType: vi.fn((t) => mockStage.setParameters({ cameraType: t })),
        setDepthSlicing: vi.fn(),
        setMouseScheme: vi.fn(),
        rebuildTreeUI: vi.fn(),
        updateCustomRepresentations: vi.fn(),
        setPlaybackSpeed: vi.fn(function (s) { this.speedMultiplier = s; }),
        setPlaybackDirection: vi.fn(function (d) { this.playbackDirection = d; }),
        setLoop: vi.fn(function (l) { this.isLooping = l; }),
        setLoopRange: vi.fn(function (start, end) { this.loopStartFrame = start; this.loopEndFrame = end; }),
        setPhysicalTimeConfig: vi.fn(function (dt, to) { this.deltaTime = dt; this.timeOffset = to; }),
        jumpToFrame: vi.fn(),
        dispatchEvent: vi.fn(),
        emit: vi.fn(),
        notify: vi.fn(),
        restoreMeasurement: vi.fn(),
        clearMeasurements: vi.fn(),
        clearShapes: vi.fn(),
        interactionManager: { clearMeasurements: vi.fn(), restoreMeasurement: vi.fn(), getMeasurementData: () => [] },
        shapeManager: { clearAll: vi.fn(), getShapes: () => [] },
        ...overrides
    };
    player.playbackController = {
        setPlaybackSpeed: vi.fn((s) => { player.speedMultiplier = s; }),
        setPlaybackDirection: vi.fn((d) => { player.playbackDirection = d; }),
        setLoop: vi.fn((l) => { player.isLooping = l; }),
        setLoopRange: vi.fn((start, end) => { player.loopStartFrame = start; player.loopEndFrame = end; }),
        jumpToFrame: vi.fn()
    };
    return { player, mockStage };
}

describe('SessionManager Engine & Schema Validation', () => {
    it('serializes complete workspace state including structure/trajectory metadata and deep-copies displayConfig', () => {
        const mockStage = {
            getParameters: vi.fn().mockReturnValue({ backgroundColor: 'black', cameraType: 'orthographic' }),
            viewerControls: {
                getOrientation: vi.fn().mockReturnValue({
                    elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                })
            }
        };
        const mockDisplayConfig = {
            proteins: { visible: true, style: 'cartoon', color: 'chainname', chains: { A: { visible: true } } },
            ligands: { visible: true, style: 'ball+stick', color: 'element', items: {} }
        };
        const mockMeasurements = [{ id: 'm-1', type: 'distance', atoms: [10, 20], value: 3.45, unit: 'Å', visible: true }];
        const mockShapes = [{ id: 's-1', type: 'sphere', name: 'Binding Pocket', color: '#10b981', opacity: 0.5, visible: true, params: { radius: 5 } }];

        const mockPlayer = {
            comp: { structure: { name: '1CRN.pdb', atomCount: 327 } },
            trajectoryName: 'md_1.xtc',
            currentFrame: 15,
            totalFrames: 100,
            deltaTime: 50,
            timeOffset: 10,
            speedMultiplier: 2.0,
            playbackDirection: 'forward',
            isLooping: true,
            loopStartFrame: 5,
            loopEndFrame: 80,
            pins: [{ frame: 15, label: 'Key Conformation' }],
            displayConfig: mockDisplayConfig,
            stage: mockStage,
            depthSlicing: 2.5,
            mouseScheme: 'pymol',
            interactionManager: { getMeasurements: () => mockMeasurements, getMeasurementData: () => mockMeasurements },
            shapeManager: { getShapes: () => mockShapes }
        };

        const payload = new SessionManager(mockPlayer).serialize('Kinase_Trajectory');

        expect(payload.version).toBe('1.0.0');
        expect(payload.app).toBe('VortexMD');
        expect(payload.sessionId).toMatch(/^session_/);
        expect(payload.sessionName).toBe('Kinase_Trajectory');
        expect(payload.structure).toMatchObject({ name: '1CRN.pdb', atomCount: 327 });
        expect(payload.trajectory).toMatchObject({ name: 'md_1.xtc', frameCount: 100 });
        expect(payload.playback).toMatchObject({
            currentFrame: 15,
            totalFrames: 100,
            deltaTime: 50,
            timeOffset: 10,
            speedMultiplier: 2.0,
            playbackDirection: 'forward',
            isLooping: true,
            loopRange: { loopStartFrame: 5, loopEndFrame: 80 },
            pins: [{ frame: 15, label: 'Key Conformation' }]
        });
        expect(payload.visualState).toMatchObject({
            displayConfig: mockDisplayConfig,
            backgroundColor: 'black',
            cameraProjection: 'orthographic',
            depthSlicing: 2.5,
            mouseScheme: 'pymol',
            cameraOrientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        });

        // Deep copy check
        mockDisplayConfig.proteins.visible = false;
        expect(payload.visualState.displayConfig.proteins.visible).toBe(true);
        expect(payload.objects.measurements).toHaveLength(1);
        expect(payload.objects.shapes).toHaveLength(1);
    });

    it('safely handles camera orientation errors during serialization', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mockPlayer = {
            displayConfig: { proteins: { visible: true } },
            stage: { viewerControls: { getOrientation: () => { throw new Error('GL context lost'); } } }
        };

        const payload = new SessionManager(mockPlayer).serialize();
        expect(payload.visualState.cameraOrientation).toBeNull();
        warnSpy.mockRestore();
    });

    it('validates genuine session payloads and rejects wrong app, missing displayConfig, or invalid JSON', () => {
        const validPayload = {
            version: '1.0.0',
            app: 'VortexMD',
            visualState: { displayConfig: { proteins: { visible: true } } }
        };
        expect(SessionManager.validate(validPayload)).toEqual({ valid: true });
        expect(SessionManager.validate(JSON.stringify(validPayload)).valid).toBe(true);

        const resWrongApp = SessionManager.validate({ version: '1.0.0', app: 'OtherViewer', visualState: { displayConfig: {} } });
        expect(resWrongApp.valid).toBe(false);
        expect(resWrongApp.error).toContain('VortexMD');

        const resMissingConfig = SessionManager.validate({ version: '1.0.0', app: 'VortexMD' });
        expect(resMissingConfig.valid).toBe(false);
        expect(resMissingConfig.error).toContain('displayConfig');

        const resInvalidJson = SessionManager.validate('{ corrupt: true, ');
        expect(resInvalidJson.valid).toBe(false);
        expect(resInvalidJson.error).toContain('Invalid JSON format');
    });

    it('compacts trajectory offsets to a single line in serializeSessionPayload', () => {
        const payload = {
            app: 'VortexMD',
            version: '1.0.0',
            sessionName: 'OffsetTest',
            trajectory: { name: 'md_1.xtc', offsets: [0, 1024, 2048, 4096, 8192] }
        };

        const json = serializeSessionPayload(payload);
        expect(json).toContain('"offsets": [0,1024,2048,4096,8192]');
        expect(JSON.parse(json).trajectory.offsets).toEqual([0, 1024, 2048, 4096, 8192]);
    });

    it('restores workspace state including visual config, playback, pins, loop range, and measurements', async () => {
        const { player, mockStage } = createRestorePlayerMock();
        const sessionData = {
            version: '1.0.0',
            app: 'VortexMD',
            sessionName: 'TestRestoration',
            visualState: {
                displayConfig: { proteins: { visible: true, style: 'cartoon', color: 'resname' } },
                backgroundColor: 'white',
                cameraProjection: 'orthographic',
                depthSlicing: 4.0,
                mouseScheme: 'pymol',
                cameraOrientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            },
            playback: {
                currentFrame: 42,
                deltaTime: 100,
                timeOffset: 25,
                speedMultiplier: 4.0,
                playbackDirection: 'backward',
                isLooping: true,
                loopRange: { loopStartFrame: 10, loopEndFrame: 90 },
                pins: [{ frame: 42, label: 'Transition State' }]
            },
            objects: {
                measurements: [
                    { type: 'distance', atoms: [1, 2], value: 2.8 },
                    { type: 'angle', atoms: [0, 1, 2], value: 109.5 },
                    { type: 'dihedral', atoms: [0, 1, 2, 3], value: -60.2 }
                ],
                shapes: [{ type: 'bounding_box', sele: 'all' }]
            }
        };

        const { VortexMD } = await import('../src/engine/vortexmd.js');
        await VortexMD.prototype.restoreSession.call(player, sessionData);

        expect(player.displayConfig.proteins).toMatchObject({ visible: true, style: 'cartoon' });
        expect(player.rebuildTreeUI).toHaveBeenCalled();
        expect(player.updateCustomRepresentations).toHaveBeenCalled();
        expect(player.deltaTime).toBe(100);
        expect(player.timeOffset).toBe(25);
        expect(player.speedMultiplier).toBe(4.0);
        expect(player.playbackDirection).toBe('backward');
        expect(player.isLooping).toBe(true);
        expect(player.loopStartFrame).toBe(10);
        expect(player.loopEndFrame).toBe(90);
        expect(player.pins).toEqual([{ frame: 42, label: 'Transition State' }]);
        expect(mockStage.setParameters).toHaveBeenCalledWith({ backgroundColor: 'white' });
        expect(mockStage.setParameters).toHaveBeenCalledWith({ cameraType: 'orthographic' });
        expect(mockStage.viewerControls.orient).toHaveBeenCalled();
        expect(player.clearMeasurements).toHaveBeenCalled();
        expect(player.restoreMeasurement).toHaveBeenCalledTimes(3);
        expect(player.clearShapes).toHaveBeenCalled();
        expect(player.playbackController.jumpToFrame).toHaveBeenCalledWith(42);
        expect(player.emit).toHaveBeenCalledWith('session-restored', expect.anything());
    });

    it('bypasses trajectory re-indexing by applying pre-computed byte offsets directly', async () => {
        const mockPlayer = {
            comp: { structure: { name: 'protein.gro', atomCount: 500 } },
            structureName: 'protein.gro',
            atomCount: 500,
            xtcFile: { name: 'traj.xtc', size: 8192 },
            fileOffsets: [],
            emit: vi.fn(),
            getDisplayConfig: () => ({}),
            getPins: () => [],
            getMeasurements: () => [],
            getShapes: () => [],
            restoreSession: vi.fn(async () => true)
        };

        const sessionPayload = {
            version: '1.0.0',
            app: 'VortexMD',
            sessionId: 'session_offsets_test',
            sessionName: 'OffsetTest',
            structure: { name: 'protein.gro', atomCount: 500 },
            trajectory: { name: 'traj.xtc', frameCount: 4, offsets: [0, 2048, 4096, 8192] },
            playback: { currentFrame: 0, totalFrames: 4, deltaTime: 40 },
            visualState: { displayConfig: {} }
        };

        const success = await new SessionManager(mockPlayer).restoreSession(sessionPayload, mockPlayer);
        expect(success).toBe(true);
        expect(mockPlayer.fileOffsets).toEqual([0, 2048, 4096, 8192]);
    });

    it('caches session and dispatches relink-required without warnings or outer DOM access when no structure is loaded', async () => {
        const getElementByIdSpy = vi.fn();
        const origDoc = global.document;
        global.document = { getElementById: getElementByIdSpy };
        const warnSpy = vi.spyOn(console, 'warn');

        const uninitializedPlayer = {
            comp: null,
            _cachedSessionData: null,
            dispatchEvent: vi.fn(),
            restoreSession: vi.fn(async () => true)
        };

        const sessionManager = new SessionManager(uninitializedPlayer);
        const relinkListener = vi.fn();
        sessionManager.addEventListener('relink-required', relinkListener);

        const sessionPayload = {
            version: '1.0.0',
            app: 'VortexMD',
            sessionId: 'session_missing_files',
            sessionName: 'MissingFilesSession',
            structure: { name: 'target_complex.pdb', atomCount: 1420 },
            trajectory: { name: 'production.xtc', frameCount: 500 },
            playback: { currentFrame: 0, totalFrames: 500 },
            visualState: { displayConfig: {} }
        };

        const result = await sessionManager.restoreSession(sessionPayload, uninitializedPlayer);

        expect(result).toBe(true);
        expect(relinkListener).toHaveBeenCalledTimes(1);
        expect(relinkListener.mock.calls[0][0].detail).toEqual(sessionPayload);
        expect(uninitializedPlayer.dispatchEvent).toHaveBeenCalled();
        expect(uninitializedPlayer._cachedSessionData).toEqual(sessionPayload);
        expect(getElementByIdSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
        global.document = origDoc;
    });

    it('round-trips a real InteractionManager distance measurement through serialize, clear, and hydrate', async () => {
        const atoms = [
            { index: 0, x: 0, y: 0, z: 0, resname: 'ALA', resno: 1, chainname: 'A', atomname: 'CA' },
            { index: 1, x: 3, y: 4, z: 0, resname: 'GLY', resno: 2, chainname: 'A', atomname: 'CA' }
        ];
        const mockComp = {
            structure: { name: '1crn.pdb', atomCount: 2, getAtomProxy: (idx) => ({ ...atoms[idx || 0] }) },
            addRepresentation: vi.fn().mockReturnValue({ setVisibility: vi.fn() }),
            removeRepresentation: vi.fn()
        };
        const mockStage = {
            signals: { hovered: { add: vi.fn() }, clicked: { add: vi.fn() } },
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
            viewerControls: {
                getOrientation: () => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }),
                orient: vi.fn()
            }
        };

        const { InteractionManager } = await import('../src/engine/measurement.js');
        const im = new InteractionManager(mockStage, null, mockComp, () => {});
        const { player } = createRestorePlayerMock({
            comp: mockComp,
            stage: mockStage,
            interactionManager: im,
            displayConfig: { proteins: { visible: true } },
            getPins: () => [],
            getDisplayConfig: () => ({ proteins: { visible: true } }),
            getShapes: () => [],
            getRmsdConfig: () => null,
            getRmsdRuns: () => [],
            clearMeasurements: () => im.clearMeasurements(),
            restoreMeasurement: (opts) => im.restoreMeasurement(opts),
            getMeasurements: () => im.getMeasurements(),
            setPins: vi.fn()
        });

        im.addDistance(atoms[0], atoms[1]);
        const initial = im.getMeasurements();
        expect(initial).toHaveLength(1);
        expect(initial[0].value).toBe(5);
        expect(initial[0].label).toBe('[ALA]1:A.CA - [GLY]2:A.CA');

        const payload = new SessionManager(player).serialize('MeasurementRoundtrip');
        player.clearMeasurements();
        expect(im.getMeasurements()).toHaveLength(0);

        await SessionManager.hydrate(player, payload);
        const restored = im.getMeasurements();
        expect(restored).toHaveLength(1);
        expect(restored[0].label).toBe(initial[0].label);
        expect(restored[0].value).toBe(initial[0].value);
    });
});
