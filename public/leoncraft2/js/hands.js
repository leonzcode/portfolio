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
import { B, BLOCKS, FLUID, OPAQUE } from './blocks.js?v=12';
import { I, ITEMS, blockOf, foodOf, armorOf, withCount, stackToJSON, stackFromJSON } from './items.js?v=12';
import { breakTicks, wearFor } from './mining.js?v=12';
import { blockDrops } from './loot.js?v=12';
import { containerKind, spill } from './containers.js?v=12';
import { CraftingScreen, ChestScreen, ShulkerScreen, DispenserScreen, CrafterScreen, FurnaceScreen, HopperScreen, BrewingScreen } from './ui/containers.js?v=12';
import { isPotion, drinkPotion } from './brewing.js?v=12';
import { EnchantScreen, AnvilScreen, GrindstoneScreen, SmithingScreen, StonecutterScreen } from './ui/workstations.js?v=12';
import { countShelves } from './enchanting.js?v=12';
import { wear } from './ui/inventory.js?v=12';

const BUCKETS = { water: 'water_bucket', lava: 'lava_bucket' };
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
    // the screens' sheets, fetched now so a chest never opens on an empty frame
    if (this.gui && this.gui.loadSheet) for (const n of ['crafting_table', 'generic_54', 'shulker_box', 'dispenser', 'crafter', 'hopper', 'brewing_stand', 'furnace', 'smoker', 'blast_furnace', 'enchanting_table', 'anvil', 'grindstone', 'smithing', 'stonecutter'])
      this.gui.loadSheet('container/' + n).catch(() => {});
  }
  get creative() { return this.mode === 'creative'; }
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
      for (const s of out.items) {
        if (inBox && s.id === b && !s.items) s.items = inBox;
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
    return replace;
  }

  /* ---- right click on a block ---- */
  useOn(hit) {
    const w = this.world, b = hit.b, d = BLOCKS[b];
    if (!d || w.get(hit.x, hit.y, hit.z) !== b) return false;
    const holding = !!this.held || !!this.inv.offhand;
    if (this.player.sneaking && holding) return false;
    if (d.name === 'crafting_table') { this.open(new CraftingScreen(this.inv, this.icons)); return true; }
    if (this.openStation(d, hit)) return true;
    if (d.name === 'ender_chest') {
      if (OPAQUE[w.get(hit.x, hit.y + 1, hit.z)]) return true;
      this.open(new ChestScreen(this.inv, this.icons, this.ender, 'Ender Chest'));
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
        this.open(new ChestScreen(this.inv, this.icons, box, 'Large Chest', i => C.changed(i < 27 ? two[0] : two[1])));
        return true;
      }
      if (kind === 'hopper') { this.open(new HopperScreen(this.inv, this.icons, c.slots, () => C.changed(c))); return true; }
      if (kind === 'brewing_stand') { this.open(new BrewingScreen(this.inv, this.icons, c, { changed: () => C.changed(c) })); return true; }
      if (kind === 'dispenser' || kind === 'dropper') { this.open(new DispenserScreen(this.inv, this.icons, c.slots, kind === 'dropper' ? 'Dropper' : 'Dispenser', () => C.changed(c))); return true; }
      if (kind === 'crafter') { this.open(new CrafterScreen(this.inv, this.icons, c, { changed: () => C.changed(c), powered: () => !!(w.meta(x, y, z) & 8) })); return true; }
      const title = kind === 'barrel' ? 'Barrel' : kind === 'shulker_box' ? 'Shulker Box' : 'Chest';
      this.open(kind === 'shulker_box' ? new ShulkerScreen(this.inv, this.icons, c.slots, title, () => C.changed(c)) : new ChestScreen(this.inv, this.icons, c.slots, title, () => C.changed(c)));
      return true;
    }
    // tools on the ground and on logs
    const it = this.held ? ITEMS[this.held.id] : null, tool = it && it.tool;
    if (tool && !this.player.sneaking) {
      const above = w.get(hit.x, hit.y + 1, hit.z);
      let to = null;
      if (tool.kind === 'axe' && STRIP[d.name]) to = STRIP[d.name];
      else if (tool.kind === 'hoe' && TILL[d.name] && !above && hit.face && hit.face[1] !== -1) to = TILL[d.name];
      else if (tool.kind === 'shovel' && FLATTEN[d.name] && !above && hit.face && hit.face[1] !== -1) to = FLATTEN[d.name];
      if (to && B[to] !== undefined) {
        w.set(hit.x, hit.y, hit.z, B[to], tool.kind === 'axe' ? w.meta(hit.x, hit.y, hit.z) : 0);
        if (!this.creative) this.inv.damageSelected(1);
        return true;
      }
    }
    return false;
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
    return false;
  }

  /* ---- right click with the item itself ---- */
  useItem(hit) {
    const s = this.held;
    if (!s) return false;
    const it = ITEMS[s.id];
    if (!it) return false;
    // bows, crossbows and tridents draw while the button is held (combat/combat.js)
    const cb = this.inter && this.inter.entities && this.inter.entities.combat;
    if (cb && !this.using && cb.useItem(s)) return true;
    const food = foodOf(s.id);
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
    if (it.name === 'bucket') return this.fillBucket();
    if (it.name === 'glass_bottle') return this.fillBucket(true);
    return false;
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
  // the bucket ray: the first source of water or lava along the view, within reach
  fillBucket(bottle) {
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

  /* ---- once a tick ---- */
  // the stack being eaten or drunk: the selected one, or the off hand's
  usedStack(u) { return u && u.off ? this.inv.offhand : this.held; }
  setUsedStack(u, st) { if (u && u.off) this.inv.offhand = st; else this.inv.slots[this.inv.selected] = st; }
  tick() {
    const u = this.using;
    if (!u) return;
    const s = this.usedStack(u);
    // let go, switched slot (for the main hand) or item: stop
    if (!this.inter.useHeld || (!u.off && this.inv.selected !== u.slot) || !s || s.id !== u.id) { this.stopUsing(); return; }
    u.t++;
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
    if (food.effects) for (const [name, level, secs, chance] of food.effects) if (Math.random() < chance) sv.addEffect(name, level, secs * 20);
    if (it.name === 'milk_bucket') sv.clearEffects();
    if (it.name === 'honey_bottle') delete sv.effects.poison;
    if (it.name === 'chorus_fruit') this.chorusTeleport();
    if (isPotion(s)) drinkPotion(s, sv);
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
  // the held item moves to the mouth and bobs while eating (an offset for the hand's sway)
  handBob(bob) {
    const u = this.using;
    if (!u || u.off) { const cb = this.inter && this.inter.entities && this.inter.entities.combat; return cb ? cb.handPose(bob, this.alpha || 0) : bob; }
    const t = u.t + (this.alpha || 0), k = Math.min(1, t / 6);
    const out = this._bob || (this._bob = { x: 0, y: 0 });
    out.x = (bob ? bob.x : 0) - 0.42 * k;
    out.y = (bob ? bob.y : 0) + 0.2 * k + (t > 6 ? Math.abs(Math.cos(t / 4 * Math.PI)) * 0.06 : 0);
    return out;
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
