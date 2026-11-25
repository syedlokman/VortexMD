// src/memory-budget.js
// Single Task: Dynamic Adaptive RAM Footprint Calculator & Eviction Rule Engine

import { logger } from '../shared/logger.js';

/**
 * Diagnostic analysis of host hardware, device memory, and concurrency
 */
export function getSystemDiagnostic() {
    let deviceType = 'Desktop / Workstation';
    let deviceMemoryGB = 'Unspecified (Browser security restricted)';
    let hardwareConcurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) 
        ? `${navigator.hardwareConcurrency} Logical Cores` 
        : 'Unknown';
    let tier = 'Desktop Standard';

    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
        deviceType = 'Mobile / Tablet Device';
    }

    let budgetBytes = 50 * 1024 * 1024; // 50MB baseline
    if (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') {
        const ramGB = navigator.deviceMemory;
        deviceMemoryGB = `${ramGB} GB RAM`;
        if (ramGB >= 8) {
            budgetBytes = 500 * 1024 * 1024;
            tier = 'High-End Workstation (RAM ≥ 8 GB)';
        } else if (ramGB >= 4) {
            budgetBytes = 250 * 1024 * 1024;
            tier = 'Mid-Range System (RAM 4-8 GB)';
        } else if (ramGB >= 2) {
            budgetBytes = 100 * 1024 * 1024;
            tier = 'Low-RAM System (RAM 2-4 GB)';
        } else {
            budgetBytes = 50 * 1024 * 1024;
            tier = 'Constrained Environment (RAM < 2 GB)';
        }
    } else if (!isMobile && typeof window !== 'undefined') {
        budgetBytes = 250 * 1024 * 1024;
        tier = 'Desktop Standard Fallback (RAM info protected)';
    } else {
        budgetBytes = 50 * 1024 * 1024;
        tier = 'Mobile / Constrained Fallback';
    }

    const budgetMB = (budgetBytes / (1024 * 1024)).toFixed(0);

    return {
        deviceType,
        deviceMemoryGB,
        hardwareConcurrency,
        tier,
        budgetBytes,
        budgetMB,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node/Test'
    };
}

/**
 * Dynamic memory limit calculation:
 * Returns 50MB (low-end / mobile / fallback) up to 500MB on 8GB+ desktop workstations.
 */
export function getDynamicMemoryLimit() {
    const diag = getSystemDiagnostic();
    return diag.budgetBytes;
}

/**
 * Log detected system hardware and selected Dynamic Adaptive RAM Cache Budget
 */
export function logSystemMemoryBudget(context = 'Startup') {
    const diag = getSystemDiagnostic();
    const logMsg = `Detected system: ${diag.deviceType} (${diag.deviceMemoryGB}, ${diag.hardwareConcurrency}) | Hardware Tier: ${diag.tier} -> Selected Dynamic Adaptive RAM Cache Budget: ${diag.budgetMB} MB (${diag.budgetBytes.toLocaleString()} bytes)`;
    
    if (typeof logger !== 'undefined' && logger.isDebugEnabled && logger.isDebugEnabled()) {
        logger.log('debug', 'SYSTEM', `RAM Cache Budget: ${diag.budgetMB} MB (${context}) | Device: ${diag.deviceType} (${diag.deviceMemoryGB}) | Tier: ${diag.tier}`);
    }

    logger.log('info', 'SYSTEM', logMsg);
    return diag;
}

export function calculateMemoryBudget(atomCount, frameCount, customLimitBytes = null) {
    // atomCount * 3 floats (X,Y,Z) * 4 bytes per float * totalFrames
    const totalUncompressedBytes = atomCount * 3 * 4 * frameCount;
    const maxCacheBytes = customLimitBytes || getDynamicMemoryLimit();

    return {
        totalBytes: totalUncompressedBytes,
        maxCacheBytes,
        shouldEvict: totalUncompressedBytes > maxCacheBytes
    };
}
