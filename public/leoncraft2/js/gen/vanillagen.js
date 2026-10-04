/* ---------------------------------------------------------------------------
   Leoncraft 2 - the vanilla world generator.

   Makes the same world as Minecraft Java Edition 26.3 does from the same
   seed, block for block where it can: the terrain from the game's own
   density functions (worldgen data), its aquifers (underground water and
   lava), its biomes (the overworld biome table and the zoom), its material
   rules (bedrock, deepslate, ore veins, grass, sand, terracotta bands...),
   then carvers and features (see features.js).

   It has the same face as the older generator (worldgen.js), so the game
   does not care which one made a chunk: new VanillaGen(seed) with seed a
   decimal string (a Java long), generate(cx, cz) -> { blocks, meta, biome,
   top }, surfaceAt(x, z) and climate(x, z).

   The parts of the algorithm follow misode's deepslate (MIT,
   https://github.com/misode/deepslate, Copyright (c) 2021 Misode) where it
   has them; the rest (the material rule conditions it lacks, the surface
   extensions, carvers, features) is written from the game's observable
   behaviour and checked against chunks the real 26.3 server made.
--------------------------------------------------------------------------- */
import { VDATA } from './vdata.js?v=9';
import { DensityState, Compiler, tri, children } from './density.js?v=9';
import { BiomeTable, Zoom, quantize } from './biomesrc.js?v=9';
import { Xoroshiro } from './random.js?v=9';
import { B } from '../blocks.js?v=9';
import { BIO, BIOMES } from '../biomes.js?v=9';
import { H, Y0, VOL } from '../world-const.js?v=9';
import { Decorator } from './features.js?v=9';

const MIN_Y = -64, SEA_LEVEL = 63;
const strip = s => (typeof s === 'string' && s.startsWith('minecraft:') ? s.slice(10) : s);
const lerp = (t, a, b) => a + t * (b - a);
const map = (v, a, b, c, d) => lerp((v - a) / (b - a), c, d);
const clampedMap = (v, a, b, c, d) => { const t = (v - a) / (b - a); return t < 0 ? c : t > 1 ? d : lerp(t, c, d); };
const WAIT = -2032 * 2;   // an aquifer with no fluid at all

/* ------------------------------------------------ vanilla block states --
   A vanilla state ("minecraft:snow[layers=2]" or { Name, Properties })
   to this game's block id and meta byte. */
const STATE = new Map();
export function stateOf(s) {
  let name, props = null;
  if (typeof s === 'string') {
    const i = s.indexOf('[');
    name = strip(i < 0 ? s : s.slice(0, i));
    if (i >= 0) { props = {}; for (const kv of s.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); props[k] = v; } }
  } else { name = strip(s.Name); props = s.Properties || null; }
  const key = name + (props ? JSON.stringify(props) : '');
  let st = STATE.get(key);
  if (st) return st;
  let id = B[name];
  if (id === undefined) { id = B.stone; }
  let meta = 0;
  if (props) {
    if (props.axis) meta = props.axis === 'x' ? 1 : props.axis === 'z' ? 2 : 0;
    if (props.layers) meta = (+props.layers - 1) & 7;
    if (props.level && (name === 'water' || name === 'lava')) { const l = +props.level; meta = l >= 8 ? 8 | (l - 8) : l; }
    if (props.half === 'upper') meta |= 8;
  }
  st = { id, meta, name, props };
  STATE.set(key, st);
  return st;
}

/* ============================================================ aquifers == */
const SURFACE_SAMPLING = [[-2, -1], [-1, -1], [0, -1], [1, -1], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1]];
class FluidStatus {
  constructor(level, type) { this.level = level; this.type = type; }     // type: 1 water, 2 lava
  at(y) { return y < this.level ? this.type : 0; }
}
const LAVA_ST = new FluidStatus(-54, 2), SEA_ST = new FluidStatus(SEA_LEVEL, 1);
const globalFluid = y => (y < Math.min(-54, SEA_LEVEL) ? LAVA_ST : SEA_ST);

