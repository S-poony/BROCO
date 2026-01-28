import { state, addPage, duplicatePage, getCurrentPage } from '../core/state.js';
import { handleSplitClick, createTextInRect, findNodeById, swapNodesContent, renderAndRestoreFocus, snapDivider, findMergeableParent, mergeNodes } from '../layout/layout.js';
import { undo, redo, saveState } from '../io/history.js';
import { renderLayout } from '../layout/renderer.js';
import { renderPageList } from '../layout/pages.js';
import { saveLayout } from '../io/fileIO.js';
import { A4_PAPER_ID } from '../core/constants.js';

import { showConfirm } from '../core/utils.js';

/**
 * Setup keyboard navigation handlers
 */
export function setupKeyboardNavigation() {
    // Use capture phase to ensure we intercept shortcuts before browser/default behaviors
    document.addEventListener('keydown', handleKeyDown, true);

    // Electron-specific IPC shortcut listener
    if (window.electronAPI && window.electronAPI.onLongSplit) {
        window.electronAPI.onLongSplit(() => {
            const focused = document.activeElement;
            if (focused && focused.classList.contains('splittable-rect')) {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    altKey: true,
                    view: window
                });
                focused.dispatchEvent(clickEvent);
            }
        });

        window.electronAPI.onNewPage(() => {
            saveState();
            addPage();
            renderAndRestoreFocus(getCurrentPage());
            renderPageList();
        });

        window.electronAPI.onDuplicatePage(() => {
            saveState();
            duplicatePage(state.currentPageIndex);
            renderAndRestoreFocus(getCurrentPage());
            renderPageList();
        });

        window.electronAPI.onSaveLayout(() => {
            saveLayout();
        });
    }
}

/**
 * Handle keydown events for navigation and actions
 * @param {KeyboardEvent} e 
 */
function handleKeyDown(e) {
    // Ignore if typing in an input or textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        // Allow default behavior for inputs (typing, moving cursor)
        return;
    }

    const focused = document.activeElement;
    const isRect = focused && focused.classList.contains('splittable-rect');

    if (!isRect) return;

    // Check code for Space to avoid layout issues/modifiers changing key
    if (e.code === 'Space') {
        const isElectron = (window.electronAPI && window.electronAPI.isElectron) || /Electron/i.test(navigator.userAgent);

        // Block Alt+Space in non-Electron (browser)
        // In Electron, Alt+Space is now handled via IPC in setupKeyboardNavigation
        // to block the Windows system menu. Normal Space/Shift+Space/Ctrl+Space are handled here.
        if (e.altKey) {
            if (!isElectron) return;
            // If we are in Electron and Alt is pressed, we expect the IPC to handle it
            // but we still e.preventDefault() to be safe if it leaked through (it shouldn't)
            e.preventDefault();
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            altKey: false, // Alt should be false here, as Alt+Space is handled by IPC
            metaKey: e.metaKey,
            view: window
        });
        focused.dispatchEvent(clickEvent);
        return;
    }

    switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
                moveContent(focused, e.key);
            } else if (e.altKey) {
                snapDivider(focused, e.key);
            } else if (e.ctrlKey) {
                const parentToMerge = findMergeableParent(focused, e.key);
                if (parentToMerge) {
                    mergeNodes(parentToMerge);
                }
            } else {
                navigateRects(focused, e.key);
            }
            break;

        case 'Enter':
            e.preventDefault();
            e.stopPropagation();
            // Pass null to keep existing text, or init empty if new
            createTextInRect(focused.id, null);
            break;

        case 'Delete':
        case 'Backspace':
            e.preventDefault();
            e.stopPropagation();
            deleteFocusedRect(focused);
            break;

        default:
            // Type to edit: if a single printable character (length 1) is pressed while focused on a rect
            if (isRect && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                createTextInRect(focused.id, e.key);
            }
            break;
    }
}

/**
 * Find the closest rectangle in a given direction
 * @param {HTMLElement} current 
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 * @returns {HTMLElement|null}
 */
export function getClosestRect(current, direction) {
    const allRects = Array.from(document.querySelectorAll('.splittable-rect[data-split-state="unsplit"]'));
    if (allRects.length <= 1) return null;

    const currentRect = current.getBoundingClientRect();
    const currentCenter = {
        x: currentRect.left + currentRect.width / 2,
        y: currentRect.top + currentRect.height / 2
    };

    let closest = null;
    let minDist = Infinity;

    allRects.forEach(rect => {
        if (rect === current) return;

        const r = rect.getBoundingClientRect();
        const center = {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2
        };

        let dist = Infinity;
        let isValid = false;

        switch (direction) {
            case 'ArrowUp':
                if (center.y < currentCenter.y) {
                    isValid = true;
                    // Weighted distance: minimize x deviation
                    dist = Math.abs(currentCenter.y - center.y) + Math.abs(currentCenter.x - center.x) * 2;
                }
                break;
            case 'ArrowDown':
                if (center.y > currentCenter.y) {
                    isValid = true;
                    dist = Math.abs(center.y - currentCenter.y) + Math.abs(currentCenter.x - center.x) * 2;
                }
                break;
            case 'ArrowLeft':
                if (center.x < currentCenter.x) {
                    isValid = true;
                    dist = Math.abs(currentCenter.x - center.x) + Math.abs(currentCenter.y - center.y) * 2;
                }
                break;
            case 'ArrowRight':
                if (center.x > currentCenter.x) {
                    isValid = true;
                    dist = Math.abs(center.x - currentCenter.x) + Math.abs(currentCenter.y - center.y) * 2;
                }
                break;
        }

        if (isValid && dist < minDist) {
            minDist = dist;
            closest = rect;
        }
    });

    return closest;
}

/**
 * Move content between rectangles using Shift + Arrow keys
 * @param {HTMLElement} current 
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 */
function moveContent(current, direction) {
    const closest = getClosestRect(current, direction);
    if (!closest) return;

    const sourceNode = findNodeById(getCurrentPage(), current.id);
    const targetNode = findNodeById(getCurrentPage(), closest.id);

    if (sourceNode && targetNode) {
        saveState();
        swapNodesContent(sourceNode, targetNode);
        // Render and shift focus to the target node
        renderAndRestoreFocus(getCurrentPage(), closest.id);
    }
}

/**
 * Navigate between rectangles using arrow keys
 * @param {HTMLElement} current 
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 */
function navigateRects(current, direction) {
    const closest = getClosestRect(current, direction);
    if (closest) {
        closest.focus();
    }
}

/**
 * Delete the focused rectangle (simulates Ctrl+Click)
 * @param {HTMLElement} rect 
 */
function deleteFocusedRect(rect) {
    // Create a synthetic event masquerading as a Ctrl+Click
    const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true
    });
    // We need to confirm if it's the root rect, which implementation prevents deleting usually
    rect.dispatchEvent(clickEvent);
}

