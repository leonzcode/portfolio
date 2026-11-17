/* (W, round 10) Any mountain on Earth: the trail map, from the pause menu or the corner map.
   (W11 trail, 2026-11-14, for Leon's "make it so that you can ride any lift from the map by clicking on it and make the
   map better and look more like the mountain and also more easy to navigate around")
   - The mountain is drawn from its own elevation, as a winter relief map of our own: the slopes lit from the north-west
     (with a softer light from the west and the sky), snow white in the sun and cold blue in the shade, rock on the
     faces too steep to hold snow, contour lines (closer together the further you zoom in), the forest drawn as small
     trees, lakes and rock where OpenStreetMap maps them. It is drawn in square tiles at the zoom you look at, a tile a
     few milliseconds (Relief): opening the map never holds a frame up, and zooming in sharpens the mountain rather than
     blowing up one picture.
   - The runs in the colours of the slopes' own signs (green, blue, black in the Americas and Oceania; green, blue, red,
     black elsewhere) with their real widths, named along their lines; the lifts as cables with their towers and
     stations, named; the parks and the features the game made; huts and restaurants; you and the others in a room.
   - Click a lift and you ride it: the ground round its bottom station is made ready, you are put on its load line and
     the chair takes you up (any key sends it straight up, as always). On a touch screen the first tap shows the lift's
     card with a Ride button (a stray tap while panning should not send you off). A lift that cannot be ridden here says
     why on its card: outside the part of the mountain that is built (the card builds that part and puts you on the lift
     once the game is up), too short or a rope tow, or one of more lifts than the game builds at once.
   - Click a run or a place for its card: start at the top of the run, or there. Click open snow to drop in there.
   - Drag to pan, wheel or pinch to zoom (at the pointer), the + and - buttons, the arrow keys, Centre on me, a search
     and list of every lift, run and place that flies to it, a key, Esc to close. */
