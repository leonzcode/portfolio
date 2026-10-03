/* ---------------------------------------------------------------------------
   Leon Kart - the loop.

   One circuit, one lobby, three laps. This file owns the renderer, the race
   state machine, the camera, the HUD and the input; the track, the karts, the
   items, the computer drivers and the network each live next door.

   The race runs on the clock the server keeps when somebody else is connected,
   and on its own clock when nobody is. Either way the phases are the same:
   waiting, the lights, the race, the results, and round again. Turn up mid-race
   and you watch this one from the grid and start the next.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { buildTrack, setAniso, setCustomTrack } from './track.js?v=98';
import { makeKart, stepKart, apply, bump, spinOut, topSpeed, driftTier, RACERS, TUNE, racerOf } from './kart.js?v=98';
import { packLook, unpackLook, normalise } from './parts.js?v=98';
import { makeGarage, PARTS, BARS, statsOf } from './garage.js?v=98';
import { whenKit } from './models.js?v=98';
import { plantOn, dropPlant, stepPlants } from './plant.js?v=98';
import { makeRescue } from './rescue.js?v=98';
import { ITEMS, rollItem, rollCount, makeItemWorld, lapProg } from './items.js?v=98';
import { makeBrain, driveBrain } from './ai.js?v=98';
import { initFx, spark, puff, blast, stepFx } from './fx.js?v=98';
import { makeRecorder, makeGhost, pose as poseGhost, dropGhost, ghostKart } from './ghost.js?v=98';
import { makeRanked } from './rk.js?v=98';
import { tickCosmetics, normaliseStyle, owns, itemById, TIER_NAME, TIER_COLOUR, SKIN_TONES, CLOTH } from './cosmetics.js?v=98';
import { makeHub } from './hub.js?v=98';
import { icon, KIND_ICON } from './icons.js?v=98';
import { makeCones } from './cones.js?v=98';
import { makeHazards } from './hazards.js?v=98';
import { THEMES, themeById, seedOf, registerTheme, isCustom } from './themes.js?v=98';
import * as snd from './audio.js?v=98';

const el = id => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// three, or however many a built map asks for
let LAPS = 3;
const CPN = 8;
const GRID = 8;                       // how big a field the circuit is set up for

/* ------------------------------------------------------------------ renderer */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
/* Reading back every shader's compile log stalls the frame a new material
   first appears in (measured: two thirds of the CPU time on Ember Hollow while
   its effects came in). A shader that does not compile still shows as
   missing, so the log is not worth the stall on the live page. */
renderer.debug.checkShaderErrors = location.hostname === 'localhost' && /[?&]shaders=1/.test(location.search);
/* What the card will do about a surface seen almost edge on. A road is looked
   at from a metre above it and half a kilometre away in the same frame, which
   is the exact case this is for, and it costs nothing worth measuring. */
setAniso(renderer.capabilities.getMaxAnisotropy());

/* ---------------------------------------------------------------------------
   How hard to work.

   The same page runs on a desktop with a real graphics card and on a laptop
   that is doing this in software, and there is no way to tell which from the
   outside. So it watches its own frame times and moves: consistently slow and
   it drops the resolution it renders at, then the shadows, then the draw
   distance; consistently quick and it puts them back, one step at a time.

   The steps are deliberately coarse and the hysteresis deliberately wide. A
   renderer that adjusts every second is a renderer you can see adjusting, which
   is worse than the frame rate it was trying to fix.
--------------------------------------------------------------------------- */
const LEVELS = [
  { dpr: 1.6, shadow: 2048, shadows: true, far: 1.0 },
  { dpr: 1.25, shadow: 2048, shadows: true, far: 1.0 },
  { dpr: 1.0, shadow: 1024, shadows: true, far: 0.85 },
  { dpr: 0.85, shadow: 1024, shadows: true, far: 0.7 },
  { dpr: 0.75, shadow: 512, shadows: false, far: 0.6 },
];
let level = 0;
let frameLog = [], lastShift = 0;
function applyLevel() {
  const L = LEVELS[level];
  renderer.setPixelRatio(Math.min(devicePixelRatio, L.dpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = L.shadows;
  if (sun && sun.shadow && sun.shadow.mapSize.x !== L.shadow) {
    sun.shadow.mapSize.set(L.shadow, L.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  if (camera) {
    camera.far = 1600 * L.far;
    camera.updateProjectionMatrix();
  }
  if (scene && scene.fog && track) {
    scene.fog.near = track.theme.fogNear * L.far;
    scene.fog.far = track.theme.fogFar * L.far;
  }
  renderer.shadowMap.needsUpdate = true;
}
/* One frame's worth of evidence. Judged on the median of the last couple of
   hundred, not on any one of them: a single long frame is a garbage collection
   or a tab coming back, and reacting to those is how a renderer ends up
   flapping between two settings for ever. */
function watchFrame(ms, now) {
  frameLog.push(ms);
  if (frameLog.length < 150) return;
  frameLog.sort((a, b) => a - b);
  const med = frameLog[frameLog.length >> 1];
  frameLog = [];
  if (now - lastShift < 4000) return;
  if (med > 22 && level < LEVELS.length - 1) { level++; lastShift = now; applyLevel(); }
  else if (med < 12.5 && level > 0) { level--; lastShift = now; applyLevel(); }
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;        // flat and bright, like the genre
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4fb7ff);
scene.fog = new THREE.Fog(0x8fd3ff, 260, 640);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 1600);

/* a bright sky with a few flat clouds, painted into a dome */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 24, 14),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x2f8fe0) }, bot: { value: new THREE.Color(0xbfe8ff) },
                cloud: { value: 0.9 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top, bot; uniform float cloud; varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float y = clamp(vP.y, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(y, 0.7));
        /* The dome covers the whole screen, so anything in here runs for every
           pixel of it. Two octaves rather than three, and none at all on the
           circuits that have no weather to speak of: on Neon Mile and Ember
           Hollow this was three octaves of noise a pixel to produce a cloud
           nobody could see against the sky it was drawn on. */
        if (cloud > 0.05 && vP.y > 0.04) {
          vec2 uv = vP.xz / max(vP.y, 0.08) * 0.55;
          float f = n(uv) * 0.66 + n(uv * 2.6) * 0.34;
          float puff = smoothstep(0.54, 0.79, f) * smoothstep(0.04, 0.3, vP.y);
          c = mix(c, vec3(1.0), puff * cloud);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
);
sky.frustumCulled = false;
scene.add(sky);

const sun = new THREE.DirectionalLight(0xfff4d8, 2.1);
sun.position.set(120, 190, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10; sun.shadow.camera.far = 420;
sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xcfeaff, 0x5f9a4a, 0.85);
scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.28);
scene.add(amb);

/* ------------------------------------------------------------------- state -- */
let track = null, items = null, cones = null, hazards = null, rescue = null;
let phase = 'title';                  // title | count | race | results
let phaseT = 0;
let me = null;                        // the player's kart
let karts = [];                       // everything on the grid, in no order
let brains = [];                      // the computer drivers
let spectating = false;
let watchId = null;              // whose race you are watching, while spectating
let specKey = '';                // what the switcher is currently showing
let raceTime = 0, results = [], notified = 0;
let net = null, myName = 'Player', myCast = 0;
let started = false, paused = false, chatting = false;
// a test freezes the loop and runs the world by hand; that is not the same as
// the pause menu, which also takes the controls away
let frozen = false;
let camPinned = false;          // a test has parked the camera; leave it alone
let soloRound = 0, autoBrain = null;

// how your car is put together, which is yours and is remembered
let myBuild = normalise(null);
try {
  myName = (localStorage.getItem('mkName') || '').slice(0, 12);
  myCast = clamp(+(localStorage.getItem('mkCast') || 0), 0, RACERS.length - 1);
  const saved = localStorage.getItem('mkBuild');
  if (saved) myBuild = normalise(JSON.parse(saved));
} catch (e) {}
function saveBuild() {
  try { localStorage.setItem('mkBuild', JSON.stringify(myBuild)); } catch (e) {}
}

/* The paint, off the wheel: hue and strength from where you touched the disc,
   lightness from the slider. Kept as those three rather than as the colour they
   make, so the marker goes back exactly where you left it. Nothing picked yet
   means the car wears the first racer's red. */
let myPaint = null, myColour = null;
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
try {
  const p = JSON.parse(localStorage.getItem('mkPaint') || 'null');
  if (p && isFinite(p.h) && isFinite(p.s) && isFinite(p.l)) { myPaint = p; myColour = hsl(p.h, p.s, p.l); }
} catch (e) {}
function myRacer() { return racerOf(myCast, myColour); }

/* ---- your look, beyond the driver, the parts and the paint --------------
   The character's colours, the gradient, and every cosmetic worn. Kept in
   this browser, and on the server under your name, which is the account:
   open the game anywhere under the same name and you are dressed the same.
   What you have won (the inventory) only ever comes from the server. */
let myStyle = { char: {}, kart: {} };
let profileT = 0;
let profileSeen = '';                  // the name whose inventory has been seen once this session
let myInv = {};
let myHeld = {};                       // the prizes held for a place right now, and why
let profileName = '';
try {
  const s = JSON.parse(localStorage.getItem('mkStyle') || 'null');
  if (s && typeof s === 'object') myStyle = { char: s.char || {}, kart: s.kart || {} };
} catch (e) {}
// the look with only what is owned in it, which is what anybody else sees
function styleNow() {
  const c = Object.assign({}, myStyle.char), k = Object.assign({}, myStyle.kart);
  for (const key of ['hat', 'face', 'driver']) if (c[key] && !owns(myInv, c[key])) delete c[key];
  for (const key of ['skin', 'body', 'decor', 'glider', 'plate', 'aura']) if (k[key] && !owns(myInv, k[key])) delete k[key];
  return { char: c, kart: k, name: myName };
}
let styleSaveT = 0;
function saveStyle() {
  try { localStorage.setItem('mkStyle', JSON.stringify(myStyle)); } catch (e) {}
  clearTimeout(styleSaveT);
  styleSaveT = setTimeout(pushLook, 900);
}
function pushLook() {
  const name = (myName || '').trim();
  if (!name) return;
  const s = styleNow();
  fetch(MC + '/kart/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, look: { cast: myCast, build: myBuild, char: s.char, kart: Object.assign({ paint: myColour }, s.kart) } }) })
    .catch(() => {});
}
/* Your profile from the server: what you have won, and the look saved there.
   The first time a name is seen on a new browser the saved look is put on;
   after that this browser's own changes win, and go back up. */
let profileAt = 0;
function loadProfile(adopt) {
  const name = (myName || '').trim();
  if (!name) return Promise.resolve(null);
  profileName = name;
  return fetch(MC + '/kart/profile?name=' + encodeURIComponent(name), { cache: 'no-store' })
    .then(r => r.json())
    .then(p => {
      if (!p || (myName || '').trim() !== name) return null;
      const before = myInv;
      myInv = p.inv || {};
      myHeld = p.held || {};
      profileAt = Date.now();
      if (adopt && p.look) {
        const L = p.look;
        if (typeof L.cast === 'number' && L.cast < RACERS.length) { myCast = L.cast; try { localStorage.setItem('mkCast', String(myCast)); } catch (e) {} }
        if (L.build) { myBuild = normalise(Object.assign({}, myBuild, L.build)); saveBuild(); }
        myStyle = { char: L.char || {}, kart: Object.assign({}, L.kart || {}) };
        delete myStyle.kart.paint;
        try { localStorage.setItem('mkStyle', JSON.stringify(myStyle)); } catch (e) {}
      }
      /* Anything new since the last look is news, but only once there has been
         a last look: the first load of a session is what you already had. */
      if (profileSeen && profileSeen === name) {
        for (const id of Object.keys(myInv)) if (!before[id]) announceItem(id);
      }
      profileSeen = name;
      showGarage();
      if (hub) hub.refresh(p);
      return p;
    })
    .catch(() => null);
}
// something just won, said where it will be seen
function announceItem(id) {
  const it = itemById(id);
  if (!it) return;
  const box = el('toast');
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'unlock ' + it.tier;
  d.innerHTML = '<i>' + icon(KIND_ICON[it.kind]) + '</i><span><small style="color:' + TIER_COLOUR[it.tier] + '">New ' + TIER_NAME[it.tier]
    + '</small><b>' + esc(it.name) + '</b></span>';
  box.appendChild(d);
  // and the thing itself, once its picture is drawn
  if (hub) hub.thumb(it, myRacer(), myBuild).then(url => { if (url && d.isConnected) d.querySelector('i').innerHTML = '<img alt="" src="' + url + '">'; });
  try { snd.fanfare(true); } catch (e) {}
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 600); }, 5200);
}
// after anything that might have won something, look again in a moment
function checkWins() { setTimeout(() => loadProfile(false), 2500); }

/* Everybody else's look, by name, fetched once a minute at most and put on
   their kart the moment it arrives. */
const styleCache = new Map();
function styleFor(name, then) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const c = styleCache.get(key);
  if (c && Date.now() - c.at < 60000) return c.style;
  if (!c || !c.loading) {
    styleCache.set(key, { at: c ? c.at : 0, style: c ? c.style : null, loading: true });
    fetch(MC + '/kart/profile?name=' + encodeURIComponent(name), { cache: 'no-store' })
      .then(r => r.json())
      .then(p => {
        const st = p && p.look ? { char: p.look.char || {}, kart: p.look.kart || {}, name: p.name } : null;
        styleCache.set(key, { at: Date.now(), style: st });
        if (st && then) then(st);
      })
      .catch(() => styleCache.set(key, { at: Date.now(), style: null }));
  }
  return c ? c.style : null;
}

/* ------------------------------------------------------------------- input -- */
// Every action carries its own keys so the pause menu can change them. Esc is
// not in here on purpose: it is the way back out of a menu you have just bound
// yourself out of.
const BINDS = {
  gas:   { name: 'Accelerate',    keys: ['arrowup', 'w'] },
  brake: { name: 'Brake',         keys: ['arrowdown', 's'] },
  left:  { name: 'Steer left',    keys: ['arrowleft', 'a'] },
  right: { name: 'Steer right',   keys: ['arrowright', 'd'] },
  hop:   { name: 'Hop and drift', keys: [' ', 'shift'] },
  go:    { name: 'Start the race', keys: ['k'] },
  item:  { name: 'Use item',      keys: ['e'] },
  view:  { name: 'Change view',   keys: ['q'] },
  look:  { name: 'Look behind',   keys: ['r'] },
  chat:  { name: 'Chat',          keys: ['t'] },
  mute:  { name: 'Mute',          keys: ['m'] },
  reset: { name: 'Restart race',  keys: ['z'] },
};
let bind = {};
function bindDefaults() { for (const a in BINDS) bind[a] = BINDS[a].keys.slice(); }
bindDefaults();
try {
  const saved = JSON.parse(localStorage.getItem('mkBinds') || 'null');
  if (saved) for (const a in bind) if (Array.isArray(saved[a])) bind[a] = saved[a].slice(0, 2);
} catch (e) {}
function bindSave() { try { localStorage.setItem('mkBinds', JSON.stringify(bind)); } catch (e) {} }
const down = a => bind[a].some(k => keys[k]);
const hit = (a, k) => bind[a].indexOf(k) >= 0;
const bound = k => { for (const a in bind) if (bind[a].indexOf(k) >= 0) return true; return false; };

const keys = Object.create(null);
const input = { gas: 0, brake: 0, steer: 0, hop: false };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (waiting) { e.preventDefault(); bindTo(k); return; }
  // Somebody is typing. The game has no business reading the keyboard then,
  // least of all calling preventDefault on the letters it happens to drive
  // with, which is what stopped anyone putting a W or an S in their name.
  const on = e.target;
  if (on && (on.tagName === 'INPUT' || on.tagName === 'TEXTAREA' || on.isContentEditable)) return;
  if (chatting) { if (k === 'escape') closeChat(false); return; }
  keys[k] = true;
  if (k === 'escape' && started) { menu(!paused); e.preventDefault(); return; }
  // on the title screen too, but not over the track picker, where Esc is Back
  if (k === 'escape' && !started && !el('mapsel').classList.contains('on')) { menu(!paused); e.preventDefault(); return; }
  if (paused) return;                       // the menu has the keyboard while it is up
  if (hit('chat', k) && started) { openChat(); e.preventDefault(); }
  if (hit('item', k) && started) itemDown(me);
  /* Steering does nothing at all while you are watching somebody else drive,
     so it moves down the field instead. */
  if (spectating && started) {
    if (hit('left', k)) { watchStep(-1); e.preventDefault(); }
    if (hit('right', k)) { watchStep(1); e.preventDefault(); }
  }
  if (phase === 'wait' && k >= '1' && k <= '5') castVote(THEMES[+k - 1].id);
  if (hit('go', k) && started && phase === 'wait' && net && net.alive) net.go();
  if (hit('view', k) && started) { camMode = (camMode + 1) % CAM.length; notice(CAM[camMode].name + ' view'); }
  if (hit('mute', k) && started) { snd.mute(!snd.muted_()); notice(snd.muted_() ? 'Sound off' : 'Sound on'); }
  // the pause menu's Restart race, on a key; held down it restarts once, not every repeat
  if (hit('reset', k) && started && !e.repeat) restartRace();
  if (bound(k)) e.preventDefault();
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (hit('item', k) && started && !paused) itemUp(me);
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  // the window going away is not a reason to keep holding a shell out
  if (me && me.holdKind) itemUp(me);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function readInput() {
  const left = down('left'), right = down('right');
  input.gas = down('gas') ? 1 : 0;
  input.brake = down('brake') ? 1 : 0;
  // a positive steer is a turn to the left in kart.js, which is the sign the
  // front wheels and the lean are already drawn from, so left is the +1 here
  input.steer = (left ? 1 : 0) - (right ? 1 : 0);
  input.hop = down('hop');
  if ((phase !== 'race' && phase !== 'wait') || spectating || !me || me.finished || paused) {
    // nobody moves before the lights; holding the throttle there is the rocket
    // start, and goRace() is where that gets paid out. The lobby is the one
    // other place you are allowed to drive.
    input.gas = 0; input.brake = 0; input.steer = 0; input.hop = false;
  }
  return input;
}

/* ---------------------------------------------------------- the world -------- */
/* A circuit a lap of which you have learned is a circuit you stop reading, so a
   new one is drawn for every race from that round's seed. Both browsers in a
   lobby build from the same number, which is why none of it has to go over the
   wire. Everything that hangs off the track - the scenery, the cones, the
   hazards lying about - goes with the old one. */
let worldSeed = 0, worldTheme = '';
/* ---- ghosts ----------------------------------------------------------------
   Every race you finish is recorded. The best on each track is kept in this
   browser, and the best twenty on each track are kept on the server beside the
   times they set. Racing one puts it on the grid inside your car. */
const recorder = makeRecorder();
let ghost = null;          // the one in the world this race, if there is one
let ghostWant = null;      // the one asked for, raced again each round on its own track
let trackPrint = '';       // this layout, so a ghost set on a different one is not replayed on it
let runReady = null, runKept = false;
/* The game's modes. A race is you and seven others with everything on the
   road; a time trial is you and the clock - no computer drivers, no item
   boxes, no cones, no hazards - on its own board. A replay is a ghost from the
   board driving its run on its own while the camera follows it. */
let mode = 'race';
let replay = false;
let quietRound = false;       // this round has nothing on the road but the road
/* Ranked. Null outside it. In a battle: { watch: false, id, me, opp, left,
   oppLeft, done, oppDone, res }. Watching one: { watch: true, id, players, res }.
   `res` is the server's verdict once there is one. */
let rk = null;
let rkFirst = null;            // what start() runs in place of a solo round, when ranked started it
const rkSeen = new Map();      // id -> the last place that kart's driver said it was
let rkNet = null;              // the line to the ranked lobby, made once the page is built
// the pages behind the home screen, and the maps people build
let hub = null;
let customMap = null;                  // the built map being driven, for its board: { id, name, laps }
let editorMod = null;
let editorFrame = null;                // the builder's own frame, while it is building
const customSpecs = new Map();         // theme id -> what track.js builds a built map from
const customData = new Map();          // theme id -> the map, for its things
let customWorld = null;                // the things on the built map being driven
let customLaps = 0;
let builderHidden = [];
let rkFans = 0;               // how many are watching you race outside a battle
let rkRound = 0, rkRenameT = null;
let boardTab = 'race';        // which board the title card is showing
let boardMap = 'all';         // and which track's: each track is its own board; the page opens on All
let ttBoard = null;
let pendingPost = 0;          // a finished time waiting for the recording that proves it
/* A fingerprint of the road itself. A ghost is a list of places, and replayed
   on a layout that has since changed it drives through fields and hangs over
   gaps, so a ghost only plays on the layout it was set on. */
function printOf(tr) {
  let h = 2166136261;
  const S = tr.samples;
  for (let i = 0; i < S.length; i += 4) {
    const v = (Math.round(S[i].p.x * 10) * 31 + Math.round(S[i].p.z * 10) * 17 + Math.round(S[i].p.y * 10)) | 0;
    h = Math.imul(h ^ v, 16777619);
  }
  return (h >>> 0).toString(36) + S.length.toString(36);
}
function bestGhost(theme, tt) {
  try {
    const g = JSON.parse(localStorage.getItem((tt ? 'mkGhostTT:' : 'mkGhost:') + theme) || 'null');
    return g && g.v === 1 && g.theme === theme ? g : null;
  } catch (e) { return null; }
}
// the quickest of your own, on whichever track it was
function bestGhostAny() {
  let best = null;
  for (const t of THEMES) { const g = bestGhost(t.id); if (g && (!best || g.time < best.time)) best = g; }
  return best;
}
/* A race and a time trial keep their own best: a trial with nothing on the
   road is not the same run as a race through seven others and their shells. */
function keepBest(run) {
  const tt = run.mode === 'tt';
  const was = bestGhost(run.theme, tt);
  // an equal time is the same run with its run-out added, so it replaces
  if (was && was.time < run.time) return;
  try { localStorage.setItem((tt ? 'mkGhostTT:' : 'mkGhost:') + run.theme, JSON.stringify(run)); } catch (e) {}
}
/* The recording, done: kept here if it is your best on the track, and sent to
   the board with the time it proves, in the same request. */
function runMeta() {
  return {
    theme: worldTheme, track: trackPrint, time: +me.time.toFixed(2),
    mode: quietRound ? 'tt' : 'race', name: (myName || 'You').slice(0, 14),
    // never through | 0: that cuts the number to 32 bits and drops the paint
    look: packLook(myCast, myBuild, myColour),
  };
}
/* Kept the moment you cross the line, not only once the run-out past it has
   been recorded. Leave straight after the flag - back to the menu, a new race,
   closing the tab - and the run used to go with you: the run-out was never
   finished, so the recording never was either. The full one replaces this
   copy a couple of seconds later if you are still there. */
function keepEarly() {
  if (runKept || !me || me.dnf || !me.finished) return;
  runKept = true;
  const run = recorder.finish(runMeta());
  if (!run) return;
  keepBest(run); drawTimes();
  /* And the time goes to the board from here, with this recording in the same
     request: the server checks the run before it takes the time, and keeps
     the run as that row's ghost. Sent the moment the line is crossed, so
     going straight into the next race or closing the tab loses nothing. */
  runReady = run;
  if (pendingPost) postTime(pendingPost, run);
}
function finishRun() {
  if (runReady || !me || me.dnf || !me.finished) return;
  // the recorder hears about the line here if the race ended before it could
  recorder.tick(Math.max(raceTime, me.time), me);
  const run = recorder.finish(runMeta());
  if (!run) return;
  runReady = run;
  keepBest(run);
  // a time still waiting on its recording goes now, however the race ended
  if (pendingPost) postTime(pendingPost, run);
}
/* How you stand against the ghost at the end of a lap, in the few words a
   notice has room for. Its own time for that lap is in the recording. */
