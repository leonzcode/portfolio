// The snow scooter (a snowscoot): a stunt scooter's deck, neck, fork and bars on two short boards, ridden standing,
// both hands on the bars (models/scoot/scoot.glb: "street scooter" by JamesFowler and the snowboard's board, both CC BY;
// see CREDITS.md). Registered with the rig like the board (Rig.loader.scoot, Rig.poser.scoot).
//   Frames: the physics' body frame (skier.q) is the scooter's: +Z forward, +Y up, +X the rider's left; the rider faces
//   forward, left foot in front on the deck, the back foot turned out behind it.
//   The model has two parts: 'deck' (deck, neck, rear board) and 'steer' (stem, bars, fork, front board) turning about
//   the steering axis (its local +Y), so the bars steer, and bar spins and tail whips are turns about that axis.
// Tricks are held like grabs (each grab key gives one, SCOOT_TRICKS / SCOOT_FOR), named as scooter riders name them
// (Bar Spin, Tail Whip, No Hander, No Footer, One Footer, Superman, Can Can, X-Up, Table Top, Tuck No Hander).
// A bar spin or a tail whip, once started, goes all the way round (0.45 s a turn) so the bars and deck always come
// back to where they belong; held longer, it goes round again.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Rig, springBank, smooth01, softReach, wob } from './rig.js?v=16';
import { RIDE_GRABS, seatRider, holdOnLift, liftStand } from './board.js?v=16';
import { clamp, smoothstep } from './noise.js?v=16';
import { RIDE_SPIN } from './tricks.js?v=16';

// where things are on the model (from tools/makescoot.py's printout): the deck's top, the feet on it, the grips on the
// bars (in the steering part's own frame, up its axis), how far the boards' bases sit under the feet's frame
export const SCOOT = { half: 0.45, file: 'scoot/scoot.glb', base: 'deck', name: 'scooter', feet: 'deck', deckTop: 0.045, footF: [0.0, 0.12], footB: [-0.03, -0.2], grip: 0.255, gripUp: 0.925, gripZ: 0, turnK: 0.55, spinT: 0.45,
  trR: [0, 0.004, -0.11], trF: [0, -0.058, 0.06], trW: [0.12, 0.095] };
// the snowbike (a ski bike, models/bike/bike.glb: "BMX Bike" by erdmdgdln and the snowboard's board, CC BY): seated on
// the saddle, the hands on the bars, the feet on two short foot skis on the snow beside it (up on the frame in the air)
// (P: in the air the feet stay low beside the frame on their foot skis, as ski bikers ride, not up on pegs)
export const BIKE = { half: 0.75, file: 'bike/bike.glb', base: 'frame', name: 'snowbike', feet: 'skis', seat: { y: 0.5, z: -0.15 }, snowFoot: [0.23, 0.08], peg: [0.2, 0.06, 0.02],
  grip: 0.36, gripUp: 0.76, gripZ: 0.05, turnK: 0.5, spinT: 0.5, trR: [0, 0, -0.42], trF: [0, -0.204, 0.03], trW: [0.085, 0.075] };