class Aquifer {
  constructor(gen, x0, z0) {
    this.g = gen;
    const minX = x0, maxX = x0 + 15, minZ = z0, maxZ = z0 + 15, minY = MIN_Y, maxY = MIN_Y + H - 1;
    this.minGX = Math.floor((minX - 5) / 16); const maxGX = Math.floor((maxX - 5) / 16) + 1;
    this.minGY = Math.floor((minY + 1) / 12) - 1; const maxGY = Math.floor((maxY + 1) / 12) + 1;
    this.minGZ = Math.floor((minZ - 5) / 16); const maxGZ = Math.floor((maxZ - 5) / 16) + 1;
    this.sx = maxGX - this.minGX + 1; this.sy = maxGY - this.minGY + 1; this.sz = maxGZ - this.minGZ + 1;
    const n = this.sx * this.sy * this.sz;
    this.status = new Array(n).fill(null);
    this.loc = new Int32Array(n * 3);
    this.has = new Uint8Array(n);
    // the highest the preliminary surface gets anywhere these cells reach
    let maxS = -Infinity;
    for (let qz = (this.minGZ * 16) >> 2; qz <= (maxGZ * 16 + 9) >> 2; qz++)
      for (let qx = (this.minGX * 16) >> 2; qx <= (maxGX * 16 + 9) >> 2; qx++) maxS = Math.max(maxS, gen.prelim(qx << 2, qz << 2));
    this.skipAbove = (Math.floor((maxS + 8 + 12) / 12) + 1) * 12 + 11;
    this.r = new Xoroshiro(0, 0, 0, 0);
  }
  index(gx, gy, gz) { return ((gy - this.minGY) * this.sz + (gz - this.minGZ)) * this.sx + (gx - this.minGX); }
  // what a non-solid block becomes: 0 air, 1 water, 2 lava, or -1 (stone after all)
  substance(x, y, z, density) {
    const gf = globalFluid(y);
    if (y > this.skipAbove) return gf.at(y);
    if (gf.at(y) === 2) return 2;
    const ax = Math.floor((x - 5) / 16), ay = Math.floor((y + 1) / 12), az = Math.floor((z - 5) / 16);
    let d1 = 2147483647, d2 = d1, d3 = d1, i1 = 0, i2 = 0, i3 = 0;
    const loc = this.loc, R = this.g.aquiferRandom;
    for (let ox = 0; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = 0; oz <= 1; oz++) {
      const gx = ax + ox, gy = ay + oy, gz = az + oz;
      const i = this.index(gx, gy, gz);
      if (!this.has[i]) {
        const r = R.atInto(this.r, gx, gy, gz);
        loc[i * 3] = gx * 16 + r.nextInt(10);
        loc[i * 3 + 1] = gy * 12 + r.nextInt(this.g.aqY);
        loc[i * 3 + 2] = gz * 16 + r.nextInt(10);
        this.has[i] = 1;
      }
      const dx = loc[i * 3] - x, dy = loc[i * 3 + 1] - y, dz = loc[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d1 >= d) { i3 = i2; i2 = i1; i1 = i; d3 = d2; d2 = d1; d1 = d; }
      else if (d2 >= d) { i3 = i2; i2 = i; d3 = d2; d2 = d; }
      else if (d3 >= d) { i3 = i; d3 = d; }
    }
    const s1 = this.statusAt(i1);
    const sim12 = 1 - Math.abs(d2 - d1) / 25;
    const fluid = s1.at(y);
    if (sim12 <= 0) return fluid;
    if (fluid === 1 && globalFluid(y - 1).at(y - 1) === 2) return fluid;
    this.barrier = NaN;
    const s2 = this.statusAt(i2);
    if (density + sim12 * this.pressure(x, y, z, s1, s2) > 0) return -1;
    const s3 = this.statusAt(i3);
    const sim13 = 1 - Math.abs(d3 - d1) / 25;
    if (sim13 > 0 && density + sim12 * sim13 * this.pressure(x, y, z, s1, s3) > 0) return -1;
    const sim23 = 1 - Math.abs(d3 - d2) / 25;
    if (sim23 > 0 && density + sim12 * sim23 * this.pressure(x, y, z, s2, s3) > 0) return -1;
    return fluid;
  }
  pressure(x, y, z, a, b) {
    const t1 = a.at(y), t2 = b.at(y);
    if ((t1 === 2 && t2 === 1) || (t1 === 1 && t2 === 2)) return 2;
    const diff = Math.abs(a.level - b.level);
    if (diff === 0) return 0;
    const avg = 0.5 * (a.level + b.level);
    const e = y + 0.5 - avg;
    const o = diff / 2 - Math.abs(e);
    let q;
    if (e > 0) q = o > 0 ? o / 1.5 : o / 2.5;
    else { const p = 3 + o; q = p > 0 ? p / 3 : p / 10; }
    let s = 0;
    if (!(q < -2 || q > 2)) {
      if (this.barrier !== this.barrier) this.barrier = this.g.aqBarrier(x, y, z);
      s = this.barrier;
    }
    return 2 * (s + q);
  }
  statusAt(i) {
    let s = this.status[i];
    if (s) return s;
    s = this.status[i] = this.compute(this.loc[i * 3], this.loc[i * 3 + 1], this.loc[i * 3 + 2]);
    return s;
  }
  compute(x, y, z) {
    const g = this.g;
    const gf = globalFluid(y);
    let lowest = 2147483647, centreUnder = false;
    for (const [ox, oz] of SURFACE_SAMPLING) {
      const sx = x + (ox << 4), sz = z + (oz << 4);
      const surf = g.prelim(sx, sz);
      const adj = surf + 8;
      const start = ox === 0 && oz === 0;
      if (start && y - 12 > adj) return gf;
      const above = y + 12 > adj;
      if (above || start) {
        const fs = globalFluid(adj);
        if (fs.at(adj) !== 0) {
          if (start) centreUnder = true;
          if (above) return fs;
        }
      }
      lowest = Math.min(lowest, surf);
    }
    const level = this.surfaceLevel(x, y, z, gf, lowest, centreUnder);
    return new FluidStatus(level, this.fluidType(x, y, z, gf, level));
  }
  surfaceLevel(x, y, z, gf, lowest, centreUnder) {
    const g = this.g;
    let partial, full;
    if (g.aqExclusion(x, y, z) > 0) { partial = -1; full = -1; }
    else {
      const below = lowest + 8 - y;
      const f = centreUnder ? clampedMap(below, 0, 64, 1, 0) : 0;
      let fl = g.aqFlood(x, y, z);
      fl = fl < -1 ? -1 : fl > 1 ? 1 : fl;
      const fullT = map(f, 1, 0, -0.3, 0.8), partT = map(f, 1, 0, -0.8, 0.4);
      partial = fl - partT; full = fl - fullT;
    }
    if (full > 0) return gf.level;
    if (partial > 0) {
      const cx = Math.floor(x / 16), cy = Math.floor(y / 40), cz = Math.floor(z / g.aqSpreadZ);
      const middle = cy * 40 + 20;
      const spread = g.aqSpread(cx, cy, cz) * g.aqSpreadMul;
      return Math.min(lowest, middle + Math.floor(spread / 3) * 3);
    }
    return WAIT;
  }
  fluidType(x, y, z, gf, level) {
    if (level <= -10 && gf.type !== 2 && level !== WAIT) {
      const lava = this.g.aqLava(Math.floor(x / 64), Math.floor(y / 40), Math.floor(z / 64));
      if (Math.abs(lava) > 0.3) return 2;
    }
    return gf.type;
  }
}

