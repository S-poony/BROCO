const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    openAssets: (options) => ipcRenderer.invoke('dialog:openAssets', options),
    onLongSplit: (callback) => ipcRenderer.on('shortcut:long-split', () => callback()),
    onNewPage: (callback) => ipcRenderer.on('shortcut:new-page', () => callback()),
    onDuplicatePage: (callback) => ipcRenderer.on('shortcut:duplicate-page', () => callback()),
    onSaveLayout: (callback) => ipcRenderer.on('shortcut:save-layout', () => callback()),

    // Export APIs
    renderExport: (options) => ipcRenderer.invoke('render-export', options),
    onRenderContent: (callback) => ipcRenderer.on('render-content', (event, data) => callback(data)),
    sendRenderComplete: (metadata) => ipcRenderer.send('render-complete', metadata)
});
