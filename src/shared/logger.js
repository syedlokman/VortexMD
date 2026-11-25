// src/logger.js
// Single Task: Centralized Performance Telemetry & Comprehensive System Log Store

function formatLogArg(arg) {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') {
        return arg.length > 500 ? arg.slice(0, 500) + '…' : arg;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') {
        return String(arg);
    }
    if (typeof arg === 'bigint') {
        return `${arg}n`;
    }
    if (typeof arg === 'symbol') {
        return arg.toString();
    }
    if (arg instanceof Error) {
        const text = arg.stack || arg.message || String(arg);
        return text.length > 500 ? text.slice(0, 500) + '…' : text;
    }
    if (typeof arg === 'object') {
        try {
            const seen = new WeakSet();
            const json = JSON.stringify(arg, (key, value) => {
                if (typeof value === 'bigint') return `${value}n`;
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return '[Circular]';
                    seen.add(value);
                }
                return value;
            });
            return json.length > 500 ? json.slice(0, 500) + '…' : json;
        } catch {
            const str = Object.prototype.toString.call(arg);
            return str.length > 500 ? str.slice(0, 500) + '…' : str;
        }
    }
    return String(arg);
}

class SystemLogger {
    constructor() {
        this.logs = [];
        this.listeners = new Set();
        this._origError = null;
        this._origWarn = null;
        this._errorHandler = null;
        this._rejectionHandler = null;
        this._isCapturingConsole = false;

        const skipGlobal = typeof globalThis !== 'undefined' && globalThis.VORTEXMD_NO_GLOBAL_CAPTURE === true;
        if (!skipGlobal) {
            this.initAutoCapture();
        }
    }

    initAutoCapture() {
        // Log System Startup Context
        const platform = (typeof navigator !== 'undefined' && navigator.platform) ? navigator.platform : 'Node/Test';
        this.log('info', 'SYSTEM', `VortexMD Engine Initialized | Platform: ${platform}`);

        // Capture Uncaught Errors
        if (typeof window !== 'undefined') {
            if (!this._errorHandler) {
                this._errorHandler = (event) => {
                    this.log('error', 'UNCAUGHT_ERR', `${event.message} at ${event.filename}:${event.lineno}`);
                };
                window.addEventListener('error', this._errorHandler);
            }

            if (!this._rejectionHandler) {
                this._rejectionHandler = (event) => {
                    const reason = event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled Promise Rejection';
                    this.log('error', 'UNCAUGHT_PROMISE', reason);
                };
                window.addEventListener('unhandledrejection', this._rejectionHandler);
            }
        }

        // Safe Intercept for console.error and console.warn
        if (!console.error?.__vortexmd_patched) {
            const origError = console.error;
            this._origError = origError;
            const patchedError = (...args) => {
                origError.apply(console, args);
                if (this._isCapturingConsole) return;
                this._isCapturingConsole = true;
                try {
                    const msg = args.map(formatLogArg).join(' ');
                    this.log('error', 'CONSOLE', msg);
                } catch {
                    // Safe guard: logging must never throw into caller
                } finally {
                    this._isCapturingConsole = false;
                }
            };
            patchedError.__vortexmd_patched = true;
            console.error = patchedError;
        }

        if (!console.warn?.__vortexmd_patched) {
            const origWarn = console.warn;
            this._origWarn = origWarn;
            const patchedWarn = (...args) => {
                origWarn.apply(console, args);
                if (this._isCapturingConsole) return;
                this._isCapturingConsole = true;
                try {
                    const msg = args.map(formatLogArg).join(' ');
                    this.log('warn', 'CONSOLE', msg);
                } catch {
                    // Safe guard: logging must never throw into caller
                } finally {
                    this._isCapturingConsole = false;
                }
            };
            patchedWarn.__vortexmd_patched = true;
            console.warn = patchedWarn;
        }
    }

    releaseGlobals() {
        if (this._origError && console.error?.__vortexmd_patched) {
            console.error = this._origError;
            this._origError = null;
        }
        if (this._origWarn && console.warn?.__vortexmd_patched) {
            console.warn = this._origWarn;
            this._origWarn = null;
        }
        if (typeof window !== 'undefined') {
            if (this._errorHandler) {
                window.removeEventListener('error', this._errorHandler);
                this._errorHandler = null;
            }
            if (this._rejectionHandler) {
                window.removeEventListener('unhandledrejection', this._rejectionHandler);
                this._rejectionHandler = null;
            }
        }
    }

    log(level, category, message, data = null) {
        const entry = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toLocaleTimeString(),
            level, // 'info' | 'perf' | 'warn' | 'error'
            category, // 'SYSTEM' | 'ENGINE' | 'INDEXER' | 'PARSER' | 'NETWORK' | 'TOPOLOGY' | 'TRAJECTORY' | 'PLAYER' | 'CONSOLE'
            message,
            data
        };

        this.logs.unshift(entry);
        if (this.logs.length > 1000) this.logs.pop();

        this.notify();
    }

    isDebugEnabled() {
        if (typeof window === 'undefined') return false;
        if (window.VORTEX_DEBUG === true) return true;
        try {
            const params = new URLSearchParams(window.location.search);
            return params.has('debug') && params.get('debug') !== 'false';
        } catch {
            return false;
        }
    }

    debug(category, message, data = null) {
        if (this.isDebugEnabled()) {
            this.log('debug', category, message, data);
            console.log(`[DEBUG][${category}] ${message}`, data !== null ? data : '');
        }
    }

    recordParseMetric(engine, parseTimeMs, frameCount) {
        this.log('perf', 'PARSER', `Parsed ${frameCount} frames using Polyfill+NGL in ${parseTimeMs.toFixed(2)}ms`);
    }

    subscribe(callback) {
        this.listeners.add(callback);
        callback(this.logs);
        return () => this.listeners.delete(callback);
    }

    notify() {
        this.listeners.forEach(cb => cb(this.logs));
    }

    clear() {
        this.logs = [];
        this.log('info', 'SYSTEM', 'Logs cleared by user');
        this.notify();
    }
}

export const logger = new SystemLogger();
