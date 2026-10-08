/* ---------------------------------------------------------------------------
   Leoncraft 2 - what burns, from the Minecraft Wiki's fire table (Java
   Edition): each block's encouragement (how readily fire jumps next to it)
   and flammability (how readily it burns away). sim/fire.js spreads fire by
   it; models.js draws a fire against the sides that burn, as the game's fire
   model does. Worked out for a block the first time it is asked about (so
   nothing is done while the modules load), from the block's own entry; this
   module imports nothing, so models.js can use it without a loop.
--------------------------------------------------------------------------- */
const RULES = [
  [n => /_planks$/.test(n) && !/crimson|warped/.test(n), 5, 20],
  [n => /_(slab|stairs|fence|fence_gate)$/.test(n) && /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo)/.test(n), 5, 20],
  [n => /_(log|wood)$/.test(n) && !/crimson|warped/.test(n) || /^stripped_.*_(log|wood)$/.test(n) && !/crimson|warped/.test(n), 5, 5],
  [n => /^(stripped_)?bamboo_block$|^bamboo_(mosaic|mosaic_slab|mosaic_stairs)$/.test(n), 5, 20],
  [(n, d) => d.leaves, 30, 60],
  [n => n === 'bookshelf' || n === 'chiseled_bookshelf' || n === 'lectern', 30, 20],
  [n => n === 'tnt', 15, 100],
  [n => /^(short_grass|tall_grass|tall_grass_top_block|fern|large_fern|large_fern_top_block|dead_bush|sweet_berry_bush|small_dripleaf|pink_petals|spore_blossom|wildflowers|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass|cactus_flower)$/.test(n), 60, 100],
  [n => /^(dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|sunflower|lilac|rose_bush|peony|pitcher_plant|open_eyeblossom|closed_eyeblossom)(_top_block)?$/.test(n), 60, 100],
  [n => /_wool$/.test(n), 30, 60],
  [n => /_carpet$/.test(n) && n !== 'moss_carpet', 60, 20],
  [n => n === 'vine' || n === 'glow_lichen' || n === 'big_dripleaf' || n === 'big_dripleaf_stem', 15, 100],
  [n => n === 'cave_vines' || n === 'cave_vines_plant', 15, 60],
  [n => n === 'coal_block', 5, 5],
  [n => n === 'hay_block', 60, 20],
  [n => n === 'target', 15, 20],
  [n => n === 'dried_kelp_block', 30, 60],
  [n => n === 'scaffolding' || n === 'bamboo', 60, 60],
  [n => n === 'composter' || n === 'beehive' || n === 'mangrove_roots', 5, 20],
  [n => n === 'bee_nest', 30, 20],
  [n => n === 'azalea' || n === 'flowering_azalea' || n === 'hanging_roots', 30, 60],
  [n => n === 'moss_block' || n === 'moss_carpet' || n === 'pale_moss_block' || n === 'pale_moss_carpet' || n === 'pale_hanging_moss', 5, 100],
  [n => /_bed$/.test(n), 0, 0],
];
// per block id: encouragement + 256 x flammability + 65536 once worked out (the last rule that matches wins)
const CACHE = new Int32Array(4096);
const look = d => {
  let v = CACHE[d.id];
  if (!v) {
    v = 65536;
    for (const [test, e, f] of RULES) if (test(d.name, d)) v = 65536 | e | (f << 8);
    CACHE[d.id] = v;
  }
  return v;
};
// how readily fire jumps beside a block (its entry), and how readily it burns away; 0 when it does not burn
export const catchOf = d => (d ? look(d) & 255 : 0);
export const burnOf = d => (d ? (look(d) >> 8) & 255 : 0);
// can fire catch beside it (the game's canBurn)?
export const burnable = d => catchOf(d) > 0;
