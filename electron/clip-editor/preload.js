// Exposes a small, safe API to the editor window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipEditor', {
  openClips: () => ipcRenderer.invoke('clip-editor:open-clips'),
  openImages: () => ipcRenderer.invoke('clip-editor:open-images'),
  exportProject: (project, options) => ipcRenderer.invoke('clip-editor:export', project, options),
  cancelExport: () => ipcRenderer.invoke('clip-editor:cancel'),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('clip-editor:progress', listener);
    return () => ipcRenderer.removeListener('clip-editor:progress', listener);
  },
});
