/* ---------------------------------------------------------------------------
   Leoncraft 2 - items lying in the world, and experience orbs.

   Item entities as the game has them (Minecraft Wiki, Item (entity)):
   a box 0.25 wide, gravity 0.04 a tick, drag 0.98 (and the ground's
   slipperiness, 0.6, underfoot), a bounce of half its speed off the
   ground, floating up in water; a block's drops jump out of its middle,
   thrown items fly where you look. They can be picked up after 10 ticks
   (40 for one you threw), by walking within a block of them (half a block
   up and down); stacks of the same item lying within half a block join
   into one (checked every 2 ticks when one crosses into another block,
   every 40 otherwise); after five minutes (6000 ticks) they are gone.
   They have 5 health: fire takes 1 a tick (soul fire 2), a cactus 1, lava
   4, so an item lasts five ticks in fire and two in lava. Netherite (and
   ancient debris) does not burn and floats up through lava as other items
   do through water. They spin and bob as they lie there: a block is drawn
   as a small block, anything else as its flat picture, and a bigger stack
   as more copies (2 from 2, 3 from 17, 4 from 33, 5 from 49).

   Experience orbs: split into the game's sizes (1, 3, 7, 17, 37, 73, 149,
   307, 617, 1237, 2477 points), gravity 0.03, drawn as their picture
   always facing you, pulsing green and yellow; within 8 blocks they fly to
   you, faster the closer they are; they are taken within the same reach as
   items, one every 2 ticks. Fire, cactus and lava destroy them as they do
   items.

     const drops = new Drops(world, renderer);
     scene.add(drops.group)             (main.js does this)
     drops.tick(player, collector)      20 times a second
     drops.update(dt, alpha)            every frame, before drawing
     dropItem(world, x, y, z, 'diamond', 2)     from anywhere (mob loot...)
     giveXp(x, y, z, 7)
--------------------------------------------------------------------------- */
import { B, BLOCKS, SOLID, FLUID } from './blocks.js?v=34';
import { collisionBoxes } from './models.js?v=34';
import { LEVEL, FALLING } from './world-const.js?v=34';
import { lightNear } from './lightlevel.js?v=34';
import { glints } from './render/armor.js?v=34';
import { setGlint } from './render/glint.js?v=34';
import { DIMS } from './dims.js?v=34';
import { DRAW, I, ITEMS, maxStack, sameItem, withCount, stackToJSON, stackFromJSON, textureLayer } from './items.js?v=34';
import { blockGeometry, intAttribute } from './render/blockmesh.js?v=34';
const THREE = window.THREE;

const ITEM_W = 0.125, ITEM_H = 0.25;           // half width, height
const ORB_W = 0.5, ORB_H = 0.5;                 // full width and height
const ORB_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
const MAX_ITEMS = 400;

let active = null;
// spawn an item entity: from mob loot, a broken container... (the active world's Drops)
export function dropItem(world, x, y, z, item, count, opts) {
  if (!active) return null;
  const id = typeof item === 'number' ? item : I[item];
  if (!id) return null;
  return active.spawn(x, y, z, { id, count: count || 1 }, opts);
}
export function dropStack(x, y, z, stack, opts) { return active ? active.spawn(x, y, z, stack, opts) : null; }
// experience orbs worth amount points, split as the game splits them
export function giveXp(x, y, z, amount) { if (active) active.xp(x, y, z, amount); }
export function activeDrops() { return active; }

export function orbValue(amount) { for (const v of ORB_SIZES) if (amount >= v) return v; return 1; }
// items fire and lava cannot hurt (the game's netherite)
const fireproof = new Map();
function fireResistant(id) {
  let v = fireproof.get(id);
  if (v === undefined) { const n = ITEMS[id] ? ITEMS[id].name : ''; v = /^netherite_(?!upgrade)/.test(n) || n === 'ancient_debris'; fireproof.set(id, v); }
  return v;
}
// how many copies of an item are drawn for a stack of n (the wiki's Item (entity) page)
export const copiesFor = n => (n > 48 ? 5 : n > 32 ? 4 : n > 16 ? 3 : n > 1 ? 2 : 1);
/* A geometry holding n copies of an item's: a block's scattered up to 0.15
   of a block each way, a flat picture's stacked behind it and a little
   askew, the same for every stack of that item. Positions keep the vertex
   format's units (1/32 of a block) and are lifted one more block, so the
   copies below the first stay positive (the mesh is lowered again). */
