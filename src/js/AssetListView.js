import { assetManager } from './AssetManager.js';
import { dragDropService } from './DragDropService.js';
import { showConfirm } from './utils.js';

export class AssetListView {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.collapsedFolders = new Set();
        this.onFolderDelete = null; // Callback for assets.js to handle full page updates
    }

    refresh() {
        if (!this.container) return;
        this.container.innerHTML = '';

        const assets = assetManager.getAssets();
        const tree = { __files: [], __folders: {} };

        assets.forEach(asset => {
            const parts = (asset.path || asset.name).split('/');
            let current = tree;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current.__folders[part]) current.__folders[part] = { __files: [], __folders: {} };
                current = current.__folders[part];
            }
            const fileName = parts[parts.length - 1];
            current.__files.push({ name: fileName, asset });
        });

        const fragment = document.createDocumentFragment();
        this.renderNode(tree, fragment);
        this.container.appendChild(fragment);
    }

    renderNode(node, fragment, currentPath = '', level = 0) {
        Object.keys(node.__folders).sort().forEach(folderName => {
            const fullPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            const isCollapsed = this.collapsedFolders.has(fullPath);

            const folderEl = document.createElement('div');
            folderEl.className = 'list-item is-folder';
            folderEl.style.setProperty('--level', level);
            folderEl.dataset.path = fullPath;

            folderEl.innerHTML = `
                <span class="list-icon">
                    <svg class="folder-caret ${isCollapsed ? '' : 'expanded'}" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M3 2L7 5L3 8V2Z" />
                    </svg>
                    📁
                </span>
                <span class="list-text" title="${fullPath}">${folderName}</span>
                <div class="list-actions">
                     <button class="asset-action-btn folder-remove" data-path="${fullPath}" title="Delete Folder">
                        <img src="assets/icons/delete.svg" class="icon-svg" />
                    </button>
                </div>
            `;

            folderEl.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.folder-remove');
                if (deleteBtn) {
                    this.handleDeleteFolder(fullPath);
                    return;
                }

                if (this.collapsedFolders.has(fullPath)) {
                    this.collapsedFolders.delete(fullPath);
                } else {
                    this.collapsedFolders.add(fullPath);
                }
                this.refresh();
            });

            fragment.appendChild(folderEl);
            if (!isCollapsed) {
                this.renderNode(node.__folders[folderName], fragment, fullPath, level + 1);
            }
        });

        node.__files.sort((a, b) => a.name.localeCompare(b.name)).forEach(({ name, asset }) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'list-item is-file';
            fileEl.style.setProperty('--level', level);
            const icon = asset.type === 'text' ? '📄' : '🖼️';

            fileEl.innerHTML = `
                <span class="list-icon">${icon}</span>
                <span class="list-text" title="${name}">${name}</span>
                <button class="asset-action-btn remove small" data-id="${asset.id}" title="Remove">
                    <span class="icon icon-delete"></span>
                </button>
            `;

            fileEl.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.remove')) return;
                if (e.button !== 0 && e.pointerType === 'mouse') return;
                dragDropService.startDrag({
                    asset: asset.type === 'image' ? asset : undefined,
                    text: asset.type === 'text' ? asset.fullResData : undefined
                }, e);
            });

            fragment.appendChild(fileEl);
        });
    }

    async handleDeleteFolder(path) {
        const assets = assetManager.getAssets().filter(a => (a.path || a.name).startsWith(path));
        const count = assets.length;

        const confirmed = await showConfirm(
            `Delete folder "${path}" and all ${count} assets inside? This cannot be undone.`,
            "Delete Folder",
            "Delete",
            "delete-folder"
        );

        if (confirmed) {
            assetManager.removeAssetsByPathPrefix(path);
            if (this.onFolderDelete) this.onFolderDelete(assets.map(a => a.id));
        }
    }
}
