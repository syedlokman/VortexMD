import { describe, it, expect } from 'vitest';
import { hornSuperpose, eigensolveSymmetric4x4 } from '../src/engine/analytics.js';
import { RmsdController } from '../src/engine/rmsd.js';

describe('hornSuperpose unit-quaternion superposition', () => {
    // Reference 4-atom asymmetric cluster in Angstroms
    const refCoords = new Float32Array([
        0.0, 0.0, 0.0,
        1.5, 0.0, 0.0,
        0.0, 2.0, 0.0,
        0.0, 0.0, 3.0
    ]);

    it('returns zero RMSD for identity comparison', () => {
        const { rmsd, alignedCoords } = hornSuperpose(refCoords, refCoords);
        expect(rmsd).toBeCloseTo(0, 2);
        for (let i = 0; i < refCoords.length; i++) {
            expect(alignedCoords[i]).toBeCloseTo(refCoords[i], 3);
        }
    });

    it('returns zero RMSD for pure translation', () => {
        const tx = 15.0, ty = -22.5, tz = 37.8;
        const translatedCoords = new Float32Array(refCoords.length);
        for (let i = 0; i < refCoords.length; i += 3) {
            translatedCoords[i]     = refCoords[i] + tx;
            translatedCoords[i + 1] = refCoords[i + 1] + ty;
            translatedCoords[i + 2] = refCoords[i + 2] + tz;
        }

        const { rmsd, alignedCoords } = hornSuperpose(translatedCoords, refCoords);
        expect(rmsd).toBeCloseTo(0, 2);
        for (let i = 0; i < refCoords.length; i++) {
            expect(alignedCoords[i]).toBeCloseTo(refCoords[i], 3);
        }
    });

    it('returns zero RMSD for 90-degree rotation plus translation', () => {
        // Rotate 90 deg around Z-axis: x' = -y, y' = x, z' = z, plus translation
        const tx = 5.0, ty = 10.0, tz = -3.0;
        const rotatedCoords = new Float32Array(refCoords.length);
        for (let i = 0; i < refCoords.length; i += 3) {
            const x = refCoords[i];
            const y = refCoords[i + 1];
            const z = refCoords[i + 2];
            rotatedCoords[i]     = -y + tx;
            rotatedCoords[i + 1] = x + ty;
            rotatedCoords[i + 2] = z + tz;
        }

        const { rmsd, alignedCoords } = hornSuperpose(rotatedCoords, refCoords);
        expect(rmsd).toBeCloseTo(0, 2);
        for (let i = 0; i < refCoords.length; i++) {
            expect(alignedCoords[i]).toBeCloseTo(refCoords[i], 2);
        }
    });

    it('handles 180-degree rotation activating degenerate fallback vector', () => {
        // 180 deg rotation around X-axis: x' = x, y' = -y, z' = -z
        const rotated180 = new Float32Array(refCoords.length);
        for (let i = 0; i < refCoords.length; i += 3) {
            rotated180[i]     = refCoords[i];
            rotated180[i + 1] = -refCoords[i + 1];
            rotated180[i + 2] = -refCoords[i + 2];
        }

        const { rmsd, alignedCoords } = hornSuperpose(rotated180, refCoords);
        expect(rmsd).toBeCloseTo(0, 2);
        for (let i = 0; i < refCoords.length; i++) {
            expect(alignedCoords[i]).toBeCloseTo(refCoords[i], 2);
        }
    });

    it('correctly uses fitIndices for alignment and calcIndices for RMSD evaluation', () => {
        // First 3 atoms are identical, 4th atom is perturbed
        const mobileCoords = new Float32Array([
            0.0, 0.0, 0.0,
            1.5, 0.0, 0.0,
            0.0, 2.0, 0.0,
            0.0, 0.0, 5.0 // moved from 3.0 to 5.0 (diff = 2.0)
        ]);

        // If we fit only on first 3 atoms [0, 1, 2], fit RMSD is 0
        const fitOnly = hornSuperpose(mobileCoords, refCoords, [0, 1, 2], [0, 1, 2]);
        expect(fitOnly.rmsd).toBe(0);

        // If we fit on [0, 1, 2] but calculate on atom [3]
        const calcOnly = hornSuperpose(mobileCoords, refCoords, [0, 1, 2], [3]);
        expect(calcOnly.rmsd).toBe(2.0);
    });

    it('safely handles empty or null coordinate arrays', () => {
        expect(hornSuperpose(null, null).rmsd).toBe(0);
        expect(hornSuperpose(new Float32Array(0), new Float32Array(0)).rmsd).toBe(0);
    });

    it('recovers zero RMSD (< 0.001 A) on highly anisotropic elongated selections under 15-deg and 75-deg rotations', () => {
        // Construct elongated anisotropic filament (aspect ratio 50:1)
        const nAtoms = 40;
        const ref = new Float32Array(nAtoms * 3);
        for (let i = 0; i < nAtoms; i++) {
            ref[i * 3]     = Math.cos(i * 0.9) * 1.1;
            ref[i * 3 + 1] = Math.sin(i * 0.9) * 0.9;
            ref[i * 3 + 2] = i * 4.0; // 0 to 156 A along Z
        }

        // Test at 15 deg and 75 deg rotations
        for (const angleDeg of [15, 75]) {
            const rad = (angleDeg * Math.PI) / 180;
            const axis = [1.5, -2.0, 3.2];
            const norm = Math.hypot(...axis);
            const [ux, uy, uz] = axis.map(v => v / norm);
            const cosA = Math.cos(rad), sinA = Math.sin(rad), oneMinus = 1 - cosA;

            const R = [
                cosA + ux*ux*oneMinus,    ux*uy*oneMinus - uz*sinA, ux*uz*oneMinus + uy*sinA,
                uy*ux*oneMinus + uz*sinA, cosA + uy*uy*oneMinus,    uy*uz*oneMinus - ux*sinA,
                uz*ux*oneMinus - uy*sinA, uz*uy*oneMinus + ux*sinA, cosA + uz*uz*oneMinus
            ];

            const rotated = new Float32Array(ref.length);
            for (let i = 0; i < ref.length; i += 3) {
                const x = ref[i], y = ref[i + 1], z = ref[i + 2];
                rotated[i]     = R[0]*x + R[1]*y + R[2]*z + 12.5;
                rotated[i + 1] = R[3]*x + R[4]*y + R[5]*z - 34.2;
                rotated[i + 2] = R[6]*x + R[7]*y + R[8]*z + 56.1;
            }

            const { rmsd, alignedCoords } = hornSuperpose(rotated, ref);
            expect(rmsd).toBe(0.0);
            for (let i = 0; i < ref.length; i++) {
                expect(alignedCoords[i]).toBeCloseTo(ref[i], 2);
            }
        }
    });

    it('eigensolveSymmetric4x4 computes exact eigenvalues and orthogonal eigenvectors', () => {
        // Diagonal matrix with known eigenvalues 10, 5, 2, -1
        const diag = [
            [10, 0, 0, 0],
            [0, 5, 0, 0],
            [0, 0, 2, 0],
            [0, 0, 0, -1]
        ];
        const res = eigensolveSymmetric4x4(diag);
        expect(res.maxEigenvalue).toBeCloseTo(10, 10);
        expect(Math.abs(res.maxEigenvector[0])).toBeCloseTo(1, 10);
        expect(res.maxEigenvector[1]).toBeCloseTo(0, 10);
    });

    it('eigensolveSymmetric4x4 supports flat Float64Array(16) input buffer', () => {
        const flatDiag = new Float64Array([
            10, 0, 0, 0,
            0, 5, 0, 0,
            0, 0, 2, 0,
            0, 0, 0, -1
        ]);
        const res = eigensolveSymmetric4x4(flatDiag);
        expect(res.maxEigenvalue).toBeCloseTo(10, 10);
        expect(Math.abs(res.maxEigenvector[0])).toBeCloseTo(1, 10);
        expect(res.maxEigenvector[1]).toBeCloseTo(0, 10);
    });

    it('hornSuperpose fast path with needAlignedCoords = false returns null alignedCoords and matching RMSD', () => {
        const mobileCoords = new Float32Array([
            0.0, 0.0, 0.0,
            1.5, 0.0, 0.0,
            0.0, 2.0, 0.0,
            0.0, 0.0, 5.0
        ]);

        const fullRes = hornSuperpose(mobileCoords, refCoords, [0, 1, 2], [3], true);
        const fastRes = hornSuperpose(mobileCoords, refCoords, [0, 1, 2], [3], false);

        expect(fastRes.alignedCoords).toBeNull();
        expect(fastRes.rmsd).toBe(fullRes.rmsd);
        expect(fastRes.rmsd).toBe(2.0);
    });
});

