// Earth Drive: boot, the drive, the loop. Modules: geo (frame), world (tiles or terrain), baked (shadows on
// photographs), sky, collide, vehicle (physics), cars (models), roads/osm/props (OpenStreetMap), traffic,
// camera, hud, mapui (the Google Maps style picker).
import * as THREE from 'three';
import { setOrigin, frame, toLocal, toLatLon, headingDir, dirHeading } from './geo.js?v=50';
import { World } from './world.js?v=50';
import { syncBaked, bakedUniforms, makeDetail } from './baked.js?v=50';
import { Sky, tidyCasters, hideShadowOnly, wrapShadowPass, steadySpots } from './sky.js?v=50'; // (perf A: the shadow pass's casters, steady lights)
import { Drive } from './drive.js?v=50';
import { CompileGate } from './gate.js?v=50'; // (perf B) nothing drawn with a program still being built
import { Weather } from './weather.js?v=50'; // (round 6, W) the time of day and the weather
import { quality } from './quality.js?v=50'; // (round 6, perf P) the graphics tier: low, medium or high
import { setupPerf } from './perf.js?v=50'; // (round 6, perf P) the tier applied, the settings panel's Graphics, a lost context

const Q = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
// depth: a reversed depth buffer where the browser has EXT_clip_control, else logarithmic (which turns off the early
// depth test, so walls behind walls are shaded too). (lead, v37) reversed is the default where it can be had: Times
// Square, 40 s from the drop on a GTX 745, 1,950 and 2,109 frames at resolution 1.0 with it against 1,421 and 1,447 at
// 0.6 with the log buffer, frames over 100 ms 3 and 0 against 8 and 7, and the same pictures; ?rz=0 for the log buffer.
// Asked of a throwaway context first: three asked for a reversed buffer it cannot have gives a plain one, worse than
// the log buffer far away.
const clipControl = (() => { try { const c = document.createElement('canvas'), gl = c.getContext('webgl2'); try { quality.probe(gl); } catch (e) {} const ok = !!(gl && gl.getExtension('EXT_clip_control')); const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); return ok; } catch (e) { return false; } })();
const RZ = Q.get('rz') === '1' || (Q.get('rz') !== '0' && clipControl);
let renderer;
// (round 6, perf P) no antialiasing on the low and medium tiers (quality.js): on a Chromebook's graphics it is a large
// share of the frame and of the graphics memory
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.p.antialias !== false, logarithmicDepthBuffer: !RZ, reversedDepthBuffer: RZ, powerPreference: 'high-performance' }); }
catch (e) {
  document.getElementById('ui').innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#202124;color:#e8eaed;font:15px Roboto,system-ui,sans-serif;text-align:center;padding:24px">This game needs WebGL 2, which this browser or computer could not start.<br>Try a recent Chrome, Edge, Firefox or Safari, with hardware acceleration on.</div>';
  throw e;
}
// (perf A) with the reversed depth buffer a polygon offset has to go the other way to pull a decal towards the eye
// (three.js hands the material's numbers to WebGL as they are; with the log depth buffer they do nothing at all)
if (RZ && renderer.capabilities.reversedDepthBuffer) { const gl = renderer.getContext(), po = gl.polygonOffset.bind(gl); gl.polygonOffset = (f, u) => po(-f, -u); }
quality.lock();
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.has('pr') ? +Q.get('pr') : quality.p.prStart || 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const TM = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping };
renderer.toneMapping = TM[Q.get('tm')] || THREE.NeutralToneMapping;
renderer.toneMappingExposure = +(Q.get('exp') || 0.9);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// reading every shader's log back from the driver stalls the page for seconds as the world loads; ?debug turns it on
renderer.debug.checkShaderErrors = Q.has('debug');
// (perf B) asked now, while the graphics process is idle: three asks it at the first texture sent, and then it waited
// 0.6 s behind the shaders being built
try { renderer.capabilities.getMaxAnisotropy(); } catch (e) {}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200000);
camera.position.set(0, 2, 8);
scene.add(camera);
// (perf B) from here on every mesh put into the scene is held out of the drawing until its shaders are built (gate.js)
const gate = new CompileGate(renderer, scene, camera);

const sky = new Sky(renderer, scene);
wrapShadowPass(renderer); // (perf A) shadow-only stand-ins drawn in the shadow pass alone (sky.js)
bakedUniforms.uDetail.value = makeDetail();
bakedUniforms.uDetailOn.value = 1;
const world = new World(renderer, scene, camera);

