// Leon Freeski: boot, settings, the frame loop.
import * as THREE from 'three';
import { Terrain, setPark, setMountain, height, normal, baseLine } from './terrain.js?v=20';
import { makePark, makeJumpLine, emptyPark, featureMesh, railMeshes } from './park.js?v=20';
import { makeMaterials, snowUniforms } from './materials.js?v=20';
import { makeSky, Forest, makeRanges, makeMountainRanges, makeProps } from './world.js?v=20';
import { Mountain, SPOTS } from './dem.js?v=20';
import { Skier } from './skier.js?v=20';
import { Rig } from './rig.js?v=20';
import './board.js?v=20';                 // (B: registers the snowboard with the rig: Rig.loader.board, Rig.poser.board)
import './scoot.js?v=20';                 // (B: and the snow scooter and snowbike: Rig.loader.scoot / bike, Rig.poser.scoot / bike)
import './sled.js?v=20';                  // (B: and the sled: Rig.loader.sled, Rig.poser.sled)
import { Tricks } from './tricks.js?v=20';
import { Input } from './input.js?v=20';
import { Cams } from './camera.js?v=20';
import { Tracks, Spray } from './snow.js?v=20';
import { Hud } from './hud.js?v=20';
import { Sound } from './sound.js?v=20';
import { Net } from './net.js?v=20';
import { mergeGear } from './gear.js?v=20';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Touch, TOUCH_GRABS } from './touch.js?v=20';
import { Locker, loadLook, cleanLook } from './locker.js?v=20';
import { planLift, Lift } from './lift.js?v=20';      // (L: the chairlift)
import { planTbar, Tbar } from './tbar.js?v=20';      // (J: the Jump Line's T-bar)
import { makeFreeride } from './freeride.js?v=20';    // (F: the Freeride mountain)
import { buildRock, buildJibs } from './frrock.js?v=20';

const $ = id => document.getElementById(id);
const STEP = 1 / 120;

// ---- settings and graphics tier ------------------------------------------------------------------------------------
const saved = (() => { try { return JSON.parse(localStorage.getItem('ski_opts') || '{}'); } catch (e) { return {}; } })();
const opts = Object.assign({ scheme: 'mouse', cam: 'chase', gfx: 'auto', poles: '1', rider: 'm_adult_10', showfps: false, map: 'jumpline', ride: 'ski', stance: 'regular' }, saved);
// only the Jump Line is offered for now (Leon, 2026-11-05: "Remove mamoth map for now and also remove the other map as well
// just keep jump line for now"); the other maps stay in the code and open with ?map= for tests
// (F, 2026-11-06: and Freeride, the made-up big-mountain face, picked on the home screen)
if (opts.map !== 'freeride') opts.map = 'jumpline';
const qs = new URLSearchParams(location.search);
if (qs.get('gfx')) opts.gfx = qs.get('gfx');
function detectTier() {
  const ua = navigator.userAgent, mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
  let gpu = '';
  try { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; gl && gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {}
  const soft = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu);
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  if (/CrOS/.test(ua) || mem <= 4 || cores <= 2 || mobile || soft || (/Intel/i.test(gpu) && /(HD|UHD) Graphics/i.test(gpu) && cores <= 4)) return { tier: 'low', soft };
  if (/Intel/i.test(gpu) || mem <= 8) return { tier: 'medium', soft };
  return { tier: 'high', soft };
}
const det = detectTier();
const tier = opts.gfx === 'auto' ? det.tier : opts.gfx;
const Q = {
  // (E, 2026-11-08, the lag pass: bigger terrain patches split later, the same detail on the screen in about a third
  // fewer draws; mtnLeaf: the smallest patch on a mountain map, Freeride's, never coarser near the rider than before)
  low: { tier: 'low', pr: [0.55, 0.9], start: 0.8, shadows: true, minLeaf: 64, mtnLeaf: 32, K: 0.56, seg: 32, aa: false, fine: false },
  medium: { tier: 'medium', pr: [0.7, 1.0], start: 1.0, shadows: true, minLeaf: 32, mtnLeaf: 16, K: 0.75, seg: 32, aa: false, fine: true },
  high: { tier: 'high', pr: [0.8, Math.min(1.5, devicePixelRatio || 1)], start: Math.min(1.25, devicePixelRatio || 1), shadows: true, minLeaf: 16, K: 1.4, seg: 28, aa: true, fine: true },
}[tier] || null;
const q = Q || { tier: 'medium', pr: [0.7, 1], start: 1, shadows: true, minLeaf: 16, K: 1.6, aa: false, fine: true };
if (det.soft) { q.pr = [0.4, 0.6]; q.start = 0.5; q.shadows = false; }

