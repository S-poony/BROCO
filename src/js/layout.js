import { A4_PAPER_ID } from './constants.js';
import { state, getCurrentPage } from './state.js';
import { saveState } from './history.js';
import { renderLayout } from './renderer.js';

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

    const rectElement = event.currentTarget;
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
            renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
            document.dispatchEvent(new CustomEvent('layoutUpdated'));
        } else {
            deleteRectangle(rectElement);
        }
        return;
    }

    // Image logic: Toggle object-fit if clicking image without Shift
    if (node.image && !event.shiftKey) {
        saveState();
        node.image.fit = node.image.fit === 'cover' ? 'contain' : 'cover';
        renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
        document.dispatchEvent(new CustomEvent('layoutUpdated'));
        return;
    }

    // Text logic: Don't split if clicking text without Shift (Shift required to split)
    if ((node.text !== null && node.text !== undefined) && !event.shiftKey) {
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
        targetNode.image = { ...node.image };
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

    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}

export function createTextInRect(rectId) {
    const node = findNodeById(getCurrentPage(), rectId);
    if (!node || node.splitState === 'split' || node.image || node.text !== null) return;

    saveState();
    node.text = '';
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

    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
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

    if (orientation === 'vertical') {
        state.startSizeA = rectARect.width;
        state.startSizeB = rectBRect.width;
        divider.totalSize = parentRect.width;
    } else {
        state.startSizeA = rectARect.height;
        state.startSizeB = rectBRect.height;
        divider.totalSize = parentRect.height;
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
        id: `rect-${++state.currentId}`, // This ID will be updated by renderer to paper ID anyway but good for consistency
        splitState: 'split',
        orientation: orientation,
        children: []
    };

    const newRect = {
        id: `rect-${++state.currentId}`,
        splitState: 'unsplit',
        image: null,
        text: null,
        size: '0%' // Start with 0 size
    };

    // Old layout wrapped
    const oldLayoutNode = { ...oldLayout };
    oldLayoutNode.size = '100%';

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
        newSizeB = divider.totalSize;
    } else if (newSizeB < minSize) {
        newSizeB = minSize;
        newSizeA = divider.totalSize;
    }

    const totalGrow = (newSizeA + newSizeB) / divider.totalSize * 100;
    const growA = (newSizeA / divider.totalSize) * 100;
    const growB = (newSizeB / divider.totalSize) * 100;

    rectA.style.flexGrow = growA;
    rectB.style.flexGrow = growB;
}

function stopDrag() {
    if (!state.activeDivider) return;

    const divider = state.activeDivider;
    const rectA = divider.rectA;
    const rectB = divider.rectB;
    const orientation = divider.getAttribute('data-orientation');

    const pA = parseFloat(rectA.style.flexGrow);
    const pB = parseFloat(rectB.style.flexGrow);

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

    if (pA <= 0) {
        deleteRectangle(rectA);
    } else if (pB <= 0) {
        deleteRectangle(rectB);
    }
}

export function rebindEvents() {
    // With state-first, rebindEvents just triggers a full render
    renderLayout(document.getElementById(A4_PAPER_ID), getCurrentPage());
    document.dispatchEvent(new CustomEvent('layoutUpdated'));
}
