import { undo, redo, saveState } from './js/io/history.js';

import { handleSplitClick, createTextInRect, renderAndRestoreFocus } from './js/layout/layout.js';
import { setupAssetHandlers, setupDropHandlers } from './js/assets/assets.js';
import { setupExportHandlers } from './js/io/export.js';
import { state, getCurrentPage } from './js/core/state.js';
import { renderLayout } from './js/layout/renderer.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { DIVIDER_SIZE } from './js/core/constants.js';
import { setupSettingsHandlers } from './js/ui/settings.js';
import { setupGlobalErrorHandler } from './js/core/errorHandler.js';

import { setupPageHandlers } from './js/layout/pages.js';
import { setupFileIOHandlers } from './js/io/fileIO.js';
import { importImageToNode, handleTouchStart, handleTouchMove, handleTouchEnd } from './js/assets/assets.js';
import { setupKeyboardNavigation } from './js/ui/keyboard.js';
import { shortcutsOverlay } from './js/ui/ShortcutsOverlay.js';
import { findNodeById, toggleTextAlignment, startDrag, startEdgeDrag } from './js/layout/layout.js';
import { dragDropService } from './js/ui/DragDropService.js';
import { setupPlatformAdapters } from './js/core/platform.js';

function setupGlobalHandlers() {
    window.addEventListener('keydown', (e) => {
        // Ctrl Key for Cursor (only if Shift is not held)
        if (e.ctrlKey && !e.shiftKey) {
            document.body.classList.add('ctrl-pressed');
        } else if (e.shiftKey) {
            document.body.classList.remove('ctrl-pressed');
        }

        // Undo: Ctrl + Z
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
            const target = e.target;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isInput) {
                // If we're in a text editor and it's empty (or will be after browser undo),
                // we should trigger global undo instead
                if (target.tagName === 'TEXTAREA') {
                    // Check if the textarea is empty or has minimal content
                    const isEmpty = !target.value || target.value.trim() === '';

                    if (isEmpty) {
                        // Empty editor: trigger global undo to remove the text node
                        e.preventDefault();
                        undo(() => {
                            renderAndRestoreFocus(getCurrentPage());
                        });
                    }
                    // Otherwise, let the native undo work
                }
                // For other inputs, let native undo work
            } else {
                // Not in a text input: trigger global undo
                e.preventDefault();
                undo(() => {
                    renderAndRestoreFocus(getCurrentPage());
                });
            }
        }

        // Redo: Ctrl + Y or Ctrl + Shift + Z
        if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
            const target = e.target;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            // Only trigger global redo if NOT in a text input
            if (!isInput) {
                e.preventDefault();
                redo(() => {
                    renderAndRestoreFocus(getCurrentPage());
                });
            }
        }

        // Global Tab navigation (from body/top level to layout)
        if (e.key === 'Tab' && !e.shiftKey) {
            const target = e.target;

            // If we are on the body, html, or workspace-wrapper, go to the layout
            if (target === document.body || target.tagName === 'HTML' || target.classList.contains('workspace-wrapper')) {
                const firstRect = document.querySelector('.splittable-rect[data-split-state="unsplit"]');
                if (firstRect) {
                    e.preventDefault();
                    firstRect.focus();
                }
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Control' || e.key === 'Shift') {
            // Update cursor based on final state of modifiers
            if (e.ctrlKey && !e.shiftKey) {
                document.body.classList.add('ctrl-pressed');
            } else {
                document.body.classList.remove('ctrl-pressed');
            }
        }
    });

    window.addEventListener('blur', () => {
        document.body.classList.remove('ctrl-pressed');
    });

    // Inject divider size as CSS variable
    document.documentElement.style.setProperty('--divider-size', `${DIVIDER_SIZE}px`);
}

/**
 * Updates the paper scale to fit within the workspace
 */
function updatePaperScale() {
    const paper = document.getElementById('a4-paper');
    const container = document.querySelector('.workspace-wrapper');
    if (!paper || !container) return;

    // Get the actual layout width from CSS variable or fallback
    const rootStyle = getComputedStyle(document.documentElement);
    let paperWidth = parseFloat(rootStyle.getPropertyValue('--paper-width'));

    // Fallback using offsetWidth if variable not set
    if (!paperWidth || isNaN(paperWidth)) {
        // We need to temporarily remove scaling to get true width if it was already applied?
        // Actually offsetWidth usually reports the layout width (untransformed).
        paperWidth = paper.offsetWidth;
    }

    if (!paperWidth) return;

    // Add some padding
    const padding = 40;
    const availableWidth = container.clientWidth - padding;

    // Calculate scale
    let scale = availableWidth / paperWidth;

    // Limit max scale to avoid excessive zooming on huge screens
    // But allow it to go slightly above 1 if screen is really wide and paper is small
    scale = Math.min(scale, 1.0);

    // Apply transform
    paper.style.transform = `scale(${scale})`;
    paper.style.transformOrigin = 'top center';

    // Adjust margin to prevent empty whitespace below
    // Transform does not affect layout flow size, so we need to compensate
    const paperHeight = paper.offsetHeight;
    paper.style.marginBottom = `${paperHeight * (scale - 1)}px`;
}

