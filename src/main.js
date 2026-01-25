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
import { setupPlatformAdapters } from './js/platform.js';

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

    let lastMousePos = { x: 0, y: 0 };

    /**
     * Updates the hover state and focus based on coordinates
     * Useful for recapturing hover after re-renders
     */
    const updateHoverAt = (x, y) => {
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
            if (!paper || !paper.contains(elUnderCursor)) return;

            const rect = elUnderCursor.closest('.splittable-rect[data-split-state="unsplit"]');
            if (!rect) {
                // If we are not over a leaf rect, check if we are over a divider or edge handle
                const isInteractionLayer = elUnderCursor.closest('.divider, .edge-handle');
                if (!isInteractionLayer) {
                    document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
                    lastHoveredRectId = null;
                }
                return;
            }

            // Restore focus follows mouse
            if (rect.id !== lastHoveredRectId || !rect.classList.contains('is-hovered-active')) {
                document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
                rect.classList.add('is-hovered-active');
                rect.focus({ preventScroll: true });
                lastHoveredRectId = rect.id;
            }

            // Update shortcut hints
            const node = findNodeById(getCurrentPage(), rect.id);
            shortcutsOverlay.update(node);

        } catch (err) {
            // Silently ignore
        }
    };

    // Listen for layout updates to manage focus and reset selection state
    document.addEventListener('layoutUpdated', () => {
        updateFocusableRects();
        lastHoveredRectId = null;
        // Recapture hover state after DOM elements were replaced
        updateHoverAt(lastMousePos.x, lastMousePos.y);
    });
    document.addEventListener('stateRestored', updateFocusableRects);

    // Handle settings updates that require re-render (breaking circular dependency)
    document.addEventListener('settingsUpdated', () => {
        const paper = document.getElementById('a4-paper');
        if (paper) {
            renderLayout(paper, getCurrentPage());
            // Recapture hover state after settings change might have re-rendered the DOM
            updateHoverAt(lastMousePos.x, lastMousePos.y);
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

    // Hide overlay when mouse leaves the paper
    const paperContainer = document.querySelector('.workspace-wrapper');
    if (paperContainer) {
        paperContainer.addEventListener('mouseleave', () => {
            shortcutsOverlay.hide();
            document.querySelectorAll('.is-hovered-active').forEach(el => el.classList.remove('is-hovered-active'));
            lastHoveredRectId = null;
        });
    }

    // Sync lastHoveredRectId when focus changes via keyboard or other means
    document.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('splittable-rect')) {
            lastHoveredRectId = e.target.id;

            // Update shortcut hints when focus changes (keyboard or direct click)
            const node = findNodeById(getCurrentPage(), e.target.id);
            shortcutsOverlay.update(node);
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
    renderLayout(document.getElementById('a4-paper'), getCurrentPage());
    updateFocusableRects();

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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
