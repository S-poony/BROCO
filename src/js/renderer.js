import { state, getCurrentPage } from './state.js';
import { findNodeById } from './layout.js';
import { A4_PAPER_ID } from './constants.js';
import { importedAssets, attachImageDragHandlers } from './assets.js';
import { handleSplitClick, startDrag, startEdgeDrag } from './layout.js';
import { marked } from 'marked';

export function renderLayout(container, node) {
    // Top-level paper handling: ensure we don't accidentally turn the paper into rect-1
    if (container.id === A4_PAPER_ID) {
        container.innerHTML = '';
        const rootElement = createDOMRect(node, null);
        container.appendChild(rootElement);
        renderNodeRecursive(rootElement, node);
        addEdgeHandles(container);
        return;
    }
    renderNodeRecursive(container, node);
}

function renderNodeRecursive(element, node) {
    // Clear previous state
    element.innerHTML = '';
    element.className = 'splittable-rect rectangle-base flex items-center justify-center';
    element.style.position = '';

    if (node.splitState === 'split') {
        renderSplitNode(element, node);
    } else {
        renderLeafNode(element, node);
    }
}

function renderSplitNode(container, node) {
    container.classList.add(node.orientation === 'vertical' ? 'flex-row' : 'flex-col');
    container.setAttribute('data-split-state', 'split');

    const rectA = createDOMRect(node.children[0], node.orientation);
    const rectB = createDOMRect(node.children[1], node.orientation);
    const divider = createDOMDivider(node, rectA, rectB);

    container.appendChild(rectA);
    container.appendChild(divider);
    container.appendChild(rectB);

    renderNodeRecursive(rectA, node.children[0]);
    renderNodeRecursive(rectB, node.children[1]);
}

function renderLeafNode(container, node) {
    container.setAttribute('data-split-state', 'unsplit');

    if (node.image) {
        const asset = importedAssets.find(a => a.id === node.image.assetId);
        if (asset) {
            container.innerHTML = '';
            container.style.position = 'relative';

            const img = document.createElement('img');
            img.src = asset.lowResData;
            img.setAttribute('data-asset-id', asset.id);
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = node.image.fit || 'cover';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-image-btn';
            removeBtn.innerHTML = '×';
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                import('./history.js').then(({ saveState }) => {
                    saveState();
                    node.image = null;
                    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                    document.dispatchEvent(new CustomEvent('layoutUpdated'));
                });
            });

            container.appendChild(img);
            container.appendChild(removeBtn);

            attachImageDragHandlers(img, asset, container);
        } else {
            container.innerHTML = '';
        }
    } else if (node.text !== null && node.text !== undefined) {
        renderTextContent(container, node);
    } else {
        // Empty rectangle - show hover prompt
        container.innerHTML = '';
        container.style.position = 'relative';

        const prompt = document.createElement('div');
        prompt.className = 'text-prompt';
        prompt.textContent = 'Click to write';
        container.appendChild(prompt);

        // Handle click on prompt to start editing
        prompt.addEventListener('click', (e) => {
            e.stopPropagation();
            const nodeId = node.id; // Capture ID before re-render
            import('./history.js').then(({ saveState }) => {
                saveState();
                node.text = '';
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
                // Focus the editor after render - use nodeId to find the new element
                setTimeout(() => {
                    const newContainer = document.getElementById(nodeId);
                    const editor = newContainer?.querySelector('.text-editor');
                    if (editor) editor.focus();
                }, 0);
            });
        });
    }

    container.addEventListener('click', handleSplitClick);
}

function renderTextContent(container, node) {
    container.innerHTML = '';
    container.style.position = 'relative';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'text-editor-container';

    // Preview (shown by default) - draggable like images
    const preview = document.createElement('div');
    preview.className = 'markdown-content';
    preview.draggable = true;
    preview.innerHTML = marked.parse(node.text || '') || '<span class="text-placeholder">Click to edit...</span>';

    // Editor (hidden by default)
    const editor = document.createElement('textarea');
    editor.className = 'text-editor hidden';
    editor.value = node.text || '';
    editor.placeholder = 'Write Markdown here...';

    // Drag preview to move text (like images)
    preview.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'text-content');
        window._draggedText = node.text;
        window._sourceRect = container;
        window._sourceTextNode = node;
        container.classList.add('moving-text');
    });
    preview.addEventListener('dragend', () => {
        container.classList.remove('moving-text');
    });

    // Click preview: check modifiers first, then enter edit mode
    preview.addEventListener('click', (e) => {
        // Let Shift+click and Ctrl+click bubble to split/delete handlers
        if (e.shiftKey || e.ctrlKey) {
            // Don't stop propagation - let it reach handleSplitClick
            return;
        }
        // Plain click: enter edit mode
        e.stopPropagation();
        preview.classList.add('hidden');
        editor.classList.remove('hidden');
        editor.focus();
    });

    // Prevent editor click from bubbling
    editor.addEventListener('click', (e) => e.stopPropagation());

    // Sync text on input
    editor.addEventListener('input', () => {
        node.text = editor.value;
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    });

    // Exit edit mode on blur (click away)
    editor.addEventListener('blur', () => {
        editor.classList.add('hidden');
        preview.innerHTML = marked.parse(node.text || '') || '<span class="text-placeholder">Click to edit...</span>';
        preview.classList.remove('hidden');
    });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-text-btn';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        import('./history.js').then(({ saveState }) => {
            saveState();
            node.text = null;
            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        });
    });

    editorContainer.appendChild(preview);
    editorContainer.appendChild(editor);
    editorContainer.appendChild(removeBtn);
    container.appendChild(editorContainer);
}

function attachTextDragHandlers(editorContainer, node, hostRectElement) {
    editorContainer.draggable = true;
    editorContainer.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'text-content');
        window._draggedText = node.text;
        window._sourceRect = hostRectElement;
        window._sourceTextNode = node;
        hostRectElement.classList.add('moving-text');
    });

    editorContainer.addEventListener('dragend', () => {
        hostRectElement.classList.remove('moving-text');
    });
}

function createDOMRect(node, parentOrientation) {
    const div = document.createElement('div');
    div.id = node.id;
    div.className = 'splittable-rect rectangle-base flex items-center justify-center';

    if (node.size) {
        if (parentOrientation === 'vertical') {
            div.style.width = node.size;
            div.style.height = '100%';
            div.classList.add('h-full');
        } else if (parentOrientation === 'horizontal') {
            div.style.height = node.size;
            div.style.width = '100%';
            div.classList.add('w-full');
        }
    } else {
        // Root or full sized
        div.style.width = '100%';
        div.style.height = '100%';
        div.classList.add('w-full', 'h-full');
    }
    return div;
}

function createDOMDivider(parentNode, rectA, rectB) {
    const divider = document.createElement('div');
    divider.className = `divider no-select flex-shrink-0 ${parentNode.orientation}-divider`;
    divider.setAttribute('data-orientation', parentNode.orientation);
    divider.setAttribute('data-rect-a-id', rectA.id);
    divider.setAttribute('data-rect-b-id', rectB.id);
    divider.setAttribute('data-parent-id', parentNode.id);

    divider.addEventListener('mousedown', startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });
    return divider;
}

function addEdgeHandles(container) {
    const edges = ['top', 'bottom', 'left', 'right'];
    edges.forEach(edge => {
        const handle = document.createElement('div');
        handle.className = `edge-handle edge-${edge}`;
        handle.addEventListener('mousedown', (e) => startEdgeDrag(e, edge));
        handle.addEventListener('touchstart', (e) => startEdgeDrag(e, edge), { passive: false });
        container.appendChild(handle);
    });
}
