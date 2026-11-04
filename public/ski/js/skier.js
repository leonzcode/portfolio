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
//   rail    on a rail or box where the skis actually cross it, not pulled onto it: the skis turn on it (50-50, slide,
//           switch), the slide keeps what it came in with sideways and falls off when the skis no longer cover the rail
//   crash   tumbling to a stop, then back to a safe spot a few seconds earlier
// Frames: world +z downhill, +y up. The body frame: +Z the skis' forward, +Y up, +X the skier's left.
import * as THREE from 'three';
import { height, normal, normalBehind, surface, baseLine } from './terrain.js?v=9';
import { clamp, smoothstep } from './noise.js?v=9';

const G = 9.81, UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _n2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const COM = 0.92;            // feet to centre of mass, standing
// top rotation rates (rad/s) and how fast a held key builds them: a big jump's 1080 is about 1.1 turns a second
// Spin and flip held together make a cork: the axis is set at the lip, tipped 55 degrees from the vertical towards the
// flip (whatever the lean the kicker gave), so the rider goes head below feet once a turn, at about 1.15 turns a
// second (two turns off a big air), more with the fast spin.
// (settle: how fast a rotation the keys added dies away once let go; restSpin: how fast the spin the takeoff gave does,
// with no spin key held. There is no landing help, so letting go has to stop a spin about where it is: 2026-11-03)
export const AIR = { spin: 7.2, fastSpin: 9.6, flip: 5.2, roll: 5.0, spinAcc: 11, flipAcc: 7, rollAcc: 7, reverse: 1.35, settleSpin: 5, settleFlip: 3.5, settleRoll: 5,
  restSpin: 1.5, cork: 7.3, corkTilt: 0.96, fastK: 1.3 };
