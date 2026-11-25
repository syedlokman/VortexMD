# VortexMD Multi-System Empirical Runtime Benchmark

*Generated via Chrome DevTools Protocol (CDP) memory & frame-rate tracing on 2026-11-24T18:19:36.288Z*

## 1. Multi-System Performance Matrix

| Benchmark System | Total Atoms | Total Frames | Trajectory Size | Progressive TTFF | Full XTC Index | Baseline Heap | Peak Heap | Mean Streaming Heap | Heap Delta | Mean FPS |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **16pk_A** | 6,378 | 1,001 | 28.39 MB | 62 ms | 0.02 s | 9.61 MB | 24.16 MB | 13.89 MB | 14.54 MB | 60.7 FPS |
| **traj_7nx6** | 222,853 | 110 | 795.36 MB | 113 ms | 3.36 s | 8.86 MB | 39.41 MB | 26.14 MB | 30.55 MB | 37.8 FPS |
| **md_rep1_noPBC_em1** | 37,006 | 10,001 | 1.24 GB | 83 ms | 0.47 s | 11.84 MB | 26.20 MB | 15.55 MB | 14.36 MB | 60.9 FPS |
| **PE_CL_530Run** | 58,500 | 26,501 | 5.37 GB | 86 ms | 3.42 s | 8.82 MB | 13.44 MB | 12.14 MB | 4.62 MB | 60.3 FPS |

## 2. Technical Methodology
- **Host Platform:** darwin-arm64 (Apple M1, 8 GB RAM, macOS Metal ANGLE)
- **Browser Engine:** Headless Chromium 156.0.8078.4 with hardware-accelerated ANGLE pipeline.
- **Context Isolation:** Independent browser context (`browser.newContext()`) per system to prevent cross-system heap contamination.
- **Progressive Streaming TTFF:** VortexMD decodes and renders Frame 1 as soon as the first binary chunk is indexed (62–113 ms across 28.4 MiB to 5.37 GiB), while background indexing scans the remaining trajectory without blocking playback.
- **Sampling Protocol:** 60 s continuous looping playback per system, sampled every 5 s via CDP `Performance.getMetrics` (`JSHeapUsedSize`) and `<vortexmd-engine>.getPerformanceMetrics()`.

## 3. Public Benchmark Datasets

All external trajectory datasets used in these benchmarks are publicly available from open repositories:

| Benchmark ID | System | Repository / Persistent Identifier |
| :--- | :--- | :--- |
| **16pk_A** | Phosphoglycerate kinase (`16pk_A`) | [ATLAS Database of Biomolecular Simulations](https://www.dsimb.inserm.fr/ATLAS/database/ATLAS/16pk_A/16pk_A.html) |
| **traj_7nx6** | SARS-CoV-2 RBD–Fab (7NX6) | Zenodo, DOI: `10.5281/zenodo.5111905` |
| **md_rep1_noPBC_em1** | Chalcone Protein–Drug Complex | Zenodo, DOI: `10.5281/zenodo.21475591` |
| **PE_CL_530Run** | PE/CL Lipid Bilayer | Zenodo, DOI: `10.5281/zenodo.13984201` |
