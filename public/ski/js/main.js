// Leon Freeski: boot, settings, the frame loop.
import * as THREE from 'three';
import { Terrain, setPark, setMountain, height, normal, baseLine } from './terrain.js?v=24';
import { makePark, makeJumpLine, emptyPark, featureMeshSteps, railMeshes } from './park.js?v=24';
import { makeMaterials, snowUniforms, rockFieldAfter } from './materials.js?v=24';
import { makeSky, Forest, makeRanges, makeMountainRanges, makeProps } from './world.js?v=24';
import { Mountain, SPOTS } from './dem.js?v=24';
import { Skier } from './skier.js?v=24';
import { Rig, prefetchRider } from './rig.js?v=24';
import './board.js?v=24';                 // (B: registers the snowboard with the rig: Rig.loader.board, Rig.poser.board)
// (B: the snow scooter and snowbike (scoot.js: Rig.loader.scoot / bike, Rig.poser.scoot / bike) and the sled (sled.js:
// Rig.loader.sled, Rig.poser.sled) register the same way; C, 2026-11-11, loading: they come in when a ride needs them,
// yours or another rider's (needRide below), not with the game's first files)
import { Tricks } from './tricks.js?v=24';
import { Input } from './input.js?v=24';
import { Cams } from './camera.js?v=24';
import { Tracks, Spray } from './snow.js?v=24';
import { Hud } from './hud.js?v=24';
import { Sound } from './sound.js?v=24';
import { Net } from './net.js?v=24';
import { mergeGear } from './gear.js?v=24';
import { shadowOnly } from './shadowproxy.js?v=24';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Touch, TOUCH_GRABS } from './touch.js?v=24';
import { Locker, loadLook, cleanLook } from './locker.js?v=24';
// (C, 2026-11-11, loading: the map's own modules come in below, only for that map: the chairlift (L: lift.js), the
// Freeride mountain (F: freeride.js, frrock.js) on Freeride, the T-bar (J: tbar.js) on the Jump Line)
import { Online } from './online.js?v=24';            // (M: the home screen's online buttons, and watching others)

const $ = id => document.getElementById(id);
const STEP = 1 / 120;
// (C, 2026-11-11, loading) the scooter's, the bike's and the sled's modules, fetched the first time a ride needs them
const RIDE_MODS = { scoot: './scoot.js?v=24', bike: './scoot.js?v=24', sled: './sled.js?v=24' };
const needRide = kind => RIDE_MODS[kind] ? import(RIDE_MODS[kind]).catch(e => console.warn('ride', kind, e)) : Promise.resolve();
/* (C, 2026-11-11, for "leonski never loads on chromebook and takes too long to load") The start-up's progress bar and
   failures are index.html's (__skiBoot, there before any module): step(label, share) shows a step and gives the page a
   moment to draw it and to answer between the heavy parts; soft(promise, ms, what) waits for something with a time
   limit, and goes on without it (null) when it fails or takes too long, so nothing at the start waits for ever. */
const BOOT = window.__skiBoot || { step: () => Promise.resolve(), ready() {}, fail(m) { console.error(m); } };
const step = (label, share) => BOOT.step(label, share);
// (a test handle: when each part of the start was done, ms from the page's start)
const bootT = window.__skiBootT = {}, bt = k => { bootT[k] = Math.round(performance.now()); try { performance.mark('ski:' + k); } catch (e) {} };
const soft = (p, ms, what) => !p ? Promise.resolve(null) : new Promise(res => {
  const t = setTimeout(() => { console.warn(what, 'took longer than', ms, 'ms: going on without it'); res(null); }, ms);
  Promise.resolve(p).then(v => { clearTimeout(t); res(v === undefined ? true : v); }, e => { clearTimeout(t); console.warn(what, e); res(null); });
});

