/* (W, round 10) Any mountain on Earth: the ground's heights from open elevation data, for any place.
   Terrarium tiles (AWS Terrain Tiles, open data: SRTM, EU-DEM, USGS 3DEP, Canada's CDEM and others, collected by
   Mapzen), read in the browser, in three layers round the place:
   - fine: zoom 14 (about 7 m a sample at 46 degrees) in a square of tiles round where you ride (4 x 4 on the low tier,
     5 x 5 above), about 7 to 12 km across;
   - mid: zoom 12 (about 27 m) in 3 x 3 tiles round it, about 20 km;
   - far: zoom 10 (about 106 m) in 3 x 3 tiles, about 80 km, the horizon.
   Each layer blends into the next over its outer edge, so nowhere is there a step between them.
   Local metres: a Web Mercator scaled to metres at the place (conformal; within 10 km of the middle its scale is out
   by a few tenths of a percent, which nobody can ride or see), +x east, +z south, y up, the origin at the place. In this
   frame a tile's pixels lie on a straight grid, so a height is one multiply and add from the local metres. */

const C = 40075016.686;                         // the Earth's circumference at the equator (m)
const DEG = Math.PI / 180;
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const lon2mx = lon => (lon + 180) / 360;
export const lat2my = lat => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * DEG); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
export const mx2lon = x => x * 360 - 180;
export const my2lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG;

// the local frame: lat0, lon0 at the origin
export class Frame {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    this.mx0 = lon2mx(lon0); this.my0 = lat2my(lat0);
    this.S = C * Math.cos(lat0 * DEG);           // metres in one whole Mercator unit, at the origin
  }
  toLocal(lat, lon, out = { x: 0, z: 0 }) { out.x = (lon2mx(lon) - this.mx0) * this.S; out.z = (lat2my(lat) - this.my0) * this.S; return out; }
  toLatLon(x, z) { return { lat: my2lat(z / this.S + this.my0), lon: mx2lon(x / this.S + this.mx0) }; }
  // a tile's (x, y) at zoom Z under a local point
  tileAt(x, z, Z) { const n = 2 ** Z; return [Math.floor((x / this.S + this.mx0) * n), Math.floor((z / this.S + this.my0) * n)]; }
}

/* ---- one tile's heights ------------------------------------------------------------------------------------------------
   Kept in the Cache Storage (ski-dem-v1) after the first time, so a place opened again needs no download; the HTTP cache
   alone was not dependable (the tiles carry no Cache-Control). Each fetch has a time limit and is tried twice. */
