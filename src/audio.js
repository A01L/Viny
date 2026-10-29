'use strict';
/*
 * VinylEngine - Web Audio. Simulates:
 *  - platter speed (motor inertia → pitch bends on start/stop, pitch fader)
 *  - wow & flutter (slow + fast speed modulation)
 *  - vinyl tonal colouring (RIAA-ish curve, HF roll-off that grows toward the
 *    inner grooves, soft saturation, limited channel separation, mono bass)
 *  - surface noise: hiss, rumble, crackle, pops, a dust tick once per revolution
 *  - needle drop / lift sounds, locked run-out groove clicks
 */
class VinylEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    const c = this.ctx;
    this.settings = { volume: 0.85, noise: 0.55, wow: 0.5, tone: 0.7 };

    this.master = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 6; this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
    this.master.connect(this.limiter).connect(c.destination);

    // --- music chain ---
    this.musicIn = c.createGain();
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 22; this.hp.Q.value = 0.6;
    this.lowShelf = c.createBiquadFilter(); this.lowShelf.type = 'lowshelf'; this.lowShelf.frequency.value = 140;
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 2600; this.mid.Q.value = 0.8;
    this.highShelf = c.createBiquadFilter(); this.highShelf.type = 'highshelf'; this.highShelf.frequency.value = 8500;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 16000; this.lp.Q.value = 0.5;
    this.shaper = c.createWaveShaper(); this.shaper.oversample = '2x';
    this.setDrive(0.25);

    // limited stereo separation (~ -24 dB crosstalk) + mono bass (elliptical EQ)
    const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
    const ll = c.createGain(), lr = c.createGain(), rl = c.createGain(), rr = c.createGain();
    ll.gain.value = rr.gain.value = 0.94; lr.gain.value = rl.gain.value = 0.06;
    this.shaper.connect(split);
    split.connect(ll, 0); split.connect(lr, 0); split.connect(rl, 1); split.connect(rr, 1);
    ll.connect(merge, 0, 0); rl.connect(merge, 0, 0); lr.connect(merge, 0, 1); rr.connect(merge, 0, 1);

    this.musicOut = c.createGain(); this.musicOut.gain.value = 0;
    this.musicIn.connect(this.hp).connect(this.lowShelf).connect(this.mid).connect(this.highShelf).connect(this.lp).connect(this.shaper);
    merge.connect(this.musicOut).connect(this.master);

    // --- wow & flutter LFOs (connected into each music source's playbackRate) ---
    this.wowOsc = c.createOscillator(); this.wowOsc.frequency.value = 0.555; // once per revolution @33⅓
    this.flutOsc = c.createOscillator(); this.flutOsc.frequency.value = 6.3;
    this.wowGain = c.createGain(); this.flutGain = c.createGain();
    this.wowGain.gain.value = 0; this.flutGain.gain.value = 0;
    this.wowOsc.connect(this.wowGain); this.flutOsc.connect(this.flutGain);
    this.wowOsc.start(); this.flutOsc.start();

    // --- surface noise ---
    this.noiseOut = c.createGain(); this.noiseOut.gain.value = 0;
    this.noiseTone = c.createBiquadFilter(); this.noiseTone.type = 'lowpass'; this.noiseTone.frequency.value = 9000;
    this.noiseTone.connect(this.noiseOut).connect(this.master);
    this.noiseSrc = null;
    this.buildNoise();

    this.cache = new Map();   // file -> Promise<AudioBuffer>
    this.cur = null;          // { idx, src, ended }
    this.disk = null;
    this.needle = false;
    this.rate = 0;
    this.applySettings();
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  setDrive(k) {
    const n = 2048, curve = new Float32Array(n), d = 1 + k * 3;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * d) / Math.tanh(d); }
    this.shaper.curve = curve;
  }

  applySettings(s) {
    if (s) Object.assign(this.settings, s);
    const t = this.ctx.currentTime, st = this.settings;
    this.master.gain.setTargetAtTime(st.volume, t, 0.05);
    this.lowShelf.gain.setTargetAtTime(2.5 * st.tone, t, 0.05);
    this.mid.gain.setTargetAtTime(-1.2 * st.tone, t, 0.05);
    this.highShelf.gain.setTargetAtTime(-3.5 * st.tone, t, 0.05);
    this.setDrive(0.05 + 0.45 * st.tone);
  }

  /* procedural surface-noise loop: 8 revolutions of a 33⅓ rpm record */
  buildNoise() {
    const c = this.ctx, sr = c.sampleRate, rev = 1.8, revs = 8;
    const len = Math.floor(sr * rev * revs);
    const buf = c.createBuffer(2, len, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let rnd = 1234567;
    const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
    // hiss (band-limited) + rumble
    let hl = 0, hr = 0, hpl = 0, hpr = 0, rum = 0, rum2 = 0;
    const aH = 0.55, aR = 2 * Math.PI * 28 / sr;
    for (let i = 0; i < len; i++) {
      const wl = rand() * 2 - 1, wr = rand() * 2 - 1;
      hl += aH * (wl - hl); hr += aH * (wr - hr);
      const bl = hl - hpl, br = hr - hpr; hpl += 0.04 * (hl - hpl); hpr += 0.04 * (hr - hpr);
      rum += aR * ((rand() * 2 - 1) - rum); rum2 += aR * (rum - rum2);
      const r = rum2 * 0.9;
      L[i] = bl * 0.0065 + r; R[i] = br * 0.0065 + r;
    }
    // crackle: dense small clicks
    const pop = (pos, amp, decay, pan, lowpass) => {
      const n = Math.floor(decay * sr * 6);
      const gl = amp * (pan < 0 ? 1 : 1 - pan), gr = amp * (pan > 0 ? 1 : 1 + pan);
      const sign = rand() < 0.5 ? -1 : 1;
      let y = 0, prev = 0;
      for (let k = 0; k < n && pos + k < len; k++) {
        const env = Math.exp(-k / (decay * sr));
        let x = (k === 0 ? sign : (k < 3 ? -sign * 0.6 : (rand() * 2 - 1) * 0.5)) * env;
        if (lowpass) { y += 0.25 * (x - y); x = y * 2.2; }
        const v = x - prev * 0.3; prev = x;
        L[pos + k] += v * gl; R[pos + k] += v * gr;
      }
    };
    const total = rev * revs;
    let t = 0;
    while (t < total) {
      t += -Math.log(1 - rand()) / 22; // ~22 crackles/sec
      const a = 0.015 + Math.pow(rand(), 3) * 0.12;
      pop(Math.floor(t * sr), a, 0.00008 + rand() * 0.0002, (rand() * 2 - 1) * 0.8, false);
    }
    t = 0;
    while (t < total) {
      t += 1.2 + rand() * 3.5; // occasional bigger pops
      pop(Math.floor(t * sr), 0.12 + rand() * 0.22, 0.0006 + rand() * 0.0012, (rand() * 2 - 1) * 0.5, true);
    }
    // dust tick at the same spot every revolution (slightly varying)
    const phase = 0.37;
    for (let r = 0; r < revs; r++) {
      pop(Math.floor((r + phase) * rev * sr), 0.16 + rand() * 0.06, 0.0005, 0.2, true);
    }
    this.noiseBuffer = buf;
  }

  startNoise() {
    if (this.noiseSrc) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer; s.loop = true;
    s.playbackRate.value = Math.max(0.0001, this.rate);
    s.connect(this.noiseTone);
    s.start(0, Math.random() * this.noiseBuffer.duration);
    this.noiseSrc = s;
  }
  stopNoise() {
    if (!this.noiseSrc) return;
    const s = this.noiseSrc; this.noiseSrc = null;
    try { s.stop(this.ctx.currentTime + 0.12); } catch {}
  }

  /* ---- one-shot sounds ---- */
  _burst(dur, freq, amp, noiseAmt, lpf) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * dur);
    const b = c.createBuffer(2, n, sr), L = b.getChannelData(0), R = b.getChannelData(1);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.exp(-t / (dur * 0.25));
      const x = Math.sin(2 * Math.PI * freq * t) * amp * env + (Math.random() * 2 - 1) * noiseAmt * Math.exp(-t / (dur * 0.08));
      y += lpf * (x - y);
      L[i] = y; R[i] = y * 0.96;
    }
    const s = c.createBufferSource(); s.buffer = b;
    s.connect(this.master); s.start();
  }
  /* tiny mechanical click for UI buttons (independent of the music volume) */
  uiClick(kind = 'press') {
    if (this.ctx.state !== 'running') this.ctx.resume();
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * 0.03);
    const b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    const f = kind === 'release' ? 2600 : kind === 'toggle' ? 1400 : 1900, amp = kind === 'release' ? 0.08 : 0.16;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.exp(-t / (kind === 'toggle' ? 0.006 : 0.0035));
      const x = ((Math.random() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * f * t) * 0.6) * env;
      y += 0.6 * (x - y); d[i] = (x - y * 0.5) * amp;
    }
    if (!this.uiGain) { this.uiGain = c.createGain(); this.uiGain.gain.value = 0.6; this.uiGain.connect(c.destination); }
    const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = 0.9 + Math.random() * 0.2;
    s.connect(this.uiGain); s.start();
  }
  dropSound() { this._burst(0.35, 55, 0.5, 0.7, 0.35); }
  liftSound() { this._burst(0.12, 90, 0.12, 0.35, 0.5); }
  lockedClick() { this._burst(0.09, 70, 0.22, 0.5, 0.4); }

  /* ---- disk / buffers ---- */
  setDisk(disk) {
    this.stopMusic(true);
    this.disk = disk;
    for (const k of [...this.cache.keys()]) this.cache.delete(k);
  }
  getBuffer(i) {
    const tr = this.disk && this.disk.tracks[i];
    if (!tr) return null;
    if (!this.cache.has(tr.file)) {
      const p = fetch(window.viny.mediaUrl(this.disk.id, tr.file))
        .then((r) => r.arrayBuffer())
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((b) => { p.buffer = b; return b; })
        .catch((e) => { console.error('decode failed', e); p.failed = true; return null; });
      this.cache.set(tr.file, p);
    }
    return this.cache.get(tr.file);
  }
  trimCache(keep) {
    const files = new Set(keep.map((i) => this.disk.tracks[i] && this.disk.tracks[i].file));
    for (const k of [...this.cache.keys()]) if (!files.has(k)) this.cache.delete(k);
  }

  stopMusic(hard) {
    if (!this.cur) return;
    const { src } = this.cur; this.cur = null;
    try { src.onended = null; src.stop(this.ctx.currentTime + (hard ? 0 : 0.03)); } catch {}
  }

  needleDown() {
    this.resume();
    this.needle = true;
    this.dropSound();
    const t = this.ctx.currentTime;
    this.musicOut.gain.cancelScheduledValues(t);
    this.musicOut.gain.setValueAtTime(0, t);
    this.musicOut.gain.linearRampToValueAtTime(1, t + 0.04);
    this.startNoise();
  }
  needleUp() {
    if (!this.needle) return;
    this.needle = false;
    const t = this.ctx.currentTime;
    this.musicOut.gain.cancelScheduledValues(t);
    this.musicOut.gain.setTargetAtTime(0, t, 0.015);
    this.liftSound();
    this.stopNoise();
    setTimeout(() => { if (!this.needle) this.stopMusic(true); }, 80);
  }
  seek() { this.stopMusic(false); }

  /*
   * Called every animation frame by the deck.
   * seg: { kind:'track'|'gap'|'leadin'|'runout', idx, local, radiusK (0 outer..1 inner) }
   */
  update(rate, seg) {
    const c = this.ctx, t = c.currentTime;
    this.rate = rate;
    const st = this.settings;
    // speed on noise + music
    if (this.noiseSrc) this.noiseSrc.playbackRate.setTargetAtTime(Math.max(0.0001, rate), t, 0.02);
    const noiseLvl = this.needle ? st.noise * 0.9 * Math.min(1, rate * 1.4) * (seg && seg.kind === 'runout' ? 1.5 : 1) : 0;
    this.noiseOut.gain.setTargetAtTime(noiseLvl, t, 0.03);
    this.wowGain.gain.setTargetAtTime(0.0024 * st.wow * rate, t, 0.05);
    this.flutGain.gain.setTargetAtTime(0.0007 * st.wow * rate, t, 0.05);
    this.noiseTone.frequency.setTargetAtTime(400 + 8600 * Math.min(1, rate), t, 0.03);

    // inner-groove HF loss
    if (seg) {
      const k = seg.radiusK || 0;
      const lpHz = (17500 - 6500 * k * st.tone) * Math.max(0.05, Math.min(1, rate));
      this.lp.frequency.setTargetAtTime(Math.max(300, lpHz), t, 0.05);
    }

    if (!this.disk || !this.needle || !seg) { if (this.cur) this.stopMusic(false); return; }

    if (seg.kind === 'track') {
      const p = this.getBuffer(seg.idx);
      if (seg.idx + 1 < this.disk.tracks.length && seg.remain < 25) this.getBuffer(seg.idx + 1);
      this.trimCache([seg.idx, seg.idx + 1]);
      if (this.cur && this.cur.idx !== seg.idx) this.stopMusic(false);
      if (!this.cur && p && p.buffer) {
        const b = p.buffer;
        if (seg.local < b.duration - 0.05) {
          const src = c.createBufferSource();
          src.buffer = b;
          src.playbackRate.value = Math.max(0.0001, rate);
          this.wowGain.connect(src.playbackRate);
          this.flutGain.connect(src.playbackRate);
          src.connect(this.musicIn);
          src.start(0, Math.max(0, seg.local));
          const cur = { idx: seg.idx, src, ended: false };
          src.onended = () => { cur.ended = true; };
          this.cur = cur;
        }
      }
      if (this.cur && !this.cur.ended) this.cur.src.playbackRate.setTargetAtTime(Math.max(0.0001, rate), t, 0.012);
    } else {
      if (this.cur && this.cur.ended) this.cur = null;
      else if (this.cur) this.stopMusic(false);
      if (seg.kind === 'gap' && seg.idx + 1 < this.disk.tracks.length) this.getBuffer(seg.idx + 1);
      if (seg.kind === 'leadin') this.getBuffer(0);
    }
  }

  prefetch(i) { this.getBuffer(i); }
}

/* Decode a file just to learn its duration (used when importing). */
async function probeDuration(ctx, url) {
  const ab = await (await fetch(url)).arrayBuffer();
  const b = await ctx.decodeAudioData(ab);
  return b.duration;
}

window.VinylEngine = VinylEngine;
window.probeDuration = probeDuration;
