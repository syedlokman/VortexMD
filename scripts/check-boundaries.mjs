#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const METRICS = [
  'ui-internal',
  'ui-write',
  'ui-imports-engine',
  'panel-imports-panel',
  'ui-raw-listener',
  'shim',
  'engine-dom',
  'engine-imports-ui',
  'event-literal',
  'globals',
];

const NATIVE_EVENTS = new Set([
  'click', 'input', 'change', 'keydown', 'keyup', 'keypress',
  'wheel', 'drop', 'resize', 'message', 'error', 'close', 'focus', 'blur',
  'fullscreenchange', 'transitionend', 'animationend', 'contextmenu', 'dblclick',
  'mouseleave', 'mouseenter', 'mouseout', 'mouseover', 'unhandledrejection',
  'DOMContentLoaded', 'webglcontextlost', 'webglcontextrestored', 'load', 'loadeddata'
]);

function isNativeEvent(name) {
  if (NATIVE_EVENTS.has(name)) return true;
  if (name.startsWith('pointer')) return true;
  if (name.startsWith('drag')) return true;
  return false;
}

function walk(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      files.push(full.replace(/\\/g, '/'));
    }
  }
  return files;
}

async function getPublicApi() {
  const publicApi = new Set();
  const apiFile = path.resolve('src/contracts/engine-api.js');
  if (fs.existsSync(apiFile)) {
    try {
      const mod = await import(pathToFileURL(apiFile).href);
      if (Array.isArray(mod.PUBLIC_API)) {
        for (const item of mod.PUBLIC_API) publicApi.add(item);
      }
    } catch {
      // Contract file not ready or invalid
    }
  }
  return publicApi;
}

