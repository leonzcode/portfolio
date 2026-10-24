/* ---------------------------------------------------------------------------
   Leoncraft 2 - the land animals that had no mob yet (their spawn eggs did
   nothing): skeleton and zombie horses, camels and camel husks, llamas and
   trader llamas, ocelots, armadillos, pandas, snow golems, copper golems,
   sniffers, frogs and tadpoles.

   Numbers from the Minecraft Wiki's mob pages (Java Edition): health, the
   movement speed attribute, size, food, drops and experience, and the
   goals in the game's order. The shapes are boxes in the game's model
   units for the familiar proportions; every texture is painted here, pixel
   by pixel, with our own patterns (no Mojang file).
--------------------------------------------------------------------------- */
import { Mob, Living, DEG, wrap, yawTo, rotTowards, Goal, MOVE, LOOK, JUMP, TARGET, looted } from './entity.js?v=107';
import { FloatGoal, PanicGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, TemptGoal, BreedGoal, FollowParentGoal,
  MeleeAttackGoal, AvoidGoal, HurtByTargetGoal, NearestMobTargetGoal, SwimGoal, randomLandPos } from './ai.js?v=107';
import { Animal, register, TYPES } from './mobs.js?v=107';
import { model } from './mobs2.js?v=107';
import { addArt } from './mobart.js?v=107';
import { AbstractHorse } from './mobs4.js?v=107';
import { B, BLOCKS, FLUID, SOLID } from '../blocks.js?v=107';
import { Projectile } from './projectiles.js?v=107';

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const between = (a, b) => a + RI(b - a + 1);
const POSE = 7, RX = 3, RY = 4, RZ = 5, SC = 6;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };
// legs walking in the usual diagonal pairs
function quadLegs(I, P, A, names, k = 1.4) {
  const w = A.walk * 0.6662, s = A.amt;
  set(P, I[names[0]], RX, Math.cos(w) * k * s); set(P, I[names[1]], RX, Math.cos(w + PI) * k * s);
  set(P, I[names[2]], RX, Math.cos(w + PI) * k * s); set(P, I[names[3]], RX, Math.cos(w) * k * s);
}
/* An untamed mount with you on it runs about and, sooner or later, decides:
   tamed when a random number under its patience is below its temper (which
   goes up 5 each time it throws you off). The horse's way (mobs4.js). */
class TameByRidingGoal extends Goal {
  constructor(mob, speed) { super(mob, MOVE); this.speed = speed; }
  canUse() {
    const m = this.mob;
    if (m.tamed || !m.passengers.length) return false;
    const p = randomLandPos(m, 5, 4);
    if (!p) return false;
    this.p = p;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], this.speed, 0.5); }
  canContinue() { const m = this.mob; return !m.tamed && m.passengers.length > 0 && !m.nav.isDone(); }
  tick() {
    const m = this.mob;
    if (m.tamed || RI(50) !== 0) return;
    const rider = m.passengers[0];
    if (rider && rider.isPlayer) {
      if (m.maxTemper > 0 && RI(m.maxTemper) < m.temper) { m.tameHorse(); return; }
      m.temper = Math.min(m.maxTemper, m.temper + 5);
    }
    if (m.m.riding === m) m.m.dismount();
    m.rear();
  }
}
// two parents making a baby of another kind (frogs make tadpoles)
function breedInto(a, b, type, n) {
  const M = a.m;
  if (a.inLove <= 0 || b.inLove <= 0) return;
  a.inLove = 0; b.inLove = 0; a.ageT = 6000; b.ageT = 6000;
  for (let i = 0; i < n; i++) M.spawn(type, (a.pos.x + b.pos.x) / 2 + (R() - 0.5), a.pos.y + 0.2, (a.pos.z + b.pos.z) / 2 + (R() - 0.5), { natural: false });
  M.particles('heart', a.pos.x, a.pos.y + 0.6, a.pos.z, 7, 0.6);
  M.xpAt(a.pos.x, a.pos.y + 0.3, a.pos.z, 1 + RI(7));
}
// the biome's temperature at a block (sim/sim.js), 0.8 (plains) where there is no simulation
const tempAt = (m, x, y, z) => (m.sim && m.sim.tempAt ? m.sim.tempAt(x, y, z) : 0.8);
// fur with a grain and a few darker hairs
const furOf = p => (x, y, w, h, col, amt = 0.15) => { p.fill(x, y, w, h, col, 0.05); p.speckle(x, y, w, h, p.shade(col, 0.88), amt, 0.03); };

/* ===========================================================================
   Skeleton horse and zombie horse: the horse's shape and its riding, but
   undead; 15 health, speed 0.2. Neither can be tamed by riding (a skeleton
   horse comes tamed from a skeleton trap, which this world does not have
   yet), so a wild one only wanders. A skeleton horse walks on the bottom
   of the water and never drowns. Bones or rotten flesh, 0-2.
=========================================================================== */
class UndeadHorse extends AbstractHorse {
  static UNDEAD = true; static HEALTH = 15; static SPEED = 0.2; static FOOD = [];
  rollStats() { this.maxHealth = 15; this.speed = 0.2; this.jumpStrength = 0.4 + R() * 0.2 + R() * 0.2 + R() * 0.2; }
  inherit() { this.rollStats(); this.health = this.maxHealth; }
  interact(held) { if (!this.tamed) return false; return super.interact(held); }
  get xp() { return 1 + RI(3); }
}
export class SkeletonHorse extends UndeadHorse {
  static TEX = 'skeleton_horse'; static WATER_BREATHER = true; static WATER_SPEED = 0.06;
  loot(drop, byPlayer, L) { drop('bone', RI(3) + looted(L)); if (this.saddled) drop('saddle', 1); }
}
register('skeleton_horse', SkeletonHorse);
export class ZombieHorse extends UndeadHorse {
  static TEX = 'zombie_horse';
  loot(drop, byPlayer, L) { drop('rotten_flesh', RI(3) + looted(L)); if (this.saddled) drop('saddle', 1); }
}
register('zombie_horse', ZombieHorse);
function paintUndeadHorse(p, c) {
  const fur = furOf(p);
  p.clear(0, 0, 64, 64);
  // body (0,32) 10x10x22, neck (0,35) 4x12x7, mane (56,36), head (0,13), muzzle (0,25), ears (19,16), tail (42,36), legs (48,21)
  p.box(0, 32, 10, 10, 22, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.2) });
  if (c.ribs) for (const x of [22, 32]) for (let i = 0; i < 9; i++) p.fill(x + 1 + i * 2 + (x === 32 ? 0 : 0), 42 + 2, 1, 7, c.gap, 0.05);
  if (c.rot) for (const [x, y, w, h] of [[23, 44, 5, 3], [36, 46, 4, 4], [3, 48, 3, 2], [10, 40, 4, 3]]) p.fill(x, y, w, h, c.rot, 0.1);
  p.box(0, 35, 4, 12, 7, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.2) });
  if (c.ribs) for (let i = 0; i < 4; i++) p.fill(7 + i * 2, 43, 1, 10, c.gap, 0.04);
  p.box(56, 36, 2, 16, 2, { all: (x, y, w, h) => fur(x, y, w, h, c.mane, 0.3) });
  p.box(0, 13, 6, 5, 7, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.1) });
  p.box(0, 25, 4, 5, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.1) });
  // the eye sockets on the sides of the head, the nostrils
  for (const ex of [4, 14]) { p.fill(ex, 20, 2, 2, c.eye, 0.04); p.px(ex + (ex < 10 ? 1 : 0), 21, c.pupil); }
  p.px(5, 31, c.gap); p.px(8, 31, c.gap);
  if (c.ribs) p.fill(5, 32, 4, 1, c.gap, 0.04);             // the teeth line
  p.box(19, 16, 2, 3, 1, { all: (x, y, w, h) => fur(x, y, w, h, c.base) });
  p.box(42, 36, 3, 14, 4, { all: (x, y, w, h) => fur(x, y, w, h, c.mane, 0.3) });
  p.box(48, 21, 4, 11, 4, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.15) });
  if (c.ribs) for (let x = 48; x < 64; x += 4) p.fill(x + 1, 27, 1, 5, c.gap, 0.04);
  p.fill(48, 33, 16, 3, c.hoof, 0.06);
}
addArt('skeleton_horse', [64, 64], p => paintUndeadHorse(p, { base: 0xd6d2c2, mane: 0xbcb6a6, gap: 0x4a4640, eye: 0x1a1816, pupil: 0x0c0a0a, hoof: 0x8a8478, ribs: true }));
addArt('zombie_horse', [64, 64], p => paintUndeadHorse(p, { base: 0x5e7a4c, mane: 0x34462a, gap: 0x2a3a22, eye: 0x1a2414, pupil: 0x0a0e08, hoof: 0x3a4430, rot: 0x87916a }));

