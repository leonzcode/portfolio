/* (W, round 10) Any mountain on Earth: the trail map, from the pause menu. The mountain's own shading (its real
   elevation lit from the north-west, as printed trail maps are), its runs in the colours of the slopes' own signs (green,
   blue, black in the Americas and Oceania; green, blue, red, black elsewhere), the lifts, the parks, your place. Scroll
   or pinch to zoom, drag to look round, click or tap anywhere to drop in there facing down the hill. Outside the part of
   the mountain that is built, a drop builds that part instead (the page starts again round it, the place kept). */
import { originOf } from './wplaces.js?v=26';

const NA = (lat, lon) => lon < -30 || lat < -10 && lon > 100;     // (the Americas, and Australia and New Zealand)
export function trailColours(lat, lon) {
  // [novice, easy, intermediate, advanced, expert, freeride, park]
  return NA(lat, lon) ? ['#1f9d55', '#1f9d55', '#1f5fb8', '#111418', '#111418', '#111418', '#ff6a13']
    : ['#1f9d55', '#1f5fb8', '#d12a2a', '#111418', '#111418', '#e8a317', '#ff6a13'];
}
export function trailNames(lat, lon) {
  return NA(lat, lon) ? ['Beginner', 'Easier (green circle)', 'More difficult (blue square)', 'Most difficult (black diamond)', 'Experts only (double black)', 'Freeride', 'Terrain park']
    : ['Beginner', 'Easy (blue)', 'Intermediate (red)', 'Difficult (black)', 'Expert', 'Freeride route', 'Terrain park'];
}
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TrailMap {
  /* W: the world (wmap.js), g: { skier, drop(x, z, yaw), back() (to the pause menu), height } */
  constructor(W, g) {
    this.W = W; this.g = g; this.el = $('wtrail'); this.built = false; this.open_ = false;
    const o = originOf(W.place); this.cols = trailColours(o.lat, o.lon); this.names = trailNames(o.lat, o.lon);
    // the map covers the runs and lifts (all of them, built or not) and the built area
    const E = W.ext; let x0 = E.x0, x1 = E.x1, z0 = E.z0, z1 = E.z1;
    for (const L of [W.data.pistes, W.data.lifts]) for (const r of L) for (const p of r.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    // (no further than the elevation's middle layer reaches: about 20 km)
    const me = W.land.elev.mid.extent();
    x0 = Math.max(x0, me.x0 + 200); x1 = Math.min(x1, me.x1 - 200); z0 = Math.max(z0, me.z0 + 200); z1 = Math.min(z1, me.z1 - 200);
    const s = Math.max(x1 - x0, z1 - z0) + 400, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.box = { x0: cx - s / 2, z0: cz - s / 2, s };
    this.view = { cx: (E.x0 + E.x1) / 2, cz: (E.z0 + E.z1) / 2, mpp: 1 };   // (metres a screen pixel)
    addEventListener('keydown', e => { if (this.open_ && e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); this.close(); } }, true);
  }
  build() {
    if (this.built) return; this.built = true;
    const el = this.el, W = this.W;
    el.innerHTML = `<div class="wthead"><h2 id="wtname">${esc(W.place.name)}</h2><small>${esc(W.place.sub || '')}</small><span class="wtsp"></span><button type="button" data-act="me">Find me</button><button type="button" data-act="close">Close</button></div>
<div class="wtmap"><canvas></canvas><div class="wttip" hidden></div></div>
<div class="wtfoot">${[1, 2, 3, 4, 6].map(i => `<span class="wtkey"><i style="background:${this.cols[i]}"></i>${esc(this.names[i])}</span>`).join('')}<span class="wtkey"><i style="background:#2a2f36;height:3px"></i>Lift</span><span class="wthint">Click to drop in &middot; scroll to zoom &middot; drag to look round</span></div>`;
    el.querySelector('[data-act="close"]').onclick = () => this.close();
    el.querySelector('[data-act="me"]').onclick = () => { const p = this.g.skier.p; this.view.cx = p.x; this.view.cz = p.z; this.view.mpp = Math.min(this.view.mpp, 4); this.draw(); };
    this.cv = el.querySelector('canvas'); this.tip = el.querySelector('.wttip'); this.mapEl = el.querySelector('.wtmap');
    // ---- the shading, once: the real ground lit from the north-west, snow white to cold blue, rock grey, forest green
    const N = 640, B = this.box, img = new ImageData(N, N), d = img.data, h = new Float32Array((N + 2) * (N + 2)), st = B.s / N, elev = W.land.elev;
    for (let j = 0; j < N + 2; j++) for (let i = 0; i < N + 2; i++) h[j * (N + 2) + i] = elev.at(B.x0 + (i - 0.5) * st, B.z0 + (j - 0.5) * st);
    const Lx = -0.5, Ly = 0.62, Lz = -0.6, ll = Math.hypot(Lx, Ly, Lz), cover = W.cover;
    let hmin = Infinity, hmax = -Infinity; for (const v of h) { if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j + 1) * (N + 2) + i + 1, gx = (h[k + 1] - h[k - 1]) / (2 * st), gz = (h[k + N + 2] - h[k - N - 2]) / (2 * st);
      const nl = 1 / Math.sqrt(1 + gx * gx + gz * gz), dif = Math.max(0, (-gx * Lx + Ly - gz * Lz) * nl / ll), slope = Math.sqrt(gx * gx + gz * gz);
      const x = B.x0 + (i + 0.5) * st, z = B.z0 + (j + 0.5) * st;
      // snow: white in the sun, cold blue in the shade; a touch darker low down
      const lo = (h[k] - hmin) / Math.max(1, hmax - hmin), sh = 0.35 + 0.65 * dif;
      let r = 120 + 128 * sh, gg = 138 + 114 * sh, b = 168 + 87 * sh;
      r -= (1 - lo) * 14; gg -= (1 - lo) * 8;
      // rock on the steepest faces
      const rk = Math.min(1, Math.max(0, (slope - 0.95) / 0.5));
      if (rk > 0) { const t = rk * 0.75; r += (110 * sh - r) * t; gg += (104 * sh - gg) * t; b += (100 * sh - b) * t; }
      // the forest
      const c = cover ? cover.at(x, z) : -1;
      if (c > 0.25) { const t = Math.min(0.62, (c - 0.25) * 1.1); r += (58 * sh + 20 - r) * t; gg += (88 * sh + 24 - gg) * t; b += (72 * sh + 26 - b) * t; }
      const o = (j * N + i) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
    this.base = new OffscreenCanvas(N, N); this.base.getContext('2d').putImageData(img, 0, 0);
    this.N = N;
    // ---- what the pointer is over: the runs and lifts, by name
    this.lines = this.allLines();
    // ---- pointer: drag to look round, wheel to zoom, a click (no drag) drops in
    const cv = this.cv;
    let down = null, moved = false; const pts = new Map();
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); down = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz }; moved = false; this.pinch = null; });
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect();
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {     // (two fingers: zoom)
        const [a, b] = [...pts.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (this.pinch) { this.view.mpp = Math.min(this.maxMpp, Math.max(0.6, this.pinch.mpp * this.pinch.d / Math.max(10, dist))); this.draw(); } else this.pinch = { d: dist, mpp: this.view.mpp };
        moved = true; return;
      }
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 5) moved = true;
        if (moved) { this.view.cx = down.cx - dx * this.view.mpp; this.view.cz = down.cz - dy * this.view.mpp; this.draw(); }
      }
      this.hover(e.clientX - r.left, e.clientY - r.top);
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (!down) return;
      const r = cv.getBoundingClientRect(), click = !moved && pts.size === 0;
      down = null;
      if (click) this.click(e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); down = null; });
    cv.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, before = this.toWorld(mx, my);
      this.view.mpp = Math.min(this.maxMpp, Math.max(0.6, this.view.mpp * Math.exp(e.deltaY * 0.0015)));
      const after = this.toWorld(mx, my); this.view.cx += before.x - after.x; this.view.cz += before.z - after.z;
      this.draw();
    }, { passive: false });
    addEventListener('resize', () => { if (this.open_) this.draw(); });
  }
  /* every run and lift with what Leonski 2's panels told of it: length, top and bottom, the drop and the mean slope (the
     elevation along it), groomed or not, lit, the lift's seats and ride time where the map has them */
  allLines() {
    if (this._lines) return this._lines;
    const W = this.W, el = W.land.elev, out = [];
    const prof = pts => { let len = 0, top = -Infinity, bot = Infinity; for (let i = 0; i < pts.length; i++) { const y = el.at(pts[i].x, pts[i].z); top = Math.max(top, y); bot = Math.min(bot, y); if (i) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); } return { len, top, bot }; };
    const box = pts => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } return { x0, x1, z0, z1 }; };
    for (const p of W.data.pistes) if (p.pts.length > 1) {
      const f = prof(p.pts), slope = Math.atan2(f.top - f.bot, Math.max(1, f.len)) * 180 / Math.PI;
      const sub = [p.park ? 'Terrain park' : this.names[p.diff] || '', (f.len / 1000).toFixed(2) + ' km', Math.round(f.top - f.bot) + ' m down', slope.toFixed(0) + ' degrees on average', p.groom ? 'groomed' : 'not groomed', p.lit ? 'lit at night' : ''].filter(Boolean).join(' \u00b7 ');
      out.push(Object.assign({ pts: p.pts, kind: 'run', name: p.name || (p.park ? 'Terrain park' : 'A run'), sub, col: this.cols[p.diff], diff: p.diff, groom: p.groom }, box(p.pts)));
    }
    for (const L of W.data.lifts) if (L.pts.length > 1) {
      const f = prof(L.pts);
      const sub = [(L.kind || 'lift').replace(/_/g, ' '), Math.round(f.len) + ' m', Math.round(f.top - f.bot) + ' m up', L.occupancy ? L.occupancy + ' a chair' : '', L.duration ? L.duration + ' min ride' : ''].filter(Boolean).join(' \u00b7 ');
      out.push(Object.assign({ pts: L.pts, kind: 'lift', name: L.name || 'A lift', sub }, box(L.pts)));
    }
    return (this._lines = out);
  }
  open() {
    this.build();
    this.el.classList.remove('hidden'); this.open_ = true;
    const r = this.mapEl.getBoundingClientRect(), E = this.W.ext;
    this.maxMpp = this.box.s / Math.max(200, Math.min(r.width, r.height)) * 1.1;
    // (first open: the built area fills the view; after that, where you are)
    if (!this.seen) { this.seen = true; this.view.mpp = Math.max(E.x1 - E.x0, E.z1 - E.z0) / Math.max(200, Math.min(r.width, r.height)) * 0.95; }
    const p = this.g.skier.p; if (this.seen2) { this.view.cx = p.x; this.view.cz = p.z; } this.seen2 = true;
    this.draw();
    const b = this.el.querySelector('[data-act="close"]'); if (b) b.focus();
  }
  close() { this.el.classList.add('hidden'); this.open_ = false; this.g.back(); }
  // screen (css px in the map) <-> world
  toWorld(mx, my) { const v = this.view; return { x: v.cx + (mx - this.w / 2) * v.mpp, z: v.cz + (my - this.h / 2) * v.mpp }; }
  toScreen(x, z) { const v = this.view; return [(x - v.cx) / v.mpp + this.w / 2, (z - v.cz) / v.mpp + this.h / 2]; }
  draw() {
    const cv = this.cv, r = this.mapEl.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const c = cv.getContext('2d'), v = this.view, B = this.box, W = this.W;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0d1b2a'; c.fillRect(0, 0, r.width, r.height);
    // the shading
    const [bx, by] = this.toScreen(B.x0, B.z0), bs = B.s / v.mpp;
    c.imageSmoothingEnabled = true; c.drawImage(this.base, bx, by, bs, bs);
    // the built area (outside it a drop builds that part)
    const E = W.ext, [ex, ey] = this.toScreen(E.x0, E.z0), [ex2, ey2] = this.toScreen(E.x1, E.z1);
    c.fillStyle = 'rgba(13,27,42,.32)';
    c.beginPath(); c.rect(0, 0, r.width, r.height); c.rect(ex, ey2, ex2 - ex, ey - ey2); c.fill('evenodd');
    c.setLineDash([8, 6]); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1.5; c.strokeRect(ex, ey, ex2 - ex, ey2 - ey); c.setLineDash([]);
    const path = pts => { c.beginPath(); for (let i = 0; i < pts.length; i++) { const [x, y] = this.toScreen(pts[i].x, pts[i].z); i ? c.lineTo(x, y) : c.moveTo(x, y); } };
    const wide = Math.max(1.6, Math.min(5, 18 / v.mpp));
    // the runs: areas filled, lines with a white edge, in their colours
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const p of W.data.pistes) if (p.area) { path(p.pts); c.globalAlpha = 0.28; c.fillStyle = this.cols[p.diff]; c.fill(); c.globalAlpha = 1; }
    for (const pass of [0, 1]) for (const p of W.data.pistes) {
      if (p.area || p.pts.length < 2) continue;
      path(p.pts);
      if (!pass) { c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = wide + 2.2; }
      else { c.strokeStyle = this.cols[p.diff]; c.lineWidth = wide; c.setLineDash(p.groom ? [] : [wide * 2.2, wide * 1.6]); }
      c.stroke();
    }
    c.setLineDash([]);
    // closed and disused runs dark red and dashed; the ski area's boundary a dark red dashed line
    c.setLineDash([6, 5]); c.lineWidth = 1.6; c.strokeStyle = 'rgba(139,0,0,.9)';
    for (const b of W.data.bounds) if (b.pts.length > 1) { path(b.pts); c.stroke(); }
    for (const p of W.data.closed) if (p.pts.length > 1) { path(p.pts); c.lineWidth = 2.4; c.stroke(); }
    c.setLineDash([]);
    // the lifts: dark lines with a white edge, the stations as squares
    for (const pass of [0, 1]) for (const L of W.data.lifts) {
      if (L.pts.length < 2) continue;
      path(L.pts); c.strokeStyle = pass ? '#2a2f36' : 'rgba(255,255,255,.9)'; c.lineWidth = pass ? 1.6 : 3.6; c.stroke();
      if (pass) for (const e of [L.pts[0], L.pts[L.pts.length - 1]]) { const [x, y] = this.toScreen(e.x, e.z); c.fillStyle = '#2a2f36'; c.fillRect(x - 3, y - 3, 6, 6); }
    }
    // names: the lifts' and the runs' at their middles, once zoomed in enough to read them
    if (v.mpp < 9) {
      c.font = '600 12px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const used = [];
      const label = (pts, text, col) => {
        if (!text) return; const m = pts[Math.floor(pts.length / 2)], [x, y] = this.toScreen(m.x, m.z);
        if (x < 0 || y < 0 || x > r.width || y > r.height) return;
        const w = c.measureText(text).width + 8;
        if (used.some(u => Math.abs(u[0] - x) < (u[2] + w) / 2 && Math.abs(u[1] - y) < 16)) return;
        used.push([x, y, w]);
        c.fillStyle = 'rgba(13,27,42,.78)'; c.fillRect(x - w / 2, y - 9, w, 18);
        c.fillStyle = col || '#fff'; c.fillRect(x - w / 2, y - 9, 3, 18);
        c.fillStyle = '#fff'; c.fillText(text, x + 1, y + 0.5);
      };
      for (const L of W.data.lifts) label(L.pts, L.name, '#9fc6e8');
      for (const p of W.data.pistes) if (p.name) label(p.pts, p.name, this.cols[p.diff]);
    }
    // huts, restaurants and lodges: dots (their names under the pointer)
    for (const pl of W.data.places) { const [x, y] = this.toScreen(pl.x, pl.z); if (x < -5 || y < -5 || x > r.width + 5 || y > r.height + 5) continue; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fillStyle = pl.kind === 'hotel' ? '#6d4ca8' : '#b8641c'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); }
    // you: an arrow along the way you face
    const sk = this.g.skier, [px, py] = this.toScreen(sk.p.x, sk.p.z), f = sk.fwd || { x: 0, z: 1 }, a = Math.atan2(f.x, f.z);
    c.save(); c.translate(px, py); c.rotate(-a);
    c.beginPath(); c.moveTo(0, 11); c.lineTo(7, -7); c.lineTo(0, -3); c.lineTo(-7, -7); c.closePath();
    c.fillStyle = '#ff6a13'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); c.restore();
  }
  // the nearest run or lift under the pointer, in a tooltip
  nearest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const L of this.lines) for (let i = 0; i < L.pts.length - 1; i++) {
      const a = L.pts[i], b = L.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  }
  hover(mx, my) {
    const p = this.toWorld(mx, my), tip = this.tip;
    let L = this.nearest(p.x, p.z, 10 * this.view.mpp);
    for (const pl of this.W.data.places) if (Math.hypot(pl.x - p.x, pl.z - p.z) < 8 * this.view.mpp) { L = { name: pl.name, sub: { hut: 'Mountain hut', lodge: 'Ski lodge', hotel: 'Hotel or lodging' }[pl.kind] || 'Mountain restaurant' }; break; }
    const inside = this.W.land.elev.inFine(p.x, p.z, 40);
    const y = Math.round(this.W.land.elev.at(p.x, p.z));
    tip.innerHTML = (L ? `${esc(L.name)}<small>${esc(L.sub)}</small><small>Here: ${y} m above the sea</small>` : `${y} m above the sea`) + (inside ? '' : '<small>Outside the built area: a click builds it</small>');
    tip.style.left = mx + 'px'; tip.style.top = my + 'px'; tip.hidden = false;
  }
  /* the corner map while riding (Leonski 2's minimap): the shading, the runs and lifts round you, 1.2 km across (0.9 on a
     small screen), redrawn four times a second; a click on it opens the trail map. Not on touch screens, whose buttons
     are there, nor while watching others. */
  mini(hud, open) {
    const el = document.createElement('canvas'); el.className = 'wmini'; el.title = 'Trail map'; el.setAttribute('aria-label', 'Trail map'); el.setAttribute('role', 'button');
    hud.appendChild(el);
    el.addEventListener('click', open);
    const lines = this.allLines(); let t = 0;
    this.build();      // (the shading, once)
    return (dt, sk) => {
      t -= dt; if (t > 0) return; t = 0.25;
      const S = el.clientWidth || 150, dpr = Math.min(2, devicePixelRatio || 1);
      if (!S || el.offsetParent === null) return;
      if (el.width !== Math.round(S * dpr)) { el.width = el.height = Math.round(S * dpr); }
      const c = el.getContext('2d'), span = S < 140 ? 900 : 1200, k = S / span, cx = sk.p.x, cz = sk.p.z, B = this.box;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#0d1b2a'; c.fillRect(0, 0, S, S);
      const st = B.s / this.N;
      c.drawImage(this.base, (cx - span / 2 - B.x0) / st, (cz - span / 2 - B.z0) / st, span / st, span / st, 0, 0, S, S);
      const X = x => (x - cx) * k + S / 2, Z = z => (z - cz) * k + S / 2, h = span / 2 + 20;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const L of lines) {
        if (L.x1 < cx - h || L.x0 > cx + h || L.z1 < cz - h || L.z0 > cz + h) continue;
        c.beginPath(); L.pts.forEach((q, i) => i ? c.lineTo(X(q.x), Z(q.z)) : c.moveTo(X(q.x), Z(q.z)));
        if (L.kind === 'lift') { c.strokeStyle = '#2a2f36'; c.lineWidth = 1.4; c.setLineDash([]); }
        else { c.strokeStyle = L.col; c.lineWidth = 2.2; c.setLineDash(L.groom ? [] : [4, 3]); }
        c.stroke();
      }
      c.setLineDash([]);
      const f = sk.fwd, a = Math.atan2(f.x, f.z);
      c.save(); c.translate(S / 2, S / 2); c.rotate(-a);
      c.beginPath(); c.moveTo(0, 8); c.lineTo(5, -5); c.lineTo(0, -2); c.lineTo(-5, -5); c.closePath();
      c.fillStyle = '#ff6a13'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    };
  }
  click(mx, my) {
    const p = this.toWorld(mx, my);
    if (this.W.land.elev.inFine(p.x, p.z, 40)) { this.el.classList.add('hidden'); this.open_ = false; this.g.drop(p.x, p.z); return; }
    // outside: build that part, the page started again round it
    if (!confirm('That part of the mountain is not built yet. Build it now? The game starts again there (it takes a few seconds).')) return;
    try { sessionStorage.setItem('ski_wdrop', JSON.stringify({ id: this.W.id, x: p.x, z: p.z, at: Date.now() })); } catch (e) {}
    location.reload();
  }
}
