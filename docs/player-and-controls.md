# Player, Controls & Workspace Guide

> Quick user reference for the VortexMD web application. For frozen v1.0 layout/DOM specs, see [UI/UX Specification](ui-ux.md).

## 1. Loading Structures & Trajectories

- **Topology**: Drop or select a `.pdb`, `.gro`, `.cif`, `.mmtf`, `.mol2`, `.sdf`, `.prmtop`, `.psf`, or `.top` file in the left sidebar (or directly onto the 3D viewport).
- **Trajectory**: Load a matching `.xtc` file once a topology is active. Playback unlocks as soon as initial frames are indexed.
- **Sample Files**: Click **Load Sample Files** to quick-load the bundled demo trajectory (`demo.pdb` + `demo.xtc`) or download larger benchmark datasets.

## 2. Playback Bar & Timeline

| Control | Behavior |
| :--- | :--- |
| **Play / Pause** (`Space`) | Toggles playback (30 FPS base clock). Disabled if a molecular `Surface` representation is active (switch to `Spacefill` for real-time volume playback). |
| **Scrubber & Frame Input** | Drag to seek or type an exact 1-based frame number. While indexing, seeking clamps to the latest indexed frame. |
| **Speed & Step** | Speed multiplier from **0.25× to 5×**; frame step **1, 2, 5, or 10**. |
| **Playback Direction** | **Forward**, **Reverse**, or **Bounce** (ping-pong; automatically enables looping and restores your prior loop setting when switched off). |
| **Looping & A/B Intervals** | Toggle **Off / All**, or set **A** and **B** bounds on the scrubber to loop a specific conformational window. |
| **Timeline Pins** | Bookmark key frames with text notes. Pins appear as amber diamonds on the scrubber (hover to preview, click to jump). |
| **Spline & Time Calibration** | In **Components → Environment**, toggle Catmull-Rom spline interpolation for smooth 60 FPS sub-frame motion and adjust $\Delta t$ / $t_0$ if needed. |
| **Viewport Quick Actions** | **Spin**, **Rock**, **Center**, and **Slice** (interactive near/far depth clipping). |

## 3. Keyboard Shortcuts & Mouse Presets

| Input | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `F` | Toggle Fullscreen |
| `←` / `→` | Step to previous / next frame |
| `Esc` | Cancel atom-pick mode, or close the right drawer |
| **Double-click atom** | Center camera on that atom (double-click empty space to auto-view) |

Switch mouse navigation schemes in the player bar (**Mouse** pill):
- **WebGL**: Left = rotate, Right / `Shift`+Left = pan, Wheel / Middle = zoom.
- **PyMOL**: Left = rotate, Middle = pan, Right = zoom.
- **Coot**: Middle = rotate, Left = pan, Right = zoom.

## 4. Molecular Tree & Custom Selections

Open the right drawer → **Components** tab:
- Structures auto-group into **Proteins, RNA, DNA, Ligands, Lipids, Glycans, Ions, and Water** (empty categories are hidden).
- Toggle visibility, color, or representation style (`Cartoon`, `Licorice`, `Ball+Stick`, `Spacefill`, `Surface`, etc.) per chain, ligand, or group, or use **Hide Solvent/Ions** / **Show All**.
- Add **Custom Selections** using standard NGL grammar (e.g., `:A and 10-50`, `.CA`, `[ATP]`) with live atom-match counts, custom opacity, and optional bounding-box overlays.

## 5. Media Export, Sessions & Offline PWA

- **Image Export** (Player bar → **Export**): Save publication stills at **300 DPI** or **4K** with an opaque background (White or Black via the **BG** pill) and **Perspective** or **Orthographic** camera.
- **Video Export**: Record the full trajectory or active A/B loop to **WebM / MP4** at fixed forward 1× speed (controls lock during recording and restore afterward).
- **Sessions** (Left sidebar → **Session**): Save or import portable `.json` files capturing camera state, representations, custom selections, measurements, pins, and cached frame offsets. Because browsers sandbox local file paths, importing a session prompts you to re-link the local topology (and optional trajectory) file via the **Re-Link** dialog.
- **Installable Offline App (PWA)**: VortexMD ships as a Progressive Web App (`display: standalone`) with automatic service-worker updates. Once visited, you can install it from your browser's address bar and analyze local topology/trajectory files completely offline without an internet connection.
