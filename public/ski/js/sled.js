// The sled: a wooden sledge ("Sled" by Poly by Google, CC BY 3.0, models/sled/sled.glb; see CREDITS.md) ridden lying
// on your stomach like a bodyboard, head first, hands on the front of it, legs trailing off the back. Registered with
// the rig like the board (Rig.loader.sled, Rig.poser.sled). Steering leans the body and the sled and drags the inside
// foot; tricks of our own are held like grabs (SLED_TRICKS / SLED_FOR): Superman, No Hander, One Hander, Scorpion,
// Spread Eagle, Table Top, Kneel Up, Tuck, Heel Click, and (X, 2026-11-05) Surfer (stood up on it side on, arms out),
// Handstand (on the front of it, legs straight up) and Lazy Boy (rolled onto your back on it, feet over the front, hands
// behind the head); the spin, flip and roll keys spin, flip and roll it all. On the snow the butter key with a turn key
// spins it flat, a bodyboarder's spinner (skier.js KIND.sled.flatSpin), and in a spin, on the snow or in the air, the
// body reacts to it: the legs flung out wide and trailing the turn, the head spotting into it, the hands gripping tight.
//   Frames: the physics' body frame (skier.q) is the sled's: +Z forward (the curled runners), +Y up, +X left. The
//   body lies along +Z face down: the rider's rest frame turned forward a quarter round about X.
/* (2026-11-06, for Leon's "make a tail wip and healwip sort of spin trick for hte sled") two timed tricks, as the
   scooter's (skier.js RIDE_ACTS: a key starts one, it goes round once a press and again while held, landing with the
   sled part way round is a crash, near either end sketchy):
     Tailwhip   pushed up off the front, the legs swung the other way and then swept across, the feet kicking the tail
                so the sled goes a whole turn round under the rider about its up; the rider hovers over it, knees
                tucked up to clear it, head following its nose, and catches the front as it comes back
     Heelwhip   the same the other way round, hooked round by the heels: the knees bent, the back arched, the arms out
                like wings, the heels sweeping the tail across
   And for "make it so that the wips/barspins/other tricks similar are not like roboticy and are more jibbery with the
   whole body moving in response to like the direction of movement to throw the object around more exaggerated": the
   body is moved through springs that swing past and settle (rig.p, motion.js): a wind-up the other way, the hips and
   then the shoulders driving the throw, the legs whipping after the hips, the head following the sled, a catch that
   gives and a follow-through. The spinner, the shifty and the held tricks go the same way (the legs trail and swing
   past, flung arms and legs overshoot a little going out). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Rig, springBank, smooth01, softReach, wob, wrapPi } from './rig.js?v=18';
import { RIDE_GRABS, RIDE_GUIDES, seatRider, holdOnLift } from './board.js?v=18';
import { clamp, smoothstep } from './noise.js?v=18';
import { RIDE_SPIN } from './tricks.js?v=18';
import { rideSpin } from './scoot.js?v=18';
import { RIDE_ACTS } from './skier.js?v=18';

// the slats' top (m over the snow), where the hands hold (each side, up, forward), where the hips lie
export const SLED = { top: 0.213, hand: [0.2, 0.24, 0.22], hips: -0.32 };
// first person (2026-11-06): how far back on the slats the body lies (m), and the hands' hold on the front curls (the
// curls' tops are at about x 0.22, y 0.30, z 0.51 in the sled's frame)
const SLED_FP = { back: 0.34, curl: [0.215, 0.27, 0.46] };
Rig.SLED_FP = SLED_FP;
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
  surfer:   { name: 'Surfer', hands: 'none', legs: 'surf', table: 0 },
  handstand: { name: 'Handstand', hands: 'both', legs: 'hand', table: 0 },
  lazyboy:  { name: 'Lazy Boy', hands: 'head', legs: 'lazy', table: 0 },
  // (2026-11-06) timed: act seconds a round, pts points a round (tricks.js), whip which way the sled goes round (+1
  // its nose to the rider's left), heel kicked round by the heels
  tailwhip: { name: 'Tailwhip', act: 0.62, pts: 300, whip: 1, heel: false },
  heelwhip: { name: 'Heelwhip', act: 0.66, pts: 340, whip: -1, heel: true },
};
for (const k in SLED_TRICKS) { SLED_TRICKS[k].noTweak = true; SLED_TRICKS[k].id = k; }
// what each one is, for the key list
const SLED_GUIDE = { superman: 'flown off the back, holding the front', nohander: 'both hands off, arms out', onehander: 'one hand off',
  scorpion: 'knees bent, feet over to the head', spread: 'arms and legs out wide', tabletop: 'the sled laid on its side', kneel: 'kneeling up on it',
  tuck: 'balled up on it, knees to the chest', click: 'heels clicked together up behind', surfer: 'stood up on it side on, arms out',
  handstand: 'a handstand on the front of it', lazyboy: 'rolled onto your back, feet over the front',
  tailwhip: 'the sled kicked a whole turn round under you, hold for a double', heelwhip: 'hooked round the other way by the heels, hold for a double' };
// (2026-11-06: the whips on keys that were a second key for another trick: dubtail was a second Tuck, daffy a second
// Heel Click)
export const SLED_FOR = {
  safety: 'superman', safety_m: 'superman', mute: 'nohander', mute_m: 'nohander', japan: 'onehander', japan_m: 'onehander', tail: 'scorpion', tail_m: 'scorpion',
  nose: 'kneel', nose_m: 'kneel', truck: 'spread', critical: 'tabletop', critical_m: 'tabletop', octo: 'tuck', blunt: 'surfer', blunt_m: 'surfer',
  stalefish: 'click', stalefish_m: 'click', bowarrow: 'handstand', dubtail: 'tailwhip', seatbelt: 'lazyboy', seatbelt_m: 'lazyboy',
  daffy: 'heelwhip', spread: 'spread', backscratch: 'handstand', ironcross: 'surfer',
};
export const sledTrickDef = (id) => SLED_TRICKS[SLED_FOR[id] || id] || null;
RIDE_GRABS.sled = sledTrickDef;
RIDE_GUIDES.sled = id => SLED_GUIDE[SLED_FOR[id] || id] || '';
RIDE_SPIN.sled = rideSpin;
// the physics' timed tricks (skier.js): one object per trick, so nothing is made per step
RIDE_ACTS.sled = id => { const d = sledTrickDef(id); return d && d.act ? (d._a || (d._a = { id: d.id, T: d.act, loop: true })) : null; };

let _gltf = null;
Rig.loader.sled = async (rig) => {
  if (!_gltf) {
    const loader = new GLTFLoader(), draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
    _gltf = loader.loadAsync('./models/sled/sled.glb?v=18').catch(e => { _gltf = null; throw e; });
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
  // (2026-11-06) a whip going round: the trick, how far round (0..1), following one (a double), how it was cut short,
  // the sled's turn (rad), which style it was last (1 heel)
  sl.pAct = null; sl.pU = 0; sl.pN = 0; sl.cIn = 0; sl.cut = 0; sl.next = false; sl.eR = 0; sl.outV = 0; sl.psi = 0; sl.heelK = 0;
};

/* (2026-11-06) a whip at u (0..1 through its round): the sled's turn about its up (psi, rad), how far it drops away and
   slides out, its pitch and roll, and the body's targets (each put through a spring by the poser, so they lag, swing
   past and settle). d: which way it goes round; heel: the heelwhip's style; cIn: this round follows one (a double: no
   wind-up, the body stays up), cOut: another follows it (no catch). */
