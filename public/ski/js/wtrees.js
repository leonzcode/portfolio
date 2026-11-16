/* (W, round 11, for Leon's "for the real life mountain make the trees actually generate correctly and reflect actual
   runs from the ski resort with trees carved out where the runs are like in the actual ski resort but only where there
   are trees in the ski resort") Any mountain's forest, from the real place:
   - trees stand only inside the woods and forests OpenStreetMap maps there (natural=wood, landuse=forest; natural=scrub
     as low sparse growth; mapped single trees and tree rows where they are), tested exactly against the polygons;
   - the runs are cut out of it: nothing on a run's surface (its mapped area, else its line widened by its width tag or
     what runs of its difficulty usually are), with a ragged edge 1 to 7 m past it; a gladed run keeps a few trees;
     the lifts' lines cut as corridors under the cables, clearings round their stations, the mapped buildings and huts;
   - denser inside the forest, thinner at its edges, smaller near its upper edge; nothing on rock, steep faces, water,
     glaciers, the built features or the lifts' pads;
   - a place where OpenStreetMap has no woods at all: the old rule (the satellite picture's green, else a treeline from
     the latitude), and the place says so (W.woodSrc).
   The trees stream round the camera (the rider or the flyer): every tree of a 128 m cell within about 200 m (more on the
   higher tiers), fewer the further a cell is, out to about 2 km, never more than the tier's count (the same as before:
   the same draw calls and triangles). A cell's trees are the same every time (seeded by the cell), so moving on only
   adds or drops far ones. Drawn by world.js's Forest (near conifers, far cards), here given a list that changes. */
import * as THREE from 'three';
import { Forest } from './world.js?v=28';
import { ground } from './terrain.js?v=28';
import { simplex, smoothstep, fbm } from './noise.js?v=28';

