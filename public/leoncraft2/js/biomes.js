/* ---------------------------------------------------------------------------
   Leoncraft 2 - the biomes: their climate (which picks the grass and leaf
   colour off the colour maps, the way Minecraft does) and their water.

   temp / rain    temperature and downfall, as the colour maps read them
   water          the water's colour (what it tints and absorbs towards)
   grass, leaf    a fixed colour that overrides the colour map, where the
                  biome has one (swamps, badlands, cherry groves...)
   snowy          precipitation falls as snow (snow layers on the ground)
--------------------------------------------------------------------------- */
export const BIOMES = [];
export const BIO = {};
function bio(name, temp, rain, o) {
  const b = Object.assign({ name, temp, rain, water: 0x3f76e4 }, o || {});
  b.id = BIOMES.length;
  BIOMES.push(b);
  BIO[name] = b.id;
  return b.id;
}

// oceans
bio('ocean', 0.5, 0.5);
bio('deep_ocean', 0.5, 0.5);
bio('warm_ocean', 0.5, 0.5, { water: 0x43d5ee });
bio('lukewarm_ocean', 0.5, 0.5, { water: 0x45adf2 });
bio('deep_lukewarm_ocean', 0.5, 0.5, { water: 0x45adf2 });
bio('cold_ocean', 0.5, 0.5, { water: 0x3d57d6 });
bio('deep_cold_ocean', 0.5, 0.5, { water: 0x3d57d6 });
bio('frozen_ocean', 0.0, 0.5, { water: 0x3938c9, snowy: true });
bio('deep_frozen_ocean', 0.5, 0.5, { water: 0x3938c9, snowy: true });
bio('mushroom_fields', 0.9, 1.0);
// coasts and rivers
bio('beach', 0.8, 0.4);
bio('snowy_beach', 0.05, 0.3, { water: 0x3d57d6, snowy: true });
bio('stony_shore', 0.2, 0.3);
bio('river', 0.5, 0.5);
bio('frozen_river', 0.0, 0.5, { water: 0x3938c9, snowy: true });
// flat lands
bio('plains', 0.8, 0.4);
bio('sunflower_plains', 0.8, 0.4);
bio('snowy_plains', 0.0, 0.5, { snowy: true });
bio('ice_spikes', 0.0, 0.5, { snowy: true });
bio('desert', 2.0, 0.0);
bio('swamp', 0.8, 0.9, { water: 0x617b64, grass: 0x6a7039, leaf: 0x6a7039 });
bio('mangrove_swamp', 0.8, 0.9, { water: 0x3a7a6a, leaf: 0x8db127 });
// forests
bio('forest', 0.7, 0.8);
bio('flower_forest', 0.7, 0.8);
bio('birch_forest', 0.6, 0.6);
bio('old_growth_birch_forest', 0.6, 0.6);
bio('dark_forest', 0.7, 0.8, { darkGrass: true });
bio('taiga', 0.25, 0.8);
bio('old_growth_pine_taiga', 0.3, 0.8);
bio('old_growth_spruce_taiga', 0.25, 0.8);
bio('snowy_taiga', -0.5, 0.4, { water: 0x3d57d6, snowy: true });
bio('jungle', 0.95, 0.9);
bio('sparse_jungle', 0.95, 0.8);
bio('bamboo_jungle', 0.95, 0.9);
// dry lands
bio('savanna', 2.0, 0.0);
bio('savanna_plateau', 2.0, 0.0);
bio('windswept_savanna', 2.0, 0.0);
bio('badlands', 2.0, 0.0, { grass: 0x90814d, leaf: 0x9e814d });
bio('eroded_badlands', 2.0, 0.0, { grass: 0x90814d, leaf: 0x9e814d });
bio('wooded_badlands', 2.0, 0.0, { grass: 0x90814d, leaf: 0x9e814d });
// hills and mountains
bio('windswept_hills', 0.2, 0.3);
bio('windswept_gravelly_hills', 0.2, 0.3);
bio('windswept_forest', 0.2, 0.3);
bio('meadow', 0.5, 0.8, { water: 0x0e4ecf });
bio('cherry_grove', 0.5, 0.8, { water: 0x5db7ef, grass: 0xb6db61, leaf: 0xb6db61 });
bio('grove', -0.2, 0.8, { snowy: true });
bio('snowy_slopes', -0.3, 0.9, { snowy: true });
bio('frozen_peaks', -0.7, 0.9, { snowy: true });
bio('jagged_peaks', -0.7, 0.9, { snowy: true });
bio('stony_peaks', 1.0, 0.3);
// the rest of the game's overworld biomes (the vanilla generator makes them all)
bio('pale_garden', 0.7, 0.8, { water: 0x76889d, grass: 0x778272, leaf: 0x878d76 });
bio('dappled_forest', 0.6, 0.6, { water: 0x375154, grass: 0xdf6827, leaf: 0xe68e30 });
bio('lush_caves', 0.5, 0.5);
bio('dripstone_caves', 0.8, 0.4);
bio('deep_dark', 0.8, 0.4);
bio('sulfur_caves', 0.8, 0.4, { water: 0x34bf89, grass: 0xaba64f });

export const SPRUCE_LEAF = 0x619961, BIRCH_LEAF = 0x80a755;

/* The grass and foliage colour of every biome, read off the colour maps once
   they are loaded (each a 256 x 256 image: temperature across, downfall
   times temperature down). */
export function biomeColours(grassMap, foliageMap) {
  const at = (img, t, r) => {
    const tt = Math.min(1, Math.max(0, t));
    const rr = Math.min(1, Math.max(0, r)) * tt;
    const x = Math.round((1 - tt) * 255), y = Math.round((1 - rr) * 255);
    const o = (y * 256 + x) * 4;
    return (img[o] << 16) | (img[o + 1] << 8) | img[o + 2];
  };
  const out = { grass: new Uint32Array(BIOMES.length), leaf: new Uint32Array(BIOMES.length), water: new Uint32Array(BIOMES.length) };
  for (const b of BIOMES) {
    let g = b.grass !== undefined ? b.grass : at(grassMap, b.temp, b.rain);
    if (b.darkGrass) g = (((g & 0xfefefe) + 0x28340a) >> 1);    // dark forests are darker
    out.grass[b.id] = g;
    out.leaf[b.id] = b.leaf !== undefined ? b.leaf : at(foliageMap, b.temp, b.rain);
    out.water[b.id] = b.water;
  }
  return out;
}
