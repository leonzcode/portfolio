/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world generator.

   Built the way Minecraft has built worlds since 1.18 (the "Caves & Cliffs"
   generator), from the published descriptions of it:

   1. Climate. Six noises, each read on its own scale: temperature, humidity
      (vegetation), continentalness (how far from the sea), erosion (how flat),
      weirdness (which variant), and from weirdness the "peaks and valleys"
      value. They are read at y = 0 with a gentle domain shift, as in the game.

   2. Shape. Continentalness, erosion and peaks-and-valleys go through splines
      to give three numbers per column: offset (how high the land sits),
      factor (how smooth it is: low means cliffs and overhangs) and
      jaggedness (how spiky the peaks are). With a height gradient they make
      a 3D density; above zero is stone. Density is worked out on a coarse
      4 x 8 x 4 lattice and smoothly interpolated in between, which is what
      gives Minecraft terrain its look.

   3. Caves: cheese caves (big caverns), spaghetti caves (long tunnels where
      two noises are both near zero), noodle caves (thin twisting ones), and
      entrances where tunnels break the surface.

   4. Biomes, picked from the climate the way the overworld biome table does:
      oceans by temperature, coasts, rivers in the valleys, peaks and slopes
      on the mountains, plateaus, windswept hills, swamps, and the "middle"
      biomes by temperature and humidity with their weird variants.

   5. Surface rules by biome (grass and dirt, sand and sandstone, the bands of
      badlands terracotta, snow on peaks, podzol, mycelium, gravel...), then
      deepslate, bedrock, stone blobs and ores, then trees and plants.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from './blocks.js?v=107';
import { BIO, BIOMES } from './biomes.js?v=107';
import { NormalNoise, Improved, rng, mix32, hash3, spline, evalSpline } from './noise.js?v=107';
import { CH, H, Y0, SEA, idx, VOL } from './world-const.js?v=107';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* =========================================================== the splines ==
   Offset (where the land sits), factor (how smooth) and jaggedness (how
   spiky), from continentalness, erosion and peaks-and-valleys. The control
   values below are the base heights the game's own splines produce at the
   middle of each band, so the land comes out at the heights Minecraft's does:
   ocean floors at 35 and 48, plains in the 60s and 70s, river beds below the
   sea, and the far inland mountains, with low erosion and high peaks, up to
   about 250. */
const E_EDGE = [-1, -0.78, -0.375, -0.2225, 0.05, 0.45, 0.55, 1];
const C_ROWS = [-0.15, -0.05, 0.15, 0.5, 0.9];
// base heights by continentalness row and erosion level: valley floor, middle, peak
const H_VALLEY = [[52, 44, 27, 44, 45, 55, 61], [54, 46, 34, 51, 51, 57, 61], [82, 80, 34, 51, 51, 52, 61], [94, 89, 35, 52, 52, 52, 61], [107, 89, 40, 57, 57, 57, 61]];
const H_MID = [[102, 85, 69, 64, 63, 61, 60], [105, 87, 71, 64, 65, 63, 60], [145, 109, 97, 66, 65, 81, 60], [162, 119, 108, 66, 65, 85, 61], [180, 132, 120, 67, 65, 85, 65]];
const H_PEAK = [[152, 121, 71, 71, 64, 64, 64], [156, 124, 74, 74, 76, 77, 76], [207, 159, 108, 108, 76, 84, 76], [230, 174, 123, 123, 76, 85, 76], [254, 190, 139, 138, 76, 85, 76]];
// how the low and high ground sit between those, per erosion level
const LOW_F = [0.6, 0.6, 1.0, 0.85, 1.0, 1.0, 1.0], HIGH_F = [0.6, 0.6, 0.9, 0.9, 0.3, 0.3, 0.5];
const sv = h => (h - 63.5) / 128;
function ridge(v, lo, mid, hi, pk) {
  const m = (a, b, t) => a + (b - a) * t;
  // rivers sit in a narrow cut at the very bottom of the valleys
  return spline('pv', [[-1, v, 0], [-0.9, m(v, lo, 0.4), 0], [-0.7, lo, 0], [-0.2, m(lo, mid, 0.85), 0], [0, mid, 0], [0.35, hi, 0], [0.7, m(hi, pk, 0.7), 0], [1, pk, 0]]);
}
function eBands(per) {
  // each erosion level holds its value across most of its width, and the
  // land steps between them near the edges, which is where the cliffs are
  const pts = [];
  for (let k = 0; k < 7; k++) {
    const lo = E_EDGE[k], hi = E_EDGE[k + 1], w = hi - lo;
    pts.push([lo + w * 0.22, per(k), 0], [hi - w * 0.22, per(k), 0]);
  }
  return spline('e', pts);
}
function offsetRow(r) {
  return eBands(k => {
    const v = sv(H_VALLEY[r][k]), mid = sv(H_MID[r][k]), pk = sv(H_PEAK[r][k]);
    return ridge(v, v + (mid - v) * LOW_F[k], mid, mid + (pk - mid) * HIGH_F[k], pk);
  });
}
const OFFSET = spline('c', [
  [-1.1, 0.044, 0], [-1.02, -0.2222, 0], [-0.51, -0.2222, 0], [-0.44, -0.12, 0], [-0.18, -0.12, 0],
  ...C_ROWS.map((c, r) => [c, offsetRow(r), 0]),
]);
const F_ROW = [[6.25, 5.88, 6.25, 6.30, 6.25, 0.63, 6.25], [5.34, 5.06, 5.34, 6.24, 5.34, 0.63, 5.34], [4.69, 4.48, 4.69, 6.20, 4.69, 1.37, 4.69], [4.69, 4.48, 4.69, 6.20, 4.69, 1.37, 4.69], [4.69, 4.48, 4.69, 6.20, 4.69, 1.37, 4.69]];
// the windswept band only breaks up where the ground rises
const FACTOR = spline('c', [
  [-0.19, 3.95, 0],
  ...C_ROWS.map((c, r) => [c, eBands(k => k === 5 ? spline('pv', [[-0.4, F_ROW[r][4], 0], [-0.1, F_ROW[r][5], 0]]) : F_ROW[r][k]), 0]),
]);
// jaggedness: only the far mountains with low erosion get spikes, and
// negative weirdness (jagged peaks) twice as many as positive (frozen peaks)
function jaggedness(C, E, PV, W) {
  if (C < -0.11 || E > -0.375) return 0;
  const near = [0.19, 0.12], mid = [0.51, 0.35], far = [0.61, 0.58];
  const k = E < -0.78 ? 0 : 1;
  const t = C < 0.03 ? (C + 0.11) / 0.14 : C < 0.3 ? 1 + (C - 0.03) / 0.27 : 2 + Math.min(1, (C - 0.3) / 0.6);
  const base = t < 1 ? near[k] * t : t < 2 ? near[k] + (mid[k] - near[k]) * (t - 1) : mid[k] + (far[k] - mid[k]) * (t - 2);
  const ramp = smooth(0.2, 0.9, PV);
  const edge = smooth(-0.375, -0.45, E);
  return base * ramp * edge * (W < 0 ? 1 : 0.5);
}

/* ========================================================== biome table ==
   Bands, as the overworld biome builder cuts them. */
