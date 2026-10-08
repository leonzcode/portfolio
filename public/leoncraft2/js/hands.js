/* ---------------------------------------------------------------------------
   Leoncraft 2 - what the hands do: the bridge between the input and the
   item and survival rules.

   The Interactor (interact.js) asks this for everything that depends on the
   item in your hand:
     progress(hit)     how much of the block one tick of mining wears away (mining.js)
     broke(hit, cells) the block went: its drops (loot.js) jump out as items
                       (drops.js), what it held spills, the tool wears, 0.005
                       exhaustion; returns what takes its place (ice leaves water)
     useOn(hit)        right click on a block: open a crafting table, chest,
                       barrel or furnace; till, strip or flatten with a tool
     useItem(hit)      right click with an item: start eating or drinking,
                       put on armour, fill a bucket
     id(), used()      the block to place, and one placed (a bucket empties)

   Eating takes the food's time (32 ticks, 16 for dried kelp, 40 for honey)
   with the button held, slowing you to a fifth; the food goes to the mouth
   and bobs, crumbs fly every 4 ticks, then hunger, saturation and effects
   are applied (survival.js) and what is left (a bowl, a bottle, a bucket)
   stays in the hand. Letting go stops it.

   Q throws one of the selected stack, Ctrl+Q all of it. Dying spills the
   inventory and up to 100 points of experience (7 a level).

   The off hand gets its turn at a right click when the main hand did
   nothing with it (withOffhand): a torch beside the pickaxe, food. Weapons
   wear on mobs (wearHeld), worn-out tools break into pieces, and Mending
   takes collected experience first (mend).
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID, OPAQUE } from './blocks.js?v=33';
import { setLodestoneCheck } from './dials.js?v=33';
import { I, ITEMS, blockOf, foodOf, armorOf, withCount, stackToJSON, stackFromJSON, stewEffect, addCooldown, onCooldown, isBundle, bundleTake } from './items.js?v=33';
import { breakTicks, wearFor } from './mining.js?v=33';
import { blockDrops } from './loot.js?v=33';
import { containerKind, spill } from './containers.js?v=33';
import { CraftingScreen, ChestScreen, ShulkerScreen, DispenserScreen, CrafterScreen, FurnaceScreen, HopperScreen, BrewingScreen } from './ui/containers.js?v=33';
import { isPotion, drinkPotion } from './brewing.js?v=33';
import { EnchantScreen, AnvilScreen, GrindstoneScreen, SmithingScreen, StonecutterScreen } from './ui/workstations.js?v=33';
import { MerchantScreen } from './ui/merchant.js?v=33';
import { hives } from './entities/hives.js?v=33';
import { LoomScreen } from './ui/loom.js?v=33';
import { CartographyScreen } from './ui/cartography.js?v=33';
import { MAPS, isFilledMap, drawHeldMaps } from './maps.js?v=33';
import { countShelves } from './enchanting.js?v=33';
import { wear } from './ui/inventory.js?v=33';
import { BookScreen } from './ui/book.js?v=33';
import { breaksInCreative } from './modes.js?v=33';
import { boxOpened, bellRang } from './sim/lids.js?v=33';

const BUCKETS = { water: 'water_bucket', lava: 'lava_bucket' };
// what a full bucket pours out (the fish buckets are water with a fish in it)
const FILLED = { water_bucket: 'water', lava_bucket: 'lava', powder_snow_bucket: 'powder_snow', cod_bucket: 'water', salmon_bucket: 'water',
  pufferfish_bucket: 'water', tropical_fish_bucket: 'water', axolotl_bucket: 'water', tadpole_bucket: 'water' };
const MOB_BUCKET = /^(cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket$/;
// what poured water or lava breaks out of its way (the game's non-solid blocks that cannot hold water)
const WASHED = new Set(['torch', 'wall_torch', 'wire', 'cross', 'crop']);
// two slot arrays seen as one (a large chest): reads and writes go straight to the halves
function joinSlots(a, b) {
  const n = a.length + b.length;
  return new Proxy([], {
    get(t, k) {
      if (k === 'length') return n;
      if (typeof k === 'string' && /^\d+$/.test(k)) { const i = +k; return i < a.length ? a[i] : b[i - a.length]; }
      return Reflect.get(Array.prototype, k) || t[k];
    },
    set(t, k, v) {
      if (typeof k === 'string' && /^\d+$/.test(k)) { const i = +k; if (i < a.length) a[i] = v; else b[i - a.length] = v; return true; }
      t[k] = v; return true;
    },
    has(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) return +k < n; return k in t; },
  });
}
/* Copper's ages: each copper block's name one age younger (an axe scrapes it
   back), and every copper block that ages (honeycomb waxes those). */
const COPPER_AGES = ['exposed_', 'weathered_', 'oxidized_'], COPPER_AGE = new Set(), COPPER_BACK = {};
for (const d of BLOCKS) {
  if (!d || !/copper|lightning_rod/.test(d.name) || /^waxed_|ore$|^raw_|_ingot$|_nugget$/.test(d.name)) continue;
  if (B['waxed_' + d.name] !== undefined) COPPER_AGE.add(d.name);
  const i = COPPER_AGES.findIndex(a => d.name.startsWith(a));
  if (i < 0) continue;
  const fam = d.name.slice(COPPER_AGES[i].length);
  const back = i > 0 ? COPPER_AGES[i - 1] + fam : fam === 'copper' ? 'copper_block' : fam;
  if (B[back] !== undefined) COPPER_BACK[d.name] = back;
}
const STRIP = {};
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'poplar']) { STRIP[w + '_log'] = 'stripped_' + w + '_log'; STRIP[w + '_wood'] = 'stripped_' + w + '_wood'; }
for (const w of ['crimson', 'warped']) { STRIP[w + '_stem'] = 'stripped_' + w + '_stem'; STRIP[w + '_hyphae'] = 'stripped_' + w + '_hyphae'; }
STRIP.bamboo_block = 'stripped_bamboo_block';
const TILL = { grass_block: 'farmland', dirt: 'farmland', dirt_path: 'farmland', coarse_dirt: 'dirt', rooted_dirt: 'dirt' };
const FLATTEN = { grass_block: 'dirt_path', dirt: 'dirt_path', podzol: 'dirt_path', coarse_dirt: 'dirt_path', mycelium: 'dirt_path', rooted_dirt: 'dirt_path' };

