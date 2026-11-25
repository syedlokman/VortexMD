import { describe, it, expect, vi } from 'vitest';
import * as NGL from 'ngl';
import { RingBufferManager } from '../src/engine/trajectory.js';
import { VortexMD } from '../src/engine/vortexmd.js';
import { PlaybackController } from '../src/engine/playback.js';

describe('Superposition Index Caching & Cache Invalidation', () => {
    function createMockStructure(atomCount = 100, indicesToReturn = [1, 5, 10, 20]) {
        const getAtomIndices = vi.fn((selection) => {
            const query = selection?.string || selection;
            if (query === 'protein and .CA') {
                return indicesToReturn;
            }
            if (query === 'nucleic and .P') {
                return [2, 6, 12];
            }
            if (query === 'custom.query') {
                return [42, 43, 44];
            }
            return [];
        });

        return {
            atomCount,
            getAtomIndices,
            getAtomData: () => ({ position: new Float32Array(atomCount * 3) })
        };
    }

    function createMockComp(structure) {
        return {
            structure,
            stage: { viewer: { container: null } }
        };
    }

    it('initializes superposeIndices and customSuperposeQuery to null in constructor', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const offsets = [0, 100];
        const manager = new RingBufferManager(null, offsets, 100, mockComp, null, null);

        expect(manager.superposeIndices).toBeNull();
        expect(manager.customSuperposeQuery).toBeNull();
    });

    it('computes indices on first invocation and caches reference on subsequent calls without re-querying structure', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const offsets = [0, 100];
        const manager = new RingBufferManager(null, offsets, 100, mockComp, null, null);

        expect(typeof manager.getSuperposeIndices).toBe('function');

        const indicesFirst = manager.getSuperposeIndices();
        expect(indicesFirst).toEqual([1, 5, 10, 20]);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);

        // Subsequent calls must return cached reference without calling getAtomIndices again
        const indicesSecond = manager.getSuperposeIndices();
        expect(indicesSecond).toBe(indicesFirst);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);

        const indicesThird = manager.getSuperposeIndices();
        expect(indicesThird).toBe(indicesFirst);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);
    });

    it('falls back to nucleic and .P when protein and .CA yields no atoms', () => {
        const mockStructure = {
            atomCount: 50,
            getAtomIndices: vi.fn((selection) => {
                if (selection?.string === 'protein and .CA') return [];
                if (selection?.string === 'nucleic and .P') return [3, 7, 11];
                return [];
            }),
            getAtomData: () => ({ position: new Float32Array(150) })
        };
        const mockComp = createMockComp(mockStructure);
        const manager = new RingBufferManager(null, [0, 100], 50, mockComp, null, null);

        const indices = manager.getSuperposeIndices();
        expect(indices).toEqual([3, 7, 11]);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(2);

        // Cached on subsequent call
        const indices2 = manager.getSuperposeIndices();
        expect(indices2).toBe(indices);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(2);
    });

    it('falls back to uniform step sampling when both selections yield empty', () => {
        const mockStructure = {
            atomCount: 10,
            getAtomIndices: vi.fn(() => []),
            getAtomData: () => ({ position: new Float32Array(30) })
        };
        const mockComp = createMockComp(mockStructure);
        const manager = new RingBufferManager(null, [0, 100], 10, mockComp, null, null);

        const indices = manager.getSuperposeIndices();
        expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

        const indices2 = manager.getSuperposeIndices();
        expect(indices2).toBe(indices);
    });

    it('uses customSuperposeQuery when specified and does not fallback to nucleic', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const manager = new RingBufferManager(null, [0, 100], 100, mockComp, null, null);

        manager.customSuperposeQuery = 'custom.query';
        const indices = manager.getSuperposeIndices();
        expect(indices).toEqual([42, 43, 44]);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);
        expect(mockStructure.getAtomIndices.mock.calls[0][0].string).toBe('custom.query');
    });

    it('invalidates cache when customSuperposeQuery changes and forces re-evaluation', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const manager = new RingBufferManager(null, [0, 100], 100, mockComp, null, null);

        const initial = manager.getSuperposeIndices();
        expect(initial).toEqual([1, 5, 10, 20]);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);

        // Change customSuperposeQuery and invalidate cache
        manager.customSuperposeQuery = 'custom.query';
        manager.superposeIndices = null;

        const updated = manager.getSuperposeIndices();
        expect(updated).toEqual([42, 43, 44]);
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(2);
    });

    it('clears superposeIndices and customSuperposeQuery when dispose() is called', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const manager = new RingBufferManager(null, [0, 100], 100, mockComp, null, null);

        manager.customSuperposeQuery = 'custom.query';
        manager.getSuperposeIndices();
        expect(manager.superposeIndices).not.toBeNull();

        manager.dispose();
        expect(manager.superposeIndices).toBeNull();
        expect(manager.customSuperposeQuery).toBeNull();
    });

    it('passes cached superposeIndices into superposeCoordinates during getFrameCoords', async () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const manager = new RingBufferManager(null, [0, 100, 200], 100, mockComp, null, null);

        // Seed frame 0 and frame 1
        const f0 = new Float32Array(300).fill(1);
        const f1 = new Float32Array(300).fill(2);
        manager.frameBuffer.set(0, f0);
        manager.frameBuffer.set(1, f1);

        // Frame 0 setup
        await manager.getFrameCoords(0);
        expect(manager.initialCoords).toBeDefined();

        // Spy on getSuperposeIndices
        const spy = vi.spyOn(manager, 'getSuperposeIndices');

        // Request frame 1 with superpose: true
        await manager.getFrameCoords(1, { superpose: true });
        expect(spy).toHaveBeenCalled();
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);

        // Request frame 1 again with superpose: true
        await manager.getFrameCoords(1, { superpose: true });
        // Structure query count must still be 1 because indices were cached!
        expect(mockStructure.getAtomIndices).toHaveBeenCalledTimes(1);
    });

    it('handles cache invalidation and query updates in VortexMD.setSuperpose', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const ringBuffer = new RingBufferManager(null, [0, 100], 100, mockComp, null, null);

        const mockPlayer = {
            superpose: false,
            superposeIndices: null,
            customSuperposeQuery: null,
            ringBuffer,
            _currentFrame: 0,
            subframe: 0,
            renderFrame: vi.fn()
        };
        mockPlayer.playbackController = new PlaybackController(mockPlayer);

        // Prime cache
        ringBuffer.getSuperposeIndices?.();

        // Call setSuperpose with new query
        mockPlayer.playbackController.setSuperpose(true, 'custom.query');
        expect(mockPlayer.ringBuffer.customSuperposeQuery).toBe('custom.query');
        expect(mockPlayer.ringBuffer.superposeIndices).toBeNull();

        // Calling setSuperpose without custom query should not invalidate cache once computed
        mockPlayer.ringBuffer.superposeIndices = [42, 43, 44];
        mockPlayer.playbackController.setSuperpose(true);
        // Cached indices should still be retained
        expect(mockPlayer.ringBuffer.superposeIndices).toEqual([42, 43, 44]);
    });

    it('resets cached superposition indices in VortexMD.clear()', () => {
        const mockStructure = createMockStructure();
        const mockComp = createMockComp(mockStructure);
        const ringBuffer = new RingBufferManager(null, [0, 100], 100, mockComp, null, null);

        const mockPlayer = {
            pause: vi.fn(),
            dispatchEvent: vi.fn(),
            sessionManager: null,
            workerManager: null,
            ringBuffer,
            superposeIndices: [1, 2, 3],
            customSuperposeQuery: 'protein and .CA',
            fileOffsets: [],
            clear: VortexMD.prototype.clear
        };

        mockPlayer.clear();
        expect(mockPlayer.superposeIndices).toBeNull();
        expect(mockPlayer.customSuperposeQuery).toBeNull();
        expect(mockPlayer.ringBuffer).toBeNull();
    });
});
