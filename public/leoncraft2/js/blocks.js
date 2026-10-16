/* ---------------------------------------------------------------------------
   Leoncraft 2 - the blocks.

   One table, read by the world generator, the mesher (in workers) and the
   game. A block is an id (one byte, 0 = air), the textures on its faces,
   how it is drawn and how it behaves.

     shape   'cube' | 'cross' (plants) | 'fluid' | 'snow' (a layer) |
             'pad' (lily pad) | 'cactus' | 'torch' | 'none'
     pass    'opaque' | 'cutout' (alpha tested: leaves, plants, glass) |
             'translucent' (blended: ice, stained glass) | 'fluid'
     tint    'grass' | 'foliage' | 'spruce' | 'birch' | 'water' | null
     wave    0 still, 1 grass (rooted at the bottom), 2 leaves, 3 the top half
             of a tall plant, 4 underwater plant, 5 lily pad (bobs on water)
     light   block light it gives off (0-15)
     opacity how much sky light it takes away (15 = all, leaves and water 1)
--------------------------------------------------------------------------- */
import { DATA } from './blockdata.js?v=68';
import { MODEL_SHAPES, OFFSET_XZ, OFFSET_XYZ } from './models.js?v=68';
import { SHELF_TEX } from './shelfmushroom.js?v=68';
import { dimBlocks } from './dim/blocks.js?v=68';

export const AIR = 0;
export const MAX_ID = 4096;   // block ids are 16-bit in the world; this many fit the lookup tables

const LIST = [];
export const B = {};          // name -> id
export const BLOCKS = [];     // id -> def

function def(name, o) {
  const d = Object.assign({
    name, shape: 'cube', pass: 'opaque', solid: true, opacity: 15, light: 0,
    tint: null, wave: 0, replaceable: false, tex: name,
  }, o || {});
  d.id = LIST.length + 1;
  LIST.push(d);
  B[name] = d.id;
  BLOCKS[d.id] = d;
  return d.id;
}
BLOCKS[0] = { id: 0, name: 'air', shape: 'none', pass: 'none', solid: false, opacity: 0, light: 0, replaceable: true };
B.air = 0;

const plant = (o) => Object.assign({ shape: 'cross', pass: 'cutout', solid: false, opacity: 0, replaceable: true, wave: 1 }, o);
const leaves = (tex, tint) => ({ pass: 'cutout', opacity: 1, tint, wave: 2, tex, leaves: true });

// ---------------------------------------------------------------- terrain
def('stone', { variants: true });
def('deepslate', { tex: { top: 'deepslate_top', bottom: 'deepslate_top', side: 'deepslate' } });
def('granite', { variants: true }); def('diorite', { variants: true }); def('andesite', { variants: true });
def('tuff'); def('calcite'); def('smooth_basalt');
def('bedrock'); def('obsidian');
def('dirt', { variants: true }); def('coarse_dirt');
def('grass_block', { tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side', overlay: 'grass_block_side_overlay' },
  tint: 'grass', topVariants: true, snowySide: 'grass_block_snow' });
