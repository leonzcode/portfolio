/* ---------------------------------------------------------------------------
   Leoncraft 2 - the mobs' shapes and how they move.

   Each model is a list of parts; each part has a pivot, a resting turn and
   boxes, in the game's model units (pixels, y down from 24 above the feet,
   -z the front). A box is
     [x, y, z, w, h, d, u, v, inflate, mirror, tinted]
   relative to its part's pivot, with its texture at (u, v) unwrapped the
   usual way (top and bottom over the four sides). The sizes give the
   familiar proportions; the textures are our own (entities/mobart.js).

   A pose is 7 numbers a part (x, y, z, x turn, y turn, z turn, scale),
   filled from the resting pose and then moved by the model's animate().
   The walking cycles use the game's numbers: limbs swing on
   cos(walk * 0.6662), legs 1.4 times as far, the amount eased per tick.
--------------------------------------------------------------------------- */
const PI = Math.PI;

export const MODELS = {};
function model(name, size, parts, animate) {
  const m = { name, size, parts: parts.map(p => Object.assign({ pivot: [0, 0, 0], rot: [0, 0, 0], boxes: [], parent: -1 }, p)), animate };
  m.index = {};
  m.parts.forEach((p, i) => { m.index[p.name] = i; });
  // children name their parent; turn that into an index
  for (const p of m.parts) if (typeof p.parent === 'string') p.parent = m.index[p.parent];
  MODELS[name] = m;
  return m;
}
export const POSE = 7;
export function restPose(m, out) {
  for (let i = 0; i < m.parts.length; i++) {
    const p = m.parts[i], o = i * POSE;
    out[o] = p.pivot[0]; out[o + 1] = p.pivot[1]; out[o + 2] = p.pivot[2];
    out[o + 3] = p.rot[0]; out[o + 4] = p.rot[1]; out[o + 5] = p.rot[2]; out[o + 6] = 1;
  }
}
// the pieces of a pose, by part index
const RX = 3, RY = 4, RZ = 5;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };
const add = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] += v; };

/* The animation inputs, filled per frame by the entity (all eased between ticks):
     walk, amt     limb swing position and amount
     age           ticks alive (plus the frame's fraction)
     yaw, pitch    the head's turn from the body, and up/down (radians)
     attack        0..1 through the arm swing
     extra         per mob: aggressive, aiming, eating, flap, swell, ... */

