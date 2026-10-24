/* ---------------------------------------------------------------------------
   Leoncraft 2 - the hostile mobs that had no mob yet (their spawn eggs did
   nothing): bogged and parched (skeletons), silverfish, endermites, the
   illagers (pillager, vindicator, evoker and its fangs), the ravager, the
   piglin brute, the breeze and its wind charges, the creaking, the shulker
   and its bullets, the warden and the wither.

   Numbers from the Minecraft Wiki (Java Edition, Normal difficulty; the
   manager scales a hit on the player for Easy and Hard). Shapes are boxes
   in the game's model units; every texture is painted here.
--------------------------------------------------------------------------- */
import { Mob, Living, DEG, wrap, yawTo, rotTowards, Goal, MOVE, LOOK, JUMP, TARGET, looted } from './entity.js?v=107';
import { FloatGoal, PanicGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, MeleeAttackGoal, BowAttackGoal, AvoidGoal,
  HurtByTargetGoal, NearestPlayerTargetGoal, NearestMobTargetGoal, LeapGoal, randomLandPos } from './ai.js?v=107';
import { Monster, Skeleton, register, TYPES, spawnArmor } from './mobs.js?v=107';
import { model } from './mobs2.js?v=107';
import { addArt } from './mobart.js?v=107';
import { MODELS } from './mobmodels.js?v=107';
import { Projectile } from './projectiles.js?v=107';
import { exposure } from './explosion.js?v=107';
import { Entity } from './entity.js?v=107';
import { EnderDragon } from '../dim/dragon.js?v=107';
import { B, BLOCKS, FLUID, SOLID } from '../blocks.js?v=107';

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const POSE = 7, RX = 3, RY = 4, RZ = 5, SC = 6;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };
const DIFF = { peaceful: 0, easy: 1, normal: 2, hard: 3 };
const inNether = m => (m.world.dim || 'overworld') === 'the_nether';

/* ===========================================================================
   Bogged and parched: skeletons. A bogged (16 health) grows mushrooms, its
   arrows poison for 4 seconds and it shoots more slowly (every 3.5 seconds,
   2.5 on Hard); shears take its mushrooms. A parched, the desert's, has
   arrows of Weakness.
=========================================================================== */
class SlowBowGoal extends BowAttackGoal {
  interval() { return this.mob.m.difficulty === 'hard' ? 50 : 70; }
}
export class Bogged extends Skeleton {
  static HEALTH = 16; static TEX = 'bogged';
  constructor(m, type) { super(m, type); this.sheared = false; }
  registerGoals() {
    super.registerGoals();
    const old = this.goals.list.find(g => g instanceof BowAttackGoal);
    if (old) this.goals.remove(old);
    this.goals.add(4, new SlowBowGoal(this, 1, 15));
  }
  shootAt(t, power) {
    super.shootAt(t, power);
    const a = this.m.list[this.m.list.length - 1];
    if (a && a.type === 'arrow' && a.owner === this) { a.effect = 'poison'; a.effectT = 80; a.pickup = 0; }
  }
  interact(held) {
    if (held === 'shears' && !this.sheared) { this.sheared = true; this.m.dropAt(this, 'red_mushroom', 1); this.m.dropAt(this, 'brown_mushroom', 1); return 'damage'; }
    return false;
  }
  loot(drop, byPlayer, L) { drop('bone', RI(3) + looted(L)); drop('arrow', RI(3) + looted(L)); if (byPlayer) drop('tipped_arrow', Math.min(1, RI(2) + looted(L))); }
  layers(out) { if (!this.sheared) out.push(['bogged_shrooms', 'bogged', null]); }
  toJSON() { const o = super.toJSON(); if (this.sheared) o.sh = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.sheared = !!o.sh; }
}
register('bogged', Bogged);
export class Parched extends Skeleton {
  static TEX = 'parched';
  shootAt(t, power) {
    super.shootAt(t, power);
    const a = this.m.list[this.m.list.length - 1];
    if (a && a.type === 'arrow' && a.owner === this) { a.effect = 'weakness'; a.effectT = 600; a.pickup = 0; }
  }
  loot(drop, byPlayer, L) { drop('bone', RI(3) + looted(L)); drop('arrow', RI(3) + looted(L)); }
}
register('parched', Parched);
// the bogged's mushrooms: two little crosses on its head
model('bogged_shrooms', (MODELS.skeleton ? MODELS.skeleton.parts.map(pp => ({ name: pp.name, pivot: pp.pivot.slice(), rot: pp.rot.slice(), boxes: [] })) : []).map(pp => pp.name === 'head'
  ? Object.assign(pp, { boxes: [[-3, -12, -2, 3, 4, 0, 50, 16], [-1.5, -12, -3.5, 0, 4, 3, 50, 16], [1, -11, 1, 3, 3, 0, 50, 22], [2.5, -11, -0.5, 0, 3, 3, 50, 22]] }) : pp),
  MODELS.skeleton ? MODELS.skeleton.animate : null);
function paintSkeletonKind(p, bone, dark, extra) {
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 8, 8, 8, { all: bone }, 0.06);
  p.fill(9, 11, 2, 2, 0x161410); p.fill(13, 11, 2, 2, 0x161410); p.px(11, 13, 0x2a2622); p.fill(9, 14, 6, 1, dark);
  for (let i = 0; i < 6; i++) p.px(9 + i, 15, i % 2 ? dark : bone);
  p.box(16, 16, 8, 12, 4, (x, y, w, h) => p.clear(x, y, w, h));
  for (const y of [20, 22, 24, 26]) p.fill(20, y, 8, 1, bone, 0.05);
  p.fill(23, 20, 2, 12, bone, 0.05); p.fill(32, 20, 8, 12, 0, 0);
  for (const y of [20, 22, 24, 26]) p.fill(32, y, 8, 1, bone, 0.05);
  p.fill(20, 28, 8, 4, bone, 0.05); p.fill(32, 28, 8, 4, bone, 0.05);
  p.box(40, 16, 2, 12, 2, bone, 0.06); p.box(0, 16, 2, 12, 2, bone, 0.06);
  if (extra) extra(p);
}
addArt('bogged', [64, 32], p => paintSkeletonKind(p, 0xb4b8a0, 0x5a6a4a, p => {
  // moss over the bones, and the mushrooms' art (50,16), (50,22)
  p.speckle(0, 0, 64, 32, 0x5a7a3a, 0.08);
  p.fill(50, 16, 3, 4, 0xc83a2a); p.px(51, 17, 0xf0e0d0); p.fill(51, 18, 1, 2, 0xe0d8c8);
  p.fill(50, 22, 3, 3, 0xa87a4a); p.fill(51, 24, 1, 1, 0xe0d8c8);
}));
addArt('parched', [64, 32], p => paintSkeletonKind(p, 0xd8c49a, 0x8a6a42, p => { p.speckle(0, 0, 64, 32, 0xc8a870, 0.12); p.fill(8, 8, 8, 2, 0xa88a5a); }));

/* ===========================================================================
   Silverfish: 8 health, speed 0.25, 0.4 x 0.3, 1 damage; hit, it calls out
   the silverfish hiding in infested blocks nearby; wandering, it may slip
   into stone (an infested block). Endermite: 8 health, 2 damage; gone
   after two minutes; endermen hate it.
=========================================================================== */
const INFEST = { stone: 'infested_stone', cobblestone: 'infested_cobblestone', stone_bricks: 'infested_stone_bricks', mossy_stone_bricks: 'infested_mossy_stone_bricks',
  cracked_stone_bricks: 'infested_cracked_stone_bricks', chiseled_stone_bricks: 'infested_chiseled_stone_bricks', deepslate: 'infested_deepslate' };
const INFESTED = new Set(Object.values(INFEST));
export class Silverfish extends Monster {
  static W = 0.4; static H = 0.3; static HEALTH = 8; static SPEED = 0.25; static ATTACK = 1; static SHADOW = 0.25; static STEP = 0.5;
  static MODEL = 'silverfish'; static TEX = 'silverfish'; static XP = 5;
  get eyeH() { return 0.13; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(4, new MeleeAttackGoal(this, 1, false));
    this.goals.add(5, new HideGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    if (!source.attacker || this.dead) return;
    // every infested block within 10 breaks and lets its silverfish out
    const T = this.m.t, W = this.m.world, x0 = Math.floor(this.pos.x), y0 = Math.floor(this.pos.y), z0 = Math.floor(this.pos.z);
    let n = 0;
    for (let dy = -5; dy <= 5 && n < 8; dy++) for (let dx = -10; dx <= 10 && n < 8; dx++) for (let dz = -10; dz <= 10 && n < 8; dz++) {
      const d = BLOCKS[T.get(x0 + dx, y0 + dy, z0 + dz)];
      if (!d || !INFESTED.has(d.name)) continue;
      W.set(x0 + dx, y0 + dy, z0 + dz, 0, 0);
      const s = this.m.spawn('silverfish', x0 + dx + 0.5, y0 + dy, z0 + dz + 0.5, { natural: false });
      if (s) s.target = source.attacker;
      n++;
    }
  }
}
// slipping into a stone block, which becomes an infested one
class HideGoal extends Goal {
  constructor(mob) { super(mob, MOVE); }
  canUse() {
    const m = this.mob;
    if (m.target || RI(10) !== 0 || !m.onGround) return false;
    const T = m.m.t, x = Math.floor(m.pos.x), y = Math.floor(m.pos.y + 0.5), z = Math.floor(m.pos.z);
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], d = dirs[RI(5)];
    const b = BLOCKS[T.get(x + d[0], y + d[1], z + d[2])];
    if (!b || !INFEST[b.name]) return false;
    this.at = [x + d[0], y + d[1], z + d[2], INFEST[b.name]];
    return true;
  }
  start() { const m = this.mob, a = this.at; if (B[a[3]] !== undefined) { m.m.world.set(a[0], a[1], a[2], B[a[3]], 0); m.poofed = true; m.remove(); } }
  canContinue() { return false; }
}
register('silverfish', Silverfish);
export class Endermite extends Monster {
  static W = 0.4; static H = 0.3; static HEALTH = 8; static SPEED = 0.25; static ATTACK = 2; static SHADOW = 0.25; static STEP = 0.5;
  static MODEL = 'endermite'; static TEX = 'endermite'; static XP = 3;
  constructor(m, type) { super(m, type); this.life = 0; }
  get eyeH() { return 0.13; }
  registerGoals() {
    this.goals.add(1, new FloatGoal(this));
    this.goals.add(2, new MeleeAttackGoal(this, 1, false));
    this.goals.add(3, new StrollGoal(this, 1));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
  }
  aiStep() {
    super.aiStep();
    if (this.age % 4 === 0) this.m.particles('magic', this.pos.x, this.pos.y + 0.15, this.pos.z, 1, 0.2, [0.6, 0.2, 0.8]);
    if (!this.persistent && ++this.life >= 2400) this.remove();
  }
  toJSON() { const o = super.toJSON(); o.lf = this.life; return o; }
  fromJSON(o) { super.fromJSON(o); this.life = o.lf || 0; }
}
register('endermite', Endermite);
// a chain of segments, swaying side to side as it crawls
function bugModel(name, sizes, uvs, layers) {
  const parts = [];
  let z = -3.5;
  sizes.forEach((s, i) => {
    parts.push({ name: 'seg' + i, pivot: [0, 24 - s[1], z], boxes: [[s[0] * -0.5, 0, s[2] * -0.5, s[0], s[1], s[2], uvs[i][0], uvs[i][1]]] });
    if (i < sizes.length - 1) z += (s[2] + sizes[i + 1][2]) * 0.5;
  });
  for (const [seg, y, box] of layers) parts.push({ name: 'layer' + seg, pivot: [0, y, parts[seg].pivot[2]], boxes: [box] });
  model(name, parts, (m, P, A) => {
    const n = sizes.length, t = A.age * 0.9;
    for (let i = 0; i < n; i++) {
      set(P, m.index['seg' + i], RY, Math.cos(t + i * 0.15 * PI) * PI * 0.05 * (1 + Math.abs(i - 2)));
      set(P, m.index['seg' + i], 0, Math.sin(t + i * 0.15 * PI) * PI * 0.2 * Math.abs(i - 2));
    }
    for (const [seg] of layers) { set(P, m.index['layer' + seg], RY, P[m.index['seg' + seg] * POSE + RY]); set(P, m.index['layer' + seg], 0, P[m.index['seg' + seg] * POSE]); }
  });
}
bugModel('silverfish', [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]], [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]],
  [[2, 16, [-5, 0, -1.5, 10, 8, 3, 20, 0]], [4, 20, [-3, 0, -1.5, 6, 4, 3, 20, 11]], [1, 19, [-3, 0, -1.5, 6, 5, 2, 20, 18]]]);
