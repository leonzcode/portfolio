/* ---------------------------------------------------------------------------
   Leoncraft 2 - finding the way: A* over the blocks, as the game's walking
   mobs do it.

   A node is a block a mob can stand in: room for its height, something to
   stand on (or water to swim in). From each node the four neighbours are
   tried at the same height, one up if there is head room to jump, or down
   a drop of up to three blocks; a diagonal only where both sides it cuts
   past are open. Some cells cost extra (water 8, next to fire or cactus 8)
   and some are never entered (lava, fire, cactus, fences, closed doors for
   mobs that cannot open them, powder snow). The search stops after a
   number of nodes that grows with the mob's follow range, and returns the
   way to the nearest node it found if the goal cannot be reached.

   The path is then walked by Navigation: towards the next node's centre
   until within reach of it, re-planned when the mob is stuck.
--------------------------------------------------------------------------- */
import { BLOCKS, SOLID, FLUID, B } from '../blocks.js?v=107';
import { collisionBoxes } from '../models.js?v=107';

const BLOCKED = -1;
// what a cell is, for a walker (a cost, or BLOCKED)
const DOOR = /_door$/, FENCE = /(_fence|_wall|_fence_gate)$/, HURT = /^(cactus|sweet_berry_bush|fire|soul_fire|magma_block|campfire|soul_campfire|wither_rose|powder_snow)$/;
let KIND = null;      // per block id: 0 plain, 1 door, 2 fence-like, 3 hurts, 4 trapdoor
function kinds() {
  if (KIND) return KIND;
  KIND = new Uint8Array(4096);
  for (const d of BLOCKS) {
    if (!d) continue;
    const n = d.name;
    if (DOOR.test(n)) KIND[d.id] = n === 'iron_door' ? 5 : 1;
    else if (FENCE.test(n)) KIND[d.id] = 2;
    else if (HURT.test(n)) KIND[d.id] = 3;
    else if (/_trapdoor$/.test(n)) KIND[d.id] = 4;
  }
  return KIND;
}

class Node { constructor() { this.x = 0; this.y = 0; this.z = 0; this.g = 0; this.f = 0; this.h = 0; this.parent = null; this.heap = -1; this.closed = false; this.cost = 0; } }