function ghostSplit(i) {
  if (!ghost || !ghost.meta.laps || !(ghost.meta.laps[i] > 0)) return '';
  const d = raceTime - ghost.meta.laps[i];
  return '   ' + (d <= 0 ? '\u2212' : '+') + Math.abs(d).toFixed(2) + ' vs ghost';
}
/* Your speed across the line, in the HUD's km/h, and the ghost's at the moment
   it crossed the same line: read out of its recording, which keeps its speed
   twenty times a second. Green if you were carrying more. */
function speedSplit(i) {
  const mine = Math.round(Math.abs(me ? me.speed : 0) * 3.6);
  const out = { text: mine + ' km/h' };
  if (ghost && ghost.T && ghost.meta.laps && ghost.meta.laps[i] > 0) {
    const T = ghost.T, at = Math.max(0, Math.min(T.n - 1, Math.round(ghost.meta.laps[i] * T.rate)));
    const d = mine - Math.round(T.speed[at] * 3.6);
    out.text += '   ' + (d >= 0 ? '+' : '−') + Math.abs(d) + ' km/h vs ghost';
    out.cls = d >= 0 ? 'up' : 'down';
  }
  return out;
}
function fetchGhost(id) {
  return fetch(MC + '/scores/ghost?id=' + encodeURIComponent(id))
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
}
/* Race this one. On its own track, from the grid slot it started in, with
   the rest of the field behind you as usual. */
function raceGhost(g, label, trial) {
  if (started || !g || g.v !== 1 || !THEMES.some(t => t.id === g.theme)) return false;
  ghostWant = Object.assign({}, g, { label: label || 'Ghost' });
  pickedTheme = g.theme;
  replay = false;
  if (trial !== undefined) mode = trial ? 'tt' : 'race';
  start(false);
  return true;
}
/* Watching one: the same ghost on the same track, with nobody driving but it
   and the camera on it the whole way round. */
function watchGhost(g, label) {
  if (started || !g || g.v !== 1 || !THEMES.some(t => t.id === g.theme)) return false;
  ghostWant = Object.assign({}, g, { label: label || 'Ghost' });
  pickedTheme = g.theme;
  replay = true;
  start(false);
  return true;
}
/* No item boxes, no cones and no hazards in a time trial or a replay, and no
   standings or place either: there is nobody to be placed against. Undone for
   the next race, since the track itself is kept between rounds. */
function dressQuiet() {
  const q = quietRound;
  if (track) {
    track.boxMesh.visible = track.coreMesh.visible = !q;
    for (const b of track.itemBoxes) b.taken = q ? 1e9 : 0;
  }
  if (cones) for (const m of cones.meshes) m.visible = !q;
  if (hazards) hazards.group.visible = !q;
  el('hud').classList.toggle('tt', q);
  document.body.classList.toggle('tt', q);
}
/* The sky, the light and the haze belong to the place, so they move with it.
   Everything else about a theme is baked into the track when it is built. */
function dressSky(th) {
  scene.background = new THREE.Color(th.sky);
  // the dome too, or the ground changes and the weather does not
  sky.material.uniforms.top.value.setHex(th.skyTop);
  sky.material.uniforms.bot.value.setHex(th.skyBot);
  sky.material.uniforms.cloud.value = th.cloud;
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  sun.color = new THREE.Color(th.sun);
  sun.intensity = th.sunPower;
  hemi.color = new THREE.Color(th.hemiSky);
  hemi.groundColor = new THREE.Color(th.hemiGround);
  hemi.intensity = th.hemiPower;
  // and how much light is simply in the air. Neon Mile is a night circuit, and
  // a night circuit lit only by a low sun is one you cannot see the road on.
  amb.intensity = th.ambient === undefined ? 0.28 : th.ambient;
  // a new sky replaces the fog, so the quality step has to be put back on it
  applyLevel();
}
/* A place is always the same lap. Racing somewhere used to draw a fresh number
   every time, which made every visit to Sunfield Loop a different circuit and
   every time on the board a time on a track nobody else had driven. Now the
   place decides, so the board compares like with like and learning a corner is
   worth something. */
let soloSeed = 0;
// which place Singleplayer races in, remembered between sessions
let pickedTheme = THEMES[0].id;
try { const t = localStorage.getItem('mkTheme'); if (t && themeById(t).id === t) pickedTheme = t; } catch (e) {}
function newSoloSeed() { soloSeed = seedOf(pickedTheme); return soloSeed; }
function shredGroup(g) {
  if (!g) return;
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach(x => x && x.dispose && x.dispose());
    else if (m) { if (m.map && m.map.dispose) m.map.dispose(); if (m.dispose) m.dispose(); }
  });
  if (g.parent) g.parent.remove(g);
}
function buildWorld(seed, themeId) {
  const th = themeById(themeId || worldTheme || THEMES[0].id);
  if (track && worldSeed === seed && worldTheme === th.id) return;
  if (track) {
    if (items) items.clear();
    shredGroup(track.group);
    /* Every one of them, not the first one found. buildProps is fired and
       forgotten, and in a lobby the rounds come close enough together that two
       of them can be in flight at once: the second world shredded the first
       set of scenery and then both builds finished, which is why a multiplayer
       circuit ended up with two runs of barriers down every edge. */
    for (let o = scene.getObjectByName('props'); o; o = scene.getObjectByName('props')) shredGroup(o);
    if (cones) for (const m of cones.meshes) shredGroup(m);
    if (hazards) shredGroup(hazards.group);
    /* And let go of anybody the balloon still has hold of. The rescue keeps a
       list of cars it is carrying and sets k.rescue on each, and a car with
       that flag is skipped by the physics until the balloon puts it down. Drop
       the manager while it is mid-lift and the flag is never cleared: the car
       sits wherever it was for the rest of the race, cannot be driven, and
       cannot be fished out again either. Rounds change maps mid-fall often
       enough for this to be somebody's whole race. */
    if (rescue) rescue.clear();
  }
  if (customWorld) { customWorld.dispose(); customWorld = null; }
  worldSeed = seed;
  worldTheme = th.id;
  dressSky(th);
  // a map somebody built: its points go to the track builder, its things go down after
  setCustomTrack(isCustom(th.id) ? (customSpecs.get(th.id) || null) : null);
  track = buildTrack(scene, seed, th.id);
  if (isCustom(th.id) && customData.get(th.id)) {
    const forTrack = track;
    editorModule().then(E => E.buildExtras(scene, forTrack, customData.get(th.id), k => pickupBox(k, { taken: 0 })))
      .then(w => { if (track === forTrack) customWorld = w; else w.dispose(); })
      .catch(e => console.warn('custom map things', e));
  }
  items = makeItemWorld(scene, track, { blast });
  cones = makeCones(scene, track);
  hazards = makeHazards(scene, track, seed);
  rescue = makeRescue(scene, track);
  trackPrint = th.id + ':' + printOf(track);
  // the scenery turns up when it turns up; the circuit is drivable without it
  /* And the build is told which world it was started for. By the time the
     models have loaded the lobby may have moved on, and scenery for a circuit
     that no longer exists is scenery standing in the middle of this one. */
  const forWorld = track;
  import('./props.js?v=98')
    .then(m => m.buildProps(scene, THREE, forWorld, () => track === forWorld))
    .catch(() => {});
}

/* --------------------------------------------------------------- the field -- */
/* The computer drivers drive the same car you do. They used to get twice your
   top end, to make up for taking every corner at half the speed a person does;
   now they corner properly, and the top end is yours.

   And each of them keeps its own distance from you. Some run ahead and some
   behind, spread through the field by how good a driver each one is, and each
   one eases its pace up or down to hold its place - a few per cent a second at
   most, so what you see is a car finding a bit more on the straight or backing
   off into a corner, never one lurching. The place each one wants drifts
   slowly over a race, so the running order still changes. Drive better than
   the field can answer and you get away; drive worse and you have company. */
const BOT_TOP = 1;
const MUL_LO = 0.8, MUL_HI = 1.3;         // how far any one of them will ease off or push
const MUL_RATE = 0.06;                    // per second, at most
const GAP_GAIN = 0.0045;                  // per metre it is out of place
// where each keeps itself, best driver first: metres ahead of you, or behind
const GAPS = [55, 36, 20, 7, -8, -24, -42];
// how long the results stand before the next race, matching the lobby server
const RESULTS = 10;

function addKart(racer, opts) {
  const k = makeKart(racer, opts.build, opts.style || null);
  k.castNum = opts.cast;
  k.id = opts.id;
  k.name = opts.name || racer.name;
  k.bot = !!opts.bot;
  k.remote = !!opts.remote;
  scene.add(k.group);
  karts.push(k);
  return k;
}

/* Somebody changed their look while their kart is on the road: build it again
   in the new look and swap the model in, keeping where it is and how it is
   moving. */
function restyleKart(id, cast, style) {
  const k = karts.find(q => q.id === id);
  if (!k || k === me) return;
  if (cast === undefined || cast === null) cast = k.castNum || 0;
  k.castNum = cast;
  if (style === undefined) style = styleFor(k.name, st => restyleKart(id, cast, st));
  const look = unpackLook(cast);
  const nk = makeKart(racerOf(look.cast, look.colour), look.build, style || null);
  dropPlant(k);
  scene.remove(k.group);
  for (const f of ['who', 'group', 'body', 'wheels', 'shade', 'head', 'arms', 'glider', 'build', 'trail', 'style',
                   'exhaust', 'parts', 'driverParts', 'dressed']) k[f] = nk[f];
  scene.add(k.group);
  apply(k);
}
function clearField() {
  if (rescue) rescue.clear();
  for (const k of karts) { dropPlant(k); scene.remove(k.group); }
  karts = [];
  brains = [];
  if (items) items.clear();
  if (ghost) { dropGhost(scene, ghost); ghost = null; }
}

/* From slot `first` back. A ghost starts in the slot its run started in, so
   when you race one you are put in that slot and the field lines up behind
   you - the ghost is then exactly where you are when the lights go. */
function placeOnGrid(first = 0) {
  // the running order of the last race sets the grid for the next one
  karts.forEach((k, n) => {
    const slot = track.gridSlot(first + n);
    k.slot = first + n;
    k.pos.copy(slot.pos);
    k.yaw = slot.yaw;
    k.speed = 0; k.drift = 0; k.driftT = 0; k.slide = 0; k.hop = 0; k.hopV = 0;
    k.boost = 0; k.star = 0; k.slow = 0; k.spin = 0;
    k.lap = 1; k.cpi = 0; k.prog = 0; k.finished = 0; k.time = 0; k.dnf = 0;
    if (k === me) { postedRace = false; k.lapTimes = []; k.lapStart = 0; k.topRun = 0; k.distRun = 0; k.runSent = false; }
    k.item = null; k.itemN = 0; k.roulette = 0; k.queue = [];
    k.falling = 0; k.fallV = 0; k.overEdge = 0; k.rescue = 0; k.bullet = 0;
    k.hint = null;
    // and nobody is stuck on the grid; they simply have not been let go yet
    const b = brains.find(q => q.kart === k);
    if (b) { b.rolled = 0; b.stuckT = 0; b.backT = 0; b.side = 0; }
    const pr = track.project(k.pos.x, k.pos.z, null);
    k.hint = pr.i;
    k.pos.y = pr.y;
    apply(k);
  });
  // back on the road for the next race, but never in a time trial or a replay:
  // hidden and still there to be driven through is not the same as gone
  for (const b of track.itemBoxes) b.taken = quietRound ? 1e9 : 0;
}

/* start a round. `field` is either null (solo, filled with computer drivers) or
   the list of humans the server says are racing this round. */
function startRound(field, seed, asPhase, themeId) {
  LAPS = isCustom(themeId) ? Math.max(1, Math.min(9, customLaps || 3)) : 3;
  if (!isCustom(themeId)) customMap = null;
  /* The circuit the place is, not the one the room's counter happened to land
     on. The server still sends a seed and still moves it every round; taking
     it from the place instead means every client lays out the same track
     without the server having to be told, and a lap of Neon Mile in a room is
     the same lap of Neon Mile you practised on your own. */
  buildWorld(seedOf(themeId), themeId);
  clearField();
  results = [];
  raceTime = 0; notified = 0;
  wrongT = 0;
  el('wrong').classList.remove('on');
  const grid = [];
  if (field && field.length) {
    for (const p of field) {
      // one number carries who they picked and what they built it out of
      // never through | 0: that cuts the number to 32 bits and drops the paint
      /* Your own kart is built from what you picked, not from the lobby's copy
         of it. The lobby hands over the grid the moment you join, before it has
         heard your look, so its copy of you is still the default and your
         driver, body and paint all came out as Pip in a formula car. */
      const mine = rk ? (!rk.watch && p.id === rk.me) : p.id === (net && net.id);
      const look = unpackLook(p.cast);
      // everybody else's cosmetics come from their profile, by name
      const theirs = mine ? null : styleFor(p.name, st => restyleKart(p.id, p.cast, st));
      grid.push(addKart(mine ? myRacer() : racerOf(look.cast, look.colour), {
        id: p.id, name: p.name, remote: !mine, build: mine ? myBuild : look.build,
        style: mine ? styleNow() : theirs, cast: p.cast,
      }));
    }
    me = karts.find(k => k.id === (rk ? (rk.watch ? -1 : rk.me) : (net && net.id))) || null;
    // the other driver in a ranked battle is there to race, not to hit
    if (rk && !rk.watch) for (const k of karts) if (k !== me) ghostKart(k);
    if (!me) spectating = true;
  } else if (replay) {
    // watching: nobody on the grid at all, only the ghost
    me = null;
    spectating = true;
  } else {
    spectating = false;
    me = addKart(myRacer(), { id: 'me', name: myName || 'You', build: myBuild, style: styleNow() });
  }
  const solo = !field || !field.length;
  quietRound = !!rk || (solo && (mode === 'tt' || replay));
  dressQuiet();
  // Fill the grid with computer drivers, but only when you are racing on your
  // own. A lobby with one person in it is still a lobby: the next person to turn
  // up should find a grid of people rather than a field of robots. Not in a
  // time trial, and not while watching a replay.
  if (solo && !quietRound) {
    let s = (seed | 0) || 1234;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const pool = RACERS.filter(r => !(me && me.who === r));
    for (let n = karts.length; n < GRID; n++) {
      const r = pool[(n - 1 + pool.length) % pool.length];
      const k = addKart(r, { id: 'bot' + n, name: r.name, bot: true });
      k.topMul = BOT_TOP;
      const br = makeBrain(k, 0.52 + rnd() * 0.42, 99 + n * 17);
      br.bot = true;                    // the grid keeps its distance; the autopilot does not
      br.mul = 1;
      br.wob = rnd() * Math.PI * 2;
      brains.push(br);
    }
    // the best drivers keep the places furthest up the road
    brains.slice().sort((a, b) => b.skill - a.skill)
      .forEach((br, i) => { br.gap0 = GAPS[Math.min(i, GAPS.length - 1)]; });
  }
  // a ghost you asked for, on its own track, when you are racing on your own
  const ghostHere = !(field && field.length) && !!ghostWant && ghostWant.theme === themeId;
  placeOnGrid(ghostHere ? Math.max(0, Math.min(15, ghostWant.slot | 0)) : 0);
  if (rk) rkGrid();
  if (ghostHere) {
    if (ghostWant.track && ghostWant.track !== trackPrint) {
      say('That ghost was set on an older layout of this track, so it sits this one out.', 'sys');
    } else {
      ghost = makeGhost(scene, ghostWant, ghostWant.label);
    }
  }
  snapCamera();
  // every material in the world compiled now, behind the countdown, instead of the first time each is seen
  try { if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {}); } catch (e) {}
  spectating = !me;
  watchId = null;
  specKey = '';
  const lobby = asPhase === 'wait';
  phase = lobby ? 'wait' : 'count';
  phaseT = lobby ? 0 : 4.2;
  el('watch').classList.toggle('on', spectating && !lobby);
  el('results').classList.remove('on');
  el('hud').classList.add('on');
  hudItem();
  lobbyShow(lobby);
  makeTags();
  rkReport();
  if (rk) say(rk.watch ? (rk.single ? 'Watching ' + esc(rk.players[0].name) + '.' : 'Watching a ranked battle.') : 'Ranked against <b>' + esc(rk.opp.name) + '</b>. Three laps, '
    + rk.left + (rk.left === 1 ? ' restart' : ' restarts') + ' left.', 'sys');
  else say(lobby ? 'In the lobby. Drive about, and press ' + keyName(bind.go[0]) + ' when everybody is here.'
            : (spectating ? 'Watching this race. You are in the next one.' : 'Three laps. Good luck.'), 'sys');
}

/* --------------------------------------------------------------- the laps --- */
function cpOf(i) { return Math.floor(i / track.samples.length * CPN) % CPN; }

function lapLogic(k, pr) {
  const c = cpOf(pr.i);
  const next = (k.cpi + 1) % CPN;
  if (c === next) {
    k.cpi = c;
    if (c === 0) {
      k.lap++;
      if (k === me) { me.lapTimes = me.lapTimes || []; me.lapTimes.push(+(raceTime - (me.lapStart || 0)).toFixed(2)); me.lapStart = raceTime; }
      if (k.lap > LAPS) finishKart(k);
      else if (k === me) {
        snd.lapChime();
        notice((k.lap === LAPS ? 'Final lap' : 'Lap ' + k.lap) + ghostSplit(k.lap - 2), speedSplit(k.lap - 2));
        if (k.lap === LAPS) say('Final lap.', 'sys');
      }
    }
  }
}

function finishKart(k) {
  if (k.finished) return;
  k.finished = 1;
  k.time = raceTime;
  k.lap = LAPS;
  results.push(k);
  k.place = results.length;
  if (k === me) {
    notice((rk ? 'Finished! ' + time(raceTime) : ord(results.length) + '!') + ghostSplit(LAPS - 1), speedSplit(LAPS - 1));
    snd.fanfare(results.length <= 3);
    showResults(false);
  }
  if (k === me && net) net.finish(raceTime, results.length);
  if (k === me) postRun(true);
  if (k === me && rk && !rk.watch && !rk.res) { rk.done = true; rkNet.finish(+raceTime.toFixed(2)); rkHud(true); }
}

/* Who the camera, the HUD and the engine note are all following.

   Spectating used to mean "whoever is leading", worked out fresh from the
   running order every single frame. Two cars swapping places swapped the
   camera with them, mid corner, with no warning: you were not watching a
   driver, you were watching a position. It follows one car now until you pick
   another, and only falls back to the leader when the car you picked has left
   the race. */
function watched() {
  if (replay && ghost) return ghost.k;
  if (!spectating) return me;
  if (watchId) {
    const k = karts.find(q => q.id === watchId);
    if (k) return k;
  }
  const lead = order()[0] || me || null;
  watchId = lead ? lead.id : null;
  return lead;
}
/* Switching. The camera is cut rather than flown: a chase camera lerping two
   hundred metres across the infield to catch up with somebody else is a second
   and a half of looking at the scenery. */
function watchWho(id) {
  if (!spectating) return;
  if (!karts.some(q => q.id === id)) return;
  watchId = id;
  specKey = '';
  snapCamera();
  drawWatchBar();
}
function watchStep(d) {
  const list = order();
  if (!spectating || !list.length) return;
  const at = list.findIndex(k => k.id === watchId);
  watchWho(list[((at < 0 ? 0 : at) + d + list.length) % list.length].id);
}
/* The switcher along the bottom: one button a driver, in running order, the
   one you are watching lit. Rebuilt only when the order or the pick actually
   changes, because replacing the markup every frame throws away the click you
   are in the middle of making. */
function drawWatchBar() {
  const box = el('spec');
  if (!box) return;
  const on = spectating && (phase === 'race' || phase === 'count');
  box.classList.toggle('on', on);
  if (!on) { specKey = ''; box.innerHTML = ''; return; }
  const list = order();
  const cur = watched();
  const key = list.map(k => k.id + ':' + k.place).join(',') + '|' + (cur ? cur.id : '');
  if (key === specKey) return;
  specKey = key;
  /* The two arrows are always in the markup and only shown where there is no
     room for the full strip, which on a phone is everywhere: the standings
     panel takes three quarters of the screen. There the driver buttons other
     than the one you are on are hidden, so what is left reads as previous,
     who you are watching, next. */
  box.innerHTML =
    '<button type="button" class="step" data-step="-1" aria-label="Watch the driver ahead">&#8249;</button>'
    + list.map(k => {
      const col = k.who ? ('#' + k.who.kart.toString(16).padStart(6, '0')) : '#ffffff';
      return '<button type="button" data-id="' + esc(String(k.id)) + '"'
        + (cur && k.id === cur.id ? ' class="on"' : '') + '>'
        + '<i style="background:' + col + '"></i>'
        + '<b>' + k.place + '</b><span class="nm">' + esc(k.name) + '</span></button>';
    }).join('')
    + '<button type="button" class="step" data-step="1" aria-label="Watch the driver behind">&#8250;</button>';
}

function order() {
  // everybody still going, sorted by how far round they are
  const live = karts.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.time - b.time;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return lapProg(b, track) - lapProg(a, track);
  });
  live.forEach((k, i) => { k.place = i + 1; });
  return live;
}

/* --------------------------------------------------------------- the items -- */
// how many you can be carrying at once, the one in the slot included
const SLOTS = 3;
function heldCount(k) { return (k.item ? 1 : 0) + k.queue.length; }

/* ------------------------------------------------------------- the rails ---
   On: in the air, within a metre and a bit of a rail sideways, pointing along
   it and moving. The kart locks onto it at the height of its top. Along it:
   pulled along the rail at a little over its own top speed, with sparks off the
   wheels, steering doing nothing. Off: at the end of the rail, or the moment
   you press hop again, with a small hop off and a boost for having ridden it. */
