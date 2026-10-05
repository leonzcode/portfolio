/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: the rarer features.

   Lava lakes, amethyst geodes, dungeons, magma under the sea, glow lichen,
   vines, blue ice, ice spikes, forest rocks, icebergs, the lush cave
   patches (moss, clay pools, rooted azaleas) and pointed dripstone. Each
   follows the game's algorithm step for step, with its random calls in the
   game's order (every placed feature has its own seeded random, so the
   order inside a feature decides where everything lands).

   Written from the game's behaviour and its 26.3 worldgen data, and checked
   against chunks the real server made. Registered into FEATURES.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=15';
import {
  FEATURES, strip, tag, provider, predicate, sampleInt, sampleFloat, stateFrom, placePlaced, survives, fluidOf, msin,
} from './features.js?v=15';
import { LegacyRandom } from './random.js?v=15';
import { Perlin } from './noise.js?v=15';

const MIN_Y = -64, MAX_Y = 319, SEA_LEVEL = 63;
const F = Math.fround;

/* ---- small block facts ---- */
const isAir = id => id === 0 || id === B.cave_air || id === B.void_air;
// "solid" in the game's old sense: a block you cannot walk through, not a fluid
const isSolid = id => id !== 0 && BLOCKS[id].solid && !fluidOf(id);
// a full face to stand on or hang from
const sturdy = id => id !== 0 && BLOCKS[id].shape === 'cube' && BLOCKS[id].solid;
const isWaterBlock = id => id === B.water;
const set = (names) => {
  const s = new Uint8Array(4096);
  for (const n of (Array.isArray(names) ? names : [names])) {
    const k = strip(n);
    if (k.startsWith('#')) { const t = tag(k.slice(1)); for (let i = 0; i < 4096; i++) if (t[i]) s[i] = 1; }
    else if (B[k] !== undefined) s[B[k]] = 1;
  }
  return s;
};
const cannotReplace = () => tag('features_cannot_replace');
function safeSet(R, x, y, z, id, meta, cant) {
  if (!cant[R.get(x, y, z)]) R.set(x, y, z, id, meta || 0);
}

// directions in the game's enum order: down, up, north, south, west, east
const DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const OPP = [1, 0, 3, 2, 5, 4];
const AXIS = [1, 1, 2, 2, 0, 0];
const HORIZ = [2, 5, 3, 4];               // north, east, south, west
// our "facing" meta: 0 north, 1 east, 2 south, 3 west, 4 up, 5 down
const FACING_META = [5, 4, 0, 2, 3, 1];

// Java's Util.shuffle (from the back, one nextInt per step)
function shuffle(list, r) {
  for (let j = list.length; j > 1; j--) {
    const k = r.nextInt(j);
    const t = list[j - 1]; list[j - 1] = list[k]; list[k] = t;
  }
  return list;
}

/* Java's HashSet<BlockPos> walks its entries by hash bucket, not in the
   order they were added; features that loop over one (vegetation patches)
   meet their positions in that order. */
function hashOrder(list) {
  let cap = 16, n = 0;
  for (let i = 0; i < list.length; i++) { n++; if (n > cap * 0.75) cap *= 2; }
  const keyed = list.map((p, i) => {
    let h = (Math.imul((p[1] + Math.imul(p[2], 31)) | 0, 31) + p[0]) | 0;
    h = h ^ (h >>> 16);
    return { p, b: h & (cap - 1), i };
  });
  keyed.sort((a, b) => a.b - b.b || a.i - b.i);
  return keyed.map(k => k.p);
}

