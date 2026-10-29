'use strict';
const TAU = Math.PI * 2;
const RPS = (100 / 3) / 60; // 33⅓ rpm → revolutions per second
const deg = (d) => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

class Deck {
  constructor(engine, hooks) {
    this.engine = engine; this.hooks = hooks;
    this.W = 1200; this.H = 900;
    this.C = { x: 385, y: 470 }; this.R = 258;
    this.P = { x: 915, y: 165 }; this.L = 592;
    this.d = Math.hypot(this.C.x - this.P.x, this.C.y - this.P.y);
    this.angPC = Math.atan2(this.C.y - this.P.y, this.C.x - this.P.x);
    this.phiRest = this.angPC - deg(38);
    this.phiInner = this.phiForR(GEO.LOCK * 0.97);
    this.antiSkate = { x: 1030, y: 232 };
    this.cue = { x: 1018, y: 318 };

    this.power = false; this.running = false; this.rate = 0; this.pitch = 0; this.angle = 0;
    this.disk = null; this.layout = layoutDisk(null); this.tex = null; this.texLight = false;
    this.pos = 0; this.runoutRevs = 0; this.lastRev = 0;
    this.arm = { phi: this.phiRest, h: 0, mode: 'rest', auto: null };
    this.swap = null; this.recAlpha = 1; this.recScale = 1; this.recDX = 0;

    this.stage = document.getElementById('stage');
    this.bg = document.getElementById('bg');
    this.cv = document.getElementById('deck');
    this.g = this.cv.getContext('2d');
    this.platterTex = this.renderPlatter(900);
    try {
      const root = document.documentElement.style;
      root.setProperty('--spun-knob', `url(${spunDisc(160, { seed: 91, sharp: 5 }).toDataURL()})`);
      root.setProperty('--spun-btn', `url(${spunDisc(160, { seed: 93, sharp: 6, lo: [140, 144, 150], hi: [250, 251, 252] }).toDataURL()})`);
      root.setProperty('--spun-ring', `url(${spunDisc(200, { seed: 95, sharp: 8, lo: [110, 114, 120] }).toDataURL()})`);
    } catch (e) { console.warn(e); }

    this.bindControls();
    this.resize();
    window.addEventListener('resize', () => { clearTimeout(this._rz); this._rz = setTimeout(() => this.resize(), 60); });
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------- geometry ---------- */
  phiForR(rn) {
    const r = rn * this.R, L = this.L, d = this.d;
    const c = clamp((L * L + d * d - r * r) / (2 * L * d), -1, 1);
    return this.angPC - Math.acos(c);
  }
  rForPhi(phi) {
    const th = this.angPC - phi, L = this.L, d = this.d;
    return Math.sqrt(Math.max(0, L * L + d * d - 2 * L * d * Math.cos(th))) / this.R;
  }
  tip(phi) { return { x: this.P.x + Math.cos(phi) * this.L, y: this.P.y + Math.sin(phi) * this.L }; }
  toStage(e) {
    const r = this.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  /* ---------- layout ---------- */
  resize() {
    const wrap = document.getElementById('stageWrap');
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.scale = Math.min(w / this.W, h / this.H);
    this.stage.style.transform = `translate(${(w - this.W * this.scale) / 2}px, ${(h - this.H * this.scale) / 2}px) scale(${this.scale})`;
    this.dpr = window.devicePixelRatio || 1;
    const k = this.scale * this.dpr;
    this.cv.width = Math.round(this.W * k); this.cv.height = Math.round(this.H * k);
    this.bg.width = Math.round(w * this.dpr); this.bg.height = Math.round(h * this.dpr);
    this.k = k;
    this.off = { x: (w - this.W * this.scale) / 2, y: (h - this.H * this.scale) / 2, w, h };
    this.drawBackground();
  }

  /* ---------- materials cache ---------- */
  spun(r, seed = 5, opt = {}) {
    const px = Math.max(8, Math.round(r * 2 * this.k));
    const key = px + ':' + seed + ':' + JSON.stringify(opt);
    this._spun = this._spun || new Map();
    if (!this._spun.has(key)) this._spun.set(key, spunDisc(px, Object.assign({ seed }, opt)));
    return this._spun.get(key);
  }
  drawSpun(g, x, y, r, seed, opt) { g.drawImage(this.spun(r, seed, opt), x - r, y - r, r * 2, r * 2); }
  /* bevel: bright on the light side, dark on the far side */
  bevel(g, x, y, r, w, strength = 1, inset = false) {
    const lx = LIGHT_VEC.x * r, ly = LIGHT_VEC.y * r;
    const gr = g.createLinearGradient(x + lx, y + ly, x - lx, y - ly);
    const a = inset ? 'rgba(0,0,0,' : 'rgba(255,255,255,', b = inset ? 'rgba(255,255,255,' : 'rgba(0,0,0,';
    gr.addColorStop(0, a + 0.85 * strength + ')'); gr.addColorStop(0.5, 'rgba(128,128,128,0)'); gr.addColorStop(1, b + 0.45 * strength + ')');
    g.beginPath(); g.arc(x, y, r - w / 2, 0, TAU); g.strokeStyle = gr; g.lineWidth = w; g.stroke();
  }
  /* layered soft shadow cast to the lower right; height in stage px */
  castShadow(g, height, pathFn, darkness = 1, layers = null) {
    const k = this.k, L = layers || [
      { b: 1.5 + height * 0.1, o: height * 0.1, a: 0.45 },
      { b: height * 0.45, o: height * 0.4, a: 0.3 },
      { b: height * 1.2, o: height * 0.95, a: 0.24 }
    ];
    for (const s of L) {
      g.save();
      g.shadowColor = `rgba(10,12,16,${s.a * darkness})`;
      g.shadowBlur = s.b * k;
      g.shadowOffsetX = s.o * -LIGHT_VEC.x * k;
      g.shadowOffsetY = s.o * -LIGHT_VEC.y * k;
      g.fillStyle = '#a3a7ac'; // hidden under the object drawn on top
      g.beginPath(); pathFn(g); g.fill();
      g.restore();
    }
  }

  drawBackground() {
    const g = this.bg.getContext('2d');
    const o = this.off, sc = this.scale, dpr = this.dpr;
    const key = this.bg.width + 'x' + this.bg.height;
    if (this._plateKey !== key) { this._plate = brushedPlate(this.bg.width, this.bg.height); this._plateKey = key; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this._plate, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = o.w, H = o.h;
    const vg = g.createRadialGradient(W * 0.35, H * 0.3, Math.min(W, H) * 0.3, W * 0.5, H * 0.5, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.setTransform(sc * dpr, 0, 0, sc * dpr, o.x * dpr, o.y * dpr);

    // debossed brand
    g.save();
    g.textAlign = 'center';
    g.font = '800 23px "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText('V I N Y', 600, 81.2);
    g.fillStyle = 'rgba(40,42,46,0.55)'; g.fillText('V I N Y', 600, 80);
    g.font = '600 9px "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('QUARTZ DIRECT DRIVE  ·  33⅓', 600, 97);
    g.fillStyle = 'rgba(40,42,46,0.5)'; g.fillText('QUARTZ DIRECT DRIVE  ·  33⅓', 600, 96);
    g.restore();

    // ---- tonearm base ----
    const C = this.C, P = this.P;
    this.castShadow(g, 16, (gg) => gg.arc(P.x, P.y, 82, 0, TAU), 1.3);
    this.drawSpun(g, P.x, P.y, 82, 3, { lo: [120, 124, 130], hi: [240, 242, 245] });
    this.bevel(g, P.x, P.y, 82, 3, 1);
    // stepped inner ring (a machined groove)
    g.beginPath(); g.arc(P.x, P.y, 63, 0, TAU); g.strokeStyle = 'rgba(0,0,0,0.30)'; g.lineWidth = 2.2; g.stroke();
    this.bevel(g, P.x, P.y, 62, 1.5, 0.8, true);
    // raised collar
    this.castShadow(g, 5, (gg) => gg.arc(P.x, P.y, 48, 0, TAU));
    this.drawSpun(g, P.x, P.y, 48, 8, { lo: [140, 144, 150], hi: [250, 251, 252], sharp: 7 });
    this.bevel(g, P.x, P.y, 48, 2, 1);
    // height adjust screw + scale engraving
    const sx = P.x - 56, sy = P.y + 34;
    this.castShadow(g, 2, (gg) => gg.arc(sx, sy, 9, 0, TAU));
    this.drawSpun(g, sx, sy, 9, 21);
    this.bevel(g, sx, sy, 9, 1.2, 1);
    g.save(); g.translate(sx, sy); g.rotate(0.6);
    g.fillStyle = 'rgba(20,20,22,0.7)'; g.fillRect(-6, -1, 12, 2); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(-6, 1, 12, 0.7);
    g.restore();
    g.save(); g.strokeStyle = 'rgba(30,32,36,0.45)'; g.lineWidth = 0.8;
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * 0.55 + i * 0.07, r0 = 70, r1 = i % 4 ? 74 : 77;
      g.beginPath(); g.moveTo(P.x + Math.cos(a) * r0, P.y + Math.sin(a) * r0); g.lineTo(P.x + Math.cos(a) * r1, P.y + Math.sin(a) * r1); g.stroke();
    }
    g.restore();

    // ---- anti-skating dial ----
    const A = this.antiSkate;
    this.castShadow(g, 6, (gg) => gg.arc(A.x, A.y, 17, 0, TAU));
    this.drawSpun(g, A.x, A.y, 17, 31, { sharp: 6 });
    this.bevel(g, A.x, A.y, 17, 1.6, 1);
    g.save(); g.translate(A.x, A.y);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.7;
    for (let i = 0; i < 40; i++) { const a = i / 40 * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 15, Math.sin(a) * 15); g.lineTo(Math.cos(a) * 17, Math.sin(a) * 17); g.stroke(); }
    g.rotate(-0.9); g.fillStyle = '#d33b2c'; g.fillRect(-1, -14, 2, 7);
    g.restore();
    g.save(); g.font = '700 7px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('ANTI-SKATING', A.x, A.y + 31);
    g.fillStyle = 'rgba(40,42,46,0.6)'; g.fillText('ANTI-SKATING', A.x, A.y + 30);
    g.restore();

    // ---- cue lever housing ----
    const Q = this.cue;
    this.castShadow(g, 7, (gg) => gg.roundRect(Q.x - 15, Q.y - 22, 30, 44, 8));
    const hg = g.createLinearGradient(Q.x - 15, 0, Q.x + 15, 0);
    hg.addColorStop(0, '#f3f4f6'); hg.addColorStop(0.35, '#cfd2d6'); hg.addColorStop(0.7, '#a2a6ab'); hg.addColorStop(1, '#7d8186');
    g.fillStyle = hg; g.beginPath(); g.roundRect(Q.x - 15, Q.y - 22, 30, 44, 8); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8; g.beginPath(); g.roundRect(Q.x - 14.5, Q.y - 21.5, 29, 43, 7.5); g.stroke();
    g.save(); g.font = '700 7px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('▲ CUE', Q.x, Q.y + 35);
    g.fillStyle = 'rgba(40,42,46,0.6)'; g.fillText('▲ CUE', Q.x, Q.y + 34);
    g.restore();

    // ---- arm rest post ----
    const q = { x: P.x + Math.cos(this.phiRest) * 360, y: P.y + Math.sin(this.phiRest) * 360 };
    this.restPost = q;
    this.castShadow(g, 9, (gg) => gg.arc(q.x, q.y, 15, 0, TAU));
    this.drawSpun(g, q.x, q.y, 15, 13);
    this.bevel(g, q.x, q.y, 15, 1.5, 1);
    g.save(); g.translate(q.x, q.y); g.rotate(this.phiRest);
    const cg = g.createLinearGradient(-7, 0, 7, 0);
    cg.addColorStop(0, '#111'); cg.addColorStop(0.4, '#3a3b3f'); cg.addColorStop(1, '#0c0c0d');
    g.fillStyle = cg; g.beginPath(); g.roundRect(-7, -13, 14, 26, 5); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.roundRect(-3, -11, 6, 22, 3); g.fill();
    g.restore();

    // ---- platter (static spun rim drawn here) ----
    this.castShadow(g, 34, (gg) => gg.arc(C.x, C.y, this.R + 5, 0, TAU), 1.5);
    this.drawSpun(g, C.x, C.y, this.R + 5, 17, { lo: [118, 122, 128], hi: [244, 245, 247], sharp: 8 });
  }

  renderPlatter(size) {
    // rotating part: strobe dots on the rim + rubber mat
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'), R = size / 2; g.translate(R, R);
    for (let i = 0; i < 180; i++) {
      const a = i / 180 * TAU;
      g.save(); g.rotate(a);
      g.fillStyle = i % 2 ? 'rgba(40,42,46,0.55)' : 'rgba(255,255,255,0.35)';
      g.fillRect(R * 0.968, -R * 0.0075, R * 0.026, R * 0.015);
      g.restore();
    }
    // mat
    g.beginPath(); g.arc(0, 0, R * 0.958, 0, TAU); g.fillStyle = '#18191b'; g.fill();
    for (let r = R * 0.95; r > R * 0.1; r -= R * 0.017) {
      g.beginPath(); g.arc(0, 0, r, 0, TAU);
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = R * 0.005; g.stroke();
      g.beginPath(); g.arc(0, 0, r - R * 0.005, 0, TAU);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = R * 0.003; g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.font = `700 ${Math.round(R * 0.07)}px "Segoe UI", sans-serif`; g.textAlign = 'center';
    g.fillText('V I N Y', 0, -R * 0.62);
    g.font = `600 ${Math.round(R * 0.035)}px "Segoe UI", sans-serif`;
    g.fillText('33⅓', 0, R * 0.68);
    return cv;
  }

  /* ---------- controls ---------- */
  bindControls() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      power: $('power'), knob: $('knob'), start: $('startBtn'), fader: $('fader'), slot: $('slot'),
      led: $('pitchLed'), lcdTitle: $('lcdTitle'), lcdTime: $('lcdTime'), lcdBar: $('lcdBar'), lcdIdx: $('lcdIdx'),
      pitchVal: $('pitchVal')
    };
    this.el.power.addEventListener('click', () => this.setPower(!this.power));
    this.el.start.addEventListener('click', () => this.startStop());

    // pitch fader
    let dragging = false, startY = 0, startV = 0;
    const slotH = 360; // travel in stage px
    const setV = (v) => {
      v = clamp(v, -1, 1);
      if (Math.abs(v) < 0.035) v = 0; // centre detent
      this.pitchV = v; this.pitch = -v * 0.08; // up = +
      this.el.fader.style.transform = `translateY(${v * slotH / 2}px)`;
      this.el.led.classList.toggle('on', v === 0);
      this.el.pitchVal.textContent = (this.pitch >= 0 ? '+' : '') + (this.pitch * 100).toFixed(1) + '%';
      this.hooks.onPitch && this.hooks.onPitch(v);
    };
    this.setPitchV = setV;
    this.el.fader.addEventListener('pointerdown', (e) => {
      dragging = true; startY = this.toStage(e).y; startV = this.pitchV || 0;
      this.el.fader.setPointerCapture(e.pointerId); e.stopPropagation();
    });
    this.el.fader.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      setV(startV + (this.toStage(e).y - startY) / (slotH / 2));
    });
    this.el.fader.addEventListener('pointerup', () => { dragging = false; });
    this.el.fader.addEventListener('dblclick', () => setV(0));
    this.el.slot.addEventListener('wheel', (e) => { e.preventDefault(); setV((this.pitchV || 0) + Math.sign(e.deltaY) * 0.025); }, { passive: false });
    setV(0);