// ---- settings and graphics tier ------------------------------------------------------------------------------------
const saved = (() => { try { return JSON.parse(localStorage.getItem('ski_opts') || '{}'); } catch (e) { return {}; } })();
const opts = Object.assign({ scheme: 'shred', cam: 'chase', gfx: 'auto', poles: '1', rider: 'm_adult_10', showfps: false, map: 'jumpline', ride: 'ski', stance: 'regular' }, saved);
// (2026-11-12, Leon: "remove the mouse controller thing") only Keyboard and Shredsauce are offered; a saved or asked-for
// mouse scheme (or anything else) rides with Shredsauce's keys. The mouse code stays in input.js, never reached.
{ const qsc = new URLSearchParams(location.search).get('scheme'); if (qsc) opts.scheme = qsc; }
if (opts.scheme !== 'keys' && opts.scheme !== 'shred') opts.scheme = 'shred';
// only the Jump Line is offered for now (Leon, 2026-11-05: "Remove mamoth map for now and also remove the other map as well
// just keep jump line for now"); the other maps stay in the code and open with ?map= for tests
// (F, 2026-11-06: and Freeride, the made-up big-mountain face, picked on the home screen)
if (opts.map !== 'freeride') opts.map = 'jumpline';
const qs = new URLSearchParams(location.search);
if (qs.get('gfx')) opts.gfx = qs.get('gfx');
function detectTier() {
  const ua = navigator.userAgent, mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua), lowDevice = /CrOS/.test(ua) || mem <= 4 || cores <= 2 || mobile;
  let gpu = '', known = false;
  // (C, 2026-11-11: the graphics chip's name is kept from the last visit in this browser; asking for it made a WebGL
  // context of its own and threw it away, a quarter of a second on a slow processor, every visit)
  // (2026-11-12: and on a first visit it is asked for only when it can change the tier: a Chromebook, a phone or a small
  // machine is the Low tier whatever its chip, and that throwaway context cost 0.4 s on a slow processor; then the
  // game's own context gives the name, just after the renderer is made, below)
  let kept = null; try { kept = JSON.parse(localStorage.getItem('ski_gpu') || 'null'); } catch (e) {}
  if (kept && kept.ua === ua && typeof kept.gpu === 'string') { gpu = kept.gpu; known = true; }
  else if (!lowDevice && opts.gfx === 'auto') {
    try { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; gl && gl.getExtension('WEBGL_lose_context')?.loseContext(); known = true; } catch (e) {}
    try { localStorage.setItem('ski_gpu', JSON.stringify({ ua, gpu })); } catch (e) {}
  }
  const soft = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu);
  if (lowDevice || soft || (/Intel/i.test(gpu) && /(HD|UHD) Graphics/i.test(gpu) && cores <= 4)) return { tier: 'low', soft, known };
  if (/Intel/i.test(gpu) || mem <= 8) return { tier: 'medium', soft, known };
  return { tier: 'high', soft, known };
}
/* (2026-11-12, for "improving loading time") a map's plan: what its start works out that is the same every time and
   costly on a slow processor: where the Jump Line's jumps go (park.js makeJumpLine, about a third of a second there),
   Freeride's rock kickers' searches (freeride.js makeFreeride, about 0.4 s). Kept in localStorage and shipped in
   data/<map>.json, each with a fingerprint of the code that makes it (the files below, as this page has them): used
   only when that matches, so a change to that code is worked out again, never mistaken. Asked for at once, beside the
   downloads; null when there is none to use. */
const PLANS = {
  jumpline: { key: 'ski_jlplan', files: ['./park.js?v=24', './terrain.js?v=24', './noise.js?v=24'] },
  freeride: { key: 'ski_frplan', files: ['./freeride.js?v=24', './frland.js?v=24', './park.js?v=24', './terrain.js?v=24', './noise.js?v=24'] },
};
function codePrint(texts) {
  let h = 0x811c9dc5, n = 0;
  for (const t of texts) for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c === 13) continue; h ^= c; h = Math.imul(h, 16777619); n++; }   // (the same for any line ends)
  return (h >>> 0).toString(36) + '.' + n;
}
const planMap = qs.get('map') || opts.map, PL = qs.has('noplan') ? null : PLANS[planMap];   // (?noplan: worked out every time, for tests)
const planP = PL ? (async () => {
  try {
    const texts = await Promise.all(PL.files.map(f => fetch(new URL(f, import.meta.url), { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.text(); })));
    const print = codePrint(texts);
    try { const k = JSON.parse(localStorage.getItem(PL.key) || 'null'); if (k && k.print === print && k.plan) return { print, plan: k.plan }; } catch (e) {}
    try { const r = await fetch(new URL('../data/' + planMap + '.json?v=24', import.meta.url)); if (r.ok) { const d = await r.json(); if (d && d.print === print && d.plan) return { print, plan: d.plan, keep: true }; } } catch (e) {}
    return { print, plan: null };
  } catch (e) { return null; }
})() : null;
// (a plan worked out here, or the shipped one, is kept for the next start: no download then)
const keepPlan = (got, plan) => { if (got && got.print && (!got.plan || got.keep) && plan) { try { localStorage.setItem(PL.key, JSON.stringify({ print: got.print, plan })); } catch (e) {} } };
const det = detectTier();
const tier = opts.gfx === 'auto' ? det.tier : opts.gfx;
// (2026-11-12) Freeride's rock faces: their worker starts now, beside the rest of the start (rockP, below)
let rockWorker = null;
if ((qs.get('map') || opts.map) === 'freeride') {
  try { const w = rockWorker = new Worker(new URL('./frrockworker.js?v=24', import.meta.url), { type: 'module' }); w.onerror = () => { w.failed = true; }; w.postMessage({ low: tier === 'low' }); } catch (e) { rockWorker = null; }
}
const Q = {
  // (E, 2026-11-08, the lag pass: bigger terrain patches split later, the same detail on the screen in about a third
  // fewer draws; mtnLeaf: the smallest patch on a mountain map, Freeride's, never coarser near the rider than before)
  low: { tier: 'low', pr: [0.55, 0.9], start: 0.8, shadows: true, minLeaf: 64, mtnLeaf: 32, K: 0.56, seg: 32, aa: false, fine: false },
  medium: { tier: 'medium', pr: [0.7, 1.0], start: 1.0, shadows: true, minLeaf: 32, mtnLeaf: 16, K: 0.75, seg: 32, aa: false, fine: true },
  high: { tier: 'high', pr: [0.8, Math.min(1.5, devicePixelRatio || 1)], start: Math.min(1.25, devicePixelRatio || 1), shadows: true, minLeaf: 16, K: 1.4, seg: 28, aa: true, fine: true },
}[tier] || null;
const q = Q || { tier: 'medium', pr: [0.7, 1], start: 1, shadows: true, minLeaf: 16, K: 1.6, aa: false, fine: true };

