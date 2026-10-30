/* ---------------------------------------------------------------------------
   Leoncraft 2 - maps: what they hold and how they fill in.

   As in the game (Minecraft Wiki, Map and Map item format; Java Edition):

     making one      using an empty map draws a map of the grid square you
                     stand in: 128 x 128 pixels, 128 blocks across at scale 0
                     (each zoom doubles it, up to 2048 at scale 4), squares
                     lined up so that no two maps of a size overlap
     filling in      held in either hand, a map records the surface within
                     128 blocks of you (64 in the Nether), a sixteenth of its
                     columns a tick, so the whole round you in under a second
     a pixel         the colour of the most common top block (the first one
                     down that shows on maps) of the blocks it covers; on
                     land lighter when higher than the pixel north of it and
                     darker when lower, with a checkerboard where it is
                     nearly level; water darker the deeper it is; in the
                     Nether a red and grey pattern, whatever is there
     you on it       a white pointer facing your way; off the edge a white
                     dot on the rim (until you are too far)
     copies          share their picture (they are one map); a locked map
                     no longer changes; zooming out starts a new, empty map
     explorer maps   from a chest (containers.js): centred on the structure
                     it leads to, its place marked (a red X for buried
                     treasure, our own little markers for the rest)

   The colours are the game's 62 base colours, each in four shades (180,
   220, 255 and 135 of 255), and which blocks show which is the wiki's
   table, read by name below. Maps belong to the world and are saved with
   it (main.js opens and saves them).
--------------------------------------------------------------------------- */
import { BLOCKS, B, FLUID } from './blocks.js?v=118';
import { H } from './world-const.js?v=118';
import { ITEMS } from './items.js?v=118';
import { BIOMES } from './biomes.js?v=118';

// the base colours, by id
const BASE = [null, [127, 178, 56], [247, 233, 163], [199, 199, 199], [255, 0, 0], [160, 160, 255], [167, 167, 167], [0, 124, 0], [255, 255, 255], [164, 168, 184],
  [151, 109, 77], [112, 112, 112], [64, 64, 255], [143, 119, 72], [255, 252, 245], [216, 127, 51], [178, 76, 216], [102, 153, 216], [229, 229, 51], [127, 204, 25],
  [242, 127, 165], [76, 76, 76], [153, 153, 153], [76, 127, 153], [127, 63, 178], [51, 76, 178], [102, 76, 51], [102, 127, 51], [153, 51, 51], [25, 25, 25],
  [250, 238, 77], [92, 219, 213], [74, 128, 255], [0, 217, 58], [129, 86, 49], [112, 2, 0], [209, 177, 161], [159, 82, 36], [149, 87, 108], [112, 108, 138],
  [186, 133, 36], [103, 117, 53], [160, 77, 78], [57, 41, 35], [135, 107, 98], [87, 92, 92], [122, 73, 88], [76, 62, 92], [76, 50, 35], [76, 82, 42],
  [142, 60, 46], [37, 22, 16], [189, 48, 49], [148, 63, 97], [92, 25, 29], [22, 126, 134], [58, 142, 140], [86, 44, 62], [20, 180, 133], [100, 100, 100],
  [216, 175, 147], [127, 167, 150]];
const SHADE = [180, 220, 255, 135];
// every map colour (base * 4 + shade) as 0xRRGGBB
export const MAP_RGB = new Uint32Array(BASE.length * 4);
for (let i = 1; i < BASE.length; i++) for (let s = 0; s < 4; s++) { const [r, g, b] = BASE[i]; MAP_RGB[i * 4 + s] = (Math.floor(r * SHADE[s] / 255) << 16) | (Math.floor(g * SHADE[s] / 255) << 8) | Math.floor(b * SHADE[s] / 255); }

