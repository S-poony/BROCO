import { A4_PAPER_ID, SNAP_POINTS, SNAP_THRESHOLD, MIN_AREA_PERCENT } from './constants.js';
import { state, getCurrentPage } from './state.js';
import { saveState } from './history.js';
import { renderLayout } from './renderer.js';

// Helper to restore focus after render
export function renderAndRestoreFocus(page, explicitFocusId = null) {
    // If explicit ID provided, use it. Otherwise try to preserve current active element.
    const focusedId = explicitFocusId || (document.activeElement ? document.activeElement.id : null);

    renderLayout(document.getElementById(A4_PAPER_ID), page);

    let focusRestored = false;

    // 1. Try explicit ID (e.g. key button)
    if (explicitFocusId) {
        const el = document.getElementById(explicitFocusId);
        if (el) {
            el.focus({ preventScroll: true });
            focusRestored = true;
        } else {
            // Fallback: if button is gone (e.g. text removed), try the rect itself
            // ID format: align-btn-rect-X -> rect-X
            if (explicitFocusId.startsWith('align-btn-') || explicitFocusId.startsWith('remove-text-btn-')) {
                const rectId = explicitFocusId.replace('align-btn-', '').replace('remove-text-btn-', '');
                const rect = document.getElementById(rectId);
                if (rect) {
                    rect.focus({ preventScroll: true });
                    focusRestored = true;
                }
            }
        }
    }

    // 2. If no explicit focus restored (or not provided), try previously focused ID
    if (!focusRestored && focusedId) {
        const el = document.getElementById(focusedId);
        if (el) {
            el.focus({ preventScroll: true });
        }
    }

    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

// Helper to find node in the layout tree
export function findNodeById(root, id) {
    if (root.id === id) return root;
    if (root.children) {
        for (const child of root.children) {
            const found = findNodeById(child, id);
            if (found) return found;
        }
    }
    return null;
}

// Helper to find parent node in the layout tree
export function findParentNode(root, childId) {
    if (root.children) {
        if (root.children.some(c => c.id === childId)) return root;
        for (const child of root.children) {
            const found = findParentNode(child, childId);
            if (found) return found;
        }
    }
    return null;
}

export function handleSplitClick(event) {
    // If we just finished editing text, clicking elsewhere should only exit edit mode
    if (window._justFinishedEditing) {
        return;
    }

    // If click was on the remove button, don't do anything here
    if (event.target.closest('.remove-image-btn')) {
        return;
    }

    const rectElement = event.target.closest('.splittable-rect');
    const node = findNodeById(getCurrentPage(), rectElement.id);
    if (!node || node.splitState === 'split') return;

    // Stop propagation so clicking a leaf doesn't trigger parent split handlers
    event.stopPropagation();

    // Ctrl + Click (without Shift) = Delete content or rectangle
    if (event.ctrlKey && !event.shiftKey) {
        saveState();
        if (node.image || node.text !== null) {
            node.image = null;
            node.text = null;
            // Explicitly restore focus to this rect after clearing content
            renderAndRestoreFocus(getCurrentPage(), rectElement.id);
        } else {
            deleteRectangle(rectElement);
        }
        return;
    }

    // Image logic: Toggle object-fit if clicking image without Shift or Alt
    if (node.image && !event.shiftKey && !event.altKey) {
        saveState();
        node.image.fit = node.image.fit === 'cover' ? 'contain' : 'cover';
        // Explicitly restore focus to this rect
        renderAndRestoreFocus(getCurrentPage(), rectElement.id);
        return;
    }

    // Image logic: Toggle flip if Alt + Click on image (or handle via button, but keeping shortcut optional)
    // Actually, let's keep click behavior simple and use the new button for flip. 
    // But we need to ensure flip state is preserved during split below.

    // Text logic: Don't split if clicking text without Shift or Alt (one is required to split)
    if ((node.text !== null && node.text !== undefined) && !event.shiftKey && !event.altKey) {
        // Do nothing - clicking text area should focus editor, not split
        return;
    }

    // Split logic
    saveState();
    node.splitState = 'split';

    const rect = rectElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const defaultIsVertical = width >= height;
    node.orientation = event.altKey ? (defaultIsVertical ? 'horizontal' : 'vertical') : (defaultIsVertical ? 'vertical' : 'horizontal');

    // Create children in state
    const childA = { id: `rect-${++state.currentId}`, splitState: 'unsplit', image: null, text: null, size: '50%' };
    const childB = { id: `rect-${++state.currentId}`, splitState: 'unsplit', image: null, text: null, size: '50%' };
    node.children = [childA, childB];

    // If there was an image, migrate it in state
    if (node.image) {
        const targetNode = event.ctrlKey ? childB : childA;
        targetNode.image = { ...node.image }; // This copies fit and flip properties
        node.image = null;
    }

    // If there was text, migrate it in state
    if (node.text !== null && node.text !== undefined) {
        const targetNode = event.ctrlKey ? childB : childA;
        targetNode.text = node.text;
        targetNode.textAlign = node.textAlign;
        node.text = null;
        node.textAlign = null;
    }

    // When splitting, the original rect (rectElement.id) is now a container (hidden/replaced).
    // The visual equivalent of "staying selected" is presumably focusing the first child (or the one preserving content).
    // If it's a mouse click (has coordinates), we focus whatever is under the mouse after split.
    // If it's a keyboard split (Spacebar), we default to childA.

    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());

    const isMouseClick = event.clientX > 0 || event.clientY > 0;
    let focused = false;

    if (isMouseClick) {
        const elUnderMouse = document.elementFromPoint(event.clientX, event.clientY);
        const newRect = elUnderMouse ? elUnderMouse.closest('.splittable-rect[data-split-state="unsplit"]') : null;
        if (newRect) {
            newRect.focus({ preventScroll: true });
            focused = true;
        }
    }

    if (!focused) {
        // Fallback for keyboard or if elementFromPoint failed
        const newFocus = document.getElementById(childA.id);
        if (newFocus) newFocus.focus({ preventScroll: true });
    }

    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

export function createTextInRect(rectId, initialText = null) {
    const node = findNodeById(getCurrentPage(), rectId);
    if (!node || node.splitState === 'split' || node.image) return;

    saveState();

    // If initialText is provided (string), overwrite key
    // If initialText is null/undefined, keep existing text (enter edit mode) or init empty
    if (initialText !== null) {
        node.text = initialText;
    } else if (node.text === null || node.text === undefined) {
        node.text = '';
    }
    // If node.text already existed and initialText is null, we just leave it alone to edit it.
    // Mark that we want edit mode
    node._startInEditMode = true;
    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

export function deleteRectangle(rectElement) {
    if (rectElement.id === A4_PAPER_ID) {
        return;
    }

    const parentNode = findParentNode(getCurrentPage(), rectElement.id);
    if (!parentNode) return;

    const siblingNode = parentNode.children.find(c => c.id !== rectElement.id);

    // Merge sibling into parent
    parentNode.splitState = siblingNode.splitState;
    if (siblingNode.splitState === 'split') {
        parentNode.children = siblingNode.children;
        parentNode.orientation = siblingNode.orientation;
    } else {
        parentNode.children = null;
        parentNode.image = siblingNode.image;
        parentNode.text = siblingNode.text;
        parentNode.textAlign = siblingNode.textAlign;
        parentNode.orientation = null;
    }

    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

export function toggleTextAlignment(rectId) {
    const node = findNodeById(getCurrentPage(), rectId);
    if (!node || (node.text === null && node.text === undefined)) return;

    saveState();
    node.textAlign = node.textAlign === 'center' ? 'left' : 'center';

    renderAndRestoreFocus(getCurrentPage(), `align-btn-${rectId}`);
}

export function toggleImageFlip(rectId) {
    const node = findNodeById(getCurrentPage(), rectId);
    if (!node || !node.image) return;

    saveState();
    // Toggle flip state (undefined/false -> true -> false)
    node.image.flip = !node.image.flip;

    // Restore focus to flip button
    renderAndRestoreFocus(getCurrentPage(), `flip-btn-${rectId}`);
}

/**
 * Swaps content (images, text, settings) between two nodes
 * Useful for drag-and-drop and keyboard shortcuts
 * @param {Object} sourceNode 
 * @param {Object} targetNode 
 */
export function swapNodesContent(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return;

    // Capture source content
    const sourceImage = sourceNode.image ? { ...sourceNode.image } : null;
    const sourceText = sourceNode.text;
    const sourceTextAlign = sourceNode.textAlign;

    // Capture target content
    const targetImage = targetNode.image ? { ...targetNode.image } : null;
    const targetText = targetNode.text;
    const targetTextAlign = targetNode.textAlign;

    // Swap: Source content to target
    targetNode.image = sourceImage;
    targetNode.text = sourceText;
    targetNode.textAlign = sourceTextAlign;

    // Swap: Target content to source
    sourceNode.image = targetImage;
    sourceNode.text = targetText;
    sourceNode.textAlign = targetTextAlign;
}

/**
 * Snaps the divider adjacent to the focused rectangle in the given direction
 * @param {HTMLElement} focusedRect 
 * @param {string} direction 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 */
export function snapDivider(focusedRect, direction) {
    const page = getCurrentPage();
    let currentNodeId = focusedRect.id;
    let targetParent = null;
    let targetDividerOrientation = (direction === 'ArrowLeft' || direction === 'ArrowRight') ? 'vertical' : 'horizontal';

    // Find the first ancestor that is split in the relevant orientation
    // AND where the current node (or its branch) is adjacent to the divider in that direction
    let searchNodeId = currentNodeId;
    while (searchNodeId) {
        const parent = findParentNode(page, searchNodeId);
        if (!parent) break;

        if (parent.orientation === targetDividerOrientation) {
            const isFirstChild = parent.children[0].id === searchNodeId ||
                (parent.children[0].children && findNodeById(parent.children[0], searchNodeId));

            const isSecondChild = parent.children[1].id === searchNodeId ||
                (parent.children[1].children && findNodeById(parent.children[1], searchNodeId));

            if ((isFirstChild && (direction === 'ArrowRight' || direction === 'ArrowDown')) ||
                (isSecondChild && (direction === 'ArrowLeft' || direction === 'ArrowUp'))) {
                targetParent = parent;
                break;
            }
        }
        searchNodeId = parent.id;
    }

    if (!targetParent) return;

    // We found a divider to move!
    const nodeA = targetParent.children[0];
    const nodeB = targetParent.children[1];

    // Get current percentage of nodeA
    const currentPct = parseFloat(nodeA.size);
    if (isNaN(currentPct)) return;

    // Use a Set of rounded strings to ensure clean deduplication during construction
    const candidatesSet = new Set();
    const addCandidate = (val) => {
        if (val > 0.5 && val < 99.5) {
            candidatesSet.add(Math.round(val * 10) / 10); // Round to 1 decimal place (e.g. 33.3)
        }
    };

    // 1. Dynamic Snap Points (Leaf Count)
    const totalCount = countParallelLeaves(nodeA, targetDividerOrientation) + countParallelLeaves(nodeB, targetDividerOrientation);
    if (totalCount > 1) {
        // Base 50%
        addCandidate(50);

        // Dynamic fractions
        for (let i = 1; i < totalCount; i++) {
            addCandidate((i / totalCount) * 100);
        }
    } else {
        // Fallback
        addCandidate(50);
    }

    // 2. Boundary Snaps (Allow full collapse/expansion)
    addCandidate(1);
    addCandidate(99);

    // 3. Recursive Gap Subdivision
    // Only subdivide if there's enough room to make meaningful proportional jumps
    const MIN_GAP_FOR_RECURSION = 10;
    const remainingForward = 100 - currentPct;
    if (remainingForward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addCandidate(currentPct + (remainingForward * p / 100)));
    }
    const remainingBackward = currentPct;
    if (remainingBackward > MIN_GAP_FOR_RECURSION) {
        SNAP_POINTS.forEach(p => addCandidate(remainingBackward * p / 100));
    }

    // 4. Global Alignment Snaps
    const otherDividers = Array.from(document.querySelectorAll(`.divider[data-orientation="${targetDividerOrientation}"]`));
    const parentEl = document.querySelector(`.splittable-rect[id="${targetParent.id}"]`) || document.getElementById(A4_PAPER_ID);
    const parentRect = parentEl.getBoundingClientRect();

    otherDividers.forEach(div => {
        const divRect = div.getBoundingClientRect();
        const divCenter = (targetDividerOrientation === 'vertical' ? divRect.left + divRect.width / 2 : divRect.top + divRect.height / 2);
        const parentStart = (targetDividerOrientation === 'vertical' ? parentRect.left : parentRect.top);
        const parentSize = (targetDividerOrientation === 'vertical' ? parentRect.width : parentRect.height);
        const relPct = ((divCenter - parentStart) / parentSize) * 100;
        addCandidate(relPct);
    });

    // Convert back to numbers and sort
    const sortedCandidates = Array.from(candidatesSet).map(Number).sort((a, b) => a - b);

    // Find target with a strict "Minimum Jump" tolerance
    // This prevents the "stuck" feeling when multiple candidates are within 1% of each other
    const MIN_JUMP = 1.2;
    let targetPct = null;

    if (direction === 'ArrowRight' || direction === 'ArrowDown') {
        targetPct = sortedCandidates.find(c => c >= currentPct + MIN_JUMP);
    } else {
        targetPct = [...sortedCandidates].reverse().find(c => c <= currentPct - MIN_JUMP);
    }

    if (targetPct !== undefined && targetPct !== null) {
        saveState();

        if (targetPct <= MIN_AREA_PERCENT) {
            // Delete nodeA (the first sibling)
            deleteRectangle(document.getElementById(nodeA.id));
            // After deletion, the parent node ID survives and contains the merged sibling.
            // Focus the parent to keep the selection visible.
            renderAndRestoreFocus(page, targetParent.id);
        } else if ((100 - targetPct) <= MIN_AREA_PERCENT) {
            // Delete nodeB (the second sibling)
            deleteRectangle(document.getElementById(nodeB.id));
            renderAndRestoreFocus(page, targetParent.id);
        } else {
            nodeA.size = `${targetPct}%`;
            nodeB.size = `${100 - targetPct}%`;
            renderAndRestoreFocus(page, focusedRect.id);
        }
    }
}

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

    divider.rectA = rectA;
    divider.rectB = rectB;
    divider.parentId = parentId;
    divider.rectAId = rectAId;
    divider.rectBId = rectBId;

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
    document.body.classList.add('no-select');
}

export function startEdgeDrag(event, edge) {
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

    // Start with minimum 5% size to prevent accidental tiny splits on mobile
    const MIN_EDGE_SIZE = 2;
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

    state.pages[state.currentPageIndex] = newRoot;
    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
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
    let newSizeB = state.startSizeB - delta;
    const minSize = 0;

    if (newSizeA < minSize) {
        newSizeA = minSize;
        newSizeB = state.availableSpace;
    } else if (newSizeB < minSize) {
        newSizeB = minSize;
        newSizeA = state.availableSpace;
    }

    // Ensure we avoid fractional pixels where possible
    newSizeA = Math.round(newSizeA);
    newSizeB = Math.round(newSizeB);

    // Apply snapping if Shift key is held
    if (event.shiftKey) {
        const projectedCenter = state.contentOrigin + newSizeA + state.dividerSize / 2;
        let snappedCenter = null;

        // 1. Divider Alignment Snapping (Center-to-Center)
        const otherDividers = document.querySelectorAll(`.divider[data-orientation="${orientation}"]`);
        for (const other of otherDividers) {
            if (other === divider) continue;
            const otherRect = other.getBoundingClientRect();
            const otherCenter = (orientation === 'vertical' ? otherRect.left + otherRect.width / 2 : otherRect.top + otherRect.height / 2);

            if (Math.abs(projectedCenter - otherCenter) < SNAP_THRESHOLD) {
                snappedCenter = otherCenter;
                break;
            }
        }

        // 2. Proportional Snapping (Width-Aware)
        if (snappedCenter === null) {
            // Dynamic Snap Points calculation
            const parentNode = findNodeById(getCurrentPage(), divider.parentId);
            let dynamicSnaps = [50]; // Always keep 50 as a base

            if (parentNode) {
                const nodeA = findNodeById(parentNode, divider.rectAId);
                const nodeB = findNodeById(parentNode, divider.rectBId);

                if (nodeA && nodeB) {
                    const leftCount = countParallelLeaves(nodeA, orientation);
                    const rightCount = countParallelLeaves(nodeB, orientation);
                    const totalCount = leftCount + rightCount;

                    if (totalCount > 1) {
                        for (let i = 1; i < totalCount; i++) {
                            dynamicSnaps.push((i / totalCount) * 100);
                        }
                    }
                }
            }

            // Deduplicate
            const uniqueSnaps = [...new Set(dynamicSnaps)];

            for (const snapPoint of uniqueSnaps) {
                // Target center is position at % of PARENT total size
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

    // Use pixel values for flex-grow to ensure absolute accuracy with fixed-width dividers
    rectA.style.flexGrow = newSizeA;
    rectB.style.flexGrow = newSizeB;
}

function stopDrag() {
    if (!state.activeDivider) return;

    const divider = state.activeDivider;
    const rectA = divider.rectA;
    const rectB = divider.rectB;
    const orientation = divider.getAttribute('data-orientation');

    const fA = parseFloat(rectA.style.flexGrow);
    const fB = parseFloat(rectB.style.flexGrow);
    const total = fA + fB;

    // Convert pixel-accurate flex-grow back to percentages for state persistence
    // Use the stored availableSpace to ensure consistency if the layout shifted during drag (unlikely but safer)
    const pA = (fA / total) * 100;
    const pB = (fB / total) * 100;

    // Sync back to state
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
    state.activeDivider = null;

    // Delete rectangles that have very small or negative area
    if (pA <= MIN_AREA_PERCENT) {
        deleteRectangle(rectA);
    } else if (pB <= MIN_AREA_PERCENT) {
        deleteRectangle(rectB);
    }
}

function countParallelLeaves(node, orientation) {
    if (!node || node.splitState === 'unsplit') {
        return 1;
    }
    // If the node is split in the SAME orientation, sum the children
    if (node.orientation === orientation) {
        let sum = 0;
        if (node.children) {
            for (const child of node.children) {
                sum += countParallelLeaves(child, orientation);
            }
        }
        return sum;
    }
    // If split in ORTHOGONAL orientation, it counts as 1 block in this dimension
    return 1;
}