export class Hands {
  /* g: { world, player, inv, survival, drops, containers, fluids, gui, icons, mode, open(screen), inter } */
  constructor(g) {
    Object.assign(this, g);
    this.using = null;               // { slot, id, t, total } while eating or drinking
    if (this.containers) this.containers.drops = this.drops;
    this.ender = new Array(27).fill(null);
    this.onEat = null;               // (id) the eating sound, every 4 ticks
    this.onBurp = null;
    this.onToolBreak = null;         // (stack) the breaking sound
    // a tool or a piece of armour that wears out breaks into pieces
    if (this.inv && this.inv.on) this.inv.on('broke', s => this.toolBroke(s));
    // a lodestone compass's needle spins once its lodestone is known to be gone (js/dials.js)
    setLodestoneCheck((x, y, z, dim) => {
      const w = this.world;
      if (!w || (w.dim || 'overworld') !== dim || (w.chunkAt && !w.chunkAt(x, z))) return null;
      return w.get(x, y, z) === B.lodestone;
    });
    // an elytra worn and not worn out (one point of it left is not enough to fly), for the player's glide
    if (this.player) this.player.hasElytra = () => { const c = this.inv.armor[1], it = c && ITEMS[c.id]; return !!(it && it.name === 'elytra' && (c.dmg | 0) < (it.dur || 432) - 1); };
    this.glideT = 0;
    // the screens' sheets, fetched now so a chest never opens on an empty frame
    if (this.gui && this.gui.loadSheet) for (const n of ['crafting_table', 'generic_54', 'shulker_box', 'dispenser', 'crafter', 'hopper', 'brewing_stand', 'furnace', 'smoker', 'blast_furnace', 'enchanting_table', 'anvil', 'grindstone', 'smithing', 'stonecutter', 'villager', 'loom', 'cartography_table'])
      this.gui.loadSheet('container/' + n).catch(() => {});
  }
  get creative() { return this.mode === 'creative'; }
  // adventure and spectator change nothing in the world with an item (modes.js)
  get mayBuild() { return this.mode !== 'adventure' && this.mode !== 'spectator'; }
  get held() { return this.inv.slots[this.inv.selected]; }

  /* ---- the Interactor's hand ---- */
  adapter(renderer) {
    const self = this;
    return {
      id: () => { const s = self.held; return s ? blockOf(s.id) : 0; },
      used: list => self.placed(list),
      got: id => self.inv.add(id, 1),
      swing: () => { renderer.swing = 1; },
      progress: hit => self.progress(hit),
      broke: (hit, cells) => self.broke(hit, cells),
      useOn: hit => self.useOn(hit),
      useItem: hit => self.useItem(hit),
      // the item and everything about it but the count: mining starts again when this changes
      key: () => { const s = self.held; return s ? s.id + '/' + (s.dmg | 0) + '/' + (s.ench ? JSON.stringify(s.ench) : '') + '/' + (s.name || '') : ''; },
      withOffhand: fn => self.withOffhand(fn),
      wear: n => self.wearHeld(n),
      // creative: a sword, trident, mace or debug stick in the hand breaks nothing
      mayBreak: () => !self.creative || breaksInCreative(self.held ? self.held.id : 0),
    };
  }
  /* The off hand's turn at a right click, when the main hand did nothing (a
     pickaxe in the hand, torches in the off hand): its stack stands in the
     selected slot while fn runs, so placing, eating and the rest use it, and
     whatever is left of it goes back to the off hand. */
  withOffhand(fn) {
    const inv = this.inv, i = inv.selected;
    if (!inv.offhand) return false;
    const main = inv.slots[i];
    inv.slots[i] = inv.offhand; inv.offhand = main;
    this.offTurn = true;
    try { return fn(); } finally {
      this.offTurn = false;
      const now = inv.slots[i];
      inv.slots[i] = inv.offhand; inv.offhand = now;
      inv.changed();
    }
  }
  // a block was placed from the selected stack: one fewer, and a bucket leaves its bucket
  placed(list) {
    // the first cell is the block from the hand (a shulker box brings its contents); the rest are its other parts
    if (list) list.forEach(([x, y, z], i) => this.containers.placed(x, y, z, i === 0 ? this.held || {} : null));
    // a nest or hive that was moved with Silk Touch brings its bees and honey back
    if (list && list.length && this.held && (this.held.bees || this.held.honey)) hives().placed(this.world, list[0][0], list[0][1], list[0][2], this.held);
    // a sign opens its editing screen
    if (list && list.length && this.details) this.details.placed(list[0][0], list[0][1], list[0][2]);
    if (this.creative) return;
    const s = this.held;
    if (!s) return;
    const it = ITEMS[s.id];
    if (it && /_bucket$/.test(it.name)) { this.inv.slots[this.inv.selected] = { id: I.bucket, count: 1 }; this.inv.changed(); return; }
    this.inv.takeSelected(1);
  }
  // one tick's share of breaking the block under the crosshair (1 = all of it)
  progress(hit) {
    const d = BLOCKS[hit.b], p = this.player;
    const ticks = breakTicks(d, {
      stack: this.held, effects: this.survival.miningEffects(), inWater: p.eyeInWater,
      aquaAffinity: this.survival.helmetEnchant('aqua_affinity') > 0, onGround: p.onGround || p.flying,
    });
    return ticks === Infinity ? 0 : ticks <= 0 ? 1 : 1 / ticks;
  }
  // the block at hit (and everything that went with it, cells) is about to be removed
  broke(hit, cells) {
    const w = this.world, b = w.get(hit.x, hit.y, hit.z), m = w.meta(hit.x, hit.y, hit.z), d = BLOCKS[b];
    if (!d) return 0;
    let replace = 0;
    // a shulker box keeps what it holds: it goes inside the box that drops (in creative too, when it holds anything)
    const kind = containerKind(b);
    const inBox = kind === 'shulker_box' ? this.containers.takeShulker(hit.x, hit.y, hit.z) : null;
    if (this.creative && inBox) this.drops.popFrom(hit.x, hit.y, hit.z, { id: b, count: 1, items: inBox });
    // a furnace's stored experience comes out with it
    const fc = kind && this.containers.peek(hit.x, hit.y, hit.z);
    if (fc && fc.used) { const xp = this.containers.xpOf(fc); if (xp) this.drops.xp(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, xp); }
    if (!this.creative) {
      const held = this.held;
      const out = blockDrops(w, hit.x, hit.y, hit.z, b, m, { stack: held });
      // a bee nest or beehive mined with Silk Touch keeps its bees and its honey level (entities/hives.js)
      const hive = (d.name === 'bee_nest' || d.name === 'beehive') && held && held.ench && held.ench.silk_touch ? hives().take(w, hit.x, hit.y, hit.z) : null;
      for (const s of out.items) {
        if (inBox && s.id === b && !s.items) s.items = inBox;
        if (hive && s.id === b) { if (hive.length) s.bees = hive; s.honey = (m >> 2) & 7; }
        this.drops.popFrom(hit.x, hit.y, hit.z, s);
      }
      if (out.xp) this.drops.xp(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, out.xp);
      // the rest: what stood on it or hung from it pops off (not the other half of the same block)
      for (const [x, y, z] of cells) {
        if (x === hit.x && y === hit.y && z === hit.z) continue;
        const ob = w.get(x, y, z);
        if (!ob || ob === b || (BLOCKS[ob].lower && B[BLOCKS[ob].lower] === b) || (d.lower && B[d.lower] === ob)) continue;
        const o = blockDrops(w, x, y, z, ob, w.meta(x, y, z), { popped: true });
        for (const s of o.items) this.drops.popFrom(x, y, z, s);
      }
      // ice without Silk Touch melts into water if something is under it (in the Nether it is simply gone)
      if (d.name === 'ice' && !(held && held.ench && held.ench.silk_touch) && w.dim !== 'the_nether') {
        const under = w.get(hit.x, hit.y - 1, hit.z);
        if (under && (BLOCKS[under].solid || FLUID[under])) replace = B.water;
      }
      const wr = wearFor(held, d);
      if (wr) this.inv.damageSelected(wr);
      this.survival.exhaust(0.005);
    }
    // a container's contents spill (in creative too, as in the game), thrown out in parts of 10-30
    for (const [x, y, z] of cells) spill(this.drops, x, y, z, this.containers.remove(x, y, z));
    // the food on a campfire spills too; a sign's words go with it
    if (this.details) for (const [x, y, z] of cells) this.details.broken(x, y, z);
    return replace;
  }

