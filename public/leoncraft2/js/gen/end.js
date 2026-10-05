/* ---------------------------------------------------------------------------
   Leoncraft 2 - the End's generator (the same interface as worldgen.js's Gen).

   Shaped after the game's End settings as the Minecraft Wiki describes them
   (the noise and the island hash are ours, so seeds do not match the game):

     islands   a height field in steps of 8 blocks: the main island falls
               off from 100 at the centre by 8 a step (gone at about 100
               blocks out), and past 1024 blocks a sparse grid of outer
               islands, each falling off at its own rate of 9 to 21 a step;
               the highest wins, clamped to -100..80, then (v - 8) / 128
     terrain   that plus blended 3D noise (xz and y scale 0.25, factors 80
               and 160), worked out every 8 blocks across and 4 up; slid
               away above y 56 (to -23.4375 by y 312) and below y 32 (to
               -0.234375 at y 4); 0.64 times, squeezed, solid above zero;
               all of it end stone
     spikes    ten obsidian pillars in a ring 42 blocks out, 76 to 103 tall
               and 2 to 5 wide (shuffled by the seed), bedrock on top, the
               two smallest-but-one caged in iron bars
     podium    the exit portal's bedrock bowl and pillar at 0, 0, unlit
     outer     chorus plants on the highlands; small floating islands
   The obsidian platform, the gateways, the crystals and the dragon belong to
   the fight (js/dim/endfight.js), not to the terrain.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=15';
import { CH, H, Y0, VOL, idx } from '../world-const.js?v=15';
import { BIO } from '../biomes.js?v=15';
import { NormalNoise, rng, mix32, hash3 } from '../noise.js?v=15';
import { BlendedNoise, yGradient, squeeze } from './blended.js?v=15';

const I = y => y - Y0;
const lerp = (a, b, t) => a + (b - a) * t;

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
    const S = this.seed;
    this.base = new BlendedNoise(S, 'end/base_3d_noise', 0.25, 0.25, 80, 160);
    this.nIsl = new NormalNoise(S, 'end_islands', -1, [1]);
    this.spikes = endSpikes(S);
    this.podiumY = null;
  }
  // the island height field at block (x, z): steps of 8 blocks
  islands(x, z) {
    const u = x / 8, v = z / 8;
    let best = Math.max(-100, Math.min(80, 100 - Math.sqrt(u * u + v * v) * 8));
    if (x * x + z * z < 800 * 800) return (best - 8) / 128;   // no outer island reaches this far in
    const ci = Math.floor(u / 2), cj = Math.floor(v / 2);
    for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) {
      const a = ci + i, b = cj + j;
      if (a * a + b * b <= 4096) continue;                     // inside 1024 blocks: only the main island
      if (this.cellIsland(a, b) === 0) continue;
      const k = this.cellIsland(a, b);
      const du = u - (a * 2 + 1), dv = v - (b * 2 + 1);
      const h = 100 - Math.sqrt(du * du + dv * dv) * k;
      if (h > best) best = Math.min(80, h);
    }
    return (best - 8) / 128;
  }
  // an outer island's fall-off rate for a grid cell, or 0 for none
  cellIsland(a, b) {
    const n = this.nIsl.sample(a * 0.5, 0, b * 0.5);
    if (n > -0.52) return 0;
    return 9 + Math.floor(hash3(this.seed ^ 0x1515, a, 0, b) * 13);
  }
  density(x, y, z, isl) {
    let d = isl + this.base.sample(x, y, z) * 0.6;
    d = -23.4375 + yGradient(y, 56, 312, 1, 0) * (d + 23.4375);
    d = -0.234375 + yGradient(y, 4, 32, 0, 1) * (d + 0.234375);
    return squeeze(0.64 * d);
  }
  column(x, z) {
    const isl = this.islands(x, z);
    const out = new Float32Array(33);
    if (isl < -0.5) return out.fill(-0.3);                      // the void: nothing to work out
    for (let k = 0; k <= 32; k++) out[k] = this.density(x, k * 4, z, isl);
    return out;
  }
  climate(x, z) { return { T: 0, Hu: 0 }; }
  biomeAt(x, z) {
    if (x * x + z * z <= 1024 * 1024) return BIO.the_end;
    const e = this.islands(x, z);
    return e > 0.25 ? BIO.end_highlands : e >= -0.0625 ? BIO.end_midlands : e < -0.21875 ? BIO.small_end_islands : BIO.end_barrens;
  }
  surfaceAt(x, z) {
    const c = this.column(Math.floor(x / 8) * 8, Math.floor(z / 8) * 8);
    for (let y = 127; y > 0; y--) { const v = lerp(c[y >> 2], c[Math.min(32, (y >> 2) + 1)], (y & 3) / 4); if (v > 0) return I(y); }
    return -1;
  }
  // the exact top block at a column, by the same blending as a chunk
  topAt(x, z) {
    const x0 = Math.floor(x / 8) * 8, z0 = Math.floor(z / 8) * 8, fx = (x - x0) / 8, fz = (z - z0) / 8;
    const a = this.column(x0, z0), b = this.column(x0 + 8, z0), c = this.column(x0, z0 + 8), d = this.column(x0 + 8, z0 + 8);
    for (let y = 127; y > 0; y--) {
      const k = y >> 2, fy = (y & 3) / 4;
      const v0 = lerp(lerp(a[k], b[k], fx), lerp(c[k], d[k], fx), fz);
      const v1 = lerp(lerp(a[k + 1], b[k + 1], fx), lerp(c[k + 1], d[k + 1], fx), fz);
      if (lerp(v0, v1, fy) > 0) return y;
    }
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
      for (let y = 0; y < 128; y++) {
        const k = y >> 2, fy = (y & 3) / 4;
        const v0 = lerp(lerp(a[k], b[k], fx), lerp(c[k], d[k], fx), fz);
        const v1 = lerp(lerp(a[k + 1], b[k + 1], fx), lerp(c[k + 1], d[k + 1], fx), fz);
        if (lerp(v0, v1, fy) > 0) blocks[idx(x, I(y), z)] = B.end_stone;
      }
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