const TAU = Math.PI * 2;
const bump = (u, a, b, c, d) => smooth01((u - a) / (b - a)) * (1 - smooth01((u - c) / (d - c)));
const WT = { psi: 0, drop: 0, side: 0, pitch: 0, roll: 0, lift: 0, py: 0, ch: 0, raise: 0, tw: 0, legY: 0, legD: 0, frog: 0, scorp: 0, off: 0, arm: 0, hy: 0, hp: 0, abs: 0, hx: 0, sx: 0 };
// how far round the sled is: held back a moment at the wind-up, quickest in the middle, slowing into the catch. The
// two halves are mapped apart (through s = 0.5 at u = 0.5), so cIn changes only the first and cOut only the second;
// chained, it keeps its speed through the join of a double
function whipTurn(u, cIn, cOut) {
  let s;
  if (u < 0.5) { const s0 = 0.16 * (1 - cIn); s = u <= s0 ? 0 : 0.5 * (u - s0) / (0.5 - s0); }
  else { const s1 = 0.88 + 0.12 * cOut; s = u >= s1 ? 1 : 0.5 + 0.5 * (u - 0.5) / (s1 - 0.5); }
  const a = 0.72 * (1 - 0.62 * (s < 0.5 ? cIn : cOut));
  return s - a * Math.sin(TAU * s) / TAU;
}
// (a part of the trick held on through the join of a double: from the start of a round that follows one, to the end of
// one that another follows)
const fillK = (k, u, cIn, cOut) => u < 0.5 ? k + (1 - k) * cIn : k + (1 - k) * cOut;
function whipTargets(u, E, d, heel, cIn, cOut, o) {
  // the phases: wound the other way, the kick, up off the sled while it goes round, the catch absorbed (the body's a
  // little ahead of the sled's: its springs lag). A round of a chain has no wind-up and a smaller kick, the legs giving
  // it another flick as it comes past, the body staying up
  const windS = (1 - cIn) * bump(u, 0, 0.12, 0.16, 0.3);
  const wind = (1 - cIn) * bump(u, 0, 0.08, 0.12, 0.24);
  const kick = bump(u, 0.12, 0.22, 0.28, 0.42) * (1 - 0.45 * cIn);
  const hov = fillK(bump(u, 0.1, 0.3, 0.66, 0.86), u, cIn, cOut);
  const off = fillK(bump(u, 0.15, 0.24, 0.7, 0.86), u, cIn, cOut);
  const land = (1 - cOut) * bump(u, 0.76, 0.88, 0.93, 1.0);
  // (up off it early enough that the springs have the body clear before the sled is far round under it)
  const up = fillK(bump(u, 0.04, 0.22, 0.68, 0.88), u, cIn, cOut), tuckIn = bump(u, 0.12, 0.2, 0.24, 0.34) * (1 - 0.6 * cIn);
  // the hands' push as they let go of the front, sending it round
  const push = bump(u, 0.12, 0.2, 0.24, 0.38) * (1 - 0.6 * cIn);
  o.psi = d * (TAU * E - 0.36 * windS);
  o.drop = 0.085 * fillK(bump(u, 0.1, 0.26, 0.68, 0.9), u, cIn, cOut);
  o.side = -d * 0.09 * bump(u, 0.18, 0.32, 0.5, 0.85) * (1 - 0.5 * cIn);
  o.pitch = (heel ? 0.12 : 0.2) * bump(u, 0.16, 0.24, 0.3, 0.46) * (1 - 0.5 * cIn);
  o.roll = d * 0.13 * Math.sin(Math.PI * E) * hov + 0.04 * Math.sin(TAU * 2 * E) * hov;
  o.abs = land; o.off = off; o.arm = hov;
  // the hands flung the way they push the front (its nose goes to the rider's left for d = 1), the weight thrown against
  // the legs' swing (the body goes the other way to the legs, as it does in the air)
  o.hx = d * 0.2 * push;
  o.sx = d * (-0.05 * wind + 0.08 * kick);
  if (!heel) {
    // pushed up on the hands, the hips swinging the legs out the other way with the shoulders wound against them, then
    // the hips throw the legs across low to kick the tail while the shoulders turn back against the throw; up over it on
    // all fours with the knees tucked under, looking down at it as its nose goes round; down onto it and given
    o.lift = 0.19 * up + 0.04 * wind - 0.03 * kick - 0.025 * land;
    o.py = d * (-0.42 * wind + 0.62 * kick + 0.1 * hov);
    o.ch = d * (0.24 * wind - 0.22 * kick + 0.04 * hov);
    o.raise = -(0.3 * wind + 0.12 * kick + 0.08 * hov) + 0.3 * land;
    o.tw = d * (0.4 * kick + 0.1 * hov - 0.2 * wind);
    o.legY = d * (-0.36 * wind + 0.58 * kick);
    o.legD = 0.06 * kick * (1 - cIn); o.frog = hov * (1 - 0.6 * tuckIn); o.scorp = 0;
    o.hy = 0.85 * Math.sin(o.psi) * hov - d * 0.4 * wind;
    o.hp = 0.4 * hov - 0.25 * land;
  } else {
    // the knees bent and the heels up behind, the hips swung the other way and the shoulders against them, then the
    // heels swept across to hook the tail round as the shoulders turn back; up over it arched right back, the arms out
    // like wings, the heels up over the back, watching it over the shoulder
    o.lift = 0.16 * up + 0.07 * wind - 0.025 * kick - 0.025 * land;
    o.py = d * (-0.36 * wind + 0.56 * kick + 0.08 * hov);
    o.ch = d * (0.22 * wind - 0.2 * kick + 0.03 * hov);
    o.raise = -(0.32 * wind + 0.36 * kick + 0.38 * hov) + 0.32 * land;
    o.tw = d * (0.34 * kick + 0.06 * hov - 0.16 * wind);
    o.legY = d * (-0.4 * wind + 0.62 * kick);
    o.legD = 0.04 * kick * (1 - cIn); o.frog = 0; o.scorp = Math.min(1.05, 0.8 * wind + hov * (1 - 0.65 * kick) + 0.25 * kick);
    o.hy = 0.65 * Math.sin(o.psi) * hov + d * 0.45 * kick;
    o.hp = 0.22 * hov - 0.2 * land;
  }
  return o;
}
function whipNone(o) { for (const k in o) o[k] = 0; return o; }

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const _SW0 = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
const _q1 = Q(), _q2 = Q(), _q3 = Q(), _qi = Q(), _pelQ = Q(), _chQ = Q(), _hdQ = Q(), _lq = Q(), _bq = Q();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _v7 = V(), _lp = V(), _acc = V(), _sh = V(), _wr = V(), _el = V(), _fd = V(), _pa = V(), _ft = [V(), V()];

