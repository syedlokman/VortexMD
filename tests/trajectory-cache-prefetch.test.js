import { describe, it, expect, vi } from 'vitest';
import { RingBufferManager } from '../src/engine/trajectory.js';

function createMockComp(atomCount) {
    const coords = new Float32Array(atomCount * 3);
    return {
        structure: {
            getAtomData: () => ({ position: coords })
        },
        stage: { viewer: { container: null } }
    };
}

describe('RingBufferManager Cache Eviction and Direction-Aware Prefetching', () => {
    describe('Dynamic Memory Budget Cache Eviction', () => {
        it('retains frames beyond 50 MB when maxCacheBytes is configured higher', async () => {
            const atomCount = 100000; // 100,000 atoms * 3 * 4 = 1,200,000 bytes per frame (~1.144 MB)
            const frameCount = 100;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            // Set maxCacheBytes to 100 MB (over the old hardcoded 50 MB limit)
            manager.maxCacheBytes = 100 * 1024 * 1024;

            // Populate 48 frames: 48 * 1,200,000 = 57,600,000 bytes (~54.9 MB, > 50 MB but < 100 MB)
            for (let i = 0; i < 48; i++) {
                manager.frameBuffer.set(i, new Float32Array(atomCount * 3));
            }

            expect(manager.frameBuffer.size).toBe(48);

            // Request a cached frame (buffer hit)
            await manager.getFrameCoords(10);

            // With the old hardcoded 50MB check, 57.6 MB > 50 MB, so frameBuffer would evict a frame and size would be 47.
            // With maxCacheBytes = 100 MB, all 48 frames must be retained!
            expect(manager.frameBuffer.size).toBe(48);
        });

        it('evicts frames when active buffer bytes exceed maxCacheBytes', async () => {
            const atomCount = 100000; // 1.2 MB per frame
            const frameCount = 100;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            // Configure a smaller maxCacheBytes: 20 MB (~17 frames)
            manager.maxCacheBytes = 20 * 1024 * 1024;

            // Populate 25 frames (~30 MB, > 20 MB)
            for (let i = 0; i < 25; i++) {
                manager.frameBuffer.set(i, new Float32Array(atomCount * 3));
            }

            expect(manager.frameBuffer.size).toBe(25);

            await manager.getFrameCoords(10);

            // Should have evicted at least one frame since 30 MB > 20 MB
            expect(manager.frameBuffer.size).toBeLessThan(25);
        });

        it('evicts frames furthest from current playhead first (distance-based eviction)', () => {
            const atomCount = 10000; // 120 KB per frame
            const frameCount = 100;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null);
            // Budget allows ~10 frames (1.2 MB)
            manager.maxCacheBytes = 10 * atomCount * 3 * 4;

            // Current playhead is at frame 20 (e.g. playing in reverse from 30 down to 0)
            manager.currentFrame = 20;

            // Frame 0 is reference frame
            manager.frameBuffer.set(0, new Float32Array(atomCount * 3));
            // Frames near playhead: 18, 19, 20, 21, 22
            for (let f = 18; f <= 22; f++) {
                manager.frameBuffer.set(f, new Float32Array(atomCount * 3));
            }
            // Distant frames: 50, 60, 70, 80, 90
            for (const f of [50, 60, 70, 80, 90]) {
                manager.frameBuffer.set(f, new Float32Array(atomCount * 3));
            }

            // Simulate incoming chunk that triggers handleParsedCoords eviction
            const newChunkFrames = [new Float32Array(atomCount * 3), new Float32Array(atomCount * 3)];
            manager.handleParsedCoords(16, newChunkFrames, 'autoload', 5);

            // Frame 0 must never be evicted
            expect(manager.frameBuffer.has(0)).toBe(true);
            // Frames closest to playhead (20) must be retained
            expect(manager.frameBuffer.has(20)).toBe(true);
            expect(manager.frameBuffer.has(19)).toBe(true);
            expect(manager.frameBuffer.has(21)).toBe(true);

            // Frames furthest from playhead (90, 80, 70) must have been evicted first!
            expect(manager.frameBuffer.has(90)).toBe(false);
            expect(manager.frameBuffer.has(80)).toBe(false);
        });

        it('protects frames with pendingFrameListeners from being evicted during chunk insertions', () => {
            const atomCount = 10000;
            const frameCount = 100;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null);
            manager.maxCacheBytes = 5 * atomCount * 3 * 4; // tight budget: ~5 frames
            manager.currentFrame = 10;

            manager.frameBuffer.set(0, new Float32Array(atomCount * 3));
            manager.frameBuffer.set(10, new Float32Array(atomCount * 3));
            manager.frameBuffer.set(50, new Float32Array(atomCount * 3)); // distant frame
            manager.frameBuffer.set(80, new Float32Array(atomCount * 3)); // distant frame

            // Frame 80 is distant, but has a pending listener awaiting it!
            const mockListener = vi.fn();
            manager.pendingFrameListeners.set(80, new Set([mockListener]));

            // Add chunk frames
            const chunk = [new Float32Array(atomCount * 3), new Float32Array(atomCount * 3), new Float32Array(atomCount * 3)];
            manager.handleParsedCoords(11, chunk, 'autoload', 5);

            // Frame 80 must NOT be evicted because pendingFrameListeners has it protected
            expect(manager.frameBuffer.has(80)).toBe(true);
            // Frame 50 has no listener and is distant, so it was eligible for eviction
            expect(manager.frameBuffer.has(50)).toBe(false);
        });

    });

    describe('Direction-Aware Lookahead Prefetching', () => {
        it('triggers forward prefetch when lookahead buffer drops below threshold', async () => {
            const atomCount = 100;
            const frameCount = 200;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            const { fetchSize } = manager.getChunkParams();
            const lookaheadThreshold = fetchSize * 2;

            // Populate frames 0 through 15 (16 frames)
            for (let i = 0; i <= 15; i++) {
                manager.frameBuffer.set(i, new Float32Array(atomCount * 3));
            }

            const requestChunkSpy = vi.spyOn(manager, 'requestChunk').mockImplementation(() => {});

            // Playhead at frame 10: highestCachedFrame is 15.
            // (15 - 10) = 5 < lookaheadThreshold (e.g. 20 or 40).
            await manager.getFrameCoords(10);

            expect(requestChunkSpy).toHaveBeenCalled();
            // Should request chunk starting immediately after the highest cached frame
            expect(requestChunkSpy).toHaveBeenCalledWith(16);
        });

        it('does not trigger forward prefetch when lookahead buffer is above threshold', async () => {
            const atomCount = 100;
            const frameCount = 200;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            const { fetchSize } = manager.getChunkParams();
            const lookaheadThreshold = fetchSize * 2;

            // Populate enough frames ahead: frame 0 to frame 10 + lookaheadThreshold + 5
            const totalToPopulate = 10 + lookaheadThreshold + 5;
            for (let i = 0; i <= totalToPopulate; i++) {
                manager.frameBuffer.set(i, new Float32Array(atomCount * 3));
            }

            const requestChunkSpy = vi.spyOn(manager, 'requestChunk').mockImplementation(() => {});

            await manager.getFrameCoords(10);

            expect(requestChunkSpy).not.toHaveBeenCalled();
        });

        it('triggers backward prefetch when playbackDirection is backward and buffer drops below threshold', async () => {
            const atomCount = 100;
            const frameCount = 200;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            manager.playbackDirection = 'backward';
            const { fetchSize } = manager.getChunkParams();

            // Populate frames 45 through 60
            for (let i = 45; i <= 60; i++) {
                manager.frameBuffer.set(i, new Float32Array(atomCount * 3));
            }

            const requestChunkSpy = vi.spyOn(manager, 'requestChunk').mockImplementation(() => {});

            // Playhead at frame 48: lowestCachedFrame is 45.
            // (48 - 45) = 3 < lookaheadThreshold.
            await manager.getFrameCoords(48);

            expect(requestChunkSpy).toHaveBeenCalled();
            // Should request chunk starting at Math.max(0, 45 - fetchSize)
            const expectedStart = Math.max(0, 45 - fetchSize);
            expect(requestChunkSpy).toHaveBeenCalledWith(expectedStart);
        });

        it('triggers backward prefetch via options.direction or options.playbackDirection', async () => {
            const atomCount = 100;
            const frameCount = 200;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            const { fetchSize } = manager.getChunkParams();

            for (let i = 45; i <= 60; i++) {
                manager.frameBuffer.set(i, new Float32Array(atomCount * 3));
            }

            const requestChunkSpy = vi.spyOn(manager, 'requestChunk').mockImplementation(() => {});

            await manager.getFrameCoords(48, { direction: 'backward' });

            const expectedStart = Math.max(0, 45 - fetchSize);
            expect(requestChunkSpy).toHaveBeenCalledWith(expectedStart);
        });
    });

    describe('Queue Flooding Safeguards', () => {
        it('does not re-queue chunks already present in pendingChunkQueue or activeChunks', () => {
            const atomCount = 100;
            const frameCount = 200;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            const { fetchSize } = manager.getChunkParams();

            // Simulate active worker chunk job slots so queue is not immediately popped
            manager.activeChunkJobs = 2;
            expect(manager.activeChunkJobs).toBe(2);

            // Simulate an active chunk
            manager.activeChunks.add(20);

            // Attempt to request chunk at 20
            manager.requestChunk(20);
            expect(manager.pendingChunkQueue.some(t => t.chunkStart === 20)).toBe(false);

            // Simulate pending chunk
            manager.pendingChunkQueue.push({ chunkStart: 50, chunkEnd: 50 + fetchSize });
            const queueLenBefore = manager.pendingChunkQueue.length;

            // Attempt to re-request chunk at 50
            manager.requestChunk(50);
            expect(manager.pendingChunkQueue.length).toBe(queueLenBefore);
        });

        it('does not queue chunks when all frames are already cached in frameBuffer', () => {
            const atomCount = 100;
            const frameCount = 200;
            const offsets = new Array(frameCount + 1).fill(0).map((_, i) => i * 1000);
            const mockComp = createMockComp(atomCount);

            const manager = new RingBufferManager(null, offsets, atomCount, mockComp, null, null);
            manager.activeChunkJobs = 2;
            const { fetchSize } = manager.getChunkParams();

            // Cache all frames for chunk 30 to 30 + fetchSize
            for (let f = 30; f < 30 + fetchSize; f++) {
                manager.frameBuffer.set(f, new Float32Array(atomCount * 3));
            }

            manager.requestChunk(30);
            expect(manager.pendingChunkQueue.some(t => t.chunkStart === 30)).toBe(false);
        });
    });
});
