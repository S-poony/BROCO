import { state, getCurrentPage } from '../core/state.js';
import { findNodeById } from './layout.js';
import { A4_PAPER_ID } from '../core/constants.js';
import { assetManager } from '../assets/AssetManager.js';
import { dragDropService } from '../ui/DragDropService.js';
import { attachImageDragHandlers, handleTouchStart, handleTouchMove, handleTouchEnd, importImageToNode } from '../assets/assets.js';
import { handleSplitClick, startDrag, startEdgeDrag, createTextInRect, toggleTextAlignment, renderAndRestoreFocus, toggleImageFlip } from './layout.js';
import { saveState } from '../io/history.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getSettings } from '../ui/settings.js';

// Configure marked for GFM and better line breaks
marked.use({
    gfm: true,
    breaks: true
});

// Resize observers removed in favor of CSS Container Queries

export function renderLayout(container, node, options = {}) {
    // Top-level paper handling: ensure we don't accidentally turn the paper into rect-1
    if (container.id === A4_PAPER_ID || container.classList.contains('a4-paper')) {
        const settings = getSettings();

        // Use a fragment to batch all DOM operations off-screen
        const fragment = document.createDocumentFragment();

        // Proportional scaling now handled by CSS Container Queries on the paper itself
        container.classList.add('a4-paper');
        container.style.backgroundColor = 'var(--paper-bg-color, #ffffff)';

        const rootElement = createDOMRect(node, null);
        fragment.appendChild(rootElement);
        renderNodeRecursive(rootElement, node, options);

        if (!options.hideControls) {
            addEdgeHandles(fragment);
        }
        renderBackgroundImage(fragment);
        renderPageNumber(fragment);

        // Atomic swap
        container.innerHTML = '';
        container.appendChild(fragment);
        return;
    }
    renderNodeRecursive(container, node, options);
}

function renderNodeRecursive(element, node, options) {
    // Clear previous state
    element.innerHTML = '';
    // Use classList.add to preserve classes from createDOMRect or other sources
    element.classList.add('splittable-rect', 'rectangle-base', 'flex', 'items-center', 'justify-center');
    element.style.position = '';

    if (node.splitState === 'split') {
        renderSplitNode(element, node, options);
    } else {
        renderLeafNode(element, node, options);
    }
}

function renderSplitNode(container, node, options) {
    container.classList.add(node.orientation === 'vertical' ? 'flex-row' : 'flex-col');
    container.setAttribute('data-split-state', 'split');
    container.removeAttribute('tabindex');
    container.removeAttribute('role');
    container.removeAttribute('aria-label');

    const rectA = createDOMRect(node.children[0], node.orientation);
    const rectB = createDOMRect(node.children[1], node.orientation);
    const divider = createDOMDivider(node, rectA, rectB, options);

    container.appendChild(rectA);
    container.appendChild(divider);
    container.appendChild(rectB);

    renderNodeRecursive(rectA, node.children[0], options);
    renderNodeRecursive(rectB, node.children[1], options);
}