/* ---- humanoids: zombies, husks, drowned, skeletons, strays, villagers ---- */
function humanoidParts(o) {
  const armW = o.thin ? 2 : 4, legW = o.thin ? 2 : 4;
  const parts = [
    { name: 'head', pivot: [0, 0, 0], boxes: [[-4, -8, -4, 8, 8, 8, 0, 0]].concat(o.hat === false ? [] : [[-4, -8, -4, 8, 8, 8, 32, 0, 0.5]]) },
    { name: 'body', pivot: [0, 0, 0], boxes: [[-4, 0, -2, 8, 12, 4, 16, 16]].concat(o.jacket ? [[-4, 0, -2, 8, 12, 4, 16, 32, 0.25]] : []) },
    { name: 'rightArm', pivot: [-5, 2, 0], boxes: o.thin ? [[-1, -2, -1, 2, 12, 2, 40, 16]] : [[-3, -2, -2, 4, 12, 4, 40, 16]].concat(o.jacket ? [[-3, -2, -2, 4, 12, 4, 40, 32, 0.25]] : []) },
    { name: 'leftArm', pivot: [5, 2, 0], boxes: o.thin ? [[-1, -2, -1, 2, 12, 2, 40, 16, 0, true]] : [[-1, -2, -2, 4, 12, 4, 32, 48]].concat(o.jacket ? [[-1, -2, -2, 4, 12, 4, 48, 48, 0.25]] : []) },
    { name: 'rightLeg', pivot: [o.thin ? -2 : -1.9, 12, 0], boxes: o.thin ? [[-1, 0, -1, 2, 12, 2, 0, 16]] : [[-2, 0, -2, 4, 12, 4, 0, 16]].concat(o.jacket ? [[-2, 0, -2, 4, 12, 4, 0, 32, 0.25]] : []) },
    { name: 'leftLeg', pivot: [o.thin ? 2 : 1.9, 12, 0], boxes: o.thin ? [[-1, 0, -1, 2, 12, 2, 0, 16, 0, true]] : [[-2, 0, -2, 4, 12, 4, 16, 48]].concat(o.jacket ? [[-2, 0, -2, 4, 12, 4, 0, 48, 0.25]] : []) },
  ];
  void armW; void legW;
  return parts;
}
function humanoidWalk(m, P, A) {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const c = Math.cos(A.walk * 0.6662), s = A.amt;
  set(P, I.rightArm, RX, Math.cos(A.walk * 0.6662 + PI) * s);
  set(P, I.leftArm, RX, c * s);
  set(P, I.rightLeg, RX, c * 1.4 * s);
  set(P, I.leftLeg, RX, Math.cos(A.walk * 0.6662 + PI) * 1.4 * s);
  if (A.riding) {
    add(P, I.rightArm, RX, -PI / 5); add(P, I.leftArm, RX, -PI / 5);
    set(P, I.rightLeg, RX, -1.4137167); set(P, I.rightLeg, RY, PI / 10); set(P, I.rightLeg, RZ, 0.07853982);
    set(P, I.leftLeg, RX, -1.4137167); set(P, I.leftLeg, RY, -PI / 10); set(P, I.leftLeg, RZ, -0.07853982);
  }
}
function armSway(m, P, A) {
  const I = m.index, sz = Math.cos(A.age * 0.09) * 0.05 + 0.05, sx = Math.sin(A.age * 0.067) * 0.05;
  add(P, I.rightArm, RZ, sz); add(P, I.leftArm, RZ, -sz);
  add(P, I.rightArm, RX, sx); add(P, I.leftArm, RX, -sx);
}
// a zombie's arms: held out in front, higher when it is after you, a chop when it hits
function zombieArms(m, P, A) {
  const I = m.index, at = A.attack;
  const f = Math.sin(at * PI), f1 = Math.sin((1 - (1 - at) * (1 - at)) * PI);
  set(P, I.rightArm, RZ, 0); set(P, I.leftArm, RZ, 0);
  set(P, I.rightArm, RY, -(0.1 - f * 0.6)); set(P, I.leftArm, RY, 0.1 - f * 0.6);
  const g = -PI / (A.aggressive ? 1.5 : 2.25);
  set(P, I.rightArm, RX, g + f * 1.2 - f1 * 0.4); set(P, I.leftArm, RX, g + f * 1.2 - f1 * 0.4);
  armSway(m, P, A);
}
// the right arm's swing (a skeleton in melee, a villager, a witch)
function swingArm(m, P, A) {
  const I = m.index, at = A.attack;
  if (at <= 0) return;
  const by = Math.sin(Math.sqrt(at) * PI * 2) * 0.2;
  set(P, I.body, RY, by);
  add(P, I.rightArm, RY, by); add(P, I.leftArm, RY, by); add(P, I.leftArm, RX, by);
  const e = 1 - Math.pow(1 - at, 4);
  add(P, I.rightArm, RX, -(Math.sin(e * PI) * 1.2 + Math.sin(at * PI) * -(P[I.head * POSE + RX] - 0.7) * 0.75));
  add(P, I.rightArm, RY, by * 2);
  add(P, I.rightArm, RZ, Math.sin(at * PI) * -0.4);
}
function zombieAnim(m, P, A) { humanoidWalk(m, P, A); zombieArms(m, P, A); }
model('zombie', [64, 64], humanoidParts({ jacket: false }), zombieAnim);
model('skeleton', [64, 32], humanoidParts({ thin: true }), (m, P, A) => {
  humanoidWalk(m, P, A);
  const I = m.index;
  if (A.aiming) {
    // the bow drawn: both arms up to the eyes, following the head
    const hy = P[I.head * POSE + RY], hx = P[I.head * POSE + RX];
    set(P, I.rightArm, RY, -0.1 + hy); set(P, I.leftArm, RY, 0.1 + hy + 0.4);
    set(P, I.rightArm, RX, -PI / 2 + hx); set(P, I.leftArm, RX, -PI / 2 + hx);
  } else swingArm(m, P, A);
  armSway(m, P, A);
});