// ---- tricks: [hands on the bars 'both' | 'none' | 'L' | 'R', feet 'on' | 'off' | 'back' (left on, right off) | 'over'
// (a can can: the right leg over the deck to the left side), parts: 'bar' (bars spin) | 'whip' (deck whips round) |
// 'x' (bars turned half round, arms crossed) | 'table' (the scooter laid flat sideways) | '', body: lean, tuck]
export const SCOOT_TRICKS = {
  barspin:  { name: 'Bar Spin', hands: 'spin', feet: 'on', part: 'bar', lean: 0.35, tuck: 0.4 },
  tailwhip: { name: 'Tail Whip', hands: 'both', feet: 'off', part: 'whip', lean: 0.45, tuck: 0.75 },
  nohander: { name: 'No Hander', hands: 'none', feet: 'on', part: '', lean: 0.15, tuck: 0.35 },
  nofooter: { name: 'No Footer', hands: 'both', feet: 'off', part: '', lean: 0.35, tuck: 0.2 },
  onefooter: { name: 'One Footer', hands: 'both', feet: 'back', part: '', lean: 0.3, tuck: 0.3 },
  superman: { name: 'Superman', hands: 'both', feet: 'super', part: '', lean: 0.9, tuck: 0.0 },
  cancan:   { name: 'Can Can', hands: 'both', feet: 'over', part: '', lean: 0.35, tuck: 0.35 },
  xup:      { name: 'X-Up', hands: 'both', feet: 'on', part: 'x', lean: 0.3, tuck: 0.35 },
  tabletop: { name: 'Table Top', hands: 'both', feet: 'on', part: 'table', lean: 0.4, tuck: 0.55 },
  tucknh:   { name: 'Tuck No Hander', hands: 'none', feet: 'on', part: '', lean: 0.55, tuck: 0.95 },
};
for (const k in SCOOT_TRICKS) SCOOT_TRICKS[k].noTweak = true;
// (how long the bars or the deck take to go round: one landed sooner than that after it started is sketchy, tricks.js)
SCOOT_TRICKS.barspin.spinT = SCOOT_TRICKS.tailwhip.spinT = 0.45;
// the ski grab keys to scooter tricks
export const SCOOT_FOR = {
  safety: 'barspin', safety_m: 'barspin', mute: 'tailwhip', mute_m: 'tailwhip', blunt: 'tailwhip', blunt_m: 'tailwhip', japan: 'nohander', japan_m: 'nohander',
  tail: 'superman', tail_m: 'superman', nose: 'cancan', nose_m: 'cancan', truck: 'nofooter', critical: 'xup', critical_m: 'xup', octo: 'tabletop',
  stalefish: 'onefooter', stalefish_m: 'onefooter', bowarrow: 'onefooter', dubtail: 'tucknh', seatbelt: 'cancan', seatbelt_m: 'cancan',
  daffy: 'onefooter', spread: 'nofooter', backscratch: 'superman', ironcross: 'xup',
};
export const scootTrickDef = (id) => SCOOT_TRICKS[SCOOT_FOR[id] || id] || null;
/* the snowbike's own (Leon: "whips, no-handers, can-cans, superman, 360s, flips", from ski bike and BMX riding, P
   2026-11-05): a whip throws the bike sideways under the rider and back; a heel clicker brings both feet up over the
   front ski, heels together; a seat grab holds the saddle with one hand, the legs off to the sides; a nac nac kicks
   one leg back over the rear ski. Tail whips are left to the scooter. */
const BIKE_TRICKS = Object.assign({}, SCOOT_TRICKS, {
  whip:      { name: 'Whip', hands: 'both', feet: 'on', part: 'whipside', lean: 0.3, tuck: 0.3 },
  heelclick: { name: 'Heel Clicker', hands: 'both', feet: 'click', part: '', lean: -0.1, tuck: 0.15 },
  seatgrab:  { name: 'Seat Grab', hands: 'seat', feet: 'off', part: '', lean: 0.45, tuck: 0.25 },
  nacnac:    { name: 'Nac Nac', hands: 'both', feet: 'nac', part: '', lean: 0.3, tuck: 0.3 },
  barspin:   Object.assign({}, SCOOT_TRICKS.barspin, { spinT: 0.5 }),
});
for (const k in BIKE_TRICKS) BIKE_TRICKS[k].noTweak = true;
export const BIKE_FOR = {
  safety: 'whip', safety_m: 'whip', mute: 'nohander', mute_m: 'nohander', japan: 'cancan', japan_m: 'cancan', tail: 'superman', tail_m: 'superman',
  nose: 'heelclick', nose_m: 'heelclick', truck: 'nofooter', critical: 'xup', critical_m: 'xup', octo: 'tabletop', stalefish: 'nacnac', stalefish_m: 'nacnac',
  bowarrow: 'seatgrab', dubtail: 'tucknh', seatbelt: 'seatgrab', seatbelt_m: 'seatgrab', blunt: 'barspin', blunt_m: 'barspin',
  daffy: 'nacnac', spread: 'nofooter', backscratch: 'superman', ironcross: 'xup',
};
export const bikeTrickDef = (id) => BIKE_TRICKS[BIKE_FOR[id] || id] || null;
RIDE_GRABS.scoot = scootTrickDef; RIDE_GRABS.bike = bikeTrickDef;
/* spins and flips as scooter, BMX and sled riders name them (P, 2026-11-05): 180, 360, 540; a Backflip, a Frontflip, a
   Double Backflip; a flip with a spin in it, 360 Backflip; turned over sideways, a Barrel Roll; riding backwards, Fakie */
