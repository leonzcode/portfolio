/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: features (decoration).

   After the terrain and carvers, every chunk is decorated: for each of the
   game's 11 decoration steps (lakes, geodes, ores, springs, trees and
   plants, snow...), each feature any biome of the chunk and its neighbours
   lists is placed with its own random generator, seeded from the world
   seed, the chunk and the feature's index in a global order (the game sorts
   every biome's feature list into one list per step). A feature is a
   chain of placement modifiers (count, a random spot in the chunk, a
   height, a biome check, block tests...) and then the feature itself.

   A chunk's features may reach one chunk out. Here each chunk is decorated
   on its own against the finished terrain of its neighbours (the game does
   it in whatever order chunks happen to load, so features of neighbouring
   chunks may see each other there); what it writes is kept, and a chunk
   is assembled from its terrain and the writes of the nine chunks around.

   Written from the game's behaviour and data (worldgen JSON of 26.3), and
   checked against chunks the real server made. Feature kinds are
   registered in FEATURES; ones not written yet place nothing.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { BIO, BIOMES } from '../biomes.js?v=107';
import { Xoroshiro, WorldgenXoroshiro, LegacyRandom, decorationSeed, featureSeed } from './random.js?v=107';
import { Simplex, normalNoise } from './noise.js?v=107';
import { msin, mcos } from './carvers.js?v=107';
import { stateOf } from './states.js?v=107';

const MIN_Y = -64, MAX_Y = 319, SEA_LEVEL = 63;
export const strip = s => (typeof s === 'string' && s.startsWith('minecraft:') ? s.slice(10) : s);
const F = Math.fround;
export { msin, mcos, stateOf };

/* ---------------------------------------------------------- block facts */
export const AIR = 0;
const isAirId = id => id === 0 || id === B.cave_air || id === B.void_air;
export const isAir = isAirId;
export const isWater = id => id === B.water;
const FLUIDISH = new Uint8Array(4096);
FLUIDISH[B.water] = 1; FLUIDISH[B.lava] = 2;
for (const n of ['seagrass', 'tall_seagrass', 'tall_seagrass_top_block', 'kelp', 'kelp_plant', 'bubble_column']) if (B[n] !== undefined) FLUIDISH[B[n]] = 1;
// (and every other block that stands in water: the wet corals and sea pickles, the wet conduit)
for (const d of BLOCKS) if (d && d.waterlogged) FLUIDISH[d.id] = 1;
// the fluid in a block: 1 water (including waterlogged plants), 2 lava
export const fluidOf = id => FLUIDISH[id];

/* ---- block tags, resolved to sets of ids ---- */
let TAGS = null;
export function tag(name) {
  name = strip(name).replace(/^#/, '');
  if (!TAGS) TAGS = new Map();
  let s = TAGS.get(name);
  if (s) return s;
  s = new Uint8Array(4096);
  const data = FeatureData.tags;
  const add = (n, depth) => {
    n = strip(n);
    if (n.startsWith('#')) {
      const list = data[n.slice(1).replace('minecraft:', '')];
      if (list && depth < 8) for (const e of list) add(typeof e === 'string' ? e : e.id, depth + 1);
      return;
    }
    if (B[n] !== undefined) s[B[n]] = 1;
  };
  for (const e of data[name] || []) add(typeof e === 'string' ? e : e.id, 0);
  if (name === 'air') { s[0] = 1; if (B.cave_air !== undefined) s[B.cave_air] = 1; if (B.void_air !== undefined) s[B.void_air] = 1; }
  TAGS.set(name, s);
  return s;
}
// the block names in a tag, in its own order (nested tags opened where they stand)
export function tagList(name, depth = 0) {
  const out = [];
  for (const e of FeatureData.tags[strip(name).replace(/^#/, '')] || []) {
    const n = strip(typeof e === 'string' ? e : e.id);
    if (n.startsWith('#')) { if (depth < 8) out.push(...tagList(n.slice(1), depth + 1)); } else out.push(n);
  }
  return out;
}
export const FeatureData = { tags: {}, placed: {}, configured: {}, biome: {} };

/* ---- what a block needs under it to stay (Block.canSurvive), for the
   blocks features place ---- */
// 26.3 says which blocks hold plants up with tags (supports_vegetation and friends)
const DIRTLIKE = () => tag('supports_vegetation');
// a full block nothing can be seen through (the game's "solid render")
const solidRender = id => id !== 0 && BLOCKS[id].shape === 'cube' && BLOCKS[id].solid && !BLOCKS[id].leaves && (BLOCKS[id].pass || 'opaque') === 'opaque';
export function survives(R, st, x, y, z) {
  const n = BLOCKS[st.id].name;
  const below = R.get(x, y - 1, z), bn = BLOCKS[below] ? BLOCKS[below].name : 'air';
  const dirt = DIRTLIKE();
  const fullTop = id => id !== 0 && BLOCKS[id].shape === 'cube' && BLOCKS[id].solid;
  // corals and sea pickles stand on a whole face; a wall fan hangs on the block behind it (its facing points away)
  if (/coral(_fan)?$|^sea_pickle$/.test(n.replace(/^lc2_wet_/, ''))) return fullTop(below);
  if (/coral_wall_fan$/.test(n)) { const f = st.meta & 3; return fullTop(R.get(x + [0, -1, 0, 1][f], y, z + [1, 0, -1, 0][f])); }
  switch (n) {
    case 'sugar_cane': {
      if (below === B.sugar_cane) return true;
      if (!tag('supports_sugar_cane')[below]) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = R.get(x + dx, y - 1, z + dz);
        if (fluidOf(b) === 1 || b === B.frosted_ice) return true;
      }
      return false;
    }
    case 'cactus': {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = R.get(x + dx, y, z + dz);
        if ((b !== 0 && BLOCKS[b].solid) || fluidOf(b) === 2) return false;
      }
      return below === B.cactus || tag('supports_cactus')[below] === 1;
    }
    case 'cactus_flower': return below === B.cactus || fullTop(below);
    case 'dead_bush': case 'short_dry_grass': case 'tall_dry_grass':
      return tag('supports_dry_vegetation')[below] === 1;
    // still water, or a plant standing in it (seagrass holds water too)
    case 'lily_pad': return (below === B.water && R.meta(x, y - 1, z) === 0) || (fluidOf(below) === 1 && below !== B.water) || tag('supports_lily_pad')[below] === 1;
    // a mushroom needs a whole block under it that light cannot pass (never leaves or glass); mycelium, podzol and nylium hold it in any light
    case 'brown_mushroom': case 'red_mushroom':
      return tag('overrides_mushroom_light_requirement')[below] === 1 || solidRender(below);
    case 'seagrass': case 'kelp': case 'kelp_plant': case 'tall_seagrass':
      return fullTop(below) && below !== B.magma_block;
    case 'snow': {
      if (tag('cannot_support_snow_layer')[below]) return false;
      if (tag('support_override_snow_layer')[below]) return true;
      return (below !== 0 && BLOCKS[below].solid && (BLOCKS[below].shape === 'cube' || BLOCKS[below].leaves));
    }
    case 'sweet_berry_bush': case 'firefly_bush': case 'bush': case 'leaf_litter': case 'wildflowers': case 'pink_petals':
      return dirt[below] === 1 || below === B.farmland || (n === 'leaf_litter' && fullTop(below));
    case 'pumpkin': case 'melon': return true;
    case 'pale_moss_carpet': case 'moss_carpet': return !isAirId(below);
    // a spore blossom hangs from the whole face of the block over it
    case 'spore_blossom': return fullTop(R.get(x, y + 1, z));
    // a small dripleaf on clay or moss, or on soil where it stands in still water (its top half is held by its bottom)
    case 'small_dripleaf':
      if (st.meta & 8) return true;
      return tag('supports_small_dripleaf')[below] === 1 || (R.get(x, y, z) === B.water && R.meta(x, y, z) === 0 && tag('supports_big_dripleaf')[below] === 1);
    case 'pale_hanging_moss': return R.get(x, y + 1, z) !== 0;
  }
  const d = BLOCKS[st.id];
  if (n === 'mangrove_propagule') return tag('supports_mangrove_propagule')[below] === 1;
  if (n === 'azalea' || n === 'flowering_azalea') return tag('supports_azalea')[below] === 1;
  if (n === 'bamboo' || n === 'bamboo_sapling') return tag('supports_bamboo')[below] === 1;
  if (n.endsWith('_sapling')) return dirt[below] === 1;
  if (d.shape === 'cross' || d.upper || d.lower || d.shape === 'crop') {
    if (d.lower && (st.meta & 8)) return true;
    return dirt[below] === 1 || below === B.farmland;
  }
  return true;
}

/* ---- a chunk put together from nine chunks' features ----
   Each chunk is decorated on its own, against the bare terrain of the chunks
   around it, and a chunk is then laid together from its own writes and its
   neighbours'. So two neighbours may write the same block, or one may take
   away what a plant of the other stands on (a clay pool or a sand disk under
   its grass, a fern over the bottom half of its tall grass). The game
   decorates chunks one after another, each feature seeing what came before,
   so neither can happen there. Here, when two chunks write the same block the
   sturdier one stays: a trunk over leaves, leaves over a flower (a tree
   grown later would have pushed the flower aside; a flower placed later would
   have found no room). Then every plant left without what it needs is taken
   away, as the game would never have put it there. */
const RANK = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (!d) continue;
  const n = d.name;
  if (isAirId(d.id) || /(_log|_wood|_stem|_hyphae|mushroom_block)$/.test(n)) RANK[d.id] = 5;   // air a feature dug (a geode, a lake) or a trunk
  else if (FLUIDISH[d.id] && d.shape === 'fluid') RANK[d.id] = 3;
  else if (d.leaves) RANK[d.id] = 2;
  else if (!d.solid || d.replaceable || d.shape !== 'cube') RANK[d.id] = 1;
  else RANK[d.id] = 4;
}
/* which of two neighbours' writes to one block stays (the later one on a tie).
   Water or lava that has run out of a source (any level, or falling) is what
   the game's fluid ticks would make after every feature is in, and those
   never wash a tree away: it gives way to leaves and anything sturdier, and
   only takes a plant's place. */
/* A feature's note on a block it placed (Region.note): code 1 + i is a
   container with loot table NOTE_TABLES[i], its seed the long (a << 32 | b);
   code NOTE_SPAWNER is a spawner holding NOTE_MOBS[a]. */
export const NOTE_TABLES = ['simple_dungeon', 'archaeology/desert_well'];
export const NOTE_MOBS = ['skeleton', 'zombie', 'spider'];
export const NOTE_SPAWNER = 100;
export const longHalves = s => [Number(BigInt.asIntN(32, s >> 32n)), Number(BigInt.asIntN(32, s))];
export const writeRank = (id, m) => ((m & 15) !== 0 && (id === B.water || id === B.lava) ? 1.5 : RANK[id]);