bugModel('endermite', [[4, 3, 2], [6, 4, 5], [3, 3, 1], [1, 2, 1]], [[0, 0], [0, 5], [0, 14], [0, 18]], []);
addArt('silverfish', [64, 32], p => {
  const grey = 0x8a8e94, dark = 0x5a5e64, light = 0xb4b8be;
  p.clear(0, 0, 64, 32);
  for (const [[w, h, d], [u, v]] of [[[3, 2, 2], [0, 0]], [[4, 3, 2], [0, 4]], [[6, 4, 3], [0, 9]], [[3, 3, 3], [0, 16]], [[2, 2, 3], [0, 22]], [[2, 1, 2], [11, 0]], [[1, 1, 2], [13, 4]]]) { p.box(u, v, w, h, d, { all: grey }, 0.08); p.speckle(u, v, 2 * (w + d), h + d, light, 0.2); }
  p.px(2, 2, 0x101010); p.px(4, 2, 0x101010);
  p.box(20, 0, 10, 8, 3, { all: dark }, 0.08); p.box(20, 11, 6, 4, 3, { all: dark }, 0.08); p.box(20, 18, 6, 5, 2, { all: dark }, 0.08);
});
addArt('endermite', [64, 32], p => {
  const body = 0x2a1a3a, purple = 0x7a3aa8;
  p.clear(0, 0, 64, 32);
  for (const [[w, h, d], [u, v]] of [[[4, 3, 2], [0, 0]], [[6, 4, 5], [0, 5]], [[3, 3, 1], [0, 14]], [[1, 2, 1], [0, 18]]]) { p.box(u, v, w, h, d, { all: body }, 0.08); p.speckle(u, v, 2 * (w + d), h + d, purple, 0.2); }
  p.px(2, 3, 0xd060ff); p.px(4, 3, 0xd060ff);
});

