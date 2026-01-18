import { state, getCurrentPage } from './state.js';
import { findNodeById } from './layout.js';
import { A4_PAPER_ID } from './constants.js';
import { assetManager } from './AssetManager.js';
import { dragDropService } from './DragDropService.js';
import { attachImageDragHandlers, handleTouchStart, handleTouchMove, handleTouchEnd } from './assets.js';
import { handleSplitClick, startDrag, startEdgeDrag, createTextInRect, toggleTextAlignment } from './layout.js';
import { saveState } from './history.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
    // Use classList.add to preserve classes from createDOMRect or other sources
    element.classList.add('splittable-rect', 'rectangle-base', 'flex', 'items-center', 'justify-center');
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
        const asset = assetManager.getAsset(node.image.assetId);
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
            removeBtn.title = 'Remove image';
            removeBtn.innerHTML = '<span class="icon icon-delete"></span>';
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                saveState();
                node.image = null;
                renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
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
        prompt.textContent = 'Click here to write';
        container.appendChild(prompt);

        // Handle click on prompt to start editing
        prompt.addEventListener('click', (e) => {
            e.stopPropagation();
            createTextInRect(node.id);
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
    const isCentered = node.textAlign === 'center';
    const preview = document.createElement('div');
    preview.className = `markdown-content ${isCentered ? 'text-center' : ''} ${startInEditMode ? 'hidden' : ''}`;
    preview.draggable = true;
    preview.innerHTML = DOMPurify.sanitize(marked.parse(node.text || '')) || '<span class="text-placeholder">Click to edit...</span>';

    // Editor
    const editor = document.createElement('textarea');
    editor.className = `text-editor ${isCentered ? 'text-center' : ''} ${startInEditMode ? '' : 'hidden'}`;
    editor.value = node.text || '';
    editor.placeholder = 'Write Markdown here...';

    // Auto-focus if starting in edit mode
    if (startInEditMode) {
        setTimeout(() => editor.focus(), 0);
    }

    // Drag preview to move text (like images)
    preview.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'text-content');
        dragDropService.startDrag({ text: node.text, textAlign: node.textAlign, sourceRect: container, sourceTextNode: node });
    });
    preview.addEventListener('dragend', () => {
        dragDropService.endDrag();
    });

    // Touch support for text
    preview.addEventListener('touchstart', (e) => handleTouchStart(e, { text: node.text, textAlign: node.textAlign, sourceRect: container, sourceTextNode: node }), { passive: false });
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
        preview.innerHTML = DOMPurify.sanitize(marked.parse(node.text || '')) || '<span class="text-placeholder">Click to edit...</span>';
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

        const selection = value.substring(start, end);

        if (pairs[e.key]) {
            e.preventDefault();
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
            const listMatch = line.match(/^(\s*)([-*+]|(\d+)\.)(\s+)/);
            if (listMatch) {
                e.preventDefault();
                const indent = listMatch[1];
                const marker = listMatch[2];
                const number = listMatch[3];
                const space = listMatch[4];

                // If current line is just the list marker, end the list (Obsidian style)
                if (line.trim() === marker) {
                    const lineStart = start - line.length;
                    editor.value = value.substring(0, lineStart) + '\n' + value.substring(end);
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                } else {
                    let nextMarker = marker;
                    if (number) {
                        nextMarker = (parseInt(number, 10) + 1) + '.';
                    }
                    const prefix = '\n' + indent + nextMarker + space;
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

        // Ctrl+K for links
        if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const linkText = selection || '';
            const linkUrl = 'https://';
            const before = value.substring(0, start);
            const after = value.substring(end);

            editor.value = before + `[${linkText}](${linkUrl})` + after;

            if (selection) {
                // If text was selected, highlight the URL part
                editor.selectionStart = start + linkText.length + 3; // [ + linkText + ] + (
                editor.selectionEnd = editor.selectionStart + linkUrl.length;
            } else {
                // If no selection, place cursor inside brackets
                editor.selectionStart = editor.selectionEnd = start + 1;
            }
            editor.dispatchEvent(new Event('input'));
        }
    });

    // Exit edit mode on blur (click away)
    editor.addEventListener('blur', () => {
        editor.classList.add('hidden');
        preview.innerHTML = DOMPurify.sanitize(marked.parse(node.text || '')) || '<span class="text-placeholder">Click to edit...</span>';
        preview.classList.remove('hidden');

        // Prevent accidental splitting when clicking away from an active editor
        window._justFinishedEditing = true;
        setTimeout(() => {
            window._justFinishedEditing = false;
        }, 200);
    });

    // Alignment toggle button
    const alignBtn = document.createElement('button');
    alignBtn.className = 'align-text-btn';
    alignBtn.title = isCentered ? 'Align Left' : 'Align Center';

    const leftIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 4C2.44772 4 2 4.44772 2 5V5.5C2 6.05228 2.44772 6.5 3 6.5H21C21.5523 6.5 22 6.05228 22 5.5V5C22 4.44772 21.5523 4 21 4H3Z" fill="currentColor"/><path d="M3 13C2.44772 13 2 13.4477 2 14V14.5C2 15.0523 2.44772 15.5 3 15.5H21C21.5523 15.5 22 15.0523 22 14.5V14C22 13.4477 21.5523 13 21 13H3Z" fill="currentColor"/><path d="M2 9.5C2 8.94772 2.44772 8.5 3 8.5H15C15.5523 8.5 16 8.94772 16 9.5V10C16 10.5523 15.5523 11 15 11H3C2.44772 11 2 10.5523 2 10V9.5Z" fill="currentColor"/><path d="M3 17.5C2.44772 17.5 2 17.9477 2 18.5V19C2 19.5523 2.44772 20 3 20H15C15.5523 20 16 19.5523 16 19V18.5C16 17.9477 15.5523 17.5 15 17.5H3Z" fill="currentColor"/></svg>`;
    const centerIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 4C2.44772 4 2 4.44772 2 5V5.5C2 6.05228 2.44772 6.5 3 6.5H21C21.5523 6.5 22 6.05228 22 5.5V5C22 4.44772 21.5523 4 21 4H3Z" fill="currentColor"/><path d="M3 13C2.44772 13 2 13.4477 2 14V14.5C2 15.0523 2.44772 15.5 3 15.5H21C21.5523 15.5 22 15.0523 22 14.5V14C22 13.4477 21.5523 13 21 13H3Z" fill="currentColor"/><path d="M5 9.5C5 8.94772 5.44772 8.5 6 8.5H18C18.5523 8.5 19 8.94772 19 9.5V10C19 10.5523 18.5523 11 18 11H6C5.44772 11 5 10.5523 5 10V9.5Z" fill="currentColor"/><path d="M6 17.5C5.44772 17.5 5 17.9477 5 18.5V19C5 19.5523 5.44772 20 6 20H18C18.5523 20 19 19.5523 19 19V18.5C19 17.9477 18.5523 17.5 18 17.5H6Z" fill="currentColor"/></svg>`;

    alignBtn.innerHTML = isCentered ? leftIcon : centerIcon;

    alignBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTextAlignment(node.id);
    });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-text-btn';
    removeBtn.title = 'Remove text';
    removeBtn.innerHTML = '<span class="icon icon-delete"></span>';
    removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveState();
        node.text = null;
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
    });

    editorContainer.appendChild(preview);
    editorContainer.appendChild(editor);
    editorContainer.appendChild(alignBtn);
    editorContainer.appendChild(removeBtn);
    container.appendChild(editorContainer);
}

function createDOMRect(node, parentOrientation) {
    const div = document.createElement('div');
    div.id = node.id;
    div.className = 'splittable-rect rectangle-base flex items-center justify-center';

    div.addEventListener('mouseenter', () => {
        state.hoveredRectId = node.id;
    });
    div.addEventListener('mouseleave', () => {
        if (state.hoveredRectId === node.id) {
            state.hoveredRectId = null;
        }
    });

    if (node.size) {
        div.style.flexGrow = node.size.replace('%', '');
        if (parentOrientation === 'vertical') {
            div.style.height = '100%';
            div.classList.add('h-full');
        } else if (parentOrientation === 'horizontal') {
            div.style.width = '100%';
            div.classList.add('w-full');
        }
    } else {
        // Root or full sized - defaults from CSS take over (flex-grow: 1, flex-basis: 0)
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