const G = window.__car = { THREE, renderer, scene, camera, world, sky, frame, toLocal, toLatLon, setOrigin, state: 'boot', mods: {}, quality };
// (round 5) the two spot lights a draw has, kept so from the start and before every compile: they were only made at
// the first draw and only set right before a draw, so a drop from the map (a frame drawn before the drop held the
// drawing) built the cars, the parked cars, the props and the buildings for four spot lights (the two fills and the
// car's own two beams), and each was built again inside a draw after the first rebuild (0.2 to 0.6 s each, 2.6 s for
// the walls)
G.steadySpots = () => { const D = G.drive; steadySpots(scene, D && D.mods && D.mods.cars && D.mods.cars.BEAMS, D && D.car && D.car.rig && D.car.rig._beams); };
steadySpots(scene, null, null);
G.gate = gate; // (perf B)
// (round 6, W) the time of day and the weather: the sun, the sky, the light on everything, rain, lamps (weather.js)
if (!Q.has('noweather')) { try { G.weather = new Weather(G); } catch (e) { console.warn('weather', e); } }

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ---- the free camera (debug, ?free) ----
const keys = new Set();
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; keys.add(e.code); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
G.keys = keys;
let yaw = 0, pitch = -0.1;
function freeCam(dt) {
  const sp = (keys.has('ShiftLeft') ? 60 : 12) * dt;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.has('KeyW')) camera.position.addScaledVector(f, sp);
  if (keys.has('KeyS')) camera.position.addScaledVector(f, -sp);
  if (keys.has('KeyD')) camera.position.addScaledVector(r, sp);
  if (keys.has('KeyA')) camera.position.addScaledVector(r, -sp);
  if (keys.has('KeyE')) camera.position.y += sp;
  if (keys.has('KeyQ')) camera.position.y -= sp;
  if (keys.has('ArrowLeft')) yaw += dt * 1.5;
  if (keys.has('ArrowRight')) yaw -= dt * 1.5;
  if (keys.has('ArrowUp')) pitch += dt;
  if (keys.has('ArrowDown')) pitch -= dt;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
G.look = (y, p) => { yaw = y; pitch = p; };

