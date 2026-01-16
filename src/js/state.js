export let state = {
    currentId: 1,
    activeDivider: null,
    startX: 0,
    startY: 0,
    startSizeA: 0,
    startSizeB: 0,
    // Multi-page support
    pages: [], // Array of layout objects
    currentPageIndex: 0
};

// Initialize with one empty page
const initialLayout = {
    id: 'rect-1',
    splitState: 'unsplit',
    image: null
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
        image: null
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
    if (state.pages.length <= 1) return; // Prevent deleting the last page
    
    state.pages.splice(index, 1);
    
    // Adjust current index if needed
    if (state.currentPageIndex >= state.pages.length) {
        state.currentPageIndex = state.pages.length - 1;
    }
}

// For backward compatibility or specific updates, though we should prefer modifying state.pages directly
export function updateLayout(newLayout) {
    state.pages[state.currentPageIndex] = newLayout;
}