/* ---- which base colour a block shows (the wiki's table) ---- */
const DYE_BASE = { white: 8, orange: 15, magenta: 16, light_blue: 17, yellow: 18, lime: 19, pink: 20, gray: 21, light_gray: 22, cyan: 23, purple: 24, blue: 25, brown: 26, green: 27, red: 28, black: 29 };
const TERRA = { white: 36, orange: 37, magenta: 38, light_blue: 39, yellow: 40, lime: 41, pink: 42, gray: 43, light_gray: 44, cyan: 45, purple: 46, blue: 47, brown: 48, green: 49, red: 50, black: 51 };
const WOOD = { oak: 13, spruce: 34, birch: 2, jungle: 10, acacia: 15, dark_oak: 26, mangrove: 28, cherry: 36, pale_oak: 14, bamboo: 18, crimson: 53, warped: 56, poplar: 22 };
const RULES = [
  [/^(air|cave_air|void_air|barrier|light|structure_void|.*glass_pane|glass|.*torch|.*rail|redstone_wire|ladder|lever|.*_button|repeater|comparator|tripwire.*|flower_pot|potted_.*|.*_head|.*_skull|.*_wall_head|.*_wall_skull|end_rod|iron_bars|.*chain|cake|.*candle_cake|nether_portal|test_instance_block)$/, 0],
  [/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(wool|carpet|shulker_box|bed|stained_glass|concrete|concrete_powder|candle)$/, m => DYE_BASE[m[1]]],
  [/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_glazed_terracotta$/, m => DYE_BASE[m[1]]],
  [/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_terracotta$/, m => TERRA[m[1]]],
  [/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(wall_)?banner$/, 13],
  [/^(grass_block|slime_block)$/, 1],
  [/^(pale_oak_leaves|pale_oak_sapling|closed_eyeblossom|iron_block|iron_door|brewing_stand|heavy_weighted_pressure_plate|iron_trapdoor|lantern|soul_lantern|anvil|chipped_anvil|damaged_anvil|grindstone|lodestone|heavy_core)$/, 6],
  [/^cherry_(leaves|sapling)$/, 20],
  [/_leaves$/, 7],
  [/^(water|kelp|kelp_plant|seagrass|tall_seagrass|bubble_column)$/, 12],
  [/^(lava|tnt|fire|redstone_block)$/, 4],
  [/^soul_fire$/, 17],
  [/^(ice|frosted_ice|packed_ice|blue_ice)$/, 5],
  [/^(snow|snow_block|powder_snow)$/, 8],
  [/^(cobweb|mushroom_stem|white_candle)$/, 3],
  [/^(clay|infested_.*)$/, 9],
  [/^(sand|suspicious_sand|.*(?<!red_)sandstone.*|glowstone|end_stone.*|bone_block|turtle_egg|scaffolding|candle|ochre_froglight|frogspawn)$/, 2],
  [/^(red_sand|red_sandstone.*|cut_red_sandstone.*|smooth_red_sandstone.*|chiseled_red_sandstone|pumpkin|carved_pumpkin|jack_o_lantern|terracotta|honey_block|honeycomb_block|lightning_rod|raw_copper_block|copper_block|cut_copper.*|chiseled_copper|copper_grate|copper_door|copper_bulb|waxed_copper_block|waxed_cut_copper.*|waxed_chiseled_copper|waxed_copper_grate|waxed_copper_door|waxed_copper_bulb)$/, 15],
  [/^(exposed_|waxed_exposed_)/, 44],
  [/^(weathered_|waxed_weathered_)/, 56],
  [/^(oxidized_|waxed_oxidized_)/, 55],
  [/^purpur/, 16],
  [/^(sponge|wet_sponge|hay_block|horn_coral.*|bee_nest|short_dry_grass|tall_dry_grass|bamboo_mosaic.*|.*sulfur.*)$/, 18],
  [/^melon$/, 19],
  [/^(brain_coral.*|pearlescent_froglight|cactus_flower)$/, 20],
  [/^(dead_.*coral.*|tinted_glass|dried_ghast)$/, 21],
  [/^(structure_block|jigsaw|pale_moss_carpet|pale_moss_block|test_block)$/, 22],
  [/^(prismarine|prismarine_slab|prismarine_stairs|prismarine_wall|warped_roots|warped_fungus|twisting_vines.*|nether_sprouts|sculk_sensor|calibrated_sculk_sensor)$/, 23],
  [/^(shulker_box|mycelium|chorus_plant|chorus_flower|repeating_command_block|bubble_coral.*|amethyst_block|budding_amethyst|amethyst_cluster|.*_amethyst_bud)$/, 24],
  [/^tube_coral/, 25],
  [/^(soul_sand|soul_soil|command_block|brown_mushroom|leaf_litter)$/, 26],
  [/^(end_portal_frame|chain_command_block|sea_pickle|moss_carpet|moss_block|dried_kelp_block)$/, 27],
  [/^(bricks|brick_slab|brick_stairs|brick_wall|red_mushroom_block|nether_wart|enchanting_table|nether_wart_block|fire_coral.*|red_mushroom|shroomlight|sniffer_egg|.*cinnabar.*)$/, 28],
  [/^(obsidian|end_portal|dragon_egg|coal_block|end_gateway|basalt|polished_basalt|smooth_basalt|netherite_block|ancient_debris|crying_obsidian|respawn_anchor|.*blackstone.*|sculk.*)$/, 29],
  [/^(gold_block|light_weighted_pressure_plate|bell|raw_gold_block|potent_sulfur)$/, 30],
  [/^(diamond_block|beacon|prismarine_brick.*|dark_prismarine.*|conduit)$/, 31],
  [/^lapis_block$/, 32],
  [/^emerald_block$/, 33],
  [/^(podzol|campfire|soul_campfire|mangrove_roots|muddy_mangrove_roots)$/, 34],
  [/^(netherrack|nether_brick.*|chiseled_nether_bricks|cracked_nether_bricks|nether_gold_ore|nether_quartz_ore|magma_block|red_nether_brick.*|crimson_roots|crimson_fungus|weeping_vines.*)$/, 35],
  [/^calcite$/, 36],
  [/^(redstone_lamp|resin.*|chiseled_resin_bricks)$/, 37],
  [/^tuff|_tuff/, 43],
  [/^(mud_brick.*)$/, 44],
  [/^mud$/, 45],
  [/^(dripstone_block|pointed_dripstone)$/, 48],
  [/^decorated_pot$/, 50],
  [/^crimson_nylium$/, 52], [/^(crimson_hyphae|stripped_crimson_hyphae)$/, 54], [/^warped_nylium$/, 55], [/^(warped_hyphae|stripped_warped_hyphae)$/, 57], [/^warped_wart_block$/, 58],
  [/deepslate/, 59],
  [/^raw_iron_block$/, 60],
  [/^(glow_lichen|verdant_froglight)$/, 61],
  // the woods: planks, logs from above, everything made of them
  [/^(stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped|poplar)_(planks|log|wood|stem|block|sign|wall_sign|hanging_sign|wall_hanging_sign|pressure_plate|trapdoor|stairs|slab|fence_gate|fence|door)$/, m => WOOD[m[2]]],
  [/^(note_block|bookshelf|chiseled_bookshelf|chest|crafting_table|trapped_chest|daylight_detector|loom|barrel|cartography_table|fletching_table|lectern|smithing_table|composter|bamboo_sapling|dead_bush|petrified_oak_slab|beehive)$/, 13],
  [/^(diorite|polished_diorite|diorite_.*|polished_diorite_.*|quartz.*|smooth_quartz.*|chiseled_quartz_block|sea_lantern|target)$/, 14],
  [/^(dirt|coarse_dirt|farmland|dirt_path|granite|polished_granite|granite_.*|polished_granite_.*|jukebox|brown_mushroom_block|rooted_dirt|hanging_roots|packed_mud)$/, 10],
  [/^wheat$/, 7],
  [/(sapling|_tulip|poppy|dandelion|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|blue_orchid|wither_rose|sunflower|lilac|rose_bush|peony|torchflower|pitcher|sugar_cane|_stem$|lily_pad|cocoa|carrots|potatoes|beetroots|sweet_berry_bush|short_grass|tall_grass|^fern$|large_fern|^vine$|cactus|^bamboo$|cave_vines|spore_blossom|azalea|dripleaf|pink_petals|wildflowers|^bush$|firefly_bush|eyeblossom)/, 7],
];
// everything else (stone and its kin, ores, furnaces, gravel...) is stone's grey
const COLOUR = new Uint8Array(4096);
for (const k in BLOCKS) {
  const d = BLOCKS[k];
  if (!d || !d.name) continue;
  let c = 11;
  for (const [re, v] of RULES) { const m = re.exec(d.name); if (m) { c = typeof v === 'function' ? v(m) || 11 : v; break; } }
  COLOUR[d.id] = c;
}
COLOUR[0] = 0;
export const mapColourOf = b => COLOUR[b] || 0;

