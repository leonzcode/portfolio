// A real mountain from open elevation data: Terrarium tiles (AWS Terrain Tiles, open data: SRTM, USGS 3DEP, GMTED and
// others, collected by Mapzen), read in the browser. A fine grid round the start (zoom 14, about 8 m a sample) and a
// coarse one for the horizon (zoom 11, about 60 m). Local metres: +x east, +z south, y up, origin at the start.
const TILE = z => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/{x}/{y}.png`;

const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

async function tileHeights(url) {
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error('tile ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const c = new OffscreenCanvas(256, 256), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return h;
}

// a grid of n x n tiles at zoom z round lat, lon, as local metres
class Grid {
  constructor(lat0, lon0, z, n) { Object.assign(this, { lat0, lon0, z, n }); }
  async load() {
    const { lat0, lon0, z, n } = this;
    const cx = Math.floor(lon2x(lon0, z)), cy = Math.floor(lat2y(lat0, z));
    this.tx0 = cx - Math.floor((n - 1) / 2); this.ty0 = cy - Math.floor((n - 1) / 2);
    const W = n * 256; this.W = W; this.h = new Float32Array(W * W);
    const jobs = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const url = TILE(z).replace('{x}', this.tx0 + i).replace('{y}', this.ty0 + j);
      jobs.push(tileHeights(url).then(t => { for (let y = 0; y < 256; y++) this.h.set(t.subarray(y * 256, y * 256 + 256), (j * 256 + y) * W + i * 256); }));
    }
    await Promise.all(jobs);
    // local metres per pixel (a small area: equirectangular round the start)
    this.mx = Math.cos(lat0 * Math.PI / 180) * 111320; this.mz = 110540;
    return this;
  }
  // local metres to pixel coordinates in the grid
  pix(x, z) {
    const lon = this.lon0 + x / this.mx, lat = this.lat0 - z / this.mz;
    return [(lon2x(lon, this.z) - this.tx0) * 256, (lat2y(lat, this.z) - this.ty0) * 256];
  }
  inside(x, z, m = 2) { const [px, py] = this.pix(x, z); return px > m && py > m && px < this.W - m - 1 && py < this.W - m - 1; }
  at(x, z) {
    let [px, py] = this.pix(x, z);
    px = Math.max(0, Math.min(this.W - 1.001, px)); py = Math.max(0, Math.min(this.W - 1.001, py));
    const i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j, W = this.W, h = this.h;
    // bicubic-ish (Catmull-Rom) in each direction keeps slopes smooth between samples
    const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    const g = (ii, jj) => h[Math.max(0, Math.min(W - 1, jj)) * W + Math.max(0, Math.min(W - 1, ii))];
    const row = jj => cr(g(i - 1, jj), g(i, jj), g(i + 1, jj), g(i + 2, jj), u);
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), v);
  }
  // the area the grid covers, in local metres
  extent() {
    const lonA = x2lon(this.tx0, this.z), lonB = x2lon(this.tx0 + this.n, this.z), latA = y2lat(this.ty0, this.z), latB = y2lat(this.ty0 + this.n, this.z);
    return { x0: (lonA - this.lon0) * this.mx, x1: (lonB - this.lon0) * this.mx, z0: (this.lat0 - latA) * this.mz, z1: (this.lat0 - latB) * this.mz };
  }
}

export class Mountain {
  constructor(spot) { this.spot = spot; }
  async load(fine = 3, coarse = 3) {
    const { lat, lon } = this.spot;
    this.fine = new Grid(lat, lon, 14, fine); this.far = new Grid(lat, lon, 11, coarse);
    await Promise.all([this.fine.load(), this.far.load()]);
    this.y0 = this.fine.at(0, 0);           // heights relative to the start
    this.ext = this.fine.extent();
    return this;
  }
  // height (relative to the start): the fine grid inside its area, eased into the coarse one at its edge
  at(x, z) {
    const e = this.ext, m = 300;
    const d = Math.min(x - e.x0, e.x1 - x, z - e.z0, e.z1 - z);
    if (d > m) return this.fine.at(x, z) - this.y0;
    const c = this.far.at(x, z) - this.y0;
    if (d <= 0) return c;
    const t = d / m, s = t * t * (3 - 2 * t);
    return c + (this.fine.at(x, z) - this.y0 - c) * s;
  }
  farAt(x, z) { return this.far.at(x, z) - this.y0; }
  farExtent() { return this.far.extent(); }
}

export const SPOTS = {
  mammoth: { name: 'Mammoth Mountain, the summit bowls', lat: 37.6312, lon: -119.0338, treeline: -380, credit: 'Elevation: AWS Terrain Tiles (USGS 3DEP, SRTM and others, open data via Mapzen)' },
};
