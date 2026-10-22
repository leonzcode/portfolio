// A plain jointed figure with the same calls as people.js's Person, used when that module is missing or fails to
// load (and while it was being written): capsule limbs on joints, a few poses blended in code, a rigid tumble for
// the ragdoll. Its origin is on the ground between the feet, facing +z.
import * as THREE from 'three';

const SKIN = [0xf1c7a5, 0xe0ac8a, 0xc68863, 0x8d5a3b, 0x5c3a24, 0xf3d2b8];
const SHIRT = [0x2d4f8a, 0xb23a3a, 0x3b7a4a, 0xe8e4da, 0x222428, 0x7a5aa0, 0xd8a03a, 0x4a6670, 0x9a9da2];
const PANTS = [0x23324f, 0x2b2b2e, 0x5b5f66, 0x6b5a44, 0x3a4a6a, 0x1c1c1e];
const HAIR = [0x1a1410, 0x3b2a1c, 0x6a4a2c, 0xb08a52, 0x8a8a8a, 0x2a1a10];
const pick = (a, r) => a[Math.floor(r() * a.length)];

export function randomLook(opts = {}) {
  const r = opts.rand || Math.random;
  const kid = !!opts.kid;
  return { kid, skin: pick(SKIN, r), shirt: pick(SHIRT, r), pants: pick(PANTS, r), hair: pick(HAIR, r), height: kid ? 1.15 + r() * 0.3 : 1.6 + r() * 0.3 };
}
export function playerLook() {
  try { const s = JSON.parse(localStorage.getItem('car_look') || 'null'); if (s && typeof s === 'object') return { ...randomLook(), ...s, player: true }; } catch (e) {}
  return { kid: false, skin: 0xe0ac8a, shirt: 0x2d4f8a, pants: 0x23324f, hair: 0x2a1a10, height: 1.78, player: true };
}

const mats = new Map();
function mat(hex) {
  hex = typeof hex === 'string' ? new THREE.Color(hex).getHex() : hex;
  let m = mats.get(hex);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.75, metalness: 0 }); m.name = 'standin'; mats.set(hex, m); }
  return m;
}
const geos = {};
function cap(r, len) {
  const k = r.toFixed(3) + ':' + len.toFixed(3);
  if (!geos[k]) { const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 8); g.translate(0, -len / 2, 0); geos[k] = g; }
  return geos[k];
}
function sphere(r) { const k = 's' + r; if (!geos[k]) geos[k] = new THREE.SphereGeometry(r, 12, 9); return geos[k]; }

