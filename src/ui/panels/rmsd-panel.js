// src/ui/panels/rmsd-panel.js
// Isolated UI Panel for Trajectory RMSD Analysis, Canvas Charting & Preset Selection

import { downloadBlob } from '../../shared/download.js';
import { EVENTS } from '../../contracts/events.js';
import { $id } from '../shell/dom-utils.js';

export function findNearestRmsdItem(frame, series) {
    if (!series || series.length === 0) return null;
    if (series.length === 1) return series[0];
    if (frame <= series[0].frame) return series[0];
    if (frame >= series[series.length - 1].frame) return series[series.length - 1];

    let low = 0;
    let high = series.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const midFrame = series[mid].frame;
        if (midFrame === frame) return series[mid];
        if (midFrame < frame) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    const left = series[high];
    const right = series[low];
    if (!left) return right;
    if (!right) return left;
    return Math.abs(left.frame - frame) <= Math.abs(right.frame - frame) ? left : right;
}

export function exportRmsdDataCsv(series, fitQ = 'protein and .CA', calcQ = 'protein and .CA', notify = null) {
    if (!series || series.length === 0) {
        if (typeof notify === 'function') notify('warning', 'No RMSD data to export');
        return;
    }

    const safeFit = fitQ.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 20);
    const safeCalc = calcQ.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 20);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    const filename = `VortexMD_RMSD_${safeCalc}_fit_${safeFit}_${dateStr}_${timeStr}.csv`;

    let csv = "frame,time_ns,rmsd_angstrom\n";
    series.forEach(item => {
        csv += `${item.frame},${item.timeNs || 0},${Number(item.rmsd).toFixed(4)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, filename);

    if (typeof notify === 'function') {
        notify('success', `Exported RMSD data as ${filename}`);
    }
}

export function renderRmsdChart(elements, series, fitQ = 'protein and .CA', calcQ = 'protein and .CA', onJump = null) {
    const {
        container,
        canvas,
        summary,
        chartTitle,
        subtitle,
        pointInfo,
        btnReset
    } = elements;

    if (!canvas || !series || series.length === 0) return null;

    if (container) container.style.display = 'flex';

    if (chartTitle) chartTitle.innerText = `RMSD of ${calcQ}`;
    if (subtitle) subtitle.innerText = `after lsq fit to ${fitQ}`;

    const vals = series.map(s => Number(s.rmsd) || 0);
    const minV = Math.min(...vals).toFixed(2);
    const maxV = Math.max(...vals).toFixed(2);
    const avgV = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);

    if (summary) summary.innerText = `Min: ${minV} | Max: ${maxV} | Avg: ${avgV} Å`;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const padL = 42;
    const padR = 14;
    const padT = 14;
    const padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const totalPoints = series.length;
    let startIndex = 0;
    let endIndex = totalPoints - 1;

    let baseCanvas = null;
    let cachedPlot = null;

    const updateResetButtonVisibility = () => {
        const isZoomed = (startIndex > 0 || endIndex < totalPoints - 1);
        if (btnReset) {
            btnReset.style.display = isZoomed ? 'inline-flex' : 'none';
        }
    };

    const buildBasePlot = () => {
        if (!baseCanvas && typeof document !== 'undefined' && typeof document.createElement === 'function') {
            baseCanvas = document.createElement('canvas');
        }
        if (baseCanvas) {
            baseCanvas.width = w;
            baseCanvas.height = h;
        }
        const bctx = baseCanvas ? baseCanvas.getContext('2d') : ctx;
        bctx.clearRect(0, 0, w, h);

        const visibleCount = endIndex - startIndex + 1;
        const visibleSeries = series.slice(startIndex, endIndex + 1);
        const visibleVals = visibleSeries.map(s => Number(s.rmsd) || 0);

        let minVal = Math.min(...visibleVals);
        let maxVal = Math.max(...visibleVals);
        if (minVal === maxVal) {
            minVal = Math.max(0, minVal - 0.5);
            maxVal += 0.5;
        } else {
            const margin = (maxVal - minVal) * 0.08;
            minVal = Math.max(0, minVal - margin);
            maxVal += margin;
        }
        const midVal = ((minVal + maxVal) / 2).toFixed(1);

        const firstPoint = series[startIndex];
        const lastPoint = series[endIndex];
        const firstTimeNs = firstPoint?.timeNs || '0';
        const lastTimeNs = lastPoint?.timeNs || '1';

        // 1. Grid Lines
        bctx.strokeStyle = '#f1f5f9';
        bctx.lineWidth = 1;
        bctx.beginPath();
        bctx.moveTo(padL, padT + plotH / 2);
        bctx.lineTo(padL + plotW, padT + plotH / 2);
        bctx.stroke();

        // 2. Axes
        bctx.strokeStyle = '#94a3b8';
        bctx.lineWidth = 1.2;
        bctx.beginPath();
        bctx.moveTo(padL, padT);
        bctx.lineTo(padL, h - padB);
        bctx.lineTo(w - padR, h - padB);
        bctx.stroke();

        // 3. Y-Axis Ticks & Numbers
        bctx.fillStyle = '#64748b';
        bctx.font = '8px monospace';
        bctx.textAlign = 'right';
        bctx.textBaseline = 'middle';

        bctx.fillText(`${maxVal.toFixed(1)}`, padL - 4, padT);
        bctx.fillText(`${midVal}`, padL - 4, padT + plotH / 2);
        bctx.fillText(`${minVal.toFixed(1)}`, padL - 4, h - padB);

        // 4. Rotated Y-Axis Label: RMSD (Å)
        bctx.save();
        bctx.translate(11, padT + plotH / 2);
        bctx.rotate(-Math.PI / 2);
        bctx.textAlign = 'center';
        bctx.font = 'bold 9px -apple-system, sans-serif';
        bctx.fillStyle = '#065f46';
        bctx.fillText('RMSD (Å)', 0, 0);
        bctx.restore();

        // 5. X-Axis Ticks & Numbers
        bctx.fillStyle = '#64748b';
        bctx.font = '8px monospace';
        bctx.textAlign = 'left';
        bctx.textBaseline = 'top';
        bctx.fillText(`${firstTimeNs} ns (F${firstPoint?.frame || 1})`, padL, h - padB + 3);

        bctx.textAlign = 'right';
        bctx.fillText(`${lastTimeNs} ns (F${lastPoint?.frame || totalPoints})`, padL + plotW, h - padB + 3);

        // 6. Centered X-Axis Label: Time (ns)
        bctx.textAlign = 'center';
        bctx.font = 'bold 9px -apple-system, sans-serif';
        bctx.fillStyle = '#065f46';
        const isZoomed = (startIndex > 0 || endIndex < totalPoints - 1);
        bctx.fillText(isZoomed ? `Time (ns) · Zoomed ${visibleCount} frames` : 'Time (ns)', padL + plotW / 2, h - 10);

        // 7. RMSD Curve
        bctx.strokeStyle = '#10b981';
        bctx.lineWidth = 2;
        bctx.beginPath();
        const pts = [];
        for (let i = 0; i < visibleCount; i++) {
            const x = padL + (i / Math.max(1, visibleCount - 1)) * plotW;
            const normY = (visibleVals[i] - minVal) / (maxVal - minVal);
            const y = (h - padB) - normY * plotH;
            pts.push({ x, y, frame: visibleSeries[i].frame, item: visibleSeries[i] });
            if (i === 0) bctx.moveTo(x, y);
            else bctx.lineTo(x, y);
        }
        bctx.stroke();

        // 8. Gradient Shading
        bctx.lineTo(padL + plotW, h - padB);
        bctx.lineTo(padL, h - padB);
        bctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
        bctx.fill();

        // 8b. Discrete points when zoomed in
        if (visibleCount <= 80) {
            const pointRadius = visibleCount <= 30 ? 3.5 : (visibleCount <= 50 ? 2.5 : 1.8);
            for (let i = 0; i < visibleCount; i++) {
                const pt = pts[i];
                bctx.beginPath();
                bctx.arc(pt.x, pt.y, pointRadius, 0, Math.PI * 2);
                bctx.fillStyle = '#10b981';
                bctx.fill();
                if (visibleCount <= 40) {
                    bctx.strokeStyle = '#ffffff';
                    bctx.lineWidth = 1;
                    bctx.stroke();
                }
            }
        }

        cachedPlot = {
            visibleCount,
            visibleSeries,
            pts,
            startFrame: visibleSeries[0]?.frame ?? 1,
            endFrame: visibleSeries[visibleCount - 1]?.frame ?? totalPoints
        };
    };

    const renderCursor = (activeFrame = 1) => {
        if (!cachedPlot) {
            buildBasePlot();
        }

        ctx.clearRect(0, 0, w, h);
        if (baseCanvas && typeof ctx.drawImage === 'function') {
            ctx.drawImage(baseCanvas, 0, 0);
        } else {
            buildBasePlot();
        }

        const { visibleCount, visibleSeries, pts, startFrame, endFrame } = cachedPlot;

        if (activeFrame >= startFrame && activeFrame <= endFrame) {
            let curX = padL;
            let ptActive = null;

            if (visibleCount === 1) {
                curX = padL + plotW / 2;
                ptActive = pts[0];
            } else {
                let low = 0;
                let high = visibleCount - 1;
                while (low <= high) {
                    const mid = (low + high) >> 1;
                    if (visibleSeries[mid].frame === activeFrame) {
                        high = mid;
                        break;
                    } else if (visibleSeries[mid].frame < activeFrame) {
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                }

                let idx = Math.max(0, Math.min(visibleCount - 1, high));
                if (visibleSeries[idx].frame > activeFrame && idx > 0) {
                    idx--;
                }

                const f0 = visibleSeries[idx].frame;
                if (idx < visibleCount - 1) {
                    const f1 = visibleSeries[idx + 1].frame;
                    const span = Math.max(1, f1 - f0);
                    const t = Math.max(0, Math.min(1, (activeFrame - f0) / span));
                    curX = pts[idx].x + t * (pts[idx + 1].x - pts[idx].x);
                    ptActive = (Math.abs(f1 - activeFrame) < Math.abs(f0 - activeFrame)) ? pts[idx + 1] : pts[idx];
                } else {
                    curX = pts[idx].x;
                    ptActive = pts[idx];
                }
            }

            ctx.strokeStyle = '#047857';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(curX, padT);
            ctx.lineTo(curX, h - padB);
            ctx.stroke();
            ctx.setLineDash([]);

            if (ptActive) {
                ctx.beginPath();
                ctx.arc(ptActive.x, ptActive.y, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = '#047857';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        if (pointInfo) {
            const activeItem = findNearestRmsdItem(activeFrame, series);
            if (activeItem) {
                const text = `Frame: ${activeFrame} (${activeItem.timeNs} ns | ${Number(activeItem.rmsd).toFixed(2)} Å)`;
                if (pointInfo.innerText !== text) {
                    pointInfo.innerText = text;
                }
            }
        }
    };

    const resetZoom = () => {
        startIndex = 0;
        endIndex = totalPoints - 1;
        updateResetButtonVisibility();
        buildBasePlot();
        renderCursor(1);
    };

    buildBasePlot();
    renderCursor(1);
    updateResetButtonVisibility();

    // Canvas click: jumps to frame and zooms in
    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / (rect.width || 1);
        const clickX = (e.clientX - rect.left) * scaleX;

        if (clickX >= padL && clickX <= (padL + plotW)) {
            const frac = (clickX - padL) / plotW;
            const visibleCount = endIndex - startIndex + 1;
            const relIdx = Math.min(visibleCount - 1, Math.max(0, Math.round(frac * (visibleCount - 1))));
            const targetIdx = startIndex + relIdx;
            const item = series[targetIdx];
            const targetFrame = (item && typeof item.frame === 'number') ? item.frame : (targetIdx + 1);

            if (typeof onJump === 'function') {
                onJump(targetFrame);
            }

            const isAlreadyZoomed = (startIndex > 0 || endIndex < totalPoints - 1);
            if (!isAlreadyZoomed && totalPoints > 30) {
                const windowHalf = Math.max(10, Math.min(25, Math.floor(totalPoints * 0.08)));
                let newStart = Math.max(0, targetIdx - windowHalf);
                let newEnd = Math.min(totalPoints - 1, targetIdx + windowHalf);
                if (newEnd - newStart < windowHalf * 2) {
                    if (newStart === 0) newEnd = Math.min(totalPoints - 1, newStart + windowHalf * 2);
                    else if (newEnd === totalPoints - 1) newStart = Math.max(0, newEnd - windowHalf * 2);
                }
                startIndex = newStart;
                endIndex = newEnd;
                updateResetButtonVisibility();
                buildBasePlot();
            }

            renderCursor(targetFrame);
        }
    };

    // Canvas dblclick: reset zoom
    canvas.ondblclick = () => {
        resetZoom();
    };

    // Canvas wheel: fine zoom centered at cursor
    canvas.onwheel = (e) => {
        if (totalPoints <= 10) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / (rect.width || 1);
        const cursorX = (e.clientX - rect.left) * scaleX;

        if (cursorX < padL || cursorX > (padL + plotW)) return;

        const frac = (cursorX - padL) / plotW;
        const currentRange = endIndex - startIndex;
        const cursorIdx = startIndex + frac * currentRange;

        const zoomFactor = e.deltaY < 0 ? 0.75 : 1.35;
        let newRange = Math.round(currentRange * zoomFactor);
        newRange = Math.max(8, Math.min(totalPoints - 1, newRange));

        let newStart = Math.round(cursorIdx - frac * newRange);
        let newEnd = newStart + newRange;

        if (newStart < 0) {
            newStart = 0;
            newEnd = Math.min(totalPoints - 1, newRange);
        }
        if (newEnd >= totalPoints) {
            newEnd = totalPoints - 1;
            newStart = Math.max(0, totalPoints - 1 - newRange);
        }

        startIndex = newStart;
        endIndex = newEnd;
        updateResetButtonVisibility();
        buildBasePlot();
        renderCursor(series[Math.round(cursorIdx)]?.frame || 1);
    };

    if (btnReset) {
        btnReset.onclick = () => resetZoom();
    }

    return {
        updateCursor: renderCursor,
        resetZoom,
        redraw: () => {
            buildBasePlot();
            renderCursor(1);
        }
    };
}

export function initRmsdPanel({ engine, listen }) {
    const fitInput = $id('rmsd-fit-sele');
    const calcInput = $id('rmsd-calc-sele');
    const sameAsFitCheckbox = $id('rmsd-same-as-fit');
    const strideSelect = $id('rmsd-stride-select');
    const atomCountsBadge = $id('rmsd-atom-counts-badge');
    const presetsContainer = $id('rmsd-presets-container');
    const btnComputeRmsd = $id('btn-compute-rmsd');
    const rmsdAccordion = $id('rmsd-config-accordion');

    // Progress elements
    const progressContainer = $id('rmsd-progress-container');
    const progressBar = $id('rmsd-progress-bar');
    const progressPercent = $id('rmsd-progress-percent');
    const progressFrames = $id('rmsd-progress-frames');
    const progressStatus = $id('rmsd-progress-status');

    // Chart elements
    const chartContainer = $id('rmsd-chart-container');
    const runsWrapper = $id('rmsd-runs-wrapper');
    const runsSelect = $id('rmsd-run-select');
    const chartTitle = $id('rmsd-chart-title');
    const gromacsSubtitle = $id('rmsd-gromacs-subtitle');
    const canvas = $id('rmsd-canvas');
    const pointInfo = $id('rmsd-active-point-info');
    const btnResetRmsdPlot = $id('btn-reset-rmsd-plot');
    const btnExportRmsdCsv = $id('btn-export-rmsd-csv');
    const statsSummary = $id('rmsd-stats-summary');

    let chartController = null;
    let activeRunId = null;
    let isComputing = false;

    // Helper: Update atom counts badge
    const updateAtomCounts = () => {
        if (!atomCountsBadge || typeof engine.countAtoms !== 'function') return;
        const fitQ = fitInput?.value?.trim() || 'protein and .CA';
        const isSame = sameAsFitCheckbox?.checked ?? true;
        const calcQ = isSame ? fitQ : (calcInput?.value?.trim() || fitQ);

        const fitCount = engine.countAtoms(fitQ);
        const calcCount = engine.countAtoms(calcQ);

        atomCountsBadge.innerText = `Fit: ${fitCount} atoms | Calc: ${calcCount} atoms`;
        atomCountsBadge.style.color = (fitCount > 0 && calcCount > 0) ? '#047857' : '#e11d48';
    };

    // Helper: Update runs selector dropdown
    const updateRunsSelector = (selectedRunId = null) => {
        if (!runsWrapper || !runsSelect) return;
        const runs = engine.getRmsdRuns();
        if (runs.length > 1) {
            runsWrapper.style.display = 'flex';
            runsSelect.innerHTML = '';
            runs.forEach((r, idx) => {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${idx + 1}. ${r.name || r.calcQuery} (${r.pointCount} pts)`;
                if (selectedRunId && r.id === selectedRunId) {
                    opt.selected = true;
                } else if (!selectedRunId && idx === runs.length - 1) {
                    opt.selected = true;
                }
                runsSelect.appendChild(opt);
            });
        } else {
            runsWrapper.style.display = 'none';
        }
    };

    // Helper: Display and chart a run
    const displayRun = (runId) => {
        if (!runId || typeof engine.getRmsdRun !== 'function') return;
        const run = engine.getRmsdRun(runId);
        if (!run || !run.series || run.series.length === 0) return;

        activeRunId = run.id;
        if (fitInput && run.fitQuery) fitInput.value = run.fitQuery;
        if (calcInput && run.calcQuery) calcInput.value = run.calcQuery;

        updateRunsSelector(run.id);

        chartController = renderRmsdChart({
            container: chartContainer,
            canvas,
            summary: statsSummary,
            chartTitle,
            subtitle: gromacsSubtitle,
            pointInfo,
            btnReset: btnResetRmsdPlot
        }, run.series, run.fitQuery || 'protein and .CA', run.calcQuery || 'protein and .CA', (frame) => {
            engine.jumpToFrame(frame);
        });

        if (chartController && engine.currentFrame) {
            chartController.updateCursor(engine.currentFrame);
        }
    };

    // Inputs event listeners
    if (fitInput) {
        listen(fitInput, 'input', () => {
            if (sameAsFitCheckbox?.checked && calcInput) {
                calcInput.value = fitInput.value;
            }
            engine.setRmsdConfig({ fit: fitInput.value });
            updateAtomCounts();
        });
    }

    if (calcInput) {
        listen(calcInput, 'input', () => {
            engine.setRmsdConfig({ calc: calcInput.value });
            updateAtomCounts();
        });
    }

    if (sameAsFitCheckbox) {
        listen(sameAsFitCheckbox, 'change', (e) => {
            const isSame = e.target.checked;
            if (calcInput) {
                calcInput.style.display = isSame ? 'none' : 'block';
                if (isSame && fitInput) {
                    calcInput.value = fitInput.value;
                }
            }
            updateAtomCounts();
        });
    }

    // Preset chips
    if (presetsContainer) {
        listen(presetsContainer, 'click', (e) => {
            const chip = e.target.closest('.preset-chip');
            if (!chip) return;
            const fit = chip.dataset.fit;
            const calc = chip.dataset.calc;
            const same = chip.dataset.same === 'true';
            if (fit && calc !== undefined) {
                if (fitInput) fitInput.value = fit;
                if (sameAsFitCheckbox) sameAsFitCheckbox.checked = same;
                if (calcInput) {
                    calcInput.style.display = same ? 'none' : 'block';
                    calcInput.value = calc;
                }
                engine.setRmsdConfig({ fit, calc });
                updateAtomCounts();
            }
        });
    }

    // Compute button
    if (btnComputeRmsd) {
        listen(btnComputeRmsd, 'click', async () => {
            if (isComputing) return;

            if (rmsdAccordion) {
                rmsdAccordion.open = false;
            }

            const fitQ = fitInput?.value?.trim() || 'protein and .CA';
            const isSame = sameAsFitCheckbox?.checked ?? true;
            const calcQ = isSame ? fitQ : (calcInput?.value?.trim() || fitQ);
            const strideVal = strideSelect?.value || 'auto';

            let parsedStride = 'auto';
            if (strideVal !== 'auto') {
                const num = parseInt(strideVal, 10);
                if (!isNaN(num) && num > 0) parsedStride = num;
            }

            isComputing = true;
            if (btnComputeRmsd) {
                btnComputeRmsd.disabled = true;
                btnComputeRmsd.style.opacity = '0.6';
                btnComputeRmsd.innerText = '⏳ Computing RMSD Curve...';
            }
            if (progressContainer) {
                progressContainer.style.display = 'flex';
                if (progressBar) progressBar.style.width = '0%';
                if (progressPercent) progressPercent.innerText = '0%';
                if (progressFrames) progressFrames.innerText = 'Frame: 0 / 0';
                if (progressStatus) progressStatus.innerText = 'Loading reference frame...';
            }

            try {
                await engine.computeRmsd({
                    fit: fitQ,
                    calc: calcQ,
                    stride: parsedStride
                });
            } catch {
                // Handled via engine events
            } finally {
                isComputing = false;
            }
        });
    }

    // Run selector change
    if (runsSelect) {
        listen(runsSelect, 'change', (e) => {
            const runId = e.target.value;
            if (runId) {
                displayRun(runId);
                if (rmsdAccordion) rmsdAccordion.open = false;
            }
        });
    }

    // CSV export
    if (btnExportRmsdCsv) {
        listen(btnExportRmsdCsv, 'click', () => {
            if (!activeRunId) {
                const runs = engine.getRmsdRuns();
                if (runs && runs.length > 0) {
                    activeRunId = runs[runs.length - 1].id;
                }
            }
            if (activeRunId) {
                const run = engine.getRmsdRun(activeRunId);
                if (run) {
                    exportRmsdDataCsv(run.series, run.fitQuery, run.calcQuery, (lvl, msg) => engine.notify(lvl, msg));
                }
            } else {
                engine.notify('warning', 'No RMSD data to export');
            }
        });
    }

    // Reset zoom button
    if (btnResetRmsdPlot) {
        listen(btnResetRmsdPlot, 'click', () => {
            if (chartController) {
                chartController.resetZoom();
            }
        });
    }

    // Subscriptions to Engine Events
    listen(engine, EVENTS.RMSD_PROGRESS, (e) => {
        const { percent, frame, totalFrames, point, totalPoints } = e.detail || {};
        if (progressContainer) progressContainer.style.display = 'flex';
        if (progressBar) progressBar.style.width = `${percent || 0}%`;
        if (progressPercent) progressPercent.innerText = `${percent || 0}%`;
        if (progressFrames) {
            if (point !== undefined && totalPoints !== undefined && totalPoints < totalFrames) {
                progressFrames.innerText = `Frame: ${(frame || 0).toLocaleString()} / ${(totalFrames || 0).toLocaleString()} (Sampled ${(point || 0).toLocaleString()} / ${totalPoints.toLocaleString()})`;
            } else {
                progressFrames.innerText = `Frame: ${(frame || 0).toLocaleString()} / ${(totalFrames || 0).toLocaleString()}`;
            }
        }
        if (progressStatus) {
            progressStatus.innerText = `Aligning frame ${(frame || 0).toLocaleString()}...`;
        }
    }, 'RmsdPanel');

    listen(engine, EVENTS.RMSD_COMPUTED, (e) => {
        isComputing = false;
        if (progressContainer) progressContainer.style.display = 'none';
        if (btnComputeRmsd) {
            btnComputeRmsd.disabled = false;
            btnComputeRmsd.style.opacity = '1';
            btnComputeRmsd.innerText = '📊 Compute Trajectory RMSD Curve';
        }
        if (e.detail?.runId) {
            displayRun(e.detail.runId);
        }
    }, 'RmsdPanel');

    listen(engine, EVENTS.ENGINE_BUSY, (e) => {
        if (e.detail?.task === 'rmsd') {
            if (!e.detail.busy) {
                isComputing = false;
                if (btnComputeRmsd) {
                    btnComputeRmsd.disabled = false;
                    btnComputeRmsd.style.opacity = '1';
                    btnComputeRmsd.innerText = '📊 Compute Trajectory RMSD Curve';
                }
                if (progressContainer) progressContainer.style.display = 'none';
            }
        }
    }, 'RmsdPanel');

    listen(engine, EVENTS.FRAME_UPDATE, (e) => {
        if (chartController && chartContainer && chartContainer.style.display !== 'none') {
            const f = e.detail?.frame || 1;
            chartController.updateCursor(f);
        }
    }, 'RmsdPanel');

    listen(engine, EVENTS.TOPOLOGY_CLEARED, () => {
        if (chartContainer) chartContainer.style.display = 'none';
        if (runsWrapper) runsWrapper.style.display = 'none';
        if (progressContainer) progressContainer.style.display = 'none';
        if (atomCountsBadge) {
            atomCountsBadge.innerText = 'Fit: 0 atoms | Calc: 0 atoms';
            atomCountsBadge.style.color = '#334155';
        }
        activeRunId = null;
        chartController = null;
    }, 'RmsdPanel');

    listen(engine, EVENTS.TOPOLOGY_LOADED, () => {
        updateAtomCounts();
    }, 'RmsdPanel');

    listen(engine, EVENTS.INDEXING_PROGRESS, (e) => {
        const percent = e.detail?.percent || 0;
        if (btnComputeRmsd) {
            btnComputeRmsd.disabled = true;
            btnComputeRmsd.style.opacity = '0.6';
            btnComputeRmsd.innerText = `⏳ Indexing Trajectory (${Math.round(percent)}%)...`;
        }
    }, 'RmsdPanel');

    listen(engine, EVENTS.INDEXING_COMPLETE, () => {
        if (btnComputeRmsd && !isComputing) {
            btnComputeRmsd.disabled = false;
            btnComputeRmsd.style.opacity = '1.0';
            btnComputeRmsd.innerText = '📊 Compute Trajectory RMSD Curve';
        }
    }, 'RmsdPanel');

    listen(engine, EVENTS.SESSION_RESTORED, () => {
        const cfg = engine.getRmsdConfig();
        if (cfg) {
            if (fitInput && cfg.fit) fitInput.value = cfg.fit;
            if (calcInput && cfg.calc) calcInput.value = cfg.calc;
            if (sameAsFitCheckbox) sameAsFitCheckbox.checked = (cfg.fit === cfg.calc);
            if (calcInput) calcInput.style.display = (cfg.fit === cfg.calc) ? 'none' : 'block';
        }
        updateAtomCounts();
        const runs = engine.getRmsdRuns();
        if (runs.length > 0) {
            const latest = runs[runs.length - 1];
            displayRun(latest.id);
            if (rmsdAccordion) rmsdAccordion.open = false;
        }
    }, 'RmsdPanel');

    // Initial state setup
    updateAtomCounts();
}
