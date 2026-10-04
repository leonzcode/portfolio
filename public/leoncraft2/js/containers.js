/* ---------------------------------------------------------------------------
   Leoncraft 2 - blocks that hold things: chests, barrels, furnaces.

   Each one's contents live here by block position, saved with the world
   (save.js), spilled onto the ground when the block is broken.

     chest, trapped chest   27 slots; two side by side, facing the same way,
                            open together as one of 54
     barrel                 27 slots
     furnace                input, fuel, output; 200 ticks an item
     smoker                 food only, twice as fast (fuel too burns twice as fast)
     blast furnace          ores, raw metal and metal tools and armour, twice as fast
     shulker box, dispenser, dropper, hopper: their slots (no machinery)

   A furnace (the Minecraft Wiki, Furnace and Smelting): with something it
   can smelt and room in the output, it burns a fuel item (its burn time,
   halved in a smoker or blast furnace) and cooks; a finished item goes to
   the output and its experience is kept until the output is taken; without
   fuel the progress runs back two ticks a tick. A lava bucket leaves its
   bucket in the fuel slot.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from './blocks.js?v=8';
import { I, ITEMS, fuelTicks, maxStack, sameItem, withCount, stackToJSON, stackFromJSON } from './items.js?v=8';

export const SIZES = { chest: 27, trapped_chest: 27, barrel: 27, furnace: 3, smoker: 3, blast_furnace: 3, dispenser: 9, dropper: 9, hopper: 5 };
const isShulker = n => /shulker_box$/.test(n);
// the kind of container a block is, or null
export function containerKind(b) {
  const d = BLOCKS[b];
  if (!d) return null;
  if (SIZES[d.name]) return d.name;
  if (isShulker(d.name)) return 'shulker_box';
  return null;
}
export function isWorkstation(b) { const d = BLOCKS[b]; return !!d && d.name === 'crafting_table'; }

/* ---- smelting, from the wiki's Smelting page: input -> [output, experience, where] ----
   where: 'f' furnace only, 's' furnace and smoker (food), 'b' furnace and blast furnace */
const SMELT = {};
const put = (names, out, xp, where) => { for (const n of names) SMELT[n] = [out, xp, where]; };
put(['beef'], 'cooked_beef', 0.35, 's'); put(['porkchop'], 'cooked_porkchop', 0.35, 's'); put(['chicken'], 'cooked_chicken', 0.35, 's');
put(['mutton'], 'cooked_mutton', 0.35, 's'); put(['rabbit'], 'cooked_rabbit', 0.35, 's'); put(['cod'], 'cooked_cod', 0.35, 's');
put(['salmon'], 'cooked_salmon', 0.35, 's'); put(['potato'], 'baked_potato', 0.35, 's'); put(['kelp'], 'dried_kelp', 0.1, 's');
put(['iron_ore', 'deepslate_iron_ore', 'raw_iron'], 'iron_ingot', 0.7, 'b');
put(['gold_ore', 'deepslate_gold_ore', 'raw_gold', 'nether_gold_ore'], 'gold_ingot', 1.0, 'b');
put(['copper_ore', 'deepslate_copper_ore', 'raw_copper'], 'copper_ingot', 0.7, 'b');
put(['diamond_ore', 'deepslate_diamond_ore'], 'diamond', 1.0, 'b');
put(['emerald_ore', 'deepslate_emerald_ore'], 'emerald', 1.0, 'b');
put(['lapis_ore', 'deepslate_lapis_ore'], 'lapis_lazuli', 0.2, 'b');
put(['redstone_ore', 'deepslate_redstone_ore'], 'redstone', 0.7, 'b');
put(['coal_ore', 'deepslate_coal_ore'], 'coal', 0.1, 'b');
put(['nether_quartz_ore'], 'quartz', 0.2, 'b');
put(['ancient_debris'], 'netherite_scrap', 2.0, 'b');
put(['iron_pickaxe', 'iron_shovel', 'iron_axe', 'iron_hoe', 'iron_sword', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'iron_horse_armor',
  'chainmail_helmet', 'chainmail_chestplate', 'chainmail_leggings', 'chainmail_boots', 'iron_spear'], 'iron_nugget', 0.1, 'b');
