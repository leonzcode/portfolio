// A car as one rigid body on four sprung wheels. Each wheel finds the ground under it, its spring and damper push
// the body up, and its tyre pushes along the road (drive, brakes) and across it (grip that peaks at about 8
// degrees of slip and falls off after, so the back can step out under the handbrake). Automatic gearbox with a
// torque curve, aerodynamic drag, rolling resistance. The body is a row of circles in plan for hitting things.
// Body frame: forward -z, right +x, up +y, origin on the ground between the axles at rest.
import * as THREE from 'three';

const G = 9.81;
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _f = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3(), _q = new THREE.Quaternion();

export const DEFAULTS = {
  mass: 1550, comHeight: 0.52, power: 220e3, torque: 420, redline: 6800, idle: 850,
  gears: [3.55, 2.24, 1.55, 1.17, 0.92, 0.76], final: 3.6, reverse: 3.2, drive: 'rwd',
  mu: 1.05, brake: 13000, handbrake: 0.85, maxSteer: 34, steerRatio: 14.5,
  springHz: 1.65, damping: 0.38, travelUp: 0.13, travelDown: 0.17, arb: 26000,
  cd: 0.31, area: 2.2, topSpeed: 250,
};

export class Vehicle {
  constructor(rig, spec = {}) {
    const p = this.p = { ...DEFAULTS, ...spec };
    this.rig = rig;
    const d = rig.dims;
    this.len = d.length; this.wid = d.width; this.hgt = d.height;
    this.wheels = rig.wheels.map((w, i) => ({
      i, rest: w.pos.clone(), r: w.radius, steer: !!w.steer, left: w.pos.x < 0, front: i < 2,
      x: 0, xPrev: 0, contact: false, load: 0, spin: 0, omega: 0, slip: 0, lat: 0, gh: null, gn: new THREE.Vector3(0, 1, 0), gx: NaN, gz: NaN,
      driven: p.drive === 'awd' || (p.drive === 'fwd' ? i < 2 : i >= 2),
    }));
    this.com = new THREE.Vector3(0, p.comHeight, (rig.wheels[0].pos.z + rig.wheels[2].pos.z) / 2 * 0.1);
    const m = p.mass, L = d.length, W = d.width, H = 1.1;
    this.Ib = new THREE.Vector3(m / 12 * (H * H + L * L) * 0.75, m / 12 * (W * W + L * L) * 0.8, m / 12 * (W * W + H * H) * 0.9);
    this.k = (m / 4) * (2 * Math.PI * p.springHz) ** 2;
    this.c = 2 * p.damping * Math.sqrt(this.k * m / 4);
    this.pos = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.steer = 0; this.steerIn = 0; this.gear = 1; this.rpm = p.idle; this.throttle = 0; this.brake = 0; this.reverse = false;
    this.handbrake = 0; this.speed = 0; this.fwdSpeed = 0; this.shiftT = 0; this.revWait = 0; this.hits = []; this.airTime = 0;
    this.circles = [];
    const n = Math.max(3, Math.ceil(L / W) + 1), r = W / 2 * 0.96;
    for (let i = 0; i < n; i++) this.circles.push({ o: -(L / 2 - r) + (L - 2 * r) * i / (n - 1), r, x: 0, z: 0, y0: 0, y1: 0 });
  }

  // put the body at a point on the ground facing a heading (degrees clockwise from north)
  place(x, y, z, heading) {
    this.q.setFromAxisAngle(_a.set(0, 1, 0), -heading * Math.PI / 180);
    this.pos.set(x, y, z).add(_a.copy(this.com).applyQuaternion(this.q));
    this.pos.y += 0.05;
    this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    for (const w of this.wheels) { w.x = w.xPrev = 0; w.gx = NaN; }
    this.gear = 1; this.reverse = false; this.steer = 0;
  }

  get heading() { _a.set(0, 0, -1).applyQuaternion(this.q); return (Math.atan2(_a.x, -_a.z) * 180 / Math.PI + 360) % 360; }
  // the rig's origin (on the ground between the axles) in the world
  origin(out = new THREE.Vector3()) { return out.copy(this.com).applyQuaternion(this.q).negate().add(this.pos); }

