/* ---------------------------------------------------------------------------
   Leoncraft 2 - more monsters, and the things that live in water and caves:
   the enderman, the slime, the witch, squid and glow squid, cod, salmon,
   tropical fish and pufferfish, and the bat.

   Numbers from the Minecraft Wiki's mob pages (Java Edition): health, the
   movement speed attribute, damage on Normal, size, loot, experience,
   spawn rules, and the behaviour each page describes (an enderman's stare
   and teleports, a slime's hops and split, a witch's potions, a squid's ink,
   a school of fish, a pufferfish puffing up, a bat hanging from the roof).
   The models follow the game's proportions; every texture is painted here,
   pixel by pixel, in our own colours.
--------------------------------------------------------------------------- */
import { Mob, Goal, DEG, wrap, yawTo, rotTowards, MOVE, LOOK, JUMP, TARGET, looted } from './entity.js?v=107';
import { FloatGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, MeleeAttackGoal, NearestPlayerTargetGoal, HurtByTargetGoal, SwimGoal } from './ai.js?v=107';
import { register, Monster, DYE_RGB } from './mobs.js?v=107';
import { model } from './mobs2.js?v=107';
import { POSE } from './mobmodels.js?v=107';
import { addArt, SLOTS } from './mobart.js?v=107';
import { B, BLOCKS, FLUID, SOLID, OPAQUE } from '../blocks.js?v=107';
import { Y0 } from '../world-const.js?v=107';
import { breakAt } from '../place.js?v=107';
import { dropOf } from '../survival.js?v=107';

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const between = (a, b) => a + RI(b - a + 1);
const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v); };
const lerp = (a, b, t) => a + (b - a) * t;

// pose helpers (7 numbers a part: x, y, z, x turn, y turn, z turn, scale)
const RX = 3, RY = 4, RZ = 5;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };

/* A texture inside another one's slot: several small textures (tropical fish
   patterns, the blocks an enderman carries) share one 64 x 64 slot of the
   atlas, and each gets a name of its own once the atlas is laid out. */
function sub(name, dx, dy) {
  const key = name + '@' + dx + ',' + dy;
  if (!SLOTS[key]) { const s = SLOTS[name]; if (!s) return name; SLOTS[key] = [s[0] + dx, s[1] + dy]; }
  return key;
}
// particles lit by where the mob is (the manager's particles() draws them full bright)
function puff(e, kind, x, y, z, n, spread, col) {
  e.m.particlesP.add(kind, x, y, z, n, spread, col, Math.max(e.lS || 0, e.lB || 0, 0.06));
}
// one particle with a velocity of its own
function particleV(e, kind, x, y, z, vx, vy, vz, col, light) {
  const P = e.m.particlesP, n = P.n;
  P.add(kind, x, y, z, 1, 0, col, light === undefined ? Math.max(e.lS || 0, e.lB || 0, 0.06) : light);
  if (P.n > n) { const o = n * 3; P.vel[o] = vx; P.vel[o + 1] = vy; P.vel[o + 2] = vz; }
}
// the player's eye height (sneaking lowers it)
const eyeOf = P => P.pos.y + (P.sneaking ? 1.27 : 1.62);
// is it raining on this spot? (the weather is someone else's; this reads it if it is there)
/* rain falling on a block, as the game asks it: raining, open to the sky, and
   a biome where it rains rather than snows (or neither). The manager's
   raining is a method: read as a value it was always true, so endermen under
   an open sky were hurt and teleported off every tick, rain or not. */
function rainOn(m, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const w = m.sim && m.sim.weather;
  if (w && w.rainingAt) return m.dim === 'overworld' && w.rainingAt(bx, by, bz);
  const r = typeof m.isRaining === 'function' ? m.isRaining() : typeof m.raining === 'function' ? m.raining() : m.raining;
  return !!r && m.seesSky(bx, by, bz);
}
const ids = names => { const a = new Uint8Array(4096); for (const n of names) if (B[n] !== undefined) a[B[n]] = 1; return a; };
let TABLES = null;
function tables() {
  if (TABLES) return TABLES;
  TABLES = {
    // what an enderman may pick up (the game's enderman_holdable list)
    holdable: ids(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots',
      'sand', 'red_sand', 'gravel', 'clay', 'pumpkin', 'carved_pumpkin', 'melon', 'cactus', 'tnt', 'brown_mushroom', 'red_mushroom',
      'dandelion', 'golden_dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
      'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'open_eyeblossom', 'closed_eyeblossom',
      'crimson_fungus', 'crimson_nylium', 'crimson_roots', 'warped_fungus', 'warped_nylium', 'warped_roots']),
    // the ground flowers and roots grow in
    soil: ids(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'farmland', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots', 'mycelium']),
    nether: ids(['crimson_nylium', 'warped_nylium', 'soul_soil', 'soul_sand', 'netherrack']),
    sand: ids(['sand', 'red_sand', 'suspicious_sand', 'cactus']),
    // a bat's floor (the game's bats_spawnable_on)
    batFloor: ids(['stone', 'granite', 'diorite', 'andesite', 'tuff', 'deepslate']),
    water: B.water,
  };
  return TABLES;
}

/* ===========================================================================
   ENDERMAN
   40 health, speed 0.3 (0.45 once it has a target), 7 damage, follow range
   64, 2.9 tall, steps up a full block. Neutral: it turns on you when you
   look at its head for a quarter of a second (or hit it), stares back with
   its jaw open, shaking, and then comes for you. Looked at from within 4
   blocks while it is after you it teleports away; more than 16 blocks off
   and not looked at, it teleports 16 blocks nearer every 30 ticks or so.
   Water and rain hurt it a point at a time and set it teleporting; arrows
   and thrown things never touch it. It picks up grass, dirt, sand, flowers
   and the like and puts them down somewhere else.
=========================================================================== */
model('enderman', [
  { name: 'head', pivot: [0, -13, 0], boxes: [[-3.5, -7.5, -3.5, 7, 5, 7, 0, 0]] },
  { name: 'jaw', pivot: [0, -13, 0], boxes: [[-3.5, -2.5, -3.5, 7, 2, 7, 0, 16]] },
  { name: 'body', pivot: [0, -14, 0], boxes: [[-4, 0, -2, 8, 12, 4, 32, 16]] },
  { name: 'rightArm', pivot: [-5, -12, 0], boxes: [[-1, -2, -1, 2, 30, 2, 56, 0]] },
  { name: 'leftArm', pivot: [5, -12, 0], boxes: [[-1, -2, -1, 2, 30, 2, 56, 0, 0, true]] },
  { name: 'rightLeg', pivot: [-2, -6, 0], boxes: [[-1, 0, -1, 2, 30, 2, 56, 0]] },
  { name: 'leftLeg', pivot: [2, -6, 0], boxes: [[-1, 0, -1, 2, 30, 2, 56, 0, 0, true]] },
  // where a carried block sits: held out in front, between the hands (drawn as a layer)
  { name: 'block', pivot: [0, 11, -11], rot: [0.35, PI / 4, 0], boxes: [] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.jaw, RY, A.yaw); set(P, I.jaw, RX, A.pitch);
  // the humanoid walk, at half the swing and never past 0.4
  const w = A.walk * 0.6662, s = A.amt, cl = v => Math.max(-0.4, Math.min(0.4, v));
  set(P, I.rightArm, RX, cl(Math.cos(w + PI) * s * 0.5));
  set(P, I.leftArm, RX, cl(Math.cos(w) * s * 0.5));
  set(P, I.rightLeg, RX, cl(Math.cos(w) * 1.4 * s * 0.5));
  set(P, I.leftLeg, RX, cl(Math.cos(w + PI) * 1.4 * s * 0.5));
  // the arms sway a little
  const sz = Math.cos(A.age * 0.09) * 0.05 + 0.05, sx = Math.sin(A.age * 0.067) * 0.05;
  add(P, I.rightArm, RZ, sz); add(P, I.leftArm, RZ, -sz);
  add(P, I.rightArm, RX, sx); add(P, I.leftArm, RX, -sx);
  if (A.carry) { set(P, I.rightArm, RX, -0.5); set(P, I.leftArm, RX, -0.5); set(P, I.rightArm, RZ, 0.05); set(P, I.leftArm, RZ, -0.05); }
  if (A.attack > 0) {
    const at = A.attack, e = 1 - Math.pow(1 - at, 4);
    add(P, I.rightArm, RX, -(Math.sin(e * PI) * 1.2 + Math.sin(at * PI) * 0.4));
    add(P, I.rightArm, RZ, Math.sin(at * PI) * -0.4);
    set(P, I.body, RY, Math.sin(Math.sqrt(at) * PI * 2) * 0.2);
  }
  // angry: the top of the head lifts off the jaw
  if (A.angry) add(P, I.head, 1, -5);
});
// the carried block: a half-size cube on the 'block' bone (index 7)
model('enderman_block', [
  { name: 'head' }, { name: 'jaw' }, { name: 'body' }, { name: 'rightArm' }, { name: 'leftArm' }, { name: 'rightLeg' }, { name: 'leftLeg' },
  { name: 'block', boxes: [[-4, -4, -4, 8, 8, 8, 0, 0, 0, false, true]] },
]);
addArt('enderman', [64, 32], p => {
  const k = 0x151515, k2 = 0x0b0b0b, k3 = 0x222222, mouth = 0x1c0a22;
  // the top of the head: 7 x 5 x 7
  p.box(0, 0, 7, 5, 7, { all: k, bottom: mouth }, 0.1);
  p.speckle(0, 0, 28, 12, k3, 0.16); p.speckle(0, 0, 28, 12, k2, 0.2);
  p.fill(14, 0, 7, 7, mouth, 0.1);
  // the eyes: a purple slit each side with a pale pink middle, low on the face
  const fx = 7, fy = 7 + 3;
  for (const [x, c] of [[0, 0xa418d8], [1, 0xe9a6ff], [2, 0xc33cf0], [4, 0xc33cf0], [5, 0xe9a6ff], [6, 0xa418d8]]) p.px(fx + x, fy, c);
  p.px(fx + 1, fy - 1, 0x2a0a34); p.px(fx + 5, fy - 1, 0x2a0a34);
  // the jaw: 7 x 2 x 7, dark purple inside where the mouth opens
  p.box(0, 16, 7, 2, 7, { all: k, top: mouth }, 0.1);
  p.speckle(0, 23, 28, 2, k3, 0.2);
  // body and the long limbs
  p.box(32, 16, 8, 12, 4, k, 0.1);
  p.speckle(32, 16, 24, 16, k3, 0.15); p.speckle(32, 16, 24, 16, k2, 0.2);
  p.box(56, 0, 2, 30, 2, k, 0.1);
  p.speckle(56, 0, 8, 32, k3, 0.15);
});
/* The blocks it carries, in one slot: eight half-size cubes of 32 x 16.
   0 grass, 1 plain grey (tinted to the block's colour), 2-5 flowers (red,
   yellow, white, blue), 6-7 mushrooms (red, brown). */
addArt('enderman_blocks', [64, 64], p => {
  const cube = (u, v, spec) => p.box(u, v, 8, 8, 8, spec, 0.1);
  // grass: green on top, dirt sides with a fringe of green
  cube(0, 0, { top: 0x6aa83e, bottom: 0x86603e, sides: (x, y, w, h) => { p.fill(x, y, w, h, 0x86603e, 0.12); p.speckle(x, y, w, h, 0x6c4a2e, 0.25); p.fill(x, y, w, 2, 0x64a03a, 0.1); p.speckle(x, y + 2, w, 1, 0x64a03a, 0.5); } });
  p.speckle(8, 0, 8, 8, 0x4f8a2c, 0.3);
  // plain: grey with grain and darker flecks
  cube(32, 0, { all: (x, y, w, h) => { p.fill(x, y, w, h, 0xd8d8d8, 0.1); p.speckle(x, y, w, h, 0xa8a8a8, 0.25); p.speckle(x, y, w, h, 0xf4f4f4, 0.12); } });
  // flowers: a stem and a bloom on each side, clear elsewhere
  const plant = (u, v, bloom, centre, stem) => {
    const F = p.box(u, v, 8, 8, 8, { all: (x, y, w, h) => p.clear(x, y, w, h) });
    for (const k of ['front', 'back', 'right', 'left']) {
      const [x, y] = F[k];
      p.fill(x + 3, y + 3, 2, 5, stem, 0.1); p.px(x + 2, y + 5, stem); p.px(x + 5, y + 6, stem);
      if (bloom) { p.fill(x + 2, y + 1, 4, 2, bloom, 0.12); p.fill(x + 3, y, 2, 4, bloom, 0.12); if (centre) p.px(x + 3, y + 1, centre); }
    }
  };
  plant(0, 16, 0xd8282a, 0x2a1a10, 0x3e7a28);
  plant(32, 16, 0xf2d230, 0xd89a10, 0x3e7a28);
  plant(0, 32, 0xf0f0f0, 0xe8c030, 0x3e7a28);
  plant(32, 32, 0x4a6ae0, 0x2a3aa0, 0x3e7a28);
  // mushrooms: a cap on a pale stalk
  const shroom = (u, v, cap, spot) => {
    const F = p.box(u, v, 8, 8, 8, { all: (x, y, w, h) => p.clear(x, y, w, h) });
    for (const k of ['front', 'back', 'right', 'left']) {
      const [x, y] = F[k];
      p.fill(x + 3, y + 4, 2, 4, 0xe2d8c4, 0.06);
      p.fill(x + 1, y + 2, 6, 2, cap, 0.1); p.fill(x + 2, y + 1, 4, 1, cap, 0.1);
      if (spot) { p.px(x + 2, y + 2, spot); p.px(x + 5, y + 1, spot); }
    }
  };
  shroom(0, 48, 0xc8282a, 0xf0e8e0);
  shroom(32, 48, 0x9a6a48, 0);
});
// which of those a block is drawn as, and its colour
const PLAIN_RGB = {
  dirt: 0x8b603e, coarse_dirt: 0x77553b, podzol: 0x6a4a24, mycelium: 0x76666e, rooted_dirt: 0x906a4c, moss_block: 0x5c7c2e, pale_moss_block: 0xa4ac9e,
  mud: 0x3e3a3e, muddy_mangrove_roots: 0x4a3c2e, sand: 0xdccfa2, red_sand: 0xc06a26, gravel: 0x86827f, clay: 0xa2a8b6, pumpkin: 0xc8781c,
  carved_pumpkin: 0xc8781c, melon: 0x709c2c, cactus: 0x58882c, tnt: 0xc63c2c, crimson_nylium: 0x8a2626, warped_nylium: 0x2a7a6a,
  crimson_fungus: 0xa83020, warped_fungus: 0x2a9a8a, crimson_roots: 0x9a2a40, warped_roots: 0x2aa894,
};
function carriedLook(name) {
  if (name === 'grass_block') return [0, 0, 0xffffff];
  if (name === 'red_mushroom') return [0, 48, 0xffffff];
  if (name === 'brown_mushroom') return [32, 48, 0xffffff];
  if (/dandelion|torchflower/.test(name)) return [32, 16, 0xffffff];
  if (/poppy|red_tulip|wither_rose/.test(name)) return [0, 16, 0xffffff];
  if (/white_tulip|daisy|lily_of_the_valley|eyeblossom/.test(name)) return [0, 32, 0xffffff];
  if (/orchid|cornflower|bluet|allium|orange_tulip|pink_tulip/.test(name)) return [32, 32, 0xffffff];
  return [32, 0, PLAIN_RGB[name] || 0x908070];
}

