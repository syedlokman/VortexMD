import { report } from '../../shared/guard.js';
import { showToast } from './toast.js';

const MAX_FAULTS = 5, WINDOW_MS = 10000;

export function mountPanel(name, init, engine) {
  const ctl = new AbortController();
  let faults = [];
  const fail = (err) => {
    report(`ui:${name}`, err);
    const now = performance.now();
    faults = faults.filter(t => now - t < WINDOW_MS); faults.push(now);
    if (faults.length >= MAX_FAULTS && !ctl.signal.aborted) {
      ctl.abort();
      showToast(`${name} panel stopped after repeated errors. Other features still work.`, 'error');
    }
  };
  // Returns off(): needed for listeners that live shorter than the panel.
  const panelListen = (target, type, fn) => {
    const wrapped = (e) => { try { fn(e); } catch (err) { fail(err); } };
    target.addEventListener(type, wrapped, { signal: ctl.signal });
    return () => target.removeEventListener(type, wrapped);
  };
  try { init({ engine, listen: panelListen, signal: ctl.signal }); }
  catch (err) { fail(err); showToast(`${name} panel failed to load.`, 'error'); }
  return () => ctl.abort();
}
