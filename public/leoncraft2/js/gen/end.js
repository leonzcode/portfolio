/* ---------------------------------------------------------------------------
   Leoncraft 2 - the End's generator (the same interface as worldgen.js's Gen).

   The land is the game's own from the seed: 26.3's end/islands and
   end/base_3d_noise, made with the old random as the game's End makes them
   (the outer islands as deepslate and cubiomes have them, both MIT:
   https://github.com/misode/deepslate, Copyright (c) 2021 Misode;
   https://github.com/Cubitect/cubiomes, Copyright (c) 2020 Cubitect):

     islands   the main island: 100 less the distance from 0, 0, clamped to
               -100..80; past 1024 blocks a grid of outer islands, one cell
               every 16 blocks where a simplex noise (java.util.Random from
               the seed, 17292 draws skipped) is under -0.9, each falling off
               at its own rate of 9 to 21 a step of 8 blocks; the higher
               wins, then (v - 8) / 128
     terrain   that plus the old blended noise (xz and y scale 0.25, factors
               80 and 160, smear 4, java.util.Random from the seed); slid away
               above y 56 (to -23.4375 by y 312) and below y 32 (to -0.234375
               at y 4); 0.64 times; worked out every 8 blocks across and 4 up
               and blended between (up, then across, then along); solid above
               zero; all of it end stone
     biomes    one a chunk, from the islands at its middle: the End within 64
               chunks of the centre, else highlands over 0.25, midlands from
               -0.0625, small islands under -0.21875, barrens between
     spikes    ten obsidian pillars in a ring 42 blocks out, 76 to 103 tall
               and 2 to 5 wide (shuffled by the seed), bedrock on top, the
               two smallest-but-one caged in iron bars
     podium    the exit portal's bedrock bowl and pillar at 0, 0, unlit
     outer     chorus plants on the highlands
   The obsidian platform, the gateways, the crystals and the dragon belong to
   the fight (js/dim/endfight.js), not to the terrain.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';
import { CH, H, Y0, VOL, idx } from '../world-const.js?v=107';
import { BIO } from '../biomes.js?v=107';
import { rng, mix32, NormalNoise, hash3 } from '../noise.js?v=107';
import { Simplex, Blended } from './noise.js?v=107';
import { LegacyRandom, seedLong } from './random.js?v=107';
import { BlendedNoise, yGradient, squeeze } from './blended.js?v=107';

const I = y => y - Y0;
const lerp = (a, b, t) => a + (b - a) * t;
const F = Math.fround;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// the slides at a height: the land's value v there becomes this
const slid = (y, v) => 0.64 * (-0.234375 + clamp((y - 4) / 28, 0, 1) * (-23.4375 + clamp(1 - (y - 56) / 256, 0, 1) * (v + 23.4375) + 0.234375));

/* The ten pillars for a seed: the game's ring of 42 blocks, heights 76 + 3i
   and radii 2 + i/3 handed out in a seeded shuffle; i = 1 and 2 are caged. */
export function endSpikes(seed) {
  const r = rng(mix32((seed | 0) ^ 0x5b1e));
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 9; i > 0; i--) { const j = r.int(i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = 2 * (-Math.PI + Math.PI / 10 * i);
    const k = order[i];
    out.push({ x: Math.floor(42 * Math.cos(a)), z: Math.floor(42 * Math.sin(a)), r: 2 + Math.floor(k / 3), h: 76 + k * 3, caged: k === 1 || k === 2 });
  }
  return out;
}

/* The exit portal (the "podium"): a bedrock bowl seven across round a pillar
   four tall, torches on the pillar's sides, the inside filled with end
   portal once the dragon is dead. Returns [x, y, z, block, meta] in world
   coordinates for a podium whose bowl floor is at y. */
export function podiumBlocks(y, active, egg) {
  const out = [];
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 3.5) continue;
    out.push([dx, y - 1, dz, B.bedrock, 0]);
    if (d >= 2.5) out.push([dx, y, dz, B.bedrock, 0]);
    else if (dx || dz) out.push([dx, y, dz, active ? B.end_portal : 0, 0]);
    // air above, so nothing grows into it
    for (let k = 1; k <= 4; k++) if (dx || dz) out.push([dx, y + k, dz, 0, 0]);
  }
  for (let k = 0; k < 4; k++) out.push([0, y + k, 0, B.bedrock, 0]);
  // wall torches round the pillar, one block below its top (meta: the face they hang from)
  if (B.wall_torch !== undefined) {
    out.push([1, y + 2, 0, B.wall_torch, 1]); out.push([-1, y + 2, 0, B.wall_torch, 0]);
    out.push([0, y + 2, 1, B.wall_torch, 5]); out.push([0, y + 2, -1, B.wall_torch, 4]);
  }
  out.push([0, y + 4, 0, egg ? B.dragon_egg : 0, 0]);
  return out;
}