/* ========================================================== the bands ==
   Badlands terracotta: a fixed shuffle of colours by height, made from
   the world seed once. */
function makeBands(r) {
  const n = 192, T = stateOf('terracotta');
  const bands = new Array(n).fill(T);
  for (let i = 0; i < n; i++) {
    i += r.nextInt(5) + 1;
    if (i >= n) break;
    bands[i] = stateOf('orange_terracotta');
  }
  const put = (minW, st) => {
    const k = r.nextIntBetween(6, 15);
    for (let j = 0; j < k; j++) {
      const w = minW + r.nextInt(3), s = r.nextInt(n);
      for (let m = 0; s + m < n && m < w; m++) bands[s + m] = st;
    }
  };
  put(1, stateOf('yellow_terracotta'));
  put(2, stateOf('brown_terracotta'));
  put(1, stateOf('red_terracotta'));
  const whites = r.nextIntBetween(9, 15);
  for (let k = 0, l = 0; k < whites && l < n; k++, l += r.nextInt(16) + 4) {
    bands[l] = stateOf('white_terracotta');
    if (l - 1 > 0 && r.nextBoolean()) bands[l - 1] = stateOf('light_gray_terracotta');
    if (l + 1 < n && r.nextBoolean()) bands[l + 1] = stateOf('light_gray_terracotta');
  }
  return bands;
}