// the plants that stand on the block under them, and those that stand in water (taken back to water)
const GROUND = new Uint8Array(4096);
{
  const names = ['short_grass', 'fern', 'tall_grass', 'large_fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
    'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower', 'sunflower', 'lilac', 'rose_bush',
    'peony', 'open_eyeblossom', 'closed_eyeblossom', 'sweet_berry_bush', 'firefly_bush', 'bush', 'pink_petals', 'wildflowers', 'leaf_litter',
    'dead_bush', 'short_dry_grass', 'tall_dry_grass', 'brown_mushroom', 'red_mushroom', 'cactus', 'cactus_flower', 'sugar_cane', 'lily_pad',
    'snow', 'moss_carpet', 'pale_moss_carpet', 'azalea', 'flowering_azalea', 'bamboo', 'bamboo_sapling', 'oak_sapling', 'spruce_sapling',
    'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'pale_oak_sapling'];
  for (const n of names) {
    if (B[n] === undefined) continue;
    GROUND[B[n]] = 1;
    const up = BLOCKS[B[n]].upper;
    if (up && B[up] !== undefined) GROUND[B[up]] = 1;
  }
  for (const n of ['seagrass', 'tall_seagrass', 'tall_seagrass_top_block', 'kelp', 'kelp_plant']) if (B[n] !== undefined) GROUND[B[n]] = 2;
  // and what hangs from a ceiling or points from rock (a neighbour's lake or pool can dig either away)
  for (const n of ['pointed_dripstone', 'sulfur_spike', 'cave_vines', 'cave_vines_plant', 'hanging_roots', 'spore_blossom', 'pale_hanging_moss']) if (B[n] !== undefined) GROUND[B[n]] = 1;
}
export const isGroundPlant = id => GROUND[id];
// a block a pointed or hanging block can hold on to (its face towards it whole)
const holdsOn = b => b !== 0 && !!BLOCKS[b] && BLOCKS[b].shape === 'cube' && BLOCKS[b].solid !== false;
// can this plant stay where it is, with what is around it now
export function plantHolds(R, id, m, x, y, z) {
  const d = BLOCKS[id];
  if (id === B.pointed_dripstone || id === B.sulfur_spike) {
    // pointed dripstone keeps which way it points (4 up, 5 down); a sulfur spike only needs one end held
    const a = R.get(x, y + 1, z), b = R.get(x, y - 1, z);
    const top = a === id || holdsOn(a), bottom = b === id || holdsOn(b) || b === B.lava;
    if (id === B.pointed_dripstone && (m & 7) === 5) return top;
    if (id === B.pointed_dripstone && (m & 7) === 4) return bottom;
    return top || bottom;
  }
  if (id === B.cave_vines || id === B.cave_vines_plant) { const a = R.get(x, y + 1, z); return a === B.cave_vines_plant || a === B.cave_vines || holdsOn(a); }
  if (id === B.pale_hanging_moss) { const a = R.get(x, y + 1, z); return a === id || holdsOn(a) || !!(BLOCKS[a] && BLOCKS[a].leaves); }
  if (id === B.hanging_roots || id === B.spore_blossom) return holdsOn(R.get(x, y + 1, z));
  if (d.lower) return R.get(x, y - 1, z) === B[d.lower];                    // the top half of a tall plant needs its bottom half
  if (d.upper && B[d.upper] !== undefined && R.get(x, y + 1, z) !== B[d.upper]) return false;   // and the bottom half its top
  if (id === B.kelp || id === B.kelp_plant) {
    const b = R.get(x, y - 1, z);
    return b === B.kelp_plant || (b !== 0 && BLOCKS[b].shape === 'cube' && BLOCKS[b].solid && b !== B.magma_block);
  }
  return survives(R, { id, meta: m }, x, y, z);
}

/* ============================================================ providers == */
export function sampleInt(p, r) {
  if (typeof p === 'number') return p;
  const t = strip(p.type);
  switch (t) {
    case 'constant': return p.value;
    case 'uniform': return r.nextInt(p.max_inclusive - p.min_inclusive + 1) + p.min_inclusive;
    case 'biased_to_bottom': return p.min_inclusive + r.nextInt(r.nextInt(p.max_inclusive - p.min_inclusive + 1) + 1);
    case 'very_biased_to_bottom': return p.min_inclusive + r.nextInt(r.nextInt(r.nextInt(p.max_inclusive - p.min_inclusive + 1) + 1) + 1);
    case 'clamped': { const v = sampleInt(p.source, r); return Math.max(p.min_inclusive, Math.min(p.max_inclusive, v)); }
    case 'weighted_list': {
      let tot = 0; for (const e of p.distribution) tot += e.weight;
      let k = r.nextInt(tot);
      for (const e of p.distribution) { k -= e.weight; if (k < 0) return sampleInt(e.data, r); }
      return 0;
    }
    case 'trapezoid': {
      // one draw up and one down from the foot of the slope, as the old
      // patches spread (nextInt(n + 1) - nextInt(n + 1)): the same shape as
      // adding two draws, but each spot comes from different numbers, and
      // the real server's grass, flowers and seagrass sit where this puts them
      // (a spread of nothing still draws both, as the seagrass's height does)
      const mn = p.min, mx = p.max, pl = p.plateau || 0;
      const k = mx - mn;
      if (pl > 0 && pl >= k) return r.nextInt(k + 1) + mn;
      const l = Math.trunc((k - pl) / 2), m = k - l;
      const up = r.nextInt(m + 1);
      return mn + l + up - r.nextInt(l + 1);
    }
    case 'clamped_normal': {
      const v = p.mean + gaussian(r) * p.deviation;
      return Math.trunc(Math.max(p.min_inclusive, Math.min(p.max_inclusive, v)));
    }
  }
  throw new Error('int provider ' + t);
}
function gaussian(r) {
  if (r.nextGaussian) return r.nextGaussian();
  let u = 0, v = 0;
  while (u === 0) u = r.nextDouble();
  v = r.nextDouble();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function sampleFloat(p, r) {
  if (typeof p === 'number') return F(p);
  const t = strip(p.type);
  if (t === 'constant') return F(p.value);
  if (t === 'uniform') return F(F(r.nextFloat() * F(F(p.max_exclusive) - F(p.min_inclusive))) + F(p.min_inclusive));
  if (t === 'trapezoid') {
    const mn = F(p.min), mx = F(p.max), pl = F(p.plateau);
    const f = F(mx - mn), g = F(F(f - pl) / 2), h = F(f - g);
    return F(F(mn + F(r.nextFloat() * h)) + F(r.nextFloat() * g));
  }
  if (t === 'clamped_normal') return F(Math.max(p.min, Math.min(p.max, p.mean + gaussian(r) * p.deviation)));
  throw new Error('float provider ' + t);
}
export const anchorY = a => (typeof a === 'number' ? a : a.absolute !== undefined ? a.absolute : a.above_bottom !== undefined ? MIN_Y + a.above_bottom
  : a.below_top !== undefined ? MAX_Y - a.below_top : SEA_LEVEL + (a.relative_to_sea_level || 0));
export function sampleHeight(p, r) {
  const t = strip(p.type);
  if (t === 'constant') return anchorY(p.value);
  const i = anchorY(p.min_inclusive), j = anchorY(p.max_inclusive);
  switch (t) {
    case 'uniform': return i > j ? i : r.nextInt(j - i + 1) + i;
    case 'trapezoid': {
      if (i > j) return i;
      const k = j - i, pl = p.plateau || 0;
      if (pl >= k) return r.nextInt(k + 1) + i;
      const l = Math.trunc((k - pl) / 2), m = k - l;
      return i + r.nextInt(m + 1) + r.nextInt(l + 1);
    }
    case 'biased_to_bottom': {
      const inner = p.inner || 1;
      const k = r.nextInt(j - i - inner + 1);
      return r.nextInt(k + inner) + i;
    }
    case 'very_biased_to_bottom': {
      const inner = p.inner || 1;
      const ni = (a, b) => (a >= b ? a : r.nextInt(b - a + 1) + a);
      const k = ni(i + inner, j), l = ni(i, k - 1);
      return ni(i, l - 1 + inner);
    }
  }
  throw new Error('height provider ' + t);
}

/* ---- block states and state providers ---- */
export function stateFrom(j) {
  if (typeof j === 'string') return stateOf(j);
  if (j.id !== undefined) return stateOf({ Name: j.id, Properties: j.properties });
  if (j.Name !== undefined) return stateOf(j);
  return null;
}
/* The game names some of its block lists (worldgen/block_state_provider):
   "minecraft:flower_plain", "minecraft:soil_beneath_tree"... They are not
   blocks (read as one they came out as stone, the fallback for a name it
   does not know). These are 26.3's own definitions, as its data has them:
   the meadow and plains flowers are picked by noise, and the cave vines
   draw from the random like any weighted list, so everything after them
   draws what the game draws. Anything else unknown places nothing. */
const NAMED_DATA = {
  flower_plain: {
    type: 'noise_threshold', default_state: 'minecraft:dandelion', high_chance: 0.33333334,
    high_states: ['minecraft:poppy', 'minecraft:azure_bluet', 'minecraft:oxeye_daisy', 'minecraft:cornflower'],
    low_states: ['minecraft:orange_tulip', 'minecraft:red_tulip', 'minecraft:pink_tulip', 'minecraft:white_tulip'],
    noise: { base_amplitude: 0.955388882960065, base_octave: 0 }, scale: 0.005, seed: 2345, threshold: -0.8,
  },
  flower_meadow: {
    type: 'dual_noise', noise: { base_amplitude: 0.955388882960065, base_octave: -3 }, scale: 1.0, seed: 2345,
    slow_noise: { base_amplitude: 0.955388882960065, base_octave: -10 }, slow_scale: 1.0,
    states: ['minecraft:tall_grass', 'minecraft:allium', 'minecraft:poppy', 'minecraft:azure_bluet', 'minecraft:dandelion', 'minecraft:cornflower', 'minecraft:oxeye_daisy', 'minecraft:short_grass'],
    variety: [1, 3],
  },
  flower_flower_forest: {
    type: 'noise', noise: { base_amplitude: 0.955388882960065, base_octave: 0 }, scale: 0.020833334, seed: 2345,
    states: ['minecraft:dandelion', 'minecraft:poppy', 'minecraft:allium', 'minecraft:azure_bluet', 'minecraft:red_tulip', 'minecraft:orange_tulip', 'minecraft:white_tulip', 'minecraft:pink_tulip', 'minecraft:oxeye_daisy', 'minecraft:cornflower', 'minecraft:lily_of_the_valley'],
  },
  cave_vines_body: { type: 'weighted', entries: [{ data: 'minecraft:cave_vines_plant', weight: 4 }, { data: { id: 'minecraft:cave_vines_plant', properties: { berries: 'true' } }, weight: 1 }] },
  cave_vines_head: {
    type: 'randomized_int', property: 'age',
    source: { type: 'weighted', entries: [{ data: 'minecraft:cave_vines', weight: 4 }, { data: { id: 'minecraft:cave_vines', properties: { age: '0', berries: 'true' } }, weight: 1 }] },
    values: { type: 'uniform', max_inclusive: 25, min_inclusive: 23 },
  },
  soil_beneath_tree: { type: 'rule_based', rules: [{ if_true: { type: 'not', predicate: { type: 'matching_block_tag', tag: 'minecraft:cannot_replace_below_tree_trunk' } }, then: { id: 'minecraft:dirt' } }] },
  podzol_beneath_tree: { type: 'rule_based', rules: [{ if_true: { type: 'matching_block_tag', tag: 'minecraft:beneath_tree_podzol_replaceable' }, then: { id: 'minecraft:podzol', properties: { snowy: 'false' } } }] },
  mangrove_propagule: { type: 'randomized_int', property: 'age', source: { id: 'minecraft:mangrove_propagule', properties: { age: '0', hanging: 'true', stage: '0', waterlogged: 'false' } }, values: { type: 'uniform', max_inclusive: 4, min_inclusive: 0 } },
};
const NAMED = {};
function named(name) {
  if (NAMED[name]) return NAMED[name];
  return (NAMED[name] = NAMED_DATA[name] ? provider(NAMED_DATA[name]) : () => stateOf('minecraft:air'));
}

/* A noise for the noise-picked providers: the game makes it from a
   java.util.Random seeded with the provider's seed (not the world's), so
   the flower patterns are the same in every world. */
const javaHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };
function providerNoise(def, seed) {
  const r = new LegacyRandom(BigInt(seed));
  const factory = { forkPositional() { const s = r.nextLong(); return { fromHashOf: n => new LegacyRandom(BigInt.asIntN(64, BigInt(javaHash(n)) ^ s)) }; } };
  return normalNoise(def, factory);
}
// NoiseBasedStateProvider.getRandomState: the noise value picks from the list
const pickByNoise = (list, v) => {
  const d = Math.max(0, Math.min(0.9999, (1 + v) / 2));
  return list[Math.trunc(d * list.length)];
};
const statesOf = a => (a || []).map(stateFrom);
export function provider(p) {
  // a name that is not a block is one of the game's named lists
  if (typeof p === 'string' && B[strip(p.replace(/\[.*$/, ''))] === undefined) return named(strip(p.replace(/\[.*$/, '')));
  if (p._prov) return p._prov;
  let f;
  const direct = stateFrom(p);
  if (direct && !(p.type && strip(p.type).endsWith('provider'))) {
    if (typeof p === 'string' || p.id !== undefined || p.Name !== undefined) { f = () => direct; if (typeof p === 'object') p._prov = f; return f; }
  }
  const t = strip(p.type);
  switch (t) {
    case 'simple_state_provider': { const s = stateFrom(p.state); f = () => s; break; }
    case 'weighted': case 'weighted_state_provider': {
      const es = (p.entries || p.distribution).map(e => ({ w: e.weight, f: typeof e.data === 'object' && e.data.type ? provider(e.data) : (() => { const s = stateFrom(e.data); return () => s; })() }));
      let tot = 0; for (const e of es) tot += e.w;
      f = (r, x, y, z) => { let k = r.nextInt(tot); for (const e of es) { k -= e.w; if (k < 0) return e.f(r, x, y, z); } return es[0].f(r, x, y, z); };
      break;
    }
    case 'rotated_block_provider': { const s = stateFrom(p.state); f = r => { const a = r.nextInt(3); return stateOf({ Name: s.name, Properties: { axis: 'xyz'[a] } }); }; break; }
    // one block of a list or a tag, any of them as likely
    case 'random_block': {
      const names = [];
      for (const b of (Array.isArray(p.blocks) ? p.blocks : [p.blocks])) {
        const n = strip(b);
        if (!n.startsWith('#')) { if (B[n] !== undefined) names.push(n); continue; }
        for (const e of tagList(n.slice(1))) if (B[e] !== undefined) names.push(e);
      }
      const list = names.map(n => stateOf(n));
      f = r => list[r.nextInt(list.length)];
      break;
    }
    // another provider's block turned to face one way (a wall coral on the side of its block)
    case 'rotated': {
      const src = provider(p.state), dir = p.direction;
      f = (r, x, y, z, R) => { const s = src(r, x, y, z, R); return s ? stateOf({ Name: s.name, Properties: Object.assign({}, s.props || {}, { facing: dir }) }) : s; };
      break;
    }
    case 'randomized_int_state_provider': case 'randomized_int': {
      const src = provider(p.source);
      f = (r, x, y, z) => {
        const s = src(r, x, y, z);
        const v = sampleInt(p.values, r);
        const props = Object.assign({}, s.props || {}, { [p.property]: String(v) });
        return stateOf({ Name: s.name, Properties: props });
      };
      break;
    }
    case 'noise': case 'noise_provider': {
      const n = providerNoise(p.noise, p.seed), sc = p.scale, list = statesOf(p.states);
      f = (r, x, y, z) => pickByNoise(list, n.sample(x * sc, y * sc, z * sc));
      break;
    }
    case 'noise_threshold': case 'noise_threshold_provider': {
      const n = providerNoise(p.noise, p.seed), sc = p.scale;
      const def = stateFrom(p.default_state), low = statesOf(p.low_states), high = statesOf(p.high_states);
      const hc = F(p.high_chance), th = F(p.threshold);
      f = (r, x, y, z) => {
        if (n.sample(x * sc, y * sc, z * sc) < th) return low[r.nextInt(low.length)];
        if (r.nextFloat() < hc) return high[r.nextInt(high.length)];
        return def;
      };
      break;
    }
    case 'dual_noise': case 'dual_noise_provider': {
      // the slow noise decides how many of the states a spot chooses among
      // (and which), the fast one picks from those
      const n = providerNoise(p.noise, p.seed), slow = providerNoise(p.slow_noise, p.seed);
      const sc = p.scale, ss = F(p.slow_scale), list = statesOf(p.states);
      const v = p.variety, vmin = Array.isArray(v) ? v[0] : v.min_inclusive ?? v, vmax = Array.isArray(v) ? v[1] : v.max_inclusive ?? v;
      const slowAt = (x, y, z) => slow.sample(F(x * ss), F(y * ss), F(z * ss));
      f = (r, x, y, z) => {
        const t = Math.max(0, Math.min(1, (slowAt(x, y, z) + 1) / 2));
        const k = Math.trunc(vmin + t * (vmax + 1 - vmin));
        const some = [];
        for (let j = 0; j < k; j++) some.push(pickByNoise(list, slowAt(x + j * 54545, y, z + j * 34234)));
        return pickByNoise(some, n.sample(x * sc, y * sc, z * sc));
      };
      break;
    }
    case 'rule_based': case 'rule_based_state_provider': {
      const rules = (p.rules || []).map(ru => ({ test: predicate(ru.if_true), prov: provider(ru.then) }));
      const fb = p.fallback ? provider(p.fallback) : null;
      f = (r, x, y, z, R) => { for (const ru of rules) if (ru.test(R, x, y, z)) return ru.prov(r, x, y, z, R); return fb ? fb(r, x, y, z, R) : null; };
      break;
    }
    default: throw new Error('state provider ' + t);
  }
  p._prov = f;
  return f;
}

/* ---- block predicates (for placement filters and features) ---- */
export function predicate(p) {
  if (!p) return () => true;
  if (p._pred) return p._pred;
  const t = strip(p.type);
  const off = p.offset || [0, 0, 0];
  const [ox, oy, oz] = off;
  let f;
  switch (t) {
    case 'true': f = () => true; break;
    case 'matching_blocks': {
      const set = new Uint8Array(4096);
      for (const b of (Array.isArray(p.blocks) ? p.blocks : [p.blocks])) {
        const n = strip(b);
        if (n.startsWith('#')) { const s = tag(n.slice(1)); for (let i = 0; i < 4096; i++) if (s[i]) set[i] = 1; }
        else if (B[n] !== undefined) set[B[n]] = 1;
        if (n === 'air') set[0] = 1;
      }
      f = (R, x, y, z) => set[R.get(x + ox, y + oy, z + oz)] === 1;
      break;
    }
    case 'matching_block_tag': { const s = tag(p.tag); f = (R, x, y, z) => s[R.get(x + ox, y + oy, z + oz)] === 1; break; }
    case 'matching_fluids': {
      // "empty" is no fluid at all (the melon patches ask for it); "water" and "lava" are still, "flowing_..." running
      const names = (Array.isArray(p.fluids) ? p.fluids : [p.fluids]).map(strip);
      const want = { empty: names.includes('empty'), water: names.includes('water'), flowing_water: names.includes('flowing_water'),
        lava: names.includes('lava'), flowing_lava: names.includes('flowing_lava') };
      f = (R, x, y, z) => {
        const b = R.get(x + ox, y + oy, z + oz), fl = fluidOf(b);
        if (!fl) return want.empty;
        // (a plant standing in water holds still water)
        const running = (b === B.water || b === B.lava) && (R.meta(x + ox, y + oy, z + oz) & 15) !== 0;
        return fl === 1 ? (running ? want.flowing_water : want.water) : (running ? want.flowing_lava : want.lava);
      };
      break;
    }
    case 'all_of': { const ps = p.predicates.map(predicate); f = (R, x, y, z) => { for (const q of ps) if (!q(R, x, y, z)) return false; return true; }; break; }
    case 'any_of': { const ps = p.predicates.map(predicate); f = (R, x, y, z) => { for (const q of ps) if (q(R, x, y, z)) return true; return false; }; break; }
    case 'not': { const q = predicate(p.predicate); f = (R, x, y, z) => !q(R, x, y, z); break; }
    case 'solid': f = (R, x, y, z) => { const b = R.get(x + ox, y + oy, z + oz); return b !== 0 && BLOCKS[b].solid && !fluidOf(b); }; break;
    case 'replaceable': f = (R, x, y, z) => { const b = R.get(x + ox, y + oy, z + oz); return b === 0 || !!BLOCKS[b].replaceable; }; break;
    case 'would_survive': { const st = stateFrom(p.state); f = (R, x, y, z) => survives(R, st, x + ox, y + oy, z + oz); break; }
    case 'has_sturdy_face': f = (R, x, y, z) => { const b = R.get(x + ox, y + oy, z + oz); return b !== 0 && BLOCKS[b].shape === 'cube' && BLOCKS[b].solid; }; break;
    case 'inside_world_bounds': f = (R, x, y, z) => y + oy >= MIN_Y && y + oy <= MAX_Y; break;
    case 'unobstructed': f = () => true; break;
    // every block of a box round the spot passes (the desert well wants ground under all of its 5 x 5)
    case 'volume_match': {
      const q = predicate(p.match), lo = p.min || [0, 0, 0], hi = p.max || [0, 0, 0];
      f = (R, x, y, z) => {
        for (let dy = lo[1]; dy <= hi[1]; dy++) for (let dz = lo[2]; dz <= hi[2]; dz++) for (let dx = lo[0]; dx <= hi[0]; dx++)
          if (!q(R, x + ox + dx, y + oy + dy, z + oz + dz)) return false;
        return true;
      };
      break;
    }
    default: console.warn('block predicate not handled:', t); f = () => false;
  }
  p._pred = f;
  return f;
}

/* ---- ore targets (rule tests) ---- */
export function ruleTest(p) {
  if (p._rt) return p._rt;
  const t = strip(p.predicate_type);
  let f;
  switch (t) {
    case 'always_true': f = () => true; break;
    case 'tag_match': { const s = tag(p.tag); f = id => s[id] === 1; break; }
    case 'block_match': { const id = B[strip(p.block)]; f = b => b === id; break; }
    case 'blockstate_match': { const st = stateFrom(p.block_state); f = (b, m) => b === st.id && m === st.meta; break; }
    case 'random_block_match': { const id = B[strip(p.block)]; f = (b, m, r) => b === id && r.nextFloat() < p.probability; break; }
    case 'random_blockstate_match': { const st = stateFrom(p.block_state); f = (b, m, r) => b === st.id && r.nextFloat() < p.probability; break; }
    case 'height_match': f = (b, m, r, y) => y >= p.min_inclusive && y <= p.max_inclusive; break;
    case 'any_of': { const rs = p.rules.map(ruleTest); f = (b, m, r, y) => { for (const q of rs) if (q(b, m, r, y)) return true; return false; }; break; }
    case 'all_of': { const rs = p.rules.map(ruleTest); f = (b, m, r, y) => { for (const q of rs) if (!q(b, m, r, y)) return false; return true; }; break; }
    case 'not': { const q = ruleTest(p.rule); f = (b, m, r, y) => !q(b, m, r, y); break; }
    default: console.warn('rule test not handled:', t); f = () => false;
  }
  p._rt = f;
  return f;
}

/* ================================================== the working region ==
   The chunk being decorated and the eight around it: block reads and
   writes in world coordinates, the heightmaps, and the biomes. Writes are
   kept per chunk so they can be laid onto each chunk later. */
const HM = { WORLD_SURFACE_WG: 0, OCEAN_FLOOR_WG: 1, WORLD_SURFACE: 2, OCEAN_FLOOR: 3, MOTION_BLOCKING: 4, MOTION_BLOCKING_NO_LEAVES: 5 };
// a terrain chunk's six heightmaps, kept with it
function protoHeights(p) {
  if (p.heights) return p.heights;
  const hm = [];
  for (let k = 0; k < 6; k++) hm.push(new Int16Array(256).fill(MIN_Y));
  const blocks = p.blocks;
  let topI = VOLI - 1;
  while (topI > 0 && blocks[topI] === 0) topI--;
  const topY = topI >> 8;
  for (let col = 0; col < 256; col++) {
    let found = 0;
    for (let iy = topY; iy >= 0 && found !== 63; iy--) {
      const b = blocks[(iy << 8) | col];
      if (b === 0) continue;
      const y = iy + MIN_Y + 1;
      const d = BLOCKS[b];
      const solid = d.solid && b !== B.cobweb;
      const fl = fluidOf(b) !== 0;
      if (!(found & 1)) { hm[0][col] = y; hm[2][col] = y; found |= 1 | 4; }
      if (!(found & 2) && solid) { hm[1][col] = y; hm[3][col] = y; found |= 2 | 8; }
      if (!(found & 16) && (solid || fl)) { hm[4][col] = y; found |= 16; }
      if (!(found & 32) && (solid || fl) && !d.leaves) { hm[5][col] = y; found |= 32; }
    }
  }
  p.heights = hm;
  return hm;
}
const VOLI = 16 * 16 * 384;
export class Region {
  constructor(gen, cx, cz, lazy) {
    this.gen = gen;
    this.cx = cx; this.cz = cz;
    this.x0 = (cx - 1) * 16; this.z0 = (cz - 1) * 16;
    this.chunks = [];
    this.protos = [];
    // heightmaps over the 48 x 48 columns: first free y (world y), from each
    // chunk's own (worked out once per chunk)
    this.hm = [];
    for (let k = 0; k < 6; k++) this.hm.push(new Int16Array(48 * 48));
    // (a LazyRegion fills its chunks in as they are first read)
    if (lazy) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const p = gen.proto(cx + dx, cz + dz);
      this.protos.push(p);
      this.chunks.push({ blocks: p.blocks, meta: p.meta, own: false, writes: null, smask: p.smask || null });
    }
    for (let c = 0; c < 9; c++) this.heightsOf(c);
  }
  // chunk c's heightmaps into the region's
  heightsOf(c) {
    const h = protoHeights(this.protos[c]);
    const ox = (c % 3) * 16, oz = Math.floor(c / 3) * 16;
    for (let k = 0; k < 6; k++) {
      const src = h[k], dst = this.hm[k];
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) dst[(oz + z) * 48 + ox + x] = src[(z << 4) | x];
    }
  }
  inside(x, z) { return x >= this.x0 && x < this.x0 + 48 && z >= this.z0 && z < this.z0 + 48; }
  get(x, y, z) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48 || y < MIN_Y || y > MAX_Y) return 0;
    return this.chunks[(lz >> 4) * 3 + (lx >> 4)].blocks[((y - MIN_Y) << 8) | ((lz & 15) << 4) | (lx & 15)];
  }
  meta(x, y, z) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48 || y < MIN_Y || y > MAX_Y) return 0;
    return this.chunks[(lz >> 4) * 3 + (lx >> 4)].meta[((y - MIN_Y) << 8) | ((lz & 15) << 4) | (lx & 15)];
  }
  set(x, y, z, id, meta = 0) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48 || y < MIN_Y || y > MAX_Y) return false;
    const c = this.chunks[(lz >> 4) * 3 + (lx >> 4)];
    const i = ((y - MIN_Y) << 8) | ((lz & 15) << 4) | (lx & 15);
    // the features the game places before its structures leave a structure's blocks as they are
    if (this.early && c.smask && c.smask[i]) return false;
    if (!c.own) { c.blocks = c.blocks.slice(); c.meta = c.meta.slice(); c.own = true; c.writes = new Map(); }
    c.blocks[i] = id; c.meta[i] = meta;
    c.writes.set(i, id * 256 + meta);
    // the heightmaps that change as features place blocks
    const col = lz * 48 + lx;
    const d = BLOCKS[id];
    const solid = id !== 0 && d.solid && id !== B.cobweb, fl = fluidOf(id) !== 0;
    this.hmUpdate(2, col, x, y, z, id !== 0);
    this.hmUpdate(3, col, x, y, z, solid);
    this.hmUpdate(4, col, x, y, z, solid || fl);
    this.hmUpdate(5, col, x, y, z, (solid || fl) && !(id && d.leaves));
    return true;
  }
  /* What a block a feature placed holds beyond its state, as the game keeps
     it in the block's entity: a chest's loot table and seed, a spawner's mob
     (see NOTE_TABLES and NOTE_MOBS). Kept with the writes of the chunk the
     block is in, as two pairs after them (vanillagen.js writes and generate):
     [-1 - cell, code] and [a, b]. */
  note(x, y, z, code, a = 0, b = 0) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48 || y < MIN_Y || y > MAX_Y) return;
    const c = this.chunks[(lz >> 4) * 3 + (lx >> 4)];
    (c.notes || (c.notes = [])).push(-1 - (((y - MIN_Y) << 8) | ((lz & 15) << 4) | (lx & 15)), code, a, b);
  }
  // a block another chunk's features put there (a neighbour's tree, see Decorator.treePlan): in the
  // region for this chunk's features to find, but not one of this chunk's writes
  preset(x, y, z, id, meta) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48 || y < MIN_Y || y > MAX_Y) return;
    const c = this.chunks[(lz >> 4) * 3 + (lx >> 4)];
    if (!c.own) { c.blocks = c.blocks.slice(); c.meta = c.meta.slice(); c.own = true; c.writes = new Map(); }
    const i = ((y - MIN_Y) << 8) | ((lz & 15) << 4) | (lx & 15);
    c.blocks[i] = id; c.meta[i] = meta;
    const col = lz * 48 + lx, d = BLOCKS[id];
    const solid = id !== 0 && d.solid && id !== B.cobweb, fl = fluidOf(id) !== 0;
    this.hmUpdate(2, col, x, y, z, id !== 0);
    this.hmUpdate(3, col, x, y, z, solid);
    this.hmUpdate(4, col, x, y, z, solid || fl);
    this.hmUpdate(5, col, x, y, z, (solid || fl) && !(id && d.leaves));
  }
  hmUpdate(k, col, x, y, z, opaque) {
    const h = this.hm[k], i = h[col];
    if (y <= i - 2) return;
    if (opaque) { if (y >= i) h[col] = y + 1; return; }
    if (i - 1 !== y) return;
    for (let j = y - 1; j >= MIN_Y; j--) {
      const b = this.get(x, j, z);
      if (b === 0) continue;
      const d = BLOCKS[b];
      const s = d.solid && b !== B.cobweb, fl = fluidOf(b) !== 0;
      const ok = k === 2 ? true : k === 3 ? s : k === 4 ? (s || fl) : ((s || fl) && !d.leaves);
      if (ok) { h[col] = j + 1; return; }
    }
    h[col] = MIN_Y;
  }
  height(type, x, z) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48) return MIN_Y;
    return this.hm[HM[type]][lz * 48 + lx];
  }
  biome(x, y, z) {
    const lx = x - this.x0, lz = z - this.z0;
    const c = (lx >= 0 && lx < 48 && lz >= 0 && lz < 48) ? this.protos[(lz >> 4) * 3 + (lx >> 4)] : this.protos[4];
    return this.gen.gridBiome(c.grid, x, y, z);
  }
  canWrite(x, y, z) { return this.inside(x, z) && y >= MIN_Y && y <= MAX_Y; }
}

