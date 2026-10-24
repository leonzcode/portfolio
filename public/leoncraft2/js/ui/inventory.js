/* ---------------------------------------------------------------------------
   Leoncraft 2 - the inventory and its two screens.

   Inventory is the model: 36 slots (0-8 the hotbar, 9-35 the rest), four
   armour slots (head, chest, legs, feet), the off hand, the 2 x 2 crafting
   grid and its result, the stack on the mouse while a screen is open, and
   which hotbar slot is selected. A stack is { id, count, dmg?, ench? } or
   null; ids are item ids (js/items.js: a block's item id is its block id),
   dmg is the wear on a tool or a piece of armour. In creative, blocks never
   run out.

     const inv = new Inventory({ mode: 'creative' });
     inv.on('held', id => renderer.setHeld(id, DRAW));     // the selected stack changed
     inv.on('change', () => ...);                           // anything changed
     inv.on('drop', stack => ...);                          // thrown out of a screen
     inv.on('broke', stack => ...);                         // a tool wore out
     gui.open(inventoryScreen(inv, icons));                 // E: creative or survival

   CreativeInventoryScreen and InventoryScreen work like the game's: click to
   pick up and put down, right click to halve or place one, shift-click to
   move across (shift and a double click, with a chest or the like open:
   every stack of that item), a double click to gather, drag to spread (left evenly, right
   one each), 1-9 over a slot to swap with the hotbar, F for the off hand,
   middle click (creative) for a full stack, Q over a slot to throw one
   (Ctrl+Q the stack). The 2 x 2 grid crafts (js/crafting.js): a click on
   the result takes one craft, shift-click crafts as many as fit. The
   creative screen has the game's tab rows, a scrolling 9 x 5 grid, a search
   box and the Survival Inventory tab with its destroy-item slot.

   ContainerScreen is shared with the crafting table, chests and furnaces
   (js/ui/containers.js): slots of kind 'craft' read this.grid, 'box' reads
   this.box (the container's own slots).

   Slot positions and sheet coordinates are the game's (176 x 166 survival,
   195 x 136 creative, 18-pixel slots); the art is Pixel Perfection CE's.
--------------------------------------------------------------------------- */
import { BLOCKS, B } from '../blocks.js?v=107';
import { Screen, TextField, WHITE } from './gui.js?v=107';
import { PAINTING_ART } from '../paintingdata.js?v=107';
import { ITEMS, I, ITEM_BASE, displayName, maxStack, maxDamage, sameItem, withCount, stackToJSON, stackFromJSON, armorOf, cooldownLeft, STEW_EFFECTS, PAINTING_VARIANTS, SONGS, stewEffect, isBundle, bundleWeight, bundleInsert, bundleTake } from '../items.js?v=107';
import { matchGrid, consumeGrid } from '../crafting.js?v=107';
import { enchName, ENCH } from '../enchanting.js?v=107';
import { isPotion, isTipped, potionName, potionLines, effectLines, POTIONS } from '../brewing.js?v=107';
import { patternLines, drawBannerIcon } from '../banners.js?v=107';
import { mapLines } from '../maps.js?v=107';
import { EFFECTS, EFFECT_ICON, EFFECT_SHEET, effectName, effectTime } from '../effects.js?v=107';
import { dialPicture, usePicture } from '../dials.js?v=107';
import { RecipeBook } from './recipebook.js?v=107';
export { displayName, maxStack };

const LABEL_GREY = 0x404040;          // the dark grey of container titles
const HIGHLIGHT = 0x80FFFFFF;         // a hovered slot
const YELLOW = 0xFFFF55;

/* ------------------------------ the model ------------------------------ */

const same = sameItem;
// which armour slot an item can be worn in (0 head ... 3 feet), or -1
export function armourSlotOf(id) {
  const a = armorOf(id);
  return a ? a.slot : -1;
}
/* Wear on a stack: n points, each one skipped with chance level/(level+1)
   for Unbreaking (armour: 60% + 40%/(level+1) of the time it still wears).
   Returns true when the stack wore out. */
export function wear(s, n, isArmor) {
  const max = maxDamage(s.id);
  if (!max) return false;
  const ub = s.ench && s.ench.unbreaking ? s.ench.unbreaking : 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (ub > 0) {
      const keep = isArmor ? 0.6 + 0.4 / (ub + 1) : 1 / (ub + 1);
      if (Math.random() >= keep) continue;
    }
    k++;
  }
  s.dmg = (s.dmg | 0) + k;
  return s.dmg >= max;
}

export class Inventory {
  constructor(opts = {}) {
    this.mode = opts.mode === 'survival' ? 'survival' : 'creative';
    this.slots = new Array(36).fill(null);
    this.armor = [null, null, null, null];
    this.offhand = null;
    this.craft = [null, null, null, null];
    this.craftResult = null;          // what the 2 x 2 grid makes (worked out by the screen)
    this.carried = null;              // on the mouse in a screen
    this.selected = 0;
    /* The integrator's hook for the figure in the inventory box:
       drawPlayer(g, x, y, w, h, mx, my), all in GUI pixels. Unset, the box stays empty. */
    this.drawPlayer = null;
    this._on = { change: [], held: [], drop: [], broke: [] };
    this._heldId = 0;
    // when each slot (36: the off hand) last had something put in it: the hotbar's pop (ui/hud.js)
    this.popAt = new Float64Array(37);
  }

  /* ---- events ---- */
  on(type, fn) {
    const list = this._on[type];
    if (!list) throw new Error('no such inventory event: ' + type);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }
  emit(type, arg) { for (const fn of this._on[type].slice()) { try { fn(arg, this); } catch (e) { console.error(e); } } }
  // call after changing slots by hand; fires 'change', and 'held' when the selected item is different
  changed() {
    this.emit('change');
    const h = this.heldId();
    if (h !== this._heldId) { this._heldId = h; this.emit('held', h); }
  }

  /* ---- reading ---- */
  get held() { return this.slots[this.selected]; }
  heldId() { const s = this.slots[this.selected]; return s ? s.id : 0; }
  offhandId() { return this.offhand ? this.offhand.id : 0; }
  get(i) { return this.slots[i]; }
  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }
  findSlot(id) { for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) return i; return -1; }

  /* ---- changing ---- */
  setMode(mode) { this.mode = mode === 'survival' ? 'survival' : 'creative'; this.changed(); }
  select(i) { i = ((i % 9) + 9) % 9; if (i !== this.selected) { this.selected = i; this.changed(); } }
  // the wheel: down (positive) moves right, as in the game
  scroll(delta) { if (delta) this.select(this.selected + (delta > 0 ? 1 : -1)); }
  set(i, stack) { this.slots[i] = stack && stack.count > 0 && stack.id ? withCount(stack, Math.min(stack.count, maxStack(stack.id))) : null; this.changed(); }

  /* Puts count of an item into the inventory the way the game does: onto a
     matching stack with room (the selected one first, then the off hand, then
     slot order), then into the first empty slot. Returns what did not fit. */
  add(id, count = 1) { return id && count > 0 ? this.addStack({ id, count }) : 0; }
  // the same for a whole stack (keeping its wear and enchantments); returns what did not fit
  addStack(st) {
    if (!st || !st.id || st.count <= 0) return 0;
    const max = maxStack(st.id), count = st.count;
    let left = count;
    // (each slot that takes some pops, as the game's does: popTime 5)
    const now = performance.now();
    const fill = (s, i) => { const n = Math.min(max - s.count, left); s.count += n; left -= n; if (n > 0) this.popAt[i] = now; };
    const sel = this.slots[this.selected];
    if (same(sel, st) && sel.count < max) fill(sel, this.selected);
    if (left && same(this.offhand, st) && this.offhand.count < max) fill(this.offhand, 36);
    for (let i = 0; i < 36 && left; i++) { const s = this.slots[i]; if (same(s, st) && s.count < max) fill(s, i); }
    for (let i = 0; i < 36 && left; i++) {
      if (!this.slots[i]) { const n = Math.min(max, left); this.slots[i] = withCount(st, n); left -= n; this.popAt[i] = now; }
    }
    if (left !== count) this.changed();
    return left;
  }
  // how many of a stack's item would fit, without putting any anywhere
  roomFor(st) {
    const max = maxStack(st.id);
    let room = 0;
    for (let i = 0; i < 36; i++) { const s = this.slots[i]; room += !s ? max : same(s, st) ? max - s.count : 0; }
    return room;
  }
  // a stack back into the inventory (closing a screen); what does not fit is dropped
  placeBack(stack) {
    if (!stack || !stack.count) return;
    const left = this.addStack(stack);
    if (left > 0) this.emit('drop', withCount(stack, left));
  }
  /* One (or n) from the selected stack, after placing a block. Creative
     never runs out. Returns false when there was nothing to take. */
  takeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    if (this.mode === 'creative') return true;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
    return true;
  }
  /* Wear on the selected item (a tool used): n points, fewer with
     Unbreaking. A tool that wears out breaks. Returns true when it broke. */
  damageSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s || this.mode === 'creative') return false;
    const broke = wear(s, n, false);
    if (broke) { this.slots[this.selected] = null; this.emit('broke', s); }
    this.changed();
    return broke;
  }
  /* Pick block (middle click on the world), as the game does it: already in
     the hotbar selects it; elsewhere in the inventory swaps it into the
     hotbar; in creative, missing, it goes into the hotbar (an empty slot
     from the selected one on, else the selected slot, moving what was there
     into the inventory if there is room). Returns true when it did anything. */
  pickBlock(id) {
    if (!id) return false;
    const at = this.findSlot(id);
    if (at >= 0 && at < 9) { this.selected = at; this.changed(); return true; }
    const hs = this._suitableHotbarSlot();
    if (at >= 9) {
      const t = this.slots[hs]; this.slots[hs] = this.slots[at]; this.slots[at] = t;
      this.selected = hs; this.changed(); return true;
    }
    if (this.mode !== 'creative') return false;
    const old = this.slots[hs];
    if (old) { for (let i = 9; i < 36; i++) if (!this.slots[i]) { this.slots[i] = old; break; } }
    this.slots[hs] = { id, count: 1 };
    this.selected = hs;
    this.changed();
    return true;
  }
  _suitableHotbarSlot() {
    for (let k = 0; k < 9; k++) { const i = (this.selected + k) % 9; if (!this.slots[i]) return i; }
    return this.selected;
  }
  clear() {
    this.slots.fill(null); this.armor.fill(null); this.offhand = null; this.craft.fill(null); this.carried = null;
    this.changed();
  }

  /* Saved by item name, so a save survives the lists being renumbered. */
  toJSON() {
    const out = stackToJSON;
    return { v: 2, mode: this.mode, selected: this.selected, slots: this.slots.map(out), armor: this.armor.map(out), offhand: out(this.offhand), craft: this.craft.map(out) };
  }
  fromJSON(o) {
    if (!o || typeof o !== 'object') return this;
    const inn = stackFromJSON;
    if (o.mode) this.mode = o.mode === 'survival' ? 'survival' : 'creative';
    this.selected = Math.max(0, Math.min(8, o.selected | 0));
    for (let i = 0; i < 36; i++) this.slots[i] = o.slots ? inn(o.slots[i]) : null;
    for (let i = 0; i < 4; i++) this.armor[i] = o.armor ? inn(o.armor[i]) : null;
    this.offhand = inn(o.offhand);
    for (let i = 0; i < 4; i++) this.craft[i] = o.craft ? inn(o.craft[i]) : null;
    this.carried = null;
    this.changed();
    return this;
  }
}

