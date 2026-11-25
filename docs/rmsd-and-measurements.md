# RMSD & 3D Geometric Measurements

> Concise guide to VortexMD's in-browser structural analysis engine (`src/engine/analytics.js`, `src/engine/rmsd.js`, `src/engine/measurement.js`).

## 1. Closed-Form RMSD Alignment

VortexMD computes rigid-body RMSD against **Frame 0** using **Horn's closed-form unit-quaternion method** (cyclic Jacobi eigen-decomposition of the $4 \times 4$ symmetric Davenport key matrix) inside Web Workers.

### Workflow
1. Open the right drawer → **RMSD** tab.
2. Specify a **Fit Group** (atoms used to compute optimal rotation/translation, default `protein and .CA`) and a **Calc Group** (atoms evaluated for RMSD; toggle *Same as fit* or enter a separate NGL query such as a ligand or binding pocket).
3. Choose **Stride**: `auto` caps output at $\le 2,500$ evenly spaced points for large trajectories, or enter any positive integer stride (`1` = every frame).
4. Click **Compute** (processes in worker batches of 25 frames, up to 2 concurrent batches; cancellable mid-run).

### Interactive Plot & Export
- **Click** any point on the RMSD chart to jump directly to that trajectory frame.
- **Scroll wheel** zooms the plot; **double-click** or **Reset** restores the full timeline.
- Multiple runs are retained in the session selector for side-by-side comparison and can be exported as **CSV**.

---

## 2. 3D Interatomic Measurements

Track dynamic geometry in 64-bit floating-point precision across playback and Catmull-Rom spline interpolation:

| Type | Atoms Required | Output |
| :--- | :--- | :--- |
| **Distance** | 2 atoms ($A, B$) | Euclidean distance in **Å** |
| **Angle** | 3 atoms ($A, B, C$) | Planar valence angle $\angle ABC$ in **degrees** ($0°$–$180°$) |
| **Dihedral** | 4 atoms ($A, B, C, D$) | Signed IUPAC torsion angle in **degrees** ($-180°$ to $+180°$) |

### Workflow
1. Open the right drawer → **Measurements** tab and pick **Distance**, **Angle**, or **Dihedral**.
2. Select atoms either by **Click-to-Pick** directly in the 3D viewport (`Esc`, switching tabs, or closing the drawer cancels picking) or by entering atom indices manually.
3. Active measurements render as 3D overlays and update live in the table on every frame.
4. Per-row controls let you **focus**, **toggle visibility**, or **delete** individual measurements; export the full table to **CSV** or **JSON**.

---

## 3. Numerical Validation vs. MDAnalysis

Validated head-to-head against **MDAnalysis v2.11.0** on `16pk_A.pdb` + `16pk_A.xtc` ([ATLAS Database: `16pk_A`](https://www.dsimb.inserm.fr/ATLAS/database/ATLAS/16pk_A/16pk_A.html); 6,378 atoms, 1,001 frames, 100 ns, $\Delta t = 100\text{ ps}$) and the bundled 100-frame `demo.xtc`:

| Metric | VortexMD Engine | MDAnalysis Reference | Max $|\Delta|$ | Correlation ($r$) |
| :--- | :--- | :--- | :--- | :--- |
| **XTC Coordinates** | `headless-xtc.js` | `xdrfile` | $7.63 \times 10^{-6}\text{ Å}$ | $1.000000000$ |
| **Backbone / Heavy RMSD** | `hornSuperpose` | Theobald QCP | $\le 5.00 \times 10^{-4}\text{ Å}$ | $1.000000000$ |
| **3D Distances** | `calcDistance` | `calc_bonds` | $\le 1.00 \times 10^{-5}\text{ Å}$ | $1.000000000$ |
| **3D Angles** | `calcAngle` | `calc_angles` | $\le 7.18 \times 10^{-4}\text{°}$ | $1.000000000$ |
| **3D Dihedrals** | `calcDihedral` | `calc_dihedrals` | $\le 6.47 \times 10^{-4}\text{°}$ | $1.000000000$ (exact sign parity) |

All residual differences sit at single-precision `Float32` / XTC lossy-compression rounding levels, with zero mismatches at UI display precision. Full executed notebooks, logs, and frame-by-frame CSVs are archived in [`validation/`](../validation/README.md).
