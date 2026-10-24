/* ---------------------------------------------------------------------------
   Leoncraft 2 - Chameleon's paint (Leon Network, net/hub.js).

   A hider paints their own skin to blend into the map, as in the hide and
   seek painting games, on a figure in 3D in the first Leoncraft's skin
   editor's way (PaintScreen). In the world, the Colour Picker
   takes a block's colour and the Block Stamp covers you in a block's own
   picture. The skin is a 64 x 64 canvas made from the one you wear (the old
   64 x 32 layout made whole, the outer layer cleared so the paint shows);
   each change is put on your model and sent to everyone as your skin for the
   game only (net.skinOverride), never kept as your skin setting.
--------------------------------------------------------------------------- */
import { Screen, Button, WHITE, GREY } from './gui.js?v=107';
import { BLOCKS, FLUID } from '../blocks.js?v=107';
import { H } from '../world-const.js?v=107';
import { layerPixels } from '../render/blockmesh.js?v=107';

// the skin's parts in the 64 x 64 layout: every face of each, base layer only
export const PARTS = {
  head: [0, 0, 32, 16], body: [16, 16, 40, 32], rarm: [40, 16, 56, 32], rleg: [0, 16, 16, 32],
  larm: [32, 48, 48, 64], lleg: [16, 48, 32, 64],
};
// the outer layer (hat, jacket, sleeves, trousers): cleared for painting
const OUTER = [[32, 0, 64, 16], [16, 32, 40, 48], [40, 32, 56, 48], [0, 32, 16, 48], [48, 48, 64, 64], [0, 48, 16, 64]];

/* A skin (url or image) as a 64 x 64 canvas: the old layout's left arm and
   leg made from the right ones, the outer layer cleared. */
export function loadSkin64(url) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(im, 0, 0);
      if (im.height === 32) {
        const flip = (sx, sy, w, h, dx, dy) => { x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(im, sx, sy, w, h, 0, 0, w, h); x.restore(); };
        // each face of the right leg and arm, mirrored into the left's place
        for (const [sx, dx] of [[0, 16], [4, 20], [8, 24], [12, 28]]) { flip(sx, 20, 4, 12, dx, 52); flip(40 + sx, 20, 4, 12, 32 + (dx - 16), 52); }
        flip(4, 16, 4, 4, 20, 48); flip(8, 16, 4, 4, 24, 48); flip(44, 16, 4, 4, 36, 48); flip(48, 16, 4, 4, 40, 48);
      }
      for (const r of OUTER) x.clearRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      res(c);
    };
    im.onerror = () => res(null);
    im.src = url;
  });
}

/* ---- the terrain's own pictures, for the picker and the stamp ---- */
let TERRAIN = null;
function terrain() {
  if (TERRAIN) return TERRAIN;
  TERRAIN = { data: null };
  const im = new Image();
  im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); TERRAIN.data = x.getImageData(0, 0, im.width, im.height); };
  im.src = new URL('../../textures/terrain_albedo.png?v=107', import.meta.url).href;
  return TERRAIN;
}
terrain();
const TINTS = { grass: [0x91, 0xBD, 0x59], foliage: [0x77, 0xAB, 0x2F], birch: [0x80, 0xA7, 0x55], spruce: [0x61, 0x99, 0x61], water: [0x3F, 0x76, 0xE4] };
// face 0-5 (+x, -x, +y, -y, +z, -z) from a hit's normal
export const faceOfNormal = n => (!n ? 2 : n[0] > 0 ? 0 : n[0] < 0 ? 1 : n[1] > 0 ? 2 : n[1] < 0 ? 3 : n[2] > 0 ? 4 : 5);
// a block face's 16 x 16 picture as [r, g, b, a] rows, tinted as the world shows it (null until the terrain picture is in)
export function facePixels(id, face) {
  const T = terrain().data, d = BLOCKS[id];
  if (!T || !d || !d.faces) return null;
  const layer = d.faces[face] !== undefined ? d.faces[face] : d.faces[0];
  if (layer === undefined || (layer + 1) * 16 > T.height) return null;
  const tint = d.tint && TINTS[d.tint] && (face === 2 || d.tint !== 'grass' || d.name !== 'grass_block') ? TINTS[d.tint] : null;
  const out = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = ((layer * 16 + y) * T.width + x) * 4;
    const p = [T.data[i], T.data[i + 1], T.data[i + 2], T.data[i + 3]];
    if (tint) { p[0] = p[0] * tint[0] / 255; p[1] = p[1] * tint[1] / 255; p[2] = p[2] * tint[2] / 255; }
    out.push(p);
  }
  return out;
}
// the face's mean colour (of the pixels that show)
export function faceColour(id, face) {
  const px = facePixels(id, face);
  if (!px) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (const p of px) if (p[3] > 100) { r += p[0]; g += p[1]; b += p[2]; n++; }
  return n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n) : null;
}

