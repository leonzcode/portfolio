// The rider: a rigged Rocketbox person (MIT) in ski clothes, with skis, bindings, boots, poles, a helmet and goggles
// built here, posed every frame by a small inverse-kinematics solver:
//   - the skis are placed first (stance, edge angle, butter press, the grab or position's tweak), each a rigid frame
//   - the pelvis goes above the boots at the crouch's height, leaning into turns, the chest and head on top
//   - the legs reach the boots (two-bone IK, knees over the skis), the arms reach poles or the grab point on a ski
//     (palm on the edge, fingers round it), and a ski is pulled up to the hand when the hand cannot reach it
// Grabs are data (GRABS): which hand, which ski, where along it (tail -1 .. tip +1), which edge, and the skis' and
// body's shape, taken from how freeskiers define them (Backcountry Access "Ski Tricks 101", Red Bull, the NBC
// Olympics glossary). Positions without a grab (daffy, spread eagle...) are in the same table.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clamp, smoothstep } from './noise.js?v=20';
import { Spring, springBank, smooth01, wrapPi } from './motion.js?v=20';
import { height, normal } from './terrain.js?v=20';
import { gltfLoader, gearParts, LOOK, FIT, TOPS, LOW } from './gear.js?v=20';

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const _p = V(), _s = V(), _q = Q();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
// scratch for the per-frame pose (nothing is allocated in update)
const _sp = V(), _sq = Q(), _ss = V(), _sm = new THREE.Matrix4(), _fm1 = new THREE.Matrix4(), _fm2 = new THREE.Matrix4(), _bx = V(), _by = V(), _bz = V();
const _aa = V(), _ab = V(), _aq = Q(), _aq2 = Q(), _tH = V(), _tD = V(), _tP = V(), _tK = V(), _tE = V(), _tU = V(), _bq = Q();
const _qi = Q(), _q1 = Q(), _q2 = Q(), _q3 = Q(), _ub = V(), _acc = V(), _vb = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V();
const _cFl = V(), _sh = V(), _pelQ = Q(), _chQ = Q(), _hdQ = Q(), _eu = new THREE.Euler(), _kd = V(), _cF = V(), _cL = V(), _wr = V(), _fd = V(), _pa = V(), _el = V(), _tip = V();
const _kq = Q(), _kv = V(), _kx = V(), _ky = V();
const _qi2 = Q(), _ca = V(), _cb = V(), _cc = V(), _cd = V(), _ce = V(), _cf = V(), _cg = V();
const TG = new Float64Array(6);
const SKN = [['sL0', 'sL1', 'sL2', 'sL3', 'sL4', 'sL5'], ['sR0', 'sR1', 'sR2', 'sR3', 'sR4', 'sR5']], HWN = ['hwL', 'hwR'], PULLN = [['pLx', 'pLy', 'pLz'], ['pRx', 'pRy', 'pRz']], ARMN = [['aLx', 'aLy', 'aLz'], ['aRx', 'aRy', 'aRz']];
// a grab's free arm (out from the shoulder, up, forward), all inside the arm's reach so the elbow stays bent; 'up' is a
// hand raised beside and a little behind the head with the elbow out, not an arm pointed at the sky
// (the hands' place from the shoulder: out, up, forward. Brought in and down, hanging more naturally, 2026-11-03)
const _sa0 = new THREE.Vector3(), _sb0 = new THREE.Vector3(), _sa1 = new THREE.Vector3(), _sb1 = new THREE.Vector3(), _sp0 = new THREE.Vector3(), _sp1 = new THREE.Vector3(), _sd = new THREE.Vector3(), _sv = new THREE.Vector3(), _su = new THREE.Vector3(), _sw = new THREE.Vector3(), _sr = new THREE.Vector3();
// the closest points of two segments (p1 q1, p2 q2) into c1, c2; their distance returned
function segSeg(p1, q1, p2, q2, c1, c2) {
  const d1 = _su.subVectors(q1, p1), d2 = _sw.subVectors(q2, p2), r = _sr.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) { s = t = 0; }
  else if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const bb = d1.dot(d2), den = a * e - bb * bb;
      s = den > 1e-9 ? clamp((bb * f - c * e) / den, 0, 1) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
const ARM_MODE = { out: [0.22, -0.22, 0.2], up: [0.19, 0.25, -0.08], wide: [0.3, -0.2, 0.1], high: [0.24, 0.4, -0.12],
  between: [-0.13, -0.5, 0.26], scream: [0.42, 0.22, 0.05], back: [0.24, -0.14, -0.24], fwd: [0.17, 0.04, 0.34] };   // (back: behind for balance, as in nose grab photos; fwd: out in front, as in tail grab photos)   // (between: both hands together low in front, the poles down between the legs; scream: thrown out wide and up)   // (high: thrown up over the head with the pole, as in photos of mutes and japans)
// small continuous motion: a sum of three sines, about -1..1, never repeating soon (a is a phase per channel)
// a reach that is kept short of a limb's full length: as it is up to a share a of the length, then easing towards b
// (a hard stop near full reach makes the joint flick, since the angle changes fastest there)
export const softReach = (d, L, a, b) => { const s = a * L, w = (b - a) * L; return d <= s ? d : s + w * Math.tanh((d - s) / w); };
export const wob = (t, a) => 0.55 * Math.sin(t + a) + 0.3 * Math.sin(t * 1.71 + a * 2.3) + 0.15 * Math.sin(t * 2.93 + a * 0.7);
export { segSeg };
const gpOut = () => ({ pt: V(), palm: V(), fingers: V() });

export const SKI = { len: 1.78, waist: 0.092, tip: 0.118, thick: 0.017, stack: 0.03 };
// seen in first person on the snow (2026-11-06): how much more upright the chest is (rad), how far further back the
// hips sit (m), and how much further out, up and forward the hands ride (m), so the ski tips and the hands are in view from the eyes (Rig.FP, for tests)
const FP = { lean: 0.3, hips: 0.1, lat: 0.03, up: 0.12, fwd: 0.38 };

/* ---- followers for the first-person view (2026-11-06, for "make it so that first person looks more realistic and
   you can see the deck move and it is not glitchy for all"). Each follows a moving target with a critically damped
   spring whose own velocity is fed forward, so while the target moves smoothly (a carve, a spin, a flip) it is followed
   exactly, with no lag; but the fed-forward velocity may change only so fast (amax, per second squared), so a jump in
   one frame (the body set onto the snow at a landing, onto a rail as it locks on) is not passed through: it is eased
   out over about 4.7 / k seconds instead. Nothing allocated per frame. -------------------------------------------- */
const _fa = V(), _fb = V(), _fc = V(), _ff = V(), _fe = V(), _gq1 = Q(), _gq2 = Q(), _gq3 = Q();
// the rotation taking a to b, as a rotation vector in the world (b = d a)
export function rotVec(a, b, out) {
  const d = _gq3.copy(a).invert().premultiply(b);
  if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
  const s = Math.hypot(d.x, d.y, d.z);
  if (s < 1e-9) return out.set(0, 0, 0);
  const ang = 2 * Math.atan2(s, d.w);
  return out.set(d.x / s * ang, d.y / s * ang, d.z / s * ang);
}
export function expRot(v, out) {
  const a = v.length();
  if (a < 1e-9) return out.identity();
  const s = Math.sin(a / 2) / a;
  return out.set(v.x * s, v.y * s, v.z * s, Math.cos(a / 2));
}
// one critically damped step of an error e and its rate r (both vectors, changed in place) over dt at rate k
function damp(e, r, k, dt) {
  const E = Math.exp(-k * dt), j = _fe.copy(r).addScaledVector(e, k);
  e.addScaledVector(j, dt).multiplyScalar(E);
  r.addScaledVector(j, -k * dt).multiplyScalar(E);
}
export class FollowV {
  constructor() { this.x = V(); this.v = V(); this.u = V(); this.t = V(); this.ok = false; }
  reset(t) { this.x.copy(t); this.t.copy(t); this.v.set(0, 0, 0); this.u.set(0, 0, 0); this.ok = true; return this.x; }
  to(t, dt, k, amax) {
    if (!this.ok || !(dt > 0)) return this.ok ? this.x : this.reset(t);
    const du = _fa.subVectors(t, this.t).divideScalar(dt).sub(this.u), m = du.length(), cap = amax * dt;
    if (m > cap) du.multiplyScalar(cap / m);
    this.u.add(du);
    const e = _fb.subVectors(this.x, this.t), r = _fc.subVectors(this.v, this.u);
    damp(e, r, k, dt);
    this.x.copy(this.t).addScaledVector(this.u, dt).add(e);
    this.v.copy(this.u).add(r);
    this.t.copy(t);
    return this.x;
  }
}
export class FollowQ {
  constructor() { this.q = Q(); this.t = Q(); this.w = V(); this.u = V(); this.ok = false; }
  reset(t) { this.q.copy(t); this.t.copy(t); this.w.set(0, 0, 0); this.u.set(0, 0, 0); this.ok = true; return this.q; }
  to(t, dt, k, amax) {
    if (!this.ok || !(dt > 0)) return this.ok ? this.q : this.reset(t);
    const du = rotVec(this.t, t, _fa).divideScalar(dt).sub(this.u), m = du.length(), cap = amax * dt;
    if (m > cap) du.multiplyScalar(cap / m);
    this.u.add(du);
    const e = rotVec(this.t, this.q, _fb), r = _fc.subVectors(this.w, this.u);
    damp(e, r, k, dt);
    // shown: the error left, on the old target carried on at the fed-forward rate
    expRot(_ff.copy(this.u).multiplyScalar(dt), _gq1).multiply(this.t);
    this.q.copy(expRot(e, _gq2).multiply(_gq1)).normalize();
    this.w.copy(this.u).add(r);
    this.t.copy(t);
    return this.q;
  }
}

/* ---- a crash on the snow, not in it (2026-11-07). The physics tumbles the body (S.q) and slides its contact point
   (S.p) along the snow; drawn with the feet at S.p, the body turned about the feet and went into the snow head and
   shoulders first (and, upside down off a jump, all of it, before the feet came down). Now in a crash the body turns
   about its middle (the pelvis), with the middle over the sliding point and as high as puts the body's lowest part on
   the snow there (from where its parts were last frame, under this frame's turn); then, after the pose, every part is
   checked against the snow itself and anything still under lifts the whole rider out. In the air the same check keeps
   the body's own parts out of the snow, and upside down the gear too. For every ride: the parts are the skeleton's
   joints, each with a radius for the body round it, and points on each piece of gear's own outline (skis, poles, a
   board, a scooter, a bike, a sled, the helmet). */
const CRASH_BONES = [['head', 0.12], ['neck', 0.09], ['chest', 0.16], ['spine1', 0.15], ['spine', 0.15], ['pelvis', 0.16], ['clL', 0.08], ['clR', 0.08], ['uaL', 0.09], ['uaR', 0.09],
  ['faL', 0.07], ['faR', 0.07], ['haL', 0.07], ['haR', 0.07], ['thL', 0.12], ['thR', 0.12], ['caL', 0.09], ['caR', 0.09], ['ftL', 0.09], ['ftR', 0.09], ['toL', 0.07], ['toR', 0.07]];
const CRASH_EXTRA = [['Bip01_L_Finger21', 0.045], ['Bip01_R_Finger21', 0.045], ['Bip01_MNose', 0.05], ['Bip01_MJaw', 0.06]];
/* a piece of gear's outline: its furthest vertex each of 80 ways round (worked out once, kept on the geometry), from
   which the few lowest are found each frame for the way down. (26 ways missed a curved sled's lowest point by up to
   7 cm in some turns.) */
const SUP_N = 80, SUP_DIRS = [];
for (let i = 0; i < SUP_N; i++) { const y = 1 - 2 * (i + 0.5) / SUP_N, r = Math.sqrt(1 - y * y), a = i * 2.399963; SUP_DIRS.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
function outline(g) {
  if (g.userData.outline) return g.userData.outline;
  const P = g.attributes.position, best = new Float64Array(SUP_N).fill(-Infinity), at = new Int32Array(SUP_N).fill(-1);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    for (let k = 0; k < SUP_N; k++) { const d = SUP_DIRS[k], s = x * d.x + y * d.y + z * d.z; if (s > best[k]) { best[k] = s; at[k] = i; } }
  }
  const seen = [...new Set(at)].filter(i => i >= 0), out = new Float32Array(seen.length * 3);
  seen.forEach((i, k) => { out[k * 3] = P.getX(i); out[k * 3 + 1] = P.getY(i); out[k * 3 + 2] = P.getZ(i); });
  return (g.userData.outline = out);
}
const GEAR_K = 3;                    // the lowest few of each piece of gear's outline are checked against the snow
const _cx = V(), _cu = V(), _cn = V(), _cn2 = V(), _cb2 = V(), _cs = V(), _pb = V(), _pd = V(), _pn = V(), _cdn = V(), _cbest = new Float64Array(8), _cbi = new Int32Array(8), _ck = new Float64Array(10), _cki = new Int32Array(10);

// grabs and positions are data in grabs.js (with their mirror images and variations)
export { GRABS } from './grabs.js?v=20';
import { grabDef } from './grabs.js?v=20';

// ---- gear -------------------------------------------------------------------------------------------------------------
function skiGeometry() {
  // a lofted twin-tip: sidecut, rocker at both ends, a thin wedge-shaped core, base and top separate groups
  const N = 48, L = SKI.len, half = L / 2;
  const top = [], base = [], side = [];
  const prof = (t) => {                      // t in -1..1
    const a = Math.abs(t);
    const w = (SKI.waist + (SKI.tip - SKI.waist) * Math.pow(a, 2.2)) * (a > 0.93 ? Math.sqrt(Math.max(0, 1 - ((a - 0.93) / 0.07) ** 2)) * 0.95 + 0.05 : 1);
    const rise = a > 0.78 ? Math.pow((a - 0.78) / 0.22, 2.1) * 0.075 : 0;
    const th = SKI.thick * (0.45 + 0.55 * (1 - a * a));
    return { w: Math.max(0.006, w), rise, th };
  };
  const pos = [], uv = [], idx = [], grp = [];
  const ring = [];
  for (let i = 0; i <= N; i++) {
    const t = -1 + 2 * i / N, z = t * half, p = prof(t);
    const yb = p.rise, yt = p.rise + p.th, hw = p.w / 2;
    // 4 corners: base left, base right, top right, top left
    ring.push(pos.length / 3);
    pos.push(hw, yb, z, -hw, yb, z, -hw, yt, z, hw, yt, z);
    uv.push(0, i / N, 1, i / N, 1, i / N, 0, i / N);
  }
  for (let i = 0; i < N; i++) {
    const a = ring[i], b = ring[i + 1];
    // top (corners 2,3), base (0,1), then the two sides; wound to face outwards
    idx.push(a + 3, a + 2, b + 3, a + 2, b + 2, b + 3);
    idx.push(a + 0, b + 0, a + 1, a + 1, b + 0, b + 1);
    idx.push(a + 0, a + 3, b + 0, a + 3, b + 3, b + 0);
    idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // groups: top 0, base 1, sides 2 (6 indices each per kind per section)
  g.clearGroups();
  const tri = [];
  for (let i = 0; i < N; i++) tri.push([i * 24, 6, 0], [i * 24 + 6, 6, 1], [i * 24 + 12, 12, 2]);
  // reorder index by group
  const ix = g.index.array, sorted = [], counts = [0, 0, 0];
  for (const k of [0, 1, 2]) for (const [s, n, gk] of tri) if (gk === k) { for (let j = 0; j < n; j++) sorted.push(ix[s + j]); counts[k] += n; }
  g.setIndex(sorted);
  g.addGroup(0, counts[0], 0); g.addGroup(counts[0], counts[1], 1); g.addGroup(counts[0] + counts[1], counts[2], 2);
  g.computeVertexNormals();
  return g;
}
function topsheet(colA, colB) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, colA); gr.addColorStop(0.5, colB); gr.addColorStop(1, colA);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 512);
  x.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 7; i++) x.fillRect(0, 120 + i * 40, 64, 6 + (i % 3) * 3);
  x.fillStyle = 'rgba(10,10,14,0.85)'; x.fillRect(26, 40, 12, 432);
  x.save(); x.translate(32, 256); x.rotate(-Math.PI / 2); x.font = 'bold italic 34px "Barlow Condensed", Arial Narrow, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.fillText('LZ  PARK  178', 0, 12); x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/* the ski flexes (2026-11-03, for "make butter look more like butter with skis bending slightly"; reshaped 2026-11-05,
   for "the nose of the ski is touching the snow while the tail is rising up"): a bend along its length (ends up from the
   middle, uBend metres at the tips) for a press on a rail, and a butter's flex (uFlex: x the nose's, y the tail's, z
   where the bend starts from the boot, w where the ski meets the snow): from the boot out to the contact the ski
   curves up by as much as the butter pitches it down, so from the contact to the tip it lies flat on the snow, and the
   tail stands up straight behind. flexY() is the same curve on the CPU (the pose sets the contact on the snow). */