/* ===========================================================================
   Camel: 32 health, speed 0.09 (walking; ridden it goes faster), 1.7 x
   2.375; two can ride, a saddle to steer; cactus to breed and tempt. It
   needs no taming. Now and then it sits down for a while. Ridden, the jump
   key is its dash: a long leap forward, then a few seconds to recover.
   A camel husk is its undead kind from the desert nights: the same shape
   and riding, rotten flesh to tempt and nothing to breed.
=========================================================================== */
export class Camel extends AbstractHorse {
  static W = 1.7; static H = 2.375; static HEALTH = 32; static SPEED = 0.09; static SCALE = 1; static SHADOW = 1.1;
  static MODEL = 'camel'; static TEX = 'camel'; static FOOD = ['cactus'];
  constructor(m, type) { super(m, type); this.sitT = 0; this.sit = 0; this.oSit = 0; this.dashCool = 0; this.tamed = true; }
  get eyeH() { return this.h * 0.95; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new PanicGoal(this, 4));
    this.goals.add(2, new BreedGoal(this, 1));
    this.goals.add(3, new TemptGoal(this, 2.5, this.constructor.FOOD));
    this.goals.add(4, new FollowParentGoal(this, 2.5));
    this.goals.add(5, new StrollGoal(this, 2));
    this.goals.add(6, new LookAtPlayerGoal(this, 6));
    this.goals.add(7, new LookAroundGoal(this));
  }
  rollStats() { this.maxHealth = this.constructor.HEALTH; this.speed = this.constructor.SPEED; this.jumpStrength = 0.42; }
  inherit() { this.rollStats(); this.health = this.maxHealth; }
  finalizeSpawn() { this.rollStats(); this.health = this.maxHealth; this.tamed = true; }
  eatFood() {
    if (this.health < this.maxHealth) { this.heal(2); this.eatT = 20; return true; }
    if (this.ageT < 0) { this.ageT = Math.min(0, this.ageT + 200); return true; }
    if (this.ageT === 0 && !this.inLove) { this.inLove = 600; return true; }
    return false;
  }
  interact(held, player) {
    // sneaking: its screen (a grown one; a camel needs no taming)
    if (player && player.sneaking && player.sneaking() && this.ageT >= 0 && this.openInventory()) return 'swing';
    if (this.passengers.length && held !== 'saddle') { this.m.mount(this); return 'swing'; }
    if (this.constructor.FOOD.indexOf(held) >= 0) return this.eatFood() ? 'consume' : 'swing';
    if (this.ageT < 0) return false;
    if (held === 'saddle' && !this.saddled) { this.saddled = true; return 'consume'; }
    this.sitT = 0;
    this.m.mount(this);
    return 'swing';
  }
  // the seat: high on the hump
  ridingOffset() { return 1.6; }
  rideControl(keys, rider) {
    if (!this.saddled) { this.zza = 0; this.xxa = 0; return true; }
    this.sitT = 0;
    this.yaw = rider.yaw;
    const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0) * 0.25;
    // ridden it walks at its full speed attribute (0.09) times four, sprinting faster
    this.moveSpeedNow = this.speed * (rider.sprinting ? 4.5 : 3.5);
    this.zza = f; this.xxa = ((keys.a ? 1 : 0) - (keys.d ? 1 : 0)) * 0.5;
    // the dash: Space, when it has its breath back
    if (keys[' '] && this.onGround && this.dashCool <= 0 && f > 0) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.vel.x += -s * 1.4; this.vel.z += -c * 1.4; this.vel.y = 0.5;
      this.onGround = false; this.dashCool = 55;
    }
    return true;
  }
  aiStep() {
    if (this.dashCool > 0) this.dashCool--;
    // sitting down for a while, now and then (never when ridden, panicking or a baby)
    if (this.sitT > 0) { this.sitT--; this.stopMoving(); }
    else if (!this.passengers.length && !this.panicking && this.onGround && this.ageT >= 0 && RI(2400) === 0) this.sitT = 300 + RI(900);
    if (this.sitT > 0 && (this.lastHurtBy || this.panicking)) this.sitT = 0;
    super.aiStep();
    this.oSit = this.sit;
    this.sit += ((this.sitT > 0 ? 1 : 0) - this.sit) * 0.12;
  }
  landed(dist) { const n = Math.ceil(dist * 0.5 - 3); if (n > 0) this.hurt(n, { type: 'fall' }); }
  anim(A, a) { super.anim(A, a); A.sit = this.oSit + (this.sit - this.oSit) * a; A.stand = 0; A.eat = 0; }
  layers(out) { if (this.saddled) out.push(['camel_saddle', 'camel_saddle', null]); }
  loot(drop) { if (this.saddled) drop('saddle', 1); }
  get xp() { return this.ageT < 0 ? 0 : 1 + RI(3); }
  toJSON() { const o = super.toJSON(); if (this.sitT) o.si = this.sitT; return o; }
  fromJSON(o) { super.fromJSON(o); this.sitT = o.si || 0; this.tamed = true; }
}
register('camel', Camel);
export class CamelHusk extends Camel {
  static TEX = 'camel_husk'; static UNDEAD = true; static FOOD = ['rotten_flesh'];
  eatFood() { if (this.health < this.maxHealth) { this.heal(2); return true; } return false; }
  loot(drop, byPlayer, L) { drop('rotten_flesh', RI(3) + looted(L)); if (this.saddled) drop('saddle', 1); }
}
register('camel_husk', CamelHusk);
const camelParts = saddle => [
  { name: 'body', pivot: [0, 4, 9.5], boxes: saddle ? [[-4.5, -17, -15.5, 9, 5, 11, 84, 0, 0.1], [-7.5, -12, -23.5, 15, 12, 27, 0, 0, 0.1]] : [[-7.5, -12, -23.5, 15, 12, 27, 0, 25]] },
  { name: 'hump', parent: 'body', pivot: [0, -12, -10], boxes: saddle ? [] : [[-4.5, -5, -5.5, 9, 5, 11, 74, 0]] },
  { name: 'tail', parent: 'body', pivot: [0, -9, 3.5], boxes: saddle ? [] : [[-1.5, 0, 0, 3, 14, 0, 122, 0]] },
  { name: 'head', parent: 'body', pivot: [0, -3, -19.5], boxes: saddle ? [[-3.5, -21, -15, 7, 14, 7, 0, 64, 0.1], [-2.5, -21, -21, 5, 5, 6, 30, 64, 0.1]] : [[-3.5, -7, -15, 7, 8, 19, 60, 24], [-3.5, -21, -15, 7, 14, 7, 21, 0], [-2.5, -21, -21, 5, 5, 6, 50, 0]] },
  { name: 'leftEar', parent: 'head', pivot: [2.5, -21, -9.5], boxes: saddle ? [] : [[-0.5, 0.5, -1, 3, 1, 2, 45, 0]] },
  { name: 'rightEar', parent: 'head', pivot: [-2.5, -21, -9.5], boxes: saddle ? [] : [[-2.5, 0.5, -1, 3, 1, 2, 67, 0]] },
  { name: 'leftHind', pivot: [4.9, 1, 9.5], boxes: saddle ? [] : [[-2.5, 2, -2.5, 5, 21, 5, 58, 16]] },
  { name: 'rightHind', pivot: [-4.9, 1, 9.5], boxes: saddle ? [] : [[-2.5, 2, -2.5, 5, 21, 5, 94, 16]] },
  { name: 'leftFront', pivot: [4.9, 1, -10.5], boxes: saddle ? [] : [[-2.5, 2, -2.5, 5, 21, 5, 0, 0]] },
  { name: 'rightFront', pivot: [-4.9, 1, -10.5], boxes: saddle ? [] : [[-2.5, 2, -2.5, 5, 21, 5, 0, 26 + 76]] },
];
function camelAnim(m, P, A) {
  const I = m.index, w = A.walk * 0.6662, s = A.amt, sit = A.sit || 0;
  set(P, I.head, RY, Math.max(-0.5, Math.min(0.5, A.yaw))); set(P, I.head, RX, A.pitch * 0.5);
  // a camel paces: the legs on one side together
  set(P, I.leftHind, RX, Math.cos(w) * 1.0 * s); set(P, I.leftFront, RX, Math.cos(w) * 1.0 * s);
  set(P, I.rightHind, RX, Math.cos(w + PI) * 1.0 * s); set(P, I.rightFront, RX, Math.cos(w + PI) * 1.0 * s);
  set(P, I.tail, RX, 0.1 + Math.cos(A.age * 0.1) * 0.05);
  if (sit > 0.01) {
    // folded down onto its knees, the body lowered
    add(P, I.body, 1, sit * 14);
    for (const k of ['leftHind', 'rightHind', 'leftFront', 'rightFront']) { add(P, I[k], 1, sit * 18); set(P, I[k], RX, k.endsWith('Front') ? -PI / 2 * sit : PI / 2 * sit); }
  }
}
model('camel', camelParts(false), camelAnim);
model('camel_saddle', camelParts(true), camelAnim);
function paintCamel(p, c) {
  const fur = furOf(p);
  p.clear(0, 0, 128, 128);
  p.box(0, 25, 15, 12, 27, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.18), top: (x, y, w, h) => fur(x, y, w, h, c.dark, 0.2) });
  p.box(74, 0, 9, 5, 11, { all: (x, y, w, h) => fur(x, y, w, h, c.hump, 0.25) });
  p.box(122, 0, 3, 14, 0, { all: (x, y, w, h) => fur(x, y, w, h, c.dark, 0.3) });
  p.fill(122, 10, 3, 4, c.tuft, 0.1);
  p.box(60, 24, 7, 8, 19, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.15) });          // the neck, forward and low
  p.box(21, 0, 7, 14, 7, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.15) });          // the neck's upright part, the head
  p.box(50, 0, 5, 5, 6, { all: (x, y, w, h) => fur(x, y, w, h, c.muzzle, 0.1) });          // the muzzle
  // eyes high on the sides of the head, heavy lids
  for (const ex of [22, 34]) { p.px(ex, 10, c.eye); p.px(ex + 1, 10, c.eye); p.fill(ex, 9, 2, 1, c.dark, 0.04); }
  p.px(56, 8, c.nose); p.px(59, 8, c.nose); p.fill(56, 10, 5, 1, c.dark, 0.05);
  p.box(45, 0, 3, 1, 2, c.dark, 0.1); p.box(67, 0, 3, 1, 2, c.dark, 0.1);
  for (const [u, v] of [[58, 16], [94, 16], [0, 0], [0, 102]]) {
    p.box(u, v, 5, 21, 5, { all: (x, y, w, h) => fur(x, y, w, h, c.base, 0.15) });
    p.fill(u, v + 5 + 8, 20, 4, c.knee, 0.1);               // knobbly knees
    p.fill(u, v + 5 + 18, 20, 3, c.hoof, 0.06);
  }
}
addArt('camel', [128, 128], p => paintCamel(p, { base: 0xd8a868, dark: 0xb88448, hump: 0xc8945a, tuft: 0x6a4a2a, muzzle: 0xe0b878, eye: 0x1e1610, nose: 0x5a3e24, knee: 0xb07c44, hoof: 0x5a4632 }));
addArt('camel_husk', [128, 128], p => paintCamel(p, { base: 0x8a7a5e, dark: 0x6a5c44, hump: 0x7a6a50, tuft: 0x3a3226, muzzle: 0x9a8a6a, eye: 0x2a3a2a, nose: 0x3a3022, knee: 0x5a4c38, hoof: 0x3a3226 }));
addArt('camel_saddle', [128, 128], p => {
  const cloth = 0x8a3a2a, trim = 0xd8a840, leather = 0x7a4a28, strap = 0x3a2414;
  p.clear(0, 0, 128, 128);
  // the body's box (0,0) 15x12x27: the blanket over the middle of its top, trimmed front and back
  p.fill(27, 5, 15, 16, cloth, 0.06); p.fill(27, 5, 15, 1, trim); p.fill(27, 20, 15, 1, trim);
  // it hangs a little way down each side, and a girth goes round
  for (const x of [5, 48]) { p.fill(x, 27, 16, 4, cloth, 0.06); p.fill(x, 31, 16, 1, trim); }
  p.fill(12, 27, 2, 12, strap); p.fill(55, 27, 2, 12, strap);
  // the saddle on the hump (84,0) 9x5x11
  p.box(84, 0, 9, 5, 11, { all: leather, top: 0x8a5632 }, 0.08);
  // the bridle: straps round the neck and over the muzzle
  p.fill(0, 71 + 4, 28, 1, strap); p.fill(0, 71 + 10, 28, 1, strap);
  p.fill(30, 70 + 2, 22, 1, strap); p.fill(36, 64, 5, 6, strap, 0.04);
});

