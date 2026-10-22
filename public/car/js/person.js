// One person: a rigged human (a Rocketbox avatar from people.js), its animation mixer, a two-bone reach for hands
// and feet, a head that turns to look at things, and a cheap ragdoll (verlet particles on the main joints) that
// takes over the skeleton when a car throws the person. See people.js for the contract.
import * as THREE from 'three';

// friendly bone names -> the Biped skeleton's (three's node names: spaces become underscores)
export const BONES = {
  root: 'Bip01', hips: 'Bip01_Pelvis', spine: 'Bip01_Spine', spine1: 'Bip01_Spine1', chest: 'Bip01_Spine2', neck: 'Bip01_Neck', head: 'Bip01_Head', jaw: 'Bip01_MJaw',
  clavicleL: 'Bip01_L_Clavicle', upperArmL: 'Bip01_L_UpperArm', forearmL: 'Bip01_L_Forearm', handL: 'Bip01_L_Hand',
  clavicleR: 'Bip01_R_Clavicle', upperArmR: 'Bip01_R_UpperArm', forearmR: 'Bip01_R_Forearm', handR: 'Bip01_R_Hand',
  thighL: 'Bip01_L_Thigh', calfL: 'Bip01_L_Calf', footL: 'Bip01_L_Foot', toeL: 'Bip01_L_Toe0',
  thighR: 'Bip01_R_Thigh', calfR: 'Bip01_R_Calf', footR: 'Bip01_R_Foot', toeR: 'Bip01_R_Toe0',
  eyeL: 'Bip01_LEye', eyeR: 'Bip01_REye', blinkTopL: 'Bip01_LEyeBlinkTop', blinkTopR: 'Bip01_REyeBlinkTop', blinkBottomL: 'Bip01_LEyeBlinkBottom', blinkBottomR: 'Bip01_REyeBlinkBottom'
};
const FINGERS = []; for (const s of ['L', 'R']) for (const f of ['0', '1', '2', '3', '4']) for (const k of ['', '1', '2']) FINGERS.push('Bip01_' + s + '_Finger' + f + k);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _s1 = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(), _t4 = new THREE.Vector3(), _t5 = new THREE.Vector3(), _t6 = new THREE.Vector3();
const _q4 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

let PID = 0;

export class Person {
  // lib: the People library object; base: a loaded model { id, scene, meta }; look: plain JSON
  constructor(lib, look, opts = {}) {
    this.lib = lib; this.id = ++PID;
    this.opts = opts;
    this.look = { ...look };
    this.kid = !!(opts.kid ?? look.kid);
    this.object = new THREE.Group(); this.object.name = 'person';
    this.object.userData.person = this;
    // the model faces +z: turned to face -z, as the game's cars do
    this.inner = new THREE.Group(); this.inner.rotation.y = Math.PI; this.object.add(this.inner);
    this.height = 1.75;
    this.mixer = null; this.actions = new Map(); this.current = null; this.currentName = null;
    this.isRagdoll = false; this.rag = null; this.blend = null;
    this.ik = { handL: null, handR: null, footL: null, footR: null }; this.ikLocal = false;
    this.lookTarget = null; this.lookW = 0; this._lookQ = [new THREE.Quaternion(), new THREE.Quaternion()];
    this.lodLevel = -1; this.lod = opts.lod ?? 'auto'; this.visibleDist = opts.far ?? 140;
    this.skip = 0; this.acc = 0; this.frame = (Math.random() * 8) | 0;
    this.speedScale = 1; this.seated = false; this.blinkT = Math.random() * 4;
    this.shadow = opts.shadow !== false;
    this.pending = null;
    this.setLook(look, true);
  }

  // ---- model ---------------------------------------------------------------------------------------------------
  setLook(look, first) {
    look = this.lib.fixLook({ ...this.look, ...look, kid: look.kid ?? this.kid });
    this.look = look; this.kid = !!look.kid;
    const base = this.lib.baseFor(look);
    const ready = this.lib.loaded(base);
    if (ready) this._attach(ready, look);
    else {
      // a stand-in already loaded until the right one arrives (the same kind of person if there is one)
      const sub = this.model ? null : this.lib.standIn(look);
      if (sub) this._attach(sub, look, true);
      const want = this.pending = base;
      this.lib.loadBase(base).then(b => { if (this.pending === want && !this.disposed) { this.pending = null; this._attach(b, this.look); } }).catch(e => console.warn('person model', base, e));
    }
    return this;
  }

