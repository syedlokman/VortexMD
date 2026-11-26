# VortexMD Empirical Runtime Benchmarks

*Multi-system CDP tracing (2026-11-24) and live browser-console head-to-head telemetry (2026-11-25) on Apple M1 MacBook Air (8 GB RAM, macOS `darwin-arm64`, Chromium 156).*

## 1. Multi-System Performance Matrix (Automated CDP)

| Benchmark System | Total Atoms | Total Frames | Trajectory Size | Progressive TTFF | Full XTC Index | Baseline Heap | Peak Heap | Mean Streaming Heap | Heap Delta | Mean FPS |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **16pk_A** | 6,378 | 1,001 | 28.39 MB | 62 ms | 0.02 s | 9.61 MB | 24.16 MB | 13.89 MB | 14.54 MB | 60.7 FPS |
| **traj_7nx6** | 222,853 | 110 | 795.36 MB | 113 ms | 3.36 s | 8.86 MB | 39.41 MB | 26.14 MB | 30.55 MB | 37.8 FPS |
| **md_rep1_noPBC_em1** | 37,006 | 10,001 | 1.24 GB | 83 ms | 0.47 s | 11.84 MB | 26.20 MB | 15.55 MB | 14.36 MB | 60.9 FPS |
| **PE_CL_530Run** | 58,500 | 26,501 | 5.37 GB | 86 ms | 3.42 s | 8.82 MB | 13.44 MB | 12.14 MB | 4.62 MB | 60.3 FPS |

## 2. Head-to-Head Browser Console Benchmark (1.24 GB Chalcone Trajectory)

Measured in live Chrome 156 (`--enable-precise-memory-info`) via `scripts/console-head-to-head-benchmark.js` (raw logs: `benchmark-mol.json`, `benchmark-native-ngl.json`, `benchmark-vortexmd.json`):

| Visualization Tool | Live URL | TTFF | Full Parse / Index | Max UI Lockup | Total Frozen Time (>50 ms) | Baseline Heap | Peak JS Heap | Mean JS Heap | Mean FPS |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Mol\*** | `molstar.org/viewer` | N/A | 24.24 s | 0.20 s | 19.44 s (192 stalls) | 63.86 MB | 6,201.67 MB | 5,327.12 MB | 43.4 FPS |
| **Native NGL** | `nglviewer.org/ngl` | N/A | 36.70 s | 24.67 s | 24.82 s (2 stalls) | 44.16 MB | 5,563.91 MB | 4,048.59 MB | 59.3 FPS |
| **VortexMD (v1.0)** | `vortexmd.netlify.app` | **0.05 s** | **0.08 s**\* | **0.08 s** | **0.62 s** (10 stalls) | 36.46 MB | **421.45 MB** | 303.33 MB | **59.2 FPS** |

*\*0.08 s reflects IndexedDB offset-cache hit on repeat load (cold-start binary indexing takes 0.47 s per Section 1). Peak JS heap (421.45 MB) remains strictly bounded below the 500 MB adaptive RAM cache ceiling.*

## 3. Technical Methodology
- **Host Platform:** `darwin-arm64` (Apple M1, 8 GB RAM, macOS Metal ANGLE).
- **Automated CDP Suite:** Headless Chromium 156.0.8078.4 with isolated browser contexts (`browser.newContext()`) per system, 60 s continuous looping playback sampled every 5 s via `Performance.getMetrics` (`JSHeapUsedSize`) and `<vortexmd-engine>.getPerformanceMetrics()`.
- **Console Suite:** Live Chrome 156.0.0.0 with `scripts/console-head-to-head-benchmark.js` measuring `performance.memory.usedJSHeapSize`, `requestAnimationFrame` main-thread stalls (>50 ms), and playback FPS.

## 4. Public Benchmark Datasets

All external trajectory datasets used in these benchmarks are publicly available from open repositories:

| Benchmark ID | System & Author(s) | Exact Source Files | Repository / Identifier |
| :--- | :--- | :--- | :--- |
| **16pk_A** | Phosphoglycerate kinase, glycosomal (`16pk_A`) | `16pk_A.pdb`, `16pk_A.xtc` | [ATLAS Database](https://www.dsimb.inserm.fr/ATLAS/database/ATLAS/16pk_A/16pk_A.html) |
| **traj_7nx6** | Molecular dynamics of the P.1 variant of SARS-CoV-2 (*Oliveira et al., 2021*) | `traj_7nx6.gro` (15.4 MB), `traj_7nx6.xtc` (834.0 MB) | Zenodo `#5111905` (`zenodo.org/records/5111905`; bioRxiv DOI: `10.1101/2021.04.09.439181`) |
| **md_rep1_noPBC_em1** | Chalcone derivates MD -ewap (*E. W. de Alencar Pereira, 2026*) | `solv_ions_EM1.gro` (1.7 MB), `md_rep1_noPBC_em1.xtc` (1.3 GB) | Zenodo `#21475591`, DOI: `10.5281/zenodo.21475591` |
| **PE_CL_530Run** | All-atom Gromacs Trajectory of POPE/TOCL bilayer mixture (*M. Doktorova, 2023*) | `PE_CL_Run.gro` (4.0 MB), `PE_CL_530Run.xtc` (5.8 GB) | Zenodo `#13984201`, DOI: `10.5281/zenodo.13984201` |