const CACHE = 'ski-dem-v1';
let cacheP = null;
const cacheOpen = () => cacheP || (cacheP = (typeof caches !== 'undefined' ? caches.open(CACHE).catch(() => null) : Promise.resolve(null)));
export const demStats = { fetched: 0, cached: 0, failed: 0, bytes: 0, ms: 0 };
async function fetchTile(z, x, y, ms = 15000) {
  const url = TILE_URL(z, x, y);
  const c = await cacheOpen();
  if (c) { try { const r = await c.match(url); if (r) { demStats.cached++; return await r.blob(); } } catch (e) {} }
  for (let k = 0; k < 2; k++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try {
      const t0 = performance.now();
      const r = await fetch(url, { mode: 'cors', signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('tile ' + r.status);
      const b = await r.blob();
      demStats.fetched++; demStats.bytes += b.size; demStats.ms += performance.now() - t0;
      if (c) c.put(url, new Response(b, { headers: { 'Content-Type': 'image/png' } })).catch(() => {});
      return b;
    } catch (e) { clearTimeout(t); if (k === 1) { demStats.failed++; throw e; } }
  }
}
let decodeCanvas = null;
async function decodeTile(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (!decodeCanvas) decodeCanvas = new OffscreenCanvas(256, 256);
  const x = decodeCanvas.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, 256, 256); x.drawImage(bmp, 0, 0); bmp.close && bmp.close();
  const d = x.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return h;
}

/* ---- a layer: a rectangle of tiles at one zoom, stitched into one array --------------------------------------------- */
const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
class Layer {
  constructor(frame, Z, tx0, ty0, n, band) {
    // n x n tiles from tile (tx0, ty0)
    this.frame = frame; this.Z = Z; this.n = n; this.band = band;
    this.tx0 = tx0; this.ty0 = ty0;
    this.W = n * 256; this.h = new Float32Array(this.W * this.W);
    this.got = new Uint8Array(n * n);
    // local metres to array index: idx = x * k + ox (a pixel's value sits at its middle, so half a pixel less)
    const k = 2 ** Z * 256 / frame.S;
    this.k = k; this.ox = frame.mx0 * 2 ** Z * 256 - this.tx0 * 256 - 0.5; this.oy = frame.my0 * 2 ** Z * 256 - this.ty0 * 256 - 0.5;
    this.ready = false;
  }
  async load(onTile, from = null) {
    const jobs = [];
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      jobs.push(fetchTile(this.Z, this.tx0 + i, this.ty0 + j).then(decodeTile).then(t => {
        const W = this.W; for (let y = 0; y < 256; y++) this.h.set(t.subarray(y * 256, y * 256 + 256), (j * 256 + y) * W + i * 256);
        this.got[j * this.n + i] = 1; if (onTile) onTile(true);
      }, e => { console.warn('elevation tile', this.Z, this.tx0 + i, this.ty0 + j, e && e.message); if (onTile) onTile(false); }));
    }
    await Promise.all(jobs);
    // a tile that did not come: filled from the coarser layer, so the ground is still there (a little blurrier)
    if (from) for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      if (this.got[j * this.n + i]) continue;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const px = i * 256 + x, py = j * 256 + y;
        this.h[py * this.W + px] = from.sample((px - this.ox) / this.k, (py - this.oy) / this.k);
      }
    }
    this.ready = this.got.some(v => v) || !!from;
    return this;
  }
  // how far a local point is inside the layer's edge, in its own pixels (negative outside)
  inside(x, z) {
    const px = x * this.k + this.ox, py = z * this.k + this.oy, W = this.W;
    return Math.min(px - 1, py - 1, W - 3 - px, W - 3 - py);
  }
  // the height at a local point, Catmull-Rom across 4 x 4 samples (smooth slopes between them)
  sample(x, z) {
    let px = x * this.k + this.ox, py = z * this.k + this.oy;
    const W = this.W, h = this.h;
    if (px < 1) px = 1; else if (px > W - 2.001) px = W - 2.001;
    if (py < 1) py = 1; else if (py > W - 2.001) py = W - 2.001;
    const i = px | 0, j = py | 0, u = px - i, v = py - j;
    let o = (j - 1) * W + i - 1;
    const r0 = cr(h[o], h[o + 1], h[o + 2], h[Math.min(o + 3, h.length - 1)], u); o += W;
    const r1 = cr(h[o], h[o + 1], h[o + 2], h[o + 3], u); o += W;
    const r2 = cr(h[o], h[o + 1], h[o + 2], h[o + 3], u); o += W;
    const r3 = o + 3 < h.length ? cr(h[o], h[o + 1], h[o + 2], h[o + 3], u) : r2;
    return cr(r0, r1, r2, r3, v);
  }
  // the local square the layer covers
  extent() { return { x0: (0.5 - this.ox) / this.k, z0: (0.5 - this.oy) / this.k, x1: (this.W + 0.5 - this.ox) / this.k, z1: (this.W + 0.5 - this.oy) / this.k }; }
}
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/* ---- the fine heights streamed in round the rider, past the area built (Elevation.stream) ------------------------------
   Zoom 14 tiles kept one by one (never dropped, up to a cap), joining the built window's own: where both are there the
   ground is zoom 14 throughout, and it eases into the coarser layers only towards the edge of what has come. The built
   window's tiles count as there, so the two join without a seam. */
class Sparse {
  constructor(frame, fine, band) {
    this.frame = frame; this.fine = fine; this.band = band; this.tiles = new Map(); this.loading = new Set();
    const Z = 14; this.k = 2 ** Z * 256 / frame.S; this.ox = frame.mx0 * 2 ** Z * 256 - 0.5; this.oy = frame.my0 * 2 ** Z * 256 - 0.5;
    this.n = 0;
  }
  key(i, j) { return i * 65536 + j; }
  inFineTile(i, j) { const F = this.fine; return i >= F.tx0 && j >= F.ty0 && i < F.tx0 + F.n && j < F.ty0 + F.n; }
  there(i, j) { return this.inFineTile(i, j) || this.tiles.has(this.key(i, j)); }
  // a pixel's height (global pixel numbers at zoom 14); a missing tile's: NaN
  px(gx, gy) {
    const i = gx >> 8, j = gy >> 8;
    if (this.inFineTile(i, j)) { const F = this.fine; return F.h[(gy - F.ty0 * 256) * F.W + gx - F.tx0 * 256]; }
    const t = this.tiles.get(this.key(i, j)); return t ? t[(gy & 255) * 256 + (gx & 255)] : NaN;
  }
  // how much of the streamed heights at a point (0..1): none on a missing tile, easing off within band px of one
  weight(x, z) {
    if (!this.n) return 0;
    const px = x * this.k + this.ox, py = z * this.k + this.oy, i = Math.floor(px / 256), j = Math.floor(py / 256);
    if (!this.there(i, j)) return 0;
    const u = px - i * 256, v = py - j * 256; let d = 1e9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!a && !b || this.there(i + a, j + b)) continue;
      const dx = a < 0 ? u : a > 0 ? 256 - u : 0, dy = b < 0 ? v : b > 0 ? 256 - v : 0;
      d = Math.min(d, a && b ? Math.hypot(dx, dy) : a ? dx : dy);
    }
    return ease((d - 2) / this.band);
  }
  sample(x, z) {
    const px = x * this.k + this.ox, py = z * this.k + this.oy, i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j;
    const r = jj => cr(this.px(i - 1, jj), this.px(i, jj), this.px(i + 1, jj), this.px(i + 2, jj), u);
    return cr(r(j - 1), r(j), r(j + 1), r(j + 2), v);
  }
  // the local box a tile covers, and band pixels round it
  box(i, j) { const k = this.k, m = this.band + 4; return { x0: (i * 256 - m - this.ox) / k, z0: (j * 256 - m - this.oy) / k, x1: ((i + 1) * 256 + m - this.ox) / k, z1: ((j + 1) * 256 + m - this.oy) / k }; }
}

