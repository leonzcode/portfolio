/* ---------------------------------------------------------------------------
   Leoncraft 2 - the mobs of the Nether.

   Numbers from the Minecraft Wiki's mob pages (Java Edition): health, the
   movement speed attribute, damage on Normal (the manager scales hits on
   the player for Easy and Hard), size, drops, experience, spawn rules and
   the behaviour each page describes. The shapes give the familiar
   proportions and the textures are painted here, pixel by pixel, in our own
   colours (no Mojang file).

     zombified_piglin  neutral: hit one and every one within 35 comes for
                       you for 20 to 39 seconds; a golden sword (8 damage)
     piglin            hostile unless you wear a piece of gold armour; a
                       crossbow or a golden sword; give it a gold ingot and
                       it looks at it for 6 seconds, then barters (the
                       game's table); 15 seconds out of the Nether and it
                       is a zombified piglin
     hoglin            40 health, 3 to 8 damage and a throw; bred with
                       crimson fungus; runs from warped fungus, portals and
                       respawn anchors; a zoglin in the Overworld
     zoglin            attacks anything that moves
     ghast             floats about, a fireball every 3 seconds from up to
                       64 blocks (6 damage, an explosion of power 1); hit
                       the fireball back and it is yours (1000 to a ghast)
     magma_cube        a slime of fire: size + 2 damage, 3 armour a size,
                       hops four times as seldom and jumps higher
     strider           walks on lava, shivers on land (slower), hurt by
                       water; saddle it and steer with a warped fungus on a
                       stick (4.24 blocks a second on lava, a boost)
     wither_skeleton   a stone sword (8) and the wither effect for 10 seconds
     blaze             hovers, three fireballs 6 ticks apart then 5 seconds
                       off, burns you; water and snowballs hurt it
--------------------------------------------------------------------------- */
import { Mob, Living, Goal, DEG, wrap, yawTo, rotTowards, MOVE, LOOK, JUMP, TARGET, looted } from './entity.js?v=107';
import { FloatGoal, PanicGoal, StrollGoal, LookAtPlayerGoal, LookAroundGoal, TemptGoal, BreedGoal, FollowParentGoal,
  MeleeAttackGoal, AvoidGoal, NearestPlayerTargetGoal, HurtByTargetGoal, NearestMobTargetGoal, posAway, randomLandPos } from './ai.js?v=107';
import { register, Monster, Zombie, Skeleton, Animal, TYPES } from './mobs.js?v=107';
import { Slime } from './mobs3.js?v=107';
import { Projectile } from './projectiles.js?v=107';
import { model } from './mobs2.js?v=107';
import { addArt } from './mobart.js?v=107';
import { POSE } from './mobmodels.js?v=107';
import { B, BLOCKS, FLUID, SOLID } from '../blocks.js?v=107';
import { I, ITEMS } from '../items.js?v=107';
import { dropStack, activeDrops } from '../drops.js?v=107';

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const between = (a, b) => a + RI(b - a + 1);
const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v); };
const RX = 3, RY = 4, RZ = 5;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };
const below = (S, x, y, z) => { const b = BLOCKS[S.m.t.get(x, y - 1, z)]; return b ? b.name : ''; };
const inNether = m => (m.world.dim || 'overworld') === 'the_nether';

/* ---------------------------------------------------------------------------
   Neutral anger, the game's way (zombified piglins): hurt by someone, angry
   with them for 20 to 39 seconds, and every one of its kind within the
   follow range (and 10 up or down) that has no target joins in.
--------------------------------------------------------------------------- */
class AngerGoal extends Goal {
  constructor(mob) { super(mob, TARGET); this.unseen = 0; }
  canUse() {
    const m = this.mob, a = m.angryAt;
    if (!a || m.angerT <= 0 || !a.alive || !a.alive() || (a.isPlayer && a.creative()) || m.target === a) return false;
    const r = m.constructor.FOLLOW || 16;
    return m.dist2(a.pos.x, a.pos.y, a.pos.z) <= r * r;
  }
  start() { this.mob.target = this.mob.angryAt; this.unseen = 0; }
  canContinue() {
    const m = this.mob, t = m.target;
    if (m.angerT <= 0 || !t || t !== m.angryAt || !t.alive() || (t.isPlayer && t.creative())) return false;
    const r = m.constructor.FOLLOW || 16;
    return m.dist2(t.pos.x, t.pos.y, t.pos.z) <= r * r;
  }
  stop() { this.mob.target = null; }
}
function angerAt(mob, a, spread) {
  if (!a || a === mob || (a.isPlayer && a.creative())) return;
  mob.angryAt = a; mob.angerT = 400 + RI(380);
  if (!spread) return;
  const r = mob.constructor.FOLLOW || 16;
  mob.m.forNear(mob.pos.x, mob.pos.z, r, o => {
    if (o === mob || o.type !== mob.type || o.dead || o.removed || o.target) return;
    if (Math.abs(o.pos.x - mob.pos.x) > r || Math.abs(o.pos.z - mob.pos.z) > r || Math.abs(o.pos.y - mob.pos.y) > 10) return;
    o.angryAt = a; o.angerT = 400 + RI(380); o.target = a;
  });
}

/* ---- the player's armour: any gold piece keeps piglins calm ---- */
function wearsGold(m) {
  const inv = m.inv;
  if (!inv || !inv.armor) return false;
  for (const s of inv.armor) { if (!s) continue; const n = m.itemName(s.id); if (/^golden_/.test(n)) return true; }
  return false;
}