/* The region a lake plan is worked out in (Decorator.lakePlan): the same,
   but a chunk's terrain is made only when something there is first read.
   Most plans read no block at all (a lake is rare), and most of the terrain
   round a neighbour is not among the nine a worker is handed: made in full
   up front, it was most of the time a decoration took. Their biomes are
   wanted from the start (they say which features run); a biome grid is a
   small part of a terrain. grids(x, z) gives one. */
class LazyRegion extends Region {
  constructor(gen, cx, cz, grids) {
    super(gen, cx, cz, true);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz, p = gen.protoCache.get(x + ',' + z);
      this.protos.push({ grid: p ? p.grid : grids(x, z), lazy: true });
      this.chunks.push(null);
    }
  }
  load(c) {
    const p = this.gen.proto(this.cx + (c % 3) - 1, this.cz + Math.floor(c / 3) - 1);
    this.protos[c] = p;
    this.heightsOf(c);
    return (this.chunks[c] = { blocks: p.blocks, meta: p.meta, own: false, writes: null, smask: p.smask || null });
  }
  at(x, z) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= 48 || lz < 0 || lz >= 48) return;
    const c = (lz >> 4) * 3 + (lx >> 4);
    if (!this.chunks[c]) this.load(c);
  }
  get(x, y, z) { this.at(x, z); return super.get(x, y, z); }
  meta(x, y, z) { this.at(x, z); return super.meta(x, y, z); }
  set(x, y, z, id, meta = 0) { this.at(x, z); return super.set(x, y, z, id, meta); }
  height(type, x, z) { this.at(x, z); return super.height(type, x, z); }
}