/* ---- villagers and zombie villagers: the big nose, the robe, folded arms ---- */
function villagerParts(zombie) {
  return [
    { name: 'head', pivot: [0, 0, 0], boxes: [[-4, -10, -4, 8, 10, 8, 0, 0], [-4, -10, -4, 8, 10, 8, 32, 0, 0.51]] },
    { name: 'nose', parent: 'head', pivot: [0, -2, 0], boxes: [[-1, -1, -6, 2, 4, 2, 24, 0]] },
    // a hat's brim (a farmer's, a fisherman's...): flat round the head; bare where the texture is clear
    { name: 'hatRim', parent: 'head', pivot: [0, 0, 0], rot: [-PI / 2, 0, 0], boxes: [[-8, -8, -6, 16, 16, 1, 30, 47]] },
    { name: 'body', pivot: [0, 0, 0], boxes: [[-4, 0, -3, 8, 12, 6, 16, 20], [-4, 0, -3, 8, 18, 6, 0, 38, 0.5]] },
    zombie ? { name: 'rightArm', pivot: [-5, 2, 0], boxes: [[-3, -2, -2, 4, 12, 4, 44, 22]] }
      : { name: 'arms', pivot: [0, 3, -1], rot: [-0.75, 0, 0], boxes: [[-4, 2, -2, 8, 4, 4, 40, 38], [-8, -2, -2, 4, 8, 4, 44, 22], [4, -2, -2, 4, 8, 4, 44, 22, 0, true]] },
    zombie ? { name: 'leftArm', pivot: [5, 2, 0], boxes: [[-1, -2, -2, 4, 12, 4, 44, 22, 0, true]] } : null,
    { name: 'rightLeg', pivot: [-2, 12, 0], boxes: [[-2, 0, -2, 4, 12, 4, 0, 22]] },
    { name: 'leftLeg', pivot: [2, 12, 0], boxes: [[-2, 0, -2, 4, 12, 4, 0, 22, 0, true]] },
  ].filter(Boolean);
}
model('villager', [64, 64], villagerParts(false), (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  if (A.shake) set(P, I.head, RZ, 0.3 * Math.sin(0.45 * A.age));
  const c = Math.cos(A.walk * 0.6662) * 1.4 * A.amt * 0.5;
  set(P, I.rightLeg, RX, c); set(P, I.leftLeg, RX, -c);
});
model('zombie_villager', [64, 64], villagerParts(true), (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const c = Math.cos(A.walk * 0.6662) * 1.4 * A.amt * 0.5;
  set(P, I.rightLeg, RX, c); set(P, I.leftLeg, RX, -c);
  zombieArms(m, P, A);
});
model('witch', [64, 128], villagerParts(false).concat([
  { name: 'hat', parent: 'head', pivot: [-5, -10.03, -5], boxes: [[0, 0, 0, 10, 2, 10, 0, 64]] },
  { name: 'hat2', parent: 'hat', pivot: [1.75, -4, 2], rot: [-0.05235988, 0, 0.02617994], boxes: [[0, 0, 0, 7, 4, 7, 0, 76]] },
  { name: 'hat3', parent: 'hat2', pivot: [1.75, -4, 2], rot: [-0.10471976, 0, 0.05235988], boxes: [[0, 0, 0, 4, 4, 4, 0, 87]] },
  { name: 'hat4', parent: 'hat3', pivot: [1.75, -2, 2], rot: [-0.20943952, 0, 0.10471976], boxes: [[0, 0, 0, 1, 2, 1, 0, 95, 0.25]] },
  { name: 'mole', parent: 'nose', pivot: [0, 2, 0], boxes: [[0, 3, -6.75, 1, 1, 1, 0, 0, -0.25]] },
]), (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const c = Math.cos(A.walk * 0.6662) * 1.4 * A.amt * 0.5;
  set(P, I.rightLeg, RX, c); set(P, I.leftLeg, RX, -c);
  if (A.drinking) set(P, I.nose, 1, -2 + 1);
});