/* ===================================================== the generator == */
export class VanillaGen {
  constructor(seed) {
    this.seedStr = String(seed);
    this.seed = BigInt(this.seedStr);
    const D = VDATA;
    const S = this.state = new DensityState(D, this.seed);
    const C = this.comp = new Compiler(S);
    const ns = D.noise_settings;
    // the climate, for biomes
    const R = ns.noise_router;
    const node = j => S.node(j);
    this.nTemp = C.point(node(R.temperature)); this.nVeg = C.point(node(R.vegetation));
    this.nCont = C.point(node(R.continents)); this.nEro = C.point(node(R.erosion));
    this.nRidge = C.point(node(R.ridges)); this.nDepth = C.point(node(R.depth));
    this.depthCol = C.column(node(R.depth));
    const bp = D.biome_params;
    this.table = new BiomeTable(bp, n => (BIO[n] !== undefined ? BIO[n] : BIO.plains));
    this.zoom = new Zoom(this.seed);
    // the land
    this.finalNode = node(R.final_density);
    this.prelimFn = C.point(node(ns.aquifers.surface_level));
    this.chunkSurfaceFn = C.point(node(R.chunk_surface_level));
    this.finalPoint = C.point(this.finalNode);
    // aquifers
    const A = ns.aquifers;
    this.aqBarrier = C.point(node(A.barrier));
    this.aqFlood = C.point(node(A.fluid_level_floodedness));
    this.aqSpread = C.point(node(A.fluid_level_spread));
    this.aqLava = C.point(node(A.lava));
    this.aqExclusion = C.point(node(A.exclusion));
    this.aquiferRandom = S.randomFactory('aquifer');
    // aquifer cell centres sit at a random offset 0-9 across and 0-8 up; the
    // fluid level varies in cells 16 x 40 x 16, by the spread noise * 10
    this.aqY = 9; this.aqSpreadZ = 16; this.aqSpreadMul = 10;
    this.prelimCache = new Map();
    // material rules
    this.surfaceNoise = S.noise('surface');
    this.surfaceSecondary = S.noise('surface_secondary');
    this.clayOffset = S.noise('clay_bands_offset');
    this.bands = makeBands(S.random.fromHashOf('minecraft:clay_bands'));
    this.badSurf = S.noise('badlands_surface'); this.badPillar = S.noise('badlands_pillar'); this.badRoof = S.noise('badlands_pillar_roof');
    this.iceSurf = S.noise('iceberg_surface'); this.icePillar = S.noise('iceberg_pillar'); this.iceRoof = S.noise('iceberg_pillar_roof');
    this.posRandom = S.random;      // the noise random (surface depth, icebergs)
    this.oreRandom = S.randomFactory('ore');
    this.ctx = { bi: 0, fx: 0, fy: 0, fz: 0, L: [], out: new Float64Array(8) };
    this.rule = this.compileRule(D.noise_settings.material_rule);
    // the interpolated parts of every block function share one lattice per chunk
    this.lattice = new Map();
    const latNodes = [];
    const collect = (n, seen = new Set()) => {
      if (seen.has(n)) return; seen.add(n);
      if (n.t === 'interpolated') {
        if (n.cxz === 4 && n.cy === 8 && !this.lattice.has(n)) { this.lattice.set(n, latNodes.length); latNodes.push(n); }
        return;
      }
      for (const c of children(n)) collect(c, seen);
    };
    collect(this.finalNode);
    for (const v of this.veins) { collect(v.density); collect(v.richness); collect(v.gap); }
    this.latCols = latNodes.map(n => C.column(n.a));
    this.finalBlock = C.block([this.finalNode], this.lattice);
    for (const v of this.veins) v.fn = C.block([v.density, v.richness, v.gap], this.lattice);
    this.lats = latNodes.map(() => new Float64Array(5 * 5 * 49));
    this.ctx.L = this.lats;
    this.decorator = new Decorator(this);
    this.surfaceChunk = null;
  }

