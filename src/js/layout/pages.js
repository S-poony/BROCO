import { state, addPage, duplicatePage, switchPage, deletePage, reorderPage, getCurrentPage } from '../core/state.js';
import { A4_PAPER_ID, SNAP_POINTS, SNAP_THRESHOLD, MIN_AREA_PERCENT } from '../core/constants.js';
import { saveState } from '../io/history.js';
import { renderLayout } from './renderer.js';
import { dragDropService } from '../ui/DragDropService.js';
import { renderAndRestoreFocus } from './layout.js';
import { showConfirm, showAlert } from '../core/utils.js';
import { toast } from '../core/errorHandler.js';

export function setupPageHandlers() {
    const addPageBtn = document.getElementById('add-page-btn');
    const pagesList = document.getElementById('pages-list');

    if (!addPageBtn || !pagesList) return;

    addPageBtn.addEventListener('click', () => {
        saveState();
        addPage();
        renderAndRestoreFocus(getCurrentPage());
        renderPageList();
    });

    // Listen for state definition/restoration
    document.addEventListener('stateRestored', () => {
        renderPageList();
        renderAndRestoreFocus(getCurrentPage());
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

    // Preserve scroll position across re-renders
    const savedScrollTop = pagesList.scrollTop;

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
        deleteBtn.innerHTML = '<span class="icon icon-delete" aria-hidden="true"></span>';
        deleteBtn.title = 'Delete Page';
        deleteBtn.setAttribute('aria-label', `Delete page ${index + 1}`);
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (state.pages.length > 1) {
                const confirmed = await showConfirm('Are you sure you want to delete this page?', 'Are you sure?', 'Confirm', 'delete-page');
                if (confirmed) {
                    saveState();
                    deletePage(index);
                    renderAndRestoreFocus(getCurrentPage());
                    renderPageList();
                }
            } else {
                toast.warning('Cannot delete the last page.');
            }
        };

        // Duplicate Button
        const duplicateBtn = document.createElement('button');
        duplicateBtn.className = 'duplicate-page-btn';
        duplicateBtn.innerHTML = '<span class="icon icon-duplicate" aria-hidden="true"></span>';
        duplicateBtn.title = 'Duplicate Page';
        duplicateBtn.setAttribute('aria-label', `Duplicate page ${index + 1}`);
        duplicateBtn.onclick = (e) => {
            e.stopPropagation();
            saveState();
            duplicatePage(index);
            renderAndRestoreFocus(getCurrentPage());
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
                renderAndRestoreFocus(getCurrentPage());
                renderPageList();
            }
            item.classList.remove('drag-over');
        });

        item.addEventListener('click', () => {
            if (state.currentPageIndex !== index) {
                switchPage(index);
                renderAndRestoreFocus(getCurrentPage());
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

    // Restore scroll position
    pagesList.scrollTop = savedScrollTop;
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
            renderAndRestoreFocus(getCurrentPage());
            renderPageList();
        }
    }
}

function renderMiniLayout(container, node) {
    container.innerHTML = '';
    container.style.backgroundColor = '#fff';

    function createMiniRect(childNode) {
        const div = document.createElement('div');
        div.className = 'mini-rect';
        div.style.backgroundColor = '#fff';
        div.style.position = 'relative';
        div.style.minWidth = '0';
        div.style.minHeight = '0';

        if (childNode.size) {
            const growValue = parseFloat(childNode.size);
            div.style.flex = `${growValue} 1 0px`;
        } else {
            div.style.flex = '1 1 0px';
        }
        return div;
    }

    function createMiniDivider(orientation) {
        const divider = document.createElement('div');
        divider.className = 'mini-divider';
        divider.style.flex = '0 0 var(--mini-divider-width, 1px)';
        divider.style.backgroundColor = 'var(--color-border, #d1d5db)';
        if (orientation === 'vertical') {
            divider.style.width = 'var(--mini-divider-width, 1px)';
            divider.style.height = '100%';
        } else {
            divider.style.width = '100%';
            divider.style.height = 'var(--mini-divider-width, 1px)';
        }
        return divider;
    }

    function buildMiniRecursive(node, domNode) {
        if (node.splitState === 'split' && node.children && node.children.length >= 2) {
            domNode.style.display = 'flex';
            domNode.style.flexDirection = node.orientation === 'vertical' ? 'row' : 'column';

            const childA = node.children[0];
            const childB = node.children[1];

            const divA = createMiniRect(childA);
            const divider = createMiniDivider(node.orientation);
            const divB = createMiniRect(childB);

            domNode.appendChild(divA);
            domNode.appendChild(divider);
            domNode.appendChild(divB);

            buildMiniRecursive(childA, divA);
            buildMiniRecursive(childB, divB);
        } else {
            // Leaf rendering...
            if (node.image) {
                domNode.style.backgroundColor = '#e0e7ff'; // Indicate image presence
                domNode.innerHTML = '<span aria-hidden="true">🖼️</span>';
                domNode.style.fontSize = '11px';
                domNode.style.display = 'flex';
                domNode.style.justifyContent = 'center';
                domNode.style.alignItems = 'center';
            } else if (node.text !== null && node.text !== undefined) {
                domNode.style.backgroundColor = '#fef3c7'; // Indicate text presence
                domNode.innerHTML = '<span aria-hidden="true">📝</span>';
                domNode.style.fontSize = '11px';
                domNode.style.display = 'flex';
                domNode.style.justifyContent = 'center';
                domNode.style.alignItems = 'center';
            } else {
                domNode.style.backgroundColor = '#fff';
            }
        }
    }

    buildMiniRecursive(node, container);
}
