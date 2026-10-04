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
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID, OPAQUE } from './blocks.js?v=8';
import { I, ITEMS, blockOf, foodOf, armorOf, withCount, stackToJSON, stackFromJSON } from './items.js?v=8';
import { breakTicks, wearFor } from './mining.js?v=8';
import { blockDrops } from './loot.js?v=8';
import { containerKind } from './containers.js?v=8';
import { CraftingScreen, ChestScreen, FurnaceScreen } from './ui/containers.js?v=8';

const BUCKETS = { water: 'water_bucket', lava: 'lava_bucket' };
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
    this.ender = new Array(27).fill(null);
    this.onEat = null;               // (id) the eating sound, every 4 ticks
    this.onBurp = null;
  }
  get creative() { return this.mode === 'creative'; }
  get held() { return this.inv.slots[this.inv.selected]; }

  /* ---- the Interactor's hand ---- */
  adapter(renderer) {
    const self = this;
    return {
      id: () => { const s = self.held; return s ? blockOf(s.id) : 0; },
      used: () => self.placed(),
      got: id => self.inv.add(id, 1),
      swing: () => { renderer.swing = 1; },
      progress: hit => self.progress(hit),
      broke: (hit, cells) => self.broke(hit, cells),
      useOn: hit => self.useOn(hit),
      useItem: hit => self.useItem(hit),
    };
  }
  // a block was placed from the selected stack: one fewer, and a bucket leaves its bucket
  placed() {
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
    if (!this.creative) {
      const held = this.held;
      const out = blockDrops(w, hit.x, hit.y, hit.z, b, m, { stack: held });
      for (const s of out.items) this.drops.popFrom(hit.x, hit.y, hit.z, s);
      if (out.xp) this.drops.xp(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, out.xp);
      // the rest: what stood on it or hung from it pops off (not the other half of the same block)
      for (const [x, y, z] of cells) {
        if (x === hit.x && y === hit.y && z === hit.z) continue;
        const ob = w.get(x, y, z);
        if (!ob || ob === b || (BLOCKS[ob].lower && B[BLOCKS[ob].lower] === b) || (d.lower && B[d.lower] === ob)) continue;
        const o = blockDrops(w, x, y, z, ob, w.meta(x, y, z), { popped: true });
        for (const s of o.items) this.drops.popFrom(x, y, z, s);
      }
      // ice without Silk Touch melts into water if something is under it
      if (d.name === 'ice' && !(held && held.ench && held.ench.silk_touch)) {
        const under = w.get(hit.x, hit.y - 1, hit.z);
        if (under && (BLOCKS[under].solid || FLUID[under])) replace = B.water;
      }
      const wr = wearFor(held, d);
      if (wr) this.inv.damageSelected(wr);
      this.survival.exhaust(0.005);
    }
    // a container's contents spill (in creative too, as in the game)
    for (const [x, y, z] of cells) {
      for (const s of this.containers.remove(x, y, z)) {
        // the game throws them out in parts of 10-30
        let left = s.count;
        while (left > 0) {
          const n = Math.min(left, 10 + Math.floor(Math.random() * 21));
          left -= n;
          this.drops.spawn(x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7, withCount(s, n),
            { vel: [(Math.random() - 0.5) * 0.1, 0.2 * Math.random() + 0.05, (Math.random() - 0.5) * 0.1] });
        }
      }
    }
    return replace;
  }

  /* ---- right click on a block ---- */
  useOn(hit) {
    const w = this.world, b = hit.b, d = BLOCKS[b];
    if (!d || w.get(hit.x, hit.y, hit.z) !== b) return false;
    const holding = !!this.held || !!this.inv.offhand;
    if (this.player.sneaking && holding) return false;
    if (d.name === 'crafting_table') { this.open(new CraftingScreen(this.inv, this.icons)); return true; }
    if (d.name === 'ender_chest') {
      if (OPAQUE[w.get(hit.x, hit.y + 1, hit.z)]) return true;
      this.open(new ChestScreen(this.inv, this.icons, this.ender, 'Ender Chest'));
      return true;
    }
    const kind = containerKind(b);
    if (kind) {
      const C = this.containers;
      if (kind === 'furnace' || kind === 'smoker' || kind === 'blast_furnace') {
        const c = C.at(hit.x, hit.y, hit.z);
        this.open(new FurnaceScreen(this.inv, this.icons, c, {
          changed: () => C.changed(c),
          tookXp: n => { const x = C.takeXp(c, n); if (x > 0) this.drops.xp(this.player.pos.x, this.player.pos.y + 0.5, this.player.pos.z, x); },
        }));
        return true;
      }
      if ((kind === 'chest' || kind === 'trapped_chest') && OPAQUE[w.get(hit.x, hit.y + 1, hit.z)]) return true;
      const c = C.at(hit.x, hit.y, hit.z);
      const p = kind === 'chest' || kind === 'trapped_chest' ? C.partner(hit.x, hit.y, hit.z) : null;
      if (p && !OPAQUE[w.get(p[0], p[1] + 1, p[2])]) {
        // a double chest: the one further west (or north) is the top half
        const c2 = C.at(p[0], p[1], p[2]);
        const first = p[0] < hit.x || p[2] < hit.z ? [c2, c] : [c, c2];
        const box = first[0].slots.concat(first[1].slots);
        this.open(new ChestScreen(this.inv, this.icons, box, 'Large Chest', i => {
          const half = i < 27 ? first[0] : first[1];
          half.slots[i % 27] = box[i];
          C.changed(half);
        }));
        return true;
      }
      const title = kind === 'barrel' ? 'Barrel' : kind === 'trapped_chest' ? 'Chest' : kind === 'shulker_box' ? 'Shulker Box'
        : kind === 'dispenser' ? 'Dispenser' : kind === 'dropper' ? 'Dropper' : kind === 'hopper' ? 'Item Hopper' : 'Chest';
      this.open(new ChestScreen(this.inv, this.icons, c.slots, title, () => C.changed(c)));
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

  /* ---- right click with the item itself ---- */
  useItem(hit) {
    const s = this.held;
    if (!s) return false;
    const it = ITEMS[s.id];
    if (!it) return false;
    const food = foodOf(s.id);
    if (food && !this.using) {
      // food that is also a block (a carrot, sweet berries) is planted when clicked on a block it can go on
      if (it.block && hit && hit.face && this.canPlant(it, hit)) return false;
      if (!(this.creative || this.survival.wantsFood(food.always))) return !it.block;
      this.using = { slot: this.inv.selected, id: s.id, t: 0, total: food.ticks };
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
  fillBucket() {
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
  tick() {
    const u = this.using;
    if (!u) return;
    const s = this.held;
    // let go, switched slot or item: stop
    if (!this.inter.useHeld || this.inv.selected !== u.slot || !s || s.id !== u.id) { this.stopUsing(); return; }
    u.t++;
    if (u.t > 7 && (u.total - u.t) % 4 === 0) {
      this.crumbs(u.id);
      if (this.onEat) this.onEat(u.id);
    }
    if (u.t >= u.total) this.finish(u.id);
  }
  stopUsing() { this.using = null; this.player.usingItem = false; }
  finish(id) {
    const it = ITEMS[id], food = it.food, sv = this.survival;
    this.stopUsing();
    if (food.hunger || food.saturation) sv.eat(food.hunger, food.saturation);
    if (food.effects) for (const [name, level, secs, chance] of food.effects) if (Math.random() < chance) sv.addEffect(name, level, secs * 20);
    if (it.name === 'milk_bucket') sv.clearEffects();
    if (it.name === 'honey_bottle') delete sv.effects.poison;
    if (it.name === 'chorus_fruit') this.chorusTeleport();
    if (!this.creative) {
      const s = this.held;
      s.count--;
      const left = food.leaves ? I[food.leaves] : 0;
      if (s.count <= 0) this.inv.slots[this.inv.selected] = left ? { id: left, count: 1 } : null;
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
    if (!u) return bob;
    const t = u.t + (this.alpha || 0), k = Math.min(1, t / 6);
    const out = this._bob || (this._bob = { x: 0, y: 0 });
    out.x = (bob ? bob.x : 0) - 0.42 * k;
    out.y = (bob ? bob.y : 0) + 0.2 * k + (t > 6 ? Math.abs(Math.cos(t / 4 * Math.PI)) * 0.06 : 0);
    return out;
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
