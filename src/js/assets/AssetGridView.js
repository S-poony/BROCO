import { assetManager } from './AssetManager.js';
import { dragDropService } from '../ui/DragDropService.js';

export class AssetGridView {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.lazyObserver = null;
        this.setupObserver();
    }

    setupObserver() {
        this.lazyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.hydrateAssetItem(entry.target);
                    this.lazyObserver.unobserve(entry.target);
                }
            });
        }, { rootMargin: '300px' });
    }

    refresh() {
        if (!this.container) return;
        this.container.innerHTML = '';
        assetManager.getAssets().forEach(asset => this.appendAsset(asset));
    }

    appendAsset(asset) {
        if (!this.container) return;

        const item = document.createElement('div');
        item.className = 'asset-item lazy skeleton';
        item.dataset.id = asset.id;
        item.title = asset.name;

        item.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.remove')) return;
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            dragDropService.startDrag({
                asset: asset.type === 'image' ? asset : undefined,
                text: asset.type === 'text' ? asset.fullResData : undefined
            }, e);
        });

        this.container.appendChild(item);
        this.lazyObserver?.observe(item);
    }

    hydrateAssetItem(element) {
        const assetId = element.dataset.id;
        const asset = assetManager.getAsset(assetId);
        if (!asset || !element.classList.contains('lazy')) return;

        element.classList.remove('lazy', 'skeleton');
        element.innerHTML = '';

        if (asset.type === 'text') {
            const txtBox = document.createElement('div');
            txtBox.className = 'text-icon-placeholder';
            txtBox.textContent = 'TXT';
            element.appendChild(txtBox);
        } else {
            if (asset.isBroken) {
                element.classList.add('is-broken');
                element.title = `Missing file: ${asset.absolutePath}`;
                const warningIcon = document.createElement('div');
                warningIcon.className = 'broken-link-icon icon icon-warning';
                element.appendChild(warningIcon);
            } else {
                const img = document.createElement('img');
                img.src = asset.lowResData;
                img.alt = asset.name;
                img.loading = 'lazy';
                element.appendChild(img);
            }
        }

        const actions = document.createElement('div');
        actions.className = 'asset-actions';

        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'asset-action-btn replace';
        replaceBtn.dataset.id = asset.id;
        replaceBtn.title = 'Replace Asset';
        replaceBtn.innerHTML = '<span class="icon icon-replace"></span>';
        actions.appendChild(replaceBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'asset-action-btn remove';
        removeBtn.dataset.id = asset.id;
        removeBtn.title = 'Remove Asset';
        removeBtn.innerHTML = '<span class="icon icon-delete"></span>';
        actions.appendChild(removeBtn);

        element.appendChild(actions);
    }
}