/* ===========================================================================
   Llama: 15 to 30 health, speed 0.175, 0.9 x 1.87; tamed by riding it
   (like a horse) but never steered; carpet on its back; a chest. It spits
   (1 damage) at whatever hurt it, and at wolves. Wheat and hay bales feed
   it; hay bales tempt and breed. Four coats. A trader llama is the
   wandering trader's: blue and gold decor, the same spit.
=========================================================================== */
class LlamaSpit extends Projectile {
  static MODEL = 'ball'; static TEX = 'llama_spit'; static W = 0.25; static H = 0.25;
  constructor(m, type) { super(m, type); this.gravity = 0.06; }
  hitEntity(e) {
    const src = { type: 'mob_projectile', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.isPlayer) this.m.hurtPlayer(1, src); else e.hurt(1, src);
    this.remove();
  }
  hitBlock() { this.m.particles('poof', this.pos.x, this.pos.y, this.pos.z, 4, 0.05, [0.95, 0.95, 0.9]); this.remove(); }
}
register('llama_spit', LlamaSpit);
addArt('llama_spit', [64, 32], p => { p.box(0, 0, 4, 4, 4, 0xe8e8e0, 0.08); });
// spitting: from up to 20 blocks, every 40 ticks
class SpitGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); this.t = 0; }
  canUse() { const t = this.mob.target; return !!t && t.alive(); }
  start() { this.t = 20; }
  stop() { this.mob.nav.stop(); }
  tick() {
    const m = this.mob, t = m.target;
    m.lookAtEntity(t, 30, 30);
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    if (d2 > 144 || !m.canSee(t)) { if (m.age % 10 === 0 || m.nav.isDone()) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, 1.25, 2); }
    else m.nav.stop();
    if (--this.t <= 0 && d2 < 400 && m.canSee(t)) {
      this.t = 40;
      const ey = m.pos.y + m.h * 0.8, dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, dy = t.pos.y + (t.h || 1.8) / 3 - ey;
      const s = m.m.spawn('llama_spit', m.pos.x - Math.sin(m.yaw) * 0.6, ey, m.pos.z - Math.cos(m.yaw) * 0.6, { natural: false });
      if (s) { s.owner = m; s.shoot(dx, dy + Math.hypot(dx, dz) * 0.2, dz, 1.5, 10); }
      // after a spit at whoever hurt it, it calms down
      if (!t.isPlayer || R() < 0.5) { if (m.target === m.lastHurtBy) m.target = null; }
    }
  }
}
const LLAMA_COATS = ['creamy', 'white', 'brown', 'gray'];
export class Llama extends AbstractHorse {
  static W = 0.9; static H = 1.87; static HEALTH = 22; static SPEED = 0.175; static SCALE = 1; static SHADOW = 0.6;
  static MODEL = 'llama'; static TEX = 'llama_creamy'; static FOOD = ['wheat', 'hay_block'];
  constructor(m, type) { super(m, type); this.coat = 'creamy'; this.strength = 3; this.decor = null; this.chest = false; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new TameByRidingGoal(this, 1.2));
    this.goals.add(1, new PanicGoal(this, 1.2));
    this.goals.add(2, new SpitGoal(this));
    this.goals.add(3, new BreedGoal(this, 1));
    this.goals.add(4, new TemptGoal(this, 1.25, ['hay_block']));
    this.goals.add(5, new FollowParentGoal(this, 1));
    this.goals.add(6, new StrollGoal(this, 0.7));
    this.goals.add(7, new LookAtPlayerGoal(this, 6));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestMobTargetGoal(this, e => e.type === 'wolf' && !e.tamed, true));
  }
  rollStats() { this.maxHealth = 15 + RI(16); this.speed = 0.175; this.jumpStrength = 0.5; this.strength = 1 + RI(5); }
  finalizeSpawn(o) { super.finalizeSpawn(o); this.coat = LLAMA_COATS[RI(4)]; }
  inherit(a, b) { this.rollStats(); this.health = this.maxHealth; this.coat = R() < 0.5 ? a.coat : b.coat; }
  texName() { return 'llama_' + this.coat; }
  eatFood(f) { return f; }
  interact(held, player) {
    if (this.tamed && player && player.sneaking && player.sneaking() && this.openInventory()) return 'swing';
    if (this.passengers.length) return false;
    if (held === 'wheat' || held === 'hay_block') {
      let ate = false;
      if (this.health < this.maxHealth) { this.heal(held === 'wheat' ? 2 : 10); ate = true; }
      if (this.ageT < 0) { this.ageT = Math.min(0, this.ageT + (held === 'wheat' ? 200 : 1200)); ate = true; }
      if (held === 'hay_block' && this.tamed && this.ageT === 0 && !this.inLove) { this.inLove = 600; ate = true; }
      if (!this.tamed && this.temper < this.maxTemper) { this.temper = Math.min(this.maxTemper, this.temper + (held === 'wheat' ? 3 : 6)); ate = true; }
      return ate ? 'consume' : 'swing';
    }
    if (this.ageT < 0) return false;
    if (held && held.endsWith('_carpet') && this.tamed) { this.decor = held.slice(0, -7); return 'consume'; }
    if (held === 'chest' && this.tamed && !this.chest) { this.setChest(true); return 'consume'; }
    if (!this.tamed && held) { this.rear(); return 'swing'; }
    this.m.mount(this);
    return 'swing';
  }
  // ridden, it goes its own way: the rider cannot steer a llama
  rideControl() { return false; }
  ridingOffset() { return 1.25; }
  layers(out) {
    if (this.decor) out.push(['llama_decor', this.decor === 'trader' ? 'llama_decor_trader' : 'llama_decor', this.decor === 'trader' ? null : CARPET_RGB[this.decor]]);
    if (this.chest) out.push(['llama_chest', this.texName(), null]);
  }
  loot(drop, byPlayer, L) { super.loot(drop, byPlayer, L); if (this.chest) drop('chest', 1); if (this.decor) drop(this.decor + '_carpet', 1); }
  anim(A, a) { super.anim(A, a); A.eat = 0; }
  toJSON() { const o = super.toJSON(); o.coat = this.coat; o.str = this.strength; if (this.decor) o.dec = this.decor; if (this.chest) o.ch = 1; return o; }
  fromJSON(o) { this.strength = o.str || 3; super.fromJSON(o); this.coat = o.coat || 'creamy'; this.decor = o.dec || null; if (o.ch && !this.chest) this.setChest(true); }
}
register('llama', Llama);
export class TraderLlama extends Llama {
  finalizeSpawn(o) { super.finalizeSpawn(o); this.decor = 'trader'; }
  loot(drop, byPlayer, L) { drop('leather', RI(3) + looted(L)); }
  layers(out) { out.push(['llama_decor', 'llama_decor_trader', null]); if (this.chest) out.push(['llama_chest', this.texName(), null]); }
}
register('trader_llama', TraderLlama);
// (the decor's boxes take the carpet's colour: the last true in each)
const llamaParts = (part) => [
  { name: 'head', pivot: [0, 7, -6], boxes: part ? (part === 'decor' ? [[-4, -16, -6, 8, 18, 6, 0, 14, 0.5, false, true]] : []) : [[-2, -14, -10, 4, 4, 9, 0, 0], [-4, -16, -6, 8, 18, 6, 0, 14], [-4, -19, -4, 3, 3, 2, 17, 0], [1, -19, -4, 3, 3, 2, 17, 0]] },
  { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: part === 'chest' ? [] : part === 'decor' ? [[-6, -10, -7, 12, 18, 10, 29, 0, 0.5, false, true]] : [[-6, -10, -7, 12, 18, 10, 29, 0]] },
  { name: 'rightChest', pivot: [-8.5, 3, 3], rot: [0, PI / 2, 0], boxes: part === 'chest' ? [[-3, 0, 0, 8, 8, 3, 45, 28]] : [] },
  { name: 'leftChest', pivot: [5.5, 3, 3], rot: [0, PI / 2, 0], boxes: part === 'chest' ? [[-3, 0, 0, 8, 8, 3, 45, 41]] : [] },
  { name: 'rightHind', pivot: [-3.5, 10, 6], boxes: part ? (part === 'decor' ? [[-2, 0, -2, 4, 14, 4, 29, 29, 0.5, false, true]] : []) : [[-2, 0, -2, 4, 14, 4, 29, 29]] },
  { name: 'leftHind', pivot: [3.5, 10, 6], boxes: part ? (part === 'decor' ? [[-2, 0, -2, 4, 14, 4, 29, 29, 0.5, false, true]] : []) : [[-2, 0, -2, 4, 14, 4, 29, 29]] },
  { name: 'rightFront', pivot: [-3.5, 10, -5], boxes: part ? (part === 'decor' ? [[-2, 0, -2, 4, 14, 4, 29, 29, 0.5, false, true]] : []) : [[-2, 0, -2, 4, 14, 4, 29, 29]] },
  { name: 'leftFront', pivot: [3.5, 10, -5], boxes: part ? (part === 'decor' ? [[-2, 0, -2, 4, 14, 4, 29, 29, 0.5, false, true]] : []) : [[-2, 0, -2, 4, 14, 4, 29, 29]] },
];
function llamaAnim(m, P, A) {
  const I = m.index;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  quadLegs(I, P, A, ['rightHind', 'leftHind', 'rightFront', 'leftFront']);
}
model('llama', llamaParts(null), llamaAnim);
model('llama_decor', llamaParts('decor'), llamaAnim);
model('llama_chest', llamaParts('chest'), llamaAnim);
const LLAMA_ART = {
  creamy: { base: 0xe0cca0, dark: 0xc8b080, face: 0xd4bc8e },
  white: { base: 0xf0ece4, dark: 0xd8d2c6, face: 0xe4ded2 },
  brown: { base: 0x8a5e3a, dark: 0x6e482a, face: 0x7a5232 },
  gray: { base: 0x9a948c, dark: 0x7e7870, face: 0x8a847c },
};
function paintLlama(p, c) {
  const wool = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); p.speckle(x, y, w, h, p.shade(col, 0.86), 0.3, 0.04); p.speckle(x, y, w, h, p.shade(col, 1.08), 0.15, 0.03); };
  p.clear(0, 0, 128, 64);
  p.box(0, 0, 4, 4, 9, { all: (x, y, w, h) => wool(x, y, w, h, c.face) });           // the snout
  p.fill(9, 9, 4, 2, p.shade(c.face, 0.75), 0.05); p.px(9, 9, 0x2a2420); p.px(12, 9, 0x2a2420);   // nostrils, mouth
  p.box(0, 14, 8, 18, 6, { all: (x, y, w, h) => wool(x, y, w, h, c.base) });          // the long neck and head
  for (const ex of [7, 12]) { p.px(ex, 21, 0x141010); p.px(ex, 22, 0x2a2420); }       // eyes
  p.box(17, 0, 3, 3, 2, { all: (x, y, w, h) => wool(x, y, w, h, c.dark) });            // ears
  p.box(29, 0, 12, 18, 10, { all: (x, y, w, h) => wool(x, y, w, h, c.base) });
  p.box(29, 29, 4, 14, 4, { all: (x, y, w, h) => wool(x, y, w, h, c.base) });
  p.fill(29, 45, 16, 2, p.shade(c.base, 0.6), 0.06);                                   // hooves
  // the chests (45,28) and (45,41)
  for (const v of [28, 41]) { p.box(45, v, 8, 8, 3, { all: 0x8a5a2a, top: 0x9a6a36 }, 0.08); p.fill(48, v + 3 + 3, 3, 2, 0x4a4a4a, 0.05); }
}
for (const k of LLAMA_COATS) addArt('llama_' + k, [128, 64], p => paintLlama(p, LLAMA_ART[k]));
// carpet decor in each colour, and the trader's blue and gold
const CARPET_RGB = { white: 0xf0f0f0, orange: 0xf07a20, magenta: 0xc04ab8, light_blue: 0x40aad8, yellow: 0xf8d02c, lime: 0x78c020, pink: 0xf08aa8, gray: 0x4a5054, light_gray: 0x9c9c96, cyan: 0x169c9c, purple: 0x8a32b8, blue: 0x3a44a8, brown: 0x7e5030, green: 0x5a7a16, red: 0xa8302a, black: 0x1e1e22 };
function paintDecor(p, col, trim) {
  p.clear(0, 0, 128, 64);
  p.box(29, 0, 12, 18, 10, { all: (x, y, w, h) => p.clear(x, y, w, h), top: (x, y, w, h) => { p.fill(x, y, w, h, col, 0.05); for (let i = 0; i < w; i += 3) p.fill(x + i, y, 1, h, trim, 0.04); } });
  // the cloth hangs down the sides
  for (const [x, w] of [[29, 10], [39, 12], [51, 10], [61, 12]]) { p.fill(x, 10, w, 5, col, 0.05); p.fill(x, 15, w, 1, trim, 0.04); }
  p.box(0, 14, 8, 18, 6, (x, y, w, h) => p.clear(x, y, w, h));
  p.fill(0, 26, 28, 2, trim, 0.04);                                                    // a collar
}
// one white decor, tinted by the carpet's colour when drawn
addArt('llama_decor', [128, 64], p => paintDecor(p, 0xf4f4f4, 0xb0b0b0));
addArt('llama_decor_trader', [128, 64], p => paintDecor(p, 0x2a4a9a, 0xe0b830));

