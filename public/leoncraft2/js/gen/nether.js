/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Nether's generator (the same interface as worldgen.js's
   Gen: generate(cx, cz), surfaceAt(x, z), climate(x, z)).

   Shaped after the game's own settings for the Nether. The land and the
   biomes are the game's own from the seed; the surfaces and the features
   are ours (made after what the Minecraft Wiki describes):

     terrain   the game's old blended noise (xz scale 0.25, y scale 0.375,
               factors 80 and 60, smear 8, java.util.Random from the seed)
               worked out every 4 blocks across and 8 up and blended
               between; the top 24 blocks slide to solid (the ceiling) and
               the bottom 32 too (the floor); 0.64 times; solid where above
               zero. Height 0..127.
     sea       lava up to y 31
     bedrock   the game's own, block for block: y 0 always, thinning out to
               y 4; the roof at y 127, thinning down to y 123 (bedrockAt);
               netherrack just under the roof
     biomes    the game's own from the seed (its old-random temperature and
               vegetation noises, see legacyNetherNoise), the nearest of the
               five points (wastes 0,0; soul sand valley 0,-0.5; crimson
               forest 0.4,0; warped forest 0,0.5 + 0.375; basalt deltas
               -0.5,0 + 0.175)
     surfaces  nylium (and wart patches) on forest floors above the lava,
               soul sand and soul soil in the valleys, basalt, blackstone and
               gravel in the deltas, soul sand and gravel bands round the
               lava shore in the wastes
     features  glowstone hanging from the ceiling, huge crimson and warped
               fungi with shroomlights and weeping vines, roots, sprouts,
               twisting vines, basalt columns, lava and magma pools in the
               deltas, fire and soul fire, mushrooms; nether quartz (16 a
               chunk), nether gold (10), ancient debris (large 1 at y 8-24,
               small 1 at y 8-119, never touching air), magma (4 at y 27-36),
               gravel and blackstone veins (2 each)

   Features are kept inside their own chunk (fungi and blobs start far
   enough from its edge), so a chunk never needs its neighbours.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';
import { CH, H, Y0, VOL, idx } from '../world-const.js?v=107';
import { BIO } from '../biomes.js?v=107';
import { NormalNoise, rng, mix32, hash3 } from '../noise.js?v=107';
import { yGradient, BlendedNoise, squeeze } from './blended.js?v=107';
import { Perlin, Blended } from './noise.js?v=107';
import { LegacyRandom, seedLong, posSeed, R as PR } from './random.js?v=107';
import { NetherCarvers } from './carvers.js?v=107';

const I = y => y - Y0;                 // world y -> index
const lerp = (a, b, t) => a + (b - a) * t;
const LAVA_TOP = 31, ROOF = 127;

/* The bedrock floor and roof as the game's surface rules make them: bedrock at
   y 0, and at y 1 to 4 where the random drawn for that block falls under
   (5 - y) / 5 (the rule "bedrock_floor"); the roof at y 127, and at y 123 to
   126 where it does not fall under (127 - y) / 5 (the "not" of the gradient
   "bedrock_roof" from 122 to 127). The Nether's settings keep the old random
   source, so a block's random is java.util.Random seeded with its position's
   hash (Mth.getSeed) xor a seed made for the rule's name: the world's random
   forked for positions (its first long), hashed with the name, forked again. */
function bedrockRule(s64, name) {
  const top = new LegacyRandom(s64).nextLong();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  const f = BigInt.asUintN(64, new LegacyRandom(BigInt.asIntN(64, BigInt(h) ^ top)).nextLong());
  return { h: Number(f >> 32n) >>> 0, l: Number(f & 0xffffffffn) >>> 0 };
}
const BR = new LegacyRandom(0);
// the first nextFloat of the rule's random at a block (java.util.Random's setSeed done on the two halves, no BigInt per block)
function ruleFloat(f, x, y, z) {
  posSeed(x, y, z);
  const hi = (PR.h ^ f.h ^ 0x5) >>> 0, lo = (PR.l ^ f.l ^ 0xdeece66d) >>> 0;
  BR.sl = lo & 0xffffff; BR.sh = ((hi & 0xffff) << 8) | (lo >>> 24);
  return BR.next(24) / 16777216;
}
// Mth.map(y, a, b, 1, 0)
const fade = (y, a, b) => 1 + (y - a) / (b - a) * -1;