// ---- renderer and scene ----------------------------------------------------------------------------------------------
const canvas = $('view');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: q.aa, powerPreference: 'high-performance', stencil: false }); }
catch (e) {
  // (C, 2026-11-11: no WebGL 2 here, so no game; it used to say Loading for ever)
  BOOT.fail('This browser could not start the game\'s 3D graphics (WebGL 2).', 'In Chrome: Settings, System, turn on "Use graphics acceleration when available", then restart Chrome. If it was on, restarting Chrome or the Chromebook often brings the graphics back.');
  throw e;
}
// (2026-11-12) the chip's name from the game's own context when it was not known (kept for the next visit)
if (!det.known) {
  try { const gl = renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info'), gpu = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; det.soft = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu); localStorage.setItem('ski_gpu', JSON.stringify({ ua: navigator.userAgent, gpu })); } catch (e) {}
}
if (det.soft) { q.pr = [0.3, 0.5]; q.start = 0.35; q.shadows = false; }   // (C, 2026-11-11: drawn by the processor, smaller: 6.4 frames a second at 0.35 under SwiftShader against 4.6 at 0.5)
// (C, 2026-11-11, loading) the downloads the start needs, begun now, before the world is built, so the network works
// while the processor builds: the rider's model (the Low tier's lighter copy), its mask, its gear, the model decoder
q.lo = q.tier === 'low';
{ const L0 = loadLook({ body: opts.rider }); try { prefetchRider(L0.body || opts.rider, L0, opts.ride || 'ski', q.lo); } catch (e) { console.warn('prefetch', e); } }
renderer.setPixelRatio(q.start);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = q.shadows; renderer.shadowMap.type = q.tier === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.15, 20000);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
/* (C, 2026-11-11) the graphics card reset (a Chromebook's graphics process starting again, often after running short of
   memory): three.js puts everything back when the browser gives the context back; meanwhile, and if it never does, a
   note says what happened instead of a frozen or black screen */
{
  let note = null, t = 0;
  const say = (text, reload) => {
    if (!note) { note = document.createElement('div'); note.id = 'gfxnote'; note.setAttribute('role', 'status'); document.body.appendChild(note); }
    note.textContent = text; note.classList.remove('hidden');
    if (reload) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Reload'; b.onclick = () => location.reload(); note.appendChild(b); }
  };
  canvas.addEventListener('webglcontextlost', () => {
    try { pause(); } catch (e) {}                   // (riding on blind is no fun: paused until they are back)
    say('The graphics were reset. Waiting for them to come back...');
    clearTimeout(t); t = setTimeout(() => say('The graphics did not come back.', true), 8000);
  });
  canvas.addEventListener('webglcontextrestored', () => { clearTimeout(t); if (note) note.classList.add('hidden'); });
}

// the map: the terrain park, or a real mountain from open elevation data
if (qs.get('map')) opts.map = qs.get('map');
await step(opts.map === 'freeride' ? 'Building the mountain' : 'Building the jumps', 0.28);
// (C: the map's own modules, see the imports)
// (one that does not come down: the page is tried once more by itself, then says so, as for the first files)
bt('step1');
const mapMod = u => import(u).catch(e => { if (BOOT.noModule) BOOT.noModule(); throw e; });
const [LM, TM, FM, RM] = await Promise.all([opts.map === 'freeride' ? mapMod('./lift.js?v=24') : {}, opts.map === 'jumpline' ? mapMod('./tbar.js?v=24') : {},
  opts.map === 'freeride' ? mapMod('./freeride.js?v=24') : {}, opts.map === 'freeride' ? mapMod('./frrock.js?v=24') : {}, needRide(opts.ride)]);   // (and your ride's own module, when it is not skis or a board)
