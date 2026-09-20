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

/* The patch of dark a car sits in. The sun casts a real shadow, but a single
   directional light throws it off to one side, so at a glance nothing looks
   like it is touching the ground. This is the contact: a soft disc under the
   floor that shrinks and fades as the car leaves the road, which is also the
   only cue you get for how high you are in the air. Built once and shared. */
const SHADOW_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(0.55, 'rgba(0,0,0,.3)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const SHADOW_GEO = new THREE.PlaneGeometry(3.4, 4.2).rotateX(-Math.PI / 2);

import { CHASSIS, WHEELS, TRAILS, chassisOf, wheelsOf, trailOf, normalise, statsOf,
         driverHead, driverBody,
         box, cyl, ball, taper, merge, INK, STEEL, DARK } from './parts.js?v=28';
export { CHASSIS, WHEELS, TRAILS, normalise, statsOf };

/* ---- the model ----------------------------------------------------------- */
/* A kart is a body, a set of wheels, a driver and a trail, and the four are
   chosen separately. Nothing that comes out of the garage carries a colour of
   its own: every panel is painted out of the racer, so however anybody has
   built theirs, a grid of eight is still eight recognisable cars. */
export function makeKart(who, build) {
  const r = who || RACERS[0];
  const b = normalise(build);
  const spec = chassisOf(b.chassis).make(r);
  const tyre = wheelsOf(b.wheels).make(r);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  /* The car itself comes out of the garage: whichever body was chosen, painted
     out of the racer who is driving it. The driver is built separately and put
     on the seat the body asks for, so the same person fits a formula car and a
     pickup without being modelled twice. */
  const shirt = r.shirt, skin = r.skin, cap = r.cap;
  const st = spec.seat;

  // the torso, which stays with the car
  const torso = driverBody(r, st).concat([
    { g: cyl(0.1, 0.1, 0.1, 8, 'y', 0, st.y + 0.74, st.z), c: skin },
  ]);
  body.add(merge(spec.parts.concat(torso), BODY_MAT));

  /* The head and the arms move, so they are their own little groups rather than
     part of the merge. A driver who looks into the corner and turns the wheel
     with the wheel is most of what makes a kart look alive at speed. */
  const head = new THREE.Group();
  head.position.set(0, st.y + 0.8, -st.z);
  head.add(merge([{ g: ball(0.3, 0, 0.27, 0), c: skin }]
    .concat(driverHead(r)), BODY_MAT));
  body.add(head);

  const arms = new THREE.Group();
  arms.position.set(0, st.y + 0.55, -(st.z + 0.1));
  arms.add(merge([
    { g: cyl(0.09, 0.09, 0.52, 7, 'y', -0.28, -0.02, 0.2), c: shirt },
    { g: cyl(0.09, 0.09, 0.52, 7, 'y', 0.28, -0.02, 0.2), c: shirt },
    { g: ball(0.12, -0.24, -0.06, 0.42), c: 0xfff6e2 },
    { g: ball(0.12, 0.24, -0.06, 0.42), c: 0xfff6e2 },
  ], BODY_MAT));
  arms.rotation.x = -0.5 - st.lean;
  body.add(arms);

  /* Every wheel is its own merge so the set can change without the car being
     rebuilt round it, and the body sits on whatever radius came back: a set of
     knobblies lifts the whole car by the difference. */
  const wheels = [];
  const WX = spec.track, WZ = spec.wheelbase;
  for (const [sx, sz, steers] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
    const hub = new THREE.Group();
    hub.position.set(sx * WX, tyre.r, -sz * WZ);
    const m = merge(tyre.parts.map(q => ({ g: q.g.clone(), c: q.c })), TYRE_MAT);
    /* A wheel is not symmetric: the rim face, the holes and the hub nut are all
       on its outside. Built once and used four times, the two on the left ended
       up showing the game their inside faces, so the left pair is turned about
       its own axle to put its outside out. */
    if (sx < 0) m.rotation.y = Math.PI;
    hub.add(m);
    body.add(hub);
    wheels.push({ hub, spin: m, steers, y0: tyre.r });
  }
  // and the body rides at the height its wheels give it
  body.position.y = tyre.r - spec.ride;

  // the contact patch, which lives outside the body group so it stays flat on
  // the road while the car above it leans, pitches and tumbles
  const shade = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({
    map: SHADOW_TEX, transparent: true, depthWrite: false, opacity: 0.85,
  }));
  /* No renderOrder games here. A transparent mesh forced to draw before the
     opaque world is a transparent mesh the road then paints straight over,
     which is exactly what happened: the patch was there and invisible. */
  group.add(shade);

  const kart = {
    who: r, group, body, wheels, shade, head, arms,
    build: b, trail: trailOf(b.trail), exhaust: spec.exhaust || [],
    // what the parts bolted to it are worth, worked out once when it is built
    parts: statsOf(b),
    // how far the suspension is compressed, and how far it has left to go
    squat: 0, squatV: 0,
    pos: new THREE.Vector3(), yaw: 0, speed: 0,
    drift: 0,            // -1 left, 1 right, 0 none
    driftT: 0, slide: 0, hop: 0, hopV: 0,
    pitch: 0, roadRise: 0, bash: false, hitBy: 0, launched: 0, onIce: 0,
    // the tumble: how far it is tipped, and how fast that is changing
    tumbleX: 0, tumbleZ: 0, wobX: 0, wobZ: 0, spinRate: 11,
    // velocity across the wheels, from being shoved: it decays as they bite
    pushX: 0, pushZ: 0,
    // how hard you are revving on the grid, which everybody can see
    rev: 0,
    boost: 0, spin: 0, slow: 0, star: 0,
    // over nothing: how long for, and how far down
    falling: 0, fallV: 0, fallY: 0, overEdge: 0, rescue: 0,
    // a trick: whether one is running, which one, and how far through it is
    trick: 0, trickKind: 0, trickSpin: 0, trickWin: 0, hopped: 0,
    // what the parts bolted to it are worth
    parts: null,
    lap: 1, cpi: 0, prog: 0, place: 1, finished: 0,
    item: null, itemN: 0, roulette: 0,
    // what is queued behind the one in the slot, oldest first
    queue: [],
    hint: 0, offroad: false, wheelSpin: 0, steerVis: 0, lean: 0, topMul: 1, roll: 0, wet: false,
    // the vertical half of the velocity while airborne, and the slope that put
    // it there
    airG: 9.81, roadSlope: 0,
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
  k.group.rotation.z = k.roll + k.tumbleZ;
  k.group.rotation.x = k.tumbleX;
  // revving on the grid: a shake everybody can see, since rev rides along in the
  // position each browser sends
  // and the same rattle for a cattle grid, which is the point of a cattle grid
  const buzz = Math.max(k.rev > 0.02 ? k.rev : 0, k.shake || 0);
  if (buzz > 0.02) {
    const t = performance.now() * 0.001;
    k.group.position.x += Math.sin(t * 37) * 0.11 * buzz;
    k.group.position.z += Math.cos(t * 31) * 0.07 * buzz;
    k.group.position.y += Math.sin(t * 53) * 0.05 * (k.shake || 0);
  }
  if (k.shake > 0) k.shake = Math.max(0, k.shake - 0.06);
  /* The contact patch stays on the road and shrinks with height, which is what
     tells you how far up you are: the car itself gives you nothing to judge it
     against once the horizon has gone. */
  if (k.shade) {
    const up = Math.max(0, k.hop);
    k.shade.position.set(0, 0.03 - k.hop, 0);
    k.shade.rotation.y = -k.group.rotation.y;             // square to the world
    const f = 1 / (1 + up * 0.5);
    k.shade.scale.set(f, 1, f);
    k.shade.material.opacity = 0.85 * f * f;
    k.shade.visible = up < 9;
  }
  /* The trick. Three of them, cycled so the same jump twice does not look the
     same twice: a barrel roll, a backflip and a twist. They are drawn on the
     body rather than on the whole car so the contact patch below stays flat. */
  if (k.trick) {
    const a = k.trickSpin;
    if (k.trickKind === 0) k.body.rotation.z = k.lean + a;
    else if (k.trickKind === 1) k.body.rotation.x = -k.speed * 0.0012 + k.pitch - a;
    else { k.body.rotation.z = k.lean + a * 0.6; k.body.rotation.x = -a * 0.5; }
  } else {
    k.body.rotation.z = k.lean;
  }
  // nose up on the way up, nose down on the way down
  k.body.rotation.x = -k.speed * 0.0012 + k.pitch;
  void 0;
  /* The driver. Head turns into the corner and the shoulders follow it a beat
     later; the arms turn with the wheel. It is a few radians of nothing and it
     is most of what stops a kart at speed looking like a pushed brick. */
  if (k.head) {
    const into = k.steerVis * 1.5 + k.slide * 0.5;
    k.head.rotation.y = Math.max(-0.7, Math.min(0.7, into));
    k.head.rotation.z = -into * 0.22 - k.lean * 0.5;
    // and it ducks a little under hard acceleration, and lifts on the brakes
    k.head.position.z = -(k.who ? 0 : 0) + Math.min(0.06, Math.max(-0.06, -k.speed * 0.0016));
  }
  if (k.arms) k.arms.rotation.y = k.steerVis * 0.85;

  /* The suspension. Each wheel is pushed up into the body by how hard the car
     is being asked to do something: braking loads the front, power loads the
     back, and a corner loads the outside. Landing squashes all four. */
  for (const w of k.wheels) {
    w.hub.rotation.y = w.steers ? k.steerVis : 0;
    w.spin.rotation.x = k.wheelSpin;
    const front = w.hub.position.z > 0 ? -1 : 1;    // +z is the tail here
    const side = Math.sign(w.hub.position.x);
    const load = front * (k.pitch * 0.9) + side * k.lean * 0.6 + k.squat;
    w.hub.position.y = w.y0 + Math.max(-0.1, Math.min(0.12, load * 0.5));
  }
  const s = 1 + Math.min(0.14, k.boost * 0.5);
  k.group.scale.set(1 / (1 + (s - 1) * 0.4), 1, s);
}

/* ---- how it drives ------------------------------------------------------- */
export const TUNE = {
  accel: 15,
  top: 33.75,              // metres a second on tarmac, before boosts
  reverse: 9,
  brake: 26,
  drag: 5,
  steer: 1.9,              // radians a second at speed
  driftSteer: 2.6,
  offTop: 0.48,            // how much of your speed the grass leaves you
  offAccel: 0.45,
  boostTop: 1.45,
  starTop: 1.22,
  // A hop off the suspension, in metres a second. Everything that leaves the
  // ground from here on is a projectile under G, so this is a launch speed and
  // not a feel knob: 2.1 up and back down under gravity is about four tenths of
  // a second, which is the flick a drift wants.
  hopV: 2.1,
  G: 9.81,
};

/* What the place you are racing in does to a kart. Every circuit sets its own,
   and a kart carries the current one on itself so topSpeed() can be asked about
   a kart without also being handed the track. */
export const PLAIN = {
  grip: 1, slide: 0, top: 1, accel: 1, offTop: TUNE.offTop,
  driftCharge: 1, boost: 1, hop: 1,
};

/* The three mini turbo tiers, and what each is worth.

   Mario Kart runs them as blue, orange and purple: a short kick, a useful one,
   and one you plan a corner around. MT_AT is how much charge each needs, in
   seconds of holding a wide slide, and MT is how long the boost it pays lasts.
   A shallow drift charges at less than half the rate, which is the whole of
   what makes holding a wider line through a corner worth doing. */
export const MT_AT = [0.62, 1.35, 2.3];
const MT = [0.55, 1.05, 1.9];
export function driftTier(k) {
  const c = k.driftT || 0;
  return c >= MT_AT[2] ? 3 : c >= MT_AT[1] ? 2 : c >= MT_AT[0] ? 1 : 0;
}

export function topSpeed(k) {
  const R = k.rules || PLAIN;
  const P = k.parts;
  // topMul is the computer drivers' handicap, 1 for anyone at a keyboard
  let t = TUNE.top * R.top * (k.topMul || 1) * (P ? P.top : 1);
  if (k.boost > 0) t *= TUNE.boostTop;
  if (k.star > 0) t *= TUNE.starTop;
  // and knobblies hardly notice the rough, which is what they are for
  if (k.offroad && k.star <= 0) t *= Math.min(0.95, R.offTop * (P ? P.rough : 1));
  if (k.slow > 0) t *= 0.55;
  return t;
}

/* input: { gas, brake, steer, hop, } with steer in -1..1 */
export function stepKart(k, input, track, dt) {
  // the rules of this place, picked up from the circuit the kart is on
  k.rules = (track && track.rules) || PLAIN;
  const R = k.rules;
  const top = topSpeed(k);

  if (k.spin > 0) {
    // spun out: no control, just the tumble it was given
    k.spin -= dt;
    k.yaw += dt * (k.spinRate || 11);
    k.tumbleX += k.wobX * dt;
    k.tumbleZ += k.wobZ * dt;
    const settle = Math.exp(-2.1 * dt);
    k.wobX *= settle; k.wobZ *= settle;
    k.speed *= Math.exp(-3.4 * dt);
    k.drift = 0; k.driftT = 0; k.slide *= 0.9;
  } else {
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    // Nothing under the wheels means nothing to push against and nothing to slow
    // you: off a ramp you keep exactly what you took off with, which is what
    // makes the jump worth taking.
    const flying = k.hop > 0.05;
    k.bash = !!input.hop;          // leaning on it as you make contact
    const acc = TUNE.accel * R.accel * (k.parts ? k.parts.accel : 1)
              * (k.offroad && k.star <= 0 ? TUNE.offAccel : 1);
    if (flying) { /* airborne: the throttle and the brake are not connected to anything */ }
    else if (gas) k.speed += acc * dt * (k.speed < 0 ? 2.2 : 1);
    else if (brake) k.speed -= TUNE.brake * dt;
    else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), TUNE.drag * dt);
    if (!gas && brake && !flying) k.speed = Math.max(k.speed, -TUNE.reverse);
    if (k.speed > top) k.speed -= (k.speed - top) * Math.min(1, dt * 4.5);

    /* ---- the hop, and the drift that follows it --------------------------
       Built the way Mario Kart 8 builds it.

       You hop, the back steps out, and the drift holds until you let the
       button go. Turning costs a little speed, as turning does, but the drift
       itself costs nothing: a kart that dropped speed the moment you committed
       and then wound back up is a kart that punishes you for using the one
       mechanic the whole game is about.

       The charge is a counter rather than a clock, and it fills faster the
       wider you are holding the stick: five a frame at full lock against two a
       frame at a shallow angle, which is what makes a deliberately wide slide
       worth taking and what "soft drifting" means. Three tiers come out of it,
       blue, orange and purple, each worth a longer boost than the last. */
    if (input.hop && k.hop <= 0.001 && k.drift === 0 && k.speed > 6 && !k.launched) {
      k.hopV = TUNE.hopV * R.hop * (k.parts ? k.parts.jump : 1);
      k.pendingDrift = Math.abs(input.steer) > 0.2 ? Math.sign(input.steer) : 0;
      k.hopped = 1;
    }
    if (k.hop > 0.02 && k.pendingDrift && k.drift === 0) { k.drift = k.pendingDrift; k.driftT = 0; }
    if (k.drift !== 0) {
      if (k.speed < 5) { k.drift = 0; k.driftT = 0; }
      else {
        // how far into the corner you are holding it, which is the whole of the
        // difference between a tidy drift and a quick one
        const wide = Math.abs(input.steer) > 0.55 || Math.sign(input.steer) === k.drift;
        k.driftT += dt * (wide ? 1 : 0.42) * R.driftCharge * (k.parts ? k.parts.charge : 1);
      }
    }
    if (!input.hop && k.drift !== 0) {
      // let go and whatever tier was reached comes out
      const tier = driftTier(k);
      if (tier) k.boost = Math.max(k.boost, MT[tier - 1] * R.boost * (k.parts ? k.parts.boost : 1));
      k.drift = 0; k.driftT = 0; k.pendingDrift = 0;
    }

    // steering: less lock at speed, more of it while sliding
    const grip = Math.min(1, Math.abs(k.speed) / 7);
    const lock = (k.drift !== 0 ? TUNE.driftSteer : TUNE.steer) * (1 - Math.min(0.42, Math.abs(k.speed) / top * 0.42));
    let steer = input.steer;
    if (k.drift !== 0) steer = k.drift * 0.55 + input.steer * 0.55;    // you can tighten or open the slide
    // in the air you can shift the nose, not steer
    // ice: the wheels turn, the kart does not
    k.yaw += steer * lock * grip * R.grip * (k.parts ? k.parts.grip : 1)
           * dt * (k.speed < -0.3 ? -1 : 1) * (flying ? 0.28 : 1) * (k.onIce ? 0.34 : 1);
    k.steerVis += (steer * 0.55 - k.steerVis) * Math.min(1, dt * 10);
    // and what slide there is hangs on longer, because nothing is scrubbing it off
    /* What the back end does when you are not asking it to. On a loose or icy
       circuit a slide does not simply stop when the drift does: it hangs on and
       has to be caught, which is the whole character of the place. */
    const wantSlide = k.drift !== 0 ? -k.drift * (0.3 + Math.abs(input.steer) * 0.22)
                    : (k.onIce ? k.slide * 0.9 : k.slide * R.slide);
    k.slide += (wantSlide - k.slide) * Math.min(1, dt * 6);
    // and it rolls to the outside of the corner, drifting or not
    k.lean += ((k.drift !== 0 ? -k.drift * 0.16 : -steer * 0.05) - k.lean) * Math.min(1, dt * 8);
  }

  // Back onto its wheels once the spin is done. It always lands face up: a kart
  // on its roof is one nobody can do anything with.
  if (k.spin <= 0 && (k.tumbleX || k.tumbleZ)) {
    const up = Math.max(0, 1 - dt * 3.6);
    k.tumbleX *= up; k.tumbleZ *= up;
    if (Math.abs(k.tumbleX) < 0.008) k.tumbleX = 0;
    if (Math.abs(k.tumbleZ) < 0.008) k.tumbleZ = 0;
    k.wobX = 0; k.wobZ = 0;
  }

  // the hop arc
  if (k.hopV !== 0 || k.hop > 0) {
    // y += vy*dt, vy -= G*dt. The whole of it.
    k.hop += k.hopV * dt;
    k.hopV -= TUNE.G * dt;
    if (k.hop <= 0) {
      // the springs take the landing: a kick into the dampers that settles out
      if (k.hopV < -2) k.squatV = Math.max(-9, k.hopV * 0.5);
      if (k.hopV < -4) k.landed = 1;        // a real landing, not the end of a flick
      /* A trick pulled in the air pays out here, the way it does in Mario Kart:
         land it and you get a boost worth about a blue mini turbo. It is also
         the only thing that ends the trick, so a car that never pressed the
         button simply lands. */
      if (k.trick) {
        k.boost = Math.max(k.boost, 0.62 * (k.parts ? k.parts.boost : 1));
        k.trick = 0; k.trickSpin = 0;
      }
      k.trickWin = 0;
      k.hop = 0; k.hopV = 0; k.launched = 0;
      // Forget what the road was doing when you left it. Holding on to it meant
      // the first frame back on the ground compared a stale climb against the
      // flat you had just landed on, read that as a crest, and threw the kart
      // straight back into the air: a jump, then a bounce, then a bigger bounce.
      k.roadRise = 0;
    }
  }

  /* A trick. Press the same button in the window after leaving a ramp and the
     car throws a roll; it costs nothing to try and pays a boost on landing, so
     the answer is always to try, which is the point of it. */
  if (k.trickWin > 0) {
    k.trickWin -= dt;
    if (input.hop && !k.trick && k.hop > 0.2) { k.trick = 1; k.trickKind = (k.trickKind + 1) % 3; }
  }
  if (k.trick) k.trickSpin += dt * 7.4;

  // a spring and a damper on the body, which is all a suspension has to be
  k.squatV += (-k.squat * 46 - k.squatV * 9) * dt;
  k.squat += k.squatV * dt;
  if (Math.abs(k.squat) < 0.001 && Math.abs(k.squatV) < 0.01) { k.squat = 0; k.squatV = 0; }

  if (k.boost > 0) k.boost = Math.max(0, k.boost - dt);
  if (k.star > 0) k.star = Math.max(0, k.star - dt);
  if (k.slow > 0) k.slow = Math.max(0, k.slow - dt);

  // travel: the kart moves where it points, plus the slide
  const dir = k.yaw + k.slide * 0.35;
  k.pos.x += -Math.sin(dir) * k.speed * dt;
  k.pos.z += -Math.cos(dir) * k.speed * dt;
  // and whatever a shove left you carrying sideways, until the tyres take it out
  if (k.pushX || k.pushZ) {
    k.pos.x += k.pushX * dt;
    k.pos.z += k.pushZ * dt;
    const bite = Math.exp(-4.5 * dt);
    k.pushX *= bite; k.pushZ *= bite;
    if (Math.hypot(k.pushX, k.pushZ) < 0.05) { k.pushX = 0; k.pushZ = 0; }
  }
  k.wheelSpin += k.speed * dt / 0.38;

  // the surface, and the wall
  const pr = track.project(k.pos.x, k.pos.z, k.hint);
  k.hint = pr.i;
  /* Ice takes the grip away rather than the speed: the kart keeps rolling but
     the tyres stop answering, so a corner taken on a patch runs wide. Lava is
     the opposite - it does not slow you, it throws you. */
  /* A strip of something that is not tarmac down one side of the road. Sand
     holds you, ice takes the grip away, ash does a bit of both. It is checked
     before the ice patches so a patch can still override it. */
  k.onIce = 0;
  if (pr.strip && k.hop <= 0.05 && k.star <= 0) {
    if (pr.strip === 'ice') k.onIce = 1;
    else {
      k.speed *= Math.pow(pr.strip === 'sand' ? 0.55 : 0.72, dt);
      if (pr.strip === 'ash') k.onIce = 1;
    }
  }
  if (track.ice && k.hop <= 0.05) {
    for (const p of track.ice) {
      if (Math.hypot(k.pos.x - p.x, k.pos.z - p.z) > p.r) continue;
      k.onIce = 1;
      break;
    }
  }
  if (track.lava && k.hop <= 0.05 && k.star <= 0 && k.spin <= 0) {
    for (const p of track.lava) {
      const dx = k.pos.x - p.x, dz = k.pos.z - p.z;
      if (Math.hypot(dx, dz) > p.r) continue;
      spinOut(k, true, { x: -dx, z: -dz, speed: Math.max(18, Math.abs(k.speed)) });
      k.hopV = Math.max(k.hopV, 5.5);
      break;
    }
  }

  /* The island up the middle of the split, with the house standing on it. It is
     the fence turned inward: outside it you are in one lane or the other, inside
     it you are not on the road at all. Resolving it the same way the fence is
     resolved means clipping the kerb of it costs a scrape and driving square
     into it costs the corner, which is what the two should feel like.

     Doing it by lateral distance rather than by a circle round the house is also
     what makes the split a split: the whole length of the island stops you, not
     just the building, so the two lanes are genuinely separated. */
  if (pr.island > 0 && Math.abs(pr.lateral) < pr.island) {
    const side = pr.lateral >= 0 ? 1 : -1;
    const push = pr.island - Math.abs(pr.lateral);
    k.pos.x += pr.n.x * side * push;
    k.pos.z += pr.n.z * side * push;
    const nx = -pr.n.x * side, nz = -pr.n.z * side;   // into the kerb
    const v = velOf(k);
    const vn = v.x * nx + v.z * nz;
    if (vn > 0) {
      const tx = v.x - vn * nx, tz = v.z - vn * nz;
      v.x = tx * 0.86 - nx * vn * 0.22;
      v.z = tz * 0.86 - nz * vn * 0.22;
      setVel(k, v);
    }
    if (vn > 17) spinOut(k, vn > 27, { x: -nx, z: -nz, speed: vn });
    const lane = Math.atan2(-pr.t.x, -pr.t.z);
    let d = lane - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * 0.35;
    k.drift = 0; k.driftT = 0;
    k.wallHit = 1;
  }

  // over the grass but not on it: a jump is not a trip through the rough
  k.offroad = !pr.onRoad && !pr.onKerb && k.hop <= 0.05;
  // under the surface, when there is a surface to be under
  k.wet = pr.waterY !== null && (k.pos.y + k.hop + 0.7) < pr.waterY;

  /* Leaving the ground the way a car does. While the road climbs it is lifting
     you at your speed times its slope, and the moment it stops climbing that
     lift is yours with nothing holding you down. So a fast run at a ramp throws
     you further than a slow one, and a gentle hill does not throw you at all. */
  // A drift flick only lifts the kart a couple of hand widths, so it must not
  // be able to block a ramp: pressing the button on the way up should add to
  // the launch, not cancel it.
  /* And only from the road. Half off the tarmac on a banked corner the blend
     down to the field is steep, and reading that as a ramp threw the car
     skyward for putting two wheels on the kerb, which is the single most
     annoying thing a kart game can do to you. */
  if (k.hop <= 0.35 && k.spin <= 0 && !k.launched && pr.onRoad && !pr.onKerb) {
    /* Leaving a ramp is a projectile problem and nothing else. The road was
       climbing at an angle th = atan(slope); a kart travelling at v along it has
       a vertical component v*sin(th) and a horizontal one v*cos(th). Take the
       first as the launch speed, leave the second as the road speed, and from
       there it is just y" = -G: it rises for v*sin(th)/G seconds, reaches
       v^2*sin^2(th)/2G, and comes down as far away as it went up.

       The bar is where it is because a ramp lifts you several metres a second and
       the rolling ground lifts you one or two, and a gentle hill that launched
       the kart would leave it airborne all lap with no wheels to accelerate on. */
    /* The bar is low, and the second half of the test is what keeps a rolling
       hill from launching anybody: slope is read off the sample the kart is on,
       so it steps rather than glides, and only a real crest drops it in a single
       frame. That is why coming out of the water, or off any ramp back onto the
       flat, catches a little air, while the long rise and fall of the ground
       catches none. */
    /* Leaving the ground is about the road, not about you.

       This used to test the climb rate times your speed, which meant driving
       over a booster threw the car into the air: the speed jumped, the product
       jumped with it, and the next frame read the drop back as the lip of a
       ramp. It is the slope alone now, so a crest is a crest whatever speed you
       arrive at it. */
    if (k.roadSlope > 0.075 && pr.slope < k.roadSlope * 0.5) {
      k.launched = 1;          // and not again until the wheels are back down
      const th = Math.atan(k.roadSlope);
      let up = Math.abs(k.speed) * Math.sin(th);
      // pulling up on it as you leave adds a little, the way a hop does
      // pulling up on it is worth something, not worth everything: a fifth
      // more and a little off the bottom, so a hop cannot dwarf the ramp
      // pulling up on it is worth a third more, and nothing on its own: a hop
      // that adds a fixed amount dwarfs a gentle ramp and does nothing to a
      // steep one, which is backwards
      if (input.hop) up *= 1.35;
      /* And a ceiling on it. Mario Kart throws you a car length or two into the
         air off a ramp, never over the scenery: anything past about four metres
         is the surface having said something it did not mean. */
      k.hopV = Math.max(k.hopV, Math.min(9, up * (k.parts ? k.parts.jump : 1)));
      k.speed *= Math.cos(th);              // that lift came out of your road speed
      k.trickWin = 0.28;                    // the window to pull a trick in
    }
    // remembered smoothed, so one noisy frame cannot look like a crest
    k.roadSlope = k.roadSlope + (pr.slope - k.roadSlope) * Math.min(1, dt * 14);
  }
  /* A gap has to be cleared, not attempted. The lip before one says how far
     there is to go and the car works out how hard it has to leave from its
     own speed, so arriving slowly means a slow, high jump rather than a fall:
     the ramp does the throwing, which is what a ramp is for. */
  if (pr.launch && !k.falling && k.hopV >= -0.1) {
    const v = Math.max(9, Math.abs(k.speed));
    const need = (pr.launch * TUNE.G) / (2 * v) * 1.35;
    /* Topping up rather than replacing, and allowed to do so even if the slope
       already launched the car: the lip flattens before the edge, so the slope
       launch fires early and weakly, and a weak launch off a kicker is a car in
       the hole. It also sits outside the check that a launch only happens on
       the road, because the last thing before a gap is the edge of the road. */
    if (k.hopV < need) { k.hopV = need; k.launched = 1; k.trickWin = 0.3; }
  }

  // the nose follows the arc
  const want = k.hop > 0.05 ? Math.atan2(k.hopV, Math.max(8, Math.abs(k.speed))) * 0.85 : 0;
  k.pitch += (want - k.pitch) * Math.min(1, dt * 7);
  /* ---- over nothing -----------------------------------------------------
     A gap in the road, or over the edge of a causeway, and there is no surface
     under the car at all. It stops being driven and starts being a falling
     object; the game notices and sends something to fish it out.

     The test is for the road being missing rather than for the car being low,
     because project() still reports a height over a gap: the samples are there,
     only the tarmac is not. Left to itself the car would drive straight across
     the hole on a floor that is not drawn. */
  /* Clearly off, not brushing it. Half a metre past the edge is a wheel over
     the line; two and a half is a car that has left. */
  const nothing = pr.gap || (pr.causeway > 0.4 && Math.abs(pr.lateral) > pr.wall + 2.4);
  /* Airborne counts as airborne even on the frame the launch happens. hop is
     integrated at the top of the next step, so on the frame a ramp fires it is
     still zero while hopV is already several metres a second: testing hop alone
     dropped every car straight down the hole it had just been thrown over. */
  const flying = k.hop > 0.05 || k.hopV > 0.5;
  if (!k.falling && nothing && !flying && k.spin <= 0) {
    k.falling = 1;
    k.fallV = Math.min(0, k.hopV);
    k.fallY = k.pos.y;
    k.drift = 0; k.driftT = 0;
  }
  if (k.falling) {
    // a projectile again, and nothing under it to land on
    k.fallV -= TUNE.G * dt;
    k.fallY += k.fallV * dt;
    k.pos.y = k.fallY;
    k.speed *= Math.exp(-0.6 * dt);
    k.falling += dt;
    k.hop = 0; k.hopV = 0; k.launched = 0; k.roadRise = 0;
    k.prog = pr.s;
    return pr;
  }
  k.pos.y = pr.y;
  // ease onto the camber rather than snapping to it
  k.roll += (Math.atan(pr.bank || 0) - k.roll) * Math.min(1, dt * 7);
  /* A causeway has no fence on it. Everywhere else the edge of the tarmac is a
     barrier; here it is an edge, and going over it is the point. */
  if (Math.abs(pr.lateral) > pr.wall && pr.causeway > 0.4) {
    k.overEdge = 1;
  } else if (Math.abs(pr.lateral) > pr.wall) {
    /* A barrier is a collision like any other, so it is resolved like one. The
       velocity is split along the wall and into it; the part into it is reversed
       and mostly absorbed, the part along it is kept bar a scrape; and what comes
       out is turned back into a speed along the kart's own heading plus a shove
       across it, exactly as a kart to kart hit is.

       Clipping a wall at a shallow angle therefore costs you very little and a
       head on one costs you nearly everything, which is what it should do, and
       which the old flat multiply could not tell apart. */
    const push = (Math.abs(pr.lateral) - pr.wall) * Math.sign(pr.lateral);
    k.pos.x -= pr.n.x * push;
    k.pos.z -= pr.n.z * push;

    const into = pr.lateral > 0 ? 1 : -1;            // outward, along the normal
    const nx = pr.n.x * into, nz = pr.n.z * into;
    const v = velOf(k);
    const vn = v.x * nx + v.z * nz;                  // into the wall
    if (vn > 0) {
      const WALL_BOUNCE = 0.22, WALL_SCRAPE = 0.86;
      const tx = v.x - vn * nx, tz = v.z - vn * nz;  // along it
      v.x = tx * WALL_SCRAPE - nx * vn * WALL_BOUNCE;
      v.z = tz * WALL_SCRAPE - nz * vn * WALL_BOUNCE;
      setVel(k, v);
    }
    // a heavy one throws you, and it throws you the way you hit it
    if (vn > 17) spinOut(k, vn > 27, { x: -nx, z: -nz, speed: vn });
    // and the nose comes back round to the road, because a kart is not a puck
    const wallYaw = Math.atan2(-pr.t.x, -pr.t.z);
    let d = wallYaw - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * 0.35;
    k.drift = 0; k.driftT = 0;
    k.wallHit = 1;
  }
  // progress round the lap, for the running order
  k.prog = pr.s;
  return pr;
}

