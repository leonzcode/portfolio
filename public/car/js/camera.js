// Views of the car: chase (default), far chase, the driver's seat, hood, bumper, and a free orbit with the mouse.
// C cycles them. Dragging with the mouse looks round in any view and eases back when let go.
import * as THREE from 'three';

export const VIEWS = ['chase', 'far', 'driver', 'hood', 'bumper', 'orbit'];
const NAMES = { chase: 'Chase', far: 'Far chase', driver: 'Driver', hood: 'Hood', bumper: 'Bumper', orbit: 'Orbit' };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class CarCamera {
  constructor(camera, dom) {
    this.camera = camera; this.view = 'chase';
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yawOff = 0; this.pitchOff = 0; this.drag = false; this.lastMove = 0; this.dist = 1; this.ready = false;
    this.orbitYaw = 0.6; this.orbitPitch = 0.25; this.orbitDist = 9;
    this.fovBase = 62; this.shake = 0;
    let px = 0, py = 0;
    dom.addEventListener('pointerdown', e => { if (e.button !== 0 && e.button !== 2) return; this.drag = true; px = e.clientX; py = e.clientY; });
    addEventListener('pointerup', () => { this.drag = false; this.lastMove = performance.now(); });
    addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = (e.clientX - px) / innerHeight, dy = (e.clientY - py) / innerHeight; px = e.clientX; py = e.clientY;
      if (this.view === 'orbit') { this.orbitYaw -= dx * 3; this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 2, -0.1, 1.4); }
      else { this.yawOff -= dx * 3; this.pitchOff = THREE.MathUtils.clamp(this.pitchOff - dy * 2, -0.6, 0.6); }
      this.lastMove = performance.now();
    });
    dom.addEventListener('wheel', e => {
      if (this.view === 'orbit') this.orbitDist = THREE.MathUtils.clamp(this.orbitDist * (1 + Math.sign(e.deltaY) * 0.1), 4, 40);
      else if (this.view === 'chase' || this.view === 'far') this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.08), 0.6, 2.5);
    }, { passive: true });
    dom.addEventListener('contextmenu', e => e.preventDefault());
  }
  get name() { return NAMES[this.view]; }
  next(d = 1) { this.view = VIEWS[(VIEWS.indexOf(this.view) + d + VIEWS.length) % VIEWS.length]; this.ready = false; this.yawOff = this.pitchOff = 0; return this.view; }
  set(v) { if (VIEWS.includes(v)) { this.view = v; this.ready = false; } }
  inside() { return this.view === 'driver'; }

  // car: { obj (the rig's object, placed), vehicle, rig }; world: for keeping the chase camera out of walls
  update(dt, car, world, input = {}) {
    const cam = this.camera, o = car.rig.object, v = car.vehicle;
    o.updateMatrixWorld();
    const q = o.getWorldQuaternion(_q), base = o.getWorldPosition(_a);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // looking back (key) and the mouse's offset, which eases back two seconds after the last drag
    if (!this.drag && performance.now() - this.lastMove > 1500) { this.yawOff *= Math.exp(-dt * 2.5); this.pitchOff *= Math.exp(-dt * 2.5); }
    const yaw = this.yawOff + (input.lookBack ? Math.PI : 0) + (input.lookSide || 0);
    const speed = Math.abs(v.fwdSpeed);
    let fov = this.fovBase;
    if (this.view === 'chase' || this.view === 'far') {
      const far = this.view === 'far';
      const d = (far ? 9.5 : 6.2) * this.dist + car.rig.dims.length * 0.35, hgt = (far ? 3.4 : 2.0) * Math.sqrt(this.dist);
      // follow the direction of travel more than the nose, so a slide shows
      const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const vel = new THREE.Vector3(v.v.x, 0, v.v.z);
      if (vel.length() > 3 && v.fwdSpeed > 0) flat.lerp(vel.normalize(), 0.35).normalize();
      if (!this.ready) this.dirS = flat.clone(); else this.dirS.lerp(flat, 1 - Math.exp(-dt * 4)).normalize();
      const dir = this.dirS.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const want = base.clone().addScaledVector(dir, -d).add(new THREE.Vector3(0, hgt, 0));
      const target = base.clone().addScaledVector(dir, 2.5).add(new THREE.Vector3(0, 1.1 + this.pitchOff * 3, 0));
      // keep it out of walls and buildings
      if (world) {
        const from = base.clone().add(new THREE.Vector3(0, 1.4, 0)), to = want.clone().sub(from), len = to.length();
        const h = world.raycast(from, to.normalize(), len);
        if (h && h.distance < len) want.copy(from).addScaledVector(to, Math.max(1.5, h.distance - 0.4));
        const g = world.groundAt ? world.groundAt(want.x, want.z, want.y) : null;
        if (g !== null && g !== undefined && want.y < g + 0.6) want.y = g + 0.6;
      }
      if (!this.ready) { this.pos.copy(want); this.look.copy(target); this.ready = true; }
      const k = 1 - Math.exp(-dt * (far ? 5 : 7));
      this.pos.lerp(want, k);
      this.look.lerp(target, 1 - Math.exp(-dt * 12));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      fov += Math.min(12, speed * 0.12);
    } else if (this.view === 'orbit') {
      const off = new THREE.Vector3(Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch), Math.sin(this.orbitPitch), Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch)).multiplyScalar(this.orbitDist);
      const flat = Math.atan2(-fwd.x, -fwd.z);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), flat);
      const t = base.clone().add(new THREE.Vector3(0, 0.9, 0));
      cam.position.copy(t).add(off);
      cam.up.set(0, 1, 0);
      cam.lookAt(t);
      this.ready = true;
    } else {
      const m = car.rig.mounts;
      const mount = this.view === 'driver' ? m.driver : this.view === 'hood' ? m.hood : m.bumper;
      cam.position.copy(mount).applyMatrix4(o.matrixWorld);
      // the head is steadied against the body's roll and pitch a little, as a driver's neck does
      const look = new THREE.Quaternion().copy(q);
      _e.set(this.pitchOff - (this.view === 'driver' ? 0.06 : 0.03), yaw * (this.view === 'driver' ? 1 : 0.6), 0, 'YXZ');
      look.multiply(new THREE.Quaternion().setFromEuler(_e));
      cam.quaternion.copy(look);
      if (this.view === 'driver') {
        fov = 68;
        // turn the head into a bend a little
        cam.rotateY(-v.steer * 0.35);
      } else fov = 70;
      this.ready = true;
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
    cam.near = this.view === 'driver' ? 0.05 : 0.15; cam.updateProjectionMatrix();
  }
}
