// The snow scooter (a snowscoot): a stunt scooter's deck, neck, fork and bars on two short boards, ridden standing,
// both hands on the bars (models/scoot/scoot.glb: "street scooter" by JamesFowler and the snowboard's board, both CC BY;
// see CREDITS.md), and the snowbike (a ski bike, models/bike/bike.glb: "BMX Bike" by erdmdgdln and the board, CC BY),
// sat on the saddle with the feet on two short foot skis. Registered with the rig like the board (Rig.loader.scoot,
// Rig.poser.scoot, and the same for bike).
//   Frames: the physics' body frame (skier.q) is the vehicle's: +Z forward, +Y up, +X the rider's left; the rider faces
//   forward, on the scooter the left foot in front on the deck, the back foot turned out behind it.
//   Each model has two parts: 'deck' (the scooter's deck, neck and rear board; the bike's 'frame', saddle and rear ski)
//   and 'steer' (stem, bars, fork and front board or ski) turning about the steering axis (its local +Y), so the bars
//   steer, and bar spins and tailwhips are turns about that axis.
/* Tricks (X, 2026-11-05, for "more snowscooter and snowbike tricks that actually look different from each other ...
   tailwhips, bar spins, briflips, buttercups, inwards, superman and different grabs", then "kickless" and "shifties").
   As scooter, BMX and FMX riders name them (scootering's tricktionaries: Scooter Resource's, Stuntstep's; Land The
   Trick; Pro Scooter's bri flip page; Vincent Kudrna's front bri):
     Timed, a part going all the way round (skier.js RIDE_ACTS; a key starts one, held it goes round again):
       Tailwhip      the deck kicked backwards round the bars' axis, the feet lifted while it goes round under them
       Kickless      the deck pushed out in front (the heelwhip way) and carried round by the arms swinging the bars, the
                     feet tucked up, no kick
       Barspin       the bars let go and spun a full turn while the deck stays under the feet
       Briflip       the bars turned a quarter and the whole scooter flipped backwards round them, up over the shoulder
                     (Brian Boston's, "a scooter flip and an X-up together")
       Inward Bri    the briflip the other way, the scooter flipped forwards over the shoulder (front bri)
       Finger Whip   one hand down to the deck, spinning it round
       Buttercup     a tailwhip to a briflip to a tailwhip (Raymond Warner's)
     Held, like grabs: No Hander (arms out wide), Suicide No Hander (hands behind the back), Tuck No Hander (knees up to
       the bars), No Footer (legs out to the sides), Can Can (one leg across the deck), Nac Nac (one leg kicked back over
       the tail), Superman (legs straight out behind, arms straight to the bars), X-Up (bars turned half round, arms
       crossed), Toboggan (one hand on the tail, the nose pointed down, bars turned), Table Top (the scooter laid flat)
     The snowbike adds the FMX ones: Whip (the bike thrown sideways), Heel Clicker (heels clicked over the bars),
       Cliffhanger (stood up on the bars, toes hooked under them, hands up), Lazy Boy (lying back on the saddle, feet
       under the bars, arms back), Kiss of Death (a handstand on the bars), Indian Air (legs running in the air)
     Shifties (Shift or A / D in the air, skier.shift): the vehicle turned across under the body and back. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Rig, springBank, smooth01, softReach, wob } from './rig.js?v=17';
import { RIDE_GRABS, RIDE_GUIDES, seatRider, holdOnLift, liftStand } from './board.js?v=17';
import { clamp, smoothstep } from './noise.js?v=17';
import { RIDE_SPIN } from './tricks.js?v=17';
import { RIDE_ACTS } from './skier.js?v=17';
import { height } from './terrain.js?v=17';

// where things are on the model (from tools/makescoot.py's printout): the deck's top, the feet on it, the grips on the
// bars (in the steering part's own frame, up its axis), how far the boards' bases sit under the feet's frame
export const SCOOT = { half: 0.45, file: 'scoot/scoot.glb', base: 'deck', name: 'scooter', feet: 'deck', deckTop: 0.045, footF: [0.0, 0.12], footB: [-0.03, -0.2], grip: 0.255, gripUp: 0.925, gripZ: 0,
  tail: [0, 0.075, -0.4], trR: [0, 0.004, -0.11], trF: [0, -0.058, 0.06], trW: [0.12, 0.095] };
// the snowbike: seated on the saddle, the hands on the bars, the feet on two short foot skis on the snow beside it (in
// the air low beside the frame, as ski bikers ride)
export const BIKE = { half: 0.75, file: 'bike/bike.glb', base: 'frame', name: 'snowbike', feet: 'skis', seat: { y: 0.5, z: -0.15 }, snowFoot: [0.23, 0.08], peg: [0.2, 0.06, 0.02],
  grip: 0.36, gripUp: 0.76, gripZ: 0.05, trR: [0, 0, -0.42], trF: [0, -0.204, 0.03], trW: [0.085, 0.075] };

// ---- the tricks ---------------------------------------------------------------------------------------------------------
// a timed trick has act (seconds a round) and pts (points a round); loop false: holding it does not go round again
const D = (name, guide, more) => Object.assign({ name, guide, noTweak: true }, more || {});
export const SCOOT_TRICKS = {
  tailwhip:   D('Tailwhip', 'the deck kicked round the bars, feet up', { act: 0.42, pts: 260 }),
  kickless:   D('Kickless', 'the deck pushed out in front, swung round by the bars, no kick', { act: 0.52, pts: 340 }),
  barspin:    D('Barspin', 'the bars spun a full turn, hands off', { act: 0.38, pts: 220 }),
  briflip:    D('Briflip', 'bars turned, the scooter flipped back over the shoulder', { act: 0.64, pts: 400 }),
  inward:     D('Inward Bri', 'bars turned in, the scooter flipped forward over the shoulder', { act: 0.64, pts: 420 }),
  fingerwhip: D('Finger Whip', 'one hand spins the deck round', { act: 0.52, pts: 330 }),
  buttercup:  D('Buttercup', 'tailwhip, briflip, tailwhip', { act: 1.4, pts: 1000, loop: false }),
  nohander:   D('No Hander', 'both hands off, arms out wide'),
  suicide:    D('Suicide No Hander', 'both hands off, behind the back'),
  tucknh:     D('Tuck No Hander', 'knees up to the bars, hands off'),
  nofooter:   D('No Footer', 'both feet off, legs out to the sides'),
  cancan:     D('Can Can', 'one leg across the deck to the other side'),
  nacnac:     D('Nac Nac', 'one leg kicked back over the tail'),
  superman:   D('Superman', 'legs straight out behind, arms straight'),
  xup:        D('X-Up', 'bars turned half round, arms crossed'),
  toboggan:   D('Toboggan', 'one hand on the tail, nose down, bars turned'),
  tabletop:   D('Table Top', 'the scooter laid flat beside you'),
};
// the ski grab keys to scooter tricks (every scheme's keys are the ski grab ids, input.js GRAB_KEYS)
export const SCOOT_FOR = {
  mute: 'tailwhip', mute_m: 'tailwhip', safety: 'barspin', safety_m: 'inward', japan: 'nohander', japan_m: 'nohander', tail: 'superman', tail_m: 'superman',
  nose: 'cancan', nose_m: 'cancan', blunt: 'briflip', blunt_m: 'briflip', truck: 'nofooter', critical: 'xup', critical_m: 'xup', octo: 'tabletop',
  stalefish: 'nacnac', stalefish_m: 'nacnac', bowarrow: 'toboggan', seatbelt: 'kickless', seatbelt_m: 'kickless', dubtail: 'tucknh',
  daffy: 'fingerwhip', spread: 'buttercup', backscratch: 'inward', ironcross: 'suicide',
};
export const BIKE_TRICKS = {
  tailwhip:   D('Tailwhip', 'the frame whipped round the bars, feet tucked', { act: 0.56, pts: 320 }),
  barspin:    D('Barspin', 'the bars spun a full turn, hands off', { act: 0.42, pts: 240 }),
  whip:       D('Whip', 'the bike thrown sideways under you'),
  nohander:   D('No Hander', 'both hands off, arms out wide'),
  tucknh:     D('Tuck No Hander', 'knees up to the bars, hands off'),
  nofooter:   D('No Footer', 'both feet off, legs out to the sides'),
  cancan:     D('Can Can', 'one leg over the frame to the other side'),
  nacnac:     D('Nac Nac', 'one leg kicked back over the rear ski'),
  heelclick:  D('Heel Clicker', 'both legs up over the bars, heels together'),
  superman:   D('Superman', 'off the saddle, legs straight out behind'),
  xup:        D('X-Up', 'bars turned half round, arms crossed'),
  toboggan:   D('Toboggan', 'one hand on the saddle, nose down, bars turned'),
  cliffhanger: D('Cliffhanger', 'stood up on the bars, toes under them, hands up'),
  lazyboy:    D('Lazy Boy', 'lying back on the saddle, feet under the bars, arms back'),
  kissofdeath: D('Kiss of Death', 'a handstand on the bars'),
  indian:     D('Indian Air', 'legs running in the air'),
};
export const BIKE_FOR = {
  safety: 'whip', safety_m: 'nohander', mute: 'tailwhip', mute_m: 'tailwhip', japan: 'cancan', japan_m: 'cancan', tail: 'superman', tail_m: 'superman',
  nose: 'heelclick', nose_m: 'heelclick', blunt: 'barspin', blunt_m: 'barspin', truck: 'nofooter', critical: 'xup', critical_m: 'xup', octo: 'lazyboy',
  stalefish: 'nacnac', stalefish_m: 'nacnac', bowarrow: 'toboggan', seatbelt: 'cliffhanger', seatbelt_m: 'cliffhanger', dubtail: 'tucknh',
  daffy: 'indian', spread: 'nohander', backscratch: 'kissofdeath', ironcross: 'nohander',
};
for (const T of [SCOOT_TRICKS, BIKE_TRICKS]) for (const k in T) { T[k].id = k; T[k].wk = 'xw_' + k; }
const HELD_S = Object.values(SCOOT_TRICKS).filter(d => !d.act), HELD_B = Object.values(BIKE_TRICKS).filter(d => !d.act);
export const scootTrickDef = (id) => SCOOT_TRICKS[SCOOT_FOR[id] || id] || null;
export const bikeTrickDef = (id) => BIKE_TRICKS[BIKE_FOR[id] || id] || null;
RIDE_GRABS.scoot = scootTrickDef; RIDE_GRABS.bike = bikeTrickDef;
RIDE_GUIDES.scoot = id => { const d = scootTrickDef(id); return d ? d.guide : ''; };
RIDE_GUIDES.bike = id => { const d = bikeTrickDef(id); return d ? d.guide : ''; };
// the physics' timed tricks (skier.js): one object per trick, so nothing is made per step
const actOf = def => def && def.act ? (def._a || (def._a = { id: def.id, T: def.act, loop: def.loop !== false })) : null;
RIDE_ACTS.scoot = id => actOf(scootTrickDef(id));
RIDE_ACTS.bike = id => actOf(bikeTrickDef(id));
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
  _gltf[file] = loader.loadAsync('./models/' + file + '?v=17').catch(e => { _gltf[file] = null; throw e; });
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
  // (snow.js: tracks where the boards (the bike's two skis, and the foot skis) meet the snow, rig.tracks)
  const mk = hw => { const o = new THREE.Object3D(); o.userData.hw = hw; rig.root.add(o); return o; };
  sc.tr = [mk(cfg.trW[0]), mk(cfg.trW[1])];
  if (sc.feet) for (const f of sc.feet) { f.userData.hw = 0.05; sc.tr.push(f); }
  rig.tracks = sc.tr; rig.skiL = sc.tr[0]; rig.skiR = sc.tr[1];
  sc.pAct = null; sc.pU = 0;
};
Rig.loader.scoot = frameLoader(SCOOT);
Rig.loader.bike = frameLoader(BIKE);

// ---- the pose ------------------------------------------------------------------------------------------------------------
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
const _q1 = Q(), _q2 = Q(), _q3 = Q(), _qi = Q(), _sq = Q(), _lq = Q(), _wq = Q(), _qf = Q();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _v7 = V(), _lp = V(), _acc = V(), _pv = V(), _sh = V(), _wr = V(), _el = V(), _fd = V(), _pa = V(), _cF = V(), _cL = V(), _cU = V(), _ax = V();
const TAU = Math.PI * 2;
// a track point: at pt in the part's frame, turned as the part is
function mark(o, part, pt) { o.position.set(pt[0], pt[1], pt[2]).applyMatrix4(part.matrixWorld); part.getWorldQuaternion(o.quaternion); }
// the eased turn of a whip: slow off the foot, quick in the middle, slowing to be caught
const whipE = u => u - 0.55 * Math.sin(TAU * u) / TAU;
// 0 -> 1 over [a, b] then back to 0 over [c, d]
const bump = (u, a, b, c, d) => smooth01((u - a) / (b - a)) * (1 - smooth01((u - c) / (d - c)));

/* What a frame's pose is made of: the trunk (the pelvis's place and turn, the chest and head relative to it) and each
   limb's target, written by the base pose and then pulled towards each trick held by its weight (a spring, so one trick
   fades into the next), then by a timed trick going round. All world space; one object, nothing made per frame. */
