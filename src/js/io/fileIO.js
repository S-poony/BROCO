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
async function prepareSaveData() {
    const settings = exportSettings();
    const useFileReferences = settings.electron?.useFileReferences === true;

    const assets = await Promise.all(assetManager.getAssets().map(async asset => {
        let isRef = (useFileReferences && asset.absolutePath);

        let fullResData = asset.fullResData;
        let lowResData = asset.lowResData;

        // If global setting says EMBED, but the asset currently has NO full profile data natively
        // (meaning it was imported during reference mode), we must Deep Embed it.
        if (!isRef && !fullResData && asset.absolutePath) {
             if (window.electronAPI && window.electronAPI.isElectron) {
                 try {
                     const url = `broco-local://${encodeURIComponent(asset.absolutePath)}`;
                     const response = await fetch(url);
                     if (!response.ok) throw new Error('File not found');

                     const blob = await response.blob();
                     fullResData = await new Promise((resolve, reject) => {
                         const reader = new FileReader();
                         reader.onload = () => resolve(reader.result);
                         reader.onerror = reject;
                         reader.readAsDataURL(blob);
                     });

                     // Ensure we also grab the thumbnail for backward-compatibility limits
                     if (!lowResData) {
                         // We access the semi-private generate helper in AssetManager to reconstruct it safely
                         lowResData = await assetManager._createThumbnailFromBase64(fullResData);
                     }
                 } catch (err) {
                     console.warn(`Could not deep-embed reference ${asset.name}. Saving as a reference instead.`, err);
                     isRef = true; // Fallback to reference mode to ensure no blank breaks!
                 }
             } else {
                 // Web mode has no drive access, so we are forced to keep it a reference
                 console.warn(`Cannot deep-embed in Web mode! Falling back to reference for ${asset.name}`);
                 isRef = true;
             }
        }

        return {
            ...asset,
            isReference: !!isRef,
            // Strip data strings explicitly if it successfully remains a reference
            fullResData: isRef ? null : fullResData,
            lowResData: isRef ? null : lowResData,
            // Crucial: we ALWAYS keep absolutePath mapped so it can be un-embedded later
            absolutePath: asset.absolutePath 
        };
    }));

    return {
        version: '1.0',
        pages: state.pages,
        currentPageIndex: state.currentPageIndex,
        currentId: state.currentId,
        assets: assets,
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
        const needsDeepEmbed = !useFileReferences && assetManager.getAssets().some(asset => !asset.fullResData && asset.absolutePath);
        if (needsDeepEmbed && loadingOverlay) {
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

            const data = await prepareSaveData();
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
            const data = await prepareSaveData();
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
            const data = await prepareSaveData();
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
            const needsDeepEmbed = assetManager.getAssets().some(asset => !asset.fullResData && asset.absolutePath);
            if (needsDeepEmbed) {
                loadingOverlay.classList.add('active');
                if (loadingStatus) loadingStatus.textContent = 'Saving Layout...';
                if (loadingProgress) loadingProgress.textContent = 'Embedding assets...';
                // Allow UI to update
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        try {
            // Step 3: Prepare Data (Heavy) & Write
            const data = await prepareSaveData();
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
            
            const rehydrationPromises = [];

            data.assets.forEach(asset => {
                assetManager.addAsset(asset);
                if (asset.isReference && !asset.lowResData) {
                    rehydrationPromises.push(assetManager.rehydrateAsset(asset));
                }
            });

            if (rehydrationPromises.length > 0) {
                Promise.all(rehydrationPromises).then(results => {
                    const failures = results.filter(r => r && r.error);
                    if (failures.length > 0) {
                        toast.error(`Failed to load ${failures.length} linked asset(s). Make sure they haven't been moved or deleted.`, 8000);
                    }
                });
            }

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
