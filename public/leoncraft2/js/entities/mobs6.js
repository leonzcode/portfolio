/* ---------------------------------------------------------------------------
   Leoncraft 2 - the flyers and swimmers that had no mob yet (their spawn
   eggs did nothing): parrots, bees, allays, happy ghasts, phantoms and
   vexes; dolphins, turtles, axolotls, nautiluses and zombie nautiluses,
   guardians and elder guardians.

   A flyer has no gravity and steers straight at where it wants to be (a
   wanted speed in blocks a tick, eased in), and its navigation is a stand-in
   that turns the usual goals' "walk there" into "fly there", so tempting,
   panicking and fighting work as they do on the ground. A swimmer steers
   the fish's way (mobs3.js). Numbers from the Minecraft Wiki (Java Edition);
   the shapes are boxes in the game's units, the textures our own.
--------------------------------------------------------------------------- */
import { Mob, Living, DEG, wrap, yawTo, rotTowards, Goal, MOVE, LOOK, JUMP, TARGET, looted } from './entity.js?v=107';
import { FloatGoal, PanicGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, TemptGoal, BreedGoal, FollowParentGoal,
  MeleeAttackGoal, AvoidGoal, HurtByTargetGoal, NearestPlayerTargetGoal, NearestMobTargetGoal, SwimGoal, randomLandPos } from './ai.js?v=107';
import { Animal, Monster, register, TYPES } from './mobs.js?v=107';
import { model } from './mobs2.js?v=107';
import { addArt } from './mobart.js?v=107';
import { MODELS } from './mobmodels.js?v=107';
import { B, BLOCKS, FLUID, SOLID } from '../blocks.js?v=107';
import { activeDrops } from '../drops.js?v=107';
import { ITEMS, I } from '../items.js?v=107';

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const POSE = 7, RX = 3, RY = 4, RZ = 5, SC = 6;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };

/* ===========================================================================
   Flying
=========================================================================== */
// "walk there" for a flyer: fly there instead (a little above the spot)
class FlyNav {
  constructor(mob) { this.mob = mob; this.speed = 1; }
  moveTo(x, y, z, speed) { this.speed = speed; this.mob.flyTo(x, y + 0.5, z, speed); return true; }
  isDone() { return !this.mob.dest; }
  stop() { this.mob.dest = null; }
  tick() {}
}
export class Flyer extends Mob {
  static FLYING = true; static NO_FALL = true; static FLY_SPEED = 0.15;
  constructor(m, type) { super(m, type); this.gravity = 0; this.dest = null; this._nav = new FlyNav(this); }
  // the manager gives every mob a walking navigation; a flyer keeps its own
  get nav() { return this._nav; }
  set nav(n) {}
  flyTo(x, y, z, speed) { this.dest = [x, y, z, speed || 1]; }
  moveControl() {
    const v = this.vel, d = this.dest;
    if (!d) { this.zza = 0; return; }
    const dx = d[0] - this.pos.x, dy = d[1] - this.pos.y, dz = d[2] - this.pos.z, l = Math.hypot(dx, dy, dz);
    if (l < 0.4) { this.dest = null; return; }
    const sp = d[3] * this.constructor.FLY_SPEED, k = this.constructor.STEER || 0.15;
    v.x += (dx / l * sp - v.x) * k; v.y += (dy / l * sp - v.y) * k; v.z += (dz / l * sp - v.z) * k;
    /* it faces the way it is flying, as the game's flyers do (they go where they face); turned to
       the spot instead, a phantom going round flew a quarter sideways, and anything curving with it.
       Barely moving, it turns to the spot. */
    if (v.x * v.x + v.z * v.z > 4e-4) this.yaw = rotTowards(this.yaw, yawTo(v.x, v.z), (this.constructor.TURN || 20) * DEG);
    else if (Math.abs(dx) + Math.abs(dz) > 0.05) this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 20 * DEG);
    this.zza = 0;
    // blocked: give up on that spot
    if (this.hCollide && R() < 0.1) this.dest = null;
  }
  travel() {
    const v = this.vel;
    this.move(v.x, v.y, v.z);
    const d = this.inWater ? 0.8 : this.inLava ? 0.5 : this.dest ? 0.98 : 0.91;
    v.x *= d; v.y *= d; v.z *= d;
    if (this.inWater) v.y += 0.01;
  }
  // an open spot of air within h across and v up or down, not far over the ground (keep low: lowMax)
  airSpot(h, vv, lowMax) {
    const T = this.m.t;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(this.pos.x) + RI(2 * h + 1) - h, z = Math.floor(this.pos.z) + RI(2 * h + 1) - h;
      let y = Math.floor(this.pos.y) + RI(2 * vv + 1) - vv;
      if (!T.loaded(x, z) || T.solid(x, y, z) || T.solid(x, y + 1, z) || FLUID[T.get(x, y, z)]) continue;
      if (lowMax) { let g = 0; while (g < lowMax + 2 && !T.solid(x, y - g - 1, z) && !FLUID[T.get(x, y - g - 1, z)]) g++; if (g > lowMax) y -= g - lowMax; }
      if (T.solid(x, y, z)) continue;
      return [x + 0.5, y + 0.2, z + 0.5];
    }
    return null;
  }
}
// wandering about the air, staying near the ground (or not)
class FlyWanderGoal extends Goal {
  constructor(mob, speed, interval = 40, lowMax = 6) { super(mob, MOVE); this.speed = speed; this.interval = interval; this.lowMax = lowMax; }
  canUse() {
    const m = this.mob;
    if (m.sitting || m.dest || RI(this.interval) !== 0) return false;
    this.p = m.airSpot(8, 4, this.lowMax);
    return !!this.p;
  }
  start() { this.mob.flyTo(this.p[0], this.p[1], this.p[2], this.speed); }
  canContinue() { return !!this.mob.dest; }
}
// following a player (a parrot or an allay with its owner): close in when further than start, stop within stop
class FlyFollowGoal extends Goal {
  constructor(mob, who, speed, start, stop) { super(mob, MOVE | LOOK); this.who = who; this.speed = speed; this.start2 = start * start; this.stop2 = stop * stop; }
  canUse() {
    const m = this.mob, p = this.who(m);
    if (!p || (p.alive && !p.alive()) || m.sitting) return false;
    return m.dist2(p.pos.x, p.pos.y, p.pos.z) > this.start2;
  }
  canContinue() { const m = this.mob, p = this.who(m); return !!p && !m.sitting && m.dist2(p.pos.x, p.pos.y, p.pos.z) > this.stop2; }
  tick() {
    const m = this.mob, p = this.who(m);
    m.lookAtEntity(p, 10, 40);
    // too far behind: straight to them
    if (m.dist2(p.pos.x, p.pos.y, p.pos.z) > 144 * 4) { m.setPos(p.pos.x + (R() - 0.5) * 2, p.pos.y + 1.5, p.pos.z + (R() - 0.5) * 2); m.dest = null; return; }
    if (m.age % 5 === 0 || !m.dest) m.flyTo(p.pos.x + (R() - 0.5), p.pos.y + 1.2, p.pos.z + (R() - 0.5), this.speed);
  }
  stop() { this.mob.dest = null; }
}

/* ---- Parrot: 6 health, 0.5 x 0.9; flies about low, follows its owner,
   sits when told; tamed with seeds (a third of the time); a cookie kills
   it. Five colours. Feathers when it dies. ---- */