/* ================================================================ lakes == */
FEATURES.lake = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  if (oy <= MIN_Y + 4) return false;
  oy -= 4;
  const shape = new Uint8Array(2048);
  const n = r.nextInt(4) + 4;
  for (let j = 0; j < n; j++) {
    const d = r.nextDouble() * 6 + 3, e = r.nextDouble() * 4 + 2, f = r.nextDouble() * 6 + 3;
    const g = r.nextDouble() * (16 - d - 2) + 1 + d / 2;
    const h = r.nextDouble() * (8 - e - 4) + 2 + e / 2;
    const k = r.nextDouble() * (16 - f - 2) + 1 + f / 2;
    for (let l = 1; l < 15; l++) for (let m = 1; m < 15; m++) for (let q = 1; q < 7; q++) {
      const o = (l - g) / (d / 2), p = (q - h) / (e / 2), s = (m - k) / (f / 2);
      if (o * o + p * p + s * s < 1) shape[(l * 16 + m) * 8 + q] = 1;
    }
  }
  const at = (j, s, t) => shape[(j * 16 + s) * 8 + t];
  const edge = (j, s, t) => !at(j, s, t) && ((j < 15 && at(j + 1, s, t)) || (j > 0 && at(j - 1, s, t)) || (s < 15 && at(j, s + 1, t)) || (s > 0 && at(j, s - 1, t)) || (t < 7 && at(j, s, t + 1)) || (t > 0 && at(j, s, t - 1)));
  const fluid = stateFrom(c.fluid);
  for (let j = 0; j < 16; j++) for (let s = 0; s < 16; s++) for (let t = 0; t < 8; t++) {
    if (!edge(j, s, t)) continue;
    const b = R.get(ox + j, oy + t, oz + s);
    if (t >= 4 && fluidOf(b)) return false;
    if (t < 4 && !isSolid(b) && b !== fluid.id) return false;
  }
  const canFluid = predicate(c.can_replace_with_air_or_fluid || { type: 'true' });
  for (let j = 0; j < 16; j++) for (let s = 0; s < 16; s++) for (let t = 0; t < 8; t++) {
    if (!at(j, s, t)) continue;
    const x = ox + j, y = oy + t, z = oz + s;
    if (!canFluid(R, x, y, z)) continue;
    if (t >= 4) R.set(x, y, z, 0, 0); else R.set(x, y, z, fluid.id, fluid.meta);
  }
  const barrier = stateFrom(c.barrier);
  if (barrier && barrier.id !== 0) {
    const canBarrier = predicate(c.can_replace_with_barrier || { type: 'true' });
    for (let s = 0; s < 16; s++) for (let t = 0; t < 16; t++) for (let u = 0; u < 8; u++) {
      if (!edge(s, t, u)) continue;
      if (u >= 4 && r.nextInt(2) === 0) continue;
      const x = ox + s, y = oy + u, z = oz + t;
      const b = R.get(x, y, z);
      if (!isSolid(b) || !canBarrier(R, x, y, z)) continue;
      R.set(x, y, z, barrier.id, barrier.meta);
    }
  }
  return true;
};

