import { undo, redo } from './js/history.js';
import { handleSplitClick, rebindEvents } from './js/layout.js';
import { setupAssetHandlers, setupDropHandlers } from './js/assets.js';
import { setupExportHandlers } from './js/export.js';

function setupGlobalHandlers() {
    window.addEventListener('keydown', (e) => {
        // Ctrl Key for Cursor (only if Shift is not held)
        if (e.ctrlKey && !e.shiftKey) {
            document.body.classList.add('ctrl-pressed');
        } else if (e.shiftKey) {
            document.body.classList.remove('ctrl-pressed');
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
        if (e.key === 'Control' || e.key === 'Shift') {
            // Update cursor based on final state of modifiers
            if (e.ctrlKey && !e.shiftKey) {
                document.body.classList.add('ctrl-pressed');
            } else {
                document.body.classList.remove('ctrl-pressed');
            }
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

    setupAssetHandlers();
    setupDropHandlers();
    setupExportHandlers();
    setupGlobalHandlers();
    loadShortcuts();
}

async function loadShortcuts() {
    const container = document.getElementById('shortcuts-content');
    if (!container) return;

    try {
        const response = await fetch('/assets/shortcuts.md');
        if (!response.ok) throw new Error('Failed to load shortcuts');
        const text = await response.text();

        // Very basic MD parser for this specific file
        const html = text
            .split('\n')
            .map(line => {
                line = line.trim();
                if (line.startsWith('##')) {
                    return `<h2>${line.replace('##', '').trim()}</h2>`;
                }
                if (line.startsWith('***')) {
                    return '<hr>';
                }
                if (line.includes('=')) {
                    const [key, desc] = line.split('=').map(s => s.trim());
                    return `<p><strong>${key}</strong>: ${desc}</p>`;
                }
                if (line === '') return '';
                return `<p>${line}</p>`;
            })
            .join('');

        container.className = 'shortcuts-content';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading shortcuts:', error);
        container.innerHTML = '<p>Shortcuts list currently unavailable.</p>';
    }
}

document.addEventListener('DOMContentLoaded', initialize);