// ---- renderer and scene ----------------------------------------------------------------------------------------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.aa, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(q.start);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = q.shadows; renderer.shadowMap.type = q.tier === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.15, 20000);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// the map: the terrain park, or a real mountain from open elevation data
if (qs.get('map')) opts.map = qs.get('map');
let mtn = null;
if (SPOTS[opts.map]) {
  $('play').textContent = 'Loading the mountain...';
  try { mtn = await new Mountain(SPOTS[opts.map]).load(q.tier === 'low' ? 3 : 4, 3); setMountain(mtn); }
  catch (e) { console.warn('mountain', e); mtn = null; opts.map = 'park'; }
}
const mats = makeMaterials(q);
// (F) Freeride: its land through the mountain hook (setMountain, inside makeFreeride) and a park of its own
const fr = !mtn && opts.map === 'freeride' ? makeFreeride(q) : null;
const park = fr ? fr.park : mtn ? emptyPark() : opts.map === 'jumpline' ? makeJumpLine() : makePark(); setPark(park);
// (L) the chairlift beside the Jump Line: where it goes, and the flat snow under its stations (added to the park's height
// before the terrain is built)
const liftPlan = (fr || !mtn && opts.map === 'jumpline') && !qs.has('nolift') ? (fr ? planLift : planTbar)(park) : null;   // (F: Freeride's runs from its base to the ridge, park.liftLine)   // (?nolift: without it, for tests)   // (J: the Jump Line's is a T-bar, tbar.js)
const sky = makeSky(scene, renderer, q, !!mtn);
const terrain = new Terrain(scene, mats.snow, { minLeaf: q.minLeaf, mtnLeaf: q.mtnLeaf, K: q.K, seg: q.seg, budget: q.tier === 'low' ? 3 : 4, far: q.tier === 'low' ? 2000 : 2600, root: mtn ? { x0: -4096, z0: -4096, size: 8192 } : null });
const jumpLods = [], JUMP_FAR = q.tier === 'low' ? 110 : 150;
{
  /* (2026-11-06, the lag pass: a jump's three takeoffs side by side are one mesh and one draw call; they were one each,
     21 on the Jump Line. Each jump is still left out when it is out of view.) */
  const groups = new Map();
  for (const f of [...park.kickers, park.pipe, park.qp]) if (f) {
    const m = featureMesh(f, height, mats.snow, q.fine), key = (/^Jump \d+/.exec(f.name || '') || [f.group || m.uuid])[0];   // (F: Freeride's kickers are one group)
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const [key, ms] of groups) {
    const g = ms.length > 1 ? mergeGeometries(ms.map(m => m.geometry), false) : null;
    if (!g) { for (const m of ms) scene.add(m); continue; }
    for (const m of ms) m.geometry.dispose();
    const m = new THREE.Mesh(g, mats.snow);
    m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.name = key;
    scene.add(m);
    /* (2026-11-06, the lag pass: looking down the Jump Line every jump was drawn in full, about 23 000 triangles each on
       the low tier, 55 000 on the others. Past jumpLods' distance a jump is drawn from a copy with its rows and columns
       thinned out (park.js featureMesh), a third of the triangles; out there the two differ by a pixel or so.) */
    const fs = park.kickers.filter(f => (/^Jump \d+/.exec(f.name || '') || [])[0] === key);
    const fg = fs.length ? mergeGeometries(fs.map(f => { const mm = featureMesh(f, height, mats.snow, q.fine, q.fine ? 0.3 : 0.35); return mm.geometry; }), false) : null;
    if (fg) {
      const far = new THREE.Mesh(fg, mats.snow);
      far.receiveShadow = true; far.castShadow = false; far.matrixAutoUpdate = false; far.name = key + ' far'; far.visible = false;
      scene.add(far);
      g.computeBoundingBox();
      jumpLods.push({ near: m, far, box: g.boundingBox, isFar: false });
    }
  }
}
// which copy of each jump is drawn: the far one past JUMP_FAR metres from the camera (5 m more to go back, so it never
// flickers between them at the edge)
function lodJumps(cam) {
  for (const J of jumpLods) {
    const d = J.box.distanceToPoint(cam), far = J.isFar ? d > JUMP_FAR - 5 : d > JUMP_FAR;
    if (far !== J.isFar) { J.isFar = far; J.near.visible = !far; J.far.visible = far; }
  }
}
// (the park's rails and boxes; the benches' model loads, and is in before the shaders are compiled at boot: K)
const railsG = park.rails.length ? railMeshes(park.rails, mats) : null; if (railsG) scene.add(railsG);
if (fr) { buildRock(scene, fr.land, mats, q); buildJibs(scene, fr, mats, q); }   // (F: the rock faces, logs, slab, stumps, flags and finish arch)
const forest = new Forest(scene, q, mtn || (fr && fr.mtn));   // (F: Freeride's trees from its own list)
if (mtn) makeMountainRanges(scene, q, mtn); else makeRanges(scene, q, mats.snow);
if (!mtn) makeProps(scene, park, q);
const tracks = new Tracks(renderer, q);
const spray = new Spray(scene, q);

const skier = new Skier(park);
skier.trees = forest;
// (L) the chairlift (its model loads in the background, in before the shaders are compiled at boot); its towers and the
// stations' piers are hit as trees are
const lift = liftPlan ? (liftPlan.tbar ? new Tbar(scene, liftPlan, q) : new Lift(scene, liftPlan, q)) : null;   // (J: tbar.js has the same interface)
const liftReady = lift ? lift.load().catch(e => console.warn('lift', e)) : null;
if (lift) skier.trees = lift.withTowers(forest);
sky.env.attach(skier);       // the snow kind's riding (skier.snowK) and look, from the home screen's 'Time, sky and snow' (env.js)
let rig = new Rig(); scene.add(rig.root);
const hud = new Hud();
const tricks = new Tricks(t => { hud.trick(t); if (t.name && !t.banked && t.quality !== 'bail') net.trick(t.name, t.points); });
const input = new Input(canvas);
const cams = new Cams(camera, park);
cams.attachLook(canvas, input);                          // (R: dragging looks round in first person)
const touch = new Touch(input, () => { opts.cam = cams.next(); hud.flash({ chase: 'Chase camera', far: 'Far chase', pov: 'First person', film: 'Filmer' }[opts.cam], 900); });
Object.defineProperty(input.touch, 'grabId', { get: () => TOUCH_GRABS[input.touch.sel] });
const sound = new Sound();