// the five biomes' points: [temperature, humidity, offset], as the game keeps them (times 10000, whole)
const POINTS = [
  ['nether_wastes', 0, 0, 0], ['soul_sand_valley', 0, -5000, 0], ['crimson_forest', 4000, 0, 0],
  ['warped_forest', 0, 5000, 3750], ['basalt_deltas', -5000, 0, 1750],
];

/* The biomes are the game's own, from the seed. The Nether is one of the
   worlds that keep the old random: its temperature and vegetation are each
   an old-style noise of two octaves (-7 and -6, both at strength 1) seeded
   with java.util.Random from the world seed (temperature) and the seed plus
   one (vegetation), read at a quarter of the block position, with no offset
   noise, every 4 blocks. Each value is kept to 1/10000 as a float, and the
   nearest point wins. (The same build as cubiomes' setNetherSeed, MIT,
   Copyright (c) 2020 Cubitect, https://github.com/Cubitect/cubiomes.) */
const INPUT = 1.0181268882175227, VALUE = 0.16666666666666666 / 0.15;
function legacyOctaves(r) {
  // the old PerlinNoise constructor for octaves -7..-6: a noise for octave 0
  // made and never used, five octaves skipped (262 draws each), then -6, then -7
  new Perlin(r);
  r.consume(262 * 5);
  const o6 = new Perlin(r), o7 = new Perlin(r);
  return (x, z) => o7.sample(x / 128, 0, z / 128) * (2 / 3) + o6.sample(x / 64, 0, z / 64) * (1 / 3);
}
function legacyNetherNoise(seed) {
  const r = new LegacyRandom(seed);
  const a = legacyOctaves(r), b = legacyOctaves(r);
  return (x, z) => (a(x, z) + b(x * INPUT, z * INPUT)) * VALUE;
}
const quantize = v => Math.trunc(Math.fround(Math.fround(v) * 10000));
// the order the game's search meets the points in (by the sum of their sizes): wastes, crimson, soul sand, deltas, warped
const ORDER = [0, 2, 1, 4, 3];

export class NetherGen {
  constructor(seed) {
    this.seed = seed | 0;
    const S = this.seed;
    const s64 = seedLong(seed);
    // the land's noise, the game's own: its old blended noise on java.util.Random from the seed
    this.base = new Blended(new LegacyRandom(s64), 0.25, 0.375, 80, 60, 8);
    this.carvers = new NetherCarvers(s64, { bedrock: B.bedrock, lava: B.lava });
    this.floorRule = bedrockRule(s64, 'minecraft:bedrock_floor');
    this.roofRule = bedrockRule(s64, 'minecraft:bedrock_roof');
    this.nTemp = legacyNetherNoise(s64);
    this.nHum = legacyNetherNoise(BigInt.asIntN(64, s64 + 1n));
    this.nState = new NormalNoise(S, 'nether_state_selector', -4, [1]);
    this.nSoul = new NormalNoise(S, 'soul_sand_layer', -8, [1, 1, 1, 1, 0, 0, 0, 0, 0.013]);
    this.nGravel = new NormalNoise(S, 'gravel_layer', -8, [1, 1, 1, 1, 0, 0, 0, 0, 0.013]);
    this.nPatch = new NormalNoise(S, 'patch', -5, [1, 0, 0, 0, 0, 0.013]);
    this.nWart = new NormalNoise(S, 'nether_wart', -3, [1, 0, 0, 0.9]);
    this.biomeIds = POINTS.map(p => BIO[p[0]]);
  }

