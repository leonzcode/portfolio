/* ---------------------------------------------------------------------------
   Leoncraft 2 - what each block sounds like.

   The game gives every block a sound type: five sound events (break, step,
   place, hit, fall) and a volume and pitch. They are played as the game
   plays them (the numbers are the Minecraft Wiki's sound tables):

     break, place   volume (v + 1) / 2   pitch p x 0.8
     hit (mining)   volume (v + 1) / 8   pitch p x 0.5   every 4th tick of mining
     fall           volume v x 0.5       pitch p x 0.75  landing hard enough to hurt
     step           volume v x 0.15      pitch p

   Most types are v = p = 1; metal is pitched up (1.5) and the anvil is
   quiet (0.3). A type is named by its events (block.<type>.step and so on),
   so the player's own Minecraft sounds give each block its exact sound, and
   Leoncraft's own pack maps every type onto the nearest recordings it has.

   soundType(id) -> { v, p, brk, step, place, hit, fall } (event names), kept per block id.
--------------------------------------------------------------------------- */
import { BLOCKS } from '../blocks.js?v=107';

const T = (name, v = 1, p = 1) => ({ v, p, brk: `block.${name}.break`, step: `block.${name}.step`, place: `block.${name}.place`, hit: `block.${name}.hit`, fall: `block.${name}.fall`, name });
// the types that borrow another's events for some of their five
const MIX = {
  crop: { v: 1, p: 1, brk: 'block.crop.break', step: 'block.grass.step', place: 'item.crop.plant', hit: 'block.grass.hit', fall: 'block.grass.fall', name: 'crop' },
  hard_crop: { v: 1, p: 1, brk: 'block.wood.break', step: 'block.wood.step', place: 'item.crop.plant', hit: 'block.wood.hit', fall: 'block.wood.fall', name: 'hard_crop' },
  nether_wart: { v: 1, p: 1, brk: 'block.nether_wart.break', step: 'block.stone.step', place: 'item.nether_wart.plant', hit: 'block.stone.hit', fall: 'block.stone.fall', name: 'nether_wart' },
  sweet_berry_bush: { v: 1, p: 1, brk: 'block.sweet_berry_bush.break', step: 'block.grass.step', place: 'block.sweet_berry_bush.place', hit: 'block.grass.hit', fall: 'block.grass.fall', name: 'sweet_berry_bush' },
  lily_pad: { v: 1, p: 1, brk: 'block.grass.break', step: 'block.grass.step', place: 'block.lily_pad.place', hit: 'block.grass.hit', fall: 'block.grass.fall', name: 'lily_pad' },
  bamboo_sapling: { v: 1, p: 1, brk: 'block.bamboo_sapling.break', step: 'block.bamboo.step', place: 'block.bamboo_sapling.place', hit: 'block.bamboo_sapling.hit', fall: 'block.bamboo.fall', name: 'bamboo_sapling' },
  glow_lichen: { v: 1, p: 1, brk: 'block.grass.break', step: 'block.vine.step', place: 'block.grass.place', hit: 'block.grass.hit', fall: 'block.grass.fall', name: 'glow_lichen' },
  cactus_flower: { v: 1, p: 1, brk: 'block.cactus_flower.break', step: 'block.grass.step', place: 'block.cactus_flower.place', hit: 'block.grass.hit', fall: 'block.grass.fall', name: 'cactus_flower' },
};
for (const s of ['small', 'medium', 'large']) {
  const n = s + '_amethyst_bud';
  MIX[n] = { v: 1, p: 1, brk: `block.${n}.break`, step: 'block.amethyst_cluster.step', place: `block.${n}.place`, hit: 'block.amethyst_cluster.hit', fall: 'block.amethyst_cluster.fall', name: n };
}
const TYPES = {};
const type = n => MIX[n] || TYPES[n] || (TYPES[n] = n === 'metal' ? T('metal', 1, 1.5) : n === 'anvil' ? T('anvil', 0.3, 1) : T(n));

// the overworld woods (each of their planks, logs, doors... sounds like wood), and the three with their own sounds
const WOODS = 'oak|spruce|birch|jungle|acacia|dark_oak|pale_oak|mangrove|poplar';
const woodKind = n => /^(stripped_)?(crimson|warped)_/.test(n) ? 'nether' : /bamboo/.test(n) ? 'bamboo' : /cherry/.test(n) ? 'cherry' : 'wood';
const WOOD_TYPE = { wood: 'wood', nether: 'nether_wood', bamboo: 'bamboo_wood', cherry: 'cherry_wood' };
const SIGN_TYPE = { wood: 'hanging_sign', nether: 'nether_wood_hanging_sign', bamboo: 'bamboo_wood_hanging_sign', cherry: 'cherry_wood_hanging_sign' };