const PARROT_KINDS = ['red_blue', 'blue', 'green', 'yellow_blue', 'gray'];
const SEEDS = ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'];
export class Parrot extends Flyer {
  static W = 0.5; static H = 0.9; static HEALTH = 6; static SPEED = 0.2; static FLY_SPEED = 0.2; static SHADOW = 0.3;
  static MODEL = 'parrot'; static TEX = 'parrot_red_blue'; static CATEGORY = 'creature'; static NO_DESPAWN = true;
  constructor(m, type) { super(m, type); this.kind = 'red_blue'; this.tamed = false; this.sitting = false; this.flap = 0; }
  get eyeH() { return 0.54; }
  registerGoals() {
    this.goals.add(0, new PanicGoal(this, 1.25));
    this.goals.add(2, new FlyFollowGoal(this, m => (m.tamed ? m.m.player : null), 1, 5, 1));
    this.goals.add(3, new FlyWanderGoal(this, 1, 40, 4));
    this.goals.add(4, new LookAtPlayerGoal(this, 8));
  }
  finalizeSpawn() { this.kind = PARROT_KINDS[RI(5)]; }
  texName() { return 'parrot_' + this.kind; }
  interact(held) {
    if (held === 'cookie') { this.hurt(1000, { type: 'poison', noKnock: true }); return 'consume'; }
    if (!this.tamed && SEEDS.indexOf(held) >= 0) {
      if (RI(3) === 0) { this.tamed = true; this.persistent = true; this.m.particles('heart', this.pos.x, this.pos.y + 0.6, this.pos.z, 7, 0.3); }
      else this.m.particles('smoke', this.pos.x, this.pos.y + 0.6, this.pos.z, 7, 0.3);
      return 'consume';
    }
    if (this.tamed && !held) { this.sitting = !this.sitting; this.dest = null; return 'swing'; }
    return false;
  }
  aiStep() {
    // no wings while sitting on the ground; otherwise it flaps and drifts down slowly
    if (this.sitting) { this.dest = null; this.vel.x *= 0.5; this.vel.z *= 0.5; this.vel.y = this.onGround ? 0 : -0.08; }
    else if (!this.dest && !this.onGround) this.vel.y -= 0.01;
    super.aiStep();
    this.flap = this.onGround ? this.flap * 0.8 : this.flap + 1;
  }
  loot(drop, byPlayer, L) { drop('feather', 1 + RI(2) + looted(L)); }
  get xp() { return 1 + RI(3); }
  anim(A) { A.flying = !this.onGround && !this.sitting; A.sitting = this.sitting; }
  toJSON() { const o = super.toJSON(); o.kd = this.kind; if (this.tamed) o.tm = 1; if (this.sitting) o.sit = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.kind = o.kd || 'red_blue'; this.tamed = !!o.tm; this.sitting = !!o.sit; }
}
register('parrot', Parrot);
model('parrot', [
  { name: 'body', pivot: [0, 16.5, -3], rot: [0.4937, 0, 0], boxes: [[-1.5, 0, -1.5, 3, 6, 3, 2, 8]] },
  { name: 'tail', pivot: [0, 21.07, 1.16], rot: [1.015, 0, 0], boxes: [[-1.5, -1, -1, 3, 4, 1, 22, 1]] },
  { name: 'leftWing', pivot: [1.5, 16.94, -2.76], rot: [-0.6981, -PI, 0], boxes: [[-0.5, 0, -1.5, 1, 5, 3, 19, 8]] },
  { name: 'rightWing', pivot: [-1.5, 16.94, -2.76], rot: [-0.6981, -PI, 0], boxes: [[-0.5, 0, -1.5, 1, 5, 3, 19, 8]] },
  { name: 'head', pivot: [0, 15.69, -2.76], boxes: [[-1, -1.5, -1, 2, 3, 2, 2, 2]] },
  { name: 'head2', parent: 'head', pivot: [0, -2, -1], boxes: [[-1, -0.5, -2, 2, 1, 4, 10, 0]] },
  { name: 'beak1', parent: 'head', pivot: [0, -0.5, -1.5], boxes: [[-0.5, -1, -0.5, 1, 2, 1, 11, 7]] },
  { name: 'beak2', parent: 'head', pivot: [0, -1.75, -2.45], boxes: [[-0.5, 0, -0.5, 1, 2, 1, 16, 7]] },
  { name: 'feather', parent: 'head', pivot: [0, -2.15, 0.15], rot: [-0.2214, 0, 0], boxes: [[0, -4, -2, 0, 5, 4, 2, 18]] },
  { name: 'leftLeg', pivot: [1, 22, -1.05], rot: [-0.0299, 0, 0], boxes: [[-0.5, 0, -0.5, 1, 2, 1, 14, 18]] },
  { name: 'rightLeg', pivot: [-1, 22, -1.05], rot: [-0.0299, 0, 0], boxes: [[-0.5, 0, -0.5, 1, 2, 1, 14, 18]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  if (A.flying) {
    const f = A.age * 0.9;
    set(P, I.leftWing, RZ, -0.0873 - Math.cos(f) * 0.6); set(P, I.rightWing, RZ, 0.0873 + Math.cos(f) * 0.6);
    set(P, I.leftLeg, RX, 0.7); set(P, I.rightLeg, RX, 0.7);
  } else {
    const w = A.walk * 0.6662, s = A.amt;
    set(P, I.leftLeg, RX, Math.cos(w) * 1.4 * s); set(P, I.rightLeg, RX, Math.cos(w + PI) * 1.4 * s);
  }
  if (A.sitting) for (const k of ['body', 'tail', 'leftWing', 'rightWing', 'head', 'leftLeg', 'rightLeg']) add(P, I[k], 1, 1.9);
});
const PARROT_ART = {
  red_blue: { body: 0xd02a20, wing: 0x2a5ad0, tail: 0xe8c838, head: 0xd02a20, beak: 0x3a3a3a },
  blue: { body: 0x2a6ad8, wing: 0x1a40a0, tail: 0x2a6ad8, head: 0x60a0e8, beak: 0x3a3a3a },
  green: { body: 0x5ac030, wing: 0x3a8a20, tail: 0x5ac030, head: 0xd02a20, beak: 0xe8a040 },
  yellow_blue: { body: 0x40b0e8, wing: 0x2a7ac0, tail: 0x40b0e8, head: 0xf0d020, beak: 0x3a3a3a },
  gray: { body: 0xb8b8b8, wing: 0x9a9a9a, tail: 0xd02a20, head: 0xd8d8d8, beak: 0x3a3a3a },
};
for (const k of PARROT_KINDS) addArt('parrot_' + k, [32, 32], p => {
  const c = PARROT_ART[k];
  p.clear(0, 0, 32, 32);
  p.box(2, 8, 3, 6, 3, c.body, 0.08); p.box(22, 1, 3, 4, 1, c.tail, 0.08); p.box(19, 8, 1, 5, 3, c.wing, 0.08);
  p.box(2, 2, 2, 3, 2, c.head, 0.06); p.box(10, 0, 2, 1, 4, c.head, 0.06);
  p.px(2, 5, 0xf0f0f0); p.px(7, 5, 0xf0f0f0); p.px(2, 4, 0x101010); p.px(7, 4, 0x101010);   // eyes on the sides
  p.box(11, 7, 1, 2, 1, c.beak, 0.05); p.box(16, 7, 1, 2, 1, c.beak, 0.05);
  p.fill(6, 18, 4, 5, c.head, 0.06); p.box(14, 18, 1, 2, 1, 0x5a5a5a, 0.05);
});

/* ---- Bee: 10 health, 0.7 x 0.6; flies about flowers; flowers tempt and
   breed. Hit, it and every bee near turn on whoever did it; a sting is 2
   damage and poison (10 seconds on Normal, 18 on Hard), and a bee that has
   stung loses its stinger and dies a little later. ---- */
const FLOWERS = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
  'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pitcher_plant', 'pink_petals', 'spore_blossom', 'flowering_azalea', 'wildflowers', 'open_eyeblossom', 'cactus_flower', 'golden_dandelion'];
class BeeAngerGoal extends HurtByTargetGoal {
  canUse() { return this.mob.angerT > 0 && !this.mob.stung && super.canUse(); }
}
export class Bee extends Flyer {
  static W = 0.7; static H = 0.6; static HEALTH = 10; static SPEED = 0.3; static FLY_SPEED = 0.12; static ATTACK = 2; static SHADOW = 0.35;
  static MODEL = 'bee'; static TEX = 'bee'; static CATEGORY = 'creature'; static NO_DESPAWN = true; static FOOD = FLOWERS;
  constructor(m, type) { super(m, type); this.ageT = 0; this.inLove = 0; this.angerT = 0; this.stung = false; this.dieT = -1; this.nectar = false; }
  get eyeH() { return 0.3; }
  registerGoals() {
    this.goals.add(0, new MeleeAttackGoal(this, 1.4, true));
    this.goals.add(2, new BreedGoal(this, 1));
    this.goals.add(3, new TemptGoal(this, 1.25, FLOWERS));
    this.goals.add(5, new FlyWanderGoal(this, 1, 30, 5));
    this.targets.add(1, new BeeAngerGoal(this, true));
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    const a = source.attacker;
    if (!a || a === this) return;
    // every bee about joins in
    this.angerT = 400 + RI(400);
    this.m.forNear(this.pos.x, this.pos.z, 20, o => { if (o.type === 'bee' && !o.dead && !o.stung) { o.angerT = 400 + RI(400); o.target = a; } });
  }
  doHurtTarget(t) {
    const ok = super.doHurtTarget(t);
    if (ok) {
      const d = this.m.difficulty;
      if (t.isPlayer) { if (d === 'normal') this.m.effectPlayer('poison', 200); else if (d === 'hard') this.m.effectPlayer('poison', 360); }
      else if (t.addEffect && d !== 'easy' && d !== 'peaceful') t.addEffect('poison', 1, d === 'hard' ? 360 : 200, this);
      this.stung = true; this.target = null; this.angerT = 0; this.dieT = 600 + RI(600);
    }
    return ok;
  }
  aiStep() {
    if (this.angerT > 0) this.angerT--;
    else if (this.target && !this.stung) this.target = null;
    if (this.stung && this.dieT > 0 && --this.dieT === 0) this.hurt(1000, { type: 'generic', noKnock: true });
    // now and then it bumbles to a flower nearby and takes its nectar
    if (!this.target && !this.dest && !this.nectar && RI(200) === 0) {
      const T = this.m.t;
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(this.pos.x) + RI(11) - 5, y = Math.floor(this.pos.y) + RI(5) - 2, z = Math.floor(this.pos.z) + RI(11) - 5;
        const d = BLOCKS[T.get(x, y, z)];
        if (d && FLOWERS.indexOf(d.name) >= 0) { this.flyTo(x + 0.5, y + 0.6, z + 0.5, 0.8); this.nectarT = 100; break; }
      }
    }
    if (this.nectarT > 0 && --this.nectarT === 0) this.nectar = true;
    if (this.ageT < 0) { if (++this.ageT === 0) {} } else if (this.ageT > 0) this.ageT--;
    if (this.inLove > 0) { this.inLove--; if (this.age % 10 === 0) this.m.particles('heart', this.pos.x, this.pos.y + this.h + 0.3, this.pos.z, 1, 0.4); }
    super.aiStep();
  }
  // fed a flower: babies grow, grown bees fall in love
  interact(held) {
    if (FLOWERS.indexOf(held) < 0) return false;
    if (this.ageT < 0) { this.ageT = Math.min(0, this.ageT + Math.floor(-this.ageT * 0.1)); return 'consume'; }
    if (this.ageT === 0 && !this.inLove) { this.inLove = 600; return 'consume'; }
    return false;
  }
  loot() {}
  get xp() { return this.ageT < 0 ? 0 : 1 + RI(3); }
  texName() { return this.angerT > 0 ? (this.nectar ? 'bee_angry_nectar' : 'bee_angry') : this.nectar ? 'bee_nectar' : 'bee'; }
  anim(A) { A.stung = this.stung; A.flying = !this.onGround; }
  rootPose(root, t, a, A) { if (A.flying) root.multiply(t.makeTranslation(0, Math.cos(A.age * 0.18) * 0.04, 0)); }
  toJSON() { const o = super.toJSON(); if (this.ageT) o.age = this.ageT; if (this.stung) o.st = 1; if (this.nectar) o.nc = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.ageT = o.age || 0; this.stung = !!o.st; this.nectar = !!o.nc; }
}
register('bee', Bee);
model('bee', [
  { name: 'body', pivot: [0, 19, 0], boxes: [[-3.5, -4, -5, 7, 7, 10, 0, 0]] },
  { name: 'stinger', parent: 'body', pivot: [0, 0, 0], boxes: [[0, -1, 5, 0, 1, 2, 26, 7]] },
  { name: 'leftAntenna', parent: 'body', pivot: [0, -2, -5], boxes: [[1.5, -2, -3, 1, 2, 3, 2, 0]] },
  { name: 'rightAntenna', parent: 'body', pivot: [0, -2, -5], boxes: [[-2.5, -2, -3, 1, 2, 3, 2, 3]] },
  { name: 'rightWing', pivot: [-1.5, 15, -3], rot: [0, -0.2618, 0], boxes: [[-9, 0, 0, 9, 0, 6, 0, 18]] },
  { name: 'leftWing', pivot: [1.5, 15, -3], rot: [0, 0.2618, 0], boxes: [[0, 0, 0, 9, 0, 6, 0, 18, 0, true]] },
  { name: 'frontLegs', pivot: [1.5, 22, -2], boxes: [[-5, 0, 0, 7, 2, 0, 26, 1]] },
  { name: 'midLegs', pivot: [1.5, 22, 0], boxes: [[-5, 0, 0, 7, 2, 0, 26, 3]] },
  { name: 'backLegs', pivot: [1.5, 22, 2], boxes: [[-5, 0, 0, 7, 2, 0, 26, 5]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.stinger, SC, A.stung ? 0.001 : 1);
  if (A.flying) {
    const f = A.age * 2.1;
    set(P, I.rightWing, RX, 0); set(P, I.rightWing, RZ, Math.cos(f) * PI * 0.15); set(P, I.leftWing, RZ, -Math.cos(f) * PI * 0.15);
    for (const k of ['frontLegs', 'midLegs', 'backLegs']) set(P, I[k], RX, PI / 4);
    set(P, I.body, RX, 0.1 + Math.cos(A.age * 0.18) * 0.05);
  }
});
function paintBee(p, angry, nectar) {
  const yellow = 0xf0c030, black = 0x2a2018, fuzz = 0xe8b028;
  p.clear(0, 0, 64, 64);
  // the body (0,0) 7x7x10: yellow with black bands round it
  p.box(0, 0, 7, 7, 10, { all: yellow }, 0.06);
  for (const z of [3, 6]) { p.fill(10 + 7 + z, 10, 1, 7, black); p.fill(z, 10, 1, 7, black); p.fill(7 + z, 0, 1, 10, 0); }
  for (const [x, w] of [[0, 10], [17, 10]]) for (const z of [3, 4, 6, 7]) p.fill(x + z, 10, 1, 7, black);
  p.fill(7, 0, 7, 10, yellow, 0.06); for (const z of [3, 4, 6, 7]) p.fill(7, z, 7, 1, black);
  p.speckle(0, 0, 34, 17, fuzz, 0.2);
  // the face (10,10): big eyes, angry red-rimmed when cross
  const eye = angry ? 0x8a1a1a : 0x1a1410;
  p.fill(10, 12, 2, 3, eye); p.fill(15, 12, 2, 3, eye); p.px(10, 12, 0xf0f0f0); p.px(16, 12, 0xf0f0f0);
  p.fill(12, 15, 3, 1, black);
  if (nectar) p.speckle(0, 0, 34, 17, 0xf8e070, 0.15);
  p.box(26, 7, 0, 1, 2, 0x3a3a3a, 0.04);
  p.box(2, 0, 1, 2, 3, black, 0.04); p.box(2, 3, 1, 2, 3, black, 0.04);
  // wings (0,18) 9x0x6: clear with white veins
  p.fill(6, 18, 9, 6, 0xd8eef8, 0.04); p.fill(15, 18, 9, 6, 0xd8eef8, 0.04);
  for (const x of [8, 11, 17, 20]) p.fill(x, 18, 1, 6, 0xf8ffff);
  for (const v of [1, 3, 5]) p.fill(26, v, 7, 2, black);
}
addArt('bee', [64, 64], p => paintBee(p, false, false));
addArt('bee_angry', [64, 64], p => paintBee(p, true, false));
addArt('bee_nectar', [64, 64], p => paintBee(p, false, true));
addArt('bee_angry_nectar', [64, 64], p => paintBee(p, true, true));

/* ---- Allay: 20 health, 0.35 x 0.6, flies; give it an item and it fetches
   that item: anything matching lying within 32 blocks it picks up and
   brings back to whoever gave it, and drops at their feet. Right click
   with an empty hand to take the item back. Blue and glowing. A note
   block played within 16 blocks of it is liked for 30 seconds: it stays
   by it and leaves what it fetches on top of it instead. ---- */
export class Allay extends Flyer {
  static W = 0.35; static H = 0.6; static HEALTH = 20; static SPEED = 0.1; static FLY_SPEED = 0.25; static SHADOW = 0.2; static BRIGHT = true;
  static MODEL = 'allay'; static TEX = 'allay'; static CATEGORY = 'creature'; static NO_DESPAWN = true; static GLOW = true;
  constructor(m, type) { super(m, type); this.carry = 0; this.want = null; this.dropCool = 0; this.note = null; this.noteT = 0; this.heard = null; this.gaveAt = null; }
  get eyeH() { return 0.36; }
  registerGoals() {
    this.goals.add(2, new FlyFollowGoal(this, m => (m.equip.mainhand ? m.deposit() : null), 1.2, 6, 2));
    this.goals.add(4, new FlyWanderGoal(this, 0.8, 40, 5));
    this.goals.add(5, new LookAtPlayerGoal(this, 6));
  }
  // where what it fetches goes: the note block it likes while it is still one (the spot over it), else the player
  deposit() {
    const n = this.noteT > 0 ? this.note : null, d = n && BLOCKS[this.m.t.get(n[0], n[1], n[2])];
    if (d && d.name === 'note_block') return this.noteSpot;
    return this.m.player;
  }
  interact(held) {
    if (!held && this.equip.mainhand) { this.m.dropAt(this, this.equip.mainhand, 1); if (this.carry) this.m.dropAt(this, this.equip.mainhand, this.carry); this.equip.mainhand = null; this.carry = 0; return 'swing'; }
    if (held && !this.equip.mainhand) { this.equip.mainhand = held; this.persistent = true; return 'consume'; }
    return false;
  }
  aiStep() {
    super.aiStep();
    this.gaveAt = null;
    if (this.dead) return;
    // a note block played within 16 blocks (the simulation keeps the last one played)
    const ln = this.m.sim && this.m.sim.lastNote;
    if (ln && ln !== this.heard) {
      this.heard = ln;
      if (this.dist2(ln.x + 0.5, ln.y + 0.5, ln.z + 0.5) <= 256) { this.note = [ln.x, ln.y, ln.z]; this.noteT = 600; this.noteSpot = { pos: { x: ln.x + 0.5, y: ln.y + 1, z: ln.z + 0.5 }, eyeH: 0.5, h: 1 }; }
    }
    if (this.noteT > 0) this.noteT--;
    if (!this.equip.mainhand) return;
    if (this.dropCool > 0) this.dropCool--;
    const D = activeDrops(), want = I[this.equip.mainhand], P = this.m.player, to = this.deposit();
    // carrying some: to the note block it likes, and left on top of it, or home to the player and at their feet
    if (this.carry > 0 && to && to !== P && this.dropCool <= 0 && this.dist2(to.pos.x, to.pos.y + 0.5, to.pos.z) < 9) {
      this.m.dropItemAt(to.pos.x, to.pos.y + 0.1, to.pos.z, this.equip.mainhand, this.carry); this.carry = 0; this.dropCool = 60; this.gaveAt = this.note.slice();
      return;
    }
    if (this.carry > 0 && to === P && P && P.alive() && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 6 && this.dropCool <= 0) {
      this.m.dropItemAt(P.pos.x, P.pos.y + 1, P.pos.z, this.equip.mainhand, this.carry); this.carry = 0; this.dropCool = 60;
      return;
    }
    if (!D || want === undefined || this.carry >= 64) return;
    // the nearest match lying about, within 32
    if (!this.want || this.want.gone) {
      this.want = null;
      if (this.age % 10 === 0) {
        let best = null, bd = 32 * 32;
        for (const e of D.items) { if (e.gone || !e.stack || e.stack.id !== want || e.delay > 0) continue; const d = this.dist2(e.pos.x, e.pos.y, e.pos.z); if (d < bd) { bd = d; best = e; } }
        this.want = best;
      }
    }
    const w = this.want;
    if (w) {
      this.flyTo(w.pos.x, w.pos.y + 0.3, w.pos.z, 1.3);
      if (this.dist2(w.pos.x, w.pos.y, w.pos.z) < 1.5) { this.carry += w.stack.count; D._remove(w, -1); this.want = null; }
    }
  }
  loot(drop) { if (this.equip.mainhand) drop(this.equip.mainhand, 1 + this.carry); }
  dropEquipment() {}
  get xp() { return 0; }
  anim(A) { A.flying = true; A.holding = !!this.equip.mainhand; }
  rootPose(root, t, a, A) { root.multiply(t.makeTranslation(0, Math.cos(A.age * 0.15) * 0.05, 0)); }
  toJSON() { const o = super.toJSON(); if (this.carry) o.cr = this.carry; return o; }
  fromJSON(o) { super.fromJSON(o); this.carry = o.cr || 0; }
}
register('allay', Allay);
// the allay and the vex share a shape: a small head, a body, two arms and two wings
const spiritParts = [
  { name: 'head', pivot: [0, 19.51, 0], boxes: [[-2.5, -5, -2.5, 5, 5, 5, 0, 0]] },
  { name: 'body', pivot: [0, 19.5, 0], boxes: [[-1.5, 0, -1, 3, 4, 2, 0, 10], [-1.5, 0, -1, 3, 5, 2, 0, 16, -0.2]] },
  { name: 'rightArm', parent: 'body', pivot: [-1.75, 0.5, 0], boxes: [[-0.75, -0.5, -1, 1, 4, 2, 23, 0, -0.01]] },
  { name: 'leftArm', parent: 'body', pivot: [1.75, 0.5, 0], boxes: [[-0.25, -0.5, -1, 1, 4, 2, 23, 6, -0.01]] },
  { name: 'rightWing', parent: 'body', pivot: [-0.5, 0, 0.6], boxes: [[0, 1, 0, 0, 5, 8, 16, 14]] },
  { name: 'leftWing', parent: 'body', pivot: [0.5, 0, 0.6], boxes: [[0, 1, 0, 0, 5, 8, 16, 14]] },
];
function spiritAnim(m, P, A) {
  const I = m.index, f = A.age * 0.6;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.rightWing, RY, 0.4 + Math.cos(f) * 0.6); set(P, I.leftWing, RY, -0.4 - Math.cos(f) * 0.6);
  set(P, I.rightWing, RX, 0.25); set(P, I.leftWing, RX, 0.25);
  set(P, I.body, RX, 0.3 * A.amt);
  if (A.holding || A.charging) { set(P, I.rightArm, RX, -1.0); set(P, I.leftArm, RX, -1.0); set(P, I.rightArm, RZ, 0.25); set(P, I.leftArm, RZ, -0.25); }
  else { set(P, I.rightArm, RX, Math.cos(A.age * 0.1) * 0.1); set(P, I.leftArm, RX, -Math.cos(A.age * 0.1) * 0.1); }
}
model('allay', spiritParts, spiritAnim);
addArt('allay', [32, 32], p => {
  const blue = 0x5ad8f8, light = 0xb8f4ff, dark = 0x2a98d0;
  p.clear(0, 0, 32, 32);
  p.box(0, 0, 5, 5, 5, { all: blue }, 0.05); p.speckle(0, 0, 20, 10, light, 0.15);
  p.fill(6, 7, 1, 2, 0x10405a); p.fill(8, 7, 1, 2, 0x10405a);
  p.box(0, 10, 3, 4, 2, { all: dark }, 0.05); p.box(0, 16, 3, 5, 2, { all: blue }, 0.06);
  p.box(23, 0, 1, 4, 2, blue, 0.05); p.box(23, 6, 1, 4, 2, blue, 0.05);
  p.fill(24, 22, 8, 5, light, 0.05); p.speckle(24, 22, 8, 5, 0xffffff, 0.3);
});

