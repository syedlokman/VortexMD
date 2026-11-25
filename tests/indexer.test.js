import { describe, it, expect, vi } from 'vitest';
import { scanTrajectoryBinary, validateXtcHeader, computeDeltaTimeAndCalibration } from '../src/engine/indexer.js';

/**
 * Creates a synthetic XTC frame buffer in memory.
 * Header layout:
 *   0..3: magic 0x000007CB
 *   4..7: natoms (uint32)
 *   8..11: step (uint32)
 *   12..15: time (float32)
 *   16..51: box 3x3 floats (vxx=16..19, vyy=32..35, vzz=48..51)
 *   52..87: unused header fields
 *   88..91: lsize (uint32)
 *   92..92+paddedLsize: payload
 */
function createSyntheticXtcFrame(natoms, step, time, lsize, overrides = {}) {
    const paddedLsize = (lsize + 3) & ~3;
    const totalFrameSize = 88 + 4 + paddedLsize; // 92 + paddedLsize
    const buffer = new ArrayBuffer(totalFrameSize);
    const view = new DataView(buffer);

    // Magic
    view.setUint32(0, overrides.magic !== undefined ? overrides.magic : 0x000007CB, false);
    // natoms
    view.setUint32(4, overrides.natoms !== undefined ? overrides.natoms : natoms, false);
    // step
    view.setUint32(8, overrides.step !== undefined ? overrides.step : step, false);
    // time
    view.setFloat32(12, overrides.time !== undefined ? overrides.time : time, false);
    // Box diagonals
    view.setFloat32(16, overrides.vxx !== undefined ? overrides.vxx : 50.0, false); // vxx
    view.setFloat32(32, overrides.vyy !== undefined ? overrides.vyy : 50.0, false); // vyy
    view.setFloat32(48, overrides.vzz !== undefined ? overrides.vzz : 50.0, false); // vzz
    // lsize
    view.setUint32(88, lsize, false);

    return buffer;
}