const _wq = Q(), _wa = V(), _wb = V(), _wu = V(), _wl = V(), _lF = V(), _lL = V();

Rig.poser.sled = (rig, S0, dt) => {
  const sl = rig.sl; if (!sl) return;
  const S = S0;
  const P = rig.p, sp = springBank(P, dt), b = rig.b;
  const st = S.state || 'ground', air = st === 'air', crash = st === 'crash', ground = st === 'ground', rail = st === 'rail';
  const t = S.t !== undefined ? S.t : (rig._t = (rig._t || 0) + dt), tt = t + rig.ph;
  const vel = S.vel || ZERO;
  const R = rig.placeBody(S), BP = rig.body.position, qi = _qi.copy(R).invert();
  // on the chairlift: sat on the chair, the sled held hanging in front; at the load and unload lines stood on the snow
  // with the sled held beside (X, for the lift agent: lying on it there, the chair came through the rider)
  if (st === 'lift') { liftPose(rig, S, t); rig._pst = st; rig._gon = 1; sl.pAct = null; sl.psi = 0; return; }
  const changed = rig._pst !== st;
  // (X) just off the lift at the top: stood holding the sled, then down onto it over half a second
  const gon = rig._gon > 0 ? smooth01(rig._gon) : 0; if (rig._gon > 0) rig._gon = Math.max(0, rig._gon - dt / 0.5);
  if (gon > 0.001) carryTargets(rig, R, BP);
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
  // (a whip's key is not a held trick: it goes round, below)
  const hold = tr && !tr.act && prep < 0.6 ? tr : null;
  // (2026-11-06) each trick's weight swings a little past going in (zi under 1: a fling, then settled) and comes out
  // nearly critically damped, so nothing swings back through the sled
  const W = (name, on, w = 9, zi = 1) => sp(name, on ? 1 : 0, w, on ? zi : Math.max(zi, 0.9));
  const sup = W('lsup', hold && hold.legs === 'super', 8, 0.55);
  const up = W('lup', hold && hold.legs === 'up', 9, 0.6), scorp = W('lscorp', hold && hold.legs === 'scorpion', 9, 0.6), spread = W('lspread', hold && hold.legs === 'spread', 9, 0.5);
  const kneel = W('lkneel', hold && hold.legs === 'kneel', 9, 0.65), tuck = W('ltuck', hold && hold.legs === 'tuck', 9, 0.65), click = W('lclick', hold && hold.legs === 'click', 9, 0.55);
  const noH = W('lnoh', hold && (hold.hands === 'none' || hold.hands === 'head'), 12, 0.5), oneH = W('loneh', hold && (hold.hands === 'one' || hold.hands === 'none' || hold.hands === 'head'), 12, 0.5), table = W('ltable', hold && hold.table, 9, 0.55);
  // (X) stood up on it side on, a handstand on its front, rolled onto the back
  const surf = W('lsurf', hold && hold.legs === 'surf', 8, 0.55), hand = W('lhand', hold && hold.legs === 'hand', 7, 0.7), lazy = W('llazy', hold && hold.legs === 'lazy', 8, 0.75);
  // how fast each of those is coming in (1/s), for the fling as they start
  const supV = P.lsup ? clamp(P.lsup.v / 6, -1, 1) : 0, surfV = P.lsurf ? clamp(P.lsurf.v / 5, -1, 1) : 0;
  /* ---- (2026-11-06) a tailwhip or heelwhip going round (skier.js RIDE_ACTS: S.act, S.actT, S.actN rounds done and
     S.actNext another round follows, from the physics or another rider's page). Leon: "make it so that like tailwhips
     briflips barspins etc can all be continuable like after each tailwhip if you do another one the feet dont have to
     stay back onto the board": a round that follows one (actN over 0, or straight after another whip) carries on from
     the middle of the trick with no wind-up (cIn), and while another follows (cOut) the body is not brought back down
     onto the sled at the round's end, so a chain is one motion that settles after its last round. If the state stops
     telling it before it is round (landed near either end) it is finished off quickly: nearly round it goes on round,
     barely started it turns back */
  const ad = S.act ? SLED_TRICKS[S.act] : null;
  if (ad && ad.act) {
    // (another rider's page carries actT on past the round's length while another round follows: wrapped here)
    let tA = S.actT || 0, n = S.actN || 0;
    if (S.actNext && tA >= ad.act) { const k = Math.floor(tA / ad.act); tA -= k * ad.act; n += k; }
    // (a round that follows one goes on from as far up as the body still is: all the way for a held key or an early
    // second press, partly when the press came as the catch had begun, half after another whip)
    if (sl.pAct !== ad || n !== sl.pN || sl.cut) { sl.cIn = n > 0 ? clamp(sl.outV, 0, 1) : sl.pAct && sl.pAct !== ad && sl.pU > 0.7 ? 0.5 : 0; sl.eR = 0; }
    sl.pAct = ad; sl.pU = clamp(tA / ad.act, 0, 1); sl.pN = n; sl.cut = 0; sl.next = !!S.actNext;
  } else if (sl.pAct) {
    if (!sl.cut) sl.cut = sl.pU < 0.4 ? -1 : 1;
    sl.next = false;
    sl.pU += sl.cut * dt / (sl.pAct.act * 0.5);
    if (sl.pU >= 1 || sl.pU <= 0 || crash) { sl.pAct = null; sl.cIn = 0; sl.pN = 0; sl.psi = wrapPi(sl.psi); }
  }
  const WA = sl.pAct, wu = WA ? clamp(sl.pU, 0, 1) : 0;
  // (the physics decides at the round's end whether another follows; a key held only to start this one says nothing yet)
  const cOut = sl.outV = clamp(sp('lwAgain', WA && sl.next && (wu > 0.3 || sl.cIn > 0.5) ? 1 : 0, 14), 0, 1);
  if (WA) {
    // how far round: never back within a round (another round queued late changes the timing of this one's end), but
    // turned back when a whip is cut short at its start
    let E = whipTurn(wu, sl.cIn, cOut);
    if (sl.cut >= 0) { if (E < sl.eR) E = sl.eR; sl.eR = E; }
    whipTargets(wu, E, WA.whip, WA.heel, sl.cIn, cOut, WT); sl.psi = WT.psi; sl.heelK = WA.heel ? 1 : 0;
  } else { whipNone(WT); sl.psi *= Math.exp(-dt * 12); }
  // the sled's part (quick springs, only so a whip cut short does not jump) and the body's (they lag, swing past, settle)
  const wDrop = sp('lwDrop', WT.drop, 30), wSide = sp('lwSide', WT.side, 26), wPit = sp('lwPit', WT.pitch, 26, 0.7), wRoll = sp('lwRoll', WT.roll, 22, 0.6);
  const wLift = sp('lwLift', WT.lift, 17, 0.75), wPy = sp('lwPy', WT.py, 16, 0.45), wCh = sp('lwCh', WT.ch, 13, 0.5), wRaise = sp('lwRaise', WT.raise, 15, 0.55);
  const wTw = sp('lwTw', WT.tw, 15, 0.5), wLegY = sp('lwLegY', WT.legY, 19, 0.4), wLegD = sp('lwLegD', WT.legD, 22, 0.6);
  const wFrog = sp('lwFrog', WT.frog, 16, 0.6), wScorp = sp('lwScorp', WT.scorp, 15, 0.6), wOff = sp('lwOff', WT.off, 20, 0.6), wArm = sp('lwArm', WT.arm, 13, 0.5);
  const wHy = sp('lwHy', WT.hy, 16, 0.7), wHp = sp('lwHp', WT.hp, 13, 0.7), wAbs = sp('lwAbs', WT.abs, 18, 0.45);
  const wHx = sp('lwHx', WT.hx, 18, 0.5), wSx = sp('lwSx', WT.sx, 12, 0.5);
  const hovK = clamp(wLift / 0.15, 0, 1), frogK = Math.max(0, wFrog), scorpW = Math.max(0, wScorp), wo = clamp(wOff, 0, 1.1);
  /* (X) a spin, flat on the snow or in the air: the legs flung out and trailing the turn, the head spotting into it,
     the hands gripping tight (how much from how fast it turns about the sled's up). (2026-11-06) The legs' trail is a
     spring that lags the turn and swings past when it stops; the shoulders and head lead into it (lead: how far the
     quick spring is ahead of the legs') */
  const spinK = (crash ? 0 : smoothstep(2.0, 5.5, Math.abs(Wy)) * (1 - Math.min(1, surf + hand + lazy + kneel + tuck))) * (1 - hovK), spinD = Math.sign(Wy);
  const trail = sp('lspT', spinD * spinK, 7, 0.42), lead = sp('lspL', spinD * spinK, 24) - trail;
  // (X) a shifty in the air (skier.shift): the sled swung across under the rider about the hips and back (it swings a
  // little past, 2026-11-06)
  const shy = sp('lshy', air ? -0.8 * (S.shift || 0) : 0, 14, 0.55);
  // the hips' turn about the sled's up (+: the legs swing to the rider's right) and the chest's (+: the head to the
  // left): the hips drive a whip and a shifty, lag a spin; the shoulders lead a spin and hold against a shifty
  const yawP = wPy - 0.22 * trail + 0.5 * shy, yawC = wCh + 0.3 * lead + 0.1 * spinD * spinK - 0.2 * shy;
  const absorb = S.absorb || 0;
  // ---- the sled: leaning with the turn, a little lifted in the air, laid over for a table top
  const lp = _lp.set(0, -(S.sink || 0) + 0.05 * airW, 0), lq = _lq.setFromAxisAngle(Z, phi * 0.6);
  if (table > 0.001) lq.multiply(_q1.setFromAxisAngle(Z, 1.1 * table));
  if (crashW > 0.01) lq.multiply(_q1.setFromAxisAngle(Y, 0.7 * crashW * Math.sin(t * 2.2)));
  sl.root.position.copy(lp).applyQuaternion(R).add(BP); sl.root.quaternion.copy(R).multiply(lq);
  sl.root.updateMatrixWorld(true);
  const SW = _SW0.copy(sl.root.matrixWorld), sledQ = _bq.copy(R).multiply(lq);
  // the runners' tracks
  for (let k = 0; k < 2; k++) { sl.tr[k].position.set(k ? -0.2 : 0.2, 0, -0.08).applyMatrix4(SW); sl.root.getWorldQuaternion(sl.tr[k].quaternion); }
  // (SW above, the sled before the shifty and the whip, places the body; the hands go to the sled where it is)
  if (Math.abs(shy) > 0.004) {
    const piv = _v7.set(0, 0, SLED.hips + 0.15).applyMatrix4(SW);
    _q3.setFromAxisAngle(_v2.set(0, 1, 0).applyQuaternion(sl.root.quaternion), shy);
    sl.root.position.sub(piv).applyQuaternion(_q3).add(piv); sl.root.quaternion.premultiply(_q3); sl.root.updateMatrixWorld(true);
  }
  // (2026-11-06) a whip: the sled turned about its own up through its middle, dropped away from the body, pushed out by
  // the kick, its nose lifted as the tail is kicked and rolled into the turn as it goes round
  if (WA || Math.abs(sl.psi) > 1e-3 || Math.abs(wDrop) + Math.abs(wSide) + Math.abs(wPit) + Math.abs(wRoll) > 1e-4) {
    const q0 = sl.root.quaternion, piv = _wa.set(0, 0.11, 0).applyMatrix4(sl.root.matrixWorld);
    _wq.copy(q0).multiply(_q1.setFromAxisAngle(Y, sl.psi)).multiply(_q2.setFromAxisAngle(X, -wPit)).multiply(_q1.setFromAxisAngle(Z, wRoll));
    q0.copy(_wq); sl.root.position.copy(piv).sub(_wb.set(0, 0.11, 0).applyQuaternion(_wq));
    sl.root.position.addScaledVector(_wu.set(0, 1, 0).applyQuaternion(sledQ), -wDrop).addScaledVector(_wl.set(1, 0, 0).applyQuaternion(sledQ), wSide);
    sl.root.updateMatrixWorld(true);
  }
  // ---- the body lying on it face down, head forward: the rest frame pitched forward a quarter round; the chest a
  // little raised (looking ahead), the hips on the back of the slats; kneeling up or tucked in a trick; stood up side
  // on (surfer: the pitch gone, turned a quarter); over on the front in a handstand (pitched right over); on the back.
  // (2026-11-06) In a whip lifted off it, the hips turned to drive it and twisted about the spine as the leg kicks,
  // piked with the knees tucked (tailwhip) or arched with the heels up (heelwhip)
  const upK = kneel;
  /* (seen in first person, 2026-11-06: lying further back on the slats with the hands on the front curls, so from the
     eyes the curls and the hands are ahead, as a sledder sees them; as the rest of the pose has it the head is out past
     the front and the hands are under the chest, behind the eyes. Only this rider's own eyes see it; not in the held
     tricks, which put the body elsewhere.) */
  const fpS = sp('lfpW', rig.fp ? 1 : 0, 6) * clamp(1 - surf - hand - lazy - kneel - tuck - sup, 0, 1);
  const pelPitch = (Math.PI / 2 - 0.05 - 1.2 * upK - 0.6 * tuck) * (1 - surf) + (Math.PI / 2 + 0.05) * hand - (Math.PI - 0.2) * lazy - 0.25 * frogK;
  const pelQ = _pelQ.copy(sledQ).multiply(_q1.setFromAxisAngle(Y, clamp(-Wy * 0.03, -0.15, 0.15) * (1 - spinK) - Math.PI / 2 * surf + yawP)).multiply(_q1.setFromAxisAngle(X, pelPitch * (1 - gon))).multiply(_q1.setFromAxisAngle(Y, wTw));
  // the chest: raised to look ahead, pushed up or arched in a whip, rounded over the tuck, down onto the sled at the
  // catch; bent sideways from the hips' turn to the chest's own; wrung against the hips' twist; a surfer swaying
  const chX = (-0.32 - 0.1 * absorb + 0.1 * wob(tt * 0.8, 3) * airW + 0.6 * upK + 0.22 * sup + 0.15 * spinK + 0.75 * tuck) * Math.max(0, 1 - surf - hand - lazy) + 0.25 * surf + 0.12 * lazy
    + wRaise + 0.2 * frogK + 0.22 * wAbs;
  const chQ = _chQ.copy(pelQ).multiply(_q1.setFromAxisAngle(X, chX)).multiply(_q1.setFromAxisAngle(Z, phi * 0.3 + yawP - yawC + 0.12 * Math.sin(tt * 2.1) * surf)).multiply(_q1.setFromAxisAngle(Y, -0.6 * wTw));
  const pelW = _v1.set(-0.3 * wSide + wSx, SLED.top + 0.13 + 0.25 * upK + 0.1 * sup + 0.14 * tuck + wLift, SLED.hips + 0.15 * upK - 0.6 * sup + 0.06 * tuck - SLED_FP.back * fpS);
  // (stood on the slats, knees bent; up over the hands; lying on the back in the middle of it)
  if (surf > 0.001) pelW.lerp(_v2.set(0.02, SLED.top + rig.ankleH + 0.03 + rig.legLen * 0.97 * 0.72 + (rig.pelvisY - rig.hipY), -0.02), surf);
  if (hand > 0.001) pelW.lerp(_v2.set(0, SLED.hand[1] + (rig.len.ua + rig.len.fa) * 0.93 + 0.48, SLED.hand[2] - 0.08), hand);
  if (lazy > 0.001) pelW.lerp(_v2.set(0, SLED.top + 0.12, -0.05), lazy);
  // (2026-11-06) pushed up on the hands while the knees come under, kneeling up, tucking or standing up, and on the way
  // back: the knees slid through the slats before
  { const k1 = clamp(kneel, 0, 1), k2 = clamp(tuck, 0, 1), k3 = clamp(surf, 0, 1); pelW.y += 0.14 * Math.sqrt(Math.sin(Math.PI * k1)) + 0.14 * Math.sqrt(Math.sin(Math.PI * k2)) + 0.15 * Math.sqrt(Math.sin(Math.PI * k3)); }
  pelW.applyMatrix4(SW);
  if (gon > 0.001) pelW.lerp(CY.pel, gon);
  if (crashW > 0.01) chQ.multiply(_q1.setFromAxisAngle(X, Math.sin(t * 3.1) * 0.5 * crashW));
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v2.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v3.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v3.copy(pelW).sub(off));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  // the head lifted to look where it goes (into a spin, spotting the way it turns, ahead of it as it starts); a surfer
  // looks along the sled over the front shoulder; upside down, at the snow by the hands; on the back, along the body to
  // the feet; in a whip following the sled's nose round and down at it, then ahead for the catch
  const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, clamp(Wy * 0.15, -0.5, 0.5) * (1 - spinK) + spinD * 0.6 * spinK + 0.5 * lead + 1.25 * surf + wHy))
    .multiply(_q1.setFromAxisAngle(X, (-0.85 + 0.6 * upK + 0.9 * tuck) * Math.max(0, 1 - surf - hand - lazy) - 0.55 * hand + 0.55 * lazy + wHp));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  // ---- legs: trailing off the back, toes down; the inside foot drags lower in a turn; up straight (superman), bent
  // over the back (scorpion), wide (spread), heels together up (heel click), knelt on the slats (kneel), tucked.
  // (2026-11-06) The legs have their own frame (lF back along them, lL to their left): turned with the hips, whipped
  // further than the hips in a kick, trailing a spin, swung with the sled in a shifty
  const sUp = _v4.set(0, 1, 0).applyQuaternion(sledQ), sFw = _v5.set(0, 0, 1).applyQuaternion(sledQ), sLf = _v6.set(1, 0, 0).applyQuaternion(sledQ);
  const legA = yawP + wLegY - 0.35 * trail + 0.35 * shy, lc = Math.cos(legA), ls = Math.sin(legA);
  const lF = _lF.copy(sFw).multiplyScalar(lc).addScaledVector(sLf, ls), lL = _lL.copy(sLf).multiplyScalar(lc).addScaledVector(sFw, -ls);
  const L = rig.legLen, tA = Math.abs(trail);
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    th.updateWorldMatrix(false, false);
    const hip = _v2.setFromMatrixPosition(th.matrixWorld);
    const drag = ground ? clamp(-phi * s * 2, 0, 1) : 0;
    const a = _ft[k].copy(hip).addScaledVector(lF, -L * 0.93).addScaledVector(lL, s * 0.07).addScaledVector(sUp, -0.06 - 0.08 * drag + 0.04 * wob(tt * 1.4, 5 + k) - wLegD);
    // (X) a spin: the legs flung out wide and lifted a little off the snow (and trailing it, in lF)
    if (tA > 0.01) a.addScaledVector(lL, s * 0.2 * tA).addScaledVector(sUp, 0.07 * tA).addScaledVector(lF, 0.06 * tA);
    // a superman: straight out behind, level with the body (flicked up as the body is thrown off the back, the legs
    // fluttering)
    if (sup > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -L * 0.95).addScaledVector(sUp, 0.06 + 0.14 * Math.max(0, supV) + s * 0.04 * Math.sin(tt * 8)).addScaledVector(sLf, s * 0.06), sup);
    if (up > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -L * 0.75).addScaledVector(sUp, L * 0.5).addScaledVector(sLf, s * 0.05), up);
    if (scorp > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -0.15).addScaledVector(sUp, L * 0.62).addScaledVector(sLf, s * 0.08), scorp);
    if (spread > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -L * 0.65).addScaledVector(sLf, s * 0.55).addScaledVector(sUp, 0.12), spread);
    // (the heels parting and clicking together again)
    if (click > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sFw, -0.45).addScaledVector(sUp, 0.42).addScaledVector(sLf, s * (0.02 + 0.06 * Math.max(0, Math.sin(tt * 11)))), click);
    if (kneel > 0.01) a.lerp(_v3.set(s * 0.14, SLED.top + 0.12, SLED.hips - 0.12).applyMatrix4(SW), kneel);
    if (tuck > 0.01) a.lerp(_v3.set(s * 0.13, SLED.top + 0.1, SLED.hips - 0.02).applyMatrix4(SW), tuck);
    // (2026-11-06) a whip: the knees tucked up under the hips, out to the sides (tailwhip), or the heels up over the
    // back (heelwhip), both clear of the sled going round under them
    if (frogK > 0.01) a.lerp(_v3.copy(hip).addScaledVector(lF, -0.24).addScaledVector(lL, s * 0.22).addScaledVector(sUp, 0.03), frogK);
    if (scorpW > 0.01) a.lerp(_v3.copy(hip).addScaledVector(lF, -0.16).addScaledVector(sUp, L * 0.6).addScaledVector(lL, s * 0.07), scorpW);
    // (X) stood on the slats, the left foot to the front; straight up over the hands; over the curled front
    if (surf > 0.01) a.lerp(_v3.set(0.03, SLED.top + rig.ankleH + 0.03, k ? -0.27 : 0.24).applyMatrix4(SW), surf);
    if (hand > 0.01) a.lerp(_v3.copy(hip).addScaledVector(sUp, L * 0.96 + s * 0.03 * Math.sin(tt * 3.1)).addScaledVector(sFw, -0.06).addScaledVector(sLf, s * 0.05), hand);
    if (lazy > 0.01) a.lerp(_v3.set(s * 0.13, SLED.top + 0.42, 0.68).applyMatrix4(SW), lazy);
    // (rolling over, the feet go up and over in an arc rather than past the hips, where the knees swung round in a frame)
    if (lazy > 0.01 && lazy < 1) a.addScaledVector(sUp, 0.6 * Math.sin(Math.PI * lazy));
    if (gon > 0.001) a.lerp(CY.foot[k], gon);
    const d = a.distanceTo(hip), m = softReach(d, L, 0.9, 0.985); if (m < d) a.sub(hip).multiplyScalar(m / d).add(hip);
    // the knees bend down towards the snow (lying), back (kneeling), forward (stood up), up (on the back); out to the
    // sides in a tailwhip's tuck
    const kp = _v3.copy(sUp).negate().addScaledVector(lF, 0.2 + 0.8 * upK).addScaledVector(lL, s * 0.1);
    if (scorp + click > 0.01) kp.lerp(_v2.copy(sUp).negate(), Math.min(1, scorp + click));
    if (surf > 0.01) kp.lerp(_v2.copy(sLf).negate().addScaledVector(sFw, 0.3 * s), surf);
    if (hand > 0.01) kp.lerp(_v2.copy(sFw).negate(), hand);
    // (on the back the knees point up: the pole turns over with the hips' own front, and out to the sides on the way, as
    // lerping straight from down to up went through nothing and flipped the knees over in a frame, 2026-11-06)
    if (lazy > 0.01) { kp.lerp(_v2.set(0, 0, 1).applyQuaternion(pelQ), Math.min(1, lazy)); if (lazy < 1) kp.addScaledVector(lL, s * 0.9 * Math.sin(Math.PI * lazy)); }
    if (gon > 0.001) kp.lerp(_v2.set(0, 0.3, 1).applyQuaternion(R), gon);
    if (tuck > 0.01) kp.lerp(_v2.copy(sFw).addScaledVector(sUp, 0.4).addScaledVector(sLf, s * 0.2), tuck);
    if (frogK > 0.01) kp.lerp(_v2.copy(sUp).multiplyScalar(-0.1).addScaledVector(lL, s * 0.9).addScaledVector(lF, 0.55), Math.min(1, frogK));
    if (scorpW > 0.01) kp.lerp(_v2.copy(sUp).negate(), Math.min(1, scorpW));
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', a, kp, Z);
    // feet pointed (toes down and back) lying, flat kneeling or stood; pointed up in a handstand; turned with the legs
    _q2.copy(sledQ).multiply(_q1.setFromAxisAngle(Y, legA)).multiply(_q1.setFromAxisAngle(X, Math.PI * 0.95 * (1 - Math.max(upK, surf))));
    if (surf > 0.01) _q2.multiply(_q1.setFromAxisAngle(Y, (-Math.PI / 2 + (k ? 0.3 : -0.2)) * surf));
    if (hand + lazy > 0.01) _q2.slerp(_q3.copy(pelQ).multiply(_q1.setFromAxisAngle(X, -0.9)), Math.min(1, hand + lazy));
    if (gon > 0.001) _q2.slerp(_q3.copy(R), gon);
    rig.setWorldQ(ft, _q2.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
  }
  // ---- arms: hands on the front of the sled; out wide with no hands (the right one first); out like a surfer's;
  // behind the head lying on the back; (2026-11-06) in a whip let go as it is kicked, flung up, then held low over it
  // palms down ready to catch (tailwhip) or out like wings (heelwhip), and down onto the front as it comes round
  const cL = _v2.set(1, 0, 0).applyQuaternion(chQ), armL = rig.len.ua + rig.len.fa;
  const hk = sl.heelK, offV = P.lwOff ? Math.max(0, P.lwOff.v) : 0;
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    ua.updateWorldMatrix(false, false);
    const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
    const offK = Math.max((k ? oneH : noH) * (1 - hand), wo);
    const hold_ = _wr.set(s * SLED.hand[0], SLED.hand[1], SLED.hand[2]).lerp(_v7.set(s * SLED_FP.curl[0], SLED_FP.curl[1], SLED_FP.curl[2]), fpS).applyMatrix4(sl.root.matrixWorld);
    const free = _v3.copy(sh).addScaledVector(sLf, s * (0.5 + 0.05 * wob(tt * 1.3, 31 + k))).addScaledVector(sUp, 0.15 + 0.08 * wob(tt * 1.7, 33 + k)).addScaledVector(sFw, 0.15);
    // (a surfer's arms balancing against the sway, one up as the other goes down, flung up as they stand)
    if (surf > 0.01) free.lerp(_v7.copy(sh).addScaledVector(cL, s * 0.52).addScaledVector(sUp, -0.06 + 0.04 * Math.sin(tt * 1.6 + k) - s * 0.1 * Math.sin(tt * 2.1) + 0.25 * Math.max(0, surfV)), surf);
    if (lazy > 0.01) free.lerp(_v7.set(0, 1, 0).applyQuaternion(chQ).multiplyScalar(0.3).add(sh).addScaledVector(cL, -s * 0.1).addScaledVector(sUp, 0.12), lazy);
    if (wo > 0.01) free.lerp(_v7.copy(sh).addScaledVector(sLf, s * (0.14 + 0.38 * hk)).addScaledVector(sUp, -0.24 + 0.2 * hk + 0.016 * offV).addScaledVector(sFw, 0.12 - 0.12 * hk).addScaledVector(sLf, wHx), Math.min(1, wo));
    const wr = hold_.lerp(free, offK);
    if (gon > 0.001) wr.lerp(k ? CY.hand[1] : _v7.copy(sh).addScaledVector(sUp, -0.5), gon);
    if (crashW > 0.5) wr.copy(sh).addScaledVector(cL, s * 0.35).addScaledVector(sUp, 0.25 + Math.sin(t * 9 + s) * 0.2);
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.82, 0.97); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const el = _el.copy(cL).multiplyScalar(s).addScaledVector(sUp, 0.6 * Math.max(0, 1 - hand - lazy)).normalize();
    // (gripping tight in a spin: the elbows in close; up and out with the hands off in a whip)
    if (spinK > 0.01) el.addScaledVector(sUp, -0.5 * spinK).normalize();
    if (wo > 0.01) el.addScaledVector(sUp, (0.25 + 0.45 * hk) * Math.min(1, wo)).addScaledVector(cL, s * 0.5 * Math.min(1, wo)).normalize();
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    const fd = _fd.copy(sFw).addScaledVector(sUp, -0.4).normalize(), pa = _pa.copy(sUp).negate().lerp(_v7.copy(cL).multiplyScalar(-s), Math.min(1, offK) * (1 - Math.min(1, wo) * (1 - hk))).normalize();
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
    rig.curl(HH, 1.25 - 0.7 * Math.min(1, offK) + 0.35 * spinK * (1 - Math.min(1, offK)));
    sFw.set(0, 0, 1).applyQuaternion(sledQ); sUp.set(0, 1, 0).applyQuaternion(sledQ); sLf.set(1, 0, 0).applyQuaternion(sledQ);
  }
  // (X) the sled from the carried hold down onto the snow, as the rider gets on it
  if (gon > 0.001) { sl.root.position.lerp(CY.sp, gon); sl.root.quaternion.slerp(CY.sq, gon); }
  rig.placeHead(hdQ);
  rig.flushTree(rig.body);
};

