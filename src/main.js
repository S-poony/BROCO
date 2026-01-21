import { undo, redo } from './js/history.js';
import { handleSplitClick, rebindEvents, createTextInRect } from './js/layout.js';
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
                        undo(rebindEvents);
                    }
                    // Otherwise, let the native undo work
                }
                // For other inputs, let native undo work
            } else {
                // Not in a text input: trigger global undo
                e.preventDefault();
                undo(rebindEvents);
            }
        }

        // Redo: Ctrl + Y or Ctrl + Shift + Z
        if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
            const target = e.target;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            // Only trigger global redo if NOT in a text input
            if (!isInput) {
                e.preventDefault();
                redo(rebindEvents);
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
    setupGlobalErrorHandler();
    setupAssetHandlers();
    setupDropHandlers();
    setupExportHandlers();
    setupGlobalHandlers();
    setupSettingsHandlers();
    loadShortcuts();
    setupPageHandlers();
    setupKeyboardNavigation();

    // Listen for layout updates to manage focus
    document.addEventListener('layoutUpdated', updateFocusableRects);
    document.addEventListener('stateRestored', updateFocusableRects);

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
