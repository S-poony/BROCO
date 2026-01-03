import { saveState } from './history.js';

export let importedAssets = []; // This will act as our asset registry

export function setupAssetHandlers() {
    const importBtn = document.getElementById('import-assets-btn');
    if (!importBtn) return;

    // Create a hidden file input
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
}

async function processFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const fullResData = e.target.result;
            const img = new Image();
            img.onload = () => {
                // Create a low-quality version for the preview and initial placement
                // We'll resize it to a maximum of 800px on the longest side
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

                // Use a lower quality JPEG to save memory/state size
                const lowResData = canvas.toDataURL('image/jpeg', 0.6);

                resolve({
                    id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: file.name,
                    lowResData: lowResData,
                    fullResData: fullResData // Store original high-res data for export
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
        item.innerHTML = `<img src="${asset.lowResData}" alt="${asset.name}" title="${asset.name}">`;

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', asset.id);
            // We'll store the asset data globally or in a way that the drop handler can access it
            window._draggedAsset = asset;
        });

        assetList.appendChild(item);
    });
}

// Drop handler for rectangles
export function setupDropHandlers() {
    // This will be called on initialization to handle the paper container
    const paper = document.getElementById('a4-paper');
    if (!paper) return;

    paper.addEventListener('dragover', (e) => {
        // Only allow drop if it's an asset and the target is a leaf rectangle
        const target = e.target.closest('.splittable-rect');
        if (target && target.getAttribute('data-split-state') === 'unsplit') {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });

    paper.addEventListener('drop', (e) => {
        const target = e.target.closest('.splittable-rect');
        if (target && target.getAttribute('data-split-state') === 'unsplit' && window._draggedAsset) {
            e.preventDefault();
            saveState(); // Save state before adding image

            const asset = window._draggedAsset;

            // Clear existing text/content
            target.innerHTML = '';
            target.style.position = 'relative'; // Ensure relative positioning for button

            // Create image element
            const img = document.createElement('img');
            img.src = asset.lowResData;
            img.setAttribute('data-asset-id', asset.id); // Track for export
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            // img.style.pointerEvents = 'none'; // Removed to allow clicks to bubble or be handled directly

            // Create remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-image-btn';
            removeBtn.innerHTML = '×';
            removeBtn.title = 'Remove image';
            removeBtn.onclick = (event) => {
                event.stopPropagation();
                saveState();
                const hostRect = event.currentTarget.closest('.splittable-rect');
                if (hostRect) {
                    hostRect.innerHTML = hostRect.id.replace('rect-', ''); // Restore label
                    hostRect.style.position = '';
                }
            };

            target.appendChild(img);
            target.appendChild(removeBtn);
            window._draggedAsset = null;
        }
    });
}