// where a run starts: each park map's own first start (on a slope steep enough to roll away down), and on the mountain
// down the fall line from the summit to where the snow is about 12 degrees (the summit itself is nearly flat)
const START = mtn ? (() => {
  let x = 0, z = 0, dx = 0, dz = 1;
  for (let i = 0; i < 150; i++) {
    const n = normal(x, z), s = Math.hypot(n.x, n.z);
    if (s > 1e-3) { dx = n.x / s; dz = n.z / s; }
    const drop = (height(x, z) - height(x + dx * 6, z + dz * 6)) / 6;
    if (i > 2 && drop > Math.tan(12 * Math.PI / 180)) break;
    x += dx * 2; z += dz * 2;
  }
  return { x, z, v: 2, yaw: Math.atan2(dx, dz) };
})() : { x: park.starts[0].x, z: park.starts[0].z, v: park.starts[0].v, yaw: park.starts[0].yaw || 0 };   // (F: a start may face its own way, Freeride's lift tops)
const toStart = () => { skier.spawn(START.x, START.z, START.v, START.yaw); skier.safe.length = 0; cams.first = true; };
/* ---- what is drawn: the physics between its last two steps (2026-11-07, for "random frames where it like blinks" and
   "not glitchy for all"). The physics runs in fixed steps of 1/120 s, as many a frame as the frame's time holds: two
   at 60 frames a second, but one or none at 144, and three to six on a slow machine, unevenly. Drawn as it stood after
   the last step, the rider and everything placed from them (every camera, the shadows' box, the snow's tracks) moved on
   a whole step one frame and less or none the next: the rider was up to 12 cm off where the velocity put them, in every
   view. Now the state before each step is kept and each frame is drawn between the two, by how far the clock has run
   into the next step (the usual fixed-step way: one step behind, every frame in its place). The physics is unchanged.
   A jump to a new place (a spawn: the start, a respawn, back to a marker or a crash, off the chairlift) is never drawn
   between, and on the chairlift, where lift.js moves the rider each frame by the wall clock, the rider is drawn as is.
   view is the skier as drawn: its own p, q, v and com, everything else read through from the skier. */
const view = Object.create(skier);
view.p = new THREE.Vector3(); view.q = new THREE.Quaternion(); view.v = new THREE.Vector3(); view.com = new THREE.Vector3();
const was = { p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), com: new THREE.Vector3(), moved: -1 }, _com = new THREE.Vector3();
// the body's middle (what the cameras follow): the physics' own in the air and in a crash, over the feet on the snow
const comOf = (sk, out) => sk.state === 'air' || sk.state === 'crash' ? out.copy(sk.com) : out.set(sk.p.x, sk.p.y + sk.comH(), sk.p.z);
function keepWas() { was.p.copy(skier.p); was.q.copy(skier.q); was.v.copy(skier.v); comOf(skier, was.com); was.moved = skier.moved; }
function drawn(alpha) {
  if (was.moved !== skier.moved || skier.state === 'lift') keepWas();
  view.p.lerpVectors(was.p, skier.p, alpha); view.q.slerpQuaternions(was.q, skier.q, alpha); view.v.lerpVectors(was.v, skier.v, alpha);
  view.com.lerpVectors(was.com, comOf(skier, _com), alpha);
  return view;
}
// the end of a run: the bottom of the park, or far down or away on the mountain
const runOver = () => mtn ? (Math.hypot(skier.p.x, skier.p.z) > 4000 || skier.p.y < -900) : lift ? lift.pastBottom(skier.p) : skier.p.z > 1470;   // (L: past the lift's bottom station)
toStart();

// ---- menu --------------------------------------------------------------------------------------------------------------
function save() { try { localStorage.setItem('ski_opts', JSON.stringify(opts)); } catch (e) {} }
const sel = { scheme: $('scheme'), cammode: $('cammode'), gfx: $('gfx'), poles: $('poles'), rider: $('rider'), map: $('map') };
sel.map.value = opts.map; sel.map.onchange = () => { opts.map = sel.map.value; save(); location.reload(); };
sel.scheme.value = opts.scheme; sel.cammode.value = opts.cam; sel.gfx.value = opts.gfx; sel.poles.value = opts.poles; sel.rider.value = opts.rider; $('showfps').checked = !!opts.showfps;
input.setScheme(opts.scheme); hud.setScheme(opts.scheme); cams.set(opts.cam);
sel.scheme.onchange = () => { opts.scheme = sel.scheme.value; input.setScheme(opts.scheme); hud.setScheme(opts.scheme); save(); };
sel.cammode.onchange = () => { opts.cam = sel.cammode.value; cams.set(opts.cam); save(); };
sel.gfx.onchange = () => { opts.gfx = sel.gfx.value; save(); hud.flash('Graphics change on the next load'); };
sel.poles.onchange = () => { opts.poles = sel.poles.value; rig.setPoles(opts.poles === '1'); save(); };
sel.rider.onchange = () => { if (locker) locker.set('body', sel.rider.value); else { opts.rider = sel.rider.value; save(); loadRider(); } };   // (R: the locker's rider)
const soundBox = $('sound'); soundBox.checked = opts.sound !== false; sound.on = soundBox.checked;
soundBox.onchange = () => { opts.sound = soundBox.checked; sound.on = opts.sound; save(); };
$('showfps').onchange = e => { opts.showfps = e.target.checked; save(); if (!opts.showfps) $('fps').textContent = ''; };
// the home screen's run tiles and controls switch stand for the map and scheme selects (kept, hidden, for the wiring above)
const mark = (sel_, attr, v) => document.querySelectorAll(`[${attr}]`).forEach(b => b.setAttribute('aria-checked', String(b.getAttribute(attr) === v)));
mark(null, 'data-scheme', opts.scheme);
// (F) the mountain, from the home screen's tiles: the Jump Line or Freeride (a change builds the world again)
mark(null, 'data-map', opts.map);
document.querySelectorAll('[data-map]').forEach(b => b.onclick = () => { if (b.dataset.map === opts.map) return; opts.map = b.dataset.map; save(); location.reload(); });
/* What you ride (skis or a snowboard) and, on a board, your stance (regular: left foot forward; goofy: right foot
   forward). applyRide() hands both to the physics and loads the rider for them. */
