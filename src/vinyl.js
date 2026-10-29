'use strict';
/* Record geometry (normalised to record radius = 1) */
const GEO = { EDGE: 1, GROOVE_OUT: 0.955, GROOVE_IN: 0.505, LOCK: 0.465, LABEL: 0.40 };

const VINYL_COLORS = {
  black:  { name: 'Классический чёрный', base: '#0c0c0e', alpha: 1, light: false },
  smoke:  { name: 'Дымчатый', base: '#3a3d46', alpha: 0.82, light: false },
  red:    { name: 'Рубиновый', base: '#8a0f1b', alpha: 0.86, light: false },
  orange: { name: 'Янтарный', base: '#c4570f', alpha: 0.86, light: false },
  gold:   { name: 'Золотой', base: '#b98a2e', alpha: 1, light: true },
  green:  { name: 'Изумрудный', base: '#0f5b3d', alpha: 0.86, light: false },
  blue:   { name: 'Сапфировый', base: '#123f86', alpha: 0.86, light: false },
  purple: { name: 'Аметист', base: '#4d1f7d', alpha: 0.86, light: false },
  pink:   { name: 'Розовый', base: '#d66f98', alpha: 0.9, light: true },
  white:  { name: 'Белый', base: '#e9e6df', alpha: 1, light: true }
};

const LEAD_IN = 3.0, GAP = 2.4, TAIL = 1.6;

/* Program layout: time positions of lead-in, tracks and gaps on one side */
function layoutDisk(disk) {
  const tracks = (disk && disk.tracks) || [];
  const segs = [];
  let t = 0;
  segs.push({ kind: 'leadin', start: 0, end: LEAD_IN, idx: -1 });
  t = LEAD_IN;
  tracks.forEach((tr, i) => {
    const d = tr.duration && isFinite(tr.duration) ? tr.duration : 180;
    segs.push({ kind: 'track', start: t, end: t + d, idx: i });
    t += d;
    if (i < tracks.length - 1) { segs.push({ kind: 'gap', start: t, end: t + GAP, idx: i }); t += GAP; }
  });
  if (!tracks.length) { segs.push({ kind: 'gap', start: t, end: t + 600, idx: -1 }); t += 600; }
  segs.push({ kind: 'gap', start: t, end: t + TAIL, idx: tracks.length - 1 });
  t += TAIL;
  return { segs, total: t };
}
function segAt(layout, pos) {
  if (pos >= layout.total) return { kind: 'runout', idx: -1, local: 0, remain: 0, radiusK: 1 };
  for (const s of layout.segs) {
    if (pos < s.end) return { kind: s.kind, idx: s.idx, local: pos - s.start, remain: s.end - pos, radiusK: pos / layout.total, start: s.start };
  }
  return { kind: 'runout', idx: -1, local: 0, remain: 0, radiusK: 1 };
}
function radiusAt(layout, pos) {
  if (pos >= layout.total) return GEO.LOCK;
  const k = Math.max(0, pos / layout.total);
  return GEO.GROOVE_OUT - (GEO.GROOVE_OUT - GEO.GROOVE_IN) * k;
}
function posAtRadius(layout, r) {
  if (r >= GEO.GROOVE_OUT) return 0;
  if (r <= GEO.GROOVE_IN) return layout.total + 0.01;
  return ((GEO.GROOVE_OUT - r) / (GEO.GROOVE_OUT - GEO.GROOVE_IN)) * layout.total;
}
function trackStartPos(layout, idx) {
  const s = layout.segs.find((x) => x.kind === 'track' && x.idx === idx);
  return s ? s.start : 0;
}

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function isLightColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150;
}

