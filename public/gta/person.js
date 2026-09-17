/* ---------------------------------------------------------------------------
   A person.

   Low polygon, but at real proportions: 1.8 m tall, head about a seventh of it,
   shoulders wider than hips, limbs that taper. At the distance a third person
   camera sits, proportion and timing carry far more than polygon count does - a
   well timed walk on a simple body reads as a person, and a detailed model with
   a stiff walk reads as a shop dummy.

   Every part of a body is merged into one geometry per bone and coloured per
   vertex, so a crowd of a hundred is a few hundred draw calls sharing a single
   material rather than a few thousand sharing none.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });

/* ---- geometry helpers ----------------------------------------------------- */
// a box that can be a different size at the top than at the bottom, which is
// what turns a stack of boxes into something with a waist and a pair of shoulders
function frustum(wb, db, wt, dt, h, y0) {
  const y1 = (y0 || 0) + h, yb = y0 || 0;
  const b = [[-wb / 2, yb, -db / 2], [wb / 2, yb, -db / 2], [wb / 2, yb, db / 2], [-wb / 2, yb, db / 2]];
  const t = [[-wt / 2, y1, -dt / 2], [wt / 2, y1, -dt / 2], [wt / 2, y1, dt / 2], [-wt / 2, y1, dt / 2]];
  const quads = [
    [b[3], b[2], t[2], t[3]], [b[1], b[0], t[0], t[1]],
    [b[2], b[1], t[1], t[2]], [b[0], b[3], t[3], t[0]],
    [t[3], t[2], t[1], t[0]], [b[0], b[1], b[2], b[3]],
  ];
  const pos = [];
  for (const q of quads) {
    pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function box(w, h, d, ox, oy, oz) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(ox || 0, oy || 0, oz || 0);
  return g;
}
function limb(rTop, rBot, len, oy) {
  // hangs down from its pivot, which is how a shoulder and a hip work
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 7, 1).toNonIndexed();
  g.translate(0, (oy === undefined ? -len / 2 : oy), 0);
  return g;
}
function ball(r, ox, oy, oz) {
  const g = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
  g.translate(ox || 0, oy || 0, oz || 0);
  return g;
}

// one mesh per bone: merge the parts, bake the colour into the vertices
function bone(parts) {
  let n = 0;
  const geos = parts.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    n += g.attributes.position.count;
    return { g, c: new THREE.Color(p.c) };
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const it of geos) {
    const P = it.g.attributes.position.array, N = it.g.attributes.normal.array;
    const count = it.g.attributes.position.count;
    pos.set(P, o * 3);
    nor.set(N, o * 3);
    for (let i = 0; i < count; i++) {
      col[(o + i) * 3] = it.c.r; col[(o + i) * 3 + 1] = it.c.g; col[(o + i) * 3 + 2] = it.c.b;
    }
    o += count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, BODY_MAT);
  m.castShadow = true;
  return m;
}

const HAIRS = [0x2a1f18, 0x120f0d, 0x5b3a1e, 0x8a6a3a, 0x6b6b6b, 0x3a2a20];