/* ---- the creeper ---- */
model('creeper', [64, 32], [
  { name: 'head', pivot: [0, 6, 0], boxes: [[-4, -8, -4, 8, 8, 8, 0, 0]] },
  { name: 'body', pivot: [0, 6, 0], boxes: [[-4, 0, -2, 8, 12, 4, 16, 16]] },
  { name: 'rightHind', pivot: [-2, 18, 4], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
  { name: 'leftHind', pivot: [2, 18, 4], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
  { name: 'rightFront', pivot: [-2, 18, -4], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
  { name: 'leftFront', pivot: [2, 18, -4], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  quadLegs(I, P, A, 1.4);
});
function quadLegs(I, P, A, k) {
  const c = Math.cos(A.walk * 0.6662) * k * A.amt, d = Math.cos(A.walk * 0.6662 + PI) * k * A.amt;
  set(P, I.rightHind, RX, c); set(P, I.leftHind, RX, d);
  set(P, I.rightFront, RX, d); set(P, I.leftFront, RX, c);
}

/* ---- the spider (and the cave spider, drawn smaller) ---- */
const LEG = 0.7853982, MID = 0.58119464;
model('spider', [64, 32], [
  { name: 'head', pivot: [0, 15, -3], boxes: [[-4, -4, -8, 8, 8, 8, 32, 4]] },
  { name: 'neck', pivot: [0, 15, 0], boxes: [[-3, -3, -3, 6, 6, 6, 0, 0]] },
  { name: 'body', pivot: [0, 15, 9], boxes: [[-5, -4, -6, 10, 8, 12, 0, 12]] },
  { name: 'rightHind', pivot: [-4, 15, 2], rot: [0, LEG, -LEG], boxes: [[-15, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'leftHind', pivot: [4, 15, 2], rot: [0, -LEG, LEG], boxes: [[-1, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'rightMidHind', pivot: [-4, 15, 1], rot: [0, PI / 8, -MID], boxes: [[-15, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'leftMidHind', pivot: [4, 15, 1], rot: [0, -PI / 8, MID], boxes: [[-1, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'rightMidFront', pivot: [-4, 15, 0], rot: [0, -PI / 8, -MID], boxes: [[-15, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'leftMidFront', pivot: [4, 15, 0], rot: [0, PI / 8, MID], boxes: [[-1, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'rightFront', pivot: [-4, 15, -1], rot: [0, -LEG, -LEG], boxes: [[-15, -1, -1, 16, 2, 2, 18, 0]] },
  { name: 'leftFront', pivot: [4, 15, -1], rot: [0, LEG, LEG], boxes: [[-1, -1, -1, 16, 2, 2, 18, 0]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const w = A.walk * 0.6662 * 2, s = A.amt;
  const sw = ph => -(Math.cos(w + ph) * 0.4) * s, up = ph => Math.abs(Math.sin(A.walk * 0.6662 + ph) * 0.4) * s;
  const pairs = [['rightHind', 'leftHind', 0], ['rightMidHind', 'leftMidHind', PI], ['rightMidFront', 'leftMidFront', PI / 2], ['rightFront', 'leftFront', PI * 1.5]];
  for (const [r, l, ph] of pairs) {
    add(P, I[r], RY, sw(ph)); add(P, I[l], RY, -sw(ph));
    add(P, I[r], RZ, up(ph)); add(P, I[l], RZ, -up(ph));
  }
});

/* ---- four legged animals ---- */
model('pig', [64, 32], [
  { name: 'head', pivot: [0, 12, -6], boxes: [[-4, -4, -8, 8, 8, 8, 0, 0], [-2, 0, -9, 4, 3, 1, 16, 16]] },
  { name: 'body', pivot: [0, 11, 2], rot: [PI / 2, 0, 0], boxes: [[-5, -10, -7, 10, 16, 8, 28, 8]] },
  { name: 'rightHind', pivot: [-3, 18, 7], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
  { name: 'leftHind', pivot: [3, 18, 7], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
  { name: 'rightFront', pivot: [-3, 18, -5], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
  { name: 'leftFront', pivot: [3, 18, -5], boxes: [[-2, 0, -2, 4, 6, 4, 0, 16]] },
], quadAnim);
// the saddle on a saddled pig: drawn over the pig with the same bones
model('pig_saddle', [64, 32], [
  { name: 'head', pivot: [0, 12, -6], boxes: [] },
  { name: 'body', pivot: [0, 11, 2], rot: [PI / 2, 0, 0], boxes: [[-5, -10, -7, 10, 16, 8, 28, 8, 0.5]] },
], quadAnim);
function quadAnim(m, P, A) {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  quadLegs(I, P, A, 1.4);
  if (A.eating !== undefined && A.eating > 0) {
    // a sheep's head goes down to the grass and nibbles
    const e = A.eating;
    set(P, I.head, 1, (m.parts[I.head].pivot[1]) + e * 9);
    set(P, I.head, RX, e > 0.1 && e < 0.9 ? PI / 5 + 0.21991149 * Math.sin(A.age * 28.7 * 0.0) + Math.sin(A.age * 4.0) * 0.17 : e * PI / 5);
  }
}
model('cow', [64, 32], [
  { name: 'head', pivot: [0, 4, -8], boxes: [[-4, -4, -6, 8, 8, 6, 0, 0], [-5, -5, -4, 1, 3, 1, 22, 0], [4, -5, -4, 1, 3, 1, 22, 0]] },
  { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: [[-6, -10, -7, 12, 18, 10, 18, 4], [-2, 2, -8, 4, 6, 1, 52, 0]] },
  { name: 'rightHind', pivot: [-4, 12, 7], boxes: [[-2, 0, -2, 4, 12, 4, 0, 16]] },
  { name: 'leftHind', pivot: [4, 12, 7], boxes: [[-2, 0, -2, 4, 12, 4, 0, 16, 0, true]] },
  { name: 'rightFront', pivot: [-4, 12, -6], boxes: [[-2, 0, -2, 4, 12, 4, 0, 16]] },
  { name: 'leftFront', pivot: [4, 12, -6], boxes: [[-2, 0, -2, 4, 12, 4, 0, 16, 0, true]] },
], quadAnim);
const sheepParts = wool => [
  { name: 'head', pivot: [0, 6, -8], boxes: wool ? [[-3, -4, -4, 6, 6, 6, 0, 0, 0.6, false, 1]] : [[-3, -4, -6, 6, 6, 8, 0, 0]] },
  { name: 'body', pivot: [0, 5, 2], rot: [PI / 2, 0, 0], boxes: wool ? [[-4, -10, -7, 8, 16, 6, 28, 8, 1.75, false, 1]] : [[-4, -10, -7, 8, 16, 6, 28, 8]] },
  { name: 'rightHind', pivot: [-3, 12, 7], boxes: wool ? [[-2, 0, -2, 4, 6, 4, 0, 16, 0.5, false, 1]] : [[-2, 0, -2, 4, 12, 4, 0, 16]] },
  { name: 'leftHind', pivot: [3, 12, 7], boxes: wool ? [[-2, 0, -2, 4, 6, 4, 0, 16, 0.5, false, 1]] : [[-2, 0, -2, 4, 12, 4, 0, 16]] },
  { name: 'rightFront', pivot: [-3, 12, -5], boxes: wool ? [[-2, 0, -2, 4, 6, 4, 0, 16, 0.5, false, 1]] : [[-2, 0, -2, 4, 12, 4, 0, 16]] },
  { name: 'leftFront', pivot: [3, 12, -5], boxes: wool ? [[-2, 0, -2, 4, 6, 4, 0, 16, 0.5, false, 1]] : [[-2, 0, -2, 4, 12, 4, 0, 16]] },
];
model('sheep', [64, 32], sheepParts(false), quadAnim);
model('sheep_wool', [64, 32], sheepParts(true), quadAnim);

/* ---- the chicken ---- */
model('chicken', [64, 32], [
  { name: 'head', pivot: [0, 15, -4], boxes: [[-2, -6, -2, 4, 6, 3, 0, 0], [-2, -4, -4, 4, 2, 2, 14, 0], [-1, -2, -3, 2, 2, 2, 14, 4]] },
  { name: 'body', pivot: [0, 16, 0], rot: [PI / 2, 0, 0], boxes: [[-3, -4, -3, 6, 8, 6, 0, 9]] },
  { name: 'rightLeg', pivot: [-2, 19, 1], boxes: [[-1, 0, -3, 3, 5, 3, 26, 0]] },
  { name: 'leftLeg', pivot: [1, 19, 1], boxes: [[-1, 0, -3, 3, 5, 3, 26, 0]] },
  { name: 'rightWing', pivot: [-4, 13, 0], boxes: [[0, 0, -3, 1, 4, 6, 24, 13]] },
  { name: 'leftWing', pivot: [4, 13, 0], boxes: [[-1, 0, -3, 1, 4, 6, 24, 13]] },
], (m, P, A) => {
  const I = m.index;
  set(P, I.head, RY, A.yaw); set(P, I.head, RX, A.pitch);
  const c = Math.cos(A.walk * 0.6662) * 1.4 * A.amt;
  set(P, I.rightLeg, RX, c); set(P, I.leftLeg, RX, -c);
  const f = A.flap || 0;
  set(P, I.rightWing, RZ, f); set(P, I.leftWing, RZ, -f);
});

export function partCount(name) { return MODELS[name].parts.length; }
