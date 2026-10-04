/* ---------------------------------------------------------------------------
   Leoncraft 2 - crafting recipes.

   Every recipe is the game's own (js/recipedata.js, built from its recipe
   data by tools/leoncraft2/build_recipes.py). The rules of a crafting grid
   (2 x 2 in the inventory, 3 x 3 on a crafting table or a crafter):
   - a shaped recipe matches wherever it sits in the grid, as long as nothing
     else is in the grid, and also mirrored left to right;
   - a shapeless recipe matches its ingredients in any cells;
   - an ingredient can be any item of a set ("any planks", "any wool but
     red"), and the cells of one recipe may mix them;
   - a transmute recipe changes one item into another and keeps everything
     about it (a shulker box dyed keeps its contents, an enchanted bundle
     its enchantments);
   - the recipes the game works out in code: two worn items of one kind
     repair each other (their durability left added, plus a twentieth of
     the whole; only curses stay), leather armour dyed (the colours mixed
     the game's way), firework rockets (paper, one to three gunpowder for
     the flight, any firework stars), firework stars and their fades,
     tipped arrows (eight arrows round a lingering potion), decorated pots;
   - taking the result uses one of every item in the grid; a bucket of milk
     leaves its bucket, a honey bottle its bottle.

     const m = matchGrid(grid, w);   // grid: stacks (null for empty), w = 2 or 3
     m && m.result                   // { id, count, ... }
     consumeGrid(grid, giveBack, m)  // after the result is taken
--------------------------------------------------------------------------- */
import { SETS, CRAFTING, TRANSMUTE, SPECIAL, COOKING, CUTTING } from './recipedata.js?v=9';
import { I, ITEMS, maxDamage, withCount } from './items.js?v=9';

// ingredient sets as sets of item ids (an item this game does not have is left out)
const S = SETS.map(names => { const s = new Set(); for (const n of names) if (I[n] !== undefined) s.add(I[n]); return s; });
const setOf = i => (i < 0 ? null : S[i]);
const nameOf = id => (ITEMS[id] ? ITEMS[id].name : '');

/* recipes as { id, count, w, h, cells: [Set|null], n, cat, group, index } (w 0: shapeless) */
const LIST = [];
for (let i = 0; i < CRAFTING.length; i++) {
  const [res, count, w, h, cells, cat, group] = CRAFTING[i];
  const id = I[res];
  if (id === undefined) continue;
  const c = cells.map(setOf);
  if (c.some(x => x && x.size === 0)) continue;
  LIST.push({ id, count, w, h, cells: c, n: c.filter(Boolean).length, cat, group, index: LIST.length, kind: w ? 'shaped' : 'shapeless' });
}
// transmute: one item of `input` and some of `material` -> the input as `result`, keeping what it carries
const TRANS = [];
for (const [res, input, material, cat, group, lo, hi, add] of TRANSMUTE) {
  const id = res ? I[res] : 0;
  if (res && id === undefined) continue;
  const a = setOf(input), b = setOf(material);
  if (!a.size || !b.size) continue;
  const r = { id, count: 1, input: a, material: b, lo, hi, add: !!add, cat, group, kind: 'transmute', index: LIST.length };
  // for the recipe book: one input and one material
  r.cells = [a, b]; r.w = 0; r.h = 0; r.n = 2;
  TRANS.push(r);
  if (id) LIST.push(r);
}
// which recipes an item can be part of
const BY_ITEM = new Map();
for (let r = 0; r < LIST.length; r++) {
  if (LIST[r].kind === 'transmute') continue;
  const seen = new Set();
  for (const s of LIST[r].cells) if (s) for (const id of s) {
    if (seen.has(id)) continue;
    seen.add(id);
    let a = BY_ITEM.get(id);
    if (!a) BY_ITEM.set(id, a = []);
    a.push(r);
  }
}
export const recipeCount = LIST.length;
// every recipe the recipe book can show (the game's own, without the ones it works out in code)
export function allRecipes() { return LIST; }

const REMAINS = { milk_bucket: 'bucket', water_bucket: 'bucket', lava_bucket: 'bucket', powder_snow_bucket: 'bucket', honey_bottle: 'glass_bottle', dragon_breath: 'glass_bottle' };
export function remainderOf(id) { const r = REMAINS[nameOf(id)]; return r && I[r] !== undefined ? I[r] : 0; }