put(['golden_pickaxe', 'golden_shovel', 'golden_axe', 'golden_hoe', 'golden_sword', 'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots',
  'golden_horse_armor', 'golden_spear'], 'gold_nugget', 0.1, 'b');
put(['copper_pickaxe', 'copper_shovel', 'copper_axe', 'copper_hoe', 'copper_sword', 'copper_helmet', 'copper_chestplate', 'copper_leggings', 'copper_boots',
  'copper_horse_armor', 'copper_spear'], 'copper_nugget', 0.1, 'b');
put(['sand', 'red_sand'], 'glass', 0.1, 'f'); put(['cobblestone'], 'stone', 0.1, 'f'); put(['stone'], 'smooth_stone', 0.1, 'f');
put(['sandstone'], 'smooth_sandstone', 0.1, 'f'); put(['red_sandstone'], 'smooth_red_sandstone', 0.1, 'f'); put(['quartz_block'], 'smooth_quartz', 0.1, 'f');
put(['stone_bricks'], 'cracked_stone_bricks', 0.1, 'f'); put(['clay_ball'], 'brick', 0.3, 'f'); put(['clay'], 'terracotta', 0.35, 'f');
put(['netherrack'], 'nether_brick', 0.1, 'f'); put(['nether_bricks'], 'cracked_nether_bricks', 0.1, 'f'); put(['basalt'], 'smooth_basalt', 0.1, 'f');
put(['cobbled_deepslate'], 'deepslate', 0.1, 'f'); put(['deepslate_bricks'], 'cracked_deepslate_bricks', 0.1, 'f');
put(['deepslate_tiles'], 'cracked_deepslate_tiles', 0.1, 'f'); put(['polished_blackstone_bricks'], 'cracked_polished_blackstone_bricks', 0.1, 'f');
put(['cactus'], 'green_dye', 1.0, 'f'); put(['sea_pickle'], 'lime_dye', 0.1, 'f'); put(['wet_sponge'], 'sponge', 0.15, 'f');
put(['chorus_fruit'], 'popped_chorus_fruit', 0.1, 'f'); put(['resin_clump'], 'resin_brick', 0.1, 'f');
for (const c of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'])
  put([c + '_terracotta'], c + '_glazed_terracotta', 0.1, 'f');
// every log and wood that burns makes charcoal
for (const d of BLOCKS) if (d && /_(log|wood)$/.test(d.name) && !/^(crimson|warped)/.test(d.name) && !/^stripped_(crimson|warped)/.test(d.name)) put([d.name], 'charcoal', 0.15, 'f');

// what an item smelts into in this kind of furnace: [output id, xp] or null
export function smeltResult(id, kind) {
  const it = ITEMS[id];
  const r = it && SMELT[it.name];
  if (!r || I[r[0]] === undefined) return null;
  if (kind === 'smoker' && r[2] !== 's') return null;
  if (kind === 'blast_furnace' && r[2] !== 'b') return null;
  return [I[r[0]], r[1]];
}
const COOK_TIME = { furnace: 200, smoker: 100, blast_furnace: 100 };

export class Containers {
  constructor(world) {
    this.world = world;
    this.map = new Map();            // "x,y,z" -> { kind, slots, ...furnace }
    this.lit = new Set();            // furnaces that are doing something
    this.dirty = false;
  }
  key(x, y, z) { return x + ',' + y + ',' + z; }
  // the container at a position (made empty on first use), or null when the block holds nothing
  at(x, y, z) {
    const kind = containerKind(this.world.get(x, y, z));
    if (!kind) return null;
    const k = this.key(x, y, z);
    let c = this.map.get(k);
    if (!c || c.kind !== kind) {
      c = { kind, slots: new Array(SIZES[kind] || 27).fill(null), x, y, z };
      if (COOK_TIME[kind]) Object.assign(c, { burn: 0, burnMax: 0, cook: 0, cookMax: COOK_TIME[kind], xp: 0 });
      this.map.set(k, c);
    }
    return c;
  }
  peek(x, y, z) { return this.map.get(this.key(x, y, z)) || null; }
  // the chest beside this one that makes a double chest with it (same block, same facing, to its side)
  partner(x, y, z) {
    const w = this.world, b = w.get(x, y, z), d = BLOCKS[b];
    if (!d || (d.name !== 'chest' && d.name !== 'trapped_chest')) return null;
    const f = w.meta(x, y, z) & 3;
    const side = f === 0 || f === 2 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [dx, dz] of side) if (w.get(x + dx, y, z + dz) === b && (w.meta(x + dx, y, z + dz) & 3) === f) return [x + dx, y, z + dz];
    return null;
  }
  changed(c) {
    this.dirty = true;
    if (c && COOK_TIME[c.kind]) this.lit.add(c);
  }
  // the block is gone: what it held, to be dropped
  remove(x, y, z) {
    const k = this.key(x, y, z), c = this.map.get(k);
    if (!c) return [];
    this.map.delete(k);
    this.lit.delete(c);
    this.dirty = true;
    return c.slots.filter(Boolean);
  }

  /* ---- furnaces, once a tick ---- */
  tick() {
    for (const c of this.lit) {
      if (!this.map.has(this.key(c.x, c.y, c.z))) { this.lit.delete(c); continue; }
      if (!this.furnaceTick(c)) this.lit.delete(c);
    }
  }
  // returns true while it is still doing something
  furnaceTick(c) {
    const s = c.slots, wasBurning = c.burn > 0;
    if (c.burn > 0) c.burn--;
    const res = s[0] ? smeltResult(s[0].id, c.kind) : null;
    const fits = res && (!s[2] || (s[2].id === res[0] && !s[2].dmg && s[2].count < maxStack(res[0])));
    if (c.burn <= 0 && fits && s[1]) {
      const t = fuelTicks(s[1].id);
      if (t > 0) {
        c.burn = c.burnMax = c.kind === 'furnace' ? t : t / 2;
        const lava = ITEMS[s[1].id] && ITEMS[s[1].id].name === 'lava_bucket';
        s[1].count--;
        if (s[1].count <= 0) s[1] = lava ? { id: I.bucket, count: 1 } : null;
        this.dirty = true;
      }
    }
    if (c.burn > 0 && fits) {
      if (c.lastInput !== s[0].id) { c.lastInput = s[0].id; c.cook = 0; }
      c.cook++;
      if (c.cook >= c.cookMax) {
        c.cook = 0;
        if (s[2]) s[2].count++; else s[2] = { id: res[0], count: 1 };
        s[0].count--;
        if (s[0].count <= 0) s[0] = null;
        c.xp += res[1];
        this.dirty = true;
      }
    } else if (c.cook > 0) c.cook = Math.max(0, c.cook - 2);
    if (!fits) c.lastInput = s[0] ? s[0].id : 0;
    if (wasBurning !== c.burn > 0 && this.onLit) this.onLit(c, c.burn > 0);
    return c.burn > 0 || c.cook > 0 || (fits && !!s[1] && fuelTicks(s[1].id) > 0);
  }
  // experience owed for what was taken out of a furnace: the whole points, and the fraction by chance
  takeXp(c, count) {
    if (!c || !c.xp) return 0;
    const out = c.slots[2] ? c.slots[2].count + count : count;
    const per = c.xp / Math.max(1, out);
    let x = per * count;
    c.xp = Math.max(0, c.xp - x);
    let n = Math.floor(x);
    if (Math.random() < x - n) n++;
    this.dirty = true;
    return n;
  }

  /* ---- saving ---- */
  toJSON() {
    const out = [];
    for (const c of this.map.values()) {
      if (!c.slots.some(Boolean) && !c.xp) continue;
      const o = { k: c.kind, p: [c.x, c.y, c.z], s: c.slots.map(stackToJSON) };
      if (COOK_TIME[c.kind]) Object.assign(o, { b: c.burn, bm: c.burnMax, c: c.cook, x: +c.xp.toFixed(3) });
      out.push(o);
    }
    return out;
  }
  fromJSON(list) {
    this.map.clear(); this.lit.clear();
    if (!Array.isArray(list)) return;
    for (const o of list) {
      const [x, y, z] = o.p;
      const c = { kind: o.k, slots: (o.s || []).map(stackFromJSON), x, y, z };
      while (c.slots.length < (SIZES[o.k] || 27)) c.slots.push(null);
      if (COOK_TIME[o.k]) { Object.assign(c, { burn: o.b | 0, burnMax: o.bm | 0, cook: o.c | 0, cookMax: COOK_TIME[o.k], xp: o.x || 0 }); this.lit.add(c); }
      this.map.set(this.key(x, y, z), c);
    }
  }
}
