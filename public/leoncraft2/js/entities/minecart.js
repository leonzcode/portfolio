/* ---------------------------------------------------------------------------
   Leoncraft 2 - minecarts on rails.

   A rail's shape is worked out from its neighbours the same way the mesher
   draws it (models.js SHAPES.rail): straight north-south or east-west, up a
   slope towards a raised neighbour, or (plain rails only) a curve. Each
   shape is a line between the middles of its two open edges, and a cart on
   it is held to that line; its speed keeps its size round curves and
   changes only by:
     slopes        0.0078125 a tick pulling it down hill
     friction      x0.997 a tick with someone in it, x0.96 empty
     powered rail  +0.06 a tick the way it is going when powered (a redstone
                   torch, block or lever next to it), and on one with no
                   power it brakes to a stop
     a rider       W gives a push the way you look, from (nearly) still
   and never goes over 0.4 blocks a tick (8 a second). Off the rails it falls
   0.04 a tick and slows to half on the ground. Mobs bumped by a moving empty
   cart get in; hits break it as they break a boat.
--------------------------------------------------------------------------- */
import { Entity, Living, DEG, wrap } from './entity.js?v=17';
import { register } from './mobs.js?v=17';
import { MODELS } from './mobmodels.js?v=17';
import { addArt } from './mobart.js?v=17';
import { BLOCKS, B } from '../blocks.js?v=17';
import { riderDrop } from './boat.js?v=17';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];      // north, east, south, west (as models.js)
const RAIL = new Uint8Array(4096), POWERED = new Uint8Array(4096), SOURCE = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (!d) continue;
  if (d.shape === 'rail') RAIL[d.id] = 1;
  if (d.name === 'powered_rail') POWERED[d.id] = 1;
  if (/^(redstone_torch|redstone_wall_torch|redstone_block|lever)$/.test(d.name)) SOURCE[d.id] = 1;
}

/* ---- the minecart's shape: a tub on four sides ---- */
const cartModel = {
  name: 'minecart', size: [64, 32],
  parts: [
    { name: 'tub', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [
      [-8, 20, -10, 16, 2, 20, 0, 0],
      [-8, 12, -10, 16, 8, 2, 0, 22], [-8, 12, 8, 16, 8, 2, 0, 22],
      [-8, 12, -8, 2, 8, 16, 36, 22], [6, 12, -8, 2, 8, 16, 36, 22],
    ] },
  ],
  animate() {},
};
cartModel.index = { tub: 0 };
MODELS.minecart = cartModel;
addArt('minecart', [64, 64], p => {
  const iron = 0x8c8c8c, dark = 0x5a5a5a, light = 0xb4b4b4;
  p.box(0, 0, 16, 2, 20, { all: dark, top: 0x6e6e6e }, 0.08);
  p.box(0, 22, 16, 8, 2, { all: iron }, 0.06);
  p.box(36, 22, 2, 8, 16, { all: iron }, 0.06);
  // rivets and a rim
  for (const [x, y, w] of [[2, 24, 16], [38, 24, 16]]) { p.fill(x, y, w, 1, light, 0.04); p.fill(x, y + 7, w, 1, dark, 0.04); }
  for (let i = 0; i < 4; i++) { p.px(3 + i * 4, 27, 0x404040); p.px(39 + i * 4, 27, 0x404040); }
});

export class Minecart extends Entity {
  static W = 0.98; static H = 0.7; static STEP = 0; static SEATS = 1; static MODEL = 'minecart'; static TEX = 'minecart'; static SHADOW = 0.5;
  static NO_PUSH = true;
  constructor(m, type) {
    super(m, type);
    this.damage = 0; this.hurtTime = 0; this.hurtDir = 1;
    this.onRail = false; this.slope = 0;
    this.persistent = true;
  }
  /* the seat on its floor, 0.1875 up: a mob stands there, and anyone who
     sits (the player, a zombie) has their own seat there, so sinks into it */
  ridingOffset() { return 0.1875; }
  seat(i, p) { return [0, 0.1875 - riderDrop(p), 0]; }