export class EndGen {
  constructor(seed) {
    this.seed = seed | 0;
    const S = this.seed, L = seedLong(seed);
    const r = new LegacyRandom(L);
    r.consume(17292);
    this.simplex = new Simplex(r);
    this.base = new Blended(new LegacyRandom(L), 0.25, 0.25, 80, 160, 4);
    this.cols = new Map();
    this.cells = new Map();
    this.spikes = endSpikes(S);
    this.podiumY = null;
  }
  // the islands at block (x, z): the main island, or an outer one where it stands higher
  islands(x, z) {
    const main = (clamp(100 - Math.sqrt(x * x + z * z), -100, 80) - 8) * 0.0078125;
    const cx = Math.trunc(x / 8), cz = Math.trunc(z / 8), i = Math.trunc(cx / 2), j = Math.trunc(cz / 2);
    // (no outer island's cell is near enough to matter here)
    if ((Math.abs(i) + 12) ** 2 + (Math.abs(j) + 12) ** 2 <= 4096) return main;
    const k = cx % 2, l = cz % 2;
    let f = -100;
    for (let m = -12; m <= 12; m++) for (let n = -12; n <= 12; n++) {
      const o = i + m, p = j + n;
      if (o * o + p * p <= 4096) continue;
      const g = this.cell(o, p);
      if (g === 0) continue;
      const h = F(k - m * 2), q = F(l - n * 2);
      const v = clamp(F(100 - F(F(Math.sqrt(F(F(h * h) + F(q * q)))) * g)), -100, 80);
      if (v > f) f = v;
    }
    return Math.max(main, (f - 8) / 128);
  }
  // an outer island's fall-off rate at a cell of the grid (16 blocks a cell), or 0 for none
  cell(o, p) {
    const key = o * 1048576 + p;
    let g = this.cells.get(key);
    if (g === undefined) {
      g = this.simplex.sample2(o, p) < F(-0.9) ? F(F(F(F(Math.abs(o)) * 3439) + F(F(Math.abs(p)) * 147)) % 13 + 9) : 0;
      if (this.cells.size > 200000) this.cells.clear();
      this.cells.set(key, g);
    }
    return g;
  }
  /* The land's value at the corners of a column of cells (every 4 blocks up,
     x and z on the 8-block grid), before the squeeze, which keeps the sign:
     solid is where these, blended, come out above zero. At y 4 and below the
     floor's slide is all there is; from y 80 up nothing the noise can give
     (it never reaches 1.1 either way) lifts the land, nor the corners round
     it, over zero, so those are not worked out. */
  column(x, z) {
    const key = (x / 8) * 8388608 + z / 8;
    let out = this.cols.get(key);
    if (out) return out;
    out = new Float64Array(33);
    const isl = this.islands(x, z);
    for (let k = 0; k <= 32; k++) {
      const y = k * 4;
      out[k] = k <= 1 ? 0.64 * -0.234375 : k >= 20 ? -1 : slid(y, isl + this.base.sample(x, y, z));
    }
    if (this.cols.size > 4096) this.cols.clear();
    this.cols.set(key, out);
    return out;
  }
  // a block's value from the four columns round it, blended as the game blends: up, then across, then along
  static blend(a, b, c, d, y, fx, fz) {
    const k = y >> 2, fy = (y & 3) / 4;
    const a0 = a[k] + fy * (a[k + 1] - a[k]), b0 = b[k] + fy * (b[k + 1] - b[k]);
    const c0 = c[k] + fy * (c[k + 1] - c[k]), d0 = d[k] + fy * (d[k + 1] - d[k]);
    const e = a0 + fx * (b0 - a0), f = c0 + fx * (d0 - c0);
    return e + fz * (f - e);
  }
  climate(x, z) { return { T: 0, Hu: 0 }; }
  // one biome a chunk, read from the islands at the chunk's middle
  biomeAt(x, z) {
    const cx = x >> 4, cz = z >> 4;
    if (cx * cx + cz * cz <= 4096) return BIO.the_end;
    const e = this.islands(cx * 16 + 8, cz * 16 + 8);
    return e > 0.25 ? BIO.end_highlands : e >= -0.0625 ? BIO.end_midlands : e < -0.21875 ? BIO.small_end_islands : BIO.end_barrens;
  }
  // the top block of the bare land at a column (index y), or -1 over the void
  surfaceAt(x, z) {
    const y = this.topAt(x, z);
    return y < 0 ? -1 : I(y);
  }
  // the same as a world y
  topAt(x, z) {
    const x0 = Math.floor(x / 8) * 8, z0 = Math.floor(z / 8) * 8, fx = (x - x0) / 8, fz = (z - z0) / 8;
    const a = this.column(x0, z0), b = this.column(x0 + 8, z0), c = this.column(x0, z0 + 8), d = this.column(x0 + 8, z0 + 8);
    for (let y = 79; y > 0; y--) if (EndGen.blend(a, b, c, d, y, fx, fz) > 0) return y;
    return -1;
  }

