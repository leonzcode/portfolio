// Worker for trees.js: fetches and decodes the satellite tiles for a block itself, builds the block's picture
// and finds its crowns (treedetect.js), so none of it runs on the page's thread.
//   in:  { id, job: { map: { zoom, tx0, ty0, nx, ny, gx0, gy0, kx, kz, x0, z0, x1, z1 }, opts } }
//   out: { id, res: { list, canopyCells } } or { id, error }
import { detect } from './treedetect.js?v=11';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const tiles = new Map();
let canvas = null, ctx = null;

function tile(z, x, y) {
  const k = z + '/' + x + '/' + y;
  if (tiles.has(k)) return tiles.get(k);
  const p = (async () => {
    for (let tries = 0; tries < 2; tries++) {
      try {
        const r = await fetch(ESRI.replace('{z}', z).replace('{x}', x).replace('{y}', y), { mode: 'cors' });
        if (!r.ok) { if (r.status === 404) return null; throw new Error(r.status); }
        const b = await r.blob();
        if (b.size < 600) return null;
        const img = await createImageBitmap(b);
        if (!canvas) { canvas = new OffscreenCanvas(256, 256); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(img, 0, 0, 256, 256);
        img.close && img.close();
        return ctx.getImageData(0, 0, 256, 256).data;
      } catch (e) { await new Promise(r => setTimeout(r, 400)); }
    }
    return null;
  })();
  tiles.set(k, p);
  // keep the cache bounded (about 600 tiles, 150 MB)
  if (tiles.size > 600) { const first = tiles.keys().next().value; tiles.delete(first); }
  return p;
}

async function tileOrParent(z, x, y) {
  const d = await tile(z, x, y);
  if (d) return { d, f: 1, ox: 0, oy: 0 };
  for (let up = 1; up <= 3; up++) {
    const f = 2 ** up, px = Math.floor(x / f), py = Math.floor(y / f);
    const pd = await tile(z - up, px, py);
    if (pd) return { d: pd, f, ox: (x - px * f) * 256 / f, oy: (y - py * f) * 256 / f };
  }
  return null;
}

self.onmessage = async (e) => {
  const { id, job } = e.data;
  try {
    const m = job.map;
    const arr = new Array(m.nx * m.ny);
    await Promise.all(Array.from({ length: m.nx * m.ny }, (_, k) => tileOrParent(m.zoom, m.tx0 + (k % m.nx), m.ty0 + Math.floor(k / m.nx)).then(t => { arr[k] = t; })));
    // the block at the zoom's own resolution
    const mpp = 1 / m.kx;
    const w = Math.max(2, Math.round((m.x1 - m.x0) / mpp)), h = Math.max(2, Math.round((m.z1 - m.z0) / mpp));
    const data = new Uint8ClampedArray(w * h * 4);
    const dx = (m.x1 - m.x0) / w, dz = (m.z1 - m.z0) / h;
    for (let j = 0; j < h; j++) {
      const gy = m.gy0 + (m.z0 + (j + 0.5) * dz - m.z0) * m.kz;
      const ty = Math.floor(gy / 256), tj = ty - m.ty0;
      for (let i = 0; i < w; i++) {
        const q = (j * w + i) * 4;
        data[q + 3] = 255;
        if (tj < 0 || tj >= m.ny) continue;
        const gx = m.gx0 + (i + 0.5) * dx * m.kx;
        const tx = Math.floor(gx / 256), ti = tx - m.tx0;
        if (ti < 0 || ti >= m.nx) continue;
        const t = arr[tj * m.nx + ti]; if (!t) continue;
        let pxx = Math.floor(gx - tx * 256), pyy = Math.floor(gy - ty * 256);
        if (t.f > 1) { pxx = Math.floor(t.ox + pxx / t.f); pyy = Math.floor(t.oy + pyy / t.f); }
        const s = (pyy * 256 + pxx) * 4;
        data[q] = t.d[s]; data[q + 1] = t.d[s + 1]; data[q + 2] = t.d[s + 2];
      }
    }
    const res = detect({ data, w, h, x0: m.x0, z0: m.z0, x1: m.x1, z1: m.z1 }, job.opts);
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
