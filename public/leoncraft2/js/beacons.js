/* ---------------------------------------------------------------------------
   Leoncraft 2 - what a beacon does (Minecraft Wiki, Beacon; Java Edition).
   The beam itself is drawn by sim/beams.js; this is the rest.

   Its level is the number of whole layers of iron, gold, emerald, diamond or
   netherite blocks under it (3 x 3, 5 x 5, 7 x 7, 9 x 9), up to 4, and it
   only works with its beam clear to the sky. Every 80 ticks a working beacon
   with a power chosen gives every player within 10 + 10 x level blocks
   across (from that far below it up to the top of the world) its power for
   9 + 2 x level seconds, as an ambient effect:
     level 1   Speed or Haste
     level 2   Resistance or Jump Boost
     level 3   Strength
     level 4   a second power: Regeneration, or the first one at level II
   Powers are chosen on its screen (ui/beacon.js) and paid for with an iron
   ingot, gold ingot, emerald, diamond or netherite ingot. It hums
   (block.beacon.ambient) while it works, and sounds as it switches on and
   off. A player within 10 blocks of one as it comes on gets the
   construct_beacon advancement trigger with its level.

   Beacons are only ever put there by a player, so they are in the world's
   edits: those within 4 chunks of the player are looked over every 80
   ticks. The powers chosen are kept with the dimension's block entities
   (details.js registerExtra).
--------------------------------------------------------------------------- */
import { B, OPACITY } from './blocks.js?v=24';
import { CH, H } from './world-const.js?v=24';
import { registerExtra } from './details.js?v=24';
import { progress } from './advancements.js?v=24';

export const POWERS = [['speed', 'haste'], ['resistance', 'jump_boost'], ['strength']];
export const SECONDARY = 'regeneration';
export const PAYMENT = ['netherite_ingot', 'emerald', 'diamond', 'gold_ingot', 'iron_ingot'];
const BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block'].map(n => B[n]).filter(v => v !== undefined));
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const sound = (ev, x, y, z, v = 1) => {
  const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
  if (S) try { S.play(ev, x + 0.5, y + 0.5, z + 0.5, v, 1, 'block'); } catch (e) { /* no sound */ }
};
// the tier a power needs (1 to 3), or 4 for the second power alone
export const tierOf = n => { for (let i = 0; i < POWERS.length; i++) if (POWERS[i].includes(n)) return i + 1; return n === SECONDARY ? 4 : 0; };

// whole layers of blocks under it (y is an index height)
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
// nothing that stops light between it and the sky (bedrock lets the beam through, as in the game)
export function beamClear(w, x, y, z) {
  for (let yy = y + 1; yy < H; yy++) { const b = w.get(x, yy, z); if (b && OPACITY[b] >= 15 && b !== B.bedrock) return false; }
  return true;
}
// a beacon's level as it works now: 0 when its beam is blocked
export function levelAt(w, x, y, z) { const l = pyramidLevel(w, x, y, z); return l && beamClear(w, x, y, z) ? l : 0; }

export class Beacons {
  constructor() { this.data = new Map(); this.on = new Map(); this.det = null; this.n = 0; }
  // the powers chosen for the beacon at x, y, z: { p, s } (names, or null)
  get(x, y, z) { return this.data.get(x + ',' + y + ',' + z) || { p: null, s: null }; }
  set(x, y, z, p, s) { this.data.set(x + ',' + y + ',' + z, { p: p || null, s: s || null }); }
  save(det) {
    if (det !== this.det) return [];
    const out = [];
    for (const [k, v] of this.data) if (v.p) out.push({ k: 'bc', p: k.split(',').map(Number), a: v.p, b: v.s || 0 });
    return out;
  }
  reset(det) { this.det = det; this.data.clear(); this.on.clear(); }
  load(det, o) {
    if (det !== this.det) this.reset(det);
    if (o.p && o.a) this.data.set(o.p.join(','), { p: o.a, s: o.b || null });
  }
  tick(world, player) {
    const L = lc2(), g = L && L.game;
    if (!g || !world || !player || B.beacon === undefined) return;
    if (g.details !== this.det) this.reset(g.details);
    if (++this.n % 80) return;
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    const pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH), seen = new Set();
    for (const [key, ed] of world.edits) {
      const comma = key.indexOf(','), cx = +key.slice(0, comma), cz = +key.slice(comma + 1);
      if (Math.abs(cx - pcx) > 4 || Math.abs(cz - pcz) > 4 || !world.loaded(cx * CH, cz * CH)) continue;
      for (const [i, v] of ed) {
        if ((v >> 8) !== B.beacon) continue;
        const y = i >> 8, z = cz * CH + ((i >> 4) & 15), x = cx * CH + (i & 15);
        if (world.get(x, y, z) !== B.beacon) continue;
        const k = x + ',' + y + ',' + z;
        seen.add(k);
        this.work(g, world, x, y, z, k, px, py, pz);
      }
    }
    // beacons broken: their powers go with them
    for (const k of [...this.on.keys()]) if (!seen.has(k)) {
      const [x, y, z] = k.split(',').map(Number);
      if (world.loaded(x, z) && world.get(x, y, z) !== B.beacon) { this.on.delete(k); this.data.delete(k); }
    }
  }
  work(g, world, x, y, z, k, px, py, pz) {
    const level = levelAt(world, x, y, z), was = this.on.get(k) || 0;
    this.on.set(k, level);
    if (level && !was) {
      sound('block.beacon.activate', x, y, z);
      if (Math.abs(px - x - 0.5) <= 10.5 && Math.abs(pz - z - 0.5) <= 10.5 && py >= y - 9 && py <= y + 6) progress().event('construct_beacon', { level });
    } else if (!level && was) sound('block.beacon.deactivate', x, y, z);
    if (!level) return;
    sound('block.beacon.ambient', x, y, z);
    const d = this.get(x, y, z), sv = g.survival;
    if (!d.p || !sv || !sv.addEffect || tierOf(d.p) > level) return;
    // the players in range: so far across, from so far below up to the top of the world
    const range = level * 10 + 10;
    if (Math.abs(px - x - 0.5) > range + 0.5 || Math.abs(pz - z - 0.5) > range + 0.5 || py < y - range) return;
    const ticks = (9 + level * 2) * 20;
    const two = level >= 4 && d.s === d.p;
    sv.addEffect(d.p, two ? 2 : 1, ticks, { ambient: true });
    if (level >= 4 && d.s && d.s !== d.p) sv.addEffect(d.s, 1, ticks, { ambient: true });
  }
}

let ONE = null;
export function beacons() {
  if (!ONE) {
    ONE = new Beacons();
    registerExtra('bc', { save: d => ONE.save(d), load: (d, o) => ONE.load(d, o), reset: d => ONE.reset(d) });
  }
  return ONE;
}
