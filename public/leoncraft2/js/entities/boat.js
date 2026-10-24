/* ---------------------------------------------------------------------------
   Leoncraft 2 - boats (and rafts and chest boats), by the game's numbers.

   Each tick a boat works out where it is: in water (its bottom under the
   water's surface), under water (water over its top: still, or flowing),
   on land, or in the air; then:
     in water       drag 0.9, floats up by how deep it sits (buoyancy x
                    0.0615, then x 0.75), so it settles with its bottom
                    0.37 under the surface
     under water    drag 0.45 and it sinks (still water), or drifts down
                    very slowly (0.0007 a tick more each tick, flowing);
                    after 3 seconds under, whoever is in it is put out
     on land        the blocks' slipperiness as drag: 0.6 on most, 0.98 on
                    ice, 0.989 on blue ice (which is why boats fly on ice)
     in the air     drag 0.9, falling 0.04 a tick; coming down onto water
                    it is set on the surface at once
   Running water pushes it along (0.014 a tick, the way the water runs) and
   lava breaks it in two ticks. A fall onto land never breaks it and
   whoever rides it takes no fall damage (the game checks for land at the
   start of the tick it lands, when it is still in the air).

   Paddling (the rider's keys): W adds 0.04 a tick forward, S takes 0.005,
   A and D turn a degree a tick (more as it builds: up to ten), turning
   alone creeps forward 0.005. So on still water a boat tops out at
   0.04 / (1 - 0.9) = 0.4 blocks a tick, 8 a second; on packed ice 40, on
   blue ice 72.7, on stone 2. The left paddle rows to turn right and the
   right paddle to turn left; both row going forward.

   Placed from the item where the look first meets water or the top of a
   block (not into a block, a mob or you), facing your way; a dispenser
   puts one into the water in front of it, or into air over water.

   Two seats (one in a chest boat). A mob that touches a boat no player is
   steering gets in (not fish, squid or bats, nothing as wide as the boat),
   and only leaves when the boat breaks or sinks, beside it; anything else
   that touches it is pushed off, and pushes an empty boat back. The boat
   is solid: you can stand on it and walk into it, and so can mobs. You sit
   facing the way the boat does and can look 105 degrees either side.

   Hits add ten times the damage (which wears off a point a tick); past 40
   the boat breaks and drops itself (in creative it just goes). Cactus and
   fire hurt it the same way. A chest boat keeps 27 slots: sneak and right
   click it, or press the inventory key while riding it, to open them;
   hoppers and droppers fill and empty it, and it spills when it breaks.
   Shift gets you out: beside the boat the way you look if there is ground
   there, or on top of it (always, on water).
--------------------------------------------------------------------------- */
import { Entity, Living, DEG, wrap, r3 } from './entity.js?v=107';
import { register, Animal } from './mobs.js?v=107';
import { MODELS } from './mobmodels.js?v=107';
import { addArt } from './mobart.js?v=107';
import { BLOCKS, FLUID, SOLID, B } from '../blocks.js?v=107';
import { collisionBoxes } from '../models.js?v=107';
import { stackToJSON, stackFromJSON } from '../items.js?v=107';
import { ChestScreen } from '../ui/containers.js?v=107';
import { spill } from '../containers.js?v=107';

const PI = Math.PI;
export const WOODS = { oak: 0xb8945f, spruce: 0x7a5a36, birch: 0xd8c88c, jungle: 0xb88664, acacia: 0xc06a3c, dark_oak: 0x4f3420, mangrove: 0x84403a, cherry: 0xe6b4ac, bamboo: 0xd4c05a, pale_oak: 0xe8e0d8 };
const IN_WATER = 0, UNDER_WATER = 1, UNDER_FLOWING = 2, ON_LAND = 3, IN_AIR = 4;
const WATERLOGGED = new Uint8Array(4096);
for (const d of BLOCKS) if (d && d.waterlogged) WATERLOGGED[d.id] = 1;
const LILY = B.lily_pad;
// blocks that hurt a boat that touches them, a point a tick: cactus and fire (soul fire two)
const SORE = new Uint8Array(4096);
for (const d of BLOCKS) if (d) SORE[d.id] = d.name === 'cactus' || d.name === 'fire' ? 1 : d.name === 'soul_fire' ? 2 : 0;
/* humanoids sit down into a seat (their seat is 0.7 above their feet, the
   player's 0.6); the rest stand on the floor of what they ride */
