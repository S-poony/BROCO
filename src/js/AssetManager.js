import { MAX_ASSET_DIMENSION, ASSET_THUMBNAIL_QUALITY } from './constants.js';

/**
 * @typedef {Object} Asset
 * @property {string} id
 * @property {string} name
 * @property {string} lowResData
 * @property {string} fullResData
 */

export class AssetManager extends EventTarget {
    constructor() {
        super();
        /** @type {Asset[]} */
        this.assets = [];
    }

    /**
     * @param {File} file 
     * @returns {Promise<Asset>}
     */
    async processFile(file) {
        if (!file.type.startsWith('image/')) {
            throw new Error('File is not an image');
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.onload = (e) => {
                const fullResData = e.target.result;
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

                        resolve({
                            id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            name: file.name,
                            lowResData: lowResData,
                            fullResData: String(fullResData)
                        });
                    } catch (err) {
                        reject(err);
                    }
                };
                img.src = String(fullResData);
            };
            reader.readAsDataURL(file);
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
}

export const assetManager = new AssetManager();