function tryRail(k, pr) {
  const R = track.rails;
  /* A straight hop, not a drift: the hop that starts a drift is the same
     button, and a slide through a corner that happened to pass a rail should
     stay a slide. */
  if (!R || !R.length || !pr || k.hop < 0.25 || k.drift !== 0 || k.speed < 10 || k.spin > 0 || k.rescue || k.falling) return;
  const N = track.samples.length;
  for (const r of R) {
    const j = ((pr.i - r.i0) % N + N) % N;
    if (j > r.len - 6) continue;
    const q = r.pts[j];
    if (Math.abs(pr.lateral - q.lat) > 1.4) continue;
    const a = r.pts[j], b = r.pts[j + 1];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    const fx = -Math.sin(k.yaw), fz = -Math.cos(k.yaw);
    if ((fx * tx + fz * tz) / tl < 0.88) continue;
    k.rail = { r, s: j * r.step, hopWas: true };
    k.drift = 0; k.driftT = 0; k.slide = 0;
    if (k === me) { notice('Rail grind!'); snd.boost(); }
    return;
  }
}
function rideRail(k, inp, dt) {
  const G = k.rail, r = G.r;
  const top = topSpeed(k);
  k.speed = Math.min(top * 1.12, Math.max(k.speed, 14) + 7 * dt);
  G.s += k.speed * dt;
  const hopNow = !!inp.hop && !G.hopWas;
  G.hopWas = !!inp.hop;
  const f = G.s / r.step, j = Math.floor(f);
  if (j >= r.pts.length - 1 || hopNow || k.spin > 0 || k.rescue) {
    k.rail = null;
    k.boost = Math.max(k.boost, 0.75);
    k.hopV = Math.max(k.hopV || 0, 4.2);
    if (hopNow) {
      // off to the road side of it
      const q = r.pts[Math.min(j, r.pts.length - 1)];
      const a = track.samples[q.i];
      k.pos.x -= a.n.x * r.side * 1.6; k.pos.z -= a.n.z * r.side * 1.6;
    }
    if (k === me) snd.boost();
    return stepKart(k, { gas: 1, brake: 0, steer: 0, hop: false }, track, dt);
  }
  const a = r.pts[j], b = r.pts[j + 1], t = f - j;
  k.pos.set(a.x + (b.x - a.x) * t, a.gy + (b.gy - a.gy) * t, a.z + (b.z - a.z) * t);
  k.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  k.hop = r.h + 0.18; k.hopV = 0;
  /* Ridden like a skateboard grinds one: the car turned a little across the
     rail and leaning over onto it, eased in over the first sixth of a second
     rather than snapped to. The slide only turns the body; the kart still runs
     straight along the rail. */
  G.tilt = Math.min(1, (G.tilt || 0) + dt * 6);
  k.drift = 0;
  k.slide = r.side * 0.5 * G.tilt;
  k.roll = -r.side * 0.3 * G.tilt;
  k.lean = -r.side * 0.12 * G.tilt;
  if (Math.random() < 0.8) {
    const back = k.pos.clone().setY(k.pos.y + r.h);
    spark(back, Math.random() < 0.5 ? 0xffe28a : 0xffffff, 1.2);
  }
  const pr = track.project(k.pos.x, k.pos.z, k.hint);
  k.hint = pr.i;
  k.prog = pr.s;
  return pr;
}

function pickupBox(k, b) {
  if (quietRound) return;
  // one roulette at a time, but it can land behind whatever you already have
  if (k.roulette > 0 || heldCount(k) >= SLOTS) return;
  b.taken = 6;
  k.roulette = 1.05;
  k.rollTo = rollItem(k.place, karts.length, track.rules.items);
  k.rollN = rollCount(k.rollTo, k.place, karts.length);
  // a gold box is two items, the second landing behind the first
  k.rollExtra = b.double ? 1 : 0;
  if (k === me) {
    el('slot').classList.add('spin'); el('slot').classList.remove('empty');
    if (b.double) notice('Double item box!');
  }
}

function useItem(k) {
  if (!k || !k.item || k.finished || phase !== 'race' || quietRound) return;
  const id = k.item;
  const def = ITEMS[id];
  if (def.self) {
    if (id === 'star') { k.star = 6.5; k.boost = Math.max(k.boost, 0.4); if (k === me) notice('Star!'); }
    if (id === 'oil') {
      // the computer drivers get slowed here; a person's screen is splattered by
      // the 'fire' that goes out with this, which their browser hears and this
      // one does not
      for (const o of karts) {
        if (o === k || o.remote || o.star > 0) continue;
        o.slow = Math.max(o.slow, 2.2);
      }
      if (k === me) notice('Oil can!');
      else oilSplat();                      // a computer driver got you
      puff(k.pos.clone().setY(k.pos.y + 1.2), 0x1b2030);
    }
    if (id === 'bullet') {
      k.bullet = 6.5;
      k.star = Math.max(k.star, 6.5);      // nothing touches you while it runs
      if (k === me) { notice('Bullet!'); snd.boost(); }
      for (let i = 0; i < 10; i++) spark(k.pos.clone().setY(k.pos.y + 0.5), 0x8fd3ff, 3);
    }
    if (id === 'plant') {
      plantOn(k);
      if (k === me) notice('Snapper!');
      puff(k.pos.clone().setY(k.pos.y + 1.1), 0x2f9440);
    }
    if (id === 'surge') {
      for (const o of karts) {
        if (o === k || o.place >= k.place || o.star > 0) continue;
        o.slow = 3; o.speed *= 0.6;
        if (o.remote && net && k === me) net.hitThem(o.id, 'surge');
      }
      if (k === me) notice('Surge!');
      puff(k.pos.clone().setY(k.pos.y + 1.4), 0x8fd3ff);
    }
  } else if (id === 'turbo') {
    k.boost = Math.max(k.boost, 1.25);
    if (k === me) snd.boost();
    for (let i = 0; i < 6; i++) spark(k.pos.clone().setY(k.pos.y + 0.4), 0xffd233, 2);
  } else {
    items.spawn(id, k, karts);
  }
  if (net && k === me) net.fire(id);
  spendItem(k);
}

/* One of whatever is in the slot is gone, however it went: thrown, dropped, or
   taken off you by the shell it was shielding you from. */
function spendItem(k) {
  k.itemN--;
  if (k.itemN <= 0) {
    const next = k.queue.shift();
    if (next) { k.item = next.id; k.itemN = next.n; }
    else { k.item = null; k.itemN = 0; }
  }
  if (k === me) { hudItem(); useHint(false); }
}

/* Tap to throw, hold to trail.

   Everything you can throw or drop can be held behind the car instead, which
   is the Mario Kart control: press and it comes out onto your tail, let go and
   it goes. A tap is a press and a release a frame apart, so throwing still
   works exactly as it did without a threshold anywhere. */
const CAN_TRAIL = { peel: 1, slick: 1, bolt: 1, seeker: 1, bomb: 1 };
function itemDown(k) {
  if (!k || !k.item || k.finished || phase !== 'race') return;
  if (k.holdKind) return;                       // already out there
  if (!CAN_TRAIL[k.item]) { useItem(k); return; }
  items.hold(k.item, k);
  if (k === me) snd.tick();
}
function itemUp(k) {
  if (!k || !k.holdKind) return;
  k.holdFor = 0;
  items.drop(k);
  useItem(k);
}

/* The computer drivers hold things too, for a second or three before they let
   go. Without it the shield only ever works one way, and running up the back
   of a car carrying a shell is free. */
function botItem(k) {
  if (!k || k.holdKind) return;
  if (CAN_TRAIL[k.item] && Math.random() < 0.55) {
    itemDown(k);
    k.holdFor = 1 + Math.random() * 2.6;
  } else useItem(k);
}

/* What the wheels are throwing up. The strip sections carry their own stuff
   down one side of the road; everywhere else it is whatever this place's ground
   is made of, which the theme already knows as a CSS colour. */
const STRIP_DUST = { sand: 0xd9a25e, ice: 0xe8f4ff, ash: 0x5a4a4e, snow: 0xf2f8ff };
let dustCol = 0xa8b0a0, dustFor = '';
function roughColour(pr) {
  if (pr && pr.strip && STRIP_DUST[pr.strip] !== undefined) return STRIP_DUST[pr.strip];
  if (dustFor !== worldTheme) {
    const g = themeById(worldTheme).ground;
    dustCol = /^#[0-9a-f]{6}$/i.test(g) ? parseInt(g.slice(1), 16) : 0xa8b0a0;
    dustFor = worldTheme;
  }
  return dustCol;
}

/* --------------------------------------------------------------- the world -- */
function stepWorld(dt) {
  const live = order();
  const leader = live[0] ? lapProg(live[0], track) : 0;

  /* Each driver holding its distance. How far up the road it is from you,
     against how far it wants to be, sets how hard it tries - and it only ever
     changes that slowly. The place it wants wanders a car length or three
     either way over most of a minute, so the order is not fixed for the race. */
  if (phase === 'race' && me && !me.finished) {
    const at = lapProg(me, track);
    for (const b of brains) {
      const k = b.kart;
      if (k.finished || b.gap0 === undefined) continue;
      const want = b.gap0 + 14 * Math.sin(raceTime * 0.085 + (b.wob || 0));
      const off = (lapProg(k, track) - at) - want;          // + : further ahead than it wants to be
      /* Held to small changes where you can see it, and given more rope where
         you cannot. A car a few lengths away that suddenly finds a third more
         speed is a car you watched cheat; the same car two hundred metres back,
         round a corner you will not see for eight seconds, is one you never
         saw at all - and it is the car an item or a pile-up put there, which
         a few per cent would never bring back. */
      const far = Math.max(0, Math.min(1, (Math.abs(off) - 40) / 100));
      const aim = Math.max(MUL_LO - far * 0.2, Math.min(MUL_HI + far * 0.22, 1 - off * GAP_GAIN));
      const step = MUL_RATE * dt;
      b.mul = (b.mul || 1) + Math.max(-step, Math.min(step, aim - (b.mul || 1)));
      k.topMul = BOT_TOP * b.mul;
    }
  }

  /* What a computer driver is trying to miss: whatever anybody has dropped on
     the road, plus whatever this place is doing at this instant. A boulder
     halfway across the road is a hazard; the same boulder off in the field is
     not, so the list is rebuilt every frame rather than placed once. */
  const dodge = items.hazards.concat(hazards.threats(raceTime));

  /* The autopilot follows whoever the player is, not whoever they were. A new
     round builds a new field, and the old car it was driving is finished and
     parked: left bound to that, the autopilot asks for no throttle at all and
     the new car sits on the line for the rest of the race. */
  if (autoBrain && me && autoBrain.kart !== me) autoBrain = makeBrain(me, 0.95, 4242);

  // the computer drivers, and the autopilot when a test is driving
  if (autoBrain) {
    autoBrain.hazards = dodge;
    autoBrain.input = phase === 'race' ? driveBrain(autoBrain, track, dt, karts, leader, useItem)
                                       : { gas: 0, brake: 0, steer: 0, hop: false };
  }
  for (const b of brains) {
    b.hazards = dodge;
    const inp = driveBrain(b, track, dt, karts, leader, botItem);
    b.input = inp;
  }

  for (const k of karts) {
    if (k.remote) continue;                       // somebody else's kart, they drive it
    let inp;
    if (k === me) inp = autoBrain ? (autoBrain.input || { gas: 1, brake: 0, steer: 0, hop: false }) : readInput();
    else {
      const b = brains.find(q => q.kart === k);
      inp = (b && b.input) || { gas: 1, brake: 0, steer: 0, hop: false };
      if (phase !== 'race') inp = { gas: 0, brake: 0, steer: 0, hop: false };
    }
    if (k.finished) inp = { gas: 1, brake: 0, steer: (brains.find(q => q.kart === k) ? 0 : 0), hop: false };
    // being carried back is not being driven: the balloon owns the car until it
    // puts it down, and a physics step in the middle of that fights it
    if (k.rescue) continue;
    const pr = k.rail ? rideRail(k, inp, dt) : stepKart(k, inp, track, dt);
    if (!k.rail) tryRail(k, pr);
    if (phase === 'race') lapLogic(k, pr);

    // a lane of boosters down one half of a straight
    if (pr.boostlane && phase === 'race') {
      if (k === me && k.boost <= 0.2) snd.boost();
      k.boost = Math.max(k.boost, 0.8);
    }

    // the tarmac furniture, which only counts once the race is on
    if (phase === 'race') for (const b of track.itemBoxes) {
      if (b.taken > 0) continue;
      if (Math.hypot(b.pos.x - k.pos.x, b.pos.z - k.pos.z) > 1.7) continue;
      pickupBox(k, b);
      // the box going is something everybody sees, whoever took it
      puff(b.pos.clone(), 0x8fd3ff);
      for (let n = 0; n < 7; n++) spark(b.pos.clone(), n % 2 ? 0xdff2ff : 0x2f7fd0, 2.2);
      if (k === me) snd.tick();
    }
    for (const p of track.boostPads) {
      if (Math.hypot(p.pos.x - k.pos.x, p.pos.z - k.pos.z) > p.w + 2) continue;
      if (k === me && k.boost <= 0.2) snd.boost();
      k.boost = Math.max(k.boost, p.ramp ? 1.2 : 0.85);
    }

    /* Pointing the wrong way. Measured against the road's own direction rather
       than against progress, because progress hardly moves while you are
       sitting still and facing backwards, which is exactly the moment somebody
       needs telling. It has to hold for most of a second before it says so:
       half a spin out points you the wrong way for an instant, and being shouted
       at for that is worse than not being told at all. */
    if (k === me && phase === 'race') {
      const wrong = (-Math.sin(k.yaw) * pr.t.x + -Math.cos(k.yaw) * pr.t.z) < -0.35;
      wrongT = wrong ? Math.min(2, wrongT + dt) : 0;
      el('wrong').classList.toggle('on', wrongT > 0.7);
    }

    // The ramps do not throw anybody any more: kart.js works out that the road
    // has stopped climbing under it and keeps whatever lift it had, which is how
    // a car leaves a jump. All that is left here is cancelling a drift, since
    // there is nothing to slide on up there.
    if (k.hop > 0.3 && k.drift !== 0) { k.drift = 0; k.driftT = 0; }

    // a few bubbles on the way past, for whoever is under the surface
    if (k.wet && Math.random() < 0.22) {
      puff(k.pos.clone().setY(k.pos.y + 0.7 + Math.random()), 0x9fd8ff);
    }

    // back on the ground after a jump: a puff of dust and a thump
    if (k.landed) {
      k.landed = 0;
      puff(k.pos.clone().setY(k.pos.y + 0.2), 0xcfd6e0);
      if (k === me) { snd.land(); shake = Math.min(1, shake + 0.45); }
    }

    // the roulette landing
    if (k.roulette > 0) {
      k.roulette -= dt;
      if (k.roulette <= 0) {
        if (k.item) k.queue.push({ id: k.rollTo, n: k.rollN });
        else { k.item = k.rollTo; k.itemN = k.rollN; }
        if (k.rollExtra && heldCount(k) < SLOTS) {
          const id2 = rollItem(k.place, karts.length, track.rules.items);
          k.queue.push({ id: id2, n: rollCount(id2, k.place, karts.length) });
        }
        k.rollExtra = 0;
        if (k === me) { el('slot').classList.remove('spin'); el('slot').classList.add('land'); setTimeout(() => el('slot').classList.remove('land'), 300); hudItem(); snd.land(); useHint(true); }
      }
    }
    // the drift sparks, and the boost trail
    if (k.drift !== 0 && k.speed > 8 && Math.random() < 0.72) {
      const back = k.pos.clone().setY(k.pos.y + 0.25);
      back.x += Math.sin(k.yaw) * 1.1; back.z += Math.cos(k.yaw) * 1.1;
      /* The sparks are the charge meter, so they keep their own colours: white
         while nothing is charged, then blue, orange and purple as each tier
         comes up, which is exactly how you read a drift in Mario Kart without
         looking away from the road. */
      const tier = driftTier(k);
      const SPARK = [0xdfe6ef, 0x8fd3ff, 0xff9b2f, 0xc06bff];
      spark(back, SPARK[tier], 1.2 + tier * 0.4,
            k.trail && k.trail.shape, (k.trail ? k.trail.size : 1) * (1 + tier * 0.22));
    }
    /* The tyres throw up whatever they are standing on. Mostly that is a strip:
       the barrier stands on the edge of the tarmac all the way round, so the
       grass beyond it is not somewhere a car can get to, and the rough on
       these circuits is the band of sand, ice or ash laid down one side of a
       straight instead. Driving onto one costs you half your speed and until
       now said nothing at all about it, which on Redrock is a strip of sand
       the same colour as the desert behind it. */
    if ((pr.strip || k.offroad) && Math.abs(k.speed) > 6 && Math.random() < 0.5) {
      const at = k.pos.clone().setY(k.pos.y + 0.16);
      const sx = (Math.random() < 0.5 ? 1 : -1) * 0.72;
      at.x += Math.sin(k.yaw) * 1.05 + Math.cos(k.yaw) * sx;
      at.z += Math.cos(k.yaw) * 1.05 - Math.sin(k.yaw) * sx;
      puff(at, roughColour(pr));
    }

    /* And each tier arriving says so. The sparks change colour behind you,
       which is no use at all at forty metres a second with a corner to look
       at, so the useful half of it is the note. */
    if (k === me) {
      const t2 = k.drift !== 0 ? driftTier(k) : 0;
      if (t2 > (k.tierWas || 0)) snd.charge(t2);
      k.tierWas = t2;
    }
    // the turbo going off, which until now was the one boost in the game that
    // made no noise whatsoever
    if (k.mtFired) {
      if (k === me) snd.turbo(k.mtFired);
      k.mtFired = 0;
    }
    /* The boost trail, out of the exhausts this car actually has rather than
       out of a point behind it, in whichever style it was built with. A star
       overrules it: being invincible should look the same on everybody. */
    if ((k.boost > 0 || k.star > 0) && Math.random() < 0.7) {
      const tr = k.trail || { shape: 'spark', hot: 0xffd233, cool: 0xff8a1f, size: 1 };
      const pipes = k.exhaust && k.exhaust.length ? k.exhaust : [{ x: 0, y: 0.3, z: -1.3 }];
      const e = pipes[(Math.random() * pipes.length) | 0];
      const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw);
      const back = k.pos.clone().setY(k.pos.y + k.hop + e.y);
      back.x += e.x * cs + e.z * sn;
      back.z += -e.x * sn + e.z * cs;
      spark(back, k.star > 0 ? 0xffd233 : (Math.random() < 0.5 ? tr.hot : tr.cool), 1.5,
            k.star > 0 ? 'star' : tr.shape, tr.size);
    }
    /* A flooded engine, out of the same pipes the boost comes from. Thick grey
       smoke rather than sparks, and a lot of it at first, thinning as the
       motor picks up - so you can see whose start went wrong from behind them
       as well as reading it on your own screen. */
    if (k.stall > 0) {
      const pipes = k.exhaust && k.exhaust.length ? k.exhaust : [{ x: 0, y: 0.3, z: -1.3 }];
      const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw);
      const n = k.stall > 1.4 ? 2 : 1;
      for (let q = 0; q < n; q++) {
        const e = pipes[(Math.random() * pipes.length) | 0];
        const back = k.pos.clone().setY(k.pos.y + k.hop + e.y + 0.1);
        back.x += e.x * cs + e.z * sn;
        back.z += -e.x * sn + e.z * cs;
        puff(back, Math.random() < 0.5 ? 0x6b6f78 : 0x3c414c);
      }
    }
    if (k.wallHit) {
      k.wallHit = 0;
      puff(k.pos.clone().setY(k.pos.y + 0.6), 0xfff6e2);
      if (k === me) { snd.bump(); shake = Math.min(1, shake + 0.3); }
    }
  }

  /* Who is sitting in whose air. Directly behind, close, and going about the
     same way: hold it and the car ahead drags you along with it. */
  for (const k of karts) {
    // A slipstream is a hole in the air somebody punched at speed. Sitting
    // behind a car at walking pace is not drafting, it is queueing.
    if (k.finished || k.spin > 0 || k.speed < TUNE.top * 0.6) { k.draftT = 0; continue; }
    let inAir = false;
    const fx = -Math.sin(k.yaw), fz = -Math.cos(k.yaw);
    for (const o of karts) {
      if (o === k || o.finished) continue;
      const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4 || d > 13) continue;
      if ((dx * fx + dz * fz) / d < 0.93) continue;         // not straight ahead
      if (Math.abs(o.speed - k.speed) > 16) continue;       // not travelling with them
      inAir = true;
      break;
    }
    k.draftT = inAir ? k.draftT + dt : 0;
    if (k === me && k.draftT > 0.5 && Math.random() < 0.5) {
      const nose = k.pos.clone().setY(k.pos.y + 0.8);
      nose.x += fx * 1.6; nose.z += fz * 1.6;
      spark(nose, 0x8fd3ff, 0.6, 'bubble', 0.7);
    }
  }

  // karts touching karts
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      if (a.remote && b.remote) continue;
      if (a.ghost || b.ghost) continue;
      if (bump(a, b)) {
        /* On an anti-gravity rail a collision is a favour. Both cars spin and
           both are thrown forward, so the quick line through the section is
           straight through whoever is on it: the one place in the game where
           the thing you spend the rest of the lap avoiding is worth hunting. */
        if (track.project(a.pos.x, a.pos.z, a.hint).agrav) {
          for (const k of [a, b]) {
            if (k.remote) continue;
            k.boost = Math.max(k.boost, 0.75);
            k.spinB = 0.45;
          }
          if (a === me || b === me) {
            snd.boost();
            spark(me.pos.clone().setY(me.pos.y + 0.7), 0x8fe4ff, 1, 'star', 1.1);
          }
        }
        // a star, or a bullet, ploughs straight through anybody else
        if (a.star > 0 && b.star <= 0 && !b.remote) spinOut(b, false);
        if (b.star > 0 && a.star <= 0 && !a.remote) spinOut(a, false);
      }
    }
  }

  /* Anybody over the edge. The fall is the physics; this is what comes for
     them afterwards, and it costs them the time it takes and all their speed,
     which is the right price for a gap you can misjudge. */
  for (const k of karts) {
    if (k.falling > 0.35 && !k.rescue && !k.finished) {
      rescue.send(k);
      if (k === me) { notice('Fished out'); snd.spin(); }
    }
  }
  rescue.step(dt);

  /* The Snappers. Each one belongs to the kart it is bolted to, so a bite is
     decided by whoever owns the plant and the kart that got eaten is told the
     same way a shell tells it. */
  stepPlants(dt, karts, items.hazards, (owner, victim, kind, dir) => {
    if (kind === 'hazard') {
      items.eat(victim);
      puff(new THREE.Vector3(victim.x, me ? me.pos.y + 0.6 : 0.6, victim.z), 0x2f9440);
      if (owner === me) snd.tick();
      return;
    }
    if (!victim.remote) spinOut(victim, false, { x: dir.x, z: dir.z, speed: 18 });
    if (victim.remote && owner === me && net) net.hitThem(victim.id, 'plant');
    puff(victim.pos.clone().setY(victim.pos.y + 0.9), 0x2f9440);
    if (victim === me) { notice(hitBy(owner.id, 'plant')); snd.spin(); }
    if (owner === me) snd.bump();
  });

  /* Whatever this place does that the others do not. It runs off the race
     clock rather than off dt, so every browser in the room has the gates shut
     and the geysers blowing at the same moment without anybody saying so. */
  if (!quietRound) hazards.step(dt, raceTime, karts, (k, what) => {
    if (k !== me || !what) return;
    notice('HIT BY ' + what.toUpperCase());
    snd.bump();
  });

  // the cones, which go where they are knocked and stay there
  if (!quietRound) cones.step(dt, karts, (k, i, vx, vz) => {
    if (k === me && net && net.alive) net.cone(i, vx, vz);
    if (k === me) snd.bump();
  });

  items.step(dt, karts, (k, kind, by) => {
    if (k === me) { notice(hitBy(by, kind)); snd.spin(); }
    if (kind === 'bomb' && Math.hypot(k.pos.x - (me ? me.pos.x : 0), k.pos.z - (me ? me.pos.z : 0)) < 22) snd.bang();
    // my shell, their kart: their browser has to be told, it owns that kart
    if (k.remote && me && by === me.id && net) net.hitThem(k.id, kind);
  }, k => {
    // it took the hit instead of you, and went with it
    if (k === me) { notice('Blocked!'); snd.bump(); }
    puff(k.pos.clone().setY(k.pos.y + 0.7), 0xfff6e2);
    spendItem(k);
  });

  /* And it is not yours any more once you have been spun round, finished, or
     left the road: a car cartwheeling down the circuit is not holding
     anything, whatever the picture says. */
  for (const k of karts) {
    if (!k.holdKind) continue;
    if (k.spin > 0 || k.finished || k.rescue || phase !== 'race') {
      k.holdFor = 0;
      items.drop(k);
      spendItem(k);
      continue;
    }
    // and a computer driver lets go of it when it has held it long enough
    if (k.holdFor > 0) { k.holdFor -= dt; if (k.holdFor <= 0) itemUp(k); }
  }

  // the boxes come back
  for (const b of track.itemBoxes) if (b.taken > 0) b.taken -= dt;
  if (customWorld) customWorld.step(karts, dt);
  dressTrack();

  for (const k of karts) apply(k);
  /* The run being recorded, from the pose it was just drawn in, and the one
     being raced against. The ghost sits on the grid until the lights go. */
  if (phase === 'race' && me && !spectating && !me.finished) {
    const v = Math.abs(me.speed);
    if (v > (me.topRun || 0)) me.topRun = v;
    me.distRun = (me.distRun || 0) + v * dt;
  }
  if (phase === 'race' && me && !spectating) {
    recorder.tick(raceTime, me);
    if (me.finished) { if (recorder.active) keepEarly(); else finishRun(); }
  }
  if (ghost) poseGhost(ghost, phase === 'race' ? raceTime : 0, dt);
  if (ghost && replay) {
    ghost.k.lap = Math.min(LAPS, 1 + (ghost.meta.laps || []).filter(t => t <= raceTime).length);
    ghost.k.place = 1;
  }
}