function renderLeafNode(container, node, options) {
    container.setAttribute('data-split-state', 'unsplit');

    // Only make interactive if controls are enabled
    if (!options.hideControls) {
        container.setAttribute('tabindex', '0');
        container.setAttribute('role', 'button');

        const hasContent = node.image || (node.text !== null && node.text !== undefined);
        const label = hasContent
            ? 'Content region. Click to split, Enter/Type to edit.'
            : 'Empty region. Click to split, Enter/Type to write.';
        container.setAttribute('aria-label', label);
    }

    if (node.image) {
        const asset = assetManager.getAsset(node.image.assetId);
        if (asset) {
            container.innerHTML = '';
            container.style.position = 'relative';

            // Check if we should use high-res logic (background-image mostly for html2canvas stability)
            if (options.useHighResImages) {
                let imageUrl = asset.fullResData;

                // For Electron references, fetch from local disk using custom protocol
                if (asset.isReference && asset.absolutePath) {
                    imageUrl = `broco-local://${encodeURIComponent(asset.absolutePath)}`;
                }

                if (imageUrl) {
                    // High-res export rendering using background-image technique
                    container.style.backgroundImage = `url(${imageUrl})`;
                    container.style.backgroundSize = node.image.fit || 'cover';
                    container.style.backgroundPosition = 'center';
                    container.style.backgroundRepeat = 'no-repeat';

                    if (node.image.flip) {
                        container.style.transform = 'scaleX(-1)';
                    }
                }
            } else {
                // Standard editor rendering with <img> tag
                const img = document.createElement('img');
                img.src = asset.lowResData;
                img.setAttribute('data-asset-id', asset.id);
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = node.image.fit || 'cover';

                if (node.image.flip) {
                    img.style.transform = 'scaleX(-1)';
                }

                // If the asset is broken, show a warning overlay
                if (asset.isBroken) {
                    const brokenCover = document.createElement('div');
                    brokenCover.className = 'broken-asset-placeholder';
                    brokenCover.innerHTML = `
                        <div class="icon icon-warning"></div>
                        <span>Missing File</span>
                        <button class="btn-primary btn-mini replace-broken-btn" data-id="${asset.id}">Replace...</button>
                    `;
                    container.appendChild(brokenCover);
                }

                container.appendChild(img);

                if (!options.hideControls) {
                    const buttonsContainer = document.createElement('div');
                    buttonsContainer.className = 'image-controls';

                    container.addEventListener('mouseenter', () => {
                        // Handled by CSS
                    });
                    container.addEventListener('mouseleave', () => {
                        // Handled by CSS
                    });

                    const flipBtn = document.createElement('button');
                    flipBtn.id = `flip-btn-${node.id}`;
                    flipBtn.className = 'flip-image-btn';
                    flipBtn.title = 'Flip Image';
                    flipBtn.innerHTML = `<!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2 18.1136V5.88638C2 4.18423 2 3.33316 2.54242 3.05402C3.08484 2.77488 3.77738 3.26956 5.16247 4.25891L6.74371 5.38837C7.35957 5.82827 7.6675 6.04822 7.83375 6.37127C8 6.69432 8 7.07274 8 7.82957V16.1704C8 16.9273 8 17.3057 7.83375 17.6287C7.6675 17.9518 7.35957 18.1717 6.74372 18.6116L5.16248 19.7411C3.77738 20.7304 3.08484 21.2251 2.54242 20.946C2 20.6668 2 19.8158 2 18.1136Z" fill="currentColor"/>
<path d="M22 18.1136V5.88638C22 4.18423 22 3.33316 21.4576 3.05402C20.9152 2.77488 20.2226 3.26956 18.8375 4.25891L17.2563 5.38837C16.6404 5.82827 16.3325 6.04822 16.1662 6.37127C16 6.69432 16 7.07274 16 7.82957V16.1704C16 16.9273 16 17.3057 16.1662 17.6287C16.3325 17.9518 16.6404 18.1717 17.2563 18.6116L18.8375 19.7411C20.2226 20.7304 20.9152 21.2251 21.4576 20.946C22 20.6668 22 19.8158 22 18.1136Z" fill="currentColor"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.25C12.4142 1.25 12.75 1.58579 12.75 2V6C12.75 6.41421 12.4142 6.75 12 6.75C11.5858 6.75 11.25 6.41421 11.25 6V2C11.25 1.58579 11.5858 1.25 12 1.25ZM12 9.25C12.4142 9.25 12.75 9.58579 12.75 10V14C12.75 14.4142 12.4142 14.75 12 14.75C11.5858 14.75 11.25 14.4142 11.25 14V10C11.25 9.58579 11.5858 9.25 12 9.25ZM12 17.25C12.4142 17.25 12.75 17.5858 12.75 18V22C12.75 22.4142 12.4142 22.75 12 22.75C11.5858 22.75 11.25 22.4142 11.25 22V18C11.25 17.5858 11.5858 17.25 12 17.25Z" fill="currentColor"/>
</svg>`;
                    flipBtn.setAttribute('aria-label', 'Flip image');
                    flipBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleImageFlip(node.id);
                    });

                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'remove-image-btn';
                    removeBtn.title = 'Remove image';
                    removeBtn.innerHTML = '<span class="icon icon-delete" aria-hidden="true"></span>';
                    removeBtn.setAttribute('aria-label', 'Remove image');
                    removeBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        saveState();
                        node.image = null;
                        renderAndRestoreFocus(getCurrentPage(), node.id);
                    });

                    buttonsContainer.appendChild(flipBtn);
                    buttonsContainer.appendChild(removeBtn);

                    container.appendChild(buttonsContainer);

                    attachImageDragHandlers(img, asset, container);
                }
            }
        } else {
            container.innerHTML = '';
        }
    } else if (node.text !== null && node.text !== undefined) {
        renderTextContent(container, node, false, options);
    } else {
        // Empty rectangle - show hover prompt
        container.innerHTML = '';
        container.style.position = 'relative';

        if (!options.hideControls) {
            const prompt = document.createElement('div');
            prompt.className = 'text-prompt';
            prompt.textContent = 'Click to split / Type to write';
            container.appendChild(prompt);

            const emptyNodeControls = document.createElement('div');
            emptyNodeControls.className = 'empty-node-controls';

            const importBtn = document.createElement('button');
            importBtn.className = 'import-image-btn';
            importBtn.title = 'Import Image';
            importBtn.innerHTML = `
<svg width="20px" height="20px" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M1 1H15V15H1V1ZM6 9L8 11L13 6V13H3V12L6 9ZM6.5 7C7.32843 7 8 6.32843 8 5.5C8 4.67157 7.32843 4 6.5 4C5.67157 4 5 4.67157 5 5.5C5 6.32843 5.67157 7 6.5 7Z" fill="currentColor"/>
</svg>`;
            importBtn.setAttribute('aria-label', 'Import image');
            importBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                importImageToNode(node.id);
            });

            emptyNodeControls.appendChild(importBtn);
            container.appendChild(emptyNodeControls);

            // Allow click to bubble to parent for splitting (handled in main.js -> handleSplitClick)
            // We only intercept keys to start writing
            container.addEventListener('keydown', (e) => {
                // Ignore modifiers, navigation keys, etc. if they are not printing characters
                if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    createTextInRect(node.id, e.key);
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        }
    }
}

