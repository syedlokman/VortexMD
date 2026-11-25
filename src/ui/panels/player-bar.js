import { showToast } from '../shell/toast.js';
import { downloadBlob } from '../../shared/download.js';
import { getElement, bindSelectToLabel, setActiveState, escapeHtml } from '../shell/dom-utils.js';
import { EVENTS } from '../../contracts/events.js';
import { refreshIcons } from '../shell/icons.js';

let preBounceLoopMode = null;

export function initPlayerBar({ engine, listen }) {
    const player = engine;
    const btnPlay = getElement('btn-play');
    const slider = getElement('frame-slider');
    const frameInput = getElement('frame-input');
    const physTimeLabel = getElement('phys-time-label');
    const loopModeSelect = getElement('loop-mode-select');
    const speedSelect = getElement('speed-select');
    const dirSelect = getElement('direction-select');
    const dirModeLabel = getElement('direction-mode-label');
    const mouseSchemeSelect = getElement('mouse-scheme-select');
    const btnSaveImage = getElement('btn-save-image');
    const imageResSelect = getElement('image-res-select');
    const snapshotResLabel = getElement('snapshot-res-label');
    const videoFormatLabel = getElement('video-format-label');
    const btnCenterView = getElement('btn-center-view');
    const btnSpin = getElement('btn-spin');
    const btnRock = getElement('btn-rock');
    const speedLabel = getElement('speed-label');
    const mouseSchemeLabel = getElement('mouse-scheme-label');
    const bgColorLabel = getElement('bg-color-label');

    // Active Site Depth Slicing (Feature Streamlined)
    const focusSlicePopover = getElement('focus-slice-popover');
    const focusSliceSlider = getElement('focus-slice-slider');
    const focusSliceValLabel = getElement('focus-slice-val-label');
    const btnResetFocusSlice = getElement('btn-reset-focus-slice');

    // Video & Scene Export UI elements
    const btnExportVideo = getElement('btn-export-video');
    const videoFormatSelect = getElement('video-format-select');
    const exportBgSelect = getElement('export-bg-select');
    const exportProjSelect = getElement('export-proj-select');
    const videoExportOverlay = getElement('video-export-overlay');
    const videoProgressCard = getElement('video-progress-card');
    const videoProgressText = getElement('video-progress-text');
    const videoProgressPct = getElement('video-progress-pct');
    const videoProgressBar = getElement('video-progress-bar');
    const videoExportAdvisory = getElement('video-export-advisory');
    const btnCancelVideoExport = getElement('btn-cancel-video-export');
    const exportDropdownMenu = getElement('export-dropdown-menu');

    // Timeline Pin UI elements
    const btnAddPin = getElement('btn-add-pin');
    const pinPopover = getElement('pin-popover');
    const pinPopoverFrameLabel = getElement('pin-popover-frame-label');
    const pinLabelInput = getElement('pin-label-input');
    const btnSavePin = getElement('btn-save-pin');
    const pinsContainer = getElement('timeline-pins-container');

    // A/B Dimming elements
    const trackDimLeft = getElement('track-dim-left');
    const trackDimRight = getElement('track-dim-right');

    let sliderRafId = null;
    let pendingFrameVal = null;
    let indexedMaxFrame = 100;
    let totalEstimatedFrames = 100;
    let isIndexing = false;
    let tooltipTimeout = null;
    let isSpinActive = false;
    let isRockActive = false;

    // Time calibration & physics config inputs
    const timestepInput = getElement('timestep-input');
    const timeOffsetInput = getElement('time-offset-input');
    const splineToggle = getElement('spline-toggle');

    const handleTimeConfigChange = () => {
        const dtVal = timestepInput ? parseFloat(timestepInput.value) : undefined;
        const toVal = timeOffsetInput ? parseFloat(timeOffsetInput.value) : undefined;
        player.setPhysicalTimeConfig(dtVal, toVal);
    };

    if (timestepInput) {
        listen(timestepInput, 'input', handleTimeConfigChange);
        listen(timestepInput, 'change', handleTimeConfigChange);
    }
    if (timeOffsetInput) {
        listen(timeOffsetInput, 'input', handleTimeConfigChange);
        listen(timeOffsetInput, 'change', handleTimeConfigChange);
    }
    if (splineToggle) {
        listen(splineToggle, 'change', (e) => {
            player.setSplineInterpolation(e.target.checked);
        });
    }

    listen(player, EVENTS.TIME_CONFIG_CHANGED, (e) => {
        const detail = e.detail || {};
        if (timestepInput && detail.deltaTime !== undefined && document.activeElement !== timestepInput) {
            timestepInput.value = detail.deltaTime;
        }
        if (timeOffsetInput && detail.timeOffset !== undefined && document.activeElement !== timeOffsetInput) {
            timeOffsetInput.value = detail.timeOffset;
        }
    });

    const setSpinState = (active) => {
        isSpinActive = active;
        player.setSpin(active);
        setActiveState(btnSpin, active, ['text-blue-600', 'bg-blue-100', 'border-blue-200'], ['text-slate-400']);
    };

    const setRockState = (active) => {
        isRockActive = active;
        player.setRock(active);
        setActiveState(btnRock, active, ['text-blue-600', 'bg-blue-100', 'border-blue-200'], ['text-slate-400']);
    };

    if (btnSpin) {
        listen(btnSpin, 'click', () => {
            if (isSpinActive) {
                setSpinState(false);
            } else {
                if (isRockActive) setRockState(false);
                setSpinState(true);
            }
        });
    }

    if (btnRock) {
        listen(btnRock, 'click', () => {
            if (isRockActive) {
                setRockState(false);
            } else {
                if (isSpinActive) setSpinState(false);
                setRockState(true);
            }
        });
    }

    // Image Snapshot Resolution Mapping
    bindSelectToLabel(imageResSelect, snapshotResLabel, () => {
        if (!imageResSelect) return '';
        const opt = imageResSelect.options[imageResSelect.selectedIndex];
        return opt ? opt.text : '';
    }, null, listen);

    // Mouse Control Scheme (WebGL, PyMOL, Coot)
    const updateMouseSchemeLabel = (scheme) => {
        const name = scheme === 'default' ? 'WebGL' : (scheme === 'pymol' ? 'PyMOL' : 'Coot');
        if (mouseSchemeLabel) {
            mouseSchemeLabel.innerText = name;
            mouseSchemeLabel.title = `Mouse Navigation Scheme: ${name}`;
        }
        return name;
    };

    bindSelectToLabel(mouseSchemeSelect, mouseSchemeLabel, updateMouseSchemeLabel, (val) => {
        player.setMouseScheme(val);
        const schemeName = val === 'default' ? 'WEBGL' : val.toUpperCase();
        showToast(`Mouse Controls: ${schemeName}`, 'info');
    }, listen);

    // Playback Speed Multiplier
    const updateSpeedLabel = (val) => {
        if (speedLabel) speedLabel.innerText = `${val}×`;
        return `${val}×`;
    };

    bindSelectToLabel(speedSelect, speedLabel, updateSpeedLabel, (val) => {
        const speedVal = parseFloat(val);
        player.setPlaybackSpeed(speedVal);
    }, listen);

    // Playback Direction / Traversal Mode (F, R, B)
    const updateDirLabel = (val) => {
        let labelText = 'F';
        if (val === 'backward') {
            labelText = 'R';
            if (dirModeLabel) dirModeLabel.title = 'Playback Direction: Reverse';
        } else if (val === 'bounce') {
            labelText = 'B';
            if (dirModeLabel) dirModeLabel.title = 'Playback Direction: Bounce';
        } else {
            if (dirModeLabel) dirModeLabel.title = 'Playback Direction: Forward';
        }
        if (dirModeLabel) dirModeLabel.innerText = labelText;
        return labelText;
    };

    bindSelectToLabel(dirSelect, dirModeLabel, updateDirLabel, (val) => {
        player.setPlaybackDirection(val);
        if (val === 'bounce') {
            preBounceLoopMode = loopModeSelect ? loopModeSelect.value : 'off';
            player.setLoop(true);
            if (loopModeSelect) {
                loopModeSelect.value = 'full';
            }
            updateLoopSelectLabel();
            showToast('Loop enabled for Bounce playback', 'info');
        } else if (preBounceLoopMode !== null) {
            if (preBounceLoopMode === 'off') {
                player.setLoop(false);
                if (loopModeSelect) {
                    loopModeSelect.value = 'off';
                }
            }
            updateDimMasks();
            updateLoopSelectLabel();
            preBounceLoopMode = null;
        }
    });

    // Live Slicing Slider Handler
    if (focusSliceSlider) {
        listen(focusSliceSlider, 'input', (e) => {
            const val = parseFloat(e.target.value);
            if (focusSliceValLabel) focusSliceValLabel.innerText = `${val}%`;
            player.setDepthSlicing(val);
        });
    }

    // Reset Slicing to 0% (Full Model)
    if (btnResetFocusSlice) {
        listen(btnResetFocusSlice, 'click', () => {
            if (focusSliceSlider) focusSliceSlider.value = 0;
            if (focusSliceValLabel) focusSliceValLabel.innerText = '0%';
            player.setDepthSlicing(0);
            showToast('Slicing reset to Full Model', 'info');
        });
    }

    // Re-Center Camera (🎯)
    if (btnCenterView) {
        listen(btnCenterView, 'click', () => {
            player.centerView();
        });
    }

    // Direct Click-to-Jump Numeric Frame Input
    let lastDigitCount = -1;
    const adjustFrameInputWidth = (val) => {
        if (!frameInput) return;
        const v = String(val ?? frameInput.value ?? '0');
        const digitCount = Math.max(1, Math.min(6, v.length));
        if (digitCount !== lastDigitCount) {
            lastDigitCount = digitCount;
            frameInput.style.width = `${Math.max(3.8, digitCount * 0.72 + 1.6)}rem`;
        }
    };

    if (frameInput) {
        listen(frameInput, 'input', (e) => {
            const val = parseInt(e.target.value, 10);
            adjustFrameInputWidth(e.target.value);
            if (!isNaN(val)) {
                const hasTraj = player.hasTrajectory;
                const min = hasTraj ? 1 : 0;
                const max = parseInt(frameInput.max || (hasTraj ? '100' : '0'), 10);
                const target = Math.max(min, Math.min(val, max));
                if (slider) slider.value = target;
                updateSliderTracks(target);
                player.jumpToFrame(target);
            }
        });

        listen(frameInput, 'focus', () => {
            if (player.isPlaying) {
                player.pause();
            }
        });
    }

    const commitFrameInput = () => {
        if (!frameInput) return;
        const hasTraj = player.hasTrajectory;
        const min = hasTraj ? 1 : 0;
        const max = parseInt(frameInput.max || (hasTraj ? '100' : '0'), 10);
        let target = parseInt(frameInput.value, 10);
        if (isNaN(target)) target = min;
        target = Math.max(min, Math.min(target, max));
        frameInput.value = target;
        adjustFrameInputWidth(target);
        if (slider) slider.value = target;
        updateSliderTracks(target);
        player.jumpToFrame(target);
        frameInput.blur();
    };

    if (frameInput) {
        listen(frameInput, 'keydown', (e) => {
            if (e.key === 'Enter') {
                commitFrameInput();
            }
        });

        listen(frameInput, 'change', commitFrameInput);
    }
    adjustFrameInputWidth(frameInput?.value || 0);

    const setPlayState = (playing) => {
        const iconPlay = document.getElementById('icon-play');
        const iconPause = document.getElementById('icon-pause');
        if (iconPlay) {
            iconPlay.classList.toggle('hidden', !!playing);
        }
        if (iconPause) {
            iconPause.classList.toggle('hidden', !playing);
        }
        if (btnPlay) {
            btnPlay.setAttribute('title', playing ? 'Pause (Space)' : 'Play (Space)');
            btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }
    };

    const scrubLockTooltip = document.getElementById('scrub-lock-tooltip');
    const scrubLockFrame = document.getElementById('scrub-lock-frame');
    const trackIndexed = document.getElementById('track-indexed');
    const trackPlayhead = document.getElementById('track-playhead');
    const frameMaxLabel = document.getElementById('frame-max');

    const updateSliderTracks = (currentFrame) => {
        const hasTraj = player.hasTrajectory;
        if (!hasTraj) {
            if (trackIndexed) trackIndexed.style.width = '100%';
            if (trackPlayhead) {
                trackPlayhead.style.left = '0%';
                trackPlayhead.style.width = '0%';
            }
            return;
        }
        const est = Math.max(1, totalEstimatedFrames);
        const indexedPct = isIndexing 
            ? Math.min(100, Math.max(0, (indexedMaxFrame / est) * 100))
            : 100;

        let playheadLeftPct = 0;
        let playheadWidthPct = 0;

        if (est > 1) {
            if (loopA > 1 && currentFrame >= loopA) {
                playheadLeftPct = Math.min(100, Math.max(0, ((loopA - 1) / (est - 1)) * 100));
                playheadWidthPct = Math.min(100 - playheadLeftPct, Math.max(0, ((currentFrame - loopA) / (est - 1)) * 100));
            } else {
                playheadLeftPct = 0;
                playheadWidthPct = Math.min(100, Math.max(0, ((currentFrame - 1) / (est - 1)) * 100));
            }
        }

        const nextIndexedWidth = `${indexedPct.toFixed(1)}%`;
        if (trackIndexed && trackIndexed.style.width !== nextIndexedWidth) {
            trackIndexed.style.width = nextIndexedWidth;
        }
        if (trackPlayhead) {
            const nextPlayheadLeft = `${playheadLeftPct.toFixed(1)}%`;
            const nextPlayheadWidth = `${playheadWidthPct.toFixed(1)}%`;
            if (trackPlayhead.style.left !== nextPlayheadLeft) trackPlayhead.style.left = nextPlayheadLeft;
            if (trackPlayhead.style.width !== nextPlayheadWidth) trackPlayhead.style.width = nextPlayheadWidth;
        }
    };

    const showLockTooltip = (maxPlayable) => {
        if (!scrubLockTooltip) return;
        if (scrubLockFrame) scrubLockFrame.innerText = maxPlayable.toString();
        scrubLockTooltip.classList.remove('hidden');
        if (tooltipTimeout) clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => {
            scrubLockTooltip.classList.add('hidden');
        }, 2200);
    };

    // --- A/B LOOPING & DIMMING MASKS ---
    let loopA = 0;
    let loopB = null;

    // Ensure loop is off by default
    player.setLoop(false);
    if (loopModeSelect) loopModeSelect.value = 'off';

    function hideDimMasks() {
        if (trackDimLeft) trackDimLeft.classList.add('hidden');
        if (trackDimRight) trackDimRight.classList.add('hidden');
    }

    function updateDimMasks() {
        const max = Math.max(1, parseInt(document.getElementById('frame-max')?.innerText || '100', 10));
        if (trackDimLeft) {
            if (loopA > 1 && max > 1) {
                const leftPct = Math.max(0, Math.min(100, ((loopA - 1) / (max - 1)) * 100));
                trackDimLeft.style.width = `${leftPct}%`;
                trackDimLeft.classList.remove('hidden');
            } else {
                trackDimLeft.classList.add('hidden');
            }
        }
        if (trackDimRight) {
            if (loopB !== null && loopB < max && max > 1) {
                const rightPct = Math.max(0, Math.min(100, ((max - loopB) / (max - 1)) * 100));
                trackDimRight.style.width = `${rightPct}%`;
                trackDimRight.classList.remove('hidden');
            } else {
                trackDimRight.classList.add('hidden');
            }
        }
    }

    function updateLoopSelectLabel() {
        if (!loopModeSelect) return;
        const max = Math.max(1, parseInt(document.getElementById('frame-max')?.innerText || '100', 10));
        let customOpt = loopModeSelect.querySelector('option[value="custom-ab"]');
        const loopLabel = document.getElementById('loop-mode-label');

        if (loopA > 1 || loopB !== null) {
            let labelText = '';
            let shortText = '';
            if (loopA > 1 && loopB !== null) {
                labelText = `Loop: [${loopA} - ${loopB}]`;
                shortText = `[${loopA}-${loopB}]`;
            } else if (loopA > 1) {
                labelText = `Loop: [${loopA} - ${max}]`;
                shortText = `[${loopA}-${max}]`;
            } else {
                labelText = `Loop: [1 - ${loopB}]`;
                shortText = `[1-${loopB}]`;
            }

            if (!customOpt) {
                customOpt = document.createElement('option');
                customOpt.value = 'custom-ab';
                loopModeSelect.insertBefore(customOpt, loopModeSelect.firstChild);
            }
            customOpt.innerText = labelText;
            loopModeSelect.value = 'custom-ab';
            if (loopLabel) {
                loopLabel.innerText = shortText;
                loopLabel.title = `Loop Range: ${shortText}`;
            }
        } else {
            if (customOpt) customOpt.remove();
            if (loopLabel) {
                const isAll = loopModeSelect.value === 'full';
                loopLabel.innerText = isAll ? 'All' : 'Off';
                loopLabel.title = `Loop Mode: ${isAll ? 'All' : 'Off'}`;
            }
        }
    }

    if (loopModeSelect) {
        listen(loopModeSelect, 'change', (e) => {
            const mode = e.target.value;
            const current = player.currentFrame || 1;

            if (mode === 'off') {
                loopA = 0;
                loopB = null;
                player.setLoop(false);
                player.clearLoopRange();
                hideDimMasks();
                updateLoopSelectLabel();
                updateSliderTracks(current);
                showToast('Playback looping disabled', 'info');
            } else if (mode === 'full') {
                loopA = 0;
                loopB = null;
                player.setLoop(true);
                player.clearLoopRange();
                hideDimMasks();
                updateLoopSelectLabel();
                updateSliderTracks(current);
                showToast('Looping full trajectory', 'info');
            } else if (mode === 'set-a') {
                loopA = current;
                updateDimMasks();
                updateLoopSelectLabel();
                updateSliderTracks(current);
                player.setLoop(true);
                const internalA = loopA > 1 ? loopA - 1 : 0;
                const internalB = loopB !== null ? loopB - 1 : null;
                player.setLoopRange(internalA, internalB);
                showToast(`Loop Start [A] set to Frame ${loopA}`, 'info');
            } else if (mode === 'set-b') {
                loopB = current;
                updateDimMasks();
                updateLoopSelectLabel();
                updateSliderTracks(current);
                player.setLoop(true);
                const internalA = loopA > 1 ? loopA - 1 : 0;
                const internalB = loopB - 1;
                player.setLoopRange(internalA, internalB);
                showToast(`Loop End [B] set to Frame ${loopB}`, 'info');
            } else if (mode === 'clear') {
                loopA = 0;
                loopB = null;
                player.clearLoopRange();
                player.setLoop(false);
                hideDimMasks();
                updateLoopSelectLabel();
                updateSliderTracks(current);
                loopModeSelect.value = 'off';
                updateLoopSelectLabel();
                showToast('Loop range cleared', 'info');
            }
        });
    }

    // --- TIMELINE EVENT PINS & INLINE BOOKMARK POPOVER ---
    if (btnAddPin) {
        listen(btnAddPin, 'click', () => {
            const current = player.currentFrame || 0;
            if (pinPopoverFrameLabel) {
                pinPopoverFrameLabel.innerText = `Bookmark Frame ${current}`;
            }
            if (pinLabelInput) {
                pinLabelInput.value = '';
            }
            setTimeout(() => pinLabelInput?.focus(), 50);
        });
    }

    const handleSavePin = () => {
        const current = player.currentFrame || 0;
        const text = pinLabelInput ? pinLabelInput.value.trim() : '';
        const label = text || `Event at Frame ${current}`;

        const currentPins = player.getPins();
        currentPins.push({ frame: current, label });
        player.setPins(currentPins);

        renderPins();
        if (pinPopover?.hidePopover) {
            pinPopover.hidePopover();
        } else {
            pinPopover?.classList.add('hidden');
        }
        showToast(`Bookmark pinned at Frame ${current}`, 'success');
    };

    if (btnSavePin) {
        listen(btnSavePin, 'click', () => {
            handleSavePin();
        });
    }

    if (pinLabelInput) {
        listen(pinLabelInput, 'keydown', (e) => {
            if (e.key === 'Enter') {
                handleSavePin();
            }
        });
    }

    if (pinsContainer) {
        listen(pinsContainer, 'click', (e) => {
            const dot = e.target.closest('[data-pin-frame]');
            if (!dot) return;
            e.stopPropagation();
            const frame = parseInt(dot.getAttribute('data-pin-frame'), 10);
            const label = dot.getAttribute('data-pin-label') || '';
            if (!isNaN(frame)) {
                player.jumpToFrame(frame);
                showToast(`Bookmark: ${label} (Frame ${frame})`, 'info');
            }
        });
    }

    function renderPins() {
        if (!pinsContainer) return;
        pinsContainer.innerHTML = '';
        const max = Math.max(1, parseInt(document.getElementById('frame-max')?.innerText || '100', 10));

        player.getPins().forEach((pin) => {
            const pct = max > 1 ? Math.min(100, Math.max(0, ((pin.frame - 1) / (max - 1)) * 100)) : 0;
            const dot = document.createElement('div');
            dot.className = 'group/pin absolute -top-1 w-3 h-3 bg-amber-400 hover:bg-amber-300 border-2 border-slate-900 rotate-45 cursor-pointer transition-transform hover:scale-125 shadow-md pointer-events-auto';
            dot.style.left = `calc(${pct}% - 6px)`;
            dot.setAttribute('data-pin-frame', String(pin.frame));
            dot.setAttribute('data-pin-label', pin.label || '');
            dot.title = `Frame ${pin.frame}: ${pin.label} (Click to jump)`;

            // Instant hover tooltip showing label
            const tooltip = document.createElement('div');
            tooltip.className = 'pointer-events-none opacity-0 group-hover/pin:opacity-100 transition-opacity duration-150 absolute -top-8 left-1/2 -translate-x-1/2 -rotate-45 bg-slate-900/95 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-xl border border-slate-700 whitespace-nowrap z-50';
            tooltip.innerText = `Frame ${pin.frame}: ${pin.label}`;
            dot.appendChild(tooltip);

            pinsContainer.appendChild(dot);
        });
    }

    const syncPinsFromPlayer = () => {
        renderPins();
    };

    listen(player, EVENTS.SESSION_RESTORED, (e) => {
        syncPinsFromPlayer();

        // Restore Loop A-B state in UI
        const { start: s, end: eFrame } = player.loopRange;
        const hasRange = (s > 0 || (eFrame !== null && eFrame !== undefined));
        if (hasRange) {
            loopA = s > 0 ? s + 1 : 0;
            loopB = (eFrame !== null && eFrame !== undefined) ? eFrame + 1 : null;
        } else {
            loopA = 0;
            loopB = null;
        }
        updateDimMasks();
        updateLoopSelectLabel();
        if (!hasRange) {
            if (loopModeSelect) {
                loopModeSelect.value = player.isLooping ? 'full' : 'off';
            }
        }
        updateSliderTracks(player.currentFrame || 1);

        const sessionData = e?.detail?.session;

        // Restore direction & speed in UI
        const dir = player.direction || sessionData?.playback?.playbackDirection;
        if (dirSelect && dir) {
            dirSelect.value = dir;
            updateDirLabel(dir);
        }

        const speed = player.speed ?? sessionData?.playback?.speedMultiplier;
        if (speedSelect && speed !== undefined) {
            speedSelect.value = String(speed);
            updateSpeedLabel(speed);
        }

        // Restore depth slicing in UI
        const depth = player.depthSlicing ?? sessionData?.visualState?.depthSlicing;
        if (focusSliceSlider && depth !== undefined) {
            focusSliceSlider.value = depth;
            if (focusSliceValLabel) {
                focusSliceValLabel.innerText = `${depth}%`;
            }
        }

        // Restore mouse navigation scheme in UI
        const mouseScheme = player.mouseScheme || sessionData?.visualState?.mouseScheme;
        if (mouseSchemeSelect && mouseScheme) {
            mouseSchemeSelect.value = mouseScheme;
            updateMouseSchemeLabel(mouseScheme);
        }

        // Restore background color in UI
        const restoredBg = sessionData?.visualState?.backgroundColor;
        if (restoredBg && exportBgSelect) {
            exportBgSelect.value = restoredBg;
            updateBgColorLabel(restoredBg);
        }

        // Restore timestep and time offset in drawer inputs if present
        const dt = player.deltaTime ?? sessionData?.playback?.deltaTime;
        if (timestepInput && dt !== undefined && document.activeElement !== timestepInput) {
            timestepInput.value = dt;
        }
        const to = player.timeOffset ?? sessionData?.playback?.timeOffset;
        if (timeOffsetInput && to !== undefined && document.activeElement !== timeOffsetInput) {
            timeOffsetInput.value = to;
        }
        const spline = sessionData?.playback?.useSplineInterpolation;
        if (splineToggle && spline !== undefined) {
            splineToggle.checked = Boolean(spline);
        }
    });

    listen(player, EVENTS.ENGINE_BUSY, (e) => {
        const isBusy = Boolean(e.detail && e.detail.busy);
        const playerUI = document.getElementById('player-ui');
        if (btnPlay) btnPlay.disabled = isBusy;
        if (slider) slider.disabled = isBusy;
        if (frameInput) frameInput.disabled = isBusy;
        if (playerUI) {
            if (isBusy) {
                playerUI.classList.add('opacity-75', 'pointer-events-none');
            } else {
                playerUI.classList.remove('opacity-75', 'pointer-events-none');
            }
        }
    });

    listen(player, EVENTS.PINS_UPDATED, syncPinsFromPlayer);
    listen(player, EVENTS.INDEXING_COMPLETE, () => renderPins());

    // --- AUTOMATED BACKGROUND VIDEO EXPORT WITH PROGRESS CARD ---
    let isExportingVideo = false;
    let videoMediaRecorder = null;
    let videoRecordedChunks = [];
    let videoOffFrame = null;
    let videoOffPlaybackEnded = null;
    let videoAnimFrameId = null;

    // Saved player parameters for restoration after video export
    let origLoopState = false;
    let origSpeedState = 1.0;
    let origDirectionState = 'forward';

    const restorePlayerExportParams = () => {
        player.setLoop(origLoopState);
        player.setPlaybackSpeed(origSpeedState);
        player.setPlaybackDirection(origDirectionState);
    };

    const cancelVideoExport = () => {
        if (!isExportingVideo) return;
        isExportingVideo = false;
        if (videoAnimFrameId) {
            cancelAnimationFrame(videoAnimFrameId);
            videoAnimFrameId = null;
        }
        if (videoOffFrame) {
            videoOffFrame();
            videoOffFrame = null;
        }
        if (videoOffPlaybackEnded) {
            videoOffPlaybackEnded();
            videoOffPlaybackEnded = null;
        }
        player.pause();
        restorePlayerExportParams();

        const playerUI = document.getElementById('player-ui');
        const slider = document.getElementById('frame-slider');
        const btnPlay = document.getElementById('btn-play');
        if (slider) slider.disabled = false;
        if (btnPlay) btnPlay.disabled = false;
        if (playerUI) playerUI.classList.remove('pointer-events-none', 'opacity-75');

        if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
            try {
                videoMediaRecorder.onstop = null;
                videoMediaRecorder.stop();
            } catch (err) {
                console.warn('Error stopping MediaRecorder on cancel:', err);
            }
        }
        videoRecordedChunks = [];
        if (videoExportOverlay) videoExportOverlay.classList.add('hidden');
        if (videoProgressCard) videoProgressCard.classList.add('hidden');
        if (videoExportAdvisory) videoExportAdvisory.classList.add('hidden');
        showToast('Video export cancelled.', 'info');
    };

    if (btnCancelVideoExport) {
        listen(btnCancelVideoExport, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelVideoExport();
        });
    }

    if (videoExportOverlay) {
        listen(videoExportOverlay, 'click', (e) => {
            if (e.target === videoExportOverlay) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        listen(videoExportOverlay, 'pointerdown', (e) => {
            if (e.target === videoExportOverlay) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    }

    if (videoProgressCard) {
        listen(videoProgressCard, 'click', (e) => {
            e.stopPropagation();
        });
        listen(videoProgressCard, 'pointerdown', (e) => {
            e.stopPropagation();
        });
    }

    listen(window, 'keydown', (e) => {
        if (e.key === 'Escape' && isExportingVideo) {
            e.preventDefault();
            e.stopPropagation();
            cancelVideoExport();
        }
    });

    if (btnExportVideo) {
        listen(btnExportVideo, 'click', async () => {
        if (isExportingVideo) {
            showToast('Video export already in progress...', 'warning');
            return;
        }

        const webglCanvas = player.getCanvas();
        if (!webglCanvas) {
            showToast('No active canvas to record.', 'warning');
            return;
        }

        const maxFrame = Math.max(1, parseInt(document.getElementById('frame-max')?.innerText || '100', 10));
        // Video rendering dynamically takes frame bounds from loop option only (A/B set or 0 to max)
        const startFrame = (loopA !== null && loopA !== undefined && loopA > 0) ? Math.min(loopA, maxFrame) : 0;
        const endFrame = (loopB !== null && loopB !== undefined && loopB > startFrame) ? Math.min(loopB, maxFrame) : maxFrame;
        const totalToRecord = Math.max(1, endFrame - startFrame);

        const format = videoFormatSelect ? videoFormatSelect.value : 'webm';
        let mimeType = 'video/webm';
        if (format === 'mp4') {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4; codecs=avc1')) {
                mimeType = 'video/mp4; codecs=avc1';
            } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')) {
                mimeType = 'video/mp4';
            } else {
                mimeType = 'video/webm';
            }
        } else {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                mimeType = 'video/webm; codecs=vp9';
            } else {
                mimeType = 'video/webm';
            }
        }

        // Ensure selected pre-capture scene settings (Background & Projection) are applied
        const bg = exportBgSelect ? exportBgSelect.value : 'white';
        player.setBackgroundColor(bg);

        const proj = exportProjSelect ? exportProjSelect.value : 'perspective';
        player.setCameraType(proj);

        const recordCanvas = document.createElement('canvas');
        recordCanvas.width = webglCanvas.width;
        recordCanvas.height = webglCanvas.height;
        const recordCtx = recordCanvas.getContext('2d');

        const bgColorHex = bg === 'black' ? '#000000' : '#ffffff';
        const renderExportFrame = () => {
            if (!recordCtx || !webglCanvas) return;
            recordCtx.fillStyle = bgColorHex;
            recordCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
            recordCtx.drawImage(webglCanvas, 0, 0);
        };

        // Render initial frame
        renderExportFrame();

        if (videoAnimFrameId) {
            cancelAnimationFrame(videoAnimFrameId);
            videoAnimFrameId = null;
        }
        const videoPaintLoop = () => {
            if (!isExportingVideo) return;
            renderExportFrame();
            videoAnimFrameId = requestAnimationFrame(videoPaintLoop);
        };

        const stream = recordCanvas.captureStream(60);
        videoRecordedChunks = [];

        try {
            videoMediaRecorder = new MediaRecorder(stream, { mimeType });
        } catch (e) {
            videoMediaRecorder = new MediaRecorder(stream);
        }

        videoMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                videoRecordedChunks.push(e.data);
            }
        };

        // Close export dropdown popover immediately
        try { exportDropdownMenu?.hidePopover?.(); } catch (e) { exportDropdownMenu?.classList.add('hidden'); }

        // Show Progress Card and Full-Screen Blocking Overlay
        if (videoExportOverlay) videoExportOverlay.classList.remove('hidden');
        if (videoProgressCard) videoProgressCard.classList.remove('hidden');
        if (videoExportAdvisory) videoExportAdvisory.classList.remove('hidden');
        if (videoProgressPct) videoProgressPct.innerText = '0%';
        if (videoProgressBar) videoProgressBar.style.width = '0%';
        if (videoProgressText) videoProgressText.innerText = `Exporting ${format.toUpperCase()} (Frames ${startFrame}–${endFrame})...`;
        refreshIcons(videoProgressCard);

        const playerUI = document.getElementById('player-ui');
        const slider = document.getElementById('frame-slider');
        const btnPlay = document.getElementById('btn-play');
        if (slider) slider.disabled = true;
        if (btnPlay) btnPlay.disabled = true;
        if (playerUI) playerUI.classList.add('pointer-events-none', 'opacity-75');
        if (videoProgressCard) videoProgressCard.classList.remove('pointer-events-none');

        // Save original playback states
        origLoopState = player.isLooping;
        origSpeedState = player.speed || 1.0;
        origDirectionState = player.direction || 'forward';

        // Apply FIXED video rendering parameters (No loop, forward playback, 1x speed)
        player.setLoop(false);
        player.setPlaybackDirection('forward');
        player.setPlaybackSpeed(1.0);

        // Jump to start frame
        player.jumpToFrame(startFrame);

        isExportingVideo = true;
        videoAnimFrameId = requestAnimationFrame(videoPaintLoop);
        videoMediaRecorder.start();

        const completeVideoExport = () => {
            if (!isExportingVideo) return;
            isExportingVideo = false;
            if (videoAnimFrameId) {
                cancelAnimationFrame(videoAnimFrameId);
                videoAnimFrameId = null;
            }
            if (videoOffFrame) {
                videoOffFrame();
                videoOffFrame = null;
            }
            if (videoOffPlaybackEnded) {
                videoOffPlaybackEnded();
                videoOffPlaybackEnded = null;
            }
            player.pause();
            restorePlayerExportParams();

            const playerUI = document.getElementById('player-ui');
            const slider = document.getElementById('frame-slider');
            const btnPlay = document.getElementById('btn-play');
            if (slider) slider.disabled = false;
            if (btnPlay) btnPlay.disabled = false;
            if (playerUI) playerUI.classList.remove('pointer-events-none', 'opacity-75');

            if (videoProgressPct) videoProgressPct.innerText = '100%';
            if (videoProgressBar) videoProgressBar.style.width = '100%';

            if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
                videoMediaRecorder.onstop = () => {
                    const actualMime = videoMediaRecorder.mimeType || (format === 'mp4' ? 'video/mp4' : 'video/webm');
                    const blob = new Blob(videoRecordedChunks, { type: actualMime });
                    downloadBlob(blob, `VortexMD_trajectory_${startFrame}_${endFrame}.${format}`);
                    if (videoExportOverlay) videoExportOverlay.classList.add('hidden');
                    if (videoProgressCard) videoProgressCard.classList.add('hidden');
                    if (videoExportAdvisory) videoExportAdvisory.classList.add('hidden');
                    showToast(`Video clip exported successfully (.${format})!`, 'success');
                };
                try {
                    if (videoMediaRecorder.state === 'recording' && typeof videoMediaRecorder.requestData === 'function') {
                        videoMediaRecorder.requestData();
                    }
                } catch (e) {}
                videoMediaRecorder.stop();
            } else {
                if (videoExportOverlay) videoExportOverlay.classList.add('hidden');
                if (videoProgressCard) videoProgressCard.classList.add('hidden');
                if (videoExportAdvisory) videoExportAdvisory.classList.add('hidden');
            }
        };

        const onVideoFrame = (e) => {
            if (!isExportingVideo) return;
            const currentF = e.detail.frame;
            const progress = Math.min(100, Math.max(0, ((currentF - startFrame) / totalToRecord) * 100));
            if (videoProgressPct) videoProgressPct.innerText = `${Math.round(progress)}%`;
            if (videoProgressBar) videoProgressBar.style.width = `${progress}%`;

            if (currentF >= endFrame) {
                completeVideoExport();
            }
        };

        const onVideoPlaybackEnded = () => {
            if (isExportingVideo) {
                completeVideoExport();
            }
        };

        videoOffFrame = listen(player, EVENTS.FRAME_UPDATE, onVideoFrame);
        videoOffPlaybackEnded = listen(player, EVENTS.PLAYBACK_ENDED, onVideoPlaybackEnded);

        // Start playback to capture sequence
        if (!player.isPlaying) {
            player.play();
        }
    });
    }

    // Format and Resolution Select Listeners to update button labels
    bindSelectToLabel(videoFormatSelect, videoFormatLabel, (val) => val === 'mp4' ? 'MP4' : 'WebM', null, listen);

    // Export Background Color Option
    const updateBgColorLabel = (color) => {
        const name = color === 'black' ? 'Black' : 'White';
        if (bgColorLabel) {
            bgColorLabel.innerText = name;
            bgColorLabel.title = `Background Color: ${name}`;
        }
        return name;
    };

    bindSelectToLabel(exportBgSelect, bgColorLabel, updateBgColorLabel, (color) => {
        player.setBackgroundColor(color);
        showToast(`Background set to ${color === 'white' ? 'White' : 'Black'}`, 'info');
    }, listen);

    // Export Camera Projection Mode Option
    if (exportProjSelect) {
        listen(exportProjSelect, 'change', (e) => {
            const mode = e.target.value;
            player.setCameraType(mode);
            showToast(`Camera: ${mode === 'orthographic' ? 'Orthographic (Parallel)' : 'Perspective'}`, 'info');
        });
    }

    // Save Viewport Image (.png)
    if (btnSaveImage) {
        listen(btnSaveImage, 'click', async () => {
            if (!player.hasStructure) {
                showToast('No active 3D structure loaded to capture.', 'warning');
                return;
            }
            const frameIdx = player.currentFrame !== undefined ? player.currentFrame : 0;
            const res = imageResSelect ? imageResSelect.value : '300dpi';
            const bg = exportBgSelect ? exportBgSelect.value : 'white';
            const proj = exportProjSelect ? exportProjSelect.value : 'perspective';
            const filename = `VortexMD_frame_${frameIdx}_${res}.png`;

            await player.exportSnapshot({
                res,
                backgroundColor: bg,
                cameraType: proj,
                filename
            });
        });
    }

    // Play/Pause Click
    if (btnPlay) {
        listen(btnPlay, 'click', (e) => {
            if (e && e.currentTarget && typeof e.currentTarget.blur === 'function') {
                e.currentTarget.blur();
            } else if (btnPlay && typeof btnPlay.blur === 'function') {
                btnPlay.blur();
            }
            const hasTraj = player.hasTrajectory;
            if (!hasTraj && !player.isPlaying) {
                showToast('Load a trajectory to play animation', 'info');
                return;
            }
            if (player.isPlaying) {
                player.pause();
            } else {
                player.play();
            }
        });
    }

    // Slider Scrubbing (Debounced via requestAnimationFrame)
    if (slider) {
        listen(slider, 'input', (e) => {
            let val = parseInt(e.target.value, 10);

            if (isIndexing && val > indexedMaxFrame) {
                val = indexedMaxFrame;
                slider.value = indexedMaxFrame;
                showLockTooltip(indexedMaxFrame);
            } else {
                if (scrubLockTooltip) scrubLockTooltip.classList.add('hidden');
            }

            // Immediate UI text and track updates
            if (frameInput && document.activeElement !== frameInput) {
                frameInput.value = val;
                adjustFrameInputWidth(val);
            }
            updateSliderTracks(val);

            // Debounced coordinate jump to prevent I/O flooding
            pendingFrameVal = val;
            if (!sliderRafId) {
                sliderRafId = requestAnimationFrame(() => {
                    if (pendingFrameVal !== null) {
                        player.jumpToFrame(pendingFrameVal);
                    }
                    sliderRafId = null;
                });
            }
        });

        // Keyboard Arrow Fine-Stepping on Slider
        listen(slider, 'keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const current = player.currentFrame || 1;
                const min = 1;
                const max = Math.max(1, parseInt(document.getElementById('frame-max')?.innerText || '100', 10));
                const delta = (e.key === 'ArrowLeft') ? -1 : 1;
                const target = Math.max(min, Math.min(max, current + delta));

                if (slider) slider.value = target;
                if (frameInput) {
                    frameInput.value = target;
                    adjustFrameInputWidth(target);
                }
                updateSliderTracks(target);
                player.jumpToFrame(target);
            }
        });
    }

    listen(player, EVENTS.TOPOLOGY_LOADED, () => {
        const playerUI = document.getElementById('player-ui');
        if (playerUI) {
            playerUI.classList.remove('opacity-50', 'pointer-events-none');
        }

        const hasTraj = player.hasTrajectory;
        if (!hasTraj) {
            isIndexing = false;
            indexedMaxFrame = 0;
            totalEstimatedFrames = 0;

            if (frameInput) {
                frameInput.value = 0;
                frameInput.min = 0;
                frameInput.max = 0;
                adjustFrameInputWidth(0);
            }
            if (frameMaxLabel) frameMaxLabel.innerText = '0';
            if (physTimeLabel) physTimeLabel.innerText = '0.00 ps';
            if (slider) {
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
            }
            if (trackIndexed) trackIndexed.style.width = '100%';
            if (trackPlayhead) trackPlayhead.style.width = '0%';
        }
    });

    listen(player, EVENTS.INDEXING_PROGRESS, (e) => {
        const { indexedFrames, totalEstimatedFrames: est } = e.detail;
        isIndexing = true;
        indexedMaxFrame = Math.max(1, indexedFrames);
        totalEstimatedFrames = Math.max(indexedFrames, est || 100);

        if (frameMaxLabel) frameMaxLabel.innerText = totalEstimatedFrames.toString();
        if (slider) {
            slider.min = 1;
            slider.max = totalEstimatedFrames;
        }
        if (frameInput) {
            frameInput.min = 1;
            frameInput.max = totalEstimatedFrames;
        }

        const currentVal = parseInt(slider?.value || '1', 10);
        updateDimMasks();
        updateSliderTracks(currentVal);
    });

    listen(player, EVENTS.INDEXING_COMPLETE, (e) => {
        const { totalFrames } = e.detail;
        isIndexing = false;
        indexedMaxFrame = Math.max(1, totalFrames);
        totalEstimatedFrames = Math.max(1, totalFrames);

        if (frameMaxLabel) frameMaxLabel.innerText = totalFrames.toString();
        if (slider) {
            slider.min = 1;
            slider.max = totalFrames;
        }
        if (frameInput) {
            frameInput.min = 1;
            frameInput.max = totalFrames;
        }
        if (trackIndexed) trackIndexed.style.width = '100%';
        if (scrubLockTooltip) scrubLockTooltip.classList.add('hidden');

        const currentVal = parseInt(slider?.value || '1', 10);
        updateDimMasks();
        updateSliderTracks(currentVal);
    });

    listen(player, EVENTS.TOPOLOGY_CLEARED, () => {
        setPlayState(false);
        isIndexing = false;
        indexedMaxFrame = 0;
        totalEstimatedFrames = 0;

        if (frameInput) {
            frameInput.value = 0;
            frameInput.min = 0;
            frameInput.max = 0;
            adjustFrameInputWidth(0);
        }
        if (frameMaxLabel) frameMaxLabel.innerText = '0';
        if (physTimeLabel) physTimeLabel.innerText = '0.00 ps';
        if (speedSelect) speedSelect.value = '1';
        updateSpeedLabel(1);
        setSpinState(false);
        setRockState(false);
        if (dirSelect) dirSelect.value = 'forward';
        updateDirLabel('forward');

        if (slider) {
            slider.min = 0;
            slider.value = 0;
            slider.max = 0;
        }

        if (trackIndexed) trackIndexed.style.width = '0%';
        if (trackPlayhead) trackPlayhead.style.width = '0%';
        if (scrubLockTooltip) scrubLockTooltip.classList.add('hidden');
        try { exportDropdownMenu?.hidePopover?.(); } catch(e) { exportDropdownMenu?.classList.add('hidden'); }
        try { pinPopover?.hidePopover?.(); } catch(e) { pinPopover?.classList.add('hidden'); }
        try { focusSlicePopover?.hidePopover?.(); } catch(e) { focusSlicePopover?.classList.add('hidden'); }
        if (focusSliceSlider) focusSliceSlider.value = 0;
        if (focusSliceValLabel) focusSliceValLabel.innerText = '0%';
        if (mouseSchemeSelect) mouseSchemeSelect.value = 'default';
        player.setSpin(false);
        player.setRock(false);
        player.setDepthSlicing(0);

        if (isExportingVideo) {
            isExportingVideo = false;
            if (videoOffFrame) {
                videoOffFrame();
                videoOffFrame = null;
            }
            if (videoOffPlaybackEnded) {
                videoOffPlaybackEnded();
                videoOffPlaybackEnded = null;
            }
            if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
                videoMediaRecorder.stop();
            }
            if (videoExportOverlay) videoExportOverlay.classList.add('hidden');
            if (videoProgressCard) videoProgressCard.classList.add('hidden');
        }

        player.setPins([]);
        if (pinsContainer) pinsContainer.innerHTML = '';
        hideDimMasks();
        loopA = 0;
        loopB = null;
        updateLoopSelectLabel();
        if (loopModeSelect) loopModeSelect.value = 'off';
        player.setLoop(false);

        const playerUI = document.getElementById('player-ui');
        if (playerUI) {
            playerUI.classList.add('opacity-50', 'pointer-events-none');
        }
    });

    // Component Events Subscriptions
    listen(player, EVENTS.PLAYBACK_STARTED, () => {
        setPlayState(true);
    });

    listen(player, EVENTS.PLAYBACK_PAUSED, () => {
        setPlayState(false);
    });

    listen(player, EVENTS.PLAYBACK_ENDED, () => {
        setPlayState(false);
    });

    listen(player, EVENTS.FRAME_UPDATE, (e) => {
        const detail = e.detail;
        if (!detail) return;
        const frame = detail.frame;
        if (frameInput && document.activeElement !== frameInput) {
            const frameStr = String(frame);
            if (frameInput.value !== frameStr) {
                frameInput.value = frameStr;
                adjustFrameInputWidth(frame);
            }
        }
        if (slider && Number(slider.value) !== frame) {
            slider.value = frame;
        }
        updateSliderTracks(frame);
        if (physTimeLabel && detail.physTimeFormatted) {
            if (physTimeLabel.innerText !== detail.physTimeFormatted) {
                physTimeLabel.innerText = detail.physTimeFormatted;
            }
        }
    });

    listen(player, EVENTS.UI_DRAWER_TOGGLE, (e) => {
        const playerUI = document.getElementById('player-ui');
        if (playerUI) {
            if (e.detail && e.detail.open) {
                playerUI.classList.add('settings-open');
            } else {
                playerUI.classList.remove('settings-open');
            }
        }
    });
}
