/* ---------------------------------------------------------------------------
   Leoncraft 2 - lighting and meshing, for one chunk column at a time.

   Runs in a worker. It is handed the column and the eight around it (blocks,
   fluid levels, biomes), lights the lot, and turns the middle one into
   vertex buffers for the four ways things are drawn:

     opaque       full cubes nothing shows through
     cutout       alpha tested: leaves, plants, glass, torches, cactus
     translucent  blended: ice, stained glass
     fluid        water and lava, with their own surface heights and flow

   Lighting is Minecraft's: sky light pours straight down at 15 and spreads
   sideways one less a block; block light spreads out from torches, lava and
   glowstone. Every vertex takes the average of the four cells around its
   corner ("smooth lighting") and an ambient-occlusion value from the three
   blocks that could shade it.

   Vertex formats (non-interleaved, small integers the shaders scale back):
     terrain  aPos u16x4 (x*32, y*32, z*32, texture layer)
              aA   u8x4  (u, v in 16ths; normal + wave*8; flags)
              aL   u8x4  (sky*17, block*17, water depth*17, random)
              aC   u8x4  (tint rgb, unused)
     fluid    aPos u16x4 (x*32, y*32, z*32, layer)
              aA   u8x4  (normal, flags, sky*17, block*17)
              aF   i8x4  (flow x, flow z, height change*32, foam)
              aC   u8x4  (water colour rgb, level*32)
   flags: bits 0-1 ambient occlusion, 2-3 texture rotation, 4 overlay
   (grass block sides), 5 plant, 6 tinted.
--------------------------------------------------------------------------- */
import { BLOCKS, B, OPAQUE, OPACITY, EMIT, FLUID, MAX_ID } from './blocks.js?v=9';
import { CH, H, LEVEL, FALLING } from './world-const.js?v=9';
import { BIOMES, SPRUCE_LEAF, BIRCH_LEAF } from './biomes.js?v=9';
import { hash3 } from './noise.js?v=9';
import { boxesOf, MODEL_SHAPES } from './models.js?v=9';
import { STATEFUL, SLIGHT, stateDef, lightOf } from './sim/states.js?v=9';

const W = 48, A = W * W;          // the region: three chunks a side
let colours = null;               // biome colours, set once at start
export function setColours(c) { colours = c; }

/* --- a growable vertex/index store -------------------------------------- */
class Buf {
  constructor(n, kinds) {
    this.cap = n; this.n = 0; this.kinds = kinds;
    this.arrs = kinds.map(k => new k.T(n * 4));
    this.idx = new Uint32Array(n * 1.5 | 0); this.ni = 0;
    this.marks = new Int32Array(25);   // where each 16-block section's indices start
  }
  grow() {
    this.cap *= 2;
    this.arrs = this.arrs.map((a, i) => { const b = new this.kinds[i].T(this.cap * 4); b.set(a); return b; });
  }
  vert() { if (this.n >= this.cap) this.grow(); return this.n++; }
  quad(v0, flip) {
    if (this.ni + 6 > this.idx.length) { const b = new Uint32Array(this.idx.length * 2); b.set(this.idx); this.idx = b; }
    const I = this.idx;
    if (flip) { I[this.ni++] = v0 + 1; I[this.ni++] = v0 + 2; I[this.ni++] = v0 + 3; I[this.ni++] = v0 + 1; I[this.ni++] = v0 + 3; I[this.ni++] = v0; }
    else { I[this.ni++] = v0; I[this.ni++] = v0 + 1; I[this.ni++] = v0 + 2; I[this.ni++] = v0; I[this.ni++] = v0 + 2; I[this.ni++] = v0 + 3; }
  }
  out() {
    if (!this.n) return null;
    return { count: this.n, attrs: this.arrs.map(a => a.slice(0, this.n * 4)), index: this.idx.slice(0, this.ni), marks: this.marks };
  }
}
const TERRAIN = [{ T: Uint16Array }, { T: Uint8Array }, { T: Uint8Array }, { T: Uint8Array }];
const FLUIDF = [{ T: Uint16Array }, { T: Uint8Array }, { T: Int8Array }, { T: Uint8Array }];

/* --- faces -------------------------------------------------------------- */
// n: normal, t: +u direction, b: +v direction (image down)
const FACES = [
  { n: [1, 0, 0], t: [0, 0, -1], b: [0, -1, 0] },
  { n: [-1, 0, 0], t: [0, 0, 1], b: [0, -1, 0] },
  { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, 0, 1], t: [1, 0, 0], b: [0, -1, 0] },
  { n: [0, 0, -1], t: [-1, 0, 0], b: [0, -1, 0] },
];
const CORNERS = [[0, 1], [1, 1], [1, 0], [0, 0]];   // (u, v) in drawing order
const step = v => v[0] + v[2] * W + v[1] * A;       // region index offset of a direction
// for each face and corner: the offsets (from the cell the face looks into) of
// the two side neighbours and the diagonal one that shade that corner
const SHADE = FACES.map(F => CORNERS.map(([u, v]) => {
  const t1 = step(F.t) * (u ? 1 : -1), t2 = step(F.b) * (v ? 1 : -1);
  return [t1, t2, t1 + t2];
}));
const NSTEP = FACES.map(F => step(F.n));
const FACING_FACE = [5, 0, 4, 1];                    // north, east, south, west -> the face it points out of

