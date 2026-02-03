import { state, getCurrentPage, updateLayout } from '../../core/state.js';
import { saveState } from '../../io/history.js';
import { SNAP_THRESHOLD, MIN_AREA_PERCENT, LAPTOP_BREAKPOINT } from '../../core/constants.js';
import { renderLayout } from '../renderer.js';
import { findNodeById, deleteNodeFromTree } from './treeUtils.js';
import { calculateDynamicSnaps } from './snapping.js';
import { renderAndRestoreFocus } from './focusManager.js';

/**
 * Starts the drag operation for a divider
 * @param {Event} event 
 * @param {HTMLElement|null} dividerElement 
 */
export function startDrag(event, dividerElement = null) {
    event.preventDefault();
    if (!dividerElement) saveState();

    const divider = dividerElement || event.currentTarget;
    if (!divider) return;

    state.activeDivider = divider;

    const rectAId = divider.getAttribute('data-rect-a-id');
    const rectBId = divider.getAttribute('data-rect-b-id');
    const parentId = divider.getAttribute('data-parent-id');

    const rectA = document.getElementById(rectAId);
    const rectB = document.getElementById(rectBId);
    const parent = document.getElementById(parentId);

    const orientation = divider.getAttribute('data-orientation');
    const isTouch = event.touches && event.touches.length > 0;
    state.startX = isTouch ? event.touches[0].clientX : event.clientX;
    state.startY = isTouch ? event.touches[0].clientY : event.clientY;

    const parentRect = parent.getBoundingClientRect();
    const rectARect = rectA.getBoundingClientRect();
    const rectBRect = rectB.getBoundingClientRect();
    const dividerRect = divider.getBoundingClientRect();

    if (orientation === 'vertical') {
        state.startSizeA = rectARect.width;
        state.startSizeB = rectBRect.width;
        state.dividerSize = dividerRect.width;
        state.availableSpace = state.startSizeA + state.startSizeB;
        state.contentOrigin = rectARect.left;
        state.parentOrigin = parentRect.left;
        state.parentFullSize = parentRect.width;
    } else {
        state.startSizeA = rectARect.height;
        state.startSizeB = rectBRect.height;
        state.dividerSize = dividerRect.height;
        state.availableSpace = state.startSizeA + state.startSizeB;
        state.contentOrigin = rectARect.top;
        state.parentOrigin = parentRect.top;
        state.parentFullSize = parentRect.height;
    }

    // Cache other dividers for alignment snapping
    state.cachedDividers = [];
    if (!event.noSnap) {
        const otherDividers = document.querySelectorAll(`.divider[data-orientation="${orientation}"]`);
        for (const other of otherDividers) {
            if (other === divider) continue;
            const otherRect = other.getBoundingClientRect();
            const center = (orientation === 'vertical' ? otherRect.left + otherRect.width / 2 : otherRect.top + otherRect.height / 2);
            state.cachedDividers.push(center);
        }
    }

    // Cache dynamic snap points (percentages) for proportional snapping
    state.cachedSnapPoints = calculateDynamicSnaps(divider, orientation);

    divider.rectA = rectA;
    divider.rectB = rectB;
    divider.parentId = parentId;
    divider.rectAId = rectAId;
    divider.rectBId = rectBId;

    // Added scope highlighting (Phase 3)
    parent.classList.add('is-resizing-scope');

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
    document.body.classList.add('no-select');
}

/**
 * Handles the edge drag operation (creating a new split from the edge)
 * @param {Event} event 
 * @param {string} edge 
 */
export function startEdgeDrag(event, edge) {
    if (window.innerWidth < LAPTOP_BREAKPOINT) return;

    event.preventDefault();
    event.stopPropagation();
    saveState();

    const isTouch = event.touches && event.touches.length > 0;
    const clientX = isTouch ? event.touches[0].clientX : event.clientX;
    const clientY = isTouch ? event.touches[0].clientY : event.clientY;

    const oldLayout = getCurrentPage();
    const orientation = (edge === 'left' || edge === 'right') ? 'vertical' : 'horizontal';

    // Create the new split node that will wrap the current layout
    const newRoot = {
        id: `rect-${++state.currentId}`,
        splitState: 'split',
        orientation: orientation,
        children: []
    };

    // MINIMUM EDGE SIZE creates a new rect that doesn't have 0 area, avoids bugs on mobile but the app isnt mobile anymore
    const MIN_EDGE_SIZE = 0;
    const newRect = {
        id: `rect-${++state.currentId}`,
        splitState: 'unsplit',
        image: null,
        text: null,
        size: `${MIN_EDGE_SIZE}%`
    };

    // Old layout wrapped - gets remaining space
    const oldLayoutNode = { ...oldLayout };
    oldLayoutNode.size = `${100 - MIN_EDGE_SIZE}%`;

    if (edge === 'left' || edge === 'top') {
        newRoot.children = [newRect, oldLayoutNode];
    } else {
        newRoot.children = [oldLayoutNode, newRect];
    }

    updateLayout(newRoot);

    // We need a specific render call here
    const a4 = document.getElementById('a4-paper');
    renderLayout(a4, getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));

    // Now trigger the normal drag on the newly created divider
    const divider = document.querySelector(`.divider[data-parent-id="${newRoot.id}"]`);
    if (divider) {
        startDrag(event, divider);
    }
}