const { planLift, Lift } = LM, { planTbar, Tbar } = TM, { makeFreeride } = FM, { buildRock, buildJibs } = RM;
bt('imports');
let mtn = null;
if (SPOTS[opts.map]) {
  $('play').textContent = 'Loading the mountain...';
  try { mtn = await new Mountain(SPOTS[opts.map]).load(q.tier === 'low' ? 3 : 4, 3); setMountain(mtn); }
  catch (e) { console.warn('mountain', e); mtn = null; opts.map = 'park'; }
}
const mats = makeMaterials(q); bt('mats');
// (2026-11-12: the park map's rock field, which shows no rock there, is worked out after the start: bootDone)
let bootDone; const booted = new Promise(r => { bootDone = r; });
if (!mtn && opts.map !== 'freeride') rockFieldAfter(booted.then(() => new Promise(r => setTimeout(r, 1500))));
// (F) Freeride: its land through the mountain hook (setMountain, inside makeFreeride) and a park of its own
const mapPlan = !mtn && PL && (opts.map === 'jumpline' || opts.map === 'freeride') ? await soft(planP, 4000, 'plan') : null; bt('plan');
const fr = !mtn && opts.map === 'freeride' ? makeFreeride(q, mapPlan && mapPlan.plan) : null;
if (fr) keepPlan(mapPlan, fr.plan);
/* (2026-11-12, for "improving loading time": Freeride's rock faces, about 3.7 s of the start on a slow processor, are
   worked out by a module worker (frrockworker.js, frrockgeo.js) while the page builds the rest: started as soon as the
   tier is known (rockWorker, above), sent the jibs' rock slabs now (frrock.js slabArrays). If the worker cannot start
   or fails, the page makes them itself, as before.) */
const rockP = fr && rockWorker ? new Promise(res => {
  const w = rockWorker;
  if (w.failed) { w.terminate(); res(null); return; }   // (its module did not load: made here)
  w.onmessage = e => { w.terminate(); const r = e.data && e.data.r || null; if (r) window.__skiRockMs = Math.round(r.ms); res(r); };   // (__skiRockMs: a test handle)
  w.onerror = e => { console.warn('rock worker', e && e.message); w.terminate(); res(null); };
  try { w.postMessage({ slabs: RM.slabArrays(fr.land) }); } catch (e) { w.terminate(); res(null); }
}) : null;
if (rockWorker && !fr) rockWorker.terminate();
const park = fr ? fr.park : mtn ? emptyPark() : opts.map === 'jumpline' ? makeJumpLine(mapPlan && mapPlan.plan) : makePark(); setPark(park);
if (!fr && opts.map === 'jumpline') keepPlan(mapPlan, park.plan);
bt('park');
// (L) the chairlift beside the Jump Line: where it goes, and the flat snow under its stations (added to the park's height
// before the terrain is built)
const liftPlan = (fr || !mtn && opts.map === 'jumpline') && !qs.has('nolift') ? (fr ? planLift : planTbar)(park) : null;   // (F: Freeride's runs from its base to the ridge, park.liftLine)   // (?nolift: without it, for tests)   // (J: the Jump Line's is a T-bar, tbar.js)
await step('Lighting the sky', 0.42);
const sky = makeSky(scene, renderer, q, !!mtn);
await step('Laying the snow', 0.47);
const terrain = new Terrain(scene, mats.snow, { minLeaf: q.minLeaf, mtnLeaf: q.mtnLeaf, K: q.K, seg: q.seg, budget: q.tier === 'low' ? 3 : 4, far: q.tier === 'low' ? 2000 : 2600, root: mtn ? { x0: -4096, z0: -4096, size: 8192 } : null });
const terrainBudget = terrain.budget;
const jumpLods = [], JUMP_FAR = q.tier === 'low' ? 110 : 150;
/* (2026-11-06, the lag pass: a jump's three takeoffs side by side are one mesh and one draw call; they were one each,
   21 on the Jump Line. Each jump is still left out when it is out of view.)
   (2026-11-12, for "improving loading time": only the jumps near the start are built before Ride can be pressed; the
   others are built after it, nearest first, a few milliseconds a frame (later() below), and the far copies after them.
   A jump's mesh is only its look: what the riding reads is the park's own height functions, there from the start.) */