import { originOf } from './wplaces.js?v=31';
import { kindName } from './wlift.js?v=31';

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
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// a number 0..1 from whole numbers (the same everywhere for the same numbers: trees and grain line up across tiles)
const hash = (i, j, s) => { let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const km = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
// (the fly mode ends before you are put anywhere from the map)
const stopFly = () => { try { if (window.__skiFly && window.__skiFly.on) window.__skiFly.stop({ place: false }); } catch (e) {} };

/* ---- the mountain's picture, in tiles -----------------------------------------------------------------------------------
   Zoom level z: a tile is 256 pixels of M0 / 2^z metres (z 0: 64 m a pixel, 16 km a tile; z 7: half a metre). Tile (i, j)
   covers local x from i * 256 * mpp, z likewise. Each is drawn from heights read every second pixel (the gradient worked
   out there and eased between), so a tile is about 18 000 readings of the elevation and a few milliseconds. Kept in a
   cache (the least recently drawn go first); a tile not made yet is drawn from a coarser one meanwhile. */
const TS = 256, STEP = 2, NG = TS / STEP + 5, M0 = 64, ZMAX = 7, DS = 8, ND = TS / DS + 3;
// a small picture (pixels {w, h, d}) laid over a tile's pixels d with its own alpha, its foot near (px, py)
function stamp(d, s, px, py) {
  const sx = px - Math.round(s.w * 0.45), sy = py - Math.round(s.h * 0.8), sd = s.d;
  for (let yy = 0; yy < s.h; yy++) {
    const ty = sy + yy; if (ty < 0 || ty >= TS) continue;
    for (let xx = 0; xx < s.w; xx++) {
      const tx = sx + xx; if (tx < 0 || tx >= TS) continue;
      const so = (yy * s.w + xx) * 4, a = sd[so + 3]; if (!a) continue;
      const k = (ty * TS + tx) * 4, f = a / 255;
      d[k] += (sd[so] - d[k]) * f; d[k + 1] += (sd[so + 1] - d[k + 1]) * f; d[k + 2] += (sd[so + 2] - d[k + 2]) * f;
    }
  }
}
const contourI = mpp => mpp <= 2.2 ? 20 : mpp <= 6 ? 50 : mpp <= 16 ? 100 : mpp <= 40 ? 200 : 0;
// the grid's place for each column of a tile's pixels: the node to its left and how far on (heights every STEP, forest every DS)
const COL_A = new Int32Array(TS), COL_U = new Float32Array(TS), COL_D = new Int32Array(TS), COL_V = new Float32Array(TS);
for (let px = 0; px < TS; px++) { const fa = px / STEP + 2, fd = px / DS + 1; COL_A[px] = fa | 0; COL_U[px] = fa - (fa | 0); COL_D[px] = fd | 0; COL_V[px] = fd - (fd | 0); }
function treeSprites(s) {
  // a small conifer: two tiers, lit on its west side, its shadow to the south-east (our own drawing)
  const make = (lit, dark, k) => {
    // (a canvas kept in memory, not on the graphics card: reading it back never waits for the card)
    const w = Math.ceil(10 * s * k), h = Math.ceil(13 * s * k), c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.scale(s * k, s * k);
    x.fillStyle = 'rgba(46,70,108,.26)'; x.beginPath(); x.ellipse(6.2, 10.6, 3.6, 1.3, 0, 0, 7); x.fill();
    const tiers = [[4.5, 0.2, 7.2, 5.4, 1.8], [4.5, 2.6, 8.4, 9.4, 0.6]];
    for (const [cx, top, r, bot, l] of tiers) {
      x.fillStyle = dark; x.beginPath(); x.moveTo(cx, top); x.lineTo(r, bot); x.lineTo(l, bot); x.closePath(); x.fill();
      x.save(); x.beginPath(); x.rect(0, 0, cx, 13); x.clip(); x.fillStyle = lit; x.beginPath(); x.moveTo(cx, top); x.lineTo(r, bot); x.lineTo(l, bot); x.closePath(); x.fill(); x.restore();
    }
    x.fillStyle = '#4a3a2f'; x.fillRect(4.1, 9.4, 0.8, 1.4);
    return { c, w, h, d: x.getImageData(0, 0, w, h).data };
  };
  return [make('#4f7d62', '#26493b', 1), make('#45735a', '#203f33', 0.86), make('#5a8669', '#2c5243', 1.12)];
}
class Relief {
  constructor(W, lo, hi, tl, scale) {
    this.W = W; this.elev = W.land.elev; this.lo = lo; this.hi = Math.max(lo + 100, hi); this.tl = tl; this.s = scale;
    this.cache = new Map(); this.cap = 150; this.now = []; this.pre = []; this.made = 0; this.ms = 0; this.worst = 0; this.stepWorst = 0; this.job = null;
    this.H = new Float32Array(NG * NG); this.GX = new Float32Array(NG * NG); this.GZ = new Float32Array(NG * NG); this.D = new Float32Array(ND * ND);
    this.img = new ImageData(TS, TS); this.trees = treeSprites(scale);
    this.sig = this.sourceSig(); this.osm = null;
  }
  // what the forest and the rest come from (when that changes, the tiles are drawn again)
  sourceSig() { const W = this.W; return [!!W.wood, W.woodSrc || '', !!W.osmLand, !!W.cover].join('|'); }
  check() { const s = this.sourceSig(); if (s !== this.sig) { this.sig = s; this.cache.clear(); this.osm = null; return true; } return false; }
  key(z, i, j) { return z * 1e8 + (i + 5000) * 1e4 + (j + 5000); }
  level(mpp, dpr) { return clamp(Math.ceil(Math.log2(M0 * dpr / mpp) - 0.3), 0, ZMAX); }
  get(z, i, j) { const k = this.key(z, i, j), t = this.cache.get(k); if (t) { this.cache.delete(k); this.cache.set(k, t); } return t; }
  has(z, i, j) { return this.cache.has(this.key(z, i, j)); }
  // the shapes OpenStreetMap gives for the land (water, rock, cliffs, woods), with their boxes, once
  /* (wlanddata.js keeps each kind apart: wood, scrub, water, rock, scree, glacier as lists of ring sets, cliff as lines;
     the older shape, woods/rock/cliffs with a kind on each, is read too) */
  osmShapes() {
    if (this.osm !== null) return this.osm;
    const L = this.W.osmLand; if (!L) return (this.osm = false);
    const poly = (list, kind) => (list || []).map(e => Array.isArray(e) ? { kind, rings: e } : Object.assign({ kind }, e));
    const line = list => (list || []).map(e => Array.isArray(e) ? { pts: e } : e);
    const boxed = list => list.map(e => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const r of e.rings || (e.pts ? [e.pts] : [])) for (const p of r) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
      return Object.assign({ x0, x1, z0, z1 }, e);
    }).filter(e => e.x0 <= e.x1);
    return (this.osm = {
      woods: boxed(L.woods ? poly(L.woods, 'wood') : [...poly(L.wood, 'wood'), ...poly(L.scrub, 'scrub')]),
      water: boxed(poly(L.water, 'water')),
      rock: boxed(L.rock && L.rock.length && !Array.isArray(L.rock[0]) && L.rock[0].kind ? poly(L.rock) : [...poly(L.rock, 'bare_rock'), ...poly(L.scree, 'scree'), ...poly(L.glacier, 'glacier')]),
      cliffs: boxed(line(L.cliffs || L.cliff)),
    });
  }
  /* the tiles a view needs (z, and the range), as drawn now: each from its own tile, or meanwhile from a coarser one (or
     the finer ones, zooming out); the missing ones are wanted, nearest the middle first. ctx in device pixels. */
  drawTiles(ctx, v, w, h, dpr, list = 'now') {
    const z = this.level(v.mpp, dpr), mpp = M0 / 2 ** z, S = TS * mpp;
    const x0 = v.cx - w / 2 * v.mpp, x1 = v.cx + w / 2 * v.mpp, z0 = v.cz - h / 2 * v.mpp, z1 = v.cz + h / 2 * v.mpp;
    const i0 = Math.floor(x0 / S), i1 = Math.floor(x1 / S), j0 = Math.floor(z0 / S), j1 = Math.floor(z1 / S);
    const want = [], k = dpr / v.mpp;
    const X = x => Math.round((x - x0) * k), Y = zz => Math.round((zz - z0) * k);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X(i * S), dy = Y(j * S), dw = X((i + 1) * S) - dx, dh = Y((j + 1) * S) - dy;
      const t = this.get(z, i, j);
      if (t) { ctx.drawImage(t, dx, dy, dw, dh); continue; }
      want.push([z, i, j, Math.hypot((i + 0.5) * S - v.cx, (j + 0.5) * S - v.cz)]);
      // a coarser tile's quarter (or smaller part)
      let done = false;
      for (let za = z - 1; za >= Math.max(0, z - 5) && !done; za--) {
        const sub = 2 ** (z - za), ia = Math.floor(i / sub), ja = Math.floor(j / sub), ta = this.get(za, ia, ja);
        if (!ta) continue;
        const u = ((i % sub) + sub) % sub, vv = ((j % sub) + sub) % sub, part = TS / sub;
        ctx.drawImage(ta, u * part, vv * part, part, part, dx, dy, dw, dh); done = true;
      }
      // zooming out: the four finer ones, if they are all there
      if (!done && z < ZMAX) {
        const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => this.get(z + 1, i * 2 + a, j * 2 + b));
        if (c.every(Boolean)) c.forEach((t2, n) => { const a = n & 1, b = n >> 1; ctx.drawImage(t2, dx + a * dw / 2, dy + b * dh / 2, dw / 2, dh / 2); });
      }
    }
    want.sort((a, b) => a[3] - b[3]);
    this[list] = want;
    return want.length;
  }
  /* the next tiles' work for up to ms milliseconds: a tile is made in steps of about a millisecond (render is a
     generator), so a slice while riding never holds a frame up; the view's tiles first, then the ones made ahead */
  pump(ms) {
    const t0 = performance.now(), until = t0 + ms; let done = 0;
    while (performance.now() < until) {
      if (!this.job) {
        const nx = this.next(); if (!nx) break;
        this.job = { it: this.render(nx[0], nx[1], nx[2]), ms: 0 };
      }
      const J = this.job, t0 = performance.now(), r = J.it.next(), dt = performance.now() - t0;
      J.ms += dt; if (dt > this.stepWorst) this.stepWorst = dt;
      // (how long each kind of step takes: [count, total, longest], for the tests)
      const P = this.prof || (this.prof = {}), lb = r.done ? 'finish' : r.value || '?', e = P[lb] || (P[lb] = [0, 0, 0]); e[0]++; e[1] += dt; if (dt > e[2]) e[2] = dt;
      if (r.done) { this.job = null; done++; this.made++; this.ms += J.ms; if (J.ms > this.worst) this.worst = J.ms; }
    }
    const sl = performance.now() - t0; if (sl > (this.sliceWorst || 0)) this.sliceWorst = sl;
    return done;
  }
  next() { for (const L of [this.now, this.pre]) while (L.length) { const t = L.shift(); if (!this.has(t[0], t[1], t[2])) return t; } return null; }
  busy() { return (this.job ? 1 : 0) + this.now.length + this.pre.length; }
  // forest cover 0..1 at a local point: the world's own model, else the satellite's cover, else none (h: the height)
  woodAt(x, z, h) {
    const W = this.W;
    if (W.wood && W.wood.at) { const c = W.wood.at(x, z); return c > 0 ? Math.min(1, c) : 0; }
    if (W.cover && W.cover.at) { const c = W.cover.at(x, z); return c > 0 ? Math.min(1, c) : 0; }
    // (nothing known of the forest: below the treeline, thinning out towards it)
    return this.tl ? 0.75 * (1 - sstep(this.tl - 260, this.tl + 20, h)) : 0;
  }
  // the tree pictures as pixels, for stamping into a tile (a few hundred thousand pixel blends a tile, not a thousand draws)
  treePix() {
    if (this.tp) return this.tp;
    return (this.tp = this.trees.map(t => ({ w: t.w, h: t.h, d: t.d })));
  }
  /* a tile, a step at a time: the generator only puts the steps in order, each step is a plain method (a loop inside a
     generator runs a good deal slower) */
  *render(z, i, j) {
    const mpp = M0 / 2 ** z, ve = clamp(1 + 0.3 * Math.log2(Math.max(1, mpp / 4)), 1, 2.1);
    const t = { z, i, j, mpp, S: TS * mpp, x0: i * TS * mpp, z0: j * TS * mpp, ve, gs: 1 / ve, osm: this.osmShapes(), M: null, wmask: null };
    // the heights at the grid's nodes (a node every STEP pixels, two beyond each edge)
    for (let b = 0; b < NG; b += 16) { this.heightRows(t, b, Math.min(NG, b + 16)); yield 'heights'; }
    // their slopes (steepened a little when zoomed out, where the coarser elevation flattens the relief)
    this.slopes(t); yield 'slopes';
    /* the forest on a coarser grid (a node every DS pixels, one beyond each edge): the trees and the snow under them.
       (The mapped woods filled in here, from their shapes: W.wood.at reads the game's own forest raster, made a tile at
       a time and kept in a small cache the trees round you use; reading the whole map through it would push theirs out.) */
    if (t.osm && t.osm.woods.length) t.wmask = this.woodMask(t.osm.woods, t.x0, t.z0, mpp);
    for (let b = 0; b < ND; b += 6) { this.forestRows(t, b, Math.min(ND, b + 6)); yield 'forest'; }
    // the lakes, bare rock, scree and glaciers OpenStreetMap maps, as the tile's own pixels (null: none here)
    t.M = t.osm ? this.landMask(t.osm, t.x0, t.z0, mpp) : null;
    yield 'land';
    for (let py = 0; py < TS; py += 32) { this.pixRows(t, py, Math.min(TS, py + 32)); yield 'pixels'; }
    // the trees: a world-aligned grid a few pixels apart, each kept by the forest's cover there, top rows first
    if (mpp <= 16) {
      const sp = 7 * this.s * mpp, m = 12 * this.s * mpp;
      const cj0 = Math.floor((t.z0 - m) / sp), cj1 = Math.floor((t.z0 + t.S + m) / sp);
      for (let cj = cj0; cj <= cj1; cj += 10) { this.treeRows(t, sp, m, cj, Math.min(cj1 + 1, cj + 10)); yield 'trees'; }
    }
    this.finish(t);
  }
  heightRows(t, b0, b1) {
    const H = this.H, el = this.elev, mpp = t.mpp, x0 = t.x0, z0 = t.z0;
    for (let b = b0; b < b1; b++) { const zz = z0 + ((b - 2) * STEP + 0.5) * mpp, o = b * NG; for (let a = 0; a < NG; a++) H[o + a] = el.at(x0 + ((a - 2) * STEP + 0.5) * mpp, zz); }
  }
  slopes(t) {
    const H = this.H, GX = this.GX, GZ = this.GZ, k2 = t.ve / (2 * STEP * t.mpp);
    for (let b = 1; b < NG - 1; b++) for (let a = 1; a < NG - 1; a++) { const o = b * NG + a; GX[o] = (H[o + 1] - H[o - 1]) * k2; GZ[o] = (H[o + NG] - H[o - NG]) * k2; }
  }
  forestRows(t, b0, b1) {
    const H = this.H, D = this.D, mpp = t.mpp, wm = t.wmask;
    for (let b = b0; b < b1; b++) for (let a = 0; a < ND; a++) {
      if (wm) { D[b * ND + a] = wm[b * ND + a]; continue; }
      const px = (a - 1) * DS, py = (b - 1) * DS;
      const hh = H[clamp(Math.round(py / STEP + 2), 0, NG - 1) * NG + clamp(Math.round(px / STEP + 2), 0, NG - 1)];
      D[b * ND + a] = this.woodAt(t.x0 + (px + 0.5) * mpp, t.z0 + (py + 0.5) * mpp, hh);
    }
  }
  // every pixel of rows py0 to py1: the light on the slope, snow or rock, the forest's shade, contours, mapped land
  pixRows(t, py0, py1) {
    const H = this.H, GX = this.GX, GZ = this.GZ, D = this.D, d = this.img.data, mpp = t.mpp, z = t.z, gs = t.gs;
    const lo = this.lo, span = this.hi - this.lo, I = contourI(mpp), Ii = I ? 1 / I : 0;
    const Md = t.M && t.M.d, Mg = t.M && t.M.g, gi = t.i * TS, gj = t.j * TS;
    for (let py = py0; py < py1; py++) {
      const fb = py / STEP + 2, b0 = fb | 0, vb = fb - b0, vb1 = 1 - vb;
      const db = py / DS + 1, e0 = db | 0, ve2 = db - e0, ve1 = 1 - ve2;
      for (let px = 0; px < TS; px++) {
        const a0 = COL_A[px], ua = COL_U[px], o = b0 * NG + a0;
        const w00 = (1 - ua) * vb1, w10 = ua * vb1, w01 = (1 - ua) * vb, w11 = ua * vb;
        const h = H[o] * w00 + H[o + 1] * w10 + H[o + NG] * w01 + H[o + NG + 1] * w11;
        const gx = GX[o] * w00 + GX[o + 1] * w10 + GX[o + NG] * w01 + GX[o + NG + 1] * w11;
        const gz = GZ[o] * w00 + GZ[o + 1] * w10 + GZ[o + NG] * w01 + GZ[o + NG + 1] * w11;
        const g2 = gx * gx + gz * gz, inv = 1 / Math.sqrt(1 + g2);
        // light: the sun from the north-west, a softer one from the west, and the sky
        const d1 = (0.5 * gx + 0.7071 + 0.5 * gz) * inv, d2 = (0.7071 * gx + 0.7071) * inv;
        const s = ((d1 > 0 ? 0.6 * d1 : 0) + (d2 > 0 ? 0.16 * d2 : 0) + 0.3 * inv) * 1.195, sl1 = s < 1 ? s : 1;
        // snow: blue in the shade, white in the sun, a little haze down in the valleys
        let r, g, bl;
        if (s < 1) { const u = s * (0.8 + 0.2 * s); r = 112 + 126 * u; g = 134 + 109 * u; bl = 172 + 76 * u; }
        else { const u = s > 1.2857 ? 1 : (s - 1) * 3.5; r = 238 + 14 * u; g = 243 + 10 * u; bl = 248 + 6 * u; }
        const e = (h - lo) / span, hz = e <= 0 ? 0.2 : e >= 1 ? 0 : (1 - e) * 0.2;
        r += (206 - r) * hz; g += (214 - g) * hz; bl += (222 - bl) * hz;
        // rock on faces too steep to hold the snow (about 38 to 46 degrees), with a grain
        const sl = Math.sqrt(g2) * gs;
        let rk = 0; if (sl > 0.78) { if (sl >= 1.05) rk = 1; else { const u = (sl - 0.78) / 0.27; rk = u * u * (3 - 2 * u); } }
        const k = (py * TS + px) << 2;
        let wa = 0;
        if (Md) {
          const ma = Md[k + 3] / 65025;
          if (ma > 0) {
            wa = Md[k] * ma;
            const ra = Md[k + 1] * ma, sa = Md[k + 2] * ma;
            if (ra > 0.02 && ra * 0.85 > rk) rk = ra * 0.85;
            if (sa > 0.02) { const hs = hash(gi + px, gj + py, 5), u = sa * (hs < 0.07 ? 0.5 : 0.38), sc = (hs < 0.07 ? 0.62 : 0.84) * (0.6 + 0.4 * sl1); r += (184 * sc - r) * u; g += (176 * sc - g) * u; bl += (168 * sc - bl) * u; }
          }
          if (Mg) { const ga = Mg[k + 3] / 255 * 0.7; if (ga > 0.01) { r += (178 + 50 * sl1 - r) * ga; g += (214 + 30 * sl1 - g) * ga; bl += (238 + 14 * sl1 - bl) * ga; } }
        }
        if (rk > 0) {
          const gr = (hash(gi + px, gj + py, z) - 0.5) * 22;
          r += (96 + 98 * sl1 + gr - r) * rk; g += (88 + 92 * sl1 + gr - g) * rk; bl += (86 + 82 * sl1 + gr - bl) * rk;
        }
        // the snow among trees is greyer
        const pd0 = COL_D[px], uD = COL_V[px], oD = e0 * ND + pd0;
        const dn = (D[oD] * (1 - uD) + D[oD + 1] * uD) * ve1 + (D[oD + ND] * (1 - uD) + D[oD + ND + 1] * uD) * ve2;
        if (dn > 0.05) { const u = (dn * 0.34 < 0.32 ? dn * 0.34 : 0.32) * (1 - rk); r += (168 - r) * u; g += (184 - g) * u; bl += (180 - bl) * u; }
        // contours: a line of even width at every level (thicker every fifth), thinned where they crowd
        if (I && wa < 0.5 && sl > 0.02) {
          const q = h * Ii, fq = Math.floor(q), f = q - fq, dv = (f < 0.5 ? f : 1 - f) * I, sm = 1 / (sl * mpp);
          const gap = I * sm, dpx = dv * sm, major = (f < 0.5 ? fq : fq + 1) % 5 === 0;
          let a = 1 - dpx / (major ? 1.15 : 0.8);
          if (a > 0 && gap > 2.2) {
            if (gap < 5) { const u = (gap - 2.2) / 2.8; a *= u * u * (3 - 2 * u); }
            a *= major ? 0.5 : 0.3;
            const cr = rk > 0.5 ? 70 : 52, cg = rk > 0.5 ? 58 : 90, cb = rk > 0.5 ? 52 : 138; r += (cr - r) * a; g += (cg - g) * a; bl += (cb - bl) * a;
          }
        }
        // lakes: flat frozen water over all of it
        if (wa > 0.01) { r += (196 - r) * wa; g += (219 - g) * wa; bl += (235 - bl) * wa; }
        d[k] = r; d[k + 1] = g; d[k + 2] = bl; d[k + 3] = 255;
      }
    }
  }
  // the trees of grid rows cj0 to cj1
  treeRows(t, sp, m, cj0, cj1) {
    const D = this.D, GX = this.GX, GZ = this.GZ, d = this.img.data, T = this.treePix(), sd = t.z * 11, x0 = t.x0, z0 = t.z0, mpp = t.mpp, gs = t.gs, Md = t.M && t.M.d;
    const ci0 = Math.floor((x0 - m) / sp) - 1, ci1 = Math.floor((x0 + t.S + m) / sp);
    for (let cj = cj0; cj < cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const wx = (ci + 0.5 + (cj & 1) * 0.5 + (hash(ci, cj, sd + 1) - 0.5) * 0.7) * sp, wz = (cj + 0.5 + (hash(ci, cj, sd + 2) - 0.5) * 0.7) * sp;
      const px = (wx - x0) / mpp, py = (wz - z0) / mpp;
      const ua = clamp(px / DS + 1, 0, ND - 1.001), vb = clamp(py / DS + 1, 0, ND - 1.001), a0 = ua | 0, b0 = vb | 0, fu = ua - a0, fv = vb - b0, o = b0 * ND + a0;
      const dn = (D[o] * (1 - fu) + D[o + 1] * fu) * (1 - fv) + (D[o + ND] * (1 - fu) + D[o + ND + 1] * fu) * fv;
      if (dn < 0.08 || hash(ci, cj, sd + 3) > dn * 0.9 - 0.06) continue;
      // (none on the faces where rock shows, nor on a lake or mapped rock)
      const gb = clamp(Math.round(py / STEP + 2), 1, NG - 2) * NG + clamp(Math.round(px / STEP + 2), 1, NG - 2);
      if (Math.hypot(GX[gb], GZ[gb]) * gs > 0.85) continue;
      if (Md) { const q = (clamp(Math.round(py), 0, TS - 1) * TS + clamp(Math.round(px), 0, TS - 1)) * 4, ma = Md[q + 3] / 65025; if ((Md[q] + Md[q + 1]) * ma > 0.35) continue; }
      stamp(d, T[(hash(ci, cj, sd + 4) * T.length) | 0], Math.round(px), Math.round(py));
    }
  }
  // the picture, the lakes' edges and the cliffs drawn over it, into the cache
  finish(t) {
    // (in memory, not on the graphics card, so nothing here waits for it; the map's own canvas sends it up once, when drawn)
    const cv = new OffscreenCanvas(TS, TS), x = cv.getContext('2d', { willReadFrequently: true }), mpp = t.mpp, M = t.M, osm = t.osm;
    x.putImageData(this.img, 0, 0);
    if (M && M.water.length) {
      const k = 1 / mpp; x.save(); x.setTransform(k, 0, 0, k, -t.x0 * k, -t.z0 * k); x.lineWidth = 1.1 * mpp; x.strokeStyle = '#6f9cc2';
      for (const e of M.water) { x.beginPath(); for (const r of e.rings) r.forEach((p, n) => n ? x.lineTo(p.x, p.z) : x.moveTo(p.x, p.z)); x.stroke(); }
      x.restore();
    }
    if (osm && osm.cliffs.length) this.cliffDraw(x, osm.cliffs, t.x0, t.z0, mpp, t.S);
    const pic = typeof cv.transferToImageBitmap === 'function' ? cv.transferToImageBitmap() : cv;
    this.cache.set(this.key(t.z, t.i, t.j), pic);
    while (this.cache.size > this.cap) { const k0 = this.cache.keys().next().value, old = this.cache.get(k0); this.cache.delete(k0); if (old && old.close) old.close(); }
  }
  // the woods' shapes filled into the tile's forest grid (wood 1, scrub a half)
  woodMask(woods, x0, z0, mpp) {
    const c = this.mc || (this.mc = new OffscreenCanvas(ND, ND)), x = c.getContext('2d', { willReadFrequently: true }), S = TS * mpp, pad = DS * mpp * 2;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, ND, ND);
    // (node a, at pixel (a - 1) * DS of the tile, lands in the middle of the mask's pixel a)
    const k = 1 / (DS * mpp), o = 1.5 - 0.5 / DS;
    x.setTransform(k, 0, 0, k, o - x0 * k, o - z0 * k);
    let any = false;
    for (const wd of woods) {
      if (wd.x1 < x0 - pad || wd.x0 > x0 + S + pad || wd.z1 < z0 - pad || wd.z0 > z0 + S + pad) continue;
      x.beginPath(); for (const r of wd.rings) r.forEach((p, n) => n ? x.lineTo(p.x, p.z) : x.moveTo(p.x, p.z));
      x.fillStyle = wd.kind === 'scrub' ? 'rgba(0,0,0,.5)' : '#000'; x.fill('evenodd'); any = true;
    }
    const out = this.mo || (this.mo = new Float32Array(ND * ND));
    if (!any) { out.fill(0); return out; }
    const px = x.getImageData(0, 0, ND, ND).data;
    for (let n = 0; n < ND * ND; n++) out[n] = px[n * 4 + 3] / 255;
    return out;
  }
  /* the lakes (red), bare rock (green) and scree (blue) over a tile filled into one picture of its pixels, read back once
     (a channel times the alpha over 255 squared is the cover); glaciers into a second only where there are any. null when
     none of them reach the tile. */
  landMask(osm, x0, z0, mpp) {
    const S = TS * mpp, pad = 4 * mpp, near = e => !(e.x1 < x0 - pad || e.x0 > x0 + S + pad || e.z1 < z0 - pad || e.z0 > z0 + S + pad);
    const water = osm.water.filter(near), rock = osm.rock.filter(near);
    if (!water.length && !rock.length) return null;
    const k = 1 / mpp, fill = (x, list, col) => { x.fillStyle = col; for (const e of list) { x.beginPath(); for (const r of e.rings) r.forEach((p, n) => n ? x.lineTo(p.x, p.z) : x.moveTo(p.x, p.z)); x.fill('evenodd'); } };
    const c = this.lc || (this.lc = new OffscreenCanvas(TS, TS)), x = c.getContext('2d', { willReadFrequently: true });
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, TS, TS);
    x.setTransform(k, 0, 0, k, -x0 * k, -z0 * k); x.globalCompositeOperation = 'lighter';
    fill(x, water, '#f00'); fill(x, rock.filter(e => e.kind !== 'scree' && e.kind !== 'glacier'), '#0f0'); fill(x, rock.filter(e => e.kind === 'scree'), '#00f');
    x.globalCompositeOperation = 'source-over';
    const out = { d: x.getImageData(0, 0, TS, TS).data, g: null, water };
    const gl = rock.filter(e => e.kind === 'glacier');
    if (gl.length) {
      const c2 = this.gc || (this.gc = new OffscreenCanvas(TS, TS)), y = c2.getContext('2d', { willReadFrequently: true });
      y.setTransform(1, 0, 0, 1, 0, 0); y.clearRect(0, 0, TS, TS); y.setTransform(k, 0, 0, k, -x0 * k, -z0 * k);
      fill(y, gl, '#000'); out.g = y.getImageData(0, 0, TS, TS).data;
    }
    return out;
  }
  // cliffs: a dark line with short ticks down its lower side (OpenStreetMap draws a cliff with the low side on the right)
  cliffDraw(x, cliffs, x0, z0, mpp, S) {
    const pad = 30 * mpp;
    x.save(); x.lineCap = 'round'; x.strokeStyle = 'rgba(64,52,46,.85)';
    for (const e of cliffs) {
      if (e.x1 < x0 - pad || e.x0 > x0 + S + pad || e.z1 < z0 - pad || e.z0 > z0 + S + pad) continue;
      const P = e.pts.map(p => [(p.x - x0) / mpp, (p.z - z0) / mpp]);
      x.lineWidth = 1.4; x.beginPath(); P.forEach((p, n) => n ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke();
      x.lineWidth = 1; x.beginPath();
      let carry = 0;
      for (let n = 0; n < P.length - 1; n++) {
        const [ax, ay] = P[n], [bx, by] = P[n + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.01) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L, rx = -uy, ry = ux;
        for (let t = carry; t < L; t += 4.5) { const px = ax + ux * t, py = ay + uy * t; x.moveTo(px, py); x.lineTo(px + rx * 3.6, py + ry * 3.6); }
        carry = (carry - L) % 4.5; if (carry < 0) carry += 4.5;
      }
      x.stroke();
    }
    x.restore();
  }
}