/* Seeded random so a disk always looks the same */
function seeded(seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

/**
 * Renders the (un-lit) record surface as a square canvas.
 * images.label: HTMLImageElement (square, already cropped) or null
 */
function renderRecordTexture(disk, size, images = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const R = size / 2;
  g.translate(R, R);
  const vc = VINYL_COLORS[(disk && disk.vinylColor) || 'black'] || VINYL_COLORS.black;
  const rand = seeded((disk && disk.id) || 'empty');

  // vinyl body
  g.globalAlpha = vc.alpha;
  g.beginPath(); g.arc(0, 0, R * GEO.EDGE, 0, Math.PI * 2); g.fillStyle = vc.base; g.fill();
  g.globalAlpha = 1;

  // subtle radial depth
  const depth = g.createRadialGradient(0, 0, R * 0.4, 0, 0, R);
  depth.addColorStop(0, 'rgba(255,255,255,0.02)');
  depth.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = depth; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();

  const lineLight = vc.light ? 'rgba(0,0,0,' : 'rgba(255,255,255,';
  // grooves
  const r0 = R * GEO.GROOVE_OUT, r1 = R * GEO.GROOVE_IN;
  const step = Math.max(0.9, size / 1400);
  g.lineWidth = step * 0.55;
  for (let r = r0; r > r1; r -= step) {
    const a = (vc.light ? 0.05 : 0.035) + rand() * (vc.light ? 0.06 : 0.05);
    g.strokeStyle = lineLight + a + ')';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    if (rand() < 0.08) {
      g.strokeStyle = 'rgba(0,0,0,' + (0.15 + rand() * 0.2) + ')';
      g.beginPath(); g.arc(0, 0, r - step * 0.5, 0, Math.PI * 2); g.stroke();
    }
  }

  // smooth bands: lead-in edge, gaps between tracks, dead wax
  const lay = layoutDisk(disk);
  const ringAt = (k, w, alpha) => {
    const r = R * (GEO.GROOVE_OUT - (GEO.GROOVE_OUT - GEO.GROOVE_IN) * k);
    g.lineWidth = w;
    g.strokeStyle = vc.base; g.globalAlpha = vc.alpha; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = (vc.light ? 'rgba(255,255,255,' : 'rgba(255,255,255,') + alpha + ')';
    g.lineWidth = w * 0.35; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  };
  for (const s of lay.segs) {
    if (s.kind === 'gap' && s !== lay.segs[lay.segs.length - 1] && disk && disk.tracks && disk.tracks.length) {
      ringAt((s.start + s.end) / 2 / lay.total, R * 0.008, 0.05);
    }
  }
  // outer smooth lead-in rim
  g.lineWidth = R * (GEO.EDGE - GEO.GROOVE_OUT);
  g.strokeStyle = vc.base; g.globalAlpha = vc.alpha;
  g.beginPath(); g.arc(0, 0, R * (GEO.EDGE + GEO.GROOVE_OUT) / 2, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;
  const rim = g.createRadialGradient(0, 0, R * 0.975, 0, 0, R);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.6, 'rgba(255,255,255,0.10)');
  rim.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = rim; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.arc(0, 0, R * 0.975, 0, Math.PI * 2, true); g.fill();

  // dead wax (smooth, a bit glossier)
  g.beginPath(); g.arc(0, 0, R * GEO.GROOVE_IN, 0, Math.PI * 2); g.arc(0, 0, R * GEO.LABEL, 0, Math.PI * 2, true);
  g.globalAlpha = vc.alpha; g.fillStyle = vc.base; g.fill(); g.globalAlpha = 1;
  g.fillStyle = vc.light ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.22)'; g.fill();
  // locked groove + lead-out spiral hint
  g.strokeStyle = lineLight + '0.12)'; g.lineWidth = step * 0.8;
  g.beginPath(); g.arc(0, 0, R * GEO.LOCK, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  for (let a = 0; a < Math.PI * 2 * 1.5; a += 0.05) {
    const r = R * (GEO.GROOVE_IN - (GEO.GROOVE_IN - GEO.LOCK) * (a / (Math.PI * 3)));
    a === 0 ? g.moveTo(r, 0) : g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.stroke();
  // matrix etching
  g.save();
  g.fillStyle = lineLight + '0.16)';
  g.font = `${Math.round(R * 0.022)}px "Segoe UI", sans-serif`;
  const matrix = `VINY-${String((disk && disk.id) || '000').slice(-4).toUpperCase()}-A1  ◦  ${(disk && disk.title) || ''}`.slice(0, 40);
  const rm = R * (GEO.LABEL + GEO.LOCK) / 2 + R * 0.006;
  let ang = -Math.PI * 0.85;
  for (const ch of matrix) {
    g.save(); g.rotate(ang); g.translate(0, -rm); g.fillText(ch, 0, 0); g.restore();
    ang += (g.measureText(ch).width + R * 0.004) / rm;
  }
  g.restore();

  // label
  drawLabel(g, disk, R * GEO.LABEL, images.label);

  // spindle hole
  g.beginPath(); g.arc(0, 0, R * 0.018, 0, Math.PI * 2); g.fillStyle = '#1a1a1a'; g.fill();
  return cv;
}

function drawLabel(g, disk, lr, img) {
  const col = (disk && disk.labelColor) || '#f2efe8';
  g.save();
  g.beginPath(); g.arc(0, 0, lr, 0, Math.PI * 2); g.clip();
  g.fillStyle = col; g.fillRect(-lr, -lr, lr * 2, lr * 2);
  if (img && img.complete && img.naturalWidth) {
    g.drawImage(img, -lr, -lr, lr * 2, lr * 2);
  }
  // paper grain
  const rand = seeded('grain' + ((disk && disk.id) || ''));
  g.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rand() < 0.5 ? '#000' : '#fff';
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * lr;
    g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1.4, 1.4);
  }
  g.globalAlpha = 1;
  // printed text
  const showText = disk && disk.labelText !== false && (!disk.labelImage || disk.labelTextOnImage);
  if (disk && showText) {
    const light = isLightColor(col) && !disk.labelImage;
    const ink = light ? 'rgba(20,20,22,0.88)' : 'rgba(255,255,255,0.92)';
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (disk.labelImage) { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = lr * 0.04; }
    g.font = `700 ${Math.round(lr * 0.15)}px "Segoe UI", sans-serif`;
    fitText(g, (disk.title || 'Без названия'), 0, -lr * 0.5, lr * 1.3, lr * 0.15, 700);
    g.font = `400 ${Math.round(lr * 0.1)}px "Segoe UI", sans-serif`;
    fitText(g, (disk.artist || ''), 0, -lr * 0.32, lr * 1.4, lr * 0.1, 400);
    g.font = `600 ${Math.round(lr * 0.062)}px "Segoe UI", sans-serif`;
    g.fillText('SIDE A   ·   33⅓ RPM', 0, lr * 0.36);
    g.font = `800 ${Math.round(lr * 0.085)}px "Segoe UI", sans-serif`;
    g.fillText('Viny', 0, lr * 0.56);
    g.shadowBlur = 0;
  }
  // inner edge shading
  const sh = g.createRadialGradient(0, 0, lr * 0.85, 0, 0, lr);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = sh; g.fillRect(-lr, -lr, lr * 2, lr * 2);
  g.restore();
}
function fitText(g, text, x, y, maxW, px, weight) {
  let size = px;
  g.font = `${weight} ${Math.round(size)}px "Segoe UI", sans-serif`;
  while (g.measureText(text).width > maxW && size > px * 0.5) {
    size -= 1; g.font = `${weight} ${Math.round(size)}px "Segoe UI", sans-serif`;
  }
  let t = text;
  while (g.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -2) + '…';
  g.fillText(t, x, y);
}