const jumpGroups = (() => {
  const groups = new Map();
  for (const f of [...park.kickers, park.pipe, park.qp].filter(Boolean)) {
    const key = (/^Jump \d+/.exec(f.name || '') || [f.group || f.name || 'feature'])[0];   // (F: Freeride's kickers are one group)
    if (!groups.has(key)) groups.set(key, { key, fs: [] });
    groups.get(key).fs.push(f);
  }
  // nearest the start first (by the features' own boxes on the ground)
  const sx = park.starts[0].x, sz = park.starts[0].z, far = G => Math.min(...G.fs.map(f => Math.hypot(Math.max(0, f.x0 - sx, sx - f.x1), Math.max(0, (f.zs ?? f.z0) - sz, sz - f.z1))));
  for (const G of groups.values()) G.d = far(G);
  return [...groups.values()].sort((a, b) => a.d - b.d);
})();
// one jump's mesh, built a row at a time (park.js featureMeshSteps); its far copy comes later (farCopy)
function* buildJump(G, now) {
  const ms = [];
  for (const f of G.fs) ms.push(yield* featureMeshSteps(f, height, mats.snow, q.fine));
  yield;
  const g = ms.length > 1 ? mergeGeometries(ms.map(m => m.geometry), false) : null;
  if (!g) { for (const m of ms) { m.updateMatrix(); m.updateMatrixWorld(); showWhenReady(m, now); } return; }
  for (const m of ms) m.geometry.dispose();
  const m = new THREE.Mesh(g, mats.snow);
  m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.name = G.key;
  m.updateMatrixWorld();
  showWhenReady(m, now);
  /* (2026-11-06, the lag pass: looking down the Jump Line every jump was drawn in full, about 23 000 triangles each on
     the low tier, 55 000 on the others. Past jumpLods' distance a jump is drawn from a copy with its rows and columns
     thinned out (park.js featureMesh), a third of the triangles; out there the two differ by a pixel or so.) */
  const fs = G.fs.filter(f => /^Jump \d+/.test(f.name || ''));
  if (fs.length) { g.computeBoundingBox(); jumpLods.push({ near: m, far: null, fs, key: G.key, box: g.boundingBox, isFar: false }); }
}
// a jump's far copy (until it is there, the jump is drawn from its near copy)
function* farCopy(J) {
  if (J.far) return;
  const gs = [];
  for (const f of J.fs) gs.push((yield* featureMeshSteps(f, height, mats.snow, q.fine, q.fine ? 0.3 : 0.35)).geometry);
  yield;
  const fg = mergeGeometries(gs, false);
  if (!fg) return;
  const far = new THREE.Mesh(fg, mats.snow);
  far.receiveShadow = true; far.castShadow = false; far.matrixAutoUpdate = false; far.name = J.key + ' far'; far.visible = false;
  far.updateMatrixWorld();
  showWhenReady(far, false, () => { J.far = far; });
}
/* things put in the scene after the start: their shaders built first (compileAsync, which costs nothing when they are
   built already, as the snow's is for every jump after the first), then shown; now: at the start, in at once (the
   start compiles everything in the scene before Ride) */
