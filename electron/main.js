import { app, BrowserWindow, shell, dialog, ipcMain, globalShortcut, protocol, net, Menu } from 'electron';
import { join, dirname, relative, basename } from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import electronUpdater from 'electron-updater';
import log from 'electron-log';
const { autoUpdater } = electronUpdater;

// Register custom protocol early
protocol.registerSchemesAsPrivileged([
    { scheme: 'broco-local', privileges: { bypassCSP: true, stream: true } }
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

    // Handle focus/blur to register Alt+Space shortcut only when active
    // This allows us to override the Windows system menu reliably
    mainWindow.on('focus', () => {
        globalShortcut.register('Alt+Space', () => {
            if (mainWindow) mainWindow.webContents.send('shortcut:long-split');
        });
        globalShortcut.register('CommandOrControl+N', () => {
            if (mainWindow) mainWindow.webContents.send('shortcut:new-page');
        });
        globalShortcut.register('CommandOrControl+Shift+N', () => {
            if (mainWindow) mainWindow.webContents.send('shortcut:duplicate-page');
        });
        globalShortcut.register('CommandOrControl+S', () => {
            if (mainWindow) mainWindow.webContents.send('shortcut:save-layout');
        });
    });

    mainWindow.on('blur', () => {
        globalShortcut.unregister('Alt+Space');
        globalShortcut.unregister('CommandOrControl+N');
        globalShortcut.unregister('CommandOrControl+Shift+N');
        globalShortcut.unregister('CommandOrControl+S');
    });

    // Check for updates once window is ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        autoUpdater.checkForUpdatesAndNotify();
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
            filters: [
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
        return results;
    });

    // Handle Off-screen Export
    ipcMain.handle('render-export', async (event, options) => {
        const { pageLayout, pageLayouts, width, height, format, settings, assets } = options;

        // Create an off-screen window
        let exportWin = new BrowserWindow({
            show: false,
            width: width,
            height: height,
            webPreferences: {
                offscreen: false, // We use a visible but hidden window for better compatibility than true offscreen
                preload: join(__dirname, 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        try {
            // Load the app in export mode
            if (!app.isPackaged) {
                await exportWin.loadURL('http://localhost:5173?mode=export');
            } else {
                await exportWin.loadFile(join(__dirname, '../dist/index.html'), { search: 'mode=export' });
            }

            // High-DPI support: Set zoom factor if we are exporting high-res images
            // But we actually pass specific width/height, so 1.0 is safer.
            exportWin.webContents.setZoomFactor(1.0);

            // Wait for window to be ready to render
            // The renderer needs time to initialize its listener
            await new Promise(resolve => setTimeout(resolve, 500));

            // Send layout data with full context (settings + assets)
            exportWin.webContents.send('render-content', {
                pageLayout,
                pageLayouts,
                width,
                height,
                settings,
                assets
            });

            // Wait for completion signal
            const metadata = await new Promise((resolve) => {
                ipcMain.once('render-complete', (event, data) => resolve(data || {}));
            });

            if (metadata.error) {
                throw new Error(metadata.error);
            }

            // Capture logic
            let buffer;
            if (format === 'pdf') {
                buffer = await exportWin.webContents.printToPDF({
                    printBackground: true,
                    landscape: width > height,
                    pageSize: { width: width / 96, height: height / 96, unit: 'in' }, // Convert px to inches (96DPI)
                    margins: { top: 0, bottom: 0, left: 0, right: 0 }
                });
            } else {
                // Image capture
                const image = await exportWin.webContents.capturePage();

                if (format === 'jpeg' || format === 'jpg') {
                    buffer = image.toJPEG(90);
                } else {
                    buffer = image.toPNG();
                }
            }

            return {
                data: buffer,
                links: metadata.links // Return extracted links
            };
        } catch (err) {
            console.error('Export error (main):', err);
            throw err;
        } finally {
            if (exportWin) exportWin.destroy();
        }
    });
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