/* ===========================================================================
   Ocelot: 10 health, speed 0.3, 0.6 x 0.7; shy of players until it trusts
   one (raw cod or salmon, a third of the time, while you keep still; then
   it stops running); hunts chickens and baby turtles. The cat's shape.
=========================================================================== */
export class Ocelot extends Animal {
  static W = 0.6; static H = 0.7; static HEALTH = 10; static SPEED = 0.3; static ATTACK = 3; static SHADOW = 0.4;
  static MODEL = 'cat'; static TEX = 'ocelot'; static FOOD = ['cod', 'salmon'];
  constructor(m, type) { super(m, type); this.trusting = false; this.sprint = false; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(3, new TemptGoal(this, 0.6, ['cod', 'salmon']));
    this.goals.add(4, new AvoidGoal(this, e => e.isPlayer && !this.trusting && !e.creative(), 16, 0.8, 1.33));
    this.goals.add(5, new MeleeAttackGoal(this, 1, true));
    this.goals.add(6, new BreedGoal(this, 0.8));
    this.goals.add(7, new StrollGoal(this, 0.8, 350));
    this.goals.add(8, new LookAtPlayerGoal(this, 10));
    this.targets.add(1, new NearestMobTargetGoal(this, e => e.type === 'chicken' || (e.type === 'turtle' && e.ageT < 0), false));
  }
  interact(held) {
    if (held !== 'cod' && held !== 'salmon') return false;
    if (!this.trusting) {
      if (RI(3) === 0) { this.trusting = true; this.persistent = true; this.m.particles('heart', this.pos.x, this.pos.y + this.h, this.pos.z, 7, 0.4); }
      else this.m.particles('smoke', this.pos.x, this.pos.y + this.h, this.pos.z, 7, 0.4);
      return 'consume';
    }
    return this.feed() ? 'consume' : false;
  }
  aiStep() { super.aiStep(); this.sprint = !!(this.nav && this.nav.speed > 1.1 && !this.nav.isDone()); }
  anim(A) { A.sprint = this.sprint; A.sitting = false; }
  toJSON() { const o = super.toJSON(); if (this.trusting) o.tr = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.trusting = !!o.tr; }
}
register('ocelot', Ocelot);
addArt('ocelot', [64, 32], p => {
  const fur = furOf(p), base = 0xe0b45a, belly = 0xf0dca0, spot = 0x5a3a1a;
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 5, 4, 5, { all: (x, y, w, h) => fur(x, y, w, h, base) });
  p.box(0, 24, 3, 2, 2, { all: (x, y, w, h) => fur(x, y, w, h, belly) });
  p.box(0, 10, 1, 1, 2, base); p.box(6, 10, 1, 1, 2, base);
  p.box(20, 0, 4, 16, 6, { all: (x, y, w, h) => fur(x, y, w, h, base) });
  fur(26, 6, 4, 16, belly);
  p.box(0, 15, 1, 8, 1, base); p.box(4, 15, 1, 8, 1, base);
  p.box(8, 13, 2, 6, 2, { all: (x, y, w, h) => fur(x, y, w, h, base) });
  p.box(40, 0, 2, 10, 2, { all: (x, y, w, h) => fur(x, y, w, h, base) });
  // rosettes over the back and sides, rings on the tail
  for (let i = 0; i < 40; i++) { const x = 20 + RI(24), y = 6 + RI(16); if (x < 26 || x >= 30) { p.px(x, y, spot); if (RI(2)) p.px(x + 1, y, spot); } }
  for (let y = 16; y < 24; y += 2) { p.fill(0, y, 2, 1, spot); p.fill(4, y, 2, 1, spot); }
  for (let i = 0; i < 6; i++) p.px(RI(20), 5 + RI(3), spot);
  p.px(6, 6, 0x5ab840); p.px(8, 6, 0x5ab840); p.px(6, 7, 0x2a5a20); p.px(8, 7, 0x2a5a20);   // green eyes
  p.px(3, 26, 0xc87070);
});

/* ===========================================================================
   Armadillo: 12 health, speed 0.14, 0.7 x 0.65; spider eyes to tempt and
   breed. Scared (hurt, or an undead mob or a sprinting or riding player
   within 7 blocks) it rolls up into its shell and stays put until the
   danger has gone; rolled up it takes far less from a hit. Every 5 to 10
   minutes it sheds a scute; a brush takes one off at once.
=========================================================================== */
export class Armadillo extends Animal {
  static W = 0.7; static H = 0.65; static HEALTH = 12; static SPEED = 0.14; static SHADOW = 0.4; static PANIC = 2;
  static MODEL = 'armadillo'; static TEX = 'armadillo'; static FOOD = ['spider_eye']; static TEMPT = 1.25;
  constructor(m, type) { super(m, type); this.roll = 0; this.oRoll = 0; this.rolled = false; this.calmT = 0; this.scuteT = 6000 + RI(6000); }
  scared() {
    if (this.lastHurtByTime > 0) return true;
    const P = this.m.player;
    if (P && P.alive() && !P.creative() && (this.m.P.sprinting || this.m.riding) && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 49) return true;
    return !!this.m.nearest(this, 7, e => e.constructor.UNDEAD && !e.dead);
  }
  aiStep() {
    const s = this.scared();
    if (s) { this.rolled = true; this.calmT = 60; }
    else if (this.rolled && --this.calmT <= 0) this.rolled = false;
    if (this.rolled) { this.stopMoving(); this.zza = 0; this.xxa = 0; }
    super.aiStep();
    this.oRoll = this.roll;
    this.roll += ((this.rolled ? 1 : 0) - this.roll) * 0.3;
    if (!this.dead && this.ageT >= 0 && --this.scuteT <= 0) { this.m.dropAt(this, 'armadillo_scute', 1); this.scuteT = 6000 + RI(6000); }
  }
  hurt(amount, source) {
    // rolled up, the shell takes the hit down by the armour of a (hard) shell, and it never panics
    if (this.rolled && source.type !== 'void') amount = Math.max(0, (amount - 1) / 2);
    return super.hurt(amount, source);
  }
  interact(held) {
    if (held === 'brush' && this.ageT >= 0) { this.m.dropAt(this, 'armadillo_scute', 1); return 'damage'; }
    return super.interact(held);
  }
  loot() {}
  anim(A, a) { A.roll = this.oRoll + (this.roll - this.oRoll) * a; }
  toJSON() { const o = super.toJSON(); o.sc = this.scuteT; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.sc) this.scuteT = o.sc; }
}
register('armadillo', Armadillo);
model('armadillo', [
  { name: 'body', pivot: [0, 21, 4], boxes: [[-4, -7, -10, 8, 8, 12, 0, 20, 0.3], [-4, -7, -10, 8, 8, 12, 0, 40]] },
  { name: 'tail', parent: 'body', pivot: [0, -3, 1], rot: [0.5, 0, 0], boxes: [[-0.5, 0, 0, 1, 6, 1, 44, 53]] },
  { name: 'head', parent: 'body', pivot: [0, -2, -11], rot: [-0.39, 0, 0], boxes: [[-1.5, -1, -1, 3, 5, 2, 43, 15]] },
  { name: 'rightEar', parent: 'head', pivot: [-1, -1, 0], rot: [0, 0, -0.5], boxes: [[-2, -3, 0, 2, 5, 0, 43, 10]] },
  { name: 'leftEar', parent: 'head', pivot: [1, -1, 0], rot: [0, 0, 0.5], boxes: [[0, -3, 0, 2, 5, 0, 47, 10]] },
  { name: 'rightHind', pivot: [-2, 21, 4], boxes: [[-1, 0, -1, 2, 3, 2, 51, 31]] },
  { name: 'leftHind', pivot: [2, 21, 4], boxes: [[-1, 0, -1, 2, 3, 2, 42, 31]] },
  { name: 'rightFront', pivot: [-2, 21, -4], boxes: [[-1, 0, -1, 2, 3, 2, 51, 43]] },
  { name: 'leftFront', pivot: [2, 21, -4], boxes: [[-1, 0, -1, 2, 3, 2, 42, 43]] },
], (m, P, A) => {
  const I = m.index, r = A.roll || 0;
  set(P, I.head, RY, A.yaw * (1 - r));
  quadLegs(I, P, A, ['rightHind', 'leftHind', 'rightFront', 'leftFront'], 1.2);
  if (r > 0.02) {
    // curled into a ball: the shell tips down, head, tail and legs tucked away
    set(P, I.body, RX, r * 0.5); add(P, I.body, 1, r * 1.5);
    for (const k of ['head', 'tail', 'rightHind', 'leftHind', 'rightFront', 'leftFront']) set(P, I[k], SC, Math.max(0.001, 1 - r));
  }
});
addArt('armadillo', [64, 64], p => {
  const shell = 0x8a5a4a, band = 0x6a3e34, skin = 0xd89a90, dark = 0x2a1a16;
  p.clear(0, 0, 64, 64);
  // the shell (0,20) with its bands across, the body under it (0,40) pinker
  p.box(0, 20, 8, 8, 12, { all: shell }, 0.08);
  for (let i = 0; i < 12; i += 2) { p.fill(12 + i, 20, 1, 12, band); p.fill(i, 32, 1, 8, band); p.fill(20 + i, 32, 1, 8, band); }
  for (let y = 32; y < 40; y += 2) { p.fill(12, y, 8, 1, band); p.fill(32, y, 8, 1, band); }
  p.box(0, 40, 8, 8, 12, { all: skin }, 0.08);
  p.box(43, 15, 3, 5, 2, skin, 0.06); p.px(45, 18, dark); p.px(48, 18, dark);
  p.fill(43, 10, 2, 5, skin, 0.06); p.fill(47, 10, 2, 5, skin, 0.06);
  p.box(44, 53, 1, 6, 1, shell, 0.08);
  for (const [u, v] of [[51, 31], [42, 31], [51, 43], [42, 43]]) { p.box(u, v, 2, 3, 2, skin, 0.08); p.fill(u, v + 4, 8, 1, dark); }
});

