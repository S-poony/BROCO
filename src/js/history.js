import { A4_PAPER_ID, MAX_HISTORY } from './constants.js';
import { state, updateCurrentId } from './state.js';

let undoStack = [];
let redoStack = [];

export function saveState() {
    const paper = document.getElementById(A4_PAPER_ID);
    undoStack.push({
        html: paper.innerHTML,
        currentId: state.currentId
    });
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
}

export function undo(rebindCallback) {
    if (undoStack.length === 0) return;

    const paper = document.getElementById(A4_PAPER_ID);
    redoStack.push({
        html: paper.innerHTML,
        currentId: state.currentId
    });

    const prevState = undoStack.pop();
    restoreState(prevState, rebindCallback);
}

export function redo(rebindCallback) {
    if (redoStack.length === 0) return;

    const paper = document.getElementById(A4_PAPER_ID);
    undoStack.push({
        html: paper.innerHTML,
        currentId: state.currentId
    });

    const nextState = redoStack.pop();
    restoreState(nextState, rebindCallback);
}

function restoreState(snapshot, rebindCallback) {
    const paper = document.getElementById(A4_PAPER_ID);
    paper.innerHTML = snapshot.html;
    updateCurrentId(snapshot.currentId);
    if (rebindCallback) rebindCallback();
}