  invI(out, x, y, z) {
    // world inverse inertia applied to (x, y, z)
    _r.set(x, y, z).applyQuaternion(_q.copy(this.q).invert());
    _r.set(_r.x / this.Ib.x, _r.y / this.Ib.y, _r.z / this.Ib.z).applyQuaternion(this.q);
    return out.copy(_r);
  }

  // input: { throttle 0..1, brake 0..1, steer -1..1 (+ left), handbrake 0..1 }
  // env: { ground(x, z, yHint) -> height or null, collide (Collide), others: [{ x, z, r, vx, vz, obj }] }
  step(dt, input, env) {
    const p = this.p, m = p.mass;
    const up = _a.set(0, 1, 0).applyQuaternion(this.q).clone();
    const fwd = _a.set(0, 0, -1).applyQuaternion(this.q).clone();
    const right = _a.set(1, 0, 0).applyQuaternion(this.q).clone();
    this.fwdSpeed = this.v.dot(fwd);
    this.speed = this.v.length();
    const kmh = Math.abs(this.fwdSpeed) * 3.6;

    // steering: smoothed, less lock at speed
    const lock = p.maxSteer * Math.PI / 180 * (1 / (1 + (kmh / 52) ** 1.6));
    const target = input.steer * lock;
    const rate = (Math.sign(target) !== Math.sign(this.steer) || Math.abs(target) < Math.abs(this.steer) ? 3.2 : 2.0) * lock + 0.4;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);
    // self-aligning: the wheel follows the car's motion a little at speed
    this.steerIn = input.steer;

    // forward / reverse logic: holding brake at a standstill selects reverse, throttle selects drive
    let thr = input.throttle, brk = input.brake;
    if (this.reverse) { [thr, brk] = [input.brake, input.throttle]; }
    if (Math.abs(this.fwdSpeed) < 0.6) {
      if (!this.reverse && input.brake > 0.5 && input.throttle < 0.1) { this.revWait += dt; if (this.revWait > 0.25) { this.reverse = true; this.revWait = 0; } }
      else if (this.reverse && input.throttle > 0.5 && input.brake < 0.1) { this.revWait += dt; if (this.revWait > 0.15) { this.reverse = false; this.revWait = 0; } }
      else this.revWait = 0;
    } else this.revWait = 0;
    this.throttle = thr; this.brake = brk; this.handbrake = input.handbrake || 0;

