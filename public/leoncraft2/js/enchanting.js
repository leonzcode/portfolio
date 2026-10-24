/* ---------------------------------------------------------------------------
   Leoncraft 2 - enchanting, the anvil and the grindstone: the numbers.

   Enchanting table (Minecraft Wiki, Enchanting mechanics, Java Edition):
     each slot draws its own base:
       base = 1 + rand(0..7) + floor(min(15, shelves) / 2) + rand(0..min(15, shelves))
     slots: max(1, floor(base / 3)), floor(2 base / 3) + 1, max(base, 2 shelves)
            (a slot whose level is below its number is empty)
     cost  = round((slot + 1 + rand(0..e/4) + rand(0..e/4)) x (1 + 0.15 (rand + rand - 1)))
             (e: the item's enchantability)
     the first enchantment by weight among those that fit the item and have
     a level whose range holds the cost (the highest such level); then, while
     rand(0..49) <= cost, another (never one that clashes with those chosen),
     the cost halved each time. A book drops one of several. The hint is one
     of the list at random.
   The draws are java.util.Random's, seeded as the game seeds them (the
   player's enchantment seed for the levels, the seed plus the slot for each
   list), walking the enchantments in the game's order, so a seed gives the
   offers it gives in the game. Costs per level of each enchantment are the
   game's (min base + per level, max base + per level), from the wiki's
   tables. Some go only on some of the items that can carry them at the
   table: Sharpness, Smite, Bane of Arthropods and Fire Aspect on swords
   and spears (not axes or the mace), Thorns on chestplates.

   Anvil (Anvil mechanics): prior work 2^n - 1 for each item; combining two
   of a kind (anything with durability) adds their durability plus 12%;
   each enchantment brought over costs its level times its multiplier
   (common 1, uncommon 2, rare 4, very rare 8; half that, at least 1, from
   a book), each enchantment already on it that one clashes with costs 1,
   and if nothing could go on, nothing is made; a material repairs a
   quarter of the durability a unit for a level each; naming (or clearing
   a name) costs 1. 40 levels or more is Too Expensive, except a name
   alone, which is held at 39; a name alone does not add to the prior
   work. The anvil wears with chance 12%.

   Grindstone: takes off every enchantment but curses, joins two worn items
   of a kind (plus 5%), and pays back experience for what it took off: half
   the total of each enchantment's lowest cost (rounded up), plus up to as
   much again less one. What comes out keeps a prior work of 2^curses - 1.
--------------------------------------------------------------------------- */
import { ENCHANTS } from './itemdata.js?v=107';
import { ITEMS, I, maxDamage, withCount, displayName } from './items.js?v=107';
import { register, fail, int, self } from './commands.js?v=107';
import { LegacyRandom } from './gen/random.js?v=107';
import { BLOCKS } from './blocks.js?v=107';