  /* ---- right click on a block ---- */
  useOn(hit) {
    const w = this.world, b = hit.b, d = BLOCKS[b];
    if (!d || w.get(hit.x, hit.y, hit.z) !== b) return false;
    const holding = !!this.held || !!this.inv.offhand;
    // sneaking with something in hand skips the block's own use, not what the item does to it
    if (this.player.sneaking && holding) return this.itemOnBlock(hit, d);
    // cauldrons, composters, campfires and signs (details.js)
    if (this.details && this.details.use(this, hit)) return true;
    if (d.name === 'crafting_table') { this.open(new CraftingScreen(this.inv, this.icons)); return true; }
    if (this.openStation(d, hit)) return true;
    if (d.name === 'ender_chest') {
      if (OPAQUE[w.get(hit.x, hit.y + 1, hit.z)]) return true;
      const s = new ChestScreen(this.inv, this.icons, this.ender, 'Ender Chest');
      this.open(s);
      boxOpened(hit.x, hit.y, hit.z, s);
      return true;
    }
    // a bell rings, swinging away from the side you struck (sim/lids.js)
    if (d.shape === 'bell') {
      const n = hit.face || [0, 0, -1];
      bellRang(hit.x, hit.y, hit.z, n[0] > 0 ? 0 : n[0] < 0 ? 1 : n[1] > 0 ? 2 : n[1] < 0 ? 3 : n[2] > 0 ? 4 : 5);
      return true;
    }
    const kind = containerKind(b);
    if (kind) {
      const C = this.containers, x = hit.x, y = hit.y, z = hit.z;
      // the click still counts (the item is not used) when the lid cannot open
      if (C.blocked(x, y, z)) return true;
      if (kind === 'furnace' || kind === 'smoker' || kind === 'blast_furnace') {
        const c = C.at(x, y, z);
        this.open(new FurnaceScreen(this.inv, this.icons, c, {
          changed: () => C.changed(c),
          // anything taken out of the output by hand brings all the experience the furnace holds
          tookXp: () => { const xp = C.takeXp(c); if (xp > 0) this.drops.xp(this.player.pos.x, this.player.pos.y + 0.5, this.player.pos.z, xp); },
        }));
        return true;
      }
      const c = C.at(x, y, z);
      const two = C.large(x, y, z);
      if (two) {
        // a large chest: the half on your left as you face it holds the top three rows; one live view of both
        const box = joinSlots(two[0].slots, two[1].slots);
        const s = new ChestScreen(this.inv, this.icons, box, 'Large Chest', i => C.changed(i < 27 ? two[0] : two[1]));
        this.open(s);
        // both halves' lids open (sim/lids.js)
        boxOpened(x, y, z, s, C.partner(x, y, z));
        return true;
      }
      if (kind === 'hopper') { this.open(new HopperScreen(this.inv, this.icons, c.slots, () => C.changed(c))); return true; }
      if (kind === 'brewing_stand') { this.open(new BrewingScreen(this.inv, this.icons, c, { changed: () => C.changed(c) })); return true; }
      if (kind === 'dispenser' || kind === 'dropper') { this.open(new DispenserScreen(this.inv, this.icons, c.slots, kind === 'dropper' ? 'Dropper' : 'Dispenser', () => C.changed(c))); return true; }
      if (kind === 'crafter') { this.open(new CrafterScreen(this.inv, this.icons, c, { changed: () => C.changed(c), powered: () => !!(w.meta(x, y, z) & 8) })); return true; }
      const title = kind === 'barrel' ? 'Barrel' : kind === 'shulker_box' ? 'Shulker Box' : 'Chest';
      const s = kind === 'shulker_box' ? new ShulkerScreen(this.inv, this.icons, c.slots, title, () => C.changed(c)) : new ChestScreen(this.inv, this.icons, c.slots, title, () => C.changed(c));
      this.open(s);
      // the lid opens, or the barrel shows open, until the screen closes (sim/lids.js)
      boxOpened(x, y, z, s);
      return true;
    }
    return this.itemOnBlock(hit, d);
  }
  /* What the held item does to a block, sneaking or not: tools till, flatten
     and strip, an axe scrapes copper back an age or takes its wax off (not
     with a shield up in the other hand, unless sneaking), honeycomb waxes
     copper so it never ages. A door changes both its halves. */
  itemOnBlock(hit, d) {
    const w = this.world, it = this.held ? ITEMS[this.held.id] : null, tool = it && it.tool;
    if (!it || !this.mayBuild) return false;
    // a door or trapdoor opens instead, unless you sneak (interact.js)
    if (!this.player.sneaking && (d.shape === 'door' || d.shape === 'trapdoor')) return false;
    const set = to => {
      const m = w.meta(hit.x, hit.y, hit.z);
      w.set(hit.x, hit.y, hit.z, B[to], m);
      if (d.shape === 'door') { const oy = m & 8 ? -1 : 1; if (w.get(hit.x, hit.y + oy, hit.z) === d.id) w.set(hit.x, hit.y + oy, hit.z, B[to], w.meta(hit.x, hit.y + oy, hit.z)); }
    };
    /* a compass on a lodestone points at it from now on: the compass itself if it is alone
       (in survival), else a new one, the old stack one fewer */
    if (it.name === 'compass' && d.name === 'lodestone') {
      const link = { x: hit.x, y: hit.y, z: hit.z, dim: w.dim || 'overworld' }, s = this.held;
      if (!this.creative && s.count === 1) { s.lodestone = link; this.inv.changed(); }
      else {
        if (!this.creative) this.inv.takeSelected(1);
        this.inv.placeBack({ id: s.id, count: 1, lodestone: link });
        this.inv.changed();
      }
      return true;
    }
    if (it.name === 'honeycomb' && !/^waxed_/.test(d.name) && COPPER_AGE.has(d.name) && B['waxed_' + d.name] !== undefined) {
      set('waxed_' + d.name);
      if (!this.creative) this.inv.takeSelected(1);
      return true;
    }
    if (!tool) return false;
    const above = w.get(hit.x, hit.y + 1, hit.z);
    let to = null;
    if (tool.kind === 'axe') {
      const off = this.inv.offhand, shield = off && ITEMS[off.id] && ITEMS[off.id].name === 'shield';
      if (shield && !this.player.sneaking) return false;
      if (STRIP[d.name]) to = STRIP[d.name];
      else if (/^waxed_/.test(d.name)) to = d.name.slice(6);
      else to = COPPER_BACK[d.name] || null;
    } else if (tool.kind === 'hoe' && TILL[d.name] && !above && hit.face && hit.face[1] !== -1) to = TILL[d.name];
    else if (tool.kind === 'shovel' && FLATTEN[d.name] && !above && hit.face && hit.face[1] !== -1) to = FLATTEN[d.name];
    if (!to || B[to] === undefined) return false;
    if (tool.kind === 'axe') set(to); else w.set(hit.x, hit.y, hit.z, B[to], 0);
    if (!this.creative) this.inv.damageSelected(1);
    return true;
  }