function initialize() {
    let lastHoveredRectId = null;

    // Setup global error handling
    setupGlobalErrorHandler();

    // Detect Electron and add class to body for styling
    const isElectron = (window.electronAPI && window.electronAPI.isElectron) || /Electron/i.test(navigator.userAgent);
    if (isElectron) {
        document.body.classList.add('is-electron');
    }

    setupPlatformAdapters();
    setupAssetHandlers();
    setupDropHandlers();
    setupExportHandlers();
    setupGlobalHandlers();
    setupSettingsHandlers();
    setupFileIOHandlers();
    loadShortcuts();
    setupPageHandlers();
    setupKeyboardNavigation();

    setupShortcutsHandlers();
    setupDelegatedHandlers();

    let lastMousePos = { x: 0, y: 0 };

    /**
     * Updates the hover state and focus based on coordinates
     * Useful for recapturing hover after re-renders
     * @param {number} x
     * @param {number} y
     * @param {boolean} shouldFocus Default true. If false, only updates hover classes/overlay but doesn't change element focus.
     */
    const updateHoverAt = (x, y, shouldFocus = true) => {
        try {
            // Don't steal focus if user is currently typing
            if (document.activeElement &&
                (document.activeElement.tagName === 'TEXTAREA' ||
                    document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.isContentEditable)) {
                return;
            }

            const elUnderCursor = document.elementFromPoint(x, y);
            if (!elUnderCursor) return;

            const paper = document.getElementById('a4-paper');
            if (!paper || !paper.contains(elUnderCursor)) {
                // If we moved outside paper, clear hover/focus if needed
                if (lastHoveredRectId) {
                    document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
                    lastHoveredRectId = null;
                    shortcutsOverlay.hide();

                    // Only blur if we currently have a rect focused, AND we aren't about to focus a new one
                    // Actually, let's NOT blur if we are moving mouse out, keep it focused for keyboard
                    // if (document.activeElement && document.activeElement.classList.contains('splittable-rect')) {
                    //     document.activeElement.blur();
                    // }
                }
                return;
            }

            const rect = elUnderCursor.closest('.splittable-rect[data-split-state="unsplit"]');
            if (!rect) {
                // If we are not over a leaf rect, check if we are over a divider or edge handle
                const isInteractionLayer = elUnderCursor.closest('.divider, .edge-handle');
                if (!isInteractionLayer) {
                    document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
                    lastHoveredRectId = null;

                    // Don't blur when mouse is over a divider/background, keep keyboard focus
                    // if (document.activeElement && document.activeElement.classList.contains('splittable-rect')) {
                    //     document.activeElement.blur();
                    // }
                }
                return;
            }

            // Restore focus follows mouse
            if (rect && rect.id !== lastHoveredRectId) {
                lastHoveredRectId = rect.id;
                document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
                rect.classList.add('is-hovered-active');

                requestAnimationFrame(() => {
                    const node = findNodeById(getCurrentPage(), rect.id);
                    shortcutsOverlay.update(node);
                });

                if (shouldFocus) {
                    rect.focus({ preventScroll: true });
                }
                lastHoveredRectId = rect.id;
            }

            // Update shortcut hints
            // const node = findNodeById(getCurrentPage(), rect.id);
            // shortcutsOverlay.update(node);

        } catch (err) {
            // Silently ignore
        }
    };

    // Listen for layout updates to manage focus and reset selection state
    document.addEventListener('layoutUpdated', () => {
        lastHoveredRectId = null;
        // Hover state will naturally refresh on the next mouse movement, 
        // avoiding a forced reflow immediately after a render.
    });

    // Handle settings updates that require re-render (breaking circular dependency)
    document.addEventListener('settingsUpdated', () => {
        const paper = document.getElementById('a4-paper');
        if (paper) {
            renderAndRestoreFocus(getCurrentPage());
            // Hover state will naturally refresh on the next mouse movement
        }
    });

    // Global click delegation for rectangles in the paper
    const paper = document.getElementById('a4-paper');
    if (paper) {
        paper.addEventListener('click', (e) => {
            const rect = e.target.closest('.splittable-rect[data-split-state="unsplit"]');
            if (rect) {
                if (e.target.closest('button')) return;
                handleSplitClick(e);
            }
        });
    }

    document.addEventListener('mousemove', (e) => {
        lastMousePos = { x: e.clientX, y: e.clientY };
        updateHoverAt(e.clientX, e.clientY);
    });

    // Hide overlay and clear focus when mouse leaves the paper
    const paperContainer = document.querySelector('.workspace-wrapper');
    if (paperContainer) {
        paperContainer.setAttribute('tabindex', '-1'); // Allow clearing focus by clicking background
        paperContainer.addEventListener('mouseleave', () => {
            shortcutsOverlay.hide();
            document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
            lastHoveredRectId = null;

            // Clear focus if it's currently on a rectangle, to hide floating buttons
            const paper = document.getElementById('a4-paper');
            if (paper && paper.contains(document.activeElement) && document.activeElement.classList.contains('splittable-rect')) {
                document.activeElement.blur();
            }
        });
    }

    // Sync lastHoveredRectId when focus changes via keyboard or other means
    document.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('splittable-rect')) {
            lastHoveredRectId = e.target.id;

            // Update shortcut hints when focus changes (keyboard or direct click)
            requestAnimationFrame(() => {
                const node = findNodeById(getCurrentPage(), e.target.id);
                shortcutsOverlay.update(node);
            });
        }
    });

    document.addEventListener('focusout', (e) => {
        // If we focus out and the next element is not a rect, we might want to hide
        setTimeout(() => {
            const nextFocus = document.activeElement;
            if (!nextFocus || !nextFocus.classList.contains('splittable-rect')) {
                // Check if the mouse is still over a paper container
                // If not, we can hide the overlay
                const paper = document.getElementById('a4-paper');
                const mouseOverPaper = paper && paper.matches(':hover');
                if (!mouseOverPaper) {
                    shortcutsOverlay.hide();
                    lastHoveredRectId = null;
                }
            }
        }, 10);
    });

    // Initial render from state
    renderAndRestoreFocus(getCurrentPage());

    // Auto-focus the first rectangle so keyboard shortcuts work immediately
    const firstRect = document.getElementById('rect-1');
    if (firstRect) {
        firstRect.focus();
    }

    // Initial scale calculation
    // Timeout to ensure CSS variables and layout are settled
    // setTimeout(updatePaperScale, 100);

    // Handle window resize
    // window.addEventListener('resize', () => {
    //     requestAnimationFrame(updatePaperScale);
    // });

    // Listen for settings and layout updates to re-scale
    document.addEventListener('settingsUpdated', () => {
        // setTimeout(updatePaperScale, 50);
    });
    document.addEventListener('layoutUpdated', () => {
        // Layout update might change content height but usually not width? 
        // But if orientation changes it triggers this.
        // setTimeout(updatePaperScale, 50);
    });
}

