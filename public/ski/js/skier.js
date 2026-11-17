// The skier's physics. One body on the snow with its skis' direction (heading), an edge angle and a stance, and
// four states:
//   ground  carving (the ski's sidecut turns it: radius = sidecut x cos(edge)), skidding (a set edge holds what a
//           carve asks for, a sliding one only the snow's sliding friction, so a skid scrubs speed gradually),
//           braking (the skis swing across the way you were going as far as the brake is held, then back round
//           when it is let go), skating and poling on the flat, tucking, buttering on the nose or tail, popping
//   air     ballistic flight of the centre of mass with drag; spin, flip and roll about the body's own axes built
//           up by holding a key towards a top rate (a takeoff wound up while crouched starts the rotation), settling
//           when let go; grabs and their variations; shifties; landing judged on how the skis meet the snow, with
//           no help turning the body to it (the rider keeps facing where they land and goes the way the skis point); faces
//           too steep to stand on (a kicker's sides, the back of a lip) are bounced off, not ridden
//   rail    on a rail or box where the skis actually come down onto it, nothing pulling them on (R, round 12): a slippery
//           top, the skis keep the angle and spin they came on with, the speed along and across it carries on, the
//           weight kept over the top or shifted off a side (A / D), off the side once the skis no longer cover it
//   crash   tumbling to a stop, then back to a safe spot a few seconds earlier
// Frames: world +z downhill, +y up. The body frame: +Z the skis' forward, +Y up, +X the skier's left.
import * as THREE from 'three';
import { height, normal, normalBehind, surface, baseLine } from './terrain.js?v=31';
import { clamp, smoothstep } from './noise.js?v=31';

const G = 9.81, UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _n2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const COM = 0.92;            // feet to centre of mass, standing
const CRASH_FALL = 9;        // in a crash on the snow, how hard the body topples onto it: x cos of its tilt off the snow (rad/s^2)
// top rotation rates (rad/s) and how fast a held key builds them: a big jump's 1080 is about 1.1 turns a second
// Spin and flip held together make a cork: the axis is set at the lip, tipped 55 degrees from the vertical towards the
// flip (whatever the lean the kicker gave), so the rider goes head below feet once a turn, at about 1.15 turns a
// second (two turns off a big air), more with the fast spin.
// (settle: how fast a rotation the keys added dies away once let go; restSpin: how fast the spin the takeoff gave does,
// with no spin key held. There is no landing help, so letting go has to stop a spin about where it is: 2026-11-03)
// (roll, rollAcc: G and H (Q and E in the other schemes) quicker and faster, 2026-11-08, for "G and H more sensitive": 5.0 and 7)
export const AIR = { spin: 7.2, fastSpin: 9.6, flip: 5.2, roll: 7.0, spinAcc: 11, flipAcc: 7, rollAcc: 16, reverse: 1.35, settleSpin: 5, settleFlip: 3.5, settleRoll: 5,
  restSpin: 1.5, cork: 7.3, corkTilt: 0.96, fastK: 1.3 };
/* What you ride (skier.kind): the numbers that differ between skis and a board, read each step as this.K (B tunes the
   board's). On a board skier.q is still the board's frame (its long axis along +Z, as the skis'), so tracks, rails and
   landings work the same; the body standing sideways on it is the pose's business.
     turn       the steady turn a held key gives (rad/s), the same at any speed
     tap        the least one press turns the skis (rad), however short the press
     build      how long a held key takes to reach the steady turn (s)
     sidecut    the carve's radius (m): how far over the edge leans for a turn at a speed
     edgeMax    how far over the edge rolls at most (rad)
     grip       x the edges' hold across the skis
     pop        x the pop
     butter     how fast a butter pivots (rad/s)
     skate      x the skate and pole push on the flat (a board pushes with one foot)
     tracks     how many tracks it leaves, trackW how wide each one is (m), for snow.js
     reachAlong half the length under the feet, reachAcross half the width, for meeting a rail (m)
     mu         x the sliding friction along the run (optional, 1); cda the air drag's area standing tall (0.55)
     release    how long a turn takes to die away when the key is let go (s; 0 or none: it stops at once)
     footBrake  braking drags the feet (m/s2 at full) instead of swinging the skis across (the sled) */
export const KIND = {
  ski: { turn: 1.0, tap: 0.055, build: 0.06, sidecut: 15.5, edgeMax: 1.05, grip: 1, pop: 1, butter: 4.2, skate: 1, tracks: 2, trackW: 0.1, reachAlong: 0.72, reachAcross: 0.16 },
  /* the sled, ridden lying on it head first: steered by leaning, so a turn builds and dies away slowly and is slower
     than on skis; a small hop (a pull on the front, a push off the snow); wooden runners drag more on the snow but a body
     lying flat has half the air drag (2026-11-05) */
  /* (X, 2026-11-05: the butter key with a turn key spins the sled flat on the snow, a bodyboarder's spinner: 7.6 rad/s,
     a 360 in under a second, reached in a quarter of one (butterSlew); flatSpin: let go, it carries on round to face
     the way it slides, forwards or backwards, keeps sliding while it turns, and is scored as a spin, X) */
  sled: { com: 0.34, footBrake: 5.2, turn: 0.72, tap: 0.035, build: 0.3, release: 0.25, sidecut: 14, edgeMax: 0.45, grip: 0.82, pop: 0.6, butter: 7.6, butterSlew: 32, flatSpin: true, skate: 0.45, tracks: 2, trackW: 0.035, reachAlong: 0.5, reachAcross: 0.22, mu: 1.3, cda: 0.3 },
  // the snowbike: sat on it, the bars steering a front ski, a longer wheelbase than a scooter (a little slower to turn),
  // heavier to pop, sat upright (more air drag), steel-edged skis that hold well
  bike: { turn: 0.92, tap: 0.05, build: 0.09, sidecut: 11, edgeMax: 0.75, grip: 1.08, pop: 0.88, butter: 2.5, skate: 0.7, tracks: 2, trackW: 0.16, reachAlong: 0.55, reachAcross: 0.1, mu: 1, cda: 0.62 },
  // the snow scooter: stood on the deck, the bars steering a short front board; quick to turn and light to pop
  scoot: { turn: 1.1, tap: 0.06, build: 0.06, sidecut: 8, edgeMax: 0.8, grip: 1.0, pop: 1.08, butter: 3.0, skate: 0.9, tracks: 2, trackW: 0.2, reachAlong: 0.45, reachAcross: 0.13, mu: 1, cda: 0.52 },
  board: { turn: 1.0, tap: 0.055, build: 0.07, sidecut: 7.8, edgeMax: 0.95, grip: 0.95, pop: 1.05, butter: 3.6, skate: 0.6, tracks: 1, trackW: 0.27, reachAlong: 0.76, reachAcross: 0.14 },
};
/* (X) the extra rides' timed tricks, a part of the vehicle turned all the way round (a tailwhip, a bar spin, a briflip):
   RIDE_ACTS[kind](grabKey) gives { id, T (seconds a round), loop (false: held, it does not go round again) } or null;
   scoot.js registers the scooter's and the snowbike's. A key starts one; it goes round in T and again while the key is
   still held at the end of a round (a double whip); each one done is an 'act' event { id, n, at } for tricks.js, and
   landing with a part between a sixth and five sixths of the way round is a crash (closer than that, sketchy). The
   skier keeps act (the trick's id or null), actT (seconds into this round), actDur and actN (rounds done) for the pose. */
export const RIDE_ACTS = {};
/* (P, 2026-11-08) every ride's push on the forward key, as strokes: how many a second at a speed, and the push's shape
   over a stroke's phase u (0..1, skier.pushT). Skis skate off each ski in turn and pole (two pushes a cycle, |sin|);
   the board and the scooter kick with the back foot, the snowbike's rider pumps the bars and kicks off the snow, the
   sled's paddles with both hands: one stroke a cycle, the push over the first 0.45 of it, the rest the recovery. The
   mean push is the same for all (0.75), so only the rhythm differs. */
const STROKE = { ski: v => 1.2 + 0.05 * v, board: v => 0.9 + 0.03 * v, scoot: v => 0.95 + 0.035 * v, bike: v => 0.85 + 0.02 * v, sled: v => 1.3 + 0.02 * v };
const strokePush = (two, u) => two ? 0.3 + 0.7 * Math.abs(Math.sin(u * 2 * Math.PI)) : u < 0.45 ? 0.2 + 1.9 * Math.sin(Math.PI * u / 0.45) : 0.2;
// the snow (env.js sets skier.snowK; 1 everywhere is groomed): mu x the sliding friction, drag x the snow's drag (on the
// run, drag over 1 adds that much of deep snow's), grip x the edges' hold, sink: metres more the skis ride under the
// surface in this snow (0 for groomed; skier.sink is the whole depth)
export const SNOW1 = { mu: 1, drag: 1, grip: 1, sink: 0 };
// a face too steep to stand on: a park feature's side over about 49 degrees, any slope over about 53 (never the pipe)
// (it was 45: the Jump Line's kickers' sides are about 32 degrees now, but where a side meets the lip's back face or
// another lane's side they reach 46, which bounced riders off, 2026-11-05)
/* (P, 2026-11-08, for "remove sliding off steep slopes entirely": snow is snow however steep, you stand and turn on it.
   A wall is a park feature's face over about 49 degrees, a rock face (park.cliff(x, z), Freeride's: F marks its cliff
   bands, rib walls and outcrops' faces) over about 53, and on a map with no such marks any slope over about 65; anything
   over about 75 is a wall wherever it is.) */
const WALL_PARK = 0.65, WALL_ANY = 0.6, WALL_SNOW = 0.42, WALL_SHEER = 0.26;
let curPark = null;          // (the park being ridden, set each step: its cliff marks, if it has them)
const isWall = (ny, surf, pipe, x, z) => !pipe && (ny < WALL_SHEER || (ny < WALL_PARK && surf === 2) ||
  (curPark && curPark.cliff ? ny < WALL_ANY && curPark.cliff(x, z) : ny < WALL_SNOW));
// rails: round tops (the skis sit on a curve) and flat ones; the friction of each kind's top
const FLAT_TOPS = new Set(['box', 'bench', 'ledge', 'table', 'picnic']);
const RAIL_MU = { rail: 0.07, tube: 0.06, box: 0.085, bench: 0.11, ledge: 0.11, picnic: 0.11, rainbow: 0.075, dd: 0.07, down: 0.07, kink: 0.07, c: 0.07 };
const topOf = r => r.top || (FLAT_TOPS.has(r.kind) ? 'flat' : 'round');
/* (R, round 12) the numbers of a rail ridden as a slippery top (the rails section below says how they are used)
   k2      the rider's yaw radius of gyration squared (m^2): the body about its long axis (about 1.3 kg m^2) and the gear
           (two skis 2 x 1.7 kg x 1.75^2 / 12, a board 3 kg x 1.55^2 / 12, a snowbike's frame) over the whole mass; a
           sled's rider lies along it (70 kg x 1.75^2 / 12)
   rC      how far from the feet the load on the top sits, on average (m): under the boots (x 1.4 on a flat top)
   impactMu static friction for the landing's impulse: a ski base (UHMW polyethylene) on steel, 0.17 to 0.20 (its sliding
           friction dry is 0.08 to 0.12; RAIL_MU's 0.06 to 0.11 are a little under that, a top with snow on it)
   sideMu  a base sliding across itself (a slide) drags this much more than along itself (a 50-50): edges and the base's
           grain across the way it goes (a guess, no measured figure found)
   guide   the most a top holds a rider to its curve (m/s^2): leaning into it, a round top pushes the tilted base round
           (g tan 27 degrees on a steel rail; a fat tube's wider curve takes the contact off the base sooner, about 19),
           the edges bite a flat plastic top, a wooden or stone one more (worked out, not measured)
   turn, turnAcc  the turn keys' twist on the top: its top rate (rad/s) and how fast it builds (rad/s^2)
   lean, leanShift  how far the hips go over the feet across the rail: holding the balance, and shifting it on purpose (m)
   shift   a weight key puts the centre of mass this far past where the top holds it (m)
   leanK   how quickly the weight moves (1/s, a critically damped spring)
   hold    a round top holds the weight this far either side of its crown (the ankles' give, m) */
const RAILP = {
  k2: { ski: 0.028, board: 0.025, scoot: 0.024, bike: 0.033, sled: 0.2 },
  rC: { ski: 0.09, board: 0.07, scoot: 0.08, bike: 0.1, sled: 0.15 },
  impactMu: 0.18, sideMu: 0.35,
  guide: { rail: 5.0, tube: 3.3, flat: 5.0, rough: 5.5 },
  turn: 2.5, turnAcc: 8, lean: 0.2, leanShift: 0.32, shift: 0.12, leanK: 12,
  hold: { rail: 0.02, tube: 0.04 },
};
// a round top of a rail (steel) or a fat tube; a flat plastic top, or a wooden or stone one
const topClass = r => topOf(r) === 'round' ? (r.w >= 0.3 ? 'tube' : 'rail') : /^(bench|ledge|picnic)$/.test(r.kind) ? 'rough' : 'flat';
const _sup = [0, 0], _rl2 = new THREE.Vector3(), _rc0 = new THREE.Vector3(), _rc1 = new THREE.Vector3(), _rc2 = new THREE.Vector3();
// how far under the top line the top's surface is at a distance off its middle (a round top curves away)
/* (H, round 10) on a round top the skis (or the board...) rest on the highest part of the top under them: the part of
   their footprint nearest the rail's line, half their width out from the middle in a 50-50, half their length in a slide.
   The body was set as low as the curve is under its own middle, so off the middle of a tube the near ski was in it (up to
   9 cm on a fat tube, and in a slide across it by as much, though the skis lay over the crown). How far of off that is. */
function footOff(sk, off) { const K = sk.K || KIND.ski, a = sk.railAng || 0, f = Math.abs(Math.cos(a)) * K.reachAcross + Math.abs(Math.sin(a)) * K.reachAlong; return Math.sign(off) * Math.min(Math.abs(off), f); }
function railDrop(r, off) { if (topOf(r) !== 'round') return 0; const R = r.w / 2, a = Math.min(Math.abs(off), R); return R - Math.sqrt(R * R - a * a); }
const _rc = {}, _f = new THREE.Vector3(), _fs = new THREE.Vector3(), _rp = new THREE.Vector3();
const _rd = new THREE.Vector3(), _rn = new THREE.Vector3(), _rf = new THREE.Vector3(), _rl = new THREE.Vector3(), _rx = new THREE.Vector3(), _rq = new THREE.Quaternion();   // (H: the rail's frame)
/* a point on a rail's top line at s, carried on straight past its ends (a ride locked on with the skis' tips over its
   start, or with the tails over a short feature's end, starts there: P, 2026-11-08) */
function railAt(r, s, out) {
  if (s < 0) return r.at(0, out).addScaledVector(r.dirAt(0), s);
  if (s > r.len) return r.at(r.len, out).addScaledVector(r.dirAt(r.len), s - r.len);
  return r.at(s, out);
}
// the landing pull: the last T seconds, at most rate (rad/s), k x the error below that, full help within full, none past max
const PULL = { T: 0.35, rate: 0.9, k: 2.4, full: 30 * Math.PI / 180, max: 42 * Math.PI / 180 };
const LOCKS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const lockOf = a => { let best = 0, d = 9; for (const l of LOCKS) { const e = Math.abs(wrapPi(a - l)); if (e < d) { d = e; best = l; } } return best; };
// the clockwise angle from a to b about n (seen from above): + when b is to the right of a
function cwAngle(a, b, n) { _w.crossVectors(a, b); return -Math.atan2(_w.dot(n), a.dot(b)); }
// a rate that builds towards cap while the key is held (faster when it is turning the other way first), and settles
// back to what the takeoff gave (rest) when it is let go
/* what a key adds to a rotation (cur, rad/s about one of the body's axes) over what the takeoff gave about it (rest):
   held, the whole builds towards input x cap (faster against the way it goes); let go, the addition settles away */
