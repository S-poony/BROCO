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
        a.download = `layout-${date}.broco`;
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
export async function openLayout(forcedPath = null) {
    const isElectron = window.electronAPI && window.electronAPI.isElectron;

    const processData = (data, filePath, fileName = null) => {
        try {
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

            const displayId = fileName || (filePath ? filePath.split(/[\\/]/).pop() : null);
            toast.success(displayId ? `Opened: ${displayId}` : 'Layout opened successfully');

        } catch (err) {
            console.error('Failed to open layout:', err);
            toast.error(`Failed to open layout: ${err.message}`);
        }
    };

    if (isElectron) {
        // Direct open from double-click or CLI
        if (forcedPath && typeof forcedPath === 'string') {
            const readResult = await window.electronAPI.readFile(forcedPath);
            if (readResult.success) {
                try {
                    const data = JSON.parse(readResult.content);
                    processData(data, forcedPath);
                } catch (err) {
                    toast.error(`Malformed JSON file: ${err.message}`);
                }
            } else {
                toast.error(`Failed to read file: ${readResult.error}`);
            }
            return;
        }

        // Standard Dialog
        const result = await window.electronAPI.openAssets({
            multiSelections: false,
            filters: [{ name: 'Broco Layout', extensions: ['broco', 'json'] }]
        });

        if (!result || !result.path) return;

        const readResult = await window.electronAPI.readFile(result.path);
        if (readResult.success) {
            try {
                const data = JSON.parse(readResult.content);
                processData(data, result.path);
            } catch (err) {
                toast.error(`Malformed JSON file: ${err.message}`);
            }
        } else {
            toast.error(`Failed to read file: ${readResult.error}`);
        }
        return;
    }

    // Standard file input for Web
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.broco,.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                processData(data, null, file.name);
            } catch (err) {
                toast.error(`Malformed JSON file: ${err.message}`);
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