/* ===================================================== feature registry == */
export const FEATURES = {};
const missing = new Set();

// a placed feature: inline { feature, placement } or a name (string)
export function placedOf(ref) {
  if (typeof ref === 'string') {
    const n = strip(ref);
    if (FeatureData.placed[n]) return Object.assign({ _name: n }, FeatureData.placed[n]);
    return { feature: n, placement: [] };      // a configured feature by name
  }
  return ref;
}
export function configuredOf(ref) {
  if (typeof ref === 'string') return FeatureData.configured[strip(ref)];
  return ref;
}

/* Place a configured feature at a position: true if it placed anything. */
export function placeConfigured(D, cfgRef, r, x, y, z) {
  const cfg = configuredOf(cfgRef);
  if (!cfg) return false;
  const t = strip(cfg.type);
  const fn = FEATURES[t];
  if (!fn) { if (!missing.has(t)) { missing.add(t); } return false; }
  return fn(D, cfg, r, x, y, z);
}
// a placed feature: its placement chain, then the feature at each position
export function placePlaced(D, pfRef, r, x, y, z, top) {
  const pf = placedOf(pfRef);
  let any = false;
  const mods = pf.placement || [];
  const run = (k, px, py, pz) => {
    if (k === mods.length) { if (placeConfigured(D, pf.feature, r, px, py, pz)) any = true; return; }
    applyModifier(D, mods[k], r, px, py, pz, top, (nx, ny, nz) => run(k + 1, nx, ny, nz));
  };
  run(0, x, y, z);
  return any;
}

