/**
 * scripts/run-benchmark-offline.mjs
 * Runs the VortexMD Multi-System CDP Benchmark against ./dist via Playwright route interception
 * (no TCP server or open ports required).
 */

import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { generateBenchmarkPlots } from './plot-benchmarks.mjs';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.pdb': 'text/plain; charset=utf-8',
    '.gro': 'text/plain; charset=utf-8',
    '.xtc': 'application/octet-stream',
};

function getGpuArgs() {
    const base = [
        '--enable-precise-memory-info',
        '--no-sandbox',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization'
    ];
    if (process.platform === 'darwin') return [...base, '--use-gl=angle', '--use-angle=metal'];
    if (process.platform === 'win32') return [...base, '--use-gl=angle', '--use-angle=d3d11'];
    return [...base, '--use-gl=egl'];
}

function getHostDesc() {
    const cpuModel = os.cpus()?.[0]?.model || 'Unknown CPU';
    const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(0);
    return `${process.platform}-${process.arch} (${cpuModel}, ${totalMemGb} GB RAM, macOS Metal ANGLE)`;
}

function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
    return `${(bytes / (1024 ** 2)).toFixed(2)} MB`;
}

async function main() {
    const durationSeconds = parseInt(process.argv[2] || '60', 10);
    const benchmarkDir = path.resolve(process.argv[3] || '../benchmarks_multi_system');
    const outputDir = path.resolve(process.argv[4] || './docs/benchmarks');
    const sampleIntervalSec = parseInt(process.argv[5] || '5', 10);
    const distDir = path.resolve('./dist');

    fs.mkdirSync(outputDir, { recursive: true });

    const files = fs.readdirSync(benchmarkDir);
    const xtcFiles = files.filter(f => f.toLowerCase().endsWith('.xtc'));
    const topoFiles = files
        .filter(f => f.toLowerCase().endsWith('.gro') || f.toLowerCase().endsWith('.pdb'))
        .sort((a, b) => {
            const extA = path.extname(a).toLowerCase();
            const extB = path.extname(b).toLowerCase();
            return extA === extB ? a.localeCompare(b) : (extA === '.gro' ? -1 : 1);
        });

    const pairs = [];
    const seen = new Set();
    for (const topo of topoFiles) {
        const baseName = path.parse(topo).name;
        if (seen.has(baseName)) continue;
        const matchingXtc = xtcFiles.find(x => path.parse(x).name === baseName);
        if (matchingXtc) {
            seen.add(baseName);
            const topoPath = path.join(benchmarkDir, topo);
            const xtcPath = path.join(benchmarkDir, matchingXtc);
            pairs.push({
                name: baseName,
                topologyPath: topoPath,
                xtcPath,
                xtcBytes: fs.statSync(xtcPath).size,
                topoBytes: fs.statSync(topoPath).size
            });
        }
    }
    pairs.sort((a, b) => a.xtcBytes - b.xtcBytes);

    console.log(`[BENCHMARK] Systems: ${pairs.map(p => `${p.name} (${formatBytes(p.xtcBytes)})`).join(', ')}`);
    const browser = await chromium.launch({ headless: true, args: getGpuArgs() });
    const browserVersion = browser.version();
    const results = [];

    for (let i = 0; i < pairs.length; i++) {
        const system = pairs[i];
        console.log(`\n[BENCHMARK] [${i + 1}/${pairs.length}] ${system.name} (${formatBytes(system.xtcBytes)})`);
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const page = await context.newPage();

        await page.route('http://vortexmd.local/**', async (route) => {
            const urlObj = new URL(route.request().url());
            let rel = decodeURIComponent(urlObj.pathname).replace(/^\/+/, '');
            if (!rel) rel = 'index.html';
            let fp = path.join(distDir, rel);
            if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
                fp = path.join(distDir, 'index.html');
            }
            const ext = path.extname(fp).toLowerCase();
            await route.fulfill({
                status: 200,
                contentType: MIME_TYPES[ext] || 'application/octet-stream',
                body: fs.readFileSync(fp)
            });
        });

        const client = await context.newCDPSession(page);
        await client.send('Performance.enable');

        try {
            await page.goto('http://vortexmd.local/', { waitUntil: 'domcontentloaded' });

            const topoT0 = performance.now();
            await page.setInputFiles('#upload-struct', system.topologyPath);
            await page.waitForSelector('#drop-zone-traj:not(.pointer-events-none)', { timeout: 90000 });
            const topoLoadMs = Math.round(performance.now() - topoT0);

            await new Promise(r => setTimeout(r, 1500));
            const m0 = await client.send('Performance.getMetrics');
            const initialHeap = m0.metrics.find(m => m.name === 'JSHeapUsedSize').value / (1024 * 1024);
            console.log(`  Topology loaded in ${topoLoadMs} ms | Baseline Heap: ${initialHeap.toFixed(2)} MB`);

            const t0 = performance.now();
            await page.setInputFiles('#upload-traj', system.xtcPath);
            await page.waitForFunction(() => {
                const max = parseInt(document.getElementById('frame-max')?.innerText || '0', 10);
                const player = document.getElementById('player');
                const hasTrajectory = max > 0 || (player && player.frameCount > 0);
                const hasOffsets = player && ((player.fileOffsets && player.fileOffsets.length > 1) || player.frameCount > 0);
                const hasRendered = player && (player.currentFrame >= 1 || (player.ringBuffer && player.ringBuffer.frameCount > 0));
                return hasTrajectory && hasOffsets && hasRendered;
            }, { timeout: 300000 });

            const ttffMs = Math.round(performance.now() - t0);
            const ttffSeconds = Number((ttffMs / 1000).toFixed(2));
            console.log(`  True TTFF: ${ttffSeconds} s (${ttffMs} ms)`);

            await page.evaluate(() => {
                const p = document.getElementById('player');
                if (p) {
                    if (typeof p.setLoop === 'function') p.setLoop(true);
                    if (!p.isPlaying && typeof p.play === 'function') p.play();
                }
            });

            const meta = await page.evaluate(() => {
                const p = document.getElementById('player');
                return {
                    atoms: p?.atomCount || p?.comp?.structure?.atomCount || 0,
                    frames: p?.frameCount || p?.ringBuffer?.frameCount || 0
                };
            });
            const rawMax = await page.$eval('#frame-max', el => (el.innerText || '').trim()).catch(() => '0');
            const atomCountNum = meta.atoms;
            const totalFramesNum = meta.frames || parseInt(rawMax.replace(/,/g, ''), 10) || 0;
            console.log(`  Metadata: ${atomCountNum.toLocaleString()} atoms, ${totalFramesNum.toLocaleString()} frames`);

            const isPaused = await page.$('#icon-play:not(.hidden)');
            if (isPaused) await page.click('#btn-play');

            const totalSamples = Math.max(1, Math.floor(durationSeconds / sampleIntervalSec));
            const timeseries = [{ elapsedSec: 0, heapMb: Number(initialHeap.toFixed(2)), fps: null, frameLatencyMs: null, currentFrame: 1 }];
            const streamingSamples = [];
            const fpsSamples = [];
            const latencySamples = [];

            for (let s = 0; s < totalSamples; s++) {
                await new Promise(r => setTimeout(r, sampleIntervalSec * 1000));
                const pausedCheck = await page.$('#icon-play:not(.hidden)');
                if (pausedCheck) await page.click('#btn-play');

                const m = await client.send('Performance.getMetrics');
                const currentHeap = m.metrics.find(x => x.name === 'JSHeapUsedSize').value / (1024 * 1024);
                streamingSamples.push(currentHeap);

                const telemetry = await page.evaluate(() => {
                    const p = document.getElementById('player');
                    const metrics = (typeof p?.getPerformanceMetrics === 'function')
                        ? p.getPerformanceMetrics()
                        : p?.viewportManager?.getPerformanceMetrics?.();
                    const fps = (metrics && typeof metrics.fps === 'number' && Number.isFinite(metrics.fps) && metrics.fps > 0)
                        ? metrics.fps : null;
                    const frameTime = (metrics && typeof metrics.avgFrameTime === 'number' && Number.isFinite(metrics.avgFrameTime) && metrics.avgFrameTime > 0)
                        ? metrics.avgFrameTime : (fps ? 1000 / fps : null);
                    return { fps, frameTime, currentFrame: p?.currentFrame ?? null };
                });

                if (telemetry.fps !== null) fpsSamples.push(telemetry.fps);
                if (telemetry.frameTime !== null) latencySamples.push(telemetry.frameTime);

                const elapsed = (s + 1) * sampleIntervalSec;
                timeseries.push({
                    elapsedSec: elapsed,
                    heapMb: Number(currentHeap.toFixed(2)),
                    fps: telemetry.fps !== null ? Number(telemetry.fps.toFixed(1)) : null,
                    frameLatencyMs: telemetry.frameTime !== null ? Number(telemetry.frameTime.toFixed(2)) : null,
                    currentFrame: telemetry.currentFrame
                });
                console.log(`  [${elapsed}s/${durationSeconds}s] Heap=${currentHeap.toFixed(2)} MB | FPS=${telemetry.fps !== null ? telemetry.fps.toFixed(1) : 'N/A'}`);
            }

            const peakHeapNum = Math.max(initialHeap, ...streamingSamples);
            const avgHeapNum = streamingSamples.reduce((a, b) => a + b, 0) / streamingSamples.length;
            const heapDeltaNum = peakHeapNum - initialHeap;
            const meanFpsNum = fpsSamples.length > 0 ? (fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : null;
            const meanLatencyNum = latencySamples.length > 0 ? (latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length) : null;

            results.push({
                name: system.name,
                topologyFile: path.basename(system.topologyPath),
                xtcFile: path.basename(system.xtcPath),
                atomCountNum,
                atomCount: atomCountNum > 0 ? atomCountNum.toLocaleString() : 'N/A',
                totalFramesNum,
                totalFrames: totalFramesNum > 0 ? totalFramesNum.toLocaleString() : 'N/A',
                xtcBytes: system.xtcBytes,
                xtcMb: Number((system.xtcBytes / (1024 ** 2)).toFixed(2)),
                trajectorySize: formatBytes(system.xtcBytes),
                topoLoadMs,
                ttffMs,
                ttffSeconds,
                baselineHeapMb: Number(initialHeap.toFixed(2)),
                peakHeapMb: Number(peakHeapNum.toFixed(2)),
                avgHeapMb: Number(avgHeapNum.toFixed(2)),
                heapDeltaMb: Number(heapDeltaNum.toFixed(2)),
                meanFps: meanFpsNum !== null ? Number(meanFpsNum.toFixed(1)) : null,
                meanLatencyMs: meanLatencyNum !== null ? Number(meanLatencyNum.toFixed(2)) : null,
                timeseries
            });
        } finally {
            await context.close();
        }
    }

    const isoDate = new Date().toISOString();
    const hostDesc = getHostDesc();
    const rawPayload = {
        timestampUtc: isoDate,
        hostPlatform: hostDesc,
        chromiumVersion: browserVersion,
        durationSeconds,
        sampleIntervalSec,
        systems: results
    };
    fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-raw.json'), JSON.stringify(rawPayload, null, 2), 'utf-8');

    await generateBenchmarkPlots(browser, rawPayload, outputDir);
    await browser.close();

    const summaryCsvHeader = 'System,Topology,Trajectory,Atoms,Frames,Size_MB,Size_Label,TopoLoad_ms,TTFF_ms,TTFF_s,Baseline_Heap_MB,Peak_Heap_MB,Mean_Heap_MB,Heap_Delta_MB,Mean_FPS,Mean_Latency_ms\n';
    const summaryCsvBody = results.map(r => [
        r.name, r.topologyFile, r.xtcFile, r.atomCountNum, r.totalFramesNum,
        r.xtcMb, r.trajectorySize, r.topoLoadMs, r.ttffMs, r.ttffSeconds,
        r.baselineHeapMb, r.peakHeapMb, r.avgHeapMb, r.heapDeltaMb,
        r.meanFps ?? '', r.meanLatencyMs ?? ''
    ].join(',')).join('\n') + '\n';
    fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-summary.csv'), summaryCsvHeader + summaryCsvBody, 'utf-8');

    const tsCsvHeader = 'System,Size_MB,Elapsed_s,JS_Heap_MB,FPS,Frame_Latency_ms,Current_Frame\n';
    const tsCsvRows = [];
    for (const r of results) {
        for (const pt of r.timeseries) {
            tsCsvRows.push([r.name, r.xtcMb, pt.elapsedSec, pt.heapMb, pt.fps ?? '', pt.frameLatencyMs ?? '', pt.currentFrame ?? ''].join(','));
        }
    }
    fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-timeseries.csv'), tsCsvHeader + tsCsvRows.join('\n') + '\n', 'utf-8');

    const rows = results.map(r =>
        `| **${r.name}** | ${r.atomCount} | ${r.totalFrames} | ${r.trajectorySize} | ${r.ttffSeconds.toFixed(2)} s | ${r.baselineHeapMb.toFixed(2)} MB | ${r.peakHeapMb.toFixed(2)} MB | ${r.avgHeapMb.toFixed(2)} MB | ${r.heapDeltaMb.toFixed(2)} MB | ${r.meanFps !== null ? `${r.meanFps.toFixed(1)} FPS` : 'N/A'} |`
    ).join('\n');

    const mdContent = `# VortexMD Multi-System Empirical Runtime Benchmark

*Generated via Chrome DevTools Protocol (CDP) memory & frame-rate tracing on ${isoDate}*

## 1. Multi-System Performance Matrix

| Benchmark System | Total Atoms | Total Frames | Trajectory Size | TTFF (s) | Baseline Heap | Peak Heap | Mean Streaming Heap | Heap Delta | Mean FPS |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## 2. Technical Methodology
- **Host Platform:** ${hostDesc}
- **Browser Engine:** Headless Chromium ${browserVersion} with hardware-accelerated ANGLE pipeline.
- **Context Isolation:** Independent browser context (\`browser.newContext()\`) per system to prevent cross-system heap contamination.
- **Sampling Protocol:** ${durationSeconds} s continuous looping playback per system, sampled every ${sampleIntervalSec} s via CDP \`Performance.getMetrics\` (\`JSHeapUsedSize\`) and \`<vortexmd-engine>.getPerformanceMetrics()\`.
`;

    fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-report.md'), mdContent, 'utf-8');
    fs.writeFileSync(path.resolve(process.cwd(), 'benchmark-results.md'), mdContent, 'utf-8');
    console.log('\n[BENCHMARK] Complete! Wrote reports to', outputDir);
}

main().catch(err => {
    console.error('[BENCHMARK FATAL ERROR]', err);
    process.exit(1);
});