const SITS = /^(zombie|husk|drowned|zombie_villager|skeleton|stray|wither_skeleton|piglin|zombified_piglin|villager|witch|enderman)$/;
export function riderDrop(p) {
  if (!p) return 0;
  if (p.isPlayer) return 0.6;
  return SITS.test(p.type) ? 0.7 * (p.baby || p.ageT < 0 ? 0.5 : 1) : 0;
}
/* mobs that never get in, whatever their size (the wiki's list): fish,
   squid, dolphins, tadpoles and nautiluses live in the water, bats and the
   bosses do not ride, nor does the creaking or the warden */
const NO_BOAT = new Set(['bat', 'cod', 'salmon', 'pufferfish', 'tropical_fish', 'squid', 'glow_squid', 'dolphin', 'tadpole', 'nautilus', 'zombie_nautilus',
  'creaking', 'warden', 'wither', 'ender_dragon', 'ghast', 'happy_ghast', 'sulfur_cube', 'giant', 'elder_guardian']);

/* ---- the boat's shape: a flat bottom, four sides, two paddles ----
   (game model units, y down from 24, -z the bow, -x its right side). The
   game's proportions: two blocks from bow to stern, a block and a quarter
   across, the sides 6 pixels tall over a bottom 3 thick, the stern board
   a little wider than the bow's. */
// an oarlock, 2 pixels above the side and 3 forward of the middle; it turns its paddle's frame to the boat's length
const oarlock = (name, x, y) => ({ name, pivot: [x, y, -3], rot: [0, PI / 2, 0], parent: -1, boxes: [] });
/* a paddle in its oarlock's frame (x along the boat, z out over the water):
   an 18 pixel shaft from 5 inside the oarlock, the blade on its last 7 */
const paddle = (name, parent, right) => ({
  name, pivot: [0, 0, 0], rot: [0, right ? PI : 0, PI / 16], parent,
  boxes: [[-1, 0, -5, 2, 2, 18, 40, 65, 0, false, 1], [right ? 0.001 : -1.001, -3, 8, 1, 6, 7, 80, 65, 0, false, 1]],
});
/* The paddles, the game's way: t goes round PI/8 a tick while rowing (0 at
   rest); the blade dips between 15 and 60 degrees as sin(-t) and sweeps 45
   either way as sin(1 - t), so it is deep going back and lifted coming
   forward. The right paddle is the left one turned round. */
function animatePaddles(m, P, A) {
  for (const [part, t, right] of [[m.index.paddleL, A.paddleL || 0, false], [m.index.paddleR, A.paddleR || 0, true]]) {
    const o = part * 7;
    const dip = -PI / 3 + (PI / 3 - PI / 12) * (Math.sin(-t) + 1) / 2;
    const sweep = -PI / 4 + PI / 2 * (Math.sin(1 - t) + 1) / 2;
    P[o + 3] = dip;
    P[o + 4] = right ? PI - sweep : sweep;
    P[o + 5] = PI / 16;
  }
}
const boatModel = {
  name: 'boat', size: [128, 128],
  parts: [
    { name: 'bottom', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-8, 21, -14, 16, 3, 28, 0, 0, 0, false, 1]] },
    { name: 'right', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-10, 15, -14, 2, 6, 28, 0, 31, 0, false, 1]] },
    { name: 'left', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[8, 15, -14, 2, 6, 28, 60, 31, 0, false, 1]] },
    { name: 'front', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-8, 15, -16, 16, 6, 2, 0, 65, 0, false, 1]] },
    { name: 'back', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-9, 15, 14, 18, 6, 2, 0, 73, 0, false, 1]] },
    oarlock('oarR', -9, 13), paddle('paddleR', 5, true),
    oarlock('oarL', 9, 13), paddle('paddleL', 7, false),
  ],
  animate: animatePaddles,
};
/* The bamboo raft: a deck of poles 20 across over a narrower layer 16
   across, no sides, its top half a block up (its rider sits on it); the
   oarlocks a pixel higher than a boat's. */
const raftModel = {
  name: 'raft', size: [128, 128],
  parts: [
    { name: 'bottom', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-10, 15.9, -14, 20, 4, 28, 0, 0, 0, false, 1], [-8, 19.9, -14, 16, 4, 28, 0, 32, 0, false, 1]] },
    oarlock('oarR', -9, 14), paddle('paddleR', 1, true),
    oarlock('oarL', 9, 14), paddle('paddleL', 3, false),
  ],
  animate: animatePaddles,
};
for (const md of [boatModel, raftModel]) { md.index = {}; md.parts.forEach((p, i) => { md.index[p.name] = i; }); MODELS[md.name] = md; }
/* a chest in the back half (the chest boat): 12 pixels each way, standing on
   the floor of a boat or the deck of a raft, its lock facing the rider */