function onDrag(event) {
    if (!state.activeDivider) return;
    event.preventDefault();

    const divider = state.activeDivider;
    const orientation = divider.getAttribute('data-orientation');
    const rectA = divider.rectA;
    const rectB = divider.rectB;

    const isTouch = event.touches && event.touches.length > 0;
    const clientX = isTouch ? event.touches[0].clientX : event.clientX;
    const clientY = isTouch ? event.touches[0].clientY : event.clientY;

    let delta = (orientation === 'vertical') ? (clientX - state.startX) : (clientY - state.startY);

    let newSizeA = state.startSizeA + delta;
    let newSizeB = state.availableSpace - newSizeA;
    const minSize = 0;

    if (newSizeA < minSize) {
        newSizeA = minSize;
        newSizeB = state.availableSpace;
    } else if (newSizeB < minSize) {
        newSizeB = minSize;
        newSizeA = state.availableSpace;
    }

    newSizeA = Math.round(newSizeA);
    newSizeB = Math.round(newSizeB);

    if (event.shiftKey) {
        const projectedCenter = state.contentOrigin + newSizeA + state.dividerSize / 2;
        let snappedCenter = null;

        // 1. Divider Alignment Snapping (using cache)
        if (state.cachedDividers) {
            for (const otherCenter of state.cachedDividers) {
                if (Math.abs(projectedCenter - otherCenter) < SNAP_THRESHOLD) {
                    snappedCenter = otherCenter;
                    break;
                }
            }
        }

        // 2. Proportional Snapping (using cache)
        if (snappedCenter === null && state.cachedSnapPoints) {
            for (const snapPoint of state.cachedSnapPoints) {
                const targetCenter = state.parentOrigin + (snapPoint / 100) * state.parentFullSize;
                if (Math.abs(projectedCenter - targetCenter) < SNAP_THRESHOLD) {
                    snappedCenter = targetCenter;
                    break;
                }
            }
        }

        if (snappedCenter !== null) {
            newSizeA = snappedCenter - state.contentOrigin - state.dividerSize / 2;
            newSizeB = state.availableSpace - newSizeA;
        }
    }

    rectA.style.flexGrow = newSizeA;
    rectB.style.flexGrow = newSizeB;
}

/**
 * Internal stopDrag function (exported for manual cleanup if needed, but usually bound to listeners)
 */
export function stopDrag() {
    if (!state.activeDivider) return;

    const divider = state.activeDivider;
    const rectA = divider.rectA;
    const rectB = divider.rectB;

    const fA = parseFloat(rectA.style.flexGrow);
    const fB = parseFloat(rectB.style.flexGrow);
    const total = fA + fB;

    const pA = (fA / total) * 100;
    const pB = (fB / total) * 100;

    const parentNode = findNodeById(getCurrentPage(), divider.parentId);
    if (parentNode && parentNode.children) {
        const nodeA = findNodeById(parentNode, divider.rectAId);
        const nodeB = findNodeById(parentNode, divider.rectBId);
        if (nodeA) nodeA.size = `${pA}%`;
        if (nodeB) nodeB.size = `${pB}%`;
    }

    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', stopDrag);
    document.body.classList.remove('no-select');

    // Removed scope highlighting (Phase 3)
    const parent = document.getElementById(divider.parentId);
    if (parent) parent.classList.remove('is-resizing-scope');

    state.activeDivider = null;

    if (pA <= MIN_AREA_PERCENT) {
        const modifiedParent = deleteNodeFromTree(getCurrentPage(), divider.rectAId);
        if (modifiedParent) renderAndRestoreFocus(getCurrentPage(), modifiedParent.id);
    } else if (pB <= MIN_AREA_PERCENT) {
        const modifiedParent = deleteNodeFromTree(getCurrentPage(), divider.rectBId);
        if (modifiedParent) renderAndRestoreFocus(getCurrentPage(), modifiedParent.id);
    }
}
