const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    openAssets: (options) => ipcRenderer.invoke('dialog:openAssets', options),
    onLongSplit: (callback) => ipcRenderer.on('shortcut:long-split', () => callback()),
    onNewPage: (callback) => ipcRenderer.on('shortcut:new-page', () => callback()),
    onDuplicatePage: (callback) => ipcRenderer.on('shortcut:duplicate-page', () => callback()),
    onSaveLayout: (callback) => ipcRenderer.on('shortcut:save-layout', () => callback())
});