/* ===========================================================================
   Shapes
=========================================================================== */
// the piglin's: a broad head with a snout, tusks and floppy ears on a humanoid body (64 x 64)
model('piglin', [
  { name: 'head', pivot: [0, 0, 0], boxes: [[-5, -8, -4, 10, 8, 8, 0, 0], [-2, -4, -5, 4, 4, 1, 36, 0], [2, -2, -5, 1, 2, 1, 46, 0], [-3, -2, -5, 1, 2, 1, 46, 0]] },
  { name: 'rightEar', parent: 'head', pivot: [-4.5, -6, 0], rot: [0, 0, PI / 6], boxes: [[-1, 0, -2, 1, 5, 4, 36, 6]] },
  { name: 'leftEar', parent: 'head', pivot: [4.5, -6, 0], rot: [0, 0, -PI / 6], boxes: [[0, 0, -2, 1, 5, 4, 46, 6]] },
  { name: 'body', pivot: [0, 0, 0], boxes: [[-4, 0, -2, 8, 12, 4, 16, 16]] },
  { name: 'rightArm', pivot: [-5, 2, 0], boxes: [[-3, -2, -2, 4, 12, 4, 40, 16]] },
  { name: 'leftArm', pivot: [5, 2, 0], boxes: [[-1, -2, -2, 4, 12, 4, 32, 48]] },
  { name: 'rightLeg', pivot: [-1.9, 12, 0], boxes: [[-2, 0, -2, 4, 12, 4, 0, 16]] },
  { name: 'leftLeg', pivot: [1.9, 12, 0], boxes: [[-2, 0, -2, 4, 12, 4, 16, 48]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  set(P, I.rightLeg, RX, Math.cos(w) * 1.4 * s); set(P, I.leftLeg, RX, Math.cos(w + PI) * 1.4 * s);
  set(P, I.rightArm, RX, Math.cos(w + PI) * s); set(P, I.leftArm, RX, Math.cos(w) * s);
  // the ears flap as it walks
  const f = A.age * 0.1 + A.walk * 0.5, e = 0.08 + s * 0.4;
  set(P, I.rightEar, RZ, PI / 6 + Math.cos(f * 1.2) * e); set(P, I.leftEar, RZ, -PI / 6 - Math.cos(f) * e);
  if (A.zombieArms) {
    const g = -PI / (A.aggressive ? 1.5 : 2.25), at = Math.sin(A.attack * PI);
    set(P, I.rightArm, RX, g + at * 1.2); set(P, I.leftArm, RX, g + at * 1.2);
  } else if (A.admire) {
    // the gold held up in the off hand, the head bent over it
    set(P, I.leftArm, RX, -1.1); set(P, I.leftArm, RY, 0.4); set(P, I.head, RX, 0.5); set(P, I.head, RY, 0.3);
  } else if (A.aiming) {
    set(P, I.rightArm, RX, -PI / 2 + A.pitch); set(P, I.leftArm, RX, -PI / 2 + A.pitch); set(P, I.leftArm, RY, 0.6);
  } else if (A.attack > 0) {
    const at = A.attack, k = 1 - Math.pow(1 - at, 4);
    add(P, I.rightArm, RX, -(Math.sin(k * PI) * 1.2 + Math.sin(at * PI) * 0.4));
    set(P, I.body, RY, Math.sin(Math.sqrt(at) * PI * 2) * 0.2);
  }
  if (A.riding) {
    add(P, I.rightArm, RX, -PI / 5); add(P, I.leftArm, RX, -PI / 5);
    set(P, I.rightLeg, RX, -1.41); set(P, I.rightLeg, RY, PI / 10); set(P, I.leftLeg, RX, -1.41); set(P, I.leftLeg, RY, -PI / 10);
  }
});
// a boar with a heavy head, tusks up from the snout and a bristly back (128 x 64)
model('hoglin', [
  { name: 'body', pivot: [0, 6, 0], boxes: [[-8, -7, -12, 16, 14, 24, 0, 0]] },
  { name: 'head', pivot: [0, 3, -11], rot: [0.75, 0, 0], boxes: [[-7, -3, -16, 14, 7, 16, 0, 38], [-7, -10, -15, 2, 8, 2, 80, 22], [5, -10, -15, 2, 8, 2, 90, 22]] },
  { name: 'rightEar', parent: 'head', pivot: [-7, -2, -3], rot: [0, 0, 0.6], boxes: [[-6, -1, -2, 6, 1, 4, 80, 16]] },
  { name: 'leftEar', parent: 'head', pivot: [7, -2, -3], rot: [0, 0, -0.6], boxes: [[0, -1, -2, 6, 1, 4, 100, 16]] },
  { name: 'rightFront', pivot: [-4.5, 11, -8], boxes: [[-3, 0, -3, 6, 13, 6, 64, 38]] },
  { name: 'leftFront', pivot: [4.5, 11, -8], boxes: [[-3, 0, -3, 6, 13, 6, 88, 38]] },
  { name: 'rightHind', pivot: [-5, 13, 9], boxes: [[-2.5, 0, -2.5, 5, 11, 5, 80, 0]] },
  { name: 'leftHind', pivot: [5, 13, 9], boxes: [[-2.5, 0, -2.5, 5, 11, 5, 100, 0]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = A.amt;
  set(P, I.head, RY, A.yaw * 0.5);
  // the head drops and swings up when it hits
  const at = A.hoglinAttack || 0;
  set(P, I.head, RX, 0.75 + Math.max(0, A.pitch) * 0.3 - (at > 0 ? Math.sin(at / 10 * PI) * 0.9 : 0));
  set(P, I.rightFront, RX, Math.cos(w) * 1.2 * s); set(P, I.leftFront, RX, Math.cos(w + PI) * 1.2 * s);
  set(P, I.rightHind, RX, Math.cos(w + PI) * 1.2 * s); set(P, I.leftHind, RX, Math.cos(w) * 1.2 * s);
  const e = Math.cos(A.age * 0.1) * 0.1;
  set(P, I.rightEar, RZ, 0.6 + e); set(P, I.leftEar, RZ, -0.6 - e);
});
// a ghast: a big pale cube with nine tentacles under it (64 x 64; drawn four times over)
model('ghast', [
  { name: 'body', pivot: [0, 0, 0], boxes: [[-8, 8, -8, 16, 16, 16, 0, 0]] },
].concat([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({
  name: 't' + i, pivot: [((i % 3) - 1) * 5 + (Math.floor(i / 3) % 2 ? 1.5 : 0) - 0.5, 23.5, (Math.floor(i / 3) - 1) * 5 + (i % 2 ? 1 : 0)],
  boxes: [[-1, 0, -1, 2, 9 + (i * 7) % 6, 2, 0, 32]],
}))), (m, P, A) => {
  for (let i = 0; i < 9; i++) set(P, m.index['t' + i], RX, 0.2 * Math.sin(A.age * 0.3 + i) + 0.4);
});
// a blaze: a head in a cage of twelve turning rods (64 x 32)
model('blaze', [
  { name: 'head', pivot: [0, -1, 0], boxes: [[-4, -4, -4, 8, 8, 8, 0, 0]] },
].concat(Array.from({ length: 12 }, (_, i) => ({ name: 'r' + i, pivot: [0, 0, 0], boxes: [[-1, 0, -1, 2, 8, 2, 0, 16]] }))), (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const t = A.age;
  for (let i = 0; i < 4; i++) {
    let a = t * PI * -0.1 + i * PI / 2;
    let k = I['r' + i] * POSE; P[k] = Math.cos(a) * 9; P[k + 1] = 3 + Math.cos((i * 2 + t) * 0.25); P[k + 2] = Math.sin(a) * 9;
    a = t * PI * 0.05 + i * PI / 2 + PI / 4;
    k = I['r' + (i + 4)] * POSE; P[k] = Math.cos(a) * 7; P[k + 1] = 9 + Math.cos((i * 2 + t) * 0.25); P[k + 2] = Math.sin(a) * 7;
    a = t * PI * -0.03 + i * PI / 2 + 0.47;
    k = I['r' + (i + 8)] * POSE; P[k] = Math.cos(a) * 5; P[k + 1] = 14 + Math.cos((i * 1.5 + t) * 0.5); P[k + 2] = Math.sin(a) * 5;
  }
});
// a strider: a tall wobbly body on two long legs, hair standing up on its back (64 x 64)
model('strider', [
  { name: 'body', pivot: [0, 1, 0], boxes: [[-8, -6, -8, 16, 13, 16, 0, 0], [-8, -10, -8, 16, 4, 0, 0, 29, 0, false], [-8, -10, 8, 16, 4, 0, 0, 29, 0, true]] },
  { name: 'rightLeg', pivot: [-4, 8, 0], boxes: [[-2, 0, -2, 4, 16, 4, 0, 34]] },
  { name: 'leftLeg', pivot: [4, 8, 0], boxes: [[-2, 0, -2, 4, 16, 4, 16, 34]] },
], (m, P, A) => {
  const I = m.index, w = A.walk * 0.6662, s = Math.min(0.25, A.amt);
  set(P, I.rightLeg, RX, Math.sin(w * 1.5) * 2 * s); set(P, I.leftLeg, RX, Math.sin(w * 1.5 + PI) * 2 * s);
  set(P, I.rightLeg, RZ, 0.1 * Math.cos(w * 0.75)); set(P, I.leftLeg, RZ, -0.1 * Math.cos(w * 0.75));
  // the body rocks from side to side, and shivers when it is cold
  set(P, I.body, RZ, 0.1 * Math.sin(w * 1.5) * 4 * s + (A.shiver ? Math.sin(A.age * 2.5) * 0.06 : 0));
  add(P, I.body, 1, -2 * Math.abs(Math.cos(w * 1.5)) * 4 * s);
  set(P, I.body, RY, A.yaw * 0.3);
});

/* ===========================================================================
   Textures
=========================================================================== */
// the piglin's head, ears, snout and tusks (shared by the piglin and the zombified piglin)
function piglinHead(p, skin, dark, snout, rot) {
  p.box(0, 0, 10, 8, 8, { all: skin, top: p.shade(skin, 0.92) }, 0.1);
  p.speckle(0, 0, 36, 16, dark, 0.12);
  const fx = 8, fy = 8;
  // a heavy brow, small dark eyes set wide, a pink snout below
  p.fill(fx, fy + 2, 10, 1, dark, 0.06);
  p.fill(fx + 1, fy + 3, 2, 2, 0xf4f0e8, 0.04); p.px(fx + 2, fy + 3, 0x1a1010); p.px(fx + 2, fy + 4, 0x2a1a14);
  p.fill(fx + 7, fy + 3, 2, 2, 0xf4f0e8, 0.04); p.px(fx + 7, fy + 3, 0x1a1010); p.px(fx + 7, fy + 4, 0x2a1a14);
  p.fill(fx + 2, fy + 6, 6, 2, p.shade(skin, 0.85), 0.08);
  if (rot) { p.fill(fx + 6, fy + 1, 3, 3, rot, 0.15); p.px(fx + 7, fy + 2, 0xe8e0d0); }
  p.box(36, 0, 4, 4, 1, { all: snout }, 0.08);
  p.px(37 + 1, 1 + 2, 0x5a2a2a); p.px(37 + 2, 1 + 2, 0x5a2a2a);    // nostrils
  p.box(46, 0, 1, 2, 1, 0xf0eadc, 0.04);
  for (const u of [36, 46]) { p.box(u, 6, 1, 5, 4, skin, 0.1); p.speckle(u, 6, 10, 9, dark, 0.2); }
}
// a piglin: pink skin, a leather kilt and belt with a gold buckle, bare feet
addArt('piglin', [64, 64], p => {
  const skin = 0xe8a49a, dark = 0xc8807a, snout = 0xf0b4ac;
  p.clear(0, 0, 64, 64);
  piglinHead(p, skin, dark, snout, 0);
  p.box(16, 16, 8, 12, 4, skin, 0.1);
  p.speckle(16, 16, 24, 16, dark, 0.15);
  p.fill(20, 20 + 7, 8, 1, 0x4a3018, 0.05); p.px(23, 27, 0xf0c838); p.px(24, 27, 0xf0c838);   // the belt and its buckle
  p.fill(20, 28, 8, 4, 0x7a5432, 0.1); p.fill(32, 28, 8, 4, 0x6a4628, 0.1);              // the kilt's top
  for (const [u, v] of [[40, 16], [32, 48]]) { p.box(u, v, 4, 12, 4, skin, 0.1); p.speckle(u, v, 16, 16, dark, 0.15); p.fill(u, v + 4 + 9, 16, 3, p.shade(skin, 0.86), 0.08); }
  for (const [u, v] of [[0, 16], [16, 48]]) {
    p.box(u, v, 4, 12, 4, 0x7a5432, 0.1);            // the kilt down the thighs
    p.fill(u, v + 4 + 6, 16, 6, skin, 0.1); p.speckle(u, v + 10, 16, 6, dark, 0.15);
    p.fill(u, v + 4 + 11, 16, 1, 0x5a3424, 0.06);    // hooves
  }
});
// a zombified piglin: grey-pink rotting skin, bone showing at the ribs and an arm, the same kilt in rags
addArt('zombified_piglin', [64, 64], p => {
  const skin = 0xd9918f, dark = 0x8a6058, rot = 0x7a9a62, bone = 0xe6dfcf;
  p.clear(0, 0, 64, 64);
  piglinHead(p, skin, dark, 0xe8a4a0, rot);
  p.speckle(0, 0, 36, 16, rot, 0.1);
  p.box(16, 16, 8, 12, 4, skin, 0.12);
  p.speckle(16, 16, 24, 16, rot, 0.2);
  for (let r = 0; r < 3; r++) p.fill(21, 21 + r * 2, 3, 1, bone, 0.04);   // ribs through the side
  p.fill(20, 28, 8, 4, 0x5e4630, 0.12);
  for (const [u, v] of [[40, 16], [32, 48]]) { p.box(u, v, 4, 12, 4, skin, 0.12); p.speckle(u, v, 16, 16, rot, 0.2); }
  p.fill(40 + 4, 16 + 4 + 3, 4, 6, bone, 0.04);                              // bone down the right arm
  for (const [u, v] of [[0, 16], [16, 48]]) {
    p.box(u, v, 4, 12, 4, 0x5e4630, 0.12);
    p.fill(u, v + 4 + 6, 16, 6, skin, 0.12); p.speckle(u, v + 10, 16, 6, rot, 0.25);
  }
});
// hoglin and zoglin: a brown (or pale, rotting) boar with a dark bristly back, pale tusks
function boar(p, hide, dark, mane, tusk, rot) {
  p.clear(0, 0, 128, 64);
  p.box(0, 0, 16, 14, 24, { all: hide, top: mane }, 0.1);
  p.speckle(0, 0, 80, 38, dark, 0.2);
  p.speckle(24, 0, 16, 24, p.shade(mane, 0.8), 0.4);
  if (rot) p.speckle(0, 24, 80, 14, rot, 0.12);
  p.box(0, 38, 14, 7, 16, { all: hide, top: mane }, 0.1);
  p.speckle(0, 38, 60, 23, dark, 0.2);
  // the snout's end: a flat pink-grey disc with two nostrils, small eyes above
  const fx = 16, fy = 38 + 16;
  p.fill(fx + 3, fy + 2, 8, 5, 0xb08070, 0.08); p.px(fx + 5, fy + 4, 0x3a2016); p.px(fx + 8, fy + 4, 0x3a2016);
  p.px(fx + 1, fy + 1, rot ? 0xd8d8a0 : 0x1a0c08); p.px(fx + 12, fy + 1, rot ? 0xd8d8a0 : 0x1a0c08);
  for (const u of [80, 90]) p.box(u, 22, 2, 8, 2, tusk, 0.06);
  for (const u of [80, 100]) p.box(u, 16, 6, 1, 4, hide, 0.1);
  for (const u of [64, 88]) { p.box(u, 38, 6, 13, 6, hide, 0.1); p.speckle(u, 38, 24, 19, dark, 0.2); p.fill(u, 38 + 6 + 11, 24, 2, 0x3a2a20, 0.06); }
  for (const u of [80, 100]) { p.box(u, 0, 5, 11, 5, hide, 0.1); p.speckle(u, 0, 20, 16, dark, 0.2); p.fill(u, 5 + 9, 20, 2, 0x3a2a20, 0.06); }
}
addArt('hoglin', [128, 64], p => boar(p, 0xb07a5a, 0x8a5a40, 0x5a3a28, 0xe8dcc0, 0));
addArt('zoglin', [128, 64], p => boar(p, 0xd8a6a0, 0xa07870, 0xa8c4b0, 0xf0ece0, 0x8ab08a));
// a ghast: off-white with faint grey streaks, closed or open eyes and mouth
function ghastArt(p, open) {
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 16, 16, 16, 0xf2f0ee, 0.04);
  p.speckle(0, 0, 64, 32, 0xd8d6d4, 0.18);
  for (let i = 0; i < 6; i++) { const x = RI(60), y = 16 + RI(10); p.fill(x, y, 1, 4, 0xc8c6c4, 0.04); }
  const fx = 16, fy = 16, k = 0x3a3a3a;
  if (open) {
    // eyes wide with red streaks below, the mouth a dark square
    p.fill(fx + 2, fy + 4, 3, 2, k, 0); p.fill(fx + 11, fy + 4, 3, 2, k, 0);
    p.fill(fx + 3, fy + 6, 1, 3, 0xa02020, 0); p.fill(fx + 12, fy + 6, 1, 3, 0xa02020, 0);
    p.fill(fx + 6, fy + 9, 4, 4, 0x6a2a2a, 0); p.fill(fx + 7, fy + 10, 2, 2, 0x2a0a0a, 0);
  } else {
    p.fill(fx + 2, fy + 5, 3, 1, k, 0); p.fill(fx + 11, fy + 5, 3, 1, k, 0);
    p.fill(fx + 3, fy + 6, 1, 2, 0x9a9a9a, 0); p.fill(fx + 12, fy + 6, 1, 2, 0x9a9a9a, 0);
    p.fill(fx + 6, fy + 10, 4, 1, 0x7a7a7a, 0);
  }
  p.box(0, 32, 2, 14, 2, 0xeeeceb, 0.05);
  p.speckle(0, 32, 8, 16, 0xcccac8, 0.25);
}
addArt('ghast', [64, 64], p => ghastArt(p, false));
addArt('ghast_shooting', [64, 64], p => ghastArt(p, true));
// a blaze: a glowing yellow head with a dark brow, golden rods
addArt('blaze', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 8, 8, 8, { all: 0xf0c020, top: 0xf8d840 }, 0.12);
  p.speckle(0, 0, 32, 16, 0xffe070, 0.25); p.speckle(0, 0, 32, 16, 0xd08010, 0.15);
  const fx = 8, fy = 8;
  p.fill(fx, fy + 2, 8, 1, 0xa05010, 0.05);
  p.fill(fx + 1, fy + 3, 2, 1, 0x2a1406, 0); p.fill(fx + 5, fy + 3, 2, 1, 0x2a1406, 0);
  p.fill(fx + 2, fy + 6, 4, 1, 0x6a3008, 0);
  p.box(0, 16, 2, 8, 2, 0xf0a818, 0.1);
  p.speckle(0, 16, 8, 10, 0xffe060, 0.3); p.speckle(0, 16, 8, 10, 0xb06008, 0.2);
});
// a strider: deep red with darker blotches, a pale stripe of mouth; cold, a dull purple
function striderArt(p, body, dark, hair) {
  p.clear(0, 0, 64, 64);
  p.box(0, 0, 16, 13, 16, { all: body, top: dark }, 0.1);
  p.speckle(0, 0, 64, 29, dark, 0.2);
  const fx = 16, fy = 16;
  p.fill(fx + 3, fy + 4, 3, 2, 0x1a0808, 0); p.fill(fx + 10, fy + 4, 3, 2, 0x1a0808, 0);
  p.px(fx + 4, fy + 4, 0xf0e0d0); p.px(fx + 11, fy + 4, 0xf0e0d0);
  p.fill(fx + 1, fy + 8, 14, 1, 0x3a0c0c, 0);                         // the long mouth
  for (let i = 0; i < 16; i++) if (i % 2 === 0) p.px(fx + i, fy + 9, 0xe8d8c8);
  // the hair: a fringe of thin strands
  for (let x = 0; x < 32; x++) for (let y = 29; y < 33; y++) if ((x * 7 + y * 3) % 5 < 2) p.px(x, y, hair);
  for (const u of [0, 16]) { p.box(u, 34, 4, 16, 4, body, 0.1); p.speckle(u, 34, 16, 20, dark, 0.25); }
}
addArt('strider', [64, 64], p => striderArt(p, 0x9a2a2e, 0x6a1a1e, 0xd8c8b8));
addArt('strider_cold', [64, 64], p => striderArt(p, 0x7a5a7a, 0x5a3a5a, 0xb8b0c0));
// a magma cube: dark crusted plates with glowing orange seams, bright eyes
addArt('magma_cube', [64, 32], p => {
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 8, 8, 8, { all: (x, y, w, h) => {
    p.fill(x, y, w, h, 0x3a1206, 0.15);
    p.speckle(x, y, w, h, 0x5a1e0a, 0.3);
    for (const r of [2, 5]) for (let i = 0; i < w; i++) if (p.r() < 0.8) p.px(x + i, y + r, p.r() < 0.5 ? 0xf08a1a : 0xd85a0a);
    for (let j = 0; j < h; j++) if (p.r() < 0.3) p.px(x + Math.floor(p.r() * w), y + j, 0xf8c040);
  } });
  p.box(0, 16, 6, 6, 6, 0xd84a10, 0.15);
  p.box(32, 0, 2, 2, 2, 0xf8e070, 0.05); p.box(32, 4, 2, 2, 2, 0xf8e070, 0.05);
  p.px(34, 2, 0xf8b030); p.px(34, 6, 0xf8b030);
  p.box(32, 8, 1, 1, 1, 0x2a0a04, 0.05);
});
// a wither skeleton: the skeleton's bones in charcoal black
addArt('wither_skeleton', [64, 32], p => {
  const light = 0x3a3a3a, mid = 0x2a2a2a, dark = 0x161616;
  p.clear(0, 0, 64, 32);
  p.box(0, 0, 8, 8, 8, light, 0.08);
  p.speckle(0, 0, 32, 16, mid, 0.25);
  const fx = 8, fy = 8;
  p.fill(fx + 1, fy + 3, 2, 2, 0x0a0a0a, 0); p.fill(fx + 5, fy + 3, 2, 2, 0x0a0a0a, 0);
  p.px(fx + 3, fy + 5, 0x0e0e0e); p.px(fx + 4, fy + 5, 0x0e0e0e);
  for (let i = 1; i < 7; i++) p.px(fx + i, fy + 6, i % 2 ? dark : 0x4a4a4a);
  const bx = 20, by = 20;
  p.fill(bx + 3, by, 2, 12, mid, 0.06);
  for (let r = 0; r < 4; r++) p.fill(bx, by + 1 + r * 2, 8, 1, light, 0.06);
  p.fill(bx, by + 10, 8, 2, light, 0.06);
  p.fill(bx + 12 + 3, by, 2, 12, mid, 0.06);
  for (let r = 0; r < 4; r++) p.fill(bx + 12, by + 1 + r * 2, 8, 1, mid, 0.06);
  for (let r = 0; r < 4; r++) { p.fill(16, by + 1 + r * 2, 4, 1, light); p.fill(28, by + 1 + r * 2, 4, 1, light); }
  p.fill(20, 16, 8, 4, light); p.fill(28, 16, 8, 4, mid);
  for (const u of [40, 0]) { p.box(u, 16, 2, 12, 2, light, 0.1); p.speckle(u, 16, 8, 14, dark, 0.2); }
});
// fireballs: an orange ball with a bright core (the 'ball' model, 4 x 4 x 4)
addArt('fireball', [64, 32], p => { p.clear(0, 0, 64, 32); p.box(0, 0, 4, 4, 4, 0xf07818, 0.2); p.speckle(0, 0, 16, 8, 0xffd040, 0.4); p.speckle(0, 0, 16, 8, 0xb03008, 0.2); });