  _attach(base, look, standIn) {
    const wasName = this.currentName, wasOpts = this.currentOpts;
    const keepT = this.current ? this.current.time : 0;
    if (this.model) { this.inner.remove(this.model.root); if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model.root); } }
    const m = this.lib.instance(base, look);
    this.model = m; this.base = base; this.standIn = !!standIn;
    this.inner.add(m.root);
    this.bones = m.bones;
    this.boneByName = m.byName;
    // size: the model's own height scaled to the look's
    const h0 = base.meta.h || 1.75;
    const want = look.heightM || h0 * (look.height || 1);
    const s = want / h0;
    this.inner.scale.setScalar(s);
    this.height = want;
    this.hipScale = base.hipScale || 1;
    this.mixer = new THREE.AnimationMixer(m.root);
    this.mixer.addEventListener('finished', e => this._finished(e));
    this.actions.clear(); this.current = null;
    this.lodLevel = -1;
    this.lib.applyBuild(this, look.build || 0);
    if (this.isRagdoll && this.rag) this.rag.rebind(this);
    else this.play(wasName || (this.seated ? 'sit' : 'idle'), { ...(wasOpts || {}), fade: 0, startAt: keepT });
    this._setLod(this.lod === 'auto' ? 0 : this.lod === 'far' ? 1 : 0);
  }

  bone(name) { return this.boneByName ? (this.boneByName[BONES[name] || name] || null) : null; }

  // world position of a bone (out: a Vector3)
  bonePos(name, out = new THREE.Vector3()) { const b = this.bone(name); if (!b) return out.copy(this.object.position); b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); }

  // ---- animation -----------------------------------------------------------------------------------------------
  // name: one of People.anims; opts: { loop (default by clip), fade (s, 0.25), speed (1), once, onEnd, startAt }
  play(name, opts = {}) {
    if (!this.mixer) return null;
    const clip = this.lib.clipFor(name, this);
    if (!clip) { console.warn('no animation', name); return null; }
    if (this.isRagdoll && !opts.force) { this.queued = [name, opts]; return null; }
    let a = this.actions.get(clip);
    if (!a) { a = this.mixer.clipAction(clip); this.actions.set(clip, a); }
    const once = opts.once ?? (opts.loop === false ? true : !!clip.userData.once);
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = (opts.speed ?? 1);
    const fade = opts.fade ?? 0.25;
    const prev = this.current;
    if (prev === a && !opts.restart) { a.timeScale = opts.speed ?? 1; this.currentOpts = opts; this.onEnd = opts.onEnd || null; return a; }
    a.reset();
    if (opts.startAt) a.time = once ? Math.min(opts.startAt, clip.duration) : opts.startAt % clip.duration;
    else if (!once && opts.random !== false && opts.startAt === undefined && (name === 'idle' || name === 'walk' || name === 'sit' || name === 'wait' || name === 'phone')) a.time = Math.random() * clip.duration;
    a.enabled = true; a.setEffectiveWeight(1);
    a.play();
    if (prev && fade > 0) { prev.crossFadeTo(a, fade, false); }
    else if (prev) prev.stop();
    this.current = a; this.currentName = name; this.currentOpts = opts;
    this.onEnd = opts.onEnd || null;
    return a;
  }

  _finished(e) {
    if (e.action !== this.current) return;
    const f = this.onEnd; this.onEnd = null;
    if (f) f(this);
    else if (this.currentOpts && this.currentOpts.then) this.play(this.currentOpts.then);
  }

  setSeated(on) {
    this.seated = !!on;
    if (on) { if (!/^(sit|drive|enter|exit)/.test(this.currentName || '')) this.play('sit', { fade: 0 }); }
    else if (/^(sit|drive)/.test(this.currentName || '')) this.play('idle');
    return this;
  }

  lookAt(p) { this.lookTarget = p ? (this.lookTarget || new THREE.Vector3()).copy(p) : null; return this; }

  // ---- per frame -----------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.model || this.disposed) return;
    this.frame++;
    // level of detail by the camera's distance
    const cam = this.lib.camera;
    let d = 10;
    if (cam && (this.frame & 7) === 0 || this.camD === undefined) {
      if (cam) { this.object.getWorldPosition(_v1); d = this.camD = _v1.distanceTo(cam.position); }
      if (this.lod === 'auto') {
        const near = this.lib.nearDist || 22;
        const lv = this.camD > this.visibleDist ? 2 : this.camD > near + (this.lodLevel === 1 ? -2 : 2) ? 1 : 0;
        if (lv !== this.lodLevel) this._setLod(lv);
      }
    }
    if (this.lodLevel === 2 && !this.isRagdoll) return;
    if (this.isRagdoll) { this.rag.step(dt, this); this.rag.pose(this); return; }
    // far people are animated less often
    this.acc += dt;
    const every = this.lodLevel === 1 ? (this.camD > 80 ? 5 : this.camD > 45 ? 3 : 2) : 1;
    if ((this.frame % every) !== 0 && !this.blend) return;
    const t = this.acc; this.acc = 0;
    this.mixer.update(t);
    this._post(t);
  }

  // what follows the clips each frame: the hips' height for the model's size, a blend from a captured pose,
  // the reaches, the head's turn, the blink
  _post(dt) {
    const root = this.bones.root;
    if (this.hipScale !== 1 && root) root.position.multiplyScalar(this.hipScale);
    if (this.blend) {
      const B = this.blend; B.t += dt;
      const w = Math.min(1, B.t / B.dur), k = 1 - (w * w * (3 - 2 * w));
      if (k > 0.001) for (let i = 0; i < B.bones.length; i++) { const b = B.bones[i]; b.quaternion.slerp(B.q[i], k); if (B.p[i]) b.position.lerp(B.p[i], k); }
      if (w >= 1) this.blend = null;
    }
    if (this.ik.handL || this.ik.handR || this.ik.footL || this.ik.footR) this._ik();
    if (this.lookTarget || this.lookW > 0.01) this._look(dt);
    if (this.lodLevel === 0) {
      this._blink(dt);
      if (this.talkT > 0) this._talk(dt);
    }
  }

  // the mouth moving for a few seconds (shouting, talking): talk(seconds)
  talk(sec = 2) { this.talkT = sec; return this; }
  _talk(dt) {
    this.talkT -= dt; this.talkPh = (this.talkPh || 0) + dt;
    const jaw = this.bone('jaw'), head = this.bone('head'), lip = this.boneByName.Bip01_MBottomLip;
    if (!jaw || !head) return;
    head.updateMatrixWorld(true);
    const ax = _t1.set(1, 0, 0).transformDirection(this.object.matrixWorld);
    // which way opens: the one that takes the lower lip down (found once)
    if (this.jawSign === undefined) {
      const y0 = lip ? lip.getWorldPosition(_t2).y : 0;
      jaw.getWorldQuaternion(_q2); _q2.premultiply(_q1.setFromAxisAngle(ax, 0.2)); jaw.parent.getWorldQuaternion(_q3); const save = jaw.quaternion.clone();
      jaw.quaternion.copy(_q3.invert().multiply(_q2)); jaw.updateMatrixWorld(true);
      const y1 = lip ? lip.getWorldPosition(_t2).y : y0 - 1;
      jaw.quaternion.copy(save); jaw.updateMatrixWorld(true);
      this.jawSign = y1 < y0 ? 1 : -1;
    }
    const a = this.jawSign * 0.16 * Math.max(0, Math.sin(this.talkPh * 11)) * Math.min(1, this.talkT * 3);
    jaw.getWorldQuaternion(_q2); _q2.premultiply(_q1.setFromAxisAngle(ax, a));
    jaw.parent.getWorldQuaternion(_q3);
    jaw.quaternion.copy(_q3.invert().multiply(_q2));
  }

  _setLod(l) {
    this.lodLevel = l;
    const m = this.model; if (!m) return;
    for (const o of m.lod0) { o.visible = l === 0; o.castShadow = l === 0 && this.shadow; }
    for (const o of m.lod1) { o.visible = l === 1 || (l === 0 && m.lod0.length === 0); o.castShadow = false; }
    if (l === 2) for (const o of [...m.lod0, ...m.lod1]) o.visible = false;
  }
  setLod(l) { this.lod = l; this._setLod(l === 'far' ? 1 : l === 'hidden' ? 2 : 0); return this; }

  // ---- reaching (two-bone IK) -----------------------------------------------------------------------------------
  // targets are world points (Vector3) or null; set person.ik.handL = v etc.
  _ik() {
    this.object.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const th = this.ik['hand' + side]; if (th) this._twoBone('upperArm' + side, 'forearm' + side, 'hand' + side, th, side === 'L' ? -1 : 1, true);
      const tf = this.ik['foot' + side]; if (tf) this._twoBone('thigh' + side, 'calf' + side, 'foot' + side, tf, side === 'L' ? -1 : 1, false);
    }
  }
  _twoBone(an, bn, cn, target, side, arm) {
    const A = this.bone(an), B = this.bone(bn), C = this.bone(cn);
    if (!A || !B || !C) return;
    const a = _t1.setFromMatrixPosition(A.matrixWorld), b = _v2.setFromMatrixPosition(B.matrixWorld), c = _v3.setFromMatrixPosition(C.matrixWorld);
    const la = a.distanceTo(b), lb = b.distanceTo(c);
    const d = Math.min(la + lb - 1e-3, Math.max(Math.abs(la - lb) + 1e-3, a.distanceTo(target)));
    // the bend: elbows out and down, knees forward (in the person's frame)
    const pole = arm ? _s1.set(side * 0.6, -1, 0.35).transformDirection(this.object.matrixWorld) : _s1.set(0, 0, -1).transformDirection(this.object.matrixWorld);
    const dir = _t2.copy(target).sub(a).normalize();
    // elbow/knee position by the law of cosines
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d), ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const pn = _t3.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const mid = _t4.copy(a).addScaledVector(dir, Math.cos(ang) * la).addScaledVector(pn, Math.sin(ang) * la);
    this._aim(A, b, mid);
    A.updateMatrixWorld(true);
    _v3.setFromMatrixPosition(C.matrixWorld);
    const end = _t4.copy(a).addScaledVector(dir, d);
    this._aim(B, _v3, end);
    B.updateMatrixWorld(true);
  }
  // turn a bone (about its own origin) so that the point `from` (now on its chain) lands on the direction of `to`
  _aim(bone, from, to) {
    const o = _v5.setFromMatrixPosition(bone.matrixWorld);
    const f = _t5.copy(from).sub(o), tt = _t6.copy(to).sub(o);
    if (f.lengthSq() < 1e-10 || tt.lengthSq() < 1e-10) return;
    f.normalize(); tt.normalize();
    const dq = _q1.setFromUnitVectors(f, tt);
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(dq);
    bone.parent.getWorldQuaternion(_q3);
    bone.quaternion.copy(_q3.invert().multiply(_q2));
  }

  // ---- looking -------------------------------------------------------------------------------------------------
  _look(dt) {
    const head = this.bone('head'), neck = this.bone('neck');
    if (!head || !neck) return;
    this.lookW += ((this.lookTarget ? 1 : 0) - this.lookW) * Math.min(1, dt * 4);
    if (!this.lookTarget) return;
    this.object.updateMatrixWorld(true);
    const hp = _v1.setFromMatrixPosition(head.matrixWorld);
    const want = _v2.copy(this.lookTarget).sub(hp).normalize();
    // the body's forward and the wanted direction in the body's frame: yaw and pitch, limited
    const inv = _q1.copy(this.object.quaternion).invert();
    want.applyQuaternion(inv);
    let yaw = Math.atan2(-want.x, -want.z), pitch = Math.asin(Math.max(-1, Math.min(1, want.y)));
    yaw = Math.max(-1.2, Math.min(1.2, yaw)) * this.lookW; pitch = Math.max(-0.5, Math.min(0.5, pitch)) * this.lookW;
    // turn neck then head in world space about world up and the body's side axis
    const side = _v3.set(1, 0, 0).applyQuaternion(this.object.quaternion);
    _q2.setFromAxisAngle(UP, yaw * 0.45).multiply(_q3.setFromAxisAngle(side, pitch * 0.4));
    for (const [b, k] of [[neck, 1], [head, 1.25]]) {
      b.getWorldQuaternion(_q1);
      const q = k === 1 ? _q2 : _q3.setFromAxisAngle(UP, yaw * 0.55).multiply(_q4.setFromAxisAngle(side, pitch * 0.6));
      _q1.premultiply(q);
      b.parent.getWorldQuaternion(this._lookQ[0]);
      b.quaternion.copy(this._lookQ[0].invert().multiply(_q1));
      b.updateMatrixWorld(true);
    }
  }

  // eyelids: a blink every few seconds (the face bones)
  _blink(dt) {
    this.blinkT -= dt;
    const t = this.blinkT;
    if (t > 0.16) return;
    const k = t > 0 ? Math.sin((0.16 - t) / 0.16 * Math.PI) : 0;
    if (t <= 0) this.blinkT = 2 + Math.random() * 4;
    const top = this.base.blink;
    if (!top) return;
    for (const [n, off] of top) { const b = this.boneByName[n]; if (b) b.position.addScaledVector(off, k); }
  }

  // ---- ragdoll -------------------------------------------------------------------------------------------------
  // velocity: world m/s given to the body (the legs take more of it than the head when hit low); spin: rad/s
  ragdoll(velocity, spin, opts = {}) {
    if (!this.model) return this;
    if (!this.rag) this.rag = new Ragdoll();
    this.object.updateMatrixWorld(true);
    this.rag.start(this, velocity || new THREE.Vector3(), spin || null, opts);
    this.isRagdoll = true; this.blend = null; this.onEnd = null;
    if (this.current) { this.current.stop(); this.current = null; }
    for (const o of [...this.model.lod0, ...this.model.lod1]) o.frustumCulled = false;
    return this;
  }
  // the person comes to rest and gets up (face up or face down decides how), then onDone(person)
  getUp(onDone) {
    if (!this.isRagdoll) { if (onDone) onDone(this); return this; }
    const face = this.rag.faceUp(this);
    this.rag.settleToObject(this, face);
    this.isRagdoll = false;
    for (const o of [...this.model.lod0, ...this.model.lod1]) o.frustumCulled = true;
    this.capture(0.55);
    this.play(face ? 'getup_back' : 'getup_front', { fade: 0, once: true, force: true, onEnd: () => { this.play(this.seated ? 'sit' : 'idle', { fade: 0.3 }); if (onDone) onDone(this); } });
    return this;
  }
  // how long the ragdoll has been still (s); its pelvis world position
  get restTime() { return this.rag && this.isRagdoll ? this.rag.still : 0; }

  // the pose as it is now, blended out over dur seconds into whatever plays next
  capture(dur = 0.4) {
    const bones = this.model.blendBones, q = [], p = [];
    for (const b of bones) { q.push(b.quaternion.clone()); p.push(b === this.bones.root || b === this.bones.hips ? b.position.clone() : null); }
    this.blend = { bones, q, p, t: 0, dur };
  }

  dispose() {
    this.disposed = true;
    if (this.object.parent) this.object.parent.remove(this.object);
    if (this.mixer && this.model) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model.root); }
    this.lib.release(this);
    this.model = null; this.mixer = null;
  }
}

