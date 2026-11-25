/**
 * scripts/console-head-to-head-benchmark.js
 *
 * Self-contained browser DevTools Console telemetry harness for head-to-head
 * benchmarking across VortexMD (https://vortexmd.netlify.app), Mol*, and Native NGL.
 *
 * Usage:
 *   1. Open target viewer in Chromium/Chrome/Brave (launch with
 *      --enable-precise-memory-info for exact JS heap readings if desired).
 *   2. Paste this entire script into DevTools Console and press Enter.
 *   3. Load your topology + trajectory files in the web app UI and start playback.
 *   4. After ~60 s of playback (or once loaded), run:
 *        __vortexBench.report()     // prints summary + Markdown row
 *        __vortexBench.download()   // downloads JSON telemetry file
 *        __vortexBench.stop()       // stops sampling & restores listeners
 */

(() => {
  if (window.__vortexBench?.stop) {
    window.__vortexBench.stop();
  }

  const host = location.hostname || 'local';
  const toolName = /vortexmd/i.test(host) || document.querySelector('vortexmd-engine')
    ? 'VortexMD'
    : /molstar|rcsb/i.test(host)
      ? 'Mol*'
      : /ngl/i.test(host)
        ? 'Native NGL'
        : host;

  const STALL_THRESHOLD_MS = 50; // Long-task / UI freeze threshold (W3C Long Tasks)
  const HEAP_SAMPLE_MS = 1000;

  const getHeapMb = () => {
    const m = performance.memory;
    return m ? +(m.usedJSHeapSize / (1024 * 1024)).toFixed(2) : null;
  };

  const state = {
    tool: toolName,
    url: location.href,
    userAgent: navigator.userAgent,
    startedAt: new Date().toISOString(),
    baselineHeapMb: getHeapMb(),
    peakHeapMb: getHeapMb() ?? 0,
    heapSamples: [],
    injectTimeMs: null,
    ttffMs: null,
    fullParseMs: null,
    maxUiLockupMs: 0,
    totalFrozenMs: 0,
    stallCount: 0,
    fpsSamples: [],
    active: true,
  };

  // 1. Detect file injection via <input type="file"> or drag-and-drop
  const markInjection = (source) => {
    state.injectTimeMs = performance.now();
    state.ttffMs = null;
    state.fullParseMs = null;
    state.maxUiLockupMs = 0;
    state.totalFrozenMs = 0;
    state.stallCount = 0;
    state.heapSamples = [];
    state.fpsSamples = [];
    console.log(`[vortexBench] File injection detected (${source}) at t=0 ms. Recording...`);
  };

  const onInputChange = (e) => {
    if (e.target && e.target.type === 'file' && e.target.files?.length) {
      const names = Array.from(e.target.files).map(f => `${f.name} (${(f.size / 1048576).toFixed(2)} MB)`).join(', ');
      markInjection(`input: ${names}`);
    }
  };
  const onDrop = (e) => {
    if (e.dataTransfer?.files?.length) {
      const names = Array.from(e.dataTransfer.files).map(f => `${f.name} (${(f.size / 1048576).toFixed(2)} MB)`).join(', ');
      markInjection(`drop: ${names}`);
    }
  };
  document.addEventListener('change', onInputChange, true);
  window.addEventListener('drop', onDrop, true);

  // 2. Hook VortexMD custom events when running on VortexMD
  const engineEl = document.querySelector('vortexmd-engine');
  const onFrameUpdate = () => {
    if (state.injectTimeMs !== null && state.ttffMs === null) {
      state.ttffMs = +(performance.now() - state.injectTimeMs).toFixed(1);
      console.log(`[vortexBench] TTFF captured: ${(state.ttffMs / 1000).toFixed(3)} s`);
    }
  };
  const onIndexComplete = () => {
    if (state.injectTimeMs !== null && state.fullParseMs === null) {
      state.fullParseMs = +(performance.now() - state.injectTimeMs).toFixed(1);
      console.log(`[vortexBench] Full index/parse complete: ${(state.fullParseMs / 1000).toFixed(2)} s`);
    }
  };
  if (engineEl) {
    engineEl.addEventListener('frame-update', onFrameUpdate);
    engineEl.addEventListener('indexing-complete', onIndexComplete);
  }

  // 3. Track main-thread stalls (Max UI Lockup & Total Frozen Time) + FPS via rAF
  let lastRaf = performance.now();
  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  let rafId = null;

  const tick = (now) => {
    if (!state.active) return;
    const dt = now - lastRaf;
    lastRaf = now;

    if (state.injectTimeMs !== null) {
      if (dt > STALL_THRESHOLD_MS) {
        state.stallCount++;
        state.totalFrozenMs += dt;
        if (dt > state.maxUiLockupMs) state.maxUiLockupMs = dt;
      }
      fpsFrames++;
      const win = now - fpsWindowStart;
      if (win >= 1000) {
        state.fpsSamples.push(+((fpsFrames * 1000) / win).toFixed(1));
        fpsFrames = 0;
        fpsWindowStart = now;
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // 4. Periodic JS Heap sampling
  const heapTimer = setInterval(() => {
    const mb = getHeapMb();
    if (mb === null) return;
    if (mb > state.peakHeapMb) state.peakHeapMb = mb;
    if (state.injectTimeMs !== null) {
      state.heapSamples.push({
        elapsedSec: +((performance.now() - state.injectTimeMs) / 1000).toFixed(1),
        heapMb: mb,
      });
    }
  }, HEAP_SAMPLE_MS);

  // 5. Public helper API in Console
  const summarize = () => {
    const meanHeap = state.heapSamples.length
      ? +(state.heapSamples.reduce((a, b) => a + b.heapMb, 0) / state.heapSamples.length).toFixed(2)
      : state.baselineHeapMb;
    const activeFps = state.fpsSamples.filter(f => f > 1);
    const meanFps = activeFps.length
      ? +(activeFps.reduce((a, b) => a + b, 0) / activeFps.length).toFixed(1)
      : null;

    return {
      tool: state.tool,
      url: state.url,
      ttffSec: state.ttffMs !== null ? +(state.ttffMs / 1000).toFixed(2) : null,
      fullParseSec: state.fullParseMs !== null ? +(state.fullParseMs / 1000).toFixed(2) : null,
      maxUiLockupSec: +(state.maxUiLockupMs / 1000).toFixed(2),
      totalFrozenSec: +(state.totalFrozenMs / 1000).toFixed(2),
      baselineHeapMb: state.baselineHeapMb,
      peakHeapMb: +state.peakHeapMb.toFixed(2),
      meanHeapMb: meanHeap,
      meanFps,
      stallCount: state.stallCount,
      samples: state.heapSamples.length,
    };
  };

  window.__vortexBench = {
    markFullParseComplete() {
      if (state.injectTimeMs !== null) {
        state.fullParseMs = +(performance.now() - state.injectTimeMs).toFixed(1);
        console.log(`[vortexBench] Manual full parse marked: ${(state.fullParseMs / 1000).toFixed(2)} s`);
      }
    },
    markFirstFrame() {
      if (state.injectTimeMs !== null && state.ttffMs === null) {
        state.ttffMs = +(performance.now() - state.injectTimeMs).toFixed(1);
        console.log(`[vortexBench] Manual TTFF marked: ${(state.ttffMs / 1000).toFixed(3)} s`);
      }
    },
    report() {
      const s = summarize();
      console.table(s);
      const md = `| ${s.tool} | ${s.ttffSec ?? 'N/A'} s | ${s.fullParseSec ?? 'N/A'} s | ${s.maxUiLockupSec} s | ${s.totalFrozenSec} s | ${s.peakHeapMb} MB | ${s.meanFps ?? 'N/A'} FPS |`;
      console.log('Markdown row:\n' + md);
      return s;
    },
    download() {
      const payload = { summary: summarize(), raw: state };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `benchmark-${state.tool.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    stop() {
      state.active = false;
      if (rafId) cancelAnimationFrame(rafId);
      clearInterval(heapTimer);
      document.removeEventListener('change', onInputChange, true);
      window.removeEventListener('drop', onDrop, true);
      if (engineEl) {
        engineEl.removeEventListener('frame-update', onFrameUpdate);
        engineEl.removeEventListener('indexing-complete', onIndexComplete);
      }
      console.log('[vortexBench] Stopped.');
    },
  };

  console.log(`[vortexBench] Armed for "${toolName}" (baseline heap: ${state.baselineHeapMb ?? 'N/A'} MB). Load your files now; run __vortexBench.report() when finished.`);
})();