/* ================================================================ geodes == */
// the game's fast inverse square root (geodes still use it)
const dv = new DataView(new ArrayBuffer(8));
const MAGIC = 6910469410427058090n;
function fastInvSqrt(d) {
  const e = 0.5 * d;
  dv.setFloat64(0, d);
  const l = MAGIC - (dv.getBigInt64(0) >> 1n);
  dv.setBigInt64(0, BigInt.asIntN(64, l));
  let x = dv.getFloat64(0);
  x *= 1.5 - e * x * x;
  return x;
}
let geodeNoise = null, geodeSeed = null;
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }
// NormalNoise.create(new LegacyRandom(seed), -4, 1.0): two one-octave Perlin noises
function makeGeodeNoise(seed) {
  const r = new LegacyRandom(seed);
  const octave = () => {
    const base = r.nextLong();
    return new Perlin(new LegacyRandom(BigInt.asIntN(64, BigInt(hashCode('octave_-4')) ^ base)));
  };
  const a = octave(), b = octave();
  const vf = 0.16666666666666666 / 0.2;
  const wrap = v => v - Math.floor(v / 33554432 + 0.5) * 33554432;
  return (x, y, z) => {
    const p = a.sample(wrap(x * 0.0625), wrap(y * 0.0625), wrap(z * 0.0625));
    const xx = x * 1.0181268882175227, yy = y * 1.0181268882175227, zz = z * 1.0181268882175227;
    const q = b.sample(wrap(xx * 0.0625), wrap(yy * 0.0625), wrap(zz * 0.0625));
    return (p + q) * vf;
  };
}
FEATURES.geode = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const blocks = c.blocks || {}, layers = c.layers || {}, crack = c.crack || {};
  if (geodeSeed !== D.gen.seed) { geodeNoise = makeGeodeNoise(D.gen.seed); geodeSeed = D.gen.seed; }
  const minOff = c.min_gen_offset ?? -16, maxOff = c.max_gen_offset ?? 16;
  const points = [];
  const k = sampleInt(c.distribution_points || { type: 'uniform', min_inclusive: 3, max_inclusive: 4 }, r);
  const owd = c.outer_wall_distance || { type: 'uniform', min_inclusive: 4, max_inclusive: 6 };
  const owdMax = typeof owd === 'number' ? owd : owd.max_inclusive;
  const d = k / owdMax;
  const fill = layers.filling ?? 1.7, inner = layers.inner_layer ?? 2.2, middle = layers.middle_layer ?? 3.2, outer = layers.outer_layer ?? 4.2;
  const e = 1 / Math.sqrt(fill), f = 1 / Math.sqrt(inner + d), g = 1 / Math.sqrt(middle + d), h = 1 / Math.sqrt(outer + d);
  const baseCrack = crack.base_crack_size ?? 2, crackOff = crack.crack_point_offset ?? 2;
  const l = 1 / Math.sqrt(baseCrack + r.nextDouble() / 2 + (k > 3 ? d : 0));
  const bl = r.nextFloat() < (crack.generate_crack_chance ?? 1);
  const invalid = set(blocks.invalid_blocks || '#minecraft:geode_invalid_blocks');
  const threshold = c.invalid_blocks_threshold ?? 0;
  const pointOffset = c.point_offset || { type: 'uniform', min_inclusive: 1, max_inclusive: 2 };
  let bad = 0;
  for (let n = 0; n < k; n++) {
    const px = ox + sampleInt(owd, r), py = oy + sampleInt(owd, r), pz = oz + sampleInt(owd, r);
    const b = R.get(px, py, pz);
    if ((isAir(b) || invalid[b]) && ++bad > threshold) return false;
    points.push([px, py, pz, sampleInt(pointOffset, r)]);
  }
  const cracks = [];
  if (bl) {
    const n = r.nextInt(4), o = k * 2 + 1;
    const cx = n === 0 || n === 2 ? o : 0, cz = n === 1 || n === 2 ? o : 0;
    for (const yy of [7, 5, 1]) cracks.push([ox + cx, oy + yy, oz + cz]);
  }
  const cant = set(blocks.cannot_replace || '#minecraft:features_cannot_replace');
  const fillP = provider(blocks.filling_provider || 'minecraft:air');
  const innerP = provider(blocks.inner_layer_provider), altP = provider(blocks.alternate_inner_layer_provider);
  const midP = provider(blocks.middle_layer_provider), outP = provider(blocks.outer_layer_provider);
  const altChance = c.use_alternate_layer0_chance ?? 0;
  const needAlt = c.placements_require_layer0_alternate ?? true;
  const potChance = c.use_potential_placements_chance ?? 0.35;
  const mult = c.noise_multiplier ?? 0.05;
  const potential = [];
  const put = (x, y, z, st) => safeSet(R, x, y, z, st.id, st.meta, cant);
  for (let z = oz + minOff; z <= oz + maxOff; z++) for (let y = oy + minOff; y <= oy + maxOff; y++) for (let x = ox + minOff; x <= ox + maxOff; x++) {
    const rn = geodeNoise(x, y, z) * mult;
    let s = 0, t = 0;
    for (const p of points) { const dx = x - p[0], dy = y - p[1], dz = z - p[2]; s += fastInvSqrt(dx * dx + dy * dy + dz * dz + p[3]) + rn; }
    for (const p of cracks) { const dx = x - p[0], dy = y - p[1], dz = z - p[2]; t += fastInvSqrt(dx * dx + dy * dy + dz * dz + crackOff) + rn; }
    if (s < h) continue;
    if (bl && t >= l && s < e) { put(x, y, z, { id: 0, meta: 0 }); continue; }
    if (s >= e) { put(x, y, z, fillP(r, x, y, z, R)); continue; }
    if (s >= f) {
      const alt = r.nextFloat() < altChance;
      put(x, y, z, alt ? altP(r, x, y, z, R) : innerP(r, x, y, z, R));
      if ((needAlt && !alt) || !(r.nextFloat() < potChance)) continue;
      potential.push([x, y, z]);
      continue;
    }
    if (s >= g) { put(x, y, z, midP(r, x, y, z, R)); continue; }
    put(x, y, z, outP(r, x, y, z, R));
  }
  const buds = (blocks.inner_placements || []).map(stateFrom);
  for (const [x, y, z] of potential) {
    if (!buds.length) break;
    const bud = buds[r.nextInt(buds.length)];
    for (let di = 0; di < 6; di++) {
      const [dx, dy, dz] = DIRS[di];
      const b = R.get(x + dx, y + dy, z + dz);
      if (!(isAir(b) || (b === B.water && R.meta(x + dx, y + dy, z + dz) === 0))) continue;
      safeSet(R, x + dx, y + dy, z + dz, bud.id, FACING_META[di], cant);
      break;
    }
  }
  return true;
};