export class PathFinder {
  constructor(terrain) {
    this.t = terrain;
    this.pool = []; this.used = 0;
    this.map = new Map();
    this.costs = new Map();
    this.heap = [];
    kinds();
  }
  node(x, y, z) {
    const k = ((x & 0xfff) * 4096 + (z & 0xfff)) * 512 + (y & 511);
    let n = this.map.get(k);
    if (n) return n;
    n = this.pool[this.used] || (this.pool[this.used] = new Node());
    this.used++;
    n.x = x; n.y = y; n.z = z; n.g = Infinity; n.f = 0; n.h = 0; n.parent = null; n.heap = -1; n.closed = false; n.cost = 0;
    this.map.set(k, n);
    return n;
  }
  /* ---- cells ---- */
  // the top of the collision in a cell (0 none, up to 1.5 for fences)
  top(x, y, z) {
    const b = this.t.get(x, y, z);
    if (!b || !SOLID[b]) return 0;
    const d = BLOCKS[b];
    if (d.shape === 'cube') return 1;
    if (KIND[b] === 2) return 1.5;
    const T = this.t;
    T.nbx = x; T.nby = y; T.nbz = z;
    const boxes = collisionBoxes(d, T.meta(x, y, z), T.nbFn);
    let h = 0;
    if (boxes) for (const q of boxes) if (q[4] > h) h = q[4];
    return h;
  }
  // can the mob's body be in this cell (and the ones above it for its height)?
  open(x, y, z, mob) {
    const hh = Math.ceil(mob.h);
    for (let i = 0; i < hh; i++) {
      const b = this.t.get(x, y + i, z);
      if (!b) continue;
      const k = KIND[b];
      if (FLUID[b] === 2) return BLOCKED;
      if (k === 3) return BLOCKED;
      if (k === 1 || k === 5) {
        if (k === 1 && mob.canOpenDoors) continue;
        // an open door can be walked through (meta bit 4 is "open" in place.js)
        if (this.t.meta(x, y + i, z) & 4) continue;
        return BLOCKED;
      }
      if (k === 4) continue;
      if (SOLID[b] && this.top(x, y + i, z) > (i === 0 ? 0.0 : 0)) return BLOCKED;
    }
    return 0;
  }
  // the cost of standing at (x, y, z): BLOCKED, or the extra on top of the distance (remembered for one search)
  cost(x, y, z, mob) {
    const k = ((x & 0xfff) * 4096 + (z & 0xfff)) * 512 + (y & 511);
    let c = this.costs.get(k);
    if (c === undefined) { c = this.cost0(x, y, z, mob); this.costs.set(k, c); }
    return c;
  }
  cost0(x, y, z, mob) {
    if (this.open(x, y, z, mob) === BLOCKED) return BLOCKED;
    const T = this.t, b = T.get(x, y, z);
    if (FLUID[b] === 1) return mob.waterCost !== undefined ? mob.waterCost : 8;
    const below = T.get(x, y - 1, z);
    if (FLUID[below] === 2 || KIND[below] === 3) return BLOCKED;
    // next to something that hurts: avoid
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = T.get(x + dx, y, z + dz);
      if (KIND[n] === 3 || FLUID[n] === 2) return 8;
    }
    return 0;
  }
  // something to stand on (or water to float in) under (x, y, z)?
  floor(x, y, z) {
    const T = this.t, below = T.get(x, y - 1, z);
    if (FLUID[T.get(x, y, z)] === 1) return true;
    if (!below) return false;
    if (FLUID[below] === 1) return true;
    return SOLID[below] && this.top(x, y - 1, z) >= 0.5;
  }
  /* The node a step in (dx, dz) from n lands on: level, one up, or dropping. */
  stepTo(n, dx, dz, mob) {
    const x = n.x + dx, z = n.z + dz;
    let y = n.y;
    let c = this.cost(x, y, z, mob);
    if (c === BLOCKED) {
      // one up, if there is room to jump from here and the thing in the way is not a fence
      const t = this.top(x, y, z);
      if (t > 1 || !this.t.loaded(x, z)) return null;
      if (this.open(n.x, n.y + Math.ceil(mob.h), n.z, mob) === BLOCKED && mob.h > 0) {
        if (this.t.solid(n.x, n.y + Math.ceil(mob.h), n.z)) return null;
      }
      y = n.y + 1;
      c = this.cost(x, y, z, mob);
      if (c === BLOCKED || !this.floor(x, y, z)) return null;
      return [x, y, z, c];
    }
    if (this.floor(x, y, z)) return [x, y, z, c];
    // nothing under it: fall, up to the drop it is willing to take
    const max = mob.maxFall !== undefined ? mob.maxFall : 3;
    for (let k = 1; k <= max + 1; k++) {
      const yy = y - k;
      if (yy < 0) return null;
      const cc = this.cost(x, yy, z, mob);
      if (cc === BLOCKED) return null;
      if (this.floor(x, yy, z)) return k <= max || FLUID[this.t.get(x, yy, z)] === 1 ? [x, yy, z, cc] : null;
    }
    return null;
  }

  /* ---- the search ----
     from the mob's feet to (tx, ty, tz); within reach blocks counts as there.
     Returns a list of [x, y, z] or null. */
  find(mob, tx, ty, tz, reach, maxNodes) {
    this.used = 0; this.map.clear(); this.heap.length = 0; this.costs.clear();
    const T = this.t;
    let sx = Math.floor(mob.pos.x), sy = Math.floor(mob.pos.y + 0.01), sz = Math.floor(mob.pos.z);
    // in water, stand on the surface
    if (FLUID[T.get(sx, sy, sz)] === 1 && mob.floats) while (FLUID[T.get(sx, sy + 1, sz)] === 1) sy++;
    // standing on the edge of a slab or in the air: the cell under counts
    if (!this.floor(sx, sy, sz) && mob.onGround) { if (this.floor(sx, sy - 1, sz)) sy--; }
    const start = this.node(sx, sy, sz);
    start.g = 0; start.h = dist(sx, sy, sz, tx, ty, tz); start.f = start.h;
    this.push(start);
    let best = start;
    const r2 = reach * reach;
    let visited = 0;
    while (this.heap.length) {
      const n = this.pop();
      n.closed = true;
      if (dist2(n.x + 0.5, n.y, n.z + 0.5, tx, ty, tz) <= r2) { best = n; break; }
      if (n.h < best.h) best = n;
      if (++visited >= maxNodes) break;
      for (let d = 0; d < 8; d++) {
        const dx = DX[d], dz = DZ[d];
        let to;
        if (d < 4) to = this.stepTo(n, dx, dz, mob);
        else {
          // a diagonal: only past two open sides, and not climbing
          const a = this.stepTo(n, dx, 0, mob), b = this.stepTo(n, 0, dz, mob);
          if (!a || !b || a[1] > n.y || b[1] > n.y) continue;
          to = this.stepTo(n, dx, dz, mob);
          if (!to || to[1] !== n.y) continue;
        }
        if (!to) continue;
        const m = this.node(to[0], to[1], to[2]);
        if (m.closed) continue;
        const g = n.g + dist(n.x, n.y, n.z, m.x, m.y, m.z) + to[3];
        if (g < m.g) {
          m.g = g; m.parent = n; m.cost = to[3];
          m.h = dist(m.x, m.y, m.z, tx, ty, tz);
          m.f = g + m.h * 1.0;
          if (m.heap < 0) this.push(m); else this.up(m.heap);
        }
      }
    }
    if (best === start) return null;
    const out = [];
    for (let n = best; n && n !== start; n = n.parent) out.push([n.x, n.y, n.z]);
    out.reverse();
    return out;
  }
  // a binary heap on f
  push(n) { const h = this.heap; n.heap = h.length; h.push(n); this.up(n.heap); }
  pop() {
    const h = this.heap, top = h[0], last = h.pop();
    top.heap = -1;
    if (h.length) { h[0] = last; last.heap = 0; this.down(0); }
    return top;
  }
  up(i) {
    const h = this.heap, n = h[i];
    while (i > 0) { const p = (i - 1) >> 1; if (h[p].f <= n.f) break; h[i] = h[p]; h[i].heap = i; i = p; }
    h[i] = n; n.heap = i;
  }
  down(i) {
    const h = this.heap, n = h[i], len = h.length;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= len) break;
      if (c + 1 < len && h[c + 1].f < h[c].f) c++;
      if (h[c].f >= n.f) break;
      h[i] = h[c]; h[i].heap = i; i = c;
    }
    h[i] = n; n.heap = i;
  }
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const dist = (ax, ay, az, bx, by, bz) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
const dist2 = (ax, ay, az, bx, by, bz) => (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;

/* ---------------------------------------------------------------------------
   Walking a path
--------------------------------------------------------------------------- */
export class Navigation {
  constructor(mob) {
    this.mob = mob;
    this.path = null; this.i = 0; this.speed = 1;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.lastCheck = 0; this.lastX = 0; this.lastZ = 0; this.nodeT = 0;
    this.pending = false;
  }
  isDone() { return !this.path || this.i >= this.path.length; }
  stop() { this.path = null; this.i = 0; this.pending = false; }
  // plan a way to a point (false if there is none, or the planner is busy this tick)
  moveTo(x, y, z, speed, reach) {
    const m = this.mob.m;
    if (!m.pathBudget()) return false;
    const path = m.paths.find(this.mob, x, y, z, reach !== undefined ? reach : 1, Math.round((this.mob.constructor.FOLLOW || 16) * 16));
    this.speed = speed;
    if (!path || !path.length) { this.path = null; return false; }
    this.path = path; this.i = 0;
    this.tx = x; this.ty = y; this.tz = z;
    this.lastCheck = this.mob.age; this.lastX = this.mob.pos.x; this.lastZ = this.mob.pos.z; this.nodeT = 0;
    return true;
  }
  moveToEntity(e, speed) { return this.moveTo(e.pos.x, e.pos.y, e.pos.z, speed, 1); }
  // the end of the path, if any
  end() { return this.path && this.path.length ? this.path[this.path.length - 1] : null; }
  tick() {
    if (this.isDone()) return;
    const mob = this.mob, p = mob.pos;
    const reach = mob.w > 0.75 ? mob.w / 2 : 0.75 - mob.w / 2;
    // skip the nodes already reached (the game also looks one ahead)
    while (this.i < this.path.length) {
      const n = this.path[this.i];
      const dx = n[0] + 0.5 - p.x, dz = n[2] + 0.5 - p.z, dy = n[1] - p.y;
      if (Math.abs(dx) < reach && Math.abs(dz) < reach && Math.abs(dy) < 1) { this.i++; this.nodeT = 0; continue; }
      // already past it, heading for the one after in the same direction
      if (this.i + 1 < this.path.length && Math.abs(dy) < 1) {
        const m2 = this.path[this.i + 1];
        const ax = m2[0] - n[0], az = m2[2] - n[2];
        if (m2[1] === n[1] && (ax * dx + az * dz) < 0 && dx * dx + dz * dz < 1) { this.i++; this.nodeT = 0; continue; }
      }
      break;
    }
    if (this.isDone()) { this.path = null; return; }
    const n = this.path[this.i];
    mob.setWanted(n[0] + 0.5, n[1] + this.floorAt(n), n[2] + 0.5, this.speed);
    // stuck: no real progress in 100 ticks, or one node for too long
    if (++this.nodeT > 120) { this.stop(); return; }
    if (mob.age - this.lastCheck >= 100) {
      const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
      if (moved < mob.speed * this.speed * 100 * 0.25 * 0.5) { this.stop(); return; }
      this.lastCheck = mob.age; this.lastX = p.x; this.lastZ = p.z;
    }
  }
  floorAt(n) { return 0; }
}
