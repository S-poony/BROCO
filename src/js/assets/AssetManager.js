import { MAX_ASSET_DIMENSION, ASSET_THUMBNAIL_QUALITY, MAX_FILE_SIZE_MB } from '../core/constants.js';
import { getSettings } from '../ui/settings.js';

/**
 * @typedef {Object} Asset
 * @property {string} id
 * @property {string} name
 * @property {string} lowResData
 * @property {string} fullResData
 * @property {string} [path]
 * @property {string} type 'image' | 'text'
 */

export class AssetManager extends EventTarget {
    constructor() {
        super();
        /** @type {Asset[]} */
        this.assets = [];
    }

    /**
     * @param {File} file 
     * @param {string} [path] Optional relative path (for folder imports)
     * @returns {Promise<Asset>}
     */
    async processFile(file, path) {
        // Simple text file check
        if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
            return this.processTextFile(file, path);
        }

        if (!file.type.startsWith('image/')) {
            throw new Error('File is not an image');
        }

        const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
        if (file.size > maxBytes) {
            throw new Error(`File too large. Maximum size: ${MAX_FILE_SIZE_MB}MB`);
        }

        // Parallelize Base64 reading (for storage) and Image Processing (for thumbnail)
        const base64Promise = new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });

        // Use createImageBitmap for off-main-thread decoding (Performance fix)
        const bitmapPromise = createImageBitmap(file);

        try {
            const [fullResData, bitmap] = await Promise.all([base64Promise, bitmapPromise]);
            const lowResData = this._generateThumbnailFromImageSource(bitmap);
            bitmap.close(); // verified: release memory

            return {
                id: crypto.randomUUID(),
                name: file.name,
                lowResData: lowResData,
                fullResData: fullResData,
                path: path || file.name,
                isBroken: false,
                type: 'image'
            };
        } catch (err) {
            throw err;
        }
    }

    /**
     * Process raw image data (e.g. from Electron) and generate thumbnail
     * @param {string} name 
     * @param {string} fullResData Base64 string
     * @param {string} type 
     * @param {string} [path] 
     * @returns {Promise<Asset>}
     */
    async processRawImage(name, fullResData, type, path, absolutePath) {
        if (type !== 'image') {
            const lowResData = (type === 'text') ? fullResData.substring(0, 400) : null;
            return {
                id: crypto.randomUUID(),
                name: name,
                lowResData: lowResData,
                fullResData: fullResData,
                path: path || name,
                absolutePath: absolutePath, // Always store if available
                isBroken: false,
                type: type
            };
        }

        const settings = getSettings();
        const useReferences = settings.electron?.useFileReferences === true && !!absolutePath;

        // For Base64, we still have to load it to an image to crop/resize
        const lowResData = await this._createThumbnailFromBase64(fullResData);

        return {
            id: crypto.randomUUID(),
            name: name,
            lowResData: lowResData,
            fullResData: useReferences ? null : fullResData, // Strip full res if tracking by reference
            path: path || name,
            absolutePath: absolutePath,
            isReference: useReferences,
            isBroken: false,
            type: 'image'
        };
    }

    /**
     * @private
     * @param {CanvasImageSource} source 
     * @returns {string} Low res base64 data
     */
    _generateThumbnailFromImageSource(source) {
        const canvas = document.createElement('canvas');
        let width = source.width;
        let height = source.height;

        if (width > height) {
            if (width > MAX_ASSET_DIMENSION) {
                height *= MAX_ASSET_DIMENSION / width;
                width = MAX_ASSET_DIMENSION;
            }
        } else {
            if (height > MAX_ASSET_DIMENSION) {
                width *= MAX_ASSET_DIMENSION / height;
                height = MAX_ASSET_DIMENSION;
            }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');
        ctx.drawImage(source, 0, 0, width, height);

        return canvas.toDataURL('image/jpeg', ASSET_THUMBNAIL_QUALITY);
    }

    /**
     * @private
     * @param {string} base64Data
     * @returns {Promise<string>}
     */
    _createThumbnailFromBase64(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Failed to load image'));
            img.onload = () => {
                try {
                    const thumb = this._generateThumbnailFromImageSource(img);
                    resolve(thumb);
                } catch (err) {
                    reject(err);
                }
            };
            img.src = base64Data;
        });
    }

    // Legacy alias if needed, or just internal mapping
    _createThumbnail(imageSource) {
        return this._createThumbnailFromBase64(String(imageSource));
    }

    async processTextFile(file, path) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read text file'));
            reader.onload = (e) => {
                const text = e.target.result;
                const lowResData = text.substring(0, 400); // 400 chars is enough for a good preview

                resolve({
                    id: crypto.randomUUID(),
                    name: file.name,
                    lowResData: lowResData,
                    fullResData: text,
                    path: path || file.name,
                    isBroken: false,
                    type: 'text'
                });
            };
            reader.readAsText(file);
        });
    }

    /**
     * @param {Asset} asset 
     */
    addAsset(asset) {
        this.assets.push(asset);
        this.dispatchEvent(new CustomEvent('assets:changed', { detail: { type: 'added', asset } }));
    }

    /**
     * @param {string} id 
     */
    removeAsset(id) {
        const index = this.assets.findIndex(a => a.id === id);
        if (index !== -1) {
            const asset = this.assets.splice(index, 1)[0];
            this.dispatchEvent(new CustomEvent('assets:changed', { detail: { type: 'removed', assetId: id } }));
            return asset;
        }
        return null;
    }

    /**
     * @param {string} id 
     * @param {Partial<Asset>} newData 
     */
    updateAsset(id, newData) {
        const asset = this.assets.find(a => a.id === id);
        if (asset) {
            Object.assign(asset, newData);
            this.dispatchEvent(new CustomEvent('assets:changed', { detail: { type: 'updated', asset } }));
            return asset;
        }
        return null;
    }

    /**
     * Reconstructs lowResData (thumbnail) for an asset from its local path.
     * Useful for Electron reference mode where thumbnails aren't saved to JSON.
     * @param {Asset} asset 
     */
    async rehydrateAsset(asset) {
        if (!asset.isReference || !asset.absolutePath) return;

        try {
            // Fetch via our custom broco-local protocol
            const url = `broco-local://${encodeURIComponent(asset.absolutePath)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('File not found');

            const blob = await response.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            const lowResData = await this._createThumbnailFromBase64(dataUrl);
            this.updateAsset(asset.id, {
                lowResData,
                fullResData: null, // Keep it null/reference
                isBroken: false
            });
        } catch (err) {
            console.warn(`Could not rehydrate asset: ${asset.name} at ${asset.absolutePath}`, err);
            this.updateAsset(asset.id, { isBroken: true });
        }
    }

    /**
     * @param {string} id 
     * @returns {Asset|undefined}
     */
    getAsset(id) {
        return this.assets.find(a => a.id === id);
    }

    getAssets() {
        return [...this.assets];
    }

    /**
     * Removes all assets whose path starts with the given prefix.
     * @param {string} prefix 
     */
    removeAssetsByPathPrefix(prefix) {
        const toRemove = this.assets.filter(a => (a.path || a.name).startsWith(prefix));
        const removedIds = toRemove.map(a => a.id);

        this.assets = this.assets.filter(a => !removedIds.includes(a.id));

        this.dispatchEvent(new CustomEvent('assets:changed', {
            detail: { type: 'removed_batch', assetIds: removedIds }
        }));
    }

    /**
     * Clears all assets from memory
     */
    dispose() {
        this.assets = [];
        this.dispatchEvent(new CustomEvent('assets:changed', { detail: { type: 'cleared' } }));
    }
}

export const assetManager = new AssetManager();