/* ---- Happy ghast: 20 health, 4 x 4, flies slowly; a snowball tempts it.
   Put a harness on it (right click) and up to four can ride: it goes the
   way the rider looks while forward is held, Space lifts it. A ghastling
   (from a dried ghast) is small and stays near its owner. ---- */
export class HappyGhast extends Flyer {
  static W = 4; static H = 4; static HEALTH = 20; static SPEED = 0.05; static FLY_SPEED = 0.06; static SCALE = 4; static SHADOW = 0; static STEER = 0.08;
  static MODEL = 'ghast'; static TEX = 'happy_ghast'; static CATEGORY = 'creature'; static NO_DESPAWN = true; static SEATS = 4; static HEAD_MAX = 0;
  constructor(m, type) { super(m, type); this.harness = null; this.ageT = 0; }
  get eyeH() { return 2.6; }
  registerGoals() {
    this.goals.add(3, new TemptGoal(this, 1.2, ['snowball']));
    this.goals.add(4, new FlyWanderGoal(this, 1, 60, 8));
    this.goals.add(5, new LookAtPlayerGoal(this, 8));
  }
  interact(held, player) {
    if (held && /_harness$/.test(held) && !this.harness && this.ageT >= 0) { this.harness = held.slice(0, -8); return 'consume'; }
    if (held === 'snowball' && this.health < this.maxHealth) { this.heal(1); return 'consume'; }
    if (held === 'shears' && this.harness && !this.passengers.length) { this.m.dropAt(this, this.harness + '_harness', 1); this.harness = null; return 'damage'; }
    if (this.harness && this.ageT >= 0) { this.m.mount(this); return 'swing'; }
    return false;
  }
  ridingOffset() { return 4.0; }
  seat(i, p) { const off = [[0, 0], [0.8, 0.8], [-0.8, 0.8], [0, -0.8]][i] || [0, 0]; return [off[0], 4.0 - (p && p.isPlayer ? 0.6 : 0), off[1]]; }
  rideControl(keys, rider) {
    this.yaw = rider.yaw; this.bodyYaw = this.headYaw = this.yaw;
    const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), side = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
    const sp = 0.18, pitch = rider.pitch || 0;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const tx = (-s * f - c * side) * sp * Math.cos(pitch), tz = (-c * f + s * side) * sp * Math.cos(pitch);
    const ty = (keys[' '] ? sp : 0) + f * Math.sin(pitch) * sp;
    const v = this.vel;
    v.x += (tx - v.x) * 0.1; v.y += (ty - v.y) * 0.1; v.z += (tz - v.z) * 0.1;
    this.dest = null;
    return true;
  }
  aiStep() { if (this.ageT < 0) this.ageT++; super.aiStep(); }
  loot() {}
  get xp() { return 0; }
  layers(out) { if (this.harness) out.push(['happy_ghast_harness', 'happy_ghast_harness', HARNESS_RGB[this.harness] || 0xffffff]); }
  toJSON() { const o = super.toJSON(); if (this.harness) o.hn = this.harness; if (this.ageT) o.age = this.ageT; return o; }
  fromJSON(o) { super.fromJSON(o); this.harness = o.hn || null; this.ageT = o.age || 0; }
}
register('happy_ghast', HappyGhast);
addArt('happy_ghast', [64, 64], p => {
  const white = 0xf2f0ee, shade = 0xdcd8d4;
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 16, 16, 16, { all: white }, 0.03); p.speckle(0, 0, 64, 32, shade, 0.12);
  // the face (16,16): closed happy eyes, a small smile, pink cheeks
  p.fill(19, 21, 3, 1, 0x3a3a3a); p.fill(26, 21, 3, 1, 0x3a3a3a); p.px(19, 20, 0x3a3a3a); p.px(28, 20, 0x3a3a3a);
  p.fill(22, 25, 4, 1, 0x3a3a3a); p.px(21, 24, 0x3a3a3a); p.px(26, 24, 0x3a3a3a);
  p.fill(17, 23, 2, 1, 0xf0a0b0); p.fill(29, 23, 2, 1, 0xf0a0b0);
  p.box(0, 32, 2, 14, 2, { all: white }, 0.04);
});
// the harness: a box a little bigger than the ghast, straps and a seat on top
model('happy_ghast_harness', [{ name: 'body', pivot: [0, 0, 0], boxes: [[-8, 8, -8, 16, 16, 16, 0, 0, 0.5]] }].concat(MODELS.ghast ? MODELS.ghast.parts.slice(1).map(pp => ({ name: pp.name, pivot: pp.pivot.slice(), boxes: [] })) : []), (m, P) => {});
const HARNESS_RGB = { white: 0xf0f0f0, orange: 0xf07a20, magenta: 0xc04ab8, light_blue: 0x40aad8, yellow: 0xf8d02c, lime: 0x78c020, pink: 0xf08aa8, gray: 0x4a5054, light_gray: 0x9c9c96, cyan: 0x169c9c, purple: 0x8a32b8, blue: 0x3a44a8, brown: 0x7e5030, green: 0x5a7a16, red: 0xa8302a, black: 0x1e1e22 };
// one harness in white and grey, tinted by its colour when drawn
addArt('happy_ghast_harness', [64, 64], p => {
  const col = 0xf4f4f4, leather = 0x8a8a8a;
  p.clear(0, 0, 64, 64);
  // the top (16,0): the seat pad, straps down the sides and round the middle
  p.fill(18, 2, 12, 12, col, 0.05); p.fill(18, 2, 12, 1, leather); p.fill(18, 13, 12, 1, leather);
  for (const x of [0, 16, 32, 48]) { p.fill(x + 7, 16, 2, 16, leather); p.fill(x, 22, 16, 2, leather); }
});

