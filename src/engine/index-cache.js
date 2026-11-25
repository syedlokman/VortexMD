// src/index-cache.js
// Single Task: IndexedDB Storage & Instant 0s Load Engine for Trajectory Header Indexes

import { computeDeltaTimeAndCalibration, attachIndexMetadata } from './indexer.js';

const DB_NAME = 'VortexMDIndexCache';
const DB_VERSION = 1;
const STORE_NAME = 'trajectory_indexes';

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };

        request.onsuccess = (e) => {
            resolve(e.target.result);
        };

        request.onerror = (e) => {
            console.warn('IndexedDB failed to open:', e.target.error);
            resolve(null);
        };
    });

    return dbPromise;
}

function fnv1a32Hex(bytes) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes deterministic file fingerprint consisting of size + 32-bit FNV-1a hash of head and tail 64 KiB.
 * @param {File|Blob|ArrayBuffer} file
 * @returns {Promise<{ size: number, head: string, tail: string }|null>}
 */
export async function getFileFingerprint(file) {
    if (!file) return null;
    let size = 0;
    let headBytes = null;
    let tailBytes = null;
    const sliceLen = 64 * 1024;

    try {
        if (typeof file.slice === 'function') {
            size = file.size || 0;
            const headBlob = file.slice(0, Math.min(size, sliceLen));
            const headBuf = headBlob.arrayBuffer ? await headBlob.arrayBuffer() : await new Response(headBlob).arrayBuffer();
            headBytes = new Uint8Array(headBuf);

            const tailStart = Math.max(0, size - sliceLen);
            const tailBlob = file.slice(tailStart, size);
            const tailBuf = tailBlob.arrayBuffer ? await tailBlob.arrayBuffer() : await new Response(tailBlob).arrayBuffer();
            tailBytes = new Uint8Array(tailBuf);
        } else if (file instanceof ArrayBuffer || file?.buffer instanceof ArrayBuffer) {
            const buf = file instanceof ArrayBuffer ? file : file.buffer;
            size = buf.byteLength;
            headBytes = new Uint8Array(buf, 0, Math.min(size, sliceLen));
            const tailStart = Math.max(0, size - sliceLen);
            tailBytes = new Uint8Array(buf, tailStart, size - tailStart);
        } else {
            return null;
        }

        return {
            size,
            head: fnv1a32Hex(headBytes),
            tail: fnv1a32Hex(tailBytes)
        };
    } catch {
        return null;
    }
}

/**
 * Generates a deterministic key based on file metadata or remote URL + file size
 * @param {File|string} fileOrUrl 
 * @param {number} [fileSize=0] 
 * @returns {string}
 */
export function generateIndexKey(fileOrUrl, fileSize = 0) {
    if (!fileOrUrl) return '';

    if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        const name = fileOrUrl.name || 'local_blob';
        const size = fileOrUrl.size || fileSize || 0;
        const lm = fileOrUrl.lastModified || 0;
        return `file_${name}_${size}_${lm}`;
    }
    if (typeof fileOrUrl === 'string') {
        const cleanUrl = fileOrUrl.split('?')[0]; // strip query tokens
        const size = fileSize || 0;
        return `url_${cleanUrl}_${size}`;
    }
    return `generic_${String(fileOrUrl)}_${fileSize}`;
}

/**
 * Retrieves cached trajectory index offset array from IndexedDB if valid
 * @param {string} key 
 * @param {Object} [expectedFingerprint=null]
 * @param {number} [expectedFileSize=0]
 * @returns {Promise<Array<number>|null>}
 */