// ---- the ragdoll ------------------------------------------------------------------------------------------------
// Particles on the main joints, kept apart by distance constraints (the torso nearly rigid, limbs as rods, some
// limits so knees and elbows do not fold through the body), the ground, the collision world's walls and posts and
// the cars as boxes. The skeleton follows: each body part's frame from its particles turns its bone.
const P = { pelvis: 0, belly: 1, chest: 2, head: 3, shL: 4, elL: 5, wrL: 6, shR: 7, elR: 8, wrR: 9, hipL: 10, knL: 11, anL: 12, toeL: 13, hipR: 14, knR: 15, anR: 16, toeR: 17 };
const PB = [ // particle -> bone whose world position it starts at
  'hips', 'spine1', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'calfL', 'footL', 'toeL', 'thighR', 'calfR', 'footR', 'toeR'];
const RAD = [0.13, 0.13, 0.12, 0.11, 0.06, 0.05, 0.05, 0.06, 0.05, 0.05, 0.08, 0.06, 0.05, 0.04, 0.08, 0.06, 0.05, 0.04];
// mass share (heavier torso): used to weigh corrections
const MASS = [3, 3, 3, 1.2, 0.8, 0.6, 0.4, 0.8, 0.6, 0.4, 1.5, 1, 0.5, 0.2, 1.5, 1, 0.5, 0.2];
const RIGID = [[0, 1, 10, 14], [1, 2, 4, 7]];
const RODS = [[2, 3], [4, 5], [5, 6], [7, 8], [8, 9], [10, 11], [11, 12], [12, 13], [14, 15], [15, 16], [16, 17]];
// [a, b, min share, max share] of the rest distance
const LIMITS = [[0, 2, 0.75, 1.02], [3, 4, 0.8, 1.25], [3, 7, 0.8, 1.25], [3, 1, 0.85, 1.15], [4, 6, 0.35, 1.0], [7, 9, 0.35, 1.0], [10, 12, 0.45, 1.0], [14, 16, 0.45, 1.0],
  [11, 13, 0.75, 1.15], [15, 17, 0.75, 1.15], [11, 2, 0.6, 1.5], [15, 2, 0.6, 1.5], [11, 15, 0.15, 3.5], [12, 16, 0.1, 4], [6, 0, 0.25, 4], [9, 0, 0.25, 4], [3, 0, 0.8, 1.1]];