/* ===========================================================================
   Panda: 20 health, speed 0.15, 1.3 x 1.25; bamboo to tempt and breed (with
   bamboo jungle nearby in the game; here, any time). Sits down to eat
   bamboo held out or lying about, rolls over now and then, sneezes as a
   cub. Its gene shows: a brown panda one time in 600, an aggressive one
   fights back when hit (the rest just panic).
=========================================================================== */
export class Panda extends Animal {
  static W = 1.3; static H = 1.25; static HEALTH = 20; static SPEED = 0.15; static ATTACK = 6; static SHADOW = 0.9; static PANIC = 2;
  static MODEL = 'panda'; static TEX = 'panda'; static FOOD = ['bamboo'];
  constructor(m, type) { super(m, type); this.gene = 'normal'; this.sitT = 0; this.sit = 0; this.oSit = 0; this.rollT = 0; this.rollA = 0; }
  registerGoals() {
    super.registerGoals();
    this.goals.add(1, new MeleeAttackGoal(this, 1.2, true));
    this.targets.add(1, new HurtByTargetGoal(this, false));
  }
  finalizeSpawn() { const r = RI(600); this.gene = r === 0 ? 'brown' : RI(15) === 0 ? 'aggressive' : RI(15) === 0 ? 'lazy' : RI(15) === 0 ? 'playful' : 'normal'; }
  texName() { return this.gene === 'brown' ? 'panda_brown' : 'panda'; }
  aiStep() {
    // only an aggressive panda fights; the others run
    if (this.gene !== 'aggressive' && this.target) this.target = null;
    if (this.sitT > 0) { this.sitT--; this.stopMoving(); if (this.sitT % 20 === 0) this.m.particles('poof', this.pos.x - Math.sin(this.yaw) * 0.8, this.pos.y + 0.9, this.pos.z - Math.cos(this.yaw) * 0.8, 1, 0.1, [0.5, 0.75, 0.3]); }
    else if (!this.panicking && this.onGround && RI(this.gene === 'lazy' ? 600 : 3000) === 0) this.sitT = 100 + RI(200);
    /* a roll, the game's: set off the way it faces (0.2 a tick, a cub 0.1) with a little
       lift, a bounce on the 7th, 15th and 23rd ticks, 32 ticks in all; it steers no
       more till it is done (its moveControl), so it rolls straight on, head first */
    if (this.rollT > 0) {
      const n = 33 - this.rollT--;
      this.rollA += PI / 10;
      this.stopMoving();      // (whatever walk it was on ends with the roll, as the game's roll goal takes the move)
      if (n === 1) {
        const sp = this.isBaby ? 0.1 : 0.2;
        this.rollDX = -Math.sin(this.yaw) * sp; this.rollDZ = -Math.cos(this.yaw) * sp;
        this.vel.set(this.vel.x + this.rollDX, 0.27, this.vel.z + this.rollDZ);
      } else if (n === 7 || n === 15 || n === 23) this.vel.set(0, this.onGround ? 0.27 : this.vel.y, 0);
      else { this.vel.x = this.rollDX || 0; this.vel.z = this.rollDZ || 0; }
    }
    else if (this.onGround && !this.sitT && RI(this.gene === 'playful' ? 300 : 6000) === 0) { this.rollT = 32; this.rollA = 0; }
    super.aiStep();
    this.oSit = this.sit;
    this.sit += ((this.sitT > 0 ? 1 : 0) - this.sit) * 0.15;
    // a cub sneezes now and then, a slime ball one time in seven hundred
    if (this.ageT < 0 && RI(6000) === 0) { this.m.particles('poof', this.pos.x, this.pos.y + 0.5, this.pos.z, 4, 0.2, [0.9, 0.95, 0.9]); if (RI(700) === 0) this.m.dropAt(this, 'slime_ball', 1); }
  }
  moveControl() {
    if (this.rollT > 0) { this.zza = 0; this.mcOp = 0; this.jumping = false; return; }
    super.moveControl();
  }
  interact(held) {
    if (held === 'bamboo') { this.sitT = 120; return super.interact(held) || 'consume'; }
    return super.interact(held);
  }
  loot(drop) { drop('bamboo', 1); }
  anim(A, a) { A.sit = this.oSit + (this.sit - this.oSit) * a; A.roll = this.rollT > 0 ? this.rollA + a * PI / 10 : 0; }
  rootPose(root, t, a, A) { if (A.roll) { root.multiply(t.makeTranslation(0, 0.6, 0)); root.multiply(t.makeRotationX(A.roll)); root.multiply(t.makeTranslation(0, -0.6, 0)); } }
  toJSON() { const o = super.toJSON(); o.gn = this.gene; return o; }
  fromJSON(o) { super.fromJSON(o); this.gene = o.gn || 'normal'; }
}
register('panda', Panda);
model('panda', [
  { name: 'head', pivot: [0, 11.5, -17], boxes: [[-6.5, -5, -4, 13, 10, 9, 0, 6], [-3.5, 0, -6, 7, 5, 2, 45, 16], [-8.5, -8, -1, 5, 4, 1, 52, 25], [3.5, -8, -1, 5, 4, 1, 52, 25, 0, true]] },
  { name: 'body', pivot: [0, 10, 0], rot: [PI / 2, 0, 0], boxes: [[-9.5, -13, -6.5, 19, 26, 13, 0, 25]] },
  { name: 'rightHind', pivot: [-5.5, 15, 9], boxes: [[-3, 0, -3, 6, 9, 6, 40, 0]] },
  { name: 'leftHind', pivot: [5.5, 15, 9], boxes: [[-3, 0, -3, 6, 9, 6, 40, 0]] },
  { name: 'rightFront', pivot: [-5.5, 15, -9], boxes: [[-3, 0, -3, 6, 9, 6, 40, 0]] },
  { name: 'leftFront', pivot: [5.5, 15, -9], boxes: [[-3, 0, -3, 6, 9, 6, 40, 0]] },
], (m, P, A) => {
  const I = m.index, sit = A.sit || 0;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  quadLegs(I, P, A, ['rightHind', 'leftHind', 'rightFront', 'leftFront'], 1.2);
  if (sit > 0.01) {
    // sat up on its haunches, the front paws up to its mouth
    add(P, I.body, RX, -sit * 0.9); add(P, I.body, 1, sit * 1); add(P, I.body, 2, sit * 4);
    add(P, I.head, 1, -sit * 8); add(P, I.head, 2, sit * 10);
    for (const k of ['rightFront', 'leftFront']) { add(P, I[k], 1, -sit * 8); add(P, I[k], 2, sit * 6); set(P, I[k], RX, -sit * 1.2); }
    for (const k of ['rightHind', 'leftHind']) { set(P, I[k], RX, -sit * PI / 2); add(P, I[k], 1, sit * 4); }
  }
});
function paintPanda(p, white, black) {
  p.clear(0, 0, 64, 64);
  p.box(0, 6, 13, 10, 9, { all: white }, 0.05);
  // the eye patches, drooping, with a small eye in each
  for (const ex of [11, 18]) { p.fill(ex, 19, 4, 3, black, 0.04); p.fill(ex + (ex < 15 ? 0 : 1), 22, 3, 1, black, 0.04); p.px(ex + 1, 20, 0xf4f4f0); p.px(ex + 2, 20, 0x0c0c0c); }
  p.box(45, 16, 7, 5, 2, { all: white }, 0.04); p.fill(48, 18, 3, 2, black);          // the nose
  p.box(52, 25, 5, 4, 1, black, 0.05);                                               // ears
  // body (0,25) 19x26x13 turned up: black shoulders round the front, white behind
  p.box(0, 25, 19, 26, 13, { all: white }, 0.05);
  p.fill(13, 25, 19, 13, black, 0.04);
  for (const x of [0, 13, 32, 45]) p.fill(x, 38, x === 0 || x === 32 ? 13 : 19, 8, black, 0.04);
  p.box(40, 0, 6, 9, 6, black, 0.05);                                                // the legs, black
}
addArt('panda', [64, 64], p => paintPanda(p, 0xeeeeea, 0x1e1e20));
addArt('panda_brown', [64, 64], p => paintPanda(p, 0xd8c8b0, 0x5a3a24));