export async function getCachedIndex(key, expectedFingerprint = null, expectedFileSize = 0) {
    if (!key) return null;

    try {
        const db = await openDB();
        if (!db) return null;

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);

            req.onsuccess = () => {
                const rec = req.result;
                if (!rec || !Array.isArray(rec.offsets) || rec.offsets.length === 0) {
                    resolve(null);
                    return;
                }

                const offsets = rec.offsets;

                // 1. Verify fingerprint if expected
                if (expectedFingerprint && rec.fingerprint) {
                    if (typeof expectedFingerprint === 'string' || typeof rec.fingerprint === 'string') {
                        if (String(expectedFingerprint) !== String(rec.fingerprint)) {
                            resolve(null);
                            return;
                        }
                    } else if (
                        rec.fingerprint.size !== expectedFingerprint.size ||
                        rec.fingerprint.head !== expectedFingerprint.head ||
                        rec.fingerprint.tail !== expectedFingerprint.tail
                    ) {
                        resolve(null);
                        return;
                    }
                }

                // 2. Offsets must be strictly increasing
                for (let i = 1; i < offsets.length; i++) {
                    if (offsets[i] <= offsets[i - 1]) {
                        resolve(null);
                        return;
                    }
                }

                // 3. Last offset must equal file size if known
                const targetSize = expectedFileSize || rec.fileSize || 0;
                if (targetSize > 0 && offsets[offsets.length - 1] !== targetSize) {
                    resolve(null);
                    return;
                }

                const resultOffsets = offsets.slice();
                const frameTimes = (rec.frameTimes !== undefined && rec.frameTimes !== null) ? rec.frameTimes : null;
                const isCalib = rec.isTimeCalibrated !== undefined
                    ? rec.isTimeCalibrated
                    : (rec.detectedDeltaTime > 0 && frameTimes !== null);
                const detectedDeltaTime = rec.detectedDeltaTime > 0 ? rec.detectedDeltaTime : 0;

                attachIndexMetadata(resultOffsets, frameTimes, detectedDeltaTime, isCalib);
                resolve(resultOffsets);
            };

            req.onerror = () => {
                resolve(null);
            };
        });
    } catch (err) {
        console.warn('Failed reading from IndexedDB:', err);
        return null;
    }
}

/**
 * Saves trajectory index offset array to IndexedDB, capping store at 20 entries
 * @param {string} key 
 * @param {Array<number>} offsets 
 * @param {number} [fileSize=0] 
 * @param {Object} [fingerprint=null]
 * @param {Float32Array|Array<number>|null} [frameTimes=null]
 * @returns {Promise<boolean>}
 */
export async function saveCachedIndex(key, offsets, fileSize = 0, fingerprint = null, frameTimes = null) {
    if (!key || !Array.isArray(offsets) || offsets.length === 0) return false;

    try {
        const db = await openDB();
        if (!db) return false;

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);

            // Cap store at ~20 records, evicting oldest by timestamp
            try {
                const countReq = store.count();
                countReq.onsuccess = () => {
                    if (countReq.result >= 20) {
                        const allReq = store.getAll();
                        allReq.onsuccess = () => {
                            const items = allReq.result || [];
                            items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                            const excess = items.length - 19;
                            for (let i = 0; i < excess; i++) {
                                if (items[i] && items[i].key) {
                                    store.delete(items[i].key);
                                }
                            }
                        };
                    }
                };
            } catch (evictErr) {
                console.warn('Index cache eviction warning:', evictErr);
            }

            const resolvedTimes = (frameTimes !== null && frameTimes !== undefined)
                ? frameTimes
                : (offsets.frameTimes || null);

            let dt = offsets.detectedDeltaTime;
            let isCalib = offsets.isTimeCalibrated;
            if (resolvedTimes && (dt === undefined || isCalib === undefined)) {
                const calib = computeDeltaTimeAndCalibration(resolvedTimes);
                if (dt === undefined) dt = calib.detectedDeltaTime;
                if (isCalib === undefined) isCalib = calib.isTimeCalibrated;
            }

            const record = {
                key: key,
                offsets: offsets,
                frameTimes: resolvedTimes,
                frameCount: offsets.length - 1,
                fileSize: fileSize,
                fingerprint: fingerprint || null,
                detectedDeltaTime: dt !== undefined ? dt : 100.0,
                isTimeCalibrated: isCalib !== undefined ? isCalib : false,
                timestamp: Date.now()
            };

            const req = store.put(record);

            req.onsuccess = () => {
                resolve(true);
            };

            req.onerror = (e) => {
                console.warn('Failed writing index to IndexedDB:', e.target.error);
                resolve(false);
            };
        });
    } catch (err) {
        console.warn('Failed saving index to IndexedDB:', err);
        return false;
    }
}

/**
 * Clears the entire trajectory index cache store
 * @returns {Promise<boolean>}
 */
export async function clearIndexCache() {
    try {
        const db = await openDB();
        if (!db) return false;

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();

            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (err) {
        console.warn('Failed clearing IndexDB cache:', err);
        return false;
    }
}