  /* ---- climate and biomes ---- */
  climate(x, z) {
    return { T: this.nTemp(x * 0.25, z * 0.25), Hu: this.nHum(x * 0.25, z * 0.25) };
  }
  // the biome of the 4 x 4 cell a column is in (read at the cell's corner, as the game reads it)
  biomeAt(x, z) {
    return this.biomeIds[this.nearest(x & ~3, z & ~3, true)];
  }
  // which of the five points is nearest a cell's climate. Two at the same distance (now and then, on a
  // line half way between two) keep the one the cell before it got, as the game's search keeps the last
  // answer it gave, and the cell before is the one north of it (a chunk's cells are filled z fastest, then
  // up, then x), else the same column's last; failing that, the first in the game's order
  nearest(X, Z, ties) {
    const c = this.climate(X, Z), t = quantize(c.T), h = quantize(c.Hu);
    let best = -1, bd = Infinity, tied = 0;
    for (const i of ORDER) {
      const p = POINTS[i];
      const d = (t - p[1]) ** 2 + (h - p[2]) ** 2 + p[3] * p[3];
      if (d < bd) { bd = d; best = i; tied = 1 << i; } else if (d === bd) tied |= 1 << i;
    }
    if (ties && tied !== 1 << best) {
      const prev = this.nearest(X, (Z >> 2) & 3 ? Z - 4 : Z + 12, false);
      if (tied & (1 << prev)) return prev;
    }
    return best;
  }

  /* ---- the density, before blending (and before the squeeze, which keeps
     the sign: solid is where the blend of these comes out above zero) ---- */
  density(x, y, z) {
    let d = this.base.sample(x, y, z);
    d = 0.9375 + yGradient(y, 104, 128, 1, 0) * (d - 0.9375);     // the ceiling
    d = 2.5 + yGradient(y, -8, 24, 0, 1) * (d - 2.5);             // the floor
    return 0.64 * d;
  }
  // a column's lattice values every 8 blocks from y 0 to 128
  column(x, z) {
    const out = new Float64Array(17);
    for (let k = 0; k <= 16; k++) out[k] = this.density(x, k * 8, z);
    return out;
  }
  // the highest floor at or below the lava sea's reach that you could stand on (for finding somewhere safe)
  surfaceAt(x, z) {
    const c = this.column(Math.floor(x / 4) * 4, Math.floor(z / 4) * 4);
    for (let y = 120; y > 32; y--) {
      const k = y >> 3, f = (y & 7) / 8;
      const here = lerp(c[k], c[k + 1], f), up = lerp(c[(y + 1) >> 3], c[((y + 1) >> 3) + 1], ((y + 1) & 7) / 8);
      if (here > 0 && up <= 0) return I(y);
    }
    return -1;
  }