function showWhenReady(o, now, then) {
  const put = () => { scene.add(o); if (scene.matrixWorldAutoUpdate === false) o.updateMatrixWorld(true); if (then) then(); };
  if (now) { put(); return; }
  Promise.resolve(renderer.compileAsync(o, camera, scene)).catch(() => {}).then(put);
}
/* (2026-11-12, for "improving loading time") the programs everything under root is drawn with, and the shadow pass's
   own for what casts a shadow, asked for a few meshes at a time and built by the graphics driver beside the page (none
   built inside a draw): resolves once every one is linked. The shadow pass draws each caster with a depth material of a
   variant of its own (WebGLShadowMap.getDepthMaterial: the mesh's customDepthMaterial, else a MeshDepthMaterial with
   RGBA packing, taking the mesh material's side, map, alpha map and alpha test) into its shadow map (no tone mapping,
   linear colours) and with no fog; each caster is given such a material for a moment and compiled that way, so the
   shadow pass finds its programs already built. (Until now every caster was drawn into the shadow map once at the start,
   which built those programs one after another, waiting on each: about 0.7 s on a slow processor.) Things drawn only
   into the shadow map (shadowproxy.js, and layer 5's stand-ins) need no program of their own for the view. */
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const depthMats = new Map(), _progRT = new THREE.WebGLRenderTarget(4, 4);
function buildPrograms(root = scene) {
  const view = [], deep = [];
  root.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!shadowOnly.has(o) && o.layers.mask !== 32) view.push(o);
    if (o.castShadow && renderer.shadowMap.enabled && !o.isSprite) for (const m of mats) {
      if (!m || !m.visible) continue;
      const side = m.shadowSide != null ? m.shadowSide : SHADOW_SIDE[m.side], at = m.alphaToCoverage === true ? 0.5 : m.alphaTest;
      let d = o.customDepthMaterial;
      if (!d) {
        const key = [side, m.wireframe ? 'w' : '', m.map ? 'm' + m.map.channel : '', m.alphaMap ? 'a' + m.alphaMap.channel : '', at > 0 ? 't' : '', m.displacementMap ? 'd' : ''].join(',');
        d = depthMats.get(key);
        if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depthMats.set(key, d); }
      }
      d.side = side; d.wireframe = !!m.wireframe; d.alphaMap = m.alphaMap; d.alphaTest = at; d.map = m.map;
      d.displacementMap = m.displacementMap; d.displacementScale = m.displacementScale; d.displacementBias = m.displacementBias;
      deep.push([o, d]);
    }
  });
  const asked = new Set(), list = a => ({ traverse: f => { for (const o of a) f(o); }, traverseVisible() {} });
  const add = set => { for (const m of set) asked.add(m); };
  // (a mesh with two materials casting goes in two rounds)
  const rounds = [];
  for (const [o, d] of deep) { let r = rounds.find(x => !x.has(o)); if (!r) rounds.push(r = new Map()); r.set(o, d); }
  // (asked for a few meshes at a time, a moment for the page between (yieldNow): each new program is some milliseconds
  // of the page's own work, and the whole scene's in one go was a task of half a second to a second on a slow processor)
  const N = 10, batches = [];
  for (let i = 0; i < view.length; i += N) batches.push([view.slice(i, i + N), null]);
  for (const r of rounds) { const ks = [...r.keys()]; for (let i = 0; i < ks.length; i += N) batches.push([ks.slice(i, i + N), r]); }
  return (async () => {
    let t = performance.now();
    for (const [objs, r] of batches) {
      if (!r) { try { add(renderer.compile(list(objs), camera, scene)); } catch (e) { console.warn('programs', e); } }
      else {
        const prev = renderer.getRenderTarget(), fog = scene.fog, back = [];
        try {
          renderer.setRenderTarget(_progRT); scene.fog = null;
          for (const o of objs) { back.push([o, o.material]); o.material = r.get(o); }
          add(renderer.compile(list(objs), camera, scene));
        } catch (e) { console.warn('shadow programs', e); }
        finally { for (const [o, m] of back) o.material = m; scene.fog = fog; renderer.setRenderTarget(prev); }
      }
      if (performance.now() - t > 12) { await yieldNow(); t = performance.now(); }
    }
    // every one linked (asked of the driver every 10 ms; without the parallel compile extension they are already)
    return new Promise(res => {
      const check = () => {
        for (const m of asked) { const p = renderer.properties.get(m); if (!p.programs) { asked.delete(m); continue; } let ok = true; for (const pr of p.programs.values()) if (!pr.isReady()) { ok = false; break; } if (ok) asked.delete(m); }
        if (!asked.size) res(true); else setTimeout(check, 10);
      };
      check();
    });
  })();
}
// a moment for the page: a message to itself (while a page loads, its timers wait behind the loading's own work)
const _yc = new MessageChannel(), _yq = [];
_yc.port1.onmessage = () => { const q = _yq.splice(0); for (const f of q) f(); };
const yieldNow = () => new Promise(r => { _yq.push(r); _yc.port2.postMessage(0); });
/* (2026-11-12) the work left for after the start: generators run a few milliseconds a frame (more while the menu is
   up), first in, first done. later(gen) queues one; runLater(ms) works on them until the clock has run ms. */