  /* ---- climate and biomes ---- */
  prelim(x, z) {
    // the preliminary surface, on the 4-block grid, as an int
    const qx = x >> 2 << 2, qz = z >> 2 << 2;
    const k = qx * 4096 + qz;
    let v = this.prelimCache.get(k);
    if (v === undefined) {
      if (this.prelimCache.size > 200000) this.prelimCache.clear();
      v = Math.floor(this.prelimFn(qx, 0, qz));
      this.prelimCache.set(k, v);
    }
    return v;
  }
  noiseBiome(qx, qy, qz) {
    const x = qx << 2, y = qy << 2, z = qz << 2;
    return this.table.find(quantize(this.nTemp(x, y, z)), quantize(this.nVeg(x, y, z)), quantize(this.nCont(x, y, z)),
      quantize(this.nEro(x, y, z)), quantize(this.nDepth(x, y, z)), quantize(this.nRidge(x, y, z)));
  }
  // every quart cell's biome for a chunk and one cell around it (what the zoom can reach)
  biomeGrid(cx, cz) {
    const g = new Uint8Array(6 * 6 * 98);
    const qx0 = cx * 4 - 1, qz0 = cz * 4 - 1;
    const dep = new Float64Array(98);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const x = (qx0 + i) << 2, z = (qz0 + j) << 2;
      const t = quantize(this.nTemp(x, 0, z)), h = quantize(this.nVeg(x, 0, z)), c = quantize(this.nCont(x, 0, z));
      const e = quantize(this.nEro(x, 0, z)), w = quantize(this.nRidge(x, 0, z));
      this.depthCol(x, z, (-17) << 2, 4, 98, dep, 0);
      for (let k = 0; k < 98; k++) g[(j * 6 + i) * 98 + k] = this.table.find(t, h, c, e, quantize(dep[k]), w);
    }
    return { g, qx0, qz0, qy0: -17 };
  }
  biomeAt(grid, x, y, z) {
    const c = this.zoom.cell(x, y, z, this._cell || (this._cell = [0, 0, 0]));
    const i = c[0] - grid.qx0, j = c[2] - grid.qz0, k = c[1] - grid.qy0;
    if (i < 0 || i > 5 || j < 0 || j > 5 || k < 0 || k > 97) return this.noiseBiome(c[0], c[1], c[2]);
    return grid.g[(j * 6 + i) * 98 + k];
  }
  climate(x, z) {
    // the biome a column shows at its surface (what the spawn search wants)
    const y = this.surfaceAt(x, z) + Y0;
    return this.noiseBiome(x >> 2, Math.max(-16, Math.min(79, (y + 1) >> 2)), z >> 2);
  }
  // the ground's height (index y) at a column: the land without caves or water
  surfaceAt(x, z) {
    const top = Math.min(319, this.prelim(x, z) + 48);
    for (let y = top; y >= MIN_Y; y--) if (this.finalPoint(x, y, z) > 0) return y - Y0;
    return -1;
  }

  /* ---- a whole chunk ---- */
  generate(cx, cz) {
    const blocks = new Uint16Array(VOL), meta = new Uint8Array(VOL);
    const x0 = cx * 16, z0 = cz * 16;
    // the coarse lattices
    for (let k = 0; k < this.lats.length; k++) {
      const L = this.lats[k], f = this.latCols[k];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) f(x0 + i * 4, z0 + j * 4, MIN_Y, 8, 49, L, (j * 5 + i) * 49);
    }
    // fill: stone where the density is above zero, else what the aquifer says
    const aq = new Aquifer(this, x0, z0);
    const ctx = this.ctx, out = ctx.out, fb = this.finalBlock;
    const STONE = B.stone, WATER = B.water, LAVA = B.lava;
    const surfH = new Int16Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const bx = x0 + x, bz = z0 + z;
      const colBase = ((z >> 2) * 5 + (x >> 2)) * 49;
      ctx.fx = (x & 3) / 4; ctx.fz = (z & 3) / 4;
      let top = -1;
      for (let iy = H - 1; iy >= 0; iy--) {
        const y = iy + MIN_Y;
        ctx.bi = colBase + (iy >> 3); ctx.fy = (iy & 7) / 8;
        fb(bx, y, bz, ctx);
        const d = out[0];
        let b;
        if (d > 0) b = STONE;
        else {
          const s = aq.substance(bx, y, bz, d);
          b = s === -1 ? STONE : s === 1 ? WATER : s === 2 ? LAVA : 0;
        }
        if (b) { blocks[(iy << 8) | (z << 4) | x] = b; if (top < 0) top = iy; }
      }
      surfH[(z << 4) | x] = top + 1;     // WORLD_SURFACE_WG, in index terms
    }
    // materials (bedrock, ore veins, the surface, deepslate)
    const grid = this.biomeGrid(cx, cz);
    this.materials(blocks, meta, x0, z0, surfH, grid);
    // carvers and features
    this.decorator.decorate(blocks, meta, cx, cz, grid);
    // each column's biome, where it shows: at its top block
    const biome = new Uint8Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let iy = H - 1;
      while (iy > 0 && !blocks[(iy << 8) | (z << 4) | x]) iy--;
      biome[(z << 4) | x] = this.biomeAt(grid, x0 + x, iy + MIN_Y + 1, z0 + z);
    }
    let top = 0;
    for (let i = VOL - 1; i >= 0; i--) if (blocks[i]) { top = i >> 8; break; }
    return { blocks, meta, biome, top };
  }

  /* ---- the material rules ---- */
  materials(blocks, meta, x0, z0, surfH, grid) {
    const M = this.mctx;
    M.blocks = blocks; M.meta = meta; M.x0 = x0; M.z0 = z0; M.surfH = surfH; M.grid = grid;
    // the biomes the zoom can reach in this chunk, so most biome tests need no lookup
    const present = this.present || (this.present = new Uint8Array(256));
    present.fill(0);
    for (let i = 0; i < grid.g.length; i++) present[grid.g[i]] = 1;
    M.present = present;
    const STONE = B.stone, rule = this.rule;
    const ERODED = BIO.eroded_badlands, FROZEN = BIO.frozen_ocean, DFROZEN = BIO.deep_frozen_ocean;
    // column by column, x outermost as the game goes (it matters for "steep",
    // which reads the heights of columns already given their pillars)
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const bx = x0 + x, bz = z0 + z;
      M.x = bx; M.z = bz; M.lx = x; M.lz = z;
      M.xz++;
      M.surfaceDepth = Math.trunc(this.surfaceNoise.sample(bx, 0, bz) * 2.75 + 3 + this.posRandom.at(bx, 0, bz).nextDouble() * 0.25);
      M.secondary = NaN; M.minSurf = NaN;
      const col = (z << 4) | x;
      let height = surfH[col] + MIN_Y;    // first air above the column, in world y
      const hb = this.biomeAt(grid, bx, height, bz);   // the game asks one above the top block
      if (hb === ERODED && present[ERODED]) this.erodedBadlands(blocks, x, z, bx, bz, height);
      height = this.colHeight(blocks, x, z) + MIN_Y;
      if ((hb === FROZEN || hb === DFROZEN) && (present[FROZEN] || present[DFROZEN])) this.frozenOcean(blocks, x, z, bx, bz, height, hb);
      surfH[col] = this.colHeight(blocks, x, z);
      let stoneAbove = 0, waterH = -2147483648, nextCeil = 2147483647;
      for (let y = height; y >= MIN_Y; y--) {
        const i = ((y - MIN_Y) << 8) | col;
        const b = blocks[i];
        if (b === 0) { stoneAbove = 0; waterH = -2147483648; continue; }
        if (b === B.water || b === B.lava) { if (waterH === -2147483648) waterH = y + 1; continue; }
        if (nextCeil >= y) {
          nextCeil = -2147483648;
          for (let ly = y - 1; ly >= MIN_Y; ly--) {
            const nb = blocks[((ly - MIN_Y) << 8) | col];
            if (nb === 0 || nb === B.water || nb === B.lava) { nextCeil = ly + 1; break; }
          }
        }
        stoneAbove++;
        if (b !== STONE || meta[i] !== 0) continue;
        M.y = y; M.yi++; M.stoneAbove = stoneAbove; M.stoneBelow = y - nextCeil + 1; M.waterH = waterH; M.biome = -1;
        const st = rule();
        if (st) { blocks[i] = st.id; meta[i] = st.meta; }
      }
    }
  }
  colHeight(blocks, x, z) {
    const col = (z << 4) | x;
    for (let iy = H - 1; iy >= 0; iy--) if (blocks[(iy << 8) | col]) return iy + 1;
    return 0;
  }
  erodedBadlands(blocks, x, z, bx, bz, height) {
    const e = Math.min(Math.abs(this.badSurf.sample(bx, 0, bz) * 8.25), this.badPillar.sample(bx * 0.2, 0, bz * 0.2) * 15);
    if (e <= 0) return;
    const h = Math.abs(this.badRoof.sample(bx * 0.75, 0, bz * 0.75) * 1.5);
    const top = Math.floor(64 + Math.min(e * e * 2.5, Math.ceil(h * 50) + 24));
    if (height > top) return;
    const col = (z << 4) | x;
    for (let y = top; y >= MIN_Y; y--) {
      const b = blocks[((y - MIN_Y) << 8) | col];
      if (b === B.stone) break;
      if (b === B.water) return;
    }
    for (let y = top; y >= MIN_Y && blocks[((y - MIN_Y) << 8) | col] === 0; y--) blocks[((y - MIN_Y) << 8) | col] = B.stone;
  }
  frozenOcean(blocks, x, z, bx, bz, height, biome) {
    const e = Math.min(Math.abs(this.iceSurf.sample(bx, 0, bz) * 8.25), this.icePillar.sample(bx * 1.28, 0, bz * 1.28) * 15);
    if (e <= 1.8) return;
    const h = Math.abs(this.iceRoof.sample(bx * 1.17, 0, bz * 1.17) * 1.5);
    let i = Math.min(e * e * 1.2, Math.ceil(h * 40) + 14);
    if (this.decorator.warmEnoughToMelt(biome, bx, SEA_LEVEL, bz)) i -= 2;
    let j;
    if (i > 2) { j = SEA_LEVEL - i - 7; i += SEA_LEVEL; } else { i = 0; j = 0; }
    const r = this.posRandom.at(bx, 0, bz);
    const l = 2 + r.nextInt(4), m = SEA_LEVEL + 18 + r.nextInt(10);
    let n = 0;
    const col = (z << 4) | x;
    const minS = this.minSurfaceLevel();
    const ki = Math.trunc(i), ji = Math.trunc(j);
    for (let y = Math.max(height, ki + 1); y >= minS; y--) {
      const k = ((y - MIN_Y) << 8) | col;
      if (k < 0 || k >= VOL) continue;
      const b = blocks[k];
      if (!((b === 0 && y < ki && r.nextDouble() > 0.01) || (b === B.water && y > ji && y < SEA_LEVEL && j !== 0 && r.nextDouble() > 0.15))) continue;
      if (n <= l && y > m) { blocks[k] = B.snow_block; n++; continue; }
      blocks[k] = B.packed_ice;
    }
  }
  minSurfaceLevel() {
    const M = this.mctx;
    if (M.minSurf !== M.minSurf) M.minSurf = Math.floor(this.chunkSurfaceFn(M.x, 0, M.z)) + M.surfaceDepth - 8;
    return M.minSurf;
  }

  /* Material rules become closures over one shared context (the block
     being decided and what is known about its column). */
  compileRule(json) {
    const M = this.mctx = { x: 0, y: 0, z: 0, lx: 0, lz: 0, xz: 0, yi: 0, stoneAbove: 0, stoneBelow: 0, waterH: 0, surfaceDepth: 0, secondary: NaN, minSurf: NaN, biome: -1 };
    const D = VDATA, S = this.state;
    const gen = this;
    this.veins = [];
    const anchor = a => (a.absolute !== undefined ? a.absolute : a.above_bottom !== undefined ? MIN_Y + a.above_bottom
      : a.below_top !== undefined ? MIN_Y + H - 1 - a.below_top : SEA_LEVEL + (a.relative_to_sea_level || 0));
    const biomeAt = () => {
      if (M.biome < 0) M.biome = gen.biomeAt(M.grid, M.x, M.y, M.z);
      return M.biome;
    };
    const perY = f => { let last = -1, v = false; return () => { if (M.yi !== last) { last = M.yi; v = f(); } return v; }; };
    const cond = j => {
      if (typeof j === 'string') return cond(D.material_condition[strip(j)]);
      const t = strip(j.type);
      switch (t) {
        case 'biome': {
          const list = (Array.isArray(j.biome_is) ? j.biome_is : [j.biome_is]).map(n => BIO[strip(n)]).filter(v => v !== undefined);
          const set = new Uint8Array(256); for (const b of list) set[b] = 1;
          return perY(() => {
            let any = false;
            for (const b of list) if (M.present[b]) { any = true; break; }
            return any && set[biomeAt()] === 1;
          });
        }
        case 'noise_threshold': {
          const n = S.noise(strip(j.noise)), lo = j.min_threshold, hi = j.max_threshold;
          if (j.is_3d) return () => { const v = n.sample(M.x, M.y, M.z); return lo <= v && v <= hi; };
          let last = -1, v = 0;
          return () => { if (last !== M.xz) { last = M.xz; v = n.sample(M.x, 0, M.z); } return lo <= v && v <= hi; };
        }
        case 'vertical_gradient': {
          const lo = anchor(j.true_at_and_below), hi = anchor(j.false_at_and_above);
          const rf = S.randomFactory(strip(j.random_name));
          const r = new Xoroshiro(0, 0, 0, 0);
          return perY(() => {
            if (M.y <= lo) return true;
            if (M.y >= hi) return false;
            return rf.atInto(r, M.x, M.y, M.z).nextFloat() < map(M.y, lo, hi, 1, 0);
          });
        }
        case 'y_above': {
          const a = anchor(j.anchor), mul = j.surface_depth_multiplier || 0, add = !!j.add_stone_depth;
          return perY(() => M.y + (add ? M.stoneAbove : 0) >= a + M.surfaceDepth * mul);
        }
        case 'water': {
          const off = j.offset || 0, mul = j.surface_depth_multiplier || 0, add = !!j.add_stone_depth;
          return perY(() => M.waterH === -2147483648 || M.y + (add ? M.stoneAbove : 0) >= M.waterH + off + M.surfaceDepth * mul);
        }
        case 'stone_depth': {
          const off = j.offset || 0, addS = !!j.add_surface_depth, range = j.secondary_depth_range || 0, ceil = j.surface_type === 'ceiling';
          return perY(() => {
            const sd = ceil ? M.stoneBelow : M.stoneAbove;
            let sec = 0;
            if (range !== 0) {
              if (M.secondary !== M.secondary) M.secondary = gen.surfaceSecondary.sample(M.x, 0, M.z);
              sec = Math.trunc(map(M.secondary, -1, 1, 0, range));
            }
            return sd <= 1 + off + (addS ? M.surfaceDepth : 0) + sec;
          });
        }
        case 'not': { const c = cond(j.invert); return () => !c(); }
        case 'hole': return () => M.surfaceDepth <= 0;
        case 'above_preliminary_surface': return () => M.y >= gen.minSurfaceLevel();
        case 'steep': return () => {
          const h = M.surfH, x = M.lx, z = M.lz;
          const w = h[(z << 4) | Math.max(x - 1, 0)], e = h[(z << 4) | Math.min(x + 1, 15)];
          if (e >= w + 4) return true;
          const n = h[(Math.max(z - 1, 0) << 4) | x], s = h[(Math.min(z + 1, 15) << 4) | x];
          return n >= s + 4;
        };
        case 'temperature': return () => false;
      }
      console.warn('material condition not handled:', t);
      return () => false;
    };
    const rule = j => {
      if (typeof j === 'string') return rule(D.material_rule[strip(j)]);
      const t = strip(j.type);
      switch (t) {
        case 'block': { const st = stateOf(j.result_state); return () => st; }
        case 'sequence': {
          const rs = j.sequence.map(rule);
          if (rs.length === 1) return rs[0];
          return () => { for (let i = 0; i < rs.length; i++) { const s = rs[i](); if (s) return s; } return null; };
        }
        case 'condition': {
          const c = cond(j.if_true), r = rule(j.then_run);
          return () => (c() ? r() : null);
        }
        case 'bandlands': return () => {
          const off = Math.round(gen.clayOffset.sample(M.x, 0, M.z) * 4);
          const n = gen.bands.length;
          return gen.bands[(((M.y + off + n) % n) + n) % n];
        };
        case 'ore_vein': {
          const v = {
            density: S.node(j.density), richness: S.node(j.richness), gap: S.node(j.filler_gap),
            ore: stateOf(j.ore_block), raw: stateOf(j.raw_ore_block), filler: stateOf(j.filler_block), rawChance: j.raw_ore_chance ?? 0.02, fn: null,
          };
          this.veins.push(v);
          const r = new Xoroshiro(0, 0, 0, 0);
          return () => {
            const ctx = gen.ctx;
            const iy = M.y - MIN_Y;
            ctx.bi = (((M.lz >> 2) * 5 + (M.lx >> 2)) * 49) + (iy >> 3);
            ctx.fx = (M.lx & 3) / 4; ctx.fy = (iy & 7) / 8; ctx.fz = (M.lz & 3) / 4;
            v.fn(M.x, M.y, M.z, ctx);
            const d = ctx.out[0];
            if (!(d > 0)) return null;
            const rr = gen.oreRandom.atInto(r, M.x, M.y, M.z);
            if (rr.nextFloat() > d) return null;
            if (rr.nextFloat() < ctx.out[1] && !(ctx.out[2] > 0)) return rr.nextFloat() < v.rawChance ? v.raw : v.ore;
            return v.filler;
          };
        }
      }
      console.warn('material rule not handled:', t);
      return () => null;
    };
    return rule(json);
  }
}
