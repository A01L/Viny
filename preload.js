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
  exportDisk: (disk) => ipcRenderer.invoke('disk:export', disk),
  importDisk: (filePath) => ipcRenderer.invoke('disk:import', filePath || null),
  pendingOpen: () => ipcRenderer.invoke('pending:open'),
  onOpenViny: (cb) => ipcRenderer.on('open-viny', (_e, p) => cb(p)),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  setTitleBar: (color, symbolColor) => ipcRenderer.invoke('win:overlay', color, symbolColor),
  mediaUrl: (id, file) => `viny://media/disks/${encodeURIComponent(id)}/${encodeURIComponent(file)}`
});
