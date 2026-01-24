const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    openAssets: (options) => ipcRenderer.invoke('dialog:openAssets', options)
});
