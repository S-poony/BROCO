import { A4_PAPER_ID } from '../core/constants.js';
import { state, getCurrentPage } from '../core/state.js';
import { saveState } from '../io/history.js';
import { renderLayout } from './renderer.js';

// Internal modules
import { findNodeById as findNodeByIdInternal, findParentNode as findParentNodeInternal, countParallelLeaves, deleteNodeFromTree, isDividerMergeable, mergeNodesInTree } from './internal/treeUtils.js';
import { snapDivider as snapDividerInternal } from './internal/snapping.js';
import { renderAndRestoreFocus as renderAndRestoreFocusInternal } from './internal/focusManager.js';
import * as dragInternal from './internal/dragHandler.js';

// Re-export tree utils for other modules
export { findNodeByIdInternal as findNodeById, findParentNodeInternal as findParentNode };

/**
 * Facade for focus restoration
 */
export function renderAndRestoreFocus(page, explicitFocusId = null) {
    renderAndRestoreFocusInternal(page, explicitFocusId);
}

/**
 * Main click handler for splitting nodes
 */
export function handleSplitClick(event) {
    // If we just finished editing text, clicking elsewhere should only exit edit mode
    if (window._justFinishedEditing) return;

    // If click was on the remove button, don't do anything here
    if (event.target.closest('.remove-image-btn')) return;

    const rectElement = event.target.closest('.splittable-rect');
    const node = findNodeByIdInternal(getCurrentPage(), rectElement.id);
    if (!node || node.splitState === 'split') return;

    event.stopPropagation();

    // Ctrl + Click = Delete content or rectangle
    if (event.ctrlKey && !event.shiftKey) {
        saveState();
        if (node.image || node.text !== null) {
            node.image = null;
            node.text = null;
            renderAndRestoreFocus(getCurrentPage(), rectElement.id);
        } else {
            deleteRectangle(rectElement);
        }
        return;
    }

    // Toggle object-fit if clicking image
    if (node.image && !event.shiftKey && !event.altKey) {
        saveState();
        node.image.fit = node.image.fit === 'cover' ? 'contain' : 'cover';
        renderAndRestoreFocus(getCurrentPage(), rectElement.id);
        return;
    }

    // Don't split if clicking text without modifiers
    if ((node.text !== null && node.text !== undefined) && !event.shiftKey && !event.altKey) return;

    // Split logic
    saveState();
    node.splitState = 'split';

    const rect = rectElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const defaultIsVertical = width >= height;
    node.orientation = event.altKey ? (defaultIsVertical ? 'horizontal' : 'vertical') : (defaultIsVertical ? 'vertical' : 'horizontal');

    // Create children
    const childA = { id: `rect-${++state.currentId}`, splitState: 'unsplit', image: null, text: null, size: '50%' };
    const childB = { id: `rect-${++state.currentId}`, splitState: 'unsplit', image: null, text: null, size: '50%' };
    node.children = [childA, childB];

    // Migrate content
    if (node.image) {
        const targetNode = event.ctrlKey ? childB : childA;
        targetNode.image = { ...node.image };
        node.image = null;
    }

    if (node.text !== null && node.text !== undefined) {
        const targetNode = event.ctrlKey ? childB : childA;
        targetNode.text = node.text;
        targetNode.textAlign = node.textAlign;
        node.text = null;
        node.textAlign = null;
    }

    renderAndRestoreFocus(getCurrentPage(), childA.id);
}

