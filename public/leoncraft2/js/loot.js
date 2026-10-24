/* ---------------------------------------------------------------------------
   Leoncraft 2 - what a broken block drops.

   The game's block loot tables, written out from the Minecraft Wiki's pages
   for each block (Java Edition): most blocks drop themselves when broken
   with a tool that can harvest them and nothing otherwise; the rest are
   below. Fortune and Silk Touch work as in the game:

     ore formula     count * (max(0, rand(0..level+1) - 1) + 1)   coal, diamond,
                     emerald, lapis, quartz, raw copper/iron/gold, nether gold...
     uniform bonus   count + rand(0..level * k)                   redstone, glowstone,
                     melon, sea lantern, sweet berries, nether wart
     binomial bonus  + binomial(3 + level, 0.5714286)             seeds of ripe crops
     table bonus     chance per level                              saplings, sticks and
                     apples from leaves, flint from gravel

   Experience comes with ores and a few blocks (a spawner 15-43, sculk),
   never with Silk Touch.

     const out = blockDrops(world, x, y, z, b, meta, { stack, popped });
     out.items   [{ id, count }]
     out.xp      experience points
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=107';
import { I, ITEMS } from './items.js?v=107';
import { canHarvest } from './mining.js?v=107';

const rnd = n => Math.floor(Math.random() * n);
const between = (a, b) => a + rnd(b - a + 1);
const oreBonus = (count, level) => level > 0 ? count * (Math.max(0, rnd(level + 2) - 1) + 1) : count;
const uniformBonus = (count, level, k) => count + (level > 0 ? rnd(level * k + 1) : 0);
const binomial = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (Math.random() < p) k++; return k; };
const table = (level, chances) => Math.random() < chances[Math.min(level, chances.length - 1)];

const SAPLING = [0.05, 0.0625, 0.083333336, 0.1];
const JUNGLE_SAPLING = [0.025, 0.027777778, 0.03125, 0.041666668, 0.1];
const STICKS = [0.02, 0.022222223, 0.025, 0.033333335, 0.1];
const APPLE = [0.005, 0.0055555557, 0.00625, 0.008333334, 0.025];
const FLINT = [0.1, 0.14285715, 0.25, 1];

// ores: [drop, min, max, bonus ('ore' | 'uniform'), xp min, xp max]
const ORES = {
  coal_ore: ['coal', 1, 1, 'ore', 0, 2], deepslate_coal_ore: ['coal', 1, 1, 'ore', 0, 2],
  diamond_ore: ['diamond', 1, 1, 'ore', 3, 7], deepslate_diamond_ore: ['diamond', 1, 1, 'ore', 3, 7],
  emerald_ore: ['emerald', 1, 1, 'ore', 3, 7], deepslate_emerald_ore: ['emerald', 1, 1, 'ore', 3, 7],
  lapis_ore: ['lapis_lazuli', 4, 9, 'ore', 2, 5], deepslate_lapis_ore: ['lapis_lazuli', 4, 9, 'ore', 2, 5],
  redstone_ore: ['redstone', 4, 5, 'uniform', 1, 5], deepslate_redstone_ore: ['redstone', 4, 5, 'uniform', 1, 5],
  copper_ore: ['raw_copper', 2, 5, 'ore', 0, 0], deepslate_copper_ore: ['raw_copper', 2, 5, 'ore', 0, 0],
  iron_ore: ['raw_iron', 1, 1, 'ore', 0, 0], deepslate_iron_ore: ['raw_iron', 1, 1, 'ore', 0, 0],
  gold_ore: ['raw_gold', 1, 1, 'ore', 0, 0], deepslate_gold_ore: ['raw_gold', 1, 1, 'ore', 0, 0],
  nether_gold_ore: ['gold_nugget', 2, 6, 'ore', 0, 1], nether_quartz_ore: ['quartz', 1, 1, 'ore', 2, 5],
  gilded_blackstone: null,
};
// blocks that become something else without Silk Touch
const TURNS_INTO = {
  stone: 'cobblestone', deepslate: 'cobbled_deepslate', grass_block: 'dirt', podzol: 'dirt', mycelium: 'dirt',
  dirt_path: 'dirt', farmland: 'dirt', crimson_nylium: 'netherrack', warped_nylium: 'netherrack', reinforced_deepslate: null,
};
// only with Silk Touch (glass, ice...): nothing otherwise
const SILK_ONLY = /^(glass|glass_pane|tinted_glass|.*_stained_glass|.*_stained_glass_pane|ice|packed_ice|blue_ice|turtle_egg|sculk_vein|.*_coral|.*_coral_fan|.*_coral_wall_fan|infested_.*|bee_nest|chiseled_bookshelf|small_amethyst_bud|medium_amethyst_bud|large_amethyst_bud)$/;
// only with shears (or Silk Touch where the game allows it): nothing otherwise
const SHEARS_ONLY = /^(vine|glow_lichen|seagrass|tall_seagrass|hanging_roots|nether_sprouts|cave_vines_x|pale_hanging_moss|small_dripleaf)$/;
// with shears (or Silk Touch), or by the table bonus without them
const NETHER_VINES = /^(twisting|weeping)_vines(_plant)?$/;
const NETHER_VINE = [0.33, 0.55, 0.77, 1];
// nothing at all, Silk Touch or not
const NEVER = new Set(['fire', 'soul_fire', 'nether_portal', 'end_portal', 'end_gateway', 'moving_piston', 'piston_head', 'bubble_column',
  'frosted_ice', 'cake', 'candle_cake', 'water', 'lava', 'powder_snow', 'air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void',
  'budding_amethyst', 'trial_spawner', 'vault', 'reinforced_deepslate', 'suspicious_sand', 'suspicious_gravel', 'frogspawn', 'farmland_x']);
// experience without Silk Touch (the Experience page): the spawner only with a pickaxe, as it only breaks properly with one
const EXPERIENCE = { spawner: [15, 43], sculk: [1, 1], sculk_catalyst: [5, 5], sculk_shrieker: [5, 5], sculk_sensor: [5, 5], calibrated_sculk_sensor: [5, 5] };

const add = (out, name, count) => {
  if (count <= 0) return;
  const id = typeof name === 'number' ? name : I[name];
  if (id === undefined || !id) return;
  for (const s of out.items) if (s.id === id && !s.dmg) { s.count += count; return; }
  out.items.push({ id, count });
};
// the item a block gives when it drops itself (a wall torch gives a torch, a crop its seeds)
function itemOfBlock(d) {
  if (d.lower) return itemOfBlock(BLOCKS[B[d.lower]]);
  const std = d.name.replace(/_wall_(torch|sign|hanging_sign|banner|head|skull|fan)$/, '_$1').replace(/^wall_torch$/, 'torch')
    .replace(/^(.*)_wall_hanging_sign$/, '$1_hanging_sign');
  if (std !== d.name && I[std] !== undefined) return I[std];
  if (/^potted_/.test(d.name)) return I.flower_pot;
  if (d.itemOf && I[d.itemOf] !== undefined) return I[d.itemOf];
  if (ITEMS[d.id]) return d.id;
  return 0;
}

/* Drops for a block broken at (x, y, z). ctx.stack: the held stack (null for
   the hand); ctx.popped: it fell off because the block under or behind it
   went (drops as if broken by hand, never needing a tool). */
