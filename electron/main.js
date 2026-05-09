import { app, BrowserWindow, shell, dialog, ipcMain, globalShortcut, protocol, net, Menu, nativeImage } from 'electron';
import { join, dirname, relative, basename } from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import electronUpdater from 'electron-updater';
import log from 'electron-log';
import { PDFDocument } from 'pdf-lib';
const { autoUpdater } = electronUpdater;

// Register custom protocol early
protocol.registerSchemesAsPrivileged([
    { scheme: 'broco-local', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true, secure: true } }
]);

// High-DPI / Zoom Fixes for Windows
if (process.platform === 'win32') {
    app.commandLine.appendSwitch('high-dpi-support', '1');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let exportWin = null; // Singleton export window to avoid overhead and leaks
let exportWinReady = false; // Whether the export window has loaded the export-mode app
let exportWinReadyPromise = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 400, // Reduced from 800 to avoid conflicts with logical scaling
        minHeight: 300,
        title: "BROCO",
        autoHideMenuBar: true, // Hides the top bar by default
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: join(__dirname, '../src/assets/icons/AppIcon.png')
    });

    mainWindow.isDirty = false;
    mainWindow.currentFilePath = null;

    // Handle Close Confirmation
    mainWindow.on('close', async (e) => {
        if (mainWindow.isDirty) {
            e.preventDefault(); // Stop the close
            // Notify the renderer to show the themed modal
            mainWindow.webContents.send('app:request-close');
        }
    });

    // Completely remove the default menu (File, Edit, etc.)
    Menu.setApplicationMenu(null);

    // Load the app
    if (!app.isPackaged) {
        // In dev, load from vite dev server
        mainWindow.loadURL('http://localhost:5173');
        // Open DevTools
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load built file
        mainWindow.loadFile(join(__dirname, '../dist/index.html'));
    }

    // Force Zoom level 1.0 (some systems default to 1.25 or 1.5)
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.setZoomFactor(1.0);
    });

    // Handle external links (open in browser)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:') || url.startsWith('http:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Handle navigation to external sites (prevent internal accidental navigation)
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const currentUrl = mainWindow.webContents.getURL();
        if (url === currentUrl) return;

        // Allow navigation to local sources
        if (url.startsWith('http://localhost') || url.startsWith('file://')) {
            return;
        }

        // Everything else: open externally and cancel internal navigation
        if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // Handle focus/blur to register Alt+Space shortcut only when active
    // This allows us to override the Windows system menu reliably
    mainWindow.on('focus', () => {
        globalShortcut.register('Alt+Space', () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:long-split');
        });
        globalShortcut.register('CommandOrControl+S', () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:save-layout');
        });
        globalShortcut.register('CommandOrControl+Shift+S', () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shortcut:save-layout-as');
        });
    });

    mainWindow.on('blur', () => {
        globalShortcut.unregister('Alt+Space');
        globalShortcut.unregister('CommandOrControl+S');
        globalShortcut.unregister('CommandOrControl+Shift+S');
    });

    // Check for updates once window is ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        autoUpdater.checkForUpdatesAndNotify();
    });

    // Cleanup background windows when main window is closed
    mainWindow.on('closed', () => {
        if (exportWin && !exportWin.isDestroyed()) {
            exportWin.destroy();
        }
        exportWin = null;
        exportWinReady = false;
        exportWinReadyPromise = null;
        mainWindow = null;
    });
}

