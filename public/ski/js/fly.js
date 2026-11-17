/* (W11, 2026-11-14, for "make it so that you can fly around like in leonski2 when you press shift + ` keys")
   Fly mode: a free camera over the mountain, after Leonski 2's free fly (legacy/leonski2.html: startFly, flyUpdate and
   its keys), on every map and every ride. Shift + ` (main.js) turns it on, and again puts the rider down on the snow
   under you, facing the way you look; so it is also a way to get anywhere on the mountain.

   Flying: W / S forward and back and A / D left and right on the level (the look's up and down does not tilt them),
   Space up, Shift down, Ctrl held: faster (as Leonski 2, which also swallows the browser's Ctrl shortcuts on those keys);
   a mouse drag looks round (Leonski 2's own way and 0.003 rad a pixel), and so do the arrow keys; the wheel zooms the
   field of view. Hold a key and the speed builds from a slow start; let go and it is back to the start speed, so a tap
   is a fine move and a hold crosses the mountain. Never closer than CLEAR metres over the snow (terrain.js height, the
   park's features included), nothing else is in the way.

   While it flies (main.js tick): the physics, the recording and the snow's tracks wait, the rider is hidden, the
   skier's state is 'fly' (so no lift boards you, nothing scores, nothing crashes) and its p is the snow under you (so
   the terrain, Any mountain's streamed heights, the shadows and the trail map follow you); the room sees nothing of you
   (net.js: x.fl). A rider on a lift is taken off it. Anything else that puts the rider somewhere (a start, the trail
   map, a change of ride) ends the flight there.

   window.__skiFly = { on, start(), stop({ place = true }) }: stop({ place: false }) ends the flight without putting
   the rider down (for a caller that puts them somewhere itself straight after). */
import * as THREE from 'three';
import { height, normal } from './terrain.js?v=32';

/* Speeds (m/s, m/s/s). Leonski 2's are 55 to start, 360 at most (900 with Ctrl) and 190 a second each second. Here the
   start is slower, for placing yourself over a jump on a park 1.4 km long, and the top is lower. On Any mountain the fine
   heights (zoom 14, about 2 km a tile) are fetched round you and ahead (wdem.js stream) and kept up even at 900; the snow
   drawn from them is built a few milliseconds a frame, and is what sets the top (Low tier, Whistler, looking 150 m
   ahead from 40 m up: nothing unbuilt at 150 m/s in 133 looks, about a quarter unbuilt at 250 and 375, most at 900; at
   375 from 150 m up, nothing unbuilt in 80 looks; scratchpad ski11/W/fly/NOTES.md). So 150 is the top, and Ctrl's 375
   is for crossing high. */