describe('scanTrajectoryBinary', () => {
    it('scans synthetic XTC frame offsets correctly', async () => {
        const f1 = createSyntheticXtcFrame(100, 0, 0.0, 30);
        const blob = new Blob([f1]);
        const offsets = await scanTrajectoryBinary(blob, 100, f1.byteLength, null, 'xtc');
        expect(offsets[0]).toBe(0);
        expect(offsets[offsets.length - 1]).toBe(f1.byteLength);
    });

    it('correctly calculates bitwise 4-byte padding length', () => {
        const testCases = [
            { lsize: 10, expectedPadded: 12 },
            { lsize: 12, expectedPadded: 12 },
            { lsize: 13, expectedPadded: 16 },
            { lsize: 0, expectedPadded: 0 },
            { lsize: 1, expectedPadded: 4 }
        ];

        for (const tc of testCases) {
            const padded = (tc.lsize + 3) & ~3;
            expect(padded).toBe(tc.expectedPadded);
        }
    });

    it('indexes single and multiple synthetic XTC frames from a Blob', async () => {
        const f1 = createSyntheticXtcFrame(100, 0, 0.0, 30);
        const f2 = createSyntheticXtcFrame(100, 1, 1.0, 30);
        const f3 = createSyntheticXtcFrame(100, 2, 2.0, 30);

        const totalLength = f1.byteLength + f2.byteLength + f3.byteLength;
        const combined = new Uint8Array(totalLength);
        combined.set(new Uint8Array(f1), 0);
        combined.set(new Uint8Array(f2), f1.byteLength);
        combined.set(new Uint8Array(f3), f1.byteLength + f2.byteLength);

        const blob = new Blob([combined]);
        const offsets = await scanTrajectoryBinary(blob, 100, combined.length, null, 'xtc');

        expect(offsets.length).toBe(4); // 3 frame offsets + 1 total length end offset
        expect(offsets[0]).toBe(0);
        expect(offsets[1]).toBe(f1.byteLength);
        expect(offsets[2]).toBe(f1.byteLength + f2.byteLength);
        expect(offsets[3]).toBe(combined.length);
        expect(Array.isArray(offsets)).toBe(true);
        expect(offsets.detectedDeltaTime).toBe(1.0);
        expect(offsets.isTimeCalibrated).toBe(true);
        expect(offsets.frameTimes).toBeInstanceOf(Float32Array);
        expect(offsets.frameTimes.length).toBe(3);
        expect(offsets.frameTimes[0]).toBeCloseTo(0.0);
        expect(offsets.frameTimes[1]).toBeCloseTo(1.0);
        expect(offsets.frameTimes[2]).toBeCloseTo(2.0);
    });

    it('computes median delta time and handles non-equidistant or irregular trajectories', () => {
        const irregularTimes = new Float32Array([0.0, 10.0, 20.0, 50.0, 60.0]);
        const { detectedDeltaTime, isTimeCalibrated } = computeDeltaTimeAndCalibration(irregularTimes);
        expect(isTimeCalibrated).toBe(true);
        expect(detectedDeltaTime).toBe(10.0); // median of [10, 10, 30, 10] is 10.0

        const singleTime = new Float32Array([0.0]);
        const resSingle = computeDeltaTimeAndCalibration(singleTime);
        expect(resSingle.isTimeCalibrated).toBe(false);
        expect(resSingle.detectedDeltaTime).toBe(100.0);
    });

    it('accurately preserves sub-picosecond timesteps with high precision', async () => {
        const firstFrameTime = 0.0;
        const secondFrameTime = 0.002;
        const f1 = createSyntheticXtcFrame(100, 0, firstFrameTime, 30);
        const f2 = createSyntheticXtcFrame(100, 1, secondFrameTime, 30);

        const totalLength = f1.byteLength + f2.byteLength;
        const combined = new Uint8Array(totalLength);
        combined.set(new Uint8Array(f1), 0);
        combined.set(new Uint8Array(f2), f1.byteLength);

        const blob = new Blob([combined]);
        const offsets = await scanTrajectoryBinary(blob, 100, combined.length, null, 'xtc');

        expect(offsets.detectedDeltaTime).toBeDefined();
        expect(offsets.detectedDeltaTime).not.toBeNaN();
        expect(offsets.detectedDeltaTime).toBe(0.002);
    });

    it('enforces 5-field XDR header validation', async () => {
        const natoms = 100;
        // Valid frame
        const f1 = createSyntheticXtcFrame(natoms, 0, 0.0, 20);
        // Invalid natoms
        const fBadAtoms = createSyntheticXtcFrame(natoms, 1, 1.0, 20, { natoms: 999 });
        // Invalid step regression
        const fBadStep = createSyntheticXtcFrame(natoms, 0, 2.0, 20, { step: 0 }); // step regression if step < prevStep
        // Invalid box diagonal
        const fBadBox = createSyntheticXtcFrame(natoms, 2, 2.0, 20, { vxx: -5.0 });
        // Valid second frame
        const f2 = createSyntheticXtcFrame(natoms, 1, 1.0, 20);

        const totalLength = f1.byteLength + f2.byteLength;
        const combined = new Uint8Array(totalLength);
        combined.set(new Uint8Array(f1), 0);
        combined.set(new Uint8Array(f2), f1.byteLength);

        const blob = new Blob([combined]);
        const offsets = await scanTrajectoryBinary(blob, natoms, combined.length, null, 'xtc');

        expect(offsets.length).toBe(3); // f1, f2, and end
        expect(offsets[0]).toBe(0);
        expect(offsets[1]).toBe(f1.byteLength);

        // Test rejecting bad magic
        const fBadMagic = createSyntheticXtcFrame(natoms, 0, 0.0, 20, { magic: 0x12345678 });
        const blobBadMagic = new Blob([fBadMagic]);
        const offsetsBadMagic = await scanTrajectoryBinary(blobBadMagic, natoms, fBadMagic.byteLength, null, 'xtc');
        expect(offsetsBadMagic.length).toBe(2); // 0 and end offset

        // Test rejecting bad lsize (< minPayload or > maxPayload)
        const fBadLsizeMin = createSyntheticXtcFrame(natoms, 0, 0.0, 0);
        const blobBadLsizeMin = new Blob([fBadLsizeMin]);
        const offsetsBadLsizeMin = await scanTrajectoryBinary(blobBadLsizeMin, natoms, fBadLsizeMin.byteLength, null, 'xtc');
        expect(offsetsBadLsizeMin.length).toBe(2);

        const fBadLsizeMax = createSyntheticXtcFrame(natoms, 0, 0.0, 50000);
        const blobBadLsizeMax = new Blob([fBadLsizeMax]);
        const offsetsBadLsizeMax = await scanTrajectoryBinary(blobBadLsizeMax, natoms, fBadLsizeMax.byteLength, null, 'xtc');
        expect(offsetsBadLsizeMax.length).toBe(2);
    });

    it('handles carryover correctly when a frame payload extends past chunk boundary', async () => {
        const natoms = 10;
        const f1 = createSyntheticXtcFrame(natoms, 0, 0.0, 20);
        const f2 = createSyntheticXtcFrame(natoms, 1, 0.1, 20);

        const combined = new Uint8Array(f1.byteLength + f2.byteLength);
        combined.set(new Uint8Array(f1), 0);
        combined.set(new Uint8Array(f2), f1.byteLength);

        const file = new Blob([combined]);
        const offsets = await scanTrajectoryBinary(file, natoms, combined.length, null, 'xtc');

        expect(offsets[0]).toBe(0);
        expect(offsets[1]).toBe(f1.byteLength);
        expect(offsets[offsets.length - 1]).toBe(combined.length);
    });

    it('does not push truncated trailing frame when frameEnd exceeds fileSize', async () => {
        const natoms = 100;
        const f1 = createSyntheticXtcFrame(natoms, 0, 0.0, 40);
        const f2 = createSyntheticXtcFrame(natoms, 1, 1.0, 40);

        // Truncate f2 so only header + partial payload (95 bytes instead of 132) is included
        const truncatedF2 = f2.slice(0, 95);
        const combined = new Uint8Array(f1.byteLength + truncatedF2.byteLength);
        combined.set(new Uint8Array(f1), 0);
        combined.set(new Uint8Array(truncatedF2), f1.byteLength);

        const file = new Blob([combined]);
        const offsets = await scanTrajectoryBinary(file, natoms, combined.length, null, 'xtc');

        // Only frame 0 should be indexed (plus final EOF offset)
        expect(offsets[0]).toBe(0);
        expect(offsets[offsets.length - 1]).toBe(combined.length);
        // Ensure frame 1 (offset at f1.byteLength) was NOT pushed as a frame
        expect(offsets.length).toBe(2); // [0, combined.length]
    });
});