const T_BANDS = [-0.45, -0.15, 0.2, 0.55];            // 5 temperatures
const H_BANDS = [-0.35, -0.1, 0.1, 0.3];              // 5 humidities
const E_BANDS = [-0.78, -0.375, -0.2225, 0.05, 0.45, 0.55];   // 7 erosion levels
const band = (v, cuts) => { let i = 0; while (i < cuts.length && v > cuts[i]) i++; return i; };
const b_ = n => BIO[n];
const MIDDLE = [
  ['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'taiga'],
  ['plains', 'plains', 'forest', 'taiga', 'old_growth_spruce_taiga'],
  ['flower_forest', 'plains', 'forest', 'birch_forest', 'dark_forest'],
  ['savanna', 'savanna', 'forest', 'jungle', 'jungle'],
  ['desert', 'desert', 'desert', 'desert', 'desert'],
];
const MIDDLE_VAR = [
  ['ice_spikes', null, 'snowy_taiga', null, null],
  [null, null, null, null, 'old_growth_pine_taiga'],
  ['sunflower_plains', null, null, 'old_growth_birch_forest', null],
  [null, null, 'plains', 'sparse_jungle', 'bamboo_jungle'],
  [null, null, null, null, null],
];
const PLATEAU = [
  ['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'snowy_taiga'],
  ['meadow', 'meadow', 'forest', 'taiga', 'old_growth_spruce_taiga'],
  ['meadow', 'meadow', 'meadow', 'meadow', 'dark_forest'],
  ['savanna_plateau', 'savanna_plateau', 'forest', 'forest', 'jungle'],
  ['badlands', 'badlands', 'badlands', 'wooded_badlands', 'wooded_badlands'],
];
const PLATEAU_VAR = [
  ['ice_spikes', null, null, null, null],
  ['cherry_grove', null, 'meadow', 'meadow', 'old_growth_pine_taiga'],
  ['cherry_grove', 'cherry_grove', 'forest', 'birch_forest', null],
  [null, null, null, null, null],
  ['eroded_badlands', 'eroded_badlands', null, null, null],
];
const SHATTERED = [
  ['windswept_gravelly_hills', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'],
  ['windswept_gravelly_hills', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'],
  ['windswept_hills', 'windswept_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'],
  [null, null, null, null, null],
  [null, null, null, null, null],
];
const OCEANS = [
  ['deep_frozen_ocean', 'deep_cold_ocean', 'deep_ocean', 'deep_lukewarm_ocean', 'warm_ocean'],
  ['frozen_ocean', 'cold_ocean', 'ocean', 'lukewarm_ocean', 'warm_ocean'],
];

/* The slice layouts, as the overworld biome builder lays them out: the
   weirdness value picks a slice (valleys, low, mid, high, peaks), and each
   slice is a table of continentalness band against erosion level. */
const pos = w => w >= 0;
function middle(t, h, w) { return (pos(w) && MIDDLE_VAR[t][h]) || MIDDLE[t][h]; }
function plateau(t, h, w) { return (pos(w) && PLATEAU_VAR[t][h]) || PLATEAU[t][h]; }
function badlands(h, w) { return h <= 1 ? (pos(w) ? 'eroded_badlands' : 'badlands') : h === 2 ? 'badlands' : 'wooded_badlands'; }
function mob(t, h, w) { return t === 4 ? badlands(h, w) : middle(t, h, w); }
function slope(t, h, w) { return t >= 3 ? plateau(t, h, w) : h <= 1 ? 'snowy_slopes' : 'grove'; }
function mobs(t, h, w) { return t === 0 ? slope(t, h, w) : mob(t, h, w); }
function peak(t, h, w) { return t <= 2 ? (pos(w) ? 'frozen_peaks' : 'jagged_peaks') : t === 3 ? 'stony_peaks' : badlands(h, w); }
function shattered(t, h, w) { return SHATTERED[t][h] || middle(t, h, w); }
function savannaRule(n, t, h, w) { return t >= 2 && h <= 3 && pos(w) ? 'windswept_savanna' : n; }
function beach(t) { return t === 0 ? 'snowy_beach' : t === 4 ? 'desert' : 'beach'; }
function shatteredCoast(t, h, w) { return savannaRule(pos(w) ? middle(t, h, w) : beach(t), t, h, w); }
function swampy(t, h, w) { return t === 0 ? middle(t, h, w) : t <= 2 ? 'swamp' : 'mangrove_swamp'; }
function river(t) { return t === 0 ? 'frozen_river' : 'river'; }

export function pickBiome(cl) {
  const { T, Hu, C, E, W } = cl;
  if (C < -1.05) return b_('mushroom_fields');
  const t = band(T, T_BANDS), h = band(Hu, H_BANDS), e = band(E, E_BANDS);
  if (C < -0.455) return b_(OCEANS[0][t]);
  if (C < -0.19) return b_(OCEANS[1][t]);
  const cb = C < -0.11 ? 0 : C < 0.03 ? 1 : C < 0.3 ? 2 : 3;     // coast, near, mid, far
  const a = Math.abs(W);
  const slice = a < 0.05 ? 'valleys' : a < 0.2667 ? 'low' : a < 0.4 ? 'mid' : a < 0.5667 ? 'high' : a < 0.7667 ? 'peaks' : a < 0.9333 ? 'high' : 'mid';
  let n;
  if (slice === 'valleys') {
    if (cb === 0) n = river(t);
    else if (e <= 1) n = cb === 1 ? river(t) : mob(t, h, W);
    else if (e <= 5) n = river(t);
    else n = t === 0 ? 'frozen_river' : swampy(t, h, W);
  } else if (slice === 'low') {
    if (cb === 0) n = e <= 2 ? 'stony_shore' : e === 5 ? shatteredCoast(t, h, W) : beach(t);
    else if (e === 6) n = swampy(t, h, W);
    else if (cb === 1) n = e <= 1 ? mob(t, h, W) : e === 5 ? savannaRule(middle(t, h, W), t, h, W) : middle(t, h, W);
    else n = e <= 1 ? mobs(t, h, W) : e <= 3 ? mob(t, h, W) : middle(t, h, W);
  } else if (slice === 'mid') {
    if (cb === 0) n = e <= 2 ? 'stony_shore' : e === 3 ? middle(t, h, W) : e === 5 ? shatteredCoast(t, h, W) : (pos(W) ? middle(t, h, W) : beach(t));
    else if (e === 6) n = swampy(t, h, W);
    else if (e === 0) n = slope(t, h, W);
    else if (cb === 1) n = e === 1 ? mobs(t, h, W) : e === 5 ? savannaRule(middle(t, h, W), t, h, W) : middle(t, h, W);
    else if (cb === 2) n = e === 1 ? mobs(t, h, W) : e <= 3 ? mob(t, h, W) : e === 4 ? middle(t, h, W) : shattered(t, h, W);
    else n = e === 1 ? (t === 0 ? slope(t, h, W) : plateau(t, h, W)) : e === 2 ? plateau(t, h, W) : e === 3 ? mob(t, h, W) : e === 4 ? middle(t, h, W) : shattered(t, h, W);
  } else if (slice === 'high') {
    if (cb === 0) n = e === 5 ? savannaRule(middle(t, h, W), t, h, W) : middle(t, h, W);
    else if (cb === 1) n = e === 0 ? slope(t, h, W) : e === 1 ? mobs(t, h, W) : e === 5 ? savannaRule(middle(t, h, W), t, h, W) : middle(t, h, W);
    else n = e === 0 ? peak(t, h, W) : e === 1 ? slope(t, h, W) : e === 2 ? plateau(t, h, W) : e === 3 ? (cb === 2 ? mob(t, h, W) : plateau(t, h, W)) : e === 5 ? shattered(t, h, W) : middle(t, h, W);
  } else {                                                // peaks
    if (cb <= 1) n = e === 0 ? peak(t, h, W) : e === 1 ? mobs(t, h, W) : e === 5 ? savannaRule(shattered(t, h, W), t, h, W) : middle(t, h, W);
    else n = e <= 1 ? peak(t, h, W) : e === 2 ? plateau(t, h, W) : e === 3 ? (cb === 2 ? mob(t, h, W) : plateau(t, h, W)) : e === 5 ? shattered(t, h, W) : middle(t, h, W);
  }
  return b_(n) !== undefined ? b_(n) : b_('plains');
}

/* ============================================================ trees ======
   Each writes through set(x, y, z, block, onlyIfAir) in world coordinates. */
const LEAF_KEEP = (r, dx, dz, rad) => !(Math.abs(dx) === rad && Math.abs(dz) === rad) || r() < 0.5;
function blobTree(set, r, x, y, z, log, leaf, trunk) {
  for (let i = 0; i < trunk; i++) set(x, y + i, z, log);
  const top = y + trunk;
  for (let dy = -3; dy <= 0; dy++) {
    const rad = dy >= -1 ? 1 : 2;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === 0 || r() < 0.5)) continue;
      set(x + dx, top + dy, z + dz, leaf, true);
    }
  }
}
function fancyOak(set, r, x, y, z) {
  const h = 9 + r.int(6);
  for (let i = 0; i < h; i++) set(x, y + i, z, B.oak_log);
  const clusters = 3 + r.int(3);
  const blob = (cx, cy, cz) => {
    for (let dy = 0; dy < 4; dy++) {
      const rad = dy === 0 || dy === 3 ? 2 : 3;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx * dx + dz * dz > rad * rad + 0.5) continue;
        set(cx + dx, cy + dy, cz + dz, B.oak_leaves, true);
      }
    }
  };
  blob(x, y + h - 2, z);
  for (let c = 0; c < clusters; c++) {
    const a = r() * Math.PI * 2, d = 2 + r.int(3), by = y + Math.floor(h * 0.45) + r.int(Math.max(1, h * 0.4));
    const ex = x + Math.round(Math.cos(a) * d), ez = z + Math.round(Math.sin(a) * d);
    // the branch, then its leaves
    for (let s = 1; s <= d; s++) set(x + Math.round(Math.cos(a) * s), by + Math.round(s * 0.6), z + Math.round(Math.sin(a) * s), B.oak_log);
    blob(ex, by + Math.round(d * 0.6) - 1, ez);
  }
}
function spruce(set, r, x, y, z, trunk, pine) {
  for (let i = 0; i < trunk; i++) set(x, y + i, z, B.spruce_log);
  const top = y + trunk;
  set(x, top, z, B.spruce_leaves, true);
  set(x, top + 1, z, B.spruce_leaves, true);
  let rad = 0, maxR = pine ? 1 + r.int(2) : 2 + r.int(2);
  const start = pine ? Math.floor(trunk * 0.55) : 1 + r.int(2);
  for (let yy = top; yy >= y + start; yy--) {
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
      if (dx === 0 && dz === 0) continue;
      set(x + dx, yy, z + dz, B.spruce_leaves, true);
    }
    rad = rad >= maxR ? (pine ? maxR : 1) : rad + 1;
  }
}
function megaSpruce(set, r, x, y, z) {
  const h = 14 + r.int(14);
  for (let i = 0; i < h; i++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + a, y + i, z + b, B.spruce_log);
  let rad = 0;
  for (let yy = y + h + 1; yy >= y + h - 12; yy--) {
    const R = Math.min(5, rad);
    for (let dx = -R; dx <= R + 1; dx++) for (let dz = -R; dz <= R + 1; dz++) {
      const ddx = dx <= 0 ? dx : dx - 1, ddz = dz <= 0 ? dz : dz - 1;
      if (ddx * ddx + ddz * ddz > R * R) continue;
      set(x + dx, yy, z + dz, B.spruce_leaves, true);
    }
    rad = (y + h + 1 - yy) % 3 === 2 ? Math.max(1, rad - 1) : rad + 1;
  }
}
function acacia(set, r, x, y, z) {
  const h = 5 + r.int(3);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dz] = dirs[r.int(4)];
  let cx = x, cz = z;
  const bend = h - 2 - r.int(2);
  for (let i = 0; i < h; i++) {
    if (i >= bend) { cx += dx; cz += dz; }
    set(cx, y + i, cz, B.acacia_log);
  }
  const top = y + h;
  for (let ox = -3; ox <= 3; ox++) for (let oz = -3; oz <= 3; oz++) {
    if (Math.abs(ox) + Math.abs(oz) > 4) continue;
    set(cx + ox, top - 1, cz + oz, B.acacia_leaves, true);
    if (Math.abs(ox) + Math.abs(oz) <= 2) set(cx + ox, top, cz + oz, B.acacia_leaves, true);
  }
  // sometimes a second, smaller crown off the other way
  if (r() < 0.5) {
    let bx = x, bz = z;
    for (let i = 0; i < 3; i++) { bx -= dx; bz -= dz; set(bx, y + bend - 1 + i, bz, B.acacia_log); }
    for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
      if (Math.abs(ox) + Math.abs(oz) > 3) continue;
      set(bx + ox, y + bend + 2, bz + oz, B.acacia_leaves, true);
    }
  }
}
function darkOak(set, r, x, y, z) {
  const h = 6 + r.int(3);
  for (let i = 0; i < h; i++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + a, y + i, z + b, B.dark_oak_log);
  const top = y + h;
  for (let dy = -2; dy <= 1; dy++) {
    const R = dy === 1 ? 2 : dy === -2 ? 3 : 4;
    for (let dx = -R; dx <= R + 1; dx++) for (let dz = -R; dz <= R + 1; dz++) {
      const ddx = dx <= 0 ? dx : dx - 1, ddz = dz <= 0 ? dz : dz - 1;
      if (ddx * ddx + ddz * ddz > R * R + 1) continue;
      set(x + dx, top + dy, z + dz, B.dark_oak_leaves, true);
    }
  }
}
function jungleTree(set, r, x, y, z, mega) {
  if (!mega) { blobTree(set, r, x, y, z, B.jungle_log, B.jungle_leaves, 4 + r.int(7)); return; }
  const h = 12 + r.int(16);
  for (let i = 0; i < h; i++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + a, y + i, z + b, B.jungle_log);
  const crown = (cx, cy, cz, R) => {
    for (let dy = -1; dy <= 1; dy++) {
      const rr = R - (dy === 1 ? 1 : 0);
      for (let dx = -rr; dx <= rr + 1; dx++) for (let dz = -rr; dz <= rr + 1; dz++) {
        const ddx = dx <= 0 ? dx : dx - 1, ddz = dz <= 0 ? dz : dz - 1;
        if (ddx * ddx + ddz * ddz > rr * rr) continue;
        set(cx + dx, cy + dy, cz + dz, B.jungle_leaves, true);
      }
    }
  };
  crown(x, y + h, z, 4);
  for (let b = 0; b < 3; b++) {
    const a = r() * Math.PI * 2, by = y + Math.floor(h * 0.5) + r.int(Math.max(1, h * 0.3));
    const ex = x + Math.round(Math.cos(a) * 3), ez = z + Math.round(Math.sin(a) * 3);
    for (let s = 1; s <= 3; s++) set(x + Math.round(Math.cos(a) * s), by + s, z + Math.round(Math.sin(a) * s), B.jungle_log);
    crown(ex, by + 3, ez, 2);
  }
}
function cherry(set, r, x, y, z) {
  const h = 5 + r.int(3);
  for (let i = 0; i < h; i++) set(x, y + i, z, B.cherry_log);
  const branches = 2 + r.int(2);
  const crown = (cx, cy, cz) => {
    for (let dy = -1; dy <= 2; dy++) {
      const R = dy === 2 ? 2 : dy === -1 ? 3 : 4;
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > R * R + 1) continue;
        if (dy === -1 && r() < 0.35) continue;
        set(cx + dx, cy + dy, cz + dz, B.cherry_leaves, true);
      }
    }
  };
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + r() * 0.6;
    let bx = x, bz = z, by = y + h - 2;
    for (let s = 1; s <= 3; s++) { bx = x + Math.round(Math.cos(a) * s); bz = z + Math.round(Math.sin(a) * s); by++; set(bx, by, bz, B.cherry_log); }
    crown(bx, by + 1, bz);
  }
}
function mangrove(set, r, x, y, z) {
  const h = 6 + r.int(4);
  // prop roots arching into the water and mud
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1]]) {
    if (r() < 0.3) continue;
    for (let i = -2; i < 3; i++) set(x + Math.sign(dx) * (i < 1 ? 2 : 1) * (dx ? 1 : 0), y + i, z + Math.sign(dz) * (i < 1 ? 2 : 1) * (dz ? 1 : 0), B.mangrove_log);
  }
  for (let i = 0; i < h; i++) set(x, y + 2 + i, z, B.mangrove_log);
  const top = y + 2 + h;
  for (let dy = -2; dy <= 1; dy++) {
    const R = dy === 1 ? 2 : 3;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dz * dz > R * R + 1) continue;
      set(x + dx, top + dy, z + dz, B.mangrove_leaves, true);
    }
  }
}
function bush(set, r, x, y, z, log, leaf) {
  set(x, y, z, log);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 1; dy++) {
    if (Math.abs(dx) + Math.abs(dz) + dy * 2 > 3) continue;
    set(x + dx, y + dy, z + dz, leaf, true);
  }
}
function iceSpike(set, r, x, y, z) {
  const h = 6 + r.int(r() < 0.1 ? 30 : 10);
  for (let i = 0; i < h; i++) {
    const R = Math.max(0, Math.round((1 - i / h) * 2.2));
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dz * dz > R * R) continue;
      set(x + dx, y + i, z + dz, B.packed_ice);
    }
  }
}
function boulder(set, r, x, y, z) {
  const R = 1 + r.int(2);
  for (let dx = -R; dx <= R; dx++) for (let dy = -1; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    if (dx * dx + dy * dy + dz * dz > R * R + 1) continue;
    set(x + dx, y + dy, z + dz, B.mossy_cobblestone);
  }
}