const C = {
  R: null, BP: null, fw: V(), up: V(), lf: V(), s: 1,
  pel: V(), pp: 0, py: 0, pr: 0, cl: 0, ct: 0, cs: 0, hp: 0, hy: 0,
  pq: Q(), cq: Q(), hq: Q(),
  hip: [V(), V()], sh: [V(), V()], grip: [V(), V()], spot: [V(), V()], seat: V(), tail: V(), nose: V(), barMid: V(),
  foot: [V(), V()], kp: [V(), V()], ffree: [0, 0], fyaw: [0, 0], fpit: [0, 0],
  hand: [V(), V()], hoff: [0, 0], ep: [V(), V()], curl: [0, 0], hgrab: [0, 0], hgD: [V(), V()], hgP: [V(), V()],
  legLen: 0.8, armL: 0.55, u: 0, t: 0, tt: 0,
};
// helpers on C: a point in the body frame, in the pelvis frame from the pelvis, in the chest frame from a shoulder
const bpt = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.R).add(C.BP);
const bdir = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.R);
const ppt = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.pq).add(C.pel);
const pdir = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.pq);
const spt = (out, k, x, y, z) => out.set(x, y, z).applyQuaternion(C.cq).add(C.sh[k]);
const hpt = (out, k, x, y, z) => out.set(x, y, z).applyQuaternion(C.R).add(C.hip[k]);
// pull a limb target towards a point by w
const footTo = (k, p, w, free = 1) => { C.foot[k].lerp(p, w); C.ffree[k] += (free - C.ffree[k]) * w; };
const handTo = (k, p, w, off = 1) => { C.hand[k].lerp(p, w); C.hoff[k] += (off - C.hoff[k]) * w; };
const kneeTo = (k, d, w) => { C.kp[k].lerp(d, w); };
const elbowTo = (k, d, w) => { C.ep[k].lerp(d, w); };

