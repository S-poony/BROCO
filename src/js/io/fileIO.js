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
    const settings = exportSettings();
    const useFileReferences = settings.electron?.useFileReferences;

    return {
        version: '1.0',
        pages: state.pages,
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId,
        assets: assetManager.getAssets().map(asset => {
            // If the global setting is ON and we have a path, force reference mode.
            // Also keep as reference if it already was one (we might not have the full data in memory to embed it).
            const shouldBeReference = (useFileReferences && asset.absolutePath) || asset.isReference;

            return {
                ...asset,
                isReference: !!shouldBeReference,
                // Strip image data if it's a reference to keep JSON tiny
                fullResData: shouldBeReference ? null : asset.fullResData,
                lowResData: shouldBeReference ? null : asset.lowResData
            };
        }),
        settings: settings
    };
}

/**
 * Saves the current layout.
 * In Electron, it overwrites if a path exists.
 * @param {Object} options Optional. { closeAfterSave: boolean }
 */
export async function saveLayout(options = {}) {
    const isElectron = window.electronAPI && window.electronAPI.isElectron;
    const settings = exportSettings();
    const useFileReferences = settings.electron?.useFileReferences;
    const successMessage = useFileReferences ? 'Saved layout as reference file' : 'Saved layout as embedded file';

    const loadingOverlay = document.getElementById('export-loading');
    const loadingStatus = document.getElementById('loading-status');
    const loadingProgress = document.getElementById('loading-progress');

    const showLoading = async () => {
        if (!useFileReferences && loadingOverlay) {
            loadingOverlay.classList.add('active');
            if (loadingStatus) loadingStatus.textContent = 'Saving Layout...';
            if (loadingProgress) loadingProgress.textContent = 'Embedding assets...';
            // Allow UI to update
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    };

    try {
        if (isElectron && state.currentFilePath) {
            // Case 1: Overwrite existing file
            // Show loading immediately
            await showLoading();

            const data = prepareSaveData();
            const result = await window.electronAPI.saveFile(data, state.currentFilePath);

            if (result.success) {
                setDirty(false);
                toast.success(successMessage);
                if (options.closeAfterSave) window.close();
                return true;
            } else {
                toast.error(`Failed to save: ${result.error}`);
                return false;
            }

        } else if (isElectron) {
            // Case 2: Save As (First time save)
            // Step 1: Get Path (Instant)
            const date = new Date().toISOString().split('T')[0];
            const defaultName = `layout-${date}.broco`;
            const dialogResult = await window.electronAPI.showSaveDialog(defaultName);

            if (dialogResult.canceled || !dialogResult.path) return false;
            const filePath = dialogResult.path;

            // Step 2: Show loading
            await showLoading();

            // Step 3: Prepare & Save
            const data = prepareSaveData();
            const result = await window.electronAPI.saveFile(data, filePath);

            if (result.success) {
                setCurrentFilePath(filePath);
                setDirty(false);
                toast.success(successMessage);
                if (options.closeAfterSave) window.close();
                return true;
            } else {
                toast.error(`Failed to save: ${result.error}`);
                return false;
            }

        } else {
            // Case 3: Web Save (Download)
            const data = prepareSaveData();
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
    } finally {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
    }
}

/**
 * Explicit Save As functionality
 */
export async function saveLayoutAs() {
    const data = prepareSaveData();
    const isElectron = window.electronAPI && window.electronAPI.isElectron;

    const settings = exportSettings();
    const useFileReferences = settings.electron?.useFileReferences;
    const successMessage = useFileReferences ? 'Saved layout as reference file' : 'Saved layout as embedded file';

    if (isElectron) {
        // Step 1: Get Path (Instant)
        const date = new Date().toISOString().split('T')[0];
        const defaultName = `layout-${date}.broco`;
        const dialogResult = await window.electronAPI.showSaveDialog(defaultName);

        if (dialogResult.canceled || !dialogResult.path) return;

        const filePath = dialogResult.path;

        // Step 2: Show Loading for heavy saves
        const loadingOverlay = document.getElementById('export-loading');
        const loadingStatus = document.getElementById('loading-status');
        const loadingProgress = document.getElementById('loading-progress');

        if (!useFileReferences && loadingOverlay) {
            loadingOverlay.classList.add('active');
            if (loadingStatus) loadingStatus.textContent = 'Saving Layout...';
            if (loadingProgress) loadingProgress.textContent = 'Embedding assets...';
            // Allow UI to update
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        try {
            // Step 3: Prepare Data (Heavy) & Write
            const data = prepareSaveData();
            const result = await window.electronAPI.saveFile(data, filePath);

            if (result.success) {
                setCurrentFilePath(filePath);
                setDirty(false);
                toast.success(successMessage);
            } else {
                toast.error(`Failed to save: ${result.error}`);
            }
        } finally {
            if (loadingOverlay) loadingOverlay.classList.remove('active');
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
