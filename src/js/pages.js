import { state, addPage, duplicatePage, switchPage, deletePage, reorderPage, getCurrentPage } from './state.js';
import { renderLayout } from './renderer.js';
import { A4_PAPER_ID } from './constants.js';
import { saveState } from './history.js';
import { showConfirm, showAlert } from './utils.js';
import { dragDropService } from './DragDropService.js';

export function setupPageHandlers() {
    const addPageBtn = document.getElementById('add-page-btn');
    const pagesList = document.getElementById('pages-list');

    if (!addPageBtn || !pagesList) return;

    addPageBtn.addEventListener('click', () => {
        saveState();
        addPage();
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        renderPageList();
    });

    // Listen for state definition/restoration
    document.addEventListener('stateRestored', () => {
        renderPageList();
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    });

    document.addEventListener('layoutUpdated', () => {
        renderPageList();
    });

    // Initial render
    renderPageList();
}

export function renderPageList() {
    const pagesList = document.getElementById('pages-list');
    if (!pagesList) return;

    pagesList.innerHTML = '';

    state.pages.forEach((page, index) => {
        const item = document.createElement('div');
        item.className = `page-thumbnail-item ${index === state.currentPageIndex ? 'active' : ''}`;
        item.draggable = true;
        item.dataset.pageIndex = index;

        // Thumbnail Container
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'page-thumbnail-preview';

        const previewContent = document.createElement('div');
        previewContent.className = 'mini-layout';
        renderMiniLayout(previewContent, page);
        thumbnailContainer.appendChild(previewContent);

        // Page Number
        const pageNum = document.createElement('span');
        pageNum.className = 'page-number';
        pageNum.innerText = index + 1;

        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-page-btn';
        deleteBtn.innerHTML = '<span class="icon icon-delete"></span>';
        deleteBtn.title = 'Delete Page';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (state.pages.length > 1) {
                const confirmed = await showConfirm('Are you sure you want to delete this page?', 'Are you sure?', 'Confirm', 'delete-page');
                if (confirmed) {
                    saveState();
                    deletePage(index);
                    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                    renderPageList();
                }
            } else {
                showAlert('Cannot delete the last page.', 'Action Restricted');
            }
        };

        // Duplicate Button
        const duplicateBtn = document.createElement('button');
        duplicateBtn.className = 'duplicate-page-btn';
        duplicateBtn.innerHTML = '<span class="icon icon-duplicate"></span>';
        duplicateBtn.title = 'Duplicate Page';
        duplicateBtn.onclick = (e) => {
            e.stopPropagation();
            saveState();
            duplicatePage(index);
            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            renderPageList();
        };

        // Drag and Drop for reordering
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index.toString());
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.page-thumbnail-item').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const toIndex = index;
            if (fromIndex !== toIndex) {
                saveState();
                reorderPage(fromIndex, toIndex);
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                renderPageList();
            }
            item.classList.remove('drag-over');
        });

        item.addEventListener('click', () => {
            if (state.currentPageIndex !== index) {
                switchPage(index);
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                renderPageList();
            }
        });

        item.appendChild(pageNum);
        item.appendChild(thumbnailContainer);
        item.appendChild(duplicateBtn);
        item.appendChild(deleteBtn);

        // Touch support for reordering using service
        item.addEventListener('touchstart', (e) => {
            dragDropService.startTouchDrag(e, { pageIndex: index });
        }, { passive: false });

        item.addEventListener('touchmove', (e) => {
            const result = dragDropService.handleTouchMove(e);
            if (!result) return;
            updatePageDragFeedback(result.target);
        }, { passive: false });

        item.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            handlePageDropLogic(target);
            dragDropService.endDrag();
        });

        pagesList.appendChild(item);
    });
}

function updatePageDragFeedback(target) {
    // Remove highlight from all thumbnails
    document.querySelectorAll('.page-thumbnail-item').forEach(el => el.classList.remove('drag-over'));

    const targetItem = target?.closest('.page-thumbnail-item');
    if (targetItem && dragDropService.draggedPageIndex !== undefined) {
        targetItem.classList.add('drag-over');
    }
}

function handlePageDropLogic(target) {
    const targetItem = target?.closest('.page-thumbnail-item');
    if (targetItem && dragDropService.draggedPageIndex !== undefined) {
        const fromIndex = dragDropService.draggedPageIndex;
        const toIndex = parseInt(targetItem.dataset.pageIndex, 10);

        if (fromIndex !== toIndex) {
            saveState();
            reorderPage(fromIndex, toIndex);
            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            renderPageList();
        }
    }
}

function renderMiniLayout(container, node) {
    container.innerHTML = '';
    container.style.backgroundColor = '#fff'; // Default background

    // Recursive function similar to renderer.js but for simple boxes
    function buildMiniRecursive(node, domNode) {
        if (node.splitState === 'split') {
            domNode.style.display = 'flex';
            domNode.style.flexDirection = node.orientation === 'vertical' ? 'row' : 'column';
            domNode.style.gap = '1px';
            domNode.style.backgroundColor = '#d1d5db'; // Same as main layout border/divider color

            node.children.forEach(child => {
                const childDiv = document.createElement('div');
                childDiv.className = 'mini-rect';
                childDiv.style.backgroundColor = '#fff';
                childDiv.style.position = 'relative';
                childDiv.style.minWidth = '0';
                childDiv.style.minHeight = '0';

                if (child.size) {
                    // Extract numeric value from "50%" or similar
                    const growValue = parseFloat(child.size);
                    childDiv.style.flex = `${growValue} 1 0px`;
                } else {
                    childDiv.style.flex = '1 1 0px';
                }

                buildMiniRecursive(child, childDiv);
                domNode.appendChild(childDiv);
            });
        } else {
            // Leaf
            domNode.style.backgroundColor = '#fff';
            if (node.image) {
                domNode.style.backgroundColor = '#e0e7ff'; // Indicate image presence
                domNode.innerHTML = '🖼️';
                domNode.style.fontSize = '8px';
                domNode.style.display = 'flex';
                domNode.style.justifyContent = 'center';
                domNode.style.alignItems = 'center';
            } else if (node.text !== null && node.text !== undefined) {
                domNode.style.backgroundColor = '#fef3c7'; // Indicate text presence (amber-100)
                domNode.innerHTML = '📝';
                domNode.style.fontSize = '8px';
                domNode.style.display = 'flex';
                domNode.style.justifyContent = 'center';
                domNode.style.alignItems = 'center';
            }
        }
    }

    buildMiniRecursive(node, container);
}