async function loadShortcuts() {
    const container = document.getElementById('shortcuts-content-list');
    if (!container) return;

    try {
        // Use relative path to support hosting in subdirectories (e.g. GitHub Pages)
        const response = await fetch('assets/shortcuts.md');
        if (!response.ok) throw new Error(`Failed to load shortcuts: ${response.status} ${response.statusText}`);
        const text = await response.text();

        // Use marked for true markdown support with GFM line breaks enabled
        // Sanitize output to prevent XSS from malicious content
        const html = DOMPurify.sanitize(marked.parse(text, { breaks: true }));

        container.className = 'shortcuts-content';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading shortcuts:', error);
        if (container) container.innerHTML = '<p>Shortcuts list currently unavailable.</p>';
    }
}

function setupShortcutsHandlers() {
    const shortcutsBtn = document.getElementById('shortcuts-btn');
    const shortcutsContainer = document.getElementById('shortcuts-container');
    const shortcutsCloseBtn = document.getElementById('shortcuts-close-x');
    const settingsContainer = document.getElementById('settings-container');

    if (!shortcutsBtn || !shortcutsContainer) return;

    const closeShortcuts = () => {
        shortcutsContainer.classList.remove('active');
        shortcutsBtn.classList.remove('active');
        shortcutsOverlay.setEnabled(false);
    };

    const openShortcuts = () => {
        shortcutsContainer.classList.add('active');
        shortcutsBtn.classList.add('active');
        shortcutsOverlay.setEnabled(true);
    };

    const toggleShortcuts = () => {
        if (shortcutsContainer.classList.contains('active')) {
            closeShortcuts();
        } else {
            openShortcuts();
        }
    };

    shortcutsBtn.addEventListener('click', toggleShortcuts);
    shortcutsCloseBtn?.addEventListener('click', closeShortcuts);

    // Close on click outside (for modal mode)
    shortcutsContainer.addEventListener('click', (e) => {
        if (e.target === shortcutsContainer) {
            closeShortcuts();
        }
    });

}

