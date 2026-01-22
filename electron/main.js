import { app, BrowserWindow, shell, dialog } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { autoUpdater } from 'electron-updater';
import isDev from 'electron-is-dev';

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
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: join(__dirname, '../public/icon.png') // Assuming icon exists later, or electron uses default
    });

    // Load the app
    if (isDev) {
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