// a face too steep to stand on: a park feature's side over about 45 degrees, any slope over about 53 (never the pipe)
const WALL_PARK = 0.7, WALL_ANY = 0.6;
const isWall = (ny, surf, pipe) => !pipe && (ny < WALL_ANY || (ny < WALL_PARK && surf === 2));
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
    this.edge = 0; this.edgeV = 0; this.crouch = 0; this.tuck = 0; this.brake = 0; this.press = 0; this.skate = 0; this.skateT = 0;
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
  }
  // put the skier at x, z facing down the fall line
  spawn(x, z, speed = 0, yaw = 0) {
    this.p.set(x, height(x, z), z);
    normal(x, z, this.n);
    this.f.set(Math.sin(yaw), 0, Math.cos(yaw)); this.toTangent(this.f);
    this.v.copy(this.f).multiplyScalar(speed);
    this.state = 'ground'; this.sw = false; this.w.set(0, 0, 0); this.grab = null; this.pose = null; this.rail = null; this.tweak = ''; this.shift = 0;
    this.edge = 0; this.edgeV = 0; this.crouch = 0; this.crouchT = 0; this.tState = 0; this.butter = 0; this.press = 0; this.brake = 0; this.brakeHead = null; this.absorb = 0; this.skate = 0;
    this.windup = 0; this.turnRate = 0; this.lateCharge = false; this.revertLeft = 0; this.wNat.set(0, 0, 0); this.wKeys.set(0, 0, 0); this.wCork = false; this.landT = 9; this.unbrakeT = 9; this.corkAx = null;
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
  inPipe(x, z) { return [this.park.pipe, this.park.qp].some(pp => pp && pp.surface(x, z)); }
  // the pop: from the speed you carry, the same however long the key was held
  popFor(speed) { return clamp(2.0 + 0.08 * speed, 2.0, 3.4); }

  step(dt, I) {
    this.tState += dt;
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
    if (isWall(n.y, this.surf, this.inPipe(this.p.x, this.p.z))) { this.takeoff(dt, 0, 0, 'wall'); const nh = new THREE.Vector3(n.x, 0, n.z).normalize(); this.v.addScaledVector(nh, 0.3); return; }
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
    // steering: the mouse scheme asks for a direction, the keys for a turn
    let u = I.steer;
    if (this.mouseTarget && !I.brake) {
      const want = _v.copy(this.mouseTarget); want.addScaledVector(n, -want.dot(n)).normalize();
      const tr = _n.copy(f).multiplyScalar(travel);
      const err = -cwAngle(want, tr, n);
      u = clamp(err * 1.8, -1, 1);
    }
    // butter: the base pressed on the nose or tail, the skis pivot on that end with little grip
    this.press += ((I.butter ? I.press : 0) - this.press) * Math.min(1, dt * 8);
    const buttering = Math.abs(this.press) > 0.35;
    /* the edge rolls on and off as a body does: eased in and out (a critically damped spring, not a fixed rate), so a
       quick tap tips the skis a little and lets them back, holding rolls them over through about half a second, and a
       change from left to right goes smoothly through flat skis. Sliding sideways fast, the skis stay on the edge the
       slide is on a little longer (rolling over mid-skid catches). (2026-11-03: the edge went over at 7/s with full
       turning from 5 degrees of edge, so one press turned a lot and the turn came in steps.) */
    const edgeMax = 1.05 * (1 - 0.6 * Math.abs(this.press));
    const slipNow = Math.abs(vr), eWant = u * edgeMax;
    const back = eWant * this.edge < 0 || Math.abs(eWant) < Math.abs(this.edge);
    const wE = (this.mouseTarget ? 9 : back ? 14 : 9) * clamp(1 - (slipNow - 3) / 6, 0.55, 1);
    this.edgeV += (wE * wE * (eWant - this.edge) - 2 * wE * this.edgeV) * dt;
    this.edge = clamp(this.edge + this.edgeV * dt, -1.1, 1.1);
    // the brake builds over about half a second (a tap is a speed check, a hold a hockey stop) and eases off when let go
    this.brake += ((I.brake ? 1 : 0) - this.brake) * Math.min(1, dt * (I.brake ? 3.4 : 3.4));
    // forward: a tuck at speed, a skate and a pole push on the flat; Shift (Shredsauce Controls) skates hard, and keeps
    // helping to about 70 km/h (2026-11-03, for "make pressing shift make you go faster more")
    const skateWant = !I.brake && !I.crouch && !buttering ? Math.max(I.push ? 1 - smoothstep(15, 20, speed) : 0, I.tuck ? 1 - smoothstep(5.5, 9, speed) : 0) : 0;
    this.skate += (skateWant - this.skate) * Math.min(1, dt * 5);
    this.tuck += ((I.tuck && !I.crouch ? smoothstep(4.5, 8.5, speed) : 0) - this.tuck) * Math.min(1, dt * 4);
    // crouching loads the pop (the knees bend); letting go pops by the speed you have
    if (I.crouch) { this.crouchT += dt; this.windup = clamp(this.windup + I.steer * dt * 2.4, -1, 1); }
    this.absorb *= Math.exp(-dt * 2.6);
    const crouchWant = I.crouch ? 0.82 : 0.28 + 0.32 * this.tuck + 0.12 * Math.abs(this.edge) + 0.12 * this.brake + this.absorb;
    this.crouch += (Math.min(0.95, crouchWant) - this.crouch) * Math.min(1, dt * (crouchWant > this.crouch ? 10 : 5));
    // the heading turns: carving (sidecut), pivoting (feet steering), or the brake swinging the skis across
    const grip = this.surf === 1 ? 0.62 : this.surf === 2 ? 1.05 : 1.12;
    const ae = Math.abs(this.edge);
    const skis = _n2.copy(f).multiplyScalar(travel);           // the way the skis go
    let omega = 0;
    if (this.brake > 0.03) {
      // the skis swing across the way you are going, as far as the brake is held (square across at full), so the
      // skid slows you along your line instead of turning you; once stopped they stay put, and as the brake eases
      // off they come back round to the way you were going when it started
      if (!this.brakeHead) {
        this.brakeHead = speed > 1 ? this.v.clone().normalize() : skis.clone();
        const slip = cwAngle(this.brakeHead, skis, n);
        this.brakeSide = u ? Math.sign(u) : Math.abs(slip) > 0.05 ? Math.sign(slip) : (this.lastEdge || 1);
      }
      if (speed > 1.5 && I.brake) this.brakeRef = (this.brakeRef || new THREE.Vector3()).copy(this.v).normalize();
      else if (!I.brake || !this.brakeRef) this.brakeRef = (this.brakeRef || new THREE.Vector3()).copy(this.brakeHead);
      if (u) this.brakeRef.applyAxisAngle(n, -u * 0.6 * dt);
      this.brakeRef.addScaledVector(n, -this.brakeRef.dot(n)).normalize();
      const ang = cwAngle(this.brakeRef, skis, n);
      const target = this.brakeSide * this.brake * 1.5;       // square across at a full brake
      omega = (I.brake && speed < 0.8) ? 0 : clamp((target - ang) * 8, -5.5, 5.5);
      const angH = cwAngle(this.brakeHead, skis, n);
      if (Math.abs(angH) > 1.7 && Math.sign(omega) === Math.sign(angH)) omega = 0;
    } else {
      this.brakeRef = null;
      /* a ski bends into its sidecut's arc only once it is tipped well over: a little edge is a light, skidded steer, a
         full one the carve (radius 15.5 m x cos of the edge). Both grow from nothing with the edge, so the turn comes
         in as smoothly as the skis tip. Pivoting (the feet steering the skis round, mostly when slow) follows the edge
         too. */
      const Rsc = 15.5, eN = clamp(ae / 0.75, 0, 1);
      const carving = Math.sign(this.edge) * eN * Math.abs(vf) / (Rsc * Math.cos(Math.min(ae, 1.15))) * grip;
      const steerNow = clamp(this.edge / Math.max(0.2, edgeMax), -1, 1);
      const pivot = (buttering ? 4.2 : 2.2 - 1.75 * smoothstep(1, 14, speed)) * (buttering ? u : steerNow);
      let target = Math.abs(carving) > Math.abs(pivot) ? carving : pivot;
      if (this.crouch > 0.6 && I.crouch && speed < 6) target *= 0.5;
      // after a brake the skis come back round to the way you were going (unless you steer)
      if (this.brakeHead) { const ang = cwAngle(this.brakeHead, skis, n); if (!u && Math.abs(ang) > 0.015 && this.unbrakeT < 0.9) target = clamp(-ang * 6, -2.5, 2.5); else this.brakeHead = null; }
      // a revert: spun round 180 on the snow straight after a landing
      if (this.revertLeft) target = -Math.sign(this.revertLeft) * 9;
      const A = this.revertLeft ? 60 : buttering ? 14 : 7;           // how fast the turn can build or reverse (rad/s2)
      // (eased towards what the skis ask for: it arrives smoothly instead of at a constant rate)
      omega = this.turnRate + clamp((target - this.turnRate) * Math.min(1, dt * (this.revertLeft ? 60 : 15)), -A * dt, A * dt);
      if (this.revertLeft) { const st = -omega * dt; if (Math.abs(st) >= Math.abs(this.revertLeft)) { omega = -this.revertLeft / dt; this.revertLeft = 0; this.events.push({ type: 'revert' }); } else this.revertLeft -= st; }
      if (Math.abs(this.edge) > 0.25) this.lastEdge = Math.sign(this.edge);
    }
    if (I.revert && !this.revertLeft && this.landT < 0.8 && speed > 3) this.revertLeft = (this.lastSpinDir || 1) * Math.PI;
    this.turnRate = omega;
    f.applyAxisAngle(n, -omega * dt).normalize(); this.f.copy(f);
    right.crossVectors(f, n).normalize();
    if (buttering) { this.butter += -omega * dt; this.butterNose = this.press > 0; } else if (Math.abs(this.butter) > 0) { this.endButter(); }
    // forces
    const a = _v.set(0, -G, 0);
    const gn = a.dot(n); a.addScaledVector(n, -gn);                 // gravity along the slope
    const N = Math.max(0, -gn);                                     // normal load per kg
    const vf2 = this.v.dot(f), vr2 = this.v.dot(right);
    const mu = this.surf === 1 ? 0.07 : 0.036;
    if (Math.abs(vf2) > 0.03) a.addScaledVector(f, -Math.sign(vf2) * mu * N);
    // (stopped, the snow holds the skis unless the slope pulls along them harder than about 4.6 degrees does: pointed
    // down a steeper one they slide off, 2026-11-03; stopped across the hill or on the flat they stay)
    else a.addScaledVector(f, -a.dot(f) * (speed < 0.3 && this.skate < 0.05 && Math.abs(a.dot(f)) < 0.08 * N ? 1 : 0));
    // across the skis: a set edge holds what the turn asks for; once the skis slide sideways they only get the snow's
    // sliding friction, so a skid or a hockey stop slows you gradually instead of stopping you dead
    const edgeK = buttering ? 0.25 : (0.32 + 0.68 * smoothstep(0.05, 0.55, ae)) * (1 + this.brake * 0.6);
    const pipe = this.inPipe(this.p.x, this.p.z);
    const steep = n.y > 0.8 || pipe ? 1 : smoothstep(this.surf === 2 ? WALL_PARK : WALL_ANY, 0.82, n.y);   // a steep face (not the pipe) lets the edges go
    const hold = (grip * N * edgeK * 1.35 + 0.6) * steep;
    const skid = N * (0.22 + 0.33 * clamp(ae / 0.9 + this.brake, 0, 1) + 0.15 * this.brake) * (this.surf === 1 ? 1.25 : 1);
    const slip = Math.abs(vr2) / Math.max(1.5, speed);
    // (in the pipe's transitions the rider is pressed into hard snow and the edges hold as in a carve)
    const gripMax = pipe && this.brake < 0.1 ? hold : Math.min(hold, skid) + Math.max(0, hold - skid) * Math.exp(-Math.max(0, slip - 0.18) / 0.12);
    const lat = clamp(-vr2 * 16, -gripMax, gripMax);
    if (this.brake > 0.03 && speed > 0.5) {
      const F = right.clone().multiplyScalar(lat), pv = new THREE.Vector3().crossVectors(n, this.v).normalize();
      F.addScaledVector(pv, -F.dot(pv) * this.brake); a.add(F);
    } else a.addScaledVector(right, lat);
    this.slide = Math.abs(vr2) + (this.scrub || 0) * 0.35;
    // a rider checks speed on a kicker's in-run (unless tucking for more): scrubbing towards its design speed
    this.scrub = 0;
    // (up the takeoff too, towards the speed that leaves the lip at its own: what the ramp takes is then whatever it is)
    if (!I.tuck && !I.push && speed > 4) for (const k of this.park.kickers) {
      if (this.p.z < k.z0 - 50 || this.p.z > k.L.z - 0.4 || Math.abs(this.p.x - k.x) > k.wT + 3) continue;
      const want = this.p.z < k.z0 ? k.vDesign : Math.sqrt(k.vLip * k.vLip + 2 * 9.81 * Math.max(0, k.L.y - this.p.y) * 1.05);
      const over = speed - want;
      if (over > 0.2) { const d = Math.min(3.2, over * 1.6); a.addScaledVector(this.v, -d / speed); this.scrub = d; }
    }
    // pumping the pipe's transitions: riders extend their legs going up the curve and gain speed doing it
    for (const pp of [this.park.pipe, this.park.qp]) {
      if (!(pp && n.y < 0.97 && n.y > 0.12 && pp.surface(this.p.x, this.p.z) && Math.abs(this.v.x) > 3)) continue;
      const upWall = (pp.dir || Math.sign(this.p.x - pp.x)) === Math.sign(this.v.x);
      a.addScaledVector(this.v, (upWall ? 2.3 : 1.0) / speed);
    }
    // skating and poling: strides that push, strongest from a standstill, nothing left past about 30 km/h
    if (this.skate > 0.02) {
      this.skateT += dt * (1.2 + 0.05 * speed);
      const pulse = 0.3 + 0.7 * Math.abs(Math.sin(this.skateT * 2 * Math.PI));   // a push off each ski in turn
      const vmax = I.push ? 21 : 9.5, ahead = Math.max(0, vf2 * travel);
      a.addScaledVector(f, travel * (I.push ? 5.2 : 3.0) * this.skate * pulse * clamp(1 - ahead / vmax, 0, 1));
    }
    // air drag and deep snow
    const cda = 0.55 - 0.3 * this.tuck - (I.crouch ? 0.2 : 0) + 0.2 * this.brake;
    a.addScaledVector(this.v, -0.5 * 1.2 * cda / 78 * speed);
    if (this.surf === 1) a.addScaledVector(this.v, -0.0045 * speed);
    if (speed < 0.6 && this.skate < 0.05 && N > 9 && a.length() < 0.4) a.multiplyScalar(0);
    this.v.addScaledVector(a, dt);
    this.v.addScaledVector(n, -this.v.dot(n));
    // pop
    if (!I.crouch && this.crouchT > 0.06) {
      const spin = -(this.windup * AIR.spin * 0.85 + this.turnRate * 0.35);   // + about up is to the left
      this.crouchT = 0;
      this.takeoff(dt, this.popFor(speed), spin, 'pop'); this.windup = 0; return;
    }
    if (!I.crouch) { this.crouchT = 0; this.windup *= Math.max(0, 1 - dt * 3); }
    // move, and leave the snow where it curves away faster than gravity can follow (not in the moment after landing)
    const nx = this.p.x + this.v.x * dt, nz = this.p.z + this.v.z * dt;
    const ny = this.p.y + this.v.y * dt;
    const by = ny - 0.5 * G * dt * dt;
    const h1 = height(nx, nz);
    if (by > h1 + (this.landT < 0.3 ? 0.03 : 0.004) && speed > 2) {
      // rolled off a lip: a crouch held through it still winds the spin, and letting go just after still pops
      const crouched = I.crouch && this.crouchT > 0.06;
      this.takeoff(dt, 0, -(this.turnRate * 0.4 + (crouched ? this.windup * AIR.spin * 0.85 : 0)), 'lip');
      this.lateCharge = crouched; if (crouched) this.windup = 0;
      return;
    }
    this.p.set(nx, ny, nz);
    for (let k = 0; k < 2; k++) {
      const h = height(this.p.x, this.p.z); normalBehind(this.p.x, this.p.z, this.v.x, this.v.z, n);
      const gap = h - this.p.y; this.p.addScaledVector(n, gap * n.y);
    }
    this.v.addScaledVector(n, -this.v.dot(n));
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
    if (deg > 140) this.events.push({ type: 'butter', deg, nose: !!this.butterNose, dir: Math.sign(this.butter) });
    this.butter = 0;
  }

  // ---- in the air -------------------------------------------------------------------------------------------------
  takeoff(dt, pop, spin, how) {
    const n = this.n;
    if (pop) this.v.addScaledVector(n.y > 0.4 ? n : UP, pop);
    // in the pipe: a skier goes straight up the wall, not out over the deck
    for (const pp of [this.park.pipe, this.park.qp]) {
      if (!(n.y < 0.55 && pp && this.p.z > pp.z0 && this.p.z < pp.z1 && this.p.x > pp.x0 && this.p.x < pp.x1)) continue;
      const out = pp.dir || Math.sign(this.p.x - pp.x);
      const vx = this.v.x * out;
      if (vx > -0.4) this.v.x = -0.4 * out;
    }
    this.state = 'air'; this.tState = 0; this.tAir = 0; this.lateCharge = false; this.wallOff = how === 'wall';
    this.com.copy(this.p).addScaledVector(this.up, COM * (1 - this.crouch * 0.35));
    const up = this.up;
    this.w.copy(up).multiplyScalar(spin);
    this.natural = how === 'wall' ? 0 : this.naturalTurn();
    this.wNat.copy(this.w); this.wKeys.set(0, 0, 0); this.wCork = false;
    this.lastPress = this.press;
    const inPipe = [this.park.pipe, this.park.qp].some(pp => pp && n.y < 0.55 && this.p.z > pp.z0 && this.p.z < pp.z1 && this.p.x > pp.x0 && this.p.x < pp.x1);
    this.events.push({ type: 'takeoff', how, sw: this.sw, speed: this.v.length(), press: this.press, butter: Math.abs(this.press) > 0.35, rail: !!this.rail, pipe: inPipe });
    this.press = 0; this.endButter();
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
      if (!I.crouch && this.tAir < 0.22) { this.v.addScaledVector(UP, this.popFor(this.v.length()) * 0.8); this.lateCharge = false; this.events.push({ type: 'latepop' }); }
      else if (this.tAir >= 0.22) this.lateCharge = false;
    }
    if (!I.crouch) this.crouchT = 0; else this.crouchT += dt;
    // rotation about the body's own axes: a held key builds it towards its top rate, let go it settles
    const q = this.q;
    const up = _v.set(0, 1, 0).applyQuaternion(q), left = _n.set(1, 0, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const grabbing = !!I.grab || !!I.pose;
    const acc = grabbing ? 0.8 : 1;
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
      if (held) this.events.push({ type: 'grab', id: held });
    }
    if (this.held) { this.grabT += dt; const m = I.tweak || ''; this.modT[m] = (this.modT[m] || 0) + dt; }
    this.grab = I.grab || null;
    this.pose = I.pose || null;
    this.tweak = this.held ? (I.tweak || '') : '';
    // a shifty: the skis turned across under the body and back (the body turns the other way; no rotation is made)
    this.shift += ((I.shifty || 0) - this.shift) * Math.min(1, dt * 7);
    if (Math.abs(this.shift) > 0.6) { this.shiftyT += dt; this.shiftDir = Math.sign(this.shift); }
    else if (this.shiftyT > 0.15) { this.events.push({ type: 'shifty', dir: this.shiftDir, t: this.shiftyT }); this.shiftyT = 0; }
    this.crouch += ((grabbing ? 0.75 : I.crouch ? 0.6 : 0.34 + 0.1 * Math.abs(this.shift)) - this.crouch) * Math.min(1, dt * 6);
    // flight
    const sp = this.v.length();
    this.v.y -= G * dt;
    this.v.addScaledVector(this.v, -0.5 * 1.2 * (grabbing ? 0.42 : 0.5) / 78 * sp * dt);
    this.com.addScaledVector(this.v, dt);
    const comH = COM * (1 - this.crouch * 0.35);
    this.p.copy(this.com).addScaledVector(_w.set(0, 1, 0).applyQuaternion(q), -comH);
    this.events.push({ type: 'air', dq: wl * dt });
    if (this.railCheck()) return;
    if (this.railBump()) return;
    if (this.treeHit()) return;
    const h = height(this.p.x, this.p.z);
    if (this.p.y <= h && this.tAir > 0.03) {
      const nn = normal(this.p.x, this.p.z, _n2);
      if (isWall(nn.y, surface(this.p.x, this.p.z), this.inPipe(this.p.x, this.p.z))) this.wallHit(h, nn);
      else this.land(h);
    }
    else if (this.tAir > 25) this.crash('lost');
  }
  // a face too steep to land on: the skis bounce off it and slide down it, hard into it is a crash
  wallHit(h, nn) {
    // the face pushes back sideways only (pushed along its normal the rider was thrown up it and rode onto the deck)
    const nh = new THREE.Vector3(nn.x, 0, nn.z); if (nh.lengthSq() < 1e-6) nh.set(0, 0, -1); nh.normalize();
    const vn = this.v.dot(nh);
    if (vn < -10) { this.crash('wall'); return; }
    const dy = h + 0.004 - this.p.y; this.p.y += dy; this.com.y += dy;
    if (this.v.y < 0) this.v.y *= 0.6;
    if (vn < 0) this.v.addScaledVector(nh, -vn * 1.1);
    const vt = this.v.clone().addScaledVector(nn, -this.v.dot(nn));
    this.v.addScaledVector(vt, -Math.min(1, 1.2 * (1 / 120)));
    if (this.held) { this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() }); this.held = null; }
    this.grab = null; this.pose = null;
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
    const aUp = up.angleTo(n) * 180 / Math.PI;
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
    this.events.push({ type: 'land', q, aUp, aDir, vn, sw, wasSw: this.sw, tAir: this.tAir });
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
    this.lastSpinDir = Math.sign(this.w.dot(up)) || this.lastSpinDir || 1;
    this.w.set(0, 0, 0);
    this.state = 'ground'; this.tState = 0; this.landT = 0; this.revertLeft = 0; this.edgeV = 0;
    // the knees take the landing: bent as far as the impact asks, then the legs straighten slowly (no rebound)
    this.absorb = clamp(0.08 + vn * 0.045, 0.1, 0.6) * (q === 'sketchy' ? 1.2 : 1);
    this.lastLanding = { q, vn, t: 0 };
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
  // A rail is ridden only where the skis really meet it: coming down onto its top (or level with it off a box's
  // ramp), with the rail under some part of the skis. Nothing pulls the rider onto its line; where on the skis it
  // sits, and how the skis are turned across it, is what the rider brought.
  railReach(r, ang) { return r.w / 2 + 0.05 + Math.abs(Math.sin(ang)) * 0.72 + Math.abs(Math.cos(ang)) * 0.16; }
  railCheck() {
    if (this.state === 'rail' || this.railCooldown > 0) return false;
    for (const r of this.park.rails) {
      if (!r.box.containsPoint(this.p)) continue;
      const c = r.closest(this.p);
      if (c.dy < -0.14 || c.dy > 0.08) continue;
      const along = this.v.dot(c.dir);
      if (Math.abs(along) < 1.2) continue;
      // coming up at it from below is the rail's side, not its top
      const vRel = this.v.y - c.dir.y * along;
      if (c.dy < -0.02 && vRel > 0.6) continue;
      const dH = _v.set(c.dir.x, 0, c.dir.z).normalize().multiplyScalar(Math.sign(along));
      const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q); fw.y = 0; if (fw.lengthSq() < 1e-4) continue; fw.normalize();
      const ang = -cwAngle(dH, fw, UP);                   // + = skis turned left of the travel along the rail
      if (c.dh > this.railReach(r, ang)) continue;
      const leftH = new THREE.Vector3(dH.z, 0, -dH.x);
      const off = (this.p.x - c.x) * leftH.x + (this.p.z - c.z) * leftH.z;
      this.lockRail(r, c, along, ang, off, leftH);
      return true;
    }
    return false;
  }
  // a rail or box is solid below its top: ridden into from the side or the front, it pushes you away (hard, a crash)
  railBump() {
    if (this.railCooldown > 0) return false;
    for (const r of this.park.rails) {
      if (!r.box.containsPoint(this.p)) continue;
      const c = r.closest(this.p);
      const half = r.w / 2 + 0.14;
      if (c.dy > -0.22 || c.dh >= half) continue;
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
  lockRail(r, c, along, ang, off, leftH) {
    const wasAir = this.state === 'air';
    this.rail = r; this.railS = c.s; this.railDir = Math.sign(along); this.railV = Math.abs(along);
    this.railAng = wrapPi(ang);
    this.railAngV = clamp(wasAir ? this.w.dot(UP) * 0.5 : 0, -3, 3);       // a spin brought onto the rail carries on a little
    this.railOff = off; this.railOffV = clamp(this.v.x * leftH.x + this.v.z * leftH.z, -2.5, 2.5);
    this.railLock = lockOf(this.railAng); this.railCand = this.railLock; this.railCandT = 0;
    this.setRailMode();
    this.balance = 0;
    this.state = 'rail'; this.tState = 0;
    this.grab = null; this.pose = null; this.tweak = '';
    if (this.held) { this.events.push({ type: 'grabEnd', id: this.held, t: this.grabT, mod: this.bestMod() }); this.held = null; }
    this.railPress = 0; this.railPressAcc = 0;
    this.events.push({ type: 'railOn', rail: r, mode: this.railMode, sw: this.railSw, fromAir: wasAir, ang, kind: r.kind });
    this.setRailQ(true);
  }
  setRailMode() {
    const s = Math.abs(Math.sin(this.railLock)), c = Math.cos(this.railLock);
    this.railMode = s > 0.7 ? 'slide' : '5050';
    this.railSw = this.railMode === '5050' && c < 0;
    this.railFace = this.railMode === 'slide' ? Math.sign(Math.sin(this.railLock)) : 1;
  }
  setRailQ(now) {
    const d = this.rail.dirAt(this.railS).clone().multiplyScalar(this.railDir);
    const dH = d.clone().setY(0).normalize();
    const fwd = dH.applyAxisAngle(UP, this.railAng);
    const left = new THREE.Vector3().crossVectors(UP, fwd).normalize();
    _m.makeBasis(left, UP, new THREE.Vector3().crossVectors(left, UP));
    _q.setFromRotationMatrix(_m);
    // lean a little towards the side the weight is on
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.balance * 0.3));
    if (now) this.q.copy(_q); else this.q.slerp(_q, 0.5);
  }
  stepRail(dt, I) {
    const r = this.rail;
    const d = r.dirAt(this.railS);
    const gAlong = -G * d.y * this.railDir;                 // gravity along the travel
    const mu = r.kind === 'box' ? 0.09 : 0.07;
    this.railV += (gAlong - mu * G - 0.004 * this.railV * this.railV) * dt;
    if (this.railV < 0.4) { this.leaveRail(dt, 0.5, 0, 'stall'); return; }
    this.railS += this.railV * this.railDir * dt;
    // the skis turn on the rail with the steering; let go and they settle into the nearest of 50-50, a slide either
    // way or switch (a tap of Q / E in the keys schemes turns them half way round at once)
    if (I.spin && !this.railTurn) this.railTurn = { left: -Math.sign(I.spin) * Math.PI };
    const u = I.steer;
    if (u) { this.railTurn = null; this.railAngV += (-u * 3.4 - this.railAngV) * Math.min(1, dt * 8); }
    else if (this.railTurn) {
      const st = clamp(this.railTurn.left, -9 * dt, 9 * dt);
      this.railAngV = st / dt; this.railTurn.left -= st;
      if (Math.abs(this.railTurn.left) < 1e-3) this.railTurn = null;
    } else {
      const e = wrapPi(lockOf(this.railAng) - this.railAng);
      this.railAngV += (e * 9 - this.railAngV) * Math.min(1, dt * 10);
    }
    this.railAng = wrapPi(this.railAng + this.railAngV * dt);
    // a new position counts once it is held for a moment (a quick turn through a slide is one swap, not two)
    const lk = lockOf(this.railAng);
    if (lk !== this.railCand) { this.railCand = lk; this.railCandT = 0; } else this.railCandT += dt;
    if (this.railCand !== this.railLock && this.railCandT > 0.15 && !this.railTurn) {
      const from = this.railLock; this.railLock = this.railCand; this.setRailMode();
      const through = wrapPi(from + wrapPi(this.railLock - from) / 2);
      this.events.push({ type: 'railSwap', from, to: this.railLock, mode: this.railMode, front: Math.cos(through) > 0, dir: Math.sign(wrapPi(this.railLock - from)) });
    }
    // across the rail: the slide carries on sideways with what it came in with, the edges on the rail slow that
    this.railOffV *= Math.exp(-dt * (r.kind === 'box' ? 4 : 2.6));
    const past = Math.abs(this.railOff) - (r.w / 2 + 0.06);                // the weight past the edge tips you off that side
    if (past > 0) this.railOffV += Math.sign(this.railOff) * past * 7 * dt;
    this.railOff += this.railOffV * dt;
    const reach = this.railReach(r, this.railAng);
    this.balance = clamp(this.railOff / reach, -1.2, 1.2);
    this.railPress += ((I.butter ? I.press : 0) - this.railPress) * Math.min(1, dt * 8);
    if (Math.abs(this.railPress) > 0.35) this.railPressAcc += Math.sign(this.railPress) * dt;
    this.crouch += ((I.crouch ? 0.8 : 0.36 + 0.1 * Math.abs(this.railPress)) - this.crouch) * Math.min(1, dt * 8);
    if (Math.abs(this.railOff) > reach) { this.events.push({ type: 'railFall' }); this.leaveRail(dt, 0.2, this.railAngV * 0.5, 'fall'); return; }
    if (this.railS < 0 || this.railS > r.len) { this.leaveRail(dt, 0.6, this.railAngV * 0.8, 'end'); return; }
    const pt = r.at(this.railS);
    const dH = _v.set(d.x, 0, d.z).normalize().multiplyScalar(this.railDir), leftH = new THREE.Vector3(dH.z, 0, -dH.x);
    this.p.copy(pt).addScaledVector(leftH, this.railOff);
    this.v.copy(d).multiplyScalar(this.railV * this.railDir).addScaledVector(leftH, this.railOffV);
    this.setRailQ(false);
    if (!I.crouch && this.crouchT > 0.06) { this.crouchT = 0; this.leaveRail(dt, this.popFor(this.railV) * 0.85, this.railAngV - this.windup * AIR.spin * 0.85, 'pop'); this.windup = 0; return; }
    if (I.crouch) { this.crouchT += dt; this.windup = clamp(this.windup + (I.steer ? 0 : I.spin) * dt * 2.4, -1, 1); }
    else this.crouchT = 0;
  }
  leaveRail(dt, pop, spin, how) {
    // a press held for at least 0.4 s of the ride counts, whether or not it is still held at the end
    const pa = this.railPressAcc || 0;
    this.events.push({ type: 'railOff', how, press: Math.abs(pa) >= 0.4 ? Math.sign(pa) : 0 });
    this.rail = null; this.railCooldown = 0.25;
    this.state = 'air'; this.tState = 0; this.tAir = 0; this.lateCharge = false;
    this.v.y += pop;
    this.com.copy(this.p).addScaledVector(this.up, COM * (1 - this.crouch * 0.35));
    // off a slide the skis come back round to the travel (forwards or switch) as they leave it, unless spun off
    const ang = this.railAng, e = wrapPi((Math.cos(ang) >= 0 ? 0 : Math.PI) - ang);
    if (Math.abs(Math.sin(ang)) > 0.5 && (how !== 'pop' || Math.abs(spin) < 1)) spin += e / 0.34;
    this.w.copy(UP).multiplyScalar(spin);
    // (riding off the end of a rail into a steep landing, or popping off, the body turns to meet the landing as off a
    // lip: it stayed upright, and every tube on the Jump Line set the rider down 34 degrees off, 2026-11-03; a fall off
    // the side is left as it is)
    this.natural = how === 'fall' ? 0 : this.naturalTurn();
    this.wNat.copy(this.w); this.wKeys.set(0, 0, 0); this.wCork = false;
    this.events.push({ type: 'takeoff', how: 'rail', sw: Math.cos(ang) < 0 ? !this.sw : this.sw, speed: this.v.length(), rail: true });
    this.railTurn = null; this.balance = 0;
    this.grab = null; this.grabT = 0; this.held = null; this.tweak = ''; this.shiftyT = 0;
  }

  // ---- crashes ------------------------------------------------------------------------------------------------------
  crash(why) {
    this.state = 'crash'; this.tState = 0; this.grab = null; this.pose = null; this.rail = null; this.tweak = '';
    this.crashSpin = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    this.events.push({ type: 'crash', why, speed: this.v.length() });
  }
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
      this.crashSpin.multiplyScalar(Math.max(0, 1 - dt * 2.5));
    }
    this.p.addScaledVector(this.v, dt);
    const s = this.crashSpin.length();
    if (s > 1e-4) { _q.setFromAxisAngle(_w.copy(this.crashSpin).divideScalar(s), s * dt); this.q.premultiply(_q); }
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
}