const stanceSeg = $('stanceseg');
function applyRide() {
  mark(null, 'data-ride', opts.ride); mark(null, 'data-stance', opts.stance);
  stanceSeg.classList.toggle('hidden', opts.ride !== 'board');
  skier.kind = opts.ride; skier.goofy = opts.stance === 'goofy';
  input.setKind(opts.ride);                            // (P: the ride's own trick keys, input.js RIDE_KEYS)
  if (hud.setRide) hud.setRide(opts.ride);            // (B: the grab lists name what you ride's grabs)
  if (touch.setRide) touch.setRide(opts.ride);
}
document.querySelectorAll('[data-ride]').forEach(b => b.onclick = () => { if (b.dataset.ride === opts.ride) return; opts.ride = b.dataset.ride; save(); applyRide(); toStart(); loadRider(); });
document.querySelectorAll('[data-stance]').forEach(b => b.onclick = () => { if (b.dataset.stance === opts.stance) return; opts.stance = b.dataset.stance; save(); applyRide(); toStart(); loadRider(); });
applyRide();
document.querySelectorAll('[data-scheme]').forEach(b => b.onclick = () => { mark(null, 'data-scheme', b.dataset.scheme); sel.scheme.value = b.dataset.scheme; sel.scheme.onchange(); });
let playing = false, paused = false, replay = null, lastEnter = 0, filmHold = false;
const chatOpen = () => document.activeElement && document.activeElement.id === 'chatin';
function play() {
  $('menu').classList.add('hidden'); $('pause').classList.add('hidden'); hud.show(true);
  playing = true; paused = false; sound.start();
  if (opts.scheme === 'mouse') canvas.requestPointerLock?.();
  canvas.focus();
}
function pause() { if (!playing) return; if (replay) { endReplay(); return; } paused = true; $('pause').classList.remove('hidden'); document.exitPointerLock?.(); }
$('play').onclick = play; $('resume').onclick = play;
// ---- replays: the last 15 seconds, recorded every frame, played back through the rider and the filmer camera
const rec = [];
// what the rider is posed from: the physics' state, live or recorded
function poseState(sk, t) {
  return { p: sk.p, q: sk.q, state: sk.state, edge: sk.edge, crouch: sk.crouch, tuck: sk.tuck, brake: sk.brake, press: sk.press, grab: sk.grab, pose: sk.pose,
    sw: sk.sw, speed: sk.v.length(), vel: sk.v, balance: sk.balance || 0, t, tweak: sk.tweak || '', shift: sk.shift || 0, skate: sk.skate || 0, skateT: sk.skateT || 0,
    lazy: sk.lazy || 0, absorb: sk.absorb || 0, landT: sk.landT, lookBack: !!sk.lookBack, railAng: sk.railAng || 0, railPress: sk.railPress || 0, turn: sk.turnRate || 0, slide: sk.slide || 0, tAir: sk.tAir || 0,
    windup: sk.windup || 0, loading: sk.crouchT > 0.06,
    // (P: what you ride, how deep the skis ride in the snow, and the last rail contact: seconds since, 'on' or 'swap', the side it turned to)
    kind: sk.kind || 'ski', goofy: !!sk.goofy, sink: sk.sink || 0, railHitT: sk.railHitT ?? 9, railHit: sk.railHit || '', railHitDir: sk.railHitDir || 0, railKind: sk.rail ? sk.rail.kind : '',
    // (X: the extra rides' timed tricks going round: the trick's id or null, seconds into this round; and a sled's flat spin)
    act: sk.act || null, actT: sk.actT || 0, actN: sk.actN || 0, actNext: !!sk.actNext, flatSpin: sk.flatSpinOn ? 1 : 0,
    // (P, 2026-11-08: one foot or feet together (R / E held), the push stroke, the last takeoff and landing, the crash, the
    // order of tricks (the line's and this air's) and what S or N held will land you into; see scratchpad ski8/P/NOTES.md)
    oneFoot: sk.oneFoot || 0, oneSide: sk.oneSide || 1, together: sk.together || 0, pushT: sk.pushT || 0, pushing: sk.pushing || 0, takeoff: sk.lastTakeoff || null,
    landHit: sk.landHit || 0, landOff: sk.landOff || 0, landUp: sk.landUp || 0, fallT: sk.fallT || 0, fallKind: sk.fallKind || '', trickSeq: sk.trickSeq || [], airSeq: sk.airSeq || [], landInto: sk.landInto || null,
    // (the snow's normal under the rider, from the physics: the rig keeps a crash on the snow with it)
    n: sk.n,
    // (L: on the chairlift, 0 standing at the load or unload line to 1 seated, and the snow under the feet while standing)
    liftSit: lift ? lift.sit : 0, liftFeet: lift && lift.feetOn ? lift.feet : null,
    // (J: which lift, 'chair' or 'tbar' ('' off a lift), and on the T-bar the bar's place: tbar { bar, axis, stem, hand,
    // on, phase }, world Vector3s, see tbar.js. On a T-bar liftSit stays 0 and liftFeet is the snow under the feet.)
    liftKind: sk.state === 'lift' ? sk.liftKind || 'chair' : '', tbar: sk.state === 'lift' && sk.liftKind === 'tbar' && lift && lift.pose ? lift.pose : null };
}
// (each frame as it was drawn, so the replay is as smooth as the riding was; moved: a jump to a new place, never
// played between)
function record(t) {
  const s = poseState(view, t);
  rec.push(Object.assign(s, { p: view.p.clone(), q: view.q.clone(), v: view.v.clone(), vel: view.v.clone(), com: view.com.clone(), n: skier.n.clone(), moved: skier.moved }));
  // (J: the lift's vectors are the lift's own, changed every frame: copies, so a replay shows them as they were)
  if (s.liftFeet) s.liftFeet = s.liftFeet.clone();
  if (s.takeoff) s.takeoff = Object.assign({}, s.takeoff);   // (P: the skier's own, changed in place: copies too)
  if (s.trickSeq.length) s.trickSeq = s.trickSeq.slice(); if (s.airSeq.length) s.airSeq = s.airSeq.slice();
  if (s.tbar) s.tbar = { bar: s.tbar.bar.clone(), axis: s.tbar.axis.clone(), stem: s.tbar.stem.clone(), hand: s.tbar.hand, on: s.tbar.on, phase: s.tbar.phase };
  while (rec.length && rec[0].t < t - 15) rec.shift();
}
/* the replay at time rt: between the two recorded frames either side of it (in slow motion each recorded frame used to
   be shown three or four frames running, then the rider jumped on: a stutter all through the slow replay). Scalars
   come from the nearer frame; the rider's place, turn and velocity are worked out between them. */