/* ============================================================= dungeons == */
FEATURES.monster_room = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const cant = cannotReplace();
  const j = r.nextInt(2) + 2, k = -j - 1, l = j + 1;
  const o = r.nextInt(2) + 2, p = -o - 1, q = o + 1;
  let openings = 0;
  for (let s = k; s <= l; s++) for (let t = -1; t <= 4; t++) for (let u = p; u <= q; u++) {
    const x = ox + s, y = oy + t, z = oz + u;
    const solid = isSolid(R.get(x, y, z));
    if (t === -1 && !solid) return false;
    if (t === 4 && !solid) return false;
    if ((s === k || s === l || u === p || u === q) && t === 0 && isAir(R.get(x, y, z)) && isAir(R.get(x, y + 1, z))) openings++;
  }
  if (openings < 1 || openings > 5) return false;
  const CAVE_AIR = B.cave_air !== undefined ? B.cave_air : 0;
  for (let s = k; s <= l; s++) for (let t = 3; t >= -1; t--) for (let u = p; u <= q; u++) {
    const x = ox + s, y = oy + t, z = oz + u;
    const b = R.get(x, y, z);
    if (s === k || t === -1 || u === p || s === l || t === 4 || u === q) {
      if (y >= MIN_Y && !isSolid(R.get(x, y - 1, z))) { R.set(x, y, z, CAVE_AIR === 0 ? 0 : 0, 0); continue; }
      if (!isSolid(b) || b === B.chest) continue;
      if (t === -1 && r.nextInt(4) !== 0) { safeSet(R, x, y, z, B.mossy_cobblestone, 0, cant); continue; }
      safeSet(R, x, y, z, B.cobblestone, 0, cant);
      continue;
    }
    if (b === B.chest || b === B.spawner) continue;
    safeSet(R, x, y, z, CAVE_AIR, 0, cant);
  }
  // up to two chests against a wall
  for (let s = 0; s < 2; s++) {
    for (let t = 0; t < 3; t++) {
      const x = ox + r.nextInt(j * 2 + 1) - j, y = oy, z = oz + r.nextInt(o * 2 + 1) - o;
      if (!isAir(R.get(x, y, z))) continue;
      let walls = 0;
      for (const hi of HORIZ) { const [dx, , dz] = DIRS[hi]; if (isSolid(R.get(x + dx, y, z + dz))) walls++; }
      if (walls !== 1) continue;
      safeSet(R, x, y, z, B.chest, 0, cant);
      r.nextLong();          // the chest's loot table seed
      break;
    }
  }
  safeSet(R, ox, oy, oz, B.spawner, 0, cant);
  r.nextInt(4);              // which mob the spawner holds
  return true;
};

/* ====================================================== magma under sea == */
FEATURES.underwater_magma = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const range = c.floor_search_range ?? 5;
  // Column.scan: from a water block, the first non-water block below
  if (!isWaterBlock(R.get(ox, oy, oz))) return false;
  let y = oy;
  for (let i = 1; i < range && isWaterBlock(R.get(ox, y, oz)); i++) y++;
  y = oy;
  for (let i = 1; i < range && isWaterBlock(R.get(ox, y, oz)); i++) y--;
  if (isWaterBlock(R.get(ox, y, oz))) return false;
  const rad = c.placement_radius_around_floor ?? 1, prob = F(c.placement_probability_per_valid_position ?? 0.5);
  const waterOrAir = b => b === B.water || isAir(b);
  let any = false;
  for (let z = oz - rad; z <= oz + rad; z++) for (let yy = y - rad; yy <= y + rad; yy++) for (let x = ox - rad; x <= ox + rad; x++) {
    if (!(r.nextFloat() < prob)) continue;
    if (waterOrAir(R.get(x, yy, z)) || waterOrAir(R.get(x, yy - 1, z))) continue;
    let ok = true;
    for (const hi of HORIZ) { const [dx, , dz] = DIRS[hi]; if (waterOrAir(R.get(x + dx, yy, z + dz))) { ok = false; break; } }
    if (!ok) continue;
    R.set(x, yy, z, B.magma_block, 0);
    any = true;
  }
  return any;
};

