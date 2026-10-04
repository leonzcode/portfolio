/* ---------------------------------------------------------------------------
   Leoncraft 2 - boats (and rafts and chest boats), by the game's numbers.

   Each tick a boat works out where it is: in water (its bottom under the
   water's surface), under water, on land, or in the air; then:
     in water     drag 0.9, floats up by how deep it sits (buoyancy x 0.0615,
                  then x 0.75), so it settles with its bottom just under
     under water  drag 0.45 and a slow rise
     on land      the blocks' slipperiness as drag: 0.6 on most, 0.98 on ice,
                  0.989 on blue ice (which is why boats fly on ice)
     in the air   drag 0.9, falling 0.04 a tick
   Paddling (the rider's keys): W adds 0.04 a tick forward, S takes 0.005,
   A and D turn a degree a tick (more as it builds), turning alone creeps
   forward 0.005. So on still water a boat tops out at 0.04 / (1 - 0.9) =
   0.4 blocks a tick, 8 a second; on packed ice 40, blue ice 72.

   Two seats; a mob that walks into an empty seat is taken in (and only
   leaves when the boat breaks). Hits add ten times the damage; past 40 the
   boat breaks and drops itself. Falling more than 3 blocks onto land breaks
   it into planks and sticks. Shift gets you out.
--------------------------------------------------------------------------- */
import { Entity, Living, Mob, DEG, wrap, r3 } from './entity.js?v=9';
import { register } from './mobs.js?v=9';
import { MODELS } from './mobmodels.js?v=9';
import { addArt } from './mobart.js?v=9';
import { BLOCKS, FLUID, SOLID, B } from '../blocks.js?v=9';

const PI = Math.PI;
export const WOODS = { oak: 0xb8945f, spruce: 0x7a5a36, birch: 0xd8c88c, jungle: 0xb88664, acacia: 0xc06a3c, dark_oak: 0x4f3420, mangrove: 0x84403a, cherry: 0xe6b4ac, bamboo: 0xd4c05a, pale_oak: 0xe8e0d8 };
const IN_WATER = 0, UNDER_WATER = 1, UNDER_FLOWING = 2, ON_LAND = 3, IN_AIR = 4;

/* ---- the boat's shape: a flat bottom, four sides, two paddles ----
   (game model units, y down from 24, -z the bow) */
const boatModel = {
  name: 'boat', size: [128, 128],
  parts: [
    { name: 'bottom', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-11, 21, -14, 22, 3, 28, 0, 0, 0, false, 1]] },
    { name: 'right', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-11, 15, -14, 2, 6, 28, 0, 31, 0, false, 1]] },
    { name: 'left', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[9, 15, -14, 2, 6, 28, 60, 31, 0, false, 1]] },
    { name: 'front', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-9, 15, -14, 18, 6, 2, 0, 65, 0, false, 1]] },
    { name: 'back', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-9, 15, 12, 18, 6, 2, 0, 73, 0, false, 1]] },
    { name: 'paddleR', pivot: [-11, 16, 1], rot: [0, 0, 0], parent: -1, boxes: [[-0.5, -0.5, -9, 1, 1, 16, 40, 65, 0, false, 1], [-0.5, -0.5, 7, 1, 6, 5, 80, 65, 0, false, 1]] },
    { name: 'paddleL', pivot: [11, 16, 1], rot: [0, 0, 0], parent: -1, boxes: [[-0.5, -0.5, -9, 1, 1, 16, 40, 65, 0, false, 1], [-0.5, -0.5, 7, 1, 6, 5, 80, 65, 0, false, 1]] },
  ],
  animate(m, P, A) {
    // the paddles: round and back as they row, resting along the sides when not
    for (const [i, ph] of [[5, A.paddleR], [6, A.paddleL]]) {
      const o = i * 7;
      const s = ph === undefined ? 0 : ph;
      P[o + 3] = -0.6 + Math.sin(-s) * 0.45 - 0.9 * 0 + (ph === undefined ? 0.35 : 0);
      P[o + 4] = (i === 5 ? -1 : 1) * (0.25 + Math.sin(-s + 1) * 0.55);
      P[o + 5] = (i === 5 ? 1 : -1) * 0.35;
    }
  },
};
boatModel.index = {}; boatModel.parts.forEach((p, i) => { boatModel.index[p.name] = i; });
MODELS.boat = boatModel;
// a chest in the back half (the chest boat)
const chestModel = { name: 'boat_chest', size: [64, 64], parts: boatModel.parts.slice(0, 1).concat([]).map(p => Object.assign({}, p, { boxes: [[-6, 9, 1, 12, 12, 10, 0, 0, 0, false, 0], [-1, 13, 0, 2, 3, 1, 0, 0, 0, false, 0]] })), animate() {} };
chestModel.index = { bottom: 0 };
MODELS.boat_chest = chestModel;

