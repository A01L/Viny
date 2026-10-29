'use strict';
/*
 * Procedural materials. One light source for the whole scene: upper-left.
 *  - brushedPlate: horizontally brushed aluminium (streaks via running box blur)
 *  - spunDisc: concentric "spun" metal with the anisotropic bow-tie highlight
 *  - recordSheenMap: static groove reflections for a record (rings + light lobes)
 */
const LIGHT_ANGLE = -Math.PI * 0.75;          // direction from object towards the light
const LIGHT_VEC = { x: Math.cos(LIGHT_ANGLE), y: Math.sin(LIGHT_ANGLE) };

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
function smoothNoise1D(n, passes, seed, win) {
  const r = rng(seed); let a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = r();
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -win; k <= win; k++) { const j = i + k; if (j >= 0 && j < n) { s += a[j]; c++; } }
      b[i] = s / c;
    }
    a = b;
  }
  // normalise to 0..1
  let mn = Infinity, mx = -Infinity;
  for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = 0; i < n; i++) a[i] = (a[i] - mn) / (mx - mn || 1);
  return a;
}

/* Brushed aluminium plate of w×h device pixels. */
function brushedPlate(w, h, seed = 11) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  // base light: bright upper-left, falling off to the lower right, with a soft vertical sheen band
  const base = g.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#e6e8eb'); base.addColorStop(0.42, '#cfd2d6'); base.addColorStop(1, '#a9adb2');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const band = g.createLinearGradient(0, 0, w, 0);
  band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.22, 'rgba(255,255,255,0.22)');
  band.addColorStop(0.38, 'rgba(255,255,255,0.05)'); band.addColorStop(0.62, 'rgba(255,255,255,0)');
  band.addColorStop(0.8, 'rgba(0,0,0,0.05)'); band.addColorStop(1, 'rgba(255,255,255,0.06)');
  g.fillStyle = band; g.fillRect(0, 0, w, h);

  // streak texture
  const img = g.createImageData(w, h), d = img.data, r = rng(seed);
  const row = new Float32Array(w + 1), WIN = Math.max(40, Math.round(w / 22));
  for (let y = 0; y < h; y++) {
    row[0] = 0;
    for (let x = 0; x < w; x++) row[x + 1] = row[x] + r();
    const rowBias = (r() - 0.5) * 0.9;
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - WIN), b = Math.min(w, x + WIN);
      const box = (row[b] - row[a]) / (b - a);           // ~0.5 ± small
      let v = (box - 0.5) * 9 + rowBias + (r() - 0.5) * 0.35;
      v = Math.max(-1, Math.min(1, v));
      const i = (y * w + x) * 4;
      const c = v > 0 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = Math.abs(v) * 22;
    }
  }
  const tex = document.createElement('canvas'); tex.width = w; tex.height = h;
  tex.getContext('2d').putImageData(img, 0, 0);
  g.drawImage(tex, 0, 0);
  return cv;
}