  /* ---- a whole chunk ---- */
  generate(cx, cz) {
    const blocks = new Uint16Array(VOL), meta = new Uint8Array(VOL), biome = new Uint8Array(256);
    const x0 = cx * CH, z0 = cz * CH, S = this.seed;
    // the lattice: 5 x 5 columns every 4 blocks, 17 levels every 8
    const lat = [];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) lat.push(this.column(x0 + i * 4, z0 + j * 4));
    // biomes every 4 blocks, with ragged edges
    const bq = new Uint8Array(25);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) bq[j * 5 + i] = this.biomeAt(x0 + i * 4, z0 + j * 4);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const jx = x + (hash3(S, x0 + x, 7, z0 + z) - 0.5) * 3.2, jz = z + (hash3(S, x0 + x, 11, z0 + z) - 0.5) * 3.2;
      const i = Math.max(0, Math.min(4, Math.round(jx / 4))), j = Math.max(0, Math.min(4, Math.round(jz / 4)));
      biome[(z << 4) | x] = bq[j * 5 + i];
    }
    // fill
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = x >> 2, j = z >> 2, fx = (x & 3) / 4, fz = (z & 3) / 4;
      const a = lat[j * 5 + i], b = lat[j * 5 + i + 1], c = lat[(j + 1) * 5 + i], d = lat[(j + 1) * 5 + i + 1];
      for (let y = 0; y <= ROOF; y++) {
        const k = y >> 3, fy = (y & 7) / 8;
        const v0 = lerp(lerp(a[k], b[k], fx), lerp(c[k], d[k], fx), fz);
        const v1 = lerp(lerp(a[k + 1], b[k + 1], fx), lerp(c[k + 1], d[k + 1], fx), fz);
        const v = lerp(v0, v1, fy);
        const wx = x0 + x, wz = z0 + z;
        let blk = 0;
        // (the rules turn netherrack to bedrock, as the game's do; the floor and the roof are always solid)
        if (y === 0 || y === ROOF) blk = B.bedrock;
        else if (v > 0) blk = this.bedrockAt(wx, y, wz) ? B.bedrock : B.netherrack;
        else if (y <= LAVA_TOP) blk = B.lava;
        blocks[idx(x, I(y), z)] = blk;
      }
    }
    this.surface(blocks, meta, biome, x0, z0);
    // the game's caves, cut after the surfaces as the game cuts them
    this.carvers.carve(blocks, meta, cx, cz);
    const r = rng(mix32(S ^ Math.imul(cx, 341873128) ^ Math.imul(cz, 132897987)));
    this.ores(blocks, r);
    this.decorate(blocks, meta, biome, r, x0, z0);
    let top = 0;
    for (let i = VOL - 1; i >= 0; i--) if (blocks[i]) { top = i >> 8; break; }
    return { blocks, meta, biome, top };
  }

  // whether the bedrock rules make (x, y, z) bedrock (the game's surface rules, see bedrockRule)
  bedrockAt(x, y, z) {
    if (y <= 0 || y >= ROOF) return true;
    if (y < 5) return ruleFloat(this.floorRule, x, y, z) < fade(y, 0, 5);
    if (y > ROOF - 5) return !(ruleFloat(this.roofRule, x, y, z) < fade(y, ROOF - 5, ROOF));
    return false;
  }

  /* ---- surfaces: floors (solid with air or lava over them) and ceilings ---- */
  surface(blocks, meta, biome, x0, z0) {
    const N = B.netherrack;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z, bi = biome[(z << 4) | x];
      const st = this.nState.sample(wx, 0, wz);
      const soul = this.nSoul.sample(wx, 0, wz), grav = this.nGravel.sample(wx, 0, wz), patch = this.nPatch.sample(wx, 0, wz);
      const wart = this.nWart.sample(wx, 0, wz);
      let floorRun = -1, ceilRun = -1;
      for (let y = ROOF - 1; y >= 1; y--) {
        const i = idx(x, I(y), z);
        const b = blocks[i];
        if (b !== N) { floorRun = -1; ceilRun = -1; continue; }
        const above = blocks[idx(x, I(y + 1), z)], below = blocks[idx(x, I(y - 1), z)];
        if (above === 0 || above === B.lava) floorRun = 0; else if (floorRun >= 0) floorRun++;
        if (below === 0 || below === B.lava) ceilRun = 0;
        if (y >= ROOF - 5) continue;                         // just under the roof: netherrack whatever the biome
        const depth = 3 + Math.floor(st * 1.5);
        let pick = 0;
        if (bi === BIO.crimson_forest || bi === BIO.warped_forest) {
          if (floorRun === 0 && y > LAVA_TOP && above === 0) {
            const crimson = bi === BIO.crimson_forest;
            pick = wart > 1.17 ? (crimson ? B.nether_wart_block : B.warped_wart_block) : (crimson ? B.crimson_nylium : B.warped_nylium);
          }
        } else if (bi === BIO.soul_sand_valley) {
          if ((floorRun >= 0 && floorRun < depth) || (ceilRun >= 0 && ceilRun < depth)) {
            if (floorRun >= 0 && floorRun < 2 && patch > 0.24 && y < LAVA_TOP + 4) pick = B.gravel;
            else pick = st > 0 ? B.soul_sand : B.soul_soil;
          }
        } else if (bi === BIO.basalt_deltas) {
          if (ceilRun >= 0 && ceilRun < depth + 2) pick = B.basalt;
          else if (floorRun >= 0 && floorRun < depth) pick = patch > 0.2 && floorRun < 2 ? B.gravel : st > 0 ? B.blackstone : B.basalt;
        } else {
          // the wastes: soul sand and gravel round the shore
          if (floorRun >= 0 && floorRun < 3 && y >= LAVA_TOP - 1 && y <= LAVA_TOP + 4) {
            if (soul > 0.2) pick = B.soul_sand;
            else if (grav > 0.2 && y <= LAVA_TOP + 3) pick = B.gravel;
          }
        }
        if (pick) blocks[i] = pick;
        if (ceilRun >= 0) ceilRun++;
      }
    }
  }

  /* ---- ores and veins: blobs replacing netherrack ---- */
  ores(blocks, r) {
    const N = B.netherrack;
    const blob = (blk, size, yLo, yHi, noAir) => {
      const cx = 2 + r.int(12), cz = 2 + r.int(12), cy = yLo + r.int(yHi - yLo + 1);
      const rad = Math.max(1, Math.cbrt(size) * 0.9);
      const R = Math.ceil(rad);
      for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, z = cz + dz, y = cy + dy;
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y > ROOF - 1) continue;
        if (dx * dx + dy * dy + dz * dz > rad * rad * (0.75 + r() * 0.5)) continue;
        const i = idx(x, I(y), z);
        if (blocks[i] !== N && !(blk === B.ancient_debris && (blocks[i] === B.basalt || blocks[i] === B.blackstone))) continue;
        if (noAir) {
          let air = false;
          for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const nx = x + ax, nz = z + az;
            if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
            if (blocks[idx(nx, I(y + ay), nz)] === 0) air = true;
          }
          if (air) continue;
        }
        blocks[i] = blk;
      }
    };
    for (let n = 0; n < 16; n++) blob(B.nether_quartz_ore, 14, 10, 117);
    for (let n = 0; n < 10; n++) blob(B.nether_gold_ore, 10, 10, 117);
    blob(B.ancient_debris, 3, 8, 24, true);
    blob(B.ancient_debris, 2, 8, 119, true);
    for (let n = 0; n < 4; n++) blob(B.magma_block, 33, 27, 36);
    for (let n = 0; n < 2; n++) blob(B.gravel, 33, 5, 41);
    for (let n = 0; n < 2; n++) blob(B.blackstone, 33, 5, 31);
  }

  /* ---- what grows and hangs ---- */
  decorate(blocks, meta, biome, r, x0, z0) {
    const get = (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y > 255 ? -1 : blocks[idx(x, I(y), z)]);
    const set = (x, y, z, b, m) => { if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y >= ROOF) return; const i = idx(x, I(y), z); blocks[i] = b; meta[i] = m || 0; };
    const floors = (x, z, test) => {
      const out = [];
      for (let y = ROOF - 2; y > 1; y--) { const b = get(x, y, z); if (get(x, y + 1, z) === 0 && b > 0 && b !== B.lava && b !== B.bedrock && (!test || test(b))) out.push(y); }
      return out;
    };
    const ceilings = (x, z) => {
      const out = [];
      for (let y = ROOF - 1; y > 2; y--) { const b = get(x, y, z); if (get(x, y - 1, z) === 0 && b > 0 && b !== B.lava && b !== B.bedrock) out.push(y); }
      return out;
    };
    const centre = biome[(8 << 4) | 8];

    /* glowstone: a blob grows down from a netherrack ceiling, each new block touching exactly one */
    for (let n = 0; n < 16; n++) {
      const x = 4 + r.int(8), z = 4 + r.int(8), y = 4 + r.int(120);
      if (get(x, y, z) !== 0 || get(x, y + 1, z) !== B.netherrack) continue;
      set(x, y, z, B.glowstone);
      for (let k = 0; k < 400; k++) {
        const px = x + r.int(4) - r.int(4), py = y - r.int(9), pz = z + r.int(4) - r.int(4);
        if (get(px, py, pz) !== 0) continue;
        let touch = 0;
        for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (get(px + ax, py + ay, pz + az) === B.glowstone) touch++;
        if (touch === 1) set(px, py, pz, B.glowstone);
      }
    }

    /* the forests: huge fungi, then what grows on the nylium */
    const forest = centre === BIO.crimson_forest || centre === BIO.warped_forest;
    if (forest) {
      const crimson = centre === BIO.crimson_forest;
      const ny = crimson ? B.crimson_nylium : B.warped_nylium;
      for (let n = 0; n < 8; n++) {
        const x = 3 + r.int(10), z = 3 + r.int(10);
        const fl = floors(x, z, b => b === ny);
        if (!fl.length) continue;
        this.hugeFungus(get, set, r, x, fl[r.int(fl.length)] + 1, z, crimson);
      }
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        for (const y of floors(x, z, b => b === B.crimson_nylium || b === B.warped_nylium)) {
          const c = get(x, y, z) === B.crimson_nylium;
          const roll = r();
          if (roll < 0.10) set(x, y + 1, z, c ? B.crimson_roots : B.warped_roots);
          else if (roll < 0.13) set(x, y + 1, z, c ? B.crimson_fungus : B.warped_fungus);
          else if (!c && roll < 0.2) set(x, y + 1, z, B.nether_sprouts);
        }
      }
      // weeping vines hang from crimson ceilings; twisting vines climb from warped floors
      for (let n = 0; n < 10; n++) {
        const x = r.int(16), z = r.int(16);
        if (crimson) {
          const cs = ceilings(x, z);
          if (!cs.length) continue;
          const y = cs[r.int(cs.length)], len = 1 + r.int(8);
          for (let k = 1; k <= len; k++) {
            if (get(x, y - k, z) !== 0) break;
            set(x, y - k, z, k === len || get(x, y - k - 1, z) !== 0 ? B.weeping_vines : B.weeping_vines_plant);
          }
        } else {
          const fl = floors(x, z);
          if (!fl.length) continue;
          const y = fl[r.int(fl.length)], len = 1 + r.int(8);
          for (let k = 1; k <= len; k++) {
            if (get(x, y + k, z) !== 0) break;
            set(x, y + k, z, k === len || get(x, y + k + 1, z) !== 0 ? B.twisting_vines : B.twisting_vines_plant);
          }
        }
      }
    }

    /* the deltas: pools of lava rimmed with magma on the floor, basalt columns */
    if (centre === BIO.basalt_deltas) {
      for (let n = 0; n < 12; n++) {
        const x = 4 + r.int(8), z = 4 + r.int(8);
        const fl = floors(x, z);
        if (!fl.length) continue;
        const y = fl[r.int(fl.length)], rad = 2 + r.int(3), rim = r.int(3);
        for (let dz = -rad - rim; dz <= rad + rim; dz++) for (let dx = -rad - rim; dx <= rad + rim; dx++) {
          const px = x + dx, pz = z + dz, d = Math.hypot(dx, dz);
          if (d > rad + rim + 0.3) continue;
          const b = get(px, y, pz);
          if (b <= 0 || b === B.lava || get(px, y + 1, pz) !== 0) continue;
          // only where it stays in: solid on every side and below
          let shut = get(px, y - 1, pz) > 0;
          for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nb = get(px + ax, y, pz + az); if (nb === 0 || nb === -1) shut = false; }
          if (d <= rad && shut) set(px, y, pz, B.lava);
          else set(px, y, pz, B.magma_block);
        }
      }
      for (let n = 0; n < 6; n++) {
        const x = 2 + r.int(12), z = 2 + r.int(12);
        const fl = floors(x, z);
        if (!fl.length) continue;
        const y = fl[r.int(fl.length)], big = r() < 0.35, reach = big ? 1 : 0, h = big ? 5 + r.int(6) : 1 + r.int(4);
        for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
          const hh = h - r.int(2) * (dx || dz ? 1 : 0);
          for (let k = 1; k <= hh; k++) { if (get(x + dx, y + k, z + dz) !== 0) break; set(x + dx, y + k, z + dz, B.basalt, 0); }
        }
      }
    }

    /* fire on netherrack, soul fire on soul sand and soil */
    for (let n = 0; n < 2; n++) {
      const x = 2 + r.int(12), z = 2 + r.int(12);
      const fl = floors(x, z, b => b === B.netherrack || b === B.soul_sand || b === B.soul_soil);
      if (!fl.length || r() < 0.5) continue;
      const y = fl[r.int(fl.length)];
      for (let k = 0; k < 12; k++) {
        const px = x + r.int(4) - r.int(4), pz = z + r.int(4) - r.int(4);
        for (let py = y + 2; py >= y - 2; py--) {
          const b = get(px, py, pz);
          if (get(px, py + 1, pz) !== 0) continue;
          if (b === B.netherrack) { set(px, py + 1, pz, B.fire); break; }
          if (b === B.soul_sand || b === B.soul_soil) { set(px, py + 1, pz, B.soul_fire); break; }
        }
      }
    }

    /* mushrooms in the dark */
    for (let n = 0; n < 2; n++) {
      if (r() > 0.5) continue;
      const x = r.int(16), z = r.int(16);
      const fl = floors(x, z, b => b === B.netherrack || b === B.soul_soil || b === B.basalt);
      if (fl.length) set(x, fl[r.int(fl.length)] + 1, z, r() < 0.5 ? B.brown_mushroom : B.red_mushroom);
    }
  }

  /* A huge fungus: a stem 4 to 13 tall, a hat of wart blocks (crimson or
     warped) widest near its bottom, a few shroomlights inside its rim, and
     on the crimson kind weeping vines hanging under its edge. */
  hugeFungus(get, set, r, x, y, z, crimson) {
    let h = 4 + r.int(9);
    if (r.int(12) === 0) h *= 2;
    h = Math.min(h, 22);
    for (let k = 0; k <= h; k++) if (get(x, y + k, z) !== 0 && k > 0) { h = k - 1; break; }
    if (h < 4) return;
    const stem = crimson ? B.crimson_stem : B.warped_stem, wart = crimson ? B.nether_wart_block : B.warped_wart_block;
    const hatH = Math.min(h, 3 + r.int(1 + Math.floor(h / 3)));
    const hatBottom = y + h - hatH;
    for (let k = 0; k < h; k++) set(x, y + k, z, stem, 0);
    for (let yy = hatBottom; yy <= y + h; yy++) {
      const top = yy === y + h;
      const rad = top ? 1 : yy < hatBottom + 2 && hatH > 3 ? 3 : 2;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
        const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
        if (corner && r() < 0.6) continue;
        if (!edge && !top) {
          // inside the hat: mostly hollow round the stem, with shroomlights hanging on its underside
          if ((dx || dz) && r() < 0.05) set(x + dx, yy, z + dz, B.shroomlight);
          continue;
        }
        if (dx === 0 && dz === 0 && !top) continue;
        if (get(x + dx, yy, z + dz) !== 0) continue;
        set(x + dx, yy, z + dz, r() < 0.04 ? B.shroomlight : wart);
        if (crimson && edge && yy === hatBottom && r() < 0.18) {
          const len = 1 + r.int(4);
          for (let k = 1; k <= len; k++) {
            if (get(x + dx, yy - k, z + dz) !== 0) break;
            set(x + dx, yy - k, z + dz, k === len ? B.weeping_vines : B.weeping_vines_plant);
          }
        }
      }
    }
    // a shroomlight inside the hat that touches nothing (not the stem, the hat or another light) is not left hanging in the air
    for (let yy = hatBottom; yy < y + h; yy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (get(x + dx, yy, z + dz) !== B.shroomlight) continue;
      let held = false;
      for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (get(x + dx + ax, yy + ay, z + dz + az) > 0) held = true;
      if (!held) set(x + dx, yy, z + dz, 0);
    }
  }
}