export async function startWorld(lat, lon, opts = {}) {
  const key = opts.key || Q.get('key') || (() => { try { return localStorage.getItem('car_gkey'); } catch (e) { return null; } })();
  let mode = key || Q.get('tiles') ? 'google' : 'open';
  G.keyFailed = false;
  setOrigin(lat, lon, 0);
  try { await world.start(mode, lat, lon, key); }
  catch (e) {
    console.warn('Google 3D tiles refused the key, using the open world', e);
    G.keyFailed = true;
    if (G.drive && G.drive.hud) G.drive.hud.flash('The Google key did not work, showing the open map instead');
    mode = 'open';
    await world.start(mode, lat, lon, null);
  }
  if (mode === 'open') {
    const e = world.heights.at(lat, lon) || 0;
    setOrigin(lat, lon, e);
    world.tiles.group.matrix.copy(frame.ecefToLocal); world.tiles.group.matrixWorldNeedsUpdate = true;
  } else {
    // Google's heights are over the ellipsoid: find the ground under the drop (looking down from high up while the
    // first tiles come in) and put the origin on it, so the ground is near y 0 in La Paz as on the coast
    camera.position.set(0, 6000, 1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    let g = null;
    for (let i = 0; i < 80 && g === null; i++) { await new Promise(r => setTimeout(r, 120)); g = world.groundAt(0, 0); }
    if (g !== null && Number.isFinite(g)) {
      setOrigin(lat, lon, g);
      world.tiles.group.matrix.copy(frame.ecefToLocal); world.tiles.group.matrixWorldNeedsUpdate = true;
      world.gRef = undefined;
    }
  }
  G.state = 'world';
  G.mode = mode;
  if (G.setCredit) G.setCredit();
  return mode;
}
G.startWorld = startWorld;

// resolution follows the frame rate: a step down under 40 fps, back up over 57, between 0.6 and the screen's own
// (round 6, perf P) the range follows the graphics tier (quality.js prMax, prStart, prFloor)
const prMaxNow = () => Math.min(devicePixelRatio, Q.has('pr') ? +Q.get('pr') : (quality.p.prMax || 1.5));
let PR_MAX = prMaxNow();
let prNow = Math.min(PR_MAX, Q.has('pr') ? +Q.get('pr') : (quality.p.prStart || PR_MAX)), scaleT = 0, scaleN = 0, scaleSum = 0;
// (perf A) a change of resolution makes the browser build the drawing buffer again, 0.2 to 2 s on a busy graphics
// card, so it happens seldom: not in the first 10 s of a drive, three 2.5 s windows in a row agreeing, 12 s at least
// between changes, a bigger step when far too slow (so fewer steps), never back up within a minute to a level that
// was too slow, and one resize a step (setPixelRatio resizes the canvas itself; a setSize after it did it twice)
let scaleLast = -1e9, activeSince = null, minAvg = [], tooSlow = Infinity, tooSlowT = -1e9;
function autoScale(now) {
  if (!G.drive || !G.drive.active || Q.has('pr')) { scaleT = now; scaleN = scaleSum = 0; activeSince = null; return; }
  if (activeSince === null) activeSince = now;
  scaleN++;
  if (now - scaleT < 2500) return;
  const fps = scaleN / ((now - scaleT) / 1000);
  scaleT = now; scaleN = 0;
  const want = fps < 40 ? -1 : fps > 57 ? 1 : 0;
  scaleSum = want !== 0 && want === Math.sign(scaleSum) ? scaleSum + want : want;
  minAvg.push(fps); if (minAvg.length > 3) minAvg.shift();
  const avg = minAvg.reduce((a, b) => a + b, 0) / minAvg.length;
  // (lead) far too slow (under 30 fps): down again after 4 s and two windows agreeing, not 12 s and three, so a heavy
  // place (Times Square) does not spend its first half minute at 28 fps on the way down; ?slowscale keeps the old pace
  const quick = scaleSum < 0 && avg < 30 && !Q.has('slowscale');
  if (G.drive.loadingArea || now - activeSince < 10000 || now - scaleLast < (quick ? 4000 : 12000) || Math.abs(scaleSum) < (quick ? 2 : 3)) return;
  let next = prNow;
  // (lead) down to 0.5 only when still under 30 fps at 0.6 (Times Square on a GTX 745 class card sat at about 28 fps
  // at the old floor; its GPU time is mostly fill); ?prfloor=0.6 keeps the old floor
  const floor = Math.min(quality.p.prFloor ?? 0.6, (avg < 30 && prNow <= 0.6 + 1e-6 && !Q.has('prfloor')) ? 0.5 : 0.6);
  // (round 6, perf P) still under 24 fps at the lowest resolution, 30 s or more into the drive: a graphics tier down
  // (on Auto; perf.js)
  if (scaleSum < 0 && avg < 24 && prNow <= floor + 1e-6 && now - activeSince > 30000 && G.perf && G.perf.tooSlow && G.perf.tooSlow(avg)) { scaleSum = 0; scaleLast = now; minAvg = []; return; }
  if (scaleSum < 0 && prNow > floor + 1e-6) next = Math.max(floor, prNow - (avg < 25 ? 0.3 : 0.15));
  else if (scaleSum > 0 && prNow < PR_MAX) { next = Math.min(PR_MAX, prNow + 0.1); if (next >= tooSlow - 1e-6 && now - tooSlowT < 60000) next = prNow; }
  scaleSum = 0;
  if (next !== prNow) {
    if (next < prNow) { tooSlow = prNow; tooSlowT = now; }
    prNow = next; scaleLast = now; renderer.setPixelRatio(prNow);
  }
}
G.pixelRatio = () => prNow;
// (round 6, perf P) a change of graphics tier: the resolution kept inside its new range
quality.on(() => { PR_MAX = prMaxNow(); const n = Math.min(PR_MAX, Math.max(prNow, quality.p.prFloor ?? 0.6)); if (Math.abs(n - prNow) > 1e-6 && !Q.has('pr')) { prNow = n; scaleLast = performance.now(); renderer.setPixelRatio(prNow); } });

let last = performance.now();
G.frames = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // the next frame is asked for first, so an error in one frame can never stop the game
  requestAnimationFrame(loop);
  try {
    if (Q.has('free')) { freeCam(dt); sky.update(camera); }
    else if (G.drive) G.drive.update(dt);
    if (G.onFrame) G.onFrame(dt);
  } catch (e) { if (!G.loopErr || now - G.loopErr > 2000) { console.error('frame', e); G.loopErr = now; } }
  if (!G.paused) {
    world.update();
    bakedUniforms.uCamPos.value.copy(camera.position);
    // for 1.2 s after a crash the sun's shadow map is drawn every other frame (the frames right after an impact were
    // 45 to 60 ms on the GTX 745 against about 30, most of it drawing); a frame between keeps the last map and the
    // matrix it was drawn with
    const dmg = G.drive && G.drive.damage;
    const shadowNow = !(dmg && now - (dmg.lastImpactT || -1e9) < 1200) || (G.frames & 1) === 0;
    renderer.shadowMap.autoUpdate = shadowNow;
    // the shadow matrix the photographed surfaces read must be this frame's (the shadow box follows the car)
    if (shadowNow) {
      if (sky.sun.castShadow) { sky.sun.updateMatrixWorld(); sky.sun.target.updateMatrixWorld(); sky.sun.shadow.updateMatrices(sky.sun); }
      syncBaked(sky.sun);
    }
    // while a drop loads, nothing is drawn: a shader first met in a draw is built there and then, and that held
    // the page still for seconds (the drive builds them all in the background before the car is shown)
    // (never for more than 40 s, whatever happened to the drop)
    // (perf B) what was put into the scene since the last frame: built in the background, shown once ready (gate.js)
    G.steadySpots();
    gate.flush();
    if (!(G.drive && G.drive.holdRender && now - G.drive.holdSince < 40000)) {
      // (perf A) every 30 frames the shadow casters get a depth material of their kind, and the shadow-only stand-ins
      // are kept out of the main pass (sky.js)
      if (G.frames % 30 === 0) tidyCasters(scene);
      // (perf A) exactly two spot lights drawn, the player's car's headlights, so no lit shader is ever built again
      // for a new light count (sky.js)
      G.steadySpots();
      hideShadowOnly(true);
      try { renderer.render(scene, camera); } finally { hideShadowOnly(false); }
    }
  }
  G.frames++;
  G.fps = G.fps ? G.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
  autoScale(now);
  if (G.perf) { try { G.perf.frame(); G.perf.tick(now); } catch (e) {} } // (round 6, perf P: fog floor, frame-rate counter)
}
requestAnimationFrame(loop);

