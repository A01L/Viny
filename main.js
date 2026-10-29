'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'viny', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }
]);

const LIB = () => path.join(app.getPath('userData'), 'library');
const LIB_JSON = () => path.join(LIB(), 'library.json');
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

const rid = (n = 6) => crypto.randomBytes(n).toString('hex');
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
const diskDir = (id) => path.join(LIB(), 'disks', safeId(id));

async function readLib() {
  try { return JSON.parse(await fsp.readFile(LIB_JSON(), 'utf8')); }
  catch { return { disks: [], settings: {} }; }
}
async function writeLib(data) {
  await fsp.mkdir(LIB(), { recursive: true });
  const tmp = LIB_JSON() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, LIB_JSON());
  return true;
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#1a1b1d',
    title: 'Viny',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#d3d5d8', symbolColor: '#2c2e33', height: 34 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // never open links inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https:/.test(url)) shell.openExternal(url); } });
}

app.whenReady().then(async () => {
  await fsp.mkdir(path.join(LIB(), 'disks'), { recursive: true });
  protocol.handle('viny', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const full = path.normalize(path.join(LIB(), rel));
    if (!full.startsWith(path.normalize(LIB()))) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString()).then((r) => {
      const headers = new Headers(r.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-cache');
      return new Response(r.body, { status: r.status, headers });
    }).catch(() => new Response('not found', { status: 404 }));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------- IPC ---------- */
ipcMain.handle('lib:load', () => readLib());
ipcMain.handle('lib:save', (_e, data) => writeLib(data));

ipcMain.handle('disk:create', async () => {
  const id = Date.now().toString(36) + rid(3);
  await fsp.mkdir(diskDir(id), { recursive: true });
  return id;
});
ipcMain.handle('disk:delete', async (_e, id) => {
  await fsp.rm(diskDir(id), { recursive: true, force: true });
  return true;
});
ipcMain.handle('disk:removeFile', async (_e, id, file) => {
  if (!file) return false;
  await fsp.rm(path.join(diskDir(id), path.basename(file)), { force: true });
  return true;
});

ipcMain.handle('dialog:audio', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Добавить музыку',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Аудио', extensions: AUDIO_EXT }]
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выбрать изображение',
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: IMAGE_EXT }]
  });
  return r.canceled ? null : r.filePaths[0];
});

async function importFile(id, src, prefix, allowed) {
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!allowed.includes(ext)) throw new Error('Формат не поддерживается: ' + ext);
  const name = `${prefix}_${rid(4)}.${ext}`;
  await fsp.mkdir(diskDir(id), { recursive: true });
  await fsp.copyFile(src, path.join(diskDir(id), name));
  return { file: name, name: path.basename(src, path.extname(src)) };
}
ipcMain.handle('disk:importAudio', (_e, id, src) => importFile(id, src, 'track', AUDIO_EXT));
ipcMain.handle('disk:importImage', (_e, id, src, kind) => importFile(id, src, `${kind}_src`, IMAGE_EXT));

ipcMain.handle('disk:writeImage', async (_e, id, kind, dataUrl) => {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('bad image');
  const name = `${kind}_${rid(4)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  await fsp.mkdir(diskDir(id), { recursive: true });
  await fsp.writeFile(path.join(diskDir(id), name), Buffer.from(m[2], 'base64'));
  return name;
});

ipcMain.handle('win:overlay', (_e, color, symbolColor) => {
  try { win.setTitleBarOverlay({ color, symbolColor, height: 34 }); } catch {}
  return true;
});

ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\/github\.com\//.test(String(url))) shell.openExternal(url);
  return true;
});