/* ---- Phantom: 20 health, 0.9 x 0.5; circles high over you, then swoops
   to bite (6 on Normal) and climbs again; burns in daylight. Its glowing
   green eyes. Drops phantom membrane (0-1) when a player kills it. ---- */
export class Phantom extends Flyer {
  static W = 0.9; static H = 0.5; static HEALTH = 20; static FLY_SPEED = 0.25; static ATTACK = 6; static SHADOW = 0.5; static UNDEAD = true;
  static MODEL = 'phantom'; static TEX = 'phantom'; static HOSTILE = true; static CATEGORY = 'monster'; static XP = 5; static FOLLOW = 64; static STEER = 0.1;
  constructor(m, type) { super(m, type); this.anchor = null; this.circleA = R() * PI * 2; this.swoop = false; this.swoopCool = 100; }
  get eyeH() { return 0.18; }
  registerGoals() { this.targets.add(1, new NearestPlayerTargetGoal(this, false)); }
  serverAi() {
    this.noActionTime++;
    this.m.despawnCheck(this);
    if (this.removed) return;
    this.targets.tick();
    const t = this.target, p = this.pos;
    if (!this.anchor) this.anchor = [p.x, p.y + 5, p.z];
    if (t && t.alive() && !(t.isPlayer && t.creative())) {
      this.anchor[0] += (t.pos.x - this.anchor[0]) * 0.05; this.anchor[2] += (t.pos.z - this.anchor[2]) * 0.05;
      this.anchor[1] = t.pos.y + 20 + RI(3);
    }
    if (this.swoop && t) {
      // down at the target; a bite, or anything in the way, ends it
      this.flyTo(t.pos.x, t.pos.y + 0.5, t.pos.z, 1.6);
      if (this.dist2(t.pos.x, t.pos.y + 0.5, t.pos.z) < 2) { this.doHurtTarget(t); this.swoop = false; this.swoopCool = 60 + RI(120); }
      else if (this.hCollide || this.vCollide) { this.swoop = false; this.swoopCool = 40; }
    } else {
      this.swoop = false;
      // round and round the anchor, 15 out
      this.circleA += 0.05;
      const a = this.anchor;
      this.flyTo(a[0] + Math.cos(this.circleA) * 15, a[1] + Math.sin(this.circleA * 1.7) * 2, a[2] + Math.sin(this.circleA) * 15, 1);
      if (t && --this.swoopCool <= 0 && this.canSee(t)) this.swoop = true;
    }
    this.moveControl();
    this.bodyYaw = this.headYaw = this.yaw;
    this.pitch = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z) + 1e-6);
  }
  aiStep() { this.sunBurn(); super.aiStep(); }
  sunBurn() { Monster.prototype.sunBurn.call(this); }
  walkValue() { return 0; }
  loot(drop, byPlayer, L) { if (byPlayer) drop('phantom_membrane', RI(2) + looted(L)); }
  anim(A) { A.flap = A.age * 0.35; }
  rootPose(root, t, a) { root.multiply(t.makeRotationX(-(this.prevPitch + (this.pitch - this.prevPitch) * a))); }
  layers(out) { out.push(['phantom', 'phantom_eyes', null, false, true]); }
}
register('phantom', Phantom);
model('phantom', [
  { name: 'body', pivot: [0, 20, 0], rot: [-0.1, 0, 0], boxes: [[-3, -2, -8, 5, 3, 9, 0, 8]] },
  { name: 'tailBase', parent: 'body', pivot: [0, -2, 1], boxes: [[-2, 0, 0, 3, 2, 6, 3, 20]] },
  { name: 'tailTip', parent: 'tailBase', pivot: [0, 0.5, 6], boxes: [[-1, 0, 0, 1, 1, 6, 4, 29]] },
  { name: 'leftWing', parent: 'body', pivot: [2, -2, -8], rot: [0, 0, 0.1], boxes: [[0, 0, 0, 6, 2, 9, 23, 12]] },
  { name: 'leftTip', parent: 'leftWing', pivot: [6, 0, 0], rot: [0, 0, 0.1], boxes: [[0, 0, 0, 13, 1, 9, 16, 24]] },
  { name: 'rightWing', parent: 'body', pivot: [-3, -2, -8], rot: [0, 0, -0.1], boxes: [[-6, 0, 0, 6, 2, 9, 23, 12, 0, true]] },
  { name: 'rightTip', parent: 'rightWing', pivot: [-6, 0, 0], rot: [0, 0, -0.1], boxes: [[-13, 0, 0, 13, 1, 9, 16, 24, 0, true]] },
  { name: 'head', parent: 'body', pivot: [0, 1, -7], rot: [0.2, 0, 0], boxes: [[-4, -2, -5, 7, 3, 5, 0, 0]] },
], (m, P, A) => {
  const I = m.index, f = Math.cos(A.flap || 0) * 16 * DEG;
  set(P, I.leftWing, RZ, f); set(P, I.leftTip, RZ, f); set(P, I.rightWing, RZ, -f); set(P, I.rightTip, RZ, -f);
  set(P, I.tailBase, RX, -(5 + Math.cos((A.flap || 0) * 2) * 5) * DEG); set(P, I.tailTip, RX, -(5 + Math.cos((A.flap || 0) * 2) * 5) * DEG);
});
addArt('phantom', [64, 64], p => {
  const skin = 0x4a5a8a, dark = 0x2e3a60, membrane = 0x8ab0c0, bone = 0x9aa4b8;
  p.clear(0, 0, 64, 64);
  p.box(0, 8, 5, 3, 9, { all: skin }, 0.08); p.speckle(0, 8, 28, 12, dark, 0.25);
  p.box(3, 20, 3, 2, 6, { all: skin }, 0.08); p.box(4, 29, 1, 1, 6, { all: dark }, 0.06);
  p.box(0, 0, 7, 3, 5, { all: skin }, 0.08);
  p.fill(5, 5, 2, 1, 0x101820); p.fill(9, 5, 2, 1, 0x101820);
  p.box(23, 12, 6, 2, 9, { all: membrane, top: skin }, 0.08); p.box(16, 24, 13, 1, 9, { all: membrane, top: skin }, 0.08);
  for (let x = 25; x < 38; x += 3) p.fill(x, 24, 1, 9, bone);
});
addArt('phantom_eyes', [64, 64], p => { p.clear(0, 0, 64, 64); p.fill(5, 5, 2, 1, 0x80ff70); p.fill(9, 5, 2, 1, 0x80ff70); });

/* ---- Vex: 14 health, 0.4 x 0.8; flies through walls; charges at its
   target with its sword (9 on Normal). One an evoker calls up wastes away
   after 30 to 119 seconds. ---- */
class VexChargeGoal extends Goal {
  constructor(mob) { super(mob, MOVE); }
  canUse() { const t = this.mob.target; return !!t && t.alive() && RI(7) === 0 && this.mob.dist2(t.pos.x, t.pos.y, t.pos.z) > 4; }
  canContinue() { const t = this.mob.target; return this.mob.charging && !!t && t.alive(); }
  start() { const t = this.mob.target; this.mob.charging = true; this.mob.flyTo(t.pos.x, t.pos.y + (t.h || 1.8) * 0.5, t.pos.z, 1); }
  stop() { this.mob.charging = false; }
  tick() {
    const m = this.mob, t = m.target;
    if (m.dist2(t.pos.x, t.pos.y + 0.9, t.pos.z) < 2.5) { m.doHurtTarget(t); m.charging = false; }
    else if (m.dist2(t.pos.x, t.pos.y, t.pos.z) < 9) m.flyTo(t.pos.x, t.pos.y + (t.h || 1.8) * 0.5, t.pos.z, 1);
  }
}
export class Vex extends Flyer {
  static W = 0.4; static H = 0.8; static HEALTH = 14; static FLY_SPEED = 0.35; static ATTACK = 9; static SHADOW = 0.25; static BRIGHT = true;
  static MODEL = 'vex'; static TEX = 'vex'; static HOSTILE = true; static CATEGORY = 'monster'; static XP = 3;
  static TURN = 180;          // (it faces its flight at once, as the game's vex does)
  constructor(m, type) { super(m, type); this.noPhysics = true; this.life = -1; this.charging = false; this.equip.mainhand = 'iron_sword'; this.dropChance = { mainhand: 0 }; }
  get eyeH() { return 0.5; }
  registerGoals() {
    this.goals.add(4, new VexChargeGoal(this));
    this.goals.add(8, new FlyWanderGoal(this, 0.25, 7, 0));
    this.goals.add(9, new LookAtPlayerGoal(this, 3));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(3, new NearestPlayerTargetGoal(this, true));
  }
  // through walls: no collision at all
  move(dx, dy, dz) { this.pos.x += dx; this.pos.y += dy; this.pos.z += dz; this.onGround = false; this.hCollide = false; this.vCollide = false; }
  aiStep() {
    super.aiStep();
    if (this.life > 0 && --this.life === 0) this.life = 20;
    if (this.life === 20 && this.age % 20 === 0) this.hurt(1, { type: 'starve', noKnock: true });
  }
  loot() {}
  texName() { return this.charging ? 'vex_charging' : 'vex'; }
  anim(A) { A.charging = this.charging; A.holding = false; }
  rootPose(root, t, a, A) { root.multiply(t.makeTranslation(0, Math.cos(A.age * 0.15) * 0.05, 0)); }
}
register('vex', Vex);
model('vex', spiritParts, spiritAnim);
function paintVex(p, charging) {
  const grey = 0xb8c4cc, dark = 0x7a8894, wing = 0xe8f0f8;
  p.clear(0, 0, 32, 32);
  p.box(0, 0, 5, 5, 5, { all: grey }, 0.06);
  p.fill(6, 7, 1, 1, charging ? 0xd03030 : 0x1a1a2a); p.fill(8, 7, 1, 1, charging ? 0xd03030 : 0x1a1a2a);
  p.fill(6, 8, 3, 1, charging ? 0x3a0a0a : dark);
  p.box(0, 10, 3, 4, 2, { all: dark }, 0.06); p.box(0, 16, 3, 5, 2, { all: grey }, 0.06);
  p.box(23, 0, 1, 4, 2, grey, 0.05); p.box(23, 6, 1, 4, 2, grey, 0.05);
  p.fill(24, 22, 8, 5, wing, 0.04);
}
addArt('vex', [32, 32], p => paintVex(p, false));
addArt('vex_charging', [32, 32], p => paintVex(p, true));

