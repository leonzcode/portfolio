// Cameras: chase (behind the travel, held steady through spins), far chase, first person (a helmet camera at the
// rider's eyes, turning with the head) and filmer (tripod spots beside the features, panning and zooming to follow).
import * as THREE from 'three';
import { height } from './terrain.js?v=17';

const MODES = ['chase', 'far', 'pov', 'film'];
const _lf = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);   // (L: the chairlift's look round)
export class Cams {
  constructor(camera, park) {
    this.cam = camera; this.mode = 'chase';
    this.dir = new THREE.Vector3(0, 0, 1); this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.fov = 70; this.first = true;
    // filmer spots: beside each kicker's landing and lip, the pipe, the rail garden
    this.spots = [];
    for (const k of park.kickers) {
      this.spots.push(new THREE.Vector3(k.x + 14, 0, k.L.z + 2), new THREE.Vector3(k.x - 13, 0, k.zMeet - 2));
    }
    const p = park.pipe; if (p) for (let z = p.z0 + 25; z < p.z1; z += 45) this.spots.push(new THREE.Vector3(p.x + p.F + p.R + 3, 0, z));
    for (const r of park.rails) this.spots.push(new THREE.Vector3(r.P[0].x + 7, 0, (r.P[0].z + r.P[r.P.length - 1].z) / 2));
    for (const s of this.spots) s.y = height(s.x, s.z) + 1.6;
    this.spots.sort((a, b) => a.z - b.z);
  }
  set(mode) { this.mode = mode; this.first = true; }
  // looking round (on the chairlift: the turn keys swing the chase camera round the chair, -1 .. 1; let go, it comes back)
  // (L: named lookRound, not look: this.look is the camera's look-at point, set in the constructor, and hid the method)
  // The view turns the way of the key (right looks right, as the mouse does: orbit < 0 turns the view right); the turn
  // speeds up and slows down over about a tenth of a second instead of starting and stopping dead.
  lookRound(u, dt) {
    const want = u ? -u * 1.6 : 0;
    this.orbitV = (this.orbitV || 0) + (want - (this.orbitV || 0)) * Math.min(1, dt * 10);
    this.orbit = (this.orbit || 0) + (u ? this.orbitV * dt : -(this.orbit || 0) * Math.min(1, dt * 1.5));
    this.orbit = Math.max(-2.6, Math.min(2.6, this.orbit));
  }
  next() { this.set(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]); return this.mode; }
  update(dt, sk, rig) {
    if (this.mode === 'fixed') return;
    const cam = this.cam, k = this.first ? 1 : 1 - Math.exp(-dt * 6);
    this.cam.layers.enable(1);
    // the body's middle: in the air the centre of mass, on the snow the same height over the feet, so takeoffs and
    // landings do not jolt the camera (the crouch it follows is already eased)
    const comH = sk.comH ? sk.comH() : 0.92 * (1 - (sk.crouch ?? 0.3) * 0.35);
    const body = sk.state === 'crash' || sk.state === 'air' ? sk.com.clone() : sk.p.clone().add(new THREE.Vector3(0, comH, 0));
    if (this.mode === 'pov' && rig.eye) {
      this.cam.layers.disable(1);
      const q = rig.headQ.clone();
      // look a little down the slope, and keep the horizon from rolling too much on the snow
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      if (sk.state !== 'air') up.lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
      // (L) on the chairlift the look keys and the mouse turn the head camera too (the same orbit as the chase camera's)
      if (sk.state === 'lift' && this.orbit) { fwd.applyAxisAngle(_Y, this.orbit); up.applyAxisAngle(_Y, this.orbit); }
      const target = rig.eye.clone().add(fwd).addScaledVector(up, -0.28);
      cam.position.copy(rig.eye);
      cam.up.copy(up); cam.lookAt(target);
      this.fov += (92 - this.fov) * Math.min(1, dt * 4);
      cam.near = 0.05;
    } else if (this.mode === 'film') {
      // the spot nearest ahead of the rider
      let s = null, best = Infinity;
      for (const c of this.spots) { const d = c.distanceTo(body); if (c.z > body.z - 25 && d < best) { best = d; s = c; } }
      if (!s) s = this.spots[this.spots.length - 1];
      if (!s || best > 70) {
        // no built feature near: a tripod set up ahead of the rider, moved on once they have gone past it
        if (!this.free || this.free.distanceTo(body) > 70 || (sk.v && this.free.clone().sub(body).dot(sk.v) < -8)) {
          const v = sk.v ? sk.v.clone().setY(0) : new THREE.Vector3(0, 0, 1); if (v.lengthSq() < 0.1) v.set(0, 0, 1); v.normalize();
          this.free = body.clone().addScaledVector(v, 28).add(new THREE.Vector3(-v.z * 10, 0, v.x * 10));
          this.free.y = height(this.free.x, this.free.z) + 1.7;
        }
        s = this.free;
      }
      if (this.spot !== s) { this.spot = s; this.first = true; }
      cam.position.copy(s);
      this.look.lerp(body, this.first ? 1 : 1 - Math.exp(-dt * 8));
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
      const dist = s.distanceTo(body);
      const want = THREE.MathUtils.clamp(2 * Math.atan(4.5 / dist) * 180 / Math.PI, 18, 75);
      this.fov += (want - this.fov) * Math.min(1, dt * 3);
      cam.near = 0.3;
    } else {
      const far = this.mode === 'far';
      const dist = far ? 9.5 : 4.2, hgt = far ? 3.6 : 1.55;
      // follow the travel on the snow; hold the direction from the takeoff in the air
      if (sk.state === 'ground' || sk.state === 'rail') {
        const v = sk.v.clone(); v.y = 0;
        if (v.lengthSq() > 0.5) this.dir.lerp(v.normalize(), this.first ? 1 : 1 - Math.exp(-dt * 3)).normalize();
      } else if (sk.state === 'lift' && sk.q) {
        // on the chairlift: behind the chair, the way it faces, swung round by lookRound() (L: eased by its angle rather
        // than by blending two directions, so even a big turn of the look goes round evenly)
        const f = _lf.set(0, 0, 1).applyQuaternion(sk.q); f.y = 0;
        if (f.lengthSq() > 1e-4) {
          // (orbitAuto: lift.js's own swing out past a tower, while the rider is not looking round)
          const want = Math.atan2(f.x, f.z) + Math.max(-2.6, Math.min(2.6, (this.orbit || 0) + (this.orbitAuto || 0))), now = Math.atan2(this.dir.x, this.dir.z);
          const d = Math.atan2(Math.sin(want - now), Math.cos(want - now)), a = this.first ? want : now + d * (1 - Math.exp(-dt * 4));
          this.dir.set(Math.sin(a), 0, Math.cos(a));
        }
      }
      const want = body.clone().addScaledVector(this.dir, -dist); want.y += hgt;
      if (sk.state === 'air') want.y += 0.9;
      if (sk.state === 'lift') want.y += 1.2;
      const gy = height(want.x, want.z) + 0.7; if (want.y < gy) want.y = gy;
      this.pos.lerp(want, this.first ? 1 : 1 - Math.exp(-dt * (sk.state === 'air' ? 6 : 8)));
      const gy2 = height(this.pos.x, this.pos.z) + 0.5; if (this.pos.y < gy2) this.pos.y = gy2;
      cam.position.copy(this.pos);
      this.look.lerp(body.clone().addScaledVector(this.dir, far ? 3 : 2.2), k);
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
      const sp = sk.v.length();
      this.fov += (66 + Math.min(14, sp * 0.45) - this.fov) * Math.min(1, dt * 2);
      cam.near = 0.15;
    }
    cam.fov = this.fov; cam.updateProjectionMatrix();
    this.first = false;
  }
}