/* ===========================================================================
   Snow golem: 4 health, speed 0.2, 0.7 x 1.9; throws a snowball every
   second at monsters within 10 blocks (a knock, and 3 to a blaze); leaves
   snow where it walks in the cold; melts in the heat, the rain and water.
   Shears take its pumpkin off. Drops 0-15 snowballs.
=========================================================================== */
class ThrowSnowGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { const t = this.mob.target; return !!t && t.alive(); }
  start() { this.t = 0; }
  stop() { this.mob.nav.stop(); }
  tick() {
    const m = this.mob, t = m.target;
    m.lookAtEntity(t, 30, 30);
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z), sees = m.canSee(t);
    if (d2 > 100 || !sees) { if (m.age % 10 === 0 || m.nav.isDone()) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, 1.25, 2); } else m.nav.stop();
    if (--this.t <= 0 && sees && d2 < 100) {
      this.t = 20;
      const ey = m.pos.y + m.h * 0.85, dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, dy = t.pos.y + (t.h || 1.8) * 0.5 - ey;
      const s = m.m.spawn('snowball', m.pos.x, ey, m.pos.z, { natural: false });
      if (s) { s.owner = m; s.shoot(dx, dy + Math.hypot(dx, dz) * 0.2, dz, 1.6, 12); }
    }
  }
}
export class SnowGolem extends Mob {
  static W = 0.7; static H = 1.9; static HEALTH = 4; static SPEED = 0.2; static MODEL = 'snow_golem'; static TEX = 'snow_golem'; static SHADOW = 0.5;
  static CATEGORY = 'misc';
  constructor(m, type) { super(m, type); this.equip.head = 'carved_pumpkin'; this.dropChance = { head: 0 }; }
  get eyeH() { return 1.7; }
  registerGoals() {
    this.goals.add(1, new ThrowSnowGoal(this));
    this.goals.add(2, new StrollGoal(this, 1, 120, true));
    this.goals.add(3, new LookAtPlayerGoal(this, 6));
    this.goals.add(4, new LookAroundGoal(this));
    this.targets.add(1, new NearestMobTargetGoal(this, e => e.constructor.HOSTILE && !e.dead, true));
  }
  aiStep() {
    super.aiStep();
    if (this.dead || this.removed) return;
    const T = this.m.t, x = Math.floor(this.pos.x), y = Math.floor(this.pos.y), z = Math.floor(this.pos.z);
    // wet or hot: it melts a point at a time
    const hot = tempAt(this.m, x, y, z) > 1;
    if ((this.inWater || hot || (this.m.raining() && this.m.seesSky(x, y + 2, z))) && this.age % 20 === 0) this.hurt(1, { type: 'melting', noKnock: true });
    // a snow layer under its feet where it is cold enough
    if (!hot && B.snow !== undefined && this.onGround && T.get(x, y, z) === 0 && SOLID[T.get(x, y - 1, z)] && this.m.world) {
      const cold = tempAt(this.m, x, y, z) < 0.8;
      if (cold && this.m.world.set) this.m.world.set(x, y, z, B.snow, 0);
    }
  }
  interact(held) {
    if (held === 'shears' && this.equip.head) { this.equip.head = null; this.m.dropAt(this, 'carved_pumpkin', 1); return 'damage'; }
    return false;
  }
  loot(drop) { drop('snowball', RI(16)); }
  get xp() { return 0; }
}
register('snow_golem', SnowGolem);
model('snow_golem', [
  { name: 'head', pivot: [0, 4, 0], boxes: [[-4, -8, -4, 8, 8, 8, 0, 0, -0.5]] },
  { name: 'body', pivot: [0, 13, 0], boxes: [[-5, -10, -5, 10, 10, 10, 0, 16, -0.5]] },
  { name: 'lower', pivot: [0, 24, 0], boxes: [[-6, -12, -6, 12, 12, 12, 0, 36, -0.5]] },
  { name: 'leftArm', pivot: [5, 6, 1], rot: [0, 0, 1.0], boxes: [[-1, 0, -1, 12, 2, 2, 32, 0, -0.5]] },
  { name: 'rightArm', pivot: [-5, 6, -1], rot: [0, PI, -1.0], boxes: [[-1, 0, -1, 12, 2, 2, 32, 0, -0.5]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.body, RY, A.yaw * 0.25);
  const s = Math.sin(A.yaw * 0.25), c = Math.cos(A.yaw * 0.25);
  set(P, I.leftArm, 0, c * 5); set(P, I.leftArm, 2, -s * 5); set(P, I.leftArm, RY, A.yaw * 0.25);
  set(P, I.rightArm, 0, -c * 5); set(P, I.rightArm, 2, s * 5); set(P, I.rightArm, RY, PI + A.yaw * 0.25);
});
addArt('snow_golem', [64, 64], p => {
  const snow = 0xf4f8fa, shade = 0xdce4ea;
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 8, 8, 8, { all: snow }, 0.04); p.speckle(0, 0, 32, 16, shade, 0.2);
  p.fill(10, 11, 1, 1, 0x101010); p.fill(13, 11, 1, 1, 0x101010); for (let i = 0; i < 4; i++) p.px(10 + i, 13 + (i === 0 || i === 3 ? 0 : 1), 0x101010);
  p.box(0, 16, 10, 10, 10, { all: snow }, 0.04); p.speckle(0, 16, 40, 20, shade, 0.25);
  p.box(0, 36, 12, 12, 12, { all: snow }, 0.04); p.speckle(0, 36, 48, 24, shade, 0.25);
  p.box(32, 0, 12, 2, 2, 0x6a4a2a, 0.12);                                            // the stick arms
});

/* ===========================================================================
   Copper golem: 12 health, speed 0.2, 0.49 x 0.98 (built from a copper
   block and a carved pumpkin, in the game). It wanders and presses copper
   buttons; it weathers through exposed, weathered and oxidized in about a
   game week (an axe scrapes it back, honeycomb waxes it). Sorting chests
   is left out. Drops its copper on death.
=========================================================================== */
const COPPER_STAGES = ['copper', 'exposed', 'weathered', 'oxidized'];
export class CopperGolem extends Mob {
  static W = 0.49; static H = 0.98; static HEALTH = 12; static SPEED = 0.2; static MODEL = 'copper_golem'; static TEX = 'copper_golem'; static SHADOW = 0.35;
  static CATEGORY = 'misc';
  constructor(m, type) { super(m, type); this.stage = 0; this.waxed = false; this.weatherT = 24000 * 2 + RI(24000); this.spin = 0; }
  get eyeH() { return 0.8; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new PanicGoal(this, 1.5));
    this.goals.add(4, new StrollGoal(this, 1));
    this.goals.add(5, new LookAtPlayerGoal(this, 6));
    this.goals.add(6, new LookAroundGoal(this));
  }
  texName() { return 'copper_golem_' + COPPER_STAGES[this.stage]; }
  aiStep() {
    // fully oxidized it stands still, a statue in all but name
    if (this.stage >= 3) { this.stopMoving(); this.zza = 0; }
    super.aiStep();
    if (!this.waxed && this.stage < 3 && --this.weatherT <= 0) { this.stage++; this.weatherT = 24000 * 2 + RI(24000); }
    this.spin = this.spin * 0.9 + (this.stage < 3 && RI(400) === 0 ? 1 : 0);
  }
  interact(held) {
    if (held && /_axe$/.test(held)) {
      if (this.waxed) { this.waxed = false; return 'damage'; }
      if (this.stage > 0) { this.stage--; return 'damage'; }
      return false;
    }
    if (held === 'honeycomb' && !this.waxed) { this.waxed = true; return 'consume'; }
    return false;
  }
  loot(drop) { drop('copper_ingot', 1 + RI(3)); }
  get xp() { return 0; }
  anim(A) { A.spin = this.spin; }
  toJSON() { const o = super.toJSON(); o.st = this.stage; if (this.waxed) o.wx = 1; o.wt = this.weatherT; return o; }
  fromJSON(o) { super.fromJSON(o); this.stage = o.st || 0; this.waxed = !!o.wx; if (o.wt) this.weatherT = o.wt; }
}
register('copper_golem', CopperGolem);
model('copper_golem', [
  { name: 'body', pivot: [0, 19, 0], boxes: [[-4, -6, -3, 8, 6, 6, 0, 15]] },
  { name: 'head', parent: 'body', pivot: [0, -6, 0], boxes: [[-4, -5, -5, 8, 5, 10, 0, 0], [-1, -2, -6, 2, 3, 2, 56, 0], [-1, -9, -1, 2, 4, 2, 37, 8], [-2, -13, -2, 4, 4, 4, 37, 0]] },
  { name: 'rightArm', parent: 'body', pivot: [-4, -6, 0], boxes: [[-3, -1, -2, 3, 10, 4, 36, 16]] },
  { name: 'leftArm', parent: 'body', pivot: [4, -6, 0], boxes: [[0, -1, -2, 3, 10, 4, 50, 16]] },
  { name: 'rightLeg', pivot: [-2, 19, 0], boxes: [[-2, 0, -2, 4, 5, 4, 0, 27]] },
  { name: 'leftLeg', pivot: [2, 19, 0], boxes: [[-2, 0, -2, 4, 5, 4, 16, 27]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw + (A.spin || 0) * PI * 2); set(P, I.head, RX, A.pitch * 0.5);
  set(P, I.rightLeg, RX, Math.cos(w) * 1.4 * s); set(P, I.leftLeg, RX, Math.cos(w + PI) * 1.4 * s);
  set(P, I.rightArm, RX, Math.cos(w + PI) * s); set(P, I.leftArm, RX, Math.cos(w) * s);
});
const COPPER_RGB = { copper: [0xc8704a, 0xe08a5e, 0x9a5236], exposed: [0xa8826a, 0xc89a7a, 0x7e6050], weathered: [0x6a9a7a, 0x84b496, 0x4e7a5e], oxidized: [0x4aa08a, 0x62bca4, 0x34806e] };
for (const k of COPPER_STAGES) addArt('copper_golem_' + k, [64, 64], p => {
  const [base, light, dark] = COPPER_RGB[k];
  p.clear(0, 0, 64, 64);
  const metal = (x, y, w, h) => { p.fill(x, y, w, h, base, 0.06); p.speckle(x, y, w, h, light, 0.12); p.speckle(x, y, w, h, dark, 0.12); };
  p.box(0, 0, 8, 5, 10, { all: metal });
  // the face: two round eyes and a rivet line
  p.fill(11, 12, 2, 2, 0x2a1a12); p.fill(15, 12, 2, 2, 0x2a1a12); p.px(11, 12, 0xf0e8c8); p.px(15, 12, 0xf0e8c8);
  p.box(56, 0, 2, 3, 2, { all: metal }); p.box(37, 8, 2, 4, 2, { all: metal }); p.box(37, 0, 4, 4, 4, { all: light }, 0.06);
  p.box(0, 15, 8, 6, 6, { all: metal });
  p.fill(6, 21, 8, 1, dark); p.px(7, 23, light); p.px(12, 23, light);
  p.box(36, 16, 3, 10, 4, { all: metal }); p.box(50, 16, 3, 10, 4, { all: metal });
  p.box(0, 27, 4, 5, 4, { all: metal }); p.box(16, 27, 4, 5, 4, { all: metal });
});

/* ===========================================================================
   Sniffer: 14 health, speed 0.1, 1.9 x 1.75; torchflower seeds to tempt and
   breed. Now and then it puts its nose down on grass, dirt, moss or mud,
   sniffs about, digs, and comes up with a torchflower seed or a pitcher pod
   (then not again for 8 minutes).
=========================================================================== */
const DIGGABLE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud', 'muddy_mangrove_roots', 'pale_moss_block']);
export class Sniffer extends Animal {
  static W = 1.9; static H = 1.75; static HEALTH = 14; static SPEED = 0.1; static SHADOW = 1.2; static PANIC = 2;
  static MODEL = 'sniffer'; static TEX = 'sniffer'; static FOOD = ['torchflower_seeds'];
  constructor(m, type) { super(m, type); this.digT = 0; this.digCool = 600 + RI(1200); this.nose = 0; this.oNose = 0; }
  aiStep() {
    if (this.digT > 0) {
      this.digT--; this.stopMoving();
      if (this.digT > 40 && this.age % 4 === 0) this.m.particles('poof', this.pos.x - Math.sin(this.yaw) * 1.4, this.pos.y + 0.2, this.pos.z - Math.cos(this.yaw) * 1.4, 2, 0.2, [0.45, 0.32, 0.2]);
      if (this.digT === 40) {
        const x = Math.floor(this.pos.x - Math.sin(this.yaw) * 1.4), z = Math.floor(this.pos.z - Math.cos(this.yaw) * 1.4), y = Math.floor(this.pos.y) - 1;
        const d = BLOCKS[this.m.t.get(x, y, z)];
        if (d && DIGGABLE.has(d.name)) this.m.dropItemAt(x + 0.5, y + 1.2, z + 0.5, R() < 0.5 ? 'torchflower_seeds' : 'pitcher_pod', 1);
        this.digCool = 9600;
      }
    } else if (this.ageT >= 0 && --this.digCool <= 0 && this.onGround && !this.panicking) {
      const x = Math.floor(this.pos.x - Math.sin(this.yaw) * 1.4), z = Math.floor(this.pos.z - Math.cos(this.yaw) * 1.4);
      const d = BLOCKS[this.m.t.get(x, Math.floor(this.pos.y) - 1, z)];
      if (d && DIGGABLE.has(d.name)) this.digT = 120; else this.digCool = 200;
    }
    super.aiStep();
    this.oNose = this.nose;
    this.nose += ((this.digT > 0 ? 1 : 0) - this.nose) * 0.15;
  }
  loot() {}
  anim(A, a) { A.dig = this.oNose + (this.nose - this.oNose) * a; }
  toJSON() { const o = super.toJSON(); o.dc = this.digCool; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.dc) this.digCool = o.dc; }
}
register('sniffer', Sniffer);
model('sniffer', [
  { name: 'body', pivot: [0, 5, 0], boxes: [[-12.5, -14, -20, 25, 29, 40, 62, 68], [-12.5, -14, -20, 25, 24, 40, 62, 0, 0.5]] },
  { name: 'head', parent: 'body', pivot: [0, 6.5, -19.48], boxes: [[-6.5, -7.5, -11.5, 13, 18, 11, 8, 15]] },
  { name: 'leftEar', parent: 'head', pivot: [6.51, -7.5, -4.51], boxes: [[0, 0, -3, 1, 19, 7, 2, 0]] },
  { name: 'rightEar', parent: 'head', pivot: [-6.51, -7.5, -5.5], boxes: [[-1, 0, -3, 1, 19, 7, 48, 0]] },
  { name: 'nose', parent: 'head', pivot: [0, -4.5, -11.5], boxes: [[-6.5, -2, -9, 13, 2, 9, 10, 45]] },
  { name: 'beak', parent: 'head', pivot: [0, 2.5, -12.5], boxes: [[-6.5, -7, -8, 13, 12, 9, 10, 57]] },
  { name: 'rightFront', pivot: [-7.5, 15, -15], boxes: [[-3.5, -1, -4, 7, 10, 8, 32, 87]] },
  { name: 'rightMid', pivot: [-7.5, 15, 0], boxes: [[-3.5, -1, -4, 7, 10, 8, 32, 105]] },
  { name: 'rightHind', pivot: [-7.5, 15, 15], boxes: [[-3.5, -1, -4, 7, 10, 8, 32, 123]] },
  { name: 'leftFront', pivot: [7.5, 15, -15], boxes: [[-3.5, -1, -4, 7, 10, 8, 0, 87]] },
  { name: 'leftMid', pivot: [7.5, 15, 0], boxes: [[-3.5, -1, -4, 7, 10, 8, 0, 105]] },
  { name: 'leftHind', pivot: [7.5, 15, 15], boxes: [[-3.5, -1, -4, 7, 10, 8, 0, 123]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt, dig = A.dig || 0;
  set(P, I.head, RY, A.yaw * 0.5); set(P, I.head, RX, A.pitch * 0.3 + dig * 0.6 + (dig > 0.5 ? Math.sin(A.age * 0.8) * 0.08 : 0));
  // six legs: the middle pair with the opposite diagonal
  for (const [k, ph] of [['rightFront', 0], ['leftMid', 0], ['rightHind', 0], ['leftFront', PI], ['rightMid', PI], ['leftHind', PI]]) set(P, I[k], RX, Math.cos(w + ph) * 1.0 * s);
  set(P, I.leftEar, RZ, -0.2 - Math.cos(A.age * 0.15) * 0.08); set(P, I.rightEar, RZ, 0.2 + Math.cos(A.age * 0.15) * 0.08);
});
addArt('sniffer', [192, 192], p => {
  const fur = 0xa8462e, moss = 0x5a8a3a, belly = 0xc87050, dark = 0x6a2a1e, beak = 0xe0b050;
  p.clear(0, 0, 192, 192);
  const coat = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); p.speckle(x, y, w, h, p.shade(col, 0.82), 0.25, 0.04); p.speckle(x, y, w, h, p.shade(col, 1.12), 0.12, 0.03); };
  // the outer coat (62,0) with a mossy back, the body under it (62,68)
  p.box(62, 0, 25, 24, 40, { all: (x, y, w, h) => coat(x, y, w, h, fur), top: (x, y, w, h) => { coat(x, y, w, h, moss); p.speckle(x, y, w, h, 0x3a6a2a, 0.3); } });
  p.box(62, 68, 25, 29, 40, { all: (x, y, w, h) => coat(x, y, w, h, belly) });
  p.box(8, 15, 13, 18, 11, { all: (x, y, w, h) => coat(x, y, w, h, fur) });
  // eyes on the head's front, green
  for (const ex of [21, 28]) { p.fill(ex, 33, 3, 2, 0x1a1a14); p.px(ex + 1, 33, 0x60c050); }
  p.box(2, 0, 1, 19, 7, { all: (x, y, w, h) => coat(x, y, w, h, fur) }); p.box(48, 0, 1, 19, 7, { all: (x, y, w, h) => coat(x, y, w, h, fur) });
  p.box(10, 45, 13, 2, 9, { all: beak }, 0.06); p.box(10, 57, 13, 12, 9, { all: beak, front: 0xc89040 }, 0.06);
  for (const v of [87, 105, 123]) for (const u of [0, 32]) { p.box(u, v, 7, 10, 8, { all: (x, y, w, h) => coat(x, y, w, h, fur) }); p.fill(u, v + 8 + 7, 30, 3, dark, 0.06); }
});