export class Enderman extends Monster {
  static W = 0.6; static H = 2.9; static HEALTH = 40; static SPEED = 0.3; static ATTACK = 7; static FOLLOW = 64; static STEP = 1;
  static MODEL = 'enderman'; static TEX = 'enderman'; static SHADOW = 0.5; static XP = 5;
  constructor(m, type) {
    super(m, type);
    this.carried = 0;            // the block in its hands (an id), 0 for none
    this.angerT = 0;             // ticks of anger left after being hit (20 to 39 seconds)
    this.angryAt = null;
    this.targetSince = 0;        // when its target last changed (no daylight teleports in its first 30 seconds)
    this.oTarget = null;
    this.waterCost = -1;         // its paths never go through water
  }
  get eyeH() { return 2.55; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new FreezeWhenLookedAt(this));
    this.goals.add(2, new MeleeAttackGoal(this, 1, false));
    this.goals.add(7, new StrollGoal(this, 1));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookAroundGoal(this));
    this.goals.add(10, new LeaveBlockGoal(this));
    this.goals.add(11, new TakeBlockGoal(this));
    this.targets.add(1, new StareTargetGoal(this));
    this.targets.add(2, new HurtByTargetGoal(this, false));
  }
  /* Is the player looking at its head? The look and the line from the
     player's eye to its eye must be within 1 - 0.025 / distance of each
     other (a target that gets smaller the further off it is), with nothing
     solid between; a carved pumpkin on the head hides the player's eyes. */
  lookedAtBy() {
    const m = this.m, P = m.P;
    if (!m.player.alive()) return false;
    const inv = m.inv, helm = inv && inv.armor && inv.armor[0];
    if (helm && BLOCKS[helm.id] && BLOCKS[helm.id].name === 'carved_pumpkin') return false;
    const cp = Math.cos(P.pitch), lx = -Math.sin(P.yaw) * cp, ly = Math.sin(P.pitch), lz = -Math.cos(P.yaw) * cp;
    const ex = P.pos.x, ey = eyeOf(P), ez = P.pos.z;
    const dx = this.pos.x - ex, dy = this.pos.y + this.eyeH - ey, dz = this.pos.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return false;
    if ((lx * dx + ly * dy + lz * dz) / d <= 1 - 0.025 / d) return false;
    return m.t.sees(ex, ey, ez, this.pos.x, this.pos.y + this.eyeH, this.pos.z);
  }
  serverAi() {
    super.serverAi();
    // a new target: faster, and the jaw opens
    if (this.target !== this.oTarget) {
      this.oTarget = this.target; this.targetSince = this.age;
      this.speed = this.target ? 0.45 : 0.3;
    }
    if (this.angerT > 0 && --this.angerT === 0) this.angryAt = null;
  }
  aiStep() {
    const p = this.pos;
    // water and rain hurt it (the hurt window makes that a point every half second)
    if (!this.dead && (this.inWater || rainOn(this.m, p.x, p.y + this.h, p.z))) this.hurt(1, { type: 'drown' });
    // by day, in the open, it teleports off at random looking for the dark
    if (!this.dead && this.m.isDay() && this.age >= this.targetSince + 600) {
      const x = Math.floor(p.x), y = Math.floor(p.y + this.eyeH), z = Math.floor(p.z);
      const br = this.m.brightness(x, y, z);
      if (br > 0.5 && this.m.seesSky(x, y, z) && R() * 30 < (br - 0.4) * 2) { this.target = null; this.teleport(); }
    }
    super.aiStep();
    // the purple specks around it
    if (!this.dead) for (let i = 0; i < 2; i++) {
      const f = R() * 0.6 + 0.4;
      particleV(this, 'portal', p.x + (R() - 0.5) * this.w, p.y + R() * this.h - 0.25, p.z + (R() - 0.5) * this.w,
        (R() - 0.5) * 0.1, -R() * 0.05, (R() - 0.5) * 0.1, [f * 0.9, f * 0.3, f], 1);
    }
  }
  /* Hurt: arrows, snowballs and splash potions never land, it teleports
     instead. Anything not done by a living thing (water, fire, a fall)
     teleports it nine times in ten. A hit from someone makes it angry. */
  hurt(amount, source) {
    if (this.dead || this.removed) return false;
    if (source.type === 'arrow' || source.type === 'thrown' || source.direct || source.type === 'magic' && source.attacker && source.attacker !== this) {
      this.teleportAway();
      return false;
    }
    const ok = super.hurt(amount, source);
    if (!this.dead && !source.attacker && RI(10) !== 0) this.teleport();
    return ok;
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    const a = source.attacker;
    if (a && a !== this && (a.isPlayer || a.hurt)) { this.angryAt = a; this.angerT = 400 + RI(380); }
  }
  // up to 64 tries at a random teleport (what an arrow sets off)
  teleportAway() { for (let i = 0; i < 64; i++) if (this.teleport()) return true; return false; }
  // anywhere within 32 blocks along each axis
  teleport() {
    if (this.dead) return false;
    return this.teleportTo(this.pos.x + (R() - 0.5) * 64, this.pos.y + RI(64) - 32, this.pos.z + (R() - 0.5) * 64);
  }
  // 16 blocks towards something, give or take 4
  teleportTowards(e) {
    let dx = this.pos.x - e.pos.x, dy = this.pos.y + this.h / 2 - (e.pos.y + (e.eyeH || 1.62)), dz = this.pos.z - e.pos.z;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    return this.teleportTo(this.pos.x + (R() - 0.5) * 8 - dx * 16, this.pos.y + RI(16) - 8 - dy * 16, this.pos.z + (R() - 0.5) * 8 - dz * 16);
  }
  /* Down from (x, y, z) to the first block that stops movement; it has to
     be dry there, the chunk loaded and the box clear of blocks and fluid. */
  teleportTo(x, y, z) {
    const T = this.m.t, bx = Math.floor(x), bz = Math.floor(z);
    let by = Math.floor(y);
    if (!T.loaded(bx, bz)) return false;
    by = Math.min(by, 383);
    while (by > 0 && !T.solid(bx, by - 1, bz)) by--;
    if (by <= 0 || FLUID[T.get(bx, by - 1, bz)] || FLUID[T.get(bx, by, bz)]) return false;
    const hw = this.hw;
    if (T.boxHits(x - hw, by, z - hw, x + hw, by + this.h, z + hw)) return false;
    if (T.boxFluid(x - hw, by, z - hw, x + hw, by + this.h, z + hw, 1) || T.boxFluid(x - hw, by, z - hw, x + hw, by + this.h, z + hw, 2)) return false;
    const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
    this.setPos(x, by, z);
    this.vel.set(0, 0, 0); this.fallDist = 0;
    if (this.nav) this.nav.stop();
    // a trail of purple from where it was to where it is
    for (let i = 0; i < 128; i++) {
      const t = i / 127, f = R() * 0.6 + 0.4;
      particleV(this, 'portal', lerp(ox, x, t) + (R() - 0.5) * this.w * 2, lerp(oy, by, t) + R() * this.h, lerp(oz, z, t) + (R() - 0.5) * this.w * 2,
        (R() - 0.5) * 0.2, (R() - 0.5) * 0.2, (R() - 0.5) * 0.2, [f * 0.9, f * 0.3, f], 1);
    }
    this.teleported = (this.teleported || 0) + 1;
    return true;
  }
  loot(drop, byPlayer, L) {
    drop('ender_pearl', RI(2) + looted(L));
    if (this.carried && BLOCKS[this.carried]) drop(BLOCKS[this.carried].name, 1);
  }
  anim(A) { A.angry = !!this.target && !this.dead; A.carry = this.carried ? 1 : 0; }
  // shaking while it is after you
  rootPose(root, t) {
    if (this.target && !this.dead) root.multiply(t.makeTranslation(gauss() * 0.02, 0, gauss() * 0.02));
  }
  layers(out) {
    if (!this.carried || !BLOCKS[this.carried]) return;
    const [u, v, col] = carriedLook(BLOCKS[this.carried].name);
    out.push(['enderman_block', sub('enderman_blocks', u, v), col]);
  }
  toJSON() { const o = super.toJSON(); if (this.carried && BLOCKS[this.carried]) o.cb = BLOCKS[this.carried].name; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.cb && B[o.cb] !== undefined) this.carried = B[o.cb]; }
}
register('enderman', Enderman);

/* ---- the stare: the player looks at it for 5 ticks and it is theirs ---- */
class StareTargetGoal extends Goal {
  constructor(mob) { super(mob, TARGET); this.pending = null; this.aggro = 0; this.tele = 0; }
  ok(p) { const m = this.mob; return p && p.alive() && !p.creative() && m.m.difficulty !== 'peaceful'; }
  angry(p) { const m = this.mob; return m.angerT > 0 && m.angryAt === p; }
  canUse() {
    const m = this.mob, p = m.m.player;
    if (!this.ok(p) || m.dist2(p.pos.x, p.pos.y, p.pos.z) > 64 * 64) return false;
    // still angry from a hit: straight back to it
    if (this.angry(p)) { this.pending = null; this.direct = p; return true; }
    if (RI(10) !== 0) return false;
    if (!m.lookedAtBy()) return false;
    this.pending = p; this.direct = null;
    return true;
  }
  start() {
    const m = this.mob;
    this.tele = 0;
    if (this.direct) { m.target = this.direct; this.direct = null; }
    else { this.aggro = 5; m.staredAt = m.age; }
  }
  canContinue() {
    const m = this.mob;
    if (this.pending) {
      if (!this.ok(this.pending) || !(m.lookedAtBy() || this.angry(this.pending))) return false;
      m.lookAtEntity(this.pending, 10, 10);
      return true;
    }
    const t = m.target;
    // once it is after you it keeps on, seen or not, while you are within 64
    return this.ok(t) && m.dist2(t.pos.x, t.pos.y, t.pos.z) <= 64 * 64;
  }
  tick() {
    const m = this.mob;
    if (this.pending) {
      if (--this.aggro <= 0) { m.target = this.pending; this.pending = null; }
      return;
    }
    const t = m.target;
    if (!t || m.vehicle) return;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    if (t.isPlayer && m.lookedAtBy()) {
      // looked in the eye from close by: away it goes
      if (d2 < 16) m.teleport();
      this.tele = 0;
    } else if (d2 > 256 && this.tele++ >= 30 && m.teleportTowards(t)) this.tele = 0;
  }
  stop() { this.pending = null; this.mob.target = null; }
}
/* ---- looked at from within 16 blocks while it is after you, it stands still and stares back ---- */
class FreezeWhenLookedAt extends Goal {
  constructor(mob) { super(mob, MOVE | JUMP); }
  canUse() {
    const m = this.mob, t = m.target;
    if (!t || !t.isPlayer || m.dist2(t.pos.x, t.pos.y, t.pos.z) > 256) return false;
    return m.lookedAtBy();
  }
  start() { this.mob.nav.stop(); }
  tick() { const m = this.mob; m.lookAt(m.target.pos.x, eyeOf(m.m.P), m.target.pos.z); }
}
/* ---- picking up: one chance in 20 a tick, a block in the 4 x 3 x 4 around
   its feet that it can see ---- */
class TakeBlockGoal extends Goal {
  constructor(mob) { super(mob, 0); }
  canUse() { return !this.mob.carried && this.mob.m.mobGriefing !== false && RI(20) === 0; }
  canContinue() { return false; }
  tick() {
    const m = this.mob, T = m.m.t, p = m.pos;
    const x = Math.floor(p.x - 2 + R() * 4), y = Math.floor(p.y + R() * 3), z = Math.floor(p.z - 2 + R() * 4);
    const b = T.get(x, y, z);
    if (!b || !tables().holdable[b]) return;
    // nothing solid between its middle and the block
    const sx = Math.floor(p.x) + 0.5, sy = y + 0.5, sz = Math.floor(p.z) + 0.5;
    const dx = x + 0.5 - sx, dz = z + 0.5 - sz, l = Math.hypot(dx, dz);
    if (l > 0.01) {
      const t = T.ray(sx, sy, sz, dx / l, 0, dz / l, l);
      if (t < l && (T.rayX !== x || T.rayY !== y || T.rayZ !== z)) return;
    }
    const W = m.m.world;
    // what stood on it (a flower on the grass) breaks and drops
    for (const [gx, gy, gz] of breakAt(W, x, y, z)) {
      if (gx === x && gy === y && gz === z) continue;
      const g = W.get(gx, gy, gz), d = dropOf(g);
      if (d) m.m.dropItemAt(gx + 0.5, gy + 0.5, gz + 0.5, BLOCKS[d].name, 1, true, false);
      W.set(gx, gy, gz, 0, 0);
    }
    W.set(x, y, z, 0, 0);
    if (m.m.fluids) m.m.fluids.around(x, y, z);
    m.carried = b;
  }
}
/* ---- putting down: one chance in 2000 a tick, on top of a full block in
   the 2 x 2 x 2 around its feet, where the block can stay ---- */