const chestOn = (name, lift) => {
  const md = { name, size: [64, 64], parts: [{ name: 'bottom', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes: [[-6, 9 - lift, 2, 12, 12, 12, 0, 0, 0, false, 0], [-1, 12 - lift, 1, 2, 4, 1, 0, 24, 0, false, 0]] }], animate() {} };
  md.index = { bottom: 0 };
  MODELS[name] = md;
};
chestOn('boat_chest', 0); chestOn('raft_chest', 5.1);

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
  // the paddles: a smooth shaft, a darker blade
  plank(40, 65, 40, 20, 0.95); plank(80, 65, 16, 13, 0.88);
});
// bamboo poles side by side, each with its knots, in greys (the bamboo's yellow multiplies it)
addArt('raft', [128, 128], p => {
  const poles = (x, y, w, h) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const col = x + i, edge = col % 3 === 2, knot = ((y + j + (Math.floor(col / 3) * 5)) % 11) === 0;
      let v = 0.9 + ((col * 5 + j * 3) % 7) / 100;
      if (edge) v = 0.7;
      if (knot) v = 0.66;
      p.px(x + i, y + j, [v * 255, v * 255, v * 255].map(Math.round));
    }
  };
  poles(0, 0, 100, 32); poles(0, 32, 92, 32);
  poles(40, 65, 40, 20); poles(80, 65, 16, 13);
});
addArt('boat_chest', [64, 64], p => {
  p.box(0, 0, 12, 12, 12, { all: 0x9a6a2c, top: 0xa8763a }, 0.08);
  // the lid's rim, a band round the chest under its top 4 pixels
  p.fill(0, 12 + 4, 48, 1, 0x4a3214);
  p.box(0, 24, 2, 4, 1, 0xc8c8c8, 0.05);
});

const isAnimal = e => e instanceof Animal;

export class Boat extends Entity {
  static W = 1.375; static H = 0.5625; static STEP = 0; static SEATS = 2; static MODEL = 'boat'; static TEX = 'boat'; static SHADOW = 0.8;
  static NO_PUSH = true; static PICK = 0; static WATER_MASK = 0.5;
  static MASK_HX = 0.5; static MASK_HZ = 0.875;   // the water kept out: the inside of the hull, between its sides and its boards
  static SOLID = true;              // stood on and walked into (entities/terrain.js, the player's collision)
  static RIDER_BODY = true;         // its rider's body faces the way it does (render/avatar.js)
  static NO_EVICT = true;           // getting in never puts a mob out
  static KEEPS_RIDERS = true;       // its mobs are saved with it (manager.js)
  constructor(m, type) {
    super(m, type);
    this.wood = 'oak'; this.chest = false; this.raft = false;
    this.damage = 0; this.hurtTime = 0; this.hurtDir = 1;
    this.deltaRot = 0; this.yawDelta = 0;
    this.status = IN_AIR; this.oldStatus = IN_AIR; this.waterLevel = 0; this.landFriction = 0.6; this.lastYd = 0;
    this.outOfControl = 0;
    this.paddle = [0, 0]; this.prevPaddle = [0, 0]; this.rowing = [false, false];
    this.slots = null;               // a chest boat's 27 slots
    this.persistent = true;
    this.flowV = [0, 0];
    // made by the game's own name for its kind ('birch_chest_boat', 'bamboo_raft'): that kind, kept as a boat
    if (type !== 'boat') {
      const mt = /^(.*?)(_chest)?_(boat|raft)$/.exec(type || '');
      if (mt) { this.raft = mt[3] === 'raft'; this.wood = this.raft ? 'bamboo' : (WOODS[mt[1]] ? mt[1] : 'oak'); if (mt[2]) this.chestBoat = true; }
      this.type = 'boat';
    }
  }
  get eyeH() { return 0.5625; }
  modelName() { return this.raft ? 'raft' : 'boat'; }
  texName() { return this.raft ? 'raft' : 'boat'; }
  get seats() { return this.chest ? 1 : 2; }
  set chestBoat(v) { this.chest = v; if (v && !this.slots) this.slots = new Array(27).fill(null); }
  ridingOffset() { return this.raft ? this.h * 8 / 9 : this.h / 3; }
  /* Seats as [forward, up, across] from the middle of the boat: one rider
     sits in the middle (0.15 forward in a chest boat), two at 0.2 forward
     and 0.6 back, an animal 0.2 further forward; a third of the way up (the
     raft's deck: most of the way), less the height of the rider's own seat
     above its feet (the player's 0.6, a sitting mob's 0.7). */
  seat(i, p) {
    let fwd = this.chest ? 0.15 : 0;
    if (this.passengers.length > 1) { fwd = i === 0 ? 0.2 : -0.6; if (isAnimal(p)) fwd += 0.2; }
    return [fwd, this.ridingOffset() - riderDrop(p), 0];
  }
  /* After a rider is put in its seat: a mob's body faces the boat's way, its
     head no more than 105 degrees off; in a full boat an animal sits
     sideways (left or right by its number). */
  riderPlaced(p) {
    if (p.isPlayer) return;
    let off = wrap(p.yaw - this.yaw);
    const cl = Math.max(-105 * DEG, Math.min(105 * DEG, off));
    p.yaw += cl - off;
    p.bodyYaw = this.yaw;
    if (p.headYaw !== undefined) p.headYaw = p.yaw;
    if (isAnimal(p) && this.passengers.length === this.seats) {
      const turn = (p.id % 2 === 0 ? 90 : 270) * DEG;
      p.bodyYaw += turn; p.headYaw += turn;
    }
  }
  // narrower than the boat, alive, riding nothing, and a mob that can be pushed and rides boats
  takesPassenger(e) {
    return e instanceof Living && !e.dead && !e.removed && !e.vehicle && e.w < this.w && !e.isPlayer
      && e.constructor.WATER_BREATHER !== 'only' && !e.constructor.NO_PUSH && !NO_BOAT.has(e.type);
  }
  addPassenger(e) {
    // the player gets in the way the player does (manager.js mount: the front seat, the camera)
    if (e === this.m.P || e === this.m.player) return this.m.mount(this);
    e.vehicle = this; this.passengers.push(e); e.vel.set(0, 0, 0); if (e.nav) e.nav.stop();
    return true;
  }

