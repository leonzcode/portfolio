// The skier's physics. One body on the snow with its skis' direction (heading), an edge angle and a stance, and
// four states:
//   ground  carving (the ski's sidecut turns it: radius = sidecut x cos(edge)), skidding (grip limited by the edge
//           and the snow, so a turn asked for faster than the grip allows slides, sprays and slows), braking (a
//           hockey stop), tucking, buttering on the nose or tail, popping (crouch, then release)
//   air     ballistic flight of the centre of mass with drag; spins, flips and off-axis rotation about the body's
//           own axes; grabs; landing judged on how the skis meet the snow
//   rail    sliding a rail or box: 50-50 or across it, with balance
//   crash   tumbling to a stop, then back to a safe spot a few seconds earlier
// Frames: world +z downhill, +y up. The body frame: +Z the skis' forward, +Y up, +X the skier's left.
import * as THREE from 'three';
import { height, normal, normalBehind, surface, baseLine } from './terrain.js?v=3';
import { clamp, smoothstep } from './noise.js?v=3';

const G = 9.81, UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const COM = 0.92;            // feet to centre of mass, standing

export class Skier {
  constructor(park) {
    this.park = park;
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();          // body orientation
    this.f = new THREE.Vector3(0, 0, 1);      // heading on the snow (unit, tangent)
    this.n = new THREE.Vector3(0, 1, 0);
    this.w = new THREE.Vector3();             // angular velocity in the air (world)
    this.com = new THREE.Vector3();
    this.state = 'ground';
    this.sw = false;                          // riding switch (backwards)
    this.edge = 0; this.crouch = 0; this.tuck = 0; this.brake = 0; this.charge = 0; this.press = 0;
    this.slide = 0;                           // lateral sliding speed (m/s), for spray and sound
    this.tAir = 0; this.tState = 0; this.windup = 0; this.turnRate = 0;
    this.grab = null; this.grabT = 0; this.pose = null;
    this.rail = null; this.railS = 0; this.railV = 0; this.railDir = 1; this.railMode = '5050'; this.balance = 0; this.balanceV = 0;
    this.safe = []; this.safeT = 0;
    this.events = [];                         // for tricks.js, sound and snow: [{ type, ... }]
    this.butter = 0;                          // accumulated pivot while pressed (rad)
    this.lastLanding = null;
    this.mouseTarget = null;                  // the mouse scheme's wanted travel direction (unit vector) or null
    this.surf = 0;
  }
  // put the skier at x, z facing down the fall line
  spawn(x, z, speed = 0, yaw = 0) {
    this.p.set(x, height(x, z), z);
    normal(x, z, this.n);
    this.f.set(Math.sin(yaw), 0, Math.cos(yaw)); this.toTangent(this.f);
    this.v.copy(this.f).multiplyScalar(speed);
    this.state = 'ground'; this.sw = false; this.w.set(0, 0, 0); this.grab = null; this.pose = null; this.rail = null;
    this.edge = 0; this.crouch = 0; this.charge = 0; this.tState = 0; this.butter = 0; this.press = 0;
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

  step(dt, I) {
    this.tState += dt;
    if (this.railCooldown > 0) this.railCooldown -= dt;
    if (this.state === 'ground') this.stepGround(dt, I);
    else if (this.state === 'air') this.stepAir(dt, I);
    else if (this.state === 'rail') this.stepRail(dt, I);
    else this.stepCrash(dt, I);
  }

  // ---- on the snow ------------------------------------------------------------------------------------------------
  stepGround(dt, I) {
    const n = this.v.lengthSq() > 1 ? normalBehind(this.p.x, this.p.z, this.v.x, this.v.z, this.n) : normal(this.p.x, this.p.z, this.n);
    this.surf = surface(this.p.x, this.p.z);
    const f = this.toTangent(this.f);
    const right = _w.crossVectors(f, n).normalize();
    const speed = this.v.length();
    // which way the skis point against the way we go
    const vf = this.v.dot(f), vr = this.v.dot(right);
    if (speed > 1.2) {
      const c = vf / speed;
      if ((!this.sw && c < -0.25) || (this.sw && c > 0.25)) { this.sw = !this.sw; this.events.push({ type: 'switch', sw: this.sw }); }
    }
    const travel = this.sw ? -1 : 1;
    // steering: the mouse scheme asks for a direction, the keys for a turn
    let u = I.steer;
    if (this.mouseTarget && !I.brake) {
      const want = _v.copy(this.mouseTarget); want.addScaledVector(n, -want.dot(n)).normalize();
      const tr = _n.copy(f).multiplyScalar(travel);
      // the clockwise angle (seen from above) from the travel to the wanted direction
      const cr = tr.y * 0 + (tr.z * want.x - tr.x * want.z) * n.y + (tr.x * want.y - tr.y * want.x) * n.z + (tr.y * want.z - tr.z * want.y) * n.x;
      const err = Math.atan2(-cr, want.dot(tr));
      u = clamp(err * 1.8, -1, 1);
    }
    // butter: the base pressed on the nose or tail, the skis pivot on that end with little grip
    this.press += ((I.butter ? I.press : 0) - this.press) * Math.min(1, dt * 10);
    const buttering = Math.abs(this.press) > 0.35;
    const edgeMax = 1.05 * (1 - 0.6 * Math.abs(this.press));
    this.edge += (u * edgeMax - this.edge) * Math.min(1, dt * (this.mouseTarget ? 6 : Math.abs(u) > Math.abs(this.edge) ? 3.2 : 6));
    this.brake += ((I.brake ? 1 : 0) - this.brake) * Math.min(1, dt * 8);
    this.tuck += ((I.tuck && !I.crouch ? 1 : 0) - this.tuck) * Math.min(1, dt * 5);
    // crouching charges the pop; letting go pops
    if (I.crouch) { this.charge = Math.min(1, this.charge + dt * 2.2); this.windup = clamp(this.windup + I.steer * dt * 2.4, -1, 1); }
    this.crouch += ((I.crouch ? 0.85 : 0.3 + 0.3 * this.tuck + 0.15 * Math.abs(this.edge)) - this.crouch) * Math.min(1, dt * 9);
    // the heading turns: carving (sidecut), pivoting (feet steering), or a hockey stop
    const grip = this.surf === 1 ? 0.62 : this.surf === 2 ? 1.05 : 1.12;
    const ae = Math.abs(this.edge);
    let omega = 0;
    if (this.brake > 0.05 && speed > 1.2) {
      // skis swung across the travel, hard on the edges
      const side = this.brakeSide || (this.brakeSide = (vr * travel >= 0 ? -1 : 1));
      const tr = _v.copy(this.v).normalize();
      const across = _n.crossVectors(n, tr).multiplyScalar(side);   // perpendicular to travel
      const err = Math.atan2(across.dot(right), across.dot(f)) * travel;
      omega = clamp(-err * 6, -5, 5) * this.brake;
    } else {
      this.brakeSide = 0;
      const Rsc = 15.5;
      const carve = ae > 0.08 ? Math.abs(vf) / (Rsc * Math.cos(Math.min(ae, 1.15))) * grip : 0;
      const pivot = (buttering ? 4.2 : 2.4 - 1.95 * smoothstep(1, 14, speed)) * Math.abs(u);
      omega = Math.sign(u) * Math.max(carve, pivot);
      if (this.crouch > 0.6 && I.crouch && speed < 6) omega *= 0.5;
    }
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
    else a.addScaledVector(f, -a.dot(f) * (speed < 0.3 && !I.tuck ? 1 : 0));
    // the edges' grip across the skis: what the turn asks for, up to what the snow gives
    const edgeK = buttering ? 0.25 : (0.32 + 0.68 * smoothstep(0.05, 0.55, ae)) * (1 + this.brake * 0.6);
    const gripMax = grip * N * edgeK * 1.35 + 0.6;
    const lat = clamp(-vr2 * 16, -gripMax, gripMax);
    a.addScaledVector(right, lat);
    this.slide = Math.abs(vr2) + (this.scrub || 0) * 0.35;
    // a rider checks speed on a kicker's in-run (unless tucking for more): scrubbing towards its design speed
    this.scrub = 0;
    if (!I.tuck && speed > 4) for (const k of this.park.kickers) {
      if (this.p.z < k.z0 - 50 || this.p.z > k.z0 || Math.abs(this.p.x - k.x) > k.wT + 3) continue;
      const over = speed - k.vDesign;
      if (over > 0.2) { const d = Math.min(3.2, over * 1.6); a.addScaledVector(this.v, -d / speed); this.scrub = d; }
    }
    // pumping the pipe's transitions: riders extend their legs going up the curve and gain speed doing it
    for (const pp of [this.park.pipe, this.park.qp]) {
      if (!(pp && n.y < 0.97 && n.y > 0.12 && pp.surface(this.p.x, this.p.z) && Math.abs(this.v.x) > 3)) continue;
      const upWall = (pp.dir || Math.sign(this.p.x - pp.x)) === Math.sign(this.v.x);
      a.addScaledVector(this.v, (upWall ? 2.3 : 1.0) / speed);
    }
    // air drag and deep snow
    const cda = 0.55 - 0.3 * this.tuck + 0.2 * this.brake;
    a.addScaledVector(this.v, -0.5 * 1.2 * cda / 78 * speed);
    if (this.surf === 1) a.addScaledVector(this.v, -0.0045 * speed);
    if (speed < 0.6 && !I.tuck && this.v.dot(_n.set(0, -1, 0)) < 0.2 && N > 9 && Math.abs(this.p.y - baseLine(this.p.z)) < 50 && a.length() < 0.4) a.multiplyScalar(0);
    this.v.addScaledVector(a, dt);
    this.v.addScaledVector(n, -this.v.dot(n));
    // pop
    if (!I.crouch && this.charge > 0.05) {
      const pop = 1.0 + 2.9 * this.charge;
      const spin = this.windup * 7.5 + this.turnRate * 0.8;
      this.charge = 0;
      if (this.charge === 0 && pop > 1.4) { this.takeoff(dt, pop, spin, 'pop'); this.windup = 0; return; }
    }
    if (!I.crouch) this.windup *= Math.max(0, 1 - dt * 3);
    this.charge = I.crouch ? this.charge : 0;
    // move, and leave the snow where it curves away faster than gravity can follow
    const nx = this.p.x + this.v.x * dt, nz = this.p.z + this.v.z * dt;
    const ny = this.p.y + this.v.y * dt;
    const by = ny - 0.5 * G * dt * dt;
    const h1 = height(nx, nz);
    if (by > h1 + 0.004 && speed > 2) { this.takeoff(dt, 0, this.turnRate * 0.9, 'lip'); return; }
    this.p.set(nx, ny, nz);
    for (let k = 0; k < 2; k++) {
      const h = height(this.p.x, this.p.z); normalBehind(this.p.x, this.p.z, this.v.x, this.v.z, n);
      const gap = h - this.p.y; this.p.addScaledVector(n, gap * n.y);
    }
    this.v.addScaledVector(n, -this.v.dot(n));
    this.toTangent(this.f);
    this.groundQ();
    this.railCheck();
    if (this.treeHit()) return;
    // remember safe places
    this.safeT += dt;
    if (this.safeT > 0.25 && (this.surf !== 2 || n.y > 0.985) && speed > 1.5 && Math.abs(this.edge) < 0.9) {
      this.safeT = 0; this.safe.push({ p: this.p.clone(), f: this.f.clone(), v: this.v.clone() }); if (this.safe.length > 60) this.safe.shift();
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
    this.state = 'air'; this.tState = 0; this.tAir = 0;
    this.com.copy(this.p).addScaledVector(this.up, COM * (1 - this.crouch * 0.35));
    const up = this.up;
    this.w.copy(up).multiplyScalar(spin);
    // the natural rotation of a good takeoff: the body turns forward through the air to meet the landing's slope
    const pr = this.predictLanding();
    if (pr) {
      const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
      const u1 = up.clone().addScaledVector(left, -up.dot(left)), n1 = pr.n.clone().addScaledVector(left, -pr.n.dot(left));
      const ang = Math.atan2(new THREE.Vector3().crossVectors(u1, n1).dot(left), u1.dot(n1));
      if (Math.abs(ang) < 1.4) this.w.addScaledVector(left, ang / Math.max(0.3, pr.T * 0.92));
      this.natural = ang;
    } else this.natural = 0;
    this.lastPress = this.press;
    const inPipe = [this.park.pipe, this.park.qp].some(pp => pp && n.y < 0.55 && this.p.z > pp.z0 && this.p.z < pp.z1 && this.p.x > pp.x0 && this.p.x < pp.x1);
    this.events.push({ type: 'takeoff', how, sw: this.sw, speed: this.v.length(), press: this.press, butter: Math.abs(this.press) > 0.35, rail: !!this.rail, pipe: inPipe });
    this.press = 0; this.endButter();
    this.grab = null; this.grabT = 0;
  }
  stepAir(dt, I) {
    this.tAir += dt;
    // rotation about the body's own axes
    const q = this.q;
    const up = _v.set(0, 1, 0).applyQuaternion(q), left = _n.set(1, 0, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const grabbing = !!I.grab || !!I.pose;
    const acc = grabbing ? 0.6 : 1;
    const ws = this.w.dot(up), wf = this.w.dot(left), wr = this.w.dot(fwd);
    let ns = ws, nf = wf, nr = wr;
    if (I.spin) ns += -I.spin * (Math.sign(-I.spin) === Math.sign(ns) || Math.abs(ns) < 0.5 ? 22 : 30) * acc * dt; else ns *= 1 - dt * 0.15;
    if (I.flip) nf += I.flip * 14 * acc * dt; else nf *= 1 - dt * 0.6;
    if (I.tilt) nr += I.tilt * 6 * acc * dt; else nr *= 1 - dt * 0.8;
    ns = clamp(ns, -13.5, 13.5); nf = clamp(nf, -10, 10); nr = clamp(nr, -6, 6);
    // spotting the landing: near the snow with nothing pressed, the body settles towards a landable attitude
    const tl = this.timeToGround();
    const assist = !I.spin && !I.flip && !I.tilt && tl < 0.45 ? 1 : 0;
    if (assist) { const k = Math.max(0, 1 - dt * 5); ns *= k; nf *= k; nr *= k; }
    this.w.set(0, 0, 0).addScaledVector(up, ns).addScaledVector(left, nf).addScaledVector(fwd, nr);
    const wl = this.w.length();
    if (wl > 1e-5) { _q.setFromAxisAngle(_w.copy(this.w).divideScalar(wl), wl * dt); q.premultiply(_q).normalize(); }
    if (assist) this.alignForLanding(dt * 4);
    // grabs and positions
    if (I.grab !== this.grab) { if (this.grab) this.events.push({ type: 'grabEnd', id: this.grab, t: this.grabT }); this.grab = I.grab; this.grabT = 0; if (I.grab) this.events.push({ type: 'grab', id: I.grab }); }
    if (this.grab) this.grabT += dt;
    this.pose = I.pose || null;
    this.crouch += ((grabbing ? 0.75 : I.crouch ? 0.6 : 0.3) - this.crouch) * Math.min(1, dt * 6);
    // flight
    const sp = this.v.length();
    this.v.y -= G * dt;
    this.v.addScaledVector(this.v, -0.5 * 1.2 * (grabbing ? 0.42 : 0.5) / 78 * sp * dt);
    this.com.addScaledVector(this.v, dt);
    const comH = COM * (1 - this.crouch * 0.35);
    this.p.copy(this.com).addScaledVector(_w.set(0, 1, 0).applyQuaternion(q), -comH);
    this.events.push({ type: 'air', dq: wl * dt });
    if (this.railCheck()) return;
    if (this.treeHit()) return;
    const h = height(this.p.x, this.p.z);
    if (this.p.y <= h && this.tAir > 0.03) this.land(h);
    else if (this.tAir > 25) this.crash('lost');
  }
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
  timeToGround() {
    // when the flight path meets the snow (a few coarse steps)
    let x = this.p.x, y = this.p.y, z = this.p.z, vy = this.v.y;
    for (let t = 0; t < 1.2; t += 0.05) {
      if (y <= height(x, z)) return t;
      x += this.v.x * 0.05; z += this.v.z * 0.05; y += vy * 0.05; vy -= G * 0.05;
    }
    return 9;
  }
  // turn a little towards the nearest landable attitude: up along the snow's normal, skis along the travel
  alignForLanding(k) {
    const n = normal(this.p.x + this.v.x * 0.2, this.p.z + this.v.z * 0.2, new THREE.Vector3());
    const t = this.v.clone().addScaledVector(n, -this.v.dot(n)).normalize();
    const fwd = this.fwd; if (fwd.dot(t) < 0) t.negate();
    const up = this.up;
    if (up.angleTo(n) > 0.9 || fwd.angleTo(t) > 0.9) return;
    const left = new THREE.Vector3().crossVectors(n, t).normalize();
    _m.makeBasis(left, n, new THREE.Vector3().crossVectors(left, n));
    _q.setFromRotationMatrix(_m);
    this.q.slerp(_q, Math.min(1, k));
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
    if (aUp > 52 || aDir > 50 || vn > 13.5) q = 'crash';
    else if (aUp > 30 || aDir > 24 || grabbing || this.pose || vn > 10) q = 'sketchy';
    this.events.push({ type: 'land', q, aUp, aDir, vn, sw, wasSw: this.sw, tAir: this.tAir });
    if (this.grab) { this.events.push({ type: 'grabEnd', id: this.grab, t: this.grabT }); this.grab = null; }
    this.pose = null;
    this.p.y = h;
    if (q === 'crash') { this.crash('land'); return; }
    this.sw = sw;
    const fa = fwd.clone().addScaledVector(n, -fwd.dot(n)).normalize();
    this.f.copy(fa).multiplyScalar(1);
    if (sw) this.f.copy(fa);           // the heading is the skis' forward, travel is opposite when switch
    this.v.addScaledVector(n, -this.v.dot(n));
    const loss = q === 'sketchy' ? 0.72 : Math.max(0.86, 1 - vn * 0.012);
    this.v.multiplyScalar(loss);
    // the skis line up with the travel at once (small errors are absorbed by the knees)
    if (vt.length() > 0.5) {
      const tr = vt.clone().multiplyScalar(sw ? -1 : 1);
      this.f.lerp(tr, q === 'clean' ? 0.85 : 0.5).normalize();
    }
    this.w.set(0, 0, 0);
    this.state = 'ground'; this.tState = 0; this.crouch = Math.min(0.95, 0.4 + vn * 0.06);
    this.lastLanding = { q, vn };
    this.groundQ();
  }

  // trees: a trunk met at speed is a crash; slowly, it stops you and you slide round it
  treeHit() {
    if (!this.trees) return false;
    const h = this.trees.hit(this.p.x, this.p.z, 0.3);
    if (!h || this.p.y > h.t.y + h.t.s * 0.95) return false;
    const vn = this.v.x * -h.nx + this.v.z * -h.nz;
    if (vn > 4.5) { this.v.multiplyScalar(0.2); this.v.x += h.nx * 2; this.v.z += h.nz * 2; this.crash('tree'); return true; }
    this.p.x = h.t.x + h.nx * h.R; this.p.z = h.t.z + h.nz * h.R;
    if (vn > 0) { this.v.x += h.nx * vn; this.v.z += h.nz * vn; }
    return false;
  }

  // ---- rails and boxes ----------------------------------------------------------------------------------------------
  railCheck() {
    if (this.state === 'rail' || this.railCooldown > 0) return false;
    for (const r of this.park.rails) {
      if (!r.box.containsPoint(this.p)) continue;
      const c = r.closest(this.p);
      const tol = r.w / 2 + 0.28;
      if (c.dh > tol) continue;
      if (c.dy < -0.16 || c.dy > 0.32) continue;
      if (this.state === 'air' && this.v.y > 1.0 && c.dy < 0) continue;
      const along = this.v.dot(c.dir);
      if (Math.abs(along) < 1.6) continue;
      this.lockRail(r, c, along);
      return true;
    }
    return false;
  }
  lockRail(r, c, along) {
    const wasAir = this.state === 'air';
    this.rail = r; this.railS = c.s; this.railDir = Math.sign(along); this.railV = Math.abs(along);
    // how the skis sit on it: along it (50-50) or across it (a slide)
    const fwd = this.fwd; fwd.y = 0; fwd.normalize();
    const d = new THREE.Vector3(c.dir.x, 0, c.dir.z).normalize().multiplyScalar(this.railDir);
    const ang = Math.atan2(new THREE.Vector3().crossVectors(d, fwd).y, d.dot(fwd));   // + = skis turned left of travel
    const a = Math.abs(ang);
    this.railMode = a < 0.75 ? '5050' : a > Math.PI - 0.75 ? '5050' : 'slide';
    this.railSw = a > Math.PI - 0.75 || (this.railMode === 'slide' && false);
    this.railFace = Math.sign(ang) || 1;                   // which way a slide faces
    this.balance = (Math.random() - 0.5) * 0.3; this.balanceV = 0;
    this.state = 'rail'; this.tState = 0;
    this.grab = null; this.pose = null;
    this.railPress = 0;
    this.events.push({ type: 'railOn', rail: r, mode: this.railMode, sw: this.railSw, fromAir: wasAir, ang, kind: r.kind });
    this.setRailQ();
  }
  setRailQ() {
    const d = this.rail.dirAt(this.railS).clone().multiplyScalar(this.railDir);
    const up = UP.clone();
    let fwd;
    if (this.railMode === '5050') fwd = this.railSw ? d.clone().negate() : d.clone();
    else { fwd = new THREE.Vector3().crossVectors(up, d).normalize().multiplyScalar(this.railFace); }
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = new THREE.Vector3().crossVectors(up, fwd).normalize();
    _m.makeBasis(left, up, new THREE.Vector3().crossVectors(left, up));
    _q.setFromRotationMatrix(_m);
    // lean a little with the balance
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.balance * 0.35));
    this.q.slerp(_q, this.tState < 0.05 ? 1 : 0.35);
  }
  stepRail(dt, I) {
    const r = this.rail;
    const d = r.dirAt(this.railS);
    const gAlong = -G * d.y * this.railDir;                 // gravity along the travel
    const mu = r.kind === 'box' ? 0.09 : 0.07;
    this.railV += (gAlong - mu * G - 0.004 * this.railV * this.railV) * dt;
    if (this.railV < 0.4) { this.leaveRail(dt, 0.5, 0, 'stall'); return; }
    this.railS += this.railV * this.railDir * dt;
    // balance: it drifts, the steering keys or the mouse hold it
    this.balanceV += ((Math.random() - 0.5) * 6 + this.balance * 2.6 + I.steer * 4.2 - this.balanceV * 1.6) * dt;
    this.balance += this.balanceV * dt;
    this.railPress += ((I.butter ? I.press : 0) - this.railPress) * Math.min(1, dt * 8);
    this.crouch += ((I.crouch ? 0.8 : 0.35) - this.crouch) * Math.min(1, dt * 8);
    if (Math.abs(this.balance) > 1) { this.events.push({ type: 'railFall' }); this.leaveRail(dt, 0.3, 0, 'fall'); this.crash('rail'); return; }
    // a swap: spin input turns the skis across to the other side (or to switch on a 50-50)
    if (I.spin && !this.swapping && this.tState > 0.2) { this.swapping = { t: 0, dir: Math.sign(I.spin) }; }
    if (this.swapping) {
      this.swapping.t += dt;
      if (this.swapping.t > 0.32) {
        if (this.railMode === 'slide') this.railFace = -this.railFace; else this.railSw = !this.railSw;
        this.events.push({ type: 'railSwap', dir: this.swapping.dir, mode: this.railMode }); this.swapping = null;
      }
    }
    if (this.railS < 0 || this.railS > r.len) { this.leaveRail(dt, 0.6, 0, 'end'); return; }
    const pt = r.at(this.railS);
    this.p.copy(pt);
    this.v.copy(r.dirAt(this.railS)).multiplyScalar(this.railV * this.railDir);
    this.setRailQ();
    if (this.swapping) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.swapping.dir * Math.PI * this.swapping.t / 0.32));
    if (!I.crouch && this.charge > 0.05) { const pop = 0.8 + 2.4 * this.charge; this.charge = 0; this.leaveRail(dt, pop, this.windup * 7, 'pop'); this.windup = 0; return; }
    if (I.crouch) { this.charge = Math.min(1, this.charge + dt * 2.5); this.windup = clamp(this.windup + I.steer * dt * 2.4, -1, 1); }
    else this.charge = 0;
  }
  leaveRail(dt, pop, spin, how) {
    this.events.push({ type: 'railOff', how, press: this.railPress });
    this.rail = null; this.railCooldown = 0.25;
    this.state = 'air'; this.tState = 0; this.tAir = 0;
    this.v.y += pop;
    this.com.copy(this.p).addScaledVector(this.up, COM * (1 - this.crouch * 0.35));
    this.w.copy(this.up).multiplyScalar(spin);
    this.events.push({ type: 'takeoff', how: 'rail', sw: this.sw, speed: this.v.length(), rail: true });
    this.swapping = null;
  }

  // ---- crashes ------------------------------------------------------------------------------------------------------
  crash(why) {
    this.state = 'crash'; this.tState = 0; this.grab = null; this.pose = null; this.rail = null;
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
    // a safe spot about three seconds before
    const s = this.safe.length > 12 ? this.safe[this.safe.length - 12] : this.safe[0];
    this.safe.length = Math.max(0, this.safe.length - 12);
    if (s) { this.spawn(s.p.x, s.p.z, 0, Math.atan2(s.f.x, s.f.z)); this.v.copy(s.v).multiplyScalar(0.5); }
    else this.spawn(0, -20, 0, 0);
    this.events.push({ type: 'respawn' });
  }
}
