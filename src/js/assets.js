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

export function setupAssetHandlers() {
    const importBtn = document.getElementById('import-assets-btn');
    if (!importBtn) return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    importBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            try {
                const asset = await assetManager.processFile(file);
                assetManager.addAsset(asset);
            } catch (err) {
                console.error(`Failed to process ${file.name}:`, err);
                showAlert(`Failed to process ${file.name}: ${err.message}`, 'Import Error');
            }
        }
        fileInput.value = ''; // Reset for next import
    });

    // Listen for asset changes to re-render
    assetManager.addEventListener('assets:changed', () => {
        renderAssetList();
    });

    // Handle dropping layout images/text back to asset list to delete them
    const assetList = document.getElementById('asset-list');
    assetList.addEventListener('dragover', (e) => {
        if (dragDropService.sourceRect) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            assetList.classList.add('drag-over');
        }
    });

    assetList.addEventListener('dragleave', () => {
        assetList.classList.remove('drag-over');
    });

    assetList.addEventListener('drop', (e) => {
        assetList.classList.remove('drag-over');
        if (dragDropService.sourceRect) {
            e.preventDefault();
            const { asset, text, sourceRect } = dragDropService.endDrag();

            saveState();
            const sourceNode = findNodeById(getCurrentPage(), sourceRect.id);
            if (sourceNode) {
                if (asset) sourceNode.image = null;
                if (text !== undefined) sourceNode.text = null;
            }

            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        }
    });

    // Event delegation for asset list actions
    assetList.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove');
        if (removeBtn) {
            const assetId = removeBtn.closest('.asset-item').dataset.id;
            removeAsset(assetId);
            return;
        }

        const replaceBtn = e.target.closest('.replace');
        if (replaceBtn) {
            const assetId = replaceBtn.closest('.asset-item').dataset.id;
            replaceAsset(assetId);
            return;
        }
    });
}

function renderAssetList() {
    const assetList = document.getElementById('asset-list');
    if (!assetList) return;

    assetList.innerHTML = '';
    assetManager.getAssets().forEach(asset => {
        const item = document.createElement('div');
        item.className = 'asset-item';
        item.draggable = false;
        item.dataset.id = asset.id;

        // Use safe textContent and explicit attribute setting for XSS prevention
        const img = document.createElement('img');
        img.src = asset.lowResData;
        img.alt = asset.name;
        img.title = asset.name;
        item.appendChild(img);

        const actions = document.createElement('div');
        actions.className = 'asset-actions';

        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'asset-action-btn replace';
        replaceBtn.title = 'Replace asset';
        replaceBtn.innerHTML = '<span class="icon icon-replace"></span>';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'asset-action-btn remove';
        removeBtn.title = 'Remove asset';
        removeBtn.innerHTML = '<span class="icon icon-delete"></span>';

        actions.appendChild(replaceBtn);
        actions.appendChild(removeBtn);
        item.appendChild(actions);

        item.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            dragDropService.startDrag({ asset }, e);
        });

        assetList.appendChild(item);
    });
}

function updateDragFeedback(target) {
    // Remove highlight from all rects and sidebar
    document.querySelectorAll('.splittable-rect').forEach(el => el.classList.remove('touch-drag-over'));
    document.getElementById('asset-list')?.classList.remove('touch-drag-over');

    const targetElement = target?.closest('.splittable-rect');
    const targetAssetList = target?.closest('#asset-list');

    if (targetAssetList && dragDropService.sourceRect) {
        targetAssetList.classList.add('touch-drag-over');
    } else if (targetElement) {
        const node = findNodeById(getCurrentPage(), targetElement.id);
        if (node && node.splitState === 'unsplit') {
            targetElement.classList.add('touch-drag-over');
        }
    }
}

function handleDropLogic(target) {
    const targetElement = target?.closest('.splittable-rect');
    const targetAssetList = target?.closest('#asset-list');

    const dragData = {
        asset: dragDropService.draggedAsset,
        text: dragDropService.draggedText,
        sourceRect: dragDropService.sourceRect,
        sourceTextNode: dragDropService.sourceTextNode
    };

    if (targetAssetList && dragData.sourceRect) {
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
