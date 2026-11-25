import { describe, it, expect, vi } from 'vitest';
import { exportViewportImage } from '../src/engine/exporter.js';

describe('exportViewportImage high-resolution viewport image exporter', () => {
    it('throws when no stage is provided', async () => {
        await expect(exportViewportImage(null)).rejects.toThrow('No active 3D viewport to capture image.');
    });

    it('captures image with default options and factor 2', async () => {
        const mockBlob = new Blob(['mock-png'], { type: 'image/png' });
        const mockStage = {
            makeImage: vi.fn().mockResolvedValue(mockBlob)
        };

        const result = await exportViewportImage(mockStage, 'test_screenshot.png');

        expect(mockStage.makeImage).toHaveBeenCalledWith({
            antialias: true,
            trim: false,
            factor: 2,
            transparent: false
        });
        expect(result).toBe(mockBlob);
    });

    it('supports 300DPI and 4K resolution flags', async () => {
        const mockBlob = new Blob(['mock-png'], { type: 'image/png' });
        const mockStage = {
            makeImage: vi.fn().mockResolvedValue(mockBlob)
        };

        await exportViewportImage(mockStage, 'shot_300dpi.png', '300dpi');
        expect(mockStage.makeImage).toHaveBeenCalledWith(expect.objectContaining({ factor: 3 }));

        await exportViewportImage(mockStage, 'shot_4k.png', '4k');
        expect(mockStage.makeImage).toHaveBeenCalledWith(expect.objectContaining({ factor: 4 }));
    });
});