/**
 * Centrally handles interactive events within the paper via delegation
 */
function setupDelegatedHandlers() {
    const paper = document.getElementById('a4-paper');
    if (!paper) return;

    // mousedown for dividers and edge handles
    paper.addEventListener('mousedown', (e) => {
        const divider = e.target.closest('.divider');
        if (divider) {
            startDrag(e, divider);
            return;
        }

        const edgeHandle = e.target.closest('.edge-handle');
        if (edgeHandle) {
            const edge = ['top', 'bottom', 'left', 'right'].find(ed => edgeHandle.classList.contains(`edge-${ed}`));
            if (edge) startEdgeDrag(e, edge);
            return;
        }

        const preview = e.target.closest('.markdown-content');
        if (preview && e.button === 0) {
            // Drag preview start
            const container = preview.closest('.rectangle-base');
            const nodeId = container?.id;
            const node = findNodeById(getCurrentPage(), nodeId);
            if (node) {
                e.preventDefault();
                dragDropService.startDrag({ asset: node.image ? { id: node.image.assetId } : null, text: node.text, textAlign: node.textAlign, sourceRect: container, sourceTextNode: node }, e);
            }
        }
    });

    // touchstart for dividers and edge handles
    paper.addEventListener('touchstart', (e) => {
        const divider = e.target.closest('.divider');
        if (divider) {
            startDrag(e, divider);
            return;
        }

        const edgeHandle = e.target.closest('.edge-handle');
        if (edgeHandle) {
            const edge = ['top', 'bottom', 'left', 'right'].find(ed => edgeHandle.classList.contains(`edge-${ed}`));
            if (edge) startEdgeDrag(e, edge);
            return;
        }

        const preview = e.target.closest('.markdown-content');
        if (preview) {
            const container = preview.closest('.rectangle-base');
            const node = findNodeById(getCurrentPage(), container?.id);
            if (node) {
                handleTouchStart(e, { text: node.text, textAlign: node.textAlign, sourceRect: container, sourceTextNode: node });
            }
        }
    }, { passive: false });

    paper.addEventListener('touchmove', handleTouchMove, { passive: false });
    paper.addEventListener('touchend', handleTouchEnd);

    // Global click delegation
    paper.addEventListener('click', (e) => {
        // Image Import
        const importBtn = e.target.closest('.import-image-btn');
        if (importBtn) {
            const rect = importBtn.closest('.splittable-rect');
            if (rect) importImageToNode(rect.id);
            e.stopPropagation();
            return;
        }

        // Text Alignment
        const alignBtn = e.target.closest('.align-text-btn');
        if (alignBtn) {
            const rect = alignBtn.closest('.splittable-rect');
            if (rect) toggleTextAlignment(rect.id);
            e.stopPropagation();
            return;
        }

        // Remove Text
        const removeTextBtn = e.target.closest('.remove-text-btn');
        if (removeTextBtn) {
            const rect = removeTextBtn.closest('.splittable-rect');
            if (rect) {
                const node = findNodeById(getCurrentPage(), rect.id);
                if (node) {
                    saveState();
                    node.text = null;
                    node.textAlign = null;
                    renderAndRestoreFocus(getCurrentPage(), rect.id);
                }
            }
            e.stopPropagation();
            return;
        }

        // Preview -> Editor flip
        const preview = e.target.closest('.markdown-content');
        if (preview) {
            if (e.shiftKey || e.ctrlKey || e.altKey) return;
            const container = preview.closest('.rectangle-base');
            const editor = container?.querySelector('.text-editor');
            if (editor) {
                e.stopPropagation();
                preview.classList.add('hidden');
                editor.classList.remove('hidden');
                editor.focus();
            }
            return;
        }

        // Editor click: prevent bubbling
        const editor = e.target.closest('.text-editor');
        if (editor) {
            if (e.shiftKey || e.ctrlKey || e.altKey) return;
            e.stopPropagation();
            return;
        }
    });

    // Keydown for starting text entry OR editor logic
    paper.addEventListener('keydown', (e) => {
        const editor = e.target.closest('.text-editor');
        if (editor) {
            handleEditorKeydown(e, editor);
            return;
        }

        const rect = e.target.closest('.splittable-rect[data-split-state="unsplit"]');
        if (rect && !rect.classList.contains('is-editing')) {
            if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                createTextInRect(rect.id, e.key);
                e.preventDefault();
                e.stopPropagation();
            }
        }
    });

    // Input delegation for editor
    paper.addEventListener('input', (e) => {
        const editor = e.target.closest('.text-editor');
        if (editor) {
            const rect = editor.closest('.splittable-rect');
            const node = findNodeById(getCurrentPage(), rect?.id);
            if (node) {
                node.text = editor.value;
                const preview = editor.previousElementSibling; // renderer structure: [preview, editor, controls]
                if (preview && preview.classList.contains('markdown-content')) {
                    preview.innerHTML = DOMPurify.sanitize(marked.parse(node.text || '')) || '<span class="text-placeholder">Click to edit...</span>';
                }
                document.dispatchEvent(new CustomEvent('layoutUpdated'));
            }
        }
    });

    // Focus/Blur delegation for editor
    paper.addEventListener('focusin', (e) => {
        const editor = e.target.closest('.text-editor');
        if (editor) {
            const container = editor.closest('.splittable-rect');
            container?.classList.add('is-editing');
        }
    });

    paper.addEventListener('focusout', (e) => {
        const editor = e.target.closest('.text-editor');
        if (editor) {
            window._justFinishedEditing = true;
            setTimeout(() => { window._justFinishedEditing = false; }, 100);

            const container = editor.closest('.splittable-rect');
            if (container) {
                container.classList.remove('is-editing');
                editor.classList.add('hidden');
                const preview = container.querySelector('.markdown-content');
                if (preview) preview.classList.remove('hidden');
                saveState();
                container.focus();
            }
        }
    });
}