    // record / arm pointer handling
    let down = null;
    this.cv.addEventListener('pointerdown', (e) => {
      this.engine.resume();
      const p = this.toStage(e);
      if (this.hitCue(p)) { this.engine.uiClick('toggle'); this.toggleCue(); return; }
      if (this.hitArm(p)) {
        down = { type: 'arm', p, dphi: this.arm.phi - Math.atan2(p.y - this.P.y, p.x - this.P.x) };
        this.grabArm();
        this.cv.setPointerCapture(e.pointerId);
        this.cv.style.cursor = 'grabbing';
        return;
      }
      if (Math.hypot(p.x - this.C.x, p.y - this.C.y) < this.R) down = { type: 'record', p, t: performance.now() };
    });
    this.cv.addEventListener('pointermove', (e) => {
      const p = this.toStage(e);
      if (down && down.type === 'arm') {
        const phi = Math.atan2(p.y - this.P.y, p.x - this.P.x) + down.dphi;
        this.arm.phi = clamp(phi, this.phiRest, this.phiInner);
        return;
      }
      const overArm = this.hitArm(p) || this.hitCue(p), overRec = Math.hypot(p.x - this.C.x, p.y - this.C.y) < this.R;
      this.cv.style.cursor = overArm ? 'grab' : overRec ? 'pointer' : 'default';
    });
    const up = (e) => {
      if (!down) return;
      const p = this.toStage(e);
      if (down.type === 'arm') { this.releaseArm(); this.cv.style.cursor = 'grab'; }
      else if (down.type === 'record' && Math.hypot(p.x - down.p.x, p.y - down.p.y) < 6) this.hooks.openShelf();
      down = null;
    };
    this.cv.addEventListener('pointerup', up);
    this.cv.addEventListener('pointercancel', up);
  }

  hitCue(p) {
    const Q = this.cue;
    if (Math.abs(p.x - Q.x) < 16 && Math.abs(p.y - Q.y) < 23) return true;
    const ang = Math.PI + 0.35 - (this.cueA || 0) * 0.7;
    const kx = Q.x + Math.cos(ang) * 46, ky = Q.y - 6 + Math.sin(ang) * 46;
    return Math.hypot(p.x - kx, p.y - ky) < 14;
  }
  hitArm(p) {
    const phi = this.arm.phi, P = this.P;
    const ux = Math.cos(phi), uy = Math.sin(phi);
    const dx = p.x - P.x, dy = p.y - P.y;
    const along = dx * ux + dy * uy, perp = Math.abs(-dx * uy + dy * ux);
    if (along > this.L * 0.3 && along < this.L + 25 && perp < 26) return true;
    const t = this.tip(phi);
    return Math.hypot(p.x - t.x, p.y - t.y) < 34;
  }

  setPower(on) {
    this.engine.resume();
    this.power = on;
    this.el.power.classList.toggle('on', on);
    document.getElementById('startBtn').classList.toggle('lit', on);
    if (!on) this.running = false;
    this.hooks.onState && this.hooks.onState();
  }

  startStop() {
    this.engine.resume();
    if (!this.power) this.setPower(true);
    this.el.start.classList.add('press'); setTimeout(() => this.el.start.classList.remove('press'), 140);
    this.running = !this.running;
    // semi-automatic: starting with the arm on its rest cues the lead-in
    if (this.running && this.disk && this.arm.mode === 'rest') this.cueTo(0);
    this.hooks.onState && this.hooks.onState();
  }

  /* ---------- arm state machine ---------- */
  grabArm() {
    if (this.arm.mode === 'down') this.engine.needleUp();
    this.arm.mode = 'drag'; this.arm.auto = null;
  }
  releaseArm() {
    if (Math.abs(this.arm.phi - this.phiRest) < deg(2.5)) { this.arm.auto = { phi: this.phiRest, then: 'rest' }; this.arm.mode = 'auto'; }
    else { this.arm.mode = 'lowering'; this.arm.targetPos = null; }
  }
  cueTo(pos) {
    if (this.arm.mode === 'down') this.engine.needleUp();
    const rn = radiusAt(this.layout, pos);
    this.arm.auto = { phi: this.phiForR(rn), then: 'lower', pos };
    this.arm.mode = 'auto';
  }
  returnToRest() {
    if (this.arm.mode === 'down') this.engine.needleUp();
    this.arm.auto = { phi: this.phiRest, then: 'rest' };
    this.arm.mode = 'auto';
  }
  toggleCue() {
    if (this.arm.mode === 'down') { this.engine.needleUp(); this.arm.mode = 'hover'; }
    else if (this.arm.mode === 'hover') { this.arm.mode = 'lowering'; this.arm.targetPos = null; }
    else if (this.arm.mode === 'parked') { this.arm.mode = 'hover'; }
  }
  currentTrack() {
    if (this.arm.mode !== 'down' || !this.disk) return -1;
    const s = segAt(this.layout, this.pos);
    return s.idx;
  }
  skip(dir) {
    if (!this.disk || !this.disk.tracks.length) return;
    const n = this.disk.tracks.length;
    let idx;
    if (this.arm.mode === 'down') {
      const s = segAt(this.layout, this.pos);
      if (s.kind === 'leadin') idx = dir > 0 ? 0 : 0;
      else if (s.kind === 'runout') idx = dir > 0 ? n : n - 1;
      else if (s.kind === 'gap') idx = dir > 0 ? s.idx + 1 : s.idx;
      else idx = dir > 0 ? s.idx + 1 : (s.local > 3 ? s.idx : s.idx - 1);
    } else idx = dir > 0 ? 0 : n - 1;
    if (idx >= n) { this.returnToRest(); return; }
    this.playTrack(Math.max(0, idx));
  }
  playTrack(idx) {
    if (!this.power) this.setPower(true);
    this.running = true;
    const pos = idx <= 0 ? 0 : Math.max(0, trackStartPos(this.layout, idx) - 1.2);
    this.engine.prefetch(Math.max(0, idx));
    this.cueTo(pos);
    this.hooks.onState && this.hooks.onState();
  }

  updateArm(dt) {
    const a = this.arm;
    const approach = (v, t, speed) => (Math.abs(t - v) <= speed * dt ? t : v + Math.sign(t - v) * speed * dt);
    switch (a.mode) {
      case 'rest':
        a.h = approach(a.h, 0, 3); a.phi = this.phiRest; break;
      case 'drag':
      case 'hover':
        a.h = approach(a.h, 1, 4); break;
      case 'auto': {
        a.h = approach(a.h, 1, 3.5);
        if (a.h > 0.85) {
          const diff = a.auto.phi - a.phi;
          const sp = Math.max(0.05, Math.min(0.75, Math.abs(diff) * 4));
          a.phi = approach(a.phi, a.auto.phi, sp);
          if (Math.abs(a.auto.phi - a.phi) < 1e-4) {
            if (a.auto.then === 'rest') { a.mode = 'rest'; }
            else { a.mode = 'lowering'; a.targetPos = a.auto.pos; }
            a.auto = null;
          }
        }
        break;
      }
      case 'lowering':
        a.h = approach(a.h, 0, 1.6);
        if (a.h <= 0) this.landNeedle();
        break;
      case 'down': {
        const rn = radiusAt(this.layout, this.pos);
        a.phi = this.phiForR(rn) + Math.sin(this.angle) * 0.0012; // eccentricity wobble
        a.h = 0;
        break;
      }
      case 'parked': a.h = 0; break;
    }
  }
  landNeedle() {
    const a = this.arm, rn = this.rForPhi(a.phi);
    if (this.disk && rn <= GEO.EDGE && rn >= GEO.LOCK * 0.9 && this.recAlpha > 0.9) {
      this.pos = a.targetPos != null ? a.targetPos : posAtRadius(this.layout, rn);
      if (rn < GEO.GROOVE_IN) this.pos = this.layout.total + 0.01;
      a.targetPos = null;
      this.runoutRevs = 0;
      this.engine.seek();
      this.engine.needleDown();
      a.mode = 'down';
    } else if (Math.abs(a.phi - this.phiRest) < deg(3)) a.mode = 'rest';
    else { a.mode = 'parked'; this.engine.liftSound(); }
  }

  /* ---------- disk management ---------- */
  async setDisk(disk, opts = {}) {
    const go = async () => {
      if (this.arm.mode !== 'rest' && this.arm.mode !== 'auto') this.returnToRest();
      this.swap = { phase: 'out', t: 0, next: disk, opts };
      if (!this.disk) { this.swap.phase = 'load'; this.swap.t = 0; }
    };
    await go();
  }
  async loadTexture(disk) {
    if (!disk) { this.tex = null; this.sheen = null; return; }
    const img = disk.labelImage ? await loadImage(window.viny.mediaUrl(disk.id, disk.labelImage)) : null;
    this.tex = renderRecordTexture(disk, 1400, { label: img });
    this.sheen = recordSheenMap(760, disk);
    this.texLight = (VINYL_COLORS[disk.vinylColor] || VINYL_COLORS.black).light;
  }
  async refreshDisk(disk) {
    if (!this.disk || disk.id !== this.disk.id) return;
    this.disk = disk;
    const was = this.layout.total;
    this.layout = layoutDisk(disk);
    this.engine.disk = disk;
    if (this.arm.mode === 'down' && this.layout.total !== was) { this.engine.seek(); }
    await this.loadTexture(disk);
  }
  updateSwap(dt) {
    const s = this.swap; if (!s) return;
    s.t += dt;
    if (s.phase === 'out') {
      const k = Math.min(1, s.t / 0.38);
      this.recAlpha = 1 - k; this.recScale = 1 - 0.06 * k; this.recDX = -40 * k;
      if (k >= 1) { s.phase = 'load'; s.t = 0; }
    } else if (s.phase === 'load') {
      s.phase = 'loading';
      this.engine.setDisk(s.next);
      this.disk = s.next; this.layout = layoutDisk(s.next); this.pos = 0;
      this.loadTexture(s.next).then(() => { s.phase = 'in'; s.t = 0; });
      this.hooks.onDisk && this.hooks.onDisk(s.next);
    } else if (s.phase === 'in') {
      const k = Math.min(1, s.t / 0.42), e = 1 - Math.pow(1 - k, 3);
      this.recAlpha = e; this.recScale = 1.05 - 0.05 * e; this.recDX = 0;
      if (k >= 1) {
        this.recAlpha = 1; this.recScale = 1; this.swap = null;
        if (s.opts.play && this.disk) this.playTrack(s.opts.track || 0);
      }
    } else if (s.phase === 'loading' && !s.next) { /* removing */ }
    if (!this.disk && s.phase === 'in') { this.recAlpha = 0; }
  }

  /* ---------- main loop ---------- */
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    // motor
    const target = this.power && this.running ? 1 + this.pitch : 0;
    if (target > 0) this.rate += (target - this.rate) * (1 - Math.exp(-dt / 0.28));
    else if (this.power) this.rate = Math.max(0, this.rate - dt * 0.9);          // electronic brake
    else this.rate = Math.max(0, this.rate * Math.exp(-dt / 2.2) - dt * 0.05);    // coasting
    const prevAngle = this.angle;
    this.angle += this.rate * RPS * TAU * dt;

    this.updateSwap(dt);
    this.updateArm(dt);

    let seg = null;
    if (this.arm.mode === 'down') {
      this.pos += dt * this.rate;
      seg = segAt(this.layout, this.pos);
      if (seg.kind === 'runout') {
        const revs = Math.floor(this.angle / TAU), prevRevs = Math.floor(prevAngle / TAU);
        if (revs !== prevRevs) {
          this.engine.lockedClick();
          this.runoutRevs++;
          if (this.runoutRevs >= 4) { this.returnToRest(); this.running = false; this.hooks.onState && this.hooks.onState(); }
        }
      }
    }
    this.engine.update(this.rate, seg);
    this.draw();
    this.updateLcd(seg);
    requestAnimationFrame((t) => this.frame(t));
  }

  updateLcd(seg) {
    const el = this.el;
    let title = '', time = '', idx = '', prog = 0;
    if (!this.disk) { title = 'Нет пластинки - нажмите на диск'; idx = '--'; }
    else if (!seg) {
      title = (this.disk.title || 'Без названия') + (this.disk.artist ? ' - ' + this.disk.artist : '');
      idx = String(this.disk.tracks.length).padStart(2, '0');
      time = this.power ? (this.running ? 'опустите иглу' : 'готов') : 'питание выкл.';
    } else if (seg.kind === 'track') {
      const tr = this.disk.tracks[seg.idx];
      title = tr.title || 'Трек ' + (seg.idx + 1);
      idx = String(seg.idx + 1).padStart(2, '0');
      time = fmtTime(seg.local) + ' / ' + fmtTime(tr.duration);
      prog = seg.local / (tr.duration || 1);
    } else if (seg.kind === 'runout') { title = 'Конец стороны'; idx = '··'; }
    else { title = seg.kind === 'leadin' ? 'Вводная канавка…' : 'Пауза'; idx = '··'; }
    if (el.lcdTitle.textContent !== title) el.lcdTitle.textContent = title;
    if (el.lcdTime.textContent !== time) el.lcdTime.textContent = time;
    if (el.lcdIdx.textContent !== idx) el.lcdIdx.textContent = idx;
    el.lcdBar.style.transform = `scaleX(${clamp(prog, 0, 1)})`;
  }

  draw() {
    const g = this.g, C = this.C, R = this.R;
    g.setTransform(this.k, 0, 0, this.k, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    // rotating platter layer (static spun rim is on the background canvas)
    g.save(); g.translate(C.x, C.y); g.rotate(this.angle);
    g.drawImage(this.platterTex, -R - 5, -R - 5, (R + 5) * 2, (R + 5) * 2);
    g.restore();
    this.bevel(g, C.x, C.y, R + 5, 2.5, 1);
    // inner edge of the rim where the mat sits
    g.beginPath(); g.arc(C.x, C.y, (R + 5) * 0.958, 0, TAU); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.2; g.stroke();

    if (!this.disk && !this.swap) {
      g.save(); g.fillStyle = 'rgba(255,255,255,0.32)'; g.font = '500 15px "Segoe UI", sans-serif'; g.textAlign = 'center';
      g.fillText('Нажмите, чтобы открыть витрину дисков', C.x, C.y + 40); g.restore();
    }

    // record
    if (this.tex && this.recAlpha > 0.001) {
      const r = R * this.recScale, cx = C.x + this.recDX, cy = C.y;
      g.save();
      g.globalAlpha = this.recAlpha;
      // the record lies on the mat: tight contact shadow
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = 5 * this.k;
      g.shadowOffsetX = 1.5 * this.k; g.shadowOffsetY = 2.5 * this.k;
      g.beginPath(); g.arc(cx, cy, r * 0.997, 0, TAU); g.fillStyle = '#000'; g.fill();
      g.restore();
      g.save(); g.translate(cx, cy); g.rotate(this.angle);
      g.drawImage(this.tex, -r, -r, r * 2, r * 2);
      g.restore();
      // static reflections
      if (this.sheen) g.drawImage(this.sheen, cx - r, cy - r, r * 2, r * 2);
      drawLabelLight(g, cx, cy, r * GEO.LABEL);
      // edge: polished rim catches light on one side
      this.bevel(g, cx, cy, r, 1.6, this.texLight ? 0.5 : 0.9);
      g.restore();
    }

    // spindle
    g.save();
    this.castShadow(g, 4, (gg) => gg.arc(C.x, C.y, 7.5, 0, TAU), 0.9);
    this.drawSpun(g, C.x, C.y, 7.5, 41, { sharp: 4 });
    this.bevel(g, C.x, C.y, 7.5, 1.2, 1.2);
    const sp = g.createRadialGradient(C.x - 2.5, C.y - 2.5, 0, C.x - 2.5, C.y - 2.5, 4);
    sp.addColorStop(0, 'rgba(255,255,255,0.95)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp; g.beginPath(); g.arc(C.x, C.y, 7, 0, TAU); g.fill();
    g.restore();

    this.drawCue(g);
    this.drawArm(g);
  }

  drawCue(g) {
    const Q = this.cue, up = this.arm.mode === 'hover' || this.arm.mode === 'drag' || this.arm.mode === 'auto';
    this.cueA = this.cueA == null ? 0 : this.cueA + ((up ? 1 : 0) - this.cueA) * 0.25;
    const ang = Math.PI + 0.35 - this.cueA * 0.7;
    g.save(); g.translate(Q.x, Q.y - 6);
    const len = 46;
    this.castShadow(g, 6 + this.cueA * 4, (gg) => { gg.save(); gg.rotate(ang); gg.roundRect(0, -4, len, 8, 4); gg.arc(len, 0, 8, 0, TAU); gg.restore(); }, 0.9);
    g.rotate(ang);
    metalBar(g, 0, -4, len, 8, 4, Math.sin(ang - LIGHT_ANGLE) * -0.5);
    g.translate(len, 0);
    const kg = g.createRadialGradient(-2, -3, 0, 0, 0, 8);
    kg.addColorStop(0, '#5c5e63'); kg.addColorStop(0.5, '#1d1e21'); kg.addColorStop(1, '#050506');
    g.fillStyle = kg; g.beginPath(); g.arc(0, 0, 8, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-2.5, -3, 3, 1.6, -0.6, 0, TAU); g.fill();
    g.restore();
    // pivot screw
    this.drawSpun(g, Q.x, Q.y - 6, 5, 51); this.bevel(g, Q.x, Q.y - 6, 5, 1, 1);
  }

  drawArm(g) {
    const a = this.arm, P = this.P, L = this.L, phi = a.phi, h = a.h;
    const HS = 104, HA = deg(22);
    // the stylus tip sits exactly at the arm's effective length (shell-local x = HS)
    const K = { x: L - Math.cos(HA) * HS, y: -Math.sin(HA) * HS };
    const tubeA = Math.atan2(K.y, K.x), tubeL = Math.hypot(K.x, K.y);

    const silhouette = (gg) => {
      gg.translate(P.x, P.y); gg.rotate(phi);
      gg.rect(-48, -7, 48, 14);
      gg.roundRect(-150, -25, 104, 50, 8);
      gg.save(); gg.rotate(tubeA); gg.rect(0, -6.5, tubeL + 4, 13); gg.restore();
      gg.save(); gg.translate(K.x, K.y); gg.rotate(HA);
      gg.moveTo(-4, -10); gg.lineTo(HS + 4, -16); gg.lineTo(HS + 7, 16); gg.lineTo(-4, 10); gg.closePath();
      gg.moveTo(HS - 10, 9); gg.lineTo(HS + 14, 38); gg.lineTo(HS + 10, 40); gg.lineTo(HS - 14, 12); gg.closePath();
      gg.restore();
    };
    // the arm floats ~22px above the deck; lifting raises it further
    this.castShadow(g, 0, silhouette, 1, [
      { b: 2, o: 3, a: 0.4 },
      { b: 3 + h * 6, o: 14 + h * 18, a: 0.6 - h * 0.18 },
      { b: 10 + h * 12, o: 22 + h * 26, a: 0.3 - h * 0.08 }
    ]);

    // highlight position across a bar depends on its angle to the light
    const hlFor = (ang) => { const nx = -Math.sin(ang), ny = Math.cos(ang); return clamp((nx * LIGHT_VEC.x + ny * LIGHT_VEC.y) * 0.55, -0.6, 0.6); };
    const lift = 1 + h * 0.014;
    g.save();
    g.translate(P.x, P.y); g.rotate(phi); g.scale(lift, lift);

    // rear stub + counterweight
    metalBar(g, -50, -7, 50, 14, 0, hlFor(phi));
    const cwHl = hlFor(phi);
    metalBar(g, -150, -25, 104, 50, 8, cwHl);
    // knurled grip band
    g.save(); g.beginPath(); g.rect(-142, -25, 22, 50); g.clip();
    for (let x = -142; x < -120; x += 1.6) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, -25, 0.7, 50); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 0.8, -25, 0.5, 50); }
    g.restore();
    // machined grooves + engraved scale ring
    for (const x of [-118, -86, -52]) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(x, -25, 1.6, 50); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 1.6, -25, 0.8, 50); }
    g.save(); g.beginPath(); g.rect(-84, -25, 30, 50); g.clip();
    g.fillStyle = 'rgba(25,27,30,0.7)';
    for (let i = 0; i <= 10; i++) g.fillRect(-82 + i * 2.6, -25, 0.6, i % 5 ? 7 : 11);
    g.font = '700 6px "Segoe UI", sans-serif'; g.fillText('0  1  2', -82, 18);
    g.restore();
    // end cap
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.roundRect(-154, -21, 8, 42, 3); g.fill();
    metalBar(g, -153, -19, 4, 38, 2, cwHl, { dark: '#3d4045', mid: '#8a8e93', light: '#c9ccd0', spec: '#e8eaec', bounce: '#7d8186' });

    // tube
    g.save(); g.rotate(tubeA);
    metalBar(g, 0, -6.5, tubeL + 4, 13, 6.5, hlFor(phi + tubeA));
    g.restore();

    // headshell
    g.save(); g.translate(K.x, K.y); g.rotate(HA);
    const hsHl = hlFor(phi + HA);
    metalBar(g, -8, -9.5, 20, 19, 3, hsHl, { dark: '#2b2d31', mid: '#6f7378', light: '#b9bcc0', spec: '#e6e8ea', bounce: '#5d6166' }); // collar
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(4, -9.5, 1, 19);
    // finger lift (under the shell edge)
    g.save(); g.translate(HS - 12, 10); g.rotate(Math.atan2(28, 24));
    metalBar(g, 0, -2.2, 38, 4.4, 2.2, hlFor(phi + HA + Math.atan2(28, 24)));
    g.restore();
    // shell body
    g.beginPath(); g.moveTo(10, -11); g.lineTo(HS + 4, -16); g.lineTo(HS + 7, 16); g.lineTo(10, 11); g.closePath();
    const hg = g.createLinearGradient(0, -16, 0, 16), c = 0.5 + hsHl * 0.5;
    hg.addColorStop(0, '#6a6e73'); hg.addColorStop(clamp(c - 0.25, 0, 1), '#d5d8db'); hg.addColorStop(clamp(c, 0, 1), '#fbfbfc');
    hg.addColorStop(clamp(c + 0.2, 0, 1), '#b5b8bc'); hg.addColorStop(1, '#55585d');
    g.fillStyle = hg; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.8; g.stroke();
    // brushed lines along the shell
    g.save(); g.clip();
    for (let y = -16; y < 16; y += 1.2) { g.fillStyle = `rgba(${y % 2 ? '255,255,255' : '0,0,0'},0.06)`; g.fillRect(10, y, HS, 0.5); }
    g.restore();
    // cartridge (glossy black)
    const cg = g.createLinearGradient(0, -11, 0, 11);
    cg.addColorStop(0, '#3b3d42'); cg.addColorStop(0.3, '#16171a'); cg.addColorStop(1, '#050506');
    g.fillStyle = cg; g.beginPath(); g.roundRect(HS - 44, -11, 46, 22, 2.5); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.roundRect(HS - 42, -9.5, 42, 3, 1.5); g.fill();
    g.fillStyle = '#d6b25a'; g.font = '700 5.5px "Segoe UI", sans-serif'; g.fillText('VINY', HS - 37, 3);
    // stylus guard tip
    // stylus: cantilever + diamond tip right at the contact point
    g.fillStyle = '#c9a548'; g.fillRect(HS - 3, -1, 3, 2);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(HS, 0, 1.1, 0, TAU); g.fill();
    // mounting screws
    for (const x of [HS - 34, HS - 10]) { this.drawSpun(g, x, 0, 2.8, 61); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x - 2, -0.4, 4, 0.8); }
    g.restore();
    g.restore();

    // gimbal: static spun disc (highlight doesn't rotate) + rotating yoke
    this.castShadow(g, 8, (gg) => gg.arc(P.x, P.y, 30, 0, TAU));
    this.drawSpun(g, P.x, P.y, 30, 71, { sharp: 6 });
    this.bevel(g, P.x, P.y, 30, 2, 1);
    g.save(); g.translate(P.x, P.y); g.rotate(phi);
    this.castShadow(g, 5, (gg) => gg.roundRect(-15, -10, 30, 20, 4), 0.8);
    metalBar(g, -15, -10, 30, 20, 4, hlFor(phi), { dark: '#0d0e10', mid: '#2a2c30', light: '#4b4e54', spec: '#7d8188', bounce: '#24262a' });
    g.restore();
    this.drawSpun(g, P.x, P.y, 6.5, 81); this.bevel(g, P.x, P.y, 6.5, 1, 1.2);
  }
}