/* ------------------------------ creative tabs ------------------------------ */

export const TABS = [
  { key: 'building', name: 'Building Blocks', icon: ['bricks'], col: 0, top: true },
  { key: 'colored', name: 'Colored Blocks', icon: ['cyan_wool', 'white_wool'], col: 1, top: true },
  { key: 'natural', name: 'Natural Blocks', icon: ['grass_block'], col: 2, top: true },
  { key: 'functional', name: 'Functional Blocks', icon: ['oak_sign', 'crafting_table'], col: 3, top: true },
  { key: 'redstone', name: 'Redstone Blocks', icon: ['redstone_wire', 'redstone_block'], col: 4, top: true },
  { key: 'search', name: 'Search Items', icon: ['compass', 'lodestone', 'glass'], col: 5, top: true, right: true, search: true },
  { key: 'tools', name: 'Tools & Utilities', icon: ['diamond_pickaxe'], col: 0, top: false },
  { key: 'combat', name: 'Combat', icon: ['netherite_sword', 'golden_sword'], col: 1, top: false },
  { key: 'food', name: 'Food & Drinks', icon: ['golden_apple', 'apple'], col: 2, top: false },
  { key: 'ingredients', name: 'Ingredients', icon: ['iron_ingot'], col: 3, top: false },
  { key: 'spawn_eggs', name: 'Spawn Eggs', icon: ['pig_spawn_egg'], col: 4, top: false },
  { key: 'inventory', name: 'Survival Inventory', icon: ['chest'], col: 5, top: false, right: true, inventory: true },
];
const BLOCK_TABS = ['building', 'colored', 'natural', 'functional', 'redstone'];
const ITEM_TABS = ['tools', 'combat', 'food', 'ingredients', 'spawn_eggs'];
let lastTab = 0;                       // the game remembers the tab between openings

// a creative tab for blocks the generated list has not placed yet
function guessTab(d) {
  if (d.shape === 'cross' || d.leaves || d.log || d.fluid || /_ore$|^(dirt|grass_block|sand|gravel|clay|snow|ice|stone|deepslate)$/.test(d.name)) return 'natural';
  return 'building';
}
let itemsCache = null, itemsFor = -1;
// the items in each creative tab, in tab order; .all is the search tab's list
export function creativeItems() {
  if (itemsCache && itemsFor === BLOCKS.length) return itemsCache;
  const lists = {};
  for (const k of BLOCK_TABS.concat(ITEM_TABS)) lists[k] = [];
  for (const d of BLOCKS) {
    if (!d || !d.id || d.item === false || d.lower || d.shape === 'none' && d.iconLayer === undefined && !d.icon) continue;
    if (d.tab === null) continue;
    const tab = d.tab === undefined ? guessTab(d) : d.tab;
    if (lists[tab]) lists[tab].push(d);
  }
  const out = { all: [], tabOf: new Map() };
  for (const k of BLOCK_TABS) {
    lists[k].sort((a, b) => (a.order ?? 1e6 + a.id) - (b.order ?? 1e6 + b.id));
    out[k] = lists[k].map(d => d.id);
  }
  // the items that are not blocks, in the game's list order
  for (const k of ITEM_TABS) out[k] = [];
  // (an item drawn by a block's picture counts: the water and lava buckets, whose pictures are their fluids' item icons)
  for (let id = ITEM_BASE; id < ITEMS.length; id++) { const it = ITEMS[id], tab = it && (TAB_OF[it.name] || it.tab); if (it && out[tab] && (it.texIndex >= 0 || it.iconLayer !== undefined)) out[tab].push(id); }
  // an item the game lists once for each of its kinds: those kinds in its place (the search tab gets every book level)
  const search = new Map();
  for (const k of BLOCK_TABS.concat(ITEM_TABS)) {
    const list = [];
    for (const id of out[k]) {
      const kinds = VARIANTS[ITEMS[id] ? ITEMS[id].name : ''];
      if (!kinds) { list.push(id); continue; }
      const v = kinds(id);
      for (const st of v.tab) list.push(st);
      if (v.search) search.set(id, v.search);
    }
    // the rockets are in Combat too, after the arrows
    if (k === 'combat' && I.firework_rocket !== undefined && !list.some(e => entryId(e) === I.firework_rocket)) list.push(...VARIANTS.firework_rocket(I.firework_rocket).tab);
    out[k] = list;
  }
  for (const k of BLOCK_TABS.concat(ITEM_TABS)) for (const e of out[k]) {
    const id = entryId(e), first = !out.tabOf.has(id);
    if (search.has(id)) { if (first) out.all.push(...search.get(id)); }
    else if (first || typeof e === 'object' && k === out.tabOf.get(id)) out.all.push(e);
    if (first) out.tabOf.set(id, k);
  }
  itemsCache = out; itemsFor = BLOCKS.length;
  return out;
}
// items the generated list files under the wrong tab: the game keeps these with the functional blocks
const TAB_OF = { item_frame: 'functional', glow_item_frame: 'functional', painting: 'functional', armor_stand: 'functional', end_crystal: 'functional', water_bucket: 'tools', lava_bucket: 'tools' };
/* The kinds the game lists an item under, each a stack to copy: every
   potion as a drink, a splash and a lingering potion and an arrow (the
   game's order of potions); an enchanted book of each enchantment at its top
   level (and at every level in the search tab); the goat horns' eight
   instruments; rockets of each flight; ominous bottles of each level;
   suspicious stews of each flower's effect (one each); every painting. */
const POTION_ORDER = ['water', 'mundane', 'thick', 'awkward', 'night_vision', 'long_night_vision', 'invisibility', 'long_invisibility',
  'leaping', 'long_leaping', 'strong_leaping', 'fire_resistance', 'long_fire_resistance', 'swiftness', 'long_swiftness', 'strong_swiftness',
  'slowness', 'long_slowness', 'strong_slowness', 'turtle_master', 'long_turtle_master', 'strong_turtle_master', 'water_breathing',
  'long_water_breathing', 'healing', 'strong_healing', 'harming', 'strong_harming', 'poison', 'long_poison', 'strong_poison', 'regeneration',
  'long_regeneration', 'strong_regeneration', 'strength', 'long_strength', 'strong_strength', 'weakness', 'long_weakness', 'luck',
  'slow_falling', 'long_slow_falling', 'wind_charged', 'weaving', 'oozing', 'infested'];