/* ================================================== what grows where ======
   trees: [weight, kind] lists; count: trees per chunk; plants: per chunk
   tries of [block, chance]; flowers: the biome's flowers. */
const FLOWERS_PLAINS = ['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip'];
const FLOWERS_FOREST = ['dandelion', 'poppy', 'lily_of_the_valley', 'lilac', 'rose_bush', 'peony'];
const FLOWERS_ALL = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'lilac', 'rose_bush', 'peony'];
const FLOWERS_MEADOW = ['dandelion', 'poppy', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'tall_grass'];
const FEAT = {
  plains: { trees: [[2, 'oak'], [1, 'fancy_oak']], count: 0.05, grass: 110, tall: 7, flowers: FLOWERS_PLAINS, flowerN: 4 },
  sunflower_plains: { trees: [[2, 'oak'], [1, 'fancy_oak']], count: 0.05, grass: 110, tall: 7, flowers: FLOWERS_PLAINS, flowerN: 4, sunflowers: 6 },
  meadow: { trees: [[1, 'fancy_oak'], [1, 'tall_birch']], count: 0.01, grass: 110, tall: 12, flowers: FLOWERS_MEADOW, flowerN: 16 },
  cherry_grove: { trees: [[1, 'cherry']], count: 10.1, grass: 100, tall: 6, flowers: ['pink_tulip', 'pink_tulip', 'peony'], flowerN: 6 },
  forest: { trees: [[72, 'oak'], [8, 'fancy_oak'], [20, 'birch']], count: 10.1, grass: 24, tall: 1, flowers: FLOWERS_FOREST, flowerN: 2 },
  flower_forest: { trees: [[72, 'oak'], [8, 'fancy_oak'], [20, 'birch']], count: 6.1, grass: 12, flowers: FLOWERS_ALL, flowerN: 28 },
  birch_forest: { trees: [[1, 'birch']], count: 10.1, grass: 24, flowers: FLOWERS_FOREST, flowerN: 2 },
  old_growth_birch_forest: { trees: [[1, 'tall_birch'], [1, 'birch']], count: 10.1, grass: 24, flowers: FLOWERS_FOREST, flowerN: 2 },
  dark_forest: { trees: [[618, 'dark_oak'], [222, 'oak'], [62, 'birch'], [25, 'fancy_oak'], [74, 'mushroom']], count: 16, grass: 24, mushrooms: 0.3 },
  taiga: { trees: [[1, 'pine'], [2, 'spruce']], count: 10.1, grass: 3, ferns: 10, berries: 0.03, mushrooms: 0.25 },
  snowy_taiga: { trees: [[1, 'pine'], [2, 'spruce']], count: 10.1, grass: 2, ferns: 8, mushrooms: 0.25 },
  old_growth_pine_taiga: { trees: [[45, 'spruce'], [30, 'mega_spruce'], [22, 'pine'], [3, 'mega_spruce']], count: 10.1, grass: 18, ferns: 60, boulders: 0.8, podzol: true, mushrooms: 0.6, deadBush: 1 },
  old_growth_spruce_taiga: { trees: [[44, 'spruce'], [33, 'mega_spruce'], [22, 'pine']], count: 10.1, grass: 18, ferns: 60, boulders: 0.8, podzol: true, mushrooms: 0.6, deadBush: 1 },
  savanna: { trees: [[4, 'acacia'], [1, 'oak']], count: 1.1, grass: 240, tall: 7, flowers: ['poppy', 'poppy', 'dandelion'], flowerN: 1 },
  savanna_plateau: { trees: [[4, 'acacia'], [1, 'oak']], count: 1.1, grass: 240, tall: 7, flowers: ['poppy', 'poppy', 'dandelion'], flowerN: 1 },
  windswept_savanna: { trees: [[4, 'acacia'], [1, 'oak']], count: 2.1, grass: 60 },
  desert: { cactus: 0.5, deadBush: 2, sugarCane: 1, grass: 4 },
  badlands: { deadBush: 20, cactus: 0.3, grass: 4, sugarCane: 0.2 },
  eroded_badlands: { deadBush: 20, cactus: 0.3, grass: 4, sugarCane: 0.2 },
  wooded_badlands: { trees: [[1, 'oak']], count: 5.1, deadBush: 20, grass: 4 },
  jungle: { trees: [[45, 'jungle_bush'], [30, 'jungle'], [15, 'mega_jungle'], [10, 'fancy_oak']], count: 50.1, grass: 220, ferns: 70, melons: 0.17, flowers: ['poppy', 'dandelion'], flowerN: 1 },
  sparse_jungle: { trees: [[45, 'jungle'], [45, 'jungle_bush'], [10, 'fancy_oak']], count: 2.1, grass: 220, ferns: 70, melons: 0.02 },
  bamboo_jungle: { trees: [[57, 'mega_jungle'], [14, 'jungle_bush'], [5, 'fancy_oak']], count: 30.1, grass: 220, ferns: 70, melons: 0.17 },
  swamp: { trees: [[1, 'swamp_oak']], count: 2.1, grass: 60, lilyPads: 4, mushrooms: 0.6, sugarCane: 3, seagrass: 38, flowers: ['blue_orchid'], flowerN: 1, deadBush: 1 },
  mangrove_swamp: { trees: [[1, 'mangrove']], count: 25, grass: 60, lilyPads: 4, seagrass: 30, deadBush: 1 },
  windswept_hills: { trees: [[67, 'spruce'], [30, 'oak'], [3, 'fancy_oak']], count: 0.1, grass: 12, flowers: FLOWERS_PLAINS, flowerN: 1 },
  windswept_gravelly_hills: { trees: [[67, 'spruce'], [30, 'oak'], [3, 'fancy_oak']], count: 0.1, grass: 12 },
  windswept_forest: { trees: [[67, 'spruce'], [30, 'oak'], [3, 'fancy_oak']], count: 3.1, grass: 12 },
  snowy_plains: { trees: [[1, 'spruce']], count: 0.1, grass: 6 },
  ice_spikes: { trees: [[1, 'spruce']], count: 0.1, spikes: 3 },
  grove: { trees: [[2, 'spruce'], [1, 'pine']], count: 10.1, grass: 0 },
  mushroom_fields: { hugeMushrooms: 1, mushrooms: 1 },
  river: { seagrass: 48, sugarCane: 3 },
  frozen_river: {},
  beach: { sugarCane: 1, grass: 4 }, snowy_beach: {}, stony_shore: { grass: 4 },
  ocean: { seagrass: 48, kelp: 10 }, deep_ocean: { seagrass: 48, kelp: 12 },
  cold_ocean: { seagrass: 32, kelp: 14 }, deep_cold_ocean: { seagrass: 40, kelp: 14 },
  lukewarm_ocean: { seagrass: 80, kelp: 8 }, deep_lukewarm_ocean: { seagrass: 80, kelp: 10 },
  warm_ocean: { seagrass: 80 },
};