def('podzol', { tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' } });
def('mycelium', { tex: { top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side' } });
def('moss_block'); def('mud'); def('packed_mud');
def('sand', { variants: true, falls: true }); def('red_sand', { variants: true, falls: true });
def('sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' } });
def('red_sandstone', { tex: { top: 'red_sandstone_top', bottom: 'red_sandstone_bottom', side: 'red_sandstone' } });
def('gravel', { falls: true }); def('clay');
def('terracotta'); def('white_terracotta'); def('orange_terracotta'); def('yellow_terracotta');
def('brown_terracotta'); def('red_terracotta'); def('light_gray_terracotta');
def('snow_block', { tex: 'snow' }); def('powder_snow');
def('ice', { pass: 'translucent', opacity: 2, slippery: 0.98 });
def('packed_ice', { slippery: 0.98 }); def('blue_ice', { slippery: 0.989 });
def('snow', { shape: 'snow', solid: false, opacity: 0, replaceable: true, tex: 'snow', height: 2 / 16 });

// ------------------------------------------------------------------- ores
for (const o of ['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald']) {
  def(o + '_ore');
  def('deepslate_' + o + '_ore');
}

// ------------------------------------------------------------------- wood
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove']) {
  def(w + '_log', { tex: { top: w + '_log_top', bottom: w + '_log_top', side: w + '_log' }, log: true });
  def(w + '_planks');
}
def('oak_leaves', leaves('oak_leaves', 'foliage'));
def('spruce_leaves', leaves('spruce_leaves', 'spruce'));
def('birch_leaves', leaves('birch_leaves', 'birch'));
def('jungle_leaves', leaves('jungle_leaves', 'foliage'));
def('acacia_leaves', leaves('acacia_leaves', 'foliage'));
def('dark_oak_leaves', leaves('dark_oak_leaves', 'foliage'));
def('cherry_leaves', leaves('cherry_leaves', null));
def('mangrove_leaves', leaves('mangrove_leaves', 'foliage'));

// ----------------------------------------------------------------- plants
def('short_grass', plant({ tint: 'grass', offset: true }));
def('fern', plant({ tint: 'grass', offset: true }));
def('tall_grass', plant({ tint: 'grass', tex: 'tall_grass_bottom', upper: 'tall_grass_top_block' }));
def('tall_grass_top_block', plant({ tint: 'grass', tex: 'tall_grass_top', wave: 3, lower: 'tall_grass' }));
def('large_fern', plant({ tint: 'grass', tex: 'large_fern_bottom', upper: 'large_fern_top_block' }));
def('large_fern_top_block', plant({ tint: 'grass', tex: 'large_fern_top', wave: 3, lower: 'large_fern' }));
for (const f of ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley']) def(f, plant({ offset: true }));
for (const f of ['lilac', 'rose_bush', 'peony']) {
  def(f, plant({ tex: f + '_bottom', upper: f + '_top_block' }));
  def(f + '_top_block', plant({ tex: f + '_top', wave: 3, lower: f }));
}
def('sunflower', plant({ tex: 'sunflower_bottom', upper: 'sunflower_top_block' }));
def('sunflower_top_block', plant({ tex: 'sunflower_front', wave: 3, lower: 'sunflower' }));
def('dead_bush', plant({ wave: 0 }));
def('brown_mushroom', plant({ wave: 0, light: 1 })); def('red_mushroom', plant({ wave: 0 }));
def('sugar_cane', plant({ wave: 0, tint: 'grass' }));
def('sweet_berry_bush', plant({ tex: 'sweet_berry_bush_stage3' }));
def('oak_sapling', plant({}));
def('cactus', { shape: 'cactus', pass: 'cutout', opacity: 0, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' } });
def('pumpkin', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' } });
def('melon', { tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' } });
def('lily_pad', { shape: 'pad', pass: 'cutout', solid: false, opacity: 0, replaceable: false, tint: 'grass', wave: 5, tex: 'lily_pad' });
def('seagrass', plant({ wave: 4, waterlogged: true, tex: 'seagrass' }));
def('tall_seagrass', plant({ wave: 4, waterlogged: true, tex: 'tall_seagrass_bottom', upper: 'tall_seagrass_top_block' }));
def('tall_seagrass_top_block', plant({ wave: 4, waterlogged: true, tex: 'tall_seagrass_top', lower: 'tall_seagrass' }));
def('kelp', plant({ wave: 4, waterlogged: true, tex: 'kelp' }));
def('kelp_plant', plant({ wave: 4, waterlogged: true, tex: 'kelp_plant' }));
def('vine', plant({ tint: 'foliage', wave: 2, tex: 'vine', shape: 'vine' }));

// --------------------------------------------------------------- building
def('cobblestone', { variants: true }); def('mossy_cobblestone');
def('stone_bricks', { variants: true }); def('mossy_stone_bricks'); def('cracked_stone_bricks');
def('bricks'); def('smooth_stone');
def('glass', { pass: 'cutout', opacity: 0 });
def('white_stained_glass', { pass: 'translucent', opacity: 0 });
def('blue_stained_glass', { pass: 'translucent', opacity: 0 });
def('red_stained_glass', { pass: 'translucent', opacity: 0 });
def('glowstone', { light: 15 }); def('sea_lantern', { light: 15 });
def('jack_o_lantern', { light: 15, tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' } });
def('torch', { shape: 'torch', pass: 'cutout', solid: false, opacity: 0, light: 14, replaceable: false });
def('bookshelf', { tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' } });
def('crafting_table', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' } });
def('iron_block'); def('gold_block'); def('diamond_block'); def('emerald_block');
def('quartz_block', { tex: { top: 'quartz_block_top', bottom: 'quartz_block_top', side: 'quartz_block_side' } });
for (const c of ['white', 'red', 'blue', 'yellow', 'green', 'black']) def(c + '_wool');
def('hay_block', { tex: { top: 'hay_block_top', bottom: 'hay_block_top', side: 'hay_block_side' } });
def('magma_block', { tex: 'magma', light: 3 });

// ----------------------------------------------------------------- fluids
def('water', { shape: 'fluid', pass: 'fluid', solid: false, opacity: 1, replaceable: true, fluid: 'water', tint: 'water', tex: 'water_still' });
def('lava', { shape: 'fluid', pass: 'fluid', solid: false, opacity: 15, light: 15, replaceable: true, fluid: 'lava', tex: 'lava_still' });

/* ------------------------------------------------- every other block
   The rest of the game's blocks come from a generated list (built from the
   MIT minecraft-data tables by tools/leoncraft2/build_blocks.py). A block
   already made by hand above keeps its look and only takes the facts it is
   missing: its name on screen, creative tab, hardness, stack size. */
const TAKE = ['display', 'tab', 'order', 'item', 'stack', 'hardness', 'orient', 'icon', 'iconMeta', 'falls'];
for (const e of DATA) {
  const have = B[e.name];
  if (have !== undefined) {
    const d = BLOCKS[have];
    for (const k of TAKE) if (e[k] !== undefined && d[k] === undefined) d[k] = e[k];
    continue;
  }
  const o = Object.assign({}, e);
  delete o.name;
  const model = MODEL_SHAPES.has(o.shape) || o.shape === 'cross' || o.shape === 'torch' || o.shape === 'none';
  if (o.opacity === undefined) o.opacity = o.shape === 'cube' && (o.pass || 'opaque') === 'opaque' ? 15 : o.leaves ? 1 : 0;
  // a shaped block lets light through, or its own top would sit in the dark
  if (model && o.shape !== 'cube') o.opacity = Math.min(o.opacity, o.leaves ? 1 : 0);
  if (o.shape === 'none') { o.solid = false; o.pass = 'none'; if (!o.tex) o.tex = null; }
  def(e.name, o);
}
// a shelf mushroom's faces, small and large, each its own piece of the picture (shelfmushroom.js; the layers are
// made at start-up by render/shelfmushroom.js)
if (B.shelf_mushroom !== undefined) {
  const d = BLOCKS[B.shelf_mushroom];
  d.tex = Object.assign(typeof d.tex === 'string' ? { all: d.tex } : Object.assign({}, d.tex), SHELF_TEX);
}
// bamboo is its own model (models.js bambooModel), drawn from our own pictures made at start-up (render/bamboo.js):
// the stalk laid out as the game's models read theirs, and the small and large leaves
if (B.bamboo !== undefined) {
  const d = BLOCKS[B.bamboo];
  d.shape = 'bamboo';
  d.tex = { all: 'lc2_bamboo_stalk', small: 'lc2_bamboo_small_leaves', large: 'lc2_bamboo_large_leaves' };
}
// which plants the game moves about in their block, and how (models.js blockOffset): its own list, from the 26.1.2 jar
// (sulfur spike, from 26.3, keeps what the data gave it)
{
  const xz = new Set(OFFSET_XZ), xyz = new Set(OFFSET_XYZ);
  for (const d of BLOCKS) {
    if (!d || d.name === 'sulfur_spike') continue;
    d.offset = xyz.has(d.name) ? 'xyz' : xz.has(d.name) ? 'xz' : (d.lower && xz.has(d.lower) ? 'xz' : false);
  }
  if (B.sulfur_spike !== undefined && BLOCKS[B.sulfur_spike].offset) BLOCKS[B.sulfur_spike].offset = 'xz';
}
// the Nether's and the End's own blocks and items (portals, frames, flint and steel, eyes of ender)
dimBlocks(def, B, BLOCKS);
// item frames: in the game an entity on a block's face; here a block of their own that draws nothing itself
// (details.js draws the frame and what it holds), so they are picked, broken and saved like the rest
for (const [n, display] of [['lc2_item_frame', 'Item Frame'], ['lc2_glow_item_frame', 'Glow Item Frame']])
  def(n, { display, shape: 'frame', pass: 'cutout', solid: false, opacity: 0, item: false, tab: null, hardness: 0, tex: 'birch_planks', frame: true, glow: /glow/.test(n) });
// a conduit put into water stays in the water (the game's waterlogged state): a block of its own, drawn with the water
// round it, that is the conduit to everything else and leaves the water when it is broken
def('lc2_wet_conduit', { display: 'Conduit', shape: 'head', pass: 'cutout', tex: 'conduit', light: 15, opacity: 1, hardness: 3.0, item: false, tab: null, itemOf: 'conduit', waterlogged: true });
// corals, coral fans and sea pickles under water the same way (the reefs are made of them, and one put into water keeps it):
// a wet copy of each, its item, picture and shape the dry one's (place.js and gen/features.js swap them in)
for (const c of ['tube', 'brain', 'bubble', 'fire', 'horn']) for (const n of [c + '_coral', c + '_coral_fan', c + '_coral_wall_fan']) {
  if (B[n] === undefined) continue;
  const o = Object.assign({}, BLOCKS[B[n]]);
  delete o.id; delete o.name; delete o.order;
  def('lc2_wet_' + n, Object.assign(o, { item: false, tab: null, itemOf: n.replace('_wall_fan', '_fan'), waterlogged: true }));
}
if (B.sea_pickle !== undefined) {
  const o = Object.assign({}, BLOCKS[B.sea_pickle]);
  delete o.id; delete o.name; delete o.order;
  def('lc2_wet_sea_pickle', Object.assign(o, { item: false, tab: null, itemOf: 'sea_pickle', waterlogged: true }));
}
for (const d of BLOCKS) {
  if (!d) continue;
  if (d.display === undefined) d.display = d.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (d.item === undefined) d.item = d.shape !== 'fluid' && d.shape !== 'none' && !d.lower;
  if (d.stack === undefined) d.stack = 64;
  if (d.hardness === undefined) d.hardness = d.shape === 'cross' ? 0 : 1;
  if (d.log && !d.orient) d.orient = 'axis';
  if ((d.shape === 'door' || d.shape === 'trapdoor' || d.shape === 'pane' || d.shape === 'ladder' || d.shape === 'rail'
    || d.shape === 'wire' || d.shape === 'crop' || d.shape === 'vine' || d.shape === 'wall_torch') && d.pass === 'opaque') d.pass = 'cutout';
}

// a crafter faces the way it outputs, like a dispenser (meta bits 0-2)
if (B.crafter !== undefined && !BLOCKS[B.crafter].orient) BLOCKS[B.crafter].orient = 'facing';

// the end portal frame is not a full block, and shows its eye (see models.js portal_frame)
if (B.end_portal_frame !== undefined) Object.assign(BLOCKS[B.end_portal_frame], { shape: 'portal_frame', opacity: 0, content: 'dark_prismarine' });

// the hollow and village blocks get the game's models (models.js) rather than a cube or a borrowed shape
{
  const shapeOf = (n, shape, more) => { if (B[n] === undefined) return; const d = BLOCKS[B[n]]; d.shape = shape; d.opacity = 0; if (more) more(d); };
  const addTex = (d, extra) => { d.tex = Object.assign(typeof d.tex === 'string' ? { all: d.tex } : Object.assign({}, d.tex), extra); };
  for (const n of ['cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron']) shapeOf(n, 'cauldron');
  shapeOf('composter', 'composter', d => addTex(d, { compost: 'composter_compost', ready: 'composter_ready' }));
  shapeOf('hopper', 'hopper', d => { delete d.orient; });
  shapeOf('campfire', 'campfire', d => { delete d.orient; });
  shapeOf('soul_campfire', 'campfire', d => { delete d.orient; });
  // fire on the floor or against the sides that burn (models.js)
  shapeOf('fire', 'fire'); shapeOf('soul_fire', 'fire');
  // on any face of their cell, as the game's multiface blocks (models.js)
  for (const n of ['glow_lichen', 'sculk_vein', 'resin_clump']) shapeOf(n, 'multiface');
  shapeOf('bell', 'bell', d => addTex(d, { post: 'stone', bar: 'dark_oak_planks' }));
  shapeOf('enchanting_table', 'table');
  shapeOf('lectern', 'lectern', d => { delete d.orient; addTex(d, { base: 'lectern_base' }); });
  // the dirt a flower pot holds
  for (const d of BLOCKS) if (d && d.shape === 'pot') addTex(d, { inside: 'dirt' });
  shapeOf('grindstone', 'grindstone', d => { delete d.orient; addTex(d, { leg: 'dark_oak_log' }); });
  shapeOf('brewing_stand', 'brewing');
  shapeOf('stonecutter', 'stonecutter', d => { delete d.orient; addTex(d, { saw: 'stonecutter_saw' }); });
  shapeOf('beacon', 'beacon');
  for (const d of BLOCKS) if (d && /_shelf$/.test(d.name) && d.shape === 'cube') shapeOf(d.name, 'shelf', s => { delete s.orient; });
  shapeOf('conduit', 'conduit');
  shapeOf('lc2_wet_conduit', 'conduit');
  // turtle eggs, the sniffer egg and the dried ghast have models of their own (models.js)
  shapeOf('turtle_egg', 'eggs');
  // the shrieker's top is a ring: you see its soul through the middle (the game draws it cut out)
  if (B.sculk_shrieker !== undefined) BLOCKS[B.sculk_shrieker].pass = 'cutout';
  shapeOf('sniffer_egg', 'sniffer_egg', d => { delete d.orient; });
  shapeOf('dried_ghast', 'dried_ghast', d => { delete d.orient; });
  if (B.potted_cactus !== undefined) addTex(BLOCKS[B.potted_cactus], { cactusTop: 'cactus_top' });
  for (const [n, k] of [['potted_azalea_bush', 'azalea'], ['potted_flowering_azalea_bush', 'flowering_azalea']])
    if (B[n] !== undefined) addTex(BLOCKS[B[n]], { bushTop: k + '_top', bushSide: k + '_side' });
  shapeOf('decorated_pot', 'vase', d => { delete d.orient; addTex(d, { base: 'decorated_pot_base' }); });
  // the faces a few blocks show in some states: a dispenser's or dropper's front facing up or down, an open barrel, a cake's cut side
  for (const n of ['dispenser', 'dropper']) if (B[n] !== undefined) addTex(BLOCKS[B[n]], { fv: n + '_front_vertical' });
  if (B.barrel !== undefined) addTex(BLOCKS[B.barrel], { topOpen: 'barrel_top_open' });
  if (B.cake !== undefined) addTex(BLOCKS[B.cake], { inside: 'cake_inner' });
  // hanging signs hang from iron chains; on a wall, from a bar of their wood's stripped log
  for (const d of BLOCKS) if (d && d.hanging && d.tex) d.tex = Object.assign(typeof d.tex === 'string' ? { all: d.tex } : Object.assign({}, d.tex), { chain: 'iron_chain', bar: typeof d.tex === 'string' ? d.tex : d.tex.all || d.tex.side });
  // a banner's pole and crossbar are wood
  for (const d of BLOCKS) if (d && d.banner && d.tex) d.tex = Object.assign(typeof d.tex === 'string' ? { all: d.tex } : Object.assign({}, d.tex), { pole: 'dark_oak_planks' });
  // a candle cake's candle can be lit: its candle's lit texture
  for (const d of BLOCKS) if (d && /candle_cake$/.test(d.name) && typeof d.candle === 'string') d.tex = Object.assign({}, d.tex, { candleLit: d.candle + '_lit' });
}

export const COUNT = LIST.length + 1;

/* Flat lookup tables, which is what the hot loops in the mesher and the
   lighting want rather than objects. */
export const OPAQUE = new Uint8Array(MAX_ID);     // a full cube nothing can be seen through
export const SOLID = new Uint8Array(MAX_ID);      // you collide with it
export const OPACITY = new Uint8Array(MAX_ID);    // sky light it takes away
export const EMIT = new Uint8Array(MAX_ID);       // block light it gives off
export const FLUID = new Uint8Array(MAX_ID);      // 1 water, 2 lava
export const PLANT = new Uint8Array(MAX_ID);      // not a cube: drawn without occluding anything
for (const d of BLOCKS) {
  if (!d) continue;
  // a dirt path and farmland are a pixel short of a block, as the game's models (their side pictures leave the top row empty)
  if (d.name === 'dirt_path' || d.name === 'farmland') { d.flat = 15 / 16; d.opacity = 1; }   // (and let light in, as the game's light engine does for them)
  OPAQUE[d.id] = d.shape === 'cube' && d.pass === 'opaque' && !d.flat ? 1 : 0;
  SOLID[d.id] = d.solid ? 1 : 0;
  OPACITY[d.id] = d.opacity;
  EMIT[d.id] = d.light || 0;
  FLUID[d.id] = d.fluid === 'water' ? 1 : d.fluid === 'lava' ? 2 : 0;
  PLANT[d.id] = d.shape !== 'cube' && d.shape !== 'none' ? 1 : 0;
}

/* Which texture layer each face of each block uses, once the manifest is in.
   faces: 0 +x, 1 -x, 2 +y (top), 3 -y (bottom), 4 +z, 5 -z. */
// extra single textures some blocks carry, and the name the models look them up by
const EXTRA = { plant: 'plant', texLine: 'line', texLit: 'lit', texFlow: 'flow', texFire: 'fire', texBase: 'base', texLever: 'lever', candle: 'candle', content: 'content' };
export function resolveTextures(manifest) {
  const T = manifest.textures;
  const missing = [];
  const layer = n => (T[n] ? T[n].layer : (missing.push(n), 0));
  const variantsOf = n => (T[n] && T[n].variants ? [T[n].layer, ...T[n].variants] : null);
  // a texture set: one name for every face, or names by role (top, bottom, side, end, front...)
  const facesOf = tex => {
    if (!tex) return { t: {}, f: [0, 0, 0, 0, 0, 0] };            // invisible blocks (barrier, light, air)
    const t = typeof tex === 'string' ? { all: tex } : tex;
    const side = t.side || t.all || t.top || t.end;
    const top = t.top || t.end || t.all || side, bottom = t.bottom || t.end || t.top || t.all || side;
    return { t, f: [layer(side), layer(side), layer(top), layer(bottom), layer(side), layer(side)] };
  };
  for (const d of BLOCKS) {
    if (!d || d.id === 0) continue;
    const { t, f } = facesOf(d.tex);
    d.faces = f;
    d.L = {};
    for (const k in t) d.L[k] = layer(t[k]);
    for (const k in EXTRA) if (typeof d[k] === 'string') d.L[EXTRA[k]] = layer(d[k]);
    if (d.texUpper) d.facesUpper = facesOf(d.texUpper).f;
    if (d.shape === 'rail' && T[d.name + '_corner']) d.L.corner = T[d.name + '_corner'].layer;
    if (d.icon) d.iconLayer = layer(d.icon);
    if (t.back) d.back = layer(t.back);
    if (t.front) d.front = layer(t.front);
    if (t.overlay) d.overlay = layer(t.overlay);
    if (d.snowySide) d.snowy = layer(d.snowySide);
    if (d.variants) d.variantLayers = variantsOf(t.all || t.side);
    if (d.topVariants) d.topVariantLayers = variantsOf(t.top);
    const anim = T[t.all || t.side];
    if (anim && anim.frames) d.anim = { frames: anim.frames, frametime: anim.frametime };
  }
  if (missing.length) console.warn('no texture for', [...new Set(missing)].join(', '));
  return BLOCKS;
}

// the blocks the hotbar starts with, and what number keys give
export const HOTBAR = ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'glowstone', 'water', 'lava'];
