'use strict';
/* Image cropper: pan (drag), zoom (wheel / slider), circle or square mask. */
const Cropper = {
  open({ src, shape = 'square', crop = null, title = 'Кадрирование' }) {
    return new Promise(async (resolve) => {
      const img = await loadImage(src);
      if (!img) { toast('Не удалось открыть изображение', true); return resolve(null); }
      const VIEW = Math.max(260, Math.min(492, window.innerHeight - 300)), BOX = Math.round(VIEW * 0.82), M = (VIEW - BOX) / 2;
      const back = h('div', 'modal-back');
      const m = h('div', 'modal cropper');
      m.innerHTML = `
        <h3>${title}</h3>
        <div class="sub">${shape === 'circle' ? 'Перетащите изображение, чтобы выбрать, что будет на яблоке пластинки.' : 'Перетащите изображение, чтобы выбрать кадр для обложки.'}</div>
        <canvas class="crop-view"></canvas>
        <div class="crop-ctrl"><span>−</span><input type="range" min="1" max="6" step="0.001" value="1"><span>+</span></div>
        <div class="row" style="justify-content:flex-end;margin-top:12px">
          <button class="btn" data-a="cancel">Отмена</button>
          <button class="btn primary" data-a="ok">Применить</button>
        </div>`;
      back.appendChild(m);
      document.getElementById('overlayRoot').appendChild(back);
      const cv = m.querySelector('canvas'), range = m.querySelector('input');
      const dpr = window.devicePixelRatio || 1;
      cv.width = VIEW * dpr; cv.height = VIEW * dpr; cv.style.width = cv.style.height = VIEW + 'px';
      m.style.width = (VIEW + 48) + 'px';
      const g = cv.getContext('2d');
      const base = Math.max(BOX / img.naturalWidth, BOX / img.naturalHeight);
      const st = { zoom: crop ? crop.zoom : 1, ox: crop ? crop.ox * BOX : 0, oy: crop ? crop.oy * BOX : 0 };
      range.value = st.zoom;

      const limit = () => {
        const s = base * st.zoom, w = img.naturalWidth * s, hh = img.naturalHeight * s;
        const mx = Math.max(0, (w - BOX) / 2), my = Math.max(0, (hh - BOX) / 2);
        st.ox = Math.max(-mx, Math.min(mx, st.ox)); st.oy = Math.max(-my, Math.min(my, st.oy));
      };
      const draw = () => {
        limit();
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, VIEW, VIEW);
        const s = base * st.zoom, w = img.naturalWidth * s, hh = img.naturalHeight * s;
        const cx = VIEW / 2 + st.ox, cy = VIEW / 2 + st.oy;
        g.drawImage(img, cx - w / 2, cy - hh / 2, w, hh);
        g.fillStyle = 'rgba(0,0,0,0.62)';
        g.beginPath(); g.rect(0, 0, VIEW, VIEW);
        if (shape === 'circle') g.arc(VIEW / 2, VIEW / 2, BOX / 2, 0, Math.PI * 2, true);
        else { g.moveTo(M, M); g.lineTo(M, M + BOX); g.lineTo(M + BOX, M + BOX); g.lineTo(M + BOX, M); g.closePath(); }
        g.fill('evenodd');
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5;
        g.beginPath();
        if (shape === 'circle') {
          g.arc(VIEW / 2, VIEW / 2, BOX / 2, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([4, 5]); g.strokeStyle = 'rgba(255,255,255,0.35)';
          g.beginPath(); g.arc(VIEW / 2, VIEW / 2, BOX * 0.045, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        } else {
          g.rect(M, M, BOX, BOX); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
          for (let i = 1; i < 3; i++) {
            g.beginPath(); g.moveTo(M + BOX * i / 3, M); g.lineTo(M + BOX * i / 3, M + BOX); g.stroke();
            g.beginPath(); g.moveTo(M, M + BOX * i / 3); g.lineTo(M + BOX, M + BOX * i / 3); g.stroke();
          }
        }
      };
      draw();

      let drag = null;
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => { if (!drag) return; st.ox = drag.ox + (e.clientX - drag.x); st.oy = drag.oy + (e.clientY - drag.y); draw(); });
      cv.addEventListener('pointerup', () => { drag = null; });
      const zoomTo = (z, px = VIEW / 2, py = VIEW / 2) => {
        z = Math.max(1, Math.min(6, z));
        const k = z / st.zoom;
        st.ox = (st.ox - (px - VIEW / 2)) * k + (px - VIEW / 2);
        st.oy = (st.oy - (py - VIEW / 2)) * k + (py - VIEW / 2);
        st.zoom = z; range.value = z; draw();
      };
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        zoomTo(st.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      range.addEventListener('input', () => zoomTo(parseFloat(range.value)));

      const close = (val) => {
        back.classList.add('closing');
        setTimeout(() => back.remove(), 180);
        resolve(val);
      };
      m.querySelector('[data-a=cancel]').onclick = () => close(null);
      back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
      m.querySelector('[data-a=ok]').onclick = () => {
        limit();
        const OUT = 1200, out = document.createElement('canvas'); out.width = out.height = OUT;
        const og = out.getContext('2d'), f = OUT / BOX;
        const s = base * st.zoom * f, w = img.naturalWidth * s, hh = img.naturalHeight * s;
        const cx = OUT / 2 + st.ox * f, cy = OUT / 2 + st.oy * f;
        og.imageSmoothingQuality = 'high';
        og.drawImage(img, cx - w / 2, cy - hh / 2, w, hh);
        close({ dataUrl: out.toDataURL('image/jpeg', 0.92), crop: { zoom: st.zoom, ox: st.ox / BOX, oy: st.oy / BOX } });
      };
    });
  }
};

function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, err) {
  const t = h('div', 'toast' + (err ? ' err' : ''), esc(msg));
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
}
function confirmBox(title, text, okText = 'Удалить') {
  return new Promise((res) => {
    const back = h('div', 'modal-back');
    const m = h('div', 'modal confirm', `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" data-a="no">Отмена</button><button class="btn danger" data-a="yes">${esc(okText)}</button></div>`);
    back.appendChild(m); document.getElementById('overlayRoot').appendChild(back);
    const done = (v) => { back.classList.add('closing'); setTimeout(() => back.remove(), 180); res(v); };
    m.querySelector('[data-a=no]').onclick = () => done(false);
    m.querySelector('[data-a=yes]').onclick = () => done(true);
  });
}
Object.assign(window, { Cropper, h, esc, toast, confirmBox });
