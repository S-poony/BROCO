import { state, updateCurrentId, updateLayout } from './state.js';
import { assetManager } from './AssetManager.js';
import { renderLayout } from './renderer.js';
import { renderPageList } from './pages.js';
import { A4_PAPER_ID } from './constants.js';
import { showAlert } from './utils.js';
import { saveState } from './history.js';
import { exportSettings, loadSettings } from './settings.js';

/**
 * Saves the current layout to a .json file
 */
export function saveLayout() {
    const data = {
        version: '1.0',
        pages: state.pages,
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId,
        assets: assetManager.getAssets(),
        settings: exportSettings()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `layout-${date}.layout.json`;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Opens a .json layout file and restores the state
 */
export async function openLayout() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);

                // Basic validation
                if (!data.pages || !Array.isArray(data.pages) || !data.assets) {
                    throw new Error('Invalid layout file format');
                }

                // Save current state to history before overwriting
                saveState();

                // Restore assets
                assetManager.dispose();
                data.assets.forEach(asset => {
                    assetManager.addAsset(asset);
                });

                // Restore state
                state.pages = data.pages;
                state.currentPageIndex = data.currentPageIndex || 0;
                updateCurrentId(data.currentId || 1);

                // Re-render UI
                const paper = document.getElementById(A4_PAPER_ID);
                if (paper) {
                    renderLayout(paper, state.pages[state.currentPageIndex]);
                }
                renderPageList();

                // Notify other components if necessary
                document.dispatchEvent(new CustomEvent('layoutUpdated'));

                // Restore settings if present
                if (data.settings) {
                    loadSettings(data.settings);
                }

            } catch (err) {
                console.error('Failed to open layout:', err);
                showAlert(`Failed to open layout: ${err.message}`, 'Open Error');
            }
        };
        reader.readAsText(file);
    };

    input.click();
}

/**
 * Sets up event listeners for save and open buttons
 */
export function setupFileIOHandlers() {
    const saveBtn = document.getElementById('save-layout-btn');
    const openBtn = document.getElementById('open-layout-btn');

    if (saveBtn) {
        saveBtn.addEventListener('click', saveLayout);
    }

    if (openBtn) {
        openBtn.addEventListener('click', openLayout);
    }
}
