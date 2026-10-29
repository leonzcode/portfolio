// Clips made here, for what the captured library does not have: driving (hands on the wheel, feet on the pedals),
// shaking a fist, pointing, crossed arms, a jump, a stumble, lying on the back or front, getting up from either,
// getting into and out of a car seat and being pulled out of one. Each is a few key poses: a captured pose to start
// from, bones turned about the body's own axes, hands and feet put on points by a two-bone reach, the body tipped
// about the hips; the keys become ordinary clips (local rotations of every bone), so they play on any of the models.
// Model frame (before the person's 180 degree turn): +z is where the person faces, +y up, +x the person's left.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const N = {
  root: 'Bip01', hips: 'Bip01_Pelvis', spine: 'Bip01_Spine', spine1: 'Bip01_Spine1', chest: 'Bip01_Spine2', neck: 'Bip01_Neck', head: 'Bip01_Head',
  clL: 'Bip01_L_Clavicle', uaL: 'Bip01_L_UpperArm', faL: 'Bip01_L_Forearm', haL: 'Bip01_L_Hand', clR: 'Bip01_R_Clavicle', uaR: 'Bip01_R_UpperArm', faR: 'Bip01_R_Forearm', haR: 'Bip01_R_Hand',
  thL: 'Bip01_L_Thigh', caL: 'Bip01_L_Calf', ftL: 'Bip01_L_Foot', toL: 'Bip01_L_Toe0', thR: 'Bip01_R_Thigh', caR: 'Bip01_R_Calf', ftR: 'Bip01_R_Foot', toR: 'Bip01_R_Toe0'
};

