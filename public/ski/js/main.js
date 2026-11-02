// Leon Freeski: boot, settings, the frame loop.
import * as THREE from 'three';
import { Terrain, setPark, height, normal, baseLine } from './terrain.js?v=1';
import { makePark, featureMesh, railMeshes } from './park.js?v=1';
import { makeMaterials, snowUniforms } from './materials.js?v=1';
import { makeSky, Forest, makeRanges, makeProps } from './world.js?v=1';
import { Skier } from './skier.js?v=1';
import { Rig } from './rig.js?v=1';
import { Tricks } from './tricks.js?v=1';
import { Input } from './input.js?v=1';
import { Cams } from './camera.js?v=1';
import { Tracks, Spray } from './snow.js?v=1';
import { Hud } from './hud.js?v=1';
import { Sound } from './sound.js?v=1';

const $ = id => document.getElementById(id);
const STEP = 1 / 120;

// ---- settings and graphics tier ------------------------------------------------------------------------------------
const saved = (() => { try { return JSON.parse(localStorage.getItem('ski_opts') || '{}'); } catch (e) { return {}; } })();
const opts = Object.assign({ scheme: 'mouse', cam: 'chase', gfx: 'auto', poles: '1', rider: 'm_adult_10', showfps: false }, saved);
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
  low: { tier: 'low', pr: [0.55, 0.9], start: 0.8, shadows: true, minLeaf: 32, K: 1.05, seg: 16, aa: false, fine: false },
  medium: { tier: 'medium', pr: [0.7, 1.0], start: 1.0, shadows: true, minLeaf: 16, K: 1.2, seg: 20, aa: false, fine: true },
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

const mats = makeMaterials(q);
const park = makePark(); setPark(park);
const sky = makeSky(scene, renderer, q);
const terrain = new Terrain(scene, mats.snow, { minLeaf: q.minLeaf, K: q.K, seg: q.seg, budget: q.tier === 'low' ? 3 : 4 });
for (const f of [...park.kickers, park.pipe]) scene.add(featureMesh(f, height, mats.snow, q.fine));
scene.add(railMeshes(park.rails, mats));
const forest = new Forest(scene, q);
makeRanges(scene, q);
makeProps(scene, park, q);
const tracks = new Tracks(renderer, q);
const spray = new Spray(scene, q);

const skier = new Skier(park);
let rig = new Rig(); scene.add(rig.root);
const hud = new Hud();
const tricks = new Tricks(t => hud.trick(t));
const input = new Input(canvas);
const cams = new Cams(camera, park);
const sound = new Sound();

const START = { x: -16, z: -30, v: 5 };
skier.spawn(START.x, START.z, START.v, 0);

// ---- menu --------------------------------------------------------------------------------------------------------------
function save() { try { localStorage.setItem('ski_opts', JSON.stringify(opts)); } catch (e) {} }
const sel = { scheme: $('scheme'), cammode: $('cammode'), gfx: $('gfx'), poles: $('poles'), rider: $('rider') };
sel.scheme.value = opts.scheme; sel.cammode.value = opts.cam; sel.gfx.value = opts.gfx; sel.poles.value = opts.poles; sel.rider.value = opts.rider; $('showfps').checked = !!opts.showfps;
input.setScheme(opts.scheme); hud.setScheme(opts.scheme); cams.set(opts.cam);
sel.scheme.onchange = () => { opts.scheme = sel.scheme.value; input.setScheme(opts.scheme); hud.setScheme(opts.scheme); save(); };
sel.cammode.onchange = () => { opts.cam = sel.cammode.value; cams.set(opts.cam); save(); };
sel.gfx.onchange = () => { opts.gfx = sel.gfx.value; save(); hud.flash('Graphics change on the next load'); };
sel.poles.onchange = () => { opts.poles = sel.poles.value; rig.setPoles(opts.poles === '1'); save(); };
sel.rider.onchange = () => { opts.rider = sel.rider.value; save(); loadRider(); };
$('showfps').onchange = e => { opts.showfps = e.target.checked; save(); if (!opts.showfps) $('fps').textContent = ''; };
let playing = false, paused = false;
function play() {
  $('menu').classList.add('hidden'); $('pause').classList.add('hidden'); hud.show(true);
  playing = true; paused = false; sound.start();
  if (opts.scheme === 'mouse') canvas.requestPointerLock?.();
  canvas.focus();
}
function pause() { if (!playing) return; paused = true; $('pause').classList.remove('hidden'); document.exitPointerLock?.(); }
$('play').onclick = play; $('resume').onclick = play;
$('totop').onclick = () => { skier.spawn(START.x, START.z, START.v, 0); cams.first = true; play(); };
$('tomenu').onclick = () => { $('pause').classList.add('hidden'); $('menu').classList.remove('hidden'); $('play').textContent = 'Keep riding'; paused = true; };
addEventListener('keydown', e => { if (e.code === 'Escape' && playing) { paused ? play() : pause(); } });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing && !paused && opts.scheme === 'mouse') pause(); });
canvas.addEventListener('click', () => { if (playing && !paused && opts.scheme === 'mouse' && !document.pointerLockElement) canvas.requestPointerLock?.(); });

