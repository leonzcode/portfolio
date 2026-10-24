/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: where they go.

   The same rules the game uses (Minecraft 1.18 and later, its structure
   sets):

   Random spread. The world is cut into square regions `spacing` chunks
   across; each region gets one try, at a chunk picked by a Java random
   seeded from the world seed, the region and the set's salt, somewhere in
   its first `spacing - separation` chunks (straight, or the average of two
   picks for the "triangular" sets, which keeps them off the edges). Some
   sets then only keep a share of their tries (the frequency, with one of
   the game's four old reducers), and pillager outposts stay out of range
   of any village try.

   Then the structure itself: a set can hold several (the five villages, the
   seven ruined portals...), and they are tried in a weighted random order,
   each one asking for its own biome at its own spot (the middle of the
   chunk, at the ground, for most; deeper down for mineshafts and ancient
   cities). The first that fits is built.

   Strongholds use rings instead: 128 of them, 3 in the first ring 1280 to
   2816 blocks out, then 6, 10, 15, 21, 28, 36 and 9, each nudged to a spot
   in a preferred biome within 112 blocks.

   Biomes come from a pluggable source (see makeSource): the vanilla biome
   source where there is one, else this game's own picker.
--------------------------------------------------------------------------- */
import { JRand, toLong, largeFeature, largeFeatureWithSalt } from './rand.js?v=107';

/* ============================================================ the data ==
   Every structure set the game ships (data/minecraft/worldgen/structure_set). */
export const SETS = {
  villages: { spacing: 34, separation: 8, salt: 10387312, list: [['village_plains', 1], ['village_desert', 1], ['village_savanna', 1], ['village_snowy', 1], ['village_taiga', 1]] },
  desert_pyramids: { spacing: 32, separation: 8, salt: 14357617, list: [['desert_pyramid', 1]] },
  igloos: { spacing: 32, separation: 8, salt: 14357618, list: [['igloo', 1]] },
  jungle_temples: { spacing: 32, separation: 8, salt: 14357619, list: [['jungle_pyramid', 1]] },
  swamp_huts: { spacing: 32, separation: 8, salt: 14357620, list: [['swamp_hut', 1]] },
  pillager_outposts: { spacing: 32, separation: 8, salt: 165745296, list: [['pillager_outpost', 1]], frequency: 0.2, reducer: 'legacy_type_1', exclusion: { set: 'villages', chunks: 10 } },
  ancient_cities: { spacing: 24, separation: 8, salt: 20083232, list: [['ancient_city', 1]] },
  ocean_monuments: { spacing: 32, separation: 5, salt: 10387313, triangular: true, list: [['monument', 1]] },
  woodland_mansions: { spacing: 80, separation: 20, salt: 10387319, triangular: true, list: [['mansion', 1]] },
  shipwrecks: { spacing: 24, separation: 4, salt: 165745295, list: [['shipwreck', 1], ['shipwreck_beached', 1]] },
  ocean_ruins: { spacing: 20, separation: 8, salt: 14357621, list: [['ocean_ruin_cold', 1], ['ocean_ruin_warm', 1]] },
  ruined_portals: { spacing: 40, separation: 15, salt: 34222645, list: [['ruined_portal', 1], ['ruined_portal_desert', 1], ['ruined_portal_jungle', 1], ['ruined_portal_swamp', 1], ['ruined_portal_mountain', 1], ['ruined_portal_ocean', 1], ['ruined_portal_nether', 1]] },
  buried_treasures: { spacing: 1, separation: 0, salt: 0, list: [['buried_treasure', 1]], frequency: 0.01, reducer: 'legacy_type_2', locateOffset: [9, 9] },
  mineshafts: { spacing: 1, separation: 0, salt: 0, list: [['mineshaft', 1], ['mineshaft_mesa', 1]], frequency: 0.004, reducer: 'legacy_type_3' },
  trail_ruins: { spacing: 34, separation: 8, salt: 83469867, list: [['trail_ruins', 1]] },
  trial_chambers: { spacing: 34, separation: 12, salt: 94251327, list: [['trial_chambers', 1]] },
  nether_complexes: { spacing: 27, separation: 4, salt: 30084232, dim: 'nether', list: [['fortress', 2], ['bastion_remnant', 3]] },
  end_cities: { spacing: 20, separation: 11, salt: 10387313, triangular: true, dim: 'end', list: [['end_city', 1]] },
  strongholds: { rings: { distance: 32, spread: 3, count: 128 }, list: [['stronghold', 1]] },
};
for (const k in SETS) { SETS[k].name = k; if (!SETS[k].dim) SETS[k].dim = 'overworld'; }

/* Biome tags (data/minecraft/tags/worldgen/biome, as of 26.3). */
const TAG = {};
TAG.is_deep_ocean = ['deep_frozen_ocean', 'deep_cold_ocean', 'deep_ocean', 'deep_lukewarm_ocean'];
TAG.is_ocean = [...TAG.is_deep_ocean, 'frozen_ocean', 'ocean', 'cold_ocean', 'lukewarm_ocean', 'warm_ocean'];
TAG.is_river = ['river', 'frozen_river'];
TAG.is_beach = ['beach', 'snowy_beach'];
TAG.is_badlands = ['badlands', 'eroded_badlands', 'wooded_badlands'];
TAG.is_nether = ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'];
TAG.is_overworld = [...TAG.is_ocean, ...TAG.is_river, ...TAG.is_beach, ...TAG.is_badlands, 'bamboo_jungle', 'birch_forest', 'cherry_grove',
  'dappled_forest', 'dark_forest', 'deep_dark', 'desert', 'dripstone_caves', 'flower_forest', 'forest', 'frozen_peaks', 'grove', 'ice_spikes',
  'jagged_peaks', 'jungle', 'lush_caves', 'mangrove_swamp', 'meadow', 'mushroom_fields', 'old_growth_birch_forest', 'old_growth_pine_taiga',
  'old_growth_spruce_taiga', 'pale_garden', 'plains', 'savanna', 'savanna_plateau', 'snowy_plains', 'snowy_slopes', 'snowy_taiga',
  'sparse_jungle', 'stony_peaks', 'stony_shore', 'sulfur_caves', 'sunflower_plains', 'swamp', 'taiga', 'windswept_forest',
  'windswept_gravelly_hills', 'windswept_hills', 'windswept_savanna'];
const set = (...lists) => new Set(lists.flat());
const without = (s, ...names) => { const o = new Set(s); for (const n of names) o.delete(n); return o; };

// where each structure may stand (has_structure/*)
export const BIOMES_OF = {
  village_plains: set('plains', 'meadow'),
  village_desert: set('desert'),
  village_savanna: set('savanna'),
  village_snowy: set('snowy_plains'),
  village_taiga: set('taiga'),
  desert_pyramid: set('desert'),
  igloo: set('snowy_taiga', 'snowy_plains', 'snowy_slopes'),
  jungle_pyramid: set('bamboo_jungle', 'jungle'),
  swamp_hut: set('swamp'),
  pillager_outpost: set('cherry_grove', 'desert', 'frozen_peaks', 'grove', 'jagged_peaks', 'meadow', 'plains', 'savanna', 'snowy_plains',
    'snowy_slopes', 'stony_peaks', 'taiga'),
  ancient_city: set('deep_dark'),
  monument: set(TAG.is_deep_ocean),
  mansion: set('dark_forest', 'pale_garden'),
  shipwreck: set(TAG.is_ocean),
  shipwreck_beached: set(TAG.is_beach),
  ocean_ruin_cold: set('frozen_ocean', 'cold_ocean', 'ocean', 'deep_frozen_ocean', 'deep_cold_ocean', 'deep_ocean'),
  ocean_ruin_warm: set('lukewarm_ocean', 'warm_ocean', 'deep_lukewarm_ocean'),
  ruined_portal: set(TAG.is_beach, TAG.is_river, 'birch_forest', 'dappled_forest', 'dark_forest', 'dripstone_caves', 'flower_forest', 'forest',
    'grove', 'ice_spikes', 'lush_caves', 'mushroom_fields', 'old_growth_birch_forest', 'old_growth_pine_taiga', 'old_growth_spruce_taiga',
    'pale_garden', 'plains', 'savanna', 'snowy_plains', 'snowy_taiga', 'sulfur_caves', 'sunflower_plains', 'taiga'),
  ruined_portal_desert: set('desert'),
  ruined_portal_jungle: set('bamboo_jungle', 'jungle', 'sparse_jungle'),
  ruined_portal_swamp: set('swamp', 'mangrove_swamp'),
  ruined_portal_mountain: set(TAG.is_badlands, 'cherry_grove', 'frozen_peaks', 'jagged_peaks', 'meadow', 'savanna_plateau', 'snowy_slopes',
    'stony_peaks', 'stony_shore', 'windswept_forest', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_savanna'),
  ruined_portal_ocean: set(TAG.is_ocean),
  ruined_portal_nether: set(TAG.is_nether),
  buried_treasure: set(TAG.is_beach),
  mineshaft: without(set(TAG.is_overworld), 'deep_dark', ...TAG.is_badlands),
  mineshaft_mesa: set(TAG.is_badlands),
  trail_ruins: set('taiga', 'snowy_taiga', 'old_growth_pine_taiga', 'old_growth_spruce_taiga', 'old_growth_birch_forest', 'jungle'),
  trial_chambers: without(set(TAG.is_overworld), 'deep_dark'),
  fortress: set(TAG.is_nether),
  bastion_remnant: set('crimson_forest', 'nether_wastes', 'soul_sand_valley', 'warped_forest'),
  end_city: set('end_highlands', 'end_midlands'),
  stronghold: set(TAG.is_overworld),
};
// the abandoned camps (26.x): one per biome, each only in its own
export const CAMP_BIOMES = ['bamboo_jungle', 'birch_forest', 'cherry_grove', 'dappled_forest', 'flower_forest', 'forest', 'meadow',
  'old_growth_pine_taiga', 'old_growth_birch_forest', 'old_growth_spruce_taiga', 'pale_garden', 'savanna', 'snowy_taiga', 'sparse_jungle',
  'swamp', 'taiga', 'windswept_forest', 'wooded_badlands'];
for (const b of CAMP_BIOMES) BIOMES_OF['abandoned_camp_' + b] = set(b);
SETS.abandoned_camp = { name: 'abandoned_camp', dim: 'overworld', spacing: 37, separation: 8, salt: 91231127, list: CAMP_BIOMES.map(b => ['abandoned_camp_' + b, 1]) };

export const STRONGHOLD_BIASED = set(TAG.is_badlands, 'bamboo_jungle', 'birch_forest', 'cherry_grove', 'dark_forest', 'desert', 'dripstone_caves',
  'flower_forest', 'forest', 'frozen_peaks', 'grove', 'ice_spikes', 'jagged_peaks', 'jungle', 'lush_caves', 'meadow', 'mushroom_fields',
  'old_growth_birch_forest', 'old_growth_pine_taiga', 'old_growth_spruce_taiga', 'pale_garden', 'plains', 'savanna', 'savanna_plateau',
  'snowy_plains', 'snowy_slopes', 'snowy_taiga', 'sparse_jungle', 'stony_peaks', 'sulfur_caves', 'sunflower_plains', 'taiga',
  'windswept_forest', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_savanna');
export const MONUMENT_SURROUNDING = set(TAG.is_ocean, TAG.is_river);

// which set each structure belongs to, and the names a search can use for a family
export const SET_OF = {};
for (const k in SETS) for (const [s] of SETS[k].list) SET_OF[s] = k;
export const FAMILY = {
  village: ['village_plains', 'village_desert', 'village_savanna', 'village_snowy', 'village_taiga'],
  ocean_ruin: ['ocean_ruin_cold', 'ocean_ruin_warm'],
  shipwrecks: ['shipwreck', 'shipwreck_beached'],
  mineshafts: ['mineshaft', 'mineshaft_mesa'],
  ruined_portals: SETS.ruined_portals.list.map(e => e[0]),
  abandoned_camp: SETS.abandoned_camp.list.map(e => e[0]),
};

/* =================================================== the biome source ==
   What placement needs to know about the land:
     biome(x, y, z)    the biome name at a block (read at its 4 x 4 x 4 cell)
     ground(x, z)      the y of the highest solid block (the ocean floor at sea)
   plus, for the other dimensions, netherBiome(x, y, z), endBiome(x, z) and
   endGround(x, z). Anything missing is guessed: an unknown biome passes
   every check, so structures still appear. */
export const SEA_LEVEL = 63;
export function heightOf(src, x, z, floor) {
  const g = src.ground(x, z);
  return floor ? g : Math.max(g, SEA_LEVEL - 1);       // WORLD_SURFACE_WG counts water, OCEAN_FLOOR_WG does not
}

/* ====================================================== random spread == */
const R = new JRand(0);
export function potentialChunk(seed, S, rx, rz) {
  largeFeatureWithSalt(R, seed, rx, rz, S.salt);
  const k = S.spacing - S.separation;
  let a, b;
  if (S.triangular) { a = (R.nextInt(k) + R.nextInt(k)) >> 1; b = (R.nextInt(k) + R.nextInt(k)) >> 1; }
  else { a = R.nextInt(k); b = R.nextInt(k); }
  return [rx * S.spacing + a, rz * S.spacing + b];
}
const fdiv = (a, b) => Math.floor(a / b);
export function isPlacementChunk(seed, S, cx, cz) {
  if (S.spacing - S.separation === 1 && S.spacing === 1) return true;        // every chunk is its own region's only spot
  const [px, pz] = potentialChunk(seed, S, fdiv(cx, S.spacing), fdiv(cz, S.spacing));
  return px === cx && pz === cz;
}
// the frequency reducers (StructurePlacement.FrequencyReductionMethod)
function frequencyOK(seed, S, cx, cz) {
  if (!S.frequency || S.frequency >= 1) return true;
  const f = S.frequency;
  switch (S.reducer) {
    case 'legacy_type_1': {
      const i = cx >> 4, j = cz >> 4;
      R.setSeed(BigInt((i ^ (j << 4)) | 0) ^ seed);
      R.nextInt();
      return R.nextInt(Math.trunc(Math.fround(1 / Math.fround(f)))) === 0;
    }
    case 'legacy_type_2':
      largeFeatureWithSalt(R, seed, cx, cz, 10387320);
      return R.nextFloat() < Math.fround(f);
    case 'legacy_type_3':
      largeFeature(R, seed, cx, cz);
      return R.nextDouble() < Math.fround(f);
    default:
      largeFeatureWithSalt(R, seed, S.salt, cx, cz);     // (sic: salt and chunk in the game's own order)
      return R.nextFloat() < Math.fround(f);
  }
}
// a try that survives its frequency and exclusion zone (no biomes yet)
export function isStructureChunk(seed, S, cx, cz) {
  if (!isPlacementChunk(seed, S, cx, cz)) return false;
  if (!frequencyOK(seed, S, cx, cz)) return false;
  if (S.exclusion) {
    const O = SETS[S.exclusion.set], r = S.exclusion.chunks;
    for (let rz = fdiv(cz - r, O.spacing); rz <= fdiv(cz + r, O.spacing); rz++)
      for (let rx = fdiv(cx - r, O.spacing); rx <= fdiv(cx + r, O.spacing); rx++) {
        const [px, pz] = potentialChunk(seed, O, rx, rz);
        if (Math.abs(px - cx) <= r && Math.abs(pz - cz) <= r) return false;
      }
  }
  return true;
}
