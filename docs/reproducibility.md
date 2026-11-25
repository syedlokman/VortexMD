# Reproducibility: Benchmarks & Validation Guide

> Step-by-step instructions to reproduce VortexMD's multi-system runtime benchmarks, live browser head-to-head comparisons, and MDAnalysis numerical validation.

## 1. Automated Multi-System CDP Benchmark

`scripts/run-benchmark-offline.mjs` launches isolated Playwright Chromium contexts against the built `./dist` app (no open server ports required) and records CDP `JSHeapUsedSize`, progressive TTFF, and FPS, then exports CSV/JSON reports and 300 DPI `.svg`/`.png` figures.

### Setup
1. Install dependencies and build the production app:
   ```bash
   npm install
   npx playwright install chromium
   npm run build
   ```
2. Download any of the four public benchmark datasets (see [Benchmark Datasets](../README.md#benchmark-datasets)) into a folder (default `../benchmarks_multi_system/`) with matching topology/trajectory basenames:
   ```text
   benchmarks_multi_system/
   ├── 16pk_A.pdb                  + 16pk_A.xtc
   ├── traj_7nx6.gro               + traj_7nx6.xtc
   ├── md_rep1_noPBC_em1.gro       + md_rep1_noPBC_em1.xtc
   └── PE_CL_530Run.gro            + PE_CL_530Run.xtc
   ```

### Run
```bash
node scripts/run-benchmark-offline.mjs [durationSec] [benchmarkDir] [outputDir] [sampleIntervalSec]

# Example (60 s playback per system, sampled every 5 s):
node scripts/run-benchmark-offline.mjs 60 ../benchmarks_multi_system ./docs/benchmarks 5
```

Outputs are written to `docs/benchmarks/` (`benchmark-multi-system-{raw.json,summary.csv,timeseries.csv,report.md}` and `fig_{memory_scaling,performance_matrix}.{svg,png}`).

## 2. Live Browser Console Benchmark (Head-to-Head)

Use `scripts/console-head-to-head-benchmark.js` to compare **VortexMD** (`https://vortexmd.aarc.bio`), **Mol\***, and **Native NGL** directly in Chrome or Brave:

1. *(Optional, for unrounded JS heap)* Launch Chrome or Brave with `--enable-precise-memory-info`:
   ```bash
   open -a "Google Chrome" --args --enable-precise-memory-info
   ```
2. Open one viewer in a fresh tab, open DevTools Console (`Cmd+Option+J` / `Ctrl+Shift+J`), and load your topology file first.
3. Paste the full contents of `scripts/console-head-to-head-benchmark.js` into the Console and press **Enter** (if prompted, type `allow pasting` first).
4. Load the `.xtc` trajectory file:
   - On **VortexMD**, TTFF and full indexing are captured automatically.
   - On **Mol\*** or **Native NGL**, run `__vortexBench.markFullParseComplete()` once the trajectory finishes loading.
5. Play the trajectory for ~60 s, then collect results:
   ```javascript
   __vortexBench.report()    // Prints summary table + Markdown row
   __vortexBench.download()  // Saves raw JSON telemetry
   __vortexBench.stop()      // Stops sampling
   ```

## 3. MDAnalysis Numerical Validation

Fully executed Colab/Jupyter notebooks and frame-by-frame CSVs validating XTC coordinate parity, Horn quaternion RMSD, and 3D distances/angles/dihedrals against **MDAnalysis v2.11.0** are archived in [`validation/`](../validation/README.md). Follow the three-step instructions in [validation/README.md](../validation/README.md) to inspect outputs directly or re-run all cells locally/in Colab.