/* min and max cost: [base, per level above the first] for each */
const COST = {
  aqua_affinity: [1, 0, 41, 0], bane_of_arthropods: [5, 8, 25, 8], binding_curse: [25, 0, 50, 0], blast_protection: [5, 8, 13, 8],
  breach: [15, 9, 65, 9], channeling: [25, 0, 50, 0], density: [5, 8, 25, 8], depth_strider: [10, 10, 25, 10], efficiency: [1, 10, 51, 10],
  feather_falling: [5, 6, 11, 6], fire_aspect: [10, 20, 60, 20], fire_protection: [10, 8, 18, 8], flame: [20, 0, 50, 0], fortune: [15, 9, 65, 9],
  frost_walker: [10, 10, 25, 10], impaling: [1, 8, 21, 8], infinity: [20, 0, 50, 0], knockback: [5, 20, 55, 20], looting: [15, 9, 65, 9],
  loyalty: [12, 7, 50, 0], luck_of_the_sea: [15, 9, 65, 9], lure: [15, 9, 65, 9], mending: [25, 25, 75, 25], multishot: [20, 0, 50, 0],
  piercing: [1, 10, 50, 0], power: [1, 10, 16, 10], projectile_protection: [3, 6, 9, 6], protection: [1, 11, 12, 11], punch: [12, 20, 37, 20],
  quick_charge: [12, 20, 50, 0], respiration: [10, 10, 40, 10], riptide: [17, 7, 50, 0], sharpness: [1, 11, 21, 11], silk_touch: [15, 0, 65, 0],
  smite: [5, 8, 25, 8], soul_speed: [10, 10, 25, 10], sweeping_edge: [5, 9, 20, 9], swift_sneak: [25, 25, 75, 25], thorns: [10, 20, 60, 20],
  unbreaking: [5, 8, 55, 8], vanishing_curse: [25, 0, 50, 0], wind_burst: [15, 9, 65, 9], lunge: [5, 8, 25, 8],
};
export const ENCH = {};
for (const e of ENCHANTS) {
  const [name, display, maxLevel, , , , , weight, treasure, curse, exclude, category, discoverable] = e;
  const c = COST[name] || [1, 10, 51, 10];
  ENCH[name] = { name, display, maxLevel, weight, treasure: !!treasure, curse: !!curse, exclude, category, discoverable: !!discoverable,
    min: l => c[0] + c[1] * (l - 1), max: l => c[2] + c[3] * (l - 1) };
}

/* ---- what can go on what ---- */
const ENCHANTABILITY = { leather: 15, chainmail: 12, iron_armor: 9, golden_armor: 25, diamond: 10, netherite: 15, turtle: 9, copper_armor: 8,
  wooden: 15, stone: 5, iron: 14, golden: 22, copper: 13 };
export function enchantability(id) {
  const it = ITEMS[id];
  if (!it) return 0;
  const n = it.name;
  if (n === 'book') return 1;
  if (/^(bow|crossbow|fishing_rod|trident)$/.test(n)) return 1;
  if (n === 'mace') return 15;
  if (it.armor && it.armor.material !== 'none') {
    const m = it.armor.material;
    return m === 'iron' ? 9 : m === 'golden' ? 25 : m === 'copper' ? 8 : ENCHANTABILITY[m] || 0;
  }
  if (it.tool && it.tool.kind !== 'shears') return ENCHANTABILITY[it.tool.material] || 0;
  return 0;
}
// the enchantment categories an item takes (minecraft-data's), and what the table offers it
function categories(id) { const it = ITEMS[id]; return it && it.ench ? it.ench : []; }
export function canApply(name, id) {
  const e = ENCH[name], it = ITEMS[id];
  if (!e || !it) return false;
  if (it.name === 'book' || it.name === 'enchanted_book') return true;
  return categories(id).indexOf(e.category) >= 0;
}
// the order the game keeps the table's enchantments in: its weighted draws walk them in it
export const ORDER = ['protection', 'fire_protection', 'feather_falling', 'blast_protection', 'projectile_protection', 'respiration', 'aqua_affinity', 'thorns',
  'depth_strider', 'sharpness', 'smite', 'bane_of_arthropods', 'knockback', 'fire_aspect', 'looting', 'sweeping_edge', 'efficiency', 'silk_touch', 'unbreaking',
  'fortune', 'power', 'punch', 'flame', 'infinity', 'luck_of_the_sea', 'lure', 'loyalty', 'impaling', 'riptide', 'channeling', 'multishot', 'quick_charge',
  'piercing', 'density', 'breach', 'lunge'];
// the items an enchantment is offered on at the table, where that is fewer than it can go on
const SWORDS_AND_SPEARS = id => { const n = ITEMS[id].name; return /_(sword|spear)$/.test(n); };
const PRIMARY = { sharpness: SWORDS_AND_SPEARS, smite: SWORDS_AND_SPEARS, bane_of_arthropods: SWORDS_AND_SPEARS, fire_aspect: SWORDS_AND_SPEARS,
  thorns: id => !!(ITEMS[id].armor && ITEMS[id].armor.slot === 1) };
