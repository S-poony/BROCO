import { saveState } from './history.js';
import { state, getCurrentPage } from './state.js';
import { findNodeById } from './layout.js';
import { renderLayout } from './renderer.js';
import { A4_PAPER_ID } from './constants.js';
import { showConfirm, showAlert } from './utils.js';
import { assetManager } from './AssetManager.js';
import { dragDropService } from './DragDropService.js';

// Backward compatibility for importedAssets
export const importedAssets = assetManager.assets;

// State for view mode
let currentViewMode = 'grid'; // 'grid' | 'list'
let collapsedFolders = new Set(); // Stores paths of collapsed folders
let listIsDirty = false;
let lazyObserver = null;

export function setupAssetHandlers() {
    const importBtn = document.getElementById('import-assets-btn');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewListBtn = document.getElementById('view-list-btn');

    if (!importBtn) return;

    // File Input for Web fallback
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,text/*,.md,.txt';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // -- Event Listeners --

    importBtn.addEventListener('click', async () => {
        if (window.electronAPI?.openAssets) {
            // Electron Smart Picker: Returns array of { name, path, type, data }
            const results = await window.electronAPI.openAssets();
            if (results && results.length > 0) {
                processItems(results);
            }
        } else {
            fileInput.click();
        }
    });

    // Unified File Processor
    const processItems = async (items) => {
        if (!items || items.length === 0) return;

        const importStatus = document.getElementById('import-status');
        const progressBar = importStatus?.querySelector('.progress-bar');
        const statusText = importStatus?.querySelector('.status-text');

        if (importStatus) {
            importStatus.classList.remove('hidden');
            progressBar.style.width = '0%';
            statusText.textContent = `Processing...`;
        }

        let processedCount = 0;
        let totalCount = items.length;

        const syncUpdate = () => {
            if (!importStatus) return;
            const pct = Math.min(100, (processedCount / totalCount) * 100);
            progressBar.style.width = `${pct}%`;
            statusText.textContent = `${processedCount} / ${totalCount}`;
        };

        // Handle Electron raw data results (FAST path)
        if (Array.isArray(items) && items.length > 0 && items[0].data) {
            // Process in small micro-batches to let UI re-render "Importing..."
            const batchSize = 25;
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);
                batch.forEach(item => {
                    const asset = {
                        id: crypto.randomUUID(),
                        name: item.name,
                        lowResData: item.type === 'image' ? item.data : null,
                        fullResData: item.data,
                        path: item.path,
                        type: item.type
                    };
                    assetManager.addAsset(asset);
                    processedCount++;
                });
                syncUpdate();
                // Yield very briefly to update UI without slowing down much
                if (i + batchSize < items.length) await new Promise(r => setTimeout(r, 1));
            }

            finishImport();
            return;
        }

        // Web/Drop Path (Slower, requires processing)
        totalCount = items.length; // Baseline, increases with folders

        const finalizeAsset = (asset, tempId) => {
            const skeleton = document.querySelector(`.asset-item.skeleton[data-temp-id="${tempId}"]`);
            if (skeleton) skeleton.remove();
            assetManager.addAsset(asset);
            processedCount++;
            syncUpdate();
        };

        const addSkeleton = () => {
            const tempId = crypto.randomUUID();
            const container = document.getElementById('asset-grid-view');
            if (container && currentViewMode === 'grid') {
                const skel = document.createElement('div');
                skel.className = 'asset-item skeleton';
                skel.dataset.tempId = tempId;
                container.appendChild(skel);
            }
            return tempId;
        };

        const traverseAndProcess = async (entry, path = '') => {
            if (entry.isFile) {
                return new Promise(resolve => {
                    entry.file(async (file) => {
                        const tempId = addSkeleton();
                        try {
                            const asset = await assetManager.processFile(file, path ? `${path}/${file.name}` : file.name);
                            finalizeAsset(asset, tempId);
                        } catch (e) {
                            document.querySelector(`[data-temp-id="${tempId}"]`)?.remove();
                        }
                        resolve();
                    });
                });
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                const entries = await new Promise(resolve => reader.readEntries(resolve));
                totalCount += entries.length;
                syncUpdate();
                for (const sub of entries) {
                    await traverseAndProcess(sub, path ? `${path}/${entry.name}` : entry.name);
                }
            }
        };

        const promises = [];
        for (const item of items) {
            if (item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    promises.push(traverseAndProcess(entry));
                    continue;
                }
            }
            const file = item instanceof File ? item : item.getAsFile ? item.getAsFile() : null;
            if (file) {
                const tempId = addSkeleton();
                promises.push((async () => {
                    try {
                        const asset = await assetManager.processFile(file, file.webkitRelativePath || file.name);
                        finalizeAsset(asset, tempId);
                    } catch (e) {
                        document.querySelector(`[data-temp-id="${tempId}"]`)?.remove();
                    }
                })());
            }
        }
        await Promise.all(promises);
        finishImport();

        function finishImport() {
            if (importStatus) {
                progressBar.style.width = '100%';
                setTimeout(() => importStatus.classList.add('hidden'), 500);
            }
        }
    };




    fileInput.addEventListener('change', (e) => processItems(e.target.files));

    // View Toggles
    viewGridBtn?.addEventListener('click', () => setViewMode('grid'));
    viewListBtn?.addEventListener('click', () => setViewMode('list'));

    function setViewMode(mode) {
        if (currentViewMode === mode) return;
        currentViewMode = mode;

        const gridContainer = document.getElementById('asset-grid-view');
        const listContainer = document.getElementById('asset-list-view');

        if (mode === 'grid') {
            gridContainer.classList.remove('hidden');
            listContainer.classList.add('hidden');
        } else {
            gridContainer.classList.add('hidden');
            listContainer.classList.remove('hidden');
            if (listIsDirty) {
                renderListView();
            }
        }

        viewGridBtn.classList.toggle('active', mode === 'grid');
        viewListBtn.classList.toggle('active', mode === 'list');
    }

    // Asset change listeners
    assetManager.addEventListener('assets:changed', (e) => {
        const { type, asset } = e.detail;
        if (type === 'added') {
            appendAssetToGrid(asset);
            listIsDirty = true;
            throttleListUpdate();
        } else {
            refreshAllViews();
        }
    });

    setupDropHandlersForList(processItems);

    lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                hydrateAssetItem(entry.target);
                lazyObserver.unobserve(entry.target);
            }
        });
    }, { rootMargin: '300px' });

    refreshAllViews();
}

let listThrottleTimer = null;
function throttleListUpdate() {
    if (listThrottleTimer) return;
    listThrottleTimer = setTimeout(() => {
        if (currentViewMode === 'list' && listIsDirty) {
            renderListView();
        }
        listThrottleTimer = null;
    }, 500);
}

function refreshAllViews() {
    const gridContainer = document.getElementById('asset-grid-view');
    if (gridContainer) {
        gridContainer.innerHTML = '';
        assetManager.getAssets().forEach(appendAssetToGrid);
    }
    renderListView();
}

function hydrateAssetItem(element) {
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
        const img = document.createElement('img');
        img.src = asset.lowResData;
        img.alt = asset.name;
        img.loading = 'lazy';
        element.appendChild(img);
    }

    const actions = document.createElement('div');
    actions.className = 'asset-actions';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'asset-action-btn remove';
    removeBtn.title = 'Remove asset';
    removeBtn.dataset.id = asset.id;
    removeBtn.innerHTML = '<span class="icon icon-delete"></span>';
    actions.appendChild(removeBtn);
    element.appendChild(actions);
}

function appendAssetToGrid(asset) {
    const container = document.getElementById('asset-grid-view');
    if (!container) return;

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

    container.appendChild(item);
    if (lazyObserver) {
        lazyObserver.observe(item);
    } else {
        // Fallback if observer not ready
        hydrateAssetItem(item);
    }
}

function renderListView() {
    const container = document.getElementById('asset-list-view');
    if (!container) return;

    container.innerHTML = '';
    listIsDirty = false;

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
    function traverse(node, currentPath = '', level = 0) {
        Object.keys(node.__folders).sort().forEach(folderName => {
            const fullPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            const isCollapsed = collapsedFolders.has(fullPath);
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
            `;
            fragment.appendChild(folderEl);
            if (!isCollapsed) traverse(node.__folders[folderName], fullPath, level + 1);
        });

        node.__files.sort((a, b) => a.name.localeCompare(b.name)).forEach(({ name, asset }) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'list-item is-file';
            fileEl.style.setProperty('--level', level);
            const icon = asset.type === 'text' ? '📄' : '🖼️';
            fileEl.innerHTML = `
                <span class="list-icon">${icon}</span>
                <span class="list-text" title="${name}">${name}</span>
                <button class="asset-action-btn remove small" data-id="${asset.id}" title="Remove" style="margin-left: auto;">
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
    traverse(tree);
    container.appendChild(fragment);
}

function setupDropHandlersForList(importHandler) {
    const containers = [
        document.getElementById('asset-grid-view'),
        document.getElementById('asset-list-view')
    ];

    containers.forEach(container => {
        if (!container) return;

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (dragDropService.sourceRect) {
                e.dataTransfer.dropEffect = 'move';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }
            container.classList.add('drag-over');
        });

        container.addEventListener('dragleave', () => {
            container.classList.remove('drag-over');
        });

        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            container.classList.remove('drag-over');

            if (dragDropService.sourceRect) {
                const { asset, text, sourceRect } = dragDropService.endDrag();
                saveState();
                const sourceNode = findNodeById(getCurrentPage(), sourceRect.id);
                if (sourceNode) {
                    if (asset) sourceNode.image = null;
                    if (text !== undefined) sourceNode.text = null;
                }
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            } else if (e.dataTransfer.items) {
                await importHandler(e.dataTransfer.items);
            }
        });

        container.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove');
            if (removeBtn) {
                const assetId = removeBtn.dataset.id;
                removeAsset(assetId);
                return;
            }
            const folderHeader = e.target.closest('.list-item.is-folder');
            if (folderHeader) {
                const path = folderHeader.dataset.path;
                if (collapsedFolders.has(path)) {
                    collapsedFolders.delete(path);
                } else {
                    collapsedFolders.add(path);
                }
                renderListView();
            }
        });
    });
}

function updateDragFeedback(target) {
    document.querySelectorAll('.splittable-rect').forEach(el => el.classList.remove('touch-drag-over'));
    document.getElementById('asset-grid-view')?.classList.remove('touch-drag-over');
    document.getElementById('asset-list-view')?.classList.remove('touch-drag-over');

    const targetElement = target?.closest('.splittable-rect');
    const targetAssetView = target?.closest('#asset-grid-view') || target?.closest('#asset-list-view');

    if (targetAssetView && dragDropService.sourceRect) {
        targetAssetView.classList.add('touch-drag-over');
    } else if (targetElement) {
        const node = findNodeById(getCurrentPage(), targetElement.id);
        if (node && node.splitState === 'unsplit') {
            targetElement.classList.add('touch-drag-over');
        }
    }
}

function handleDropLogic(target) {
    const targetElement = target?.closest('.splittable-rect');
    const targetAssetView = target?.closest('#asset-grid-view') || target?.closest('#asset-list-view');

    const dragData = {
        asset: dragDropService.draggedAsset,
        text: dragDropService.draggedText,
        sourceRect: dragDropService.sourceRect,
        sourceTextNode: dragDropService.sourceTextNode
    };

    if (targetAssetView && dragData.sourceRect) {
        saveState();
        const sourceNode = findNodeById(getCurrentPage(), dragData.sourceRect.id);
        if (sourceNode) {
            if (dragData.asset) sourceNode.image = null;
            if (dragData.text !== undefined) {
                sourceNode.text = null;
                sourceNode.textAlign = null;
            }
        }
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    } else if (targetElement) {
        const targetNode = findNodeById(getCurrentPage(), targetElement.id);
        if (targetNode && targetNode.splitState === 'unsplit') {
            const sourceRect = dragDropService.sourceRect;
            const sourceNode = sourceRect ? findNodeById(getCurrentPage(), sourceRect.id) : null;

            saveState();

            if (sourceNode) {
                // SWAP logic when dragging between rectangles
                const sourceImage = sourceNode.image ? { ...sourceNode.image } : null;
                const sourceText = sourceNode.text;
                const sourceTextAlign = sourceNode.textAlign;

                const targetImage = targetNode.image ? { ...targetNode.image } : null;
                const targetText = targetNode.text;
                const targetTextAlign = targetNode.textAlign;

                // Set target to source's old content
                targetNode.image = sourceImage;
                targetNode.text = sourceText;
                targetNode.textAlign = sourceTextAlign;

                // Set source to target's old content
                sourceNode.image = targetImage;
                sourceNode.text = targetText;
                sourceNode.textAlign = targetTextAlign;
            } else {
                // OVERWRITE logic when dragging from sidebar
                if (dragData.asset) {
                    targetNode.image = {
                        assetId: dragData.asset.id,
                        fit: 'cover'
                    };
                    targetNode.text = null;
                } else if (dragData.text !== undefined) {
                    targetNode.text = dragData.text;
                    targetNode.textAlign = dragData.textAlign;
                    targetNode.image = null;
                }
            }

            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        }
    }
}

// Proxies for unified API
export function handleTouchStart(e, dragData) {
    dragDropService.startTouchDrag(e, dragData);
}

export function handleTouchMove(e) {
    const result = dragDropService.handleTouchMove(e);
    if (result) updateDragFeedback(result.target);
}

export function handleTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0] : null;
    if (touch) {
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        handleDropLogic(target);
    }
    dragDropService.endDrag();
}

export async function removeAsset(assetId) {
    const confirmed = await showConfirm('Are you sure you want to remove this asset? All instances in the layout will be deleted.', 'Are you sure?', 'Confirm', 'remove-asset');
    if (!confirmed) return;

    saveState();
    assetManager.removeAsset(assetId);

    // Remove from all pages
    state.pages.forEach(pageRoot => {
        clearAssetFromLayout(pageRoot, assetId);
    });

    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

function clearAssetFromLayout(node, assetId) {
    if (node.image && node.image.assetId === assetId) {
        node.image = null;
    }
    if (node.children) {
        node.children.forEach(child => clearAssetFromLayout(child, assetId));
    }
}

export async function replaceAsset(assetId) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const newAssetData = await assetManager.processFile(file);
            saveState();
            assetManager.updateAsset(assetId, {
                ...newAssetData,
                id: assetId // Preserve original ID
            });

            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        } catch (err) {
            console.error('Replacement failed:', err);
            showAlert(`Replacement failed: ${err.message}`, 'Replace Error');
        }
    };

    fileInput.click();
}

export async function importImageToNode(nodeId) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
            document.body.removeChild(fileInput);
            return;
        }

        try {
            const asset = await assetManager.processFile(file);
            assetManager.addAsset(asset);

            saveState();
            const pageRoot = getCurrentPage();
            const node = findNodeById(pageRoot, nodeId);
            if (node) {
                node.image = {
                    assetId: asset.id,
                    fit: 'cover'
                };
                node.text = null;

                renderLayout(document.getElementById(A4_PAPER_ID), pageRoot);
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
        } catch (err) {
            console.error('Import failed:', err);
            showAlert(`Import failed: ${err.message}`, 'Import Error');
        } finally {
            document.body.removeChild(fileInput);
        }
    };

    fileInput.click();
}

export function attachImageDragHandlers(img, asset, hostRectElement) {
    img.draggable = false;
    img.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        dragDropService.startDrag({ asset, sourceRect: hostRectElement }, e);
    });
}

export function setupDropHandlers() {
    const paper = document.getElementById(A4_PAPER_ID);
    if (!paper) return;

    // Handle custom drops (mouse)
    document.addEventListener('custom-drop', (e) => {
        handleDropLogic(e.detail.target);
    });

    // Handle custom drag moves for feedback (mouse/touch)
    document.addEventListener('custom-drag-move', (e) => {
        updateDragFeedback(e.detail.target);
    });

    paper.addEventListener('dragover', (e) => {
        // Native dragover still useful for traditional file imports if needed, 
        // but for internal drags we use our service.
        const targetElement = e.target.closest('.splittable-rect');
        if (targetElement) {
            const node = findNodeById(getCurrentPage(), targetElement.id);
            if (node && node.splitState === 'unsplit') {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        }
    });

    paper.addEventListener('drop', (e) => {
        const targetElement = e.target.closest('.splittable-rect');
        if (targetElement) {
            e.preventDefault();
            handleDropLogic(targetElement);
        }
        dragDropService.endDrag();
    });
}
