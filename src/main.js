import { undo, redo, saveState } from './js/io/history.js';

import { handleSplitClick, createTextInRect, renderAndRestoreFocus } from './js/layout/layout.js';
import { setupAssetHandlers, setupDropHandlers } from './js/assets/assets.js';
import { renderPageList } from './js/layout/pages.js';
import { state, getCurrentPage, addPage, duplicatePage } from './js/core/state.js';
import { renderLayout } from './js/layout/renderer.js';
import { marked } from 'marked';
import { assetManager } from './js/assets/AssetManager.js';
import { getSettings } from './js/ui/settings.js';
import DOMPurify from 'dompurify';
import { DIVIDER_SIZE } from './js/core/constants.js';
import { setupSettingsHandlers } from './js/ui/settings.js';
import { setupGlobalErrorHandler } from './js/core/errorHandler.js';
import { setupPageHandlers } from './js/layout/pages.js';
import { setupFileIOHandlers, saveLayout, saveLayoutAs, openLayout } from './js/io/fileIO.js';
import { importImageToNode, handleTouchStart, handleTouchMove, handleTouchEnd } from './js/assets/assets.js';
import { setupKeyboardNavigation } from './js/ui/keyboard.js';
import { findNodeById, toggleTextAlignment, startDrag, startEdgeDrag, handleDividerMerge } from './js/layout/layout.js';

