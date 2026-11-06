// The sled: a wooden sledge ("Sled" by Poly by Google, CC BY 3.0, models/sled/sled.glb; see CREDITS.md) ridden lying
// on your stomach like a bodyboard, head first, hands on the front of it, legs trailing off the back. Registered with
// the rig like the board (Rig.loader.sled, Rig.poser.sled). Steering leans the body and the sled and drags the inside
// foot; tricks of our own are held like grabs (SLED_TRICKS / SLED_FOR): Superman, No Hander, One Hander, Scorpion,
// Spread Eagle, Table Top, Kneel Up, Tuck, Heel Click; the spin, flip and roll keys spin, flip and roll it all.
//   Frames: the physics' body frame (skier.q) is the sled's: +Z forward (the curled runners), +Y up, +X left. The
//   body lies along +Z face down: the rider's rest frame turned forward a quarter round about X.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Rig, springBank, smooth01, softReach, wob } from './rig.js?v=16';
import { RIDE_GRABS, seatRider, holdOnLift, liftStand } from './board.js?v=16';
import { clamp, smoothstep } from './noise.js?v=16';
import { RIDE_SPIN } from './tricks.js?v=16';
import { rideSpin } from './scoot.js?v=16';

// the slats' top (m over the snow), where the hands hold (each side, up, forward), where the hips lie
export const SLED = { top: 0.213, hand: [0.2, 0.24, 0.22], hips: -0.32 };
// tricks: hands 'both' | 'none' | 'one' (the right one off); legs 'down' (trailing) | 'up' (straight up behind, a superman)
// | 'scorpion' (knees bent, feet over the back) | 'spread' | 'kneel' (kneeling up on the sled) | 'tuck' | 'click'
// (heels together up behind); table: the sled laid on its side
export const SLED_TRICKS = {
  // (a superman off the back: still holding the front, the body flies off the back of the sled, stretched out flat)
  superman: { name: 'Superman', hands: 'both', legs: 'super', table: 0 },
  nohander: { name: 'No Hander', hands: 'none', legs: 'down', table: 0 },
  onehander: { name: 'One Hander', hands: 'one', legs: 'down', table: 0 },
  scorpion: { name: 'Scorpion', hands: 'both', legs: 'scorpion', table: 0 },
  spread:   { name: 'Spread Eagle', hands: 'none', legs: 'spread', table: 0 },
  tabletop: { name: 'Table Top', hands: 'both', legs: 'down', table: 1 },
  kneel:    { name: 'Kneel Up', hands: 'both', legs: 'kneel', table: 0 },
  tuck:     { name: 'Tuck', hands: 'both', legs: 'tuck', table: 0 },
  click:    { name: 'Heel Click', hands: 'both', legs: 'click', table: 0 },
};
for (const k in SLED_TRICKS) SLED_TRICKS[k].noTweak = true;
export const SLED_FOR = {
  safety: 'superman', safety_m: 'superman', mute: 'nohander', mute_m: 'nohander', japan: 'onehander', japan_m: 'onehander', tail: 'scorpion', tail_m: 'scorpion',
  nose: 'kneel', nose_m: 'kneel', truck: 'spread', critical: 'tabletop', critical_m: 'tabletop', octo: 'tuck', blunt: 'superman', blunt_m: 'superman',
  stalefish: 'click', stalefish_m: 'click', bowarrow: 'onehander', dubtail: 'tuck', seatbelt: 'scorpion', seatbelt_m: 'scorpion',
  daffy: 'click', spread: 'spread', backscratch: 'scorpion', ironcross: 'spread',
};
export const sledTrickDef = (id) => SLED_TRICKS[SLED_FOR[id] || id] || null;
RIDE_GRABS.sled = sledTrickDef;
RIDE_SPIN.sled = rideSpin;

let _gltf = null;
Rig.loader.sled = async (rig) => {
  if (!_gltf) {
    const loader = new GLTFLoader(), draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
    _gltf = loader.loadAsync('./models/sled/sled.glb?v=16').catch(e => { _gltf = null; throw e; });
  }
  const gl = await _gltf;
  let mesh = null; gl.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const sl = rig.sl = { root: new THREE.Group() };
  sl.root.name = 'sled';
  const m = new THREE.Mesh(mesh.geometry, mesh.material); m.castShadow = true; sl.root.add(m);
  rig.root.add(sl.root);
  rig.board = sl.root;
  // (snow.js: a thin track from each runner, rig.tracks; P 2026-11-05: one track down the middle before)
  const mk = () => { const o = new THREE.Object3D(); o.userData.hw = 0.022; rig.root.add(o); return o; };
  sl.tr = [mk(), mk()]; rig.tracks = sl.tr; rig.skiL = sl.tr[0]; rig.skiR = sl.tr[1];
};

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
const _q1 = Q(), _q2 = Q(), _qi = Q(), _pelQ = Q(), _chQ = Q(), _hdQ = Q(), _lq = Q(), _bq = Q();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _lp = V(), _acc = V(), _sh = V(), _wr = V(), _el = V(), _fd = V(), _pa = V(), _ft = [V(), V()];

