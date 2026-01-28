import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetManager } from '../../src/js/assets/AssetManager.js';

describe('AssetManager', () => {
    let assetManager;

    beforeEach(() => {
        assetManager = new AssetManager();
    });

    it('should initialize with empty assets', () => {
        expect(assetManager.getAssets()).toEqual([]);
    });

    it('should add an asset and emit an event', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data1', fullResData: 'data2' };
        const listener = vi.fn();
        assetManager.addEventListener('assets:changed', listener);

        assetManager.addAsset(asset);

        expect(assetManager.getAssets()).toContain(asset);
        expect(listener).toHaveBeenCalled();
        const eventDetail = listener.mock.calls[0][0].detail;
        expect(eventDetail.type).toBe('added');
        expect(eventDetail.asset).toBe(asset);
    });

    it('should remove an asset and emit an event', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data1', fullResData: 'data2' };
        assetManager.addAsset(asset);

        const listener = vi.fn();
        assetManager.addEventListener('assets:changed', listener);

        const removed = assetManager.removeAsset('1');

        expect(assetManager.getAssets()).not.toContain(asset);
        expect(removed).toBe(asset);
        expect(listener).toHaveBeenCalled();
        const eventDetail = listener.mock.calls[0][0].detail;
        expect(eventDetail.type).toBe('removed');
        expect(eventDetail.assetId).toBe('1');
    });

    it('should update an asset and emit an event', () => {
        const asset = { id: '1', name: 'test.png', lowResData: 'data1', fullResData: 'data2' };
        assetManager.addAsset(asset);

        const listener = vi.fn();
        assetManager.addEventListener('assets:changed', listener);

        assetManager.updateAsset('1', { name: 'updated.png' });

        expect(assetManager.getAsset('1').name).toBe('updated.png');
        expect(listener).toHaveBeenCalled();
        const eventDetail = listener.mock.calls[0][0].detail;
        expect(eventDetail.type).toBe('updated');
        expect(eventDetail.asset.name).toBe('updated.png');
    });

    it('should return undefined for non-existent asset', () => {
        expect(assetManager.getAsset('999')).toBeUndefined();
    });

    it('should handle processFile errors (invalid type)', async () => {
        const file = new File(['binary data'], 'test.bin', { type: 'application/octet-stream' });
        await expect(assetManager.processFile(file)).rejects.toThrow('File is not an image');
    });

    it('should process text files', async () => {
        const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
        const asset = await assetManager.processFile(file);
        expect(asset.type).toBe('text');
        expect(asset.fullResData).toBe('hello world');
    });
});
