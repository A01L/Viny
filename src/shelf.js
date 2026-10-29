'use strict';
const MAX_TRACKS = 15;
const AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i;
const LABEL_PRESETS = ['#f2efe8', '#e8b04a', '#d9452f', '#1f6feb', '#2e8b57', '#111214', '#f4c7d6', '#7b4bc4'];
const SLEEVE_PRESETS = ['#2b2d33', '#e9e2d0', '#c2402f', '#1d3b6e', '#d8a531', '#2f5d46', '#e66f94', '#101012'];

const media = (d, f) => (f ? window.viny.mediaUrl(d.id, f) : null);
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); };
const totalDur = (d) => d.tracks.reduce((s, t) => s + (t.duration || 0), 0);

/* ---------- sleeve & record thumbnails ---------- */
function sleeveEl(disk, size) {
  const s = h('div', 'sleeve');
  const img = media(disk, disk.sleeveImage);
  if (img) {
    const im = h('img'); im.src = img; im.draggable = false; s.appendChild(im);
    if (disk.sleeveText) {
      const t = h('div', 'txt', `<b style="font-size:${Math.round(size * 0.1)}px">${esc(disk.title || 'Без названия')}</b><span style="font-size:${Math.round(size * 0.06)}px">${esc(disk.artist || '')}</span>`);
      s.appendChild(t);
    }
  } else {
    const bg = disk.sleeveColor || '#2b2d33';
    const ink = isLightColor(bg) ? '#16171a' : '#f4f2ee';
    s.style.background = `linear-gradient(160deg, ${shade(bg, 0.08)}, ${shade(bg, -0.18)})`;
    const vc = (VINYL_COLORS[disk.vinylColor] || VINYL_COLORS.black).base;
    const lc = disk.labelColor || '#e8b04a';
    const g = h('div', 'gen');
    g.innerHTML = `<div class="g-deco" style="background:radial-gradient(circle, ${lc} 0 30%, ${vc} 30.5% 100%);box-shadow:0 0 0 ${Math.round(size * 0.02)}px ${shade(bg, -0.1)}"></div>`
      + (disk.sleeveText !== false ? `<div class="g-title" style="color:${ink};font-size:${Math.round(size * 0.12)}px">${esc(disk.title || 'Без названия')}</div><div class="g-artist" style="color:${ink};font-size:${Math.round(size * 0.065)}px">${esc(disk.artist || '')}</div>` : '');
    s.appendChild(g);
  }
  s.appendChild(h('div', 'ring'));
  s.appendChild(h('div', 'wear'));
  return s;
}

const thumbCache = new Map();
async function recordThumb(disk, size = 560) {
  const key = disk.id + ':' + (disk.rev || 0) + ':' + size;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = (async () => {
    const label = await loadImage(media(disk, disk.labelImage));
    const tex = renderRecordTexture(disk, size, { label });
    const g = tex.getContext('2d');
    drawRecordSheen(g, size / 2, size / 2, size / 2, (VINYL_COLORS[disk.vinylColor] || VINYL_COLORS.black).light);
    try { return tex.toDataURL('image/png'); } catch { return ''; }
  })();
  thumbCache.set(key, p);
  return p;
}

