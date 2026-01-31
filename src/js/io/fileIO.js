import { state, updateCurrentId, setDirty, setCurrentFilePath } from '../core/state.js';
import { assetManager } from '../assets/AssetManager.js';
import { renderAndRestoreFocus } from '../layout/layout.js';
import { renderPageList } from '../layout/pages.js';
import { A4_PAPER_ID } from '../core/constants.js';
import { showAlert } from '../core/utils.js';
import { toast } from '../core/errorHandler.js';
import { saveState } from './history.js';
import { exportSettings, loadSettings } from '../ui/settings.js';

/**
 * Prepares the layout data for saving
 */
function prepareSaveData() {
    return {
        version: '1.0',
        pages: state.pages,
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId,
        assets: assetManager.getAssets().map(asset => ({
            ...asset,
            // Strip image data if it's a reference to keep JSON tiny
            fullResData: asset.isReference ? null : asset.fullResData,
            lowResData: asset.isReference ? null : asset.lowResData
        })),
        settings: exportSettings()
    };
}

/**
 * Saves the current layout.
 * In Electron, it overwrites if a path exists.
 * @param {Object} options Optional. { closeAfterSave: boolean }
 */
export async function saveLayout(options = {}) {
    const data = prepareSaveData();
    const isElectron = window.electronAPI && window.electronAPI.isElectron;

    if (isElectron && state.currentFilePath) {
        // Overwrite existing file
        const result = await window.electronAPI.saveFile(data, state.currentFilePath);
        if (result.success) {
            setDirty(false);
            toast.success('Layout saved');
            if (options.closeAfterSave) window.close();
            return true;
        } else {
            toast.error(`Failed to save: ${result.error}`);
            return false;
        }
    } else if (isElectron) {
        // Save As... (Electron)
        const result = await window.electronAPI.saveFileDialog(data);
        if (result.success && result.path) {
            setCurrentFilePath(result.path);
            setDirty(false);
            toast.success('Layout saved');
            if (options.closeAfterSave) window.close();
            return true;
        } else if (result.error) {
            toast.error(`Failed to save: ${result.error}`);
            return false;
        }
    } else {
        // Web Save (Download)
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        const date = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `layout-${date}.layout.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setDirty(false);
        toast.success('Layout download started');
        return true;
    }
}

/**
 * Explicit Save As functionality
 */
export async function saveLayoutAs() {
    const data = prepareSaveData();
    const isElectron = window.electronAPI && window.electronAPI.isElectron;

    if (isElectron) {
        const result = await window.electronAPI.saveFileDialog(data);
        if (result.success && result.path) {
            setCurrentFilePath(result.path);
            setDirty(false);
            toast.success('Layout saved as new file');
        } else if (result.error) {
            toast.error(`Failed to save: ${result.error}`);
        }
    } else {
        // Fallback to normal save for web
        saveLayout();
    }
}

/**
 * Opens a .json layout file and restores the state
 */
export async function openLayout() {
    const isElectron = window.electronAPI && window.electronAPI.isElectron;

    if (isElectron) {
        const result = await window.electronAPI.openAssets({ multiSelections: false, filters: [{ name: 'Layout JSON', extensions: ['json'] }] });
        // The current openAssets implementation returns an array of processed assets or just path?
        // Wait, openAssets in electron/main.js is set up for assets.
        // Actually, let's look at how openAssets works. It returns { assets: [], path: '' } after my previous change.
        if (!result || !result.path) return;

        try {
            // We need a way to read a JSON file from a path in Electron...
            // Or use the standard input[type=file] which also works in Electron
        } catch (err) { }
    }

    // Standard file input works in both Web and Electron for reading local content chosen by user
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // In Electron, the file object may contain the path
        const filePath = file.path || null;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);

                if (!data.pages || !Array.isArray(data.pages) || !data.assets) {
                    throw new Error('Invalid layout file format');
                }

                saveState();

                assetManager.dispose();
                data.assets.forEach(asset => {
                    assetManager.addAsset(asset);
                    if (asset.isReference && !asset.lowResData) {
                        assetManager.rehydrateAsset(asset);
                    }
                });

                state.pages = data.pages;
                state.currentPageIndex = data.currentPageIndex || 0;
                updateCurrentId(data.currentId || 1);

                if (data.settings) {
                    loadSettings(data.settings);
                }

                const paper = document.getElementById(A4_PAPER_ID);
                if (paper) {
                    renderAndRestoreFocus(state.pages[state.currentPageIndex], `rect-${state.currentId}`);
                }
                renderPageList();

                // Set file path and clear dirty state
                if (filePath) setCurrentFilePath(filePath);
                setDirty(false);

                document.dispatchEvent(new CustomEvent('layoutUpdated'));

            } catch (err) {
                console.error('Failed to open layout:', err);
                toast.error(`Failed to open layout: ${err.message}`);
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
