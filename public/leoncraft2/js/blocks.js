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
export const AIR = 0;

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

export const COUNT = LIST.length + 1;

/* Flat lookup tables, which is what the hot loops in the mesher and the
   lighting want rather than objects. */
export const OPAQUE = new Uint8Array(256);     // a full cube nothing can be seen through
export const SOLID = new Uint8Array(256);      // you collide with it
export const OPACITY = new Uint8Array(256);    // sky light it takes away
export const EMIT = new Uint8Array(256);       // block light it gives off
export const FLUID = new Uint8Array(256);      // 1 water, 2 lava
export const PLANT = new Uint8Array(256);      // not a cube: drawn without occluding anything
for (const d of BLOCKS) {
  if (!d) continue;
  OPAQUE[d.id] = d.shape === 'cube' && d.pass === 'opaque' ? 1 : 0;
  SOLID[d.id] = d.solid ? 1 : 0;
  OPACITY[d.id] = d.opacity;
  EMIT[d.id] = d.light || 0;
  FLUID[d.id] = d.fluid === 'water' ? 1 : d.fluid === 'lava' ? 2 : 0;
  PLANT[d.id] = d.shape !== 'cube' && d.shape !== 'none' ? 1 : 0;
}

/* Which texture layer each face of each block uses, once the manifest is in.
   faces: 0 +x, 1 -x, 2 +y (top), 3 -y (bottom), 4 +z, 5 -z. */
export function resolveTextures(manifest) {
  const T = manifest.textures;
  const layer = n => (T[n] ? T[n].layer : (console.warn('no texture', n), 0));
  const variantsOf = n => (T[n] && T[n].variants ? [T[n].layer, ...T[n].variants] : null);
  for (const d of BLOCKS) {
    if (!d || d.id === 0) continue;
    const t = typeof d.tex === 'string' ? { top: d.tex, bottom: d.tex, side: d.tex } : d.tex;
    d.faces = [layer(t.side), layer(t.side), layer(t.top), layer(t.bottom), layer(t.side), layer(t.side)];
    if (t.front) d.front = layer(t.front);
    if (t.overlay) d.overlay = layer(t.overlay);
    if (d.snowySide) d.snowy = layer(d.snowySide);
    if (d.variants) d.variantLayers = variantsOf(typeof d.tex === 'string' ? d.tex : t.side);
    if (d.topVariants) d.topVariantLayers = variantsOf(t.top);
    const anim = T[typeof d.tex === 'string' ? d.tex : t.side];
    if (anim && anim.frames) d.anim = { frames: anim.frames, frametime: anim.frametime };
  }
  return BLOCKS;
}

// the blocks the hotbar starts with, and what number keys give
export const HOTBAR = ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'glowstone', 'water', 'lava'];