/* The held tricks. v: the vehicle moved from under the rider, in the body frame [left, up, forward, nose up, nose left,
   lean right]; st: the bars turned (rad); trunk(w) and limbs(w) pull the targets on C towards the trick by w. */
const HELD = {
  // ---- both rides
  nohander: { v: [0, 0.06, -0.03, 0.06, 0, 0], crouch: 0.4,
    trunk(w) { C.cl -= 0.32 * w; C.hp -= 0.25 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, spt(_v1, k, s * 0.42, 0.36, 0.1), w); elbowTo(k, bdir(_v2, s * 0.3, -1, -0.2), w); C.curl[k] += (0.25 - C.curl[k]) * w; kneeTo(k, bdir(_v2, -s * 0.15, 0.25, 1), w); } } },
  suicide: { v: [0, 0.1, -0.04, 0.08, 0, 0], crouch: 0.42,
    trunk(w) { C.cl -= 0.4 * w; C.hp -= 0.3 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, ppt(_v1, s * 0.05, 0.18, -0.24), w); elbowTo(k, pdir(_v2, s * 1, -0.3, -0.6), w); C.curl[k] += (0.6 - C.curl[k]) * w; kneeTo(k, bdir(_v2, -s * 0.15, 0.25, 1), w); } } },
  tucknh: { v: [0, 0.34, -0.1, 0.18, 0, 0], crouch: 0.85,
    trunk(w) { C.cl += 0.3 * w; C.hp -= 0.12 * w; C.pel.addScaledVector(C.fw, 0.06 * w); },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, spt(_v1, k, s * 0.55, 0.02, 0.1), w); elbowTo(k, bdir(_v2, 0, -1, -0.3), w); C.curl[k] += (0.2 - C.curl[k]) * w; kneeTo(k, bdir(_v2, s * 0.08, 0.7, 1), w); } } },
  nofooter: { v: [0, 0.16, 0.05, 0, 0, 0], crouch: 0.3,
    trunk(w) { C.cl -= 0.12 * w; C.pel.addScaledVector(C.up, 0.03 * w).addScaledVector(C.fw, -0.03 * w); },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.5, -0.6, 0.14), w); kneeTo(k, bdir(_v2, s * 0.7, 0.3, 0.6), w); C.fyaw[k] += (s * 0.5 - C.fyaw[k]) * w; } } },
  cancan: { v: [0, 0.09, 0, 0, 0.12, -0.14], crouch: 0.42,
    trunk(w) { C.py += 0.32 * w; C.ct -= 0.26 * w; C.pel.addScaledVector(C.lf, 0.04 * w); },
    limbs(w) { footTo(1, ppt(_v1, 0.5, -0.3, 0.36), w); kneeTo(1, pdir(_v2, 0.4, 0.8, 0.5), w); C.fpit[1] += (-0.4 - C.fpit[1]) * w; } },
  nacnac: { v: [0, 0.08, 0, 0, 0.28, 0.2], crouch: 0.38,
    trunk(w) { C.py -= 0.7 * w; C.ct += 0.62 * w; C.hy += 0.1 * w; C.pel.addScaledVector(C.lf, -0.06 * w); },
    limbs(w) { footTo(1, hpt(_v1, 1, 0.5, 0.12, -0.62), w); kneeTo(1, bdir(_v2, 0.3, -1, 0), w); C.fpit[1] += (-0.8 - C.fpit[1]) * w; } },
  superman: { v: [0, 0.16, 0.26, -0.2, 0, 0], crouch: 0.2,
    trunk(w) {
      // the body stretched out flat behind the bars, arms straight to them
      const sup = _v1.copy(C.barMid).addScaledVector(C.fw, -(C.armL * 0.72 + 0.42)).addScaledVector(C.up, -0.16);
      C.pel.lerp(sup, w); C.pp += 1.35 * w; C.cl += (0.12 - C.cl) * w; C.hp += (-1.0 - C.hp) * w;
    },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.09, -C.legLen * 0.97, -0.02), w); kneeTo(k, pdir(_v2, 0, 0, 1), w); C.fpit[k] += (-1.0 - C.fpit[k]) * w; } } },
  xup: { v: [0, 0.07, 0.12, 0.04, 0, 0], st: Math.PI, crouch: 0.48,
    trunk(w) { C.cl -= 0.06 * w; C.hp += 0.15 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; elbowTo(k, bdir(_v2, s * 1, 0.15, -0.1), w); } } },
  toboggan: { v: [-0.06, 0.34, 0, -0.55, -0.42, 0.25], st: 1.25, crouch: 0.7, bikeV: [0, 0.06, 0.02, -0.4, -0.25, 0.18], bikeSt: 1.35,
    trunk(w) { C.cl += 0.42 * w; C.ct -= 0.45 * w; C.py -= 0.12 * w; C.hy -= 0.2 * w; if (C.bike) C.pel.addScaledVector(C.up, 0.2 * w).addScaledVector(C.fw, -0.05 * w); },
    limbs(w) {
      // the right hand on the deck's tail (the bike: the back of the saddle), palm down on it
      handTo(1, C.tail, w, 0.35); C.hgrab[1] += (1 - C.hgrab[1]) * w;
      if (!C.bike) for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.12, -0.4, 0.2), w); kneeTo(k, bdir(_v2, 0, 0.6, 1), w); }
    } },
  tabletop: { v: [0.24, 0.42, -0.04, 0.1, 0.25, -1.25], crouch: 0.75,
    trunk(w) { C.py += 0.22 * w; C.ct -= 0.12 * w; C.cl += 0.3 * w; C.pr -= 0.15 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) kneeTo(k, bdir(_v2, 0.8, 0.2, 0.6), w); } },
  // ---- the snowbike's own
  whip: { v: [0, 0.04, 0, 0, 1.2, -0.65], crouch: 0.4, keepSeat: 1,
    trunk(w) { C.ct += 0.25 * w; C.hy -= 0.15 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) elbowTo(k, bdir(_v2, (k ? -1 : 1) * 0.8, -0.6, 0), w); } },
  heelclick: { v: [0, 0.04, 0.05, 0.1, 0, 0], crouch: 0.3,
    trunk(w) { C.cl += (-0.45 - C.cl) * w; C.pp -= 0.35 * w; C.hp += 0.25 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.barMid).addScaledVector(C.up, 0.22).addScaledVector(C.fw, 0.24).addScaledVector(C.lf, s * 0.03), w); kneeTo(k, bdir(_v2, s * 0.2, 1, 0.3), w); C.fpit[k] += (0.3 - C.fpit[k]) * w; C.fyaw[k] += (-s * 0.3 - C.fyaw[k]) * w; } } },
  cliffhanger: { v: [0, -0.42, 0.06, 0.22, 0, 0], crouch: 0.1,
    trunk(w) {
      // stood up tall over the bars, toes hooked under them
      const p = _v1.copy(C.barMid).addScaledVector(C.up, C.legLen * 0.9 + 0.02).addScaledVector(C.fw, -0.12);
      C.pel.lerp(p, w); C.pp -= 0.12 * w; C.cl += (-0.15 - C.cl) * w; C.hp += (-0.2 - C.hp) * w;
    },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.barMid).addScaledVector(C.up, 0.02).addScaledVector(C.lf, s * 0.11).addScaledVector(C.fw, -0.03), w); kneeTo(k, bdir(_v2, 0, 0, 1), w); C.fpit[k] += (0.5 - C.fpit[k]) * w;
      handTo(k, spt(_v1, k, s * 0.22, 0.5, 0.05), w); elbowTo(k, bdir(_v2, s * 1, 0, -0.3), w); C.curl[k] += (0.15 - C.curl[k]) * w; } } },
  lazyboy: { v: [0, 0.06, 0.08, 0.12, 0, 0], crouch: 0.3,
    trunk(w) { C.pp -= 1.15 * w; C.cl += (-0.35 - C.cl) * w; C.hp += (0.55 - C.hp) * w; C.pel.addScaledVector(C.fw, 0.02 * w).addScaledVector(C.up, 0.02 * w); },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.barMid).addScaledVector(C.up, -0.06).addScaledVector(C.lf, s * 0.1).addScaledVector(C.fw, -0.02), w); kneeTo(k, bdir(_v2, 0, 1, 0), w); C.fpit[k] += (0.3 - C.fpit[k]) * w;
      handTo(k, spt(_v1, k, s * 0.12, 0.52, -0.06), w); elbowTo(k, bdir(_v2, s * 1, 0.2, 0), w); C.curl[k] += (0.3 - C.curl[k]) * w; } } },
  kissofdeath: { v: [0, -0.12, 0.06, -0.45, 0, 0], crouch: 0.1,
    trunk(w) {
      // pushed up into a handstand over the bars: pitched forward right over, head down by the bars, legs straight up
      const p = _v1.copy(C.barMid).addScaledVector(C.up, 0.98).addScaledVector(C.fw, -0.04);
      C.pel.lerp(p, w); C.pp += (Math.PI - 0.05) * w; C.cl += (0.05 - C.cl) * w; C.hp += (-0.5 - C.hp) * w;
    },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.07, -C.legLen * 0.98, 0.04), w); kneeTo(k, pdir(_v2, 0, 0, -1), w); C.fpit[k] += (-1.1 - C.fpit[k]) * w; elbowTo(k, pdir(_v2, s * 1, 0, 0.3), w); } } },
  indian: { v: [0, 0.08, 0, 0.05, 0, 0], crouch: 0.35,
    trunk(w) { C.pel.addScaledVector(C.up, 0.06 * w); C.cl -= 0.05 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1, ph = Math.sin(C.t * 7.5 + k * Math.PI); footTo(k, hpt(_v1, k, s * 0.13, -0.6 + 0.16 * Math.max(0, ph), 0.56 * ph), w); kneeTo(k, bdir(_v2, 0, 0.2, 1), w); C.fpit[k] += (-0.5 * ph - C.fpit[k]) * w; } } },
};
// (the snowbike's tuck no hander: off the saddle, knees up against the bars)
HELD.tucknhB = { v: [0, 0.12, -0.05, 0.1, 0, 0], crouch: 0.6,
  trunk(w) { C.pel.addScaledVector(C.up, 0.16 * w).addScaledVector(C.fw, 0.1 * w); C.cl += 0.35 * w; C.hp -= 0.15 * w; },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.seat).addScaledVector(C.lf, s * 0.12).addScaledVector(C.fw, 0.18).addScaledVector(C.up, 0.06), w); kneeTo(k, bdir(_v2, s * 0.05, 0.8, 1), w);
    handTo(k, spt(_v1, k, s * 0.55, 0.02, 0.1), w); elbowTo(k, bdir(_v2, 0, -1, -0.3), w); C.curl[k] += (0.2 - C.curl[k]) * w; } } };
