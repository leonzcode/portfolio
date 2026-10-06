/* ---------------------------------------------------------------------------
   Leoncraft 2 - the items.

   Every item of the game, by id and by name. A block that is also an item
   keeps its block id as its item id (stone is B.stone everywhere), and an
   item placed as a block of another name points at that block (redstone ->
   redstone_wire, wheat_seeds -> wheat, water_bucket -> water). Everything
   else (sticks, diamonds, tools, food...) gets an id from ITEM_BASE up, past
   every block id, so a stack { id, count } needs nothing more to say what it
   holds. Saves use names, never ids.

     ITEMS[id]   { id, name, display, stack, dur, block, tool, food, armor, fuel, tab... }
     I[name]     id
     DRAW[id]    what the icons and the hand draw: the block, or the item's flat picture
     items       { byName(n), byId(id), get(nameOrId) }

   Tool, armour, food and fuel numbers are the Minecraft Wiki's (Java Edition,
   October 2026); the list itself is minecraft-data's (js/itemdata.js).
--------------------------------------------------------------------------- */
import { B, BLOCKS, MAX_ID } from './blocks.js?v=16';
import { ITEM_LIST, ITEM_TEX, FOODS } from './itemdata.js?v=16';

export const ITEM_BASE = MAX_ID;          // 4096: the first id that is not a block
export const ITEMS = [];
export const I = {};
export const DRAW = BLOCKS.slice();

/* ---- tools: speed against the blocks they are for, harvest tier, attack ---- */
export const TIERS = {
  wooden: { speed: 2, tier: 0, ench: 15 }, stone: { speed: 4, tier: 1, ench: 5 }, copper: { speed: 5, tier: 1, ench: 13 },
  iron: { speed: 6, tier: 2, ench: 14 }, diamond: { speed: 8, tier: 3, ench: 10 }, golden: { speed: 12, tier: 0, ench: 22 },
  netherite: { speed: 9, tier: 4, ench: 15 },
};
// attack damage (total, as the tooltip shows it) and attacks a second, per tier
const ATTACK = {
  sword: { wooden: [4, 1.6], golden: [4, 1.6], stone: [5, 1.6], copper: [5, 1.6], iron: [6, 1.6], diamond: [7, 1.6], netherite: [8, 1.6] },
  axe: { wooden: [7, 0.8], golden: [7, 1], stone: [9, 0.8], copper: [9, 0.8], iron: [9, 0.9], diamond: [9, 1], netherite: [10, 1] },
  pickaxe: { wooden: [2, 1.2], golden: [2, 1.2], stone: [3, 1.2], copper: [3, 1.2], iron: [4, 1.2], diamond: [5, 1.2], netherite: [6, 1.2] },
  shovel: { wooden: [2.5, 1], golden: [2.5, 1], stone: [3.5, 1], copper: [3.5, 1], iron: [4.5, 1], diamond: [5.5, 1], netherite: [6.5, 1] },
  hoe: { wooden: [1, 1], golden: [1, 1], stone: [1, 2], copper: [1, 2], iron: [1, 3], diamond: [1, 4], netherite: [1, 4] },
  spear: { wooden: [1, 1.54], golden: [1, 1.05], stone: [2, 1.33], copper: [2, 1.18], iron: [3.5, 1.05], diamond: [4, 0.95], netherite: [5, 0.87] },
};
/* ---- armour: points per piece (head, chest, legs, feet), toughness, knockback resistance ---- */
const ARMOR = {
  leather: [[1, 3, 2, 1], 0, 0], chainmail: [[2, 5, 4, 1], 0, 0], iron: [[2, 6, 5, 2], 0, 0], copper: [[2, 4, 3, 1], 0, 0],
  golden: [[2, 5, 3, 1], 0, 0], diamond: [[3, 8, 6, 3], 2, 0], netherite: [[3, 8, 6, 3], 3, 0.1],
};
const PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

