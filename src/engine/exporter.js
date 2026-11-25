// src/engine/exporter.js
// Single Task: High-Resolution Viewport Screenshot Exporter

import { downloadBlob } from '../shared/download.js';
import { logger } from '../shared/logger.js';

/**
 * Capture and download high-resolution viewport screenshot (.png)
 * Supports 300 DPI (factor: 3) and 4K (factor: 4) publication exports.
 * Enforces transparent: false so selected background color (White #ffffff or Black #000000) is preserved.
 * Toast-free: returns generated Blob on success and throws on failure.
 * @param {Object} stage NGL Stage instance
 * @param {string} [defaultFilename='structure_screenshot.png']
 * @param {Object|string} [options={}]
 * @returns {Promise<Blob>}
 */
export async function exportViewportImage(stage, defaultFilename = 'structure_screenshot.png', options = {}) {
    if (!stage) {
        throw new Error('No active 3D viewport to capture image.');
    }

    let factor = 2;
    let optObj = {};
    if (typeof options === 'string') {
        const lower = options.toLowerCase();
        if (lower === '300dpi') factor = 3;
        else if (lower === '4k') factor = 4;
    } else if (options && typeof options === 'object') {
        optObj = { ...options };
        if (typeof optObj.factor === 'number') {
            factor = optObj.factor;
        } else if (optObj.resolution === '300dpi' || optObj.res === '300dpi') {
            factor = 3;
        } else if (optObj.resolution === '4k' || optObj.res === '4k') {
            factor = 4;
        }
    }

    const imgOptions = Object.assign({
        antialias: true,
        trim: false
    }, optObj, {
        factor,
        transparent: false // Strictly enforce transparent: false so canvas background color is preserved without WebGL shader darkening
    });

    const blob = await stage.makeImage(imgOptions);
    if (!blob) {
        throw new Error('Failed to capture viewport image blob.');
    }

    downloadBlob(blob, defaultFilename);
    logger.log('info', 'EXPORTER', `Exported viewport screenshot (${defaultFilename})`);
    return blob;
}
