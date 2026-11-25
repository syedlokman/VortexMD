import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { generateIndexKey, getCachedIndex, saveCachedIndex, clearIndexCache } from '../src/engine/index-cache.js';

describe('IndexedDB Index Cache Manager', () => {
    beforeEach(async () => {
        await clearIndexCache();
    });

    it('generates deterministic keys for File objects and URL strings', () => {
        const dummyFile = new File([''], 'test_trajectory.xtc', { lastModified: 1700000000 });
        Object.defineProperty(dummyFile, 'size', { value: 10485760 });

        const fileKey = generateIndexKey(dummyFile, 10485760);
        expect(fileKey).toContain('test_trajectory.xtc');
        expect(fileKey).toContain('10485760');

        const urlKey = generateIndexKey('https://example.org/traj.xtc?token=123', 52428800);
        expect(urlKey).toBe('url_https://example.org/traj.xtc_52428800');
    });

    it('stores and retrieves index offset arrays with frameTimes and calibration metadata', async () => {
        const key = 'test_key_1';
        const sampleOffsets = [0, 1024, 2048, 4096, 8192];
        const sampleFrameTimes = new Float32Array([0.0, 10.0, 20.0, 30.0]);

        const saved = await saveCachedIndex(key, sampleOffsets, 8192, null, sampleFrameTimes);
        expect(saved).toBe(true);

        const cached = await getCachedIndex(key);
        expect(cached).toEqual(sampleOffsets);
        expect(cached.frameTimes).toBeInstanceOf(Float32Array);
        expect(Array.from(cached.frameTimes)).toEqual([0.0, 10.0, 20.0, 30.0]);
        expect(cached.isTimeCalibrated).toBe(true);
        expect(cached.detectedDeltaTime).toBe(10.0);
    });

    it('returns null for missing cache keys', async () => {
        const result = await getCachedIndex('non_existent_key');
        expect(result).toBeNull();
    });

    it('validates fingerprint and strict monotonicity', async () => {
        const fingerprint1 = 'fp-aaa111';
        const fingerprint2 = 'fp-bbb222';
        const key = 'traj_fp_test';
        const offsets = [0, 500, 1000];

        await saveCachedIndex(key, offsets, 1000, fingerprint1);

        // Matching fingerprint retrieves offsets
        const cached = await getCachedIndex(key, fingerprint1);
        expect(cached).toEqual(offsets);

        // Mismatched fingerprint returns null
        const mismatch = await getCachedIndex(key, fingerprint2);
        expect(mismatch).toBeNull();

        // Non-monotonic offsets are rejected
        const nonMonotonicKey = 'non_mono';
        await saveCachedIndex(nonMonotonicKey, [0, 500, 400], 400, fingerprint1);
        const nonMonoCached = await getCachedIndex(nonMonotonicKey, fingerprint1);
        expect(nonMonoCached).toBeNull();
    });

    it('evicts oldest entries when store exceeds 20 records', async () => {
        for (let i = 0; i < 22; i++) {
            const key = `evict_key_${i}`;
            await saveCachedIndex(key, [0, 100], 100, `fp_${i}`);
        }

        // The first keys should be evicted
        const oldest = await getCachedIndex('evict_key_0', 'fp_0');
        expect(oldest).toBeNull();

        // The latest keys should exist
        const latest = await getCachedIndex('evict_key_21', 'fp_21');
        expect(latest).toEqual([0, 100]);
    });

    it('clears all caches on clearIndexCache()', async () => {
        const key = generateIndexKey('traj.xtc', 1000);
        await saveCachedIndex(key, [0, 500, 1000], 1000, 'fp-abc');

        const cachedBefore = await getCachedIndex(key, 'fp-abc');
        expect(cachedBefore).toEqual([0, 500, 1000]);

        await clearIndexCache();

        const cachedAfter = await getCachedIndex(key, 'fp-abc');
        expect(cachedAfter).toBeNull();
    });
});