function renderTextContent(container, node, startInEditMode = false, options = {}) {
    // Check if we should start in edit mode
    // ... (rest of implementation)
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
    // Hide placeholder and empty content if hiding controls (export)
    if (options.hideControls && !node.text) {
        preview.innerHTML = '';
    } else {
        preview.innerHTML = DOMPurify.sanitize(marked.parse(node.text || '')) || '<span class="text-placeholder">Click to edit...</span>';
    }

    preview.className = `markdown-content ${isCentered ? 'text-center' : ''} ${startInEditMode ? 'hidden' : ''}`;
    preview.draggable = !options.hideControls;

    // ... (editor logic)
    // Editor
    const editor = document.createElement('textarea');
    // Hide editor in export
    editor.className = `text-editor ${isCentered ? 'text-center' : ''} ${startInEditMode ? '' : 'hidden'} ${options.hideControls ? 'hidden' : ''}`;
    // ...
    editor.value = node.text || '';
    editor.placeholder = 'Write Markdown here...';

    // ... (append preview and editor) ...
    // ... (listeners) ...
    // Auto-focus if starting in edit mode
    if (startInEditMode && !options.hideControls) {
        container.classList.add('is-editing');
        setTimeout(() => editor.focus(), 0);
    }

    if (!options.hideControls) {
        // Only attach interactive listeners if controls are not hidden
        editor.addEventListener('focus', () => {
            container.classList.add('is-editing');
        });

        // ... (other listeners)

        // Drag preview
        preview.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            dragDropService.startDrag({ text: node.text, textAlign: node.textAlign, sourceRect: container, sourceTextNode: node }, e);
        });

        // Touch support
        preview.addEventListener('touchstart', (e) => handleTouchStart(e, { text: node.text, textAlign: node.textAlign, sourceRect: container, sourceTextNode: node }), { passive: false });
        preview.addEventListener('touchmove', handleTouchMove, { passive: false });
        preview.addEventListener('touchend', handleTouchEnd);


        // Click preview: enter edit mode
        preview.addEventListener('click', (e) => {
            if (e.shiftKey || e.ctrlKey || e.altKey) return;
            e.stopPropagation();
            preview.classList.add('hidden');
            editor.classList.remove('hidden');
            editor.focus();
        });

        // ... (Editor listeners, pair completion, etc) ...
        editor.addEventListener('click', (e) => {
            if (e.shiftKey || e.ctrlKey || e.altKey) return;
            e.stopPropagation();
        });
        editor.addEventListener('input', () => {
            node.text = editor.value;
            preview.innerHTML = DOMPurify.sanitize(marked.parse(node.text || '')) || '<span class="text-placeholder">Click to edit...</span>';
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        });

        // ... (keydown handler from before) ...
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

                // Get the current line
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const lineEnd = value.indexOf('\n', start);
                const line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

                // Check if this is a list item
                const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+.*)?$/);

                if (listMatch && !e.shiftKey) {
                    // Add indentation before the list marker
                    const currentIndent = listMatch[1];
                    const marker = listMatch[2];
                    const rest = listMatch[3] || '';
                    const newIndent = currentIndent + '  ';
                    const newLine = newIndent + marker + rest;

                    editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
                    editor.selectionStart = editor.selectionEnd = start + 2;
                    editor.dispatchEvent(new Event('input'));
                } else if (e.shiftKey && listMatch) {
                    // Shift+Tab: Remove indentation
                    const currentIndent = listMatch[1];
                    if (currentIndent.length >= 2) {
                        const marker = listMatch[2];
                        const rest = listMatch[3] || '';
                        const newIndent = currentIndent.substring(2);
                        const newLine = newIndent + marker + rest;

                        editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
                        editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 2);
                        editor.dispatchEvent(new Event('input'));
                    }
                } else {
                    // Regular Tab behavior for non-list lines
                    const before = value.substring(0, start);
                    const after = value.substring(end);
                    editor.value = before + '  ' + after;
                    editor.selectionStart = editor.selectionEnd = start + 2;
                    editor.dispatchEvent(new Event('input'));
                }
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
                } else {
                    // Preserve indentation for non-list lines
                    const indentMatch = line.match(/^(\s*)$/);
                    if (indentMatch && indentMatch[1].length > 0) {
                        // Line is only whitespace - dedent (similar to list exit behavior)
                        e.preventDefault();
                        const lineStart = start - line.length;
                        editor.value = value.substring(0, lineStart) + '\n' + value.substring(end);
                        editor.selectionStart = editor.selectionEnd = lineStart + 1;
                        editor.dispatchEvent(new Event('input'));
                    } else {
                        // Line has content - preserve indentation
                        const contentIndentMatch = line.match(/^(\s+)/);
                        if (contentIndentMatch) {
                            e.preventDefault();
                            const indent = contentIndentMatch[1];
                            const prefix = '\n' + indent;
                            editor.value = value.substring(0, start) + prefix + value.substring(end);
                            editor.selectionStart = editor.selectionEnd = start + prefix.length;
                            editor.dispatchEvent(new Event('input'));
                        }
                    }
                }
            }

            // Escape to exit edit mode
            if (e.key === 'Escape') {
                e.preventDefault();
                editor.blur(); // Blur triggers the blur handler which resets UI
                return;
            }

            // Ctrl + K for Link (with selection)
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const selection = editor.value.substring(start, end);
                if (selection) {
                    const linkText = `[${selection}](url)`;
                    editor.setRangeText(linkText, start, end, 'select');
                    // Select "url" part
                    editor.selectionStart = start + selection.length + 3;
                    editor.selectionEnd = editor.selectionStart + 3;
                } else {
                    const linkText = `[link text](url)`;
                    editor.setRangeText(linkText, start, end, 'select');
                }
                editor.dispatchEvent(new Event('input'));
            }
        });

        // Handle blur
        editor.addEventListener('blur', () => {
            window._justFinishedEditing = true;
            setTimeout(() => { window._justFinishedEditing = false; }, 100);
            container.classList.remove('is-editing');
            editor.classList.add('hidden');
            preview.classList.remove('hidden');
            saveState();
            const parentRect = container.closest('.splittable-rect');
            if (parentRect) parentRect.focus();
        });

        // Alignment toggle button
        const alignBtn = document.createElement('button');
        alignBtn.id = `align-btn-${node.id}`;
        alignBtn.className = `align-text-btn`;
        alignBtn.title = isCentered ? 'Align Left' : 'Align Center';

        const leftIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 4C2.44772 4 2 4.44772 2 5V5.5C2 6.05228 2.44772 6.5 3 6.5H21C21.5523 6.5 22 6.05228 22 5.5V5C22 4.44772 21.5523 4 21 4H3Z" fill="currentColor"/><path d="M3 13C2.44772 13 2 13.4477 2 14V14.5C2 15.0523 2.44772 15.5 3 15.5H21C21.5523 15.5 22 15.0523 22 14.5V14C22 13.4477 21.5523 13 21 13H3Z" fill="currentColor"/><path d="M2 9.5C2 8.94772 2.44772 8.5 3 8.5H15C15.5523 8.5 16 8.94772 16 9.5V10C16 10.5523 15.5523 11 15 11H3C2.44772 11 2 10.5523 2 10V9.5Z" fill="currentColor"/><path d="M3 17.5C2.44772 17.5 2 17.9477 2 18.5V19C2 19.5523 2.44772 20 3 20H15C15.5523 20 16 19.5523 16 19V18.5C16 17.9477 15.5523 17.5 15 17.5H3Z" fill="currentColor"/></svg>`;
        const centerIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 4C2.44772 4 2 4.44772 2 5V5.5C2 6.05228 2.44772 6.5 3 6.5H21C21.5523 6.5 22 6.05228 22 5.5V5C22 4.44772 21.5523 4 21 4H3Z" fill="currentColor"/><path d="M3 13C2.44772 13 2 13.4477 2 14V14.5C2 15.0523 2.44772 15.5 3 15.5H21C21.5523 15.5 22 15.0523 22 14.5V14C22 13.4477 21.5523 13 21 13H3Z" fill="currentColor"/><path d="M5 9.5C5 8.94772 5.44772 8.5 6 8.5H18C18.5523 8.5 19 8.94772 19 9.5V10C19 10.5523 18.5523 11 18 11H6C5.44772 11 5 10.5523 5 10V9.5Z" fill="currentColor"/><path d="M6 17.5C5.44772 17.5 5 17.9477 5 18.5V19C5 19.5523 5.44772 20 6 20H18C18.5523 20 19 19.5523 19 19V18.5C19 17.9477 18.5523 17.5 18 17.5H6Z" fill="currentColor"/></svg>`;

        alignBtn.innerHTML = isCentered ? leftIcon : centerIcon;
        alignBtn.setAttribute('aria-label', isCentered ? 'Align Left' : 'Align Center');

        alignBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTextAlignment(node.id);
        });

        const removeBtn = document.createElement('button');
        removeBtn.id = `remove-text-btn-${node.id}`;
        removeBtn.className = 'remove-text-btn';
        removeBtn.title = 'Remove text';
        removeBtn.setAttribute('aria-label', 'Remove text');
        removeBtn.innerHTML = '<span class="icon icon-delete" aria-hidden="true"></span>';
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            saveState();
            node.text = null;
            node.textAlign = null;
            renderAndRestoreFocus(getCurrentPage(), node.id);
        });

        const textControls = document.createElement('div');
        textControls.className = 'text-controls';
        textControls.appendChild(alignBtn);
        textControls.appendChild(removeBtn);

        editorContainer.appendChild(preview);
        editorContainer.appendChild(editor);
        editorContainer.appendChild(textControls);
    } else {
        editorContainer.appendChild(preview);
        // We still append editor but it's hidden, to avoid breaking structure if CSS relies on it, 
        // though strictly we could skip it.
        // But simpler to just append what we have.
    }

    container.appendChild(editorContainer);
}