/* An explorer map's first look (the game's MapItem.renderBiomePreviewMap,
   laid when the map is made): the biome under each pixel's corner, wet where
   it is an ocean, river or swamp (the game's water_on_map_outlines). The
   game reads the biome at y 0, where cave biomes (lush caves above all)
   often stand under the sea and leave its map blank; this reads it at sea
   level.
   Open water is orange lines down every other column in wavy bands of
   shade, the water's edge solid orange, the land beside it a brown outline,
   the rest blank paper; the outer ring of pixels is left alone. Held, it
   then fills in as any map does over this.
   ids: a biome id per pixel, row by row (from the workers: fillPreview). */
const WET = /ocean|river|swamp/;
// the game's Mth.sin (a table of 65536 steps round the circle)
const mthSin = d => Math.fround(Math.sin((Math.trunc(d * 10430.378350470453) & 0xffff) * Math.PI * 2 / 65536));
export function previewBiomes(m, ids) {
  const wet = new Uint8Array(16384);
  for (let i = 0; i < 16384; i++) { const b = BIOMES[ids[i]]; wet[i] = b && WET.test(b.name) ? 1 : 0; }
  // (shades: 0 low, 1 normal, 2 high, 3 lowest, as SHADE above)
  for (let v = 1; v < 127; v++) for (let u = 1; u < 127; u++) {
    const i = v * 128 + u;
    let n = 0;
    for (let dv = -1; dv < 2; dv++) for (let du = -1; du < 2; du++) if ((du || dv) && wet[i + dv * 128 + du]) n++;
    let base = 0, shade = 3;
    if (wet[i]) {
      base = 15;
      if (n > 7 && u % 2 === 0) { const k = Math.trunc((v + Math.trunc(mthSin(u) * 7)) / 8) % 5; shade = k === 0 || k === 4 ? 0 : k === 1 || k === 3 ? 1 : k === 2 ? 2 : 3; }
      else if (n > 7) base = 0;
      else if (n > 5) shade = 1;
      else if (n > 1) shade = 0;
    } else if (n > 0) { base = 26; shade = n > 3 ? 1 : 3; }
    if (!base || m.colors[i]) continue;          // (what has been seen already stays)
    m.colors[i] = base * 4 + shade;
  }
  m.touched();
}
// ask the world's workers for the biomes under a map and lay its preview (a promise)
export function fillPreview(m, world) {
  if (!world || !world.ask) return Promise.resolve(false);
  const s = 1 << m.scale;
  return world.ask({ type: 'biomes', x0: m.cx - 64 * s, z0: m.cz - 64 * s, step: s, n: 128 }).then(r => {
    if (!r || !r.ids) return false;
    previewBiomes(m, r.ids);
    MAPS.dirty = true;
    return true;
  }, () => false);
}