const FLEX_ZB = 0.05;
export function flexY(z, kN, kT, zb, zp) {
  const k = z > 0 ? kN : kT, u = Math.abs(z) - zb, L = Math.max(0.05, Math.abs(zp) - zb);
  if (!(k > 0) || u <= 0) return 0;
  return k * (u < L ? u * u / (2 * L) : L / 2 + (u - L));
}
export function skiFlex(m, bend, flex) {
  const half = (SKI.len / 2).toFixed(4);
  m.onBeforeCompile = s => {
    s.uniforms.uBend = bend; s.uniforms.uFlex = flex;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBend; uniform vec4 uFlex;').replace('#include <begin_vertex>', `#include <begin_vertex>
{ float t = position.z / ${half}; transformed.y += uBend * t * t;
  float k = position.z > 0.0 ? uFlex.x : uFlex.y, u = abs(position.z) - uFlex.z, L = max(0.05, abs(uFlex.w) - uFlex.z);
  if (k > 0.0 && u > 0.0) transformed.y += k * (u < L ? u * u / (2.0 * L) : L * 0.5 + (u - L)); }`);
  };
  m.customProgramCacheKey = () => 'ski-flex';
}
function makeSki(colA, colB, plate) {
  const g = skiGeometry();
  const mats = [
    new THREE.MeshStandardMaterial({ map: topsheet(colA, colB), roughness: 0.35, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.1 }),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 }),
  ];
  const bend = { value: 0 }, flex = { value: new THREE.Vector4(0, 0, FLEX_ZB, 0.6) };
  for (const m of mats) skiFlex(m, bend, flex);
  const ski = new THREE.Mesh(g, mats); ski.castShadow = true; ski.name = 'ski'; ski.userData.bend = bend; ski.userData.flex = flex;
  addBinding(ski, plate);
  return ski;
}
// binding: the downloaded binding plate (models/gear/binding.glb) when it came, else our own plate, and our toe and
// heel pieces on it (no alpine binding with its toe and heel was found under an open licence)
function addBinding(ski, plateParts) {
  const bm = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.4 });
  const am = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 });
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.04, 0.09), bm); toe.position.set(0, SKI.thick + 0.022, 0.17);
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.055, 0.11), bm); heel.position.set(0, SKI.thick + 0.03, -0.17);
  let plate = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.42), am); plate.position.set(0, SKI.thick + 0.006, 0);
  const src = plateParts && (plateParts.binding || Object.values(plateParts)[0]);
  if (src) {
    plate = src.clone(); plate.material = bm; plate.geometry.computeBoundingBox();
    const b = plate.geometry.boundingBox; plate.scale.set(0.078 / (b.max.x - b.min.x), 0.02 / Math.max(1e-3, b.max.y - b.min.y), 0.42 / (b.max.z - b.min.z));
    plate.position.set(0, SKI.thick - b.min.y * plate.scale.y, 0);
  }
  const brk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.06), bm); brk.position.set(0, SKI.thick + 0.012, -0.1);
  for (const m of [toe, heel, plate, brk]) { m.castShadow = true; ski.add(m); }
  return ski;
}
function makeBoot(col) {
  // a ski boot's lower shell (on the ski) and its cuff (on the shin)
  const shellM = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 });
  const lower = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.03, 0.31), dark); sole.position.set(0, 0.015, 0.005);
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.17, 4, 10), shellM); shell.rotation.x = Math.PI / 2; shell.scale.set(1, 1, 0.95); shell.position.set(0, 0.07, 0.02);
  const instep = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), shellM); instep.scale.set(0.95, 0.9, 1.2); instep.position.set(0, 0.1, -0.04);
  const buckle1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.018), dark); buckle1.position.set(0, 0.125, 0.04);
  for (const m of [sole, shell, instep, buckle1]) { m.castShadow = true; lower.add(m); }
  const cuff = new THREE.Group();
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.2, 12, 1, true), shellM); c1.castShadow = true; cuff.add(c1);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12, 1, true), dark); strap.position.y = 0.085; cuff.add(strap);
  shellM.side = THREE.DoubleSide;
  return { lower, cuff };
}
function makePole() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 1.08, 8), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.3 }));
  shaft.position.y = -0.56; g.add(shaft);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 }));
  grip.position.y = -0.03; g.add(grip);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 12), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 }));
  basket.position.y = -1.0; g.add(basket);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// the helmet's paint: a navy shell, a yellow disc on each side, red stripes over the top from front to back (our own
// design, in the spirit of a sponsored rider's lid; no brand's name or logo), on the sphere's u (round) and v (down)
function helmetPaint() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#16255e'; x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#c8cdd6'; x.fillRect(0, 236, 512, 20);                                   // a silver rim band
  // red stripes from the front (u 0.25) over the top to the back (u 0.75): along v at the front and back columns
  x.fillStyle = '#d7192f';
  for (const u of [0.25, 0.75]) { x.fillRect(u * 512 - 22, 0, 12, 236); x.fillRect(u * 512 + 10, 0, 12, 236); }
  x.fillRect(0, 0, 512, 16);
  // the yellow discs on the sides (u 0 and 0.5), a thin red ring round each
  for (const u of [0, 0.5, 1]) {
    const cx = u * 512, cy = 140;
    x.fillStyle = '#d7192f'; x.beginPath(); x.ellipse(cx, cy, 52, 66, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffc20e'; x.beginPath(); x.ellipse(cx, cy, 44, 56, 0, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function makeHelmet(col, lens) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), new THREE.MeshStandardMaterial({ color: 0xffffff, map: helmetPaint(), roughness: 0.28, metalness: 0.15 }));
  shell.scale.set(0.118, 0.13, 0.142); g.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 24), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.7 }));
  rim.rotation.x = Math.PI / 2; rim.scale.set(0.117, 0.141, 0.12); rim.position.y = -0.012; g.add(rim);
  // goggles: a curved lens with a mirror coating and a strap round the helmet
  const lensG = new THREE.SphereGeometry(1, 20, 8, -Math.PI * 0.34, Math.PI * 0.68, Math.PI * 0.39, Math.PI * 0.24);
  const lensM = new THREE.MeshStandardMaterial({ color: lens, metalness: 1.0, roughness: 0.08, envMapIntensity: 1.6 });
  const lensMesh = new THREE.Mesh(lensG, lensM); lensMesh.scale.set(0.118, 0.17, 0.108); lensMesh.rotation.y = 0; lensMesh.position.set(0, -0.02, 0.0); g.add(lensMesh);
  g.userData.lens = lensM; lensMesh.userData.goggle = true;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 5, 26, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.6 }));
  frame.rotation.set(Math.PI / 2, 0, Math.PI * 0.15 + Math.PI / 2); frame.scale.set(0.12, 0.11, 0.13); frame.position.y = -0.03; g.add(frame);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 4, 28), new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.8 }));
  strap.rotation.x = Math.PI / 2; strap.scale.set(0.121, 0.146, 0.18); strap.position.y = 0.0; g.add(strap);
  frame.userData.goggle = strap.userData.goggle = true;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.layers.set(1); } });
  return g;
}

/* ---- downloaded gear (gear.js loads it; CREDITS.md): the head (a helmet or a beanie, then goggles and our strap), a
   ski, a pole. Each part is fitted to where our own built ones were, so the poses are unchanged. ---------------------- */
// a picture's light and shade in our colour (the downloaded helmet's and beanie's own colours replaced)
function tinted(m, col) {
  m.color = new THREE.Color(col);
  if (m.map) {
    m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{ float l = dot(diffuseColor.rgb / max(vec3(1e-3), diffuse), vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = diffuse * clamp(0.35 + 0.9 * l, 0.0, 1.4); }`); };
    m.customProgramCacheKey = () => 'gear-tint';
  }
  return m;
}
const _gb = new THREE.Box3();
function makeHead(kind, col, lens, frameCol, goggles, hat) {
  const gog = goggles && goggles.lens && goggles.frame;
  // our own painted helmet: with the downloaded goggles in place of its own when they came
  if (kind === 'painted' || !hat || !gog) {
    const g = makeHelmet(col, lens);
    if (!gog) return g;
    for (const o of g.children.slice()) if (o.userData.goggle) g.remove(o);
    addGoggles(g, goggles, lens, frameCol, 'painted');
    return g;
  }
  const g = new THREE.Group();
  // the helmet's or beanie's top where our own helmet's was, its width to the head's
  const h = hat.shell || hat.knit || Object.values(hat)[0];
  tinted(h.material, col); h.material.roughness = kind === 'beanie' ? 0.95 : 0.35; h.material.metalness = 0.05;
  h.geometry.computeBoundingBox();
  const hb = h.geometry.boundingBox, s = (kind === 'beanie' ? 0.226 : 0.25) / (hb.max.x - hb.min.x);
  h.scale.setScalar(s); h.position.set(0, (kind === 'beanie' ? 0.142 : 0.15) - s * hb.max.y, kind === 'beanie' ? -0.008 : -0.006);
  g.add(h); g.userData.hat = h.material;
  addGoggles(g, goggles, lens, frameCol, kind);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.layers.set(1); } });
  return g;
}
// the downloaded goggles' lens and frame across the eyes, and our strap round the back
function addGoggles(g, goggles, lens, frameCol, kind) {
  const L = goggles.lens, F = goggles.frame;
  L.geometry.computeBoundingBox(); F.geometry.computeBoundingBox();
  const fb = _gb.copy(F.geometry.boundingBox).union(L.geometry.boundingBox), fs = 0.205 / (fb.max.x - fb.min.x);
  for (const m of [L, F]) { m.scale.setScalar(fs); m.position.set(-fs * (fb.min.x + fb.max.x) / 2, -0.028 - fs * (fb.min.y + fb.max.y) / 2, 0.128 - fs * fb.max.z); g.add(m); }
  L.material = new THREE.MeshStandardMaterial({ color: lens, metalness: 1.0, roughness: 0.08, envMapIntensity: 1.6 });
  F.material = new THREE.MeshStandardMaterial({ color: frameCol || '#16181c', roughness: 0.6 });
  g.userData.lens = L.material;
  const strap = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 4, 28), new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.8 }));
  strap.rotation.x = Math.PI / 2; strap.scale.set(kind === 'beanie' ? 0.112 : kind === 'painted' ? 0.121 : 0.126, 0.146, kind === 'beanie' ? 0.17 : 0.18); strap.position.y = -0.012; g.add(strap);
  for (const o of [L, F, strap]) { o.castShadow = true; o.layers.set(1); o.userData.goggle = true; }
}
// a downloaded ski as one mesh like ours: our length, the top sheet in two colours by the faces' direction (tips in the
// second colour), the base dark, the edges steel, our flex, our binding on it
function gearSki(parts, colA, colB, plate) {
  const src = parts.top || Object.values(parts)[0], g = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone();
  g.computeBoundingBox(); const bb = g.boundingBox, s = SKI.len / (bb.max.z - bb.min.z);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.scale(s, s, s);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal, col = new Float32Array(P.count * 3), A = new THREE.Color(colA), B2 = new THREE.Color(colB), base = new THREE.Color(0x15161a), edge = new THREE.Color(0x9aa0a6), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    const ny = N.getY(i), z = Math.abs(P.getZ(i)) / (SKI.len / 2);
    if (ny > 0.35) c.copy(z > 0.62 ? B2 : A); else if (ny < -0.35) c.copy(base); else c.copy(edge);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.08 });
  const bend = { value: 0 }, flex = { value: new THREE.Vector4(0, 0, FLEX_ZB, 0.6) };
  skiFlex(m, bend, flex);
  const ski = new THREE.Mesh(g, m); ski.castShadow = true; ski.name = 'ski'; ski.userData.bend = bend; ski.userData.flex = flex;
  addBinding(ski, plate);
  return ski;
}
function gearPole(parts, col) {
  const g = new THREE.Group(), s = 1.1 / 1.177;
  for (const [k, mesh] of Object.entries(parts)) {
    const m = mesh.clone(); m.material = new THREE.MeshStandardMaterial({ color: k === 'shaft' ? col : k === 'strap' ? 0x2b2e35 : 0x15161a, metalness: k === 'shaft' ? 0.8 : 0.1, roughness: k === 'shaft' ? 0.3 : 0.7 });
    m.scale.setScalar(s); m.castShadow = true; g.add(m);
  }
  return g;
}

// ---- the outfit: recolour the model's clothes by its region mask, gloves found by skin weights -------------------------
async function regionMeans(tex, maskUrl) {
  const img = tex.image, m = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = maskUrl; });
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S); const a = x.getImageData(0, 0, S, S).data;
  x.clearRect(0, 0, S, S); x.drawImage(m, 0, 0, S, S); const b = x.getImageData(0, 0, S, S).data;
  const sum = [0, 0, 0], n = [0, 0, 0];
  for (let i = 0; i < a.length; i += 4) {
    const l = (0.2126 * (a[i] / 255) ** 2.2 + 0.7152 * (a[i + 1] / 255) ** 2.2 + 0.0722 * (a[i + 2] / 255) ** 2.2);
    for (let k = 0; k < 3; k++) if (b[i + k] > 128) { sum[k] += l; n[k]++; }
  }
  return sum.map((s, k) => n[k] ? s / n[k] : 0.2);
}