// the driven bones and the particle frame that turns each: [bone, primary from, primary to, side from, side to]
const DRIVE = [
  ['root', 0, 1, 10, 14], ['spine', 0, 1, 10, 14], ['spine1', 1, 2, 4, 7], ['chest', 1, 2, 4, 7], ['neck', 2, 3, 4, 7], ['head', 2, 3, 4, 7],
  ['upperArmL', 4, 5, 'bendL'], ['forearmL', 5, 6, 'bendL'], ['upperArmR', 7, 8, 'bendR'], ['forearmR', 8, 9, 'bendR'],
  ['thighL', 10, 11, 'legL'], ['calfL', 11, 12, 'legL'], ['footL', 12, 13, 'legL'], ['thighR', 14, 15, 'legR'], ['calfR', 15, 16, 'legR'], ['footR', 16, 17, 'legR']];

class Ragdoll {
  constructor() {
    const n = PB.length;
    this.x = new Float32Array(n * 3); this.o = new Float32Array(n * 3); this.r = Float32Array.from(RAD); this.w = Float32Array.from(MASS.map(m => 1 / m));
    this.rest = new Map(); this.f0 = []; this.still = 0; this.t = 0; this.acc = 0;
    this.circles = PB.map(() => ({ x: 0, z: 0, r: 0.05, y0: 0, y1: 0 }));
    this._f = DRIVE.map(() => new THREE.Matrix4());
    this.d0 = DRIVE.map(() => new THREE.Quaternion());
    this.order = null;
  }