/* ---- the body ------------------------------------------------------------- */
export function makePerson(shirt, skin, trouser, opts) {
  const o = opts || {};
  const SKIN = skin === undefined ? 0xe0b48c : skin;
  const SHIRT = shirt === undefined ? 0x2a3a6a : shirt;
  const LEG = trouser === undefined ? 0x23262e : trouser;
  const SHOE = o.shoe === undefined ? 0x191a1e : o.shoe;
  const HAIR = o.hair === undefined ? HAIRS[(Math.random() * HAIRS.length) | 0] : o.hair;
  const DARK = new THREE.Color(SHIRT).multiplyScalar(0.72).getHex();   // collar and cuffs

  const g = new THREE.Group();

  // hips are the root, the way a real rig works
  const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips);
  hips.add(bone([
    { g: frustum(0.30, 0.20, 0.33, 0.21, 0.14, -0.10), c: LEG },   // pelvis
  ]));

  const torso = new THREE.Group(); hips.add(torso);
  torso.add(bone([
    { g: frustum(0.33, 0.21, 0.36, 0.22, 0.22, 0.02), c: SHIRT },  // waist
    { g: frustum(0.36, 0.22, 0.44, 0.25, 0.22, 0.24), c: SHIRT },  // ribs
    { g: frustum(0.44, 0.25, 0.42, 0.23, 0.18, 0.46), c: SHIRT },  // chest and shoulders
    { g: box(0.13, 0.05, 0.19, 0, 0.635, 0.01), c: DARK },         // collar
  ]));

  const neck = new THREE.Group(); neck.position.y = 0.64; torso.add(neck);
  neck.add(bone([{ g: limb(0.055, 0.062, 0.09, 0.045), c: SKIN }]));

  const head = new THREE.Group(); head.position.y = 0.07; neck.add(head);
  head.add(bone([
    { g: frustum(0.155, 0.185, 0.172, 0.195, 0.115, 0), c: SKIN },      // jaw
    { g: frustum(0.172, 0.195, 0.168, 0.185, 0.105, 0.115), c: SKIN },  // skull
    { g: box(0.030, 0.030, 0.026, 0, 0.100, 0.102), c: SKIN },          // nose
    { g: box(0.020, 0.045, 0.022, -0.087, 0.115, 0.004), c: SKIN },     // ears
    { g: box(0.020, 0.045, 0.022, 0.087, 0.115, 0.004), c: SKIN },
    { g: box(0.035, 0.016, 0.014, -0.040, 0.132, 0.094), c: 0x1b1b1f }, // eyes
    { g: box(0.035, 0.016, 0.014, 0.040, 0.132, 0.094), c: 0x1b1b1f },
    { g: frustum(0.180, 0.200, 0.150, 0.170, 0.060, 0.170), c: HAIR },  // hair
    { g: box(0.178, 0.055, 0.030, 0, 0.150, -0.083), c: HAIR },
  ]));

  const arm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.205, 0.585, 0);
    torso.add(sh);
    sh.add(bone([
      { g: ball(0.072, 0, 0, 0), c: SHIRT },
      { g: limb(0.068, 0.056, 0.30), c: SHIRT },
    ]));
    const elbow = new THREE.Group(); elbow.position.y = -0.30; sh.add(elbow);
    elbow.add(bone([
      { g: ball(0.056, 0, 0, 0), c: SHIRT },
      { g: limb(0.055, 0.044, 0.15, -0.075), c: SHIRT },
      { g: limb(0.044, 0.041, 0.13, -0.215), c: SKIN },
    ]));
    const hand = new THREE.Group(); hand.position.y = -0.28; elbow.add(hand);
    hand.add(bone([{ g: frustum(0.075, 0.042, 0.062, 0.036, 0.11, -0.11), c: SKIN }]));
    return { sh, elbow, hand };
  };
  const armL = arm(-1), armR = arm(1);

  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, -0.06, 0);
    hips.add(hip);
    hip.add(bone([
      { g: ball(0.095, 0, 0.01, 0), c: LEG },
      { g: limb(0.092, 0.072, 0.40), c: LEG },
    ]));
    const knee = new THREE.Group(); knee.position.y = -0.40; hip.add(knee);
    knee.add(bone([
      { g: ball(0.072, 0, 0, 0), c: LEG },
      { g: limb(0.070, 0.050, 0.38), c: LEG },
    ]));
    const foot = new THREE.Group(); foot.position.y = -0.38; knee.add(foot);
    // the ankle sits 0.08 above the floor, so the sole has to reach down to it
    foot.add(bone([
      { g: box(0.100, 0.045, 0.245, 0, -0.0575, 0.035), c: SHOE },   // sole
      { g: box(0.094, 0.062, 0.160, 0, -0.004, 0.000), c: SHOE },    // upper
      { g: box(0.088, 0.040, 0.075, 0, -0.015, 0.090), c: SHOE },    // toe cap
    ]));
    return { hip, knee, foot };
  };
  const legL = leg(-1), legR = leg(1);

  g.userData = { hips, torso, neck, head, armL, armR, legL, legR };
  return g;
}

/* ---- poses -----------------------------------------------------------------
   Everything is set from rest every frame rather than accumulated, so a pose can
   never drift and switching between walking and aiming is instant.           */
const HIP_Y = 0.92;
function rest(u) {
  u.torso.rotation.set(0, 0, 0);
  u.head.rotation.set(0, 0, 0);
  u.hips.rotation.set(0, 0, 0);
  u.armL.sh.rotation.set(0, 0, 0.07); u.armL.elbow.rotation.set(0, 0, 0);
  u.armR.sh.rotation.set(0, 0, -0.07); u.armR.elbow.rotation.set(0, 0, 0);
  u.legL.hip.rotation.set(0, 0, 0.02); u.legL.knee.rotation.set(0, 0, 0); u.legL.foot.rotation.set(0, 0, 0);
  u.legR.hip.rotation.set(0, 0, -0.02); u.legR.knee.rotation.set(0, 0, 0); u.legR.foot.rotation.set(0, 0, 0);
  u.hips.position.y = HIP_Y;
}