/* one kart bumping another: they push apart and swap a little speed */
/* Two karts touching.

   Treated as a collision between two bodies rather than a rule about who slows
   down. Each kart's velocity is a vector; the contact normal is the line between
   them; the impulse along that normal is the standard

       j = -(1 + e) * (va - vb).n / (1/ma + 1/mb)

   with e the restitution, which for a kart is low - they thud rather than
   bounce. Apply j/m to each and you have their new velocities.

   A car cannot simply move in whatever direction it is pushed, though: its
   wheels only roll one way. So each kart's new velocity is split into the part
   along its own heading, which becomes its speed, and the part across it, which
   becomes a sideways shove that decays as the tyres bite. That is why a rear
   ender passes speed forward and a side swipe puts somebody off their line.

   Leaning on the hop button as you make contact is worth mass: a basher counts
   as three karts to your one, and the mass ratio does the rest by itself. */
const RESTITUTION = 0.25;

function heading(k) {
  const d = k.yaw + k.slide * 0.35;
  return { x: -Math.sin(d), z: -Math.cos(d) };
}
function velOf(k) {
  const h = heading(k);
  return { x: h.x * k.speed + k.pushX, z: h.z * k.speed + k.pushZ };
}
function setVel(k, v) {
  const h = heading(k);
  k.speed = v.x * h.x + v.z * h.z;
  k.pushX = v.x - h.x * k.speed;
  k.pushZ = v.z - h.z * k.speed;
}