/* soft matte light over the paper label (static) */
function drawLabelLight(g, cx, cy, lr) {
  g.save();
  g.beginPath(); g.arc(cx, cy, lr, 0, TAU); g.clip();
  const lg = g.createLinearGradient(cx + LIGHT_VEC.x * lr, cy + LIGHT_VEC.y * lr, cx - LIGHT_VEC.x * lr, cy - LIGHT_VEC.y * lr);
  lg.addColorStop(0, 'rgba(255,255,255,0.13)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = lg; g.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);
  g.restore();
}

/* ---------- drawing helpers ---------- */
function metalDisc(g, x, y, r, hi, lo) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  gr.addColorStop(0, hi); gr.addColorStop(1, lo);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = gr; g.fill();
  if (r > 20) {
    const cg = g.createConicGradient(0, x, y);
    cg.addColorStop(0, 'rgba(255,255,255,0.0)'); cg.addColorStop(0.12, 'rgba(255,255,255,0.35)');
    cg.addColorStop(0.25, 'rgba(255,255,255,0)'); cg.addColorStop(0.62, 'rgba(255,255,255,0.25)');
    cg.addColorStop(0.75, 'rgba(255,255,255,0)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg; g.fill();
  }
}
function roundRectPath(g, x, y, w, h, r) {
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); roundRectPath(g, x, y, w, h, r); }
function cylinder(g, x, y, w, h, hi, lo, r = 0) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, lo); gr.addColorStop(0.28, hi); gr.addColorStop(0.42, '#ffffff'); gr.addColorStop(0.6, hi); gr.addColorStop(1, lo);
  g.fillStyle = gr;
  if (r) { roundRect(g, x, y, w, h, r); g.fill(); } else g.fillRect(x, y, w, h);
}

window.Deck = Deck;
window.fmtTime = fmtTime;