/* ---- one map ---- */
export class MapData {
  constructor(id, scale, cx, cz, dim) {
    this.id = id; this.scale = scale; this.cx = cx; this.cz = cz; this.dim = dim || 'overworld';
    this.locked = false;
    this.marks = null;              // [{ x, z, type }]: places marked on it (an explorer map's target)
    this.unlimited = false;         // the game's unlimitedTracking (explorer maps): you stay on its rim however far off
    this.colors = new Uint8Array(128 * 128);
    this.step = 0; this.canvas = null; this.changed = true;
    this.ver = 0;                   // goes up with every change to the picture (a framed map's texture follows it)
  }
  touched() { this.changed = true; this.ver++; }
  /* What a stack carries of it (mapd), so a page that has never seen the map
     (another player's, on a server) can make it: where it is, its scale and
     dimension, its marks; the picture itself is each page's own. */
  head() {
    const o = { s: this.scale, x: this.cx, z: this.cz, d: this.dim };
    if (this.unlimited) o.u = 1;
    if (this.locked) o.l = 1;
    if (this.marks && this.marks.length) o.k = this.marks.map(k => [k.x, k.z, k.type]);
    return o;
  }
  // a picture of it (a canvas of 128 x 128), made again only when it changed
  image() {
    if (!this.canvas) { this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = 128; this.changed = true; }
    if (this.changed) {
      this.changed = false;
      const g = this.canvas.getContext('2d'), img = g.createImageData(128, 128), d = img.data;
      for (let i = 0; i < 16384; i++) {
        const c = this.colors[i];
        if (!c || c < 4) { d[i * 4 + 3] = 0; continue; }
        const rgb = MAP_RGB[c];
        d[i * 4] = rgb >> 16; d[i * 4 + 1] = (rgb >> 8) & 255; d[i * 4 + 2] = rgb & 255; d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    return this.canvas;
  }
  toJSON() {
    let s = '';
    for (let i = 0; i < this.colors.length; i += 8192) s += String.fromCharCode.apply(null, this.colors.subarray(i, i + 8192));
    const o = { s: this.scale, x: this.cx, z: this.cz, d: this.dim, l: this.locked ? 1 : 0, c: btoa(s) };
    if (this.marks && this.marks.length) o.k = this.marks.map(k => [k.x, k.z, k.type]);
    if (this.unlimited) o.u = 1;
    return o;
  }
  static fromJSON(id, o) {
    const m = new MapData(id, o.s | 0, o.x | 0, o.z | 0, typeof o.d === 'string' ? o.d : 'overworld');
    m.locked = !!o.l;
    if (Array.isArray(o.k)) m.marks = o.k.filter(Array.isArray).map(k => ({ x: k[0] | 0, z: k[1] | 0, type: String(k[2] || 'red_x') }));
    // (an explorer map saved before this was kept is known by its marks)
    m.unlimited = !!o.u || !!(m.marks && m.marks.length);
    if (o.c) try { const s = atob(o.c); for (let i = 0; i < s.length && i < 16384; i++) m.colors[i] = s.charCodeAt(i); } catch (e) { /* an empty map */ }
    return m;
  }
  // the same place, scale and dimension as a stack's head says
  sameAs(h) { return !!h && (h.s | 0) === this.scale && (h.x | 0) === this.cx && (h.z | 0) === this.cz && (h.d || 'overworld') === this.dim; }
}

/* ---- every map of the world ---- */
/* The maps are kept per world, in this browser (on a server too: maps.js has
   no server store). So that a map still works on a page that never made it
   (another player's from a chest, a frame or a trade; this browser's after
   its site data went), every map stack carries its head (mapd, MapData.head)
   and a page makes the map from it the first time it sees it (forStack),
   with an explorer map's biome preview; what it shows then fills in from
   that page's own travels. On a server new maps take a random number, as
   every page numbers its own; a number this page already uses for another
   map (two players' maps from before the heads) is kept apart by its head
   (alias). */
class Maps {
  constructor() { this.list = new Map(); this.alias = new Map(); this.next = 0; this.dirty = false; this.store = null; this.shared = false; }
  // the world's maps, from its save (main.js, when a world starts; on a server the store is net.js's MpSave)
  async open(store, fresh) {
    this.list.clear(); this.alias.clear(); this.next = 0; this.dirty = false; this.store = store;
    this.shared = !!(store && store.net);
    if (fresh || !store) return;
    try {
      const o = await store.readExtra('maps');
      if (!o) return;
      // (a map made while the save was still being read keeps its number)
      this.next = Math.max(this.next, o.next | 0);
      for (const k in o.maps || {}) if (!this.list.has(+k)) this.list.set(+k, MapData.fromJSON(+k, o.maps[k]));
      for (const k in o.a || {}) this.alias.set(k, MapData.fromJSON(+k.split('|')[0], o.a[k]));
    } catch (e) { /* none kept */ }
  }
  save() {
    if (!this.dirty || !this.store) return;
    this.dirty = false;
    const maps = {}, a = {};
    for (const [k, m] of this.list) maps[k] = m.toJSON();
    for (const [k, m] of this.alias) a[k] = m.toJSON();
    const o = { next: this.next, maps };
    if (this.alias.size) o.a = a;
    this.store.writeExtra('maps', o);
  }
  get(id) { return this.list.get(id) || null; }
  // a number for a new map: the next one, or on a server a random one no page is likely to have used
  newId() {
    if (!this.shared) return this.next++;
    let id;
    do id = 0x100000 + Math.floor(Math.random() * 0x7fe00000); while (this.list.has(id));
    return id;
  }
  // a stack shows this map from now on: its number and its head
  tag(st, m) { st.map = m.id; st.mapd = m.head(); return st; }
  /* The map a stack shows: this page's own by its number, else made from the
     head the stack carries (another page's map), an explorer map with its
     preview when a world is given. null for a stack that is no map, or an
     old one this page never had. */
  forStack(st, world) {
    if (!st || st.map === undefined) return null;
    const h = st.mapd && typeof st.mapd === 'object' ? st.mapd : null;
    let m = this.get(st.map);
    if (m && (!h || m.sameAs(h))) return m;
    if (!h) return m;
    // this page has another map by that number: the stack's is kept beside it
    const key = st.map + '|' + (h.x | 0) + '|' + (h.z | 0) + '|' + (h.s | 0) + '|' + (h.d || 'overworld');
    if (m) { const a = this.alias.get(key); if (a) return a; }
    const n = MapData.fromJSON(st.map, h);
    n.wantPreview = !!(n.marks && n.marks.length);
    if (m) this.alias.set(key, n);
    else { this.list.set(n.id, n); if (!this.shared && n.id >= this.next) this.next = n.id + 1; }
    this.dirty = true;
    if (world) this.preview(n, world);
    return n;
  }
  // a map made from a stack's head gets its explorer preview once a world can be asked
  preview(m, world) {
    if (!m.wantPreview || !world || !world.ask || m.dim !== (world.dim || 'overworld')) return;
    m.wantPreview = false;
    fillPreview(m, world);
  }
  // a new map of the grid square round (x, z) at this scale
  create(x, z, scale = 0, dim = 'overworld') {
    const size = 128 << scale;
    const cx = Math.floor((x + 64) / size) * size + size / 2 - 64, cz = Math.floor((z + 64) / size) * size + size / 2 - 64;
    const m = new MapData(this.newId(), scale, cx, cz, dim);
    this.list.set(m.id, m);
    this.dirty = true;
    return m;
  }
  // a copy that no longer changes (the cartography table's lock); o: a map or its number
  lockedCopy(o) {
    if (typeof o !== 'object') o = this.get(o);
    if (!o) return null;
    const m = new MapData(this.newId(), o.scale, o.cx, o.cz, o.dim);
    m.colors.set(o.colors); m.locked = true; m.unlimited = o.unlimited;
    if (o.marks) m.marks = o.marks.map(k => Object.assign({}, k));
    this.list.set(m.id, m);
    this.dirty = true;
    return m;
  }
  /* zoomed out: a new, empty map one scale up, over the grid square holding the old one's centre (as the game's
     MapItemSavedData.scaled, an explorer map's tracking and its marks go with it: the game keeps them on the stack) */
  zoomed(o) {
    if (typeof o !== 'object') o = this.get(o);
    if (!o || o.scale >= 4 || o.locked) return null;
    const m = this.create(o.cx, o.cz, o.scale + 1, o.dim);
    m.unlimited = o.unlimited;
    if (o.marks) m.marks = o.marks.map(k => Object.assign({}, k));
    return m;
  }

  /* ---- filling in: a sixteenth of the columns within reach, each tick it is held ---- */
  // m: the map (forStack) or its number
  update(m, world, player) {
    if (typeof m !== 'object') m = this.get(m);
    if (m && m.wantPreview) this.preview(m, world);
    if (!m || m.locked || m.dim !== (world.dim || 'overworld')) return;
    const s = 1 << m.scale, px = Math.floor((player.pos.x - m.cx) / s) + 64, pz = Math.floor((player.pos.z - m.cz) / s) + 64;
    let r = 128 / s;
    const nether = world.dim === 'the_nether';
    if (nether) r /= 2;
    m.step++;
    const lane = m.step & 15;
    let changed = false;
    for (let u = Math.max(0, px - r + 1); u < Math.min(128, px + r); u++) {
      if ((u & 15) !== lane) continue;
      let prevH = -1;
      for (let v = pz - r - 1; v < pz + r; v++) {
        if (v < -1 || v >= 128) continue;
        const inside = (u - px) ** 2 + (v - pz) ** 2 <= (r - 2) * (r - 2);
        const wx = m.cx + (u - 64) * s, wz = m.cz + (v - 64) * s;
        const px2 = this.sample(world, wx, wz, s, nether, u, v);
        if (!px2) { prevH = -1; continue; }
        const [base, h, depth] = px2;
        if (v >= 0 && inside) {
          let shade;
          if (base === 12) {
            // water: by its depth, a checkerboard between the bands
            const d = depth * 0.1 + ((u + v) & 1) * 0.2;
            shade = d < 0.5 ? 2 : d > 0.9 ? 0 : 1;
          } else {
            const d = prevH < 0 ? 0 : (h - prevH) * 4 / (s + 4) + (((u + v) & 1) - 0.5) * 0.4;
            shade = d > 0.6 ? 2 : d < -0.6 ? 0 : 1;
          }
          const c = base * 4 + shade, i = v * 128 + u;
          if (m.colors[i] !== c) { m.colors[i] = c; changed = true; }
        }
        prevH = h;
      }
    }
    if (changed) { m.touched(); this.dirty = true; }
  }
  /* What a pixel shows: [base colour, height, water depth] from the blocks it
     covers (at most 16 of them looked at), or null where nothing is loaded. */
  sample(world, wx, wz, s, nether, u, v) {
    if (nether) {
      // the Nether's roof hides everything: a pattern of red and grey
      let k = (wx + wz * 231871) | 0;
      k = (Math.imul(Math.imul(k, k), 31287121) + Math.imul(k, 11)) | 0;
      return [(k >> 20) & 1 ? 11 : 10, 100, 0];
    }
    if (s === 1) return this.column(world, wx, wz);
    const step = Math.max(1, s >> 2), counts = this._counts || (this._counts = new Map());
    counts.clear();
    let hs = 0, n = 0, depth = 0;
    for (let dz = 0; dz < s; dz += step) for (let dx = 0; dx < s; dx += step) {
      const x = wx + dx, z = wz + dz, c = world.chunkAt(x, z);
      if (!c) continue;
      const lx = x - c.cx * 16, lz = z - c.cz * 16, col = (lz << 4) | lx;
      let y = Math.min(H - 1, (c.top !== undefined ? c.top : H - 1) + 1), b = 0, base = 0;
      for (; y > 0; y--) { b = c.blocks[(y << 8) | col]; if (b && (base = COLOUR[b])) break; }
      if (!base) continue;
      let d = 0;
      if (base === 12) { let yy = y - 1; while (yy > 0 && d < 16 && FLUID[c.blocks[(yy << 8) | col]] === 1) { d++; yy--; } }
      counts.set(base, (counts.get(base) || 0) + 1);
      hs += y; n++; depth += d;
    }
    if (!n) return null;
    let best = 0, bn = -1;
    for (const [k, c] of counts) if (c > bn) { bn = c; best = k; }
    return [best, hs / n, depth / n];
  }
  // one column (a map at scale 0): its top block that shows, its height, water's depth
  column(world, x, z) {
    const c = world.chunkAt(x, z);
    if (!c) return null;
    const col = ((z - c.cz * 16) << 4) | (x - c.cx * 16), bl = c.blocks;
    let y = Math.min(H - 1, (c.top !== undefined ? c.top : H - 1) + 1), base = 0;
    for (; y > 0; y--) { const b = bl[(y << 8) | col]; if (b && (base = COLOUR[b])) break; }
    if (!base) return null;
    let d = 0;
    if (base === 12) { let yy = y - 1; while (yy > 0 && d < 16 && FLUID[bl[(yy << 8) | col]] === 1) { d++; yy--; } }
    const out = this._px || (this._px = [0, 0, 0]);
    out[0] = base; out[1] = y; out[2] = d;
    return out;
  }
}
export const MAPS = new Maps();

/* ---- drawing a map: its picture, and you on it ---- */
export function drawMap(ctx, m, x, y, size, player) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(m.image(), 0, 0, 128, 128, x, y, size, size);
  if (m.marks) drawMarks(ctx, m, x, y, size);
  if (!player || m.dim !== player.dim) return;
  const s = 1 << m.scale, k = size / 128;
  let mx = (player.pos.x - m.cx) / s + 64, mz = (player.pos.z - m.cz) / s + 64;
  const off = mx < 0 || mz < 0 || mx >= 128 || mz >= 128;
  if (off) {
    /* past the edge, a dot on the rim (the game's player_off_map) while you are within 320 of its pixels of the
       middle; further off, an explorer map (unlimitedTracking) keeps a smaller dot there (player_off_limits) and
       any other map shows nothing */
    const far = !(Math.abs(mx - 64) < 320 && Math.abs(mz - 64) < 320);
    if (far && !m.unlimited) return;
    mx = Math.max(0, Math.min(127, mx)); mz = Math.max(0, Math.min(127, mz));
    const d = far ? 2 : 3;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + mx * k - d / 2 * k, y + mz * k - d / 2 * k, d * k, d * k);
    return;
  }
  // a pointer facing your way (north is up)
  ctx.save();
  ctx.translate(x + mx * k, y + mz * k);
  ctx.rotate(-player.yaw);
  ctx.scale(k, k);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 3.5); ctx.lineTo(0, 1.5); ctx.lineTo(-3, 3.5); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