/* ---- the exact pixel a ray lands on, as the first Leoncraft's Mecha picks it (mcPickMesh) ----
   LC1 casts the ray at the chunk meshes themselves and reads the texture pixel at the point it lands, with
   no light on it, going on through a see-through pixel to whatever is behind. Our chunk meshes are raw GL
   buffers with nothing to cast at, so the cell the ray reaches is meshed again here by the game's own mesher
   (mesher.js, with the blocks two round it, so every face, turn, variant, overlay, offset and biome tint is
   the one on the screen) and the ray is met with those quads, the pixel worked out as the shaders do. */
let MESHER = null, MESHING = null;
export function pickReady() {
  if (!MESHING) MESHING = import('../mesher.js?v=107').then(m => (MESHER = m), () => null);
  return MESHING;
}
const PICK_KINDS = ['opaque', 'cutout', 'translucent', 'plants', 'leafIn', 'fluid'];
function layerTexel(layer, tx, ty) {
  const P = layerPixels();
  if (P && P.length >= (layer + 1) * 1024) { const i = layer * 1024 + (ty * 16 + tx) * 4; return [P[i], P[i + 1], P[i + 2], P[i + 3]]; }
  const T = terrain().data;
  if (!T || (layer + 1) * 16 > T.height) return null;
  const i = ((layer * 16 + ty) * T.width + tx) * 4;
  return [T.data[i], T.data[i + 1], T.data[i + 2], T.data[i + 3]];
}
const px16 = v => Math.max(0, Math.min(15, Math.floor(v * 16)));
const fract = v => v - Math.floor(v);
// the cell at x, y, z meshed as the world meshes it, with the blocks two round it (null without the mesher or the biome colours)
function meshCell(world, x, y, z) {
  const colours = world.initMsg && world.initMsg.colours;
  if (!MESHER || !colours || !world.chunkXZ) return null;
  const R = 2, cx = Math.floor(x / 16), cz = Math.floor(z / 16), ny = Math.min(H, y + R + 2);
  const chunks = [], tops = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = world.chunkXZ(cx + dx, cz + dz);
    chunks.push({ blocks: new Uint16Array(ny * 256), meta: new Uint8Array(ny * 256), biome: c && c.biome ? c.biome : new Uint8Array(256) });
    tops.push(ny - 2);
  }
  for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const wx = x + dx, wy = y + dy, wz = z + dz;
    if (wy < 0 || wy >= ny - 1) continue;
    const b = world.get(wx, wy, wz);
    if (!b) continue;
    const ccx = Math.floor(wx / 16), ccz = Math.floor(wz / 16), ch = chunks[(ccz - cz + 1) * 3 + (ccx - cx + 1)];
    const i = (wy << 8) | ((wz - ccz * 16) << 4) | (wx - ccx * 16);
    ch.blocks[i] = b; ch.meta[i] = world.meta(wx, wy, wz);
  }
  MESHER.setColours(colours);
  try {
    return MESHER.meshColumn({ type: 'mesh', cx, cz, chunks, tops, version: 0, seed: world.seed, prev: new Int32Array(0),
      fast: !!world.fastLeaves, flat: !!world.flatLight, blend: world.blend, noSky: !!world.noSky });
  } catch (e) { return null; }
}
/* The nearest pixel the ray (o, d) shows in the mesh of the 3 x 3 x 3 cells round x, y, z: an [r, g, b] or null.
   As the terrain shaders draw it (render/vanilla.js): the face's turn, the grass side's overlay, the tint,
   cut-outs and see-through pixels let through (LC1's own rule, under 40 of 255, for glass and water). */