// one of the item's primary enchantments (what the table and loot enchanted "with levels" choose from)
export function isPrimary(name, id) {
  if (!canApply(name, id)) return false;
  return !PRIMARY[name] || PRIMARY[name](id);
}
// offered by the table: the item's primary enchantments
function tableOffers(name, id) {
  const e = ENCH[name], it = ITEMS[id];
  if (!e || e.treasure || !e.discoverable) return false;
  if (it.name === 'book') return true;
  return isPrimary(name, id);
}
export function compatible(a, b) {
  if (a === b) return false;
  const ea = ENCH[a], eb = ENCH[b];
  return !(ea && ea.exclude.indexOf(b) >= 0) && !(eb && eb.exclude.indexOf(a) >= 0);
}

/* ---- the table ---- */
// the shelves round a table: two blocks out, on its level or one up, with the block half way
// letting the power through (air, or anything that is replaced by placing a block: grass, snow...)
export function countShelves(world, x, y, z, isShelf) {
  let n = 0;
  for (let oy = 0; oy <= 1; oy++) for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
    if (Math.abs(ox) !== 2 && Math.abs(oz) !== 2) continue;
    const mid = BLOCKS[world.get(x + Math.trunc(ox / 2), y + oy, z + Math.trunc(oz / 2))];
    if (mid && !mid.replaceable && !mid.fluid) continue;
    if (isShelf(world.get(x + ox, y + oy, z + oz))) n++;
  }
  return n;
}
/* The three offers for an item: [{ level (the level asked), ench: [[name, lvl]...], hint: [name, lvl] }]
   (null where the slot is empty). seed: the player's enchantment seed (an int). */
// the levels the three slots draw (before a slot below its number is emptied)
export function slotLevels(shelves, seed) {
  const r = new LegacyRandom(seed | 0);
  const b = Math.min(15, Math.max(0, shelves | 0));
  return [0, 1, 2].map(slot => {
    const base = r.nextInt(8) + 1 + (b >> 1) + r.nextInt(b + 1);
    return slot === 0 ? Math.max(Math.floor(base / 3), 1) : slot === 1 ? Math.floor(base * 2 / 3) + 1 : Math.max(base, b * 2);
  });
}
export function tableOffers3(id, shelves, seed) {
  const e = enchantability(id);
  if (!e) return [null, null, null];
  const levels = slotLevels(shelves, seed).map((lv, slot) => (lv < slot + 1 ? 0 : lv));
  return levels.map((lv, slot) => {
    if (!lv) return null;
    const lr = new LegacyRandom((seed + slot) | 0);
    const list = selectEnchants(id, lv, lr);
    if (ITEMS[id].name === 'book' && list.length > 1) list.splice(lr.nextInt(list.length), 1);
    return { level: lv, ench: list, hint: list.length ? list[lr.nextInt(list.length)] : null };
  });
}
// the enchantments for an item at a level (r: a java.util.Random); also what traded gear and loot are enchanted with
// (order: the list the game walks, the table's own unless a loot table names another)
export function selectEnchants(id, level, r, allow = tableOffers, order = ORDER) {
  const e = enchantability(id);
  if (!e) return [];
  const f = Math.fround;
  level += 1 + r.nextInt((e >> 2) + 1) + r.nextInt((e >> 2) + 1);
  const k = f(f(f(r.nextFloat() + r.nextFloat()) - 1) * f(0.15));
  let cost = Math.max(1, Math.floor(f(f(level + f(level * k)) + 0.5)));
  let list = [];
  for (const name of order) {
    const en = ENCH[name];
    if (!en || !allow(name, id)) continue;
    for (let l = en.maxLevel; l >= 1; l--) if (cost >= en.min(l) && cost <= en.max(l)) { list.push([name, l]); break; }
  }
  const pick = () => {
    let total = 0;
    for (const [n] of list) total += ENCH[n].weight;
    let j = r.nextInt(total);
    for (const x of list) { j -= ENCH[x[0]].weight; if (j < 0) return x; }
    return list[list.length - 1];
  };
  const out = [];
  if (!list.length) return out;
  out.push(pick());
  while (r.nextInt(50) <= cost) {
    const last = out[out.length - 1][0];
    list = list.filter(([n]) => compatible(n, last));
    if (!list.length) break;
    out.push(pick());
    cost = Math.floor(cost / 2);
  }
  return out;
}
// enchanting with levels (a villager's gear, loot): the enchantments as a stack carries them
export function enchantWithLevels(id, level, r) {
  const o = {};
  for (const [n, l] of selectEnchants(id, level, r)) o[n] = l;
  return o;
}