export function rideSpin(A) {
  const spinR = Math.round(Math.abs(A.spin) / 180) * 180;
  if (!A.inv && spinR < 180) return null;
  const parts = A.sw ? ['Fakie'] : [];
  if (A.inv > 0) {
    const mult = ['', 'Double ', 'Triple ', 'Quad '][Math.min(A.inv, 4) - 1];
    const f = Math.abs(A.roll) > Math.abs(A.flip) ? 'Barrel Roll' : A.flip < 0 ? 'Backflip' : 'Frontflip';
    parts.push(spinR >= 180 ? `${spinR} ${mult}${f}` : `${mult}${f}`);
  } else parts.push(`${spinR}`);
  return parts;
}
RIDE_SPIN.scoot = RIDE_SPIN.bike = rideSpin;

// ---- the model -----------------------------------------------------------------------------------------------------------
const _gltf = {};
function loadModel(file) {
  if (_gltf[file]) return _gltf[file];
  const loader = new GLTFLoader();
  const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
  _gltf[file] = loader.loadAsync('./models/' + file + '?v=16').catch(e => { _gltf[file] = null; throw e; });
  return _gltf[file];
}
const frameLoader = cfg => async (rig) => {
  const gl = await loadModel(cfg.file);
  const src = {}; gl.scene.traverse(o => { if (o.isMesh || o.name) src[o.name] = src[o.name] || o; });
  const sc = rig.sc = { root: new THREE.Group(), cfg };
  sc.root.name = cfg.name;
  const part = n => { const o = src[n].clone(true); o.traverse(m => { if (m.isMesh) m.castShadow = true; }); return o; };
  sc.deck = part(cfg.base); sc.steer = part('steer');
  // the rider's foot skis (the snowbike): one under each boot, placed every frame
  if (cfg.feet === 'skis') { sc.feet = [part('footski'), part('footski')]; for (const f of sc.feet) { f.position.set(0, 0, 0); rig.root.add(f); } }
  sc.steerPos = sc.steer.position.clone(); sc.steerQ = sc.steer.quaternion.clone();         // the steering axis's place and tilt
  sc.axis = new THREE.Vector3(0, 1, 0).applyQuaternion(sc.steerQ);
  sc.root.add(sc.deck, sc.steer);
  rig.root.add(sc.root);
  rig.board = sc.root;
  // (snow.js: tracks where the boards (the bike's two skis, and the foot skis) meet the snow, rig.tracks; P 2026-11-05:
  // skiL / skiR were the deck and the bars, children of the scooter, whose positions are its own, not the world's)
  const mk = hw => { const o = new THREE.Object3D(); o.userData.hw = hw; rig.root.add(o); return o; };
  sc.tr = [mk(cfg.trW[0]), mk(cfg.trW[1])];
  if (sc.feet) for (const f of sc.feet) { f.userData.hw = 0.05; sc.tr.push(f); }
  rig.tracks = sc.tr; rig.skiL = sc.tr[0]; rig.skiR = sc.tr[1];
  sc.bar = 0; sc.whip = 0; sc.barGo = 0; sc.whipGo = 0;
};
Rig.loader.scoot = frameLoader(SCOOT);
Rig.loader.bike = frameLoader(BIKE);