  // the work blocks: enchanting table, anvils, grindstone, smithing table, stonecutter
  openStation(d, hit) {
    const sv = this.survival, w = this.world, n = d.name;
    const levels = { level: () => sv.level, spend: k => sv.addLevels(-k) };
    if (n === 'enchanting_table') {
      const shelves = countShelves(w, hit.x, hit.y, hit.z, b => BLOCKS[b] && BLOCKS[b].name === 'bookshelf');
      this.open(new EnchantScreen(this.inv, this.icons, Object.assign({ shelves, seed: () => sv.enchantSeed, reseed: () => { sv.enchantSeed = (Math.random() * 2147483647) | 0; } }, levels)));
      return true;
    }
    if (n === 'anvil' || n === 'chipped_anvil' || n === 'damaged_anvil') {
      const x = hit.x, y = hit.y, z = hit.z;
      this.open(new AnvilScreen(this.inv, this.icons, Object.assign({
        // 12% a use, in survival: anvil -> chipped -> damaged -> gone
        used: () => {
          if (this.creative || Math.random() >= 0.12) return;
          const cur = BLOCKS[w.get(x, y, z)];
          if (!cur) return;
          const next = cur.name === 'anvil' ? 'chipped_anvil' : cur.name === 'chipped_anvil' ? 'damaged_anvil' : null;
          if (next && B[next] !== undefined) w.set(x, y, z, B[next], w.meta(x, y, z));
          else { w.set(x, y, z, 0, 0); this.gui.back(); }
        },
      }, levels)));
      return true;
    }
    if (n === 'grindstone') {
      this.open(new GrindstoneScreen(this.inv, this.icons, { xp: k => this.drops.xp(hit.x + 0.5, hit.y + 1, hit.z + 0.5, k) }));
      return true;
    }
    if (n === 'smithing_table') { this.open(new SmithingScreen(this.inv, this.icons)); return true; }
    if (n === 'stonecutter') { this.open(new StonecutterScreen(this.inv, this.icons)); return true; }
    if (n === 'loom') { this.open(new LoomScreen(this.inv, this.icons)); return true; }
    if (n === 'cartography_table') { this.open(new CartographyScreen(this.inv, this.icons)); return true; }
    return false;
  }

