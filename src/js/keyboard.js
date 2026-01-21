import { state } from './state.js';
import { handleSplitClick, createTextInRect } from './layout.js';
import { undo, redo } from './history.js';
import { rebindEvents } from './layout.js';
import { showConfirm } from './utils.js';

/**
 * Setup keyboard navigation handlers
 */
export function setupKeyboardNavigation() {
    // Use capture phase to ensure we intercept shortcuts before browser/default behaviors
    document.addEventListener('keydown', handleKeyDown, true);
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
        // Removed Alt+Space shortcuts due to Windows conflicts
        if (e.altKey) return;

        e.preventDefault();
        e.stopPropagation();

        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey, // Keep Ctrl if used
            altKey: false,     // Explicitly false since we abort on Alt
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
            navigateRects(focused, e.key);
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
 * Navigate between rectangles using arrow keys
 * @param {HTMLElement} current 
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 */
function navigateRects(current, direction) {
    const allRects = Array.from(document.querySelectorAll('.splittable-rect[data-split-state="unsplit"]'));
    if (allRects.length <= 1) return;

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

/**
 * Set tabindex for all leaf rectangles
 * Should be called after render updates
 */
export function updateFocusableRects() {
    // Remove tabindex from split parents (focus should only be on leaves)
    document.querySelectorAll('.splittable-rect[data-split-state="split"]').forEach(el => {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
    });

    // Add tabindex to leaves
    document.querySelectorAll('.splittable-rect[data-split-state="unsplit"]').forEach(el => {
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');

        const hasContent = el.querySelector('img') || el.querySelector('.text-content');
        const label = hasContent
            ? 'Content region. Press Delete to remove, Enter to edit options.'
            : 'Empty region. Press Enter to split, Alt+Enter to split vertically.';

        el.setAttribute('aria-label', label);
    });
}