/* the item boxes spin and bob, and hide for a moment after being taken */
let dressT = 0;
const dM = new THREE.Matrix4(), dQ = new THREE.Quaternion(), dE = new THREE.Euler(), dS = new THREE.Vector3(), dP = new THREE.Vector3();
function dressTrack() {
  dressT += 0.016;
  const m = dM, q = dQ, e = dE, s = dS, p = dP;
  track.itemBoxes.forEach((b, i) => {
    const on = b.taken <= 0;
    e.set(dressT * 0.8 + i, dressT * 1.3 + i, 0);
    q.setFromEuler(e);
    s.setScalar(on ? (b.double ? 1.18 : 1) : 0.001);
    p.set(b.pos.x, b.pos.y + Math.sin(dressT * 2 + i) * 0.16, b.pos.z);
    m.compose(p, q, s);
    track.boxMesh.setMatrixAt(i, m);
    // the core turns the other way inside the shell
    e.set(-dressT * 1.6 + i, dressT * 2.1 + i, dressT * 0.7);
    q.setFromEuler(e);
    s.setScalar(on ? 1 + Math.sin(dressT * 4 + i) * 0.08 : 0.001);
    m.compose(p, q, s);
    track.coreMesh.setMatrixAt(i, m);
  });
  track.boxMesh.instanceMatrix.needsUpdate = true;
  track.coreMesh.instanceMatrix.needsUpdate = true;
}

/* -------------------------------------------------------------- the camera -- */
let camMode = 0, camHidden = null;
let camPos = new THREE.Vector3(), camAim = new THREE.Vector3();
let camRoll = 0;                  // how far the picture leans into a slide
let shake = 0;                    // and how hard the last thing hit it
function snapCamera() {
  // whoever is being watched, which when spectating is not me and never was
  const watch = watched() || karts[0];
  if (!watch) return;
  const c = CAM[camMode];
  camPos.set(watch.pos.x + Math.sin(watch.yaw) * c.d, watch.pos.y + c.h, watch.pos.z + Math.cos(watch.yaw) * c.d);
  if (c.aim) camAim.set(watch.pos.x - Math.sin(watch.yaw) * c.aim, watch.pos.y + 1.1, watch.pos.z - Math.cos(watch.yaw) * c.aim);
  else camAim.set(watch.pos.x, watch.pos.y + 1.25, watch.pos.z);
  camera.position.copy(camPos);
  camera.lookAt(camAim);
}
// d is how far behind, h how high, aim how far up the road it looks instead of
// at the kart, hide whether the kart is in the way of its own camera
const CAM = [
  { name: 'Chase',    d: 6.8,  h: 2.9,  fov: 62 },
  { name: 'Far',      d: 10.5, h: 4.6,  fov: 58 },
  { name: 'Close',    d: 3.4,  h: 1.9,  fov: 70 },
  { name: 'Driver',   d: 0.15, h: 1.45, fov: 78, aim: 15, hide: true },
  { name: 'Overhead', d: 2.2,  h: 15,   fov: 52 },
];
function stepCamera(dt) {
  const watch = watched();
  if (!watch) return;
  /* The sun's shadow box goes where the racing is, and it does that whether or
     not a test has parked the camera somewhere to take a picture. It used to
     sit below the early return: park the camera and the box stayed wherever it
     was last left, which on any circuit bigger than the box itself meant
     nothing in shot cast a shadow at all. */
  sun.position.set(watch.pos.x + 120, 190, watch.pos.z + 80);
  sun.target.position.set(watch.pos.x, 0, watch.pos.z);
  if (camPinned) return;
  const c = CAM[camMode];
  const back = down('look') ? -1 : 1;
  // sit behind where the kart is going, not where it is pointing, so a drift
  // reads as the kart cocked across a view that still follows the road
  const yaw = watch.yaw + watch.slide * 0.35;
  /* The camera drops back when you are quick and drops back further on a
     boost. Widening the lens alone makes the world stretch; pulling the camera
     with it makes the car pull away from you, which is what speed feels like. */
  const pull = c.d * (1 + Math.min(0.18, Math.abs(watch.speed) / TUNE.top * 0.12)
    + (watch.boost > 0 ? 0.16 : 0) + (watch.bullet > 0 ? 0.3 : 0));
  /* A small hop the camera barely notices. A real flight - a car sailing over
     a canyon several metres up - it climbs with and looks at, or the car and
     its wing go out of the top of the screen while the camera stares at the
     road it left. */
  const air = Math.max(0, (watch.hop || 0) - 1);
  const want = new THREE.Vector3(
    watch.pos.x + Math.sin(yaw) * pull * back,
    watch.pos.y + c.h + watch.hop * 0.4 + air * 0.5,
    watch.pos.z + Math.cos(yaw) * pull * back
  );
  const look = new THREE.Vector3(watch.pos.x, watch.pos.y + 1.25 + air * 0.85, watch.pos.z);
  if (c.aim) {
    look.set(watch.pos.x - Math.sin(yaw) * c.aim * back, watch.pos.y + 1.1 + air * 0.85,
             watch.pos.z - Math.cos(yaw) * c.aim * back);
  }
  // from the driver's seat the kart is only in the way
  if (camHidden && (camHidden !== watch || !c.hide)) { camHidden.group.visible = true; camHidden = null; }
  if (c.hide) { watch.group.visible = false; camHidden = watch; }
  const k = 1 - Math.exp(-(phase === 'count' ? 3 : 7.5) * dt);
  camPos.lerp(want, k);
  camAim.lerp(look, 1 - Math.exp(-11 * dt));
  camera.position.copy(camPos);
  camera.lookAt(camAim);

  /* Where the sense of speed comes from.

     The field of view opens as you go faster and snaps wider again on a boost,
     which is the single thing that makes thirty miles an hour and sixty feel
     different rather than just look different. The camera rolls a little into a
     drift, so a slide is something the whole picture does rather than something
     the car does in front of you. Both are small numbers; both are the
     difference between a racing game and a driving one. */
  const fast = Math.min(1, Math.abs(watch.speed) / (TUNE.top * 1.15));
  const fov = c.fov + fast * 7
    + (watch.boost > 0 ? 9 : 0) + (watch.star > 0 ? 3 : 0) + (watch.bullet > 0 ? 13 : 0);
  camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-(watch.boost > 0 ? 12 : 5) * dt));
  camRoll = lerp(camRoll, -watch.slide * 0.22 - watch.drift * 0.035, 1 - Math.exp(-7 * dt));
  /* And a kick when something happens to you. It decays in about a third of a
     second, so it reads as an impact rather than as a camera fault. */
  if (shake > 0.002) {
    const t = performance.now() * 0.001;
    camera.position.x += Math.sin(t * 61) * shake * 0.22;
    camera.position.y += Math.sin(t * 47) * shake * 0.16;
    camRoll += Math.sin(t * 53) * shake * 0.04;
    shake = Math.max(0, shake - dt * 3.2);
  }
  camera.rotation.z += camRoll;
  camera.updateProjectionMatrix();
}

/* ----------------------------------------------------------------- the HUD -- */
function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'][(n % 10 > 3 || (n % 100 - n % 10) === 10) ? 0 : n % 10] || 'th';
  return n + s;
}
/* A word about the thing that just landed, for as long as it takes to read it.
   It names whatever the use key is bound to, and goes the moment the slot is
   empty, so it can never be telling you to press something for nothing. */
let hintT = 0;
function useHint(on) {
  hintT = on ? 3.6 : 0;
  const h = el('usehint');
  if (!h) return;
  h.querySelector('i').textContent = keyName(bind.item[0] || 'e');
  h.classList.toggle('on', !!on);
}
function hintStep(dt) {
  if (hintT <= 0) return;
  hintT -= dt;
  if (hintT <= 0 || !me || !me.item) { hintT = 0; el('usehint').classList.remove('on'); }
}

function hudItem() {
  const slot = el('slot'), face = el('face');
  const q = el('slotq');
  if (q) {
    q.innerHTML = (me ? me.queue : []).map(it =>
      '<div class="q">' + ITEMS[it.id].face + (it.n > 1 ? '<span class="n">x' + it.n + '</span>' : '') + '</div>'
    ).join('');
  }
  if (!me || !me.item) { slot.classList.add('empty'); face.innerHTML = ''; return; }
  slot.classList.remove('empty');
  face.innerHTML = ITEMS[me.item].face + (me.itemN > 1 ? '<span class="n">x' + me.itemN + '</span>' : '');
}
/* Somebody's oil, on your glass. Fresh blobs each time so it never lands the
   same way twice, and they wipe themselves off after a few seconds. */
/* Water on the glass: it beads up while you are under and runs off when you
   come out. The drops are made once on the way in, because making them every
   frame is a lot of DOM for something nobody is looking at yet. */
let wetOn = false, dryT = 0;
function wetGlass(under, dt) {
  const box = el('drops');
  if (!box) return;
  if (under && !wetOn) {
    wetOn = true; dryT = 0;
    box.classList.remove('off');
    const n = 16 + Math.floor(Math.random() * 10);
    let html = '';
    for (let i = 0; i < n; i++) {
      const w = 0.7 + Math.random() * 2.4;
      html += '<b style="left:' + (Math.random() * 96).toFixed(1) + '%;top:'
        + (Math.random() * 88).toFixed(1) + '%;width:' + w.toFixed(2) + 'vmin;height:'
        + (w * (1 + Math.random() * 0.5)).toFixed(2) + 'vmin;animation-delay:'
        + (Math.random() * 0.35).toFixed(2) + 's"></b>';
    }
    box.innerHTML = html;
    box.classList.add('on');
  } else if (!under && wetOn) {
    wetOn = false; dryT = 1.3;
    box.classList.add('off');
  }
  if (dryT > 0) {
    dryT -= dt;
    if (dryT <= 0) { box.classList.remove('on', 'off'); box.innerHTML = ''; }
  }
}

let oilT = 0;
function oilSplat() {
  const box = el('oil');
  if (!box) return;
  const n = 7 + Math.floor(Math.random() * 4);
  let html = '';
  for (let i = 0; i < n; i++) {
    const w = 12 + Math.random() * 26, h = w * (0.55 + Math.random() * 0.6);
    html += '<i style="left:' + (Math.random() * 92 - 4).toFixed(1) + '%;top:'
      + (Math.random() * 86 - 4).toFixed(1) + '%;width:' + w.toFixed(1) + 'vmin;height:'
      + h.toFixed(1) + 'vmin;--r:' + (Math.random() * 360).toFixed(0) + 'deg;animation-delay:'
      + (Math.random() * 0.18).toFixed(2) + 's"></i>';
  }
  box.innerHTML = html;
  box.classList.add('on');
  oilT = 3.4;
  snd.bump();
}
function oilStep(dt) {
  if (oilT <= 0) return;
  oilT -= dt;
  if (oilT <= 0) { el('oil').classList.remove('on'); el('oil').innerHTML = ''; }
}

/* Everybody's name over their kart, yours in gold so you can pick yourself out
   of a pack. One div each, moved by projecting the kart's head through the
   camera: eight elements is nothing, and text drawn by the browser stays crisp
   at any distance in a way a texture does not. */
let tagFor = new Map();
function makeTags() {
  const box = el('tags');
  if (!box) return;
  box.innerHTML = '';
  tagFor = new Map();
  for (const k of karts) {
    const d = document.createElement('div');
    d.className = 'tag' + (k === me ? ' me' : '') + (k.ghost ? ' ghost' : '');
    d.textContent = k.name;
    box.appendChild(d);
    tagFor.set(k, d);
  }
  if (ghost) {
    const d = document.createElement('div');
    d.className = 'tag ghost';
    d.innerHTML = icon('ghost') + ' ' + esc(ghost.k.name);
    box.appendChild(d);
    tagFor.set(ghost.k, d);
  }
}
const tagV = new THREE.Vector3();
const tagLit = [], tagPut = [];
// only touch the style when it changes: an unchanged write still dirties the element
function tagOp(d, v) { if (d._op !== v) { d._op = v; d.style.opacity = v; } }
function drawTags() {
  if (!tagFor.size) return;
  const w = innerWidth, h = innerHeight;
  tagLit.length = 0;
  for (const [k, d] of tagFor) {
    if (k === me && camMode === 3) { tagOp(d, '0'); continue; }
    if (k.ghost && !k.group.visible) { tagOp(d, '0'); continue; }
    tagV.set(k.pos.x, k.pos.y + k.hop + 2.5, k.pos.z).project(camera);
    const far = k === me ? 0 : Math.hypot(k.pos.x - camPos.x, k.pos.z - camPos.z);
    const x = (tagV.x * 0.5 + 0.5) * w, y = (-tagV.y * 0.5 + 0.5) * h;
    if (tagV.z > 1 || far > 150 || y < 0 || y > h) { tagOp(d, '0'); continue; }
    tagLit.push({ k, d, x, y, far });
  }
  // nearest last onto the screen means nearest wins the space it wants
  /* The ghost's name before anybody else's but your own. It sits inside or
     beside your car for most of a close race, so its name is always the one
     colliding with somebody's, and it is the one you are racing. */
  const tagRank = x => (x.k === me ? -2 : x.k.ghost ? -1 : x.far);
  tagLit.sort((a, b) => tagRank(a) - tagRank(b));
  tagPut.length = 0;
  /* The standings sit over the top right and a name that slides under them is
     worse than no name: you get half a word and a guess. Read once, before any
     tag is touched, so this does not cost a layout per tag. */
  const bd = el('board');
  /* Its own box, not offsetParent: that is null for anything fixed whether it
     is on screen or not, so asking it quietly turned this check off. */
  /* Its box, read every half second rather than every frame: reading layout
     here forced the page to lay itself out again each frame (measured at a
     quarter of the game's CPU time), and the standings panel only moves when
     the window does. */
  const nowT = performance.now();
  if (!drawTags.box || nowT - drawTags.at > 500) { drawTags.box = bd ? bd.getBoundingClientRect() : null; drawTags.at = nowT; }
  const br = drawTags.box;
  const panel = br && br.width > 0 ? br : null;
  for (const t of tagLit) {
    /* Smaller the further away, which is how a name behaves in the world
       rather than on the glass, and it is what stops a distant pack reading
       as one long word. */
    const size = Math.max(10, (t.k === me ? 15 : 14) * (1 - Math.min(1, t.far / 150) * 0.42));
    const half = t.k.name.length * size * 0.32 + 4;
    // off the side of the screen it is half a name hanging on the bezel
    if (t.x - half < 2 || t.x + half > w - 2) { tagOp(t.d, '0'); continue; }
    /* Covered, not merely touching. A name that clips the corner of the card
       still reads; one that is mostly behind it is half a word and a guess. */
    if (panel && t.y > panel.top && t.y - size < panel.bottom) {
      const lap = Math.min(t.x + half, panel.right) - Math.max(t.x - half, panel.left);
      if (lap > half * 0.8) { tagOp(t.d, '0'); continue; }
    }
    /* And where two still land on each other, the far one gives way. Six karts
       at the vanishing point are a few pixels apart and their names ran into
       one another; "WreJuno Coco" is not a name, and the three you can read
       are worth more than the six you cannot. */
    let hit = 0;
    for (const q of tagPut) {
      if (Math.abs(t.x - q.x) < half + q.half && Math.abs(t.y - q.y) < (size + q.size) * 0.62) { hit = 1; break; }
    }
    if (hit) { tagOp(t.d, '0'); continue; }
    tagPut.push({ x: t.x, y: t.y, half, size });
    /* Scaled, not resized. A new font size every frame is a new text layout
       and a repaint of every tag, every frame; a scale is the compositor's job
       and costs nothing. The stroke scales with it, so it keeps its weight. */
    tagOp(t.d, t.far > 110 ? (1 - (t.far - 110) / 40).toFixed(2) : '1');
    const tf = 'translate(' + t.x.toFixed(1) + 'px,' + t.y.toFixed(1) + 'px) translate(-50%,-100%) scale('
      + (size / 15).toFixed(3) + ')';
    if (t.d._tf !== tf) { t.d._tf = tf; t.d.style.transform = tf; }
  }
}

/* Who did that to you. The thrower's id comes along with the hit, so the notice
   can name them rather than saying "Hit!" and leaving you to guess. */
function nameOf(id) {
  const k = karts.find(q => q.id === id);
  return k ? k.name : null;
}
function hitBy(by, kind) {
  const what = ITEMS[kind] ? ITEMS[kind].name : 'that';
  const who = nameOf(by);
  return who && by !== (me && me.id) ? 'Hit by ' + who + "'s " + what + '!' : 'Hit!';
}

// how long you have been pointing back down the road
let wrongT = 0;

let noticeT = 0;
function notice(text, sub) {
  el('notice').textContent = text;
  // a second, smaller line under it: the speed through the line, and against the ghost
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub.text;
    if (sub.cls) s.className = sub.cls;
    el('notice').appendChild(s);
  }
  el('notice').classList.add('on');
  noticeT = 1.6;
}
/* Speed lines. They only turn up when you are genuinely quick, and they get
   out of the way the moment you are not, so what they mark is the boost rather
   than the driving. Drawn in CSS because a full screen effect that costs one
   opacity write a frame is the right kind of cheap. */
function speedLines(watch, dt) {
  const el0 = el('speedlines');
  if (!el0) return;
  const fast = Math.max(0, Math.abs(watch.speed) / TUNE.top - 0.82);
  const want = Math.min(1, fast * 2.2 + (watch.boost > 0 ? 0.75 : 0) + (watch.bullet > 0 ? 1 : 0));
  linesAt = lerp(linesAt, want, 1 - Math.exp(-9 * dt));
  el0.style.opacity = linesAt < 0.02 ? '0' : (Math.min(1, linesAt) * 0.62).toFixed(3);
  el0.classList.toggle('hot', watch.boost > 0 || watch.bullet > 0);
}
let linesAt = 0;

/* The HUD writes only what has changed. Setting the same text again is not
   free: it replaces the text node, and the page lays that part out again. Sixty
   times a second, for numbers that change a few times a lap, it was most of the
   work the page did outside the 3D. */
const hudLast = {};
function hudText(id, v) {
  v = String(v);
  if (hudLast[id] === v) return;
  hudLast[id] = v;
  el(id).textContent = v;
}
function drawHud(dt) {
  oilStep(dt);
  hintStep(dt);
  drawTags();
  if (noticeT > 0) { noticeT -= dt; if (noticeT <= 0) el('notice').classList.remove('on'); }
  const watch = watched();
  drawWatchBar();
  if (watch) speedLines(watch, dt);
  // under the surface, if that is where whoever we are watching happens to be
  el('wet').classList.toggle('on', !!(watch && watch.wet));
  wetGlass(!!(watch && watch.wet), dt);
  if (!watch) return;
  hudText('lapn', Math.min(LAPS, watch.lap));
  hudText('lapof', '/' + LAPS);
  const pl = watch.place || 1;
  hudText('placen', pl);
  hudText('placesfx', ord(pl).replace(/^\d+/, ''));
  if (hudLast.placeCls !== pl) { hudLast.placeCls = pl; el('place').className = 'p' + Math.min(3, pl); }
  hudText('speedn', Math.round(Math.abs(watch.speed) * 3.6));
  const clk = replay && ghost ? Math.min(raceTime, ghost.meta.time)
    : watch.finished ? (watch.time || 0) : (phase === 'race' ? raceTime : 0);
  hudText('clockn', time(clk));
  /* No charge bar. The sparks off the back wheels are the meter, the way they
     are in Mario Kart: white, then blue, then orange, then purple, and you read
     them out of the corner of your eye without taking them off the road. */
  drawBoard();
  drawMini();
}

function drawBoard() {
  const live = order();
  const rows = live.slice(0, 8).map(k =>
    '<div class="r' + (k === me ? ' me' : '') + (k.bot ? ' bot' : '') + (k.place === 1 ? ' p1' : '') + '">'
    + '<span class="p">' + k.place + '</span>'
    + '<span>' + esc(k.name) + '</span>'
    + '<span class="t">' + (k.finished ? time(k.time) : 'L' + Math.min(LAPS, k.lap)) + '</span></div>').join('');
  // rebuilt only when the order or a lap has actually changed
  if (hudLast.board === rows) return;
  hudLast.board = rows;
  el('boardrows').innerHTML = rows;
}

const minic = el('minic'), mg = minic.getContext('2d');
let miniBack = null;
function drawMini() {
  const W = minic.width, H = minic.height;
  const b = track.bounds;
  const pad = 16;
  const sx = (W - pad * 2) / (b.maxx - b.minx), sz = (H - pad * 2) / (b.maxz - b.minz);
  const s = Math.min(sx, sz);
  const ox = pad + ((W - pad * 2) - (b.maxx - b.minx) * s) / 2;
  const oz = pad + ((H - pad * 2) - (b.maxz - b.minz) * s) / 2;
  const X = x => ox + (x - b.minx) * s, Z = z => oz + (z - b.minz) * s;
  mg.clearRect(0, 0, W, H);
  /* The circuit does not move, so it is drawn once per track into a canvas
     of its own and copied in; only the dots are drawn fresh each frame. */
  if (!miniBack || miniBack.track !== track || miniBack.c.width !== W || miniBack.c.height !== H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.lineWidth = 10; g.lineJoin = 'round'; g.strokeStyle = '#17223b';
    g.beginPath();
    track.outline.forEach((p, i) => { i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])); });
    g.closePath(); g.stroke();
    g.lineWidth = 6; g.strokeStyle = '#9aa3b2'; g.stroke();
    miniBack = { track, c };
  }
  mg.drawImage(miniBack.c, 0, 0);
  for (const k of karts) {
    mg.beginPath();
    mg.arc(X(k.pos.x), Z(k.pos.z), k === me ? 7 : 5, 0, 7);
    mg.fillStyle = k === me ? '#ffd233' : (k.bot ? '#fff6e2' : '#8fd3ff');
    mg.fill();
    mg.lineWidth = 3; mg.strokeStyle = '#17223b'; mg.stroke();
  }
}

/* ---- the record board ----------------------------------------------------
   A whole race, all three laps, however you drove it: the board does not care
   whether the other seven were people or the computer, because the circuit does
   not change and neither does the distance. Only a race you actually finished
   goes up - the flag falling on you while you are still out there is not a time.

   It lives on the same server board as Slope and the rest, which keeps every
   run rather than one row a name, so beating your own time does not quietly
   delete the old one. */