/* ---------- Shelf ---------- */
const Shelf = {
  el: null,
  open() {
    if (this.el) return;
    document.body.classList.add('dark-ui');
    window.viny.setTitleBar && window.viny.setTitleBar('#101113', '#bfc1c6');
    const o = h('div', 'overlay');
    o.innerHTML = `
      <div class="shelf-head">
        <h1>Витрина</h1><span class="count"></span><div class="sp"></div>
        <a class="git-engrave" href="https://github.com/A01L" title="github.com/A01L">Git: A01L</a>
        <button class="btn primary" data-a="new">Создать диск</button>
        <button class="icon-btn" data-a="close" title="Закрыть (Esc)">×</button>
      </div>
      <div class="shelf-scroll"><div class="shelf-grid"></div><div class="empty-shelf" hidden>Здесь пока пусто. Создайте первую пластинку - загрузите до 15 треков и оформите яблоко и обложку.</div></div>`;
    document.getElementById('overlayRoot').appendChild(o);
    this.el = o;
    o.querySelector('[data-a=close]').onclick = () => this.close();
    o.querySelector('.git-engrave').onclick = (e) => { e.preventDefault(); App.engine.uiClick('press'); window.viny.openExternal('https://github.com/A01L'); };
    o.querySelector('[data-a=new]').onclick = () => Editor.open(null);
    this.render();
  },
  close() {
    if (!this.el) return;
    const o = this.el; this.el = null;
    o.classList.add('closing');
    setTimeout(() => o.remove(), 220);
    document.body.classList.remove('dark-ui');
    window.viny.setTitleBar && window.viny.setTitleBar('#d3d5d8', '#2c2e33');
  },
  render() {
    if (!this.el) return;
    const disks = App.lib.disks;
    const grid = this.el.querySelector('.shelf-grid');
    grid.innerHTML = '';
    this.el.querySelector('.count').textContent = `${disks.length} ${plural(disks.length, 'пластинка', 'пластинки', 'пластинок')}`;
    this.el.querySelector('.empty-shelf').hidden = disks.length > 0;
    const SIZE = 220;
    for (const d of disks) {
      const c = h('div', 'card');
      const art = h('div', 'art');
      const rec = h('img', 'rec'); rec.draggable = false;
      recordThumb(d).then((u) => { rec.src = u; });
      art.appendChild(rec);
      art.appendChild(sleeveEl(d, SIZE));
      c.appendChild(art);
      if (App.deck.disk && App.deck.disk.id === d.id) c.appendChild(h('div', 'badge', 'НА ПРОИГРЫВАТЕЛЕ'));
      c.appendChild(h('div', 'meta', `<div class="t">${esc(d.title || 'Без названия')}</div><div class="s">${esc(d.artist || 'Неизвестный исполнитель')} · ${d.tracks.length} ${plural(d.tracks.length, 'трек', 'трека', 'треков')}</div>`));
      c.onclick = () => Detail.open(d.id);
      grid.appendChild(c);
    }
    const n = h('div', 'card new');
    n.innerHTML = `<div class="art"><div class="plus">＋<small>Новый диск</small></div></div><div class="meta"><div class="t"></div><div class="s">до ${MAX_TRACKS} треков</div></div>`;
    n.onclick = () => Editor.open(null);
    grid.appendChild(n);
  }
};

