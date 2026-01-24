import { app, BrowserWindow, shell, dialog, ipcMain, globalShortcut } from 'electron';
import { join, dirname, relative, basename } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;


// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: "BROCO",
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: join(__dirname, '../public/icon.png') // Assuming icon exists later, or electron uses default
    });

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
                        type: isImage ? 'image' : 'text',
                        data: isImage ? `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${content.toString('base64')}` : content.toString('utf-8')
                    });
                }
            }
        };

        filePaths.forEach(p => processPath(p));
        return results;
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Auto-updater events (optional logging)
autoUpdater.on('checking-for-update', () => {
    // log.info('Checking for update...');
});
autoUpdater.on('update-available', (info) => {
    // log.info('Update available.');
});
autoUpdater.on('update-not-available', (info) => {
    // log.info('Update not available.');
});
autoUpdater.on('error', (err) => {
    // log.error('Error in auto-updater. ' + err);
});
autoUpdater.on('download-progress', (progressObj) => {
    // let log_message = "Download speed: " + progressObj.bytesPerSecond;
    // log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    // log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    // log.info(log_message);
});
autoUpdater.on('update-downloaded', (info) => {
    // log.info('Update downloaded');
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart now to install?',
        buttons: ['Restart', 'Later']
    }).then((returnValue) => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall();
    });
});