/* ================================================== glow lichen and co == */
// the faces each multiface block has, kept on the region while it is decorated
function faces(R) { return R._faces || (R._faces = new Map()); }
const fkey = (x, y, z) => x + ',' + y + ',' + z;
FEATURES.multiface_growth = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const block = stateFrom(c.block);
  const on = set(c.can_be_placed_on || []);
  const valid = [];
  if (c.can_place_on_ceiling) valid.push(1);
  if (c.can_place_on_floor) valid.push(0);
  if (c.can_place_on_wall) valid.push(...HORIZ);
  const spreadChance = F(c.chance_of_spreading ?? 0.5);
  const F_ = faces(R);
  const airOrWater = b => isAir(b) || b === B.water;
  const hasFace = (x, y, z, d) => R.get(x, y, z) === block.id && ((F_.get(fkey(x, y, z)) || 0) & (1 << d)) !== 0;
  const canAttach = (x, y, z) => { const b = R.get(x, y, z); return b !== 0 && (sturdy(b) || BLOCKS[b].leaves); };
  const placeFace = (x, y, z, d) => {
    const k = fkey(x, y, z);
    const cur = R.get(x, y, z) === block.id ? (F_.get(k) || 0) : 0;
    R.set(x, y, z, block.id, 0);
    F_.set(k, cur | (1 << d));
  };
  // the game's spreader: to the same block, along the wall, or round a corner
  const canSpreadInto = (x, y, z, face) => {
    const b = R.get(x, y, z);
    if (!(isAir(b) || b === block.id || (b === B.water && R.meta(x, y, z) === 0))) return false;
    if (b === block.id && hasFace(x, y, z, face)) return false;
    const [dx, dy, dz] = DIRS[face];
    return canAttach(x + dx, y + dy, z + dz);
  };
  const spread = (x, y, z, face) => {
    const order = shuffle([0, 1, 2, 3, 4, 5], r);
    for (const dir of order) {
      if (AXIS[dir] === AXIS[face]) continue;
      if (!hasFace(x, y, z, face) || hasFace(x, y, z, dir)) continue;
      const [ax, ay, az] = DIRS[dir], [fx, fy, fz] = DIRS[face];
      const cands = [[x, y, z, dir], [x + ax, y + ay, z + az, face], [x + ax + fx, y + ay + fy, z + az + fz, OPP[dir]]];
      for (const [sx, sy, sz, sf] of cands) {
        if (!canSpreadInto(sx, sy, sz, sf)) continue;
        placeFace(sx, sy, sz, sf);
        return;
      }
    }
  };
  const grow = (x, y, z, dirs) => {
    for (const d of dirs) {
      const [dx, dy, dz] = DIRS[d];
      if (!on[R.get(x + dx, y + dy, z + dz)]) continue;
      if (!canAttach(x + dx, y + dy, z + dz) || hasFace(x, y, z, d)) return false;
      placeFace(x, y, z, d);
      if (r.nextFloat() < spreadChance) spread(x, y, z, d);
      return true;
    }
    return false;
  };
  if (!airOrWater(R.get(ox, oy, oz))) return false;
  const dirs = shuffle(valid.slice(), r);
  if (grow(ox, oy, oz, dirs)) return true;
  for (const d of dirs) {
    const rest = shuffle(valid.filter(v => v !== OPP[d]), r);
    const [dx, dy, dz] = DIRS[d];
    // (the game steps from the origin each time, so it looks at one block only)
    for (let i = 0; i < (c.search_range ?? 10); i++) {
      const x = ox + dx, y = oy + dy, z = oz + dz;
      const b = R.get(x, y, z);
      if (!airOrWater(b) && b !== block.id) break;
      if (grow(x, y, z, rest)) return true;
    }
  }
  return false;
};

FEATURES.vines = (D, c, r, x, y, z) => {
  const R = D.region;
  if (!isAir(R.get(x, y, z))) return false;
  for (let d = 1; d < 6; d++) {
    const [dx, dy, dz] = DIRS[d];
    const b = R.get(x + dx, y + dy, z + dz);
    if (!(b !== 0 && (sturdy(b) || BLOCKS[b].leaves))) continue;
    R.set(x, y, z, B.vine, 0);
    return true;
  }
  return false;
};