function handleEditorKeydown(e, editor) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;

    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '*': '*', '_': '_', '`': '`' };
    const selection = value.substring(start, end);

    if (pairs[e.key]) {
        e.preventDefault();
        if (e.key === '[' && value[start - 1] === '[') {
            editor.value = value.substring(0, start) + '[' + selection + ']]' + value.substring(end);
            editor.selectionStart = start + 1;
            editor.selectionEnd = start + 1 + selection.length;
        } else {
            editor.value = value.substring(0, start) + e.key + selection + pairs[e.key] + value.substring(end);
            editor.selectionStart = start + 1;
            editor.selectionEnd = start + 1 + selection.length;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    if (e.key === 'Tab') {
        e.preventDefault();
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', start);
        const line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
        const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+.*)?$/);

        if (listMatch) {
            // Indent list
            if (!e.shiftKey) {
                const newLine = listMatch[1] + '  ' + listMatch[2] + (listMatch[3] || '');
                editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
                editor.selectionStart = editor.selectionEnd = start + 2;
            } else if (listMatch[1].length >= 2) {
                const newLine = listMatch[1].substring(2) + listMatch[2] + (listMatch[3] || '');
                editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
                editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 2);
            }
        } else {
            editor.setRangeText('  ', start, end, 'end');
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    if (e.key === 'Enter') {
        const line = value.substring(0, start).split('\n').pop();
        const listMatch = line.match(/^(\s*)([-*+]|(\d+)\.)(\s+)/);
        if (listMatch) {
            e.preventDefault();
            if (line.trim() === listMatch[2]) {
                const lineStart = start - line.length;
                editor.value = value.substring(0, lineStart) + '\n' + value.substring(end);
                editor.selectionStart = editor.selectionEnd = lineStart + 1;
            } else {
                let marker = listMatch[2];
                if (listMatch[3]) marker = (parseInt(listMatch[3], 10) + 1) + '.';
                const prefix = '\n' + listMatch[1] + marker + listMatch[4];
                editor.value = value.substring(0, start) + prefix + value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + prefix.length;
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        editor.blur();
        return;
    }

    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const selection = value.substring(start, end);
        const linkText = selection ? `[${selection}](url)` : `[link text](url)`;
        editor.setRangeText(linkText, start, end, 'select');
        if (selection) {
            editor.selectionStart = start + selection.length + 3;
            editor.selectionEnd = editor.selectionStart + 3;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