/* ===========================================================================
   The illagers: grey-faced, big-nosed, their arms folded until they act.
     pillager    24 health, speed 0.35; a crossbow from up to 8 blocks
     vindicator  24 health, speed 0.35; an iron axe, 13 on Normal
     evoker      24 health, speed 0.5; keeps away from you and casts: fangs
                 out of the ground at you (6 each) every 5 seconds, three
                 vexes every 17 (no more than 8 about); drops a totem of
                 undying
=========================================================================== */
class Illager extends Monster {
  static W = 0.6; static H = 1.95; static HEALTH = 24; static SPEED = 0.35; static FOLLOW = 32; static SHADOW = 0.5; static MODEL = 'illager';
  get eyeH() { return 1.62; }
  anim(A) { A.aggressive = this.aggressive; A.aiming = this.aiming; A.casting = this.casting || 0; A.armsOut = !!(this.aggressive || this.aiming || this.casting); }
}
class CrossbowGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { const t = this.mob.target; return !!t && t.alive(); }
  start() { this.state = 0; this.t = 0; this.seen = 0; this.mob.aggressive = true; }
  stop() { const m = this.mob; m.aiming = false; m.aggressive = false; m.nav.stop(); }
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    const sees = m.canSee(t), d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    this.seen = sees ? Math.max(0, this.seen) + 1 : Math.min(0, this.seen) - 1;
    m.lookAtEntity(t, 30, 30);
    if (d2 > 64 || this.seen < 5) { if (m.age % 10 === 0 || m.nav.isDone()) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, this.state === 0 ? 1 : 0.5, 1); }
    else m.nav.stop();
    if (this.state === 0) { if (sees || this.seen > -40) { this.state = 1; this.t = 0; m.aiming = true; } }
    else if (this.state === 1) { if (++this.t >= 25) { this.state = 2; this.t = 20 + RI(20); } }
    else if (this.state === 2 && --this.t <= 0 && sees) { m.shootCrossbow(t); this.state = 0; m.aiming = false; }
  }
}
export class Pillager extends Illager {
  static TEX = 'pillager'; static XP = 5;
  constructor(m, type) { super(m, type); this.equip.mainhand = 'crossbow'; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(3, new CrossbowGoal(this));
    this.goals.add(8, new StrollGoal(this, 0.6));
    this.goals.add(9, new LookAtPlayerGoal(this, 15));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'villager' || e.type === 'wandering_trader' || e.type === 'iron_golem', true));
  }
  shootCrossbow(t) {
    const diff = DIFF[this.m.difficulty] || 2, ey = this.pos.y + this.eyeH - 0.1;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, dy = t.pos.y + (t.h || 1.8) / 3 - ey, hd = Math.hypot(dx, dz);
    const a = this.m.spawn('arrow', this.pos.x, ey, this.pos.z, { natural: false });
    if (!a) return;
    a.owner = this; a.pickup = 0; a.base = 2;
    a.shoot(dx, dy + hd * 0.2, dz, 1.6, 14 - diff * 4);
    this.swing();
  }
}
register('pillager', Pillager);
export class Vindicator extends Illager {
  static TEX = 'vindicator'; static ATTACK = 13; static XP = 5;
  constructor(m, type) { super(m, type); this.equip.mainhand = 'iron_axe'; }
  // an emerald half the time, killed by a player (Looting adds)
  loot(drop, byPlayer, L) { if (byPlayer) drop('emerald', RI(2) + looted(L)); }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(4, new MeleeAttackGoal(this, 1, false));
    this.goals.add(8, new StrollGoal(this, 0.6));
    this.goals.add(9, new LookAtPlayerGoal(this, 15));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'villager' || e.type === 'wandering_trader' || e.type === 'iron_golem', true));
  }
}
register('vindicator', Vindicator);
class EvokerSpellGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() {
    const m = this.mob, t = m.target;
    if (!t || !t.alive() || m.casting) return false;
    if (m.vexCool <= 0 && m.m.list.filter(e => e.type === 'vex' && !e.dead && !e.removed && e.dist2(m.pos.x, m.pos.y, m.pos.z) < 256).length < 8) { this.spell = 'vex'; return true; }
    if (m.fangCool <= 0 && m.canSee(t)) { this.spell = 'fangs'; return true; }
    return false;
  }
  start() { this.t = this.spell === 'vex' ? 100 : 40; this.mob.casting = this.spell === 'vex' ? 2 : 1; this.mob.nav.stop(); }
  canContinue() { return this.t > 0 && !!this.mob.target; }
  stop() { this.mob.casting = 0; }
  tick() {
    const m = this.mob, t = m.target;
    m.lookAtEntity(t, 30, 30);
    if (--this.t > 0) { if (m.age % 2 === 0) m.m.particles('magic', m.pos.x, m.pos.y + 2.1, m.pos.z, 2, 0.3, this.spell === 'vex' ? [0.7, 0.7, 0.8] : [0.4, 0.3, 0.35]); return; }
    if (this.spell === 'vex') {
      for (let i = 0; i < 3; i++) {
        const v = m.m.spawn('vex', m.pos.x + (R() - 0.5) * 2, m.pos.y + 1, m.pos.z + (R() - 0.5) * 2, { natural: false });
        if (v) { v.target = t; v.life = 20 * (30 + RI(90)); v.owner = m; }
      }
      m.vexCool = 340;
    } else {
      // close: a ring of fangs about itself; further: a line of 16 towards the target
      const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, a = Math.atan2(dz, dx);
      if (dx * dx + dz * dz < 9) {
        for (let i = 0; i < 5; i++) { const b = a + i * PI * 0.4; fangAt(m, m.pos.x + Math.cos(b) * 1.5, m.pos.z + Math.sin(b) * 1.5, b, 0); }
        for (let i = 0; i < 8; i++) { const b = a + i * PI * 2 / 8 + PI * 2 / 5; fangAt(m, m.pos.x + Math.cos(b) * 2.5, m.pos.z + Math.sin(b) * 2.5, b, 3); }
      } else for (let i = 0; i < 16; i++) { const d = 1.25 * (i + 1); fangAt(m, m.pos.x + Math.cos(a) * d, m.pos.z + Math.sin(a) * d, a, i); }
      m.fangCool = 100;
    }
  }
}
// fangs rise out of the ground nearest y on a solid block
function fangAt(m, x, z, yaw, delay) {
  const T = m.m.t, bx = Math.floor(x), bz = Math.floor(z);
  let y = Math.floor(m.pos.y) + 2;
  for (let n = 0; n < 6 && !(SOLID[T.get(bx, y - 1, bz)] && !SOLID[T.get(bx, y, bz)]); n++) y--;
  const f = m.m.spawn('evoker_fangs', x, y, z, { natural: false, yaw: -yaw - PI / 2 });
  if (f) { f.owner = m; f.warmup = 6 + delay; }
}
export class Evoker extends Illager {
  static TEX = 'evoker'; static SPEED = 0.5; static XP = 10;
  constructor(m, type) { super(m, type); this.casting = 0; this.vexCool = 0; this.fangCool = 0; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(2, new AvoidGoal(this, e => e.isPlayer && !e.creative(), 8, 0.6, 1));
    this.goals.add(4, new EvokerSpellGoal(this));
    this.goals.add(8, new StrollGoal(this, 0.6));
    this.goals.add(9, new LookAtPlayerGoal(this, 15));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
  }
  aiStep() { if (this.vexCool > 0) this.vexCool--; if (this.fangCool > 0) this.fangCool--; super.aiStep(); }
  loot(drop, byPlayer, L) { drop('totem_of_undying', 1); if (byPlayer) drop('emerald', RI(2) + looted(L)); }
}
register('evoker', Evoker);
export class EvokerFangs extends Living {
  static W = 0.5; static H = 0.8; static MODEL = 'evoker_fangs'; static TEX = 'evoker_fangs'; static NO_PUSH = true; static SHADOW = 0;
  constructor(m, type) { super(m, type); this.warmup = 6; this.life = 22; this.gravity = 0; this.bit = false; }
  tick() {
    this.prev.copy(this.pos);
    this.age++;
    if (--this.warmup > 0) return;
    if (this.warmup === -8 && !this.bit) {
      this.bit = true;
      const hit = e => {
        if (e === this.owner || e.removed || e.dead || !e.hurt) return;
        if (Math.abs(e.pos.x - this.pos.x) < 0.25 + e.hw && Math.abs(e.pos.z - this.pos.z) < 0.25 + e.hw && e.pos.y < this.pos.y + 0.8 && e.pos.y + e.h > this.pos.y) {
          if (e.type === 'evoker' || e.type === 'vindicator' || e.type === 'pillager' || e.type === 'vex') return;
          e.hurt(6, { type: 'magic', attacker: this.owner, noKnock: true });
        }
      };
      this.m.forNear(this.pos.x, this.pos.z, 2, hit);
      const P = this.m.player;
      if (P.alive() && !P.creative() && Math.abs(P.pos.x - this.pos.x) < 0.55 && Math.abs(P.pos.z - this.pos.z) < 0.55 && P.pos.y < this.pos.y + 0.8 && P.pos.y + 1.8 > this.pos.y) this.m.hurtPlayer(6, { type: 'magic', attacker: this.owner, noKnock: true });
    }
    if (--this.life <= 0) this.remove();
  }
  hurt() { return false; }
  anim(A, a) {
    const t = Math.max(0, -this.warmup + a);
    A.bite = t <= 0 ? 0 : Math.min(1, t / 8);
    A.close = t > 12 ? Math.min(1, (t - 12) / 8) : 0;
  }
}
register('evoker_fangs', EvokerFangs);
model('evoker_fangs', [
  { name: 'base', pivot: [0, 24, 0], boxes: [[-5, -1, -5, 10, 12, 10, 0, 0]] },
  { name: 'upper', pivot: [0, 24, 0], boxes: [[-2, -10, -2, 4, 14, 8, 40, 0]] },
  { name: 'lower', pivot: [0, 24, 0], rot: [0, PI, 0], boxes: [[-2, -10, -2, 4, 14, 8, 40, 0]] },
], (m, P, A) => {
  const I = m.index, b = A.bite || 0, c = A.close || 0, open = Math.sin(b * PI) * 1.2 * (1 - c);
  set(P, I.base, 1, 24 + (1 - b) * 11 + c * 11);
  set(P, I.upper, 1, 24 + (1 - b) * 11 + c * 11); set(P, I.lower, 1, 24 + (1 - b) * 11 + c * 11);
  set(P, I.upper, RZ, PI - open); set(P, I.lower, RZ, PI + open);
  set(P, I.base, SC, 0.001);
});
addArt('evoker_fangs', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  p.box(40, 0, 4, 14, 8, { all: 0x6a6450, top: 0x8a8470 }, 0.08);
  for (let y = 0; y < 8; y++) p.px(48 + (y % 2) * 2, 8 + y, 0xe8e4d0);
  for (let i = 0; i < 8; i++) p.px(44 + i, 8, 0xe8e4d0);
});
// the illager shape: the villager's head and nose, a coat, arms folded or out
model('illager', [
  { name: 'head', pivot: [0, 0, 0], boxes: [[-4, -10, -4, 8, 10, 8, 0, 0]] },
  { name: 'nose', parent: 'head', pivot: [0, -2, 0], boxes: [[-1, -1, -6, 2, 4, 2, 24, 0]] },
  { name: 'body', pivot: [0, 0, 0], boxes: [[-4, 0, -3, 8, 12, 6, 16, 20], [-4, 0, -3, 8, 20, 6, 0, 38, 0.5]] },
  { name: 'arms', pivot: [0, 3, -1], rot: [-0.75, 0, 0], boxes: [[-8, -2, -2, 4, 8, 4, 44, 22], [-4, 2, -2, 8, 4, 4, 40, 38], [4, -2, -2, 4, 8, 4, 44, 22, 0, true]] },
  { name: 'rightLeg', pivot: [-2, 12, 0], boxes: [[-2, 0, -2, 4, 12, 4, 0, 22]] },
  { name: 'leftLeg', pivot: [2, 12, 0], boxes: [[-2, 0, -2, 4, 12, 4, 0, 22, 0, true]] },
  { name: 'rightArm', pivot: [-5, 2, 0], boxes: [[-3, -2, -2, 4, 12, 4, 40, 46]] },
  { name: 'leftArm', pivot: [5, 2, 0], boxes: [[-1, -2, -2, 4, 12, 4, 40, 46, 0, true]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.rightLeg, RX, Math.cos(w) * 1.4 * s * 0.5); set(P, I.leftLeg, RX, Math.cos(w + PI) * 1.4 * s * 0.5);
  const out = A.armsOut;
  set(P, I.arms, SC, out ? 0.001 : 1); set(P, I.rightArm, SC, out ? 1 : 0.001); set(P, I.leftArm, SC, out ? 1 : 0.001);
  if (!out) return;
  if (A.casting) {
    // both arms raised, swaying as the spell builds
    set(P, I.rightArm, RX, Math.cos(A.age * 0.6662) * 0.25); set(P, I.leftArm, RX, Math.cos(A.age * 0.6662) * 0.25);
    set(P, I.rightArm, RZ, 3 * PI / 4); set(P, I.leftArm, RZ, -3 * PI / 4);
  } else if (A.aiming) {
    set(P, I.rightArm, RX, -PI / 2 + A.pitch); set(P, I.leftArm, RX, -PI / 2 + A.pitch); set(P, I.leftArm, RY, 0.6);
  } else {
    const at = A.attack, f = Math.sin(at * PI), g = -PI / (A.aggressive ? 1.5 : 2.25);
    set(P, I.rightArm, RX, g + f * 1.2); set(P, I.leftArm, RX, Math.cos(w) * s);
  }
});
function paintIllager(p, coat, trim, legs, extra) {
  const skin = 0x9a9e9a, dark = 0x7a7e7a;
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 8, 10, 8, { all: skin }, 0.05);
  // a heavy brow over small eyes, the long grey face
  p.fill(8, 11, 8, 1, 0x3a3a38); p.fill(9, 12, 2, 1, 0xe8e8e0); p.px(10, 12, 0x2a5a2a); p.fill(13, 12, 2, 1, 0xe8e8e0); p.px(13, 12, 0x2a5a2a);
  p.fill(10, 16, 4, 1, dark);
  p.box(24, 0, 2, 4, 2, { all: dark }, 0.05);
  p.box(16, 20, 8, 12, 6, { all: coat }, 0.08); p.box(0, 38, 8, 20, 6, { all: coat }, 0.08);
  p.fill(6, 44, 8, 1, trim); p.fill(6, 50, 8, 1, trim);
  p.box(44, 22, 4, 8, 4, { all: coat }, 0.08); p.box(40, 38, 8, 4, 4, { all: coat }, 0.08);
  p.fill(44, 26 + 4, 16, 2, skin, 0.05);
  p.box(40, 46, 4, 12, 4, { all: coat }, 0.08); p.fill(40, 46 + 4 + 9, 16, 3, skin, 0.05);
  p.box(0, 22, 4, 12, 4, { all: legs }, 0.08); p.fill(0, 22 + 4 + 10, 16, 2, 0x3a3a3a);
  if (extra) extra(p);
}
addArt('pillager', [64, 64], p => paintIllager(p, 0x6a6a5a, 0x8a5a3a, 0x3a3a3a, p => { p.fill(16, 26, 8, 2, 0x5a3a24); }));
addArt('vindicator', [64, 64], p => paintIllager(p, 0x3a3e44, 0x2a2a2e, 0x2a2a2e));
addArt('evoker', [64, 64], p => paintIllager(p, 0x1e1e22, 0xd8b030, 0x1e1e22, p => { p.fill(6, 40, 1, 18, 0xd8b030); p.fill(13, 40, 1, 18, 0xd8b030); }));