class LeaveBlockGoal extends Goal {
  constructor(mob) { super(mob, 0); }
  canUse() { return !!this.mob.carried && this.mob.m.mobGriefing !== false && RI(2000) === 0; }
  canContinue() { return false; }
  tick() {
    const m = this.mob, T = m.m.t, p = m.pos;
    const x = Math.floor(p.x - 1 + R() * 2), y = Math.floor(p.y + R() * 2), z = Math.floor(p.z - 1 + R() * 2);
    if (T.get(x, y, z) !== 0) return;
    const below = T.get(x, y - 1, z), bd = BLOCKS[below];
    if (!below || !bd || bd.shape !== 'cube' || !SOLID[below] || bd.name === 'bedrock') return;
    if (!canStay(m.carried, T, x, y, z, m.m)) return;
    m.m.world.set(x, y, z, m.carried, 0);
    m.carried = 0;
  }
}
// can a block stand here (a flower on soil, a cactus on sand with nothing beside it)?
function canStay(b, T, x, y, z, m) {
  const d = BLOCKS[b], below = T.get(x, y - 1, z), K = tables();
  if (!d) return false;
  const n = d.name;
  if (n === 'cactus') return !!K.sand[below] && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => SOLID[T.get(x + dx, y, z + dz)]);
  if (/mushroom$/.test(n)) return below === B.mycelium || below === B.podzol || (OPAQUE[below] && m.rawBrightness(x, y, z) < 13);
  if (/fungus$|_roots$/.test(n)) return !!(K.nether[below] || K.soil[below]);
  if (n === 'wither_rose') return !!(K.soil[below] || K.nether[below]);
  if (d.shape === 'cross') return !!K.soil[below];
  return true;
}

/* ===========================================================================
   SLIME
   Sizes 1, 2 and 4: a cube 0.52 x size a side, size squared health, speed
   0.2 + 0.1 x size, and size damage for the two bigger ones (the small
   ones are harmless). It hops: a jump every 10 to 29 ticks, three times as
   often when a big one is after you, moving only while in the air. Dying,
   a big one splits into 2 to 4 of the next size down. They come out below
   y 40 in slime chunks (one chunk in ten, from the world seed) and in
   swamps at night, more on brighter moons.
=========================================================================== */
model('slime', [
  { name: 'cube', pivot: [0, 0, 0], boxes: [
    [-3, 17, -3, 6, 6, 6, 0, 16],           // the core
    [-3.25, 18, -3.5, 2, 2, 2, 32, 0],      // eyes
    [1.25, 18, -3.5, 2, 2, 2, 32, 4],
    [0, 21, -3.5, 1, 1, 1, 32, 8],          // mouth
    [-4, 16, -4, 8, 8, 8, 0, 0],            // the jelly round it
  ] },
]);
addArt('slime', [64, 32], p => {
  const gel = 0x86d06a, edge = 0x6cbc52, hi = 0xb4eaa0;
  // the outer jelly: denser towards the edges, mostly clear in the middle (see-through, as near as alpha testing gets)
  p.box(0, 0, 8, 8, 8, { all: (x, y, w, h) => {
    p.clear(x, y, w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const e = Math.min(i, j, w - 1 - i, h - 1 - j);
      const chance = e === 0 ? 0.62 : e === 1 ? 0.3 : 0.14;
      if (p.r() < chance) p.px(x + i, y + j, e === 0 ? p.shade(edge, 0.94 + p.r() * 0.12) : p.r() < 0.45 ? hi : gel);
    }
    // a highlight in the top corner, as on wet jelly
    p.px(x + 1, y + 1, hi); p.px(x + 2, y + 1, hi); p.px(x + 1, y + 2, hi);
  } });
  // the core: a darker green with a little texture
  p.box(0, 16, 6, 6, 6, 0x5aa846, 0.1);
  p.speckle(0, 16, 24, 12, 0x4a9238, 0.25);
  p.speckle(0, 16, 24, 12, 0x6cbc56, 0.15);
  // eyes and mouth
  p.box(32, 0, 2, 2, 2, 0x163014, 0.05);
  p.box(32, 4, 2, 2, 2, 0x163014, 0.05);
  p.px(34, 2, 0x4a7a40); p.px(34, 6, 0x4a7a40);
  p.box(32, 8, 1, 1, 1, 0x1e3a1a, 0.05);
});

// a class per size, so the round shadow under it grows with it (the manager reads SHADOW off the class)
function sized(base, n) {
  if (!Object.prototype.hasOwnProperty.call(base, '_sized')) base._sized = {};
  let c = base._sized[n];
  if (!c) { c = class extends base {}; c.SHADOW = base.SHADOW * n; base._sized[n] = c; }
  return c;
}
// the moon's brightness, by phase (full moon first)
const MOON = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];
/* A slime chunk: the game's test, a Java Random seeded from the world seed
   and the chunk's coordinates, whose first nextInt(10) is 0. */
const slimeCache = new Map();
export function isSlimeChunk(seed, cx, cz) {
  const k = seed + ':' + cx + ',' + cz;
  let v = slimeCache.get(k);
  if (v !== undefined) return v;
  const a = Math.imul(Math.imul(cx, cx), 4987142), b = Math.imul(cx, 5947611), d = Math.imul(cz, 389711);
  let s = (BigInt(seed | 0) + BigInt(a) + BigInt(b) + BigInt(Math.imul(cz, cz)) * 4392871n + BigInt(d)) ^ 987234911n;
  const MASK = (1n << 48n) - 1n;
  s = (s ^ 0x5DEECE66Dn) & MASK;
  const next = () => { s = (s * 0x5DEECE66Dn + 0xBn) & MASK; return Number(s >> 17n); };
  let u = next(), r = u % 10;
  while (u - r + 9 > 2147483647) { u = next(); r = u % 10; }
  v = r === 0;
  if (slimeCache.size > 4096) slimeCache.clear();
  slimeCache.set(k, v);
  return v;
}

export class Slime extends Monster {
  static W = 0.52; static H = 0.52; static HEALTH = 1; static SPEED = 0.3; static FOLLOW = 16;
  static MODEL = 'slime'; static TEX = 'slime'; static SHADOW = 0.25; static XP = 1;
  constructor(m, type) {
    super(m, type);
    this.squish = 0; this.oSquish = 0; this.targetSquish = 0;
    this.hopT = 0; this.wantYaw = this.yaw; this.wantSpeed = 1; this.wantMove = false; this.hopNow = false; this.slimeAggro = false;
    this.wasOnGround = false;
    this.setSize(1, true);
  }
  setSize(n, heal) {
    this.size = n;
    this.w = this.h = 0.52 * n; this.hw = this.w / 2;
    this.maxHealth = n * n; if (heal) this.health = this.maxHealth;
    this.speed = 0.2 + 0.1 * n;
    this.attackDamage = n;
    this.constructor = sized(Object.getPrototypeOf(this).constructor, n);
  }
  get eyeH() { return 0.625 * this.h; }
  get xp() { return this.size; }
  registerGoals() {
    this.goals.add(1, new SlimeFloat(this));
    this.goals.add(2, new SlimeAttack(this));
    this.goals.add(3, new SlimeWander(this));
    this.goals.add(5, new SlimeHop(this));
    this.targets.add(1, new NearestPlayerTargetGoal(this, true, p => Math.abs(p.pos.y - this.pos.y) <= 4));
  }
  // natural spawns: size 1, 2 or 4 alike, smaller if the big one would not fit
  finalizeSpawn(o) {
    let n = o && o.size ? o.size : 1 << RI(3);
    const T = this.m.t, p = this.pos;
    while (n > 1) {
      const hw = 0.26 * n;
      if (!T.boxHits(p.x - hw, p.y, p.z - hw, p.x + hw, p.y + 0.52 * n, p.z + hw)) break;
      n >>= 1;
    }
    this.setSize(n, true);
  }
  // the ways the goals steer it
  slimeDir(yaw, aggressive) { this.wantYaw = yaw; this.slimeAggro = aggressive; }
  slimeWant(speed) { this.wantSpeed = speed; this.wantMove = true; }
  /* The hop: on the ground it waits out its delay without moving, then
     jumps forward; in the air it keeps pushing on at full speed. Its body
     and face always point the way it is going (90 degrees a tick at most). */
  moveControl() {
    this.yaw = rotTowards(this.yaw, this.wantYaw, 90 * DEG);
    // (the body and face come round after it, in bodyControl)
    let jump = false;
    if (this.wantMove) {
      this.wantMove = false;
      const sp = this.wantSpeed * this.speed;
      if (this.onGround) {
        if (this.hopT-- <= 0) {
          this.hopT = this.hopDelay();
          if (this.slimeAggro) this.hopT = Math.floor(this.hopT / 3);
          jump = true; this.moveSpeedNow = sp; this.zza = sp;
        } else { this.zza = 0; this.xxa = 0; this.moveSpeedNow = 0; }
      } else { this.moveSpeedNow = sp; this.zza = sp; }
    } else this.zza = 0;
    if (this.hopNow) { jump = true; this.hopNow = false; }
    this.jumping = jump;
  }
  // ticks between hops (a magma cube waits four times as long)
  hopDelay() { return 10 + RI(20); }
  lookControl() {}
  bodyControl() { this.followYaw(); }
  // turning towards its target, 10 degrees a tick
  turnTo(t) { this.yaw = rotTowards(this.yaw, yawTo(t.pos.x - this.pos.x, t.pos.z - this.pos.z), 10 * DEG); }
  tick() {
    this.oSquish = this.squish;
    this.squish += (this.targetSquish - this.squish) * 0.5;
    super.tick();
    if (this.removed) return;
    if (this.onGround && !this.wasOnGround) {
      // landing: it squashes, and splashes bits of slime about
      const n = this.size * 8;
      for (let j = 0; j < n; j++) {
        const a = R() * PI * 2, f = R() * 0.5 + 0.5;
        puff(this, 'slime', this.pos.x + Math.sin(a) * this.size * 0.5 * f, this.pos.y + 0.05, this.pos.z + Math.cos(a) * this.size * 0.5 * f, 1, 0, [0.45, 0.78, 0.35]);
      }
      this.targetSquish = -0.5;
    } else if (!this.onGround && this.wasOnGround) this.targetSquish = 1;
    this.wasOnGround = this.onGround;
    this.targetSquish *= 0.6;
  }
  aiStep() {
    super.aiStep();
    // the bigger ones hurt you by touching you
    if (this.dead || this.size < 2) return;
    const P = this.m.player, pp = P.pos, p = this.pos;
    if (!P.alive() || P.creative()) return;
    // the player's box grown by 1 across and 0.5 up and down, against ours
    if (pp.x + 1.3 < p.x - this.hw || pp.x - 1.3 > p.x + this.hw || pp.z + 1.3 < p.z - this.hw || pp.z - 1.3 > p.z + this.hw) return;
    if (pp.y - 0.5 > p.y + this.h || pp.y + 2.3 < p.y) return;
    const r = 0.6 * this.size;
    if (this.dist2(pp.x, pp.y, pp.z) < r * r && this.canSee(P)) this.doHurtTarget(P);
  }
  // dead: on the last tick of falling over, 2 to 4 smaller ones
  remove() {
    if (this.dead && !this.split && this.size > 1) {
      this.split = true;
      const n = 2 + RI(3), k = this.size / 2, f = this.size / 4;
      for (let l = 0; l < n; l++) {
        const ox = ((l % 2) - 0.5) * f, oz = (Math.floor(l / 2) - 0.5) * f;
        const c = this.m.spawn(this.type, this.pos.x + ox, this.pos.y + 0.5, this.pos.z + oz, { natural: false, yaw: R() * PI * 2 });
        if (!c) continue;
        c.setSize(k, true);
        if (this.persistent) c.persistent = true;
      }
    }
    super.remove();
  }
  loot(drop, byPlayer, L) { if (this.size === 1) drop('slime_ball', RI(3) + looted(L)); }
  rootPose(root, t, a) {
    const sq = this.oSquish + (this.squish - this.oSquish) * a;
    const f2 = sq / (this.size * 0.5 + 1), f3 = 1 / (f2 + 1);
    root.multiply(t.makeScale(f3 * this.size, this.size / f3, f3 * this.size));
  }
  /* Spawning: in a slime chunk below y 40 (one try in ten, any light), or in
     a swamp between y 51 and 69, half the time, as often as the moon is
     bright, in light no more than a random 0 to 7. */
  static checkSpawn(S, x, y, z) {
    const m = S.m;
    if (m.difficulty === 'peaceful' || !S.onGround(this, x, y, z)) return false;
    const wy = y + Y0, b = S.biome(x, z);
    if ((b === 'swamp' || b === 'mangrove_swamp') && wy > 50 && wy < 70 && R() < 0.5 &&
      R() < MOON[Math.floor(m.time / 24000) % 8] && m.rawBrightness(x, y, z) <= RI(8)) return true;
    return wy < 40 && RI(10) === 0 && isSlimeChunk(m.seed, Math.floor(x / 16), Math.floor(z / 16));
  }
  toJSON() { const o = super.toJSON(); o.sz = this.size; return o; }
  fromJSON(o) { super.fromJSON(o); const h = this.health; this.setSize(o.sz || 1, false); this.health = Math.min(h, this.maxHealth); }
}
register('slime', Slime);
class SlimeFloat extends Goal {
  constructor(mob) { super(mob, JUMP | MOVE); }
  canUse() { return this.mob.inWater || this.mob.inLava; }
  tick() { const s = this.mob; if (R() < 0.8) s.hopNow = true; s.slimeWant(1.2); }
}
class SlimeAttack extends Goal {
  constructor(mob) { super(mob, LOOK); }
  canUse() { const t = this.mob.target; return !!t && t.alive() && !(t.isPlayer && t.creative()); }
  start() { this.tired = 300; }
  canContinue() { return this.canUse() && --this.tired > 0; }
  tick() { const s = this.mob; s.turnTo(s.target); s.slimeDir(s.yaw, s.size > 1); }
}
class SlimeWander extends Goal {
  constructor(mob) { super(mob, LOOK); this.t = 0; this.yaw = 0; }
  canUse() { const s = this.mob; return !s.target && (s.onGround || s.inWater || s.inLava); }
  tick() {
    if (--this.t <= 0) { this.t = 40 + RI(60); this.yaw = RI(360) * DEG; }
    this.mob.slimeDir(this.yaw, false);
  }
}
class SlimeHop extends Goal {
  constructor(mob) { super(mob, JUMP | MOVE); }
  canUse() { return !this.mob.vehicle; }
  tick() { this.mob.slimeWant(1); }
}

