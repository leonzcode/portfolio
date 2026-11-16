/* (N, round 12) The Nines map's ground: real elevation baked small for the venue (AWS Terrain Tiles, open data, read
   offline and stored in data/<id>/ as Terrarium RGB PNGs: h = R*256 + G + B/256 - 32768 metres above the sea), in the
   map's own frame: +z down the course's fall line, +x across it, y up, the origin at the course's start.
   Two grids: a fine one over the course and the slopes round it, and a coarse one out to the skyline's peaks. The fine
   grid blends into the coarse one over its outer edge. Heights are relative to the course start (y 0 there). */
const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

// one baked grid: { x0, z0, step, nx, nz, h: Float32Array (metres above the sea) }
async function loadGrid(url, info) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const W = bmp.width, H = bmp.height;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
  const d = x.getImageData(0, 0, W, H).data, h = new Float32Array(W * H);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return { x0: info.x0, z0: info.z0, step: info.step, nx: W, nz: H, h };
}
class Grid {
  constructor(g) { Object.assign(this, g); this.x1 = this.x0 + (this.nx - 1) * this.step; this.z1 = this.z0 + (this.nz - 1) * this.step; }
  // Catmull-Rom between the samples (smooth slopes between them)
  at(x, z) {
    const { nx, nz, h } = this;
    let u = (x - this.x0) / this.step, v = (z - this.z0) / this.step;
    u = Math.max(0, Math.min(nx - 1.001, u)); v = Math.max(0, Math.min(nz - 1.001, v));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const g = (ii, jj) => h[(jj < 0 ? 0 : jj >= nz ? nz - 1 : jj) * nx + (ii < 0 ? 0 : ii >= nx ? nx - 1 : ii)];
    const row = jj => cr(g(i - 1, jj), g(i, jj), g(i + 1, jj), g(i + 2, jj), fu);
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fv);
  }
  // metres inside the grid's edge (negative outside)
  inside(x, z) { return Math.min(x - this.x0, this.x1 - x, z - this.z0, this.z1 - z); }
}
export class NinesLand {
  constructor(near, far, meta, mid) {
    this.near = new Grid(near); this.far = new Grid(far); this.meta = meta;
    this.mid = mid ? new Grid(mid) : null;               // (a middle grid out to the skyline's nearer peaks, if baked)
    this.y0 = this.near.at(0, 0);                      // (the course's start, metres above the sea)
    this.band = Math.min(300, (this.near.x1 - this.near.x0) * 0.15);
    if (meta.snowline == null) meta.snowline = 1600;
    /* rock tops the elevation model smooths away (its source is about 25 m a sample here): a smooth bump of h metres,
       r round, raising the ground to the height a mapped point really has (the Birg station's rock, the summit) */
    this.bumps = [];
  }
  bump(x, z) { let a = 0; for (const b of this.bumps) { const d = Math.hypot(x - b.x, z - b.z) / b.r; if (d < 1) { const c = Math.cos(d * Math.PI) * 0.5 + 0.5; a += b.h * Math.pow(c, b.k || 1); } } return a; }
  // the natural ground, relative to the start
  at(x, z) { return this.nat(x, z) + (this.bumps.length ? this.bump(x, z) : 0); }
  nat(x, z) {
    const d = this.near.inside(x, z);
    if (d >= this.band) return this.near.at(x, z) - this.y0;
    const c = this.coarse(x, z) - this.y0;
    if (d <= 0) return c;
    const t = d / this.band, s = t * t * (3 - 2 * t);
    return c + (this.near.at(x, z) - this.y0 - c) * s;
  }
  // the far grid, or the middle one where it reaches (blended into the far one over its last 1.5 km)
  coarse(x, z) {
    const f = this.far.at(x, z); if (!this.mid) return f;
    const d = this.mid.inside(x, z); if (d <= 0) return f;
    const m = this.mid.at(x, z); if (d >= 1500) return m;
    const t = d / 1500, k = t * t * (3 - 2 * t); return f + (m - f) * k;
  }
  farAt(x, z) { return this.coarse(x, z) - this.y0 + (this.bumps.length ? this.bump(x, z) : 0); }
}
// the land of map id: data/<id>/dem.json, near.png, far.png
export async function loadLand(base) {
  const meta = await (await fetch(base + 'dem.json?v=28')).json();
  const gi = n => meta.grids.find(g => g.name === n);
  const [near, far, mid] = await Promise.all([loadGrid(base + 'near.png?v=28', gi('near')), loadGrid(base + 'far.png?v=28', gi('far')), gi('mid') ? loadGrid(base + 'mid.png?v=28', gi('mid')) : null]);
  return new NinesLand(near, far, meta, mid);
}