/* ===========================================================================
   ZOMBIFIED PIGLIN
=========================================================================== */
export class ZombifiedPiglin extends Zombie {
  static W = 0.6; static H = 1.95; static HEALTH = 20; static SPEED = 0.23; static ATTACK = 5; static FOLLOW = 35; static ARMOR = 2;
  static UNDEAD = true; static FIRE_IMMUNE = true; static MODEL = 'piglin'; static TEX = 'zombified_piglin'; static SHADOW = 0.5;
  static CONVERTS_TO = null; static XP = 5;
  constructor(m, type) { super(m, type); this.angerT = 0; this.angryAt = null; this.equip.mainhand = 'golden_sword'; this.attackDamage = 8; }
  registerGoals() {
    this.goals.add(2, new MeleeAttackGoal(this, 1, false));
    this.goals.add(7, new StrollGoal(this, 1));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new AngerGoal(this));
  }
  // a baby 5% of the time; the sword nearly always (the game's 95%, the rest a spear, shown as a sword here)
  finalizeSpawn(o) {
    if (R() < 0.05) this.setBaby(true);
    this.equip.mainhand = 'golden_sword'; this.attackDamage = 8;
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    const a = source.attacker;
    if (a && a !== this && (a.isPlayer || a instanceof Living)) angerAt(this, a, true);
  }
  serverAi() {
    if (this.angerT > 0 && --this.angerT === 0) { if (this.target === this.angryAt) this.target = null; this.angryAt = null; }
    super.serverAi();
    // angry, it goes a little faster (the game's +0.05)
    this.speed = (this.target ? 0.28 : 0.23) * (this.baby ? 1.5 : 1);
  }
  anim(A) { A.aggressive = this.aggressive; A.zombieArms = !!this.target; }
  loot(drop, byPlayer, L) {
    drop('rotten_flesh', RI(2) + looted(L)); drop('gold_nugget', RI(2) + looted(L));
    if (byPlayer && R() < 0.025 + 0.01 * L) drop('gold_ingot', 1);
  }
  // no darkness needed, only not on nether wart blocks (and light 11 or less, where it would walk)
  static checkSpawn(S, x, y, z) {
    return S.m.difficulty !== 'peaceful' && below(S, x, y, z) !== 'nether_wart_block' && S.onGround(this, x, y, z) && S.walkOk(x, y, z);
  }
  toJSON() { const o = super.toJSON(); if (this.angerT > 0) o.ang = this.angerT; return o; }
  fromJSON(o) { super.fromJSON(o); this.angerT = 0; }
}
register('zombified_piglin', ZombifiedPiglin);

