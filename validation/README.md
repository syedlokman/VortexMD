# Numerical Validation Against MDAnalysis

> Reproducible notebooks and CSV outputs comparing VortexMD's pure-JavaScript analytical engine against **MDAnalysis v2.11.0**.

## Contents

| Subfolder | Notebook | CSV Outputs |
| :--- | :--- | :--- |
| [**`rmsd/`**](rmsd/) | [`VortexMD_vs_MDAnalysis_RMSD_Validation.ipynb`](rmsd/VortexMD_vs_MDAnalysis_RMSD_Validation.ipynb) | `rmsd_gap_summary.csv`, `rmsd_frame_by_frame_16pk_A.csv`, `rmsd_frame_by_frame_demo.csv` |
| [**`measurements/`**](measurements/) | [`VortexMD_vs_MDAnalysis_Measurement_Validation.ipynb`](measurements/VortexMD_vs_MDAnalysis_Measurement_Validation.ipynb) | `measurement_accuracy_summary.csv`, `measurements_timestamps_16pk_A.csv`, `measurements_all_frames_16pk_A.csv`, `measurements_all_frames_demo.csv` |

Both notebooks are saved with all cells executed and plots rendered inline so reviewers can inspect every calculation directly on GitHub without running any code.

## Validation Summary (`16pk_A`, 6,378 atoms, 1,001 frames, 100 ns)

| Metric | VortexMD | MDAnalysis v2.11.0 | Max $|\Delta|$ | Correlation ($r$) |
| :--- | :--- | :--- | :--- | :--- |
| **XTC Coordinates** | `headless-xtc.js` | `xdrfile` | $7.63 \times 10^{-6}\text{ Å}$ | $1.000000000$ |
| **RMSD (Backbone / Heavy)** | `hornSuperpose` | Theobald QCP | $\le 5.00 \times 10^{-4}\text{ Å}$ | $1.000000000$ |
| **3D Distances** | `calcDistance` | `calc_bonds` | $\le 1.00 \times 10^{-5}\text{ Å}$ | $1.000000000$ |
| **3D Angles** | `calcAngle` | `calc_angles` | $\le 7.18 \times 10^{-4}\text{°}$ | $1.000000000$ |
| **3D Dihedrals** | `calcDihedral` | `calc_dihedrals` | $\le 6.47 \times 10^{-4}\text{°}$ | $1.000000000$ (exact sign parity) |

## Re-Running the Notebooks

1. Download `16pk_A.pdb` and `16pk_A.xtc` from the [ATLAS Database (`16pk_A`)](https://www.dsimb.inserm.fr/ATLAS/database/ATLAS/16pk_A/16pk_A.html); the 100-frame `demo.xtc` is already bundled in `public/demo/demo.xtc`.
2. Point the notebook paths to your local copy of `16pk_A.pdb`, `16pk_A.xtc`, `public/demo/demo.xtc`, and the VortexMD engine modules in `src/engine/` (`indexer.js`, `headless-xtc.js`, `analytics.js`, `measurement.js`).
3. Run all cells in Google Colab or Jupyter with Python 3.10+, `MDAnalysis`, `numpy`, `pandas`, `matplotlib`, and Node.js 20+.