    // engine and gearbox
    const wheelR = this.wheels[2].r;
    const dir = this.reverse ? -1 : 1;
    const ratio = (this.reverse ? p.reverse : p.gears[this.gear - 1]) * p.final;
    const wheelRpm = Math.abs(this.fwdSpeed) / wheelR * 60 / (2 * Math.PI);
    let rpm = Math.max(p.idle, wheelRpm * ratio);
    if (!this.reverse) {
      this.shiftT -= dt;
      if (this.shiftT <= 0) {
        if (rpm > p.redline * 0.93 && this.gear < p.gears.length) { this.gear++; this.shiftT = 0.35; }
        else if (this.gear > 1 && wheelRpm * p.gears[this.gear - 2] * p.final < p.redline * (thr > 0.8 ? 0.62 : 0.45)) { this.gear--; this.shiftT = 0.35; }
      }
    }
    // a clutch slipping near a standstill lets the engine rev
    const freeRev = p.idle + thr * (p.redline * 0.55 - p.idle);
    if (wheelRpm * ratio < freeRev && thr > 0.05) rpm = THREE.MathUtils.lerp(rpm, freeRev, 0.6);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 12);
    const tq = p.torque * torqueCurve(this.rpm / p.redline);
    let driveF = thr * tq * ratio * 0.88 / wheelR;
    driveF = Math.min(driveF, thr * p.power / Math.max(3, Math.abs(this.fwdSpeed)));
    if (this.shiftT > 0.2) driveF *= 0.25;
    if (this.rpm > p.redline * 1.02 || kmh > p.topSpeed || (this.reverse && kmh > 32)) driveF = 0;
    const nDriven = this.wheels.filter(w => w.driven).length;

    const F = _f.set(0, -G * m, 0), T = _t.set(0, 0, 0);
    // aerodynamic drag
    const v2 = this.speed * this.speed;
    if (this.speed > 0.01) F.addScaledVector(this.v, -0.5 * 1.225 * p.cd * p.area * this.speed);

    let grounded = 0;
    const L0 = p.travelUp;
    for (const w of this.wheels) {
      // the top of the wheel's travel, in the world
      const mount = _b.copy(w.rest).sub(this.com).addScaledVector(_c.set(0, 1, 0), L0).applyQuaternion(this.q).add(this.pos);
      const gx = mount.x, gz = mount.z;
      // ground: sampled again once the wheel has moved 0.25 m, as a plane in between
      if (!(Math.abs(gx - w.gx) < 0.25 && Math.abs(gz - w.gz) < 0.25)) {
        const yh = mount.y - L0 - w.r;
        const h = env.ground(gx, gz, yh);
        if (h !== null && h !== undefined) {
          const hx = env.ground(gx + 0.3, gz, yh), hz = env.ground(gx, gz + 0.3, yh);
          const dx = hx == null || Math.abs(hx - h) > 0.25 ? 0 : (hx - h) / 0.3, dz = hz == null || Math.abs(hz - h) > 0.25 ? 0 : (hz - h) / 0.3;
          w.gn.set(-dx, 1, -dz).normalize();
          w.gh = h; w.gx = gx; w.gz = gz;
        } else if (w.gh === null) { w.gh = mount.y - 50; }
      }
      let h = w.gh + (-(gx - w.gx) * w.gn.x - (gz - w.gz) * w.gn.z) / w.gn.y;
      // something more than a kerb above the wheel is a wall, not ground
      const wall = h > mount.y - L0 - w.r + 0.42;
      if (wall) { this.wallAt = this.wallAt || []; this.wallAt.push(w); }
      // a tyre rolls up a step over a short distance instead of jumping it in one step
      if (w.ge === undefined || !w.contact || Math.abs(h - w.ge) > 1) w.ge = h;
      else if (h > w.ge) w.ge = Math.min(h, w.ge + (0.3 + Math.abs(this.fwdSpeed) * 0.55) * dt);
      else w.ge = h;
      h = w.ge;
      const upY = Math.max(0.2, up.y);
      const dist = (mount.y - h) / upY;     // from the mount down to the ground along the body's up
      const s = dist - w.r;                  // hub's distance below the mount
      w.xPrev = w.x;
      if (wall || s > L0 + p.travelDown) {
        w.contact = false; w.load = 0; w.x = -p.travelDown;
        w.omega *= 0.995;
        if (w.driven && thr > 0.1) w.omega += dir * thr * 8 * dt * 10;
        continue;
      }
      w.contact = true; grounded++;
      w.x = L0 - s; // compression from the resting hub position
      const xdot = THREE.MathUtils.clamp((w.x - w.xPrev) / dt, -2.5, 2.5);
      let fs = m * G / 4 + this.k * w.x + this.c * xdot;
      if (w.x > L0 - 0.015) fs += this.k * 12 * Math.min(0.05, w.x - (L0 - 0.015)); // bump stop
      // anti-roll bar
      const other = this.wheels[w.i ^ 1];
      fs += p.arb * (w.x - other.x) * 0.5;
      fs = THREE.MathUtils.clamp(fs, 0, m * G * 1.6);
      w.load = fs;
      const P = _c.copy(mount).addScaledVector(up, -(s + w.r));
      const rel = P.clone().sub(this.pos);
      // tyre frame on the ground
      const n = w.gn;
      let wf = fwd.clone();
      if (w.steer) wf.applyAxisAngle(up, this.steer);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const ws = wf.clone().cross(n).normalize(); // to the right
      const vc = this.v.clone().add(_v.copy(this.w).cross(rel));
      const vl = vc.dot(wf), vs = vc.dot(ws);
      // (the rear a touch grippier than the front: the car pushes wide at the limit instead of spinning)
      const mu = p.mu * (env.grip ? env.grip(gx, gz) : 1) * (w.front ? 1 : 1.07);
      const Fz = fs;
      // across the tyre
      const alpha = Math.atan2(vs, Math.max(Math.abs(vl), 1.5));
      let fy = -mu * Fz * Math.sin(1.6 * Math.atan(10 * alpha));
      const low = THREE.MathUtils.clamp(1 - (Math.abs(vl) - 1) / 3, 0, 1);
      if (low > 0) fy = THREE.MathUtils.lerp(fy, THREE.MathUtils.clamp(-vs * m / 4 / 0.08, -mu * Fz, mu * Fz), low);
      // along the tyre
      let fx = 0;
      if (w.driven) fx += dir * driveF / nDriven;
      const bForce = brk * Math.max(p.brake, m * G * 1.1) / 4 * (w.front ? 1.3 : 0.7) + (!w.front ? this.handbrake * mu * Fz * p.handbrake : 0);
      if (bForce > 0) fx += -THREE.MathUtils.clamp(vl / 0.4, -1, 1) * bForce;
      fx += -THREE.MathUtils.clamp(vl / 0.5, -1, 1) * 0.013 * Fz;
      if (!this.reverse && thr < 0.05 && brk < 0.05) fx += -THREE.MathUtils.clamp(vl / 0.5, -1, 1) * 0.02 * Fz; // engine braking
      // nearly stopped with nothing pressed: hold, on a hill too (the hold is only as strong as the tyre)
      if (thr < 0.05 && Math.abs(vl) < 1.2 && this.speed < 1.5) fx = -THREE.MathUtils.clamp(vl / 0.25, -1, 1) * mu * Fz * 0.9;
      if (!w.front && this.handbrake > 0.3) fy *= 0.45;
      // friction circle
      const lim = mu * Fz * 1.05, tot = Math.hypot(fx, fy);
      w.slip = 0;
      if (lim < 1e-3) { w.slip = tot > 1 ? 1 : 0; fx = 0; fy = 0; }
      else if (tot > lim) { w.slip = Math.min(3, tot / lim - 1); fx *= lim / tot; fy *= lim / tot; }
      w.lat = Math.abs(alpha);
      // wheel spin for the picture: rolling, plus spin when the drive is more than the tyre holds
      const roll = vl / w.r;
      w.omega = w.driven && w.slip > 0.15 && thr > 0.5 ? roll + dir * w.slip * 12 : (!w.front && this.handbrake > 0.3 && Math.abs(vl) > 1 ? 0 : (brk > 0.95 && Math.abs(vl) > 4 && w.slip > 0.3 ? 0 : roll));
      if (!Number.isFinite(w.omega)) w.omega = 0;
      // the road's push along the ground acts at a roll centre raised towards the centre of mass (as a car's
      // suspension geometry does), so hard cornering leans the body but rarely tips it over
      const Fg = wf.multiplyScalar(fx).addScaledVector(ws, fy), Fn = up.clone().multiplyScalar(fs);
      F.add(Fg).add(Fn);
      const relG = rel.clone().addScaledVector(up, p.comHeight * 0.5);
      T.add(relG.cross(Fg)).add(rel.cross(Fn));
    }
    this.airTime = grounded ? 0 : this.airTime + dt;

    // integrate
    this.v.addScaledVector(F, dt / m);
    const dw = this.invI(_v, T.x, T.y, T.z);
    this.w.addScaledVector(dw, dt);
    this.w.multiplyScalar(grounded ? 0.999 : 0.9995);
    // a little extra damping of roll and pitch (shock absorbers' share the springs above do not model)
    if (grounded) { const wu = this.w.dot(up); _a.copy(this.w).addScaledVector(up, -wu).multiplyScalar(1 - Math.min(1, 2.5 * dt)); this.w.copy(_a).addScaledVector(up, wu); }
    this.pos.addScaledVector(this.v, dt);
    const wl = this.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * dt); this.q.premultiply(_q).normalize(); }

    // wheels' turning for the picture
    for (const w of this.wheels) w.spin = (w.spin + w.omega * dt) % (Math.PI * 2);

    this.collide(env, up, fwd);
  }

  // a wheel against a step taller than a kerb (a wall of the photographed mesh, a terrain bank): push the car
  // back the way the ground falls away
  wallContacts(env, list) {
    const ws = this.wallAt; this.wallAt = null;
    if (!ws) return;
    for (const w of ws) {
      const P = _b.copy(w.rest).sub(this.com).applyQuaternion(this.q).add(this.pos);
      const y = P.y - w.r, e = 0.6;
      const hx1 = env.ground(P.x + e, P.z, y), hx0 = env.ground(P.x - e, P.z, y), hz1 = env.ground(P.x, P.z + e, y), hz0 = env.ground(P.x, P.z - e, y);
      if ([hx1, hx0, hz1, hz0].some(v => v === null || v === undefined)) continue;
      let nx = hx0 - hx1, nz = hz0 - hz1;
      const l = Math.hypot(nx, nz);
      if (l < 0.2) continue;
      nx /= l; nz /= l;
      list.push({ i: -1, nx, nz, depth: 0.04, px: P.x, pz: P.z, wall: true });
    }
  }

  collide(env, up, fwd) {
    this.hits.length = 0;
    const p = this.p, m = p.mass;
    const base = this.origin(_b);
    for (const c of this.circles) {
      c.x = base.x + fwd.x * c.o; c.z = base.z + fwd.z * c.o;
      c.y0 = base.y + 0.15; c.y1 = base.y + this.hgt;
    }
    const list = env.collide ? env.collide.contacts(this.circles) : [];
    if (env.others) for (const o of env.others) {
      for (let i = 0; i < this.circles.length; i++) {
        const c = this.circles[i], dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz), mm = c.r + o.r;
        if (d < mm && d > 1e-6) list.push({ i, nx: dx / d, nz: dz / d, depth: mm - d, px: o.x + dx / d * o.r, pz: o.z + dz / d * o.r, other: o });
      }
    }
    if (env.walls) env.walls(this, list);
    this.wallContacts(env, list);
    // deepest push per circle, then impulses
    for (const h of list) {
      const n = _n.set(h.nx, 0, h.nz);
      const push = Math.min(h.depth, 0.5) * (h.other ? 0.5 : 0.85);
      this.pos.addScaledVector(n, push);
      const rel = new THREE.Vector3(h.px, this.pos.y - 0.1, h.pz).sub(this.pos);
      const vp = this.v.clone().add(_v.copy(this.w).cross(rel));
      let ovx = 0, ovz = 0;
      if (h.other) { ovx = h.other.vx || 0; ovz = h.other.vz || 0; }
      const vn = (vp.x - ovx) * n.x + (vp.z - ovz) * n.z;
      if (vn >= 0) continue;
      const rn = rel.clone().cross(n);
      const k = 1 / m + n.dot(this.invI(_a, rn.x, rn.y, rn.z).cross(rel));
      const e = h.other ? 0.25 : 0.18;
      let j = -(1 + e) * vn / k;
      if (h.other) j *= 0.6;
      const J = n.clone().multiplyScalar(j);
      // scraping along the wall
      const tdir = _c.set(vp.x - ovx - vn * n.x, 0, vp.z - ovz - vn * n.z);
      const tl = tdir.length();
      if (tl > 0.01) {
        tdir.divideScalar(tl);
        const rt = rel.clone().cross(tdir);
        const kt = 1 / m + tdir.dot(this.invI(_a, rt.x, rt.y, rt.z).cross(rel));
        const jt = Math.min(tl / kt, 0.35 * j);
        J.addScaledVector(tdir, -jt);
      }
      this.v.addScaledVector(J, 1 / m);
      const rj = rel.clone().cross(J);
      this.w.add(this.invI(_a, rj.x, rj.y, rj.z).multiplyScalar(0.6));
      this.hits.push({ j, nx: n.x, nz: n.z, px: h.px, pz: h.pz, other: h.other, shape: h.shape, speed: -vn });
    }
  }

  // what the model shows: per wheel compression from rest, spin, the road wheel angle and the steering wheel
  look() {
    return {
      speed: this.fwdSpeed,
      wheelSpin: this.wheels.map(w => w.spin),
      steer: this.steer,
      steeringWheel: this.steer * this.p.steerRatio,
      susp: this.wheels.map(w => w.contact ? w.x : -this.p.travelDown),
      brake: this.brake > 0.05 ? 1 : 0,
      reverse: this.reverse,
    };
  }
}

// share of peak torque across the rev range (x = rpm / redline)
function torqueCurve(x) {
  if (x < 0.15) return 0.55;
  if (x < 0.55) return 0.55 + (x - 0.15) / 0.4 * 0.45;
  if (x < 0.85) return 1;
  return Math.max(0.4, 1 - (x - 0.85) * 3);
}
