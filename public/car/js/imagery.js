// Esri World Imagery cut to boxes of the local frame, for roofs (buildings.js) and for finding trees (trees.js).
//
//   await imagery.rect(x0, z0, x1, z1, { zoom = 19, maxSize = 2048 })
//     -> { texture, canvas, x0, z0, x1, z1, zoom, w, h }   (x0 < x1, z0 < z1; z0 is the north edge)
//   texture: a THREE.CanvasTexture (sRGB, flipY false): uv = ((x - x0) / (x1 - x0), (z - z0) / (z1 - z0)).
//   await imagery.pixels(x0, z0, x1, z1, { zoom })  -> { data (RGBA bytes), w, h, x0, z0, x1, z1 }  (no texture)
//
// The local frame of geo.js (project/unproject) is linear in longitude and latitude, Web Mercator is linear in
// longitude and nearly linear in latitude over a few hundred metres, so a box is one scaled drawImage of the
// stitched tiles (the error over 300 m is a few millimetres). A tile that fails falls back to its parent tile.
import * as THREE from 'three';
import { unproject, lonLatToTile } from './geo.js?v=14';

export const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ATTRIBUTION = 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const tiles = new Map(); // 'z/x/y' -> Promise<ImageBitmap|null>
let active = 0;
const queue = [];
const MAX_ACTIVE = 12;

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}

function load(z, x, y) {
  const k = z + '/' + x + '/' + y;
  if (tiles.has(k)) return tiles.get(k);
  const p = new Promise(resolve => {
    queue.push(async () => {
      for (let tries = 0; tries < 2; tries++) {
        try {
          const r = await fetch(ESRI.replace('{z}', z).replace('{x}', x).replace('{y}', y), { mode: 'cors' });
          if (!r.ok) { if (r.status === 404) break; throw new Error(r.status); }
          const b = await r.blob();
          // a tiny reply is Esri's empty tile
          if (b.size < 600) break;
          resolve(await createImageBitmap(b));
          return;
        } catch (e) { await new Promise(r => setTimeout(r, 400)); }
      }
      resolve(null);
    });
    pump();
  });
  tiles.set(k, p);
  return p;
}

// the picture for tile (z, x, y), or the matching quarter of a parent (up to 3 levels up)
async function tileOrParent(z, x, y) {
  const img = await load(z, x, y);
  if (img) return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
  for (let up = 1; up <= 3; up++) {
    const pz = z - up, f = 2 ** up, px = Math.floor(x / f), py = Math.floor(y / f);
    const pimg = await load(pz, px, py);
    if (pimg) {
      const s = pimg.width / f;
      return { img: pimg, sx: (x - px * f) * s, sy: (y - py * f) * s, sw: s, sh: s };
    }
  }
  return null;
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

async function draw(x0, z0, x1, z1, zoom, maxSize, read) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (z1 < z0) [z0, z1] = [z1, z0];
  const nw = unproject(x0, z0), se = unproject(x1, z1);
  let z = zoom, a, b;
  for (;;) {
    a = lonLatToTile(nw.lon, nw.lat, z); b = lonLatToTile(se.lon, se.lat, z);
    if (((b[0] - a[0]) * 256 <= maxSize * 1.6 && (b[1] - a[1]) * 256 <= maxSize * 1.6) || z <= 14) break;
    z--;
  }
  const tx0 = Math.floor(a[0]), ty0 = Math.floor(a[1]), tx1 = Math.floor(b[0]), ty1 = Math.floor(b[1]);
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
  // stitch whole tiles at their own size first (no seams), then scale the box out of that
  const st = makeCanvas(nx * 256, ny * 256), sg = st.getContext('2d');
  sg.fillStyle = '#6d6f68'; sg.fillRect(0, 0, nx * 256, ny * 256);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    jobs.push(tileOrParent(z, tx, ty).then(t => { if (t) sg.drawImage(t.img, t.sx, t.sy, t.sw, t.sh, (tx - tx0) * 256, (ty - ty0) * 256, 256, 256); }));
  }
  await Promise.all(jobs);
  const pw = (b[0] - a[0]) * 256, ph = (b[1] - a[1]) * 256;
  const s = Math.min(1, maxSize / Math.max(pw, ph));
  const w = Math.max(2, Math.round(pw * s)), h = Math.max(2, Math.round(ph * s));
  const out = makeCanvas(w, h), g = out.getContext('2d', read ? { willReadFrequently: true } : undefined);
  g.imageSmoothingQuality = 'high';
  g.drawImage(st, (a[0] - tx0) * 256, (a[1] - ty0) * 256, pw, ph, 0, 0, w, h);
  st.width = st.height = 1;
  return { canvas: out, g, w, h, x0, z0, x1, z1, zoom: z };
}

// Tile pixels on the CPU (decoded once, kept), so reading the picture never waits on the GPU.
const tileRGBA = new Map(); // 'z/x/y' -> Promise<Uint8ClampedArray|null>
let scratch = null;
function tileData(z, x, y) {
  const k = z + '/' + x + '/' + y;
  if (tileRGBA.has(k)) return tileRGBA.get(k);
  const p = load(z, x, y).then(img => {
    if (!img) return null;
    if (!scratch) { scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : makeCanvas(256, 256); scratch.g = scratch.getContext('2d', { willReadFrequently: true }); }
    scratch.g.clearRect(0, 0, 256, 256);
    scratch.g.drawImage(img, 0, 0, 256, 256);
    return scratch.g.getImageData(0, 0, 256, 256).data;
  }).catch(() => null);
  tileRGBA.set(k, p);
  return p;
}

