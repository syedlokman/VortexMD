// src/worker-manager.js
// Single Task: Multi-Thread Worker Execution Pool, Direct Post-ID Routing & Hardware Concurrency Manager

/**
 * Single Worker Wrapper implementing Direct Post-ID Task Tracking.
 * Routes worker message replies directly to specific promise/callback handlers.
 */
export class _Worker {
    constructor(workerInstance) {
        this.worker = workerInstance;
        this.postId = 0;
        this.onmessageDict = {};
        this.listeners = new Set();

        if (this.worker) {
            this.worker.onmessage = (e) => this.handleMessage(e);
            this.worker.onerror = (err) => this.handleError(err);
        }
    }

    handleMessage(e) {
        const data = e.data || {};
        const pid = data.postId;

        if (pid !== undefined && this.onmessageDict[pid]) {
            const cb = this.onmessageDict[pid];
            // Do not delete callback if it's an intermediate progress report
            if (data.type !== 'progress') {
                delete this.onmessageDict[pid];
            }
            cb(null, data);
        }

        // Notify global event listeners
        this.listeners.forEach(fn => {
            try { fn(e); } catch (err) { console.error('Worker listener error:', err); }
        });
    }

    handleError(err) {
        const message = err?.message || err?.error?.message || (err?.filename ? `${err.message || 'Script error'} (${err.filename}:${err.lineno})` : 'WebWorker execution error');
        console.error('WebWorker execution error:', message, err);
        Object.keys(this.onmessageDict).forEach(pid => {
            const cb = this.onmessageDict[pid];
            delete this.onmessageDict[pid];
            if (cb) cb(err, null);
        });
    }

    /**
     * Posts a message with automatic Post-ID dictionary tracking.
     * @param {Object} payload 
     * @param {Array<Transferable>} [transferables=[]] 
     * @param {Function} [callback=null] 
     * @returns {Promise<any>|number}
     */
    post(payload, transferables = [], callback = null) {
        this.postId++;
        const currentPostId = this.postId;
        payload.postId = currentPostId;

        if (!this.worker) {
            const err = new Error('Worker instance not initialized');
            if (typeof callback === 'function') {
                callback(err, null);
                return currentPostId;
            }
            return Promise.reject(err);
        }

        if (typeof callback === 'function') {
            this.onmessageDict[currentPostId] = callback;
            this.worker.postMessage(payload, transferables);
            return currentPostId;
        }

        return new Promise((resolve, reject) => {
            this.onmessageDict[currentPostId] = (err, result) => {
                if (err) reject(err);
                else resolve(result);
            };
            this.worker.postMessage(payload, transferables);
        });
    }

    addEventListener(type, listener) {
        if (type === 'message') {
            this.listeners.add(listener);
        }
    }

    removeEventListener(type, listener) {
        if (type === 'message') {
            this.listeners.delete(listener);
        }
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        const termErr = new Error('Worker terminated');
        Object.keys(this.onmessageDict).forEach(pid => {
            const cb = this.onmessageDict[pid];
            delete this.onmessageDict[pid];
            if (typeof cb === 'function') {
                try { cb(termErr, null); } catch {}
            }
        });
        this.onmessageDict = {};
        this.listeners.clear();
    }
}

import InlineWorker from './worker.js?worker&inline';

/**
 * Multi-Thread Worker Execution Pool matching hardware CPU concurrency.
 */
export class WorkerPool {
    constructor(size = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4), onError = null) {
        this.maxCount = Math.max(1, size || 4);
        this.pool = [];
        this.currentIndex = 0;
        this.onError = onError;
        this.lastError = null;
    }

    initPool() {
        this.terminate();
        this.lastError = null;
        for (let i = 0; i < this.maxCount; i++) {
            let rawWorker = null;
            if (typeof Worker !== 'undefined') {
                try {
                    rawWorker = new InlineWorker();
                } catch (err) {
                    const isSecurity = err?.name === 'SecurityError' || /SecurityError|CSP|Content Security Policy/i.test(err?.message || '');
                    if (isSecurity) {
                        const cspMsg = 'WebWorker initialization failed (SecurityError). If using a strict Content Security Policy, ensure worker-src allows blob: or self.';
                        console.error(`[WorkerPool] ${cspMsg}`, err);
                        this.lastError = err;
                        if (typeof this.onError === 'function') {
                            this.onError(cspMsg, err);
                        }
                    } else {
                        console.warn(`[WorkerPool] Worker initialization failed for worker ${i}:`, err);
                    }
                }
            }
            if (rawWorker) {
                this.pool.push(new _Worker(rawWorker));
            }
        }
    }

    /**
     * Round-Robin Thread Allocation
     * @returns {_Worker|null}
     */
    getNextWorker() {
        if (this.pool.length === 0) {
            this.initPool();
        }
        if (this.pool.length === 0) {
            return null;
        }
        const worker = this.pool[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.pool.length;
        return worker;
    }

    /**
     * Post message using round-robin worker selection.
     */
    post(payload, transferables = [], callback = null) {
        const worker = this.getNextWorker();
        if (!worker) {
            const msg = this.lastError
                ? `No available WebWorker in execution pool: ${this.lastError.message || this.lastError}. Ensure worker-src allows 'blob:' in CSP.`
                : 'No available WebWorker in execution pool';
            const err = new Error(msg);
            if (typeof callback === 'function') {
                callback(err, null);
                return -1;
            }
            return Promise.reject(err);
        }
        return worker.post(payload, transferables, callback);
    }

    /**
     * Dispatch parallel tasks to all workers in the execution pool.
     */
    async postToAll(payloadGenerator) {
        const promises = this.pool.map((worker, index) => {
            const payload = payloadGenerator(index, worker);
            return worker.post(payload);
        });
        return Promise.all(promises);
    }

    terminate() {
        this.pool.forEach(w => w.terminate());
        this.pool = [];
        this.currentIndex = 0;
    }
}

/**
 * Facade managing WorkerPool lifecycle for VortexMD.
 */
export class WorkerManager {
    constructor(engineOrOnError = null) {
        const onError = typeof engineOrOnError === 'function'
            ? engineOrOnError
            : (engineOrOnError?.notify ? (msg) => engineOrOnError.notify('error', msg) : null);
        this.pool = new WorkerPool(undefined, onError);
    }

    getNextWorker() {
        return this.pool.getNextWorker();
    }

    getPoolSize() {
        return this.pool.pool.length;
    }

    postMessage(payload, transferables = [], callback = null) {
        return this.pool.post(payload, transferables, callback);
    }

    terminate() {
        if (this.pool) {
            this.pool.terminate();
        }
    }
}