async function loadRider() {
  const outfits = {
    m_adult_10: { jacket: '#c8392b', pants: '#232b36' }, m_adult_18: { jacket: '#5b6168', pants: '#2e3a2c' }, m_adult_17: { jacket: '#2f5d9e', pants: '#d9d4c7' },
    f_adult_13: { jacket: '#e8e3d6', pants: '#3b2f4a' }, f_adult_14: { jacket: '#c9a227', pants: '#202124' },
  };
  const r2 = new Rig();
  await r2.load(opts.rider, { poles: opts.poles === '1', outfit: outfits[opts.rider] });
  scene.remove(rig.root); rig = r2; scene.add(rig.root);
  if (window.__ski) window.__ski.rig = rig;
}

// ---- the loop --------------------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
let acc = 0, time = 0, frames = 0, fpsT = 0, fps = 60, prAdj = 0;
const fallLine = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  try { tick(); } catch (e) { console.error(e); }
}
function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  const live = playing && !paused;
  const I = live ? input.read(skier.state === 'air', skier.state === 'rail') : { steer: 0, crouch: false, spin: 0, flip: 0, tilt: 0 };
  if (live) {
    if (input.took('KeyC')) { opts.cam = cams.next(); sel.cammode.value = opts.cam; save(); hud.flash({ chase: 'Chase camera', far: 'Far chase', pov: 'First person', film: 'Filmer' }[opts.cam], 900); }
    if (input.took('KeyR')) { skier.crash('reset'); skier.tState = 9; }
    if (input.took('Backspace')) { skier.spawn(START.x, START.z, START.v, 0); cams.first = true; }
    // the mouse scheme: the pointing turns into a wanted direction across the fall line
    if (opts.scheme === 'mouse' && skier.state === 'ground' && !I.steer) {
      const a = (I.mouse || 0) * 1.66;
      skier.mouseTarget = fallLine.set(-Math.sin(a), 0, Math.cos(a));
    } else skier.mouseTarget = null;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) {
      skier.step(STEP, I);
      for (const e of skier.events) {
        if (e.type === 'land') { sound.thump(e.vn); if (e.vn > 4 || skier.surf === 1) spray.burst(skier.p, Math.min(60, Math.round(e.vn * 6)), 1.2 + e.vn * 0.15); }
        if (e.type === 'crash') { sound.thump(8); spray.burst(skier.p, 40, 2); }
      }
      tricks.step(skier, STEP);
      acc -= STEP; n++; window.__ski && (window.__ski.simT = (window.__ski.simT || 0) + STEP);
    }
    if (n === 8) acc = 0;
    // the bottom: back up on the lift
    if (skier.p.z > 1470 && skier.state === 'ground') { if (tricks.combo) tricks.endCombo(); hud.flash('Run done. Back to the top.'); skier.spawn(START.x, START.z, START.v, 0); cams.first = true; }
  }
  const S = { p: skier.p, q: skier.q, state: skier.state, edge: skier.edge, crouch: skier.crouch, tuck: skier.tuck, brake: skier.brake, press: skier.press, grab: skier.grab, pose: skier.pose,
    sw: skier.sw, speed: skier.v.length(), vel: skier.v, balance: skier.balance, t: time };
  rig.update(S, dt);
  cams.update(dt, skier, rig);
  if (live) { tracks.follow(skier.p); tracks.fromSkier(skier, rig); spray.fromSkier(skier, rig, dt); }
  tracks.flush();
  spray.update(dt, time);
  sky.follow(skier.p);
  terrain.update(camera.position, frames);
  forest.update(camera.position);
  snowUniforms.uTime.value = time;
  sound.frame(skier);
  hud.frame(skier, opts.showfps ? fps : null);
  renderer.render(scene, camera);
  // frame rate and resolution
  frames++; fpsT += dt;
  if (fpsT > 1) {
    fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
    const pr = renderer.getPixelRatio();
    if (live && fps < 48 && pr > q.pr[0] + 0.01) renderer.setPixelRatio(Math.max(q.pr[0], pr - 0.1));
    else if (live && fps > 58 && pr < q.pr[1] - 0.01 && ++prAdj > 4) { renderer.setPixelRatio(Math.min(q.pr[1], pr + 0.05)); prAdj = 0; }
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
    await renderer.compileAsync(scene, camera);
    $('play').disabled = false; $('play').textContent = 'Ride';
  } catch (e) {
    console.error(e); $('play').textContent = 'Could not load';
  }
  window.__ski = { THREE, renderer, scene, camera, skier, get rig() { return rig; }, park, terrain, tricks, input, cams, tracks, spray, q, opts, height, normal, baseLine, play, step: (n, I) => { for (let i = 0; i < n; i++) { skier.step(STEP, Object.assign({ steer: 0, crouch: false, spin: 0, flip: 0, tilt: 0 }, I)); tricks.step(skier, STEP); } } };
  clock.getDelta();
  frame();
})();
