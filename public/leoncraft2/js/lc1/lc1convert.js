/* ---------------------------------------------------------------------------
   The first Leoncraft's worlds (legacy/minecraft.html, and mlhub's server.js
   for its servers) turned into Leoncraft 2's: every block it keeps by number
   to a Leoncraft 2 block name, and the state it keeps beside a block (the
   doors', trapdoors', slabs', stairs', ladders', beds', torches', levers',
   buttons', signs' and pots' stores) to Leoncraft 2's meta (models.js's
   layout), with stand-ins for the blocks Leoncraft 2 does not have.

   A world comes over as the seed and what was changed. The chunks that were
   changed (and the ones round the spawn) are made by the first Leoncraft's
   own generator (lc1gen.js), lifted so its sea level (30) is Leoncraft 2's
   (63): Y_OFF below. Everything else is Leoncraft 2's own terrain.

   This file is shared: the same text is at mlhub apps/mc/lc1convert.js (the
   server's import of the first Leoncraft's servers, and hubmaps.js's
   Chameleon maps). It has no imports or exports, so a page or a worker
   imports it for what it sets (globalThis.LC1Convert, after lc1gen.js) and
   Node requires it.
--------------------------------------------------------------------------- */
(function (make) {
  if (typeof module === 'object' && module.exports) module.exports = make(require('./lc1gen.js'));
  else globalThis.LC1Convert = make(globalThis.LC1Gen);
})(function (G) {
  'use strict';
  const VERSION = 1;                 // goes into the worlds' key: a new number makes their chunks again
  const WH = 144, CH = 16;
  // a first Leoncraft y to a Leoncraft 2 cell row (world y + 64): the Overworld's sea 30 -> 63, the Nether's lava 20 -> 31
  const Y_OFF = [97, 75];
  // how much of the first Leoncraft's height each dimension takes (the Nether keeps Leoncraft 2's own above its roof)
  const LC1_TOP = [WH - 1, 71];
  const ROWS = [[0, 383], [64, 191]];
  // its block ids: STABLE_BLOCK_NAMES in minecraft.html, the index plus one (0 is air); never reordered there
  const NAMES = (
    'grass dirt stone cobblestone bedrock sand gravel oak_log oak_planks oak_leaves coal_ore iron_ore gold_ore ' +
    'diamond_ore redstone_ore glass water sandstone bricks snow ice obsidian netherrack glowstone pumpkin melon ' +
    'crafting_table furnace bookshelf spruce_log spruce_planks birch_log birch_planks jungle_log jungle_planks ' +
    'acacia_log acacia_planks dark_oak_log dark_oak_planks white_wool orange_wool magenta_wool light_blue_wool ' +
    'yellow_wool lime_wool pink_wool gray_wool light_gray_wool cyan_wool purple_wool blue_wool brown_wool green_wool ' +
    'red_wool black_wool oak_door spruce_door birch_door jungle_door acacia_door dark_oak_door white_bed orange_bed ' +
    'magenta_bed light_blue_bed yellow_bed lime_bed pink_bed gray_bed light_gray_bed cyan_bed purple_bed blue_bed ' +
    'brown_bed green_bed red_bed black_bed oak_stairs oak_fence spruce_stairs spruce_fence birch_stairs birch_fence ' +
    'jungle_stairs jungle_fence acacia_stairs acacia_fence dark_oak_stairs dark_oak_fence ladder oak_sign spruce_sign ' +
    'birch_sign jungle_sign acacia_sign dark_oak_sign granite polished_granite diorite polished_diorite andesite ' +
    'polished_andesite stone_bricks mossy_stone_bricks cracked_stone_bricks chiseled_stone_bricks mossy_cobblestone ' +
    'red_sand coarse_dirt podzol mycelium clay hardened_clay soul_sand end_stone nether_brick red_sandstone ' +
    'chiseled_sandstone quartz_block chiseled_quartz quartz_pillar prismarine prismarine_bricks dark_prismarine ' +
    'sea_lantern slime_block packed_ice snow_block sponge hay_block jack_o_lantern emerald_ore lapis_ore ' +
    'nether_quartz_ore iron_block gold_block diamond_block emerald_block coal_block redstone_block lapis_block ' +
    'spruce_leaves birch_leaves jungle_leaves acacia_leaves dark_oak_leaves leong_sahur_spawn_egg tralaleon_spawn_egg ' +
    'white_stained_clay white_stained_glass orange_stained_clay orange_stained_glass magenta_stained_clay ' +
    'magenta_stained_glass light_blue_stained_clay light_blue_stained_glass yellow_stained_clay yellow_stained_glass ' +
    'lime_stained_clay lime_stained_glass pink_stained_clay pink_stained_glass gray_stained_clay gray_stained_glass ' +
    'light_gray_stained_clay light_gray_stained_glass cyan_stained_clay cyan_stained_glass purple_stained_clay ' +
    'purple_stained_glass blue_stained_clay blue_stained_glass brown_stained_clay brown_stained_glass ' +
    'green_stained_clay green_stained_glass red_stained_clay red_stained_glass black_stained_clay black_stained_glass ' +
    'prg oak_trapdoor spruce_trapdoor birch_trapdoor jungle_trapdoor acacia_trapdoor dark_oak_trapdoor oak_slab ' +
    'spruce_slab birch_slab jungle_slab acacia_slab dark_oak_slab super_slime_block white_cushion orange_cushion ' +
    'magenta_cushion light_blue_cushion yellow_cushion lime_cushion pink_cushion gray_cushion light_gray_cushion ' +
    'cyan_cushion purple_cushion blue_cushion brown_cushion green_cushion red_cushion black_cushion white_concrete ' +
    'orange_concrete magenta_concrete light_blue_concrete yellow_concrete lime_concrete pink_concrete gray_concrete ' +
    'light_gray_concrete cyan_concrete purple_concrete blue_concrete brown_concrete green_concrete red_concrete ' +
    'black_concrete white_concrete_powder orange_concrete_powder magenta_concrete_powder light_blue_concrete_powder ' +
    'yellow_concrete_powder lime_concrete_powder pink_concrete_powder gray_concrete_powder light_gray_concrete_powder ' +
    'cyan_concrete_powder purple_concrete_powder blue_concrete_powder brown_concrete_powder green_concrete_powder ' +
    'red_concrete_powder black_concrete_powder white_glazed_terracotta orange_glazed_terracotta ' +
    'magenta_glazed_terracotta light_blue_glazed_terracotta yellow_glazed_terracotta lime_glazed_terracotta ' +
    'pink_glazed_terracotta gray_glazed_terracotta light_gray_glazed_terracotta cyan_glazed_terracotta ' +
    'purple_glazed_terracotta blue_glazed_terracotta brown_glazed_terracotta green_glazed_terracotta ' +
    'red_glazed_terracotta black_glazed_terracotta smooth_stone smooth_sandstone cut_sandstone smooth_red_sandstone ' +
    'cut_red_sandstone smooth_quartz quartz_bricks end_stone_bricks red_nether_bricks chiseled_nether_bricks ' +
    'cracked_nether_bricks purpur_block purpur_pillar deepslate cobbled_deepslate polished_deepslate deepslate_bricks ' +
    'cracked_deepslate_bricks deepslate_tiles cracked_deepslate_tiles chiseled_deepslate tuff polished_tuff ' +
    'tuff_bricks chiseled_tuff calcite dripstone_block amethyst_block tinted_glass blackstone gilded_blackstone ' +
    'polished_blackstone polished_blackstone_bricks cracked_polished_blackstone_bricks chiseled_polished_blackstone ' +
    'basalt smooth_basalt polished_basalt mud packed_mud mud_bricks copper_block exposed_copper weathered_copper ' +
    'oxidized_copper cut_copper raw_iron_block raw_copper_block raw_gold_block netherite_block ancient_debris ' +
    'crying_obsidian red_mushroom_block brown_mushroom_block mushroom_stem crimson_nylium warped_nylium ' +
    'nether_wart_block warped_wart_block shroomlight ochre_froglight verdant_froglight pearlescent_froglight ' +
    'bone_block honeycomb_block dried_kelp_block sculk moss_block terracotta mangrove_log mangrove_planks ' +
    'mangrove_leaves cherry_log cherry_planks cherry_leaves pale_oak_log pale_oak_planks pale_oak_leaves bamboo_block ' +
    'bamboo_planks bamboo_mosaic crimson_stem crimson_planks warped_stem warped_planks stripped_oak_log ' +
    'stripped_spruce_log stripped_birch_log stripped_jungle_log stripped_acacia_log stripped_dark_oak_log ' +
    'cobblestone_stairs cobblestone_slab stone_stairs stone_slab stone_brick_stairs stone_brick_slab ' +
    'mossy_stone_brick_stairs mossy_stone_brick_slab mossy_cobblestone_stairs mossy_cobblestone_slab brick_stairs ' +
    'brick_slab sandstone_stairs sandstone_slab smooth_sandstone_stairs smooth_sandstone_slab red_sandstone_stairs ' +
    'red_sandstone_slab smooth_red_sandstone_stairs smooth_red_sandstone_slab granite_stairs granite_slab ' +
    'polished_granite_stairs polished_granite_slab diorite_stairs diorite_slab polished_diorite_stairs ' +
    'polished_diorite_slab andesite_stairs andesite_slab polished_andesite_stairs polished_andesite_slab ' +
    'nether_brick_stairs nether_brick_slab red_nether_brick_stairs red_nether_brick_slab quartz_stairs quartz_slab ' +
    'smooth_quartz_stairs smooth_quartz_slab purpur_stairs purpur_slab prismarine_stairs prismarine_slab ' +
    'prismarine_brick_stairs prismarine_brick_slab dark_prismarine_stairs dark_prismarine_slab end_stone_brick_stairs ' +
    'end_stone_brick_slab deepslate_brick_stairs deepslate_brick_slab deepslate_tile_stairs deepslate_tile_slab ' +
    'cobbled_deepslate_stairs cobbled_deepslate_slab polished_deepslate_stairs polished_deepslate_slab ' +
    'blackstone_stairs blackstone_slab polished_blackstone_stairs polished_blackstone_slab ' +
    'polished_blackstone_brick_stairs polished_blackstone_brick_slab tuff_stairs tuff_slab mud_brick_stairs ' +
    'mud_brick_slab mangrove_stairs mangrove_slab mangrove_fence mangrove_trapdoor cherry_stairs cherry_slab ' +
    'cherry_fence cherry_trapdoor pale_oak_stairs pale_oak_slab pale_oak_fence pale_oak_trapdoor bamboo_stairs ' +
    'bamboo_slab bamboo_fence bamboo_trapdoor crimson_stairs crimson_slab crimson_fence crimson_trapdoor ' +
    'warped_stairs warped_slab warped_fence warped_trapdoor bamboo_mosaic_stairs bamboo_mosaic_slab white_carpet ' +
    'orange_carpet magenta_carpet light_blue_carpet yellow_carpet lime_carpet pink_carpet gray_carpet ' +
    'light_gray_carpet cyan_carpet purple_carpet blue_carpet brown_carpet green_carpet red_carpet black_carpet ' +
    'purpular_log purpular_planks purpular_leaves purpular_stairs purpular_slab purpular_fence purpular_trapdoor ' +
    'purpular_door purpular_sign tnt glass_pane white_stained_glass_pane orange_stained_glass_pane ' +
    'magenta_stained_glass_pane light_blue_stained_glass_pane yellow_stained_glass_pane lime_stained_glass_pane ' +
    'pink_stained_glass_pane gray_stained_glass_pane light_gray_stained_glass_pane cyan_stained_glass_pane ' +
    'purple_stained_glass_pane blue_stained_glass_pane brown_stained_glass_pane green_stained_glass_pane ' +
    'red_stained_glass_pane black_stained_glass_pane dandelion poppy blue_orchid allium azure_bluet red_tulip ' +
    'orange_tulip white_tulip pink_tulip oxeye_daisy cornflower lily_of_the_valley wither_rose torchflower ' +
    'closed_eyeblossom open_eyeblossom purpular_flower sunflower lilac rose_bush peony pitcher_plant flower_pot ' +
    'wet_sponge golden_dandelion torch redstone_torch campfire redstone_wire redstone_lamp lever oak_button ' +
    'spruce_button birch_button jungle_button acacia_button dark_oak_button purpular_button stone_button ' +
    'oak_pressure_plate spruce_pressure_plate birch_pressure_plate jungle_pressure_plate acacia_pressure_plate ' +
    'dark_oak_pressure_plate purpular_pressure_plate stone_pressure_plate enchanting_table anvil grindstone ' +
    'stonecutter vine weeping_vines twisting_vines cave_vines fire lava nether_portal magma_block soul_soil ' +
    'crimson_nylium warped_nylium crimson_fungus warped_fungus ancient_debris cobblestone_wall mossy_cobblestone_wall ' +
    'stone_brick_wall mossy_stone_brick_wall granite_wall diorite_wall andesite_wall brick_wall mud_brick_wall ' +
    'sandstone_wall red_sandstone_wall prismarine_wall nether_brick_wall red_nether_brick_wall end_stone_brick_wall ' +
    'blackstone_wall polished_blackstone_wall polished_blackstone_brick_wall cobbled_deepslate_wall ' +
    'polished_deepslate_wall deepslate_brick_wall deepslate_tile_wall tuff_wall polished_tuff_wall tuff_brick_wall ' +
    'end_rod painting_kebab painting_aztec painting_alban painting_wanderer painting_sunset painting_void lantern ' +
    'soul_lantern purpular_lantern oak_sapling spruce_sapling birch_sapling jungle_sapling acacia_sapling ' +
    'dark_oak_sapling cherry_sapling pale_oak_sapling mangrove_propagule purpular_sapling iron_bars parkour_start ' +
    'parkour_end dirt_path farmland wheat cactus dead_bush cobweb chest art_sunflowers art_soup_can art_green_apple ' +
    'art_smiley art_pixel_heart art_great_wave art_water_lilies art_last_supper art_mona_lisa art_pearl_earring ' +
    'art_american_gothic art_starry_night art_the_scream art_mondrian art_ekirby art_leon_tag art_nighthawks ' +
    'art_creation art_persistence art_birth_of_venus art_van_gogh art_pearl art_scream art_wanderer art_hokusai ' +
    'art_sunrise art_whistler art_kiss art_kandinsky art_birth_venus art_night_watch art_hay_wain art_delights ' +
    'art_any barrier ' +
    '').trim().split(' ');
  const ID = {};
  NAMES.forEach((n, i) => { ID[n] = i + 1; });
  const nameOf = id => (id > 0 && id <= NAMES.length ? NAMES[id - 1] : null);

  const COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  /* The names Leoncraft 2 has under another name, and stand-ins for what it does not have at all. */
  const RENAME = {
    grass: 'grass_block', hardened_clay: 'terracotta', nether_brick: 'nether_bricks', chiseled_quartz: 'chiseled_quartz_block',
    snow: 'snow_block',                       // the first Leoncraft's snow is the whole block (Leoncraft 2's snow is a layer)
    super_slime_block: 'slime_block', cobble: 'cobblestone', tall_grass_plant: 'short_grass',
    prg: 'lime_concrete',                     // the green sphere: a block of its colour
    parkour_start: 'light_weighted_pressure_plate', parkour_end: 'heavy_weighted_pressure_plate',
    // purpular, Leon's own purple wood: purpur for the wood and the stone-like parts, crimson for the wooden fittings
    purpular_log: 'purpur_pillar', purpular_planks: 'purpur_block', purpular_leaves: 'cherry_leaves', purpular_stairs: 'purpur_stairs',
    purpular_slab: 'purpur_slab', purpular_fence: 'crimson_fence', purpular_trapdoor: 'crimson_trapdoor', purpular_door: 'crimson_door',
    purpular_sign: 'crimson_sign', purpular_flower: 'allium', purpular_button: 'crimson_button', purpular_pressure_plate: 'crimson_pressure_plate',
    purpular_lantern: 'soul_lantern', purpular_sapling: 'cherry_sapling',
  };
  for (const c of COLOURS) { RENAME[c + '_stained_clay'] = c + '_terracotta'; RENAME[c + '_cushion'] = c + '_carpet'; }
  // blocks that are not blocks in Leoncraft 2 (spawn eggs are items; paintings are entities, made from the cells: paintings())
  const GONE = /_spawn_egg$/;
  const PAINTING = /^(painting_|art_)/;

  // what kind of thing a first Leoncraft block is, by its name (its BLOCKS flags in minecraft.html)
  const kindOf = n => {
    if (!n) return '';
    if (/_trapdoor$/.test(n)) return 'trapdoor';
    if (/_door$/.test(n)) return 'door';
    if (/_slab$/.test(n)) return 'slab';
    if (/_stairs$/.test(n)) return 'stairs';
    if (/_bed$/.test(n)) return 'bed';
    if (n === 'ladder') return 'ladder';
    if (/_sign$/.test(n)) return 'sign';
    if (n === 'torch' || n === 'redstone_torch') return 'torch';
    if (n === 'lever') return 'lever';
    if (/_button$/.test(n)) return 'button';
    if (/lantern$/.test(n) && n !== 'jack_o_lantern' && n !== 'sea_lantern') return 'lantern';
    if (n === 'end_rod') return 'rod';
    if (n === 'vine') return 'vine';
    if (n === 'weeping_vines' || n === 'cave_vines') return 'hangs';
    if (n === 'twisting_vines') return 'climbs';
    if (PAINTING.test(n)) return 'painting';
    if (n === 'flower_pot') return 'pot';
    return '';
  };
  // the first Leoncraft's plants (cross models: they want something solid under them)
  const SMALL_FLOWERS = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
    'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'closed_eyeblossom', 'open_eyeblossom', 'purpular_flower', 'golden_dandelion'];
  const TALL_FLOWERS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant']);
  const PLANT = new Set(SMALL_FLOWERS.concat([...TALL_FLOWERS], ['wheat', 'dead_bush', 'cobweb', 'crimson_fungus', 'warped_fungus', 'oak_sapling', 'spruce_sapling',
    'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'pale_oak_sapling', 'mangrove_propagule', 'purpular_sapling']));
  /* Solid in the first Leoncraft (BLOCKS[id].solid: what a torch, a button or a plant may hold on to,
     solidFooting, less pots and campfires), and a whole cube there (what a wall torch looks right on). */
  const NOT_SOLID = /^(water|lava|fire|nether_portal|torch|redstone_torch|lever|redstone_wire|ladder|vine|weeping_vines|twisting_vines|cave_vines|.*_button|.*_pressure_plate|parkour_start|parkour_end|.*_trapdoor|.*_sign|.*_carpet|painting_.*|art_.*|.*lantern|.*_spawn_egg|flower_pot|campfire)$/;
  const lc1Solid = n => (!!n && !NOT_SOLID.test(n)) || n === 'jack_o_lantern' || n === 'sea_lantern';
  const solidFooting = n => !!n && (lc1Solid(n) && !PLANT.has(n));
  const NOT_CUBE = /(_door|_slab|_stairs|_fence|_wall|_pane|^iron_bars|_bed|_cushion|_carpet|_sign|^anvil|^grindstone|^stonecutter|^enchanting_table|^end_rod|^cactus|^prg)$/;
  const lc1Cube = n => solidFooting(n) && !NOT_CUBE.test(n);
  // and the same block once it is Leoncraft 2's (a few are a little lower or smaller there)
  const SHORTER = new Set(['dirt_path', 'farmland']);
  // (only the names this file turns the first Leoncraft's blocks into: what is no whole cube among them)
  const LC2_NOT_CUBE = /(^air$|^water$|^lava$|fire$|^nether_portal$|_door$|_trapdoor$|_stairs$|_fence$|_wall$|_pane$|^iron_bars$|_bed$|_carpet$|_sign$|torch$|^lever$|_button$|_pressure_plate$|^(soul_)?lantern$|^end_rod$|vine|_plant$|^potted_|^flower_pot$|^campfire$|^anvil$|^grindstone$|^stonecutter$|^enchanting_table$|^cactus$|^chest$|^redstone_wire$|^ladder$|^cobweb$|^wheat$|^dead_bush$|_sapling$|^mangrove_propagule$|_fungus$|^short_grass$|^dirt_path$|^farmland$)/;
  const lc2Cube = (n, slabMeta) => {
    if (!n) return false;
    if (/_slab$/.test(n)) return slabMeta === 2;
    if (LC2_NOT_CUBE.test(n) || PLANT.has(n) || TALL_FLOWERS.has(n)) return false;
    return true;
  };
  // what the first Leoncraft's horizontal facings point at (DIRV: 0 -z, 1 +x, 2 +z, 3 -x); Leoncraft 2's are the same
  const DIRV = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  // Leoncraft 2's faces of a cell (models.js: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z), and where each one looks
  const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // a wall block facing out the way f points hangs from the face on the other side (facing -z: the +z face)
  const WALL_FACE = [4, 1, 5, 0];

  /* ---- one cell: the block and the state kept beside it, as Leoncraft 2's [name, meta] ----
     st: the record from its store (door { facing, open, hinge }, trapdoor { facing, open, top }, slab { top, double },
     stairs { facing, top }, ladder { facing }, bed { facing, head }, attach { m, f, on }, sign { wall, ang },
     pot { plant }), or null. nb(dx, dy, dz): the first Leoncraft name next to it, for what is worked out from its
     neighbours (vines, tall flowers, portals, fire, lanterns), or null when nothing is known. */
  function cell(n, st, nb, upper) {
    if (!n || GONE.test(n) || PAINTING.test(n)) return null;
    const look = nb || (() => null);
    let name = RENAME[n] || n, m = 0;
    const k = kindOf(n), s = st || {};
    if (k === 'door') {
      // (the first Leoncraft's door stands on the edge it faces; shut, Leoncraft 2's stands on the edge its facing
      // is away from, and a first Leoncraft door with its hinge on the right swings the way a Leoncraft 2 left one does)
      m = (((s.facing | 0) + 2) & 3) | (s.open ? 4 : 0) | (upper ? 8 : 0) | (s.hinge === 'left' ? 16 : 0);
    } else if (k === 'trapdoor') m = (((s.facing | 0) + 2) & 3) | (s.open ? 4 : 0) | (s.top ? 8 : 0);
    else if (k === 'slab') m = s.double ? 2 : s.top ? 1 : 0;
    else if (k === 'stairs') m = (((s.facing | 0) + 2) & 3) | (s.top ? 4 : 0);   // (the first Leoncraft kept the low side)
    else if (k === 'ladder') m = WALL_FACE[(s.facing | 0) & 3];
    else if (k === 'bed') m = ((s.facing | 0) & 3) | (s.head ? 8 : 0);
    else if (k === 'torch') {
      if (s.m === 2) { name = n === 'torch' ? 'wall_torch' : 'redstone_wall_torch'; m = WALL_FACE[(s.f | 0) & 3]; }
    } else if (k === 'lever' || k === 'button') {
      const f = (s.f | 0) & 3, on = k === 'lever' && s.on ? 8 : 0;
      m = (s.m === 2 ? WALL_FACE[f] : (s.m === 1 ? 2 : 3) | (f << 4)) | on;
    } else if (k === 'lantern') {
      // hanging from a ceiling; one put on a wall (Leoncraft 2's lanterns cannot be) stands if it can, else hangs
      const sb = solidFooting(look(0, -1, 0)), sa = solidFooting(look(0, 1, 0));
      m = s.m === 1 ? 1 : s.m === 2 ? (sb || !sa ? 0 : 1) : 0;
    } else if (k === 'rod') m = s.m === 1 ? 5 : s.m === 2 ? (s.f | 0) & 3 : 4;
    else if (k === 'vine') {
      // bits 0 north, 1 east, 2 south, 3 west, 4 under the block above (models.js vineFaces); the wall is behind its facing
      const f = (s.f | 0) & 3;
      if (s.m === 2) m = [4, 8, 1, 2][f];
      else if (s.m === 0) {
        // over the top of a block, as Leoncraft 2's vines cannot lie: on whatever wall is beside it, else a carpet of moss
        m = 0;
        for (let i = 0; i < 4; i++) if (lc1Cube(look(DIRV[i][0], 0, DIRV[i][2]))) m |= 1 << i;
        if (!m) { name = 'moss_carpet'; m = 0; }
      } else m = 16;
    } else if (k === 'hangs') { if (look(0, -1, 0) === n) name += '_plant'; }
    else if (k === 'climbs') { if (look(0, 1, 0) === n) name += '_plant'; }
    else if (k === 'sign') {
      const wood = name.replace(/_sign$/, '');
      const a = ((s.ang | 0) % 8 + 8) % 8;
      if (s.wall) { name = wood + '_wall_sign'; m = [5, 1, 4, 0][((a + 1) >> 1) & 3]; }
      else { const r = (8 - 2 * a + 16) & 15; m = (r >> 2) | ((r & 3) << 2); }   // the text the way the first Leoncraft's faced
    } else if (k === 'pot') {
      const p = s.plant ? RENAME[s.plant] || s.plant : '';
      if (p && POTTED.has('potted_' + p)) name = 'potted_' + p;
    } else if (TALL_FLOWERS.has(n)) m = look(0, -1, 0) === n ? 8 : 0;
    else if (n === 'wheat') m = 7;
    else if (/_leaves$/.test(n)) m = 128;     // put there by a player: Leoncraft 2's leaves would otherwise decay
    else if (n === 'nether_portal') {
      // (1 across x, 2 across z: models.js portal) by the portal beside it, else by its frame
      const along = (dx, dz, b) => look(dx, 0, dz) === b || look(-dx, 0, -dz) === b;
      m = along(1, 0, n) ? 1 : along(0, 1, n) ? 2 : along(0, 1, 'obsidian') && !along(1, 0, 'obsidian') ? 2 : 1;
    }
    else if (n === 'fire') {
      // fire that keeps burning (netherrack, magma) as it is, soul fire on soul sand; anywhere else a lit campfire, so a
      // fireplace neither goes out nor burns the house down (the first Leoncraft's fire did neither)
      const under = look(0, -1, 0);
      if (under === 'soul_sand' || under === 'soul_soil') name = 'soul_fire';
      else if (under !== null && under !== 'netherrack' && under !== 'magma_block') name = 'campfire';
    }
    return [name, m];
  }
  // the potted plants Leoncraft 2 has
  const POTTED = new Set(['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
    'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'closed_eyeblossom', 'open_eyeblossom', 'golden_dandelion', 'dead_bush', 'crimson_fungus',
    'warped_fungus', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'pale_oak_sapling',
    'mangrove_propagule'].map(p => 'potted_' + p));

  /* ---- what the generator puts down, as Leoncraft 2's (lc1/mixed.js, in the workers) ----
     A name and meta per first Leoncraft id; the few that look at their neighbours are worked out there (terrainFix). */
  function terrainName(id) {
    const n = nameOf(id);
    if (!n) return ['air', 0];
    if (n === 'oak_leaves' || n === 'spruce_leaves' || n === 'birch_leaves') return [n, 0];   // a tree's own leaves decay as a tree's do
    const c = cell(n, null, null);
    return c || ['air', 0];
  }
  // a generated cell whose Leoncraft 2 form depends on what is round it: a vine's tip, fire on soul sand
  const T_FIX = new Set([ID.weeping_vines, ID.twisting_vines, ID.fire]);
  function terrainFix(id, below, above) {
    if (id === ID.weeping_vines) return below === id ? 'weeping_vines_plant' : 'weeping_vines';
    if (id === ID.twisting_vines) return above === id ? 'twisting_vines_plant' : 'twisting_vines';
    if (id === ID.fire) return below === ID.soul_sand || below === ID.soul_soil ? 'soul_fire' : 'fire';
    return null;
  }

  /* ---- a world as the first Leoncraft keeps it, in one shape ----
     Its server keeps { seed, blocks, doors, beds, stairs, ladders, trapdoors, slabs, pots, attach, signs, prg, spawn,
     nether: { the same stores } } with long field names; its own browser (localStorage 'leoncraft_sp_world') the same
     stores with short ones (doors { f, o, h }...). Anything odd in either is left out, never thrown. */
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  function stores(src, short) {
    const S = obj(src), out = { blocks: new Map(), doors: {}, beds: {}, stairs: {}, ladders: {}, trapdoors: {}, slabs: {}, pots: {}, attach: {}, signs: {} };
    const B = obj(S.blocks);
    for (const k in B) { const v = +B[k]; if (Number.isInteger(v) && v >= 0 && v < 65536 && /^-?\d+,-?\d+,-?\d+$/.test(k)) out.blocks.set(k, v); }
    const each = (name, f) => { const o = obj(S[name]); for (const k in o) { const r = o[k]; if (r && typeof r === 'object') { try { const v = f(r); if (v) out[name][k] = v; } catch (e) { /* left out */ } } } };
    if (short) {
      each('doors', r => ({ facing: r.f | 0, open: !!r.o, hinge: r.h === 'l' ? 'left' : r.h === 'r' ? 'right' : undefined }));
      each('beds', r => ({ facing: r.f | 0, head: !!r.h }));
      each('stairs', r => ({ facing: r.f | 0, top: !!r.t }));
      each('ladders', r => ({ facing: r.f | 0 }));
      each('trapdoors', r => ({ facing: r.f | 0, open: !!r.o, top: !!r.t }));
      each('slabs', r => ({ top: !!r.t, double: !!r.d }));
      each('pots', r => (typeof r.p === 'string' ? { plant: r.p } : null));
      each('attach', r => ({ m: r.m | 0, f: r.f | 0, on: !!r.o }));
      each('signs', r => ({ wall: !!r.w, ang: r.a != null ? r.a | 0 : r.f != null ? (((4 - 2 * (r.f | 0)) % 8) + 8) % 8 : 0, lines: Array.isArray(r.l) ? r.l : [] }));
    } else {
      each('doors', r => ({ facing: r.facing | 0, open: !!r.open, hinge: r.hinge === 'left' ? 'left' : r.hinge === 'right' ? 'right' : undefined }));
      each('beds', r => ({ facing: r.facing | 0, head: !!r.head }));
      each('stairs', r => ({ facing: r.facing | 0, top: !!r.top }));
      each('ladders', r => ({ facing: r.facing | 0 }));
      each('trapdoors', r => ({ facing: r.facing | 0, open: !!r.open, top: !!r.top }));
      each('slabs', r => ({ top: !!r.top, double: !!r.double }));
      each('pots', r => (typeof r.plant === 'string' ? { plant: r.plant } : null));
      each('attach', r => ({ m: r.m | 0, f: r.f | 0, on: !!r.on }));
      each('signs', r => ({ wall: !!r.wall, ang: r.ang != null ? r.ang | 0 : r.facing != null ? (((4 - 2 * (r.facing | 0)) % 8) + 8) % 8 : 0, lines: Array.isArray(r.lines) ? r.lines : [] }));
    }
    return out;
  }
  // a first Leoncraft world (server file or browser save) as { seed, spawn, dims: [overworld, nether] stores }
  function readWorld(src, short) {
    const S = obj(src);
    const seed = (Number.isFinite(+S.seed) ? +S.seed : 0) >>> 0;
    const sp = S.spawn && Number.isFinite(+S.spawn.x) && Number.isFinite(+S.spawn.z) ? { x: +S.spawn.x, y: +S.spawn.y || 0, z: +S.spawn.z } : null;
    return { seed, spawn: sp, dims: [stores(S, short), stores(S.nether, short)] };
  }

  /* ---- the world as the first Leoncraft would show it: its terrain from the seed, then what was changed ---- */
  function view(W) {
    const gen = G.create(W.seed), cache = new Map();
    const terrain = (d, cx, cz) => {
      const k = d + ':' + cx + ',' + cz;
      let c = cache.get(k);
      if (!c) {
        c = d ? gen.nether(cx, cz) : gen.chunk(cx, cz);
        if (cache.size > 256) cache.delete(cache.keys().next().value);
        cache.set(k, c);
      }
      return c;
    };
    const id = (d, x, y, z) => {
      if (y < 0 || y >= WH) return 0;
      const e = W.dims[d].blocks.get(x + ',' + y + ',' + z);
      if (e !== undefined) return e;
      const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
      return terrain(d, cx, cz)[(y * CH + (z - cz * CH)) * CH + (x - cx * CH)];
    };
    return { gen, id, name: (d, x, y, z) => nameOf(id(d, x, y, z)) };
  }

  /* ---- the chunks the first Leoncraft's own terrain is kept in ----
     Every chunk with a change in it, the chunks a block over the edge of one (what a torch or a door hangs on, the
     ground beside a hole), and in the Overworld the chunks round the spawn, so the world looks the same as you come in. */
  const SPAWN_R = 3;
  function chunkSets(W) {
    const sets = [new Set(), new Set()];
    for (let d = 0; d < 2; d++) for (const k of W.dims[d].blocks.keys()) {
      const p = k.split(','), x = +p[0], z = +p[2];
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) sets[d].add(Math.floor((x + dx) / CH) + ',' + Math.floor((z + dz) / CH));
      sets[d].add(Math.floor(x / CH) + ',' + Math.floor(z / CH));
    }
    const s = spawnOf(W), scx = Math.floor(s.x / CH), scz = Math.floor(s.z / CH);
    for (let dz = -SPAWN_R; dz <= SPAWN_R; dz++) for (let dx = -SPAWN_R; dx <= SPAWN_R; dx++) sets[0].add((scx + dx) + ',' + (scz + dz));
    const order = a => [...a].map(k => k.split(',').map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1]).map(p => p[0] + ',' + p[1]).join(';');
    return [order(sets[0]), order(sets[1])];
  }
  // where you come in: the world's spawn, or where the first Leoncraft stood you with none set (8.5, 8.5)
  const spawnOf = W => (W.spawn ? { x: Math.floor(W.spawn.x), z: Math.floor(W.spawn.z) } : { x: 8, z: 8 });
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }
  // what a world carries for the generator (worker.js, world.js): its seed, its chunks, and a key for the chunk cache
  function genInfo(W) {
    const [ow, ne] = chunkSets(W);
    return { seed: W.seed, ow, ne, key: 'lc1v' + VERSION + '-' + hash(W.seed + '|' + ow + '|' + ne) + '-' + (ow.length + ne.length).toString(36) };
  }
  const parseSet = s => new Set(typeof s === 'string' && s ? s.split(';') : []);

  /* ---- paintings: the first Leoncraft hung a picture as a block in each cell it covers; Leoncraft 2's are
     entities (entities/items2.js Painting), one a picture, of the sizes it has (items.js PAINTING_VARIANTS) ---- */
  const LC2_PAINTINGS = [
    ['kebab', 1, 1], ['aztec', 1, 1], ['alban', 1, 1], ['aztec2', 1, 1], ['bomb', 1, 1], ['plant', 1, 1], ['wasteland', 1, 1], ['meditative', 1, 1],
    ['pool', 2, 1], ['courbet', 2, 1], ['sea', 2, 1], ['sunset', 2, 1], ['creebet', 2, 1], ['wanderer', 1, 2], ['graham', 1, 2], ['prairie_ride', 1, 2],
    ['match', 2, 2], ['bust', 2, 2], ['stage', 2, 2], ['void', 2, 2], ['skull_and_roses', 2, 2], ['wither', 2, 2], ['baroque', 2, 2], ['humble', 2, 2],
    ['bouquet', 3, 3], ['cavebird', 3, 3], ['cotan', 3, 3], ['endboss', 3, 3], ['fern', 3, 3], ['owlemons', 3, 3], ['sunflowers', 3, 3], ['tides', 3, 3], ['dennis', 3, 3],
    ['backyard', 3, 4], ['pond', 3, 4], ['fighters', 4, 2], ['changing', 4, 2], ['finding', 4, 2], ['lowmist', 4, 2], ['passage', 4, 2],
    ['skeleton', 4, 3], ['donkey_kong', 4, 3], ['pointer', 4, 4], ['pigscene', 4, 4], ['burning_skull', 4, 4], ['orb', 4, 4], ['unpacked', 4, 4],
  ];
  // the first Leoncraft's own one-block pictures, each as a one-block picture of the same name where there is one
  const OLD_PICTURES = { painting_kebab: 'kebab', painting_aztec: 'aztec', painting_alban: 'alban', painting_wanderer: 'wasteland', painting_sunset: 'meditative', painting_void: 'bomb' };
  // its gallery's sizes (minecraft.html ART); a picture no longer listed there is as big as its cells say
  const ART_SIZE = { sunflowers: [1, 1], van_gogh: [1, 1], mona_lisa: [1, 2], pearl: [1, 2], scream: [1, 2], wanderer: [1, 2], hokusai: [2, 1], sunrise: [2, 1],
    water_lilies: [2, 1], whistler: [2, 1], starry_night: [2, 2], kiss: [2, 2], kandinsky: [2, 2], birth_venus: [4, 2], last_supper: [4, 2], creation: [4, 2],
    night_watch: [4, 3], hay_wain: [4, 3], delights: [4, 4], ekirby: [2, 2], leon_tag: [4, 2] };
  function pickPainting(n, w, h) {
    if (OLD_PICTURES[n] && w === 1 && h === 1) return ['' + OLD_PICTURES[n], 1, 1];
    let best = null;
    for (const v of LC2_PAINTINGS) {
      if (v[1] > w || v[2] > h) continue;
      const score = v[1] * v[2] * 10 - Math.abs(v[1] / v[2] - w / h);
      if (!best || score > best.score + 1e-9) best = { score, list: [v] };
      else if (Math.abs(score - best.score) < 1e-9) best.list.push(v);
    }
    if (!best) return ['kebab', 1, 1];
    // (the same picture of the first Leoncraft always becomes the same one here)
    return best.list[parseInt(hash(n), 36) % best.list.length];
  }
  function paintings(W, d, V, out) {
    const cells = [];
    for (const [k, id] of W.dims[d].blocks) { const n = nameOf(id); if (n && PAINTING.test(n)) cells.push([k, n]); }
    const used = new Set();
    for (const [k, n] of cells) {
      if (used.has(k)) continue;
      const p = k.split(',').map(Number), at = W.dims[d].attach[k] || { m: 2, f: 0 }, f = (at.f | 0) & 3;
      const same = (x, y, z) => { const kk = x + ',' + y + ',' + z; if (used.has(kk) || nameOf(W.dims[d].blocks.get(kk)) !== n) return false; const a = W.dims[d].attach[kk]; return (((a && a.f) | 0) & 3) === f; };
      // the picture's lower corner, as the first Leoncraft finds it (artAnchor): down, then back along the wall
      const hx = f === 0 || f === 2 ? 1 : 0, hz = 1 - hx;
      let [x0, y0, z0] = p;
      while (same(x0, y0 - 1, z0)) y0--;
      while (same(x0 - hx, y0, z0 - hz)) { x0 -= hx; z0 -= hz; }
      const size = ART_SIZE[n.replace(/^art_/, '')] || null;
      let w = 1, h = 1;
      if (size && !/^painting_/.test(n)) { w = size[0]; h = size[1]; }
      else if (!/^painting_/.test(n)) {
        while (w < 4 && same(x0 + hx * w, y0, z0 + hz * w)) w++;
        while (h < 4 && same(x0, y0 + h, z0)) h++;
      }
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) used.add((x0 + hx * i) + ',' + (y0 + j) + ',' + (z0 + hz * i));
      used.add(k);
      // Leoncraft 2's picture of a size that fits, in the middle of the first Leoncraft's
      const [variant, W2, H2] = pickPainting(n, w, h);
      const face = [DIRV[f][0], 0, DIRV[f][2]], rx = -face[2], rz = face[0];
      // the cells as you face the wall: u to your right, v up
      const us = [], o = [x0, z0];
      for (let i = 0; i < w; i++) us.push((o[0] + hx * i) * rx + (o[1] + hz * i) * rz);
      const umin = Math.min(...us), u0 = umin + Math.floor((w - W2) / 2), v0 = y0 + Math.floor((h - H2) / 2);
      const au = u0 + Math.floor((W2 - 1) / 2), av = v0 + Math.floor((H2 - 1) / 2);
      const ax = rx ? au * rx : x0, az = rz ? au * rz : z0;
      const bl = [ax - face[0], av + Y_OFF[d], az - face[2]];
      // where items2.js setOn puts it (it does so again when it loads)
      const ox = W2 % 2 === 0 ? 0.5 : 0, oy = H2 % 2 === 0 ? 0.5 : 0;
      const px = bl[0] + 0.5 + face[0] * 0.5625 + rx * ox, pz = bl[2] + 0.5 + face[2] * 0.5625 + rz * ox, py = bl[1] + 0.5 - H2 / 2 + oy;
      out.paintings.push({ t: 'painting', p: [px, py, pz], v: [0, 0, 0], y: Math.atan2(-face[0], -face[2]), vr: variant, fc: face, bl, from: n });
      // the wall it hangs on, every block of it, for the check
      for (let i = 0; i < W2; i++) for (let j = 0; j < H2; j++) {
        const u = u0 + i, wx = rx ? u * rx : x0, wz = rz ? u * rz : z0;
        out.walls.push([wx - face[0], v0 + j, wz - face[2], variant]);
      }
    }
  }

  /* ---- the whole world ----
     cells: [x, row, z, name, meta] per dimension (row = Leoncraft 2's cell row); signs: Leoncraft 2's sign records
     (details.js); paintings: Leoncraft 2's painting entities; report: what was turned into what, and what was left out. */
  function convert(W) {
    const V = view(W), info = genInfo(W);
    const report = { blocks: [0, 0], cells: [0, 0], unknown: {}, standIns: {}, dropped: { outOfRange: 0, eggs: 0 }, doorTops: 0, signs: 0, paintings: 0 };
    const dims = [];
    for (let d = 0; d < 2; d++) {
      const S = W.dims[d], out = { cells: [], signs: [], paintings: [], walls: [], placed: new Map() };
      const off = Y_OFF[d], rows = ROWS[d];
      const put = (x, y, z, name, meta) => {
        const row = y + off;
        if (row < rows[0] || row > rows[1]) { report.dropped.outOfRange++; return; }
        const k = x + ',' + row + ',' + z;
        if (!out.placed.has(k)) report.cells[d]++;
        out.placed.set(k, [x, row, z, name, meta]);
      };
      for (const [k, id] of S.blocks) {
        report.blocks[d]++;
        const p = k.split(','), x = +p[0], y = +p[1], z = +p[2];
        if (y < 0 || y >= WH) { report.dropped.outOfRange++; continue; }
        if (id === 0) { put(x, y, z, 'air', 0); continue; }
        const n = nameOf(id);
        if (!n) { report.unknown[id] = (report.unknown[id] || 0) + 1; put(x, y, z, 'air', 0); continue; }
        if (GONE.test(n)) { report.dropped.eggs++; put(x, y, z, 'air', 0); continue; }
        if (PAINTING.test(n)) { put(x, y, z, 'air', 0); continue; }
        const nb = (dx, dy, dz) => V.name(d, x + dx, y + dy, z + dz);
        const k2 = kindOf(n);
        let st = null, upper = false;
        if (k2 === 'door') {
          // a door is its two cells; the first Leoncraft's server keeps its state at the bottom one, its browser at both
          let by = y;
          while (kindOf(V.name(d, x, by - 1, z)) === 'door') by--;
          upper = ((y - by) & 1) === 1;
          const bk = x + ',' + (upper ? y - 1 : y) + ',' + z;
          st = S.doors[bk] || S.doors[k] || null;
          // the top it drew over the bottom of a door, if it was never kept as a block of its own
          if (!upper && V.name(d, x, y + 1, z) === null && !S.blocks.has(x + ',' + (y + 1) + ',' + z)) {
            const c2 = cell(n, st, nb, true);
            put(x, y + 1, z, c2[0], c2[1]); report.doorTops++;
          }
        } else if (k2 === 'trapdoor') st = S.trapdoors[k];
        else if (k2 === 'slab') st = S.slabs[k];
        else if (k2 === 'stairs') st = S.stairs[k];
        else if (k2 === 'ladder') st = S.ladders[k];
        else if (k2 === 'bed') st = S.beds[k];
        else if (k2 === 'sign') st = S.signs[k];
        else if (k2 === 'pot') st = S.pots[k];
        else st = S.attach[k] || null;
        const c = cell(n, st, nb, upper);
        if (!c) { put(x, y, z, 'air', 0); continue; }
        if (c[0] !== n) report.standIns[n + ' -> ' + c[0]] = (report.standIns[n + ' -> ' + c[0]] || 0) + 1;
        put(x, y, z, c[0], c[1]);
        if (k2 === 'sign' && st && Array.isArray(st.lines) && st.lines.some(l => String(l || '').trim())) {
          const lines = st.lines.slice(0, 4).map(l => String(l == null ? '' : l).slice(0, 90));
          while (lines.length < 4) lines.push('');
          const row = y + off;
          if (row >= rows[0] && row <= rows[1]) {
            out.signs.push({ k: 's', p: [x, row, z], f: { lines, colour: 'black', glow: false }, b: { lines: ['', '', '', ''], colour: 'black', glow: false }, w: 0 });
            report.signs++;
          }
        }
      }
      paintings(W, d, V, out);
      report.paintings += out.paintings.length;
      dims.push(out);
    }
    const result = { seed: W.seed, lc1: info, spawn: spawnOf(W), dims, report };
    result.check = check(W, V, result);
    // what the check found the importer itself had left without its footing is put right, then looked at again
    if (fixSupports(V, result)) result.check = check(W, V, result);
    for (const D of dims) { D.cells = [...D.placed.values()]; delete D.placed; }
    return result;
  }

  /* ---- nothing hangs on nothing ----
     Every imported thing that hangs on or stands on a block (torches, buttons, levers, ladders, doors, signs, beds,
     lanterns, pots, plants, paintings) is looked at in the world as Leoncraft 2 will have it: its support worked out
     from its Leoncraft 2 meta (the face it is on), and that block's Leoncraft 2 form. Each one that is not held is
     put in one of three lists: lc1 (the first Leoncraft's world had it that way too: nothing there, or a block that
     is no whole cube there either, a slab or a fence), importer (the import is to blame: it must stay empty). */
  function check(W, V, R) {
    const out = { checked: 0, ok: 0, lc1: [], importer: [] };
    for (let d = 0; d < 2; d++) {
      const D = R.dims[d], off = Y_OFF[d];
      // the Leoncraft 2 form of any cell: what the import put there, else the first Leoncraft's own block, turned over
      const at = (x, row, z) => {
        const c = D.placed.get(x + ',' + row + ',' + z);
        if (c) return { name: c[3], meta: c[4], from: V.name(d, x, row - off, z) };
        const n = V.name(d, x, row - off, z), t = n ? terrainName(ID[n]) : ['air', 0];
        return { name: t[0], meta: t[1], from: n };
      };
      const bad = (list, c, why, sx, sy, sz) => list.push({ d, x: c[0], y: c[1] - off, z: c[2], row: c[1], name: c[3], meta: c[4], why, support: [sx, sy - off, sz] });
      for (const c of D.placed.values()) {
        const [x, row, z, name, meta] = c;
        const from = V.name(d, x, row - off, z);
        let need = null;            // [dx, dy, dz, what] the block this one needs
        if (/^(wall_torch|redstone_wall_torch|ladder)$/.test(name) || /_wall_sign$/.test(name)) need = [...FACE_N[meta & 7], 'face'];
        else if (/_button$|^lever$/.test(name)) need = [...FACE_N[meta & 7], 'face'];
        else if (/^(torch|redstone_torch)$/.test(name)) need = [0, -1, 0, 'post'];
        else if (/_sign$/.test(name)) need = [0, -1, 0, 'solid'];
        else if (/_door$/.test(name)) need = meta & 8 ? [0, -1, 0, 'door'] : [0, -1, 0, 'face'];
        else if (/_bed$/.test(name)) need = null;
        else if (/lantern$/.test(name) && !/^(jack_o|sea)_lantern$/.test(name)) need = meta & 1 ? [0, 1, 0, 'post'] : [0, -1, 0, 'post'];
        else if (/^potted_|^flower_pot$/.test(name)) need = [0, -1, 0, 'solid'];
        else if (from && PLANT.has(from) && !(TALL_FLOWERS.has(from) && (meta & 8))) need = [0, -1, 0, 'solid'];
        else if (from && TALL_FLOWERS.has(from)) need = [0, -1, 0, 'plant'];
        if (!need && !/_bed$/.test(name) && !/_door$/.test(name)) continue;
        out.checked++;
        if (/_bed$/.test(name)) {
          const F = meta & 3, head = !!(meta & 8), s = head ? -1 : 1, v = DIRV[F];
          const o = at(x + v[0] * s, row, z + v[2] * s);
          if (o.name === name && (o.meta & 3) === F && !!(o.meta & 8) !== head) out.ok++;
          else bad(o.from && kindOf(o.from) === 'bed' ? out.importer : out.lc1, c, 'the other half of the bed is not there', x + v[0] * s, row, z + v[2] * s);
          continue;
        }
        const [dx, dy, dz, what] = need, sx = x + dx, sy = row + dy, sz = z + dz, s = at(sx, sy, sz);
        // the first Leoncraft's own support for it, from its own state (supportCell), to know whose fault a missing one is
        const lc1At = V.name(d, sx, sy - off, sz);
        let held;
        if (what === 'face') held = lc2Cube(s.name, s.meta);
        else if (what === 'post') held = lc2Cube(s.name, s.meta) || /_fence$|_wall$|^iron_bars$|_pane$|^glass_pane$/.test(s.name) || (/_slab$/.test(s.name) && s.meta >= 1) || /_stairs$/.test(s.name) || /^(chain|iron_chain)$/.test(s.name);
        else if (what === 'door') held = s.name === name && !(s.meta & 8);
        else if (what === 'plant') held = s.name === name && !(s.meta & 8);
        else held = !!s.name && s.name !== 'air' && solidFooting(s.from || '') && !/^(water|lava)$/.test(s.name);
        if (held) { out.ok++; continue; }
        // a door's top that has lost its bottom, or a tall flower's: whose fault that is goes by the first Leoncraft's world
        if (what === 'door' || what === 'plant') { bad(kindOf(lc1At) === kindOf(from) && kindOf(from) ? out.importer : out.lc1, c, 'its lower half is not there', sx, sy, sz); continue; }
        // nothing to hold it in the first Leoncraft either, or only what is no whole cube there (a slab's side, a fence)
        if (!solidFooting(lc1At)) { bad(out.lc1, c, 'nothing to hold it in the first Leoncraft either (' + (lc1At || 'air') + ')', sx, sy, sz); continue; }
        if ((what === 'face' || what === 'post') && !lc1Cube(lc1At)) { bad(out.lc1, c, 'on ' + lc1At + ', no whole block in the first Leoncraft either', sx, sy, sz); continue; }
        bad(out.importer, c, 'on ' + s.name + ' (' + lc1At + ' in the first Leoncraft)', sx, sy, sz);
      }
      // a painting needs its whole wall
      for (const [wx, wy, wz, variant] of D.walls) {
        out.checked++;
        const row = wy + off, s = at(wx, row, wz), lc1At = V.name(d, wx, wy, wz);
        if (lc2Cube(s.name, s.meta) || (s.name !== 'air' && solidFooting(lc1At))) { out.ok++; continue; }
        const entry = { d, x: wx, y: wy, z: wz, row, name: 'painting ' + variant, meta: 0, why: 'no wall behind it (' + (lc1At || 'air') + ')', support: [wx, wy, wz] };
        (solidFooting(lc1At) ? out.importer : out.lc1).push(entry);
      }
    }
    return out;
  }
  // the importer's own: a block made a little lower in Leoncraft 2 (a path, farmland) under or behind what needs a whole one
  // becomes the full block it is made of
  function fixSupports(V, R) {
    let n = 0;
    for (const e of R.check.importer) {
      const D = R.dims[e.d], off = Y_OFF[e.d], [sx, sy, sz] = e.support, row = sy + off, k = sx + ',' + row + ',' + sz;
      const cur = D.placed.get(k), name = cur ? cur[3] : terrainName(ID[V.name(e.d, sx, sy, sz)] || 0)[0];
      if (SHORTER.has(name)) { D.placed.set(k, [sx, row, sz, 'dirt', 0]); n++; }
    }
    R.report.fixedSupports = n;
    return n;
  }

  /* ---- the first Leoncraft's Mecha maps (hubmaps.js): a block name with the state its editor kept beside it
     ({ s, t, d } a slab, { dr, f, o, h } a door, { td, f, o, t } a trapdoor, { bd, f, hd } a bed, { ld, f } a ladder,
     { a, m, f } a torch, lever or button, { f, t } stairs) ---- */
  function mecha(n, meta) {
    const m = meta || null;
    let st = null;
    if (m) {
      if (m.s) st = { top: !!m.t, double: !!m.d };
      else if (m.dr) st = { facing: m.f | 0, open: !!m.o, hinge: m.h ? 'left' : 'right' };
      else if (m.td) st = { facing: m.f | 0, open: !!m.o, top: !!m.t };
      else if (m.bd) st = { facing: m.f | 0, head: !!m.hd };
      else if (m.ld) st = { facing: m.f | 0 };
      else if (m.a) st = { m: m.m | 0, f: m.f | 0 };
      else if (m.f !== undefined) st = { facing: m.f | 0, top: !!m.t };
    }
    return cell(n, st, null, false);
  }

  return { VERSION, Y_OFF, LC1_TOP, NAMES, ID, nameOf, kindOf, cell, terrainName, terrainFix, T_FIX, readWorld, view, chunkSets, genInfo, parseSet,
    convert, check, mecha, spawnOf, hash, COLOURS, RENAME };
});