function meshTexel(out, cx, cz, x, y, z, o, d, far, flowL) {
  let best = null, bestT = far;
  const V = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const kind of PICK_KINDS) {
    const p = out[kind];
    if (!p) continue;
    const [P, Aa, F, C] = p.attrs, fluid = kind === 'fluid';
    for (let q = 0; q + 3 < p.count; q += 4) {
      let mx = 0, my = 0, mz = 0;
      for (let c = 0; c < 4; c++) {
        const k = (q + c) * 4;
        V[c][0] = cx * 16 + P[k] / 32 - 8; V[c][1] = P[k + 1] / 32; V[c][2] = cz * 16 + P[k + 2] / 32 - 8;
        mx += V[c][0] / 4; my += V[c][1] / 4; mz += V[c][2] / 4;
      }
      // only the cells round the one asked for: further out, faces against the blocks not copied would show
      if (mx < x - 1.01 || mx > x + 2.01 || my < y - 1.01 || my > y + 2.01 || mz < z - 1.01 || mz > z + 2.01) continue;
      const k0 = q * 4, flags = fluid ? Aa[k0 + 1] : Aa[k0 + 3];
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        const a = V[tri[0]], b = V[tri[1]], c = V[tri[2]];
        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        // a box face shows from its front only (plants, sheets and water from both sides), as the shaders draw them
        if (!fluid && !(flags & 32)) { const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; if (nx * d.x + ny * d.y + nz * d.z >= 0) continue; }
        const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const sx = o.x - a[0], sy = o.y - a[1], sz = o.z - a[2], u = (sx * px + sy * py + sz * pz) / det;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (d.x * qx + d.y * qy + d.z * qz) / det;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) / det;
        if (!(t > 1e-4) || t >= bestT) continue;
        const rgb = fluid ? fluidTexel(P, Aa, F, C, q, tri, u, v, o, d, t, flowL) : faceTexel(kind, P, Aa, C, q, tri, u, v, flags);
        if (rgb) { best = rgb; bestT = t; }
      }
    }
  }
  return best;
}
// a block face's pixel at barycentric (u, v) of the triangle tri of quad q (vanilla.js TERRAIN_FS)
function faceTexel(kind, P, Aa, C, q, tri, u, v, flags) {
  const w = [1 - u - v, u, v];
  let tu = 0, tv = 0;
  for (let i = 0; i < 3; i++) { const k = (q + tri[i]) * 4; tu += Aa[k] / 16 * w[i]; tv += Aa[k + 1] / 16 * w[i]; }
  const rot = (flags >> 2) & 3;
  if (rot === 1) [tu, tv] = [1 - tv, tu]; else if (rot === 2) [tu, tv] = [1 - tu, 1 - tv]; else if (rot === 3) [tu, tv] = [tv, 1 - tu];
  const tx = px16(tu), ty = px16(tv), k0 = q * 4, layer = P[k0 + 3];
  const al = layerTexel(layer, tx, ty);
  if (!al) return null;
  const plant = !!(flags & 32), fastLeaf = !!(flags & 128), tint = [C[k0], C[k0 + 1], C[k0 + 2]];
  // (cut-outs as the shader's discard; see-through blocks as LC1 lets a nearly clear pixel through)
  if (!fastLeaf && kind !== 'opaque' && al[3] < (kind === 'translucent' ? 40 : plant ? 25.5 : 127.5)) return null;
  let c = [al[0], al[1], al[2]];
  if (flags & 16) {
    const ov = layerTexel(layer + 1, tx, ty);
    if (ov) { const f = ov[3] / 255; c = c.map((x, i) => x + (ov[i] * tint[i] / 255 - x) * f); }
  } else if (flags & 64) c = c.map((x, i) => x * tint[i] / 255);
  if (fastLeaf && al[3] < 127.5) c = tint.map(x => x * 0.42);
  return c.map(x => Math.round(x));
}
// water's or lava's pixel where the ray met its quad (vanilla.js FLUID_FS: still on top, the flow turned downhill, half of it down the sides)
function fluidTexel(P, Aa, F, C, q, tri, u, v, o, d, t, flowL) {
  const k0 = q * 4, n = Aa[k0], lava = !!(Aa[k0 + 1] & 2), wx = o.x + d.x * t, wy = o.y + d.y * t, wz = o.z + d.z * t;
  let p, layer;
  if (n === 2 || n === 3) {
    const cx = fract(wx), cz = fract(wz);
    let fx = 0, fz = 0;
    const w = [1 - u - v, u, v];
    for (let i = 0; i < 3; i++) { const k = (q + tri[i]) * 4; fx += F[k] / 127 * w[i]; fz += F[k + 1] / 127 * w[i]; }
    const fl = Math.hypot(fx, fz), fL = lava ? flowL[1] : flowL[0];
    if (fl > 0.05 && n === 2 && fL) {
      const dx = fx / fl, dz = fz / fl, ax = cx - 0.5, az = cz - 0.5;
      p = [0.5 + (ax * dz - az * dx) * 0.5, 0.5 + (ax * dx + az * dz) * 0.5]; layer = fL;
    } else { p = [cx, cz]; layer = P[k0 + 3]; }
  } else {
    const along = n === 0 || n === 1 ? wz : wx, fL = lava ? flowL[1] : flowL[0];
    p = [fract(along) * 0.5, fract(-wy) * 0.5]; layer = fL || P[k0 + 3];
  }
  const tx = layerTexel(layer, px16(p[0]), px16(p[1]));
  if (!tx) return null;
  if (lava) return [tx[0], tx[1], tx[2]];
  if (tx[3] < 40) return null;
  const g = 0.299 * tx[0] + 0.587 * tx[1] + 0.114 * tx[2];
  return [C[k0], C[k0 + 1], C[k0 + 2]].map(x => Math.round(g * x / 255));
}
// the pixel under the middle of the screen, through the camera as it was drawn (Chameleon's Colour Picker); fallback as pickWorld's
export function pickAtCentre(world, renderer, fallback) {
  const cam = renderer && renderer.camera, THREE = window.THREE;
  if (!cam || !THREE) return fallback ? fallback() : null;
  const o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
  const fl = renderer.U && renderer.U.uFlowLayers ? renderer.U.uFlowLayers.value : null;
  const c = pickWorld(world, o, d, { flowL: fl ? [fl.x, fl.y] : null, fallback });
  return c !== null ? c : fallback ? fallback() : null;
}
/* The colour of the first pixel a ray (origin o, direction d, normalised) shows in the world within far
   blocks, as an 0xRRGGBB, or null. fallback: the old way (a cube's face pixel) while the mesher is not in.
   flowL: the water's and lava's flowing texture layers (the renderer's uFlowLayers). */
