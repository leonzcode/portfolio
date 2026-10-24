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
import { BLOCKS, B, FLUID } from './blocks.js?v=107';
import { H } from './world-const.js?v=107';
import { ITEMS } from './items.js?v=107';
import { BIOMES } from './biomes.js?v=107';

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

/* An explorer map's first look (the game's biome preview, filled in when the
   map is made): the water of its area (oceans, rivers and swamps, the game's
   water_on_map_outlines) in orange stripes, the coast outlined in brown, the
   land left blank paper. Held, it then fills in as any map does over this.
   ids: a biome id per pixel, row by row (from the workers: fillPreview). */
const WET = /ocean|river|swamp/;
export function previewBiomes(m, ids) {
  const wet = new Uint8Array(16384);
  for (let i = 0; i < 16384; i++) { const b = BIOMES[ids[i]]; wet[i] = b && WET.test(b.name) ? 1 : 0; }
  for (let v = 0; v < 128; v++) for (let u = 0; u < 128; u++) {
    const i = v * 128 + u;
    if (m.colors[i]) continue;                  // what has been seen already stays
    if (wet[i]) { m.colors[i] = 15 * 4 + (((u + v) >> 1) & 1); continue; }
    const coast = (u > 0 && wet[i - 1]) || (u < 127 && wet[i + 1]) || (v > 0 && wet[i - 128]) || (v < 127 && wet[i + 128]);
    if (coast) m.colors[i] = 26 * 4 + 1;
  }
  m.changed = true;
}
// ask the world's workers for the biomes under a map and lay its preview (a promise)
export function fillPreview(m, world) {
  if (!world || !world.ask) return Promise.resolve(false);
  const s = 1 << m.scale;
  return world.ask({ type: 'biomes', x0: m.cx - 64 * s + (s >> 1), z0: m.cz - 64 * s + (s >> 1), step: s, n: 128 }).then(r => {
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
    this.colors = new Uint8Array(128 * 128);
    this.step = 0; this.canvas = null; this.changed = true;
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
    return o;
  }
  static fromJSON(id, o) {
    const m = new MapData(id, o.s | 0, o.x | 0, o.z | 0, o.d);
    m.locked = !!o.l;
    if (Array.isArray(o.k)) m.marks = o.k.map(k => ({ x: k[0] | 0, z: k[1] | 0, type: String(k[2] || 'red_x') }));
    try { const s = atob(o.c || ''); for (let i = 0; i < s.length && i < 16384; i++) m.colors[i] = s.charCodeAt(i); } catch (e) { /* an empty map */ }
    return m;
  }
}

/* ---- every map of the world ---- */
class Maps {
  constructor() { this.list = new Map(); this.next = 0; this.dirty = false; this.store = null; }
  // the world's maps, from its save (main.js, when a world starts)
  async open(store, fresh) {
    this.list.clear(); this.next = 0; this.dirty = false; this.store = store;
    if (fresh || !store) return;
    try {
      const o = await store.readExtra('maps');
      if (!o) return;
      this.next = o.next | 0;
      for (const k in o.maps || {}) this.list.set(+k, MapData.fromJSON(+k, o.maps[k]));
    } catch (e) { /* none kept */ }
  }
  save() {
    if (!this.dirty || !this.store) return;
    this.dirty = false;
    const maps = {};
    for (const [k, m] of this.list) maps[k] = m.toJSON();
    this.store.writeExtra('maps', { next: this.next, maps });
  }
  get(id) { return this.list.get(id) || null; }
  // a new map of the grid square round (x, z) at this scale
  create(x, z, scale = 0, dim = 'overworld') {
    const size = 128 << scale;
    const cx = Math.floor((x + 64) / size) * size + size / 2 - 64, cz = Math.floor((z + 64) / size) * size + size / 2 - 64;
    const m = new MapData(this.next++, scale, cx, cz, dim);
    this.list.set(m.id, m);
    this.dirty = true;
    return m;
  }
  // a copy that no longer changes (the cartography table's lock)
  lockedCopy(id) {
    const o = this.get(id);
    if (!o) return null;
    const m = new MapData(this.next++, o.scale, o.cx, o.cz, o.dim);
    m.colors.set(o.colors); m.locked = true;
    if (o.marks) m.marks = o.marks.map(k => Object.assign({}, k));
    this.list.set(m.id, m);
    this.dirty = true;
    return m;
  }
  // zoomed out: a new, empty map one scale up, over the grid square holding the old one's centre
  zoomed(id) {
    const o = this.get(id);
    if (!o || o.scale >= 4 || o.locked) return null;
    return this.create(o.cx, o.cz, o.scale + 1, o.dim);
  }

  /* ---- filling in: a sixteenth of the columns within reach, each tick it is held ---- */
  update(id, world, player) {
    const m = this.get(id);
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
    if (changed) { m.changed = true; this.dirty = true; }
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
    // past the edge: a dot on the rim, until you are too far off
    if (Math.max(-mx, -mz, mx - 128, mz - 128) * s > (256 << m.scale)) return;
    mx = Math.max(0, Math.min(127, mx)); mz = Math.max(0, Math.min(127, mz));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + mx * k - 1.5 * k, y + mz * k - 1.5 * k, 3 * k, 3 * k);
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
    const m = MAPS.get(st.map);
    drawPaper(ctx, x, y, size);
    if (m) drawMap(ctx, m, x + size * 0.06, y + size * 0.06, size * 0.88, who);
  };
  if (isFilledMap(main) && !off) {
    const t = Math.max(0, Math.min(1, -player.pitch / (Math.PI / 2)));
    const size = Math.floor(Math.min(W, H2) * (0.62 + 0.18 * t));
    one(main, Math.floor((W - size) / 2), Math.floor(H2 - size * (0.62 + 0.4 * t) - 8), size);
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
  const m = MAPS.get(st.map), out = [];
  if (m && m.locked) out.push('§7Locked');
  if (advanced) {
    out.push('§7Id #' + st.map);
    if (m) out.push('§7Scale 1:' + (1 << m.scale), '§7(Level ' + m.scale + '/4)');
  }
  return out;
}
