/* ---------------------------------------------------------------------------
   Leoncraft 2 - crafting recipes.

   The game's rules for a crafting grid (2 x 2 in the inventory, 3 x 3 on a
   crafting table):
   - a shaped recipe matches wherever it sits in the grid, as long as nothing
     else is in the grid, and also mirrored left to right;
   - a shapeless recipe matches its ingredients in any cells;
   - an ingredient can be any item of a set ("any planks"), and the cells
     of one recipe may mix them (a chest of oak and birch planks);
   - two worn items of the same kind, alone in the grid, repair each other:
     their durability left added, plus a twentieth of the whole, and the
     enchantments are lost;
   - taking the result uses one of every item in the grid; a bucket of milk
     leaves its bucket, a honey bottle its bottle.

     const m = matchGrid(grid, w);   // grid: stacks (null for empty), w = 2 or 3
     m && m.result                   // { id, count, dmg? }
     consumeGrid(grid, m, giveBack)  // after the result is taken
--------------------------------------------------------------------------- */
import { RECIPES, ING } from './itemdata.js?v=8';
import { I, ITEMS, maxDamage } from './items.js?v=8';

// ingredient sets as sets of item ids
const SETS = ING.map(names => { const s = new Set(); for (const n of names) if (I[n] !== undefined) s.add(I[n]); return s; });
// recipes as { id, count, w, h, cells: [Set|null] } (w 0: shapeless)
const LIST = [];
for (const [res, count, w, h, cells] of RECIPES) {
  const id = I[res];
  if (id === undefined) continue;
  const c = cells.map(i => (i < 0 ? null : SETS[i]));
  if (c.some(x => x && x.size === 0)) continue;
  LIST.push({ id, count, w, h, cells: c, n: c.filter(Boolean).length });
}
// which recipes an item can be part of
const BY_ITEM = new Map();
for (let r = 0; r < LIST.length; r++) {
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

const REMAINS = { milk_bucket: 'bucket', water_bucket: 'bucket', lava_bucket: 'bucket', powder_snow_bucket: 'bucket', honey_bottle: 'glass_bottle', dragon_breath: 'glass_bottle' };

/* The recipe the grid makes, or null: { result, recipe, repair? }. */
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
  // two worn items of one kind: repair
  if (n === 2) {
    const a = [];
    for (const s of grid) if (s) a.push(s);
    const max = maxDamage(a[0].id);
    if (a[0].id === a[1].id && max > 0 && a[0].count === 1 && a[1].count === 1) {
      const left = (max - (a[0].dmg | 0)) + (max - (a[1].dmg | 0)) + Math.floor(max * 5 / 100);
      const out = { id: a[0].id, count: 1 };
      const dmg = Math.max(0, max - left);
      if (dmg) out.dmg = dmg;
      // curses stay, every other enchantment is lost
      const ench = {};
      let any = false;
      for (const s of a) if (s.ench) for (const k in s.ench) if (/^(binding_curse|vanishing_curse)$/.test(k)) { ench[k] = s.ench[k]; any = true; }
      if (any) out.ench = ench;
      return { result: out, recipe: null, repair: true };
    }
  }
  const cand = BY_ITEM.get(first.id);
  if (!cand) return null;
  for (const r of cand) {
    const R = LIST[r];
    if (R.n !== n) continue;
    if (R.w) {
      if (R.w !== bw || R.h !== bh) continue;
      if (shapedAt(R, grid, w, x0, y0, false) || shapedAt(R, grid, w, x0, y0, true)) return { result: { id: R.id, count: R.count }, recipe: R };
    } else if (shapeless(R, grid)) return { result: { id: R.id, count: R.count }, recipe: R };
  }
  return null;
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

/* After the result is taken: one of each item in the grid is used up; what
   an item leaves behind (a bucket) goes back in its cell if the cell is now
   empty, else to giveBack(stack). */
export function consumeGrid(grid, giveBack) {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    const it = ITEMS[s.id];
    const rem = it && REMAINS[it.name] ? I[REMAINS[it.name]] : 0;
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

/* ---- the stonecutter ----
   Not in the data: worked out from the crafting recipes the way the game's
   own list reads. Every stone-like block cuts into what it crafts into one
   for one (polished, bricks, tiles, pillars, cut, stairs, walls), slabs two
   at a time, and on through those (stone -> stone brick stairs); chiseled
   blocks come from the block their slabs are cut from; copper blocks cut
   into four cut copper. */
const STONE_RE = /stone|cobble|andesite|diorite|granite|deepslate|blackstone|basalt|brick|sandstone|prismarine|purpur|quartz|copper|tuff|resin|cinnabar|sulfur|mud|amethyst/;
const CUT_OUT = /(_slab|_stairs|_wall|_bricks|_tiles|_pillar|_brick)$|^(polished_|chiseled_|cut_)/;
let CUT = null;
function buildCut() {
  CUT = new Map();
  const direct = new Map(), slabOf = new Map();
  const add = (m, a, b, n) => { let x = m.get(a); if (!x) m.set(a, x = new Map()); if (!x.has(b)) x.set(b, n); };
  for (const R of LIST) {
    const cells = R.cells.filter(Boolean);
    if (!cells.length || cells[0].size !== 1) continue;
    const inId = cells[0].values().next().value;
    if (!cells.every(c => c.size === 1 && c.has(inId))) continue;
    const inName = ITEMS[inId] && ITEMS[inId].name, outName = ITEMS[R.id] && ITEMS[R.id].name;
    if (!inName || !outName || !STONE_RE.test(inName) || /planks|_log|wood|wool|glass|concrete|carpet|stairs$|wall$|button|pressure_plate/.test(inName)) continue;
    if (/_slab$/.test(inName)) {
      // two slabs make the chiseled block: it is cut from the slab's own block
      if (cells.length === 2 && /^chiseled_/.test(outName)) slabOf.set(inId, R.id);
      continue;
    }
    if (!CUT_OUT.test(outName) || /_ore$|^waxed_/.test(outName) || inId === R.id) continue;
    add(direct, inId, R.id, /_slab$/.test(outName) ? 2 : /^(exposed_|weathered_|oxidized_)?cut_copper$/.test(outName) ? 4 : 1);
  }
  // chiseled from the block its slab is cut from
  for (const [a, outs] of direct) for (const [b] of [...outs]) if (slabOf.has(b)) add(direct, a, slabOf.get(b), 1);
  // and on through every one-for-one step
  for (const a of direct.keys()) {
    const out = new Map(), queue = [[a, 1]], seen = new Set([a]);
    while (queue.length) {
      const [x, k] = queue.shift();
      const next = direct.get(x);
      if (!next) continue;
      for (const [y, n] of next) {
        if (seen.has(y)) continue;
        seen.add(y);
        out.set(y, n * k);
        if (n === 1 || ITEMS[y].name.indexOf('cut_') >= 0) queue.push([y, n * k]);
      }
    }
    CUT.set(a, [...out].map(([id, count]) => ({ id, count })).sort((p, q) => p.id - q.id));
  }
}
// what one of an item cuts into: [{ id, count }]
export function stonecutterRecipes(id) {
  if (!CUT) buildCut();
  return CUT.get(id) || [];
}