// App lifecycle
app.whenReady().then(() => {
    // Register the local file protocol handler
    protocol.handle('broco-local', (request) => {
        const filePath = decodeURIComponent(request.url.slice('broco-local://'.length));
        return net.fetch(pathToFileURL(filePath).toString());
    });

    createWindow();

    // Handle Cold Start file open (Double-click from OS)
    const coldStartFile = process.argv.find((arg, index) => index >= 1 && (arg.endsWith('.broco') || arg.endsWith('.json')));
    if (coldStartFile && mainWindow) {
        mainWindow.once('ready-to-show', () => {
            mainWindow.webContents.send('file:open', coldStartFile);
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Ensure shortcuts are cleaned up on quit
    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });

    // Handle Asset Picker
    ipcMain.handle('dialog:openAssets', async (event, options = {}) => {
        const { directory = false } = options;
        const properties = directory
            ? ['openDirectory', 'multiSelections']
            : ['openFile', 'multiSelections'];

        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties,
            filters: options.filters || [
                { name: 'Assets', extensions: ['jpg', 'png', 'gif', 'webp', 'jpeg', 'txt', 'md'] }
            ]
        });
        if (canceled) return [];

        const results = [];

        const processPath = (fullPath, baseDir) => {
            const stats = fs.statSync(fullPath);
            const name = basename(fullPath);
            const relPath = baseDir ? relative(baseDir, fullPath).replace(/\\/g, '/') : name;

            if (stats.isDirectory()) {
                const files = fs.readdirSync(fullPath);
                files.forEach(file => processPath(join(fullPath, file), baseDir || dirname(fullPath)));
            } else {
                const ext = name.split('.').pop().toLowerCase();
                const isImage = ['jpg', 'png', 'gif', 'webp', 'jpeg'].includes(ext);
                const isText = ['txt', 'md'].includes(ext);

                if (isImage || isText) {
                    const content = fs.readFileSync(fullPath);
                    results.push({
                        name,
                        path: relPath,
                        absolutePath: fullPath, // Add absolute path for referencing
                        type: isImage ? 'image' : 'text',
                        data: isImage ? `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${content.toString('base64')}` : content.toString('utf-8')
                    });
                }
            }
        };

        filePaths.forEach(p => processPath(p));
        return { assets: results, path: filePaths[0] }; // Return assets and the path of the first chosen file
    });

    ipcMain.handle('app:open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('app:open-devtools', () => {
        if (mainWindow) {
            mainWindow.webContents.openDevTools();
        }
    });

    // Handle Show Item in Folder (open file explorer at path)
    ipcMain.handle('app:show-item-in-folder', async (event, filePath) => {
        try {
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (err) {
            console.error('showItemInFolder error:', err);
            return { success: false, error: err.message };
        }
    });

    // Handle File Save (Overwrite)
    ipcMain.handle('file:save', async (event, data, filePath) => {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return { success: true };
        } catch (err) {
            console.error('Save error:', err);
            return { success: false, error: err.message };
        }
    });

    // Handle File Read
    ipcMain.handle('file:read', async (event, filePath) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return { success: true, content };
        } catch (err) {
            console.error('Read error:', err);
            return { success: false, error: err.message };
        }
    });

    // Handle Save As Dialog (Path Selection Only)
    ipcMain.handle('dialog:showSave', async (event, options) => {
        let dialogOptions;
        if (typeof options === 'string') {
            dialogOptions = {
                title: 'Save Layout',
                defaultPath: options || `layout-${new Date().toISOString().split('T')[0]}.broco`,
                filters: [{ name: 'Broco Layout', extensions: ['broco'] }]
            };
        } else {
            dialogOptions = options;
        }

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, dialogOptions);

        if (canceled || !filePath) return { canceled: true };
        return { success: true, path: filePath };
    });

    // Handle Binary File Save
    ipcMain.handle('file:save-binary', async (event, { data, path }) => {
        try {
            fs.writeFileSync(path, Buffer.from(data));
            return { success: true };
        } catch (err) {
            console.error('Binary save error:', err);
            return { success: false, error: err.message };
        }
    });

    // Handle Save As Dialog (Legacy / Combined)
    ipcMain.handle('file:save-dialog', async (event, data) => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Layout',
            defaultPath: `layout-${new Date().toISOString().split('T')[0]}.broco`,
            filters: [{ name: 'Broco Layout', extensions: ['broco'] }]
        });

        if (canceled || !filePath) return { canceled: true };

        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return { success: true, path: filePath };
        } catch (err) {
            console.error('Save As error:', err);
            return { success: false, error: err.message };
        }
    });

    // Handle Dirty Status Updates from Renderer
    ipcMain.on('update-dirty-status', (event, isDirty, path) => {
        if (mainWindow) {
            mainWindow.isDirty = isDirty;
            mainWindow.currentFilePath = path;

            // Optional: Update title to show dirty state
            const title = "BROCO" + (isDirty ? " •" : "");
            mainWindow.setTitle(title);
        }
    });

    // Handle Force Close from Renderer (Discard changes bypass)
    ipcMain.on('app:force-close', () => {
        if (mainWindow) {
            mainWindow.isDirty = false;
            mainWindow.close();
        }
    });

    // ============================================================
    // EXPORT WINDOW MANAGEMENT
    // ============================================================
    // Singleton, lazily-created, kept-loaded export window.
    // We avoid reloading the URL on every export. Instead, the renderer
    // listens for `render-content` messages and re-renders its DOM.
    // This eliminates the cost of reloading the entire app + handshake
    // for every export call (significant for multi-page jobs).
    // ============================================================

    /**
     * Downsample over-sized images to roughly the export resolution.
     *
     * Why: Chromium's printToPDF embeds images at their *original* resolution
     * regardless of how small they're displayed. A 6000x4000 photo placed in a
     * 800x600 region of a PDF page balloons the file size by 50-100x for no
     * visible quality benefit. Online compressors strip exactly this redundancy.
     *
     * We pre-process the assets array: for every image whose natural
     * dimensions exceed `targetMaxDim` we re-encode at that dimension. The
     * resulting data URL is what we send to the export window for rendering.
     *
     * Quality is preserved because we never downsample below the export
     * resolution itself - only above. Threshold is `targetMaxDim * 1.5`
     * to avoid pointless re-encoding when the image is only marginally larger.
     *
     * @param {Array} assets - The asset array from the renderer
     * @param {number} targetMaxDim - Max dimension (px) to downsample to
     * @returns {Promise<Array>} New asset array with downsampled images
     */
    async function downsampleAssetsForExport(assets, targetMaxDim) {
        if (!Array.isArray(assets) || !targetMaxDim || targetMaxDim <= 0) return assets;

        const SAFETY_MARGIN = 1.5; // Only downsample if the image exceeds 1.5x target
        const threshold = Math.round(targetMaxDim * SAFETY_MARGIN);

        const out = [];
        for (const asset of assets) {
            // Only process images. Text assets pass through unchanged.
            if (!asset || asset.type !== 'image') {
                out.push(asset);
                continue;
            }

            try {
                const fullData = asset.fullResData || asset.data;
                if (!fullData) {
                    out.push(asset);
                    continue;
                }

                // Build a NativeImage from the existing data URL
                let image;
                if (typeof fullData === 'string' && fullData.startsWith('data:')) {
                    image = nativeImage.createFromDataURL(fullData);
                } else if (asset.absolutePath && fs.existsSync(asset.absolutePath)) {
                    image = nativeImage.createFromPath(asset.absolutePath);
                } else {
                    out.push(asset);
                    continue;
                }

                if (!image || image.isEmpty()) {
                    out.push(asset);
                    continue;
                }

                const size = image.getSize();
                const maxDim = Math.max(size.width, size.height);

                // Skip if already small enough
                if (maxDim <= threshold) {
                    out.push(asset);
                    continue;
                }

                // Downsample to targetMaxDim on the longer edge, preserving aspect
                const scale = targetMaxDim / maxDim;
                const newW = Math.max(1, Math.round(size.width * scale));
                const newH = Math.max(1, Math.round(size.height * scale));

                const resized = image.resize({ width: newW, height: newH, quality: 'best' });

                // Re-encode. Use JPEG (quality 90) for opaque photos, PNG otherwise.
                // We can't easily detect transparency from NativeImage, so we use the
                // original mime type as a hint: PNG/GIF/WebP -> PNG, otherwise JPEG.
                const originalIsPng = /^data:image\/(png|gif|webp)/i.test(fullData) ||
                    /\.(png|gif|webp)$/i.test(asset.path || asset.name || '');
                let newDataUrl;
                if (originalIsPng) {
                    const buf = resized.toPNG();
                    newDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
                } else {
                    const buf = resized.toJPEG(90);
                    newDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
                }

                // Return a shallow-cloned asset with the downsampled data.
                // We mutate fullResData (high-res field used during export) and
                // also `data` for compatibility. We do NOT touch the absolutePath
                // because the renderer might still try to fetch via broco-local;
                // we override that by clearing `isReference`/`absolutePath` so the
                // renderer falls back to fullResData.
                out.push({
                    ...asset,
                    fullResData: newDataUrl,
                    data: newDataUrl,
                    isReference: false,
                    absolutePath: undefined,
                    _downsampled: true
                });
            } catch (err) {
                log.warn('Failed to downsample asset', asset && asset.name, err && err.message);
                out.push(asset);
            }
        }
        return out;
    }

    async function getExportWindow() {
        if (exportWin && !exportWin.isDestroyed() && exportWinReady) {
            return exportWin;
        }

        if (exportWinReadyPromise) {
            // Already in the process of creating/loading
            await exportWinReadyPromise;
            return exportWin;
        }

        exportWinReadyPromise = (async () => {
            if (!exportWin || exportWin.isDestroyed()) {
                exportWin = new BrowserWindow({
                    show: false,
                    width: 1280,
                    height: 800,
                    useContentSize: true,
                    frame: false,
                    webPreferences: {
                        offscreen: true,
                        preload: join(__dirname, 'preload.cjs'),
                        contextIsolation: true,
                        nodeIntegration: false,
                        backgroundThrottling: false
                    }
                });

                // When the export window emits ready-to-render, mark it as ready
                // and resolve any waiters. We use a single bootstrap rid for the
                // initial load; subsequent renders reuse the loaded window.
                const bootstrapRid = '__bootstrap__';
                const readyHandler = (event, data) => {
                    if (data && data.requestId === bootstrapRid) {
                        exportWinReady = true;
                        ipcMain.removeListener('ready-to-render', readyHandler);
                    }
                };
                ipcMain.on('ready-to-render', readyHandler);

                const exportUrl = !app.isPackaged
                    ? `http://localhost:5173?mode=export&rid=${bootstrapRid}`
                    : pathToFileURL(join(__dirname, '../dist/index.html')).toString() + `?mode=export&rid=${bootstrapRid}`;

                await exportWin.loadURL(exportUrl);

                // Wait for ready-to-render with a timeout
                const start = Date.now();
                while (!exportWinReady && Date.now() - start < 15000) {
                    await new Promise(r => setTimeout(r, 50));
                }
                if (!exportWinReady) {
                    ipcMain.removeListener('ready-to-render', readyHandler);
                    throw new Error('Export window failed to initialize.');
                }
            }
        })();

        try {
            await exportWinReadyPromise;
        } finally {
            exportWinReadyPromise = null;
        }
        return exportWin;
    }

    /**
     * Wait for the renderer to signal completion for a given requestId.
     * Returns the metadata object sent with render-complete.
     */
    function waitForRenderComplete(requestId, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                ipcMain.removeListener('render-complete', onComplete);
                reject(new Error('Export render timed out (render-complete)'));
            }, timeoutMs);

            function onComplete(event, data) {
                if (data && data.requestId === requestId) {
                    clearTimeout(timeout);
                    ipcMain.removeListener('render-complete', onComplete);
                    resolve(data);
                }
            }
            ipcMain.on('render-complete', onComplete);
        });
    }

    /**
     * Replace fixed-time waits with a deterministic settle:
     * 1. Wait for fonts.ready
     * 2. Decode all images
     * 3. Wait two animation frames so paint flushes in OSR
     * Reduces export latency dramatically vs. blanket setTimeout(500).
     */
    async function waitForPaintSettle(win) {
        try {
            await win.webContents.executeJavaScript(`
                (async () => {
                    if (document.fonts && document.fonts.ready) {
                        await document.fonts.ready;
                    }
                    const imgs = Array.from(document.images || []);
                    await Promise.all(imgs.map(img => {
                        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                        return new Promise(res => {
                            img.addEventListener('load', res, { once: true });
                            img.addEventListener('error', res, { once: true });
                        });
                    }));
                    // Two RAF flush
                    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                    return true;
                })();
            `, true);
        } catch {
            // Fallback short wait if executeJavaScript fails for any reason
            await new Promise(r => setTimeout(r, 100));
        }
    }

    /**
     * Render a single payload (one or many pages) in the export window
     * and capture the result.
     * Used for image export and as a building block for PDF.
     */
    async function renderAndCapture({ pageLayout, pageLayouts, width, height, format, settings, assets, pageNumber }) {
        const win = await getExportWindow();
        const requestId = Math.random().toString(36).substring(2, 10);

        // Resize window to requested capture dimensions
        win.setSize(Math.max(width, 100), Math.max(height, 100));
        win.setContentSize(Math.max(width, 100), Math.max(height, 100));
        win.webContents.setZoomFactor(1.0);

        // Send the render request to the (already loaded) export renderer.
        // The renderer clears its DOM and re-renders. No URL reload happens.
        const completePromise = waitForRenderComplete(requestId, 60000);
        win.webContents.send('render-content', {
            requestId,
            pageLayout,
            pageLayouts,
            width,
            height,
            settings,
            assets,
            pageNumber
        });

        const metadata = await completePromise;
        if (metadata.error) throw new Error(metadata.error);

        // Deterministic settle (replaces hardcoded 500ms wait)
        await waitForPaintSettle(win);

        let buffer;
        if (format === 'pdf') {
            buffer = await win.webContents.printToPDF({
                printBackground: true,
                preferCSSPageSize: true,
                generateTaggedPDF: false,
                generateDocumentOutline: false
            });
        } else {
            const image = await win.webContents.capturePage();
            buffer = (format === 'jpeg' || format === 'jpg') ? image.toJPEG(92) : image.toPNG();
        }

        return { data: buffer, links: metadata.links };
    }

    // Handle Off-screen Export (single render call - used for images and small PDFs)
    ipcMain.handle('render-export', async (event, options) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            throw new Error('Application is closing, export cancelled.');
        }

        try {
            // Pre-process assets: downsample any image significantly larger than
            // the export canvas. The longer dimension of any embedded image
            // never needs to exceed the export's longer dimension.
            const targetMax = Math.max(options.width || 0, options.height || 0);
            const downsampledAssets = await downsampleAssetsForExport(options.assets, targetMax);
            const result = await renderAndCapture({ ...options, assets: downsampledAssets });
            return result;
        } catch (err) {
            console.error('Export error (main):', err);
            throw err;
        }
    });

    /**
     * Streaming multi-page PDF export.
     * Renders each page individually in the export window (bounded memory),
     * then merges all single-page PDFs into a final document via pdf-lib.
     *
     * This is the recommended path for documents with many pages or many images.
     */
    ipcMain.handle('render-export-pdf-streaming', async (event, options) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            throw new Error('Application is closing, export cancelled.');
        }

        const { pageLayouts, width, height, settings, assets } = options;
        if (!Array.isArray(pageLayouts) || pageLayouts.length === 0) {
            throw new Error('pageLayouts is required');
        }

        // Downsample assets ONCE for the whole job, then reuse across pages.
        // The export-window asset cache (signature-based) ensures we don't
        // re-hydrate them between pages either.
        const targetMax = Math.max(width || 0, height || 0);
        const downsampledAssets = await downsampleAssetsForExport(assets, targetMax);

        const merged = await PDFDocument.create();
        const allLinks = [];

        for (let i = 0; i < pageLayouts.length; i++) {
            // Notify renderer of progress (best-effort)
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('export:progress', {
                    current: i + 1,
                    total: pageLayouts.length
                });
            }

            const { data, links } = await renderAndCapture({
                pageLayout: pageLayouts[i],
                width,
                height,
                format: 'pdf',
                settings,
                assets: downsampledAssets,
                pageNumber: i + 1
            });

            allLinks.push(links && links.length > 0 ? links[0] : []);

            // Load the single-page PDF and copy its page into the merged doc
            const single = await PDFDocument.load(data, { ignoreEncryption: true });
            const copiedPages = await merged.copyPages(single, single.getPageIndices());
            copiedPages.forEach(p => merged.addPage(p));
        }

        // Save with object stream compression for smaller file size
        const finalBytes = await merged.save({
            useObjectStreams: true,
            addDefaultPage: false
        });

        return {
            data: Buffer.from(finalBytes),
            links: allLinks
        };
    });

    // Pre-warm the export window in the background after main window is ready.
    // This makes the first export feel instant without delaying app startup.
    if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
            // Defer slightly so we don't compete with main window paint
            setTimeout(() => {
                getExportWindow().catch(err => {
                    log.warn('Failed to pre-warm export window:', err.message);
                });
            }, 2000);
        });
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
});
autoUpdater.on('update-available', (info) => {
    log.info('Update available.', info);
});
autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available.', info);
});
autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater.', err);
    // Optional: Notify user of error only in development or if critical
    // dialog.showErrorBox('Update Error', 'An error occurred while checking for updates: ' + err);
});
autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    log.info(log_message);
});
autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded');
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart now to install?',
        buttons: ['Restart', 'Later']
    }).then((returnValue) => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall();
    });
});
