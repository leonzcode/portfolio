// Cameras: chase (behind the travel, held steady through spins), far chase, first person (a helmet camera at the
// rider's eyes, turning with the head) and filmer (tripod spots beside the features, panning and zooming to follow).
import * as THREE from 'three';
import { height } from './terrain.js?v=26';
import { FollowQ } from './rig.js?v=26';

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
  // looking round (on the chairlift: the turn keys swing the chase camera round the chair, -1 .. 1)
  // (L: named lookRound, not look: this.look is the camera's look-at point, set in the constructor, and hid the method)
  // The view turns the way of the key (right looks right, as the mouse does: orbit < 0 turns the view right); the turn
  // speeds up and slows down over about a tenth of a second instead of starting and stopping dead. On the chair it
  // stays where it was turned (2026-11-06, Leon: "stays the same throughout unless you rotate it"); off the chair it
  // comes back behind you.
  lookRound(u, dt) {
    const want = u ? -u * 1.6 : 0;
    this.orbitV = (this.orbitV || 0) + (want - (this.orbitV || 0)) * Math.min(1, dt * 10);
    this.orbit = (this.orbit || 0) + (u ? this.orbitV * dt : this.onLift ? 0 : -(this.orbit || 0) * Math.min(1, dt * 1.5));
    this.orbit = Math.atan2(Math.sin(this.orbit), Math.cos(this.orbit));
    if (!this.onLift) this.orbit = Math.max(-2.6, Math.min(2.6, this.orbit));
  }
  next() { this.set(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]); return this.mode; }
  /* looking round in first person (2026-11-08, for "still room to look around"): a drag turns the view from where the
     ride aims it, up to about 100 degrees either way and 55 up or down, and it eases back a moment after it is let go.
     The left button drags in the keys and Shredsauce schemes (the mouse is free there), the middle button in any (with
     the pointer locked in the mouse scheme, input.js stops steering while it is held: input.lookDrag), a finger on the
     screen away from the buttons on a touch screen. main.js calls it once. */
  attachLook(canvas, input) {
    const L = this.lk = { yaw: 0, pitch: 0, dx: 0, dy: 0, on: false, idle: 9, id: -1, x: 0, y: 0 };
    const locked = () => document.pointerLockElement === canvas;
    canvas.addEventListener('pointerdown', e => {
      // (2026-11-12: with the mouse scheme gone, a drag on the chairlift turns the chair camera round too; it stays turned)
      L.chair = this.onLift && this.mode !== 'pov';
      if (this.mode !== 'pov' && !L.chair) return;
      const ok = e.pointerType === 'touch' || e.button === 1 || (e.button === 0 && !locked() && input.scheme !== 'mouse');
      if (!ok) return;
      L.on = true; L.id = e.pointerId; L.x = e.clientX; L.y = e.clientY;
      if (e.button === 1) { e.preventDefault(); input.lookDrag = true; }
    });
    addEventListener('pointermove', e => {
      if (!L.on || e.pointerId !== L.id) return;
      const lk = locked(), dx = lk ? e.movementX : e.clientX - L.x, dy = lk ? e.movementY : e.clientY - L.y;
      L.x = e.clientX; L.y = e.clientY;
      const k = e.pointerType === 'touch' ? 0.006 : 0.004;
      if (L.chair) { if (this.onLift) { const o = (this.orbit || 0) - dx * k * 1.5; this.orbit = Math.atan2(Math.sin(o), Math.cos(o)); } return; }   // (right looks right, as the turn keys)
      L.dx -= dx * k; L.dy += dy * k;
    });
    const up = e => { if (e.pointerId === L.id) { L.on = false; L.id = -1; input.lookDrag = false; } };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  update(dt, sk, rig) {
    if (this.mode === 'fixed') return;
    this.n = (this.n || 0) + 1;                      // (frames: the chair's and the first-person camera's state is fresh)
    this.onLift = sk.state === 'lift';
    const cam = this.cam, k = this.first ? 1 : 1 - Math.exp(-dt * 6);
    this.cam.layers.enable(1);
    // the body's middle: in the air the centre of mass, on the snow the same height over the feet, so takeoffs and
    // landings do not jolt the camera (the crouch it follows is already eased)
    const comH = sk.comH ? sk.comH() : 0.92 * (1 - (sk.crouch ?? 0.3) * 0.35);
    // (in a crash: the body's middle as the rig drew it, tumbling on the snow)
    const body = sk.state === 'crash' && rig && rig.midOk ? rig.mid.clone() : sk.state === 'crash' || sk.state === 'air' ? sk.com.clone() : sk.p.clone().add(new THREE.Vector3(0, comH, 0));
    if (rig && rig.setFirstPerson) rig.setFirstPerson(this.mode === 'pov' && !!rig.eye);
    if (this.mode === 'pov' && rig.eye) {
      this.pov(dt, sk, rig);
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
    } else if (sk.state === 'lift' && sk.q) {
      this.chair(dt, sk);
    } else {
      const far = this.mode === 'far';
      const dist = far ? 9.5 : 4.2, hgt = far ? 3.6 : 1.55;
      // follow the travel on the snow; hold the direction from the takeoff in the air
      if (sk.state === 'ground' || sk.state === 'rail') {
        const v = sk.v.clone(); v.y = 0;
        if (v.lengthSq() > 0.5) this.dir.lerp(v.normalize(), this.first ? 1 : 1 - Math.exp(-dt * 3)).normalize();
      }
      const want = body.clone().addScaledVector(this.dir, -dist); want.y += hgt;
      if (sk.state === 'air') want.y += 0.9;
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
  /* The chase camera on the chairlift (2026-11-06, for "make it so that on the chairlift your camera does not change
     after each pole and stays the same throughout unless you rotate it using your cursor"). It used to ride 4.2 m
     behind and 2.75 m over the rider, at the cable's own height, so every tower's head stood in its way: lift.js swung
     it out to the side past each tower and pushed it up over the heads, and a tripod took over at both stations. Now it
     is held in one place against the chair: 3 m behind the seat along the line (rising and falling with the cable's
     grade, so it keeps the same height under it) and 1.35 m over it, which is inside the space the chair itself sweeps
     (from its grip 2.76 m over the seat down to its footrest), so it clears every tower's head and sheaves the way the
     chairs do. The look keys or the mouse turn it round the rider, and it stays where it was turned (orbit, any angle).
     Anything thin it passes close to when turned (a tower's column, a floodlight pole, a chair coming down) is left out
     by the near plane (lift.js clipNear), never by moving the camera. */
  chair(dt, sk) {
    const cam = this.cam, far = this.mode === 'far', C = this.ch || (this.ch = { a: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, g: 0, ok: false });
    const f = _lf.set(0, 0, 1).applyQuaternion(sk.q); f.y = 0;
    const yaw = f.lengthSq() > 1e-4 ? Math.atan2(f.x, f.z) : C.yaw;
    // (started again only when its state is stale, older than last frame: not on this.first, which lift.js sets every
    // frame of the express, where it dropped the grade and the camera jumped 0.9 m. A chair that moved more than 30 m in
    // one frame, the express through a slow frame or the page come back, is followed there with the grade kept.)
    const stale = C.n !== this.n - 1; C.n = this.n;
    if (stale || !C.ok) { C.a.copy(sk.p); C.v.set(0, 0, 0); C.yaw = yaw; C.g = 0; C.ok = true; }
    else if (C.a.distanceToSquared(sk.p) > 900) { C.a.copy(sk.p); C.yaw = yaw; }
    else {
      // the seat (lift.js moves it smoothly, sitting down and standing up too); its velocity, smoothed, for the grade
      const px = C.a.x, py = C.a.y, pz = C.a.z;
      C.a.copy(sk.p);
      if (dt > 0) C.v.lerp(_cv.set((C.a.x - px) / dt, (C.a.y - py) / dt, (C.a.z - pz) / dt), Math.min(1, dt * 3));
      const d = Math.atan2(Math.sin(yaw - C.yaw), Math.cos(yaw - C.yaw)); C.yaw += d * (1 - Math.exp(-dt * 6));
      // the cable's grade: how much it climbs a metre along the line (only once the chair is going), followed slowly, so
      // a tower's change of grade comes in over a few seconds
      const h = Math.hypot(C.v.x, C.v.z);
      C.g += ((h > 2 ? THREE.MathUtils.clamp(C.v.y / h, -1, 1) : 0) - C.g) * (1 - Math.exp(-dt * 0.8));
    }
    // round the rider by the look (orbit), from behind the chair
    const a = C.yaw + (this.orbit || 0), dx = Math.sin(a), dz = Math.cos(a), fx = Math.sin(C.yaw), fz = Math.cos(C.yaw);
    const back = far ? 6.5 : 3, up = far ? 1.75 : 1.35;
    const along = -back * (dx * fx + dz * fz);                                  // metres along the line (minus: behind)
    this.pos.set(C.a.x - dx * back, C.a.y + up + C.g * along, C.a.z - dz * back);
    const gy = height(this.pos.x, this.pos.z) + 0.7; if (this.pos.y < gy) this.pos.y = gy;
    cam.position.copy(this.pos);
    // looking past the rider's head, the way the camera faces from behind them
    const ahead = far ? 4 : 3.5;
    this.look.set(C.a.x + dx * ahead, C.a.y + 0.75 + C.g * ahead * (dx * fx + dz * fz), C.a.z + dz * ahead);
    this.dir.set(fx, 0, fz);
    cam.up.set(0, 1, 0); cam.lookAt(this.look);
    this.fov += (66 + Math.min(14, sk.v.length() * 0.45) - this.fov) * Math.min(1, dt * 2);
    cam.near = 0.15;
  }
  /* First person (2026-11-06, for "make it so that first person looks more realistic and you can see the deck move and
     it is not glitchy for all"). It was the head bone itself: every snap of the body under it (a landing set straight
     onto the snow, 15 to 45 degrees in one frame, a rail's lock-on), the head's own springs and wobbles, the crash's
     tumble and sway, and the horizon's correction switched on and off at takeoff and landing all went straight to the
     screen, through a 92 degree view (118 across) that stretched the edges. Now:
     - the rider is eased through those snaps while seen in first person (rig.js fpEase), so what you ride and your
       hands do not jump under your eyes either;
     - the gaze is the body's turn with the head's looks on it (into the turn, down a rail, over the shoulder riding
       switch), the head's quick swings in a trick eased out (below); on the snow the eyes hold the horizon: 85% of the
       head's tilt is taken off, eased in and out at landings and takeoffs, none of it in the air (the view goes round
       with you through spins, flips and corks);
     - on the snow the eyes keep their own aim at the snow ahead, a ride's own angle under the level (lower on a steeper
       slope), with only a fifth of the head's nodding: low enough that the ski tips and your hands, the board, the
       scooter's or the bike's bars and your arms are at the bottom of the view. In the air it looks a ride's own angle
       under the head's gaze, further down while a trick is held (the deck going round in a tailwhip, the bars in a bar
       spin, the ski you grab);
     - a follower (rig.js FollowQ) turns it: smooth turning is followed exactly, a jump is eased out over about a third
       of a second;
     - on the chairlift it faces the way the chair goes (it does not glance round with the head), and only the look keys
       or the mouse turn it, where it stays;
     - in a crash it leaves the body, up and back from where you were going, looking at you tumbling, and comes back to
       the eyes when you are put back on your feet (from the eyes the view spun round with the body and the flailing
       skis went across the lens);
     - a view about 104 degrees across whatever the screen's shape, never under the snow's surface. */
  pov(dt, sk, rig) {
    const cam = this.cam, st = sk.state, R = POV[rig.kind] || POV.ski;
    const F = this.fp || (this.fp = { q: new FollowQ(), at: new THREE.Vector3(), cd: new THREE.Vector3(), lvl: 1, crash: 0, trick: 0, hp0: 0, ok: false });
    // (started again when the camera was not in first person last frame, or the eyes jumped more than 3 m: a respawn, back
    // to the start; not on this.first alone, which lift.js sets every frame of the chairlift's express)
    const stale = F.n !== this.n - 1; F.n = this.n;
    // (the eyes as the ride's pose gives them: rig.fpEye, and rig.fpLook if it aims them; ski8/R/NOTES.md)
    const EYE = rig.fpEye || rig.eye, LOOK = st === 'crash' ? null : rig.fpLook;
    const reset = stale || !F.ok || F.at.distanceToSquared(EYE) > 9;
    F.at.copy(EYE); F.ok = true;
    const ease = (x, to, rate) => reset ? to : x + (to - x) * (1 - Math.exp(-dt * rate));
    const snow = st === 'ground' || st === 'rail' || st === 'lift';
    F.lvl = ease(F.lvl, snow ? 1 : 0, snow ? 5 : 9);
    F.trick = ease(F.trick, st === 'air' && (sk.grab || sk.pose || sk.act) ? 1 : 0, 4);
    if (st === 'crash' && !F.inCrash) {
      // the way you were going as you fell (kept: the tumble does not swing the camera round)
      F.inCrash = true; F.cd.set(sk.v.x, 0, sk.v.z);
      if (F.cd.lengthSq() < 0.25) F.cd.set(0, 0, 1).applyQuaternion(rig.headQ).setY(0);
      if (F.cd.lengthSq() < 1e-6) F.cd.set(0, 0, 1);
      F.cd.normalize();
    } else if (st !== 'crash') F.inCrash = false;
    F.crash = st === 'crash' ? ease(F.crash, 1, 3) : 0;
    const cw = F.crash * F.crash * (3 - 2 * F.crash);
    /* the gaze: the head's against the body, eased (quickly on the snow, slowly in the air), on the body as it is: the
       body's own turn (a spin, a flip, a sled's spinner) is followed exactly, the head's slower looks (into a turn,
       back over the shoulder riding switch, at the landing) come through, but not its quick swings in a trick (in a
       tailwhip the head went round at 220 to 570 degrees a second while the body turned at 36: the view whipped round
       instead of the deck). On the chair, the way the chair faces. */
    const B = rig.body.quaternion, rel = _pq.copy(B).invert().multiply(rig.headQ);
    if (reset || !F.rel) (F.rel || (F.rel = new THREE.Quaternion())).copy(rel);
    else F.rel.slerp(rel, 1 - Math.exp(-dt * (st === 'air' ? 3.5 : 8)));
    const G = _G.copy(B);
    if (LOOK) {
      // the ride's own aim: along fpLook, its up the ride's (fpUp) or the body's
      _m4.lookAt(_O, LOOK, rig.fpUp || _pu.set(0, 1, 0).applyQuaternion(B)); G.setFromRotationMatrix(_m4).multiply(_FLIP);
    } else if (st !== 'lift') G.multiply(F.rel);
    // the horizon held on the snow
    const f = _pf.set(0, 0, 1).applyQuaternion(G), u = _pu.set(0, 1, 0).applyQuaternion(G);
    const wl = Math.max(F.lvl, F.crash) * 0.85 * (1 - THREE.MathUtils.smoothstep(Math.abs(f.y), 0.85, 0.97));
    if (wl > 1e-3) {
      const lev = _pl.copy(_Y).addScaledVector(f, -f.y);
      if (lev.lengthSq() > 1e-6) {
        lev.normalize();
        const a = Math.atan2(_pc.crossVectors(u, lev).dot(f), u.dot(lev));
        G.premultiply(_pq.setFromAxisAngle(f, a * wl));
      }
    }
    // looking down (a turn about the head's own left-right axis: plus is down): in the air from the head's gaze, on the
    // snow to the ride's own angle under the level
    const hp = Math.asin(THREE.MathUtils.clamp(_pf.set(0, 0, 1).applyQuaternion(G).y, -1, 1));
    const bf = _pu.set(0, 0, 1).applyQuaternion(rig.body.quaternion), slope = st === 'lift' ? 0 : Math.asin(THREE.MathUtils.clamp(bf.y, -0.9, 0.9));
    F.hp0 = reset ? hp : F.hp0 + (hp - F.hp0) * (1 - Math.exp(-dt * 1.5));    // (the head's usual pitch, slowly)
    const onSnow = hp - ((st === 'lift' ? -0.2 : R.pitch) + 0.35 * Math.min(0, slope) + 0.2 * (hp - F.hp0));
    if (!LOOK) G.multiply(_pq.setFromAxisAngle(_X, (R.down + R.trick * F.trick) * (1 - F.lvl) + onSnow * F.lvl));
    // looking round by a drag (attachLook): about the world's up on the snow, the view's own in the air, then up or down
    const lk = this.lk;
    if (lk) {
      lk.yaw += lk.dx; lk.pitch += lk.dy; lk.dx = lk.dy = 0;
      // (down only so far: straight down from the eyes the view went into the jacket's collar)
      lk.yaw = THREE.MathUtils.clamp(lk.yaw, -1.75, 1.75); lk.pitch = THREE.MathUtils.clamp(lk.pitch, -0.95, 0.42);
      lk.idle = lk.on ? 0 : lk.idle + dt;
      if (lk.idle > 0.8) { const e = Math.exp(-dt * 3); lk.yaw *= e; lk.pitch *= e; }
      if (Math.abs(lk.yaw) > 1e-4) { if (F.lvl > 0.5) G.premultiply(_pq.setFromAxisAngle(_Y, lk.yaw)); else G.multiply(_pq.setFromAxisAngle(_Y, lk.yaw)); }
      if (Math.abs(lk.pitch) > 1e-4) G.multiply(_pq.setFromAxisAngle(_X, lk.pitch));
    }
    // (L) on the chairlift the look keys and the mouse turn it (the same orbit as the chase camera's)
    if (st === 'lift' && this.orbit) G.premultiply(_pq.setFromAxisAngle(_Y, this.orbit));
    // the place: the eyes (a little forward, as a helmet camera sits)
    const t = _pt.copy(EYE).addScaledVector(_pf.set(0, 0, 1).applyQuaternion(rig.headQ), R.fwd);
    // (on the chair, the eyes where they are with the head facing the way the chair goes: its glances round do not
    // carry the view about)
    if (st === 'lift' && rig.eyeOff && rig.headPos && !(rig.fpEye && rig.fpEye.distanceToSquared(rig.eye) > 1e-6)) t.copy(rig.eyeOff).applyQuaternion(rig.body.quaternion).add(rig.headPos).addScaledVector(_pf.set(0, 0, 1).applyQuaternion(rig.body.quaternion), R.fwd + 0.02);
    if (cw > 0.001) {
      // out of the body in a crash: 2.6 m back and 1.5 m up from your middle, looking at it
      const mid = rig.midOk ? _pl.copy(rig.mid) : _pl.set(sk.p.x, sk.p.y + 0.6, sk.p.z);
      const out = _pc.copy(mid).addScaledVector(F.cd, -2.6); out.y += 1.5;
      const gy = height(out.x, out.z) + 1.2; if (out.y < gy) out.y = gy;
      _m4.lookAt(out, mid, _Y); _pq.setFromRotationMatrix(_m4).multiply(_FLIP);
      G.slerp(_pq, cw); t.lerp(out, cw);
    }
    const q = reset ? F.q.reset(G) : F.q.to(G, dt, 14 - 6 * cw, 160);
    cam.quaternion.copy(q).multiply(_FLIP);
    const gy = height(t.x, t.z) + R.low; if (t.y < gy) t.y = gy;
    cam.position.copy(t);
    /* (the head and the helmet hidden only while the camera is in them: H, round 10, it went by how far into the crash's
       swing out the camera was, and for a few frames of a crash the body was seen from half a metre away with no head) */
    if (t.distanceToSquared(EYE) < 0.09) cam.layers.disable(1);
    // about 104 degrees across whatever the screen's shape (66 to 96 up and down), a little wider with speed
    const want = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(52 * Math.PI / 180) / (cam.aspect || 1.6)) * 180 / Math.PI, 66, 96) + Math.min(4, sk.v.length() * 0.15);
    this.fov = reset ? want : this.fov + (want - this.fov) * Math.min(1, dt * 4);
    cam.near = 0.06;
  }
}
// first person, by ride: on the snow how far under the level it looks (rad, on flat snow); in the air how far it looks
// down from the head's gaze, and how much more while a trick is held; how far ahead of the eyes it sits (m: at the
// eyeballs' middle, placeHead puts the eye 2 cm in front of it); its lowest
// over the snow (m)
const POV = {
  ski: { pitch: -0.7, down: 0.4, trick: 0.3, fwd: -0.02, low: 0.25 },   // (2026-11-08: further down, more of the skis and both pole grips in view with the way ahead)
  board: { pitch: -0.64, down: 0.38, trick: 0.3, fwd: -0.02, low: 0.25 },
  scoot: { pitch: -0.62, down: 0.26, trick: 0.12, fwd: -0.02, low: 0.25 },
  bike: { pitch: -0.56, down: 0.24, trick: 0.12, fwd: -0.02, low: 0.25 },
  sled: { pitch: -0.52, down: 0.3, trick: 0.25, fwd: 0.04, low: 0.12 },
};
Cams.POV = POV;   // (for tests)
const _G = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _pf = new THREE.Vector3(), _pu = new THREE.Vector3(), _pl = new THREE.Vector3(), _pc = new THREE.Vector3(), _pt = new THREE.Vector3();
const _O = new THREE.Vector3(), _cv = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _X = new THREE.Vector3(1, 0, 0), _FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // (the head looks along +Z, a camera along -Z)