/* ================================================================== ice == */
FEATURES.blue_ice = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  if (oy > SEA_LEVEL - 1) return false;
  if (R.get(ox, oy, oz) !== B.water && R.get(ox, oy - 1, oz) !== B.water) return false;
  let ok = false;
  for (let d = 1; d < 6; d++) { const [dx, dy, dz] = DIRS[d]; if (R.get(ox + dx, oy + dy, oz + dz) === B.packed_ice) { ok = true; break; } }
  if (!ok) return false;
  R.set(ox, oy, oz, B.blue_ice, 0);
  for (let i = 0; i < 200; i++) {
    const j = r.nextInt(5) - r.nextInt(6);
    let k = 3;
    if (j < 2) k += Math.trunc(j / 2);
    if (k < 1) continue;
    const x = ox + r.nextInt(k) - r.nextInt(k), y = oy + j, z = oz + r.nextInt(k) - r.nextInt(k);
    const b = R.get(x, y, z);
    if (!isAir(b) && b !== B.water && b !== B.packed_ice && b !== B.ice) continue;
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = DIRS[d];
      if (R.get(x + dx, y + dy, z + dz) !== B.blue_ice) continue;
      R.set(x, y, z, B.blue_ice, 0);
      break;
    }
  }
  return true;
};

// ice spikes (the old ice spike feature, now with its blocks in data)
FEATURES.spike = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const st = stateFrom(c.state);
  const canOn = predicate(c.can_place_on || { type: 'true' });
  const canRep = predicate(c.can_replace || { type: 'true' });
  let y = oy;
  while (isAir(R.get(ox, y, oz)) && y > MIN_Y + 2) y--;
  if (!canOn(R, ox, y, oz)) return false;
  y += r.nextInt(4);
  const i = r.nextInt(4) + 7;
  const j = Math.trunc(i / 4) + r.nextInt(2);
  if (j > 1 && r.nextInt(60) === 0) y += 10 + r.nextInt(30);
  for (let k = 0; k < i; k++) {
    const f = F(F(1 - F(k / i)) * j);
    const l = Math.ceil(f);
    for (let m = -l; m <= l; m++) {
      const g = F(Math.abs(m) - F(0.25));
      for (let n = -l; n <= l; n++) {
        const h = F(Math.abs(n) - F(0.25));
        if (((m !== 0 || n !== 0) && F(F(g * g) + F(h * h)) > F(f * f)) || ((m === -l || m === l || n === -l || n === l) && r.nextFloat() > F(0.75))) continue;
        if (canRep(R, ox + m, y + k, oz + n) || isAir(R.get(ox + m, y + k, oz + n))) R.set(ox + m, y + k, oz + n, st.id, st.meta);
        if (k === 0 || l <= 1) continue;
        if (!(canRep(R, ox + m, y - k, oz + n) || isAir(R.get(ox + m, y - k, oz + n)))) continue;
        R.set(ox + m, y - k, oz + n, st.id, st.meta);
      }
    }
  }
  let k = j - 1;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  for (let l = -k; l <= k; l++) for (let m = -k; m <= k; m++) {
    let py = y - 1;
    let o = 50;
    if (Math.abs(l) === 1 && Math.abs(m) === 1) o = r.nextInt(5);
    while (py > 50) {
      const b = R.get(ox + l, py, oz + m);
      if (!(isAir(b) || canRep(R, ox + l, py, oz + m) || b === st.id)) break;
      R.set(ox + l, py, oz + m, st.id, st.meta);
      py--;
      if (--o > 0) continue;
      py -= r.nextInt(5) + 1;
      o = r.nextInt(5);
    }
  }
  return true;
};

// forest rocks: three overlapping blobs going downhill
FEATURES.block_blob = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const st = stateFrom(c.state);
  const canOn = predicate(c.can_place_on || { type: 'true' });
  let y = oy;
  while (y > MIN_Y + 3) {
    if (!isAir(R.get(ox, y - 1, oz)) && canOn(R, ox, y - 1, oz)) break;
    y--;
  }
  if (y <= MIN_Y + 3) return false;
  let x = ox, z = oz;
  for (let i = 0; i < 3; i++) {
    const j = r.nextInt(2), k = r.nextInt(2), l = r.nextInt(2);
    const f = F(F((j + k + l) * F(0.333)) + F(0.5));
    const ff = F(f * f);
    for (let zz = z - l; zz <= z + l; zz++) for (let yy = y - k; yy <= y + k; yy++) for (let xx = x - j; xx <= x + j; xx++) {
      const dx = xx - x, dy = yy - y, dz = zz - z;
      if (!(dx * dx + dy * dy + dz * dz <= ff)) continue;
      R.set(xx, yy, zz, st.id, st.meta);
    }
    x += -1 + r.nextInt(2);
    y += -r.nextInt(2);
    z += -1 + r.nextInt(2);
  }
  return true;
};