/* ======================================================== the generator == */
export class Gen {
  constructor(seed) {
    this.seed = seed | 0;
    const S = this.seed;
    // climate (first octave, amplitudes), the game's own shapes
    this.nTemp = new NormalNoise(S, 'temperature', -10, [1.5, 0, 1, 0, 0, 0]);
    this.nHum = new NormalNoise(S, 'vegetation', -8, [1, 1, 0, 0, 0, 0]);
    this.nCont = new NormalNoise(S, 'continentalness', -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    this.nEro = new NormalNoise(S, 'erosion', -9, [1, 1, 0, 1, 1]);
    this.nWeird = new NormalNoise(S, 'ridge', -7, [1, 2, 1, 0, 0, 0]);
    this.nShift = new NormalNoise(S, 'offset', -3, [1, 1, 1, 0]);
    this.nJag = new NormalNoise(S, 'jagged', -16, new Array(16).fill(1));
    // the 3D body of the land
    this.nBase = new NormalNoise(S, 'base_3d', -7, [1, 1, 1, 1, 0.5]);
    // caves
    this.nCheese = new NormalNoise(S, 'cave_cheese', -8, [0.5, 1, 2, 1, 2, 1, 0, 2, 0]);
    this.nSpag1 = new NormalNoise(S, 'spaghetti_3d_1', -7, [1]);
    this.nSpag2 = new NormalNoise(S, 'spaghetti_3d_2', -7, [1]);
    this.nSpagRare = new NormalNoise(S, 'spaghetti_3d_rarity', -11, [1]);
    this.nSpagThick = new NormalNoise(S, 'spaghetti_3d_thickness', -8, [1]);
    this.nRough = new NormalNoise(S, 'spaghetti_roughness', -5, [1]);
    this.nEntrance = new NormalNoise(S, 'cave_entrance', -7, [0.4, 0.5, 1]);
    this.nNoodle = new NormalNoise(S, 'noodle', -8, [1]);
    this.nNoodleA = new NormalNoise(S, 'noodle_ridge_a', -7, [1]);
    this.nNoodleB = new NormalNoise(S, 'noodle_ridge_b', -7, [1]);
    this.nLayer = new NormalNoise(S, 'cave_layer', -8, [1]);
    this.nNoodleThick = new NormalNoise(S, 'noodle_thickness', -8, [1]);
    this.lattice = new Map();             // lattice columns already worked out (for placing trees)
    this.treeCache = new Map();           // each chunk's own trees, before its neighbours are counted
    // surfaces
    this.nSurf = new NormalNoise(S, 'surface', -6, [1, 1, 1]);
    this.nSurf2 = new NormalNoise(S, 'surface_secondary', -6, [1, 1, 0, 1]);
    this.nClay = new NormalNoise(S, 'clay_bands_offset', -8, [1]);
    this.nPatch = new NormalNoise(S, 'patch', -5, [1, 0, 0, 0, 0, 0.013]);
    this.nIce = new NormalNoise(S, 'ice', -4, [1, 1, 1, 1]);
    // badlands bands: a fixed shuffle of colours by height, as the game does
    const r = rng(mix32(S ^ 0x5eed));
    this.bands = new Uint16Array(192).fill(B.terracotta);
    const put = (blk, n, w) => { for (let i = 0; i < n; i++) { const y0 = r.int(192); for (let k = 0; k < w + r.int(2) && y0 + k < 192; k++) this.bands[y0 + k] = blk; } };
    put(B.orange_terracotta, 18, 1); put(B.yellow_terracotta, 6, 1); put(B.brown_terracotta, 6, 1);
    put(B.red_terracotta, 8, 1); put(B.white_terracotta, 4, 0); put(B.light_gray_terracotta, 4, 1);
  }

  /* ---- climate at a block column ---- */
  climate(x, z) {
    const sx = x * 0.25 + this.nShift.sample(x * 0.25, 0, z * 0.25) * 4;
    const sz = z * 0.25 + this.nShift.sample(z * 0.25, x * 0.25, 0) * 4;
    const T = this.nTemp.sample(sx, 0, sz), Hu = this.nHum.sample(sx, 0, sz);
    const C = this.nCont.sample(sx, 0, sz), E = this.nEro.sample(sx, 0, sz), W = this.nWeird.sample(sx, 0, sz);
    const PV = -(Math.abs(Math.abs(W) - 2 / 3) - 1 / 3) * 3;
    return { T, Hu, C, E, W, PV };
  }
  shape(cl) {
    const ctx = { c: cl.C, e: cl.E, pv: cl.PV };
    return { offset: evalSpline(OFFSET, ctx), factor: evalSpline(FACTOR, ctx), jag: jaggedness(cl.C, cl.E, cl.PV, cl.W) };
  }
  // the land's density at a block (before caves): above zero is ground
  density(x, y, z, sh) {
    const ymc = y + Y0;
    const grad = 1.5 - 3 * (ymc + 64) / 384;
    let jag = 0;
    if (sh.jag > 0) { const j = this.nJag.sample(x * 1500, 0, z * 1500); jag = sh.jag * (j < 0 ? j * 0.5 : j); }
    let d = (grad + sh.offset - 0.50375 + jag) * sh.factor;
    d = (d < 0 ? d * 0.25 : d) * 4;
    d += this.nBase.sample(x, ymc * 0.5, z) * 0.4;
    // the world closes off at the bottom and fades out at the top
    if (ymc < -56) d = lerp(1.5, d, (ymc + 64) / 8);
    if (ymc > 240) d = lerp(d, -0.078125, Math.min(1, (ymc - 240) / 16));
    return d;
  }
  /* The density with the caves cut in, as the game combines them: near the
     surface only cave entrances break through; deeper down the cheese caves,
     spaghetti tunnels and noodles all do. */
  final(x, y, z, d) {
    if (d <= 0) return d;
    const ymc = y + Y0;
    if (ymc < -58) return d;
    const rare = this.nSpagRare.sample(x * 2, ymc, z * 2);
    const sc = rare < -0.5 ? 0.75 : rare < 0 ? 1 : rare < 0.5 ? 1.5 : 2;
    const thick = lerp(-0.065, -0.088, (this.nSpagThick.sample(x, ymc, z) + 1) / 2);
    const s1 = Math.abs(this.nSpag1.sample(x / sc, ymc / sc, z / sc)) * sc;
    const s2 = Math.abs(this.nSpag2.sample(x / sc, ymc / sc, z / sc)) * sc;
    const rough = (-0.05 - 0.05 * this.nRough.sample(x * 0.5, ymc * 0.5, z * 0.5)) * (-0.4 + Math.abs(this.nRough.sample(x, ymc, z)));
    const spag = Math.max(s1, s2) + thick + rough;
    const ent = 0.37 + this.nEntrance.sample(x * 0.75, ymc * 0.5, z * 0.75) + 0.3 * (1 - smooth(-10, 30, ymc));
    const entr = Math.min(ent, spag);
    let out;
    if (d < 1.5625) out = Math.min(d, 5 * entr);
    else {
      const cheese = this.nCheese.sample(x, ymc / 1.5, z);
      const layer = this.nLayer.sample(x, ymc * 8, z);
      const c = 0.27 + clamp(cheese, -1, 1) + clamp(1.5 - 0.64 * d, 0, 0.5) + 4 * layer * layer;
      out = Math.min(Math.min(c, ent), spag);
    }
    // noodles: thin and twisting
    if (this.nNoodle.sample(x, ymc, z) >= 0) {
      const a = Math.abs(this.nNoodleA.sample(x * 2.6667, ymc * 2.6667, z * 2.6667));
      const b = Math.abs(this.nNoodleB.sample(x * 2.6667, ymc * 2.6667, z * 2.6667));
      const t = lerp(-0.05, -0.1, (this.nNoodleThick.sample(x, ymc, z) + 1) / 2);
      out = Math.min(out, 1.5 * Math.max(a, b) + t);
    }
    return out;
  }

  /* ---- one lattice column (every 4 blocks), kept, for placing things ---- */
  column(x, z) {
    const k = x + ',' + z;
    let c = this.lattice.get(k);
    if (c) return c;
    if (this.lattice.size > 40000) this.lattice.clear();
    const sh = this.shape(this.climate(x, z));
    c = { sh, d: new Float32Array(H / 8 + 1).fill(NaN) };
    this.lattice.set(k, c);
    return c;
  }
  latticeD(c, x, z, k) {
    let v = c.d[k];
    if (v !== v) v = c.d[k] = this.density(x, k * 8, z, c.sh);
    return v;
  }
  /* The ground's height at a column, worked out the same way the chunk is
     filled (between the same lattice points), so a tree put down from a
     neighbouring chunk stands exactly on the ground this chunk will make. */
  surfaceAt(x, z) {
    const xi = Math.floor(x / 4) * 4, zi = Math.floor(z / 4) * 4;
    const fx = (x - xi) / 4, fz = (z - zi) / 4;
    const c00 = this.column(xi, zi), c10 = this.column(xi + 4, zi), c01 = this.column(xi, zi + 4), c11 = this.column(xi + 4, zi + 4);
    const off = (c00.sh.offset + c10.sh.offset + c01.sh.offset + c11.sh.offset) / 4;
    const est = Math.round((0.99625 + off) * 128);
    const kHi = Math.min(H / 8, Math.floor((est + 72) / 8) + 1), kLo = Math.max(0, Math.floor((est - 48) / 8));
    const at = k => lerp(lerp(this.latticeD(c00, xi, zi, k), this.latticeD(c10, xi + 4, zi, k), fx),
                         lerp(this.latticeD(c01, xi, zi + 4, k), this.latticeD(c11, xi + 4, zi + 4, k), fx), fz);
    let above = at(kHi);
    for (let k = kHi - 1; k >= kLo; k--) {
      const here = at(k);
      if (here > 0 || above > 0) {
        for (let y = k * 8 + 7; y >= k * 8; y--) {
          const v = lerp(here, above, (y - k * 8) / 8);
          if (v > 0) return y;
        }
      }
      above = here;
    }
    return -1;
  }

  /* ---- a whole chunk ---- */
  generate(cx, cz) {
    const blocks = new Uint16Array(VOL), meta = new Uint8Array(VOL), biome = new Uint8Array(256);
    const x0 = cx * CH, z0 = cz * CH;
    // the coarse lattice: 5 x 5 columns, every 8 blocks up
    const NY = H / 8 + 1;
    const dens = new Float32Array(25 * NY), fin = new Float32Array(25 * NY);
    const clim = [];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const wx = x0 + i * 4, wz = z0 + j * 4;
      const col = this.column(wx, wz);
      clim.push(this.climate(wx, wz));
      for (let k = 0; k < NY; k++) {
        const d = this.latticeD(col, wx, wz, k);
        dens[(j * 5 + i) * NY + k] = d;
        fin[(j * 5 + i) * NY + k] = d > 0 ? this.final(wx, k * 8, wz, d) : d;
      }
    }
    // biomes on a 4 x 4 grid, with Minecraft's ragged edges between them
    const bq = new Uint8Array(25);
    for (let n = 0; n < 25; n++) bq[n] = pickBiome(clim[n]);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const jx = x + (hash3(this.seed, x0 + x, 7, z0 + z) - 0.5) * 3.2;
      const jz = z + (hash3(this.seed, x0 + x, 11, z0 + z) - 0.5) * 3.2;
      const i = clamp(Math.round(jx / 4), 0, 4), j = clamp(Math.round(jz / 4), 0, 4);
      biome[(z << 4) | x] = bq[j * 5 + i];
    }
    // fill: trilinear between the lattice points
    const surf = new Int16Array(256).fill(-1);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = x >> 2, j = z >> 2, fx = (x & 3) / 4, fz = (z & 3) / 4;
      const c00 = (j * 5 + i) * NY, c10 = (j * 5 + i + 1) * NY, c01 = ((j + 1) * 5 + i) * NY, c11 = ((j + 1) * 5 + i + 1) * NY;
      const at = (arr, k) => lerp(lerp(arr[c00 + k], arr[c10 + k], fx), lerp(arr[c01 + k], arr[c11 + k], fx), fz);
      const col = (z << 4) | x;
      for (let y = H - 1; y >= 0; y--) {
        const k = y >> 3, fy = (y & 7) / 8;
        const d = lerp(at(dens, k), at(dens, k + 1), fy);
        const i3 = idx(x, y, z);
        if (d > 0) {
          if (surf[col] < 0) surf[col] = y;
          const f = lerp(at(fin, k), at(fin, k + 1), fy);
          // a cave never opens into the sea floor (the water would have nowhere to be)
          if (f <= 0 && !(surf[col] < SEA + 2 && y > surf[col] - 8)) blocks[i3] = y + Y0 < -54 ? B.lava : 0;
          else blocks[i3] = B.stone;
        } else if (y <= SEA && surf[col] < 0) {
          blocks[i3] = B.water;
        }
      }
    }
    this.surface(blocks, biome, x0, z0);
    this.underground(blocks, x0, z0, cx, cz);
    this.decorate(blocks, meta, biome, cx, cz);
    this.freeze(blocks, biome, x0, z0);
    let top = 0;
    for (let i = VOL - 1; i >= 0; i--) if (blocks[i]) { top = i >> 8; break; }
    return { blocks, meta, biome, top };
  }

  /* ---- surface rules ----
     Only the ground open to the sky gets them (and the floor under water):
     caves keep their stone, as the game's "above the preliminary surface"
     condition does. */
  surface(blocks, biome, x0, z0) {
    const S = this.seed;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = (z << 4) | x;
      const wx = x0 + x, wz = z0 + z;
      const bn = BIOMES[biome[col]].name;
      const sn = this.nSurf.sample(wx, 0, wz);
      const depth = 3 + Math.floor(sn * 2.75 + 0.5 + hash3(S, wx, 1, wz) * 0.25);
      let d = -1, wet = false;
      for (let y = H - 1; y >= 1; y--) {
        const i = idx(x, y, z);
        const b = blocks[i];
        if (b !== B.stone) {
          if (b === B.water) { wet = true; continue; }
          if (d >= 0) break;                    // below the top run: a cave
          continue;
        }
        d++;
        const pick = this.surfaceBlock(bn, d, depth, y + Y0, wet || y < SEA, sn, wx, wz);
        if (pick === null) { if (d > depth + 8) break; continue; }
        blocks[i] = pick;
        if (d > 70) break;
      }
    }
  }
  surfaceBlock(bn, d, depth, ymc, wet, sn, wx, wz) {
    const steep = false;
    const top = d === 0;
    const under = d > 0 && d <= depth;
    const sandstoneUnder = d > depth && d <= depth + 3 + (sn > 0 ? 3 : 0);
    const S = B;
    switch (bn) {
      case 'desert':
        return top || under ? S.sand : sandstoneUnder ? S.sandstone : null;
      case 'beach': case 'snowy_beach':
        if (ymc < 56) return top || under ? S.sand : null;
        return top || under ? S.sand : sandstoneUnder ? S.sandstone : null;
      case 'stony_shore': return top ? (sn > 0.4 ? S.gravel : S.stone) : null;
      case 'badlands': case 'eroded_badlands': case 'wooded_badlands': {
        if (d > 20) return null;
        if (bn === 'wooded_badlands' && ymc > 97 && top) return S.coarse_dirt;
        if (top && ymc < 74 && !wet) return S.red_sand;
        if (under && ymc < 70) return S.red_sandstone;
        const band = this.bands[((ymc + 64 + Math.round(this.nClay.sample(wx, 0, wz) * 4)) % 192 + 192) % 192];
        return band;
      }
      case 'mushroom_fields': return top ? (wet ? S.dirt : S.mycelium) : under ? S.dirt : null;
      case 'old_growth_pine_taiga': case 'old_growth_spruce_taiga':
        if (top && !wet) return sn > 0.2 ? S.coarse_dirt : sn > -0.95 && sn < -0.2 ? S.podzol : S.grass_block;
        return under ? S.dirt : null;
      case 'frozen_peaks': case 'jagged_peaks':
        if (top) return bn === 'frozen_peaks' && sn > 0.4 ? S.packed_ice : S.snow_block;
        if (under && d < 2) return S.snow_block;
        return null;
      case 'snowy_slopes':
        if (top) return sn > 0.45 ? S.powder_snow : S.snow_block;
        if (under && d < 2) return S.snow_block;
        return null;
      case 'stony_peaks':
        if (top) return sn > 0.25 ? S.calcite : S.stone;
        return null;
      case 'windswept_gravelly_hills':
        if (top) return sn > 0.15 ? S.gravel : sn < -0.3 ? S.stone : S.grass_block;
        return under ? (sn > 0.15 ? S.gravel : S.dirt) : null;
      case 'windswept_hills':
        if (top) return sn > 0.45 ? S.stone : S.grass_block;
        return under ? S.dirt : null;
      case 'river': case 'frozen_river':
        if (wet) return top || under ? (sn > 0.3 ? S.gravel : S.sand) : null;
        return top ? S.grass_block : under ? S.dirt : null;
      case 'swamp': case 'mangrove_swamp':
        if (bn === 'mangrove_swamp') return top || under ? (wet || sn > 0 ? S.mud : S.grass_block) : null;
        if (wet) return top ? (sn > 0.4 ? S.clay : S.dirt) : under ? S.dirt : null;
        return top ? S.grass_block : under ? S.dirt : null;
    }
    if (bn.indexOf('ocean') >= 0) {
      if (!(top || under)) return null;
      if (bn.indexOf('warm') >= 0 || bn.indexOf('lukewarm') >= 0) return S.sand;
      if (bn.startsWith('deep') || bn.indexOf('cold') >= 0 || bn.indexOf('frozen') >= 0) return top && sn > 0.5 ? S.clay : S.gravel;
      return sn > 0.35 ? S.gravel : S.sand;
    }
    // everything else: grass over dirt (dirt when under water), stone under that
    if (top) return wet ? (sn > 0.6 ? S.gravel : sn < -0.6 ? S.clay : S.dirt) : S.grass_block;
    if (under) return S.dirt;
    return null;
  }

  /* ---- deepslate, bedrock, the stone blobs and the ores ---- */
  underground(blocks, x0, z0, cx, cz) {
    const S = this.seed;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z;
      for (let y = 0; y < 80; y++) {
        const i = idx(x, y, z);
        const ymc = y + Y0;
        if (ymc <= -60 && (ymc === -64 || hash3(S, wx, y, wz) < (-59 - ymc) / 5)) { blocks[i] = B.bedrock; continue; }
        if (blocks[i] === B.stone && (ymc < 0 || (ymc < 8 && hash3(S ^ 3, wx, y, wz) < (8 - ymc) / 8))) blocks[i] = B.deepslate;
      }
    }
    const r = rng(mix32(S ^ Math.imul(cx, 341873128) ^ Math.imul(cz, 132897987)));
    const blob = (ore, count, size, ymin, ymax, tri, deepOre) => {
      for (let n = 0; n < count; n++) {
        let ymc = tri ? Math.round((ymin + ymax) / 2 + (r() + r() - 1) * (ymax - ymin) / 2) : ymin + r.int(ymax - ymin + 1);
        const y = ymc - Y0;
        if (y < 1 || y >= H - 1) continue;
        const bx = r.int(16), bz = r.int(16);
        const rad = Math.max(0.6, Math.cbrt(size) * 0.62);
        const ax = (r() - 0.5) * size * 0.25, az = (r() - 0.5) * size * 0.25;
        for (let s = 0; s < size; s++) {
          const t = s / Math.max(1, size - 1);
          const px = bx + ax * (t - 0.5), pz = bz + az * (t - 0.5), py = y + (r() - 0.5) * 2;
          const R = rad * (0.6 + r() * 0.5);
          for (let dx = Math.floor(px - R); dx <= px + R; dx++) for (let dy = Math.floor(py - R); dy <= py + R; dy++) for (let dz = Math.floor(pz - R); dz <= pz + R; dz++) {
            if (dx < 0 || dx > 15 || dz < 0 || dz > 15 || dy < 1 || dy >= H) continue;
            if ((dx - px) ** 2 + (dy - py) ** 2 + (dz - pz) ** 2 > R * R) continue;
            const i = idx(dx, dy, dz), b = blocks[i];
            if (b === B.stone) blocks[i] = ore;
            else if (b === B.deepslate) blocks[i] = deepOre !== undefined ? deepOre : ore;
          }
        }
      }
    };
    blob(B.dirt, 7, 33, 0, 160, false, B.dirt);
    blob(B.gravel, 7, 33, -64, 320, false, B.gravel);
    blob(B.granite, 2, 64, 0, 60, false, B.stone);
    blob(B.diorite, 2, 64, 0, 60, false, B.stone);
    blob(B.andesite, 2, 64, 0, 60, false, B.stone);
    blob(B.tuff, 2, 64, -64, 0, false, B.tuff);
    blob(B.coal_ore, 20, 17, 0, 192, true, B.deepslate_coal_ore);
    blob(B.coal_ore, 15, 17, 136, 320, false, B.deepslate_coal_ore);
    blob(B.iron_ore, 10, 9, -24, 56, true, B.deepslate_iron_ore);
    blob(B.iron_ore, 6, 9, 80, 200, true, B.deepslate_iron_ore);
    blob(B.iron_ore, 10, 4, -64, 72, false, B.deepslate_iron_ore);
    blob(B.copper_ore, 16, 10, -16, 112, true, B.deepslate_copper_ore);
    blob(B.gold_ore, 4, 9, -64, 32, true, B.deepslate_gold_ore);
    blob(B.redstone_ore, 4, 8, -64, 15, false, B.deepslate_redstone_ore);
    blob(B.redstone_ore, 8, 8, -96, -32, true, B.deepslate_redstone_ore);
    blob(B.lapis_ore, 2, 7, -32, 32, true, B.deepslate_lapis_ore);
    blob(B.lapis_ore, 4, 7, -64, 64, false, B.deepslate_lapis_ore);
    blob(B.diamond_ore, 7, 4, -144, 16, true, B.deepslate_diamond_ore);
    blob(B.diamond_ore, 2, 8, -144, 16, true, B.deepslate_diamond_ore);
  }

  /* ---- trees and plants, from this chunk and the eight around it ---- */
  decorate(blocks, meta, biome, cx, cz) {
    const x0 = cx * CH, z0 = cz * CH;
    const inside = (x, y, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16 && y >= 0 && y < H;
    const get = (x, y, z) => inside(x, y, z) ? blocks[idx(x - x0, y, z - z0)] : -1;
    const set = (x, y, z, b, onlyAir) => {
      if (!inside(x, y, z)) return;
      const i = idx(x - x0, y, z - z0);
      const cur = blocks[i];
      if (onlyAir && cur !== 0 && !BLOCKS[cur].replaceable) return;
      if (BLOCKS[cur] && BLOCKS[cur].log && BLOCKS[b].leaves) return;
      // a tall plant a neighbour's tree grows into goes whole, so no half of it is left on the leaves
      const d = BLOCKS[cur];
      if (d && cur !== b && d.upper && y + 1 < H && blocks[i + 256] === B[d.upper]) blocks[i + 256] = 0;
      if (d && cur !== b && d.lower && y > 0 && blocks[i - 256] === B[d.lower]) blocks[i - 256] = 0;
      blocks[i] = b;
      if (b === B.water) meta[i] = 0;
    };
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      this.featuresOf(cx + dx, cz + dz, set, get, dx === 0 && dz === 0 ? biome : null);
    }
  }
  featuresOf(cx, cz, set, get, ownBiome) {
    const S = this.seed;
    const r = rng(mix32(S ^ Math.imul(cx, 0x632be5ab) ^ Math.imul(cz, 0x85157af5) ^ 0x7ee5));
    const x0 = cx * CH, z0 = cz * CH;
    const biomeAt = (x, z) => {
      if (ownBiome) return ownBiome[((z - z0) << 4) | (x - x0)];
      return pickBiome(this.climate(Math.floor(x / 4) * 4, Math.floor(z / 4) * 4));
    };
    const centre = BIOMES[pickBiome(this.climate(x0 + 8, z0 + 8))].name;
    const F = FEAT[centre] || {};
    const ground = (x, z) => {
      // the real ground where this chunk has it, the estimate where it does not
      const g = get(x, 0, z);
      if (g >= 0) {
        for (let y = H - 2; y > 0; y--) {
          const b = get(x, y, z);
          if (b && b !== B.water && !BLOCKS[b].replaceable && !BLOCKS[b].leaves) return y;
          if (b === B.water) return -2;
        }
        return -1;
      }
      const y = this.surfaceAt(x, z);
      return y >= 0 && y < SEA ? -2 : y;
    };
    const soilOK = (x, y, z) => {
      const b = get(x, y, z);
      return b === -1 || b === B.grass_block || b === B.dirt || b === B.podzol || b === B.coarse_dirt || b === B.mud || b === B.moss_block;
    };
    // trees: where they stand is worked out the same way from every chunk
    // that can see them, so a canopy over an edge always has its trunk
    for (const t of this.treesOf(cx, cz)) {
      // the same random stream the spot and the kind were drawn from, so the shape matches everywhere
      const tr = this.treeRng(cx, cz, t.t);
      tr.int(16); tr.int(16); pickWeighted(tr, F.trees);
      this.tree(t.kind, set, tr, t.x, t.y, t.z);
    }
    if (F.spikes) for (let s = 0; s < F.spikes; s++) {
      const x = x0 + r.int(16), z = z0 + r.int(16), y = ground(x, z);
      if (y > 0 && r() < 0.6) iceSpike(set, r, x, y + 1, z);
    }
    if (F.boulders && r() < F.boulders) {
      const x = x0 + r.int(16), z = z0 + r.int(16), y = ground(x, z);
      if (y > 0) boulder(set, r, x, y + 1, z);
    }
    if (F.hugeMushrooms && r() < 0.5) {
      const x = x0 + r.int(16), z = z0 + r.int(16), y = ground(x, z);
      if (y > 0) {
        const red = r() < 0.5, h = 5 + r.int(3);
        for (let i = 0; i < h; i++) set(x, y + 1 + i, z, B.oak_log);
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) set(x + dx, y + h + 1, z + dz, red ? B.red_terracotta : B.brown_terracotta, true);
      }
    }
    // the plants only for this chunk's own ground (they never cross an edge)
    if (!ownBiome) return;
    const plantAt = (x, z, block, onlyGrass) => {
      const y = ground(x, z);
      if (y < 0) return;
      const g = get(x, y, z);
      if (g !== B.grass_block && (onlyGrass || (g !== B.dirt && g !== B.podzol && g !== B.coarse_dirt && g !== B.sand && g !== B.red_sand && g !== B.moss_block))) return;
      // ferns need soil (sand is for the dead bushes)
      if ((g === B.sand || g === B.red_sand) && (block === B.fern || block === B.large_fern)) return;
      if (get(x, y + 1, z) !== 0) return;
      const d = BLOCKS[block];
      if (d.upper) { if (get(x, y + 2, z) !== 0) return; set(x, y + 1, z, block); set(x, y + 2, z, B[d.upper]); }
      else set(x, y + 1, z, block);
    };
    const rnd = () => [x0 + r.int(16), z0 + r.int(16)];
    for (let k = 0; k < (F.grass || 0); k++) { const [x, z] = rnd(); plantAt(x, z, r() < 0.12 && F.tall !== 0 ? B.tall_grass : B.short_grass, true); }
    for (let k = 0; k < (F.tall || 0); k++) { const [x, z] = rnd(); plantAt(x, z, B.tall_grass, true); }
    for (let k = 0; k < (F.ferns || 0); k++) { const [x, z] = rnd(); plantAt(x, z, r() < 0.25 ? B.large_fern : B.fern, false); }
    if (F.flowers) {
      // flowers grow in patches
      for (let p = 0; p < Math.ceil((F.flowerN || 1) / 4); p++) {
        const fl = F.flowers[r.int(F.flowers.length)];
        const [px, pz] = rnd();
        for (let k = 0; k < Math.min(F.flowerN || 1, 8) + 2; k++) {
          const x = px + r.int(7) - 3, z = pz + r.int(7) - 3;
          if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
          plantAt(x, z, B[fl], true);
        }
      }
    }
    if (F.sunflowers) for (let k = 0; k < F.sunflowers; k++) { const [x, z] = rnd(); plantAt(x, z, B.sunflower, true); }
    for (let k = 0; k < (F.deadBush || 0); k++) { const [x, z] = rnd(); plantAt(x, z, B.dead_bush, false); }
    if (F.berries && r() < F.berries) { const [x, z] = rnd(); plantAt(x, z, B.sweet_berry_bush, true); }
    if (F.mushrooms && r() < F.mushrooms) { const [x, z] = rnd(); plantAt(x, z, r() < 0.5 ? B.brown_mushroom : B.red_mushroom, false); }
    if (F.melons && r() < F.melons) { const [x, z] = rnd(); plantAt(x, z, B.melon, true); }
    if (r() < 0.03 && (centre === 'plains' || centre.indexOf('taiga') >= 0)) { const [x, z] = rnd(); plantAt(x, z, B.pumpkin, true); }
    for (let k = 0; k < (F.cactus || 0) * 2; k++) {
      const [x, z] = rnd(); const y = ground(x, z);
      if (y < 0 || get(x, y, z) !== B.sand && get(x, y, z) !== B.red_sand) continue;
      let ok = true;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + ax, y + 1, z + az) !== 0) ok = false;
      if (!ok || r() < 0.5) continue;
      const h = 1 + r.int(3);
      for (let i = 1; i <= h; i++) set(x, y + i, z, B.cactus);
    }
    // sugar cane, beside water
    for (let k = 0; k < (F.sugarCane || 0) * 4 + 2; k++) {
      const [x, z] = rnd(); const y = ground(x, z);
      if (y < 0) continue;
      const g = get(x, y, z);
      if (g !== B.grass_block && g !== B.sand && g !== B.dirt) continue;
      let water = false;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + ax, y, z + az) === B.water) water = true;
      if (!water) continue;
      const h = 1 + r.int(3);
      for (let i = 1; i <= h; i++) if (get(x, y + i, z) === 0) set(x, y + i, z, B.sugar_cane);
    }
    // under the water: seagrass and kelp on the floor, lily pads on the top
    // (the seagrass and kelp already down are looked through, so nothing grows on top of them)
    const wet = b => b === B.water || b === B.seagrass || b === B.tall_seagrass || b === B.tall_seagrass_top_block || b === B.kelp || b === B.kelp_plant;
    const floorAt = (x, z) => {
      for (let y = SEA; y > 1; y--) { const b = get(x, y, z); if (!wet(b)) return b > 0 && b !== B.lava && BLOCKS[b].solid && BLOCKS[b].shape === 'cube' ? y : -1; }
      return -1;
    };
    for (let k = 0; k < (F.seagrass || 0); k++) {
      const [x, z] = rnd(); const y = floorAt(x, z);
      if (y < 0 || get(x, y + 1, z) !== B.water || get(x, y + 2, z) !== B.water) continue;
      if (r() < 0.25 && get(x, y + 3, z) === B.water) { set(x, y + 1, z, B.tall_seagrass); set(x, y + 2, z, B.tall_seagrass_top_block); }
      else set(x, y + 1, z, B.seagrass);
    }
    for (let k = 0; k < (F.kelp || 0); k++) {
      const [x, z] = rnd(); const y = floorAt(x, z);
      if (y < 0) continue;
      const h = 1 + r.int(Math.max(1, SEA - y - 2));
      if (get(x, y + 1, z) !== B.water) continue;
      let i = 1;
      for (; i < h && get(x, y + i + 1, z) === B.water; i++) set(x, y + i, z, B.kelp_plant);
      if (get(x, y + i, z) === B.water) set(x, y + i, z, B.kelp);
    }
    for (let k = 0; k < (F.lilyPads || 0); k++) {
      const [x, z] = rnd();
      if (get(x, SEA, z) === B.water && get(x, SEA + 1, z) === 0) set(x, SEA + 1, z, B.lily_pad);
    }
  }
  /* Where a chunk's trees go. The tries per chunk are the game's own counts
     (FEAT), but as in the game a tree is planted on top of whatever is
     already there, leaves too, and a sapling cannot grow on leaves: a try
     that lands under an earlier tree's canopy comes to nothing. That is most
     of what keeps a forest from being solid. Earlier means earlier in the
     same chunk, or in a neighbour that comes before it (north, or west on
     the same row), so every chunk works out the same list. */
  ownTrees(cx, cz) {
    const key = cx + ',' + cz;
    const c = this.treeCache.get(key);
    if (c) return c;
    const S = this.seed, x0 = cx * CH, z0 = cz * CH;
    const centre = BIOMES[pickBiome(this.climate(x0 + 8, z0 + 8))].name;
    const F = FEAT[centre] || {};
    const r = rng(mix32(S ^ Math.imul(cx, 0x632be5ab) ^ Math.imul(cz, 0xcc9e2d51 ^ 0x85157af5) ^ 0x7ee5));
    const out = [];
    if (F.trees) {
      let n = F.count || 0;
      n = Math.floor(n) + (r() < n - Math.floor(n) ? 1 : 0);
      if (!F.count && r() < 0.02) n = 1;          // a lone tree now and then in open land
      const wetOK = centre === 'mangrove_swamp' || centre === 'swamp';
      for (let t = 0; t < n; t++) {
        const tr = this.treeRng(cx, cz, t);
        const x = x0 + tr.int(16), z = z0 + tr.int(16);
        const kind = pickWeighted(tr, F.trees);
        const y = this.surfaceAt(x, z);
        if (y < 0 || (y < SEA && !(wetOK && y >= SEA - 3))) continue;
        const bh = BIOMES[pickBiome(this.climate(x, z))].name;
        if (bh.indexOf('ocean') >= 0 || bh === 'river' || bh === 'beach' || bh === 'desert' || bh.indexOf('peaks') >= 0) continue;
        if (covered(out, x, z)) continue;
        out.push({ t, x, z, y: Math.max(y, wetOK ? SEA : y) + 1, kind, R: CANOPY[kind] || 2 });
      }
    }
    if (this.treeCache.size > 512) this.treeCache.clear();
    this.treeCache.set(key, out);
    return out;
  }
  treesOf(cx, cz) {
    const before = [];
    for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0]]) before.push(...this.ownTrees(cx + dx, cz + dz));
    return this.ownTrees(cx, cz).filter(t => !covered(before, t.x, t.z));
  }
  treeRng(cx, cz, t) { return rng(mix32(this.seed ^ Math.imul(cx, 0x1b873593) ^ Math.imul(cz, 0xcc9e2d51) ^ Math.imul(t + 1, 0x9e3779b9))); }

  tree(kind, set, r, x, y, z) {
    switch (kind) {
      case 'oak': blobTree(set, r, x, y, z, B.oak_log, B.oak_leaves, 4 + r.int(3)); break;
      case 'fancy_oak': fancyOak(set, r, x, y, z); break;
      case 'birch': blobTree(set, r, x, y, z, B.birch_log, B.birch_leaves, 5 + r.int(3)); break;
      case 'tall_birch': blobTree(set, r, x, y, z, B.birch_log, B.birch_leaves, 9 + r.int(6)); break;
      case 'spruce': spruce(set, r, x, y, z, 6 + r.int(4), false); break;
      case 'pine': spruce(set, r, x, y, z, 7 + r.int(5), true); break;
      case 'mega_spruce': megaSpruce(set, r, x, y, z); break;
      case 'jungle': jungleTree(set, r, x, y, z, false); break;
      case 'mega_jungle': jungleTree(set, r, x, y, z, true); break;
      case 'jungle_bush': bush(set, r, x, y, z, B.jungle_log, B.oak_leaves); break;
      case 'acacia': acacia(set, r, x, y, z); break;
      case 'dark_oak': darkOak(set, r, x, y, z); break;
      case 'cherry': cherry(set, r, x, y, z); break;
      case 'mangrove': mangrove(set, r, x, y, z); break;
      case 'swamp_oak': blobTree(set, r, x, y, z, B.oak_log, B.oak_leaves, 5 + r.int(3)); break;
      case 'mushroom': set(x, y, z, r() < 0.5 ? B.brown_mushroom : B.red_mushroom, true); break;
    }
  }

  /* ---- snow and ice where it is cold enough, which gets colder with height ---- */
  freeze(blocks, biome, x0, z0) {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const b = BIOMES[biome[(z << 4) | x]];
      for (let y = H - 2; y > 0; y--) {
        const i = idx(x, y, z), c = blocks[i];
        if (!c) continue;
        const ymc = y + Y0;
        const temp = b.temp - Math.max(0, ymc - 80) * 0.05 / 30 + (hash3(this.seed, x0 + x, 3, z0 + z) - 0.5) * 0.05;
        if (temp >= 0.15) break;
        if (c === B.water) {
          if (y === SEA && (this.nIce.sample(x0 + x, 0, z0 + z) > -0.3 || b.name.indexOf('river') >= 0)) blocks[i] = B.ice;
          break;
        }
        const d = BLOCKS[c];
        if (d.leaves || OPAQUE_TOP(c)) { if (!blocks[i + 256]) blocks[i + 256] = B.snow; }
        break;
      }
    }
  }
}
// how far each kind of tree's leaves reach from its trunk (the ground it shades from new saplings)
const CANOPY = { oak: 2, swamp_oak: 3, birch: 2, tall_birch: 2, fancy_oak: 3, spruce: 2, pine: 1, mega_spruce: 4, jungle: 2,
  mega_jungle: 4, jungle_bush: 2, acacia: 3, dark_oak: 3, cherry: 4, mangrove: 3, mushroom: 0 };
function covered(trees, x, z) {
  for (const t of trees) if (Math.abs(t.x - x) <= t.R && Math.abs(t.z - z) <= t.R) return true;
  return false;
}
function OPAQUE_TOP(b) { const d = BLOCKS[b]; return d && d.shape === 'cube' && d.pass === 'opaque' && b !== B.ice && b !== B.packed_ice; }
function pickWeighted(r, list) {
  let tot = 0;
  for (const [w] of list) tot += w;
  let x = r() * tot;
  for (const [w, k] of list) { if ((x -= w) <= 0) return k; }
  return list[list.length - 1][1];
}