  // a villager's trades (entities/merchant.js): Hero of the Village takes its price off
  trade(v) {
    const fx = this.survival.effects && this.survival.effects.hero_of_the_village;
    this.open(new MerchantScreen(this.inv, this.icons, v, { player: this.player, hero: () => (fx && fx.ticks !== 0 ? fx.level : 0) }));
  }

  /* ---- right click with the item itself ---- */
  useItem(hit) {
    const s = this.held;
    if (!s) return false;
    // a lily pad or frogspawn goes on the water looked at, never on a block (the game's place-on-water items)
    const pad = BLOCKS[blockOf(s.id)];
    if (pad && pad.shape === 'pad') return this.placeOnWater(s, blockOf(s.id));
    const it = ITEMS[s.id];
    if (!it) return false;
    // bows, crossbows and tridents draw while the button is held (combat/combat.js)
    const cb = this.inter && this.inter.entities && this.inter.entities.combat;
    if (cb && !this.using && cb.useItem(s)) return true;
    const food = foodOf(s.id);
    // an item still cooling down (chorus fruit, a goat horn) does nothing, and the other hand may have its go
    if (onCooldown(it.name)) return false;
    if (food && !this.using) {
      // food that is also a block (a carrot, sweet berries) is planted when clicked on a block it can go on
      if (it.block && hit && hit.face && this.canPlant(it, hit)) return false;
      // not hungry: nothing happens, and the other hand may still have its go
      if (!(this.creative || this.survival.wantsFood(food.always))) return false;
      this.using = { slot: this.inv.selected, id: s.id, t: 0, total: food.ticks, off: !!this.offTurn };
      this.player.usingItem = true;
      return true;
    }
    if (this.using) return true;
    /* a goat horn: blown for its seven seconds, the arm up to the mouth and the step slowed as with
       anything used, and seven seconds from the first note before it sounds again (the game's
       instruments all last 7 seconds; this game has no sounds yet, onHorn is where one would go) */
    if (isBundle(s)) {
      if (!s.items || !s.items.some(Boolean)) return false;
      this.using = { slot: this.inv.selected, id: s.id, t: 0, total: 200, off: !!this.offTurn, bundle: true };
      this.player.usingItem = true;
      this.dropFromBundle();
      return true;
    }
    if (it.name === 'goat_horn') {
      this.using = { slot: this.inv.selected, id: s.id, t: 0, total: 140, off: !!this.offTurn, horn: true };
      this.player.usingItem = true;
      addCooldown('goat_horn', 140);
      if (this.onHorn) this.onHorn(s);
      return true;
    }
    // armour (not the wearable blocks, which are placed): straight on, swapping what was worn
    const ar = armorOf(s.id);
    if (ar && !it.block) {
      const old = this.inv.armor[ar.slot];
      this.inv.armor[ar.slot] = withCount(s, 1);
      if (s.count > 1) { s.count--; if (old) this.inv.placeBack(old); }
      else this.inv.slots[this.inv.selected] = old;
      this.inv.changed();
      return true;
    }
    // a shield goes up (combat.js raises it while the button is held): the use ends here, the other hand waits
    if (it.name === 'shield') return true;
    if (FILLED[it.name]) return this.emptyBucket(hit, it.name);
    if (it.name === 'bucket') return this.fillBucket();
    if (it.name === 'map') return this.newMap();
    if (it.name === 'glass_bottle') return this.fillBucket(true);
    if (it.name === 'writable_book' || it.name === 'written_book') return this.openBook(s, it.name === 'written_book');
    return false;
  }
  /* A book and quill opens to write in (what is written stays in it; signing makes it a written book by
     its author); a written book opens to read. The stack is the one in the hand when it opened. */
  openBook(s, written) {
    const inv = this.inv, slot = inv.selected, off = !!this.offTurn;
    const put = st => { if (off) inv.offhand = st; else if (inv.slots[slot] === s) inv.slots[slot] = st; inv.changed(); };
    this.open(new BookScreen({
      pages: s.pages || [], written, player: 'Player',
      done: pages => { const st = withCount(s, s.count); st.pages = pages; if (!pages.some(Boolean)) delete st.pages; put(st); },
      sign: (title, pages) => { if (I.written_book === undefined) return; put({ id: I.written_book, count: 1, pages, title, author: 'Player' }); },
    }));
    return true;
  }
  // seeds and berries go in the ground when the block clicked takes them
  canPlant(it, hit) {
    const w = this.world, d = BLOCKS[hit.b];
    if (!d || !hit.face || hit.face[1] !== 1) return false;
    const crop = BLOCKS[it.block];
    if (!crop) return false;
    if (crop.name === 'sweet_berry_bush') return /^(grass_block|dirt|podzol|coarse_dirt|farmland|moss_block|mud|rooted_dirt)$/.test(d.name);
    return d.name === 'farmland';
  }
  /* A full bucket emptied (the game's BucketItem): into the cell in front of
     the face looked at, where that is air, a fluid, or something a fluid
     washes away (it drops what it would); water boils away in the Nether, a
     fish bucket lets its fish go, and powder snow goes down as a block does
     (into a block it can replace, else in front of it). Nothing there to
     take it: the other hand may have its go. Survival is left holding the
     empty bucket, creative keeps the full one. */
  emptyBucket(hit, name) {
    if (!hit || !hit.face || !this.mayBuild) return false;
    const w = this.world, f = hit.face, fill = FILLED[name];
    let x = hit.x + f[0], y = hit.y + f[1], z = hit.z + f[2];
    if (fill === 'powder_snow' && BLOCKS[hit.b] && BLOCKS[hit.b].replaceable && !FLUID[hit.b]) { x = hit.x; y = hit.y; z = hit.z; }
    const cur = w.get(x, y, z), d = BLOCKS[cur];
    // (a fluid washes away what it can: grass, flowers, crops, torches, redstone dust; never into a block that holds water itself)
    if (cur && !FLUID[cur] && !(d && (d.replaceable || (fill !== 'powder_snow' && !d.solid && !d.waterlogged && WASHED.has(d.shape))))) return false;
    if (B[fill] === undefined) return false;
    const sim = this.inter && this.inter.sim;
    if (fill === 'water' && w.dim === 'the_nether') {
      // it boils away in a puff of smoke
      const P = this.renderer && this.renderer.particles;
      if (P && P.spawn) for (let i = 0; i < 8; i++) P.spawn(x + Math.random(), y + Math.random(), z + Math.random(), 0, 0.02, 0, { colour: 0x707070, size: 0.18, life: 20, gravity: -0.01, physics: false });
    } else {
      // a plant or the like in the way is washed out (what it drops comes out)
      if (cur && !FLUID[cur]) { if (sim) sim.destroy(x, y, z); else w.set(x, y, z, 0, 0); }
      if (w.get(x, y, z) !== B[fill]) w.set(x, y, z, B[fill], 0);
      if (this.fluids && fill !== 'powder_snow') this.fluids.around(x, y, z);
      // the fish, axolotl or tadpole it held swims out (kept: it came from a bucket)
      const mob = name.replace(/_bucket$/, '');
      if (MOB_BUCKET.test(name)) {
        const E = this.inter && this.inter.entities, e = E && E.spawn ? E.spawn(mob, x + 0.5, y, z + 0.5, { natural: false }) : null;
        if (e) e.persistent = true;
      }
    }
    if (this.renderer) this.renderer.swing = 1;
    if (!this.creative) { this.inv.slots[this.inv.selected] = { id: I.bucket, count: 1 }; this.inv.changed(); }
    return true;
  }
  // the bucket ray: the first source of water or lava along the view, within reach
  fillBucket(bottle) {
    // (an empty bucket takes nothing up in adventure; a bottle still fills)
    if (!bottle && !this.mayBuild) return false;
    const p = this.player, eye = { x: p.pos.x, y: p.pos.y + (p.sneaking ? 1.27 : 1.62), z: p.pos.z };
    const dx = -Math.sin(p.yaw) * Math.cos(p.pitch), dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    const reach = this.creative ? 5 : 4.5;
    for (let t = 0; t <= reach; t += 0.05) {
      const x = Math.floor(eye.x + dx * t), y = Math.floor(eye.y + dy * t), z = Math.floor(eye.z + dz * t);
      const b = this.world.get(x, y, z);
      if (!b) continue;
      const k = FLUID[b];
      if (!k) { if (BLOCKS[b].solid) return false; continue; }
      if (!this.fluids.isSource(x, y, z, k)) continue;
      // a glass bottle takes a drink of water and leaves the water where it is
      if (bottle) {
        if (k !== 1) return false;
        const water = { id: I.potion, count: 1, potion: 'water' };
        if (!this.creative) {
          const s = this.held;
          if (s.count <= 1) this.inv.slots[this.inv.selected] = water;
          else { s.count--; this.inv.placeBack(water); }
          this.inv.changed();
        } else this.inv.placeBack(water);
        if (this.renderer) this.renderer.swing = 1;
        return true;
      }
      this.world.set(x, y, z, 0, 0);
      this.fluids.around(x, y, z);
      const full = I[k === 1 ? BUCKETS.water : BUCKETS.lava];
      if (!this.creative) {
        const s = this.held;
        if (s.count <= 1) this.inv.slots[this.inv.selected] = { id: full, count: 1 };
        else { s.count--; this.inv.placeBack({ id: full, count: 1 }); }
        this.inv.changed();
      } else if (this.inv.findSlot(full) < 0) this.inv.add(full, 1);
      if (this.renderer) this.renderer.swing = 1;
      return true;
    }
    return false;
  }

