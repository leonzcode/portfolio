/* ---------------------------------------------------------------------------
   Karts, and the way they drive.

   The handling is arcade on purpose. A kart has one speed along its heading and
   a slide angle that only exists while drifting, which is the whole trick of the
   genre: you hop, the back steps out, the heading swings wider than the travel,
   a charge builds, and letting go of the hop fires you out of the corner. Grip,
   mass and slip angles would be more honest and much less fun.

   Every kart is merged into a couple of meshes with its colours baked into the
   vertices, so a full grid of twelve costs a few dozen draw calls.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

export const RACERS = [
  { id: 'pip',  name: 'Pip',  shirt: 0xe8402a, skin: 0xffd9b0, cap: 0xe8402a, kart: 0xe8402a, trim: 0xffd233 },
  { id: 'nib',  name: 'Nib',  shirt: 0x2f9440, skin: 0xd9a877, cap: 0x17223b, kart: 0x43d94f, trim: 0xfff6e2 },
  { id: 'wren', name: 'Wren', shirt: 0x2b56d6, skin: 0xf0d2b4, cap: 0xffd233, kart: 0x2b56d6, trim: 0x8fd3ff },
  { id: 'bram', name: 'Bram', shirt: 0x7a3fb0, skin: 0x8a5a36, cap: 0xffd233, kart: 0x9a4fd0, trim: 0xffd233 },
  { id: 'coco', name: 'Coco', shirt: 0xff8a1f, skin: 0x5f3b22, cap: 0x17223b, kart: 0xff8a1f, trim: 0xfff6e2 },
  { id: 'mox',  name: 'Mox',  shirt: 0x17223b, skin: 0xe8c39a, cap: 0xe8402a, kart: 0x3a3f4a, trim: 0xe8402a },
  { id: 'juno', name: 'Juno', shirt: 0xff5fa2, skin: 0xffd9b0, cap: 0xfff6e2, kart: 0xff5fa2, trim: 0x8fd3ff },
  { id: 'tock', name: 'Tock', shirt: 0x1fb6a6, skin: 0xb07a4e, cap: 0x17223b, kart: 0x1fb6a6, trim: 0xffd233 },
];

const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.08 });
const TYRE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

/* Yaw zero faces -z here, the same as everything else in these games, so the
   model is built nose-first towards -z. The helpers negate z once so the part
   list can be written the way you would sketch it, nose forward. */