/* (X) the sled carried, standing on the snow at F (feet) facing R's way: the sled stood on its tail beside the right
   foot, nose up and a little forward, its slats towards the rider, the curled front held in the right hand; the left
   hand hangs. Into CY (world). */
const CY = { sp: V(), sq: Q(), pel: V(), foot: [V(), V()], hand: [V(), V()] };
const _cx = V(), _cy = V(), _cz = V(), _cm = new THREE.Matrix4();
function carryTargets(rig, R, F) {
  const up = _cy.set(0, 1, 0).applyQuaternion(R), fw = _cz.set(0, 0, 1).applyQuaternion(R), lf = _cx.set(1, 0, 0).applyQuaternion(R);
  const zA = _v6.copy(up).multiplyScalar(Math.cos(0.3)).addScaledVector(fw, Math.sin(0.3)).normalize();   // the nose
  const yA = _v4.copy(lf).addScaledVector(zA, -lf.dot(zA)).normalize();                                     // the slats' top
  const xA = _v5.crossVectors(yA, zA);
  CY.sq.setFromRotationMatrix(_cm.makeBasis(xA, yA, zA));
  CY.sp.copy(F).addScaledVector(lf, -0.36).addScaledVector(fw, 0.02).addScaledVector(up, 0.02).addScaledVector(zA, 0.49);
  CY.pel.copy(F).addScaledVector(up, rig.ankleH + rig.legLen * 0.95 + (rig.pelvisY - rig.hipY)).addScaledVector(lf, 0.03).addScaledVector(fw, -0.03);
  for (let k = 0; k < 2; k++) CY.foot[k].copy(F).addScaledVector(lf, (k ? -1 : 1) * 0.12).addScaledVector(up, rig.ankleH + 0.01).addScaledVector(fw, k ? -0.03 : 0.04);
  CY.hand[1].set(-0.03, 0.22, 0.4).applyQuaternion(CY.sq).add(CY.sp);
}
/* (X) on the chairlift: seated (as every ride but skis), and at the load and unload lines (S.liftFeet set, S.liftSit
   from 0 stood there to 1 sat down) between that and standing with the sled carried, the hips going from over the feet
   to the seat as the chair comes, and back at the top */