class PoseRig {
  constructor(People, base, clips, sex) {
    this.P = People; this.clips = clips; this.sex = sex;
    const inst = People.instance(base, {});
    this.root = inst.root; this.by = inst.byName;
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.updateMatrixWorld(true);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.names = [];
    this.root.traverse(o => { if ((o.isBone || o.name === 'Bip01') && !/Eye|Mouth|lip|Lip|Cheek|brow|Caninus|Masseter|Tongue|Nose|Jaw/.test(o.name)) this.names.push(o.name); });
  }
  b(k) { return this.by[N[k] || k]; }
  clip(name) { return this.clips.get(name + '.' + this.sex) || this.clips.get(name); }
  // start from a captured clip's pose at time t
  from(name, t = 0) {
    const c = this.clip(name); if (!c) throw new Error('pose base ' + name);
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(c); a.reset(); a.play(); a.time = Math.min(t, c.duration - 1e-3);
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    return this;
  }
  pos(k, out = new THREE.Vector3()) { const b = this.b(k); b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); }
  // turn a bone (and everything below it) about a model axis by degrees
  rot(k, axis, deg) {
    const b = this.b(k); if (!b || !deg) return this;
    const ax = axis === 'x' ? X : axis === 'y' ? Y : axis === 'z' ? Z : axis;
    b.updateWorldMatrix(true, false);
    b.getWorldQuaternion(_q);
    _q.premultiply(_p.setFromAxisAngle(ax, deg * Math.PI / 180));
    this.setWorldQ(b, _q);
    return this;
  }
  setWorldQ(b, q) {
    b.parent.updateWorldMatrix(true, false);
    b.parent.getWorldQuaternion(_p);
    b.quaternion.copy(_p.invert().multiply(q));
    b.updateMatrixWorld(true);
  }
  // the whole body tipped about the hips (and moved): q a quaternion in the model frame, dy/dz added to the hips
  body(q, dx = 0, dy = 0, dz = 0) {
    const r = this.b('root');
    const piv = this.pos('hips', new THREE.Vector3());
    r.getWorldQuaternion(_q); _q.premultiply(q);
    const rel = new THREE.Vector3().copy(r.position).sub(piv).applyQuaternion(q);
    r.quaternion.copy(_q);
    r.position.copy(piv).add(rel).add(_w.set(dx, dy, dz));
    r.updateMatrixWorld(true);
    return this;
  }
  // put the hips at a height (and z), keeping the body's turn
  hipsAt(y, z) {
    const r = this.b('root'), h = this.pos('hips', new THREE.Vector3());
    r.position.y += y - h.y; if (z !== undefined) r.position.z += z - h.z;
    r.updateMatrixWorld(true);
    return this;
  }
  // a hand or foot onto a point (model frame) with the elbow or knee toward pole
  reach(chain, target, pole) {
    const [a, b, c] = { armL: ['uaL', 'faL', 'haL'], armR: ['uaR', 'faR', 'haR'], legL: ['thL', 'caL', 'ftL'], legR: ['thR', 'caR', 'ftR'] }[chain];
    const A = this.b(a), B = this.b(b), C = this.b(c);
    const pa = this.pos(a, new THREE.Vector3()), pb = this.pos(b, new THREE.Vector3()), pc = this.pos(c, new THREE.Vector3());
    const la = pa.distanceTo(pb), lb = pb.distanceTo(pc);
    const d = Math.min(la + lb - 1e-3, Math.max(Math.abs(la - lb) + 1e-3, pa.distanceTo(target)));
    const dir = target.clone().sub(pa).normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d), ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const pn = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const mid = pa.clone().addScaledVector(dir, Math.cos(ang) * la).addScaledVector(pn, Math.sin(ang) * la);
    this.aim(A, pb, mid);
    const pb2 = this.pos(b, new THREE.Vector3()), pc2 = this.pos(c, new THREE.Vector3());
    this.aim(B, pc2, pa.clone().addScaledVector(dir, d));
    void pb2;
    return this;
  }
  aim(bone, from, to) {
    bone.updateWorldMatrix(true, false);
    const o = _u.setFromMatrixPosition(bone.matrixWorld);
    const f = from.clone().sub(o).normalize(), t = to.clone().sub(o).normalize();
    bone.getWorldQuaternion(_q); _q.premultiply(_p.setFromUnitVectors(f, t));
    this.setWorldQ(bone, _q);
  }
  // fingers curled into a fist (amount 0..1), the index left out for pointing
  curl(side, amount, keepIndex) {
    const hand = this.b(side === 'L' ? 'haL' : 'haR');
    const f1 = this.pos('Bip01_' + side + '_Finger1'), f4 = this.pos('Bip01_' + side + '_Finger4'), hp = this.pos(side === 'L' ? 'haL' : 'haR');
    const axis = f4.clone().sub(f1).normalize();
    void hand;
    for (const f of ['1', '2', '3', '4', '0']) {
      if (keepIndex && f === '1') continue;
      const amt = (f === '0' ? 0.45 : 1) * amount;
      for (const k of ['', '1', '2']) {
        const n = 'Bip01_' + side + '_Finger' + f + k, b = this.by[n]; if (!b) continue;
        // which way curls: the one that brings the finger's tip nearer the wrist
        const tipN = 'Bip01_' + side + '_Finger' + f + '2';
        const deg = (k === '' ? 55 : k === '1' ? 75 : 55) * amt;
        const save = b.quaternion.clone();
        this.rot(n, axis, deg); const d1 = this.pos(tipN).distanceTo(hp);
        b.quaternion.copy(save); b.updateMatrixWorld(true);
        this.rot(n, axis, -deg); const d2 = this.pos(tipN).distanceTo(hp);
        if (d1 < d2) { b.quaternion.copy(save); b.updateMatrixWorld(true); this.rot(n, axis, deg); }
      }
    }
    return this;
  }
  snap() {
    const q = new Map();
    for (const n of this.names) q.set(n, this.by[n].quaternion.clone());
    return { q, p: this.by.Bip01.position.clone(), pp: this.by.Bip01_Pelvis.position.clone() };
  }
}