export function bump(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 1.9 || d < 1e-4) return false;
  const nx = dx / d, nz = dz / d;
  /* Mass. What the car is built out of decides how much of a shunt it takes
     and how much it hands out: a hauler on knobblies is nearly twice the kart a
     formula car on wires is, and the impulse below does the rest by itself.
     Leaning on the hop button as you make contact is worth three of you. */
  const ma = (a.bash ? 3 : 1) * (a.parts ? a.parts.weight : 1);
  const mb = (b.bash ? 3 : 1) * (b.parts ? b.parts.weight : 1);

  // out of each other first, the heavier one giving less ground
  const over = 1.9 - d;
  a.pos.x -= nx * over * (mb / (ma + mb)); a.pos.z -= nz * over * (mb / (ma + mb));
  b.pos.x += nx * over * (ma / (ma + mb)); b.pos.z += nz * over * (ma / (ma + mb));

  const av = velOf(a), bv = velOf(b);
  const closing = (av.x - bv.x) * nx + (av.z - bv.z) * nz;
  if (closing <= 0) return true;                 // already coming apart
  const j = -(1 + RESTITUTION) * closing / (1 / ma + 1 / mb);
  av.x += (j / ma) * nx; av.z += (j / ma) * nz;
  bv.x -= (j / mb) * nx; bv.z -= (j / mb) * nz;
  setVel(a, av); setVel(b, bv);
  a.hitBy = b.bash ? 1 : a.hitBy; b.hitBy = a.bash ? 1 : b.hitBy;
  return true;
}