export function poseIdle(g, t) {
  const u = g.userData; rest(u);
  const b = Math.sin(t * 1.5);
  u.hips.position.y = HIP_Y + b * 0.010;
  u.torso.rotation.x = 0.04 + b * 0.014;
  u.armL.sh.rotation.x = b * 0.035; u.armL.elbow.rotation.x = -0.18;
  u.armR.sh.rotation.x = -b * 0.035; u.armR.elbow.rotation.x = -0.18;
  u.head.rotation.y = Math.sin(t * 0.37) * 0.20;
  u.head.rotation.x = Math.sin(t * 0.61) * 0.04;
}

// one cycle is two steps; amount blends a walk into a run
export function poseWalk(g, phase, amount) {
  const u = g.userData; rest(u);
  const a = 0.5 + amount * 0.62;                 // how far the limbs swing
  const s = Math.sin(phase), c = Math.cos(phase);
  u.legL.hip.rotation.x = s * a;
  u.legR.hip.rotation.x = -s * a;
  u.legL.knee.rotation.x = -Math.max(0, -s) * a * 1.25 - 0.06;
  u.legR.knee.rotation.x = -Math.max(0, s) * a * 1.25 - 0.06;
  u.legL.foot.rotation.x = Math.max(0, s) * 0.34 - 0.05;
  u.legR.foot.rotation.x = Math.max(0, -s) * 0.34 - 0.05;
  // arms swing against the legs
  u.armL.sh.rotation.x = -s * a * 0.78;
  u.armR.sh.rotation.x = s * a * 0.78;
  u.armL.elbow.rotation.x = -0.28 - amount * 0.55 - Math.max(0, -s) * 0.45;
  u.armR.elbow.rotation.x = -0.28 - amount * 0.55 - Math.max(0, s) * 0.45;
  // the body bobs twice a cycle, leans into the run and counter rotates
  u.hips.position.y = HIP_Y - Math.abs(c) * 0.042 * a;
  u.torso.rotation.x = 0.05 + amount * 0.20;
  u.hips.rotation.y = s * 0.09 * amount;
  u.torso.rotation.y = -s * 0.13 * amount;
  u.hips.rotation.z = c * 0.035 * a;
  u.head.rotation.y = s * 0.05;
}

export function poseAim(g, pitch) {
  const u = g.userData; rest(u);
  u.torso.rotation.y = -0.36;                    // bladed, gun arm forward
  u.torso.rotation.x = 0.05;
  u.head.rotation.y = 0.32;
  u.armR.sh.rotation.set(-Math.PI / 2 - (pitch || 0) * 0.8, 0.28, -0.08);
  u.armR.elbow.rotation.x = -0.14;
  u.armL.sh.rotation.set(-Math.PI / 2 - (pitch || 0) * 0.8, -0.52, 0.24);
  u.armL.elbow.rotation.x = -0.60;
  u.legL.hip.rotation.x = 0.20; u.legL.knee.rotation.x = -0.28;
  u.legR.hip.rotation.x = -0.16; u.legR.knee.rotation.x = -0.20;
  u.hips.position.y = HIP_Y - 0.03;
}

export function poseSit(g) {
  const u = g.userData; rest(u);
  u.legL.hip.rotation.x = -1.38; u.legL.knee.rotation.x = 1.30;
  u.legR.hip.rotation.x = -1.38; u.legR.knee.rotation.x = 1.30;
  u.armL.sh.rotation.set(-1.05, -0.22, 0.12); u.armL.elbow.rotation.x = -0.55;
  u.armR.sh.rotation.set(-1.05, 0.22, -0.12); u.armR.elbow.rotation.x = -0.55;
  u.torso.rotation.x = 0.06;
  u.hips.position.y = HIP_Y - 0.30;
}

// a punch, and the wind up to it: t runs 0 to 1
export function posePunch(g, t, arm) {
  const u = g.userData; rest(u);
  const a = arm ? u.armR : u.armL;
  const s = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
  u.torso.rotation.y = (arm ? -1 : 1) * (0.25 - s * 0.55);
  a.sh.rotation.set(-1.25 - s * 0.35, 0, 0);
  a.elbow.rotation.x = -1.5 + s * 1.45;
  const b = arm ? u.armL : u.armR;
  b.sh.rotation.set(-0.9, 0, 0); b.elbow.rotation.x = -1.7;
  u.legL.hip.rotation.x = 0.16; u.legR.hip.rotation.x = -0.12;
  u.legL.knee.rotation.x = -0.2; u.legR.knee.rotation.x = -0.15;
}