/* ===========================================================================
   Swimming
=========================================================================== */
const lerp = (a, b, t) => a + (b - a) * t;
export class Swimmer extends Mob {
  static SWIM = 0.5;
  constructor(m, type) { super(m, type); this.want = null; this.swimSpeed = 0; }
  swimTo(x, y, z, sp) { if (this.want) { this.want[0] = x; this.want[1] = y; this.want[2] = z; this.want[3] = sp; } else this.want = [x, y, z, sp]; }
  swimStop() { this.want = null; }
  moveControl() {
    if (!this.inWater) return super.moveControl();
    const v = this.vel, w = this.want;
    if (w) {
      this.swimSpeed = lerp(this.swimSpeed, w[3] * this.constructor.SWIM, 0.125);
      const dx = w[0] - this.pos.x, dy = w[1] - this.pos.y, dz = w[2] - this.pos.z, d = Math.hypot(dx, dy, dz);
      if (d > 1e-6) v.y += this.swimSpeed * (dy / d) * 0.1;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 20 * DEG);
      this.zza = this.swimSpeed;
      if (d < 0.8) this.want = null;
    } else { this.swimSpeed = 0; this.zza = 0; }
  }
  travel() {
    if (this.inWater) {
      this.moveRelative(0.02, this.xxa, this.zza);
      this.move(this.vel.x, this.vel.y, this.vel.z);
      this.vel.multiplyScalar(0.9);
    } else super.travel();
  }
}
// swimming goals and the ground's both go through nav: in water, nav.moveTo becomes swimTo
class SwimNav {
  constructor(mob, walk) { this.mob = mob; this.walk = walk; this.speed = 1; }
  moveTo(x, y, z, speed, r) { this.speed = speed; if (this.mob.inWater) { this.mob.swimTo(x, y, z, speed); return true; } return this.walk ? this.walk.moveTo(x, y, z, speed, r) : false; }
  isDone() { return this.mob.inWater ? !this.mob.want : (this.walk ? this.walk.isDone() : true); }
  stop() { this.mob.want = null; if (this.walk) this.walk.stop(); }
  tick() { if (!this.mob.inWater && this.walk) this.walk.tick(); }
  get path() { return this.walk && this.walk.path; }
}
function amphibious(cls) {
  Object.defineProperty(cls.prototype, 'nav', {
    get() { return this._snav; },
    set(n) { this._snav = new SwimNav(this, n); },
    configurable: true,
  });
}

/* ---- Dolphin: 10 health, 0.9 x 0.6; fast (1.2), breathes air (4 minutes
   of it, then up to the surface), leaps out of the water; swimmers nearby
   get Dolphin's Grace. Hit, the pod turns on you (3 damage). Raw cod or
   salmon tempts it. ---- */
export class Dolphin extends Swimmer {
  static W = 0.9; static H = 0.6; static HEALTH = 10; static SPEED = 1.2; static SWIM = 1.2; static ATTACK = 3; static SHADOW = 0.5;
  static MODEL = 'dolphin'; static TEX = 'dolphin'; static WATER_BREATHER = true; static CATEGORY = 'water_creature'; static NO_DESPAWN = true;
  constructor(m, type) { super(m, type); this.breath = 4800; }
  registerGoals() {
    this.goals.add(0, new BreatheGoal(this));
    this.goals.add(2, new MeleeAttackGoal(this, 1.2, true));
    this.goals.add(3, new TemptGoal(this, 1.2, ['cod', 'salmon']));
    this.goals.add(4, new SwimGoal(this, 1, 10));
    this.goals.add(5, new LookAtPlayerGoal(this, 6));
    this.targets.add(1, new HurtByTargetGoal(this, true));
  }
  aiStep() {
    if (this.inWater && this.eyeInWater) { if (--this.breath <= 0) { this.breath = 0; if (this.age % 20 === 0) this.hurt(2, { type: 'drown' }); } }
    else this.breath = 4800;
    super.aiStep();
    if (this.dead) return;
    // a leap now and then, swimming fast near the top
    if (this.inWater && !this.eyeInWater && this.swimSpeed > 0.3 && RI(30) === 0) this.vel.y += 0.5;
    // Dolphin's Grace for a swimming player within 10
    const P = this.m.player;
    if (P && P.alive() && this.age % 20 === 0 && this.m.P.inWater && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 100) this.m.effectPlayer('dolphins_grace', 100);
  }
  loot(drop, byPlayer, L) { drop(this.fire > 0 ? 'cooked_cod' : 'cod', RI(2) + looted(L)); }
  get xp() { return 1 + RI(3); }
  rootPose(root, t, a) { root.multiply(t.makeRotationX(-Math.max(-0.6, Math.min(0.6, (this.vel.y) * 1.5)))); }
}
class BreatheGoal extends Goal {
  constructor(mob) { super(mob, MOVE); }
  canUse() { return this.mob.inWater && this.mob.breath < 600; }
  canContinue() { return this.mob.inWater && this.mob.breath < 4700; }
  tick() {
    const m = this.mob, T = m.m.t;
    let y = Math.floor(m.pos.y);
    while (y < Math.floor(m.pos.y) + 32 && FLUID[T.get(Math.floor(m.pos.x), y, Math.floor(m.pos.z))] === 1) y++;
    m.swimTo(m.pos.x, y + 0.5, m.pos.z, 1.3);
  }
}
register('dolphin', Dolphin);
model('dolphin', [
  { name: 'body', pivot: [0, 22, -5], boxes: [[-4, -7, 0, 8, 7, 13, 22, 0]] },
  { name: 'backFin', parent: 'body', pivot: [0, -7, 5], rot: [1.0472, 0, 0], boxes: [[-0.5, 0, 0, 1, 4, 5, 51, 0]] },
  { name: 'leftFin', parent: 'body', pivot: [2, -2, 4], rot: [1.0472, 0, 2.0944], boxes: [[-0.5, -4, 0, 1, 4, 7, 48, 20]] },
  { name: 'rightFin', parent: 'body', pivot: [-2, -2, 4], rot: [1.0472, 0, -2.0944], boxes: [[-0.5, -4, 0, 1, 4, 7, 48, 20, 0, true]] },
  { name: 'tail', parent: 'body', pivot: [0, -2.5, 11], rot: [-0.1047, 0, 0], boxes: [[-2, -2.5, 0, 4, 5, 11, 0, 19]] },
  { name: 'tailFin', parent: 'tail', pivot: [0, 0, 9], boxes: [[-5, -0.5, 0, 10, 1, 6, 19, 20]] },
  { name: 'head', parent: 'body', pivot: [0, -4, -3], boxes: [[-4, -3, -3, 8, 7, 6, 0, 0], [-1, 2, -7, 2, 2, 4, 0, 13]] },
], (m, P, A) => {
  const I = m.index, f = Math.cos(A.age * 0.3) * 0.15 * (0.3 + A.amt);
  set(P, I.tail, RX, -0.1047 + f); set(P, I.tailFin, RX, f * 1.5);
});
addArt('dolphin', [64, 64], p => {
  const grey = 0x8a9aa8, dark = 0x5a6878, belly = 0xd8e0e8;
  p.clear(0, 0, 64, 64);
  p.box(22, 0, 8, 7, 13, { all: grey, top: dark, bottom: belly }, 0.05);
  p.fill(22, 13 + 4, 13, 3, belly, 0.04); p.fill(43, 13 + 4, 13, 3, belly, 0.04);
  p.box(0, 0, 8, 7, 6, { all: grey, top: dark, bottom: belly }, 0.05);
  p.fill(1, 9, 1, 1, 0x101418); p.fill(19, 9, 1, 1, 0x101418);
  p.box(0, 13, 2, 2, 4, { all: grey }, 0.05);
  p.box(51, 0, 1, 4, 5, dark, 0.05); p.box(48, 20, 1, 4, 7, dark, 0.05);
  p.box(0, 19, 4, 5, 11, { all: grey, top: dark, bottom: belly }, 0.05); p.box(19, 20, 10, 1, 6, dark, 0.05);
});

/* ---- Turtle: 30 health, 1.2 x 0.4; slow on land (0.25), quick in the
   water; seagrass to tempt and breed: a turtle that has bred lays 1 to 4
   eggs on sand nearby. Babies drop a scute when they grow up. ---- */