const _rp = { p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), com: new THREE.Vector3() };
function replayAt(rt) {
  let i = rec.findIndex(r => r.t >= rt);
  if (i < 0) return null;
  const b = rec[i], a = i > 0 ? rec[i - 1] : b;
  const k = a !== b && a.moved === b.moved && b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
  const r = Object.assign({}, k < 0.5 ? a : b);
  r.p = _rp.p.lerpVectors(a.p, b.p, k); r.q = _rp.q.slerpQuaternions(a.q, b.q, k); r.v = _rp.v.lerpVectors(a.v, b.v, k); r.com = _rp.com.lerpVectors(a.com, b.com, k);
  return r;
}
function startReplay() {
  if (rec.length < 30) { hud.flash('Ride a little first'); return; }
  replay = { t: rec[0].t, slow: false, camWas: cams.mode };
  cams.set('film'); $('pause').classList.add('hidden'); paused = false; hud.flash('Replay: Space slows it down, Esc goes back', 2200);
}
function endReplay() { if (!replay) return; cams.set(replay.camWas); replay = null; rec.length = 0; cams.first = true; rig.p = {}; }
$('toreplay').onclick = startReplay;
addEventListener('keydown', e => { if (replay && e.code === 'Space') { replay.slow = !replay.slow; e.preventDefault(); } });
$('totop').onclick = () => { toStart(); play(); };
// start spots
{
  const box = $('starts');
  for (const s of park.starts) {
    const b = document.createElement('button'); b.textContent = s.name;
    b.onclick = () => { if (s.here) toStart(); else { skier.spawn(s.x, s.z, s.v, s.yaw || 0); skier.safe.length = 0; cams.first = true; } play(); };   // (F: s.yaw)
    box.appendChild(b);
  }
}
$('tomenu').onclick = () => { $('pause').classList.add('hidden'); $('menu').classList.remove('hidden'); $('play').textContent = 'Keep riding'; paused = true; };
addEventListener('keydown', e => { if (e.code === 'Escape' && playing) { paused ? play() : pause(); } });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing && !paused && opts.scheme === 'mouse') pause(); });
canvas.addEventListener('click', () => { if (playing && !paused && opts.scheme === 'mouse' && !document.pointerLockElement) canvas.requestPointerLock?.(); });

const OUTFITS = {
  m_adult_10: { jacket: '#c8392b', pants: '#232b36' }, m_adult_18: { jacket: '#5b6168', pants: '#2e3a2c' }, m_adult_17: { jacket: '#2f5d9e', pants: '#d9d4c7' },
  f_adult_13: { jacket: '#e8e3d6', pants: '#3b2f4a' }, f_adult_14: { jacket: '#c9a227', pants: '#202124' },
};
/* (R) the locker: what the rider wears (locker.js, kept in ski_look); a first visit starts from the Settings rider and its
   outfit. Live colours go straight onto the rider, anything else builds it again; the room hears of it a moment later. */