/* ---- the anvil ---- */
const mult = (name, fromBook) => { const w = ENCH[name] ? ENCH[name].weight : 10; const m = w >= 10 ? 1 : w >= 5 ? 2 : w >= 2 ? 4 : 8; return fromBook ? Math.max(1, m / 2) : m; };
/* left, right: stacks (right may be null); name: the text in the box (null or undefined: the
   name is not touched; blank: a name given before is taken off); hover: the name the left
   item shows now (its own name, or the item's). Returns { result (null when nothing can be
   made), cost (what the screen shows), used (how many of the right stack go), tooExpensive,
   onlyName } or null when there is no cost at all. */
export function anvilResult(left, right, name, creative, hover) {
  if (!left) return null;
  const L = ITEMS[left.id];
  if (!L) return null;
  const out = withCount(left, left.count);
  const ench = Object.assign({}, left.ench || {});
  let cost = 0, used = 0, nameCost = 0;
  const work = (left.rep | 0) + (right ? right.rep | 0 : 0);
  if (right) {
    const R = ITEMS[right.id];
    if (!R) return null;
    const max = maxDamage(left.id);
    const isBook = R.name === 'enchanted_book' && !!right.ench && Object.keys(right.ench).length > 0;
    if (max && L.repair && L.repair.indexOf(R.name) >= 0) {
      // repair with its material: a quarter of the durability a unit, a level each (nothing to mend: nothing made)
      let step = Math.min(left.dmg | 0, Math.floor(max / 4));
      if (step <= 0) return null;
      let dmg = left.dmg | 0, n = 0;
      while (step > 0 && n < right.count) { dmg -= step; cost++; n++; step = Math.min(dmg, Math.floor(max / 4)); }
      if (dmg) out.dmg = dmg; else delete out.dmg;
      used = n;
    } else {
      // two of a kind, if it wears; anything with an enchanted book
      if (!isBook && (right.id !== left.id || !max)) return null;
      if (max && !isBook) {
        // their durability together, plus 12%
        const keep = (max - (left.dmg | 0)) + (max - (right.dmg | 0)) + Math.floor(max * 12 / 100);
        const dmg = Math.max(0, max - keep);
        if (dmg < (left.dmg | 0)) { cost += 2; if (dmg) out.dmg = dmg; else delete out.dmg; }
      }
      let any = false, clash = false;
      for (const k in right.ench || {}) {
        const lv = right.ench[k], en = ENCH[k];
        if (!en) continue;
        const have = ench[k] | 0;
        let now = have === lv ? lv + 1 : Math.max(lv, have);
        let ok = creative || canApply(k, left.id) || L.name === 'enchanted_book';
        // each enchantment already there that this one clashes with costs a level
        for (const m in ench) if (m !== k && !compatible(k, m)) { ok = false; cost++; }
        if (!ok) { clash = true; continue; }
        any = true;
        now = Math.min(now, en.maxLevel);
        ench[k] = now;
        cost += now * mult(k, isBook);
        if (left.count > 1) cost = 40;
      }
      if (clash && !any) return null;
      used = right.count;
    }
  }
  if (name !== null && name !== undefined) {
    if (name.trim() !== '') {
      if (name !== (hover === undefined ? left.name || '' : hover)) { nameCost = 1; cost += 1; out.name = name; }
    } else if (left.name) { nameCost = 1; cost += 1; delete out.name; }
  }
  if (Object.keys(ench).length) out.ench = ench; else delete out.ench;
  let total = work + cost;
  const onlyName = nameCost > 0 && cost === nameCost;
  if (onlyName && total >= 40) total = 39;                  // a new name alone is never too expensive
  // the prior work goes up, unless only the name changed
  let rep = Math.max(left.rep | 0, right ? right.rep | 0 : 0);
  if (!onlyName) rep = rep * 2 + 1;
  if (rep) out.rep = rep; else delete out.rep;
  if (!total && !cost) return null;
  const tooExpensive = total >= 40 && !creative;
  return { result: cost > 0 && !tooExpensive ? out : null, cost: total, used, tooExpensive, onlyName };
}