import { dragDropService } from './js/ui/DragDropService.js';
import { setupPlatformAdapters } from './js/core/platform.js';
import { showUnsavedChangesModal } from './js/core/utils.js';
import { handleEditorKeydown } from './js/ui/editor.js';
import { initializeExportMode } from './js/io/export.js';
import { tooltipManager } from './js/ui/TooltipManager.js';

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

        // Save: Ctrl + S
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            saveLayout();
        }

        // Save As: Ctrl + Shift + S
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            saveLayoutAs();
        }

        // New Page: Ctrl + N
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            saveState();
            addPage();
            renderAndRestoreFocus(getCurrentPage());
            renderPageList();
        }

        // Duplicate Page: Ctrl + Shift + N
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            saveState();
            duplicatePage(state.currentPageIndex);
            renderAndRestoreFocus(getCurrentPage());
            renderPageList();
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

    // Global Link Interceptor (for Electron)
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href && (link.href.startsWith('http') || link.href.startsWith('mailto:'))) {
            const isElectron = window.electronAPI && window.electronAPI.isElectron;
            if (isElectron) {
                e.preventDefault();
                window.electronAPI.openExternal(link.href);
            }
        }
    });
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
    setupGlobalHandlers();
    setupSettingsHandlers();
    setupFileIOHandlers();
    loadShortcuts();
    setupPageHandlers();
    setupShortcutsHandlers();
    setupDelegatedHandlers();
    setupKeyboardNavigation();

    // UI Updates for Dirty State and File Path
    const saveBtn = document.getElementById('save-layout-btn');
    const saveBtnText = saveBtn?.querySelector('span:not(.icon)');

    document.addEventListener('dirtyChanged', (e) => {
        if (saveBtn) {
            if (e.detail.isDirty) {
                saveBtn.classList.add('is-dirty');
            } else {
                saveBtn.classList.remove('is-dirty');
            }
        }
    });

    document.addEventListener('filePathChanged', (e) => {
        if (saveBtnText) {
            saveBtnText.textContent = e.detail.path ? 'Save' : 'Save new layout';
        }
    });

    // Initial state check
    if (saveBtnText) {
        saveBtnText.textContent = state.currentFilePath ? 'Save' : 'Save new layout';
    }

    if (window.electronAPI && window.electronAPI.onSaveLayout) {
        window.electronAPI.onSaveLayout((options) => {
            saveLayout(options);
        });
    }

    if (window.electronAPI && window.electronAPI.onOpenFile) {
        window.electronAPI.onOpenFile((path) => {
            openLayout(path);
        });
    }

    if (window.electronAPI && window.electronAPI.onSaveLayoutAs) {
        window.electronAPI.onSaveLayoutAs(() => {
            saveLayoutAs();
        });
    }

    if (window.electronAPI && window.electronAPI.onRequestClose) {
        window.electronAPI.onRequestClose(async () => {
            const result = await showUnsavedChangesModal();
            if (result === 'save') {
                await saveLayout({ closeAfterSave: true });
            } else if (result === 'discard') {
                window.electronAPI.forceClose();
            }
            // cancel = do nothing
        });
    }

    let lastMousePos = { x: 0, y: 0 };
    window.addEventListener('mousemove', (e) => {
        lastMousePos.x = e.clientX;
        lastMousePos.y = e.clientY;
    }, { passive: true });

    /**
     * Updates the hover state based on DOM events rather than coordinates.
     * Use event.target instead of elementFromPoint.
     */
    const handleMouseOver = (e) => {
        // Optimization: Skip hover updates during active divider resizing
        if (state.activeDivider) return;

        // BUG FIX: Don't steal focus if we are currently editing text
        if (document.activeElement?.classList.contains('text-editor')) return;

        const target = e.target;

        // 1. Check if we entered a splittable rect
        const rect = target.closest('.splittable-rect[data-split-state="unsplit"]');

        if (rect && rect.id !== lastHoveredRectId) {
            // Clear previous hover
            if (lastHoveredRectId) {
                document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
            }

            lastHoveredRectId = rect.id;
            rect.classList.add('is-hovered-active');


            // Re-enable autofocus on hover (safe now due to CSS/JS optimizations)
            rect.focus({ preventScroll: true });
        }
        else if (!rect && lastHoveredRectId) {
            const isInteractionLayer = target.closest('.divider, .edge-handle, .floating-btn, .image-controls');
            if (isInteractionLayer) {
            }

            if (!rect) {
                document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
                lastHoveredRectId = null;
            }
        }
    };

    // Listen for layout updates to manage focus and reset selection state
    document.addEventListener('layoutUpdated', () => {
        lastHoveredRectId = null;

        // Feature: Follow-mouse focus (restore hover focus after a DOM re-render)
        // We use requestAnimationFrame to ensure the DOM is painted and elementFromPoint reflects the new layout.
        requestAnimationFrame(() => {
            // BUG FIX: Don't steal focus if we are currently editing text!
            // Otherwise, every keystroke triggers an input event -> layoutUpdated -> focus theft -> exit edit mode.
            if (document.activeElement?.classList.contains('text-editor')) return;

            const target = document.elementFromPoint(lastMousePos.x, lastMousePos.y);
            const rect = target?.closest('.splittable-rect[data-split-state="unsplit"]');
            if (rect) {
                rect.focus({ preventScroll: true });
            }
        });
    });

    // Handle settings updates that require re-render (breaking circular dependency)
    document.addEventListener('settingsUpdated', (e) => {
        // Optimization: Some settings only update CSS variables and don't need a full DOM re-render.
        // We only re-render if it's NOT a 'css-only' update.
        if (e.detail && e.detail.cssOnly) return;

        const paper = document.getElementById('a4-paper');
        if (paper) {
            renderAndRestoreFocus(getCurrentPage());
        }
    });

    // Use mouseover for lightweight hover detection
    document.addEventListener('mouseover', handleMouseOver);

    // Hide overlay and clear focus when mouse leaves the paper
    const paperContainer = document.querySelector('.workspace-wrapper');
    if (paperContainer) {
        paperContainer.setAttribute('tabindex', '-1'); // Allow clearing focus by clicking background
        paperContainer.addEventListener('mouseleave', () => {
            document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
            lastHoveredRectId = null;

            // Clear focus if it's currently on a rectangle, to hide floating buttons
            const paper = document.getElementById('a4-paper');
            if (paper && paper.contains(document.activeElement) && document.activeElement.classList.contains('splittable-rect')) {
                document.activeElement.blur();
            }
        });
    }

    // Sync lastFocusedRectId when focus changes via keyboard or other means
    document.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('splittable-rect')) {
            lastHoveredRectId = e.target.id;
            state.lastFocusedRectId = e.target.id;

            // Optimization: Only update hints if the overlay is actually enabled/visible.
            // This prevents expensive tree traversals during rapid navigation if the user doesn't even use the hints.
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
    };

    const openShortcuts = () => {
        shortcutsContainer.classList.add('active');
        shortcutsBtn.classList.add('active');
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
        if (e._brocoProcessed) return;
        const divider = e.target.closest('.divider');
        if (divider) {
            // Feature: Ctrl + Click to merge
            // If Ctrl is held, we want to allow the click event to fire instead of starting a drag
            if (e.ctrlKey) return;

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
        if (e._brocoProcessed) return;

        // Only handle primary button (left click) or synthetic events (which usually have button 0)
        // This prevents double-triggering when right-click also dispatches a click event.
        if (e.button !== 0) return;

        // Divider Merge (Ctrl + Click)
        const divider = e.target.closest('.divider');
        if (divider && (e.ctrlKey || e.metaKey)) {
            e._brocoProcessed = true;
            handleDividerMerge(divider);
            e.stopPropagation();
            return;
        }

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
            // If modifiers are pressed, we don't want to enter edit mode, but we DO want to potentially split (fallthrough)
            if (!e.shiftKey && !e.ctrlKey && !e.altKey) {
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
        }

        // Editor click: prevent bubbling only if NO modifiers
        // If modifiers are pressed (e.g. Shift+Click on active editor), we want it to potentially split
        const editor = e.target.closest('.text-editor');
        if (editor) {
            if (!e.shiftKey && !e.ctrlKey && !e.altKey) {
                e.stopPropagation();
                return;
            }
        }

        // Default layout interaction (Split, Delete Rect, Object Fit)
        handleSplitClick(e);
    });

    // Right-Click -> Alt+Click (Electron only)
    paper.addEventListener('contextmenu', (e) => {
        const isElectron = (window.electronAPI && window.electronAPI.isElectron) || /Electron/i.test(navigator.userAgent);
        if (!isElectron) return;

        const rect = e.target.closest('.splittable-rect[data-split-state="unsplit"]');
        if (rect) {
            e.preventDefault();

            rect.focus(); // Ensure focus is moved, similar to left-click
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                altKey: true,
                view: window,
                clientX: e.clientX,
                clientY: e.clientY
            });
            // Dispatch on original target to preserve behavior for inner elements (text previews, etc.)
            e.target.dispatchEvent(clickEvent);
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

    // Input delegation for live preview
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

    // Consolidated editor keydown logic (tab, enter, auto-pairing, etc.)
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
}

if (window.__BROCO_INITIALIZED__) {
    console.log('BROCO already initialized, skipping duplicate load.');
} else {
    window.__BROCO_INITIALIZED__ = true;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkModeAndInitialize);
    } else {
        checkModeAndInitialize();
    }
}

function checkModeAndInitialize() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');

    if (mode === 'export') {
        initializeExportMode();
    } else {
        initialize();
    }
}