let lookT = 0;
const locker = new Locker($('locker'), $('locker').closest('details'), loadLook(Object.assign({ body: opts.rider }, OUTFITS[opts.rider] || {})), (look, rebuild) => {
  if (look.body !== opts.rider) { opts.rider = look.body; sel.rider.value = look.body; save(); }
  if (rebuild) loadRider();
  else { if (rig.applyLook) rig.applyLook(look); clearTimeout(lookT); lookT = setTimeout(() => { if (net.inRoom) net.sendLook(opts.rider); }, 600); }
});
if (locker.look.body !== opts.rider) { opts.rider = locker.look.body; sel.rider.value = opts.rider; save(); }
$('locker').closest('details').addEventListener('toggle', () => { cams.first = true; });
async function loadRider() {
  const gen = (loadRider.gen = (loadRider.gen || 0) + 1);       // (B: only the last one asked for is put in)
  const r2 = new Rig();
  await r2.load(opts.rider, { poles: opts.poles === '1', outfit: OUTFITS[opts.rider], look: locker.look, kind: opts.ride || 'ski', goofy: opts.stance === 'goofy' });   // (kind: R, for B's board; look: R's locker)
  r2.update({ p: skier.p, q: skier.q, state: 'ground', edge: 0, crouch: 0.3, tuck: 0, brake: 0, press: 0, sw: false, speed: 0, vel: skier.v, balance: 0, t: 0 }, 0.016);
  mergeGear(r2);
  r2._cp = null; r2.crashPts();                                 // (the parts the snow may not reach in a crash, from the merged gear)
  // (B: its shaders built before it is drawn: a board, or skis again, compiled inside a draw held that frame)
  try { await renderer.compileAsync(r2.root, camera, scene); } catch (e) {}
  if (gen !== loadRider.gen) { r2.dispose(); return; }        // (R: a rider asked for and then not used is freed)
  const old = rig; scene.remove(rig.root); rig = r2; scene.add(rig.root); if (old.dispose && old !== r2) old.dispose();   // (R: the old rider freed)
  // (B: window.__ski.rig is a getter of rig; setting it threw here, after the swap, in a module)
  if (net.inRoom) net.sendLook(opts.rider);                     // (B: the others see the new ride and stance)
}

// ---- riding with others ------------------------------------------------------------------------------------------
const net = new Net({
  scene, camera,
  // (B: another rider's look says what they ride and their stance: look.ride 'ski' | 'board', look.stance)
  makeRig: async (id, look) => { const r = new Rig(); await r.load(id, { poles: true, outfit: OUTFITS[id], look: cleanLook(look), kind: look && Rig.loader[look.ride] ? look.ride : 'ski', goofy: !!(look && look.stance === 'goofy') }); mergeGear(r); r._cp = null; r.crashPts();
    try { await renderer.compileAsync(r.root, camera, scene); } catch (e) {}   // (R: another rider's gear may need shaders of its own: built before it is drawn)
    return r; },
  // (R: and what they wear, from the locker)
  getLook: () => Object.assign({}, locker.look, { ride: opts.ride || 'ski', stance: opts.stance || 'regular', map: opts.map || 'jumpline' }),   // (map: riders on another map are not drawn here)
  onTrick: (who, name, pts) => hud.remoteTrick(who, name, pts),
  onChat: m => hud.chat(m),
  onStatus: t => { $('mpstatus').textContent = t; $('mpleave').classList.toggle('hidden', !net.inRoom && !t.startsWith('Connecting')); },
});
net.map = opts.map || 'jumpline';
if (lift) { net.lift = lift; net.xFns.push(x => lift.netX(x)); }   // (L: riders on the chairlift, in the state's x)
$('mpname').value = opts.name || '';
const mpName = () => { opts.name = $('mpname').value.trim(); save(); return opts.name || 'Rider'; };
$('mppublic').onclick = () => { net.connect(mpName(), opts.rider); play(); };
$('mpprivate').onclick = () => { net.connect(mpName(), opts.rider, { priv: true }); play(); };
$('mpjoin').onclick = () => { const c = $('mpcode').value.trim().toUpperCase(); if (c.length !== 4) { $('mpstatus').textContent = 'A room code has four letters.'; return; } net.connect(mpName(), opts.rider, { code: c }); play(); };
$('mpleave').onclick = () => net.leave();
const chatIn = $('chatin');
addEventListener('keydown', e => {
  if (!playing || paused) return;
  const opener = opts.scheme === 'shred' ? 'KeyT' : 'Enter';
  if (e.code !== 'Enter' && !(e.code === opener && e.target !== chatIn)) return;
  if (e.target === chatIn) {
    if (e.code !== 'Enter') return;
    const t = chatIn.value.trim(); if (t) net.chat(t);
    chatIn.value = ''; chatIn.classList.add('hidden'); canvas.focus();
    if (opts.scheme === 'mouse') canvas.requestPointerLock?.();
  } else if (net.inRoom && e.code === opener) { e.preventDefault(); chatIn.classList.remove('hidden'); chatIn.focus(); }
});
chatIn.addEventListener('keydown', e => { if (e.code === 'Escape') { e.stopPropagation(); chatIn.value = ''; chatIn.classList.add('hidden'); canvas.focus(); } });

