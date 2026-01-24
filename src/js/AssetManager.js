import { MAX_ASSET_DIMENSION, ASSET_THUMBNAIL_QUALITY, MAX_FILE_SIZE_MB } from './constants.js';
import { getSettings } from './settings.js';

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

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.onload = async (e) => {
                const fullResData = e.target.result;
                try {
                    const lowResData = await this._createThumbnail(fullResData);
                    resolve({
                        id: crypto.randomUUID(),
                        name: file.name,
                        lowResData: lowResData,
                        fullResData: fullResData,
                        path: path || file.name,
                        type: 'image'
                    });
                } catch (err) {
                    reject(err);
                }
            };
            reader.readAsDataURL(file);
        });
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
            return {
                id: crypto.randomUUID(),
                name: name,
                lowResData: null,
                fullResData: fullResData,
                path: path || name,
                absolutePath: absolutePath, // Always store if available
                type: type
            };
        }

        const settings = getSettings();
        const useReferences = settings.electron?.useFileReferences === true && !!absolutePath;

        const lowResData = await this._createThumbnail(fullResData);

        return {
            id: crypto.randomUUID(),
            name: name,
            lowResData: lowResData,
            fullResData: useReferences ? null : fullResData, // Strip full res if tracking by reference
            path: path || name,
            absolutePath: absolutePath,
            isReference: useReferences,
            type: 'image'
        };
    }

    /**
     * @private
     * @param {string} imageSource Base64 data or URL
     * @returns {Promise<string>} Low res base64 data
     */
    _createThumbnail(imageSource) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Failed to load image'));
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

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
                    ctx.drawImage(img, 0, 0, width, height);

                    const lowResData = canvas.toDataURL('image/jpeg', ASSET_THUMBNAIL_QUALITY);
                    resolve(lowResData);
                } catch (err) {
                    reject(err);
                }
            };
            img.src = String(imageSource);
        });
    }

    async processTextFile(file, path) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read text file'));
            reader.onload = (e) => {
                resolve({
                    id: crypto.randomUUID(),
                    name: file.name,
                    lowResData: null, // No thumbnail for text
                    fullResData: e.target.result,
                    path: path || file.name,
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
