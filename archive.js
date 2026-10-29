'use strict';
/*
 * Minimal ZIP writer/reader (no dependencies) used for the .viny record format.
 * Files are stored without compression (audio and images are already compressed),
 * which keeps export/import fast. The reader also accepts deflated entries, so an
 * archive re-packed by 7-Zip or Windows still imports.
 */
const fs = require('fs');
const fsp = fs.promises;
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** entries: [{ name, data?: Buffer, path?: string }] */
async function writeZip(outPath, entries) {
  const tmp = outPath + '.part';
  const fh = await fsp.open(tmp, 'w');
  const central = [];
  let offset = 0;
  const { time, date } = dosTime();
  try {
    for (const e of entries) {
      const data = e.data || await fsp.readFile(e.path);
      const name = Buffer.from(e.name, 'utf8');
      const crc = crc32(data);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
      await fh.write(lh); await fh.write(name); await fh.write(data);
      central.push({ name, crc, size: data.length, offset });
      offset += 30 + name.length + data.length;
      if (offset > 0xfffffff0) throw new Error('Архив слишком большой (больше 4 ГБ)');
    }
    const cdStart = offset;
    for (const c of central) {
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(c.crc, 16);
      ch.writeUInt32LE(c.size, 20); ch.writeUInt32LE(c.size, 24); ch.writeUInt16LE(c.name.length, 28);
      ch.writeUInt32LE(c.offset, 42);
      await fh.write(ch); await fh.write(c.name);
      offset += 46 + c.name.length;
    }
    const eo = Buffer.alloc(22);
    eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(central.length, 8); eo.writeUInt16LE(central.length, 10);
    eo.writeUInt32LE(offset - cdStart, 12); eo.writeUInt32LE(cdStart, 16);
    await fh.write(eo);
  } catch (err) {
    await fh.close(); await fsp.rm(tmp, { force: true }); throw err;
  }
  await fh.close();
  await fsp.rm(outPath, { force: true });
  await fsp.rename(tmp, outPath);
}

/** Returns { names: string[], read(name): Promise<Buffer>, close() } */
async function openZip(zipPath) {
  const fh = await fsp.open(zipPath, 'r');
  const { size } = await fh.stat();
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  await fh.read(tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) { await fh.close(); throw new Error('Файл повреждён или это не архив Viny'); }
  const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  if (count > 256 || cdOff + cdSize > size) { await fh.close(); throw new Error('Файл повреждён'); }
  const cd = Buffer.alloc(cdSize);
  await fh.read(cd, 0, cdSize, cdOff);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Файл повреждён');
    const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
    const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    const lho = cd.readUInt32LE(p + 42);
    const name = cd.slice(p + 46, p + 46 + nl).toString('utf8');
    entries.set(name, { method, crc, csize, usize, lho });
    p += 46 + nl + el + cl;
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new Error('Нет файла в архиве: ' + name);
      if (e.usize > 1024 * 1024 * 1024) throw new Error('Слишком большой файл в архиве');
      const lh = Buffer.alloc(30);
      await fh.read(lh, 0, 30, e.lho);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('Файл повреждён');
      const start = e.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const raw = Buffer.alloc(e.csize);
      await fh.read(raw, 0, e.csize, start);
      let data;
      if (e.method === 0) data = raw;
      else if (e.method === 8) data = zlib.inflateRawSync(raw);
      else throw new Error('Неподдерживаемое сжатие в архиве');
      if (crc32(data) !== e.crc) throw new Error('Файл в архиве повреждён: ' + name);
      return data;
    },
    close: () => fh.close()
  };
}

module.exports = { writeZip, openZip };
