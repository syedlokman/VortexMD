// src/ui/app.js
// Single Task: Main UI Entry Orchestrator

import { registerSW } from 'virtual:pwa-register';
import { initLoaderPanel } from './panels/loader-panel.js';
import { initSessionPanel } from './panels/session-panel.js';
import { initMeasurementPanel } from './panels/measurement-panel.js';
import { initPlayerBar } from './panels/player-bar.js';
import { initLogModal } from './panels/log-modal.js';
import { initTemplates } from './shell/templates.js';
import { mountPanel } from './shell/boundary.js';
import { showToast } from './shell/toast.js';
import { EVENTS } from '../contracts/events.js';
import { initShapesPanel } from './panels/shapes-panel.js';
import { initDisplayTreePanel } from './panels/display-tree-panel.js';
import { initRmsdPanel } from './panels/rmsd-panel.js';
import { initDrawerPanel } from './panels/drawer.js';
import { initHotkeysPanel } from './panels/hotkeys.js';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
    registerSW({ immediate: true });
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Dynamic HTML Templates & Lucide Icons
    initTemplates();

    const player = document.getElementById('player');
    if (!player) return;

    // AppShell Panel: Engine Notice & Stream Error Subscriptions
    mountPanel('AppShell', ({ engine, listen }) => {
        listen(engine, EVENTS.NOTICE, (e) => {
            if (e.detail) {
                showToast(e.detail.message, e.detail.level);
            }
        });

        listen(engine, EVENTS.STREAM_ERROR, (e) => {
            showToast(e.detail?.message || 'Trajectory stream error occurred', 'error');
        });
    }, player);

    // Live System Telemetry
    const logModal = document.getElementById('log-modal');
    const statText = document.getElementById('stat-text');
    let lastStats = '';

    const updateStats = () => {
        if (!statText) return;
        const memJS = (performance.memory && typeof performance.memory.usedJSHeapSize === 'number') 
            ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB' 
            : 'n/a';
        const bufferLen = typeof player.getBufferLength === 'function' ? player.getBufferLength() : 0;
        
        const perf = typeof player.getPerformanceMetrics === 'function' 
            ? player.getPerformanceMetrics() 
            : { fps: null, durationMs: null };

        const fpsStr = (typeof perf.fps === 'number' && isFinite(perf.fps) && perf.fps > 0)
            ? `${perf.fps.toFixed(1)} FPS`
            : '– FPS';
        const durStr = (typeof perf.durationMs === 'number' && isFinite(perf.durationMs) && perf.durationMs > 0)
            ? `${perf.durationMs.toFixed(1)} ms/frame`
            : '– ms/frame';

        const sep = ' <span class="text-blue-300">|</span> ';
        const html = [fpsStr, durStr, memJS, `Buf: ${bufferLen}`]
            .map(s => `<span class="inline-block whitespace-nowrap">${s}</span>`).join(sep);

        if (html !== lastStats) {
            lastStats = html;
            statText.innerHTML = html;
        }
    };

    // Initialize UI Component Modules
    mountPanel('LoaderPanel', initLoaderPanel, player);
    mountPanel('SessionPanel', initSessionPanel, player);
    mountPanel('MeasurementPanel', initMeasurementPanel, player);
    mountPanel('ShapesPanel', initShapesPanel, player);
    mountPanel('DisplayTreePanel', initDisplayTreePanel, player);
    mountPanel('RmsdPanel', initRmsdPanel, player);
    mountPanel('DrawerPanel', initDrawerPanel, player);
    mountPanel('HotkeysPanel', initHotkeysPanel, player);
    mountPanel('PlayerBar', initPlayerBar, player);
    mountPanel('LogModal', (opts) => initLogModal({ ...opts, onOpen: updateStats }), player);

    setInterval(() => {
        if (logModal?.open) updateStats();
    }, 1000);
});