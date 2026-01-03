import { undo, redo } from './js/history.js';
import { handleSplitClick, rebindEvents } from './js/layout.js';

function setupGlobalHandlers() {
    window.addEventListener('keydown', (e) => {
        // Ctrl Key for Cursor
        if (e.key === 'Control') {
            document.body.classList.add('ctrl-pressed');
        }

        // Undo: Ctrl + Z
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo(rebindEvents);
        }

        // Redo: Ctrl + Y or Ctrl + Shift + Z
        if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault();
            redo(rebindEvents);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
            document.body.classList.remove('ctrl-pressed');
        }
    });

    window.addEventListener('blur', () => {
        document.body.classList.remove('ctrl-pressed');
    });
}

function initialize() {
    const initialRect = document.getElementById('rect-1');
    if (initialRect) {
        initialRect.addEventListener('click', handleSplitClick);
    }

    setupGlobalHandlers();
}

document.addEventListener('DOMContentLoaded', initialize);