/* ---- the elevation for a place ---------------------------------------------------------------------------------------
   new Elevation(frame, cx, cz, fineN): the fine window's middle at local (cx, cz); load(progress) gets all three layers
   (progress(done, all) after each tile). at(x, z) is the height in metres above the sea. */
export class Elevation {
  constructor(frame, cx, cz, fineN = 5) {
    this.frame = frame;
    // (n tiles whose middle is nearest the point: the first one at the point less n/2 tiles, rounded)
    const first = (Z, n) => { const k = 2 ** Z; return [Math.round((cx / frame.S + frame.mx0) * k - n / 2), Math.round((cz / frame.S + frame.my0) * k - n / 2)]; };
    const f = first(14, fineN), m = first(12, 3), r = first(10, 3);
    this.fine = new Layer(frame, 14, f[0], f[1], fineN, 48);
    this.mid = new Layer(frame, 12, m[0], m[1], 3, 40);
    this.far = new Layer(frame, 10, r[0], r[1], 3, 24);
    this.extra = new Sparse(frame, this.fine, 48);
  }
  async load(progress) {
    const all = this.fine.n ** 2 + 18; let done = 0;
    const tick = () => { done++; if (progress) progress(done, all); };
    // (the far and mid first, so a fine tile that does not come can be filled from them)
    await Promise.all([this.far.load(tick), this.mid.load(tick)]);
    if (!this.far.ready && !this.mid.ready) throw new Error('no elevation came');
    if (!this.mid.ready) await this.mid.load(null, this.far);
    await this.fine.load(tick, this.mid);
    return this;
  }
  // the height above the sea at a local point: the finest layer there, eased into the next over its edge
  at(x, z) {
    const F = this.fine, df = F.inside(x, z);
    if (df > F.band) return F.sample(x, z);
    const M = this.mid, dm = M.inside(x, z);
    let m;
    if (dm > M.band) m = M.sample(x, z);
    else { const fa = this.far.sample(x, z); m = dm <= 0 ? fa : fa + (M.sample(x, z) - fa) * ease(dm / M.band); }
    // (the fine heights streamed round the rider, where they have come)
    const X = this.extra; if (X.n) { const w = X.weight(x, z); if (w > 0) m += (X.sample(x, z) - m) * w; }
    if (df <= 0) return m;
    return m + (F.sample(x, z) - m) * ease(df / F.band);
  }
  /* the fine tiles round a point (the rider) that are not there yet, asked for: those within r tiles of it, at most cap
     kept in all; done(box) is told each local box whose heights changed (a tile come and the band round it), for the
     terrain to build its patches there again */
  stream(x, z, done, r = 1.4, cap = 40) {
    const X = this.extra; if (X.n + X.loading.size >= cap) return;
    const px = (x * X.k + X.ox) / 256, py = (z * X.k + X.oy) / 256, i0 = Math.floor(px), j0 = Math.floor(py);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const i = i0 + a, j = j0 + b, key = X.key(i, j);
      if (X.there(i, j) || X.loading.has(key) || X.n + X.loading.size >= cap) continue;
      // (the nearest point of the tile within r tiles)
      const dx = Math.max(i - px, 0, px - (i + 1)), dy = Math.max(j - py, 0, py - (j + 1));
      if (Math.hypot(dx, dy) > r) continue;
      X.loading.add(key);
      fetchTile(14, i, j).then(decodeTile).then(t => { X.tiles.set(key, t); X.n = X.tiles.size; X.loading.delete(key); if (done) done(X.box(i, j)); }, () => { setTimeout(() => X.loading.delete(key), 30000); });
    }
  }
  // only the fine layer and the mid one round it (for things that must agree with the riding: the same as at() there)
  fineExtent() { return this.fine.extent(); }
  farExtent() { return this.far.extent(); }
  // where the fine heights are whole (not eased into the coarser ones): a margin in metres in from the fine edge
  inFine(x, z, m = 0) { return this.fine.inside(x, z) > this.fine.band + m * this.fine.k; }
}
