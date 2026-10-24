/* ---------------------------------------------------------------------------
   Leoncraft 2 - the recipes the recipe book knows (ui/recipebook.js), one
   world's worth, kept with the world's save.

   main.js calls:
     recipesWorld(game, saved)   a world started: what it knew
     recipesTick(game)           once a game tick (it looks round once a second)
     recipesState()              what goes into the save
     recipesLeave()              leaving the world

   Recipes are unlocked as the game's recipe advancements unlock them
   (js/recipeunlocks.js, built from its data by
   tools/leoncraft2/build_recipe_unlocks.py): carrying an item for the first
   time unlocks the recipes it is named for (planks the sticks and signs, a
   stone pickaxe the torch...), standing in water the boats, and the
   crafting table is known from the start; a recipe the table does not name
   is unlocked by any of its ingredients. Each new batch shows a New Recipes
   Unlocked! toast (adv/toast.js, in the same column as the advancements);
   /recipe gives and takes them.
--------------------------------------------------------------------------- */
import { BLOCKS } from './blocks.js?v=107';
import { ITEMS } from './items.js?v=107';
import { allRecipes } from './crafting.js?v=107';
import { register } from './commands.js?v=107';
import { UNLOCKS, START } from './recipeunlocks.js?v=107';
import { AdvToast } from './adv/toast.js?v=107';

const nameOf = id => (ITEMS[id] ? ITEMS[id].name : BLOCKS[id] ? BLOCKS[id].name : '');

/* A recipe's key, kept in the save: what it makes, and which of the recipes making that it is
   (the order they are in the game's data), so a key still means the same recipe after a rebuild. */
let KEYS = null;
function recipeKeys() {
  if (!KEYS) {
    KEYS = { byKey: new Map(), keyOf: new Map() };
    const n = new Map();
    for (const r of allRecipes()) {
      const base = nameOf(r.id) + (r.kind === 'transmute' ? '~' : ''), k = (n.get(base) || 0);
      n.set(base, k + 1);
      const key = base + (k ? '#' + k : '');
      KEYS.byKey.set(key, r); KEYS.keyOf.set(r, key);
    }
  }
  return KEYS;
}
// the recipes each item (by name) unlocks: the game's list for what the recipe makes, else its ingredients
let BY_ITEM = null;
function recipesWith(name) {
  if (!BY_ITEM) {
    BY_ITEM = new Map();
    const add = (n, r) => { let a = BY_ITEM.get(n); if (!a) BY_ITEM.set(n, a = []); if (a[a.length - 1] !== r) a.push(r); };
    for (const r of allRecipes()) {
      const list = UNLOCKS[nameOf(r.id)];
      if (list) for (const n of list) add(n, r);
      else for (const c of r.cells) if (c) for (const i of c) add(nameOf(i), r);
    }
  }
  return BY_ITEM.get(name) || [];
}

export class Known {
  constructor(saved) {
    // items ever carried (by name, '@water' for having been in water) and the recipes unlocked (by key)
    this.seen = new Set((saved && saved.seen) || []);
    this.keys = new Set((saved && saved.recipes) || []);
    this.set = null;
    this.n = 0;
    if (!saved || !saved.recipes) this.unlock(allRecipes().filter(r => START.includes(nameOf(r.id))), true);
  }
  toJSON() { return { seen: [...this.seen], recipes: [...this.keys] }; }
  // every recipe unlocked (a Set of crafting.js recipes)
  unlockedRecipes() {
    if (!this.set) { const K = recipeKeys(); this.set = new Set([...this.keys].map(k => K.byKey.get(k)).filter(Boolean)); }
    return this.set;
  }
  recipeCount() { return this.unlockedRecipes().size; }
  // recipes unlocked (a toast for those that are new); returns how many were
  unlock(list, quiet) {
    const u = this.unlockedRecipes(), K = recipeKeys(), fresh = [];
    for (const r of list) if (!u.has(r)) { u.add(r); this.keys.add(K.keyOf.get(r)); fresh.push(r.id); }
    if (fresh.length && !quiet) AdvToast.addRecipes(fresh);
    return fresh.length;
  }
  lock(list) {
    const u = this.unlockedRecipes(), K = recipeKeys();
    let n = 0;
    for (const r of list) if (u.delete(r)) { this.keys.delete(K.keyOf.get(r)); n++; }
    return n;
  }
  // a look at what you carry, once a second: an item carried for the first time unlocks what it is named for
  look(g) {
    const inv = g.inv, P = g.player;
    if (!inv) return;
    const fresh = [];
    const one = st => { if (st) { const n = nameOf(st.id); if (n && !this.seen.has(n)) { this.seen.add(n); fresh.push(n); } } };
    for (const st of inv.slots) one(st);
    for (const st of inv.armor) one(st);
    one(inv.offhand);
    if (P && P.inWater && !this.seen.has('@water')) { this.seen.add('@water'); fresh.push('@water'); }
    if (!fresh.length) return;
    const list = [];
    for (const n of fresh) list.push(...recipesWith(n));
    this.unlock(list);
  }
}

let K = null;
export function known() { return K; }
export function recipesWorld(g, saved) { K = new Known(saved); g.recipes = K; }
export function recipesTick(g) { if (K && g && ++K.n % 20 === 0) K.look(g); }
export function recipesState() { return K ? K.toJSON() : undefined; }
export function recipesLeave() { K = null; }

/* /recipe (give|take) <targets> (*|<recipe>), the game's replies; a recipe is named by what it makes */
register('recipe', {
  usage: '(give|take) <targets> (*|<recipe>)',
  suggest: i => (i === 0 ? ['give', 'take'] : i === 1 ? ['@s'] : i === 2 ? ['*'] : []),
  run(args, ctx) {
    const op = args[0], who = ctx.playerName || 'Player';
    if ((op !== 'give' && op !== 'take') || args[2] === undefined) { ctx.say('Incomplete command', 0xFF5555); return; }
    if (!/^(@s|@p|@a)$/.test(args[1]) && args[1] !== who) { ctx.say('No player was found', 0xFF5555); return; }
    if (!K) { ctx.say('No player was found', 0xFF5555); return; }
    let list = allRecipes();
    if (args[2] !== '*') {
      const n = args[2].replace(/^minecraft:/, '');
      list = list.filter(r => nameOf(r.id) === n);
      if (!list.length) { ctx.say('Unknown recipe: ' + args[2], 0xFF5555); return; }
    }
    const k = op === 'give' ? K.unlock(list) : K.lock(list);
    if (!k) ctx.say(op === 'give' ? 'No recipes could be learned' : 'No recipes could be forgotten', 0xFF5555);
    else ctx.say(op === 'give' ? `Unlocked ${k} recipes for ${who}` : `Took ${k} recipes from ${who}`);
  },
});