const MC = (function () {
  if (location.hostname.endsWith('leonzhao.dev')) return 'https://apps.leonzhao.dev/mc';
  try {
    const u = new URL(new URLSearchParams(location.search).get('ws') || 'wss://apps.leonzhao.dev/mc/ws');
    return (u.protocol === 'wss:' ? 'https://' : 'http://') + u.host + '/mc';
  } catch (e) { return 'https://apps.leonzhao.dev/mc'; }
})();
let myBestTime = 0, myLastTime = 0, myRank = 0;
// and the time trial's own, so a trial never shows up as your last race
let myBestTT = 0, myLastTT = 0;
try {
  myBestTime = +localStorage.getItem('mkBestTime') || 0;
  myLastTime = +localStorage.getItem('mkLastTime') || 0;
  myBestTT = +localStorage.getItem('mkBestTT') || 0;
  myLastTT = +localStorage.getItem('mkLastTT') || 0;
} catch (e) {}
let raceBoard = null;
/* One row a race. The results panel is drawn twice - once the moment you come
   home, which is what puts "You finished 3rd" up while the others are still out
   there, and again when the flag falls on the race as a whole - and both of
   them were putting the same time on the board. */
let postedRace = false;

// where you stand, when you are not on the twenty being shown
function rankOf(board, secs) {
  if (!secs || !board) return 0;
  let n = 1;
  for (const r of board) if (r.score < secs - 0.005) n++;
  return n;
}
/* Two boards. The live one is times on the fixed circuits; the other is the
   board exactly as it stood on the day the circuits were pinned, when every
   race laid out a different track and no two of those times were run on the
   same one. They are not comparable, so they are not mixed - the old one is
   kept whole, behind a switch, and nothing is ever added to it. */
let oldBoard = null, showingOld = false;
function fetchBoard() {
  fetch(MC + '/scores?game=leon-kart')
    .then(r => r.json())
    .then(j => {
      if (!j || !j.board) return;
      raceBoard = j.board;
      if (!myRank) myRank = rankOf(raceBoard, myBestTime);
      drawTimes();
      syncTimes();
    })
    .catch(() => {});
  fetch(MC + '/scores?game=leon-kart-tt')
    .then(r => r.json())
    .then(j => { if (j && j.board) { ttBoard = j.board; drawTimes(); syncTimes(); } })
    .catch(() => {});
}
/* The outbox. A finished time and its recording are written into this
   browser before they are sent, and only taken out once the server has
   answered for them. Leaving the page the moment you cross the line - Home,
   a reload, closing the tab - cancels the request in flight, and the time used
   to be lost with it; now whatever is still in the outbox is sent again the
   next time the page opens. */
const OUTBOX = 'mkOutbox';
function outbox() {
  try { const o = JSON.parse(localStorage.getItem(OUTBOX) || '[]'); return Array.isArray(o) ? o : []; }
  catch (e) { return []; }
}
function outboxSet(list) {
  // a handful at most: the quickest per board and name is all that can matter
  try { localStorage.setItem(OUTBOX, JSON.stringify(list.slice(-4))); } catch (e) {}
}
function outboxKey(it) { return it.game + '|' + String(it.name).toLowerCase(); }
function outboxAdd(it) {
  const list = outbox().filter(x => !(outboxKey(x) === outboxKey(it) && x.score <= it.score));
  if (list.some(x => outboxKey(x) === outboxKey(it))) return list;   // a quicker one is already waiting
  list.push(it);
  outboxSet(list);
  return list;
}
function outboxDrop(it) {
  outboxSet(outbox().filter(x => !(outboxKey(x) === outboxKey(it) && x.score === it.score)));
}
function sendTime(it, quiet) {
  return fetch(MC + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it),
  })
    .then(r => r.json())
    .then(j => {
      // an answer either way settles it; only a failure to reach the server keeps it waiting
      if (!j) return;
      outboxDrop(it);
      // said where it will be seen, not only in the chat: a time that did not go up is news
      if (j.error) { if (!quiet) { say('Time not saved: ' + j.error, 'sys'); notice('Time not saved'); } return; }
      if (!j.board) return;
      if (it.game === 'leon-kart-tt') ttBoard = j.board; else raceBoard = j.board;
      if (j.beat === false) { if (!quiet) say('Your best on the board is still ' + time(j.best) + '.', 'sys'); }
      else if (j.rank) say((quiet ? 'Saved from last time: ' : 'On the board in ') + (quiet ? time(it.score) + ', ' : '')
        + ord(j.rank) + (j.ghost ? ', ghost and all.' : '.'), 'sys');
      drawTimes();
    })
    .catch(() => { if (!quiet) say('The board could not be reached. The time will be sent next time.', 'sys'); });
}
function postTime(secs, run) {
  pendingPost = 0;
  if (!run) return;
  const it = { game: quietRound ? 'leon-kart-tt' : 'leon-kart', name: (myName || 'You').slice(0, 14),
               score: +secs.toFixed(2), theme: worldTheme, ghost: run };
  outboxAdd(it);
  sendTime(it, false);
}
/* When the page opens: anything left in the outbox goes, and so does your own
   best from this browser on any track where it beats what the board has for
   your name - a run that never made it for any other reason still counts. */
let synced = false;
function syncTimes() {
  if (synced || !raceBoard || !ttBoard) return;
  synced = true;
  for (const it of outbox()) sendTime(it, true);
  const me2 = (myName || '').trim().toLowerCase();
  if (!me2) return;
  for (const [tt, game, board] of [[false, 'leon-kart', raceBoard], [true, 'leon-kart-tt', ttBoard]]) {
    const row = board.find(r => String(r.name).toLowerCase() === me2);
    for (const t of THEMES) {
      const g = bestGhost(t.id, tt);
      if (!g || !g.name || String(g.name).toLowerCase() !== me2 || (tt && g.mode !== 'tt')) continue;
      if (row && row.score <= g.time + 0.005) continue;
      if (outbox().some(x => x.game === game && x.score <= g.time)) continue;
      const it = { game, name: g.name, score: g.time, theme: g.theme, ghost: g };
      outboxAdd(it);
      sendTime(it, true);
    }
  }
}
/* The ten, and then you: your best, the one you just did, and where that best
   places you when it is not one of the ten. */
/* The board from before the circuits were pinned is not shown any more. Its
   times are still on the server; the card just never offers the switch. */
const hasOld = () => false;
/* While an admin's cross is asking "Sure?", the card is not redrawn under it.
   A board arriving from the server - there are three of them now - used to
   rebuild the card and quietly take the question away mid-decision. The
   redraw waits and happens when the question is answered or lapses. */
let boardHeld = false, boardStale = false;
function holdBoard(on) {
  boardHeld = on;
  if (!on && boardStale) { boardStale = false; drawTimes(); }
}
function drawTimes() {
  const box = el('times');
  if (!box) return;
  if (boardHeld) { boardStale = true; return; }
  const kept = keepAdminInput(box);
  if (showingOld && !hasOld()) showingOld = false;
  if (showingOld) { drawOldTimes(box); return putAdminInput(box, kept); }
  box.classList.remove('old');
  if (boardTab === 'rk') { drawRankedTimes(box); return putAdminInput(box, kept); }
  const tt = boardTab === 'tt';
  // the track picked on the map screen until one is chosen here
  if (!boardMap || (boardMap !== 'all' && !THEMES.some(t => t.id === boardMap))) boardMap = pickedTheme;
  const everyMap = boardMap === 'all';
  /* All: each name once, at its best on any track - the board is sorted, so
     the first row a name has is its quickest. One track: that track's rows. */
  const seenName = new Set();
  const full = ((tt ? ttBoard : raceBoard) || []).filter(r => {
    if (!everyMap) return r.t === boardMap;
    const k = String(r.name).toLowerCase();
    if (seenName.has(k)) return false;
    seenName.add(k); return true;
  });
  // the ten, or for an admin the whole board, which is where the tidying is
  const rows = adminPw ? full : full.slice(0, 10);
  /* One row a name, so where you are is the row with your name on it, in
     whatever capitals. Before you have one, your own best from this browser. */
  const mineKey = (myName || '').trim().toLowerCase();
  const at = mineKey ? full.findIndex(r => String(r.name).toLowerCase() === mineKey) : -1;
  const onTop = at >= 0 && at < rows.length;
  const bestShown = at >= 0 ? full[at].score : (tt ? myBestTT : myBestTime);
  const lastShown = tt ? myLastTT : myLastTime;
  // your own best here, from this browser, to race as a ghost
  const own = tt ? null : everyMap ? bestGhostAny() : bestGhost(boardMap);
  let mine = '<div class="mine' + (own ? ' hg' : '') + '"><span>Your best</span><b>'
    + (bestShown ? time(bestShown) : '&mdash;') + '</b>'
    + (own ? '<button type="button" class="gh" data-own="1" title="Race your best, on '
      + esc(themeById(own.theme).name) + '" aria-label="Race your best, on '
      + esc(themeById(own.theme).name) + '">' + icon('ghost') + '</button>' : '')
    + '</div>';
  mine += '<div class="mine last"><span>' + (tt ? 'Last trial' : 'Last race') + '</span><b>'
    + (lastShown ? time(lastShown) : '&mdash;') + '</b></div>';
  if (at >= 0 && !onTop) {
    mine += '<div class="mine place"><span>You place</span><b>' + ord(at + 1) + '</b></div>';
  }
  box.innerHTML = head('Best times', !tt && hasOld() ? 'Before update' : '')
    + '<div class="tabs" role="tablist">'
    + '<button type="button" role="tab" data-tab="race" aria-selected="' + !tt + '">Race</button>'
    + '<button type="button" role="tab" data-tab="tt" aria-selected="' + tt + '">Time trial</button>'
    + '<button type="button" role="tab" data-tab="rk" aria-selected="false">Ranked</button></div>'
    + '<div class="maptabs" role="tablist" aria-label="Track">'
    + '<button type="button" role="tab" data-map="all" aria-selected="' + everyMap + '" title="Best on any track">All</button>'
    + THEMES.map(t =>
        '<button type="button" role="tab" data-map="' + t.id + '" aria-selected="' + (t.id === boardMap)
        + '" title="' + esc(t.name) + '">' + esc(t.name.split(' ')[0]) + '</button>').join('') + '</div>'
    + '<p class="sub">' + (everyMap ? 'All tracks \u00b7 each driver\u2019s best anywhere'
      : esc(themeById(boardMap).name) + ' \u00b7 ' + (tt ? 'no items, no cones, no other cars' : 'three laps, one best each')) + '</p>'
    + (adminNote && !adminPw ? '<p class="adm-msg" role="status">' + esc(adminNote) + '</p>' : '')
    + adminBar()
    + (rows.length
      ? list(rows)
      : '<p class="none">Nobody has finished a race yet.</p>')
    + adminAdd()
    + mine;
  wireWas(box, rows);
  putAdminInput(box, kept);
}
// the board as it stood before the circuits were pinned, kept whole
function drawOldTimes(box) {
  box.classList.add('old');
  const rows = adminPw ? oldBoard : oldBoard.slice(0, 10);
  box.innerHTML = head('Before update', 'Back to now')
    + '<p class="sub">Random circuits. Not comparable.</p>'
    + (adminNote && !adminPw ? '<p class="adm-msg" role="status">' + esc(adminNote) + '</p>' : '')
    + adminBar()
    + (rows.length ? list(rows) : '<p class="none">Nothing on it.</p>')
    + adminAdd();
  wireWas(box, rows);
}
const head = (title, btn) => '<div class="head"><h2>' + title + '</h2>'
  + (btn ? '<button type="button" class="was">' + btn + '</button>' : '') + '</div>';
/* A ghost button on a row with a ghost, and a gap where the others would put
   one, so the times still line up down the card. Only the live board has
   them: the archive's times were set on circuits that no longer exist. */
const list = rows => {
  const hg = !showingOld && rows.some(r => r.g);
  return '<div class="rows' + (adminPw ? ' adm' : '') + (hg ? ' hg' : '') + '">' + rows.map((r, i) =>
  '<div class="r' + (i === 0 ? ' p1' : '') + (adminPw ? ' adm' : '') + '">'
  + '<span class="p">' + (i + 1) + '</span><span>' + esc(r.name)
    // on All, which track each best was set on
    + (boardMap === 'all' && r.t ? '<small class="mp">' + esc(themeById(r.t).name.split(' ')[0]) + '</small>' : '') + '</span>'
  + '<span class="t">' + time(r.score) + '</span>'
  + (hg ? (r.g ? '<button type="button" class="gh" data-g="' + esc(r.g) + '" data-i="' + i + '" title="Race '
      + esc(r.name) + '\'s ghost on ' + esc(themeById(r.t).name) + '" aria-label="Race ' + esc(r.name)
      + '\'s ghost on ' + esc(themeById(r.t).name) + '">' + icon('ghost') + '</button>' : '<span class="gh"></span>') : '')
  + (adminPw ? '<button type="button" class="x" data-i="' + i + '" aria-label="Remove '
    + esc(r.name) + ' ' + time(r.score) + '">&times;</button>' : '')
  + '</div>').join('') + '</div>';
};
function wireWas(box, rows) {
  const b = box.querySelector('.was');
  /* A message about one board says nothing about the other, and neither does a
     half typed time: it was meant for the board it was typed on. */
  /* Racing a ghost from the board: the row's ghost is fetched and the race
     starts on its track. Your own best comes straight from this browser. */
  box.querySelectorAll('.gh[data-g]').forEach(bt => bt.addEventListener('click', () => {
    const r = rows[+bt.dataset.i];
    if (!r) return;
    const row = bt.closest('.r');
    const open = row.nextElementSibling && row.nextElementSibling.classList.contains('gact');
    box.querySelectorAll('.gact').forEach(x => x.remove());
    if (open) return;
    const strip = document.createElement('div');
    strip.className = 'gact';
    strip.innerHTML = '<button type="button" data-a="race">' + icon('ghost') + ' Race it</button>'
      + '<button type="button" data-a="watch">' + icon('eye') + ' Watch it</button>';
    row.after(strip);
    strip.querySelectorAll('button').forEach(b2 => b2.addEventListener('click', () => {
      if (b2.disabled) return;
      strip.querySelectorAll('button').forEach(x => { x.disabled = true; });
      fetchGhost(bt.dataset.g).then(g => {
        strip.querySelectorAll('button').forEach(x => { x.disabled = false; });
        const label = r.name + ' ' + time(r.score);
        const go = b2.dataset.a === 'watch' ? watchGhost(g, label) : raceGhost(g, label, boardTab === 'tt');
        if (!g || !go) say('That ghost could not be loaded.', 'sys');
      });
    }));
    strip.querySelector('button').focus();
  }));
  box.querySelectorAll('.maptabs [data-map]').forEach(t => t.addEventListener('click', () => {
    boardMap = t.dataset.map;
    drawTimes();
  }));
  wireTabs(box);
  const ownBt = box.querySelector('.gh[data-own]');
  if (ownBt) ownBt.addEventListener('click', () => raceGhost(bestGhostAny(), 'Your best'));
  if (b) b.addEventListener('click', () => {
    showingOld = !showingOld;
    adminMsg = '';
    const f = box.querySelector('.adm-add');
    if (f) f.reset();
    drawTimes();
  });
  if (adminPw) wireAdmin(box, rows);
}

/* ---------------------------------------------------------- the board's admin --
   Six digits typed on the title screen - not into the name box, not in a race,
   not on the map screen - go to the server, which says whether they are the
   code. The page never knows what the code is, so reading this file tells you
   nothing about it, and a wrong guess shows nothing at all.

   What it opens is on the record card itself: every row on the board rather
   than ten, a cross beside each, and a line to put a time on. Whichever board
   the card is showing is the one it edits, the archive included. */
let adminPw = null, adminBuf = '', adminAt = 0, adminBusy = false, adminMsg = '';
let adminNote = '', adminNoteT = 0;     // a lockout, said on the card for a few seconds
const onTitle = () => !started && !paused && phase === 'title' && !el('mapsel').classList.contains('on');
addEventListener('keydown', e => {
  if (adminPw || !onTitle()) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  /* A key held down is one key, not a stream of them. Auto-repeat used to top
     the buffer up to six of the same digit and fire a check every time the
     last one came back, which spent this address's wrong guesses in about a
     second and then locked out the right code as well. */
  if (e.repeat) return;
  if (!/^[0-9]$/.test(e.key)) { adminBuf = ''; return; }
  const now = performance.now();
  if (now - adminAt > 2500) adminBuf = '';          // a pause starts it again
  adminAt = now;
  adminBuf = (adminBuf + e.key).slice(-6);
  if (adminBuf.length < 6 || adminBusy) return;
  const code = adminBuf;
  adminBuf = '';
  adminBusy = true;
  adminCall({ op: 'check', pw: code }).then(j => {
    adminBusy = false;
    if (j && j.ok) { adminPw = code; adminMsg = ''; adminNote = ''; drawTimes(); return; }
    /* A wrong guess shows nothing. Being locked out, or not reaching the
       server at all, does say so: otherwise an admin who mistyped a few times
       types the right code and watches nothing happen, with no way to tell
       that waiting is the answer. */
    if (j && j.error && j.error !== 'Nope.') {
      adminNote = j.error;
      drawTimes();
      clearTimeout(adminNoteT);
      adminNoteT = setTimeout(() => { adminNote = ''; drawTimes(); }, 6000);
    }
  });
});
function adminCall(body) {
  return fetch(MC + '/scores/admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => ({ error: 'Could not reach the server.' }));
}
const adminBar = () => adminPw
  ? '<div class="adm-bar"><b>Admin</b><button type="button" class="adm-exit">Exit</button></div>' : '';
const adminAdd = () => adminPw
  ? '<form class="adm-add" autocomplete="off">'
    + '<input class="an" maxlength="14" placeholder="Name" aria-label="Name">'
    + '<input class="at" inputmode="decimal" placeholder="1:23.45" aria-label="Time">'
    + '<button type="submit">Add</button></form>'
    + '<p class="adm-msg" role="status">' + esc(adminMsg) + '</p>'
  : '';
// minutes and seconds, or seconds alone: 1:26.71, 86.71 and 86 are all a time
function parseTime(txt) {
  const t = String(txt).trim();
  let m = /^(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(t);
  if (m) return +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN;
  m = /^\d{1,4}(?:\.\d{1,3})?$/.exec(t);
  return m ? +t : NaN;
}
/* What the server sent back goes straight onto the board it came from, and the
   card is drawn again from that. If the code stopped working - changed on the
   server since it was typed - the admin view goes with it. */
function adminDone(game, j) {
  if (j && j.board) {
    if (game === 'leon-kart') { raceBoard = j.board; myRank = rankOf(raceBoard, myBestTime); }
    else if (game === 'leon-kart-tt') ttBoard = j.board;
    else oldBoard = j.board;
  }
  adminMsg = j && j.error ? j.error : '';
  if (j && j.error === 'Nope.') { adminPw = null; adminMsg = ''; }
  drawTimes();
}
function wireAdmin(box, rows) {
  const game = showingOld ? 'leon-kart-classic' : (boardTab === 'tt' ? 'leon-kart-tt' : 'leon-kart');
  const ex = box.querySelector('.adm-exit');
  if (ex) ex.addEventListener('click', () => { adminPw = null; adminMsg = ''; drawTimes(); });
  /* A cross takes two presses: the first says what it is about to do, the
     second does it. A time is somebody's afternoon, and one stray click on a
     list of small buttons should not be enough to take it off. */
  box.querySelectorAll('.rows .x').forEach(bt => {
    let armed = 0, armedAt = 0;
    bt.addEventListener('click', () => {
      const r = rows[+bt.dataset.i];
      if (!r) return;
      if (!armed) {
        armed = setTimeout(() => {
          armed = 0; bt.classList.remove('armed'); bt.innerHTML = '&times;';
          holdBoard(false);
        }, 3000);
        armedAt = performance.now();
        holdBoard(true);
        bt.classList.add('armed');
        bt.textContent = 'Sure?';
        return;
      }
      /* A double click is one decision, not two: the second half of it lands
         before anybody could have read the question it answered. */
      if (performance.now() - armedAt < 400) return;
      clearTimeout(armed); armed = 0;
      boardHeld = false; boardStale = false;
      bt.disabled = true;
      adminCall({ op: 'remove', pw: adminPw, game, name: r.name, score: r.score, at: r.at })
        .then(j => adminDone(game, j));
    });
  });
  const form = box.querySelector('.adm-add');
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    const name = form.querySelector('.an').value.trim();
    const secs = parseTime(form.querySelector('.at').value);
    if (!name) { adminMsg = 'Give it a name.'; return drawTimes(); }
    if (!(secs >= 1 && secs <= 3600)) { adminMsg = 'Type the time like 1:23.45'; return drawTimes(); }
    form.querySelector('button').disabled = true;
    adminCall({ op: 'add', pw: adminPw, game, name, score: +secs.toFixed(2), theme: boardMap === 'all' ? pickedTheme : boardMap }).then(j => {
      if (j && j.ok) {
        /* The form in the card now, not the one captured when Add was pressed:
           a redraw in between - another row taken off, the board switched -
           replaces it, and emptying the old detached copy left the live one
           full, so the next press put the same time on twice. */
        const live = el('times').querySelector('.adm-add');
        if (live) live.reset();
      }
      adminDone(game, j);
    });
  });
}
/* The card is drawn again whenever the board changes, which can be while
   somebody is half way through typing a time into it. Whatever was in the
   two boxes, and which one had the cursor, is carried across the redraw. */
function keepAdminInput(box) {
  const f = box.querySelector('.adm-add');
  if (!f) return null;
  const an = f.querySelector('.an'), at = f.querySelector('.at');
  return { an: an.value, at: at.value,
           focus: document.activeElement === an ? 'an' : document.activeElement === at ? 'at' : null };
}
function putAdminInput(box, kept) {
  if (!kept) return;
  const f = box.querySelector('.adm-add');
  if (!f) return;
  const an = f.querySelector('.an'), at = f.querySelector('.at');
  if (an.value === '' && kept.an) an.value = kept.an;
  if (at.value === '' && kept.at) at.value = kept.at;
  if (kept.focus) f.querySelector('.' + kept.focus).focus({ preventScroll: true });
}