// sample(x, z) -> [r, g, b] (0..255, nearest pixel) over a box, from the tiles' own pixels (a parent tile where one
// is missing). Resolves once the tiles are in.
export async function sampler(x0, z0, x1, z1, zoom = 18) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (z1 < z0) [z0, z1] = [z1, z0];
  const nw = unproject(x0, z0), se = unproject(x1, z1);
  const a = lonLatToTile(nw.lon, nw.lat, zoom), b = lonLatToTile(se.lon, se.lat, zoom);
  const tx0 = Math.floor(a[0]), ty0 = Math.floor(a[1]), tx1 = Math.floor(b[0]), ty1 = Math.floor(b[1]);
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
  const arr = new Array(nx * ny).fill(null), sub = new Array(nx * ny).fill(null);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const k = (ty - ty0) * nx + (tx - tx0);
    jobs.push(tileData(zoom, tx, ty).then(async d => {
      if (d) { arr[k] = d; return; }
      // a missing tile: the matching quarter of its parent, or grandparent
      for (let up = 1; up <= 3; up++) {
        const f = 2 ** up, px = Math.floor(tx / f), py = Math.floor(ty / f);
        const pd = await tileData(zoom - up, px, py);
        if (pd) { arr[k] = pd; sub[k] = [f, (tx - px * f) * 256 / f, (ty - py * f) * 256 / f]; return; }
      }
    }));
  }
  await Promise.all(jobs);
  // local metres -> global pixel coordinates at this zoom (linear over the box)
  const gx0 = a[0] * 256, gy0 = a[1] * 256, kx = (b[0] - a[0]) * 256 / (x1 - x0), kz = (b[1] - a[1]) * 256 / (z1 - z0);
  const out = [0, 0, 0];
  const sample = (x, z, o = out) => {
    const gx = gx0 + (x - x0) * kx, gy = gy0 + (z - z0) * kz;
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const i = tx - tx0, j = ty - ty0;
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
    const d = arr[j * nx + i]; if (!d) return null;
    let px = Math.floor(gx - tx * 256), py = Math.floor(gy - ty * 256);
    const sb = sub[j * nx + i];
    if (sb) { px = Math.floor(sb[1] + px / sb[0]); py = Math.floor(sb[2] + py / sb[0]); }
    const q = (py * 256 + px) * 4;
    o[0] = d[q]; o[1] = d[q + 1]; o[2] = d[q + 2];
    return o;
  };
  sample.mpp = 1 / kx; // metres a pixel
  return sample;
}

export async function rect(x0, z0, x1, z1, opts = {}) {
  const [r, smp] = await Promise.all([
    draw(x0, z0, x1, z1, opts.zoom ?? 19, opts.maxSize ?? 2048, false),
    opts.read ? sampler(x0, z0, x1, z1, Math.min(opts.zoom ?? 19, 18)) : null,
  ]);
  const texture = new THREE.CanvasTexture(r.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = opts.anisotropy ?? 8;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const out = { texture, canvas: r.canvas, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, zoom: r.zoom, w: r.w, h: r.h };
  if (smp) out.sample = smp;
  return out;
}

// RGBA bytes over a box at the zoom's own resolution (or opts.mpp metres a pixel), made from the tiles' pixels
// without a canvas; opts.slice (an async function) is awaited every few rows so a caller can keep frames going.
export async function pixels(x0, z0, x1, z1, opts = {}) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (z1 < z0) [z0, z1] = [z1, z0];
  const smp = await sampler(x0, z0, x1, z1, opts.zoom ?? 18);
  const mpp = opts.mpp || smp.mpp;
  const w = Math.max(2, Math.round((x1 - x0) / mpp)), h = Math.max(2, Math.round((z1 - z0) / mpp));
  const data = new Uint8ClampedArray(w * h * 4), o = [0, 0, 0];
  const dx = (x1 - x0) / w, dz = (z1 - z0) / h;
  for (let j = 0; j < h; j++) {
    const z = z0 + (j + 0.5) * dz;
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4, c = smp(x0 + (i + 0.5) * dx, z, o);
      if (c) { data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; }
      data[k + 3] = 255;
    }
    if (opts.slice && (j & 31) === 31) await opts.slice('pixels');
  }
  return { data, w, h, x0, z0, x1, z1, zoom: opts.zoom ?? 18, sample: smp };
}

// The numbers a worker needs to cut a box out of the tiles at a zoom: the tile range and the linear map from
// local metres to global pixel coordinates.
export function tileMap(x0, z0, x1, z1, zoom = 18) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (z1 < z0) [z0, z1] = [z1, z0];
  const nw = unproject(x0, z0), se = unproject(x1, z1);
  const a = lonLatToTile(nw.lon, nw.lat, zoom), b = lonLatToTile(se.lon, se.lat, zoom);
  const tx0 = Math.floor(a[0]), ty0 = Math.floor(a[1]);
  return { zoom, tx0, ty0, nx: Math.floor(b[0]) - tx0 + 1, ny: Math.floor(b[1]) - ty0 + 1, gx0: a[0] * 256, gy0: a[1] * 256,
    kx: (b[0] - a[0]) * 256 / (x1 - x0), kz: (b[1] - a[1]) * 256 / (z1 - z0), x0, z0, x1, z1 };
}

export function clear() { tiles.clear(); tileRGBA.clear(); }

export const imagery = { rect, pixels, sampler, tileMap, clear, ESRI, ATTRIBUTION };
export default imagery;