describe('RingBufferManager trajectory error handling', () => {
    it('handles chunk_error with retry and triggers handleUnrecoverableChunkFailure when max retries exceeded', async () => {
        vi.useFakeTimers();
        try {
            const { RingBufferManager } = await import('../src/engine/trajectory.js');
            const mockComp = {
                stage: { viewer: { container: null } }
            };
            const offsets = [0, 100, 200];
            const manager = new RingBufferManager(null, offsets, 10, mockComp, null, null);

            let attempts = 0;
            manager.performChunkFetch = async () => {
                attempts++;
                return { type: 'chunk_error', error: '429 Too Many Requests' };
            };

            const task = { chunkStart: 0, chunkEnd: 1 };
            const retryPromise = manager.fetchChunkWithRetry(task, 0);
            await vi.runAllTimersAsync();
            await retryPromise;

            expect(attempts).toBe(4); // initial attempt (0) + 3 retries (1, 2, 3)
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('validateXtcHeader unified binary validator', () => {
    it('validates a standard synthetic XTC header and extracts fields correctly', () => {
        const frameBuf = createSyntheticXtcFrame(100, 5, 2.5, 40);
        const view = new DataView(frameBuf);
        const result = validateXtcHeader(view, 0, 100);

        expect(result).not.toBeNull();
        expect(result.valid).toBe(true);
        expect(result.natoms).toBe(100);
        expect(result.step).toBe(5);
        expect(result.time).toBeCloseTo(2.5);
        expect(result.box).toEqual([50.0, 50.0, 50.0]);
        expect(result.isBoxValid).toBe(true);
        expect(result.lsize).toBe(40);
        expect(result.totalFrameBytes).toBe(92 + 40);
    });

    it('rejects header with invalid magic number', () => {
        const frameBuf = createSyntheticXtcFrame(100, 0, 0.0, 40, { magic: 0x12345678 });
        const view = new DataView(frameBuf);
        expect(validateXtcHeader(view, 0, 100)).toBeNull();
    });

    it('rejects header when natoms does not match expectedAtoms', () => {
        const frameBuf = createSyntheticXtcFrame(100, 0, 0.0, 40);
        const view = new DataView(frameBuf);
        expect(validateXtcHeader(view, 0, 200)).toBeNull();
    });

    it('rejects negative or decreasing time when monotonic time is enforced', () => {
        const frameBufNegative = createSyntheticXtcFrame(100, 1, -1.0, 40);
        const viewNeg = new DataView(frameBufNegative);
        expect(validateXtcHeader(viewNeg, 0, 100)).toBeNull();

        const frameBufDecreasing = createSyntheticXtcFrame(100, 1, 5.0, 40);
        const viewDec = new DataView(frameBufDecreasing);
        expect(validateXtcHeader(viewDec, 0, 100, { prevTime: 10.0 })).toBeNull();
    });

    it('rejects non-positive box diagonals when validateBox is enabled', () => {
        const frameBufBadBox = createSyntheticXtcFrame(100, 0, 0.0, 40, { vxx: -5.0 });
        const viewBad = new DataView(frameBufBadBox);
        expect(validateXtcHeader(viewBad, 0, 100, { validateBox: true })).toBeNull();

        const headerAllowed = validateXtcHeader(viewBad, 0, 100, { validateBox: false });
        expect(headerAllowed).not.toBeNull();
        expect(headerAllowed.isBoxValid).toBe(false);
    });

    it('enforces payload bounds and rejects out-of-range lsize', () => {
        const frameBufSmall = createSyntheticXtcFrame(100, 0, 0.0, 2); // < 4
        const viewSmall = new DataView(frameBufSmall);
        expect(validateXtcHeader(viewSmall, 0, 100)).toBeNull();

        const frameBufHuge = createSyntheticXtcFrame(100, 0, 0.0, 20000); // > 100 * 12 + 1024 = 2224
        const viewHuge = new DataView(frameBufHuge);
        expect(validateXtcHeader(viewHuge, 0, 100)).toBeNull();
    });
});

describe('VortexMD startIndexing worker reply handling', () => {
    it('handles worker (err, data) done and error replies and emits lifecycle events', async () => {
        const { VortexMD } = await import('../src/engine/vortexmd.js');
        const player = Object.create(VortexMD.prototype);
        const emitted = [];
        player.emit = (type, detail) => emitted.push({ type, detail });
        player.notify = () => {};
        player.initBufferPipeline = () => {};
        player.renderFrame = () => {};
        player._currentFrame = 0;
        player.subframe = 0;
        player._deltaTime = 100;
        player._timeOffset = 0;
        player.xtcFile = null;
        player.trajectoryFingerprint = null;

        let capturedReply = null;
        player.workerManager = {
            getNextWorker: () => ({
                post: (_payload, _transfer, cb) => {
                    capturedReply = cb;
                    return Promise.resolve();
                }
            })
        };

        let doneFrames = 0;
        await player.startIndexing(100, { type: 'index', fileSize: 500, ext: 'xtc' }, null, (n) => { doneFrames = n; });
        expect(typeof capturedReply).toBe('function');

        capturedReply(null, {
            type: 'done',
            offsets: [0, 250, 500],
            frameTimes: new Float32Array([0, 50]),
            detectedDeltaTime: 50,
            isTimeCalibrated: true
        });

        expect(doneFrames).toBe(2);
        expect(player.fileOffsets).toEqual([0, 250, 500]);
        expect(player.deltaTime).toBe(50);
        expect(emitted.some(e => e.type === 'indexing-complete' && e.detail.totalFrames === 2)).toBe(true);

        await player.startIndexing(100, { type: 'index', fileSize: 500, ext: 'xtc' });
        capturedReply(new Error('Corrupt XTC stream'));
        expect(emitted.some(e => e.type === 'indexing-failed' && e.detail.error.includes('Corrupt XTC stream'))).toBe(true);
    });
});