function time(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* the running cup, when there is a lobby keeping one */
let cupRows = null, cupMe = 0;
function setCup(rows, myId) {
  cupRows = rows; cupMe = myId;
  drawCup();
}
function drawCup() {
  const box = el('cup');
  if (!box) return;
  if (!cupRows || cupRows.length < 2) { box.classList.remove('on'); return; }
  box.classList.add('on');
  el('cuprows').innerHTML = cupRows.slice(0, 8).map((r, i) =>
    '<div class="r' + (r.id === cupMe ? ' me' : '') + (i === 0 ? ' p1' : '') + '">'
    + '<span class="p">' + (i + 1) + '</span><span>' + esc(r.name) + '</span>'
    + '<span class="t">' + r.points + '</span></div>').join('');
}

function showResults(final) {
  const live = order();
  /* A race you actually finished goes on the board: all three laps, under your
     own power, not the flag falling on you while you were still out there. */
  if (worldTheme) boardMap = worldTheme;
  if (me && !postedRace && !me.dnf && me.lap >= LAPS && me.time > 0) {
    postedRace = true;
    try {
      if (quietRound) {
        myLastTT = me.time;
        if (!myBestTT || me.time < myBestTT) myBestTT = me.time;
        localStorage.setItem('mkLastTT', String(myLastTT));
        localStorage.setItem('mkBestTT', String(myBestTT));
      } else {
        myLastTime = me.time;
        if (!myBestTime || me.time < myBestTime) myBestTime = me.time;
        localStorage.setItem('mkLastTime', String(myLastTime));
        localStorage.setItem('mkBestTime', String(myBestTime));
      }
    } catch (e) {}
    /* Posted once the recording of it is done, which is later this same frame:
       the line is crossed in the lap logic and the recorder hears about it
       after. The time goes up with the run that proves it. */
    pendingPost = customMap ? 0 : me.time;
    if (runReady && pendingPost) postTime(pendingPost, runReady);
  }
  drawTimes();
  el('restitle').textContent = replay ? 'Replay over'
    : quietRound && me ? 'Time trial: ' + time(me.time)
    : final ? 'Race over' : 'You finished ' + ord(me ? me.place : 1);
  /* On your own you can go again straight away, without waiting for the
     field to finish or the clock to run down. */
  el('resbtns').hidden = !!(net && net.alive);
  el('again').textContent = replay ? 'Watch again' : 'Race again';
  el('resrows').innerHTML = live.map(k =>
    '<div class="r' + (k === me ? ' me' : '') + (k.bot ? ' bot' : '') + (k.place === 1 ? ' p1' : '') + '">'
    + '<span class="p">' + k.place + '</span><span>' + esc(k.name) + '</span>'
    + '<span class="t">' + (k.finished ? time(k.time) : '-') + '</span></div>').join('');
  drawCup();
  if (rk) rkPanel();
  el('results').classList.add('on');
}

// the gap between races, said out loud, so the wait has a shape to it
function resCount() {
  if (phase !== 'results') return;
  const left = Math.max(0, Math.ceil(phaseT));
  el('resfoot').innerHTML = (net && net.alive ? 'Back to the lobby in <b>' : 'Next race in <b>')
    + left + '</b>';
}

/* ------------------------------------------------------------------- chat --- */
function say(text, cls) {
  const log = el('log');
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.innerHTML = text;
  log.appendChild(d);
  while (log.children.length > 7) log.removeChild(log.firstChild);
  setTimeout(() => { if (d.parentNode) d.style.opacity = '0'; }, 13000);
}
function openChat() { chatting = true; el('say').classList.add('on'); el('sayin').value = ''; setTimeout(() => el('sayin').focus(), 0); }
function closeChat(send) {
  const v = el('sayin').value.trim();
  chatting = false; el('say').classList.remove('on'); el('sayin').blur();
  if (send && v) { if (net) net.chat(v); else say('<b>' + esc(myName || 'You') + '</b> ' + esc(v), 'me'); }
}
el('sayin').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') closeChat(true);
  if (e.key === 'Escape') closeChat(false);
});

/* ---------------------------------------------------------- the round clock -- */
function stepPhase(dt) {
  // when the server is in charge it sends the phase; otherwise run it here
  if (net && net.alive) {
    /* It owns which phase it is, but it only says so when the phase changes,
       and the ten seconds on the results panel is a number somebody is sitting
       there watching. Left alone it was set once and never moved again. Run it
       down here between messages; the next one the server sends sets it right. */
    phaseT = Math.max(0, phaseT - dt);
    if (phase === 'results') resCount();
    return;
  }
  phaseT -= dt;
  if (phase === 'count') {
    // revving on the grid: hold the throttle or the drift button and the kart
    // shakes, and the longer you hold it the harder it goes when the lights
    // change. Let go and it winds back down.
    if (me && !spectating && !paused) {
      const on = down('gas') || down('hop');
      /* How long it has been held without letting go, which is the whole of
         the start. Hold it from the second light and the car goes; hold it
         from the first and the engine is flooded by the time the flag drops.
         Letting go puts it back to nothing, so an early grab can be taken
         back - which is the decision the start is made of. */
      me.revHold = on ? me.revHold + dt : 0;
      me.rev = Math.max(0, Math.min(1, me.rev + (on ? 1.05 : -2.2) * dt));
    }
    for (const b of brains) b.kart.rev = Math.min(1, b.kart.rev + b.skill * 0.9 * dt);
    setLights(phaseT);
    if (phaseT <= 0) goRace();
  } else if (phase === 'race') {
    raceTime += dt;
    const done = replay ? (!ghost || raceTime > ghost.meta.time + 2) : karts.every(k => k.finished || k.ghost);
    // watching ranked, the server says when the battle is over
    if (rk && rk.watch) { /* nothing */ }
    else if (done || (results.length && raceTime - results[0].time > 22) || raceTime > 400) endRace();
  } else if (phase === 'results') {
    resCount();
    if (phaseT <= 0) { soloRound++; startRound(null, newSoloSeed(), undefined, pickedTheme); }
  }
}
let litWas = -1;
/* Two seconds of held throttle before the flag is a flooded engine. The lights
   are the guide: the second one lands a second and a half out, so holding from
   it is safe and holding from the first one is not. */
const FLOOD_AT = 2;
function setLights(t) {
  const c = el('count');
  c.classList.add('on');
  c.classList.remove('go');
  // red, then red and amber, and the green only lands with the flag
  const lit = t < 1.5 ? 2 : t < 3 ? 1 : 0;
  [...c.querySelectorAll('.lights i')].forEach((i, n) => i.classList.toggle('lit', n < lit));
  if (lit !== litWas) { if (lit > 0 && lit > litWas) snd.beep(false); litWas = lit; }
}
function goRace() {
  phase = 'race';
  raceTime = 0;
  runReady = null; runKept = false; pendingPost = 0;
  if (me && !spectating) recorder.begin(me, me.slot || 0);
  litWas = -1;
  snd.beep(true);
  snd.music(true, 'race');
  const c = el('count');
  c.classList.add('go');
  // the other two go out, the way a real one does
  [...c.querySelectorAll('.lights i')].forEach((i, n) => i.classList.toggle('lit', n === 2));
  setTimeout(() => c.classList.remove('on'), 900);
  /* Whatever was wound up on the grid comes out here - or does not. Held from
     the first light, which is a good two seconds before the flag, the engine
     floods: no launch at all, and it coughs for a couple of seconds while
     everybody else drives away. Held from the second light it is a rocket
     start. That window is the point of the countdown. */
  if (me && !spectating) {
    if (me.revHold > FLOOD_AT) {
      me.boost = 0;
      me.stall = 2.1;
      notice('Engine flooded!');
      snd.bump && snd.bump();
    } else if (me.rev > 0.15) {
      me.boost = 0.75 + me.rev * 0.75;
      notice(me.rev > 0.85 ? 'Rocket start!' : 'Good launch');
    }
  }
  for (const k of karts) { k.rev = 0; k.revHold = 0; }
  for (const b of brains) if (Math.random() < b.skill * 0.7) b.kart.boost = 0.8;
}
/* The end of your race or trial, for the stats page: the laps, how fast,
   and whether you finished. A replay or a watched race is nobody's run. */
function postRun(finished) {
  if (!me || me.runSent || spectating || replay) return;
  me.runSent = true;
  const name = (myName || '').trim();
  if (!name) return;
  const t = finished ? me.time : raceTime;
  const body = {
    name, map: customMap ? 'c:' + customMap.id : worldTheme, mode: quietRound ? 'tt' : (net && net.alive) ? 'multi' : rk ? 'ranked' : 'race',
    time: +(t || 0).toFixed(2), finished: !!finished, laps: (me.lapTimes || []).slice(0, LAPS),
    avgSpeed: t > 0 ? +((me.distRun || 0) / t * 3.6).toFixed(1) : 0, topSpeed: +((me.topRun || 0) * 3.6).toFixed(1),
  };
  fetch(MC + '/kart/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(() => checkWins()).catch(() => {});
  if (customMap && finished && quietRound) postCustomTime(me.time);
}
function endRace() {
  if (me && !me.finished && !spectating && !replay) postRun(false);
  finishRun();                          // the tail may not have run yet; keep what there is
  phase = 'results';
  // a replay waits for you to choose; a race rolls on to the next
  phaseT = replay || rk ? 1e9 : RESULTS;
  snd.music(false);
  for (const k of karts) if (!k.finished && !k.ghost) {
    // still out there when the flag fell: a place, but not a time
    k.finished = 1; k.dnf = 1; k.time = raceTime;
    results.push(k); k.place = results.length;
  }
  order();
  showResults(true);
  el('board').classList.remove('on');
  el('resfoot').innerHTML = 'Next race in <b>10</b>'; resCount();
  el('resfoot').hidden = replay || !!rk;
  // out of time before the line, in a battle still going: that is a run that did not finish
  if (rk && !rk.watch && !rk.res && me && me.dnf && !rk.done) { rk.done = true; rkNet.forfeit(); }
  if (rk) rkPanel();
}

/* -------------------------------------------------------------- the loop ---- */
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const raw = now - last;
  const dt = Math.min(0.05, raw / 1000);
  last = now;
  tickCosmetics(now / 1000);
  if (editorFrame) { editorFrame(dt); renderer.render(scene, camera); return; }
  if (started) watchFrame(raw, now);
  if (!started) {
    // the title screen is a panel over the world, so the world behind it barely
    // matters; the turntable is the thing anybody is actually looking at
    if (garage) garage.frame(dt);
    if (rkNet) rkNet.tick();
    renderer.render(scene, camera);
    return;
  }

  if (!paused && !frozen) {
    stepPhase(dt);
    if (phase === 'race' || phase === 'count' || phase === 'wait') stepWorld(dt);
    else for (const k of karts) apply(k);
    if (net && net.alive && phase === 'race') raceTime += dt;
  }
  /* Outside the pause, deliberately. The lobby drops a player it has not heard
     from, because a browser that goes away without its socket closing used to
     stand on the grid for ever and come back as a second person; somebody
     sitting in the menu for a minute is not that, and should not be cleared out
     as though they were. */
  if (net && net.alive && !frozen) net.tick(dt);
  if (!frozen) rkTick(dt);
  stepCamera(dt);
  stepFx(dt, camera);
  stepSound(dt);
  drawHud(dt);
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ sound --- */
function stepSound() {
  if (!snd.isOn()) return;
  const k = watched();
  if (!k) return;
  snd.engine(phase === 'race' || phase === 'count', k.speed, topSpeed(k), k.offroad,
             k.hop > 0.35 || !!k.falling);
  // and the tyres have nothing to scrub on in the air either
  snd.skid(k.drift !== 0 && k.speed > 8 && k.hop <= 0.35);
  snd.musicTick();
}

/* ------------------------------------------------------------------ start --- */
function buildCast() {
  const input = el('nick');
  input.value = myName;
  input.addEventListener('input', () => {
    myName = input.value.slice(0, 12);
    clearTimeout(profileT);
    profileT = setTimeout(() => loadProfile(true), 900);
    clearTimeout(rkRenameT);
    rkRenameT = setTimeout(() => { if (rkNet) rkNet.rename(); }, 1200);
    try { localStorage.setItem('mkName', myName); } catch (e) {}
    drawTimes();
  });
  /* Enter does not start a race. Typing a name and pressing it is how you
     finish typing a name, and being dropped into a lobby for it is startling:
     the two buttons underneath are how you say you are ready. */
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  buildGarage();
  buildPaint();
}

/* The colour wheel. Angle round the disc is the hue, distance out from the
   middle is how strong it is, and the slider underneath is how light. The disc
   is redrawn at whatever lightness the slider is on, so what you see on it is
   what the car will be. Dragging paints as you go; letting go tells the lobby. */
function buildPaint() {
  const cv = el('wheel'), sl = el('light'), sw = el('swatch');
  if (!cv || !sl || !sw) return;
  const g = cv.getContext('2d');
  const W = cv.width, R = W / 2 - 2;
  if (!myPaint) myPaint = { h: 8, s: 80, l: 50 };
  sl.value = String(myPaint.l);
  function draw() {
    const img = g.createImageData(W, W);
    const d = img.data;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - W / 2, dy = y - W / 2, r = Math.hypot(dx, dy);
        const o = (y * W + x) * 4;
        if (r > R + 1) { d[o + 3] = 0; continue; }
        const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const c = hsl(h, Math.min(100, r / R * 100), myPaint.l);
        d[o] = (c >> 16) & 255; d[o + 1] = (c >> 8) & 255; d[o + 2] = c & 255;
        d[o + 3] = r > R ? Math.round(255 * (R + 1 - r)) : 255;
      }
    }
    g.putImageData(img, 0, 0);
    // where the paint is now: a ring, dark or light against what is under it
    const a = myPaint.h * Math.PI / 180, rr = myPaint.s / 100 * R;
    const mx = W / 2 + Math.cos(a) * rr, my = W / 2 + Math.sin(a) * rr;
    g.lineWidth = 3;
    g.strokeStyle = myPaint.l > 60 ? '#17223b' : '#fff';
    g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = myPaint.l > 60 ? '#fff' : '#17223b';
    g.beginPath(); g.arc(mx, my, 9.5, 0, Math.PI * 2); g.stroke();
    sw.style.background = '#' + (myColour === null ? 0xe8402a : myColour).toString(16).padStart(6, '0');
  }
  function paint(save) {
    myColour = hsl(myPaint.h, myPaint.s, myPaint.l);
    draw();
    if (garage) garage.show(myRacer(), myBuild, styleNow());
    if (save) {
      try { localStorage.setItem('mkPaint', JSON.stringify(myPaint)); } catch (e) {}
      tellLook();
    }
  }
  function pick(e) {
    const r = cv.getBoundingClientRect();
    // the canvas is drawn at its own size and shown at the size CSS gives it
    const x = (e.clientX - r.left) / r.width * W - W / 2;
    const y = (e.clientY - r.top) / r.height * W - W / 2;
    myPaint.h = Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
    myPaint.s = Math.round(Math.min(100, Math.hypot(x, y) / R * 100));
    paint(false);
  }
  let dragging = false;
  cv.addEventListener('pointerdown', e => {
    dragging = true;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    pick(e);
  });
  cv.addEventListener('pointermove', e => { if (dragging) pick(e); });
  const done = () => { if (!dragging) return; dragging = false; paint(true); snd.tick(); };
  cv.addEventListener('pointerup', done);
  cv.addEventListener('pointercancel', done);
  // and from the keyboard: left and right go round, up and down go in and out
  cv.tabIndex = 0;
  cv.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft') myPaint.h = (myPaint.h + 352) % 360;
    else if (k === 'ArrowRight') myPaint.h = (myPaint.h + 8) % 360;
    else if (k === 'ArrowUp') myPaint.s = Math.min(100, myPaint.s + 8);
    else if (k === 'ArrowDown') myPaint.s = Math.max(0, myPaint.s - 8);
    else return;
    e.preventDefault();
    paint(true);
  });
  sl.addEventListener('input', () => { myPaint.l = +sl.value; paint(false); });
  sl.addEventListener('change', () => paint(true));
  paint(false);
}

/* The garage. Three rows of arrows, and the car on the turntable next to them
   changes as you press them. */
let garage = null;
function tellLook() { if (net) net.setCast(packLook(myCast, myBuild, myColour)); saveStyle(); }
function showGarage() { if (garage) garage.show(myRacer(), myBuild, styleNow()); }
function buildGarage() {
  const canvas = el('gcan'), rows = el('gparts');
  if (!canvas || !rows || garage) return;
  garage = makeGarage(canvas);
  garage.show(myRacer(), myBuild, styleNow());
  // built again with the kit's bodies once they are in, if they were not yet
  whenKit(() => garage.show(myRacer(), myBuild, styleNow()));
  /* Who is driving: any of the eight, picked the same way as the parts. The
     choice is the "cast" the lobby already passes round with your build, so
     everybody else sees the same person in your seat. */
  {
    const row = document.createElement('div');
    row.className = 'opt';
    const name = document.createElement('b');
    const label = document.createElement('em');
    label.textContent = 'Driver';
    const step = d => {
      myCast = ((myCast + d) % RACERS.length + RACERS.length) % RACERS.length;
      name.textContent = RACERS[myCast].name;
      try { localStorage.setItem('mkCast', String(myCast)); } catch (e) {}
      garage.show(myRacer(), myBuild, styleNow());
      tellLook();
      snd.tick();
    };
    const arrow = (txt, d) => {
      const bt = document.createElement('button');
      bt.type = 'button';
      bt.textContent = txt;
      bt.setAttribute('aria-label', (d < 0 ? 'previous ' : 'next ') + 'driver');
      bt.onclick = () => step(d);
      return bt;
    };
    name.textContent = RACERS[myCast].name;
    row.append(label, arrow('‹', -1), name, arrow('›', 1));
    /* Every driver at once, by their face: one click, and the one you are
       on is lit. The arrow row is kept for the keyboard and for tests, out of
       sight. */
    row.hidden = true;
    el('gdriver').appendChild(row);
    const grid = document.createElement('div');
    grid.id = 'gdrivers';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Driver');
    RACERS.forEach((r, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === myCast));
      b.innerHTML = '<i>' + icon('user') + '</i><span>' + esc(r.name) + '</span>';
      b.onclick = () => {
        if (i === myCast) return;
        step(i - myCast);
        grid.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-pressed', String(j === myCast)));
      };
      grid.appendChild(b);
      if (hub) hub.portrait(i).then(url => { if (url) b.querySelector('i').innerHTML = '<img alt="" src="' + url + '">'; });
      else setTimeout(() => hub && hub.portrait(i).then(url => { if (url) b.querySelector('i').innerHTML = '<img alt="" src="' + url + '">'; }), 0);
    });
    el('gdriver').appendChild(grid);
  }
  buildCharacter();
  buildGradient();
  // the three tabs of the garage card
  const tabs = [...document.querySelectorAll('#gtabs [data-gt]')];
  const pick = which => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.gt === which));
    document.querySelectorAll('.gpane').forEach(p => { p.hidden = p.dataset.pane !== which; });
  };
  tabs.forEach(t => t.addEventListener('click', () => { pick(t.dataset.gt); snd.tick(); }));
  for (const part of PARTS) {
    const row = document.createElement('div');
    row.className = 'opt';
    const name = document.createElement('b');
    const label = document.createElement('em');
    label.textContent = part.label;
    const step = d => {
      const i = part.list.findIndex(x => x.id === myBuild[part.key]);
      const n = part.list[(((i < 0 ? 0 : i) + d) % part.list.length + part.list.length) % part.list.length];
      myBuild[part.key] = n.id;
      name.textContent = n.name;
      saveBuild();
      garage.show(myRacer(), myBuild, styleNow());
      tellLook();
      drawBars();
      snd.tick();
    };
    const arrow = (txt, d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.setAttribute('aria-label', (d < 0 ? 'previous ' : 'next ') + part.label.toLowerCase());
      b.onclick = () => step(d);
      return b;
    };
    name.textContent = (part.list.find(x => x.id === myBuild[part.key]) || part.list[0]).name;
    row.append(label, arrow('‹', -1), name, arrow('›', 1));
    rows.appendChild(row);
  }
  drawBars();
}

/* The character: a skin tone, a shirt and trousers, and the hat and the
   sunglasses everybody has. Everything else to wear is in the inventory. */
function swatchRow(label, list, current, set) {
  const row = document.createElement('div');
  row.className = 'swrow';
  const em = document.createElement('em');
  em.textContent = label;
  const box = document.createElement('div');
  box.className = 'sws';
  const draw = () => {
    box.innerHTML = '';
    const def = document.createElement('button');
    def.type = 'button'; def.className = 'def' + (current() === undefined || current() === null ? ' on' : '');
    def.title = 'As the driver comes'; def.setAttribute('aria-label', label + ': as the driver comes');
    def.onclick = () => { set(null); draw(); };
    box.appendChild(def);
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = '#' + c.toString(16).padStart(6, '0');
      b.className = current() === c ? 'on' : '';
      b.setAttribute('aria-label', label + ' #' + c.toString(16).padStart(6, '0'));
      b.onclick = () => { set(c); draw(); };
      box.appendChild(b);
    }
  };
  draw();
  row.append(em, box);
  return row;
}
function segRow(label, opts, current, set) {
  const row = document.createElement('div');
  row.className = 'swrow';
  const em = document.createElement('em');
  em.textContent = label;
  const box = document.createElement('div');
  box.className = 'seg';
  const draw = () => {
    box.innerHTML = '';
    for (const [v, txt] of opts) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = txt;
      b.className = (current() || null) === v ? 'on' : '';
      b.onclick = () => { set(v); draw(); };
      box.appendChild(b);
    }
  };
  draw();
  row.append(em, box);
  return row;
}
function restyle() { saveStyle(); showGarage(); snd.tick(); }
function buildCharacter() {
  const box = el('gdriver');
  const C = () => myStyle.char || (myStyle.char = {});
  box.appendChild(swatchRow('Skin', SKIN_TONES, () => C().skin, v => { if (v === null) delete C().skin; else C().skin = v; restyle(); }));
  box.appendChild(swatchRow('Shirt', CLOTH, () => C().shirt, v => { if (v === null) delete C().shirt; else C().shirt = v; restyle(); }));
  box.appendChild(swatchRow('Trousers', CLOTH, () => C().pants, v => { if (v === null) delete C().pants; else C().pants = v; restyle(); }));
  // no hat or face rows here (Leon, 2026-10-02): those are worn from the inventory
  const note = document.createElement('p');
  note.className = 'gnote';
  note.innerHTML = 'Hats, unique drivers and the rest are in your <button type="button">Inventory</button>.';
  note.querySelector('button').onclick = () => hub && hub.show('inv');
  box.appendChild(note);
}
/* A second colour and which way it runs, for a gradient over the paint. */
function buildGradient() {
  const box = el('gradient');
  const K = () => myStyle.kart || (myStyle.kart = {});
  box.appendChild(segRow('Gradient', [['none', 'Off'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top']], () => K().grad || 'none',
    v => { K().grad = v; if (v !== 'none' && (K().paint2 === undefined || K().paint2 === null)) K().paint2 = 0x2b56d6; restyle(); }));
  box.appendChild(swatchRow('To', CLOTH, () => K().paint2, v => { if (v === null) delete K().paint2; else K().paint2 = v; if (K().grad === 'none' || !K().grad) K().grad = 'front'; restyle(); }));
  const note = document.createElement('p');
  note.className = 'gnote';
  note.innerHTML = 'Kart skins (stripes, flames, galaxy…) are in your <button type="button">Inventory</button>.';
  note.querySelector('button').onclick = () => hub && hub.show('inv');
  box.appendChild(note);
}

/* What the build is worth to drive. Bars rather than numbers, because nobody
   reads 1.08 and nobody needs to: what matters is that picking the heavy body
   moved two of them up and two of them down. */
function drawBars() {
  const box = el('gbars');
  if (!box) return;
  const st = statsOf(myBuild);
  box.textContent = '';
  for (const b of BARS) {
    const row = document.createElement('div');
    row.className = 'bar';
    const nm = document.createElement('span');
    nm.textContent = b.name;
    const track = document.createElement('i');
    const fill = document.createElement('u');
    // a build sits somewhere between about two thirds and about a half again,
    // so that is the range the bar covers
    fill.style.width = clamp((st[b.key] - 0.7) / 0.9, 0.04, 1) * 100 + '%';
    track.appendChild(fill);
    row.append(nm, track);
    box.appendChild(row);
  }
}



async function start(online) {
  if (started) return;
  // the garage has done its job; give the context back before a race wants it
  if (garage) { garage.dispose(); garage = null; }
  const wantLobby = online === undefined ? true : !!online;
  snd.start();                             // the click that got us here is the gesture
  el('load').textContent = 'laying out the circuit…';
  await new Promise(r => setTimeout(r, 20));
  buildWorld(newSoloSeed(), pickedTheme);
  initFx(scene);

  el('load').textContent = 'lining up…';
  await new Promise(r => setTimeout(r, 20));

  // the lobby decides the round, when you asked for one
  try {
    if (!wantLobby) throw new Error('solo');
    const mod = await import('./net.js?v=98');
    net = mod.connect({
      scene, THREE, say, esc,
      get name() { return myName; },
      get cast() { return packLook(myCast, myBuild, myColour); },
      world: {
        startRound, get karts() { return karts; }, get me() { return me; },
        restyle: restyleKart,
        setPhase(p, t, extra) {
          phase = p; phaseT = t;
          lobbyShow(p === 'wait');
          if (p === 'count') setLights(t);
          if (p === 'race' && !extra) goRace();
          if (p === 'results') endRace();
        },
        setSpectating(v) {
          spectating = v;
          watchId = null;
          specKey = '';
          el('watch').classList.toggle('on', v);
          drawWatchBar();
        },
        hitBy, nameOf,
        oil: oilSplat,
        setVotes(v, mine) { voteCount = v || {}; if (mine !== undefined) myVote = mine; drawVote(); },
        shoveCone(i, vx, vz) { if (cones) cones.shove(i, vx, vz); },
        setCup,
        spinOut, useItem, items: () => items, track: () => track,
        get raceTime() { return raceTime; },
        addTime(dt) { raceTime += dt; },
        setRaceTime(t) { raceTime = t; },
        RACERS, notice,
      },
    });
  } catch (e) {
    net = null;
    if (wantLobby) say('Racing on your own, the lobby is not reachable.', 'sys');
  }

  // wait for the lobby to answer one way or the other before deciding this is a
  // solo race, or every session starts a race of its own and then throws it away
  if (net) { for (let i = 0; i < 44 && !net.settled; i++) await new Promise(r => setTimeout(r, 50)); }
  if (net && !net.alive) { net = null; say('The lobby did not answer. Racing on your own.', 'sys'); }

  started = true;
  el('title').classList.add('gone');
  if (rkFirst) { const f = rkFirst; rkFirst = null; f(); }
  else if (!net || !net.alive) startRound(null, soloSeed, undefined, pickedTheme);
  el('hud').classList.add('on');
}

/* The five places, as swatches of their own sky over their own ground. Picking
   one is remembered, because most people have a favourite and nobody wants to
   set it again every time. */
function buildMaps() {
  const box = el('maps');
  if (!box) return;
  box.innerHTML = '';
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = t.id === pickedTheme ? 'on' : '';
    const hex = n => '#' + n.toString(16).padStart(6, '0');
    b.innerHTML = '<i style="background:linear-gradient(' + hex(t.sky) + ' 0 55%,'
      + t.ground + ' 55% 100%)"></i>' + t.name;
    b.addEventListener('click', () => {
      pickedTheme = t.id;
      drawMapGhost();
      try { localStorage.setItem('mkTheme', t.id); } catch (e) {}
      [...box.children].forEach(c => c.classList.remove('on'));
      b.classList.add('on');
      el('mapnote').textContent = t.blurb;
    });
    b.addEventListener('mouseenter', () => { el('mapnote').textContent = t.blurb; });
    box.appendChild(b);
  });
  el('mapnote').textContent = themeById(pickedTheme).blurb;
}