// planks with a grain, in greys: the wood's colour multiplies it
addArt('boat', [128, 128], p => {
  const plank = (x, y, w, h, k) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const row = Math.floor((y + j) / 4), line = (y + j) % 4 === 3, seam = ((x + i + row * 7) % 14) === 0;
      let v = 0.86 + ((x * 7 + i * 3 + row * 11 + j * 5) % 9) / 90;
      if (line || seam) v = 0.62;
      v *= k;
      p.px(x + i, y + j, [v * 255, v * 255, v * 255].map(Math.round));
    }
  };
  plank(0, 0, 100, 31, 1); plank(0, 31, 120, 34, 1); plank(0, 65, 40, 16, 1);
  plank(40, 65, 34, 17, 0.95); plank(80, 65, 24, 11, 1.02);
});
addArt('boat_chest', [64, 64], p => {
  p.box(0, 0, 12, 12, 10, { all: 0x9a6a2c, top: 0xa8763a }, 0.08);
  p.fill(10, 10 + 4, 12, 1, 0x4a3214);
  p.box(0, 0, 2, 3, 1, 0xc8c8c8, 0.05);
});

export class Boat extends Entity {
  static W = 1.375; static H = 0.5625; static STEP = 0; static SEATS = 2; static MODEL = 'boat'; static TEX = 'boat'; static SHADOW = 0;
  static NO_PUSH = true; static PICK = 0; static WATER_MASK = 0.5;
  constructor(m, type) {
    super(m, type);
    this.wood = 'oak'; this.chest = false; this.raft = false;
    this.damage = 0; this.hurtTime = 0; this.hurtDir = 1;
    this.deltaRot = 0; this.yawDelta = 0;
    this.status = IN_AIR; this.oldStatus = IN_AIR; this.waterLevel = 0; this.landFriction = 0.6;
    this.paddle = [0, 0]; this.prevPaddle = [0, 0]; this.rowing = [false, false];
    this.input = { fwd: false, back: false, left: false, right: false };
    this.persistent = true;
  }
  get eyeH() { return 0.3; }
  ridingOffset() { return this.raft ? 0.25 : -0.1; }
  // seats: [forward, up, across] from the middle of the boat, for each passenger
  seat(i, p) {
    const n = this.passengers.length;
    const fwd = n > 1 ? (i === 0 ? 0.2 : -0.6) : (this.chest ? 0.15 : 0);
    const up = this.ridingOffset() + (p && p.isPlayer ? -0.35 + 0.1 : p ? -0.1 : 0);
    return [this.chest ? -0.15 + fwd * 0 + fwd : fwd, up, 0];
  }
  get seats() { return this.chest ? 1 : 2; }
  takesPassenger(e) {
    return this.passengers.length < this.seats && e instanceof Living && !e.vehicle && !e.constructor.WATER_BREATHER && e.w < this.w && !e.dead
      && e.type !== 'player' && !(e.constructor.HOSTILE && e.type === 'creeper' && false);
  }
  addPassenger(e) { e.vehicle = this; this.passengers.push(e); e.vel.set(0, 0, 0); if (e.nav) e.nav.stop(); }

