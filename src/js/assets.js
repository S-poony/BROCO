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
        item.draggable = true;
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
        replaceBtn.textContent = '🔄';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'asset-action-btn remove';
        removeBtn.title = 'Remove asset';
        removeBtn.textContent = '×';

        actions.appendChild(replaceBtn);
        actions.appendChild(removeBtn);
        item.appendChild(actions);

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', asset.id);
            dragDropService.startDrag({ asset });
        });

        item.addEventListener('dragend', () => {
            dragDropService.endDrag();
        });

        // Touch support using service
        item.addEventListener('touchstart', (e) => {
            dragDropService.startTouchDrag(e, { asset });
        }, { passive: false });

        item.addEventListener('touchmove', (e) => {
            const result = dragDropService.handleTouchMove(e);
            if (!result) return;

            updateDragFeedback(result.target);
        }, { passive: false });

        item.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            handleDropLogic(target);
            dragDropService.endDrag();
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
            // Block image drops on text rectangles and vice versa
            if (dragDropService.draggedAsset && node.text) return;
            if (dragDropService.draggedText !== undefined && node.image) return;

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
            if (dragData.text !== undefined) sourceNode.text = null;
        }
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    } else if (targetElement) {
        const targetNode = findNodeById(getCurrentPage(), targetElement.id);
        if (targetNode && targetNode.splitState === 'unsplit') {
            // Handle text drop
            if (dragData.text !== undefined && !targetNode.image) {
                saveState();
                if (dragData.sourceTextNode) {
                    dragData.sourceTextNode.text = null;
                }
                targetNode.text = dragData.text;
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
            // Handle image drop
            else if (dragData.asset && !targetNode.text) {
                saveState();
                let fit = 'cover';
                if (dragData.sourceRect) {
                    const sourceNode = findNodeById(getCurrentPage(), dragData.sourceRect.id);
                    if (sourceNode && sourceNode.image) {
                        fit = sourceNode.image.fit;
                        sourceNode.image = null;
                    }
                }
                targetNode.image = {
                    assetId: dragData.asset.id,
                    fit: fit
                };
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
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
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    handleDropLogic(target);
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

export function attachImageDragHandlers(img, asset, hostRectElement) {
    img.draggable = true;
    img.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', asset.id);
        dragDropService.startDrag({ asset, sourceRect: hostRectElement });
    });

    img.addEventListener('dragend', () => {
        dragDropService.endDrag();
    });

    // Touch support
    img.addEventListener('touchstart', (e) => {
        dragDropService.startTouchDrag(e, { asset, sourceRect: hostRectElement });
    }, { passive: false });

    img.addEventListener('touchmove', handleTouchMove, { passive: false });
    img.addEventListener('touchend', handleTouchEnd);
}

export function setupDropHandlers() {
    const paper = document.getElementById(A4_PAPER_ID);
    if (!paper) return;

    paper.addEventListener('dragover', (e) => {
        const targetElement = e.target.closest('.splittable-rect');
        if (targetElement) {
            const node = findNodeById(getCurrentPage(), targetElement.id);
            if (node && node.splitState === 'unsplit') {
                // Block image drops on text rectangles
                if (dragDropService.draggedAsset && node.text) {
                    e.dataTransfer.dropEffect = 'none';
                    return;
                }
                // Block text drops on image rectangles
                if (dragDropService.draggedText !== undefined && node.image) {
                    e.dataTransfer.dropEffect = 'none';
                    return;
                }
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