const frac = x => ((x % 1) + 1) % 1;
// a cell's own random numbers (mulberry32 from a hash of the cell)
function cellRng(i, j, s = 0) {
  let a = (Math.imul(i | 0, 73856093) ^ Math.imul(j | 0, 19349663) ^ Math.imul(s + 1, 83492791)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---- polygons asked about: exact even-odd inside tests (edges bucketed by rows) and a raster in tiles built when first
   asked for (10 m cells: what is where, and how far a wood cell is from the wood's edge) ------------------------------ */
export class PolyIndex {
  // polys: [{ rings: [[{x, z}]], v }] (v: the raster's value, the highest wins), box: the square they are clipped to
  constructor(polys, box, rowH = 16) {
    const E = [], P = [];
    polys.forEach((pg, pi) => { for (const r of pg.rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if (a.z === b.z) continue; E.push(a.x, a.z, b.x, b.z); P.push(pi); } });
    this.e = Float32Array.from(E); this.pid = Int32Array.from(P); this.np = polys.length; this.val = polys.map(p => p.v || 1);
    this.box = box; this.rowH = rowH; this.nr = Math.max(1, Math.ceil((box.z1 - box.z0) / rowH) + 2);
    // the edges of each row (compressed rows)
    const cnt = new Int32Array(this.nr + 1), e = this.e, n = P.length, rowOf = z => Math.max(0, Math.min(this.nr - 1, Math.floor((z - box.z0) / rowH)));
    for (let k = 0; k < n; k++) { const a = rowOf(Math.min(e[k * 4 + 1], e[k * 4 + 3])), b = rowOf(Math.max(e[k * 4 + 1], e[k * 4 + 3])); for (let r = a; r <= b; r++) cnt[r + 1]++; }
    for (let r = 0; r < this.nr; r++) cnt[r + 1] += cnt[r];
    const at = cnt.slice(0, this.nr), list = new Int32Array(cnt[this.nr]);
    for (let k = 0; k < n; k++) { const a = rowOf(Math.min(e[k * 4 + 1], e[k * 4 + 3])), b = rowOf(Math.max(e[k * 4 + 1], e[k * 4 + 3])); for (let r = a; r <= b; r++) list[at[r]++] = k; }
    this.start = cnt; this.list = list; this.rowOf = rowOf;
    this.par = new Uint8Array(this.np); this.touched = [];
    this.tiles = new Map(); this.rowsX = new Map(); this.cell = 10; this.T = 128; this.M = 4;
  }
  get empty() { return this.np === 0; }
  // the highest value of the polygons the point is inside (0: none)
  value(x, z) {
    if (!this.np || z < this.box.z0 || z > this.box.z1 || x < this.box.x0 || x > this.box.x1) return 0;
    const r = this.rowOf(z), e = this.e, par = this.par, t = this.touched;
    for (let q = this.start[r], q1 = this.start[r + 1]; q < q1; q++) {
      const k = this.list[q] * 4, az = e[k + 1], bz = e[k + 3];
      if ((az <= z) === (bz <= z)) continue;
      const xc = e[k] + (z - az) / (bz - az) * (e[k + 2] - e[k]);
      if (xc > x) { const p = this.pid[this.list[q]]; if (!par[p]) t.push(p); par[p] ^= 1; }
    }
    let v = 0;
    for (const p of t) { if (par[p] && this.val[p] > v) v = this.val[p]; par[p] = 0; }
    t.length = 0;
    return v;
  }
  /* a tile of the raster (T x T cells of `cell` m, with M cells of margin): v the value at each cell's middle, d how many
     cells a cell is from one of another value (up to 15; wood's distance to the wood's edge) */
  /* every crossing of the polygons' edges along one row of the raster (the cells' middles at z = (g + 0.5) cell), sorted
     along x: worked out once for the whole box and shared by every tile in that row */
  rowX(g) {
    let r = this.rowsX.get(g); if (r) return r;
    const z = (g + 0.5) * this.cell, e = this.e, xs = [], ps = [];
    if (z >= this.box.z0 && z <= this.box.z1) {
      const rr = this.rowOf(z);
      for (let q = this.start[rr], q1 = this.start[rr + 1]; q < q1; q++) {
        const k = this.list[q] * 4, az = e[k + 1], bz = e[k + 3];
        if ((az <= z) === (bz <= z)) continue;
        xs.push(e[k] + (z - az) / (bz - az) * (e[k + 2] - e[k])); ps.push(this.pid[this.list[q]]);
      }
    }
    const ord = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    r = { x: Float64Array.from(ord, i => xs[i]), p: Int32Array.from(ord, i => ps[i]) };
    this.rowsX.set(g, r);
    if (this.rowsX.size > 1600) this.rowsX.delete(this.rowsX.keys().next().value);
    return r;
  }
  tile(ti, tj) {
    const key = (ti + 4096) * 8192 + tj + 4096; let t = this.tiles.get(key); if (t) return t;
    const T = this.T, M = this.M, N = T + 2 * M, c = this.cell, x0 = ti * T * c - M * c, z0 = tj * T * c - M * c;
    const v = new Uint8Array(N * N), vals = this.val, par = this.par, cnt = new Int32Array(8);
    if (this.np) for (let j = 0; j < N; j++) {
      const r = this.rowX(tj * T - M + j), n = r.x.length; if (!n) continue;
      // walking along the row from the far left: each crossing flips its polygon; a cell's value is the highest of the
      // polygons flipped an odd number of times there
      let k = 0;
      for (let i = 0; i < N; i++) {
        const x = x0 + (i + 0.5) * c;
        while (k < n && r.x[k] < x) { const p = r.p[k], w = Math.min(7, vals[p]); par[p] ^= 1; cnt[w] += par[p] ? 1 : -1; k++; }
        for (let w = 7; w > 0; w--) if (cnt[w] > 0) { v[j * N + i] = w; break; }
      }
      for (let q = 0; q < n; q++) par[r.p[q]] = 0;
      cnt.fill(0);
    }
    // the distance to a cell of another value (chamfer, two passes, capped)
    const d = new Uint8Array(N * N).fill(15);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = j * N + i; let m = 15;
      if (i > 0 && v[o - 1] !== v[o]) m = 1; else if (j > 0 && v[o - N] !== v[o]) m = 1;
      else { if (i > 0) m = Math.min(m, d[o - 1] + 1); if (j > 0) m = Math.min(m, d[o - N] + 1); }
      d[o] = m;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      const o = j * N + i; let m = d[o];
      if (i < N - 1) m = v[o + 1] !== v[o] ? 1 : Math.min(m, d[o + 1] + 1);
      if (j < N - 1) m = v[o + N] !== v[o] ? Math.min(m, 1) : Math.min(m, d[o + N] + 1);
      d[o] = m;
    }
    t = { v, d, x0, z0, N };
    this.tiles.set(key, t);
    if (this.tiles.size > 300) { const far = this.tiles.keys().next().value; this.tiles.delete(far); }   // (the oldest first)
    return t;
  }
  // the raster at a point: [value, distance to the edge in m]
  cellAt(x, z, out = [0, 0]) {
    const c = this.cell, T = this.T, ti = Math.floor(x / (T * c)), tj = Math.floor(z / (T * c)), t = this.tile(ti, tj);
    const i = Math.floor((x - t.x0) / c), j = Math.floor((z - t.z0) / c), o = j * t.N + i;
    out[0] = t.v[o]; out[1] = (t.d[o] - 0.5) * c; return out;
  }
  // the share of a square's cells of value v or more (for the cell estimates)
  share(x0, z0, size, v) {
    let n = 0, k = 0; const st = this.cell * 2, o = [0, 0];
    for (let z = z0 + st / 2; z < z0 + size; z += st) for (let x = x0 + st / 2; x < x0 + size; x += st) { this.cellAt(x, z, o); if (o[0] >= v) n++; k++; }
    return k ? n / k : 0;
  }
}

/* ---- what is kept clear: runs, lifts, stations, buildings, huts (a grid of 64 m cells listing what reaches each) ---- */
class Clear {
  constructor() { this.g = new Map(); this.B = 64; }
  key(i, j) { return (i + 4096) * 8192 + j + 4096; }
  addSeg(ax, az, bx, bz, hw, rag, glade) {
    const s = { ax, az, bx, bz, hw, rag, glade, c: false }, R = hw + rag + 2, B = this.B;
    for (let i = Math.floor((Math.min(ax, bx) - R) / B); i <= Math.floor((Math.max(ax, bx) + R) / B); i++) for (let j = Math.floor((Math.min(az, bz) - R) / B); j <= Math.floor((Math.max(az, bz) + R) / B); j++) {
      const k = this.key(i, j); let l = this.g.get(k); if (!l) this.g.set(k, l = []); l.push(s);
    }
  }
  addCircle(x, z, r) {
    const s = { x, z, r, c: true }, B = this.B;
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++) for (let j = Math.floor((z - r) / B); j <= Math.floor((z + r) / B); j++) {
      const k = this.key(i, j); let l = this.g.get(k); if (!l) this.g.set(k, l = []); l.push(s);
    }
  }
  /* 0 clear of everything, 1 inside a gladed run (a few trees kept), 2 kept clear; ragX: the ragged edge's own
     metres here (1 to 7 past a run's edge) */
  at(x, z, ragX) {
    const l = this.g.get(this.key(Math.floor(x / this.B), Math.floor(z / this.B))); if (!l) return 0;
    let glade = 0;
    for (const s of l) {
      if (s.c) { if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return 2; continue; }
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
      if (d < s.hw + s.rag * ragX) { if (s.glade && d < s.hw) glade = 1; else return 2; }
    }
    return glade;
  }
}
// the woods (2) and the scrub (1) of the land cover, as one index
export function woodIndex(L) {
  const polys = [];
  if (L) { for (const rs of L.wood) polys.push({ rings: rs, v: 2 }); for (const rs of L.scrub) polys.push({ rings: rs, v: 1 }); }
  return new PolyIndex(polys, { x0: -12000, z0: -12000, x1: 12000, z1: 12000 });
}
/* a run with no width tag is as wide as runs of its difficulty usually are (wosm.js), which is often wider than the run
   really is between the trees. Where OpenStreetMap's woods are drawn with the run cut out of them (the run's middle out
   of the woods, woods close on both sides), the gap between them is the run's width there: the median of the gaps
   along it (every 25 m where both sides meet wood within 45 m), 10 m at least, never wider than the usual width. A run
   whose woods are not cut keeps the usual width, and the trees are cut back from it instead. Returns how many changed. */
export function fitRunWidths(data, woods, inArea = () => true) {
  if (woods.empty) return 0;
  let n = 0; const o = [0, 0];
  const woodAt = (x, z) => { woods.cellAt(x, z, o); return o[0] >= 2 ? woods.value(x, z) >= 2 : false; };
  // the first wood out from a point along (dx, dz) within 45 m: the raster in 5 m steps, then the exact edge to half a metre
  const edgeAt = (x, z, dx, dz) => {
    let a = 0, b = 0;
    for (let d = 5; d <= 45; d += 5) { woods.cellAt(x + dx * d, z + dz * d, o); if (o[0] >= 2 || o[1] < 12) { if (woodAt(x + dx * d, z + dz * d)) { b = d; break; } } a = d; }
    if (!b) return 0;
    for (let k = 0; k < 3; k++) { const m = (a + b) / 2; if (woodAt(x + dx * m, z + dz * m)) b = m; else a = m; }
    return b;
  };
  for (const p of data.pistes) {
    if (p.area || p.wTag || p.pts.length < 2 || !p.pts.some(q => inArea(q.x, q.z))) continue;
    const gaps = []; let tried = 0;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z); if (l < 1) continue;
      const tx = (b.x - a.x) / l, tz = (b.z - a.z) / l, nx = -tz, nz = tx;
      for (let s = 7; s < l; s += 25) {
        const x = a.x + tx * s, z = a.z + tz * s; if (!inArea(x, z)) continue; tried++;
        if (woodAt(x, z)) continue;
        const L1 = edgeAt(x, z, nx, nz), R1 = L1 ? edgeAt(x, z, -nx, -nz) : 0;
        if (L1 && R1) gaps.push(L1 + R1);
      }
    }
    if (gaps.length < 3 || gaps.length < tried * 0.35) continue;
    gaps.sort((u, v) => u - v);
    const w = Math.max(10, Math.min(p.w, gaps[gaps.length >> 1]));
    if (w < p.w - 0.5) { p.wFit = p.w; p.w = w; n++; }
  }
  return n;
}
// the lifts' corridors under the cables: chairs, gondolas and cable cars about 24 m wide, drag lifts about 10
const CORRIDOR = k => /chair|gondola|cable|mixed/.test(k) ? 12 : /magic_carpet/.test(k) ? 3 : 5;