/* ---- the grindstone ---- */
// what goes in: anything that wears, and anything enchanted (an enchanted book)
export function grindable(st) { return !!st && !!ITEMS[st.id] && (!!maxDamage(st.id) || hasEnchants(st)); }
// one or two items in (one of each at most): the result, and the experience it gives back
export function grindResult(a, b) {
  if (!a && !b) return null;
  if ((a && a.count > 1) || (b && b.count > 1)) return null;
  const one = a || b;
  let out;
  if (a && b) {
    // two of a kind that wear: their durability together, plus 5%; the curses of both
    const max = maxDamage(a.id);
    if (a.id !== b.id || !max) return null;
    out = withCount(a, 1);
    const keep = (max - (a.dmg | 0)) + (max - (b.dmg | 0)) + Math.floor(max * 5 / 100);
    const dmg = Math.max(0, max - keep);
    if (dmg) out.dmg = dmg; else delete out.dmg;
    out.ench = Object.assign({}, b.ench || {}, a.ench || {});
  } else {
    if (!hasEnchants(one)) return null;
    out = withCount(one, 1);
  }
  const curses = {};
  for (const k in out.ench || {}) if (ENCH[k] && ENCH[k].curse) curses[k] = out.ench[k];
  const n = Object.keys(curses).length;
  if (n) out.ench = curses; else delete out.ench;
  if (ITEMS[out.id].name === 'enchanted_book' && !n) out.id = I.book;
  // a prior work of 2^curses - 1
  let rep = 0;
  for (let i = 0; i < n; i++) rep = rep * 2 + 1;
  if (rep) out.rep = rep; else delete out.rep;
  return { result: out, xp: grindXp(a, b) };
}
// the experience: half the total of each enchantment's lowest cost, rounded up, plus 0 to one less than that
function grindXp(a, b) {
  let points = 0;
  for (const s of [a, b]) {
    if (!s || !s.ench) continue;
    for (const k in s.ench) if (ENCH[k] && !ENCH[k].curse) points += ENCH[k].min(s.ench[k]);
  }
  if (points <= 0) return 0;
  const half = Math.ceil(points / 2);
  return half + Math.floor(Math.random() * half);
}
function hasEnchants(s) { return !!(s && s.ench && Object.keys(s.ench).length); }

export function enchName(k, lv) {
  const R = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const e = ENCH[k];
  const n = e ? e.display : k;
  return e && e.maxLevel === 1 ? n : n + ' ' + (R[lv] || lv);
}

/* ---- /enchant <targets> <enchantment> [level]: on the held item, as the game's command does it:
   refused for an item that cannot carry it or that carries one it clashes with (the same one
   included), and above the enchantment's highest level ---- */