function copiesOf(src, n, flat, id, sc) {
  const P = src.attributes.aPos.array, A = src.attributes.aA.array, C = src.attributes.aC.array, I = src.index.array;
  const nv = P.length / 4, pos = new Uint16Array(P.length * n), aa = new Uint8Array(A.length * n), cc = new Uint8Array(C.length * n), idx = [];
  let s = (id * 7919 + 13) % 2147483647 || 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const u = 32 / sc;                       // world blocks to mesh units
  for (let k = 0; k < n; k++) {
    let ox = 0, oy = 0, oz = 0;
    if (k > 0) {
      if (flat) { ox = (rnd() * 2 - 1) * 0.075; oy = (rnd() * 2 - 1) * 0.075; oz = -0.09375 * k; }
      else { ox = (rnd() * 2 - 1) * 0.15; oy = (rnd() * 2 - 1) * 0.15; oz = (rnd() * 2 - 1) * 0.15; }
    }
    const dx = Math.round(ox * u), dy = Math.round(oy * u) + 32, dz = Math.round(oz * u);
    for (let v = 0; v < nv; v++) {
      const o = (k * nv + v) * 4, i = v * 4;
      pos[o] = P[i] + dx; pos[o + 1] = Math.max(0, P[i + 1] + dy); pos[o + 2] = P[i + 2] + dz; pos[o + 3] = P[i + 3];
    }
    aa.set(A, k * A.length); cc.set(C, k * C.length);
    for (let j = 0; j < I.length; j++) idx.push(I[j] + k * nv);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aPos', intAttribute(pos));
  g.setAttribute('aA', intAttribute(aa));
  g.setAttribute('aL', intAttribute(new Uint8Array(nv * n * 4)));
  g.setAttribute('aC', intAttribute(cc));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return g;
}
// what touching a block does to an item or an orb a tick: fire 1, soul fire 2, a cactus 1
const HURTS = new Map();
for (const [n, d] of [['fire', 1], ['soul_fire', 2], ['cactus', 1]]) if (B[n] !== undefined) HURTS.set(B[n], d);
function orbIcon(v) { for (let i = 0; i < ORB_SIZES.length; i++) if (v >= ORB_SIZES[i]) return 10 - i; return 0; }

export class Drops {
  constructor(world, renderer) {
    this.world = world; this.R = renderer;
    this.group = new THREE.Group();
    this.group.name = 'drops';
    this.items = [];
    this.orbs = [];
    this.bits = [];                  // crumbs of food while eating
    this.geo = new Map();            // item id -> shared block geometry
    this.ticks = 0;
    this.takeXpDelay = 0;
    this.onPickup = null;            // (stack) the pickup sound
    this.onXp = null;                // (points) the orb sound
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._lift = new THREE.Matrix4().makeTranslation(0, -1, 0);
    this._lift2 = new THREE.Matrix4().makeTranslation(0, -2, 0);      // for the copies' geometry, a block higher
    this._rot = new THREE.Matrix3();
    this._y = new THREE.Vector3(0, 1, 0);
    active = this;
  }
  dispose() {
    for (const e of this.items) this._unmesh(e);
    for (const o of this.orbs) this._unmesh(o);
    for (const c of this.bits) this._unmesh(c);
    this.items.length = 0; this.orbs.length = 0; this.bits.length = 0;
    for (const g of this.geo.values()) g.geometry.dispose();
    this.geo.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
    if (active === this) active = null;
  }

  /* ---- spawning ---- */
  // a stack at (x, y, z) (the bottom of the item); opts: { vel: [x, y, z], delay, age, pop }
  spawn(x, y, z, stack, opts = {}) {
    if (!stack || !stack.id || stack.count <= 0 || !ITEMS[stack.id]) return null;
    if (this.items.length >= MAX_ITEMS) this._remove(this.items[0], 0);
    const e = {
      stack: withCount(stack, stack.count), pos: new THREE.Vector3(x, y, z), prev: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(), age: opts.age | 0, delay: opts.delay === undefined ? 10 : opts.delay, onGround: false,
      spin: Math.random() * Math.PI * 2, mesh: null, light: -1, lightT: 0, gone: false, fly: 0, hp: 5,
    };
    if (opts.vel) e.vel.set(opts.vel[0], opts.vel[1], opts.vel[2]);
    else if (opts.pop !== false) e.vel.set(Math.random() * 0.2 - 0.1, 0.2, Math.random() * 0.2 - 0.1);
    this.items.push(e);
    return e;
  }
  // what a broken block gives, jumping out of its middle (the game's popResource)
  popFrom(bx, by, bz, stack) {
    const h = 0.125;
    return this.spawn(bx + 0.5 + (Math.random() - 0.5) * 0.5, by + 0.5 - h + (Math.random() - 0.5) * 0.5, bz + 0.5 + (Math.random() - 0.5) * 0.5, stack);
  }
  // thrown by the player (Q, or out of a screen): forward from the eyes
  throwFrom(player, stack) {
    const yaw = player.yaw, pitch = player.pitch;
    const dx = -Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(yaw) * Math.cos(pitch);
    const a = Math.random() * Math.PI * 2, r = 0.02 * Math.random();
    const y = player.pos.y + (player.sneaking ? 1.27 : 1.62) - 0.3;
    const e = this.spawn(player.pos.x, y, player.pos.z, stack, {
      delay: 40, vel: [dx * 0.3 + Math.cos(a) * r, dy * 0.3 + 0.1 + (Math.random() - Math.random()) * 0.1, dz * 0.3 + Math.sin(a) * r],
    });
    // (thrown by you: a mob that picks it up is "given" it, as the game's advancements count)
    if (e) e.thrown = true;
    return e;
  }
  xp(x, y, z, amount) {
    amount = Math.floor(amount);
    while (amount > 0) {
      const v = orbValue(amount);
      amount -= v;
      this.orbs.push({
        value: v, pos: new THREE.Vector3(x, y, z), prev: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3((Math.random() * 0.2 - 0.1) * 2, Math.random() * 0.2 * 2, (Math.random() * 0.2 - 0.1) * 2),
        age: 0, onGround: false, mesh: null, follow: false, gone: false, phase: Math.random() * 100, hp: 5,
      });
    }
  }

  // little pieces of an item flying out (eating): n of them from (x, y, z), thrown along (dx, dz)
  crumbs(x, y, z, id, n, dx, dz) {
    for (let k = 0; k < n; k++) {
      if (this.bits.length > 60) break;
      this.bits.push({ id, pos: new THREE.Vector3(x, y, z), prev: new THREE.Vector3(x, y, z), life: 8 + Math.floor(Math.random() * 8),
        vel: new THREE.Vector3(dx * 0.08 + (Math.random() - 0.5) * 0.15, 0.1 + Math.random() * 0.1, dz * 0.08 + (Math.random() - 0.5) * 0.15),
        mesh: null, spin: Math.random() * 6 });
    }
  }

  /* ---- the world ---- */
  _solidBoxes(x0, y0, z0, x1, y1, z1, out) {
    out.length = 0;
    const w = this.world;
    for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
          if (!w.loaded(x, z)) { out.push(x, y, z, x + 1, y + 1, z + 1); continue; }
          const b = w.get(x, y, z);
          if (!b || !SOLID[b]) continue;
          const d = BLOCKS[b];
          // (a honey block's box is a sixteenth in and 15/16 tall: models.js collisionBoxes)
          if (d.shape === 'cube' && b !== B.honey_block) { out.push(x, y, z, x + 1, y + 1, z + 1); continue; }
          const boxes = collisionBoxes(d, w.meta(x, y, z), (dx, dy, dz) => { const n = w.get(x + dx, y + dy, z + dz); return n ? { d: BLOCKS[n], m: w.meta(x + dx, y + dy, z + dz) } : null; });
          if (boxes) for (const c of boxes) out.push(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
        }
    return out;
  }
  // move a box (half width hw, height h) by its velocity, stopping at solid boxes; sets onGround
  _move(e, hw, h) {
    const p = e.pos, v = e.vel, bx = this._bx || (this._bx = []);
    const ax = Math.abs(v.x) + hw + 1, ay = Math.abs(v.y) + 1, az = Math.abs(v.z) + hw + 1;
    this._solidBoxes(p.x - ax, p.y - ay, p.z - az, p.x + ax, p.y + h + ay, p.z + az, bx);
    const clip = (axis, d, lo, hi) => {
      const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
      for (let i = 0; i < bx.length; i += 6) {
        if (bx[i + a1 + 3] <= lo[a1] + 1e-7 || bx[i + a1] >= hi[a1] - 1e-7) continue;
        if (bx[i + a2 + 3] <= lo[a2] + 1e-7 || bx[i + a2] >= hi[a2] - 1e-7) continue;
        if (d > 0 && bx[i + axis] >= hi[axis] - 1e-7) d = Math.min(d, bx[i + axis] - hi[axis]);
        else if (d < 0 && bx[i + axis + 3] <= lo[axis] + 1e-7) d = Math.max(d, bx[i + axis + 3] - lo[axis]);
      }
      return d;
    };
    const lo = [p.x - hw, p.y, p.z - hw], hi = [p.x + hw, p.y + h, p.z + hw];
    const my = clip(1, v.y, lo, hi); lo[1] += my; hi[1] += my;
    const mx = clip(0, v.x, lo, hi); lo[0] += mx; hi[0] += mx;
    const mz = clip(2, v.z, lo, hi);
    e.onGround = v.y < 0 && my !== v.y;
    p.x += mx; p.y += my; p.z += mz;
    if (my !== v.y) e.hitY = true; else e.hitY = false;
    if (mx !== v.x) v.x = 0;
    if (mz !== v.z) v.z = 0;
  }
  // stuck inside a block (it was placed on top of us): out the top
  _unstick(e) {
    const w = this.world, x = Math.floor(e.pos.x), y = Math.floor(e.pos.y + 0.1), z = Math.floor(e.pos.z);
    const b = w.get(x, y, z);
    if (b && SOLID[b] && BLOCKS[b].shape === 'cube') { e.vel.y = 0.1; e.pos.y = Math.max(e.pos.y, y + 1 - 0.05); return true; }
    return false;
  }
  /* Water (1) or lava (2) round the box, measured from the fluid's surface
     as the player's is (player.js): a still block is 8/9 deep. Sets e.depth,
     how far the surface is over the bottom of the box (-1 out of it). */
  _fluid(e, hw = ITEM_W, h = ITEM_H) {
    const w = this.world, p = e.pos, f = Math.floor, k = 1e-3;
    let kind = 0, depth = -1;
    for (let y = f(p.y + k); y <= f(p.y + h - k); y++)
      for (let z = f(p.z - hw + k); z <= f(p.z + hw - k); z++)
        for (let x = f(p.x - hw + k); x <= f(p.x + hw - k); x++) {
          const b = w.get(x, y, z);
          const fk = FLUID[b] || (BLOCKS[b] && BLOCKS[b].waterlogged ? 1 : 0);
          if (!fk) continue;
          const above = w.get(x, y + 1, z), m = w.meta(x, y, z);
          const top = (FLUID[above] === fk || (fk === 1 && BLOCKS[above] && BLOCKS[above].waterlogged)) ? y + 1
            : y + (!FLUID[b] ? 8 / 9 : ((m & FALLING) ? 8 : 8 - (m & LEVEL)) / 9);
          if (top > p.y && top - p.y > depth) { depth = top - p.y; kind = fk; }
        }
    e.depth = depth;
    return kind;
  }
  /* The harm a tick from fire and cactus in any block the box (half width
     hw, height h) is in. A cactus is a sixteenth smaller than its block, so
     lying on it or against its side is being in it. noFire: only the cactus counts. */
  _touchDamage(e, hw, h, noFire) {
    const w = this.world, p = e.pos, g = 1 / 16, f = Math.floor, k = 1e-7;
    const x0 = f(p.x - hw + k), x1 = f(p.x + hw - k), z0 = f(p.z - hw + k), z1 = f(p.z + hw - k), y0 = f(p.y + k);
    let dmg = 0;
    for (let y = f(p.y - g + k); y <= f(p.y + h - k); y++)
      for (let z = f(p.z - hw - g + k); z <= f(p.z + hw + g - k); z++)
        for (let x = f(p.x - hw - g + k); x <= f(p.x + hw + g - k); x++) {
          const b = w.get(x, y, z), d = HURTS.get(b);
          if (!d) continue;
          if (b !== B.cactus && (noFire || x < x0 || x > x1 || z < z0 || z > z1 || y < y0)) continue;
          dmg += d;
        }
    return dmg;
  }
  _slip(e) {
    const b = this.world.get(Math.floor(e.pos.x), Math.floor(e.pos.y - 0.5), Math.floor(e.pos.z));
    return (BLOCKS[b] && BLOCKS[b].slippery) || 0.6;
  }

  /* ---- once a tick ----
     collector: { inv, addXp(points), mendingRepair?(points) -> points left, alive } */
  tick(player, collector) {
    this.ticks++;
    if (this.takeXpDelay > 0) this.takeXpDelay--;
    const P = player ? player.pos : null;
    // 64 below the dimension's floor is the void: anything falling there is gone (heights here are y + 64)
    const voidY = (DIMS[this.world && this.world.dim] || DIMS.overworld).minY;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      e.prev.copy(e.pos);
      if (e.fly > 0) { if (--e.fly <= 0 || !P) this._remove(e, i); continue; }
      e.age++;
      if (e.delay > 0) e.delay--;
      if (e.age >= 6000) { this._remove(e, i); continue; }
      const fl = this._fluid(e);
      // fire, lava and cactus wear its 5 health away (netherite does not burn)
      const proof = fireResistant(e.stack.id);
      const harm = (fl === 2 && !proof ? 4 : 0) + this._touchDamage(e, ITEM_W, ITEM_H, proof);
      if (harm > 0 && (e.hp -= harm) <= 0) { this._remove(e, i); continue; }
      // more than a tenth of a block into water (or lava, for what survives it) it floats up; otherwise it falls
      if (fl && e.depth > 0.1) {
        const drag = fl === 1 ? 0.99 : 0.95;
        e.vel.x *= drag; e.vel.z *= drag;
        if (e.vel.y < 0.06) e.vel.y += 5e-4;
      } else e.vel.y -= 0.04;
      if (!this._unstick(e) && (!e.onGround || e.vel.x * e.vel.x + e.vel.z * e.vel.z > 1e-5 || (this.ticks + i) % 4 === 0)) {
        this._move(e, ITEM_W, ITEM_H);
        const f = e.onGround ? this._slip(e) * 0.98 : 0.98;
        e.vel.x *= f; e.vel.y *= 0.98; e.vel.z *= f;
        if (e.onGround && e.vel.y < 0) e.vel.y *= -0.5;
        if (e.hitY && !e.onGround) e.vel.y = 0;
      }
      if (e.pos.y < voidY) { this._remove(e, i); continue; }
      // join a stack of the same item close by: every 2 ticks of its age when it crossed into another block, else every 40
      const f = Math.floor;
      const crossed = f(e.pos.x) !== f(e.prev.x) || f(e.pos.y) !== f(e.prev.y) || f(e.pos.z) !== f(e.prev.z);
      // (a stack can take in several before it in the list at once: the loop carries on below where it is now,
      // not past the end of the shortened list)
      if (e.age % (crossed ? 2 : 40) === 0) i -= this._merge(e, i);
      if (e.gone) continue;
      // picked up
      if (P && collector && collector.alive && e.delay <= 0) {
        const dx = Math.abs(e.pos.x - P.x), dz = Math.abs(e.pos.z - P.z);
        if (dx < 0.3 + 1 + ITEM_W && dz < 0.3 + 1 + ITEM_W && e.pos.y + ITEM_H > P.y - 0.5 && e.pos.y < P.y + 1.8 + 0.5) {
          const before = e.stack.count;
          const left = collector.inv.addStack(e.stack);
          if (left < before) {
            if (this.onPickup) this.onPickup(e.stack);
            if (left === 0) { e.fly = 3; e.flyFrom = e.pos.clone(); e.delay = 1e9; }
            else e.stack.count = left;
          }
        }
      }
    }
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const c = this.bits[i];
      c.prev.copy(c.pos);
      c.vel.y -= 0.04; c.vel.multiplyScalar(0.98);
      c.pos.add(c.vel);
      if (--c.life <= 0) { this._unmesh(c); this.bits.splice(i, 1); }
    }
    // the orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.prev.copy(o.pos);
      o.age++;
      if (o.age >= 6000) { this._removeOrb(o, i); continue; }
      const fl = this._fluid(o, ORB_W / 2, ORB_H);
      // lava, fire and cactus wear an orb's 5 health away as they do an item's
      const harm = (fl === 2 ? 4 : 0) + this._touchDamage(o, ORB_W / 2, ORB_H);
      if (harm > 0 && (o.hp -= harm) <= 0) { this._removeOrb(o, i); continue; }
      // it floats once the water is over its eyes (0.85 of its height up); lava throws it up
      if (fl === 1 && o.depth > ORB_H * 0.85) { o.vel.x *= 0.99; o.vel.z *= 0.99; if (o.vel.y < 0.06) o.vel.y += 5e-4; }
      else o.vel.y -= 0.03;
      if (fl === 2) { o.vel.set((Math.random() - Math.random()) * 0.2, 0.2, (Math.random() - Math.random()) * 0.2); }
      this._unstick(o);
      if (P && (o.age % 20 === 1 || o.follow)) {
        const dx = P.x - o.pos.x, dy = P.y + 0.81 - o.pos.y, dz = P.z - o.pos.z;
        o.follow = dx * dx + dy * dy + dz * dz < 64 && collector && collector.alive;
        if (o.follow) {
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) / 8, f = 1 - l;
          if (f > 0 && l > 0) { const k = f * f * 0.1 / (l * 8); o.vel.x += dx * k; o.vel.y += dy * k; o.vel.z += dz * k; }
        }
      }
      this._move(o, ORB_W / 2, ORB_H);
      const f = o.onGround ? this._slip(o) * 0.98 : 0.98;
      o.vel.x *= f; o.vel.y *= 0.98; o.vel.z *= f;
      if (o.onGround && o.vel.y < 0) o.vel.y *= -0.9;
      if (o.pos.y < voidY) { this._removeOrb(o, i); continue; }
      // within the player's reach for things on the ground (a block out to the sides, half a block up and down): one orb every two ticks
      if (P && collector && collector.alive && this.takeXpDelay === 0) {
        if (Math.abs(o.pos.x - P.x) < 0.3 + 1 + ORB_W / 2 && Math.abs(o.pos.z - P.z) < 0.3 + 1 + ORB_W / 2 && o.pos.y + ORB_H > P.y - 0.5 && o.pos.y < P.y + 1.8 + 0.5) {
          this.takeXpDelay = 2;
          let pts = o.value;
          if (collector.mendingRepair) pts = collector.mendingRepair(pts);
          if (pts > 0) collector.addXp(pts);
          if (this.onXp) this.onXp(o.value);
          this._removeOrb(o, i);
        }
      }
    }
  }
  // e takes in (or goes into) stacks of the same item close by; at: e's place in the list.
  // Returns how many stacks before that place went, so a loop over the list can keep its place.
  _merge(e, at = -1) {
    const max = maxStack(e.stack.id);
    let before = 0;
    if (e.stack.count >= max) return before;
    for (const o of this.items) {
      if (o === e || o.gone || o.fly > 0 || !sameItem(o.stack, e.stack)) continue;
      if (Math.abs(o.pos.x - e.pos.x) > 0.5 + 2 * ITEM_W || Math.abs(o.pos.z - e.pos.z) > 0.5 + 2 * ITEM_W || Math.abs(o.pos.y - e.pos.y) > ITEM_H) continue;
      if (o.stack.count + e.stack.count > max) continue;
      // the bigger stack takes the smaller one in
      const [big, small] = o.stack.count >= e.stack.count ? [o, e] : [e, o];
      big.stack.count += small.stack.count;
      big.delay = Math.max(big.delay, small.delay);
      big.age = Math.min(big.age, small.age);
      const k = this.items.indexOf(small);
      if (small !== e && k >= 0 && k < at - before) before++;
      this._remove(small, k);
      if (small === e) return before;
    }
    return before;
  }
  _remove(e, i) {
    e.gone = true;
    this._unmesh(e);
    if (i < 0 || this.items[i] !== e) i = this.items.indexOf(e);
    if (i >= 0) this.items.splice(i, 1);
  }
  _removeOrb(o, i) {
    o.gone = true;
    this._unmesh(o);
    if (this.orbs[i] !== o) i = this.orbs.indexOf(o);
    if (i >= 0) this.orbs.splice(i, 1);
  }
  _unmesh(e) {
    if (!e.mesh) return;
    this.group.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.mesh = null;
  }

  /* ---- drawing ---- */
  _base(id) {
    let g = this.geo.get(id);
    if (!g) {
      const d = DRAW[id];
      if (!d || !d.faces) return null;
      g = blockGeometry(d, d.iconMeta || 0);
      this.geo.set(id, g);
    }
    return g;
  }
  // the geometry for n copies of an item (a bigger stack), made once per item and count
  _copies(id, n) {
    const one = this._base(id);
    if (!one || n <= 1) return one;
    const key = id + ':' + n;
    let g = this.geo.get(key);
    if (!g) {
      g = { geometry: copiesOf(one.geometry, n, one.flat, id, one.flat ? 0.5 : 0.25), flat: one.flat, cutout: one.cutout, lifted: true };
      this.geo.set(key, g);
    }
    return g;
  }
  // a mesh of its own (its own light), sharing the item's geometry
  _makeMesh(src, cutout) {
    const R = this.R, g = new THREE.BufferGeometry();
    for (const n of ['aPos', 'aA', 'aC']) g.setAttribute(n, src.attributes[n]);
    g.setIndex(src.index);
    g.setAttribute('aL', intAttribute(new Uint8Array(src.attributes.aL.count * 4)));
    g.boundingSphere = src.boundingSphere;
    const m = new THREE.Mesh(g, cutout ? R.mats.cutout : R.mats.opaque);
    m.matrixAutoUpdate = false; m.frustumCulled = false;
    const U = R.U, rot = this._rot;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    this.group.add(m);
    return m;
  }
  _orbGeometry(layer) {
    // one quad facing +z, the picture tinted by the vertex colour (flag 64)
    const verts = [], A = [], L = [], C = [];
    const put = (x, y, u, v) => { verts.push(Math.round((x + 8) * 32), Math.round((y + 1) * 32), Math.round(8 * 32), layer); A.push(u, v, 4, 3 | 64 | 32); L.push(0, 255, 0, 0); C.push(255, 255, 255, 255); };
    put(-0.5, -0.5, 0, 16); put(0.5, -0.5, 16, 16); put(0.5, 0.5, 16, 0); put(-0.5, 0.5, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('aPos', intAttribute(new Uint16Array(verts)));
    g.setAttribute('aA', intAttribute(new Uint8Array(A)));
    g.setAttribute('aL', intAttribute(new Uint8Array(L)));
    g.setAttribute('aC', intAttribute(new Uint8Array(C)));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    return g;
  }
  /* the light where an item lies, as the game takes it: the sky and block light in the block its
     middle is in (0.2125 up), from the chunk's own light (js/lightlevel.js). (It used to count
     only the blocks straight over it and borrow the player's torch light, so an item under an
     overhang or in a cave's mouth went pitch black, and one by a torch stayed dark.) */
  _lightAt(e) {
    const w = this.world;
    const v = lightNear(w, Math.floor(e.pos.x), Math.floor(e.pos.y + 0.2125), Math.floor(e.pos.z), !!w.noSky);
    return ((v >> 4) * 17 << 8) | ((v & 15) * 17);
  }
  update(dt, alpha, player, cam) {
    const P = player ? player.pos : null, m = this._m, q = this._q, s = this._s, p = this._p;
    for (const e of this.items) {
      // a stack that grew or shrank past a step is drawn with more or fewer copies
      const n = copiesFor(e.stack.count);
      if (e.mesh && e.copies !== n) this._unmesh(e);
      if (!e.mesh) {
        const g = this._copies(e.stack.id, n);
        if (!g) continue;
        e.mesh = this._makeMesh(g.geometry, g.cutout);
        e.flat = g.flat; e.copies = n; e.lifted = !!g.lifted;
        e.light = -1;
        // an enchanted one shimmers on the ground too, as the game draws it (render/glint.js)
        e.glint = glints(e.stack);
        if (e.glint) setGlint(e.mesh, true, this.R);
      }
      // the light, now and then
      if ((e.lightT -= dt) <= 0) {
        e.lightT = 0.5;
        const lv = this._lightAt(e);
        if (lv !== e.light) {
          e.light = lv;
          const Lr = e.mesh.geometry.attributes.aL;
          for (let k = 0; k < Lr.count; k++) { Lr.array[k * 4] = lv >> 8; Lr.array[k * 4 + 1] = lv & 255; }
          Lr.needsUpdate = true;
        }
      }
      const t = e.age + alpha;
      p.lerpVectors(e.prev, e.pos, alpha);
      // flying into the player when picked up
      if (e.fly > 0 && P) { const k = 1 - (e.fly - alpha) / 3; p.lerpVectors(e.flyFrom, this._p2 || (this._p2 = new THREE.Vector3()).set(P.x, P.y + 0.8, P.z), Math.max(0, Math.min(1, k))); }
      const bob = Math.sin(t / 10 + e.spin) * 0.1 + 0.1;
      const sc = e.flat ? 0.5 : 0.25;
      q.setFromAxisAngle(this._y, t / 20 + e.spin);
      s.set(sc, sc, sc);
      p.y += bob + (e.flat ? 0.25 : sc * 0.5);
      m.compose(p, q, s).multiply(e.lifted ? this._lift2 : this._lift);
      e.mesh.matrix.copy(m);
      e.mesh.matrixWorld.copy(m);
      // (the shimmer is a child: its place follows only when the parent's is worked out again)
      if (e.glint) e.mesh.matrixWorldNeedsUpdate = true;
    }
    for (const c of this.bits) {
      if (!c.mesh) {
        const g = this._base(c.id);
        if (!g) continue;
        c.mesh = this._makeMesh(g.geometry, g.cutout);
        const lv = this._lightAt(c), Lr = c.mesh.geometry.attributes.aL;
        for (let k = 0; k < Lr.count; k++) { Lr.array[k * 4] = lv >> 8; Lr.array[k * 4 + 1] = lv & 255; }
        Lr.needsUpdate = true;
      }
      p.lerpVectors(c.prev, c.pos, alpha);
      q.setFromAxisAngle(this._y, c.spin);
      s.set(0.12, 0.12, 0.12);
      m.compose(p, q, s).multiply(this._lift);
      c.mesh.matrix.copy(m); c.mesh.matrixWorld.copy(m);
    }
    for (const o of this.orbs) {
      if (!o.mesh) {
        const layer = textureLayer('xp_orb_' + orbIcon(o.value));
        if (layer < 0) continue;
        const g = this._orbGeometry(layer);
        const mesh = new THREE.Mesh(g, this.R.mats.cutout);
        mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
        this.group.add(mesh);
        o.mesh = mesh; o.lightT = 0; o.light = -1;
      }
      // its light, now and then: the light where it is, its block light 7 brighter, as the game lights an orb
      if ((o.lightT -= dt) <= 0) {
        o.lightT = 0.5;
        const w = this.world, v = lightNear(w, Math.floor(o.pos.x), Math.floor(o.pos.y + 0.2), Math.floor(o.pos.z), !!w.noSky);
        const lv = ((v >> 4) * 17 << 8) | (Math.min(15, (v & 15) + 7) * 17);
        if (lv !== o.light) {
          o.light = lv;
          const Lr = o.mesh.geometry.attributes.aL;
          for (let k = 0; k < 4; k++) { Lr.array[k * 4] = lv >> 8; Lr.array[k * 4 + 1] = lv & 255; }
          Lr.needsUpdate = true;
        }
      }
      const t = o.age + alpha + o.phase;
      // the game's pulse: red swings 0-255, green full, blue a little
      const r = Math.round((Math.sin(t / 2) + 1) * 0.5 * 255), b = Math.round((Math.sin(t / 2 + 4.1887903) + 1) * 0.1 * 255);
      const C = o.mesh.geometry.attributes.aC;
      for (let k = 0; k < 4; k++) { C.array[k * 4] = r; C.array[k * 4 + 1] = 255; C.array[k * 4 + 2] = b; }
      C.needsUpdate = true;
      p.lerpVectors(o.prev, o.pos, alpha);
      p.y += 0.1;
      // always facing the camera
      if (cam) q.copy(cam.quaternion); else q.identity();
      s.set(0.3, 0.3, 0.3);
      m.compose(p, q, s).multiply(this._lift);
      o.mesh.matrix.copy(m);
      o.mesh.matrixWorld.copy(m);
    }
  }

  /* ---- saving: items and orbs near where you are ---- */
  toJSON() {
    return {
      items: this.items.filter(e => !e.fly).slice(-200).map(e => [stackToJSON(e.stack), +e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2), e.age, e.delay]),
      orbs: this.orbs.slice(-200).map(o => [o.value, +o.pos.x.toFixed(2), +o.pos.y.toFixed(2), +o.pos.z.toFixed(2), o.age]),
    };
  }
  fromJSON(o) {
    if (!o) return;
    for (const a of o.items || []) { const st = stackFromJSON(a[0]); if (st) this.spawn(a[1], a[2], a[3], st, { age: a[4], delay: a[5], pop: false }); }
    for (const a of o.orbs || []) { this.xp(a[1], a[2], a[3], a[0]); const orb = this.orbs[this.orbs.length - 1]; if (orb) { orb.age = a[4] | 0; orb.vel.set(0, 0, 0); } }
  }
}
