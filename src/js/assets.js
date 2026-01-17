import { saveState } from './history.js';
import { state, getCurrentPage } from './state.js';
import { findNodeById } from './layout.js';
import { renderLayout } from './renderer.js';
import { A4_PAPER_ID } from './constants.js';

export let importedAssets = []; // This will act as our asset registry

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
            const asset = await processFile(file);
            if (asset) {
                importedAssets.push(asset);
            }
        }
        renderAssetList();
        fileInput.value = ''; // Reset for next import
    });

    // Handle dropping layout images/text back to asset list to delete them
    const assetList = document.getElementById('asset-list');
    assetList.addEventListener('dragover', (e) => {
        if (window._sourceRect) {
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
        if (window._sourceRect) {
            e.preventDefault();
            saveState();

            const sourceNode = findNodeById(getCurrentPage(), window._sourceRect.id);
            if (sourceNode) {
                if (window._draggedAsset) sourceNode.image = null;
                if (window._draggedText !== undefined) sourceNode.text = null;
            }

            window._draggedAsset = null;
            window._draggedText = undefined;
            window._sourceRect = null;
            window._sourceTextNode = null;

            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        }
    });
}

async function processFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const fullResData = e.target.result;
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxDim = 800;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDim) {
                        height *= maxDim / width;
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width *= maxDim / height;
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const lowResData = canvas.toDataURL('image/jpeg', 0.6);

                resolve({
                    id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: file.name,
                    lowResData: lowResData,
                    fullResData: fullResData
                });
            };
            img.src = fullResData;
        };
        reader.readAsDataURL(file);
    });
}

function renderAssetList() {
    const assetList = document.getElementById('asset-list');
    if (!assetList) return;

    assetList.innerHTML = '';
    importedAssets.forEach(asset => {
        const item = document.createElement('div');
        item.className = 'asset-item';
        item.draggable = true;
        item.innerHTML = `
            <img src="${asset.lowResData}" alt="${asset.name}" title="${asset.name}">
            <div class="asset-actions">
                <button class="asset-action-btn replace" title="Replace asset">🔄</button>
                <button class="asset-action-btn remove" title="Remove asset">×</button>
            </div>
        `;

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', asset.id);
            window._draggedAsset = asset;
            window._sourceRect = null;
        });

        // Touch support for mobile dragging
        item.addEventListener('touchstart', (e) => handleTouchStart(e, { asset }), { passive: false });
        item.addEventListener('touchmove', handleTouchMove, { passive: false });
        item.addEventListener('touchend', handleTouchEnd);

        const removeBtn = item.querySelector('.remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeAsset(asset.id);
        });

        const replaceBtn = item.querySelector('.replace');
        replaceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            replaceAsset(asset.id);
        });

        assetList.appendChild(item);
    });
}

export function handleTouchStart(e, dragData) {
    const { asset, text, sourceRect, sourceTextNode } = dragData;

    window._draggedAsset = asset || null;
    window._draggedText = text !== undefined ? text : undefined;
    window._sourceRect = sourceRect || null;
    window._sourceTextNode = sourceTextNode || null;

    // Create ghost element for visual feedback
    const ghost = document.createElement('div');
    ghost.id = 'drag-ghost';
    ghost.style.position = 'fixed';
    ghost.style.width = '60px';
    ghost.style.height = '60px';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10000';
    ghost.style.opacity = '0.8';
    ghost.style.borderRadius = '8px';
    ghost.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
    ghost.style.border = '2px solid #4f46e5';
    ghost.style.display = 'flex';
    ghost.style.alignItems = 'center';
    ghost.style.justifyContent = 'center';
    ghost.style.backgroundColor = 'white';

    if (asset) {
        const img = document.createElement('img');
        img.src = asset.lowResData;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '6px';
        ghost.appendChild(img);
    } else if (text !== undefined) {
        ghost.innerHTML = '📝';
        ghost.style.fontSize = '24px';
    }

    const touch = e.touches[0];
    ghost.style.left = `${touch.clientX - 30}px`;
    ghost.style.top = `${touch.clientY - 30}px`;

    document.body.appendChild(ghost);
    window._touchGhost = ghost;

    if (sourceRect) {
        sourceRect.classList.add(asset ? 'moving-image' : 'moving-text');
    }
}

export function handleTouchMove(e) {
    if ((!window._draggedAsset && window._draggedText === undefined) || !window._touchGhost) return;
    // Prevent scrolling while dragging
    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    window._touchGhost.style.left = `${touch.clientX - 30}px`;
    window._touchGhost.style.top = `${touch.clientY - 30}px`;

    // Visual feedback for potential drop target
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetElement = target?.closest('.splittable-rect');
    const targetAssetList = target?.closest('#asset-list');

    // Remove highlight from all rects and sidebar
    document.querySelectorAll('.splittable-rect').forEach(el => el.classList.remove('touch-drag-over'));
    document.getElementById('asset-list')?.classList.remove('touch-drag-over');

    if (targetAssetList && window._sourceRect) {
        targetAssetList.classList.add('touch-drag-over');
    } else if (targetElement) {
        const node = findNodeById(getCurrentPage(), targetElement.id);
        if (node && node.splitState === 'unsplit') {
            // Block image drops on text rectangles and vice versa
            if (window._draggedAsset && node.text) return;
            if (window._draggedText !== undefined && node.image) return;

            targetElement.classList.add('touch-drag-over');
        }
    }
}