// the snowbike's superman: off the saddle, body flat behind the bars over the rear ski
HELD.supermanB = Object.assign({}, HELD.superman, { v: [0, 0.04, 0.12, 0.1, 0, 0] });
const heldOf = (def, bike) => !def || def.act ? null : bike && HELD[def.id + 'B'] ? HELD[def.id + 'B'] : HELD[def.id];

/* The timed tricks: what the vehicle's parts do at u (0 -> 1 through the round), and the rider with it. part(u) sets
   C.whipA (the deck round the bars' axis), C.barA (the bars round), C.flip (the whole vehicle round the grips' line),
   C.v* (the vehicle moved); body(u) pulls the targets. */
const ACT = {
  tailwhip: {
    part(u) { C.whipA += TAU * whipE(u); C.vy += 0.1 * Math.sin(Math.PI * u); },
    trunk(u) { const e = bump(u, 0, 0.12, 0.8, 0.97); C.hp += 0.38 * e; C.cl += 0.22 * e; if (C.bike) C.pel.addScaledVector(C.up, 0.16 * e); },
    limbs(u) { feetUp(bump(u, 0, 0.12, 0.8, 0.97), -0.34, -0.16); },
  },
  kickless: {
    // the deck pushed out in front the other way round, and the bars swung in a circle so the arms carry it round
    part(u) { C.whipA -= TAU * smooth01(u); const e = Math.sin(Math.PI * u); C.circ = 0.26 * e; C.circA = -TAU * u; C.vy += 0.12 * e; },
    trunk(u) { const e = bump(u, 0, 0.1, 0.84, 0.98); C.hp += 0.55 * e; C.cl -= 0.18 * e; },
    limbs(u) { const e = bump(u, 0, 0.1, 0.84, 0.98); feetUp(e, -0.16, 0.22); for (let k = 0; k < 2; k++) elbowTo(k, bdir(_v2, (k ? -1 : 1), 0.1, 0), 0.6 * e); },
  },
  barspin: {
    part(u) { C.barA += TAU * whipE(u); C.vy += 0.05 * Math.sin(Math.PI * u); },
    trunk(u) { C.hp += 0.4 * bump(u, 0.02, 0.1, 0.86, 0.97); },
    limbs(u) {
      const e = bump(u, 0.02, 0.1, 0.86, 0.97);
      for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, _v1.copy(C.grip[k]).addScaledVector(C.up, 0.17).addScaledVector(C.lf, s * 0.2).addScaledVector(C.fw, -0.06), e); C.curl[k] += (0.15 - C.curl[k]) * e; elbowTo(k, bdir(_v2, s * 1, -0.3, -0.3), e); }
    },
  },
  briflip: { part(u) { briPart(u, 1); }, trunk(u) { briTrunk(u, 1); }, limbs(u) { briLimbs(u, 1); } },
  inward: { part(u) { briPart(u, -1); }, trunk(u) { briTrunk(u, -1); }, limbs(u) { briLimbs(u, -1); } },
  fingerwhip: {
    part(u) { const e = bump(u, 0, 0.15, 0.8, 1); C.whipA += TAU * smooth01(u * 1.08); C.vy += 0.46 * e; C.vz -= 0.06 * e; },
    trunk(u) { const e = bump(u, 0, 0.14, 0.8, 0.97); C.cl += 0.7 * e; C.ct -= 0.25 * e; C.hp += 0.45 * e; },
    limbs(u) {
      feetUp(bump(u, 0, 0.14, 0.8, 0.97), -0.22, -0.02);
      // the right hand down on the deck's tail, going round with it, then let go and back to the bars
      const h = bump(u, 0.02, 0.12, 0.45, 0.82);
      handTo(1, C.nose, h, 0.4); C.hgrab[1] += (1 - C.hgrab[1]) * h; elbowTo(1, bdir(_v2, -1, 0.3, -0.2), h);
    },
  },
  // a tailwhip, a briflip and a tailwhip, one after the other
  buttercup: {
    part(u) { if (u < 0.27) ACT.tailwhip.part(u / 0.27); else if (u < 0.73) briPart((u - 0.27) / 0.46, 1); else ACT.tailwhip.part((u - 0.73) / 0.27); },
    trunk(u) { C.hp += 0.3 * bump(u, 0, 0.06, 0.92, 0.99); if (u >= 0.27 && u < 0.73) briTrunk((u - 0.27) / 0.46, 1); },
    limbs(u) { feetUp(bump(u, 0, 0.06, 0.92, 0.99), -0.34, 0.02); if (u >= 0.27 && u < 0.73) briLimbs((u - 0.27) / 0.46, 1, true); },
  },
};
// both feet off the deck and tucked up under the rider (e how much; up: how far under the hips; fwd)
function feetUp(e, up, fwd) {
  if (e < 0.001) return;
  for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.16, up, fwd), e); kneeTo(k, bdir(_v2, s * 0.1, 0.5, 1), e); C.fpit[k] += (-0.5 - C.fpit[k]) * e; }
}
/* a briflip: the scooter pushed out to the rider's right and turned a quarter (the deck pointing out to the right, the
   bars still across), flipped a whole turn round the line through the grips (dir 1: the deck forwards and up first, a
   backflip of the scooter; -1: backwards and up first, the inward), then straightened back under the feet */
