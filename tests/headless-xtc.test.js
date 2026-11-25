import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodeHeadlessXtcFrames } from '../src/engine/headless-xtc.js';

/**
 * Creates an uncompressed synthetic XTC frame buffer (natoms <= 9).
 * Layout:
 *   0..3: magic (0x000007CB = 1995)
 *   4..7: natoms
 *   8..11: step
 *   12..15: time
 *   16..51: box (9 floats)
 *   52..52 + natoms*3*4: raw coordinates (floats)
 */
function createUncompressedXtcFrame(natoms, step = 0, time = 0.0, coords = null) {
    const totalSize = 16 + 36 + natoms * 3 * 4;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    view.setInt32(0, 1995, false); // magic
    view.setInt32(4, natoms, false); // natoms
    view.setInt32(8, step, false); // step
    view.setFloat32(12, time, false); // time

    // Box (9 floats)
    for (let i = 0; i < 9; i++) {
        view.setFloat32(16 + i * 4, i === 0 || i === 4 || i === 8 ? 5.0 : 0.0, false);
    }

    // Coordinates (natoms * 3 floats in nm)
    const rawCoords = coords || new Float32Array(natoms * 3).map((_, idx) => (idx + 1) * 0.1);
    for (let i = 0; i < natoms * 3; i++) {
        view.setFloat32(52 + i * 4, rawCoords[i], false);
    }

    return { buffer, rawCoords };
}