/* ===========================================================================
   Ravager: 100 health, speed 0.3, 1.95 x 2.2, 12 damage and a heavy shove;
   tramples crops and pushes through leaves; a stun (its bite blocked)
   ends in a roar that throws everything near back. Drops a saddle.
=========================================================================== */
class RavagerMelee extends MeleeAttackGoal {
  tick() {
    super.tick();
    const m = this.mob;
    if (m.stunT > 0) m.nav.stop();
  }
}
export class Ravager extends Monster {
  static W = 1.95; static H = 2.2; static HEALTH = 100; static SPEED = 0.3; static ATTACK = 12; static KB_RESIST = 0.75; static ATTACK_KB = 1.5; static FOLLOW = 32;
  static MODEL = 'ravager'; static TEX = 'ravager'; static SHADOW = 1.1; static XP = 20; static STEP = 1;
  constructor(m, type) { super(m, type); this.stunT = 0; this.roarT = 0; this.biteT = 0; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(4, new RavagerMelee(this, 1, true));
    this.goals.add(5, new StrollGoal(this, 0.4));
    this.goals.add(6, new LookAtPlayerGoal(this, 6));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'villager' || e.type === 'wandering_trader' || e.type === 'iron_golem', true));
  }
  doHurtTarget(t) {
    this.biteT = 10;
    const blocked = t.isPlayer && this.m.combat && this.m.combat.shieldUp && R() < 0.5;
    const ok = super.doHurtTarget(t);
    if (blocked) this.stunT = 40;
    return ok;
  }
  aiStep() {
    if (this.biteT > 0) this.biteT--;
    if (this.stunT > 0) { this.stunT--; this.stopMoving(); if (this.stunT === 0) this.roarT = 20; }
    if (this.roarT > 0 && --this.roarT === 10) {
      // the roar: everything within 4 is thrown back and takes 6
      this.m.forNear(this.pos.x, this.pos.z, 4, e => { if (e !== this && !e.dead && e.knockback && e.type !== 'ravager' && !/^(pillager|vindicator|evoker|witch)$/.test(e.type)) { e.hurt(6, { type: 'mob', attacker: this, x: this.pos.x, z: this.pos.z }); } });
      const P = this.m.player;
      if (P.alive() && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 16) this.m.hurtPlayer(6, { type: 'mob', attacker: this, x: this.pos.x, z: this.pos.z });
      this.m.particles('poof', this.pos.x, this.pos.y + 1, this.pos.z, 20, 2);
    }
    super.aiStep();
    // leaves and crops in its way are broken
    if (this.hCollide && this.age % 2 === 0 && this.m.mobGriefing !== false) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw), T = this.m.t;
      for (let dy = 0; dy < 3; dy++) for (let k = -1; k <= 1; k++) {
        const x = Math.floor(this.pos.x - s * 1.4 + c * k), y = Math.floor(this.pos.y) + dy, z = Math.floor(this.pos.z - c * 1.4 - s * k);
        const d = BLOCKS[T.get(x, y, z)];
        if (d && (d.leaves || /^(wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem)$/.test(d.name))) this.m.breakBlock(x, y, z, true);
      }
    }
  }
  loot(drop) { drop('saddle', 1); }
  anim(A) { A.bite = this.biteT / 10; A.roar = this.roarT > 0 ? Math.sin(this.roarT / 20 * PI) : 0; A.stun = this.stunT > 0; }
}
register('ravager', Ravager);
model('ravager', [
  { name: 'neck', pivot: [0, -7, 5.5], boxes: [[-5, -1, -18, 10, 10, 18, 68, 73]] },
  { name: 'head', parent: 'neck', pivot: [0, 16, -17], boxes: [[-8, -20, -14, 16, 20, 16, 0, 0], [-2, -6, -18, 4, 8, 4, 0, 0]] },
  { name: 'rightHorn', parent: 'head', pivot: [-10, -14, -8], rot: [1.0996, 0, 0], boxes: [[0, -14, -2, 2, 14, 4, 74, 55]] },
  { name: 'leftHorn', parent: 'head', pivot: [8, -14, -8], rot: [1.0996, 0, 0], boxes: [[0, -14, -2, 2, 14, 4, 74, 55, 0, true]] },
  { name: 'mouth', parent: 'head', pivot: [0, -2, 2], boxes: [[-8, 0, -16, 16, 3, 16, 0, 36]] },
  { name: 'body', pivot: [0, 1, 2], rot: [PI / 2, 0, 0], boxes: [[-7, -10, -7, 14, 16, 20, 0, 55], [-6, 6, -7, 12, 13, 18, 0, 91]] },
  { name: 'rightHind', pivot: [-8, -13, 18], boxes: [[-4, 0, -4, 8, 37, 8, 96, 0]] },
  { name: 'leftHind', pivot: [8, -13, 18], boxes: [[-4, 0, -4, 8, 37, 8, 96, 0, 0, true]] },
  { name: 'rightFront', pivot: [-8, -13, -5], boxes: [[-4, 0, -4, 8, 37, 8, 64, 0]] },
  { name: 'leftFront', pivot: [8, -13, -5], boxes: [[-4, 0, -4, 8, 37, 8, 64, 0, 0, true]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.4, s = A.amt;
  set(P, I.head, RX, A.pitch); set(P, I.head, RY, A.yaw * 0.6);
  set(P, I.rightHind, RX, Math.cos(w) * 0.4 * s); set(P, I.leftHind, RX, Math.cos(w + PI) * 0.4 * s);
  set(P, I.rightFront, RX, Math.cos(w + PI) * 0.4 * s); set(P, I.leftFront, RX, Math.cos(w) * 0.4 * s);
  set(P, I.mouth, RX, (A.bite || 0) * 0.6 + (A.roar || 0) * 0.9);
  if (A.stun) set(P, I.neck, RX, Math.sin(A.age * 0.8) * 0.1);
});
// the ravager's skin is 128 x 128, so its own slot; legs and neck use the vanilla-shaped layout
addArt('ravager', [128, 128], p => {
  const hide = 0x5a5650, dark = 0x3a3834, horn = 0xb8b0a0, mouth = 0x6a2a2a;
  const skin = (x, y, w, h, col) => { p.fill(x, y, w, h, col, 0.06); p.speckle(x, y, w, h, dark, 0.2); };
  p.clear(0, 0, 128, 128);
  p.box(0, 0, 16, 20, 16, { all: (x, y, w, h) => skin(x, y, w, h, hide) });
  p.fill(18, 22, 4, 3, 0x101010); p.fill(26, 22, 4, 3, 0x101010); p.px(19, 23, 0xe0c040); p.px(28, 23, 0xe0c040);
  p.box(74, 55, 2, 14, 4, { all: horn }, 0.06);
  p.box(0, 36, 16, 3, 16, { all: mouth, top: 0xd8d0c0 }, 0.06);
  p.box(68, 73, 10, 10, 18, { all: (x, y, w, h) => skin(x, y, w, h, hide) });
  p.box(0, 55, 14, 16, 20, { all: (x, y, w, h) => skin(x, y, w, h, hide) });
  p.box(0, 91, 12, 13, 18, { all: (x, y, w, h) => skin(x, y, w, h, 0x4a4640) });
  p.box(96, 0, 8, 37, 8, { all: (x, y, w, h) => skin(x, y, w, h, hide) }); p.box(64, 0, 8, 37, 8, { all: (x, y, w, h) => skin(x, y, w, h, hide) });
  p.fill(64, 41, 64, 4, 0x2a2826);
});

/* ===========================================================================
   Piglin brute: 50 health, speed 0.35, a golden axe (13 on Normal); hostile
   to every player, gold or no gold, and never trades. Out of the Nether it
   becomes a zombified piglin after 15 seconds.
=========================================================================== */
export class PiglinBrute extends Monster {
  static W = 0.6; static H = 1.95; static HEALTH = 50; static SPEED = 0.35; static ATTACK = 13; static FOLLOW = 16;
  static MODEL = 'piglin'; static TEX = 'piglin_brute'; static SHADOW = 0.5; static XP = 20;
  constructor(m, type) { super(m, type); this.equip.mainhand = 'golden_axe'; this.zombifyT = 0; }
  get eyeH() { return 1.74; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(3, new MeleeAttackGoal(this, 1, true));
    this.goals.add(6, new StrollGoal(this, 0.6));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'wither_skeleton', true));
  }
  aiStep() {
    super.aiStep();
    if (this.dead || this.removed) return;
    if (!inNether(this.m)) { if (++this.zombifyT >= 300) this.m.convertMob(this, 'zombified_piglin', n => { n.equip = Object.assign({}, this.equip); }); }
    else this.zombifyT = 0;
  }
  anim(A) { A.aggressive = this.aggressive; A.shake = this.zombifyT > 0; }
  rootPose(root, t, a) { if (this.zombifyT > 0) root.multiply(t.makeRotationY(Math.cos((this.age + a) * 3.25) * PI * 0.01)); }
}
register('piglin_brute', PiglinBrute);
addArt('piglin_brute', [64, 64], p => {
  const skin = 0xd89488, dark = 0xb8706a, belt = 0x3a2416, gold = 0xe8c030;
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 10, 8, 8, { all: skin }, 0.1); p.speckle(0, 0, 36, 16, dark, 0.15);
  p.fill(8, 10, 10, 1, dark); p.fill(9, 11, 2, 2, 0xf4f0e8); p.px(10, 11, 0x1a1010); p.fill(15, 11, 2, 2, 0xf4f0e8); p.px(15, 11, 0x1a1010);
  p.fill(8, 14, 10, 2, 0x8a6a40);                                   // a scarred jaw
  p.box(36, 0, 4, 4, 1, { all: 0xe8a4a0 }, 0.08); p.px(38, 3, 0x5a2a2a); p.px(39, 3, 0x5a2a2a);
  p.box(46, 0, 1, 2, 1, 0xf0eadc, 0.04);
  for (const u of [36, 46]) { p.box(u, 6, 1, 5, 4, skin, 0.1); p.fill(u + 1, 7, 4, 2, gold); }
  // a black vest and belt with gold studs, dark trousers
  p.box(16, 16, 8, 12, 4, { all: 0x2a2a2a }, 0.08); p.fill(20, 26, 8, 2, belt); p.px(23, 27, gold); p.px(24, 27, gold);
  for (let i = 0; i < 4; i++) p.px(21 + i * 2, 22, gold);
  for (const [u, v] of [[40, 16], [32, 48]]) { p.box(u, v, 4, 12, 4, { all: skin }, 0.1); p.fill(u, v + 4, 16, 3, 0x2a2a2a); p.fill(u, v + 13, 16, 2, gold); }
  for (const [u, v] of [[0, 16], [16, 48]]) { p.box(u, v, 4, 12, 4, { all: 0x3a3028 }, 0.08); p.fill(u, v + 4 + 10, 16, 2, 0x1a1410); }
});

