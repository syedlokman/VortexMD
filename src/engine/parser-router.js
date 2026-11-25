// src/parser-router.js
// Single Task: Universal Multi-Format File Router & Parser Registry Inspector

import * as NGL from 'ngl';

const TOPOLOGY_EXTS = new Set([
    'gro', 'pdb', 'ent', 'cif', 'mcif', 'mmtf', 'mol2', 'sdf', 'prmtop', 'psf', 'top', 'pqr', 'xml'
]);

const TRAJECTORY_EXTS = new Set([
    'xtc'
]);

const BINARY_EXTS = new Set([
    'xtc', 'mmtf'
]);

export function getFormatInfo(fileOrUrl) {
    if (!fileOrUrl) {
        return { ext: '', isBinary: false, isCompressed: false, category: 'topology', name: '' };
    }

    const name = typeof fileOrUrl === 'string' ? fileOrUrl : (fileOrUrl.name || '');
    
    // 1. Strip Query Parameters and Hash Fragments
    let cleanPath = name.split('?')[0].split('#')[0];
    
    // 2. Strip Trailing Zenodo API '/content' Suffix
    cleanPath = cleanPath.replace(/\/content$/i, '');

    const isCompressed = /\.gz$|\.bz2$|\.zip$/i.test(cleanPath);

    let uncompressedPath = cleanPath;
    if (isCompressed) {
        uncompressedPath = cleanPath.replace(/\.(gz|bz2|zip)$/i, '');
    }

    const parts = uncompressedPath.toLowerCase().split('.');
    let ext = parts.length > 1 ? parts.pop() : '';

    if (ext === 'ent') ext = 'pdb';
    if (ext === 'mcif') ext = 'cif';

    let category = 'topology';
    if (TRAJECTORY_EXTS.has(ext)) {
        category = 'trajectory';
    } else if (TOPOLOGY_EXTS.has(ext)) {
        category = 'topology';
    } else {
        // Fallback check against NGL ParserRegistry if available
        if (NGL.ParserRegistry && NGL.ParserRegistry.get) {
            const parser = NGL.ParserRegistry.get(ext);
            if (parser && parser.prototype && parser.prototype.type === 'trajectory') {
                category = 'trajectory';
            }
        }
    }

    const isBinary = BINARY_EXTS.has(ext);

    return {
        ext,
        isBinary,
        isCompressed,
        category,
        name
    };
}