function createDOMRect(node, parentOrientation) {
    const div = document.createElement('div');
    div.id = node.id;
    div.className = 'splittable-rect rectangle-base flex items-center justify-center';

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

function createDOMDivider(parentNode, rectA, rectB, options = {}) {
    const divider = document.createElement('div');
    divider.className = `divider no-select flex-shrink-0 ${parentNode.orientation}-divider`;
    divider.setAttribute('data-orientation', parentNode.orientation);
    divider.setAttribute('data-rect-a-id', rectA.id);
    divider.setAttribute('data-rect-b-id', rectB.id);
    divider.setAttribute('data-parent-id', parentNode.id);

    if (!options.hideControls) {
        divider.addEventListener('mousedown', startDrag);
        divider.addEventListener('touchstart', startDrag, { passive: false });
    }
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

function renderPageNumber(container) {
    const settings = getSettings();
    if (!settings.paper.showPageNumbers) return;

    const pageNumber = document.createElement('div');
    pageNumber.className = 'paper-page-number';
    pageNumber.textContent = `${state.currentPageIndex + 1}`;

    // Position it at the bottom center or bottom right
    container.appendChild(pageNumber);
}

export function renderBackgroundImage(container) {
    const settings = getSettings();

    // Always remove existing background image element first
    const existing = container.querySelector('.paper-bg-image');
    if (existing) existing.remove();

    if (!settings.paper.backgroundImage) return;

    const bg = document.createElement('div');
    bg.className = 'paper-bg-image';
    bg.style.position = 'absolute';
    bg.style.top = '0';
    bg.style.left = '0';
    bg.style.width = '100%';
    bg.style.height = '100%';
    bg.style.backgroundImage = `url(${settings.paper.backgroundImage})`;
    bg.style.backgroundSize = 'cover';
    bg.style.backgroundPosition = 'center';
    // Use CSS variable for real-time updates without re-render
    bg.style.opacity = 'var(--bg-image-opacity, 0.2)';
    bg.style.pointerEvents = 'none';
    bg.style.zIndex = '0'; // Behind everything including rects

    // Insert at the beginning so it's behind everything else in DOM
    container.insertBefore(bg, container.firstChild);
}