/* ===========================================================================
   WITCH
   26 health, speed 0.25. From up to 10 blocks it throws a splash potion
   every 60 ticks: slowness at a target 8 or more blocks off that is not
   slowed, else poison at one with 8 or more health that is not poisoned,
   else (a quarter of the time, within 3 blocks) weakness, else harming.
   It drinks when it needs to: water breathing under water, fire resistance
   when burning, healing when hurt (5% a tick), swiftness when its target is
   more than 11 blocks off; drinking takes 32 ticks and it stands still.
   Magic does it only 15% of the damage, and its own potions none.
=========================================================================== */
const POTION_RGB = { healing: 0xf82423, swiftness: 0x33ebff, fire_resistance: 0xff9900, water_breathing: 0x98dac0 };
// the bottle at its mouth while it drinks: on the head bone (index 0), tinted to the potion
model('witch_bottle', [
  { name: 'head', boxes: [[-1, -1, -8.5, 2, 3, 2, 0, 0, 0, false, true], [-0.5, -2, -8, 1, 1, 1, 12, 0, 0, false, false]] },
]);
addArt('witch_bottle', [64, 32], p => {
  p.box(0, 0, 2, 3, 2, { all: (x, y, w, h) => { p.fill(x, y, w, h, 0xf2f2f2, 0.06); p.px(x, y, 0xffffff); } }, 0.06);
  p.box(12, 0, 1, 2, 1, 0xd8e0e0, 0.08);     // the neck
  p.px(13, 0, 0xb8885a);                     // and its cork
});

export class Witch extends Monster {
  static W = 0.6; static H = 1.95; static HEALTH = 26; static SPEED = 0.25; static FOLLOW = 16;
  static MODEL = 'witch'; static TEX = 'witch'; static SHADOW = 0.5; static XP = 5;
  constructor(m, type) {
    super(m, type);
    this.drinkT = 0; this.drink = null;
    this.fx = {};                 // its own effects: name -> ticks left
    this.lastDmg = null; this.lastDmgAge = -1000;
  }
  get eyeH() { return 1.62; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(2, new RangedAttackGoal(this, 1, 60, 10));
    this.goals.add(2, new StrollGoal(this, 1));
    this.goals.add(3, new LookAtPlayerGoal(this, 8));
    this.goals.add(3, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(3, new NearestPlayerTargetGoal(this, true));
  }
  baseTick() {
    super.baseTick();
    if (this.fx.water_breathing > 0) this.air = 300;
  }
  aiStep() {
    for (const k in this.fx) if (--this.fx[k] <= 0) delete this.fx[k];
    if (!this.dead) {
      if (this.drinkT > 0) {
        if (--this.drinkT <= 0) {
          const d = this.drink;
          this.drink = null;
          if (d === 'healing') this.heal(4);
          else if (d) this.fx[d] = 3600;
        }
      } else {
        let d = null;
        if (R() < 0.15 && this.eyeInWater && !this.fx.water_breathing) d = 'water_breathing';
        else if (R() < 0.15 && (this.fire > 0 || (this.lastDmg === 'fire' || this.lastDmg === 'lava') && this.age - this.lastDmgAge < 40) && !this.fx.fire_resistance) d = 'fire_resistance';
        else if (R() < 0.05 && this.health < this.maxHealth) d = 'healing';
        else if (R() < 0.5 && this.target && !this.fx.swiftness && this.dist2(this.target.pos.x, this.target.pos.y, this.target.pos.z) > 121) d = 'swiftness';
        if (d) { this.drink = d; this.drinkT = 32; }
      }
      // standing still while it drinks, a fifth faster on swiftness
      this.speed = this.drinkT > 0 ? 0 : 0.25 * (this.fx.swiftness ? 1.2 : 1);
      // now and then, a few purple sparks over its hat
      if (R() < 7.5e-4) {
        const n = 10 + RI(35);
        for (let i = 0; i < n; i++) puff(this, 'sparkle', this.pos.x + gauss() * 0.13, this.pos.y + this.h + 0.5 + gauss() * 0.13, this.pos.z + gauss() * 0.13, 1, 0, [0.62, 0.22, 0.78]);
      }
    }
    super.aiStep();
  }
  hurt(amount, source) {
    if (source.type === 'magic') {
      if (source.attacker === this) return false;
      amount *= 0.15;
    }
    if ((source.type === 'fire' || source.type === 'lava') && this.fx.fire_resistance) return false;
    return super.hurt(amount, source);
  }
  onHurt(amount, source) { super.onHurt(amount, source); this.lastDmg = source.type; this.lastDmgAge = this.age; }
  // the effects the target already has
  hasEffect(t, name) { return t.isPlayer ? (this.m.effects[name] || 0) > 0 : !!(t.fx && t.fx[name] > 0); }
  /* The throw: at where the target will be next tick, a fifth of the
     distance above its eyes less 1.1, at 0.75 blocks a tick, spread 8. */
  throwAt(t) {
    if (this.drinkT > 0) return;
    const v = t.vel || { x: 0, z: 0 };
    const dx = t.pos.x + v.x - this.pos.x, dy = t.pos.y + (t.eyeH || 1.62) - 1.1 - this.pos.y, dz = t.pos.z + v.z - this.pos.z;
    const hd = Math.hypot(dx, dz);
    const hp = t.isPlayer ? this.m.survival.health : t.health;
    let kind = 'harming';
    if (hd >= 8 && !this.hasEffect(t, 'slowness')) kind = 'slowness';
    else if (hp >= 8 && !this.hasEffect(t, 'poison')) kind = 'poison';
    else if (hd <= 3 && !this.hasEffect(t, 'weakness') && R() < 0.25) kind = 'weakness';
    const e = this.m.spawn('potion', this.pos.x, this.pos.y + this.eyeH - 0.1, this.pos.z, { natural: false });
    if (!e) return;
    e.kind = kind; e.owner = this;
    e.shoot(dx, dy + hd * 0.2, dz, 0.75, 8);
    this.thrown = (this.thrown || 0) + 1; this.lastThrow = kind;
  }
  /* Its loot: 4 to 8 redstone, and 1 to 3 rolls of 0 to 2 of a glass bottle,
     glowstone dust, gunpowder, a spider eye, sugar or sticks (twice as
     likely); killed while drinking, the potion 8.5% of the time. */
  loot(drop, byPlayer, L) {
    drop('redstone', between(4, 8) + looted(L));
    const pool = ['glass_bottle', 'glowstone_dust', 'gunpowder', 'spider_eye', 'sugar', 'stick', 'stick'];
    for (let i = 0, n = between(1, 3); i < n; i++) drop(pool[RI(pool.length)], RI(3) + looted(L));
    if (this.drinkT > 0 && this.drink && R() < 0.085 + 0.01 * L) drop('potion', 1);
  }
  anim(A) { A.drinking = this.drinkT > 0; }
  layers(out) { if (this.drinkT > 0 && this.drink) out.push(['witch_bottle', 'witch_bottle', POTION_RGB[this.drink] || 0xffffff]); }
}
register('witch', Witch);
/* ---- a ranged attack: in range and seen for 5 ticks it stands; a throw
   every interval ticks; otherwise it walks nearer ---- */
class RangedAttackGoal extends Goal {
  constructor(mob, speed, interval, radius) { super(mob, MOVE | LOOK); this.speed = speed; this.interval = interval; this.r2 = radius * radius; }
  canUse() { const t = this.mob.target; return !!t && t.alive() && !(t.isPlayer && t.creative()); }
  canContinue() { return this.canUse() || !this.mob.nav.isDone(); }
  start() { this.seen = 0; this.attackT = -1; this.mob.aggressive = true; }
  stop() { this.seen = 0; this.attackT = -1; this.mob.aggressive = false; this.mob.nav.stop(); }
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z), sees = m.canSee(t);
    this.seen = sees ? this.seen + 1 : 0;
    if (d2 <= this.r2 && this.seen >= 5) m.nav.stop();
    else if (m.age % 10 === 0 || m.nav.isDone()) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, this.speed, 1);
    m.lookAtEntity(t, 30, 30);
    if (--this.attackT === 0) {
      if (!sees) return;
      m.throwAt(t);
      this.attackT = this.interval;
    } else if (this.attackT < 0) this.attackT = this.interval;
  }
}

/* ===========================================================================
   SQUID and GLOW SQUID
   10 health, 0.8 a side. A squid sets itself a heading now and then (one
   chance in 50 a tick) and swims in pulses: the tentacles spread and close
   over a stroke, it surges at the end of each and slows between. Hit, it
   squirts ink and swims off; out of water it flops about and dries out.
   1 to 3 ink sacs. The glow squid lives in the dark deep down, shines
   (no light on the world, but drawn fully lit), and goes dark for 5
   seconds when hurt.
=========================================================================== */
const squidParts = () => {
  const parts = [{ name: 'body', pivot: [0, 8, 0], boxes: [[-6, -8, -6, 12, 16, 12, 0, 0]] }];
  for (let j = 0; j < 8; j++) {
    const a = j * PI * 2 / 8;
    parts.push({ name: 't' + j, pivot: [Math.cos(a) * 5, 15, Math.sin(a) * 5], rot: [0, j * PI * -2 / 8 + PI / 2, 0], boxes: [[-1, 0, -1, 2, 18, 2, 48, 0]] });
  }
  return parts;
};
model('squid', squidParts(), (m, P, A) => { for (let j = 1; j <= 8; j++) set(P, j, RX, A.tentacle || 0); });
function squidArt(p, body, dark, light, eye, tent, tip) {
  p.box(0, 0, 12, 16, 12, body, 0.08);
  p.speckle(0, 0, 48, 28, dark, 0.22);
  p.speckle(0, 0, 48, 28, light, 0.1);
  // the top: a darker crown; the underside: the mouth among the arms
  p.fill(12, 0, 12, 12, dark, 0.1); p.speckle(12, 0, 12, 12, body, 0.3);
  p.fill(24, 0, 12, 12, p.shade(body, 0.8), 0.1);
  p.fill(28, 4, 4, 4, 0x2a1a1a, 0.08); p.fill(29, 5, 2, 2, 0x8a6a5a, 0.05);
  // eyes low down on the front and the back
  for (const fx of [12, 36]) {
    const fy = 12 + 10;
    p.fill(fx + 2, fy, 2, 2, eye, 0.02); p.fill(fx + 8, fy, 2, 2, eye, 0.02);
    p.px(fx + 3, fy + 1, 0x101010); p.px(fx + 8, fy + 1, 0x101010);
  }
  // darker bands down the sides
  for (const fx of [0, 24]) for (let y = 12; y < 28; y += 4) p.fill(fx + 1, y, 10, 1, dark, 0.1);
  // arms: suckers down the inside, a pale tip
  p.box(48, 0, 2, 18, 2, tent, 0.1);
  p.speckle(48, 2, 8, 18, light, 0.3);
  p.fill(48, 16, 8, 4, tip, 0.1);
}
addArt('squid', [64, 32], p => squidArt(p, 0x2a4462, 0x1c3048, 0x47648a, 0xe8e8e8, 0x2e4a68, 0x5a7aa0));
addArt('glow_squid', [64, 32], p => {
  squidArt(p, 0x0f4652, 0x08303a, 0x2a8a8a, 0xb6fff2, 0x0f4a56, 0x7ff8e6);
  // glowing spots and streaks
  p.speckle(0, 12, 48, 16, 0x6ff4dc, 0.12, 0.08);
  for (const fx of [0, 12, 24, 36]) { p.fill(fx + 5, 13, 2, 10, 0x5fe6d0, 0.1); p.px(fx + 2, 15, 0x9ffff0); p.px(fx + 9, 18, 0x9ffff0); }
  p.speckle(12, 0, 12, 12, 0x6ff4dc, 0.2, 0.08);
  p.speckle(48, 2, 8, 18, 0x7ff8e6, 0.25, 0.06);
});