// ---- the loop --------------------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
let acc = 0, time = 0, frames = 0, fpsT = 0, fps = 60, prAdj = 0, prSlow = 0, wantPr = 0, prAt = -9, runStart = 0;
const fallLine = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  try { tick(); } catch (e) { console.error(e); }
}
function tick() {
  if (filmHold) { clock.getDelta(); return; }            // a test is stepping the frames itself (__ski.film)
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  const live = playing && !paused && !replay;
  const I = live ? input.read(skier.state === 'air', skier.state === 'rail') : { steer: 0, crouch: false, spin: 0, flip: 0, tilt: 0 };
  if (live) {
    if (input.took(opts.scheme === 'shred' ? 'KeyQ' : 'KeyC')) { opts.cam = cams.next(); sel.cammode.value = opts.cam; save(); hud.flash({ chase: 'Chase camera', far: 'Far chase', pov: 'First person', film: 'Filmer' }[opts.cam], 900); }
    if (opts.scheme !== 'shred' && input.took('KeyR')) { skier.crash('reset'); skier.tState = 9; }
    if (input.took('Backspace')) toStart();
    if (opts.scheme === 'shred') {
      if (input.took('Tab')) hud.flash(skier.setMarker() ? 'Marker set' : 'Set a marker on the snow', 900);
      /* Enter: back to where you last crashed (the run-in a few seconds before it), or to the Tab marker when that was
         set since; pressed again straight away, back to the start (2026-11-03) */
      if (input.took('Enter') && !chatOpen()) {
        // (a second press straight after, and any after that in quick succession, go to the start and stay there; it
        // used to go back to the crash again on a third press)
        const now = performance.now(), again = now - lastEnter < 700;
        lastEnter = now;
        if (again) { toStart(); hud.flash('Back to the start', 900); }
        else {
          const c = skier.crashSpot, m = skier.marker, toM = m && skier.state !== 'crash' && (!c || m.at > c.at);
          if (toM && skier.toMarker()) hud.flash('Back to your marker', 900);
          else if (skier.toCrash()) hud.flash('Back to your last crash', 900);
          else if (skier.toMarker()) hud.flash('Back to your marker', 900);
          else { toStart(); hud.flash('Back to the start', 900); }
        }
        cams.first = true;
      }
    }
    // the mouse scheme: the pointing turns into a wanted direction across the fall line
    if (opts.scheme === 'mouse' && skier.state === 'ground' && !I.steer) {
      const a = (I.mouse || 0) * 1.66;
      skier.mouseTarget = fallLine.set(-Math.sin(a), 0, Math.cos(a));
    } else skier.mouseTarget = null;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) {
      keepWas();                                         // (the state before this step: the frame is drawn between)
      skier.step(STEP, I);
      for (const e of skier.events) {
        if (e.type === 'land') { sound.thump(e.vn); if (e.vn > 4 || skier.surf === 1) spray.burst(skier.p, Math.min(60, Math.round(e.vn * 6)), 1.2 + e.vn * 0.15); }
        if (e.type === 'crash') { sound.crash(); spray.burst(skier.p, 40, 2); }
        if (e.type === 'takeoff' && !e.rail) sound.hit('pop', Math.min(1.5, 0.5 + e.speed / 15));
        // (P) rail contact: the clack and the packed snow flicked off the skis where they meet the rail, on locking on and on each
        // swap (sound.rail / sound.swap and spray.flick are E's; the old hit sound until they exist)
        if (e.type === 'railOn') { const pw = Math.min(1.5, 0.45 + (e.impact || 0) * 0.2 + e.speed * 0.04); if (sound.rail) sound.rail(e.kind, pw); else sound.hit(e.kind === 'box' ? 'box' : 'rail'); if (spray.flick) spray.flick(e.at, e.dir, pw); }
        if (e.type === 'railSwap') { if (sound.swap) sound.swap(e.kind); if (spray.flick) spray.flick(e.at, e.dir, 0.8); }
        if (e.type === 'railOff' && sound.railOff) sound.railOff(e.kind);
        // (R) the rider's knees and arms take each rail jolt
        if ((e.type === 'railOn' || e.type === 'railSwap' || e.type === 'railOff') && rig.react) rig.react(e.type, e.type === 'railOn' ? Math.min(1.2, 0.45 + (e.impact || 0) * 0.2 + (e.speed || 0) * 0.04) : 0.8);
        if (e.type === 'lift' && tricks.combo) tricks.endCombo();
      }
      tricks.step(skier, STEP);
      acc -= STEP; n++; window.__ski && (window.__ski.simT = (window.__ski.simT || 0) + STEP);
    }
    if (n === 8) acc = 0;
    // the bottom: back up on the lift
    if (runOver() && skier.state === 'ground') {
      if (tricks.combo) tricks.endCombo();
      const run = hud.score - runStart; runStart = hud.score;
      const best = Math.max(run, +(opts.best || 0)); if (best !== +(opts.best || 0)) { opts.best = best; save(); }
      hud.flash(`Run: ${run.toLocaleString()} points${run >= best && run > 0 ? ' (your best)' : ` (best ${best.toLocaleString()})`}`, 3200);
      if (!(lift && lift.ready && lift.boardNow(skier))) toStart();   // (L: the end of the run takes you onto the chairlift)
    }
  }
  // (L) the chairlift: the chairs going round, and the rider on one (it sets skier.p, q and v while riding)
  if (lift) lift.update(dt, { skier, input, I, live, paused, solo: !net.inRoom, camera, cams, hud, sound, mouse: opts.scheme === 'mouse', camKey: opts.scheme === 'shred' ? 'KeyQ' : 'KeyC' });   // (camKey: the one key that does not send the chair up)
  let S, camSk, rdt = dt;
  const r = replay ? replayAt(replay.t += dt * (replay.slow ? 0.3 : 1)) : null;
  if (replay && !r) endReplay();                         // (the end of the recording: back to riding)
  if (r) {
    S = Object.assign(r, { speed: r.v.length(), vel: r.v, t: replay.t });
    camSk = { p: r.p, v: r.v, state: r.state, crouch: r.crouch, com: r.com };
    rdt = dt * (replay.slow ? 0.3 : 1);                  // (the rider's own motion in slow motion too)
  } else {
    // the rider between the physics' last two steps (alpha: how far into the next one the clock has run)
    camSk = drawn(Math.min(1, acc / STEP));
    S = poseState(camSk, time);
    if (live) record(time);
  }
  rig.update(S, rdt);
  // the scene's matrices are not walked every frame (most of it never moves): what moves is updated here (unless the
  // rig did it itself this frame, measuring its gear against the snow)
  if (rig._gearW !== rig._frame) for (const o of rig.root.children) if (o !== rig.body) o.updateMatrixWorld(true);
  // (P) on the chairlift the turn keys look round; let go, the camera swings back behind the chair
  // (L: in the mouse scheme the mouse looks round on the chair instead, lift.js lookMouse)
  if (lift && live && skier.state === 'lift' && opts.scheme === 'mouse') lift.lookMouse(cams, input, I, dt);
  else if (skier.state === 'lift' || cams.orbit) cams.lookRound(live && skier.state === 'lift' ? I.steer : 0, dt);
  cams.update(dt, camSk, rig);
  if (lift && !replay) lift.camera(dt, camera, cams, camSk);   // (L: beside the stations a tripod takes over from the chase camera)
  // (R) the locker open on the menu: the camera turns round the rider beside the card
  if (!live && !replay && locker.open && !$('menu').classList.contains('hidden')) locker.preview(camera, rig, dt);
  if (live) { tracks.follow(view.p); tracks.fromSkier(view, rig); spray.fromSkier(view, rig, dt); }
  tracks.flush();
  spray.update(dt, time);
  lodJumps(camera.position);
  sky.follow(camSk.p);                                   // (the shadows' box round the rider as drawn)
  terrain.update(camera.position, frames);
  forest.update(camera.position);
  snowUniforms.uTime.value = time;
  sound.frame(skier);
  // (the others' name tags are put on the screen through this frame's camera: they were a frame behind it, and slid
  // against their riders whenever the camera moved)
  camera.updateMatrixWorld();
  net.update(dt, skier, time);
  hud.frame(skier, opts.showfps ? fps : null);
  /* (2026-11-06, for "random frames where it like blinks": a change of resolution resizes the canvas, which empties it.
     It was made just after the frame was drawn, so that frame went to the screen empty, a black flash about once a
     second while the frame rate sat under 48 or over 58. It is made here, before the draw, and less often: two slow
     seconds in a row to step down, five quick ones in a row to step up, never twice within four seconds.) */
  if (wantPr && time - prAt > 4) { renderer.setPixelRatio(wantPr); prAt = time; }
  wantPr = 0;
  renderer.render(scene, camera);
  // frame rate and resolution
  frames++; fpsT += dt;
  if (fpsT > 1) {
    fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
    const pr = renderer.getPixelRatio();
    prSlow = live && fps < 48 ? prSlow + 1 : 0;
    prAdj = live && fps > 58 ? prAdj + 1 : 0;
    if (prSlow >= 2 && pr > q.pr[0] + 0.01) { wantPr = Math.max(q.pr[0], pr - 0.1); prSlow = 0; }
    else if (prAdj > 4 && pr < q.pr[1] - 0.01) { wantPr = Math.min(q.pr[1], pr + 0.05); prAdj = 0; }
  }
}