export class Turtle extends Animal {
  static W = 1.2; static H = 0.4; static HEALTH = 30; static SPEED = 0.25; static SHADOW = 0.7; static WATER_BREATHER = true; static WATER_SPEED = 0.1; static WATER_DRAG = 0.9;
  static MODEL = 'turtle'; static TEX = 'turtle'; static FOOD = ['seagrass'];
  constructor(m, type) { super(m, type); this.want = null; this.swimSpeed = 0; this.eggs = false; }
  registerGoals() {
    this.goals.add(0, new PanicGoal(this, 1.2));
    this.goals.add(1, new BreedGoal(this, 1));
    this.goals.add(2, new TemptGoal(this, 1.1, ['seagrass']));
    this.goals.add(4, new SwimGoal(this, 1, 60));
    this.goals.add(5, new StrollGoal(this, 1, 100, false));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
  }
  swimTo(x, y, z, sp) { this.want = [x, y, z, sp]; }
  swimStop() { this.want = null; }
  moveControl() {
    if (this.inWater && this.want) {
      const w = this.want, v = this.vel;
      this.swimSpeed = lerp(this.swimSpeed, w[3] * 0.4, 0.125);
      const dx = w[0] - this.pos.x, dy = w[1] - this.pos.y, dz = w[2] - this.pos.z, d = Math.hypot(dx, dy, dz);
      if (d > 1e-6) v.y += this.swimSpeed * (dy / d) * 0.1;
      this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 15 * DEG);
      this.zza = this.swimSpeed;
      if (d < 1) this.want = null;
      return;
    }
    super.moveControl();
  }
  aiStep() {
    super.aiStep();
    // a turtle that has bred lays its eggs on sand close by
    if (this.eggs && this.onGround && !this.inWater && RI(100) === 0) {
      const T = this.m.t, x = Math.floor(this.pos.x), y = Math.floor(this.pos.y), z = Math.floor(this.pos.z);
      if ((T.get(x, y - 1, z) === B.sand) && !T.get(x, y, z) && B.turtle_egg !== undefined && this.m.world) { this.m.world.set(x, y, z, B.turtle_egg, RI(4)); this.eggs = false; }
    }
  }
  grewUp() { this.m.dropAt(this, 'turtle_scute', 1); }
  loot(drop, byPlayer, L) { drop('seagrass', RI(3) + looted(L)); }
  walkValue(x, y, z) { return this.m.t.get(x, y - 1, z) === B.sand ? 10 : 0; }
  toJSON() { const o = super.toJSON(); if (this.eggs) o.eg = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.eggs = !!o.eg; }
}
amphibious(Turtle);
register('turtle', Turtle);
model('turtle', [
  { name: 'head', pivot: [0, 19, -10], boxes: [[-3, -1, -3, 6, 5, 6, 3, 0]] },
  { name: 'body', pivot: [0, 11, -10], rot: [PI / 2, 0, 0], boxes: [[-9.5, 3, -10, 19, 20, 6, 7, 37], [-5.5, 3, -13, 11, 18, 3, 31, 1]] },
  { name: 'rightHind', pivot: [-3.5, 22, 11], boxes: [[-2, 0, 0, 4, 1, 10, 1, 23]] },
  { name: 'leftHind', pivot: [3.5, 22, 11], boxes: [[-2, 0, 0, 4, 1, 10, 1, 12]] },
  { name: 'rightFront', pivot: [-5, 21, -4], boxes: [[-13, 0, -2, 13, 1, 5, 27, 30]] },
  { name: 'leftFront', pivot: [5, 21, -4], boxes: [[0, 0, -2, 13, 1, 5, 27, 24]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw);
  set(P, I.rightHind, RX, Math.cos(w) * 0.5 * s); set(P, I.leftHind, RX, Math.cos(w + PI) * 0.5 * s);
  set(P, I.rightFront, RZ, Math.cos(w + PI) * 0.5 * s); set(P, I.leftFront, RZ, Math.cos(w) * 0.5 * s);
});
addArt('turtle', [128, 64], p => {
  const shell = 0x3a6a3a, plate = 0x5a8a3a, skin = 0x8ab060, belly = 0xd8d0a0;
  p.clear(0, 0, 128, 64);
  p.box(3, 0, 6, 5, 6, { all: skin }, 0.08); p.px(3 + 6 + 1, 6 + 2, 0x101010); p.px(3 + 6 + 4, 6 + 2, 0x101010);
  // the shell (7,37) 19x20x6 turned up: plates on its back face
  p.box(7, 37, 19, 20, 6, { all: shell }, 0.06);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) p.fill(38 + 1 + i * 4, 43 + 1 + j * 6, 3, 5, plate, 0.06);
  p.box(31, 1, 11, 18, 3, { all: belly }, 0.05);
  for (const [u, v] of [[1, 23], [1, 12]]) p.box(u, v, 4, 1, 10, { all: skin }, 0.08);
  for (const [u, v] of [[27, 30], [27, 24]]) p.box(u, v, 13, 1, 5, { all: skin }, 0.08);
});

/* ---- Axolotl: 14 health, 0.75 x 0.42; swims and walks; hunts fish,
   squid, drowned and guardians; badly hurt, it plays dead for a while and
   heals. Five colours (blue one time in 1200). A bucket of tropical fish
   feeds and breeds it. A water bucket scoops it up (manager.js). ---- */
const AXOLOTL_KINDS = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
export class Axolotl extends Animal {
  static W = 0.75; static H = 0.42; static HEALTH = 14; static SPEED = 1; static ATTACK = 2; static SHADOW = 0.4; static WATER_BREATHER = true; static WATER_SPEED = 0.06;
  static MODEL = 'axolotl'; static TEX = 'axolotl_lucy'; static FOOD = ['tropical_fish_bucket'];
  constructor(m, type) { super(m, type); this.kind = 'lucy'; this.want = null; this.swimSpeed = 0; this.deadT = 0; this.dryT = 6000; }
  registerGoals() {
    this.goals.add(0, new BreedGoal(this, 1));
    this.goals.add(1, new MeleeAttackGoal(this, 1, true));
    this.goals.add(2, new TemptGoal(this, 1.1, ['tropical_fish_bucket']));
    this.goals.add(4, new SwimGoal(this, 1, 30));
    this.goals.add(5, new StrollGoal(this, 0.5, 120, false));
    this.targets.add(1, new NearestMobTargetGoal(this, e => /^(cod|salmon|tropical_fish|pufferfish|squid|glow_squid|drowned|guardian|elder_guardian|tadpole)$/.test(e.type) && e.inWater, true));
  }
  finalizeSpawn() { this.kind = RI(1200) === 0 ? 'blue' : AXOLOTL_KINDS[RI(4)]; }
  texName() { return 'axolotl_' + this.kind; }
  swimTo(x, y, z, sp) { this.want = [x, y, z, sp]; }
  swimStop() { this.want = null; }
  moveControl() {
    if (this.deadT > 0) { this.zza = 0; return; }
    if (this.inWater && this.want) {
      const w = this.want, v = this.vel;
      this.swimSpeed = lerp(this.swimSpeed, w[3] * 0.35, 0.125);
      const dx = w[0] - this.pos.x, dy = w[1] - this.pos.y, dz = w[2] - this.pos.z, d = Math.hypot(dx, dy, dz);
      if (d > 1e-6) v.y += this.swimSpeed * (dy / d) * 0.1;
      this.yaw = rotTowards(this.yaw, yawTo(dx, dz), 20 * DEG);
      this.zza = this.swimSpeed;
      if (d < 0.8) this.want = null;
      return;
    }
    super.moveControl();
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    // badly hurt in water: it plays dead, and nothing goes after it meanwhile
    if (!this.dead && this.inWater && this.health < this.maxHealth / 2 && RI(3) !== 0 && this.deadT <= 0) { this.deadT = 200; this.target = null; }
  }
  aiStep() {
    if (this.deadT > 0) { this.deadT--; if (this.age % 20 === 0) this.heal(1); this.target = null; }
    // out of the water it dries out over five minutes
    if (this.inWater || (this.m.raining() && this.m.seesSky(Math.floor(this.pos.x), Math.floor(this.pos.y + 1), Math.floor(this.pos.z)))) this.dryT = 6000;
    else if (--this.dryT <= 0 && this.age % 20 === 0) this.hurt(1, { type: 'dry', noKnock: true });
    super.aiStep();
  }
  interact(held) {
    if (held === 'tropical_fish_bucket') {
      const r = this.feed();
      // the fish is eaten; the bucket goes back with water in it
      if (r) this.m.turnHeld('water_bucket');
      return r ? 'swing' : false;
    }
    return false;
  }
  loot() {}
  anim(A) { A.swim = this.inWater; A.playDead = this.deadT > 0; }
  rootPose(root, t, a, A) { if (A.playDead) root.multiply(t.makeRotationZ(PI)); }
  toJSON() { const o = super.toJSON(); o.kd = this.kind; return o; }
  fromJSON(o) { super.fromJSON(o); this.kind = o.kd || 'lucy'; }
}
amphibious(Axolotl);
register('axolotl', Axolotl);
model('axolotl', [
  { name: 'body', pivot: [0, 20, 5], boxes: [[-4, -2, -9, 8, 4, 10, 0, 11], [0, -3, -8, 0, 5, 9, 2, 17]] },
  { name: 'head', parent: 'body', pivot: [0, 0, -9], boxes: [[-4, -3, -5, 8, 5, 5, 0, 1]] },
  { name: 'topGills', parent: 'head', pivot: [0, -3, -1], boxes: [[-4, -3, 0, 8, 3, 0, 3, 37]] },
  { name: 'leftGills', parent: 'head', pivot: [4, 0, -1], boxes: [[0, -5, 0, 3, 7, 0, 11, 40]] },
  { name: 'rightGills', parent: 'head', pivot: [-4, 0, -1], boxes: [[-3, -5, 0, 3, 7, 0, 0, 40]] },
  { name: 'rightHind', parent: 'body', pivot: [-3.5, 1, -1], boxes: [[-1, 0, 0, 3, 5, 0, 2, 13]] },
  { name: 'leftHind', parent: 'body', pivot: [3.5, 1, -1], boxes: [[-2, 0, 0, 3, 5, 0, 2, 13]] },
  { name: 'rightFront', parent: 'body', pivot: [-3.5, 1, -8], boxes: [[-1, 0, 0, 3, 5, 0, 2, 13]] },
  { name: 'leftFront', parent: 'body', pivot: [3.5, 1, -8], boxes: [[-2, 0, 0, 3, 5, 0, 2, 13]] },
  { name: 'tail', parent: 'body', pivot: [0, 0, 1], boxes: [[0, -3, 0, 0, 5, 12, 2, 19]] },
], (m, P, A) => {
  const I = m.index, f = A.age * 0.3;
  set(P, I.head, RY, A.yaw * 0.5);
  set(P, I.leftGills, RY, 0.3 + Math.sin(f) * 0.15); set(P, I.rightGills, RY, -0.3 - Math.sin(f) * 0.15);
  if (A.swim) {
    set(P, I.tail, RY, Math.sin(f * 1.8) * 0.5);
    for (const k of ['rightHind', 'leftHind', 'rightFront', 'leftFront']) set(P, I[k], RX, 1.3);
  } else {
    const w = A.walk * 0.6662, s = A.amt;
    set(P, I.rightHind, RX, Math.cos(w) * s); set(P, I.leftHind, RX, Math.cos(w + PI) * s);
    set(P, I.rightFront, RX, Math.cos(w + PI) * s); set(P, I.leftFront, RX, Math.cos(w) * s);
    set(P, I.tail, RY, Math.sin(f) * 0.15);
  }
});
const AXOLOTL_ART = { lucy: [0xf4a8c0, 0xd85878, 0xc04060], wild: [0x8a6a4a, 0x5a4a32, 0xd8c87a], gold: [0xf0c050, 0xd89a30, 0xc87818], cyan: [0xd8f0f8, 0xa8d8e8, 0xd060a0], blue: [0x5a6ad8, 0x3a48a8, 0xf0d050] };
for (const k of AXOLOTL_KINDS) addArt('axolotl_' + k, [64, 64], p => {
  const [base, dark, gill] = AXOLOTL_ART[k];
  p.clear(0, 0, 64, 64);
  p.box(0, 11, 8, 4, 10, { all: base }, 0.06); p.speckle(0, 11, 36, 14, dark, 0.12);
  p.fill(11, 19, 9, 5, base, 0.05);
  p.box(0, 1, 8, 5, 5, { all: base }, 0.05);
  p.px(5, 8, 0x101010); p.px(10, 8, 0x101010); p.fill(6, 10, 4, 1, dark);
  p.fill(3, 37, 8, 3, gill, 0.06); p.fill(11, 40, 3, 7, gill, 0.06); p.fill(0, 40, 3, 7, gill, 0.06);
  p.fill(2, 13, 3, 5, dark, 0.06);
  p.fill(14, 19, 12, 5, base, 0.05); p.fill(14, 19, 12, 1, dark);
});

/* ---- Nautilus (and the zombie nautilus, its undead kind), as 26.x has
   them (Minecraft Wiki): 15 health, 0.875 x 0.95, 6.5 m/s in water and
   barely moving on land. Neutral: it turns on whatever hurts it. It follows
   a player holding any fish or bucket of fish (10 blocks); a pufferfish (or
   a bucket of one) tames it one time in three. Fish heal a tamed one
   (pufferfish 2, raw cod or salmon 4, cooked cod 10, cooked salmon 12).
   Tamed, it takes a saddle and nautilus armour (by hand, or in its screen:
   sneak and use it), and shears take them off again. Ridden, it goes the
   way you look; hold Space to charge a dash (up to about 12 blocks, one
   every 2 seconds), and its rider has Breath of the Nautilus, which keeps
   the air bar where it is. The zombie nautilus is the same but undead: it
   burns in daylight, never suffocates out of water, is a tenth faster and
   dashes a little further. A tamed one at full health fed a fish falls in
   love and breeds (a baby grows up in 20 minutes, each fish a tenth
   sooner); the undead kind never breeds. ---- */
