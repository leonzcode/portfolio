/* ---------------------------------------------------------------------------
   Leoncraft 2 - mining and building, tick by tick.

   As in the game: in creative a click breaks the block at once, and holding
   the button breaks another every five ticks; in survival holding it wears
   the block down over its break time, the cracks growing through ten
   stages, and looking away starts again. Holding the use button places (or
   opens a door) again every four ticks. The block you look at gets the thin
   black outline.

   The hand is an adapter the game passes in:
     hand.id()        the block in the selected slot (0 for none)
     hand.used()      one was placed (survival takes it from the stack)
     hand.got(id)     a broken block to keep (survival only)
     hand.swing()     start the arm swing
     hand.key()       what is held, as a string (a different item starts the mining again)
     hand.withOffhand(fn)  run fn with the off hand's stack in the main hand's place

   And two the renderer listens to for particles (either may be absent):
     onBreak(x, y, z, block, boxes)        a block broke
     onHit(x, y, z, face, block, box)      a tick of mining it
   and, when the game gives them (hands.js), the item rules:
     hand.progress(hit)      the share of the block one tick of mining wears away
     hand.broke(hit, cells)  the block is going: drops, wear (returns what replaces it)
     hand.useOn(hit)         right click on a block (chests, tables); true if it did something
     hand.useItem(hit)       right click with the item (eat, armour, buckets); true if it did
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=10';
import { selectionBoxes } from './models.js?v=10';
import { placement, use, breakAt } from './place.js?v=10';
import { breakTime, dropOf } from './survival.js?v=10';

export class Interactor {
  constructor(o) {
    Object.assign(this, o);       // world, player, fluids, renderer, overlay, hand, onSplash
    this.creative = true;
    this.attack = false; this.useHeld = false;
    this.mining = null;           // { x, y, z, b, t, total }
    this.breakDelay = 0; this.useDelay = 0;
    this.target = null;
  }
  // what the crosshair is on, from the eye this frame
  look(eye) {
    let hit = this.player.pick(eye, this.creative ? 5 : 4.5);
    // a mob or a boat in front of the block is what you are looking at (js/entities)
    this.entityTarget = this.entities ? this.entities.pickFor(eye, hit ? hit.t : undefined) : null;
    if (this.entityTarget) hit = null;
    this.target = hit;
    if (!hit) { this.overlay && this.overlay.set(0, 0, 0, null, -1); return null; }
    const w = this.world, d = BLOCKS[hit.b];
    const nb = (dx, dy, dz) => { const n = w.get(hit.x + dx, hit.y + dy, hit.z + dz); return n ? { d: BLOCKS[n], m: w.meta(hit.x + dx, hit.y + dy, hit.z + dz) } : null; };
    let stage = -1;
    const mm = this.mining;
    // the cracks: none until some of the block is worn away, then a stage for each tenth
    if (mm && mm.x === hit.x && mm.y === hit.y && mm.z === hit.z && mm.total > 0 && mm.t > 0) stage = Math.min(9, Math.floor(mm.t / mm.total * 10));
    if (this.overlay) this.overlay.set(hit.x, hit.y, hit.z, selectionBoxes(d, w.meta(hit.x, hit.y, hit.z), nb), stage);
    return hit;
  }
  down(button) {
    // while something is in use (eating, a drawn bow, a raised shield) the attack button does nothing, as in the game
    if (button === 0 && this.player.usingItem) return;
    // an entity under the crosshair: hit it, or use it (js/entities)
    const e = this.entityTarget;
    if (e && this.entities) {
      if (button === 0) { this.attack = true; this.hand.swing(); this.entities.attack(e); return; }
      if (button === 2 && this.entities.interact(e)) { this.useHeld = true; this.useDelay = 4; this.hand.swing(); return; }
    }
    if (button === 0 && !this.target && this.entities) this.entities.swung();
    if (button === 0) {
      // the dragon or a crystal nearer than the block (js/dim/realms.js)
      if (this.onAttack && this.onAttack(this.target)) { this.hand.swing(); return; }
      this.attack = true;
      this.hand.swing();
      if (this.creative) { this.breakTarget(); this.breakDelay = 5; }
      else this.startMining();
    } else if (button === 2) {
      this.useHeld = true;
      this.useOnce();
      this.useDelay = 4;
    }
  }
  up(button) {
    if (button === 0) { this.attack = false; this.mining = null; }
    if (button === 2) this.useHeld = false;
  }
  // once a tick
  tick() {
    if (this.attack) {
      if (this.creative) { if (--this.breakDelay <= 0) { this.hand.swing(); this.breakTarget(); this.breakDelay = 5; } }
      else this.mineTick();
    }
    if (this.useHeld && --this.useDelay <= 0) { this.useOnce(); this.useDelay = 4; }
  }
  startMining() {
    const h = this.target;
    if (!h) { this.mining = null; return; }
    // with the hand's rules, t runs from 0 to 1 by the tool's progress a tick; without, seconds by hand
    const total = this.hand.progress ? 1 : breakTime(BLOCKS[h.b]);
    this.mining = { x: h.x, y: h.y, z: h.z, b: h.b, t: 0, total, ticks: 0, key: this.hand.key ? this.hand.key() : '' };
    // a block that goes at once leaves no delay, so holding the button mows grass or insta-mines stone a block a tick
    if (this.hand.progress ? this.hand.progress(h) >= 1 : total === 0) { this.breakTarget(); this.mining = null; }
  }
  mineTick() {
    // after a block that took time breaks, five ticks before the next one starts (as the game does)
    if (this.breakDelay > 0) { this.breakDelay--; return; }
    const h = this.target, m = this.mining;
    if (!h) { this.mining = null; return; }
    // another block, or another item in the hand: start again from nothing
    if (!m || m.x !== h.x || m.y !== h.y || m.z !== h.z || m.b !== h.b || (this.hand.key && m.key !== this.hand.key())) { this.startMining(); return; }
    m.t += this.hand.progress ? this.hand.progress(h) : 0.05;
    if (++m.ticks % 4 === 0) this.hand.swing();
    if (this.onHit) this.onHit(h.x, h.y, h.z, h.face, h.b, h.box);
    if (m.t >= m.total - 1e-9) { this.breakTarget(); this.mining = null; this.breakDelay = 5; }
  }
  breakTarget() {
    const h = this.target;
    if (!h) return;
    const w = this.world;
    const cells = breakAt(w, h.x, h.y, h.z);
    // a block broken starts the attack cooldown again
    if (this.entities) this.entities.swung();
    // the hand's rules decide the drops (and what is left behind: ice leaves water)
    const replace = this.hand.broke ? this.hand.broke(h, cells) : 0;
    for (const [x, y, z] of cells) {
      const b = w.get(x, y, z), d = BLOCKS[b];
      if (this.onBreak && d && d.shape !== 'fluid') {
        const nb = (dx, dy, dz) => { const n = w.get(x + dx, y + dy, z + dz); return n ? { d: BLOCKS[n], m: w.meta(x + dx, y + dy, z + dz) } : null; };
        this.onBreak(x, y, z, b, d.shape === 'cube' ? null : selectionBoxes(d, w.meta(x, y, z), nb));
      }
      // the simulation hears of it (sim/sim.js); drops come from the loot tables (hands.js), or the
      // simulation's loot, or the block itself
      const loot = this.sim ? this.sim.broken(x, y, z, b, w.meta(x, y, z)) : null;
      if (!this.creative && !this.hand.broke) {
        if (loot) for (const [n, c] of loot) this.sim.dropItem(x + 0.5, y + 0.5, z + 0.5, n, c);
        else { const drop = dropOf(b); if (drop) this.hand.got(drop); }
      }
      w.set(x, y, z, replace && x === h.x && y === h.y && z === h.z ? replace : 0, 0);
      if (this.onBroken) this.onBroken(x, y, z, b);
      // a water plant leaves its water behind
      if (d && d.waterlogged) w.set(x, y, z, B.water, 0);
      this.fluids.around(x, y, z);
    }
    this.target = null;
  }
  useOnce() {
    if (this.useWith()) return;
    // the main hand had nothing to do: the off hand has its turn (a torch beside the pickaxe, food), as in the game
    if (this.hand.withOffhand) this.hand.withOffhand(() => this.useWith());
  }
  // one right click with what is in the hand (hands.js swaps the off hand in for its turn); true when it did something
  useWith() {
    // things that make an entity: boats, spawn eggs, thrown eggs and snowballs (js/entities)
    if (this.entities && !this.entityTarget && this.entities.useHeld(this.target)) { this.hand.swing(); return true; }
    const h = this.target;
    // at nothing: an item that is thrown (an eye of ender), or one that works by itself (eating, armour, a bucket)
    if (!h || !h.face) {
      const held = this.hand.id();
      if (held && this.onUseAir && this.onUseAir(held)) { this.hand.swing(); return true; }
      return !!(this.hand.useItem && this.hand.useItem(null));
    }
    // chests, crafting tables, furnaces open; tools till and strip (hands.js)
    if (this.hand.useOn && this.hand.useOn(h)) { this.hand.swing(); return true; }
    // portals, eyes in frames, beds and anchors where they explode (js/dim/realms.js)
    if (this.onUse && this.onUse(h, this.hand.id())) { this.hand.swing(); return true; }
    // what the simulation does with a click: levers, beds, bone meal, flint and steel (sim/sim.js)
    if (this.sim && this.sim.use(h, this.hand.id(), this.player.sneaking)) {
      this.hand.swing();
      if (this.sim.usedHeld) { this.sim.usedHeld = false; this.hand.used(); }
      if (this.sim.wornHeld) { const n = this.sim.wornHeld; this.sim.wornHeld = 0; if (this.hand.wear) this.hand.wear(n); }
      return true;
    }
    // doors, trapdoors and gates open instead, unless you sneak
    if (!this.player.sneaking && use(this.world, h.x, h.y, h.z)) { this.hand.swing(); return true; }
    if (this.hand.useItem && this.hand.useItem(h)) return true;
    const id = this.hand.id();
    if (!id || !BLOCKS[id] || BLOCKS[id].place === false) return false;
    let list = placement(this.world, h, id, this.player);
    if (list.length && this.sim) list = this.sim.placed(list, h, id);
    if (!list.length) return false;
    for (const [x, y, z, b, m] of list) {
      const cur = this.world.get(x, y, z);
      this.world.set(x, y, z, b, m);
      if (FLUID[cur] === 1 && this.onSplash) this.onSplash(x + 0.5, z + 0.5);
      this.fluids.around(x, y, z);
    }
    this.hand.swing();
    this.hand.used(list);           // (what was placed, for blocks that hold things)
    return true;
  }
}