/* ============================================ lush caves and their kin == */
function vegetationPatch(D, c, r, ox, oy, oz, waterlogged) {
  const R = D.region;
  const rep = set(c.replaceable);
  const xr = sampleInt(c.xz_radius, r) + 1, zr = sampleInt(c.xz_radius, r) + 1;
  const down = (c.surface || 'floor') === 'floor';
  const dir = down ? -1 : 1;
  const ground = provider(c.ground_state);
  const edgeChance = F(c.extra_edge_column_chance ?? 0), bottomChance = F(c.extra_bottom_block_chance ?? 0);
  const vr = c.vertical_range ?? 1;
  const list = [];
  for (let k = -xr; k <= xr; k++) {
    const ex = k === -xr || k === xr;
    for (let l = -zr; l <= zr; l++) {
      const ez = l === -zr || l === zr;
      const edge = ex || ez, corner = ex && ez, side = edge && !corner;
      if (corner || (side && (edgeChance === 0 || r.nextFloat() > edgeChance))) continue;
      const x = ox + k, z = oz + l;
      let y = oy, n;
      for (n = 0; isAir(R.get(x, y, z)) && n < vr; n++) y += dir;
      for (n = 0; !isAir(R.get(x, y, z)) && n < vr; n++) y -= dir;
      const gy = y + dir;
      if (!isAir(R.get(x, y, z)) || !sturdy(R.get(x, gy, z))) continue;
      const depth = sampleInt(c.depth, r) + (bottomChance > 0 && r.nextFloat() < bottomChance ? 1 : 0);
      // the ground itself, down from the top block
      let py = gy, ok = true;
      for (let i = 0; i < depth; i++) {
        const st = ground(r, x, py, z, R);
        const b = R.get(x, py, z);
        if (st.id !== b) {
          if (!rep[b]) { ok = i !== 0; break; }
          R.set(x, py, z, st.id, st.meta);
          py += dir;
        }
      }
      if (ok) list.push([x, gy, z]);
    }
  }
  let placed = hashOrder(list);
  if (waterlogged) {
    const keep = [];
    for (const p of placed) {
      const [x, y, z] = p;
      let exposed = false;
      for (const d of [2, 5, 3, 4, 0]) {
        const [dx, dy, dz] = DIRS[d];
        if (!sturdy(R.get(x + dx, y + dy, z + dz))) { exposed = true; break; }
      }
      if (!exposed) keep.push(p);
    }
    placed = hashOrder(keep);
    for (const [x, y, z] of placed) R.set(x, y, z, B.water, 0);
  }
  const vc = F(c.vegetation_chance ?? 0);
  for (const [x, y, z] of placed) {
    if (!(vc > 0) || !(r.nextFloat() < vc)) continue;
    const vy = waterlogged ? y + 1 : y - dir;
    placePlaced(D, c.vegetation_feature, r, x, vy, z);
  }
  return placed.length > 0;
}
FEATURES.vegetation_patch = (D, c, r, x, y, z) => vegetationPatch(D, c, r, x, y, z, false);
FEATURES.waterlogged_vegetation_patch = (D, c, r, x, y, z) => vegetationPatch(D, c, r, x, y, z, true);

