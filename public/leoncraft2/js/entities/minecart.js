/* ---------------------------------------------------------------------------
   Leoncraft 2 - minecarts on rails.

   A rail's shape is worked out from its neighbours the same way the mesher
   draws it (models.js SHAPES.rail): straight north-south or east-west, up a
   slope towards a raised neighbour, or (plain rails only) a curve. Each
   shape is a line between the middles of its two open edges, and a cart on
   it is held to that line; its speed keeps its size round curves and
   changes only by:
     slopes        0.0078125 a tick pulling it down hill (a fifth in water),
                   and 0.05 gained for each block it goes down, lost for
                   each block up
     friction      x0.997 a tick with someone in it, x0.96 empty; a chest or
                   hopper cart x0.98 plus 0.001 for each step a comparator
                   would read below 15 (entities/carts.js)
     powered rail  +0.06 a tick the way it is going when powered (a redstone
                   torch, block or lever next to it), and on one with no
                   power it brakes to a stop
     a rider       W gives a push the way you look, from (nearly) still
   As in the game, the speed it keeps can be up to 2 blocks a tick, but it
   goes at most 0.4 a tick (8 a second) along each axis, and only three
   quarters of its speed with someone in it: a cart ridden off a long run of
   powered rails stays at full speed for 176 blocks and stops after 309, as
   the wiki's tutorial measures. Off the rails its speed is held to 0.4, it
   falls 0.04 a tick and slows to half on the ground. Mobs bumped by a moving
   empty cart get in (not bats, iron golems, wardens, withers or the dragon);
   hits break it as they break a boat.

   Pushing, as in the game (it is not solid: you walk into it, not onto it):
   the player or a mob whose box overlaps the cart's pushes it 0.05 a tick
   straight away from them and is pushed back a quarter of that, so a cart
   you walk into rolls off along its rail. Two carts that meet end to end
   (within about 37 degrees of the cart's length) each keep a fifth of their
   own speed, take on the average of the two and part by 0.05; a furnace cart
   instead hands its own speed to the cart it meets and keeps 95% of it.
   Lava hurts a cart 4 a tick and sets it alight, a fire block 1 (soul fire
   2); alight it takes 1 a second; water puts it out. 40 damage breaks it.
--------------------------------------------------------------------------- */
import { Entity, Living, DEG, wrap } from './entity.js?v=107';
import { register } from './mobs.js?v=107';
import { MODELS } from './mobmodels.js?v=107';
import { addArt } from './mobart.js?v=107';
import { BLOCKS, B } from '../blocks.js?v=107';
import { riderDrop } from './boat.js?v=107';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];      // north, east, south, west (as models.js)
const RAIL = new Uint8Array(4096), POWERED = new Uint8Array(4096), SOURCE = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (!d) continue;
  if (d.shape === 'rail') RAIL[d.id] = 1;
  if (d.name === 'powered_rail') POWERED[d.id] = 1;
  if (/^(redstone_torch|redstone_wall_torch|redstone_block|lever)$/.test(d.name)) SOURCE[d.id] = 1;
}
// the mobs a cart never picks up (the wiki's Minecart, Java Edition); any other, a ghast or a spider too, gets in
const NO_CART = new Set(['bat', 'iron_golem', 'warden', 'wither', 'ender_dragon']);
// what a fire block does to a cart in it a tick (the game's fire 1, soul fire 2)
const FIRE = new Uint8Array(4096);
if (B.fire !== undefined) FIRE[B.fire] = 1;
if (B.soul_fire !== undefined) FIRE[B.soul_fire] = 2;

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
// (80 wide: the floor's box, 16 x 2 x 20, lays out 72 pixels across)
addArt('minecart', [80, 64], p => {
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
  // the most it goes a tick: 8 blocks a second, 4 in water (a furnace cart's own: entities/carts.js)
  maxSpeed(inWater) { return inWater ? 0.2 : 0.4; }
  // what is left of its speed after a tick's friction: 0.997 with someone in it, 0.96 empty
  drag(rider) { return rider ? 0.997 : 0.96; }
  // a powered rail's power is its own (meta bit 3, set by the redstone in sim/rsparts.js)
  powered(x, y, z) { return (this.m.t.meta(x, y, z) & 8) !== 0; }

  tick() {
    this.roll();
    if (this.removed) return;
    this.hot();
    if (!this.removed) this.touching();
  }
  // along the rails (or off them), one tick
  roll() {
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
    const max = this.maxSpeed(inWater);
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
      return;
    }
    this.onRail = true;
    const [a, e, id] = r;
    // the line along the rail, end to end
    const x0 = bx + 0.5 + a[0] * 0.5, z0 = bz + 0.5 + a[1] * 0.5, y0 = by + a[2];
    const x1 = bx + 0.5 + e[0] * 0.5, z1 = bz + 0.5 + e[1] * 0.5, y1 = by + e[2];
    let hx = x1 - x0, hz = z1 - z0;
    const len = Math.hypot(hx, hz); hx /= len; hz /= len;
    // down hill (a fifth of that in water), then the speed it has, now along the rail: the game keeps up to
    // 2 blocks a tick of it, far more than it lets the cart go, which is what carries a cart on so far
    const hs = Math.hypot(v.x, v.z), dot = v.x * hx + v.z * hz;
    let s = dot === 0 ? 0 : hs * Math.sign(dot);
    const hill = inWater ? 0.0015625 : 0.0078125;
    if (y1 > y0) s -= hill; else if (y0 > y1) s += hill;
    s = Math.max(-2, Math.min(2, s));
    // the rider's push, from nearly still
    const rider = this.passengers[0];
    if (rider && rider.isPlayer && this.m.P.keys.w && s * s < 0.01) {
      const P = this.m.P, lx = -Math.sin(P.yaw), lz = -Math.cos(P.yaw);
      s += (lx * hx + lz * hz) * 0.1;
    }
    // a powered rail with no power brakes it to a stop
    const boost = POWERED[id] && this.powered(bx, by, bz);
    if (POWERED[id] && !boost) { if (Math.abs(s) < 0.03) s = 0; else s *= 0.5; }
    // held to the line, then moved along it: by its speed, three quarters of it with someone in it, and never
    // more than `max` along either axis (so up to 1.41 times that on the diagonal of a curve)
    let t = ((p.x - x0) * hx + (p.z - z0) * hz) / len;
    t = Math.max(0, Math.min(1, t));
    const lim = max / Math.max(Math.abs(hx), Math.abs(hz)), go = Math.max(-lim, Math.min(lim, s * (rider ? 0.75 : 1)));
    let nx = x0 + hx * t * len, nz = z0 + hz * t * len;
    nx += hx * go; nz += hz * go;
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
    const yWas = y0 + (y1 - y0) * t, yNow = y0 + (y1 - y0) * Math.max(0, Math.min(1, t2));
    p.y = yNow + 0.0625;
    // friction (a furnace cart's push first: entities/carts.js; a chest or hopper cart its own: lighter when fuller)
    if (this.drive) s = this.drive(s, hx, hz);
    s *= this.drag(rider);
    if (inWater) s *= 0.95;
    // a twentieth of a block a tick gained for every block it went down, lost for every one up (it can roll back)
    if (s) s += Math.sign(s) * (yWas - yNow) * 0.05;
    // a powered rail with power: 0.06 a tick more the way it goes, or from still away from a block at one end
    if (boost) {
      if (Math.abs(s) > 0.01) s += Math.sign(s) * 0.06;
      else if (T.solid(Math.floor(x0 - hx * 0.6), by, Math.floor(z0 - hz * 0.6))) s = 0.02;
      else if (T.solid(Math.floor(x1 + hx * 0.6), by, Math.floor(z1 + hz * 0.6))) s = -0.02;
    }
    v.set(hx * s, 0, hz * s);
    this.onGround = true; this.fallDist = 0;
    // facing along the rail (the way it was facing, of the two), tipped on a slope
    let yaw = Math.atan2(-hx, -hz);
    if (Math.abs(wrap(yaw - this.yaw)) > Math.PI / 2) yaw = wrap(yaw + Math.PI);
    this.yaw = this.yaw + wrap(yaw - this.yaw) * 0.5;
    const fwd = Math.cos(this.yaw - Math.atan2(-hx, -hz)) > 0 ? 1 : -1;
    this.pitch = y1 !== y0 ? Math.atan2((y1 - y0) * fwd, 1) * 0.999 : 0;
  }
  /* What touches it. Another cart within 0.2 of its box: the two meet (bump).
     A mob in that reach while it moves (a plain cart, empty) gets in, as the
     game's carts pick up mobs; otherwise a mob or the player whose box is in
     the cart's pushes it away and is pushed back a quarter as much. */
  touching() {
    const p = this.pos, hw = this.hw, y0 = p.y, y1 = p.y + this.h;
    const moving = this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.01;
    const picks = moving && !this.constructor.NO_RIDE;
    this.m.forNear(p.x, p.z, 3, e => {
      if (e === this || e.removed || e.dead || e.vehicle || e.noPhysics || e.pos.y >= y1 || e.pos.y + e.h <= y0) return;
      const ox = Math.abs(e.pos.x - p.x), oz = Math.abs(e.pos.z - p.z), reach = hw + e.hw + 0.2;
      if (ox >= reach || oz >= reach) return;
      if (e instanceof Minecart) { this.bump(e); return; }
      if (!(e instanceof Living) || e.constructor.NO_PUSH) return;
      if (picks && !this.passengers.length && !NO_CART.has(e.type) && !e.passengers.length) {
        e.vehicle = this; this.passengers.push(e); if (e.nav) e.nav.stop();
        return;
      }
      if (ox < hw + e.hw && oz < hw + e.hw) this.shove(e.pos, e.vel, true);
    });
    // the player (not one riding anything, nor a spectator); a creative player pushes but is not pushed back
    const P = this.m.P, pl = this.m.player;
    if (P && !this.m.riding && pl && pl.alive() && this.m.mode !== 'spectator' && !P.noclip
      && Math.abs(P.pos.x - p.x) < hw + 0.3 && Math.abs(P.pos.z - p.z) < hw + 0.3 && P.pos.y < y1 && P.pos.y + (P.h || 1.8) > y0)
      this.shove(P.pos, P.vel, this.m.mode !== 'creative');
  }
  // pushed by something at `at`: 0.05 a tick away from it (less once they are more than a block apart), it a quarter of that back
  shove(at, ev, back) {
    let dx = at.x - this.pos.x, dz = at.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    const k = Math.min(1, 1 / d) * 0.05 / d;
    dx *= k; dz *= k;
    this.vel.x -= dx; this.vel.z -= dz;
    if (back) { ev.x += dx / 4; ev.z += dz / 4; }
  }
  // two carts meeting (each cart's turn does this once, as the game's does)
  bump(o) {
    let dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    dx /= d; dz /= d;
    // only end to end along this cart's length
    if (Math.abs(dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) < 0.8) return;
    const k = Math.min(1, 1 / d) * 0.05;
    const px = dx * k, pz = dz * k, a = this.vel, b = o.vel;
    const fa = !!this.constructor.FURNACE, fb = !!o.constructor.FURNACE;
    if (fb && !fa) {
      // the furnace cart drives this one on at its speed
      a.x = a.x * 0.2 + b.x - px; a.z = a.z * 0.2 + b.z - pz;
      b.x *= 0.95; b.z *= 0.95;
    } else if (fa && !fb) {
      b.x = b.x * 0.2 + a.x + px; b.z = b.z * 0.2 + a.z + pz;
      a.x *= 0.95; a.z *= 0.95;
    } else {
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      a.x = a.x * 0.2 + mx - px; a.z = a.z * 0.2 + mz - pz;
      b.x = b.x * 0.2 + mx + px; b.z = b.z * 0.2 + mz + pz;
    }
  }
  /* Lava, fire and water, as the game has them for any entity that is not
     immune: in lava 4 damage a tick and alight for 15 seconds; in a fire block
     1 a tick (soul fire 2) and alight for at least 8; alight, 1 damage a
     second; water puts it out. */
  hot() {
    const T = this.m.t, p = this.pos, e = 0.001, hw = this.hw - e;
    const x0 = p.x - hw, y0 = p.y + e, z0 = p.z - hw, x1 = p.x + hw, y1 = p.y + this.h - e, z1 = p.z + hw;
    if (T.boxFluid(x0, y0, z0, x1, y1, z1, 1)) { this.fire = 0; return; }
    const lava = T.boxFluid(x0, y0, z0, x1, y1, z1, 2);
    if (lava) { this.fire = Math.max(this.fire, 300); this.hurt(4, { type: 'lava' }); if (this.removed) return; }
    let flame = 0;
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      const b = T.get(x, y, z);
      if (b && FIRE[b]) flame = Math.max(flame, FIRE[b]);
    }
    if (flame) {
      this.fire = Math.max(this.fire, 160);
      this.hurt(flame, { type: 'in_fire' });
      if (this.removed) return;
    }
    if (this.fire > 0) {
      if (this.fire % 20 === 0 && !lava) this.hurt(1, { type: 'on_fire' });
      this.fire--;
    }
  }
  hurt(amount, src) {
    if (this.removed) return false;
    this.hurtDir = -this.hurtDir; this.hurtTime = 10;
    this.damage += amount * 10;
    // a creative player's hit takes it away (nothing dropped); more than 40 damage breaks it
    if (src && src.player && this.m.mode === 'creative') this.gone(true);
    else if (this.damage > 40) this.destroyed(src);
    return true;
  }
  // broken: its own item (a cart with a block drops as one since 1.19), and what a chest or hopper cart held
  destroyed() {
    this.m.dropItemAt(this.pos.x, this.pos.y + 0.3, this.pos.z, this.constructor.ITEM || 'minecart', 1);
    this.gone(false);
  }
  gone(creative) {
    if (this.broken) this.broken(creative);
    for (const p of this.passengers.slice()) { if (p.isPlayer) this.m.dismount(); else p.vehicle = null; }
    this.passengers.length = 0;
    this.remove();
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