/* Lookup tables over every block, made once (after the textures are known). */
let TABLES = null;
function tables() {
  if (TABLES) return TABLES;
  const LEAF = new Uint8Array(MAX_ID), WL = new Uint8Array(MAX_ID);
  // blocks drawn from boxes (stairs, fences, doors...), and the small ones that can drop out at a distance
  const MODEL = new Uint8Array(MAX_ID), SMALL = new Uint8Array(MAX_ID), ORIENT = new Uint8Array(MAX_ID);
  for (const d of BLOCKS) {
    if (!d) continue;
    if (d.leaves) LEAF[d.id] = 1;
    if (d.waterlogged) WL[d.id] = 1;
    if (MODEL_SHAPES.has(d.shape) && d.shape !== 'cactus') MODEL[d.id] = 1;
    if (/^(button|rail|wire|candle|wall_torch|crop|vine|plate|pot|lantern|chain|rod)$/.test(d.shape)) SMALL[d.id] = 1;
    ORIENT[d.id] = d.orient === 'axis' ? 1 : d.orient === 'horizontal' ? 2 : d.orient === 'facing' ? 3 : 0;
  }
  return (TABLES = { LEAF, MODEL, SMALL, ORIENT, WL });
}

/* ======================================================================== */
export function meshColumn(job) {
  const { chunks, tops } = job;
  // the highest anything reaches, so nothing above it is walked
  let top = 0;
  for (const t of tops) top = Math.max(top, t);
  const ny = Math.min(H, top + 2);
  const N = A * ny;
  const rb = new Uint16Array(N), rm = new Uint8Array(N);
  const bio = new Uint8Array(W * W);
  for (let c = 0; c < 9; c++) {
    const ch = chunks[c];
    const ox = (c % 3) * 16, oz = ((c / 3) | 0) * 16;
    if (!ch) continue;
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < 16; z++) {
        const src = (y << 8) | (z << 4), dst = y * A + (oz + z) * W + ox;
        rb.set(ch.blocks.subarray(src, src + 16), dst);
        rm.set(ch.meta.subarray(src, src + 16), dst);
      }
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) bio[(oz + z) * W + ox + x] = ch.biome[(z << 4) | x];
  }

  /* ---- light ---- */
  const sky = new Uint8Array(N), blk = new Uint8Array(N);
  const Q = new Int32Array(1 << 20); const QM = Q.length - 1;
  let qh = 0, qt = 0;
  const skyTop = job.noSky ? 0 : 15;      // the Nether: no sky light anywhere
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    let v = skyTop;
    for (let y = ny - 1; y >= 0; y--) {
      const i = y * A + z * W + x;
      const op = OPACITY[rb[i]];
      if (op >= 15) v = 0; else if (op > 0) v = v > op ? v - op : 0;
      sky[i] = v;
    }
  }
  // seed the spread from every lit cell next to a darker one it could light
  for (let y = 0; y < ny; y++) for (let z = 1; z < W - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = y * A + z * W + x, l = sky[i];
    if (l < 2) continue;
    if (sky[i + 1] < l - 1 || sky[i - 1] < l - 1 || sky[i + W] < l - 1 || sky[i - W] < l - 1 || (y > 0 && sky[i - A] < l - 1)) {
      Q[qt++ & QM] = i;
    }
  }
  const spread = (L) => {
    while (qh !== qt) {
      const i = Q[qh++ & QM];
      const l = L[i];
      if (l < 2) continue;
      const y = (i / A) | 0, r = i - y * A, z = (r / W) | 0, x = r - z * W;
      const go = n => {
        const op = OPACITY[rb[n]];
        if (op >= 15) return;
        const nl = l - (op > 1 ? op : 1);
        if (L[n] < nl) { L[n] = nl; Q[qt++ & QM] = n; }
      };
      if (x > 0) go(i - 1); if (x < W - 1) go(i + 1);
      if (z > 0) go(i - W); if (z < W - 1) go(i + W);
      if (y > 0) go(i - A); if (y < ny - 1) go(i + A);
    }
  };
  spread(sky);
  qh = qt = 0;
  for (let i = 0; i < N; i++) { const e = SLIGHT[rb[i]] ? lightOf(rb[i], rm[i]) : EMIT[rb[i]]; if (e) { blk[i] = e; Q[qt++ & QM] = i; } }
  spread(blk);

  /* ---- biome colours, blended over 5 x 5 columns like Minecraft ---- */
  const tintG = new Uint32Array(256), tintL = new Uint32Array(256), tintW = new Uint32Array(256);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    let gr = 0, gg = 0, gb = 0, lr = 0, lg = 0, lb = 0, wr = 0, wg = 0, wb = 0, n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const b = bio[(16 + z + dz) * W + 16 + x + dx];
      const g = colours.grass[b], l = colours.leaf[b], w = colours.water[b];
      gr += g >> 16; gg += (g >> 8) & 255; gb += g & 255;
      lr += l >> 16; lg += (l >> 8) & 255; lb += l & 255;
      wr += w >> 16; wg += (w >> 8) & 255; wb += w & 255;
      n++;
    }
    const k = (z << 4) | x;
    tintG[k] = ((gr / n) << 16) | ((gg / n) << 8) | (gb / n);
    tintL[k] = ((lr / n) << 16) | ((lg / n) << 8) | (lb / n);
    tintW[k] = ((wr / n) << 16) | ((wg / n) << 8) | (wb / n);
  }

  const out = {
    opaque: new Buf(4096, TERRAIN), cutout: new Buf(2048, TERRAIN),
    translucent: new Buf(256, TERRAIN), fluid: new Buf(1024, FLUIDF),
    plants: new Buf(1024, TERRAIN),      // crossed sprites: grass, flowers, torches (hidden far away)
    leafIn: new Buf(1024, TERRAIN),      // faces between two leaf blocks (only drawn close up)
  };
  /* Smart leaves: a face between two leaf blocks is kept only when one of
     them is on the outside of the canopy. You cannot see the faces deep
     inside a tree anyway, and in a jungle they are most of the triangles. */
  const { LEAF, MODEL, SMALL, ORIENT, WL } = tables();
  const outer = new Int8Array(N);
  const onSurface = j => {
    let v = outer[j];
    if (v) return v > 0;
    v = -1;
    for (let f = 0; f < 6; f++) { const nb = rb[j + NSTEP[f]]; if (!LEAF[nb] && !OPAQUE[nb]) { v = 1; break; } }
    outer[j] = v;
    return v > 0;
  };
  const seed = job.seed | 0;
  const wx0 = job.cx * 16, wz0 = job.cz * 16;

  const isWaterish = b => FLUID[b] === 1 || (BLOCKS[b] && BLOCKS[b].waterlogged);
  // how deep under water a cell is (0 = not under water), for caustics and absorption
  const waterDepth = (i, y) => {
    if (!isWaterish(rb[i])) return 0;
    let d = 1, j = i + A, yy = y + 1;
    while (yy < ny && d < 15 && isWaterish(rb[j])) { d++; j += A; yy++; }
    return d;
  };
  const tintFor = (d, k) => {
    switch (d.tint) {
      case 'grass': return tintG[k];
      case 'foliage': return tintL[k];
      case 'spruce': return SPRUCE_LEAF;
      case 'birch': return BIRCH_LEAF;
      case 'water': return tintW[k];
      default: return d.rgb !== undefined ? d.rgb : 0xffffff;     // a state's own colour (redstone dust, stems)
    }
  };

  /* ---- one cube face ---- */
  const AO4 = [0, 0, 0, 0], LS4 = [0, 0, 0, 0], LB4 = [0, 0, 0, 0];
  function face(buf, f, x, y, z, i, layer, flags, tint, wave, rnd, box) {
    const F = FACES[f];
    const fi = i + NSTEP[f];                      // the cell the face looks into
    const wd = waterDepth(fi, y + F.n[1]);
    // smooth light and occlusion at each corner
    const ao = AO4, ls = LS4, lb = LB4;
    for (let c = 0; c < 4; c++) {
      const S = SHADE[f][c];
      const s1 = fi + S[0], s2 = fi + S[1], cc = fi + S[2];
      const o1 = OPAQUE[rb[s1]] || 0, o2 = OPAQUE[rb[s2]] || 0, oc = OPAQUE[rb[cc]] || 0;
      ao[c] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
      let sl = sky[fi], bl = blk[fi], n = 1;
      if (!o1) { sl += sky[s1]; bl += blk[s1]; n++; }
      if (!o2) { sl += sky[s2]; bl += blk[s2]; n++; }
      if (!oc && !(o1 && o2)) { sl += sky[cc]; bl += blk[cc]; n++; }
      ls[c] = sl / n; lb[c] = bl / n;
    }
    const flip = ao[0] + ao[2] < ao[1] + ao[3];
    const v0 = buf.n;
    for (let c = 0; c < 4; c++) {
      const [u, v] = CORNERS[c];
      let px = x + 0.5 + F.n[0] * 0.5 + F.t[0] * (u - 0.5) + F.b[0] * (v - 0.5);
      let py = y + 0.5 + F.n[1] * 0.5 + F.t[1] * (u - 0.5) + F.b[1] * (v - 0.5);
      let pz = z + 0.5 + F.n[2] * 0.5 + F.t[2] * (u - 0.5) + F.b[2] * (v - 0.5);
      let tu = u * 16, tv = v * 16;
      if (box) {
        // a shorter or inset box: snow layers, cactus sides
        if (box.h !== undefined && py > y + box.h) { py = y + box.h; }
        if (box.h !== undefined && F.n[1] === 0) tv = v ? 16 : 16 - box.h * 16;
        if (box.in && F.n[1] === 0) { px -= F.n[0] * box.in; pz -= F.n[2] * box.in; }
      }
      const k = buf.vert(), [P, Aa, L, C] = buf.arrs;
      P[k * 4] = Math.round((px + 8) * 32); P[k * 4 + 1] = Math.round(py * 32); P[k * 4 + 2] = Math.round((pz + 8) * 32); P[k * 4 + 3] = layer;
      Aa[k * 4] = tu; Aa[k * 4 + 1] = tv; Aa[k * 4 + 2] = f + wave * 8; Aa[k * 4 + 3] = ao[c] | flags;
      L[k * 4] = Math.round(ls[c] * 17); L[k * 4 + 1] = Math.round(lb[c] * 17); L[k * 4 + 2] = wd * 17; L[k * 4 + 3] = rnd;
      C[k * 4] = tint >> 16; C[k * 4 + 1] = (tint >> 8) & 255; C[k * 4 + 2] = tint & 255; C[k * 4 + 3] = 255;
    }
    buf.quad(v0, flip);
  }

  /* ---- a free quad (plants, torches, pads): corners given outright ---- */
  function quad(buf, pts, uvs, layer, nIdx, flags, tint, wave, rnd, sl, bl, wd) {
    const v0 = buf.n;
    for (let c = 0; c < 4; c++) {
      const k = buf.vert(), [P, Aa, L, C] = buf.arrs;
      P[k * 4] = Math.round((pts[c][0] + 8) * 32); P[k * 4 + 1] = Math.round(pts[c][1] * 32); P[k * 4 + 2] = Math.round((pts[c][2] + 8) * 32); P[k * 4 + 3] = layer;
      Aa[k * 4] = uvs[c][0]; Aa[k * 4 + 1] = uvs[c][1]; Aa[k * 4 + 2] = nIdx + wave * 8; Aa[k * 4 + 3] = 3 | flags;
      L[k * 4] = sl * 17; L[k * 4 + 1] = bl * 17; L[k * 4 + 2] = wd * 17; L[k * 4 + 3] = rnd;
      C[k * 4] = tint >> 16; C[k * 4 + 1] = (tint >> 8) & 255; C[k * 4 + 2] = tint & 255; C[k * 4 + 3] = 255;
    }
    buf.quad(v0, false);
  }

  /* ---- one face of a box in a shaped block ----
     Lit like a cube face: the light and occlusion at the face's four
     corners (from the cell it looks into when it is on the block's edge,
     else from the block's own cell), then each vertex takes the value at
     its own spot on the face, so half a slab's side shades like half a cube. */
  const BAO = [0, 0, 0, 0], BLS = [0, 0, 0, 0], BLB = [0, 0, 0, 0], PB = [0, 0, 0];
  function boxFace(buf, f, x, y, z, i, bx, layer, uvr, flags, tint, rnd, edge) {
    const F = FACES[f];
    const fi = edge ? i + NSTEP[f] : i;
    const wd = waterDepth(fi, y + (edge ? F.n[1] : 0));
    for (let c = 0; c < 4; c++) {
      const S = SHADE[f][c];
      const s1 = fi + S[0], s2 = fi + S[1], cc = fi + S[2];
      const o1 = OPAQUE[rb[s1]] || 0, o2 = OPAQUE[rb[s2]] || 0, oc = OPAQUE[rb[cc]] || 0;
      BAO[c] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
      let sl = sky[fi], bl = blk[fi], n = 1;
      if (!o1) { sl += sky[s1]; bl += blk[s1]; n++; }
      if (!o2) { sl += sky[s2]; bl += blk[s2]; n++; }
      if (!oc && !(o1 && o2)) { sl += sky[cc]; bl += blk[cc]; n++; }
      BLS[c] = sl / n; BLB[c] = bl / n;
    }
    const b0 = bx.f, b1 = bx.t;
    let kt = 0, kb = 0;
    for (let k = 0; k < 3; k++) { if (F.t[k]) kt = k; if (F.b[k]) kb = k; }
    const v0 = buf.n;
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let c = 0; c < 4; c++) {
      const u = CORNERS[c][0], v = CORNERS[c][1];
      for (let k = 0; k < 3; k++) {
        if (F.n[k]) PB[k] = F.n[k] > 0 ? b1[k] : b0[k];
        else if (k === kt) PB[k] = (F.t[k] > 0) === (u === 1) ? b1[k] : b0[k];
        else PB[k] = (F.b[k] > 0) === (v === 1) ? b1[k] : b0[k];
      }
      // where on the full face this corner is (0..16), which is also its texture spot
      const fu = F.t[kt] > 0 ? PB[kt] : 16 - PB[kt], fv = F.b[kb] > 0 ? PB[kb] : 16 - PB[kb];
      let tu = fu, tv = fv;
      if (uvr) { tu = u ? uvr[2] : uvr[0]; tv = v ? uvr[3] : uvr[1]; }
      // corners are (0,1) (1,1) (1,0) (0,0): blend them for this spot
      const s = Math.min(1, Math.max(0, fu / 16)), t = Math.min(1, Math.max(0, fv / 16));
      const w00 = (1 - s) * (1 - t), w10 = s * (1 - t), w01 = (1 - s) * t, w11 = s * t;
      const ao = BAO[3] * w00 + BAO[2] * w10 + BAO[0] * w01 + BAO[1] * w11;
      const ls = BLS[3] * w00 + BLS[2] * w10 + BLS[0] * w01 + BLS[1] * w11;
      const lb = BLB[3] * w00 + BLB[2] * w10 + BLB[0] * w01 + BLB[1] * w11;
      const aq = Math.round(ao);
      if (c === 0) a0 = aq; else if (c === 1) a1 = aq; else if (c === 2) a2 = aq; else a3 = aq;
      const k = buf.vert(), [P, Aa, L, C] = buf.arrs;
      P[k * 4] = Math.round((x + PB[0] / 16 + 8) * 32); P[k * 4 + 1] = Math.round((y + PB[1] / 16) * 32); P[k * 4 + 2] = Math.round((z + PB[2] / 16 + 8) * 32); P[k * 4 + 3] = layer;
      Aa[k * 4] = tu; Aa[k * 4 + 1] = tv; Aa[k * 4 + 2] = f; Aa[k * 4 + 3] = aq | flags;
      L[k * 4] = Math.round(ls * 17); L[k * 4 + 1] = Math.round(lb * 17); L[k * 4 + 2] = wd * 17; L[k * 4 + 3] = rnd;
      C[k * 4] = tint >> 16; C[k * 4 + 1] = (tint >> 8) & 255; C[k * 4 + 2] = tint & 255; C[k * 4 + 3] = 255;
    }
    buf.quad(v0, a0 + a2 < a1 + a3);
  }
  const QP = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], QUV = [[0, 0], [0, 0], [0, 0], [0, 0]];
  function drawModel(x, y, z, i, d, k2, rnd) {
    const nb = (dx, dy, dz) => {
      const yy = y + dy;
      if (yy < 0 || yy >= ny) return null;
      const j = i + dx + dz * W + dy * A, b2 = rb[j];
      return b2 ? { d: BLOCKS[b2], m: rm[j] } : null;
    };
    const list = boxesOf(d, rm[i], nb);
    if (!list) return;
    const tint = tintFor(d, k2), tinted = d.tint ? 64 : 0;
    const buf = d.pass === 'translucent' ? out.translucent : d.pass === 'opaque' ? out.opaque : out.cutout;
    const small = SMALL[d.id];
    for (const bx of list) {
      if (bx.q) {
        // a free quad: crossed planes and things lying flat
        for (let c = 0; c < 4; c++) { QP[c][0] = x + bx.q[c][0] / 16; QP[c][1] = y + bx.q[c][1] / 16; QP[c][2] = z + bx.q[c][2] / 16; }
        const uv = bx.uv;
        QUV[0][0] = uv[0]; QUV[0][1] = uv[3]; QUV[1][0] = uv[2]; QUV[1][1] = uv[3];
        QUV[2][0] = uv[2]; QUV[2][1] = uv[1]; QUV[3][0] = uv[0]; QUV[3][1] = uv[1];
        quad(small ? out.plants : out.cutout, QP, QUV, bx.layer, 2, (bx.up ? 0 : 32) | tinted, tint, d.wave || 0, rnd, sky[i], blk[i], waterDepth(i, y));
        continue;
      }
      const faces = bx.faces || d.faces;
      for (let f = 0; f < 6; f++) {
        if (bx.skip && (bx.skip & (1 << f))) continue;
        const F = FACES[f];
        let ax = 0; for (let k = 0; k < 3; k++) if (F.n[k]) ax = k;
        const edge = F.n[ax] > 0 ? bx.t[ax] >= 16 : bx.f[ax] <= 0;
        // on the block's edge against a full cube: never seen
        if (edge && OPAQUE[rb[i + NSTEP[f]]]) continue;
        boxFace(small ? out.plants : buf, f, x, y, z, i, bx, faces[f], bx.uv ? bx.uv[f] : null, tinted, tint, rnd, edge);
      }
    }
  }

  /* ---- fluids ---- */
  // a waterlogged plant (seagrass, kelp) counts as a still water source
  const fluidOf = b => FLUID[b] || (WL[b] ? 1 : 0);
  const fluidHeight = (i, kind) => {
    const b = rb[i];
    if (fluidOf(b) !== kind) return -1;
    if (WL[b]) return 8 / 9;
    const m = rm[i];
    if (m & FALLING) return 1;
    return (8 - (m & LEVEL)) / 9;
  };
  const sameAbove = (i, kind) => i + A < N && fluidOf(rb[i + A]) === kind;
  function corner(i, ox, oz, kind) {
    // the four cells that meet at this corner
    let sum = 0, wsum = 0;
    for (const [dx, dz] of [[ox - 1, oz - 1], [ox, oz - 1], [ox - 1, oz], [ox, oz]]) {
      const j = i + dx + dz * W;
      if (sameAbove(j, kind)) return 1;
      const h = fluidHeight(j, kind);
      if (h >= 0) { const w = h >= 0.8 ? 10 : 1; sum += h * w; wsum += w; }
      else if (!OPAQUE[rb[j]]) { sum += 0; wsum += 1; }
    }
    return wsum ? sum / wsum : 0;
  }
  const fluidVerts = [];        // [vertex, cell, corner (0-3), kind] for every vertex on a fluid's top edge
  function fluidCell(x, y, z, i, kind) {
    const buf = out.fluid;
    const k2 = (z << 4) | x;
    const wc = kind === 1 ? tintW[k2] : 0xff6a1a;
    const layer = BLOCKS[kind === 1 ? B.water : B.lava].faces[2];
    const m = WL[rb[i]] ? 0 : rm[i], falling = (m & FALLING) ? 1 : 0, level = m & LEVEL;
    const above = sameAbove(i, kind);
    const h = [corner(i, 0, 0, kind), corner(i, 1, 0, kind), corner(i, 1, 1, kind), corner(i, 0, 1, kind)];
    if (above) { h[0] = h[1] = h[2] = h[3] = 1; }
    // flow: downhill across the surface, from the corner heights
    let fx = (h[0] + h[3]) - (h[1] + h[2]), fz = (h[0] + h[1]) - (h[3] + h[2]);
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-3) { fx /= fl; fz /= fl; } else { fx = 0; fz = 0; }
    const strength = Math.min(1, fl * 3);
    const sl = Math.max(sky[i], i + A < N ? sky[i + A] : 15), bl = Math.max(blk[i], i + A < N ? blk[i + A] : 0);
    const flags = (falling ? 1 : 0) | (kind === 2 ? 2 : 0);
    const put = (px, py, pz, nIdx, top, cn) => {
      const k = buf.vert(), [P, Aa, F, C] = buf.arrs;
      if (cn !== undefined) fluidVerts.push(k, i, cn, kind);
      P[k * 4] = Math.round((px + 8) * 32); P[k * 4 + 1] = Math.round(py * 32); P[k * 4 + 2] = Math.round((pz + 8) * 32); P[k * 4 + 3] = layer;
      Aa[k * 4] = nIdx; Aa[k * 4 + 1] = flags | (top ? 4 : 0); Aa[k * 4 + 2] = sl * 17; Aa[k * 4 + 3] = bl * 17;
      F[k * 4] = Math.round(fx * strength * 127); F[k * 4 + 1] = Math.round(fz * strength * 127); F[k * 4 + 2] = 0; F[k * 4 + 3] = 0;
      C[k * 4] = wc >> 16; C[k * 4 + 1] = (wc >> 8) & 255; C[k * 4 + 2] = wc & 255; C[k * 4 + 3] = (falling ? 8 : level) * 28;
    };
    // the surface
    if (!above) {
      const v0 = buf.n;
      put(x, y + h[0], z, 2, true, 0); put(x, y + h[3], z + 1, 2, true, 3); put(x + 1, y + h[2], z + 1, 2, true, 2); put(x + 1, y + h[1], z, 2, true, 1);
      buf.quad(v0, false);
    }
    // the sides, where it meets air or anything that is not a full block
    const sides = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const fIdx = [0, 1, 4, 5];
    for (let s = 0; s < 4; s++) {
      const [dx, , dz] = sides[s];
      const j = i + dx + dz * W;
      const nb = rb[j];
      if (fluidOf(nb) === kind || OPAQUE[nb]) continue;
      // the two corners on this side
      let a, b, ax, az, bx, bz, ca, cb;
      if (dx === 1) { a = h[1]; b = h[2]; ax = x + 1; az = z; bx = x + 1; bz = z + 1; ca = 1; cb = 2; }
      else if (dx === -1) { a = h[3]; b = h[0]; ax = x; az = z + 1; bx = x; bz = z; ca = 3; cb = 0; }
      else if (dz === 1) { a = h[2]; b = h[3]; ax = x + 1; az = z + 1; bx = x; bz = z + 1; ca = 2; cb = 3; }
      else { a = h[0]; b = h[1]; ax = x; az = z; bx = x + 1; bz = z; ca = 0; cb = 1; }
      const v0 = buf.n;
      put(ax, y, az, fIdx[s], false); put(bx, y, bz, fIdx[s], false); put(bx, y + b, bz, fIdx[s], false, cb); put(ax, y + a, az, fIdx[s], false, ca);
      buf.quad(v0, false);
    }
    // the underside, over air
    const below = rb[i - A];
    if (y > 0 && fluidOf(below) !== kind && !OPAQUE[below]) {
      const v0 = buf.n;
      put(x, y, z, 3, false); put(x + 1, y, z, 3, false); put(x + 1, y, z + 1, 3, false); put(x, y, z + 1, 3, false);
      buf.quad(v0, false);
    }
  }

  /* ---- walk the middle chunk ---- */
  const bufs = [out.opaque, out.cutout, out.translucent, out.fluid, out.plants, out.leafIn];
  const fast = !!job.fast;              // Minecraft's "fast" leaves: solid, with no faces between them
  for (let y = 0; y < ny - 1; y++) {
    if ((y & 15) === 0) for (const bb of bufs) bb.marks[y >> 4] = bb.ni;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const i = y * A + (16 + z) * W + 16 + x;
        const b = rb[i];
        if (!b) continue;
        let d = BLOCKS[b];
        const k2 = (z << 4) | x;
        const wx = wx0 + x, wz = wz0 + z;
        const rnd = (hash3(seed, wx, y, wz) * 255) | 0;
        // a block drawn by its state (a crop's stage, a lit lamp, an extended piston: sim/states.js)
        if (STATEFUL[b]) { d = stateDef(d, rm[i]); if (d.asModel) { drawModel(x, y, z, i, d, k2, rnd); continue; } }
        if (d.shape === 'fluid') { fluidCell(x, y, z, i, FLUID[b]); continue; }
        if (d.waterlogged) fluidCell(x, y, z, i, 1);     // the water around a sea plant
        if (MODEL[b]) { drawModel(x, y, z, i, d, k2, rnd); continue; }
        if (d.shape === 'cube' || d.shape === 'snow' || d.shape === 'cactus') {
          const fastLeaf = fast && d.leaves;
          const buf = d.pass === 'opaque' || fastLeaf ? out.opaque : d.pass === 'translucent' ? out.translucent : out.cutout;
          const tint = tintFor(d, k2);
          const tinted = d.tint ? 64 : 0;
          const box = d.shape === 'snow' ? { h: d.height } : d.shape === 'cactus' ? { in: 1 / 16 } : null;
          const snowy = d.snowy && (rb[i + A] === B.snow || rb[i + A] === B.snow_block || rb[i + A] === B.powder_snow);
          for (let f = 0; f < 6; f++) {
            const nb = rb[i + NSTEP[f]];
            if (box && box.h !== undefined) { if (f === 3 && OPAQUE[nb]) continue; if (f !== 2 && f !== 3 && OPAQUE[nb]) continue; }
            else {
              if (OPAQUE[nb]) continue;
              if (fastLeaf && LEAF[nb]) continue;
              if (d.leaves && LEAF[nb] && !onSurface(i) && !onSurface(i + NSTEP[f])) continue;
              if (nb === b && d.pass !== 'cutout') continue;            // glass to glass, ice to ice
              if (nb === b && d.pass === 'cutout' && !d.leaves) continue;
              if (d.shape === 'cactus' && (f === 2 || f === 3) && nb === b) continue;
            }
            let layer = d.faces[f], flags = 0, fTint = tint, ftinted = tinted;
            // a few blocks come in variants, chosen and turned by position
            const h = hash3(seed ^ 0x51ed, wx, y, wz);
            if (f === 2 && d.topVariantLayers) { layer = d.topVariantLayers[(h * d.topVariantLayers.length) | 0]; flags |= ((h * 997) & 3) << 2; }
            else if (d.variantLayers) { layer = d.variantLayers[(h * d.variantLayers.length) | 0]; if (f === 2 || f === 3) flags |= ((h * 997) & 3) << 2; }
            const or = ORIENT[b];
            if (or) {
              const m = rm[i];
              if (or === 1 && m) {
                // a log on its side: the rings on the ends, the bark turned to run along it
                const ax = m === 1 ? 0 : 2;
                const end = ax === 0 ? (f === 0 || f === 1) : (f === 4 || f === 5);
                layer = end ? d.faces[2] : d.faces[0];
                if (!end && (ax === 0 || f === 0 || f === 1)) flags |= 1 << 2;
              } else if (or >= 2) {
                const fm = or === 2 ? m & 3 : m & 7;
                const front = fm < 4 ? FACING_FACE[fm] : fm === 4 ? 2 : 3;
                if (f === front) { if (d.front !== undefined) layer = d.front; }
                else if (f === (front ^ 1) && d.back !== undefined) layer = d.back;
                else if (fm >= 4) layer = d.faces[0];          // pointing up or down: the rest show the side
              }
            } else if (d.front !== undefined && f === 5) layer = d.front;
            if (d.overlay !== undefined && f !== 2 && f !== 3) {
              if (snowy) { layer = d.snowy; ftinted = 0; fTint = 0xffffff; }
              else flags |= 16;                       // grass on the dirt: the overlay, tinted
            } else if (d.overlay !== undefined && f === 3) { ftinted = 0; fTint = 0xffffff; }
            // a face between two leaf blocks goes where it can be left out at a distance
            const fb = d.leaves && !fastLeaf && LEAF[rb[i + NSTEP[f]]] ? out.leafIn : buf;
            face(fb, f, x, y, z, i, layer, flags | ftinted | (fastLeaf ? 128 : 0), fTint, fastLeaf ? 0 : (d.wave || 0), rnd, box);
          }
          continue;
        }
        const sl = sky[i], bl = blk[i];
        const wd = waterDepth(i, y);
        if (d.shape === 'cross') {
          const tint = tintFor(d, k2), tinted = d.tint ? 64 : 0;
          let ox = 0, oz = 0;
          if (d.offset) { ox = (hash3(seed ^ 0x1f, wx, 0, wz) - 0.5) * 0.5; oz = (hash3(seed ^ 0x2f, wx, 0, wz) - 0.5) * 0.5; }
          // a tall plant's two halves sway as one stem: the lower half less
          let wave = d.wave;
          const upperHalf = d.tall && (rm[i] & 8);
          if (wave === 1 && (d.upper || (d.tall && !upperHalf))) wave = 6;
          if (upperHalf && wave === 1) wave = 3;
          const s = 0.45, cx = x + 0.5 + ox, cz = z + 0.5 + oz;
          const layer = upperHalf && d.facesUpper ? d.facesUpper[2] : d.faces[2];
          const pts1 = [[cx - s, y, cz - s], [cx + s, y, cz + s], [cx + s, y + 1, cz + s], [cx - s, y + 1, cz - s]];
          const pts2 = [[cx - s, y, cz + s], [cx + s, y, cz - s], [cx + s, y + 1, cz - s], [cx - s, y + 1, cz + s]];
          const uvs = [[0, 16], [16, 16], [16, 0], [0, 0]];
          quad(out.plants, pts1, uvs, layer, 2, 32 | tinted, tint, wave, rnd, sl, bl, wd);
          quad(out.plants, pts2, uvs, layer, 2, 32 | tinted, tint, wave, rnd, sl, bl, wd);
          continue;
        }
        if (d.shape === 'torch') {
          // the pack draws its torch as a little iron cage with the flame in it: a sprite, crossed
          const layer = d.faces[2], s2 = 0.38, cx = x + 0.5, cz = z + 0.5;
          const uvs = [[0, 16], [16, 16], [16, 0], [0, 0]];
          quad(out.plants, [[cx - s2, y, cz - s2], [cx + s2, y, cz + s2], [cx + s2, y + 1, cz + s2], [cx - s2, y + 1, cz - s2]], uvs, layer, 2, 32, 0xffffff, 0, rnd, sl, bl, wd);
          quad(out.plants, [[cx - s2, y, cz + s2], [cx + s2, y, cz - s2], [cx + s2, y + 1, cz - s2], [cx - s2, y + 1, cz + s2]], uvs, layer, 2, 32, 0xffffff, 0, rnd, sl, bl, wd);
          continue;
        }
        if (d.shape === 'pad') {
          const layer = d.faces[2], tint = tintFor(d, k2), py = y + 1 / 64;
          const r = (hash3(seed ^ 0x77, wx, y, wz) * 4) | 0;
          const uv = [[0, 16], [16, 16], [16, 0], [0, 0]];
          const ruv = [0, 1, 2, 3].map(c => uv[(c + r) & 3]);
          quad(out.cutout, [[x, py, z + 1], [x + 1, py, z + 1], [x + 1, py, z], [x, py, z]], ruv, layer, 2, 32 | 64, tint, 5, rnd, sl, bl, 0);
          continue;
        }
      }
    }
  }
  for (let s = ((ny - 1) >> 4) + 1; s <= 24; s++) for (const bb of bufs) bb.marks[s] = bb.ni;
  for (const bb of bufs) for (let s = 1; s <= 24; s++) if (bb.marks[s] < bb.marks[s - 1]) bb.marks[s] = bb.marks[s - 1];

  /* ---- which faces of each 16-block section can see each other ----
     Sodium's cave culling: flood the open cells of a section; every region
     that touches two faces connects them. The game walks these from the
     camera and never draws a section no line of sight can reach (most caves,
     when you stand on the surface). vis[s*6 + entry] = the faces you can
     leave by, having come in through entry. */
  const vis = new Uint8Array(24 * 6);
  const seen = new Uint8Array(4096), stack = new Int32Array(4096);
  for (let s = 0; s < 24; s++) {
    const y0 = s * 16;
    if (y0 >= ny - 1) { vis.fill(63, s * 6, s * 6 + 6); continue; }
    seen.fill(0);
    for (let c = 0; c < 4096; c++) {
      if (seen[c]) continue;
      const cy = c >> 8, cz = (c >> 4) & 15, cx = c & 15;
      const ri = (y0 + cy) * A + (16 + cz) * W + 16 + cx;
      if (y0 + cy >= ny || OPAQUE[rb[ri]]) { seen[c] = 1; continue; }
      let sp = 0, faces = 0;
      stack[sp++] = c; seen[c] = 1;
      while (sp) {
        const q = stack[--sp];
        const qy = q >> 8, qz = (q >> 4) & 15, qx = q & 15;
        if (qx === 0) faces |= 2; if (qx === 15) faces |= 1;
        if (qy === 0) faces |= 8; if (qy === 15) faces |= 4;
        if (qz === 0) faces |= 32; if (qz === 15) faces |= 16;
        const nbs = [qx > 0 ? q - 1 : -1, qx < 15 ? q + 1 : -1, qz > 0 ? q - 16 : -1, qz < 15 ? q + 16 : -1, qy > 0 ? q - 256 : -1, qy < 15 ? q + 256 : -1];
        for (const n of nbs) {
          if (n < 0 || seen[n]) continue;
          const ny2 = n >> 8, nz = (n >> 4) & 15, nx = n & 15;
          const nri = (y0 + ny2) * A + (16 + nz) * W + 16 + nx;
          seen[n] = 1;
          if (y0 + ny2 >= ny || !OPAQUE[rb[nri]]) stack[sp++] = n;
        }
      }
      for (let f = 0; f < 6; f++) if (faces & (1 << f)) vis[s * 6 + f] |= faces;
    }
  }
  // the lowest cell the sky reaches: nothing under it can shade anything the sun lights
  let skyLow = ny;
  for (let y = 0; y < ny && skyLow === ny; y++) for (let z = 16; z < 32 && skyLow === ny; z++) for (let x = 16; x < 32; x++) if (sky[y * A + z * W + x] > 0 && !OPAQUE[rb[y * A + z * W + x]]) { skyLow = y; break; }

  /* ---- where the fluid surface was a moment ago ----
     The cells the flow has changed since the last mesh come with what they
     were. Put them back, see where each top corner would have been, and give
     every vertex the difference: the shader glides it from there to here, so
     water rises, spreads and drains smoothly instead of a level at a time. */
  const prev = job.prev;
  if (prev && prev.length && fluidVerts.length) {
    const save = new Int32Array(prev.length);
    for (let p = 0; p < prev.length; p += 3) {
      const ri = prev[p];
      save[p] = ri; save[p + 1] = rb[ri]; save[p + 2] = rm[ri];
      rb[ri] = prev[p + 1]; rm[ri] = prev[p + 2];
    }
    const cornerXZ = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const F = out.fluid.arrs[2], P = out.fluid.arrs[0];
    for (let q = 0; q < fluidVerts.length; q += 4) {
      const k = fluidVerts[q], i = fluidVerts[q + 1], cn = fluidVerts[q + 2], kind = fluidVerts[q + 3];
      const yy = (i / A) | 0;
      let old;
      if (fluidOf(rb[i]) !== kind) old = 0;                 // it was not there: rise from the floor
      else if (sameAbove(i, kind)) old = 1;
      else old = corner(i, cornerXZ[cn][0], cornerXZ[cn][1], kind);
      const now = P[k * 4 + 1] / 32 - yy;
      F[k * 4 + 2] = Math.max(-127, Math.min(127, Math.round((old - now) * 32)));
    }
    for (let p = 0; p < save.length; p += 3) { rb[save[p]] = save[p + 1]; rm[save[p]] = save[p + 2]; }
  }
  /* ---- the middle chunk's light, kept by the main thread for mobs ----
     sky * 16 + block, in the chunk's own cell order (js/entities reads it). */
  const light = new Uint8Array(256 * ny);
  for (let y = 0; y < ny; y++) for (let z = 0; z < 16; z++) {
    const r = y * A + (16 + z) * W + 16, o = (y << 8) | (z << 4);
    for (let x = 0; x < 16; x++) light[o + x] = (sky[r + x] << 4) | blk[r + x];
  }
  return { opaque: out.opaque.out(), cutout: out.cutout.out(), translucent: out.translucent.out(), fluid: out.fluid.out(), plants: out.plants.out(), leafIn: out.leafIn.out(), vis, skyLow, light, lightH: ny };
}