/* The recipe the grid makes, or null: { result, recipe, special? }. */
export function matchGrid(grid, w) {
  const h = grid.length / w;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0, first = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = grid[y * w + x];
    if (!s) continue;
    n++;
    if (!first) first = s;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const cand = BY_ITEM.get(first.id);
  if (cand) for (const r of cand) {
    const R = LIST[r];
    if (R.n !== n) continue;
    if (R.w) {
      if (R.w !== bw || R.h !== bh) continue;
      if (shapedAt(R, grid, w, x0, y0, false) || shapedAt(R, grid, w, x0, y0, true)) return { result: { id: R.id, count: R.count }, recipe: R };
    } else if (shapeless(R, grid)) return { result: { id: R.id, count: R.count }, recipe: R };
  }
  const items = [];
  for (const s of grid) if (s) items.push(s);
  return transmute(items) || special(items, grid, w);
}

function shapedAt(R, grid, w, x0, y0, mirror) {
  for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
    const want = R.cells[y * R.w + (mirror ? R.w - 1 - x : x)];
    const s = grid[(y0 + y) * w + x0 + x];
    if (!want) { if (s) return false; continue; }
    if (!s || !want.has(s.id)) return false;
  }
  return true;
}

// every grid item to a different ingredient (small: try each in turn)
function shapeless(R, grid) {
  const items = [];
  for (const s of grid) if (s) items.push(s.id);
  const sets = R.cells.filter(Boolean);
  const used = new Array(sets.length).fill(false);
  const fit = i => {
    if (i === items.length) return true;
    for (let k = 0; k < sets.length; k++) {
      if (used[k] || !sets[k].has(items[i])) continue;
      used[k] = true;
      if (fit(i + 1)) return true;
      used[k] = false;
    }
    return false;
  };
  return fit(0);
}

// one item of the input, the right number of the material, nothing else; never into what it already is
// (withCount keeps what the item carries: a shulker box's contents, enchantments, a name)
function transmute(items) {
  for (const R of TRANS) {
    let input = null, inputs = 0, mats = 0, ok = true;
    for (const s of items) {
      if (R.input.has(s.id)) { inputs++; input = s; }
      else if (R.material.has(s.id)) mats++;
      else { ok = false; break; }
    }
    if (!ok || inputs !== 1 || mats < R.lo || mats > R.hi) continue;
    if (R.id && input.id === R.id) continue;
    const out = withCount(input, R.count + (R.add ? mats : 0));
    if (R.id) out.id = R.id;
    return { result: out, recipe: R };
  }
  return null;
}

/* ---- the recipes the game works out in code ---- */
const has = (i, id) => i !== undefined && i >= 0 && S[i].has(id);
const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// the colour a dye gives armour, banners and beacons, and the one it gives a firework (the wiki's Dye page, Java Edition)
const DYE_RGB = [0xF9FFFE, 0xF9801D, 0xC74EBD, 0x3AB3DA, 0xFED83D, 0x80C71F, 0xF38BAA, 0x474F52, 0x9D9D97, 0x169C9C, 0x8932B8, 0x3C44AA, 0x835432, 0x5E7C16, 0xB02E26, 0x1D1D21];
const FIREWORK_RGB = [0xF0F0F0, 0xEB8844, 0xC354CD, 0x6689D3, 0xDECF2A, 0x41CD34, 0xD88198, 0x434343, 0xABABAB, 0x287697, 0x7B2FBE, 0x253192, 0x51301A, 0x3B511A, 0xB3312C, 0x1E1B1B];
export const dyeIndex = id => DYES.indexOf(nameOf(id).replace(/_dye$/, ''));
export const dyeColour = name => DYE_RGB[DYES.indexOf(name)];
export const fireworkColour = name => FIREWORK_RGB[DYES.indexOf(name)];

/* Armour dyed: the colours (the armour's own first, if it has one) mixed as
   the game does: the mean of each channel, scaled so its brightest channel
   is the mean of each colour's brightest. */
