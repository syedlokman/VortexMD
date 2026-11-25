/**
 * scripts/plot-benchmarks.mjs
 * Generates publication-ready 300 DPI PNG + vector SVG benchmark figures from
 * docs/benchmarks/benchmark-multi-system-raw.json using Playwright Chromium
 * (zero Python / matplotlib dependency).
 */

import fs from 'fs';
import path from 'path';

const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildMemoryScalingSvg(data) {
    const systems = data.systems;
    const W = 1120, H = 460;
    const padL = 72, padR = 28, padT = 58, padB = 72;
    const gap = 80;
    const panelW = (W - padL - padR - gap) / 2;
    const panelH = H - padT - padB;

    const rawMaxHeap = Math.max(25, ...systems.map(s => s.peakHeapMb));
    const maxHeapA = Math.ceil((rawMaxHeap * 1.25) / 10) * 10; // e.g., 50 MB for 39.4 MB peak
    const xPosA = (idx) => padL + ((idx + 0.5) / systems.length) * panelW;
    const yPosA = (mb) => padT + panelH - (mb / maxHeapA) * panelH;

    let panelA = `
      <rect x="${padL}" y="${padT}" width="${panelW}" height="${panelH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
      <text x="${padL + panelW / 2}" y="${padT - 18}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#0f172a">A. Bounded JS Heap Across Trajectory Scale</text>
      <text x="${padL - 48}" y="${padT + panelH / 2}" text-anchor="middle" font-size="12" font-weight="600" fill="#334155" transform="rotate(-90 ${padL - 48} ${padT + panelH / 2})">JS Heap Used (MB)</text>
    `;

    const ticksA = 5;
    for (let t = 0; t <= ticksA; t++) {
        const val = (maxHeapA / ticksA) * t;
        const y = yPosA(val);
        panelA += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + panelW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`;
        panelA += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#475569">${val.toFixed(0)}</text>`;
    }

    const barGroupW = Math.min(82, (panelW / systems.length) * 0.72);
    const barW = barGroupW / 3 - 2;
    systems.forEach((s, idx) => {
        const cx = xPosA(idx);
        const startX = cx - barGroupW / 2;
        const vals = [
            { v: s.baselineHeapMb, c: '#94a3b8' },
            { v: s.avgHeapMb, c: '#2563eb' },
            { v: s.peakHeapMb, c: '#dc2626' }
        ];
        vals.forEach((b, bi) => {
            const x = startX + bi * (barW + 2);
            const y = yPosA(b.v);
            const h = Math.max(1, padT + panelH - y);
            panelA += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${b.c}"/>`;
            panelA += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="#1e293b">${b.v.toFixed(1)}</text>`;
        });
        panelA += `<text x="${cx.toFixed(1)}" y="${padT + panelH + 16}" text-anchor="middle" font-size="10" font-weight="600" fill="#0f172a">${esc(s.name)}</text>`;
        panelA += `<text x="${cx.toFixed(1)}" y="${padT + panelH + 30}" text-anchor="middle" font-size="9.5" fill="#64748b">${esc(s.trajectorySize)}</text>`;
    });

    const legAX = padL + 10, legAY = padT + 10;
    panelA += `
      <rect x="${legAX}" y="${legAY}" width="218" height="24" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#e2e8f0"/>
      <rect x="${legAX + 8}" y="${legAY + 7}" width="10" height="10" rx="2" fill="#94a3b8"/>
      <text x="${legAX + 22}" y="${legAY + 16}" font-size="10" fill="#334155">Baseline</text>
      <rect x="${legAX + 76}" y="${legAY + 7}" width="10" height="10" rx="2" fill="#2563eb"/>
      <text x="${legAX + 90}" y="${legAY + 16}" font-size="10" fill="#334155">Mean</text>
      <rect x="${legAX + 132}" y="${legAY + 7}" width="10" height="10" rx="2" fill="#dc2626"/>
      <text x="${legAX + 146}" y="${legAY + 16}" font-size="10" fill="#334155">Peak Heap</text>
    `;

    // Panel B: 60s Continuous Streaming JS Heap Time-Series
    const pBX = padL + panelW + gap;
    const maxSec = Math.max(60, ...systems.flatMap(s => s.timeseries.map(p => p.elapsedSec)));
    const xPosB = (sec) => pBX + (sec / maxSec) * panelW;
    const yPosB = (mb) => padT + panelH - (mb / maxHeapA) * panelH;

    let panelB = `
      <rect x="${pBX}" y="${padT}" width="${panelW}" height="${panelH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
      <text x="${pBX + panelW / 2}" y="${padT - 18}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#0f172a">B. Continuous Streaming JS Heap (${data.durationSeconds} s Playback)</text>
      <text x="${pBX + panelW / 2}" y="${padT + panelH + 42}" text-anchor="middle" font-size="12" font-weight="600" fill="#334155">Elapsed Playback Time (s)</text>
    `;

    for (let t = 0; t <= ticksA; t++) {
        const val = (maxHeapA / ticksA) * t;
        const y = yPosB(val);
        panelB += `<line x1="${pBX}" y1="${y.toFixed(1)}" x2="${pBX + panelW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`;
        panelB += `<text x="${pBX - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#475569">${val.toFixed(0)}</text>`;
    }

    const xTicks = 6;
    for (let t = 0; t <= xTicks; t++) {
        const sec = (maxSec / xTicks) * t;
        const x = xPosB(sec);
        panelB += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + panelH}" stroke="#f1f5f9" stroke-width="1"/>`;
        panelB += `<text x="${x.toFixed(1)}" y="${padT + panelH + 16}" text-anchor="middle" font-size="10.5" fill="#475569">${sec.toFixed(0)}</text>`;
    }

    systems.forEach((s, idx) => {
        const col = PALETTE[idx % PALETTE.length];
        const pts = s.timeseries.map(pt => `${xPosB(pt.elapsedSec).toFixed(1)},${yPosB(pt.heapMb).toFixed(1)}`).join(' ');
        panelB += `<polyline fill="none" stroke="${col}" stroke-width="2.2" points="${pts}"/>`;
        s.timeseries.forEach(pt => {
            panelB += `<circle cx="${xPosB(pt.elapsedSec).toFixed(1)}" cy="${yPosB(pt.heapMb).toFixed(1)}" r="2.8" fill="${col}"/>`;
        });
    });

    const legBH = systems.length * 17 + 10;
    const legBX = pBX + panelW - 200, legBY = padT + 8;
    panelB += `<rect x="${legBX}" y="${legBY}" width="192" height="${legBH}" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#e2e8f0"/>`;
    systems.forEach((s, idx) => {
        const col = PALETTE[idx % PALETTE.length];
        const ly = legBY + 16 + idx * 17;
        panelB += `<line x1="${legBX + 8}" y1="${ly - 3}" x2="${legBX + 24}" y2="${ly - 3}" stroke="${col}" stroke-width="2.4"/>`;
        panelB += `<text x="${legBX + 30}" y="${ly}" font-size="9.5" fill="#1e293b">${esc(s.name)} (${esc(s.trajectorySize)})</text>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="800" fill="#0f172a">VortexMD Out-of-Core Streaming Memory Profile (CDP JSHeapUsedSize)</text>
  ${panelA}
  ${panelB}
</svg>`;
}

export function buildPerformanceMatrixSvg(data) {
    const systems = data.systems;
    const W = 1120, H = 430;
    const padL = 72, padR = 28, padT = 58, padB = 72;
    const gap = 80;
    const panelW = (W - padL - padR - gap) / 2;
    const panelH = H - padT - padB;

    // Panel A: True TTFF in milliseconds (scales cleanly for sub-second progressive streaming)
    const rawMaxMs = Math.max(100, ...systems.map(s => s.ttffMs || s.ttffSeconds * 1000));
    const maxTtffMs = Math.ceil((rawMaxMs * 1.25) / 25) * 25;
    const xPosA = (idx) => padL + ((idx + 0.5) / systems.length) * panelW;
    const yPosA = (v) => padT + panelH - (v / maxTtffMs) * panelH;

    let panelA = `
      <rect x="${padL}" y="${padT}" width="${panelW}" height="${panelH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
      <text x="${padL + panelW / 2}" y="${padT - 18}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#0f172a">A. Time-to-First-Frame (Progressive TTFF)</text>
      <text x="${padL - 48}" y="${padT + panelH / 2}" text-anchor="middle" font-size="12" font-weight="600" fill="#334155" transform="rotate(-90 ${padL - 48} ${padT + panelH / 2})">TTFF (milliseconds)</text>
    `;
    for (let t = 0; t <= 5; t++) {
        const val = (maxTtffMs / 5) * t;
        const y = yPosA(val);
        panelA += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + panelW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`;
        panelA += `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#475569">${val.toFixed(0)}</text>`;
    }
    const barW = Math.min(64, (panelW / systems.length) * 0.52);
    systems.forEach((s, idx) => {
        const cx = xPosA(idx);
        const ms = s.ttffMs || Math.round(s.ttffSeconds * 1000);
        const y = yPosA(ms);
        const h = Math.max(1, padT + panelH - y);
        const col = PALETTE[idx % PALETTE.length];
        panelA += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${col}"/>`;
        panelA += `<text x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0f172a">${ms} ms</text>`;
        panelA += `<text x="${cx.toFixed(1)}" y="${padT + panelH + 16}" text-anchor="middle" font-size="10" font-weight="600" fill="#0f172a">${esc(s.name)}</text>`;
        panelA += `<text x="${cx.toFixed(1)}" y="${padT + panelH + 30}" text-anchor="middle" font-size="9.5" fill="#64748b">${esc(s.trajectorySize)}</text>`;
    });

    // Panel B: Mean FPS
    const pBX = padL + panelW + gap;
    const maxFps = Math.max(70, ...systems.map(s => (s.meanFps || 0) * 1.15));
    const xPosB = (idx) => pBX + ((idx + 0.5) / systems.length) * panelW;
    const yPosB = (v) => padT + panelH - (v / maxFps) * panelH;

    let panelB = `
      <rect x="${pBX}" y="${padT}" width="${panelW}" height="${panelH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
      <text x="${pBX + panelW / 2}" y="${padT - 18}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#0f172a">B. Real-Time Playback Frame Rate (FPS)</text>
      <text x="${pBX - 48}" y="${padT + panelH / 2}" text-anchor="middle" font-size="12" font-weight="600" fill="#334155" transform="rotate(-90 ${pBX - 48} ${padT + panelH / 2})">Mean Frame Rate (FPS)</text>
    `;
    for (let t = 0; t <= 7; t++) {
        const val = t * 10;
        const y = yPosB(val);
        panelB += `<line x1="${pBX}" y1="${y.toFixed(1)}" x2="${pBX + panelW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`;
        panelB += `<text x="${pBX - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#475569">${val.toFixed(0)}</text>`;
    }

    systems.forEach((s, idx) => {
        const cx = xPosB(idx);
        const fps = s.meanFps || 0;
        const y = yPosB(fps);
        const h = Math.max(1, padT + panelH - y);
        const col = PALETTE[idx % PALETTE.length];
        panelB += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${col}"/>`;
        panelB += `<text x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#0f172a">${fps > 0 ? fps.toFixed(1) : 'N/A'}</text>`;
        panelB += `<text x="${cx.toFixed(1)}" y="${padT + panelH + 16}" text-anchor="middle" font-size="10" font-weight="600" fill="#0f172a">${esc(s.name)}</text>`;
        panelB += `<text x="${cx.toFixed(1)}" y="${padT + panelH + 30}" text-anchor="middle" font-size="9.5" fill="#64748b">${esc(s.atomCount)} atoms</text>`;
    });

    // Draw 30 FPS interactive threshold line + crisp pill label ON TOP of bars
    const y30 = yPosB(30);
    panelB += `<line x1="${pBX}" y1="${y30.toFixed(1)}" x2="${pBX + panelW}" y2="${y30.toFixed(1)}" stroke="#15803d" stroke-width="1.6" stroke-dasharray="6,4"/>`;
    panelB += `<rect x="${(pBX + panelW - 146).toFixed(1)}" y="${(y30 - 18).toFixed(1)}" width="140" height="16" rx="3" fill="#ffffff" fill-opacity="0.95" stroke="#bbf7d0"/>`;
    panelB += `<text x="${(pBX + panelW - 76).toFixed(1)}" y="${(y30 - 6.5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#15803d">30 FPS interactive target</text>`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="800" fill="#0f172a">VortexMD Interactive Responsiveness Across Multi-Scale MD Trajectories</text>
  ${panelA}
  ${panelB}
</svg>`;
}

export async function generateBenchmarkPlots(browser, data, outputDir) {
    const figs = [
        { name: 'fig_memory_scaling', svg: buildMemoryScalingSvg(data), w: 1120, h: 460 },
        { name: 'fig_performance_matrix', svg: buildPerformanceMatrixSvg(data), w: 1120, h: 430 },
    ];
    for (const f of figs) {
        const svgPath = path.join(outputDir, `${f.name}.svg`);
        const pngPath = path.join(outputDir, `${f.name}.png`);
        fs.writeFileSync(svgPath, f.svg, 'utf-8');
        if (browser) {
            const ctx = await browser.newContext({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 3 });
            const page = await ctx.newPage();
            await page.setContent(`<!doctype html><html><body style="margin:0;padding:0;background:#fff;">${f.svg}</body></html>`);
            await page.screenshot({ path: pngPath, fullPage: true });
            await ctx.close();
        }
        console.log(`[PLOTS] Generated ${f.name}.svg${browser ? ` and ${f.name}.png (300 DPI)` : ''}`);
    }
}
