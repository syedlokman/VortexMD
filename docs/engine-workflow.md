# VortexMD Engine Workflow

> How VortexMD streams, indexes, and renders multi-gigabyte MD trajectories inside a browser without exhausting RAM.

## 1. End-to-End Pipeline

```
Topology (.pdb/.gro/…) + Trajectory (.xtc)
        │
        ▼
[1] Pre-flight Validation (trajectory-validator.js)
    • Checks magic number, atom count match vs. topology, positive box diagonals
        │
        ▼
[2] Progressive Header Indexing (indexer.js + worker.js)
    • Scans compressed frame headers only (no coordinate decompression)
    • Records byte offsets + timestamps; caches index in IndexedDB (index-cache.js)
    • Unlocks playback as soon as initial frames are indexed (fast TTFF)
        │
        ▼
[3] Demand-Driven Ring Buffer (trajectory.js + memory-budget.js)
    • Fetches only active/prefetch frame byte slices via File.slice()
    • Decompresses XTC frames off-thread (headless-xtc.js in Web Worker pool)
    • Evicts stale frames automatically under an adaptive 50–500 MB RAM budget
        │
        ▼
[4] Unified 30 FPS Render Loop (playback.js + viewport.js)
    • Updates NGL atomic positions in-place (zero object reallocation)
    • Optional Catmull-Rom spline sub-frame interpolation & live superpose
    • Triggers live 3D measurement updates & emits EVENTS.FRAME_UPDATE
```

## 2. Trajectory Pre-Processing Assumption

Like PyMOL and Mol*, VortexMD does not unwrap periodic boundary conditions (PBC) on the fly. Input trajectories are expected to be pre-processed (e.g., via GROMACS `gmx trjconv -pbc mol` or MDAnalysis) so that:
- Molecules are PBC-wrapped and centered cleanly.
- Concatenated or multi-segment trajectories have monotonically increasing timestamps and step metadata.

## 3. Binary Indexing & IndexedDB Caching

- **Header-only scan (`src/engine/indexer.js`)**: Instead of decompressing coordinates up front, the indexer jumps frame-by-frame using each XTC frame's compressed payload size to build a compact `fileOffsets` table and `frameTimes` array.
- **Progressive playback**: The player bar unlocks immediately after the first batch of frames is indexed while the remaining frames finish indexing in the background.
- **Zero-wait reloads (`src/engine/index-cache.js`)**: Verified offset tables are keyed by file metadata and stored in browser IndexedDB, allowing repeat loads of multi-gigabyte files to skip indexing.

## 4. Adaptive Memory Budget & Ring Buffer

`src/engine/memory-budget.js` scales the frame cache ceiling automatically based on `navigator.deviceMemory` and device class:

| Hardware Tier | RAM Cache Budget |
| :--- | :--- |
| Desktop / Workstation ($\ge 8\text{ GB}$ RAM) | **500 MB** |
| Mid-Range Desktop (4–8 GB RAM) / Standard Fallback | **250 MB** |
| Low-RAM System (2–4 GB RAM) | **100 MB** |
| Mobile / Constrained ($< 2\text{ GB}$ RAM) | **50 MB** |

When uncompressed trajectory size (`atoms × 3 × 4 bytes × frames`) exceeds the budget, `RingBufferManager` (`src/engine/trajectory.js`) streams only the active playback window and evicts distant frames—keeping JS heap usage flat (~13–40 MB in multi-system benchmarks up to 5.37 GB; see [Benchmark Results](../benchmark-results.md)).

## 5. Web Workers, Playback Clock & Offline PWA

- **Multi-Threaded Workers (`worker-manager.js`, `worker.js`, `headless-xtc.js`)**: Pure-JS XTC decompression and Horn quaternion RMSD batches run off-thread so the UI and WebGL canvas stay responsive.
- **Unified Playback Clock (`playback.js`)**: Both spline and discrete playback modes derive progression from a single base rate (`BASE_FRAMES_PER_SECOND = 30`):
  ```
  framesToAdvance = (clampedElapsedMs / 1000) * 30 * speedMultiplier * frameStep * dirSign
  ```
  `frameStep` (`1, 2, 5, 10`) advances trajectory frames consistently across both modes.
- **Offline PWA Caching (`vite.config.js`)**: Built with `vite-plugin-pwa` (`registerType: 'autoUpdate'`, `display: 'standalone'`). Workbox precaches the app shell and `demo/demo.pdb` for offline launch while routing remote `.xtc`/`.gro`/`.pdb`/`.cif` requests as `NetworkOnly`; local files run completely offline via the File API and IndexedDB.