/* ---- the map -------------------------------------------------------------------------------------------------------------
   W: the world (wmap.js); g: { skier, drop(x, z), back() (to the pause menu), pause(), play(), lift, terrain, cams, hud,
   others() (the others in a room: net.js's remotes) }. Everything heavy is made a little at a time. */
export class TrailMap {
  constructor(W, g) {
    this.W = W; this.g = g; this.el = $('wtrail'); this.built = false; this.open_ = false;
    const o = originOf(W.place); this.na = NA(o.lat, o.lon); this.cols = trailColours(o.lat, o.lon); this.names = trailNames(o.lat, o.lon);
    // the map covers the runs and lifts (all of them, built or not) and the built area
    const E = W.ext; let x0 = E.x0, x1 = E.x1, z0 = E.z0, z1 = E.z1;
    for (const L of [W.data.pistes, W.data.lifts]) for (const r of L) for (const p of r.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    // (no further than the elevation's middle layer reaches: about 20 km)
    const me = W.land.elev.mid.extent();
    x0 = Math.max(x0, me.x0 + 200); x1 = Math.min(x1, me.x1 - 200); z0 = Math.max(z0, me.z0 + 200); z1 = Math.min(z1, me.z1 - 200);
    const s = Math.max(x1 - x0, z1 - z0) + 400, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.box = { x0: cx - s / 2, z0: cz - s / 2, s };
    this.view = { cx: (E.x0 + E.x1) / 2, cz: (E.z0 + E.z1) / 2, mpp: 8 };   // (metres a screen pixel)
    this.sel = null; this.hov = null; this.dirty = true; this.miniT = 0; this.idleOn = false; this.chain = null;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    addEventListener('keydown', e => this.key(e), true);
  }
  // ---- the runs, lifts and places, read once (a few milliseconds): what the list, the cards and the pointer use
  prep() {
    if (this.items) return;
    const t0 = performance.now(), W = this.W, el = W.land.elev, plans = W.planned ? W.planned.plans : [];
    const box = pts => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } return { x0, x1, z0, z1 }; };
    const prof = pts => { let len = 0, top = null, bot = null; for (let i = 0; i < pts.length; i++) { const y = el.at(pts[i].x, pts[i].z); if (!top || y > top.y) top = { x: pts[i].x, z: pts[i].z, y, i }; if (!bot || y < bot.y) bot = { x: pts[i].x, z: pts[i].z, y, i }; if (i) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); } return { len, top, bot }; };
    let lo = Infinity, hi = -Infinity;
    // runs: each way, and the named ones grouped (OpenStreetMap often maps a run in several pieces)
    const runs = [], groups = new Map();
    for (const p of W.data.pistes) {
      if (p.pts.length < 2) continue;
      const f = prof(p.pts); lo = Math.min(lo, f.bot.y); hi = Math.max(hi, f.top.y);
      const r = Object.assign({ type: 'run', p, pts: p.pts, col: this.cols[p.diff], diff: p.diff, groom: p.groom, f }, box(p.pts));
      runs.push(r);
      const name = p.name || (p.ref ? 'Run ' + p.ref : '');
      const gk = name ? fold(name) + '|' + p.diff : 'way' + runs.length;
      let G = groups.get(gk);
      if (!G) { G = { type: 'run', name: name || (p.park ? 'Terrain park' : 'A run without a name'), named: !!name, diff: p.diff, col: this.cols[p.diff], park: !!p.park, ways: [], len: 0, top: null, bot: null, groom: true, lit: false, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }; groups.set(gk, G); }
      G.ways.push(r); r.group = G; G.len += f.len; G.groom = G.groom && p.groom; G.lit = G.lit || p.lit;
      if (!G.top || f.top.y > G.top.y) G.top = Object.assign({ way: r }, f.top);
      if (!G.bot || f.bot.y < G.bot.y) G.bot = f.bot;
      G.x0 = Math.min(G.x0, r.x0); G.x1 = Math.max(G.x1, r.x1); G.z0 = Math.min(G.z0, r.z0); G.z1 = Math.max(G.z1, r.z1);
    }
    for (const G of groups.values()) {
      const drop = G.top.y - G.bot.y, deg = Math.atan2(drop, Math.max(1, G.len)) * 180 / Math.PI;
      G.sub = [G.park ? 'Terrain park' : this.names[G.diff], km(G.len), Math.round(drop) + ' m down', deg.toFixed(0) + ' degrees on average', G.groom ? 'groomed' : 'not groomed', G.lit ? 'lit at night' : ''].filter(Boolean).join(' · ');
    }
    // lifts: every one OpenStreetMap has, with the parts the game built of it (a bent lift is built in stretches)
    const lifts = [];
    W.data.lifts.forEach((L, n) => {
      if (L.pts.length < 2) return;
      const f = prof(L.pts); lo = Math.min(lo, f.bot.y); hi = Math.max(hi, f.top.y);
      const parts = []; plans.forEach((P, k) => { if (P.L.src === L) parts.push(k); });
      parts.sort((a, b) => el.at(plans[a].L.bot.x, plans[a].L.bot.z) - el.at(plans[b].L.bot.x, plans[b].L.bot.z));
      const a = L.pts[0], b = L.pts[L.pts.length - 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      let why = '';
      if (!parts.length) why = /funicular|carpet|rope_tow|goods|zip/.test(L.kind || '') ? 'kind' : len < 150 ? 'short' : !(el.inFine(a.x, a.z, 60) && el.inFine(b.x, b.z, 60)) ? 'out' : 'cap';
      // which end is the bottom (the lower one), for the direction of travel
      const up = el.at(a.x, a.z) <= el.at(b.x, b.z);
      const name = L.name || (L.ref ? kindName(L.kind) + ' ' + L.ref : kindName(L.kind));
      const sub = [kindName(L.kind), km(f.len), Math.round(f.top.y - f.bot.y) + ' m up', L.occupancy ? L.occupancy + ' a chair' : '', L.duration ? L.duration + ' min ride' : ''].filter(Boolean).join(' · ');
      lifts.push(Object.assign({ type: 'lift', L, n, name, named: !!L.name, sub, pts: L.pts, parts, why, up, f, len }, box(L.pts)));
    });
    // places: huts, restaurants, lodges
    const KIND = { hut: 'Mountain hut', lodge: 'Ski lodge', hotel: 'Hotel or lodging', restaurant: 'Restaurant', cafe: 'Cafe', bar: 'Bar', fast_food: 'Snack bar', biergarten: 'Beer garden' };
    const places = W.data.places.map(pl => ({ type: 'place', pl, name: pl.name, x: pl.x, z: pl.z, kind: pl.kind, sub: KIND[pl.kind] || 'Mountain restaurant', x0: pl.x, x1: pl.x, z0: pl.z, z1: pl.z }));
    // the area's heights (for the colouring), from a coarse look over the built area too
    const E = W.ext;
    for (let j = 0; j <= 16; j++) for (let i = 0; i <= 16; i++) { const y = el.at(E.x0 + (E.x1 - E.x0) * i / 16, E.z0 + (E.z1 - E.z0) * j / 16); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 3000; }
    const lat = originOf(W.place).lat, sp = W.mtn && W.mtn.spot;
    const tl = sp && Number.isFinite(sp.treeline) ? sp.treeline + (W.land.y0 || 0) : (Math.abs(lat) < 28 ? 3700 : Math.max(300, 3700 - (Math.abs(lat) - 28) * 85 - Math.max(0, Math.abs(lat) - 52) * 40));
    this.relief = new Relief(W, lo, hi, tl, this.dpr);
    this.runs = runs; this.groups = [...groups.values()]; this.lifts = lifts; this.places = places;
    // the list: named things only (an unnamed run is still on the map, its card from a click)
    const coll = new Intl.Collator(undefined, { numeric: true }), ord = (a, b) => coll.compare(a.name, b.name);
    this.items = {
      lift: lifts.slice().sort((a, b) => (a.parts.length ? 0 : 1) - (b.parts.length ? 0 : 1) || ord(a, b)),
      run: this.groups.filter(G => G.named).sort((a, b) => a.diff - b.diff || ord(a, b)),
      place: places.slice().sort(ord),
    };
    this.prepMs = performance.now() - t0;
  }
  // the first view: all the riding (runs and lifts), or the built area if there is none
  fitAll(w, h) {
    let b = this.allBox;
    if (!b) {
      const xs = [], zs = [];
      for (const L of [this.W.data.pistes, this.W.data.lifts]) for (const r of L) for (const p of r.pts) { xs.push(p.x); zs.push(p.z); }
      if (xs.length > 4) { xs.sort((a, c) => a - c); zs.sort((a, c) => a - c); const q = (a, f) => a[Math.floor(f * (a.length - 1))]; b = { x0: q(xs, 0.02), x1: q(xs, 0.98), z0: q(zs, 0.02), z1: q(zs, 0.98) }; }
      else b = this.W.ext;
      this.allBox = b;
    }
    return this.fitView(b, w, h, 0.86);
  }
  /* a view holding box b in the part of the map in sight (on a phone the list's sheet covers the bottom padB pixels: the
     box goes in the middle of what is above it) */
  fitView(b, w, h, k = 0.7, minMpp = 1.5) {
    const pb = this.padB || 0, mpp = clamp(Math.max((b.x1 - b.x0) / (w * k), (b.z1 - b.z0) / ((h - pb) * k)), minMpp, this.maxMpp || 40);
    return { cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2 + pb / 2 * mpp, mpp };
  }
  sheetPad() { return innerWidth <= 760 ? 104 : 0; }

  // ---- the page ------------------------------------------------------------------------------------------------------
  build() {
    if (this.built) return; this.built = true;
    this.prep();
    const el = this.el, W = this.W, it = this.items;
    el.innerHTML = `<div class="wthead"><div class="wttitle"><span class="wtkick">Trail map</span><h2 id="wtname">${esc(W.place.name)}</h2><small>${esc(W.place.sub || '')}</small></div><span class="wtsp"></span><button type="button" class="wtclose" data-act="close" aria-label="Close the trail map">Close <kbd>Esc</kbd></button></div>
<div class="wtbody">
  <div class="wtmap"><canvas aria-label="The trail map of ${esc(W.place.name)}. Click a lift to ride it." role="img"></canvas>
    <div class="wttip" hidden></div>
    <div class="wtctl"><button type="button" data-act="in" aria-label="Zoom in" title="Zoom in (+)">+</button><button type="button" data-act="out" aria-label="Zoom out" title="Zoom out (-)">&minus;</button><button type="button" data-act="me" aria-label="Centre on me" title="Centre on me"><i class="wtme"></i></button><button type="button" data-act="all" aria-label="Show the whole ski area" title="Show the whole ski area"><i class="wtall"></i></button></div>
    <div class="wtscale" aria-hidden="true"><b>N</b><i></i><span></span></div>
    <button type="button" class="wtkeybtn" data-act="key" aria-expanded="false" aria-controls="wtlegend">Key</button>
    <div class="wtlegend" id="wtlegend" hidden></div>
    <div class="wtcard" role="region" aria-live="polite" hidden></div>
    <div class="wtbusy" hidden><i></i><span></span></div>
    <div class="wtcredit">Runs, lifts and land &copy; OpenStreetMap contributors &middot; elevation AWS Terrain Tiles</div>
  </div>
  <aside class="wtside" aria-label="Lifts, runs and places">
    <button type="button" class="wtgrip" data-act="sheet" aria-label="Show the list"><i></i></button>
    <input class="wtfind" type="search" placeholder="Find a lift, run or place" aria-label="Find a lift, run or place" autocomplete="off" spellcheck="false">
    <div class="wttabs" role="tablist"><button type="button" role="tab" data-tab="lift" aria-selected="true">Lifts <b>${it.lift.length}</b></button><button type="button" role="tab" data-tab="run" aria-selected="false">Runs <b>${it.run.length}</b></button><button type="button" role="tab" data-tab="place" aria-selected="false">Places <b>${it.place.length}</b></button></div>
    <ul class="wtlist" role="list"></ul>
  </aside>
</div>`;
    const q = s => el.querySelector(s);
    this.cv = q('canvas'); this.tip = q('.wttip'); this.mapEl = q('.wtmap'); this.cardEl = q('.wtcard'); this.busyEl = q('.wtbusy');
    this.listEl = q('.wtlist'); this.findEl = q('.wtfind'); this.side = q('.wtside'); this.legendEl = q('.wtlegend'); this.scaleEl = q('.wtscale');
    this.tab = 'lift';
    el.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && el.contains(b)) this.act(b.dataset.act, b); });
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.list(); });
    this.findEl.addEventListener('input', () => this.list());
    this.findEl.addEventListener('focus', () => this.sheet(true));
    this.findEl.addEventListener('keydown', e => {
      if (e.code === 'Enter') { const f = this.listEl.querySelector('button'); if (f) f.click(); e.preventDefault(); }
      if (e.code === 'ArrowDown') { const f = this.listEl.querySelector('button'); if (f) { f.focus(); e.preventDefault(); } }
    });
    this.listEl.addEventListener('keydown', e => {
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      const bs = [...this.listEl.querySelectorAll('button')], k = bs.indexOf(document.activeElement); if (k < 0) return;
      e.preventDefault(); const n = bs[k + (e.code === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); else if (e.code === 'ArrowUp') this.findEl.focus();
    });
    el.addEventListener('keydown', e => this.mapKey(e));
    this.legend(); this.list(); this.pointer();
    addEventListener('resize', () => { if (this.open_) { this.layout(); this.dirty = true; } });
  }
  // the list, by tab, or everything matching the search (lifts first)
  list() {
    const qs = fold(this.findEl.value.trim()), it = this.items;
    this.el.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(!qs && b.dataset.tab === this.tab)));
    let rows;
    if (qs) {
      const m = x => { const n = fold(x.name); return n.startsWith(qs) ? 0 : n.split(/[\s\-/]+/).some(w => w.startsWith(qs)) ? 1 : n.includes(qs) ? 2 : -1; };
      rows = [];
      for (const t of ['lift', 'run', 'place']) rows.push(...it[t].map(x => [m(x), x]).filter(r => r[0] >= 0).sort((a, b) => a[0] - b[0]).map(r => r[1]));
    } else rows = it[this.tab];
    this.rows = rows;
    if (!rows.length) { this.listEl.innerHTML = `<li class="wtnone">${qs ? 'Nothing here by that name.' : this.tab === 'lift' ? 'OpenStreetMap has no lifts mapped here.' : this.tab === 'run' ? 'No named runs are mapped here.' : 'No huts or restaurants are mapped here.'}</li>`; return; }
    this.listEl.innerHTML = rows.slice(0, 300).map((x, n) => `<li><button type="button" class="wtitem${this.sel && (this.sel === x) ? ' on' : ''}" data-n="${n}">${this.icon(x)}<span class="wtt"><b>${esc(x.name)}</b><small>${esc(x.type === 'lift' ? x.sub : x.type === 'run' ? (x.park ? 'Terrain park' : this.names[x.diff]) + ' · ' + km(x.len) : x.sub)}</small></span>${x.type === 'lift' ? `<em class="${x.parts.length ? 'ok' : 'no'}">${x.parts.length ? 'Ride' : x.why === 'out' ? 'Build' : 'Info'}</em>` : ''}</button></li>`).join('');
    this.listEl.querySelectorAll('button').forEach(b => b.onclick = () => this.pickFromList(this.rows[+b.dataset.n]));
  }
  // the little sign in front of each row: a run's own sign shape (the Americas: circle, square, diamond, two diamonds;
  // elsewhere a coloured disc), a lift's cable with its two stations, a place's dot
  icon(x) {
    if (x.type === 'lift') return `<svg class="wti" viewBox="0 0 22 14" aria-hidden="true"><path d="M3 11 19 3" stroke="#1b1f24" stroke-width="1.6"/><rect x="0.5" y="8.5" width="5" height="5" fill="#1b1f24"/><rect x="16.5" y="0.5" width="5" height="5" fill="#fff" stroke="#1b1f24"/></svg>`;
    if (x.type === 'place') return `<svg class="wti" viewBox="0 0 22 14" aria-hidden="true"><circle cx="11" cy="7" r="4.5" fill="${x.kind === 'hotel' ? '#6d4ca8' : '#b8641c'}" stroke="#fff" stroke-width="1.5"/></svg>`;
    return `<svg class="wti" viewBox="0 0 22 14" aria-hidden="true">${this.signShape(x.diff, x.park)}</svg>`;
  }
  signShape(diff, park) {
    const c = this.cols[diff];
    if (park || diff === 6) return `<rect x="3" y="2" width="16" height="10" rx="2" fill="${c}"/>`;
    if (!this.na) return `<circle cx="11" cy="7" r="6" fill="${c}"/>`;
    if (diff <= 1) return `<circle cx="11" cy="7" r="6" fill="${c}"/>`;
    if (diff === 2) return `<rect x="5" y="1" width="12" height="12" fill="${c}"/>`;
    if (diff === 3 || diff === 5) return `<path d="M11 0.5 17.5 7 11 13.5 4.5 7Z" fill="${c}"/>`;
    return `<path d="M6 1 11 7 6 13 1 7Z M16 1 21 7 16 13 11 7Z" fill="${c}"/>`;
  }
  legend() {
    const L = this.legendEl, sw = (inner, w = 30) => `<svg viewBox="0 0 ${w} 14" width="${w}" height="14" aria-hidden="true">${inner}</svg>`;
    const run = (c, dash) => sw(`<path d="M2 7H28" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M2 7H28" stroke="${c}" stroke-width="3.4" stroke-linecap="round"${dash ? ' stroke-dasharray="6 4"' : ''}/>`);
    const diffs = this.na ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
    const rows = [
      ...diffs.map(d => [`${sw(this.signShape(d, false), 22)}${run(this.cols[d])}`, this.names[d]]),
      [`${sw(this.signShape(6, true), 22)}${run(this.cols[6])}`, 'Terrain park (its jumps and rails marked)'],
      [run('#1f5fb8', true), 'Dashed: not groomed'],
      [sw('<path d="M3 11 27 3" stroke="#fff" stroke-width="4.6"/><path d="M3 11 27 3" stroke="#1b1f24" stroke-width="1.8"/><rect x="0.5" y="8" width="6" height="6" fill="#1b1f24"/><rect x="23.5" y="0.5" width="6" height="6" fill="#fff" stroke="#1b1f24"/>'), 'Lift: click to ride it (bottom station filled)'],
      [sw('<path d="M3 11 27 3" stroke="#fff" stroke-width="4.6"/><path d="M3 11 27 3" stroke="#7d8892" stroke-width="1.6" stroke-dasharray="4 3"/>'), 'Lift the game does not build'],
      [sw('<path d="M2 7H28" stroke="rgba(139,0,0,.9)" stroke-width="2" stroke-dasharray="5 4"/>'), 'Closed run, ski area edge'],
      [sw('<rect x="1" y="1" width="28" height="12" fill="none" stroke="#0d1b2a" stroke-width="1.4" stroke-dasharray="4 3"/>'), 'Edge of the part that is built (a drop past it builds there)'],
      [sw(`<path d="M8 2 11.5 9H4.5Z M8 5 12.5 12H3.5Z" fill="#26493b"/><path d="M20 2 23.5 9H16.5Z M20 5 24.5 12H15.5Z" fill="#26493b"/>`), 'Forest' + (this.W.woodSrc === 'treeline' || (!this.W.wood && !this.W.cover && !this.W.osmLand) ? ' (guessed from the treeline)' : '')],
      [sw('<rect x="1" y="1" width="28" height="12" fill="#a3978d"/>'), 'Rock'],
      [sw('<rect x="1" y="1" width="28" height="12" fill="#c8deec" stroke="#6f9cc2"/>'), 'Lake or water'],
      [sw('<path d="M1 10C8 4 20 4 29 9" stroke="#34588a" stroke-opacity=".6" fill="none" stroke-width="1.2"/>'), `Contour lines (<span class="wtci"></span>)`],
      [sw('<circle cx="8" cy="7" r="4.5" fill="#b8641c" stroke="#fff" stroke-width="1.5"/><circle cx="21" cy="7" r="4.5" fill="#6d4ca8" stroke="#fff" stroke-width="1.5"/>'), 'Hut or restaurant, lodging'],
      [sw('<path d="M15 2 21 12 15 9 9 12Z" fill="#ff6a13" stroke="#fff" stroke-width="1.4"/>'), 'You'],
      [sw('<circle cx="15" cy="7" r="4.5" fill="#9fc6e8" stroke="#0d1b2a" stroke-width="1.6"/>'), 'Other riders in your room'],
    ];
    L.innerHTML = `<h3>Key</h3><ul>${rows.map(([s, t]) => `<li><span class="wtsw">${s}</span><span>${t}</span></li>`).join('')}</ul><p>Sources: elevation from AWS Terrain Tiles; runs, lifts and places from OpenStreetMap contributors.</p>`;
  }
  sheet(up) { if (this.side) this.side.classList.toggle('up', up == null ? !this.side.classList.contains('up') : !!up); }
  act(a, b) {
    const v = this.view;
    if (a === 'close') this.close();
    else if (a === 'in' || a === 'out') this.zoomAt(this.w / 2, this.h / 2, a === 'in' ? 1 / 1.6 : 1.6, true);
    else if (a === 'me') { const p = this.g.skier.p, m = Math.min(v.mpp, 3); this.fly({ cx: p.x, cz: p.z + (this.padB || 0) / 2 * m, mpp: m }); }
    else if (a === 'all') this.fly(this.fitAll(this.w, this.h));
    else if (a === 'key') { const open = this.legendEl.hidden; this.legendEl.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (open) this.legendCi(); }
    else if (a === 'sheet') this.sheet();
    else if (a === 'card-close') this.select(null);
    else if (a === 'ride') this.ride(this.sel);
    else if (a === 'top') this.startTop(this.sel);
    else if (a === 'here') { const s = this.sel; if (this.W.land.elev.inFine(s.x, s.z, 40)) this.dropAt(s.x, s.z); else this.rebuild(s); }
    else if (a === 'rebuild') this.rebuild(this.sel);
  }
  legendCi() { const s = this.legendEl.querySelector('.wtci'); if (s) { const I = contourI(this.view.mpp); s.textContent = I ? `every ${I} m here, thicker every ${I * 5} m` : 'drawn when you zoom in'; } }

  // ---- opening and closing
  open() {
    const t0 = performance.now();
    this.build();
    this.buildMs = performance.now() - t0;
    this.relief.check();
    this.el.classList.remove('hidden'); this.open_ = true;
    this.layout();
    this.maxMpp = Math.max(4, this.box.s / Math.max(200, Math.min(this.w, this.h)) * 1.15);
    // (first open: the whole ski area; after that, where you were looking, unless you have gone out of it)
    const p = this.g.skier.p, v = this.view;
    if (!this.seen) { this.seen = true; Object.assign(v, this.fitAll(this.w, this.h)); }
    else if (Math.abs(p.x - v.cx) > this.w / 2 * v.mpp * 0.8 || Math.abs(p.z - v.cz) > this.h / 2 * v.mpp * 0.8) { v.cx = p.x; v.cz = p.z + (this.padB || 0) / 2 * v.mpp; }
    this.openAt = performance.now(); this.doneAt = 0;
    this.dirty = true; this.loop();
    requestAnimationFrame(() => requestAnimationFrame(() => { const b = this.el.querySelector('[data-act="close"]'); if (b && this.open_ && !this.el.contains(document.activeElement)) b.focus({ preventScroll: true }); }));
    this.openMs = performance.now() - t0;     // (a test reads these: the open's own work, then each drawing's)
  }
  close() { this.hide(); this.g.back(); }
  hide() { this.el.classList.add('hidden'); this.open_ = false; this.tip.hidden = true; this.hov = null; if (this.side) this.side.classList.remove('up'); }
  layout() {
    const r = this.mapEl.getBoundingClientRect(), dpr = this.dpr;
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.padB = this.sheetPad();
    const W = Math.round(this.w * dpr), H = Math.round(this.h * dpr);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
  }
  // while open: the tiles a few milliseconds a frame, and a drawing when something changed
  loop() {
    if (this.looping) return; this.looping = true;
    const f = now => {
      if (!this.open_) { this.looping = false; return; }
      const tf = performance.now();
      if (this.anim) this.stepAnim(now);
      const R = this.relief;
      if (R.busy()) { if (R.pump(7)) this.dirty = true; }
      else if (!this.doneAt && this.openAt) this.doneAt = performance.now();
      const live = (this.hov && this.hov.type === 'lift' || this.sel && this.sel.type === 'lift') && !reduced();
      if (this.dirty || live) { this.dirty = false; const t0 = performance.now(); this.draw(now); const ms = performance.now() - t0; this.drawMs = ms; this.drawWorst = Math.max(this.drawWorst || 0, ms); }
      // (for the tests: the map's own time each frame, the last 600)
      const lt = this.loopMs || (this.loopMs = []); lt.push(performance.now() - tf); if (lt.length > 600) lt.shift();
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }
  // ---- moving round
  toWorld(mx, my) { const v = this.view; return { x: v.cx + (mx - this.w / 2) * v.mpp, z: v.cz + (my - this.h / 2) * v.mpp }; }
  toScreen(x, z) { const v = this.view; return [(x - v.cx) / v.mpp + this.w / 2, (z - v.cz) / v.mpp + this.h / 2]; }
  zoomAt(mx, my, k, smooth) {
    const v = this.view, mpp = clamp(v.mpp * k, 0.6, this.maxMpp);
    const a = this.toWorld(mx, my), cx = a.x - (mx - this.w / 2) * mpp, cz = a.z - (my - this.h / 2) * mpp;
    if (smooth) this.fly({ cx, cz, mpp }, 220); else { this.anim = null; v.mpp = mpp; v.cx = cx; v.cz = cz; this.dirty = true; }
  }
  fly(to, ms = 420) {
    to.mpp = clamp(to.mpp, 0.6, this.maxMpp || 40);
    if (reduced()) { Object.assign(this.view, to); this.anim = null; this.dirty = true; return; }
    this.anim = { from: Object.assign({}, this.view), to, t0: performance.now(), ms };
    this.dirty = true;
  }
  stepAnim(now) {
    const A = this.anim, k = clamp((now - A.t0) / A.ms, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, v = this.view;
    // (the zoom eased in its logarithm, so the way in and out feel even)
    const l0 = Math.log(A.from.mpp), l1 = Math.log(A.to.mpp);
    v.mpp = Math.exp(l0 + (l1 - l0) * e); v.cx = A.from.cx + (A.to.cx - A.from.cx) * e; v.cz = A.from.cz + (A.to.cz - A.from.cz) * e;
    this.dirty = true;
    if (k >= 1) this.anim = null;
  }
  /* keys while the map is open (the game is paused under it): Esc closes it (or clears the search first), the arrows
     pan, + and - zoom. Keys inside the map's own page go on to their target (the search box, the list), then stop
     there (mapKey, on the page), so the game never sees them; keys elsewhere stop here. */
  key(e) {
    if (!this.open_) return;
    const inField = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
    if (e.code === 'Escape') {
      e.stopImmediatePropagation(); e.preventDefault();
      if (inField && this.findEl.value) { this.findEl.value = ''; this.list(); return; }
      this.close(); return;
    }
    if (this.el.contains(e.target)) return;
    e.stopImmediatePropagation();
    this.mapKeys(e);
  }
  mapKey(e) { if (!this.open_) return; e.stopPropagation(); const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.closest('.wtlist'))) return; this.mapKeys(e); }
  mapKeys(e) {
    const P = 90, v = this.view;
    const k = { ArrowLeft: [-P, 0], ArrowRight: [P, 0], ArrowUp: [0, -P], ArrowDown: [0, P] }[e.code];
    if (k) { e.preventDefault(); this.fly({ cx: v.cx + k[0] * v.mpp, cz: v.cz + k[1] * v.mpp, mpp: v.mpp }, 160); }
    else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); this.zoomAt(this.w / 2, this.h / 2, 1 / 1.6, true); }
    else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); this.zoomAt(this.w / 2, this.h / 2, 1.6, true); }
  }
  pointer() {
    const cv = this.cv, pts = new Map();
    let down = null, moved = false, pinch = null;
    const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e));
      this.anim = null;
      if (pts.size === 1) { const [x, y] = local(e); down = { x, y, cx: this.view.cx, cz: this.view.cz, touch: e.pointerType !== 'mouse' }; moved = false; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mpp: this.view.mpp, w: this.toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; moved = true; }
      if (this.side) this.side.classList.remove('up');
    });
    cv.addEventListener('pointermove', e => {
      const [x, y] = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [x, y]);
      if (pts.size === 2 && pinch) {     // (two fingers: zoom about where they are, and follow them)
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, v = this.view;
        v.mpp = clamp(pinch.mpp * pinch.d / Math.max(10, d), 0.6, this.maxMpp);
        v.cx = pinch.w.x - (mx - this.w / 2) * v.mpp; v.cz = pinch.w.z - (my - this.h / 2) * v.mpp;
        this.dirty = true; this.tip.hidden = true; return;
      }
      if (down && pts.size === 1) {
        const dx = x - down.x, dy = y - down.y;
        if (!moved && Math.hypot(dx, dy) > (down.touch ? 9 : 5)) { moved = true; this.mapEl.classList.add('drag'); }
        if (moved) { this.view.cx = down.cx - dx * this.view.mpp; this.view.cz = down.cz - dy * this.view.mpp; this.dirty = true; this.tip.hidden = true; return; }
      }
      if (e.pointerType === 'mouse') this.hover(x, y);
    });
    const up = e => {
      const had = pts.has(e.pointerId); pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      // (one finger left after a pinch: it pans on from where it is now)
      if (pts.size === 1 && down) { const [x, y] = [...pts.values()][0]; down = { x, y, cx: this.view.cx, cz: this.view.cz, touch: down.touch }; return; }
      if (!had || !down) return;
      const [x, y] = local(e), click = !moved && pts.size === 0, touch = down.touch;
      if (pts.size === 0) { down = null; this.mapEl.classList.remove('drag'); }
      if (click) this.click(x, y, touch);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); if (!pts.size) { down = null; pinch = null; this.mapEl.classList.remove('drag'); } });
    cv.addEventListener('pointerleave', () => { this.tip.hidden = true; if (this.hov) { this.hov = null; this.dirty = true; } });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); this.anim = null;
      const [x, y] = local(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // (a trackpad's pinch comes as a wheel with Ctrl held: quicker)
      this.zoomAt(x, y, Math.exp(clamp(dy, -300, 300) * (e.ctrlKey ? 0.01 : 0.0018)));
      this.hover(x, y);
    }, { passive: false });
    cv.addEventListener('dblclick', e => { e.preventDefault(); });
  }

  // ---- what is under a point (the nearest within reach, lifts before runs where both are near)
  pick(x, z, mx, my, touch) {
    const v = this.view, reach = (touch ? 22 : 13) * v.mpp;
    const seg = (pts, x, z) => { let bd = Infinity; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1; let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t); if (d < bd) bd = d; } return bd; };
    const inBox = (r, m) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
    let best = null, bd = Infinity;
    // the others in the room first, then the nearest of places (small dots), lifts (favoured) and runs
    for (const r of this.others()) { const d = Math.hypot(r.p.x - x, r.p.z - z); if (d < 11 * v.mpp && d < bd) { bd = d; best = { type: 'rider', name: r.name, x: r.p.x, z: r.p.z }; } }
    if (best) return best;
    const pr = (touch ? 14 : 9) * v.mpp;
    for (const pl of this.places) { if (!this.placeShown(pl)) continue; const d = Math.hypot(pl.x - x, pl.z - z); if (d < pr && d < bd) { bd = d; best = pl; } }
    for (const L of this.lifts) { if (!inBox(L, reach)) continue; const d = seg(L.pts, x, z) * 0.75; if (d < reach && d < bd) { bd = d; best = L; } }
    for (const r of this.runs) {
      if (!inBox(r, reach + r.p.w)) continue;
      let d = seg(r.pts, x, z); if (r.p.area) d = Math.max(0, d - r.p.w);   // (an area: anywhere inside its edge's reach)
      d = Math.max(0, d - r.p.w / 2 * 0.6);
      if (d < reach && d < bd) { bd = d; best = r.group; }
    }
    if (best) return best;
    const parks = this.W.feats && this.W.feats.parks || [];
    for (const P of parks) if (P.pts && P.pts.length > 2 && inPoly(P.pts, x, z)) return Object.assign({ type: 'park' }, P);
    return null;
  }
  others() {
    const out = [];
    try {
      const R = this.g.others && this.g.others();
      if (R) for (const r of R.values ? R.values() : R) if (r.view && r.view.shown && r.view.p) out.push({ name: r.name, p: r.view.p });
    } catch (e) {}
    return out;
  }
  hover(mx, my) {
    const p = this.toWorld(mx, my), tip = this.tip, el = this.W.land.elev;
    const H = this.pick(p.x, p.z, mx, my, false), was = this.hov;
    this.hov = H && (H.type === 'lift' || H.type === 'run') ? H : null;
    if (this.hov !== was) this.dirty = true;
    const inside = el.inFine(p.x, p.z, 40), y = Math.round(el.at(p.x, p.z));
    let html;
    if (H && H.type === 'lift') html = `${esc(H.name)}<small>${esc(H.sub)}</small><small class="wtdo">${H.parts.length ? 'Click to ride it' : H.why === 'out' ? 'Not built yet: click to build it and ride' : 'Click for why it is not ridden'}</small>`;
    else if (H && H.type === 'run') html = `${esc(H.name)}<small>${esc(H.sub)}</small><small class="wtdo">Click to start at the top</small>`;
    else if (H && H.type === 'place') html = `${esc(H.name)}<small>${esc(H.sub)}</small>`;
    else if (H && H.type === 'rider') html = `${esc(H.name)}<small>Riding in your room</small>`;
    else if (H && H.type === 'park') html = `${esc(H.name || 'Terrain park')}<small>${H.generated ? 'Layout generated by the game' : 'Terrain park'}</small>`;
    else {
      const mk = this.markAt(p.x, p.z);
      html = mk ? `${esc(mk.name || cap(mk.kind))}<small>${esc(cap(mk.kind))}${mk.generated ? ', made by the game' : ''}</small>` : `${y} m above the sea<small class="wtdo">${inside ? 'Click to drop in here' : 'Not built yet: click to build it'}</small>`;
    }
    tip.innerHTML = html;
    // (kept inside the map)
    tip.hidden = false; const tw = tip.offsetWidth;
    tip.style.left = Math.min(mx, this.w - tw - 16) + 'px'; tip.style.top = clamp(my, 24, this.h - 24) + 'px';
    this.mapEl.classList.toggle('over', !!this.hov);
  }
  markAt(x, z) {
    const M = this.W.feats && this.W.feats.marks; if (!M || this.view.mpp > 5) return null;
    let best = null, bd = 9 * this.view.mpp;
    for (const m of M) { const d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  click(mx, my, touch) {
    const p = this.toWorld(mx, my), H = this.pick(p.x, p.z, mx, my, touch);
    this.tip.hidden = true;
    // a mouse click on a lift that can be ridden rides it; a tap shows its card first
    if (H && H.type === 'lift' && H.parts.length && !touch) { this.select(H, false); this.ride(H); return; }
    if (H && H.type === 'lift' && touch && this.sel === H && H.parts.length) { this.ride(H); return; }
    if (H) { this.select(H, false); return; }
    const inside = this.W.land.elev.inFine(p.x, p.z, 40);
    this.select({ type: 'point', x: p.x, z: p.z, inside, name: inside ? 'Here' : 'Not built yet' }, false);
  }
  select(x, fly) {
    this.sel = x; this.dirty = true;
    if (x && fly) {
      const b = x.type === 'place' ? { x0: x.x - 400, x1: x.x + 400, z0: x.z - 400, z1: x.z + 400 } : x;
      this.fly(this.fitView(b, this.w, this.h, 0.55, 1.6));
    }
    this.card();
    this.listEl.querySelectorAll('.wtitem.on').forEach(b => b.classList.remove('on'));
    if (x && this.rows) { const n = this.rows.indexOf(x); const b = n >= 0 && this.listEl.querySelector(`[data-n="${n}"]`); if (b) b.classList.add('on'); }
  }
  // from the list: fly there, pick it (on a phone the list folds away to show it)
  pickFromList(x) { if (!x) return; this.sheet(false); this.select(x, true); }
  card() {
    const x = this.sel, C = this.cardEl;
    this.mapEl.classList.toggle('carded', !!x);
    if (!x) { C.hidden = true; return; }
    const el = this.W.land.elev, btn = (act, label, main) => `<button type="button" data-act="${act}" class="${main ? 'wtgo' : ''}">${label}</button>`;
    let head = '', body = '', acts = '';
    if (x.type === 'lift') {
      head = `<span class="wtck">${esc(kindName(x.L.kind))}</span><h3>${esc(x.name)}</h3>`;
      body = `<p class="wtnum">${esc(x.sub.split(' · ').slice(1).join(' · '))}</p>`;
      if (x.parts.length) {
        acts = btn('ride', 'Ride this lift', true);
        body += `<p>${x.parts.length > 1 ? `Built in ${x.parts.length} stretches: you change chairs at the middle stations by yourself. ` : ''}Any key on the chair sends it straight up.</p>`;
      } else if (x.why === 'out') {
        acts = btn('rebuild', 'Build this part and ride', true);
        body += `<p>This lift is outside the part of the mountain that is built. The game can build the mountain round it instead (it starts again there, which takes a few seconds) and put you on it.</p>`;
      } else if (x.why === 'kind') {
        acts = btn('here', 'Start beside it');
        body += `<p>${esc(kindName(x.L.kind))}s, rope tows and funiculars are not built in the game, only chairlifts, gondolas, cable cars and drag lifts.</p>`;
      } else if (x.why === 'short') {
        acts = btn('here', 'Start beside it');
        body += `<p>Too short for the game to build (under 150 m).</p>`;
      } else {
        acts = btn('top', 'Start at its top', true);
        body += `<p>The game builds the ${this.W.planned ? this.W.planned.plans.length : ''} lifts here that climb the most, and this is not one of them.</p>`;
      }
      if (!x.parts.length) { const b = x.up ? x.pts[0] : x.pts[x.pts.length - 1]; x.x = b.x; x.z = b.z; }
    } else if (x.type === 'run') {
      head = `<span class="wtck"><svg class="wti" viewBox="0 0 22 14" aria-hidden="true">${this.signShape(x.diff, x.park)}</svg>${esc(x.park ? 'Terrain park' : this.names[x.diff])}</span><h3>${esc(x.name)}</h3>`;
      body = `<p class="wtnum">${esc(x.sub.split(' · ').slice(1).join(' · '))}</p>`;
      const topIn = el.inFine(x.top.x, x.top.z, 40);
      acts = topIn ? btn('top', 'Start at the top', true) : btn('rebuild', 'Build this part and start', true);
      if (!topIn) body += `<p>Its top is outside the part of the mountain that is built: the game starts again there (a few seconds).</p>`;
    } else if (x.type === 'place') {
      head = `<span class="wtck">${esc(x.sub)}</span><h3>${esc(x.name)}</h3>`;
      body = `<p class="wtnum">${Math.round(el.at(x.x, x.z))} m above the sea</p>`;
      acts = el.inFine(x.x, x.z, 40) ? btn('here', 'Start here', true) : btn('rebuild', 'Build this part and start', true);
    } else if (x.type === 'park') {
      head = `<span class="wtck">Terrain park</span><h3>${esc(x.name || 'Terrain park')}</h3>`;
      body = `<p>${x.generated ? 'Its layout is generated by the game (OpenStreetMap does not map its features).' : 'Its features as mapped.'}</p>`;
      const t = topOf(x.pts, el); x.x = t.x; x.z = t.z; acts = btn('here', 'Start at the top', true);
    } else if (x.type === 'rider') {
      head = `<span class="wtck">In your room</span><h3>${esc(x.name)}</h3>`;
      acts = this.W.land.elev.inFine(x.x, x.z, 40) ? btn('here', 'Drop in beside them', true) : '';
    } else {
      head = `<span class="wtck">${x.inside ? 'Open snow' : 'Not built yet'}</span><h3>${Math.round(el.at(x.x, x.z))} m</h3>`;
      body = x.inside ? '' : `<p>Outside the part of the mountain that is built. The game can start again round this point (a few seconds).</p>`;
      acts = x.inside ? btn('here', 'Drop in here', true) : btn('rebuild', 'Build this part and drop in', true);
    }
    C.innerHTML = `<button type="button" class="wtx" data-act="card-close" aria-label="Close this card">&times;</button>${head}${body}<div class="wtacts">${acts}</div>`;
    C.hidden = false;
    C.classList.toggle('lift', x.type === 'lift');
    const go = C.querySelector('.wtgo'); if (go && document.activeElement !== this.findEl) go.focus({ preventScroll: true });
  }

  // ---- going somewhere
  showBusy(t) { if (!this.busyEl) return; this.busyEl.querySelector('span').textContent = t; this.busyEl.hidden = false; }
  hideBusy() { if (this.busyEl) this.busyEl.hidden = true; }
  // the ground (terrain patches) round a point built now, so the first frame there has it (a moment of work, under a note)
  warm(x, y, z) {
    const g = this.g, t0 = performance.now();
    try { if (g.terrain && g.terrain.warm) { const v = g.skier.p.clone(); v.set(x, y + 4, z); g.terrain.warm(v, 320); } } catch (e) { console.warn('warm', e); }
    this.warmMs = performance.now() - t0;
  }
  // a lift: the ground round its bottom station made ready, then onto its load line (wlift.js board), the chair up
  async ride(x, quiet) {
    const g = this.g, lift = g.lift;
    if (!x || x.type !== 'lift' || !x.parts.length) return;
    if (!lift || !lift.ready || !lift.board) { this.say('The lifts are still being built. Try again in a moment.'); return; }
    stopFly();
    const k = x.parts[0], l = lift.lifts[k]; if (!l) return;
    const P = l.plan, F = l.F, bx = F.wx(P.load.x, P.load.z), bz = F.wz(P.load.x, P.load.z);
    if (this.open_) { this.showBusy('Taking you to the ' + x.name); await frames(2); }
    this.warm(bx, P.load.y, bz);
    this.hideBusy(); if (this.open_) this.hide();
    const ok = lift.board(k, g.skier);
    if (!ok) { this.say('That lift could not be boarded.'); return; }
    this.chain = x.parts.length > 1 ? { rest: x.parts.slice(1), name: x.name, was: 'lift' } : null;
    if (g.cams) g.cams.first = true;
    if (g.play) g.play();
    this.rodeAt = performance.now(); this.rode = x.name;
    if (g.hud && !quiet) g.hud.flash('The ' + x.name + ': press any key to go straight up', 3000);
  }
  dropAt(x, z) {
    const g = this.g;
    stopFly();
    const go = async () => {
      if (this.open_) { this.showBusy('Taking you there'); await frames(2); }
      this.warm(x, this.W.land.elev.at(x, z) - (this.W.land.y0 || 0), z);
      this.hideBusy(); if (this.open_) this.hide();
      g.drop(x, z);
    };
    go();
  }
  // the top of a run (a little way down it, so you start rolling on it), or a lift's top
  startTop(x) {
    if (!x) return;
    if (x.type === 'lift') { const t = x.up ? x.pts[x.pts.length - 1] : x.pts[0]; const e = this.W.land.elev; if (!e.inFine(t.x, t.z, 40)) { this.rebuild(x); return; } this.dropAt(t.x, t.z); return; }
    const T = x.top, w = T.way.pts, i = T.i, n = w[i + 1] && this.W.land.elev.at(w[i + 1].x, w[i + 1].z) < T.y ? w[i + 1] : w[i - 1] || w[i + 1];
    let px = T.x, pz = T.z;
    if (n) { const d = Math.hypot(n.x - T.x, n.z - T.z) || 1, s = Math.min(12, d * 0.5); px += (n.x - T.x) / d * s; pz += (n.z - T.z) / d * s; }
    if (!this.W.land.elev.inFine(px, pz, 40)) { this.rebuild(x); return; }
    this.dropAt(px, pz);
  }
  /* outside the built area: the page starts again with the mountain built round the place (wmap.js takeDrop), and for a
     lift, put on it once Ride is pressed */
  rebuild(x) {
    let d;
    if (x.type === 'lift') { const a = x.pts[0], b = x.pts[x.pts.length - 1]; d = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, spawn: true, board: { id: x.L.id ?? null, n: x.n, name: x.name, a: [a.x, a.z], b: [b.x, b.z] } }; }
    else if (x.type === 'run') { const t = x.top; d = { x: t.x, z: t.z, spawn: true }; }
    else d = { x: x.x, z: x.z, spawn: true };
    this.showBusy('Building the mountain there');
    try { sessionStorage.setItem('ski_wdrop', JSON.stringify(Object.assign({ id: this.W.id, at: Date.now() }, d))); } catch (e) {}
    setTimeout(() => location.reload(), 60);
  }
  say(t) { if (this.g.hud) this.g.hud.flash(t, 2600); if (this.open_) { this.showBusy(t); setTimeout(() => this.hideBusy(), 2200); } }
  // a lift asked for before the page was built again round it (wmap.js takeDrop): ridden when Ride is first pressed
  pendingBoard(b) {
    this.pending = b;
    const btn = $('play'); if (!btn) return;
    btn.addEventListener('click', () => setTimeout(() => this.boardPending(), 40), { once: true });
  }
  boardPending() {
    const b = this.pending; this.pending = null; if (!b) return;
    this.prep();
    let x = b.id != null ? this.lifts.find(L => L.L.id === b.id) : null;
    if (!x && b.a) x = this.lifts.find(L => { const a = L.pts[0], c = L.pts[L.pts.length - 1]; return Math.hypot(a.x - b.a[0], a.z - b.a[1]) < 5 && Math.hypot(c.x - b.b[0], c.z - b.b[1]) < 5; });
    if (x && x.parts.length) this.ride(x);
    else if (this.g.hud) this.g.hud.flash((b.name ? 'The ' + b.name : 'That lift') + ' is not built here after all: you start beside it', 3200);
  }

  /* ---- each frame while riding (wmap.js W.miniFrame): a lift built in stretches ridden on, the corner map, and the map's
     tiles made ahead in idle moments */
  frame(dt, sk) {
    // (a lift in stretches: off one at its middle station, onto the next)
    const C = this.chain;
    if (C) {
      const st = sk.state;
      if (st !== 'lift' && C.was === 'lift') {
        const lift = this.g.lift, k = C.rest.shift(), l = lift && lift.lifts[k];
        if (l) {
          const P = l.plan, bx = l.F.wx(P.load.x, P.load.z), bz = l.F.wz(P.load.x, P.load.z);
          if (Math.hypot(sk.p.x - bx, sk.p.z - bz) < 150) { lift.board(k, sk); if (this.g.hud) this.g.hud.flash('On to the next stretch of the ' + C.name, 2000); }
          else this.chain = null;
        }
        if (!C.rest.length) this.chain = null;
      }
      if (this.chain) this.chain.was = sk.state === 'lift' || (this.g.lift && this.g.lift.riding) ? 'lift' : st;
    }
    if (this.miniDraw) this.miniDraw(dt, sk);
    // (the tiles made ahead: the map's first view and round you, in idle moments, one at a time)
    if (!this.open_ && !this.idleOn && this.relief && this.relief.busy()) {
      this.idleOn = true;
      // (a few milliseconds of an idle moment; with none for a while, 3 ms anyway: a tile's steps are about one each)
      const run = d => { this.idleOn = false; if (this.open_) return; const left = d && d.timeRemaining ? d.timeRemaining() : 4; this.relief.pump(d && d.didTimeout ? 3 : clamp(left - 2, 0, 5)); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 }); else setTimeout(run, 200);
    }
  }
  // the map's first view's tiles, wanted ahead (made in idle moments: opening it then shows them at once)
  ahead() {
    this.prep();
    this.padB = this.sheetPad();
    const R = this.relief, sideW = innerWidth > 760 ? 320 : 0, w = Math.max(320, innerWidth - sideW), h = Math.max(320, innerHeight - (innerWidth > 760 ? 64 : 160));
    this.maxMpp = Math.max(4, this.box.s / Math.max(200, Math.min(w, h)) * 1.15);
    const v = this.fitAll(w, h), z = R.level(v.mpp, this.dpr), S = TS * M0 / 2 ** z;
    const want = [];
    for (let j = Math.floor((v.cz - h / 2 * v.mpp) / S); j <= Math.floor((v.cz + h / 2 * v.mpp) / S); j++) for (let i = Math.floor((v.cx - w / 2 * v.mpp) / S); i <= Math.floor((v.cx + w / 2 * v.mpp) / S); i++) want.push([z, i, j, Math.hypot((i + 0.5) * S - v.cx, (j + 0.5) * S - v.cz)]);
    // (and the coarser level under it, for zooming out)
    const z1 = Math.max(0, z - 2), S1 = TS * M0 / 2 ** z1;
    for (let j = Math.floor(this.box.z0 / S1); j <= Math.floor((this.box.z0 + this.box.s) / S1); j++) for (let i = Math.floor(this.box.x0 / S1); i <= Math.floor((this.box.x0 + this.box.s) / S1); i++) want.push([z1, i, j, 1e9]);
    want.sort((a, b) => a[3] - b[3]);
    R.pre = want;
    // (its page too, hidden, in another idle moment: the first open then only shows it)
    const b = () => { if (!this.built) this.build(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(b, { timeout: 3000 }); else setTimeout(b, 500);
  }

  /* ---- the corner map while riding (Leonski 2's minimap): the relief, the runs and lifts round you, 1.2 km across (0.9
     on a small screen), north up, redrawn four times a second; a click on it opens the trail map. Not on touch screens,
     whose buttons are there, nor while watching others. */
  mini(hud, open) {
    this.prep();
    const el = document.createElement('canvas'); el.className = 'wmini'; el.title = 'Trail map'; el.setAttribute('aria-label', 'Trail map'); el.setAttribute('role', 'button');
    hud.appendChild(el);
    el.addEventListener('click', open);
    let t = 0;
    this.miniDraw = (dt, sk) => {
      t -= dt; if (t > 0) return; t = 0.25;
      if (this.open_) return;
      const t0 = performance.now();
      const S = el.clientWidth || 150, dpr = this.dpr;
      if (!S || el.offsetParent === null) return;
      if (el.width !== Math.round(S * dpr)) { el.width = el.height = Math.round(S * dpr); }
      const c = el.getContext('2d'), span = S < 140 ? 900 : 1200, mpp = span / S, v = { cx: sk.p.x, cz: sk.p.z, mpp };
      const R = this.relief;
      c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#e4eaf1'; c.fillRect(0, 0, el.width, el.height);
      c.imageSmoothingEnabled = true;
      R.drawTiles(c, v, S, S, dpr, 'now');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = 1 / mpp, X = x => (x - v.cx) * k + S / 2, Z = z => (z - v.cz) * k + S / 2, h = span / 2 + 30;
      c.lineCap = 'round'; c.lineJoin = 'round';
      const near = r => !(r.x1 < v.cx - h || r.x0 > v.cx + h || r.z1 < v.cz - h || r.z0 > v.cz + h);
      const line = (pts) => { c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(X(q.x), Z(q.z)) : c.moveTo(X(q.x), Z(q.z))); };
      for (const pass of [0, 1]) for (const r of this.runs) {
        if (!near(r)) continue; line(r.pts);
        if (!pass) { c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 4.4; c.setLineDash([]); }
        else { c.strokeStyle = r.col; c.lineWidth = 2.4; c.setLineDash(r.groom ? [] : [4, 3]); }
        c.stroke();
      }
      c.setLineDash([]);
      for (const pass of [0, 1]) for (const L of this.lifts) {
        if (!near(L)) continue; line(L.pts);
        c.strokeStyle = pass ? '#1b1f24' : 'rgba(255,255,255,.9)'; c.lineWidth = pass ? 1.6 : 3.8; c.stroke();
      }
      for (const o of this.others()) { c.beginPath(); c.arc(X(o.p.x), Z(o.p.z), 3.6, 0, 7); c.fillStyle = '#9fc6e8'; c.fill(); c.lineWidth = 1.4; c.strokeStyle = '#0d1b2a'; c.stroke(); }
      const f = sk.fwd || { x: 0, z: 1 }, a = Math.atan2(f.x, f.z);
      c.save(); c.translate(S / 2, S / 2); c.rotate(-a);
      c.beginPath(); c.moveTo(0, 9); c.lineTo(6, -6); c.lineTo(0, -2.5); c.lineTo(-6, -6); c.closePath();
      c.fillStyle = '#ff6a13'; c.fill(); c.lineWidth = 1.6; c.strokeStyle = '#fff'; c.stroke(); c.restore();
      // north
      c.font = '700 11px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
      c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.95)'; c.strokeText('N', S / 2, 3); c.fillStyle = '#0d1b2a'; c.fillText('N', S / 2, 3);
      const ms = performance.now() - t0; this.miniMs = ms; if (ms > (this.miniWorst || 0)) this.miniWorst = ms;
    };
    // (the tiles round you for it, and the map's first view, made ahead)
    this.ahead();
    return this.miniDraw;
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  draw(now) {
    const cv = this.cv, c = cv.getContext('2d'), dpr = this.dpr, v = this.view, W = this.W, w = this.w, h = this.h;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#d7dfe8'; c.fillRect(0, 0, cv.width, cv.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    const T0 = performance.now();
    this.relief.drawTiles(c, v, w, h, dpr, 'now');
    const T1 = performance.now();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = 1 / v.mpp, ox = w / 2 - v.cx * k, oz = h / 2 - v.cz * k;
    const X = x => x * k + ox, Z = z => z * k + oz;
    const vx0 = v.cx - w / 2 * v.mpp - 60 * v.mpp, vx1 = v.cx + w / 2 * v.mpp + 60 * v.mpp, vz0 = v.cz - h / 2 * v.mpp - 60 * v.mpp, vz1 = v.cz + h / 2 * v.mpp + 60 * v.mpp;
    const seen = r => !(r.x1 < vx0 || r.x0 > vx1 || r.z1 < vz0 || r.z0 > vz1);
    const path = pts => { c.beginPath(); for (let i = 0; i < pts.length; i++) { const x = X(pts[i].x), y = Z(pts[i].z); i ? c.lineTo(x, y) : c.moveTo(x, y); } };
    c.lineCap = 'round'; c.lineJoin = 'round';
    // the part that is built (outside it, a drop builds that part): the rest a little veiled, its edge dashed
    const E = W.ext, ex = X(E.x0), ey = Z(E.z0), ex2 = X(E.x1), ey2 = Z(E.z1);
    c.fillStyle = 'rgba(13,27,42,.16)'; c.beginPath(); c.rect(0, 0, w, h); c.rect(ex, ey, ex2 - ex, ey2 - ey); c.fill('evenodd');
    c.setLineDash([7, 5]); c.strokeStyle = 'rgba(13,27,42,.55)'; c.lineWidth = 1.4; c.strokeRect(ex, ey, ex2 - ex, ey2 - ey); c.setLineDash([]);
    // the ski area's boundary and closed runs
    c.setLineDash([6, 5]); c.lineWidth = 1.6; c.strokeStyle = 'rgba(139,0,0,.75)';
    for (const b of W.data.bounds) if (b.pts.length > 1) { path(b.pts); c.stroke(); }
    c.lineWidth = 2; for (const p of W.data.closed) if (p.pts.length > 1) { path(p.pts); c.stroke(); }
    c.setLineDash([]);
    // the parks the game knows (feats.parks): a dashed orange edge, filled a little
    const parks = W.feats && W.feats.parks || [];
    for (const P of parks) if (P.pts && P.pts.length > 2) { path(P.pts); c.closePath(); c.fillStyle = 'rgba(255,106,19,.1)'; c.fill(); c.setLineDash([5, 4]); c.strokeStyle = 'rgba(214,82,10,.85)'; c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); }
    // ---- the runs: the highlight under the one picked, the areas, each run's real width, then its line with a white edge
    const sel = this.sel, hov = this.hov;
    const glow = (pts, wpx) => { path(pts); c.strokeStyle = 'rgba(255,214,0,.85)'; c.lineWidth = wpx; c.stroke(); };
    for (const G of [hov, sel]) if (G && G.type === 'run') for (const r of G.ways) if (seen(r)) glow(r.pts, Math.max(12, r.p.w * k + 8));
    for (const r of this.runs) if (r.p.area && seen(r)) { path(r.pts); c.globalAlpha = 0.24; c.fillStyle = r.col; c.fill(); c.globalAlpha = 1; }
    const lineW = clamp(16 / v.mpp, 1.8, 3.6);
    for (const r of this.runs) {
      if (r.p.area || !seen(r)) continue;
      const bw = r.p.w * k; if (bw > lineW + 3) { path(r.pts); c.globalAlpha = 0.2; c.strokeStyle = r.col; c.lineWidth = bw; c.stroke(); c.globalAlpha = 1; }
    }
    for (const pass of [0, 1]) for (const r of this.runs) {
      if (r.p.area || !seen(r)) continue;
      const on = sel && sel.type === 'run' && r.group === sel || hov && hov.type === 'run' && r.group === hov, lw = on ? lineW + 1.2 : lineW;
      path(r.pts);
      if (!pass) { c.strokeStyle = 'rgba(255,255,255,.92)'; c.lineWidth = lw + 2.4; c.setLineDash([]); }
      else { c.strokeStyle = r.col; c.lineWidth = lw; c.setLineDash(r.groom ? [] : [lw * 2.4, lw * 1.7]); }
      c.stroke();
    }
    c.setLineDash([]);
    // ---- the lifts: cables with a white edge, towers, the stations (the bottom filled), which way they go
    const t = (now || performance.now()) / 1000, close = v.mpp < 7;
    for (const L of [hov, sel]) if (L && L.type === 'lift' && seen(L)) glow(L.pts, 13);
    for (const pass of [0, 1, 2]) for (const L of this.lifts) {
      if (!seen(L)) continue;
      const on = L === sel || L === hov, built = L.parts.length || L.why === 'out';   // (out: ridden once that part is built)
      path(L.pts);
      if (pass === 0) { c.strokeStyle = 'rgba(255,255,255,.92)'; c.lineWidth = on ? 6.4 : 4.6; c.stroke(); continue; }
      if (pass === 1) {
        c.strokeStyle = built ? '#1b1f24' : '#7d8892'; c.lineWidth = on ? 2.6 : 1.8; c.setLineDash(built ? [] : [4, 3]); c.stroke(); c.setLineDash([]);
        // (the one under the pointer or picked: its cable running up, unless motion is turned down)
        if (on && L.parts.length && !reduced()) { c.setLineDash([3, 9]); c.lineDashOffset = (L.up ? -1 : 1) * (t * 26 % 12); c.strokeStyle = '#ffd400'; c.lineWidth = 2.4; c.stroke(); c.setLineDash([]); c.lineDashOffset = 0; }
        continue;
      }
      // towers (the built lift's own, else every 220 m), then the stations
      if (close) {
        c.strokeStyle = built ? '#1b1f24' : '#7d8892'; c.lineWidth = 1.2; c.beginPath();
        const tw = this.towers(L);
        for (const q of tw) { const x = X(q.x), y = Z(q.z); c.moveTo(x - q.nx * 3.6, y - q.nz * 3.6); c.lineTo(x + q.nx * 3.6, y + q.nz * 3.6); }
        c.stroke();
      }
      const a = L.pts[0], b = L.pts[L.pts.length - 1], bot = L.up ? a : b, top = L.up ? b : a, s = on ? 8 : 6.4;
      const ang = Math.atan2(Z(top.z) - Z(bot.z), X(top.x) - X(bot.x));
      for (const [q, fill] of [[bot, true], [top, false]]) {
        c.save(); c.translate(X(q.x), Z(q.z)); c.rotate(ang);
        c.fillStyle = fill ? (built ? '#1b1f24' : '#7d8892') : '#fff'; c.strokeStyle = built ? '#1b1f24' : '#7d8892'; c.lineWidth = 1.6;
        c.fillRect(-s / 2, -s / 2, s, s); c.strokeRect(-s / 2, -s / 2, s, s); c.restore();
      }
      // which way it goes: a chevron in the middle, pointing up the hill
      if (close || on) {
        const m = L.pts[Math.floor(L.pts.length / 2)];
        const mx = L.pts.length === 2 ? (X(a.x) + X(b.x)) / 2 : X(m.x), my = L.pts.length === 2 ? (Z(a.z) + Z(b.z)) / 2 : Z(m.z);
        c.save(); c.translate(mx, my); c.rotate(ang); c.beginPath(); c.moveTo(-3, -4.5); c.lineTo(3, 0); c.lineTo(-3, 4.5); c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke(); c.strokeStyle = built ? '#1b1f24' : '#7d8892'; c.lineWidth = 1.8; c.stroke(); c.restore();
      }
    }
    // ---- the features the game made (and mapped ones), close up
    const marks = W.feats && W.feats.marks;
    if (marks && v.mpp < 5) for (const m of marks) { const x = X(m.x), y = Z(m.z); if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue; markIcon(c, m, x, y); }
    // ---- huts, restaurants and lodges
    for (const pl of this.places) {
      if (!this.placeShown(pl)) continue;
      const x = X(pl.x), y = Z(pl.z); if (x < -6 || y < -6 || x > w + 6 || y > h + 6) continue;
      const on = sel === pl; c.beginPath(); c.arc(x, y, on ? 6 : 4.2, 0, 7); c.fillStyle = pl.kind === 'hotel' ? '#6d4ca8' : '#b8641c'; c.fill(); c.lineWidth = 1.6; c.strokeStyle = on ? '#ffd400' : '#fff'; c.stroke();
    }
    if (sel && sel.type === 'point') { const x = X(sel.x), y = Z(sel.z); c.beginPath(); c.arc(x, y, 7, 0, 7); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke(); c.lineWidth = 2; c.strokeStyle = '#0d1b2a'; c.stroke(); c.beginPath(); c.arc(x, y, 2, 0, 7); c.fillStyle = '#0d1b2a'; c.fill(); }
    // ---- names along the lines (and over the places close up), none on top of another
    const T2 = performance.now();
    this.labels(c, X, Z, w, h, v, seen);
    const T3 = performance.now();
    // ---- the others in the room, and you
    c.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    for (const o of this.others()) {
      const x = X(o.p.x), y = Z(o.p.z); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = '#9fc6e8'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#0d1b2a'; c.stroke();
      halo(c, o.name, x + 8, y, '#0d1b2a');
    }
    const sk = this.g.skier, px = X(sk.p.x), py = Z(sk.p.z), f = sk.fwd || { x: 0, z: 1 }, a = Math.atan2(f.x, f.z);
    c.beginPath(); c.arc(px, py, 15, 0, 7); c.fillStyle = 'rgba(255,106,19,.16)'; c.fill();
    c.save(); c.translate(px, py); c.rotate(-a);
    c.beginPath(); c.moveTo(0, 12); c.lineTo(8, -8); c.lineTo(0, -3.5); c.lineTo(-8, -8); c.closePath();
    c.fillStyle = '#ff6a13'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    this.scale();
    if (!this.legendEl.hidden) this.legendCi();
    // (for the tests: the slowest drawing's parts, ms: the tiles, the lines and marks, the names, the rest)
    const T4 = performance.now(), sum = T4 - T0;
    if (!this.drawParts || sum > this.drawParts.sum) this.drawParts = { sum: +sum.toFixed(1), tiles: +(T1 - T0).toFixed(1), lines: +(T2 - T1).toFixed(1), names: +(T3 - T2).toFixed(1), rest: +(T4 - T3).toFixed(1), mpp: +v.mpp.toFixed(2) };
  }
  // the towers along a lift: the built one's own, else one every 220 m; each with the way across the line
  towers(L) {
    if (L._tw) return L._tw;
    const out = [], lift = this.g.lift;
    const a = L.pts[0], b = L.pts[L.pts.length - 1], d = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / d, nz = (b.x - a.x) / d;
    if (lift && lift.ready && L.parts.length) for (const k of L.parts) { const l = lift.lifts[k]; if (!l) continue; for (const tw of l.plan.towers) out.push({ x: l.F.wx(tw.x, tw.z), z: l.F.wz(tw.x, tw.z), nx, nz }); }
    else {
      let carry = 110;
      for (let i = 0; i < L.pts.length - 1; i++) {
        const p = L.pts[i], q = L.pts[i + 1], l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        for (let s = carry; s < l; s += 220) out.push({ x: p.x + (q.x - p.x) * s / l, z: p.z + (q.z - p.z) * s / l, nx: -(q.z - p.z) / l, nz: (q.x - p.x) / l });
        carry = ((carry - l) % 220 + 220) % 220;
      }
    }
    if (lift && lift.ready) L._tw = out;
    return out;
  }
  labels(c, X, Z, w, h, v, seen) {
    const used = [], sel = this.sel, hov = this.hov;
    const free = (x0, y0, x1, y1) => { if (x0 < 2 || y0 < 2 || x1 > w - 2 || y1 > h - 2) return false; for (const u of used) if (x0 < u[2] && x1 > u[0] && y0 < u[3] && y1 > u[1]) return false; used.push([x0, y0, x1, y1]); return true; };
    /* along a line: the longest straight stretch on the screen that holds the name (the line simplified first: a lift
       has a point at every tower, a run at every bend), turned with it, kept upright */
    const along = (pts, text, col, font, minLen) => {
      c.font = font;
      const tw = this.tw(c, font, text) + 10, P = simplify(pts.map(p => [X(p.x), Z(p.z)]), 3);
      let best = null;
      for (let i = 0; i < P.length - 1; i++) {
        const x0 = P[i][0], y0 = P[i][1], x1 = P[i + 1][0], y1 = P[i + 1][1], L = Math.hypot(x1 - x0, y1 - y0);
        if (L < tw * (minLen || 0.9)) continue;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2; if (mx < 0 || my < 0 || mx > w || my > h) continue;
        if (!best || L > best.L) best = { L, mx, my, a: Math.atan2(y1 - y0, x1 - x0) };
      }
      if (!best) return false;
      let a = best.a; if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a)), bw = tw * ca + 14 * sa, bh = tw * sa + 14 * ca;
      if (!free(best.mx - bw / 2, best.my - bh / 2, best.mx + bw / 2, best.my + bh / 2)) return false;
      c.save(); c.translate(best.mx, best.my); c.rotate(a); c.textAlign = 'center'; c.textBaseline = 'middle'; halo(c, text, 0, 0.5, col); c.restore();
      return true;
    };
    const order = [];
    // (the picked and the pointed-at first, then the lifts, then the runs, longest first)
    for (const x of [sel, hov]) if (x && (x.type === 'lift' || x.type === 'run')) order.push(x);
    if (v.mpp < 16) for (const L of this.lifts) if (seen(L) && !order.includes(L)) order.push(L);
    if (v.mpp < 7) for (const G of this.byLen || (this.byLen = this.groups.filter(G => G.named).sort((a, b) => b.len - a.len))) if (seen(G) && !order.includes(G)) order.push(G);
    let n = 0;
    for (const x of order) {
      if (n > 90) break;
      if (x.type === 'lift') { if (along(x.pts, x.name, '#0d1b2a', 'italic 700 13px "Barlow Condensed", "Arial Narrow", sans-serif', 0.8)) n++; }
      else {
        const col = x.diff === 6 ? '#b84a0c' : x.diff === 5 && !this.na ? '#8a5c00' : this.cols[x.diff];
        // (a run in pieces: on its longest piece in view)
        const ways = x.ways.filter(seen).sort((a, b) => b.f.len - a.f.len);
        for (const r of ways.slice(0, 3)) if (along(r.pts, x.name, col, '600 11.5px "IBM Plex Sans", system-ui, sans-serif', 0.95)) { n++; break; }
      }
    }
    // places, close up
    if (v.mpp < 3.2) {
      c.font = '500 11px "IBM Plex Sans", system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      for (const pl of this.places) {
        if (!this.placeShown(pl)) continue;
        const x = X(pl.x), y = Z(pl.z); if (x < 0 || y < 0 || x > w || y > h) continue;
        const tw = c.measureText(pl.name).width;
        if (free(x + 6, y - 8, x + 12 + tw, y + 8)) halo(c, pl.name, x + 8, y, pl.kind === 'hotel' ? '#4b2f80' : '#7a3f0e');
      }
    }
    // the parks' names
    const parks = this.W.feats && this.W.feats.parks || [];
    if (v.mpp < 10) for (const P of parks) {
      if (!P.pts || P.pts.length < 2) continue;      // (W11: a park mapped as a two-point line is named too)
      let sx = 0, sz = 0; for (const p of P.pts) { sx += p.x; sz += p.z; } const x = X(sx / P.pts.length), y = Z(sz / P.pts.length);
      c.font = 'italic 700 13px "Barlow Condensed", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const t1 = (P.name || 'Terrain park').toUpperCase(), tw = c.measureText(t1).width;
      if (!free(x - tw / 2 - 4, y - 16, x + tw / 2 + 4, y + 16)) continue;
      halo(c, t1, x, y - 5, '#b84a0c');
      if (P.generated) { c.font = '500 10px "IBM Plex Sans", sans-serif'; halo(c, 'layout generated', x, y + 8, '#5b3a1e'); }
    }
  }
  // huts and restaurants once zoomed in a little, lodging (mostly down in the towns) only close up; the picked one always
  placeShown(pl) { return pl === this.sel || this.view.mpp < (pl.kind === 'hotel' ? 4.5 : 9); }
  // a name's width in a font (measured once)
  tw(c, font, text) { const m = this._tw || (this._tw = new Map()), k = font + '|' + text; let w = m.get(k); if (w == null) { w = c.measureText(text).width; m.set(k, w); } return w; }
  scale() {
    const v = this.view, max = 110 * v.mpp, steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    let m = steps[0]; for (const s of steps) if (s <= max) m = s;
    this.scaleEl.querySelector('i').style.width = (m / v.mpp).toFixed(1) + 'px';
    this.scaleEl.querySelector('span').textContent = km(m);
  }
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
// text with a white edge round it, readable on any part of the map
function halo(c, text, x, y, col) { c.lineJoin = 'round'; c.lineWidth = 3.4; c.strokeStyle = 'rgba(255,255,255,.94)'; c.strokeText(text, x, y); c.fillStyle = col; c.fillText(text, x, y); }
// a screen polyline with the points that stray less than tol pixels from the straight line dropped (Douglas-Peucker)
function simplify(P, tol) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const st = [[0, P.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), ax = P[a][0], ay = P[a][1], dx = P[b][0] - ax, dy = P[b][1] - ay, l = Math.hypot(dx, dy) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / l; if (d > fd) { fd = d; far = i; } }
    if (far > 0) { keep[far] = 1; st.push([a, far], [far, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
function inPoly(pts, x, z) { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside; } return inside; }
function topOf(pts, el) { let best = pts[0], by = -Infinity; for (const p of pts) { const y = el.at(p.x, p.z); if (y > by) { by = y; best = p; } } return best; }
// a small sign for each feature: a wedge for a jump, a bar for a rail, a box, a U for a pipe, the rest a dot with a ring
function markIcon(c, m, x, y) {
  const k = String(m.kind || '').toLowerCase(), yaw = m.yaw || 0;
  c.save(); c.translate(x, y); c.rotate(-yaw); c.lineJoin = 'round';
  c.fillStyle = m.generated ? '#3b4652' : '#1b1f24'; c.strokeStyle = '#fff'; c.lineWidth = 1.6;
  c.beginPath();
  if (/jump|kicker|lip|drop/.test(k)) { c.moveTo(-4, 4); c.lineTo(4, 4); c.lineTo(4, -3); c.closePath(); }
  else if (/rail|tube/.test(k)) { c.rect(-1.5, -6, 3, 12); }
  else if (/box/.test(k)) { c.rect(-3, -6, 6, 12); }
  else if (/pipe/.test(k)) { c.moveTo(-5, -4); c.lineTo(-5, 3); c.lineTo(5, 3); c.lineTo(5, -4); c.lineTo(3, -4); c.lineTo(3, 1); c.lineTo(-3, 1); c.lineTo(-3, -4); c.closePath(); }
  else if (/roller|hit/.test(k)) { c.moveTo(-5, 3); c.quadraticCurveTo(0, -6, 5, 3); c.closePath(); }
  else c.arc(0, 0, 3.4, 0, 7);
  c.stroke(); c.fill(); c.restore();
}
