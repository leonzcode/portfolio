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
   did it. A comparator reads the honey level. Mined with Silk Touch, a nest
   or hive keeps its bees and honey level in the item, and put down again
   they are inside it (hands.js); mined any other way, out they come angry.
   The bees inside are kept with the dimension's block entities (details.js
   registerExtra).
--------------------------------------------------------------------------- */
import { B, SOLID, FLUID } from '../blocks.js?v=107';
import { CH } from '../world-const.js?v=107';
import { I } from '../items.js?v=107';
import { registerExtra } from '../details.js?v=107';

const R = Math.random, RI = n => Math.floor(Math.random() * n);
const FRONT = [[0, -1], [1, 0], [0, 1], [-1, 0]];        // facing north, east, south, west
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const isHive = b => b === B.beehive || b === B.bee_nest;
export const honeyOf = m => (m >> 2) & 7;

export class Hives {
  constructor() { this.found = new WeakMap(); this.inside = new Map(); this.n = 0; this.det = null; this.homing = new Set(); this.night = false; this.rain = false; }
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
    // bees finding their way home round leaves or an overhang go a cell at a time
    if (this.homing.size) this.follow();
    if (this.n % 20) return;
    const night = this.night = (((g.time % 24000) + 24000) % 24000) >= 12542 && (((g.time % 24000) + 24000) % 24000) < 23460;
    const rain = this.rain = !!(g.sim && g.sim.weather && g.sim.weather.raining);
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
      if (!(e.nectar || night || rain)) { e.homeD = undefined; continue; }
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
      // within two blocks of it, it goes in (as near as a bee has to be in the game)
      const d2 = (h[0] + 0.5 - e.pos.x) ** 2 + (h[1] + 0.5 - e.pos.y) ** 2 + (h[2] + 0.5 - e.pos.z) ** 2;
      if (d2 < 4) {
        const k = h.join(','), list = this.inside.get(k) || [];
        if (list.length >= 3) continue;
        list.push({ json: e.toJSON ? e.toJSON() : null, left: e.nectar ? 2400 : 600, nectar: !!e.nectar });
        this.inside.set(k, list);
        e.remove();
        this.homing.delete(e);
        this.dirty(g);
      } else if (e.flyTo && !e.target) {
        // straight for its front; one that got no nearer in the last second (or no further along its way
        // round) looks for a way through the air, and one with none tries again ten seconds later
        const stuck = e.homePath ? e.homeI === e.homeLast : e.homeD !== undefined && d2 > (Math.sqrt(e.homeD) - 0.5) ** 2;
        e.homeD = d2; e.homeLast = e.homeI;
        if (stuck && !(e.homeWait > 0 && e.homeWait--)) {
          const path = airPath(E.t, e, h);
          e.homePath = path; e.homeI = e.homeLast = 0; e.dest = null; e.homeWait = path ? 0 : 10;
          if (path) this.homing.add(e); else this.homing.delete(e);
        }
        if (!e.homePath) e.flyTo(fx, h[1] + 0.3, fz, 1);
      }
    }
  }
  // the bees on their way round: the next cell when they reach the last (none once it is day again, or they are cross)
  follow() {
    for (const e of this.homing) {
      const p = e.homePath;
      if (!p || e.removed || e.dead || e.angerT > 0 || e.target || !(e.nectar || this.night || this.rain) || e.homeI >= p.length) {
        if (p && !e.dead && !e.removed && e.homeI >= p.length) e.homeD = undefined;
        e.homePath = null; this.homing.delete(e);
        continue;
      }
      if (e.dest) continue;
      const c = p[e.homeI++];
      e.flyTo(c[0] + 0.5, c[1] + 0.2, c[2] + 0.5, 1);
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
  /* A nest or hive mined with Silk Touch (hands.js broke): the bees in it go
     with the block that drops, a grown nest's waiting ones too, each with
     the time it had left, and none of them comes out or gets angry. */
  take(world, x, y, z) {
    const k = x + ',' + y + ',' + z, list = this.inside.get(k) || [], waiting = (world.meta(x, y, z) >> 5) & 3;
    const out = list.map(e => ({ j: e.json, t: e.left, n: e.nectar ? 1 : 0 }));
    for (let i = 0; i < waiting && out.length < 3; i++) out.push({ j: null, t: 1 + RI(600), n: 0 });
    if (this.inside.delete(k)) { const L = lc2(); this.dirty(L && L.game); }
    return out;
  }
  // that block put down again (hands.js placed): its honey level back, its bees inside
  placed(world, x, y, z, st) {
    if (st.honey) world.set(x, y, z, world.get(x, y, z), (world.meta(x, y, z) & ~28) | ((st.honey & 7) << 2));
    if (!Array.isArray(st.bees) || !st.bees.length) return;
    this.inside.set(x + ',' + y + ',' + z, st.bees.slice(0, 3).map(e => ({ json: e.j || null, left: e.t | 0, nectar: !!e.n })));
    const L = lc2();
    this.dirty(L && L.game);
  }
  dirty(g) { if (g && g.details) g.details.dirty = true; }
}

/* A way through the air to a hive, for a bee that flying straight at it got
   no nearer (behind leaves, under an overhang): a best-first search over the
   cells a bee fits in, six ways, within 24 blocks of the hive and at most
   2000 cells looked at (leaning hard toward the hive, so a way round is
   found quickly rather than the shortest); the cells to fly through, the
   last within two blocks of the hive's middle, or null. */
function airPath(T, e, h) {
  const open = (x, y, z) => { const b = T.get(x, y, z); return !SOLID[b] && !FLUID[b]; };
  const sx = Math.floor(e.pos.x), sy = Math.floor(e.pos.y + 0.3), sz = Math.floor(e.pos.z), hx = h[0], hy = h[1] + 0.3, hz = h[2];
  const far = (x, y, z) => Math.abs(x - h[0]) > 24 || Math.abs(y - h[1]) > 24 || Math.abs(z - h[2]) > 24;
  if (far(sx, sy, sz) || !open(sx, sy, sz)) return null;
  const key = (x, y, z) => ((x - h[0] + 25) * 51 + (y - h[1] + 25)) * 51 + (z - h[2] + 25);
  const est = (x, y, z) => 2 * (Math.abs(x - hx) + Math.abs(y - hy) + Math.abs(z - hz));
  const cells = [[sx, sy, sz]], from = [-1], g = [0], f = [est(sx, sy, sz)], seen = new Uint8Array(51 * 51 * 51), heap = [0];
  seen[key(sx, sy, sz)] = 1;
  const push = i => { let k = heap.length; heap.push(i); while (k > 0) { const q = (k - 1) >> 1; if (f[heap[q]] <= f[i]) break; heap[k] = heap[q]; k = q; } heap[k] = i; };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let k = 0;
      for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && f[heap[c + 1]] < f[heap[c]]) c++; if (f[heap[c]] >= f[last]) break; heap[k] = heap[c]; k = c; }
      heap[k] = last;
    }
    return top;
  };
  const STEP = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let n = 0; heap.length && n < 2000; n++) {
    const i = pop(), [x, y, z] = cells[i];
    if ((x - hx) ** 2 + (y - hy) ** 2 + (z - hz) ** 2 < 3.6) {
      const path = [];
      for (let k = i; k > 0; k = from[k]) path.push(cells[k]);
      return path.reverse();
    }
    for (const [dx, dy, dz] of STEP) {
      const nx = x + dx, ny = y + dy, nz = z + dz, k = key(nx, ny, nz);
      if (far(nx, ny, nz) || seen[k]) continue;
      seen[k] = 1;
      if (!open(nx, ny, nz)) continue;
      cells.push([nx, ny, nz]); from.push(i); g.push(g[i] + 1); f.push(g[i] + 1 + est(nx, ny, nz));
      push(cells.length - 1);
    }
  }
  return null;
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