const FISH_HEAL = { pufferfish: 2, pufferfish_bucket: 2, cod: 4, salmon: 4, cod_bucket: 4, salmon_bucket: 4, tropical_fish: 4, tropical_fish_bucket: 4, cooked_cod: 10, cooked_salmon: 12 };
const NAUTILUS_ARMOR = { copper: [4, 0], iron: [5, 0], golden: [7, 0], diamond: [11, 2], netherite: [19, 3] };
const itemNm = id => (ITEMS[id] ? ITEMS[id].name : '');
const heldOf = m => (m.inv && m.inv.slots[m.inv.selected]) || null;
function dropOne(e, st) {
  if (!st) return;
  const H = e.m.hooks && e.m.hooks.hands, D = H && H.drops;
  if (D && D.spawn) D.spawn(e.pos.x, e.pos.y + 0.5, e.pos.z, Object.assign({}, st, { count: st.count || 1 }));
  else e.m.dropItemAt(e.pos.x, e.pos.y + 0.5, e.pos.z, itemNm(st.id), st.count || 1);
}
export class Nautilus extends Swimmer {
  static W = 0.875; static H = 0.95; static HEALTH = 15; static SPEED = 0.3; static SWIM = 0.8; static SHADOW = 0.5; static ATTACK = 3;
  static MODEL = 'nautilus'; static TEX = 'nautilus'; static WATER_BREATHER = 'only'; static CATEGORY = 'water_creature'; static NO_DESPAWN = true;
  static RIDE_WATER = 0.325; static RIDE_LAND = 0.044; static DASH = 1.2;
  constructor(m, type) { super(m, type); this.saddled = false; this.tamed = false; this.body = null; this.dashCool = 0; this.charge = 0; this.ageT = 0; this.inLove = 0; }
  registerGoals() {
    this.goals.add(1, new MeleeAttackGoal(this, 1.2, true));
    this.goals.add(2, new BreedGoal(this, 1));
    this.goals.add(3, new TemptGoal(this, 1.1, Object.keys(FISH_HEAL)));
    this.goals.add(4, new SwimGoal(this, 1, 30));
    this.goals.add(5, new LookAtPlayerGoal(this, 6));
    // neutral: whatever hurts it is what it goes for (never its owner once tamed, see hurt)
    this.targets.add(1, new HurtByTargetGoal(this));
  }
  get armorKind() { return /_nautilus_armor$/; }
  get isBaby() { return this.ageT < 0; }
  aiStep() {
    super.aiStep();
    if (this.ageT < 0) this.ageT++;
    else if (this.ageT > 0) this.ageT--;
    if (this.inLove > 0) { this.inLove--; if (this.age % 10 === 0) this.m.particles('heart', this.pos.x, this.pos.y + this.h + 0.3, this.pos.z, 1, 0.4); }
  }
  setBody(st) {
    this.body = st || null;
    const a = st && NAUTILUS_ARMOR[itemNm(st.id).replace(/_nautilus_armor$/, '')];
    this.armor = a ? a[0] : 0; this.toughness = a ? a[1] : 0;
  }
  tame() {
    this.tamed = true; this.persistent = true; this.target = null;
    this.m.particles('heart', this.pos.x, this.pos.y + this.h * 0.8, this.pos.z, 7, this.w * 0.5);
  }
  // its screen (ui/containers.js MountScreen): the saddle, the armour
  mountSlots() { return { kinds: ['saddle', 'armor'], box: [this.saddled ? { id: I.saddle, count: 1 } : null, this.body || null], cols: 0 }; }
  mountChanged(i, st) { if (i === 0) this.saddled = !!st; else this.setBody(st || null); }
  openInventory() {
    const H = this.m.hooks && this.m.hooks.hands;
    if (!this.tamed || !H || !H.open || !MountScreenRef) return false;
    H.open(new MountScreenRef(H.inv, H.icons, this));
    return true;
  }
  interact(held, player) {
    if (this.tamed && player && player.sneaking && player.sneaking() && this.openInventory()) return 'swing';
    const heal = FISH_HEAL[held];
    if (heal !== undefined && !this.passengers.length) {
      const bucket = /_bucket$/.test(held);
      if (!this.tamed && /^pufferfish/.test(held)) {
        if (RI(3) === 0) this.tame(); else this.m.particles('smoke', this.pos.x, this.pos.y + this.h * 0.8, this.pos.z, 7, this.w * 0.5);
      } else if (this.ageT < 0) { this.ageT = Math.min(0, this.ageT + Math.floor(-this.ageT * 0.1)); this.m.particles('sparkle', this.pos.x, this.pos.y + this.h, this.pos.z, 4, 0.5); }
      else if (this.tamed && this.health < this.maxHealth) this.heal(heal);
      else if (this.tamed && !this.constructor.UNDEAD && this.ageT === 0 && !this.inLove) this.inLove = 600;
      else return false;
      // a bucket of fish leaves the bucket of water
      if (bucket) { this.m.turnHeld('water_bucket'); return 'swing'; }
      return 'consume';
    }
    if (!this.tamed) return false;
    if (held === 'saddle' && !this.saddled) { this.saddled = true; return 'consume'; }
    if (/_nautilus_armor$/.test(held || '') && !this.body) { const st = heldOf(this.m); this.setBody(st ? Object.assign({}, st, { count: 1 }) : null); return 'consume'; }
    // shears take off the armour, then the saddle
    if (held === 'shears' && (this.body || this.saddled)) {
      if (this.body) { dropOne(this, this.body); this.setBody(null); } else { this.saddled = false; dropOne(this, { id: I.saddle, count: 1 }); }
      return 'damage';
    }
    if (this.saddled) { this.m.mount(this); return 'swing'; }
    return false;
  }
  // a tamed one never turns on the player
  hurt(amount, src) {
    const r = super.hurt(amount, src);
    if (this.tamed && this.lastHurtBy && this.lastHurtBy.isPlayer) this.lastHurtBy = null;
    if (this.tamed && this.target && this.target.isPlayer) this.target = null;
    return r;
  }
  ridingOffset() { return 0.75; }
  rideControl(keys, rider) {
    if (!this.tamed || !this.saddled) return false;
    this.yaw = rider.yaw; this.bodyYaw = this.headYaw = this.yaw;
    const C = this.constructor;
    // the rider keeps their breath (Breath of the Nautilus), topped up while riding
    if (this.age % 10 === 0) this.m.effectPlayer('breath_of_the_nautilus', 40, 1);
    const f = (keys.w ? 1 : 0) - (keys.s ? 0.5 : 0), pitch = rider.pitch || 0;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), v = this.vel;
    if (this.inWater) {
      const sp = C.RIDE_WATER;
      v.x += (-s * f * sp * Math.cos(pitch) - v.x) * 0.2; v.z += (-c * f * sp * Math.cos(pitch) - v.z) * 0.2; v.y += (f * Math.sin(pitch) * sp - v.y) * 0.2;
    } else {
      const sp = C.RIDE_LAND;
      v.x += (-s * f * sp - v.x) * 0.5; v.z += (-c * f * sp - v.z) * 0.5;
    }
    // the dash: Space held charges it (full in ten ticks), let go and it launches the way you look
    if (this.dashCool > 0) this.dashCool--;
    if (keys[' '] && this.dashCool <= 0) this.charge = Math.min(10, this.charge + 1);
    else if (this.charge > 0) {
      const k = this.charge / 10 * C.DASH * (this.inWater ? 1 : 0.3);
      v.x += -s * Math.cos(pitch) * k; v.z += -c * Math.cos(pitch) * k; v.y += Math.sin(pitch) * k;
      this.charge = 0; this.dashCool = 40;
    }
    this.jumpBar = this.charge / 10;
    this.zza = 0;
    return true;
  }
  loot(drop) {
    if (R() < 0.05) drop('nautilus_shell', 1);
    if (this.saddled) drop('saddle', 1);
    if (this.body) { dropOne(this, this.body); this.body = null; }
  }
  get xp() { return 1 + RI(3); }
  layers(out) {
    if (this.body) out.push(['nautilus', 'nautilus_armor_' + itemNm(this.body.id).replace(/_nautilus_armor$/, ''), null, !!this.body.ench]);
    if (this.saddled) out.push(['nautilus', 'nautilus_saddle', null]);
  }
  rootPose(root, t, a, A) { if (!this.inWater) root.multiply(t.makeRotationZ(0.3 * Math.sin(A.age * 0.5))); }
  toJSON() {
    const o = super.toJSON();
    if (this.saddled) o.sad = 1; if (this.tamed) o.tm = 1; if (this.ageT) o.age = this.ageT;
    if (this.body) o.body = itemNm(this.body.id);
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o); this.saddled = !!o.sad; this.tamed = !!o.tm; this.ageT = o.age || 0;
    if (typeof o.body === 'string' && I[o.body] !== undefined) this.setBody({ id: I[o.body], count: 1 });
  }
}
register('nautilus', Nautilus);
export class ZombieNautilus extends Nautilus {
  static TEX = 'zombie_nautilus'; static UNDEAD = true; static HEALTH = 15; static WATER_BREATHER = true;
  static RIDE_WATER = 0.3575; static RIDE_LAND = 0.0485; static DASH = 1.3; static FOLLOW = 24;
  registerGoals() {
    super.registerGoals();
    // a drowned riding it (a jockey) takes it after the player
    this.targets.add(2, new NearestPlayerTargetGoal(this, true, () => !this.tamed && this.passengers.some(p => p.type === 'drowned')));
  }
  aiStep() {
    // undead: it burns in daylight out of the water
    if (this.age % 20 === 0 && !this.inWater && this.m.isDay() && this.m.seesSky(Math.floor(this.pos.x), Math.floor(this.pos.y + this.h), Math.floor(this.pos.z))) this.fire = Math.max(this.fire || 0, 160);
    super.aiStep();
  }
  loot(drop, byPlayer, L) { drop('rotten_flesh', RI(4) + looted(L)); if (this.saddled) drop('saddle', 1); if (this.body) { dropOne(this, this.body); this.body = null; } }
}
register('zombie_nautilus', ZombieNautilus);
// the mount screen, fetched once (ui/containers.js leads back to the entities, so not imported at the top)
let MountScreenRef = null;
import('../ui/containers.js?v=107').then(m => { MountScreenRef = m.MountScreen; }).catch(() => {});
// nautilus armour: bands of the metal round the shell and a plate over its back
const NAUT_ARMOR_ART = { copper: [0xc8764a, 0x8a4a2a], iron: [0xd8d8d8, 0x9a9a9a], golden: [0xf8d84a, 0xc89a20], diamond: [0x5ae8e0, 0x2aa8a0], netherite: [0x4a4248, 0x2a2428] };
for (const k in NAUT_ARMOR_ART) addArt('nautilus_armor_' + k, [64, 64], p => {
  const [c, d] = NAUT_ARMOR_ART[k];
  p.clear(0, 0, 64, 64);
  for (let y = 12; y < 26; y += 4) p.fill(0, y, 40, 2, c, 0.06);
  p.fill(0, 12, 40, 1, d); p.fill(12, 0, 8, 12, c, 0.08); p.fill(14, 2, 4, 8, d, 0.05);
});
model('nautilus', [
  // the coiled shell behind, the soft body and its tentacles in front
  { name: 'shell', pivot: [0, 16, 2], boxes: [[-4, -8, -4, 8, 14, 12, 0, 0], [-3, -10, 2, 6, 4, 6, 0, 26]] },
  { name: 'body', pivot: [0, 18, -2], boxes: [[-3, -3, -5, 6, 6, 5, 24, 26]] },
  { name: 't1', parent: 'body', pivot: [-2, 2, -5], boxes: [[-0.5, 0, -6, 1, 1, 6, 40, 0]] },
  { name: 't2', parent: 'body', pivot: [2, 2, -5], boxes: [[-0.5, 0, -6, 1, 1, 6, 40, 0]] },
  { name: 't3', parent: 'body', pivot: [-1, 0, -5], boxes: [[-0.5, 0, -7, 1, 1, 7, 40, 8]] },
  { name: 't4', parent: 'body', pivot: [1, 0, -5], boxes: [[-0.5, 0, -7, 1, 1, 7, 40, 8]] },
], (m, P, A) => {
  const I = m.index;
  for (let i = 1; i <= 4; i++) set(P, I['t' + i], RX, Math.sin(A.age * 0.3 + i) * 0.25);
});
function paintNautilus(p, shell, stripe, body) {
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 8, 14, 12, { all: shell }, 0.05);
  for (let y = 12; y < 26; y += 3) { p.fill(0, y, 40, 1, stripe); }
  p.box(0, 26, 6, 4, 6, { all: shell }, 0.05); p.fill(0, 32, 24, 1, stripe);
  p.box(24, 26, 6, 6, 5, { all: body }, 0.06); p.px(25, 33, 0x101010); p.px(34, 33, 0x101010);
  p.box(40, 0, 1, 1, 6, body, 0.06); p.box(40, 8, 1, 1, 7, body, 0.06);
}
addArt('nautilus', [64, 64], p => paintNautilus(p, 0xf0e8dc, 0xb05a30, 0xd8a890));
addArt('zombie_nautilus', [64, 64], p => paintNautilus(p, 0x8a9a7a, 0x4a5a3a, 0x6a8a5a));
addArt('nautilus_saddle', [64, 64], p => { p.clear(0, 0, 64, 64); p.fill(12, 0, 8, 12, 0x6a4428, 0.08); p.fill(12, 0, 8, 1, 0x3a2414); p.fill(0, 18, 40, 2, 0x3a2414); });