/* ---- the planting ------------------------------------------------------------------------------------------------------
   land: wland.js WorldLand; data: wosm.js parse; L: wlanddata.js land (or null: none came); o: { q, park, feats,
   fallback (x, z, y) -> density 0..1 when L has no woods, places } */
export class TreeStream {
  constructor(land, data, L, o) {
    this.land = land; this.data = data; this.L = L; this.o = o;
    const tier = o.q.tier, low = tier === 'low';
    // (the old planting's limit was the tier's count and 60% more, but it used about 2100 to 3100 of the low tier's 4160:
    // the count and a fifth more keeps the far cards' triangles about where they were)
    this.cap = Math.round((low ? 2600 : tier === 'medium' ? 5000 : 8000) * 1.2);
    this.R0 = low ? 200 : tier === 'medium' ? 250 : 320;     // every candidate of a cell this close
    this.Rmax = low ? 2000 : tier === 'medium' ? 2500 : 3000;
    this.C = 128; this.sp = 9;                               // (128 m cells; candidates about 9 m apart)
    const box = { x0: -12000, z0: -12000, x1: 12000, z1: 12000 };
    // the woods (2) and the scrub (1)
    this.woods = o.woods || woodIndex(L);
    this.mode = this.woods.empty ? 'fallback' : 'osm';
    // where nothing grows: water, bare rock, scree, glaciers (and the runs' mapped areas: a run area is never forest)
    const bare = [];
    if (L) for (const k of ['water', 'rock', 'scree', 'glacier']) for (const rs of L[k]) bare.push({ rings: rs, v: 1 });
    for (const p of data.pistes) if (p.area && p.pts.length > 2 && !p.gladed) bare.push({ rings: [p.pts], v: 2 });
    this.bare = new PolyIndex(bare, box);
    // the runs (their width, a ragged edge past it), the lifts, the stations, buildings and huts
    const K = this.clear = new Clear();
    for (const p of data.pistes) if (!p.area) for (let i = 0; i < p.pts.length - 1; i++) { const a = p.pts[i], b = p.pts[i + 1]; K.addSeg(a.x, a.z, b.x, b.z, p.w / 2, 6, p.gladed); }
    for (const p of data.closed || []) if (!p.area) for (let i = 0; i < p.pts.length - 1; i++) { const a = p.pts[i], b = p.pts[i + 1]; K.addSeg(a.x, a.z, b.x, b.z, p.w / 2 * 0.7, 3, false); }
    for (const Lf of data.lifts) {
      const hw = CORRIDOR(Lf.kind || '');
      for (let i = 0; i < Lf.pts.length - 1; i++) { const a = Lf.pts[i], b = Lf.pts[i + 1]; K.addSeg(a.x, a.z, b.x, b.z, hw, 3, false); }
      const st = hw >= 10 ? 26 : 12;
      for (const e of [Lf.pts[0], Lf.pts[Lf.pts.length - 1]]) K.addCircle(e.x, e.z, st);
    }
    if (L) for (const b of L.buildings) K.addCircle(b.x, b.z, b.r + 6);
    for (const p of data.places || []) K.addCircle(p.x, p.z, 18);
    // the mapped single trees and tree rows (6 m apart along a row)
    this.mapped = [];
    if (L) {
      for (const t of L.trees) this.mapped.push(t);
      for (const r of L.rows) for (let i = 0; i < r.length - 1; i++) { const a = r[i], b = r[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z); for (let s = 0; s < l; s += 6) this.mapped.push({ x: a.x + (b.x - a.x) * s / l, z: a.z + (b.z - a.z) * s / l }); }
    }
    this.cells = new Map(); this.at = null; this.job = null; this.ready = null; this.stats = { planted: 0, tested: 0, swaps: 0, ms: 0 };
    this._o = [0, 0];
  }
  key(i, j) { return (i + 4096) * 8192 + j + 4096; }
  // the elevation there is final (the fine layer, or a fine tile streamed in): trees on coarser heights would float
  fineAt(x, z) { const e = this.land.elev; return e.inFine(x, z, 20) || (e.extra && e.extra.n && e.extra.weight(x, z) > 0.999); }
  // a cell's candidates: a jittered grid, in a random order (so any first part of it is spread over the whole cell)
  cand(c) {
    if (c.cand) return c.cand;
    const r = cellRng(c.i, c.j), C = this.C, sp = this.sp, n = Math.floor(C / sp), a = new Float32Array(n * n * 4);
    let k = 0;
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) { a[k++] = c.i * C + (u + 0.15 + 0.7 * r()) * sp; a[k++] = c.j * C + (v + 0.15 + 0.7 * r()) * sp; a[k++] = r(); a[k++] = r(); }
    for (let q = n * n - 1; q > 0; q--) { const w = (r() * (q + 1)) | 0; for (let s = 0; s < 4; s++) { const t = a[q * 4 + s]; a[q * 4 + s] = a[w * 4 + s]; a[w * 4 + s] = t; } }
    return (c.cand = a);
  }
  // about how many trees a whole cell holds (from the raster, or the fallback's density)
  estimate(c) {
    if (c.est != null) return c.est;
    const C = this.C, x0 = c.i * C, z0 = c.j * C, N = (Math.floor(C / this.sp)) ** 2;
    if (this.mode === 'osm') c.est = N * (this.woods.share(x0, z0, C, 2) * 0.72 + Math.max(0, this.woods.share(x0, z0, C, 1) - this.woods.share(x0, z0, C, 2)) * 0.2);
    else { let s = 0; for (let v = 0; v < 4; v++) for (let u = 0; u < 4; u++) { const x = x0 + (u + 0.5) * C / 4, z = z0 + (v + 0.5) * C / 4; s += this.o.fallback(x, z, this.land.at(x, z)); } c.est = N * s / 16 * 0.7; }
    return c.est;
  }
  /* one candidate: a tree { x, y, z, s, rot } or null; 'later' when the ground there is not final yet */
  test(x, z, u, w) {
    if (!this.fineAt(x, z)) return 'later';
    const land = this.land, o = this._o;
    let kind = 2, edge = 40;
    if (this.mode === 'osm') {
      this.woods.cellAt(x, z, o);
      if (o[0] === 0 && o[1] > 15) return null;                  // (well outside any wood: no exact test needed)
      kind = this.woods.value(x, z); if (!kind) return null;
      edge = o[0] === kind ? o[1] : 0;
    }
    if (this.bare.value(x, z)) return null;
    // the runs, lifts and clearings (the ragged edge from the place itself, so it is the same every time)
    const rag = 0.17 + 0.83 * (0.5 + 0.5 * simplex(x * 0.045, z * 0.045));
    const cl = this.clear.at(x, z, rag); if (cl === 2) return null;
    const y = ground(x, z), e = 2.5, gx = (ground(x + e, z) - ground(x - e, z)) / (2 * e), gz = (ground(x, z + e) - ground(x, z - e)) / (2 * e), sl = Math.hypot(gx, gz);
    if (sl > 1.1) return null;                                   // (about 48 degrees: forests grow on steep slopes)
    if (land.cliff(x, z) || (land.rockR && land.rockR.at(x, z) > 0.1)) return null;
    const P = this.o.park; if (P && (P.surface(x, z) || P.height(x, z, y) > y + 0.05)) return null;
    if (this.o.feats && this.o.feats.taken(x, z)) return null;
    // how likely: denser inside the forest than at its edge, a few in a glade, scrub thin
    let p, size;
    if (this.mode === 'osm') {
      const inner = smoothstep(0, 35, edge);
      p = kind === 2 ? 0.6 + 0.35 * inner : 0.2;
      // near the forest's upper edge (no wood a little way uphill): smaller and thinner
      let up = 1;
      if (kind === 2 && sl > 0.05) { let n = 0; for (const dd of [30, 60, 95]) { this.woods.cellAt(x + gx / sl * dd, z + gz / sl * dd, o); if (o[0] >= 2) n++; } up = n / 3; }
      p *= 0.75 + 0.25 * up;
      size = kind === 2 ? (7.5 + w * 9.5) * (0.55 + 0.45 * up) * (0.85 + 0.15 * inner) : 2 + w * 2.6;
    } else {
      const d = this.o.fallback(x, z, y); p = d;
      size = (6 + w * 11) * (0.6 + 0.4 * Math.min(1, d * 1.6));
    }
    if (cl === 1) p *= 0.18;
    if (u > p) return null;
    return { x, y: y - 0.3, z, s: size, rot: frac(u * 7.77 + w * 3.31) * 6.283 };
  }
  /* the list round a point: a generator doing a little at a time (yield between pieces); returns the trees, nearest
     first, at most cap */
  *plan(fx, fz) {
    const C = this.C, R = this.Rmax, list = [], cells = [];
    for (let i = Math.floor((fx - R) / C); i <= Math.floor((fx + R) / C); i++) for (let j = Math.floor((fz - R) / C); j <= Math.floor((fz + R) / C); j++) {
      const d = Math.hypot(Math.max(0, Math.abs((i + 0.5) * C - fx) - C / 2), Math.max(0, Math.abs((j + 0.5) * C - fz) - C / 2));
      if (d > R) continue;
      const k = this.key(i, j); let c = this.cells.get(k); if (!c) this.cells.set(k, c = { i, j, tested: 0, acc: [], later: false });
      cells.push([d, c]);
    }
    cells.sort((a, b) => a[0] - b[0]);
    // the estimates (a raster tile now and then: yield between)
    let t0 = performance.now(), near = 0, far = 0;
    for (const [d, c] of cells) { const e = this.estimate(c); if (d < this.R0) near += e; else far += e * Math.pow(this.R0 / d, 1.6); if (performance.now() - t0 > 2) { yield; t0 = performance.now(); } }
    // the mapped trees first (a few), then the cells' shares to fit the cap
    const mapped = this.mapped.filter(t => (t.x - fx) ** 2 + (t.z - fz) ** 2 < R * R);
    const room = Math.max(0, this.cap * 0.96 - Math.min(mapped.length, this.cap * 0.2));
    // (kFar may pass 1: where the woods are mostly further off, more of each far cell, so the tier's count is used)
    const kNear = near > room * 0.8 ? room * 0.8 / near : 1, kFar = far > 0 ? Math.max(0, Math.min(40, (room - near * kNear) / far)) : 1;
    for (const t of mapped.slice(0, Math.floor(this.cap * 0.2))) {
      if (t.y == null) { if (!this.fineAt(t.x, t.z)) continue; const cl = this.clear.at(t.x, t.z, 0.2); if (cl || this.bare.value(t.x, t.z)) { t.y = NaN; continue; } const y = ground(t.x, t.z); t.y = y - 0.3; t.s = 9 + frac(t.x * 0.37 + t.z * 0.11) * 7; t.rot = frac(t.x * 0.013) * 6.28; t.mapped = true; }
      if (Number.isFinite(t.y)) list.push(t);
    }
    const n0 = Math.floor(C / this.sp) ** 2;
    for (const [d, c] of cells) {
      const f = d < this.R0 ? kNear : Math.min(kNear, kFar * Math.pow(this.R0 / d, 1.6)), want = Math.min(n0, Math.ceil(n0 * f));
      if (c.tested < want && !c.done) {
        const a = this.cand(c);
        while (c.tested < want) {
          const q = c.tested * 4, t = this.test(a[q], a[q + 1], a[q + 2], a[q + 3]);
          if (t === 'later') { c.later = true; break; }
          if (t) { t.k = c.tested; c.acc.push(t); }
          c.tested++; this.stats.tested++;
          if ((c.tested & 3) === 0 && performance.now() - t0 > 2) { yield; t0 = performance.now(); }
        }
        if (c.tested >= n0) c.done = true;
      }
      for (const t of c.acc) { if (t.k >= want) break; if (list.length >= this.cap) break; list.push(t); }
      if (list.length >= this.cap) break;
    }
    // (cells far off forgotten, so the memory stays small)
    if (this.cells.size > 2600) for (const [k, c] of this.cells) if (Math.hypot((c.i + 0.5) * C - fx, (c.j + 0.5) * C - fz) > R * 1.6) this.cells.delete(k);
    this.stats.planted = list.length;
    return list;
  }
  /* a box whose ground changed (a fine tile streamed in, or let go past the cap and back to the coarse ground): its cells
     are planted again at the next list, so no tree stands on heights that are no longer there */
  forget(b) {
    const C = this.C;
    for (let i = Math.floor(b.x0 / C); i <= Math.floor(b.x1 / C); i++) for (let j = Math.floor(b.z0 / C); j <= Math.floor(b.z1 / C); j++) this.cells.delete(this.key(i, j));
  }
  // the first list, at once (the start)
  // (the start's own: only out to 800 m, so the start is not held up; the rest comes a few milliseconds a frame after)
  initial(fx, fz) {
    const t0 = performance.now(), R = this.Rmax; this.Rmax = Math.min(R, 800);
    const g = this.plan(fx, fz); let r;
    try { do r = g.next(); while (!r.done); } finally { this.Rmax = R; }
    this.at = { x: fx, z: fz, streamed: this.land.elev.extra ? this.land.elev.extra.n : 0, partial: true }; this.stats.ms = Math.round(performance.now() - t0);
    return r.value;
  }
  /* each frame: a new list once the camera is 120 m from where the last was made (or new fine ground has come), worked
     out a few milliseconds a frame; returns it when done */
  frame(cam, budget) {
    if (this.job) {
      const until = performance.now() + budget;
      while (performance.now() < until) { const r = this.job.next(); if (r.done) { this.job = null; this.stats.swaps++; return r.value; } }
      return null;
    }
    const s = this.land.elev.extra ? this.land.elev.extra.n : 0;
    if (!this.at || this.at.partial || Math.hypot(cam.x - this.at.x, cam.z - this.at.z) > 120 || s !== this.at.streamed && Math.hypot(cam.x - this.at.x, cam.z - this.at.z) > 20) {
      this.at = { x: cam.x, z: cam.z, streamed: s };
      this.job = this.plan(cam.x, cam.z);
    }
    return null;
  }
}