async function analyze() {
  const publicApi = await getPublicApi();
  const files = walk('src').sort();
  const fileCounts = {};
  const totals = Object.fromEntries(METRICS.map(m => [m, 0]));

  for (const file of files) {
    const isUi = file.startsWith('src/ui/');
    const isPanel = file.startsWith('src/ui/panels/');
    const isEventsContract = file === 'src/contracts/events.js';
    const content = fs.readFileSync(file, 'utf8');

    const counts = Object.fromEntries(METRICS.map(m => [m, 0]));

    if (isUi) {
      // ui-internal: in src/ui/**, any (?<![\w$.])(player|engine)(\.|\?\.)(\w+) or (?<![\w$.])(player|engine)\['\w+'\]
      const uiInternalRegex = /(?<![\w$.])(?:player|engine)(?:\.|\?\.)(\w+)|(?<![\w$.])(?:player|engine)\[['"](\w+)['"]\]/g;
      let m;
      while ((m = uiInternalRegex.exec(content)) !== null) {
        const prop = m[1] || m[2];
        if (!publicApi.has(prop)) {
          counts['ui-internal']++;
        }
      }

      // Special check: drawer.js must not call document.getElementById('player')
      if (file === 'src/ui/panels/drawer.js' && /document\.getElementById\s*\(\s*['"]player['"]\s*\)/.test(content)) {
        counts['ui-internal']++;
      }

      // ui-write: in src/ui/**, any (?<![\w$.])(player|engine)\.[\w$.]+\s*=(?!=)
      const uiWriteRegex = /(?<![\w$.])(?:player|engine)\.[\w$.]+\s*=(?!=)/g;
      const writeMatches = content.match(uiWriteRegex);
      if (writeMatches) {
        counts['ui-write'] += writeMatches.length;
      }

      // ui-imports-engine: in src/ui/**, any import path containing /engine/ or starting with engine/
      const uiImportsEngineRegex = /(?:(?:import|export)\s+.*?from\s+|import\s*\(?)\s*["'][^"']*(?:^|\/)engine\/[^"']*["']/g;
      const uiEngineMatches = content.match(uiImportsEngineRegex);
      if (uiEngineMatches) {
        counts['ui-imports-engine'] += uiEngineMatches.length;
      }

      // panel-imports-panel: in src/ui/panels/**, no panel may import another panel
      if (isPanel) {
        const panelImportRegex = /(?:(?:import|export)\s+.*?from\s+|import\s*\(?)\s*["'](?:\.\/[^"']+|[^"']*\/panels\/[^"']+)["']/g;
        const panelMatches = content.match(panelImportRegex);
        if (panelMatches) {
          counts['panel-imports-panel'] += panelMatches.length;
        }
      }

      // ui-raw-listener: .addEventListener( forbidden in src/ui/** except shell/boundary.js, shell/toast.js, and DOMContentLoaded in app.js
      if (file !== 'src/ui/shell/boundary.js' && file !== 'src/ui/shell/toast.js') {
        const rawListenerRegex = /\.addEventListener\s*\(/g;
        let mListener;
        while ((mListener = rawListenerRegex.exec(content)) !== null) {
          if (file === 'src/ui/app.js') {
            const surrounding = content.slice(Math.max(0, mListener.index - 50), mListener.index + 80);
            if (surrounding.includes('DOMContentLoaded')) {
              continue;
            }
          }
          counts['ui-raw-listener']++;
        }
      }
    } else {
      // engine-dom: outside src/ui/**
      const engineDomRegex = /document\.getElementById|document\.querySelector|getUiElement(?:\?\.)?\s*\(|window\.dispatchEvent|(?:shadowRoot|shadow)(?:\?\.)?\.?getElementById(?:\?\.)?\s*\(\s*(?!["'`]viewport["'`]\s*\))/g;
      const domMatches = content.match(engineDomRegex);
      if (domMatches) {
        counts['engine-dom'] += domMatches.length;
      }

      // engine-imports-ui: outside src/ui/**, any import path containing /ui/
      const importUiRegex = /(?:(?:import|export)\s+.*?from\s+|import\s*\(?)\s*["'][^"']*\/ui\/[^"']*["']/g;
      const importMatches = content.match(importUiRegex);
      if (importMatches) {
        counts['engine-imports-ui'] += importMatches.length;
      }
    }

    // shim: forbid export * from and comments matching /legacy|backward.?compat|for (existing )?tests/i in src/
    const exportAllRegex = /export\s+\*\s+from/g;
    const exportAllMatches = content.match(exportAllRegex);
    if (exportAllMatches) {
      counts['shim'] += exportAllMatches.length;
    }

    const commentRegex = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
    let commentMatch;
    const shimCommentRegex = /legacy|backward.?compat|for (?:existing )?tests/i;
    while ((commentMatch = commentRegex.exec(content)) !== null) {
      if (shimCommentRegex.test(commentMatch[0])) {
        counts['shim']++;
      }
    }

    // event-literal: anywhere except src/contracts/events.js
    if (!isEventsContract) {
      const eventRegex = /(?:new\s+CustomEvent|addEventListener)\s*\(\s*["'`]([^"'`]+)["'`]/g;
      let m;
      while ((m = eventRegex.exec(content)) !== null) {
        if (!isNativeEvent(m[1])) {
          counts['event-literal']++;
        }
      }
    }

    // globals: window.lucide, window.vortexmd, window.NGL
    const globalsRegex = /window\.(?:lucide|vortexmd|NGL)/g;
    const globalMatches = content.match(globalsRegex);
    if (globalMatches) {
      counts['globals'] += globalMatches.length;
    }

    fileCounts[file] = counts;
    for (const m of METRICS) {
      totals[m] += counts[m];
    }
  }

  return { files: fileCounts, totals };
}

async function main() {
  const current = await analyze();
  let totalViolations = 0;

  for (const [file, counts] of Object.entries(current.files)) {
    for (const metric of METRICS) {
      const c = counts[metric] || 0;
      if (c > 0) {
        console.error(`VIOLATION: ${file} ${metric} has count ${c}`);
        totalViolations += c;
      }
    }
  }

  if (totalViolations > 0) {
    console.error(`\nBoundary check failed: ${totalViolations} violation(s) found across rules.`);
    process.exit(1);
  }

  console.log('Boundary check passed: zero violations across all rules.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