const BASE = 15, MAX = 150, ACCEL = 75, FAST_TOP = 2.5, FAST_ACC = 2.4;
const CLEAR = 3;                  // metres over the snow at the least
const LOOK = 0.003;               // radians a pixel of drag (Leonski 2's)
const DRAG_YAW = 1;               // (Leonski 2's way: a drag to the right turns the view left; -1 turns it right)
const KEY_YAW = 1.5, KEY_PITCH = 1.0;   // the arrow keys' look, radians a second
const PITCH = 1.45;               // up and down at most (Leonski 2's)
const FOV_MIN = 0.4, FOV_MAX = 100;     // the wheel's zoom (Leonski 2's)
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const typing = t => !!(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
const _Y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _t = new THREE.Vector3();

export function makeFly(ctx) { const f = new Fly(ctx); expose(f); return f; }

class Fly {
  /* ctx (main.js): skier, camera, canvas, cams, hud, tricks, terrain, net, park, wld, rig() the rider now, live() riding
     now (playing, not paused, no replay, not watching) */
  constructor(ctx) {
    this.c = ctx; this.flying = false;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.spd = BASE; this.fov = 66; this.lookV = 0; this.lookP = 0;
    this.keys = new Set(); this.fast = false; this.drag = null;
    this.speeds = { base: BASE, max: MAX, accel: ACCEL, fastTop: FAST_TOP, fastAcc: FAST_ACC };   // (tests may change them)
    // the highest the camera goes: over the highest start, by a kilometre on a park map (past about 2 km from the camera
    // their snow is not drawn) and 1.5 km on Any mountain (whose snow is drawn to the horizon); never under 50 m over the
    // snow below, so a high ridge never pushes you into it
    const ys = (ctx.park.starts || []).map(s => height(s.x, s.z)).filter(Number.isFinite);
    this.ceil = (ys.length ? Math.max(...ys) : height(0, 0)) + (ctx.wld ? 1500 : 1000);
    const R = ctx.terrain.root; this.box = R ? { x0: R.x0 + 300, z0: R.z0 + 300, x1: R.x0 + R.size - 300, z1: R.z0 + R.size - 300 } : null;
    // the keys, held or not (always followed, used only while flying)
    addEventListener('keydown', e => {
      this.fast = e.ctrlKey || e.metaKey; this.guard();
      if (!this.flying || typing(e.target)) return;
      if (MOVE.has(e.code)) { if (!e.repeat) this.keys.add(e.code); e.preventDefault(); }
      // (Leonski 2's: Ctrl + a movement key would save, bookmark, select all... in the browser)
      if ((e.ctrlKey || e.metaKey) && /^(Key[WASD]|Arrow|Space|Shift)/.test(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.fast = e.ctrlKey || e.metaKey; this.keys.delete(e.code); this.guard(); });
    addEventListener('blur', () => { this.keys.clear(); this.fast = false; this.drag = null; this.guard(); });
    // a drag looks round (on the game's own canvas, so the menus and the trail map keep their clicks)
    ctx.canvas.addEventListener('pointerdown', e => {
      if (!this.flying || !(e.button === 0 || e.pointerType === 'touch')) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    addEventListener('pointermove', e => {
      const D = this.drag; if (!D || e.pointerId !== D.id) return;
      const dx = e.clientX - D.x, dy = e.clientY - D.y; D.x = e.clientX; D.y = e.clientY;
      if (!this.flying || !this.c.live()) return;
      this.yaw += dx * LOOK * DRAG_YAW; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK, -PITCH, PITCH);
    });
    const up = e => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
    // the wheel: the field of view (Leonski 2's), over the game only
    addEventListener('wheel', e => {
      if (!this.flying || e.target !== this.c.canvas || !this.c.live()) return;
      this.fov = THREE.MathUtils.clamp(this.fov * (1 + e.deltaY * 0.0012), FOV_MIN, FOV_MAX); e.preventDefault();
    }, { passive: false });
    // (with Ctrl as the fast key, Ctrl + W, which a page can never stop, would close the tab: while flying with Ctrl held
    // the browser asks first; only then, so the game's own reloads, a change of map from the menu, never ask)
    this.unload = e => { e.preventDefault(); e.returnValue = ''; return ''; };
    this.guarded = false;
    // the room: a flying rider is not drawn on the others' pages (net.js pose), their state is the snow under them
    if (ctx.net && ctx.net.xFns) ctx.net.xFns.push((x, sk) => { if (sk.state === 'fly') x.fl = 1; });
  }
  // flying now (and if something else has put the rider down meanwhile, a start, the trail map, a new ride: not, from
  // where they were put)
  get on() { if (this.flying && this.c.skier.state !== 'fly') this.end(); return this.flying; }
  // the tab's close asks first while flying with Ctrl held (see unload)
  guard() {
    const want = this.flying && this.fast;
    if (want === this.guarded) return;
    this.guarded = want;
    if (want) addEventListener('beforeunload', this.unload); else removeEventListener('beforeunload', this.unload);
  }
  toggle() { if (this.on) this.stop(); else this.start(); }
  start() {
    if (this.on) return true;
    const c = this.c, sk = c.skier, cam = c.camera;
    if (!c.live()) return false;
    // (a line of tricks going: banked, as when you take a lift; anything still in the air forgotten)
    const T = c.tricks;
    if (T) { if (T.combo) T.endCombo(); T.air = null; T.railT = null; }
    // from where the camera is, looking where it looks (at least CLEAR over the snow)
    cam.getWorldDirection(_d);
    this.pos.copy(cam.position);
    this.yaw = Math.atan2(_d.x, _d.z); this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1)), -PITCH, PITCH);
    this.fov = cam.fov || 66; this.spd = this.speeds.base; this.vel.set(0, 0, 0); this.lookV = this.lookP = 0;
    const g = this.clamp();
    // the rider: everything a trick or a lift left on them cleared (spawn), then flying; off a lift the lift lets go of
    // them on its next update (lift.js and tbar.js, as for any ride ended elsewhere)
    sk.spawn(this.pos.x, this.pos.z, 0, this.yaw);
    sk.state = 'fly';
    sk.events.length = 0;
    // (Shift held for the Shift + ` that started this is not a 'down' until it is pressed again)
    this.keys.clear(); this.drag = null;
    this.flying = true;
    this.place(g);
    this.guard();
    c.hud.flash('Flying: Shift + ` lands', 2200);   // (the keys are in the controls panel and the menu's Keys)
    return true;
  }
  // done flying: place, the rider put down on the snow under you, facing your way; else left as they are
  stop({ place = true } = {}) {
    if (!this.on) return false;
    const sk = this.c.skier;
    if (place) this.land();
    else if (sk.state === 'fly') { sk.spawn(sk.p.x, sk.p.z, 0, this.yaw); sk.safe.length = 0; }   // (a state the physics knows, until the caller puts them somewhere)
    this.end();
    return true;
  }
  // put down: the nearest open snow within about 20 m (not a cliff, not in a tree or a lift tower), facing the way you
  // look, sliding off gently if that way goes down the hill, else standing
  land() {
    const sk = this.c.skier, trees = sk.trees, x0 = this.pos.x, z0 = this.pos.z;
    const ok = (x, z) => normal(x, z).y > 0.8 && !(trees && trees.hit && trees.hit(x, z, 1.2));
    let lx = x0, lz = z0;
    if (!ok(x0, z0)) {
      search: for (const r of [2, 4, 7, 11, 16, 22]) for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
        if (ok(x, z)) { lx = x; lz = z; break search; }
      }
    }
    const n = normal(lx, lz), down = Math.sin(this.yaw) * n.x + Math.cos(this.yaw) * n.z;
    sk.spawn(lx, lz, down > 0.03 ? 2 : 0, this.yaw);
    sk.safe.length = 0;                     // (a crash soon after never puts you back where you were before flying)
    this.c.hud.flash('Back on the snow', 1000);
  }
  // the end of a flight, however it ended: the rider shown, the cameras started again from where the rider is
  end() {
    this.flying = false; this.keys.clear(); this.drag = null; this.vel.set(0, 0, 0);
    this.guard();
    const c = this.c, r = c.rig(); if (r) r.root.visible = true;
    const C = c.cams;
    if (C) {
      C.first = true;
      if (typeof C.n === 'number') C.n += 2;       // (first person and the chair camera start again: not eased from before the flight)
      if (C.lk) { C.lk.yaw = C.lk.pitch = C.lk.dx = C.lk.dy = 0; }
    }
  }
  // inside the world, over the snow, under the ceiling
  clamp() {
    const p = this.pos, B = this.box;
    if (B) { p.x = Math.min(B.x1, Math.max(B.x0, p.x)); p.z = Math.min(B.z1, Math.max(B.z0, p.z)); }
    const g = height(p.x, p.z);
    if (!Number.isFinite(p.y)) p.y = g + 20;
    p.y = Math.max(g + CLEAR, Math.min(Math.max(this.ceil, g + 50), p.y));
    return g;
  }
  // one frame (main.js tick, in place of the rider's pose and the cameras): live, the keys move and turn it
  frame(dt) {
    if (!this.on) return;
    const c = this.c, cam = c.camera, live = c.live() && !typing(document.activeElement);
    const k = this.keys, has = code => k.has(code);
    if (live) {
      // the arrow keys look round (eased in over about a tenth of a second)
      const wy = (has('ArrowLeft') ? 1 : 0) - (has('ArrowRight') ? 1 : 0), wp = (has('ArrowUp') ? 1 : 0) - (has('ArrowDown') ? 1 : 0);
      const e = Math.min(1, dt * 12);
      this.lookV += (wy * KEY_YAW - this.lookV) * e; this.lookP += (wp * KEY_PITCH - this.lookP) * e;
      this.yaw += this.lookV * dt; this.pitch = THREE.MathUtils.clamp(this.pitch + this.lookP * dt, -PITCH, PITCH);
      // moving: on the level by the look's heading, up and down by Space and Shift (Leonski 2's flyUpdate)
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);   // (forward, and the screen's left)
      let mx = 0, my = 0, mz = 0;
      if (has('KeyW')) { mx += fx; mz += fz; }
      if (has('KeyS')) { mx -= fx; mz -= fz; }
      if (has('KeyA')) { mx += lx; mz += lz; }
      if (has('KeyD')) { mx -= lx; mz -= lz; }
      if (has('Space')) my += 1;
      if (has('ShiftLeft') || has('ShiftRight')) my -= 1;
      const L = Math.hypot(mx, my, mz), moving = L > 1e-6;
      const V = this.speeds, top = this.fast ? V.max * V.fastTop : V.max, acc = this.fast ? V.accel * V.fastAcc : V.accel;
      this.spd = moving ? Math.min(this.spd + acc * dt, top) : V.base;
      if (moving) this.vel.set(mx / L * this.spd, my / L * this.spd, mz / L * this.spd); else this.vel.set(0, 0, 0);
      this.pos.addScaledVector(this.vel, dt);
    } else { this.vel.set(0, 0, 0); this.spd = this.speeds.base; this.lookV = this.lookP = 0; }
    const g = this.clamp();
    this.place(g);
    // the camera: at the flyer, looking along the yaw and pitch, the field of view eased to the wheel's
    const cp = Math.cos(this.pitch);
    cam.position.copy(this.pos); cam.up.copy(_Y);
    cam.lookAt(_t.set(this.pos.x + Math.sin(this.yaw) * cp, this.pos.y + Math.sin(this.pitch), this.pos.z + Math.cos(this.yaw) * cp));
    cam.fov += (this.fov - cam.fov) * (1 - Math.exp(-6 * dt)); cam.near = 0.5;
    cam.updateProjectionMatrix();
    cam.layers.enable(1);                     // (the others' heads: first person turns that layer off)
  }
  // the skier while flying: on the snow under the flyer (what the terrain's streaming, the shadows, the trail map and the
  // room follow), facing the flyer's way, moving as it moves (the speed readout and the wind), hidden
  place(g) {
    const sk = this.c.skier, p = this.pos;
    sk.p.set(p.x, Number.isFinite(g) ? g : height(p.x, p.z), p.z);
    sk.v.copy(this.vel);
    sk.f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); sk.n.set(0, 1, 0);
    sk.q.setFromAxisAngle(_Y, this.yaw);
    sk.com.set(sk.p.x, sk.p.y + 0.9, sk.p.z);
    sk.slide = 0; sk.edge = 0; sk.crouch = 0; sk.brake = 0;
    // (hidden; but for the locker's turntable on the menu, which turns round the rider where they last stood)
    const r = this.c.rig(), show = !!(this.c.preview && this.c.preview());
    if (r && r.root.visible !== show) r.root.visible = show;
  }
}

// (the test and trail map handle; there once this module has loaded)
export function expose(fly) {
  window.__skiFly = {
    get on() { return fly.on; },
    start() { return fly.start(); },
    stop(o) { return fly.stop(o); },
    _fly: fly,
  };
}