export function blockDrops(world, x, y, z, b, meta, ctx) {
  const out = { items: [], xp: 0 };
  const d = BLOCKS[b];
  if (!d || NEVER.has(d.name) || FLUID[b]) return out;
  const st = ctx && ctx.stack, it = st ? ITEMS[st.id] : null, tool = it && it.tool ? it.tool : null;
  const ench = (st && st.ench) || {};
  const silk = !!ench.silk_touch, fortune = ench.fortune | 0;
  const shears = !!tool && tool.kind === 'shears';
  const popped = !!(ctx && ctx.popped);
  const n = d.name;
  if (!popped && !canHarvest(tool, d)) return out;
  // the other half of a door, a bed, a tall plant: the half that was hit drops for both
  if (d.lower) return blockDrops(world, x, y - 1, z, B[d.lower], meta, ctx);

  // ores
  const ore = ORES[n];
  if (ore) {
    if (silk) { add(out, n, 1); return out; }
    let c = between(ore[1], ore[2]);
    c = ore[3] === 'ore' ? oreBonus(c, fortune) : uniformBonus(c, fortune, 1);
    add(out, ore[0], c);
    if (ore[5]) out.xp = between(ore[4], ore[5]);
    return out;
  }
  // a spawner gives only experience, and none with Silk Touch
  if (n === 'spawner') { if (!silk) out.xp = between(15, 43); return out; }
  // cave vines: a glow berry when they have berries on them (meta bit 0), whatever the tool, and nothing else
  if (n === 'cave_vines' || n === 'cave_vines_plant') { if (meta & 1) add(out, 'glow_berries', 1); return out; }
  if (silk) {
    // snow keeps its layers (all eight: a snow block); an infested block gives the plain one
    if (n === 'snow') { if ((meta & 7) === 7) add(out, 'snow_block', 1); else add(out, 'snow', (meta & 7) + 1); return out; }
    if (/^infested_/.test(n)) { add(out, n.replace(/^infested_/, ''), 1); return out; }
  }
  // a tripwire's string, whatever breaks it
  if (n === 'tripwire') { add(out, 'string', 1); return out; }
  // (what needs shears gives nothing to Silk Touch, pale hanging moss apart)
  if (silk && !/^(.*_leaves|short_grass|fern|tall_grass|large_fern)$/.test(n) && !(SHEARS_ONLY.test(n) && n !== 'pale_hanging_moss') && ITEMS[d.id]) { add(out, d.id, slabCount(d, meta)); return out; }
  if (TURNS_INTO[n] !== undefined) { if (TURNS_INTO[n]) add(out, TURNS_INTO[n], 1); return out; }
  if (SILK_ONLY.test(n)) {
    if (EXPERIENCE[n]) out.xp = between(EXPERIENCE[n][0], EXPERIENCE[n][1]);
    return out;
  }
  // weeping and twisting vines: themselves with shears, otherwise a 33% chance (more with Fortune), as when they fall
  if (NETHER_VINES.test(n)) { if (shears || silk || table(fortune, NETHER_VINE)) add(out, n.replace(/_plant$/, ''), 1); return out; }
  if (SHEARS_ONLY.test(n)) { if (shears) add(out, itemOfBlock(d), slabCount(d, meta)); return out; }

  // leaves: themselves with shears (or Silk Touch), else a sapling, sticks and apples by chance
  if (d.leaves || /_leaves$/.test(n)) {
    if (shears || silk) { add(out, d.id, 1); return out; }
    const sap = { oak: 'oak_sapling', spruce: 'spruce_sapling', birch: 'birch_sapling', jungle: 'jungle_sapling', acacia: 'acacia_sapling',
      dark_oak: 'dark_oak_sapling', cherry: 'cherry_sapling', pale_oak: 'pale_oak_sapling', azalea: 'azalea', flowering_azalea: 'flowering_azalea', poplar: 'poplar_sapling' };
    const kind = n.replace(/_leaves$/, '');
    if (sap[kind] && table(fortune, kind === 'jungle' ? JUNGLE_SAPLING : SAPLING)) add(out, sap[kind], 1);
    if (table(fortune, STICKS)) add(out, 'stick', between(1, 2));
    if ((kind === 'oak' || kind === 'dark_oak') && table(fortune, APPLE)) add(out, 'apple', 1);
    return out;
  }
  switch (n) {
    case 'gravel': add(out, table(fortune, FLINT) ? 'flint' : 'gravel', 1); return out;
    case 'short_grass': case 'fern':
      if (shears) add(out, n, 1);
      else if (Math.random() < 0.125) add(out, 'wheat_seeds', uniformBonus(1, fortune, 2));
      return out;
    case 'tall_grass': case 'large_fern':
      if (shears) add(out, n === 'tall_grass' ? 'short_grass' : 'fern', 2);
      else if (Math.random() < 0.125) add(out, 'wheat_seeds', 1);
      return out;
    case 'dead_bush': if (shears) add(out, n, 1); else add(out, 'stick', between(0, 2)); return out;
    case 'cobweb': add(out, shears ? 'cobweb' : 'string', 1); return out;
    case 'snow': add(out, 'snowball', ((meta & 7) + 1)); return out;
    case 'snow_block': add(out, 'snowball', 4); return out;
    case 'clay': add(out, 'clay_ball', 4); return out;
    case 'bookshelf': add(out, 'book', 3); return out;
    case 'glowstone': add(out, 'glowstone_dust', Math.min(4, uniformBonus(between(2, 4), fortune, 1))); return out;
    case 'sea_lantern': add(out, 'prismarine_crystals', Math.min(5, uniformBonus(between(2, 3), fortune, 1))); return out;
    case 'melon': add(out, 'melon_slice', Math.min(9, uniformBonus(between(3, 7), fortune, 1))); return out;
    case 'ender_chest': add(out, 'obsidian', 8); return out;
    case 'campfire': add(out, 'charcoal', 2); return out;
    case 'soul_campfire': add(out, 'soul_soil', 1); return out;
    // -6 to 2, never below 0: none 7 times in 9, one or two once in 9 each (Fortune does nothing)
    case 'brown_mushroom_block': case 'red_mushroom_block': add(out, n.replace('_block', ''), Math.max(0, between(-6, 2))); return out;
    // 4 shards with a pickaxe (Fortune multiplies, as with ores), 2 with anything else
    case 'amethyst_cluster': add(out, 'amethyst_shard', tool && tool.kind === 'pickaxe' ? oreBonus(4, fortune) : 2); return out;
    case 'mushroom_stem': return out;
    case 'gilded_blackstone': if (table(fortune, [0.1, 0.14285715, 0.25, 1])) add(out, 'gold_nugget', between(2, 5)); else add(out, n, 1); return out;
    case 'wheat': crop(out, meta, 7, 'wheat', 'wheat_seeds', fortune); return out;
    case 'beetroots': crop(out, meta, 3, 'beetroot', 'beetroot_seeds', fortune); return out;
    // ripe carrots and potatoes: one, and a second with the binomial bonus on it (2 to 5, Fortune adds tries)
    case 'carrots': add(out, 'carrot', (meta & 7) >= 7 ? 2 + binomial(3 + fortune, 0.5714286) : 1); return out;
    case 'potatoes':
      add(out, 'potato', (meta & 7) >= 7 ? 2 + binomial(3 + fortune, 0.5714286) : 1);
      if ((meta & 7) >= 7 && Math.random() < 0.02) add(out, 'poisonous_potato', 1);
      return out;
    case 'nether_wart': add(out, 'nether_wart', (meta & 3) >= 3 ? uniformBonus(between(2, 4), fortune, 1) : 1); return out;
    // (cocoa's age is meta bits 3-4, sim/states.js: three beans when it is full grown, age 2)
    case 'cocoa': add(out, 'cocoa_beans', (meta >> 3 & 3) >= 2 ? 3 : 1); return out;
    // a large shelf mushroom (meta bit 3) gives two
    case 'shelf_mushroom': add(out, 'shelf_mushroom', meta & 8 ? 2 : 1); return out;
    case 'sweet_berry_bush': { const age = meta & 3; if (age >= 2) add(out, 'sweet_berries', uniformBonus(age === 3 ? between(2, 3) : between(1, 2), fortune, 1)); return out; }
    case 'melon_stem': case 'pumpkin_stem': case 'attached_melon_stem': case 'attached_pumpkin_stem': add(out, n.indexOf('melon') >= 0 ? 'melon_seeds' : 'pumpkin_seeds', 0); return out;
    case 'sculk': out.xp = 1; break;
    // a creaking heart: 1 to 3 resin clumps (Fortune adds), experience only from one the trees grew (meta 3 and up)
    case 'creaking_heart': add(out, 'resin_clump', uniformBonus(between(1, 3), fortune, 1)); if (meta >= 3) out.xp = between(20, 24); return out;
    case 'sculk_catalyst': case 'sculk_shrieker': case 'sculk_sensor': case 'calibrated_sculk_sensor': out.xp = 5; break;
  }
  // flower pots give the pot and the plant
  if (/^potted_/.test(n)) {
    add(out, 'flower_pot', 1);
    const plant = n.replace(/^potted_/, '');
    if (I[plant] !== undefined) add(out, plant, 1);
    return out;
  }
  // candles, sea pickles, slabs: as many as there are
  add(out, itemOfBlock(d), slabCount(d, meta));
  return out;
}

function crop(out, meta, ripe, item, seeds, fortune) {
  if ((meta & 7) >= ripe) { add(out, item, 1); add(out, seeds, 1 + binomial(3 + fortune, 0.5714286)); }
  else add(out, seeds, 1);
}
// how many items a block is: a double slab is two, three candles three
function slabCount(d, meta) {
  // (the low blocks drawn as slabs, sculk sensors and daylight detectors, keep other things in their meta)
  if (d.shape === 'slab') return /_slab$/.test(d.name) && (meta & 3) === 2 ? 2 : 1;
  if (d.shape === 'candle' || /sea_pickle|^.*_candle$|^candle$/.test(d.name)) return (meta & 7) + 1;
  if (d.name === 'pink_petals' || d.name === 'wildflowers' || d.name === 'leaf_litter' || d.name === 'turtle_egg') return (meta & 3) + 1;
  // glow lichen, sculk veins and resin clumps: one for each face
  if (d.shape === 'multiface') { let k = 0; for (let i = 0; i < 6; i++) if (meta & (1 << i)) k++; return k || 1; }
  return 1;
}