function liftPose(rig, S, t) {
  const sl = rig.sl, b = rig.b;
  seatRider(rig, S, t); holdOnLift(rig, sl.root, 0.5);
  const F = S.liftFeet, sit = smooth01(S.liftSit ?? 1);
  if (!F || sit > 0.999) return;
  const st0 = 1 - sit, R = rig.body.quaternion, BP = rig.body.position;
  carryTargets(rig, R, F);
  const up = _v4.set(0, 1, 0).applyQuaternion(R), fw = _v5.set(0, 0, 1).applyQuaternion(R), lf = _v6.set(1, 0, 0).applyQuaternion(R);
  // the hips: from the seat to over the feet, the whole skeleton with them
  const pel = _v1.set(0, rig.pelvisY - rig.hipY + 0.1, -0.02).applyQuaternion(R).add(BP).lerp(CY.pel, st0);
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v2.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v3.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v3.copy(pel).sub(off));
  b.root.updateMatrixWorld(true);
  // legs: from thighs along the seat and shins hanging to standing on the snow
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    const hip = _v2.setFromMatrixPosition(th.matrixWorld);
    const an = _v3.copy(hip).addScaledVector(fw, rig.len.th * 0.95 + 0.08).addScaledVector(up, -rig.len.ca * 0.95).addScaledVector(lf, s * 0.06).lerp(CY.foot[k], st0);
    { const d = an.distanceTo(hip), m = softReach(d, rig.legLen, 0.9, 0.985); if (m < d) an.sub(hip).multiplyScalar(m / d).add(hip); }
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', an, _v7.copy(fw).addScaledVector(up, 0.3 * sit), Z);
    _q2.copy(R).multiply(_q1.setFromAxisAngle(Y, s * 0.15)).multiply(_q3.setFromAxisAngle(X, 0.35 * sit));
    rig.setWorldQ(ft, _q2.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
  }
  // arms: from the hands on the thighs to the right hand on the sled's front, the left one hanging
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
    const wr = _wr.copy(sh).addScaledVector(fw, 0.32).addScaledVector(up, -0.42).addScaledVector(lf, s * 0.02);
    wr.lerp(k ? CY.hand[1] : _v2.copy(sh).addScaledVector(up, -0.5).addScaledVector(fw, 0.08).addScaledVector(lf, 0.07), st0);
    { const d = wr.distanceTo(sh), armL = rig.len.ua + rig.len.fa, m = softReach(d, armL, 0.82, 0.97); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, _el.copy(lf).multiplyScalar(s * 0.6).addScaledVector(up, -0.6).addScaledVector(fw, -0.3).normalize(), NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, _fd.copy(fw).lerp(_v2.copy(up), k ? st0 : 0).normalize(), _pa.copy(up).negate().lerp(_v2.copy(lf), st0 * (k ? 1 : 0.5)).normalize());
    rig.curl(HH, 0.5 + (k ? 0.8 : 0.1) * st0);
  }
  // the sled: from hanging in front of the shins to carried beside
  sl.root.position.lerp(CY.sp, st0); sl.root.quaternion.slerp(CY.sq, st0);
  rig.placeHead(rig.headQ);
  rig.flushTree(rig.body);
}