export function mixColours(base, dyes) {
  let r = 0, g = 0, b = 0, maxSum = 0, n = 0;
  const add = c => { const cr = c >> 16 & 255, cg = c >> 8 & 255, cb = c & 255; r += cr; g += cg; b += cb; maxSum += Math.max(cr, cg, cb); n++; };
  if (base !== undefined && base !== null) add(base);
  for (const c of dyes) add(c);
  let mr = Math.floor(r / n), mg = Math.floor(g / n), mb = Math.floor(b / n);
  const avgMax = Math.fround(maxSum / n), maxAvg = Math.max(mr, mg, mb);
  mr = Math.trunc(Math.fround(Math.fround(mr * avgMax) / maxAvg));
  mg = Math.trunc(Math.fround(Math.fround(mg * avgMax) / maxAvg));
  mb = Math.trunc(Math.fround(Math.fround(mb * avgMax) / maxAvg));
  return (mr << 16) | (mg << 8) | mb;
}

function special(items, grid, w) {
  const SP = SPECIAL;
  // two worn items of one kind: repair
  if (items.length === 2 && SP.repair_item) {
    const [a, b] = items;
    const max = maxDamage(a.id);
    if (a.id === b.id && max > 0 && a.count === 1 && b.count === 1) {
      const left = (max - (a.dmg | 0)) + (max - (b.dmg | 0)) + Math.floor(max / 20);
      const out = { id: a.id, count: 1 };
      const dmg = Math.max(0, max - left);
      if (dmg) out.dmg = dmg;
      // curses stay, every other enchantment is lost
      const ench = {};
      let any = false;
      for (const s of items) if (s.ench) for (const k in s.ench) if (/^(binding_curse|vanishing_curse)$/.test(k)) { ench[k] = Math.max(ench[k] || 0, s.ench[k]); any = true; }
      if (any) out.ench = ench;
      return { result: out, recipe: null, special: 'repair' };
    }
  }
  // leather armour (and wolf armour, leather horse armour) with one to eight dyes
  if (SP.dye) for (const d of SP.dye) {
    let target = null, dyes = [], ok = true;
    for (const s of items) {
      if (has(d.target, s.id) && !target) target = s;
      else if (has(d.dye, s.id)) dyes.push(DYE_RGB[dyeIndex(s.id)]);
      else { ok = false; break; }
    }
    if (!ok || !target || !dyes.length || dyes.length > 8) continue;
    const out = withCount(target, 1);
    out.color = mixColours(target.color, dyes);
    return { result: out, recipe: null, special: 'dye' };
  }
  // a firework rocket: one paper, one to three gunpowder (its flight), any firework stars
  const fr = SP.firework_rocket;
  if (fr && I[fr.result] !== undefined) {
    let paper = 0, powder = 0, stars = [], ok = true;
    for (const s of items) {
      if (has(fr.shell, s.id)) paper++;
      else if (has(fr.fuel, s.id)) powder++;
      else if (has(fr.star, s.id)) stars.push(s);
      else { ok = false; break; }
    }
    if (ok && paper === 1 && powder >= 1 && powder <= 3) {
      const out = { id: I[fr.result], count: fr.count, flight: powder };
      const ex = stars.filter(s => s.firework).map(s => JSON.parse(JSON.stringify(s.firework)));
      if (ex.length) out.explosions = ex;
      return { result: out, recipe: null, special: 'firework_rocket' };
    }
  }
  // a firework star: one gunpowder, at least one dye, one shape at most, a diamond (trail), glowstone (twinkle)
  const fs = SP.firework_star;
  if (fs && I[fs.result] !== undefined) {
    let powder = 0, colours = [], shape = null, trail = 0, twinkle = 0, ok = true;
    for (const s of items) {
      const sh = Object.keys(fs.shapes).find(k => has(fs.shapes[k], s.id));
      if (sh) { if (shape) { ok = false; break; } shape = sh; }
      else if (has(fs.fuel, s.id)) powder++;
      else if (has(fs.trail, s.id)) trail++;
      else if (has(fs.twinkle, s.id)) twinkle++;
      else if (has(fs.dye, s.id)) colours.push(DYES[dyeIndex(s.id)]);
      else { ok = false; break; }
    }
    if (ok && powder === 1 && colours.length && trail <= 1 && twinkle <= 1) {
      const fw = { shape: shape || 'small_ball', colors: colours };
      if (trail) fw.trail = true;
      if (twinkle) fw.twinkle = true;
      return { result: { id: I[fs.result], count: 1, firework: fw }, recipe: null, special: 'firework_star' };
    }
  }
  // a firework star and dyes: the colours it fades to
  const ff = SP.firework_star_fade;
  if (ff) {
    let star = null, colours = [], ok = true;
    for (const s of items) {
      if (has(ff.target, s.id) && !star) star = s;
      else if (has(ff.dye, s.id)) colours.push(DYES[dyeIndex(s.id)]);
      else { ok = false; break; }
    }
    if (ok && star && colours.length && star.firework) {
      const out = withCount(star, 1);
      out.firework = Object.assign({}, star.firework, { fade: colours });
      return { result: out, recipe: null, special: 'firework_star_fade' };
    }
  }
  // tipped arrows: a lingering potion in the middle of a 3 x 3 grid, eight arrows round it
  const im = SP.imbue;
  if (im && w === 3 && grid.length === 9 && I[im.result] !== undefined) {
    const mid = grid[4];
    if (mid && has(im.source, mid.id) && grid.every((s, i) => i === 4 || (s && has(im.material, s.id)))) {
      const out = { id: I[im.result], count: im.count };
      if (mid.potion) out.potion = mid.potion;
      return { result: out, recipe: null, special: 'imbue' };
    }
  }
  // a decorated pot: bricks or sherds above, left, right and below the middle of a 3 x 3 grid
  const dp = SP.decorated_pot;
  if (dp && w === 3 && grid.length === 9 && I[dp.result] !== undefined) {
    const sides = [1, 3, 5, 7];
    if (grid.every((s, i) => (sides.includes(i) ? s && has(dp.sides, s.id) : !s))) {
      const out = { id: I[dp.result], count: 1 };
      // back, left, right, front: the game's order; plain bricks are no pattern
      const names = [grid[1], grid[3], grid[5], grid[7]].map(s => nameOf(s.id));
      if (names.some(n => n !== 'brick')) out.sherds = names;
      return { result: out, recipe: null, special: 'decorated_pot' };
    }
  }
  return null;
}