buildMaps();
buildCast();
// the board on the menu, drawn from what this browser remembers and then
// brought up to date from the server
drawTimes();
fetchBoard();
/* One listener on the strip rather than one a button: the buttons are rebuilt
   whenever the running order changes, and listeners bound to them would go with
   them. */
el('spec').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.hasAttribute('data-step')) watchStep(+b.getAttribute('data-step') || 1);
  else if (b.hasAttribute('data-id')) watchWho(b.getAttribute('data-id'));
});

/* Singleplayer asks where first. The place decides the circuit, and the
   circuit is the first thing a race builds, so the choice has to be made before
   anything is - and it is its own screen now rather than a row of swatches on
   the menu that most people never noticed they could change. */
function mapScreen(on) {
  el('mapsel').classList.toggle('on', on);
  if (on) drawMapGhost();
  if (on) {
    const cur = el('maps').querySelector('button.on') || el('maps').querySelector('button');
    if (cur) cur.focus();
  }
}
el('solo').addEventListener('click', () => mapScreen(true));
el('mapback').addEventListener('click', () => mapScreen(false));
/* Race your own best on the track you have picked, if you have one there.
   A switch rather than a second button, so Race still starts the race. */
let mapGhostOn = false;
function drawMapGhost() {
  const b = el('mapghost');
  if (!b) return;
  const g = bestGhost(pickedTheme);
  b.hidden = !g;
  if (!g) { mapGhostOn = false; return; }
  b.setAttribute('aria-pressed', mapGhostOn ? 'true' : 'false');
  b.classList.toggle('on', mapGhostOn);
  b.innerHTML = '<i>' + icon('ghost') + '</i><span>Race my best</span><b>' + time(g.time) + '</b>';
}
el('mapghost').addEventListener('click', () => { mapGhostOn = !mapGhostOn; drawMapGhost(); });
/* Race or Time trial is the start button: pick the track, then pick how to
   drive it, and you are on the grid. */
el('mapmode').addEventListener('click', e => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  mode = b.dataset.m;
  replay = false;
  // your best for the way you chose to drive it, or your race best if there is no trial yet
  const g = mapGhostOn ? (bestGhost(pickedTheme, mode === 'tt') || bestGhost(pickedTheme)) : null;
  ghostWant = g ? Object.assign({}, g, { label: 'Your best' }) : null;
  mapScreen(false);
  start(false);
});
addEventListener('keydown', e => {
  if (!el('mapsel').classList.contains('on')) return;
  if (e.key === 'Escape') { mapScreen(false); e.preventDefault(); }
});

/* How many people are in the lobby right now, on the Multiplayer button, so you
   can see whether there is anybody to race before you go in. Asked for while the
   menu is up and not otherwise. */
function onlineCount() {
  if (started) return;
  fetch(MC + '/mk/count', { cache: 'no-store' })
    .then(r => r.json())
    .then(j => {
      const box = el('onlinecount');
      if (!box || !j || typeof j.players !== 'number') return;
      const n = j.players;
      box.textContent = n === 0 ? 'nobody online yet'
        : n + ' online' + (j.phase === 'race' || j.phase === 'count' ? ' \u00b7 racing now' : '');
      box.parentNode.classList.toggle('live', n > 0);
    })
    .catch(() => {});
}
onlineCount();
setInterval(onlineCount, 10000);

el('online').addEventListener('click', () => start(true));
frame();

/* a handle, so a test can drive the whole thing without a keyboard */
/* ------------------------------------------------------------ the lobby ----- */
// The waiting room: everyone drives about on the same circuit with nothing being
// counted, until somebody calls the race on.
/* The vote. Everybody in the room gets one, the number keys cast it, and the
   count sits under the banner so you can see which way it is going and change
   your mind. Nobody voting is not a stalemate, so the server picks at random. */
let voteCount = {};
function drawVote() {
  const box = el('vote');
  if (!box) return;
  box.innerHTML = THEMES.map((t, i) =>
    '<button data-id="' + t.id + '"' + (myVote === t.id ? ' class="on"' : '') + '>'
    + '<b>' + (i + 1) + '</b>' + esc(t.name)
    + '<i>' + (voteCount[t.id] || 0) + '</i></button>').join('');
}
let myVote = null;
function castVote(id) {
  if (!net || !net.alive || phase !== 'wait') return;
  myVote = id;
  voteCount = Object.assign({}, voteCount);
  net.vote(id);
  drawVote();
}

function lobbyShow(on) {
  snd.music(on, 'lobby');
  el('lobby').classList.toggle('on', on);
  el('board').classList.toggle('on', !on);
  el('hud').classList.toggle('lobby', on);
  el('lobbykey').textContent = keyName(bind.go[0] || 'k');
  el('vote').classList.toggle('on', on && !!(net && net.alive));
  if (on) drawVote();
  if (on) { el('count').classList.remove('on'); el('results').classList.remove('on'); }
}

/* ------------------------------------------------------------- the menu ----- */
// Esc stops the race and puts a card in front of it. Two pages: the short list
// of things you can do, and the key table behind Controls.
let waiting = null;                         // { action, slot } while a key is being caught
function menu(on) {
  paused = !!on;
  waiting = null;
  el('menu').classList.toggle('on', paused);
  if (!paused) return;
  menuPage('main');
  // the same menu from the title screen: nothing to resume, restart or leave
  el('menu').querySelector('h2').textContent = started ? 'Paused' : 'Settings';
  el('resume').textContent = started ? 'Resume race' : 'Back';
  el('restart').hidden = !started || !!(net && net.alive) || !!(rk && (rk.watch || rk.res || rk.done));
  el('restart').firstChild.textContent = rk ? 'Restart (' + rk.left + ' left)' : 'Restart race';
  el('tostart').firstChild.textContent = rk && !rk.watch && !rk.res ? 'Forfeit and go home' : 'Home';
  el('tostart').hidden = !started;
  el('vol').value = String(Math.round(snd.volume_() * 100));
  el('voln').textContent = el('vol').value;
  el('resume').focus();
}
function menuPage(which) {
  el('menumain').hidden = which !== 'main';
  el('menukeys').hidden = which !== 'keys';
  if (which === 'keys') drawBinds();
}
const KEYNAME = { ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
function keyName(k) {
  if (KEYNAME[k]) return KEYNAME[k];
  return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
}
function drawBinds() {
  el('bindrows').innerHTML = Object.keys(BINDS).map(a => {
    const chips = [0, 1].map(i => {
      const k = bind[a][i];
      const now = waiting && waiting.action === a && waiting.slot === i;
      const cls = now ? 'wait' : (k === undefined ? 'none' : '');
      return '<button class="' + cls + '" data-a="' + a + '" data-i="' + i + '">'
        + (now ? '…' : (k === undefined ? '+' : esc(keyName(k)))) + '</button>';
    }).join('');
    return '<div class="b"><span>' + BINDS[a].name + '</span><div class="ks">' + chips + '</div></div>';
  }).join('');
}
function bindTo(k) {
  const w = waiting;
  waiting = null;
  if (k === 'escape') { drawBinds(); return; }        // changed your mind
  for (const a in bind) if (a !== w.action) bind[a] = bind[a].filter(x => x !== k);
  const list = bind[w.action].slice();
  list[w.slot] = k;
  bind[w.action] = list.filter(x => x !== undefined && x !== null);
  bindSave();
  drawBinds();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
el('resume').addEventListener('click', () => menu(false));
el('setbtn').addEventListener('click', () => menu(true));
/* Straight into the same race again, on your own: same track, same mode, the
   same ghost if there was one. Not in a lobby, where the room decides. */
function restartRace() {
  if (rk) { rkRestart(); return; }
  if (net && net.alive) return;
  menu(false);
  el('results').classList.remove('on');
  soloRound++;
  startRound(null, newSoloSeed(), undefined, pickedTheme);
}
el('restart').addEventListener('click', restartRace);
el('again').addEventListener('click', () => { if (rk && rk.res) { if (rk.res.lost) goHome(); else rkLobby(); } else restartRace(); });
el('reshome').addEventListener('click', goHome);
el('tocontrols').addEventListener('click', () => menuPage('keys'));
// back to the title card, which is a fresh page rather than an unpicking of
// everything a race has set up
el('tostart').addEventListener('click', goHome);
el('bindback').addEventListener('click', () => menuPage('main'));
el('bindreset').addEventListener('click', () => { bindDefaults(); bindSave(); drawBinds(); });
el('bindrows').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  waiting = { action: b.dataset.a, slot: +b.dataset.i };
  drawBinds();
});
el('vol').addEventListener('input', () => {
  const v = +el('vol').value;
  el('voln').textContent = String(v);
  snd.volume(v / 100);
  if (snd.muted_()) snd.mute(false);           // reaching for the slider means you want sound
  try { localStorage.setItem('mkVol', String(v)); } catch (e) {}
});
try {
  const v = localStorage.getItem('mkVol');
  if (v !== null) snd.volume(+v / 100);
} catch (e) {}

/* ------------------------------------------------------------ custom maps --- */
/* The map being driven when it is somebody's built map: { id, name, data }.
   Its times go on its own board, never on the circuits' boards. */
function postCustomTime(t) {
  if (!customMap || !customMap.id) return;
  fetch(MC + '/kart/maps/time', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: customMap.id, name: (myName || '').trim(), time: +(+t).toFixed(2) }) })
    .then(r => r.json()).then(j => {
      if (j && j.ok) say(j.beat ? 'On ' + esc(customMap.name) + "'s board in " + ord(j.rank) + '.' : 'Your best on ' + esc(customMap.name) + ' still stands.', 'sys');
    }).catch(() => {});
}
/* What the builder and a played map are allowed to reach of the game. */
function editorCtx() {
  return {
    THREE, scene, camera, renderer, el, esc, MC,
    name: () => (myName || '').trim(),
    admin: () => adminPw,
    me: () => me,
    registerCustom(id, spec, theme, data) { customSpecs.set(id, spec); customData.set(id, data); registerTheme(theme); },
    dressSky: th => dressSky(th),
    renderNow() { renderer.render(scene, camera); return renderer.domElement; },
    setEditor(fn) { editorFrame = fn; },
    goHome,
    // building: the title and the race furniture away, and the world hidden behind the builder's own
    enterBuilder() {
      el('title').classList.add('gone');
      if (hub) hub.hide();
      el('hud').classList.remove('on');
      el('results').classList.remove('on');
      el('board').classList.remove('on');
      for (const o of scene.children) if (o.visible && !o.isLight && o !== sky && o.name !== 'editor') { o.visible = false; builderHidden.push(o); }
    },
    // into a car on it: a time trial or a race, on the place just registered
    drive(id, how, opts) {
      customMap = opts && opts.map ? opts.map : null;
      customLaps = (opts && (opts.laps || (opts.map && opts.map.laps))) || 3;
      mode = how === 'race' ? 'race' : 'tt';
      replay = false; ghostWant = null;
      pickedTheme = id;
      editorFrame = null;
      for (const o of builderHidden) o.visible = true;
      builderHidden = [];
      el('title').classList.add('gone');
      if (hub) hub.hide();
      if (!started) start(false);
      else { paused = false; el('menu').classList.remove('on'); el('results').classList.remove('on'); startRound(null, seedOf(id), undefined, id); }
    },
    // out of the car and back to building
    stopDrive() {
      phase = 'edit';
      snd.music(false);
      el('hud').classList.remove('on');
      el('results').classList.remove('on');
      el('count').classList.remove('on');
      for (const o of scene.children) if (o.visible && !o.isLight && o !== sky && o.name !== 'editor') { o.visible = false; builderHidden.push(o); }
    },
  };
}
function editorModule() {
  if (!editorMod) editorMod = import('./editor.js?v=98');
  return editorMod;
}
function playCustomMap(id, mode) {
  fetch(MC + '/kart/maps/get?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent((myName || '').trim()), { cache: 'no-store' })
    .then(r => r.json()).then(j => {
      if (!j || !j.map) { alert((j && j.error) || 'That map could not be loaded.'); return; }
      editorModule().then(E => E.playMap(editorCtx(), j.map, mode));
    }).catch(() => alert('The server could not be reached.'));
}
function openEditor(id, pw) {
  const go = map => editorModule().then(E => E.openEditor(editorCtx(), map, pw));
  if (!id) { go(null); return; }
  fetch(MC + '/kart/maps/get?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json())
    .then(j => { if (j && j.map) go(j.map); else alert((j && j.error) || 'That map could not be loaded.'); })
    .catch(() => alert('The server could not be reached.'));
}

/* ------------------------------------------------------------- ranked ------- */
/* One on one. The race is the time trial: your run, their run as a ghost you
   can see but not touch, three restarts each. The server keeps the count and
   settles the result; this side drives, reports, and shows what it said. */
function goHome() {
  // back to the title card, keeping a test's server if there was one
  const ws = new URLSearchParams(location.search).get('ws');
  location.href = location.pathname + (ws ? '?ws=' + encodeURIComponent(ws) : '');
}
rkNet = makeRanked({
  el, esc, time,
  themes: () => THEMES.map(t => t.id),
  themeName: id => themeById(id).name,
  name: () => myName,
  cast: () => packLook(myCast, myBuild, myColour),
  started: () => started,
  inBattle: () => !!(rk && !rk.watch && !rk.res),
  watching: () => !!(rk && rk.watch && !rk.res),
  // driving something else: accepting a challenge leaves it
  racing: () => started && !(rk && !rk.res),
  fans(n) { rkFans = n; },
  counted(j) { if (!started) showRankedCount(j); },
  watchStatus(m) {
    if (!rk || !rk.watch || !rk.single || rk.pid !== m.id || rk.res) return;
    if (['solo', 'tt', 'multi', 'replay'].indexOf(m.mode) >= 0 && m.theme) {
      rk.theme = m.theme; rk.mode = m.mode;
      rkSeen.clear();
      rkWatchRound();
    } else {
      const who = rk.players[0].name;
      rkLobby();
      rkNet.msg(who + ' stopped racing.');
    }
  },
  watchEnd(m) {
    if (rk && rk.watch && rk.single && rk.pid === m.id && !rk.res) rkLobby();
  },
  home: goHome,
  ding() { try { snd.beep(false); } catch (e) {} },
  lost() {
    // the line went: whatever was going on cannot be settled from here
    if (rk && !rk.res) { rk.res = { lost: true }; if (phase !== 'results') endRace(); else rkPanel(); }
  },
  beginMatch(m) {
    rkSeen.clear();
    rkFans = 0;
    /* Accepted from inside a multiplayer lobby: leave it for the battle. The
       lobby's own furniture goes with it. */
    if (net) {
      net.close(); net = null;
      lobbyShow(false);
      el('vote').classList.remove('on');
      el('cup').classList.remove('on');
      el('watch').classList.remove('on');
      spectating = false;
    }
    rk = { watch: false, id: m.id, me: m.me, theme: m.theme, opp: m.opp, left: m.restarts, oppLeft: m.restarts,
           done: false, oppDone: 0, res: null };
    rkBegin(() => startRound(rkField(), 0, undefined, rk.theme));
  },
  beginWatch(w) {
    rkSeen.clear();
    // a battle has an id; one player racing on their own or in multiplayer does not
    rk = { watch: true, single: !w.id, pid: w.pid || null, mode: w.mode || null, id: w.id,
           theme: w.theme, players: w.players, res: null };
    for (const p of w.players) if (p.time) rkSeen.set(p.id, { fin: p.time });
    rkBegin(rkWatchRound);
  },
  restartOk(ok, left) {
    if (!rk || rk.watch) return;
    rk.left = left;
    if (!ok) notice('No restarts left');
    rkHud(true);
  },
  pos(m) {
    if (!rk || rk.res) return;
    let p = rkSeen.get(m.id);
    if (!p) { p = {}; rkSeen.set(m.id, p); }
    const k = karts.find(q => q.id === m.id);
    // a restart puts them back on the grid: cut to it rather than slide there
    const jump = p.tx === undefined || Math.hypot(m.x - p.tx, m.z - p.tz) > 30;
    p.tx = m.x; p.ty = m.y; p.tz = m.z; p.tyaw = m.yaw; p.sp = m.sp; p.lap = m.lap; p.t = m.t;
    p.prog = m.prog || 0; p.cpi = m.cpi || 0;
    if (k && jump) { k.pos.set(p.tx, p.ty, p.tz); k.yaw = p.tyaw; }
  },
  oppRestart(m) {
    if (!rk) return;
    if (rk.watch) { const p = rk.players.find(q => q.id === m.id); if (p) p.left = m.left; }
    else rk.oppLeft = m.left;
    const k = karts.find(q => q.id === m.id);
    if (k) { k.finished = 0; k.time = 0; }
    say('<b>' + esc(m.name) + '</b> restarted, ' + m.left + ' left.', 'sys');
    rkHud(true);
  },
  oppFinish(m) {
    if (!rk) return;
    const k = karts.find(q => q.id === m.id);
    if (k) { k.finished = 1; k.time = m.time; k.lap = LAPS; }
    const p = rkSeen.get(m.id) || {};
    // home: it stops where it crossed rather than being dead reckoned on into the scenery
    p.fin = m.time; p.sp = 0; rkSeen.set(m.id, p);
    if (!rk.watch) {
      rk.oppDone = m.time;
      if (!rk.done) notice(m.name + ' finished in ' + time(m.time), { text: 'beat it to win' });
      else rkPanel();
    }
    say('<b>' + esc(m.name) + '</b> finished in ' + time(m.time) + '.', 'sys');
    rkHud(true);
  },
  result(m) {
    // a battle you had already finished, settled after you moved on: news, not the verdict on this one
    if (!rk || m.id !== rk.id) {
      if (m.winner) say('<b>' + esc(m.winner) + '</b> won an earlier battle, +' + (+m.gain).toFixed(2) + '.', 'sys');
      return;
    }
    rk.res = m;
    rkHud(true);
    /* The verdict can land in the same moment as your own finish, before the
       race has been ended here: end it properly, so your time still goes to
       the time trial board. */
    if (phase !== 'results') endRace();
    else rkPanel();
    el('results').classList.add('on');
  },
});
// the track they are on, with their kart (or both karts) on it and the race already running
function rkWatchRound() {
  if (net) { net.close(); net = null; lobbyShow(false); el('vote').classList.remove('on'); }
  startRound(rk.players.map(p => ({ id: p.id, name: p.name, cast: p.cast })), 0, undefined, rk.theme);
  phase = 'race'; phaseT = 0;
  el('count').classList.remove('on');
  el('watch').classList.remove('on');
  snd.music(true, 'race');
  for (const k of karts) { const p = rkSeen.get(k.id); if (p && p.fin) { k.finished = 1; k.time = p.fin; } }
  rkHud(true);
}
// what this page is doing, for the ranked list everybody else sees
function rkReport() {
  if (!rkNet) return;
  const m = rk ? (rk.watch && !rk.res ? 'watch' : 'title')
    : !started ? 'title' : (net && net.alive) ? 'multi' : replay ? 'replay' : quietRound ? 'tt' : 'solo';
  rkNet.status({ mode: m, theme: started && !rk ? worldTheme : null, round: ++rkRound });
}
function rkField() {
  return [{ id: rk.me, name: rkNet.name || myName, cast: packLook(myCast, myBuild, myColour) },
          { id: rk.opp.id, name: rk.opp.name, cast: rk.opp.cast }];
}
function rkBegin(fn) {
  mode = 'tt'; replay = false; ghostWant = null;
  pickedTheme = rk.theme;
  if (paused) menu(false);
  el('results').classList.remove('on');
  el('mapsel').classList.remove('on');
  const go = () => { fn(); rkHud(true); };
  if (started) go();
  else { rkFirst = go; start(false); }
}
// your kart in the first slot, and theirs on top of it, the way a ghost starts
function rkGrid() {
  const s0 = track.gridSlot(0);
  for (const k of karts) {
    if (k === me) continue;
    const p = rkSeen.get(k.id);
    if (p && p.tx !== undefined) { k.pos.set(p.tx, p.ty, p.tz); k.yaw = p.tyaw; }
    else {
      k.pos.copy(s0.pos); k.yaw = s0.yaw;
      const pr = track.project(k.pos.x, k.pos.z, null);
      k.hint = pr.i; k.pos.y = pr.y;
    }
    apply(k);
  }
}
function rkRestart() {
  if (!rk || rk.watch || rk.res || rk.done) return;
  if (rk.left <= 0) { notice('No restarts left', { text: 'this run counts' }); return; }
  rk.left--;
  rkNet.restart();
  if (paused) menu(false);
  el('results').classList.remove('on');
  soloRound++;
  startRound(rkField(), 0, undefined, rk.theme);
  rkHud(true);
}
// back to the list, with the last battle's track still standing behind it
function rkLobby() {
  el('results').classList.remove('on');
  if (rk && rk.watch && !rk.res) { rkNet.unwatch(); rk.res = { stopped: true }; }
  phase = 'results'; phaseT = 1e9;
  snd.music(false);
  el('rkhud').classList.remove('on');
  el('spec').classList.remove('on');
  rkNet.show(true);
}
let rkSendAt = 0, rkHudAt = 0;
function rkTick(dt) {
  const now = performance.now();
  /* Outside a battle: only somebody watching you wants to know where you are,
     and then from whatever you are driving, on your own or in a lobby. */
  if (!rk) {
    if (rkFans > 0 && me && (phase === 'race' || phase === 'count' || phase === 'wait') && now - rkSendAt > 100) {
      rkSendAt = now;
      rkNet.pos({
        x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), yaw: +me.yaw.toFixed(3),
        lap: me.lap, t: +(phase === 'race' ? raceTime : 0).toFixed(2), sp: +me.speed.toFixed(2),
        prog: +me.prog.toFixed(1), cpi: me.cpi,
      });
    }
    return;
  }
  // yours, to the other driver and anybody watching
  if (!rk.watch && !rk.res && me && (phase === 'race' || phase === 'count') && now - rkSendAt > 80) {
    rkSendAt = now;
    rkNet.pos({
      x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), yaw: +me.yaw.toFixed(3),
      lap: me.lap, t: +(phase === 'race' ? raceTime : 0).toFixed(2), sp: +me.speed.toFixed(2),
      prog: +me.prog.toFixed(1), cpi: me.cpi,
    });
  }
  // theirs, eased towards the last thing they said
  if (!rk.res && !paused) {
    for (const k of karts) {
      if (!k.remote) continue;
      const p = rkSeen.get(k.id);
      if (!p || p.tx === undefined) continue;
      const a = 1 - Math.exp(-12 * dt);
      k.pos.x += (p.tx - k.pos.x) * a;
      k.pos.y += (p.ty - k.pos.y) * a;
      k.pos.z += (p.tz - k.pos.z) * a;
      let d = p.tyaw - k.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      k.yaw += d * (1 - Math.exp(-10 * dt));
      k.speed = p.sp || 0;
      if (!k.finished) { k.lap = p.lap || 1; k.prog = p.prog || 0; k.cpi = p.cpi || 0; }
      k.wheelSpin = (k.wheelSpin || 0) + k.speed * dt / 0.38;
      // between packets it keeps going the way it was going
      p.tx += -Math.sin(p.tyaw) * (p.sp || 0) * dt;
      p.tz += -Math.cos(p.tyaw) * (p.sp || 0) * dt;
      if (p.t > 0) p.t += dt;
    }
  }
  // watching, the clock is the driver's own clock
  if (rk.watch && !rk.res && phase === 'race') {
    const w = watched();
    const p = w && rkSeen.get(w.id);
    if (p && p.t !== undefined) raceTime = p.t;
  }
  if (now - rkHudAt > 250) { rkHudAt = now; rkHud(); }
}
/* The strip under the clock: who you are up against, how many restarts are
   left on each side, and where they are. */