export function pickWorld(world, o, d, opts = {}) {
  if (!world) return null;
  pickReady();
  const far = opts.far || 64, flowL = opts.flowL || [0, 0];
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z), t = 0, done = null, tries = 0;
  const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const tdx = d.x ? Math.abs(1 / d.x) : Infinity, tdy = d.y ? Math.abs(1 / d.y) : Infinity, tdz = d.z ? Math.abs(1 / d.z) : Infinity;
  let tx = d.x ? (d.x > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity, ty = d.y ? (d.y > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity, tz = d.z ? (d.z > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
  for (let n = 0; n < 400 && t < far; n++) {
    const b = world.get(x, y, z);
    // (the cells round a cell meshed already were all tried against the whole ray)
    const seen = done && Math.abs(x - done[0]) <= 1 && Math.abs(y - done[1]) <= 1 && Math.abs(z - done[2]) <= 1;
    if (b && BLOCKS[b] && BLOCKS[b].name !== 'barrier' && !seen) {
      const out = tries < 8 ? meshCell(world, x, y, z) : null;
      if (!out) return opts.fallback ? opts.fallback() : null;
      tries++;
      const c = meshTexel(out, Math.floor(x / 16), Math.floor(z / 16), x, y, z, o, d, far, flowL);
      if (c) return (c[0] << 16) | (c[1] << 8) | c[2];
      done = [x, y, z];
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; } else if (ty < tz) { y += sy; t = ty; ty += tdy; } else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}

/* The painter: the canvas being painted, the colour in hand and the brush.
   apply() is called after each change (it puts the skin on your model and
   sends it). Every stroke, fill, stamp and start again can be undone. */
export class Painter {
  constructor(apply) { pickReady(); this.canvas = null; this.colour = 0x6B8E23; this.recent = []; this.apply = apply; this.base = null; this.size = 1; this.grain = false; this.undos = []; }
  async start(url) { this.canvas = await loadSkin64(url); if (this.canvas) { this.base = document.createElement('canvas'); this.base.width = this.base.height = 64; this.base.getContext('2d').drawImage(this.canvas, 0, 0); this.apply(this.canvas); } }
  // a plain white figure to paint on (Chameleon's hiders start as one, as in Meccha Chameleon); Start Again comes back to it
  startBlank() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f4f4';
    for (const r of Object.values(PARTS)) x.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    this.canvas = c;
    this.base = document.createElement('canvas'); this.base.width = this.base.height = 64; this.base.getContext('2d').drawImage(c, 0, 0);
    this.apply(c);
  }
  ctx() { return this.canvas && this.canvas.getContext('2d', { willReadFrequently: true }); }
  setColour(c) { if (c === null || c === undefined) return; this.colour = c; this.recent = [c].concat(this.recent.filter(x => x !== c)).slice(0, 8); }
  css(c) { return '#' + c.toString(16).padStart(6, '0'); }
  // kept before each change, 40 at most
  snapshot() { const x = this.ctx(); if (!x) return; this.undos.push(x.getImageData(0, 0, 64, 64)); if (this.undos.length > 40) this.undos.shift(); }
  undo() { const x = this.ctx(), u = this.undos.pop(); if (!x || !u) return false; x.putImageData(u, 0, 0); this.apply(this.canvas); return true; }
  // the colour for one pixel: with Grain on, each a little lighter or darker, as a block's picture is
  shade() {
    const c = this.colour;
    if (!this.grain) return this.css(c);
    const d = Math.round((Math.random() * 2 - 1) * 14), j = () => Math.round((Math.random() * 2 - 1) * 4);
    const ch = (v, k) => Math.max(0, Math.min(255, v + d + k));
    return 'rgb(' + ch(c >> 16 & 255, j()) + ',' + ch(c >> 8 & 255, j()) + ',' + ch(c & 255, j()) + ')';
  }
  // the brush's square at a skin pixel, kept inside the side of the part it is on (rect: that side's [x, y, w, h])
  dot(tx, ty, rect) {
    const x = this.ctx(); if (!x) return;
    const n = this.size | 0 || 1, o = Math.floor((n - 1) / 2);
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
      const px = tx - o + dx, py = ty - o + dy;
      if (rect && (px < rect[0] || py < rect[1] || px >= rect[0] + rect[2] || py >= rect[1] + rect[3])) continue;
      x.fillStyle = this.shade(); x.fillRect(px, py, 1, 1);
    }
  }
  // a whole body part (every side of it)
  fill(part) {
    const x = this.ctx(), r = PARTS[part]; if (!x || !r) return;
    if (!this.grain) { x.fillStyle = this.css(this.colour); x.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); return; }
    for (let y = r[1]; y < r[3]; y++) for (let xx = r[0]; xx < r[2]; xx++) { x.fillStyle = this.shade(); x.fillRect(xx, y, 1, 1); }
  }
  // the bucket: the touching pixels of about the clicked one's colour, on that side of the part only
  flood(tx, ty, rect) {
    const x = this.ctx(); if (!x || !rect) return;
    const [rx, ry, rw, rh] = rect, img = x.getImageData(rx, ry, rw, rh), d = img.data;
    const si = ((ty - ry) * rw + (tx - rx)) * 4, sr = d[si], sg = d[si + 1], sb = d[si + 2], sa = d[si + 3];
    const seen = new Uint8Array(rw * rh), stack = [[tx - rx, ty - ry]], TOL = 55;
    while (stack.length) {
      const [qx, qy] = stack.pop();
      if (qx < 0 || qy < 0 || qx >= rw || qy >= rh) continue;
      const p = qy * rw + qx; if (seen[p]) continue;
      const i = p * 4;
      if (Math.abs(d[i] - sr) + Math.abs(d[i + 1] - sg) + Math.abs(d[i + 2] - sb) + Math.abs(d[i + 3] - sa) > TOL) continue;
      seen[p] = 1;
      const c = this.grain ? this.shade().match(/\d+/g).map(Number) : [this.colour >> 16 & 255, this.colour >> 8 & 255, this.colour & 255];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      stack.push([qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]);
    }
    x.putImageData(img, rx, ry);
  }
  // the colour of a skin pixel
  pick(tx, ty) { const x = this.ctx(); if (!x) return null; const d = x.getImageData(tx, ty, 1, 1).data; return d[3] <= 8 ? null : (d[0] << 16) | (d[1] << 8) | d[2]; }
  reset() { const x = this.ctx(); if (!x || !this.base) return; this.snapshot(); x.clearRect(0, 0, 64, 64); x.drawImage(this.base, 0, 0); this.apply(this.canvas); }
  // the block's picture over every part, tiled from each part's corner
  stamp(id, face) {
    const px = facePixels(id, face), x = this.ctx();
    if (!px || !x) return false;
    this.snapshot();
    const img = x.getImageData(0, 0, 64, 64);
    for (const r of Object.values(PARTS)) for (let ty = r[1]; ty < r[3]; ty++) for (let tx = r[0]; tx < r[2]; tx++) {
      const p = px[((ty - r[1]) % 16) * 16 + ((tx - r[0]) % 16)], i = (ty * 64 + tx) * 4;
      if (p[3] < 100) continue;
      img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.apply(this.canvas);
    return true;
  }
}

/* ---- colours ---- */
const PALETTE = [0xF9FFFE, 0x9D9D97, 0x474F52, 0x1D1D21, 0xB02E26, 0xF9801D, 0xFED83D, 0x80C71F, 0x5E7C16, 0x169C9C, 0x3AB3DA, 0x3C44AA, 0x8932B8, 0xC74EBD, 0xF38BAA, 0x835432];
function toHsv(c) {
  const r = (c >> 16 & 255) / 255, g = (c >> 8 & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h / 6) + 1) % 1, mx ? d / mx : 0, mx];
}
function fromHsv(h, s, v) {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}


