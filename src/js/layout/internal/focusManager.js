import { A4_PAPER_ID } from '../../core/constants.js';
import { renderLayout } from '../renderer.js';
import { syncNodeMap } from '../../core/state.js';


/**
 * Helper to restore focus after render
 * @param {Object} page 
 * @param {string|null} explicitFocusId 
 */
export function renderAndRestoreFocus(page, explicitFocusId = null) {
    // Preserve the actual previous active element ID separately from the explicit target
    const originalFocusedId = document.activeElement ? document.activeElement.id : null;

    // Ensure the nodeMap is O(1) ready for any subsequent lookups (like auto-focus)
    syncNodeMap();

    renderLayout(document.getElementById(A4_PAPER_ID), page);


    // Defer focus restoration until after the browser has finished its layout pass.
    // This prevents "Forced Reflow" violations and layout thrashing.
    requestAnimationFrame(() => {
        let focusRestored = false;

        // Helper to focus element or its first leaf descendant if it's a container
        const smartFocus = (id) => {
            if (!id) return false;
            const el = document.getElementById(id);
            if (!el) return false;

            // If the element is a leaf, focus it
            if (el.getAttribute('tabindex') === '0') {
                el.focus({ preventScroll: true });
                return true;
            }

            // If it's a container (split node), find and focus the first leaf inside it
            const leaf = el.querySelector('.splittable-rect[data-split-state="unsplit"]');
            if (leaf) {
                leaf.focus({ preventScroll: true });
                return true;
            }
            return false;
        };

        // 1. Try explicit target (prioritizing buttons/controls if they still exist)
        if (explicitFocusId) {
            const el = document.getElementById(explicitFocusId);
            // If it's a button, it's a specific control interaction (like 'Align' or 'Done')
            if (el && el.tagName === 'BUTTON') {
                el.focus({ preventScroll: true });
                focusRestored = true;
            } else {
                // Fallback for button ID formats if button is gone
                if (explicitFocusId.startsWith('align-btn-') || explicitFocusId.startsWith('remove-text-btn-') || explicitFocusId.startsWith('flip-btn-')) {
                    const rectId = explicitFocusId.replace('align-btn-', '').replace('remove-text-btn-', '').replace('flip-btn-', '');
                    focusRestored = smartFocus(rectId);
                } else {
                    // It was likely a node ID
                    focusRestored = smartFocus(explicitFocusId);
                }
            }
        }

        // 2. Try restoring original focus
        if (!focusRestored && originalFocusedId) {
            focusRestored = smartFocus(originalFocusedId);
        }

        // 3. Final Fallback: First leaf in layout
        if (!focusRestored) {
            const firstLeaf = document.querySelector('.splittable-rect[data-split-state="unsplit"]');
            if (firstLeaf && firstLeaf.getAttribute('role') === 'button') {
                firstLeaf.focus({ preventScroll: true });
            }
        }
    });

    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}