/* The places marked on a map (our own drawings): a red X for buried treasure,
   a small coloured diamond outlined in black for any other structure. */
const MARK_COLOUR = { monument: '#3aa5a5', mansion: '#6b4a2a', ancient_city: '#2b3a4a', trial_chambers: '#c46b2a', mineshaft: '#7a6a5a',
  desert_pyramid: '#d8c27a', jungle_temple: '#4f7a3a', ocean_ruin_warm: '#d8c9a0', ocean_ruin_cold: '#7a8a8a', swamp_hut: '#4a5a3a', abandoned_camp: '#a84a3a',
  village_plains: '#c89a5a', village_savanna: '#c8783a', village_taiga: '#7a5a3a', village_desert: '#e0c890', village_snowy: '#e8f0f8' };
function drawMarks(ctx, m, x, y, size) {
  const s = 1 << m.scale, k = size / 128;
  for (const mk of m.marks) {
    const u = (mk.x - m.cx) / s + 64, v = (mk.z - m.cz) / s + 64;
    if (u < 0 || v < 0 || u >= 128 || v >= 128) continue;
    const px = x + u * k, py = y + v * k, r = 3 * k;
    ctx.save();
    ctx.lineCap = 'square';
    if (mk.type === 'red_x') {
      for (const [w, c] of [[2.4 * k, '#000000'], [1.2 * k, '#c81e1e']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r); ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r); ctx.stroke();
      }
    } else {
      ctx.fillStyle = MARK_COLOUR[mk.type] || '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 0.8 * k;
      ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}
// the paper a held map is drawn on (our own colours)
export function drawPaper(ctx, x, y, size) {
  ctx.fillStyle = '#5b4a33'; ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#e3d6b0'; ctx.fillRect(x + size * 0.02, y + size * 0.02, size * 0.96, size * 0.96);
  ctx.fillStyle = '#d6c79c'; ctx.fillRect(x + size * 0.035, y + size * 0.035, size * 0.93, size * 0.93);
}

/* ---- maps in the hands ---- */
export const isFilledMap = s => !!s && s.map !== undefined && !!ITEMS[s.id] && ITEMS[s.id].name === 'filled_map';
/* Drawn under the hotbar (ui/hud.js): in the main hand with the other hand
   free, a big map held up in front, higher and larger the more you look
   down; otherwise a small one at that hand's side. Returns when the HUD
   should draw again (sooner while you are turning). */
export function drawHeldMaps(g, now, inv, player, world) {
  const main = inv.slots[inv.selected], off = inv.offhand, ctx = g.ctx;
  if (!isFilledMap(main) && !isFilledMap(off)) return 0;
  const W = g.width, H2 = g.height, left = g.options && g.options.get('mainHand') === 'left';
  const who = { pos: player.pos, yaw: player.yaw, dim: world.dim || 'overworld' };
  const one = (st, x, y, size) => {
    const m = MAPS.forStack(st, world);
    drawPaper(ctx, x, y, size);
    if (m) drawMap(ctx, m, x + size * 0.06, y + size * 0.06, size * 0.88, who);
  };
  if (isFilledMap(main) && !off) {
    /* raised as the game's ItemInHandRenderer.calculateMapTilt has it: low while you look ahead, all the way up
       (whole, over the hotbar) once you look 49.5 degrees down or more */
    const g0 = Math.max(0, Math.min(1, 1 + player.pitch * 180 / Math.PI / 45 + 0.1));
    const t = 1 - (-Math.cos(g0 * Math.PI) * 0.5 + 0.5);
    const size = Math.floor(Math.min(W, H2) * (0.62 + 0.18 * t));
    one(main, Math.floor((W - size) / 2), Math.floor(H2 - size * (0.62 + 0.38 * t) - 8 - 22 * t), size);
  } else {
    const size = Math.floor(Math.min(W, H2) * 0.3);
    const side = (st, right) => one(st, right ? W - size - 30 : 30, H2 - size - 30, size);
    if (isFilledMap(main)) side(main, !left);
    if (isFilledMap(off)) side(off, left);
  }
  // turning moves it: draw again next frame; otherwise a few times a second, as it fills in
  const turned = player.pitch !== drawHeldMaps.pitch || player.yaw !== drawHeldMaps.yaw || player.pos.x !== drawHeldMaps.x || player.pos.z !== drawHeldMaps.z;
  drawHeldMaps.pitch = player.pitch; drawHeldMaps.yaw = player.yaw; drawHeldMaps.x = player.pos.x; drawHeldMaps.z = player.pos.z;
  return now + (turned ? 0 : 100);
}
// a filled map's tooltip lines (the zoom only with advanced tooltips, as in the game)
export function mapLines(st, advanced) {
  const m = MAPS.forStack(st), out = [];
  if (m && m.locked) out.push('§7Locked');
  if (advanced) {
    out.push('§7Id #' + st.map);
    if (m) out.push('§7Scale 1:' + (1 << m.scale), '§7(Level ' + m.scale + '/4)');
  }
  return out;
}
/* A framed map's picture (details.js): the map and its marks, no paper and
   nobody's pointer, as the game draws a map in an item frame; drawn into the
   canvas given (256 x 256), again when the map's ver has moved on. */
export function framePicture(m, cv) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  drawMap(g, m, 0, 0, cv.width, null);
  return cv;
}
