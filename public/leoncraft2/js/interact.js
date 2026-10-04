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

   And two the renderer listens to for particles (either may be absent):
     onBreak(x, y, z, block, boxes)        a block broke
     onHit(x, y, z, face, block, box)      a tick of mining it
   and, when the game gives them (hands.js), the item rules:
     hand.progress(hit)      the share of the block one tick of mining wears away
     hand.broke(hit, cells)  the block is going: drops, wear (returns what replaces it)
     hand.useOn(hit)         right click on a block (chests, tables); true if it did something
     hand.useItem(hit)       right click with the item (eat, armour, buckets); true if it did
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=9';
import { selectionBoxes } from './models.js?v=9';
import { placement, use, breakAt } from './place.js?v=9';
import { breakTime, dropOf } from './survival.js?v=9';

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
    if (mm && mm.x === hit.x && mm.y === hit.y && mm.z === hit.z && mm.total > 0) stage = Math.min(9, Math.floor(mm.t / mm.total * 10));
    if (this.overlay) this.overlay.set(hit.x, hit.y, hit.z, selectionBoxes(d, w.meta(hit.x, hit.y, hit.z), nb), stage);
    return hit;
  }
  down(button) {
    // an entity under the crosshair: hit it, or use it (js/entities)
    const e = this.entityTarget;
    if (e && this.entities) {
      if (button === 0) { this.attack = true; this.hand.swing(); this.entities.attack(e); return; }
      if (button === 2 && this.entities.interact(e)) { this.useHeld = true; this.useDelay = 4; this.hand.swing(); return; }
    }
    if (button === 0 && !this.target && this.entities) this.entities.swung();
    if (button === 0) {
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
    this.mining = { x: h.x, y: h.y, z: h.z, b: h.b, t: 0, total, ticks: 0 };
    if (this.hand.progress ? this.hand.progress(h) >= 1 : total === 0) { this.breakTarget(); this.mining = null; this.breakDelay = 5; }
  }
  mineTick() {
    // after a block breaks, five ticks before the next one starts (as the game does)
    if (this.breakDelay > 0) { this.breakDelay--; return; }
    const h = this.target, m = this.mining;
    if (!h) { this.mining = null; return; }
    if (!m || m.x !== h.x || m.y !== h.y || m.z !== h.z || m.b !== h.b) { this.startMining(); return; }
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
    // the hand's rules decide the drops (and what is left behind: ice leaves water)
    const replace = this.hand.broke ? this.hand.broke(h, cells) : 0;
    for (const [x, y, z] of cells) {
      const b = w.get(x, y, z), d = BLOCKS[b];
      if (this.onBreak && d && d.shape !== 'fluid') {
        const nb = (dx, dy, dz) => { const n = w.get(x + dx, y + dy, z + dz); return n ? { d: BLOCKS[n], m: w.meta(x + dx, y + dy, z + dz) } : null; };
        this.onBreak(x, y, z, b, d.shape === 'cube' ? null : selectionBoxes(d, w.meta(x, y, z), nb));
      }
      if (!this.creative && !this.hand.broke) { const drop = dropOf(b); if (drop) this.hand.got(drop); }
      w.set(x, y, z, replace && x === h.x && y === h.y && z === h.z ? replace : 0, 0);
      // a water plant leaves its water behind
      if (d && d.waterlogged) w.set(x, y, z, B.water, 0);
      this.fluids.around(x, y, z);
    }
    this.target = null;
  }
  useOnce() {
    // things that make an entity: boats, spawn eggs, thrown eggs and snowballs (js/entities)
    if (this.entities && !this.entityTarget && this.entities.useHeld(this.target)) { this.hand.swing(); return; }
    const h = this.target;
    // what the item does by itself (eating, armour, a bucket) works looking at nothing too
    if ((!h || !h.face) && this.hand.useItem) { this.hand.useItem(null); return; }
    if (!h || !h.face) return;
    // chests, crafting tables, furnaces open; tools till and strip
    if (this.hand.useOn && this.hand.useOn(h)) { this.hand.swing(); return; }
    // doors, trapdoors and gates open instead, unless you sneak
    if (!this.player.sneaking && use(this.world, h.x, h.y, h.z)) { this.hand.swing(); return; }
    if (this.hand.useItem && this.hand.useItem(h)) return;
    const id = this.hand.id();
    if (!id || !BLOCKS[id]) return;
    const list = placement(this.world, h, id, this.player);
    if (!list.length) return;
    for (const [x, y, z, b, m] of list) {
      const cur = this.world.get(x, y, z);
      this.world.set(x, y, z, b, m);
      if (FLUID[cur] === 1 && this.onSplash) this.onSplash(x + 0.5, z + 0.5);
      this.fluids.around(x, y, z);
    }
    this.hand.swing();
    this.hand.used(list);           // (what was placed, for blocks that hold things)
  }
}