// rooted azaleas: a tree on the surface above, rooted dirt down to here, hanging roots
FEATURES.root_system = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  if (!isAir(R.get(ox, oy, oz))) return false;
  const treeOk = predicate(c.allowed_tree_position);
  const space = c.required_vertical_space_for_tree ?? 3, water = c.allowed_vertical_water_for_tree ?? 2;
  const maxH = c.root_column_max_height ?? 100;
  const spaceFor = (y) => {
    for (let i = 1; i <= space; i++) {
      const b = R.get(ox, y + i, oz);
      if (isAir(b)) continue;
      if (i + 1 <= water && fluidOf(b) === 1) continue;
      return false;
    }
    return true;
  };
  let y = oy, found = -1;
  for (let i = 0; i < maxH; i++) {
    y++;
    if (!treeOk(R, ox, y, oz) || !spaceFor(y)) continue;
    const below = R.get(ox, y - 1, oz);
    if (fluidOf(below) === 2 || !isSolid(below)) return true;
    if (!placePlaced(D, c.feature, r, ox, y, oz)) continue;
    found = oy + i;
    break;
  }
  if (found < 0) return true;
  // rooted dirt round the column below the tree
  const rr = c.root_radius ?? 3, attempts = c.root_placement_attempts ?? 20;
  const rootRep = set(c.root_replaceable);
  const rootP = provider(c.root_state_provider);
  for (let k = oy; k < found; k++) {
    for (let j = 0; j < attempts; j++) {
      const x = ox + r.nextInt(rr) - r.nextInt(rr), z = oz + r.nextInt(rr) - r.nextInt(rr);
      if (rootRep[R.get(x, k, z)]) { const st = rootP(r, x, k, z, R); R.set(x, k, z, st.id, st.meta); }
    }
  }
  // hanging roots under the cave ceiling
  const hr = c.hanging_root_radius ?? 3, hv = c.hanging_roots_vertical_span ?? 2;
  const hangP = provider(c.hanging_root_state_provider);
  for (let k = 0; k < (c.hanging_root_placement_attempts ?? 20); k++) {
    const x = ox + r.nextInt(hr) - r.nextInt(hr), yy = oy + r.nextInt(hv) - r.nextInt(hv), z = oz + r.nextInt(hr) - r.nextInt(hr);
    if (!isAir(R.get(x, yy, z))) continue;
    const st = hangP(r, x, yy, z, R);
    if (!sturdy(R.get(x, yy + 1, z))) continue;
    R.set(x, yy, z, st.id, st.meta);
  }
  return true;
};

/* ============================================================ dripstone == */
function dripBase(b, rep) { return b === B.dripstone_block || rep[b] === 1; }
function placeDripBlock(R, x, y, z, rep) {
  if (rep[R.get(x, y, z)]) { R.set(x, y, z, B.dripstone_block, 0); return true; }
  return false;
}
function growPointed(R, x, y, z, dir, height, rep) {
  // dir: -1 down (a stalactite), 1 up (a stalagmite)
  const back = R.get(x, y - dir, z);
  if (!(dripBase(back, rep) || back === B.lava)) return;
  for (let i = 0; i < height; i++) R.set(x, y + dir * i, z, B.pointed_dripstone, dir < 0 ? 5 : 4);
}
FEATURES.speleothem = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const rep = set(c.replaceable_blocks || '#minecraft:dripstone_replaceable_blocks');
  const up = dripBase(R.get(ox, oy + 1, oz), rep), dn = dripBase(R.get(ox, oy - 1, oz), rep);
  let dir;
  if (up && dn) dir = r.nextBoolean() ? -1 : 1;
  else if (up) dir = -1;
  else if (dn) dir = 1;
  else return false;
  const bx = ox, by = oy - dir, bz = oz;
  placeDripBlock(R, bx, by, bz, rep);
  const spread = F(c.chance_of_directional_spread ?? 0.7), r2 = F(c.chance_of_spread_radius2 ?? 0.5), r3 = F(c.chance_of_spread_radius3 ?? 0.5);
  for (const hi of HORIZ) {
    if (r.nextFloat() > spread) continue;
    const [dx, , dz] = DIRS[hi];
    let x = bx + dx, y = by, z = bz + dz;
    placeDripBlock(R, x, y, z, rep);
    if (r.nextFloat() > r2) continue;
    let d = DIRS[r.nextInt(6)];
    x += d[0]; y += d[1]; z += d[2];
    placeDripBlock(R, x, y, z, rep);
    if (r.nextFloat() > r3) continue;
    d = DIRS[r.nextInt(6)];
    x += d[0]; y += d[1]; z += d[2];
    placeDripBlock(R, x, y, z, rep);
  }
  const tipFree = (() => { const b = R.get(ox, oy + dir, oz); return isAir(b) || b === B.water; })();
  const h = r.nextFloat() < F(c.chance_of_taller_dripstone ?? 0.2) && tipFree ? 2 : 1;
  growPointed(R, ox, oy, oz, dir, h, rep);
  return true;
};

/* ======================================================== small helpers == */
void survives; void sampleFloat; void msin;