/* ---- placement modifiers: each calls next() for every position it keeps ---- */
let BIOME_INFO = null, TEMP_NOISE = null, FROZEN_NOISE = null;
function biomeInfo() { if (!BIOME_INFO) BIOME_INFO = perlinSimplex(new LegacyRandom(2345n), [0]); return BIOME_INFO; }
export function applyModifier(D, m, r, x, y, z, top, next) {
  const R = D.region;
  switch (strip(m.type)) {
    case 'count': { const n = sampleInt(m.count, r); for (let i = 0; i < n; i++) next(x, y, z); return; }
    case 'in_square': { const nx = x + r.nextInt(16), nz = z + r.nextInt(16); next(nx, y, nz); return; }
    case 'height_range': next(x, sampleHeight(m.height, r), z); return;
    case 'heightmap': { const h = R.height(m.heightmap, x, z); if (h > MIN_Y) next(x, h, z); return; }
    case 'biome': {
      if (!top) { next(x, y, z); return; }
      const b = R.biome(x, y, z);
      if (D.biomeHas(b, top)) next(x, y, z);
      return;
    }
    case 'block_predicate_filter': if (predicate(m.predicate)(R, x, y, z)) next(x, y, z); return;
    case 'offset': {
      const xs = m.x ?? m.xz_spread ?? 0, ys = m.y ?? m.y_spread ?? 0, zs = m.z ?? m.xz_spread ?? 0;
      const nx = x + sampleInt(xs, r), ny = y + sampleInt(ys, r), nz = z + sampleInt(zs, r);
      next(nx, ny, nz);
      return;
    }
    case 'rarity_filter': if (r.nextFloat() < F(1 / m.chance)) next(x, y, z); return;
    case 'random_chance': if (r.nextFloat() < F(m.chance ?? m.probability)) next(x, y, z); return;
    case 'surface_water_depth_filter': {
      const a = R.height('OCEAN_FLOOR', x, z), b = R.height('WORLD_SURFACE', x, z);
      if (b - a <= m.max_water_depth) next(x, y, z);
      return;
    }
    case 'surface_relative_threshold_filter': {
      const h = R.height(m.heightmap, x, z);
      const lo = h + (m.min_inclusive ?? -2147483648), hi = h + (m.max_inclusive ?? 2147483647);
      if (lo <= y && y <= hi) next(x, y, z);
      return;
    }
    case 'environment_scan': {
      const dir = m.direction_of_search === 'up' ? 1 : -1;
      const target = predicate(m.target_condition), allowed = predicate(m.allowed_search_condition || { type: 'true' });
      let yy = y;
      if (!allowed(R, x, yy, z)) return;
      for (let i = 0; i < m.max_steps; i++) {
        if (target(R, x, yy, z)) { next(x, yy, z); return; }
        yy += dir;
        if (yy < MIN_Y || yy > MAX_Y) return;
        if (!allowed(R, x, yy, z)) break;
      }
      if (target(R, x, yy, z)) next(x, yy, z);
      return;
    }
    case 'noise_threshold_count': {
      const d = biomeInfo().sample(x / 200, z / 200, false);
      const n = d < m.noise_level ? m.below_noise : m.above_noise;
      for (let i = 0; i < n; i++) next(x, y, z);
      return;
    }
    case 'noise_based_count': {
      const d = biomeInfo().sample(x / m.noise_factor, z / m.noise_factor, false);
      const n = Math.ceil((d + (m.noise_offset || 0)) * m.noise_to_count_ratio);
      for (let i = 0; i < n; i++) next(x, y, z);
      return;
    }
    case 'count_on_every_layer': {
      // a count on each "layer" (the n-th open surface going down), as the old patches did
      let layer = 0, found;
      do {
        found = false;
        const n = sampleInt(m.count, r);
        for (let i = 0; i < n; i++) {
          const nx = x + r.nextInt(16), nz = z + r.nextInt(16);
          const h = R.height('MOTION_BLOCKING', nx, nz);
          const fy = findOnLayer(R, nx, h, nz, layer);
          if (fy === 2147483647) continue;
          next(nx, fy, nz);
          found = true;
        }
        layer++;
      } while (found);
      return;
    }
    case 'fixed_placement': for (const p of m.positions) next(p[0], p[1], p[2]); return;
    // one of several placements, picked at random
    case 'randomly_selected': {
      const list = m.placements || [];
      if (list.length) applyModifier(D, list[r.nextInt(list.length)], r, x, y, z, top, next);
      return;
    }
    /* Every cell of a box from here (x and z across xz_size + 1, y up y_size + 1): the cells of its
       faces always, its edges and its inside when asked for. With neither it is a hollow box with its
       edges left open, the shape of the warm ocean's coral mushrooms. */
    case 'cuboid': {
      const sx = sampleInt(m.xz_size, r), sy = sampleInt(m.y_size, r), sz = sx;
      for (let i = 0; i <= sx; i++) for (let j = 0; j <= sy; j++) for (let k = 0; k <= sz; k++) {
        const on = (i === 0 || i === sx) + (j === 0 || j === sy) + (k === 0 || k === sz);
        if (on === 1 || (on >= 2 && m.include_edges) || (on === 0 && m.include_interior)) next(x + i, y + j, z + k);
      }
      return;
    }
    case 'carving_mask':
      D.unknownModifier(strip(m.type));
      return;
  }
  D.unknownModifier(strip(m.type));
}
function findOnLayer(R, x, y, z, layer) {
  let k = 0;
  for (let yy = y; yy >= MIN_Y + 1; yy--) {
    const here = R.get(x, yy, z), below = R.get(x, yy - 1, z);
    const emptyHere = here === 0 || fluidOf(here) === 1 || here === B.water;
    const solidBelow = below !== 0 && fluidOf(below) === 0 && below !== B.bedrock;
    if (emptyHere && solidBelow) {
      if (k === layer) return yy;
      k++;
    }
  }
  return 2147483647;
}

/* The biome noises the game keeps from before 1.18 (temperature and the
   "biome info" noise behind counts): 2D simplex octaves on old randoms. */
export function perlinSimplex(random, octaves) {
  const first = -octaves[0], last = octaves[octaves.length - 1];
  const total = first + last + 1;
  const zero = new Simplex(random);
  const levels = new Array(total).fill(null);
  if (last >= 0 && last < total && octaves.includes(0)) levels[last] = zero;
  for (let m = last + 1; m < total; m++) {
    if (m >= 0 && octaves.includes(last - m)) levels[m] = new Simplex(random);
    else random.consume(262);
  }
  const inF = Math.pow(2, last), valF = 1 / (Math.pow(2, total) - 1);
  return {
    sample(x, y, offsets) {
      let d = 0, e = inF, f = valF;
      for (const s of levels) {
        if (s) d += s.sample2(x * e + (offsets ? s.xo : 0), y * e + (offsets ? s.yo : 0)) * f;
        e /= 2; f *= 2;
      }
      return d;
    },
  };
}

/* ---- biome temperature (snow, ice, melting icebergs) ---- */
export function temperatureAt(biomeName, x, y, z) {
  if (!TEMP_NOISE) { TEMP_NOISE = perlinSimplex(new LegacyRandom(1234n), [0]); FROZEN_NOISE = perlinSimplex(new LegacyRandom(3456n), [-2, -1, 0]); }
  const b = FeatureData.biome[biomeName] || { temperature: 0.8, temperature_modifier: 'none' };
  let t = F(b.temperature);
  if (b.temperature_modifier === 'frozen') {
    const d = FROZEN_NOISE.sample(x * 0.05, z * 0.05, false) * 7;
    const e = biomeInfo().sample(x * 0.2, z * 0.2, false);
    if (d + e < 0.3) { const g = biomeInfo().sample(x * 0.09, z * 0.09, false); if (g < 0.8) t = F(0.2); }
  }
  const top = SEA_LEVEL + 17;
  if (y > top) {
    const g = F(TEMP_NOISE.sample(F(x / 8), F(z / 8), false) * 8);
    return F(t - F(F(F(F(g + y) - top) * F(0.05)) / 40));
  }
  return t;
}
const coldEnoughToSnow = (bn, x, y, z) => temperatureAt(bn, x, y, z) < F(0.15);

/* ============================================================ features == */
FEATURES.no_op = () => false;

/* A stand-in for trees until trees.js has the game's own trunk and foliage
   placers (it replaces this): a trunk of the configured height and a ball
   of leaves of the configured radius, from the configured blocks, where
   there is room. */
FEATURES.tree = (D, c, r, x, y, z) => {
  const R = D.region;
  const tp = c.trunk_placer || {}, fp = c.foliage_placer || {};
  const h = (tp.base_height || 5) + r.nextInt((tp.height_rand_a || 0) + 1) + r.nextInt((tp.height_rand_b || 0) + 1);
  const rad = typeof fp.radius === 'number' ? fp.radius : (fp.radius && (fp.radius.min_inclusive ?? fp.radius.value)) || 2;
  const log = provider(c.trunk_provider)(r, x, y, z, R), leaf = provider(c.foliage_provider)(r, x, y, z, R);
  if (!log || !leaf) return false;
  const below = R.get(x, y - 1, z);
  if (!tag('dirt')[below] && below !== B.grass_block && below !== B.sand && below !== B.mud) return false;
  for (let k = 0; k <= h; k++) { const b = R.get(x, y + k, z); if (!(isAirId(b) || BLOCKS[b].replaceable || BLOCKS[b].leaves)) return false; }
  if (below === B.grass_block || below === B.mycelium || below === B.podzol) R.set(x, y - 1, z, B.dirt, 0);
  const top = y + h;
  for (let dy = -2; dy <= 1; dy++) {
    const rr = dy >= 0 ? rad - 1 : rad;
    for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
      if (Math.abs(dx) === rr && Math.abs(dz) === rr && (dy >= 0 || r.nextInt(2) === 0)) continue;
      const b = R.get(x + dx, top + dy, z + dz);
      if (isAirId(b) || BLOCKS[b].replaceable) R.set(x + dx, top + dy, z + dz, leaf.id, leaf.meta);
    }
  }
  for (let k = 0; k < h; k++) R.set(x, y + k, z, log.id, log.meta);
  return true;
};

