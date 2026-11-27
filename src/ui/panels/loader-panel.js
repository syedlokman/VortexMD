import { showToast } from '../shell/toast.js';
import { logger } from '../../shared/logger.js';
import { setupDropZone, formatFileSize, $id, toggleClass } from '../shell/dom-utils.js';
import { EVENTS } from '../../contracts/events.js';
import { refreshIcons } from '../shell/icons.js';

export function initLoaderPanel({ engine, listen }) {

    let atomCount = 0;
    let lastLoadedStructMeta = { name: '', count: 0, size: 0 };
    let pendingUploadCallback = null;

    const setTrajectoryDisabled = (disabled) => {
        ['btn-mini-traj', 'drop-zone-traj', 'player-ui'].forEach(id => {
            toggleClass(id, ['opacity-50', 'pointer-events-none'], disabled);
        });
        toggleClass('drop-zone-traj', 'hover:shadow-md', !disabled);

        const btnMiniTraj = $id('btn-mini-traj');
        if (btnMiniTraj) {
            const trajIcon = btnMiniTraj.querySelector('svg, [data-lucide], i');
            if (disabled) {
                btnMiniTraj.classList.add('text-slate-400');
                btnMiniTraj.classList.remove('text-slate-700');
                if (trajIcon) {
                    trajIcon.classList.add('text-slate-400');
                    trajIcon.classList.remove('text-slate-500');
                }
            } else {
                btnMiniTraj.classList.remove('text-slate-400');
                btnMiniTraj.classList.add('text-slate-700');
                if (trajIcon) {
                    trajIcon.classList.remove('text-slate-400');
                    trajIcon.classList.add('text-slate-500');
                }
            }
        }
    };

    const resetTrajectoryProgressUI = () => {
        showIndexingUI(false);
        const progressBar = $id('progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.classList.remove('animate-pulse');
        }
        const progressText = $id('progress-text');
        if (progressText) progressText.innerText = '0%';
        const trajInput = $id('upload-traj');
        if (trajInput) trajInput.value = '';
        const miniTrajDot = $id('mini-traj-dot');
        if (miniTrajDot) {
            miniTrajDot.classList.add('hidden');
            miniTrajDot.removeAttribute('title');
        }
        const btnMiniTraj = $id('btn-mini-traj');
        if (btnMiniTraj) {
            btnMiniTraj.setAttribute('title', 'Load Trajectory (.xtc)');
            if (!engine.hasStructure) {
                btnMiniTraj.classList.add('text-slate-400');
                btnMiniTraj.classList.remove('text-slate-700');
                const trajIcon = btnMiniTraj.querySelector('svg, [data-lucide], i');
                if (trajIcon) {
                    trajIcon.classList.add('text-slate-400');
                    trajIcon.classList.remove('text-slate-500');
                }
            }
        }
    };

    const unlockTrajectoryUI = (filename, label, extraMeta = {}) => {
        const count = extraMeta.count !== undefined ? extraMeta.count : (atomCount || engine.atomCount || 0);
        const size = extraMeta.size || lastLoadedStructMeta.size || 0;

        lastLoadedStructMeta = {
            name: filename,
            count: count,
            size: size
        };

        const sizeFormatted = formatFileSize(size);
        const sizePart = sizeFormatted ? `, ${sizeFormatted}` : '';
        const hoverTooltip = `${filename} (${count.toLocaleString()} atoms${sizePart})`;

        const structStatus = $id('struct-status');
        if (structStatus) {
            structStatus.classList.remove('hidden');
            structStatus.setAttribute('title', hoverTooltip);
        }

        const statusText = $id('struct-status-text');
        if (statusText) {
            statusText.innerText = label || `${filename} (${count} atoms)`;
            statusText.setAttribute('title', hoverTooltip);
        }
        refreshIcons();

        const miniStructDot = $id('mini-struct-dot');
        if (miniStructDot) {
            miniStructDot.classList.remove('hidden');
            miniStructDot.setAttribute('title', hoverTooltip);
        }

        setTrajectoryDisabled(false);
    };

    listen(engine, EVENTS.TOPOLOGY_CLEARED, () => {
        atomCount = 0;
        lastLoadedStructMeta = { name: '', count: 0, size: 0 };
        const structStatus = $id('struct-status');
        if (structStatus) {
            structStatus.classList.add('hidden');
            structStatus.removeAttribute('title');
        }
        const statusText = $id('struct-status-text');
        if (statusText) {
            statusText.innerText = '';
            statusText.removeAttribute('title');
        }

        const miniStructDot = $id('mini-struct-dot');
        if (miniStructDot) {
            miniStructDot.classList.add('hidden');
            miniStructDot.removeAttribute('title');
        }
        const miniTrajDot = $id('mini-traj-dot');
        if (miniTrajDot) miniTrajDot.classList.add('hidden');

        setTrajectoryDisabled(true);
        resetTrajectoryProgressUI();
    });

    listen(engine, EVENTS.TRAJECTORY_INVALID, () => {
        resetTrajectoryProgressUI();
    });

    listen(engine, EVENTS.INDEXING_FAILED, () => {
        resetTrajectoryProgressUI();
    });

    listen(engine, EVENTS.TOPOLOGY_LOADED, (e) => {
        if (e.detail) {
            atomCount = e.detail.count || engine.atomCount || 0;
            unlockTrajectoryUI(e.detail.name, `${e.detail.name} (${atomCount} atoms)`);
        }
    });

    listen(engine, EVENTS.INDEXING_PROGRESS, (e) => {
        showIndexingUI(true);
        const { indexedFrames, percent } = e.detail;
        handleProgress(percent, indexedFrames, indexedFrames * 1000);
    });

    listen(engine, EVENTS.INDEXING_COMPLETE, (e) => {
        finalizeLoad(e.detail.totalFrames);
    });

    // Viewport Drag-and-Drop Ingestion (via engine FILE_DROPPED event)
    listen(engine, EVENTS.FILE_DROPPED, (e) => {
        const { file, category } = e.detail || {};
        if (!file) return;

        if (category === 'trajectory') {
            const expectedAtoms = engine.atomCount || 0;
            showIndexingUI(true);
            engine.loadTrajectory(file, expectedAtoms, null, finalizeLoad);
        } else {
            confirmBeforeNewSession(async () => {
                await handleTopologyFile(file);
            });
        }
    });

    // ==========================================
    // New Session Confirmation Interceptor
    // ==========================================
    const confirmBeforeNewSession = (onProceed) => {
        if (!engine.hasStructure) {
            onProceed();
            return;
        }

        pendingUploadCallback = onProceed;
        const modal = document.getElementById('new-session-modal');
        const label = document.getElementById('confirm-modal-active-struct');
        if (label) {
            const sName = engine.structureName || 'Structure';
            const sAtoms = engine.atomCount || atomCount || 0;
            label.innerText = `${sName} (${sAtoms} atoms)`;
        }
        modal?.showModal();
        refreshIcons();
    };

    // Wire new-session confirmation modal buttons
    const newSessionModal = document.getElementById('new-session-modal');
    if (newSessionModal) {
        listen(newSessionModal, 'close', () => {
            pendingUploadCallback = null;
        });

        listen(newSessionModal, 'click', (e) => {
            if (e.target === newSessionModal) {
                newSessionModal.close();
                pendingUploadCallback = null;
            }
        });
    }

    const btnNewCancel = document.getElementById('btn-new-session-cancel');
    if (btnNewCancel) {
        listen(btnNewCancel, 'click', () => {
            newSessionModal?.close();
            pendingUploadCallback = null;
        });
    }

    const btnNewProceed = document.getElementById('btn-new-session-proceed');
    if (btnNewProceed) {
        listen(btnNewProceed, 'click', () => {
            newSessionModal?.close();
            engine.clear();
            if (pendingUploadCallback) {
                const cb = pendingUploadCallback;
                pendingUploadCallback = null;
                cb();
            }
        });
    }

    const btnNewExport = document.getElementById('btn-new-session-export');
    if (btnNewExport) {
        listen(btnNewExport, 'click', () => {
            newSessionModal?.close();
            engine.exportSessionFile();
            engine.clear();
            if (pendingUploadCallback) {
                const cb = pendingUploadCallback;
                pendingUploadCallback = null;
                cb();
            }
        });
    }

    // ==========================================
    // Sample Files Modal (Quick Load & Local Downloads)
    // ==========================================
    const exampleModal = document.getElementById('example-showcase-modal');
    const btnExampleShowcase = document.getElementById('btn-example-showcase');
    const btnCloseExampleModal = document.getElementById('btn-close-example-modal');
    const btnExampleModalClose = document.getElementById('btn-example-modal-close');
    const btnQuickStart = document.getElementById('btn-quick-start');
    const btnQuickStartText = document.getElementById('btn-quick-start-text');

    const tabBtnQuick = document.getElementById('tab-btn-quick');
    const tabBtnDownload = document.getElementById('tab-btn-download');
    const tabPanelQuick = document.getElementById('tab-panel-quick');
    const tabPanelDownload = document.getElementById('tab-panel-download');

    const quickStatusLabel = document.getElementById('quick-status-label');
    const quickStatusIcon = document.getElementById('quick-status-icon');
    const quickOverallPct = document.getElementById('quick-overall-pct');
    const quickProgressPct = document.getElementById('quick-progress-pct');
    const quickProgressBar = document.getElementById('quick-progress-bar');

    const quickPdbProgressBar = document.getElementById('quick-pdb-progress-bar');
    const quickPdbPct = document.getElementById('quick-pdb-pct');
    const quickPdbStatus = document.getElementById('quick-pdb-status');
    const quickPdbCounter = document.getElementById('quick-pdb-counter');

    const quickXtcProgressBar = document.getElementById('quick-xtc-progress-bar');
    const quickXtcPct = document.getElementById('quick-xtc-pct');
    const quickXtcStatus = document.getElementById('quick-xtc-status');
    const quickXtcCounter = document.getElementById('quick-xtc-counter');

    let currentQuickPdbPct = 0;
    let currentQuickXtcPct = 0;

    const recalculateQuickOverallProgress = (customStatus = null) => {
        const avg = Math.round((currentQuickPdbPct * 0.35) + (currentQuickXtcPct * 0.65));
        if (quickOverallPct) quickOverallPct.innerText = `${avg}%`;
        if (quickProgressPct) quickProgressPct.innerText = `${avg}%`;
        if (quickProgressBar) quickProgressBar.style.width = `${avg}%`;
        if (customStatus && quickStatusLabel) {
            quickStatusLabel.innerText = customStatus;
        }
    };

    const updateQuickPdbProgress = (pct, status, counterText) => {
        if (pct !== null) {
            currentQuickPdbPct = Math.max(0, Math.min(100, pct));
            if (quickPdbProgressBar) quickPdbProgressBar.style.width = `${currentQuickPdbPct}%`;
            if (quickPdbPct) quickPdbPct.innerText = `${Math.round(currentQuickPdbPct)}%`;
        }
        if (quickPdbStatus && status) quickPdbStatus.innerText = status;
        if (quickPdbCounter && counterText) quickPdbCounter.innerText = counterText;
        recalculateQuickOverallProgress();
    };

    const updateQuickXtcProgress = (pct, status, counterText) => {
        if (pct !== null) {
            currentQuickXtcPct = Math.max(0, Math.min(100, pct));
            if (quickXtcProgressBar) quickXtcProgressBar.style.width = `${currentQuickXtcPct}%`;
            if (quickXtcPct) quickXtcPct.innerText = `${Math.round(currentQuickXtcPct)}%`;
        }
        if (quickXtcStatus && status) quickXtcStatus.innerText = status;
        if (quickXtcCounter && counterText) quickXtcCounter.innerText = counterText;
        recalculateQuickOverallProgress();
    };

    const resetQuickModalUI = (errMessage = null) => {
        currentQuickPdbPct = 0;
        currentQuickXtcPct = 0;
        if (btnQuickStart) {
            btnQuickStart.disabled = false;
            btnQuickStart.classList.remove('opacity-75', 'cursor-not-allowed');
        }
        if (btnQuickStartText) {
            btnQuickStartText.innerText = errMessage ? 'Retry Quick Load' : 'Instant Quick Load';
        }
        if (quickStatusIcon) {
            quickStatusIcon.setAttribute('data-lucide', errMessage ? 'alert-circle' : 'circle-dot');
            quickStatusIcon.classList.remove('animate-spin', 'text-amber-500', 'text-emerald-600');
            quickStatusIcon.classList.add(errMessage ? 'text-rose-600' : 'text-blue-600');
        }
        if (quickStatusLabel) {
            quickStatusLabel.innerText = errMessage || 'Ready to load bundled sample';
        }
        if (quickOverallPct) quickOverallPct.innerText = '0%';
        if (quickProgressPct) quickProgressPct.innerText = '0%';
        if (quickProgressBar) quickProgressBar.style.width = '0%';

        if (quickPdbProgressBar) quickPdbProgressBar.style.width = '0%';
        if (quickPdbPct) quickPdbPct.innerText = '0%';
        if (quickPdbStatus) quickPdbStatus.innerText = 'Idle';
        if (quickPdbCounter) quickPdbCounter.innerText = '0.0 / ~504 KB';

        if (quickXtcProgressBar) quickXtcProgressBar.style.width = '0%';
        if (quickXtcPct) quickXtcPct.innerText = '0%';
        if (quickXtcStatus) quickXtcStatus.innerText = 'Idle';
        if (quickXtcCounter) quickXtcCounter.innerText = '0.0 / ~3.0 MB';

        refreshIcons();
    };

    const selectSampleTab = (tabName) => {
        const tabs = [
            { name: 'quick', btn: tabBtnQuick, panel: tabPanelQuick },
            { name: 'download', btn: tabBtnDownload, panel: tabPanelDownload }
        ];

        tabs.forEach(t => {
            if (!t.btn || !t.panel) return;
            const isActive = t.name === tabName;
            if (isActive) {
                t.btn.classList.add('bg-white', 'text-blue-700', 'shadow-2xs');
                t.btn.classList.remove('text-slate-600');
                t.panel.classList.remove('hidden');
            } else {
                t.btn.classList.remove('bg-white', 'text-blue-700', 'shadow-2xs');
                t.btn.classList.add('text-slate-600');
                t.panel.classList.add('hidden');
            }
        });

        if (btnQuickStart) {
            btnQuickStart.classList.toggle('hidden', tabName !== 'quick');
        }

        refreshIcons();
    };

    if (tabBtnQuick) {
        listen(tabBtnQuick, 'click', () => selectSampleTab('quick'));
    }
    if (tabBtnDownload) {
        listen(tabBtnDownload, 'click', () => selectSampleTab('download'));
    }

    const openExampleModal = () => {
        if (!exampleModal) return;
        exampleModal.showModal();
        refreshIcons();
    };

    const closeExampleModal = () => {
        if (!exampleModal) return;
        exampleModal.close();
    };

    if (btnExampleShowcase) listen(btnExampleShowcase, 'click', openExampleModal);
    if (btnCloseExampleModal) listen(btnCloseExampleModal, 'click', closeExampleModal);
    if (btnExampleModalClose) listen(btnExampleModalClose, 'click', closeExampleModal);

    if (exampleModal) {
        listen(exampleModal, 'click', (e) => {
            if (e.target === exampleModal) {
                closeExampleModal();
            }
        });
    }

    const readStreamWithProgress = async (response, defaultTotalBytes, onProgress) => {
        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : defaultTotalBytes;
        const reader = response.body.getReader();
        const chunks = [];
        let receivedBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedBytes += value.byteLength;
            const pct = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
            if (onProgress) {
                onProgress(pct, receivedBytes, totalBytes);
            }
        }
        return { chunks, totalBytes, receivedBytes };
    };

    if (btnQuickStart) {
        listen(btnQuickStart, 'click', () => {
            confirmBeforeNewSession(async () => {
                if (btnQuickStart) {
                    btnQuickStart.disabled = true;
                    btnQuickStart.classList.add('opacity-75', 'cursor-not-allowed');
                }
                if (btnQuickStartText) {
                    btnQuickStartText.innerText = 'Loading Bundled Demo...';
                }
                if (quickStatusIcon) {
                    quickStatusIcon.setAttribute('data-lucide', 'loader-2');
                    quickStatusIcon.classList.add('animate-spin');
                    quickStatusIcon.classList.remove('text-rose-600', 'text-emerald-600');
                    quickStatusIcon.classList.add('text-blue-600');
                }
                refreshIcons();

                try {
                    showToast("Loading bundled sample simulation...", "info");
                    const baseUrl = import.meta.env?.BASE_URL || '/';
                    const demoPdbUrl = `${baseUrl}demo/demo.pdb`;
                    const demoXtcUrl = `${baseUrl}demo/demo.xtc`;
                    logger.log('info', 'SAMPLE', `Loading bundled sample files from ${demoPdbUrl} and ${demoXtcUrl} (Phosphoglycerate kinase, glycosomal)`);

                    if (quickStatusLabel) quickStatusLabel.innerText = "Fetching topology (.pdb) & trajectory (.xtc)...";

                    const topolPromise = (async () => {
                        updateQuickPdbProgress(5, "Connecting...", "Connecting...");
                        const pdbRes = await fetch(demoPdbUrl);
                        if (!pdbRes.ok) throw new Error(`Failed to load ${demoPdbUrl} (HTTP ${pdbRes.status})`);
                        const contentType = pdbRes.headers.get('content-type') || '';
                        if (contentType.includes('text/html')) {
                            throw new Error(`${demoPdbUrl} not found (server returned HTML). Please ensure demo.pdb is placed in public/demo/.`);
                        }

                        const { chunks } = await readStreamWithProgress(pdbRes, 504073, (pct, receivedBytes, totalBytes) => {
                            updateQuickPdbProgress(
                                pct,
                                `Loading (${(receivedBytes / 1024).toFixed(0)} KB)...`,
                                `${(receivedBytes / 1024).toFixed(1)} / ${(totalBytes / 1024).toFixed(1)} KB`
                            );
                        });

                        const pdbBlob = new Blob(chunks, { type: 'chemical/x-pdb' });
                        const pdbFile = new File([pdbBlob], 'demo.pdb', { type: 'chemical/x-pdb' });
                        updateQuickPdbProgress(100, "Parsing structure...", `${(pdbFile.size / 1024).toFixed(1)} KB`);

                        const count = await engine.loadTopology(pdbFile);
                        atomCount = count;
                        logger.log('info', 'SAMPLE', `Bundled demo topology loaded (${atomCount} atoms)`);
                        unlockTrajectoryUI('demo.pdb', `demo.pdb (${atomCount} atoms)`, { count: atomCount, size: pdbFile.size });
                        updateQuickPdbProgress(100, `Loaded (${atomCount.toLocaleString()} atoms)`, `${(pdbFile.size / 1024).toFixed(1)} KB`);
                        return count;
                    })();

                    const trajPromise = (async () => {
                        updateQuickXtcProgress(5, "Connecting...", "Connecting...");
                        const xtcRes = await fetch(demoXtcUrl);
                        if (!xtcRes.ok) throw new Error(`Failed to load ${demoXtcUrl} (HTTP ${xtcRes.status})`);
                        const contentType = xtcRes.headers.get('content-type') || '';
                        if (contentType.includes('text/html')) {
                            throw new Error(`${demoXtcUrl} not found. Please upload your original demo.xtc into public/demo/.`);
                        }

                        const { chunks } = await readStreamWithProgress(xtcRes, 2970644, (pct, receivedBytes, totalBytes) => {
                            updateQuickXtcProgress(
                                pct,
                                `Loading (${(receivedBytes / 1048576).toFixed(1)} MB)...`,
                                `${(receivedBytes / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB`
                            );
                        });

                        const xtcBlob = new Blob(chunks, { type: 'application/octet-stream' });
                        const xtcFile = new File([xtcBlob], 'demo.xtc', { type: 'application/octet-stream' });
                        updateQuickXtcProgress(100, "Download Complete", `${(xtcFile.size / 1048576).toFixed(1)} MB`);
                        return xtcFile;
                    })();

                    const [loadedAtomCount, xtcFile] = await Promise.all([topolPromise, trajPromise]);

                    recalculateQuickOverallProgress("Indexing Binary Trajectory Frames...");
                    updateQuickXtcProgress(100, "Indexing Frames (Web Worker)...", `${(xtcFile.size / 1048576).toFixed(1)} MB`);
                    showToast("Indexing sample trajectory...", "info");

                    engine.loadTrajectory(xtcFile, loadedAtomCount, (percent, frames) => {
                        updateQuickXtcProgress(
                            percent,
                            `Indexing: ${frames} frames found (${percent}%)`,
                            `${(xtcFile.size / 1048576).toFixed(1)} MB`
                        );
                    }, (totalFrames) => {
                        finalizeLoad(totalFrames);
                        updateQuickXtcProgress(100, `Indexed ${totalFrames} frames`, `${(xtcFile.size / 1048576).toFixed(1)} MB`);
                        recalculateQuickOverallProgress("Sample loaded successfully!");

                        if (quickStatusIcon) {
                            quickStatusIcon.setAttribute('data-lucide', 'check-circle');
                            quickStatusIcon.classList.remove('animate-spin', 'text-blue-600', 'text-rose-600');
                            quickStatusIcon.classList.add('text-emerald-600');
                            refreshIcons();
                        }

                        const loopSelect = document.getElementById('loop-mode-select');
                        if (loopSelect) {
                            loopSelect.value = 'full';
                            loopSelect.dispatchEvent(new Event('change'));
                        } else if (engine.setLoop) {
                            engine.setLoop(true);
                        }

                        if (engine.play) {
                            engine.play();
                        }

                        const playerUi = document.getElementById('player-ui');
                        if (playerUi) {
                            playerUi.classList.remove('opacity-50', 'pointer-events-none');
                        }

                        setTimeout(() => {
                            closeExampleModal();
                            if (btnQuickStart) {
                                btnQuickStart.disabled = false;
                                btnQuickStart.classList.remove('opacity-75', 'cursor-not-allowed');
                            }
                            if (btnQuickStartText) {
                                btnQuickStartText.innerText = 'Instant Quick Load';
                            }
                            showToast(`Phosphoglycerate kinase loaded! Playing ${totalFrames} frames in loop`, "info");
                        }, 600);
                    });
                } catch (err) {
                    logger.log('error', 'SAMPLE', `Failed to load bundled demo: ${err.message}`);
                    showToast(`Failed to load bundled demo: ${err.message}`, "error");
                    resetQuickModalUI(err.message);
                }
            });
        });
    }

    // ==========================================
    // Topology Input & Drag-and-Drop
    // ==========================================
    const handleTopologyFile = async (file) => {
        if (!file) return;
        try {
            logger.log('info', 'TOPOLOGY', `Loading local topology file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
            atomCount = await engine.loadTopology(file);
            logger.log('info', 'TOPOLOGY', `Structure ${file.name} loaded successfully (${atomCount} atoms)`);
            unlockTrajectoryUI(file.name, `${file.name} (${atomCount} atoms)`, { count: atomCount, size: file.size });
        } catch (e) {
            logger.log('error', 'FILE', `Failed to load topology file: ${e.message}`);
            showToast(`Failed to load topology: ${e.message}`, "error");
        }
    };

    setupDropZone('drop-zone-struct', 'upload-struct', (file) => {
        confirmBeforeNewSession(() => {
            handleTopologyFile(file);
        });
    }, {}, document, listen);

    const btnUnloadStruct = document.getElementById('btn-unload-struct');
    if (btnUnloadStruct) {
        listen(btnUnloadStruct, 'click', (e) => {
            e.stopPropagation();
            engine.clear();
            showToast("Structure unloaded and workspace cleared.", "info");
        });
    }

    const setupInfoPopover = (btnId, boxId) => {
        const btn = document.getElementById(btnId);
        const box = document.getElementById(boxId);
        const wrapper = btn?.closest('.info-popover-wrapper');
        if (!btn || !box) return;

        const show = () => {
            box.classList.remove('hidden');
            refreshIcons();
        };

        const hide = () => {
            box.classList.add('hidden');
        };

        listen(btn, 'click', (e) => {
            e.stopPropagation();
            if (box.classList.contains('hidden')) {
                show();
            } else {
                hide();
            }
        });

        if (wrapper) {
            listen(wrapper, 'mouseleave', () => {
                hide();
            });
        }

        listen(btn, 'mouseleave', (e) => {
            if (!box.contains(e.relatedTarget)) {
                hide();
            }
        });

        listen(box, 'mouseleave', () => {
            hide();
        });

        listen(document, 'click', (e) => {
            if (!wrapper?.contains(e.target)) {
                hide();
            }
        });
    };

    setupInfoPopover('btn-info-struct', 'infobox-struct');
    setupInfoPopover('btn-info-traj', 'infobox-traj');

    // ==========================================
    // Trajectory Input & Drag-and-Drop
    // ==========================================
    setupDropZone('drop-zone-traj', 'upload-traj', (file) => {
        if (!file) return;
        logger.log('info', 'TRAJECTORY', `Loading trajectory file: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);
        showIndexingUI(true);
        engine.loadTrajectory(file, atomCount, null, finalizeLoad);
    }, {}, document, listen);

    function showIndexingUI(visible) {
        const ui = document.getElementById('indexing-ui');
        const miniIndexing = document.getElementById('mini-indexing');
        if (!ui) return;
        if (visible) {
            ui.classList.remove('hidden');
            ui.classList.add('flex');
            const title = document.getElementById('indexing-title');
            const icon = document.getElementById('indexing-icon');
            if (title) title.innerText = "Indexing Binary...";
            if (icon) {
                icon.classList.add('animate-spin');
                icon.setAttribute('data-lucide', 'loader-2');
                refreshIcons();
            }
            if (miniIndexing) {
                miniIndexing.classList.remove('hidden');
                miniIndexing.classList.add('flex');
                const miniPercent = document.getElementById('mini-indexing-percent');
                if (miniPercent) miniPercent.innerText = "0%";
                miniIndexing.setAttribute('title', 'Indexing Trajectory: 0%');
            }
        } else {
            ui.classList.add('hidden');
            ui.classList.remove('flex');
            if (miniIndexing) {
                miniIndexing.classList.add('hidden');
                miniIndexing.classList.remove('flex');
            }
        }
    }

    function handleProgress(percent, framesFound, bytesIndexed) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        const playerUi = document.getElementById('player-ui');
        const miniPercent = document.getElementById('mini-indexing-percent');
        const miniIndexing = document.getElementById('mini-indexing');

        if (framesFound > 0 && playerUi) {
            playerUi.classList.remove('opacity-50', 'pointer-events-none');
        }

        if (!progressBar || !progressText) return;

        if (percent !== null) {
            progressBar.classList.remove('animate-pulse', 'w-full');
            progressBar.style.width = percent + '%';
            progressText.innerText = `${percent}% (${framesFound} frames)`;
            if (miniPercent) miniPercent.innerText = `${percent}%`;
            if (miniIndexing) miniIndexing.setAttribute('title', `Indexing Trajectory: ${percent}% (${framesFound} frames)`);
        } else {
            const mbScanned = (bytesIndexed / 1048576).toFixed(0);
            progressBar.style.width = '100%';
            progressBar.classList.add('animate-pulse');
            progressText.innerText = `Scanning: ${mbScanned} MB (${framesFound} frames)`;
            if (miniPercent) miniPercent.innerText = `${mbScanned}MB`;
            if (miniIndexing) miniIndexing.setAttribute('title', `Scanning Trajectory: ${mbScanned} MB (${framesFound} frames)`);
        }
    }

    function finalizeLoad(totalFrames) {
        logger.log('info', 'TRAJECTORY', `Trajectory indexing finalized. Total frames: ${totalFrames}`);
        
        const title = document.getElementById('indexing-title');
        const icon = document.getElementById('indexing-icon');
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        if (title) title.innerText = "Indexing Complete";
        if (icon) {
            icon.classList.remove('animate-spin');
            icon.setAttribute('data-lucide', 'check-circle-2');
            refreshIcons();
        }

        if (progressBar) {
            progressBar.classList.remove('animate-pulse');
            progressBar.style.width = '100%';
        }
        if (progressText) {
            progressText.innerText = `100% (${totalFrames} frames)`;
        }

        const btnMiniTraj = document.getElementById('btn-mini-traj');
        if (btnMiniTraj) {
            btnMiniTraj.classList.remove('text-slate-400', 'opacity-50', 'pointer-events-none');
            btnMiniTraj.classList.add('text-slate-700');
            const trajIcon = btnMiniTraj.querySelector('svg, [data-lucide], i');
            if (trajIcon) {
                trajIcon.classList.remove('text-slate-400');
                trajIcon.classList.add('text-slate-500');
            }
            btnMiniTraj.setAttribute('title', `Trajectory: ${totalFrames} frames loaded (.xtc)`);
        }

        const miniTrajDot = document.getElementById('mini-traj-dot');
        if (miniTrajDot) {
            miniTrajDot.classList.remove('hidden');
            miniTrajDot.setAttribute('title', `Trajectory: ${totalFrames} frames loaded`);
        }
        const miniIndexing = document.getElementById('mini-indexing');
        if (miniIndexing) {
            miniIndexing.classList.add('hidden');
            miniIndexing.classList.remove('flex');
        }

        const frameMax = document.getElementById('frame-max');
        const slider = document.getElementById('frame-slider');
        const playerUi = document.getElementById('player-ui');

        if (frameMax) frameMax.innerText = totalFrames;
        if (slider) slider.max = totalFrames;
        if (playerUi) playerUi.classList.remove('opacity-50', 'pointer-events-none');
    }

    // ==========================================
    // Collapse and Expand Sidebar Controls
    // ==========================================
    const sidebar = document.getElementById('sidebar');

    function collapseSidebar() {
        if (!sidebar) return;
        sidebar.dataset.collapsed = 'true';
        const playerUI = document.getElementById('player-ui');
        if (playerUI) {
            playerUI.classList.remove('sidebar-open');
        }
        refreshIcons();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    }

    function expandSidebar() {
        if (!sidebar) return;
        sidebar.dataset.collapsed = 'false';
        const playerUI = document.getElementById('player-ui');
        if (playerUI) {
            playerUI.classList.add('sidebar-open');
        }
        refreshIcons();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    }

    document.querySelectorAll('#btn-collapse-sidebar, .btn-collapse-sidebar').forEach(btn => {
        listen(btn, 'click', collapseSidebar);
    });
    document.querySelectorAll('#btn-expand-sidebar, #btn-expand-sidebar-mini, .btn-expand-sidebar').forEach(btn => {
        listen(btn, 'click', expandSidebar);
    });
    if (sidebar) {
        listen(sidebar, 'transitionend', (e) => {
            if (e.propertyName === 'width') {
                window.dispatchEvent(new Event('resize'));
            }
        });
    }

    // Left Sidebar Mini Controls
    const btnMiniStruct = document.getElementById('btn-mini-struct');
    if (btnMiniStruct) {
        listen(btnMiniStruct, 'click', () => {
            confirmBeforeNewSession(() => {
                document.getElementById('upload-struct')?.click();
            });
        });
    }

    const btnMiniTraj = document.getElementById('btn-mini-traj');
    if (btnMiniTraj) {
        listen(btnMiniTraj, 'click', () => {
            document.getElementById('upload-traj')?.click();
        });
    }

    const btnMiniLogger = document.getElementById('btn-open-logger-mini');
    if (btnMiniLogger) {
        listen(btnMiniLogger, 'click', () => {
            document.getElementById('log-modal')?.showModal();
        });
    }
}
