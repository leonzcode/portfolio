// The player on foot. E in a car stops it (brakes, then the handbrake; the engine idles), the driver's door opens,
// the player's person climbs out and the door shuts; then a third-person camera follows the person (drag or the
// arrow keys to look, the wheel to come closer), W A S D walk, Shift runs, Space jumps, and the person is stopped
// by buildings, props and cars and stands on whatever drive.ground gives (roads, pavements, roofs). E near a car
// walks to its driver's door, opens it, pulls out whoever is driving and throws them on the road (they get up
// angry), gets in and drives off. A traffic car taken this way leaves the traffic and becomes the player's car
// (its cheap model swapped for the detailed one once that is ready); the car the player left stays where it was,
// solid, with its own physics, until it is far behind.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js?v=28';
import { Occupants, seatsOf, seatOffset, play, tick, YAW0, settled, isRagdoll, getUp } from './occupants.js?v=28';

const STEP = 1 / 120;
const WALK = 1.5, RUN = 4.4, JUMP = 4.4, G = 9.81, R_BODY = 0.3, STEP_UP = 0.45;
const MAX_LEFT = 6, FAR_LEFT = 520;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), X1 = new THREE.Vector3(1, 0, 0);
const ease = k => k * k * (3 - 2 * k);
const angLerp = (a, b, k) => { let d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + d * k; };

const CSS = `
.hud.onfoot .hud-speed, .hud.onfoot .hud-sig { display: none; }
.of-hint { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); background: rgba(32,33,36,.8); color: #fff; padding: 7px 15px; border-radius: 18px; font-size: 13px; line-height: 1.3; opacity: 0; transition: opacity .2s; white-space: nowrap; pointer-events: none; }
.of-hint.on { opacity: 1; }
.of-hint b { color: #8ab4f8; font-weight: 600; }
@media (max-width: 600px) { .of-hint { bottom: 120px; font-size: 12px; } }
.of-ebtn { position: absolute; right: 18px; bottom: 150px; width: 52px; height: 52px; border-radius: 50%; border: 0; background: rgba(32,33,36,.72); color: #fff; font: 600 18px Roboto, system-ui, sans-serif; pointer-events: auto; touch-action: none; }
`;