export class Squid extends Mob {
  static W = 0.8; static H = 0.8; static HEALTH = 10; static SPEED = 0.7;
  static MODEL = 'squid'; static TEX = 'squid'; static SHADOW = 0.7; static CATEGORY = 'water_creature';
  static WATER_BREATHER = 'only'; static FLIP = 1e-9;    // a squid does not fall over when it dies
  constructor(m, type) {
    super(m, type);
    this.xBody = 0; this.oxBody = 0; this.zBody = 0; this.ozBody = 0;
    this.tentMove = 0; this.oTentMove = 0; this.tentAngle = 0; this.oTentAngle = 0;
    this.tentSpeed = 1 / (R() + 1) * 0.2;
    this.swimSp = 0; this.rotSp = 0;
    this.tx = 0; this.ty = 0; this.tz = 0;
  }
  get eyeH() { return this.h * 0.5; }
  get xp() { return 1 + RI(3); }
  registerGoals() {
    this.goals.add(0, new SquidMoveGoal(this));
    this.goals.add(1, new SquidFleeGoal(this));
  }
  setMove(x, y, z) { this.tx = x; this.ty = y; this.tz = z; }
  hasMove() { return this.tx * this.tx + this.ty * this.ty + this.tz * this.tz > 1e-5; }
  moveControl() {} lookControl() {} bodyControl() {}
  // it moves by its velocity alone (set each tick below)
  travel() { this.move(this.vel.x, this.vel.y, this.vel.z); }
  aiStep() {
    super.aiStep();
    this.swimTick();
  }
  swimTick() {
    this.oxBody = this.xBody; this.ozBody = this.zBody; this.oTentMove = this.tentMove; this.oTentAngle = this.tentAngle;
    this.tentMove += this.tentSpeed;
    if (this.tentMove > PI * 2) { this.tentMove -= PI * 2; if (RI(10) === 0) this.tentSpeed = 1 / (R() + 1) * 0.2; }
    const v = this.vel;
    if (this.inWater) {
      if (this.tentMove < PI) {
        // the stroke: arms spread and close; the surge comes at the end of it
        const f = this.tentMove / PI;
        this.tentAngle = Math.sin(f * f * PI) * PI * 0.25;
        if (f > 0.75) { this.swimSp = 1; this.rotSp = 1; } else this.rotSp *= 0.8;
      } else { this.tentAngle = 0; this.swimSp *= 0.9; this.rotSp *= 0.99; }
      v.set(this.tx * this.swimSp, this.ty * this.swimSp, this.tz * this.swimSp);
      const hd = Math.hypot(v.x, v.z);
      if (hd > 1e-4) this.bodyYaw += wrap(yawTo(v.x, v.z) - this.bodyYaw) * 0.1;
      this.yaw = this.headYaw = this.bodyYaw;
      this.zBody += PI * this.rotSp * 1.5 * DEG;
      this.xBody += (-Math.atan2(hd, v.y) - this.xBody) * 0.1;
    } else {
      // on land: the arms flail, it falls and lies down
      this.tentAngle = Math.abs(Math.sin(this.tentMove)) * PI * 0.25;
      v.set(0, (v.y - 0.08) * 0.98, 0);
      this.xBody += (-PI / 2 - this.xBody) * 0.02;
    }
  }
  deadTick() { this.swimTick(); super.deadTick(); }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    if (source.attacker) this.ink();
  }
  // a cloud of ink out of its underside
  ink() {
    const a = this.xBody, b = this.yaw;
    // a direction in the squid's own frame, turned as its body is
    const turn = (x, y, z) => {
      const ca = Math.cos(-a), sa = Math.sin(-a);
      const y1 = y * ca - z * sa, z1 = y * sa + z * ca;
      const cb = Math.cos(b + PI), sb = Math.sin(b + PI);
      return [x * cb + z1 * sb, y1, -x * sb + z1 * cb];
    };
    const o = turn(0, -1, 0), col = this.inkColour(), glow = this.constructor.GLOWS ? 1 : undefined;
    for (let i = 0; i < 30; i++) {
      const d = turn(R() * 0.6 - 0.3, -1, R() * 0.6 - 0.3), s = (0.3 + R() * 2) * 0.1;
      particleV(this, 'smoke', this.pos.x + o[0] * 0.5, this.pos.y + 0.5 + o[1] * 0.5, this.pos.z + o[2] * 0.5, d[0] * s, d[1] * s, d[2] * s, col, glow);
    }
  }
  inkColour() { return [0.06, 0.06, 0.09]; }
  loot(drop, byPlayer, L) { drop('ink_sac', between(1, 3) + looted(L)); }
  anim(A, a) { A.tentacle = this.oTentAngle + (this.tentAngle - this.oTentAngle) * a; }
  rootPose(root, t, a) {
    const xb = this.oxBody + (this.xBody - this.oxBody) * a, zb = this.ozBody + (this.zBody - this.ozBody) * a;
    root.multiply(t.makeTranslation(0, 0.5, 0));
    root.multiply(t.makeRotationX(-xb));
    root.multiply(t.makeRotationY(zb));
    root.multiply(t.makeTranslation(0, -1.2, 0));
  }
  // between y 50 and the sea's surface, in water with water above and below
  static checkSpawn(S, x, y, z) {
    const T = S.m.t, wy = y + Y0;
    if (wy < 50 || wy > 63) return false;
    return FLUID[T.get(x, y, z)] === 1 && FLUID[T.get(x, y - 1, z)] === 1 && T.get(x, y + 1, z) === tables().water;
  }
}
register('squid', Squid);
export class GlowSquid extends Squid {
  static TEX = 'glow_squid'; static CATEGORY = 'underground_water_creature'; static GLOWS = true; static BRIGHT = true;
  constructor(m, type) { super(m, type); this.darkT = 0; if (this.realB === undefined) this.realB = 0; }
  /* drawn fully lit: the block light the manager samples is replaced by 15,
     except for the 5 seconds after a hit (fading back over the last half second) */
  get lightB() { const k = Math.max(0, Math.min(1, 1 - (this.darkT || 0) / 10)); return k >= 1 ? 15 : Math.max(Math.floor(15 * k), this.realB || 0); }
  set lightB(v) { this.realB = v; }
  aiStep() {
    super.aiStep();
    if (this.darkT > 0) this.darkT--;
    if (!this.dead && this.age % 2 === 0 && this.darkT <= 0) puff(this, 'sparkle', this.pos.x + (R() - 0.5) * 0.6, this.pos.y + R() * this.h, this.pos.z + (R() - 0.5) * 0.6, 1, 0, [0.45, 1, 0.9]);
  }
  onHurt(amount, source) { super.onHurt(amount, source); this.darkT = 100; }
  inkColour() { return [0.12, 0.62, 0.58]; }
  loot(drop, byPlayer, L) { drop('glow_ink_sac', between(1, 3) + looted(L)); }
  // below y 30, in water, where neither the sky nor a block gives any light
  static checkSpawn(S, x, y, z) {
    const T = S.m.t;
    if (y + Y0 > 30) return false;
    return T.get(x, y, z) === tables().water && T.sky(x, y, z) === 0 && T.block(x, y, z) === 0;
  }
}
register('glow_squid', GlowSquid);
/* ---- a new heading now and then (none when nobody is near) ---- */
class SquidMoveGoal extends Goal {
  constructor(mob) { super(mob, 0); }
  canUse() { return true; }
  canContinue() { return true; }
  tick() {
    const s = this.mob;
    if (s.noActionTime > 100) s.setMove(0, 0, 0);
    else if (RI(50) === 0 || !s.inWater || !s.hasMove()) {
      const a = R() * PI * 2;
      s.setMove(Math.cos(a) * 0.2, -0.1 + R() * 0.2, Math.sin(a) * 0.2);
    }
  }
}
/* ---- hurt by something within 10 blocks: straight away from it, faster the nearer it is ---- */
class SquidFleeGoal extends Goal {
  constructor(mob) { super(mob, 0); }
  canUse() { const s = this.mob, a = s.lastHurtBy; return s.inWater && !!a && s.dist2(a.pos.x, a.pos.y, a.pos.z) < 100; }
  start() { this.t = 0; }
  tick() {
    const s = this.mob, a = s.lastHurtBy, T = s.m.t;
    if (!a) return;
    this.t++;
    let vx = s.pos.x - a.pos.x, vy = s.pos.y - a.pos.y, vz = s.pos.z - a.pos.z;
    const b = T.get(Math.floor(s.pos.x + vx), Math.floor(s.pos.y + vy), Math.floor(s.pos.z + vz));
    if (FLUID[b] === 1 || !b) {
      const d = Math.hypot(vx, vy, vz);
      if (d > 0) {
        let k = 3;
        if (d > 5) k -= (d - 5) / 5;
        if (k > 0) { vx = vx / d * k; vy = vy / d * k; vz = vz / d * k; }
      }
      if (!b) vy = 0;
      s.setMove(vx / 20, vy / 20, vz / 20);
    }
    if (this.t % 10 === 5) puff(s, 'bubble', s.pos.x, s.pos.y + 0.4, s.pos.z, 1, 0);
  }
}

/* ===========================================================================
   FISH: cod, salmon, tropical fish, pufferfish
   3 health, speed 0.7. They swim to random spots within 10 blocks (a try
   one tick in 40), flee a player who comes within 8 blocks, dart about for
   a few seconds when hit, and (all but the pufferfish) swim in schools: a
   fish with no school joins one within 8 blocks or starts its own, and
   followers keep after their leader. On land they flop and dry out (the
   first 2 damage after 16 seconds). They go away when more than 64 blocks
   from the player. Each drops itself (cooked when it burned) and 5% of the
   time bone meal.
=========================================================================== */
// a random water cell within h across and v up and down (on the far side from a point, if given)
function waterPos(mob, h, v, from) {
  const T = mob.m.t;
  const ax = from ? mob.pos.x - from.x : 0, az = from ? mob.pos.z - from.z : 0;
  for (let i = 0; i < 10; i++) {
    let dx = RI(2 * h + 1) - h, dz = RI(2 * h + 1) - h;
    const dy = RI(2 * v + 1) - v;
    if (from && dx * ax + dz * az < 0) { dx = -dx; dz = -dz; }
    const x = Math.floor(mob.pos.x) + dx, y = Math.floor(mob.pos.y) + dy, z = Math.floor(mob.pos.z) + dz;
    if (T.loaded(x, z) && FLUID[T.get(x, y, z)] === 1) return [x + 0.5, y + 0.35, z + 0.5];
  }
  return null;
}
// the last pack the spawner made, so the rest of it joins the first fish (and shares its colours)
let lastPack = null;

export class Fish extends Mob {
  static HEALTH = 3; static SPEED = 0.7; static CATEGORY = 'water_ambient'; static WATER_BREATHER = 'only'; static DESPAWN = 64;
  static SHADOW = 0.3; static SCHOOL = 8;
  constructor(m, type) {
    super(m, type);
    this.want = null;             // where it is swimming to: [x, y, z, speed]
    this.swimSpeed = 0;
    this.leader = null; this.followers = 0;
  }
  get eyeH() { return this.h * 0.65; }
  get xp() { return 1 + RI(3); }
  registerGoals() {
    this.goals.add(0, new FishPanicGoal(this, 1.25));
    this.goals.add(2, new FishAvoidGoal(this, 8, 1.6, 1.4));
    this.goals.add(4, new FishSwimGoal(this, 1, 40));
    if (this.constructor.SCHOOL) this.goals.add(5, new FollowLeaderGoal(this));
  }
  finalizeSpawn(o) {
    const m = this.m;
    if (o && o.group > 0 && lastPack && lastPack.type === this.type && lastPack.age === m.age && !lastPack.fish.removed && lastPack.fish.distTo(this) < 16) {
      this.joinPack(lastPack.fish);
      if (this.constructor.SCHOOL && !lastPack.fish.leader && lastPack.fish.followers + 1 < this.constructor.SCHOOL) this.follow(lastPack.fish);
    } else {
      this.newPack();
      lastPack = { type: this.type, age: m.age, fish: this };
    }
  }
  newPack() {}
  joinPack() {}
  // the swim goals' way of steering
  swimTo(x, y, z, speed) { if (this.want) { this.want[0] = x; this.want[1] = y; this.want[2] = z; this.want[3] = speed; } else this.want = [x, y, z, speed]; }
  swimStop() { this.want = null; }
  follow(l) { if (this.leader) this.unfollow(); this.leader = l; l.followers++; }
  unfollow() { if (this.leader) { this.leader.followers = Math.max(0, this.leader.followers - 1); this.leader = null; } }
  /* The fish's own move control: rising gently while its eyes are under, the
     speed eased towards what it wants, up and down by the slope to the
     spot, turning 90 degrees a tick to face it. */
  moveControl() {
    const v = this.vel, w = this.want;
    if (this.eyeInWater) v.y += 0.005;
    if (w && this.inWater) {
      this.swimSpeed = lerp(this.swimSpeed, w[3] * this.speed, 0.125);
      const dx = w[0] - this.pos.x, dy = w[1] - this.pos.y, dz = w[2] - this.pos.z, d = Math.hypot(dx, dy, dz);
      if (d > 1e-6 && dy !== 0) v.y += this.swimSpeed * (dy / d) * 0.1;
      if (dx !== 0 || dz !== 0) this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 90 * DEG);
      this.zza = this.swimSpeed;
      if (d < 0.5) this.want = null;
    } else { this.swimSpeed = 0; this.zza = 0; }
  }
  // ticks between hops (a magma cube waits four times as long)
  hopDelay() { return 10 + RI(20); }
  lookControl() {}
  bodyControl() { this.followYaw(); }
  travel() {
    if (this.inWater) {
      this.moveRelative(0.01, this.xxa, this.zza);
      this.move(this.vel.x, this.vel.y, this.vel.z);
      this.vel.multiplyScalar(0.9);
      if (!this.target) this.vel.y -= 0.005;
    } else super.travel();
  }
  aiStep() {
    // on land: a flop, every time it comes down
    if (!this.dead && !this.inWater && this.onGround && this.vCollide) {
      this.vel.x += (R() * 2 - 1) * 0.05; this.vel.y += 0.4; this.vel.z += (R() * 2 - 1) * 0.05;
      this.onGround = false;
    }
    super.aiStep();
    // a leader counts its school again now and then (followers die and wander off)
    if (this.followers > 0 && RI(200) === 1) {
      let n = 0;
      this.m.forNear(this.pos.x, this.pos.z, 12, e => { if (e.leader === this && !e.removed && !e.dead) n++; });
      this.followers = n;
    }
  }
  remove() { this.unfollow(); super.remove(); }
  die(source) { this.unfollow(); super.die(source); }
  // the fish's name, and what it drops
  item() { return this.type; }
  loot(drop) {
    const it = this.item();
    drop(this.fire > 0 && (it === 'cod' || it === 'salmon') ? 'cooked_' + it : it, 1);
    if (R() < 0.05) drop('bone_meal', 1);
  }
  anim(A) { A.fishOut = this.inWater ? 0 : 1; }
  // swimming, the body wags; on land it lies on its side
  rootPose(root, t, a, A) {
    root.multiply(t.makeRotationY(4.3 * DEG * Math.sin(0.6 * A.age)));
    if (!this.inWater) { root.multiply(t.makeTranslation(-0.1, 0.1, 0.1)); root.multiply(t.makeRotationZ(-PI / 2)); }
  }
  // between y 50 and the sea's surface, in water with water above and below
  static checkSpawn(S, x, y, z) { return Squid.checkSpawn(S, x, y, z); }
}
class FishSwimGoal extends SwimGoal {
  canUse() { return !this.mob.leader && super.canUse(); }
}
/* ---- hit: off to random water nearby, a quarter faster, for as long as it remembers the hit ---- */
class FishPanicGoal extends Goal {
  constructor(mob, speed) { super(mob, MOVE); this.speed = speed; }
  canUse() {
    const f = this.mob;
    if (!(f.lastHurtBy || f.fire > 0) || !f.inWater) return false;
    this.p = waterPos(f, 5, 4);
    return !!this.p;
  }
  start() { this.t = 0; this.mob.swimTo(this.p[0], this.p[1], this.p[2], this.speed); }
  canContinue() { return !!this.mob.want && this.t++ < 100; }
  stop() { this.mob.swimStop(); }
}
/* ---- a player within 8 blocks that it can see: away to somewhere further from them ---- */
class FishAvoidGoal extends Goal {
  constructor(mob, dist, walk, sprint) { super(mob, MOVE); this.dist = dist; this.walk = walk; this.sprint = sprint; }
  canUse() {
    const f = this.mob, P = f.m.player;
    if (!P.alive() || !f.inWater) return false;
    const d2 = f.dist2(P.pos.x, P.pos.y, P.pos.z);
    if (d2 > this.dist * this.dist || !f.canSee(P)) return false;
    const p = waterPos(f, 16, 7, P.pos);
    if (!p || (p[0] - P.pos.x) ** 2 + (p[1] - P.pos.y) ** 2 + (p[2] - P.pos.z) ** 2 < d2) return false;
    this.p = p;
    return true;
  }
  start() { this.t = 0; this.mob.swimTo(this.p[0], this.p[1], this.p[2], this.walk); }
  canContinue() { return !!this.mob.want && this.t++ < 200; }
  tick() {
    const f = this.mob, P = f.m.player;
    if (f.want) f.want[3] = f.dist2(P.pos.x, P.pos.y, P.pos.z) < 49 ? this.sprint : this.walk;
  }
  stop() { this.mob.swimStop(); }
}
/* ---- schooling: find (or found) a school, then keep near the leader ---- */
class FollowLeaderGoal extends Goal {
  constructor(mob) { super(mob, 0); this.next = 0; this.repath = 0; }
  canUse() {
    const f = this.mob, max = f.constructor.SCHOOL;
    if (f.followers > 0) return false;
    if (f.leader) return true;
    if (this.next > 0) { this.next--; return false; }
    this.next = 200 + RI(200) % 20;
    const near = f.m.near(f.pos.x, f.pos.y, f.pos.z, 8).filter(o => o.type === f.type && !o.dead && (o.followers > 0 && o.followers + 1 < max || !o.leader));
    const lead = near.find(o => o !== f && o.followers > 0 && o.followers + 1 < max) || f;
    for (const o of near) if (o !== lead && !o.leader && !(o.followers > 0) && lead.followers + 1 < max) o.follow(lead);
    return !!f.leader;
  }
  canContinue() { const f = this.mob, l = f.leader; return !!l && !l.removed && !l.dead && f.dist2(l.pos.x, l.pos.y, l.pos.z) <= 121; }
  start() { this.repath = 0; }
  stop() { this.mob.unfollow(); this.mob.swimStop(); }
  tick() {
    const f = this.mob, l = f.leader;
    if (--this.repath > 0) return;
    this.repath = 10;
    if (f.dist2(l.pos.x, l.pos.y, l.pos.z) > 2.5) f.swimTo(l.pos.x + (R() - 0.5) * 1.5, l.pos.y + (R() - 0.5) * 0.6, l.pos.z + (R() - 0.5) * 1.5, 1);
  }
}