export function handleTouchEnd(e) {
    if (!window._draggedAsset && window._draggedText === undefined) return;

    const touch = e.changedTouches[0];
    if (window._touchGhost) {
        window._touchGhost.remove();
        window._touchGhost = null;
    }

    // Remove feedback highlighting
    document.querySelectorAll('.splittable-rect').forEach(el => el.classList.remove('touch-drag-over'));
    document.getElementById('asset-list')?.classList.remove('touch-drag-over');

    if (window._sourceRect) {
        window._sourceRect.classList.remove('moving-image', 'moving-text');
    }

    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetElement = target?.closest('.splittable-rect');
    const targetAssetList = target?.closest('#asset-list');

    if (targetAssetList && window._sourceRect) {
        // Drop back to sidebar = delete instance
        saveState();
        const sourceNode = findNodeById(getCurrentPage(), window._sourceRect.id);
        if (sourceNode) {
            if (window._draggedAsset) sourceNode.image = null;
            if (window._draggedText !== undefined) sourceNode.text = null;
        }
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    } else if (targetElement) {
        const targetNode = findNodeById(getCurrentPage(), targetElement.id);
        if (targetNode && targetNode.splitState === 'unsplit') {
            // Handle text drop
            if (window._draggedText !== undefined && !targetNode.image) {
                saveState();
                if (window._sourceTextNode) {
                    window._sourceTextNode.text = null;
                }
                targetNode.text = window._draggedText;
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
            // Handle image drop
            else if (window._draggedAsset && !targetNode.text) {
                saveState();
                let fit = 'cover';
                if (window._sourceRect) {
                    const sourceNode = findNodeById(getCurrentPage(), window._sourceRect.id);
                    if (sourceNode && sourceNode.image) {
                        fit = sourceNode.image.fit;
                        sourceNode.image = null;
                    }
                }
                targetNode.image = {
                    assetId: window._draggedAsset.id,
                    fit: fit
                };
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
        }
    }

    window._draggedAsset = null;
    window._draggedText = undefined;
    window._sourceRect = null;
    window._sourceTextNode = null;
}

async function removeAsset(assetId) {
    if (!confirm('Are you sure you want to remove this asset? All instances in the layout will be deleted.')) return;

    saveState();

    // Remove from registry
    const index = importedAssets.findIndex(a => a.id === assetId);
    if (index !== -1) {
        importedAssets.splice(index, 1);
    }

    // Remove from all pages
    state.pages.forEach(pageRoot => {
        clearAssetFromLayout(pageRoot, assetId);
    });

    renderAssetList();
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

async function replaceAsset(assetId) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        saveState();
        const newAssetData = await processFile(file);

        const assetIndex = importedAssets.findIndex(a => a.id === assetId);
        if (assetIndex !== -1) {
            // Keep the same ID but update data
            importedAssets[assetIndex] = {
                ...newAssetData,
                id: assetId
            };
        }

        renderAssetList();
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    };

    fileInput.click();
}

export function attachImageDragHandlers(img, asset, hostRectElement) {
    img.draggable = true;
    img.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', asset.id);
        window._draggedAsset = asset;
        window._sourceRect = hostRectElement;
        hostRectElement.classList.add('moving-image');
    });

    img.addEventListener('dragend', () => {
        hostRectElement.classList.remove('moving-image');
    });

    // Touch support
    img.addEventListener('touchstart', (e) => handleTouchStart(e, { asset, sourceRect: hostRectElement }), { passive: false });
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
                if (window._draggedAsset && node.text) {
                    e.dataTransfer.dropEffect = 'none';
                    return;
                }
                // Block text drops on image rectangles
                if (window._draggedText !== undefined && node.image) {
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

        // Handle text drop
        if (targetElement && window._draggedText !== undefined) {
            const targetNode = findNodeById(getCurrentPage(), targetElement.id);
            if (!targetNode || targetNode.splitState === 'split' || targetNode.image) return;

            e.preventDefault();
            saveState();

            // Move text from source to target
            if (window._sourceTextNode) {
                window._sourceTextNode.text = null;
            }
            targetNode.text = window._draggedText;

            window._draggedText = undefined;
            window._sourceRect = null;
            window._sourceTextNode = null;

            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
            return;
        }

        // Handle image drop
        const asset = window._draggedAsset;
        if (targetElement && asset) {
            const targetNode = findNodeById(getCurrentPage(), targetElement.id);
            if (!targetNode || targetNode.splitState === 'split' || targetNode.text) return;

            e.preventDefault();
            saveState();

            let fit = 'cover';
            if (window._sourceRect) {
                const sourceNode = findNodeById(getCurrentPage(), window._sourceRect.id);
                if (sourceNode && sourceNode.image) {
                    fit = sourceNode.image.fit;
                    sourceNode.image = null;
                }
            }

            targetNode.image = {
                assetId: asset.id,
                fit: fit
            };

            window._draggedAsset = null;
            window._sourceRect = null;

            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        }
    });
}
