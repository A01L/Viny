'use strict';
/* Browser-only fallback so the UI can be previewed outside Electron. Not used in the app. */
if (!window.viny) {
  const store = { disks: [], settings: {}, current: null };
  const blobs = new Map();
  const makeWav = (seconds, f0) => {
    const sr = 22050, n = sr * seconds, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const notes = [0, 4, 7, 12, 7, 4];
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = Math.floor(t * 2) % notes.length, f = f0 * Math.pow(2, notes[k] / 12);
      const env = Math.min(1, (t * 2 % 1) * 20) * Math.exp(-(t * 2 % 1) * 2);
      v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * t) * env * 9000, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  };
  let c = 0;
  window.viny = {
    mock: true,
    loadLibrary: async () => JSON.parse(JSON.stringify(store)),
    saveLibrary: async (d) => { Object.assign(store, JSON.parse(JSON.stringify(d))); return true; },
    createDisk: async () => 'm' + Date.now().toString(36) + (c++),
    deleteDisk: async () => true,
    removeFile: async () => true,
    pickAudio: async () => ['Demo Melody.wav', 'Second Song.wav'],
    pickImage: async () => null,
    importAudio: async (id, src) => {
      const u = URL.createObjectURL(makeWav(20, 220 + Math.random() * 110));
      return { file: u, name: src.replace(/\.[^.]+$/, '') };
    },
    importImage: async () => { throw new Error('mock'); },
    writeImage: async (id, kind, dataUrl) => dataUrl,
    pathForFile: (f) => f.name,
    setTitleBar: async () => true,
    openExternal: async (u) => { window.open(u, '_blank'); return true; },
    mediaUrl: (id, file) => (/^(data|blob):/.test(file) ? file : `viny://media/disks/${id}/${file}`)
  };
}