/* ---- cod: 0.5 x 0.3 ---- */
model('cod', [
  { name: 'body', pivot: [0, 22, 0], boxes: [[-1, -2, 0, 2, 4, 7, 0, 0]] },
  { name: 'head', pivot: [0, 22, 0], boxes: [[-1, -2, -3, 2, 4, 3, 18, 0]] },
  { name: 'nose', pivot: [0, 22, -3], boxes: [[-1, -2, -1, 2, 3, 1, 28, 0]] },
  { name: 'rightFin', pivot: [-1, 23, 0], rot: [0, 0, -PI / 4], boxes: [[-2, 0, -1, 2, 0, 2, 0, 12]] },
  { name: 'leftFin', pivot: [1, 23, 0], rot: [0, 0, PI / 4], boxes: [[0, 0, -1, 2, 0, 2, 6, 12]] },
  { name: 'tail', pivot: [0, 22, 7], boxes: [[0, -2, 0, 0, 4, 4, 0, 16]] },
  { name: 'topFin', pivot: [0, 20, 0], boxes: [[0, -1, -1, 0, 1, 6, 12, 12]] },
], (m, P, A) => { set(P, m.index.tail, RY, -(A.fishOut ? 1.5 : 1) * 0.45 * Math.sin(0.6 * A.age)); });
addArt('cod', [64, 32], p => {
  const tan = 0xb39b6b, dark = 0x86704a, belly = 0xe2d6b6, fin = 0x9c8458;
  p.box(0, 0, 2, 4, 7, { all: tan, top: dark, bottom: belly }, 0.08);
  // the sides: speckled back, a pale line, a light belly
  for (const x of [0, 9]) { p.speckle(x, 7, 7, 2, dark, 0.45); p.fill(x, 9, 7, 1, 0xd2c49e, 0.05); p.fill(x, 10, 7, 1, belly, 0.05); }
  p.speckle(7, 0, 2, 7, 0x6c5a3a, 0.4);
  p.box(18, 0, 2, 4, 3, { all: tan, top: dark, bottom: belly }, 0.08);
  p.speckle(18, 3, 3, 2, dark, 0.4); p.speckle(23, 3, 3, 2, dark, 0.4);
  p.px(20, 4, 0x101010); p.px(23, 4, 0x101010);       // eyes, at the front of each side
  p.box(28, 0, 2, 3, 1, { all: 0x9c8458, bottom: belly }, 0.08);
  p.fill(29, 3, 2, 1, 0x5a4a32);                       // mouth
  p.box(0, 12, 2, 0, 2, fin, 0.1); p.box(6, 12, 2, 0, 2, fin, 0.1);
  p.box(0, 16, 0, 4, 4, fin, 0.1);
  p.fill(0, 20, 8, 1, 0x7a6644); p.fill(0, 23, 8, 1, 0x7a6644);
  p.box(12, 12, 0, 1, 6, fin, 0.1);
});
export class Cod extends Fish {
  static W = 0.5; static H = 0.3; static MODEL = 'cod'; static TEX = 'cod'; static SCHOOL = 8;
}
register('cod', Cod);

/* ---- salmon: three sizes (0.35, 0.7 and 1.05 long), schools of up to 7, swims up waterfalls ---- */
model('salmon', [
  { name: 'bodyFront', pivot: [0, 20, 0], boxes: [[-1.5, -2.5, 0, 3, 5, 8, 0, 0]] },
  { name: 'bodyBack', pivot: [0, 20, 8], boxes: [[-1.5, -2.5, 0, 3, 5, 8, 0, 14]] },
  { name: 'head', pivot: [0, 20, 0], boxes: [[-1, -2, -3, 2, 4, 3, 24, 0]] },
  { name: 'tail', parent: 'bodyBack', pivot: [0, 0, 8], boxes: [[0, -2.5, 0, 0, 5, 6, 24, 8]] },
  { name: 'topFrontFin', parent: 'bodyFront', pivot: [0, -4.5, 5], boxes: [[0, 0, 0, 0, 2, 3, 36, 0]] },
  { name: 'topBackFin', parent: 'bodyBack', pivot: [0, -4.5, -1], boxes: [[0, 0, 0, 0, 2, 4, 36, 6]] },
  { name: 'rightFin', pivot: [-1.5, 21.5, 0], rot: [0, 0, -PI / 4], boxes: [[-2, 0, 0, 2, 0, 2, 44, 0]] },
  { name: 'leftFin', pivot: [1.5, 21.5, 0], rot: [0, 0, PI / 4], boxes: [[0, 0, 0, 2, 0, 2, 44, 4]] },
], (m, P, A) => {
  const f = A.fishOut ? 1.3 : 1, g = A.fishOut ? 1.7 : 1;
  set(P, m.index.bodyBack, RY, -f * 0.25 * Math.sin(g * 0.6 * A.age));
});
addArt('salmon', [64, 32], p => {
  const red = 0xb4473b, dark = 0x7a2a24, belly = 0xe0a898, head = 0x56684e, fin = 0x8a3a30;
  for (const v of [0, 14]) {
    p.box(0, v, 3, 5, 8, { all: red, top: dark, bottom: belly }, 0.08);
    for (const x of [0, 11]) { p.speckle(x, v + 8, 8, 2, dark, 0.5); p.speckle(x, v + 10, 8, 1, 0x9a3a30, 0.4); p.fill(x, v + 12, 8, 1, belly, 0.06); }
    p.speckle(8, v, 3, 8, 0x5a1e1a, 0.4);
  }
  p.box(24, 0, 2, 4, 3, { all: head, bottom: 0xc8b8a0 }, 0.08);
  p.px(26, 4, 0x101010); p.px(29, 4, 0x101010);
  p.fill(26, 6, 2, 1, 0x2a2a20);
  p.box(24, 8, 0, 5, 6, fin, 0.1); p.speckle(24, 14, 12, 5, dark, 0.3);
  p.box(36, 0, 0, 2, 3, fin, 0.1); p.box(36, 6, 0, 2, 4, fin, 0.1);
  p.box(44, 0, 2, 0, 2, fin, 0.1); p.box(44, 4, 2, 0, 2, fin, 0.1);
});
const SALMON_SCALE = [0.5, 1, 1.5];
export class Salmon extends Fish {
  static W = 0.7; static H = 0.4; static MODEL = 'salmon'; static TEX = 'salmon'; static SHADOW = 0.4; static SCHOOL = 7;
  constructor(m, type) { super(m, type); this.setVariant(1); }
  setVariant(k) { this.variant = k; const s = SALMON_SCALE[k]; this.w = 0.7 * s; this.h = 0.4 * s; this.hw = this.w / 2; }
  // small, medium and large come 6 : 10 : 3, the whole pack alike
  newPack() { const r = RI(19); this.setVariant(r < 6 ? 0 : r < 16 ? 1 : 2); }
  joinPack(l) { this.setVariant(l.variant); }
  rootPose(root, t, a, A) {
    const s = SALMON_SCALE[this.variant] || 1;
    if (s !== 1) root.multiply(t.makeScale(s, s, s));
    const f = this.inWater ? 1 : 1.3, g = this.inWater ? 1 : 1.7;
    root.multiply(t.makeRotationY(f * 4.3 * DEG * Math.sin(g * 0.6 * A.age)));
    root.multiply(t.makeTranslation(0, 0, 0.4));
    if (!this.inWater) { root.multiply(t.makeTranslation(-0.2, 0.1, 0)); root.multiply(t.makeRotationZ(-PI / 2)); }
  }
  toJSON() { const o = super.toJSON(); o.sv = this.variant; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.sv !== undefined) this.setVariant(o.sv); }
}
register('salmon', Salmon);

/* ---- tropical fish: two shapes, six patterns each, a body and a pattern
   colour from the sixteen dyes. Nine schools in ten are one of the 22 named
   kinds; the rest are any mix. ---- */
const shapeA = inf => [
  { name: 'body', pivot: [0, 22, 0], boxes: [[-1, -1.5, -3, 2, 3, 6, 0, 0, inf, false, true]] },
  { name: 'tail', pivot: [0, 22, 3], boxes: [[0, -1.5, 0, 0, 3, 6, 16, 0, inf, false, true]] },
  { name: 'rightFin', pivot: [-1, 22.5, 0], rot: [0, PI / 4, 0], boxes: [[-2, -1, 0, 2, 2, 0, 16, 10, inf, false, true]] },
  { name: 'leftFin', pivot: [1, 22.5, 0], rot: [0, -PI / 4, 0], boxes: [[0, -1, 0, 2, 2, 0, 16, 13, inf, false, true]] },
  { name: 'topFin', pivot: [0, 20.5, -3], boxes: [[0, -3, 0, 0, 3, 6, 0, 10, inf, false, true]] },
];
const shapeB = inf => [
  { name: 'body', pivot: [0, 19, 0], boxes: [[-1, -3, -3, 2, 6, 6, 0, 0, inf, false, true]] },
  { name: 'tail', pivot: [0, 19, 3], boxes: [[0, -3, 0, 0, 6, 5, 16, 0, inf, false, true]] },
  { name: 'rightFin', pivot: [-1, 20, 0], rot: [0, PI / 4, 0], boxes: [[-2, 0, 0, 2, 2, 0, 26, 0, inf, false, true]] },
  { name: 'leftFin', pivot: [1, 20, 0], rot: [0, -PI / 4, 0], boxes: [[0, 0, 0, 2, 2, 0, 26, 3, inf, false, true]] },
  { name: 'topFin', pivot: [0, 16, -3], boxes: [[0, -4, 0, 0, 4, 6, 0, 13, inf, false, true]] },
  { name: 'bottomFin', pivot: [0, 22, -3], boxes: [[0, 0, 0, 0, 4, 6, 12, 13, inf, false, true]] },
];
const tailWag = (m, P, A) => { set(P, m.index.tail, RY, -(A.fishOut ? 1.5 : 1) * 0.45 * Math.sin(0.6 * A.age)); };
model('tropical_a', shapeA(0), tailWag);
model('tropical_a_pattern', shapeA(0.06), tailWag);
model('tropical_b', shapeB(0), tailWag);
model('tropical_b_pattern', shapeB(0.06), tailWag);
/* Where each shape's faces are in its 32 x 32 square: the sides of the body,
   tail and fins, each with which end is the fish's front. */
