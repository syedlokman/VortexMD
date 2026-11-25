import { logger } from './logger.js';

const lastLog = new Map();

export function report(scope, err) {
  const now = performance.now();
  if (now - (lastLog.get(scope) || 0) < 5000) return; // no log storms at 60 fps
  lastLog.set(scope, now);
  logger.log('error', scope, err?.stack || String(err));
}

export function guard(scope, fn) {
  return function guarded(...args) {
    try { return fn.apply(this, args); } catch (err) { report(scope, err); }
  };
}