/* ===========================================================================
   PIGLIN
=========================================================================== */
// bartering, the game's table (469 in all)
const BARTER = [
  ['enchanted_book', 5, 1, 1, 'soul_speed'], ['iron_boots', 8, 1, 1, 'soul_speed'], ['potion', 8, 1, 1], ['splash_potion', 8, 1, 1],
  ['water_bottle', 10, 1, 1], ['iron_nugget', 10, 10, 36], ['ender_pearl', 10, 2, 4], ['dried_ghast', 10, 1, 1],
  ['string', 20, 3, 9], ['quartz', 20, 5, 12], ['obsidian', 40, 1, 1], ['crying_obsidian', 40, 1, 3], ['fire_charge', 40, 1, 1],
  ['leather', 40, 2, 4], ['soul_sand', 40, 2, 8], ['nether_brick', 40, 2, 8], ['spectral_arrow', 40, 6, 12], ['gravel', 40, 8, 16],
  ['blackstone', 40, 8, 16],
];
export function barter() {
  let tot = 0; for (const e of BARTER) tot += e[1];
  let r = RI(tot);
  for (const e of BARTER) { if (r < e[1]) return [e[0], between(e[2], e[3])]; r -= e[1]; }
  return ['gravel', 8];
}
// the stack a barter gives (the potions are fire resistance; the book and boots carry Soul Speed I to III)
export function barterStack(name, n) {
  if (name === 'potion' || name === 'splash_potion') return { id: I[name], count: 1, potion: 'fire_resistance' };
  if (name === 'water_bottle') return { id: I.potion, count: 1, potion: 'water' };
  if (name === 'enchanted_book' || name === 'iron_boots') return { id: I[name], count: 1, ench: { soul_speed: 1 + RI(3) } };
  return I[name] !== undefined ? { id: I[name], count: n } : null;
}
// what a piglin throws you: at its feet, towards the player
function throwStack(mob, st) {
  if (!st || !st.id) return;
  const P = mob.m.P, x = mob.pos.x, y = mob.pos.y + mob.eyeH - 0.3, z = mob.pos.z;
  const it = activeDrops() ? dropStack(x, y, z, st) : null;
  if (it && it.vel) { const dx = P.pos.x - x, dz = P.pos.z - z, l = Math.hypot(dx, dz) || 1; it.vel.x = dx / l * 0.3; it.vel.z = dz / l * 0.3; it.vel.y = 0.2; }
  else if (!it) mob.m.dropAt(mob, ITEMS[st.id] ? ITEMS[st.id].name : '', st.count);
}
/* A crossbow: in range (8 blocks) and in sight it loads for 25 ticks,
   waits 20 to 39 more, and shoots; out of range it walks up. */
class CrossbowGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { const m = this.mob, t = m.target; return !!t && t.alive() && m.holding('crossbow'); }
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
    else if (this.state === 2) { if (--this.t <= 0 && sees) { m.shootCrossbow(t); this.state = 0; m.aiming = false; } }
  }
}
// what a piglin loves and picks up to admire (the game's piglin_loved), and the golden armour it will wear
const LOVED = new Set(['gold_ore', 'nether_gold_ore', 'deepslate_gold_ore', 'gold_block', 'gilded_blackstone', 'light_weighted_pressure_plate', 'gold_ingot', 'bell', 'clock',
  'golden_carrot', 'glistering_melon_slice', 'golden_apple', 'enchanted_golden_apple', 'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots', 'golden_horse_armor',
  'golden_nautilus_armor', 'golden_sword', 'golden_spear', 'golden_pickaxe', 'golden_shovel', 'golden_axe', 'golden_hoe', 'raw_gold', 'raw_gold_block', 'golden_dandelion']);
