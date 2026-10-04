/* ---------------------------------------------------------------------------
   Leoncraft 2 - enchanting, the anvil and the grindstone: the numbers.

   Enchanting table (Minecraft Wiki, Enchanting mechanics, Java Edition):
     base = 1 + rand(0..7) + floor(min(15, shelves) / 2) + rand(0..min(15, shelves))
     slots: max(1, floor(base / 3)), floor(2 base / 3) + 1, max(base, 2 shelves)
     cost  = round((slot + 1 + rand(0..e/4) + rand(0..e/4)) x (1 + 0.15 (rand + rand - 1)))
             (e: the item's enchantability)
     the first enchantment by weight among those that fit the item and have
     a level whose range holds the cost (the highest such level); then, while
     a chance of (cost + 1) / 50 holds, another (never one that clashes with
     those chosen), the cost halved each time. A book drops one of several.
   Costs per level of each enchantment are the game's (min base + per level,
   max base + per level), from the wiki's tables.

   Anvil (Anvil mechanics): prior work 2^n - 1 for each item; combining two
   of a kind adds their durability plus 12%; each enchantment brought over
   costs its level times its multiplier (common 1, uncommon 2, rare 4, very
   rare 8; half that from a book), one that clashes costs 1; a material
   repairs a quarter of the durability a unit for a level each; naming costs
   1. 40 levels or more is Too Expensive. The anvil wears with chance 12%.

   Grindstone: takes off every enchantment but curses, joins two worn items
   of a kind (plus 5%), and pays back experience for what it took off.
--------------------------------------------------------------------------- */
import { ENCHANTS } from './itemdata.js?v=10';
import { ITEMS, I, maxDamage } from './items.js?v=10';

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
// offered by the table: the item's primary enchantments (axes get no sword enchantments there)
function tableOffers(name, id) {
  const e = ENCH[name], it = ITEMS[id];
  if (!e || e.treasure || !e.discoverable) return false;
  if (it.name === 'book') return true;
  if (!canApply(name, id)) return false;
  if (it.tool && it.tool.kind === 'axe' && /weapon|fire_aspect|sweeping/.test(e.category)) return false;
  return true;
}
export function compatible(a, b) {
  if (a === b) return false;
  const ea = ENCH[a], eb = ENCH[b];
  return !(ea && ea.exclude.indexOf(b) >= 0) && !(eb && eb.exclude.indexOf(a) >= 0);
}

/* ---- the table ---- */
// a small seeded random (the player's enchantment seed keeps the offers until one is taken)
function rng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return { f: next, i: n => Math.floor(next() * n) };
}
// the shelves round a table: two blocks out, on its level or one up, with air between
export function countShelves(world, x, y, z, isShelf) {
  let n = 0;
  for (let oy = 0; oy <= 1; oy++) for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
    if (Math.abs(ox) !== 2 && Math.abs(oz) !== 2) continue;
    // the block half way must let the power through (air)
    if (world.get(x + Math.trunc(ox / 2), y + oy, z + Math.trunc(oz / 2))) continue;
    if (isShelf(world.get(x + ox, y + oy, z + oz))) n++;
  }
  return n;
}
/* The three offers for an item: [{ level (the level asked), ench: [[name, lvl]...], hint: [name, lvl] }]
   (null where there is nothing). */
export function tableOffers3(id, shelves, seed) {
  const e = enchantability(id);
  if (!e) return [null, null, null];
  const r = rng(seed);
  const b = Math.min(15, shelves);
  const base = 1 + r.i(8) + Math.floor(b / 2) + r.i(b + 1);
  const levels = [Math.max(1, Math.floor(base / 3)), Math.floor(base * 2 / 3) + 1, Math.max(base, b * 2)];
  return levels.map((lv, slot) => {
    if (lv < slot + 1) return null;
    const list = selectEnchants(id, lv, rng(seed + slot * 7919 + 1));
    return list.length ? { level: lv, ench: list, hint: list[Math.floor(rng(seed + slot).f() * list.length)] } : null;
  });
}
function selectEnchants(id, level, r) {
  const e = enchantability(id);
  let cost = level + 1 + r.i(Math.floor(e / 4) + 1) + r.i(Math.floor(e / 4) + 1);
  cost = Math.max(1, Math.round(cost * (1 + (r.f() + r.f() - 1) * 0.15)));
  const avail = c => {
    const out = [];
    for (const name in ENCH) {
      if (!tableOffers(name, id)) continue;
      const en = ENCH[name];
      for (let l = en.maxLevel; l >= 1; l--) if (c >= en.min(l) && c <= en.max(l)) { out.push([name, l]); break; }
    }
    return out;
  };
  const pick = list => {
    let total = 0;
    for (const [n] of list) total += ENCH[n].weight;
    let k = r.f() * total;
    for (const x of list) { k -= ENCH[x[0]].weight; if (k < 0) return x; }
    return list[list.length - 1];
  };
  let list = avail(cost);
  const out = [];
  if (!list.length) return out;
  out.push(pick(list));
  while (r.f() * 50 < cost + 1) {
    list = list.filter(([n]) => out.every(([m]) => compatible(n, m)));
    if (!list.length) break;
    out.push(pick(list));
    cost = Math.floor(cost / 2);
  }
  if (ITEMS[id].name === 'book' && out.length > 1) out.splice(Math.floor(r.f() * out.length), 1);
  return out;
}