// ---- boot ---------------------------------------------------------------------------------------------------------------
(async () => {
  try {
    await loadRider();
    terrain.warm(new THREE.Vector3(skier.p.x, skier.p.y + 3, skier.p.z - 5));
    rig.update({ p: skier.p, q: skier.q, state: 'ground', edge: 0, crouch: 0.2, tuck: 0, brake: 0, press: 0, sw: false, speed: 0, vel: skier.v, balance: 0, t: 0 }, 0.016);
    cams.update(0.016, skier, rig);
    forest.update(camera.position);
    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = !!qs.has('matrixauto');
    if (railsG) await railsG.ready;
    if (liftReady) await liftReady;      // (L)
    await renderer.compileAsync(scene, camera);
    /* (2026-11-06: compileAsync builds the programs things are drawn with, not the shadow pass's own; those were built
       the first time a thing came near enough to cast a shadow on the rider's patch of snow, inside that frame's draw:
       on the high tier the start arch's banner, half way down the first run. Every shadow caster is drawn into the
       shadow map once here, behind the menu, so its shadow program is built now.) */
    {
      const casters = [];
      scene.traverse(o => { if (o.castShadow && o.frustumCulled) { casters.push(o); o.frustumCulled = false; } });
      renderer.render(scene, camera);
      for (const o of casters) o.frustumCulled = true;
    }
    $('play').disabled = false; $('play').textContent = 'Ride';
  } catch (e) {
    console.error(e); $('play').textContent = 'Could not load';
  }
  // (tests: hold the loop, then step physics, the rider, the camera and a draw one frame of dt at a time with inputs I)
  const film = (dt, I, camAt) => {
    filmHold = true;
    const n = Math.max(1, Math.round(dt / STEP)), J = Object.assign({ steer: 0, crouch: false, spin: 0, flip: 0, tilt: 0 }, I || {});
    for (let i = 0; i < n; i++) { skier.step(STEP, J); tricks.step(skier, STEP); skier.events.length = 0; }
    keepWas();                                           // (whole steps: drawn where the physics is)
    time += dt; rig.update(poseState(skier, time), dt);
    if (rig._gearW !== rig._frame) for (const o of rig.root.children) if (o !== rig.body) o.updateMatrixWorld(true);
    if (camAt) camAt(camera, skier); else cams.update(dt, skier, rig);
    lodJumps(camera.position);
    renderer.render(scene, camera);
  };
  window.__ski = { THREE, renderer, scene, camera, skier, film, release: () => { filmHold = false; }, get rig() { return rig; }, park, terrain, tricks, net, input, cams, tracks, spray, q, opts, height, normal, baseLine, play, step: (n, I) => { for (let i = 0; i < n; i++) { skier.step(STEP, Object.assign({ steer: 0, crouch: false, spin: 0, flip: 0, tilt: 0 }, I)); tricks.step(skier, STEP); } keepWas(); }, view };
  window.__ski.lift = lift; window.__ski.net = net;   // (L: test handles)
  clock.getDelta();
  frame();
})();
