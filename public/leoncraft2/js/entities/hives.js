/* ---------------------------------------------------------------------------
   Leoncraft 2 - bee nests and beehives at work (the Minecraft Wiki's Beehive
   and Bee pages), ticked with the spawners (struct/spawners.js).

   A nest the trees grew holds its two or three bees (meta bits 5-6, until
   you first come near and they join the bees kept inside); they come out
   within the 600 ticks a bee without nectar stays, not at night. A
   bee that has taken nectar from a flower, or is out at night or in the
   rain, flies home to its hive (or the nearest one within 22 blocks with
   room for three) and goes in. It stays 2400 ticks (600 without nectar, and
   always until morning and the rain stops), then comes out in front of it;
   one that brought nectar puts a level of honey in (meta bits 2-4, 0 to 5).
   At honey level 5, shears take three honeycombs and a glass bottle takes a
   bottle of honey, and the level goes back to 0; unless a campfire is
   burning within 5 blocks under the hive, the bees about turn on whoever
   did it. A comparator reads the honey level. The bees inside are kept with
   the dimension's block entities (details.js registerExtra).
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=28';
import { CH } from '../world-const.js?v=28';
import { I } from '../items.js?v=28';
import { registerExtra } from '../details.js?v=28';

const R = Math.random, RI = n => Math.floor(Math.random() * n);
const FRONT = [[0, -1], [1, 0], [0, 1], [-1, 0]];        // facing north, east, south, west
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const isHive = b => b === B.beehive || b === B.bee_nest;
export const honeyOf = m => (m >> 2) & 7;

export class Hives {
  constructor() { this.found = new WeakMap(); this.inside = new Map(); this.n = 0; this.det = null; }
  save(det) {
    if (det !== this.det) return [];
    const out = [];
    for (const [k, list] of this.inside) if (list.length) out.push({ k: 'hv', p: k.split(',').map(Number), b: list.map(e => ({ j: e.json, t: e.left, n: e.nectar ? 1 : 0 })) });
    return out;
  }
  reset(det) { this.det = det; this.inside.clear(); }
  load(det, o) {
    if (det !== this.det) this.reset(det);
    this.inside.set(o.p.join(','), (o.b || []).map(e => ({ json: e.j, left: e.t | 0, nectar: !!e.n })));
  }
  hivesIn(world, c, key) {
    const ed = world.edits && world.edits.get(key), size = ed ? ed.size : 0;
    let f = this.found.get(c);
    if (f && f.ed === size) return f.list;
    const list = [], bl = c.blocks;
    for (const T of [B.beehive, B.bee_nest]) for (let i = bl.indexOf(T); i >= 0; i = bl.indexOf(T, i + 1)) list.push([c.cx * CH + (i & 15), i >> 8, c.cz * CH + ((i >> 4) & 15)]);
    this.found.set(c, { list, ed: size });
    return list;
  }
  tick(world, player) {
    const L = lc2(), g = L && L.game;
    if (!g || !world || !player || !g.entities || B.beehive === undefined) return;
    if (g.details !== this.det) this.reset(g.details);
    const E = g.entities;
    this.n++;
    // the bees inside count down
    for (const list of this.inside.values()) for (const e of list) if (e.left > 0) e.left--;
    if (this.n % 20) return;
    const night = (((g.time % 24000) + 24000) % 24000) >= 12542 && (((g.time % 24000) + 24000) % 24000) < 23460;
    const rain = !!(g.sim && g.sim.weather && g.sim.weather.raining);
    const ccx = Math.floor(player.pos.x / CH), ccz = Math.floor(player.pos.z / CH), hives = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const key = (ccx + dx) + ',' + (ccz + dz), c = world.chunks.get(key);
      if (c) for (const h of this.hivesIn(world, c, key)) if (isHive(world.get(h[0], h[1], h[2]))) hives.push(h);
    }
    for (const [x, y, z] of hives) {
      const m = world.meta(x, y, z), k = x + ',' + y + ',' + z;
      // a grown nest's own bees, the first time you come near: they are in it like any other bees without
      // nectar, each with up to its 600 ticks left, so by day they come out over the next half minute
      // (and at night or in the rain they stay in until it is over)
      const waiting = (m >> 5) & 3;
      if (waiting) {
        world.set(x, y, z, world.get(x, y, z), m & ~96);
        const list = this.inside.get(k) || [];
        for (let i = 0; i < waiting && list.length < 3; i++) list.push({ json: null, left: 1 + RI(600), nectar: false });
        this.inside.set(k, list);
        this.dirty(g);
      }
      // bees inside whose time is up come out (not at night, nor in the rain)
      const list = this.inside.get(k);
      if (list && list.length && !night && !rain) {
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          if (e.left > 0) continue;
          list.splice(i, 1);
          const now = world.meta(x, y, z);
          if (e.nectar && honeyOf(now) < 5) world.set(x, y, z, world.get(x, y, z), (now & ~28) | ((honeyOf(now) + 1) << 2));
          this.release(world, E, x, y, z, world.meta(x, y, z), e.json);
        }
        this.dirty(g);
      }
    }
    // a hive broken with bees in it: out they come, angry
    for (const [k, list] of this.inside) {
      const [x, y, z] = k.split(',').map(Number);
      if (!list.length || isHive(world.get(x, y, z)) || !(world.loaded ? world.loaded(x, z) : true)) continue;
      for (const b of list.splice(0)) {
        const e = E.spawn('bee', x + 0.5, y, z + 0.5, b.json ? { json: b.json, natural: false } : { natural: false });
        if (e) { e.hive = null; e.angerT = 400 + RI(400); e.target = E.player; }
      }
      this.inside.delete(k);
      this.dirty(g);
    }
    // bees going home
    for (const e of E.list) {
      if (e.type !== 'bee' || e.dead || e.removed || e.angerT > 0) continue;
      if (!(e.nectar || night || rain)) continue;
      let h = e.hive && isHive(world.get(e.hive[0], e.hive[1], e.hive[2])) ? e.hive : null;
      if (!h) {
        let bd = 22 * 22;
        for (const c of hives) {
          const d = (c[0] + 0.5 - e.pos.x) ** 2 + (c[1] - e.pos.y) ** 2 + (c[2] + 0.5 - e.pos.z) ** 2, room = (this.inside.get(c.join(',')) || []).length < 3;
          if (d < bd && room) { bd = d; h = c; }
        }
        if (!h) continue;
        e.hive = h;
      }
      const f = FRONT[world.meta(h[0], h[1], h[2]) & 3], fx = h[0] + 0.5 + f[0] * 0.8, fz = h[2] + 0.5 + f[1] * 0.8;
      const d2 = (fx - e.pos.x) ** 2 + (h[1] + 0.3 - e.pos.y) ** 2 + (fz - e.pos.z) ** 2;
      if (d2 < 1.6 * 1.6) {
        const k = h.join(','), list = this.inside.get(k) || [];
        if (list.length >= 3) continue;
        list.push({ json: e.toJSON ? e.toJSON() : null, left: e.nectar ? 2400 : 600, nectar: !!e.nectar });
        this.inside.set(k, list);
        e.remove();
        this.dirty(g);
      } else if (e.flyTo && !e.target) e.flyTo(fx, h[1] + 0.3, fz, 1);
    }
  }
  release(world, E, x, y, z, m, json) {
    const f = FRONT[m & 3], bx = x + 0.5 + f[0] * 0.9, bz = z + 0.5 + f[1] * 0.9;
    const e = E.spawn('bee', bx, y, bz, json ? { json, natural: false } : { natural: false });
    if (!e) return;
    e.nectar = false; e.hive = [x, y, z];
    if (e.vel) e.vel.set(f[0] * 0.1, 0.05, f[1] * 0.1);
  }
  // the bees round a hive turn on the player (and those inside come out to)
  anger(world, E, x, y, z) {
    const P = E.player;
    E.forNear(x + 0.5, z + 0.5, 8, e => { if (e.type === 'bee' && !e.dead && !e.stung) { e.angerT = 400 + RI(400); e.target = P; } });
    const k = x + ',' + y + ',' + z, list = this.inside.get(k);
    if (list) { for (const b of list.splice(0)) { this.release(world, E, x, y, z, world.meta(x, y, z), b.json); } }
    E.forNear(x + 0.5, z + 0.5, 3, e => { if (e.type === 'bee' && !e.dead && !e.stung) { e.angerT = 400 + RI(400); e.target = P; } });
  }
  dirty(g) { if (g && g.details) g.details.dirty = true; }
}

let ONE = null;
export function hives() {
  if (!ONE) {
    ONE = new Hives();
    registerExtra('hv', { save: d => ONE.save(d), load: (d, o) => ONE.load(d, o), reset: d => ONE.reset(d) });
  }
  return ONE;
}

/* Shears or a glass bottle on a full hive (details.js use): true when it took the honey. */
export function hiveUse(details, h, hit, d, s, n) {
  const w = details.world, { x, y, z } = hit, m = w.meta(x, y, z);
  if (honeyOf(m) < 5 || (n !== 'shears' && n !== 'glass_bottle')) return false;
  w.set(x, y, z, w.get(x, y, z), m & ~28);
  if (n === 'shears') {
    const f = FRONT[m & 3];
    if (details.drops && I.honeycomb !== undefined) details.drops.spawn(x + 0.5 + f[0] * 0.7, y + 0.3, z + 0.5 + f[1] * 0.7, { id: I.honeycomb, count: 3 });
    if (!h.creative) h.inv.damageSelected(1);
  } else if (I.honey_bottle !== undefined) details.swap(h, { id: I.honey_bottle, count: 1 });
  // smoke from a campfire within 5 blocks under it keeps the bees calm
  let calm = false;
  for (let k = 1; k <= 5 && !calm; k++) { const b = w.get(x, y - k, z); if (b === B.campfire || b === B.soul_campfire) calm = (w.meta(x, y - k, z) & 4) === 0; }
  const L = lc2(), g = L && L.game;
  if (!calm && g && g.entities) hives().anger(w, g.entities, x, y, z);
  return true;
}
