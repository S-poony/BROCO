import { MAX_HISTORY } from '../core/constants.js';
import { state, updateCurrentId, setDirty } from '../core/state.js';

let undoStack = [];
let redoStack = [];

/**
 * Clone state using structuredClone with JSON fallback
 * @param {any} obj
 * @returns {any}
 */
function cloneState(obj) {
    try {
        return structuredClone(obj);
    } catch {
        return JSON.parse(JSON.stringify(obj));
    }
}

export function saveState() {
    undoStack.push({
        pages: cloneState(state.pages),
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId
    });
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
    setDirty(true);
}

export function clearHistory() {
    undoStack = [];
    redoStack = [];
}

export function undo(rebindCallback) {
    if (undoStack.length === 0) return;

    redoStack.push({
        pages: cloneState(state.pages),
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId
    });

    const prevState = undoStack.pop();
    restoreState(prevState, rebindCallback);
}

export function redo(rebindCallback) {
    if (redoStack.length === 0) return;

    undoStack.push({
        pages: cloneState(state.pages),
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId
    });

    const nextState = redoStack.pop();
    restoreState(nextState, rebindCallback);
}

function restoreState(snapshot, rebindCallback) {
    state.pages = snapshot.pages;
    state.currentPageIndex = snapshot.currentPageIndex;
    updateCurrentId(snapshot.currentId);
    if (rebindCallback) rebindCallback();

    // Also trigger an update of the pages sidebar if it exists (we'll implement this later via an event or direct call)
    document.dispatchEvent(new CustomEvent('stateRestored'));
}