/* After the result is taken: one of each item in the grid is used up; what
   an item leaves behind (a bucket) goes back in its cell if the cell is now
   empty, else to giveBack(stack). */
export function consumeGrid(grid, giveBack) {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    const rem = remainderOf(s.id);
    s.count--;
    if (s.count <= 0) grid[i] = null;
    if (rem) {
      if (!grid[i]) grid[i] = { id: rem, count: 1 };
      else if (giveBack) giveBack({ id: rem, count: 1 });
    }
  }
}

// for tests and the recipe book: every recipe that makes an item
export function recipesFor(id) { return LIST.filter(r => r.id === id); }

/* ---- cooking: furnace (smelting), blast furnace (blasting), smoker
   (smoking) and campfire (campfire_cooking), each with its own list ---- */
const COOK = { smelting: new Map(), blasting: new Map(), smoking: new Map(), campfire_cooking: new Map() };
for (const [kind, input, res, count, xp, ticks, cat, group] of COOKING) {
  const id = I[res];
  if (id === undefined || !COOK[kind]) continue;
  const r = { id, count, xp, ticks, cat, group, kind, input: S[input] };
  for (const a of S[input]) if (!COOK[kind].has(a)) COOK[kind].set(a, r);
}
const COOK_KIND = { furnace: 'smelting', blast_furnace: 'blasting', smoker: 'smoking', campfire: 'campfire_cooking', soul_campfire: 'campfire_cooking' };
// what an item cooks into in this kind of block: { id, count, xp, ticks } or null
export function cookingRecipe(id, block) { const m = COOK[COOK_KIND[block] || block]; return (m && m.get(id)) || null; }
export function cookingRecipes(block) { const m = COOK[COOK_KIND[block] || block]; return m ? [...new Set(m.values())] : []; }

/* ---- the stonecutter: the game's own list, one block in, what it cuts into ---- */
let CUT = null;
function buildCut() {
  CUT = new Map();
  for (const [input, res, count] of CUTTING) {
    const id = I[res];
    if (id === undefined) continue;
    for (const a of S[input]) {
      let l = CUT.get(a);
      if (!l) CUT.set(a, l = []);
      if (!l.some(x => x.id === id)) l.push({ id, count });
    }
  }
  // in the order of the item list, as the game shows them
  for (const l of CUT.values()) l.sort((p, q) => p.id - q.id);
}
// what one of an item cuts into: [{ id, count }]
export function stonecutterRecipes(id) {
  if (!CUT) buildCut();
  return CUT.get(id) || [];
}