function drive(cur, input, cap, acc, reverse, settle, dt, rest = 0) {
  if (!input) return cur * Math.exp(-settle * dt);
  const target = input * cap - rest, tot = cur + rest, a = (Math.sign(input) !== Math.sign(tot) && Math.abs(tot) > 0.3) ? acc * reverse : acc;
  return cur + clamp(target - cur, -a * dt, a * dt);
}

export class Skier {
  constructor(park) {
    this.park = park;
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();          // body orientation
    this.f = new THREE.Vector3(0, 0, 1);      // heading on the snow (unit, tangent)
    this.n = new THREE.Vector3(0, 1, 0);
    this.w = new THREE.Vector3();             // angular velocity in the air (world)
    this.wNat = new THREE.Vector3();          // what the takeoff gave it (carried spin, wind-up, the natural forward rotation)
    this.wKeys = new THREE.Vector3(); this.wCork = false;   // what the keys add, about the body's own up, left and forward
    this.com = new THREE.Vector3();
    this.state = 'ground';
    this.sw = false;                          // riding switch (backwards)
    this.edge = 0; this.edgeV = 0; this.crouch = 0; this.tuck = 0; this.brake = 0; this.press = 0; this.skate = 0; this.skateT = 0; this.lazy = 0; this.lazyT = 0;
    this.crouchT = 0;                         // how long the pop key has been held
    this.slide = 0;                           // lateral sliding speed (m/s), for spray and sound
    this.tAir = 0; this.tState = 0; this.windup = 0; this.turnRate = 0;
    this.grab = null; this.grabT = 0; this.pose = null; this.tweak = ''; this.shift = 0; this.shiftyT = 0;
    this.rail = null; this.railS = 0; this.railV = 0; this.railDir = 1; this.railMode = '5050'; this.balance = 0;
    this.railAng = 0; this.railAngV = 0; this.railOff = 0; this.railOffV = 0;
    this.safe = []; this.safeT = 0;
    this.events = [];                         // for tricks.js, sound and snow: [{ type, ... }]
    this.butter = 0;                          // accumulated pivot while pressed (rad)
    this.lastLanding = null; this.landT = 9; this.absorb = 0;
    this.brakeHead = null; this.unbrakeT = 9;
    this.mouseTarget = null;                  // the mouse scheme's wanted travel direction (unit vector) or null
    this.surf = 0; this.lookBack = false;
    this.kind = 'ski'; this.goofy = false; this.K = KIND.ski;   // what you ride (main.js sets kind and goofy)
    this.snowK = SNOW1;                       // the snow's numbers (env.js)
    this.sink = 0;                            // how deep the skis ride under the snow's surface (m), for the rig and tracks
    // rail contact for the pose and effects: seconds since the skis last met a rail or swapped on it, and which
    this.railHitT = 9; this.railHit = ''; this.railHitDir = 0;
    // (X) the extra rides: a timed trick going round (RIDE_ACTS), and a sled's flat spin on the snow
    this.act = null; this.actT = 0; this.actDur = 1; this.actN = 0; this.actKey = null; this.actAt = 0; this.flatSpin = 0; this.flatSpinOn = false;
    this.moved = 0;                           // how many times the skier was put somewhere new (spawn), for main.js
    /* (P, 2026-11-08) for the poses (main.js poseState passes them on, and net.js to the others): R held, riding on one
       ski or foot (oneSide: the side stood on, -1 left, 1 right); E held, the feet pressed together; the push stroke's
       phase (pushT, 0..1) and how much it is on (pushing); the last takeoff, the last landing (how hard, how far off the
       skis the travel was, how far the body was off the snow's normal), the crash's time and kind, the line's tricks in
       order (trickSeq) and this air's (airSeq), and what an S or N held in the air will land you into (landInto) */
    this.oneFoot = 0; this.oneSide = 1; this.together = 0; this.pushT = 0; this.pushing = 0;
    this.lastTakeoff = { pop: 0, crouch: 0, speed: 0, pitch: 0, t: 9, how: '' };
    this.landHit = 0; this.landOff = 0; this.landUp = 0; this.fallT = 0; this.fallKind = '';
    this.trickSeq = []; this.airSeq = []; this.seqT = 0; this.landInto = null;
  }
  // (P) a trick for the poses' order of tricks: added once (not again while it goes on), the line's last 8 and this air's
  seq(tok) {
    this.seqT = 0;
    const s = this.trickSeq; if (s[s.length - 1] !== tok) { s.push(tok); if (s.length > 8) s.shift(); }
    if (this.state === 'air') { const a = this.airSeq; if (a[a.length - 1] !== tok) { a.push(tok); if (a.length > 6) a.shift(); } }
  }
  actStop() { this.act = null; this.actT = 0; this.actN = 0; this.actKey = null; this.actQ = false; this.actLet = false; this.actNext = false; }
  // put the skier at x, z facing down the fall line
  spawn(x, z, speed = 0, yaw = 0) {
    this.moved = (this.moved || 0) + 1;       // (a jump to a new place: main.js never draws the rider between the two)
    this.p.set(x, height(x, z), z);
    normal(x, z, this.n);
    this.f.set(Math.sin(yaw), 0, Math.cos(yaw)); this.toTangent(this.f);
    this.v.copy(this.f).multiplyScalar(speed);
    this.state = 'ground'; this.sw = false; this.w.set(0, 0, 0); this.grab = null; this.pose = null; this.rail = null; this.tweak = ''; this.shift = 0;
    this.edge = 0; this.edgeV = 0; this.crouch = 0; this.crouchT = 0; this.tState = 0; this.butter = 0; this.press = 0; this.brake = 0; this.brakeHead = null; this.absorb = 0; this.skate = 0;
    this.windup = 0; this.turnRate = 0; this.lateCharge = false; this.revertLeft = 0; this.wNat.set(0, 0, 0); this.wKeys.set(0, 0, 0); this.wCork = false; this.landT = 9; this.unbrakeT = 9; this.corkAx = null;
    this.landSkid = false; this.unbutter = false; this.unbTurn = 0; this.wasButter = false; this.wasBrake = false; this.wallOff = false; this.pullPr = null; this.unslide = 0; this.tapLeft = 0; this.turnDir = 0; this.railCooldown = 0; this.brakeRef = null; this.lazy = 0; this.lazyT = 0; this.tuck = 0; this.held = null;
    this.actStop(); this.flatSpin = 0; this.flatSpinOn = false;
    this.oneFoot = 0; this.together = 0; this.pushT = 0; this.pushing = 0; this.lastTakeoff.t = 9; this.landHit = 0; this.landOff = 0; this.landUp = 0;
    this.fallT = 0; this.fallKind = ''; this.trickSeq.length = 0; this.airSeq.length = 0; this.landInto = null;
    this.groundQ();
    this.events.push({ type: 'spawn' });
  }
  toTangent(f) { f.addScaledVector(this.n, -f.dot(this.n)); if (f.lengthSq() < 1e-8) f.set(0, 0, 1); return f.normalize(); }
  // body orientation on the ground: up = the normal, forward = the heading
  groundQ() {
    const left = _w.crossVectors(this.n, this.f).normalize();
    const fwd = _v.crossVectors(left, this.n).normalize();
    _m.makeBasis(left, this.n, fwd); this.q.setFromRotationMatrix(_m);
  }
  get up() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.q); }
  get fwd() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.q); }
  get speed() { return this.v.length(); }
  // the feet (or the runners) to the centre of mass: lower crouched; a sled's rider lies close over it (KIND.com)
  comH() { const K = this.K || KIND.ski; return K.com ? K.com : COM * (1 - this.crouch * 0.35); }
  // (J, round 10: park.pipes, the superpipe and every quarterpipe and wallride of the Jump Line, ridden as the pipe is; here and below)
  inPipe(x, z) { return (this.park.pipes || [this.park.pipe, this.park.qp]).some(pp => pp && pp.surface(x, z)); }
  // the pop: from the speed you carry, the same however long the key was held
  popFor(speed) { return clamp(2.0 + 0.08 * speed, 2.0, 3.4) * (this.K ? this.K.pop : 1); }

  step(dt, I) {
    this.tState += dt; curPark = this.park;
    this.K = KIND[this.kind] || KIND.ski;
    this.railHitT += dt;
    this.lastTakeoff.t += dt; this.seqT += dt;
    this.fallT = this.state === 'crash' ? this.tState : 0;
    // (the line's tricks are forgotten once you have ridden on for 3 s with none)
    if (this.state === 'ground' && this.seqT > 3 && this.trickSeq.length) { this.trickSeq.length = 0; this.airSeq.length = 0; }
    // on the chairlift lift.js moves p and q itself; nothing here touches them
    if (this.state === 'lift') { this.oneFoot = this.together = this.pushing = this.pushT = 0; return; }
    if (this.state !== 'ground') this.sink = 0;
    if (this.railCooldown > 0) this.railCooldown -= dt;
    this.lookBack = !!I.look;
    if (this.state === 'ground') this.stepGround(dt, I);
    else if (this.state === 'air') this.stepAir(dt, I);
    else if (this.state === 'rail') this.stepRail(dt, I);
    else this.stepCrash(dt, I);
  }

  // ---- on the snow ------------------------------------------------------------------------------------------------
  stepGround(dt, I) {
    const n = this.v.lengthSq() > 1 ? normalBehind(this.p.x, this.p.z, this.v.x, this.v.z, this.n) : normal(this.p.x, this.p.z, this.n);
    this.surf = surface(this.p.x, this.p.z);
    // a face too steep to stand on (a kicker's side, the back of a lip): the edges cannot hold it, so off it you go
    if (isWall(n.y, this.surf, this.inPipe(this.p.x, this.p.z), this.p.x, this.p.z)) {
      /* (F, 2026-11-08: going out over a rock face's top edge, not into it, is riding off a lip. The step before had
         put the skis on the lip's rounded edge, already steeper than a wall, and off they went as off a wall, pushed
         away from it: at Tier A and the Big Ones at 10 to 13 m/s) */
      // (a lip: the rock falls away 0.2 m or more within 0.4 m ahead along the travel)
      const vh = Math.hypot(this.v.x, this.v.z);
      if (curPark && curPark.cliff && vh > 3 && height(this.p.x + this.v.x / vh * 0.4, this.p.z + this.v.z / vh * 0.4) < this.p.y - 0.2 && curPark.cliff(this.p.x, this.p.z)) {
        // (the body leaves as it stood on the snow a metre back, not lying along the rounded edge's own normal, which
        // can face sideways where a lip turns: the rider flew on their side and landed on it)
        const nb = normal(this.p.x - this.v.x / vh, this.p.z - this.v.z / vh, _n2);
        this.n.copy(nb.y > 0.5 ? nb : UP); this.toTangent(this.f); this.groundQ();
        this.takeoff(dt, 0, 0, 'lip'); return;
      }
      this.takeoff(dt, 0, 0, 'wall'); const nh = new THREE.Vector3(n.x, 0, n.z).normalize(); this.v.addScaledVector(nh, 0.3); return;
    }
    const f = this.toTangent(this.f);
    const right = _w.crossVectors(f, n).normalize().clone();
    const speed = this.v.length();
    this.landT += dt;
    // which way the skis point against the way we go; never decided while a brake has them across the travel
    const vf = this.v.dot(f), vr = this.v.dot(right);
    this.unbrakeT = I.brake || this.brake > 0.05 ? 0 : this.unbrakeT + dt;
    if (speed > 2 && this.unbrakeT > 0.6) {
      const c = vf / speed;
      if ((!this.sw && c < -0.3) || (this.sw && c > 0.3)) { this.sw = !this.sw; this.events.push({ type: 'switch', sw: this.sw }); }
    }
    const travel = this.sw ? -1 : 1;
    // steering: the mouse scheme asks for a direction (mouseErr, rad, + to the right), the keys for a turn
    const u = I.steer || 0;
    if (Math.abs(u) > 0.3) this.lastSteer = Math.sign(u);
    /* (P, 2026-11-08) R held: riding on one ski, the one on the side you lean to (the turn you are in, else the last turn
       key), the other lifted; it holds less across and pops a little less. E held: the skis pressed together. */
    if (I.oneFoot && this.oneFoot < 0.05) { this.oneSide = this.turnRate > 0.05 ? 1 : this.turnRate < -0.05 ? -1 : (this.lastSteer || this.oneSide); this.seq('oneFoot'); }
    this.oneFoot += ((I.oneFoot ? 1 : 0) - this.oneFoot) * Math.min(1, dt * 7);
    this.together += ((I.together && !I.oneFoot ? 1 : 0) - this.together) * Math.min(1, dt * 7);
    let mouseErr = null;
    if (this.mouseTarget && !I.brake) {
      const want = _v.copy(this.mouseTarget); want.addScaledVector(n, -want.dot(n)).normalize();
      const tr = _n.copy(f).multiplyScalar(travel);
      mouseErr = -cwAngle(want, tr, n);
    }
    // butter: the base pressed on the nose or tail, the skis pivot on that end with little grip
    this.press += ((I.butter ? I.press : 0) - this.press) * Math.min(1, dt * 8);
    // a lazy boy (held, on the snow): counted once it has been held half a second, scored when let go
    this.lazy += ((I.lazy ? 1 : 0) - this.lazy) * Math.min(1, dt * 6);
    if (I.lazy && speed > 2) { if (this.lazyT === 0) this.seq('lazy'); this.lazyT += dt; }
    else { if (this.lazyT >= 0.5) this.events.push({ type: 'lazyboy', t: this.lazyT }); this.lazyT = 0; }
    // (the butter key let go ends the butter at once, though the press eases off for the pose: a turn asked for then
    // turns at once, P 2026-11-08; it went on pivoting for about 0.13 s)
    const buttering = Math.abs(this.press) > 0.35 && !!I.butter;
    /* (P, 2026-11-08, for "butters smooth, no jerk to one side after a butter; come out of it like a sideways landing"):
       let go of a butter with the skis at an angle to the way you go, and the travel is kept while the skis skid round
       to it over a moment (unbutter), the edges biting a little as they come; before, the travel was put along the skis
       in one step (a 50 to 90 degree jerk) and the pivot stopped dead. */
    if (!buttering && this.wasButter && speed > 1 && !this.K.flatSpin) this.unbutter = true;
    this.wasButter = buttering;
    let angU = 0;
    if (this.unbutter) {
      const vd = _fs.copy(this.v).addScaledVector(n, -this.v.dot(n)), sk2 = _f.copy(f).multiplyScalar(travel);
      angU = speed > 0.5 ? cwAngle(vd, sk2, n) : 0;
      if (Math.abs(angU) > Math.PI / 2) angU = wrapPi(angU + Math.PI);      // (the nearer end leads)
      // (ended once the skis are on the travel to within 0.2 degrees, so nothing is left for the no-drift to snap round)
      if (Math.abs(angU) < 0.003 || speed < 1 || buttering) { this.unbutter = false; this.unbTurn = 0; }
    }
    /* the edge rolls on and off as a body does: eased in and out (a critically damped spring, not a fixed rate), so a
       quick tap tips the skis a little and lets them back, holding rolls them over through about half a second, and a
       change from left to right goes smoothly through flat skis. Sliding sideways fast, the skis stay on the edge the
       slide is on a little longer (rolling over mid-skid catches). (2026-11-03: the edge went over at 7/s with full
       turning from 5 degrees of edge, so one press turned a lot and the turn came in steps.) */
    const Kd = this.K;
    const edgeMax = Kd.edgeMax * (1 - 0.6 * Math.abs(this.press));
    // (the lean a body needs for the turn it is making at this speed, tan = v x turn / g; a little for a key held when slow)
    const lean = Math.atan(speed * Math.abs(this.turnRate) / G), held = u || (mouseErr !== null && Math.abs(mouseErr) > 0.02 ? Math.sign(mouseErr) * 0.6 : 0);
    const slipNow = Math.abs(vr), eWant = Math.abs(this.turnRate) > 0.02 ? Math.sign(this.turnRate) * clamp(Math.max(lean * 1.05, 0.22 * Math.abs(held)), 0, edgeMax) : held * 0.22;
    // (let go, the skis flatten at once and the turn stops with the key: no turning on after it, 2026-11-03; the other way,
    // they roll across quickly; onto the edge, still eased)
    const release = !held && !this.turnRate, back = eWant * this.edge < 0 || Math.abs(eWant) < Math.abs(this.edge);
    const wE = (this.mouseTarget ? 9 : release ? 30 : back ? 16 : 8) * (release ? 1 : clamp(1 - (slipNow - 3) / 6, 0.55, 1));
    this.edgeV += (wE * wE * (eWant - this.edge) - 2 * wE * this.edgeV) * dt;
    this.edge = clamp(this.edge + this.edgeV * dt, -1.1, 1.1);
    // the brake builds over about half a second (a tap is a speed check, a hold a hockey stop) and eases off when let go
    this.brake += ((I.brake ? 1 : 0) - this.brake) * Math.min(1, dt * (I.brake ? 3.4 : 3.4));
    // (P: the brake let go with the skis still across the travel: they skid round to it, the travel kept, as off a butter.
    // From the moment the key is let go, not once the brake has faded: a turn asked for then turns at once, F's bot, 2026-11-08)
    if (this.wasBrake && !I.brake && speed > 1 && !this.K.footBrake) this.unbutter = true;
    this.wasBrake = !!I.brake && this.brake > 0.03;
    // forward: a tuck at speed, a skate and a pole push on the flat; Shift (Shredsauce Controls) skates hard, and keeps
    // helping to about 70 km/h (2026-11-03, for "make pressing shift make you go faster more")
    const skateWant = !I.brake && !I.crouch && !buttering ? Math.max(I.push ? 1 - smoothstep(28, 31, speed) : 0, I.tuck ? 1 - smoothstep(5.5, 9, speed) : 0) : 0;
    this.skate += (skateWant - this.skate) * Math.min(1, dt * 5);
    this.tuck += ((I.tuck && !I.crouch ? smoothstep(4.5, 8.5, speed) : 0) - this.tuck) * Math.min(1, dt * 4);
    // crouching loads the pop (the knees bend); letting go pops by the speed you have
    // (crouched, the steering no longer winds up a spin: a takeoff never spins by itself, 2026-11-03)
    if (I.crouch) this.crouchT += dt;
    this.absorb *= Math.exp(-dt * 2.6);
    const crouchWant = I.crouch ? 0.82 : 0.28 + 0.32 * this.tuck + 0.12 * Math.abs(this.edge) + 0.12 * this.brake + this.absorb;
    this.crouch += (Math.min(0.95, crouchWant) - this.crouch) * Math.min(1, dt * (crouchWant > this.crouch ? 10 : 5));
    // the heading turns: the keys (or the mouse) at a steady rate, a butter pivoting, or the brake swinging the skis across
    const SK = this.snowK || SNOW1;
    const grip = (this.surf === 1 ? 0.62 : this.surf === 2 ? 1.05 : 1.12) * this.K.grip * SK.grip * (1 - 0.2 * this.oneFoot);
    const ae = Math.abs(this.edge);
    const skis = _n2.copy(f).multiplyScalar(travel);           // the way the skis go
    let omega = 0;
    // (stopped: below this the brake never turns the skis and nothing swings them back afterwards, 2026-11-05, for "make
    // the stopping not make you turn in any direction after stopping")
    const STILL = 1.2;
    if (speed < STILL * 0.8) this.brakeHead = null;
    // (a sled brakes with the rider's feet dragging behind it, not by swinging it across: K.footBrake)
    // (only while the brake key is held: let go, the skis are the rider's to steer at once, P 2026-11-08)
    if (I.brake && this.brake > 0.03 && !(speed < STILL && !this.brakeHead) && !Kd.footBrake) {
      // the skis swing across the way you are going, as far as the brake is held (square across at full), so the
      // skid slows you along your line instead of turning you; once stopped they stay put, and as the brake eases
      // off at speed (a speed check) they come back round to the way you were going when it started
      if (!this.brakeHead) {
        this.brakeHead = speed > 1 ? this.v.clone().normalize() : skis.clone();
        const slip = cwAngle(this.brakeHead, skis, n);
        this.brakeSide = u ? Math.sign(u) : Math.abs(slip) > 0.05 ? Math.sign(slip) : (this.lastEdge || 1);
        // (B: a board with no steering stops on its heel edge, facing down the hill, as riders do)
        if (this.kind === 'board' && !u) this.brakeSide = (this.goofy ? 1 : -1) * (this.sw ? -1 : 1);
      }
      if (speed > 1.5 && I.brake) this.brakeRef = (this.brakeRef || new THREE.Vector3()).copy(this.v).normalize();
      else if (!I.brake || !this.brakeRef) this.brakeRef = (this.brakeRef || new THREE.Vector3()).copy(this.brakeHead);
      if (u) this.brakeRef.applyAxisAngle(n, -u * 0.6 * dt);
      this.brakeRef.addScaledVector(n, -this.brakeRef.dot(n)).normalize();
      const ang = cwAngle(this.brakeRef, skis, n);
      const target = this.brakeSide * this.brake * 1.5;       // square across at a full brake
      omega = speed < STILL ? 0 : clamp((target - ang) * 8, -5.5, 5.5);
      const angH = cwAngle(this.brakeHead, skis, n);
      if (Math.abs(angH) > 1.7 && Math.sign(omega) === Math.sign(angH)) omega = 0;
      this.turnDir = 0; this.tapLeft = 0;
    } else {
      this.brakeRef = null;
      /* the turn (2026-11-05, for "each press of a button turns the skis the same amount and it is more precise"): a turn
         key turns the skis at one steady rate whatever the speed (K.turn), reached within K.build of the press; every
         press turns them at least K.tap however short it is, and once that is done the turn stops the moment the key is
         let go. A press the other way is a new press. The mouse scheme asks for a direction and is turned towards it at
         the same rates, slowing as it gets there. (Before, the edge made the turn: a tap turned about 1 degree, a hold
         took half a second to build, and how much depended on the speed and on the press before.) */
      const dir = u > 0.05 ? 1 : u < -0.05 ? -1 : 0;
      if (dir && dir !== this.turnDir) { this.tapDir = dir; this.tapLeft = Kd.tap; if (Math.sign(this.turnRate) !== dir) this.turnRate = 0; }
      this.turnDir = dir;
      let target = 0, slew = Kd.turn / Kd.build;
      if (buttering) { target = Kd.butter * u; slew = Kd.butterSlew || 14; this.tapLeft = 0; }
      else if (this.unbutter) {
        /* (round to the travel at up to 3.5 rad/s, easing in the last 25 degrees but never slower than 0.25, stopping on it.
           A turn asked for meanwhile turns the travel itself at once, at the same rate and build as on the snow any
           other time (unbTurn, put on the travel after the forces), and the skis with it as they come round: before, the
           travel followed only the edges' bite, and a turn straight after a brake tap turned it 0 degrees in 0.8 s) */
        const tw = dir ? dir * Kd.turn * Math.min(1, Math.abs(u) * 1.25) : mouseErr !== null && Math.abs(mouseErr) > 0.004 ? clamp(mouseErr * 4.5, -Kd.turn, Kd.turn) : 0;
        this.unbTurn = !tw ? (Kd.release ? (this.unbTurn || 0) * Math.exp(-dt / Kd.release) : 0) : (this.unbTurn || 0) + clamp(tw - (this.unbTurn || 0), -Kd.turn / Kd.build * dt, Kd.turn / Kd.build * dt);
        const w = Math.max(0.25, Math.min(3.5, Math.abs(angU) * 8)), wEnd = Math.abs(angU) / dt;
        target = -Math.sign(angU) * Math.min(w, wEnd) + this.unbTurn; slew = 30; this.tapLeft = 0;
      }
      else if (mouseErr !== null && !dir) { target = Math.abs(mouseErr) < 0.004 ? 0 : clamp(mouseErr * 4.5, -Kd.turn, Kd.turn); this.tapLeft = 0; }
      else if (dir) target = dir * Kd.turn * Math.min(1, Math.abs(u) * 1.25);
      else if (this.tapLeft > 0) target = this.tapDir * Kd.turn;
      // after a speed check the skis come back round to the way you were going (unless you steer)
      if (this.brakeHead) {
        const ang = cwAngle(this.brakeHead, skis, n);
        if (!dir && !buttering && Math.abs(ang) > 0.015 && this.unbrakeT < 0.9 && speed > 2.5) { target = clamp(-ang * 6, -2.5, 2.5); slew = 30; }
        else this.brakeHead = null;
      }
      // a revert: spun round 180 on the snow straight after a landing
      if (this.revertLeft) { target = -Math.sign(this.revertLeft) * 9; slew = 60; }
      if (target === 0 && !buttering && !this.unbutter) omega = Kd.release ? this.turnRate * Math.exp(-dt / Kd.release) : 0;   // let go: the turn stops there (leaning back up takes a moment on a sled)
      else omega = this.turnRate + clamp(target - this.turnRate, -slew * dt, slew * dt);
      // the least turn of a press, exactly: the last step of it only what is left
      if (this.tapLeft > 0 && !buttering) {
        const st = Math.abs(omega) * dt * (Math.sign(omega) === this.tapDir ? 1 : 0);
        if (!dir && st >= this.tapLeft) { omega = this.tapDir * this.tapLeft / dt; this.tapLeft = 0; }
        else this.tapLeft = Math.max(0, this.tapLeft - st);
      }
      if (this.revertLeft) { const st = -omega * dt; if (Math.abs(st) >= Math.abs(this.revertLeft)) { omega = -this.revertLeft / dt; this.revertLeft = 0; this.events.push({ type: 'revert' }); } else this.revertLeft -= st; }
      if (Math.abs(this.edge) > 0.25) this.lastEdge = Math.sign(this.edge);
    }
    if (I.revert && !this.revertLeft && this.landT < 0.8 && speed > 3) this.revertLeft = (this.lastSpinDir || 1) * Math.PI;
    if (Kd.flatSpin) omega = this.sledSpin(omega, buttering && Math.abs(u) > 0.05, speed, f, n, dt);     // (X: a sled's flat spin)
    this.turnRate = this.spinSnap ? 0 : omega; this.spinSnap = false;      // (X: a flat spin that has just stopped turns no further)
    f.applyAxisAngle(n, -omega * dt).normalize(); this.f.copy(f);
    right.crossVectors(f, n).normalize();
    if (buttering) { if (!this.butter && !I.lazy) this.seq('butter'); this.butter += -omega * dt; this.butterNose = this.press > 0; } else if (Math.abs(this.butter) > 0) { this.endButter(); }
    // forces
    const a = _v.set(0, -G, 0);
    const gn = a.dot(n); a.addScaledVector(n, -gn);                 // gravity along the slope
    const N = Math.max(0, -gn);                                     // normal load per kg
    const gAlong = a.dot(f);
    const vf2 = this.v.dot(f), vr2 = this.v.dot(right);
    const mu = (this.surf === 1 ? 0.07 : 0.036) * SK.mu * (Kd.mu || 1);
    if (Math.abs(vf2) > 0.03) a.addScaledVector(f, -Math.sign(vf2) * mu * N);
    // (stopped, the snow holds the skis unless the slope pulls along them harder than about 4.6 degrees does: pointed
    // down a steeper one they slide off, 2026-11-03; stopped across the hill or on the flat they stay)
    else a.addScaledVector(f, -a.dot(f) * (speed < 0.3 && this.skate < 0.05 && Math.abs(a.dot(f)) < 0.08 * N ? 1 : 0));
    // across the skis: a set edge holds what the turn asks for; once the skis slide sideways they only get the snow's
    // sliding friction, so a skid or a hockey stop slows you gradually instead of stopping you dead
    // (X: a sled in a flat spin barely holds sideways, so it keeps sliding the way it went while it turns)
    const edgeK = this.flatSpinOn ? 0.05 : buttering ? 0.25 : (0.32 + 0.68 * smoothstep(0.05, 0.55, ae)) * (1 + this.brake * 0.6);
    const pipe = this.inPipe(this.p.x, this.p.z);
    // a steep park feature's face (not the pipe) lets the edges go; snow, however steep, holds them (P, 2026-11-08)
    const steep = n.y > 0.8 || pipe || this.surf !== 2 ? 1 : smoothstep(WALL_PARK, 0.82, n.y);
    /* (P, 2026-11-08) on a steep slope a brake digs the edges in: they hold more than the snow's sliding friction alone,
       growing with the slope's pull from about 20 degrees on, so a held brake stops you on Freeride's steeps too (from
       10 m/s on 30 degrees and more it never stopped before) */
    const gT = G * Math.sqrt(Math.max(0, 1 - n.y * n.y)), dig = this.brake * gT * smoothstep(0.94, 0.866, n.y);
    const hold = (grip * N * edgeK * 1.35 + 0.6) * steep + dig;
    const skid = N * (0.22 + 0.33 * clamp(ae / 0.9 + this.brake, 0, 1) + 0.15 * this.brake) * (this.surf === 1 ? 1.25 : 1) + dig * 1.35;
    const slip = Math.abs(vr2) / Math.max(1.5, speed);
    // (in the pipe's transitions the rider is pressed into hard snow and the edges hold as in a carve)
    const gripMax = pipe && this.brake < 0.1 ? hold : Math.min(hold, skid) + Math.max(0, hold - skid) * Math.exp(-Math.max(0, slip - 0.18) / 0.12);
    // (braking, the edges bite harder at low speed too, so a stop on a steep slope does not creep: P, 2026-11-08)
    const lat = clamp(-vr2 * (16 + 30 * this.brake * smoothstep(0.94, 0.866, n.y)), -gripMax, gripMax);
    a.addScaledVector(right, lat);
    /* (P, 2026-11-08, for "braking never changes your direction of travel", every ride): braking, and the skis skidding
       back round to the travel after a brake or a butter (unless you steer), take speed off along the way you are going
       and nothing else: the edges' push across it and the slope's pull across it are held. (It was the edges' push only,
       and only as much as the brake was on: the travel turned 5 to 30 degrees braking, 12 to 29 after a tap.) */
    if (!Kd.footBrake && speed > 0.5 && ((I.brake && this.brake > 0.03) || this.unbutter)) {
      const vd = _fs.copy(this.v).addScaledVector(n, -this.v.dot(n)).normalize();
      a.copy(vd.multiplyScalar(a.dot(vd)));
    }
    // (and a turn tighter than the skis' own arc at this speed is partly skidded round: some spray and scrape)
    this.slide = Math.abs(vr2) + (this.scrub || 0) * 0.35 + (buttering ? 0 : Math.max(0, Math.abs(this.turnRate) - speed / Kd.sidecut) * speed * 0.25);
    // a rider checks speed on a kicker's in-run (unless tucking for more): scrubbing towards its design speed
    this.scrub = 0;
    // (up the takeoff too, towards the speed that leaves the lip at its own: what the ramp takes is then whatever it is)
    if (!I.tuck && !I.push && speed > 4) for (const k of this.park.kickers) {
      // (the whole takeoff: the jump and the feature beside it on the same ramp)
      if (k.noCheck || this.p.z < k.z0 - 50 || this.p.z > k.L.z - 0.4 || Math.abs(this.p.x - (k.cxT ?? k.x)) > (k.hwT ?? k.wT) + 3) continue;   // (J, round 10: noCheck, the Jump Line's roller to its knuckle: riders take the skews beside it at their own speed)
      const want = this.p.z < k.z0 ? k.vDesign : Math.sqrt(k.vLip * k.vLip + 2 * 9.81 * Math.max(0, k.L.y - this.p.y) * 1.05);
      const over = speed - want;
      if (over > 0.2) { const d = Math.min(3.2, over * 1.6); a.addScaledVector(this.v, -d / speed); this.scrub = d; }
    }
    // (N, round 12: a map's own in-runs that are not Kickers, park.inruns, each { want(p) -> m/s or null }: the Nines map's
    // Formation Jump decks. Checked tucking or not, a tuck buying 0.8 m/s more: a rider tucking from its start reached
    // 28 m/s at the lips and landed past the landing)
    if (this.park.inruns && speed > 4) for (const k of this.park.inruns) {
      const want = k.want(this.p); if (want == null) continue;
      const over = speed - want - (I.push ? 0 : I.tuck ? 0.8 : 0);
      if (over > 0.2) { const d = Math.min(I.push ? 20 : 3.2, over * (I.push ? 10 : 1.6)); a.addScaledVector(this.v, -d / speed); this.scrub = Math.max(this.scrub, d); }   // (a hard push, about 9 to 11 m/s2, needs a harder check)
    }
    // pumping the pipe's transitions: riders extend their legs going up the curve and gain speed doing it
    for (const pp of (this.park.pipes || [this.park.pipe, this.park.qp])) {
      if (!(pp && n.y < 0.97 && n.y > 0.12 && pp.surface(this.p.x, this.p.z) && Math.abs(this.v.x) > 3)) continue;
      const upWall = (pp.dir || Math.sign(this.p.x - pp.x)) === Math.sign(this.v.x);
      a.addScaledVector(this.v, (upWall ? 2.3 : 1.0) / speed);
    }
    // skating and poling: strides that push, strongest from a standstill, nothing left past about 30 km/h
    if (this.skate > 0.02) {
      this.skateT += dt * (STROKE[this.kind] || STROKE.ski)(speed);
      const pulse = strokePush(!STROKE[this.kind] || this.kind === 'ski', this.skateT % 1);   // a push off each ski in turn (one stroke a cycle on the other rides)
      const vmax = I.push ? 30 : 9.5, ahead = Math.max(0, vf2 * travel);
      // Shift (I.push): a hard push that is mostly steady, about 9 m/s2 on average, more than any slope you can stand on
      // pulls back, so it gains speed uphill too, at full strength to about 80 km/h and gone by 108 (2026-11-14, for
      // "pressing shift makes you go significantly faster ... even if you are going uphill"); every ride gets most of it
      if (I.push) a.addScaledVector(f, travel * 11 * Math.max(Kd.skate ?? 1, 0.8) * this.skate * (0.55 + 0.45 * pulse) * clamp((vmax - ahead) / 8, 0, 1));
      else a.addScaledVector(f, travel * 3.0 * (Kd.skate ?? 1) * this.skate * pulse * clamp(1 - ahead / vmax, 0, 1));
      this.pushT = this.skateT % 1;
    } else { this.pushT = 0; this.skateT = 0; }
    this.pushing = this.skate > 0.02 ? this.skate : 0;
    // a sled's feet dragging in the snow behind it (K.footBrake m/s2 at a full brake)
    if (Kd.footBrake && this.brake > 0.03 && speed > 0.05) a.addScaledVector(this.v, -(Kd.footBrake * this.brake + dig * 1.1) / speed);
    // air drag and deep snow
    const cda = (Kd.cda || 0.55) * (1 - 0.55 * this.tuck - (I.crouch ? 0.36 : 0)) + 0.2 * this.brake;
    a.addScaledVector(this.v, -0.5 * 1.2 * cda / 78 * speed);
    // (the snow's drag: deep snow's off the run, and on it whatever more than groomed the snow type has)
    const sd = this.surf === 1 ? SK.drag : Math.max(0, SK.drag - 1);
    if (sd > 0) a.addScaledVector(this.v, -0.0045 * sd * speed);
    // how deep the skis ride: a little on the run, more in deep snow, less as speed lifts them up
    // (snowK.sink is metres more in this snow, env.js's: powder 0.22, groomed 0; less of it on packed park features)
    this.sink = ((this.surf === 1 ? 0.14 : this.surf === 2 ? 0.005 : 0.012) + (this.surf === 2 ? 0.3 : 1) * (SK.sink || 0)) * (1 - 0.55 * smoothstep(4, 16, speed));
    if (speed < 0.6 && this.skate < 0.05 && N > 9 && a.length() < 0.4) a.multiplyScalar(0);
    // standing still: the edges hold you across the hill, and the skis stay put unless the slope pulls along them
    // harder than about 4.6 degrees does (it crept sideways down the hill at about 0.1 m/s before)
    // (P: and a brake held stops you and keeps you stopped, edges dug in, whichever way the skis ended up, 2026-11-08)
    if ((speed < 0.4 && this.skate < 0.05 && !buttering && !this.revertLeft && Math.abs(gAlong) < 0.08 * N) || (this.brake > 0.5 && speed < 0.6 && !Kd.footBrake)) { a.multiplyScalar(0); this.v.multiplyScalar(Math.exp(-dt * 12)); }
    this.v.addScaledVector(a, dt);
    this.v.addScaledVector(n, -this.v.dot(n));
    if (this.unbutter && this.unbTurn) this.v.applyAxisAngle(n, -this.unbTurn * dt);     // (P: a turn asked for while the skis come round)
    /* no drift (2026-11-03, for "remove it completely except for on landings"): on the snow the skis go where they point,
       a turn taking the travel round with them at the speed it had. A slide is left only after a landing that came
       down across the skis (until it has skidded out), braking and just after, buttering, on a face too steep for the
       edges, in a revert, and nearly stopped. */
    const sp2 = this.v.length();
    if (this.landSkid && Math.abs(this.v.dot(right)) < 0.6) this.landSkid = false;
    // (P, 2026-11-08: from the moment the skis are back on the travel after a brake, not 0.9 s after it faded)
    if (sp2 > 1 && !buttering && !this.unbutter && !this.flatSpinOn && (!I.brake || Kd.footBrake) && steep > 0.95 && !this.landSkid && !this.revertLeft) {
      const al = this.v.dot(f);
      this.v.copy(f).multiplyScalar((al < 0 ? -1 : al > 0 ? 1 : travel) * sp2);
    }
    // pop
    if (!I.crouch && this.crouchT > 0.06) {
      // (no spin from the takeoff: not the turn you were in, not a wind-up; only the spin keys in the air spin you,
      // 2026-11-03, for "remove the feature where if you lean on a takeoff you automatically spin")
      const spin = 0;
      this.crouchT = 0;
      this.takeoff(dt, this.popFor(speed) * (1 - 0.1 * this.oneFoot), spin, 'pop'); this.windup = 0; return;
    }
    if (!I.crouch) { this.crouchT = 0; this.windup *= Math.max(0, 1 - dt * 3); }
    // move, and leave the snow where it curves away faster than gravity can follow (not in the moment after landing)
    const nx = this.p.x + this.v.x * dt, nz = this.p.z + this.v.z * dt;
    const ny = this.p.y + this.v.y * dt;
    const by = ny - 0.5 * G * dt * dt;
    const h1 = height(nx, nz);
    /* (F, 2026-11-08: the step would put the skis inside a face too steep to stand on, a rock face met at speed: stay
       where we are and meet it as a wall, as in the air, rather than going 0.6 m into it and being pushed out) */
    if (h1 > by + 0.25) {
      const nw = normal(nx, nz, _n2);
      if (isWall(nw.y, surface(nx, nz), this.inPipe(nx, nz), nx, nz)) {
        const nh = _v.set(nw.x, 0, nw.z); if (nh.lengthSq() < 1e-8) nh.set(0, 0, -1); nh.normalize();
        const vn = this.v.dot(nh);
        if (vn < -10) { this.crash('wall'); return; }
        if (vn < 0) this.v.addScaledVector(nh, -vn * 1.1);
        this.takeoff(dt, 0, 0, 'wall'); return;
      }
    }
    if (by > h1 + (this.landT < 0.3 ? 0.03 : 0.004) && speed > 2) {
      // rolled off a lip: a crouch held through it still winds the spin, and letting go just after still pops
      const crouched = I.crouch && this.crouchT > 0.06;
      this.takeoff(dt, 0, 0, 'lip');
      this.lateCharge = crouched; if (crouched) this.windup = 0;
      return;
    }
    this.p.set(nx, ny, nz);
    for (let k = 0; k < 2; k++) {
      const h = height(this.p.x, this.p.z); normalBehind(this.p.x, this.p.z, this.v.x, this.v.z, n);
      const gap = h - this.p.y; this.p.addScaledVector(n, gap * n.y);
    }
    /* (where the snow curves, the travel turns with it and keeps its speed: the snow's push is square to the travel and
       takes nothing from it. Laid flat on the new slope each step, a dip, a toe or a knuckle took a few percent a step,
       up to 3.6 m/s off the foot of a kicker's side, 2026-11-05. A sharp change in one step, as straight into a face,
       still loses what goes into it.) */
    const sp1 = this.v.length(), vn1 = this.v.dot(n);
    /* (the snow fell away by more than 5 degrees in this one step, sharper than any knuckle or roller at any speed: a lip
       met a few millimetres past its edge, which the check above misses. Off it goes as off any lip, with the travel the
       ramp gave: laid on the slope straddling the lip, a big air's takeoff came out 10 degrees flat, 2026-11-05) */
    /* (J, round 9: a lip met a millimetre or two past its edge bent the travel by under 5 degrees in this step and again
       in the next, which took off, so the takeoff came out 3 to 8 degrees flat, about once in a hundred, and a rider at
       a jump's design speed landed on its knuckle. The snow a step further on more than 4 cm under the line of travel,
       where this step fell away at all, is a lip too: a jump's 6 m knuckle at 25 m/s falls 4 mm under it in a step) */
    const lipAhead = vn1 > 0.02 * sp1 && height(nx + this.v.x * dt, nz + this.v.z * dt) < ny + this.v.y * dt - 0.04;
    if ((vn1 > 0.09 * sp1 || lipAhead) && speed > 2 && this.landT > 0.15) { this.p.set(nx, ny, nz); this.takeoff(dt, 0, 0, 'lip'); return; }
    this.v.addScaledVector(n, -vn1);
    if (sp1 > 0.5 && Math.abs(vn1) < 0.42 * sp1) this.v.setLength(sp1);
    this.toTangent(this.f);
    this.groundQ();
    this.railCheck();
    if (this.state === 'ground' && this.railBump()) return;
    if (this.treeHit()) return;
    // remember safe places
    this.safeT += dt;
    if (this.safeT > 0.25 && (this.surf !== 2 || n.y > 0.985) && speed > 1.5 && Math.abs(this.edge) < 0.9) {
      this.safeT = 0; this.safe.push({ p: this.p.clone(), f: this.f.clone(), v: this.v.clone(), sw: this.sw }); if (this.safe.length > 60) this.safe.shift();
    }
  }
  endButter() {
    const deg = Math.abs(this.butter) * 180 / Math.PI;
    if (deg > 140 && !(this.K && this.K.flatSpin)) this.events.push({ type: 'butter', deg, nose: !!this.butterNose, dir: Math.sign(this.butter) });   // (X: a sled's are its flat spins)
    this.butter = 0;
  }
  /* (X) a sled's flat spin on the snow, a bodyboarder's spinner: once the butter key and a turn key have it turning fast
     it counts as a spin; let go, it carries on round the same way (at least 5.5 rad/s) until it faces the way it slides,
     forwards or backwards, and stops there. Done, it is a 'sledspin' event { deg, dir } for tricks.js. */
  sledSpin(omega, spinning, speed, f, n, dt) {
    if (spinning && Math.abs(omega) > 2.5) this.flatSpinOn = true;
    if (!this.flatSpinOn) { this.flatSpin = 0; return omega; }
    if (!spinning) {
      if (Math.abs(this.flatSpin) < 0.6 || speed < 0.8) { this.endFlatSpin(); return omega; }
      const w = Math.sign(this.flatSpin) * Math.max(Math.abs(omega), 5.5);
      const vd = _fs.copy(this.v).addScaledVector(n, -this.v.dot(n)).normalize();
      const rel = cwAngle(vd, f, n), nx = rel + w * dt;
      // (the heading passes the travel, or its reverse, in this step: stop there exactly)
      if (Math.floor(rel / Math.PI) !== Math.floor(nx / Math.PI) || Math.abs(Math.sin(rel)) < 0.02) {
        omega = (Math.round(nx / Math.PI) * Math.PI - rel) / dt;
        this.flatSpin += omega * dt; this.endFlatSpin(); return omega;
      }
      omega = w;
    }
    this.flatSpin += omega * dt;
    return omega;
  }
  endFlatSpin() {
    const deg = Math.abs(this.flatSpin) * 180 / Math.PI;
    if (deg > 140) this.events.push({ type: 'sledspin', deg, dir: Math.sign(this.flatSpin) });
    this.flatSpin = 0; this.flatSpinOn = false; this.spinSnap = true;
  }

  // ---- in the air -------------------------------------------------------------------------------------------------
  takeoff(dt, pop, spin, how) {
    const n = this.n;
    // (P) what the takeoff was like, for the poses: how hard the pop, how deep the load, the lip's angle (the travel's,
    // before the pop), the speed
    const sp0 = this.v.length(), T0 = this.lastTakeoff;
    T0.pop = clamp(pop / 3.4, 0, 1); T0.crouch = this.crouch; T0.speed = sp0; T0.pitch = sp0 > 0.5 ? Math.asin(clamp(this.v.y / sp0, -1, 1)) : 0; T0.t = 0; T0.how = how;
    this.airSeq.length = 0; this.seqKeys = 0; this.landInto = null; this.unbutter = false; this.wasButter = false; this.pushing = 0; this.pushT = 0; this.skateT = 0;
    if (pop) this.v.addScaledVector(n.y > 0.4 ? n : UP, pop);
    // in the pipe: a skier goes straight up the wall, not out over the deck
    for (const pp of (this.park.pipes || [this.park.pipe, this.park.qp])) {
      if (!(n.y < 0.55 && pp && this.p.z > pp.z0 && this.p.z < pp.z1 && this.p.x > pp.x0 && this.p.x < pp.x1)) continue;
      const out = pp.dir || Math.sign(this.p.x - pp.x);
      const vx = this.v.x * out;
      if (vx > -0.4) this.v.x = -0.4 * out;
    }
    this.state = 'air'; this.tState = 0; this.tAir = 0; this.lateCharge = false; this.wallOff = how === 'wall'; this.unslide = 0;
    this.com.copy(this.p).addScaledVector(this.up, this.comH());
    const up = this.up;
    this.w.copy(up).multiplyScalar(spin);
    this.natural = how === 'wall' ? 0 : this.naturalTurn();
    this.wNat.copy(this.w); this.wKeys.set(0, 0, 0); this.wCork = false;
    this.lastPress = this.press;
    const inPipe = (this.park.pipes || [this.park.pipe, this.park.qp]).some(pp => pp && n.y < 0.55 && this.p.z > pp.z0 && this.p.z < pp.z1 && this.p.x > pp.x0 && this.p.x < pp.x1);
    this.events.push({ type: 'takeoff', how, sw: this.sw, speed: this.v.length(), press: this.press, butter: Math.abs(this.press) > 0.35, rail: !!this.rail, pipe: inPipe });
    this.press = 0; this.endButter();
    if (this.flatSpinOn) this.endFlatSpin(); this.actStop();     // (X)
    this.grab = null; this.grabT = 0; this.held = null; this.tweak = ''; this.shiftyT = 0; this.shiftDir = 0;
  }
  // the natural rotation of a good takeoff (off a lip or off the end of a rail): the body turns forward through the
  // air to meet the landing's slope; added to w, the angle returned
  naturalTurn() {
    const pr = this.predictLanding(); if (!pr) return 0;
    const up = this.up, left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    const u1 = up.clone().addScaledVector(left, -up.dot(left)), n1 = pr.n.clone().addScaledVector(left, -pr.n.dot(left));
    const ang = Math.atan2(new THREE.Vector3().crossVectors(u1, n1).dot(left), u1.dot(n1));
    if (Math.abs(ang) < 1.4) this.w.addScaledVector(left, ang / Math.max(0.3, pr.T * 0.92));
    return ang;
  }
  stepAir(dt, I) {
    this.tAir += dt;
    // let go of the pop key just after rolling off a lip: it still pops
    if (this.lateCharge) {
      if (!I.crouch && this.tAir < 0.22) { const lp = this.popFor(this.v.length()) * 0.8; this.v.addScaledVector(UP, lp); this.lateCharge = false; this.events.push({ type: 'latepop' }); this.lastTakeoff.pop = clamp(lp / 3.4, 0, 1); this.lastTakeoff.how = 'late'; }
      else if (this.tAir >= 0.22) this.lateCharge = false;
    }
    if (!I.crouch) this.crouchT = 0; else this.crouchT += dt;
    // rotation about the body's own axes: a held key builds it towards its top rate, let go it settles
    const q = this.q;
    const up = _v.set(0, 1, 0).applyQuaternion(q), left = _n.set(1, 0, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const grabbing = !!I.grab || !!I.pose;
    const acc = grabbing ? 0.8 : 1;
    // (P) the order of tricks, for the poses: a spin, flip, cork or Lincoln loop key newly pressed
    const keysNow = (I.spin ? 1 : 0) | (I.flip ? 2 : 0) | (I.tilt ? 4 : 0), newK = keysNow & ~(this.seqKeys || 0); this.seqKeys = keysNow;
    if (newK) { if (I.spin && I.flip) this.seq('cork'); else { if (newK & 1) this.seq('spin'); if (newK & 2) this.seq('flip'); } if (newK & 4) this.seq('roll'); }
    this.landInto = I.landInto || null;
    // (one ski or together: let go of in the air, over a quarter of a second, so the pop off one ski still shows)
    this.oneFoot *= Math.exp(-dt * 4); this.together *= Math.exp(-dt * 4);
    /* what the takeoff gave (the turn carried off the lip, a wound-up spin, the forward rotation to meet the landing)
       is angular momentum and carries on, kept in the world (wNat); the keys build more about the body's own axes,
       and what they added settles away when let go. (Kept apart: read back through the body's axes every step, the
       takeoff's rotation lagged behind a fast spin and tipped the body over sideways, 2026-11-03.) */
    const ns0 = this.wNat.dot(up), nf0 = this.wNat.dot(left), nr0 = this.wNat.dot(fwd);
    // (the keys' part is kept as numbers on the body's axes, wKeys: spin, flip, roll. Taken from the world's w each
    // step, a fast spin leaked into flip and roll as the body's up moved under the takeoff's rotation. After a cork,
    // which turns w itself, it is read off w once.)
    if (this.wCork) { this.wKeys.set(this.w.dot(up) - ns0, this.w.dot(left) - nf0, this.w.dot(fwd) - nr0); this.wCork = false; }
    let ns = this.wKeys.x, nf = this.wKeys.y, nr = this.wKeys.z;
    // a cork is set at the lip: spin and flip held together early in the air build quickly onto the tipped axis
    const cork = !!(I.spin && I.flip), fk = I.fast ? AIR.fastK : 1, set = cork && this.tAir < 0.5 ? 1.8 : 1;
    if (cork) {
      if (!this.corkAx) {
        const lh = left.clone().setY(0); if (lh.lengthSq() < 1e-4) lh.copy(left); lh.normalize();
        this.corkAx = new THREE.Vector3().addScaledVector(UP, -Math.sign(I.spin) * Math.cos(AIR.corkTilt)).addScaledVector(lh, Math.sign(I.flip) * Math.sin(AIR.corkTilt)).normalize();
      }
      const d = this.corkAx.clone().multiplyScalar(AIR.cork * fk).sub(this.w), lim = AIR.spinAcc * acc * set * dt;
      if (d.length() > lim) d.setLength(lim);
      ns = 0; nf = 0; nr = 0; this.w.add(d); this.wCork = true;
      this.wNat.multiplyScalar(Math.exp(-dt * 3));
    } else {
      this.corkAx = null;
      ns = drive(ns, -I.spin, Math.max(AIR.spin * fk, Math.abs(ns0)), AIR.spinAcc * acc, AIR.reverse, AIR.settleSpin, dt, ns0);
      nf = drive(nf, I.flip, AIR.flip, AIR.flipAcc * acc, AIR.reverse, AIR.settleFlip, dt, nf0);
      // a flip the rider throws takes over from the takeoff's own forward rotation
      if (I.flip) this.wNat.addScaledVector(left, -this.wNat.dot(left) * (1 - Math.exp(-dt * 3)));
      nr = drive(nr, I.tilt, AIR.roll, AIR.rollAcc * acc, AIR.reverse, AIR.settleRoll, dt, nr0);
    }
    // the spin the takeoff gave dies away slowly with no spin key held (the rider holds the body still); nothing turns
    // the body towards a landable attitude: where it is at touchdown is how it lands (2026-11-03, for "landings do not
    // magnetically pull to face forward")
    if (!I.spin && !cork) this.wNat.addScaledVector(up, -this.wNat.dot(up) * (1 - Math.exp(-dt * AIR.restSpin)));
    if (!cork) { this.wKeys.set(ns, nf, nr); this.w.copy(this.wNat).addScaledVector(up, ns).addScaledVector(left, nf).addScaledVector(fwd, nr); }
    const wl = this.w.length();
    if (wl > 1e-5) { _q.setFromAxisAngle(_w.copy(this.w).divideScalar(wl), wl * dt); q.premultiply(_q).normalize(); }
    // coming off a slide the skis turn back round to the travel, a quarter turn in about a sixth of a second
    if (this.unslide) {
      const ur = this.unslideRate || 10, st = clamp(this.unslide, -ur * dt, ur * dt); this.unslide -= st; if (Math.abs(this.unslide) < 1e-4) this.unslide = 0;
      _q.setFromAxisAngle(_w.set(0, 1, 0).applyQuaternion(q), st); q.premultiply(_q).normalize();
    }
    this.landPull(dt);
    // slid off a face: the rider gets their body back upright over the skis, the heading kept
    if (this.wallOff && !I.spin && !I.flip && !I.tilt) {
      const fh = new THREE.Vector3(0, 0, 1).applyQuaternion(q); fh.y = 0;
      if (fh.lengthSq() > 1e-3) { fh.normalize(); const lf = new THREE.Vector3().crossVectors(UP, fh).normalize(); _m.makeBasis(lf, UP, fh); _q.setFromRotationMatrix(_m); q.slerp(_q, Math.min(1, dt * 7)); }
    }
    // grabs and positions are both held things for the trick's name; a variation (E or R) is the one held longest
    const held = I.grab || I.pose || null;
    if (held !== this.held) {
      if (this.held) this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() });
      this.held = held; this.grabT = 0; this.modT = {};
      if (held) { this.events.push({ type: 'grab', id: held }); this.seq('grab:' + held); }
    }
    if (this.held) { this.grabT += dt; const m = I.tweak || ''; this.modT[m] = (this.modT[m] || 0) + dt; }
    this.grab = I.grab || null;
    this.pose = I.pose || null;
    this.tweak = this.held ? (I.tweak || '') : '';
    // a shifty: the skis turned across under the body and back (the body turns the other way; no rotation is made)
    this.shift += ((I.shifty || 0) - this.shift) * Math.min(1, dt * 7);
    if (Math.abs(this.shift) > 0.6) { this.shiftyT += dt; this.shiftDir = Math.sign(this.shift); }
    else if (this.shiftyT > 0.15) { this.events.push({ type: 'shifty', dir: this.shiftDir, t: this.shiftyT }); this.shiftyT = 0; }
    if (Math.abs(this.shift) > 0.6 && this.shiftyT < 0.02) this.seq('shifty');
    if (RIDE_ACTS[this.kind]) this.stepAct(dt, RIDE_ACTS[this.kind]);        // (X: a tailwhip, a bar spin... going round)
    this.crouch += ((grabbing ? 0.75 : I.crouch ? 0.6 : 0.34 + 0.1 * Math.abs(this.shift)) - this.crouch) * Math.min(1, dt * 6);
    // flight
    const sp = this.v.length();
    this.v.y -= G * dt;
    this.v.addScaledVector(this.v, -0.5 * 1.2 * (grabbing ? 0.42 : 0.5) / 78 * sp * dt);
    this.com.addScaledVector(this.v, dt);
    const comH = this.comH();
    this.p.copy(this.com).addScaledVector(_w.set(0, 1, 0).applyQuaternion(q), -comH);
    this.events.push({ type: 'air', dq: wl * dt });
    if (this.railCheck()) return;
    if (this.railBump()) return;
    if (this.treeHit()) return;
    const h = height(this.p.x, this.p.z);
    // (F, 2026-11-08: deep in the snow counts at once, even in the first 0.03 s after a takeoff off a wall)
    if (this.p.y <= h && (this.tAir > 0.03 || this.p.y < h - 0.25)) {
      const nn = normal(this.p.x, this.p.z, _n2);
      if (isWall(nn.y, surface(this.p.x, this.p.z), this.inPipe(this.p.x, this.p.z), this.p.x, this.p.z)) this.wallHit(h, nn, dt);
      else this.land(h);
    }
    else if (this.headDown()) this.crash('head');
    else if (this.tAir > 25) this.crash('lost');
  }
  /* (2026-11-07) upside down, the head (on a sled, the rider's back) meets the snow before the feet do: that is the
     crash, then, and it slides from there. It used to fly on through the snow until the feet came down, the body drawn
     in the snow up to the hips. Only with the head below the feet, where a landing would be a crash anyway. */
  headDown() {
    const up = _v.set(0, 1, 0).applyQuaternion(this.q);
    if (up.y > -0.05) return false;
    const d = (this.K || KIND.ski).com ? 0.12 : 0.75, hx = this.com.x + up.x * d, hz = this.com.z + up.z * d, gh = height(hx, hz);
    if (this.com.y + up.y * d - 0.12 > gh) return false;
    this.p.set(hx, gh, hz); this.moved++;    // (the crash slides from where the head met the snow; drawn from there, not between)
    return true;
  }
  /* (X) the extra rides: a timed trick (RIDE_ACTS). A held key starts one; it goes round in actDur seconds, and round
     again if the same key is still held as a round ends (a double whip); a different trick's key held then starts that
     one straight after. A trick that does not loop waits for its key to be let go before it can start again. */
  stepAct(dt, AF) {
    const def = this.held ? AF(this.held, this.tweak || '') : null;      // (P, for B and S: E or R held, its own version of the trick)
    if (this.act) {
      // (2026-11-06, for "after each tailwhip if you do another one the feet dont have to stay back onto the board":
      // the same trick's key pressed again during a round queues one more round straight on; actNext says another
      // round follows, so the poses carry through the round's end instead of going back to the deck)
      if (!this.held) this.actLet = true;
      else if (this.actLet && def && def.id === this.act && def.loop !== false) { this.actQ = true; this.actLet = false; }
      this.actT += dt;
      if (this.actT >= this.actDur) {
        this.actN++;
        if (def && def.id === this.act && def.loop !== false && this.held === this.actKey || this.actQ) { this.actT -= this.actDur; this.actQ = false; if (this.held) this.actKey = this.held; }
        else { const was = this.act; this.events.push({ type: 'act', id: was, n: this.actN, at: this.actAt }); this.actStop(); this.actKey = def && def.id === was ? this.held : null; }
      }
    }
    if (!this.act && def && this.held !== this.actKey) { this.seq('act:' + def.id); this.act = def.id; this.actDur = def.T; this.actT = 0; this.actN = 0; this.actKey = this.held; this.actAt = this.tAir; this.actQ = false; this.actLet = false; }
    if (!this.held) this.actKey = null;
    this.actNext = !!(this.act && (this.actQ || def && def.id === this.act && def.loop !== false && this.held === this.actKey));
  }
  // a face too steep to land on: the skis bounce off it and slide down it, hard into it is a crash
  wallHit(h, nn, dt = 0) {
    // the face pushes back sideways only (pushed along its normal the rider was thrown up it and rode onto the deck)
    const nh = new THREE.Vector3(nn.x, 0, nn.z); if (nh.lengthSq() < 1e-6) nh.set(0, 0, -1); nh.normalize();
    const vn = this.v.dot(nh);
    if (vn < -10) { this.crash('wall'); return; }
    /* (F, 2026-11-08: met deep in a steep face, the rider is put back where this step began across it, outside the
       face, rather than lifted up the face to the height above where they ended: into an 80 degree rock face at 14 m/s
       that was 0.6 m inside it, then 0.6 m up it) */
    if (dt && h - this.p.y > 0.25) { this.com.x -= this.v.x * dt; this.com.z -= this.v.z * dt; this.p.x -= this.v.x * dt; this.p.z -= this.v.z * dt; h = Math.min(h, height(this.p.x, this.p.z)); }
    const dy = Math.max(0, h + 0.004 - this.p.y); this.p.y += dy; this.com.y += dy;
    if (this.v.y < 0) this.v.y *= 0.6;
    if (vn < 0) this.v.addScaledVector(nh, -vn * 1.1);
    // (the rotation the takeoff gave stops against the face, and the rider rights themselves: it kept turning them on
    // over and over as they slid down a steep side, until they came down on their head)
    this.wNat.set(0, 0, 0); this.wallOff = true;
    const vt = this.v.clone().addScaledVector(nn, -this.v.dot(nn));
    this.v.addScaledVector(vt, -Math.min(1, 1.2 * (1 / 120)));
    if (this.held) { this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() }); this.held = null; }
    this.grab = null; this.pose = null;
  }
  /* a little landing pull (2026-11-05, for "a little bit of like a magnetic correction to the correct landing ... but
     not too much"): in the last PULL.T seconds before the snow, a body within PULL.max of a clean landing (skis along the
     travel, either way round, and flat to the snow there) is turned towards it, at most PULL.rate, fading out between
     PULL.full and PULL.max; further off, nothing. Only the attitude is moved, not the rotation the rider has going. */
  landPull(dt) {
    if (this.wallOff) return;
    const gap = this.p.y - height(this.p.x, this.p.z);
    if (this.v.y > 0 && gap > 0.4) { this.pullPr = null; return; }
    // the time to the snow: a quick guess each step, the full prediction (it walks the flight) only near the end
    this.pullN = (this.pullN || 0) + 1;
    if (!this.pullPr || this.pullN % 3 === 0) {
      const vy = this.v.y, Tq = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * Math.max(0, gap)))) / G;
      this.pullPr = Tq > 1.5 ? null : this.predictLanding();
    } else this.pullPr.T -= dt;
    const pr = this.pullPr; if (!pr || pr.T > PULL.T) return;
    const n = pr.n, vt = _v.copy(this.v).addScaledVector(n, -this.v.dot(n));
    if (vt.lengthSq() < 1) return;
    vt.normalize();
    const fw = _f.set(0, 0, 1).applyQuaternion(this.q);
    if (fw.dot(vt) < 0) vt.negate();                       // riding out switch is as clean as forwards
    const left = _n2.crossVectors(n, vt).normalize();
    _m.makeBasis(left, n, vt); _q.setFromRotationMatrix(_m);
    const th = this.q.angleTo(_q);
    if (th > PULL.max || th < 1e-4) return;
    const k = 1 - smoothstep(PULL.full, PULL.max, th);
    this.q.rotateTowards(_q, Math.min(PULL.rate, th * PULL.k) * k * dt);
  }
  bestMod() { let best = '', t = 0.12; for (const m in this.modT || {}) if (m && this.modT[m] >= t) { best = m; t = this.modT[m]; } return best; }
  // where and when a flight from here meets the snow, and the snow's normal there
  predictLanding() {
    let x = this.p.x, y = this.p.y + 0.02, z = this.p.z, vx = this.v.x, vy = this.v.y, vz = this.v.z;
    const dt = 1 / 60;
    for (let t = dt; t < 6; t += dt) {
      vy -= G * dt; x += vx * dt; y += vy * dt; z += vz * dt;
      if (t > 0.05 && y <= height(x, z)) return { T: t, n: normalBehind(x, z, vx, vz, new THREE.Vector3()), x, z };
    }
    return null;
  }

  land(h) {
    const n = normal(this.p.x, this.p.z, this.n);
    const up = this.up, fwd = this.fwd;
    const vt = this.v.clone().addScaledVector(n, -this.v.dot(n));
    const vn = -this.v.dot(n);
    /* (landing upright on a kicker's or a landing's side, the knees and edges take up to 20 degrees of the snow's sideways
       tilt: the skis go onto their edges. Only the part between the body and the true vertical; on flat snow a body
       rolled over gets nothing, 2026-11-05) */
    const upP = _v.copy(up).addScaledVector(fwd, -up.dot(fwd)), nP = _w.copy(n).addScaledVector(fwd, -n.dot(fwd));
    const roll = Math.atan2(_n2.crossVectors(upP, nP).dot(fwd), upP.dot(nP));
    const vP = _f.set(0, 1, 0).addScaledVector(fwd, -fwd.y), rollV = Math.atan2(_n2.crossVectors(vP, nP).dot(fwd), vP.dot(nP));
    const give = roll * rollV > 0 ? clamp(roll, -Math.min(0.35, Math.abs(rollV)), Math.min(0.35, Math.abs(rollV))) : 0;
    const aUpRaw = up.angleTo(n) * 180 / Math.PI;
    const aUp = up.clone().applyAxisAngle(fwd, give).angleTo(n) * 180 / Math.PI;
    let aDir = 0, sw = this.sw;
    if (vt.length() > 1) {
      vt.normalize();
      const fa = fwd.clone().addScaledVector(n, -fwd.dot(n)).normalize();
      const d = fa.dot(vt);
      aDir = Math.acos(clamp(Math.abs(d), -1, 1)) * 180 / Math.PI;
      sw = d < 0;
    }
    const grabbing = !!this.grab;
    let q = 'clean';
    // (a landing crashes only on the body: more than 65 degrees off the snow's normal, or into it at 16 m/s; landed
    // sideways, however far, the skis just skid it out (sketchy). It was 52 degrees, 50 off the travel and 13.5 m/s,
    // which with no landing help went down too often, 2026-11-03)
    if (aUp > 65 || vn > 16) q = 'crash';
    else if (aUp > 34 || aDir > 30 || grabbing || this.pose || vn > 11.5) q = 'sketchy';
    if (this.shiftyT > 0.15) { this.events.push({ type: 'shifty', dir: this.shiftDir, t: this.shiftyT }); this.shiftyT = 0; }
    // (X: the extra rides: landed with a part of the vehicle still on its way round. Nearly round (or barely started) it
    // is sketchy; anywhere between, the deck or the bars are across the rider's feet or hands, and that is a crash)
    if (this.act) {
      const u = this.actT / this.actDur, done = u >= 5 / 6;
      if (!done && u > 1 / 6) q = 'crash'; else if (q === 'clean') q = 'sketchy';
      this.events.push({ type: 'act', id: this.act, n: this.actN + (done ? 1 : 0), at: this.actAt, cut: true });
      this.actStop();
    }
    // (P) the landing, for the poses: how hard, the travel's angle off the skis (signed, + to the right), the body's off the snow
    this.landHit = clamp(vn / 14, 0, 1); this.landUp = aUp * Math.PI / 180; this.landOff = 0;
    if (vt.lengthSq() > 0.5) { const fs = fwd.clone().addScaledVector(n, -fwd.dot(n)).normalize(); if (sw) fs.negate(); this.landOff = cwAngle(fs, vt, n); }
    const into = q !== 'crash' ? this.landInto : null; this.landInto = null;
    this.events.push({ type: 'land', q, aUp, aUpRaw, aDir, vn, sw, wasSw: this.sw, tAir: this.tAir, into: into || undefined });
    if (this.held) { this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() }); this.held = null; }
    this.grab = null; this.pose = null; this.tweak = ''; this.shift = 0;
    this.p.y = h;
    if (q === 'crash') { this.crash('land'); return; }
    this.sw = sw;
    const fa = fwd.clone().addScaledVector(n, -fwd.dot(n)).normalize();
    this.f.copy(fa);                   // the heading is the skis' forward, travel is opposite when switch
    this.v.addScaledVector(n, -this.v.dot(n));
    const loss = q === 'sketchy' ? 0.72 : Math.max(0.86, 1 - vn * 0.012);
    this.v.multiplyScalar(loss);
    // the rider keeps facing where they landed; the snow sends them along their skis instead: most of the travel
    // across the skis is lost as they bite (more is kept on a sketchy landing, which skids out)
    if (vt.length() > 0.5) {
      const along = this.v.dot(fa), across = this.v.clone().addScaledVector(fa, -along);
      this.v.copy(fa).multiplyScalar(along).addScaledVector(across, q === 'clean' ? 0.3 : 0.55);
    }
    // (landed across the skis: this slide is left to skid out; see stepGround's no drift)
    this.landSkid = this.v.clone().addScaledVector(fa, -this.v.dot(fa)).length() > 0.8;
    this.lastSpinDir = Math.sign(this.w.dot(up)) || this.lastSpinDir || 1;
    this.w.set(0, 0, 0);
    this.state = 'ground'; this.tState = 0; this.landT = 0; this.revertLeft = 0; this.edgeV = 0;
    // the knees take the landing: bent as far as the impact asks, then the legs straighten slowly (no rebound)
    this.absorb = clamp(0.08 + vn * 0.045, 0.1, 0.6) * (q === 'sketchy' ? 1.2 : 1);
    this.lastLanding = { q, vn, t: 0 };
    /* (P, 2026-11-08, for "holding S or N as you land lands straight into that butter or press and rides it out"): held
       through the touchdown, the press is on at once (no ease), and it rides out on the butter's own physics */
    if (into) { this.press = into === 'nose' ? 1 : -1; if (into === 'lazy') { this.lazy = 1; this.lazyT = 0.001; this.seq('lazy'); } else this.seq('butter'); this.landSkid = false; }
    this.groundQ();
  }

  // trees: a trunk met at speed is a crash; slowly, it stops you and you slide round it
  treeHit() {
    if (!this.trees) return false;
    const h = this.trees.hit(this.p.x, this.p.z, 0.3);
    if (!h || this.p.y > h.t.y + h.t.s * 0.95) return false;
    const vn = this.v.x * -h.nx + this.v.z * -h.nz;
    if (vn > 7) { this.v.multiplyScalar(0.2); this.v.x += h.nx * 2; this.v.z += h.nz * 2; this.crash('tree'); return true; }
    this.p.x = h.t.x + h.nx * h.R; this.p.z = h.t.z + h.nz * h.R;
    if (vn > 0) { this.v.x += h.nx * vn; this.v.z += h.nz * vn; }
    return false;
  }

  // ---- rails and boxes ----------------------------------------------------------------------------------------------
  /* (R, round 12, for "make it so that for leonski the rails are not magnetic and set you in a certain direction but
     rather you have flow on the rails, like if you jump on and do a 270 you ride on the rail in the ending position of
     the 270 like ice and if you press a or d on the rail you shift your body weight to the corresponding side and can go
     off the rail that way") A rail or box is a slippery top, not a guide. Nothing pulls a rider onto it, turns them on it
     or sets them into a 50-50 or a slide:
     - on: only where the skis (the board, the deck, the sled) really come down onto its top with the top under their
       footprint (railReach: the footprint's half extent across the rail's line at the angle they are turned, half a flat
       top's width, and 2 to 8 cm of fairness). The landing's friction (RAILP.impactMu x how hard they came down onto it)
       is all that is taken off the way they slide and their spin.
     - on it: the skis keep the angle to the rail they came on with and the spin they brought, which the base's friction
       on the top slows (mu g rC / k^2); the speed along it and across it carries on, the kinetic friction acting against
       the way the base slides, so almost none of it across: a sideways drift takes you off that side unless you shift
       your weight against it. Along a curve the rider leans and twists into it as far as the top lets them follow it
       (RAILP.guide); past that it carries them out. The turn keys twist the skis on it; let go, they go on turning
       until the friction or the other key stops them.
     - the weight: the rider keeps their centre of mass over where the top holds them (the crown of a round top, the
       part of a flat one under the skis); a weight key puts it past that side, the base tilts that way and the top
       pushes the rider over (g x how far past / its height), so held it walks you off that side and a tap corrects a
       drift.
     - off: past an end, flying on with the speed and spin they have (no turn back to the travel); off the side once the
       footprint no longer covers the top, dropping off it. */
  // the footprint's half extent across the rail's line, the skis turned a from it (m): one ski is narrower, two pressed
  // together a little
  railExt(a) { const K = this.K || KIND.ski, B = K.reachAcross * (1 - 0.6 * (this.oneFoot || 0)) * (1 - 0.15 * (this.together || 0)); return Math.abs(Math.cos(a)) * B + Math.abs(Math.sin(a)) * K.reachAlong; }
  // how far off the rail's line the footprint's middle can be with the top still under it: a round top only while its
  // crown is under the skis (a little past it on a fat tube), a flat one while any of it is
  railReach(r, a) { return this.railExt(a) + (topOf(r) === 'round' ? Math.min(0.06, r.w * 0.12) : r.w / 2) + 0.02; }
  // where the top holds the weight across it (left of its line positive, m): the crown of a round top give or take the
  // ankles' give, the part of a flat top under the gear
  railSupport(r, x, a, out) {
    if (topOf(r) === 'round') { const h = RAILP.hold[topClass(r)] || 0.02; out[0] = -h; out[1] = h; return out; }
    const e = this.railExt(a), w2 = r.w / 2; let lo = Math.max(-w2, x - e), hi = Math.min(w2, x + e);
    if (lo > hi) lo = hi = (lo + hi) / 2;
    out[0] = lo; out[1] = hi; return out;
  }
  /* (R) where the base's middle sits over the top's line (m, + up), the base x across it (left +) and tipped t about the
     way along it (+ the up towards the left): its plane rests on the top, never through it. A round top: the plane is
     tangent to it at R sin t from its crown, or, with that point beyond the base, the base's edge on its curve (level,
     that is railDrop). A flat top: the base's lower side over the top on it. (Tipped about its own middle at the crown's
     height, a base leaning to its side on a box cut 2 to 4 cm into it.) */
  railBaseY(r, x, t) {
    const e = this.railExt(this.railAng), tn = Math.tan(t);
    if (topOf(r) === 'round') {
      const R = r.w / 2, tx = R * Math.sin(t), cx = clamp(tx, x - e, x + e);
      const yc = cx === tx ? -R * (1 - Math.cos(t)) : Math.abs(cx) < R ? -R + Math.sqrt(R * R - cx * cx) : -R;
      return yc - (x - cx) * tn;
    }
    const w2 = r.w / 2, lo = Math.max(-w2, x - e), hi = Math.min(w2, x + e);
    return lo > hi ? 0 : Math.max((hi - x) * tn, (lo - x) * tn);
  }
  // how fast the rail's line turns left under the travel (rad per metre): from the chords 1.5 m behind and ahead, since a
  // curved rail is pieces of about 0.8 m with a degree or two at each joint (by the pieces themselves the curve came in
  // peaks twice its mean, which threw riders off a C rail at 9 m/s that its mean holds them on at)
  railCurve(r) {
    const s = this.railS, rd = this.railDir, L = 1.5, a0 = railAt(r, s - L * rd, _rc0), a1 = railAt(r, s, _rc1), a2 = railAt(r, s + L * rd, _rc2);
    return wrapPi(Math.atan2(a2.x - a1.x, a2.z - a1.z) - Math.atan2(a1.x - a0.x, a1.z - a0.z)) / L;
  }
  railCheck() {
    if (this.state === 'rail' || this.railCooldown > 0) return false;
    for (const r of this.park.rails) {
      if (r.box.distanceToPoint(this.p) > 0.6) continue;     // (R: a slide reaches up to 1.9 m from a wide top's line, past its box)
      const c = r.closest(this.p, _rc);
      if (c.dy < -0.14 - railDrop(r, c.dh) || c.dy > 0.1) continue;
      const along = this.v.dot(c.dir);
      if (Math.abs(along) < 1.2) continue;
      // (going across it at more than about 45 degrees is going over it, not onto it)
      if (Math.abs(this.v.x * c.dir.x + this.v.z * c.dir.z) < 0.7 * Math.hypot(this.v.x, this.v.z) * Math.hypot(c.dir.x, c.dir.z)) continue;
      // coming up at it from below is the rail's side, not its top
      const vRel = this.v.y - c.dir.y * along;
      if (c.dy < -0.02 && vRel > 0.6) continue;
      // (R: the skis come down onto it, not the body: more than 60 degrees off upright, it is not a landing on it)
      if (this.state === 'air' && _v.set(0, 1, 0).applyQuaternion(this.q).y < 0.5) continue;
      const dH = _v.set(c.dir.x, 0, c.dir.z).normalize().multiplyScalar(Math.sign(along));
      const fw = _f.set(0, 0, 1).applyQuaternion(this.q); fw.y = 0; if (fw.lengthSq() < 1e-4) continue; fw.normalize();
      const ang = -cwAngle(dH, fw, UP);                   // + = skis turned left of the travel along the rail
      /* (P, 2026-11-08, for fair lock-ons at the ends) past an end of it, how far past along its line (out) and how far
         beside it (across): the skis reach along the line as well as across it, so coming down with the feet just
         before its start and the tips over it locks on there; past a short feature's far end (a stump), the tails over
         it, too (a tap); past a long rail's far end, flying on, never (that grabbed riders landing beyond the end) */
      let across = c.dh, past = 0;
      const atEnd = c.t <= 0 && c.seg === r.seg[0] ? -1 : c.t >= 1 && c.seg === r.seg[r.seg.length - 1] ? 1 : 0;
      if (atEnd) {
        const g = c.seg, e = atEnd < 0 ? g.a : g.b, hl = Math.hypot(g.d.x, g.d.z) || 1, ux = g.d.x / hl * atEnd, uz = g.d.z / hl * atEnd;
        past = (this.p.x - e.x) * ux + (this.p.z - e.z) * uz;
        if (past > 0.02) {
          const onto = atEnd * along < 0, tip = Math.abs(Math.cos(ang)) * this.K.reachAlong + Math.abs(Math.sin(ang)) * this.K.reachAcross;
          if (!(onto || r.len < 2) || past > tip * 0.85) continue;
          // (over the line carried on past the end, not the end's own height: a steep rail's line rises before its start)
          const dyX = this.p.y - railAt(r, atEnd < 0 ? -past : r.len + past, _rp).y;
          if (dyX < -0.14 || dyX > 0.1) continue;
          across = Math.abs((this.p.x - e.x) * uz - (this.p.z - e.z) * ux);
        } else past = 0;
      }
      // (R, round 12: only where the top is under the footprint; it reached 0.28 m or more past it, and a pull brought
      // riders in from 0.3 to 0.6 m further: railPull is gone)
      if (across > this.railReach(r, ang)) continue;
      const leftH = new THREE.Vector3(dH.z, 0, -dH.x);
      const off = (this.p.x - c.x) * leftH.x + (this.p.z - c.z) * leftH.z;
      this.lockRail(r, c, along, ang, off, leftH, atEnd * past);
      return true;
    }
    return false;
  }
  // a rail or box is solid below its top: ridden into from the side or the front, it pushes you away (hard, a crash)
  railBump() {
    if (this.railCooldown > 0) return false;
    for (const r of this.park.rails) {
      if (!r.box.containsPoint(this.p)) continue;
      const c = r.closest(this.p, _rc);
      const half = r.w / 2 + 0.14;
      if (c.dy > -0.22 || c.dh >= half) continue;
      // (in front of its start or past its end there is nothing: only the end itself is solid. A rainbow starting at a
      // lip crashed every rider coming up the ramp 0.4 m before it, 2026-11-05)
      if ((c.t <= 0 && c.seg === r.seg[0]) || (c.t >= 1 && c.seg === r.seg[r.seg.length - 1])) {
        const e = c.t <= 0 ? c.seg.a : c.seg.b, out = ((this.p.x - e.x) * c.seg.d.x + (this.p.z - e.z) * c.seg.d.z) / Math.max(0.2, Math.hypot(c.seg.d.x, c.seg.d.z)) * (c.t <= 0 ? -1 : 1);
        if (out > 0.06) continue;
      }
      let nx = this.p.x - c.x, nz = this.p.z - c.z, l = Math.hypot(nx, nz);
      if (l < 1e-3) { nx = -this.v.x; nz = -this.v.z; l = Math.hypot(nx, nz) || 1; }
      nx /= l; nz /= l;
      const vn = this.v.x * nx + this.v.z * nz;
      if (vn < -8.5) { this.v.multiplyScalar(0.3); this.crash('rail'); return true; }
      const dx = c.x + nx * half - this.p.x, dz = c.z + nz * half - this.p.z;
      this.p.x += dx; this.p.z += dz; if (this.state === 'air') { this.com.x += dx; this.com.z += dz; }
      if (vn < 0) { this.v.x -= nx * vn * 1.1; this.v.z -= nz * vn * 1.1; }
    }
    return false;
  }
  lockRail(r, c, along, ang, off, leftH, past = 0) {
    const wasAir = this.state === 'air', kind = RAILP.k2[this.kind] ? this.kind : 'ski';
    this.rail = r; this.railS = c.s; this.railDir = Math.sign(along);
    // (locked on past an end: the ride starts there, carried on along its line, and ends there going back that way)
    if (past) this.railS = past < 0 ? past : r.len + past;
    this.railLo = Math.min(0, this.railS - 1e-3); this.railHi = Math.max(r.len, this.railS + 1e-3);
    this.railAng = wrapPi(ang);
    /* (R) what the rider brings onto it: the speed along it and across it, and the spin about the rail's up (from the
       air the body's; from the snow the skis' turn). The landing takes the friction's impulse off both: static friction
       (a ski base on steel, 0.17 to 0.20) times how hard the skis came down onto the top, against the way the base slides,
       and the same impulse's twist against the spin (it acts as far from the feet as the load sits, rC). */
    const d = c.dir, nUp = _rn.copy(UP).addScaledVector(d, -d.y); if (nUp.lengthSq() < 1e-6) nUp.set(0, 1, 0); nUp.normalize();
    const vImp = Math.max(0, -this.v.dot(nUp));
    let vAl = Math.abs(along), vLat = this.v.x * leftH.x + this.v.z * leftH.z, w = wasAir ? this.w.dot(nUp) : -(this.turnRate || 0);
    const imp = RAILP.impactMu * vImp, vs = Math.hypot(vAl, vLat);
    if (vs > 1e-4) { const k = Math.max(0, 1 - imp / vs); vAl *= k; vLat *= k; }
    const dw = imp * RAILP.rC[kind] * (topOf(r) === 'round' ? 1 : 1.4) / RAILP.k2[kind];
    w = Math.sign(w) * Math.max(0, Math.abs(w) - dw);
    this.railV = Math.max(0.5, vAl); this.railOffV = vLat; this.railOff = off; this.railAngV = w;
    // (the weight across it: where the body's middle is over the feet as they meet it)
    this.railLean = clamp(this.comH() * _v.set(0, 1, 0).applyQuaternion(this.q).dot(leftH), -RAILP.leanShift, RAILP.leanShift); this.railLeanV = 0; this.railKeyDir = 0;
    this.railTilt = 0; this.railPos = 0;
    this.railLock = lockOf(this.railAng); this.railCand = this.railLock; this.railCandT = 0;
    this.railDevSum = 0; this.railDevT = 0;
    this.setRailMode();
    this.balance = 0;
    this.state = 'rail'; this.tState = 0;
    this.grab = null; this.pose = null; this.tweak = ''; this.actStop();
    if (this.held) { this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() }); this.held = null; }
    this.railPress = 0; this.railPressAcc = 0; this.railBack = false; this.railOneT = 0; this.pushing = 0; this.pushT = 0; this.skateT = 0; this.unbutter = false;
    // (at: where the skis meet it, dir: the way along it you go, impact: how hard you came down onto it, m/s)
    this.railHitT = 0; this.railHit = 'on'; this.railHitDir = 0; this.seq('rail');
    this.events.push({ type: 'railOn', rail: r, mode: this.railMode, sw: this.railSw, fromAir: wasAir, ang: this.railAng, kind: r.kind, at: new THREE.Vector3(c.x, c.y, c.z),
      speed: this.railV, impact: vImp, dir: c.dir.clone().multiplyScalar(this.railDir) });
    /* (H, round 10, for "improve the rail mechanics": nothing snaps as the skis meet it) The lock is made a few
       centimetres over the top (up to 0.1 m, where a falling rider is first close enough) or just under it; the feet were
       set onto the top in one step (8 cm median, up to 32 in a test of every rail), and the body turned square to the
       rail in one step too (18 degrees median, up to 43). Now the skis carry on down onto it at the speed they came in
       with (at least 1.5 m/s; up from under it at 3 m/s), and the body turns onto the rail over about a tenth of a
       second (railDy, railEase: stepRail, setRailQ). (R: only its tilt now: the skis' turn on it is the one they had.) */
    const topY = past ? railAt(r, this.railS, _rp).y : c.y;
    this.railDy = clamp(this.p.y - (topY - railDrop(r, off - footOff(this, off))), -0.15, 0.12);
    this.railDyV = Math.max(1.5, vImp);
    this.railEase = 0.12;
    this.setRailQ(false, 1 / 120);
  }
  setRailMode() {
    const s = Math.abs(Math.sin(this.railLock)), c = Math.cos(this.railLock);
    this.railMode = s > 0.7 ? 'slide' : '5050';
    this.railSw = this.railMode === '5050' && c < 0;
    this.railFace = this.railMode === 'slide' ? Math.sign(Math.sin(this.railLock)) : 1;
  }
  /* the rider's frame on the rail: the skis turned railAng from the way along it, their bases on its top. (H, round 10)
     The bases lie along the rail's own slope now, a down rail's, a box set on the hill, a tube up a kicker: the frame was
     kept level, so on every sloped feature the skis went into it at one end (13 cm into the Jump Line's flat boxes, which
     follow the hill, 15 cm into the kicker tubes) and the body stood plumb instead of square to it, as it rides the snow.
     As on the snow, the rig's pose keeps the body over its feet against the push it feels.
     (R, round 12) tipped about the way along the rail by railTilt (the base tilted under the weight) instead of leaning
     about the skis' own length, which in a slide leaned the body along the rail. */
  setRailQ(now, dt = 1 / 120) {
    // (the way along it at s, blended over 0.3 m either side of a joint between its pieces: a rainbow or a kink turns the
    // body over a short way instead of a few degrees at once at each joint)
    const r = this.rail, s = this.railS, d = _rd.copy(r.dirAt(s - 0.3)).add(r.dirAt(s + 0.3));
    if (d.lengthSq() < 1e-6) d.copy(r.dirAt(s)); d.normalize().multiplyScalar(this.railDir);
    const n = _rn.copy(UP).addScaledVector(d, -d.y); if (n.lengthSq() < 1e-6) n.set(0, 0, 1); n.normalize();   // (square to the rail, as near up as it can be)
    if (this.railTilt) n.applyAxisAngle(d, -this.railTilt);                 // (+ tips the up towards the rail's left)
    const fwd = _rf.copy(d).applyAxisAngle(n, this.railAng);
    const left = _rl.crossVectors(n, fwd).normalize();
    _m.makeBasis(left, n, _rx.crossVectors(left, n));
    _q.setFromRotationMatrix(_m);
    // (just locked on: turned onto the rail over about a tenth of a second rather than at once)
    if (now) this.q.copy(_q); else this.q.slerp(_q, this.railEase > 0 ? 1 - Math.exp(-dt / 0.03) : 0.5);
  }
  stepRail(dt, I) {
    const r = this.rail, kind = RAILP.k2[this.kind] ? this.kind : 'ski';
    const d = r.dirAt(this.railS);
    const gAlong = -G * d.y * this.railDir, gN = G * Math.sqrt(Math.max(0, 1 - d.y * d.y));   // gravity along the travel, the top's load
    const round = topOf(r) === 'round', cls = topClass(r);
    // (R) the friction: kinetic, against the way the base slides over the top; a base sliding across itself (a slide)
    // drags a little more than one sliding along itself (a 50-50)
    const sa = Math.sin(this.railAng), mu = (r.mu || RAIL_MU[r.kind] || 0.075) * (1 + RAILP.sideMu * sa * sa);
    const vs = Math.hypot(this.railV, this.railOffV) || 1e-6;
    this.railV += (gAlong - mu * gN * this.railV / vs - 0.004 * this.railV * this.railV) * dt;
    /* (P, 2026-11-08) stopped going up a rail or box: gravity takes you back down it, riding it the other way round (the
       skis as they were), instead of dropping off it through the box onto the snow under it. Stopped on the level: off. */
    if (this.railV < 0.4 && gAlong < -0.8 && !this.railBack) {
      this.railDir = -this.railDir; this.railV = 0.4; this.railBack = true;
      // (R: the sides swap with the way along it: left of the travel is now the other side)
      this.railOff = -this.railOff; this.railOffV = -this.railOffV; this.railLean = -this.railLean; this.railLeanV = -this.railLeanV; this.railKeyDir = 0;
      this.railAng = wrapPi(this.railAng + Math.PI); this.railLock = lockOf(this.railAng); this.railCand = this.railLock; this.setRailMode();
      this.events.push({ type: 'railBack' });
    }
    if (this.railV < 0.4) { this.leaveRail(dt, 0.5, this.railAngV, 'stall'); return; }
    this.railS += this.railV * this.railDir * dt;
    /* (R) the turn on it: held, a turn key twists the skis round on the top towards RAILP.turn (+ turns them left, as
       the left key does); let go, the spin goes on and the base's friction on the top slows it, mu g rC / k^2 (the load
       rC from the feet, k the rider's radius of gyration about the up). No position is ever settled into. */
    const tIn = -clamp(I.steer || 0, -1, 1), k2 = RAILP.k2[kind], rC = RAILP.rC[kind] * (round ? 1 : 1.4);
    if (Math.abs(tIn) > 0.15) { const tgt = tIn * RAILP.turn; this.railAngV += clamp(tgt - this.railAngV, -RAILP.turnAcc * dt, RAILP.turnAcc * dt); }
    else { const fr = mu * gN * rC / k2 * dt; this.railAngV = Math.abs(this.railAngV) <= fr ? 0 : this.railAngV - Math.sign(this.railAngV) * fr; }
    this.railAng = wrapPi(this.railAng + this.railAngV * dt);
    // the position it is in, for the name and the board's words: counted once the skis are clearly in a new one (within
    // 35 degrees of it) for a moment (a quick turn through a slide is one swap, not two)
    const lk = lockOf(this.railAng), inZone = Math.abs(wrapPi(this.railAng - lk)) < 0.61;
    if (lk !== this.railCand) { this.railCand = lk; this.railCandT = 0; } else if (inZone) this.railCandT += dt;
    if (this.railCand !== this.railLock && this.railCandT > 0.12) {
      const from = this.railLock; this.railLock = this.railCand; this.setRailMode();
      const through = wrapPi(from + wrapPi(this.railLock - from) / 2);
      const turn = Math.sign(wrapPi(this.railLock - from));
      this.railHitT = 0; this.railHit = 'swap'; this.railHitDir = turn; this.seq('swap');
      this.events.push({ type: 'railSwap', from, to: this.railLock, mode: this.railMode, front: Math.cos(through) > 0, dir: d.clone().multiplyScalar(this.railDir), turn, kind: r.kind, at: r.at(this.railS).clone() });
      this.railDevT = -1;                                   // (the first position's angle is all the name looks at)
    }
    if (this.railDevT >= 0) { this.railDevSum += Math.abs(wrapPi(this.railAng - this.railLock)) * dt; this.railDevT += dt; }
    /* (P, 2026-11-08) R held: on one ski (the one over the rail: the side the body is off it to, else the last turn key),
       balanced over that ski with less to stand on and a sway of its own; E held: the skis pressed together, steadier */
    if (I.oneFoot && this.oneFoot < 0.05) { this.oneSide = Math.abs(this.railOff) > 0.03 ? Math.sign(this.railOff) : (this.lastSteer || this.oneSide); this.seq('oneFoot'); }
    if (Math.abs(I.steer || 0) > 0.3) this.lastSteer = Math.sign(I.steer);
    this.oneFoot += ((I.oneFoot ? 1 : 0) - this.oneFoot) * Math.min(1, dt * 7);
    this.together += ((I.together && !I.oneFoot ? 1 : 0) - this.together) * Math.min(1, dt * 7);
    const of1 = this.oneFoot, tg = this.together;
    /* (R) across it. The weight: kept over where the top holds it (railSupport) by the rider's balance, or with a weight
       key (+1 right, -1 left, as seen along the way you go) put RAILP.shift past that side of it. The weight past the
       hold tips the base that way and the top pushes the rider across (g x how far past / the weight's height). The
       curve: followed as far as the top lets a rider lean into it (RAILP.guide), past that it carries them out. And the
       kinetic friction's share across the way the base slides. */
    const x = this.railOff, reach = this.railReach(r, this.railAng), comH = Math.max(0.4, this.comH());
    const need = this.railCurve(r) * this.railV * this.railV, gMax = RAILP.guide[cls], got = clamp(need, -gMax, gMax);
    const u = clamp(I.weight || 0, -1, 1), sup = this.railSupport(r, x, this.railAng, _sup);
    // (the rider sees a drift coming: the weight is moved ahead of it by as much as the spring lags it, 2 / kL x the drift,
    // so a steady drift neither grows nor shrinks by itself; without it a drift on a round top grew by half in a second)
    const kL = RAILP.leanK * (1 + 0.35 * tg), uD = u > 0.2 ? 1 : u < -0.2 ? -1 : 0;
    let lT;
    if (uD) {
      /* a weight key: the weight is put over that way, RAILP.shift past the hold on that side of where the feet are as it
         is pressed, and held there over the feet while the key is: the whole rider then goes that way, faster as the weight
         gets further past the top (kept past the top instead, the feet were drawn sliding out under a body leaning back) */
      if (uD !== this.railKeyDir) { this.railKeyDir = uD; this.railKeyLean = clamp((uD > 0 ? sup[0] - RAILP.shift : sup[1] + RAILP.shift) - x, -RAILP.leanShift, RAILP.leanShift); }
      lT = this.railKeyLean;
    } else { this.railKeyDir = 0; lT = clamp((sup[0] + sup[1]) / 2 - x - 2 / kL * this.railOffV, -RAILP.lean, RAILP.lean); }
    if (of1 > 0.05) lT += of1 * 0.035 * Math.sin(this.tState * 4.7 + 1.3 * Math.sin(this.tState * 1.9));   // (one ski: a sway of its own)
    this.railLeanV += (kL * kL * (lT - this.railLean) - 2 * kL * this.railLeanV) * dt;
    this.railLean += this.railLeanV * dt;
    const cm = x + this.railLean, past = cm - clamp(cm, sup[0], sup[1]);
    const ax = G * past / comH - need + got - mu * gN * this.railOffV / vs;
    this.railOffV += ax * dt;
    this.railOff += this.railOffV * dt;
    /* (for the pose, the HUD and the others: balance, the body's lean, + to the right: the weight over the feet and the lean
       into a curve the top holds them to; railPos, the skis' place across it, + right; railTilt, the base tipped under the
       weight, + towards the left, at most 7 degrees. The lean into a curve is the body's: tipped with the base, a slide's
       0.7 m reach either side of the top swung the skis' ends 30 cm up and down where an S rail turns the other way) */
    this.balance = clamp((-this.railLean - comH * got / G) / RAILP.leanShift, -1.2, 1.2);
    this.railPos = clamp(-this.railOff / reach, -1.2, 1.2);
    this.railTilt = clamp(0.55 * this.railLean / comH, -0.12, 0.12);
    this.railPress += ((I.butter ? I.press : 0) - this.railPress) * Math.min(1, dt * 8);
    if (Math.abs(this.railPress) > 0.35) { if (!this.railPressAcc) this.seq('press'); this.railPressAcc += Math.sign(this.railPress) * dt; }
    if (this.oneFoot > 0.5) this.railOneT = (this.railOneT || 0) + dt;
    this.crouch += ((I.crouch ? 0.8 : 0.36 + 0.1 * Math.abs(this.railPress)) - this.crouch) * Math.min(1, dt * 8);
    // (H, round 10: the step that leaves the rail still carries the rider on: it left them where the last step had put
    // them, a stop of one step, 8 cm at 10 m/s, a judder at every rail's end)
    // (across it by the way along it blended over 0.3 m either side, as the frame is: by each piece's own, a skis' reach
    // across it jumped sideways at every joint of a curved rail)
    const db = _rd.copy(r.dirAt(this.railS - 0.3)).add(r.dirAt(this.railS + 0.3));
    const dH = _v.set(db.x, 0, db.z); if (dH.lengthSq() < 1e-8) dH.set(d.x, 0, d.z); dH.normalize().multiplyScalar(this.railDir); const leftH = _rl2.set(dH.z, 0, -dH.x);
    this.v.copy(d).multiplyScalar(this.railV * this.railDir).addScaledVector(leftH, this.railOffV);
    /* off the side: the top no longer under the footprint. Off a round top the base slips on round its side: its edge
       leaves the crown going outwards at least sqrt(g R) (R the top's radius), the least that keeps it clear of the side
       as it drops (dropped straight down, the inner ski went down through the rail: 600 frames in a test of every rail) */
    if (Math.abs(this.railOff) > reach) {
      if (round) { const sg = Math.sign(this.railOff) || 1, vo = sg * Math.max(sg * this.railOffV, 1.05 * Math.sqrt(G * r.w / 2)) - this.railOffV; this.v.addScaledVector(leftH, vo); }
      this.events.push({ type: 'railFall' }); this.p.addScaledVector(this.v, dt); this.leaveRail(dt, 0, this.railAngV, 'fall'); return;
    }
    if (this.railS < (this.railLo ?? 0) || this.railS > (this.railHi ?? r.len)) { this.p.addScaledVector(this.v, dt); this.leaveRail(dt, 0.6, this.railAngV, 'end'); return; }
    const pt = railAt(r, this.railS, _rp);
    this.p.copy(pt).addScaledVector(leftH, this.railOff); this.p.y += this.railBaseY(r, this.railOff, this.railTilt);
    // (H: the skis carrying on down onto the top as they locked on, or up onto it from just under it: lockRail)
    if (this.railDy) { this.railDy = this.railDy > 0 ? Math.max(0, this.railDy - this.railDyV * dt) : Math.min(0, this.railDy + 3 * dt); this.p.y += this.railDy; }
    if (this.railEase > 0) this.railEase -= dt;
    this.setRailQ(false, dt);
    if (!I.crouch && this.crouchT > 0.06) { this.crouchT = 0; this.leaveRail(dt, this.popFor(this.railV) * 0.85 * (1 - 0.1 * this.oneFoot), this.railAngV, 'pop'); this.windup = 0; return; }
    if (I.crouch) this.crouchT += dt;
    else this.crouchT = 0;
  }
  leaveRail(dt, pop, spin, how) {
    // a press held for at least 0.4 s of the ride counts, whether or not it is still held at the end
    const pa = this.railPressAcc || 0;
    const hop = how === 'pop' && this.rail && (this.railDir > 0 ? this.rail.len - this.railS : this.railS) > 2.5;
    // (R: dev, how far on average the skis were from the position they first rode, for the name: "Diagonal" past 25 degrees)
    const dev = this.railDevT > 0.05 ? this.railDevSum / this.railDevT * 180 / Math.PI : 0;
    this.events.push({ type: 'railOff', how, press: Math.abs(pa) >= 0.4 ? Math.sign(pa) : 0, kind: this.rail ? this.rail.kind : '', rail: this.rail, one: (this.railOneT || 0) >= 0.4, dev, ang: this.railAng });
    { const T0 = this.lastTakeoff, d = this.rail ? this.rail.dirAt(this.railS) : UP; T0.pop = clamp(pop / 3.4, 0, 1); T0.crouch = this.crouch; T0.speed = this.railV; T0.pitch = Math.asin(clamp(d.y * this.railDir, -1, 1)); T0.t = 0; T0.how = 'rail'; }
    this.airSeq.length = 0; this.seqKeys = 0; this.landInto = null;
    this.rail = null; this.railCooldown = 0.25;
    this.state = 'air'; this.tState = 0; this.tAir = 0; this.lateCharge = false;
    this.v.y += pop;
    this.com.copy(this.p).addScaledVector(this.up, this.comH());
    /* (R, round 12) the skis go on as they were: no turn back to the travel off a slide (that was unslide, a quarter turn
       in about a sixth of a second), and the spin they had on the rail carries on (a turn key held as they leave winds
       one up). back: how far the skis are from along the travel either way round, for the name of a spin out of it. */
    const ang = this.railAng, back = Math.min(Math.abs(wrapPi(ang)), Math.abs(wrapPi(ang - Math.PI)));
    this.unslide = 0;
    this.w.copy(this.up).multiplyScalar(spin);
    // (riding off the end of a rail into a steep landing, or popping off, the body turns to meet the landing as off a
    // lip: it stayed upright, and every tube on the Jump Line set the rider down 34 degrees off, 2026-11-03; a fall off
    // the side is left as it is) (R: only its pitch and roll, never its heading)
    // (a stall, slowed to a stop going up a rail, just steps off it: turned to meet the snow below as off a lip, a sled
    // stalled on the Jump Line's tubes went over onto its back, P 2026-11-05)
    this.natural = how === 'fall' || how === 'stall' || hop ? 0 : this.naturalTurn();
    /* (H, round 10) on a sloped rail the body is square to it (setRailQ), so out of a slide it is leaned over along the
       rail's slope, a turn about its own forward way that naturalTurn does not look at: through the flight it rights
       itself to the landing's slope that way too (a slide off a tube up a kicker came down 25 degrees over, and crashed) */
    if (how !== 'fall' && how !== 'stall' && !hop) {
      const pr = this.predictLanding();
      if (pr) {
        const up = this.up, fw = this.fwd, u1 = up.clone().addScaledVector(fw, -up.dot(fw)), n1 = pr.n.clone().addScaledVector(fw, -pr.n.dot(fw));
        const a2 = Math.atan2(_rx.crossVectors(u1, n1).dot(fw), u1.dot(n1));
        if (Math.abs(a2) < 1.4) this.w.addScaledVector(fw, a2 / Math.max(0.3, pr.T * 0.92));
      }
    }
    this.wNat.copy(this.w); this.wKeys.set(0, 0, 0); this.wCork = false;
    this.events.push({ type: 'takeoff', how: 'rail', sw: Math.cos(ang) < 0, speed: this.v.length(), rail: true, hop, unslide: back * 180 / Math.PI });
    this.balance = 0; this.railTilt = 0; this.railPos = 0;
    this.grab = null; this.grabT = 0; this.held = null; this.tweak = ''; this.shiftyT = 0;
  }

  // ---- crashes ------------------------------------------------------------------------------------------------------
  crash(why) {
    // (the body's middle as it goes down: the chase camera follows it through the crash; it was left wherever the last
    // flight had put it, so after a crash on the snow the camera swung away towards an old jump)
    const fromAir = this.state === 'air';
    if (!fromAir) this.com.copy(this.p).addScaledVector(this.up, this.comH());
    this.fallKind = why; this.fallT = 0; this.oneFoot = this.together = this.pushing = this.pushT = 0; this.landInto = null; this.unbutter = false;
    this.state = 'crash'; this.tState = 0; this.grab = null; this.pose = null; this.rail = null; this.tweak = ''; this.actStop(); this.flatSpin = 0; this.flatSpinOn = false;
    this.crashSpin = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    // (out of the air the body goes on turning the way it was, a flip or a spin carried into the tumble, with a little of
    // the random turn on it: a back flip that comes down on the head rolls on over onto the back)
    if (fromAir && this.w.lengthSq() > 1) this.crashSpin.multiplyScalar(0.35).addScaledVector(this.w, 0.8);
    this.events.push({ type: 'crash', why, speed: this.v.length() });
  }
  /* (p slides on the snow; q tumbles. The rig draws the body turning about its middle, its lowest part on the snow,
     2026-11-07. On the snow the body also falls over until it lies along the snow, as a body does, on its back, front
     or side: it used to settle at whatever turn the spin left it, often on its head or standing straight up, and drawn
     on the snow that stood it on its head as it slid.) */
  stepCrash(dt) {
    const h = height(this.p.x, this.p.z);
    if (this.p.y > h + 0.05) { this.v.y -= G * dt; }
    else {
      const n = normal(this.p.x, this.p.z, this.n);
      this.p.y = h;
      const vn = this.v.dot(n); if (vn < 0) this.v.addScaledVector(n, -vn * 1.35);
      const a = new THREE.Vector3(0, -G, 0); a.addScaledVector(n, -a.dot(n));
      this.v.addScaledVector(a, dt * 0.6);
      this.v.multiplyScalar(Math.max(0, 1 - dt * 2.2));
      // falling over: the body's long axis turned down onto the snow, about the snow's normal x the body's up, harder
      // the nearer it stands on its feet or its head (none lying flat); stood straight up or down, it falls the way it
      // slides; turning hard over the top already (a flip carried into the snow), on over the top rather than back.
      // The tumble carries on until the body lies along the snow, and dies away there.
      // (the body's long axis: its up, but on a sled, where the rider lies along it, its forward)
      const up = _v.set(0, (this.K || KIND.ski).com ? 0 : 1, (this.K || KIND.ski).com ? 1 : 0).applyQuaternion(this.q), un = up.dot(n), ax = _w.crossVectors(n, up);
      if (ax.lengthSq() < 4e-4) { ax.crossVectors(n, this.v); if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0); }
      ax.normalize().multiplyScalar(un * CRASH_FALL);
      if (Math.abs(un) > 0.5 && ax.dot(this.crashSpin) < 0 && this.crashSpin.lengthSq() > 2.25) ax.negate();
      this.crashSpin.multiplyScalar(Math.max(0, 1 - dt * (0.8 + 3.4 * (1 - Math.abs(un))))).addScaledVector(ax, dt);
    }
    this.p.addScaledVector(this.v, dt);
    const s = this.crashSpin.length();
    if (s > 1e-4) { _q.setFromAxisAngle(_w.copy(this.crashSpin).divideScalar(s), s * dt); this.q.premultiply(_q); }
    // the middle (for the cameras): over the snow by about the body's half thickness lying down, more standing up
    const sled = !!(this.K || KIND.ski).com, un = _v.set(0, sled ? 0 : 1, sled ? 1 : 0).applyQuaternion(this.q).dot(this.n);
    this.com.copy(this.p).addScaledVector(this.n, 0.25 + (sled ? 0.3 : 0.6) * Math.abs(un));
    if (this.tState > 2.6) this.respawn();
  }
  respawn() {
    // a safe spot about three seconds before (kept: Enter in Shredsauce Controls goes back to it, toCrash)
    const s = this.safe.length > 12 ? this.safe[this.safe.length - 12] : this.safe[0];
    this.safe.length = Math.max(0, this.safe.length - 12);
    if (s) { this.crashSpot = { p: s.p.clone(), f: s.f.clone(), v: s.v.clone(), sw: !!s.sw, at: performance.now() }; this.spawn(s.p.x, s.p.z, 0, Math.atan2(s.f.x, s.f.z)); this.v.copy(s.v).multiplyScalar(0.5); this.sw = !!s.sw; }
    else this.spawn(0, -20, 0, 0);
    this.events.push({ type: 'respawn' });
  }
  /* back to the run-in of the last crash, at the speed you had there, to try it again (mid-tumble: the spot the
     respawn is about to use). False when there has been none. */
  toCrash() {
    if (this.state === 'crash') { this.respawn(); if (this.crashSpot) this.v.copy(this.crashSpot.v); return true; }
    const c = this.crashSpot; if (!c) return false;
    this.spawn(c.p.x, c.p.z, 0, Math.atan2(c.f.x, c.f.z)); this.v.copy(c.v); this.sw = c.sw; this.safe.length = 0;
    return true;
  }
  // a session marker (Shredsauce Controls: Tab sets it, Enter goes back to it)
  setMarker() { if (this.state !== 'ground') return false; this.marker = { p: this.p.clone(), f: this.f.clone(), v: this.v.clone(), sw: this.sw, at: performance.now() }; return true; }
  toMarker() {
    const m = this.marker; if (!m) return false;
    this.spawn(m.p.x, m.p.z, 0, Math.atan2(m.f.x, m.f.z)); this.v.copy(m.v); this.sw = m.sw; this.safe.length = 0;
    return true;
  }
  /* ---- the chairlift (lift.js) ------------------------------------------------------------------------------------
     toLift(): seated on a chair. step() then leaves p, q and v alone; lift.js sets p (the point on the seat under the
     hips) and q (facing the chair's way) every frame. offLift(): set down on the snow at x, z facing yaw (radians,
     0 = down the run, +z), riding at speed. main.js ends any line of tricks when the rider sits down. */
  toLift() {
    if (this.held) { this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() }); this.held = null; }
    this.state = 'lift'; this.tState = 0;
    this.v.set(0, 0, 0); this.w.set(0, 0, 0); this.wNat.set(0, 0, 0); this.wKeys.set(0, 0, 0); this.wCork = false; this.corkAx = null;
    this.grab = null; this.pose = null; this.rail = null; this.tweak = ''; this.shift = 0; this.shiftyT = 0;
    this.edge = 0; this.edgeV = 0; this.turnRate = 0; this.brake = 0; this.press = 0; this.skate = 0; this.lazy = 0; this.lazyT = 0;
    this.brakeHead = null; this.landSkid = false; this.revertLeft = 0; this.crouchT = 0; this.crouch = 0.3; this.tuck = 0; this.absorb = 0;
    this.turnDir = 0; this.tapLeft = 0; this.sink = 0; this.unslide = 0; this.actStop(); this.flatSpin = 0; this.flatSpinOn = false;
    this.unbutter = false; this.oneFoot = this.together = this.pushing = this.pushT = 0; this.trickSeq.length = 0; this.airSeq.length = 0; this.landInto = null; this.fallKind = '';
    this.events.push({ type: 'lift' });
  }
  offLift(x, z, yaw = 0, speed = 2) {
    this.spawn(x, z, speed, yaw); this.safe.length = 0;
    this.events.push({ type: 'offLift' });
  }
}