  /* ---- maps (js/maps.js) ---- */
  // an empty map used: a map of the square you stand in, in its place
  newMap() {
    const p = this.player, m = MAPS.create(Math.floor(p.pos.x), Math.floor(p.pos.z), 0, this.world.dim || 'overworld');
    const st = { id: I.filled_map, count: 1, map: m.id };
    if (this.creative) this.inv.placeBack(st);
    else { const s = this.held; if (s.count <= 1) this.inv.slots[this.inv.selected] = st; else { s.count--; this.inv.placeBack(st); } }
    this.inv.changed();
    if (this.renderer) this.renderer.swing = 1;
    MAPS.update(m.id, this.world, p);
    return true;
  }
  // maps held in either hand fill in as you go, and the HUD shows them held up
  mapsTick() {
    for (const st of [this.held, this.inv.offhand]) if (isFilledMap(st)) MAPS.update(st.map, this.world, this.player);
    const hud = this.gui && this.gui.hud;
    if (hud && hud.under !== this.underHud) { hud.under = this.underHud || (this.underHud = (g, now) => drawHeldMaps(g, now, this.inv, this.player, this.world)); hud.markDirty(); }
  }

  /* ---- once a tick ---- */
  // the stack being eaten or drunk: the selected one, or the off hand's
  usedStack(u) { return u && u.off ? this.inv.offhand : this.held; }
  setUsedStack(u, st) { if (u && u.off) this.inv.offhand = st; else this.inv.slots[this.inv.selected] = st; }
  tick() {
    this.mapsTick();
    // gliding wears the elytra a point a second (never past its last point)
    if (this.player && this.player.gliding && !this.creative) {
      if (++this.glideT % 20 === 0) { const c = this.inv.armor[1]; if (c) { c.dmg = Math.min((ITEMS[c.id].dur || 432) - 1, (c.dmg | 0) + 1); this.inv.changed(); } }
    } else this.glideT = 0;
    const u = this.using;
    if (!u) return;
    const s = this.usedStack(u);
    // let go, switched slot (for the main hand) or item: stop
    if (!this.inter.useHeld || (!u.off && this.inv.selected !== u.slot) || !s || s.id !== u.id) { this.stopUsing(); return; }
    u.t++;
    if (u.horn) { if (u.t >= u.total) this.stopUsing(); return; }
    if (u.bundle) { if (u.t > 10 && u.t % 2 === 0 && !this.dropFromBundle()) this.stopUsing(); else if (u.t >= u.total) this.stopUsing(); return; }
    if (u.t > 7 && (u.total - u.t) % 4 === 0) {
      this.crumbs(u.id);
      if (this.onEat) this.onEat(u.id);
    }
    if (u.t >= u.total) this.finish(u.id);
  }
  stopUsing() { this.using = null; this.player.usingItem = false; }
  finish(id) {
    const it = ITEMS[id], food = it.food, sv = this.survival, u = this.using;
    const s = this.usedStack(u);
    this.stopUsing();
    if (food.hunger || food.saturation) sv.eat(food.hunger, food.saturation);
    // (an ominous bottle's Bad Omen is as strong as the bottle says)
    const amp = it.name === 'ominous_bottle' && s ? (s.amp | 0) : 0;
    if (food.effects) for (const [name, level, secs, chance] of food.effects) if (Math.random() < chance) sv.addEffect(name, level + amp, secs * 20);
    if (it.name === 'milk_bucket') sv.clearEffects();
    if (it.name === 'honey_bottle') delete sv.effects.poison;
    if (it.name === 'chorus_fruit') { this.chorusTeleport(); addCooldown('chorus_fruit', 20); }
    if (isPotion(s)) drinkPotion(s, sv);
    // a suspicious stew's effect (a farmer's, or one from flowers)
    const stew = stewEffect(s);
    if (stew) sv.addEffect(stew[0], 1, stew[1]);
    if (!this.creative && s) {
      s.count--;
      const left = food.leaves ? I[food.leaves] : 0;
      if (s.count <= 0) this.setUsedStack(u, left ? { id: left, count: 1 } : null);
      else if (left) this.inv.placeBack({ id: left, count: 1 });
      this.inv.changed();
    }
    if (this.onBurp) this.onBurp(id);
  }
  // chorus fruit: up to 16 tries for a spot within 8 blocks with ground under it
  chorusTeleport() {
    const p = this.player, w = this.world;
    for (let k = 0; k < 16; k++) {
      const x = Math.floor(p.pos.x + (Math.random() - 0.5) * 16), z = Math.floor(p.pos.z + (Math.random() - 0.5) * 16);
      let y = Math.floor(p.pos.y + (Math.random() - 0.5) * 16);
      for (let n = 0; n < 16 && y > 0 && !(BLOCKS[w.get(x, y - 1, z)] || {}).solid; n++) y--;
      if (!(BLOCKS[w.get(x, y - 1, z)] || {}).solid || w.get(x, y, z) || w.get(x, y + 1, z)) continue;
      p.pos.set(x + 0.5, y, z + 0.5); p.prev.copy(p.pos); p.vel.set(0, 0, 0);
      return;
    }
  }
  crumbs(id) {
    const p = this.player;
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    if (this.drops.crumbs) this.drops.crumbs(p.pos.x + dx * 0.35, p.pos.y + 1.45, p.pos.z + dz * 0.35, id, 5, dx, dz);
  }
  /* The walking bob for the hands, with what the use button is doing with
     them (render/held.js moves the hand for it): eating or drinking here, a
     bow, crossbow, trident or shield in combat/combat.js. use: { kind, side
     (0 main hand, 1 off), t (ticks so far), total }, or null. */
  handBob(bob) {
    const u = this.using, a = this.alpha || 0;
    const out = this._bob || (this._bob = { x: 0, y: 0, rz: 0, rx: 0, use: null }), U = this._use || (this._use = {});
    out.x = bob ? bob.x : 0; out.y = bob ? bob.y : 0; out.rz = bob && bob.rz || 0; out.rx = bob && bob.rx || 0;
    out.use = null;
    if (u) {
      const food = ITEMS[u.id] && ITEMS[u.id].food;
      U.kind = u.horn ? 'horn' : food && food.drink ? 'drink' : 'eat'; U.side = u.off ? 1 : 0; U.t = u.t + a; U.total = u.total;
      out.use = U;
    } else {
      const cb = this.inter && this.inter.entities && this.inter.entities.combat;
      if (cb && cb.useState) out.use = cb.useState(a);
      // a spyglass up to the eye (main.js draws the glass in first person; this is the arm, for third person)
      if (!out.use && this.inter && this.inter.useHeld) {
        const side = this.spyglassSide();
        if (side >= 0) { U.kind = 'spyglass'; U.side = side; U.t = 0; U.total = 0; out.use = U; }
      }
    }
    return out;
  }