function briPart(u, dir) {
  const e = Math.min(smooth01(u / 0.16), smooth01((1 - u) / 0.16));
  C.vx -= 0.38 * e; C.vy += 0.1 * e; C.byaw += Math.PI / 2 * e; C.steerX -= Math.PI / 2 * e;
  C.flip -= dir * TAU * smooth01((u - 0.1) / 0.78);
}
function briTrunk(u, dir) {
  const e = bump(u, 0, 0.12, 0.86, 0.98);
  C.pel.addScaledVector(C.lf, 0.07 * e);
  C.ct -= 0.3 * e; C.hy -= (dir > 0 ? 0.4 : 0.65) * e; C.hp += (dir > 0 ? -0.05 : 0.1) * e; C.cl += (dir > 0 ? 0.25 : -0.05) * e;
}
function briLimbs(u, dir, inner) {
  const e = bump(u, 0, 0.12, 0.86, 0.98);
  if (!inner) feetUp(e, -0.32, dir > 0 ? 0.08 : 0.16);
  for (let k = 0; k < 2; k++) elbowTo(k, bdir(_v2, (k ? -1 : 1) * 0.5, -1, -0.3), 0.7 * e);
}

Rig.poser.scoot = Rig.poser.bike = (rig, S0, dt) => {
  const sc = rig.sc; if (!sc) return;
  const S = liftStand(S0);
  const cfg = sc.cfg, seat = cfg.seat, bike = cfg.feet === 'skis', TR = bike ? BIKE_TRICKS : SCOOT_TRICKS, trDef = bike ? bikeTrickDef : scootTrickDef;
  const P = rig.p, sp = springBank(P, dt), b = rig.b;
  const st = S.state || 'ground', air = st === 'air', crash = st === 'crash', ground = st === 'ground', lift = st === 'lift';
  const t = S.t !== undefined ? S.t : (rig._t = (rig._t || 0) + dt);
  const vel = S.vel || ZERO, speed = S.speed !== undefined ? S.speed : vel.length();
  const R = rig.placeBody(S), BP = rig.body.position, qi = _qi.copy(R).invert();
  // on the chairlift: sat on the chair, the scooter or bike held hanging in front
  if (lift) {
    seatRider(rig, S, t); sc.steer.position.copy(sc.steerPos); sc.steer.quaternion.copy(sc.steerQ); sc.deck.position.set(0, 0, 0); sc.deck.quaternion.identity();
    holdOnLift(rig, sc.root, cfg.half || 0.5);
    if (sc.feet) for (let k = 0; k < 2; k++) { const ft = k ? rig.b.ftR : rig.b.ftL, fs = sc.feet[k]; ft.matrixWorld.decompose(_v1, _q2, _v5); fs.quaternion.copy(_q2).multiply(_q3.copy(rig.rest[k ? 'ftR' : 'ftL'].q).invert()); fs.position.copy(_v1).addScaledVector(_v5.set(0, 1, 0).applyQuaternion(fs.quaternion), -(rig.ankleH + 0.035)); }
    rig._pst = st; sc.pAct = null; return;
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
  // ---- the timed trick going round (from the physics, or a network rider's), finished off quickly if the state
  // stopped telling it before it was round (a landing at the very end of one)
  const ad = S.act ? TR[S.act] : null;
  if (ad && ad.act) { sc.pAct = ad; sc.pU = clamp((S.actT || 0) / ad.act, 0, 1); }
  else if (sc.pAct) { sc.pU += dt / (sc.pAct.act * 0.5); if (sc.pU >= 1 || crash) sc.pAct = null; }
  const A = sc.pAct, u = A ? Math.min(1, sc.pU) : 0, actOn = A ? 1 : 0;
  // ---- the held trick, and how much of each (springs, so one fades into the next); none while a part goes round
  const gid = air ? (S.grab || S.pose || null) : null, td = gid ? trDef(gid) : null;
  const prep = air ? 1 - smoothstep(0.09, 0.36, rig.timeToGround(S.p, vel)) : 0;
  const want = td && !td.act && prep < 0.6 && !actOn ? td : null;
  let crouchT = 0, sumW = 0;
  const ws = rig._ws || (rig._ws = []); ws.length = 0;
  const HL = bike ? HELD_B : HELD_S;
  for (let i = 0; i < HL.length; i++) {
    const d = HL[i];
    const w = sp(d.wk, d === want ? 1 : 0, d === want ? 11 : 9);
    if (w > 0.002) { const h = heldOf(d, bike); if (h) { ws.push(h, w); crouchT += (h.crouch ?? 0.45) * w; sumW += w; } }
  }
  // ---- the vehicle, in the body's frame: leaning with the turn, the bars turned with it; in the air brought up under
  // the rider, tipped back a little at the pop; moved and turned by the trick held and by a part going round
  const crouchA = air ? (actOn ? 0.5 : 0.36 + 0.25 * popK) * (1 - Math.min(1, sumW)) + crouchT : 0;
  const crouch = sp('scrouch', clamp(air ? crouchA : (S.crouch ?? 0.3) + 0.05 + absorb * 0.7, 0, 1), 18);
  C.vx = 0; C.vy = -(S.sink || 0); C.vz = 0; C.vpit = 0; C.vyaw = 0; C.vroll = 0; C.byaw = 0; C.steerX = 0; C.whipA = 0; C.barA = 0; C.flip = 0; C.circ = 0; C.circA = 0;
  const lift_ = sp('slift', air ? 0.03 + 0.05 * crouch : 0, 12, air ? 0.8 : 1);
  C.vy += lift_; C.vroll += phi * 0.9;
  C.vpit += 0.25 * popK - 0.06 * Math.sin(tt * 1.1) * airW;
  for (let i = 0; i < ws.length; i += 2) {
    const h = ws[i], w = ws[i + 1], v = bike && h.bikeV ? h.bikeV : h.v;
    if (v) { C.vx += v[0] * w; C.vy += v[1] * w; C.vz += v[2] * w; C.vpit += v[3] * w; C.vyaw += v[4] * w; C.vroll += v[5] * w; }
    const stw = bike && h.bikeSt !== undefined ? h.bikeSt : h.st; if (stw) C.steerX += stw * w;
  }
  // (a trick that drops the vehicle under the rider, a cliffhanger's, only as far as the snow under it allows)
  if (C.vy < 0) C.vy *= air ? smoothstep(0.15, 1.1, S.p.y - height(S.p.x, S.p.z)) : 1;
  // a shifty: the vehicle turned across under the body (Shift or A / D in the air, skier.shift)
  const shift = S.shift || 0;
  C.vyaw -= 0.85 * shift;
  if (A) ACT[A.id].part(u);
  if (crashW > 0.01) { C.vy += 0.15 * crashW; C.vyaw += 0.6 * crashW * Math.sin(t * 2.1); }
  const root = sc.root;
  // (the saddle where it is before a whip turns the bike away under the rider, who stays sat facing the way they go)
  _lq.setFromAxisAngle(Y, C.vyaw).multiply(_q1.setFromAxisAngle(X, -C.vpit)).multiply(_q1.setFromAxisAngle(Z, C.vroll));
  if (C.circ > 0.001) _lq.premultiply(_q1.setFromAxisAngle(_ax.set(Math.cos(C.circA), 0, Math.sin(C.circA)), C.circ));
  _lp.set(C.vx, C.vy, C.vz);
  root.position.copy(_lp).applyQuaternion(R).add(BP); root.quaternion.copy(R).multiply(_lq);
  // (a briflip's quarter turn is about the stem, so the bars stay in front of the rider and the deck swings out)
  if (C.byaw) {
    const piv = _v3.copy(sc.steerPos).applyQuaternion(root.quaternion).add(root.position);
    _qf.setFromAxisAngle(_ax.set(0, 1, 0).applyQuaternion(root.quaternion), C.byaw);
    root.position.sub(piv).applyQuaternion(_qf).add(piv); root.quaternion.premultiply(_qf);
  }
  // the steering: the bars turned with the turn on the snow, a trick's turn and a bar spin's in the air
  // (as much as the turn needs at this speed, the boards' length apart: a few degrees fast, more slow)
  const steerT = ground ? clamp(Math.atan(cfg.half * 1.3 * Wy / Math.max(speed, 1.5)) * 1.4, -0.5, 0.5) : 0;
  const steerA = sp('ssteer', steerT, 10) + C.barA + C.steerX;
  sc.steer.position.copy(sc.steerPos); sc.steer.quaternion.copy(sc.steerQ).multiply(_q1.setFromAxisAngle(Y, steerA));
  // the deck (the frame) round the steering axis in a whip, the bars held still
  sc.deck.position.set(0, 0, 0); sc.deck.quaternion.identity();
  if (C.whipA) { _q2.setFromAxisAngle(sc.axis, C.whipA); sc.deck.position.copy(sc.steerPos).negate().applyQuaternion(_q2).add(sc.steerPos); sc.deck.quaternion.copy(_q2); }
  root.updateMatrixWorld(true);
  // a briflip: the whole of it turned round the line through the grips
  if (C.flip) {
    _v1.set(cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(sc.steer.matrixWorld); _v2.set(-cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(sc.steer.matrixWorld);
    const piv = _v3.addVectors(_v1, _v2).multiplyScalar(0.5);
    _qf.setFromAxisAngle(_ax.set(1, 0, 0).applyQuaternion(R), C.flip);
    root.position.sub(piv).applyQuaternion(_qf).add(piv); root.quaternion.premultiply(_qf);
    root.updateMatrixWorld(true);
  }
  // where the boards meet the snow, for the tracks
  if (sc.tr) { mark(sc.tr[0], sc.deck, cfg.trR); mark(sc.tr[1], sc.steer, cfg.trF); }
  // ---- the points the rider uses: the feet's spots on the deck, the grips, the saddle, the tail
  const deckW = sc.deck.matrixWorld, steerW = sc.steer.matrixWorld;
  C.R = R; C.BP = BP; C.t = t; C.tt = tt; C.bike = bike; C.legLen = rig.legLen; C.armL = rig.len.ua + rig.len.fa;
  const fw = C.fw.set(0, 0, 1).applyQuaternion(R), ub = C.up.set(0, 1, 0).applyQuaternion(R), lf = C.lf.set(1, 0, 0).applyQuaternion(R);
  C.grip[0].set(cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(steerW); C.grip[1].set(-cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(steerW);
  C.barMid.addVectors(C.grip[0], C.grip[1]).multiplyScalar(0.5);
  if (!bike) {
    C.spot[0].set(cfg.footF[0], cfg.deckTop + 0.03 + rig.ankleH, cfg.footF[1] - 0.05).applyMatrix4(deckW);
    C.spot[1].set(cfg.footB[0], cfg.deckTop + 0.03 + rig.ankleH, cfg.footB[1] - 0.04).applyMatrix4(deckW);
    C.tail.set(cfg.tail[0], cfg.tail[1] + 0.04, cfg.tail[2]).applyMatrix4(deckW);
    C.nose.set(-0.1, cfg.deckTop + 0.07, 0.16).applyMatrix4(deckW);
  } else {
    // the snowbike: the feet on their foot skis on the snow beside the frame; in the air low beside the frame
    const pegK = sp('speg', air ? 1 : 0, air ? 9 : 14);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1;
      _v5.set(s * cfg.snowFoot[0], 0.03 + rig.ankleH - (S.sink || 0), cfg.snowFoot[1] - 0.05).applyQuaternion(R).add(BP);
      _v6.set(s * cfg.peg[0], cfg.peg[1] + 0.03 + rig.ankleH, cfg.peg[2]).applyMatrix4(deckW);
      C.spot[k].lerpVectors(_v5, _v6, pegK);
    }
    // (the saddle from the bike as a whole, not the frame part: in a tailwhip the frame goes round, the rider does not)
    C.seat.set(0, seat.y, seat.z).applyMatrix4(root.matrixWorld);
    C.tail.set(0, seat.y + 0.06, seat.z + 0.1).applyMatrix4(deckW);
  }
  // ---- the trunk: over the deck, crouched to the bars (the scooter); on the saddle (the bike)
  const A0 = rig.ankleH + (cfg.deckTop || 0) + 0.03;
  if (!bike) {
    const H = A0 + lift_ + rig.legLen * 0.97 * (0.95 - 0.45 * crouch) + (rig.pelvisY - rig.hipY);
    bpt(C.pel, -Math.sin(phi) * 0.5 + 0.015 * wob(tt * 1.7, 4.4) * (1 - airW), H, -0.06 - 0.1 * crouch);
  } else {
    // (in a whip the rider stays where the saddle was before the bike went round under them)
    let keep = 0; for (let i = 0; i < ws.length; i += 2) keep += (ws[i].keepSeat || 0) * ws[i + 1];
    if (keep > 0.001) { _lq.setFromAxisAngle(Z, phi * 0.9); _v5.set(0, seat.y, seat.z).applyQuaternion(_lq).add(_v6.set(0, lift_, 0)).applyQuaternion(R).add(BP); C.seat.lerp(_v5, Math.min(1, keep)); }
    C.pel.copy(C.seat).addScaledVector(ub, 0.09 + (rig.pelvisY - rig.hipY)).addScaledVector(fw, -0.04);
  }
  const lean = sp('slean', (air ? 0.3 : 0.3 + 0.2 * crouch) - 0.3 * absorb + 0.15 * popK, air ? 12 : 9, air ? 0.8 : 1);
  const twist = sp('stw', clamp(-Wy * 0.04, -0.2, 0.2) + 0.05 * wob(tt * 0.9, 3.7) * (1 - airW), 9);
  C.pp = 0; C.py = twist * 0.4 - 0.3 * shift; C.pr = -phi * 0.6; C.cl = lean; C.ct = twist * 0.6 + 0.55 * shift; C.cs = phi * 0.35; C.hp = 0; C.hy = clamp(-twist + Wy * 0.06, -1, 1) - 0.25 * shift;
  for (let i = 0; i < ws.length; i += 2) if (ws[i].trunk) ws[i].trunk(ws[i + 1]);
  if (A) ACT[A.id].trunk(u);
  if (crashW > 0.01) C.cl += Math.sin(t * 3.1) * 0.5 * crashW;
  const pelQ = C.pq.copy(R).multiply(_q1.setFromAxisAngle(Y, C.py)).multiply(_q1.setFromAxisAngle(X, C.pp)).multiply(_q1.setFromAxisAngle(Z, C.pr));
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v5.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v6.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v6.copy(C.pel).sub(off));
  return finishPose(rig, S, dt, sp, A, u, ws, crashW, air, ground, bike, steerW, deckW, A0);
};

// the rest of a frame's pose, once the vehicle and the pelvis are placed: chest, head, legs, arms
function finishPose(rig, S, dt, sp, A, u, ws, crashW, air, ground, bike, steerW, deckW, A0) {
  const b = rig.b, R = C.R, sc = rig.sc, t = C.t, tt = C.tt;
  const fw = C.fw, ub = C.up, lf = C.lf;
  const pelQ = C.pq;
  const chQ = C.cq.copy(pelQ).multiply(_q1.setFromAxisAngle(Y, C.ct)).multiply(_q1.setFromAxisAngle(X, C.cl)).multiply(_q1.setFromAxisAngle(Z, C.cs));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  // the head: forward, a little over the bars, looking where it goes; the chest's lean taken back off it
  const hdQ = C.hq.copy(chQ).multiply(_q1.setFromAxisAngle(Y, C.hy)).multiply(_q1.setFromAxisAngle(X, 0.15 - (C.cl + C.pp) * 0.75 + C.hp));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  b.uaL.updateWorldMatrix(false, false); b.uaR.updateWorldMatrix(false, false);
  C.sh[0].setFromMatrixPosition(b.uaL.matrixWorld); C.sh[1].setFromMatrixPosition(b.uaR.matrixWorld);
  b.thL.updateWorldMatrix(false, false); b.thR.updateWorldMatrix(false, false);
  C.hip[0].setFromMatrixPosition(b.thL.matrixWorld); C.hip[1].setFromMatrixPosition(b.thR.matrixWorld);
  // ---- the limbs: the base pose (feet on their spots, hands on the grips), then the trick held, then a timed one
  for (let k = 0; k < 2; k++) {
    C.foot[k].copy(C.spot[k]); C.ffree[k] = 0; C.fyaw[k] = 0; C.fpit[k] = 0;
    C.kp[k].copy(fw).addScaledVector(lf, (k ? -1 : 1) * 0.15).addScaledVector(ub, 0.2);
    C.hand[k].copy(C.grip[k]).addScaledVector(ub, 0.02); C.hoff[k] = 0; C.hgrab[k] = 0; C.curl[k] = 1.3;
    C.ep[k].set(0, 0, 0);
  }
  for (let i = 0; i < ws.length; i += 2) if (ws[i].limbs) ws[i].limbs(ws[i + 1]);
  if (A) ACT[A.id].limbs(u);
  // ---- legs: knees forward over the feet
  for (let k = 0; k < 2; k++) {
    const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    const hip = C.hip[k], an = C.foot[k];
    const d = an.distanceTo(hip), m = softReach(d, rig.legLen, 0.88, 0.975); if (m < d) an.sub(hip).multiplyScalar(m / d).add(hip);
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', an, C.kp[k].normalize(), Z);
    // on the deck: the front foot points forward, the back one turned out across it (as riders stand); off it, along
    // the body, pointed as the trick asks
    const yaw = (bike ? 0 : k ? -0.55 : -0.1) * (1 - C.ffree[k]) + C.fyaw[k];
    _q3.copy(bike ? sc.root.quaternion : sc.deck.getWorldQuaternion(_wq)).slerp(_q2.copy(C.pq), C.ffree[k]).multiply(_q1.setFromAxisAngle(Y, yaw)).multiply(_q2.setFromAxisAngle(X, C.fpit[k]));
    rig.setWorldQ(ft, _q3.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
    // a foot ski under the boot (the snowbike)
    if (sc.feet) {
      const fs = sc.feet[k]; ft.updateWorldMatrix(false, false); ft.matrixWorld.decompose(_v1, _q2, _v5);
      fs.quaternion.copy(_q2).multiply(_q3.copy(rig.rest[k ? 'ftR' : 'ftL'].q).invert());
      fs.position.copy(_v1).addScaledVector(_v5.set(0, 1, 0).applyQuaternion(fs.quaternion), -(rig.ankleH + 0.035)).addScaledVector(_v6.set(0, 0, 1).applyQuaternion(fs.quaternion), 0.04);
    }
  }
  // ---- arms: to the grips (fingers round them, palms down), or where the trick puts them
  const chQ2 = C.cq, cF = _cF.set(0, 0, 1).applyQuaternion(chQ2), cL = _cL.set(1, 0, 0).applyQuaternion(chQ2), cU = _cU.set(0, 1, 0).applyQuaternion(chQ2);
  const armL = C.armL, barX = _v6.set(1, 0, 0).applyQuaternion(sc.steer.getWorldQuaternion(_sq));
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    const sh = C.sh[k], off1 = C.hoff[k];
    const wr = _wr.copy(C.hand[k]);
    if (crashW > 0.5) wr.copy(sh).addScaledVector(cL, s * 0.35).addScaledVector(ub, 0.2 + Math.sin(t * 9 + s) * 0.2);
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.8, 0.97); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const el = _el.copy(cL).multiplyScalar(s * 0.8).addScaledVector(ub, -0.6).addScaledVector(cF, -0.3);
    if (C.ep[k].lengthSq() > 1e-6) el.lerp(_v5.copy(C.ep[k]).normalize(), Math.min(1, C.ep[k].length()));
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el.normalize(), NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    // on the grip: fingers wrapped forward over the bar, palm down; free: relaxed; on a deck or saddle: palm down on it
    const fd = _fd.copy(cF).addScaledVector(ub, -0.3).normalize().lerp(_v5.copy(barX).multiplyScalar(-s).lerp(cF, 0.5).normalize(), 1 - off1).normalize();
    const pa = _pa.copy(ub).negate().lerp(_v5.copy(cL).multiplyScalar(-s), off1).normalize();
    if (C.hgrab[k] > 0.01) { fd.lerp(_v5.copy(fw).negate(), C.hgrab[k]).normalize(); pa.lerp(_v7.copy(ub).negate(), C.hgrab[k]).normalize(); }
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
    rig.curl(HH, C.curl[k]);
  }
  rig.placeHead(C.hq);
  rig.flushTree(rig.body);
}