/* ---------- Detail ---------- */
const Detail = {
  back: null,
  open(id) {
    const d = App.diskById(id); if (!d) return;
    this.close(true);
    const back = h('div', 'modal-back');
    const m = h('div', 'modal detail');
    const total = totalDur(d);
    m.innerHTML = `
      <button class="icon-btn x" data-a="close">×</button>
      <div class="detail-stage felt"><div class="detail-art"><div class="rec"><img alt=""></div></div></div>
      <div class="detail-info">
        <div class="kicker">LP · 33⅓ об/мин · ${(VINYL_COLORS[d.vinylColor] || VINYL_COLORS.black).name}</div>
        <h2>${esc(d.title || 'Без названия')}</h2>
        <div class="artist">${esc(d.artist || 'Неизвестный исполнитель')}</div>
        <div class="metaline">${d.tracks.length} ${plural(d.tracks.length, 'трек', 'трека', 'треков')} · ${fmtTime(total)}</div>
        <div class="tracklist scroll"></div>
        <div class="actions">
          <button class="btn primary" data-a="play">▶ Играть</button>
          <button class="btn" data-a="put">Поставить на проигрыватель</button>
          <button class="btn" data-a="edit">Редактировать</button>
          <span style="flex:1"></span>
          <button class="btn danger" data-a="del">Удалить</button>
        </div>
      </div>`;
    const art = m.querySelector('.detail-art');
    art.appendChild(sleeveEl(d, 300));
    recordThumb(d, 720).then((u) => { m.querySelector('.rec img').src = u; });
    const tl = m.querySelector('.tracklist');
    const playing = App.deck.disk && App.deck.disk.id === d.id ? App.deck.currentTrack() : -1;
    if (!d.tracks.length) tl.innerHTML = `<div class="no-tracks">На этой пластинке пока нет музыки. Нажмите «Редактировать», чтобы добавить треки.</div>`;
    d.tracks.forEach((t, i) => {
      const r = h('div', 'tr-row' + (i === playing ? ' playing' : ''), `<span class="n">${i + 1}</span><span class="tt">${esc(t.title)}</span><span class="pl">▶</span><span class="d">${fmtTime(t.duration)}</span>`);
      r.onclick = () => { App.playDisk(d.id, i); this.close(); Shelf.close(); };
      tl.appendChild(r);
    });
    m.querySelector('[data-a=close]').onclick = () => this.close();
    m.querySelector('[data-a=play]').onclick = () => { App.playDisk(d.id, 0); this.close(); Shelf.close(); };
    m.querySelector('[data-a=put]').onclick = () => { App.putDisk(d.id); this.close(); Shelf.close(); };
    m.querySelector('[data-a=edit]').onclick = () => { this.close(); Editor.open(d); };
    m.querySelector('[data-a=del]').onclick = async () => {
      if (await confirmBox('Удалить пластинку?', `«${d.title || 'Без названия'}» и все её треки будут удалены без возможности восстановления.`)) {
        this.close(); await App.deleteDisk(d.id);
      }
    };
    back.addEventListener('pointerdown', (e) => { if (e.target === back) this.close(); });
    back.appendChild(m);
    document.getElementById('overlayRoot').appendChild(back);
    this.back = back;
  },
  close(instant) {
    if (!this.back) return;
    const b = this.back; this.back = null;
    if (instant) return b.remove();
    b.classList.add('closing'); setTimeout(() => b.remove(), 180);
  }
};

/* ---------- Editor ---------- */
const Editor = {
  open(disk) { new DiskEditor(disk); },
  isOpen: false
};

class DiskEditor {
  constructor(disk) {
    this.isNew = !disk;
    this.orig = disk ? JSON.parse(JSON.stringify(disk)) : null;
    this.busy = 0;
    this.imgCache = new Map();
    this.touched = new Set();
    Editor.isOpen = true;
    this.init();
  }
  async init() {
    if (this.isNew) {
      const id = await window.viny.createDisk();
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      this.d = {
        id, title: '', artist: '', vinylColor: 'black', labelColor: pick(LABEL_PRESETS.slice(0, 5)),
        labelText: true, labelTextOnImage: false, labelImage: null, labelSrc: null, labelCrop: null,
        sleeveColor: pick(SLEEVE_PRESETS), sleeveImage: null, sleeveSrc: null, sleeveCrop: null, sleeveText: true,
        tracks: [], created: Date.now(), rev: 0
      };
    } else this.d = JSON.parse(JSON.stringify(this.orig));
    this.build();
  }
  files(d) {
    if (!d) return new Set();
    const s = new Set([d.labelImage, d.labelSrc, d.sleeveImage, d.sleeveSrc, ...d.tracks.map((t) => t.file)]);
    s.delete(null); s.delete(undefined);
    return s;
  }