/* ---- fuel: ticks a furnace burns for each (the wiki's Smelting page, its Fuel
   table, Java Edition; anything not in that table is not a fuel) ---- */
const FUEL_NAMED = {
  lava_bucket: 20000, coal_block: 16000, dried_kelp_block: 4000, blaze_rod: 2400, coal: 1600, charcoal: 1600,
  bamboo_raft: 1200, bamboo_chest_raft: 1200, bookshelf: 300, chiseled_bookshelf: 300, lectern: 300, jukebox: 300,
  note_block: 300, chest: 300, trapped_chest: 300, crafting_table: 300, cartography_table: 300, fletching_table: 300,
  smithing_table: 300, loom: 300, barrel: 300, composter: 300, daylight_detector: 300,
  ladder: 300, bow: 300, crossbow: 300, fishing_rod: 300, mangrove_roots: 300, bamboo_mosaic: 300, bamboo_mosaic_stairs: 300,
  bamboo_block: 300, stripped_bamboo_block: 300, bamboo_mosaic_slab: 150, bowl: 100, stick: 100, bamboo: 50, scaffolding: 50,
  azalea: 100, flowering_azalea: 100, dead_bush: 100, short_dry_grass: 100, tall_dry_grass: 100, leaf_litter: 100,
  wooden_sword: 200, wooden_pickaxe: 200, wooden_shovel: 200, wooden_axe: 200, wooden_hoe: 200, wooden_spear: 200,
};
const WOODS = 'oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped|poplar';
const WOOD_RE = new RegExp('^(' + WOODS + ')_');
function fuelOf(n) {
  if (FUEL_NAMED[n] !== undefined) return FUEL_NAMED[n];
  const nether = /^(crimson|warped)_/.test(n);          // nether wood does not burn
  if (nether) return 0;
  if (/_(log|wood)$/.test(n)) return 300;               // stripped too (stems and hyphae are the Nether's, and a mushroom stem is no log)
  if (WOOD_RE.test(n)) {
    if (/_planks$|_stairs$|_fence$|_fence_gate$|_trapdoor$|_pressure_plate$|_shelf$/.test(n)) return 300;
    if (/_slab$/.test(n)) return 150;
    if (/_door$|_sign$/.test(n)) return 200;            // hanging signs too
    if (/_button$/.test(n)) return 100;
    if (/_boat$|_chest_boat$/.test(n)) return 1200;
  }
  if (/_sapling$|^mangrove_propagule$/.test(n)) return 100;
  if (/_wool$|_wool_stairs$/.test(n)) return 100;
  if (/_carpet$/.test(n)) return 67;
  if (/_wool_slab$|_cushion$/.test(n)) return 50;
  if (/_banner$/.test(n)) return 300;
  return 0;
}