FEATURES.simple_block = (D, c, r, x, y, z) => {
  const R = D.region;
  const st = provider(c.to_place)(r, x, y, z, R);
  if (!st) return false;
  if (!survives(R, st, x, y, z)) return false;
  const d = BLOCKS[st.id];
  if (d.upper || isDoubleData(d)) {
    // (a tall plant that grows under water, tall seagrass, has water over it, not air)
    const above = R.get(x, y + 1, z);
    if (!isAirId(above) && !(d.waterlogged && above === B.water)) return false;
    placeDouble(R, st, x, y, z);
  } else {
    // a coral or a sea pickle put into water stays in it (the game's waterlogged state: a wet block of its own here)
    const wet = R.get(x, y, z) === B.water ? B['lc2_wet_' + d.name] : undefined;
    R.set(x, y, z, wet !== undefined ? wet : st.id, st.meta);
  }
  return true;
};
const isDoubleData = d => d.shape === 'tall' || d.tall === true;
// a two-block plant: the lower half here, the upper half above
export function placeDouble(R, st, x, y, z) {
  const d = BLOCKS[st.id];
  R.set(x, y, z, st.id, st.meta & ~8);
  if (d.upper && B[d.upper] !== undefined) R.set(x, y + 1, z, B[d.upper], 0);
  else R.set(x, y + 1, z, st.id, (st.meta | 8));
}

// pick one of several features
FEATURES.random_selector = (D, c, r, x, y, z) => {
  for (const e of c.features) if (r.nextFloat() < F(e.chance)) return placePlaced(D, e.feature, r, x, y, z);
  return placePlaced(D, c.default, r, x, y, z);
};
FEATURES.simple_random_selector = (D, c, r, x, y, z) => {
  const list = c.features;
  return placePlaced(D, list[r.nextInt(list.length)], r, x, y, z);
};
FEATURES.random_boolean_selector = (D, c, r, x, y, z) => placePlaced(D, r.nextBoolean() ? c.feature_true : c.feature_false, r, x, y, z);
FEATURES.weighted_random_selector = (D, c, r, x, y, z) => {
  const list = c.features || c.entries;
  let tot = 0; for (const e of list) tot += e.weight;
  let k = r.nextInt(tot);
  for (const e of list) { k -= e.weight; if (k < 0) return placePlaced(D, e.data ?? e.feature, r, x, y, z); }
  return false;
};
/* A sequence goes on only while each step places something (the deep
   dark's catalyst sits only in a sculk patch that was made, the sulfur
   pool's last block only beside its pool); an overlay places every part. */
FEATURES.sequence = (D, c, r, x, y, z) => {
  for (const f of c.features) if (!placePlaced(D, f, r, x, y, z)) return false;
  return true;
};
FEATURES.overlay = (D, c, r, x, y, z) => {
  let any = false;
  for (const f of c.features) if (placePlaced(D, f, r, x, y, z)) any = true;
  return any;
};

// a column of blocks in layers (cactus, sugar cane, kelp, dripleaf...)
FEATURES.block_column = (D, c, r, x, y, z) => {
  const R = D.region;
  const layers = c.layers;
  const n = layers.length;
  const heights = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) { heights[i] = sampleInt(layers[i].height, r); total += heights[i]; }
  if (total === 0) return false;
  const dy = c.direction === 'down' ? -1 : 1;
  const allowed = predicate(c.allowed_placement);
  let k;
  for (k = 0; k < total; k++) {
    if (!allowed(R, x, y + k * dy, z)) { truncate(heights, total, k, !!c.prioritize_tip); break; }
  }
  let o = 0;
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    if (h === 0) continue;
    const prov = provider(layers[i].provider);
    for (let j = 0; j < h; j++) {
      const st = prov(r, x, y + o * dy, z, R);
      R.set(x, y + o * dy, z, st.id, st.meta);
      o++;
    }
  }
  return true;
};
function truncate(heights, total, target, tip) {
  let excess = total - target;
  const dir = tip ? -1 : 1;
  const start = tip ? 0 : heights.length - 1;
  const end = tip ? heights.length : -1;
  for (let i = start; i !== end; i += (tip ? 1 : -1)) {
    const h = heights[i];
    const cut = Math.min(h, excess);
    excess -= cut;
    heights[i] -= cut;
    if (excess === 0) break;
  }
  void dir;
}

/* ---- ores ---- */
function canPlaceOre(R, b, m, r, c, target, x, y, z) {
  if (!ruleTest(target.target)(b, m, r, y)) return false;
  const ch = c.discard_chance_on_air_exposure || 0;
  if (ch <= 0) return true;
  if (!(ch >= 1) && r.nextFloat() >= ch) return true;
  return !(isAirId(R.get(x - 1, y, z)) || isAirId(R.get(x + 1, y, z)) || isAirId(R.get(x, y - 1, z)) || isAirId(R.get(x, y + 1, z)) || isAirId(R.get(x, y, z - 1)) || isAirId(R.get(x, y, z + 1)));
}
const PI_F = F(Math.PI);
FEATURES.ore = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const size = c.size;
  const f = F(r.nextFloat() * PI_F);
  const g = F(size / 8);
  const i = Math.ceil(F(F(F(F(size / 16) * 2) + 1) / 2));
  const sf = Math.sin(f), cf = Math.cos(f);
  const x1 = ox + sf * g, x2 = ox - sf * g;
  const z1 = oz + cf * g, z2 = oz - cf * g;
  const y1 = oy + r.nextInt(3) - 2, y2 = oy + r.nextInt(3) - 2;
  const cg = Math.ceil(g);
  const minX = ox - cg - i, minY = oy - 2 - i, minZ = oz - cg - i;
  const W = 2 * (cg + i), Hh = 2 * (2 + i);
  for (let s = minX; s <= minX + W; s++) for (let t = minZ; t <= minZ + W; t++) {
    if (minY > R.height('OCEAN_FLOOR_WG', s, t)) continue;
    return orePlace(R, r, c, x1, x2, z1, z2, y1, y2, minX, minY, minZ, W, Hh);
  }
  return false;
};
function orePlace(R, r, c, x1, x2, z1, z2, y1, y2, minX, minY, minZ, W, Hh) {
  let placed = 0;
  const size = c.size;
  const done = new Uint8Array((W + 1) * (Hh + 1) * (W + 1) + W * Hh * W + 64);
  const ds = new Float64Array(size * 4);
  for (let u = 0; u < size; u++) {
    const fu = F(u / size);
    const d = x1 + fu * (x2 - x1), e = y1 + fu * (y2 - y1), g = z1 + fu * (z2 - z1);
    const h = r.nextDouble() * size / 16;
    const l = ((F(msin(F(PI_F * fu)) + 1)) * h + 1) / 2;
    ds[u * 4] = d; ds[u * 4 + 1] = e; ds[u * 4 + 2] = g; ds[u * 4 + 3] = l;
  }
  for (let u = 0; u < size - 1; u++) {
    if (ds[u * 4 + 3] <= 0) continue;
    for (let v = u + 1; v < size; v++) {
      if (ds[v * 4 + 3] <= 0) continue;
      const d = ds[u * 4] - ds[v * 4], e = ds[u * 4 + 1] - ds[v * 4 + 1], g = ds[u * 4 + 2] - ds[v * 4 + 2], h = ds[u * 4 + 3] - ds[v * 4 + 3];
      if (!(h * h > d * d + e * e + g * g)) continue;
      if (h > 0) ds[v * 4 + 3] = -1; else ds[u * 4 + 3] = -1;
    }
  }
  const targets = c.targets;
  for (let v = 0; v < size; v++) {
    const d = ds[v * 4 + 3];
    if (d < 0) continue;
    const e = ds[v * 4], g = ds[v * 4 + 1], h = ds[v * 4 + 2];
    const xa = Math.max(Math.floor(e - d), minX), ya = Math.max(Math.floor(g - d), minY), za = Math.max(Math.floor(h - d), minZ);
    const xb = Math.max(Math.floor(e + d), xa), yb = Math.max(Math.floor(g + d), ya), zb = Math.max(Math.floor(h + d), za);
    for (let X = xa; X <= xb; X++) {
      const ag = (X + 0.5 - e) / d;
      if (!(ag * ag < 1)) continue;
      for (let Y = ya; Y <= yb; Y++) {
        const ai = (Y + 0.5 - g) / d;
        if (!(ag * ag + ai * ai < 1)) continue;
        for (let Z = za; Z <= zb; Z++) {
          const ak = (Z + 0.5 - h) / d;
          if (!(ag * ag + ai * ai + ak * ak < 1) || Y < MIN_Y || Y > MAX_Y) continue;
          const idx = X - minX + (Y - minY) * W + (Z - minZ) * W * Hh;
          if (done[idx]) continue;
          done[idx] = 1;
          if (!R.canWrite(X, Y, Z)) continue;
          const b = R.get(X, Y, Z), m = R.meta(X, Y, Z);
          for (const tg of targets) {
            if (!canPlaceOre(R, b, m, r, c, tg, X, Y, Z)) continue;
            const st = tg._st || (tg._st = stateFrom(tg.state));
            R.set(X, Y, Z, st.id, st.meta);
            placed++;
            break;
          }
        }
      }
    }
  }
  return placed > 0;
}
FEATURES.scattered_ore = (D, c, r, x, y, z) => {
  const R = D.region;
  const n = r.nextInt(c.size + 1);
  for (let j = 0; j < n; j++) {
    const sp = Math.min(j, 7);
    const ax = () => Math.round(F(F(r.nextFloat() - r.nextFloat()) * sp));
    const X = x + ax(), Y = y + ax(), Z = z + ax();
    const b = R.get(X, Y, Z), m = R.meta(X, Y, Z);
    for (const tg of c.targets) {
      if (!canPlaceOre(R, b, m, r, c, tg, X, Y, Z)) continue;
      const st = tg._st || (tg._st = stateFrom(tg.state));
      R.set(X, Y, Z, st.id, st.meta);
      break;
    }
  }
  return true;
};

/* ---- disks (sand, clay and gravel under water) ---- */
FEATURES.disk = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const top = oy + c.half_height, bottom = oy - c.half_height - 1;
  const rad = sampleInt(c.radius, r);
  const target = predicate(c.target);
  const prov = provider(c.state_provider);
  let any = false;
  for (let z = oz - rad; z <= oz + rad; z++) for (let x = ox - rad; x <= ox + rad; x++) {
    const n = x - ox, o = z - oz;
    if (n * n + o * o > rad * rad) continue;
    for (let y = top; y > bottom; y--) {
      if (target(R, x, y, z)) {
        const st = prov(r, x, y, z, R);
        R.set(x, y, z, st.id, st.meta);
        any = true;
      }
    }
  }
  return any;
};