/* Static lighting drawn on top of the rotating record (doesn't rotate). */
function drawRecordSheen(g, cx, cy, R, light) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, R * 0.995, 0, Math.PI * 2);
  g.arc(cx, cy, R * GEO.LABEL, 0, Math.PI * 2, true);
  g.clip('evenodd');
  const k = light ? 0.55 : 1;
  const cg = g.createConicGradient(-Math.PI / 4 - 0.25, cx, cy);
  const stops = [[0, 0], [0.04, 0.05], [0.085, 0.24], [0.13, 0.05], [0.2, 0], [0.5, 0], [0.54, 0.05], [0.585, 0.2], [0.63, 0.05], [0.7, 0], [1, 0]];
  for (const [p, a] of stops) cg.addColorStop(p, `rgba(255,255,255,${a * k})`);
  g.fillStyle = cg; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  // narrow bright streaks
  const cg2 = g.createConicGradient(-Math.PI / 4 - 0.12, cx, cy);
  const s2 = [[0, 0], [0.06, 0], [0.075, 0.18], [0.09, 0], [0.56, 0], [0.575, 0.14], [0.59, 0], [1, 0]];
  for (const [p, a] of s2) cg2.addColorStop(p, `rgba(255,255,255,${a * k})`);
  g.fillStyle = cg2; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  // ring banding of the light (grooves catch light at certain radii)
  const rg = g.createRadialGradient(cx, cy, R * GEO.LABEL, cx, cy, R);
  rg.addColorStop(0, 'rgba(0,0,0,0.12)');
  rg.addColorStop(0.25, 'rgba(0,0,0,0)');
  rg.addColorStop(0.9, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = rg; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.restore();
  // soft light over label
  g.save();
  g.beginPath(); g.arc(cx, cy, R * GEO.LABEL, 0, Math.PI * 2); g.clip();
  const lg = g.createLinearGradient(cx - R * 0.4, cy - R * 0.4, cx + R * 0.4, cy + R * 0.4);
  lg.addColorStop(0, 'rgba(255,255,255,0.10)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = lg; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.restore();
}

function loadImage(url) {
  return new Promise((res) => {
    if (!url) return res(null);
    const im = new Image();
    if (!/^(data|blob):/.test(url)) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

Object.assign(window, { GEO, VINYL_COLORS, layoutDisk, segAt, radiusAt, posAtRadius, trackStartPos, renderRecordTexture, drawRecordSheen, loadImage, shade, isLightColor, hexToRgb });
