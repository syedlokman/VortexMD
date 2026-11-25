# VortexMD Architecture & Component Boundaries

> Single source of truth for module boundaries, communication contracts, and the `<vortexmd-engine>` Web Component.
> VortexMD is a zero-backend Progressive Web App (PWA) whose core engine is encapsulated inside the standalone `<vortexmd-engine>` custom element.

## 1. Three-Layer Architecture

Dependencies point inward only. Presentation panels talk to the engine strictly through `PUBLIC_API` and `EVENTS`; the engine never touches light-DOM elements or imports UI code.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           src/contracts/                                │
│         Zero-import frozen contracts (Single Source of Truth)           │
│     events.js (EVENTS) · engine-api.js (PUBLIC_API) · display/session   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌───────────────────────────────────────┐   ┌───────────────────────────────────┐
│              src/ui/                  │   │            src/engine/            │
│  Web-App Shell & Isolated Panels      │   │   <vortexmd-engine> Shadow Core   │
│  • app.js (composition root)          │   │   • vortexmd.js (host element)    │
│  • panels/* (loader, rmsd, tree, ...) │──▶│   • trajectory, indexer, workers  │
│  • shell/* (boundary, icons, toast)   │API│   • playback, rmsd, measurement   │
│  • Subscribes via listen(engine, ...) │◀──│   • Emits EVENTS on host element  │
└───────────────────────────────────────┘   └───────────────────────────────────┘
                    ▲                                   ▲
                    │        ┌──────────────────┐       │
                    └────────│   src/shared/    │───────┘
                             │ logger, download │
                             │ guard            │
                             └──────────────────┘
```

| Layer | Path | Responsibility |
| :--- | :--- | :--- |
| **Contracts** | `src/contracts/` | Frozen `EVENTS`, `PUBLIC_API`, display palettes (`display.js`), and session schema (`session.js`). Zero imports. |
| **Engine** | `src/engine/` | Headless-capable `<vortexmd-engine>` custom element (Shadow DOM `#viewport`), WebGL rendering, Web Workers, ring buffer, RMSD, and measurements. |
| **UI** | `src/ui/` | Composition root (`app.js`), fault-isolated panels (`panels/*`), and shell helpers (`shell/*`). |
| **Shared** | `src/shared/` | Stateless utilities (`logger.js`, `download.js`, `guard.js`) usable by both engine and UI. |

### NGL Viewer (v2.4.0) Integration Scope

VortexMD builds on **NGL Viewer v2.4.0** for WebGL rendering (`NGL.Stage`, molecular shaders, `NGL.Matrix4` camera, `stage.makeImage`), static topology parsing, `NGL.Selection` query resolution, `NGL.CallbackTrajectory` coordinate hooks, and 3D measurement visual overlays. All out-of-core `.xtc` binary indexing, IndexedDB caching, adaptive ring buffering, Web Worker execution (with `headless-xtc.js` adapted from GROMACS `xdrfile.c` and NGL `XtcParser`), Horn quaternion RMSD, 64-bit measurement math, zero-cloud sessions, and PWA delivery are implemented in VortexMD.

## 2. Communication Rules

| Direction | Allowed | Forbidden |
| :--- | :--- | :--- |
| **Panel → Engine** | Methods and getters listed in `PUBLIC_API`. | Unlisted members, private fields (`_field`), direct property writes (`player.x = y`), reaching into `player.comp` / `player.stage`. |
| **Engine → Panel** | `this.emit(EVENTS.KEY, detail)` with plain-data payloads on `<vortexmd-engine>`. | Light-DOM queries (`document.getElementById`), importing `src/ui/`, dispatching on `window`. |
| **Panel → Panel** | Coordination through engine state and `EVENTS`. | Direct imports between panel modules or sibling DOM coupling. |
| **Engine Internals** | Structured imports within `src/engine/`; state owned by `vortexmd.js`. | Submodules mutating arbitrary fields on `this.engine`. |

## 3. Extension Playbooks

### Add a UI Panel
1. Create `src/ui/panels/my-panel.js` using the injected `listen` helper (raw `addEventListener` is banned in panels):
   ```javascript
   import { EVENTS } from '../../contracts/events.js';

   export function initMyPanel({ engine, listen }) {
       const btn = document.getElementById('btn-my-action');

       listen(engine, EVENTS.TOPOLOGY_LOADED, (e) => {
           // Handle plain-data payload e.detail
       });

       if (btn) {
           listen(btn, 'click', () => engine.somePublicMethod());
       }
   }
   ```
2. Mount it in `src/ui/app.js` with `mountPanel('MyPanel', initMyPanel, player)`.

### Add an Event or API Method
- **New Event**: Add a frozen key and JSDoc payload typedef to `src/contracts/events.js`, emit via `this.emit(EVENTS.MY_EVENT, payload)` in `src/engine/`, and subscribe via `listen(engine, EVENTS.MY_EVENT, handler)` in the panel.
- **New API Method**: Register the name in `PUBLIC_API` (`src/contracts/engine-api.js`) and implement it on `<vortexmd-engine>` in `src/engine/vortexmd.js`.

## 4. Automated Boundary Enforcement (10 Rules)

Verified on every build and CI run via `npm run check:boundaries` (`scripts/check-boundaries.mjs`, zero violations allowed):

| Rule | Enforces |
| :--- | :--- |
| `ui-internal` | UI accesses only members listed in `PUBLIC_API` (and `drawer.js` never queries `#player`). |
| `ui-write` | UI never mutates engine properties (`player.x = y`). |
| `ui-imports-engine` | UI never imports from `src/engine/`. |
| `panel-imports-panel` | Panels never import sibling panels. |
| `ui-raw-listener` | UI uses `listen()` instead of raw `.addEventListener()` (except `boundary.js`, `toast.js`, and `DOMContentLoaded` in `app.js`). |
| `shim` | No `export * from` or legacy/backward-compatibility shim comments in `src/`. |
| `engine-dom` | Engine never queries light-DOM elements or dispatches on `window`. |
| `engine-imports-ui` | Engine never imports from `src/ui/`. |
| `event-literal` | No raw custom-event string literals outside `src/contracts/events.js`. |
| `globals` | No references to `window.lucide`, `window.vortexmd`, or `window.NGL`. |

## 5. Embedding & Global Capture Opt-Out

When embedding `<vortexmd-engine>` inside another host app:
- Set `globalThis.VORTEXMD_NO_GLOBAL_CAPTURE = true` before importing to disable global `console.error`/`console.warn` and `window` error hooks.
- Or call `logger.releaseGlobals()` at runtime to restore host console and window handlers.
- Under strict Content Security Policies, permit `worker-src 'self' blob:` so inlined Web Workers can initialize.
