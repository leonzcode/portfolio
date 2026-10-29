// The player on foot. E in a car stops it (brakes, then the handbrake; the engine idles), the driver's door opens,
// the player's person climbs out and the door shuts; then a third-person camera follows the person (drag or the
// arrow keys to look, the wheel to come closer), W A S D walk, Shift runs, Space jumps, and the person is stopped
// by buildings, props and cars and stands on whatever drive.ground gives (roads, pavements, roofs). E near a car
// walks to its driver's door, opens it, pulls out whoever is driving and throws them on the road (they get up
// angry), gets in and drives off. A traffic car taken this way leaves the traffic and becomes the player's car
// (its cheap model swapped for the detailed one once that is ready); the car the player left stays where it was,
// solid, with its own physics, until it is far behind.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js?v=42';
import { Occupants, seatsOf, seatOffset, play, tick, YAW0, settled, isRagdoll, getUp, RECLINE } from './occupants.js?v=42';

const STEP = 1 / 120;
// on foot (m/s): a brisk walk, a jog once the person has kept going a second and a half, a run with Shift
const WALK = 1.75, JOG = 3.5, RUN = 5.6, JOG_AFTER = 1.5, JUMP = 4.0, G = 9.81, R_BODY = 0.3, STEP_UP = 0.45;
// the walking clips' own speeds at speed 1 (m/s, for the models' own height: measured as the planted foot's speed
// back along the body) and where in each cycle the left heel strikes (a change of clip keeps the feet in step)
const GAIT = {
  m: { walk: [1.0, 0.642], walk_fast: [1.4, 0.688], run: [2.85, 0.771], sprint: [5.4, 0.721] },
  f: { walk: [1.2, 0.196], walk_fast: [1.6, 0.163], run: [2.8, 0.217], sprint: [5.3, 0.146] }
};
// which clip for a speed: [name, from (m/s), to]; a clip is kept a little past its edges so it does not flicker
const GAITS = [['walk', 0.25, 1.45], ['walk_fast', 1.45, 2.5], ['run', 2.5, 4.5], ['sprint', 4.5, 99]];
function gaitOf(sp, cur) {
  if (sp < 0.25) return cur === 'idle' || sp < 0.12 ? 'idle' : cur;
  const k = GAITS.find(g => g[0] === cur);
  if (k && sp > k[1] - 0.15 && sp < k[2] + 0.15) return cur;
  for (const g of GAITS) if (sp < g[2]) return g[0];
  return 'sprint';
}
const MAX_LEFT = 6, FAR_LEFT = 520;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), X1 = new THREE.Vector3(1, 0, 0);
const ease = k => k * k * (3 - 2 * k);
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const isBusRig = rig => !!(rig && rig.spec && (rig.spec.kind === 'bus' || rig.spec.bus));
const _v9 = new THREE.Vector3(), _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion(), _q6 = new THREE.Quaternion();
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
  // (while getting out the person is still in or by the car, and this.pos is not theirs yet: the car's place, or the
  // drive streamed the area round wherever the person last stood, (0, 0) on a first E)
  focus() {
    if ((this.mode === 'exit' || this.mode === 'car') && this.drive.car) return this.drive.car.vehicle.origin(this._focus || (this._focus = new THREE.Vector3()));
    return this.pos;
  }

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
    if (!D.active || !D.car || !this.person) return;
    // (two presses close together are one: a quick double tap does not start something and undo it)
    const now = performance.now();
    if (now - (this.lastE || 0) < 350) return;
    this.lastE = now;
    if (this.mode === 'car') {
      // (just sat down, the door still shutting: out again from here)
      if (this.seq && this.seq.kind === 'enter' && this.seq.phase === 'shut') { this.person.handsBusy = false; this.seq = null; }
      if (!this.seq) this.startExit();
      return;
    }
    // still slowing down to get out: E again stays in
    if (this.mode === 'exit' && this.seq && this.seq.phase === 'stop') { this.cancelExit(); return; }
    if (this.mode === 'foot') {
      // (a door still swinging shut behind the person finishes on its own)
      if (this.seq && this.seq.kind === 'exit') { const S = this.seq; this.seq = null; this.seqHoldsWalk = false; this.letGo(this.person, ['handL', 'handR'], 0.15); if (S.door >= 0) this.shutting = { rig: S.rig, door: S.door, from: this.doorOpen(S.rig, S.door), t: 0 }; }
      const t = this.target();
      if (t) { if (this.shutting && t.rig === this.shutting.rig) this.shutting = null; this.startEnter(t); }
      else D.hud.flash('No car near enough to get in');
      return;
    }
    // walking to a car: E again gives up
    if (this.mode === 'enter' && this.seq && (this.seq.phase === 'approach' || (this.seq.phase === 'righting' && !this.seq.pushing))) this.cancelEnter();
  }

  // ----------------------------------------------------------------------------------------------------------
  // the drive's hooks

  // the car's input while the player is not at the wheel (null: the player drives)
  carInput(dt = 1 / 60) {
    if (this.mode === 'car') return null;
    const D = this.drive, v = D.car.vehicle;
    if (this.mode === 'exit' && this.seq && this.seq.phase === 'stop') {
      // braking to a stop, still steered with A and D (the road may bend)
      const k = D.keys, st = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
      this.stopSteer = (this.stopSteer ?? (D.inputSteer || 0));
      this.stopSteer += THREE.MathUtils.clamp(st - this.stopSteer, -dt * 4, dt * 4);
      return { throttle: 0, brake: 1, steer: this.stopSteer, handbrake: Math.abs(v.fwdSpeed) < 3 ? 1 : 0 };
    }
    this.stopSteer = null;
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
    this.seq = null; this.mode = 'car'; this.camOwned = false; this.camBlend = null; this.downL = null; this.coastCar = null; this.hidePerson = false;
    this.outs = []; this.shutting = null; this.laterDoor = null; this.fades = [];
    if (this.person) this.person.handsBusy = false;
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
    // The player's car's driver's door cut ahead (damage.js cuts it out of the body in the background a few seconds
    // after a drop or a change of car): that job moved to the front of its queue and given a few milliseconds more
    // each frame while driving, until the door is cut, so an E soon after does not wait for it; the other front door
    // cut by this module a little later (for getting out on that side)
    if (D.car && D.car.rig !== this.carRig) { this.carRig = D.car.rig; this.carSince = performance.now(); }
    if (D.car && D.car.rig !== this.doorFor) {
      const rig = D.car.rig, I = this.doorOf(rig, 0);
      if (I && (this.prepDoor(rig, I.door) || this.doorCut(rig, I.door))) {
        this.doorFor = rig;
        const other = this.otherSeat(rig), J = other !== null ? this.doorOf(rig, other) : null;
        this.laterDoor = J ? { rig, door: J.door, t: 4 } : null;
      }
    }
    if (this.mode === 'car' && !this.seq && D.car && this.doorFor === D.car.rig && ((this.fN = (this.fN || 0) + 1) % 4 === 0 || this.cutting)) {
      const I = this.doorOf(D.car.rig, 0);
      this.cutting = !!I && !this.doorCut(D.car.rig, I.door);
      if (this.cutting) this.pumpDoor(D.car.rig, I.door, 3);
    }
    // the player in the driver's seat of the car being driven
    if (this.mode === 'car' && this.person && (!this.occ.player || this.occ.player.R !== this.occ.rec(D.car.rig) || this.occ.player.o.person !== this.person || this.person.object.parent !== D.car.rig.object)) {
      this.occ.unseatPlayer();
      this.occ.seatPlayer(D.car.rig, D.car.rig, this.person);
    }
    if (this.seq) { try { this.seqStep(dt); } catch (e) { console.warn('get in/out', e); this.abortSeq(); } }
    if (this.mode === 'foot') this.walk(dt);
    else if (this.mode === 'down') this.downStep(dt);
    this.fadeStep(dt);
    try { this.outsStep(dt); } catch (e) { console.warn('passengers', e); this.outs = []; }
    this.doorsStep(dt);
    // (the eased seat offset taken off before the occupants check the seated person's place, put on after)
    if (this.seatBlend && this.seatBlend.applied) { const B = this.seatBlend; B.p.object.position.addScaledVector(B.off, -B.applied); B.p.object.quaternion.copy(B.q0); B.applied = 0; }
    this.occ.update(dt);
    this.seatBlendStep(dt);
    // the head is hidden from the driver's own camera, and the whole body while looking back over a shoulder
    // (the camera would be inside it)
    if (this.person) {
      const inside = this.mode === 'car' && D.cam.view === 'driver' && !this.camOwned;
      this.headVisible(!inside);
      this.person.object.visible = !this.hidePerson && !(inside && (D.lookBack || Math.abs(D.cam.yawOff || 0) > 1.25));
    }
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

  // the doors left to themselves: one still shutting behind a person who walked off, and the other front door of
  // the player's car cut in the background a moment after getting in (for getting out on that side)
  doorsStep(dt) {
    const Sh = this.shutting;
    if (Sh) {
      Sh.t += dt;
      const k = Math.min(1, Sh.t / 0.45);
      this.setDoor(Sh.rig, Sh.door, (Sh.from ?? 1) * (1 - ease(k)));
      if (k >= 1) this.shutting = null;
    }
    const L = this.laterDoor;
    if (L && (L.t -= dt) <= 0) { if (this.drive.car && L.rig === this.drive.car.rig) { const j = this.prepDoor(L.rig, L.door); if (!j && !this.doorCut(L.rig, L.door)) L.t = 1; else this.laterDoor = null; } else this.laterDoor = null; }
  }

  // a hint shown at once (and for a moment), over the ones the HUD works out
  hintNow(text, ms = 2500) { this.forceHint = text ? { text, until: performance.now() + ms } : null; this.hintT = 0; }

  // ----------------------------------------------------------------------------------------------------------
  // the doors: where a person stands to open one and to get in or out, and whether there is room there

  // a seat's door in the car's frame (forward -z, right +x, the ground at y 0): sx its side (-1 left, 1 right), xs
  // the body's side there, zh and zt the door's front (hinge) and back edges, y0 and y1 its bottom and top, floor the
  // cabin floor's height and tall for a bus's or a truck's high floor (up steps); stand: where a person stands
  // beside the seat (inside the open door's swing); handle: behind the door, where they stand to open or shut it;
  // grip and gripIn: the door's handles outside and inside (on the door, as it is shut)
  doorOf(rig, seatI = 0) {
    if (!rig || !rig.dims) return null;
    const cache = rig._ofDoor || (rig._ofDoor = {});
    if (cache[seatI]) return cache[seatI];
    const s = seatsOf(rig)[seatI];
    if (!s) return null;
    const docs = rig.spec && rig.spec.doors;
    const d = docs && s.door >= 0 ? docs[s.door] : null;
    const side = d && d.side ? d.side : s.side === 'R' ? 'R' : 'L';
    const sx = side === 'R' ? 1 : -1, w = rig.dims.width;
    let xs = w / 2 - 0.06, zh = s.z - 0.8, zt = s.z + 0.35, y0 = 0.3, y1 = Math.min(rig.dims.height - 0.1, s.y + 0.85);
    if (d && d.box) { const b = d.box; xs = Math.max(Math.abs(b[0][0]), Math.abs(b[1][0])); zh = Math.min(b[0][2], b[1][2]); zt = Math.max(b[0][2], b[1][2]); y0 = Math.min(b[0][1], b[1][1]); y1 = Math.max(b[0][1], b[1][1]); }
    const floor = Math.max(0.12, s.y - 0.42), tall = floor > 0.9;
    const standZ = THREE.MathUtils.clamp(s.z + 0.05, zh + 0.3, Math.max(zh + 0.3, zt - 0.12));
    const I = {
      seat: s, i: seatI, door: d ? s.door : -1, sx, xs, zh, zt, y0, y1, floor, tall, open: d && d.open ? d.open : 65,
      stand: new THREE.Vector3(sx * (xs + 0.36), 0, standZ),
      handle: new THREE.Vector3(sx * (xs + 0.5), 0, zt + 0.32),
      grip: new THREE.Vector3(sx * (xs + 0.03), y0 + (y1 - y0) * 0.58, zt - 0.12),
      gripIn: new THREE.Vector3(sx * (xs - 0.12), Math.min(y1 - 0.25, s.y + 0.36), Math.max(zh + 0.15, s.z - 0.32)),
      len: Math.max(0.6, zt - zh)
    };
    cache[seatI] = I;
    return I;
  }

  // the seat a player can slide across from (or to) the driver's seat: the front seat on the other side, with a
  // door of its own on that side
  otherSeat(rig) {
    const seats = seatsOf(rig), drv = this.doorOf(rig, 0);
    if (!drv) return null;
    for (let i = 1; i < seats.length; i++) {
      const s = seats[i], I = this.doorOf(rig, i);
      if (!I || I.door < 0 || I.sx === drv.sx) continue;
      if (Math.abs(s.z - seats[0].z) > 0.7) continue;
      return i;
    }
    return null;
  }

  // a body (a circle r round x, z, from about the knees to the head) there touches nothing, walls, props, cars (but
  // `skip`), and the ground there is about level with y
  clearAt(x, z, y, r = 0.27, skip = null) {
    const D = this.drive;
    const g = D.ground(x, z, y + 0.8);
    // (why not, for tests: this.why)
    if (g === null || !Number.isFinite(g) || g > y + 0.55 || g < y - 1.0) { this.why = 'ground ' + (g === null ? 'none' : (g - y).toFixed(2)); return false; }
    if (D.collide) { try { const h = D.collide.contacts([{ x, z, r, y0: g + 0.4, y1: g + 1.6 }]).find(h => !(h.shape && h.shape.tag === 'person')); if (h) { this.why = 'wall ' + (h.shape && h.shape.tag); return false; } } catch (e) {} }
    const hit = (rig, v) => {
      if (!rig || rig === skip || !rig.dims) return false;
      const o = v.origin(_c);
      if (g > o.y + rig.dims.height - 0.2 || g + 1.7 < o.y) return false;
      return !!pushBox(x, z, r, o.x, o.z, v.heading * Math.PI / 180, rig.dims.length / 2, rig.dims.width / 2);
    };
    if (D.car && hit(D.car.rig, D.car.vehicle)) { this.why = 'car'; return false; }
    for (const e of this.parked) if (hit(e.rig, e.vehicle)) { this.why = 'left car'; return false; }
    if (D.traffic) for (const c of D.traffic.list) {
      if (c.rig === skip || Math.abs(c.x - x) > 7 || Math.abs(c.z - z) > 7) continue;
      if (pushBox(x, z, r, c.x, c.z, c.yaw + (c.offYaw || 0), c.rig.dims.length / 2, c.rig.dims.width / 2)) { this.why = 'traffic'; return false; }
    }
    return true;
  }

  // room by a door: to stand beside the seat, behind the door, and for the door to swing out most of the way
  doorRoom(rig, I) {
    if (!I) return false;
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld;
    for (const p of [I.stand, I.handle]) { const w = _a.copy(p).applyMatrix4(M); if (!this.clearAt(w.x, w.z, w.y, 0.25, rig)) { this.why = (p === I.stand ? 'stand: ' : 'handle: ') + this.why; return false; } }
    // the door's back edge two thirds open
    const D = this.drive;
    if (D.collide && I.door >= 0) {
      const th = I.open * 0.66 * Math.PI / 180;
      const tip = _b.set(I.sx * (I.xs + I.len * Math.sin(th)), (I.y0 + I.y1) / 2, I.zh + I.len * Math.cos(th)).applyMatrix4(M);
      try { if (D.collide.contacts([{ x: tip.x, z: tip.z, r: 0.12, y0: tip.y - 0.3, y1: tip.y + 0.3 }]).some(h => !(h.shape && h.shape.tag === 'person'))) { this.why = 'door swing'; return false; } } catch (e) {}
    }
    return true;
  }

  // a direction in the car's frame (a person facing (sin a, 0, cos a)) as the person's yaw in the world (this.face)
  yawOf(rig, a) { _c.set(Math.sin(a), 0, Math.cos(a)).transformDirection(rig.object.matrixWorld); return Math.atan2(_c.x, _c.z); }

  // A door cut out of the body ahead of being opened: damage.js cuts a door the first time it is wanted, which held
  // the frame for a tenth to a fifth of a second on a traffic car. Its own background job (the same steps), put first
  // in the damage module's queue and registered as the car's door job so a sudden need finishes it rather than
  // cutting twice. Null when there is nothing to do or another door of the car is being cut (asked again later).
  prepDoor(rig, i) {
    const dm = this.drive.damage;
    if (!dm || !rig || rig.fake || i === undefined || i === null || i < 0 || typeof rig.doorNode !== 'function' || !Array.isArray(dm.bg)) return null;
    try {
      const rd = dm.of(rig);
      const st = rd.doors && rd.doors[i];
      if (st && st.pivot) return null;
      if (rd.A && i >= rd.A.doors.length) return null;
      if (rd.doorJob && !rd.doorJob.done) return rd.doorJob.door === i ? rd.doorJob : null;
      // The player's car is the damage module's to make ready first: it splits the outside meshes (presplit) and
      // then cuts the driver's door (predoor), in that order, a few seconds after a drop or a change of car (a door
      // cut from the coarse mesh crushes badly), and a job of this module's for that door as well would cut it twice.
      // So for the player's car: nothing while the damage module has work queued for it, and the driver's door only
      // if its own step never comes.
      const mine = this.drive.car && this.drive.car.rig === rig;
      if (mine && dm.bg.some(j => j.rd === rd && !j.done)) return null;
      if (mine && i === 0 && performance.now() - (this.carSince || 0) < 8000 && (!rd.readied || (rd.readyMs || []).length < 5)) return null;
      // (perf A: the damage module's own door preparation, when it has it: its job waits for the model's analysis in
      // the background, where this one worked it out at once after 60 runs, 0.2 to 0.5 s in one frame; the job is in
      // the module's list as before, so pumpDoor runs it the same way)
      if (typeof dm.prepareDoor === 'function') {
        dm.prepareDoor(rig, i).catch(() => {});
        return dm.bg.find(j => j.rd === rd && j.door === i && !j.done) || null;
      }
      const job = { rd, done: false, deadline: 0, door: i, started: false };
      // (the car's model has to be worked out first: the damage module does that in the background, for the player's
      // car as it is made ready and for the traffic's and parked models ahead; worked out here only if that has not
      // come after a while, as it is one long step)
      const it = (function* () { let n = 0; while (mine && !rd.A && n++ < 60) { job.waiting = true; yield; } job.waiting = false; rd.analysis(); if (i >= rd.doorList().length) return null; yield; return yield* rd.doorNodeGen(job, i); })();
      job.run = budget => {
        if (job.done) return true;
        const t0 = performance.now();
        job.started = true; job.deadline = t0 + budget;
        try { for (;;) { const r = it.next(); if (r.done) { job.done = true; break; } if (job.waiting || performance.now() >= job.deadline) break; } }
        catch (e) { job.done = true; console.warn('door cut', e); }
        job.ms = (job.ms || 0) + performance.now() - t0; job.runs = (job.runs || 0) + 1;
        // (waiting for the car's model to be worked out: to the back of the queue, the work it waits for may be there)
        if (job.waiting) { const k = dm.bg.indexOf(job); if (k >= 0 && dm.bg.length > 1) { dm.bg.splice(k, 1); dm.bg.push(job); } }
        return job.done;
      };
      rd.doorJob = job;
      // (first in the queue for another car, the one the person is about to open; last for the player's own)
      if (mine) dm.bg.push(job); else dm.bg.unshift(job);
      return job;
    } catch (e) { return null; }
  }
  // the door is cut (or there is nothing to cut: no damage module, no such door)
  doorCut(rig, i) {
    try {
      if (!this.drive.damage || !rig || i === undefined || i === null || i < 0 || typeof rig.doorNode !== 'function') return true;
      const rd = rig._dmg;
      if (!rd) return false;
      const st = rd.doors && rd.doors[i];
      if (st && st.pivot) return true;
      return !!(rd.A && i >= rd.A.doors.length);
    } catch (e) { return true; }
  }
  // a few milliseconds of the door's cut now (while a person waits at it); true once it is cut
  pumpDoor(rig, i, ms = 6) {
    if (this.doorCut(rig, i)) return true;
    // (perf A) someone is at this door: its cut goes first, straight after the model's analysis, and the rest of the
    // car's preparation (splitting the outside meshes, presplit) waits. Run in the list's own order, the first E
    // after a drop waited for all of it, 6 s, and then finished it in one frame of up to 8 s.
    const dmg = this.drive.damage;
    if (dmg && typeof dmg.prepareDoor === 'function' && Array.isArray(dmg.bg) && typeof rig.doorNode === 'function' && !rig.fake) {
      try {
        const dm = dmg, rd = dm.of(rig);
        dm.prepareDoor(rig, i).catch(() => {});
        const end = performance.now() + ms, left = () => Math.max(0.2, end - performance.now());
        const an = dm.bg.find(b => b.rd === rd && b.analysis && !b.done);
        if (an) an.run(left());
        // the car's door job first if it is another door's (one door of a car at a time), then this door's
        if (rd.doorJob && !rd.doorJob.done && rd.doorJob.door !== i && performance.now() < end) rd.doorJob.run(left());
        const dj = (rd.doorJob && !rd.doorJob.done && rd.doorJob.door === i) ? rd.doorJob : dm.bg.find(b => b.rd === rd && b.door === i && !b.done);
        if (dj && performance.now() < end) dj.run(left());
        return this.doorCut(rig, i);
      } catch (e) { console.warn('door pump', e); }
    }
    const j = this.prepDoor(rig, i) || (rig._dmg && rig._dmg.doorJob && rig._dmg.doorJob.door === i ? rig._dmg.doorJob : null);
    // the car's queued background work run in its own order (the meshes split before the door is cut out of them),
    // up to the door's job, for a few milliseconds
    const dm = this.drive.damage, rd = rig._dmg;
    if (dm && rd && Array.isArray(dm.bg)) {
      const end = performance.now() + ms;
      for (const b of dm.bg.slice()) {
        if (b.rd !== rd || b.done) continue;
        const left = end - performance.now(); if (left <= 0.2) break;
        try { b.run(left); } catch (e) { b.done = true; }
        if (!b.done || b === j) break;
      }
      return this.doorCut(rig, i);
    }
    if (j && j.run) j.run(ms);
    return this.doorCut(rig, i);
  }
  // still waiting for a door's cut (true): up to 6 s, then the car's queued work up to the cut is finished at once
  // (one long frame: 0.54 s for the Volvo's door, 5.7 s for the semi's on a loaded machine, so the wait is long and
  // the work is pumped harder after half a second)
  waitDoor(S, rig, i, dt) {
    S.wait = (S.wait || 0) + dt;
    if (S.wait < 6) return true;
    if (!S.forced) { S.forced = true; try { this.pumpDoor(rig, i, 1e9); } catch (e) {} }
    return false;
  }
  // how far open a door is (0 shut, 1 open)
  doorOpen(rig, i) { try { const rd = rig && rig._dmg; const st = rd && rd.doors && rd.doors[i]; return st && st.pivot ? (st.open || 0) : 0; } catch (e) { return 0; } }
  doorPivot(rig, i) { try { const rd = rig && rig._dmg; const st = rd && rd.doors && rd.doors[i]; return st && st.pivot ? st.pivot : null; } catch (e) { return null; } }

  // a point on a door (car frame, as shut) where it is now, in the world (the door swung however far it is open)
  onDoor(rig, I, pt, out) {
    rig.object.updateWorldMatrix(true, false);
    const piv = this.doorPivot(rig, I.door);
    out.copy(pt).applyMatrix4(rig.object.matrixWorld);
    if (!piv) return out;
    // the point in the pivot's frame when shut: kept per door (the pivot turns about its own origin)
    const key = pt === I.grip ? '_gripL' : '_gripInL';
    if (!I[key] || I[key + 'P'] !== piv) {
      const save = piv.quaternion.clone();
      piv.quaternion.identity(); piv.updateWorldMatrix(true, false);
      I[key] = piv.worldToLocal(out.clone()); I[key + 'P'] = piv;
      piv.quaternion.copy(save); piv.updateWorldMatrix(true, false);
    }
    piv.updateWorldMatrix(true, false);
    return out.copy(I[key]).applyMatrix4(piv.matrixWorld);
  }

  // ----------------------------------------------------------------------------------------------------------
  // a person's reach eased in and out (a hand to a door handle and back, the hands off the wheel)

  reachTo(p, key, target, w, dt, rate = 6) {
    if (!p || !p.ik) return;
    if (!p.ikW) p.ikW = { handL: 1, handR: 1, footL: 1, footR: 1 };
    if (this.fades) this.fades = this.fades.filter(f => f.p !== p || f.key !== key);
    const own = p['_ik' + key] || (p['_ik' + key] = new THREE.Vector3());
    const cur = p.ik[key] === own ? (p.ikW[key] ?? 1) : 0;
    const k = cur + THREE.MathUtils.clamp(w - cur, -rate * dt, rate * dt);
    // (a hand already reaching somewhere moves over to the new point, as a hand does, rather than jumping there)
    if (target) { if (cur > 0.05) own.lerp(target, Math.min(1, dt * 9)); else own.copy(target); }
    p.ik[key] = own; p.ikW[key] = k;
    if (k <= 0.001 && w <= 0) { p.ik[key] = null; p.ikW[key] = 1; }
  }
  // every reach let go over a moment (from where the limbs are reaching now)
  letGo(p, keys = ['handL', 'handR', 'footL', 'footR'], dur = 0.3) {
    if (!p || !p.ik) return;
    this.fades = (this.fades || []).filter(f => f.p !== p || !keys.includes(f.key));
    for (const key of keys) {
      const t = p.ik[key];
      if (!t) continue;
      const own = p['_ik' + key] || (p['_ik' + key] = new THREE.Vector3());
      if (t !== own) own.copy(t);
      p.ik[key] = own;
      this.fades.push({ p, key, from: p.ikW ? (p.ikW[key] ?? 1) : 1, to: 0, t: 0, dur });
    }
  }
  // the reaches as they are (world points), kept by this module (the occupants' own targets move with the car)
  holdReaches(p) {
    if (!p || !p.ik) return;
    for (const key of ['handL', 'handR', 'footL', 'footR']) {
      const t = p.ik[key]; if (!t) continue;
      const own = p['_ik' + key] || (p['_ik' + key] = new THREE.Vector3());
      if (t !== own) own.copy(t);
      p.ik[key] = own;
    }
  }
  fadeIn(p, keys, dur = 0.35) {
    if (!p) return;
    if (!p.ikW) p.ikW = { handL: 1, handR: 1, footL: 1, footR: 1 };
    this.fades = (this.fades || []).filter(f => f.p !== p || !keys.includes(f.key));
    for (const key of keys) { p.ikW[key] = 0; this.fades.push({ p, key, from: 0, to: 1, t: 0, dur }); }
  }
  fadeStep(dt) {
    if (!this.fades || !this.fades.length) return;
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i]; f.t += dt;
      const k = Math.min(1, f.t / f.dur), w = f.from + (f.to - f.from) * ease(k);
      if (f.p.ikW) f.p.ikW[f.key] = w;
      if (k >= 1) { this.fades.splice(i, 1); if (f.to === 0 && f.p.ik) { f.p.ik[f.key] = null; f.p.ikW[f.key] = 1; } }
    }
  }

  // ----------------------------------------------------------------------------------------------------------
  // the climb in and out of a seat: the clip (exit_L/R, enter_L/R, made in poses.js: in the seated person's frame,
  // the body turned by the clip itself) gives the pose; the hips are kept on a path in the car's frame (the seat, the
  // edge of the seat by the door, standing beside the car); the feet go down to the ground (or a bus's floor) once
  // standing, and the body comes upright in the world once out of the seat (a car on a slope, a kerb). Used for the
  // player and for passengers getting out.

  // C: { p, rig, I, dir: 'out' | 'in', dur, P0 (seat hips), P1 (the edge), P2 (standing hips), floor (car frame, the
  // standing level) or null for the ground, recline }
  climbStart(C) {
    const p = C.p, side = C.I.sx > 0 ? 'R' : 'L';
    C.t = 0; C.clip = (C.dir === 'out' ? 'exit_' : 'enter_') + side;
    p.seated = C.dir === 'in';
    if (p.object.parent !== this.scene) this.scene.attach(p.object);
    if (p.capture) try { p.capture(C.dir === 'out' ? 0.3 : 0.25, { noRoot: C.dir === 'in' }); } catch (e) {}
    const a = play(p, C.dir === 'out' ? 'exit_car' : 'enter_car', { fade: 0, side, once: true });
    C.action = a; if (a) a.timeScale = 0;
    // where the hips are in the person's own frame: from the pose now
    this.hipsLocal(C);
    this.climbStep(C, 0);
  }
  hipsLocal(C) {
    const p = C.p, hb = p.bone && p.bone('hips');
    if (!hb) { C.hipL = (C.hipL || new THREE.Vector3()).set(0, C.dir === 'out' ? 0.48 : 0.9, 0); return; }
    p.object.updateMatrixWorld(true);
    C.hipL = p.object.worldToLocal(hb.getWorldPosition(C.hipL || new THREE.Vector3()));
  }
  climbStep(C, dt) {
    const p = C.p, rig = C.rig;
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld;
    C.t += dt;
    const u = Math.min(1, C.t / C.dur);
    const a = C.action;
    if (a && a.getClip) { a.time = u * a.getClip().duration * 0.9999; a.timeScale = 0; a.paused = false; }
    const out = C.dir === 'out', k = out ? u : 1 - u; // 0 in the seat .. 1 standing
    const K1 = 0.47;
    const hipC = k < K1 ? _h1.copy(C.P0).lerp(C.P1, ease(k / K1)) : _h1.copy(C.P1).lerp(C.P2, ease((k - K1) / (1 - K1)));
    const hipW = _h2.copy(hipC).applyMatrix4(M);
    // turned to the car's forward (the clip turns the body), leaning back in the seat, upright once standing
    const q0 = C.qRel || _q5.setFromAxisAngle(X1, C.recline || 0);
    _q.copy(q0).slerp(_q6.identity(), smooth(k, 0.05, K1));
    const carQ = rig.object.getWorldQuaternion(_q2);
    const tilted = _q3.copy(carQ).multiply(_q);
    const upQ = _q4.setFromAxisAngle(UP, this.yawOf(rig, Math.PI) + YAW0);
    p.object.quaternion.copy(tilted).slerp(upQ, smooth(k, 0.35, 0.95));
    // the object placed so the hips are on the path; the height from the hips while seated, from the feet standing
    const off = _b.copy(C.hipL).applyQuaternion(p.object.quaternion);
    p.object.position.copy(hipW).sub(off);
    const wy = 1 - smooth(k, 0.55, 0.9);
    if (wy < 1) {
      let gy;
      if (C.floor !== null && C.floor !== undefined) gy = _c.set(hipC.x, C.floor, hipC.z).applyMatrix4(M).y; // a bus's or truck's floor
      else { const g = this.drive.ground(p.object.position.x, p.object.position.z, hipW.y); gy = g !== null && Number.isFinite(g) ? g : hipW.y - 0.9; }
      p.object.position.y = p.object.position.y * wy + gy * (1 - wy);
    }
    tick(p, dt);
    this.hipsLocal(C);
    return u >= 1;
  }

  // a short walk between two points (world) over dur seconds, turning from one way to another; y from the ground,
  // or along a slope of steps (y0 -> y1), the walking clip matched to the pace
  segStart(G) {
    G.t = 0; G.len = Math.hypot(G.to.x - G.from.x, G.to.z - G.from.z);
    if (!G.dur) G.dur = Math.max(0.35, G.len / (G.speed || 1.2));
    this.anim = null;
  }
  segStep(G, dt) {
    const p = G.p;
    G.t += dt;
    const u = Math.min(1, G.t / G.dur), e = ease(u);
    const x = G.from.x + (G.to.x - G.from.x) * e, z = G.from.z + (G.to.z - G.from.z) * e;
    let y;
    if (G.y0 !== undefined) y = G.y0 + (G.y1 - G.y0) * e;
    else { const g = this.drive.ground(x, z, (G.yh ?? G.from.y) + 0.6); y = g !== null && Number.isFinite(g) ? g : G.from.y; }
    // the pace now (the ease's slope) for the clip
    const sp = G.len / G.dur * 6 * u * (1 - u);
    if (p.object.parent !== this.scene) this.scene.attach(p.object);
    this.face = angLerp(G.face0, G.face1, ease(Math.min(1, u * (G.turnK || 1.6))));
    p.object.position.set(x, y, z);
    p.object.rotation.set(0, this.face + YAW0, 0);
    if (G.p === this.person) { this.pos.set(x, y, z); this.onGround = true; this.gait(p, sp, dt); }
    else play(p, sp > 0.3 ? 'walk' : 'idle', { fade: 0.2, speed: THREE.MathUtils.clamp(sp / 1.1, 0.5, 1.4) });
    tick(p, dt);
    return u >= 1;
  }

  // ----------------------------------------------------------------------------------------------------------
  // getting out

  startExit() {
    const D = this.drive, car = D.car;
    if (!this.person || !this.occ.player) { this.ensurePerson(); D.hud.flash('One moment'); return; }
    this.seq = { kind: 'exit', phase: 'stop', t: 0, car, rig: car.rig };
    this.mode = 'exit';
    car.vehicle.origin(this.pos); this.vel.set(0, 0, 0);
    if (D.auto) D.auto = null;
    this.stats.exits++;
    if (car.vehicle.speed > 1.2) this.hintNow('Stopping to get out. <b>E</b> again to stay in');
  }
  cancelExit() {
    const S = this.seq;
    this.seq = null; this.mode = 'car';
    if (S && S.rig && S.door >= 0) this.setDoor(S.rig, S.door, 0);
    this.hintNow('');
    this.setHud();
  }

  driverDoor(rig) { const s = seatsOf(rig)[0]; return s ? s.door : 0; }

  // the point beside a seat's door where a person stands (car frame)
  doorPoint(rig, seat = 0, out = new THREE.Vector3()) {
    const I = this.doorOf(rig, seat);
    if (!I) return out.set(-(rig.dims.width / 2 + 0.42), 0, 0);
    return out.copy(I.stand);
  }

  seqStep(dt) {
    const S = this.seq;
    S.t += dt;
    if (S.kind === 'exit') return this.exitStep(S, dt);
    if (S.kind === 'enter') return this.enterStep(S, dt);
    if (S.kind === 'crawl') return this.crawlStep(S, dt);
  }

  exitStep(S, dt) {
    const D = this.drive, rig = S.rig, v = S.car.vehicle, p = this.person;
    if (D.car !== S.car || !rig.object.parent) { this.abortSeq(); return; }
    if (S.phase === 'stop') {
      // on its side or roof (and no longer sliding): out through the window
      const upY = _a.set(0, 1, 0).applyQuaternion(v.q).y;
      if (upY < 0.5 && v.speed < 2.5) { this.beginCrawl(S); return; }
      // (not while the wheels are off the ground: a flying Roadster is brought down first, flight.js)
      const still = Math.abs(v.fwdSpeed) < 0.6 && v.speed < 0.9;
      if ((still || (S.t > 8 && v.speed < 2)) && !(v.airTime > 0.15 && S.t < 30)) this.planExit(S);
      return;
    }
    if (S.phase === 'slide' || S.phase === 'open') {
      // the person under this module's hands from here: placed on the seat's path each frame
      if (S.phase === 'slide') {
        S.slideT = (S.slideT || 0) + dt;
        const k = Math.min(1, S.slideT / 0.9);
        this.seatedAt(S, _a.copy(S.P0).lerp(S.Pslide, ease(k)), dt);
        if (k >= 1) { S.phase = 'open'; S.t = 0; S.P0.copy(S.Pslide); }
        return;
      }
      // the door cut first if it is not yet (a few milliseconds a frame), then swung open with the near hand on it
      if (!this.pumpDoor(rig, S.door, (S.wait || 0) > 0.5 ? 25 : 10) && this.waitDoor(S, rig, S.door, dt)) {
        S.t = 0;
        this.reachTo(p, S.I.sx > 0 ? 'handR' : 'handL', _b.copy(S.I.gripIn).applyMatrix4(rig.object.matrixWorld), 1, dt, 4);
        this.seatedAt(S, S.P0, dt); return;
      }
      const k = Math.min(1, S.t / 0.6);
      this.setDoor(rig, S.door, Math.max(this.doorOpen(rig, S.door), ease(k)));
      const hk = S.I.sx > 0 ? 'handR' : 'handL';
      this.reachTo(p, hk, this.onDoor(rig, S.I, S.I.gripIn, _b), k < 0.55 ? 1 : 0, dt, 5);
      this.occ.shadeTo(p, S.shade0 + (1 - S.shade0) * k);
      this.seatedAt(S, S.P0, dt);
      if (k >= 1) {
        S.phase = 'climb'; S.t = 0;
        this.occ.shadeTo(p, 1);
        this.letGo(p, ['handL', 'handR'], 0.2); this.letGo(p, ['footL', 'footR'], 0.45);
        const tall = S.I.tall, s = S.I.seat, sx = S.I.sx, h = p.height || 1.75;
        S.C = { p, rig, I: S.I, dir: 'out', dur: tall ? 1.7 : 1.55, qRel: S.qRel,
          P0: S.P0.clone(),
          P1: tall ? new THREE.Vector3(s.x + sx * 0.14, s.y + 0.02, s.z) : new THREE.Vector3(sx * (S.I.xs - 0.24), s.y + 0.03, (S.P0.z + S.I.stand.z) / 2),
          P2: tall ? new THREE.Vector3(s.x + sx * 0.46, S.I.floor + 0.53 * h, s.z + 0.08) : new THREE.Vector3(S.I.stand.x, 0.53 * h, S.I.stand.z),
          floor: tall ? S.I.floor : null };
        this.climbStart(S.C);
      }
      return;
    }
    if (S.phase === 'climb') {
      if (!this.climbStep(S.C, dt)) return;
      // (the camera on the person once they are out of the seat; a bus's or truck's driver once on the steps)
      if (!S.I.tall) this.startCam(this.doorCamYaw(rig, S.I.sx));
      // standing beside the car (or the seat), facing out: the object turned that way, the clip's turn taken off
      const out = this.yawOf(rig, S.I.sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (p.capture) try { p.capture(0.3, { noRoot: true }); } catch (e) {}
      this.face = out;
      p.object.rotation.set(0, out + YAW0, 0);
      p.object.getWorldPosition(this.pos);
      play(p, 'idle', { fade: 0 });
      this.anim = 'idle';
      // (the skeleton posed now: drawn with the clip's turn and the object's both, the body faced back for a frame)
      tick(p, 0);
      const M = rig.object.matrixWorld;
      if (S.I.tall) {
        // down the aisle to the door, then the steps
        const inner = new THREE.Vector3(S.I.sx * (S.I.xs - 0.32), S.I.floor, S.I.stand.z);
        const from = this.pos.clone(), to = inner.clone().applyMatrix4(M);
        S.G = { p, from, to, y0: from.y, y1: to.y, face0: out, face1: Math.atan2(to.x - from.x, to.z - from.z), speed: 1.2, turnK: 3 };
        if (Math.hypot(to.x - from.x, to.z - from.z) < 0.15) S.G.face1 = out;
        this.segStart(S.G); S.phase = 'aisle'; S.t = 0;
        return;
      }
      this.beginStepBack(S);
      return;
    }
    if (S.phase === 'aisle') {
      if (!this.segStep(S.G, dt)) return;
      const M = rig.object.matrixWorld, from = this.pos.clone(), to = S.I.stand.clone().applyMatrix4(M);
      const g = this.drive.ground(to.x, to.z, to.y + 0.8);
      S.G = { p, from, to, y0: from.y, y1: g !== null && Number.isFinite(g) ? g : to.y, face0: this.face, face1: this.yawOf(rig, S.I.sx > 0 ? Math.PI / 2 : -Math.PI / 2), dur: 1.0, turnK: 3 };
      this.segStart(S.G); S.phase = 'steps'; S.t = 0;
      this.startCam(this.doorCamYaw(rig, S.I.sx));
      return;
    }
    if (S.phase === 'steps') {
      if (!this.segStep(S.G, dt)) return;
      this.beginStepBack(S);
      return;
    }
    if (S.phase === 'back') {
      // a step back behind the door's edge (the door swings through where the person stood)
      if (!this.segStep(S.G, dt)) return;
      // the player has the person back from here (the door shuts as they walk off)
      S.phase = 'shut'; S.t = 0; this.seqHoldsWalk = false;
      this.mode = 'foot';
      return;
    }
    if (S.phase === 'shut') {
      // pushed shut, the hand on the door's edge (the player may walk off at once: the hand lets go)
      const k = Math.min(1, S.t / 0.5);
      this.setDoor(rig, S.door, 1 - ease(k));
      const moving = Math.hypot(this.vel.x, this.vel.z) > 0.4;
      const hk = S.I.sx > 0 ? 'handL' : 'handR';
      this.reachTo(p, hk, this.onDoor(rig, S.I, S.I.grip, _b), moving || k > 0.8 ? 0 : 1, dt, moving ? 10 : 7);
      if (k >= 1) { this.setDoor(rig, S.door, 0); this.letGo(p, [hk], 0.15); this.seq = null; }
    }
  }

  // which door to get out of, and the path to it: the driver's, or across to the other front seat's when the
  // driver's side has no room (a wall, a car alongside); neither: stay in
  planExit(S) {
    const rig = S.rig, D = this.drive, p = this.person;
    const drv = this.doorOf(rig, 0);
    const other = this.otherSeat(rig);
    const cands = [{ I: drv, slide: false }];
    if (other !== null && !this.occ.occupied(rig, other)) cands.push({ I: this.doorOf(rig, other), slide: true });
    const pick = cands.find(c => c.I && this.doorRoom(rig, c.I));
    if (!pick) { D.hud.flash('No room to open the door here'); this.cancelExit(); return; }
    S.I = pick.I; S.door = pick.I.door;
    // the person out of the seat's keeping: where it is now (hips, lean) is where the climb starts
    const hb = p.bone && p.bone('hips');
    rig.object.updateWorldMatrix(true, false);
    S.P0 = hb ? rig.object.worldToLocal(hb.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(drv.seat.x, drv.seat.y, drv.seat.z);
    S.qRel = rig.object.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(p.object.getWorldQuaternion(new THREE.Quaternion()));
    S.recline = p._recline ?? RECLINE;
    // (the hands and feet stay where they are on the wheel and pedals, then let go as the person moves; the cabin's
    // shade eases off as the door opens)
    this.holdReaches(p);
    this.occ.unseatPlayer({ keep: true });
    this.scene.attach(p.object);
    S.shade0 = this.occ.shadeOf({ rig });
    S.hipL = null; S.hc = null;
    if (pick.slide) {
      S.phase = 'slide'; S.slideT = 0; const s = pick.I.seat; S.Pslide = new THREE.Vector3(s.x, s.y, s.z - 0.04);
      this.letGo(p, ['handL', 'handR', 'footL', 'footR'], 0.3);
      play(p, 'sit', { fade: 0.3 });
    } else S.phase = 'open';
    S.t = 0;
    this.hintNow('');
  }

  // seated, the hips on a point of the car's frame (the person no longer in the occupants' seat)
  seatedAt(S, hip, dt) {
    const p = this.person, rig = S.rig;
    rig.object.updateWorldMatrix(true, false);
    const H = S.hc || (S.hc = { p, dir: 'out', hipL: S.hipL || null });
    if (!H.hipL) this.hipsLocal(H);
    p.object.quaternion.copy(rig.object.getWorldQuaternion(_q2)).multiply(S.qRel || _q.setFromAxisAngle(X1, S.recline || 0));
    const hw = _a.copy(hip).applyMatrix4(rig.object.matrixWorld);
    p.object.position.copy(hw).sub(_b.copy(H.hipL).applyQuaternion(p.object.quaternion));
    tick(p, dt);
    this.hipsLocal(H);
  }

  beginStepBack(S) {
    const p = this.person, rig = S.rig, M = rig.object.matrixWorld;
    const from = this.pos.clone(), to = S.I.handle.clone().applyMatrix4(M);
    // a step back behind the door's edge, turning to face the open door (to push it shut)
    const grip = this.onDoor(rig, S.I, S.I.grip, new THREE.Vector3());
    S.G = { p, from, to, face0: this.face, face1: Math.atan2(grip.x - to.x, grip.z - to.z), speed: 1.2, turnK: 1.2, yh: from.y };
    this.segStart(S.G);
    S.phase = 'back'; S.t = 0;
    this.seqHoldsWalk = true;
  }

  // out of a car on its side or roof: through the window onto the ground on whichever side is free, crawling out
  // face down and getting up
  beginCrawl(S) {
    const D = this.drive, rig = S.rig, v = S.car.vehicle, p = this.person;
    this.occ.unseatPlayer();
    this.scene.attach(p.object);
    p.object.updateWorldMatrix(true, false);
    // the car's footprint on the ground: its middle, forward and right, flat
    const o = v.origin(new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(v.q); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    // the driver's side first (as the car lies: whichever of left and right the driver's seat is nearer now)
    const seatW = rig.object.localToWorld(new THREE.Vector3(seatsOf(rig)[0].x, seatsOf(rig)[0].y, seatsOf(rig)[0].z));
    const drvRight = (seatW.x - o.x) * r.x + (seatW.z - o.z) * r.z > 0;
    const hw = Math.max(rig.dims.width, rig.dims.height) / 2 + 0.55, hl = rig.dims.length / 2 + 0.55;
    const cands = [[drvRight ? 1 : -1, 0], [drvRight ? -1 : 1, 0], [0, 1], [0, -1]];
    let best = null;
    for (const [sr, sf] of cands) {
      for (const along of [0, 0.6, -0.6]) {
        const x = o.x + r.x * sr * hw + f.x * (sf * hl + (sf ? 0 : along)), z = o.z + r.z * sr * hw + f.z * (sf * hl + (sf ? 0 : along));
        if (this.clearAt(x, z, o.y, 0.3, rig)) { best = { x, z, dx: r.x * sr + f.x * sf, dz: r.z * sr + f.z * sf }; break; }
      }
      if (best) break;
    }
    if (!best) best = { x: o.x + r.x * hw, z: o.z + r.z * hw, dx: r.x, dz: r.z };
    const g = D.ground(best.x, best.z, o.y + 1);
    const gy = g !== null && Number.isFinite(g) ? g : o.y;
    // from just inside the car's edge, out along the ground
    const back = 0.75;
    this.hidePerson = true;
    this.seq = { kind: 'crawl', phase: 'crawl', t: 0, car: S.car, rig, from: new THREE.Vector3(best.x - best.dx * back, gy, best.z - best.dz * back), to: new THREE.Vector3(best.x, gy, best.z), face: Math.atan2(best.dx, best.dz) };
    this.mode = 'exit';
    if (p.capture) try { p.capture(0.35); } catch (e) {}
    // (the get-up clip held on its first pose, face down, while crawling: the same clip then gets up, so nothing jumps)
    const ga = play(p, 'getup_front', { fade: 0, once: true });
    if (ga) { ga.time = 0; ga.timeScale = 0; }
    this.seq.getup = ga;
    this.face = this.seq.face;
    p.object.quaternion.identity(); p.object.rotation.set(0, this.face + YAW0, 0);
    p.object.position.copy(this.seq.from);
    this.pos.copy(this.seq.from);
    this.startCam();
    this.hintNow('');
  }
  crawlStep(S, dt) {
    const p = this.person;
    if (S.phase === 'crawl') {
      // (out of sight inside the car for the moment the person turns over to crawl)
      this.hidePerson = S.t <= 0.3;
      const k = Math.min(1, Math.max(0, S.t - 0.3) / 1.1);
      p.object.position.lerpVectors(S.from, S.to, ease(k));
      // (a little rise and fall of the body as it pulls itself along)
      p.object.position.y += Math.abs(Math.sin(k * Math.PI * 3)) * 0.025;
      this.pos.copy(p.object.position);
      tick(p, dt);
      if (k >= 1) {
        S.phase = 'up'; S.t = 0;
        const a = S.getup && p.current === S.getup ? S.getup : play(p, 'getup_front', { fade: 0.15, once: true });
        if (a) a.timeScale = 1.45;
        S.upDur = a && a.getClip ? a.getClip().duration / 1.45 : 2.4;
      }
      return;
    }
    if (S.phase === 'up') {
      this.hidePerson = false;
      tick(p, dt);
      if (S.t >= S.upDur - 0.05) {
        this.placePerson(S.to.x, S.to.z, S.to.y + 0.6);
        this.face = S.face; p.object.rotation.set(0, this.face + YAW0, 0);
        this.toFoot();
      }
    }
  }

  toFoot() {
    this.mode = 'foot'; this.seq = null; this.seqHoldsWalk = false;
    play(this.person, 'idle', { fade: 0.3 });
    this.anim = 'idle';
    this.startCam();
  }

  // ----------------------------------------------------------------------------------------------------------
  // getting in

  // the nearest car the player can get into from here: { kind, rig (null for a parked one not yet loaded), ref, d,
  // speed, seat (0, or the other front seat when only its side has room) }
  target() {
    const D = this.drive, P = this.pos, list = [];
    const consider = (kind, rig, ref, speed = 0, upY = 1) => {
      if (!rig || !rig.object || !rig.dims) return;
      if (speed > 15) return;
      rig.object.updateWorldMatrix(true, false);
      const I = this.doorOf(rig, 0); if (!I) return;
      const hp = _b.copy(I.handle).applyMatrix4(rig.object.matrixWorld);
      const d = Math.hypot(hp.x - P.x, hp.z - P.z);
      _a.setFromMatrixPosition(rig.object.matrixWorld);
      const dm = Math.hypot(_a.x - P.x, _a.z - P.z);
      // a moving car only from right beside its door; a still one from a few metres, or from anywhere round it
      if (speed > 2.5 ? d < 2.6 : (d < 6 || dm < rig.dims.length / 2 + 2.5)) list.push({ kind, rig, ref, d: Math.min(d, dm), speed, upY });
    };
    const up = v => _a.set(0, 1, 0).applyQuaternion(v.q).y;
    if (D.car) consider('mine', D.car.rig, D.car, D.car.vehicle.speed, up(D.car.vehicle));
    for (const e of this.parked) consider('left', e.rig, e, e.vehicle.speed, up(e.vehicle));
    if (D.traffic) for (const c of D.traffic.list) if (Math.abs(c.x - P.x) < 14 && Math.abs(c.z - P.z) < 14) consider('traffic', c.rig, c, c.v);
    // parked (instanced) cars
    if (D.parked && D.parked.list) for (const o of D.parked.list) {
      if (!o.K || o.skip || o.taken) continue;
      const dd = Math.hypot(o.x - P.x, o.z - P.z);
      if (dd > o.K.dims.length / 2 + 2.5) continue;
      list.push({ kind: 'parked', rig: null, ref: o, d: dd, speed: 0, upY: 1 });
    }
    list.sort((a, b) => a.d - b.d);
    return list[0] || null;
  }

  // a parked (instanced) car as a stand-in rig: its place and size, for the walk to its door while its model loads
  parkedRig(o) {
    if (o.rigLike2) return o.rigLike2;
    const C = this.drive.mods.cars;
    const obj = new THREE.Object3D(); obj.matrixAutoUpdate = false; obj.matrix.copy(o.m); obj.updateMatrixWorld(true);
    const spec = (C && C.carInfo ? C.carInfo(o.model) : null) || { kind: 'sedan' };
    return (o.rigLike2 = { object: obj, dims: o.K.dims, spec, id: o.model, fake: true, userData: {} });
  }

  startEnter(t) {
    const D = this.drive;
    // a car on its side or roof (the player's, or one left about): pushed back onto its wheels first
    if (t.upY !== undefined && t.upY < 0.5) {
      const v = t.kind === 'mine' ? D.car.vehicle : t.ref && t.ref.vehicle;
      if (!v || (t.kind !== 'mine' && t.kind !== 'left')) { D.hud.flash('That car is on its roof'); return; }
      this.seq = { kind: 'enter', phase: 'righting', t: 0, target: t, v };
      this.mode = 'enter';
      return;
    }
    const rig = t.rig || this.parkedRig(t.ref);
    // the driver's door, or the other front door when only that side has room (and nobody to pull out)
    const drv = this.doorOf(rig, 0), other = this.otherSeat(rig);
    let seat = 0;
    const occupied = t.kind === 'traffic' || (t.kind === 'parked' ? this.occ.occupied(t.ref, 0) : this.occ.occupied(rig, 0));
    if (t.speed < 2.5 && !this.doorRoom(rig, drv)) {
      if (!occupied && other !== null && !this.occ.occupied(t.kind === 'parked' ? t.ref : rig, other) && this.doorRoom(rig, this.doorOf(rig, other))) seat = other;
      else { D.hud.flash(occupied ? 'No room at the driver\'s door' : 'No room to open the doors'); return; }
    }
    this.seq = { kind: 'enter', phase: 'approach', t: 0, target: { ...t, rig }, seat, I: this.doorOf(rig, seat) };
    this.mode = 'enter';
    this.stats.entries++;
    // the door cut ahead (in the background) while the person walks to it
    if (t.rig) this.prepDoor(t.rig, this.seq.I.door);
    if (t.kind === 'traffic') {
      t.ref.held = true; // the driver stops (someone is at the door)
      // right beside a moving car's door: grab it at once
      if (t.speed > 2.5) this.grabTraffic(this.seq);
    }
    if (t.kind === 'parked') this.prepParked(this.seq);
  }

  cancelEnter(msg) {
    const S = this.seq;
    if (S && S.target && S.target.kind === 'traffic' && S.target.ref) S.target.ref.held = false;
    if (S && S.target && S.target.kind === 'parked' && S.target.ref && !S.parkedDone) { S.target.ref.taken = false; if (S.parkedRig && S.parkedRig.dispose) S.parkedRig.dispose(); }
    if (S && S.victim && S.victim.state === 'pulled' && !S.pull) S.victim.state = 'seated';
    if (S && S.target && S.target.rig && !S.target.rig.fake && S.I && S.I.door >= 0 && this.doorOpen(S.target.rig, S.I.door) > 0.01) S.shutLater = { rig: S.target.rig, door: S.I.door, t: 0, from: this.doorOpen(S.target.rig, S.I.door) };
    if (S && S.shutLater) this.shutting = S.shutLater;
    if (this.person) this.letGo(this.person, ['handL', 'handR'], 0.25);
    this.seq = null; this.mode = 'foot'; this.seqHoldsWalk = false;
    if (msg) this.drive.hud.flash(msg);
    play(this.person, 'idle', { fade: 0.25 });
    this.anim = 'idle';
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
    S.target = { kind: 'left', rig: e.rig, ref: e, d: 0, from: 'traffic' };
    S.grabbed = true;
  }

  // a parked (instanced) car as a car of its own: its model loaded (the person walks to it meanwhile), the instance
  // and its collision taken away when the person reaches it
  async prepParked(S) {
    const D = this.drive, C = D.mods.cars, o = S.target.ref;
    try {
      o.taken = true;
      const rig = await C.loadCar(o.model, { npc: true, color: o.paint });
      if (D.carEnv && rig.setEnvMap) rig.setEnvMap(D.carEnv);
      if (this.seq !== S) { rig.dispose(); o.taken = false; return; }
      S.parkedRig = rig;
      this.prepDoor(rig, S.I.door);
    } catch (er) { console.warn('parked car', er); o.taken = false; if (this.seq === S) this.cancelEnter('Could not open that car'); }
  }
  // the parked car's own model in place of the instance (at the door, once it has loaded)
  swapParked(S) {
    const D = this.drive, o = S.target.ref, rig = S.parkedRig;
    const veh = new Vehicle(rig, this.physOf(o.model));
    veh.place(o.x, o.y, o.z, o.heading);
    // the model where the instance was, before the instance goes (no frame without either)
    rig.object.position.copy(veh.com).applyQuaternion(veh.q).negate().add(veh.pos); rig.object.quaternion.copy(veh.q);
    this.scene.add(rig.object);
    const P = D.parked, k = P.list.indexOf(o);
    if (k >= 0) { P.list.splice(k, 1); P.frame = 0; P.update(this.camera); }
    for (const s of D.collide.shapes) if (s.tag === 'parked' && !s.dead && s.k === 0) {
      let x = 0, z = 0; for (const p of s.p) { x += p[0]; z += p[1]; }
      x /= s.p.length; z /= s.p.length;
      if (Math.hypot(x - o.x, z - o.z) < 0.6) { D.collide.remove(s); break; }
    }
    const e = this.addLeft({ rig, vehicle: veh, id: o.model, npc: true, kind: 'parked' });
    // its people (if any were shown) move into it
    this.occ.transfer(o, rig, rig);
    S.target = { kind: 'left', rig, ref: e, d: 0, from: 'parked' };
    S.parkedDone = true;
    S.I = this.doorOf(rig, S.seat);
  }

  physOf(id) {
    const C = this.drive.mods.cars, spec = C ? C.CARS.find(c => c.id === id) : null;
    const p = { ...((spec && spec.physics) || {}) };
    if (spec && spec.mass) p.mass = spec.mass;
    return p;
  }

  enterStep(S, dt) {
    const D = this.drive, p = this.person;
    if (S.phase === 'righting') { this.rightStep(S, dt); return; }
    const t = S.target, rig = t.rig;
    if (!rig || (!rig.fake && !rig.object.parent)) { this.cancelEnter(); return; }
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld, I = S.I;
    if (S.phase === 'approach') {
      // walk (jog when far, run to keep up with a car still rolling) to behind the door, round the car if need be
      const hp = _c.copy(I.handle).applyMatrix4(M);
      const dx = hp.x - this.pos.x, dz = hp.z - this.pos.z, d = Math.hypot(dx, dz);
      // a traffic car reached: out of the traffic now
      if (t.kind === 'traffic' && d < 1.6) { this.grabTraffic(S); return; }
      // a parked car reached: its own model in now (or wait a moment for it)
      if (t.kind === 'parked' && d < 1.2) {
        if (!S.parkedRig) { if (S.t > 8) this.cancelEnter('Could not open that car'); else { this.walk(dt, { x: 0, z: 0, speed: 0 }); } return; }
        this.swapParked(S); return;
      }
      const carSp = t.kind === 'left' || t.kind === 'mine' ? t.ref.vehicle.speed : 0;
      if (d < 0.1 && carSp < 0.5 || (d < 0.3 && Math.hypot(this.vel.x, this.vel.z) < 0.5 && carSp < 0.5)) {
        S.phase = 'face'; S.t = 0;
        S.victim = t.kind !== 'mine' || this.occ.driverOf(rig) ? this.occ.driverOf(rig) : null;
        if (S.seat !== 0) S.victim = null;
        if (S.victim) S.victim.state = 'pulled'; // (the occupants leave the driver to this module now)
        return;
      }
      if (S.t > 14) { this.cancelEnter('Could not reach that car'); return; }
      // aim behind the door, but round the car's body (to a point off its end) when on the wrong side
      const lp = _a.set(this.pos.x, this.pos.y, this.pos.z); rig.object.worldToLocal(lp);
      let goal = hp;
      const hl = rig.dims.length / 2 + 0.7, hw = rig.dims.width / 2 + 0.55;
      const wrong = lp.x * I.sx < 0.05, inLen = Math.abs(lp.z) < hl;
      if (wrong && inLen) {
        // on the other side: along it to the nearer end (the one nearer the door when it is about even), a little past it
        if (S.zEnd === undefined) S.zEnd = Math.abs(lp.z - hl) + Math.abs(hl - I.handle.z) <= Math.abs(lp.z + hl) + Math.abs(-hl - I.handle.z) ? 1 : -1;
        goal = _b.set((Math.sign(lp.x) || -I.sx) * Math.max(Math.abs(lp.x), hw), 0, S.zEnd * (hl + 0.15)).applyMatrix4(M);
      } else if (wrong) {
        // past the end: across it to the door's side
        goal = _b.set(I.sx * hw, 0, (Math.sign(lp.z) || 1) * (hl + 0.15)).applyMatrix4(M);
      } else if (Math.abs(lp.x) < hw && inLen) {
        // (somehow beside the body but inside its box: straight out to the door's side first)
        goal = _b.set(I.sx * hw, 0, lp.z).applyMatrix4(M);
      }
      const gd = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
      // the pace: a jog when far, a walk the last few metres, slowing to stop on the spot; with a rolling car, its speed
      let speed = d > 6 ? JOG : WALK;
      if (goal === hp) speed = Math.min(speed, 0.35 + d * 1.6);
      if (carSp > 0.5) speed = Math.max(speed, Math.min(RUN, carSp + d * 2));
      this.walk(dt, { x: goal.x - this.pos.x, z: goal.z - this.pos.z, speed, ignore: rig, exact: goal === hp ? gd : null });
      return;
    }
    if (S.phase === 'face') {
      // turned to the door (a moment), then it is opened
      this.stickTo(_c.copy(I.handle).applyMatrix4(M), dt);
      const want = Math.atan2(_b.copy(I.grip).applyMatrix4(M).x - this.pos.x, _b.z - this.pos.z);
      const dw = ((want - this.face) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      this.face += THREE.MathUtils.clamp(dw * Math.min(1, dt * 12), -7.5 * dt, 7.5 * dt);
      this.standStill(p, dt);
      const dd = Math.abs(((want - this.face) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (dd < 0.15 || S.t > 0.7) { S.phase = 'open'; S.t = 0; if (S.victim) play(p, 'pull_out', { fade: 0.25 }); }
      return;
    }
    if (S.phase === 'open') {
      this.stickTo(_c.copy(I.handle).applyMatrix4(M), dt);
      if (!this.pumpDoor(rig, I.door, (S.wait || 0) > 0.5 ? 25 : 10) && this.waitDoor(S, rig, I.door, dt)) { S.t = 0; this.standStill(p, dt); return; }
      const already = this.doorOpen(rig, I.door);
      if (S.t === dt && already > 0.5) S.t = 0.6; // (a door sprung open in a crash is open already)
      const k = Math.min(1, S.t / 0.65);
      this.setDoor(rig, I.door, Math.max(already, ease(k)));
      const hk = I.sx > 0 ? 'handL' : 'handR';
      this.reachTo(p, hk, this.onDoor(rig, I, I.grip, _b), k < 0.42 ? 1 : 0, dt, 6);
      this.standStill(p, dt);
      if (k >= 1) {
        S.t = 0;
        if (S.victim) { S.phase = 'pull'; this.beginPull(S); }
        else this.beginStepIn(S);
      }
      return;
    }
    if (S.phase === 'pull') {
      this.stickTo(_c.copy(I.handle).applyMatrix4(M), dt);
      this.standStill(p, dt);
      this.pullStep(S, dt);
      if (S.t >= 1.1) this.beginStepIn(S);
      return;
    }
    if (S.phase === 'stepin' || S.phase === 'steps' || S.phase === 'aisle' || S.phase === 'turn') {
      if (!this.segStep(S.G, dt)) return;
      if (S.phase === 'stepin' && I.tall) {
        // up the steps to the doorway, then along inside to beside the seat
        const inner = new THREE.Vector3(I.sx * (I.xs - 0.32), I.floor, I.stand.z).applyMatrix4(M);
        S.G = { p, from: this.pos.clone(), to: inner, y0: this.pos.y, y1: inner.y, face0: this.face, face1: Math.atan2(inner.x - this.pos.x, inner.z - this.pos.z), dur: 1.0, turnK: 3 };
        this.segStart(S.G); S.phase = 'steps'; S.t = 0;
        // (the camera back to the car's own as the person goes up into it)
        this.camBack(this.carOf(S), 3.6);
        return;
      }
      if (S.phase === 'steps') {
        const s = I.seat, side = new THREE.Vector3(s.x + I.sx * 0.46, I.floor, s.z + 0.08).applyMatrix4(M);
        S.G = { p, from: this.pos.clone(), to: side, y0: this.pos.y, y1: side.y, face0: this.face, face1: Math.atan2(side.x - this.pos.x, side.z - this.pos.z), speed: 1.2, turnK: 3 };
        if (Math.hypot(side.x - this.pos.x, side.z - this.pos.z) < 0.15) S.G.face1 = this.face;
        this.segStart(S.G); S.phase = 'aisle'; S.t = 0; return;
      }
      if (S.phase === 'aisle') {
        // turned to have the back to the seat
        const out = this.yawOf(rig, I.sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        S.G = { p, from: this.pos.clone(), to: this.pos.clone(), y0: this.pos.y, y1: this.pos.y, face0: this.face, face1: out, dur: 0.35, turnK: 1 };
        this.segStart(S.G); S.phase = 'turn'; S.t = 0; return;
      }
      // in: the climb
      S.phase = 'climb'; S.t = 0;
      const s = I.seat, sx = I.sx, h = p.height || 1.75, tall = I.tall;
      const hipNow = new THREE.Vector3(); if (p.bone && p.bone('hips')) { p.object.updateMatrixWorld(true); p.bone('hips').getWorldPosition(hipNow); rig.object.worldToLocal(hipNow); } else hipNow.copy(I.stand).setY(0.53 * h);
      S.C = { p, rig, I, dir: 'in', dur: tall ? 1.7 : 1.6, recline: isBusRig(rig) || p.kid ? 0.12 : RECLINE,
        P0: new THREE.Vector3(s.x, s.y, s.z - 0.04),
        P1: tall ? new THREE.Vector3(s.x + sx * 0.14, s.y + 0.02, s.z) : new THREE.Vector3(sx * (I.xs - 0.24), s.y + 0.03, (s.z + I.stand.z) / 2),
        P2: hipNow, floor: tall ? I.floor : null };
      this.climbStart(S.C);
      if (!tall) this.camBack(this.carOf(S), S.C.dur + 0.3);
      return;
    }
    if (S.phase === 'climb') {
      // (into the cabin's shade as the person sits down)
      if (S.shadeIn === undefined) S.shadeIn = this.occ.shadeOf({ rig });
      const done = this.climbStep(S.C, dt);
      this.occ.shadeTo(p, 1 + (S.shadeIn - 1) * smooth(S.C.t / S.C.dur, 0.25, 0.85));
      if (!done) return;
      if (S.seat !== 0) {
        // in the other seat: across to the driver's
        S.phase = 'slide'; S.t = 0; S.slideFrom = S.C.P0.clone();
        const s0 = seatsOf(rig)[0]; S.slideTo = new THREE.Vector3(s0.x, s0.y, s0.z - 0.04);
        S.recline = S.C.recline; S.hipL = S.C.hipL;
        play(p, 'drive', { fade: 0.4 });
        return;
      }
      this.beginShutIn(S);
      return;
    }
    if (S.phase === 'slide') {
      const k = Math.min(1, S.t / 0.9);
      S.rig = rig;
      this.seatedAt(S, _a.copy(S.slideFrom).lerp(S.slideTo, ease(k)), dt);
      if (k >= 1) this.beginShutIn(S);
      return;
    }
    if (S.phase === 'shut') {
      // the door pulled shut from inside, the near hand on its inside handle, then both hands to the wheel
      const k = Math.min(1, S.t / 0.5);
      this.setDoor(rig, I.door, 1 - ease(k));
      const hk = I.sx > 0 ? 'handR' : 'handL';
      if (k < 0.75) this.reachTo(p, hk, this.onDoor(rig, I, I.gripIn, _b), 1, dt, 7);
      else if (!S.handsBack) { S.handsBack = true; p.handsBusy = false; this.fadeIn(p, ['handL', 'handR'], 0.35); }
      if (k >= 1) { this.setDoor(rig, I.door, 0); p.handsBusy = false; this.seq = null; }
    }
  }

  // the car being got into as the car camera wants it ({ rig, vehicle })
  carOf(S) {
    const t = S.target;
    if (t.kind === 'mine') return this.drive.car;
    if (t.ref && t.ref.vehicle) return { rig: t.rig, vehicle: t.ref.vehicle };
    return null;
  }

  // a car on its side or roof pushed back onto its wheels: the person walks to beside its middle, faces it and
  // pushes, the car turns over onto its wheels in a second (held by this module meanwhile), then the person gets in
  // as usual
  rightStep(S, dt) {
    const D = this.drive, p = this.person, v = S.v, rig = S.target.rig;
    if (!rig || !rig.object.parent) { this.cancelEnter(); return; }
    const o = v.origin(_v9);
    if (!S.spot) {
      // the side of the car nearer the person, a little out from it, on the ground
      const f = _a.set(0, 0, -1).applyQuaternion(v.q); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      const r = _b.set(-f.z, 0, f.x), side = (this.pos.x - o.x) * r.x + (this.pos.z - o.z) * r.z >= 0 ? 1 : -1;
      const reach = Math.max(rig.dims.width, rig.dims.height) / 2 + 0.55;
      S.spot = new THREE.Vector3(o.x + r.x * side * reach, o.y, o.z + r.z * side * reach);
      S.faceCar = Math.atan2(-r.x * side, -r.z * side);
      S.heading = v.heading; S.q0 = v.q.clone(); S.o0 = o.clone();
      const g = D.ground(o.x, o.z, o.y + 2); S.gy = g !== null && Number.isFinite(g) ? g : o.y;
    }
    if (!S.pushing) {
      const dx = S.spot.x - this.pos.x, dz = S.spot.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.25 && S.t < 10) { this.walk(dt, { x: dx, z: dz, speed: Math.min(d > 6 ? JOG : WALK, 0.35 + d * 1.6), ignore: rig }); return; }
      S.pushing = true; S.pt = 0;
      play(p, 'pull_out', { fade: 0.25 });
      this.hintNow('Pushing the car back onto its wheels', 1500);
    }
    // turned over about its long side, its middle rising to sit on its wheels
    S.pt += dt;
    this.face = angLerp(this.face, S.faceCar, Math.min(1, dt * 10));
    this.stickTo(S.spot, dt);
    this.standStill(p, dt);
    const k = ease(Math.min(1, S.pt / 1.2));
    const up = _q.setFromAxisAngle(UP, -S.heading * Math.PI / 180);
    v.q.copy(S.q0).slerp(up, k);
    const lift = Math.sin(k * Math.PI) * rig.dims.width * 0.35;
    v.pos.copy(v.com).applyQuaternion(v.q).add(_a.set(S.o0.x, S.o0.y + (S.gy - S.o0.y) * k + lift, S.o0.z));
    v.v.set(0, 0, 0); v.w.set(0, 0, 0);
    // (what draws the car between physics steps starts from here too)
    if (D.car && D.car.vehicle === v) { D.prevPos.copy(v.pos); D.prevQ.copy(v.q); }
    const e = this.parked.find(q => q.vehicle === v); if (e) { e.prevPos.copy(v.pos); e.prevQ.copy(v.q); e.asleep = false; }
    if (S.pt >= 1.2) {
      v.place(S.o0.x, S.gy, S.o0.z, S.heading);
      if (D.car && D.car.vehicle === v) { D.prevPos.copy(v.pos); D.prevQ.copy(v.q); }
      if (e) { e.prevPos.copy(v.pos); e.prevQ.copy(v.q); }
      // now in as usual
      const t = { ...S.target, upY: 1, speed: 0 };
      this.seq = null; this.mode = 'foot';
      this.startEnter(t);
    }
  }

  // stood still on a spot (a door being opened), the person's place eased onto it
  stickTo(w, dt) {
    const k = Math.min(1, dt * 10);
    this.pos.x += (w.x - this.pos.x) * k; this.pos.z += (w.z - this.pos.z) * k;
    const g = this.drive.ground(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (g !== null && Number.isFinite(g)) this.pos.y += (g - this.pos.y) * Math.min(1, dt * 14);
    this.vel.set(0, 0, 0);
    this.person.object.position.copy(this.pos);
  }
  standStill(p, dt) {
    if (p.object.parent !== this.scene) this.scene.attach(p.object);
    p.object.position.copy(this.pos);
    p.object.rotation.set(0, this.face + YAW0, 0);
    if (this.anim !== 'idle' && p.currentName !== 'open_door' && !/pull/.test(p.currentName || '')) { play(p, 'idle', { fade: 0.25 }); this.anim = 'idle'; }
    tick(p, dt);
  }

  // from behind the door into the gap beside the seat, turning the back to the seat (or towards the steps)
  beginStepIn(S) {
    const p = this.person, rig = S.target.rig, I = S.I, M = rig.object.matrixWorld;
    const to = I.stand.clone().applyMatrix4(M);
    const out = this.yawOf(rig, I.sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    const face1 = I.tall ? this.yawOf(rig, I.sx > 0 ? -Math.PI / 2 : Math.PI / 2) : out;
    S.G = { p, from: this.pos.clone(), to, face0: this.face, face1, speed: 1.1, turnK: 1.2, yh: this.pos.y };
    this.segStart(S.G);
    S.phase = 'stepin'; S.t = 0;
    this.letGo(p, ['handL', 'handR'], 0.2);
  }

  // seated: this car is the player's now (the one before stays where it is), the door shut from inside
  beginShutIn(S) {
    const p = this.person;
    S.phase = 'shut'; S.t = 0;
    // the occupants keep the hands off the wheel until the door is shut (this module reaches the handle), and the
    // feet ease onto the pedals (set before the seat takes the person: it poses them at once)
    p.handsBusy = true;
    this.fadeIn(p, ['footL', 'footR'], 0.4);
    // where the climb left the person, to ease from onto the seat's own place (a tall person slouches)
    const rig = S.target.rig;
    rig.object.updateWorldMatrix(true, false);
    const rq = rig.object.getWorldQuaternion(new THREE.Quaternion()).invert();
    const lastPos = rig.object.worldToLocal(p.object.getWorldPosition(new THREE.Vector3()));
    const lastQ = rq.clone().multiply(p.object.getWorldQuaternion(new THREE.Quaternion()));
    this.takeWheel(S);
    // (the seat's own place: a tall person slouches, a low roof leans them back further)
    const off = lastPos.sub(p.object.position);
    const dq = lastQ.multiply(p.object.quaternion.clone().invert());
    if (off.length() < 1.2) this.seatBlend = { p, rig, off, dq, t: 0, q0: p.object.quaternion.clone() };
  }

  // after the occupants have placed the seated player: the little difference from where the climb left them eased
  // away (in the car's frame) over a moment
  seatBlendStep(dt) {
    const B = this.seatBlend;
    if (!B) return;
    B.t += dt;
    const k = 1 - ease(Math.min(1, B.t / 0.4));
    if (k <= 0 || this.mode !== 'car' || B.p.object.parent !== B.rig.object) { this.seatBlend = null; return; }
    // (in the car's frame: the person is the car's child while seated)
    B.q0.copy(B.p.object.quaternion);
    B.p.object.quaternion.premultiply(_q.identity().slerp(B.dq, k));
    B.p.object.position.addScaledVector(B.off, k);
    B.applied = k;
  }

  // the driver dragged out over a second and thrown on the road
  beginPull(S) {
    const rig = S.target.rig;
    const o = S.victim;
    if (o.person.object.parent !== rig.object) rig.object.attach(o.person.object);
    S.pull = { o, start: o.person.object.position.clone(), q0: o.person.object.quaternion.clone() };
    if (o.person.ik) { o.person.ik.handL = o.person.ik.handR = o.person.ik.footL = o.person.ik.footR = null; }
    play(o.person, 'pulled_out', { fade: 0.15, side: S.I.sx > 0 ? 'R' : 'L' });
    this.stats.jacks++;
  }
  pullStep(S, dt) {
    const P = S.pull, rig = S.target.rig, o = P.o, obj = o.person.object;
    const k = Math.min(1, S.t / 0.65);
    const seat = seatsOf(rig)[0], sx = S.I.sx;
    // out past the player and down
    const end = _a.set(sx * (S.I.xs + 0.7), 0.2, seat.z + 0.55);
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
        const outD = _b.set(sx, 0, 0).transformDirection(rig.object.matrixWorld);
        const back = _c.set(0, 0, 1).transformDirection(rig.object.matrixWorld);
        const e = this.parked.find(q => q.rig === rig);
        const v = new THREE.Vector3().addScaledVector(outD, 2.8).addScaledVector(back, 0.9);
        if (e) v.add(e.vehicle.v);
        v.y = 2.0;
        this.occ.throwPerson(taken.person, v, { angry: true, look: taken.look });
      }
      // the passengers get out and run
      if (R) S.fleeAt = S.t + 0.45;
    }
    if (S.fleeAt !== undefined && S.t >= S.fleeAt) { S.fleeAt = undefined; this.passengersFlee(rig); }
  }

  // the passengers of a car being taken climb out of their own doors (or the nearest one) and run off
  passengersFlee(rig) {
    const R = this.occ.rec(rig);
    if (!R) return;
    rig.object.updateWorldMatrix(true, false);
    for (const o of [...R.people]) {
      if (o.player || o.seat === 0 || o.state !== 'seated') continue;
      const I = this.doorOf(rig, o.seat);
      const taken = this.occ.take(R, o.seat);
      if (!taken) continue;
      const p = taken.person;
      if (p.setCabin) try { p.setCabin(0); } catch (e) {}
      this.occ.shade(p, 1);
      if (p.setSeated) try { p.setSeated(false); } catch (e) {}
      if (p.ik) p.ik.handL = p.ik.handR = p.ik.footL = p.ik.footR = null;
      const out = { p, rig, I, phase: I && I.door >= 0 ? 'door' : 'climb', t: 0, wait: 0 };
      if (I && I.door >= 0) this.prepDoor(rig, I.door);
      (this.outs || (this.outs = [])).push(out);
    }
  }
  // the passengers getting out: the door (cut first if need be, they wait for it), the climb, then off running
  outsStep(dt) {
    if (!this.outs || !this.outs.length) return;
    for (let i = this.outs.length - 1; i >= 0; i--) {
      const O = this.outs[i], p = O.p, rig = O.rig;
      O.t += dt;
      try {
        if (!rig.object.parent && !rig.fake) { this.outs.splice(i, 1); this.occ.flee(p, p.object.getWorldPosition(new THREE.Vector3())); continue; }
        if (O.phase === 'door') {
          if (!this.pumpDoor(rig, O.I.door, 3) && O.t < 2.5) continue;
          this.setDoor(rig, O.I.door, Math.max(this.doorOpen(rig, O.I.door), ease(Math.min(1, (O.dt = (O.dt || 0) + dt) / 0.45))));
          if (O.dt < 0.45) { tick(p, dt); continue; }
          O.phase = 'climb';
        }
        if (O.phase === 'climb') {
          if (!O.C) {
            const s = O.I ? O.I.seat : seatsOf(rig)[O.seat || 1], sx = O.I ? O.I.sx : 1, h = p.height || 1.75;
            const I = O.I || { sx, xs: rig.dims.width / 2 - 0.06, stand: new THREE.Vector3(sx * (rig.dims.width / 2 + 0.3), 0, s.z), seat: s, floor: 0.2, tall: false };
            const hb = p.bone && p.bone('hips');
            const P0 = hb ? rig.object.worldToLocal(hb.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(s.x, s.y, s.z);
            const qRel = rig.object.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(p.object.getWorldQuaternion(new THREE.Quaternion()));
            O.C = { p, rig, I, dir: 'out', dur: 1.3, qRel, P0, P1: new THREE.Vector3(sx * (I.xs - 0.24), s.y + 0.03, (P0.z + I.stand.z) / 2), P2: new THREE.Vector3(I.stand.x, 0.53 * h, I.stand.z), floor: I.tall ? I.floor : null };
            this.climbStart(O.C);
          }
          if (!this.climbStep(O.C, dt)) continue;
          // standing outside: turned away, running
          const out = this.yawOf(rig, O.I && O.I.sx > 0 ? Math.PI / 2 : -Math.PI / 2);
          if (p.capture) try { p.capture(0.25, { noRoot: true }); } catch (e) {}
          p.object.rotation.set(0, out + YAW0, 0);
          play(p, 'run', { fade: 0 }); tick(p, 0);
          this.outs.splice(i, 1);
          this.occ.flee(p, rig.object.getWorldPosition(new THREE.Vector3()));
        }
      } catch (e) { console.warn('passenger out', e); this.outs.splice(i, 1); try { this.occ.flee(p, rig.object.getWorldPosition(new THREE.Vector3())); } catch (e2) {} }
    }
  }

  // in the seat: this car is the player's now (the one before stays where it is)
  takeWheel(S) {
    const D = this.drive, t = S.target, rig = t.rig, p = this.person;
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
    this.mode = 'car'; this.seqHoldsWalk = false;
    this.occ.unseatPlayer();
    this.occ.seatPlayer(rig, rig, p);
    if (p.capture) try { p.capture(0.25); } catch (e) {}
    if (!this.camBlend) this.camBack();
    this.setHud();
    // the other front door cut in the background, for getting out on that side
    const other = this.otherSeat(rig);
    if (other !== null) { const I = this.doorOf(rig, other); if (I) this.laterDoor = { rig, door: I.door, t: 2 }; }
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

  // something went wrong mid-way (or the car went): wherever is safest, in the seat if the person has not left it
  // yet, else on foot where they are, upright on the ground
  abortSeq() {
    const S = this.seq, D = this.drive, p = this.person;
    this.seq = null; this.hidePerson = false;
    if (p) { p.handsBusy = false; this.letGo(p, ['handL', 'handR', 'footL', 'footR'], 0.2); }
    try {
      if (S && S.rig && S.door >= 0 && S.rig.object && S.rig.object.parent) this.setDoor(S.rig, S.door, 0);
      if (S && S.I && S.target && S.target.rig && !S.target.rig.fake && S.target.rig.object.parent) this.setDoor(S.target.rig, S.I.door, 0);
    } catch (e) {}
    if (S && S.victim && S.victim.state === 'pulled' && !(S.pull && S.pull.thrown)) S.victim.state = 'seated';
    const inSeat = S && ((S.kind === 'exit' && (S.phase === 'stop' || S.phase === 'slide' || S.phase === 'open')) || (S.kind === 'enter' && (S.phase === 'slide' || S.phase === 'shut')));
    if (inSeat && D.car && this.person) {
      this.mode = 'car'; this.camOwned = false; this.camBlend = null; D.cam.ready = false;
      this.occ.unseatPlayer();
      this.occ.seatPlayer(D.car.rig, D.car.rig, this.person);
    } else if (p && this.mode !== 'car') {
      if (p.object.parent !== this.scene) this.scene.attach(p.object);
      p.object.getWorldPosition(_a);
      this.placePerson(_a.x, _a.z, _a.y + 0.8);
      this.toFoot();
    }
    this.setHud();
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
    let mx = 0, mz = 0, run = false, jump = false, want = 0;
    if (auto) {
      const l = Math.hypot(auto.x, auto.z);
      if (l > 1e-3) { mx = auto.x / l; mz = auto.z / l; }
      run = auto.run;
      want = auto.speed ?? (auto.run ? JOG : WALK);
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
    // the gait: a brisk walk, breaking into a jog after a second and a half of walking, a run with Shift
    if (!auto) {
      this.goT = moving && !run ? (this.goT || 0) + dt : run ? JOG_AFTER : 0;
      want = !moving ? 0 : run ? RUN : this.goT > JOG_AFTER ? JOG : WALK;
    } else if (!moving) want = 0;
    // speeding up and slowing down at a person's rates (to a run in about a second, a stop in about half that),
    // much less in the air
    const tx = mx * want, tz = mz * want;
    let dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz), cur = Math.hypot(this.vel.x, this.vel.z);
    const amax = (this.onGround ? (want > cur + 0.05 ? 6.5 : 10) : 2) * dt;
    if (dl > amax) { dvx *= amax / dl; dvz *= amax / dl; }
    this.vel.x += dvx; this.vel.z += dvz;
    // turning: quick at a walk, a little wider at a run, but never faster than a person turns (about a half turn in
    // half a second: at a low frame rate the eased turn did most of a half turn in one frame)
    if (moving) {
      const want = Math.atan2(mx, mz), d = ((want - this.face) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      const maxRate = cur > 4 ? 5 : 7.5;
      this.face += THREE.MathUtils.clamp(d * Math.min(1, dt * (cur > 4 ? 8 : 12)), -maxRate * dt, maxRate * dt);
    }
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
    // the pose: the clip for the speed, played at the speed that keeps the planted foot still on the ground
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.gait(p, sp, dt);
    p.object.position.copy(this.pos);
    p.object.rotation.set(0, this.face + YAW0, 0);
    tick(p, dt);
    if (!auto) this.hitByTraffic();
  }

  // the walking clip for a speed (m/s), at the rate that matches the stride, changed in step with the feet
  gait(p, sp, dt) {
    // (what is playing now: other code plays clips too, idle after getting out, a get-up after a fall)
    if (p.currentName !== undefined && p.currentName !== this.anim) this.anim = p.currentName;
    const anim = !this.onGround ? 'jump' : gaitOf(sp, this.anim || 'idle');
    const G0 = GAIT[(p.look && p.look.sex) === 'f' ? 'f' : 'm'];
    // (the clips' speeds are for the models' own height: a shorter person takes shorter steps)
    const size = (p.height || 1.75) / ((p.look && p.look.sex) === 'f' ? 1.75 : 1.82);
    const nat = G0[anim] ? G0[anim][0] * size : 0;
    const spd = nat ? THREE.MathUtils.clamp(sp / nat, 0.45, 1.7) : 1;
    if (anim !== this.anim) {
      // the new clip starts at the same point of the stride as the old one was
      const prev = p.current, was = this.anim;
      const a = play(p, anim, { fade: anim === 'jump' ? 0.1 : was === 'jump' ? 0.15 : 0.22, speed: spd, startAt: 0 });
      if (a && prev && G0[was] && G0[anim] && prev.getClip) {
        const ph = prev.time / prev.getClip().duration;
        a.time = ((ph - G0[was][1] + G0[anim][1]) % 1 + 1) % 1 * a.getClip().duration;
      }
      this.anim = anim; this.animSpd = spd;
    } else if (nat && p.current && Math.abs(spd - (this.animSpd || 1)) > 0.01) { p.current.timeScale = spd; this.animSpd = spd; }
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
    // the semis' trailers (trailer.js): their circles
    const T = D.trailers;
    if (T) {
      const push = t => { for (const k of t.circles || []) { const ex = x - k.x, ez = z - k.z, d2 = ex * ex + ez * ez, rr = k.r + R_BODY; if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2), m = (rr - d) / d; x += ex * m; z += ez * m; } } };
      if (T.mine && T.mine.t) push(T.mine.t);
      if (T.traffic) for (const t of T.traffic.values()) push(t);
      if (T.left) for (const t of T.left.values()) push(t); // (a semi left standing keeps its trailer: trailer.js)
    }
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

  // the camera on the person from here, eased in from where the car's camera is; yaw: which way it looks (by
  // default the way the camera was looking)
  startCam(yaw) {
    if (this.camOwned && !this.camBlend) return;
    // (out again while the camera was still easing into the car's: from wherever it is now)
    this.camBlend = null;
    this.camOwned = true;
    this.camFrom = { p: this.camera.position.clone(), q: this.camera.quaternion.clone(), t: 0 };
    const f = _a.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camYaw = yaw ?? Math.atan2(f.x, f.z);
    this.camReady = false;
    this.setHud();
  }
  // out of a car by a door on side sx: looking along the car from behind the person, a little in towards it
  doorCamYaw(rig, sx) { return this.yawOf(rig, Math.PI - sx * 0.6); }

  // into a car: the camera eased from where it is now into the car's own (its view as the driver had it), over the
  // time the person takes to sit down, so it never goes inside the car with them
  camBack(car, dur = 0.9) {
    const cam = this.camera;
    this.camBlend = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, t: 0, car: car || null, dur };
    this.camOwned = true;
    this.drive.cam.ready = false;
  }

  // how far a camera ray from the person (tgt, a unit dir, len) gets before a car's body or a trailer: cars as boxes
  // (one the person is inside of, climbing in or out, left out), trailers as their circles
  camClear(tgt, dir, len) {
    const D = this.drive;
    let best = len;
    const box = (rig, cx, cy, cz, yaw) => {
      if (!rig || !rig.dims) return;
      const hl = rig.dims.length / 2 + 0.25, hw = rig.dims.width / 2 + 0.2, h = rig.dims.height + 0.25;
      const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
      const ox = tgt.x - cx, oz = tgt.z - cz, oy = tgt.y - cy;
      const lf = ox * fx + oz * fz, lr = ox * rx + oz * rz;
      if (Math.abs(lf) < hl && Math.abs(lr) < hw && oy > -0.5 && oy < h) return;
      const df = dir.x * fx + dir.z * fz, dr = dir.x * rx + dir.z * rz;
      let t0 = 0, t1 = best;
      for (const [o, d, lo, hi] of [[lf, df, -hl, hl], [lr, dr, -hw, hw], [oy, dir.y, -0.5, h]]) {
        if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return; continue; }
        let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return;
      }
      if (t0 < best) best = t0;
    };
    const veh = (rig, v) => { const o = v.origin(_v9); box(rig, o.x, o.y, o.z, v.heading * Math.PI / 180); };
    if (D.car) veh(D.car.rig, D.car.vehicle);
    for (const e of this.parked) veh(e.rig, e.vehicle);
    if (D.traffic) for (const c of D.traffic.list) if (Math.abs(c.x - tgt.x) < 30 && Math.abs(c.z - tgt.z) < 30) box(c.rig, c.x, c.y, c.z, c.yaw + (c.offYaw || 0));
    // trailers: their circles, as posts about 4 m tall
    const T = D.trailers, tr = [];
    if (T && T.mine && T.mine.t) tr.push(T.mine.t);
    if (T && T.traffic) for (const t of T.traffic.values()) tr.push(t);
    if (T && T.left) for (const t of T.left.values()) tr.push(t);
    for (const t of tr) for (const k of t.circles || []) {
      const ox = tgt.x - k.x, oz = tgt.z - k.z, r = k.r + 0.2;
      const a = dir.x * dir.x + dir.z * dir.z; if (a < 1e-8) continue;
      const bq = 2 * (ox * dir.x + oz * dir.z), cq = ox * ox + oz * oz - r * r;
      if (cq < 0) continue;
      const disc = bq * bq - 4 * a * cq; if (disc < 0) continue;
      const t0 = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t0 > 0 && t0 < best && tgt.y + dir.y * t0 < this.pos.y + 4.4) best = t0;
    }
    return best;
  }
  camUpdate(dt) {
    const cam = this.camera, p = this.person;
    if (!p) return;
    const D = this.drive;
    const B = this.camBlend;
    if (B) {
      // the car's camera works out its own place this frame (for the car being got into), then the two are blended
      const car = this.mode === 'car' || !B.car ? D.car : B.car;
      if (car && car.rig && car.vehicle) D.cam.update(dt, car, D.world, { lookBack: D.lookBack });
      B.t = Math.min(1, B.t + dt / (B.dur || 0.9));
      const k = ease(B.t);
      cam.position.lerpVectors(B.p, cam.position, k);
      _q.copy(cam.quaternion); cam.quaternion.copy(B.q).slerp(_q, k);
      cam.fov = B.fov + (cam.fov - B.fov) * k; cam.updateProjectionMatrix();
      // (held on the car being got into until the person is in its seat: the car camera would follow the old car)
      if (B.t >= 1 && this.mode === 'car') { this.camBlend = null; this.camOwned = false; }
      return;
    }
    const h = (this.look && this.look.height) || (p.height || 1.75);
    // (while climbing in or out, crawling, or knocked down: where the body is; else where the person stands)
    const S = this.seq, onBody = this.mode === 'down' || (S && (S.phase === 'climb' || S.phase === 'slide' || S.kind === 'crawl' || S.phase === 'aisle' || S.phase === 'steps'));
    const tgt = _a.copy(onBody ? p.object.getWorldPosition(_c) : this.pos);
    tgt.y += this.mode === 'down' ? 0.5 : h * 0.9;
    // behind the person at the pitch asked for; if a wall, a car or a trailer would bring it closer than about a
    // metre and a half, from higher up instead (looking down over the car), as far as is clear
    const want = _b, dir = _c;
    let best = -1;
    for (const lift of [0, 0.45, 0.9]) {
      const pitch = Math.min(1.3, this.camPitch + lift), cp = Math.cos(pitch), sp = Math.sin(pitch);
      dir.set(-Math.sin(this.camYaw) * cp * this.camDist, sp * this.camDist + 0.25, -Math.cos(this.camYaw) * cp * this.camDist);
      const len = dir.length();
      if (len < 1e-3) continue;
      dir.divideScalar(len);
      const hit = D.world.raycast(tgt, dir, len);
      let L = len;
      if (hit && hit.distance < len) L = Math.max(0.6, hit.distance - 0.25);
      const lc = this.camClear(tgt, dir, L);
      if (lc < L) L = Math.max(0.35, lc - 0.15);
      if (L > best) { best = L; want.copy(tgt).addScaledVector(dir, L); }
      if (L >= Math.min(len, 1.5)) break;
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
    if (this.forceHint && performance.now() > this.forceHint.until) this.forceHint = null;
    if (this.forceHint) text = this.forceHint.text;
    else if (this.mode === 'foot') {
      const t = this.target();
      this.near = t;
      // the door of the car the person is next to cut ahead, in the background, in case E is pressed
      if (t && t.rig) this.prepDoor(t.rig, this.doorOf(t.rig, 0) ? this.doorOf(t.rig, 0).door : 0);
      if (t) {
        const occupied = t.kind === 'traffic' || t.kind === 'parked' ? this.occ.occupied(t.kind === 'parked' ? t.ref : t.rig, 0) || t.kind === 'traffic' : this.occ.occupied(t.rig, 0);
        text = occupied ? 'Press <b>E</b> to take this car' : 'Press <b>E</b> to get in';
      } else if (!this.toldWalk) text = '<b>W A S D</b> walk (keep going to jog), <b>Shift</b> run, <b>Space</b> jump, drag to look';
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
