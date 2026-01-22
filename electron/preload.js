import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    // We can expose more methods here later
    platform: process.platform
});