// poses: joint name -> [x, y, z] Euler (radians); missing joints are 0. hipsY is the hips' height in body units
// (1 = standing).
const POSES = {
  stand: {},
  sit: { upperLegL: [-1.62, 0, 0.06], upperLegR: [-1.62, 0, -0.06], lowerLegL: [1.25, 0, 0], lowerLegR: [1.25, 0, 0], spine: [0.12, 0, 0], upperArmL: [-0.3, 0, 0.12], upperArmR: [-0.3, 0, -0.12], lowerArmL: [-0.9, 0, 0], lowerArmR: [-0.9, 0, 0] },
  drive: { upperLegL: [-1.6, 0, 0.08], upperLegR: [-1.6, 0, -0.08], lowerLegL: [1.1, 0, 0], lowerLegR: [1.1, 0, 0], spine: [0.18, 0, 0], upperArmL: [-1.0, 0, 0.18], upperArmR: [-1.0, 0, -0.18], lowerArmL: [-0.55, 0, 0], lowerArmR: [-0.55, 0, 0] },
  lie: { upperArmL: [0, 0, 0.5], upperArmR: [0, 0, -0.5], upperLegL: [0, 0, 0.12], upperLegR: [0, 0, -0.12] },
  angry: { upperArmR: [-2.6, 0, -0.2], lowerArmR: [-1.2, 0, 0], upperArmL: [-0.2, 0, 0.3], lowerArmL: [-1.4, 0, 0] },
  pull: { upperArmL: [-1.5, 0, 0.1], upperArmR: [-1.5, 0, -0.1], lowerArmL: [-0.3, 0, 0], lowerArmR: [-0.3, 0, 0], spine: [0.25, 0, 0], upperLegL: [-0.4, 0, 0], lowerLegL: [0.5, 0, 0] },
  flail: { upperArmL: [-2.4, 0, 0.9], upperArmR: [-2.2, 0, -1.1], lowerArmL: [-0.6, 0, 0], lowerArmR: [-0.9, 0, 0], upperLegL: [-0.8, 0, 0.3], upperLegR: [0.3, 0, -0.2], lowerLegL: [1.0, 0, 0], lowerLegR: [0.6, 0, 0] },
};
const JOINTS = ['hips', 'spine', 'neck', 'head', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'];

export class Person {
  constructor(look = randomLook(), opts = {}) {
    this.look = look;
    const s = this.scale = (look.height || 1.75) / 1.75;
    this.height = look.height || 1.75;
    const o = this.object = new THREE.Group(); o.name = 'person';
    const J = this.j = {};
    const g = (name, parent, x, y, z) => { const n = new THREE.Group(); n.name = name; n.position.set(x, y, z); parent.add(n); J[name] = n; return n; };
    const m = (parent, geo, material, y = 0) => { const me = new THREE.Mesh(geo, material); me.position.y = y; me.castShadow = !!opts.shadows; parent.add(me); return me; };
    const skin = mat(look.skin), shirt = mat(look.shirt), pants = mat(look.pants), hair = mat(look.hair), shoe = mat(0x1a1a1a);
    // built facing +z, turned to face -z as the game's people and cars do
    const inner = g('inner', o, 0, 0, 0); inner.rotation.y = Math.PI;
    const body = g('body', inner, 0, 0, 0); body.scale.setScalar(s);
    const hips = g('hips', body, 0, 0.95, 0);
    m(hips, sphere(0.15), pants).scale.set(1.05, 0.7, 0.75);
    const spine = g('spine', hips, 0, 0.05, 0);
    const torso = m(spine, cap(0.15, 0.48), shirt, 0.48); torso.scale.set(1.2, 1, 0.75);
    const neck = g('neck', spine, 0, 0.5, 0);
    const head = g('head', neck, 0, 0.06, 0);
    m(head, sphere(0.105), skin, 0.1).scale.set(0.92, 1.1, 1);
    m(head, sphere(0.108), hair, 0.14).scale.set(0.95, 0.75, 1.02);
    for (const [side, x] of [['L', 0.2], ['R', -0.2]]) {
      const ua = g('upperArm' + side, spine, x, 0.43, 0);
      m(ua, cap(0.05, 0.3), shirt, 0);
      const la = g('lowerArm' + side, ua, 0, -0.3, 0);
      m(la, cap(0.042, 0.26), skin, 0);
      g('hand' + side, la, 0, -0.27, 0);
      m(J['hand' + side], sphere(0.045), skin, -0.03);
      const ul = g('upperLeg' + side, hips, x * 0.48, -0.04, 0);
      m(ul, cap(0.075, 0.45), pants, 0);
      const ll = g('lowerLeg' + side, ul, 0, -0.45, 0);
      m(ll, cap(0.058, 0.44), pants, 0);
      const ft = g('foot' + side, ll, 0, -0.44, 0);
      m(ft, sphere(0.05), shoe, -0.02).scale.set(1, 0.7, 2.2);
      J['foot' + side].children[0].position.z = 0.05;
    }
    this.cur = 'stand'; this.from = null; this.fade = 0; this.fadeT = 0; this.t = 0; this.speed = 1;
    this.rag = null; this.settled = false; this.ragdolling = false;
  }

  bone(name) { return this.j[name] || null; }
  seatOffset() { return new THREE.Vector3(0, 0.95 * this.scale, 0); }
  setHeadVisible(on) { this.j.head.visible = on; }
  setCabin() {}
  setShadows(on) { this.object.traverse(o => { if (o.isMesh) o.castShadow = on; }); }

  play(name, opts = {}) {
    if (name === this.cur && !opts.restart) return;
    this.from = this._snapshot(); this.fade = opts.fade ?? 0.25; this.fadeT = 0;
    this.cur = name; this.t = 0; this.speed = opts.speed || 1;
  }
  _snapshot() { const s = {}; for (const k of JOINTS) { const n = this.j[k]; s[k] = [n.rotation.x, n.rotation.y, n.rotation.z]; } s._hy = this.j.hips.position.y; return s; }

  _pose(name, t) {
    // returns joint -> euler, plus hips height (body units)
    const P = {}; let hy = 0.95;
    const base = POSES[name] || POSES[{ idle: 'stand', exit_car: 'sit', enter_car: 'sit', pulled_out: 'flail', get_up: 'stand', hurt: 'stand', fall: 'flail' }[name]] || POSES.stand;
    for (const k in base) P[k] = base[k].slice();
    const sw = (k, a) => { P[k] = P[k] || [0, 0, 0]; P[k][0] += a; };
    if (name === 'walk' || name === 'run') {
      const run = name === 'run', f = (run ? 1.45 : 0.95) * Math.PI * 2, A = run ? 0.9 : 0.5, ph = t * f;
      sw('upperLegL', Math.sin(ph) * A); sw('upperLegR', -Math.sin(ph) * A);
      sw('lowerLegL', Math.max(0, Math.sin(ph - 1.4)) * (run ? 1.6 : 0.9)); sw('lowerLegR', Math.max(0, Math.sin(ph + Math.PI - 1.4)) * (run ? 1.6 : 0.9));
      sw('upperArmL', -Math.sin(ph) * A * 0.8); sw('upperArmR', Math.sin(ph) * A * 0.8);
      sw('lowerArmL', run ? -1.3 : -0.3); sw('lowerArmR', run ? -1.3 : -0.3);
      sw('spine', run ? 0.18 : 0.04);
      hy = 0.95 - Math.abs(Math.cos(ph)) * (run ? 0.05 : 0.02);
    } else if (name === 'idle' || name === 'stand' || name === 'hurt') {
      sw('spine', Math.sin(t * 1.7) * 0.015 + (name === 'hurt' ? 0.35 : 0));
      if (name === 'hurt') { sw('upperArmL', -0.6); sw('lowerArmL', -1.0); }
    } else if (name === 'jump') {
      sw('upperLegL', -0.5); sw('lowerLegL', 0.9); sw('upperLegR', -0.2); sw('lowerLegR', 0.5); sw('upperArmL', -0.6); sw('upperArmR', -0.6);
    } else if (name === 'angry') {
      sw('upperArmR', Math.sin(t * 9) * 0.3); sw('lowerArmR', Math.sin(t * 9 + 1) * 0.3);
    } else if (name === 'pulled_out' || name === 'fall' || name === 'flail') {
      sw('upperArmL', Math.sin(t * 7) * 0.6); sw('upperArmR', Math.sin(t * 6 + 2) * 0.6); sw('upperLegL', Math.sin(t * 5) * 0.5); sw('upperLegR', Math.sin(t * 5.5 + 1) * 0.5);
    } else if (name === 'sit' || name === 'drive' || name === 'exit_car' || name === 'enter_car') hy = 0.95;
    return { P, hy };
  }

  update(dt) {
    if (this._getUp) this._getUp(dt);
    this.t += dt * this.speed;
    if (this.rag) this._ragStep(dt);
    const { P, hy } = this._pose(this.cur, this.t);
    let k = 1;
    if (this.from) { this.fadeT += dt; k = this.fade > 0 ? Math.min(1, this.fadeT / this.fade) : 1; k = k * k * (3 - 2 * k); if (k >= 1) this.from = null; }
    for (const name of JOINTS) {
      const n = this.j[name], to = P[name] || [0, 0, 0];
      if (this.from) { const f = this.from[name]; n.rotation.set(f[0] + (to[0] - f[0]) * k, f[1] + (to[1] - f[1]) * k, f[2] + (to[2] - f[2]) * k); }
      else n.rotation.set(to[0], to[1], to[2]);
    }
    const y = this.from ? this.from._hy + (hy - this.from._hy) * k : hy;
    this.j.hips.position.y = y;
  }

  // a rigid tumble: the whole body flies, spins and slides to a stop on the ground (opts.ground(x, z, y))
  ragdoll(v, spin, opts = {}) {
    if (spin && !spin.isVector3) { opts = spin; spin = null; }
    const o = this.object;
    this.ragdolling = true; this.settled = false;
    this.rag = { v: v.clone(), w: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8).multiplyScalar(0.4 + Math.min(1.5, v.length() / 10)), ground: opts.ground || (() => 0), t: 0, still: 0 };
    // pivot about the middle of the body
    const c = new THREE.Vector3(0, 0.95 * this.scale, 0);
    this.j.body.position.copy(c).negate();
    o.position.add(c.applyQuaternion(o.quaternion));
    this.play('flail', { fade: 0.15 });
  }
  _ragStep(dt) {
    const R = this.rag, o = this.object;
    R.t += dt;
    R.v.y -= 9.81 * dt;
    o.position.addScaledVector(R.v, dt);
    const wl = R.w.length();
    if (wl > 1e-4) o.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(R.w.clone().divideScalar(wl), wl * dt));
    const g = R.ground(o.position.x, o.position.z, o.position.y + 0.5);
    const floor = (g ?? 0) + 0.16 * this.scale;
    if (o.position.y < floor) {
      o.position.y = floor;
      if (R.v.y < 0) R.v.y = -R.v.y * 0.25;
      const f = Math.exp(-dt * 5); R.v.x *= f; R.v.z *= f; R.w.multiplyScalar(Math.exp(-dt * 4));
      // fall flat: ease the body's up towards horizontal
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion);
      const flat = new THREE.Vector3(up.x, 0, up.z);
      if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
      flat.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, flat);
      o.quaternion.premultiply(new THREE.Quaternion().slerp(q, Math.min(1, dt * 3)));
      if (R.t > 0.4 && this.cur !== 'lie') this.play('lie', { fade: 0.5 });
    }
    if (R.v.length() < 0.25 && o.position.y < floor + 0.05 && R.t > 0.8) R.still += dt; else R.still = 0;
    if (R.still > 0.6 && !this.settled) { this.settled = true; R.v.set(0, 0, 0); R.w.set(0, 0, 0); }
  }

  // back on the feet: a second and a half of standing up, then standing (resolves when done)
  getUp(onDone) {
    if (!this.rag) { if (onDone) onDone(this); return Promise.resolve(); }
    const o = this.object, R = this.rag;
    const c = o.position.clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion); fwd.y = 0;
    const yaw = fwd.lengthSq() > 1e-4 ? Math.atan2(-fwd.x, -fwd.z) : 0;
    const q0 = o.quaternion.clone(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const g = R.ground(c.x, c.z, c.y + 0.5) ?? (c.y - 0.16 * this.scale);
    this.rag = null;
    this.j.body.position.set(0, 0, 0);
    o.position.set(c.x, g, c.z);
    this.play('stand', { fade: 1.2 });
    return new Promise(res => {
      let t = 0;
      this._getUp = dt => { t += dt; const k = Math.min(1, t / 1.2); o.quaternion.copy(q0).slerp(q1, k * k * (3 - 2 * k)); if (k >= 1) { this._getUp = null; this.ragdolling = false; res(); if (onDone) onDone(this); } };
    });
  }

  dispose() { if (this.object.parent) this.object.parent.remove(this.object); }
}

export function createPerson(look, opts) { return new Person(look, opts); }
