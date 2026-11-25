# VortexMD

> **Zero-backend, out-of-core molecular dynamics trajectory viewer and analyzer for the browser.**

**VortexMD** (*Virtual Out-of-core Ring-buffered Trajectory EXplorer for Molecular Dynamics*) is an open-source, client-side Progressive Web App (PWA) for visualizing and analyzing multi-gigabyte molecular dynamics (MD) trajectories directly in modern web browsers—with no server uploads, no cloud storage, and no local software installation required.

## Key Capabilities

- **Out-of-Core Streaming**: Header-only `.xtc` indexing, IndexedDB offset caching, and a demand-driven ring buffer (50–500 MB adaptive RAM cap) for multi-gigabyte trajectories alongside `.pdb`, `.gro`, `.cif`, `.mmtf`, `.mol2`, `.sdf`, `.prmtop`, `.psf`, and `.top` topologies.
- **Closed-Form RMSD Alignment**: Multi-threaded Horn unit-quaternion superposition with decoupled Fit/Calc groups, interactive zoom/seek plotting, and CSV export.
- **3D Interatomic Measurements**: Live 64-bit tracking of distances (Å), planar angles (°), and signed IUPAC dihedrals (°) via click-to-pick or atom indices, with CSV/JSON export.
- **Molecular Tree & NGL Selections**: Auto-grouped molecular hierarchy (Proteins, RNA, DNA, Ligands, Lipids, Glycans, Ions, Water) plus custom NGL queries (`:A and 10-50`, `.CA`, `[ATP]`) and bounding-box overlays.
- **Playback & Timeline Controls**: Forward, Reverse, and Bounce playback (0.25×–5×), 60 FPS Catmull-Rom spline interpolation, A/B interval looping, and annotated timeline pins.
- **Camera, Slicing & Publication Export**: WebGL, PyMOL, and Coot mouse presets, near/far depth slicing, 300 DPI / 4K opaque PNG stills, and WebM/MP4 video recording.
- **Zero-Cloud Sessions & Offline PWA**: Portable `.json` workspace files with sandbox file re-linking, plus standalone PWA installation for full offline analysis of local trajectories.

## Quick Start

Run the web application locally:

```bash
npm install
npm run dev        # Start local dev server (http://localhost:3000)
npm run build      # Build static production PWA in dist/
npm test           # Run Vitest test suite (136 tests)
npm run check:boundaries  # Verify architecture boundary rules
```

## Trajectory Pre-Processing Assumption

Like PyMOL and Mol*, VortexMD does not unwrap periodic boundary conditions (PBC) on the fly:

> VortexMD assumes that trajectories loaded into the viewer have been post-processed (e.g., using standard tools such as GROMACS `gmx trjconv` or MDAnalysis) to ensure PBC wrapping, center-of-mass centering, and frame continuity. Specifically, time and step metadata across concatenated or multi-segment trajectory runs are expected to be monotonically increasing and free of timestamp resets.

## Documentation

| Document | Summary |
| :--- | :--- |
| [**Player & Controls Guide**](docs/player-and-controls.md) | Playback, A/B looping, timeline pins, mouse presets, custom selections, media export, sessions, and offline PWA. |
| [**RMSD & 3D Measurements**](docs/rmsd-and-measurements.md) | Closed-form Horn quaternion RMSD, 3D distances/angles/dihedrals, and MDAnalysis v2.11.0 validation results. |
| [**Engine Workflow**](docs/engine-workflow.md) | Out-of-core `.xtc` streaming, binary indexing, IndexedDB caching, ring buffer, Web Workers, and PWA caching. |
| [**Software Architecture & Boundaries**](docs/ARCHITECTURE.md) | Three-tier decoupling, `PUBLIC_API` & `EVENTS` contracts, and automated boundary enforcement. |
| [**UI/UX Specification (v1.0 Frozen)**](docs/ui-ux.md) | Frozen v1.0 DOM layout, panel invariants, accessibility rules, and protected test hooks. |
| [**Empirical Runtime Benchmarks**](benchmark-results.md) | Multi-system Chrome DevTools Protocol (CDP) heap, latency, and frame-rate measurements (28 MB–5.37 GB). |
| [**Reproducibility Guide**](docs/reproducibility.md) | Step-by-step instructions for running CDP benchmarks, browser console telemetry, and MDAnalysis validation. |
| [**MDAnalysis Numerical Validation**](validation/README.md) | Executed validation notebooks and frame-by-frame CSVs for RMSD and 3D measurements. |

## Benchmark Datasets

All external trajectory datasets used in the empirical benchmarks and validation are publicly accessible from open repositories:

- **`16pk_A`**: [ATLAS Database of Biomolecular Simulations](https://www.dsimb.inserm.fr/ATLAS/database/ATLAS/16pk_A/16pk_A.html) (also used for MDAnalysis numerical validation and the bundled 100-frame demo).
- **Chalcone Protein–Drug Complex (`md_rep1_noPBC_em1`)**: Zenodo, DOI: `10.5281/zenodo.21475591`.
- **PE/CL Lipid Bilayer (`PE_CL_530Run`)**: Zenodo, DOI: `10.5281/zenodo.13984201`.
- **SARS-CoV-2 RBD–Fab (`traj_7nx6`)**: Zenodo, DOI: `10.5281/zenodo.5111905`.

## Citation

If you use VortexMD in your research, please cite this software (also available in [CITATION.cff](CITATION.cff)):

```bibtex
@software{vortexmd2026,
  author = {Lokman, Syed Mohammad},
  title = {VortexMD: Serverless Out-of-Core Molecular Dynamics Trajectory Engine with WebGL 3D Visualization},
  version = {1.0.0},
  year = {2026},
  url = {https://vortexmd.netlify.app}
}
```

## Acknowledgments

The author thanks **Professor Haseena Khan**, Director of the AUW Antimicrobial Research Center (AARC), Asian University for Women, Chittagong, Bangladesh, for her continuous support and encouragement.

## License

Licensed under the **GNU Affero General Public License v3.0 (GNU AGPLv3)** — see [LICENSE](LICENSE). Under AGPLv3 Section 5d, downstream forks and network-hosted instances must retain appropriate legal notices and visual attribution.
