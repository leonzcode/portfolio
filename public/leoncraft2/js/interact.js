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
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=6';
import { selectionBoxes } from './models.js?v=6';
import { placement, use, breakAt } from './place.js?v=6';
import { breakTime, dropOf } from './survival.js?v=6';

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
    const hit = this.player.pick(eye, this.creative ? 5 : 4.5);
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
    const total = breakTime(BLOCKS[h.b]);
    this.mining = { x: h.x, y: h.y, z: h.z, b: h.b, t: 0, total };
    if (total === 0) this.breakTarget();
  }
  mineTick() {
    const h = this.target, m = this.mining;
    if (!h) { this.mining = null; return; }
    if (!m || m.x !== h.x || m.y !== h.y || m.z !== h.z || m.b !== h.b) { this.startMining(); return; }
    m.t += 0.05;
    if ((m.t * 20 | 0) % 4 === 0) this.hand.swing();
    if (m.t >= m.total) { this.breakTarget(); this.mining = null; this.breakDelay = 5; }
  }
  breakTarget() {
    const h = this.target;
    if (!h) return;
    const w = this.world;
    for (const [x, y, z] of breakAt(w, h.x, h.y, h.z)) {
      const b = w.get(x, y, z), d = BLOCKS[b];
      if (!this.creative) { const drop = dropOf(b); if (drop) this.hand.got(drop); }
      w.set(x, y, z, 0, 0);
      // a water plant leaves its water behind
      if (d && d.waterlogged) w.set(x, y, z, B.water, 0);
      this.fluids.around(x, y, z);
    }
    this.target = null;
  }
  useOnce() {
    const h = this.target;
    if (!h || !h.face) return;
    // doors, trapdoors and gates open instead, unless you sneak
    if (!this.player.sneaking && use(this.world, h.x, h.y, h.z)) { this.hand.swing(); return; }
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
    this.hand.used();
  }
}