/* ===========================================================================
   Breeze: 30 health, 0.6 x 1.77; leaps about, and from up to 24 blocks
   shoots wind charges: 1 damage and a burst that throws things back. Its
   wind turns arrows and other things shot at it aside.
   Wind charge (the player's too, from the item): flies straight at 1.5 a
   tick (the breeze's at 0.7), and bursts on what it hits: an explosion of
   radius 1.2 (the breeze's 3) that breaks nothing, so everything within
   2.4 blocks (6) is pushed out from the burst, the player's 1.22 times as
   hard as an explosion would; the thrower's own fall counted from there.
   One at your feet throws you about 8 blocks up.
=========================================================================== */
export class WindCharge extends Projectile {
  static MODEL = 'wind_charge'; static TEX = 'wind_charge'; static W = 0.3125; static H = 0.3125; static BRIGHT = true;
  constructor(m, type) { super(m, type); this.gravity = 0; this.drag = 1; this.power = 1.22; this.radius = 1.2; this.dmg = 1; }
  tick() { super.tick(); if (this.age > 100 && !this.removed) this.burst(); }
  // hit by a player: it flies off the way they look at a block a tick, theirs now (the game's aim deflection)
  hurt(n, src) {
    const P = this.m.P;
    if (!src || !src.player || !P || this.removed) return false;
    this.vel.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    this.owner = this.m.player; this.age = 0;
    return true;
  }
  hitEntity(e) {
    if (e === this.owner && this.age < 5) return false;
    const src = { type: 'wind_charge', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.isPlayer) this.m.hurtPlayer(this.dmg, src); else if (e.hurt) e.hurt(this.dmg, src);
    this.burst();
    return true;
  }
  hitBlock() { this.burst(); }
  burst() {
    if (this.removed) return;
    // (the burst is where the charge is, at the foot of its box, as the game's explosion is)
    const cx = this.pos.x, cy = this.pos.y, cz = this.pos.z, r = this.radius, T = this.m.t;
    /* the game's explosion push: how far from the burst its feet are, out of twice the radius, sets
       how hard; the push is away from the burst towards its eyes */
    const push = (e, isP) => {
      const ey = e.pos.y + (e.eyeH !== undefined ? e.eyeH : 1.62);
      const d = Math.hypot(e.pos.x - cx, e.pos.y - cy, e.pos.z - cz);
      if (d > r * 2) return;
      let dx = e.pos.x - cx, dy = ey - cy, dz = e.pos.z - cz;
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-6) return;
      dx /= l; dy /= l; dz /= l;
      const hw = e.hw !== undefined ? e.hw : 0.3, h = e.h || 1.8;
      const ex = exposure(T, e.pos.x - hw, e.pos.y, e.pos.z - hw, e.pos.x + hw, e.pos.y + h, e.pos.z + hw, cx, cy, cz);
      const k = (1 - d / (r * 2)) * ex * this.power * (1 - (e.kbResist || 0));
      if (isP) { this.m.player.push(dx * k, dy * k, dz * k); if (this.owner === this.m.player && this.m.P) { this.m.P.fallDistance = 0; this.m.P.impulseY = this.m.P.pos.y; } }
      else if (e.remotePlayer) e.push(dx * k, dy * k, dz * k);
      else if (e.vel) { e.vel.x += dx * k; e.vel.y += dy * k; e.vel.z += dz * k; }
    };
    // (someone else's charge, flown here as a copy: it pushes nobody, its thrower's machine sends the pushes)
    if (this.ghost) { this.m.particles('poof', cx, cy, cz, 14, 0.6, [0.85, 0.9, 1]); this.remove(); return; }
    const P = this.m.player;
    if (P.alive() && !(this.m.mode === 'spectator')) push(P, true);
    this.m.forNear(cx, cz, r * 2 + 1, e => { if (!e.removed && !e.dead && e !== this && !(e instanceof Projectile)) push(e, false); });
    this.m.particles('poof', cx, cy, cz, 14, 0.6, [0.85, 0.9, 1]);
    this.remove();
  }
}
register('wind_charge', WindCharge);
export class BreezeWindCharge extends WindCharge {
  constructor(m, type) { super(m, type); this.power = 1.1; this.radius = 3; }
}
register('breeze_wind_charge', BreezeWindCharge);
model('wind_charge', [{ name: 'ball', pivot: [0, 22, 0], boxes: [[-2, -2, -2, 4, 4, 4, 0, 0], [-3, -1, -1, 6, 2, 2, 0, 8]] }], (m, P, A) => { set(P, m.index.ball, RY, A.age * 0.6); });
addArt('wind_charge', [64, 32], p => { p.clear(0, 0, 64, 32); p.box(0, 0, 4, 4, 4, 0xd8e8f8, 0.1); p.speckle(0, 0, 16, 8, 0xffffff, 0.3); p.box(0, 8, 6, 2, 2, 0xb8d0f0, 0.1); });
class BreezeGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK | JUMP); }
  canUse() { const t = this.mob.target; return !!t && t.alive(); }
  start() { this.shot = 20; this.hop = 30 + RI(30); }
  stop() { this.mob.nav.stop(); }
  tick() {
    const m = this.mob, t = m.target;
    m.lookAtEntity(t, 30, 30);
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z), sees = m.canSee(t);
    // a long leap: towards the target when far, aside when close
    if (--this.hop <= 0 && m.onGround) {
      this.hop = 40 + RI(40);
      const a = d2 > 64 ? yawTo(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : m.yaw + (R() < 0.5 ? 1 : -1) * PI / 2;
      m.vel.x = -Math.sin(a) * 0.5; m.vel.z = -Math.cos(a) * 0.5; m.vel.y = 0.75 + R() * 0.3; m.onGround = false; m.jumpT = 12;
    } else if (d2 > 144 && (m.age % 10 === 0 || m.nav.isDone())) m.nav.moveTo(t.pos.x, t.pos.y, t.pos.z, 1, 3);
    if (--this.shot <= 0 && sees && d2 < 576) {
      this.shot = 30 + RI(20);
      const ey = m.pos.y + m.eyeH, dx = t.pos.x - m.pos.x, dy = t.pos.y + (t.h || 1.8) * 0.5 - ey, dz = t.pos.z - m.pos.z;
      const c = m.m.spawn('breeze_wind_charge', m.pos.x, ey, m.pos.z, { natural: false });
      if (c) { c.owner = m; c.shoot(dx, dy, dz, 0.7, 5); }
      m.shootT = 10;
    }
  }
}
export class Breeze extends Monster {
  static W = 0.6; static H = 1.77; static HEALTH = 30; static SPEED = 0.63; static FOLLOW = 24; static NO_FALL = true;
  static MODEL = 'breeze'; static TEX = 'breeze'; static SHADOW = 0.4; static XP = 10;
  constructor(m, type) { super(m, type); this.jumpT = 0; this.shootT = 0; }
  get eyeH() { return 1.3; }
  registerGoals() {
    this.goals.add(1, new BreezeGoal(this));
    this.goals.add(6, new StrollGoal(this, 0.6));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'iron_golem', true));
  }
  // its wind turns what is shot at it aside (a wind charge goes through); nothing a breeze does hurts a breeze
  hurt(amount, source) {
    if (source && source.attacker instanceof Breeze) return false;
    const d = source && source.direct;
    if (d && d instanceof Projectile && !(d instanceof WindCharge) && d.type !== 'trident') { d.vel.multiplyScalar(-0.6); d.vel.y += 0.2; d.owner = this; return false; }
    return super.hurt(amount, source);
  }
  aiStep() { if (this.jumpT > 0) this.jumpT--; if (this.shootT > 0) this.shootT--; super.aiStep(); if (this.age % 3 === 0) this.m.particles('poof', this.pos.x, this.pos.y + 0.2, this.pos.z, 1, 0.3, [0.85, 0.9, 1]); }
  loot(drop, byPlayer, L) { if (byPlayer) drop('breeze_rod', 1 + RI(2) + looted(L)); }
  anim(A) { A.jump = this.jumpT > 0; A.shoot = this.shootT / 10; }
}
register('breeze', Breeze);
model('breeze', [
  { name: 'head', pivot: [0, 4, 0], boxes: [[-4, -8, -4, 8, 8, 8, 0, 0], [-5, -5, -4.2, 10, 3, 4, 4, 24]] },
  { name: 'rods', pivot: [0, 8, 0], boxes: [] },
  { name: 'rod1', parent: 'rods', pivot: [2.6, -2, 0], rot: [-0.26, 0, 0.26], boxes: [[-1, 0, -1, 2, 8, 2, 0, 17]] },
  { name: 'rod2', parent: 'rods', pivot: [-2.6, -2, 0], rot: [-0.26, 0, -0.26], boxes: [[-1, 0, -1, 2, 8, 2, 0, 17]] },
  { name: 'rod3', parent: 'rods', pivot: [0, -2, 2.6], rot: [0.26, 0, 0], boxes: [[-1, 0, -1, 2, 8, 2, 0, 17]] },
  { name: 'wind', pivot: [0, 24, 0], boxes: [[-4, -12, -4, 8, 12, 8, 32, 0], [-3, -4, -3, 6, 4, 6, 32, 20]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.rods, RY, A.age * 0.2);
  set(P, I.wind, RY, -A.age * 0.6);
  add(P, I.head, 1, Math.sin(A.age * 0.15) * 0.6);
  if (A.shoot > 0) set(P, I.head, 2, -A.shoot * 1.5);
});
addArt('breeze', [64, 32], p => {
  const shell = 0xb8a4e0, dark = 0x7a68a8, eye = 0x80e8ff;
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 8, 8, 8, { all: shell }, 0.06); p.speckle(0, 0, 32, 16, dark, 0.15);
  p.fill(9, 10, 2, 2, eye); p.fill(13, 10, 2, 2, eye);
  p.box(4, 24, 10, 3, 4, { all: dark }, 0.08);
  p.box(0, 17, 2, 8, 2, { all: 0xd8c8f8 }, 0.08);
  // the whirl of wind under it: pale and streaked
  p.box(32, 0, 8, 12, 8, { all: 0xe8f0ff }, 0.04); p.speckle(32, 0, 32, 20, 0xb8d0f0, 0.35);
  p.box(32, 20, 6, 4, 6, { all: 0xe8f0ff }, 0.04);
});

/* ===========================================================================
   Creaking: 1 health (without a creaking heart nothing keeps it alive),
   0.9 x 2.7, speed 0.4, 3 damage; it moves only while no player is
   looking at it, and freezes the moment one does. Its eyes glow while it
   is free to move.
=========================================================================== */
export class Creaking extends Monster {
  static W = 0.9; static H = 2.7; static HEALTH = 1; static SPEED = 0.4; static ATTACK = 3; static FOLLOW = 32;
  static MODEL = 'creaking'; static TEX = 'creaking'; static SHADOW = 0.6; static XP = 0;
  constructor(m, type) { super(m, type); this.frozen = false; }
  get eyeH() { return 2.3; }
  registerGoals() {
    this.goals.add(2, new MeleeAttackGoal(this, 1, true));
    this.goals.add(6, new StrollGoal(this, 0.6));
    this.targets.add(1, new NearestPlayerTargetGoal(this, true));
  }
  watched() {
    const P = this.m.P, pr = this.m.player;
    if (!pr.alive() || this.m.mode === 'spectator') return false;
    const ex = P.pos.x, ey = P.pos.y + 1.62, ez = P.pos.z;
    const lx = -Math.sin(P.yaw) * Math.cos(P.pitch), ly = Math.sin(P.pitch), lz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    for (const fy of [0.3, 1.4, 2.4]) {
      const dx = this.pos.x - ex, dy = this.pos.y + fy - ey, dz = this.pos.z - ez, d = Math.hypot(dx, dy, dz);
      if (d < 1e-3 || d > 48) continue;
      if ((dx * lx + dy * ly + dz * lz) / d > 0.6 && this.m.t.sees(ex, ey, ez, this.pos.x, this.pos.y + fy, this.pos.z)) return true;
    }
    return false;
  }
  serverAi() {
    this.frozen = this.watched();
    if (this.frozen) { this.noActionTime++; this.m.despawnCheck(this); if (this.nav) this.nav.stop(); this.zza = 0; this.xxa = 0; return; }
    super.serverAi();
  }
  doHurtTarget(t) { return this.frozen ? false : super.doHurtTarget(t); }
  // bound to a creaking heart (entities/hearts.js): nothing hurts it while the heart stands
  hurt(amount, source) { if (this.heartGuard && this.heartGuard(amount, source)) return false; return super.hurt(amount, source); }
  loot() {}
  anim(A) { A.frozen = this.frozen; }
  layers(out) { if (!this.frozen) out.push(['creaking', 'creaking_eyes', null, false, true]); }
}
register('creaking', Creaking);
model('creaking', [
  { name: 'upper', pivot: [-1, 5, 0], boxes: [] },
  { name: 'head', parent: 'upper', pivot: [-3, -11, 0], boxes: [[-3, -10, -3, 6, 10, 6, 0, 0], [-3, -13, -3, 6, 3, 6, 28, 31], [3, -13, 0, 9, 14, 0, 12, 40], [-12, -14, 0, 9, 14, 0, 34, 12]] },
  { name: 'body', parent: 'upper', pivot: [0, -7, 1], boxes: [[0, -3, -3, 6, 13, 5, 0, 16], [-6, -4, -3, 6, 7, 5, 24, 0]] },
  { name: 'rightArm', parent: 'upper', pivot: [-7, -9.5, 1.5], boxes: [[-2, -1.5, -1.5, 3, 21, 3, 22, 13], [-2, 19.5, -1.5, 3, 4, 3, 46, 0]] },
  { name: 'leftArm', parent: 'upper', pivot: [6, -9, 0.5], boxes: [[0, -1, -1.5, 3, 16, 3, 30, 40], [0, 15, -1.5, 3, 4, 3, 52, 12]] },
  { name: 'leftLeg', pivot: [1.5, 8, 0.5], boxes: [[-1.5, 0, -1.5, 3, 16, 3, 42, 40]] },
  { name: 'rightLeg', pivot: [-1, 6.5, 0.5], boxes: [[-3, -1.5, -1.5, 3, 19, 3, 0, 34]] },
], (m, P, A) => {
  const I = m.index;
  if (A.frozen) return;
  const w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.leftLeg, RX, Math.cos(w) * 0.9 * s); set(P, I.rightLeg, RX, Math.cos(w + PI) * 0.9 * s);
  set(P, I.rightArm, RX, Math.cos(w) * 0.6 * s - (A.attack > 0 ? Math.sin(A.attack * PI) * 1.4 : 0)); set(P, I.leftArm, RX, Math.cos(w + PI) * 0.6 * s);
  set(P, I.upper, RZ, Math.sin(A.age * 0.1) * 0.03);
});
addArt('creaking', [64, 64], p => {
  const bark = 0x4a4038, light = 0x6a5e52, dark = 0x2e2822;
  p.clear(0, 0, 64, 64);
  const wood = (x, y, w, h) => { p.fill(x, y, w, h, bark, 0.08); for (let i = 0; i < w; i += 2) if (p.r() < 0.5) p.fill(x + i, y, 1, h, light, 0.06); p.speckle(x, y, w, h, dark, 0.15); };
  p.box(0, 0, 6, 10, 6, { all: wood }); p.box(28, 31, 6, 3, 6, { all: wood });
  p.fill(7, 9, 1, 1, 0x1a1410); p.fill(10, 9, 1, 1, 0x1a1410);
  // the bare branches off the head (12,40), (34,12)
  for (const [u, v] of [[12, 40], [34, 12]]) { for (let i = 0; i < 9; i++) p.px(u + i, v + 13 - Math.floor(i * 1.3), bark); for (let i = 0; i < 4; i++) p.px(u + 4 + i, v + 6 - i, light); }
  p.box(0, 16, 6, 13, 5, { all: wood }); p.box(24, 0, 6, 7, 5, { all: wood });
  p.box(22, 13, 3, 21, 3, { all: wood }); p.box(46, 0, 3, 4, 3, { all: wood }); p.box(30, 40, 3, 16, 3, { all: wood }); p.box(52, 12, 3, 4, 3, { all: wood });
  p.box(42, 40, 3, 16, 3, { all: wood }); p.box(0, 34, 3, 19, 3, { all: wood });
});
addArt('creaking_eyes', [64, 64], p => { p.clear(0, 0, 64, 64); p.fill(7, 9, 1, 1, 0xff8a20); p.fill(10, 9, 1, 1, 0xff8a20); });