/* ---- the anvil ---- */
const mult = (name, fromBook) => { const w = ENCH[name] ? ENCH[name].weight : 10; const m = w >= 10 ? 1 : w >= 5 ? 2 : w >= 2 ? 4 : 8; return fromBook ? Math.max(1, m / 2) : m; };
/* left, right: stacks (right may be null); name: the text in the box ('' = leave it).
   Returns { result, cost, used (how many of the right stack go), tooExpensive } or null. */
export function anvilResult(left, right, name, creative) {
  if (!left) return null;
  const L = ITEMS[left.id];
  const out = { id: left.id, count: left.count };
  if (left.dmg) out.dmg = left.dmg;
  const ench = Object.assign({}, left.ench || {});
  let cost = 0, used = 0, work = (left.rep | 0) + (right ? right.rep | 0 : 0);
  if (right) {
    const R = ITEMS[right.id];
    const max = maxDamage(left.id);
    const isBook = R.name === 'enchanted_book';
    // repair with its material: a quarter a unit
    if (max && left.dmg > 0 && L.repair && L.repair.indexOf(R.name) >= 0 && !(right.ench && Object.keys(right.ench).length)) {
      let dmg = left.dmg, n = 0;
      while (dmg > 0 && n < right.count) { dmg = Math.max(0, dmg - Math.floor(max / 4)); n++; cost++; }
      out.dmg = dmg; if (!dmg) delete out.dmg;
      used = n;
    } else {
      if (!isBook && right.id !== left.id) return null;
      // two of a kind: their durability together, plus 12%
      if (!isBook && max) {
        const keep = (max - (left.dmg | 0)) + (max - (right.dmg | 0)) + Math.floor(max * 12 / 100);
        const dmg = Math.max(0, max - keep);
        if (dmg < (left.dmg | 0)) cost += 2;
        if (dmg) out.dmg = dmg; else delete out.dmg;
      }
      let any = false, clash = false;
      for (const k in right.ench || {}) {
        const lv = right.ench[k], en = ENCH[k];
        if (!en) continue;
        const fits = creative || canApply(k, left.id) || L.name === 'enchanted_book';
        const ok = fits && Object.keys(ench).every(m => m === k || compatible(k, m));
        if (!ok) { clash = true; cost += 1; continue; }
        any = true;
        const have = ench[k] | 0;
        const now = have === lv ? Math.min(en.maxLevel, lv + 1) : Math.max(have, lv);
        ench[k] = now;
        cost += now * mult(k, isBook);
      }
      if (!any && clash && !(max && out.dmg !== left.dmg)) return null;
      used = 1;
    }
  }
  let renamed = false;
  if (name && name !== (left.name || '')) { out.name = name; cost += 1; renamed = true; }
  else if (left.name) out.name = left.name;
  if (Object.keys(ench).length) out.ench = ench;
  if (!right && !renamed) return null;
  let total = cost + work;
  if (renamed && cost === 1 && total >= 40) total = 39;      // a new name alone is never too expensive
  out.rep = Math.max(left.rep | 0, right ? right.rep | 0 : 0) * 2 + 1;
  return { result: out, cost: total, used, tooExpensive: total >= 40 && !creative };
}

/* ---- the grindstone ---- */
// one or two items in: the result, and the experience it gives back
export function grindResult(a, b) {
  if (!a && !b) return null;
  if (a && b && a.id !== b.id) return null;
  const one = a || b, it = ITEMS[one.id];
  const max = maxDamage(one.id);
  if (a && b && (!max || a.count > 1 || b.count > 1)) return null;
  const out = { id: one.id, count: one.count };
  if (it.name === 'enchanted_book' && !hasCurse(a) && !hasCurse(b)) { out.id = I.book; }
  if (a && b) {
    const keep = (max - (a.dmg | 0)) + (max - (b.dmg | 0)) + Math.floor(max * 5 / 100);
    const dmg = Math.max(0, max - keep);
    if (dmg) out.dmg = dmg;
  } else if (one.dmg) out.dmg = one.dmg;
  let xpPoints = 0;
  const curses = {};
  for (const s of [a, b]) {
    if (!s || !s.ench) continue;
    for (const k in s.ench) {
      if (ENCH[k] && ENCH[k].curse) { curses[k] = s.ench[k]; continue; }
      if (ENCH[k]) xpPoints += ENCH[k].min(s.ench[k]);
    }
  }
  if (Object.keys(curses).length) out.ench = curses;
  if (one.name) out.name = one.name;
  if (!(a && b) && !(one.ench && Object.keys(one.ench).some(k => ENCH[k] && !ENCH[k].curse))) return null;
  const half = Math.ceil(xpPoints / 2);
  return { result: out, xp: half + Math.floor(Math.random() * (half + 1)) };
}
function hasCurse(s) { return !!(s && s.ench && Object.keys(s.ench).some(k => ENCH[k] && ENCH[k].curse)); }

export function enchName(k, lv) {
  const R = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const e = ENCH[k];
  const n = e ? e.display : k;
  return e && e.maxLevel === 1 ? n : n + ' ' + (R[lv] || lv);
}
