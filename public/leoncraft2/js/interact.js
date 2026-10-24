/* ---------------------------------------------------------------------------
   Leoncraft 2 - mining and building, tick by tick.

   As in the game: in creative a click breaks the block at once, and holding
   the button breaks another every six ticks (the game's five ticks of
   delay, then the break); in survival holding it wears the block down over
   its break time, the cracks growing through ten stages, looking away
   starts again, and after a block breaks five ticks pass before the next
   one starts. Holding the use button places (or opens a door) again every
   four ticks. The block you look at gets the thin black outline.

   A click acts the moment it happens, not at the next tick: the block
   breaks or goes down, and the arm swings, in the very next frame. The
   repeats then keep the game's own count, from the tick the game would
   have seen the click on (the next one), so the click's own tick counts
   as the first tick of the delay, as it does in the game. While the
   button is held the arm keeps swinging (every four ticks) and the block
   gives off bits, delay or not, as in the game.

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
import { B, BLOCKS, FLUID } from './blocks.js?v=107';
import { selectionBoxes } from './models.js?v=107';
import { placement, use, breakAt } from './place.js?v=107';
import { breakTime, dropOf } from './survival.js?v=107';

export class Interactor {
  constructor(o) {
    Object.assign(this, o);       // world, player, fluids, renderer, overlay, hand, onSplash
    this.creative = true;
    this.adventure = false;       // adventure (and spectator): nothing broken or placed (modes.js)
    this.locked = null;           // (x, y, z) -> true where nothing may be broken, placed or used: a server's spawn protection (net/net.js)
    this.mayBreak = null;         // (x, y, z) -> false where a block may not be broken (a minigame's map: net/hub.js)
    this.adventurePlace = null;   // (id) -> true for a block adventure may place after all
    this.mayPlace = null;         // (x, y, z, id) -> false where a block may not go (outside a minigame's build space)
    this.spectator = false;       // spectator: nothing done at all
    this.attack = false; this.useHeld = false;
    this.mining = null;           // { x, y, z, b, t, total }
    this.breakDelay = 0; this.useDelay = 0;
    this.sinceSwing = 0;          // ticks since the arm last started a swing (it starts again after four)
    this.target = null;
  }
  // the arm swings, as a click does
  swing() { this.hand.swing(); this.sinceSwing = 0; }
  // held on a block: the arm swings on again once the last swing is four ticks old
  heldSwing() { if (++this.sinceSwing >= 4) this.swing(); }
  /* Where a click and a held button look from: the eyes where the last tick
     left you (player.pickEye), as the game's tick picks at a partial tick of 1
     just before it handles the clicks. The frame's own look is a moment
     behind that (between the last two ticks), which at a bridge's edge is the
     difference between the side of the block under you and its top. */
  tickEye() { const P = this.player; return P && P.pickEye ? P.pickEye(1) : this.lastEye; }
  // what the crosshair is on, from the eye this frame
  look(eye) {
    this.lastEye = eye;
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
    // (adventure and spectator show no outline: there is nothing they could do to the block)
    if (this.overlay) { if (this.adventure) this.overlay.set(0, 0, 0, null, -1); else this.overlay.set(hit.x, hit.y, hit.z, selectionBoxes(d, w.meta(hit.x, hit.y, hit.z), nb, hit.x, hit.z), stage); }
    return hit;
  }
  down(button) {
    // a spectator only watches
    if (this.spectator) return;
    const R = this.renderer, at = performance.now();
    this._down(button);
    // a swing the click started goes from the moment of the click (render/avatar.js startSwing)
    if (R && R.swing >= 1) R.swingAt = at;
  }
  _down(button) {
    // while something is in use (eating, a drawn bow, a raised shield) the attack button does nothing, as in the game
    if (button === 0 && this.player.usingItem) return;
    // what the crosshair is on now, from where the last tick left you: the view may have turned since the frame was drawn
    const eye = this.tickEye();
    if (eye) this.look(eye);
    // an entity under the crosshair: hit it, or use it (js/entities)
    const e = this.entityTarget;
    if (e && this.entities) {
      if (button === 0) { this.attack = true; this.hand.swing(); this.entities.attack(e); return; }
      // (the main hand first, then the off hand: wheat in the off hand feeds a cow, as in the game)
      if (button === 2 && (this.entities.interact(e) || (this.hand.withOffhand && this.hand.withOffhand(() => this.entities.interact(e))))) {
        this.useHeld = true; this.useDelay = 5; this.hand.swing(); return;
      }
    }
    if (button === 0 && !this.target && this.entities) this.entities.swung(true);
    if (button === 0) {
      // the dragon or a crystal nearer than the block (js/dim/realms.js)
      if (this.onAttack && this.onAttack(this.target)) { this.hand.swing(); return; }
      this.attack = true;
      this.swing();
      this.sinceSwing = -1;         // (the next tick is the click's own)
      // adventure: the arm swings, and that is all
      if (this.adventure) { this.attack = false; return; }
      // the game's five ticks of delay, and one more for the click's own tick
      if (this.creative) { if (this.target) { this.breakTarget(); this.breakDelay = 6; } }
      else {
        this.startMining();
        // the first bits fly off the block with the click (the wear itself counts from the next tick, as in the game)
        const h = this.target;
        if (this.mining && h && this.onHit) this.onHit(h.x, h.y, h.z, h.face, h.b, h.box);
      }
    } else if (button === 2) {
      this.useHeld = true;
      this.useOnce();
      // again four ticks after the tick the game would have seen the click on
      this.useDelay = 5;
    }
  }
  up(button) {
    if (button === 0) { this.attack = false; this.mining = null; }
    if (button === 2) this.useHeld = false;
  }
  // once a tick
  tick() {
    // with a button held, what the crosshair is on is looked at again first, as the game picks again each tick: a block
    // just broken (or placed) is not left as the target until the next frame, which in a slow frame comes after a tick or
    // two, and those ticks would not count towards the delay (from this tick's eyes, as the game picks each tick)
    if (this.attack || this.useHeld) { const eye = this.tickEye(); if (eye) this.look(eye); }
    if (this.attack) {
      if (this.creative) this.creativeTick();
      else this.mineTick();
    }
    if (this.useHeld && --this.useDelay <= 0) { this.useOnce(); this.useDelay = 4; }
  }
  startMining() {
    const h = this.target;
    if (!h || (this.locked && this.locked(h.x, h.y, h.z)) || (this.mayBreak && !this.mayBreak(h.x, h.y, h.z))) { this.mining = null; return; }
    // a block that answers a punch (the dragon egg teleports away: sim/bodies.js)
    if (this.sim && this.sim.attacked && this.sim.attacked(h)) { this.mining = null; this.target = null; return; }
    // with the hand's rules, t runs from 0 to 1 by the tool's progress a tick; without, seconds by hand
    const total = this.hand.progress ? 1 : breakTime(BLOCKS[h.b]);
    this.mining = { x: h.x, y: h.y, z: h.z, b: h.b, t: 0, total, ticks: 0, key: this.hand.key ? this.hand.key() : '' };
    // a block that goes at once leaves no delay, so holding the button mows grass or insta-mines stone a block a tick
    if (this.hand.progress ? this.hand.progress(h) >= 1 : total === 0) { this.breakTarget(); this.mining = null; }
  }
  // creative, held: five ticks of delay (counted only while on a block, as in the game), then the next block goes
  creativeTick() {
    const h = this.target;
    if (!h) return;
    if (this.breakDelay > 0) {
      this.breakDelay--;
      this.heldSwing();
      if (this.onHit) this.onHit(h.x, h.y, h.z, h.face, h.b, h.box);
      return;
    }
    this.swing();
    this.breakTarget();
    this.breakDelay = 5;
  }
  mineTick() {
    const h = this.target, m = this.mining;
    if (!h) { this.mining = null; return; }
    // after a block that took time breaks, five ticks before the next one starts (as the game does)
    if (this.breakDelay > 0) {
      this.breakDelay--;
      this.heldSwing();
      if (this.onHit) this.onHit(h.x, h.y, h.z, h.face, h.b, h.box);
      return;
    }
    // another block, or another item in the hand: start again from nothing
    if (!m || m.x !== h.x || m.y !== h.y || m.z !== h.z || m.b !== h.b || (this.hand.key && m.key !== this.hand.key())) { this.startMining(); return; }
    m.t += this.hand.progress ? this.hand.progress(h) : 0.05;
    m.ticks++;
    this.heldSwing();
    if (this.onHit) this.onHit(h.x, h.y, h.z, h.face, h.b, h.box);
    if (m.t >= m.total - 1e-9) { this.breakTarget(); this.mining = null; this.breakDelay = 5; }
  }
  breakTarget() {
    this.world.urgent = true;
    try { return this._breakTarget(); } finally { this.world.urgent = false; if (this.world.flushUrgent) this.world.flushUrgent(); }
  }
  _breakTarget() {
    const h = this.target;
    if (!h) return;
    // a hit on an item frame knocks out what it holds before the frame itself (details.js)
    if (this.onPunch && this.onPunch(h)) { this.target = null; return; }
    // a sword, trident, mace or debug stick breaks nothing in creative (modes.js)
    if (this.creative && this.hand.mayBreak && !this.hand.mayBreak()) return;
    if (this.locked && this.locked(h.x, h.y, h.z)) return;
    if (this.mayBreak && !this.mayBreak(h.x, h.y, h.z)) return;
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
        this.onBreak(x, y, z, b, d.shape === 'cube' ? null : selectionBoxes(d, w.meta(x, y, z), nb, x, z));
      }
      // the simulation hears of it (sim/sim.js); drops come from the loot tables (hands.js), or the
      // simulation's loot, or the block itself
      const loot = this.sim ? this.sim.broken(x, y, z, b, w.meta(x, y, z)) : null;
      if (!this.creative && !this.hand.broke) {
        if (loot) for (const [n, c] of loot) this.sim.dropItem(x + 0.5, y + 0.5, z + 0.5, n, c);
        else { const drop = dropOf(b); if (drop) this.hand.got(drop); }
      }
      w.set(x, y, z, replace && x === h.x && y === h.y && z === h.z ? replace : 0, 0);
      // (a block put down a moment ago and drawn on its own: gone with it)
      if (w.quick) w.quick.put(x, y, z, w.get(x, y, z), w.meta(x, y, z));
      if (this.onBroken) this.onBroken(x, y, z, b);
      // a water plant leaves its water behind
      if (d && d.waterlogged) w.set(x, y, z, B.water, 0);
      this.fluids.around(x, y, z);
    }
    this.target = null;
  }
  useOnce() {
    this.world.urgent = true;
    try { return this._useOnce(); } finally { this.world.urgent = false; if (this.world.flushUrgent) this.world.flushUrgent(); }
  }
  _useOnce() {
    if (this.useWith()) return;
    // the main hand had nothing to do: the off hand has its turn (a torch beside the pickaxe, food), as in the game
    if (this.hand.withOffhand) this.hand.withOffhand(() => this.useWith());
  }
  // one right click with what is in the hand (hands.js swaps the off hand in for its turn); true when it did something,
  // 'fail' when a block could not be placed (which ends the click too)
  useWith() {
    // things that make an entity: boats, spawn eggs, thrown eggs and snowballs (js/entities); on a block, only once the block has had its say
    // (looking at a mob that did nothing with the click, the item is still used, as in the game: a pearl is thrown)
    const makes = () => !!(this.entities && this.entities.useHeld(this.target));
    // (a block you may not touch is as good as none: what is in your hand is still used, food eaten, a pearl thrown)
    const h = this.target && this.locked && this.locked(this.target.x, this.target.y, this.target.z) ? null : this.target;
    // at nothing: an item that is thrown (an eye of ender), or one that works by itself (eating, armour, a bucket)
    if (!h || !h.face) {
      if (makes()) { this.hand.swing(); return true; }
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
    // (so a chest opens rather than taking a boat on its lid, as in the game)
    if (makes()) { this.hand.swing(); return true; }
    if (this.hand.useItem && this.hand.useItem(h)) return true;
    // adventure places nothing (but what a server lets it: Leon Network's temporary blocks in its lobby)
    if (this.adventure && !(this.adventurePlace && this.adventurePlace(this.hand.id()))) return false;
    const id = this.hand.id();
    if (!id || !BLOCKS[id] || BLOCKS[id].place === false) return false;
    let list = placement(this.world, h, id, this.player);
    if (list.length && this.sim) list = this.sim.placed(list, h, id);
    // a block that cannot go there fails the click outright: the other hand does not get its turn (the game's FAIL)
    if (!list.length) return 'fail';
    if (this.mayPlace && list.some(([x, y, z, b]) => !this.mayPlace(x, y, z, b))) return 'fail';
    for (const [x, y, z, b, m] of list) {
      const cur = this.world.get(x, y, z);
      this.world.set(x, y, z, b, m);
      // drawn in the very next frame, before the workers have its column's new mesh (quickblocks.js)
      if (this.world.quick) this.world.quick.put(x, y, z, this.world.get(x, y, z), this.world.meta(x, y, z));
      if (FLUID[cur] === 1 && this.onSplash) this.onSplash(x + 0.5, z + 0.5);
      this.fluids.around(x, y, z);
    }
    this.hand.swing();
    this.hand.used(list);           // (what was placed, for blocks that hold things)
    return true;
  }
}