const TF_FACES = [
  { body: [[0, 6, 6, 3, false], [8, 6, 6, 3, true]], top: [6, 0, 2, 6], bottom: [8, 0, 2, 6], face: [6, 6, 2, 3], back: [14, 6, 2, 3],
    tail: [[16, 6, 6, 3], [22, 6, 6, 3]], top_fin: [[0, 16, 6, 3], [6, 16, 6, 3]], fins: [[16, 10, 4, 2], [16, 13, 4, 2]], bottom_fin: [], eye: [[4, 7], [9, 7]] },
  { body: [[0, 6, 6, 6, false], [8, 6, 6, 6, true]], top: [6, 0, 2, 6], bottom: [8, 0, 2, 6], face: [6, 6, 2, 6], back: [14, 6, 2, 6],
    tail: [[16, 5, 5, 6], [21, 5, 5, 6]], top_fin: [[0, 19, 6, 4], [6, 19, 6, 4]], fins: [[26, 0, 4, 2], [26, 3, 4, 2]], bottom_fin: [[12, 19, 6, 4], [18, 19, 6, 4]], eye: [[4, 8], [9, 8]] },
];
addArt('tropical', [64, 32], p => {
  for (let s = 0; s < 2; s++) {
    const F = TF_FACES[s], ox = s * 32;
    const all = r => { for (const q of r) p.fill(ox + q[0], q[1], q[2], q[3], 0xf2f2f2, 0.05); };
    all(F.body.map(b => b)); all([F.top, F.face, F.back]);
    p.fill(ox + F.bottom[0], F.bottom[1], F.bottom[2], F.bottom[3], 0xd8d8d8, 0.05);
    // the lower part of each side a shade darker, fins a shade lighter
    for (const [x, y, w, h] of F.body) p.fill(ox + x, y + h - 1, w, 1, 0xdedede, 0.04);
    all(F.tail); all(F.top_fin); all(F.fins); all(F.bottom_fin);
    for (const q of F.tail.concat(F.top_fin, F.bottom_fin)) p.speckle(ox + q[0], q[1], q[2], q[3], 0xffffff, 0.3, 0.02);
    for (const [x, y] of F.eye) { p.px(ox + x, y, 0x101010); }
  }
});
/* The patterns, each a test on where a pixel is along the fish (t, 0 at the
   nose) and down its side (s, 0 at the top), plus which fins it covers. */
const TF_PATTERNS = [
  // small: kob, sunstreak, snooper, dasher, brinely, spotty
  [{ side: (t, s) => (t > 0.12 && t < 0.3) || (t > 0.55 && t < 0.72), tail: 'edge' },
    { side: (t, s) => s > 0.3 && s < 0.7 && t > 0.15, top_fin: true },
    { side: (t, s) => s >= 0.6 || t < 0.2, face: true, fins: true },
    { side: (t, s) => s < 0.35 + t * 0.4, top: true, top_fin: true, tail: true },
    { side: (t, s) => t < 0.45, face: true, fins: true, bottom: true },
    { side: (t, s, i, j) => (i * 3 + j * 5) % 4 === 0 && t > 0.15, top_fin: 'spots', tail: 'spots' }],
  // large: flopper, stripey, glitter, blockfish, betty, clayfish
  [{ side: (t, s) => s < 0.42, top: true, top_fin: true },
    { side: (t, s, i) => i % 2 === 0 && t > 0.1, tail: 'stripes' },
    { side: (t, s, i, j) => (i * 7 + j * 3) % 5 === 0, top_fin: 'spots', tail: 'spots', bottom_fin: 'spots' },
    { side: (t, s) => t > 0.5, tail: true, back: true },
    { side: (t, s, i, j) => j % 2 === 1, top_fin: 'stripes' },
    { side: (t, s) => t < 0.34 || s > 0.8, face: true, bottom_fin: true, tail: 'edge' }],
];
function paintPattern(p, ox, oy, shape, pat) {
  const F = TF_FACES[shape], P = TF_PATTERNS[shape][pat], W = 0xffffff;
  const isEye = (x, y) => F.eye.some(e => e[0] === x && e[1] === y);
  for (const [x, y, w, h, frontLeft] of F.body) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const t = (frontLeft ? i : w - 1 - i) / Math.max(1, w - 1), s = j / Math.max(1, h - 1);
    if (!isEye(x + i, y + j) && P.side(t, s, frontLeft ? i : w - 1 - i, j)) p.px(ox + x + i, oy + y + j, W);
  }
  const plane = (list, how) => {
    if (!how) return;
    for (const [x, y, w, h] of list) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const on = how === true || (how === 'edge' && (i === 0 || i === w - 1)) || (how === 'spots' && (i + j * 2) % 3 === 0) || (how === 'stripes' && i % 2 === 0);
      if (on) p.px(ox + x + i, oy + y + j, W);
    }
  };
  plane(F.tail, P.tail); plane(F.top_fin, P.top_fin); plane(F.bottom_fin, P.bottom_fin); plane(F.fins, P.fins);
  if (P.top) plane([F.top], true);
  if (P.bottom) plane([F.bottom], true);
  if (P.face) plane([F.face], true);
  if (P.back) plane([F.back], true);
}
// twelve patterns, four to a slot
for (let k = 0; k < 3; k++) addArt('tf_pat' + k, [64, 64], p => {
  for (let q = 0; q < 4; q++) { const g = k * 4 + q; paintPattern(p, 32 * (q & 1), 32 * (q >> 1), Math.floor(g / 6), g % 6); }
});
const DYES16 = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// the 22 named kinds: [shape, pattern, body colour, pattern colour]
const TF_COMMON = [
  [1, 1, 'orange', 'gray'], [1, 0, 'gray', 'gray'], [1, 0, 'gray', 'blue'], [1, 5, 'white', 'gray'], [0, 1, 'blue', 'gray'],
  [0, 0, 'orange', 'white'], [0, 5, 'pink', 'light_blue'], [1, 3, 'purple', 'yellow'], [1, 5, 'white', 'red'], [0, 5, 'white', 'yellow'],
  [1, 2, 'white', 'gray'], [1, 5, 'white', 'orange'], [0, 3, 'cyan', 'pink'], [0, 4, 'lime', 'light_blue'], [1, 4, 'red', 'white'],
  [0, 2, 'gray', 'red'], [1, 3, 'red', 'white'], [1, 0, 'white', 'yellow'], [0, 0, 'red', 'white'], [0, 1, 'gray', 'white'],
  [0, 3, 'cyan', 'yellow'], [1, 0, 'yellow', 'yellow'],
];
export class TropicalFish extends Fish {
  static W = 0.5; static H = 0.4; static MODEL = 'tropical_a'; static TEX = 'tropical'; static SHADOW = 0.15; static SCHOOL = 7;
  constructor(m, type) { super(m, type); this.v = [0, 0, 'orange', 'white']; }
  newPack() {
    this.v = R() < 0.9 ? TF_COMMON[RI(TF_COMMON.length)].slice() : [RI(2), RI(6), DYES16[RI(16)], DYES16[RI(16)]];
  }
  joinPack(l) { this.v = l.v.slice(); }
  modelName() { return this.v[0] ? 'tropical_b' : 'tropical_a'; }
  texName() { return sub('tropical', this.v[0] ? 32 : 0, 0); }
  tint() { return DYE_RGB[this.v[2]] || 0xffffff; }
  layers(out) {
    const g = this.v[0] * 6 + this.v[1], q = g % 4;
    out.push([this.v[0] ? 'tropical_b_pattern' : 'tropical_a_pattern', sub('tf_pat' + Math.floor(g / 4), 32 * (q & 1), 32 * (q >> 1)), DYE_RGB[this.v[3]] || 0xffffff]);
  }
  // warm seas between y 50 and the surface, or anywhere in a lush cave
  static checkSpawn(S, x, y, z) {
    if (S.biome(x, z) === 'lush_caves') return FLUID[S.m.t.get(x, y, z)] === 1;
    return Squid.checkSpawn(S, x, y, z);
  }
  toJSON() { const o = super.toJSON(); o.tv = this.v; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.tv) this.v = o.tv; }
}
register('tropical_fish', TropicalFish);

/* ---- pufferfish: puffs up when a player (not in creative) or another
   creature comes within 2 blocks, half at once and fully after 40 ticks;
   puffed, it stings whatever touches it for 2 or 3 and poisons for 3 or 6
   seconds. It shrinks back 60 and 100 ticks after the coast is clear. ---- */
const PUFF_SCALE = [0.5, 0.7, 1];
const spikeH = (x, y, z, rx, u, v, w) => ({ pivot: [0, y, z], rot: [rx, 0, 0], boxes: [[-w / 2, -1, 0, w, 1, 0, u, v]] });
const spikeV = (x, y, z, ry, u, v, h, left) => ({ pivot: [x, y, z], rot: [0, ry, 0], boxes: [[left ? 0 : -1, -h, 0, 1, h, 0, u, v]] });
const finAnim = (m, P, A) => {
  const s = Math.sin(A.age * 0.2);
  set(P, m.index.rightFin, RZ, -0.2 + 0.4 * s); set(P, m.index.leftFin, RZ, 0.2 - 0.4 * s);
};
model('pufferfish_small', [
  { name: 'body', pivot: [0, 23, 0], boxes: [[-1.5, -2, -1.5, 3, 2, 3, 0, 0]] },
  { name: 'rightEye', pivot: [0, 20, 0], boxes: [[-1.5, 0, -1.5, 1, 1, 1, 12, 0]] },
  { name: 'leftEye', pivot: [0, 20, 0], boxes: [[0.5, 0, -1.5, 1, 1, 1, 16, 0]] },
  { name: 'backFin', pivot: [0, 22, 1.5], boxes: [[-1.5, 0, 0, 3, 0, 3, 20, 0]] },
  { name: 'rightFin', pivot: [-1.5, 22, -1.5], boxes: [[-1, 0, 0, 1, 0, 2, 30, 0]] },
  { name: 'leftFin', pivot: [1.5, 22, -1.5], boxes: [[0, 0, 0, 1, 0, 2, 34, 0]] },
], finAnim);
model('pufferfish_mid', [
  { name: 'body', pivot: [0, 22, 0], boxes: [[-2.5, -5, -2.5, 5, 5, 5, 0, 8]] },
  { name: 'rightFin', pivot: [-2.5, 17, -1.5], boxes: [[-2, 0, 0, 2, 0, 2, 20, 8]] },
  { name: 'leftFin', pivot: [2.5, 17, -1.5], boxes: [[0, 0, 0, 2, 0, 2, 24, 8]] },
  Object.assign({ name: 'topFront' }, spikeH(0, 17, -2.5, PI / 4, 20, 12, 5)),
  Object.assign({ name: 'topBack' }, spikeH(0, 17, 2.5, -PI / 4, 20, 12, 5)),
  Object.assign({ name: 'bottomFront' }, spikeH(0, 23, -2.5, -PI / 4, 20, 12, 5)),
  Object.assign({ name: 'bottomBack' }, spikeH(0, 23, 2.5, PI / 4, 20, 12, 5)),
  Object.assign({ name: 'rightFront' }, spikeV(-2.5, 22, -2.5, -PI / 4, 30, 12, 5)),
  Object.assign({ name: 'rightBack' }, spikeV(-2.5, 22, 2.5, PI / 4, 30, 12, 5)),
  Object.assign({ name: 'leftFront' }, spikeV(2.5, 22, -2.5, PI / 4, 30, 12, 5, true)),
  Object.assign({ name: 'leftBack' }, spikeV(2.5, 22, 2.5, -PI / 4, 30, 12, 5, true)),
], finAnim);
model('pufferfish_big', [
  { name: 'body', pivot: [0, 22, 0], boxes: [[-4, -8, -4, 8, 8, 8, 0, 20]] },
  { name: 'rightFin', pivot: [-4, 15, -2], boxes: [[-2, 0, 0, 2, 0, 2, 32, 20]] },
  { name: 'leftFin', pivot: [4, 15, -2], boxes: [[0, 0, 0, 2, 0, 2, 36, 20]] },
  Object.assign({ name: 'topFront' }, spikeH(0, 14, -4, PI / 4, 32, 26, 8)),
  Object.assign({ name: 'topMiddle' }, spikeH(0, 14, 0, 0, 32, 26, 8)),
  Object.assign({ name: 'topBack' }, spikeH(0, 14, 4, -PI / 4, 32, 26, 8)),
  Object.assign({ name: 'bottomFront' }, spikeH(0, 23, -4, -PI / 4, 32, 26, 8)),
  Object.assign({ name: 'bottomMiddle' }, spikeH(0, 23, 0, 0, 32, 26, 8)),
  Object.assign({ name: 'bottomBack' }, spikeH(0, 23, 4, PI / 4, 32, 26, 8)),
  Object.assign({ name: 'rightFront' }, spikeV(-4, 22, -4, -PI / 4, 48, 20, 8)),
  Object.assign({ name: 'rightBack' }, spikeV(-4, 22, 4, PI / 4, 48, 20, 8)),
  Object.assign({ name: 'leftFront' }, spikeV(4, 22, -4, PI / 4, 48, 20, 8, true)),
  Object.assign({ name: 'leftBack' }, spikeV(4, 22, 4, -PI / 4, 48, 20, 8, true)),
], finAnim);
addArt('pufferfish', [64, 64], p => {
  const yel = 0xe6c43a, olive = 0x9c8a36, belly = 0xf2eedc, fin = 0x5f84b0, spike = 0xf4f0d0;
  const body = (u, v, w, h, d, eyes) => {
    const F = p.box(u, v, w, h, d, { all: yel, top: olive, bottom: belly }, 0.08);
    for (const k of ['right', 'left', 'front', 'back']) { const [x, y, ww, hh] = F[k]; p.speckle(x, y, ww, Math.ceil(hh / 2), olive, 0.4); p.fill(x, y + hh - 1, ww, 1, belly, 0.05); }
    p.speckle(F.top[0], F.top[1], F.top[2], F.top[3], 0x7a6a2a, 0.35);
    if (eyes) {
      const [x, y, ww] = F.front, e = Math.max(1, Math.floor(ww / 4));
      for (const ex of [x + 1, x + ww - 1 - e]) { p.fill(ex, y + 1, e, e, 0xf8f8f8, 0); p.px(ex + e - 1, y + e, 0x101010); }
      p.fill(x + Math.floor(ww / 2) - 1, y + Math.max(2, Math.floor(ww / 2)), 2, 1, 0x6a3a1a, 0);
    }
  };
  body(0, 0, 3, 2, 3, false);
  p.box(12, 0, 1, 1, 1, 0x101010, 0); p.box(16, 0, 1, 1, 1, 0x101010, 0);
  p.px(13, 1, 0xf0f0f0); p.px(17, 1, 0xf0f0f0);
  p.box(20, 0, 3, 0, 3, fin, 0.1); p.box(30, 0, 1, 0, 2, fin, 0.1); p.box(34, 0, 1, 0, 2, fin, 0.1);
  body(0, 8, 5, 5, 5, true);
  p.box(20, 8, 2, 0, 2, fin, 0.1); p.box(24, 8, 2, 0, 2, fin, 0.1);
  // spikes: a row of pale points
  const spikes = (x, y, w, h) => { p.clear(x, y, w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((w > h ? i : j) % 2 === 0) p.px(x + i, y + j, spike); };
  spikes(20, 12, 10, 1); spikes(30, 12, 2, 5);
  body(0, 20, 8, 8, 8, true);
  p.box(32, 20, 2, 0, 2, fin, 0.1); p.box(36, 20, 2, 0, 2, fin, 0.1);
  spikes(32, 26, 16, 1); spikes(48, 20, 2, 8);
});
export class Pufferfish extends Fish {
  static W = 0.7; static H = 0.7; static MODEL = 'pufferfish_small'; static TEX = 'pufferfish'; static SHADOW = 0.2; static SCHOOL = 0;
  constructor(m, type) { super(m, type); this.puff = 0; this.inflateT = 0; this.deflateT = 0; this.setPuff(0); }
  registerGoals() {
    super.registerGoals();
    this.goals.add(1, new PuffGoal(this));
  }
  setPuff(n) { this.puff = n; const s = PUFF_SCALE[n]; this.w = this.h = 0.7 * s; this.hw = this.w / 2; }
  modelName() { return ['pufferfish_small', 'pufferfish_mid', 'pufferfish_big'][this.puff]; }
  // what makes it puff: a player not in creative, or any creature but the water's own
  scary(e) {
    if (e.isPlayer) return e.alive() && !e.creative();
    return !e.dead && e.hurt && e.constructor.CATEGORY !== 'water_ambient' && !/squid|dolphin|turtle|guardian/.test(e.type) && e.health !== undefined;
  }
  tick() {
    if (!this.dead && !this.removed) {
      if (this.inflateT > 0) {
        if (this.puff === 0) this.setPuff(1);
        else if (this.inflateT > 40 && this.puff === 1) this.setPuff(2);
        this.inflateT++;
      } else if (this.puff !== 0) {
        if (this.deflateT > 60 && this.puff === 2) this.setPuff(1);
        else if (this.deflateT > 100 && this.puff === 1) this.setPuff(0);
        this.deflateT++;
      }
    }
    super.tick();
  }
  aiStep() {
    super.aiStep();
    if (this.dead || this.puff === 0) return;
    const p = this.pos, P = this.m.player, pp = P.pos;
    // stinging: the player touches it when their box grown by 1 across and 0.5 up and down meets its own
    if (P.alive() && !P.creative() && pp.x + 1.3 > p.x - this.hw && pp.x - 1.3 < p.x + this.hw && pp.z + 1.3 > p.z - this.hw && pp.z - 1.3 < p.z + this.hw && pp.y - 0.5 < p.y + this.h && pp.y + 2.3 > p.y) {
      if (this.m.hurtPlayer(1 + this.puff, { type: 'mob', attacker: this, x: p.x, z: p.z })) this.m.effectPlayer('poison', 60 * this.puff);
    }
    // and any creature within 0.3 of it
    this.m.forNear(p.x, p.z, 2, e => {
      if (e === this || !(e instanceof Mob) || !this.scary(e)) return;
      if (Math.abs(e.pos.x - p.x) < e.hw + this.hw + 0.3 && Math.abs(e.pos.z - p.z) < e.hw + this.hw + 0.3 && e.pos.y < p.y + this.h + 0.3 && e.pos.y + e.h > p.y - 0.3) e.hurt(1 + this.puff, { type: 'mob', attacker: this, x: p.x, z: p.z });
    });
  }
  rootPose(root, t, a, A) { root.multiply(t.makeTranslation(0, Math.cos(A.age * 0.05) * 0.08, 0)); }
  toJSON() { const o = super.toJSON(); if (this.puff) o.pf = this.puff; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.pf) this.setPuff(o.pf); }
}
register('pufferfish', Pufferfish);
class PuffGoal extends Goal {
  constructor(mob) { super(mob, 0); }
  canUse() {
    const f = this.mob, p = f.pos, P = f.m.player, r = 2;
    const x0 = p.x - f.hw - r, x1 = p.x + f.hw + r, z0 = p.z - f.hw - r, z1 = p.z + f.hw + r, y0 = p.y - r, y1 = p.y + f.h + r;
    const inBox = (e, w, h) => e.pos.x + w / 2 > x0 && e.pos.x - w / 2 < x1 && e.pos.z + w / 2 > z0 && e.pos.z - w / 2 < z1 && e.pos.y + h > y0 && e.pos.y < y1;
    if (f.scary(P) && inBox(P, 0.6, 1.8)) return true;
    let found = false;
    f.m.forNear(p.x, p.z, 4, e => { if (!found && e !== f && e instanceof Mob && f.scary(e) && inBox(e, e.w, e.h)) found = true; });
    return found;
  }
  start() { this.mob.inflateT = 1; this.mob.deflateT = 0; }
  stop() { this.mob.inflateT = 0; }
}