  /* ---- what it is in ---- */
  statusNow() {
    const T = this.m.t, p = this.pos, hw = this.hw;
    const x0 = Math.floor(p.x - hw), x1 = Math.ceil(p.x + hw), z0 = Math.floor(p.z - hw), z1 = Math.ceil(p.z + hw);
    // under water: water over the top of the box
    const top = p.y + this.h, yt0 = Math.floor(top), yt1 = Math.ceil(top - 0.001);
    let under = false, flowing = false;
    for (let x = x0; x < x1; x++) for (let y = yt0; y < yt1; y++) for (let z = z0; z < z1; z++) {
      const b = T.get(x, y, z);
      if (FLUID[b] === 1 && y + T.fluidHeight(x, y, z) > top) { under = true; if (T.meta(x, y, z) & 7) flowing = true; }
    }
    if (under) return flowing ? UNDER_FLOWING : UNDER_WATER;
    // in water: its bottom under the water's surface
    const by0 = Math.floor(p.y), by1 = Math.ceil(p.y + 0.001);
    let level = -Infinity, inW = false;
    for (let x = x0; x < x1; x++) for (let y = by0; y < by1; y++) for (let z = z0; z < z1; z++) {
      const b = T.get(x, y, z);
      if (FLUID[b] === 1) { const l = y + T.fluidHeight(x, y, z); level = Math.max(level, l); if (p.y < l) inW = true; }
    }
    this.waterLevel = level;
    if (inW) return IN_WATER;
    // on land: the slipperiness of what it rests on
    const f = this.groundFriction();
    if (f > 0) { this.landFriction = f; return ON_LAND; }
    return IN_AIR;
  }
  groundFriction() {
    const T = this.m.t, p = this.pos, hw = this.hw, y = Math.floor(p.y - 0.001);
    if (p.y - y > 0.01 && !this.onGround) return 0;
    let sum = 0, n = 0;
    for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++) for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw); z++) {
      const b = T.get(x, y, z);
      if (b && SOLID[b]) { sum += (BLOCKS[b].slippery || 0.6); n++; }
    }
    return n ? sum / n : 0;
  }

  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    this.prevPaddle[0] = this.paddle[0]; this.prevPaddle[1] = this.paddle[1];
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damage > 0) this.damage--;
    this.oldStatus = this.status;
    this.status = this.statusNow();
    this.float();
    this.yawDelta = 0;
    const driver = this.passengers[0];
    if (driver && driver.isPlayer) this.control();
    else this.rowing[0] = this.rowing[1] = false;
    const wasGround = this.onGround;
    const vy = this.vel.y;
    this.m.t.move(this, this.vel.x, this.vel.y, this.vel.z);
    // a hard landing on land breaks it into planks and sticks
    if (this.onGround && !wasGround) {
      if (this.fallDist > 3 && this.status !== IN_WATER && this.statusNow() !== IN_WATER) { this.breakApart(true); return; }
      this.fallDist = 0;
    } else if (!this.onGround && vy < 0) this.fallDist -= vy;
    if (this.status === IN_WATER || this.onGround) this.fallDist = this.onGround ? this.fallDist : 0;
    // the paddles go round while rowing
    for (let i = 0; i < 2; i++) {
      if (this.rowing[i]) this.paddle[i] += PI / 8;
      else this.paddle[i] = 0;
    }
    // mobs walking into it climb in
    if (this.passengers.length < this.seats) {
      this.m.forNear(this.pos.x, this.pos.z, 2, e => {
        if (e === this || e.removed || this.passengers.length >= this.seats) return;
        if (Math.abs(e.pos.x - this.pos.x) < this.hw + e.hw + 0.1 && Math.abs(e.pos.z - this.pos.z) < this.hw + e.hw + 0.1 && Math.abs(e.pos.y - this.pos.y) < 0.8)
          if (this.takesPassenger(e) && e.vel.lengthSq() > 1e-5) this.addPassenger(e);
      });
    }
  }
  float() {
    const v = this.vel;
    let gravity = -0.04, buoy = 0, inv = 0.05;
    if (this.oldStatus === IN_AIR && this.status !== IN_AIR && this.status !== ON_LAND) {
      // landing in water from the air: sit on the surface
      this.waterLevel = this.waterLevel === -Infinity ? this.pos.y + this.h : this.waterLevel;
      this.pos.y = this.waterLevel - this.h + 0.101;
      v.y = 0; this.status = IN_WATER;
      return;
    }
    if (this.status === IN_WATER) { buoy = (this.waterLevel - this.pos.y) / this.h; inv = 0.9; }
    else if (this.status === UNDER_FLOWING) { gravity = -7e-4; inv = 0.9; }
    else if (this.status === UNDER_WATER) { buoy = 0.01; inv = 0.45; }
    else if (this.status === IN_AIR) inv = 0.9;
    else if (this.status === ON_LAND) inv = this.landFriction;
    v.x *= inv; v.z *= inv; v.y += gravity;
    this.deltaRot *= inv;
    if (buoy > 0) v.y = (v.y + buoy * 0.06153846) * 0.75;
  }
  /* the rider's keys: A and D turn (a degree a tick, building up), W
     forward, S back (slowly) */
  control() {
    const k = this.m.P.keys, fwd = !!k.w, back = !!k.s, left = !!k.a, right = !!k.d;
    let f = 0;
    if (left) this.deltaRot += 1;
    if (right) this.deltaRot -= 1;
    if (right !== left && !fwd && !back) f += 0.005;
    this.yaw += this.deltaRot * DEG;
    this.yawDelta = this.deltaRot * DEG;
    if (fwd) f += 0.04;
    if (back) f -= 0.005;
    this.vel.x += -Math.sin(this.yaw) * f;
    this.vel.z += -Math.cos(this.yaw) * f;
    this.rowing[0] = (right && !left) || fwd;
    this.rowing[1] = (left && !right) || fwd;
  }
  /* ---- hits ---- */
  onPlayerHit(player) { return undefined; }
  hurt(amount, src) {
    if (this.removed) return false;
    this.hurtDir = -this.hurtDir; this.hurtTime = 10;
    this.damage += amount * 10;
    const creative = src && src.player && this.m.mode === 'creative';
    if (creative || this.damage > 40) this.breakApart(false, creative);
    return true;
  }
  breakApart(fell, creative) {
    if (!creative) {
      if (fell) { this.m.dropItemAt(this.pos.x, this.pos.y + 0.3, this.pos.z, this.raft ? 'bamboo_planks' : this.wood + '_planks', 3); this.m.dropItemAt(this.pos.x, this.pos.y + 0.3, this.pos.z, 'stick', 2); }
      else this.m.dropItemAt(this.pos.x, this.pos.y + 0.3, this.pos.z, this.itemName(), 1);
      if (this.chest && fell) this.m.dropItemAt(this.pos.x, this.pos.y + 0.3, this.pos.z, 'chest', 1);
    }
    for (const p of this.passengers.slice()) { if (p.isPlayer) this.m.dismount(); else { p.vehicle = null; } }
    this.passengers.length = 0;
    this.m.particles('poof', this.pos.x, this.pos.y + 0.3, this.pos.z, 10, 0.6);
    this.remove();
  }
  itemName() { return this.raft ? (this.chest ? 'bamboo_chest_raft' : 'bamboo_raft') : this.wood + (this.chest ? '_chest_boat' : '_boat'); }
  interact(held, player) {
    if (player && player.isPlayer && !player.sneaking()) {
      if (this.passengers.length < this.seats || this.passengers.some(p => !p.isPlayer)) return this.m.mount(this) ? 'swing' : false;
    }
    return false;
  }
  /* ---- drawing ---- */
  tint() { return WOODS[this.raft ? 'bamboo' : this.wood] || WOODS.oak; }
  anim(A, a) {
    A.paddleR = this.rowing[0] || this.paddle[0] ? this.prevPaddle[0] + (this.paddle[0] - this.prevPaddle[0]) * a : undefined;
    A.paddleL = this.rowing[1] || this.paddle[1] ? this.prevPaddle[1] + (this.paddle[1] - this.prevPaddle[1]) * a : undefined;
  }
  rootPose(root, t, a) {
    // rocking when hit
    const h = this.hurtTime - a;
    if (h > 0) root.multiply(t.makeRotationZ(Math.sin(h) * h * Math.max(0, this.damage - a) / 10 / 40 * this.hurtDir));
  }
  layers(out) { if (this.chest) out.push(['boat_chest', 'boat_chest', null]); }
  toJSON() { const o = super.toJSON(); o.wd = this.wood; if (this.chest) o.ch = 1; if (this.raft) o.rf = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.wood = o.wd || 'oak'; this.chest = !!o.ch; this.raft = !!o.rf; }
}
register('boat', Boat);

/* Placing a boat from its item name ('oak_boat', 'spruce_chest_boat',
   'bamboo_raft') at a point, facing the way the player looks. */
export function placeBoat(m, name, x, y, z, yaw) {
  const mt = /^(.*?)(_chest)?_(boat|raft)$/.exec(name || 'oak_boat');
  if (!mt) return null;
  const b = m.spawn('boat', x, y, z, { yaw, natural: false });
  if (!b) return null;
  b.raft = mt[3] === 'raft';
  b.wood = b.raft ? 'bamboo' : (WOODS[mt[1]] ? mt[1] : 'oak');
  b.chest = !!mt[2];
  return b;
}