const GOLD_ARMOUR = { golden_helmet: ['head', 2], golden_chestplate: ['chest', 5], golden_leggings: ['legs', 3], golden_boots: ['feet', 1] };
// running from what a piglin fears: zombified piglins and zoglins close by
export class Piglin extends Monster {
  static W = 0.6; static H = 1.95; static HEALTH = 16; static SPEED = 0.35; static ATTACK = 5; static FOLLOW = 16;
  static MODEL = 'piglin'; static TEX = 'piglin'; static SHADOW = 0.5; static XP = 5;
  constructor(m, type) {
    super(m, type);
    this.baby = false; this.admireT = 0; this.gold = 0; this.zombifyT = 0; this.angerT = 0; this.angryAt = null;
  }
  get eyeH() { return this.baby ? 0.97 : 1.74; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    // (gold seen comes first, before a fight or running off, as the game's admire-item activity does)
    this.goals.add(1, new GoToGoldGoal(this));
    this.goals.add(1, new AvoidGoal(this, e => (e.type === 'zombified_piglin' || e.type === 'zoglin') && !e.dead, 6, 1, 1.2));
    this.goals.add(2, new AdmireGoal(this));
    this.goals.add(3, new CrossbowGoal(this));
    this.goals.add(3, new PiglinMelee(this, 1, false));
    this.goals.add(6, new StrollGoal(this, 0.6));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new AngerGoal(this));
    // you, unless you wear gold (and a baby never starts it)
    this.targets.add(3, new NearestPlayerTargetGoal(this, true, () => !this.baby && !wearsGold(this.m)));
    this.targets.add(4, new NearestMobTargetGoal(this, e => e.type === 'wither_skeleton', true));
  }
  setBaby(b) { this.baby = b; if (b) { this.w = 0.49; this.hw = 0.245; this.h = 0.98; } else { this.w = 0.6; this.hw = 0.3; this.h = 1.95; } }
  // a baby one time in five; a grown one has a crossbow or a golden sword, and each piece of gold armour 10% of the time
  finalizeSpawn() {
    if (R() < 0.2) { this.setBaby(true); return; }
    this.equip.mainhand = R() < 0.5 ? 'crossbow' : 'golden_sword';
    const pts = { head: ['golden_helmet', 2], chest: ['golden_chestplate', 5], legs: ['golden_leggings', 3], feet: ['golden_boots', 1] };
    for (const k in pts) if (R() < 0.1) { this.equip[k] = pts[k][0]; this.armor += pts[k][1]; }
    this.attackDamage = this.holding('golden_sword') ? 8 : 5;
  }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    // hurt while admiring: the gold is gone (and no barter); and for 20 seconds no gold distracts it
    if (this.admireT > 0) { this.admireT = 0; this.gold = 0; this.admiring = null; }
    this.noAdmireT = 400;
    const a = source.attacker;
    if (a && a !== this && (a.isPlayer || a instanceof Living)) angerAt(this, a, true);
  }
  /* A gold ingot given by hand: a grown one takes it and looks at it for 6
     seconds, then barters. Not while it is already admiring. */
  interact(held) {
    if (held !== 'gold_ingot' || this.admireT > 0 || this.baby) return false;
    this.admireT = 120; this.gold = 1; this.admiring = held;
    if (this.target && this.target.isPlayer && wearsGold(this.m)) this.target = null;
    this.nav.stop();
    return 'consume';
  }
  /* Gold lying about (what it loves, the game's piglin_loved): the nearest within 9 blocks, for
     GoToGoldGoal, which walks there and picks one up; it is then admired as if given. */
  goldNear() {
    const D = activeDrops();
    if (!D) return null;
    let best = null, bd = 81;
    for (const e of D.items) {
      if (e.gone || !e.stack || e.delay > 0 || !LOVED.has(ITEMS[e.stack.id] && ITEMS[e.stack.id].name)) continue;
      const d = this.dist2(e.pos.x, e.pos.y, e.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  // near enough to take it: its box within a block of the piglin's across, and level with it
  reaches(e) { return Math.abs(e.pos.x - this.pos.x) < this.hw + 1.2 && Math.abs(e.pos.z - this.pos.z) < this.hw + 1.2 && e.pos.y > this.pos.y - 0.6 && e.pos.y < this.pos.y + this.h + 0.5; }
  // one taken off the stack in reach; true when it took it
  pickUp(e) {
    const D = activeDrops(), name = ITEMS[e.stack.id] && ITEMS[e.stack.id].name;
    if (!D || !name || this.admireT > 0) return false;
    if (e.stack.count > 1) e.stack.count--; else D._remove(e, -1);
    this.admireT = 120; this.gold = name === 'gold_ingot' ? 1 : 0; this.admiring = name;
    this.nav.stop();
    return true;
  }
  aiStep() {
    super.aiStep();
    if (this.dead || this.removed) return;
    if (this.admireT > 0 && --this.admireT === 0) {
      // a grown one barters for an ingot; anything else it keeps (golden armour it wears, if that slot is free)
      if (this.gold && !this.baby) { const [item, n] = barter(); throwStack(this, barterStack(item, n)); this.bartered = (this.bartered || 0) + 1; this.lastBarter = [item, n]; }
      else if (this.admiring) {
        const slot = GOLD_ARMOUR[this.admiring];
        if (slot && !this.equip[slot[0]]) { this.equip[slot[0]] = this.admiring; this.armor += slot[1]; }
        else (this.kept || (this.kept = [])).push(this.admiring);
      }
      this.gold = 0; this.admiring = null;
    } else if (this.noAdmireT > 0) this.noAdmireT--;
    // out of the Nether: 15 seconds of shaking and it is a zombified piglin
    if (!inNether(this.m) && !this.immune) {
      if (++this.zombifyT >= 300) this.m.convertMob(this, 'zombified_piglin', n => { n.equip = Object.assign({}, this.equip); n.attackDamage = n.holding('golden_sword') ? 8 : 5; });
    } else this.zombifyT = 0;
  }
  serverAi() {
    if (this.angerT > 0 && --this.angerT === 0) { if (this.target === this.angryAt) this.target = null; this.angryAt = null; }
    super.serverAi();
  }
  // the crossbow's bolt: an arrow at 1.6 blocks a tick, spread by 14 - 4 x difficulty
  shootCrossbow(t) {
    const diff = { peaceful: 0, easy: 1, normal: 2, hard: 3 }[this.m.difficulty] || 2;
    const ey = this.pos.y + this.eyeH - 0.1;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, dy = t.pos.y + (t.h || 1.8) / 3 - ey, hd = Math.hypot(dx, dz);
    const a = this.m.spawn('arrow', this.pos.x, ey, this.pos.z, { natural: false });
    if (!a) return;
    a.owner = this; a.pickup = 0;
    a.shoot(dx, dy + hd * 0.2, dz, 1.6, 14 - diff * 4);
    this.swing();
  }
  get xp() { return this.baby ? 1 : 5; }
  anim(A) {
    A.aggressive = this.aggressive; A.aiming = this.aiming; A.admire = this.admireT > 0; A.shake = this.zombifyT > 0;
  }
  rootPose(root, t, a) { if (this.zombifyT > 0) root.multiply(t.makeRotationY(Math.cos((this.age + a) * 3.25) * PI * 0.01)); }
  static checkSpawn(S, x, y, z) { return below(S, x, y, z) !== 'nether_wart_block' && S.onGround(this, x, y, z) && S.walkOk(x, y, z); }
  // the gold it kept goes when it dies
  loot(drop) { if (this.kept) for (const n of this.kept) drop(n, 1); }
  toJSON() { const o = super.toJSON(); if (this.baby) o.baby = 1; if (this.immune) o.imm = 1; if (this.kept && this.kept.length) o.kept = this.kept.slice(0, 8); return o; }
  fromJSON(o) { super.fromJSON(o); if (o.baby) this.setBaby(true); this.immune = !!o.imm; this.attackDamage = this.holding('golden_sword') ? 8 : 5; if (Array.isArray(o.kept)) this.kept = o.kept.filter(n => typeof n === 'string'); }
}
// melee for one holding a sword (or nothing)
class PiglinMelee extends MeleeAttackGoal {
  canUse() { return !this.mob.holding('crossbow') && !this.mob.baby && super.canUse(); }
}
/* Walking to gold lying about and taking one (the game's go-to-wanted-item, within 9 blocks): ahead
   of a fight and of strolling, so neither leads it off half way; not while it admires, nor for 20
   seconds after it was hurt. Looked for every fourth tick. */
class GoToGoldGoal extends Goal {
  constructor(mob) { super(mob, MOVE); this.item = null; }
  canUse() {
    const m = this.mob;
    if (m.admireT > 0 || m.noAdmireT > 0 || m.age % 4) return false;
    this.item = m.goldNear();
    return !!this.item;
  }
  canContinue() { const m = this.mob, e = this.item; return !!e && !e.gone && !(m.admireT > 0) && m.dist2(e.pos.x, e.pos.y, e.pos.z) < 81; }
  start() { this.go(); }
  tick() {
    const m = this.mob, e = this.item;
    if (m.reaches(e)) { m.pickUp(e); this.item = null; return; }
    if (m.age % 10 === 0 || m.nav.isDone()) this.go();
  }
  go() { const e = this.item; this.mob.nav.moveTo(e.pos.x, e.pos.y, e.pos.z, 1, 0); }
  stop() { this.item = null; }
}
// standing still, looking at the gold
class AdmireGoal extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { return this.mob.admireT > 0; }
  start() { this.mob.nav.stop(); }
  tick() { const m = this.mob; m.headYaw = m.bodyYaw; m.pitch = 0.5; }
}
register('piglin', Piglin);

/* ===========================================================================
   HOGLIN and ZOGLIN
=========================================================================== */
// the hit: half the attack plus up to the attack again (3 to 8), then a throw up and away
function hoglinHit(mob, t) {
  const f = mob.attackDamage;
  const dmg = mob.ageT < 0 || mob.baby ? 0.5 : f / 2 + RI(Math.floor(f));
  mob.swing(); mob.attackT = 10;
  const src = { type: 'mob', attacker: mob, x: mob.pos.x, z: mob.pos.z, yaw: mob.yaw };
  const ok = t.isPlayer ? mob.m.hurtPlayer(dmg, src) : t.hurt(dmg, src);
  if (ok && !(mob.ageT < 0 || mob.baby)) {
    const k = 1 - (t.kbResist || 0);
    if (k > 0) {
      const a = Math.atan2(t.pos.z - mob.pos.z, t.pos.x - mob.pos.x) + (RI(21) - 10) * DEG, h = k * (R() * 0.5 + 0.2);
      const up = k * R() * 0.5;
      if (t.isPlayer) t.push(Math.cos(a) * h, up, Math.sin(a) * h);
      else { t.vel.x += Math.cos(a) * h; t.vel.y += up; t.vel.z += Math.sin(a) * h; }
    }
  }
  return ok;
}
class HoglinAttack extends MeleeAttackGoal {
  canUse() { return !(this.mob.ageT < 0) && !this.mob.fleeing && super.canUse(); }
  // a hoglin hits every 40 ticks
  tick() { super.tick(); if (this.cool === 20) this.cool = 40; }
}
// running from warped fungus, nether portals and respawn anchors within 8
class RepelGoal extends Goal {
  constructor(mob) { super(mob, MOVE); }
  canUse() {
    const m = this.mob;
    if (m.age % 10 !== 0) return false;
    const r = m.repellent();
    if (!r) return false;
    const p = posAway(m, 16, 7, { x: r[0] + 0.5, z: r[2] + 0.5 });
    if (!p) return false;
    this.p = p; m.fleeing = true; m.target = null;
    return true;
  }
  start() { this.mob.nav.moveTo(this.p[0], this.p[1], this.p[2], 1.3, 0.5); }
  canContinue() { return !this.mob.nav.isDone(); }
  stop() { this.mob.fleeing = false; }
}
let REPEL = null;
export class Hoglin extends Animal {
  static CATEGORY = 'monster'; static NO_DESPAWN = false;
  static W = 1.3965; static H = 1.4; static HEALTH = 40; static SPEED = 0.3; static ATTACK = 6; static KB_RESIST = 0.6; static FOLLOW = 16;
  static MODEL = 'hoglin'; static TEX = 'hoglin'; static SHADOW = 0.8; static FOOD = ['crimson_fungus']; static BABY_HEAD = 1.4; static XP = 5;
  constructor(m, type) { super(m, type); this.attackT = 0; this.zombifyT = 0; this.fleeing = false; }
  registerGoals() {
    this.goals.add(0, new FloatGoal(this));
    this.goals.add(1, new RepelGoal(this));
    this.goals.add(2, new HoglinAttack(this, 1, true));
    this.goals.add(3, new BreedGoal(this, 1));
    this.goals.add(4, new TemptGoal(this, 1, Hoglin.FOOD));
    this.goals.add(5, new FollowParentGoal(this, 1.1));
    this.goals.add(6, new StrollGoal(this, 0.4));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new BabyPanicTarget(this));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true, () => !(this.ageT < 0)));
  }
  // what makes a hoglin run: the nearest of them within 8 across and 4 up and down (looked for twice a second)
  repellent() {
    if (!REPEL) REPEL = new Set(['warped_fungus', 'potted_warped_fungus', 'nether_portal', 'respawn_anchor'].map(n => B[n]).filter(v => v !== undefined));
    const T = this.m.t, x0 = Math.floor(this.pos.x), y0 = Math.floor(this.pos.y), z0 = Math.floor(this.pos.z);
    let best = null, bd = 1e9;
    for (let y = y0 - 4; y <= y0 + 4; y++) for (let z = z0 - 8; z <= z0 + 8; z++) for (let x = x0 - 8; x <= x0 + 8; x++) {
      if (!REPEL.has(T.get(x, y, z))) continue;
      const d = (x - x0) ** 2 + (y - y0) ** 2 + (z - z0) ** 2;
      if (d < bd) { bd = d; best = [x, y, z]; }
    }
    return best;
  }
  doHurtTarget(t) { return hoglinHit(this, t); }
  onHurt(amount, source) {
    super.onHurt(amount, source);
    // the grown ones about join in against whatever hit one of them
    const a = source.attacker;
    if (a && a !== this && !(this.ageT < 0)) this.m.forNear(this.pos.x, this.pos.z, 16, o => { if (o !== this && o.type === this.type && !o.dead && !o.target && !(o.ageT < 0)) o.target = a; });
    if (a && !(this.ageT < 0)) this.target = a;
  }
  aiStep() {
    super.aiStep();
    if (this.attackT > 0) this.attackT--;
    if (this.dead || this.removed) return;
    if (!inNether(this.m) && !this.immune) { if (++this.zombifyT >= 300) this.m.convertMob(this, 'zoglin'); }
    else this.zombifyT = 0;
  }
  loot(drop, byPlayer, L) {
    if (this.ageT < 0) return;
    drop(this.fire > 0 ? 'cooked_porkchop' : 'porkchop', between(2, 4) + looted(L));
    drop('leather', RI(2) + looted(L));
  }
  get xp() { return 5; }
  anim(A) { A.hoglinAttack = this.attackT; A.shake = this.zombifyT > 0; }
  rootPose(root, t, a) { if (this.zombifyT > 0) root.multiply(t.makeRotationY(Math.cos((this.age + a) * 3.25) * PI * 0.01)); }
  static checkSpawn(S, x, y, z) { return below(S, x, y, z) !== 'nether_wart_block' && S.onGround(this, x, y, z); }
}
// a baby hit runs (the panic goal does it); grown ones answer
class BabyPanicTarget extends HurtByTargetGoal {
  constructor(mob) { super(mob, false); }
  canUse() { return !(this.mob.ageT < 0) && super.canUse(); }
}
register('hoglin', Hoglin);

