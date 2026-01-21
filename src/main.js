import { undo, redo } from './js/history.js';
import { handleSplitClick, createTextInRect } from './js/layout.js';
import { setupAssetHandlers, setupDropHandlers } from './js/assets.js';
import { setupExportHandlers } from './js/export.js';
import { state, getCurrentPage } from './js/state.js';
import { renderLayout } from './js/renderer.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { DIVIDER_SIZE } from './js/constants.js';
import { setupSettingsHandlers } from './js/settings.js';
import { setupGlobalErrorHandler } from './js/errorHandler.js';

import { setupPageHandlers } from './js/pages.js';
import { setupFileIOHandlers } from './js/fileIO.js';
import { setupKeyboardNavigation, updateFocusableRects } from './js/keyboard.js';
import { shortcutsOverlay } from './js/ShortcutsOverlay.js';
import { findNodeById } from './js/layout.js';

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
                            renderLayout(document.getElementById('a4-paper'), getCurrentPage());
                            document.dispatchEvent(new CustomEvent('layoutUpdated'));
                        });
                    }
                    // Otherwise, let the native undo work
                }
                // For other inputs, let native undo work
            } else {
                // Not in a text input: trigger global undo
                e.preventDefault();
                undo(() => {
                    renderLayout(document.getElementById('a4-paper'), getCurrentPage());
                    document.dispatchEvent(new CustomEvent('layoutUpdated'));
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
                    renderLayout(document.getElementById('a4-paper'), getCurrentPage());
                    document.dispatchEvent(new CustomEvent('layoutUpdated'));
                });
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

function initialize() {
    let lastHoveredRectId = null;

    // Setup global error handling
    setupGlobalErrorHandler();
    setupAssetHandlers();
    setupDropHandlers();
    setupExportHandlers();
    setupGlobalHandlers();
    setupSettingsHandlers();
    loadShortcuts();
    setupPageHandlers();
    setupKeyboardNavigation();

    // Sync shortcut overlay with menu state
    const shortcutsDropdown = document.getElementById('shortcuts-dropdown');
    if (shortcutsDropdown) {
        // Initial state
        shortcutsOverlay.setEnabled(shortcutsDropdown.open);

        // Listen for changes
        shortcutsDropdown.addEventListener('toggle', () => {
            shortcutsOverlay.setEnabled(shortcutsDropdown.open);
        });
    }

    // Listen for layout updates to manage focus
    // Listen for layout updates to manage focus and reset selection state
    document.addEventListener('layoutUpdated', () => {
        updateFocusableRects();
        lastHoveredRectId = null;
    });
    document.addEventListener('stateRestored', updateFocusableRects);

    // Global click delegation for rectangles in the paper
    const paper = document.getElementById('a4-paper');
    if (paper) {
        paper.addEventListener('click', (e) => {
            const rect = e.target.closest('.splittable-rect[data-split-state="unsplit"]');
            if (rect) {
                // If the click was specifically on a sub-button like remove, let its own listener handle it
                if (e.target.closest('button')) return;

                // Call handleSplitClick which handles split logic and modifiers
                handleSplitClick(e);
            }
        });
    }

    document.addEventListener('mousemove', (e) => {
        try {
            // Don't steal focus if user is currently typing
            if (document.activeElement &&
                (document.activeElement.tagName === 'TEXTAREA' ||
                    document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.isContentEditable)) {
                return;
            }

            const elUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
            if (!elUnderCursor) return;

            const paper = document.getElementById('a4-paper');
            if (!paper || !paper.contains(elUnderCursor)) return;

            const rect = elUnderCursor.closest('.splittable-rect[data-split-state="unsplit"]');
            if (!rect) return;

            // Focus if rect changed OR if the rect lost focus but we're still hovering over it
            if (rect.id !== lastHoveredRectId || document.activeElement !== rect) {
                rect.focus({ preventScroll: true });
                lastHoveredRectId = rect.id;
            }

            // Update shortcut hints
            const node = findNodeById(getCurrentPage(), rect.id);
            shortcutsOverlay.update(node);

        } catch (err) {
            // Silently ignore errors
        }
    });

    // Hide overlay when mouse leaves the paper
    const paperContainer = document.querySelector('.workspace-wrapper');
    if (paperContainer) {
        paperContainer.addEventListener('mouseleave', () => {
            shortcutsOverlay.hide();
            lastHoveredRectId = null;
        });
    }

    // Sync lastHoveredRectId when focus changes via keyboard or other means
    document.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('splittable-rect')) {
            lastHoveredRectId = e.target.id;
        }
    });

    // Initial render from state
    renderLayout(document.getElementById('a4-paper'), getCurrentPage());
    updateFocusableRects();

    // Auto-focus the first rectangle so keyboard shortcuts work immediately
    const firstRect = document.getElementById('rect-1');
    if (firstRect) {
        firstRect.focus();
    }
}

async function loadShortcuts() {
    const container = document.getElementById('shortcuts-content');
    if (!container) return;

    try {
        const response = await fetch('/assets/shortcuts.md');
        if (!response.ok) throw new Error('Failed to load shortcuts');
        const text = await response.text();

        // Use marked for true markdown support with GFM line breaks enabled
        // Sanitize output to prevent XSS from malicious content
        const html = DOMPurify.sanitize(marked.parse(text, { breaks: true }));

        container.className = 'shortcuts-content';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading shortcuts:', error);
        container.innerHTML = '<p>Shortcuts list currently unavailable.</p>';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