  generate(cx, cz) {
    const blocks = new Uint16Array(VOL), meta = new Uint8Array(VOL), biome = new Uint8Array(256);
    const x0 = cx * CH, z0 = cz * CH, S = this.seed;
    const lat = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) lat.push(this.column(x0 + i * 8, z0 + j * 8));
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) biome[(z << 4) | x] = this.biomeAt(x0 + x, z0 + z);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = x >> 3, j = z >> 3, fx = (x & 7) / 8, fz = (z & 7) / 8;
      const a = lat[j * 3 + i], b = lat[j * 3 + i + 1], c = lat[(j + 1) * 3 + i], d = lat[(j + 1) * 3 + i + 1];
      for (let y = 1; y < 80; y++) if (EndGen.blend(a, b, c, d, y, fx, fz) > 0) blocks[idx(x, I(y), z)] = B.end_stone;
    }
    const put = (wx, y, wz, b, m) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || I(y) >= H) return;
      const ii = idx(x, I(y), z); blocks[ii] = b; meta[ii] = m || 0;
    };
    // the pillars
    for (const s of this.spikes) {
      if (s.x + s.r + 3 < x0 || s.x - s.r - 3 > x0 + 15 || s.z + s.r + 3 < z0 || s.z - s.r - 3 > z0 + 15) continue;
      this.spikeBlocks(s, put);
    }
    // the exit portal, unlit, on the ground at the centre
    if (x0 <= 4 && x0 + 15 >= -4 && z0 <= 4 && z0 + 15 >= -4) {
      const py = this.podiumFloor();
      for (const [dx, y, dz, b, m] of podiumBlocks(py, false, false)) put(dx, y, dz, b, m);
    }
    // the outer islands: chorus plants on the highlands
    if (cx * cx + cz * cz > 60 * 60) this.chorus(blocks, meta, biome, cx, cz);
    let top = 0;
    for (let i = VOL - 1; i >= 0; i--) if (blocks[i]) { top = i >> 8; break; }
    return { blocks, meta, biome, top };
  }
  podiumFloor() {
    if (this.podiumY === null) this.podiumY = Math.max(this.topAt(0, 0) + 1, 40);
    return this.podiumY;
  }
  spikeBlocks(s, put) {
    const r2 = s.r * s.r + 1;
    for (let dz = -s.r; dz <= s.r; dz++) for (let dx = -s.r; dx <= s.r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      for (let y = 0; y < s.h; y++) put(s.x + dx, y, s.z + dz, B.obsidian);
    }
    put(s.x, s.h, s.z, B.bedrock);
    if (s.caged) {
      for (let dy = 0; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const side = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        if (side || dy === 3) put(s.x + dx, s.h + dy, s.z + dz, B.iron_bars);
      }
    }
  }
  chorus(blocks, meta, biome, cx, cz) {
    const r = rng(mix32(this.seed ^ Math.imul(cx, 73428767) ^ Math.imul(cz, 912931)));
    if (biome[(8 << 4) | 8] !== BIO.end_highlands) return;
    const n = r.int(5);
    for (let k = 0; k < n; k++) {
      const x = 3 + r.int(10), z = 3 + r.int(10);
      let y = -1;
      for (let yy = 127; yy > 0; yy--) if (blocks[idx(x, I(yy), z)] === B.end_stone) { y = yy + 1; break; }
      if (y < 0) continue;
      this.growChorus(blocks, meta, r, x, y, z, 0);
    }
  }
  /* A chorus plant: a stalk up, then branches out sideways and up again,
     fewer and shorter the further they go, each branch ending in a flower. */
  growChorus(blocks, meta, r, x, y, z, depth) {
    const free = (px, py, pz) => px >= 0 && px <= 15 && pz >= 0 && pz <= 15 && py > 0 && py < 250 && blocks[idx(px, I(py), pz)] === 0;
    const put = (px, py, pz, b) => { if (px >= 0 && px <= 15 && pz >= 0 && pz <= 15) blocks[idx(px, I(py), pz)] = b; };
    const len = 1 + r.int(depth === 0 ? 4 : 3);
    let top = y;
    for (let k = 0; k < len; k++) { if (!free(x, top, z)) break; put(x, top, z, B.chorus_plant); top++; }
    if (top === y) return;
    const branches = depth >= 4 ? 0 : r.int(depth === 0 ? 4 : 3) + (depth === 0 ? 1 : 0);
    let grew = 0;
    for (let b = 0; b < branches; b++) {
      const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][r.int(4)];
      const bx = x + dx, bz = z + dz, by = top - 1;
      if (!free(bx, by, bz) || !free(bx, by + 1, bz)) continue;
      put(bx, by, bz, B.chorus_plant);
      this.growChorus(blocks, meta, r, bx, by + 1, bz, depth + 1);
      grew++;
    }
    if (!grew && free(x, top, z)) put(x, top, z, B.chorus_flower);
  }
}