/* ---- food: hunger and saturation from the data; the rest from the wiki ---- */
// ticks to eat (32 unless listed) and what is left in your hand after
const EAT_TICKS = { dried_kelp: 16, honey_bottle: 40 };
const LEAVES = { mushroom_stew: 'bowl', rabbit_stew: 'bowl', beetroot_soup: 'bowl', suspicious_stew: 'bowl', honey_bottle: 'glass_bottle', milk_bucket: 'bucket', potion: 'glass_bottle' };
// eaten even with a full hunger bar
const ALWAYS = new Set(['golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'honey_bottle', 'milk_bucket', 'potion', 'suspicious_stew']);
/* effects: [effect, level (1 = I), seconds, chance] */
export const FOOD_EFFECTS = {
  golden_apple: [['regeneration', 2, 5, 1], ['absorption', 1, 120, 1]],
  enchanted_golden_apple: [['regeneration', 2, 20, 1], ['absorption', 4, 120, 1], ['resistance', 1, 300, 1], ['fire_resistance', 1, 300, 1]],
  rotten_flesh: [['hunger', 1, 30, 0.8]],
  chicken: [['hunger', 1, 30, 0.3]],
  pufferfish: [['hunger', 3, 15, 1], ['nausea', 1, 15, 1], ['poison', 2, 60, 1]],
  spider_eye: [['poison', 1, 5, 1]],
  poisonous_potato: [['poison', 1, 5, 0.6]],
};

// the creative tab a block-less item goes in (blocks keep their own)
function makeItem(e, id, block) {
  const n = e.n;
  const it = { id, name: n, display: e.d, stack: e.s, block: block || 0, tab: e.tab, ench: e.ench || null, repair: e.rep || null };
  if (e.dur) it.dur = e.dur;
  // tools
  let m = /^(wooden|golden|stone|copper|iron|diamond|netherite)_(pickaxe|axe|shovel|hoe|sword|spear)$/.exec(n);
  if (m) {
    const t = TIERS[m[1]];
    it.tool = { kind: m[2], material: m[1], speed: t.speed, tier: t.tier, enchantability: t.ench };
    const a = ATTACK[m[2]] && ATTACK[m[2]][m[1]];
    if (a) { it.attack = a[0]; it.attackSpeed = a[1]; }
  } else if (n === 'shears') it.tool = { kind: 'shears', speed: 1, tier: 0 };
  else if (n === 'mace') { it.attack = 6; it.attackSpeed = 0.6; }
  else if (n === 'trident') { it.attack = 9; it.attackSpeed = 1.1; }
  // armour
  m = /^(leather|chainmail|iron|copper|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.exec(n);
  if (m) {
    const a = ARMOR[m[1]], slot = PIECES.indexOf(m[2]);
    it.armor = { slot, points: a[0][slot], toughness: a[1], knockback: a[2], material: m[1] };
  } else if (n === 'turtle_helmet') it.armor = { slot: 0, points: 2, toughness: 0, knockback: 0, material: 'turtle' };
  else if (n === 'carved_pumpkin' || /_(head|skull)$/.test(n)) it.armor = { slot: 0, points: 0, toughness: 0, knockback: 0, material: 'none' };
  else if (n === 'elytra') it.armor = { slot: 1, points: 0, toughness: 0, knockback: 0, material: 'none' };
  // food
  const f = FOODS[n];
  if (f) it.food = { hunger: f[0], saturation: f[1], ticks: EAT_TICKS[n] || 32, always: ALWAYS.has(n), effects: FOOD_EFFECTS[n] || null, leaves: LEAVES[n] || null };
  else if (n === 'milk_bucket' || n === 'potion' || n === 'honey_bottle') it.food = { hunger: 0, saturation: 0, ticks: EAT_TICKS[n] || 32, always: true, drink: true, effects: null, leaves: LEAVES[n] };
  if (it.food && (n === 'milk_bucket' || n === 'potion' || n === 'honey_bottle' || n === 'ominous_bottle')) it.food.drink = true;
  const fuel = fuelOf(n);
  if (fuel) it.fuel = fuel;
  return it;
}

let nextItem = ITEM_BASE;
const texIndex = new Map(ITEM_TEX.map((n, i) => [n, i]));
const placedBy = new Map();
for (const d of BLOCKS) if (d && d.itemOf && !placedBy.has(d.itemOf)) placedBy.set(d.itemOf, d.id);
for (const e of ITEM_LIST) {
  // a block of this name that is its own item, or a block placed by an item of this name
  let block = 0;
  const own = B[e.n];
  if (own !== undefined && BLOCKS[own].item !== false && !BLOCKS[own].itemOf) block = own;
  if (!block && placedBy.has(e.n)) block = placedBy.get(e.n);
  if (block) {
    const it = makeItem(e, block, block);
    // the block's own name on screen and stack (water_bucket shows as the block "Water Bucket")
    ITEMS[block] = it;
    I[e.n] = block;
    continue;
  }
  const id = nextItem++;
  const it = makeItem(e, id, 0);
  it.texIndex = texIndex.has(e.n) ? texIndex.get(e.n) : -1;
  // drawn like a flat block item: a picture, never a cube (its layer is set when the texture lands)
  it.shape = 'item'; it.pass = 'cutout'; it.tint = null; it.light = 0;
  ITEMS[id] = it;
  I[e.n] = id;
  DRAW[id] = it;
}
// every block with an item that the data does not list (new blocks): an item of its own
for (const d of BLOCKS) {
  if (!d || !d.id || ITEMS[d.id] || d.item === false || d.lower) continue;
  const it = makeItem({ n: d.name, d: d.display, s: d.stack || 64 }, d.id, d.id);
  ITEMS[d.id] = it;
  if (I[d.name] === undefined) I[d.name] = d.id;
}
export const ITEM_COUNT = nextItem - ITEM_BASE;
// the bucket items of the fluids keep their item names as aliases
for (const [alias, name] of [['water', 'water_bucket'], ['lava', 'lava_bucket']]) if (I[name] === undefined && B[alias] !== undefined) I[name] = B[alias];

/* Once the item pictures are in the texture array (layers from first on, in
   ITEM_TEX order): give each item its layer, for the icons and the hand. */
let texFirst = -1;
export function setItemLayers(first) {
  texFirst = first;
  for (const it of ITEMS) {
    if (!it || it.block || it.texIndex === undefined || it.texIndex < 0) continue;
    const L = first + it.texIndex;
    it.iconLayer = L;
    it.faces = [L, L, L, L, L, L];
    it.icon = 'item_' + it.name;
  }
}

// the texture layer of a picture in the item strip by name ('xp_orb_3'), or -1 before the textures land
export function textureLayer(name) { const i = texIndex.get(name); return texFirst < 0 || i === undefined ? -1 : texFirst + i; }

/* ---- reading ---- */
export const itemOf = id => ITEMS[id] || null;
export function itemName(id) { const it = ITEMS[id]; return it ? it.name : (BLOCKS[id] ? BLOCKS[id].name : ''); }
export function itemId(name) { const id = I[name]; return id === undefined ? 0 : id; }
export function displayName(id) {
  const it = ITEMS[id];
  if (it && !it.block) return it.display;
  const d = BLOCKS[id];
  if (!d) return it ? it.display : '';
  return d.display || d.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
export function maxStack(id) { const it = ITEMS[id]; if (it) return it.stack; const d = BLOCKS[id]; return d && d.stack ? d.stack : 64; }
export function maxDamage(id) { const it = ITEMS[id]; return it && it.dur ? it.dur : 0; }
// the block an item places (0 for none)
export function blockOf(id) { const it = ITEMS[id]; if (it) return it.block; return BLOCKS[id] && id < ITEM_BASE ? id : 0; }
export function toolOf(id) { const it = ITEMS[id]; return it && it.tool ? it.tool : null; }
export function foodOf(id) { const it = ITEMS[id]; return it && it.food ? it.food : null; }
export function armorOf(id) { const it = ITEMS[id]; return it && it.armor ? it.armor : null; }
export function fuelTicks(id) { const it = ITEMS[id]; return it && it.fuel ? it.fuel : 0; }

/* ---- stacks: { id, count, dmg?, ench?, rep?, name?, trim?, potion?, ... } ----
   dmg: wear; ench: enchantments (stored ones on an enchanted book);
   rep: the anvil's prior work cost; name: given on an anvil; trim: [pattern, material];
   and what a few items carry (EXTRA): items, a shulker box's 27 slots (or a
   bundle's); color, dyed leather; flight and explosions, a firework rocket;
   firework, a firework star; sherds, a decorated pot's four sides; pages, title
   and author, a book and quill's or a written book's words */
const EXTRA = ['items', 'color', 'flight', 'explosions', 'firework', 'sherds', 'charged', 'pages', 'title', 'author'];
const hasExtra = s => { for (const k of EXTRA) if (s[k] !== undefined) return true; return false; };
// two stacks that can go on one another (same item, same wear, enchantments, name, contents)
export function sameItem(a, b) {
  if (!a || !b || a.id !== b.id) return false;
  if ((a.dmg | 0) !== (b.dmg | 0) || (a.rep | 0) !== (b.rep | 0) || (a.name || '') !== (b.name || '')) return false;
  if ((a.trim ? a.trim.join() : '') !== (b.trim ? b.trim.join() : '') || (a.potion || '') !== (b.potion || '')) return false;
  if ((hasExtra(a) || hasExtra(b)) && extraKey(a) !== extraKey(b)) return false;
  return enchKey(a) === enchKey(b);
}
function enchKey(s) { if (!s.ench) return ''; let k = ''; for (const n in s.ench) k += n + s.ench[n] + ','; return k; }
function extraKey(s) {
  let k = '';
  for (const n of EXTRA) if (s[n] !== undefined) k += n + ':' + (n === 'items' ? JSON.stringify(s.items.map(stackToJSON)) : JSON.stringify(s[n])) + ';';
  return k;
}
// a copy of a stack with another count, keeping its wear, enchantments and contents
export function withCount(s, count) {
  if (!s) return null;
  const o = { id: s.id, count };
  if (s.dmg) o.dmg = s.dmg;
  if (s.ench) o.ench = Object.assign({}, s.ench);
  if (s.rep) o.rep = s.rep;
  if (s.name) o.name = s.name;
  if (s.trim) o.trim = s.trim.slice();
  if (s.potion) o.potion = s.potion;
  if (s.items) o.items = s.items.map(x => (x ? withCount(x, x.count) : null));
  for (const k of EXTRA) if (k !== 'items' && s[k] !== undefined) o[k] = typeof s[k] === 'object' ? JSON.parse(JSON.stringify(s[k])) : s[k];
  return o;
}
export function enchLevel(s, name) { return s && s.ench && s.ench[name] ? s.ench[name] : 0; }

// stacks to and from saves, by name
export function stackToJSON(s) {
  if (!s) return null;
  const a = [itemName(s.id), s.count];
  const extra = hasExtra(s);
  const more = s.rep || s.name || s.trim || s.potion || extra;
  if (s.dmg || s.ench || more) a.push(s.dmg | 0);
  if (s.ench || more) a.push(s.ench || 0);
  if (more) {
    const m = { rep: s.rep || 0, name: s.name || '', trim: s.trim || 0, potion: s.potion || '' };
    for (const k of EXTRA) if (s[k] !== undefined) m[k] = k === 'items' ? s.items.map(stackToJSON) : s[k];
    a.push(m);
  }
  return a;
}
export function stackFromJSON(a) {
  if (!Array.isArray(a)) return null;
  const id = I[a[0]] !== undefined ? I[a[0]] : B[a[0]];
  if (!id) return null;
  const s = { id, count: Math.max(1, Math.min(maxStack(id), a[1] | 0)) };
  if (a[2]) s.dmg = a[2] | 0;
  if (a[3] && typeof a[3] === 'object') s.ench = a[3];
  const m = a[4];
  if (m && typeof m === 'object') {
    if (m.rep) s.rep = m.rep | 0; if (m.name) s.name = String(m.name); if (Array.isArray(m.trim)) s.trim = m.trim; if (m.potion) s.potion = String(m.potion);
    for (const k of EXTRA) if (m[k] !== undefined && m[k] !== null) s[k] = k === 'items' && Array.isArray(m.items) ? m.items.map(stackFromJSON) : m[k];
  }
  return s;
}
// a shulker box (or anything holding items) with something in it
export function contentsOf(s) { return s && Array.isArray(s.items) ? s.items.filter(Boolean) : []; }

export const items = {
  ITEMS, I, DRAW, ITEM_BASE,
  byName: n => ITEMS[I[n]] || null,
  byId: id => ITEMS[id] || null,
  get: k => (typeof k === 'number' ? ITEMS[k] : ITEMS[I[k]]) || null,
  id: itemId, name: itemName, displayName, maxStack, maxDamage, blockOf, toolOf, foodOf, armorOf, fuelTicks,
};
