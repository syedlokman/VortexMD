import { describe, it, expect } from 'vitest';
import { interpolateCatmullRom, superposeCoordinates } from '../src/engine/trajectory.js';

describe('Catmull-Rom Cubic Spline Interpolation (interpolateCatmullRom)', () => {
    const cPrev = new Float32Array([0.0, 0.0, 0.0]);
    const c0    = new Float32Array([1.0, 2.0, 3.0]);
    const c1    = new Float32Array([4.0, 5.0, 6.0]);
    const cNext = new Float32Array([7.0, 8.0, 9.0]);

    it('returns c0 exactly when t <= 0.001', () => {
        const result0 = interpolateCatmullRom(cPrev, c0, c1, cNext, 0.0);
        expect(result0).toBe(c0);

        const resultSmall = interpolateCatmullRom(cPrev, c0, c1, cNext, 0.001);
        expect(resultSmall).toBe(c0);
    });

    it('returns c0 if c1 is null or undefined', () => {
        const result = interpolateCatmullRom(cPrev, c0, null, cNext, 0.5);
        expect(result).toBe(c0);
    });

    it('returns c1 exactly when t >= 0.999', () => {
        const result1 = interpolateCatmullRom(cPrev, c0, c1, cNext, 1.0);
        expect(result1).toBe(c1);

        const resultNear1 = interpolateCatmullRom(cPrev, c0, c1, cNext, 0.999);
        expect(resultNear1).toBe(c1);
    });

    it('calculates smooth intermediate cubic spline values at t = 0.5', () => {
        const result = interpolateCatmullRom(cPrev, c0, c1, cNext, 0.5);
        expect(result).toBeInstanceOf(Float32Array);
        expect(result.length).toBe(3);

        // For uniform linear points [0,0,0], [1,2,3], [4,5,6], [7,8,9],
        // Catmull-Rom midpoint should interpolate linearly:
        // t=0.5: wPrev = -0.0625 + 0.25 - 0.25 = -0.0625
        // w0 = 0.1875 - 0.625 + 1.0 = 0.5625
        // w1 = -0.1875 + 0.5 + 0.25 = 0.5625
        // wNext = 0.0625 - 0.125 = -0.0625
        // For x: -0.0625*0 + 0.5625*1 + 0.5625*4 - 0.0625*7 = 0.5625 + 2.25 - 0.4375 = 2.375
        // (with linear step = 3, midpoint is 2.5)
        expect(result[0]).toBeCloseTo(2.375, 4);
        expect(result[1]).toBeCloseTo(3.4375, 4);
        expect(result[2]).toBeCloseTo(4.5, 4);
    });

    it('reuses provided outBuffer in-place to avoid GC allocation thrashing', () => {
        const out = new Float32Array(3);
        const result = interpolateCatmullRom(cPrev, c0, c1, cNext, 0.5, out);
        expect(result).toBe(out);
        expect(out[0]).toBeCloseTo(2.375, 4);
    });

    it('safely handles null cPrev and null cNext boundary conditions', () => {
        const result = interpolateCatmullRom(null, c0, c1, null, 0.5);
        expect(result).toBeInstanceOf(Float32Array);
        expect(result.length).toBe(3);
        expect(Number.isFinite(result[0])).toBe(true);
    });
});