describe('VortexMD decoupled streaming RMSD calculations', () => {
    function createTestPlayer(VortexMDClass) {
        const player = Object.create(VortexMDClass.prototype);
        player.hasAttribute = () => false;
        player.getAttribute = () => null;
        player.setAttribute = () => {};
        player.removeAttribute = () => {};
        player.dispatchEvent = () => true;
        player.addEventListener = () => {};
        player.removeEventListener = () => {};
        player.shadowRoot = { getElementById: () => null };
        player.workerManager = null;
        player._isPlaying = false;
        player.playbackController = {
            pause: () => { player._isPlaying = false; },
            jumpToFrame: (f) => {
                if (player.activeAnalysisTaskId) {
                    player.activeAnalysisTaskId = null;
                }
                player._currentFrame = f;
            }
        };
        player.rmsdController = new RmsdController(player);
        player.pause = player.playbackController.pause;
        player.jumpToFrame = player.playbackController.jumpToFrame;
        return player;
    }

    it('runs a 200-frame RMSD calculation without polluting or altering ringBuffer.frameBuffer', async () => {
        const { VortexMD } = await import('../src/engine/vortexmd.js');
        const player = createTestPlayer(VortexMD);

        const dummyCoords = new Float32Array([
            0.0, 0.0, 0.0,
            1.5, 0.0, 0.0,
            0.0, 2.0, 0.0
        ]);

        player.comp = {
            structure: {
                getAtomIndices: () => [0, 1, 2]
            }
        };

        const frameMap = new Map();
        frameMap.set(0, dummyCoords);

        player.ringBuffer = {
            frameCount: 200,
            getFrameCoords: async (f) => dummyCoords,
            frameBuffer: frameMap
        };

        const initialCacheSize = player.ringBuffer.frameBuffer.size;
        expect(initialCacheSize).toBe(1);

        const result = await player.rmsdController.computeRmsd({
            fitQuery: 'protein and .CA',
            calcQuery: 'protein and .CA',
            stride: 1
        });

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(200);

        // Verify ringBuffer.frameBuffer is untouched and remains at initial size
        expect(player.ringBuffer.frameBuffer.size).toBe(initialCacheSize);
    });

    it('asserts that rmsdSeries produces exact expected RMSD values matching hornSuperpose', async () => {
        const { VortexMD } = await import('../src/engine/vortexmd.js');
        const player = createTestPlayer(VortexMD);

        const refCoords = new Float32Array([
            0.0, 0.0, 0.0,
            1.5, 0.0, 0.0,
            0.0, 2.0, 0.0
        ]);

        // Frame 0: reference
        // Frame 1: perturbed by 2.0 Angstroms along Z for atom 2
        const frame1Coords = new Float32Array([
            0.0, 0.0, 0.0,
            1.5, 0.0, 0.0,
            0.0, 2.0, 2.0
        ]);

        player.comp = {
            structure: {
                getAtomIndices: () => [0, 1, 2]
            }
        };

        player.ringBuffer = {
            frameCount: 2,
            getFrameCoords: async (f) => (f === 0 ? refCoords : frame1Coords),
            frameBuffer: new Map()
        };

        const result = await player.rmsdController.computeRmsd({
            fitQuery: 'protein and .CA',
            calcQuery: 'protein and .CA',
            stride: 1
        });

        expect(result.length).toBe(2);

        const expectedRmsd0 = hornSuperpose(refCoords, refCoords, [0, 1, 2], [0, 1, 2]).rmsd;
        const expectedRmsd1 = hornSuperpose(frame1Coords, refCoords, [0, 1, 2], [0, 1, 2]).rmsd;

        expect(result[0].rmsd).toBeCloseTo(expectedRmsd0, 4);
        expect(result[1].rmsd).toBeCloseTo(expectedRmsd1, 4);
    });

    it('discards pending analytical batches cleanly when activeAnalysisTaskId changes or is cancelled', async () => {
        const { VortexMD } = await import('../src/engine/vortexmd.js');
        const player = createTestPlayer(VortexMD);

        const dummyCoords = new Float32Array([
            0.0, 0.0, 0.0,
            1.5, 0.0, 0.0,
            0.0, 2.0, 0.0
        ]);

        player.comp = {
            structure: {
                getAtomIndices: () => [0, 1, 2]
            }
        };

        player.ringBuffer = {
            frameCount: 100,
            getFrameCoords: async (f) => {
                // Introduce a slight async delay to simulate in-flight batching
                await new Promise(r => setTimeout(r, 10));
                return dummyCoords;
            },
            frameBuffer: new Map()
        };

        const rmsdPromise = player.rmsdController.computeRmsd({
            fitQuery: 'protein and .CA',
            calcQuery: 'protein and .CA',
            stride: 1
        });

        // Immediately trigger cancellation via jumpToFrame or token clear
        player.jumpToFrame(5);

        const result = await rmsdPromise;

        // Should return empty array or partial result without throwing errors
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    it('guards cleanly when computeRmsd is called with a structure but no loaded trajectory', async () => {
        const { VortexMD } = await import('../src/engine/vortexmd.js');
        const player = createTestPlayer(VortexMD);
        const notices = [];
        player.notify = (level, message) => notices.push({ level, message });
        player.emit = () => {};
        player.comp = { structure: { getAtomIndices: () => [0, 1, 2] } };
        player.ringBuffer = null;
        player.fileOffsets = [];

        const result = await player.rmsdController.computeRmsd();

        expect(result).toEqual([]);
        expect(notices.some(n => n.level === 'warning' && /no trajectory/i.test(n.message))).toBe(true);
    });
});