/* Losing it.

   Which way a kart tumbles comes out of where it was hit. The direction of the
   blow is resolved against the kart's own nose: how much of it came from the
   side and how much from front or back. A tap on the right spins you left and
   rolls you the same way; a shunt from behind lifts the nose; a head on hit
   drops it. The harder the hit, the faster all three.

   The one liberty taken with the physics is the landing: however it tumbles, it
   comes back onto its wheels rather than finishing on its roof, because a kart
   lying upside down in the middle of a race is a kart nobody can do anything
   with. `hit` is { x, z, speed } - where the blow came from, and how hard. */
export function spinOut(k, hard, hit) {
  if (k.star > 0) return false;
  k.spin = hard ? 1.5 : 1.05;
  k.speed *= 0.18;
  k.boost = 0; k.drift = 0; k.driftT = 0;

  const h = heading(k);
  let side = 0, front = -1, mag = 1;
  if (hit && (hit.x || hit.z)) {
    const d = Math.hypot(hit.x, hit.z) || 1;
    const ux = hit.x / d, uz = hit.z / d;
    front = ux * h.x + uz * h.z;              // +1 from behind, -1 head on
    side = ux * -h.z + uz * h.x;              // left or right of the nose
    mag = Math.min(2.4, 0.55 + Math.abs(hit.speed || 12) / 15);
  }
  k.spinRate = (hard ? 11 : 8.2) * (Math.abs(side) > 0.12 ? -Math.sign(side) : 1) * mag;
  k.wobZ = -side * 5.8 * mag;                 // tapped on the right, rolls to the left
  // front is +1 when the blow came from ahead, so the sign flips: hit from
  // behind and the nose comes up, hit head on and it goes down
  k.wobX = -front * 3.8 * mag;
  if (hard) { k.wobZ *= 1.35; k.wobX *= 1.35; }
  return true;
}
