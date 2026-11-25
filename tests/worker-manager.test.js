import { describe, it, expect, vi } from 'vitest';
import { _Worker, WorkerPool, WorkerManager } from '../src/engine/worker-manager.js';

class MockRawWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.postedMessages = [];
        this.terminated = false;
    }

    postMessage(data, transferables) {
        this.postedMessages.push({ data, transferables });
    }

    terminate() {
        this.terminated = true;
    }

    simulateReply(data) {
        if (typeof this.onmessage === 'function') {
            this.onmessage({ data });
        }
    }

    simulateError(err) {
        if (typeof this.onerror === 'function') {
            this.onerror(err);
        }
    }
}

describe('WorkerManager & WorkerPool Subsystem', () => {
    describe('_Worker Wrapper', () => {
        it('tracks post requests with sequential postIds and resolves Promise', async () => {
            const raw = new MockRawWorker();
            const worker = new _Worker(raw);

            const promise = worker.post({ type: 'ping' });
            expect(raw.postedMessages).toHaveLength(1);
            expect(raw.postedMessages[0].data.postId).toBe(1);
            expect(raw.postedMessages[0].data.type).toBe('ping');

            raw.simulateReply({ postId: 1, type: 'pong' });
            const result = await promise;
            expect(result).toEqual({ postId: 1, type: 'pong' });
        });

        it('supports callback style and retains callback on progress messages', () => {
            const raw = new MockRawWorker();
            const worker = new _Worker(raw);
            const callback = vi.fn();

            const pid = worker.post({ type: 'index' }, [], callback);
            expect(pid).toBe(1);

            // 1. Progress message should invoke callback but keep handler registered
            raw.simulateReply({ postId: 1, type: 'progress', percent: 50 });
            expect(callback).toHaveBeenCalledWith(null, { postId: 1, type: 'progress', percent: 50 });
            expect(worker.onmessageDict[1]).toBeDefined();

            // 2. Final 'done' message invokes callback and removes handler
            raw.simulateReply({ postId: 1, type: 'done', offsets: [0, 100] });
            expect(callback).toHaveBeenCalledWith(null, { postId: 1, type: 'done', offsets: [0, 100] });
            expect(worker.onmessageDict[1]).toBeUndefined();
        });

        it('rejects pending requests when raw worker emits an error', async () => {
            const raw = new MockRawWorker();
            const worker = new _Worker(raw);

            const p1 = worker.post({ type: 'compute' });
            raw.simulateError(new Error('Out of bounds error'));

            await expect(p1).rejects.toThrow('Out of bounds error');
            expect(Object.keys(worker.onmessageDict)).toHaveLength(0);
        });

        it('supports addEventListener and removeEventListener for global messages', () => {
            const raw = new MockRawWorker();
            const worker = new _Worker(raw);
            const listener = vi.fn();

            worker.addEventListener('message', listener);
            raw.simulateReply({ type: 'event', value: 42 });
            expect(listener).toHaveBeenCalled();

            worker.removeEventListener('message', listener);
            raw.simulateReply({ type: 'event2', value: 99 });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('cleans up resources on terminate and rejects pending requests', async () => {
            const raw = new MockRawWorker();
            const worker = new _Worker(raw);

            const pendingPromise = worker.post({ type: 'compute' });
            worker.terminate();
            expect(raw.terminated).toBe(true);
            expect(worker.worker).toBeNull();
            await expect(pendingPromise).rejects.toThrow('Worker terminated');
        });
    });

    describe('WorkerPool', () => {
        it('instantiates pool with specified size and handles graceful worker allocation', () => {
            const pool = new WorkerPool(2);
            expect(pool.maxCount).toBe(2);
            expect(Array.isArray(pool.pool)).toBe(true);
        });

        it('allocates workers via round-robin index rotation', () => {
            const pool = new WorkerPool(3);
            const mockWorkers = [
                new _Worker(new MockRawWorker()),
                new _Worker(new MockRawWorker()),
                new _Worker(new MockRawWorker())
            ];
            pool.pool = mockWorkers;

            expect(pool.getNextWorker()).toBe(mockWorkers[0]);
            expect(pool.getNextWorker()).toBe(mockWorkers[1]);
            expect(pool.getNextWorker()).toBe(mockWorkers[2]);
            expect(pool.getNextWorker()).toBe(mockWorkers[0]);
        });

        it('posts to all workers in parallel using postToAll', async () => {
            const pool = new WorkerPool(2);
            const raw1 = new MockRawWorker();
            const raw2 = new MockRawWorker();
            pool.pool = [new _Worker(raw1), new _Worker(raw2)];

            const promise = pool.postToAll((idx) => ({ type: 'batch', threadId: idx }));
            expect(raw1.postedMessages).toHaveLength(1);
            expect(raw2.postedMessages).toHaveLength(1);

            raw1.simulateReply({ postId: 1, threadId: 0, ok: true });
            raw2.simulateReply({ postId: 1, threadId: 1, ok: true });

            const results = await promise;
            expect(results).toHaveLength(2);
            expect(results[0].threadId).toBe(0);
            expect(results[1].threadId).toBe(1);
        });

        it('falls back to standard Worker constructor if defined', () => {
            const originalWorker = globalThis.Worker;
            try {
                const mockInstances = [];
                globalThis.Worker = class extends MockRawWorker {
                    constructor(url, opts) {
                        super();
                        this.url = url;
                        this.opts = opts;
                        mockInstances.push(this);
                    }
                };

                const pool = new WorkerPool(2);
                expect(pool.pool).toHaveLength(0);
                pool.initPool();
                expect(pool.pool).toHaveLength(2);
                expect(mockInstances).toHaveLength(2);
                expect(mockInstances[0].opts).toEqual({ type: 'module' });
            } finally {
                globalThis.Worker = originalWorker;
            }
        });

        it('returns error when post is invoked with empty or uninitialized pool', async () => {
            const pool = new WorkerPool(2);
            pool.pool = [];
            // Override initPool to leave pool empty
            pool.initPool = vi.fn();

            await expect(pool.post({ type: 'test' })).rejects.toThrow('No available WebWorker');
        });

        it('terminates all workers cleanly on terminate()', () => {
            const pool = new WorkerPool(2);
            const raw1 = new MockRawWorker();
            const raw2 = new MockRawWorker();
            pool.pool = [new _Worker(raw1), new _Worker(raw2)];

            pool.terminate();
            expect(raw1.terminated).toBe(true);
            expect(raw2.terminated).toBe(true);
            expect(pool.pool).toHaveLength(0);
        });
        it('catches SecurityError on worker creation and triggers CSP error notice', async () => {
            const originalWorker = globalThis.Worker;
            const onError = vi.fn();
            try {
                globalThis.Worker = class {
                    constructor() {
                        const secErr = new Error("Failed to construct 'Worker': Access to script at 'blob:...' is denied by Content Security Policy.");
                        secErr.name = 'SecurityError';
                        throw secErr;
                    }
                };

                const pool = new WorkerPool(2, onError);
                pool.initPool();

                expect(pool.pool).toHaveLength(0);
                expect(onError).toHaveBeenCalledWith(
                    expect.stringContaining('worker-src allows blob: or self'),
                    expect.any(Error)
                );

                await expect(pool.post({ type: 'test' })).rejects.toThrow(/Ensure worker-src allows 'blob:' in CSP/);
            } finally {
                globalThis.Worker = originalWorker;
            }
        });
    });

    describe('WorkerManager Facade', () => {
        it('provides standard facade methods', () => {
            const manager = new WorkerManager();
            expect(typeof manager.getPoolSize).toBe('function');
            expect(typeof manager.getNextWorker).toBe('function');
            expect(typeof manager.postMessage).toBe('function');
            expect(typeof manager.terminate).toBe('function');

            manager.terminate();
        });

        it('forwards security errors to engine.notify if engine instance is provided', () => {
            const originalWorker = globalThis.Worker;
            const mockEngine = {
                notify: vi.fn()
            };
            try {
                globalThis.Worker = class {
                    constructor() {
                        const secErr = new Error('Refused to create worker due to CSP');
                        secErr.name = 'SecurityError';
                        throw secErr;
                    }
                };

                const manager = new WorkerManager(mockEngine);
                manager.pool.initPool();

                expect(mockEngine.notify).toHaveBeenCalledWith(
                    'error',
                    expect.stringContaining('worker-src allows blob: or self')
                );
            } finally {
                globalThis.Worker = originalWorker;
            }
        });
    });
});