const laterQ = [];
const later = gen => { laterQ.push(gen); return gen; };
window.__skiLater = () => laterQ.length;              // (a test handle: how much is left)
function runLater(ms) {
  const until = performance.now() + ms;
  while (laterQ.length && performance.now() < until) {
    let r; try { r = laterQ[0].next(); } catch (e) { console.warn('later', e); r = { done: true }; }
    if (r.done) laterQ.shift();
  }
  return laterQ.length;
}
// the jumps within 150 m of the start, before Ride; the others after it, nearest first, then every far copy
const BOOT_JUMPS = 150;
for (const G of jumpGroups) {
  if (G.d > BOOT_JUMPS) { later(buildJump(G)); continue; }
  const it = buildJump(G, true); let n = 0;
  for (let r = it.next(); !r.done; r = it.next()) if (++n % 40 === 0) await step(null, 0.5);   // (C: a breath now and then)
}
// (queued after every jump, so it starts once they are all in)
later((function* () { for (const J of jumpLods) yield* farCopy(J); })());
// which copy of each jump is drawn: the far one past JUMP_FAR metres from the camera (5 m more to go back, so it never
// flickers between them at the edge)
function lodJumps(cam) {
  for (const J of jumpLods) {
    const d = J.box.distanceToPoint(cam), far = J.isFar ? d > JUMP_FAR - 5 : d > JUMP_FAR;
    if (far !== J.isFar && J.far) { J.isFar = far; J.near.visible = !far; J.far.visible = far; }
  }
}
await step('Planting the trees', 0.64);
// (the park's rails and boxes; the benches' model loads, and is in before the shaders are compiled at boot: K)
const railsG = park.rails.length ? railMeshes(park.rails, mats) : null; if (railsG) scene.add(railsG);
if (fr) { buildRock(scene, fr.land, mats, q, await soft(rockP, 60000, 'rock faces')); buildJibs(scene, fr, mats, q); }   // (F: the rock faces, logs, slab, stumps, flags and finish arch)   // (the worker's arrays, or made here)
const forest = new Forest(scene, q, mtn || (fr && fr.mtn));   // (F: Freeride's trees from its own list)
await step(null, 0.69);
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
document.querySelectorAll('[data-ride]').forEach(b => b.onclick = async () => { if (b.dataset.ride === opts.ride) return; opts.ride = b.dataset.ride; save(); await needRide(opts.ride); if (opts.ride !== b.dataset.ride) return; applyRide(); toStart(); loadRider(); });   // (C: needRide)
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
  await r2.load(opts.rider, { poles: opts.poles === '1', outfit: OUTFITS[opts.rider], look: locker.look, kind: opts.ride || 'ski', goofy: opts.stance === 'goofy', lo: q.lo });   // (kind: R, for B's board; look: R's locker; lo: C, the Low tier's lighter model)
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
  // (C, 2026-11-11: the ride's own module first, if it has not come yet: needRide; lo: the Low tier's lighter model)
  makeRig: async (id, look) => { await needRide(look && look.ride); const r = new Rig(); await r.load(id, { poles: true, outfit: OUTFITS[id], look: cleanLook(look), kind: look && Rig.loader[look.ride] ? look.ride : 'ski', goofy: !!(look && look.stance === 'goofy'), lo: q.lo }); mergeGear(r); r._cp = null; r.crashPts();
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
// (M: the public parks are the home screen's online board now, one for each map: online.js)
$('mpprivate').onclick = () => { net.connect(mpName(), opts.rider, { priv: true }); play(); };
$('mpjoin').onclick = () => { const c = $('mpcode').value.trim().toUpperCase(); if (c.length !== 4) { $('mpstatus').textContent = 'A room code has four letters.'; return; } net.connect(mpName(), opts.rider, { code: c }); play(); };
$('mpleave').onclick = () => net.leave();
// (M) the online board, the reload into another map's park, and watching the others ride
const online = new Online({ net, opts, save, hud, cams, camera, lift, sound, play, toStart, rig: () => rig, start: START });
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
  /* (C, 2026-11-11, for "you cant play" on a Chromebook: a frame's time is counted up to a tenth of a second, so the
     riding keeps to real time down to 10 frames a second; counted to a twentieth, it went in slow motion under 20, three
     quarters speed at 15. A physics step costs about 0.4 ms with the processor slowed six times.) */
  const dt = Math.min(0.1, clock.getDelta());
  time += dt;
  const live = playing && !paused && !replay && !online.watching;   // (M: watching others, your own rider waits)
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
    while (acc >= STEP && n < 13) {
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
    if (n === 13) acc = 0;
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
  } else if (online.watching) {
    camSk = online.frame(dt, time);                      // (M: the rider watched, the camera on them: online.js)
  } else {
    // the rider between the physics' last two steps (alpha: how far into the next one the clock has run)
    camSk = drawn(Math.min(1, acc / STEP));
    S = poseState(camSk, time);
    if (live) record(time);
  }
  if (!online.watching) {                                // (M: online.frame did the camera; your own rider is hidden)
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
  }
  // (R) the locker open on the menu: the camera turns round the rider beside the card
  if (!live && !replay && locker.open && !$('menu').classList.contains('hidden')) {
    // (C, 2026-11-11: seen from the turntable, never from the eyes: in first person the rider's head was hidden here)
    if (rig.setFirstPerson) rig.setFirstPerson(false);
    camera.layers.enable(1);
    locker.preview(camera, rig, dt);
  }
  if (live) { tracks.follow(view.p); tracks.fromSkier(view, rig); spray.fromSkier(view, rig, dt); }
  tracks.flush();
  spray.update(dt, time);
  lodJumps(camera.position);
  // (2026-11-12) the start's leftovers (the far jumps, their far copies): a few milliseconds a frame while riding, more
  // while the menu is up
  if (laterQ.length) runLater(live ? (q.tier === 'low' ? 3 : 4) : 12);
  sky.follow(camSk.p);                                   // (the shadows' box round the rider as drawn)
  // (2026-11-12: while the menu is up, the far snow left from the start is built faster)
  terrain.budget = live ? terrainBudget : 10;
  terrain.update(camera.position, frames);
  forest.update(camera.position);
  snowUniforms.uTime.value = time;
  sound.frame(online.watching ? camSk : skier);           // (M: watching, the wind and the snow follow the rider watched)
  // (the others' name tags are put on the screen through this frame's camera: they were a frame behind it, and slid
  // against their riders whenever the camera moved)
  camera.updateMatrixWorld();
  net.update(dt, skier, time);
  hud.frame(online.watching ? camSk : skier, opts.showfps ? fps : null);
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
    /* (C, 2026-11-11) the rider (its download began before the world was built) is dressed while the jumps' far copies
       are built; a rider that does not come is asked for once more, then the start says so. Every wait below has a
       time limit and goes on without what did not come (the benches, the lift's model, the shaders' last checks). */
    await step('Dressing your rider', 0.72);
    // (the world's shaders start compiling now, beside the rider: the graphics driver builds them while the page goes on)
    const shadersP = soft(buildPrograms(), 30000, 'shaders').then(v => (bt('shaders'), v));
    const riderP = loadRider();
    let ok = await soft(riderP, 90000, 'rider'); bt('rider');
    if (!ok) { await step('Trying your rider again', 0.74); ok = await soft(loadRider(), 90000, 'rider'); }
    // (a ride or a rider picked meanwhile left this one unused: the one picked, then)
    for (let i = 0; ok && !rig.ready && i < 3; i++) ok = await soft(loadRider(), 90000, 'rider');
    if (!ok || !rig.ready) { BOOT.fail('Your rider did not download.', 'The connection may have dropped. Try again, or try on another network.'); throw new Error('no rider'); }
    await step('Getting the graphics ready', 0.82);
    terrain.warm(new THREE.Vector3(skier.p.x, skier.p.y + 3, skier.p.z - 5), 350);   // (2026-11-12: the rest in the first frames, nearest first)
    bt('warm');
    rig.update({ p: skier.p, q: skier.q, state: 'ground', edge: 0, crouch: 0.2, tuck: 0, brake: 0, press: 0, sw: false, speed: 0, vel: skier.v, balance: 0, t: 0 }, 0.016);
    cams.update(0.016, skier, rig);
    forest.update(camera.position);
    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = !!qs.has('matrixauto');
    if (railsG) await soft(railsG.ready, 20000, 'rails'); bt('rails');
    if (liftReady) await soft(liftReady, 20000, 'lift'); bt('lift');      // (L)
    await shadersP;
    await step('Almost there', 0.93);
    /* (2026-11-06: compileAsync builds the programs things are drawn with, not the shadow pass's own; those were built
       the first time a thing came near enough to cast a shadow on the rider's patch of snow, inside that frame's draw:
       on the high tier the start arch's banner, half way down the first run. Every shadow caster was drawn into the
       shadow map once here, behind the menu.) (2026-11-12: buildPrograms builds the shadow pass's programs too, beside
       the rest, so that draw is gone: what came since the first call, the rider, the lift, the benches, is asked for here) */
    await soft(buildPrograms(), 30000, 'shaders'); bt('shaders2');
    $('play').disabled = false; $('play').textContent = 'Ride';
    BOOT.ready();                                        // (C)
    // (2026-11-12: the sounds' player made now, quiet until Ride: made on the click it held that frame about 0.1 s on a
    // slow processor; the browser lets it play from the click on)
    setTimeout(() => { try { sound.prepare(); } catch (e) {} }, 0);
    bootDone();
    online.booted();                                     // (M: an online choice made before a reload into this map)
  } catch (e) {
    console.error(e); $('play').textContent = 'Could not load';
    BOOT.fail('Something went wrong while the game was starting.', String(e && e.message || e).slice(0, 160));   // (C)
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
  window.__ski.online = online;                        // (M)
  /* (2026-11-12, loading) the first frame (every texture and buffer sent to the graphics card, the shadow map's first
     drawing) runs once the Ride button has been drawn ready: run in this same task, it held the button back about 0.4 s
     on a slow processor (a hidden tab draws no frames: the timeout starts it anyway) */
  let started = false;
  const go = () => { if (started) return; started = true; clock.getDelta(); frame(); };
  requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 100);
})();
