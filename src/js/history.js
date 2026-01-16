import { A4_PAPER_ID, MAX_HISTORY } from './constants.js';
import { state, updateCurrentId } from './state.js';

let undoStack = [];
let redoStack = [];

export function saveState() {
    undoStack.push({
        pages: JSON.parse(JSON.stringify(state.pages)),
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId
    });
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
}

export function undo(rebindCallback) {
    if (undoStack.length === 0) return;

    redoStack.push({
        pages: JSON.parse(JSON.stringify(state.pages)),
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId
    });

    const prevState = undoStack.pop();
    restoreState(prevState, rebindCallback);
}

export function redo(rebindCallback) {
    if (redoStack.length === 0) return;

    undoStack.push({
        pages: JSON.parse(JSON.stringify(state.pages)),
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