/* Spun (concentric) metal disc, size px. */
function spunDisc(size, opt = {}) {
  const lo = opt.lo || [128, 132, 138], hi = opt.hi || [246, 247, 249];
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  const R = size / 2, rings = smoothNoise1D(Math.ceil(R) + 2, 1, opt.seed || 5, 1);
  const rings2 = smoothNoise1D(Math.ceil(R) + 2, 3, (opt.seed || 5) + 9, 4);
  const r = rng((opt.seed || 5) * 31);
  const sharp = opt.sharp || 5, gain = opt.gain == null ? 1 : opt.gain;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, rr = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (rr > R) { d[i + 3] = 0; continue; }
      const a = Math.atan2(dy, dx);
      const c = Math.cos(a - LIGHT_ANGLE);
      const bow = Math.pow(Math.abs(c), sharp);                    // bow-tie highlight
      const side = Math.pow(Math.abs(Math.sin(a - LIGHT_ANGLE)), 8) * 0.12;
      const ri = rr | 0;
      let t = 0.3 + 0.55 * bow * gain + side + (rings[ri] - 0.5) * 0.16 + (rings2[ri] - 0.5) * 0.14 + (r() - 0.5) * 0.04;
      t += (c > 0 ? 0.05 : -0.03) * bow;                          // light side slightly brighter
      t = Math.max(0, Math.min(1, t));
      d[i] = lo[0] + (hi[0] - lo[0]) * t; d[i + 1] = lo[1] + (hi[1] - lo[1]) * t; d[i + 2] = lo[2] + (hi[2] - lo[2]) * t;
      d[i + 3] = rr > R - 1 ? (R - rr) * 255 : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/* Static reflection map for a record (white with alpha). Drawn un-rotated over the spinning record. */
function recordSheenMap(size, disk) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  const R = size / 2, N = Math.ceil(R) + 2;
  const vc = (VINYL_COLORS[(disk && disk.vinylColor) || 'black'] || VINYL_COLORS.black);
  const light = vc.light;
  const seed = String((disk && disk.id) || 'x').split('').reduce((s, ch) => s * 31 + ch.charCodeAt(0) >>> 0, 7);
  const fine = smoothNoise1D(N, 1, seed, 1), mid = smoothNoise1D(N, 2, seed + 3, 3), wide = smoothNoise1D(N, 3, seed + 5, 10);
  // smooth (mirror) bands: gaps + lead-in + dead wax
  const lay = layoutDisk(disk), smooth = new Float32Array(N);
  const mark = (r0, r1, v) => { for (let i = Math.floor(r0 * R); i <= Math.ceil(r1 * R) && i < N; i++) smooth[i] = Math.max(smooth[i], v); };
  mark(GEO.GROOVE_OUT, GEO.EDGE * 0.985, 1);
  mark(GEO.LABEL, GEO.GROOVE_IN, 1);
  if (disk && disk.tracks && disk.tracks.length) {
    for (const s of lay.segs) {
      if (s.kind !== 'gap') continue;
      const k = (s.start + s.end) / 2 / lay.total, rr = GEO.GROOVE_OUT - (GEO.GROOVE_OUT - GEO.GROOVE_IN) * k;
      mark(rr - 0.004, rr + 0.004, 1);
    }
  }
  const lobeA = LIGHT_ANGLE + Math.PI / 2 + 0.25; // groove highlights sit perpendicular to the light
  const amp = light ? 0.55 : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, rr = Math.sqrt(dx * dx + dy * dy), rn = rr / R;
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      if (rn > 0.995 || rn < GEO.LABEL) { d[i + 3] = 0; continue; }
      const a = Math.atan2(dy, dx);
      let da = Math.abs(((a - lobeA) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2); // distance to either lobe
      const ri = rr | 0, sm = smooth[ri];
      const w = 0.2 + 0.16 * (1 - rn) + sm * -0.08;               // smooth areas give narrower, crisper lobes
      const lobe = Math.exp(-(da * da) / (w * w));
      const broad = Math.exp(-(da * da) / 0.9) * 0.05;
      const groove = 0.25 + 0.4 * fine[ri] + 0.35 * mid[ri] * wide[ri];
      const refl = sm ? 0.75 + 0.25 * sm : groove;
      // the lobe on the light side is a little stronger
      const sideK = Math.cos(a - LIGHT_ANGLE) > 0 ? 1 : 0.82;
      let al = (lobe * refl * 0.85 * sideK + broad) * amp;
      d[i + 3] = Math.max(0, Math.min(255, al * 255));
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/* A metal cylinder seen from above, drawn along +x in the current transform.
 * hl: highlight position across the cylinder (-1 top .. 1 bottom). */
function metalBar(g, x, y, w, h, r, hl = -0.25, tint) {
  const t = tint || { dark: '#4f5358', mid: '#b4b8bd', light: '#eef0f2', spec: '#ffffff', bounce: '#9ea2a7' };
  const gr = g.createLinearGradient(0, y, 0, y + h);
  const p = (v) => Math.max(0, Math.min(1, v));
  const c = 0.5 + hl * 0.5;
  gr.addColorStop(0, t.dark);
  gr.addColorStop(p(c - 0.34), t.mid);
  gr.addColorStop(p(c - 0.1), t.light);
  gr.addColorStop(p(c - 0.02), t.spec);
  gr.addColorStop(p(c + 0.05), t.light);
  gr.addColorStop(p(c + 0.26), t.mid);
  gr.addColorStop(p(0.86), t.dark);
  gr.addColorStop(0.95, t.bounce);
  gr.addColorStop(1, t.dark);
  g.fillStyle = gr;
  g.beginPath();
  if (r) { g.roundRect(x, y, w, h, r); } else g.rect(x, y, w, h);
  g.fill();
}

Object.assign(window, { LIGHT_ANGLE, LIGHT_VEC, brushedPlate, spunDisc, recordSheenMap, metalBar, smoothNoise1D });

/* Walnut wood for the record cabinet (grain runs horizontally). */
function woodTexture(w, h, seed = 3) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  const rows = smoothNoise1D(h + 2, 2, seed, 2), bands = smoothNoise1D(h + 2, 3, seed + 7, 24);
  const wave = smoothNoise1D(w + 2, 4, seed + 11, 60), r = rng(seed * 17);
  const dark = [44, 27, 17], mid = [92, 58, 36], light = [138, 92, 58];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yy = Math.min(h - 1, Math.max(0, Math.round(y + (wave[x] - 0.5) * 38)));
      let t = 0.45 * bands[yy] + 0.35 * rows[yy] + 0.2 * Math.pow(Math.abs(Math.sin(yy * 0.21 + bands[yy] * 6)), 6);
      t += (r() - 0.5) * 0.06;
      t = Math.max(0, Math.min(1, t));
      const c = t < 0.5 ? [0, 1, 2].map((i) => dark[i] + (mid[i] - dark[i]) * t * 2) : [0, 1, 2].map((i) => mid[i] + (light[i] - mid[i]) * (t - 0.5) * 2);
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // satin lacquer sheen
  const sh = g.createLinearGradient(0, 0, w, h);
  sh.addColorStop(0, 'rgba(255,220,180,0.10)'); sh.addColorStop(0.5, 'rgba(255,220,180,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.15)');
  g.fillStyle = sh; g.fillRect(0, 0, w, h);
  return cv;
}

/* Bake material textures into CSS variables for the DOM UI. */
function applyUiTextures() {
  const root = document.documentElement.style;
  const set = (k, cv, type = 'image/jpeg') => { try { root.setProperty(k, `url(${cv.toDataURL(type, 0.86)})`); } catch (e) { console.warn(e); } };
  set('--brushed', brushedPlate(900, 700, 23));
  set('--brushed-dark', (() => {
    const c = brushedPlate(600, 400, 29), g = c.getContext('2d');
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#6b6f75'; g.fillRect(0, 0, 600, 400);
    return c;
  })());
  set('--wood', woodTexture(1000, 700, 5));
  set('--wood-shelf', woodTexture(800, 60, 9));
  set('--spun-sm', spunDisc(96, { seed: 97, sharp: 5 }), 'image/png');
}
window.woodTexture = woodTexture;
window.applyUiTextures = applyUiTextures;
