import { saveState } from '../io/history.js';
import { state, getCurrentPage } from '../core/state.js';
import { findNodeById, renderAndRestoreFocus } from '../layout/layout.js';
import { A4_PAPER_ID } from '../core/constants.js';
import { showConfirm, showAlert } from '../core/utils.js';
import { toast } from '../core/errorHandler.js';
import { assetManager } from './AssetManager.js';
import { dragDropService } from '../ui/DragDropService.js';
import { AssetGridView } from './AssetGridView.js';
import { AssetListView } from './AssetListView.js';

// Backward compatibility for importedAssets
export const importedAssets = assetManager.assets;

// State for view mode
let currentViewMode = 'grid'; // 'grid' | 'list'
let gridView = null;
let listView = null;

export function setupAssetHandlers() {
    const importBtn = document.getElementById('import-assets-btn');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewListBtn = document.getElementById('view-list-btn');

    if (!importBtn) return;

    gridView = new AssetGridView('asset-grid-view');
    listView = new AssetListView('asset-list-view');

    // Wire up folder deletion to also clean paper layout
    listView.onFolderDelete = (assetIds) => {
        saveState();
        assetIds.forEach(id => {
            state.pages.forEach(p => clearAssetFromLayout(p, id));
        });
        renderAndRestoreFocus(getCurrentPage());
        refreshAllViews();
    };

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
            const results = await window.electronAPI.openAssets({ directory: false });
            if (results && results.length > 0) {
                processItems(results);
            }
        } else {
            fileInput.click();
        }
    });

    // Global Shortcut for Electron Folder Import (Ctrl+I)
    if (window.electronAPI?.openAssets) {
        document.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
                // GUARD: Allow default behavior (italics) if editing text
                const active = document.activeElement;
                const isEditing = active && (
                    active.tagName === 'INPUT' ||
                    active.tagName === 'TEXTAREA' ||
                    active.isContentEditable
                );

                if (isEditing) return;

                e.preventDefault();
                const results = await window.electronAPI.openAssets({ directory: true });
                if (results && results.length > 0) {
                    processItems(results);
                }
            }
        });
    }

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
            const batchSize = 10; // Reduced batch size since resizing takes CPU
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);

                // Process batch in parallel
                await Promise.all(batch.map(async (item) => {
                    try {
                        const asset = await assetManager.processRawImage(
                            item.name,
                            item.data,
                            item.type,
                            item.path,
                            item.absolutePath
                        );
                        assetManager.addAsset(asset);
                    } catch (err) {
                        console.error(`Failed to process ${item.name}:`, err);
                    } finally {
                        processedCount++;
                    }
                }));

                syncUpdate();
                // Yield explicitly to UI
                if (i + batchSize < items.length) await new Promise(r => setTimeout(r, 10));
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
        const gridCont = document.getElementById('asset-grid-view');
        const listCont = document.getElementById('asset-list-view');
        if (mode === 'grid') {
            gridCont.classList.remove('hidden');
            listCont.classList.add('hidden');
        } else {
            gridCont.classList.add('hidden');
            listCont.classList.remove('hidden');
        }
        viewGridBtn.classList.toggle('active', mode === 'grid');
        viewListBtn.classList.toggle('active', mode === 'list');
        refreshAllViews();
    }

    assetManager.addEventListener('assets:changed', (e) => {
        const { type, asset } = e.detail;
        if (type === 'added') {
            gridView.appendAsset(asset);
            listView.refresh();
        } else {
            refreshAllViews();
            if (type === 'updated') {
                if (document.getElementById(A4_PAPER_ID)) {
                    renderAndRestoreFocus(getCurrentPage());
                }
            }
        }
    });

    setupDropHandlersForList(processItems);
    refreshAllViews();

    // Handle "Replace" clicks from the layout (broken placeholders)
    document.addEventListener('click', (e) => {
        const replaceBtn = e.target.closest('.replace-broken-btn');
        if (replaceBtn) {
            const assetId = replaceBtn.dataset.id;
            replaceAsset(assetId);
        }
    });
}

function refreshAllViews() {
    gridView?.refresh();
    listView?.refresh();
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
                renderAndRestoreFocus(getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            } else if (e.dataTransfer.items) {
                await importHandler(e.dataTransfer.items);
            }
        });

        container.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove');
            const replaceBtn = e.target.closest('.replace');

            if (removeBtn) {
                const assetId = removeBtn.dataset.id;
                removeAsset(assetId);
            } else if (replaceBtn) {
                const assetId = replaceBtn.dataset.id;
                import('./assets.js').then(m => m.replaceAsset(assetId));
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
        renderAndRestoreFocus(getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    } else if (targetElement) {
        const targetNode = findNodeById(getCurrentPage(), targetElement.id);
        if (targetNode && targetNode.splitState === 'unsplit') {
            const sourceRect = dragDropService.sourceRect;
            const sourceNode = sourceRect ? findNodeById(getCurrentPage(), sourceRect.id) : null;

            saveState();

            if (sourceNode) {
                // SWAP logic when dragging between rectangles
                import('../layout/layout.js').then(m => {
                    m.swapNodesContent(sourceNode, targetNode);
                    renderAndRestoreFocus(getCurrentPage());
                    document.dispatchEvent(new CustomEvent('layoutUpdated'));
                });
                return; // async handling above
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

            renderAndRestoreFocus(getCurrentPage());
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

    renderAndRestoreFocus(getCurrentPage());
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
    const handleResult = async (item) => {
        try {
            const asset = await assetManager.processRawImage(
                item.name,
                item.data,
                item.type,
                item.path,
                item.absolutePath
            );

            saveState();
            assetManager.updateAsset(assetId, {
                ...asset,
                id: assetId // Preserve original ID
            });

            renderAndRestoreFocus(getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        } catch (err) {
            console.error('Replacement failed:', err);
            toast.error(`Replacement failed: ${err.message}`);
        }
    };

    if (window.electronAPI?.openAssets) {
        // Electron path
        const results = await window.electronAPI.openAssets({ directory: false });
        if (results && results.length > 0) {
            await handleResult(results[0]);
        }
    } else {
        // Web fallback
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';

        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const asset = await assetManager.processFile(file, file.name);
                saveState();
                assetManager.updateAsset(assetId, {
                    ...asset,
                    id: assetId
                });

                renderAndRestoreFocus(getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            } catch (err) {
                console.error('Replacement failed:', err);
                toast.error(`Replacement failed: ${err.message}`);
            }
        };

        fileInput.click();
    }
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

                renderAndRestoreFocus(pageRoot, nodeId);
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
        } catch (err) {
            console.error('Import failed:', err);
            toast.error(`Import failed: ${err.message}`);
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
