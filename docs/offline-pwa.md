# Installing & Using VortexMD Offline (PWA)

> VortexMD is a Progressive Web App (PWA) that can be installed like a native desktop or mobile app and used 100% offline with local trajectory files.

## 1. Install as a Standalone App

Open **[https://vortexmd.aarc.bio](https://vortexmd.aarc.bio)** once while online so the browser caches the application shell:

* **Chrome / Brave / Edge (macOS, Windows, Linux):** Click the **Install** icon (monitor with a down arrow) at the right end of the address bar, or open the browser menu (`⋮`) → **Cast, save, and share → Install VortexMD**.
* **Safari (macOS Sonoma+):** Click **File → Add to Dock** to launch VortexMD in its own standalone window.
* **Safari (iOS / iPadOS):** Tap **Share → Add to Home Screen**.

## 2. What Works 100% Offline

Once installed (or visited once), disconnect from the internet and launch VortexMD normally:

* **Full Local Analysis:** Loading local topologies (`.pdb`, `.gro`, `.cif`, etc.) and multi-gigabyte `.xtc` trajectories, binary header indexing, ring-buffered WebGL playback, Horn quaternion RMSD, 3D interatomic measurements, image/video exports, and `.json` session save/re-link all run locally with zero network requests.
* **Instant Reloads:** Verified `.xtc` byte-offset tables remain cached in browser IndexedDB across offline restarts.
* **Bundled Demo Topology:** `demo.pdb` is precached by the service worker (`CacheFirst`, 30-day retention). Downloading external Zenodo benchmark datasets requires an active internet connection.

## 3. Updates & Troubleshooting

* **Automatic Updates:** VortexMD uses Workbox `autoUpdate`—whenever you launch the app online, any new release downloads in the background and activates on the next reload.
* **Resetting Offline Cache:** If an older cached build persists, open DevTools → **Application → Storage → Clear site data** (or reload while online) to refresh the service worker cleanly.