describe('Rigid-Body Closed-Form Superposition (superposeCoordinates)', () => {
    it('returns original coords if coords or refCoords is missing or mismatched', () => {
        const c1 = new Float32Array([1, 2, 3]);
        const c2 = new Float32Array([1, 2, 3, 4, 5, 6]);

        expect(superposeCoordinates(null, c1)).toBeNull();
        expect(superposeCoordinates(c1, null)).toBe(c1);
        expect(superposeCoordinates(c1, c2)).toBe(c1);
    });

    it('yields identity alignment when coords already match refCoords', () => {
        const ref = new Float32Array([
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
        ]);
        const coords = new Float32Array(ref);
        const aligned = superposeCoordinates(coords, ref, [0, 1, 2, 3]);

        for (let i = 0; i < ref.length; i++) {
            expect(aligned[i]).toBeCloseTo(ref[i], 4);
        }
    });

    it('corrects pure translational displacement back onto reference coordinates', () => {
        const ref = new Float32Array([
            0.0, 0.0, 0.0,
            2.0, 0.0, 0.0,
            0.0, 2.0, 0.0,
            0.0, 0.0, 2.0
        ]);
        // Shift by +10 in X, +5 in Y, -3 in Z
        const shifted = new Float32Array([
            10.0, 5.0, -3.0,
            12.0, 5.0, -3.0,
            10.0, 7.0, -3.0,
            10.0, 5.0, -1.0
        ]);

        const aligned = superposeCoordinates(shifted, ref, [0, 1, 2, 3]);
        for (let i = 0; i < ref.length; i++) {
            expect(aligned[i]).toBeCloseTo(ref[i], 3);
        }
    });

    it('accurately superposes highly elongated anisotropic structures under 15-degree rotation', () => {
        // Highly anisotropic structure: 25 atoms elongated along Z (aspect ratio ~40:1)
        const nAtoms = 25;
        const ref = new Float32Array(nAtoms * 3);
        const indices = [];
        for (let i = 0; i < nAtoms; i++) {
            ref[i * 3]     = Math.cos(i * 0.7) * 1.2;
            ref[i * 3 + 1] = Math.sin(i * 0.7) * 1.0;
            ref[i * 3 + 2] = i * 4.5;
            indices.push(i);
        }

        // Rotate by 15 degrees (~0.2618 rad) around arbitrary axis [2, 1, -1] + translation
        const angle = (15 * Math.PI) / 180;
        const axisNorm = Math.hypot(2, 1, -1);
        const ux = 2 / axisNorm, uy = 1 / axisNorm, uz = -1 / axisNorm;
        const cosA = Math.cos(angle), sinA = Math.sin(angle), oneMinus = 1 - cosA;

        const R = [
            cosA + ux*ux*oneMinus,    ux*uy*oneMinus - uz*sinA, ux*uz*oneMinus + uy*sinA,
            uy*ux*oneMinus + uz*sinA, cosA + uy*uy*oneMinus,    uy*uz*oneMinus - ux*sinA,
            uz*ux*oneMinus - uy*sinA, uz*uy*oneMinus + ux*sinA, cosA + uz*uz*oneMinus
        ];

        const tx = 14.5, ty = -22.1, tz = 33.7;
        const rotated = new Float32Array(ref.length);
        for (let i = 0; i < ref.length; i += 3) {
            const x = ref[i], y = ref[i + 1], z = ref[i + 2];
            rotated[i]     = R[0]*x + R[1]*y + R[2]*z + tx;
            rotated[i + 1] = R[3]*x + R[4]*y + R[5]*z + ty;
            rotated[i + 2] = R[6]*x + R[7]*y + R[8]*z + tz;
        }

        const aligned = superposeCoordinates(rotated, ref, indices);
        for (let i = 0; i < ref.length; i++) {
            // Must have near machine precision accuracy (< 0.001 A)
            expect(aligned[i]).toBeCloseTo(ref[i], 2);
        }
    });

    it('accurately superposes highly elongated anisotropic structures under large 120-degree rotation', () => {
        const nAtoms = 30;
        const ref = new Float32Array(nAtoms * 3);
        const indices = [];
        for (let i = 0; i < nAtoms; i++) {
            ref[i * 3]     = Math.sin(i * 0.5) * 1.5;
            ref[i * 3 + 1] = Math.cos(i * 0.5) * 1.5;
            ref[i * 3 + 2] = i * 5.0; // 0 to 145 A
            indices.push(i);
        }

        // 120-degree rotation around axis [1, 1, 1] + translation
        const angle = (120 * Math.PI) / 180;
        const axisNorm = Math.hypot(1, 1, 1);
        const ux = 1 / axisNorm, uy = 1 / axisNorm, uz = 1 / axisNorm;
        const cosA = Math.cos(angle), sinA = Math.sin(angle), oneMinus = 1 - cosA;

        const R = [
            cosA + ux*ux*oneMinus,    ux*uy*oneMinus - uz*sinA, ux*uz*oneMinus + uy*sinA,
            uy*ux*oneMinus + uz*sinA, cosA + uy*uy*oneMinus,    uy*uz*oneMinus - ux*sinA,
            uz*ux*oneMinus - uy*sinA, uz*uy*oneMinus + ux*sinA, cosA + uz*uz*oneMinus
        ];

        const tx = -50.0, ty = 80.0, tz = -15.0;
        const rotated = new Float32Array(ref.length);
        for (let i = 0; i < ref.length; i += 3) {
            const x = ref[i], y = ref[i + 1], z = ref[i + 2];
            rotated[i]     = R[0]*x + R[1]*y + R[2]*z + tx;
            rotated[i + 1] = R[3]*x + R[4]*y + R[5]*z + ty;
            rotated[i + 2] = R[6]*x + R[7]*y + R[8]*z + tz;
        }

        const aligned = superposeCoordinates(rotated, ref, indices);
        for (let i = 0; i < ref.length; i++) {
            expect(aligned[i]).toBeCloseTo(ref[i], 2);
        }
    });
});

