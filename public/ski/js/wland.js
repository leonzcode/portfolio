/* (W, round 10) Any mountain on Earth: the mountain itself for terrain.js's hook (setMountain), from the elevation
   (wdem.js) and OpenStreetMap's runs (wosm.js):
   - at(x, z): the ground (the elevation, less the place's own height, so the origin is about 0), with the off-piste
     snow's own lumps (none on a groomed run);
   - groom(x, z): 0..1, how much of a groomed run's corduroy is here (a raster of every groomed run, its real width
     where OpenStreetMap has it, else what runs of its difficulty usually are, with soft edges), for the snow's look
     (terrain.js aGroom) and the riding (surface 0, groomed);
   - cliff(x, z): rock faces (the elevation's slope over about 45 degrees, and the generated drops, wpark.js), for the
     physics' walls and the rock drawn on the snow;
   - trees(max, random): where forest is (from the satellite picture's green, Esri World Imagery, as Leonski 2 does it;
     else below a treeline worked out from the latitude), off the runs, lift lines and anything steep. */
import { simplex, fbm, smoothstep, clamp } from './noise.js?v=26';
import { lat2my, lon2mx } from './wdem.js?v=26';

const RAD = Math.PI / 180;

// a byte raster over a square of the world: cell metres, its corner, n cells a side
class Raster {
  constructor(x0, z0, size, cell) {
    this.cell = cell; this.n = Math.ceil(size / cell); this.x0 = x0; this.z0 = z0; this.inv = 1 / cell;
    this.a = new Uint8Array(this.n * this.n);
  }
  // bilinear, 0..1 (0 outside)
  at(x, z) {
    const n = this.n, fx = (x - this.x0) * this.inv - 0.5, fz = (z - this.z0) * this.inv - 0.5;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return 0;
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, a = this.a, o = j * n + i;
    return ((a[o] * (1 - u) + a[o + 1] * u) * (1 - v) + (a[o + n] * (1 - u) + a[o + n + 1] * u) * v) / 255;
  }
  raw(x, z) { const i = ((x - this.x0) * this.inv) | 0, j = ((z - this.z0) * this.inv) | 0; return i < 0 || j < 0 || i >= this.n || j >= this.n ? 0 : this.a[j * this.n + i]; }
  // a line of half width hw (m), full inside, nothing past hw + soft
  line(ax, az, bx, bz, hw, soft, v = 255) {
    const n = this.n, inv = this.inv, R = hw + soft, a = this.a;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - this.x0) * inv)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + R - this.x0) * inv));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - this.z0) * inv)), j1 = Math.min(n - 1, Math.floor((Math.max(az, bz) + R - this.z0) * inv));
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.cell;
        let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - ax - dx * t, ez = z - az - dz * t, d = Math.sqrt(ex * ex + ez * ez);
        if (d >= R) continue;
        const w = d <= hw ? v : Math.round(v * (1 - (d - hw) / soft));
        const o = j * n + i; if (w > a[o]) a[o] = w;
      }
    }
  }
  // a filled polygon (even-odd, at the cells' middles)
  poly(pts, v = 255) {
    const n = this.n, a = this.a; let zmin = Infinity, zmax = -Infinity;
    for (const p of pts) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
    const j0 = Math.max(0, Math.floor((zmin - this.z0) * this.inv)), j1 = Math.min(n - 1, Math.floor((zmax - this.z0) * this.inv));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cell; xs.length = 0;
      for (let k = 0, m = pts.length; k < m; k++) { const p = pts[k], q = pts[(k + 1) % m]; if ((p.z <= z) !== (q.z <= z)) xs.push(p.x + (z - p.z) / (q.z - p.z) * (q.x - p.x)); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) * this.inv - 0.5)), i1 = Math.min(n - 1, Math.floor((xs[k + 1] - this.x0) * this.inv - 0.5));
        for (let i = i0; i <= i1; i++) { const o = j * n + i; if (v > a[o]) a[o] = v; }
      }
    }
  }
  // soften: a 3-cell box blur across then down (once)
  blur() {
    const n = this.n, a = this.a, t = new Uint8Array(a.length);
    for (let j = 0; j < n; j++) { const o = j * n; for (let i = 0; i < n; i++) t[o + i] = (a[o + Math.max(0, i - 1)] + a[o + i] + a[o + Math.min(n - 1, i + 1)]) / 3; }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = (t[Math.max(0, j - 1) * n + i] + t[j * n + i] + t[Math.min(n - 1, j + 1) * n + i]) / 3;
  }
}

