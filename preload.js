'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('viny', {
  loadLibrary: () => ipcRenderer.invoke('lib:load'),
  saveLibrary: (data) => ipcRenderer.invoke('lib:save', data),
  createDisk: () => ipcRenderer.invoke('disk:create'),
  deleteDisk: (id) => ipcRenderer.invoke('disk:delete', id),
  removeFile: (id, file) => ipcRenderer.invoke('disk:removeFile', id, file),
  pickAudio: () => ipcRenderer.invoke('dialog:audio'),
  pickImage: () => ipcRenderer.invoke('dialog:image'),
  importAudio: (id, src) => ipcRenderer.invoke('disk:importAudio', id, src),
  importImage: (id, src, kind) => ipcRenderer.invoke('disk:importImage', id, src, kind),
  writeImage: (id, kind, dataUrl) => ipcRenderer.invoke('disk:writeImage', id, kind, dataUrl),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return file.path || null; } },
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  setTitleBar: (color, symbolColor) => ipcRenderer.invoke('win:overlay', color, symbolColor),
  mediaUrl: (id, file) => `viny://media/disks/${encodeURIComponent(id)}/${encodeURIComponent(file)}`
});