export class Rig {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'rider';          // stays at the origin: holds the body and the gear
    this.body = new THREE.Group(); this.body.name = 'body'; this.root.add(this.body);   // at the feet, in the body's frame
    this.ready = false;
    this.p = {};          // the pose's springs (cleared to start them again)
    this.skiL = null; this.skiR = null;
    this.sk = [{ pos: V(), q: Q() }, { pos: V(), q: Q() }];            // each ski in the body's frame
    this.air6 = [new Float64Array(6), new Float64Array(6)];
    this.hs = [0, 1].map(() => ({ cur: null, prev: null, f: new Spring(1), fx: 1, w: 0 }));   // what each hand holds
    this.gpA = gpOut(); this.gpB = gpOut();
    this._roll = [0, 0]; this._pv = V(); this._gl = { next: 3, until: 0, yaw: 0, pitch: 0 };
    this.ph = Math.random() * 100;                                     // each rider's own idle rhythm
    this.pull = [V(), V()]; this._pt = [V(), V()]; this._hold = [0, 0];                     // a grabbed ski brought up to the hand
    this._flex = [0, 0];
    this.eye = V(); this.headPos = V(); this.headQ = Q();
    /* first person, for every ride (2026-11-08, the contract in ski8/R/NOTES.md): where the camera sits (fpEye, set to
       the eyes by placeHead every frame; a ride's pose may move it after placeHead), the way it looks when nobody is
       looking round (fpLook: null for the camera's own rule, or a unit vector, e.g. rig.fpDir set by the pose) and its
       up then (fpUp: null for the body's) */
    this.fpEye = V(); this.fpDir = V(); this.fpLook = null; this.fpUp = null;
    this.fp = false; this._dt = 0;                                     // seen in first person (camera.js sets it)
  }
  async load(id, opts = {}) {
    // (the look: what the locker chose; its colours win over the outfit's)
    const look = this.look = Object.assign({}, LOOK, opts.look || {});
    const kind = opts.kind || 'ski';
    const want = { goggles: gearParts('goggles'), head: look.head === 'beanie' ? gearParts('beanie') : look.head === 'painted' ? null : gearParts('helmet_c'),
      ski: kind === 'ski' && look.ski !== 'park' ? gearParts(look.ski === 'pow' ? 'ski_b' : 'ski_a') : null, pole: kind === 'ski' ? gearParts('pole') : null, plate: kind === 'ski' ? gearParts('binding') : null };
    const gl = await gltfLoader().loadAsync('./models/' + id + '.glb?v=20');
    const model = gl.scene; this.model = model;
    this.outfit = Object.assign({ jacket: '#d2462f', pants: '#1f2a36', gloves: '#16181c', helmet: '#f2f2ef', lens: '#ff8a2a', boots: '#e9eaec', skiA: '#0d1b2a', skiB: '#ff6a13' }, opts.outfit || {});
    if (opts.look) for (const k of ['jacket', 'jacket2', 'pants', 'gloves', 'helmet', 'lens', 'boots', 'skiA', 'skiB']) if (opts.look[k]) this.outfit[k] = opts.look[k];
    this.wrap = new THREE.Group(); this.wrap.add(model); this.body.add(this.wrap);
    const bones = {};
    model.traverse(o => { if (o.isBone || /^Bip01/.test(o.name)) bones[o.name] = o; });
    this.bones = bones;
    const B = n => bones['Bip01_' + n] || bones['Bip01 ' + n] || bones[n];
    this.b = {
      root: bones.Bip01, pelvis: B('Pelvis'), spine: B('Spine'), spine1: B('Spine1'), chest: B('Spine2'), neck: B('Neck'), head: B('Head'),
      clL: B('L_Clavicle'), uaL: B('L_UpperArm'), faL: B('L_Forearm'), haL: B('L_Hand'),
      clR: B('R_Clavicle'), uaR: B('R_UpperArm'), faR: B('R_Forearm'), haR: B('R_Hand'),
      thL: B('L_Thigh'), caL: B('L_Calf'), ftL: B('L_Foot'), toL: B('L_Toe0'),
      thR: B('R_Thigh'), caR: B('R_Calf'), ftR: B('R_Foot'), toR: B('R_Toe0'),
    };
    // meshes: keep the detailed one, hide the far copy and the hair (under the helmet)
    const skinned = [];
    model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    let bodyMat = null, bodyMesh = null, headMesh = null;
    for (const o of skinned) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      let p = o; let far = false; while (p) { if (p.name === 'lod1') far = true; p = p.parent; }
      const mn = o.material && o.material.name;
      if (far || mn === 'hair') { o.visible = false; continue; }
      if (mn === 'head') { o.layers.set(1); headMesh = o; }
      if (mn === 'body') {
        bodyMesh = o;
        bodyMat = o.material; o.geometry.computeBoundingBox(); this.bodyH = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y; this.bodyY0 = o.geometry.boundingBox.min.y;
        // the legs in the mesh's own space, for the trousers: the middle between them and how far out each one's middle
        // is, measured from the shins and thighs themselves (the mesh's x is across the body)
        const P = o.geometry.attributes.position, yb = this.bodyY0, H = this.bodyH;
        let n = 0, sx = 0; for (let i = 0; i < P.count; i++) { const y = (P.getY(i) - yb) / H; if (y > 0.12 && y < 0.4) { sx += P.getX(i); n++; } }
        if (n) {
          const mx = sx / n; let sa = 0; for (let i = 0; i < P.count; i++) { const y = (P.getY(i) - yb) / H; if (y > 0.12 && y < 0.4) sa += Math.abs(P.getX(i) - mx); }
          this.legMid = V().set(mx, 0, 0); this.legLat = V().set(1, 0, 0); this.legHalf = sa / n;
        }
      }
      this.skel = o.skeleton;
    }
    if (bodyMat) { await this.dress(bodyMat, id); if (this.dressU && bodyMesh) this.weldPuff(bodyMesh, headMesh); if (this.dressU) { this._puff0 = 0.022 * (this.bodyH > 0.1 ? (this.bodyH > 10 ? this.bodyH / 1.75 : 1) : 1); this.dressU.uPuff.value = this._puff0 * (FIT[look.fit] ?? 1); this.dressU.uLeg.value.set(this.bodyY0 || 0, Math.max(1e-3, this.bodyH || 1.75)); if (this.legLat) { this.dressU.uLegMid.value.copy(this.legMid); this.dressU.uLegLat.value.copy(this.legLat); this.dressU.uLegHalf.value = this.legHalf; } } }
    // face it along +Z, feet at y = 0
    this.root.updateMatrixWorld(true);
    const lr = this.wpos(this.b.thL).sub(this.wpos(this.b.thR));
    const fwd = V().crossVectors(lr, Y); fwd.y = 0;
    this.wrap.rotation.y = -Math.atan2(fwd.x, fwd.z);
    this.root.updateMatrixWorld(true);
    this.measure();
    // the nodes between the body and the skeleton's root, updated each frame without walking the whole skeleton
    this.chain = []; for (let o = this.b.root.parent; o && o !== this.body; o = o.parent) this.chain.unshift(o);
    // gear: the helmet for every ride; skis, boots and poles for skis. Another ride (a snowboard...) brings its own
    // through Rig.loader[kind](rig, opts), registered by its module (board.js), and poses through Rig.poser[kind]
    this.kind = opts.kind || 'ski';
    const [gg, hh, ss, pp, bp] = await Promise.all([want.goggles, want.head, want.ski, want.pole, want.plate]);
    this.helmet = makeHead(look.head, this.outfit.helmet, this.outfit.lens, look.frame, gg, hh); this.root.add(this.helmet);
    this.headwear(look);
    this.clothes(look);
    const lf = this.kind !== 'ski' ? Rig.loader[this.kind] : null;
    if (lf) await lf(this, opts);
    else {
      this.skiL = ss ? gearSki(ss, this.outfit.skiA, this.outfit.skiB, bp) : makeSki(this.outfit.skiA, this.outfit.skiB, bp);
      this.skiR = ss ? gearSki(ss, this.outfit.skiA, this.outfit.skiB, bp) : makeSki(this.outfit.skiA, this.outfit.skiB, bp);
      this.root.add(this.skiL, this.skiR);
      const bl = makeBoot(this.outfit.boots), br = makeBoot(this.outfit.boots);
      this.bootL = bl; this.bootR = br;
      bl.lower.position.y = SKI.thick + SKI.stack - 0.012; br.lower.position.y = SKI.thick + SKI.stack - 0.012;
      this.skiL.add(bl.lower); this.skiR.add(br.lower);
      this.root.add(bl.cuff, br.cuff);
      this.poleL = pp ? gearPole(pp, look.poleCol) : makePole(); this.poleR = pp ? gearPole(pp, look.poleCol) : makePole(); this.root.add(this.poleL, this.poleR);
      this.setPoles(opts.poles !== false && look.poles !== 'off');
    }
    this.ready = true;
    return this;
  }
  /* the hood (a hoodie's, up over the helmet or beanie), the neck gaiter (pulled up over the nose under the goggles) and
     the goggles pushed up onto the helmet (2026-11-08, for "steezier clothing": park skiers' oversized hoodies, a hood
     or beanie, a neck gaiter, goggles on the helmet). Built in the head's group, so they hide with it in first person;
     the gaiter is merged with the helmet (gear.js), the hood is kept apart so its colour follows the jacket's live. */
  headwear(look) {
    const g = this.helmet; if (!g) return;
    const beanie = look.head === 'beanie';
    if (look.gaiter !== 'off') {
      // a tube round the lower face and neck: the nose and mouth at the front, the neck behind, a soft fold at the bottom
      const pr = [[0.076, -0.066], [0.085, -0.084], [0.085, -0.108], [0.077, -0.138], [0.07, -0.165], [0.072, -0.19], [0.079, -0.205], [0.074, -0.212]].map(([r, y]) => new THREE.Vector2(r, y));
      const lg = new THREE.LatheGeometry(pr, 22);
      // (narrower side to side than front to back, its middle a little forward of the head's, the top following the nose)
      const P = lg.attributes.position;
      for (let i = 0; i < P.count; i++) { const z = P.getZ(i), y = P.getY(i); P.setX(i, P.getX(i) * 0.88); P.setZ(i, z + 0.022); if (z < 0 && y > -0.08) P.setY(i, y - 0.03 * (-z / 0.09)); }
      lg.computeVertexNormals();
      const gt = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: look.gaiterCol || '#22252b', roughness: 0.95, side: THREE.DoubleSide }));
      gt.castShadow = true; gt.layers.set(1); gt.name = 'gaiter'; g.add(gt);
    }
    {
      // the hood: a soft shell over the top, sides and back, open at the face, a little bigger than the helmet or beanie
      const hg = new THREE.SphereGeometry(1, 22, 12, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.8);
      const P = hg.attributes.position;
      for (let i = 0; i < P.count; i++) { const y = P.getY(i), z = P.getZ(i); if (y < 0 && z < 0.2) P.setZ(i, z - 0.25 * y * y); }   // (the back hangs down towards the shoulders)
      hg.computeVertexNormals();
      const hood = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: this.outfit.jacket, roughness: 0.97, side: THREE.DoubleSide }));
      const k = beanie ? 0.95 : 1;
      hood.scale.set(0.136 * k, 0.152 * k, 0.158 * k); hood.position.set(0, beanie ? 0.0 : 0.006, -0.012);
      hood.castShadow = false; hood.layers.set(1); hood.name = 'hood'; hood.userData.keep = true; g.add(hood); this.hood = hood;   // (no shadow of its own: the helmet's is the head's)
    }
    if (look.gog === 'up') {
      // the goggles turned up about the head's middle onto the front of the helmet
      const q = new THREE.Quaternion().setFromAxisAngle(X, -0.66);
      for (const o of g.children) if (o.userData.goggle) { o.position.applyQuaternion(q); o.position.y += 0.006; o.position.z *= 0.93; o.quaternion.premultiply(q); }
    }
  }
  // the clothes' shapes that change at once: the jacket's length, the sleeves' colour, the hood, how low the trousers sit
  clothes(look) {
    const U = this.dressU, T = TOPS[look.top] || TOPS.jacket;
    if (U) { U.uHem.value = T.hem; U.uTop2.value.set(look.jacket2 || look.jacket || this.outfit.jacket); U.uLow.value = LOW[look.fit] ?? 0; }
    if (this.hood) { this.hood.visible = !!T.hood; this.hood.material.color.set(look.jacket || this.outfit.jacket); }
  }
  setPoles(on) { this.poles = on; if (this.poleL) { this.poleL.visible = on; this.poleR.visible = on; } }
  // the locker's colours that change at once (the clothes, the helmet or hat, the lens, the fit); the rest rebuild the rider
  applyLook(look) {
    this.look = Object.assign({}, this.look, look);
    const U = this.dressU;
    if (U) { U.uTop.value.set(look.jacket); U.uBottom.value.set(look.pants); U.uGlove.value.set(look.gloves); if (this._puff0) U.uPuff.value = this._puff0 * (FIT[look.fit] ?? 1); }
    const h = this.helmet ? this.helmet.userData : {};
    if (h.hat) h.hat.color.set(look.helmet);
    if (h.lens) h.lens.color.set(look.lens);
    this.clothes(this.look);
  }
  async dress(mat, id) {
    const map = mat.map; if (!map) return;
    const maskUrl = './models/' + id + '_m.png?v=20';
    const means = await regionMeans(map, maskUrl).catch(() => [0.2, 0.2, 0.2]);
    const mask = await new THREE.TextureLoader().loadAsync(maskUrl);
    mask.flipY = map.flipY; mask.colorSpace = THREE.NoColorSpace;
    const col = c => new THREE.Color(c);
    const handBones = [];
    this.skelIndex = n => this.skel ? this.skel.bones.findIndex(b => b.name === n) : -1;
    const U = {
      uMask: { value: mask }, uMeans: { value: new THREE.Vector3(...means) },
      uTop: { value: col(this.outfit.jacket) }, uBottom: { value: col(this.outfit.pants) }, uShoe: { value: col('#202227') }, uGlove: { value: col(this.outfit.gloves) },
      uHandA: { value: new THREE.Vector4(-1, -1, -1, -1) }, uHandB: { value: new THREE.Vector4(-1, -1, -1, -1) },
      uMaskV: { value: mask }, uPuff: { value: 0 }, uFpNear: { value: 0 }, uLeg: { value: new THREE.Vector2(0, 1.75) }, uLegMid: { value: new THREE.Vector3() }, uLegLat: { value: new THREE.Vector3(1, 0, 0) }, uLegHalf: { value: 0 },
      // (2026-11-08) the jacket's hem (how far down it comes: the long ones over the seat), the sleeves' colour, the arms'
      // bones (for the sleeves), how low the trousers are worn (a drop crotch)
      uHem: { value: 0.545 }, uTop2: { value: col(this.outfit.jacket2 || this.outfit.jacket) }, uArm: { value: new THREE.Vector4(-1, -1, -1, -1) }, uLow: { value: 0 },
    };
    this.dressU = U;
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
uniform vec4 uHandA; uniform vec4 uHandB; varying float vGlove; uniform sampler2D uMaskV; uniform float uPuff; uniform vec2 uLeg; uniform vec3 uLegMid; uniform vec3 uLegLat; uniform float uLegHalf;
uniform float uHem; uniform float uLow; uniform vec4 uArm; varying float vSleeve;
attribute vec3 aMk; attribute vec3 aPuffN; varying float vHN;`)
        /* ski clothes are puffier than street clothes: the jacket pushed out along its normals, and baggy trousers
           (2026-11-03, for "more baggy pants"): loose from the hips and widest at the shins, flared over the boots,
           with a few loose folds stacked above the hem, the hem let down over the boots' tops, and the insides of the
           legs kept apart (pushed out as far, the two legs met in one skirt). hN is the height up the body, 0 at the
           soles; side, which leg (from the hips' own place in the mesh). */
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_MAP
{ vec3 mkv = aMk;
  float hN = clamp((position.y - uLeg.x) / uLeg.y, 0.0, 1.0); vHN = hN;
  if (mkv.g > 0.5 && hN > uHem) { mkv.r = 1.0; mkv.g = 0.0; }
  float shin = 1.0 - smoothstep(0.1, 0.46, hN);
  float folds = shin * shin * (0.5 + 0.5 * sin(hN * 120.0));
  float side = dot(position - uLegMid, uLegLat);
  float mid = uLegHalf > 0.0 ? 1.0 - smoothstep(0.15 * uLegHalf, 0.6 * uLegHalf, abs(side)) : 0.0;
  float inner = max(clamp(-dot(aPuffN, uLegLat) * sign(side), 0.0, 1.0), mid) * (1.0 - smoothstep(0.42, 0.55, hN));
  float pants = mkv.g * (1.5 + 4.2 * shin + 0.7 * folds) * (1.0 - 0.8 * inner);
  /* (2026-11-08, steezier clothes) a long jacket or hoodie (its hem low, over the seat) hangs loose and flares out
     towards its hem; trousers worn low sag at the crotch (uLow) */
  float flare = mkv.r * (1.0 - smoothstep(uHem, uHem + 0.11, hN)) * clamp((0.545 - uHem) * 20.0, 0.0, 1.0);
  transformed += aPuffN * uPuff * (mkv.r * (2.1 + 2.6 * flare) + pants) * mkv.b;
  transformed.y -= mkv.g * uLow * uPuff * 2.8 * smoothstep(0.36, 0.45, hN) * (1.0 - smoothstep(0.47, 0.55, hN)) * mid;
  transformed.y -= mkv.g * uPuff * 3.2 * (1.0 - smoothstep(0.05, 0.16, hN)); }
#endif`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
#ifdef USE_SKINNING
{ float g = 0.0;
  for (int k = 0; k < 4; k++) { float bi = skinIndex[k]; float w = skinWeight[k];
    if (abs(bi - uHandA.x) < 0.5 || abs(bi - uHandA.y) < 0.5 || abs(bi - uHandA.z) < 0.5 || abs(bi - uHandA.w) < 0.5 ||
        abs(bi - uHandB.x) < 0.5 || abs(bi - uHandB.y) < 0.5 || abs(bi - uHandB.z) < 0.5 || abs(bi - uHandB.w) < 0.5) g += w; }
  vGlove = g;
  float sl = 0.0;
  for (int k = 0; k < 4; k++) { float bi = skinIndex[k]; if (abs(bi - uArm.x) < 0.5 || abs(bi - uArm.y) < 0.5 || abs(bi - uArm.z) < 0.5 || abs(bi - uArm.w) < 0.5) sl += skinWeight[k]; }
  vSleeve = sl; }
#else
vGlove = 0.0; vSleeve = 0.0;
#endif
#ifndef USE_MAP
vHN = 0.0;
#endif`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform vec3 uMeans; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uShoe; uniform vec3 uGlove; varying float vGlove; varying float vHN;
uniform vec3 uTop2; uniform float uHem; varying float vSleeve;
uniform float uFpNear;
float fpBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }`)
        /* (2026-11-06) seen in first person, the rider's own body closer to the lens than uFpNear fades out through a
           fine screen door (an arm swung past the face, the collar at the bottom edge), instead of filling the view
           or being cut open by the near plane. 0 (every other camera, every other rider): nothing changes. */
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uFpNear > 0.0) {
  float fpA = smoothstep(uFpNear * 0.55, uFpNear, length(vViewPosition));
  vec2 fpC = gl_FragCoord.xy;
  if (fpA < fpBayer2(0.5 * fpC) * 0.25 + fpBayer2(fpC) + 0.03) discard;
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{ vec4 mk = texture2D(uMask, vMapUv);
  // (the model's jeans come up over the hips at the back: above the jacket's hem it is the jacket)
  if (mk.g > 0.5 && vHN > uHem) { mk.r = 1.0; mk.g = 0.0; }
  float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (mk.r > 0.5) diffuseColor.rgb = mix(uTop, uTop2, smoothstep(0.35, 0.65, vSleeve)) * clamp(l / max(uMeans.x, 0.02), 0.35, 1.7);
  else if (mk.g > 0.5) diffuseColor.rgb = uBottom * clamp(l / max(uMeans.y, 0.02), 0.35, 1.7);
  else if (mk.b > 0.5) diffuseColor.rgb = uShoe * clamp(l / max(uMeans.z, 0.02), 0.4, 1.5);
  if (vGlove > 0.45) diffuseColor.rgb = uGlove * (0.75 + 0.5 * l);
}`);
    };
    mat.defines = Object.assign(mat.defines || {}, { JACKET_HEM: '0.545' });
    // (both faces drawn: where an arm reaching across folds the cloth over itself, its inside shows rather than a hole)
    mat.side = THREE.DoubleSide;
    mat.customProgramCacheKey = () => 'rider-dress';
    mat.needsUpdate = true;
    this.matDressed = mat;
  }
  /* one body (2026-11-05, for "no visible separations between the legs, torso and head"): the clothes' puff above is
     worked out per vertex from the region mask and the normal, and the model's vertices are split where its picture
     is cut (408 places on m_adult_10, 86 of them with different normals and 45 in different regions), so the split
     halves were pushed apart and the gaps showed. Here every place gets one normal and one mask value (averaged over
     its copies), and the puff fades out towards the neck, where the head (a separate mesh, not puffed) meets the
     collar. Also the jacket now sits over the trousers at the waist (it stood inside them). */
  weldPuff(mesh, head) {
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, n = P.count;
    const img = this.dressU.uMaskV.value.image; if (!img || !U || !N) return;
    const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0); const d = cx.getImageData(0, 0, w, h).data;
    const flip = this.dressU.uMaskV.value.flipY, mk = new Float32Array(n * 3), nn = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = U.getX(i), v = U.getY(i), px = clamp(Math.round((u - Math.floor(u)) * (w - 1)), 0, w - 1), py = clamp(Math.round((flip ? 1 - v : v) * (h - 1)), 0, h - 1), j = (py * w + px) * 4;
      mk[i * 3] = d[j] / 255; mk[i * 3 + 1] = d[j + 1] / 255; mk[i * 3 + 2] = 1;
      if ((P.getY(i) - (this.bodyY0 || 0)) / (this.bodyH || 1.75) > 0.545 && mk[i * 3 + 1] > 0.5) { mk[i * 3] = 1; mk[i * 3 + 1] = 0; }
      nn[i * 3] = N.getX(i); nn[i * 3 + 1] = N.getY(i); nn[i * 3 + 2] = N.getZ(i);
    }
    const H = this.bodyH || 1.75, tol = H * 2e-4, groups = new Map();
    for (let i = 0; i < n; i++) { const k = Math.round(P.getX(i) / tol) + ',' + Math.round(P.getY(i) / tol) + ',' + Math.round(P.getZ(i) / tol); const l = groups.get(k); if (l) l.push(i); else groups.set(k, [i]); }
    for (const l of groups.values()) {
      if (l.length < 2) continue;
      let r = 0, gg = 0, ax = 0, ay = 0, az = 0;
      for (const i of l) { r += mk[i * 3]; gg += mk[i * 3 + 1]; ax += nn[i * 3]; ay += nn[i * 3 + 1]; az += nn[i * 3 + 2]; }
      const L = Math.hypot(ax, ay, az) || 1;
      for (const i of l) { mk[i * 3] = r / l.length; mk[i * 3 + 1] = gg / l.length; nn[i * 3] = ax / L; nn[i * 3 + 1] = ay / L; nn[i * 3 + 2] = az / L; }
    }
    // the neck: how far each body vertex is from the head mesh (in the body's bind space)
    if (head) {
      const HP = head.geometry.attributes.position, m = new THREE.Matrix4().copy(mesh.bindMatrixInverse).multiply(head.bindMatrix), v = V(), hp = [];
      const ymin = this.bodyY0 + H * 0.7;
      for (let i = 0; i < HP.count; i++) { v.fromBufferAttribute(HP, i).applyMatrix4(m); if (v.y > ymin - H * 0.1) hp.push(v.x, v.y, v.z); }
      for (let i = 0; i < n; i++) {
        const y = P.getY(i); if (y < ymin) continue;
        const x0 = P.getX(i), z0 = P.getZ(i); let best = 1e9;
        for (let j = 0; j < hp.length; j += 3) { const dx = hp[j] - x0, dy = hp[j + 1] - y, dz = hp[j + 2] - z0, dd = dx * dx + dy * dy + dz * dz; if (dd < best) best = dd; }
        mk[i * 3 + 2] = smoothstep(0.008 * H, 0.05 * H, Math.sqrt(best));
      }
    }
    g.setAttribute('aMk', new THREE.BufferAttribute(mk, 3)); g.setAttribute('aPuffN', new THREE.BufferAttribute(nn, 3));
  }
  wpos(b, out = V()) { return out.setFromMatrixPosition(b.matrixWorld); }
  wquat(o, out = Q()) { o.matrixWorld.decompose(_p, out, _s); return out; }
  // rest measurements in the rider's own frame (root at the origin, unrotated)
  measure() {
    const r = this.body;
    this.root.position.set(0, 0, 0); r.position.set(0, 0, 0); r.quaternion.identity(); this.root.updateMatrixWorld(true);
    const b = this.b, rest = {};
    for (const k in b) if (b[k]) rest[k] = { p: this.wpos(b[k]), q: this.wquat(b[k]) };
    this.rest = rest;
    const d = (a, c) => rest[c].p.distanceTo(rest[a].p);
    this.len = { th: d('thL', 'caL'), ca: d('caL', 'ftL'), ua: d('uaL', 'faL'), fa: d('faL', 'haL') };
    this.ankleH = rest.ftL.p.y;
    this.legLen = this.len.th + this.len.ca;
    this.hipY = rest.thL.p.y; this.pelvisY = rest.pelvis.p.y; this.hipHalf = Math.abs(rest.thL.p.x - rest.pelvis.p.x);
    this.ankleBack = 0.055;
    // which side is which: the model's left should be +X
    this.flipX = rest.thL.p.x < 0;
    // directions at rest
    const dir = (a, c) => rest[c].p.clone().sub(rest[a].p).normalize();
    this.restDir = {
      thL: dir('thL', 'caL'), caL: dir('caL', 'ftL'), thR: dir('thR', 'caR'), caR: dir('caR', 'ftR'),
      uaL: dir('uaL', 'faL'), faL: dir('faL', 'haL'), uaR: dir('uaR', 'faR'), faR: dir('faR', 'haR'),
    };
    // hands: finger direction and palm normal at rest
    const hand = (s) => {
      const hb = s === 'L' ? b.haL : b.haR;
      const f1 = this.bones['Bip01_' + s + '_Finger1'] || this.bones['Bip01 ' + s + ' Finger1'], f4 = this.bones['Bip01_' + s + '_Finger4'] || this.bones['Bip01 ' + s + ' Finger4'];
      const hp = rest[s === 'L' ? 'haL' : 'haR'].p;
      const p1 = f1 ? this.wpos(f1) : hp.clone().add(X), p4 = f4 ? this.wpos(f4) : hp.clone().add(X);
      const fd = p1.clone().add(p4).multiplyScalar(0.5).sub(hp).normalize();
      const across = p1.clone().sub(p4).normalize();
      let palm = V().crossVectors(fd, across).normalize();
      if (palm.y > 0) palm.negate();                      // a T- or A-pose: palms face down
      // fingers for curling: [bone, axis in the bone's local frame, sign]
      const fingers = [];
      for (let f = 0; f <= 4; f++) for (const seg of ['', '1', '2']) {
        const bn = this.bones['Bip01_' + s + '_Finger' + f + seg]; if (!bn) continue;
        const wq = this.wquat(bn), inv = wq.clone().invert();
        let axis = (f === 0 ? V().crossVectors(fd, palm).normalize().lerp(across, 0.4).normalize() : across.clone()).applyQuaternion(inv).normalize();
        // the sign that curls towards the palm
        const tip = fd.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(wq), 0.5));
        const sign = tip.dot(palm) > fd.dot(palm) ? 1 : -1;
        fingers.push({ bn, axis, sign, rest: bn.quaternion.clone(), thumb: f === 0 });
      }
      return { fd, palm, fingers };
    };
    this.hands = { L: hand('L'), R: hand('R') };
    // gloves: hand and finger bones by index in the skin
    if (this.dressU && this.skel) {
      const ids = n => this.skel.bones.findIndex(x => x.name === n);
      const a = ['Bip01_L_Hand', 'Bip01_L_Finger0', 'Bip01_L_Finger1', 'Bip01_L_Finger2'].map(ids);
      const c = ['Bip01_R_Hand', 'Bip01_R_Finger0', 'Bip01_R_Finger1', 'Bip01_R_Finger2'].map(ids);
      const a2 = ['Bip01_L_Finger3', 'Bip01_L_Finger4', 'Bip01_R_Finger3', 'Bip01_R_Finger4'].map(ids);
      // eight slots: L hand + three fingers, R hand + three fingers; the rest of the finger bones share them
      this.dressU.uHandA.value.set(...a); this.dressU.uHandB.value.set(...c);
      this.gloveExtra = a2;
      // (the sleeves: the upper arm and forearm bones)
      this.dressU.uArm.value.set(...['Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_R_UpperArm', 'Bip01_R_Forearm'].map(ids));
    }
    // the eyes: where the goggles go and the first-person camera sits
    const le = this.bones.Bip01_LEye, re = this.bones.Bip01_REye;
    this.eyeOff = (le && re) ? this.wpos(le).add(this.wpos(re)).multiplyScalar(0.5).sub(rest.head.p) : V().set(0, 0.09, 0.09);
    this.restLocal = {}; for (const k in b) if (b[k]) this.restLocal[k] = b[k].quaternion.clone();
  }

  // ---- pose helpers (world space, nothing allocated) ----------------------------------------------------------------
  // set a bone's world rotation; a parent posed earlier this frame gives its rotation without decomposing its matrix
  // (exact here: the only scaled bone, the skeleton's root, is scaled evenly)
  setWorldQ(bone, wq) {
    const par = bone.parent;
    if (par._wf === this._frame) _sq.copy(par._wq).invert();
    else { par.matrixWorld.decompose(_sp, _sq, _ss); _sq.invert(); }
    bone.quaternion.copy(_sq.multiply(wq));
    bone.updateWorldMatrix(false, false);
    (bone._wq || (bone._wq = new THREE.Quaternion())).copy(wq); bone._wf = this._frame;
  }
  setWorldPos(bone, wp) {
    _sm.copy(bone.parent.matrixWorld).invert();
    bone.position.copy(wp).applyMatrix4(_sm);
    bone.updateWorldMatrix(false, false);
  }
  // the rotation taking frame (a, b) to frame (c, d): a and c are the main axes, b and d say where the twist goes
  static frameDelta(a, b, c, d, out = new THREE.Quaternion()) {
    basisInto(_fm1, a, b); basisInto(_fm2, c, d);
    _fm1.transpose(); _fm2.multiply(_fm1); return out.setFromRotationMatrix(_fm2);
  }
  // point a bone (rest direction restD, rest twist restUp, both in the rider frame) along world dir with twist up
  aim(bone, restQ, restD, restUp, dir, up) {
    const R = this.rootQ;
    _aa.copy(restD).applyQuaternion(R); _ab.copy(restUp).applyQuaternion(R);
    Rig.frameDelta(_aa, _ab, dir, up, _aq);
    this.setWorldQ(bone, _aq.multiply(_aq2.copy(R).multiply(restQ)));
  }
  // two-bone IK: upper and lower (rest keys ku, kl) reach target, bending towards pole
  twoBone(upper, lower, ku, kl, target, pole, restUp) {
    upper.updateWorldMatrix(false, false);
    const H = _tH.setFromMatrixPosition(upper.matrixWorld);
    const leg = ku[0] === 't', l1 = leg ? this.len.th : this.len.ua, l2 = leg ? this.len.ca : this.len.fa;
    const dn = _tD.subVectors(target, H); let dist = dn.length(); dn.divideScalar(dist || 1);
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const p = _tP.copy(pole).addScaledVector(dn, -pole.dot(dn));
    if (p.lengthSq() < 1e-6) p.copy(Y).addScaledVector(dn, -dn.y);
    p.normalize();
    const knee = _tK.copy(H).addScaledVector(dn, a).addScaledVector(p, h);
    const end = _tE.copy(H).addScaledVector(dn, dist);
    this.aim(upper, this.rest[ku].q, this.restDir[ku], restUp, _tU.subVectors(knee, H).normalize(), p);
    this.aim(lower, this.rest[kl].q, this.restDir[kl], restUp, _tU.subVectors(end, knee).normalize(), p);
    return end;
  }
  // a bone turned part of the way from qa to qb, on top of its rest orientation
  blendBone(bone, key, qa, qb, f) {
    if (!bone) return;
    _bq.copy(qa); if (f > 0) _bq.slerp(qb, f);
    this.setWorldQ(bone, _bq.multiply(this.rest[key].q));
  }

  // ---- the pose, every frame ---------------------------------------------------------------------------------------
  // S: { p, q (body), state, edge, crouch, tuck, brake, press, grab, pose, tweak, sw, speed, vel, balance, t, shift,
  //      skate, skateT, absorb, landT, lookBack, railAng, railPress, turn, slide, tAir } (network riders send fewer)
  // Every pose parameter that follows the controls goes through a spring (motion.js), so a change of input moves
  // through the poses in between. The body leans against the snow's push (into a turn, back in a stop), worked out
  // from how the velocity changes, so it is the same for the local rider, a replay and a network rider.
  update(S, dt) {
    if (!this.ready) return;
    this._frame = (this._frame || 0) + 1;
    dt = dt > 0 ? Math.min(dt, 0.05) : 0;
    this._dt = dt;
    // another ride poses its own way (Rig.poser[kind](rig, S, dt), registered by its module, e.g. board.js); it can use
    // placeBody, setWorldQ, aim, twoBone, blendBone, curl, placeHead and flushTree like the skier's pose below
    const pf = this.kind !== 'ski' ? Rig.poser[this.kind] : null;
    if (pf) { pf(this, S, dt); this.afterPose(S); return; }
    const P = this.p, sp = springBank(P, dt);
    let st = S.state || 'ground';
    const t = S.t !== undefined ? S.t : (this._t = (this._t || 0) + dt);
    if (st === 'lift' && !((S.liftSit ?? 1) < 0.01 && S.liftFeet)) { this.seated(S, dt, sp, t); this._pst = st; this._pvOk = false; this._pq = null; return; }
    if (st === 'lift') {
      const W = this._wait || (this._wait = { vel: new THREE.Vector3() }), v = W.vel;
      Object.assign(W, S); W.p = S.liftFeet; W.state = 'ground'; W.speed = 0; W.vel = v; W.crouch = S.liftKind === 'tbar' ? 0.34 : 0.22; W.edge = W.brake = W.press = W.lazy = W.skate = 0;
      W.oneFoot = W.together = W.pushing = 0; W.landHit = 0; W.onLift = true;   // (onLift: fpEase takes the place as it is)
      S = W; st = 'ground';
    }
    const air = st === 'air', rail = st === 'rail', crash = st === 'crash', ground = st === 'ground';
    /* on a T-bar (2026-11-08, tbar.js gives S.tbar { stem, hand }): standing on the skis, knees soft, the bar behind the
       thighs and the hips sat back a little against it, one hand on the stem (hand: 'L' or 'R', or -1 / 1 for left /
       right; tbar.js's on, 0..1, how far it has the bar), the other holding both poles beside the hip */
    const tbOn = S.liftKind === 'tbar' && S.tbar && S.tbar.stem, tbW = sp('tbW', tbOn ? (typeof S.tbar.on === 'number' ? clamp(S.tbar.on, 0, 1) : S.tbar.on === false ? 0 : 1) : 0, 14);
    const tbK = tbOn ? ((S.tbar.hand === 'L' || S.tbar.hand === -1) ? 0 : 1) : (this._tbK ?? 1); this._tbK = tbK;
    if (tbOn) (this._tbStem || (this._tbStem = V())).copy(S.tbar.stem);
    const vel = S.vel || ZERO, speed = S.speed !== undefined ? S.speed : vel.length();
    if (!P.crouch) { this._pq = null; this._pvOk = false; this._pst = st; this.lastE = 0; }   // the springs were cleared
    // ---- the body's frame, at the feet
    const body = this.body, BP = body.position, b = this.b;
    const R = this.placeBody(S), qi = _qi.copy(R).invert();
    // ---- what the body is doing: how fast it turns (from the last frame's orientation), the snow's push on it
    const changed = this._pst !== st;
    let wx = 0, wy = 0, wz = 0;
    if (this._pq && dt > 0 && !changed) {
      const d = _q1.copy(this._pq).invert().multiply(R), g = (d.w < 0 ? -2 : 2) / dt;
      wx = d.x * g; wy = d.y * g; wz = d.z * g;
      if (wx * wx + wy * wy + wz * wz > 450) wx = wy = wz = 0;            // a jump (a respawn, a reset), not a rotation
    }
    (this._pq || (this._pq = new THREE.Quaternion())).copy(R);
    const Wx = sp('wx', wx, 14), Wy = sp('wy', wy, 14), Wz = sp('wz', wz, 14);  // body frame: + front flip, + left, + roll right
    /* (2026-11-08, for butters "smooth, no jerk", and the body "less robotic") on the snow and rails the chest keeps a
       little of its own turn when the skis' turning changes at once (into or out of a butter, a slide, a landing's skid):
       the change of the turn rate is taken off the chest's own spring, which brings it back round over a moment */
    if ((ground || rail) && !changed && P.chYawF && this._wyG !== undefined) { const dw = clamp(wy - this._wyG, -4, 4); P.chYawF.v -= dw * 0.55; if (P.pelYawF) P.pelYawF.v -= dw * 0.3; }
    this._wyG = ground || rail ? wy : undefined;
    // a spin slowing down (opening up to stop it): the arms go out
    const open = sp('open', air && dt > 0 ? clamp((Math.abs(this._pWy || 0) - Math.abs(Wy)) / dt * 0.12, 0, 1) : 0, 10);
    this._pWy = Wy;
    /* the air, loose (2026-11-03, for "more human like rather than robot like" and flips that look "lively and loose
       rather than stiff"): how fast the rotation changes, through an underdamped spring, so the skis and legs lag a
       flip or spin thrown and swing past when it stops; how much of a front or back flip the body is in (a tuck, the
       arms up for a back flip, reaching for the skis in a front flip), the throw that starts one (the head and chest
       thrown back, or forward) and the opening that ends it (legs and arms out); and in a straight air with nothing
       held, a slow loose sway through the chest, arms and legs */
    const aRx = air && dt > 0 && this._pWx !== undefined ? clamp((Wx - this._pWx) / dt, -40, 40) : 0;
    const aRy = air && dt > 0 && this._pWy2 !== undefined ? clamp((Wy - this._pWy2) / dt, -40, 40) : 0;
    this._pWx = Wx; this._pWy2 = Wy;
    const Ax = sp('ax', aRx, 8, 0.5), Ay = sp('ay', aRy, 8, 0.5);
    const flF = sp('flF', air ? smoothstep(0.7, 4.2, Wx) : 0, 7, 0.75), flB = sp('flB', air ? smoothstep(0.7, 4.2, -Wx) : 0, 7, 0.75);
    const throwF = sp('thF', air && Wx > 0.5 && aRx > 0 ? clamp(aRx / 6, 0, 1) : 0, 9, 0.6);
    const arch = sp('arch', air && Wx < -0.5 && aRx < 0 ? clamp(-aRx / 6, 0, 1) : 0, 9, 0.6);
    const opening = sp('opening', air && Math.abs(Wx) > 0.5 && aRx * Wx < 0 ? clamp(Math.abs(aRx) / 6, 0, 1) : 0, 8, 0.6);
    const ub = _ub.set(0, 1, 0).applyQuaternion(R);
    this._gT = ground && !changed ? (this._gT || 0) + dt : 0;
    let sx = 0, sz = 0, an = 0;
    if (ground && this._gT > 0.06 && dt > 0 && this._pvOk) {
      // what the snow does to the body: its acceleration less gravity and the air's drag
      const a = _acc.subVectors(vel, this._pv).divideScalar(dt);
      an = clamp(a.dot(ub), -15, 30);
      a.y += 9.81; a.addScaledVector(vel, 0.0042 * speed); a.applyQuaternion(qi);
      sx = clamp(a.x, -13, 13); sz = clamp(a.z, -9, 9);
    }
    this._pv.copy(vel); this._pvOk = true; this._pst = st;
    const Sx = sp('sx', sx, 10), Sz = sp('sz', sz, 9), An = sp('an', an, 10);
    const vb = _vb.copy(vel).applyQuaternion(qi);
    // the legs lean with the push: into a turn by v^2/R, back against a stop, upright to gravity standing across a slope
    const phi = clamp(Math.atan2(-Sx, 9.81), -0.75, 0.75), psi = clamp(Math.atan2(Sz, 9.81), -0.35, 0.25);
    const brake = sp('brake', ground ? S.brake || 0 : 0, 10), tuck = sp('tuck', S.tuck || 0, 9);
    /* landing straight into a butter or a lazy boy (2026-11-08: S or N held through a landing): the skis and the body take
       its shape as the snow comes, so the landing goes into it in one move. Let go of a butter, the skis come back down
       more slowly than they went into it, as they settle out of a sideways landing (they snapped flat in a frame or two) */
    const lzIn = air && S.landInto ? 1 - smoothstep(0.08, 0.45, this.timeToGround(S.p, vel)) : 0;
    const pressTg = (rail ? S.railPress : ground ? S.press : S.landInto === 'nose' ? lzIn : S.landInto ? -lzIn : 0) || 0;
    const press = sp('press', pressTg, Math.abs(pressTg) < Math.abs(P.press ? P.press.x : 0) - 0.02 ? 7 : 14);
    // a lazy boy (S on the snow in Shredsauce Controls): sat right back on the tails, the tips high
    const lazy = sp('lazy', ground ? S.lazy || 0 : S.landInto === 'lazy' ? lzIn : 0, 8);
    /* (2026-11-05, for "make it so that the lazyboy is actually a lazyboy where your hand drags the snow like a hand drag
       and you lay back a little bit"): sat right down and back over the tails, the chest laid back and rolled to one
       side, that hand dragging on the snow beside the hip, the other arm out in front for balance. The hand is the
       one on the inside of the turn it starts in (the right one going straight) and stays for the whole lazy boy. */
    if (ground && S.lazy && !this._lzOn) this._lzK = (S.edge || 0) < -0.1 ? 0 : 1;
    this._lzOn = ground && !!S.lazy;
    const lzS = (this._lzK ?? 1) === 0 ? -1 : 1;
    // ---- skating: V strides (one ski pushed out and back each half cycle), double-pole pushes when faster
    const skate = sp('skate', ground ? S.skate || 0 : 0, 9);
    /* one foot and feet together (2026-11-08, R and E held on the snow or a rail): riding on one ski, the other lifted with
       its knee up and the weight right over the standing boot, the arms out for balance (oneS: the side stood on, -1 left,
       1 right); or the skis pressed together, the knees and boots touching */
    const oneF = sp('oneF', ground || rail ? S.oneFoot || 0 : 0, 12), oneS = (S.oneSide || 1) < 0 ? -1 : 1;
    const tog = sp('tog', ground || rail ? S.together || 0 : 0, 12) * (1 - oneF);
    let skT = S.skateT;
    if (skT === undefined && (S.pushing || 0) > 0.02 && S.pushT !== undefined) skT = S.pushT;   // (another rider's push: its phase, P)
    if (skT === undefined) { if (skate > 0.01) this._skT = (this._skT || 0) + dt * (1.2 + 0.05 * speed); skT = this._skT || 0; }
    const poleK = smoothstep(4.5, 8, speed), strideW = skate * (1 - poleK), dpW = skate * poleK;
    const hc = skT * 2, pushS = (Math.floor(hc) & 1) ? -1 : 1, u = hc - Math.floor(hc);
    const strk = Math.sin(Math.PI * u) * strideW;                         // the hips' sway: a sine over the whole cycle
    const strk2 = Math.sin(Math.PI * u) ** 2 * strideW;                   // each leg's push: no kink where the legs swap
    const lift = (u > 0.4 ? Math.sin(Math.PI * (u - 0.4) / 0.6) ** 2 : 0) * strideW;
    const u2 = skT - Math.floor(skT), crunch = Math.sin(Math.PI * clamp(u2 / 0.5, 0, 1)) * dpW;
    const dpK = u2 < 0.45 ? smooth01(u2 / 0.45) : 1 - smooth01((u2 - 0.45) / 0.55);   // 0 poles planted ahead, 1 pushed back
    // ---- the skis' roll: onto the edges the steering asks for, and in a skid onto the edges the slide asks for (the
    // trailing ones), so a hockey stop is on its uphill edges and a transition out of a skid rolls over as it comes round
    const slipX = ground ? vb.x : 0;
    if (Math.abs(slipX) > 0.6) this._slip = slipX > 0 ? 1 : -1;
    const slipK = smoothstep(0.7, 2.8, Math.abs(slipX));
    let eT = 0;
    if (ground) {
      const eIn = (S.edge || 0) * (0.5 + 0.45 * smoothstep(1, 10, speed));
      eT = eIn + (clamp(slipX / 3.5, -1, 1) * 0.9 - eIn) * slipK + brake * 0.22 * (this._slip || 1) * (1 - slipK);
      // the edges that hold are the ones the snow pushes against: the roll never goes against the legs' lean
      if (phi * eT >= 0) { if (Math.abs(eT) < Math.abs(phi) * 1.1) eT = phi * 1.1; }
      else eT += (phi * 1.1 - eT) * smoothstep(0.06, 0.3, Math.abs(phi));
    }
    const edge = sp('edge', eT, 15);
    const absorb = S.absorb || 0;
    const tt = t + this.ph;                                                // this rider's own idle clock
    this._airT = air ? (changed ? 0 : (this._airT || 0) + dt) : 0;
    // just off the snow the legs drive straight (the pop, or rolling off a lip), then the knees come up
    const popK = air ? smooth01(this._airT / 0.04) * (1 - smoothstep(0.1, 0.3, this._airT)) : 0;
    // (the last takeoff, P's: how hard the pop was, how deep the crouch before it, a late pop; for the reactions below)
    const TO = S.takeoff, toE = air && TO && TO.t < 0.6 ? 1 - smoothstep(0.12, 0.6, TO.t) : 0;
    const toPop = toE ? clamp(TO.pop || 0, 0, 1) * toE : 0, toSoft = toE && TO.how !== 'rail' ? (1 - clamp(TO.pop || 0, 0, 1)) * toE : 0, toLate = toE && TO.how === 'late' ? toE : 0;
    // turning on a rail: the skis swivel under a steadier upper body, the knees come up a little (a small hop)
    const ra = S.railAng || 0;
    const raRate = rail && this._wasRail && dt > 0 ? Math.abs(wrapPi(ra - (this._pra || 0))) / dt : 0;
    const swapK = sp('swap', rail ? clamp((raRate - 1.5) / 4, 0, 1) : 0, 16);
    /* the rail's jolts (2026-11-05, for the "ski schat" on a rail): locking onto a rail or box, and the skis setting
       down at the end of a swap, the knees take it in a quick dip, the chest goes over them and the arms flick out;
       coming off, a small pop. Worked out here from the state (so riders in a room and replays have it too), unless
       main.js just passed the physics' own rail event (react) */
    const now = t;
    if (rail && !this._wasRail && !(now - (this._evAt ?? -9) < 0.25)) this.react('railOn', clamp(0.5 + speed / 15, 0.7, 1.2), true);
    if (swapK > 0.55) this._swapHi = true;
    if (rail && this._swapHi && swapK < 0.3) { this._swapHi = false; if (!(now - (this._evSw ?? -9) < 0.5)) this.react('railSwap', 0.8, true); }
    if (!rail && this._wasRail && !(now - (this._evAt ?? -9) < 0.25)) this.react('railOff', 0.5, true);
    if (!rail) this._swapHi = false;
    this._now = now;
    const rk = P.rk ? clamp(P.rk.to(0, 14, dt), -0.4, 1.3) : 0;
    const raV = rail && this._wasRail && dt > 0 ? clamp(wrapPi(ra - (this._pra || 0)) / dt, -12, 12) : 0;
    const comp = ground ? clamp(An * 0.008, -0.05, 0.13) : 0;           // bumps and transitions press the knees
    const landX = ground ? absorb * 0.7 : 0;                            // a landing goes into the knees
    const settled = smoothstep(0.8, 2.0, S.landT ?? 9);
    const bob = (ground ? 0.04 * (1 - 0.6 * skate) * settled : rail ? 0.045 : 0) * wob(tt * (rail ? 4.2 : 3.1), 1.3);
    const groove = ground ? 0.07 * (1 - smoothstep(0.3, 0.8, Math.abs(S.edge || 0))) * (1 - tuck) : 0;
    const brakeC = brake * 0.12 * smoothstep(0.6, 3, speed);             // stopped, the stop's crouch eases off
    // ---- grabs and positions
    const gid = air ? (S.grab || S.pose || null) : null;
    const gd = gid ? grabDef(gid, S.tweak || '') : null;
    if (gd) this.lastG = gd;
    this.grabHeld = gid && gid === this.gid ? (this.grabHeld || 0) + dt : 0; this.gid = gid;
    const gW = sp('gw', gd ? 1 : 0, gd ? 13 : 9);
    /* flips (2026-11-05, for "a laid out backflip when you press the backwards arrow in the air and ... a tuck frontflip
       when you press the forward arrow"): a back flip is laid out (the body long and straight, the arms out to the
       sides, a slight arch, the head back) and a front flip tucked (the knees pulled to the chest, the hands on the
       shins, the chin in), unless a grab or a position is held */
    const lay = flB * (1 - gW), tkF = flF * (1 - gW);
    /* spinning past a 180 with no grab, the arms come in close to the body, tighter the faster the spin (they go out
       again as it slows: open) */
    this._spinA = air && !changed ? (this._spinA || 0) + Math.abs(Wy) * dt : 0;
    const armsIn = sp('armsIn', air ? smoothstep(2.7, 3.5, this._spinA) * clamp(0.35 + Math.abs(Wy) / 9, 0, 1) * (1 - gW) * (1 - 0.7 * open) : 0, 9);
    let cT = (S.crouch ?? 0.3) + comp + brakeC + crunch * 0.16 + strk2 * 0.05 + groove + landX + bob + swapK * 0.16 + 0.08 * lazy;
    if (air && (S.grab || S.pose)) cT = gd && gd.crouch !== undefined ? gd.crouch : Math.max(cT, 0.72);   // a grab's crouch at once (the physics eases into it; a straight-legged position its own)
    if (air) { cT += (0.06 - cT) * 0.9 * lay; cT += (0.97 - cT) * tkF; }
    if (air) cT += (0.04 - cT) * popK;
    const crouch = clamp(sp('crouch', clamp(cT, 0, 1), popK > 0.2 || landX > 0.03 ? 30 : 22) + 0.36 * rk, 0, 1);
    // the landing coming: the legs reach for the snow, so the skis are on it when the body gets there
    const prep = air ? 1 - smoothstep(0.09, 0.36, this.timeToGround(S.p, vel)) : 0;
    const ext = sp('ext', air ? 1 - prep : 0, air ? 28 : 32);
    const airW = sp('airW', air ? 1 : 0, air ? 10 : 9), railW = sp('railW', rail ? 1 : 0, 12), crashW = sp('crash', crash ? 1 : 0, 6);
    // (seen in first person the hands ride a little further forward and up, where a skier keeps them and can see them
    // at the bottom of the view; only this rider's own eyes see it, 2026-11-06)
    const fpW = sp('fpW', this.fp ? 1 : 0, 6);
    // a shifty: the lower body turned across under the body, the chest the other way (unwound before the landing)
    const lowYaw = sp('lowYaw', air ? -(S.shift || 0) * 1.3 : 0, air ? 15 : 20, air ? 0.8 : 1) * smooth01(ext * 1.6);
    // the air shape of each ski: the grab's or position's, or loose straight-air skis
    // (a held grab breathes: the grabbed ski pulled in a little further and let back, once it is set)
    const twk = 1 + 0.22 * smooth01((this.grabHeld - 0.45) / 0.75) + 0.05 * Math.sin(this.grabHeld * 3.4) * smooth01(this.grabHeld / 0.6);
    const flow = air ? (1 - gW) * (1 - smoothstep(1.2, 3.5, Math.abs(Wx) + Math.abs(Wy))) : 0;
    /* a screaming seaman (2026-11-08): a daffy first, the straight legs crossed over to the other sides once it is set,
       and on letting go a daffy again for a moment to uncross them (seaD: how much of the daffy, in or out) */
    let seaD = 0, seaG = null;
    if (gd && gd.kind === 'seaman') { const x = smooth01((this.grabHeld - 0.12) / 0.3); this._seaX = x; this._seaOut = -1; seaD = 1 - x; seaG = gd; }
    else if (air && (this._seaX || 0) > 0.3) { this._seaOut = 0; this._seaX = 0; }
    else if (!air) { this._seaOut = -1; this._seaX = 0; }
    if (!seaG && air && this._seaOut >= 0) { this._seaOut += dt; seaD = 1 - smooth01(this._seaOut / 0.32); seaG = grabDef('seaman'); if (seaD <= 0) this._seaOut = -1; }
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, A = this.air6[k], N = SKN[k];
      if (gd) {
        const g = gd.ski[k ? 'R' : 'L']; for (let i = 0; i < 6; i++) TG[i] = g[i] * (i < 3 ? twk : 1 + (twk - 1) * 0.8);
        if (seaG && seaD > 0) { const dg = seaG.daffy[k ? 'R' : 'L']; for (let i = 0; i < 6; i++) TG[i] += (dg[i] - TG[i]) * seaD; }
        // a held ski is never pulled past about 60 degrees tip or tail up (a tweaked mute stood it vertical behind the
        // back); a tail grab's ski goes further, its tail up at the hand
        const cap = gd.kind === 'blunt' ? 3 : gd.kind === 'tail' ? 1.5 : 1.05;
        if (gd.hands.length) TG[4] = cap * Math.tanh(TG[4] / cap);
      }
      else if (air) {
        TG[0] = -s * 0.012 + s * 0.045 * flow * wob(tt * 0.8, 21 + k * 3.1); TG[1] = 0.015 * Math.sin(t * 1.3 + s) + 0.07 * flow * wob(tt * 1.35, 3 + k * 2.7);
        TG[2] = s * 0.035 * Math.sin(t * 1.9 + 0.7) + 0.1 * flow * wob(tt * 1.05, 7 + k * 1.9);
        TG[3] = -s * 0.035 + 0.04 * Math.sin(t * 1.25 + s * 0.9) - clamp(Wy * 0.012, -0.08, 0.08) + 0.1 * flow * wob(tt * 0.9, 2 + k * 4.2);
        TG[4] = -0.13 + 0.05 * Math.sin(t * 1.6 + s * 0.8) + clamp(Wx * 0.02, -0.12, 0.12) + 0.13 * flow * wob(tt * 1.2, 5 + k * 3.3);
        TG[5] = s * 0.05 * Math.sin(t * 1.1 + 0.3) + s * 0.05 * flow * wob(tt * 1.0, 9 + k * 2.2);
        // a flip: laid out back (the skis square to the long body, the feet a little behind it in the arch, the legs
        // together), tucked front (the skis brought up under the seat, tails a little up)
        TG[4] += 0.12 * lay + 0.2 * tkF; TG[2] += -0.09 * lay + 0.04 * tkF; TG[1] += 0.03 * tkF; TG[0] -= s * 0.01 * lay;
        // each ski a little apart in a flip, one lagging the other (loose legs, not one block; less in a layout)
        const fl = 0.35 * lay + tkF;
        TG[4] += s * 0.16 * fl * Math.sin(tt * 2.3 + k); TG[2] += s * 0.07 * fl * Math.sin(tt * 1.7 + 0.5); TG[3] += s * 0.08 * fl;
        if (seaG && seaD > 0) { const dg = seaG.daffy[k ? 'R' : 'L']; for (let i = 0; i < 6; i++) TG[i] += (dg[i] - TG[i]) * seaD; }
      } else for (let i = 0; i < 6; i++) TG[i] = 0;
      // the skis trail the rotation: a flip or spin thrown leaves them behind, and they swing past when it stops (the
      // second ski a little later than the first); held in a grab, half as much
      if (air) { const lag = (gd ? 0.5 : 1) * (1 + 0.35 * k); TG[4] += clamp(-Ax * 0.04 * lag, -0.45, 0.45); TG[3] += clamp(-Ay * 0.018 * lag, -0.3, 0.3); TG[2] += clamp(-Ax * 0.012 * lag, -0.12, 0.12); }
      for (let i = 0; i < 6; i++) A[i] = sp(N[i], TG[i], gd ? 14 + 2 * k : 11 - 1.5 * k, air ? (gd ? 0.74 : 0.72) : 1);
    }
    const kneeUp = sp('kneeUp', (gd ? 0.12 + 0.5 * gd.tuck : air ? Math.max(0, (0.13 + 0.28 * crouch + clamp(Math.abs(Wx) * 0.02, 0, 0.1) + clamp(Math.abs(Wy) * 0.008, 0, 0.05)) * (1 - 0.9 * lay) + 0.42 * tkF - 0.16 * opening + 0.08 * flow * wob(tt * 1.15, 17.3) + 0.1 * (TO && toE ? clamp(TO.crouch || 0, 0, 1) : 0) * toE) : 0) * (1 - popK), gd ? 15 : 12, air ? 0.8 : 1);
    // ---- skis, in the body's frame
    // (the feet a little under hip width: a relaxed, narrow park stance)
    const stance = (0.094 + 0.018 * crouch) * (1 - 0.45 * tog);
    this.railC2 = rail ? Math.cos(ra) ** 2 : 1;
    // a butter or press tips the skis about the pressed end (on a rail the contact under the boots in a slide); the
    // pivot's place eases between them, so leaving a box mid-press does not snap the skis
    const zpL = sp('zpL', rail ? 0.55 * this.railC2 : 0.6, 12), flexW = sp('flexW', ground ? 1 : 0, 12);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, ski = this.sk[k], pos = ski.pos, q = ski.q, A = this.air6[k];
      pos.set(s * stance, 0, 0);
      let yawV = 0, roll = edge;
      if (strideW > 0.01) {
        yawV = s * 0.24 * strideW;                                         // the V: both tips out
        if (s === pushS) { pos.x += s * 0.2 * strk2; pos.z -= 0.12 * strk2; roll += s * 0.32 * strk2; yawV += s * 0.1 * strk2; pos.y += 0.06 * lift; }
        else pos.x -= s * 0.04 * strk2;                                    // the gliding ski under the body
      }
      if (ground && edge * s < 0) pos.z += 0.07 * Math.abs(edge);          // the inside ski leads a little
      this._roll[k] = roll;
      if (yawV) { pos.x += 0.5 * Math.sin(yawV); pos.z += 0.5 * (Math.cos(yawV) - 1); }     // the V turns about the tails
      q.setFromAxisAngle(Y, yawV).multiply(_q1.setFromAxisAngle(Z, roll));
      pos.y += Math.abs(Math.sin(roll)) * SKI.waist * 0.5;
      // a butter (or a press on a box or rail, or a lazy boy's tails): pitched about the pressed end, which stays down;
      // on the snow the ski bends so the pressed end lies flat on it (flexY) and the other end stands up
      // (a lazy boy alone used to leave the skis flat: it was only seen with a press)
      // (Shredsauce's S presses the tails as well as the lazy boy: the lazy boy's own shape wins, not the two added)
      const pa = press * (ground ? 0.5 : 0.42) * (1 - lazy) - 0.56 * lazy;
      if (Math.abs(pa) > 0.002) {
        const zp = (pa > 0 ? 1 : -1) * zpL;
        q.multiply(_q1.setFromAxisAngle(X, pa));
        pos.y += zp * Math.sin(pa); pos.z += zp * (1 - Math.cos(pa));
        const kf = Math.tan(Math.abs(pa)) * flexW, fy = flexY(zp, kf, kf, FLEX_ZB, zp);
        pos.y -= fy * Math.cos(pa); pos.z -= fy * Math.sin(pa);
        this._flex[k] = pa > 0 ? kf : -kf;
      } else this._flex[k] = 0;
      // (one foot: the other ski lifted off the snow or the rail, its knee up, its tip a little up, flat again)
      if (oneF > 0.01 && s === oneS) { pos.y += 0.24 * oneF; pos.z -= 0.06 * oneF; pos.x += s * 0.05 * oneF; q.multiply(_q1.setFromAxisAngle(X, -0.22 * oneF)); this._flex[k] *= 1 - oneF; }
      // the air: knees up, the shape on top
      if (ext > 0.001) {
        const legW = air ? 0.05 * wob(tt * 2.1, 5 + k * 3) * (1 - 0.6 * gW) * (1 - popK) : 0;   // loose legs in a straight air
        pos.x += A[0] * ext; pos.y += (kneeUp + A[1] + legW) * ext; pos.z += A[2] * ext;
        q.multiply(_q1.setFromAxisAngle(Y, A[3] * ext)).multiply(_q1.setFromAxisAngle(X, A[4] * ext)).multiply(_q1.setFromAxisAngle(Z, A[5] * ext));
      }
      if (Math.abs(lowYaw) > 1e-4) { _q1.setFromAxisAngle(Y, lowYaw); pos.applyQuaternion(_q1); q.premultiply(_q1); }
      if (crashW > 0.01) { pos.y += 0.2 * crashW; q.multiply(_q1.setFromAxisAngle(Y, s * 0.6 * crashW)); }
      if (swapK > 0.01) pos.y += 0.05 * swapK;                             // a swap unweights the skis off the rail
    }
    // ---- the pelvis: over the boots at the crouch's height, the leg column leaning with the snow's push
    const A0 = this.ankleH + SKI.thick + SKI.stack;
    let H = A0 + this.legLen * 0.98 * (0.95 - (0.5 * crouch + 0.2 * tuck)) + (this.pelvisY - this.hipY);
    H -= 0.5 * this.legLen * lazy;                                      // a lazy boy sits right down
    H += (0.92 * (1 - crouch * 0.35) + (this.pelvisY - this.hipY) * 0.5 - H) * airW;
    const colL = H - A0;
    // skating: the hips ride over each gliding ski in turn; riding and on rails the weight never quite stops moving
    let pelX = -Math.sin(phi) * colL - pushS * 0.14 * strk + (0.016 + 0.014 * railW) * wob(tt * (1.7 + 0.9 * railW), 4.4) * (1 - airW) - oneS * stance * 0.95 * oneF;
    let pelY = A0 + colL * Math.cos(phi) * Math.cos(psi);
    const pelZ = -0.08 - 0.12 * crouch + (press > 0 ? 0.42 : 0.28) * press * (1 - lazy) - 0.05 * tuck + Math.sin(psi) * colL * 0.8 - 0.8 * lazy - FP.hips * fpW * (1 - airW) - 0.07 * tbW;    // (a lazy boy: the hips back over the tails, the legs reaching forward to the boots)
    // ---- where the upper body and head go
    let face = 0;
    if (ground && speed > 0.8) face = clamp(S.sw ? Math.atan2(-vb.x, -vb.z) : Math.atan2(vb.x, vb.z), -1.5, 1.5) * smoothstep(0.8, 2.5, speed);
    if (S.sw && ground && Math.abs(face) > 0.15) this._swSide = face > 0 ? 1 : -1;
    const swSide = (this._swSide || 1) * (S.lookBack ? -1 : 1), swK = sp('swK', S.sw && ground ? 1 : 0, 6);
    // now and then a look round, riding along
    const gl = this._gl;
    if (t > gl.next || t < gl.next - 30) { gl.yaw = (Math.random() - 0.5) * 0.9; gl.pitch = (Math.random() - 0.35) * 0.2; gl.until = t + 0.6 + Math.random() * 0.8; gl.next = gl.until + 2.5 + Math.random() * 4; }
    const glance = t < gl.until && ground && Math.abs(S.edge || 0) < 0.5 && brake < 0.2 && skate < 0.2;
    // in a spin the shoulders and head lead well ahead of the hips; crouched with a spin wound up, they coil the other
    // way first (windup + is a spin to the right, so the shoulders turn left), and unwind into the spin at the pop
    const spinLead = sp('spinLead', air ? clamp(Wy * 0.09 + (P.wy ? P.wy.v : 0) * 0.035, -0.8, 0.8) : 0, 16);
    const wind = sp('wind', ground ? clamp(S.windup || 0, -1, 1) : 0, 10);
    const pressN = Math.max(0, press), pressT = Math.max(0, -press);
    let twT, sdT, lnT, hyT, hpT;
    if (air) {
      // a grab held, the body moves round it a little; a straight air sways loosely; a flip tucks the chest to the knees
      // after the throw that starts it (back: head and chest thrown back; front: thrown forward), the head tucked in a
      // front flip and back, spotting, in a back flip
      const sway = 0.08 * gW + 0.2 * flow;
      twT = (gd ? gd.twist : 0) + sway * wob(tt * 1.25, 8.8);
      sdT = (gd ? gd.side : clamp(Wz * 0.03, -0.2, 0.2)) + (0.05 * gW + 0.1 * flow) * wob(tt * 1.05, 6.1);
      lnT = (gd ? gd.lean : (0.16 + clamp(Wx * 0.045, -0.35, 0.3)) * (1 - lay) + 0.12 * prep + 0.62 * tkF - 0.32 * lay) + 0.28 * popK
        + 0.4 * throwF - 0.6 * arch * (1 - 0.5 * lay) - 0.15 * opening + 0.1 * flow * wob(tt * 0.85, 4.4);
      hyT = clamp(Wy * 0.08, -0.55, 0.55) + 0.12 * flow * wob(tt * 0.6, 12.5);
      hpT = 0.08 + 0.3 * prep + 0.45 * tkF - 0.5 * lay - 0.3 * arch + 0.1 * flow * wob(tt * 0.7, 3.3) + (gd && gd.head ? gd.head * (1 - prep) : 0);   // spotting the spin round, then the landing
      /* (2026-11-08, grabs against photos: riders look at the grab in most of them, the head turned and tipped down towards
         the point the hand holds; gd.look says how much, 0.45 if not given, and the landing coming takes the eyes back) */
      if (gd && gd.hands.length) {
        const h = gd.hands[0], sk0 = this.sk[h[1] === 'L' ? 0 : 1], gp = _v6.set(0, 0, h[2] * SKI.len * 0.49).applyQuaternion(sk0.q).add(sk0.pos);
        const lk = (gd.look ?? 0.45) * gW * (1 - prep), yT = clamp(Math.atan2(gp.x, gp.z), -1.3, 1.3), pT = Math.atan2(H + 0.5 - gp.y, Math.hypot(gp.x, gp.z));
        hyT += lk * clamp(yT - 0.6 * twT, -1, 1); hpT += lk * 0.7 * clamp(pT - 0.4, -0.3, 0.9);
      }
    } else if (rail) {
      // the chest's angle to the rail (alpha) is its own slow spring: a swap swivels the skis under it, and in a slide
      // it is turned most of the way down the rail
      const aT = ra - 1.2 * Math.sin(ra);
      if (!this._wasRail || !P.alpha) { const tw0 = P.tw ? P.tw.x : 0; (P.alpha || (P.alpha = new Spring(0))).set(tw0 + ra); }
      const aCur = P.alpha.x, alpha = sp('alpha', aCur + wrapPi(aT - aCur), 6);
      twT = wrapPi(alpha - ra);
      sdT = (S.balance || 0) * 0.35 + 0.05 * wob(tt * 2.2, 7.7);           // balance corrections all the way along
      lnT = 0.24 + 0.4 * pressN - 0.25 * pressT;
      // the head looks down the rail over the nearer shoulder (kept until the chest has come right round), and turns
      // with the body while the skis swivel
      const aw = wrapPi(alpha);
      if (Math.abs(aw) < 2.3) this._railLook = aw < 0 ? -1 : 1;
      const look = Math.abs(aw) < 2.3 ? clamp(-aw, -1.45, 1.45) : -(this._railLook || 1) * 1.45;
      hyT = twT + look * (1 - swapK); hpT = 0.12;
    } else {
      twT = face * (0.3 + 0.45 * brake) + swSide * 0.32 * swK + clamp(-Wy * 0.05, -0.22, 0.22) - pushS * 0.12 * strk + wind * 0.6 - lzS * 0.3 * lazy;
      sdT = lzS * 0.95 * lazy;      // (2026-11-05, "further back": less of the lean to the side, more of it back)
      // (a nose butter: the weight far forward over the noses; a tail butter back over the tails)
      lnT = 0.2 + 0.5 * tuck - 0.35 * pressT * (1 - lazy) + 0.75 * pressN + 0.1 * strideW + 0.2 * (S.loading ? 1 : 0) - 1.85 * lazy - 0.14 * tbW;
      hyT = face * (0.85 + 0.12 * brake) + clamp(Wy * 0.22, -0.45, 0.45) + swSide * 1.35 * swK + (glance ? gl.yaw : 0) - wind * 0.45;   // where it is going
      hpT = 0.05 + (glance ? gl.pitch : 0) + 0.42 * lazy;     // (laid back, the chin comes up to look where it goes)
    }
    /* the whole body reacts (2026-11-08, for "the whole body reacts to how you take off, land and fall"): a hard pop
       stands it tall with the arms thrown up, a soft roll-off keeps it folded with the arms out for balance, a late pop
       throws the chest back a moment; a hard landing folds the chest and drops the head, one off to the side turns the
       chest and head to the travel and leans into the skid with the arms thrown out (the arms below); on one ski the
       chest goes over the standing boot (P's takeoff, landHit, landOff, oneFoot) */
    const lE = ground && (S.landHit || 0) > 0 ? 1 - smoothstep(0.05, 0.9, S.landT ?? 9) : 0, lHit = lE * (S.landHit || 0), lOff = lE * clamp(S.landOff || 0, -1.2, 1.2);
    if (toE) { lnT += -0.18 * toPop + 0.14 * toSoft - 0.3 * toLate; hpT += 0.1 * toSoft; }
    if (lE) { lnT += 0.32 * lHit; hpT += 0.3 * lHit; twT -= 0.45 * lOff; sdT += 0.25 * lOff; hyT -= 0.3 * lOff; }
    if (oneF > 0.01) { sdT += oneS * 0.16 * oneF; lnT += 0.05 * oneF; }
    const wB = air && gd ? 13 : 9, zA = air ? 0.75 : 1;                   // a grab's shape comes quickly, swinging a little past
    const tw = sp('tw', twT, air && gd ? 13 : 8.5, zA), sd = sp('sd', sdT, wB, zA), ln = sp('ln', lnT, air ? (popK > 0.1 ? 20 : wB + 2) : 9, zA), hy = sp('hy', hyT, rail ? 7 : 9), hp = sp('hp', hpT, 7, air ? 0.8 : 1);
    const onSnow = 1 - airW;
    // a new trick in the air (S.airSeq, in the order they came): a kick through the body in the way of the change (seqKick)
    const aSeq = air ? S.airSeq : null, nSeq = aSeq ? aSeq.length : 0, lastT = nSeq ? aSeq[nSeq - 1] : '';
    if (air && nSeq && (nSeq !== this._seqN || lastT !== this._seqL) && this._airT > 0.05) this.seqKick(nSeq > 1 ? aSeq[nSeq - 2] : '', lastT, Wx, Wy);
    this._seqN = air ? nSeq : 0; this._seqL = air ? lastT : '';
    // a landing bends the knees with the chest kept up; a transition's compression puts the chest over the knees
    /* one body moving together (2026-11-05, for "more jibbery ... flow as 1 whole body"): the chest follows what the
       hips and legs do through a loose spring of its own (a little behind, swinging a little past), and the head follows
       the chest the same way, so a change runs up the body as one motion instead of every part turning at once */
    /* (seen in first person, 2026-11-06: the chest a little more upright on the snow, so the eyes are over the boots'
       toes rather than over the ski tips, as a skier's are; leaning as the rest of the pose has it, the eyes were half a
       metre ahead of the boots, right over the tips and the hands, and none of them could be seen from the eyes) */
    const lean = sp('leanF', ln - sp('lf', this._lfT || 0, 14) + 0.2 * rk + (0.42 * crouch * (1 - gW) - 0.42 * (landX + absorb) + 0.1 * absorb + 0.45 * crunch + 1.4 * Math.max(0, comp) - FP.lean * fpW) * onSnow, air ? 16 : 11, 0.68) + 0.02 * wob(tt * 1.1, 9.1);
    const idleY = 0.035 * wob(tt * 0.9, 3.7) * onSnow * (1 - railW);      // the shoulders turn a little, riding along
    // (in a grab the hips turn with it too, the grab's own share or a third: not the chest alone, 2026-11-03)
    const hipK = sp('hipK', gd ? (gd.hips ?? 0.35) : 0.3, 10);
    const chYaw = sp('chYawF', tw + spinLead - lowYaw * 0.4, air ? 14 : 10, 0.62) + idleY, pelYaw = sp('pelYawF', tw * (hipK + 0.12 * railW) - spinLead * 0.15, air ? 9 : 16, air ? 0.72 : 1) + lowYaw * 0.55 - pushS * 0.1 * strk;   // (the hips a little behind the chest in the air, 2026-11-08: the turn runs down the body)
    const chRoll = sp('chRollF', phi * 0.3 + sd * 0.6 + pushS * 0.1 * strk, 10, 0.65) + 0.025 * wob(tt * 1.3, 5.2) * onSnow, pelRoll = phi * 0.72 + sd * 0.2, pelPitch = lean * 0.4 * gW;
    // on the snow the outside leg must still reach its boot: the pelvis comes down rather than lifting a ski
    if (airW < 0.5) {
      const hw = this.hipHalf, ca = Math.cos(pelYaw), sa = Math.sin(pelYaw), cb = Math.cos(pelRoll), sb = Math.sin(pelRoll), y0 = pelY;
      for (let k = 0; k < 2; k++) {
        const s = k ? -1 : 1, an2 = this.ankleLocal(this.sk[k], _v2);
        const dx = pelX + s * hw * cb * ca - an2.x, dz = pelZ - s * hw * cb * sa - an2.z, dy = y0 + s * hw * sb - an2.y;
        const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz), d1 = softReach(d0, this.legLen, 0.88, 0.965), dy2 = d1 * d1 - dx * dx - dz * dz;
        if (d1 < d0 && dy2 > 0) pelY = Math.min(pelY, an2.y + Math.sqrt(dy2) - s * hw * sb);
      }
    }
    const pelQ = _pelQ.copy(R).multiply(_q1.setFromAxisAngle(Y, pelYaw)).multiply(_q1.setFromAxisAngle(Z, pelRoll));
    if (Math.abs(pelPitch) > 1e-4) pelQ.multiply(_q1.setFromAxisAngle(X, pelPitch));
    const chQ = _chQ.copy(R).multiply(_q1.setFromAxisAngle(Y, chYaw)).multiply(_q1.setFromAxisAngle(Z, chRoll)).multiply(_q1.setFromAxisAngle(X, lean));
    if (crashW > 0.01) { const fl = crashW * (0.3 + 0.7 * Math.exp(-(S.fallT || 0) * 0.9)); chQ.multiply(_q1.setFromEuler(_eu.set(Math.sin(t * 3.1) * 0.6 * fl, Math.sin(t * 2.3) * 0.5 * fl, Math.cos(t * 2.7) * 0.6 * fl))); }
    // root bone: turned with the pelvis, moved so the pelvis bone lands on its place
    this.setWorldQ(b.root, _q2.copy(pelQ).multiply(this.rest.root.q));
    b.pelvis.updateWorldMatrix(false, false);
    const off = _v2.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v3.setFromMatrixPosition(b.root.matrixWorld));
    this.setWorldPos(b.root, _v3.set(pelX, pelY, pelZ).applyQuaternion(R).add(BP).sub(off));
    // the spine shares the turn from the pelvis to the chest
    this.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
    this.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); this.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); this.blendBone(b.chest, 'chest', pelQ, chQ, 1);
    // the head: steady, eyes kept level, looking where it goes (into the turn, round a spin, down the rail, back riding switch)
    // on the snow and rails the head's aim is against the skis (so the chest's turn is taken off it); in the air it mostly keeps with the body
    const hdYaw = clamp(sp('hdYawF', hy - tw * (1 - 0.4 * airW) + lowYaw * 0.32, 11, 0.7) + 0.06 * wob(tt * 0.7, 2.9) * onSnow, -1.45, 1.45);
    const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, hdYaw)).multiply(_q1.setFromAxisAngle(Z, -chRoll * 0.5)).multiply(_q1.setFromAxisAngle(X, hp - lean * 0.62));
    this.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); this.blendBone(b.head, 'head', hdQ, hdQ, 0);
    this.blendBone(b.clL, 'clL', chQ, chQ, 0); this.blendBone(b.clR, 'clR', chQ, chQ, 0);
    // ---- grabs: which point each hand holds, cross-fading from the one it held before; let go as the landing comes
    const holdOK = ext > 0.55;                                             // let go a moment before touchdown
    this._pt[0].set(0, 0, 0); this._pt[1].set(0, 0, 0); this._hold[0] = this._hold[1] = 0;
    for (let k = 0; k < 2; k++) {
      const side = k ? 'R' : 'L', Hs = this.hs[k];
      let want = null; if (gd) for (const h of gd.hands) if (h[0] === side) want = h;
      const w = sp(HWN[k], want && holdOK ? 1 : 0, want && holdOK ? 22 : 12);
      if (want && want !== Hs.cur && !(Hs.cur && Hs.cur[1] === want[1] && Hs.cur[2] === want[2] && Hs.cur[3] === want[3])) {
        if (Hs.cur && w > 0.05) { Hs.prev = Hs.cur; Hs.f.set(0); } else { Hs.prev = null; Hs.f.set(1); }
        Hs.cur = want;
      }
      Hs.fx = Hs.f.to(1, 13, dt);
      Hs.w = Hs.cur ? w : 0;
      // the grabbed ski is brought up to the hand when the hand cannot reach it (at most 60 cm); while the hand moves to
      // another point the pull moves with it (from the point it held, weighted out, to the new one, weighted in)
      if (Hs.w > 0.02) {
        const ua = k ? b.uaR : b.uaL; ua.updateWorldMatrix(false, false);
        const sh = _v2.setFromMatrixPosition(ua.matrixWorld), reach = (this.len.ua + this.len.fa) * 0.92;
        const f = Hs.prev && Hs.fx < 0.999 ? smooth01(Hs.fx) : 1;
        for (let j = 0; j < 2; j++) {
          const spec = j ? Hs.prev : Hs.cur, wj = (j ? 1 - f : f) * Hs.w;
          if (!spec || wj < 0.01) continue;
          // measured to where the wrist will be (the palm on the edge, the fingers round it), kept inside the arm's soft range
          const kk = spec[1] === 'L' ? 0 : 1, gp = this.skiPoint(this.sk[kk], spec[1], spec[2], spec[3], this.gpB);
          this._hold[kk] = Math.max(this._hold[kk], wj);
          const wp = _v4.copy(gp.pt).addScaledVector(gp.fingers, -0.07).addScaledVector(gp.palm, -0.03), dd = wp.distanceTo(sh);
          if (dd > reach) this._pt[kk].addScaledVector(_v3.subVectors(sh, wp).normalize().applyQuaternion(qi), Math.min(0.6, dd - reach) * wj);
        }
      }
    }
    for (let k = 0; k < 2; k++) {
      const pl = this.pull[k], N3 = PULLN[k];
      pl.set(sp(N3[0], this._pt[k].x, 20), sp(N3[1], this._pt[k].y, 20), sp(N3[2], this._pt[k].z, 20));
      this.sk[k].pos.add(pl);
      // a held ski is kept out of the torso (a straight pull to the shoulder can go through it), as firmly as it is held
      if (this._hold[k] > 0.01) this.clearTorso(this.sk[k], this._hold[k]);
    }
    // keep each ski within its leg's reach, short of full lock (a locked knee snaps when its target moves)
    for (let k = 0; k < 2; k++) {
      const th = k ? b.thR : b.thL; th.updateWorldMatrix(false, false);
      const hip = _v2.setFromMatrixPosition(th.matrixWorld), ank = this.ankleOf(this.sk[k], _v3);
      const dd = ank.distanceTo(hip), L = this.legLen;
      const lim = Math.min(dd, 0.975 * L) + (softReach(dd, L, 0.86, 0.975) - Math.min(dd, 0.975 * L)) * airW;
      if (dd > lim) this.sk[k].pos.addScaledVector(_v4.subVectors(hip, ank).normalize().applyQuaternion(qi), dd - lim);
    }
    // (a few rounds: pushing one ski off the body can bring it to the other)
    if (!ground) for (let it = 0; it < 3; it++) this.separateSkis(Math.max(airW, railW));
    this.placeSki(this.skiL, this.sk[0]); this.placeSki(this.skiR, this.sk[1]);
    // (and a landing bends them a moment, and a hard carve at speed a little, the skis flexing under the weight, 2026-11-05)
    const bendNow = 0.07 * Math.abs(press) * (1 - flexW) + (0.045 * clamp(absorb * 2, 0, 1) + 0.022 * smoothstep(0.3, 0.9, Math.abs(edge)) * smoothstep(5, 14, speed)) * (1 - airW);
    for (let k = 0; k < 2; k++) {
      const s = k ? this.skiR : this.skiL; if (!s) continue;
      if (s.userData.bend) s.userData.bend.value = bendNow;
      const f = s.userData.flex; if (f) { const v = this._flex[k]; f.value.set(v > 0 ? v : 0, v < 0 ? -v : 0, FLEX_ZB, zpL); }
    }
    // ---- legs: to the boots, knees along the skis and pushed into the turn by as much as the edge is past the lean
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, spk = this.sk[k];
      const ank = this.ankleOf(spk, _v5), skiQ = _q2.copy(R).multiply(spk.q);
      const kf = _kd.set(0, 0, 1).applyQuaternion(spk.q); kf.y = 0;
      if (kf.lengthSq() < 0.01) kf.set(0, 0, 1);
      kf.normalize();
      const kneeIn = ground ? clamp(this._roll[k] - phi, -0.9, 0.9) * 0.8 : 0;
      kf.x += s * 0.12 * (1 - 0.75 * tog) - kneeIn; kf.y += 0.25; kf.applyQuaternion(R);
      const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
      this.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', ank, kf, Z);
      this.setWorldQ(ft, _q3.copy(skiQ).multiply(this.rest[k ? 'ftR' : 'ftL'].q));
      const cuff = k ? this.bootR.cuff : this.bootL.cuff;
      const kp = _v2.setFromMatrixPosition(ca.matrixWorld), ap = _v3.setFromMatrixPosition(ft.matrixWorld);
      const shin = _v4.subVectors(ap, kp).normalize();
      cuff.position.copy(ap).addScaledVector(shin, -0.1).addScaledVector(_v6.set(0, 0, 1).applyQuaternion(skiQ), 0.012);
      cuff.quaternion.setFromUnitVectors(Y, shin.negate());
    }
    // ---- the chest kept off the knees (2026-11-05): folded over tucked knees in a grab, the chest went through them and
    // the trousers showed through the jacket's back. The fold is eased back next frame by as much as the nearer knee
    // asks (the angle that puts it 0.24 m from the spine's line), and comes forward again slowly when there is room.
    if (airW > 0.05 && !crash) {
      const A = _ca.setFromMatrixPosition(b.pelvis.matrixWorld), u = _cc.setFromMatrixPosition(b.neck.matrixWorld).sub(A), Ls = u.length();
      u.divideScalar(Ls || 1);
      let dl = -0.03;
      for (let k = 0; k < 2; k++) {
        const kp = _cd.setFromMatrixPosition((k ? b.caR : b.caL).matrixWorld).sub(A), kl = kp.length(), along = kp.dot(u);
        if (along / Ls > 0.2 && kl > 0.05) dl = Math.max(dl, Math.asin(Math.min(1, 0.21 / kl)) - Math.acos(clamp(along / kl, -1, 1)));
      }
      this._lfT = clamp((this._lfT || 0) + clamp(dl, -0.5, 0.5) * Math.min(1, 5 * dt), 0, 0.9);   // (eased: a quicker one swung in and out)
    } else this._lfT = 0;
    // ---- arms: loose and low riding, floating and leading the rotation in the air, out for balance on rails and butters
    // a pole plant: only between proper turns at speed (the last one held a while), and only a flick of the wrist
    const eSign = Math.abs(S.edge || 0) > 0.5 ? Math.sign(S.edge) : 0;
    if (eSign && eSign === this.lastE) this._eHold = (this._eHold || 0) + dt;
    if (ground && eSign && this.lastE && eSign !== this.lastE && speed > 6 && this.poles && (this._eHold || 0) > 0.45 && !(this.plantT < 0.9)) { this.plantK = eSign > 0 ? 1 : 0; this.plantT = 0; }
    if (eSign && eSign !== this.lastE) this._eHold = 0;
    if (eSign) this.lastE = eSign;
    if (!ground) this._eHold = 0;
    if (this.plantT !== undefined && this.plantT < 1) this.plantT += dt;
    const cF = _cF.set(0, 0, 1).applyQuaternion(chQ), cL = _cL.set(1, 0, 0).applyQuaternion(chQ);
    // forward for the hands is level with the body's up, so a chest leaning forward does not drag them down to full reach
    const cFl = _cFl.copy(cF).addScaledVector(ub, -cF.dot(ub)); if (cFl.lengthSq() < 1e-4) cFl.copy(cF); cFl.normalize();
    // in the air the arms lead a spin, on the snow they trail a pivot a little, but lead a butter spin
    const btK = ground ? smoothstep(0.3, 0.7, Math.abs(press)) : 0;
    // (on a rail the arms swing round with a swap, leading it)
    const lead = air ? clamp(Wy * 0.07, -0.6, 0.6) : rail ? sp('raLead', clamp(raV * 0.09, -0.6, 0.6), 12, 0.6) : clamp(Wy * (0.06 * btK - 0.04 * (1 - btK)), -0.5, 0.5);
    const armL = this.len.ua + this.len.fa;
    for (let k = 0; k < 2; k++) {
      const side = k ? 'R' : 'L', s = k ? -1 : 1, Hs = this.hs[k];
      let lat, up, fwd;
      if (air) {
        // relaxed at the waist, a little forward and out; tight to the body in spins and corks, a little higher for a
        // back flip, forward for a front flip, out to stop a spin, forward for the landing
        lat = 0.12; up = -0.44; fwd = 0.15;
        up += clamp(-Wx * 0.015, 0, 0.1); fwd += clamp(Wx * 0.025, 0, 0.12); lat -= clamp(Math.abs(Wx) * 0.01, 0, 0.05);
        lat -= clamp(Math.abs(Wy) * 0.02 + Math.abs(Wz) * 0.02, 0, 0.11);
        // (the arms trail a spin or flip as it starts and swing past as it stops: its change of rate, Ay and Ax)
        fwd += clamp(-s * Ay * 0.012, -0.12, 0.12); up += clamp(Ax * 0.01, -0.1, 0.1);
        lat += 0.13 * open; up += 0.06 * open;
        lat += 0.02 * prep; fwd += 0.14 * prep; up += 0.04 * prep;
        fwd += 0.12 * popK; up += 0.1 * popK;                               // the arms swing up and forward with the pop
        up += 0.16 * toPop + 0.05 * toSoft; fwd += 0.06 * toPop; lat += 0.16 * toSoft;   // (thrown up off a hard pop, out for balance off a roll)
        // a back flip: up over the head, thrown higher at its start; a front flip: reaching down the shins for the skis;
        // opening out at the end of either
        up += 0.2 * arch; fwd += -0.1 * arch + 0.1 * throwF; lat += 0.16 * opening;
        // laid out: the arms out to the sides at the shoulders, a little back; tucked: down to the shins (held there below)
        lat += (0.5 - lat) * lay; up += (0.02 - up) * lay; fwd += (-0.1 - fwd) * lay;
        lat += (0.1 - lat) * tkF; up += (-0.5 - up) * tkF; fwd += (0.32 - fwd) * tkF;
        // a spin past a 180: the arms hugged in, hands together in front of the chest, elbows to the ribs
        lat += (-0.075 - lat) * armsIn; up += (-0.2 - up) * armsIn; fwd += (0.1 - fwd) * armsIn;
        if (gd && gd.arms) { const m = ARM_MODE[gd.arms]; if (m) { lat = m[0]; up = m[1]; fwd = m[2]; } }
        // (the free arm of a grab floats, not held up stiff)
        if (gd && gd.arms) { lat += 0.05 * wob(tt * 1.3, 31 + k * 4); up += 0.07 * wob(tt * 1.6, 33 + k * 3); fwd += 0.06 * wob(tt * 1.1, 37 + k * 5); }
      } else if (rail) {
        const bal = S.balance || 0;
        lat = 0.27 + 0.08 * Math.abs(bal) + 0.07 * swapK;   // (out wide to the sides on a rail, as in photos of rail riders: 0.21 before) up = -0.23 - s * bal * 0.2 + 0.08 * swapK; fwd = 0.2 + 0.08 * s * Math.sin(ra);   // loose, the hand on the travel's side ahead
        lat += 0.13 * oneF; up += 0.08 * oneF + (s === oneS ? 0.06 * oneF : 0);   // (one ski: both out for balance)
      } else {
        // forward and a little wide of the hips, elbows soft
        lat = 0.12 - 0.04 * tuck; up = -0.41 + 0.15 * tuck; fwd = 0.2 + 0.1 * tuck;
        // (a hard landing throws the arms forward and up; one off to the side the arm away from the travel out; one foot,
        // both out for balance, the lifted side's higher)
        fwd += 0.12 * lHit; up += 0.13 * lHit; lat += 0.08 * lHit + (s * lOff > 0 ? 0.16 * Math.abs(lOff) : 0);
        lat += 0.13 * oneF; up += 0.08 * oneF + (s === oneS ? 0.06 * oneF : 0);
        lat += FP.lat * fpW; up += FP.up * fpW; fwd += FP.fwd * fpW;
        const load = (S.loading ? 1 : smoothstep(0.55, 0.85, S.crouch || 0)) * (1 - tuck);   // crouched to pop: the arms load back
        fwd -= 0.16 * load; up += 0.03 * load; lat += 0.03 * load;
        lat += 0.08 * btK; up += 0.08 * btK; fwd -= 0.03 * btK;
        if (k !== (this._lzK ?? 1)) { lat += (0.36 - lat) * lazy; up += (-0.42 - up) * lazy; fwd += (0.38 - fwd) * lazy; }   // a lazy boy: the free arm out in front
        if (brake > 0.03) { const dn = (this._slip || 1) === s; fwd += brake * (dn ? 0.18 : -0.06); up += brake * (dn ? 0.1 : 0.03); lat += brake * (dn ? -0.02 : 0.06); }
        const land = clamp(absorb * 2.2, 0, 1); fwd += 0.16 * land; up += 0.05 * land;
        if (s * edge < 0) { fwd += 0.06 * Math.abs(edge); up -= 0.03 * Math.abs(edge); }   // the inside hand leads a turn
        lat -= 0.06 * wind * s;                                             // the coil swings the arms with the shoulders
      }
      // a fall: the hands thrown out to catch it first, then flailing, then limp as the tumble slows (fallT)
      const fT = S.fallT || 0, brc = 1 - smoothstep(0.2, 0.5, fT), limp = smoothstep(1.1, 2.2, fT);
      if (crashW > 0.5) { lat = 0.36 - 0.1 * brc + (0.3 - 0.26) * limp; up = 0.2 - 0.6 * brc - 0.5 * limp; fwd = 0.38 * brc + 0.05 * limp; }
      const AN = ARMN[k];
      const zArm = air ? 0.6 : 0.72;
      lat = sp(AN[0], lat, 10, zArm); up = sp(AN[1], up, 10, zArm); fwd = sp(AN[2], fwd, 10, zArm);
      // what moves faster than a spring follows goes on top: strides, pole pushes, plants, the hands' own small moves
      const pk = onSnow > 0.5 && this.plantK === k && this.plantT < 0.35 ? Math.sin(Math.PI * this.plantT / 0.35) : 0;
      if (onSnow > 0.01) {
        if (strideW > 0.01) { const opp = s === -pushS; fwd += strk2 * (opp ? 0.2 : -0.1); up += strk2 * (opp ? 0.1 : -0.02); }
        if (dpW > 0.01) { fwd += dpW * (0.36 - 0.6 * dpK) - dpW * 0.3; up += dpW * (0.12 - 0.2 * dpK); }
        if (pk > 0) { fwd += 0.05 * pk; up -= 0.03 * pk; }
      }
      const hm = (0.6 + 0.6 * railW + 1.6 * flow) * (1 - 0.7 * (Hs.w || 0)), ak = 11 + k * 4;
      if (flow > 0.01) { const sw = Math.sin(tt * 1.9 + 0.6); fwd += s * 0.09 * sw * flow; up += (0.05 + s * 0.04 * sw) * flow; lat += 0.01 * flow; }
      lat += 0.03 * hm * wob(tt * (1.6 + railW), ak); up += 0.04 * hm * wob(tt * (1.9 + railW), ak + 2); fwd += 0.05 * hm * wob(tt * (1.4 + railW), ak + 6);
      if (rk > 0.01 && !gd) { lat += 0.17 * rk; up += 0.15 * rk; fwd -= 0.05 * rk; }   // a rail's jolt flicks the arms out
      if (crashW > 0.5) up += Math.sin(t * 9 + s) * 0.2 * (1 - brc) * (1 - limp);
      const x0 = s * lat, cl = Math.cos(lead), sl = Math.sin(lead);
      const ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
      ua.updateWorldMatrix(false, false);
      const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
      const wr = _wr.copy(sh).addScaledVector(cL, x0 * cl + fwd * sl).addScaledVector(ub, up).addScaledVector(cFl, -x0 * sl + fwd * cl);
      // never quite at full reach: a locked arm snaps when its target moves near the end of its range
      { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.78, 0.93); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
      const fd = _fd.copy(cF).addScaledVector(ub, -0.35).normalize(), pa = _pa.copy(cL).multiplyScalar(-s);
      let curl = this.poles ? 1.25 : 0.55;
      // a tucked front flip: each hand on its own shin a third of the way down from the knee, the palm on the front of
      // it, the fingers round its outside
      const dragW = ground && k === (this._lzK ?? 1) ? smoothstep(0.3, 0.85, lazy) : 0;
      if (dragW > 0.01) {
        // the hand on the snow beside the hip, palm down, fingers trailing back and out (the snow under the body's
        // frame is its own y = 0 there)
        const at = _cb.set(s * 0.46, 0.02, pelZ - 0.14).applyQuaternion(R).add(BP);
        wr.lerp(at, dragW);
        fd.lerp(_cc.copy(cF).multiplyScalar(-0.75).addScaledVector(cL, s * 0.55).addScaledVector(ub, -0.2).normalize(), dragW).normalize();
        pa.lerp(_cd.copy(ub).negate(), dragW).normalize(); curl += (0.3 - curl) * dragW;
      }
      // (on the T-bar: one hand up on the stem, the other low beside the hip holding both poles)
      if (tbW > 0.01 && this._tbStem) {
        if (k === tbK) { wr.lerp(this._tbStem, tbW); fd.lerp(_cc.copy(ub).addScaledVector(cF, 0.3).normalize(), tbW).normalize(); pa.lerp(_cd.copy(cL).multiplyScalar(s), tbW).normalize(); curl += (1.4 - curl) * tbW; }
        else { wr.lerp(_cb.set(s * 0.24, pelY - 0.04, pelZ + 0.2).applyQuaternion(R).add(BP), tbW); curl += (1.35 - curl) * tbW; }
      }
      const shinW = tkF * (1 - (Hs.w || 0));
      if (shinW > 0.01) {
        const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
        const hp0 = _ca.setFromMatrixPosition(th.matrixWorld), kn = _cb.setFromMatrixPosition(ca.matrixWorld), an = _cc.setFromMatrixPosition(ft.matrixWorld);
        const tD = hp0.subVectors(kn, hp0).normalize(), sD = _cd.subVectors(an, kn).normalize();
        const front = tD.sub(sD); if (front.lengthSq() < 1e-6) front.copy(cF); front.normalize();
        const at = kn.lerp(an, 0.33).addScaledVector(front, 0.075).addScaledVector(cL, s * 0.02);
        wr.lerp(at, shinW);
        const fs = _cc.copy(cL).multiplyScalar(s).addScaledVector(front, -front.dot(cL) * s).addScaledVector(sD, 0.25).normalize();
        fd.lerp(fs, shinW).normalize(); pa.lerp(front.negate(), shinW).normalize(); curl += (1.15 - curl) * shinW;
      }
      if (Hs.w > 0.02) {
        const g = this.skiPoint(this.sk[Hs.cur[1] === 'L' ? 0 : 1], Hs.cur[1], Hs.cur[2], Hs.cur[3], this.gpA);
        if (Hs.prev && Hs.fx < 0.999) {
          const g0 = this.skiPoint(this.sk[Hs.prev[1] === 'L' ? 0 : 1], Hs.prev[1], Hs.prev[2], Hs.prev[3], this.gpB), f = smooth01(Hs.fx);
          g.pt.lerpVectors(g0.pt, g.pt, f); g.fingers.lerpVectors(g0.fingers, g.fingers, f).normalize(); g.palm.lerpVectors(g0.palm, g.palm, f).normalize();
        }
        // palm on the edge, fingers wrapped under it
        const gw = _v2.copy(g.pt).addScaledVector(g.fingers, -0.07).addScaledVector(g.palm, -0.03);
        wr.lerp(gw, Hs.w); fd.lerp(g.fingers, Hs.w).normalize(); pa.lerp(g.palm, Hs.w).normalize(); curl += (1.35 - curl) * Hs.w;
      }
      { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.84 + 0.02 * Hs.w + 0.08 * dragW, 0.965 + 0.02 * Hs.w + 0.02 * dragW); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
      // the elbow: back, out and down; with the hand raised, out and a little forward
      const upK = smoothstep(-0.05, 0.2, up) * (1 - Hs.w);
      const el = _el.set(0, 0, -1).applyQuaternion(chQ).addScaledVector(cL, s * (0.2 - 0.24 * armsIn + 0.35 * Hs.w + 0.3 * shinW)).addScaledVector(ub, -1.15).normalize();
      if (upK > 0.01) el.lerp(_v6.copy(cL).multiplyScalar(s).addScaledVector(cFl, 0.3).addScaledVector(ub, 0.15).normalize(), upK).normalize();
      this.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
      const HH = this.hands[side];
      this.aim(ha, this.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
      this.curl(HH, curl);
      // the pole: from the grip down and back; forward into a plant; hanging from the strap while grabbing
      if (this.poles) {
        const pole = k ? this.poleR : this.poleL, aw = Math.max(airW, railW);
        let tx = s * 0.08 + s * 0.02 * aw, ty = -1 + 0.25 * aw, tz = -0.55 - 0.35 * aw;
        // (seen in first person on the snow the poles hang more forward and out, so their shafts go down past the skis in
        // view under the grips instead of straight back behind the hands, as on a helmet camera)
        if (fpW > 0.01) { const w = fpW * (1 - aw); tx += (s * 0.2 - tx) * w; tz += (-0.22 - tz) * w; }
        if (pk > 0) { const w = 0.85 * pk; tx += (s * 0.12 - tx) * w; ty += (-1 - ty) * w; tz += (0.3 - tz) * w; }
        if (dpW > 0.01) { const fx = s * 0.12, fy = -1 + 0.4 * dpK, fz = 0.1 - 1.1 * dpK; tx += (fx - tx) * dpW; ty += (fy - ty) * dpW; tz += (fz - tz) * dpW; }
        if (Hs.w > 0.02) { const w = Math.min(1, Hs.w * 1.4); tx += (s * 0.35 - tx) * w; ty += (0.15 - ty) * w; tz += (-1 - tz) * w; }
        // (a grab's free arm thrown up or out carries its pole up and back like a flag, as in photos of slopestyle runs)
        if (gd && !(Hs.w > 0.5) && (gd.arms === 'high' || gd.arms === 'up' || gd.arms === 'scream' || gd.arms === 'wide')) {
          const w = gW * smooth01(ext * 1.5) * (1 - (Hs.w || 0)), wide = gd.arms === 'wide';
          tx += ((wide ? 0.75 : 0.32) * s - tx) * w; ty += ((wide ? 0.05 : 0.6) - ty) * w; tz += ((wide ? -0.65 : -0.75) - tz) * w;
        }
        if (gd && gd.poles === 'between') { const w = gW * smooth01(ext * 1.5); tx += (-s * 0.1 - tx) * w; ty += (-1 - ty) * w; tz += (0.06 - tz) * w; }   // (the spread eagle's poles down between the legs)
        if (dragW > 0.01) { tx += (s * 0.35 - tx) * dragW; ty += (-0.1 - ty) * dragW; tz += (-1 - tz) * dragW; }   // trailing behind the hand drag
        const tip = _tip.set(tx, ty, tz).normalize().applyQuaternion(R);
        pole.position.copy(_v2.setFromMatrixPosition(ha.matrixWorld)).addScaledVector(fd, 0.06).addScaledVector(pa, 0.025);
        this.clearPole(pole.position, tip, R, ground);
        pole.quaternion.setFromUnitVectors(Y, tip.negate());
      }
    }
    // (the T-bar: the stem hand's pole carried in the other hand beside its own, both hanging down and back)
    if (tbW > 0.5 && this.poles) {
      const hold = tbK ? this.poleL : this.poleR, carry = tbK ? this.poleR : this.poleL, s2 = tbK ? 1 : -1;
      carry.position.copy(hold.position).addScaledVector(_v6.set(1, 0, 0).applyQuaternion(R), -s2 * 0.03);
      carry.quaternion.copy(hold.quaternion).multiply(_q1.setFromAxisAngle(Z, s2 * 0.08));
    }
    // ---- helmet, and where the eyes are for the first-person camera
    this.placeHead(hdQ);
    this._wasRail = rail; this._pra = ra;
    this.flushTree(body);
    this.afterPose(S);
  }
  /* sitting on the chairlift (2026-11-05, with lift.js): S.p is the seat under the hips, S.q faces the way the chair
     goes. Hips on the seat, the thighs level, the shins hanging a little forward with the skis on them (tips a little
     down, swinging a little with the chair), the hands on the bar in front holding the poles, the head looking round. */
  seated(S, dt, sp, t) {
    const b = this.b, R = this.placeBody(S), BP = this.body.position, tt = t + this.ph;
    const sw = 0.025 * wob(tt * 0.6, 2.2), sw2 = wob(tt * 0.8, 7.1);
    // sitting down at the bottom and standing up at the top (lift.js: liftSit 0..1, liftFeet where the skis stand on
    // the snow meanwhile): the hips go between standing over the feet and the seat, the skis stay on the snow
    const sit = smooth01(S.liftSit ?? 1), F = S.liftFeet ? this._feetL || (this._feetL = V()) : null;
    if (F) F.copy(S.liftFeet).sub(BP).applyQuaternion(_qi.copy(R).invert());
    const st0 = F ? 1 - sit : 0;
    // the hips: on the seat, sat back a little
    const pelQ = _pelQ.copy(R).multiply(_q1.setFromAxisAngle(Z, sw * sit)).multiply(_q1.setFromAxisAngle(X, -0.08 * sit + 0.25 * st0 * sit * 4 * (1 - sit)));
    this.setWorldQ(b.root, _q2.copy(pelQ).multiply(this.rest.root.q));
    b.pelvis.updateWorldMatrix(false, false);
    const off = _v2.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v3.setFromMatrixPosition(b.root.matrixWorld));
    const pel = _v3.set(0, 0.1 + (this.pelvisY - this.hipY), 0.02);
    if (F) pel.lerp(_v4.set(F.x, F.y + this.ankleH + SKI.thick + SKI.stack + this.legLen * 0.84 + (this.pelvisY - this.hipY), F.z - 0.08), st0);
    this.setWorldPos(b.root, pel.applyQuaternion(R).add(BP).sub(off));
    // now and then a look round
    const gl = this._gl;
    if (t > gl.next || t < gl.next - 30) { gl.yaw = (Math.random() - 0.5) * 1.6; gl.pitch = (Math.random() - 0.4) * 0.3; gl.until = t + 1 + Math.random() * 1.5; gl.next = gl.until + 2 + Math.random() * 4; }
    const look = sp('lfYaw', t < gl.until ? gl.yaw : 0, 4), lookP = sp('lfPitch', t < gl.until ? gl.pitch : 0, 4);
    const chQ = _chQ.copy(R).multiply(_q1.setFromAxisAngle(Y, look * 0.25)).multiply(_q1.setFromAxisAngle(Z, sw * 0.5)).multiply(_q1.setFromAxisAngle(X, 0.04 + 0.02 * sw2));
    this.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
    this.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); this.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); this.blendBone(b.chest, 'chest', pelQ, chQ, 1);
    const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, look * 0.75)).multiply(_q1.setFromAxisAngle(X, 0.05 + lookP));
    this.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); this.blendBone(b.head, 'head', hdQ, hdQ, 0);
    this.blendBone(b.clL, 'clL', chQ, chQ, 0); this.blendBone(b.clR, 'clR', chQ, chQ, 0);
    // legs: thighs along the seat, shins hanging; each ski on its boot, tips a little down
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, spk = this.sk[k], th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
      th.updateWorldMatrix(false, false);
      const hip = _v4.setFromMatrixPosition(th.matrixWorld).sub(BP).applyQuaternion(_qi.copy(R).invert());   // in the body's frame
      const kick = 0.05 * wob(tt * 0.9, 3 + k * 2.4) * sit;
      const ank = _v5.set(hip.x + s * 0.03, hip.y - 0.03 - this.len.ca * 0.95, hip.z + this.len.th * 0.97 + 0.1 + kick);
      spk.q.setFromAxisAngle(X, (0.16 + 0.06 * sw2 + kick) * (F ? smoothstep(0.6, 1, sit) : 1));
      spk.pos.copy(ank).sub(_v6.set(0, SKI.thick + SKI.stack + this.ankleH, -this.ankleBack).applyQuaternion(spk.q));
      // (on the snow while sitting down or standing up: the ski flat where the feet are)
      if (F) spk.pos.lerp(_v6.set(F.x + s * 0.1, F.y, F.z), 1 - smoothstep(0.6, 1, sit));
      const ankW = this.ankleOf(spk, _v5), skiQ = _q2.copy(R).multiply(spk.q);
      const kf = _kd.set(s * 0.1, 1, 0.6).applyQuaternion(R);
      this.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', ankW, kf, Z);
      this.setWorldQ(ft, _q3.copy(skiQ).multiply(this.rest[k ? 'ftR' : 'ftL'].q));
      const cuff = k ? this.bootR.cuff : this.bootL.cuff;
      const kp = _v2.setFromMatrixPosition(ca.matrixWorld), ap = _v3.setFromMatrixPosition(ft.matrixWorld);
      const shin = _v4.subVectors(ap, kp).normalize();
      cuff.position.copy(ap).addScaledVector(shin, -0.1).addScaledVector(_v6.set(0, 0, 1).applyQuaternion(skiQ), 0.012);
      cuff.quaternion.setFromUnitVectors(Y, shin.negate());
      for (let i = 0; i < 6; i++) this.air6[k][i] = 0;
    }
    this.placeSki(this.skiL, this.sk[0]); this.placeSki(this.skiR, this.sk[1]);
    for (const s of [this.skiL, this.skiR]) { if (s.userData.bend) s.userData.bend.value = 0; if (s.userData.flex) s.userData.flex.value.x = s.userData.flex.value.y = 0; }
    // the hands on the bar in front, the poles held upright beside the knees
    const cF = _cF.set(0, 0, 1).applyQuaternion(chQ), cL = _cL.set(1, 0, 0).applyQuaternion(chQ), ub = _ub.set(0, 1, 0).applyQuaternion(R);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, side = k ? 'R' : 'L', ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
      const wr = _wr.set(s * 0.2, 0.3 + 0.01 * sw2, 0.34).applyQuaternion(R).add(BP);
      const el = _el.copy(cL).multiplyScalar(s * 0.5).addScaledVector(ub, -1).addScaledVector(cF, -0.3).normalize();
      this.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
      const HH = this.hands[side];
      this.aim(ha, this.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, _fd.copy(cF).addScaledVector(ub, -0.4).normalize(), _pa.copy(ub).negate());
      this.curl(HH, this.poles ? 1.25 : 0.9);
      if (this.poles) {
        const pole = k ? this.poleR : this.poleL, tip = _tip.set(s * 0.05, -1, 0.12).normalize().applyQuaternion(R);
        pole.position.copy(_v2.setFromMatrixPosition(ha.matrixWorld)).addScaledVector(cF, 0.03);
        pole.quaternion.setFromUnitVectors(Y, tip.negate());
      }
    }
    this.placeHead(hdQ);
    this.flushTree(this.body);
  }
  /* a pole's tip kept out of the snow (2026-11-07): swung back about the hand, towards trailing level behind, until the
     basket is just over the snow (riding along low the tips went 15 to 35 cm into it, and further at a landing). dir is
     the pole's way from the grip (changed in place); 1.1 m long. On the snow the snow is taken as the plane under the
     skis (the body's own up through its feet), so nothing is looked up; elsewhere the snow's own height at the tip. */
  clearPole(grip, dir, R, flat) {
    const L = 1.1, BP = this.body.position, n = flat ? _pn.set(0, 1, 0).applyQuaternion(R) : null;
    const ok = flat ? d => (grip.x + d.x * L - BP.x) * n.x + (grip.y + d.y * L - BP.y) * n.y + (grip.z + d.z * L - BP.z) * n.z > 0.03
      : d => grip.y + d.y * L > height(grip.x + d.x * L, grip.z + d.z * L) + 0.03;
    if (ok(dir)) return;
    const back = _pb.set(0, 0, -1).applyQuaternion(R); back.y = Math.max(back.y, 0) + 0.05; back.normalize();
    if (!ok(back)) { dir.copy(back); return; }        // (the hand itself at the snow: lying back along it)
    let lo = 0, hi = 1;
    for (let i = 0; i < (flat ? 7 : 4); i++) { const mid = (lo + hi) / 2; if (ok(_pd.copy(dir).lerp(back, mid).normalize())) hi = mid; else lo = mid; }
    dir.lerp(back, hi).normalize();
  }
  /* a new trick in the air, after the one before it (2026-11-08, for "the whole body reacts ... to the order of tricks"):
     a kick into the springs it moves through, so the same trick looks different after another: a flip started out of a
     spin swings the still-wound shoulders back as the chest goes over; a spin out of a flip opens the fold as the
     shoulders take it round; a grab reached for after a spin turns the hips against the shoulders */
  seqKick(prev, cur, wx, wy) {
    const P = this.p, kv = (n, v) => { if (P[n]) P[n].v += v; };
    const sy = Math.sign(wy) || 1, sx = Math.sign(wx) || 1;
    if (cur === 'flip' || cur === 'cork') { kv('leanF', 2.4 * sx); if (prev === 'spin') kv('chYawF', -2.2 * sy); }
    else if (cur === 'spin') { kv('chYawF', 3 * sy); if (prev === 'flip' || prev === 'cork') kv('leanF', -1.8 * sx); }
    else if (cur.startsWith('grab:')) { kv('tw', (prev === 'spin' || prev === 'cork' ? -2.5 : 1.2) * sy); kv('leanF', 1.4); }
    else if (cur === 'shifty') kv('chYawF', -2 * sy);
  }
  // a jolt for the pose: 'railOn' (locking onto a rail or box), 'railSwap' (a change of direction on it), 'railOff';
  // main.js passes the physics' rail events here (power about 0.5 to 1.2); the pose also finds them itself (own)
  react(type, power = 1, own = false) {
    const s = this.p.rk || (this.p.rk = new Spring(0));
    const k = type === 'railOff' ? -0.45 : type === 'railSwap' ? 0.85 : 1;
    s.v += 38 * clamp(power, 0, 1.5) * k;
    if (!own) { const n = this._now ?? 0; if (type === 'railSwap') this._evSw = n; else this._evAt = n; }
  }
  // the body's frame at the feet (S.p, S.q) and the nodes above the skeleton's root; returns the body's rotation
  placeBody(S) {
    const body = this.body;
    body.position.copy(S.p); body.quaternion.copy(S.q);
    if (this.fp) this.fpEase(S);
    if (S.state === 'crash') this.crashPlace(S); else if (this._cr) this._cr.on = false;
    // (lifted out of the snow in the air and then landed: let down over a few hundredths of a second, not dropped; put
    // in before the pose, so nothing is worked out twice)
    if (this._carry > 0.003 && (S.state === 'ground' || S.state === 'rail')) {
      if (this._carryF !== this._frame) { this._carryF = this._frame; this._carry *= Math.exp(-this._dt / 0.05); }
      body.position.y += this._carry;
    }
    body.updateWorldMatrix(false, false);
    for (const o of this.chain) o.updateWorldMatrix(false, false);
    return (this.rootQ = body.quaternion);
  }
  /* seen in first person (2026-11-06): the physics sets the body straight onto the snow as it lands (15 to 45 degrees
     in one frame after a flip or a spin) and onto a rail as it locks on (about 9 degrees and 15 cm sideways), and in
     first person what you ride and your own legs and hands jumped with it under your eyes. Here those jumps are eased
     out (the turn over about a sixth of a second, the place over about a third; the followers above); smooth motion,
     turning and travel at the physics' own velocity, is passed straight through. (It also took out the physics'
     stepping, one to three 1/120 s steps a frame against the frame's clock; since 2026-11-07 main.js hands every
     camera the state between the last two steps, so what is left for this is the snaps.) A jump of more than 3 m (a
     respawn, back to the start) and the chairlift are taken as they are, and a crash's place too (crashPlace carries
     the body on). Once a frame (a ride's pose may ask for the body twice). */
  fpEase(S) {
    const E = this._fpE || (this._fpE = { q: new FollowQ(), p: new FollowV(), f: -1, bq: Q(), bp: V(), st: '' });
    const body = this.body;
    if (E.f === this._frame) { body.position.copy(E.bp); body.quaternion.copy(E.bq); return; }
    E.f = this._frame;
    const dt = this._dt, lift = S.state === 'lift' || E.st === 'lift' || !!S.onLift;   // (onLift: standing at a lift's line or towed up a T-bar, with no velocity of its own)
    E.st = S.onLift ? 'lift' : S.state;
    // (in a crash the place is taken as it is: crashPlace carries the body on from where it was drawn)
    if (!E.p.ok || lift || E.p.t.distanceToSquared(S.p) > 9) { E.p.reset(S.p); E.q.reset(S.q); }
    else if (S.state === 'crash') { E.p.reset(S.p); E.q.to(S.q, dt, 30, 140); }
    else {
      // the place: against the physics' own velocity (a landing's change of speed is real motion; only a jump away from
      // where that velocity goes is eased out)
      if (S.vel) E.p.u.copy(S.vel);
      E.p.to(S.p, dt, 14, S.vel ? 0 : 60);
      E.q.to(S.q, dt, 30, 140);
    }
    body.position.copy(E.p.x); body.quaternion.copy(E.q.q);
    E.bp.copy(body.position); E.bq.copy(body.quaternion);
  }
  /* ---- a crash on the snow (the notes at CRASH_BONES). The points the snow may not reach: the joints, then the gear's
     outlines (built when first wanted; main.js clears _cp when the gear is merged or changed). */
  crashPts() {
    if (this._cp && this._cpN === this.root.children.length) return this._cp;
    const L = [], b = this.b, G = [];
    // (the feet and toes go with the gear: in the air they meet the snow with the skis or the board at a landing)
    for (const [k, r] of CRASH_BONES) if (b[k]) L.push({ o: b[k], r, gear: false, foot: /^(ft|to)/.test(k) });
    for (const [k, r] of CRASH_EXTRA) if (this.bones && this.bones[k]) L.push({ o: this.bones[k], r, gear: false });
    for (const c of this.root.children) if (c !== this.body) c.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const g = { o, c: outline(o.geometry), at: L.length, sc: o.geometry.boundingSphere.center, sr: o.geometry.boundingSphere.radius, lc: V(), r: 0 };
      G.push(g); for (let k = 0; k < GEAR_K; k++) L.push({ o, r: 0.004, gear: true });
    });
    this._cp = L; this._cg = G; this._cpN = this.root.children.length; this._pelI = Math.max(0, L.findIndex(e => e.o === b.pelvis));
    this._cl = new Float32Array(L.length * 3);           // each point in the body's frame, as last posed
    this._cw = new Float32Array(L.length * 4);           // each point in the world now, and 1 if it counts (0: hidden gear)
    this._clOk = false;
    return L;
  }
  /* where each point is now: the joints, and for each piece of gear (if withGear) the GEAR_K points of its outline
     furthest the way down (d, a unit vector) */
  crashMeasure(withGear, d) {
    const L = this.crashPts(), W = this._cw, best = _cbest, bi = _cbi;
    for (let i = 0; i < L.length; i++) if (!L[i].gear) { const j = i * 4; _cx.setFromMatrixPosition(L[i].o.matrixWorld); W[j] = _cx.x; W[j + 1] = _cx.y; W[j + 2] = _cx.z; W[j + 3] = 1; }
    for (const g of this._cg) {
      let vis = withGear; for (let o = g.o; o && vis && o !== this.root; o = o.parent) if (!o.visible) vis = false;
      if (!vis) { g.vis = false; for (let k = 0; k < GEAR_K; k++) W[(g.at + k) * 4 + 3] = 0; continue; }
      // the way down in the piece's own frame (the transpose of its turn: an outline point v goes furthest along d where
      // v . (M^T d) is largest)
      const e = g.o.matrixWorld.elements, c = g.c;
      const dx = e[0] * d.x + e[1] * d.y + e[2] * d.z, dy = e[4] * d.x + e[5] * d.y + e[6] * d.z, dz = e[8] * d.x + e[9] * d.y + e[10] * d.z;
      for (let k = 0; k < GEAR_K; k++) { best[k] = -Infinity; bi[k] = 0; }
      for (let i = 0; i < c.length; i += 3) {
        const s = c[i] * dx + c[i + 1] * dy + c[i + 2] * dz;
        if (s <= best[GEAR_K - 1]) continue;
        let k = GEAR_K - 1; while (k > 0 && s > best[k - 1]) { best[k] = best[k - 1]; bi[k] = bi[k - 1]; k--; }
        best[k] = s; bi[k] = i;
      }
      // (and the piece's round bounds, for a quick test while it is clear of the snow: any turn of it stays inside)
      g.lc.copy(g.sc).applyMatrix4(g.o.matrixWorld); g.r = g.sr * Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10])); g.vis = true;
      for (let k = 0; k < GEAR_K; k++) {
        const j = (g.at + k) * 4, i = bi[k];
        _cx.set(c[i], c[i + 1], c[i + 2]).applyMatrix4(g.o.matrixWorld);
        W[j] = _cx.x; W[j + 1] = _cx.y; W[j + 2] = _cx.z; W[j + 3] = 1;
      }
    }
  }
  /* before the pose, in a crash: the body turned about its middle (the pelvis), the middle over the sliding point, as
     high as puts the lowest point on the snow's plane there. The middle as drawn follows that place with the slide's
     own velocity fed forward (rig.js FollowV): the slide is followed exactly, and a jump in it (the crash starting from
     where the middle was drawn, a head-first crash moving the sliding point under the head, another rider's copy
     catching up with a snapshot) is eased out over about a third of a second. Once a frame (a ride may ask twice). */
  crashPlace(S) {
    const body = this.body, C = this._cr || (this._cr = { f: -1, fv: new FollowV(), M: V(), bp: V(), on: false });
    if (C.f === this._frame) { body.position.copy(C.bp); return; }
    C.f = this._frame;
    // (the snow's normal: the physics' own where it is passed (S.n), else last frame's once the crash is going)
    const R = body.quaternion, base = _cb2.copy(body.position), n = S.n ? _cn2.copy(S.n) : C.on && this._crN ? _cn2.copy(this._crN) : normal(base.x, base.z, _cn2);
    const L = this.crashPts(), ok = this._clOk;
    if (ok) C.M.fromArray(this._cl, this._pelI * 3); else if (this._pelLOk) C.M.copy(this._pelL); else C.M.set(0, (this.pelvisY || 0.95), 0);
    let h = -Infinity;
    if (ok) {
      // (each point's height over the plane is its place less the middle's, along the snow's normal turned into the
      // body's frame: one dot product a point)
      const W = this._cw, Lc = this._cl, nl = _cx.copy(n).applyQuaternion(_qi2.copy(R).invert()), mx = C.M.x, my = C.M.y, mz = C.M.z;
      for (let i = 0; i < L.length; i++) {
        if (!W[i * 4 + 3] && L[i].gear) continue;
        const need = L[i].r - ((Lc[i * 3] - mx) * nl.x + (Lc[i * 3 + 1] - my) * nl.y + (Lc[i * 3 + 2] - mz) * nl.z);
        if (need > h) h = need;
      }
    } else h = C.M.y;                                    // (nothing measured yet: standing, the feet on the snow)
    // (and what the check after the pose had to lift the rider by lately, so it is mostly in before the pose: lifting
    // after it works the whole skeleton out again)
    if (!C.on) C.extra = 0;
    h += C.extra || 0; C.extra = (C.extra || 0) * 0.85;
    const mid = _cs.copy(base).addScaledVector(n, h);
    // (started where the middle was drawn last frame, already moving with the slide: to() carries it on by the velocity)
    if (!C.on) { C.on = true; C.fv.reset(this._midLastOk ? this._midLast : mid); C.fv.v.copy(S.vel || ZERO); }
    C.fv.u.copy(S.vel || ZERO);
    body.position.copy(C.fv.to(mid, this._dt, 12, 0)).sub(_cx.copy(C.M).applyQuaternion(R));
    C.bp.copy(body.position);
  }
  /* after the pose: in a crash, and in the air near the snow, every part checked against the snow itself; anything under
     lifts the whole rider straight up out of it (the body's own parts always; the gear in a crash, and in the air only
     tipped well past a clean landing, below). Then each part's place in the body's frame is kept for the next frame,
     and the middle as drawn (the cameras follow it in a crash). */
  afterPose(S) {
    const st = S.state, crash = st === 'crash';
    if (this.b && this.b.pelvis) { (this._midLast || (this._midLast = V())).setFromMatrixPosition(this.b.pelvis.matrixWorld); this._midLastOk = true; }
    this.midOk = false; this.lifted = 0;
    if (!crash && st !== 'air') {
      this._clOk = false; this._crAirT = 0;
      if (!(this._carry > 0.003) || st === 'lift') this._carry = 0;     // (the let-down after a landing: placeBody)
      // (the pelvis's place in the body's frame, for a crash that starts on the snow)
      if (this._midLastOk) { (this._pelL || (this._pelL = V())).copy(this._midLast).sub(this.body.position).applyQuaternion(_qi2.copy(this.body.quaternion).invert()); this._pelLOk = true; }
      return;
    }
    const p = S.p, gy = height(p.x, p.z), R = this.body.quaternion, BP = this.body.position;
    this._crAirT = crash ? 0 : (this._crAirT || 0) + this._dt;
    // (high in the air nothing of the rider reaches the snow: only the pelvis's place is kept, for a crash that starts
    // up there)
    if (!crash && p.y - gy > 2.4) { this._clOk = false; this._carry = 0; (this._pelL || (this._pelL = V())).copy(this._midLast).sub(BP).applyQuaternion(_qi2.copy(R).invert()); this._pelLOk = true; return; }
    // (nearer: the joints as last measured and each piece of gear's round bounds, under this frame's turn; the three
    // lowest over the slope under the rider (its plane through the snow under the feet) well clear of the snow under
    // each (half a metre: the legs reach for a landing that fast), nothing more is done this frame; measured again
    // every fourth frame)
    if (!crash && this._clOk && (this._clAge = (this._clAge || 0) + 1) < 4) {
      // (the slope: the one measured with the parts, a few frames old at most)
      const L = this._cp, Lc = this._cl, K = _ck, KI = _cki, G = this._cg, n = this._clN || normal(p.x, p.z, _cn); let kn = 0;
      const gap = c => (c.x + BP.x - p.x) * n.x + (c.y + BP.y - gy) * n.y + (c.z + BP.z - p.z) * n.z;
      const take = (y, i) => { if (kn < 3) { K[kn] = y; KI[kn++] = i; return; } let w = 0; for (let k = 1; k < 3; k++) if (K[k] > K[w]) w = k; if (y < K[w]) { K[w] = y; KI[w] = i; } };
      for (let i = 0; i < L.length; i++) if (!L[i].gear) take(gap(_cx.fromArray(Lc, i * 3).applyQuaternion(R)) - L[i].r, i);
      for (let k = 0; k < G.length; k++) if (G[k].vis) take(gap(_cx.copy(G[k].bl).applyQuaternion(R)) - G[k].r, -1 - k);
      let clear = kn > 0;
      for (let k = 0; k < kn && clear; k++) {
        const i = KI[k], r = i >= 0 ? L[i].r : G[-1 - i].r;
        if (i >= 0) _cx.fromArray(Lc, i * 3).applyQuaternion(R).add(BP); else _cx.copy(G[-1 - i].bl).applyQuaternion(R).add(BP);
        if (_cx.y - r < height(_cx.x, _cx.z) + 0.5) clear = false;
      }
      if (clear) { this._carry = 0; return; }
    }
    this._clAge = 0;
    // (the snow's normal under the rider: each piece of gear's lowest points are its furthest into the snow's slope, not
    // straight down: a pole held back up a landing's slope meets it first at its tip, which is not its lowest point)
    const n = crash && S.n ? _cn.copy(S.n) : normal(p.x, p.z, _cn);   // (S.n: the physics' own in a crash, where it is passed)
    if (crash) (this._crN || (this._crN = V())).copy(n);
    (this._clN || (this._clN = V())).copy(n);
    // (the gear's places worked out here, so main.js need not do it again this frame)
    for (const c of this.root.children) if (c !== this.body) c.updateMatrixWorld(true);
    this._gearW = this._frame;
    this.crashMeasure(true, _cdn.copy(n).negate());
    const L = this._cp, W = this._cw;
    {
      /* (the gear counts in the air with the body more than 41 degrees over from the slope under its middle, past what
         lands clean, or 70 degrees from upright: a ski tip set down a little early on a good landing is left as it is,
         rather than the rider lifted for it and dropped back as the feet come down. The slope is taken 1.5 m either way,
         so a lip's back face or a kicker's edge under the rider does not count as the slope; and not in the first tenth
         of a second off a lip.) */
      const up = _cu.set(0, 1, 0).applyQuaternion(R), m = this.b.pelvis.matrixWorld.elements;
      let gear = crash || up.y < 0.35, low = Infinity; const ny = Math.max(0.5, n.y);
      // (first the rider's lowest point, gear and all, against the highest snow under their box (its corners and the
      // middle): in the air mostly clear, and then nothing more is looked up; part by part, only the parts that low)
      let y0 = Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < L.length; i++) {
        const j = i * 4; if (!W[j + 3]) continue;
        y0 = Math.min(y0, W[j + 1] - L[i].r / ny); x0 = Math.min(x0, W[j]); x1 = Math.max(x1, W[j]); z0 = Math.min(z0, W[j + 2]); z1 = Math.max(z1, W[j + 2]);
      }
      const top = Math.max(gy, height(x0, z0), height(x0, z1), height(x1, z0), height(x1, z1)) + 0.15;
      if (y0 < top) {
        if (!gear && this._crAirT > 0.1) {
          const x = m[12], z = m[14], sx = (height(x + 1.5, z) - height(x - 1.5, z)) / 3, sz = (height(x, z + 1.5) - height(x, z - 1.5)) / 3;
          gear = (up.y - up.x * sx - up.z * sz) / Math.sqrt(1 + sx * sx + sz * sz) < 0.75;
        }
        for (let i = 0; i < L.length; i++) {
          const j = i * 4; if (!W[j + 3] || ((L[i].gear || L[i].foot) && !gear)) continue;
          const r = L[i].r / ny; if (W[j + 1] - r > top) continue;
          const g = W[j + 1] - r - height(W[j], W[j + 2]);
          if (g < low) { low = g; this._lowI = i; }
        }
      }
      if (low < -0.002) { this.shiftAll(_cs.set(0, -low, 0)); this.lifted = -low; for (let i = 0; i < L.length; i++) W[i * 4 + 1] -= low; for (const g of this._cg) g.lc.y -= low; if (crash && this._cr) this._cr.extra = (this._cr.extra || 0) - low; }
    }
    this._carry = crash ? 0 : this.lifted;
    const qi = _qi2.copy(R).invert(), Lc = this._cl;
    for (let i = 0; i < L.length; i++) { const j = i * 4; _cx.set(W[j], W[j + 1], W[j + 2]).sub(BP).applyQuaternion(qi); Lc[i * 3] = _cx.x; Lc[i * 3 + 1] = _cx.y; Lc[i * 3 + 2] = _cx.z; }
    for (const g of this._cg) (g.bl || (g.bl = V())).copy(g.lc).sub(BP).applyQuaternion(qi);
    this._clOk = true;
    (this.mid || (this.mid = V())).setFromMatrixPosition(this.b.pelvis.matrixWorld); this.midOk = true;
    this._midLast.copy(this.mid);
  }
  // the whole rider moved by d (the body and every piece of gear: they are all placed in the world, the root at the origin)
  shiftAll(d) {
    for (const c of this.root.children) c.position.add(d);
    this.body.updateMatrixWorld(true);
    for (const c of this.root.children) if (c !== this.body) c.updateMatrixWorld(true);
    this.eye.add(d); this.headPos.add(d); this.fpEye.add(d);
    if (this._cr && this._cr.f === this._frame) this._cr.bp.add(d);
  }
  // first person on or off (camera.js, each frame): the easing above, and the body's fade close to the lens
  setFirstPerson(on) {
    on = !!on;
    if (on === this.fp) return;
    this.fp = on; this._fpE = null;
    if (this.dressU) this.dressU.uFpNear.value = on ? 0.2 : 0;
  }
  // the helmet on the head (hdQ: the head's world rotation, as posed), and the eyes for the first-person camera
  placeHead(hdQ) {
    const hpos = this.headPos.setFromMatrixPosition(this.b.head.matrixWorld);
    const hFwd = _v2.set(0, 0, 1).applyQuaternion(hdQ), hUp = _v3.set(0, 1, 0).applyQuaternion(hdQ);
    this.eye.copy(this.eyeOff).applyQuaternion(hdQ).add(hpos);
    this.helmet.position.copy(this.eye).addScaledVector(hUp, 0.04).addScaledVector(hFwd, -0.062);
    this.helmet.quaternion.copy(hdQ);
    this.headQ.copy(hdQ); this.eye.addScaledVector(hFwd, 0.02);
    this.fpEye.copy(this.eye); this.fpLook = null; this.fpUp = null;
  }
  // the rest of the rider's tree (fingers, face, toes, the meshes) after the pose: the bones posed this frame are
  // current already, so only the others are worked out (this was a walk of the whole tree)
  flushTree(o) {
    const ch = o.children, f = this._frame;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      // a skinned mesh does more in its own update (its bind matrix's inverse follows it), so it keeps that update
      if (c.isSkinnedMesh) { c.updateMatrixWorld(true); continue; }
      if (c._wf !== f) { if (c.matrixAutoUpdate) c.updateMatrix(); c.matrixWorld.multiplyMatrices(o.matrixWorld, c.matrix); c.matrixWorldNeedsUpdate = false; }
      if (c.children.length) this.flushTree(c);
    }
  }
  // push a ski (in the body's frame) out of a capsule round the torso, pelvis to neck
  // (the push blends every touching point, deeper ones counting more, so it never jumps from one point to another)
  clearTorso(sk, w) {
    const b = this.b, R = this.rootQ, qi = _qi2.copy(R).invert();
    const A = _ca.setFromMatrixPosition(b.pelvis.matrixWorld), Bn = _cb.setFromMatrixPosition(b.neck.matrixWorld), ab = _cc.subVectors(Bn, A), L2 = ab.lengthSq();
    const sq = _kq.copy(R).multiply(sk.q), base = _cd.copy(sk.pos).applyQuaternion(R).add(this.body.position), rad = 0.17;
    let wsum = 0, worst = 0; _cg.set(0, 0, 0);
    for (let i = 0; i < 5; i++) {
      const p = _ce.set(0, SKI.thick, (i / 4 * 2 - 1) * SKI.len * 0.45).applyQuaternion(sq).add(base);
      const tt = clamp(_cf.subVectors(p, A).dot(ab) / L2, 0, 1), c = _cf.copy(A).addScaledVector(ab, tt), d = p.distanceTo(c), pen = rad - d;
      if (pen <= 0 || d < 1e-5) continue;
      const wi = pen * pen; _cg.addScaledVector(_cf.subVectors(p, c), wi / d); wsum += wi; if (pen > worst) worst = pen;
    }
    if (wsum > 0 && _cg.lengthSq() > 1e-10) sk.pos.addScaledVector(_cg.normalize().applyQuaternion(qi), worst * w);
  }
  /* the skis kept out of each other and out of the body (2026-11-03, for "make sure that the skis do not enter the
     body or go through each other in any of the grabs"): each ski's centre line against the other's, kept a ski's
     thickness and a binding apart where they cross, and against the torso and the other leg (as last frame posed
     them), each pushed the shortest way out, by w (how much of the air or rail it is) */
  separateSkis(w) {
    if (w < 0.01) return;
    const R = this.rootQ, qi = _qi2.copy(R).invert(), base = this.body.position, b = this.b, E = SKI.len * 0.47;
    const line = (k, A, B) => { const s = this.sk[k], q = _kq.copy(R).multiply(s.q), c = _sv.copy(s.pos).applyQuaternion(R).add(base);
      A.set(0, SKI.thick, E).applyQuaternion(q).add(c); B.set(0, SKI.thick, -E).applyQuaternion(q).add(c); };
    line(0, _sa0, _sb0); line(1, _sa1, _sb1);
    const MIN = 0.075, d = segSeg(_sa0, _sb0, _sa1, _sb1, _sp0, _sp1);
    if (d < MIN) {
      const n = _sd.subVectors(_sp0, _sp1); if (n.lengthSq() < 1e-8) n.set(0, 1, 0).applyQuaternion(R); n.normalize().applyQuaternion(qi);
      const push = (MIN - d) * 0.5 * w; this.sk[0].pos.addScaledVector(n, push); this.sk[1].pos.addScaledVector(n, -push);
    }
    const pos = (bn, out) => out.setFromMatrixPosition(bn.matrixWorld);
    for (let k = 0; k < 2; k++) {
      line(k, _sa0, _sb0);
      // the torso, and the other leg's thigh and shin
      const caps = k ? [[b.pelvis, b.neck, 0.17], [b.thL, b.caL, 0.1], [b.caL, b.ftL, 0.085]] : [[b.pelvis, b.neck, 0.17], [b.thR, b.caR, 0.1], [b.caR, b.ftR, 0.085]];
      let worst = 0; _cg.set(0, 0, 0);
      for (const [ba, bb, rad] of caps) {
        const A = pos(ba, _ca), B = pos(bb, _cb), ab = _cc.subVectors(B, A), L2 = Math.max(1e-6, ab.lengthSq());
        for (let i = 0; i <= 8; i++) {
          const p = _ce.lerpVectors(_sa0, _sb0, i / 8), t = clamp(_cf.subVectors(p, A).dot(ab) / L2, 0, 1), c = _cf.copy(A).addScaledVector(ab, t), dd = p.distanceTo(c), pen = rad + 0.012 - dd;
          if (pen <= 0 || dd < 1e-5) continue;
          _cg.addScaledVector(_sd.subVectors(p, c), pen * pen / dd); if (pen > worst) worst = pen;
        }
      }
      if (worst > 0 && _cg.lengthSq() > 1e-10) this.sk[k].pos.addScaledVector(_cg.normalize().applyQuaternion(qi), worst * w);
    }
  }
  // seconds until the flight meets the snow (9 if not within about half a second)
  timeToGround(p, v) {
    const g0 = p.y - height(p.x, p.z);
    if (g0 <= 0) return 0;
    if (g0 > Math.max(0, -v.y) * 0.45 + 1.0 + 0.14 * Math.hypot(v.x, v.z)) return 9;
    let gp = g0;
    for (let k = 1; k <= 9; k++) {
      const tt = k * 0.045, gap = p.y + v.y * tt - 4.905 * tt * tt - height(p.x + v.x * tt, p.z + v.z * tt);
      if (gap <= 0) return tt - 0.045 + 0.045 * gp / (gp - gap);
      gp = gap;
    }
    return 9;
  }
  // a point on a ski, with the palm's and fingers' directions for holding it there (into out: { pt, palm, fingers })
  skiPoint(sp, ski, at, edgeK, out) {
    const R = this.rootQ, q = _kq.copy(R).multiply(sp.q);
    const z = at * SKI.len / 2 * 0.98, side = ski === 'L' ? 1 : -1, o = edgeK === 'in' ? -side : side, aa = Math.abs(at);
    const w = (SKI.waist + (SKI.tip - SKI.waist) * Math.pow(aa, 2.2)) / 2;
    const rise = aa > 0.78 ? Math.pow((aa - 0.78) / 0.22, 2.1) * 0.075 : 0;
    out.pt.set(edgeK === 'end' ? 0 : o * (w + 0.005), rise + SKI.thick * 0.5, z).applyQuaternion(q).add(_kv.copy(sp.pos).applyQuaternion(R)).add(this.body.position);
    const sx = _kx.set(1, 0, 0).applyQuaternion(q), sy = _ky.set(0, 1, 0).applyQuaternion(q);
    if (edgeK === 'end') { out.palm.copy(sy).negate(); out.fingers.set(0, 0, Math.sign(at) || 1).applyQuaternion(q).addScaledVector(sy, -0.6).normalize(); }
    else { out.palm.copy(sx).multiplyScalar(-o); out.fingers.copy(sy).negate().addScaledVector(sx, -o * 0.35).normalize(); }
    return out;
  }
  // the ankle over a ski: in the body's frame, and in the world
  ankleLocal(sp, out) { return out.set(0, SKI.thick + SKI.stack + this.ankleH, -this.ankleBack).applyQuaternion(sp.q).add(sp.pos); }
  ankleOf(sp, out) { return this.ankleLocal(sp, out).applyQuaternion(this.rootQ).add(this.body.position); }
  placeSki(ski, sp) {
    ski.position.copy(sp.pos).applyQuaternion(this.rootQ).add(this.body.position);
    ski.quaternion.copy(this.rootQ).multiply(sp.q);
  }
  curl(H, amt) {
    for (const f of H.fingers) {
      const a = amt * (f.thumb ? 0.45 : 1) * f.sign;
      f.bn.quaternion.copy(f.rest).multiply(_q1.setFromAxisAngle(f.axis, a));
    }
  }
  // world points the camera and effects use
  skiTips() {
    const pts = [];
    for (const s of [this.skiL, this.skiR]) { if (!s) continue; s.updateMatrixWorld(); pts.push(V().set(0, 0, SKI.len / 2 - 0.05).applyMatrix4(s.matrixWorld), V().set(0, 0, -SKI.len / 2 + 0.05).applyMatrix4(s.matrixWorld)); }
    return pts;
  }
  /* free what this rider put on the graphics card (2026-11-05: the locker builds the rider again on a change, and a
     rider in a room is built again when their look changes; the old ones were only taken out of the scene). The
     downloaded gear's pictures are shared by every rider and stay. */
  dispose() {
    const done = new Set();
    this.root.traverse(o => {
      if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
      if (o.isSkinnedMesh && o.skeleton && !done.has(o.skeleton)) { done.add(o.skeleton); o.skeleton.dispose(); }
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        if (done.has(m)) continue;
        done.add(m);
        if (!m.userData.sharedMaps) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k] && !done.has(m[k])) { done.add(m[k]); m[k].dispose(); }
        m.dispose();
      }
    });
    if (this.dressU) for (const k of ['uMask', 'uMaskV']) { const t = this.dressU[k].value; if (t && !done.has(t)) { done.add(t); t.dispose(); } }
    this.ready = false;
  }
}
// other rides register here: Rig.loader[kind] = async (rig, opts) => {...} adds its gear after the body is loaded (the
// helmet is made already; no skis, boots or poles are made for it), Rig.poser[kind] = (rig, S, dt) => {...} poses it
// every frame instead of the skier's pose (rig._frame is already counted for the frame)
Rig.loader = {};
Rig.poser = {};
Rig.FP = FP;
// the IK helpers as plain functions, for another ride's pose (they are the rig's own methods)
export const twoBone = (rig, upper, lower, ku, kl, target, pole, restUp) => rig.twoBone(upper, lower, ku, kl, target, pole, restUp);
export const aim = (rig, bone, restQ, restD, restUp, dir, up) => rig.aim(bone, restQ, restD, restUp, dir, up);
export const setWorldQ = (rig, bone, wq) => rig.setWorldQ(bone, wq);
export const blendBone = (rig, bone, key, qa, qb, f) => rig.blendBone(bone, key, qa, qb, f);
export { basisInto, Spring, springBank, smooth01, wrapPi };
// an orthonormal basis with x along a and y towards b
function basisInto(m, a, b) {
  const x = _bx.copy(a).normalize();
  const y = _by.copy(b).addScaledVector(x, -b.dot(x)); if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(x, -x.y); y.normalize();
  return m.makeBasis(x, y, _bz.crossVectors(x, y));
}