/* ===========================================================================
   BAT
   6 health, 0.5 x 0.9. Asleep, it hangs upside down under a solid block and
   wakes when a player comes within 4 blocks (or the block goes). Awake, it
   flits towards a random point within 6 blocks, choosing again when it gets
   near or one tick in 30, and one tick in 100 under a ceiling it hangs up
   again. It cannot be pushed, takes no fall damage and drops nothing. Bats
   come out on stone, tuff and deepslate away from the sky, in light of 3 or
   less, in eights.
=========================================================================== */
model('bat', [
  { name: 'body', pivot: [0, 17, 0], boxes: [[-1.5, 0, -1, 3, 5, 2, 0, 0]] },
  { name: 'head', pivot: [0, 17, 0], boxes: [[-2, -3, -1, 4, 3, 2, 0, 8]] },
  { name: 'rightEar', parent: 'head', pivot: [-1.5, -2, 0], boxes: [[-2.5, -4, 0, 3, 5, 0, 12, 8]] },
  { name: 'leftEar', parent: 'head', pivot: [1.1, -3, 0], boxes: [[-0.1, -3, 0, 3, 5, 0, 18, 8]] },
  { name: 'rightWing', parent: 'body', pivot: [-1.5, 0, 0], boxes: [[-2, -2, 0, 2, 7, 0, 24, 0]] },
  { name: 'rightTip', parent: 'rightWing', pivot: [-2, 0, 0], boxes: [[-6, -2, 0, 6, 8, 0, 28, 0]] },
  { name: 'leftWing', parent: 'body', pivot: [1.5, 0, 0], boxes: [[0, -2, 0, 2, 7, 0, 24, 8]] },
  { name: 'leftTip', parent: 'leftWing', pivot: [2, 0, 0], boxes: [[0, -2, 0, 6, 8, 0, 28, 10]] },
  { name: 'feet', parent: 'body', pivot: [0, 5, 0], boxes: [[-1.5, 0, 0, 3, 2, 0, 40, 0]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  if (A.resting) {
    // wings wrapped round the body
    set(P, I.rightWing, RY, -1.2566371); set(P, I.rightTip, RY, -1.7278761);
    set(P, I.leftWing, RY, 1.2566371); set(P, I.leftTip, RY, 1.7278761);
    set(P, I.rightWing, RX, -0.15707964); set(P, I.leftWing, RX, -0.15707964);
  } else {
    // flying: the body leans forward and the wings beat
    const b = Math.cos(A.age * 1.3) * PI * 0.25;
    set(P, I.body, RX, PI / 4 + Math.cos(A.age * 0.1) * 0.15);
    set(P, I.rightWing, RY, b); set(P, I.leftWing, RY, -b);
    set(P, I.rightTip, RY, b * 0.5); set(P, I.leftTip, RY, -b * 0.5);
    set(P, I.feet, RX, 0.4);
  }
});
addArt('bat', [64, 64], p => {
  const fur = 0x4c3c2e, dark = 0x2e231a, wing = 0x3a2c22, vein = 0x5a4434, ear = 0x8a5e4e;
  p.box(0, 0, 3, 5, 2, fur, 0.1); p.speckle(0, 0, 10, 7, dark, 0.25);
  p.box(0, 8, 4, 3, 2, fur, 0.1);
  // the face: two tiny eyes and a pale snout
  p.px(3, 11, 0x0c0808); p.px(5, 11, 0x0c0808); p.px(4, 12, 0x6a4a3a);
  // ears: furred outside, pink inside
  for (const u of [12, 18]) { p.fill(u, 8, 3, 5, fur, 0.1); p.fill(u + 3, 8, 3, 5, ear, 0.08); p.clear(u, 8, 1, 2); p.clear(u + 5, 8, 1, 2); p.px(u + 1, 8, 0, 0); }
  // wings: dark membrane, lighter bones fanning out
  const membrane = (x, y, w, h, fold) => {
    p.fill(x, y, w, h, wing, 0.08);
    for (let i = 0; i < w; i += 2) p.fill(x + i, y, 1, h - 1, vein, 0.06);
    if (fold) for (let i = 0; i < w; i++) if (i % 2) p.px(x + i, y + h - 1, 0, 0);
  };
  membrane(24, 0, 4, 7, false); membrane(28, 0, 12, 8, true);
  membrane(24, 8, 4, 7, false); membrane(28, 10, 12, 8, true);
  p.fill(40, 0, 6, 2, 0x3a2a20, 0.05); p.px(41, 1, 0, 0); p.px(44, 1, 0, 0);
});
export class Bat extends Mob {
  static W = 0.5; static H = 0.9; static HEALTH = 6; static SPEED = 0.7; static CATEGORY = 'ambient'; static NO_FALL = true; static NO_PUSH = true;
  static MODEL = 'bat'; static TEX = 'bat'; static SHADOW = 0.25; static XP = 0;
  constructor(m, type) { super(m, type); this.resting = true; this.tp = null; }
  get eyeH() { return this.h / 2; }
  ceiling() { const T = this.m.t; return !!OPAQUE[T.get(Math.floor(this.pos.x), Math.floor(this.pos.y) + 1, Math.floor(this.pos.z))]; }
  serverAi() {
    this.noActionTime++;
    this.m.despawnCheck(this);
    if (this.removed) return;
    const T = this.m.t, p = this.pos;
    if (this.resting) {
      if (this.ceiling()) {
        if (RI(200) === 0) this.headYaw = this.bodyYaw + (R() - 0.5) * 2 * 75 * DEG;
        const P = this.m.player;
        if (P.alive() && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 16) this.resting = false;
      } else this.resting = false;
      return;
    }
    // awake: towards somewhere new now and then
    let tp = this.tp;
    if (tp && (T.get(tp[0], tp[1], tp[2]) !== 0 || tp[1] < 1)) tp = null;
    if (!tp || RI(30) === 0 || (tp[0] + 0.5 - p.x) ** 2 + (tp[1] + 0.5 - p.y) ** 2 + (tp[2] + 0.5 - p.z) ** 2 < 4) {
      tp = [Math.floor(p.x + RI(7) - RI(7)), Math.floor(p.y + RI(6) - 2), Math.floor(p.z + RI(7) - RI(7))];
    }
    this.tp = tp;
    const v = this.vel, dx = tp[0] + 0.5 - p.x, dy = tp[1] + 0.1 - p.y, dz = tp[2] + 0.5 - p.z;
    v.x += (Math.sign(dx) * 0.5 - v.x) * 0.1;
    v.y += (Math.sign(dy) * 0.7 - v.y) * 0.1;
    v.z += (Math.sign(dz) * 0.5 - v.z) * 0.1;
    this.yaw = yawTo(v.x, v.z);
    // (its own serverAi, so no bodyControl: the body is eased round here)
    this.followYaw();
    this.zza = 0.5; this.moveSpeedNow = 1;
    if (RI(100) === 0 && this.ceiling()) this.resting = true;
  }
  tick() {
    super.tick();
    if (this.removed || this.dead) return;
    if (this.resting) { this.vel.set(0, 0, 0); this.pos.y = Math.floor(this.pos.y) + 1 - this.h; }
    else this.vel.y *= 0.6;
  }
  onHurt(amount, source) { super.onHurt(amount, source); this.resting = false; }
  loot() {}
  anim(A) { A.resting = this.resting && !this.dead; }
  rootPose(root, t, a, A) {
    if (this.resting && !this.dead) {
      // hanging upside down, the feet on the block above
      root.multiply(t.makeTranslation(0, this.h / 2, 0));
      root.multiply(t.makeRotationZ(PI));
      root.multiply(t.makeTranslation(0, -this.h / 2, 0));
    } else root.multiply(t.makeTranslation(0, Math.cos(A.age * 0.3) * 0.05, 0));
  }
  /* Spawning: on stone, granite, diorite, andesite, tuff or deepslate, out
     of sight of the sky, half the time, in light no more than a random 0-3. */
  static checkSpawn(S, x, y, z) {
    const m = S.m, T = m.t;
    if (!tables().batFloor[T.get(x, y - 1, z)] || m.seesSky(x, y, z)) return false;
    if (R() < 0.5) return false;
    if (m.rawBrightness(x, y, z) > RI(4)) return false;
    return S.onGround(this, x, y, z);
  }
  toJSON() { const o = super.toJSON(); if (!this.resting) o.aw = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.resting = !o.aw; }
}
register('bat', Bat);