let rkHudKey = '';
function rkHud(force) {
  const box = el('rkhud');
  if (!rk || rk.res || !started) { box.classList.remove('on'); rkHudKey = ''; return; }
  box.classList.add('on');
  const where = k => {
    if (!k) return '';
    if (k.finished) return 'finished ' + time(k.time);
    return 'lap ' + Math.min(LAPS, k.lap || 1) + '/' + LAPS;
  };
  let html;
  if (rk.watch && rk.single) {
    const p = rk.players[0], k = karts.find(q => q.id === p.id);
    const how = rk.mode === 'multi' ? 'multiplayer' : rk.mode === 'tt' ? 'time trial'
      : rk.mode === 'replay' ? 'a replay' : 'singleplayer';
    html = '<span class="lbl">Watching</span><span class="who"><b>' + esc(p.name) + '</b><small>' + how
      + ' \u00b7 ' + esc(themeById(rk.theme).name.split(' ')[0]) + (k ? ' \u00b7 ' + where(k) : '') + '</small></span>'
      + '<button type="button" id="rkstop">Stop watching</button>';
  } else if (rk.watch) {
    html = '<span class="lbl">Watching</span>' + rk.players.map(p => {
      const k = karts.find(q => q.id === p.id);
      return '<span class="who"><b>' + esc(p.name) + '</b><small>' + where(k) + ' · '
        + (p.left === undefined ? 3 : p.left) + ' restarts</small></span>';
    }).join('<span class="vs">vs</span>')
      + '<button type="button" id="rkstop">Stop watching</button>';
  } else {
    const o = karts.find(q => q.id === rk.opp.id);
    html = '<span class="who"><b>You</b><small>' + rk.left + (rk.left === 1 ? ' restart' : ' restarts') + ' left</small></span>'
      + '<span class="vs">vs</span>'
      + '<span class="who"><b>' + esc(rk.opp.name) + '</b><small>' + (rk.oppDone ? 'finished ' + time(rk.oppDone) : where(o))
      + ' · ' + rk.oppLeft + ' left</small></span>';
  }
  if (!force && html === rkHudKey) return;
  rkHudKey = html;
  box.innerHTML = html;
}
el('rkhud').addEventListener('click', e => { if (e.target.id === 'rkstop') rkLobby(); });

/* The results card, in a battle. Before the verdict: your time, and theirs or
   that they are still out there. After it: who won and what it was worth. */
function rkPanel() {
  if (!rk) return;
  const r = rk.res;
  el('cup').classList.remove('on');
  el('resfoot').hidden = true;
  el('resbtns').hidden = !r;
  el('again').textContent = 'Ranked lobby';
  const row = (i, name, t, mine) => '<div class="r' + (mine ? ' me' : '') + (i === 0 ? ' p1' : '') + '">'
    + '<span class="p">' + (i + 1) + '</span><span>' + esc(name) + '</span>'
    + '<span class="t">' + t + '</span></div>';
  if (!r) {
    const mine = me && me.finished && !me.dnf ? me.time : 0;
    el('restitle').textContent = mine ? 'Your time: ' + time(mine) : 'Did not finish';
    const opp = rk.oppDone ? time(rk.oppDone) : 'still driving';
    const rows = rk.oppDone && rk.oppDone < mine
      ? [[rk.opp.name, opp, false], [rkNet.name || myName, time(mine), true]]
      : [[rkNet.name || myName, mine ? time(mine) : 'DNF', true], [rk.opp.name, opp, false]];
    el('resrows').innerHTML = rows.map((x, i) => row(i, x[0], x[1], x[2])).join('')
      + '<p class="rkline">' + (rk.oppDone ? 'Settling up…'
        : 'Waiting for ' + esc(rk.opp.name) + ' to finish. They have up to two minutes.') + '</p>';
    return;
  }
  if (r.lost) {
    el('restitle').textContent = 'Connection lost';
    el('resrows').innerHTML = '<p class="rkline">The connection to ranked dropped, so this battle could not be settled here.</p>';
    el('again').textContent = 'Home';
    return;
  }
  if (r.stopped) return;
  const mine = rkNet.name || myName;
  /* By connection, not by name: two tabs under one name can battle each
     other, and then the names say nothing about which side is you. */
  const rows = (r.rows || []).slice().sort((a, b) => (a.id === r.wid ? -1 : b.id === r.wid ? 1 : 0));
  const tOf = id => { const x = rows.find(q => q.id === id); return x ? x.time : null; };
  el('restitle').textContent = rk.watch
    ? (r.winner ? r.winner + ' wins' : 'A draw')
    : r.wid === rk.me ? 'You win!' : r.lid === rk.me ? 'You lose' : 'A draw';
  const why = r.why === 'forfeit' ? ' (forfeited)' : r.why === 'left' ? ' (left)' : r.why === 'time' ? ' (out of time)' : '';
  let line;
  if (!r.winner) line = 'Nobody gains anything.';
  else if (r.dnf) line = '<b>' + esc(r.winner) + ' wins</b> · ' + esc(r.loser) + ' did not finish' + why;
  else line = '<b>' + esc(r.winner) + ' wins</b> by ' + (tOf(r.lid) - tOf(r.wid)).toFixed(2) + ' s';
  el('resrows').innerHTML = rows.map((x, i) => row(i, x.name, x.time ? time(x.time) : x.id === r.wid ? '—' : 'DNF', !rk.watch && x.id === rk.me)).join('')
    + '<p class="rkline">' + line + '</p>'
    + (!rk.watch && r.points && r.points[mine] !== undefined
      ? '<p class="rkline sm">Your ranked score is now ' + (+r.points[mine]).toFixed(1) + ' out of 100.</p>' : '');
  fetchRanked();
}

/* ---- on the title screen: the button, the count on it, and the board ---- */
let rankedBoard = null;
function fetchRanked() {
  fetch(MC + '/kart/ranked', { cache: 'no-store' })
    .then(r => r.json())
    .then(j => { if (j && j.board) { rankedBoard = j.board; if (boardTab === 'rk') drawTimes(); } })
    .catch(() => {});
}
function drawRankedTimes(box) {
  box.classList.remove('old');
  const full = rankedBoard || [];
  const rows = full.slice(0, 10);
  const key = (myName || '').trim().toLowerCase();
  const at = key ? full.findIndex(r => String(r.name).toLowerCase() === key) : -1;
  box.innerHTML = head('Best times', '')
    + '<div class="tabs" role="tablist">'
    + '<button type="button" role="tab" data-tab="race" aria-selected="false">Race</button>'
    + '<button type="button" role="tab" data-tab="tt" aria-selected="false">Time trial</button>'
    + '<button type="button" role="tab" data-tab="rk" aria-selected="true">Ranked</button></div>'
    + '<p class="sub">Ranked score · won and lost</p>'
    + (rows.length
      ? '<div class="rows rk">' + rows.map((r, i) =>
          '<div class="r' + (i === 0 ? ' p1' : '') + (i === at ? ' me' : '') + '"><span class="p">' + (i + 1) + '</span>'
          + '<span>' + esc(r.name) + '</span><span class="wl">' + r.wins + '–' + r.losses + '</span>'
          + '<span class="t">' + (r.score !== undefined ? r.score : r.points).toFixed(1) + '</span></div>').join('') + '</div>'
      : '<p class="none">Nobody has played a ranked battle yet.</p>')
    + '<div class="mine"><span>Your score</span><b>' + (at >= 0 ? (full[at].score !== undefined ? full[at].score : full[at].points).toFixed(1) : '&mdash;') + '</b></div>'
    + (at >= 10 ? '<div class="mine place"><span>You place</span><b>' + ord(at + 1) + '</b></div>' : '')
    + '<div class="rkf" aria-label="How the ranked score is worked out"><b>Score</b> = 50 &times; (your wins &divide; most wins on the board) + 50 &times; win rate &minus; 0.1 &times; losses<br><b>Win rate</b> = (wins + 1) &divide; (wins + losses + 2)</div>';
  wireTabs(box);
}
function wireTabs(box) {
  box.querySelectorAll('.tabs [data-tab]').forEach(t => t.addEventListener('click', () => {
    boardTab = t.dataset.tab;
    showingOld = false;
    if (boardTab === 'rk') fetchRanked();
    drawTimes();
  }));
}
function rankedCount() {
  if (started) return;
  fetch(MC + '/kart/ranked/count', { cache: 'no-store' })
    .then(r => r.json())
    .then(showRankedCount)
    .catch(() => {});
}
function showRankedCount(j) {
  const box = el('rkcount');
  if (!box || !j || typeof j.players !== 'number') return;
  const n = typeof j.ranked === 'number' ? j.ranked : j.players;
  box.textContent = n + ' in ranked \u00b7 ' + j.players + ' online'
    + (j.battles ? ' \u00b7 ' + j.battles + (j.battles === 1 ? ' battle' : ' battles') : '');
  box.parentNode.classList.toggle('live', j.players > 0);
}
rankedCount();
setInterval(rankedCount, 10000);
fetchRanked();
el('ranked').addEventListener('click', () => rkNet.show(true));
/* ---- the pages behind the home screen ---- */
hub = makeHub({
  el, esc, MC, time,
  name: () => (myName || '').trim(),
  inv: () => myInv,
  held: () => myHeld,
  racer: () => myRacer(),
  build: () => myBuild,
  style: () => myStyle,
  setStyle(fn) { fn(myStyle); restyle(); },
  admin: () => adminPw,
  racers: RACERS,
  typing: () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); },
  notice: t => { const n = el('hubnote'); if (n) n.textContent = t; else alert(t); },
  mapName: id => (String(id).indexOf('c:') === 0 ? 'Custom map' : themeById(id).name),
  playMap: (id, mode) => playCustomMap(id, mode),
  editMap: (id, pw) => openEditor(id, pw),
});
loadProfile(!localStorage.getItem('mkStyle'));
// on the list from the moment the page opens, whatever you go on to play
rkNet.presence();

window.__mk = {
  get phase() { return phase; },
  get karts() { return karts; },
  get me() { return me; },
  get track() { return track; },
  get items() { return items; },
  get results() { return results; },
  get spectating() { return spectating; },
  get rk() { return rk; },
  get rkNet() { return rkNet; },
  get rkFans() { return rkFans; },
  // a test cannot join a lobby to be put in the stands, so it says so directly
  spectate(on) {
    spectating = !!on;
    watchId = null;
    specKey = '';
    el('watch').classList.toggle('on', spectating);
    drawWatchBar();
    if (spectating) snapCamera();
    return spectating;
  },
  get watching() { const w = watched(); return w ? w.id : null; },
  get camera() { return camera; },
  get props() { return scene.getObjectByName('props'); },
  // the scene and the camera, so a test can ask what is on a given pixel
  get scene() { return scene; },
  get camera() { return camera; },
  get cones() { return cones; },
  get garage() { return garage; },
  tier: k => driftTier(k || me),
  // what the game has asked the speakers for, so a test can check it made the
  // noise rather than only that it did not throw
  get heard() { return snd.heard; },
  plantOn,
  // which quality step it has settled on, and a way to pin one for a test
  quality(n) { if (n !== undefined) { level = Math.max(0, Math.min(LEVELS.length - 1, n | 0)); applyLevel(); } return level; },
  // what the renderer is actually being asked to do, for a performance run
  // one frame drawn on demand, so a test can time the render on its own
  renderOnce() { renderer.render(scene, camera); },
  draw() {
    const i = renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles,
             geoms: i.memory.geometries, texs: i.memory.textures,
             programs: i.programs ? i.programs.length : 0 };
  },
  RACERS,
  get itemTable() { return ITEMS; },
  get hazards() { return hazards; },
  rebuild: (seed, theme) => buildWorld(seed | 0, theme),
  get theme() { return worldTheme; },
  // which place the next race is at, the way the map screen sets it
  get picked() { return pickedTheme; },
  // the ghost in the world, the recorder, and a way to race one without a board
  get ghost() { return ghost; },
  get recorder() { return recorder; },
  get trackPrint() { return trackPrint; },
  get runReady() { return runReady; },
  get mode() { return mode; },
  setMode(m) { mode = m === 'tt' ? 'tt' : 'race'; return mode; },
  get replay() { return replay; },
  get quiet() { return quietRound; },
  get boards() { return { race: raceBoard, tt: ttBoard }; },
  raceGhost(g, label) { return raceGhost(g, label); },
  // the ghost for the next round, without going back to the title for it
  setGhost(g, label) { ghostWant = g ? Object.assign({}, g, { label: label || 'Ghost' }) : null; return !!ghostWant; },
  bestGhost(t) { return bestGhost(t); },
  pick(id) { pickedTheme = themeById(id).id; return pickedTheme; },
  // the next round on your own, exactly as the results screen starts one
  restartSolo() { soloRound++; startRound(null, newSoloSeed(), undefined, pickedTheme); return true; },
  // a round at a named place, with whatever seed a lobby might have sent
  startAt(id, seed) { startRound(null, seed, undefined, themeById(id).id); return worldSeed; },
  sky: () => scene.background,
  get themes() { return THEMES.map(t => t.id); },
  get worldSeed() { return worldSeed; },
  /* The flattest, straightest stretch on whatever lap got drawn, clear of the
     ramps and the three big sections. A test that wants somewhere ordinary to
     stand a kart cannot name an arc length any more, because the arc lengths
     are different every race. */
  flat() {
    const S = track.samples, M = S.length;
    let best = { score: 1e9, s: 0 };
    for (let i = 0; i < M; i++) {
      const a = S[i], c = S[(i + 12) % M];
      let near = 0;
      for (const r of track.ramps) if (Math.abs(((i - r.i + M) % M + M / 2) % M - M / 2) < 20) near = 1;
      for (const f of track.features) if (f.ids.indexOf(i) >= 0) near = 1;
      if (near) continue;
      const turn = Math.abs(Math.atan2(a.t.x * c.t.z - a.t.z * c.t.x, a.t.x * c.t.x + a.t.z * c.t.z));
      const slope = Math.abs(track.project(a.p.x, a.p.z, i).slope);
      const score = turn * 3 + slope * 9;
      if (score < best.score) best = { score, s: a.s };
    }
    return best.s;
  },
  get items() { return items; },
  get paused() { return paused; },
  get sound() { return snd.musicNow(); },
  topOf: k => topSpeed(k),
  hitLine: (by, kind) => hitBy(by, kind),
  hurt: (x, z, speed, hard) => me && spinOut(me, !!hard, { x, z, speed }),
  oil: oilSplat,
  roll: (place, field) => rollItem(place, field, track.rules.items),
  get bind() { return bind; },
  menu,
  get view() { return CAM[camMode].name; },
  get views() { return CAM.map(c => c.name); },
  get net() { return net; },
  get started() { return started; },
  start,
  startSolo() { return start(false); },
  startOnline() { return start(true); },
  key(k, on) { keys[k] = !!on; },
  /* Bolt a build onto the player's kart, the way the garage does when a race
     starts, so a test can ask what a hauler drives like against a formula car
     without clicking through the garage to get there. */
  setBuild(build) { if (!me) return null; me.build = normalise(build); me.parts = statsOf(me.build); return me.parts; },
  // a test can freeze the loop and run the world by hand, which makes the
  // countdown and the finish deterministic instead of a race with the renderer
  pause(v) { frozen = !!v; return frozen; },
  // the clock the hazards run off, so a test can wind one to the moment it goes
  clock(t) { if (t !== undefined) raceTime = t; return raceTime; },
  // bring yourself home, so a test can finish a race without driving three laps
  finish() { if (me) finishKart(me); return me ? +me.time.toFixed(2) : 0; },
  // Park the camera somewhere and stop the follow camera fighting it, which is
  // the only way to photograph a whole section of the lap at once. Call it with
  // nothing to give the camera back.
  eye(from, at) {
    camPinned = !!from;
    if (!from) return false;
    camera.position.set(from[0], from[1], from[2]);
    camera.lookAt(at[0], at[1], at[2]);
    return true;
  },
  step(n, dt) {
    for (let i = 0; i < (n || 1); i++) {
      stepPhase(dt || 0.02);
      if (phase === 'race' || phase === 'count' || phase === 'wait') stepWorld(dt || 0.02);
      stepCamera(dt || 0.02);
    }
    drawHud(dt || 0.02);
  },
  autopilot(on) {
    autoBrain = on && me ? makeBrain(me, 0.95, 4242) : null;
    return !!autoBrain;
  },
  // what the autopilot is asking for, so a test can see why a car is not moving
  get brain() { return autoBrain; },
  /* The field back on the grid and the flag dropped again, on the circuit that
     is already built. rebuild() changes the road under the race but leaves the
     race itself running, so a test that drives five circuits back to back is
     really driving one race with the scenery swapped: lap counters, finishing
     times and the clock all carry, and somewhere in the fourth or fifth the
     race it is measuring quietly ends underneath it. */
  // what the field is currently trying, for a test that wants to watch the elastic
  // how hard each driver is being asked to try, and where it wants to be
  get pace() { return brains.map(b => ({ id: b.kart.id, mul: b.mul, gap0: b.gap0, skill: b.skill })); },
  /* Back on the grid with the lights running, which is the only way to drive
     a start more than once without reloading the page. */
  countdown() {
    window.__mk.restart();
    phase = 'count'; phaseT = 4.2; litWas = -1;
    for (const k of karts) { k.rev = 0; k.revHold = 0; k.stall = 0; k.boost = 0; k.speed = 0; }
    return true;
  },
  restart() {
    results.length = 0;
    for (const b of brains) b.mul = 1;
    raceTime = 0;
    phaseT = 0;
    notified = 0;
    placeOnGrid();
    phase = 'race';
    // and whatever was on the screen when the last one ended comes off it
    el('count').classList.remove('on', 'go');
    el('results').classList.remove('on');
    return true;
  },
  // giveItem sets what is in your hand, addItem lands one behind it the way a
  // box does. A test wants both, and confusing them makes it ask for one thing
  // and get another.
  giveItem(id, n) { if (me) { me.item = id; me.itemN = n || 1; me.queue = []; me.roulette = 0; hudItem(); } },
  addItem(id, n) {
    if (!me) return;
    if (me.item) me.queue.push({ id, n: n || 1 });
    else { me.item = id; me.itemN = n || 1; }
    me.roulette = 0; hudItem();
  },
  get held() { return me ? [me.item && { id: me.item, n: me.itemN }].filter(Boolean).concat(me.queue) : []; },
  use() { useItem(me); },
  /* Tap to throw, hold to trail. key() sets the key map rather than going
     through the keyboard listeners, and both halves of this live in those, so
     a test drives them directly. */
  hold(on) { if (on) itemDown(me); else itemUp(me); return me ? (me.holdKind || null) : null; },
  get brains() { return brains; },
  tp(s, lateral) { return window.__mk.tpKart(me, s, lateral); },
  tpKart(k, s, lateral) {
    if (!k) return;
    const a = track.at(((s % track.length) + track.length) % track.length);
    k.pos.copy(a.p).addScaledVector(a.n, (lateral || 0) * a.w);
    k.yaw = Math.atan2(-a.t.x, -a.t.z);
    k.hint = null;
    // put it down on the road: teleporting a kart that happened to be mid-jump
    // left it holding the launch it had already used, and it could not take off
    // again until it had landed somewhere it was no longer standing
    k.hop = 0; k.hopV = 0; k.launched = 0; k.roadRise = 0; k.pushX = 0; k.pushZ = 0;
    const pr = track.project(k.pos.x, k.pos.z, null);
    k.hint = pr.i; k.pos.y = pr.y; k.prog = pr.s;
  },
  stats() {
    return {
      phase, phaseT: +phaseT.toFixed(2), spectating, laps: LAPS, lap: me ? me.lap : 0, place: me ? me.place : 0,
      speed: me ? +me.speed.toFixed(2) : 0,
      item: me ? me.item : null, itemN: me ? me.itemN : 0,
      queued: me ? me.queue.length : 0,
      karts: karts.length, bots: brains.length, time: +raceTime.toFixed(2),
      finished: me ? !!me.finished : false, results: results.length,
      trackLen: track ? Math.round(track.length) : 0,
    };
  },
};