const drive = G.drive = new Drive(G);
try { setupPerf(G); } catch (e) { console.warn('perf setup', e); } // (round 6, perf P)
// a place in the address bar is used only if it is a real one
function validPlace(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0 || Q.get('lat') === '0'); }
// the sources of what is on screen, as their terms ask
const attrib = document.createElement('div'); attrib.className = 'attrib'; document.getElementById('ui').appendChild(attrib);
// (buildings agent: the buildings also come from Overture Maps, ODbL, which asks for its name beside OpenStreetMap's)
const OPEN_CREDIT = 'Imagery: Esri, Maxar, Earthstar Geographics | Elevation: Mapzen, AWS Open Data | Map data © OpenStreetMap contributors, Overture Maps Foundation';
world.addEventListener('attributions', e => { attrib.textContent = 'Google' + (e.text ? ' | ' + e.text : '') + ' | Map data © OpenStreetMap contributors'; });
const OPEN_CREDIT_SHORT = 'Esri, Maxar | Mapzen, AWS | © OpenStreetMap, Overture';
G.setCredit = () => {
  if (world.mode !== 'open') return;
  // (round 6, agent T) the real buildings' own source where an open 3D tileset is drawn (opentiles.js)
  const ot = world.open && world.open.credit ? world.open.credit : '';
  attrib.textContent = (innerWidth < 600 ? OPEN_CREDIT_SHORT : OPEN_CREDIT) + (ot ? ' | 3D buildings: ' + ot : '');
};
// a Google Map Tiles API key turns on Google's photorealistic 3D city: ?key=... once, or from the console
G.setKey = k => { try { if (k) localStorage.setItem('car_gkey', k); else localStorage.removeItem('car_gkey'); } catch (e) {} };
if (Q.get('key')) G.setKey(Q.get('key'));
let mapui = null;
// (round 5, multiplayer) a drop at a place, from the map's Drive here or from a room (home.js): G.beforeDrop may make
// the room first (false: it has put its own screen back), G.afterDrop starts the room's session once the drive is up
async function dropAt({ lat, lon, heading }) {
  mapui.hidePicker();
  if (G.beforeDrop) { let ok = true; try { ok = await G.beforeDrop({ lat, lon, heading }); } catch (e) { console.warn('before drop', e); ok = false; } if (ok === false) return; }
  G.paused = false;
  try {
    const r = await drive.start(lat, lon, heading || 0);
    const g = toLatLon(drive.car.vehicle.origin());
    mapui.startDrive({ lat: g.lat, lon: g.lon, heading: r.heading });
    if (G.afterDrop) { try { G.afterDrop(r); } catch (e) { console.warn('after drop', e); } }
  } catch (e) {
    console.error('drop failed', e);
    drive.active = false; drive.hud.loading(null); drive.hud.show(false);
    mapui.showPicker(); G.paused = true;
    drive.hud.note('Something went wrong loading that place. Please try again or pick another spot.');
  }
}
async function openMap(quiet) {
  try {
    const M = await import('./mapui.js?v=50');
    if (!mapui) mapui = M.createMapUI(document.getElementById('ui'), {
      onDrop: o => dropAt(o),
      // (round 5) leaving a drive in a multiplayer room goes back to the rooms (home.js), not the map
      onBack: () => { drive.active = false; drive.hud.show(false); drive.sound.stop(); mapui.endDrive(); G.paused = true; if (G.onLeaveDrive && G.onLeaveDrive()) return; mapui.showPicker(); },
      // (round 5) the map's menu has the home screen (home.js), for multiplayer without a reload
      onHome: () => { mapui.hidePicker(); if (G.home) G.home.show('start'); else openHome(); },
    });
    G.mapui = mapui;
    try { if (G.settings) G.settings.attachMapMenu(document.querySelector('.mu-drawer')); } catch (e) {} // (round 6: Settings in the map's menu)
    if (!quiet) mapui.showPicker();
    G.paused = true;
    // while the map is up, get the game ready: its modules, the first car, the traffic's cars, the props' models
    const idle = window.requestIdleCallback || (f => setTimeout(f, 300));
    idle(async () => {
      try {
        await drive.loadMods();
        const C = drive.mods.cars;
        if (C) {
          const first = (quality.p.firstCar && C.CARS.find(c => c.id === quality.p.firstCar && !c.npcOnly)) || C.CARS.find(c => !c.npcOnly); // (round 6, perf P: the low tier's lighter first car)
          await C.loadCar(first.id).catch(() => null);
          // (perf B) the traffic models every region uses (no place chosen yet: traffic.js regionModels gives those)
          const TM = drive.mods.traffic, ids = TM && TM.regionModels ? TM.regionModels(C) : [...new Set(C.TRAFFIC || [])];
          for (const id of ids) await C.loadCar(id, { npc: true }).catch(() => null);
        }
        const P = drive.mods.props;
        if (P && P.preload && !drive.propsReady) { drive.propsReady = true; await P.preload(); }
      } catch (e) { console.warn('warm up', e); }
    }, { timeout: 2000 });
  } catch (e) { console.warn('map ui', e); drive.start(37.7946, -122.3999, 0); }
}
G.openMap = openMap;
// (round 5) a drop without the picker first: joining a multiplayer room drops at the room's place
G.dropTo = async (lat, lon, heading) => { await openMap(true); if (mapui) await dropAt({ lat, lon, heading }); };
// (round 5) the home screen first: Singleplayer (the map, as before) or Multiplayer (home.js); ?nohome goes straight
// to the map
async function openHome() {
  if (Q.has('nohome')) return openMap();
  try { const H = await import('./home.js?v=50'); new H.Home(G).show('start'); }
  catch (e) { console.warn('home screen', e); openMap(); }
}
G.onFrame = () => {
  if (mapui && drive.active && drive.car && (G.frames % 15 === 0)) {
    // (on foot, onfoot.js: where the person is and which way it faces)
    const F = drive.onfoot && drive.onfoot.active ? drive.onfoot : null;
    const v = drive.car.vehicle, o = F ? F.focus() : v.origin(), g = toLatLon(o), R = drive.roadsObj;
    // the street under the car from the map data, for when the address lookup has no answer
    const n = R && R.nearestEdge ? R.nearestEdge(o.x, o.z, 15) : null, t = n && n.edge && n.edge.way && n.edge.way.tags;
    mapui.updateCar({ lat: g.lat, lon: g.lon, heading: F ? F.heading() : v.heading, speed: F ? 0 : v.fwdSpeed, road: (t && t.name) || '' });
  }
};
if (Q.has('free') && Q.has('lat')) startWorld(+Q.get('lat'), +Q.get('lon')).then(m => { G.mode = m; });
else if (Q.has('lat') && validPlace(+Q.get('lat'), +Q.get('lon'))) drive.start(+Q.get('lat'), +Q.get('lon'), +(Q.get('h') || 0) || 0).then(r => { G.mode = drive.mode; G.spawned = r; });
else openHome();
