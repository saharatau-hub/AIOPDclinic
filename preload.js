const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  saveText: (text) => ipcRenderer.invoke('saveText', text)
});