Rig.poser.sled = (rig, S0, dt) => {
  const sl = rig.sl; if (!sl) return;
  const S = liftStand(S0);
  const P = rig.p, sp = springBank(P, dt), b = rig.b;
  const st = S.state || 'ground', air = st === 'air', crash = st === 'crash', ground = st === 'ground', rail = st === 'rail';
  const t = S.t !== undefined ? S.t : (rig._t = (rig._t || 0) + dt), tt = t + rig.ph;
  const vel = S.vel || ZERO;
  const R = rig.placeBody(S), BP = rig.body.position, qi = _qi.copy(R).invert();
  // on the chairlift: sat on the chair, the sled held hanging in front
  if (st === 'lift') { seatRider(rig, S, t); holdOnLift(rig, sl.root, 0.5); rig._pst = st; return; }
  const changed = rig._pst !== st;
  let wy = 0;
  if (rig._pq && dt > 0 && !changed) { const d = _q1.copy(rig._pq).invert().multiply(R); wy = d.y * (d.w < 0 ? -2 : 2) / dt; if (Math.abs(wy) > 20) wy = 0; }
  (rig._pq || (rig._pq = new THREE.Quaternion())).copy(R);
  const Wy = sp('lwy', wy, 14);
  let sx = 0;
  rig._gT = ground && !changed ? (rig._gT || 0) + dt : 0;
  if (ground && rig._gT > 0.06 && dt > 0 && rig._pvOk) { const a = _acc.subVectors(vel, rig._pv).divideScalar(dt); a.y += 9.81; a.applyQuaternion(qi); sx = clamp(a.x, -13, 13); }
  (rig._pv || (rig._pv = new THREE.Vector3())).copy(vel); rig._pvOk = true; rig._pst = st;
  const phi = sp('lphi', clamp(Math.atan2(-sx, 9.81), -0.6, 0.6), 8);
  const airW = sp('lairW', air ? 1 : 0, 9), crashW = sp('lcrash', crash ? 1 : 0, 6);
  const gid = air ? (S.grab || S.pose || null) : null, tr = gid ? sledTrickDef(gid) : null;
  const prep = air ? 1 - smoothstep(0.09, 0.36, rig.timeToGround(S.p, vel)) : 0;
  const hold = tr && prep < 0.6 ? tr : null;
  const W = (name, on, w = 9) => sp(name, on ? 1 : 0, w);
  const sup = W('lsup', hold && hold.legs === 'super', 8);
  const up = W('lup', hold && hold.legs === 'up'), scorp = W('lscorp', hold && hold.legs === 'scorpion'), spread = W('lspread', hold && hold.legs === 'spread');
  const kneel = W('lkneel', hold && hold.legs === 'kneel'), tuck = W('ltuck', hold && hold.legs === 'tuck'), click = W('lclick', hold && hold.legs === 'click');
  const noH = W('lnoh', hold && hold.hands === 'none', 12), oneH = W('loneh', hold && (hold.hands === 'one' || hold.hands === 'none'), 12), table = W('ltable', hold && hold.table);
  const absorb = S.absorb || 0;
  // ---- the sled: leaning with the turn, a little lifted in the air, laid over for a table top
  const lp = _lp.set(0, -(S.sink || 0) + 0.05 * airW, 0), lq = _lq.setFromAxisAngle(Z, phi * 0.6);
  if (table > 0.001) lq.multiply(_q1.setFromAxisAngle(Z, 1.1 * table));
  if (crashW > 0.01) lq.multiply(_q1.setFromAxisAngle(Y, 0.7 * crashW * Math.sin(t * 2.2)));
  sl.root.position.copy(lp).applyQuaternion(R).add(BP); sl.root.quaternion.copy(R).multiply(lq);
  sl.root.updateMatrixWorld(true);
  const SW = sl.root.matrixWorld;
  // the runners' tracks
  for (let k = 0; k < 2; k++) { sl.tr[k].position.set(k ? -0.2 : 0.2, 0, -0.08).applyMatrix4(SW); sl.root.getWorldQuaternion(sl.tr[k].quaternion); }
  // ---- the body lying on it face down, head forward: the rest frame pitched forward a quarter round; the chest a
  // little raised (looking ahead), the hips on the back of the slats; kneeling up or tucked in a trick
  const sledQ = _bq.copy(R).multiply(lq);
  const upK = Math.max(kneel, tuck * 0.8);
  const pelPitch = Math.PI / 2 - 0.05 - 1.2 * upK;
  const pelQ = _pelQ.copy(sledQ).multiply(_q1.setFromAxisAngle(Y, clamp(-Wy * 0.03, -0.15, 0.15))).multiply(_q1.setFromAxisAngle(X, pelPitch));
  const chQ = _chQ.copy(pelQ).multiply(_q1.setFromAxisAngle(X, -0.32 - 0.1 * absorb + 0.1 * wob(tt * 0.8, 3) * airW + 0.6 * upK + 0.22 * sup)).multiply(_q1.setFromAxisAngle(Z, phi * 0.3));
  const pelW = _v1.set(0, SLED.top + 0.13 + 0.25 * upK + 0.1 * sup, SLED.hips + 0.15 * upK - 0.6 * sup).applyMatrix4(SW);
  if (crashW > 0.01) chQ.multiply(_q1.setFromAxisAngle(X, Math.sin(t * 3.1) * 0.5 * crashW));
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v2.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v3.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v3.copy(pelW).sub(off));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  // the head lifted to look where it goes
  const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, clamp(Wy * 0.15, -0.5, 0.5))).multiply(_q1.setFromAxisAngle(X, -0.85 + 0.6 * upK));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  // ---- legs: trailing off the back, toes down; the inside foot drags lower in a turn; up straight (superman), bent
  // over the back (scorpion), wide (spread), heels together up (heel click), knelt on the slats (kneel), tucked
  const sUp = _v4.set(0, 1, 0).applyQuaternion(sledQ), sFw = _v5.set(0, 0, 1).applyQuaternion(sledQ), sLf = _v6.set(1, 0, 0).applyQuaternion(sledQ);
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    th.updateWorldMatrix(false, false);
    const hip = _v2.setFromMatrixPosition(th.matrixWorld);
    const drag = ground ? clamp(-phi * s * 2, 0, 1) : 0;
    const a = _ft[k].copy(hip).addScaledVector(sFw, -rig.legLen * 0.93).addScaledVector(sLf, s * 0.07).addScaledVector(sUp, -0.06 - 0.08 * drag + 0.04 * wob(tt * 1.4, 5 + k));
    // a superman: straight out behind, level with the body
    if (sup > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -rig.legLen * 0.95).addScaledVector(sUp, 0.06).addScaledVector(sLf, s * 0.06), sup);
    if (up > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -rig.legLen * 0.75).addScaledVector(sUp, rig.legLen * 0.5).addScaledVector(sLf, s * 0.05), up);
    if (scorp > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -0.15).addScaledVector(sUp, rig.legLen * 0.62).addScaledVector(sLf, s * 0.08), scorp);
    if (spread > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -rig.legLen * 0.65).addScaledVector(sLf, s * 0.55).addScaledVector(sUp, 0.12), spread);
    if (click > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -0.45).addScaledVector(sUp, 0.42).addScaledVector(sLf, s * 0.02), click);
    if (kneel > 0.01) a.lerp(_v3.set(s * 0.14, SLED.top + 0.12, SLED.hips - 0.12).applyMatrix4(SW), kneel);
    if (tuck > 0.01) a.lerp(_v3.set(s * 0.16, SLED.top + 0.12, SLED.hips + 0.05).applyMatrix4(SW), tuck);
    const d = a.distanceTo(hip), m = softReach(d, rig.legLen, 0.9, 0.985); if (m < d) a.sub(hip).multiplyScalar(m / d).add(hip);
    // the knees bend down towards the snow (lying), back (kneeling)
    const kp = _v3.copy(sUp).negate().addScaledVector(sFw, 0.2 + 0.8 * upK).addScaledVector(sLf, s * 0.1);
    if (scorp + click > 0.01) kp.lerp(_v2.copy(sUp).negate(), scorp + click);
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', a, kp, Z);
    // feet pointed (toes down and back) lying, flat kneeling
    _q2.copy(sledQ).multiply(_q1.setFromAxisAngle(X, Math.PI * 0.95 * (1 - upK)));
    rig.setWorldQ(ft, _q2.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
  }
  // ---- arms: hands on the front of the sled; out wide with no hands (the right one first)
  const cL = _v2.set(1, 0, 0).applyQuaternion(chQ), armL = rig.len.ua + rig.len.fa;
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    ua.updateWorldMatrix(false, false);
    const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
    const offK = k ? oneH : noH;
    const hold_ = _wr.set(s * SLED.hand[0], SLED.hand[1], SLED.hand[2]).applyMatrix4(SW);
    const free = _v3.copy(sh).addScaledVector(sLf, s * (0.5 + 0.05 * wob(tt * 1.3, 31 + k))).addScaledVector(sUp, 0.15 + 0.08 * wob(tt * 1.7, 33 + k)).addScaledVector(sFw, 0.15);
    const wr = hold_.lerp(free, offK);
    if (crashW > 0.5) wr.copy(sh).addScaledVector(cL, s * 0.35).addScaledVector(sUp, 0.25 + Math.sin(t * 9 + s) * 0.2);
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.82, 0.97); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const el = _el.copy(cL).multiplyScalar(s).addScaledVector(sUp, 0.6).normalize();
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    const fd = _fd.copy(sFw).addScaledVector(sUp, -0.4).normalize(), pa = _pa.copy(sUp).negate().lerp(_v6.copy(cL).multiplyScalar(-s), offK).normalize();
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
    rig.curl(HH, 1.25 - 0.7 * offK);
    sFw.set(0, 0, 1).applyQuaternion(sledQ); sUp.set(0, 1, 0).applyQuaternion(sledQ); sLf.set(1, 0, 0).applyQuaternion(sledQ);
  }
  rig.placeHead(hdQ);
  rig.flushTree(rig.body);
};