/* ===========================================================================
   Shulker: 30 health; sits fixed to a block in its shell, peeks out, and at
   a player within 16 opens and fires a bullet that homes in: 4 damage and
   10 seconds of Levitation. Shut, its shell turns most of a hit (20
   armour). Hurt, it may teleport to another spot nearby. Half the time it
   leaves a shulker shell.
=========================================================================== */
export class ShulkerBullet extends Projectile {
  static MODEL = 'shulker_bullet'; static TEX = 'shulker_bullet'; static W = 0.3125; static H = 0.3125; static BRIGHT = true;
  constructor(m, type) { super(m, type); this.gravity = 0; this.drag = 1; this.target = null; this.life = 0; }
  tick() {
    const t = this.target;
    if (t && t.alive() && !this.removed) {
      // a slow turn towards it each tick
      const dx = t.pos.x - this.pos.x, dy = t.pos.y + (t.h || 1.8) * 0.5 - this.pos.y, dz = t.pos.z - this.pos.z, l = Math.hypot(dx, dy, dz) || 1;
      this.vel.x += (dx / l * 0.15 - this.vel.x) * 0.1; this.vel.y += (dy / l * 0.15 - this.vel.y) * 0.1; this.vel.z += (dz / l * 0.15 - this.vel.z) * 0.1;
    }
    if (this.age % 2 === 0) this.m.particles('sparkle', this.pos.x, this.pos.y, this.pos.z, 1, 0.05);
    super.tick();
  }
  hitEntity(e) {
    if (e === this.owner) return false;
    const src = { type: 'mob_projectile', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.isPlayer) { if (this.m.hurtPlayer(4, src)) this.m.effectPlayer('levitation', 200); }
    else if (e.hurt && e.hurt(4, src) && e.addEffect) e.addEffect('levitation', 1, 200, this.owner);
    this.remove();
    return true;
  }
  hitBlock() { this.m.particles('poof', this.pos.x, this.pos.y, this.pos.z, 4, 0.1); this.remove(); }
  hurt() { this.m.particles('poof', this.pos.x, this.pos.y, this.pos.z, 4, 0.1); this.remove(); return true; }
}
register('shulker_bullet', ShulkerBullet);
model('shulker_bullet', [{ name: 'ball', pivot: [0, 22, 0], boxes: [[-4, -4, -1, 8, 8, 2, 0, 0], [-1, -4, -4, 2, 8, 8, 0, 10], [-4, -1, -4, 8, 2, 8, 20, 0]] }], (m, P, A) => { set(P, m.index.ball, RY, A.age * 0.3); set(P, m.index.ball, RX, A.age * 0.2); });
addArt('shulker_bullet', [64, 32], p => { p.clear(0, 0, 64, 32); p.box(0, 0, 8, 8, 2, 0xf0e8b0, 0.1); p.box(0, 10, 2, 8, 8, 0xf8f0c8, 0.1); p.box(20, 0, 8, 2, 8, 0xe8dca0, 0.1); });
export class Shulker extends Mob {
  static W = 1; static H = 1; static HEALTH = 30; static SPEED = 0; static FOLLOW = 16; static NO_PUSH = true; static HOSTILE = true; static CATEGORY = 'monster';
  static MODEL = 'shulker'; static TEX = 'shulker'; static SHADOW = 0; static XP = 5; static KB_RESIST = 1; static NO_FALL = true;
  constructor(m, type) { super(m, type); this.peek = 0; this.oPeek = 0; this.peekWant = 0; this.shotT = 20; this.gravity = 0; }
  get eyeH() { return 0.5; }
  registerGoals() {
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
  }
  // it never moves: snapped to the block it sits on
  finalizeSpawn() { this.pos.x = Math.floor(this.pos.x) + 0.5; this.pos.z = Math.floor(this.pos.z) + 0.5; this.pos.y = Math.floor(this.pos.y + 0.01); this.prev.copy(this.pos); }
  travel() { this.vel.set(0, 0, 0); }
  serverAi() {
    this.noActionTime++;
    this.targets.tick();
    const t = this.target;
    if (t && t.alive()) {
      this.peekWant = 1;
      this.lookAtEntity(t, 30, 30); this.lookControl();
      if (--this.shotT <= 0 && this.peek > 0.8 && this.canSee(t)) {
        this.shotT = 20 * (1 + RI(5));
        const b = this.m.spawn('shulker_bullet', this.pos.x, this.pos.y + 0.5, this.pos.z, { natural: false });
        if (b) { b.owner = this; b.target = t; b.vel.set(0, 0.15, 0); }
      }
    } else {
      if (RI(40) === 0) this.peekWant = RI(3) === 0 ? 0.3 + R() * 0.3 : 0;
      this.lookControl();
    }
  }
  hurt(amount, source) {
    // shut, the shell takes most of it; an arrow just bounces off
    if (this.peek < 0.1) { if (source.direct) return false; amount *= 0.2; }
    const ok = super.hurt(amount, source);
    if (ok && !this.dead && this.health < this.maxHealth / 2 && RI(4) === 0) this.teleport();
    return ok;
  }
  teleport() {
    const T = this.m.t;
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(this.pos.x) + RI(17) - 8, y = Math.floor(this.pos.y) + RI(17) - 8, z = Math.floor(this.pos.z) + RI(17) - 8;
      if (SOLID[T.get(x, y - 1, z)] && !T.get(x, y, z) && !T.get(x, y + 1, z)) { this.m.particles('magic', this.pos.x, this.pos.y + 0.5, this.pos.z, 10, 0.5, [0.7, 0.4, 0.9]); this.setPos(x + 0.5, y, z + 0.5); return; }
    }
  }
  aiStep() {
    super.aiStep();
    this.oPeek = this.peek;
    this.peek += Math.max(-0.05, Math.min(0.05, this.peekWant - this.peek));
    this.armor = this.peek < 0.1 ? 20 : 0;
  }
  loot(drop, byPlayer, L) { if (R() < 0.5 + 0.0625 * L) drop('shulker_shell', 1); }
  anim(A, a) { A.peek = this.oPeek + (this.peek - this.oPeek) * a; }
}
register('shulker', Shulker);
model('shulker', [
  { name: 'base', pivot: [0, 24, 0], boxes: [[-8, -8, -8, 16, 8, 16, 0, 28]] },
  { name: 'lid', pivot: [0, 24, 0], boxes: [[-8, -16, -8, 16, 12, 16, 0, 0]] },
  { name: 'head', pivot: [0, 12, 0], boxes: [[-3, 0, -3, 6, 6, 6, 0, 52]] },
], (m, P, A) => {
  const I = m.index, k = A.peek || 0;
  set(P, I.lid, 1, 24 - k * 8);
  set(P, I.lid, RY, k > 0.3 ? (k - 0.3) * PI * 0.3 : 0);
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
});
addArt('shulker', [64, 64], p => {
  const shell = 0x8a5a9a, dark = 0x5e3a6e, inner = 0xd8d0a0;
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 16, 12, 16, { all: shell, bottom: dark }, 0.06); p.speckle(0, 0, 64, 28, dark, 0.12);
  p.box(0, 28, 16, 8, 16, { all: shell, top: dark }, 0.06); p.speckle(0, 28, 64, 24, dark, 0.12);
  p.box(0, 52, 6, 6, 6, { all: inner }, 0.06); p.fill(7, 60, 1, 1, 0x101010); p.fill(10, 60, 1, 1, 0x101010);
});