  /* ---- the water round it ---- */
  // the surface of the water in a cell, from its bottom (0: none): water, and blocks full of it
  waterIn(x, y, z) {
    const T = this.m.t, b = T.get(x, y, z);
    if (FLUID[b] === 1) return T.fluidHeight(x, y, z);
    if (WATERLOGGED[b]) { const a = T.get(x, y + 1, z); return FLUID[a] === 1 || WATERLOGGED[a] ? 1 : 8 / 9; }
    return 0;
  }
  // still water (a source, or a block full of it), not water running or falling
  stillAt(x, y, z) { const T = this.m.t, b = T.get(x, y, z); return WATERLOGGED[b] === 1 || (FLUID[b] === 1 && (T.meta(x, y, z) & 15) === 0); }
  statusNow() {
    const p = this.pos, hw = this.hw;
    const x0 = Math.floor(p.x - hw), x1 = Math.ceil(p.x + hw), z0 = Math.floor(p.z - hw), z1 = Math.ceil(p.z + hw);
    // under water: water over its top (running water says so at once)
    const top = p.y + this.h, t1 = top + 0.001;
    let under = false;
    for (let x = x0; x < x1; x++) for (let y = Math.floor(top); y < Math.ceil(t1); y++) for (let z = z0; z < z1; z++) {
      const f = this.waterIn(x, y, z);
      if (f > 0 && t1 < y + f) { if (!this.stillAt(x, y, z)) { this.waterLevel = top; return UNDER_FLOWING; } under = true; }
    }
    if (under) { this.waterLevel = top; return UNDER_WATER; }
    // in water: its bottom under the water's surface
    let level = -Infinity, inW = false;
    for (let x = x0; x < x1; x++) for (let y = Math.floor(p.y); y < Math.ceil(p.y + 0.001); y++) for (let z = z0; z < z1; z++) {
      const f = this.waterIn(x, y, z);
      if (f > 0) { const l = y + f; level = Math.max(level, l); if (p.y < l) inW = true; }
    }
    this.waterLevel = level;
    if (inW) return IN_WATER;
    // on land: the slipperiness of what it rests on
    const f = this.groundFriction();
    if (f > 0) { this.landFriction = f; return ON_LAND; }
    return IN_AIR;
  }
  /* The slipperiness under it: the average over the blocks whose shapes
     touch a sliver just under its bottom (lily pads do not count), the
     block below too for shapes taller than a block (a fence, a wall). */
  groundFriction() {
    const T = this.m.t, p = this.pos, hw = this.hw, y0 = p.y - 0.001;
    const ax0 = p.x - hw, ax1 = p.x + hw, az0 = p.z - hw, az1 = p.z + hw;
    let sum = 0, n = 0;
    for (let y = Math.floor(y0) - 1; y <= Math.floor(y0); y++)
    for (let x = Math.floor(ax0); x < Math.ceil(ax1); x++) for (let z = Math.floor(az0); z < Math.ceil(az1); z++) {
      const b = T.get(x, y, z);
      if (!b || !SOLID[b] || b === LILY) continue;
      const d = BLOCKS[b];
      let touch = false;
      if (d.shape === 'cube') touch = y + 1 > y0 && y < p.y;
      else {
        T.nbx = x; T.nby = y; T.nbz = z;
        const boxes = collisionBoxes(d, T.meta(x, y, z), T.nbFn);
        if (boxes) for (const q of boxes)
          if (y + q[4] > y0 && y + q[1] < p.y && x + q[3] > ax0 && x + q[0] < ax1 && z + q[5] > az0 && z + q[2] < az1) { touch = true; break; }
      }
      if (touch) { sum += d.slippery || 0.6; n++; }
    }
    return n ? sum / n : 0;
  }
  // where the water's surface is above its top: the first layer up that is not full of water (falling into water, it is set there)
  waterAbove() {
    const p = this.pos, hw = this.hw, top = p.y + this.h;
    const x0 = Math.floor(p.x - hw), x1 = Math.ceil(p.x + hw), z0 = Math.floor(p.z - hw), z1 = Math.ceil(p.z + hw);
    const y1 = Math.ceil(top - this.lastYd);
    for (let y = Math.floor(top); y < y1; y++) {
      let f = 0;
      for (let x = x0; x < x1 && f < 1; x++) for (let z = z0; z < z1 && f < 1; z++) f = Math.max(f, this.waterIn(x, y, z));
      if (f < 1) return y + f;
    }
    return y1 + 1;
  }
  /* Running water carries it: the way the water runs in every cell it is
     in (a shallow one counting for less), 0.014 a tick that way. */
  currents() {
    const P = this.m.P;
    if (!P || !P.flow) return;
    const p = this.pos, hw = this.hw - 0.001, y0 = p.y + 0.001, y1 = p.y + this.h - 0.001;
    let sx = 0, sz = 0, deep = 0;
    const f = this.flowV;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(p.x - hw); x < Math.ceil(p.x + hw); x++) for (let z = Math.floor(p.z - hw); z < Math.ceil(p.z + hw); z++) {
      const h = this.waterIn(x, y, z);
      if (!h || y + h < y0) continue;
      deep = Math.max(deep, y + h - y0);
      P.flow(x, y, z, f);
      const k = deep < 0.4 ? deep : 1;
      sx += f[0] * k; sz += f[1] * k;
    }
    const l = Math.hypot(sx, sz);
    if (l < 1e-9) return;
    this.vel.x += sx / l * 0.014; this.vel.z += sz / l * 0.014;
  }

  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    this.prevPaddle[0] = this.paddle[0]; this.prevPaddle[1] = this.paddle[1];
    this.age++;
    this.oldStatus = this.status;
    this.status = this.statusNow();
    // three seconds under water and whoever is in it comes out
    if (this.status === UNDER_WATER || this.status === UNDER_FLOWING) this.outOfControl++; else this.outOfControl = 0;
    if (this.outOfControl >= 60 && this.passengers.length) this.ejectAll();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damage > 0) this.damage--;
    // running water, and lava (it breaks)
    this.currents();
    const T = this.m.t, p = this.pos;
    if (T.boxFluid(p.x - this.hw, p.y, p.z - this.hw, p.x + this.hw, p.y + this.h, p.z + this.hw, 2)) { this.hurt(4, { type: 'lava' }); if (this.removed) return; }
    this.float();
    this.yawDelta = 0;
    const driver = this.passengers[0];
    if (driver && driver.isPlayer) this.control();
    else this.rowing[0] = this.rowing[1] = false;
    const oy = p.y;
    T.move(this, this.vel.x, this.vel.y, this.vel.z);
    this.lastYd = this.vel.y;
    this.fall(p.y - oy);
    if (this.removed) return;
    // the paddles go round while rowing, and rest when not
    for (let i = 0; i < 2; i++) this.paddle[i] = this.rowing[i] ? this.paddle[i] + PI / 8 : 0;
    this.lilyPads();
    this.sore();
    if (this.removed) return;
    this.touching();
  }
  /* Cactus and fire hurt it while it is in their block (a point a tick,
     soul fire two: ten times that as damage, so about five ticks against
     a cactus breaks it and drops it) */
  sore() {
    const T = this.m.t, p = this.pos, hw = this.hw - 1e-5;
    for (let y = Math.floor(p.y + 1e-5); y <= Math.floor(p.y + this.h - 1e-5); y++)
      for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++) for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw); z++) {
        const k = SORE[T.get(x, y, z)];
        if (k) { this.hurt(k, { type: k === 1 ? 'cactus' : 'fire' }); if (this.removed) return; }
      }
  }
  /* A landing: past 3 blocks onto land it would break into planks and
     sticks and hurt its riders, but the game only does that when it was on
     land at the start of the tick, so in practice a fall is just forgotten
     (and so is its riders'). Falling counts only over what is not water. */
  fall(dy) {
    if (this.onGround) {
      if (this.fallDist > 3 && this.status === ON_LAND) {
        for (const r of this.passengers) if (r.isPlayer) { const S = this.m.survival; if (S && !this.m.player.creative()) S.hurt(Math.floor(this.fallDist + 1e-6 - 3), { type: 'fall', fall: this.fallDist }); }
        else if (r.landed) r.landed(this.fallDist);
        this.breakApart(true);
        return;
      }
      this.fallDist = 0;
    } else if (dy < 0 && !this.waterIn(Math.floor(this.pos.x), Math.floor(this.pos.y) - 1, Math.floor(this.pos.z))) this.fallDist -= dy;
  }
  // lily pads in the way are broken (and drop)
  lilyPads() {
    if (!LILY) return;
    const T = this.m.t, p = this.pos, hw = this.hw + 0.001;
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + this.h); y++) for (let x = Math.floor(p.x - hw); x <= Math.floor(p.x + hw); x++) for (let z = Math.floor(p.z - hw); z <= Math.floor(p.z + hw); z++)
      if (T.get(x, y, z) === LILY) this.m.breakBlock(x, y, z, true);
  }
  /* What touches it (its box grown 0.2 across): a mob gets in if no player
     is steering and there is a seat; anything else is pushed off, and an
     empty boat is pushed back (a boat only by one level with it, anything
     else only from no higher than its bottom). */
  touching() {
    const p = this.pos, gx0 = p.x - this.hw - 0.2, gx1 = p.x + this.hw + 0.2, gz0 = p.z - this.hw - 0.2, gz1 = p.z + this.hw + 0.2;
    const gy0 = p.y + 0.01, gy1 = p.y + this.h - 0.01;
    const steered = this.passengers.length && this.passengers[0].isPlayer;
    this.m.forNear(p.x, p.z, 3, e => {
      if (e === this || e.removed || e.vehicle || e.noPhysics) return;
      if (e.pos.x + e.hw <= gx0 || e.pos.x - e.hw >= gx1 || e.pos.z + e.hw <= gz0 || e.pos.z - e.hw >= gz1 || e.pos.y + e.h <= gy0 || e.pos.y >= gy1) return;
      if (!steered && this.passengers.length < this.seats && this.takesPassenger(e)) { this.addPassenger(e); return; }
      const boat = e instanceof Boat;
      if (!boat && !(e instanceof Living && !e.dead && !e.constructor.NO_PUSH)) return;
      if (boat ? e.pos.y >= p.y + this.h : e.pos.y > p.y) return;
      this.shove(e, e.vel, !e.passengers.length);
    });
    // the player
    const P = this.m.P, pl = this.m.player;
    if (P && !P.riding && pl.alive() && this.m.mode !== 'spectator' && !P.noclip
      && P.pos.x + 0.3 > gx0 && P.pos.x - 0.3 < gx1 && P.pos.z + 0.3 > gz0 && P.pos.z - 0.3 < gz1 && P.pos.y + (P.h || 1.8) > gy0 && P.pos.y < gy1 && P.pos.y <= p.y)
      this.shove({ pos: P.pos }, P.vel, true);
  }
  // the game's push: 0.05 a tick apart, less the further apart they are
  shove(e, ev, moveIt) {
    let dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.max(Math.abs(dx), Math.abs(dz));
    if (d < 0.01) return;
    d = Math.sqrt(d); dx /= d; dz /= d;
    const k = Math.min(1, 1 / d) * 0.05;
    dx *= k; dz *= k;
    if (!this.passengers.length) { this.vel.x -= dx; this.vel.z -= dz; }
    if (moveIt) { ev.x += dx; ev.z += dz; }
  }
  float() {
    const v = this.vel, p = this.pos;
    let gravity = -0.04, buoy = 0, inv = 0.05;
    if (this.oldStatus === IN_AIR && this.status !== IN_AIR && this.status !== ON_LAND) {
      // coming down onto water: a splash, then set on the surface (if there is room), its downward speed gone
      if (v.y < -0.2 && this.age > 1) {
        const H = this.m.hooks;
        if (H.onSplash) H.onSplash(p.x, p.z, Math.min(1.4, -v.y * 3));
        const n = 1 + Math.floor(this.w * 20), top = this.waterAbove();
        this.m.particles('bubble', p.x, top - 0.2, p.z, n, this.w / 2);
        this.m.particles('splash', p.x, top, p.z, n, this.w / 2);
      }
      const y = this.waterAbove() - this.h + 0.101;
      if (!this.m.t.boxHits(p.x - this.hw, y, p.z - this.hw, p.x + this.hw, y + this.h, p.z + this.hw, this)) { p.y = y; v.y = 0; this.lastYd = 0; }
      this.status = IN_WATER;
      return;
    }
    if (this.status === IN_WATER) { buoy = (this.waterLevel - p.y) / this.h; inv = 0.9; }
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
    // [left paddle, right paddle]: the left one turns it right
    this.rowing[0] = (right && !left) || fwd;
    this.rowing[1] = (left && !right) || fwd;
  }
  ejectAll() {
    for (const p of this.passengers.slice()) { if (p.isPlayer) this.m.dismount(); else this.m.unseat(p); }
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
    const p = this.pos;
    // the item drops where the boat was, hopping up a little (planks and sticks one at a time)
    if (!creative) {
      if (fell) { for (let i = 0; i < 3; i++) this.m.dropItemAt(p.x, p.y, p.z, this.raft ? 'bamboo_planks' : this.wood + '_planks', 1); for (let i = 0; i < 2; i++) this.m.dropItemAt(p.x, p.y, p.z, 'stick', 1); }
      else this.m.dropItemAt(p.x, p.y, p.z, this.itemName(), 1);
    }
    // what the chest held spills (in creative too, as a chest's does)
    if (this.slots) { this.spill(); }
    this.ejectAll();
    this.passengers.length = 0;
    this.m.particles('poof', p.x, p.y + 0.3, p.z, 10, 0.6);
    this.remove();
  }
  // the chest's things thrown out as a broken chest's are: in parts of 10 to 30, from inside the block the boat is in
  spill() {
    const H = this.m.hooks.hands, D = H && H.drops, p = this.pos;
    const left = this.slots.filter(Boolean);
    this.slots.fill(null);
    if (D && D.spawn) spill(D, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), left);
    else for (const s of left) this.m.dropItemAt(p.x, p.y, p.z, this.m.itemName(s.id), s.count);
  }
  // 'Dark Oak Boat with Chest', 'Bamboo Raft with Chest'
  displayName() {
    const wood = (this.raft ? 'bamboo' : this.wood).split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    return wood + (this.raft ? ' Raft' : ' Boat') + (this.chest ? ' with Chest' : '');
  }
  itemName() { return this.raft ? (this.chest ? 'bamboo_chest_raft' : 'bamboo_raft') : this.wood + (this.chest ? '_chest_boat' : '_boat'); }
  // middle click (pick block) on it: its item
  pickItem() { return this.itemName(); }
  /* Right click: get in (not sneaking, not while it is sunk). A chest
     boat opens instead when sneaking, or when there is no room for you. */
  interact(held, player) {
    if (!player || !player.isPlayer) return false;
    if (!player.sneaking() && this.outOfControl < 60 && this.passengers.length < this.seats && this.m.mount(this)) return 'swing';
    if (this.chest) return this.openChest() ? 'swing' : false;
    return false;
  }
  // the chest's screen (the inventory key while riding it opens it too)
  openChest() {
    const H = this.m.hooks.hands;
    if (!this.chest || !H || !H.open) return false;
    if (!this.slots) this.slots = new Array(27).fill(null);
    H.open(new ChestScreen(H.inv, H.icons, this.slots, this.displayName(), null));
    return true;
  }
  openInventory() { return this.openChest(); }
  /* Getting out (the player, or a mob put out when it breaks or sinks):
     beside it the way the rider looks (out to the edge of a square round
     it), onto the ground there or a block lower, if that is not over water
     and there is room to stand (the player: or crouch); else on top.
     Returns [x, y, z, crouching] or null for on top. */
  dismountSpot(P) {
    const T = this.m.t, isP = P === this.m.P || !!P.isPlayer, pw = isP ? 0.6 : P.w, d = (this.w * Math.SQRT2 + pw + 1e-5) / 2, r = pw / 2;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), m = Math.max(Math.abs(fx), Math.abs(fz));
    const x = this.pos.x + fx * d / m, z = this.pos.z + fz * d / m;
    const by = Math.floor(this.pos.y + this.h), bx = Math.floor(x), bz = Math.floor(z);
    if (this.waterIn(bx, by - 1, bz)) return null;
    const heights = isP ? [1.8, 1.5] : [P.h];
    for (const y of [by, by - 1]) {
      const fl = this.floorAt(bx, y, bz);
      if (fl === null) continue;
      for (const h of heights) if (!T.boxHits(x - r, y + fl, z - r, x + r, y + fl + h, z + r)) return [x, y + fl, z, h < heights[0]];
    }
    return null;
  }
  // the height you would stand at in a cell, from its bottom: the top of its shape if lower than a block, or the block under it's (null: nothing to stand on)
  floorAt(x, y, z) {
    const top = (yy) => {
      const T = this.m.t, b = T.get(x, yy, z);
      if (!b || !SOLID[b]) return -Infinity;
      const d = BLOCKS[b];
      if (d.shape === 'cube') return 1;
      T.nbx = x; T.nby = yy; T.nbz = z;
      const boxes = collisionBoxes(d, T.meta(x, yy, z), T.nbFn);
      let mx = -Infinity;
      if (boxes) for (const q of boxes) mx = Math.max(mx, q[4]);
      return mx;
    };
    let h = top(y);
    if (h === -Infinity) { const u = top(y - 1); h = u >= 1 ? u - 1 : -Infinity; }
    return h > -Infinity && h < 1 ? h : null;
  }
  /* ---- drawing ---- */
  // the water is kept out of a boat's inside, not a raft's (it has none), nor once the boat has gone under
  noMask() { return this.raft || this.status === UNDER_WATER || this.status === UNDER_FLOWING; }
  tint() { return WOODS[this.raft ? 'bamboo' : this.wood] || WOODS.oak; }
  anim(A, a) {
    A.paddleL = this.rowing[0] ? this.paddle[0] - PI / 8 * (1 - a) : 0;
    A.paddleR = this.rowing[1] ? this.paddle[1] - PI / 8 * (1 - a) : 0;
  }
  rootPose(root, t, a) {
    // rocking bow and stern up and down when hit (about its width, 0.375 up), less as the damage wears off
    const h = this.hurtTime - a, dm = Math.max(0, this.damage - a);
    if (h > 0) {
      root.multiply(t.makeTranslation(0, 0.375, 0));
      root.multiply(t.makeRotationX(Math.sin(h) * h * dm / 10 * this.hurtDir * DEG));
      root.multiply(t.makeTranslation(0, -0.375, 0));
    }
  }
  layers(out) { if (this.chest) out.push(this.raft ? ['raft_chest', 'boat_chest', null] : ['boat_chest', 'boat_chest', null]); }
  /* ---- keeping it ----
     the wood, the chest and what it holds, the mobs riding it (they are
     kept with it, not on their own), and whether the player was in it */
  toJSON() {
    const o = super.toJSON(); o.wd = this.wood; if (this.chest) o.ch = 1; if (this.raft) o.rf = 1;
    if (this.slots && this.slots.some(Boolean)) o.items = this.slots.map(stackToJSON);
    const mobs = this.passengers.filter(p => !p.isPlayer && p.toJSON && !p.removed && !p.dead);
    if (mobs.length) o.ps = mobs.map(p => p.toJSON());
    if (this.passengers.some(p => p.isPlayer)) o.pr = 1;
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o); this.wood = o.wd || 'oak'; this.chest = !!o.ch; this.raft = !!o.rf;
    if (this.chest) { this.slots = new Array(27).fill(null); if (Array.isArray(o.items)) for (let i = 0; i < 27; i++) this.slots[i] = stackFromJSON(o.items[i]); }
    for (const pj of o.ps || []) {
      const e = this.m.spawn(pj.t, pj.p[0], pj.p[1], pj.p[2], { json: pj, natural: false });
      if (e && this.passengers.length < this.seats) this.addPassenger(e);
    }
    if (o.pr) this.m.remount = this;
  }
}
register('boat', Boat);
// the game's names for each kind ('oak_boat', 'spruce_chest_boat', 'bamboo_raft'...), so spawning by name makes the right one
for (const w of Object.keys(WOODS)) for (const n of w === 'bamboo' ? ['bamboo_raft', 'bamboo_chest_raft'] : [w + '_boat', w + '_chest_boat']) register(n, class extends Boat {});

/* Placing a boat from its item name ('oak_boat', 'spruce_chest_boat',
   'bamboo_raft') at a point, facing the way the player looks. */
export function placeBoat(m, name, x, y, z, yaw) {
  const mt = /^(.*?)(_chest)?_(boat|raft)$/.exec(name || 'oak_boat');
  if (!mt) return null;
  const b = m.spawn('boat', x, y, z, { yaw, natural: false });
  if (!b) return null;
  b.raft = mt[3] === 'raft';
  b.wood = b.raft ? 'bamboo' : (WOODS[mt[1]] ? mt[1] : 'oak');
  if (mt[2]) b.chestBoat = true;
  return b;
}