export const INSTRUMENTS = ['ponder', 'sing', 'seek', 'feel', 'admire', 'call', 'yearn', 'dream'];
const potions = id => ({ tab: POTION_ORDER.filter(p => POTIONS[p]).map(potion => ({ id, potion })) });
const VARIANTS = {
  potion: potions, splash_potion: potions, lingering_potion: potions, tipped_arrow: potions,
  enchanted_book: id => {
    const names = Object.keys(ENCH).sort(), all = [];
    for (const n of names) for (let l = 1; l <= ENCH[n].maxLevel; l++) all.push({ id, ench: { [n]: l } });
    return { tab: names.map(n => ({ id, ench: { [n]: ENCH[n].maxLevel } })), search: all };
  },
  goat_horn: id => ({ tab: INSTRUMENTS.map(n => ({ id, instrument: n + '_goat_horn' })) }),
  firework_rocket: id => ({ tab: [1, 2, 3].map(flight => ({ id, flight })) }),
  ominous_bottle: id => ({ tab: [0, 1, 2, 3, 4].map(amp => ({ id, amp })) }),
  suspicious_stew: id => {
    const seen = new Set(), tab = [];
    for (const k in STEW_EFFECTS) { const e = STEW_EFFECTS[k], key = e.join(); if (!seen.has(key)) { seen.add(key); tab.push({ id, stew: e.slice() }); } }
    return { tab };
  },
  painting: id => ({ tab: [id].concat(PAINTING_VARIANTS.map(([variant]) => ({ id, variant }))) }),
};
// a creative list's entry: an id, or a stack to copy (a potion, a book...)
export const entryId = e => (typeof e === 'number' ? e : e ? e.id : 0);
export const entryStack = (e, count) => (typeof e === 'number' ? { id: e, count } : Object.assign(JSON.parse(JSON.stringify(e)), { count }));
// what the search box matches an entry by: its name as its tooltip shows it
function entryName(e) {
  if (typeof e === 'number') return displayName(e);
  return stackTooltip(entryStack(e, 1)).slice(0, 2).join(' ').replace(/\u00a7./g, '');
}
const tabIconId = t => { for (const n of t.icon) if (I[n] !== undefined) return I[n]; return B.stone || 1; };

/* ------------------------------ the empty-slot outlines ------------------------------ */

// drawn for Leoncraft (not the game's sprites): head, chest, legs, feet, then the off hand's shield
const OUTLINES = [
  ['', '', '', '....########', '...##########', '..############', '..############', '..####....####', '..###......###', '..###......###'],
  ['', '', '...###....###', '..#####..#####', '..############', '..############', '...##########', '....########', '....########', '....########', '....########', '....########', '....########'],
  ['', '', '....########', '....########', '....########', '....###..###', '....###..###', '....###..###', '....###..###', '....###..###', '....###..###', '....###..###'],
  ['', '', '', '', '', '', '...###....###', '...###....###', '...###....###', '...###....###', '..####...####', '..####...####', '.#####..#####'],
  ['', '', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '....########', '....########', '.....######', '......####', '.......##'],
];
export function drawOutline(g, kind, x, y) {
  const rows = OUTLINES[kind];
  if (!rows) return;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '#') { c++; continue; }
      let e = c;
      while (e < row.length && row[e] === '#') e++;
      g.fill(x + c, y + r + 1, x + e, y + r + 2, 0x2CFFFFFF);
      c = e;
    }
  }
}

/* ------------------------------ drawing a stack ------------------------------ */

/* The enchantment glint: what is enchanted (and a few things that always
   shine: an enchanted golden apple, a bottle o' enchanting, a nether star...)
   gets two bands of violet light sliding across it, added over its picture.
   Drawn here, not the game's texture. GLINT.seen says one was drawn, so the
   HUD and the screens keep redrawing while it moves. */
