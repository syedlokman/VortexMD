import { describe, it, expect, vi } from 'vitest';
import { VortexMD } from '../src/engine/vortexmd.js';
import { PlaybackController } from '../src/engine/playback.js';
import { RmsdController } from '../src/engine/rmsd.js';
import { findNearestRmsdItem, renderRmsdChart } from '../src/ui/panels/rmsd-panel.js';

describe('RMSD Stride-Aware Mapping & Scrubber Synchronization', () => {

    function createTestPlayer() {
        const player = Object.create(VortexMD.prototype);
        player.playbackController = new PlaybackController(player);
        player.rmsdController = new RmsdController(player);
        player.rmsdController.findNearestRmsdItem = findNearestRmsdItem;
        player.rmsdController.renderRmsdChart = (series, fitQ, calcQ) => {
            const elements = {
                container: player.shadowRoot.getElementById('rmsd-chart-container'),
                canvas: player.shadowRoot.getElementById('rmsd-canvas'),
                summary: player.shadowRoot.getElementById('rmsd-stats-summary'),
                chartTitle: player.shadowRoot.getElementById('rmsd-chart-title'),
                subtitle: player.shadowRoot.getElementById('rmsd-gromacs-subtitle'),
                pointInfo: player.shadowRoot.getElementById('rmsd-active-point-info'),
                btnReset: player.shadowRoot.getElementById('btn-reset-rmsd-plot')
            };
            const ctl = renderRmsdChart(elements, series, fitQ, calcQ, (f) => player.playbackController.jumpToFrame(f));
            player.addEventListener('frame-update', (e) => {
                ctl?.updateCursor(e.detail.frame);
            });
            return ctl;
        };
        player.hasAttribute = () => false;
        player.getAttribute = () => null;
        player.setAttribute = () => {};
        player.removeAttribute = () => {};
        const listeners = new Map();
        player.addEventListener = (evt, cb) => {
            if (!listeners.has(evt)) listeners.set(evt, []);
            listeners.get(evt).push(cb);
        };
        player.removeEventListener = (evt, cb) => {
            if (!listeners.has(evt)) return;
            listeners.set(evt, listeners.get(evt).filter(fn => fn !== cb));
        };
        player.dispatchEvent = (evt) => {
            const handlers = listeners.get(evt.type) || [];
            for (const h of handlers) h(evt);
            return true;
        };
        const elements = new Map();
        player.shadowRoot = {
            getElementById: (id) => elements.get(id) || null,
            _setElement: (id, el) => elements.set(id, el)
        };
        player.playbackController.jumpToFrame = vi.fn((f) => {
            player._currentFrame = f - 1;
        });
        player.jumpToFrame = player.playbackController.jumpToFrame;
        return player;
    }


    it('findNearestRmsdItem returns closest sampled point across wide strides', () => {
        const player = createTestPlayer();
        // Emulate 10,001 frames with stride 5 => frames 1, 6, 11, ..., 10001
        const series = [];
        for (let f = 1; f <= 10001; f += 5) {
            series.push({
                frame: f,
                rmsd: parseFloat((0.5 + (f / 10001) * 2.0).toFixed(3)),
                timeNs: (f * 0.01).toFixed(2)
            });
        }

        expect(series.length).toBe(2001);
        expect(series[0].frame).toBe(1);
        expect(series[2000].frame).toBe(10001);

        // Exact matches
        expect(player.rmsdController.findNearestRmsdItem(1, series).frame).toBe(1);
        expect(player.rmsdController.findNearestRmsdItem(6, series).frame).toBe(6);
        expect(player.rmsdController.findNearestRmsdItem(10001, series).frame).toBe(10001);

        // Intermediate frames between stride
        expect(player.rmsdController.findNearestRmsdItem(2, series).frame).toBe(1);
        expect(player.rmsdController.findNearestRmsdItem(3, series).frame).toBe(1);
        expect(player.rmsdController.findNearestRmsdItem(4, series).frame).toBe(6);
        expect(player.rmsdController.findNearestRmsdItem(5, series).frame).toBe(6);

        // Mid-trajectory frame (e.g. 5000 -> closest is 5001)
        expect(player.rmsdController.findNearestRmsdItem(5000, series).frame).toBe(5001);
        expect(player.rmsdController.findNearestRmsdItem(2500, series).frame).toBe(2501);

        // Out of bounds
        expect(player.rmsdController.findNearestRmsdItem(0, series).frame).toBe(1);
        expect(player.rmsdController.findNearestRmsdItem(12000, series).frame).toBe(10001);
    });

    it('handles edge cases in findNearestRmsdItem gracefully', () => {
        const player = createTestPlayer();
        expect(player.rmsdController.findNearestRmsdItem(5, null)).toBeNull();
        expect(player.rmsdController.findNearestRmsdItem(5, [])).toBeNull();

        const singleItem = [{ frame: 42, rmsd: 1.25, timeNs: '0.42' }];
        expect(player.rmsdController.findNearestRmsdItem(1, singleItem)).toEqual(singleItem[0]);
        expect(player.rmsdController.findNearestRmsdItem(42, singleItem)).toEqual(singleItem[0]);
        expect(player.rmsdController.findNearestRmsdItem(100, singleItem)).toEqual(singleItem[0]);
    });

    it('renderRmsdChart scrubber and click jump handle stride > 1 without disappearing at frame 2500+', () => {
        const player = createTestPlayer();

        // Create mock DOM structure required by renderRmsdChart
        const container = { id: 'rmsd-chart-container', style: {} };
        const mockContext = {
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            arc: vi.fn(),
            fillText: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            setLineDash: vi.fn()
        };
        const canvas = {
            id: 'rmsd-canvas',
            width: 600,
            height: 200,
            getContext: () => mockContext,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }),
            onclick: null,
            ondblclick: null,
            onwheel: null
        };
        const summary = { id: 'rmsd-stats-summary', innerText: '' };
        const chartTitle = { id: 'rmsd-chart-title', innerText: '' };
        const subtitle = { id: 'rmsd-gromacs-subtitle', innerText: '' };
        const pointInfo = { id: 'rmsd-active-point-info', innerText: '' };

        player.shadowRoot._setElement('rmsd-chart-container', container);
        player.shadowRoot._setElement('rmsd-canvas', canvas);
        player.shadowRoot._setElement('rmsd-stats-summary', summary);
        player.shadowRoot._setElement('rmsd-chart-title', chartTitle);
        player.shadowRoot._setElement('rmsd-gromacs-subtitle', subtitle);
        player.shadowRoot._setElement('rmsd-active-point-info', pointInfo);

        // Emulate 10,001 frames with stride 5
        const series = [];
        for (let f = 1; f <= 10001; f += 5) {
            series.push({
                frame: f,
                rmsd: parseFloat((1.0 + Math.sin(f / 500)).toFixed(2)),
                timeNs: (f * 0.02).toFixed(2)
            });
        }
        player.lastRmsdSeries = series;

        player.rmsdController.renderRmsdChart(series, 'protein and .CA', 'protein and .CA');

        // Verify initial render sets pointInfo to frame 1
        expect(pointInfo.innerText).toContain('Frame: 1');

        // Test canvas click at rightmost edge
        // PadL is 42, PadR is 14, PlotW is 600 - 42 - 14 = 544
        // Click at padL + plotW should target the last item (frame 10001)
        expect(typeof canvas.onclick).toBe('function');
        canvas.onclick({
            clientX: 580 // Near end of plotW (42 + 544 = 586)
        });

        expect(player.playbackController.jumpToFrame).toHaveBeenCalled();
        const calledFrame = player.playbackController.jumpToFrame.mock.calls[0][0];
        // The jumped frame should be close to 10001, NOT 2001 (which was the old index-based bug)
        expect(calledFrame).toBeGreaterThan(9500);

        // Test live frame update event at frame 7500 (well beyond the 2001 array length)
        player.dispatchEvent({
            type: 'frame-update',
            detail: { frame: 7500 }
        });

        // pointInfo must show frame 7500 and not crash or show undefined
        expect(pointInfo.innerText).toContain('Frame: 7500');
        expect(pointInfo.innerText).not.toContain('undefined');
        // RMSD value should be present
        expect(pointInfo.innerText).toContain('Å');
    });

    it('verifies computeRMSD progress callback passes both trajectory frame and sampled points count', async () => {
        const player = createTestPlayer();
        const dummyCoords = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

        player.comp = {
            structure: {
                getAtomIndices: () => [0, 1, 2]
            }
        };
        player.ringBuffer = {
            frameCount: 10001,
            getFrameCoords: async (f) => dummyCoords,
            frameBuffer: new Map()
        };

        const progressUpdates = [];
        // Test with stride 5
        await player.rmsdController.computeRmsd({
            fitQuery: 'protein and .CA',
            calcQuery: 'protein and .CA',
            stride: 5,
            onProgress: (p) => {
                progressUpdates.push(p);
            }
        });

        expect(progressUpdates.length).toBeGreaterThan(0);
        const lastUpdate = progressUpdates[progressUpdates.length - 1];
        expect(lastUpdate.totalFrames).toBe(10001);
        expect(lastUpdate.totalPoints).toBe(2001);
        expect(lastUpdate.point).toBe(2001);
        expect(lastUpdate.frame).toBe(10001);
        expect(lastUpdate.percent).toBe(100);

        // Verify formatting logic
        const formatted = `Frame: ${lastUpdate.frame.toLocaleString()} / ${lastUpdate.totalFrames.toLocaleString()} (Sampled ${lastUpdate.point.toLocaleString()} / ${lastUpdate.totalPoints.toLocaleString()})`;
        expect(formatted).toBe('Frame: 10,001 / 10,001 (Sampled 2,001 / 2,001)');
    });

    it('throws if trajectory indexing is currently in progress', async () => {
        const player = createTestPlayer();
        player.isIndexing = true;
        player.notify = vi.fn();
        player.emit = vi.fn();

        await expect(player.rmsdController.computeRmsd()).rejects.toThrow('Indexing in progress');
        expect(player.notify).toHaveBeenCalledWith('warning', expect.stringContaining('Indexing in progress'));
    });

    it('surfaces worker failure as an error and does not swallow it', async () => {
        const player = createTestPlayer();
        player.notify = vi.fn();
        player.emit = vi.fn();
        const dummyCoords = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

        player.comp = {
            structure: {
                getAtomIndices: () => [0, 1, 2]
            }
        };
        player.ringBuffer = {
            frameCount: 5,
            getFrameCoords: async (f) => dummyCoords,
            fileOffsets: [0, 100, 200, 300, 400, 500],
            xtcFile: { size: 500 }
        };
        player.workerManager = {
            getNextWorker: () => ({
                post: async () => {
                    throw new Error('Out of memory');
                }
            })
        };

        await expect(player.rmsdController.computeRmsd({ stride: 1 })).rejects.toThrow('RMSD worker failed: Out of memory');
        expect(player.notify).toHaveBeenCalledWith('error', expect.stringContaining('RMSD worker failed'));
    });
});