/* the forest drawn from a list that changes: world.js's Forest (near conifers, far cards, collisions), its buffers made
   as large as the tier's count once, and refilled when the list round the camera is new */
export class WorldForest extends Forest {
  constructor(scene, q, mtn, stream) {
    super(scene, q, mtn);
    this.stream = stream; this.budget = q.tier === 'low' ? 2 : 3;
    const cap = this.cap = stream.cap, far = this.far;
    far.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); far.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.aNear = new Float32Array(cap);
    const an = new THREE.InstancedBufferAttribute(this.aNear, 1); an.setUsage(THREE.DynamicDrawUsage); far.geometry.setAttribute('aNear', an);
    this.mNear = new Float32Array(cap * 16); this.cols = new Float32Array(cap * 3);
    this.swap(this.trees);
    if (typeof window !== 'undefined') window.__skiForest = this;
  }
  swap(list) {
    const n = Math.min(list.length, this.cap), far = this.far, fa = far.instanceMatrix.array, fc = far.instanceColor.array;
    this.trees = list.length > n ? list.slice(0, n) : list;
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), Y = THREE.Object3D.DEFAULT_UP;
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const t = this.trees[i];
      qq.setFromAxisAngle(Y, t.rot); pp.set(t.x, t.y, t.z);
      const w = t.s * (0.8 + 0.22 * frac(t.rot * 7.31));
      m.compose(pp, qq, sc.set(w, t.s, w)); m.toArray(this.mNear, i * 16); m.toArray(fa, i * 16);
      const h = frac(t.rot * 13.7), b = 0.9 + 0.2 * frac(t.rot * 5.3), ww = (h - 0.5) * 0.12;
      this.cols[i * 3] = fc[i * 3] = b * (1 + ww * 0.6); this.cols[i * 3 + 1] = fc[i * 3 + 1] = b; this.cols[i * 3 + 2] = fc[i * 3 + 2] = b * (1 - ww);
      this.tx[i] = t.x; this.tz[i] = t.z; this.aNear[i] = 0;
      const k = Math.floor(t.x / 8) + ',' + Math.floor(t.z / 8); let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(t);
    }
    far.count = n;
    for (const a of [far.instanceMatrix, far.instanceColor, far.geometry.attributes.aNear]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(a.itemSize, n * a.itemSize)); a.needsUpdate = true; }
    this.at.set(1e9, 0, 0);          // (the near list made again next update)
  }
  update(cam) {
    const list = this.stream.frame(cam, this.budget);
    if (list) this.swap(list);
    super.update(cam);
  }
}
