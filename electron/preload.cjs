const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    openAssets: (options) => ipcRenderer.invoke('dialog:openAssets', options),
    onLongSplit: (callback) => ipcRenderer.on('shortcut:long-split', () => callback()),
    onNewPage: (callback) => ipcRenderer.on('shortcut:new-page', () => callback()),
    onDuplicatePage: (callback) => ipcRenderer.on('shortcut:duplicate-page', () => callback()),
    onSaveLayout: (callback) => ipcRenderer.on('shortcut:save-layout', () => callback()),
    saveFile: (data, path) => ipcRenderer.invoke('file:save', data, path),
    saveFileDialog: (data) => ipcRenderer.invoke('file:save-dialog', data),
    readFile: (path) => ipcRenderer.invoke('file:read', path),
    updateDirtyStatus: (isDirty, path) => ipcRenderer.send('update-dirty-status', isDirty, path),
    onRequestClose: (callback) => ipcRenderer.on('app:request-close', () => callback()),
    forceClose: () => ipcRenderer.send('app:force-close'),

    // Export APIs
    renderExport: (options) => ipcRenderer.invoke('render-export', options),
    sendReadyToRender: (requestId) => ipcRenderer.send('ready-to-render', { requestId }),
    onRenderContent: (callback) => ipcRenderer.on('render-content', (event, data) => callback(data)),
    sendRenderComplete: (metadata) => ipcRenderer.send('render-complete', metadata)
});
