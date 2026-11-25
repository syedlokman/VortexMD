import { showToast } from '../shell/toast.js';
import { logger } from '../../shared/logger.js';
import { setupDropZone, $id, escapeHtml } from '../shell/dom-utils.js';
import { EVENTS } from '../../contracts/events.js';
import { refreshIcons } from '../shell/icons.js';

export function initSessionPanel({ engine, listen }) {

    let activeSessionFile = null;
    let pendingRelinkInfo = null;
    let selectedTopolFile = null;
    let selectedTrajFile = null;

    const btnSaveSession = $id('btn-save-session');
    const btnImportSession = $id('btn-import-session');
    const btnViewSession = $id('btn-view-session');
    const uploadSessionInput = $id('upload-session');
    const sessionModal = $id('session-modal');
    const btnCloseSessionModal = $id('btn-close-session-modal');
    const btnModalClearSession = $id('btn-modal-clear-session');
    const btnModalSaveSession = $id('btn-modal-save-session');
    const sessionNameInput = $id('session-name-input');
    const sessionCreatedLabel = $id('session-created-label');

    // Relink Modal Elements
    const relinkModal = $id('relink-session-modal');
    const relinkSessionName = $id('relink-session-name');
    const relinkExpectedTopol = $id('relink-expected-topol');
    const relinkExpectedAtoms = $id('relink-expected-atoms');
    const relinkExpectedTrajRow = $id('relink-expected-traj-row');
    const relinkExpectedTraj = $id('relink-expected-traj');
    const relinkTrajSection = $id('relink-traj-section');
    const relinkTopolStatus = $id('relink-topol-status');
    const relinkTrajStatus = $id('relink-traj-status');
    const relinkWarning = $id('relink-warning');
    const btnRelinkProceed = $id('btn-relink-proceed');
    const btnRelinkCancel = $id('btn-relink-cancel');
    const btnCloseRelinkModal = $id('btn-close-relink-modal');

    // Mini Buttons
    const btnMiniImport = $id('btn-mini-import-session');
    const btnMiniSave = $id('btn-mini-save-session');
    const btnMiniView = $id('btn-mini-view-session');

    function updateSessionButtonsUI() {
        const sessionBadge = document.getElementById('session-status-badge');
        if (activeSessionFile) {
            if (sessionBadge) {
                sessionBadge.innerText = 'Saved';
                sessionBadge.className = 'bg-emerald-100 text-emerald-700 border border-emerald-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full';
                sessionBadge.title = `Active Session: ${activeSessionFile.name}`;
            }
        } else {
            if (sessionBadge) {
                sessionBadge.innerText = 'Active';
                sessionBadge.className = 'bg-emerald-50 text-emerald-600 border border-emerald-200 text-[9px] font-bold px-1.5 py-0.5 rounded-full';
                sessionBadge.title = 'Active Session';
            }
        }
        refreshIcons();
    }

    async function handleSaveSession() {
        const summary = engine.getSessionSummary();
        if (!engine.hasStructure && (!summary.frameCount || summary.frameCount <= 1) && summary.measurementCount === 0) {
            showToast("No active structure or workspace state to save.", "warning");
            return;
        }

        const customName = sessionNameInput?.value?.trim() || (activeSessionFile?.name ? activeSessionFile.name.replace(/\.json$/i, '') : 'Session');

        try {
            const result = await engine.saveSession({
                handle: activeSessionFile?.handle || null,
                filename: activeSessionFile?.name || null,
                name: customName
            });

            if (result && result.filename) {
                activeSessionFile = { name: result.filename, handle: activeSessionFile?.handle || null };
                updateSessionButtonsUI();
                showToast(`Session saved successfully: "${result.filename}"`, "success");
                logger.log('info', 'SESSION', `Session saved: ${result.filename}`);
            }
        } catch (err) {
            showToast(`Save error: ${err.message}`, "error");
            logger.log('error', 'SESSION', `Save error: ${err.message}`);
        }
    }

    function updateSessionModalMetrics() {
        const structNameEl = document.getElementById('session-struct-name');
        const structDetailsEl = document.getElementById('session-struct-details');
        const trajNameEl = document.getElementById('session-traj-name');
        const trajDetailsEl = document.getElementById('session-traj-details');
        const playbackEl = document.getElementById('session-playback-details');
        const viewportEl = document.getElementById('session-viewport-details');
        const sessionIdEl = document.getElementById('session-id-label');
        const storageStatusEl = document.getElementById('session-storage-status');

        const selectionsEl = document.getElementById('session-selections-count');
        const measurementsEl = document.getElementById('session-measurements-count');
        const shapesEl = document.getElementById('session-shapes-count');
        const pinsEl = document.getElementById('session-pins-count');

        const rmsdStatusEl = document.getElementById('session-rmsd-status');
        const rmsdSummaryEl = document.getElementById('session-rmsd-summary');
        const rmsdQueriesEl = document.getElementById('session-rmsd-queries');
        const rmsdStatsEl = document.getElementById('session-rmsd-stats');

        const summary = engine.getSessionSummary();

        const structName = summary.structureName || (engine.hasStructure ? 'Loaded Structure' : 'None');
        const currentAtoms = summary.atomCount || 0;
        const totalFrames = summary.frameCount || 0;

        const measurementsCount = summary.measurementCount || 0;
        const shapesCount = summary.shapeCount || 0;
        const selectionsCount = engine.hasStructure ? 1 : 0;
        const pins = engine.getPins ? engine.getPins() : [];
        const pinsCount = Array.isArray(pins) ? pins.length : 0;

        if (structNameEl) {
            structNameEl.innerText = structName;
            structNameEl.title = structName;
        }
        if (structDetailsEl) {
            structDetailsEl.innerText = currentAtoms > 0 ? `${currentAtoms.toLocaleString()} atoms` : '0 atoms';
        }
        if (trajNameEl) {
            const trajName = summary.trajectoryName || (totalFrames > 1 ? 'Loaded Trajectory' : 'Single Frame');
            trajNameEl.innerText = trajName;
            trajNameEl.title = trajName;
        }
        if (trajDetailsEl) {
            trajDetailsEl.innerText = `${totalFrames} frames`;
        }
        if (playbackEl) {
            const currentF = engine.currentFrame || 1;
            const speed = engine.speed || 1.0;
            playbackEl.innerText = `Frame ${currentF} / ${totalFrames || 1} · ${speed}x`;
        }
        if (viewportEl) {
            viewportEl.innerText = 'Perspective · 4x4 matrix saved';
        }
        if (selectionsEl) {
            selectionsEl.innerText = String(selectionsCount);
        }
        if (measurementsEl) {
            measurementsEl.innerText = String(measurementsCount);
        }
        if (shapesEl) {
            shapesEl.innerText = String(shapesCount);
        }
        if (pinsEl) {
            pinsEl.innerText = String(pinsCount);
        }

        if (sessionIdEl) {
            const sId = summary.sessionId || `sess_${Date.now().toString(36)}`;
            sessionIdEl.innerText = sId.length > 14 ? `${sId.slice(0, 14)}...` : sId;
            sessionIdEl.title = sId;
        }
        if (storageStatusEl) {
            storageStatusEl.innerText = 'Workspace & Analytics';
        }

        const rmsdRuns = Array.isArray(summary.rmsdRuns) ? summary.rmsdRuns : [];
        const hasRmsd = rmsdRuns.length > 0;

        if (hasRmsd) {
            const latestRun = rmsdRuns[rmsdRuns.length - 1] || {
                series: [],
                fitQuery: 'protein and .CA',
                calcQuery: 'protein and .CA',
                stats: { min: 0, max: 0, avg: 0 }
            };
            const runsCount = Math.max(1, rmsdRuns.length);
            const pointsCount = latestRun.points || latestRun.series?.length || 0;

            if (rmsdStatusEl) {
                rmsdStatusEl.innerText = `Stored (${runsCount} Run${runsCount > 1 ? 's' : ''})`;
                rmsdStatusEl.className = 'text-[9px] font-bold font-mono px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300';
            }
            if (rmsdSummaryEl) {
                rmsdSummaryEl.innerText = `${runsCount} Run${runsCount > 1 ? 's' : ''} · ${pointsCount} Calculated Points`;
            }
            if (rmsdQueriesEl) {
                rmsdQueriesEl.innerText = `Fit: ${latestRun.fitQuery || 'default'} | Calc: ${latestRun.calcQuery || 'default'}`;
                rmsdQueriesEl.title = `Fit: ${latestRun.fitQuery} | Calc: ${latestRun.calcQuery}`;
            }
            if (rmsdStatsEl) {
                let minVal = 0, maxVal = 0, avgVal = 0;
                if (latestRun.stats && (latestRun.stats.min !== undefined || latestRun.stats.max !== undefined)) {
                    minVal = Number(latestRun.stats.min) || 0;
                    maxVal = Number(latestRun.stats.max) || 0;
                    avgVal = Number(latestRun.stats.avg) || 0;
                } else if (Array.isArray(latestRun.series) && latestRun.series.length > 0) {
                    const vals = latestRun.series.map(pt => Number(pt.rmsd) || 0);
                    minVal = Math.min(...vals);
                    maxVal = Math.max(...vals);
                    avgVal = vals.reduce((a, b) => a + b, 0) / vals.length;
                }
                rmsdStatsEl.innerText = `Min: ${minVal.toFixed(2)} | Max: ${maxVal.toFixed(2)} | Avg: ${avgVal.toFixed(2)} Å`;
            }
        } else {
            if (rmsdStatusEl) {
                rmsdStatusEl.innerText = 'Not Computed';
                rmsdStatusEl.className = 'text-[9px] font-bold font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200';
            }
            if (rmsdSummaryEl) {
                rmsdSummaryEl.innerText = 'No RMSD curves generated';
            }
            if (rmsdQueriesEl) {
                rmsdQueriesEl.innerText = 'Use RMSD tab to align and compute';
            }
            if (rmsdStatsEl) {
                rmsdStatsEl.innerText = 'Ready for computation';
            }
        }

        if (sessionCreatedLabel) {
            const createdAt = summary.createdAt || new Date().toISOString();
            sessionCreatedLabel.innerText = new Date(createdAt).toLocaleString();
        }

        if (sessionNameInput && (!sessionNameInput.value || sessionNameInput.value === 'Default Session')) {
            if (activeSessionFile?.name) {
                sessionNameInput.value = activeSessionFile.name.replace(/\.json$/i, '');
            } else if (summary.structureName) {
                const cleanName = summary.structureName.split('.')[0];
                sessionNameInput.value = `${cleanName}_session`;
            } else {
                sessionNameInput.value = 'Default Session';
            }
        }
    }

    function openSessionModal() {
        if (!sessionModal) return;
        updateSessionModalMetrics();
        sessionModal.showModal();
        refreshIcons();
    }

    function closeSessionModal() {
        if (!sessionModal) return;
        sessionModal.close();
    }

    function resetRelinkModal() {
        pendingRelinkInfo = null;
        selectedTopolFile = null;
        selectedTrajFile = null;
        if (relinkTopolStatus) relinkTopolStatus.innerText = 'Click or drag topology file here';
        if (relinkTrajStatus) relinkTrajStatus.innerText = 'Click or drag trajectory file here';
        if (relinkWarning) {
            relinkWarning.classList.add('hidden');
            relinkWarning.innerText = '';
        }
        if (btnRelinkProceed) {
            btnRelinkProceed.disabled = true;
            btnRelinkProceed.innerText = 'Verify & Restore';
        }
        const relinkInputTopol = document.getElementById('relink-input-topol');
        const relinkInputTraj = document.getElementById('relink-input-traj');
        if (relinkInputTopol) relinkInputTopol.value = '';
        if (relinkInputTraj) relinkInputTraj.value = '';
        if (relinkModal) relinkModal.close();
    }

    function openRelinkModal(detail) {
        pendingRelinkInfo = detail || {};
        selectedTopolFile = null;
        selectedTrajFile = null;

        const expTopol = pendingRelinkInfo.structureName || 'structure.gro';
        const expAtoms = pendingRelinkInfo.expectedAtoms || 0;
        const expTraj = pendingRelinkInfo.trajectoryName || null;
        const sName = expTopol ? `${expTopol.split('.')[0]}_session` : 'Session';

        if (relinkSessionName) relinkSessionName.innerText = sName;
        if (relinkExpectedTopol) relinkExpectedTopol.innerText = expTopol;
        if (relinkExpectedAtoms) relinkExpectedAtoms.innerText = expAtoms;

        if (expTraj) {
            if (relinkExpectedTraj) relinkExpectedTraj.innerText = expTraj;
            relinkExpectedTrajRow?.classList.remove('hidden');
            relinkTrajSection?.classList.remove('hidden');
        } else {
            relinkExpectedTrajRow?.classList.add('hidden');
            relinkTrajSection?.classList.add('hidden');
        }

        if (relinkTopolStatus) relinkTopolStatus.innerText = `Select ${expTopol}`;
        if (relinkTrajStatus) relinkTrajStatus.innerText = expTraj ? `Select ${expTraj}` : 'Click or drag trajectory file here';
        if (relinkWarning) {
            relinkWarning.classList.add('hidden');
            relinkWarning.innerText = '';
        }
        if (btnRelinkProceed) {
            btnRelinkProceed.disabled = true;
            btnRelinkProceed.innerText = 'Verify & Restore';
        }

        if (relinkModal) {
            relinkModal.showModal();
            refreshIcons();
        }
    }

    function handleRelinkTopolFile(file) {
        if (!file) return;
        selectedTopolFile = file;
        if (relinkTopolStatus) {
            relinkTopolStatus.innerHTML = `<span class="font-bold text-slate-800">${escapeHtml(file.name)}</span> <span class="text-slate-500">(${(file.size / 1024).toFixed(1)} KB)</span>`;
        }

        const expTopol = pendingRelinkInfo?.structureName;
        let warnings = [];
        if (expTopol && expTopol !== 'structure' && file.name.toLowerCase() !== expTopol.toLowerCase()) {
            warnings.push(`⚠️ File name mismatch: Expected '${expTopol}', but selected '${file.name}'. You may proceed if this is the correct structure.`);
        }

        if (warnings.length > 0 && relinkWarning) {
            relinkWarning.innerText = warnings.join('\n');
            relinkWarning.classList.remove('hidden');
        } else if (relinkWarning) {
            relinkWarning.classList.add('hidden');
            relinkWarning.innerText = '';
        }

        if (btnRelinkProceed) {
            btnRelinkProceed.disabled = false;
        }
    }

    function handleRelinkTrajFile(file) {
        if (!file) return;
        selectedTrajFile = file;
        if (relinkTrajStatus) {
            relinkTrajStatus.innerHTML = `<span class="font-bold text-slate-800">${escapeHtml(file.name)}</span> <span class="text-slate-500">(${(file.size / (1024 * 1024)).toFixed(1)} MB)</span>`;
        }

        const expTraj = pendingRelinkInfo?.trajectoryName;
        let warnings = [];
        if (expTraj && file.name.toLowerCase() !== expTraj.toLowerCase()) {
            warnings.push(`⚠️ Trajectory file name mismatch: Expected '${expTraj}', but selected '${file.name}'.`);
        }

        if (warnings.length > 0 && relinkWarning) {
            relinkWarning.innerText = warnings.join('\n');
            relinkWarning.classList.remove('hidden');
        }
    }

    // Relink File Input & Drag/Drop Wire-up
    setupDropZone('relink-zone-topol', 'relink-input-topol', handleRelinkTopolFile, {}, document, listen);
    setupDropZone('relink-zone-traj', 'relink-input-traj', handleRelinkTrajFile, {}, document, listen);

    if (btnRelinkProceed) {
        listen(btnRelinkProceed, 'click', async () => {
            if (!pendingRelinkInfo || !selectedTopolFile) return;

            btnRelinkProceed.disabled = true;
            btnRelinkProceed.innerText = 'Verifying & Restoring...';

            try {
                logger.log('info', 'SESSION', `Loading topology file: ${selectedTopolFile.name} for session restoration`);
                const loadedAtoms = await engine.loadTopology(selectedTopolFile);
                const expectedAtoms = pendingRelinkInfo.expectedAtoms ?? 0;

                if (expectedAtoms > 0 && loadedAtoms !== expectedAtoms) {
                    const errorMsg = `Fatal: Atom count mismatch. Structure has ${loadedAtoms} atoms, session expected ${expectedAtoms}.`;
                    logger.log('error', 'SESSION', errorMsg);
                    if (relinkWarning) {
                        relinkWarning.innerText = errorMsg;
                        relinkWarning.classList.remove('hidden');
                    }
                    showToast(errorMsg, "error");
                    btnRelinkProceed.disabled = false;
                    btnRelinkProceed.innerText = 'Verify & Restore';
                    return;
                }

                if (selectedTrajFile) {
                    logger.log('info', 'SESSION', `Loading trajectory file: ${selectedTrajFile.name}`);
                    engine.relinkTrajectory(selectedTrajFile);
                }

                await engine.restoreSession();
                updateSessionButtonsUI();
                updateSessionModalMetrics();
                resetRelinkModal();
                showToast("Session restored successfully with linked files!", "success");
            } catch (err) {
                logger.log('error', 'SESSION', `Failed to restore session: ${err.message}`);
                showToast(`Restore error: ${err.message}`, "error");
                if (relinkWarning) {
                    relinkWarning.innerText = `Error: ${err.message}`;
                    relinkWarning.classList.remove('hidden');
                }
                btnRelinkProceed.disabled = false;
                btnRelinkProceed.innerText = 'Verify & Restore';
            }
        });
    }

    if (btnRelinkCancel) listen(btnRelinkCancel, 'click', resetRelinkModal);
    if (btnCloseRelinkModal) listen(btnCloseRelinkModal, 'click', resetRelinkModal);
    if (relinkModal) {
        listen(relinkModal, 'click', (e) => {
            if (e.target === relinkModal) resetRelinkModal();
        });
    }

    async function processSessionFile(file, handle = null) {
        if (!file) return;

        try {
            logger.log('info', 'SESSION', `Reading session file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
            const fileText = await file.text();
            let sessionData;
            try {
                sessionData = JSON.parse(fileText);
            } catch (parseErr) {
                showToast("Failed to parse JSON file.", "error");
                logger.log('error', 'SESSION', `JSON parse error: ${parseErr.message}`);
                return;
            }

            const validation = engine.validateSession(sessionData);
            if (!validation.valid) {
                showToast(`Invalid session file: ${validation.error}`, "error");
                logger.log('error', 'SESSION', `Session validation failed: ${validation.error}`);
                return;
            }

            activeSessionFile = { name: file.name, handle: handle || null };
            if (sessionNameInput) {
                sessionNameInput.value = file.name.replace(/\.json$/i, '');
            }
            updateSessionButtonsUI();

            const restored = await engine.restoreSession(sessionData);
            if (restored) {
                updateSessionModalMetrics();
                showToast(`Session "${file.name}" restored successfully!`, "success");
            }
        } catch (err) {
            logger.log('error', 'SESSION', `Error restoring session: ${err.message}`);
            showToast(`Session restore failed: ${err.message}`, "error");
        } finally {
            if (uploadSessionInput) uploadSessionInput.value = '';
        }
    }

    async function triggerSessionImport() {
        if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'VortexMD Session (*.json)',
                        accept: { 'application/json': ['.json'] }
                    }],
                    multiple: false
                });
                if (handle) {
                    const file = await handle.getFile();
                    await processSessionFile(file, handle);
                    return;
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }
        uploadSessionInput?.click();
    }

    if (btnSaveSession) {
        listen(btnSaveSession, 'click', () => {
            handleSaveSession();
        });
    }

    if (btnImportSession) {
        listen(btnImportSession, 'click', () => {
            triggerSessionImport();
        });
    }

    if (uploadSessionInput) {
        listen(uploadSessionInput, 'change', async (e) => {
            const file = e.target.files?.[0];
            if (file) {
                await processSessionFile(file, null);
            }
        });
    }

    if (btnViewSession) {
        listen(btnViewSession, 'click', () => {
            openSessionModal();
        });
    }

    if (btnCloseSessionModal) {
        listen(btnCloseSessionModal, 'click', () => {
            closeSessionModal();
        });
    }

    if (sessionModal) {
        listen(sessionModal, 'click', (e) => {
            if (e.target === sessionModal) {
                closeSessionModal();
            }
        });
    }

    if (btnModalClearSession) {
        listen(btnModalClearSession, 'click', () => {
            if (confirm('Are you sure you want to reset the current session and clear workspace state?')) {
                engine.clear();
                activeSessionFile = null;
                updateSessionButtonsUI();
                updateSessionModalMetrics();
                showToast("Session reset to blank state.", "info");
            }
        });
    }

    if (btnModalSaveSession) {
        listen(btnModalSaveSession, 'click', async () => {
            await handleSaveSession();
            closeSessionModal();
        });
    }

    // Left Sidebar Mini Session Controls
    if (btnMiniImport) {
        listen(btnMiniImport, 'click', () => {
            triggerSessionImport();
        });
    }

    if (btnMiniSave) {
        listen(btnMiniSave, 'click', () => {
            handleSaveSession();
        });
    }

    if (btnMiniView) {
        listen(btnMiniView, 'click', () => {
            openSessionModal();
        });
    }

    // Engine Event Listeners
    listen(engine, EVENTS.RELINK_REQUIRED, (e) => {
        openRelinkModal(e.detail);
    });

    listen(engine, EVENTS.TOPOLOGY_LOADED, () => {
        updateSessionButtonsUI();
    });

    listen(engine, EVENTS.TOPOLOGY_CLEARED, () => {
        updateSessionButtonsUI();
    });

    listen(engine, EVENTS.INDEXING_COMPLETE, () => {
        updateSessionButtonsUI();
    });
}