function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, -z);
  return g;
}
function cyl(r1, r2, len, seg, axis, x, y, z) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg).toNonIndexed();
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, -z);
  return g;
}
function ball(r, x, y, z) {
  const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
  g.translate(x, y, -z);
  return g;
}
function merge(parts, mat) {
  let n = 0;
  for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  let o = 0;
  for (const p of parts) {
    const count = p.g.attributes.position.count;
    pos.set(p.g.attributes.position.array, o * 3);
    nor.set(p.g.attributes.normal.array, o * 3);
    c.setHex(p.c);
    for (let i = 0; i < count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += count;
    p.g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/* ---- the model ----------------------------------------------------------- */
export function makeKart(who) {
  const r = who || RACERS[0];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const shell = [
    // chassis: a wedge with a fat nose, sat low
    { g: box(1.5, 0.42, 2.3, 0, 0.42, 0), c: r.kart },
    { g: box(1.62, 0.26, 1.5, 0, 0.30, -0.1), c: r.kart },
    { g: box(1.2, 0.30, 0.5, 0, 0.66, 0.95), c: r.trim },        // nose cone
    { g: box(1.34, 0.20, 0.8, 0, 0.70, -0.75), c: r.trim },      // engine deck
    { g: box(0.9, 0.34, 0.5, 0, 0.90, -0.95), c: 0x3a3f4a },     // engine block
    { g: cyl(0.12, 0.14, 0.7, 7, 'z', 0.34, 1.02, -1.25), c: 0xb8bcc4 },  // pipes
    { g: cyl(0.12, 0.14, 0.7, 7, 'z', -0.34, 1.02, -1.25), c: 0xb8bcc4 },
    { g: box(1.5, 0.12, 0.34, 0, 1.24, -1.05), c: r.trim },      // spoiler
    { g: box(0.14, 0.34, 0.14, 0.62, 1.05, -1.05), c: r.kart },
    { g: box(0.14, 0.34, 0.14, -0.62, 1.05, -1.05), c: r.kart },
    { g: box(0.78, 0.5, 0.16, 0, 0.92, -0.34), c: r.kart },      // seat back
    { g: cyl(0.22, 0.22, 0.07, 10, 'z', 0, 1.02, 0.5), c: 0x17223b },     // wheel
    { g: box(0.07, 0.24, 0.07, 0, 0.88, 0.5), c: 0x3a3f4a },
  ];

  // the driver: big head, small body, hands on the wheel
  const d = [
    { g: box(0.52, 0.44, 0.34, 0, 0.98, 0.02), c: r.shirt },
    { g: cyl(0.10, 0.10, 0.10, 8, 'y', 0, 1.24, 0.02), c: r.skin },
    { g: ball(0.36, 0, 1.55, 0.02), c: r.skin },                  // head
    { g: box(0.62, 0.14, 0.62, 0, 1.78, 0.0), c: r.cap },         // cap crown
    { g: box(0.44, 0.10, 0.34, 0, 1.68, 0.34), c: r.cap },        // peak
    { g: box(0.10, 0.06, 0.05, -0.13, 1.5, 0.34), c: 0x17223b },  // eyes
    { g: box(0.10, 0.06, 0.05, 0.13, 1.5, 0.34), c: 0x17223b },
    { g: cyl(0.09, 0.09, 0.5, 7, 'y', -0.3, 1.05, 0.26), c: r.shirt },
    { g: cyl(0.09, 0.09, 0.5, 7, 'y', 0.3, 1.05, 0.26), c: r.shirt },
    { g: ball(0.12, -0.24, 1.02, 0.46), c: 0xfff6e2 },            // gloves
    { g: ball(0.12, 0.24, 1.02, 0.46), c: 0xfff6e2 },
  ];
  // lean the arms forward onto the wheel
  body.add(merge(shell.concat(d), BODY_MAT));

  const wheels = [];
  const WX = 0.86, WZ = 0.82;
  for (const [sx, sz, steers] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
    const hub = new THREE.Group();
    hub.position.set(sx * WX, 0.38, -sz * WZ);
    const m = merge([
      { g: cyl(0.38, 0.38, 0.34, 12, 'x', 0, 0, 0), c: 0x17223b },
      { g: cyl(0.2, 0.2, 0.36, 8, 'x', 0, 0, 0), c: 0xfff6e2 },
    ], TYRE_MAT);
    hub.add(m);
    body.add(hub);
    wheels.push({ hub, spin: m, steers });
  }

  const kart = {
    who: r, group, body, wheels,
    pos: new THREE.Vector3(), yaw: 0, speed: 0,
    drift: 0,            // -1 left, 1 right, 0 none
    driftT: 0, slide: 0, hop: 0, hopV: 0,
    driftE: 1,           // how much slide you have left in the tank
    pitch: 0, roadRise: 0, inSand: 0,
    // how hard you are revving on the grid, which everybody can see
    rev: 0,
    boost: 0, coins: 0, spin: 0, slow: 0, star: 0,
    lap: 1, cpi: 0, prog: 0, place: 1, finished: 0,
    item: null, itemN: 0, roulette: 0,
    // what is queued behind the one in the slot, oldest first
    queue: [],
    hint: 0, offroad: false, wheelSpin: 0, steerVis: 0, lean: 0, topMul: 1, roll: 0, wet: false,
    // how hard gravity pulls on whatever is in the air: a drift hop is a flick,
    // a ramp is a jump, and they should not fall at the same rate
    airG: 26,
  };
  apply(kart);
  return kart;
}

export function apply(k) {
  k.group.position.set(k.pos.x, k.pos.y + k.hop, k.pos.z);
  // The kart is drawn cocked INTO the corner, which is what a drift looks like:
  // slide is the angle travel sits away from the heading, so the body goes the
  // other way. Adding it instead swung the kart away from the turn, and pressing
  // right while drifting looked for all the world like going left.
  k.group.rotation.y = k.yaw - k.slide * 0.45;
  // rotation.z is applied before the yaw, so it rolls the kart about its own
  // length: that is the camber of the road under it
  k.group.rotation.z = k.roll;
  // revving on the grid: a shake everybody can see, since rev rides along in the
  // position each browser sends
  if (k.rev > 0.02) {
    const t = performance.now() * 0.001;
    k.group.position.x += Math.sin(t * 37) * 0.11 * k.rev;
    k.group.position.z += Math.cos(t * 31) * 0.07 * k.rev;
  }
  k.body.rotation.z = k.lean;
  // nose up on the way up, nose down on the way down
  k.body.rotation.x = -k.speed * 0.0012 + k.pitch;
  for (const w of k.wheels) {
    w.hub.rotation.y = w.steers ? k.steerVis : 0;
    w.spin.rotation.x = k.wheelSpin;
  }
  const s = 1 + Math.min(0.14, k.boost * 0.5);
  k.group.scale.set(1 / (1 + (s - 1) * 0.4), 1, s);
}

/* ---- how it drives ------------------------------------------------------- */
export const TUNE = {
  accel: 15,
  top: 30,                 // metres a second on tarmac, before coins and boosts
  reverse: 9,
  brake: 26,
  drag: 5,
  steer: 1.9,              // radians a second at speed
  driftSteer: 2.6,
  offTop: 0.48,            // how much of your speed the grass leaves you
  offAccel: 0.45,
  boostTop: 1.45,
  starTop: 1.22,
  coinTop: 0.011,          // each coin is a little more top end
  hopV: 4.2,
  // a slide costs energy and buys a little top end while it lasts; the bar fills
  // back up when you are straight, so drifting is something you spend rather
  // than something you simply hold
  driftSpend: 0.42,
  driftFill: 0.24,
  driftTop: 1.08,
};

export function topSpeed(k) {
  // topMul is the computer drivers' handicap, 1 for anyone at a keyboard
  let t = TUNE.top * (k.topMul || 1) * (1 + k.coins * TUNE.coinTop);
  if (k.boost > 0) t *= TUNE.boostTop;
  if (k.star > 0) t *= TUNE.starTop;
  if (k.offroad && k.star <= 0) t *= TUNE.offTop;
  if (k.drift !== 0) t *= TUNE.driftTop;      // a slide carries you
  if (k.wet) t *= 0.88;                    // water is thicker than air
  if (k.slow > 0) t *= 0.55;
  return t;
}

/* input: { gas, brake, steer, hop, } with steer in -1..1 */
export function stepKart(k, input, track, dt) {
  const top = topSpeed(k);

  if (k.spin > 0) {
    // spun out: no control, just the pirouette
    k.spin -= dt;
    k.yaw += dt * 11;
    k.speed *= Math.exp(-3.4 * dt);
    k.drift = 0; k.driftT = 0; k.slide *= 0.9;
  } else {
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    // Nothing under the wheels means nothing to push against and nothing to slow
    // you: off a ramp you keep exactly what you took off with, which is what
    // makes the jump worth taking.
    const flying = k.hop > 0.05;
    const acc = TUNE.accel * (k.offroad && k.star <= 0 ? TUNE.offAccel : 1);
    if (flying) { /* airborne: the throttle and the brake are not connected to anything */ }
    else if (gas) k.speed += acc * dt * (k.speed < 0 ? 2.2 : 1);
    else if (brake) k.speed -= TUNE.brake * dt;
    else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), TUNE.drag * dt);
    if (!gas && brake && !flying) k.speed = Math.max(k.speed, -TUNE.reverse);
    if (k.speed > top) k.speed -= (k.speed - top) * Math.min(1, dt * 4.5);

    // the hop, and the drift that follows it
    if (input.hop && k.hop <= 0.001 && k.drift === 0 && k.speed > 6 && k.driftE > 0.12) {
      k.hopV = TUNE.hopV;
      k.pendingDrift = Math.abs(input.steer) > 0.2 ? Math.sign(input.steer) : 0;
    }
    if (k.hop > 0.05 && k.pendingDrift && k.drift === 0) { k.drift = k.pendingDrift; k.driftT = 0; }
    // letting go, or running the tank dry, both end the slide and both pay out
    // whatever was charged
    const endDrift = () => {
      if (k.driftT > 1.45) k.boost = Math.max(k.boost, 1.15);
      else if (k.driftT > 0.75) k.boost = Math.max(k.boost, 0.7);
      k.drift = 0; k.driftT = 0; k.pendingDrift = 0;
    };
    if (!input.hop && k.drift !== 0) endDrift();
    if (k.drift !== 0) {
      k.driftE = Math.max(0, k.driftE - TUNE.driftSpend * dt);
      if (k.speed < 5 || k.driftE <= 0) endDrift();
      else k.driftT += dt;
    } else {
      k.driftE = Math.min(1, k.driftE + TUNE.driftFill * dt);
    }

    // steering: less lock at speed, more of it while sliding
    const grip = Math.min(1, Math.abs(k.speed) / 7);
    const lock = (k.drift !== 0 ? TUNE.driftSteer : TUNE.steer) * (1 - Math.min(0.42, Math.abs(k.speed) / top * 0.42));
    let steer = input.steer;
    // A slide holds its own line, but the wheel is still yours: hold it into the
    // corner and it tightens, hold it out and the kart comes round the other way.
    // Half and half meant the slide always won and you could only ever tighten.
    if (k.drift !== 0) steer = Math.max(-1.35, Math.min(1.35, k.drift * 0.45 + input.steer * 0.9));
    // in the air you can shift the nose, not steer
    k.yaw += steer * lock * grip * dt * (k.speed < -0.3 ? -1 : 1) * (flying ? 0.28 : 1);
    k.steerVis += (steer * 0.55 - k.steerVis) * Math.min(1, dt * 10);
    const wantSlide = k.drift !== 0 ? -k.drift * 0.42 : 0;
    k.slide += (wantSlide - k.slide) * Math.min(1, dt * 6);
    // and it rolls to the outside of the corner, drifting or not
    k.lean += ((k.drift !== 0 ? -k.drift * 0.16 : -steer * 0.05) - k.lean) * Math.min(1, dt * 8);
  }

  // the hop arc
  if (k.hopV !== 0 || k.hop > 0) {
    k.hop += k.hopV * dt;
    k.hopV -= k.airG * dt;
    if (k.hop <= 0) {
      k.hop = 0; k.hopV = 0;
      if (k.airG !== 26) { k.airG = 26; k.landed = 1; }    // back on the road
    }
  }

  if (k.boost > 0) k.boost = Math.max(0, k.boost - dt);
  if (k.star > 0) k.star = Math.max(0, k.star - dt);
  if (k.slow > 0) k.slow = Math.max(0, k.slow - dt);

  // travel: the kart moves where it points, plus the slide
  const dir = k.yaw + k.slide * 0.35;
  k.pos.x += -Math.sin(dir) * k.speed * dt;
  k.pos.z += -Math.cos(dir) * k.speed * dt;
  k.wheelSpin += k.speed * dt / 0.38;

  // the surface, and the wall
  const pr = track.project(k.pos.x, k.pos.z, k.hint);
  k.hint = pr.i;
  // over the grass but not on it: a jump is not a trip through the rough
  k.offroad = !pr.onRoad && !pr.onKerb && k.hop <= 0.05;
  // under the surface, when there is a surface to be under
  k.wet = pr.waterY !== null && (k.pos.y + k.hop + 0.7) < pr.waterY;

  // Sand on the outside of a steep bend. Arrive at it quickly and it takes the
  // car away from you; crawl into it and it just drags.
  if (pr.sand && k.hop <= 0.05 && k.star <= 0) {
    if (!k.inSand && Math.abs(k.speed) > 17) spinOut(k, false);
    k.speed *= Math.exp(-2.4 * dt);
    k.inSand = 1;
  } else k.inSand = 0;

  /* Leaving the ground the way a car does. While the road climbs it is lifting
     you at your speed times its slope, and the moment it stops climbing that
     lift is yours with nothing holding you down. So a fast run at a ramp throws
     you further than a slow one, and a gentle hill does not throw you at all. */
  if (k.hop <= 0.001 && k.spin <= 0) {
    const rise = pr.slope * k.speed;
    // A ramp lifts you several metres a second; the rolling ground lifts you
    // one or two. Set the bar between them, or a gentle hill has the kart
    // airborne the whole lap with no wheels to accelerate on.
    if (k.roadRise > 4.5 && rise < k.roadRise - 2.2) {
      k.hopV = Math.max(k.hopV, k.roadRise);
      k.airG = 18;                          // a jump hangs longer than a drift hop
    }
    k.roadRise = rise;
  }
  // the nose follows the arc
  const want = k.hop > 0.05 ? Math.atan2(k.hopV, Math.max(8, Math.abs(k.speed))) * 0.85 : 0;
  k.pitch += (want - k.pitch) * Math.min(1, dt * 7);
  k.pos.y = pr.y;
  // ease onto the camber rather than snapping to it
  k.roll += (Math.atan(pr.bank || 0) - k.roll) * Math.min(1, dt * 7);
  if (Math.abs(pr.lateral) > pr.wall) {
    const push = (Math.abs(pr.lateral) - pr.wall) * Math.sign(pr.lateral);
    k.pos.x -= pr.n.x * push;
    k.pos.z -= pr.n.z * push;
    // a barrier should scrub you along itself, not pin you to it: point the kart
    // back down the road and charge for the angle you hit it at
    const along = Math.abs(-Math.sin(k.yaw) * pr.t.x + -Math.cos(k.yaw) * pr.t.z);
    const wallYaw = Math.atan2(-pr.t.x, -pr.t.z);
    let d = wallYaw - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * 0.4;
    k.speed *= 0.58 + 0.34 * along;
    k.drift = 0; k.driftT = 0;
    k.wallHit = 1;
  }
  // progress round the lap, for the running order
  k.prog = pr.s;
  return pr;
}

/* one kart bumping another: they push apart and swap a little speed */
export function bump(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 1.9 || d < 1e-4) return false;
  const nx = dx / d, nz = dz / d;
  // twice the shove there used to be: touching wheels should cost somebody the
  // corner, not tidy them apart
  const push = (1.9 - d) * 1.0;
  a.pos.x -= nx * push; a.pos.z -= nz * push;
  b.pos.x += nx * push; b.pos.z += nz * push;
  const rel = a.speed - b.speed;
  if (rel > 0) { a.speed -= rel * 0.32; b.speed += rel * 0.24; }
  return true;
}

export function spinOut(k, hard) {
  if (k.star > 0) return false;
  k.spin = hard ? 1.5 : 1.05;
  k.speed *= 0.18;
  k.boost = 0; k.drift = 0; k.driftT = 0;
  k.coins = Math.max(0, k.coins - (hard ? 3 : 2));
  return true;
}