  /* On the first still water along the look within reach (flowing water is
     looked through, anything solid stops it): the block put on top of it,
     if that cell is free. */
  placeOnWater(s, block) {
    if (!this.mayBuild) return false;
    const p = this.player, w = this.world, eye = p.view(1).eye;
    const dx = -Math.sin(p.yaw) * Math.cos(p.pitch), dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    const reach = this.creative ? 5 : 4.5;
    for (let t = 0; t <= reach; t += 0.05) {
      const x = Math.floor(eye.x + dx * t), y = Math.floor(eye.y + dy * t), z = Math.floor(eye.z + dz * t), b = w.get(x, y, z);
      if (!b) continue;
      if (FLUID[b] === 1) {
        if (w.meta(x, y, z) & 15) continue;
        const up = w.get(x, y + 1, z);
        if (up && !(BLOCKS[up] && BLOCKS[up].replaceable && !FLUID[up])) return false;
        w.set(x, y + 1, z, block || s.id, 0);
        if (!this.creative) this.inv.takeSelected(1);
        if (this.renderer) this.renderer.swing = 1;
        return true;
      }
      if (BLOCKS[b].solid) return false;
    }
    return false;
  }
  // the newest stack in the bundle in use thrown out ahead, as a dropped item is; false once it is empty
  dropFromBundle() {
    const s = this.usedStack(this.using);
    const out = s && bundleTake(s);
    if (!out) return false;
    this.throwStack(out);
    this.inv.changed();
    return true;
  }
  // the hand a spyglass is held up with: the main hand, or the off hand while the main hand is empty (-1: none)
  spyglassSide() {
    const m = this.inv.slots[this.inv.selected], o = this.inv.offhand;
    if (m) return ITEMS[m.id] && ITEMS[m.id].name === 'spyglass' ? 0 : -1;
    return o && ITEMS[o.id] && ITEMS[o.id].name === 'spyglass' ? 1 : -1;
  }