// the treeline from the latitude alone (where no picture of the forest came): high in the tropics, 2100 m in the Alps,
// 1800 m at 50 degrees, low in the far north and south
export function treelineFor(lat) { const a = Math.abs(lat); return a < 28 ? 3700 : Math.max(300, 3700 - (a - 28) * 85 - Math.max(0, a - 52) * 40); }

export class WorldLand {
  /* frame, elev (wdem Elevation, loaded), data (wosm parse), opts { low } */
  constructor(frame, elev, data, opts = {}) {
    this.frame = frame; this.elev = elev; this.data = data; this.low = !!opts.low;
    this.y0 = Math.round(elev.at(0, 0));               // (heights relative to the place's own, a whole metre)
    const E = elev.fineExtent();
    this.ext = E;
    const size = Math.max(E.x1 - E.x0, E.z1 - E.z0);
    const cell = Math.max(this.low ? 5 : 4, size / 2600);
    // ---- the groomed runs
    const G = this.groomR = new Raster(E.x0, E.z0, size, cell);
    // ---- every run (groomed or not, for the side hits and signs), and the parks
    const R = this.runR = new Raster(E.x0, E.z0, size, cell * 2);
    for (const p of data.pistes) {
      const hw = p.w / 2;
      if (p.area) { if (p.groom) G.poly(p.pts); R.poly(p.pts); }
      for (let i = 0; i < p.pts.length - 1; i++) {
        const a = p.pts[i], b = p.pts[i + 1];
        if (p.area) { R.line(a.x, a.z, b.x, b.z, 0, cell * 2); if (p.groom) G.line(a.x, a.z, b.x, b.z, 0, 2 * cell); continue; }
        if (p.groom) G.line(a.x, a.z, b.x, b.z, hw, 2.5 * cell);
        R.line(a.x, a.z, b.x, b.z, hw, cell * 2);
      }
    }
    G.blur();
    /* and every groomed run past the built area, coarser (10 m cells, 12 on the low tier, over the middle elevation's
       20 km), for the snow streamed in round a rider who leaves it (wdem.js stream) */
    {
      const M = elev.mid.extent(), ms = Math.max(M.x1 - M.x0, M.z1 - M.z0), C = this.groomC = new Raster(M.x0, M.z0, ms, this.low ? 12 : 10);
      for (const p of data.pistes) if (p.groom) {
        if (p.area) C.poly(p.pts);
        for (let i = 0; i < p.pts.length - 1; i++) { const a = p.pts[i], b = p.pts[i + 1]; C.line(a.x, a.z, b.x, b.z, p.area ? 0 : p.w / 2, C.cell * 1.5); }
      }
    }
    this.gx0 = G.x0 + G.cell; this.gz0 = G.z0 + G.cell; this.gx1 = G.x0 + (G.n - 1) * G.cell; this.gz1 = G.z0 + (G.n - 1) * G.cell;
    // the off-piste snow's lumps: none on a groomed run, about half a metre elsewhere
    this.bare = true;
    // ---- rock: the elevation's slope over a raster (8 m), a face over about 45 degrees (generated drops add to it)
    this.cliffR = null;
  }
  // the ground's height (metres over the place's own)
  at(x, z) {
    const h = this.elev.at(x, z) - this.y0;
    const g = this.groom(x, z);
    if (g > 0.98) return h;
    // (two octaves of simplex: lumps of about 16 m and 6 m)
    const r = 0.32 * simplex(x * 0.06, z * 0.06) + 0.14 * simplex(x * 0.17 + 7.1, z * 0.17 - 3.3) + 0.22 * Math.max(0, simplex(x * 0.11 + 4, z * 0.11));
    return h + r * (1 - g);
  }
  groom(x, z) { return x > this.gx0 && z > this.gz0 && x < this.gx1 && z < this.gz1 ? this.groomR.at(x, z) : this.groomC.at(x, z); }
  onRun(x, z) { return this.runR.at(x, z); }
  // the slope's steepness (the normal's y) from the elevation alone, over s metres
  ny(x, z, s = 6) { const e = this.elev, gx = (e.at(x + s, z) - e.at(x - s, z)) / (2 * s), gz = (e.at(x, z + s) - e.at(x, z - s)) / (2 * s); return 1 / Math.sqrt(1 + gx * gx + gz * gz); }
  /* the rock raster over the fine area: a face where the elevation is steeper than about 45 degrees (ny under 0.72),
     worked out once (8 m cells, the slope over 16 m), plus whatever the generated drops add (wpark.js, rock()) */
  buildRock() {
    const E = this.ext, size = Math.max(E.x1 - E.x0, E.z1 - E.z0), cell = 8;
    const C = this.cliffR = new Raster(E.x0, E.z0, size, cell), n = C.n, a = C.a;
    // (the heights on the cells' own grid once, then each cell's slope from its neighbours either side: a quarter of
    // the elevation lookups of asking four points round every cell)
    const M = n + 2, h = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) h[j * M + i] = this.elev.at(E.x0 + (i - 0.5) * cell, E.z0 + (j - 0.5) * cell);
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const o = (j + 1) * M + i + 1, gx = (h[o + 1] - h[o - 1]) / (2 * cell), gz = (h[o + M] - h[o - M]) / (2 * cell);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      if (ny < 0.74) a[k] = Math.min(255, Math.round((0.74 - ny) / 0.12 * 255));
    }
    return C;
  }
  cliff(x, z) { return this.cliffR ? this.cliffR.raw(x, z) > 90 : false; }
  rockAmt(x, z) { return this.cliffR ? this.cliffR.at(x, z) : 0; }
}