/* By name, first rule that matches. (The few that sound unlike what their
   name suggests are listed by themselves first: dirt sounds like gravel,
   cactus like wool, ice like glass, a turtle egg like metal.) */
const EXACT = {
  dirt: 'gravel', coarse_dirt: 'gravel', podzol: 'gravel', farmland: 'gravel', clay: 'gravel',
  grass_block: 'grass', mycelium: 'grass', dirt_path: 'grass', hay_block: 'grass', target: 'grass', dried_kelp_block: 'grass', tnt: 'grass',
  rooted_dirt: 'rooted_dirt', mud: 'mud', packed_mud: 'packed_mud', mud_bricks: 'mud_bricks', mud_brick_stairs: 'mud_bricks', mud_brick_slab: 'mud_bricks', mud_brick_wall: 'mud_bricks',
  cactus: 'wool', cake: 'wool', fire: 'wool', soul_fire: 'wool',
  ice: 'glass', packed_ice: 'glass', blue_ice: 'glass', frosted_ice: 'glass', glowstone: 'glass', sea_lantern: 'glass', beacon: 'glass',
  redstone_lamp: 'glass', end_portal_frame: 'glass', nether_portal: 'glass',
  turtle_egg: 'metal', sniffer_egg: 'metal', hopper: 'metal', gold_block: 'metal', diamond_block: 'metal', emerald_block: 'metal',
  redstone_block: 'metal', light_weighted_pressure_plate: 'metal', bell: 'anvil',
  iron_block: 'iron', iron_bars: 'iron', iron_door: 'iron', iron_trapdoor: 'iron', heavy_weighted_pressure_plate: 'iron',
  netherite_block: 'netherite_block', ancient_debris: 'ancient_debris', lodestone: 'lodestone', gilded_blackstone: 'gilded_blackstone',
  bone_block: 'bone_block', shroomlight: 'shroomlight', nether_sprouts: 'nether_sprouts', netherrack: 'netherrack',
  nether_gold_ore: 'nether_gold_ore', nether_quartz_ore: 'nether_ore', soul_sand: 'soul_sand', soul_soil: 'soul_soil',
  basalt: 'basalt', polished_basalt: 'basalt', smooth_basalt: 'basalt',
  nether_wart_block: 'wart_block', warped_wart_block: 'wart_block',
  weeping_vines: 'weeping_vines', weeping_vines_plant: 'weeping_vines', twisting_vines: 'weeping_vines', twisting_vines_plant: 'weeping_vines',
  crimson_roots: 'roots', warped_roots: 'roots', crimson_fungus: 'fungus', warped_fungus: 'fungus', crimson_nylium: 'nylium', warped_nylium: 'nylium',
  vine: 'vine', glow_lichen: 'glow_lichen', ladder: 'ladder', scaffolding: 'scaffolding', slime_block: 'slime_block', sea_pickle: 'slime_block',
  honey_block: 'honey_block', honeycomb_block: 'coral_block', sponge: 'sponge', wet_sponge: 'wet_sponge', cobweb: 'cobweb',
  spawner: 'spawner', trial_spawner: 'trial_spawner', vault: 'vault', heavy_core: 'heavy_core', decorated_pot: 'decorated_pot',
  creaking_heart: 'creaking_heart', resin_block: 'resin', resin_clump: 'resin', dried_ghast: 'dried_ghast',
  chiseled_bookshelf: 'chiseled_bookshelf', lantern: 'lantern', soul_lantern: 'lantern', chain: 'chain', iron_chain: 'chain',
  calcite: 'calcite', dripstone_block: 'dripstone_block', pointed_dripstone: 'pointed_dripstone', powder_snow: 'powder_snow',
  amethyst_block: 'amethyst_block', budding_amethyst: 'amethyst_block', amethyst_cluster: 'amethyst_cluster',
  moss_block: 'moss', pale_moss_block: 'moss', moss_carpet: 'moss_carpet', pale_moss_carpet: 'moss_carpet', pale_hanging_moss: 'moss_carpet',
  azalea: 'azalea', flowering_azalea: 'flowering_azalea', azalea_leaves: 'azalea_leaves', flowering_azalea_leaves: 'azalea_leaves',
  big_dripleaf: 'big_dripleaf', big_dripleaf_stem: 'big_dripleaf', small_dripleaf: 'small_dripleaf', hanging_roots: 'hanging_roots',
  spore_blossom: 'spore_blossom', cave_vines: 'cave_vines', cave_vines_plant: 'cave_vines', pink_petals: 'pink_petals', wildflowers: 'pink_petals',
  leaf_litter: 'leaf_litter', frogspawn: 'frogspawn', mangrove_roots: 'mangrove_roots', muddy_mangrove_roots: 'muddy_mangrove_roots',
  sculk: 'sculk', sculk_vein: 'sculk_vein', sculk_catalyst: 'sculk_catalyst', sculk_shrieker: 'sculk_shrieker',
  sculk_sensor: 'sculk_sensor', calibrated_sculk_sensor: 'sculk_sensor',
  bamboo: 'bamboo', bamboo_sapling: 'bamboo_sapling', cherry_sapling: 'cherry_sapling', cherry_leaves: 'cherry_leaves',
  suspicious_sand: 'suspicious_sand', suspicious_gravel: 'suspicious_gravel', lily_pad: 'lily_pad', sweet_berry_bush: 'sweet_berry_bush',
  firefly_bush: 'sweet_berry_bush', nether_wart: 'nether_wart', cactus_flower: 'cactus_flower',
  wheat: 'crop', carrots: 'crop', potatoes: 'crop', beetroots: 'crop', torchflower_crop: 'crop', pitcher_crop: 'crop',
  melon_stem: 'hard_crop', pumpkin_stem: 'hard_crop', attached_melon_stem: 'wood', attached_pumpkin_stem: 'wood',
  melon: 'wood', pumpkin: 'wood', carved_pumpkin: 'wood', jack_o_lantern: 'wood', cocoa: 'wood', chorus_plant: 'wood', chorus_flower: 'wood',
  end_rod: 'wood', bookshelf: 'wood', note_block: 'wood', jukebox: 'wood', composter: 'wood', daylight_detector: 'wood', lectern: 'wood',
  crafting_table: 'wood', chest: 'wood', trapped_chest: 'wood', barrel: 'wood', loom: 'wood', cartography_table: 'wood', fletching_table: 'wood',
  smithing_table: 'wood', beehive: 'wood', bee_nest: 'wood', campfire: 'wood', soul_campfire: 'wood', tripwire_hook: 'wood',
  torch: 'wood', wall_torch: 'wood', soul_torch: 'wood', soul_wall_torch: 'wood', redstone_torch: 'wood', redstone_wall_torch: 'wood',
  copper_torch: 'wood', copper_wall_torch: 'wood', brown_mushroom_block: 'wood', red_mushroom_block: 'wood', mushroom_stem: 'wood',
  rail: 'metal', powered_rail: 'metal', detector_rail: 'metal', activator_rail: 'metal',
  seagrass: 'wet_grass', tall_seagrass: 'wet_grass', kelp: 'wet_grass', kelp_plant: 'wet_grass',
  snow: 'snow', snow_block: 'snow', straw_bed: 'grass', shelf_mushroom: 'wood', red_shrub: 'grass',
  sulfur_spike: 'pointed_dripstone',
};
const RULES = [
  [/^(\w+_)?froglight$/, 'froglight'],
  [/_amethyst_bud$/, n => n],
  [/(^|_)(wool|carpet)(_|$)/, n => /moss_carpet/.test(n) ? 'moss_carpet' : 'wool'],
  [/_bed$/, 'wood'],
  [/_banner$/, 'wood'],
  [/^(\w+_)?candle(_cake)?$/, n => /_cake$/.test(n) ? 'wool' : 'candle'],
  [/_concrete_powder$/, 'sand'],
  [/^(red_)?sand$/, 'sand'],
  [/^gravel$/, 'gravel'],
  [/(^|_)(glass|glass_pane)$/, 'glass'],
  [/^(dead_)?\w+_coral_block$/, n => /^dead_/.test(n) ? 'stone' : 'coral_block'],
  [/_coral(_wall)?(_fan)?$/, n => /^dead_/.test(n) ? 'stone' : 'wet_grass'],
  [/(^|_)copper_golem_statue$/, 'copper_golem_statue'],
  [/(^|_)copper_grate$/, 'copper_grate'],
  [/(^|_)copper_bulb$/, 'copper_bulb'],
  [/(^|_)copper_lantern$/, 'lantern'],
  [/(^|_)copper_chain$/, 'chain'],
  [/(copper|lightning_rod)/, n => /^(raw_copper_block|copper_ore|deepslate_copper_ore)$/.test(n) ? (n.startsWith('deepslate') ? 'deepslate' : 'stone') : 'copper'],
  [/anvil$/, 'anvil'],
  [/_hanging_sign$/, n => SIGN_TYPE[woodKind(n)]],
  [/_shelf$/, 'shelf'],
  [/^(stripped_)?(crimson|warped)_(stem|hyphae)$/, 'stem'],
  [/^(\w+_)?nether_brick(s)?(_\w+)?$|^nether_brick_fence$|^(red|cracked|chiseled)_nether_bricks$/, 'nether_bricks'],
  [/^(cobbled_)?deepslate(_\w+)?$|^infested_deepslate$|^reinforced_deepslate$|^deepslate_\w+_ore$/, n =>
    /bricks?|chiseled_deepslate/.test(n) ? 'deepslate_bricks' : /tiles?/.test(n) ? 'deepslate_tiles' : 'deepslate'],
  [/^(cracked_|chiseled_)deepslate/, n => /tiles/.test(n) ? 'deepslate_tiles' : 'deepslate_bricks'],
  [/^polished_deepslate/, 'polished_deepslate'],
  [/^polished_tuff/, 'polished_tuff'],
  [/^(chiseled_)?tuff_brick/, 'tuff_bricks'],
  [/^(chiseled_)?tuff/, 'tuff'],
  [/^resin_brick|^chiseled_resin_bricks$/, 'resin_bricks'],
  [/(sulfur)/, 'sulfur'],
  [/(cinnabar)/, 'cinnabar'],
  // wood: planks, logs, and everything made of them
  [new RegExp(`^(stripped_)?(${WOODS}|cherry|crimson|warped|bamboo)_(planks|log|wood|stem|hyphae|block|mosaic|stairs|slab|fence|fence_gate|door|trapdoor|button|pressure_plate|sign|wall_sign|mosaic_stairs|mosaic_slab)$|^bamboo_(planks|mosaic|block)$|^stripped_bamboo_block$|^petrified_oak_slab$`),
    n => n === 'petrified_oak_slab' ? 'stone' : WOOD_TYPE[woodKind(n)]],
  [new RegExp(`^(${WOODS})_leaves$|_poplar_leaves$`), 'grass'],
  [new RegExp(`^(${WOODS})_sapling$|^mangrove_propagule$`), 'grass'],
  [/^(short_grass|tall_grass|fern|large_fern|dead_bush|bush|short_dry_grass|tall_dry_grass|sugar_cane|brown_mushroom|red_mushroom|dandelion|golden_dandelion|torchflower|poppy|blue_orchid|allium|azure_bluet|\w+_tulip|oxeye_daisy|cornflower|wither_rose|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pitcher_plant|open_eyeblossom|closed_eyeblossom)$/, 'grass'],
];