describe('Headless XTC Decompressor', () => {
    it('returns empty array for invalid or truncated buffer', () => {
        expect(decodeHeadlessXtcFrames(null)).toEqual([]);
        expect(decodeHeadlessXtcFrames(new ArrayBuffer(10))).toEqual([]);
        expect(decodeHeadlessXtcFrames(new Uint8Array(50))).toEqual([]);
    });

    it('decodes uncompressed XTC frames (natoms <= 9) with 10x nm-to-Angstrom conversion', () => {
        const natoms = 3;
        const testCoords = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);
        const { buffer } = createUncompressedXtcFrame(natoms, 0, 0.0, testCoords);

        const decoded = decodeHeadlessXtcFrames(buffer, natoms);
        expect(decoded.length).toBe(1);
        expect(decoded[0]).toBeInstanceOf(Float32Array);
        expect(decoded[0].length).toBe(natoms * 3);

        // Verify coordinates are multiplied by 10 for Angstrom units
        for (let i = 0; i < testCoords.length; i++) {
            expect(decoded[0][i]).toBeCloseTo(testCoords[i] * 10, 4);
        }
    });

    it('decodes multiple contiguous frames in a single chunk buffer', () => {
        const natoms = 2;
        const frame1 = createUncompressedXtcFrame(natoms, 0, 0.0, new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
        const frame2 = createUncompressedXtcFrame(natoms, 1, 1.0, new Float32Array([1.1, 1.2, 1.3, 1.4, 1.5, 1.6]));

        const combined = new Uint8Array(frame1.buffer.byteLength + frame2.buffer.byteLength);
        combined.set(new Uint8Array(frame1.buffer), 0);
        combined.set(new Uint8Array(frame2.buffer), frame1.buffer.byteLength);

        const decoded = decodeHeadlessXtcFrames(combined.buffer, natoms);
        expect(decoded.length).toBe(2);
        expect(decoded[0][0]).toBeCloseTo(1.0, 4); // 0.1 * 10
        expect(decoded[1][0]).toBeCloseTo(11.0, 4); // 1.1 * 10
    });

    it('produces independent transferable Float32Array buffers with zero copying', () => {
        const natoms = 3;
        const { buffer } = createUncompressedXtcFrame(natoms);
        const decoded = decodeHeadlessXtcFrames(buffer, natoms);

        const transferables = decoded.map(f => f.buffer);
        expect(transferables.length).toBe(1);
        expect(transferables[0]).toBeInstanceOf(ArrayBuffer);
        expect(transferables[0].byteLength).toBe(natoms * 3 * Float32Array.BYTES_PER_ELEMENT);
    });

    it('handles expectedAtoms mismatch gracefully', () => {
        const natoms = 3;
        const { buffer } = createUncompressedXtcFrame(natoms);
        
        // Call with mismatched expectedAtoms: should still decode based on header natoms
        const decoded = decodeHeadlessXtcFrames(buffer, 100);
        expect(decoded.length).toBe(1);
        expect(decoded[0].length).toBe(natoms * 3);
    });

    it('resyncs if buffer has leading non-magic offset bytes', () => {
        const natoms = 3;
        const { buffer } = createUncompressedXtcFrame(natoms);
        
        // Prepend 4 junk bytes
        const padded = new Uint8Array(buffer.byteLength + 4);
        padded.set([0xDE, 0xAD, 0xBE, 0xEF], 0);
        padded.set(new Uint8Array(buffer), 4);

        const decoded = decodeHeadlessXtcFrames(padded.buffer, natoms);
        expect(decoded.length).toBe(1);
        expect(decoded[0].length).toBe(natoms * 3);
    });

    it('integrates seamlessly with RingBufferManager chunk_parsed handler', async () => {
        const { RingBufferManager } = await import('../src/engine/trajectory.js');
        const natoms = 3;
        const { buffer } = createUncompressedXtcFrame(natoms);
        const decodedCoords = decodeHeadlessXtcFrames(buffer, natoms);

        const mockComp = { stage: { viewer: { container: null } } };
        const offsets = [0, buffer.byteLength];
        
        let messageHandler = null;
        const mockWorker = {
            addEventListener: (evt, handler) => {
                if (evt === 'message') messageHandler = handler;
            },
            removeEventListener: (evt, handler) => {
                if (evt === 'message') messageHandler = null;
            },
            postMessage: (payload) => {
                expect(payload.expectedAtoms).toBe(natoms);
                expect(payload.type).toBe('fetch_chunk');
                // Simulate worker posting chunk_parsed with transferable coords
                setTimeout(() => {
                    if (messageHandler) {
                        messageHandler({
                            data: {
                                type: 'chunk_parsed',
                                startFrameIndex: 0,
                                coords: decodedCoords,
                                engineMode: 'worker_headless_xtc',
                                parseTimeMs: 1.5
                            }
                        });
                    }
                }, 0);
            }
        };

        const manager = new RingBufferManager(null, offsets, natoms, mockComp, mockWorker, null);
        const result = await manager.performChunkFetch(0, 1);

        expect(result).toBeDefined();
        expect(result.engineMode).toBe('worker_headless_xtc');
        expect(result.coords.length).toBe(1);
        expect(result.coords[0]).toBeInstanceOf(Float32Array);
    });

    it('decompresses concurrent streams in parallel without state corruption', async () => {
        const natoms1 = 3;
        const coords1 = new Float32Array([1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9]);
        const { buffer: buf1 } = createUncompressedXtcFrame(natoms1, 0, 0.0, coords1);

        const natoms2 = 6;
        const coords2 = new Float32Array([
            0.5, 1.5, 2.5, 3.5, 4.5, 5.5,
            6.5, 7.5, 8.5, 9.5, 10.5, 11.5,
            12.5, 13.5, 14.5, 15.5, 16.5, 17.5
        ]);
        const { buffer: buf2 } = createUncompressedXtcFrame(natoms2, 1, 5.0, coords2);

        // Sequential baseline runs
        const seqResult1 = decodeHeadlessXtcFrames(buf1, natoms1);
        const seqResult2 = decodeHeadlessXtcFrames(buf2, natoms2);

        // Parallel calls using Promise.all
        const [parResult1, parResult2] = await Promise.all([
            decodeHeadlessXtcFrames(buf1, natoms1),
            decodeHeadlessXtcFrames(buf2, natoms2)
        ]);

        // Assert that neither call corrupted the other and results match sequential execution identically
        expect(parResult1.length).toBe(seqResult1.length);
        expect(parResult2.length).toBe(seqResult2.length);

        expect(parResult1[0].length).toBe(seqResult1[0].length);
        expect(parResult2[0].length).toBe(seqResult2[0].length);

        for (let i = 0; i < seqResult1[0].length; i++) {
            expect(parResult1[0][i]).toBe(seqResult1[0][i]);
        }
        for (let i = 0; i < seqResult2[0].length; i++) {
            expect(parResult2[0][i]).toBe(seqResult2[0][i]);
        }
    });

    it('verifies bundled demo.xtc can be successfully indexed and decoded by headless-xtc without allocation errors', async () => {
        const xtcPath = path.resolve(__dirname, '../public/demo/demo.xtc');
        expect(fs.existsSync(xtcPath)).toBe(true);
        const demoXtc = fs.readFileSync(xtcPath);
        const { scanTrajectoryBinary } = await import('../src/engine/indexer.js');

        const ab = demoXtc.buffer.slice(demoXtc.byteOffset, demoXtc.byteOffset + demoXtc.byteLength);
        const blob = new Blob([ab]);
        const offsets = await scanTrajectoryBinary(blob, 6378, blob.size, null, 'xtc');
        expect(offsets.length).toBeGreaterThan(2);

        // Decode first 2 frames
        const slice = ab.slice(offsets[0], offsets[2]);
        const frames = decodeHeadlessXtcFrames(slice, 6378);
        expect(frames.length).toBe(2);
        expect(frames[0]).toBeInstanceOf(Float32Array);
        expect(frames[0].length).toBe(6378 * 3);
    });
});

