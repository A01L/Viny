'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { writeZip, openZip } = require('./archive');

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

/* ---------- .viny files opened from Explorer ---------- */
const pendingOpen = [];
const vinyArgs = (argv) => argv.filter((a) => /\.viny$/i.test(a) && fs.existsSync(a));
pendingOpen.push(...vinyArgs(process.argv));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  const files = vinyArgs(argv);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    for (const f of files) win.webContents.send('open-viny', f);
  }
});

app.whenReady().then(async () => {
  if (!gotLock) return;
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

/* ---------- export / import of a single record (.viny) ---------- */
const FORMAT = 'viny-record';
const FILE_KEYS = ['labelImage', 'labelSrc', 'sleeveImage', 'sleeveSrc'];
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

ipcMain.handle('pending:open', () => pendingOpen.splice(0));

ipcMain.handle('disk:export', async (_e, disk) => {
  const base = safeName([disk.artist, disk.title].filter(Boolean).join(' - ')) || 'Viny record';
  const r = await dialog.showSaveDialog(win, {
    title: 'Экспорт пластинки',
    defaultPath: path.join(app.getPath('documents'), base + '.viny'),
    filters: [{ name: 'Пластинка Viny', extensions: ['viny'] }]
  });
  if (r.canceled || !r.filePath) return null;
  const dir = diskDir(disk.id);
  const meta = JSON.parse(JSON.stringify(disk));
  delete meta.id;
  const files = [];
  const add = (f) => {
    if (!f) return null;
    const name = path.basename(f);
    if (!fs.existsSync(path.join(dir, name))) return null;
    if (!files.includes(name)) files.push(name);
    return name;
  };
  for (const k of FILE_KEYS) meta[k] = add(meta[k]);
  meta.tracks = (meta.tracks || []).map((t) => ({ ...t, file: add(t.file) })).filter((t) => t.file);
  const manifest = { format: FORMAT, version: 1, app: 'Viny ' + app.getVersion(), exported: new Date().toISOString(), disk: meta };
  await writeZip(r.filePath, [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    ...files.map((f) => ({ name: 'files/' + f, path: path.join(dir, f) }))
  ]);
  return { path: r.filePath, name: path.basename(r.filePath), tracks: meta.tracks.length };
});

ipcMain.handle('disk:import', async (_e, filePath) => {
  if (!filePath) {
    const r = await dialog.showOpenDialog(win, {
      title: 'Импорт пластинки',
      properties: ['openFile'],
      filters: [{ name: 'Пластинка Viny', extensions: ['viny'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    filePath = r.filePaths[0];
  }
  const zip = await openZip(filePath);
  const id = Date.now().toString(36) + rid(3);
  const dir = diskDir(id);
  try {
    if (!zip.names.includes('manifest.json')) throw new Error('Это не пластинка Viny: нет описания диска');
    let manifest;
    try { manifest = JSON.parse((await zip.read('manifest.json')).toString('utf8')); }
    catch { throw new Error('Описание диска повреждено'); }
    if (!manifest || manifest.format !== FORMAT || !manifest.disk) throw new Error('Это не пластинка Viny');
    if (manifest.version > 1) throw new Error('Пластинка создана в более новой версии Viny');
    const src = manifest.disk;
    await fsp.mkdir(dir, { recursive: true });
    const extracted = new Map();
    const take = async (f, allowed) => {
      if (!f || typeof f !== 'string') return null;
      const name = path.basename(f);
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!allowed.includes(ext) || !zip.names.includes('files/' + name)) return null;
      if (!extracted.has(name)) {
        await fsp.writeFile(path.join(dir, name), await zip.read('files/' + name));
        extracted.set(name, true);
      }
      return name;
    };
    const str = (v, n = 100) => (typeof v === 'string' ? v.slice(0, n) : '');
    const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
    const disk = {
      id,
      title: str(src.title) || 'Без названия',
      artist: str(src.artist),
      vinylColor: /^[a-z]+$/.test(src.vinylColor || '') ? src.vinylColor : 'black',
      labelColor: color(src.labelColor, '#f2efe8'),
      labelText: src.labelText !== false,
      labelTextOnImage: !!src.labelTextOnImage,
      labelImage: await take(src.labelImage, IMAGE_EXT),
      labelSrc: await take(src.labelSrc, IMAGE_EXT),
      labelCrop: src.labelCrop && typeof src.labelCrop === 'object' ? src.labelCrop : null,
      sleeveColor: color(src.sleeveColor, '#2b2d33'),
      sleeveImage: await take(src.sleeveImage, IMAGE_EXT),
      sleeveSrc: await take(src.sleeveSrc, IMAGE_EXT),
      sleeveCrop: src.sleeveCrop && typeof src.sleeveCrop === 'object' ? src.sleeveCrop : null,
      sleeveText: src.sleeveText !== false,
      tracks: [],
      created: Date.now(),
      rev: 1
    };
    for (const t of (Array.isArray(src.tracks) ? src.tracks : []).slice(0, 15)) {
      const file = await take(t && t.file, AUDIO_EXT);
      if (!file) continue;
      disk.tracks.push({ id: rid(4), title: str(t.title) || 'Без названия', file, duration: Number(t.duration) || null });
    }
    return { disk };
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw err;
  } finally {
    await zip.close();
  }
});