export class OnFoot {
  constructor(drive) {
    const D = this.drive = drive;
    this.scene = D.scene; this.camera = D.camera;
    this.occ = D.occupants = new Occupants(D);
    this.mode = 'car';          // car | exit | foot | enter | down
    this.parked = [];           // cars left about: { rig, vehicle, id, npc, kind, prevPos, prevQ, acc, asleep, still, preVel }
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.face = 0; this.onGround = true; this.vy = 0;
    this.camYaw = 0; this.camPitch = 0.22; this.camDist = 3.4; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.preVel = new THREE.Vector3();
    this.person = null; this.making = null;
    this.seq = null; this.hintT = 0;
    this.stats = { exits: 0, entries: 0, jacks: 0, ejected: 0 };
    this.off = /[?&]nopeople/.test(location.search); // (tests: the game without any of this)
    // looking round with the mouse while on foot
    const dom = D.G.renderer.domElement;
    let px = 0, py = 0, drag = false;
    dom.addEventListener('pointerdown', e => { if (e.button !== 0 && e.button !== 2) return; drag = true; px = e.clientX; py = e.clientY; });
    addEventListener('pointerup', () => { drag = false; });
    addEventListener('pointermove', e => {
      if (!drag || !this.camOwned) return;
      const dx = (e.clientX - px) / innerHeight, dy = (e.clientY - py) / innerHeight; px = e.clientX; py = e.clientY;
      this.camYaw -= dx * 3.2; this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 2.2, -0.35, 1.25);
      this.lookAt = performance.now();
    });
    dom.addEventListener('wheel', e => { if (this.camOwned) this.camDist = THREE.MathUtils.clamp(this.camDist * (1 + Math.sign(e.deltaY) * 0.1), 1.6, 12); }, { passive: true });
    // the hint at the bottom
    if (!document.getElementById('of-css')) { const s = document.createElement('style'); s.id = 'of-css'; s.textContent = CSS; document.head.appendChild(s); }
    this.hint = document.createElement('div'); this.hint.className = 'of-hint';
    (D.hud && D.hud.el ? D.hud.el : document.body).appendChild(this.hint);
    // touch screens: a round E button (get out, get in)
    if (matchMedia('(pointer: coarse)').matches || /[?&]touch/.test(location.search)) {
      const b = this.ebtn = document.createElement('button'); b.className = 'of-ebtn'; b.textContent = 'E'; b.setAttribute('aria-label', 'Get out or get in');
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.pressE(); });
      (D.hud && D.hud.el ? D.hud.el : document.body).appendChild(b);
    }
  }

  // which way the person faces, degrees clockwise from north (the minimap's arrow)
  heading() { return ((Math.PI - this.face) * 180 / Math.PI % 360 + 360) % 360; }

  get active() { return this.mode !== 'car'; }
  // what the world streams round, the shadows follow and the traffic reacts to
  focus() { return this.pos; }

  // the player's own person, made once
  async ensurePerson() {
    if (this.person) return this.person;
    if (this.making) return this.making;
    this.making = (async () => {
      const h = await this.occ.ready;
      if (!h) return null;
      let look = h.playerLook();
      const p = await h.create(look, { player: true, lod: 'high' });
      p.isPlayer = true;
      this.person = p; this.look = look;
      return p;
    })().catch(e => { console.warn('player person', e); this.making = null; return null; });
    return this.making;
  }
  // the look screen changed the player's look: a new person in its place
  async relook() {
    const h = this.occ.H; if (!h || !this.person) return;
    const old = this.person, look = h.playerLook();
    // (people.js swaps the model in place, keeping the pose and where it is)
    try { this.lookStr = localStorage.getItem('car_look'); } catch (e) {}
    if (old.setLook) { old.setLook(look); old._sitOff = null; this.look = look; return; }
    const p = await h.create(look, { player: true, lod: 'high' }); p.isPlayer = true;
    const parent = old.object.parent;
    if (parent) { parent.add(p.object); p.object.position.copy(old.object.position); p.object.quaternion.copy(old.object.quaternion); }
    if (this.occ.player && this.occ.player.o.person === old) this.occ.player.o.person = p;
    this.person = p; this.look = look;
    if (old.dispose) old.dispose(); else if (parent) parent.remove(old.object);
  }

  // ----------------------------------------------------------------------------------------------------------
  // keys (drive.key passes every key here first; true means it is handled)

  key(e) {
    if (this.off) return false;
    const c = e.code;
    if (c === 'KeyE') { this.pressE(); return true; }
    if (this.mode === 'car') return false;
    if (c === 'KeyR') { if (this.mode === 'foot') this.respawnPerson(); return true; }
    if (c === 'KeyC' || c === 'KeyV') { this.camDist = this.camDist > 4.5 ? 3.4 : 6.5; return true; }
    if (c === 'KeyB' || c === 'KeyX' || c === 'KeyQ' || c === 'Comma' || c === 'Period') return true;
    return false;
  }

  pressE() {
    const D = this.drive;
    if (!D.active || !D.car) return;
    if (this.mode === 'car') { this.startExit(); return; }
    if (this.mode === 'foot') {
      const t = this.target();
      if (t) this.startEnter(t);
      else D.hud.flash('No car near enough to get in');
      return;
    }
    // walking to a car: E again gives up
    if (this.mode === 'enter' && this.seq && this.seq.phase === 'approach') this.cancelEnter();
  }

  // ----------------------------------------------------------------------------------------------------------
  // the drive's hooks

  // the car's input while the player is not at the wheel (null: the player drives)
  carInput() {
    if (this.mode === 'car') return null;
    const v = this.drive.car.vehicle;
    if (this.mode === 'exit' && this.seq && this.seq.phase === 'stop') return { throttle: 0, brake: 1, steer: 0, handbrake: Math.abs(v.fwdSpeed) < 3 ? 1 : 0 };
    // nobody at the wheel after the driver was thrown out: it rolls on until it stops
    if (this.coastCar === this.drive.car) { if (v.speed > 1) return { throttle: 0, brake: 0, steer: 0, handbrake: 0 }; this.coastCar = null; }
    return { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
  }

  // what the player's car hits besides the traffic: the cars left about
  others(traffic) {
    const out = traffic && traffic.colliders ? traffic.colliders() : [];
    for (const e of this.parked) {
      const v = e.vehicle;
      // (obj: a record shaped like a traffic car's, so a hit on it is a hit on a car for the damage and the traffic)
      for (const c of v.circles) out.push({ x: c.x, z: c.z, r: c.r, vx: v.v.x, vz: v.v.z, obj: e.proxy, left: e });
    }
    return out;
  }

  // the traffic slows behind a car left in its lane, and stops for a car being taken
  aheadHook(c, gap, lv) {
    if (c.held) return { gap: Math.min(gap, 0.2), lv: 0 };
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const test = (x, z, len) => {
      const dx = x - c.x, dz = z - c.z, lon = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (lon > 0 && lon < 50 && lat < 2.1) { const g = lon - c.len / 2 - len / 2 - 1.2; if (g < gap) { gap = Math.max(0, g); lv = 0; } }
    };
    for (const e of this.parked) { const o = e.vehicle.origin(_a); test(o.x, o.z, e.rig.dims.length); }
    if (this.mode !== 'car' && this.drive.car) { const o = this.drive.car.vehicle.origin(_a); test(o.x, o.z, this.drive.car.rig.dims.length); }
    return { gap, lv };
  }

  // a new drop: back in the car, nothing left about
  reset() {
    for (const e of this.parked) this.disposeLeft(e);
    this.parked = [];
    this.seq = null; this.mode = 'car'; this.camOwned = false; this.downL = null; this.coastCar = null;
    if (this.person && this.person.isRagdoll && this.person.getUp) { try { this.person.getUp(); } catch (e) {} }
    if (this.person && this.person.object.parent) this.person.object.parent.remove(this.person.object);
    this.occ.clear();
    this.setHud();
  }

  // ----------------------------------------------------------------------------------------------------------
  // every frame (called from drive.update after the player's car is placed, before the camera)

  update(dt) {
    const t0 = performance.now();
    try { this.frame(dt); } finally { const ms = performance.now() - t0; this.stats.ms = this.stats.ms === undefined ? ms : this.stats.ms * 0.97 + ms * 0.03; }
  }
  frame(dt) {
    const D = this.drive;
    if (!D.car || this.off) return;
    if (!this.person) this.ensurePerson();
    // the traffic's hook (a new Traffic is made for each drop)
    if (D.traffic && D.traffic.extraAhead !== this.aheadFn) D.traffic.extraAhead = this.aheadFn || (this.aheadFn = (c, g, l) => this.aheadHook(c, g, l));
    this.stepLeft(dt);
    // the player in the driver's seat of the car being driven
    if (this.mode === 'car' && this.person && (!this.occ.player || this.occ.player.R !== this.occ.rec(D.car.rig) || this.occ.player.o.person !== this.person || this.person.object.parent !== D.car.rig.object)) {
      this.occ.unseatPlayer();
      this.occ.seatPlayer(D.car.rig, D.car.rig, this.person);
    }
    if (this.seq) { try { this.seqStep(dt); } catch (e) { console.warn('get in/out', e); this.abortSeq(); } }
    if (this.mode === 'foot') this.walk(dt);
    else if (this.mode === 'down') this.downStep(dt);
    this.occ.update(dt);
    // the head is hidden from the driver's own camera, and the whole body while looking back over a shoulder
    // (the camera would be inside it)
    if (this.person) {
      const inside = this.mode === 'car' && D.cam.view === 'driver' && !this.camOwned;
      this.headVisible(!inside);
      this.person.object.visible = !(inside && (D.lookBack || Math.abs(D.cam.yawOff || 0) > 1.25));
    }
    if (this.mode === 'car' && this.person && this.occ.player) this.handsOnWheel();
    if (this.camOwned) this.camUpdate(dt);
    this.hudStep(dt);
    this.lookStep(dt);
    // the left car's engine quieter as the person walks away from it
    const snd = D.sound;
    if (snd && snd.master && snd.ctx) {
      let g = 0.55;
      if (this.mode !== 'car') { const o = D.car.vehicle.pos; g = 0.55 * THREE.MathUtils.clamp(1 - (Math.hypot(o.x - this.pos.x, o.z - this.pos.z) - 3) / 35, 0.03, 1); }
      if (Math.abs((this.gain ?? 0.55) - g) > 0.01) { this.gain = g; snd.master.gain.setTargetAtTime(g, snd.ctx.currentTime, 0.15); }
    }
    // last frame's velocities, for the crash that comes in the next frame
    this.preVel.copy(D.car.vehicle.v);
    if (D.traffic) for (const c of D.traffic.list) c.vPre = c.v;
  }

  // the look screen saved a new look for the player (localStorage car_look): a new person in its place
  lookStep(dt) {
    this.lookT = (this.lookT || 0) - dt;
    if (this.lookT > 0 || !this.person) return;
    this.lookT = 1.5;
    let s = null; try { s = localStorage.getItem('car_look'); } catch (e) {}
    if (this.lookStr === undefined) { this.lookStr = s; return; }
    if (s !== this.lookStr) { this.lookStr = s; this.relook().catch(e => console.warn('relook', e)); }
  }

  headVisible(on) {
    const p = this.person;
    try {
      if (p.setHeadVisible) { if (p._headOn !== on) { p._headOn = on; p.setHeadVisible(on); } return; }
      // (each frame: the clips may set the head bone's scale)
      const h = p.bone && p.bone('head'), k = on ? 1 : 0.001;
      if (h && h.scale.x !== k) h.scale.setScalar(k);
    } catch (e) {}
  }

  // the hands on the steering wheel's rim, at a quarter to three, turning with it (two-bone IK when the person has
  // arm bones; the stand-in's drive pose is close enough)
  handsOnWheel() {
    const D = this.drive, rig = D.car.rig, p = this.person;
    if (!p.bone || !rig._steer || p.noIK) return;
    const st = rig._steer.node, d = st.userData.diameter || 0.38;
    const sides = [['L', -1], ['R', 1]];
    for (const [s, sx] of sides) {
      const up = p.bone('upperArm' + s), lo = p.bone('lowerArm' + s), hand = p.bone('hand' + s);
      if (!up || !lo || !hand) { p.noIK = true; return; }
      st.updateWorldMatrix(true, false);
      // a quarter to three on the rim
      const target = _a.set(sx * d * 0.47, d * 0.12, 0).applyMatrix4(st.matrixWorld);
      twoBone(up, lo, hand, target);
    }
  }

  // ----------------------------------------------------------------------------------------------------------
  // getting out

  startExit() {
    const D = this.drive, car = D.car;
    if (!this.person || !this.occ.player) { this.ensurePerson(); D.hud.flash('One moment'); return; }
    const v = car.vehicle;
    // on its side or roof: crawl out at once
    const upY = _a.set(0, 1, 0).applyQuaternion(v.q).y;
    this.seq = { kind: 'exit', phase: upY < 0.5 ? 'crawl' : 'stop', t: 0, car, rig: car.rig, door: this.driverDoor(car.rig) };
    this.mode = 'exit';
    D.auto && (D.auto = null);
    this.stats.exits++;
  }

  driverDoor(rig) { const s = seatsOf(rig)[0]; return s ? s.door : 0; }

  // the point beside the driver's door where a person stands (car frame)
  doorPoint(rig, seat = 0, out = new THREE.Vector3()) {
    const s = seatsOf(rig)[seat] || { x: -0.4, z: 0.2, side: 'L' };
    // (a middle seat, as the Semi's driver's: the side of its door)
    const ds = s.side === 'C' && rig.spec && rig.spec.doors && rig.spec.doors[s.door] ? rig.spec.doors[s.door].side : s.side;
    const sx = ds === 'R' ? 1 : ds === 'L' ? -1 : -1;
    return out.set(sx * (rig.dims.width / 2 + 0.42), 0, s.z + 0.12);
  }

  seqStep(dt) {
    const S = this.seq, D = this.drive;
    S.t += dt;
    if (S.kind === 'exit') return this.exitStep(S, dt);
    if (S.kind === 'enter') return this.enterStep(S, dt);
  }

  exitStep(S, dt) {
    const D = this.drive, rig = S.rig, v = S.car.vehicle;
    if (D.car !== S.car) { this.abortSeq(); return; }
    if (S.phase === 'stop') {
      // (not while the wheels are off the ground: a flying Roadster is brought down first, flight.js)
      if ((Math.abs(v.fwdSpeed) < 0.6 && v.speed < 1 || S.t > 6) && !(v.airTime > 0.15 && S.t < 30)) { S.phase = 'open'; S.t = 0; }
      return;
    }
    if (S.phase === 'crawl') {
      // out through the window of a car on its side or roof, onto the ground beside it
      this.occ.unseatPlayer();
      const p = this.person; this.scene.attach(p.object);
      rig.object.updateWorldMatrix(true, false);
      const w = this.doorPoint(rig, 0, _a).multiplyScalar(1.4).applyMatrix4(rig.object.matrixWorld);
      this.placePerson(w.x, w.z, w.y + 1);
      this.toFoot();
      return;
    }
    if (S.phase === 'open') {
      this.setDoor(rig, S.door, ease(Math.min(1, S.t / 0.6)));
      if (S.t >= 0.6) { S.phase = 'climb'; S.t = 0; this.beginClimb(S, false); this.startCam(); }
      return;
    }
    if (S.phase === 'climb') {
      const k = Math.min(1, S.t / S.dur);
      this.climbPose(S, k, dt);
      if (k >= 1) {
        S.phase = 'shut'; S.t = 0;
        // into the world, standing
        const p = this.person;
        this.scene.attach(p.object);
        p.object.getWorldPosition(_a);
        this.placePerson(_a.x, _a.z, _a.y + 0.6);
        const f = _b.set(0, 0, -1).applyQuaternion(p.object.getWorldQuaternion(_q)); this.face = Math.atan2(f.x, f.z);
        p.object.rotation.set(0, this.face + YAW0, 0);
        this.mode = 'foot'; this.seqHoldsWalk = true;
        play(p, 'idle', { fade: 0.3 });
      }
      return;
    }
    if (S.phase === 'shut') {
      this.setDoor(rig, S.door, 1 - ease(Math.min(1, S.t / 0.45)));
      if (S.t > 0.25) this.seqHoldsWalk = false;
      if (S.t >= 0.45) { this.setDoor(rig, S.door, 0); this.seq = null; }
    }
  }

  // the path from the seat out past the door (or back in), in the car's frame
  beginClimb(S, entering) {
    const p = this.person, rig = S.rig, seat = seatsOf(rig)[0];
    const sx = this.doorPoint(rig, 0, _c).x > 0 ? 1 : -1;
    // the hips over the seat: as measured when this person last sat, else the sitting clip's usual height
    const off = p._sitOff ? p._sitOff.clone() : (entering ? new THREE.Vector3(0, 0.48 * (p.height || 1.75) / 1.75, 0) : seatOffset(p));
    const w = rig.dims.width;
    const seatHip = new THREE.Vector3(seat.x, seat.y, seat.z);
    const sill = new THREE.Vector3(sx * (w / 2 - 0.12), seat.y + 0.04, seat.z + 0.05);
    const out = this.doorPoint(rig, 0, new THREE.Vector3());
    S.path = { seatHip, sill, out, off, sx, aFwd: Math.PI, aOut: sx * Math.PI / 2, aStand: sx * Math.PI * 0.75 };
    S.dur = entering ? 1.9 : 2.0;
    if (p.object.parent !== rig.object) { rig.object.attach(p.object); }
    if (!entering) { this.occ.unseatPlayer(); play(p, 'sit', { fade: 0.2 }); }
    S.entering = entering; S.clipOn = false; S.sat = false;
  }

  // k 0..1 along the climb (out: seat -> sill -> standing outside; in: the reverse)
  climbPose(S, k, dt) {
    const P = S.path, p = this.person, o = p.object;
    const u = S.entering ? 1 - k : k;
    let hip, a;
    let tilt = 0;
    if (u < 0.45) {
      const t = ease(u / 0.45);
      hip = _a.copy(P.seatHip).lerp(P.sill, t);
      a = angLerp(P.aFwd, P.aOut, t);
      // leaning back in the seat at first, upright on the sill
      tilt = (p._recline || 0) * (1 - t);
      _q2.setFromAxisAngle(UP, a + YAW0).multiply(_q.setFromAxisAngle(X1, tilt));
      o.position.copy(hip).sub(_b.copy(P.off).applyQuaternion(_q2));
    } else {
      const t = ease((u - 0.45) / 0.55);
      // standing up: from the sill (sitting) to the ground outside (standing), the root on the ground
      const r0 = _a.copy(P.sill).sub(_b.copy(P.off).applyAxisAngle(UP, P.aOut + YAW0));
      o.position.copy(r0).lerp(P.out, t);
      o.position.y += Math.sin(t * Math.PI) * 0.06;
      a = angLerp(P.aOut, S.entering ? -P.sx * Math.PI / 2 : P.aStand, t);
    }
    o.quaternion.setFromAxisAngle(UP, a + YAW0);
    if (tilt) o.quaternion.multiply(_q.setFromAxisAngle(X1, tilt));
    // the pose: sitting while turning on the seat; the clip of standing up (or sitting down) beside the door, timed
    // to the path's standing half
    const side = P.sx > 0 ? 'R' : 'L', standing = u >= 0.45;
    if (!S.entering) {
      if (standing && !S.clipOn) { S.clipOn = true; this.timedClip(play(p, 'exit_car', { fade: 0.3, side, once: true }), 0.55 * S.dur, 'idle'); }
    } else {
      if (!S.clipOn) { S.clipOn = true; this.timedClip(play(p, 'enter_car', { fade: 0.3, side, once: true }), 0.55 * S.dur, null); }
      if (!standing && !S.sat) { S.sat = true; play(p, 'drive', { fade: 0.4 }); }
    }
    tick(p, dt);
    // the hips kept on the path whatever the clip does with them (the captured stand-up moves them over the feet):
    // on the sill until the person is half up, then out over the spot beside the door
    const hb = p.bone && p.bone('hips');
    if (hb) {
      o.updateMatrixWorld(true);
      const hw = hb.getWorldPosition(_c); S.rig.object.worldToLocal(hw);
      const want = u < 0.45 ? _a.copy(P.seatHip).lerp(P.sill, ease(u / 0.45)) : _a.copy(P.sill).lerp(P.out, ease(THREE.MathUtils.clamp((u - 0.6) / 0.4, 0, 1)));
      o.position.x += want.x - hw.x; o.position.z += want.z - hw.z;
    }
  }

  // a clip of a fixed length played over the time given (or, with no clip, a fade into a still pose)
  timedClip(a, secs, fallback) {
    if (a && a.getClip) { const d = a.getClip().duration; if (d > 0 && secs > 0) a.timeScale = THREE.MathUtils.clamp(d / secs, 0.4, 3); }
    else if (fallback) play(this.person, fallback, { fade: secs * 0.8 });
  }

  toFoot() {
    this.mode = 'foot'; this.seq = null; this.seqHoldsWalk = false;
    play(this.person, 'idle', { fade: 0.3 });
    this.startCam();
  }

  // ----------------------------------------------------------------------------------------------------------
  // getting in

  // the nearest car the player can get into from here: { kind, rig, door point (world), entry }
  target() {
    const D = this.drive, P = this.pos, list = [];
    const consider = (kind, rig, ref, speed = 0) => {
      if (!rig || !rig.object) return;
      rig.object.updateWorldMatrix(true, false);
      const dp = this.doorPoint(rig, 0, new THREE.Vector3()).applyMatrix4(rig.object.matrixWorld);
      const d = Math.hypot(dp.x - P.x, dp.z - P.z);
      // the car's middle too (from its far side the door is the length of a car away)
      _a.setFromMatrixPosition(rig.object.matrixWorld);
      const dm = Math.hypot(_a.x - P.x, _a.z - P.z);
      const reach = speed > 2.5 ? 2.2 : 6;
      if (speed > 15) return;
      if (d < reach || dm < (speed > 2.5 ? 0 : rig.dims.length / 2 + 2.5)) list.push({ kind, rig, ref, d: Math.min(d, dm), speed });
    };
    if (D.car) consider('mine', D.car.rig, D.car);
    for (const e of this.parked) consider('left', e.rig, e);
    if (D.traffic) for (const c of D.traffic.list) if (Math.hypot(c.x - P.x, c.z - P.z) < 12) consider('traffic', c.rig, c, c.v);
    // parked (instanced) cars
    if (D.parked && D.parked.list) for (const o of D.parked.list) {
      if (!o.K || o.skip || o.taken) continue;
      const dd = Math.hypot(o.x - P.x, o.z - P.z);
      if (dd > o.K.dims.length / 2 + 2.5) continue;
      list.push({ kind: 'parked', ref: o, d: dd, speed: 0 });
    }
    list.sort((a, b) => a.d - b.d);
    return list[0] || null;
  }

  startEnter(t) {
    const D = this.drive;
    this.seq = { kind: 'enter', phase: 'prep', t: 0, target: t };
    this.mode = 'enter';
    this.stats.entries++;
    if (t.kind === 'traffic') {
      t.ref.held = true; // the driver stops (someone is at the door)
      // right beside a moving car's door: grab it at once
      if (t.speed > 2.5) this.grabTraffic(this.seq);
    }
    if (t.kind === 'parked') this.prepParked(this.seq);
    else this.seq.phase = 'approach';
  }

  cancelEnter() {
    const S = this.seq;
    if (S && S.target && S.target.kind === 'traffic' && S.target.ref) S.target.ref.held = false;
    this.seq = null; this.mode = 'foot';
    play(this.person, 'idle', { fade: 0.25 });
  }

  // a traffic car out of the traffic: a Vehicle of its own, braking to a stop, its people with it
  takeTraffic(c) {
    const D = this.drive, T = D.traffic;
    if (!T) return null;
    const i = T.list.indexOf(c);
    if (i < 0) return null;
    T.list.splice(i, 1);
    c.held = false;
    const rig = c.rig;
    this.scene.attach(rig.object);
    const veh = new Vehicle(rig, this.physOf(rig.id));
    const hd = ((c.yaw + (c.offYaw || 0)) * 180 / Math.PI + 360) % 360;
    const g = D.ground(c.x, c.z, c.y);
    veh.place(c.x, g ?? c.y, c.z, hd);
    const h = hd * Math.PI / 180;
    veh.v.set(Math.sin(h) * c.v, 0, -Math.cos(h) * c.v);
    const e = this.addLeft({ rig, vehicle: veh, id: rig.id, npc: true, kind: 'stolen', brake: true, car: c });
    return e;
  }

  grabTraffic(S) {
    const c = S.target.ref;
    const e = this.takeTraffic(c);
    if (!e) { this.cancelEnter(); return; }
    S.target = { kind: 'left', rig: e.rig, ref: e, d: 0 };
    S.grabbed = true;
  }

  // a parked (instanced) car as a car of its own: its model loaded, the instance and its collision taken away
  async prepParked(S) {
    const D = this.drive, C = D.mods.cars, o = S.target.ref;
    try {
      o.taken = true;
      const rig = await C.loadCar(o.model, { npc: true, color: o.paint });
      if (D.carEnv && rig.setEnvMap) rig.setEnvMap(D.carEnv);
      if (this.seq !== S) { rig.dispose(); o.taken = false; return; }
      const veh = new Vehicle(rig, this.physOf(o.model));
      veh.place(o.x, o.y, o.z, o.heading);
      // the instance goes, and its collision shape
      const P = D.parked, k = P.list.indexOf(o);
      if (k >= 0) { P.list.splice(k, 1); P.frame = 0; P.update(this.camera); }
      for (const s of D.collide.shapes) if (s.tag === 'parked' && !s.dead && s.k === 0) {
        let x = 0, z = 0; for (const p of s.p) { x += p[0]; z += p[1]; }
        x /= s.p.length; z /= s.p.length;
        if (Math.hypot(x - o.x, z - o.z) < 0.6) { D.collide.remove(s); break; }
      }
      this.scene.add(rig.object);
      const e = this.addLeft({ rig, vehicle: veh, id: o.model, npc: true, kind: 'parked' });
      // its people (if any were shown) move into it
      this.occ.transfer(o, rig, rig);
      S.target = { kind: 'left', rig, ref: e, d: 0 };
      S.phase = 'approach'; S.t = 0;
    } catch (er) { console.warn('parked car', er); o.taken = false; this.cancelEnter(); }
  }

  physOf(id) {
    const C = this.drive.mods.cars, spec = C ? C.CARS.find(c => c.id === id) : null;
    const p = { ...((spec && spec.physics) || {}) };
    if (spec && spec.mass) p.mass = spec.mass;
    return p;
  }

  enterStep(S, dt) {
    const D = this.drive, p = this.person;
    if (S.phase === 'prep') { if (S.t > 6) this.cancelEnter(); return; }
    const t = S.target, rig = t.rig;
    if (!rig || !rig.object.parent) { this.cancelEnter(); return; }
    rig.object.updateWorldMatrix(true, false);
    if (S.phase === 'approach') {
      // walk (run if far or the car moves) to the driver's door, round the car if need be
      const dp = this.doorPoint(rig, 0, _c).applyMatrix4(rig.object.matrixWorld);
      const dx = dp.x - this.pos.x, dz = dp.z - this.pos.z, d = Math.hypot(dx, dz);
      // a traffic car reached: out of the traffic now
      if (t.kind === 'traffic' && d < 1.4) { this.grabTraffic(S); return; }
      if (d < 0.35 || (S.grabbed && d < 1.6)) {
        S.phase = 'open'; S.t = 0;
        S.door = this.driverDoor(rig);
        // the driver, if any, is pulled out
        const key = rig;
        const drv = this.occ.driverOf(key);
        S.victim = drv || null;
        play(p, S.victim ? 'pull_out' : 'idle', { fade: 0.2 });
        return;
      }
      if (S.t > 9) { D.hud.flash('Could not reach that car'); this.cancelEnter(); return; }
      // aim at the door point, but steer round the car's body (walk to a point off its side first)
      const lp = _a.set(this.pos.x, 0, this.pos.z); rig.object.worldToLocal(lp);
      const door = this.doorPoint(rig, 0, _b);
      let goal = dp;
      const hl = rig.dims.length / 2 + 0.6, hw = rig.dims.width / 2 + 0.5;
      if (Math.sign(lp.x) !== Math.sign(door.x) && Math.abs(lp.z) < hl) {
        // on the wrong side: round the nearer end
        const zEnd = lp.z < 0 ? -hl : hl;
        goal = _c.set(Math.abs(lp.x) > hw * 0.5 ? lp.x : Math.sign(lp.x || 1) * hw, 0, zEnd); rig.object.localToWorld(goal);
      }
      const run = d > 6 || (S.grabbed ? false : (t.speed || 0) > 1);
      this.walk(dt, { x: goal.x - this.pos.x, z: goal.z - this.pos.z, run, ignore: rig });
      return;
    }
    if (S.phase === 'open') {
      // face the car, the door swings open
      const f = _a.set(0, 0, 0); this.doorPoint(rig, 0, f); const sx = Math.sign(f.x) || -1;
      const look = _b.set(-sx, 0, 0).transformDirection(rig.object.matrixWorld);
      this.face = angLerp(this.face, Math.atan2(look.x, look.z), Math.min(1, dt * 10));
      this.stickToDoor(rig, dt);
      p.object.rotation.set(0, this.face + YAW0, 0);
      tick(p, dt);
      this.setDoor(rig, S.door, ease(Math.min(1, S.t / 0.6)));
      if (S.t >= 0.6) {
        S.t = 0;
        if (S.victim) { S.phase = 'pull'; this.beginPull(S); }
        else { S.phase = 'climb'; this.beginEnterClimb(S); }
      }
      return;
    }
    if (S.phase === 'pull') {
      this.stickToDoor(rig, dt);
      p.object.rotation.set(0, this.face + YAW0, 0);
      tick(p, dt);
      this.pullStep(S, dt);
      if (S.t >= 1.1) { S.phase = 'climb'; S.t = 0; this.beginEnterClimb(S); }
      return;
    }
    if (S.phase === 'climb') {
      const k = Math.min(1, S.t / S.dur);
      this.climbPose(S, k, dt);
      if (k >= 1) { S.phase = 'shut'; S.t = 0; this.takeWheel(S); }
      return;
    }
    if (S.phase === 'shut') {
      this.setDoor(rig, S.door, 1 - ease(Math.min(1, S.t / 0.45)));
      if (S.t >= 0.45) { this.setDoor(rig, S.door, 0); this.seq = null; }
    }
  }

  // while at the door of a car that is still rolling, keep beside it
  stickToDoor(rig, dt) {
    const dp = this.doorPoint(rig, 0, _c).applyMatrix4(rig.object.matrixWorld);
    this.pos.x += (dp.x - this.pos.x) * Math.min(1, dt * 12);
    this.pos.z += (dp.z - this.pos.z) * Math.min(1, dt * 12);
    const g = this.drive.ground(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (g !== null && Number.isFinite(g)) this.pos.y = g;
    this.person.object.position.copy(this.pos);
  }

  // the driver dragged out over a second and thrown on the road
  beginPull(S) {
    const rig = S.target.rig, R = this.occ.rec(rig);
    const o = S.victim;
    S.pull = { o, start: o.person.object.position.clone(), q0: o.person.object.quaternion.clone() };
    play(o.person, 'pulled_out', { fade: 0.15 });
    this.stats.jacks++;
  }
  pullStep(S, dt) {
    const P = S.pull, rig = S.target.rig, o = P.o, obj = o.person.object;
    const k = Math.min(1, S.t / 0.65);
    const seat = seatsOf(rig)[0], sx = seat.side === 'R' ? 1 : -1;
    // out past the player and down
    const end = _a.set(sx * (rig.dims.width / 2 + 0.75), 0.2, seat.z + 0.55);
    obj.position.copy(P.start).lerp(end, ease(k));
    obj.position.y += Math.sin(k * Math.PI) * 0.25;
    obj.quaternion.copy(P.q0).slerp(_q.setFromAxisAngle(UP, sx * Math.PI / 2 + YAW0), k);
    tick(o.person, dt);
    if (k >= 1 && !P.thrown) {
      P.thrown = true;
      const R = this.occ.rec(rig);
      const taken = R ? this.occ.take(R, 0) : null;
      if (taken) {
        rig.object.updateWorldMatrix(true, false);
        const out = _b.set(sx, 0, 0).transformDirection(rig.object.matrixWorld);
        const back = _c.set(0, 0, 1).transformDirection(rig.object.matrixWorld);
        const e = this.parked.find(q => q.rig === rig);
        const v = new THREE.Vector3().addScaledVector(out, 3.4).addScaledVector(back, 0.8);
        if (e) v.add(e.vehicle.v);
        v.y = 2.4;
        this.occ.throwPerson(taken.person, v, { angry: true, look: taken.look });
      }
      // the passengers get out and run
      if (R) setTimeout(() => this.passengersFlee(rig), 450);
    }
  }

  passengersFlee(rig) {
    const R = this.occ.rec(rig);
    if (!R) return;
    rig.object.updateWorldMatrix(true, false);
    for (const o of [...R.people]) {
      if (o.player || o.seat === 0 || o.state !== 'seated') continue;
      const s = R.seats[o.seat], sx = s.side === 'R' ? 1 : s.side === 'L' ? -1 : (Math.random() < 0.5 ? -1 : 1);
      const taken = this.occ.take(R, o.seat);
      if (!taken) continue;
      const w = _a.set(sx * (rig.dims.width / 2 + 0.5), 0, s.z).applyMatrix4(rig.object.matrixWorld);
      const g = this.drive.ground(w.x, w.z, w.y + 1);
      taken.person.object.position.set(w.x, g ?? w.y, w.z);
      taken.person.object.quaternion.identity();
      if (taken.person.setCabin) try { taken.person.setCabin(0); } catch (e) {}
      if (s.door >= 0) this.setDoor(rig, s.door, 0.7);
      this.occ.flee(taken.person, _b.setFromMatrixPosition(rig.object.matrixWorld));
    }
  }

  beginEnterClimb(S) {
    const rig = S.rig = S.target.rig, p = this.person;
    // the person into the car's frame, then along the path in
    rig.object.attach(p.object);
    this.beginClimb(S, true);
    S.wasSitting = false;
  }

  // in the seat: this car is the player's now (the one before stays where it is)
  takeWheel(S) {
    const D = this.drive, t = S.target, rig = t.rig;
    if (t.kind !== 'mine') {
      const e = t.ref;
      const k = this.parked.indexOf(e);
      if (k >= 0) this.parked.splice(k, 1);
      const old = D.car;
      if (old) this.addLeft({ rig: old.rig, vehicle: old.vehicle, id: old.id, npc: !!old.npc, kind: 'left' });
      D.car = { rig, vehicle: e.vehicle, id: e.id, npc: !!e.npc };
      D.carId = e.id;
      D.prevPos = e.vehicle.pos.clone(); D.prevQ = e.vehicle.q.clone(); D.acc = 0;
      e.vehicle.reverse = false; e.vehicle.gear = 1;
      if (D.carEnv && rig.setEnvMap && !e.envSet) rig.setEnvMap(D.carEnv);
      if (e.npc) this.upgrade(D.car);
    }
    this.mode = 'car'; this.camOwned = false; this.seqHoldsWalk = false;
    this.occ.unseatPlayer();
    this.occ.seatPlayer(rig, rig, this.person);
    D.cam.ready = false;
    this.setHud();
  }

  // the traffic's cheap model swapped for the detailed one of the same car, in the same paint
  async upgrade(car) {
    const D = this.drive, C = D.mods.cars;
    const spec = C && C.CARS.find(c => c.id === car.id);
    if (!spec || spec.npcOnly || !spec.file || spec.file === spec.npcFile) return;
    // (a car already dented keeps its own model: the detailed one would come new)
    if (car.rig._dmg && car.rig._dmg.damaged) return;
    let rig;
    try {
      rig = await C.loadCar(car.id);
      if (rig.setPaint) rig.setPaint(car.rig.paintColor);
      if (D.carEnv && rig.setEnvMap) rig.setEnvMap(D.carEnv);
      await D.compileScene(rig.object, D.scene);
    } catch (e) { console.warn('upgrade', e); return; }
    // wait until nobody is getting in or out
    for (let i = 0; i < 200 && (this.seq || this.mode !== 'car'); i++) await new Promise(r => setTimeout(r, 100));
    if (D.car !== car || this.mode !== 'car') { rig.dispose(); return; }
    const ov = car.vehicle, nv = new Vehicle(rig, this.physOf(car.id));
    const o = ov.origin(new THREE.Vector3());
    nv.q.copy(ov.q); nv.pos.copy(nv.com).applyQuaternion(nv.q).add(o);
    nv.v.copy(ov.v); nv.w.copy(ov.w); nv.gear = ov.gear; nv.reverse = ov.reverse; nv.rpm = ov.rpm; nv.steer = ov.steer;
    nv.wheels.forEach((w, i) => { const q = ov.wheels[i]; if (q) { w.x = w.xPrev = q.x; w.spin = q.spin; w.omega = q.omega; w.contact = q.contact; } });
    rig.object.position.copy(car.rig.object.position); rig.object.quaternion.copy(car.rig.object.quaternion);
    D.scene.add(rig.object);
    this.occ.transfer(car.rig, rig, rig);
    if (car.rig.dispose) car.rig.dispose(); else D.scene.remove(car.rig.object);
    D.car = { rig, vehicle: nv, id: car.id };
    D.prevPos = nv.pos.clone(); D.prevQ = nv.q.clone();
  }

  abortSeq() {
    const S = this.seq;
    this.seq = null;
    if (S && S.rig) this.setDoor(S.rig, S.door, 0);
    if (S && S.target && S.target.rig) this.setDoor(S.target.rig, S.door, 0);
    if (this.mode === 'exit' || this.mode === 'enter') {
      // back to whatever is safest: in the car being driven
      this.mode = 'car'; this.camOwned = false; this.drive.cam.ready = false;
      this.occ.unseatPlayer();
      if (this.drive.car && this.person) this.occ.seatPlayer(this.drive.car.rig, this.drive.car.rig, this.person);
      this.setHud();
    }
  }

  // ----------------------------------------------------------------------------------------------------------
  // doors and windows (damage.js makes the doors; without it the person just goes through)

  setDoor(rig, i, f) {
    if (!rig || i === undefined || i === null || i < 0) return;
    try {
      if (typeof rig.setDoor === 'function') { rig.setDoor(i, f); return; }
      if (typeof rig.doorNode !== 'function') return;
      const n = rig.doorNode(i);
      if (!n) return;
      const d = rig.spec && rig.spec.doors && rig.spec.doors[i];
      if (!n.userData.q0) n.userData.q0 = n.quaternion.clone();
      const deg = d && d.open ? d.open : 62;
      let ax;
      if (d && d.axis) ax = _a.fromArray(d.axis).normalize();
      else { const s = d && d.side ? d.side : (seatsOf(rig).find(q => q.door === i) || {}).side; ax = _a.set(0, s === 'R' ? 1 : -1, 0); }
      n.quaternion.copy(n.userData.q0).multiply(_q2.setFromAxisAngle(ax, deg * Math.PI / 180 * f));
    } catch (e) {}
  }

  // a door burst open in a crash (people may be thrown out through it)
  burstDoor(rig, i, e) {
    if (!rig || i < 0) return;
    this.setDoor(rig, i, 0.6 + Math.random() * 0.4);
    try { this.drive.events.dispatchEvent({ type: 'door', car: rig, door: i, open: true, by: 'occupants' }); } catch (er) {}
  }
  // a window broken by someone going through it: the damage module's own nearest window of that kind shatters
  breakWindow(rig, kind, localPoint, e) {
    const dm = this.drive.damage || (window.__car && window.__car.damage);
    if (!dm || !rig) return;
    try {
      if (typeof dm.breakGlass === 'function') { dm.breakGlass(rig, localPoint, { kind }); return; }
      const rd = dm.of(rig), A = rd.analysis();
      let best = null, bd = Infinity;
      for (const w of A.windows || []) {
        if (w.state === 'broken' || !w.center || w.kind === 'lens') continue;
        if (kind === 'front' && w.kind !== 'front') continue;
        const d = w.center.distanceToSquared(localPoint);
        if (d < bd) { bd = d; best = w; }
      }
      if (best && bd < 2.5) rd.breakWindow(best, { side: kind === 'front' ? 'front' : (localPoint.x < 0 ? 'left' : 'right'), speed: (e && e.speed) || 10 }, null);
    } catch (er) { if (!this.glassErr) { this.glassErr = true; console.warn('break window', er); } }
  }

  // ----------------------------------------------------------------------------------------------------------
  // walking

  placePerson(x, z, yHint) {
    const g = this.drive.ground(x, z, yHint);
    this.pos.set(x, g ?? yHint, z);
    this.vy = 0; this.vel.set(0, 0, 0); this.onGround = true;
    if (this.person) { this.person.object.position.copy(this.pos); }
  }

  respawnPerson() {
    // back onto the nearest road (or beside the car left behind)
    const D = this.drive, R = D.roadsObj;
    const r = R && R.nearestLane ? R.nearestLane(this.pos.x, this.pos.z, 200, L => L.kind === 'road') : null;
    if (r) this.placePerson(r.x, r.z, (r.y ?? this.pos.y) + 1);
    else { const o = D.car.vehicle.origin(_a); this.placePerson(o.x + 2.5, o.z, o.y + 1); }
  }

  // one frame of walking. auto: { x, z (direction), run, ignore (a car not to bump into) } when walking to a door
  walk(dt, auto) {
    const D = this.drive, p = this.person;
    if (!p) return;
    if (p.object.parent !== this.scene) this.scene.attach(p.object);
    const k = D.keys;
    let mx = 0, mz = 0, run = false, jump = false;
    if (auto) {
      const l = Math.hypot(auto.x, auto.z);
      if (l > 1e-3) { mx = auto.x / l; mz = auto.z / l; }
      run = auto.run;
    } else if (!this.seqHoldsWalk) {
      const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      // relative to the camera: forward (sin y, cos y), right (-cos y, sin y)
      const y = this.camYaw;
      mx = Math.sin(y) * f - Math.cos(y) * s; mz = Math.cos(y) * f + Math.sin(y) * s;
      const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      run = k.has('ShiftLeft') || k.has('ShiftRight');
      jump = k.has('Space');
      // the camera comes round behind a person walking forward, unless the mouse moved it lately
      if (f > 0 && l > 0.1 && performance.now() - (this.lookAt || 0) > 1800) {
        const want = Math.atan2(mx, mz);
        this.camYaw = angLerp(this.camYaw, want, Math.min(1, dt * 1.2 * f));
      }
      // arrow keys look round
      if (k.has('ArrowLeft')) this.camYaw += dt * 2; if (k.has('ArrowRight')) this.camYaw -= dt * 2;
      if (k.has('ArrowUp')) this.camPitch = Math.max(-0.35, this.camPitch - dt * 1.2); if (k.has('ArrowDown')) this.camPitch = Math.min(1.25, this.camPitch + dt * 1.2);
    }
    const moving = Math.hypot(mx, mz) > 0.05;
    const speed = moving ? (run ? RUN : WALK) : 0;
    // speeding up and slowing down over a fraction of a second (quicker on the ground than in the air)
    const acc = this.onGround ? 10 : 2.5;
    this.vel.x += (mx * speed - this.vel.x) * Math.min(1, dt * acc);
    this.vel.z += (mz * speed - this.vel.z) * Math.min(1, dt * acc);
    if (moving) this.face = angLerp(this.face, Math.atan2(mx, mz), Math.min(1, dt * (run ? 9 : 7)));
    // jump
    if (jump && this.onGround && !this.jumpHeld) { this.vy = JUMP; this.onGround = false; play(p, 'jump', { fade: 0.1 }); }
    this.jumpHeld = jump;
    // move, in two halves so a quick run does not pass through a thin fence
    const n = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.z) * dt / 0.12));
    for (let i = 0; i < n; i++) this.moveBy(this.vel.x * dt / n, this.vel.z * dt / n, auto ? auto.ignore : null);
    // up and down
    const g = D.ground(this.pos.x, this.pos.z, this.pos.y + STEP_UP);
    if (!this.onGround || this.vy > 0) {
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      if (g !== null && Number.isFinite(g) && this.pos.y <= g && this.vy <= 0) { this.pos.y = g; this.vy = 0; this.onGround = true; if (this.fallFrom - g > 4) play(p, 'hurt', { fade: 0.1 }); }
    } else if (g !== null && Number.isFinite(g)) {
      if (g < this.pos.y - 0.6) { this.onGround = false; this.vy = 0; this.fallFrom = this.pos.y; }
      else this.pos.y += (g - this.pos.y) * Math.min(1, dt * 18);
    }
    if (this.onGround) this.fallFrom = this.pos.y;
    // no ground under the person for a while (a hole in the map, tiles not loaded): back to the road
    this.noGroundT = g === null || !Number.isFinite(g) ? (this.noGroundT || 0) + dt : 0;
    if (this.noGroundT > 3 || this.pos.y < -2000) { this.noGroundT = 0; this.respawnPerson(); }
    // the pose
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const anim = !this.onGround ? 'jump' : sp > 3.2 ? 'run' : sp > 0.35 ? 'walk' : 'idle';
    // (the clips walk at about 1.35 m/s and run at 3.5: played faster or slower to match, so the feet do not slide)
    const spd = anim === 'walk' ? THREE.MathUtils.clamp(sp / 1.35, 0.6, 1.4) : anim === 'run' ? THREE.MathUtils.clamp(sp / 3.5, 0.8, 1.4) : 1;
    if (anim !== this.anim || Math.abs(spd - (this.animSpd || 1)) > 0.08) { play(p, anim, { fade: anim === 'jump' ? 0.1 : 0.25, speed: spd }); this.anim = anim; this.animSpd = spd; }
    if (p.setSpeed) try { p.setSpeed(sp); } catch (e) {}
    p.object.position.copy(this.pos);
    p.object.rotation.set(0, this.face + YAW0, 0);
    tick(p, dt);
    if (!auto) this.hitByTraffic();
  }

  // a step sideways that stops at walls, props, parked and moving cars
  moveBy(dx, dz, ignore) {
    const D = this.drive;
    let x = this.pos.x + dx, z = this.pos.z + dz;
    const y = this.pos.y;
    // walls taller than a step stop the person (the ground there is a building or a bank)
    const g = D.ground(x, z, y + STEP_UP);
    if (g !== null && Number.isFinite(g) && g > y + STEP_UP + 0.05 && this.onGround) return;
    // static shapes
    if (D.collide) {
      const hits = D.collide.contacts([{ x, z, r: R_BODY, y0: y + 0.35, y1: y + 1.7 }]);
      for (const h of hits) { const d = Math.min(h.depth, 0.3); x += h.nx * d; z += h.nz * d; }
    }
    // cars, as boxes
    const box = (rig, cx, cz, yaw, y0) => {
      if (rig === ignore) return;
      if (y0 !== undefined && (y > y0 + rig.dims.height - 0.2 || y + 1.7 < y0)) return;
      const r = pushBox(x, z, R_BODY, cx, cz, yaw, rig.dims.length / 2, rig.dims.width / 2);
      if (r) { x += r[0]; z += r[1]; }
    };
    const carBox = (rig, v) => { const o = v.origin(_b); box(rig, o.x, o.z, v.heading * Math.PI / 180, o.y); };
    if (D.car && D.car.rig !== ignore) carBox(D.car.rig, D.car.vehicle);
    for (const e of this.parked) if (e.rig !== ignore) carBox(e.rig, e.vehicle);
    if (D.traffic) for (const c of D.traffic.list) { if (Math.abs(c.x - x) < 6 && Math.abs(c.z - z) < 6) box(c.rig, c.x, c.z, c.yaw + (c.offYaw || 0), c.y); }
    this.pos.x = x; this.pos.z = z;
  }

  // a moving traffic car that runs into the person knocks them down
  hitByTraffic() {
    const D = this.drive, T = D.traffic;
    if (!T || !this.person) return;
    for (const c of T.list) {
      if (c.v < 2.5 || Math.abs(c.x - this.pos.x) > 5 || Math.abs(c.z - this.pos.z) > 5) continue;
      const yaw = c.yaw + (c.offYaw || 0);
      if (pushBox(this.pos.x, this.pos.z, R_BODY, c.x, c.z, yaw, c.rig.dims.length / 2, c.rig.dims.width / 2)) {
        const v = new THREE.Vector3(Math.sin(yaw) * c.v * 1.1, 2 + c.v * 0.18, -Math.cos(yaw) * c.v * 1.1);
        try { D.events.dispatchEvent({ type: 'ped-hit', person: this.person, speed: c.v, player: true }); } catch (e) {}
        c.v *= 0.5;
        this.knockDown(v);
        return;
      }
    }
  }

  knockDown(v) {
    const p = this.person;
    this.mode = 'down'; this.seq = null;
    if (!this.camOwned) this.startCam();
    this.downL = this.occ.throwPerson(p, v, { keep: true, hurt: true });
  }

  // the player thrown out of their own car in an extreme crash: lands on foot, can walk back and get in with E
  ejectPlayer(e, vPre) {
    if (this.mode !== 'car' || !this.person) return;
    const D = this.drive, rig = D.car.rig;
    this.occ.unseatPlayer();
    const p = this.person;
    this.scene.attach(p.object);
    rig.object.updateWorldMatrix(true, false);
    const s = seatsOf(rig)[0];
    const w = _a.set(s.x * 0.5, s.y + 0.5, s.z - 1.1).applyMatrix4(rig.object.matrixWorld);
    p.object.position.copy(w);
    this.pos.copy(w);
    const v = vPre.clone().multiplyScalar(0.6); v.y += 3;
    this.stats.ejected++;
    this.coastCar = D.car;
    this.burstDoor(rig, s.door, e);
    this.knockDown(v);
    D.hud.flash('Thrown from the car');
  }

  downStep(dt) {
    const L = this.downL, p = this.person;
    if (!L) { this.toFoot(); return; }
    L.t += dt;
    tick(p, dt);
    // the person's middle is where the camera looks
    p.object.getWorldPosition(this.pos);
    if (L.state === 'flying' && (settled(p) || L.t > 7 || (!isRagdoll(p) && L.t > 0.5))) {
      L.state = 'rising'; L.t = 0;
      setTimeout(() => {
        getUp(p).then(() => {
          if (this.mode !== 'down') return;
          p.object.getWorldPosition(_a);
          this.placePerson(_a.x, _a.z, _a.y + 0.8);
          const f = _b.set(0, 0, -1).applyQuaternion(p.object.getWorldQuaternion(_q)); f.y = 0;
          this.face = f.lengthSq() > 1e-4 ? Math.atan2(f.x, f.z) : this.face;
          this.downL = null;
          this.mode = 'foot'; this.anim = null;
          play(p, 'idle', { fade: 0.4 });
        });
      }, 900);
    }
  }

  // ----------------------------------------------------------------------------------------------------------
  // the cars left about: their own physics (asleep once still), drawn between steps as the player's car is

  addLeft(e) {
    e.prevPos = e.vehicle.pos.clone(); e.prevQ = e.vehicle.q.clone(); e.acc = 0; e.asleep = false; e.still = 0; e.preVel = new THREE.Vector3();
    e.proxy = { rig: e.rig, x: 0, y: 0, z: 0, yaw: 0, offYaw: 0, v: 0, push: new THREE.Vector2(), spinV: 0, hitT: 0, len: e.rig.dims.length, left: e };
    this.syncProxy(e);
    this.parked.push(e);
    // too many: the one furthest away goes
    while (this.parked.length > MAX_LEFT) {
      let far = 0, fd = -1;
      this.parked.forEach((q, i) => { const o = q.vehicle.pos, d = (o.x - this.pos.x) ** 2 + (o.z - this.pos.z) ** 2; if (d > fd && q !== e) { fd = d; far = i; } });
      this.disposeLeft(this.parked.splice(far, 1)[0]);
    }
    return e;
  }

  syncProxy(e) {
    const P = e.proxy, v = e.vehicle, o = v.origin(_c);
    P.x = o.x; P.y = o.y; P.z = o.z; P.yaw = v.heading * Math.PI / 180; P.v = Math.max(0, v.fwdSpeed);
  }

  disposeLeft(e) {
    const R = this.occ.rec(e.rig);
    if (R) this.occ.release(R);
    if (e.rig.dispose) e.rig.dispose(); else if (e.rig.object.parent) e.rig.object.parent.remove(e.rig.object);
  }

  stepLeft(dt) {
    const D = this.drive;
    if (!this.parked.length) return;
    const pv = D.car ? D.car.vehicle : null, foc = this.mode === 'car' && pv ? pv.pos : this.pos;
    const env = { ground: (x, z, y) => D.ground(x, z, y), collide: D.collide, others: null };
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const e = this.parked[i], v = e.vehicle;
      // far behind: gone
      if ((v.pos.x - foc.x) ** 2 + (v.pos.z - foc.z) ** 2 > FAR_LEFT * FAR_LEFT && !(this.seq && this.seq.target && this.seq.target.rig === e.rig)) { this.parked.splice(i, 1); this.disposeLeft(e); continue; }
      e.preVel.copy(v.v);
      // woken by the player's car coming close, or by being driven off
      if (e.asleep) {
        const near = pv && D.car.rig !== e.rig && (pv.pos.x - v.pos.x) ** 2 + (pv.pos.z - v.pos.z) ** 2 < (v.len / 2 + pv.len / 2 + 2) ** 2;
        if (!near && !e.brake) continue;
        e.asleep = false; e.still = 0; e.acc = 0; e.prevPos.copy(v.pos); e.prevQ.copy(v.q);
      }
      const others = [];
      if (pv && D.car.rig !== e.rig) for (const c of pv.circles) others.push({ x: c.x, z: c.z, r: c.r, vx: pv.v.x, vz: pv.v.z, obj: null });
      for (const q of this.parked) if (q !== e) for (const c of q.vehicle.circles) others.push({ x: c.x, z: c.z, r: c.r, vx: q.vehicle.v.x, vz: q.vehicle.v.z, obj: null });
      env.others = others;
      const inp = e.brake ? { throttle: 0, brake: 1, steer: 0, handbrake: v.speed < 3 ? 1 : 0 } : { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
      e.acc += dt;
      let n = 0;
      while (e.acc >= STEP && n < 12) { e.prevPos.copy(v.pos); e.prevQ.copy(v.q); v.step(STEP, inp, env); e.acc -= STEP; n++; }
      if (n === 12) e.acc = 0;
      if (e.brake && v.speed < 0.3) e.brake = false;
      const a = Math.min(1, e.acc / STEP), o = e.rig.object;
      _q.copy(e.prevQ).slerp(v.q, a);
      o.quaternion.copy(_q);
      o.position.copy(v.com).applyQuaternion(_q).negate().add(_a.copy(e.prevPos).lerp(v.pos, a));
      const look = v.look(); look.signal = e.kind === 'stolen' || e.hazard ? 2 : 0; look.headlights = false; look.dt = dt;
      if (e.rig.update) e.rig.update(dt, look);
      this.syncProxy(e);
      // still for a second: asleep
      if (v.speed < 0.05 && v.w.length() < 0.05 && !v.hits.length) e.still += dt; else e.still = 0;
      if (e.still > 1 && !e.brake) e.asleep = true;
    }
  }

  // ----------------------------------------------------------------------------------------------------------
  // the camera on foot: behind and a little over the person, out of walls

  startCam() {
    if (this.camOwned) return;
    this.camOwned = true;
    this.camFrom = { p: this.camera.position.clone(), q: this.camera.quaternion.clone(), t: 0 };
    // looking the way the camera was looking
    const f = _a.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camYaw = Math.atan2(f.x, f.z);
    this.camReady = false;
    this.setHud();
  }

  camUpdate(dt) {
    const cam = this.camera, p = this.person;
    if (!p) return;
    const D = this.drive;
    const h = (this.look && this.look.height) || (p.height || 1.75);
    const tgt = _a.copy(this.mode === 'down' || (this.seq && this.seq.phase === 'climb') ? p.object.getWorldPosition(_c) : this.pos);
    tgt.y += this.mode === 'down' ? 0.5 : h * 0.9;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const want = _b.set(tgt.x - Math.sin(this.camYaw) * cp * this.camDist, tgt.y + sp * this.camDist + 0.25, tgt.z - Math.cos(this.camYaw) * cp * this.camDist);
    // out of walls
    const dir = _c.copy(want).sub(tgt), len = dir.length();
    if (len > 1e-3) {
      dir.divideScalar(len);
      const hit = D.world.raycast(tgt, dir, len);
      if (hit && hit.distance < len) want.copy(tgt).addScaledVector(dir, Math.max(0.6, hit.distance - 0.25));
    }
    const g = D.ground(want.x, want.z, want.y);
    if (g !== null && Number.isFinite(g) && want.y < g + 0.35) want.y = g + 0.35;
    if (!this.camReady) { this.camPos.copy(want); this.camReady = true; }
    this.camPos.lerp(want, 1 - Math.exp(-dt * 14));
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    this.camLook.set(tgt.x + Math.sin(this.camYaw) * 1.2, tgt.y - 0.1, tgt.z + Math.cos(this.camYaw) * 1.2);
    cam.lookAt(this.camLook);
    // eased in from where the car's camera was
    const F = this.camFrom;
    if (F && F.t < 1) {
      F.t = Math.min(1, F.t + dt / 0.8);
      const k = ease(F.t);
      cam.position.lerpVectors(F.p, cam.position, k);
      _q.copy(cam.quaternion); cam.quaternion.copy(F.q).slerp(_q, k);
    }
    if (Math.abs(cam.fov - 60) > 0.05) { cam.fov += (60 - cam.fov) * Math.min(1, dt * 3); }
    cam.near = 0.1; cam.updateProjectionMatrix();
    this.drive.G.sky && this.drive.G.sky.update && null;
  }

  // ----------------------------------------------------------------------------------------------------------
  // the HUD: no speedometer on foot, a hint when a car can be got into

  setHud() {
    const el = this.drive.hud && this.drive.hud.el;
    if (el) el.classList.toggle('onfoot', this.mode !== 'car' && this.mode !== 'exit');
  }

  hudStep(dt) {
    this.setHud();
    this.hintT -= dt;
    if (this.hintT > 0) return;
    this.hintT = 0.25;
    let text = '';
    if (this.mode === 'foot') {
      const t = this.target();
      this.near = t;
      if (t) {
        const occupied = t.kind === 'traffic' || t.kind === 'parked' ? this.occ.occupied(t.kind === 'parked' ? t.ref : t.rig, 0) || t.kind === 'traffic' : this.occ.occupied(t.rig, 0);
        text = occupied ? 'Press <b>E</b> to take this car' : 'Press <b>E</b> to get in';
      } else if (!this.toldWalk) text = '<b>W A S D</b> walk, <b>Shift</b> run, <b>Space</b> jump, drag to look';
    } else if (this.mode === 'enter' && this.seq && this.seq.phase === 'approach') text = 'Press <b>E</b> again to stop';
    else if (this.mode === 'car' && !this.toldOut) {
      this.toldOutT = (this.toldOutT || 0) + 0.25;
      if (this.toldOutT > 3 && this.toldOutT < 9) text = 'Press <b>E</b> to get out of the car';
      if (this.toldOutT >= 9) this.toldOut = true;
    }
    if (this.mode === 'foot' && !this.toldWalkT) this.toldWalkT = performance.now();
    if (this.toldWalkT && performance.now() - this.toldWalkT > 7000) this.toldWalk = true;
    if (text !== this.hintText) { this.hintText = text; if (text) this.hint.innerHTML = text; this.hint.classList.toggle('on', !!text); }
  }
}