const ALWAYS_GLINT = new Set(['enchanted_golden_apple', 'experience_bottle', 'nether_star', 'enchanted_book', 'end_crystal', 'debug_stick', 'written_book']);
export const GLINT = { seen: false };
export function hasGlint(st) {
  if (!st) return false;
  if (st.ench && Object.keys(st.ench).length) return true;
  if (st.lodestone) return true;
  const it = ITEMS[st.id];
  return !!it && ALWAYS_GLINT.has(it.name);
}
let glintC = null, glintTimer = 0;
// the screen drawn again in 50 ms (twenty times a second is enough for the bands to slide smoothly)
function glintAgain(g) { if (!glintTimer) glintTimer = setTimeout(() => { glintTimer = 0; g.markDirty(); }, 50); }
function drawGlint(g, icons, st, x, y) {
  const e = icons.get ? icons.get(st.id) : null;
  if (!e || !e.c) return;
  const w = e.w;
  if (!glintC) glintC = document.createElement('canvas');
  if (glintC.width !== w) { glintC.width = glintC.height = w; }
  const c = glintC.getContext('2d');
  c.globalCompositeOperation = 'copy';
  c.drawImage(e.c, e.x, e.y, w, w, 0, 0, w, w);
  c.globalCompositeOperation = 'source-in';
  // two bands, one sliding each way, slowly (a band crosses in about three seconds)
  const t = performance.now() / 1000;
  // a violet sheen all over, and the bands brighter on it
  c.fillStyle = 'rgb(34,12,66)';
  c.fillRect(0, 0, w, w);
  c.globalCompositeOperation = 'lighter';
  for (const [speed, slope, rgb] of [[0.33, 0.6, '128,64,204'], [-0.21, -1.4, '96,48,170']]) {
    const off = ((t * speed) % 1 + 1) % 1 * 3 * w - w * 1.5;
    const gr = c.createLinearGradient(off, 0, off + w * 1.2, w * 1.2 * slope);
    gr.addColorStop(0, 'rgba(' + rgb + ',0)'); gr.addColorStop(0.5, 'rgba(' + rgb + ',0.55)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = gr;
    c.fillRect(0, 0, w, w);
  }
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(e.c, e.x, e.y, w, w, 0, 0, w, w);
  const ctx = g.ctx, op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(glintC, 0, 0, w, w, x, y, 16, 16);
  ctx.globalCompositeOperation = op;
  GLINT.seen = true;
}

// an item and its count, the count in the slot's bottom-right corner, and the wear bar, as in the game
export function drawStack(g, icons, st, x, y, countText, countColour) {
  if (!st) return;
  // a compass or a clock shows where it points now, a bow or a crossbow how far it is drawn or what it holds
  // (js/dials.js); trimmed armour its trim (js/trims.js), a potion its colour, dyed leather its dye
  const nm = ITEMS[st.id] && ITEMS[st.id].name;
  const dial = nm && (dialPicture(nm, st) || usePicture(st, nm));
  if (dial && icons.drawLayer && icons.drawLayer(g, dial, x, y)) { /* drawn */ }
  else if (st.trim && icons.drawTrimmed) icons.drawTrimmed(g, st, x, y);
  else if ((st.potion || st.color !== undefined) && icons.drawTinted) icons.drawTinted(g, st, x, y);
  else if (st.patterns && st.patterns.length) drawBannerIcon(g, st, x, y);
  else if (!(st.face && drawHead(g, st.face, x, y))) icons.draw(g, st.id, x, y);
  if (hasGlint(st)) drawGlint(g, icons, st, x, y);
  // a bundle with something in it: how full, in blue (red once full)
  if (st.items && isBundle(st)) {
    const w = bundleWeight(st);
    if (w > 0) { g.fill(x + 2, y + 13, x + 15, y + 15, 0xFF000000); g.fill(x + 2, y + 13, x + 2 + Math.min(1 + Math.floor(w / 64 * 12), 13), y + 14, w >= 64 ? 0xFFFF5555 : 0xFF7087FF); }
  }
  if (st.dmg > 0) {
    const max = maxDamage(st.id);
    if (max) {
      const left = Math.max(0, 1 - st.dmg / max), w = Math.round(13 * left);
      // green when new, through yellow, to red
      const h = left / 3, rgb = hsv(h, 1, 1);
      g.fill(x + 2, y + 13, x + 15, y + 15, 0xFF000000);
      g.fill(x + 2, y + 13, x + 2 + w, y + 14, 0xFF000000 | rgb);
    }
  }
  const text = countText !== undefined ? countText : st.count > 1 ? String(st.count) : '';
  if (text) g.text(text, x + 19 - 2 - g.textWidth(text), y + 6 + 3, countColour || WHITE, true);
  // an item cooling down (a pearl just thrown, a horn just blown): a half-white veil over what is left of it, from the bottom
  const cd = cooldownLeft(st.id);
  if (cd > 0) { const top = y + Math.floor(16 * (1 - cd)); g.fill(x, top, x + 16, top + Math.ceil(16 * cd), 0x7FFFFFFF); COOLING.seen = true; }
}
// set when a slot was drawn under a cooldown, so the HUD draws again soon (ui/hud.js)
export const COOLING = { seen: false };

/* A head with a skin on it (a stack's `face`: a skin's address, or 'self' for
   your own skin through HEADS.self), drawn as the game draws a head in a slot:
   a cube seen from above, the face on the left, the head's left side on the
   right, each with its hat layer. False while the skin is still loading. */
export const HEADS = { self: () => '' };
const headImgs = new Map();
const HEAD_FACES = [
  // [base u, v, hat u, v, transform a, b, c, d, e, f (slot pixels), shade]
  [8, 0, 40, 0, 7 / 8, 3.5 / 8, -7 / 8, 3.5 / 8, 8, 1, 0],
  [8, 8, 40, 8, 7 / 8, 3.5 / 8, 0, 1, 1, 4.5, 0.2],
  [16, 8, 48, 8, 7 / 8, -3.5 / 8, 0, 1, 8, 8, 0.4]
];
function drawHead(g, face, x, y) {
  const url = face === 'self' ? HEADS.self() : face;
  if (!url) return false;
  let img = headImgs.get(url);
  if (!img) {
    if (headImgs.size > 16) headImgs.clear();
    img = new Image(); img.src = url; headImgs.set(url, img);
  }
  if (!img.complete || !img.naturalWidth) { if (!img.complete) COOLING.seen = true; return false; }
  const ctx = g.ctx;
  for (const [u, v, hu, hv, a, b, c, d, e, f, shade] of HEAD_FACES) {
    ctx.save();
    ctx.transform(a, b, c, d, x + e, y + f);
    // the base layer covers the whole face, so the shade over both stays inside it
    ctx.drawImage(img, u, v, 8, 8, 0, 0, 8, 8);
    ctx.drawImage(img, hu, hv, 8, 8, 0, 0, 8, 8);
    if (shade) { ctx.fillStyle = 'rgba(0,0,0,' + shade + ')'; ctx.fillRect(0, 0, 8, 8); }
    ctx.restore();
  }
  return true;
}
function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

// the lines of a stack's tooltip: name, enchantments, what it does in the hand; with advanced
// tooltips on (F3 + H) the durability and the item's id as well, as in the game; in creative a suspicious
// stew's effect (only there: in survival you cannot tell what flower went in)
export function stackTooltip(st, advanced, creative) {
  const it = ITEMS[st.id];
  const lines = [(st.ench ? '§b' : '') + (st.name ? (st.plain ? '' : '§o') + st.name : isPotion(st) || (isTipped(st) && st.potion) ? potionName(st) : st.lodestone ? 'Lodestone Compass' : st.title && st.map !== undefined ? st.title : displayName(st.id))];
  // (a minigame's own item: what it does, in grey under its name)
  if (Array.isArray(st.lore)) for (const l of st.lore.slice(0, 4)) lines.push('§7' + String(l));
  if (isPotion(st) || (st.potion && isTipped(st))) lines.push(...potionLines(st));
  if (creative && st.stew) { const sw = stewEffect(st); if (sw) lines.push(...effectLines([[sw[0], 1, sw[1]]])); }
  const title = n => n.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (st.trim) lines.push('§7Upgrade:', '§9 ' + title(st.trim[0]) + ' Armor Trim', '§9 ' + title(st.trim[1]) + ' Material');
  // what a shulker box holds: the first five stacks, then how many more
  if (Array.isArray(st.items)) {
    const inside = st.items.filter(Boolean);
    for (const s of inside.slice(0, 5)) lines.push('§f' + (s.name || displayName(s.id)) + ' x' + s.count);
    if (inside.length > 5) lines.push('§o§7and ' + (inside.length - 5) + ' more...');
  }
  // a nest or hive moved with Silk Touch: its bees and honey
  if (Array.isArray(st.bees) && st.bees.length) lines.push('§7Bees: ' + st.bees.length + ' / 3');
  if (st.honey !== undefined) lines.push('§7Honey: ' + st.honey + ' / 5');
  // a filled map: locked, and with advanced tooltips its number and zoom
  if (st.map !== undefined) lines.push(...mapLines(st, advanced));
  // a banner's layers, the first six
  if (st.patterns) lines.push(...patternLines(st));
  if (st.color !== undefined) lines.push('§o§7Dyed');
  if (st.flight) lines.push('§7Flight Duration: ' + st.flight);
  if (st.instrument) lines.push('§7' + title(st.instrument.replace(/_goat_horn$/, '')));
  if (it && SONGS[it.name]) lines.push('§7' + SONGS[it.name][0]);
  if (it && it.name === 'ominous_bottle') lines.push('§9Bad Omen' + ((st.amp | 0) > 0 ? ' ' + ['II', 'III', 'IV', 'V'][(st.amp | 0) - 1] : '') + ' (01:40:00)');
  if (it && it.name === 'painting') {
    const v = st.variant && PAINTING_VARIANTS.find(p => p[0] === st.variant);
    // the famous painting it shows (paintingdata.js), as the game gives a painting's title and author
    const art = v && PAINTING_ART[v[0]];
    if (art) lines.push('§e' + art[0], '§7' + art[1] + ', ' + art[2], '§f' + v[1] + 'x' + v[2]);
    else if (v) lines.push('§e' + title(v[0]), '§f' + v[1] + 'x' + v[2]);
    else lines.push('§7Random variant');
  }
  const fwLines = fw => {
    const out = ['§7  ' + title(fw.shape === 'small_ball' ? 'small_ball' : fw.shape)];
    if (fw.colors && fw.colors.length) out.push('§7  ' + fw.colors.map(title).join(', '));
    if (fw.fade && fw.fade.length) out.push('§7  Fade to ' + fw.fade.map(title).join(', '));
    if (fw.trail) out.push('§7  Trail');
    if (fw.twinkle) out.push('§7  Twinkle');
    return out;
  };
  if (st.firework) lines.push(...fwLines(st.firework));
  if (st.explosions) for (const e of st.explosions) lines.push(...fwLines(e));
  if (st.ench) for (const k in st.ench) lines.push((/curse/.test(k) ? '§c' : '§7') + enchName(k, st.ench[k]));
  if (it && it.attack) {
    const fmt = n => (Math.round(n * 10) / 10).toString();
    lines.push('', '§7When in Main Hand:', '§2 ' + fmt(it.attack + (st.ench && st.ench.sharpness ? 0.5 * st.ench.sharpness + 0.5 : 0)) + ' Attack Damage', '§2 ' + fmt(it.attackSpeed) + ' Attack Speed');
  } else if (it && it.armor && it.armor.points) {
    lines.push('', '§7When on ' + ['Head', 'Body', 'Legs', 'Feet'][it.armor.slot] + ':', '§9+' + it.armor.points + ' Armor');
    if (it.armor.toughness) lines.push('§9+' + it.armor.toughness + ' Armor Toughness');
    if (it.armor.knockback) lines.push('§9+' + Math.round(it.armor.knockback * 10) + ' Knockback Resistance');
  }
  if (advanced) {
    if (st.dmg > 0) { const max = maxDamage(st.id); lines.push('Durability: ' + (max - st.dmg) + ' / ' + max); }
    const it2 = ITEMS[st.id], n = it2 ? it2.name : BLOCKS[st.id] ? BLOCKS[st.id].name : '';
    if (n) lines.push('§8minecraft:' + n);
  }
  return lines;
}

/* ------------------------------ the shared container screen ------------------------------ */

/* A slot on a screen: x, y (GUI pixels, the 16 x 16 item area), kind
   ('inv' i 0-35, 'armor' i 0-3, 'offhand', 'craft' i, 'result', 'box' i,
   'grid' i 0-44, 'destroy'), an empty outline to draw, and a stack limit. */
export const slot = (x, y, kind, i, extra) => Object.assign({ x, y, kind, i: i || 0 }, extra || null);
export const range = (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return r; };
// the player's inventory in the order the game fills it from a container: hotbar right to left, then the rest from the bottom
export const TO_PLAYER_REVERSED = range(0, 9).reverse().concat(range(9, 36).reverse());
export const TO_PLAYER = range(9, 36).concat(range(0, 9));

// the last pointer press, read before the GUI handles it (shift-click, which button)
const press = { shift: false, ctrl: false };
const hooked = new WeakSet();
function watchPointer(canvas) {
  if (hooked.has(canvas)) return;
  hooked.add(canvas);
  canvas.addEventListener('pointerdown', e => { press.shift = e.shiftKey; press.ctrl = e.ctrlKey || e.metaKey; }, true);
}

export class ContainerScreen extends Screen {
  constructor(inv, icons, imageWidth, imageHeight) {
    super('');
    this.inv = inv; this.icons = icons;
    this.imageWidth = imageWidth; this.imageHeight = imageHeight;
    this.background = 'none';
    this.slots = [];
    this.hover = null;
    this.drag = null;                  // { button, slots: [] } while spreading a stack
    this.dbl = false; this.lastSlot = null; this.lastTime = 0; this.lastButton = -1;
    this._anim = false;
    this.grid = null; this.gridW = 0;  // the crafting grid, if the screen has one
    this.result = null;                // and what it makes: { stack, match }
    this.box = null;                   // a container's own slots
  }
  // keep redrawing while icons are still being made
  get animates() { return this._anim || !!(this.icons && this.icons.pending); }
  set animates(v) { this._anim = v; }
  get creative() { return this.inv.mode === 'creative'; }

  init() {
    this.left = Math.floor((this.width - this.imageWidth) / 2);
    this.top = Math.floor((this.height - this.imageHeight) / 2);
    if (this.gui) watchPointer(this.gui.canvas);
    this.slots = this.makeSlots();
    this.updateResult();
  }
  makeSlots() { return []; }

  /* ---- slot contents ---- */
  getStack(s) {
    const inv = this.inv;
    switch (s.kind) {
      case 'inv': return inv.slots[s.i];
      case 'armor': return inv.armor[s.i];
      case 'offhand': return inv.offhand;
      case 'craft': return this.grid ? this.grid[s.i] : null;
      case 'result': return this.result ? this.result.stack : null;
      case 'box': return this.box ? this.box[s.i] : null;
      default: return null;
    }
  }
  setStack(s, st) {
    if (st && st.count <= 0) st = null;
    const inv = this.inv;
    switch (s.kind) {
      case 'inv': inv.slots[s.i] = st; break;
      case 'armor': inv.armor[s.i] = st; break;
      case 'offhand': inv.offhand = st; break;
      case 'craft': if (this.grid) this.grid[s.i] = st; break;
      case 'box': if (this.box) this.box[s.i] = st; this.boxChanged(s.i); break;
    }
  }
  boxChanged() {}
  mayPlace(s, st) {
    if (!st) return true;
    if (s.kind === 'result' || s.kind === 'grid' || s.kind === 'destroy' || s.output) return false;
    if (s.kind === 'armor') return armourSlotOf(st.id) === s.i;
    return true;
  }
  limit(s, id) { return Math.min(maxStack(id), s.kind === 'armor' ? 1 : 64); }
  // Curse of Binding: armour that has it cannot be taken off (except in creative)
  mayTake(s) { const st = this.getStack(s); return !(s.kind === 'armor' && st && st.ench && st.ench.binding_curse && !this.creative); }
  setCarried(st) { this.inv.carried = st && st.count > 0 ? st : null; }
  // a slot the drag, the double click and spreading leave alone
  special(s) { return s.kind === 'result' || s.kind === 'grid' || s.kind === 'destroy'; }

  // the slot under the pointer (the 18 x 18 square around its item)
  slotAt(mx, my) {
    for (const s of this.slots) if (mx >= s.x - 1 && mx < s.x + 17 && my >= s.y - 1 && my < s.y + 17 && this.slotShown(s)) return s;
    return null;
  }
  slotShown() { return true; }
  isOutside(mx, my) { return mx < this.left || my < this.top || mx >= this.left + this.imageWidth || my >= this.top + this.imageHeight; }

  /* ---- crafting ---- */
  // what the grid makes now (called after anything changed)
  updateResult() {
    if (!this.grid) return;
    const m = matchGrid(this.grid, this.gridW);
    this.result = m ? { stack: m.result, match: m } : null;
    if (this.grid === this.inv.craft) this.inv.craftResult = this.result ? this.result.stack : null;
  }
  // take one craft's result away: the grid gives up one of each
  craftOnce() {
    const r = this.result;
    if (!r) return null;
    const out = withCount(r.stack, r.stack.count);
    consumeGrid(this.grid, st => this.inv.placeBack(st));
    this.updateResult();
    this.crafted(out);
    return out;
  }
  crafted() {}                          // a hook: the result was taken (stats, sounds)
  clickResult(button) {
    const r = this.result, c = this.inv.carried;
    if (!r) return;
    if (!c) { this.setCarried(this.craftOnce()); return; }
    // the same item on the mouse with room for a whole result: take it on top
    if (same(c, r.stack) && c.count + r.stack.count <= maxStack(c.id)) { const o = this.craftOnce(); if (o) c.count += o.count; }
  }
  // shift-click on the result: craft while it stays the same and fits
  shiftResult() {
    let guard = 0;
    while (this.result && guard++ < 64) {
      const st = this.result.stack;
      if (this.inv.roomFor(st) < st.count) break;
      const first = st.id;
      const o = this.craftOnce();
      if (!o) break;
      this.moveInto(o, TO_PLAYER_REVERSED);
      if (o.count) { this.inv.placeBack(o); break; }
      if (!this.result || this.result.stack.id !== first) break;
    }
  }

  /* ---- clicks: the game's rules ---- */
  // a plain left (0) or right (2) click on a slot
  click(s, button) {
    if (s.kind === 'result') { this.clickResult(button); return; }
    const st = this.getStack(s), c = this.inv.carried;
    if (!s.output && this.bundleClick(s, button, st, c)) return;
    if (s.output) {
      // an output slot (a furnace's) only gives
      if (!st) return;
      if (!c) { const take = button === 2 ? Math.ceil(st.count / 2) : st.count; this.setCarried(withCount(st, take)); st.count -= take; this.setStack(s, st.count ? st : null); this.tookOutput(s, take); }
      else if (same(st, c)) { const n = Math.min(maxStack(c.id) - c.count, st.count); if (n > 0) { c.count += n; st.count -= n; this.setStack(s, st.count ? st : null); this.tookOutput(s, n); } }
      return;
    }
    if (st && !this.mayTake(s)) return;
    if (button === 0) {
      if (!c) { if (st) { this.setCarried(st); this.setStack(s, null); } }
      else if (!st) {
        if (!this.mayPlace(s, c)) return;
        const n = Math.min(c.count, this.limit(s, c.id));
        this.setStack(s, withCount(c, n)); c.count -= n;
        if (c.count <= 0) this.setCarried(null);
      } else if (same(st, c)) {
        const n = Math.min(this.limit(s, c.id) - st.count, c.count);
        if (n > 0) { st.count += n; c.count -= n; if (c.count <= 0) this.setCarried(null); this.setStack(s, st); }
      } else if (this.mayPlace(s, c) && c.count <= this.limit(s, c.id)) {
        this.setStack(s, c); this.setCarried(st);
      }
    } else if (button === 2) {
      if (!c) {
        if (st) {
          const take = Math.ceil(st.count / 2);
          this.setCarried(withCount(st, take)); st.count -= take;
          this.setStack(s, st.count > 0 ? st : null);
        }
      } else if (!st) {
        if (!this.mayPlace(s, c)) return;
        this.setStack(s, withCount(c, 1)); c.count--;
        if (c.count <= 0) this.setCarried(null);
      } else if (same(st, c)) {
        if (st.count < this.limit(s, c.id)) { st.count++; c.count--; if (c.count <= 0) this.setCarried(null); this.setStack(s, st); }
      } else if (this.mayPlace(s, c) && c.count <= this.limit(s, c.id)) {
        this.setStack(s, c); this.setCarried(st);
      }
    }
  }
  /* A bundle, the game's way (1.21.2 on): carried and left-clicked on a
     stack, it takes in what fits; right-clicked on an empty slot, its newest
     stack comes out there. Lying in a slot, a stack left-clicked onto it
     goes in, and a right click with nothing carried takes its newest out. */
  bundleClick(s, button, st, c) {
    if (c && isBundle(c) && st && button === 0) {
      if (!this.mayTake || this.mayTake(s)) { const n = bundleInsert(c, st); if (n) { st.count -= n; this.setStack(s, st.count ? st : null); } }
      return true;
    }
    if (c && isBundle(c) && !st && button === 2) {
      const out = bundleTake(c);
      if (out) { if (this.mayPlace(s, out)) this.setStack(s, out); else bundleInsert(c, out); }
      return true;
    }
    if (st && isBundle(st) && c && button === 0 && !isBundle(c)) {
      const n = bundleInsert(st, c);
      if (n) { c.count -= n; if (c.count <= 0) this.setCarried(null); this.setStack(s, st); }
      return true;
    }
    if (st && isBundle(st) && !c && button === 2) {
      const out = bundleTake(st);
      if (out) { this.setCarried(out); this.setStack(s, st); }
      return true;
    }
    return false;
  }
  tookOutput() {}                       // a hook: items taken from an output slot (furnace experience)
  // merge a stack into inventory slots (indices, in order), matching stacks first, then empty ones
  moveInto(st, indices) {
    const max = maxStack(st.id), inv = this.inv;
    for (const i of indices) {
      const t = inv.slots[i];
      if (same(t, st) && t.count < max) { const n = Math.min(max - t.count, st.count); t.count += n; st.count -= n; if (!st.count) return; }
    }
    for (const i of indices) if (!inv.slots[i]) { inv.slots[i] = withCount(st, Math.min(max, st.count)); st.count -= inv.slots[i].count; if (!st.count) return; }
  }
  // the same into a container's own slots
  moveIntoBox(st, indices) {
    const max = maxStack(st.id), box = this.box;
    for (const i of indices) {
      const t = box[i];
      if (same(t, st) && t.count < max) { const n = Math.min(max - t.count, st.count); t.count += n; st.count -= n; this.boxChanged(i); if (!st.count) return; }
    }
    for (const i of indices) if (!box[i]) { box[i] = withCount(st, Math.min(max, st.count)); st.count -= box[i].count; this.boxChanged(i); if (!st.count) return; }
  }
  // shift-click: the survival inventory's quick move
  quickMove(s) {
    if (s.kind === 'result') { this.shiftResult(); return; }
    const st = this.getStack(s);
    if (!st || !this.mayTake(s)) return;
    const MAIN = range(9, 36), HOT = range(0, 9);
    if (s.kind === 'craft' || s.kind === 'armor' || s.kind === 'offhand') this.moveInto(st, MAIN.concat(HOT));
    else if (s.kind === 'inv') {
      const a = armourSlotOf(st.id);
      if (a >= 0 && !this.inv.armor[a] && armorOf(st.id).points >= 0) { this.inv.armor[a] = withCount(st, 1); st.count--; }
      else if (ITEMS[st.id] && ITEMS[st.id].name === 'shield' && !this.inv.offhand) { this.inv.offhand = withCount(st, 1); st.count--; }
      else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    }
    if (!st.count) this.setStack(s, null);
  }
  // a double click: gather every matching stack onto the mouse, part stacks first
  pickAll() {
    const c = this.inv.carried;
    if (!c) return;
    const max = maxStack(c.id);
    for (let pass = 0; pass < 2 && c.count < max; pass++) {
      for (const s of this.slots) {
        if (this.special(s) || !this.slotShown(s) || !this.mayTake(s)) continue;
        const st = this.getStack(s);
        if (!same(st, c) || (pass === 0 && st.count >= max)) continue;
        const n = Math.min(max - c.count, st.count);
        c.count += n; st.count -= n;
        this.setStack(s, st.count ? st : null);
        if (c.count >= max) break;
      }
    }
  }
  // shift + double click: quick-move every stack like `like` on the same side as slot s (the container's or the player's)
  quickMoveAll(s, like) {
    const box = s.kind === 'box';
    for (const q of this.slots) {
      if ((q.kind === 'box') !== box || this.special(q) || q.output || !this.slotShown(q)) continue;
      if (!box && q.kind !== 'inv') continue;
      const st = this.getStack(q);
      if (st && same(withCount(st, 1), like)) this.quickMove(q);
    }
  }
  // 1-9 over a slot: trade places with that hotbar slot
  swapHotbar(s, n) {
    const hs = { kind: 'inv', i: n };
    const a = this.getStack(s), b = this.inv.slots[n];
    if (s.kind === 'result') { if (this.result && !b) this.inv.slots[n] = this.craftOnce(); return; }   // (null when it cannot be taken)
    if (s.output) { if (a && !b) { this.inv.slots[n] = a; this.setStack(s, null); this.tookOutput(s, a.count); } return; }
    if (a && !this.mayTake(s)) return;
    if (b && !this.mayPlace(s, b)) return;
    if (b && b.count > this.limit(s, b.id)) return;
    this.setStack(s, b); this.setStack(hs, a);
  }
  swapOffhand(s) {
    if (s.kind === 'offhand' || s.kind === 'result' || s.output) return;
    const a = this.getStack(s), b = this.inv.offhand;
    if (a && !this.mayTake(s)) return;
    if (b && !this.mayPlace(s, b)) return;
    this.setStack(s, b); this.inv.offhand = a;
  }
  // what can be spread over by a drag
  canDrag(s) {
    const c = this.inv.carried;
    if (!c || !this.mayPlace(s, c) || this.special(s)) return false;
    const st = this.getStack(s);
    return !st || same(st, c);
  }
  // how many each slot gets: left evenly, right one each, middle (creative) a full stack
  dragShare(d) {
    const c = this.inv.carried;
    if (!c) return 0;
    if (d.button === 0) return Math.floor(c.count / d.slots.length);
    if (d.button === 2) return 1;
    return maxStack(c.id);
  }
  // the counts the dragged-over slots would end with, and what stays on the mouse
  dragPreview() {
    const d = this.drag, c = this.inv.carried;
    if (!d || d.slots.length < 2 || !c) return null;
    const share = this.dragShare(d);
    let left = c.count;
    const counts = new Map();
    for (const s of d.slots) {
      const st = this.getStack(s), have = st ? st.count : 0, lim = this.limit(s, c.id);
      const n = Math.min(lim, have + share);
      counts.set(s, { count: n, capped: have + share > lim });
      if (d.button !== 1) left -= n - have;
    }
    return { counts, left: Math.max(0, left) };
  }
  spread() {
    const p = this.dragPreview(), c = this.inv.carried;
    if (!p) return;
    for (const [s, v] of p.counts) this.setStack(s, withCount(c, v.count));
    if (this.drag.button !== 1) { c.count = p.left; if (!c.count) this.setCarried(null); }
  }
  drop(button) {
    const c = this.inv.carried;
    if (!c) return;
    const n = button === 2 ? 1 : c.count;
    this.inv.emit('drop', withCount(c, n));
    c.count -= n;
    if (!c.count) this.setCarried(null);
  }

  /* ---- input ---- */
  // the screen's own controls (tabs, scrollbar); true when it took the click
  extraClick() { return false; }
  gridClick() {}
  // after any click or key: the grid's result again, and everyone told
  after() { this.updateResult(); this.inv.changed(); }

  mouseClicked(mx, my, button) {
    const shift = press.shift;
    const s = this.slotAt(mx, my);
    const now = performance.now();
    this.dbl = !!s && s === this.lastSlot && button === this.lastButton && now - this.lastTime < 250;
    this.lastSlot = s; this.lastTime = now; this.lastButton = button;
    this.pressButton = button;
    this.drag = null;
    const hit = this.extraClick(mx, my, button);
    if (hit) { this.after(); return hit; }
    if (!s) {
      if (this.isOutside(mx, my) && this.inv.carried && button !== 1) this.drop(button);
      this.after();
      return this.keepFocus();
    }
    const c = this.inv.carried;
    if (s.kind === 'grid') this.gridClick(s, button, shift);
    else if (s.kind === 'destroy') this.destroyClick(shift);
    else if (button === 1) {
      // middle: a full stack of it on the mouse, in creative; or spread full stacks
      if (this.creative && !c) { const st = this.getStack(s); if (st) this.setCarried(withCount(st, maxStack(st.id))); }
      else if (this.creative && c && this.canDrag(s)) this.drag = { button: 1, slots: [s] };
    } else if (shift && !c) {
      // shift and a double click with a container open: every stack like the one just moved goes across too
      if (this.dbl && button === 0 && this.box && this.lastQuick && !this.special(s) && !s.output) this.quickMoveAll(s, this.lastQuick);
      else { const st = this.getStack(s); this.lastQuick = st ? withCount(st, 1) : null; this.shiftClick(s); }
    } else if (s.kind === 'result' || s.output) this.click(s, button);
    else if (c) this.drag = { button, slots: this.canDrag(s) ? [s] : [] };
    else this.click(s, button);
    this.after();
    return this.keepFocus();
  }
  keepFocus() { return true; }
  shiftClick(s) { this.quickMove(s); }
  destroyClick() {}
  mouseDragged(mx, my) {
    const d = this.drag, c = this.inv.carried;
    if (!d || !c) return;
    const s = this.slotAt(mx, my);
    if (s && d.slots.indexOf(s) < 0 && this.canDrag(s) && (d.button === 1 || d.slots.length < c.count)) d.slots.push(s);
  }
  mouseReleased(mx, my, button) {
    const d = this.drag;
    this.drag = null;
    if (!d) {
      // a double click that picked a stack up on its second press gathers the rest on release
      const s = this.slotAt(mx, my);
      if (this.dbl && button === 0 && this.inv.carried && s && !this.special(s)) { this.pickAll(); this.dbl = false; this.after(); }
      return;
    }
    if (this.dbl && d.button === 0) { this.pickAll(); this.dbl = false; }
    else if (d.slots.length > 1) { this.drag = d; this.spread(); this.drag = null; }
    else {
      const s = d.slots[0] || this.slotAt(mx, my);
      if (s && d.button !== 1) this.click(s, d.button);
    }
    this.after();
  }
  keyPressed(e) {
    if (e.key === 'Escape') { this.gui.back(); return true; }
    const keys = this.options.get('keys') || {};
    if (e.code === keys.inventory) { this.gui.back(); return true; }
    const s = this.slotAt(this.gui.mx, this.gui.my);
    if (!this.inv.carried && s) {
      for (let n = 1; n <= 9; n++) {
        if (e.code === keys['hotbar' + n]) { this.numberKey(s, n - 1); this.after(); return true; }
      }
      if (e.code === (keys.swapOffhand || 'KeyF')) { if (s.kind !== 'grid' && s.kind !== 'destroy') this.swapOffhand(s); this.after(); return true; }
      if (e.code === (keys.drop || 'KeyQ')) { this.throwFrom(s, e.ctrlKey || e.metaKey); this.after(); return true; }
    }
    return false;
  }
  numberKey(s, n) { if (s.kind !== 'grid' && s.kind !== 'destroy') this.swapHotbar(s, n); }
  throwFrom(s, all) {
    if (s.kind === 'grid' || s.kind === 'destroy') return;
    if (s.kind === 'result') {
      // Q crafts once and throws it; Ctrl+Q crafts all there is and throws them
      let guard = 0;
      do { const o = this.craftOnce(); if (!o) break; this.inv.emit('drop', o); } while (all && this.result && guard++ < 64);
      return;
    }
    const st = this.getStack(s);
    if (!st || !this.mayTake(s)) return;
    const n = all ? st.count : 1;
    this.inv.emit('drop', withCount(st, n));
    st.count -= n;
    this.setStack(s, st.count ? st : null);
    if (s.output) this.tookOutput(s, n);
  }
  // closing: what was on the mouse and in the crafting grid goes back into the inventory
  onClose() {
    const inv = this.inv;
    if (inv.carried) { const c = inv.carried; inv.carried = null; inv.placeBack(c); }
    if (this.grid) for (let i = 0; i < this.grid.length; i++) if (this.grid[i]) { const c = this.grid[i]; this.grid[i] = null; inv.placeBack(c); }
    this.result = null;
    if (this.grid === inv.craft) inv.craftResult = null;
    this.drag = null;
    inv.changed();
  }

  /* ---- drawing ---- */
  // the in-game darkening the game puts behind container screens (no blur)
  drawBackdrop(g) { g.gradient(0, 0, this.width, this.height, 0xC0101010, 0xD0101010); }
  drawSlots(g, mx, my) {
    const prev = this.dragPreview();
    this.hover = this.slotAt(mx, my);
    for (const s of this.slots) {
      if (!this.slotShown(s)) continue;
      const st = this.slotStack(s);
      const pv = prev && prev.counts.get(s);
      if (pv) {
        drawStack(g, this.icons, withCount(this.inv.carried, pv.count), s.x, s.y, pv.capped ? '§e' + pv.count : pv.count > 1 ? String(pv.count) : '');
        g.fill(s.x, s.y, s.x + 16, s.y + 16, HIGHLIGHT);
        continue;
      }
      if (!st && s.outline !== undefined) drawOutline(g, s.outline, s.x, s.y);
      if (st) drawStack(g, this.icons, st, s.x, s.y);
      if (s === this.hover) g.fill(s.x, s.y, s.x + 16, s.y + 16, HIGHLIGHT);
    }
    if (this.hover && !this.inv.carried) {
      const st = this.slotStack(this.hover);
      if (st) g.setTooltip(this.tooltipFor(st, this.hover));
    }
    // something shining in the screen: keep drawing it while it moves
    if (GLINT.seen) { GLINT.seen = false; glintAgain(g); }
    return prev;
  }
  slotStack(s) { return this.getStack(s); }
  tooltipFor(st) { return stackTooltip(st, this.advancedTips, this.inv.mode === 'creative'); }
  get advancedTips() { return !!(this.gui && this.gui.options && this.gui.options.get('advancedTooltips')); }
  // the stack on the mouse, over everything
  drawCarried(g, mx, my, prev) {
    const c = this.inv.carried;
    if (!c || mx < 0) return;
    if (prev) drawStack(g, this.icons, c, mx - 8, my - 8, prev.left === 0 ? '§e0' : prev.left > 1 ? String(prev.left) : '');
    else drawStack(g, this.icons, c, mx - 8, my - 8);
    if (GLINT.seen) { GLINT.seen = false; glintAgain(g); }
  }
}

/* ------------------------------ survival inventory ------------------------------ */

export class InventoryScreen extends ContainerScreen {
  constructor(inv, icons) { super(inv, icons, 176, 166); this.title = 'Crafting'; this.grid = inv.craft; this.gridW = 2; }
  // the recipe book (ui/recipebook.js); its button sits at the game's place
  init() {
    super.init();
    if (!this.book) this.book = new RecipeBook(this, SearchField, (L, T, H) => [L + 104, Math.floor(H / 2) - 22]);
    this.book.layout();
  }
  extraClick(mx, my, button) { return this.book ? this.book.mouse(mx, my, button, press.shift) : false; }
  slotShown() { return !(this.book && this.book.covers()); }
  keyPressed(e) { const k = this.book ? this.book.key(e) : null; return k === null ? super.keyPressed(e) : k; }
  onClose() { if (this.book) this.book.close(); super.onClose(); }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    out.push(slot(L + 154, T + 28, 'result'));
    for (let i = 0; i < 4; i++) out.push(slot(L + 98 + (i % 2) * 18, T + 18 + (i >> 1) * 18, 'craft', i));
    for (let i = 0; i < 4; i++) out.push(slot(L + 8, T + 8 + i * 18, 'armor', i, { outline: i }));
    for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + 84 + Math.floor((j - 9) / 9) * 18, 'inv', j));
    for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + 142, 'inv', i));
    out.push(slot(L + 77, T + 62, 'offhand', 0, { outline: 4 }));
    return out;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    const book = this.book;
    // a screen too narrow for both: the book alone
    if (book.covers()) { book.render(g, mx, my); book.drawButton(g, mx, my); this.drawCarried(g, mx, my, null); return; }
    book.render(g, mx, my);
    g.blit('container/inventory', 0, 0, 176, 166, L, T);
    book.drawButton(g, mx, my);
    if (this.inv.drawPlayer) this.inv.drawPlayer(g, L + 26, T + 8, 49, 70, mx, my);
    g.text(this.title, L + 97, T + 8, LABEL_GREY, false);
    this.drawEffects(g, mx, my);
    const prev = this.drawSlots(g, mx, my);
    book.drawGhost(g);
    this.drawCarried(g, mx, my, prev);
  }
  /* The effects on you, down the right of the panel as the game lists them:
     shortest first, a dark box each 33 apart (closer with more than five),
     120 across with the name and time left when there is room, else 32 with
     just the picture and the name in a tooltip. Redrawn while any are on, for
     their clocks. (The HUD's own list: gui.hud.effects.) */
  // whether the effects are listed down the side now (the HUD leaves its own off then, as the game does)
  listsEffects() {
    const e = this.gui && this.gui.hud && this.gui.hud.effects;
    if (!e || this.width - (this.left + 176 + 2) < 32) return false;
    for (const n in e) { const d = EFFECTS[n]; if (d && !d.instant && !e[n].hidden) return true; }
    return false;
  }
  drawEffects(g, mx, my) {
    const e = g.hud && g.hud.effects, list = [];
    if (e) for (const n in e) { const d = EFFECTS[n]; if (d && !d.instant && !e[n].hidden) list.push(n); }
    const x = this.left + 176 + 2, room = this.width - x;
    if (!list.length || room < 32) return;
    // the clocks count down: drawn again four times a second while the list shows
    if (!this._fxT) this._fxT = setTimeout(() => { this._fxT = 0; g.markDirty(); }, 250);
    const wide = room >= 120, step = list.length > 5 ? Math.floor(132 / (list.length - 1)) : 33;
    const key = n => { const v = e[n]; return [v.ambient ? 1 : 0, v.ticks < 0 ? 1 : 0, v.ticks < 0 ? 0 : v.ticks, EFFECTS[n].colour]; };
    list.sort((a, b) => { const p = key(a), q = key(b); for (let i = 0; i < 4; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
    const img = g.sheet(EFFECT_SHEET);
    let y = this.top;
    for (const n of list) {
      const v = e[n], w = wide ? 120 : 32;
      // the box: a black rim with round corners, a grey (or, from a beacon, teal) band, dark inside
      const [rim, band] = v.ambient ? [0xFF005454, 0xFF00A8A8] : [0xFF000000, 0xFF555555];
      g.fill(x + 1, y, x + w - 1, y + 32, rim); g.fill(x, y + 1, x + w, y + 31, rim);
      g.fill(x + 1, y + 1, x + w - 1, y + 31, band);
      g.fill(x + 3, y + 3, x + w - 3, y + 29, 0xFF212121);
      const ic = EFFECT_ICON[n];
      if (img && ic !== undefined) g.blit(img, (ic % 8) * 18, Math.floor(ic / 8) * 18, 18, 18, x + (wide ? 6 : 7), y + 7);
      if (wide) {
        g.text(effectName(n, v.level), x + 28, y + 6, 0xFFFFFF);
        g.text(effectTime(v.ticks), x + 28, y + 16, 0x7F7F7F);
      } else if (mx >= x && mx < x + w && my >= y && my < y + step) g.setTooltip([effectName(n, v.level), effectTime(v.ticks)]);
      y += step;
    }
  }
}

/* ------------------------------ creative inventory ------------------------------ */

// the creative search box: no frame of its own (the sheet has one), white text
export { press };
export class SearchField extends TextField {
  draw(g) {
    const { x, y, w } = this;
    this.gui = g;
    const f = g.font;
    if (this.cursor < this.first) this.first = this.cursor;
    while (this.first < this.cursor && f.width(this.value.slice(this.first, this.cursor)) > w) this.first++;
    const shown = f.trim(this.value.slice(this.first), w);
    g.text(shown, x, y, WHITE);
    const cx = x + f.width(this.value.slice(this.first, this.cursor));
    if (this.selEnd !== this.cursor) {
      const s0 = Math.max(this.first, Math.min(this.cursor, this.selEnd)), s1 = Math.min(this.first + shown.length, Math.max(this.cursor, this.selEnd));
      if (s1 > s0) {
        const a = x + f.width(this.value.slice(this.first, s0)), b = x + f.width(this.value.slice(this.first, s1));
        g.ctx.globalCompositeOperation = 'difference';
        g.fill(a, y - 1, b, y + 9, 0xFFFFFFFF);
        g.ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (this.focused && (((g.now - this.focusTime) / 300 | 0) & 1) === 0) {
      if (this.cursor < this.value.length || this.value.length >= this.maxLength) g.fill(cx, y - 1, cx + 1, y + 9, 0xFFD0D0D0);
      else g.text('_', cx, y, WHITE);
    }
  }
  mouseClicked(mx, my) {
    if (!this.visible || !this.isMouseOver(mx, my)) return false;
    const g = this.gui;
    if (g) {
      const f = g.font, rel = mx - this.x;
      let i = this.first;
      while (i < this.value.length && f.width(this.value.slice(this.first, i + 1)) <= rel) i++;
      this.cursor = this.selEnd = i;
      g.focusText(this);
      try { g.input.setSelectionRange(i, i); } catch (e) { /* hidden */ }
      this.focusTime = performance.now();
    }
    return true;
  }
}

export class CreativeInventoryScreen extends ContainerScreen {
  constructor(inv, icons) {
    super(inv, icons, 195, 136);
    this.tab = lastTab;
    this.scroll = 0;
    this.scrolling = false;
    this.items = [];
    this.search = new SearchField(0, 0, 88, 9, { maxLength: 50, onChange: () => this.refresh() });
    this.pressTab = -1;
  }
  get T() { return TABS[this.tab]; }
  init() {
    super.init();
    this.search.x = this.left + 82; this.search.y = this.top + 6;
    this.search.gui = this.gui;
    this.refresh(true);
    if (this.T.search) this.gui.focusText(this.search);
  }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    // the item grid and hotbar of the block tabs
    for (let i = 0; i < 45; i++) out.push(slot(L + 9 + (i % 9) * 18, T + 18 + Math.floor(i / 9) * 18, 'grid', i, { tab: 'items' }));
    for (let i = 0; i < 9; i++) out.push(slot(L + 9 + i * 18, T + 112, 'inv', i, { tab: 'any' }));
    // the Survival Inventory tab
    for (let k = 0; k < 4; k++) out.push(slot(L + 54 + (k >> 1) * 54, T + 6 + (k & 1) * 27, 'armor', k, { tab: 'inv', outline: k }));
    out.push(slot(L + 35, T + 20, 'offhand', 0, { tab: 'inv', outline: 4 }));
    for (let j = 9; j < 36; j++) out.push(slot(L + 9 + (j % 9) * 18, T + 54 + Math.floor((j - 9) / 9) * 18, 'inv', j, { tab: 'inv' }));
    out.push(slot(L + 173, T + 112, 'destroy', 0, { tab: 'inv' }));
    return out;
  }
  slotShown(s) {
    if (s.tab === 'any') return true;
    return this.T.inventory ? s.tab === 'inv' : s.tab === 'items';
  }

  /* ---- the tab's items and scrolling ---- */
  refresh(keepScroll) {
    const all = creativeItems();
    const t = this.T;
    if (t.search) {
      const q = this.search.value.trim().toLowerCase();
      this.items = q ? all.all.filter(e => {
        const id = entryId(e), n = ITEMS[id] ? ITEMS[id].name : BLOCKS[id].name;
        return entryName(e).toLowerCase().indexOf(q) >= 0 || n.replace(/_/g, ' ').indexOf(q) >= 0 || n.indexOf(q) >= 0;
      }) : all.all;
    } else if (t.inventory) this.items = [];
    else this.items = all[t.key] || [];
    if (!keepScroll) this.scroll = 0;
    if (this.gui) this.gui.markDirty();
  }
  get rows() { return Math.ceil(this.items.length / 9); }
  canScroll() { return !this.T.inventory && this.rows > 5; }
  rowOffset() { const extra = this.rows - 5; return extra > 0 ? Math.max(0, Math.floor(this.scroll * extra + 0.5)) : 0; }
  gridItem(i) { const k = this.rowOffset() * 9 + i; return k < this.items.length ? this.items[k] : 0; }
  slotStack(s) {
    if (s.kind === 'grid') { const e = this.gridItem(s.i); return e ? entryStack(e, 1) : null; }
    return this.getStack(s);
  }
  getStack(s) { return s.kind === 'grid' ? this.slotStack(s) : super.getStack(s); }
  mouseScrolled(mx, my, d) {
    if (!this.canScroll()) return false;
    this.scroll = Math.max(0, Math.min(1, this.scroll - d / (this.rows - 5)));
    return true;
  }
  inScrollbar(mx, my) {
    const x0 = this.left + 175, y0 = this.top + 18;
    return mx >= x0 && my >= y0 && mx < x0 + 14 && my < y0 + 112;
  }
  scrollTo(my) {
    const y0 = this.top + 18, y1 = y0 + 112;
    this.scroll = Math.max(0, Math.min(1, (my - y0 - 7.5) / (y1 - y0 - 15)));
  }

  /* ---- tabs ---- */
  tabX(t) { return this.left + (t.right ? this.imageWidth - 28 * (6 - t.col) : 28 * t.col + t.col); }
  tabY(t) { return t.top ? this.top - 28 : this.top + this.imageHeight - 4; }
  tabAt(mx, my) {
    for (let i = 0; i < TABS.length; i++) {
      const t = TABS[i], x = this.tabX(t), y = this.tabY(t);
      if (mx >= x && mx <= x + 28 && my >= y && my <= y + 32) return i;
    }
    return -1;
  }
  selectTab(i) {
    if (i === this.tab) return;
    const g = this.gui;
    const was = this.T;
    this.tab = lastTab = i;
    this.drag = null;
    if (was.search && g.textFocus === this.search) g._blurText();
    if (this.T.search) { this.search.setValue(''); g.focusText(this.search); }
    this.refresh();
  }
  isOutside(mx, my) { return super.isOutside(mx, my) && this.tabAt(mx, my) < 0; }

  /* ---- clicks ---- */
  extraClick(mx, my, button) {
    const ti = this.tabAt(mx, my);
    if (ti >= 0) { this.pressTab = ti; return this.keepFocus(); }
    this.pressTab = -1;
    if (button === 0 && this.canScroll() && this.inScrollbar(mx, my)) { this.scrolling = true; this.scrollTo(my); return this.keepFocus(); }
    if (this.T.search && this.search.mouseClicked(mx, my, button)) return this.search;
    return false;
  }
  // on the search tab the box keeps the focus, whatever is clicked, as in the game
  keepFocus() { return this.T.search ? this.search : true; }
  gridClick(s, button, shift) {
    const e = this.gridItem(s.i), id = entryId(e), c = this.inv.carried;
    const max = id ? maxStack(id) : 64;
    if (button === 1) { if (!c && id) this.setCarried(entryStack(e, max)); return; }
    if (c && id && sameItem(c, entryStack(e, 1))) {
      if (button === 0) { if (shift) c.count = max; else if (c.count < max) c.count++; }
      else { c.count--; if (!c.count) this.setCarried(null); }
    } else if (id && !c) {
      if (shift) {
        // a full stack straight into the hotbar: onto the same item, else the first empty slot
        const hot = this.inv.slots;
        let at = -1;
        for (let i = 0; i < 9 && at < 0; i++) if (hot[i] && sameItem(hot[i], entryStack(e, 1))) at = i;
        for (let i = 0; i < 9 && at < 0; i++) if (!hot[i]) at = i;
        if (at >= 0) hot[at] = entryStack(e, max);
        else this.setCarried(entryStack(e, max));
      } else this.setCarried(entryStack(e, 1));
    } else if (button === 0) this.setCarried(null);        // clicking the grid with something else throws it away
    else if (c) { c.count--; if (!c.count) this.setCarried(null); }
  }
  shiftClick(s) {
    // on an item tab, shift-clicking the hotbar row clears that slot, as in the game
    if (!this.T.inventory && s.kind === 'inv') { this.setStack(s, null); return; }
    this.quickMove(s);
  }
  destroyClick(shift) {
    if (shift) { const inv = this.inv; inv.slots.fill(null); inv.armor.fill(null); inv.offhand = null; return; }
    this.setCarried(null);
  }
  numberKey(s, n) {
    if (s.kind === 'grid') { const e = this.gridItem(s.i); if (e) this.inv.slots[n] = entryStack(e, maxStack(entryId(e))); return; }
    super.numberKey(s, n);
  }
  mouseDragged(mx, my, button) {
    if (this.scrolling) { this.scrollTo(my); return; }
    super.mouseDragged(mx, my, button);
  }
  mouseReleased(mx, my, button) {
    if (this.scrolling) { this.scrolling = false; return; }
    if (this.pressTab >= 0) {
      const ti = this.tabAt(mx, my);
      if (ti === this.pressTab) this.selectTab(ti);
      this.pressTab = -1;
      return;
    }
    super.mouseReleased(mx, my, button);
  }
  keyPressed(e) {
    if (e.key === 'Escape') { this.gui.back(); return true; }
    // the search box takes every key while it has the focus
    if (this.T.search && this.gui.textFocus === this.search) return false;
    // T (the chat key) jumps to the search tab
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey) { this.selectTab(TABS.findIndex(t => t.search)); return true; }
    return super.keyPressed(e);
  }
  tooltipFor(st, s) {
    const lines = stackTooltip(st, this.advancedTips, true);
    if (s && s.kind === 'grid' && this.T.search) {
      const k = creativeItems().tabOf.get(st.id);
      const t = TABS.find(x => x.key === k);
      if (t) lines.push('§9' + t.name);
    }
    return lines;
  }
  onClose() { super.onClose(); if (this.gui && this.gui.textFocus === this.search) this.gui._blurText(); }

  /* ---- drawing ---- */
  drawTab(g, i, mx, my) {
    const t = TABS[i], sel = i === this.tab;
    const x = this.tabX(t), y = this.tabY(t);
    const sy = t.top ? (sel ? 32 : 0) : (sel ? 96 : 64);
    g.blit('container/creative_inventory/tabs', t.col * 28, sy, 28, 32, x, y);
    this.icons.draw(g, tabIconId(t), x + 6, y + 8 + (t.top ? 1 : -1));
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top, t = this.T;
    for (let i = 0; i < TABS.length; i++) if (i !== this.tab) this.drawTab(g, i, mx, my);
    const sheet = t.inventory ? 'tab_inventory' : t.search ? 'tab_item_search' : 'tab_items';
    g.blit('container/creative_inventory/' + sheet, 0, 0, 195, 136, L, T);
    if (t.search) this.search.draw(g);
    if (!t.inventory) {
      const can = this.canScroll();
      g.blit('container/creative_inventory/tabs', can ? 232 : 244, 0, 12, 15, L + 175, T + 18 + Math.floor(95 * (can ? this.scroll : 0)));
    }
    this.drawTab(g, this.tab, mx, my);
    if (!t.inventory) g.text(t.name, L + 8, T + 6, LABEL_GREY, false);
    else if (this.inv.drawPlayer) this.inv.drawPlayer(g, L + 73, T + 6, 32, 43, mx, my);
    const prev = this.drawSlots(g, mx, my);
    if (this.hover && this.hover.kind === 'destroy' && !this.inv.carried) g.setTooltip(['Destroy Item']);
    // a tab under the pointer names itself
    const ti = this.tabAt(mx, my);
    if (ti >= 0 && !this.inv.carried) g.setTooltip([TABS[ti].name]);
    this.drawCarried(g, mx, my, prev);
  }
}

// the inventory screen for the inventory's mode: creative tabs or the survival one
export function inventoryScreen(inv, icons) {
  return inv.mode === 'creative' ? new CreativeInventoryScreen(inv, icons) : new InventoryScreen(inv, icons);
}