/* ===========================================================================
   Warden: 500 health, speed 0.3, 0.9 x 2.9, blind. It goes after whatever
   it senses: a player moving (not sneaking) within 16, or anything that
   hits it. A punch is 30 on Normal; out of reach but within 15, it charges
   a sonic boom for 1.7 seconds: 10 damage straight through armour and
   shields. Players within 20 get Darkness every 6 seconds. Left alone for a
   minute, it digs back into the ground and is gone. Drops a sculk catalyst.
=========================================================================== */
class WardenSenseGoal extends Goal {
  constructor(mob) { super(mob, TARGET); }
  canUse() {
    const m = this.mob, P = m.m.player;
    if (!P.alive() || P.creative() || m.m.mode === 'spectator') return false;
    const d2 = m.dist2(P.pos.x, P.pos.y, P.pos.z);
    const moving = Math.hypot(m.m.P.pos.x - m.m.P.prev.x, m.m.P.pos.z - m.m.P.prev.z) > 0.02 || !m.m.P.onGround;
    return d2 < 256 && ((moving && !m.m.P.sneaking) || d2 < 4);
  }
  start() { this.mob.target = this.mob.m.player; this.mob.anger = 300; }
  canContinue() { const m = this.mob, t = m.target; return !!t && t.alive() && !(t.isPlayer && t.creative()) && m.anger > 0; }
  stop() { this.mob.target = null; }
}
class WardenAttackGoal extends MeleeAttackGoal {
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    if (m.boomT > 0) { m.nav.stop(); m.lookAtEntity(t, 30, 30); if (--m.boomT === 0) m.sonicBoom(t); return; }
    if (d2 > 9 && d2 < 225 && m.boomCool <= 0 && (m.nav.isDone() || R() < 0.02)) { m.boomT = 34; m.boomCool = 40; return; }
    super.tick();
  }
}
export class Warden extends Monster {
  static W = 0.9; static H = 2.9; static HEALTH = 500; static SPEED = 0.3; static ATTACK = 30; static KB_RESIST = 1; static FOLLOW = 24;
  static MODEL = 'warden'; static TEX = 'warden'; static SHADOW = 0.9; static XP = 5; static ATTACK_KB = 1.5;
  constructor(m, type) { super(m, type); this.anger = 0; this.idleT = 0; this.boomT = 0; this.boomCool = 0; this.digT = -1; this.heart = 0; }
  get eyeH() { return 2.5; }
  registerGoals() {
    this.goals.add(1, new WardenAttackGoal(this, 1.2, true));
    this.goals.add(6, new StrollGoal(this, 0.5));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new WardenSenseGoal(this));
  }
  onHurt(amount, source) { super.onHurt(amount, source); this.anger = 600; this.idleT = 0; }
  hurt(amount, source) { return this.emergeT > 0 ? false : super.hurt(amount, source); }
  sonicBoom(t) {
    const ex = this.pos.x, ey = this.pos.y + 1.6, ez = this.pos.z, dx = t.pos.x - ex, dy = t.pos.y + 1 - ey, dz = t.pos.z - ez, l = Math.hypot(dx, dy, dz) || 1;
    for (let i = 1; i < l; i += 0.8) this.m.particles('magic', ex + dx * i / l, ey + dy * i / l, ez + dz * i / l, 1, 0.05, [0.2, 0.7, 0.8]);
    const src = { type: 'sonic_boom', attacker: this, x: ex, z: ez, bypassArmor: true, bypassShield: true };
    if (t.isPlayer) { this.m.hurtPlayer(10, src); this.m.player.push(dx / l * 2.5, 0.5, dz / l * 2.5); }
    else if (t.hurt) { t.hurt(10, src); if (t.vel) { t.vel.x += dx / l * 2.5; t.vel.y += 0.5; t.vel.z += dz / l * 2.5; } }
  }
  aiStep() {
    if (this.emergeT > 0) {
      // coming up out of the ground (a shrieker's summons): still, and nothing hurts it
      this.stopMoving();
      if (--this.emergeT % 4 === 0) this.m.particles('poof', this.pos.x, this.pos.y + 0.2, this.pos.z, 4, 0.6, [0.1, 0.25, 0.3]);
      return;
    }
    if (this.boomCool > 0) this.boomCool--;
    if (this.anger > 0) this.anger--;
    if (this.digT >= 0) {
      // digging back down: sinking into the ground, then gone
      this.stopMoving();
      if (++this.digT % 4 === 0) this.m.particles('poof', this.pos.x, this.pos.y + 0.2, this.pos.z, 4, 0.6, [0.1, 0.25, 0.3]);
      if (this.digT >= 100) this.remove();
      return;
    }
    if (!this.target) { if (++this.idleT >= 1200 && !this.persistent) this.digT = 0; } else this.idleT = 0;
    // Darkness on players within 20, every 6 seconds
    const P = this.m.player;
    if (this.age % 120 === 0 && P.alive() && this.dist2(P.pos.x, P.pos.y, P.pos.z) < 400) this.m.effectPlayer('darkness', 260);
    this.heart = Math.max(0, this.heart - 0.1);
    if (this.age % (this.anger > 0 ? 20 : 40) === 0) this.heart = 1;
    super.aiStep();
  }
  loot(drop) { drop('sculk_catalyst', 1); }
  anim(A) { A.boom = this.boomT > 0 ? 1 - this.boomT / 34 : 0; A.dig = this.digT >= 0 ? this.digT / 100 : this.emergeT > 0 ? this.emergeT / 134 : 0; A.heart = this.heart; }
  rootPose(root, t, a, A) { if (A.dig) root.multiply(t.makeTranslation(0, -A.dig * 3, 0)); }
  layers(out) { out.push(['warden', 'warden_glow', null, false, true]); }
}
register('warden', Warden);
model('warden', [
  { name: 'body', pivot: [0, 3, 0], boxes: [[-9, -13, -4, 18, 21, 11, 0, 0]] },
  { name: 'rightRib', parent: 'body', pivot: [-7, -2, -4], boxes: [[-2, -11, -0.1, 9, 21, 0, 90, 11]] },
  { name: 'leftRib', parent: 'body', pivot: [7, -2, -4], boxes: [[-7, -11, -0.1, 9, 21, 0, 90, 11, 0, true]] },
  { name: 'head', parent: 'body', pivot: [0, -13, 0], boxes: [[-8, -16, -5, 16, 16, 10, 0, 32]] },
  { name: 'rightTendril', parent: 'head', pivot: [-8, -12, 0], boxes: [[-16, -13, 0, 16, 16, 0, 52, 32]] },
  { name: 'leftTendril', parent: 'head', pivot: [8, -12, 0], boxes: [[0, -13, 0, 16, 16, 0, 58, 0]] },
  { name: 'rightArm', parent: 'body', pivot: [-13, -13, 1], boxes: [[-4, 0, -4, 8, 28, 8, 44, 50]] },
  { name: 'leftArm', parent: 'body', pivot: [13, -13, 1], boxes: [[-4, 0, -4, 8, 28, 8, 0, 58]] },
  { name: 'rightLeg', pivot: [-5.9, 11, 0], boxes: [[-3.1, 0, -3, 6, 13, 6, 76, 48]] },
  { name: 'leftLeg', pivot: [5.9, 11, 0], boxes: [[-2.9, 0, -3, 6, 13, 6, 76, 76]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.rightLeg, RX, Math.cos(w) * 1.4 * s * 0.6); set(P, I.leftLeg, RX, Math.cos(w + PI) * 1.4 * s * 0.6);
  set(P, I.rightArm, RX, Math.cos(w + PI) * 0.8 * s - Math.sin(A.attack * PI) * 1.4); set(P, I.leftArm, RX, Math.cos(w) * 0.8 * s);
  set(P, I.body, RZ, Math.cos(w) * 0.1 * s);
  const tend = Math.cos(A.age * 0.25) * 0.2;
  set(P, I.leftTendril, RY, tend); set(P, I.rightTendril, RY, -tend);
  if (A.boom) { set(P, I.rightArm, RX, -1.2 * A.boom); set(P, I.leftArm, RX, -1.2 * A.boom); set(P, I.head, RX, -0.5 * A.boom); }
});
addArt('warden', [128, 128], p => {
  const body = 0x0e3a40, dark = 0x082428, light = 0x1a5a62, tooth = 0xd8e0c8;
  const skin = (x, y, w, h) => { p.fill(x, y, w, h, body, 0.05); p.speckle(x, y, w, h, dark, 0.25); p.speckle(x, y, w, h, light, 0.1); };
  p.clear(0, 0, 128, 128);
  p.box(0, 0, 18, 21, 11, { all: skin });
  p.box(0, 32, 16, 16, 10, { all: skin });
  // the face (10,42): no eyes, a wide jaw of teeth
  p.fill(14, 52, 10, 4, 0x061a1c); for (let i = 0; i < 10; i += 2) { p.px(14 + i, 52, tooth); p.px(15 + i, 55, tooth); }
  p.box(44, 50, 8, 28, 8, { all: skin }); p.box(0, 58, 8, 28, 8, { all: skin });
  p.box(76, 48, 6, 13, 6, { all: skin }); p.box(76, 76, 6, 13, 6, { all: skin });
  // ribs (90,11) and tendrils (52,32), (58,0)
  for (let y = 0; y < 21; y += 3) p.fill(90, 11 + y, 9, 1, tooth);
  // the tendrils (52,32) and (58,0): flat planes, clear but for a curling horn up from the head
  for (const [u, v, flip] of [[52, 32, true], [58, 0, false]]) {
    for (let i = 0; i < 12; i++) {
      const x = flip ? u + 15 - Math.floor(i * 0.9) : u + Math.floor(i * 0.9), y = v + 15 - i;
      p.fill(flip ? x - 3 : x, y, 4 - Math.floor(i / 5), 1, i < 6 ? body : light, 0.06);
    }
  }
});
addArt('warden_glow', [128, 128], p => {
  p.clear(0, 0, 128, 128);
  // the soul in its chest, the glowing spots on the tendrils
  p.fill(11 + 3, 11 + 5, 6, 5, 0x40e0e8); p.fill(13 + 3, 12 + 5, 2, 3, 0x9af8ff);
  for (const [u, v, flip] of [[52, 32, true], [58, 0, false]]) for (const i of [7, 9, 11]) {
    const x = flip ? u + 15 - Math.floor(i * 0.9) : u + Math.floor(i * 0.9);
    p.px(flip ? x - 2 : x + 1, v + 15 - i, 0x60f0f8);
  }
});

/* ===========================================================================
   Wither: 300 health, 0.9 x 3.5, flies; hovers over its target and fires
   black skulls (8 damage, 10 seconds of Wither II) and now and then a blue
   one that breaks blocks; below half health its armour turns arrows. Its
   bar shows at the top of the screen. Drops a nether star.
=========================================================================== */
export class WitherSkull extends Projectile {
  static MODEL = 'wither_skull'; static TEX = 'wither_skull'; static W = 0.3125; static H = 0.3125; static SCALE = 1; static BRIGHT = true;
  constructor(m, type) { super(m, type); this.gravity = 0; this.drag = 1; this.blue = false; }
  texName() { return this.blue ? 'wither_skull_blue' : 'wither_skull'; }
  hitEntity(e) {
    if (e === this.owner) return false;
    const src = { type: 'wither_skull', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    const d = this.m.difficulty;
    if (e.isPlayer) { if (this.m.hurtPlayer(8, src) && d !== 'easy') this.m.effectPlayer('wither', d === 'hard' ? 800 : 200, 2); }
    else if (e.hurt) { if (e.hurt(8, src) && e.addEffect && d !== 'easy') e.addEffect('wither', 2, d === 'hard' ? 800 : 200, this.owner); else if (!e.dead && this.owner && this.owner.heal) this.owner.heal(5); }
    this.boom();
    return true;
  }
  hitBlock() { this.boom(); }
  boom() {
    if (this.removed) return;
    this.m.explode(this.pos.x, this.pos.y, this.pos.z, 1, { type: 'explosion', attacker: this.owner, mob: true }, { breakBlocks: this.blue });
    this.remove();
  }
}
register('wither_skull', WitherSkull);
model('wither_skull', [{ name: 'skull', pivot: [0, 20, 0], boxes: [[-4, -4, -4, 8, 8, 8, 0, 0]] }], (m, P, A) => {});
addArt('wither_skull', [64, 32], p => { p.clear(0, 0, 64, 32); p.box(0, 0, 8, 8, 8, { all: 0x2a2a2a }, 0.08); p.fill(9, 11, 2, 2, 0x0a0a0a); p.fill(13, 11, 2, 2, 0x0a0a0a); });
addArt('wither_skull_blue', [64, 32], p => { p.clear(0, 0, 64, 32); p.box(0, 0, 8, 8, 8, { all: 0x5a8ad8 }, 0.08); p.fill(9, 11, 2, 2, 0x1a2a4a); p.fill(13, 11, 2, 2, 0x1a2a4a); });
export class Wither extends Monster {
  static W = 0.9; static H = 3.5; static HEALTH = 300; static SPEED = 0.6; static FOLLOW = 40; static FIRE_IMMUNE = true; static NO_FALL = true; static FLYING = true; static UNDEAD = true;
  // (drawn at twice its model's size, as the game draws it)
  static MODEL = 'wither'; static TEX = 'wither'; static SHADOW = 0.8; static XP = 50; static KB_RESIST = 1; static BOSS = true; static SCALE = 2;
  constructor(m, type) { super(m, type); this.gravity = 0; this.armor = 4; this.shotT = 20; this.breakT = 0; this.headYaws = [0, 0]; }
  get eyeH() { return 2.8; }
  registerGoals() {
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, false));
    this.targets.add(3, new NearestMobTargetGoal(this, e => !e.constructor.UNDEAD && e.alive && !e.constructor.BOSS && e.type !== 'ghast' && !(e instanceof Projectile), false));
  }
  serverAi() {
    this.noActionTime++;
    if (this.summonT > 0) {
      // built from blocks (entities/summon.js): still while its health fills, then it bursts out
      this.vel.set(0, 0, 0);
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * (2 / 3) / 220);
      if (this.summonT % 4 === 0) this.m.particles('magic', this.pos.x, this.pos.y + 2, this.pos.z, 3, 1.2, [0.4, 0.5, 0.9]);
      if (--this.summonT === 0) {
        this.health = this.maxHealth;
        this.m.explode(this.pos.x, this.pos.y + 1.75, this.pos.z, 7, { type: 'explosion', attacker: this, mob: true }, { breakBlocks: this.m.mobGriefing !== false });
      }
      return;
    }
    this.targets.tick();
    const t = this.target, v = this.vel, p = this.pos;
    if (t && t.alive()) {
      // above it, 5 blocks up, keeping 3 away across
      const dx = t.pos.x - p.x, dz = t.pos.z - p.z, hd = Math.hypot(dx, dz);
      const wantY = t.pos.y + (this.health > this.maxHealth / 2 ? 5 : 0.5);
      v.y = v.y * 0.6 + (wantY > p.y ? 0.3 : -0.3) * 0.4 * Math.min(1, Math.abs(wantY - p.y));
      if (hd > 9) { v.x += (dx / hd * 0.3 - v.x) * 0.6; v.z += (dz / hd * 0.3 - v.z) * 0.6; }
      this.yaw = yawTo(dx, dz); this.lookAtEntity(t, 30, 30);
      if (--this.shotT <= 0 && this.canSee(t)) {
        this.shotT = 20 + RI(20);
        const head = RI(3), side = head === 0 ? 0 : head === 1 ? -1.3 : 1.3;
        const hx = p.x - Math.cos(this.yaw) * side, hy = p.y + (head === 0 ? 3 : 2.2), hz = p.z + Math.sin(this.yaw) * side;
        const s = this.m.spawn('wither_skull', hx, hy, hz, { natural: false });
        if (s) { s.owner = this; s.blue = head !== 0 && R() < 0.001; s.shoot(t.pos.x - hx, t.pos.y + (t.h || 1.8) * 0.5 - hy, t.pos.z - hz, s.blue ? 0.5 : 0.9, 0); }
      }
    } else {
      // no target: drifting about
      v.y *= 0.6;
      if (RI(40) === 0) { v.x += (R() - 0.5) * 0.4; v.z += (R() - 0.5) * 0.4; }
      this.lookControl();
    }
    this.bodyYaw = this.yaw;
    this.m.despawnCheck(this);
  }
  travel() { const v = this.vel; this.move(v.x, v.y, v.z); v.x *= 0.91; v.z *= 0.91; }
  hurt(amount, source) {
    // nothing hurts it while it charges, newly built
    if (this.summonT > 0 && source.type !== 'void') return false;
    // below half health its armour turns arrows
    if (this.health <= this.maxHealth / 2 && source.direct && source.type === 'arrow') return false;
    const ok = super.hurt(amount, source);
    // hurt, it breaks the blocks round it (every second at most)
    if (ok && this.breakT <= 0 && this.m.mobGriefing !== false) {
      this.breakT = 20;
      const x0 = Math.floor(this.pos.x), y0 = Math.floor(this.pos.y), z0 = Math.floor(this.pos.z), T = this.m.t;
      for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 3; dy++) for (let dz = -1; dz <= 1; dz++) {
        const d = BLOCKS[T.get(x0 + dx, y0 + dy, z0 + dz)];
        if (d && d.solid && !/bedrock|obsidian|barrier|end_portal|command/.test(d.name)) this.m.breakBlock(x0 + dx, y0 + dy, z0 + dz, true);
      }
    }
    return ok;
  }
  aiStep() {
    if (this.breakT > 0) this.breakT--;
    // it heals a point a second
    if (this.age % 20 === 0) this.heal(1);
    super.aiStep();
    this.m.boss = this.dead || this.removed ? null : { name: 'Wither', progress: this.health / this.maxHealth, colour: 'purple', style: 'notched_20' };
  }
  remove() { super.remove(); if (this.m.boss && this.m.boss.name === 'Wither') this.m.boss = null; }
  loot(drop) { drop('nether_star', 1); }
  anim(A) { A.armored = this.health <= this.maxHealth / 2; }
}
register('wither', Wither);
model('wither', [
  { name: 'shoulders', pivot: [0, 0, 0], boxes: [[-10, 3.9, -0.5, 20, 3, 3, 0, 16]] },
  { name: 'ribcage', pivot: [-2, 6.9, -0.5], rot: [0.2042, 0, 0], boxes: [[0, 0, 0, 3, 10, 3, 0, 22], [-4, 1.5, 0.5, 11, 2, 2, 24, 22], [-4, 4, 0.5, 11, 2, 2, 24, 22], [-4, 6.5, 0.5, 11, 2, 2, 24, 22]] },
  { name: 'tail', pivot: [-2, 6.9 + Math.cos(0.2042) * 10, -0.5 + Math.sin(0.2042) * 10], rot: [0.83, 0, 0], boxes: [[0, 0, 0, 3, 6, 3, 12, 22]] },
  { name: 'centerHead', pivot: [0, 0, 0], boxes: [[-4, -4, -4, 8, 8, 8, 0, 0]] },
  { name: 'rightHead', pivot: [-8, 4, 0], boxes: [[-4, -4, -4, 6, 6, 6, 32, 0]] },
  { name: 'leftHead', pivot: [10, 4, 0], boxes: [[-4, -4, -4, 6, 6, 6, 32, 0]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.centerHead, RY, A.yaw); set(P, I.centerHead, RX, A.pitch);
  set(P, I.rightHead, RY, A.yaw + Math.sin(A.age * 0.05) * 0.4); set(P, I.leftHead, RY, A.yaw - Math.sin(A.age * 0.05) * 0.4);
  const b = Math.cos(A.age * 0.1);
  set(P, I.ribcage, RX, (0.065 + 0.05 * b) * PI); set(P, I.tail, RX, (0.265 + 0.1 * b) * PI);
});
addArt('wither', [64, 64], p => {
  const bone = 0x2e2e2e, dark = 0x1a1a1a, light = 0x4a4a4a;
  p.clear(0, 0, 64, 64);
  const b = (x, y, w, h) => { p.fill(x, y, w, h, bone, 0.08); p.speckle(x, y, w, h, light, 0.12); p.speckle(x, y, w, h, dark, 0.12); };
  p.box(0, 0, 8, 8, 8, { all: b }); p.fill(9, 11, 2, 2, 0x0a0a0a); p.fill(13, 11, 2, 2, 0x0a0a0a); p.fill(9, 14, 6, 1, 0x0a0a0a);
  p.box(32, 0, 6, 6, 6, { all: b }); p.fill(39, 8, 1, 1, 0x0a0a0a); p.fill(41, 8, 1, 1, 0x0a0a0a); p.fill(39, 10, 3, 1, 0x0a0a0a);
  p.box(0, 16, 20, 3, 3, { all: b }); p.box(0, 22, 3, 10, 3, { all: b }); p.box(24, 22, 11, 2, 2, { all: b }); p.box(12, 22, 3, 6, 3, { all: b });
});

/* ===========================================================================
   The ender dragon's spawn egg. The dragon itself is the End's (dim/dragon.js,
   flown by dim/realms.js), so the egg makes a stand-in here that gives the
   realms a dragon and an empty fight to fly it in (no crystals, no podium:
   it circles round 0, 0, as an egg dragon does away from the End), keeps its
   bar on the screen, and lets go when it dies.
=========================================================================== */
const E = y => y + 64;                 // world y -> the engine's index
function eggFight(R, m) {
  return {
    podiumY: 0, dragon: null,
    topAt(x, z) { const w = R.world; if (!w.loaded(x, z)) return E(64); for (let y = 380; y > 0; y--) { const b = w.get(x, y, z); if (b && BLOCKS[b].solid) return y + 1; } return E(40); },
    groundBelow(x, y, z) { const w = R.world; for (let yy = Math.floor(y); yy > Math.floor(y) - 20; yy--) { const b = w.get(Math.floor(x), yy - 1, Math.floor(z)); if (b && BLOCKS[b].solid) return yy + 0.05; } return y - 4; },
    crystalsAlive: () => 0, nearestCrystal: () => null,
    xpForKill: () => 500,
    dropXp: (pos, n) => { if (m.hooks.giveXp && n > 0) m.hooks.giveXp(n, pos.x, pos.y, pos.z); },
    dragonDied() { this.dragon = null; },
  };
}
export class DragonEgg extends Entity {
  static W = 0.1; static H = 0.1;
  constructor(m, type) { super(m, type); this.dragon = null; this.health = 200; this.gravity = 0; }
  tick() {
    this.age++;
    const R = this.m.hooks.realms ? this.m.hooks.realms() : null;
    if (!R) { if (this.age > 40) this.remove(); return; }
    if (!this.dragon) {
      const f = eggFight(R, this.m), d = new EnderDragon(R, f);
      d.at(this.pos.x, this.pos.y + 2, this.pos.z);
      d.health = this.health;
      f.dragon = d; this.dragon = d;
      R.add(d);
    }
    const d = this.dragon;
    if (d.dead || !R.entities.includes(d)) { this.m.boss = null; this.remove(); return; }
    this.health = d.health;
    this.pos.copy(d.pos); this.prev.copy(d.pos);
    const P = this.m.P;
    this.m.boss = P && P.pos.distanceTo(d.pos) < 192 ? { name: 'Ender Dragon', progress: d.health / d.maxHealth, colour: 'pink' } : null;
  }
  hurt() { return false; }
  toJSON() { const o = super.toJSON(); o.hp = Math.round(this.health); return o; }
  fromJSON(o) { super.fromJSON(o); if (o.hp) this.health = o.hp; }
}
register('ender_dragon', DragonEgg);
