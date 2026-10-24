/* ---------------------------------------------------------------------------
   Leoncraft 2 - what a beacon does (Minecraft Wiki, Beacon; Java Edition).
   The beam itself is drawn by sim/beams.js; this is the rest.

   Its level is the number of whole layers of iron, gold, emerald, diamond or
   netherite blocks under it (3 x 3, 5 x 5, 7 x 7, 9 x 9), up to 4, and it
   only works with its beam clear to the sky. Every 80 ticks of the world's
   clock a working beacon with a power chosen gives every player in a box
   10 + 10 x level blocks out from it every way (and up to the top of the
   world) its power for 9 + 2 x level seconds, as an ambient effect:
     level 1   Speed or Haste
     level 2   Resistance or Jump Boost
     level 3   Strength
     level 4   a second power: Regeneration, or the first one at level II
   Powers are chosen on its screen (ui/beacon.js) and paid for with an iron
   ingot, gold ingot, emerald, diamond or netherite ingot. It hums
   (block.beacon.ambient) every 80 ticks while it works, and sounds as it
   comes on and goes off. (The construct_beacon advancement is adv/game.js's,
   from the beams.)

   Each machine gives the powers to its own player, so in a world with others
   every player near a working beacon gets them on their own screen. The
   powers chosen are kept with the dimension's block entities (details.js
   registerExtra), and go when the beacon is broken.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';
import { H } from '../world-const.js?v=107';
import { registerExtra } from '../details.js?v=107';

// the game's BeaconBlockEntity.BEACON_EFFECTS, a row for each level
export const POWERS = [['speed', 'haste'], ['resistance', 'jump_boost'], ['strength'], ['regeneration']];
export const PAYMENT = ['netherite_ingot', 'emerald', 'diamond', 'gold_ingot', 'iron_ingot'];
const BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block'].map(n => B[n]).filter(v => v !== undefined));
// the row a power is in (0 to 3), or -1
export const tierOf = n => POWERS.findIndex(r => r.includes(n));

// whole layers of blocks under it (y is an index height), as BeaconBlockEntity.updateBase
export function pyramidLevel(w, x, y, z) {
  let level = 0;
  for (let i = 1; i <= 4; i++) {
    const yy = y - i;
    if (yy < 0) break;
    for (let dx = -i; dx <= i; dx++) for (let dz = -i; dz <= i; dz++) if (!BASE.has(w.get(x + dx, yy, z + dz))) return level;
    level = i;
  }
  return level;
}

/* One store for the visit, whatever the world: the powers of the beacons of
   the dimension's block entities that were loaded last ("x,y,z" -> { p, s }). */
class Store {
  constructor() { this.data = new Map(); this.det = null; }
  get(x, y, z) { return this.data.get(x + ',' + y + ',' + z) || { p: null, s: null }; }
  // (det: the dimension's block entities they belong with, marked to be saved)
  set(x, y, z, p, s, det) {
    if (det && det !== this.det) this.reset(det);
    this.data.set(x + ',' + y + ',' + z, { p: p || null, s: s || null });
    if (this.det) this.det.dirty = true;
  }
  drop(x, y, z) { if (this.data.delete(x + ',' + y + ',' + z) && this.det) this.det.dirty = true; }
  save(det) {
    if (det !== this.det) return [];
    const out = [];
    for (const [k, v] of this.data) if (v.p || v.s) out.push({ k: 'bc', p: k.split(',').map(Number), a: v.p || 0, b: v.s || 0 });
    return out;
  }
  reset(det) { this.det = det; this.data.clear(); }
  load(det, o) {
    if (det !== this.det) this.reset(det);
    if (o.p && (o.a || o.b)) this.data.set(o.p.join(','), { p: o.a || null, s: o.b || null });
  }
}
export const STORE = new Store();
registerExtra('bc', { save: d => STORE.save(d), load: (d, o) => STORE.load(d, o), reset: d => STORE.reset(d) });

export class Beacons {
  constructor(sim) {
    this.sim = sim;
    this.w = sim.world;
    this.on = new Map();          // "x,y,z" -> its level the last time it was looked at
    this.n = 0;
    (sim.tickers || (sim.tickers = [])).push(() => this.tick());
    // a beacon broken: its powers go with it
    if (B.beacon !== undefined) sim.on(B.beacon, { broken: (s, x, y, z) => { STORE.drop(x, y, z); this.on.delete(x + ',' + y + ',' + z); } });
  }
  dispose() { this.on.clear(); }
  // a beacon's level as it works now (0: no pyramid, or its beam blocked; the beams know which shine)
  levelAt(x, y, z) {
    const bm = this.sim.beams;
    if (!bm || !bm.list.has(x + ',' + y + ',' + z) || this.w.get(x, y, z) !== B.beacon) return 0;
    return pyramidLevel(this.w, x, y, z);
  }
  tick() {
    const g = this.sim.game, bm = this.sim.beams;
    if (!g || !bm || B.beacon === undefined || ++this.n % 80) return;
    // a dimension with no block entities saved yet: none of the last one's powers are its
    if (g.details && STORE.det !== g.details) STORE.reset(g.details);
    const seen = new Set();
    for (const k of bm.list.keys()) {
      const [x, y, z] = k.split(',').map(Number);
      seen.add(k);
      this.work(g, x, y, z, k);
    }
    // the ones that went dark since (their beam blocked, a layer taken away)
    for (const [k, lv] of this.on) if (!seen.has(k)) {
      this.on.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      if (lv && this.sim.onSound) this.sim.onSound('block.beacon.deactivate', x, y, z);
    }
    // powers whose beacon is gone some other way (blown up, pushed out by a command)
    for (const k of [...STORE.data.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      if (this.w.loaded(x, z) && this.w.get(x, y, z) !== B.beacon) STORE.drop(x, y, z);
    }
  }
  work(g, x, y, z, k) {
    const level = pyramidLevel(this.w, x, y, z), was = this.on.get(k) || 0;
    this.on.set(k, level);
    const snd = this.sim.onSound ? (ev => this.sim.onSound(ev, x, y, z)) : () => {};
    if (level && !was) snd('block.beacon.activate');
    if (!level) return;
    snd('block.beacon.ambient');
    const d = STORE.get(x, y, z), sv = g.survival, P = this.sim.player;
    if (!d.p || !sv || !sv.addEffect || !P) return;
    // the player's box against the beacon's: range out every way from its block, and up to the top of the world
    const range = level * 10 + 10, hw = 0.3, ph = 1.8;
    if (P.pos.x + hw < x - range || P.pos.x - hw > x + 1 + range || P.pos.z + hw < z - range || P.pos.z - hw > z + 1 + range) return;
    if (P.pos.y + ph < y - range || P.pos.y > y + 1 + range + H) return;
    const ticks = (9 + level * 2) * 20;
    sv.addEffect(d.p, level >= 4 && d.p === d.s ? 2 : 1, ticks, { ambient: true });
    if (level >= 4 && d.s && d.s !== d.p) sv.addEffect(d.s, 1, ticks, { ambient: true });
  }
}