// ---- the pose ------------------------------------------------------------------------------------------------------------
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
const _q1 = Q(), _q2 = Q(), _q3 = Q(), _qi = Q(), _sq = Q(), _pelQ = Q(), _chQ = Q(), _hdQ = Q(), _lq = Q(), _wq = Q();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _ub = V(), _lp = V(), _pv = V(), _acc = V(), _vb = V(), _sh = V(), _wr = V(), _el = V(), _fd = V(), _pa = V(), _cF = V(), _cL = V();
const _foot = [V(), V()], _grip = [V(), V()], _ax = V(), _piv = V(), _seat0 = V();
// a track point: at pt in the part's frame, turned as the part is
function mark(o, part, pt) { o.position.set(pt[0], pt[1], pt[2]).applyMatrix4(part.matrixWorld); part.getWorldQuaternion(o.quaternion); }
const BS = ['ss0', 'ss1', 'ss2', 'ss3'];

Rig.poser.scoot = Rig.poser.bike = (rig, S0, dt) => {
  const sc = rig.sc; if (!sc) return;
  const S = liftStand(S0);
  const cfg = sc.cfg, seat = cfg.seat, skis = cfg.feet === 'skis', trDef = skis ? bikeTrickDef : scootTrickDef;
  const P = rig.p, sp = springBank(P, dt), b = rig.b;
  const st = S.state || 'ground', air = st === 'air', rail = st === 'rail', crash = st === 'crash', ground = st === 'ground', lift = st === 'lift';
  const t = S.t !== undefined ? S.t : (rig._t = (rig._t || 0) + dt);
  const vel = S.vel || ZERO, speed = S.speed !== undefined ? S.speed : vel.length();
  const R = rig.placeBody(S), BP = rig.body.position, qi = _qi.copy(R).invert();
  // on the chairlift: sat on the chair, the scooter or bike held hanging in front
  if (lift) {
    seatRider(rig, S, t); sc.steer.position.copy(sc.steerPos); sc.steer.quaternion.copy(sc.steerQ); sc.deck.position.set(0, 0, 0); sc.deck.quaternion.identity();
    holdOnLift(rig, sc.root, cfg.half || 0.5);
    if (sc.feet) for (let k = 0; k < 2; k++) { const ft = k ? rig.b.ftR : rig.b.ftL, fs = sc.feet[k]; ft.matrixWorld.decompose(_v1, _q2, _v5); fs.quaternion.copy(_q2).multiply(_q3.copy(rig.rest[k ? 'ftR' : 'ftL'].q).invert()); fs.position.copy(_v1).addScaledVector(_v5.set(0, 1, 0).applyQuaternion(fs.quaternion), -(rig.ankleH + 0.035)); }
    rig._pst = st; return;
  }
  const changed = rig._pst !== st;
  // how the body turns, and the snow's push sideways (for the lean into a turn)
  let wy = 0;
  if (rig._pq && dt > 0 && !changed) { const d = _q1.copy(rig._pq).invert().multiply(R); wy = d.y * (d.w < 0 ? -2 : 2) / dt; if (Math.abs(wy) > 20) wy = 0; }
  (rig._pq || (rig._pq = new THREE.Quaternion())).copy(R);
  const Wy = sp('swy', wy, 14);
  let sx = 0;
  rig._gT = ground && !changed ? (rig._gT || 0) + dt : 0;
  if (ground && rig._gT > 0.06 && dt > 0 && rig._pvOk) { const a = _acc.subVectors(vel, rig._pv).divideScalar(dt); a.y += 9.81; a.applyQuaternion(qi); sx = clamp(a.x, -13, 13); }
  (rig._pv || (rig._pv = new THREE.Vector3())).copy(vel); rig._pvOk = true; rig._pst = st;
  const Sx = sp('ssx', sx, 10), phi = clamp(Math.atan2(-Sx, 9.81), -0.7, 0.7);
  const airW = sp('sairW', air ? 1 : 0, air ? 10 : 9), crashW = sp('scrash', crash ? 1 : 0, 6);
  const tt = t + rig.ph, absorb = S.absorb || 0;
  rig._airT = air ? (changed ? 0 : (rig._airT || 0) + dt) : 0;
  const popK = air ? smooth01(rig._airT / 0.05) * (1 - smoothstep(0.12, 0.34, rig._airT)) : 0;
  // ---- the trick held, and the parts that go round once started
  const gid = air ? (S.grab || S.pose || null) : null, tr = gid ? trDef(gid) : null;
  const prep = air ? 1 - smoothstep(0.09, 0.36, rig.timeToGround(S.p, vel)) : 0;
  const hold = tr && prep < 0.6 ? 1 : 0;
  // (a bar spin or tail whip goes all the way round: the turn left to go is kept, and another is added while held)
  for (const [k, go] of [['bar', 'barGo'], ['whip', 'whipGo']]) {
    const want = hold && tr.part === k;
    if (want && sc[go] <= 0) sc[go] = 1;
    if (sc[go] > 0) { const step = Math.min(sc[go], dt / cfg.spinT); sc[go] -= step; sc[k] += step; }
    if (!air && sc[go] > 0) { sc[k] += sc[go]; sc[go] = 0; }          // landed mid-turn: it is finished at once
  }
  const barA = (sc.bar % 1) * Math.PI * 2, whipA = (sc.whip % 1) * Math.PI * 2;
  const barOn = sc.barGo > 0 ? 1 : 0;                                    // the hands are off while the bars go round
  const xup = sp('sxup', hold && tr.part === 'x' ? 1 : 0, 9), table = sp('stable', hold && tr.part === 'table' ? 1 : 0, 9);
  const feetOff = sp('sfoff', hold && (tr.feet === 'off' || tr.feet === 'super') ? 1 : 0, 10), oneOff = sp('s1off', hold && tr.feet === 'back' ? 1 : 0, 10), nac = sp('snac', hold && tr.feet === 'nac' ? 1 : 0, 9);
  const over = sp('sover', hold && tr.feet === 'over' ? 1 : 0, 9), superW = sp('ssuper', hold && tr.feet === 'super' ? 1 : 0, 8);
  const handsOff = sp('shoff', (hold && tr.hands === 'none') || barOn ? 1 : 0, barOn ? 30 : 12);
  const whipS = sp('swhipS', hold && tr.part === 'whipside' ? 1 : 0, 7, 0.8), click = sp('sclick', hold && tr.feet === 'click' ? 1 : 0, 9), seatH = sp('sseatH', hold && tr.hands === 'seat' ? 1 : 0, 11);
  const whipping = sc.whipGo > 0 ? 1 : 0;
  // ---- the scooter, in the body's frame: leaning with the turn, the bars turned with it; in the air brought up under
  // the rider, tipped back a little at the pop, laid flat for a table top
  // (in the air the knees bend as the trick asks: the physics' own crouch for a held grab sat the rider on their heels)
  const crouch = sp('scrouch', clamp(air ? (tr ? 0.22 + 0.45 * tr.tuck : 0.36 + 0.25 * popK) : (S.crouch ?? 0.3) + 0.05 + absorb * 0.7, 0, 1), 18);
  const lp = _lp.set(0, 0, 0), lq = _lq.setFromAxisAngle(Z, phi * 0.9);
  lp.y -= (S.sink || 0);
  const lift_ = sp('slift', air ? 0.03 + 0.05 * crouch + (tr ? 0.1 * tr.tuck : 0) - 0.03 * superW : 0, 12, air ? 0.8 : 1);
  lp.y += lift_;
  lq.multiply(_q1.setFromAxisAngle(X, -0.25 * popK + 0.06 * Math.sin(tt * 1.1) * airW));
  if (table > 0.001) lq.multiply(_q1.setFromAxisAngle(Z, -1.2 * table));
  if (superW > 0.001) lp.z += 0.15 * superW;
  if (crashW > 0.01) { lp.y += 0.15 * crashW; lq.multiply(_q1.setFromAxisAngle(Y, 0.6 * crashW * Math.sin(t * 2.1))); }
  // (the saddle where it is before a whip turns the bike away under the rider, who stays sat facing the way they go)
  if (seat) _seat0.set(0, seat.y, seat.z).applyQuaternion(lq).add(lp).applyQuaternion(R).add(BP);
  // a whip (the snowbike): the bike thrown round sideways under the rider and laid over, then back
  if (whipS > 0.001) lq.premultiply(_q1.setFromAxisAngle(Y, 0.85 * whipS)).multiply(_q2.setFromAxisAngle(Z, -0.55 * whipS));
  const root = sc.root;
  root.position.copy(lp).applyQuaternion(R).add(BP); root.quaternion.copy(R).multiply(lq);
  // the steering: the bars turned with the turn on the snow, a bar spin's or an x-up's turn in the air
  // (as much as the turn needs at this speed, the boards' length apart: a few degrees fast, more slow; it was the turn
  // rate times 0.55 at any speed, 30 degrees of bar at 9 m/s, P 2026-11-05)
  const steerT = ground ? clamp(Math.atan(cfg.half * 1.3 * Wy / Math.max(speed, 1.5)) * 1.4, -0.5, 0.5) : 0;
  const steerA = sp('ssteer', steerT, 10) + barA + Math.PI * xup;
  sc.steer.position.copy(sc.steerPos); sc.steer.quaternion.copy(sc.steerQ).multiply(_q1.setFromAxisAngle(Y, steerA));
  // a tail whip: the deck goes round the steering axis (the bars held still)
  sc.deck.position.set(0, 0, 0); sc.deck.quaternion.identity();
  if (whipA) { _ax.copy(sc.axis); _q2.setFromAxisAngle(_ax, whipA); sc.deck.position.copy(sc.steerPos).negate().applyQuaternion(_q2).add(sc.steerPos); sc.deck.quaternion.copy(_q2); }
  root.updateMatrixWorld(true);
  // where the boards meet the snow, for the tracks
  if (sc.tr) { mark(sc.tr[0], sc.deck, cfg.trR); mark(sc.tr[1], sc.steer, cfg.trF); }
  // ---- feet and grips in the world
  const deckW = sc.deck.matrixWorld;
  if (!skis) {
    _foot[0].set(cfg.footF[0], cfg.deckTop + 0.03 + rig.ankleH, cfg.footF[1] - 0.05).applyMatrix4(deckW);
    _foot[1].set(cfg.footB[0], cfg.deckTop + 0.03 + rig.ankleH, cfg.footB[1] - 0.04).applyMatrix4(deckW);
  } else {
    // the snowbike: the feet on their foot skis on the snow beside the frame; in the air up on the frame
    const pegK = sp('speg', air ? 1 : 0, air ? 9 : 14);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1;
      _v5.set(s * cfg.snowFoot[0], 0.03 + rig.ankleH - (S.sink || 0), cfg.snowFoot[1] - 0.05).applyQuaternion(R).add(BP);
      _v6.set(s * cfg.peg[0], cfg.peg[1] + 0.03 + rig.ankleH, cfg.peg[2]).applyMatrix4(deckW);
      _foot[k].lerpVectors(_v5, _v6, pegK);
    }
  }
  const steerW = sc.steer.matrixWorld;
  _grip[0].set(cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(steerW); _grip[1].set(-cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(steerW);
  if (xup > 0.5) { const tmp = _v1.copy(_grip[0]); _grip[0].copy(_grip[1]); _grip[1].copy(tmp); }   // arms crossed
  // feet off the deck: out to the sides (no footer), the right one out (one footer), back and up (superman), the right
  // leg over to the left side (can can); in a tail whip the legs tuck up while the deck goes round under them
  const ub = _ub.set(0, 1, 0).applyQuaternion(R), fw = _v2.set(0, 0, 1).applyQuaternion(R), lf = _v3.set(1, 0, 0).applyQuaternion(R);
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, f = _foot[k];
    if (feetOff > 0.01) f.addScaledVector(lf, s * 0.35 * feetOff * (1 - superW)).addScaledVector(ub, 0.08 * feetOff * (1 - superW));
    // a heel clicker: both feet up over the front, heels together
    if (click > 0.01) f.lerp(_v5.setFromMatrixPosition(sc.steer.matrixWorld).addScaledVector(fw, 0.2).addScaledVector(ub, 0.42).addScaledVector(lf, s * 0.05), click);
    if (k === 1 && oneOff > 0.01) f.addScaledVector(lf, -0.45 * oneOff).addScaledVector(ub, 0.12 * oneOff);
    if (k === 1 && over > 0.01) f.addScaledVector(lf, 0.4 * over).addScaledVector(ub, 0.2 * over).addScaledVector(fw, 0.15 * over);
    if (k === 1 && nac > 0.01) f.addScaledVector(lf, 0.25 * nac).addScaledVector(ub, 0.35 * nac).addScaledVector(fw, -0.55 * nac);
    if (whipping) f.addScaledVector(ub, 0.25).addScaledVector(fw, -0.05);
  }
  // ---- the body: over the deck, crouched to the bars; in a superman stretched out behind them
  const A0 = rig.ankleH + (cfg.deckTop || 0) + 0.03;
  let H = A0 + lift_ + rig.legLen * 0.97 * (0.95 - 0.45 * crouch) + (rig.pelvisY - rig.hipY);
  const pelW = _v4.set(-Math.sin(phi) * 0.5 + 0.015 * wob(tt * 1.7, 4.4) * (1 - airW), H, -0.06 - 0.1 * crouch - 0.25 * superW).applyQuaternion(R).add(BP);
  // the snowbike: sat on the saddle (off it, standing behind, for a superman or no footer)
  if (seat) {
    const up_ = feetOff * 0.6; _v5.set(0, seat.y + 0.09 + (rig.pelvisY - rig.hipY) + 0.1 * up_, seat.z - 0.04).applyMatrix4(deckW);
    // (in a whip the rider stays where the saddle was before the bike went round)
    if (whipS > 0.001) _v5.lerp(_seat0.addScaledVector(ub, 0.09 + (rig.pelvisY - rig.hipY)), whipS * 0.8);
    pelW.lerp(_v5, 1);
  }
  /* a superman: the body stretched out flat behind the bars, arms straight to them, legs straight out behind (P,
     2026-11-05: it was crouched over the deck with the feet hanging under it) */
  if (superW > 0.01) {
    const sup = _v6.copy(_grip[0]).add(_grip[1]).multiplyScalar(0.5).addScaledVector(fw, -(rig.len.ua + rig.len.fa) * 0.72 - 0.4).addScaledVector(ub, -0.16);
    pelW.lerp(sup, superW);
    for (let k = 0; k < 2; k++) _foot[k].lerp(_v5.copy(pelW).addScaledVector(fw, -rig.legLen * 0.93).addScaledVector(ub, 0.06).addScaledVector(lf, (k ? -1 : 1) * 0.08), superW);
  }
  const lean = sp('slean', (tr ? tr.lean : air ? 0.3 : 0.3 + 0.2 * crouch) - 0.3 * absorb + 0.15 * popK, air ? 12 : 9, air ? 0.8 : 1);
  const twist = sp('stw', clamp(-Wy * 0.04, -0.2, 0.2) + 0.05 * wob(tt * 0.9, 3.7) * (1 - airW), 9);
  const pelQ = _pelQ.copy(R).multiply(_q1.setFromAxisAngle(Y, twist * 0.4)).multiply(_q1.setFromAxisAngle(Z, phi * 0.6)).multiply(_q1.setFromAxisAngle(X, 1.35 * superW));
  const chQ = _chQ.copy(R).multiply(_q1.setFromAxisAngle(Y, twist)).multiply(_q1.setFromAxisAngle(Z, phi * 0.25)).multiply(_q1.setFromAxisAngle(X, lean + (1.45 - lean) * superW));
  if (crashW > 0.01) chQ.multiply(_q1.setFromAxisAngle(X, Math.sin(t * 3.1) * 0.5 * crashW));
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v5.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v6.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v6.copy(pelW).sub(off));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  // the head: forward, a little over the bars, looking where it goes (round the bars in a spin)
  const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, clamp(-twist + Wy * 0.06, -1, 1))).multiply(_q1.setFromAxisAngle(X, 0.15 - lean * 0.75));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  // ---- legs: knees forward over the feet
  for (let k = 0; k < 2; k++) {
    const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL, s = k ? -1 : 1;
    th.updateWorldMatrix(false, false);
    const hip = _v5.setFromMatrixPosition(th.matrixWorld), an = _foot[k];
    const d = an.distanceTo(hip), m = softReach(d, rig.legLen, 0.88, 0.975); if (m < d) an.sub(hip).multiplyScalar(m / d).add(hip);
    const kp = _v1.copy(fw).addScaledVector(lf, s * 0.15).addScaledVector(ub, 0.2);
    if (superW > 0.01) kp.lerp(_v6.copy(ub).negate(), superW);
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', an, kp, Z);
    // the front foot points forward, the back one turned out across the deck (as riders stand)
    const yaw = k ? -0.55 : -0.1;
    _q3.copy(sc.deck.getWorldQuaternion(_wq)).multiply(_q1.setFromAxisAngle(Y, yaw * (1 - feetOff)));
    rig.setWorldQ(ft, _q3.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
    // a foot ski under the boot (the snowbike)
    if (sc.feet) {
      const fs = sc.feet[k]; ft.updateWorldMatrix(false, false); ft.matrixWorld.decompose(_v1, _q2, _v5);
      fs.quaternion.copy(_q2).multiply(_q3.copy(rig.rest[k ? 'ftR' : 'ftL'].q).invert());
      fs.position.copy(_v1).addScaledVector(_v5.set(0, 1, 0).applyQuaternion(fs.quaternion), -(rig.ankleH + 0.035)).addScaledVector(_v6.set(0, 0, 1).applyQuaternion(fs.quaternion), 0.04);
    }
  }
  // ---- arms: to the grips (fingers round them, palms down), or out wide with no hands
  const cF = _cF.set(0, 0, 1).applyQuaternion(chQ), cL = _cL.set(1, 0, 0).applyQuaternion(chQ);
  const armL = rig.len.ua + rig.len.fa, barQ = sc.steer.getWorldQuaternion(_sq);
  const barX = _v6.set(1, 0, 0).applyQuaternion(barQ);
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    ua.updateWorldMatrix(false, false);
    const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
    // the free hand: out and up, floating
    const free = _v1.copy(sh).addScaledVector(cL, s * (0.38 + 0.05 * wob(tt * 1.3, 31 + k))).addScaledVector(ub, 0.05 + 0.08 * wob(tt * 1.6, 33 + k)).addScaledVector(cF, 0.12);
    const off1 = k === 1 ? Math.max(handsOff, 0) : handsOff;
    const wr = _wr.copy(_grip[k]).addScaledVector(ub, 0.02).lerp(free, off1);
    // a seat grab (the snowbike): the right hand back on the saddle
    if (k === 1 && seatH > 0.01 && seat) wr.lerp(_v5.set(0, seat.y + 0.06, seat.z - 0.12).applyMatrix4(sc.deck.matrixWorld), seatH);
    if (crashW > 0.5) wr.copy(sh).addScaledVector(cL, s * 0.35).addScaledVector(ub, 0.2 + Math.sin(t * 9 + s) * 0.2);
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.8, 0.97); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const el = _el.copy(cL).multiplyScalar(s * 0.8).addScaledVector(ub, -0.6).addScaledVector(cF, -0.3).normalize();
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    // on the grip: fingers wrapped forward over the bar, palm down; free: relaxed
    const fd = _fd.copy(cF).addScaledVector(ub, -0.3).normalize().lerp(_v5.copy(barX).multiplyScalar(-s).lerp(cF, 0.5).normalize(), 1 - off1).normalize();
    const pa = _pa.copy(ub).negate().lerp(_v5.copy(cL).multiplyScalar(-s), off1).normalize();
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
    rig.curl(HH, 1.3 - 0.7 * off1);
  }
  rig.placeHead(hdQ);
  rig.flushTree(rig.body);
};