// push a circle (x, z, r) out of a box centred at (cx, cz) facing yaw (heading in radians: forward (sin, -cos)),
// half length hl, half width hw; [dx, dz] or null
function pushBox(x, z, r, cx, cz, yaw, hl, hw) {
  const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
  const dx = x - cx, dz = z - cz;
  const lf = dx * fx + dz * fz, lr = dx * rx + dz * rz;
  const qf = Math.max(-hl, Math.min(hl, lf)), qr = Math.max(-hw, Math.min(hw, lr));
  const ef = lf - qf, er = lr - qr, d2 = ef * ef + er * er;
  if (d2 > r * r) return null;
  let pf, pr;
  if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pf = ef * k; pr = er * k; }
  else {
    // the middle is inside: out through the nearest side
    const of = hl - Math.abs(lf), or = hw - Math.abs(lr);
    if (of < or) { pf = Math.sign(lf || 1) * (of + r); pr = 0; } else { pr = Math.sign(lr || 1) * (or + r); pf = 0; }
  }
  return [fx * pf + rx * pr, fz * pf + rz * pr];
}

// two-bone IK: turn the upper and lower bones so the end (hand) reaches the target, the elbow bending down and out
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(), _t4 = new THREE.Vector3(), _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion();
function twoBone(upper, lower, end, target) {
  upper.updateWorldMatrix(true, true);
  const a = upper.getWorldPosition(_t1), b = lower.getWorldPosition(_t2), c = end.getWorldPosition(_t3);
  const la = a.distanceTo(b), lb = b.distanceTo(c);
  const t = _t4.copy(target);
  const at = t.clone().sub(a), dist = Math.min(at.length(), (la + lb) * 0.999);
  if (dist < 1e-4) return;
  // the angle at the elbow
  const cosB = THREE.MathUtils.clamp((la * la + lb * lb - dist * dist) / (2 * la * lb), -1, 1);
  const curB = b.clone().sub(a).normalize().angleTo(c.clone().sub(b).normalize());
  const wantB = Math.PI - Math.acos(cosB);
  // bend axis: perpendicular to the arm's plane (keep the current one)
  const ab = b.clone().sub(a), bc = c.clone().sub(b);
  let axis = ab.clone().cross(bc);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  const dB = wantB - curB;
  // rotate the lower bone about the axis (in its parent's frame)
  rotateWorld(lower, axis, dB);
  upper.updateWorldMatrix(true, true);
  // then swing the whole arm so the hand points at the target
  const c2 = end.getWorldPosition(new THREE.Vector3());
  const from = c2.sub(a).normalize(), to = at.normalize();
  _tq.setFromUnitVectors(from, to);
  const ax2 = new THREE.Vector3(), ang = 2 * Math.acos(THREE.MathUtils.clamp(_tq.w, -1, 1));
  if (ang > 1e-4) { ax2.set(_tq.x, _tq.y, _tq.z).normalize(); rotateWorld(upper, ax2, ang); }
  upper.updateWorldMatrix(true, true);
}
function rotateWorld(bone, axisW, ang) {
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  const local = axisW.clone().applyQuaternion(parentQ.clone().invert());
  bone.quaternion.premultiply(_tq2.setFromAxisAngle(local, ang));
}