export function createTextInRect(rectId, initialText = null) {
    const node = findNodeByIdInternal(getCurrentPage(), rectId);
    if (!node || node.splitState === 'split' || node.image) return;

    saveState();

    if (initialText !== null) {
        node.text = initialText;
    } else if (node.text === null || node.text === undefined) {
        node.text = '';
    }

    node._startInEditMode = true;
    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

export function deleteRectangle(rectElement) {
    if (rectElement.id === A4_PAPER_ID) return;

    const modifiedParent = deleteNodeFromTree(getCurrentPage(), rectElement.id);
    if (modifiedParent) {
        renderAndRestoreFocus(getCurrentPage(), modifiedParent.id);
    }
}

export function toggleTextAlignment(rectId) {
    const node = findNodeByIdInternal(getCurrentPage(), rectId);
    if (!node || (node.text === null && node.text === undefined)) return;

    saveState();
    node.textAlign = node.textAlign === 'center' ? 'left' : 'center';
    renderAndRestoreFocus(getCurrentPage(), rectId);
}

export function toggleImageFlip(rectId) {
    const node = findNodeByIdInternal(getCurrentPage(), rectId);
    if (!node || !node.image) return;

    saveState();
    node.image.flip = !node.image.flip;
    renderAndRestoreFocus(getCurrentPage(), rectId);
}

export function swapNodesContent(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return;

    const sourceImage = sourceNode.image ? { ...sourceNode.image } : null;
    const sourceText = sourceNode.text;
    const sourceTextAlign = sourceNode.textAlign;

    const targetImage = targetNode.image ? { ...targetNode.image } : null;
    const targetText = targetNode.text;
    const targetTextAlign = targetNode.textAlign;

    targetNode.image = sourceImage;
    targetNode.text = sourceText;
    targetNode.textAlign = sourceTextAlign;

    sourceNode.image = targetImage;
    sourceNode.text = targetText;
    sourceNode.textAlign = targetTextAlign;
}

/**
 * Facade for snapping
 */
export function snapDivider(focusedRect, direction) {
    snapDividerInternal(focusedRect, direction, (el) => deleteRectangle(el), (p, id) => renderAndRestoreFocus(p, id));
}

/**
 * Facade for dragging
 */
export function startDrag(event, dividerElement = null) {
    dragInternal.startDrag(event, dividerElement);
}

export function startEdgeDrag(event, edge) {
    dragInternal.startEdgeDrag(event, edge);
}

// These are needed by dragHandler internals but we bind them here for the facade
// Actually dragHandler uses callbacks where needed.
// Global stopDrag listener is handled within dragHandler's event listeners but we provide a facade if needed.
export function stopDrag() {
    dragInternal.stopDrag();
}

/**
 * Find the first mergeable ancestor in a given direction
 */
export function findMergeableParent(focusedRect, direction) {
    const page = getCurrentPage();
    let searchNodeId = focusedRect.id;
    const targetOrientation = (direction === 'ArrowLeft' || direction === 'ArrowRight') ? 'vertical' : 'horizontal';

    while (searchNodeId) {
        const parent = findParentNodeInternal(page, searchNodeId);
        if (!parent) break;

        if (parent.orientation === targetOrientation) {
            // Check if searchNodeId is on the correct side of the divider for this direction
            const isFirst = parent.children[0].id === searchNodeId ||
                (parent.children[0].children && findNodeByIdInternal(parent.children[0], searchNodeId));
            const isSecond = parent.children[1].id === searchNodeId ||
                (parent.children[1].children && findNodeByIdInternal(parent.children[1], searchNodeId));

            if ((isFirst && (direction === 'ArrowRight' || direction === 'ArrowDown')) ||
                (isSecond && (direction === 'ArrowLeft' || direction === 'ArrowUp'))) {

                if (isDividerMergeable(parent)) {
                    return parent;
                }
            }
        }
        searchNodeId = parent.id;
    }
    return null;
}

export function mergeNodes(parentNode, sourceNodeId) {
    saveState();
    const merged = mergeNodesInTree(parentNode, sourceNodeId);
    if (merged) {
        renderAndRestoreFocus(getCurrentPage(), merged.id);
    }
}

export function handleDividerMerge(dividerElement) {
    const parentId = dividerElement.dataset.parentId;
    if (!parentId) return;

    const page = getCurrentPage();
    const parentNode = findNodeByIdInternal(page, parentId);

    if (parentNode && isDividerMergeable(parentNode)) {
        saveState();
        // contentPriority: null means default priority (usually focusing on keeping content)
        // Check mergeNodesInTree signature: (parentNode, focusedNodeId)
        // We pass null for focusedNodeId so it decides based on content
        const merged = mergeNodesInTree(parentNode, null);

        // Full layout update is safer for tree structure changes
        renderAndRestoreFocus(page, merged ? merged.id : parentId);
    }
}

