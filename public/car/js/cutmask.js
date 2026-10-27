// The road mask that takes the parked and moving cars out of Google's photogrammetry: the carriageways from OSM
// are drawn into a picture of the area (white inside), and the road's height is kept in a small float picture.
// baked.js throws away mesh fragments over a carriageway between just under the road and uCutTop above it, so
// our own road surface (and our own traffic) shows instead. Areas are redrawn as the car moves.
// The picture's red says where to cut; its green, where there is any, how far over the road (TOP_MAX metres for a
// full green) the cut reaches there instead of uCutTop: a tunnel's bore where its roof is near the surface, a road
// cut into a hillside out to its retaining wall (tunnels.js puts those shapes in under.mask).
import * as THREE from 'three';
import { bakedUniforms } from './baked.js?v=34';
import { under } from './under.js?v=34';

const WIDTH = { motorway: 3.6, trunk: 3.5, primary: 3.4, secondary: 3.3, tertiary: 3.2, unclassified: 3, residential: 3, living_street: 2.8, service: 3, motorway_link: 3.5, trunk_link: 3.4, primary_link: 3.3, secondary_link: 3.2, tertiary_link: 3.1 };
const TOP_MAX = 25; // (baked.js reads green * 25 m)
const STOP = { stop: true }; // (a newer build took over)
const LANES = { motorway: 2, trunk: 2, primary: 2, secondary: 2, tertiary: 2, unclassified: 2, residential: 2, living_street: 2, service: 1 };

export function carriageWidth(tags, parking = true) {
  const hw = tags.highway;
  if (!(hw in WIDTH)) return 0;
  const w = parseFloat(tags.width);
  if (w > 2 && w < 40) return w;
  let lanes = parseInt(tags.lanes) || (tags.oneway === 'yes' && hw !== 'motorway' ? 1 : LANES[hw]) || 2;
  let width = lanes * WIDTH[hw];
  if (!parking) return width;
  // street parking on either side is part of what we cover
  const park = tags['parking:lane:both'] || tags['parking:both'];
  if (park && park !== 'no') width += 4.4;
  else { if ((tags['parking:lane:left'] || tags['parking:left'] || 'no') !== 'no') width += 2.2; if ((tags['parking:lane:right'] || tags['parking:right'] || 'no') !== 'no') width += 2.2; }
  if (['residential', 'tertiary', 'secondary', 'unclassified'].includes(hw) && !park && lanes <= 2) width += 2.4; // most such streets have parking
  return width;
}

export class CutMask {
  constructor(size = 2048, metres = 1400) {
    this.size = size; this.metres = metres;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = size;
    this.tex = new THREE.CanvasTexture(this.canvas);
    // rows run north to south as z does: no flip (a canvas texture is flipped by default, which mirrored the mask)
    this.tex.colorSpace = THREE.NoColorSpace; this.tex.generateMipmaps = false; this.tex.flipY = false;
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.HN = 256;
    this.hraw = new Float32Array(this.HN * this.HN);
    this.hdata = new Uint16Array(this.HN * this.HN);
    this.htex = new THREE.DataTexture(this.hdata, this.HN, this.HN, THREE.RedFormat, THREE.HalfFloatType);
    this.htex.minFilter = this.htex.magFilter = THREE.LinearFilter;
    bakedUniforms.uCutMap.value = this.tex;
    bakedUniforms.uCutHt.value = this.htex;
  }