/* The paint screen, in the first Leoncraft's Mecha Chameleon way: you stay in
   the world, the camera swings round you, and you paint the body you are
   standing in against what is really behind it. A bar along the bottom holds
   the colour wells, the tools (Brush, Bucket, Pick, Part), the brush sizes 1
   to 3, a colour square and hue strip for any colour, Grain, Undo (or Ctrl+Z)
   and Start Again. Left-drag on yourself paints; left-drag anywhere else, or
   right-drag, swings the camera; the wheel (or 9 and 0) zooms. Pick takes a
   colour from your skin or from the exact pixel of a block in the world.
   ctx: { renderer, world, player }. */
const TOOLS = [['brush', 'Brush', 'Drag across yourself to paint'], ['bucket', 'Bucket', 'Fill the touching pixels of one colour, on that side of a part'],
  ['drop', 'Pick', 'Click yourself or any block to take its colour'], ['part', 'Part', 'Paint a whole body part']];
const PART_NAMES = ['head', 'body', 'rarm', 'larm', 'rleg', 'lleg'];
export class PaintScreen extends Screen {
  constructor(painter, ctx) {
    super('Paint Yourself');
    this.p = painter; this.ctx = ctx || {}; this.tool = 'brush'; this.dirty = false; this.drag = null;
    this.hsv = toHsv(painter.colour); this.background = 'none';
    pickReady();
    const A = this.A, P = this.ctx.player;
    // the camera in front of you, a little above
    if (A) A.orbit = { yaw: (P ? P.yaw : 0) + Math.PI, pitch: 0.18, dist: 2.8 };
  }
  get A() { return this.ctx.renderer && this.ctx.renderer.avatar; }
  init() {
    const W = this.width, H = this.height, g = this.gui, P = this.p;
    // the bar: wells and the colour square on top, tools and sizes under them, then Grain, Undo, Start Again, Done
    const BW = 300; this.bx = Math.floor((W - BW) / 2); this.by = H - 70; this.bw = BW;
    const x0 = this.bx + 4, y1 = this.by + 22, y2 = this.by + 44;
    this.tools = TOOLS.map(([name, label, tip], i) => { const b = this.add(new Button(x0 + 18 + i * 44, y1, 42, 18, label, () => { this.tool = name; }, tip)); b.tool = name; return b; });
    this.sizes = [1, 2, 3].map((n, i) => { const b = this.add(new Button(x0 + 198 + i * 14, y1, 13, 18, String(n), () => { P.size = n; }, 'Brush size')); b.size = n; return b; });
    this.grainB = this.add(new Button(x0, y2, 58, 20, 'Grain: ' + (P.grain ? 'On' : 'Off'), () => { P.grain = !P.grain; this.grainB.message = 'Grain: ' + (P.grain ? 'On' : 'Off'); }, 'Each pixel a little lighter or darker, like the pictures of blocks'));
    this.undoB = this.add(new Button(x0 + 60, y2, 50, 20, 'Undo', () => { if (P.undo()) this.live(); }, 'Ctrl+Z'));
    this.add(new Button(x0 + 112, y2, 72, 20, 'Start Again', () => { P.reset(); this.live(); }, 'Back to plain white, as you began'));
    this.add(new Button(x0 + 186, y2, 52, 20, 'Done', () => g.back()));
  }
  get sv() { return [this.bx + this.bw - 58, this.by + 4, 44, 62]; }
  get hue() { return [this.bx + this.bw - 12, this.by + 4, 8, 62]; }
  well(i) { return [this.bx + 22 + i * 11, this.by + 6, 10, 10]; }
  inBox(r, mx, my) { return mx >= r[0] && my >= r[1] && mx < r[0] + r[2] && my < r[1] + r[3]; }
  inBar(mx, my) { return mx >= this.bx && mx < this.bx + this.bw && my >= this.by; }
  // the paint on your body now (the server hears of it when you let go)
  live() { const A = this.A; if (A && this.p.canvas) A.setSkin(this.p.canvas, false); this.gui.markDirty(); }
  ray(mx, my) {
    const R = this.ctx.renderer, cam = R && R.camera, THREE = window.THREE;
    if (!cam || !THREE) return null;
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    // (from the canvas's own size: the screen's width in GUI pixels is rounded up, which put the ray up to a GUI pixel off the pointer)
    const g = this.gui, cv = g && g.canvas, k = g && g.scale ? g.scale : 1;
    const fx = cv && cv.width ? mx * k / cv.width : mx / this.width, fy = cv && cv.height ? my * k / cv.height : my / this.height;
    rc.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), cam);
    return rc.ray;
  }
  bodyAt(mx, my) { const r = this.ray(mx, my), A = this.A; return r && A && A.skinHit ? A.skinHit(r.origin, r.direction) : null; }
  // the pixel the ray lands on in the world, as it is drawn there without its light (pickWorld, LC1's mcPickMesh)
  blockColourAt(mx, my) {
    const r = this.ray(mx, my), w = this.ctx.world, R = this.ctx.renderer, fl = R && R.U && R.U.uFlowLayers ? R.U.uFlowLayers.value : null;
    if (!r || !w) return null;
    return pickWorld(w, r.origin, r.direction, { flowL: fl ? [fl.x, fl.y] : null, fallback: () => this.cubeColourAt(r) });
  }
  // the old way, while the mesher is still coming: the face of the first block's cube
  cubeColourAt(r) {
    const w = this.ctx.world;
    const o = r.origin, d = r.direction;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z), face = 2, t = 0;
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = d.x ? Math.abs(1 / d.x) : Infinity, tdy = d.y ? Math.abs(1 / d.y) : Infinity, tdz = d.z ? Math.abs(1 / d.z) : Infinity;
    let tx = d.x ? (d.x > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity, ty = d.y ? (d.y > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity, tz = d.z ? (d.z > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
    for (let n = 0; n < 200; n++) {
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = sx > 0 ? 1 : 0; } else if (ty < tz) { y += sy; t = ty; ty += tdy; face = sy > 0 ? 3 : 2; } else { z += sz; t = tz; tz += tdz; face = sz > 0 ? 5 : 4; }
      const b = w.get(x, y, z);
      if (!b || !BLOCKS[b] || BLOCKS[b].name === 'barrier') continue;
      const px = facePixels(b, face);
      if (!px) return faceColour(b, face);
      const hx = o.x + d.x * t - x, hy = o.y + d.y * t - y, hz = o.z + d.z * t - z;
      // where on the face's picture: across and down as the face is seen from outside
      const fr = v => Math.max(0, Math.min(15, Math.floor(v * 16)));
      const uv = face === 2 ? [hx, hz] : face === 3 ? [hx, 1 - hz] : face === 0 ? [1 - hz, 1 - hy] : face === 1 ? [hz, 1 - hy] : face === 4 ? [hx, 1 - hy] : [1 - hx, 1 - hy];
      const q = px[fr(uv[1]) * 16 + fr(uv[0])];
      if (q[3] < 100) return faceColour(b, face);
      return (Math.round(q[0]) << 16) | (Math.round(q[1]) << 8) | Math.round(q[2]);
    }
    return null;
  }
  pickSv(mx, my) {
    const r = this.sv, s = Math.max(0, Math.min(1, (mx - r[0]) / (r[2] - 1))), v = Math.max(0, Math.min(1, 1 - (my - r[1]) / (r[3] - 1)));
    this.hsv = [this.hsv[0], s, v]; this.p.colour = fromHsv(this.hsv[0], s, v); this.gui.markDirty();
  }
  pickHue(my) {
    const r = this.hue, h = Math.max(0, Math.min(0.999, (my - r[1]) / r[3]));
    this.hsv = [h, this.hsv[1] || 1, this.hsv[2] || 1]; this.p.colour = fromHsv(h, this.hsv[1], this.hsv[2]); this.gui.markDirty();
  }
  setColour(c) { if (c === null || c === undefined) return; this.p.setColour(c); this.hsv = toHsv(c); this.gui.markDirty(); }
  // the tool at a body pixel
  use(h, first) {
    const P = this.p;
    if (first) P.snapshot();
    if (this.tool === 'bucket') { if (first) P.flood(h.tx, h.ty, h.rect); }
    else if (this.tool === 'part') { if (first) P.fill(PART_NAMES[h.part]); }
    else P.dot(h.tx, h.ty, h.rect);
    this.dirty = true; this.live();
  }
  mouseClicked(mx, my, button) {
    const hit = super.mouseClicked(mx, my, button);
    if (hit) return hit;
    if (button === 0) {
      for (let i = 0; i < PALETTE.length; i++) if (this.inBox(this.well(i), mx, my)) { this.setColour(PALETTE[i]); return true; }
      if (this.inBox(this.sv, mx, my)) { this.drag = 'sv'; this.pickSv(mx, my); return true; }
      if (this.inBox(this.hue, mx, my)) { this.drag = 'hue'; this.pickHue(my); return true; }
    }
    if (this.inBar(mx, my)) return true;
    this.lx = mx; this.ly = my;
    if (button !== 0) { this.drag = 'turn'; return true; }
    const h = this.bodyAt(mx, my);
    if (this.tool === 'drop') {
      // your own skin's pixel first, then the world's (as LC1's mcPickScreen: a clear pixel of the skin lets the ray on)
      const s = h ? this.p.pick(h.tx, h.ty) : null, c = s !== null ? s : this.blockColourAt(mx, my);
      if (c !== null) { this.setColour(c); this.tool = 'brush'; }
      return true;
    }
    if (h) { this.drag = 'paint'; this.use(h, true); } else this.drag = 'turn';
    return true;
  }
  mouseDragged(mx, my, button) {
    if (this.drag === 'paint') { if (this.tool === 'brush') { const h = this.bodyAt(mx, my); if (h) this.use(h, false); } return; }
    if (this.drag === 'turn') {
      const O = this.A && this.A.orbit;
      if (O) { O.yaw -= (mx - this.lx) * 0.02; O.pitch = Math.max(-1.2, Math.min(1.35, O.pitch + (my - this.ly) * 0.015)); }
      this.lx = mx; this.ly = my; return;
    }
    if (this.drag === 'sv') { this.pickSv(mx, my); return; }
    if (this.drag === 'hue') { this.pickHue(my); return; }
    super.mouseDragged(mx, my, button);
  }
  mouseReleased(mx, my, button) {
    if (this.drag === 'sv' || this.drag === 'hue') this.p.setColour(this.p.colour);
    this.drag = null;
    if (this.dirty) { this.dirty = false; this.p.apply(this.p.canvas); }
    super.mouseReleased(mx, my, button);
  }
  mouseScrolled(mx, my, d) {
    const O = this.A && this.A.orbit;
    if (!O || this.inBar(mx, my)) return super.mouseScrolled(mx, my, d);
    O.dist = Math.max(1.2, Math.min(7, O.dist * (d > 0 ? 1 / 1.15 : 1.15)));
    return true;
  }
  keyPressed(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { if (this.p.undo()) this.live(); return true; }
    // 9 and 0 zoom, as in the first Leoncraft
    const O = this.A && this.A.orbit;
    if (O && (e.key === '9' || e.key === '0')) { O.dist = Math.max(1.2, Math.min(7, O.dist * (e.key === '9' ? 1 / 1.15 : 1.15))); return true; }
    return super.keyPressed(e);
  }
  onClose() {
    if (this.dirty) { this.dirty = false; this.p.apply(this.p.canvas); }
    const A = this.A;
    if (A) A.orbit = null;
  }
  render(g, mx, my, dt) {
    const c = g.ctx, P = this.p, x0 = this.bx;
    this.animates = true;
    for (const b of this.tools) b.active = this.tool !== b.tool;
    for (const b of this.sizes) b.active = P.size !== b.size;
    this.undoB.active = P.undos.length > 0;
    // the bar
    g.fill(x0, this.by, x0 + this.bw, this.height, 0xC80A0E0A);
    g.fill(x0, this.by, x0 + this.bw, this.by + 1, 0x5A78C878);
    // the colour in hand, the wells (the one in hand raised, as LC1 had it)
    g.fill(x0 + 4, this.by + 4, x0 + 18, this.by + 18, 0xFF000000); g.fill(x0 + 5, this.by + 5, x0 + 17, this.by + 17, 0xFF000000 | P.colour);
    PALETTE.forEach((col, i) => { const [x, y, w, h] = this.well(i), on = col === P.colour; g.fill(x, y - (on ? 3 : 0), x + w, y + h - (on ? 3 : 0), 0xFF000000 | col); if (on) g.fill(x, y + h - 2, x + w, y + h - 1, 0xFFF2E37A); });
    // any colour: saturation across, brightness down, the hue strip beside it
    const [sx, sy, sw, sh] = this.sv, [hx, hy, hw, hh] = this.hue, [H0, S0, V0] = this.hsv;
    c.fillStyle = '#' + fromHsv(H0, 1, 1).toString(16).padStart(6, '0'); c.fillRect(sx, sy, sw, sh);
    let gr = c.createLinearGradient(sx, 0, sx + sw, 0); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(sx, sy, sw, sh);
    gr = c.createLinearGradient(0, sy, 0, sy + sh); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); c.fillStyle = gr; c.fillRect(sx, sy, sw, sh);
    gr = c.createLinearGradient(0, hy, 0, hy + hh);
    ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].forEach((col, i) => gr.addColorStop(i / 6, col));
    c.fillStyle = gr; c.fillRect(hx, hy, hw, hh);
    const kx = Math.round(sx + S0 * (sw - 1)), ky = Math.round(sy + (1 - V0) * (sh - 1));
    g.fill(kx - 2, ky - 2, kx + 3, ky - 1, 0xFFF2E37A); g.fill(kx - 2, ky + 2, kx + 3, ky + 3, 0xFFF2E37A); g.fill(kx - 2, ky - 1, kx - 1, ky + 2, 0xFFF2E37A); g.fill(kx + 2, ky - 1, kx + 3, ky + 2, 0xFFF2E37A);
    const hyk = Math.round(hy + H0 * hh); g.fill(hx - 1, hyk - 1, hx + hw + 1, hyk + 1, 0xFFF2E37A);
    super.render(g, mx, my, dt);
    g.centered('Drag on yourself to paint, beside you to turn, scroll to zoom', this.width / 2, this.by - 21, 0xCDF5CD); g.centered('Pick takes a colour from you or any block - Esc when done', this.width / 2, this.by - 11, 0xCDF5CD);
    // the brush under the pointer, in the colour it paints (ours, so it is exactly where the paint goes)
    if (!this.inBar(mx, my) && this.drag !== 'turn') {
      const n = this.tool === 'brush' ? 2 + P.size * 2 : 4;
      g.fill(mx - n - 1, my - n - 1, mx + n + 1, my + n + 1, 0xFF000000);
      g.fill(mx - n, my - n, mx + n, my + n, this.tool === 'drop' ? 0xFFFFFFFF : 0xFF000000 | P.colour);
    }
  }
}
