// src/shared/download.js
// Single Task: Consolidated Blob download helper utility

import * as NGL from 'ngl';

/**
 * Consolidated Blob download helper utility
 * Downloads a Blob as a file using NGLGlobal.download if available, or DOM URL.createObjectURL + <a> fallback.
 * Safe in headless / Node test environments (try/catch wrapped).
 * @param {Blob} blob 
 * @param {string} filename 
 */
export function downloadBlob(blob, filename) {
    if (typeof window === 'undefined') return;
    try {
        const NGLGlobal = (typeof globalThis !== 'undefined' && globalThis.NGL) || NGL;
        if (typeof NGLGlobal?.download === 'function') {
            NGLGlobal.download(blob, filename);
        } else if (typeof document !== 'undefined' && document.createElement) {
            const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
            if (url) {
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                if (document.body && typeof document.body.appendChild === 'function') {
                    document.body.appendChild(a);
                }
                if (typeof a.click === 'function') {
                    a.click();
                }
                if (document.body && typeof document.body.removeChild === 'function') {
                    document.body.removeChild(a);
                }
                if (typeof URL.revokeObjectURL === 'function') {
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
            }
        }
    } catch (err) {
        console.warn('[EXPORTER] Headless download trigger skipped:', err);
    }
}