export class Zoglin extends Monster {
  static W = 1.3965; static H = 1.4; static HEALTH = 40; static SPEED = 0.25; static ATTACK = 6; static KB_RESIST = 0.6; static FOLLOW = 16;
  static MODEL = 'hoglin'; static TEX = 'zoglin'; static SHADOW = 0.8; static UNDEAD = true; static XP = 5;
  constructor(m, type) { super(m, type); this.attackT = 0; }
  registerGoals() {
    this.goals.add(2, new HoglinAttack(this, 1, true));
    this.goals.add(6, new StrollGoal(this, 0.4));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    // anything alive that is not a creeper or another zoglin
    this.targets.add(3, new NearestMobTargetGoal(this, e => e instanceof Living && e.type !== 'creeper' && e.type !== 'zoglin' && !e.constructor.NOT_PICKABLE && e.maxHealth > 0, true));
  }
  // the undead do not burn: a zoglin does not catch fire in the sun
  sunBurn() {}
  doHurtTarget(t) { return hoglinHit(this, t); }
  aiStep() { super.aiStep(); if (this.attackT > 0) this.attackT--; }
  loot(drop, byPlayer, L) { drop('rotten_flesh', between(1, 3) + looted(L)); }
  anim(A) { A.hoglinAttack = this.attackT; }
}
register('zoglin', Zoglin);