/* ---- springs ---- */
FEATURES.spring_feature = (D, c, r, x, y, z) => {
  const R = D.region;
  const valid = new Uint8Array(4096);
  for (const b of (Array.isArray(c.valid_blocks) ? c.valid_blocks : [c.valid_blocks])) {
    const n = strip(b);
    if (n.startsWith('#')) { const s = tag(n.slice(1)); for (let i = 0; i < 4096; i++) if (s[i]) valid[i] = 1; }
    else if (B[n] !== undefined) valid[B[n]] = 1;
  }
  // the game's defaults when the data leaves them out: a block below, four rock sides and one way out
  const needBelow = c.requires_block_below ?? true, rocks = c.rock_count ?? 4, holes = c.hole_count ?? 1;
  if (!valid[R.get(x, y + 1, z)]) return false;
  if (needBelow && !valid[R.get(x, y - 1, z)]) return false;
  const here = R.get(x, y, z);
  if (!isAirId(here) && !valid[here]) return false;
  let rock = 0, hole = 0;
  for (const [dx, dy, dz] of [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [0, -1, 0]]) {
    const b = R.get(x + dx, y + dy, z + dz);
    if (valid[b]) rock++;
    if (isAirId(b)) hole++;
  }
  if (rock === rocks && hole === holes) {
    const fl = strip((c.state && (c.state.Name || c.state.id)) || 'water');
    const kind = fl.includes('lava') ? 2 : 1;
    R.set(x, y, z, kind === 2 ? B.lava : B.water, 0);
    // the game ticks a new spring at once, so it has run out over the rock by the time anyone sees it
    flowOut(R, x, y, z, kind);
    return true;
  }
  return false;
};

/* A fluid running out of a new source until it settles, by the rules the
   game's own water and lava follow (fluids.js): pour down where it can,
   else spread sideways towards the nearest way down within reach (4 blocks
   for water, 2 for lava), one level less each block (two for lava, which
   stops after three). What it settles to is what fluids.js would make, so
   it stays as it is until something next to it changes. It never leaves the
   region the chunk can write to. */
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const F_LEVEL = 7, F_FALLING = 8;
/* The game ticks the water and lava its aquifers leave against a cave (and
   every new spring) once a chunk is made, so by the time anyone sees them
   they have run out over the rock: a cave lake with a cave beside it spills
   in, rather than standing as a wall of water. The same here, for this
   chunk's own still water and lava with open air under or beside it, and
   for any still water or lava (in this chunk or a neighbour) that one of
   this chunk's features opened up, say a geode dug under the sea floor. */
const OPEN_SIDES = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
function runOut(R) {
  const budget = { n: 20000 };
  const still = (x, y, z) => { const b = R.get(x, y, z); return (b === B.water || b === B.lava) && R.meta(x, y, z) === 0 ? b : 0; };
  const open = (x, y, z) => OPEN_SIDES.some(([dx, dy, dz]) => isAirId(R.get(x + dx, y + dy, z + dz)));
  const c = R.chunks[4], x0 = R.x0 + 16, z0 = R.z0 + 16, W = B.water, L = B.lava;
  const shut = id => id !== 0 && !isAirId(id);
  for (let i = 256; i < VOLI && budget.n > 0; i++) {
    const bl = c.blocks, b = bl[i];
    if ((b !== W && b !== L) || c.meta[i] !== 0) continue;
    const lx = i & 15, lz = (i >> 4) & 15;
    // (inside the chunk the neighbours are read straight from it: a sea is a lot of water)
    if (lx > 0 && lx < 15 && lz > 0 && lz < 15 && shut(bl[i - 256]) && shut(bl[i + 1]) && shut(bl[i - 1]) && shut(bl[i + 16]) && shut(bl[i - 16])) continue;
    const x = x0 + lx, z = z0 + lz, y = (i >> 8) + MIN_Y;
    if (open(x, y, z)) flowOut(R, x, y, z, b === W ? 1 : 2, budget);
  }
  // the air this chunk's features made, wherever it is, and the fluid around it
  for (let k = 0; k < 9 && budget.n > 0; k++) {
    const ch = R.chunks[k];
    if (!ch.writes) continue;
    const cx0 = R.x0 + (k % 3) * 16, cz0 = R.z0 + Math.floor(k / 3) * 16;
    for (const [i, v] of ch.writes) {
      if (!isAirId(v >> 8) || budget.n <= 0) continue;
      const x = cx0 + (i & 15), z = cz0 + ((i >> 4) & 15), y = (i >> 8) + MIN_Y;
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const b = still(x + dx, y + dy, z + dz);
        if (b) flowOut(R, x + dx, y + dy, z + dz, b === B.water ? 1 : 2, budget);
      }
    }
  }
}
function flowOut(R, sx, sy, sz, kind, budget) {
  const FB = kind === 1 ? B.water : B.lava;
  const drop = kind === 1 ? 1 : 2, reach = kind === 1 ? 4 : 2, max = kind === 1 ? 7 : 6;
  const inside = (x, y, z) => R.inside(x, z) && y > MIN_Y && y <= MAX_Y;
  const kindAt = (x, y, z) => fluidOf(R.get(x, y, z)) === 1 && R.get(x, y, z) !== B.water ? 0 : fluidOf(R.get(x, y, z));
  const open = (x, y, z) => {
    if (!inside(x, y, z)) return false;
    const b = R.get(x, y, z);
    if (isAirId(b)) return true;
    const d = BLOCKS[b];
    return !d.solid && !d.fluid && !fluidOf(b) && (d.replaceable || d.shape === 'cross');
  };
  const isSource = (x, y, z) => kindAt(x, y, z) === kind && (R.meta(x, y, z) & (F_LEVEL | F_FALLING)) === 0;
  const levelOf = (x, y, z) => {
    if (kindAt(x, y, z) !== kind) return 99;
    const m = R.meta(x, y, z);
    return m & F_FALLING ? 0 : m & F_LEVEL;
  };
  const queue = [], queued = new Set();
  const key = (x, y, z) => (x - R.x0) + ',' + y + ',' + (z - R.z0);
  const wake = (x, y, z) => {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const k = key(x + dx, y + dy, z + dz);
      if (kindAt(x + dx, y + dy, z + dz) && !queued.has(k)) { queued.add(k); queue.push(x + dx, y + dy, z + dz); }
    }
  };
  const place = (x, y, z, level, falling) => {
    const other = kindAt(x, y, z);
    if (other && other !== kind) {
      R.set(x, y, z, R.meta(x, y, z) === 0 ? (other === 2 ? B.obsidian : B.stone) : B.cobblestone, 0);
      return;
    }
    const b = R.get(x, y, z), d = BLOCKS[b];
    // a tall plant in the way goes whole
    if (b && d.upper && R.get(x, y + 1, z) === B[d.upper]) R.set(x, y + 1, z, 0, 0);
    if (R.set(x, y, z, FB, (falling ? F_FALLING : 0) | (level & F_LEVEL))) wake(x, y, z);
  };
  const distToDrop = (x, y, z, fx, fz) => {
    if (open(x, y - 1, z) || kindAt(x, y - 1, z)) return 0;
    let frontier = [[x, z]];
    const seen = new Set([x + ',' + z]);
    for (let d = 1; d <= reach; d++) {
      const nxt = [];
      for (const [cx, cz] of frontier) for (const [dx, dz] of SIDES) {
        const nx = cx + dx, nz = cz + dz, k = nx + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!open(nx, y, nz) && !kindAt(nx, y, nz)) continue;
        if (open(nx, y - 1, nz) || (kindAt(nx, y - 1, nz) && !isSource(nx, y - 1, nz))) return d;
        nxt.push([nx, nz]);
      }
      frontier = nxt;
    }
    return 99;
  };
  wake(sx, sy, sz);
  const most = budget ? budget.n : 4000;
  let n = 0;
  for (let q = 0; q < queue.length && n < most; n++, q += 3) {
    const x = queue[q], y = queue[q + 1], z = queue[q + 2];
    queued.delete(key(x, y, z));
    if (kindAt(x, y, z) !== kind) continue;
    let meta = R.meta(x, y, z);
    const source = (meta & (F_LEVEL | F_FALLING)) === 0;
    // lava with water at its side or on top hardens
    if (kind === 2 && [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => kindAt(x + dx, y + dy, z + dz) === 1)) {
      R.set(x, y, z, source ? B.obsidian : B.cobblestone, 0);
      continue;
    }
    if (!source) {
      let want;
      if (kindAt(x, y + 1, z) === kind) want = F_FALLING;
      else {
        let best = 99, sources = 0;
        for (const [dx, dz] of SIDES) {
          const l = levelOf(x + dx, y, z + dz);
          if (l < best) best = l;
          if (isSource(x + dx, y, z + dz)) sources++;
        }
        const below = R.get(x, y - 1, z);
        if (kind === 1 && sources >= 2 && ((below && BLOCKS[below].solid) || isSource(x, y - 1, z))) want = 0;
        else want = best + drop <= max ? best + drop : -1;
      }
      if (want === -1) { R.set(x, y, z, 0, 0); wake(x, y, z); continue; }
      if (want !== meta) { R.set(x, y, z, FB, want); meta = want; wake(x, y, z); }
    }
    const level = meta & F_FALLING ? 0 : meta & F_LEVEL;
    const under = kindAt(x, y - 1, z);
    if (open(x, y - 1, z) || (under && under !== kind)) {
      place(x, y - 1, z, 0, true);
      if (!source) continue;
    } else if (under === kind && !source) continue;          // pouring into more of itself (a falling column too: it never spreads over its own pool)
    const next = level + drop;
    if (next > max) continue;
    const ways = [];
    let bestD = 99;
    for (const [dx, dz] of SIDES) {
      const nx = x + dx, nz = z + dz;
      if (!open(nx, y, nz) && !(kindAt(nx, y, nz) === kind && levelOf(nx, y, nz) > next)) continue;
      const d = distToDrop(nx, y, nz, -dx, -dz);
      if (d < bestD) { bestD = d; ways.length = 0; }
      if (d === bestD) ways.push(nx, nz);
    }
    for (let k = 0; k < ways.length; k += 2) place(ways[k], y, ways[k + 1], next, false);
  }
  if (budget) budget.n -= n;
}

/* ---- snow and ice on the top layer ---- */
FEATURES.freeze_top_layer = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    const x = ox + i, z = oz + j;
    const y = R.height('MOTION_BLOCKING', x, z);
    // the biome above the top block decides both
    const bn = BIOMES[R.biome(x, y, z)].name;
    // ice on still water at the top
    if (coldEnoughToSnow(bn, x, y - 1, z)) {
      const b = R.get(x, y - 1, z);
      if (b === B.water && R.meta(x, y - 1, z) === 0) R.set(x, y - 1, z, B.ice, 0);
    }
    // and a layer of snow where it can lie
    if (coldEnoughToSnow(bn, x, y, z) && y >= MIN_Y && y <= MAX_Y) {
      const b = R.get(x, y, z);
      if ((isAirId(b) || b === B.snow) && survives(R, { id: B.snow, meta: 0 }, x, y, z)) {
        R.set(x, y, z, B.snow, 0);
      }
    }
  }
  return true;
};