  /* the rail at a block: its two ends, [dx, dz, raised] each, or null */
  rail(x, y, z) {
    const T = this.m.t, b = T.get(x, y, z);
    if (!RAIL[b]) return null;
    const is = (xx, yy, zz) => RAIL[T.get(xx, yy, zz)] === 1;
    const c = DIRS.map(([dx, dz]) => is(x + dx, y, z + dz) || is(x + dx, y - 1, z + dz));
    const up = DIRS.map(([dx, dz]) => is(x + dx, y + 1, z + dz));
    if (b === B.rail) {
      for (const [a, e] of [[2, 1], [2, 3], [0, 3], [0, 1]]) if (c[a] && c[e] && !c[(a + 2) & 3] && !c[(e + 2) & 3]) return [[DIRS[a][0], DIRS[a][1], 0], [DIRS[e][0], DIRS[e][1], 0], b];
    }
    const ew = (c[1] || c[3]) && !(c[0] || c[2]);
    for (let k = 0; k < 4; k++) if (up[k] && (ew ? (k & 1) : !(k & 1))) return [[DIRS[k][0], DIRS[k][1], 1], [DIRS[(k + 2) & 3][0], DIRS[(k + 2) & 3][1], 0], b];
    return ew ? [[1, 0, 0], [-1, 0, 0], b] : [[0, -1, 0], [0, 1, 0], b];
  }
  // a powered rail's power is its own (meta bit 3, set by the redstone in sim/rsparts.js)
  powered(x, y, z) { return (this.m.t.meta(x, y, z) & 8) !== 0; }

  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damage > 0) this.damage--;
    const T = this.m.t, p = this.pos, v = this.vel;
    // which rail it is on (the one under it, at the top of a slope down)
    let bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    if (RAIL[T.get(bx, by - 1, bz)]) by--;
    const r = this.rail(bx, by, bz);
    const inWater = T.fluid(bx, Math.floor(p.y + 0.2), bz) === 1;
    // (a furnace cart goes at half: entities/carts.js)
    const max = (inWater ? 0.2 : 0.4) * (this.speedScale || 1);
    this.hitEnd = false;
    if (!r) {
      // off the rails: fall, slow on the ground
      this.onRail = false;
      v.y -= inWater ? 0.005 : 0.04;
      v.x = Math.max(-max, Math.min(max, v.x)); v.z = Math.max(-max, Math.min(max, v.z));
      if (this.onGround) { v.x *= 0.5; v.z *= 0.5; }
      this.move(v.x, v.y, v.z);
      if (!this.onGround) { v.x *= 0.95; v.y *= 0.95; v.z *= 0.95; }
      this.pitch *= 0.8;
      this.pickUp();
      return;
    }
    this.onRail = true;
    const [a, e, id] = r;
    // the line along the rail, end to end
    const x0 = bx + 0.5 + a[0] * 0.5, z0 = bz + 0.5 + a[1] * 0.5, y0 = by + a[2];
    const x1 = bx + 0.5 + e[0] * 0.5, z1 = bz + 0.5 + e[1] * 0.5, y1 = by + e[2];
    let hx = x1 - x0, hz = z1 - z0;
    const len = Math.hypot(hx, hz); hx /= len; hz /= len;
    // the speed it has, now along the rail
    const hs = Math.hypot(v.x, v.z), dot = v.x * hx + v.z * hz;
    let s = dot === 0 ? 0 : hs * Math.sign(dot);
    // down hill
    if (y1 > y0) s -= 0.0078125; else if (y0 > y1) s += 0.0078125;
    // the rider's push, from nearly still
    const rider = this.passengers[0];
    if (rider && rider.isPlayer && this.m.P.keys.w && hs * hs < 0.01) {
      const P = this.m.P, lx = -Math.sin(P.yaw), lz = -Math.cos(P.yaw);
      s += (lx * hx + lz * hz) * 0.1;
    }
    // powered rails
    if (POWERED[id]) {
      if (this.powered(bx, by, bz)) {
        if (Math.abs(s) > 0.01) s += Math.sign(s) * 0.06;
        else {
          // starting from still: away from a solid block at one end
          if (T.solid(Math.floor(x0 - hx * 0.6), by, Math.floor(z0 - hz * 0.6))) s = 0.02;
          else if (T.solid(Math.floor(x1 + hx * 0.6), by, Math.floor(z1 + hz * 0.6))) s = -0.02;
        }
      } else if (Math.abs(s) < 0.03) s = 0; else s *= 0.5;
    }
    // a furnace cart's push (entities/carts.js); friction, and the speed limit
    if (this.drive) s = this.drive(s, hx, hz);
    s *= rider ? 0.997 : 0.96;
    if (inWater) s *= 0.95;
    s = Math.max(-max, Math.min(max, s));
    // held to the line, then moved along it
    let t = ((p.x - x0) * hx + (p.z - z0) * hz) / len;
    t = Math.max(0, Math.min(1, t));
    let nx = x0 + hx * t * len, nz = z0 + hz * t * len;
    nx += hx * s; nz += hz * s;
    // at a dead end with a block beyond, it stops
    const tt = ((nx - x0) * hx + (nz - z0) * hz) / len;
    if (tt > 1 || tt < 0) {
      const ex = tt > 1 ? e : a, ey = by + ex[2];
      const nbx = bx + ex[0], nbz = bz + ex[1];
      if (!RAIL[T.get(nbx, ey, nbz)] && !RAIL[T.get(nbx, ey - 1, nbz)] && T.solid(nbx, ey, nbz)) {
        const lim = tt > 1 ? 1 : 0;
        this.hitEnd = true;
        nx = x0 + hx * lim * len * 0.999 + hx * (lim ? -0.01 : 0.01); nz = z0 + hz * lim * len * 0.999 + hz * (lim ? -0.01 : 0.01);
        s = 0;
      }
    }
    const t2 = ((nx - x0) * hx + (nz - z0) * hz) / len;
    p.x = nx; p.z = nz;
    p.y = y0 + (y1 - y0) * Math.max(0, Math.min(1, t2)) + 0.0625;
    v.set(hx * s, 0, hz * s);
    this.onGround = true; this.fallDist = 0;
    // facing along the rail (the way it was facing, of the two), tipped on a slope
    let yaw = Math.atan2(-hx, -hz);
    if (Math.abs(wrap(yaw - this.yaw)) > Math.PI / 2) yaw = wrap(yaw + Math.PI);
    this.yaw = this.yaw + wrap(yaw - this.yaw) * 0.5;
    const fwd = Math.cos(this.yaw - Math.atan2(-hx, -hz)) > 0 ? 1 : -1;
    this.pitch = y1 !== y0 ? Math.atan2((y1 - y0) * fwd, 1) * 0.999 : 0;
    this.pickUp();
  }
  // a mob bumped by a moving, empty cart gets in
  pickUp() {
    if (this.constructor.NO_RIDE || this.passengers.length || this.vel.x * this.vel.x + this.vel.z * this.vel.z < 0.01) return;
    this.m.forNear(this.pos.x, this.pos.z, 2, e => {
      if (this.passengers.length || e === this || e.removed || e.dead || !(e instanceof Living) || e.vehicle || e.type === 'iron_golem' || e.w > 1) return;
      if (Math.abs(e.pos.x - this.pos.x) < this.hw + e.hw && Math.abs(e.pos.z - this.pos.z) < this.hw + e.hw && Math.abs(e.pos.y - this.pos.y) < 1) {
        e.vehicle = this; this.passengers.push(e); if (e.nav) e.nav.stop();
      }
    });
  }
  hurt(amount, src) {
    if (this.removed) return false;
    this.hurtDir = -this.hurtDir; this.hurtTime = 10;
    this.damage += amount * 10;
    const creative = src && src.player && this.m.mode === 'creative';
    if (creative || this.damage > 40) {
      // its own item (a cart with a block drops as one since 1.19), and what a chest or hopper cart held
      if (!creative) this.m.dropItemAt(this.pos.x, this.pos.y + 0.3, this.pos.z, this.constructor.ITEM || 'minecart', 1);
      if (this.broken) this.broken(creative);
      for (const p of this.passengers.slice()) { if (p.isPlayer) this.m.dismount(); else p.vehicle = null; }
      this.passengers.length = 0;
      this.remove();
    }
    return true;
  }
  interact(held, player) {
    if (player && player.isPlayer && !player.sneaking() && !this.passengers.length) return this.m.mount(this) ? 'swing' : false;
    return false;
  }
  rootPose(root, t, a) {
    const pitch = this.prevPitch + (this.pitch - this.prevPitch) * a;
    if (pitch) root.multiply(t.makeRotationX(pitch));
    const h = this.hurtTime - a;
    if (h > 0) root.multiply(t.makeRotationZ(Math.sin(h) * h * Math.max(0, this.damage - a) / 10 / 40 * this.hurtDir));
  }
  toJSON() { const o = super.toJSON(); return o; }
}
register('minecart', Minecart);

/* Putting a cart on a rail (the minecart item, or one with a block: type) */
export function placeMinecart(m, x, y, z, type = 'minecart') {
  const T = m.t;
  if (!RAIL[T.get(x, y, z)]) return null;
  const c = m.spawn(type, x + 0.5, y + 0.0625, z + 0.5, { natural: false });
  if (c) { const r = c.rail(x, y, z); if (r) c.yaw = c.prevYaw = Math.atan2(-(r[1][0] - r[0][0]), -(r[1][1] - r[0][1])); }
  return c;
}
export function isRail(b) { return RAIL[b] === 1; }
