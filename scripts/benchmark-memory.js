/**
 * scripts/benchmark-memory.js
 * Automated Multi-System Benchmark Engine with Isolated Contexts
 * VortexMD — Empirical Runtime Benchmark Suite
 *
 * Collects runtime performance and memory metrics via Chrome DevTools Protocol (CDP):
 * - Auto-discovers paired (.gro / .pdb) + .xtc files in the target benchmark directory
 * - Runs each system in an isolated browser session (browser.newContext())
 * - Injects topology and trajectory via Playwright input files
 * - Measures true Time-to-First-Frame (TTFF)
 * - Samples CDP JSHeapUsedSize, live FPS, and frame render latency during continuous streaming
 * - Exports Markdown report, raw JSON, and summary & time-series CSVs to docs/benchmarks/
 *
 * Usage:
 *   node scripts/benchmark-memory.js [targetUrl] [durationSeconds] [benchmarkDir] [outputDir] [sampleIntervalSec]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';

function getCrossPlatformGpuArgs() {
    const baseArgs = [
        '--enable-precise-memory-info',
        '--no-sandbox',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization'
    ];

    if (process.platform === 'darwin') {
        return [...baseArgs, '--use-gl=angle', '--use-angle=metal'];
    } else if (process.platform === 'win32') {
        return [...baseArgs, '--use-gl=angle', '--use-angle=d3d11'];
    } else {
        return [...baseArgs, '--use-gl=egl'];
    }
}

function getHostPlatformDescription() {
    const arch = process.arch;
    const cpuModel = os.cpus()?.[0]?.model || 'Unknown CPU';
    const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(0);
    if (process.platform === 'darwin') {
        return `${process.platform}-${arch} (${cpuModel}, ${totalMemGb} GB RAM, macOS Metal ANGLE)`;
    } else if (process.platform === 'win32') {
        return `${process.platform}-${arch} (${cpuModel}, ${totalMemGb} GB RAM, Windows DirectX 11 ANGLE)`;
    } else {
        return `${process.platform}-${arch} (${cpuModel}, ${totalMemGb} GB RAM, Linux EGL/OpenGL)`;
    }
}

function resolveBenchmarkDir(cliArg) {
    if (cliArg) return path.resolve(cliArg);
    const localDefault = path.resolve('./benchmarks');
    if (fs.existsSync(localDefault)) return localDefault;
    const parentMulti = path.resolve('../benchmarks_multi_system');
    if (fs.existsSync(parentMulti)) return parentMulti;
    return localDefault;
}

function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
    return `${(bytes / (1024 ** 2)).toFixed(2)} MB`;
}

async function runBenchmarks() {
    const targetUrl = process.argv[2] || 'http://localhost:3000';
    const durationSeconds = parseInt(process.argv[3] || '60', 10);
    const benchmarkDir = resolveBenchmarkDir(process.argv[4]);
    const outputDir = path.resolve(process.argv[5] || './docs/benchmarks');
    const sampleIntervalSec = parseInt(process.argv[6] || '5', 10);

    console.log(`=============================================================`);
    console.log(`[BENCHMARK] VortexMD Multi-System Benchmark Engine`);
    console.log(`[BENCHMARK] Target URL:          ${targetUrl}`);
    console.log(`[BENCHMARK] Duration per system: ${durationSeconds} s (sampling every ${sampleIntervalSec} s)`);
    console.log(`[BENCHMARK] Benchmark Directory: ${benchmarkDir}`);
    console.log(`[BENCHMARK] Output Directory:    ${outputDir}`);
    console.log(`[BENCHMARK] Host Platform:       ${getHostPlatformDescription()}`);
    console.log(`=============================================================\n`);

    if (!fs.existsSync(benchmarkDir)) {
        fs.mkdirSync(benchmarkDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    const files = fs.readdirSync(benchmarkDir);
    const xtcFiles = files.filter(f => f.toLowerCase().endsWith('.xtc'));
    const topoExtensions = ['.gro', '.pdb'];
    const topoFiles = files.filter(f => {
        const lower = f.toLowerCase();
        return topoExtensions.some(ext => lower.endsWith(ext));
    });

    // .gro takes precedence over .pdb if both exist with the same base name
    topoFiles.sort((a, b) => {
        const extA = path.extname(a).toLowerCase();
        const extB = path.extname(b).toLowerCase();
        if (extA === extB) return a.localeCompare(b);
        return extA === '.gro' ? -1 : 1;
    });

    const pairs = [];
    const seenSystems = new Set();
    for (const topo of topoFiles) {
        const baseName = path.parse(topo).name;
        if (seenSystems.has(baseName)) continue;
        const matchingXtc = xtcFiles.find(x => path.parse(x).name === baseName);
        if (matchingXtc) {
            seenSystems.add(baseName);
            const topoPath = path.join(benchmarkDir, topo);
            const xtcPath = path.join(benchmarkDir, matchingXtc);
            pairs.push({
                name: baseName,
                topologyPath: topoPath,
                xtcPath: xtcPath,
                xtcBytes: fs.statSync(xtcPath).size,
                topoBytes: fs.statSync(topoPath).size
            });
        }
    }
    // Order from smallest to largest trajectory size for clean scaling tables & charts
    pairs.sort((a, b) => a.xtcBytes - b.xtcBytes);

    if (pairs.length === 0) {
        console.log(`[BENCHMARK] No matching (.gro / .pdb + .xtc) pairs found in ${benchmarkDir}.`);
        process.exit(0);
    }

    console.log(`[BENCHMARK] Discovered ${pairs.length} benchmark system pair(s) (ordered by XTC size):`);
    pairs.forEach((p, idx) => {
        console.log(`  ${idx + 1}. ${p.name} (Topology: ${path.basename(p.topologyPath)} [${formatBytes(p.topoBytes)}], XTC: ${path.basename(p.xtcPath)} [${formatBytes(p.xtcBytes)}])`);
    });
    console.log('');

    const browser = await chromium.launch({
        headless: true,
        args: getCrossPlatformGpuArgs()
    });
    const browserVersion = browser.version();
    console.log(`[BENCHMARK] Chromium version: ${browserVersion}\n`);

    const results = [];

    for (let i = 0; i < pairs.length; i++) {
        const system = pairs[i];
        console.log(`-------------------------------------------------------------`);
        console.log(`[BENCHMARK] Executing System [${i + 1}/${pairs.length}]: ${system.name}`);
        console.log(`-------------------------------------------------------------`);

        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 }
        });
        const page = await context.newPage();
        const client = await context.newCDPSession(page);
        await client.send('Performance.enable');

        try {
            console.log(`[BENCHMARK] [${system.name}] Navigating to ${targetUrl}...`);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

            // Inject Topology & Measure Baseline (90 s timeout for large 15+ MB .gro topologies)
            console.log(`[BENCHMARK] [${system.name}] Injecting topology: ${path.basename(system.topologyPath)}`);
            const topoT0 = performance.now();
            await page.setInputFiles('#upload-struct', system.topologyPath);
            await page.waitForSelector('#drop-zone-traj:not(.pointer-events-none)', { timeout: 90000 });
            const topoLoadMs = Math.round(performance.now() - topoT0);

            // Allow heap to settle after topology load
            await new Promise(r => setTimeout(r, 1500));
            const m0 = await client.send('Performance.getMetrics');
            const initialHeap = m0.metrics.find(m => m.name === 'JSHeapUsedSize').value / (1024 * 1024);
            console.log(`[BENCHMARK] [${system.name}] Topology loaded in ${topoLoadMs} ms | Baseline JS Heap: ${initialHeap.toFixed(2)} MB`);

            // Inject Trajectory & Measure True TTFF (300 s timeout for multi-GB XTC binary indexing)
            console.log(`[BENCHMARK] [${system.name}] Injecting trajectory: ${path.basename(system.xtcPath)} (${formatBytes(system.xtcBytes)})`);
            const t0 = performance.now();
            await page.setInputFiles('#upload-traj', system.xtcPath);

            console.log(`[BENCHMARK] [${system.name}] Awaiting Frame 1 decode and render (True TTFF)...`);
            await page.waitForFunction(() => {
                const max = parseInt(document.getElementById('frame-max')?.innerText || '0', 10);
                const player = document.getElementById('player');
                const hasTrajectory = max > 0 || (player && player.frameCount > 0);
                const hasOffsets = player && ((player.fileOffsets && player.fileOffsets.length > 1) || player.frameCount > 0);
                const hasRendered = player && (player.currentFrame >= 1 || (player.ringBuffer && player.ringBuffer.frameCount > 0));
                return hasTrajectory && hasOffsets && hasRendered;
            }, { timeout: 300000 });

            const ttffMs = Math.round(performance.now() - t0);
            const ttffSeconds = (ttffMs / 1000).toFixed(2);
            console.log(`[BENCHMARK] [${system.name}] True TTFF: ${ttffSeconds} s (${ttffMs} ms)`);

            // Ensure looping playback is active
            await page.evaluate(() => {
                const player = document.getElementById('player');
                if (player) {
                    if (typeof player.setLoop === 'function') player.setLoop(true);
                    if (!player.isPlaying && typeof player.play === 'function') player.play();
                }
            });

            // Harvest Metadata via PUBLIC_API + DOM fallback
            const meta = await page.evaluate(() => {
                const p = document.getElementById('player');
                const atoms = p?.atomCount || p?.comp?.structure?.atomCount || 0;
                const frames = p?.frameCount || p?.ringBuffer?.frameCount || 0;
                return { atoms, frames };
            });

            let atomCountNum = meta.atoms;
            if (!atomCountNum) {
                const rawStatusText = await page.$eval('#struct-status-text', el => el.innerText || el.textContent).catch(() => '');
                const atomMatch = rawStatusText.match(/([\d,]+)\s*atoms/i) || rawStatusText.match(/([\d,]+)/);
                atomCountNum = atomMatch ? parseInt(atomMatch[1].replace(/,/g, ''), 10) : 0;
            }
            const rawMax = await page.$eval('#frame-max', el => (el.innerText || el.textContent || '').trim()).catch(() => '0');
            const totalFramesNum = meta.frames || parseInt(rawMax.replace(/,/g, ''), 10) || 0;

            const atomCount = atomCountNum > 0 ? atomCountNum.toLocaleString() : 'N/A';
            const totalFrames = totalFramesNum > 0 ? totalFramesNum.toLocaleString() : 'N/A';
            const trajectorySize = formatBytes(system.xtcBytes);

            console.log(`[BENCHMARK] [${system.name}] Metadata: ${atomCount} atoms, ${totalFrames} frames, ${trajectorySize}`);

            // Ensure play button is engaged
            const isPaused = await page.$('#icon-play:not(.hidden)');
            if (isPaused) {
                await page.click('#btn-play');
            }

            // Continuous Streaming Telemetry Sampling
            const totalSamples = Math.max(1, Math.floor(durationSeconds / sampleIntervalSec));
            const timeseries = [{ elapsedSec: 0, heapMb: Number(initialHeap.toFixed(2)), fps: null, frameLatencyMs: null, currentFrame: 1 }];
            const streamingSamples = [];
            const fpsSamples = [];
            const latencySamples = [];

            console.log(`[BENCHMARK] [${system.name}] Sampling telemetry (${totalSamples} samples @ ${sampleIntervalSec}s intervals)...`);

            for (let s = 0; s < totalSamples; s++) {
                await new Promise(r => setTimeout(r, sampleIntervalSec * 1000));

                const pausedCheck = await page.$('#icon-play:not(.hidden)');
                if (pausedCheck) {
                    await page.click('#btn-play');
                }

                const m = await client.send('Performance.getMetrics');
                const jsHeapMetric = m.metrics.find(metric => metric.name === 'JSHeapUsedSize');
                const currentHeap = jsHeapMetric ? (jsHeapMetric.value / (1024 * 1024)) : initialHeap;
                streamingSamples.push(currentHeap);

                const telemetry = await page.evaluate(() => {
                    const p = document.getElementById('player');
                    const metrics = (typeof p?.getPerformanceMetrics === 'function')
                        ? p.getPerformanceMetrics()
                        : p?.viewportManager?.getPerformanceMetrics?.();
                    const fps = (metrics && typeof metrics.fps === 'number' && Number.isFinite(metrics.fps) && metrics.fps > 0)
                        ? metrics.fps : null;
                    const frameTime = (metrics && typeof metrics.avgFrameTime === 'number' && Number.isFinite(metrics.avgFrameTime) && metrics.avgFrameTime > 0)
                        ? metrics.avgFrameTime
                        : (fps ? 1000 / fps : null);
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

                const fpsDisplay = telemetry.fps !== null ? `${telemetry.fps.toFixed(1)}` : 'N/A';
                console.log(`[BENCHMARK] [${system.name}] [${elapsed}s / ${durationSeconds}s] Heap: ${currentHeap.toFixed(2)} MB | FPS: ${fpsDisplay}`);
            }

            const allHeapSamples = [initialHeap, ...streamingSamples];
            const peakHeapNum = Math.max(...allHeapSamples);
            const avgHeapNum = streamingSamples.reduce((a, b) => a + b, 0) / streamingSamples.length;
            const heapDeltaNum = peakHeapNum - initialHeap;
            const meanFpsNum = fpsSamples.length > 0
                ? (fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length)
                : null;
            const meanLatencyNum = latencySamples.length > 0
                ? (latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
                : null;

            console.log(`[BENCHMARK] [${system.name}] Summary: TTFF=${ttffSeconds}s | Baseline=${initialHeap.toFixed(2)} MB | Peak=${peakHeapNum.toFixed(2)} MB | Mean=${avgHeapNum.toFixed(2)} MB | Delta=${heapDeltaNum.toFixed(2)} MB | FPS=${meanFpsNum !== null ? meanFpsNum.toFixed(1) : 'N/A'}`);

            results.push({
                name: system.name,
                topologyFile: path.basename(system.topologyPath),
                xtcFile: path.basename(system.xtcPath),
                atomCountNum,
                atomCount,
                totalFramesNum,
                totalFrames,
                xtcBytes: system.xtcBytes,
                xtcMb: Number((system.xtcBytes / (1024 ** 2)).toFixed(2)),
                trajectorySize,
                topoLoadMs,
                ttffMs,
                ttffSeconds: Number(ttffSeconds),
                baselineHeapMb: Number(initialHeap.toFixed(2)),
                peakHeapMb: Number(peakHeapNum.toFixed(2)),
                avgHeapMb: Number(avgHeapNum.toFixed(2)),
                heapDeltaMb: Number(heapDeltaNum.toFixed(2)),
                meanFps: meanFpsNum !== null ? Number(meanFpsNum.toFixed(1)) : null,
                meanLatencyMs: meanLatencyNum !== null ? Number(meanLatencyNum.toFixed(2)) : null,
                timeseries
            });
        } catch (err) {
            console.error(`[BENCHMARK] [${system.name}] Error during benchmarking:`, err);
        } finally {
            console.log(`[BENCHMARK] [${system.name}] Closing isolated browser context...`);
            await context.close();
        }
    }

    await browser.close();

    if (results.length > 0) {
        const isoDate = new Date().toISOString();
        const hostDesc = getHostPlatformDescription();

        // 1. Save raw JSON
        const rawJsonPath = path.join(outputDir, 'benchmark-multi-system-raw.json');
        fs.writeFileSync(rawJsonPath, JSON.stringify({
            timestampUtc: isoDate,
            hostPlatform: hostDesc,
            chromiumVersion: browserVersion,
            durationSeconds,
            sampleIntervalSec,
            systems: results
        }, null, 2), 'utf-8');

        // 2. Save Summary CSV
        const summaryCsvHeader = 'System,Topology,Trajectory,Atoms,Frames,Size_MB,Size_Label,TopoLoad_ms,TTFF_ms,TTFF_s,Baseline_Heap_MB,Peak_Heap_MB,Mean_Heap_MB,Heap_Delta_MB,Mean_FPS,Mean_Latency_ms\n';
        const summaryCsvBody = results.map(r => [
            r.name, r.topologyFile, r.xtcFile, r.atomCountNum, r.totalFramesNum,
            r.xtcMb, r.trajectorySize, r.topoLoadMs, r.ttffMs, r.ttffSeconds,
            r.baselineHeapMb, r.peakHeapMb, r.avgHeapMb, r.heapDeltaMb,
            r.meanFps ?? '', r.meanLatencyMs ?? ''
        ].join(',')).join('\n') + '\n';
        fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-summary.csv'), summaryCsvHeader + summaryCsvBody, 'utf-8');

        // 3. Save Time-Series CSV
        const tsCsvHeader = 'System,Size_MB,Elapsed_s,JS_Heap_MB,FPS,Frame_Latency_ms,Current_Frame\n';
        const tsCsvRows = [];
        for (const r of results) {
            for (const pt of r.timeseries) {
                tsCsvRows.push([r.name, r.xtcMb, pt.elapsedSec, pt.heapMb, pt.fps ?? '', pt.frameLatencyMs ?? '', pt.currentFrame ?? ''].join(','));
            }
        }
        fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-timeseries.csv'), tsCsvHeader + tsCsvRows.join('\n') + '\n', 'utf-8');

        // 4. Save Markdown Report in docs/benchmarks/
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
- **Outputs:** Raw JSON (\`benchmark-multi-system-raw.json\`), summary & time-series CSVs, and 300 DPI publication figures stored in \`docs/benchmarks/\`.
`;

        fs.writeFileSync(path.join(outputDir, 'benchmark-multi-system-report.md'), mdContent, 'utf-8');

        console.log(`\n[BENCHMARK] Exported all results to: ${outputDir}`);
        console.log(mdContent);
    } else {
        console.log(`[BENCHMARK] No benchmark results were recorded.`);
        process.exit(1);
    }
}

runBenchmarks().catch(err => {
    console.error('[BENCHMARK FATAL ERROR]', err);
    process.exit(1);
});