  start(person, vel, spin, opts) {
    const X = this.x, O = this.o, dt = 1 / 60;
    this.scale = person.inner.scale.x * (person.base.meta.h || 1.75) / 1.75;
    for (let i = 0; i < PB.length; i++) {
      const p = person.bonePos(PB[i], _v1);
      if (i === P.head) { const nk = person.bonePos('neck', _v2); p.add(_v3.copy(p).sub(nk).normalize().multiplyScalar(0.09 * this.scale)); }
      X[i * 3] = p.x; X[i * 3 + 1] = p.y; X[i * 3 + 2] = p.z;
      this.r[i] = RAD[i] * this.scale;
    }
    // start velocity: the given one, more for the legs when the hit is low (a bumper takes the legs from under)
    if (opts.shift) for (let i = 0; i < PB.length; i++) { X[i * 3] += opts.shift.x; X[i * 3 + 1] += opts.shift.y || 0; X[i * 3 + 2] += opts.shift.z; }
    const c = _v2.set(X[0], X[1], X[2]);
    const low = opts.low ?? 0.35;
    for (let i = 0; i < PB.length; i++) {
      const h = X[i * 3 + 1] - c.y; // above (+) or below (-) the hips
      const k = 1 + (h < 0 ? low : -low * 0.6) * Math.min(1, Math.abs(h) / 0.8);
      let vx = vel.x * k, vy = vel.y, vz = vel.z * k;
      if (spin) { const rx = X[i * 3] - c.x, ry = X[i * 3 + 1] - c.y, rz = X[i * 3 + 2] - c.z; vx += spin.y * rz - spin.z * ry; vy += spin.z * rx - spin.x * rz; vz += spin.x * ry - spin.y * rx; }
      O[i * 3] = X[i * 3] - vx * dt; O[i * 3 + 1] = X[i * 3 + 1] - vy * dt; O[i * 3 + 2] = X[i * 3 + 2] - vz * dt;
    }
    // rest lengths from the pose now
    this.cons = [];
    const dist = (a, b) => Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]);
    for (const set of RIGID) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) { const d = dist(set[i], set[j]); this.cons.push([set[i], set[j], d, d, 1]); }
    for (const [a, b] of RODS) { const d = dist(a, b); this.cons.push([a, b, d, d, 1]); }
    // limits from the limb lengths (so a bent start pose does not set them)
    const L = (a, b) => dist(a, b);
    const limb = { 4: L(4, 5) + L(5, 6), 7: L(7, 8) + L(8, 9), 10: L(10, 11) + L(11, 12), 14: L(14, 15) + L(15, 16) };
    for (const [a, b, mn, mx] of LIMITS) {
      let d = dist(a, b);
      if (limb[a] && (b === a + 2)) d = limb[a];
      this.cons.push([a, b, d * mn, d * mx, 0.6]);
    }
    // each driven bone's world rotation against its particle frame now
    person.object.updateMatrixWorld(true);
    this.order = DRIVE.map(([n]) => person.bone(n));
    for (let k = 0; k < DRIVE.length; k++) {
      const b = this.order[k]; if (!b) continue;
      this.frame(k, this._f[k]);
      _q1.setFromRotationMatrix(this._f[k]).invert();
      b.getWorldQuaternion(_q2);
      this.d0[k].copy(_q1).multiply(_q2);
    }
    // the root's position against the pelvis particle, in the pelvis frame
    const root = person.bones.root;
    root.getWorldPosition(_v1);
    _q1.setFromRotationMatrix(this._f[0]).invert();
    this.rootOff = _v1.sub(_v2.set(X[0], X[1], X[2])).applyQuaternion(_q1).clone();
    this.still = 0; this.t = 0; this.acc = 0; this.hitCar = opts.car || null;
    // what it lands on: given, or the drive's (People.env), or a flat floor where the person stood
    const env = person.lib.env || {};
    const y0 = person.object.getWorldPosition(_v1).y;
    this.ground = opts.ground || env.ground || (() => y0);
    this.collide = opts.collide || null;
  }

  rebind(person) { this.order = DRIVE.map(([n]) => person.bone(n)); }

  // the particle frame of driven bone k into m
  frame(k, m) {
    const [, a, b, s0, s1] = DRIVE[k], X = this.x;
    const px = _v3.set(X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]).normalize();
    let sx;
    if (typeof s0 === 'number') sx = _v4.set(X[s1 * 3] - X[s0 * 3], X[s1 * 3 + 1] - X[s0 * 3 + 1], X[s1 * 3 + 2] - X[s0 * 3 + 2]);
    else {
      // limbs: the bend plane's normal, or the body's side if the limb is straight
      const [i, j, l] = s0 === 'bendL' ? [4, 5, 6] : s0 === 'bendR' ? [7, 8, 9] : s0 === 'legL' ? [10, 11, 12] : [14, 15, 16];
      const u = _v4.set(X[j * 3] - X[i * 3], X[j * 3 + 1] - X[i * 3 + 1], X[j * 3 + 2] - X[i * 3 + 2]);
      const v = _v5.set(X[l * 3] - X[j * 3], X[l * 3 + 1] - X[j * 3 + 1], X[l * 3 + 2] - X[j * 3 + 2]);
      sx = u.cross(v);
      if (sx.lengthSq() < 1e-6 * u.lengthSq()) sx.set(X[14 * 3] - X[10 * 3], X[14 * 3 + 1] - X[10 * 3 + 1], X[14 * 3 + 2] - X[10 * 3 + 2]);
      else if (s0 === 'legL' || s0 === 'legR') sx.negate();
    }
    const z = _s1.copy(px).cross(sx).normalize();
    if (z.lengthSq() < 0.5) z.set(0, 0, 1);
    const y = sx.copy(z).cross(px).normalize();
    return m.makeBasis(px, y, z);
  }

  step(dt, person) {
    dt = Math.min(dt, 0.05);
    this.acc += dt; this.t += dt;
    const H = 1 / 90;
    let n = 0, moved = 0;
    // the cars are where this frame put them: earlier steps see them further back along their way
    const steps = Math.min(6, Math.floor(this.acc / H));
    while (this.acc >= H && n < 6) { this.lag = (steps - 1 - n) * H; moved = Math.max(moved, this.sub(H, person)); this.acc -= H; n++; }
    if (n === 6) this.acc = 0;
    this.still = moved < 0.25 * H * 3 && this.t > 0.6 ? this.still + dt : 0;
  }

  sub(h, person) {
    const X = this.x, O = this.o, N = PB.length, g = 9.81 * h * h;
    const env = person.lib.env || {};
    const ground = this.ground;
    let maxv = 0;
    // integrate
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const vx = (X[k] - O[k]) * 0.998, vy = (X[k + 1] - O[k + 1]) * 0.998, vz = (X[k + 2] - O[k + 2]) * 0.998;
      O[k] = X[k]; O[k + 1] = X[k + 1]; O[k + 2] = X[k + 2];
      X[k] += vx; X[k + 1] += vy - g; X[k + 2] += vz;
      const sp = Math.hypot(vx, vy, vz); if (sp > maxv) maxv = sp;
    }
    // constraints
    const C = this.cons, W = this.w;
    for (let it = 0; it < 8; it++) {
      for (let c = 0; c < C.length; c++) {
        const [a, b, mn, mx, st] = C[c];
        const ka = a * 3, kb = b * 3;
        const dx = X[kb] - X[ka], dy = X[kb + 1] - X[ka + 1], dz = X[kb + 2] - X[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const t = d < mn ? mn : d > mx ? mx : d;
        if (t === d) continue;
        const wa = W[a], wb = W[b], s = (d - t) / d / (wa + wb) * st;
        X[ka] += dx * s * wa; X[ka + 1] += dy * s * wa; X[ka + 2] += dz * s * wa;
        X[kb] -= dx * s * wb; X[kb + 1] -= dy * s * wb; X[kb + 2] -= dz * s * wb;
      }
      if (it === 3 || it === 7) this.knees();
    }
    // the cars
    const cars = env.cars ? env.cars() : null;
    if (cars) for (const car of cars) this.carPush(car, h);
    // walls, posts, buildings
    const col = this.collide || env.collide;
    if (col) this.walls(col);
    // the ground: friction where touching
    if (ground) for (let i = 0; i < N; i++) {
      const k = i * 3, r = this.r[i];
      const gy = ground(X[k], X[k + 2], X[k + 1] + 0.5);
      if (gy === null || !Number.isFinite(gy)) continue;
      if (X[k + 1] < gy + r) {
        X[k + 1] = gy + r;
        if (O[k + 1] < X[k + 1] - 0.0001) { const vy = X[k + 1] - O[k + 1]; O[k + 1] = X[k + 1] + Math.max(0, -vy) * 0.15; }
        else O[k + 1] = X[k + 1];
        // sliding friction (about 0.6 g on the road for a sliding body): speed lost per step, not a share
        const vx = X[k] - O[k], vz = X[k + 2] - O[k + 2], vh = Math.hypot(vx, vz), lose = 0.6 * 9.81 * h * h;
        const f = vh > lose ? (vh - lose) / vh : 0;
        O[k] = X[k] - (X[k] - O[k]) * f; O[k + 2] = X[k + 2] - (X[k + 2] - O[k + 2]) * f;
      }
    }
    return maxv;
  }

  // knees bend forward only: a knee behind the line from hip to ankle (as the body faces) is pushed forward
  knees() {
    const X = this.x;
    // body forward from the hips and spine: side x up
    const sx = X[14 * 3] - X[10 * 3], sy = X[14 * 3 + 1] - X[10 * 3 + 1], sz = X[14 * 3 + 2] - X[10 * 3 + 2];
    const ux = X[1 * 3] - X[0], uy = X[1 * 3 + 1] - X[1], uz = X[1 * 3 + 2] - X[2];
    // forward = up x side (the person faces -z with +x their right... the hips' left-to-right is -x to +x)
    let fx = uy * sz - uz * sy, fy = uz * sx - ux * sz, fz = ux * sy - uy * sx;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    for (const [h, kk, a] of [[10, 11, 12], [14, 15, 16]]) {
      const mx = (X[h * 3] + X[a * 3]) / 2, my = (X[h * 3 + 1] + X[a * 3 + 1]) / 2, mz = (X[h * 3 + 2] + X[a * 3 + 2]) / 2;
      // (straight is allowed: only a knee bent backward is pushed back to straight)
      const d = (X[kk * 3] - mx) * fx + (X[kk * 3 + 1] - my) * fy + (X[kk * 3 + 2] - mz) * fz;
      if (d < -0.005) { const p = (-0.005 - d) * 0.5; X[kk * 3] += fx * p; X[kk * 3 + 1] += fy * p; X[kk * 3 + 2] += fz * p; }
      // the thigh does not swing far behind the body
      const tl = Math.hypot(X[kk * 3] - X[h * 3], X[kk * 3 + 1] - X[h * 3 + 1], X[kk * 3 + 2] - X[h * 3 + 2]) || 0.4;
      const dh = (X[kk * 3] - X[h * 3]) * fx + (X[kk * 3 + 1] - X[h * 3 + 1]) * fy + (X[kk * 3 + 2] - X[h * 3 + 2]) * fz;
      if (dh < -0.35 * tl) { const p = (-0.35 * tl - dh) * 0.5; X[kk * 3] += fx * p; X[kk * 3 + 1] += fy * p; X[kk * 3 + 2] += fz * p; }
    }
  }

  // a car as an oriented box: { x, y, z (bottom centre), yaw (rad, heading as the game measures it: 0 north (-z), clockwise), len, wid, hgt, vx, vz }
  carPush(car, h) {
    const X = this.x, O = this.o, N = PB.length;
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    // car axes: forward (s, -c), right (c, s)
    const hl = car.len / 2, hw = car.wid / 2;
    for (let i = 0; i < N; i++) {
      const k = i * 3, r = this.r[i];
      const lag = this.lag || 0;
      const dx = X[k] - (car.x - (car.vx || 0) * lag), dz = X[k + 2] - (car.z - (car.vz || 0) * lag), dy = X[k + 1] - car.y;
      const lf = dx * s - dz * c, lr = dx * c + dz * s;
      // a car's side profile: bonnet, sloping windscreen, roof, rear window, boot (shares of its height)
      const u = lf / hl, H = car.hgt * (car.tall ? 1 : 1);
      const top = car.tall ? H : u > 0.55 ? H * (0.47 + (1 - u) / 0.45 * 0.2) : u > 0.12 ? H * (0.67 + (0.55 - u) / 0.43 * 0.33) : u > -0.5 ? H : H * (0.72 + (u + 1) / 0.5 * 0.28);
      if (Math.abs(lf) > hl + r || Math.abs(lr) > hw + r || dy > top + r || dy < 0.12 - r) continue;
      // smallest way out: up over the top, or out of a side or an end
      const pu = top + r - dy, pf = hl + r - Math.abs(lf), ps = hw + r - Math.abs(lr);
      const cvx = car.vx || 0, cvz = car.vz || 0;
      // (a push moves the old position too: being moved out must not become speed)
      if (pu <= pf && pu <= ps) {
        X[k + 1] += pu; O[k + 1] += pu;
        if (O[k + 1] < X[k + 1]) O[k + 1] = X[k + 1]; // no sinking into the bonnet
        // riding on the car: carried along with some slip
        const vx = X[k] - O[k], vz = X[k + 2] - O[k + 2];
        const tvx = cvx * h, tvz = cvz * h;
        O[k] = X[k] - (vx + (tvx - vx) * 0.06); O[k + 2] = X[k + 2] - (vz + (tvz - vz) * 0.06);
      } else {
        let nx, nz, p;
        if (pf < ps) { const sg = lf > 0 ? 1 : -1; nx = s * sg; nz = -c * sg; p = pf; } else { const sg = lr > 0 ? 1 : -1; nx = c * sg; nz = s * sg; p = ps; }
        X[k] += nx * p; X[k + 2] += nz * p; O[k] += nx * p; O[k + 2] += nz * p;
        // at least the car's speed along the push
        const vn = ((X[k] - O[k]) * nx + (X[k + 2] - O[k + 2]) * nz) / h, cn = cvx * nx + cvz * nz;
        if (vn < cn) { const dv = (cn - vn) * h * 1.05; O[k] -= nx * dv; O[k + 2] -= nz * dv; }
      }
    }
  }

  walls(collide) {
    const X = this.x, O = this.o, N = PB.length, cs = this.circles;
    for (let i = 0; i < N; i++) { const c = cs[i], k = i * 3; c.x = X[k]; c.z = X[k + 2]; c.r = this.r[i]; c.y0 = X[k + 1] - this.r[i]; c.y1 = X[k + 1] + this.r[i]; }
    let hits;
    try { hits = collide.contacts(cs); } catch (e) { return; }
    for (const hh of hits) {
      if (hh.shape && hh.shape.tag === 'person') continue;
      const k = hh.i * 3;
      X[k] += hh.nx * hh.depth; X[k + 2] += hh.nz * hh.depth; O[k] += hh.nx * hh.depth; O[k + 2] += hh.nz * hh.depth;
      // lose most of the speed into the wall
      const vn = (X[k] - O[k]) * hh.nx + (X[k + 2] - O[k + 2]) * hh.nz;
      if (vn < 0) { O[k] += hh.nx * vn * 1.3; O[k + 2] += hh.nz * vn * 1.3; }
      O[k] = X[k] - (X[k] - O[k]) * 0.7; O[k + 2] = X[k + 2] - (X[k + 2] - O[k + 2]) * 0.7;
    }
  }

  // the skeleton from the particles; the person's object follows the pelvis over the ground
  pose(person) {
    const X = this.x, obj = person.object;
    // keep the object under the body (frustum culling, LOD distance, and what others read as where the person is)
    const gy = this.ground ? this.ground(X[0], X[2], X[1]) : null;
    obj.position.set(X[0], Number.isFinite(gy) && gy !== null ? gy : X[1] - 0.9, X[2]);
    obj.updateMatrixWorld(true);
    const bones = this.order, root = person.bones.root;
    for (let k = 0; k < DRIVE.length; k++) {
      const b = bones[k]; if (!b) continue;
      this.frame(k, this._f[k]);
      _q1.setFromRotationMatrix(this._f[k]).multiply(this.d0[k]); // world rotation wanted
      b.parent.updateWorldMatrix(true, false);
      _m1.copy(b.parent.matrixWorld);
      _q2.setFromRotationMatrix(_m2.extractRotation(_m1));
      b.quaternion.copy(_q2.invert().multiply(_q1));
      if (b === root) {
        // the root's position from the pelvis particle
        const off = _v1.copy(this.rootOff).applyQuaternion(_q3.setFromRotationMatrix(this._f[0]));
        off.add(_v2.set(X[0], X[1], X[2]));
        b.position.copy(b.parent.worldToLocal(off));
      }
      b.updateMatrixWorld(true);
    }
  }

  faceUp(person) {
    // the chest's forward: +z of the model is its face; after the flip the person faces -z in its object
    const X = this.x;
    const sx = X[7 * 3] - X[4 * 3], sy = X[7 * 3 + 1] - X[4 * 3 + 1], sz = X[7 * 3 + 2] - X[4 * 3 + 2];
    const ux = X[2 * 3] - X[0], uy = X[2 * 3 + 1] - X[1], uz = X[2 * 3 + 2] - X[2];
    // forward = up x right (right is shR - shL... the shoulders' L is the person's left)
    const fy = uz * sx - ux * sz;
    return fy > 0;
  }

  // the object placed at the body (yaw along it) with the bones' world pose kept, ready to blend into a get-up
  settleToObject(person, faceUp) {
    const X = this.x, obj = person.object;
    // facing: lying face down the get-up clip starts with the head ahead of the person (they push up and stand
    // facing that way); face up it starts with the head behind (they sit up facing their feet)
    const hx = X[3 * 3] - X[0], hz = X[3 * 3 + 2] - X[2];
    const yaw = Math.atan2(-hx, -hz) + (faceUp ? Math.PI : 0);
    // world pose of every bone now
    const bones = person.model.blendBones;
    obj.updateMatrixWorld(true);
    const wq = bones.map(b => b.getWorldQuaternion(new THREE.Quaternion())), wp = bones.map(b => b.getWorldPosition(new THREE.Vector3()));
    const gy = this.ground ? this.ground(X[0], X[2], X[1]) : null;
    obj.position.set(X[0], Number.isFinite(gy) && gy !== null ? gy : obj.position.y, X[2]);
    obj.rotation.set(0, yaw, 0);
    obj.updateMatrixWorld(true);
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      b.parent.updateWorldMatrix(true, false);
      b.parent.getWorldQuaternion(_q1);
      b.quaternion.copy(_q1.invert().multiply(wq[i]));
      if (b === person.bones.root) b.position.copy(b.parent.worldToLocal(wp[i].clone()));
      b.updateMatrixWorld(true);
    }
    this.yaw = yaw;
  }
}