register('enchant', {
  usage: '<targets> <enchantment> [level]',
  suggest: (i, w) => i === 0 ? ['@s'] : i === 1 ? Object.keys(ENCH).sort().map(n => 'minecraft:' + n).filter(n => n.indexOf((w[1] || '').replace(/^minecraft:/, '')) >= 0) : ['1'],
  run(args, ctx) {
    if (args.length < 2) fail('Incomplete command');
    self(args[0], ctx);
    const name = args[1].replace(/^minecraft:/, ''), e = ENCH[name];
    if (!e) fail(`Can't find element 'minecraft:${name}' of type 'minecraft:enchantment'`);
    const lv = args[2] === undefined ? 1 : int(args[2], 0);
    if (lv > e.maxLevel) fail(`${lv} is higher than the maximum level of ${e.maxLevel} supported by that enchantment`);
    const inv = ctx.game.inv, st = inv ? inv.slots[inv.selected] : null;
    if (!st) fail(`${ctx.playerName} is not holding any item`);
    const it = ITEMS[st.id];
    if (!it || (it.ench || []).indexOf(e.category) < 0 || Object.keys(st.ench || {}).some(k => !compatible(k, name))) fail(`${displayName(st.id)} cannot support that enchantment`);
    if (lv > 0) { st.ench = Object.assign({}, st.ench); st.ench[name] = lv; }
    inv.changed();
    ctx.say(`Applied enchantment ${enchName(name, lv)} to ${ctx.playerName}'s item`);
  },
});

/* ---- for tests (window.__lc2.enchanting): the table, the anvil and the levels, by name ---- */
export function enchantDebug(game) {
  const sv = game.survival, inv = game.inv;
  const stackOf = o => o ? { id: I[o.item], count: o.count || 1, dmg: o.damage || 0, rep: o.work ? (1 << o.work) - 1 : 0, ench: o.enchants ? Object.assign({}, o.enchants) : undefined } : null;
  return {
    // the three offers for an item (an iron sword) with this many shelves and this seed
    // (level is what the slot drew; an empty slot, one whose level is below its number, says so)
    offers: (shelves, seed, item = 'iron_sword') => {
      const drawn = slotLevels(shelves, seed);
      return tableOffers3(I[item], shelves, seed).map((o, i) => o ? { level: o.level, ench: o.ench, hint: o.hint } : { level: drawn[i], empty: true });
    },
    // take slot n (1-3) for the held item (an iron sword if the hand holds nothing to enchant), as the screen does
    apply(slot, shelves) {
      const held = inv.slots[inv.selected];
      const item = held && enchantability(held.id) && !held.ench ? held : { id: I.iron_sword, count: 1 };
      const o = tableOffers3(item.id, shelves, sv.enchantSeed)[slot - 1];
      let lapis = 0;
      for (const s of inv.slots) if (s && s.id === I.lapis_lazuli) lapis += s.count;
      if (!o || !o.ench.length || lapis < slot || (sv.level < o.level && inv.mode !== 'creative')) return false;
      let left = slot;
      for (let i = 0; i < inv.slots.length && left; i++) {
        const s = inv.slots[i];
        if (!s || s.id !== I.lapis_lazuli) continue;
        const n = Math.min(left, s.count); s.count -= n; left -= n;
        if (!s.count) inv.slots[i] = null;
      }
      sv.addLevels(-slot);
      sv.enchantSeed = (Math.random() * 2147483647) | 0;
      item.ench = {};
      for (const [k, lv] of o.ench) item.ench[k] = lv;
      inv.changed();
      return item.ench;
    },
    anvil: {
      // left, right: { item, count, damage, work (anvil uses so far), enchants }; rename: a new name
      cost(left, right, rename) {
        const L = stackOf(left), Rt = stackOf(right);
        const c = anvilResult(L, Rt, rename === undefined ? null : rename, false);
        if (!c) return null;
        const work = (L.rep | 0) + (Rt ? Rt.rep | 0 : 0);
        return { cost: c.cost, base: c.cost - work, penalty: work, allowed: !!c.result, result: c.result };
      },
    },
    maxLevels: name => (ENCH[name] ? ENCH[name].maxLevel : 0),
    grind: (a, b) => grindResult(stackOf(a), stackOf(b)),
  };
}