function makeClip(name, keys, names, once) {
  const times = new Float32Array(keys.map(k => k[0]));
  const tracks = [];
  for (const n of names) {
    const v = new Float32Array(keys.length * 4);
    let prev = null;
    keys.forEach(([, s], i) => {
      const q = s.q.get(n).clone();
      if (prev && prev.dot(q) < 0) { q.x *= -1; q.y *= -1; q.z *= -1; q.w *= -1; }
      v.set([q.x, q.y, q.z, q.w], i * 4); prev = q;
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(n + '.quaternion', times, v));
  }
  const pv = new Float32Array(keys.length * 3), ppv = new Float32Array(keys.length * 3);
  keys.forEach(([, s], i) => { pv.set([s.p.x, s.p.y, s.p.z], i * 3); ppv.set([s.pp.x, s.pp.y, s.pp.z], i * 3); });
  tracks.push(new THREE.VectorKeyframeTrack('Bip01.position', times, pv));
  tracks.push(new THREE.VectorKeyframeTrack('Bip01_Pelvis.position', times, ppv));
  const c = new THREE.AnimationClip(name, keys[keys.length - 1][0], tracks);
  c.userData = { once: !!once, made: true };
  return c;
}

const qx = d => new THREE.Quaternion().setFromAxisAngle(X, d * Math.PI / 180);
const qy = d => new THREE.Quaternion().setFromAxisAngle(Y, d * Math.PI / 180);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// sample a captured clip into keys (from t0 to t1 every dt), shifted to start at `at`
function sample(R, name, t0, t1, dt, at) {
  const out = [];
  for (let t = t0; t <= t1 + 1e-6; t += dt) { R.from(name, t); out.push([at + (t - t0), R.snap()]); }
  return out;
}

export function buildPoses(People, bases, clips) {
  for (const sex of ['m', 'f']) {
    const base = [...bases.values()].find(b => b.meta.sex === sex && !b.meta.kid);
    if (!base) continue;
    const R = new PoseRig(People, base, clips, sex);
    const add = (name, keys, once) => { const c = makeClip(name + '.' + sex, keys, R.names, once); clips.set(c.name, c); };
    const S = sex;
    try {
      // ---- driving: seated, leaning back a little, hands at ten to two, feet forward on the pedals
      const drive = (t, look = 0) => {
        R.from('sit', 0.5);
        R.rot('spine', 'x', -7).rot('neck', 'x', 4);
        const ch = R.pos('chest'), hp = R.pos('hips');
        R.rot('head', 'y', look);
        R.reach('armL', V(ch.x + 0.2, ch.y - 0.12, ch.z + 0.44), V(0.6, -1, 0)).reach('armR', V(ch.x - 0.2, ch.y - 0.12, ch.z + 0.44), V(-0.6, -1, 0));
        R.reach('legL', V(hp.x + 0.15, hp.y - 0.36, hp.z + 0.66), V(0.2, 0.6, 1)).reach('legR', V(hp.x - 0.13, hp.y - 0.36, hp.z + 0.68), V(-0.2, 0.6, 1));
        // the fingers round the wheel's rim (they were held out flat, as if pushing on a window)
        R.curl('L', 0.7).curl('R', 0.7);
        return [t, R.snap()];
      };
      add('drive', [drive(0), drive(1.5, 6), drive(3, 0), drive(4.2, -8), drive(6, 0)]);
      // ---- a fist shaken at someone, the other hand on the hip
      const fist = (t, up) => {
        R.from('angry', 0.2);
        R.rot('spine', 'x', 6).rot('neck', 'x', 4);
        const sh = R.pos('uaR');
        R.reach('armR', V(sh.x - 0.14, sh.y + up, sh.z + 0.42 + up * 0.25), V(-0.5, -1, -0.1)).curl('R', 1);
        const hp = R.pos('hips');
        R.reach('armL', V(hp.x + 0.2, hp.y + 0.08, hp.z + 0.03), V(1, 0, -0.6)).curl('L', 0.6);
        return [t, R.snap()];
      };
      add('fist', [fist(0, 0.02), fist(0.16, 0.16), fist(0.32, 0.02), fist(0.48, 0.16), fist(0.64, 0.02), fist(0.8, 0.16), fist(1.1, 0.06)]);
      // ---- pointing at someone (right arm out straight, index out)
      const point = (t, k) => {
        R.from('idle', 0.5);
        const sh = R.pos('uaR');
        R.rot('chest', 'y', -8 * k);
        R.reach('armR', V(sh.x - 0.08, sh.y + 0.02 * k - 0.25 * (1 - k), sh.z + 0.6 * k + 0.25 * (1 - k)), V(-0.4, -1, 0)).curl('R', k, true);
        return [t, R.snap()];
      };
      add('point', [point(0, 0), point(0.3, 1), point(1.4, 1), point(1.5, 0.92), point(1.6, 1), point(2.3, 1), point(2.7, 0)], true);
      // ---- arms crossed
      const cross = (t, sway) => {
        R.from('idle', 0.3 + t);
        const ch = R.pos('chest');
        R.reach('armL', V(ch.x - 0.06, ch.y - 0.21, ch.z + 0.2), V(1, -0.8, 0.1)).reach('armR', V(ch.x + 0.06, ch.y - 0.18, ch.z + 0.23), V(-1, -0.8, 0.1)).rot('haL', 'y', -60).rot('haR', 'y', 60);
        R.rot('head', 'y', sway);
        return [t, R.snap()];
      };
      add('cross_arms', [cross(0, 0), cross(2, 5), cross(4, -3), cross(6, 0)]);
      // ---- a jump: down, up, the knees in the air, landing
      const jump = (t, k) => {
        R.from('idle', 0.4);
        const fl = R.pos('ftL'), fr = R.pos('ftR');
        const hp = R.pos('hips');
        if (k.down) { R.hipsAt(hp.y - k.down); R.rot('spine', 'x', k.lean || 0); }
        if (k.arms) { R.rot('uaL', 'x', k.arms); R.rot('uaR', 'x', k.arms); }
        const lift = k.lift || 0, back = k.back || 0;
        R.reach('legL', V(fl.x, fl.y + lift, fl.z - back), V(0, 0, 1)).reach('legR', V(fr.x, fr.y + lift, fr.z - back), V(0, 0, 1));
        return [t, R.snap()];
      };
      add('jump', [jump(0, {}), jump(0.14, { down: 0.16, lean: 14, arms: 30 }), jump(0.28, { down: -0.03, arms: -70, lift: -0.04 }), jump(0.5, { down: -0.02, arms: -45, lift: 0.26, back: 0.08 }),
        jump(0.72, { down: 0.02, arms: -20, lift: 0.08 }), jump(0.82, { down: 0.14, lean: 10, arms: 10 }), jump(1.05, {})], true);
      // ---- a stumble: tripped, arms out, caught by a step
      const stum = (t, lean, arms) => { R.from('walk', 0.2 + t * 0.8); R.body(qx(lean)); R.rot('uaL', 'z', arms).rot('uaR', 'z', -arms).rot('uaL', 'x', -arms * 0.6).rot('uaR', 'x', -arms * 0.6); return [t, R.snap()]; };
      add('stumble', [stum(0, 0, 0), stum(0.25, 22, 40), stum(0.55, 30, 55), stum(0.85, 12, 25), stum(1.2, 0, 0)], true);
      // ---- lying down (face up: the head toward the person's back, so getting up faces the feet' way)
      const lieBack = (t, h) => { R.from('idle', 0.5); R.body(qx(-90)); R.hipsAt(0.12, 0); R.rot('uaL', 'z', 12).rot('uaR', 'z', -12).rot('head', 'y', h); return [t, R.snap()]; };
      const lieFront = (t, h) => {
        R.from('idle', 0.5); R.body(qx(90)); R.hipsAt(0.13, 0);
        const sl = R.pos('uaL'), sr = R.pos('uaR');
        R.reach('armL', V(sl.x + 0.22, 0.06, sl.z + 0.05), V(1, 0.3, -0.5)).reach('armR', V(sr.x - 0.22, 0.06, sr.z + 0.05), V(-1, 0.3, -0.5)).rot('head', 'y', h);
        return [t, R.snap()];
      };
      add('lie_back', [lieBack(0, 0), lieBack(3, 10), lieBack(6, 0)]);
      add('lie_front', [lieFront(0, 15), lieFront(3, 18), lieFront(6, 15)]);
      // ---- getting up from the back: sit up, hands behind, knees up, over the feet into a squat, then up (the
      // captured crouch_out)
      const sitUp = (t, k) => {
        R.from('sit', 0.5);
        R.body(qx(-35 * (1 - k) - 12));
        R.hipsAt(0.13, 0);
        const hp = R.pos('hips');
        R.reach('legL', V(hp.x + 0.16, 0.08, hp.z + 0.62 - 0.25 * k), V(0.3, 1, 0.4)).reach('legR', V(hp.x - 0.16, 0.08, hp.z + 0.6 - 0.25 * k), V(-0.3, 1, 0.4));
        R.reach('armL', V(hp.x + 0.3, 0.04, hp.z - 0.22 + 0.1 * k), V(1, 0, -1)).reach('armR', V(hp.x - 0.3, 0.04, hp.z - 0.2 + 0.1 * k), V(-1, 0, -1));
        return [t, R.snap()];
      };
      const crouchAt = (t, ct) => { R.from('crouch_out', ct); return [t, R.snap()]; };
      const cOut = R.clip('crouch_out');
      const stand = cOut ? Math.min(2.6, cOut.duration) : 2.4;
      add('getup_back', [lieBack(0, 0), sitUp(0.55, 0), sitUp(0.95, 1), crouchAt(1.45, 0), ...sample(R, 'crouch_out', 0.25, stand, 0.25, 1.7)], true);
      // ---- getting up from the front: push up, onto the knees, one foot forward, up
      const pushUp = (t, k) => {
        R.from('idle', 0.5);
        R.body(qx(90 - 55 * k)); R.hipsAt(0.14 + 0.02 * k, 0);
        const sl = R.pos('uaL'), sr = R.pos('uaR'), hp = R.pos('hips');
        R.reach('armL', V(sl.x + 0.05, 0.04, sl.z), V(1, 0, -1)).reach('armR', V(sr.x - 0.05, 0.04, sr.z), V(-1, 0, -1));
        R.reach('legL', V(hp.x + 0.12, 0.08, hp.z - 0.85), V(0, -1, 0)).reach('legR', V(hp.x - 0.12, 0.08, hp.z - 0.85), V(0, -1, 0));
        return [t, R.snap()];
      };
      const kneel = (t, up, oneFoot) => {
        R.from('idle', 0.5);
        R.body(qx(75 - 50 * up)); R.hipsAt(0.55 + 0.1 * up, 0);
        const hp = R.pos('hips'), sl = R.pos('uaL'), sr = R.pos('uaR');
        const hz = up > 0.5 ? null : 0.04;
        if (hz !== null) R.reach('armL', V(sl.x + 0.03, hz, sl.z + 0.05), V(1, 0, -1)).reach('armR', V(sr.x - 0.03, hz, sr.z + 0.05), V(-1, 0, -1));
        else { R.reach('armL', V(hp.x + 0.15, hp.y + 0.05, hp.z + 0.42), V(1, -0.5, -0.5)); R.reach('armR', V(hp.x - 0.15, hp.y + 0.05, hp.z + 0.4), V(-1, -0.5, -0.5)); }
        // knees on the ground under the hips, shins back along it
        R.reach('legR', V(hp.x - 0.13, 0.1, hp.z - 0.45), V(0, -0.2, 1));
        if (oneFoot) R.reach('legL', V(hp.x + 0.16, 0.08, hp.z + 0.45), V(0, 0.3, 1)); else R.reach('legL', V(hp.x + 0.13, 0.1, hp.z - 0.45), V(0, -0.2, 1));
        return [t, R.snap()];
      };
      add('getup_front', [lieFront(0, 15), pushUp(0.45, 1), kneel(0.95, 0, false), kneel(1.4, 0.6, true), crouchAt(1.85, 0.75), ...sample(R, 'crouch_out', 1.0, stand, 0.25, 2.1)], true);
      // ---- into and out of a car seat from its left or right: turn the back to the seat, sit, legs in
      const seatSide = side => {
        const s = side === 'L' ? 1 : -1;
        const k = [];
        // standing beside the seat facing out of the car (the car's forward is the person's +x for a left door
        // when they face out... the clips are in the seated person's frame: forward is the car's forward)
        R.from('idle', 0.4); R.body(qy(90 * s)); k.push([0, R.snap()]);
        R.from('idle', 0.4); R.body(qy(90 * s)); R.hipsAt(R.pos('hips').y - 0.12); R.rot('spine', 'x', 10); k.push([0.5, R.snap()]);
        // sitting on the edge, legs still out
        R.from('sit', 0.5); R.body(qy(80 * s)); k.push([1.0, R.snap()]);
        R.from('sit', 0.5); R.body(qy(40 * s)); R.rot('thL', 'x', -15).rot('thR', 'x', -15); k.push([1.45, R.snap()]);
        k.push(drive(1.9));
        return k;
      };
      add('enter_L', seatSide('L'), true);
      add('enter_R', seatSide('R'), true);
      add('exit_L', seatSide('L').reverse().map(([t, s], i, a) => [a[0][0] - t, s]), true);
      add('exit_R', seatSide('R').reverse().map(([t, s], i, a) => [a[0][0] - t, s]), true);
      // ---- pulled out by the arm: jerked sideways out of the seat, stumbling to stand
      const pulled = side => {
        const s = side === 'L' ? 1 : -1, k = [];
        k.push(drive(0));
        R.from('sit', 0.5); R.body(qy(60 * s)); R.rot('spine', 'z', -20 * s); R.rot(side === 'L' ? 'uaL' : 'uaR', 'z', 60 * s); k.push([0.3, R.snap()]);
        R.from('stumble' + '', 0.2); k.push([0.7, R.snap()]);
        R.from('walk', 0.4); R.body(qx(18).multiply(qy(90 * s))); R.rot('uaL', 'z', 30).rot('uaR', 'z', -30); k.push([1.1, R.snap()]);
        R.from('idle', 0.3); R.body(qy(90 * s)); k.push([1.7, R.snap()]);
        return k;
      };
      add('pulled_out', pulled('L'), true);
      add('pulled_out_R', pulled('R'), true);
    } catch (e) { console.warn('poses ' + S, e); }
    R.mixer.stopAllAction();
  }
}
