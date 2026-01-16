import { state, addPage, switchPage, deletePage, getCurrentPage } from './state.js';
import { renderLayout } from './renderer.js';
import { A4_PAPER_ID } from './constants.js';
import { saveState } from './history.js';

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

        // Thumbnail Container
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'page-thumbnail-preview';

        // Render a mini version of the layout
        // We'll use the renderer but specific for thumbnails
        // Since renderer renders to DOM, we can render to a temporary div and scale it down
        // Or better, just structure it similarly but with simple styles

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
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete Page';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (state.pages.length > 1) {
                if (confirm('Are you sure you want to delete this page?')) {
                    saveState();
                    deletePage(index);
                    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                    renderPageList();
                }
            } else {
                alert('Cannot delete the last page.');
            }
        };

        item.addEventListener('click', () => {
            if (state.currentPageIndex !== index) {
                switchPage(index);
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                renderPageList();
            }
        });

        item.appendChild(pageNum);
        item.appendChild(thumbnailContainer);
        item.appendChild(deleteBtn);
        pagesList.appendChild(item);
    });
}

function renderMiniLayout(container, node) {
    container.innerHTML = '';

    // Recursive function similar to renderer.js but for simple boxes
    function buildMiniRecursive(parentNode, domNode) {
        if (parentNode.splitState === 'split') {
            domNode.classList.add(parentNode.orientation === 'vertical' ? 'flex-row' : 'flex-col');
            domNode.classList.add('flex');
            domNode.style.width = '100%';
            domNode.style.height = '100%';

            parentNode.children.forEach(child => {
                const childDiv = document.createElement('div');
                childDiv.style.flex = '1'; // Simplify sizing for thumbnail mostly
                // Or try to respect size
                if (child.size) {
                    if (parentNode.orientation === 'vertical') childDiv.style.width = child.size;
                    else childDiv.style.height = child.size;
                }

                childDiv.className = 'mini-rect';
                childDiv.style.border = '1px solid #ccc';
                childDiv.style.boxSizing = 'border-box';
                childDiv.style.position = 'relative';

                buildMiniRecursive(child, childDiv);
                domNode.appendChild(childDiv);
            });
        } else {
            // Leaf
            domNode.style.width = '100%';
            domNode.style.height = '100%';
            if (parentNode.image) {
                domNode.style.backgroundColor = '#e0e7ff'; // Indicate image presence
                domNode.innerHTML = '<span style="font-size:8px">🖼️</span>';
                domNode.style.display = 'flex';
                domNode.style.justifyContent = 'center';
                domNode.style.alignItems = 'center';
            }
        }
    }

    buildMiniRecursive(node, container);
}