/* ===========================================================================
   FIREBALLS
   A ghast's (large) and a blaze's (small): they speed up along their way,
   0.1 a tick and 0.95 drag (so at most 1.9 blocks a tick), ignore gravity,
   and hit the first thing in their path. Hit one with your hand or a
   sword and it flies off the way you look, yours now.
=========================================================================== */
export class Fireball extends Projectile {
  static W = 1; static H = 1; static MODEL = 'ball'; static TEX = 'fireball'; static SCALE = 4; static BRIGHT = true; static PICK = 0.5;
  constructor(m, type) { super(m, type); this.gravity = 0; this.drag = 0.95; this.power = 1; this.damage = 6; this.deflected = false; }
  get waterDrag() { return 0.8; }
  aim(dx, dy, dz) { const l = Math.hypot(dx, dy, dz) || 1; this.vel.set(dx / l * 0.1, dy / l * 0.1, dz / l * 0.1); }
  tick() {
    super.tick();
    if (this.removed) return;
    // the push along its way, after the drag
    const v = this.vel, l = v.length();
    if (l > 1e-6) v.addScaledVector(v, 0.1 * 0.95 / l);
    if (this.age % 2 === 0) this.m.particles('smoke', this.pos.x, this.pos.y + this.h / 2, this.pos.z, 1, 0.1);
  }
  // batted back by the player
  hurt(n, src) {
    if (!src || !src.player) return false;
    const P = this.m.P, s = Math.max(0.4, this.vel.length());
    const lx = -Math.sin(P.yaw) * Math.cos(P.pitch), ly = Math.sin(P.pitch), lz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    this.vel.set(lx * s, ly * s, lz * s);
    this.owner = this.m.player; this.deflected = true; this.age = 0;
    return true;
  }
  hitEntity(e) {
    if (e === this.owner && !this.deflected) return false;
    const src = { type: 'fireball', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    // a ghast hit by its own fireball sent back: 1000
    const dmg = this.deflected && e.type === 'ghast' ? 1000 : this.damage;
    if (e.isPlayer) this.m.hurtPlayer(dmg, src); else if (e.hurt) e.hurt(dmg, src);
    this.boom();
    return true;
  }
  hitBlock() { this.boom(); }
  boom() {
    if (this.removed) return;
    this.m.explode(this.pos.x, this.pos.y + this.h / 2, this.pos.z, this.power, { type: 'explosion', attacker: this.owner, mob: !this.deflected }, { fire: this.m.mobGriefing !== false });
    this.remove();
  }
}
register('fireball', Fireball);
export class SmallFireball extends Fireball {
  static W = 0.3125; static H = 0.3125; static SCALE = 1.25; static PICK = 0;
  constructor(m, type) { super(m, type); this.damage = 5; }
  hurt() { return false; }
  hitEntity(e) {
    if (e === this.owner || (e.constructor && e.constructor.FIRE_IMMUNE)) { this.remove(); return true; }
    const src = { type: 'fireball', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    const ok = e.isPlayer ? this.m.hurtPlayer(this.damage, src) : e.hurt && e.hurt(this.damage, src);
    // five seconds alight
    if (ok) { if (e.isPlayer) this.m.setPlayerFire(5); else if (e.setFire) e.setFire(5); }
    this.remove();
    return true;
  }
  // where it lands: fire on the air in front of the block
  hitBlock() {
    const T = this.m.t, v = this.vel, l = v.length() || 1;
    const x = Math.floor(this.pos.x - v.x / l * 0.1), y = Math.floor(this.pos.y - v.y / l * 0.1), z = Math.floor(this.pos.z - v.z / l * 0.1);
    if (this.m.mobGriefing !== false && B.fire !== undefined && T.get(x, y, z) === 0) this.m.world.set(x, y, z, B.fire, 0);
    this.remove();
  }
}
register('small_fireball', SmallFireball);

/* ===========================================================================
   GHAST
=========================================================================== */
export class Ghast extends Mob {
  static HOSTILE = true; static CATEGORY = 'monster'; static XP = 5;
  static W = 4; static H = 4; static HEALTH = 10; static SPEED = 0.7; static FOLLOW = 100; static FIRE_IMMUNE = true; static NO_FALL = true; static FLYING = true;
  static MODEL = 'ghast'; static TEX = 'ghast'; static SCALE = 4; static SHADOW = 0; static MAX_PER_CHUNK = 1; static HEAD_MAX = 0;
  constructor(m, type) { super(m, type); this.gravity = 0; this.charge = 0; this.want = null; this.floatT = 0; this.unseen = 0; }
  get eyeH() { return 2.6; }
  registerGoals() { this.targets.add(1, new GhastTarget(this)); }
  texName() { return this.charge > 10 ? 'ghast_shooting' : 'ghast'; }
  serverAi() {
    this.noActionTime++;
    this.m.despawnCheck(this);
    if (this.removed) return;
    this.targets.tick();
    const t = this.target;
    /* Floating about: a point within 16 blocks each way; every 2 to 6
       ticks a push of 0.1 towards it while the way is clear. */
    const p = this.pos;
    let w = this.want;
    const d2 = w ? (w[0] - p.x) ** 2 + (w[1] - p.y) ** 2 + (w[2] - p.z) ** 2 : 0;
    if (!w || d2 < 1 || d2 > 3600 || RI(7) === 0 && d2 < 4) {
      w = this.want = [p.x + (R() * 2 - 1) * 16, p.y + (R() * 2 - 1) * 16, p.z + (R() * 2 - 1) * 16];
    }
    if (--this.floatT <= 0) {
      this.floatT = 2 + RI(5);
      let dx = w[0] - p.x, dy = w[1] - p.y, dz = w[2] - p.z;
      const l = Math.hypot(dx, dy, dz);
      if (l > 1e-4) {
        dx /= l; dy /= l; dz /= l;
        // the way there clear for its whole box, a block at a time
        let ok = true;
        for (let i = 1; i < Math.ceil(l) && ok; i++) if (this.m.t.boxHits(p.x - 2 + dx * i, p.y + dy * i, p.z - 2 + dz * i, p.x + 2 + dx * i, p.y + 4 + dy * i, p.z + 2 + dz * i)) ok = false;
        if (ok) { this.vel.x += dx * 0.1; this.vel.y += dy * 0.1; this.vel.z += dz * 0.1; } else this.want = null;
      }
    }
    // facing: its target, or the way it drifts
    if (t) { this.yaw = yawTo(t.pos.x - p.x, t.pos.z - p.z); }
    else if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 1e-4) this.yaw = yawTo(this.vel.x, this.vel.z);
    this.followYaw();
    /* The fireball: while it sees its target within 64, the charge counts
       up; at 10 the face shows it, at 20 it shoots and waits 40. */
    if (t && t.alive() && this.dist2(t.pos.x, t.pos.y, t.pos.z) < 4096 && this.canSee(t)) {
      if (++this.charge === 20) { this.shoot(t); this.charge = -40; }
    } else if (this.charge > 0) this.charge--;
  }
  shoot(t) {
    const p = this.pos, s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const ox = p.x - s * 4, oy = p.y + this.h / 2 + 0.5, oz = p.z - c * 4;
    const f = this.m.spawn('fireball', ox, oy - 0.5, oz, { natural: false });
    if (!f) return;
    f.owner = this;
    f.aim(t.pos.x - ox, t.pos.y + (t.h || 1.8) / 2 - oy, t.pos.z - oz);
  }
  travel() {
    const v = this.vel;
    this.move(v.x, v.y, v.z);
    const d = this.inWater ? 0.8 : this.inLava ? 0.5 : 0.91;
    v.x *= d; v.y *= d; v.z *= d;
  }
  loot(drop, byPlayer, L) { drop('ghast_tear', RI(2) + looted(L)); drop('gunpowder', RI(3) + looted(L)); }
  // one in twenty tries, on a block it could stand on, with room for its 4 x 4 x 4
  static checkSpawn(S, x, y, z) { return S.m.difficulty !== 'peaceful' && RI(20) === 0 && S.onGround(this, x, y, z); }
}
class GhastTarget extends NearestPlayerTargetGoal {
  constructor(mob) { super(mob, true, p => Math.abs(p.pos.y - mob.pos.y) <= 4); }
}
register('ghast', Ghast);

/* ===========================================================================
   MAGMA CUBE
=========================================================================== */
export class MagmaCube extends Slime {
  static TEX = 'magma_cube'; static FIRE_IMMUNE = true; static NO_FALL = true; static BRIGHT = true;
  setSize(n, heal) {
    super.setSize(n, heal);
    this.armor = 3 * n;
    this.attackDamage = n + 2;
  }
  // it hops four times as seldom, and higher (0.42 + 0.1 a size)
  hopDelay() { return (10 + RI(20)) * 4; }
  jumpFromGround() { this.vel.y = 0.42 + 0.1 * this.size; this.onGround = false; }
  // even the smallest burns you
  aiStep() {
    super.aiStep();
    if (this.dead || this.size >= 2) return;
    const P = this.m.player, pp = P.pos, p = this.pos;
    if (!P.alive() || P.creative()) return;
    if (Math.abs(pp.x - p.x) < 0.6 + this.hw && Math.abs(pp.z - p.z) < 0.6 + this.hw && pp.y < p.y + this.h && pp.y + 1.8 > p.y && this.canSee(P)) this.doHurtTarget(P);
  }
  get xp() { return this.size; }
  loot(drop, byPlayer, L) { if (this.size > 1) drop('magma_cream', (RI(4) === 0 ? 1 : 0) + looted(L)); }
  // any light, on a block it could stand on
  static checkSpawn(S, x, y, z) { return S.m.difficulty !== 'peaceful' && S.onGround(this, x, y, z); }
}
register('magma_cube', MagmaCube);

/* ===========================================================================
   STRIDER
=========================================================================== */
const LAVA = () => B.lava;
export class Strider extends Animal {
  static W = 0.9; static H = 1.7; static HEALTH = 20; static SPEED = 0.175; static FIRE_IMMUNE = true; static SHADOW = 0.5;
  static MODEL = 'strider'; static TEX = 'strider'; static FOOD = ['warped_fungus']; static TEMPT = 1.4; static PANIC = 1.65;
  constructor(m, type) { super(m, type); this.saddled = false; this.cold = false; this.boostT = 0; this.boostLen = 0; this.onLava = false; }
  get eyeH() { return this.h * 0.9; }
  registerGoals() {
    super.registerGoals();
    // tempted by a warped fungus on a stick too
    this.goals.add(3, new TemptGoal(this, 1.4, ['warped_fungus', 'warped_fungus_on_a_stick']));
  }
  // where it likes to go: lava
  walkValue(x, y, z) { return FLUID[this.m.t.get(x, y - 1, z)] === 2 || FLUID[this.m.t.get(x, y, z)] === 2 ? 10 : 0; }
  /* The lava top it stands on: a strider walks on lava as on a floor (the
     top half of the highest lava block); under the surface it floats up. */
  lavaTop() {
    const T = this.m.t, x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    let y = Math.floor(this.pos.y + 0.01);
    for (let k = 0; k < 3; k++, y--) {
      if (FLUID[T.get(x, y, z)] === 2) {
        while (FLUID[T.get(x, y + 1, z)] === 2) y++;
        return y + 0.5;
      }
    }
    return null;
  }
  travel() {
    const top = this.lavaTop(), p = this.pos, v = this.vel;
    if (top !== null && p.y <= top + 0.01) {
      if (p.y < top - 0.3) {
        // under: float up, half speed
        this.moveRelative(0.02, this.xxa, this.zza);
        this.move(v.x, v.y, v.z);
        v.multiplyScalar(0.5); v.y += 0.05;
        this.onLava = false;
        return;
      }
      // on the surface: walk on it like ground
      p.y = top; if (v.y < 0) v.y = 0;
      this.onGround = true; this.onLava = true; this.inLava = false;
      const sp = this.zzaScale();
      this.moveRelative(sp, this.xxa, this.zza);
      this.move(v.x, 0, v.z);
      if (p.y < top) p.y = top;
      this.onGround = true;
      v.x *= 0.546; v.z *= 0.546;
      if (this.jumping && this.jumpDelay === 0) { v.y = 0.42; this.jumpDelay = 10; this.onGround = false; }
      return;
    }
    this.onLava = false;
    super.travel();
  }
  aiStep() {
    // warm on or in lava; cold anywhere else (slower, shivering, a dull purple)
    this.cold = !(this.onLava || this.inLava);
    super.aiStep();
    if (this.dead) return;
    // water and rain hurt it
    if (this.inWater || this.m.raining() && this.m.seesSky(Math.floor(this.pos.x), Math.floor(this.pos.y + this.h), Math.floor(this.pos.z))) this.hurt(1, { type: 'drown' });
    if (this.boostT > 0) this.boostT--;
  }
  zzaScale() { return (this.moveSpeedNow || this.speed) * (this.cold ? 0.66 : 1); }
  texName() { return this.cold && !this.dead ? 'strider_cold' : 'strider'; }
  interact(held) {
    if (held === 'saddle' && !this.saddled && this.ageT >= 0) { this.saddled = true; return 'consume'; }
    if (this.saddled && this.passengers.length === 0 && this.constructor.FOOD.indexOf(held) < 0) { this.m.mount(this); return 'swing'; }
    return super.interact(held);
  }
  /* Ridden and steered with a warped fungus on a stick: it goes where you
     look at 0.55 of its speed on lava (0.35, and its cold speed, on land). */
  rideControl(keys, rider) {
    if (this.m.heldName() !== 'warped_fungus_on_a_stick' && this.m.offhandName() !== 'warped_fungus_on_a_stick') return false;
    this.yaw = rider.yaw; this.bodyYaw = this.headYaw = this.yaw;
    // (cold, zzaScale takes it down by its cold speed as well)
    this.moveSpeedNow = this.speed * (this.cold ? 0.35 : 0.55) * this.boostFactor();
    this.zza = 1;
    return true;
  }
  // a boost from the stick: 140 to 980 ticks, the speed rising and falling up to 2.15 times
  boost() { if (this.boostT > 0) return false; this.boostLen = this.boostT = 140 + RI(841); return true; }
  boostFactor() { return this.boostT > 0 ? 1 + 1.15 * Math.sin((1 - this.boostT / this.boostLen) * PI) : 1; }
  seat() { return [0, this.h - 0.2, 0]; }
  layers(out) { if (this.saddled) out.push(['strider', 'strider_saddle', null]); }
  anim(A) { A.shiver = this.cold && !this.passengers.length; }
  loot(drop, byPlayer, L) { drop('string', between(2, 5) + looted(L)); if (this.saddled) drop('saddle', 1); }
  /* Spawning: in lava with air above the lava's top; one in thirty with a
     zombified piglin riding it, holding the stick. */
  static checkSpawn(S, x, y, z) {
    const T = S.m.t;
    if (FLUID[T.get(x, y, z)] !== 2) return false;
    let yy = y; while (FLUID[T.get(x, yy, z)] === 2) yy++;
    return T.get(x, yy, z) === 0;
  }
  finalizeSpawn(o) {
    if (!o || o.converted || o.egg) return;
    if (RI(30) === 0) {
      const r = this.m.spawn('zombified_piglin', this.pos.x, this.pos.y + this.h, this.pos.z, { natural: false });
      if (r) { r.equip.mainhand = 'warped_fungus_on_a_stick'; r.attackDamage = 5; this.saddled = true; ride(r, this); }
    } else if (RI(10) === 0) {
      const b = this.m.spawn('strider', this.pos.x, this.pos.y + this.h, this.pos.z, { natural: false, converted: true });
      if (b) { b.ageT = -24000; ride(b, this); }
    }
  }
  toJSON() { const o = super.toJSON(); if (this.saddled) o.sad = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.saddled = !!o.sad; }
}
function ride(rider, mount) { rider.vehicle = mount; mount.passengers.push(rider); }
addArt('strider_saddle', [64, 64], p => {
  p.clear(0, 0, 64, 64);
  p.fill(16, 0, 16, 16, 0x6a4024, 0.1);                // across the top of the body
  for (const x of [0, 16, 32, 48]) p.fill(x, 16, 16, 4, 0x6a4024, 0.1);
  p.fill(20, 4, 8, 8, 0x8a5a34, 0.1);
});
register('strider', Strider);

/* ===========================================================================
   WITHER SKELETON
=========================================================================== */
export class WitherSkeleton extends Skeleton {
  static W = 0.7; static H = 2.4; static HEALTH = 20; static SPEED = 0.25; static ATTACK = 4; static FIRE_IMMUNE = true;
  static TEX = 'wither_skeleton'; static SCALE = 1.2; static SHADOW = 0.6; static SPAWN_ARMOR = false;
  constructor(m, type) { super(m, type); this.equip.mainhand = 'stone_sword'; this.attackDamage = 8; }
  get eyeH() { return 2.1; }
  registerGoals() {
    this.goals.add(3, new AvoidGoal(this, e => e.type === 'wolf' && !e.dead, 6, 1, 1.2));
    this.goals.add(4, new MeleeAttackGoal(this, 1.2, false));
    this.goals.add(5, new StrollGoal(this, 1));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(6, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, false));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
    this.targets.add(3, new NearestMobTargetGoal(this, e => e.type === 'piglin' || e.type === 'iron_golem', true));
  }
  // its hit withers for 10 seconds
  doHurtTarget(t) {
    const ok = super.doHurtTarget(t);
    if (ok) { if (t.isPlayer) this.m.effectPlayer('wither', 200, 1); else if (t.wither) t.wither(200); }
    return ok;
  }
  loot(drop, byPlayer, L) {
    drop('coal', (RI(3) === 0 ? 1 : 0) + looted(L));
    drop('bone', RI(3) + looted(L));
    if (byPlayer && R() < 0.025 + 0.01 * L) drop('wither_skeleton_skull', 1);
  }
  anim(A) { A.aiming = false; A.aggressive = this.aggressive; }
  layers() {}
  static checkSpawn(S, x, y, z) { return S.monsterRules(this, x, y, z); }
}
register('wither_skeleton', WitherSkeleton);