  /* ---- wear from use away from blocks ---- */
  // pieces of a worn-out tool or armour fly out in front of the face, as in the game
  toolBroke(s) {
    const p = this.player;
    if (!s || !p || !this.drops || !this.drops.crumbs) return;
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    this.drops.crumbs(p.pos.x + dx * 0.4, p.pos.y + (p.sneaking ? 1.27 : 1.62) - 0.3, p.pos.z + dz * 0.4, s.id, 5, dx, dz);
    if (this.onToolBreak) this.onToolBreak(s);
  }
  /* The held item used on a mob (js/entities): a sword wears 1 a hit, other
     tools 2, shears and the like 1. A shield wears where it is held, main
     hand or off hand. Unbreaking applies (ui/inventory.js wear). */
  wearHeld(n, kind) {
    if (this.creative || !n) return;
    const inv = this.inv;
    if (kind === 'shield') {
      const isShield = st => st && ITEMS[st.id] && ITEMS[st.id].name === 'shield';
      if (isShield(this.held)) { inv.damageSelected(n); return; }
      const off = inv.offhand;
      if (!isShield(off)) return;
      if (wear(off, n, false)) { inv.offhand = null; inv.emit('broke', off); }
      inv.changed();
      return;
    }
    const s = this.held;
    if (s && ITEMS[s.id] && ITEMS[s.id].dur) inv.damageSelected(n);
  }
  // a bucket that took something from a mob (milk from a cow): one empty bucket becomes it
  fillHeld(name) {
    const s = this.held, full = I[name];
    if (!s || full === undefined || !ITEMS[s.id] || ITEMS[s.id].name !== 'bucket') return false;
    if (this.creative) { if (this.inv.findSlot(full) < 0) this.inv.add(full, 1); return true; }
    if (s.count <= 1) this.inv.slots[this.inv.selected] = { id: full, count: 1 };
    else { s.count--; this.inv.placeBack({ id: full, count: 1 }); }
    this.inv.changed();
    return true;
  }
  /* Mending: an orb of n points mends a worn item with Mending held or worn
     (one picked at random), two durability a point, and takes one point for
     every two it mended. While points are left and such an item is still
     worn, they go to it before the bar. Returns the points left for the bar. */
  mend(n) {
    const inv = this.inv;
    let guard = 0;
    while (n > 0 && guard++ < 16) {
      const worn = [inv.slots[inv.selected], inv.offhand].concat(inv.armor).filter(x => x && x.dmg > 0 && x.ench && x.ench.mending);
      if (!worn.length) break;
      const it = worn[Math.floor(Math.random() * worn.length)], fix = Math.min(n * 2, it.dmg);
      it.dmg -= fix;
      n -= Math.floor(fix / 2);
    }
    inv.changed();
    return n;
  }

  /* ---- Q ---- */
  dropSelected(all) {
    const s = this.held;
    if (!s) return;
    const n = all ? s.count : 1;
    this.drops.throwFrom(this.player, withCount(s, n));
    s.count -= n;
    if (s.count <= 0) this.inv.slots[this.inv.selected] = null;
    if (this.renderer) this.renderer.swing = 1;
    this.inv.changed();
  }
  // a stack thrown out of a screen
  throwStack(st) { if (st && st.count > 0) this.drops.throwFrom(this.player, st); }

  /* ---- dying: everything spills, and some of the experience ---- */
  spillAll() {
    const inv = this.inv, p = this.player, all = [];
    for (let i = 0; i < 36; i++) if (inv.slots[i]) { all.push(inv.slots[i]); inv.slots[i] = null; }
    for (let i = 0; i < 4; i++) if (inv.armor[i]) { all.push(inv.armor[i]); inv.armor[i] = null; }
    if (inv.offhand) { all.push(inv.offhand); inv.offhand = null; }
    for (let i = 0; i < 4; i++) if (inv.craft[i]) { all.push(inv.craft[i]); inv.craft[i] = null; }
    if (inv.carried) { all.push(inv.carried); inv.carried = null; }
    for (const s of all) {
      if (s.ench && s.ench.vanishing_curse) continue;
      const f = Math.random() * 0.5, a = Math.random() * Math.PI * 2;
      this.drops.spawn(p.pos.x, p.pos.y + 1.32, p.pos.z, s, { delay: 40, vel: [-Math.sin(a) * f, 0.2, Math.cos(a) * f] });
    }
    const xp = this.survival.deathXp();
    if (xp) this.drops.xp(p.pos.x, p.pos.y + 0.5, p.pos.z, xp);
    this.survival.level = 0; this.survival.xpProgress = 0;
    inv.changed();
  }

  toJSON() { return { ender: this.ender.map(stackToJSON) }; }
  fromJSON(o) {
    if (!o || !Array.isArray(o.ender)) return;
    for (let i = 0; i < 27; i++) this.ender[i] = stackFromJSON(o.ender[i]);
  }
}