/* ---- Guardian: 30 health, 0.85 x 0.85; in the water it locks a beam on a
   player or squid within 16 for 80 ticks, then hurts it (6 on Normal, 1
   more as magic); spikes out, a melee hit on it hurts back 2. Elder
   guardian: 80 health, 2.35 times the size, a 60 tick beam for 8; every
   minute it gives players within 50 Mining Fatigue III for 5 minutes.
   Prismarine shards, crystals or fish; an elder drops a wet sponge. ---- */
class GuardianBeamGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { const t = this.mob.target; return !!t && t.alive() && this.mob.dist2(t.pos.x, t.pos.y, t.pos.z) > 9 && this.mob.dist2(t.pos.x, t.pos.y, t.pos.z) < 256; }
  canContinue() { const t = this.mob.target; return !!t && t.alive() && this.mob.dist2(t.pos.x, t.pos.y, t.pos.z) < 256 && this.mob.canSee(t); }
  start() { this.mob.beamT = 0; this.mob.want = null; this.mob.beam = this.mob.target; }
  stop() { this.mob.beam = null; this.mob.beamT = 0; }
  tick() {
    const m = this.mob, t = m.target;
    m.lookAtEntity(t, 90, 90);
    m.yaw = m.headYaw;
    const full = m.constructor.BEAM;
    // the beam drawn as a run of sparks from eye to target, brighter as it charges
    if (m.age % 2 === 0) {
      const ex = m.pos.x, ey = m.pos.y + m.h * 0.5, ez = m.pos.z, dx = t.pos.x - ex, dy = t.pos.y + (t.h || 1.8) * 0.5 - ey, dz = t.pos.z - ez;
      const n = Math.min(24, Math.ceil(Math.hypot(dx, dy, dz) * 1.5)), k = m.beamT / full;
      for (let i = 1; i < n; i++) if (R() < 0.6) m.m.particles('magic', ex + dx * i / n, ey + dy * i / n, ez + dz * i / n, 1, 0.02, [0.4 + k * 0.6, 0.7 + k * 0.3, 1]);
    }
    if (++m.beamT >= full) {
      const src = { type: 'magic', attacker: m, x: m.pos.x, z: m.pos.z };
      if (t.isPlayer) { m.m.hurtPlayer(1, Object.assign({}, src, { type: 'magic' })); m.m.hurtPlayer(m.attackDamage, { type: 'mob', attacker: m, x: m.pos.x, z: m.pos.z }); }
      else { t.hurt(1, src); t.hurt(m.attackDamage, { type: 'mob', attacker: m, x: m.pos.x, z: m.pos.z }); }
      m.beamT = 0; m.target = null;
    }
  }
}
export class Guardian extends Swimmer {
  static W = 0.85; static H = 0.85; static HEALTH = 30; static SPEED = 0.5; static SWIM = 0.5; static ATTACK = 6; static SHADOW = 0.5; static BEAM = 80;
  static MODEL = 'guardian'; static TEX = 'guardian'; static WATER_BREATHER = 'only'; static HOSTILE = true; static CATEGORY = 'monster'; static XP = 10; static FOLLOW = 16;
  constructor(m, type) { super(m, type); this.beam = null; this.beamT = 0; this.spikes = 1; }
  registerGoals() {
    this.goals.add(4, new GuardianBeamGoal(this));
    this.goals.add(7, new SwimGoal(this, 1, 80));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.targets.add(1, new NearestPlayerTargetGoal(this, true, p => this.inWater));
    this.targets.add(2, new NearestMobTargetGoal(this, e => (e.type === 'squid' || e.type === 'glow_squid' || e.type === 'axolotl') && e.inWater, true));
  }
  hurt(amount, source) {
    const ok = super.hurt(amount, source);
    // the spikes: a melee hit costs the attacker 2
    if (ok && this.spikes > 0.5 && source.attacker && !source.direct && (source.type === 'player' || source.type === 'mob' || source.player)) {
      const a = source.attacker;
      if (a.isPlayer) this.m.hurtPlayer(2, { type: 'thorns', attacker: this, x: this.pos.x, z: this.pos.z }); else if (a.hurt) a.hurt(2, { type: 'thorns', attacker: this });
    }
    return ok;
  }
  aiStep() {
    super.aiStep();
    this.spikes += ((this.want || this.beam ? 0 : 1) - this.spikes) * 0.06;
    // out of the water it flops about
    if (!this.inWater && this.onGround && !this.dead) { this.vel.y += 0.5; this.vel.x += (R() - 0.5) * 0.4; this.vel.z += (R() - 0.5) * 0.4; this.onGround = false; }
  }
  loot(drop, byPlayer, L) {
    drop('prismarine_shard', RI(3) + looted(L));
    const r = R();
    if (r < 0.4) drop(this.fire > 0 ? 'cooked_cod' : 'cod', 1 + looted(L)); else if (r < 0.8) drop('prismarine_crystals', 1 + looted(L));
  }
  anim(A) { A.spikes = this.spikes; A.tail = this.want ? 1 : 0.2; }
}
register('guardian', Guardian);
export class ElderGuardian extends Guardian {
  static W = 1.9975; static H = 1.9975; static HEALTH = 80; static ATTACK = 8; static SCALE = 2.35; static BEAM = 60; static XP = 10;
  static TEX = 'elder_guardian'; static SHADOW = 1.2; static SWIM = 0.3;
  aiStep() {
    super.aiStep();
    // every minute: Mining Fatigue III on players within 50
    if (this.age % 1200 === 0 && !this.dead) {
      const P = this.m.player;
      if (P && P.alive() && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 2500) this.m.effectPlayer('mining_fatigue', 6000, 3);
    }
  }
  loot(drop, byPlayer, L) { drop('prismarine_shard', RI(3) + looted(L)); drop('wet_sponge', 1); if (R() < 0.5) drop(this.fire > 0 ? 'cooked_cod' : 'cod', 1 + looted(L)); else drop('prismarine_crystals', 1 + looted(L)); }
}
register('elder_guardian', ElderGuardian);
// the twelve spikes: where each sits (x, y, z from the middle) and its turn (in half turns)
const SPIKE_X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8], SPIKE_Y = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8], SPIKE_Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
const SPIKE_XR = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0], SPIKE_YR = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0], SPIKE_ZR = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25];
model('guardian', [
  { name: 'head', pivot: [0, 0, 0], boxes: [[-6, 10, -8, 12, 12, 16, 0, 0], [-8, 10, -6, 2, 12, 12, 0, 28], [6, 10, -6, 2, 12, 12, 0, 28, 0, true], [-6, 8, -6, 12, 2, 12, 16, 40], [-6, 22, -6, 12, 2, 12, 16, 40]] },
  { name: 'eye', parent: 'head', pivot: [0, 0, -8.25], boxes: [[-1, 15, 0, 2, 2, 1, 8, 0]] },
].concat(SPIKE_X.map((x, i) => ({ name: 'spike' + i, parent: 'head', pivot: [x, 16 + SPIKE_Y[i], SPIKE_Z[i]], rot: [SPIKE_XR[i] * PI, SPIKE_YR[i] * PI, SPIKE_ZR[i] * PI], boxes: [[-1, -4.5, -1, 2, 9, 2, 0, 0]] })))
  .concat([
    { name: 'tail0', parent: 'head', pivot: [0, 0, 0], boxes: [[-2, 14, 7, 4, 4, 8, 40, 0]] },
    { name: 'tail1', parent: 'tail0', pivot: [-1.5, 0.5, 14], boxes: [[0, 14, 0, 3, 3, 7, 0, 54]] },
    { name: 'tail2', parent: 'tail1', pivot: [0.5, 0.5, 6], boxes: [[0, 14, 0, 2, 2, 6, 41, 32], [1, 10.5, 3, 1, 9, 9, 25, 19]] },
  ]), (m, P, A) => {
  const I = m.index, sp = A.spikes === undefined ? 1 : A.spikes;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  // drawn in, the spikes sink 55% of the way into the body
  const g = (1 - sp) * 0.55;
  for (let i = 0; i < 12; i++) {
    const k = 1 + Math.cos(A.age * 1.5 + i) * 0.01 - g;
    set(P, I['spike' + i], 0, SPIKE_X[i] * k); set(P, I['spike' + i], 1, 16 + SPIKE_Y[i] * k); set(P, I['spike' + i], 2, SPIKE_Z[i] * k);
  }
  const f = Math.sin(A.age * 0.3) * (A.tail || 0.2) * 0.5;
  set(P, I.tail0, RY, f * 0.4); set(P, I.tail1, RY, f * 0.7); set(P, I.tail2, RY, f);
});
function paintGuardian(p, body, dark, fin, spike) {
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 12, 12, 16, { all: body }, 0.06); p.speckle(0, 0, 56, 28, dark, 0.2);
  // the big eye on the front face (16,16)
  p.fill(20, 21, 4, 4, 0xf0f0e0); p.fill(21, 22, 2, 2, 0xd8a020); p.px(21, 22, 0x101010);
  p.box(0, 28, 2, 12, 12, { all: fin }, 0.06); p.box(16, 40, 12, 2, 12, { all: fin }, 0.06);
  p.box(8, 0, 2, 2, 1, 0xf0f0e0, 0.02); p.px(9, 1, 0xd8a020);
  p.box(40, 0, 4, 4, 8, { all: body }, 0.06); p.box(0, 54, 3, 3, 7, { all: body }, 0.06); p.box(41, 32, 2, 2, 6, { all: dark }, 0.06); p.box(25, 19, 1, 9, 9, { all: fin }, 0.06);
  // the spikes (0,0) 2x9x2: pale, darker at the root
  p.box(0, 0, 2, 9, 2, { all: spike }, 0.06); p.fill(0, 9, 8, 2, p.shade(spike, 0.8), 0.04);
}
addArt('guardian', [64, 64], p => paintGuardian(p, 0x5a8a7a, 0x3a6a5a, 0xd8885a, 0xe8d8b0));
addArt('elder_guardian', [64, 64], p => paintGuardian(p, 0xc8c4b4, 0x9a968a, 0x8a7a9a, 0xd8d0c0));