const cache = [];
// the sound type for a block id (stone for anything not named above, as in the game)
export function soundType(id) {
  let t = cache[id];
  if (t) return t;
  const d = BLOCKS[id];
  const n = d ? d.name : '';
  let name = EXACT[n];
  if (!name) for (const [re, out] of RULES) if (re.test(n)) { name = typeof out === 'function' ? out(n) : out; break; }
  t = type(name || 'stone');
  cache[id] = t;
  return t;
}
// by name, for tests and for the few places that know a type rather than a block
export function soundTypeNamed(name) { return type(name); }

/* The blocks whose step sounds come from the block in the feet's own space
   rather than the one underneath: a carpet or a snow layer laid on a floor
   is heard over it (the floor quietly underneath), as in the game. */
export const COVERS = new Uint8Array(4096);
export const INSIDE = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (!d) continue;
  if (/_carpet$|^snow$|^pink_petals$|^wildflowers$|^leaf_litter$|^nether_sprouts$|^(crimson|warped)_roots$/.test(d.name)) COVERS[d.id] = 1;
  if (/^(powder_snow|sculk_vein|glow_lichen|resin_clump|lily_pad|(small|medium|large)_amethyst_bud|amethyst_cluster)$/.test(d.name)) INSIDE[d.id] = 1;
}
