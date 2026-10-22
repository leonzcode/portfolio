// Earth Drive: boot, the drive, the loop. Modules: geo (frame), world (tiles or terrain), baked (shadows on
// photographs), sky, collide, vehicle (physics), cars (models), roads/osm/props (OpenStreetMap), traffic,
// camera, hud, mapui (the Google Maps style picker).
import * as THREE from 'three';
import { setOrigin, frame, toLocal, toLatLon, headingDir, dirHeading } from './geo.js?v=17';
import { World } from './world.js?v=17';
import { syncBaked, bakedUniforms, makeDetail } from './baked.js?v=17';
import { Sky } from './sky.js?v=17';
import { Drive } from './drive.js?v=17';

const Q = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
// depth: a reversed depth buffer where the browser has EXT_clip_control (?rz=1 to try), else logarithmic (which turns
// off the early depth test, so walls behind walls are shaded too)
const RZ = Q.get('rz') === '1';
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: !RZ, reversedDepthBuffer: RZ, powerPreference: 'high-performance' }); }
catch (e) {
  document.getElementById('ui').innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#202124;color:#e8eaed;font:15px Roboto,system-ui,sans-serif;text-align:center;padding:24px">This game needs WebGL 2, which this browser or computer could not start.<br>Try a recent Chrome, Edge, Firefox or Safari, with hardware acceleration on.</div>';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.has('pr') ? +Q.get('pr') : 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const TM = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping };
renderer.toneMapping = TM[Q.get('tm')] || THREE.NeutralToneMapping;
renderer.toneMappingExposure = +(Q.get('exp') || 0.9);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// reading every shader's log back from the driver stalls the page for seconds as the world loads; ?debug turns it on
renderer.debug.checkShaderErrors = Q.has('debug');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200000);
camera.position.set(0, 2, 8);
scene.add(camera);

const sky = new Sky(renderer, scene);
bakedUniforms.uDetail.value = makeDetail();
bakedUniforms.uDetailOn.value = 1;
const world = new World(renderer, scene, camera);

const G = window.__car = { THREE, renderer, scene, camera, world, sky, frame, toLocal, toLatLon, setOrigin, state: 'boot', mods: {} };

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
const PR_MAX = Math.min(devicePixelRatio, Q.has('pr') ? +Q.get('pr') : 1.5);
let prNow = PR_MAX, scaleT = 0, scaleN = 0, scaleSum = 0;
function autoScale(now) {
  if (!G.drive || !G.drive.active || Q.has('pr')) { scaleT = now; scaleN = scaleSum = 0; return; }
  scaleN++;
  if (now - scaleT < 2500) return;
  const fps = scaleN / ((now - scaleT) / 1000);
  scaleT = now; scaleN = 0;
  // (a resize is costly, so only after two windows in a row agree, and never while an area is being built)
  const want = fps < 40 ? -1 : fps > 57 ? 1 : 0;
  scaleSum = want !== 0 && want === Math.sign(scaleSum) ? scaleSum + want : want;
  if (G.drive.loadingArea || Math.abs(scaleSum) < 2) return;
  let next = prNow;
  if (scaleSum < 0 && prNow > 0.6) next = Math.max(0.6, prNow - 0.15);
  else if (scaleSum > 0 && prNow < PR_MAX) next = Math.min(PR_MAX, prNow + 0.1);
  scaleSum = 0;
  if (next !== prNow) { prNow = next; renderer.setPixelRatio(prNow); renderer.setSize(innerWidth, innerHeight, false); }
}
G.pixelRatio = () => prNow;

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
    // the shadow matrix the photographed surfaces read must be this frame's (the shadow box follows the car)
    if (sky.sun.castShadow) { sky.sun.updateMatrixWorld(); sky.sun.target.updateMatrixWorld(); sky.sun.shadow.updateMatrices(sky.sun); }
    syncBaked(sky.sun);
    // while a drop loads, nothing is drawn: a shader first met in a draw is built there and then, and that held
    // the page still for seconds (the drive builds them all in the background before the car is shown)
    // (never for more than 40 s, whatever happened to the drop)
    if (!(G.drive && G.drive.holdRender && now - G.drive.holdSince < 40000)) renderer.render(scene, camera);
  }
  G.frames++;
  G.fps = G.fps ? G.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
  autoScale(now);
}
requestAnimationFrame(loop);

const drive = G.drive = new Drive(G);
// a place in the address bar is used only if it is a real one
function validPlace(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0 || Q.get('lat') === '0'); }
// the sources of what is on screen, as their terms ask
const attrib = document.createElement('div'); attrib.className = 'attrib'; document.getElementById('ui').appendChild(attrib);
const OPEN_CREDIT = 'Imagery: Esri, Maxar, Earthstar Geographics | Elevation: Mapzen, AWS Open Data | Map data © OpenStreetMap contributors';
world.addEventListener('attributions', e => { attrib.textContent = 'Google' + (e.text ? ' | ' + e.text : '') + ' | Map data © OpenStreetMap contributors'; });
const OPEN_CREDIT_SHORT = 'Esri, Maxar | Mapzen, AWS | © OpenStreetMap';
G.setCredit = () => { if (world.mode === 'open') attrib.textContent = innerWidth < 600 ? OPEN_CREDIT_SHORT : OPEN_CREDIT; };
// a Google Map Tiles API key turns on Google's photorealistic 3D city: ?key=... once, or from the console
G.setKey = k => { try { if (k) localStorage.setItem('car_gkey', k); else localStorage.removeItem('car_gkey'); } catch (e) {} };
if (Q.get('key')) G.setKey(Q.get('key'));
let mapui = null;
async function openMap() {
  try {
    const M = await import('./mapui.js?v=17');
    if (!mapui) mapui = M.createMapUI(document.getElementById('ui'), {
      onDrop: async ({ lat, lon, heading }) => {
        mapui.hidePicker();
        G.paused = false;
        try {
          const r = await drive.start(lat, lon, heading || 0);
          const g = toLatLon(drive.car.vehicle.origin());
          mapui.startDrive({ lat: g.lat, lon: g.lon, heading: r.heading });
        } catch (e) {
          console.error('drop failed', e);
          drive.active = false; drive.hud.loading(null); drive.hud.show(false);
          mapui.showPicker(); G.paused = true;
          drive.hud.note('Something went wrong loading that place. Please try again or pick another spot.');
        }
      },
      onBack: () => { drive.active = false; drive.hud.show(false); drive.sound.stop(); mapui.endDrive(); mapui.showPicker(); G.paused = true; },
    });
    G.mapui = mapui;
    mapui.showPicker();
    G.paused = true;
    // while the map is up, get the game ready: its modules, the first car, the traffic's cars, the props' models
    const idle = window.requestIdleCallback || (f => setTimeout(f, 300));
    idle(async () => {
      try {
        await drive.loadMods();
        const C = drive.mods.cars;
        if (C) {
          const first = C.CARS.find(c => !c.npcOnly);
          await C.loadCar(first.id).catch(() => null);
          for (const id of new Set(C.TRAFFIC || [])) await C.loadCar(id, { npc: true }).catch(() => null);
        }
        const P = drive.mods.props;
        if (P && P.preload && !drive.propsReady) { drive.propsReady = true; await P.preload(); }
      } catch (e) { console.warn('warm up', e); }
    }, { timeout: 2000 });
  } catch (e) { console.warn('map ui', e); drive.start(37.7946, -122.3999, 0); }
}
G.openMap = openMap;
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
else openMap();