  build() {
    const d = this.d;
    const back = h('div', 'modal-back');
    const m = h('div', 'modal editor');
    m.innerHTML = `
      <div class="ed-body">
        <div class="ed-preview felt">
          <div class="pv"><canvas width="600" height="600"></canvas><div class="sv"></div></div>
          <div class="pv-note">Предпросмотр</div>
        </div>
        <div class="ed-form">
          <div class="tabs">
            <button class="tab on" data-t="main">Основное</button>
            <button class="tab" data-t="vinyl">Пластинка</button>
            <button class="tab" data-t="sleeve">Обложка</button>
            <button class="tab" data-t="tracks">Треки <span class="cnt"></span></button>
          </div>
          <div class="pane on scroll" data-p="main">
            <div class="field"><label class="lbl">Название альбома</label><input class="input" data-f="title" maxlength="80" placeholder="Например, «Ночной город»"></div>
            <div class="field"><label class="lbl">Исполнитель</label><input class="input" data-f="artist" maxlength="80" placeholder="Имя артиста или группы"></div>
            <div class="hint">Оформите пластинку на вкладках «Пластинка» и «Обложка», а музыку добавьте во вкладке «Треки» - до ${MAX_TRACKS} файлов (MP3, WAV, FLAC, OGG, M4A).</div>
          </div>
          <div class="pane scroll" data-p="vinyl">
            <div class="field"><label class="lbl">Цвет винила</label><div class="swatches" data-sw="vinyl"></div></div>
            <div class="field"><label class="lbl">Изображение в центре (яблоко)</label>
              <div class="imgbox"><div class="thumb round" data-th="label">нет</div>
                <div class="row">
                  <button class="btn small" data-a="label-up">Загрузить…</button>
                  <button class="btn small" data-a="label-crop">Кадрировать</button>
                  <button class="btn small danger" data-a="label-rm">Убрать</button>
                </div></div>
              <div class="hint">Изображение обрезается по кругу. После загрузки можно сдвинуть и приблизить кадр.</div>
            </div>
            <div class="field"><label class="lbl">Цвет яблока</label><div class="swatches" data-sw="label"></div></div>
            <div class="field">
              <label class="check"><input type="checkbox" data-c="labelText"> Печатать название и исполнителя на яблоке</label>
              <label class="check"><input type="checkbox" data-c="labelTextOnImage"> …даже поверх изображения</label>
            </div>
          </div>
          <div class="pane scroll" data-p="sleeve">
            <div class="field"><label class="lbl">Изображение обложки (конверт)</label>
              <div class="imgbox"><div class="thumb sq" data-th="sleeve">нет</div>
                <div class="row">
                  <button class="btn small" data-a="sleeve-up">Загрузить…</button>
                  <button class="btn small" data-a="sleeve-crop">Кадрировать</button>
                  <button class="btn small danger" data-a="sleeve-rm">Убрать</button>
                </div></div>
              <div class="hint">Квадратный кадр. Без изображения обложка оформится автоматически из цвета и названия.</div>
            </div>
            <div class="field"><label class="lbl">Цвет обложки</label><div class="swatches" data-sw="sleeve"></div></div>
            <div class="field"><label class="check"><input type="checkbox" data-c="sleeveText"> Показывать название на обложке</label></div>
          </div>
          <div class="pane scroll" data-p="tracks">
            <div class="trk-list"></div>
            <div class="drop" data-a="add">Добавить музыку - или перетащите файлы сюда</div>
            <div class="hint">Порядок треков можно менять перетаскиванием. Названия редактируются прямо в списке.</div>
          </div>
          <div class="ed-foot">
            <span class="hint busy" style="margin:0;align-self:center" hidden><span class="spinner"></span>&nbsp; Обработка файлов…</span>
            <span class="sp"></span>
            <button class="btn" data-a="cancel">Отмена</button>
            <button class="btn primary" data-a="save">${this.isNew ? 'Создать пластинку' : 'Сохранить'}</button>
          </div>
        </div>
      </div>`;
    back.appendChild(m);
    document.getElementById('overlayRoot').appendChild(back);
    this.back = back; this.m = m;
    const $ = (s) => m.querySelector(s);

    // tabs
    m.querySelectorAll('.tab').forEach((t) => t.onclick = () => this.tab(t.dataset.t));
    // text fields
    m.querySelectorAll('[data-f]').forEach((inp) => {
      inp.value = d[inp.dataset.f] || '';
      inp.oninput = () => { d[inp.dataset.f] = inp.value; this.preview(); };
    });
    setTimeout(() => $('[data-f=title]').focus(), 50);
    // checkboxes
    m.querySelectorAll('[data-c]').forEach((cb) => {
      const k = cb.dataset.c;
      cb.checked = k === 'labelTextOnImage' ? !!d[k] : d[k] !== false;
      cb.onchange = () => { d[k] = cb.checked; this.preview(); };
    });
    // swatches
    this.buildSwatches();
    // images
    for (const kind of ['label', 'sleeve']) {
      $(`[data-a=${kind}-up]`).onclick = () => this.uploadImage(kind);
      $(`[data-a=${kind}-crop]`).onclick = () => this.cropImage(kind);
      $(`[data-a=${kind}-rm]`).onclick = () => { d[kind + 'Image'] = null; d[kind + 'Src'] = null; d[kind + 'Crop'] = null; this.preview(); };
    }
    // tracks
    $('[data-a=add]').onclick = () => this.addTracksDialog();
    const drop = $('[data-a=add]');
    m.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('hot'); } });
    m.addEventListener('dragleave', (e) => { if (e.target === drop) drop.classList.remove('hot'); });
    m.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault(); drop.classList.remove('hot');
      const paths = [...e.dataTransfer.files].filter((f) => AUDIO_RE.test(f.name)).map((f) => window.viny.pathForFile(f)).filter(Boolean);
      if (!paths.length) return toast('Перетащите аудиофайлы (MP3, WAV, FLAC, OGG, M4A)', true);
      this.tab('tracks');
      this.addTracks(paths);
    });

    $('[data-a=cancel]').onclick = () => this.cancel();
    $('[data-a=save]').onclick = () => this.save();
    this.renderTracks();
    this.preview();
  }

  tab(name) {
    this.m.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.t === name));
    this.m.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.p === name));
  }

  buildSwatches() {
    const d = this.d, m = this.m;
    const vin = m.querySelector('[data-sw=vinyl]'); vin.innerHTML = '';
    for (const [k, v] of Object.entries(VINYL_COLORS)) {
      const b = h('button', 'sw vinyl' + (d.vinylColor === k ? ' on' : ''));
      b.style.backgroundColor = v.base; b.title = v.name;
      b.onclick = () => { d.vinylColor = k; this.buildSwatches(); this.preview(); };
      vin.appendChild(b);
    }
    const mk = (box, presets, key) => {
      box.innerHTML = '';
      for (const c of presets) {
        const b = h('button', 'sw' + ((d[key] || '').toLowerCase() === c ? ' on' : ''));
        b.style.background = c;
        b.onclick = () => { d[key] = c; this.buildSwatches(); this.preview(); };
        box.appendChild(b);
      }
      const cu = h('label', 'sw custom' + (presets.includes((d[key] || '').toLowerCase()) ? '' : ' on'));
      cu.title = 'Свой цвет';
      const inp = h('input'); inp.type = 'color'; inp.value = d[key] || '#888888';
      inp.oninput = () => { d[key] = inp.value; this.preview(); };
      inp.onchange = () => this.buildSwatches();
      cu.appendChild(inp); box.appendChild(cu);
    };
    mk(m.querySelector('[data-sw=label]'), LABEL_PRESETS, 'labelColor');
    mk(m.querySelector('[data-sw=sleeve]'), SLEEVE_PRESETS, 'sleeveColor');
  }

  async getImg(file) {
    if (!file) return null;
    if (!this.imgCache.has(file)) this.imgCache.set(file, loadImage(media(this.d, file)));
    return this.imgCache.get(file);
  }

  preview() {
    clearTimeout(this.pvT);
    this.pvT = setTimeout(async () => {
      const d = this.d, m = this.m;
      const label = await this.getImg(d.labelImage);
      const tex = renderRecordTexture(d, 600, { label });
      const cv = m.querySelector('.pv canvas'), g = cv.getContext('2d');
      g.clearRect(0, 0, 600, 600); g.drawImage(tex, 0, 0);
      drawRecordSheen(g, 300, 300, 300, (VINYL_COLORS[d.vinylColor] || VINYL_COLORS.black).light);
      const sv = m.querySelector('.pv .sv'); sv.innerHTML = ''; sv.appendChild(sleeveEl(d, 250));
      const th = (k) => m.querySelector(`[data-th=${k}]`);
      for (const k of ['label', 'sleeve']) {
        const f = d[k + 'Image'];
        th(k).style.backgroundImage = f ? `url("${media(d, f)}")` : 'none';
        th(k).textContent = f ? '' : 'нет';
        m.querySelector(`[data-a=${k}-crop]`).disabled = !d[k + 'Src'];
        m.querySelector(`[data-a=${k}-rm]`).disabled = !f;
      }
      m.querySelector('.tab .cnt').textContent = `${d.tracks.length}/${MAX_TRACKS}`;
    }, 40);
  }

  setBusy(delta) {
    this.busy += delta;
    this.m.querySelector('.busy').hidden = this.busy <= 0;
    this.m.querySelector('[data-a=save]').disabled = this.busy > 0;
  }

  async uploadImage(kind) {
    const p = await window.viny.pickImage(); if (!p) return;
    try {
      this.setBusy(1);
      const { file } = await window.viny.importImage(this.d.id, p, kind);
      this.setBusy(-1);
      this.touched.add(file);
      this.d[kind + 'Src'] = file; this.d[kind + 'Crop'] = null;
      await this.cropImage(kind, true);
    } catch (e) { this.setBusy(-1); toast('Не удалось загрузить изображение: ' + e.message, true); }
  }
  async cropImage(kind, fresh) {
    const d = this.d; if (!d[kind + 'Src']) return;
    const r = await Cropper.open({
      src: media(d, d[kind + 'Src']), shape: kind === 'label' ? 'circle' : 'square', crop: d[kind + 'Crop'],
      title: kind === 'label' ? 'Изображение на яблоке' : 'Обложка пластинки'
    });
    if (!r) { if (fresh && !d[kind + 'Image']) d[kind + 'Src'] = null; this.preview(); return; }
    this.setBusy(1);
    try {
      const name = await window.viny.writeImage(d.id, kind, r.dataUrl);
      this.touched.add(name);
      d[kind + 'Image'] = name; d[kind + 'Crop'] = r.crop;
    } catch (e) { toast('Не удалось сохранить изображение', true); }
    this.setBusy(-1);
    this.preview();
  }

  async addTracksDialog() {
    if (this.d.tracks.length >= MAX_TRACKS) return toast(`На пластинке максимум ${MAX_TRACKS} треков`, true);
    const paths = await window.viny.pickAudio();
    if (paths.length) this.addTracks(paths);
  }
  async addTracks(paths) {
    const free = MAX_TRACKS - this.d.tracks.length;
    if (free <= 0) return toast(`На пластинке максимум ${MAX_TRACKS} треков`, true);
    if (paths.length > free) toast(`Добавлено только ${free} из ${paths.length}: максимум ${MAX_TRACKS} треков на пластинке`, true);
    const list = paths.slice(0, free);
    this.setBusy(1);
    for (const p of list) {
      const tr = { id: Math.random().toString(36).slice(2, 9), title: p.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), file: null, duration: null, loading: true };
      this.d.tracks.push(tr);
      this.renderTracks();
      try {
        const r = await window.viny.importAudio(this.d.id, p);
        tr.file = r.file; this.touched.add(r.file);
        tr.duration = await probeDuration(App.engine.ctx, media(this.d, r.file));
        delete tr.loading;
      } catch (e) {
        console.error(e);
        if (tr.file) window.viny.removeFile(this.d.id, tr.file);
        this.d.tracks.splice(this.d.tracks.indexOf(tr), 1);
        toast(`Не удалось прочитать «${tr.title}»`, true);
      }
      this.renderTracks();
      this.preview();
    }
    this.setBusy(-1);
  }

  renderTracks() {
    const box = this.m.querySelector('.trk-list'); box.innerHTML = '';
    const d = this.d;
    d.tracks.forEach((t, i) => {
      const r = h('div', 'trk');
      r.draggable = true;
      r.innerHTML = `<span class="grip" title="Перетащите">⋮⋮</span><span class="num">${i + 1}</span><input value="${esc(t.title)}" maxlength="100"><span class="dur">${t.loading ? '<span class="spinner"></span>' : fmtTime(t.duration)}</span><button class="mv" data-m="-1" title="Выше">▲</button><button class="mv" data-m="1" title="Ниже">▼</button><button class="del" title="Убрать">✕</button>`;
      const inp = r.querySelector('input');
      inp.oninput = () => { t.title = inp.value; };
      inp.addEventListener('pointerdown', (e) => e.stopPropagation());
      inp.addEventListener('dragstart', (e) => e.preventDefault());
      r.querySelectorAll('.mv').forEach((b) => b.onclick = () => {
        const j = i + parseInt(b.dataset.m, 10); if (j < 0 || j >= d.tracks.length) return;
        [d.tracks[i], d.tracks[j]] = [d.tracks[j], d.tracks[i]]; this.renderTracks(); this.preview();
      });
      r.querySelector('.del').onclick = () => { if (t.loading) return; d.tracks.splice(i, 1); this.renderTracks(); this.preview(); };
      r.addEventListener('dragstart', (e) => { this.dragIdx = i; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      r.addEventListener('dragend', () => { r.classList.remove('dragging'); box.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
      r.addEventListener('dragover', (e) => { if (this.dragIdx == null) return; e.preventDefault(); r.classList.add('over'); });
      r.addEventListener('dragleave', () => r.classList.remove('over'));
      r.addEventListener('drop', (e) => {
        if (this.dragIdx == null) return;
        e.preventDefault(); e.stopPropagation();
        const [mv] = d.tracks.splice(this.dragIdx, 1); d.tracks.splice(i, 0, mv);
        this.dragIdx = null; this.renderTracks(); this.preview();
      });
      box.appendChild(r);
    });
    const add = this.m.querySelector('[data-a=add]');
    const full = d.tracks.length >= MAX_TRACKS;
    add.textContent = full ? `Пластинка заполнена: ${MAX_TRACKS} из ${MAX_TRACKS} треков` : `Добавить музыку - или перетащите файлы сюда (${d.tracks.length}/${MAX_TRACKS})`;
    add.style.opacity = full ? 0.5 : 1;
    this.m.querySelector('.tab .cnt').textContent = `${d.tracks.length}/${MAX_TRACKS}`;
  }

  async save() {
    if (this.busy > 0) return;
    const d = this.d;
    d.title = (d.title || '').trim() || 'Без названия';
    d.artist = (d.artist || '').trim();
    d.tracks = d.tracks.filter((t) => t.file).map((t) => ({ id: t.id, title: (t.title || '').trim() || 'Без названия', file: t.file, duration: t.duration }));
    d.rev = (d.rev || 0) + 1;
    // remove files no longer referenced
    const keep = this.files(d);
    for (const f of this.files(this.orig)) if (!keep.has(f)) window.viny.removeFile(d.id, f);
    this.orphanSweep(keep);
    await App.upsertDisk(d);
    this.close();
    if (this.isNew) toast('Пластинка создана');
    if (Shelf.el) Detail.open(d.id);
  }
  orphanSweep(keep) {
    // files imported during this session but dropped (e.g. replaced images)
    for (const f of this.touched || []) if (!keep.has(f)) window.viny.removeFile(this.d.id, f);
  }
  async cancel() {
    if (this.busy > 0) return;
    if (this.isNew) { await window.viny.deleteDisk(this.d.id); }
    else {
      const orig = this.files(this.orig);
      for (const f of new Set([...this.files(this.d), ...this.touched])) if (!orig.has(f)) window.viny.removeFile(this.d.id, f);
    }
    this.close();
  }
  close() {
    Editor.isOpen = false;
    const b = this.back; b.classList.add('closing'); setTimeout(() => b.remove(), 180);
  }
}

Object.assign(window, { Shelf, Detail, Editor, sleeveEl, recordThumb, thumbCache });
