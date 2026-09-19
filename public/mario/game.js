/* ---------------------------------------------------------------------------
   Leon Cart - the loop.

   One circuit, one lobby, three laps. This file owns the renderer, the race
   state machine, the camera, the HUD and the input; the track, the karts, the
   items, the computer drivers and the network each live next door.

   The race runs on the clock the server keeps when somebody else is connected,
   and on its own clock when nobody is. Either way the phases are the same:
   waiting, the lights, the race, the results, and round again. Turn up mid-race
   and you watch this one from the grid and start the next.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { buildTrack } from './track.js?v=12';
import { makeKart, stepKart, apply, bump, spinOut, topSpeed, RACERS, TUNE } from './kart.js?v=12';
import { ITEMS, rollItem, rollCount, makeItemWorld, lapProg } from './items.js?v=12';
import { makeBrain, driveBrain } from './ai.js?v=12';
import { initFx, spark, puff, blast, coinPop, stepFx } from './fx.js?v=12';
import * as snd from './audio.js?v=12';

const el = id => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const LAPS = 3;
const CPN = 8;
const GRID = 8;                       // how big a field the circuit is set up for

/* ------------------------------------------------------------------ renderer */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
    uniforms: { top: { value: new THREE.Color(0x2f8fe0) }, bot: { value: new THREE.Color(0xbfe8ff) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top, bot; varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float y = clamp(vP.y, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(y, 0.7));
        if (vP.y > 0.04) {
          vec2 uv = vP.xz / max(vP.y, 0.08) * 0.55;
          float f = n(uv) * 0.6 + n(uv * 2.3) * 0.3 + n(uv * 5.1) * 0.1;
          float cloud = smoothstep(0.56, 0.78, f) * smoothstep(0.04, 0.3, vP.y);
          c = mix(c, vec3(1.0), cloud * 0.9);
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
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x5f9a4a, 0.85));
scene.add(new THREE.AmbientLight(0xffffff, 0.28));

/* ------------------------------------------------------------------- state -- */
let track = null, items = null;
let phase = 'title';                  // title | count | race | results
let phaseT = 0;
let me = null;                        // the player's kart
let karts = [];                       // everything on the grid, in no order
let brains = [];                      // the computer drivers
let spectating = false;
let raceTime = 0, results = [], notified = 0;
let net = null, myName = 'Player', myCast = 0;
let started = false, paused = false, chatting = false;
// a test freezes the loop and runs the world by hand; that is not the same as
// the pause menu, which also takes the controls away
let frozen = false;
let soloRound = 0, autoBrain = null;

try {
  myName = (localStorage.getItem('mkName') || '').slice(0, 12);
  myCast = clamp(+(localStorage.getItem('mkCast') || 0), 0, RACERS.length - 1);
} catch (e) {}

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
  if (paused) return;                       // the menu has the keyboard while it is up
  if (hit('chat', k) && started) { openChat(); e.preventDefault(); }
  if (hit('item', k) && started) useItem(me);
  if (hit('go', k) && started && phase === 'wait' && net && net.alive) net.go();
  if (hit('view', k) && started) { camMode = (camMode + 1) % CAM.length; notice(CAM[camMode].name + ' view'); }
  if (hit('mute', k) && started) { snd.mute(!snd.muted_()); notice(snd.muted_() ? 'Sound off' : 'Sound on'); }
  if (bound(k)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
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

/* --------------------------------------------------------------- the field -- */
// how much more top end the computer drivers get than you do
const BOT_TOP = 1.68;
// how long the results stand before the next race, matching the lobby server
const RESULTS = 10;

function addKart(racer, opts) {
  const k = makeKart(racer);
  k.id = opts.id;
  k.name = opts.name || racer.name;
  k.bot = !!opts.bot;
  k.remote = !!opts.remote;
  scene.add(k.group);
  karts.push(k);
  return k;
}

function clearField() {
  for (const k of karts) scene.remove(k.group);
  karts = [];
  brains = [];
  if (items) items.clear();
}

function placeOnGrid() {
  // the running order of the last race sets the grid for the next one
  karts.forEach((k, n) => {
    const slot = track.gridSlot(n);
    k.pos.copy(slot.pos);
    k.yaw = slot.yaw;
    k.speed = 0; k.drift = 0; k.driftT = 0; k.slide = 0; k.hop = 0; k.hopV = 0;
    k.boost = 0; k.star = 0; k.slow = 0; k.spin = 0; k.coins = 0;
    k.lap = 1; k.cpi = 0; k.prog = 0; k.finished = 0; k.time = 0;
    k.item = null; k.itemN = 0; k.roulette = 0; k.queue = [];
    k.hint = null;
    const pr = track.project(k.pos.x, k.pos.z, null);
    k.hint = pr.i;
    k.pos.y = pr.y;
    apply(k);
  });
  for (const b of track.itemBoxes) b.taken = 0;
  for (const c of track.coins) c.taken = 0;
}

/* start a round. `field` is either null (solo, filled with computer drivers) or
   the list of humans the server says are racing this round. */
function startRound(field, seed, asPhase) {
  clearField();
  results = [];
  raceTime = 0; notified = 0;
  const grid = [];
  if (field && field.length) {
    for (const p of field) {
      grid.push(addKart(RACERS[clamp(p.cast | 0, 0, RACERS.length - 1)], {
        id: p.id, name: p.name, remote: p.id !== (net && net.id),
      }));
    }
    me = karts.find(k => k.id === (net && net.id)) || null;
    if (!me) spectating = true;
  } else {
    me = addKart(RACERS[myCast], { id: 'me', name: myName || 'You' });
  }
  // Fill the grid with computer drivers, but only when you are racing on your
  // own. A lobby with one person in it is still a lobby: the next person to turn
  // up should find a grid of people rather than a field of robots.
  if (!field || !field.length) {
    let s = (seed | 0) || 1234;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const pool = RACERS.filter(r => !(me && me.who === r));
    for (let n = karts.length; n < GRID; n++) {
      const r = pool[(n - 1 + pool.length) % pool.length];
      const k = addKart(r, { id: 'bot' + n, name: r.name, bot: true });
      k.topMul = BOT_TOP;
      brains.push(makeBrain(k, 0.52 + rnd() * 0.42, 99 + n * 17));
    }
  }
  placeOnGrid();
  snapCamera();
  spectating = !me;
  const lobby = asPhase === 'wait';
  phase = lobby ? 'wait' : 'count';
  phaseT = lobby ? 0 : 4.2;
  el('watch').classList.toggle('on', spectating && !lobby);
  el('results').classList.remove('on');
  el('hud').classList.add('on');
  hudItem();
  lobbyShow(lobby);
  say(lobby ? 'In the lobby. Drive about, and press ' + keyName(bind.go[0]) + ' when everybody is here.'
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
      if (k.lap > LAPS) finishKart(k);
      else if (k === me) {
        snd.lapChime();
        notice(k.lap === LAPS ? 'Final lap' : 'Lap ' + k.lap);
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
    notice(ord(results.length) + '!');
    snd.fanfare(results.length <= 3);
    showResults(false);
  }
  if (k === me && net) net.finish(raceTime, results.length);
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

function pickupBox(k, b) {
  // one roulette at a time, but it can land behind whatever you already have
  if (k.roulette > 0 || heldCount(k) >= SLOTS) return;
  b.taken = 6;
  k.roulette = 1.05;
  k.rollTo = rollItem(k.place, karts.length);
  k.rollN = rollCount(k.rollTo, k.place, karts.length);
  if (k === me) { el('slot').classList.add('spin'); el('slot').classList.remove('empty'); }
}

function useItem(k) {
  if (!k || !k.item || k.finished || phase !== 'race') return;
  const id = k.item;
  const def = ITEMS[id];
  if (def.self) {
    if (id === 'star') { k.star = 6.5; k.boost = Math.max(k.boost, 0.4); if (k === me) notice('Star!'); }
    if (id === 'surge') {
      for (const o of karts) {
        if (o === k || o.place >= k.place || o.star > 0) continue;
        o.slow = 3; o.speed *= 0.6; o.coins = Math.max(0, o.coins - 2);
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
  k.itemN--;
  if (k.itemN <= 0) {
    const next = k.queue.shift();
    if (next) { k.item = next.id; k.itemN = next.n; }
    else { k.item = null; k.itemN = 0; }
  }
  if (k === me) hudItem();
}

/* --------------------------------------------------------------- the world -- */
function stepWorld(dt) {
  const live = order();
  const leader = live[0] ? lapProg(live[0], track) : 0;

  // the computer drivers, and the autopilot when a test is driving
  if (autoBrain) {
    autoBrain.hazards = items.hazards;
    autoBrain.input = phase === 'race' ? driveBrain(autoBrain, track, dt, karts, leader, useItem)
                                       : { gas: 0, brake: 0, steer: 0, hop: false };
  }
  for (const b of brains) {
    b.hazards = items.hazards;
    const inp = driveBrain(b, track, dt, karts, leader, useItem);
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
    const pr = stepKart(k, inp, track, dt);
    if (phase === 'race') lapLogic(k, pr);

    // the tarmac furniture, which only counts once the race is on
    if (phase === 'race') for (const b of track.itemBoxes) {
      if (b.taken > 0) continue;
      if (Math.hypot(b.pos.x - k.pos.x, b.pos.z - k.pos.z) > 1.7) continue;
      pickupBox(k, b);
      puff(b.pos.clone(), 0xffd233);
      if (k === me) snd.tick();
    }
    if (phase === 'race') for (const c of track.coins) {
      if (c.taken > 0) continue;
      if (Math.hypot(c.pos.x - k.pos.x, c.pos.z - k.pos.z) > 1.5) continue;
      c.taken = 8;
      k.coins = Math.min(10, k.coins + 1);
      if (k === me) { coinPop(c.pos.clone()); snd.coin(); }
    }
    for (const p of track.boostPads) {
      if (Math.hypot(p.pos.x - k.pos.x, p.pos.z - k.pos.z) > p.w + 2) continue;
      if (k === me && k.boost <= 0.2) snd.boost();
      k.boost = Math.max(k.boost, 0.85);
    }

    // the lip of a ramp throws you: the road has already carried you up it, so
    // all this does is decide how far the rest of the climb takes you
    for (const r of track.ramps) {
      if (k.hop > 0.02 || k.speed < 10) continue;
      if (Math.hypot(r.pos.x - k.pos.x, r.pos.z - k.pos.z) > 5) continue;
      k.hopV = Math.max(k.hopV, 4.2 + k.speed * 0.2);
      k.drift = 0; k.driftT = 0;
      if (k === me) snd.land();
    }

    // the roulette landing
    if (k.roulette > 0) {
      k.roulette -= dt;
      if (k.roulette <= 0) {
        if (k.item) k.queue.push({ id: k.rollTo, n: k.rollN });
        else { k.item = k.rollTo; k.itemN = k.rollN; }
        if (k === me) { el('slot').classList.remove('spin'); el('slot').classList.add('land'); setTimeout(() => el('slot').classList.remove('land'), 300); hudItem(); snd.land(); }
      }
    }
    // the drift sparks, and the boost trail
    if (k.drift !== 0 && k.speed > 8 && Math.random() < 0.6) {
      const hot = k.driftT > 1.45;
      const back = k.pos.clone().setY(k.pos.y + 0.25);
      back.x += Math.sin(k.yaw) * 1.1; back.z += Math.cos(k.yaw) * 1.1;
      spark(back, k.driftT > 0.75 ? (hot ? 0xffd233 : 0x8fd3ff) : 0xdfe6ef, 1.2);
    }
    if ((k.boost > 0 || k.star > 0) && Math.random() < 0.7) {
      const back = k.pos.clone().setY(k.pos.y + 0.3);
      back.x += Math.sin(k.yaw) * 1.3; back.z += Math.cos(k.yaw) * 1.3;
      spark(back, k.star > 0 ? 0xffd233 : 0xff8a1f, 1.5);
    }
    if (k.wallHit) { k.wallHit = 0; puff(k.pos.clone().setY(k.pos.y + 0.6), 0xfff6e2); if (k === me) snd.bump(); }
  }

  // karts touching karts
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      if (a.remote && b.remote) continue;
      if (bump(a, b)) {
        // a star ploughs straight through anybody else
        if (a.star > 0 && b.star <= 0 && !b.remote) spinOut(b, false);
        if (b.star > 0 && a.star <= 0 && !a.remote) spinOut(a, false);
      }
    }
  }

  items.step(dt, karts, (k, kind, by) => {
    if (k === me) { notice('Hit!'); snd.spin(); }
    if (kind === 'bomb' && Math.hypot(k.pos.x - (me ? me.pos.x : 0), k.pos.z - (me ? me.pos.z : 0)) < 22) snd.bang();
    // my shell, their kart: their browser has to be told, it owns that kart
    if (k.remote && me && by === me.id && net) net.hitThem(k.id, kind);
  });

  // the boxes and coins come back
  for (const b of track.itemBoxes) if (b.taken > 0) b.taken -= dt;
  for (const c of track.coins) if (c.taken > 0) c.taken -= dt;
  dressTrack();

  for (const k of karts) apply(k);
}

/* the item boxes spin and bob, and hide for a moment after being taken */
let dressT = 0;
function dressTrack() {
  dressT += 0.016;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  track.itemBoxes.forEach((b, i) => {
    const on = b.taken <= 0;
    e.set(dressT * 0.8 + i, dressT * 1.3 + i, 0);
    q.setFromEuler(e);
    s.setScalar(on ? 1 : 0.001);
    p.set(b.pos.x, b.pos.y + Math.sin(dressT * 2 + i) * 0.16, b.pos.z);
    m.compose(p, q, s);
    track.boxMesh.setMatrixAt(i, m);
  });
  track.boxMesh.instanceMatrix.needsUpdate = true;
  track.coins.forEach((c, i) => {
    const on = c.taken <= 0;
    e.set(0, dressT * 3 + i, 0);
    q.setFromEuler(e);
    s.setScalar(on ? 1 : 0.001);
    p.set(c.pos.x, c.pos.y + Math.sin(dressT * 3 + i) * 0.12, c.pos.z);
    m.compose(p, q, s);
    track.coinMesh.setMatrixAt(i, m);
  });
  track.coinMesh.instanceMatrix.needsUpdate = true;
}

/* -------------------------------------------------------------- the camera -- */
let camMode = 0, camHidden = null;
const camPos = new THREE.Vector3(), camAim = new THREE.Vector3();
function snapCamera() {
  const watch = me || karts[0];
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
  const watch = spectating ? (order()[0] || me) : me;
  if (!watch) return;
  const c = CAM[camMode];
  const back = down('look') ? -1 : 1;
  // sit behind where the kart is going, not where it is pointing, so a drift
  // reads as the kart cocked across a view that still follows the road
  const yaw = watch.yaw + watch.slide * 0.35;
  const want = new THREE.Vector3(
    watch.pos.x + Math.sin(yaw) * c.d * back,
    watch.pos.y + c.h + watch.hop * 0.4,
    watch.pos.z + Math.cos(yaw) * c.d * back
  );
  const look = new THREE.Vector3(watch.pos.x, watch.pos.y + 1.25, watch.pos.z);
  if (c.aim) {
    look.set(watch.pos.x - Math.sin(yaw) * c.aim * back, watch.pos.y + 1.1,
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
  const fov = c.fov + (watch.boost > 0 ? 6 : 0) + (watch.star > 0 ? 3 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-6 * dt)); camera.updateProjectionMatrix(); }
  // keep the sun's shadow box on the action
  sun.position.set(watch.pos.x + 120, 190, watch.pos.z + 80);
  sun.target.position.set(watch.pos.x, 0, watch.pos.z);
}

/* ----------------------------------------------------------------- the HUD -- */
function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'][(n % 10 > 3 || (n % 100 - n % 10) === 10) ? 0 : n % 10] || 'th';
  return n + s;
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
let noticeT = 0;
function notice(text) {
  el('notice').textContent = text;
  el('notice').classList.add('on');
  noticeT = 1.6;
}
function drawHud(dt) {
  if (noticeT > 0) { noticeT -= dt; if (noticeT <= 0) el('notice').classList.remove('on'); }
  const watch = spectating ? (order()[0] || me) : me;
  if (!watch) return;
  el('lapn').textContent = Math.min(LAPS, watch.lap);
  el('lapof').textContent = '/' + LAPS;
  const pl = watch.place || 1;
  el('placen').textContent = pl;
  el('placesfx').textContent = ord(pl).replace(/^\d+/, '');
  el('place').className = 'p' + Math.min(3, pl);
  el('coinn').textContent = watch.coins;
  el('speedn').textContent = Math.round(Math.abs(watch.speed) * 3.6);
  const ch = el('charge');
  if (watch.drift !== 0) {
    ch.classList.add('on');
    ch.classList.toggle('hot', watch.driftT > 1.45);
    el('chargei').style.width = clamp(watch.driftT / 1.45, 0, 1) * 100 + '%';
  } else ch.classList.remove('on');
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
  el('boardrows').innerHTML = rows;
}

const minic = el('minic'), mg = minic.getContext('2d');
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
  mg.lineWidth = 10; mg.lineJoin = 'round'; mg.strokeStyle = '#17223b';
  mg.beginPath();
  track.outline.forEach((p, i) => { i ? mg.lineTo(X(p[0]), Z(p[1])) : mg.moveTo(X(p[0]), Z(p[1])); });
  mg.closePath(); mg.stroke();
  mg.lineWidth = 6; mg.strokeStyle = '#9aa3b2'; mg.stroke();
  for (const k of karts) {
    mg.beginPath();
    mg.arc(X(k.pos.x), Z(k.pos.z), k === me ? 7 : 5, 0, 7);
    mg.fillStyle = k === me ? '#ffd233' : (k.bot ? '#fff6e2' : '#8fd3ff');
    mg.fill();
    mg.lineWidth = 3; mg.strokeStyle = '#17223b'; mg.stroke();
  }
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
  el('restitle').textContent = final ? 'Race over' : 'You finished ' + ord(me ? me.place : 1);
  el('resrows').innerHTML = live.map(k =>
    '<div class="r' + (k === me ? ' me' : '') + (k.bot ? ' bot' : '') + (k.place === 1 ? ' p1' : '') + '">'
    + '<span class="p">' + k.place + '</span><span>' + esc(k.name) + '</span>'
    + '<span class="t">' + (k.finished ? time(k.time) : '-') + '</span></div>').join('');
  drawCup();
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
  if (net && net.alive) return;
  phaseT -= dt;
  if (phase === 'count') {
    setLights(phaseT);
    if (phaseT <= 0) goRace();
  } else if (phase === 'race') {
    raceTime += dt;
    const done = karts.every(k => k.finished);
    if (done || (results.length && raceTime - results[0].time > 22) || raceTime > 400) endRace();
  } else if (phase === 'results') {
    resCount();
    if (phaseT <= 0) { soloRound++; startRound(null, 4321 + soloRound * 77); }
  }
}
let litWas = -1;
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
  litWas = -1;
  snd.beep(true);
  snd.music(true, 'race');
  const c = el('count');
  c.classList.add('go');
  // the other two go out, the way a real one does
  [...c.querySelectorAll('.lights i')].forEach((i, n) => i.classList.toggle('lit', n === 2));
  setTimeout(() => c.classList.remove('on'), 900);
  // a rocket start for anyone already on the throttle
  if (me && !spectating && down('gas')) { me.boost = 1.1; notice('Rocket start!'); }
  for (const b of brains) if (Math.random() < b.skill * 0.7) b.kart.boost = 0.8;
}
function endRace() {
  phase = 'results';
  phaseT = RESULTS;
  snd.music(false);
  for (const k of karts) if (!k.finished) { k.finished = 1; k.time = raceTime; results.push(k); k.place = results.length; }
  order();
  showResults(true);
  el('board').classList.remove('on');
  el('resfoot').innerHTML = 'Next race in <b>10</b>'; resCount();
}

/* -------------------------------------------------------------- the loop ---- */
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!started) { renderer.render(scene, camera); return; }

  if (!paused && !frozen) {
    stepPhase(dt);
    if (phase === 'race' || phase === 'count' || phase === 'wait') stepWorld(dt);
    else for (const k of karts) apply(k);
    if (net && net.alive) {
      if (phase === 'race') raceTime += dt;
      net.tick(dt);
    }
  }
  stepCamera(dt);
  stepFx(dt, camera);
  stepSound(dt);
  drawHud(dt);
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ sound --- */
function stepSound() {
  if (!snd.isOn()) return;
  const k = spectating ? (order()[0] || me) : me;
  if (!k) return;
  snd.engine(phase === 'race' || phase === 'count', k.speed, topSpeed(k), k.offroad);
  snd.skid(k.drift !== 0 && k.speed > 8);
  snd.musicTick();
}

/* ------------------------------------------------------------------ start --- */
function buildCast() {
  const box = el('cast');
  const input = el('nick');
  input.value = myName;
  input.addEventListener('input', () => {
    myName = input.value.slice(0, 12);
    try { localStorage.setItem('mkName', myName); } catch (e) {}
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') el('online').click(); });
  RACERS.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<i style="background:#' + r.shirt.toString(16).padStart(6, '0') + '"></i>' + r.name;
    b.onclick = () => {
      myCast = i;
      try { localStorage.setItem('mkCast', String(i)); } catch (e) {}
      [...box.children].forEach((c, j) => c.classList.toggle('on', j === i));
      if (net) net.setCast(i);
    };
    box.appendChild(b);
  });
  [...box.children].forEach((c, j) => c.classList.toggle('on', j === myCast));
}

async function start(online) {
  if (started) return;
  const wantLobby = online === undefined ? true : !!online;
  snd.start();                             // the click that got us here is the gesture
  el('load').textContent = 'laying out the circuit…';
  await new Promise(r => setTimeout(r, 20));
  track = buildTrack(scene);
  // the scenery turns up when it turns up; the circuit is drivable without it
  import('./props.js?v=12').then(m => m.buildProps(scene, THREE, track)).catch(() => {});
  initFx(scene);
  items = makeItemWorld(scene, track, { blast });

  el('load').textContent = 'lining up…';
  await new Promise(r => setTimeout(r, 20));

  // the lobby decides the round, when you asked for one
  try {
    if (!wantLobby) throw new Error('solo');
    const mod = await import('./net.js?v=12');
    net = mod.connect({
      scene, THREE, say, esc,
      get name() { return myName; },
      get cast() { return myCast; },
      world: {
        startRound, get karts() { return karts; }, get me() { return me; },
        setPhase(p, t, extra) {
          phase = p; phaseT = t;
          lobbyShow(p === 'wait');
          if (p === 'count') setLights(t);
          if (p === 'race' && !extra) goRace();
          if (p === 'results') endRace();
        },
        setSpectating(v) { spectating = v; el('watch').classList.toggle('on', v); },
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
  if (!net || !net.alive) startRound(null, 4321);
  el('hud').classList.add('on');
}

buildCast();
el('solo').addEventListener('click', () => start(false));
el('online').addEventListener('click', () => start(true));
frame();

/* a handle, so a test can drive the whole thing without a keyboard */
/* ------------------------------------------------------------ the lobby ----- */
// The waiting room: everyone drives about on the same circuit with nothing being
// counted, until somebody calls the race on.
function lobbyShow(on) {
  snd.music(on, 'lobby');
  el('lobby').classList.toggle('on', on);
  el('board').classList.toggle('on', !on);
  el('hud').classList.toggle('lobby', on);
  el('lobbykey').textContent = keyName(bind.go[0] || 'k');
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
el('tocontrols').addEventListener('click', () => menuPage('keys'));
// back to the title card, which is a fresh page rather than an unpicking of
// everything a race has set up
el('tostart').addEventListener('click', () => { location.href = location.pathname; });
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

window.__mk = {
  get phase() { return phase; },
  get karts() { return karts; },
  get me() { return me; },
  get track() { return track; },
  get items() { return items; },
  get results() { return results; },
  get spectating() { return spectating; },
  get camera() { return camera; },
  get props() { return scene.getObjectByName('props'); },
  get paused() { return paused; },
  get sound() { return snd.musicNow(); },
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
  // a test can freeze the loop and run the world by hand, which makes the
  // countdown and the finish deterministic instead of a race with the renderer
  pause(v) { frozen = !!v; return frozen; },
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
  tp(s, lateral) {
    const a = track.at(((s % track.length) + track.length) % track.length);
    me.pos.copy(a.p).addScaledVector(a.n, (lateral || 0) * a.w);
    me.yaw = Math.atan2(-a.t.x, -a.t.z);
    me.hint = null;
    const pr = track.project(me.pos.x, me.pos.z, null);
    me.hint = pr.i; me.pos.y = pr.y; me.prog = pr.s;
  },
  stats() {
    return {
      phase, spectating, laps: LAPS, lap: me ? me.lap : 0, place: me ? me.place : 0,
      speed: me ? +me.speed.toFixed(2) : 0, coins: me ? me.coins : 0,
      item: me ? me.item : null, itemN: me ? me.itemN : 0,
      queued: me ? me.queue.length : 0,
      karts: karts.length, bots: brains.length, time: +raceTime.toFixed(2),
      finished: me ? !!me.finished : false, results: results.length,
      trackLen: track ? Math.round(track.length) : 0,
    };
  },
};
