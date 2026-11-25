import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Headless <vortexmd-engine> Core Engine & Decoupling', () => {
    let VortexMD;
    let originalDocument;
    let originalCustomElements;
    let originalHTMLElement;
    let originalWindow;
    let bareDocument;
    let customRegistry;

    beforeEach(async () => {
        customRegistry = new Map();

        class BareShadowRoot extends EventTarget {
            constructor(host) {
                super();
                this.host = host;
                this._innerHTML = '';
                this._elements = new Map();
            }
            get innerHTML() {
                return this._innerHTML;
            }
            set innerHTML(html) {
                this._innerHTML = html;
                this._elements.clear();
                const idRegex = /id=["']([^"']+)["']/g;
                let match;
                while ((match = idRegex.exec(html)) !== null) {
                    const el = new BareHTMLElement();
                    el.id = match[1];
                    this._elements.set(match[1], el);
                }
            }
            getElementById(id) {
                return this._elements.get(id) || null;
            }
            querySelector(selector) {
                return selector.startsWith('#') ? this.getElementById(selector.slice(1)) : null;
            }
            querySelectorAll() {
                return [];
            }
        }

        class BareHTMLElement extends EventTarget {
            constructor() {
                super();
                this.shadowRoot = null;
                this.children = [];
                this.style = {};
                this._attributes = new Map();
                this.classList = { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) };
            }
            hasAttribute(name) { return this._attributes.has(name); }
            getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
            setAttribute(name, val) {
                const oldVal = this.getAttribute(name);
                const strVal = String(val);
                this._attributes.set(name, strVal);
                if (typeof this.attributeChangedCallback === 'function' && oldVal !== strVal) {
                    this.attributeChangedCallback(name, oldVal, strVal);
                }
            }
            appendChild(child) {
                this.children.push(child);
                child.parentElement = this;
                return child;
            }
            attachShadow() {
                this.shadowRoot = new BareShadowRoot(this);
                return this.shadowRoot;
            }
            querySelector() { return null; }
            querySelectorAll() { return []; }
        }

        class MockWorker extends EventTarget {
            postMessage(msg) {
                if (msg && msg.postId !== undefined) {
                    setTimeout(() => {
                        let series = [];
                        if (msg.type === 'stream_compute_rmsd' && Array.isArray(msg.filteredBatch)) {
                            series = msg.filteredBatch.map(item => ({
                                frame: item.frame,
                                timeNs: (((item.frame - 1) * (msg.dt || 100)) / 1000).toFixed(2),
                                rmsd: 0.15
                            }));
                        }
                        const event = { data: { postId: msg.postId, type: msg.type, rmsdSeries: series } };
                        if (typeof this.onmessage === 'function') this.onmessage(event);
                    }, 0);
                }
            }
            terminate() {}
        }

        if (!globalThis.Worker) globalThis.Worker = MockWorker;
        if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
        if (!globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
        if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:mock';
        if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

        bareDocument = {
            getElementById: vi.fn(() => null),
            createElement: vi.fn((tag) => {
                const Cls = customRegistry.get(tag);
                return Cls ? new Cls() : new BareHTMLElement();
            }),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            fullscreenElement: null,
            documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
            exitFullscreen: vi.fn().mockResolvedValue(undefined),
            body: { appendChild: vi.fn(), removeChild: vi.fn() }
        };

        const bareCustomElements = {
            define: vi.fn((tag, cls) => customRegistry.set(tag, cls)),
            get: vi.fn((tag) => customRegistry.get(tag))
        };

        originalDocument = globalThis.document;
        originalCustomElements = globalThis.customElements;
        originalHTMLElement = globalThis.HTMLElement;
        originalWindow = globalThis.window;

        globalThis.document = bareDocument;
        globalThis.customElements = bareCustomElements;
        globalThis.HTMLElement = BareHTMLElement;
        globalThis.window = {
            location: { search: '', href: 'http://localhost/' },
            navigator: globalThis.navigator || { userAgent: 'Mozilla/5.0 (Node.js/Headless)' },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
            open: vi.fn()
        };

        const module = await import('../src/engine/vortexmd.js');
        VortexMD = module.VortexMD;
    });

    afterEach(() => {
        globalThis.document = originalDocument;
        globalThis.customElements = originalCustomElements;
        globalThis.HTMLElement = originalHTMLElement;
        globalThis.window = originalWindow;
        vi.restoreAllMocks();
    });

    it('instantiates <vortexmd-engine> in bare DOM with only #viewport and fallback min-height in Shadow DOM', () => {
        const player = new VortexMD();
        expect(player).toBeDefined();
        expect(player.controls).toBe(false);
        expect(player.shadowRoot).toBeDefined();
        expect(player.shadowRoot.getElementById('viewport')).not.toBeNull();
        expect(player.shadowRoot.getElementById('drawer')).toBeNull();
        expect(player.shadowRoot.getElementById('drawer-mini')).toBeNull();
        expect(player.shadowRoot.innerHTML).toContain('min-height: 400px');
    });

    it('exposes PUBLIC_API state properties as read-only getters updated via setter methods', () => {
        const player = new VortexMD();
        const readOnlyProps = [
            'structureName', 'trajectoryName', 'isPlaying', 'isLooping',
            'frameStep', 'deltaTime', 'timeOffset', 'mouseScheme', 'depthSlicing'
        ];
        for (const prop of readOnlyProps) {
            expect(() => { player[prop] = 'mutated'; }).toThrow(TypeError);
        }

        player.setLoop(true);
        player.setFrameStep(5);
        player.setPhysicalTimeConfig(50, 10);
        player.setMouseScheme('pymol');
        player.setDepthSlicing(40);

        expect(player.isLooping).toBe(true);
        expect(player.frameStep).toBe(5);
        expect(player.deltaTime).toBe(50);
        expect(player.timeOffset).toBe(10);
        expect(player.mouseScheme).toBe('pymol');
        expect(player.depthSlicing).toBe(40);
    });

    it('executes loadTopology and playback controls cleanly in bare DOM without outer UI queries', async () => {
        const player = new VortexMD();
        player.viewportManager = {
            loadStructure: vi.fn().mockResolvedValue({
                structure: {
                    atomCount: 120,
                    eachChain: vi.fn(),
                    eachResidue: vi.fn(),
                    eachAtom: vi.fn(),
                    getAtomIndices: vi.fn(() => [])
                },
                autoView: vi.fn(),
                removeAllRepresentations: vi.fn(),
                addRepresentation: vi.fn()
            }),
            focusOnSelection: vi.fn(),
            stage: {
                autoView: vi.fn(),
                removeAllComponents: vi.fn(),
                handleResize: vi.fn()
            }
        };

        const atomCount = await player.loadTopology('sim_headless.pdb');
        expect(atomCount).toBe(120);

        player.playbackController.setPlaybackSpeed(2.5);
        player.playbackController.setPlaybackSpeed(-1); // invalid: ignored
        expect(player.speedMultiplier).toBe(2.5);

        player.playbackController.setLoopRange(10, 50);
        expect(player.loopStartFrame).toBe(10);
        expect(player.loopEndFrame).toBe(50);
        player.playbackController.clearLoopRange();
        expect(player.loopEndFrame).toBeNull();

        player.playbackController.setPlaybackDirection('bounce');
        expect(player.playbackDirection).toBe('bounce');
        expect(player.isLooping).toBe(true);

        expect(() => {
            player.playbackController.play();
            player.playbackController.pause();
            player.playbackController.jumpToFrame(1);
            player.updateDisplay(['proteins'], { style: 'cartoon' });
            player.centerView();
        }).not.toThrow();
    });

    it('restores session state and emits session-restored without querying outer DOM elements', async () => {
        const player = new VortexMD();
        const sessionRestoredListener = vi.fn();
        player.addEventListener('session-restored', sessionRestoredListener);

        const sessionPayload = {
            version: '1.0.0',
            app: 'VortexMD',
            sessionId: 'test-session-headless-1',
            sessionName: 'Headless Simulation Test',
            playback: {
                deltaTime: 150,
                timeOffset: 25,
                speedMultiplier: 2.0,
                playbackDirection: 'backward',
                isLooping: true,
                loopRange: { loopStartFrame: 5, loopEndFrame: 45 },
                pins: [{ frame: 12, label: 'Transition State' }]
            },
            visualState: {
                displayConfig: {},
                depthSlicing: 35,
                mouseScheme: 'pymol',
                backgroundColor: '#111827',
                cameraProjection: 'orthographic'
            }
        };

        bareDocument.getElementById.mockClear();
        const result = await player.restoreSession(sessionPayload);
        expect(result).toBe(true);

        expect(player.deltaTime).toBe(150);
        expect(player.timeOffset).toBe(25);
        expect(player.speedMultiplier).toBe(2.0);
        expect(player.playbackDirection).toBe('backward');
        expect(player.isLooping).toBe(true);
        expect(player.loopStartFrame).toBe(5);
        expect(player.loopEndFrame).toBe(45);
        expect(player.depthSlicing).toBe(35);
        expect(player.mouseScheme).toBe('pymol');
        expect(player.pins).toHaveLength(1);

        expect(sessionRestoredListener).toHaveBeenCalledTimes(1);
        expect(sessionRestoredListener.mock.calls[0][0].detail.session.sessionId).toBe('test-session-headless-1');
        expect(bareDocument.getElementById).not.toHaveBeenCalled();
    });

    it('computes RMSD time series and emits rmsd-computed and engine-busy events without touching outer DOM', async () => {
        const player = new VortexMD();
        const rmsdComputedListener = vi.fn();
        const busyEvents = [];
        player.addEventListener('rmsd-computed', rmsdComputedListener);
        player.addEventListener('engine-busy', (e) => busyEvents.push(e.detail));

        player.comp = { structure: { getAtomIndices: vi.fn(() => [0, 1, 2]) } };
        const dummyCoords = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        player.ringBuffer = {
            frameCount: 4,
            getFrameCoords: vi.fn(async () => dummyCoords),
            frameBuffer: new Map()
        };

        bareDocument.getElementById.mockClear();
        const result = await player.rmsdController.computeRmsd({
            fitQuery: 'protein and .CA',
            calcQuery: 'protein and .CA',
            stride: 2
        });

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty('frame');
        expect(result[0]).toHaveProperty('timeNs');
        expect(result[0]).toHaveProperty('rmsd');

        expect(rmsdComputedListener).toHaveBeenCalledTimes(1);
        expect(rmsdComputedListener.mock.calls[0][0].detail.fitQuery).toBe('protein and .CA');
        expect(busyEvents[0]).toEqual({ busy: true, task: 'rmsd' });
        expect(busyEvents[busyEvents.length - 1]).toEqual({ busy: false, task: 'rmsd' });
        expect(bareDocument.getElementById).not.toHaveBeenCalled();
    });
});