/* ======================================================= the decorator == */
export class Decorator {
  constructor(gen) {
    this.gen = gen;
    this.carve = true;
    this.features = true;
    const D = gen.data;
    FeatureData.tags = D.block_tags || {};
    FeatureData.placed = D.placed_feature;
    FeatureData.configured = D.configured_feature;
    FeatureData.biome = D.biome;
    this.steps = sortFeatures(D);
    // per biome id: which placed features it lists (for the biome filter)
    this.biomeSets = new Map();
    this.unknown = new Set();
    this.r = new WorldgenXoroshiro();
    this.dryR = new WorldgenXoroshiro();       // for lakePlan, which runs in the middle of a decoration
    this.plans = new Map();
    this.canopy = new Map();
    this.grids = new Map();
  }
  biomeHas(bid, name) {
    let s = this.biomeSets.get(bid);
    if (!s) {
      s = new Set();
      const b = FeatureData.biome[BIOMES[bid].name];
      if (b) for (const step of b.features) for (const f of step) s.add(f);
      this.biomeSets.set(bid, s);
    }
    return s.has(name);
  }
  unknownModifier(t) { this.unknown.add('placement ' + t); }
  /* Decorate one chunk against its neighbours' terrain; returns the region
     (whose chunks carry the writes). */
  decorateSource(cx, cz) {
    const R = new Region(this.gen, cx, cz);
    const D = this.context(R, this.r);
    // a lake that would run into a lake of a chunk decorated before this one is not dug (see lakePlan)
    D.lakeClash = box => {
      for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0]]) {
        for (const b of this.lakePlan(cx + dx, cz + dz)) {
          if (b[0] <= box[3] && b[3] >= box[0] && b[1] <= box[4] && b[4] >= box[1] && b[2] <= box[5] && b[5] >= box[2]) return true;
        }
      }
      return false;
    };
    /* The game decorates chunks one after another, so a chunk's trees find
       the trees of the chunks decorated before it already standing (and do
       not grow into their crowns); decorated on its own, a dense forest
       would get a third more trees than the game's. So, in the same fixed
       order as the lakes, the trees of the four chunks before this one are
       worked out first (see treePlan) and stand in the region while this
       chunk is decorated, without being this chunk's to place. */
    const before = [];
    for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0]]) {
      const plan = this.treePlan(cx, cz, cx + dx, cz + dz, before);
      for (let k = 0; k < plan.length; k++) before.push(plan[k]);
    }
    for (let k = 0; k < before.length; k += 4) R.preset(before[k], before[k + 1], before[k + 2], before[k + 3] >> 8, before[k + 3] & 255);
    this.run(D, cx, cz, this.steps.length);
    runOut(R);
    return R;
  }
  /* The trees (and huge mushrooms and fallen logs) a neighbour (nx, nz)
     would grow, as [x, y, z, block * 256 + meta, ...], worked out in the
     region round the chunk being decorated (cx, cz): only the part near that
     chunk matters, and the region holds it, so no other terrain is needed.
     Each neighbour's trees are worked out with those of the neighbours
     before it in the same order already standing (the ones of the four
     that come before it); further back is not looked at. */
  treePlan(cx, cz, nx, nz, before) {
    const R = new Region(this.gen, cx, cz);
    for (let k = 0; k < before.length; k += 4) R.preset(before[k], before[k + 1], before[k + 2], before[k + 3] >> 8, before[k + 3] & 255);
    this.run(this.context(R, this.dryR), nx, nz, this.steps.length, VEGETAL, name => this.growsCanopy(name));
    const out = [];
    for (let k = 0; k < 9; k++) {
      const c = R.chunks[k];
      if (!c.writes) continue;
      const ox = R.x0 + (k % 3) * 16, oz = R.z0 + Math.floor(k / 3) * 16;
      for (const [i, v] of c.writes) out.push(ox + (i & 15), (i >> 8) + MIN_Y, oz + ((i >> 4) & 15), v);
    }
    return out;
  }
  // whether a placed feature grows a tree, a huge mushroom or a fallen log (through any selector)
  growsCanopy(ref, depth = 0) {
    const key = typeof ref === 'string' ? ref : null;
    if (key !== null && this.canopy.has(key)) return this.canopy.get(key);
    let yes = false;
    const pf = placedOf(ref), cfg = configuredOf(pf.feature);
    if (cfg && depth < 8) {
      const t = strip(cfg.type);
      if (t === 'tree' || t === 'fallen_tree' || t === 'huge_brown_mushroom' || t === 'huge_red_mushroom') yes = true;
      else if (t === 'random_selector') yes = cfg.features.some(e => this.growsCanopy(e.feature, depth + 1)) || this.growsCanopy(cfg.default, depth + 1);
      else if (t === 'simple_random_selector') yes = cfg.features.some(f => this.growsCanopy(f, depth + 1));
      else if (t === 'random_boolean_selector') yes = this.growsCanopy(cfg.feature_true, depth + 1) || this.growsCanopy(cfg.feature_false, depth + 1);
      else if (t === 'weighted_random_selector') yes = (cfg.features || cfg.entries).some(e => this.growsCanopy(e.data ?? e.feature, depth + 1));
    }
    if (key !== null) this.canopy.set(key, yes);
    return yes;
  }
  context(R, r) {
    return { region: R, gen: this.gen, biomeHas: (b, n) => this.biomeHas(b, n), unknownModifier: t => this.unknownModifier(t), r };
  }
  // every feature of the first n steps for a chunk, in the game's order, each with its own random
  run(D, cx, cz, n, first = 0, only = null) {
    const g = this.gen, R = D.region, r = D.r;
    // the biomes stored in this chunk and the eight around it
    const present = new Set();
    for (const p of R.protos) {
      const gg = p.grid.g;
      for (let j = 1; j <= 4; j++) for (let i = 1; i <= 4; i++) for (let k = 1; k <= 96; k++) present.add(gg[(j * 6 + i) * 98 + k]);
    }
    // the game decorates each chunk with a random of its own, so no Gaussian left over from the chunk
    // before carries into this one (within the chunk one does carry from feature to feature, as reseeding
    // for each feature leaves it be)
    r.gHave = false;
    const deco = decorationSeed(r, g.seed, cx * 16, cz * 16);
    for (let step = first; step < n; step++) {
      const list = this.steps[step];
      R.early = step < 3;          // raw generation, lakes, local modifications: before the structures
      const idx = new Set();
      for (const bid of present) {
        const b = FeatureData.biome[BIOMES[bid].name];
        if (!b || step >= b.features.length) continue;
        for (const f of b.features[step]) idx.add(list.index.get(f));
      }
      const order = [...idx].filter(v => v !== undefined).sort((a, b) => a - b);
      for (const p of order) {
        const name = list.features[p];
        // snow and ice go on once the chunk is put together with its neighbours' features (VanillaGen.generate)
        if (name === 'freeze_top_layer') continue;
        if (only && !only(name)) continue;
        featureSeed(r, deco, p, step);
        try {
          placePlaced(D, name, r, cx * 16, MIN_Y, cz * 16, name);
        } catch (e) {
          this.unknown.add('error ' + name + ': ' + e.message);
        }
      }
    }
  }
  /* The lakes a chunk would dig (their boxes), worked out without digging
     them. The game decorates chunks one after another, so a lake meeting
     another chunk's lake finds it there and gives up; decorated on their
     own, both would be dug and leave one's water standing against the
     other's open air. So chunks take a fixed order (row by row, west to
     east), and a lake gives way to any lake of a chunk before it. */
  lakePlan(cx, cz) {
    const key = cx + ',' + cz;
    let plan = this.plans.get(key);
    if (plan) return plan;
    plan = [];
    const R = new LazyRegion(this.gen, cx, cz, (x, z) => this.gridOf(x, z));
    R.dry = plan;
    this.run(this.context(R, this.dryR), cx, cz, 2);       // raw generation and lakes
    this.plans.set(key, plan);
    if (this.plans.size > 400) this.plans.delete(this.plans.keys().next().value);
    return plan;
  }
  // a chunk's biome grid alone, kept for the lake plans of the chunks round it (a few kilobytes each)
  gridOf(x, z) {
    const g = this.grids.get(x + ',' + z);
    return g || this.keepGrid(x, z, this.gen.biomeGrid(x, z));
  }
  // (and one handed in with a decoration, from a terrain made elsewhere: js/worker.js)
  keepGrid(x, z, g) {
    this.grids.set(x + ',' + z, g);
    if (this.grids.size > 512) this.grids.delete(this.grids.keys().next().value);
    return g;
  }
  warmEnoughToMelt(biome, x, y, z) {
    return temperatureAt(BIOMES[biome].name, x, y, z) > F(0.1);
  }
  missingFeatures() { return [...missing]; }
}

/* FeatureSorter: every biome's per-step feature lists merged into one order
   per step (a depth-first topological sort, as the game does), so a
   feature's index - and with it its random seed - is the same everywhere. */
// the decoration step trees grow in (vegetal decoration, the tenth of the game's eleven)
const VEGETAL = 9;
export function sortFeatures(D) {
  const bp = D.biome_params;
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // the biomes in the order the biome table first lists them
  const biomes = [];
  for (let o = 0; o < bp.entries.length; o += bp.width) {
    const n = bp.names[alpha.indexOf(bp.entries[o])];
    if (!biomes.includes(n)) biomes.push(n);
  }
  const fIndex = new Map();
  let counter = 0;
  const nodes = new Map();       // key "step:index" -> node
  const keyOf = (step, fi) => step * 100000 + fi;
  const cmp = (a, b) => a.key - b.key;
  let maxStep = 0;
  for (const bn of biomes) {
    const steps = (D.biome[bn] && D.biome[bn].features) || [];
    maxStep = Math.max(maxStep, steps.length);
    const list = [];
    for (let s = 0; s < steps.length; s++) for (const f of steps[s]) {
      if (!fIndex.has(f)) fIndex.set(f, counter++);
      const k = keyOf(s, fIndex.get(f));
      let n = nodes.get(k);
      if (!n) { n = { key: k, step: s, name: f, next: new Map() }; nodes.set(k, n); }
      list.push(n);
    }
    for (let k = 0; k < list.length - 1; k++) list[k].next.set(list[k + 1].key, list[k + 1]);
  }
  const visited = new Set(), inProgress = new Set(), sorted = [];
  const dfs = n => {
    if (visited.has(n)) return false;
    if (inProgress.has(n)) return true;
    inProgress.add(n);
    const nexts = [...n.next.values()].sort(cmp);
    for (const m of nexts) if (dfs(m)) return true;
    inProgress.delete(n);
    visited.add(n);
    sorted.push(n);
    return false;
  };
  for (const n of [...nodes.values()].sort(cmp)) {
    if (visited.has(n)) continue;
    if (dfs(n)) throw new Error('feature order has a cycle');
  }
  sorted.reverse();
  const steps = [];
  for (let s = 0; s < maxStep; s++) {
    const features = sorted.filter(n => n.step === s).map(n => n.name);
    const index = new Map(features.map((f, i) => [f, i]));
    steps.push({ features, index });
  }
  return steps;
}
