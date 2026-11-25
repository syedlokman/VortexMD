import { describe, it, expect } from 'vitest';
import { probeTrajectoryHeader, validateTrajectoryCompatibility } from '../src/engine/trajectory-validator.js';

function createSyntheticXtcFrame(natoms, step, time, lsize, overrides = {}) {
    const paddedLsize = (lsize + 3) & ~3;
    const totalFrameSize = 92 + paddedLsize;
    const buffer = new ArrayBuffer(totalFrameSize);
    const view = new DataView(buffer);

    view.setUint32(0, overrides.magic !== undefined ? overrides.magic : 0x000007CB, false);
    view.setUint32(4, overrides.natoms !== undefined ? overrides.natoms : natoms, false);
    view.setUint32(8, overrides.step !== undefined ? overrides.step : step, false);
    view.setFloat32(12, overrides.time !== undefined ? overrides.time : time, false);
    view.setFloat32(16, overrides.vxx !== undefined ? overrides.vxx : 50.0, false);
    view.setFloat32(32, overrides.vyy !== undefined ? overrides.vyy : 50.0, false);
    view.setFloat32(48, overrides.vzz !== undefined ? overrides.vzz : 50.0, false);
    view.setUint32(88, lsize, false);

    return buffer;
}

describe('Trajectory Header Validator', () => {
    it('probes valid XTC header correctly', async () => {
        const frameBuf = createSyntheticXtcFrame(15420, 0, 0.0, 40);
        const probe = await probeTrajectoryHeader(frameBuf, 'xtc');
        expect(probe.found).toBe(true);
        expect(probe.format).toBe('xtc');
        expect(probe.natoms).toBe(15420);
        expect(probe.box).toEqual([50.0, 50.0, 50.0]);
    });

    it('rejects unsupported non-XTC formats', async () => {
        const dummyBuf = new ArrayBuffer(64);
        const probe = await probeTrajectoryHeader(dummyBuf, 'trr');
        expect(probe.found).toBe(false);
        expect(probe.error).toContain('VortexMD v1 is purpose-built and optimized for GROMACS (.xtc)');
    });

    it('passes validation when trajectory atom count matches topology atom count', async () => {
        const frameBuf = createSyntheticXtcFrame(24150, 0, 0.0, 40);
        const blob = new Blob([frameBuf]);
        const res = await validateTrajectoryCompatibility(blob, 24150, 'xtc');
        expect(res.valid).toBe(true);
        expect(res.trajAtoms).toBe(24150);
        expect(res.expectedAtoms).toBe(24150);
    });

    it('rejects trajectory with descriptive error when atom counts mismatch', async () => {
        const frameBuf = createSyntheticXtcFrame(18320, 0, 0.0, 40);
        const blob = new Blob([frameBuf]);
        const res = await validateTrajectoryCompatibility(blob, 24150, 'xtc');
        expect(res.valid).toBe(false);
        expect(res.trajAtoms).toBe(18320);
        expect(res.expectedAtoms).toBe(24150);
        expect(res.error).toContain('18,320');
        expect(res.error).toContain('24,150');
    });

    it('rejects trajectory when no topology is loaded (0 expected atoms)', async () => {
        const frameBuf = createSyntheticXtcFrame(100, 0, 0.0, 40);
        const blob = new Blob([frameBuf]);
        const res = await validateTrajectoryCompatibility(blob, 0, 'xtc');
        expect(res.valid).toBe(false);
        expect(res.error).toContain('No active topology structure');
        expect(res.error).toContain('(.pdb, .gro)');
        expect(res.error).not.toContain('.cif');
    });

    it('rejects trajectory with corrupted box vectors', async () => {
        const frameBuf = createSyntheticXtcFrame(100, 0, 0.0, 40, { vxx: -10.0 });
        const blob = new Blob([frameBuf]);
        const res = await validateTrajectoryCompatibility(blob, 100, 'xtc');
        expect(res.valid).toBe(false);
        expect(res.error).toContain('simulation box');
    });
});
