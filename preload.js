const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wb', { recognize: d => ipcRenderer.invoke('hw', d) });