/* ===========================================================================
   Frog: 10 health, speed 1 (it hops more than it walks), 0.5 x 0.5; slime
   balls to tempt and breed (it lays frogspawn in water, here a tadpole
   straight away). Its tongue takes small slimes (a slime ball) and small
   magma cubes (a froglight of its own colour). Swims well. Three kinds,
   by where it grew up: temperate, warm and cold.
   Tadpole: 6 health, 0.4 x 0.3, water only; a frog after 20 minutes
   (slime balls bring that on).
=========================================================================== */
const FROG_KINDS = ['temperate', 'warm', 'cold'];
const FROGLIGHT = { temperate: 'ochre_froglight', warm: 'pearlescent_froglight', cold: 'verdant_froglight' };
class FrogEatGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { const t = this.mob.target; return !!t && !t.dead && !t.removed; }
  tick() {
    const m = this.mob, t = m.target;
    m.lookAtEntity(t, 30, 30);
    if (m.dist2(t.pos.x, t.pos.y, t.pos.z) > 9) { if (m.age % 10 === 0 || m.nav.isDone()) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, 2, 1); return; }
    m.nav.stop();
    // the tongue: the prey is swallowed and leaves its drop
    m.tongueT = 10;
    if (t.type === 'magma_cube') m.m.dropAt(t, FROGLIGHT[m.kind], 1); else m.m.dropAt(t, 'slime_ball', 1);
    t.remove(); m.target = null;
  }
}
// two frogs in love: the frogspawn they leave hatches 2 to 6 tadpoles (here at once, where they meet)
class FrogBreedGoal extends BreedGoal {
  tick() {
    const m = this.mob, o = this.mate;
    m.lookAtEntity(o, 10, m.maxPitch());
    if (m.age % 4 === 0) m.nav.moveTo(o.pos.x, o.pos.y, o.pos.z, this.speed, 1);
    if (++this.t >= 60 && m.dist2(o.pos.x, o.pos.y, o.pos.z) < 9) breedInto(m, o, 'tadpole', 2 + RI(5));
  }
}
/* the frog's long jump (the game's LongJumpToPreferredBlock): every 100 to 140
   ticks on land, with nothing better to do, it picks a spot up to 4 blocks off and
   2 up or down, turns to it, and jumps there on an arc at the first of 65, 70, 75
   and 80 degrees that is clear and needs no more than 1.5 blocks a tick. Half the
   time it would rather land on a lily pad if one is in reach. */
