'use strict';
const App = {
  lib: { disks: [], settings: {}, current: null },
  diskById(id) { return this.lib.disks.find((d) => d.id === id); },
  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => window.viny.saveLibrary(this.lib).catch((e) => console.error(e)), 250);
  },
  async upsertDisk(d) {
    const i = this.lib.disks.findIndex((x) => x.id === d.id);
    if (i >= 0) this.lib.disks[i] = d; else this.lib.disks.unshift(d);
    this.save();
    Shelf.render();
    if (this.deck.disk && this.deck.disk.id === d.id) await this.deck.refreshDisk(d);
  },
  async deleteDisk(id) {
    if (this.deck.disk && this.deck.disk.id === id) { this.deck.setDisk(null); this.lib.current = null; }
    this.lib.disks = this.lib.disks.filter((d) => d.id !== id);
    this.save();
    await window.viny.deleteDisk(id);
    Shelf.render();
    toast('Пластинка удалена');
  },
  putDisk(id, play = false, track = 0) {
    const d = this.diskById(id); if (!d) return;
    this.engine.resume();
    if (this.deck.disk && this.deck.disk.id === id && !this.deck.swap) {
      if (play) this.deck.playTrack(track);
    } else this.deck.setDisk(d, { play, track });
    this.lib.current = id; this.save();
  },
  playDisk(id, track = 0) { this.putDisk(id, true, track); },
  async exportDisk(id) {
    const d = this.diskById(id); if (!d) return;
    try {
      const r = await window.viny.exportDisk(d);
      if (r) toast(`Сохранено: ${r.name}`);
    } catch (e) { console.error(e); toast('Не удалось экспортировать: ' + (e.message || e), true); }
  },
  async importArchive(filePath) {
    try {
      const r = await window.viny.importDisk(filePath);
      if (!r) return;
      await this.upsertDisk(r.disk);
      toast(`Пластинка «${r.disk.title}» добавлена на витрину`);
      Shelf.open(); Shelf.render();
      Detail.open(r.disk.id);
    } catch (e) {
      console.error(e);
      toast('Не удалось импортировать: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    }
  },

  async init() {
    try { applyUiTextures(); } catch (e) { console.warn(e); }
    try { this.lib = Object.assign({ disks: [], settings: {}, current: null }, await window.viny.loadLibrary()); }
    catch (e) { console.error(e); }
    this.engine = new VinylEngine();
    this.engine.applySettings(this.lib.settings);
    this.deck = new Deck(this.engine, {
      openShelf: () => Shelf.open(),
      onPitch: (v) => { this.lib.settings.pitchV = v; this.save(); },
      onDisk: () => {}, onState: () => {}
    });
    if (typeof this.lib.settings.pitchV === 'number') this.deck.setPitchV(this.lib.settings.pitchV);
    const cur = this.lib.current && this.diskById(this.lib.current);
    if (cur) this.deck.setDisk(cur);
    this.bindUi();
    // .viny files passed on start-up or opened later from Explorer
    if (window.viny.onOpenViny) window.viny.onOpenViny((p) => this.importArchive(p));
    if (window.viny.pendingOpen) for (const p of await window.viny.pendingOpen()) await this.importArchive(p);
  },

  bindUi() {
    const $ = (id) => document.getElementById(id);
    $('openShelf').onclick = () => Shelf.open();
    $('lcd').onclick = () => Shelf.open();
    $('prevBtn').onclick = () => this.deck.skip(-1);
    $('nextBtn').onclick = () => this.deck.skip(1);
    const pop = $('settingsPop');
    pop.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.value = this.engine.settings[inp.dataset.k];
      inp.oninput = () => {
        const s = { [inp.dataset.k]: parseFloat(inp.value) };
        this.engine.applySettings(s);
        Object.assign(this.lib.settings, s); this.save();
      };
    });
    $('settingsBtn').onclick = (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); $('settingsBtn').classList.toggle('active', !pop.classList.contains('hidden')); };
    document.addEventListener('pointerdown', (e) => {
      if (!pop.classList.contains('hidden') && !pop.contains(e.target) && e.target !== $('settingsBtn') && !$('settingsBtn').contains(e.target)) {
        pop.classList.add('hidden'); $('settingsBtn').classList.remove('active');
      }
    });

    // tactile feedback: every physical control clicks
    const PRESS = '.btn, .icon-btn, .tab, .plate-btn, .sw, .trk .mv, .trk .del, .card, #startBtn, #power, .drop';
    document.addEventListener('pointerdown', (e) => {
      const t = e.target.closest && e.target.closest(PRESS + ', .check input');
      if (!t || t.disabled) return;
      this.engine.uiClick(t.matches('.check input, #power') ? 'toggle' : 'press');
      this._pressed = t;
    }, true);
    document.addEventListener('pointerup', () => {
      if (this._pressed && !this._pressed.matches('.check input, #power, .card')) this.engine.uiClick('release');
      this._pressed = null;
    }, true);

    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
      const modal = document.querySelector('.modal-back');
      if (e.key === 'Escape') {
        if (!pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
        if (Detail.back) { Detail.close(); return; }
        if (modal) return;
        if (Shelf.el) Shelf.close();
        return;
      }
      if (modal || Shelf.el) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.deck.startStop(); break;
        case 'KeyL': this.deck.toggleCue(); break;
        case 'ArrowRight': this.deck.skip(1); break;
        case 'ArrowLeft': this.deck.skip(-1); break;
        case 'KeyD': Shelf.open(); break;
        case 'KeyP': this.deck.setPower(!this.deck.power); break;
      }
    });
  }
};
window.App = App;
// never let a dropped file navigate the window away
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (Editor.isOpen || !e.dataTransfer) return;
  for (const f of e.dataTransfer.files) {
    if (/\.viny$/i.test(f.name)) { const p = window.viny.pathForFile(f); if (p) App.importArchive(p); }
  }
});
window.addEventListener('DOMContentLoaded', () => App.init());