  // roads: osm roads [{ pts, tags }]; surface(x, z) -> { h, onRoad } from roads.js (or null)
  // Worked out in slices of about 6 ms (it took 180 to 770 ms in one go): the last mask stays on until the new one is
  // done; a newer build stops an older one. Returns a promise (never rejected).
  build(cx, cz, roads, surface, ground, opts = {}) {
    const token = this.token = (this.token || 0) + 1;
    return this._build(token, cx, cz, roads, surface, ground, opts).catch(e => { if (e !== STOP) console.warn('cut mask', e); });
  }
  async _build(token, cx, cz, roads, surface, ground, opts) {
    let t0 = performance.now(), busy = 0, most = 0;
    const Y = async () => { const t = performance.now(); if (t - t0 > 6) { busy += t - t0; most = Math.max(most, t - t0); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); if (token !== this.token) throw STOP; } };
    const ws = opts.widthScale || 1, parking = opts.parking !== false;
    const S = this.size, M = this.metres, x0 = cx - M / 2, z0 = cz - M / 2, k = S / M;
    const g = this.canvas.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#f00'; g.lineCap = 'round'; g.lineJoin = 'round';
    // the roads module's own edges when given (the widths it draws), else widths guessed from the tags
    if (opts.edges && opts.edges.length) {
      // flat ends: a round cap reaches past a junction's corners, where there is no road to show through the cut
      g.lineCap = opts.cap || 'round';
      for (const e of opts.edges) {
        await Y();
        // (bridges only when asked, in the open map: the terrain is cut under a deck too, so where a deck comes down to
        // meet the ground the coarse terrain does not poke up through it; Google's own deck stays)
        // (a tunnel's bore is not cut through the ground over it: under.mask has the stretches that need it)
        if (!e.c || (e.c.bridge && !opts.bridges) || e.c.tunnel === 'bore' || !e.pts || e.pts.length < 2) continue;
        g.lineWidth = (e.c.bridge && e.c.deckL ? e.c.deckL + e.c.deckR : 2 * e.c.hw) * ws * k;
        g.beginPath();
        e.pts.forEach(([x, z], i) => { const px = (x - x0) * k, pz = (z - z0) * k; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
        g.stroke();
        // the outer strip each side the narrowed stroke leaves, where a kerb and a pavement go on from the carriageway:
        // cut as well (to just under the kerb), or the coarse terrain shows through wherever it stands over the road's
        // edge (Boulevard Haussmann's north side showed the photographed tree crowns there as a green strip)
        if (ws < 1 && !e.c.bridge && e.c.tunnel !== 'bore' && e.px && e.nx && e.px.length >= 2) for (const sd of [-1, 1]) {
          if (!(sd < 0 ? e.c.curbL : e.c.curbR)) continue;
          const off = e.c.hw * (1 + ws) / 2, s0 = e.set0 || 0, s1 = e.len - (e.set1 || 0);
          g.lineWidth = (e.c.hw * (1 - ws) + 0.3) * k;
          g.beginPath(); let n = 0;
          for (let i = 0; i < e.px.length; i++) {
            if (e.ps[i] < s0 || e.ps[i] > s1) continue;
            const m = Math.min(1.6, (e.mk && e.mk[i]) || 1), px = (e.px[i] + e.nx[i] * m * sd * off - x0) * k, pz = (e.pz[i] + e.nz[i] * m * sd * off - z0) * k;
            if (n++) g.lineTo(px, pz); else g.moveTo(px, pz);
          }
          if (n >= 2) g.stroke();
        }
      }
      g.lineCap = 'round';
      roads = [];
    }
    // junctions: their own outlines (the corners between the roads' flat ends), shrunk as the roads are
    if (opts.junctions) {
      g.fillStyle = '#f00';
      for (const j of opts.junctions) {
        await Y();
        const ol = j && j.outline; if (!ol || ol.length < 3) continue;
        let mx = 0, mz = 0; for (const q of ol) { mx += q.x; mz += q.z; } mx /= ol.length; mz /= ol.length;
        g.beginPath();
        ol.forEach((q, i) => { const x = mx + (q.x - mx) * ws, z = mz + (q.z - mz) * ws, px = (x - x0) * k, pz = (z - z0) * k; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
        g.closePath(); g.fill();
      }
      g.fillStyle = '#000';
    }
    // the shapes that reach higher (green), over everything else
    const shapes = opts.shapes !== undefined ? opts.shapes : under.mask;
    for (const sh of shapes || []) {
      await Y();
      if (!sh || !sh.pts || sh.pts.length < 3) continue;
      const gv = Math.max(1, Math.min(255, Math.round(sh.top / TOP_MAX * 255)));
      g.fillStyle = 'rgb(255,' + gv + ',0)';
      g.beginPath();
      sh.pts.forEach(([x, z], i) => { const px = (x - x0) * k, pz = (z - z0) * k; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      g.closePath(); g.fill();
    }
    g.fillStyle = '#000';
    for (const r of roads) {
      await Y();
      const t = r.tags || {};
      if (t.tunnel && t.tunnel !== 'no') continue;
      if (t.bridge && t.bridge !== 'no') continue; // a bridge's deck is its own: leave the mesh under it alone
      const w = carriageWidth(t, parking) * ws;
      if (!w || !r.pts || r.pts.length < 2) continue;
      g.lineWidth = w * k;
      g.beginPath();
      r.pts.forEach(([x, z], i) => { const px = (x - x0) * k, pz = (z - z0) * k; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      g.stroke();
    }
    // the road's height on a coarse grid (5.5 m): the road surface where there is one, the ground elsewhere
    const N = this.HN, step = M / N;
    const H = this.hraw, ok = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (i === 0) await Y();
      const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
      const s = surface ? surface(x, z) : null;
      let h = s && s.onRoad && Number.isFinite(s.h) ? s.h : null;
      if (h === null && ground) h = ground(x, z);
      // in and round a tunnel's bore where its roof is near the surface: its floor (the cut there is measured from it)
      if (under.tubes.length) { const f = under.floorNear(x, z); if (f !== null && !(s && s.onRoad && s.h > f + 4)) h = f; }
      if (h !== null && Number.isFinite(h)) { H[j * N + i] = h; ok[j * N + i] = 1; }
    }
    // cells with no road spread from their neighbours, so filtering at a road's edge reads the road's height
    for (let it = 0; it < 24; it++) {
      await Y();
      let changed = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const o = j * N + i; if (ok[o]) continue;
        let sum = 0, n = 0;
        if (i > 0 && ok[o - 1] === 1) { sum += H[o - 1]; n++; }
        if (i < N - 1 && ok[o + 1] === 1) { sum += H[o + 1]; n++; }
        if (j > 0 && ok[o - N] === 1) { sum += H[o - N]; n++; }
        if (j < N - 1 && ok[o + N] === 1) { sum += H[o + N]; n++; }
        if (n) { H[o] = sum / n; ok[o] = 2; changed++; }
      }
      for (let o = 0; o < N * N; o++) if (ok[o] === 2) ok[o] = 1;
      if (!changed) break;
    }
    // half floats hold heights round a base (the middle's) to a few centimetres
    const base = this.hraw[(N >> 1) * N + (N >> 1)];
    await Y();
    for (let i = 0; i < N * N; i++) this.hdata[i] = THREE.DataUtils.toHalfFloat(this.hraw[i] - base);
    if (token !== this.token) throw STOP;
    this.tex.needsUpdate = true;
    bakedUniforms.uCutTop.value = opts.top ?? 4.2;
    bakedUniforms.uCutBelow.value = opts.below ?? 0.6;
    bakedUniforms.uCutH.value.set(base, 1);
    this.htex.needsUpdate = true;
    bakedUniforms.uCutBox.value.set(x0, z0, 1 / M, 1 / M);
    bakedUniforms.uCutOn.value = 1;
    this.center = { x: cx, z: cz };
    { const t = performance.now(); busy += t - t0; most = Math.max(most, t - t0); this.work = Math.round(busy); this.slice = Math.round(most); }
  }

  off() { this.token = (this.token || 0) + 1; bakedUniforms.uCutOn.value = 0; }
}