const FROG_ANGLES = [65, 70, 75, 80];
class FrogLongJumpGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK | JUMP); this.to = null; this.v = null; this.t = 0; this.up = false; }
  canUse() {
    const m = this.mob;
    if (m.jumpCool > 0 || !m.onGround || m.inWater || m.inLava || m.target || m.inLove > 0 || m.isBaby) return false;
    if (!this.pick()) { m.jumpCool = 20; return false; }
    return true;
  }
  canContinue() {
    const m = this.mob;
    if (this.t >= 80 || m.dead) return false;
    if (!this.up) return !m.inWater;
    // up: until it lands (in water or on the ground)
    return this.t <= this.prep + 1 || !(m.onGround || m.inWater);
  }
  pick() {
    const m = this.mob, T = m.m.t, x0 = Math.floor(m.pos.x), y0 = Math.floor(m.pos.y), z0 = Math.floor(m.pos.z);
    const spots = [], pads = [];
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (!dx && !dz) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const x = x0 + dx, y = y0 + dy, z = z0 + dz;
        const b = T.get(x, y, z), under = T.get(x, y - 1, z);
        if (b === B.lily_pad && !T.solid(x, y + 1, z)) { pads.push([x, y + 1 / 64, z]); continue; }
        if (T.solid(x, y, z) || T.solid(x, y + 1, z) || FLUID[b] || !T.solid(x, y - 1, z) || under === B.magma_block) continue;
        spots.push([x, y, z]);
      }
    }
    const tryList = list => {
      for (let n = 0; n < 12 && list.length; n++) {
        const s = list.splice(RI(list.length), 1)[0];
        const v = this.arc(s[0] + 0.5, s[1], s[2] + 0.5);
        if (v) { this.to = s; this.v = v; return true; }
      }
      return false;
    };
    return (pads.length && R() < 0.5 && tryList(pads)) || tryList(spots);
  }
  // the launch for a spot: horizontal speed and lift at the first angle that reaches it clear
  arc(tx, ty, tz) {
    const m = this.mob, g = m.gravity || 0.08, dx = tx - m.pos.x, dz = tz - m.pos.z, dy = ty - m.pos.y, d = Math.hypot(dx, dz);
    if (d < 0.5) return null;
    for (const a of FROG_ANGLES) {
      const tn = Math.tan(a * DEG), den = 2 * (d * tn - dy);
      if (den <= 0) continue;
      const h = Math.sqrt(g * d * d / den), vy = h * tn;
      if (Math.hypot(h, vy) > 1.5) continue;
      if (!this.clear(dx / d, dz / d, h, vy, d)) continue;
      return [dx / d * h, vy, dz / d * h];
    }
    return null;
  }
  // nothing solid along the arc (sampled every half block of the way, the box's middle)
  clear(ux, uz, h, vy, d) {
    const m = this.mob, T = m.m.t, g = m.gravity || 0.08;
    for (let s = 0.5; s < d; s += 0.5) {
      const t = s / h, y = m.pos.y + vy * t - g * t * t / 2 + m.h / 2;
      if (T.solid(Math.floor(m.pos.x + ux * s), Math.floor(y), Math.floor(m.pos.z + uz * s))) return false;
    }
    return true;
  }
  start() { this.t = 0; this.up = false; this.prep = 10; this.mob.nav.stop(); }
  stop() { this.mob.jumpCool = 100 + RI(41); this.up = false; this.to = null; }
  tick() {
    const m = this.mob, v = this.v;
    this.t++;
    if (!this.up) {
      // a moment to turn to the spot, then off
      const want = yawTo(v[0], v[2]);
      m.yaw = rotTowards(m.yaw, want, 30 * DEG); m.headYaw = m.bodyYaw = m.yaw;
      if (this.t >= this.prep || Math.abs(wrap(m.yaw - want)) < 1e-3 && this.t > 3) {
        m.yaw = m.bodyYaw = m.headYaw = want;
        m.vel.set(v[0], v[1], v[2]); m.onGround = false; this.up = true; this.prep = this.t;
      }
    }
  }
}
export class Frog extends Animal {
  static W = 0.5; static H = 0.5; static HEALTH = 10; static SPEED = 1; static SHADOW = 0.35; static WATER_SPEED = 0.06;
  static MODEL = 'frog'; static TEX = 'frog_temperate'; static FOOD = ['slime_ball'];
  constructor(m, type) { super(m, type); this.kind = 'temperate'; this.tongueT = 0; this.croakT = 0; this.jumpCool = 100 + RI(41); }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new FrogEatGoal(this));
    this.goals.add(2, new FrogBreedGoal(this, 1));
    this.goals.add(3, new TemptGoal(this, 1.25, ['slime_ball']));
    this.goals.add(4, new FrogLongJumpGoal(this));
    this.goals.add(5, new StrollGoal(this, 1, 60, false));
    this.goals.add(6, new LookAtPlayerGoal(this, 6));
    this.targets.add(1, new NearestMobTargetGoal(this, e => (e.type === 'slime' || e.type === 'magma_cube') && (e.size || 1) <= 1, true));
  }
  finalizeSpawn() {
    const T = this.m.t, temp = tempAt(this.m, Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
    this.kind = temp > 1 ? 'warm' : temp < 0.2 ? 'cold' : 'temperate';
    void T;
  }
  texName() { return 'frog_' + this.kind; }
  /* the game's frog steers as a swimmer does (its smooth swimming move control): it
     turns at most 10 degrees a tick, and out of the water goes at a tenth of its
     speed, a slow waddle between long jumps. (At its whole speed of 1 on land it
     shot a block or two a tick past where it was going and spun round to come back.) */
  moveControl() {
    const y0 = this.yaw;
    super.moveControl();
    this.yaw = rotTowards(y0, this.yaw, 10 * DEG);
    if (!this.inWater && this.zza) this.zza = this.moveSpeedNow * 0.1;
  }
  zzaScale() { return (this.moveSpeedNow || this.speed) * (this.inWater ? 1 : 0.1); }
  aiStep() {
    if (this.tongueT > 0) this.tongueT--;
    if (this.croakT > 0) this.croakT--; else if (RI(800) === 0) this.croakT = 60;
    if (this.jumpCool > 0 && this.onGround && !this.inWater) this.jumpCool--;
    super.aiStep();
  }
  loot() {}
  anim(A) { A.tongue = this.tongueT > 0; A.croak = this.croakT > 0 ? Math.sin(this.croakT * 0.5) : 0; A.swim = this.inWater; A.air = !this.onGround && !this.inWater; }
  toJSON() { const o = super.toJSON(); o.kd = this.kind; return o; }
  fromJSON(o) { super.fromJSON(o); this.kind = o.kd || 'temperate'; }
}
register('frog', Frog);
model('frog', [
  { name: 'body', pivot: [0, 22, 4], boxes: [[-3.5, -2, -8, 7, 3, 9, 3, 1], [-3.5, -1, -8, 7, 0, 9, 23, 22]] },
  { name: 'head', parent: 'body', pivot: [0, -2, -1], boxes: [[-3.5, -1, -7, 7, 0, 9, 23, 13], [-3.5, -2, -7, 7, 3, 9, 0, 13]] },
  { name: 'rightEye', parent: 'head', pivot: [-2.5, -3, -5.5], boxes: [[-1.5, -1, -1.5, 3, 2, 3, 0, 0]] },
  { name: 'leftEye', parent: 'head', pivot: [2.5, -3, -5.5], boxes: [[-1.5, -1, -1.5, 3, 2, 3, 0, 5]] },
  { name: 'croak', parent: 'body', pivot: [0, -1, -5], boxes: [[-3.5, -0.1, -2.9, 7, 2, 3, 26, 5, -0.1]] },
  { name: 'tongue', parent: 'body', pivot: [0, -1.01, 1], boxes: [[-2, 0, -7.1, 4, 0, 7, 17, 13]] },
  { name: 'leftArm', parent: 'body', pivot: [4, -1, -6.5], boxes: [[-1, 0, -1, 2, 3, 3, 0, 32], [-4, 3.01, -5, 8, 0, 8, 18, 40]] },
  { name: 'rightArm', parent: 'body', pivot: [-4, -1, -6.5], boxes: [[-1, 0, -1, 2, 3, 3, 0, 38], [-4, 3.01, -5, 8, 0, 8, 2, 40]] },
  { name: 'leftLeg', pivot: [3.5, 21, 4], boxes: [[-1, 0, -2, 3, 3, 4, 14, 25], [-2, 3.01, -4, 8, 0, 8, 2, 32]] },
  { name: 'rightLeg', pivot: [-3.5, 21, 4], boxes: [[-2, 0, -2, 3, 3, 4, 0, 25], [-6, 3.01, -4, 8, 0, 8, 18, 32]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw * 0.3);
  set(P, I.tongue, SC, A.tongue ? 1 : 0.001);
  set(P, I.croak, SC, A.croak > 0 ? 1 + A.croak * 0.4 : 0.001);
  if (A.swim) {
    // kicking: the legs together, straight back
    set(P, I.leftLeg, RX, 0.9 + Math.cos(A.age * 0.6) * 0.5); set(P, I.rightLeg, RX, 0.9 + Math.cos(A.age * 0.6) * 0.5);
  } else if (A.air) {
    set(P, I.leftLeg, RX, 1.2); set(P, I.rightLeg, RX, 1.2); set(P, I.leftArm, RX, -0.6); set(P, I.rightArm, RX, -0.6);
  } else {
    set(P, I.leftLeg, RX, Math.cos(w) * 0.6 * s); set(P, I.rightLeg, RX, Math.cos(w + PI) * 0.6 * s);
    set(P, I.leftArm, RX, Math.cos(w + PI) * 0.6 * s); set(P, I.rightArm, RX, Math.cos(w) * 0.6 * s);
  }
});
const FROG_ART = { temperate: [0xc87a3a, 0xe0a060, 0x8a4a22], warm: [0xe8dcc0, 0xf4ece0, 0xb8a888], cold: [0x5a8a52, 0x82b070, 0x3a6034] };
for (const k of FROG_KINDS) addArt('frog_' + k, [48, 48], p => {
  const [base, light, dark] = FROG_ART[k];
  p.clear(0, 0, 48, 48);
  const skin = (x, y, w, h) => { p.fill(x, y, w, h, base, 0.06); p.speckle(x, y, w, h, dark, 0.15); };
  p.box(3, 1, 7, 3, 9, { all: skin, bottom: light });
  p.box(0, 13, 7, 3, 9, { all: skin });
  p.fill(23 + 9, 13, 7, 9, light, 0.05); p.fill(23 + 9, 22, 7, 9, light, 0.05);
  // the eyes: dark with a light band
  for (const v of [0, 5]) { p.box(0, v, 3, 2, 3, base, 0.05); p.fill(3, v + 3, 3, 1, 0x101010); p.px(4, v + 3, 0xe0d070); }
  p.box(26, 5, 7, 2, 3, light, 0.05);
  p.fill(17, 13, 4, 14, 0xd06070, 0.05);                                                // the tongue
  for (const [u, v] of [[0, 32], [0, 38], [14, 25], [0, 25]]) p.box(u, v, 3, 3, 4, { all: skin });
  for (const [u, v] of [[18, 40], [2, 40], [2, 32], [18, 32]]) { p.fill(u + 8, v, 8, 8, dark, 0.05); p.clear(u + 8, v + 2, 1, 4); p.clear(u + 15, v + 2, 1, 4); }
});
export class Tadpole extends Mob {
  static W = 0.4; static H = 0.3; static HEALTH = 6; static SPEED = 1; static CATEGORY = 'water_ambient'; static WATER_BREATHER = 'only';
  static MODEL = 'tadpole'; static TEX = 'tadpole'; static SHADOW = 0.15;
  constructor(m, type) { super(m, type); this.want = null; this.swimSpeed = 0; this.growT = 24000; }
  registerGoals() {
    this.goals.add(0, new PanicGoal(this, 1.25));
    this.goals.add(4, new SwimGoal(this, 1, 30));
  }
  swimTo(x, y, z, sp) { this.want = [x, y, z, sp]; }
  swimStop() { this.want = null; }
  moveControl() {
    const v = this.vel, w = this.want;
    if (w && this.inWater) {
      this.swimSpeed += (w[3] * 0.4 - this.swimSpeed) * 0.125;
      const dx = w[0] - this.pos.x, dy = w[1] - this.pos.y, dz = w[2] - this.pos.z, d = Math.hypot(dx, dy, dz);
      if (d > 1e-6) v.y += this.swimSpeed * (dy / d) * 0.1;
      this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 90 * DEG);
      this.zza = this.swimSpeed;
      if (d < 0.5) this.want = null;
    } else this.zza = 0;
  }
  lookControl() {}
  bodyControl() { this.followYaw(); }
  travel() {
    if (this.inWater) { this.moveRelative(0.01, this.xxa, this.zza); this.move(this.vel.x, this.vel.y, this.vel.z); this.vel.multiplyScalar(0.9); }
    else super.travel();
  }
  aiStep() {
    if (!this.dead && !this.inWater && this.onGround && this.vCollide) { this.vel.y += 0.3; this.vel.x += (R() - 0.5) * 0.1; this.vel.z += (R() - 0.5) * 0.1; this.onGround = false; }
    super.aiStep();
    // grown: a frog in its place, the kind for where it is
    if (!this.dead && --this.growT <= 0) this.m.convertMob(this, 'frog', f => { if (f.finalizeSpawn) f.finalizeSpawn({}); });
  }
  interact(held) { if (held === 'slime_ball') { this.growT = Math.max(0, this.growT - 2400); return 'consume'; } return false; }
  loot() {}
  get xp() { return 0; }
  rootPose(root, t, a, A) { root.multiply(t.makeRotationY(Math.sin(A.age * 0.9) * 0.15)); }
  toJSON() { const o = super.toJSON(); o.gt = this.growT; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.gt !== undefined) this.growT = o.gt; }
}
register('tadpole', Tadpole);
model('tadpole', [
  { name: 'body', pivot: [0, 22, -3], boxes: [[-1.5, -1, 0, 3, 2, 3, 0, 0]] },
  { name: 'tail', parent: 'body', pivot: [0, 0, 3], boxes: [[0, -1, 0, 0, 2, 7, 0, 0]] },
], (m, P, A) => { set(P, m.index.tail, RY, Math.sin(A.age * 0.9) * 0.6); });
addArt('tadpole', [16, 16], p => { p.clear(0, 0, 16, 16); p.box(0, 0, 3, 2, 3, 0x3a2e24, 0.1); p.px(3, 3, 0xe0e0c0); p.px(5, 3, 0xe0e0c0); p.fill(0, 5, 10, 2, 0x4a3e30, 0.1); });
