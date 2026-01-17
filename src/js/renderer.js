import { state, getCurrentPage } from './state.js';
import { findNodeById } from './layout.js';
import { A4_PAPER_ID } from './constants.js';
import { importedAssets, attachImageDragHandlers, handleTouchStart, handleTouchMove, handleTouchEnd } from './assets.js';
import { handleSplitClick, startDrag, startEdgeDrag } from './layout.js';
import { marked } from 'marked';

// Configure marked for GFM and better line breaks
marked.use({
    gfm: true,
    breaks: true
});

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
        renderTextContent(container, node, false);
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
                // Mark that we want edit mode
                node._startInEditMode = true;
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            });
        });
    }

    container.addEventListener('click', handleSplitClick);
}

function renderTextContent(container, node, startInEditMode = false) {
    // Check if we should start in edit mode
    if (node._startInEditMode) {
        startInEditMode = true;
        delete node._startInEditMode;
    }
    container.innerHTML = '';
    container.style.position = 'relative';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'text-editor-container';

    // Preview - draggable like images
    const preview = document.createElement('div');
    preview.className = startInEditMode ? 'markdown-content hidden' : 'markdown-content';
    preview.draggable = true;
    preview.innerHTML = marked.parse(node.text || '') || '<span class="text-placeholder">Click to edit...</span>';

    // Editor
    const editor = document.createElement('textarea');
    editor.className = startInEditMode ? 'text-editor' : 'text-editor hidden';
    editor.value = node.text || '';
    editor.placeholder = 'Write Markdown here...';

    // Auto-focus if starting in edit mode
    if (startInEditMode) {
        setTimeout(() => editor.focus(), 0);
    }

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

    // Touch support for text
    preview.addEventListener('touchstart', (e) => handleTouchStart(e, { text: node.text, sourceRect: container, sourceTextNode: node }), { passive: false });
    preview.addEventListener('touchmove', handleTouchMove, { passive: false });
    preview.addEventListener('touchend', handleTouchEnd);

    // Click preview: check modifiers first, then enter edit mode
    preview.addEventListener('click', (e) => {
        // Let Shift+click and Ctrl+click bubble to split/delete handlers
        if (e.shiftKey || e.ctrlKey || e.altKey) {
            return;
        }
        // Plain click: enter edit mode
        e.stopPropagation();
        preview.classList.add('hidden');
        editor.classList.remove('hidden');
        editor.focus();
    });

    // Editor click: allow Shift+click to bubble for splitting even while editing
    editor.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.altKey) {
            return;
        }
        e.stopPropagation();
    });

    // Sync text on input
    editor.addEventListener('input', () => {
        node.text = editor.value;
        // Also update preview in real-time so it's ready when switching back
        preview.innerHTML = marked.parse(node.text || '') || '<span class="text-placeholder">Click to edit...</span>';
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    });

    // Auto-pairing and Obsidian-like behavior
    editor.addEventListener('keydown', (e) => {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;

        // Auto-pairing character map
        const pairs = {
            '(': ')',
            '[': ']',
            '{': '}',
            '"': '"',
            "'": "'",
            '*': '*',
            '_': '_',
            '`': '`'
        };

        if (pairs[e.key]) {
            e.preventDefault();
            const selection = value.substring(start, end);
            let charToInsert = e.key;
            let closingChar = pairs[e.key];

            // Special case for double brackets [[ ]]
            if (e.key === '[' && value[start - 1] === '[') {
                editor.value = value.substring(0, start) + '[' + selection + ']]' + value.substring(end);
                editor.selectionStart = start + 1;
                editor.selectionEnd = start + 1 + selection.length;
            } else {
                editor.value = value.substring(0, start) + charToInsert + selection + closingChar + value.substring(end);
                editor.selectionStart = start + 1;
                editor.selectionEnd = start + 1 + selection.length;
            }

            editor.dispatchEvent(new Event('input'));
            return;
        }

        // Tab for indentation
        if (e.key === 'Tab') {
            e.preventDefault();
            const before = value.substring(0, start);
            const after = value.substring(end);
            editor.value = before + '  ' + after;
            editor.selectionStart = editor.selectionEnd = start + 2;
            editor.dispatchEvent(new Event('input'));
            return;
        }

        // Auto-list on Enter
        if (e.key === 'Enter') {
            const line = value.substring(0, start).split('\n').pop();
            const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+)/);
            if (listMatch) {
                e.preventDefault();
                // If current line is just the list marker, end the list (Obsidian style)
                if (line.trim() === listMatch[2]) {
                    const lineStart = start - line.length;
                    editor.value = value.substring(0, lineStart) + '\n' + value.substring(end);
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                } else {
                    const prefix = '\n' + listMatch[1] + listMatch[2] + listMatch[3];
                    editor.value = value.substring(0, start) + prefix + value.substring(end);
                    editor.selectionStart = editor.selectionEnd = start + prefix.length;
                }
                editor.dispatchEvent(new Event('input'));
            }
        }

        // Exit on Escape
        if (e.key === 'Escape') {
            editor.blur();
        }
    });

    // Exit edit mode on blur (click away)
    editor.addEventListener('blur', () => {
        editor.classList.add('hidden');
        preview.innerHTML = marked.parse(node.text || '') || '<span class="text-placeholder">Click to edit...</span>';
        preview.classList.remove('hidden');

        // Prevent accidental splitting when clicking away from an active editor
        window._justFinishedEditing = true;
        setTimeout(() => {
            window._justFinishedEditing = false;
        }, 200);
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

    // Touch support
    editorContainer.addEventListener('touchstart', (e) => handleTouchStart(e, { text: node.text, sourceRect: hostRectElement, sourceTextNode: node }), { passive: false });
    editorContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    editorContainer.addEventListener('touchend', handleTouchEnd);
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