/* ===========================================================================
   BLAZE
=========================================================================== */
class BlazeAttack extends Goal {
  constructor(mob) { super(mob, MOVE | LOOK); }
  canUse() { const t = this.mob.target; return !!t && t.alive(); }
  start() { this.step = 0; this.t = 0; this.seen = 0; }
  stop() { this.mob.charged = false; this.seen = 0; }
  tick() {
    const m = this.mob, t = m.target;
    if (!t) return;
    this.t--;
    const sees = m.canSee(t);
    this.seen = sees ? 0 : this.seen + 1;
    const d2 = m.dist2(t.pos.x, t.pos.y, t.pos.z);
    if (d2 < 4) {
      // close: a punch every 20 ticks
      if (!sees) return;
      if (this.t <= 0) { this.t = 20; m.doHurtTarget(t); }
      m.setWanted(t.pos.x, t.pos.y, t.pos.z, 1);
    } else if (d2 < 48 * 48 && sees) {
      if (this.t <= 0) {
        this.step++;
        if (this.step === 1) { this.t = 60; m.charged = true; }
        else if (this.step <= 4) this.t = 6;
        else { this.t = 100; this.step = 0; m.charged = false; }
        if (this.step > 1) m.shootAt(t, Math.sqrt(Math.sqrt(d2)) * 0.5);
      }
      m.lookAtEntity(t, 10, 10);
    } else if (this.seen < 5) m.setWanted(t.pos.x, t.pos.y, t.pos.z, 1);
  }
}
export class Blaze extends Monster {
  static W = 0.6; static H = 1.8; static HEALTH = 20; static SPEED = 0.23; static ATTACK = 6; static FOLLOW = 48;
  static FIRE_IMMUNE = true; static NO_FALL = true; static MODEL = 'blaze'; static TEX = 'blaze'; static BRIGHT = true; static SHADOW = 0.5; static XP = 10;
  constructor(m, type) { super(m, type); this.charged = false; this.heightOff = 0.5; this.heightT = 0; }
  registerGoals() {
    this.goals.add(4, new BlazeAttack(this));
    this.goals.add(7, new StrollGoal(this, 1));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookAroundGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, true));
    this.targets.add(2, new NearestPlayerTargetGoal(this, true));
  }
  shootAt(t, spread) {
    const ox = this.pos.x, oy = this.pos.y + this.h / 2 + 0.5, oz = this.pos.z;
    const f = this.m.spawn('small_fireball', ox, oy, oz, { natural: false });
    if (!f) return;
    f.owner = this;
    f.aim(t.pos.x - ox + gauss() * spread, t.pos.y + (t.h || 1.8) / 2 - oy, t.pos.z - oz + gauss() * spread);
  }
  serverAi() {
    super.serverAi();
    // every 5 seconds a new height to keep above its target (0.5 plus a spread of 3)
    if (--this.heightT <= 0) { this.heightT = 100; this.heightOff = 0.5 + gauss() * 3; }
    const t = this.target;
    if (t && t.alive() && t.pos.y + (t.eyeH || 1.62) > this.pos.y + this.eyeH + this.heightOff) this.vel.y += (0.3 - this.vel.y) * 0.3;
  }
  aiStep() {
    // it falls slowly (60% of its fall kept each tick)
    if (!this.onGround && this.vel.y < 0) this.vel.y *= 0.6;
    if (!this.dead && (this.inWater || this.m.raining() && this.m.seesSky(Math.floor(this.pos.x), Math.floor(this.pos.y + this.h), Math.floor(this.pos.z)))) this.hurt(1, { type: 'drown' });
    super.aiStep();
    if (!this.dead && this.age % 2 === 0) this.m.particles(this.charged ? 'flame' : 'smoke', this.pos.x + (R() - 0.5) * this.w, this.pos.y + R() * this.h, this.pos.z + (R() - 0.5) * this.w, 1, 0);
  }
  loot(drop, byPlayer, L) { if (byPlayer) drop('blaze_rod', RI(2) + looted(L)); }
  // light 11 or less (where it would walk), on a block it could stand on, at any darkness
  static checkSpawn(S, x, y, z) { return S.m.difficulty !== 'peaceful' && S.onGround(this, x, y, z) && S.walkOk(x, y, z); }
}
register('blaze', Blaze);

export const NETHER_TYPES = ['zombified_piglin', 'piglin', 'hoglin', 'zoglin', 'ghast', 'magma_cube', 'strider', 'wither_skeleton', 'blaze'];
