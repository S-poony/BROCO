export let state = {
    currentId: 1,
    activeDivider: null,
    startX: 0,
    startY: 0,
    startSizeA: 0,
    startSizeB: 0,
    // Multi-page support
    pages: [], // Array of layout objects
    currentPageIndex: 0,
    hoveredRectId: null,
    lastFocusedRectId: null,
    nodeMap: new Map(), // O(1) lookup for current page
    isDirty: false,
    currentFilePath: null
};

// Initialize with one empty page
const initialLayout = {
    id: 'rect-1',
    splitState: 'unsplit',
    image: null,
    text: null
};
state.pages.push(initialLayout);

export function updateCurrentId(val) {
    state.currentId = val;
}

// Helper to get current page layout
export function getCurrentPage() {
    return state.pages[state.currentPageIndex];
}

// Helpers for multi-page management
export function addPage() {
    state.currentId++;
    const newPage = {
        id: `rect-${state.currentId}`,
        splitState: 'unsplit',
        image: null,
        text: null
    };
    state.pages.push(newPage);
    state.currentPageIndex = state.pages.length - 1;
    return state.currentPageIndex;
}

export function switchPage(index) {
    if (index >= 0 && index < state.pages.length) {
        state.currentPageIndex = index;
    }
}

export function deletePage(index) {
    if (state.pages.length <= 1) return;

    state.pages.splice(index, 1);

    if (state.currentPageIndex >= state.pages.length) {
        state.currentPageIndex = state.pages.length - 1;
    }
}

export function duplicatePage(index) {
    if (index < 0 || index >= state.pages.length) return;

    // Deep clone the page
    const originalPage = state.pages[index];
    const clonedPage = JSON.parse(JSON.stringify(originalPage));

    // Recursively update all IDs to be unique
    function updateIds(node) {
        node.id = `rect-${++state.currentId}`;
        if (node.children) {
            node.children.forEach(child => updateIds(child));
        }
    }

    updateIds(clonedPage);

    // Insert after the original
    state.pages.splice(index + 1, 0, clonedPage);

    // Switch to the new page
    state.currentPageIndex = index + 1;

    return state.currentPageIndex;
}

export function reorderPage(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= state.pages.length) return;
    if (toIndex < 0 || toIndex >= state.pages.length) return;

    const [movedPage] = state.pages.splice(fromIndex, 1);
    state.pages.splice(toIndex, 0, movedPage);

    // Adjust currentPageIndex to follow the moved page if it was the active one
    if (state.currentPageIndex === fromIndex) {
        state.currentPageIndex = toIndex;
    } else if (fromIndex < state.currentPageIndex && toIndex >= state.currentPageIndex) {
        state.currentPageIndex--;
    } else if (fromIndex > state.currentPageIndex && toIndex <= state.currentPageIndex) {
        state.currentPageIndex++;
    }
}

export function updateLayout(newLayout) {
    state.pages[state.currentPageIndex] = newLayout;
    syncNodeMap();
}

/**
 * Rebuilds the O(1) lookup map for the current page
 */
export function syncNodeMap() {
    state.nodeMap.clear();
    const page = getCurrentPage();
    if (!page) return;

    const traverse = (node) => {
        state.nodeMap.set(node.id, node);
        if (node.children) {
            node.children.forEach(traverse);
        }
    };
    traverse(page);
}

export function setDirty(val) {
    if (state.isDirty === val) return;
    state.isDirty = val;
    document.dispatchEvent(new CustomEvent('dirtyChanged', { detail: { isDirty: val } }));

    // Notify Electron if available
    if (window.electronAPI && window.electronAPI.updateDirtyStatus) {
        window.electronAPI.updateDirtyStatus(val, state.currentFilePath);
    }
}

export function setCurrentFilePath(path) {
    if (state.currentFilePath === path) return;
    state.currentFilePath = path;
    document.dispatchEvent(new CustomEvent('filePathChanged', { detail: { path: path } }));

    // Also update Electron just in case it needs the path
    if (window.electronAPI && window.electronAPI.updateDirtyStatus) {
        window.electronAPI.updateDirtyStatus(state.isDirty, path);
    }
}

// Initial sync
syncNodeMap();