/* ---- the forest: from the satellite picture (Esri World Imagery), as Leonski 2 reads it -------------------------------
   The tiles over the fine area at about 13 m a pixel, blurred, each cell's "green over red and blue" and brightness:
   a conifer stand is green and middling bright, snow and rock are bright, burnt stands brownish. A grid of forest
   cover 0..1. Every tile has a time limit; none at all is null (the treeline is used then). */
const SAT = (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export async function forestCover(frame, ext, ms = 12000) {
  const size = Math.max(ext.x1 - ext.x0, ext.z1 - ext.z0), cx = (ext.x0 + ext.x1) / 2, cz = (ext.z0 + ext.z1) / 2;
  // a zoom whose tiles are about 3 to 4 km here
  const Z = clamp(Math.round(Math.log2(frame.S / 3400)), 10, 14);
  const n = 2 ** Z, mx = v => (v / frame.S + frame.mx0) * n, my = v => (v / frame.S + frame.my0) * n;
  const tx0 = Math.floor(mx(ext.x0)), tx1 = Math.floor(mx(ext.x1)), ty0 = Math.floor(my(ext.z0)), ty1 = Math.floor(my(ext.z1));
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
  if (nx * ny > 36) return null;
  const cv = new OffscreenCanvas(nx * 256, ny * 256), cx2 = cv.getContext('2d', { willReadFrequently: true });
  let got = 0;
  await Promise.all(Array.from({ length: nx * ny }, async (_, k) => {
    const i = k % nx, j = (k / nx) | 0, ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(SAT(Z, tx0 + i, ty0 + j), { mode: 'cors', signal: ac.signal });
      if (!r.ok) throw new Error(r.status);
      const bmp = await createImageBitmap(await r.blob());
      cx2.drawImage(bmp, i * 256, j * 256); bmp.close && bmp.close(); got++;
    } catch (e) {} finally { clearTimeout(t); }
  }));
  if (got < nx * ny * 0.5) return null;
  // blurred: drawn down to a quarter and back, so stands read as wholes, not single trees
  const W = nx * 256, H = ny * 256, sw = Math.max(32, W >> 2), sh = Math.max(32, H >> 2);
  const small = new OffscreenCanvas(sw, sh), sx = small.getContext('2d', { willReadFrequently: true });
  sx.imageSmoothingEnabled = true; sx.drawImage(cv, 0, 0, sw, sh);
  const d = sx.getImageData(0, 0, sw, sh).data;
  // the grid: forest cover per cell over the local square the tiles cover
  const g = new Float32Array(sw * sh);
  for (let k = 0; k < sw * sh; k++) {
    const r = d[k * 4], gg = d[k * 4 + 1], b = d[k * 4 + 2], green = gg - (r + b) / 2, bright = (r + gg + b) / 3, brown = r - b;
    let c = 0;
    if (bright > 28 && bright < 175) {
      if (green > 3) c = clamp((green - 3) / 22, 0, 1);
      else if (green > -6 && brown > 12 && bright < 125) c = clamp((brown - 12) / 40, 0, 0.5) * 0.4;
      // (dark conifers in winter pictures read nearly grey: dark and a touch blue-green)
      else if (bright < 70 && gg >= r - 2) c = 0.45;
    }
    g[k] = c;
  }
  const x0 = (tx0 / n - frame.mx0) * frame.S, z0 = (ty0 / n - frame.my0) * frame.S, span = frame.S / n;   // a tile's metres
  return {
    at(x, z) {
      const u = (x - x0) / (nx * span) * sw - 0.5, v = (z - z0) / (ny * span) * sh - 0.5;
      if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) return -1;
      const i = u | 0, j = v | 0, a = u - i, bb = v - j, o = j * sw + i;
      return (g[o] * (1 - a) + g[o + 1] * a) * (1 - bb) + (g[o + sw] * (1 - a) + g[o + sw + 1] * a) * bb;
    },
    Z, tiles: nx * ny,
  };
}
