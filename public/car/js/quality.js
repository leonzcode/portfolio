// The graphics tier: 'low' for Chromebooks, phones and other weak devices, 'medium' between, 'high' as the game was
// built (round 6, perf agent P). Every module that costs frames or memory reads it: `import { quality } from
// './quality.js?v=51'` (or window.__car.quality), then quality.low / quality.tier / quality.p (the numbers for the
// tier), and quality.on(fn) to hear a change (fn(quality, before)). The choice is Auto / Low / Medium / High, kept
// in localStorage car_gfx; ?gfx=low|medium|high picks one for a visit without keeping it.
//
// What the tier is decided from (Auto): a Chromebook (CrOS in the user agent), the memory the browser reports
// (navigator.deviceMemory, rounded and capped at 8 by Chrome), the processor threads, the graphics chip's name
// (WebGL's unmasked renderer: Intel HD/UHD, Mali, Adreno, PowerVR, a phone's Apple GPU, software renderers), a touch
// screen on a small screen. A device that is still too slow at its lowest resolution steps down a tier by itself
// (main.js autoScale calls stepDown); that is remembered for three days (car_gfx_learnt), while the choice
// stays Auto.

const KEY = 'car_gfx', LEARNT = 'car_gfx_learnt';
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
};
export const TIERS = ['low', 'medium', 'high'];
const RANK = { low: 0, medium: 1, high: 2 };

// The numbers each tier uses (read as quality.p.<name>). 'high' is the game as it was before round 6.
// Everything changes at once when the tier changes, except: "next drop" waits for the next place loaded (it would build
// every shader again inside a draw while driving), "reload" for the page to be loaded again. Counts (traffic, people,
// parked cars) and the area take effect as the streets round the car are next built.
export const PARAMS = {
  low: {
    antialias: false,      // reload: no multisampled drawing buffer
    prMax: 1,              // the most pixels per screen pixel (also capped by the screen's own)
    prFloor: 0.5,          // the least the automatic resolution goes to
    prStart: 0.85,         // the resolution the page starts at
    shadows: false,        // next drop: no sun shadow map at all
    shadowSize: 1024,      // the sun's shadow map when there is one
    clouds: false,         // the cloud deck (a full screen of noise)
    envSize: 64,           // the sky picture the paint reflects (weather.js reads it once)
    traffic: 4,            // most traffic cars (round 6b: 6, round 6c: 4; each is about eight draws)
    trafficSpacing: 2.2,   // times the normal gap between traffic cars
    trafficModels: 3,      // kinds of traffic and parked car loaded (each is its own pictures and buffers)
    peds: 3,               // most pedestrians (round 6b: 4, round 6c: 3)
    occupants: 1,          // people in a traffic car at most (the driver)
    occupantReach: 18,     // metres from the camera that cars get people at all
    parkedShare: 0.35,     // share of the parked cars kept
    propReach: 0.45,       // times the props' fade distances
    fog: 0.0008,           // the least FogExp2 density (0: the scene's own); hides the edge of what is drawn
    cameraFar: 3500,       // metres the camera draws to
    bldReach: 450,         // metres buildings are wanted round the car (opentiles.js draws real ones to this + 250)
    facadeCheap: true,     // the buildings' walls all drawn the cheap far way (no recesses, glazing bars, grain)
    roofPics: false,       // reload: no satellite pictures on the roofs (their plain colour)
    spareCars: 0,          // cars made ready ahead of a change (and the car left is not kept)
    firstCar: 'fairheaven', // the car a drive starts in (null: the first in cars.js, the Volvo)
    tilesError: 8,         // the terrain tiles' error target (higher is coarser; 2 on high; round 6b: 6, round 6c: 8)
    tilesBytes: 0.09,      // GB the tiles' cache may hold
    overlayLevels: 18,     // reload: finest satellite picture level on the ground
    texMax: 512,           // largest picture side in the game's own models (cars, people, props)
    tileTexMax: 512,       // largest picture side in a 3D tileset's tiles (open city meshes)
    area: 0.8,             // times the streets' area round the car
  },
  medium: {
    antialias: false, prMax: 1.25, prFloor: 0.5, prStart: 1, shadows: true, shadowSize: 1024, clouds: true, envSize: 128,
    traffic: 16, trafficSpacing: 1.4, trafficModels: 6, peds: 18, occupants: 3, occupantReach: 40, parkedShare: 0.7,
    propReach: 0.7, fog: 0, cameraFar: 200000, bldReach: 900, facadeCheap: false, roofPics: true, spareCars: 1, firstCar: null,
    tilesError: 3, tilesBytes: 0.25, overlayLevels: 19, texMax: 512, tileTexMax: 0, area: 1,
  },
  high: {
    antialias: true, prMax: 1.5, prFloor: 0.6, prStart: 1.5, shadows: true, shadowSize: 2048, clouds: true, envSize: 256,
    traffic: 24, trafficSpacing: 1, trafficModels: 0, peds: 34, occupants: 99, occupantReach: 1e9, parkedShare: 1,
    propReach: 1, fog: 0, cameraFar: 200000, bldReach: 1e9, facadeCheap: false, roofPics: true, spareCars: 3, firstCar: null,
    tilesError: 2, tilesBytes: 0.4, overlayLevels: 19, texMax: 4096, tileTexMax: 0, area: 1,
  },
};

// (round 6b) what the low tier changes again when the graphics are drawn by the processor (SwiftShader and the like)
export const SOFTWARE = { prMax: 0.6, prStart: 0.45, prFloor: 0.3, cameraFar: 1600, fog: 0.0016, bldReach: 300, tilesError: 10, traffic: 4, peds: 2, parkedShare: 0.2, propReach: 0.3, area: 0.7 };

// ---- what the device is ----
function gpuName(gl) {
  try {
    const x = gl.getExtension('WEBGL_debug_renderer_info');
    return String((x && gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch (e) { return ''; }
}
const info = {
  ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  mem: typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : null,
  cores: typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : null,
  touch: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
  screen: typeof screen !== 'undefined' ? [screen.width, screen.height] : [0, 0],
  dpr: typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
  gpu: '',
};
// the tier the device's own signs point to, with the reasons (shown in the settings panel)
function decide() {
  const why = [], ua = info.ua;
  let score = 2; // high unless something says otherwise
  const low = r => { why.push(r); score = Math.min(score, 0); };
  const mid = r => { why.push(r); score = Math.min(score, 1); };
  if (/\bCrOS\b/.test(ua)) low('a Chromebook');
  if (info.mem !== null && info.mem <= 4) low(info.mem + ' GB of memory');
  else if (info.mem !== null && info.mem <= 6) mid(info.mem + ' GB of memory');
  if (info.cores !== null && info.cores <= 2) low(info.cores + ' processor threads');
  else if (info.cores !== null && info.cores <= 4) mid(info.cores + ' processor threads');
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (info.touch && Math.min(info.screen[0], info.screen[1]) < 820);
  if (phone) low('a phone or tablet');
  const g = info.gpu;
  if (g) {
    if (/SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i.test(g)) low('graphics drawn by the processor');
    else if (/Mali|Adreno|PowerVR|Apple GPU|Vivante|VideoCore|Immortalis/i.test(g)) low('mobile graphics');
    else if (/Intel/i.test(g) && !/Iris|Arc/i.test(g)) {
      // Intel HD and UHD: low with few threads or little memory (school laptops), medium otherwise
      if ((info.cores !== null && info.cores <= 4) || (info.mem !== null && info.mem <= 4)) low('Intel HD/UHD graphics'); else mid('Intel HD/UHD graphics');
    } else if (/Intel/i.test(g)) mid('Intel Iris graphics');
    else if (/Radeon\(TM\) (Vega )?Graphics|AMD Radeon Graphics|Radeon R[2-7] /i.test(g)) mid('built-in Radeon graphics');
  }
  return { tier: TIERS[score], why };
}

const listeners = new Set();
export const quality = {
  tier: 'high', low: false, medium: false, high: true,
  setting: 'auto',   // what the player chose: auto, low, medium or high
  auto: 'high',      // what Auto works out to now
  detected: 'high',  // what the device's signs point to
  why: [],           // why (words for the settings panel)
  forced: null,      // ?gfx= for this visit
  learnt: null,      // a step down Auto took on an earlier visit
  booted: 'high',    // the tier the page was loaded with (what needs a reload follows this one)
  p: PARAMS.high,
  info,
  TIERS, PARAMS,
  // fn(quality, before) on every change of tier; returns a function that stops listening
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // the player's choice: 'auto', 'low', 'medium' or 'high'
  set(choice) {
    if (!(choice === 'auto' || RANK[choice] !== undefined)) return;
    this.setting = choice; store.set(KEY, choice === 'auto' ? null : choice);
    if (choice !== 'auto') store.set(LEARNT, null); // (a choice made by hand starts Auto afresh next time)
    this.forced = null;
    apply();
  },
  // one tier down by itself (only on Auto); remembered for the next visit
  stepDown(reason) {
    if (this.setting !== 'auto' || this.forced || this.tier === 'low') return false;
    const t = TIERS[RANK[this.tier] - 1];
    this.learnt = t; store.set(LEARNT, t + '|' + Date.now());
    this.why = this.why.concat(['too slow here' + (reason ? ' (' + reason + ')' : '')]);
    apply();
    return true;
  },
  // the graphics chip's name, from any WebGL context (main.js asks before the renderer is made)
  probe(gl) { if (!gl || info.gpu) return; info.gpu = gpuName(gl); recompute(); if (!this.locked) this.booted = this.tier; },
  // main.js once the renderer is made: what needs a reload is fixed from here on
  lock() { this.locked = true; this.booted = this.tier; },
  // the 'reload' parameters the page actually has (antialias)
  bootP() { return PARAMS[this.booted]; },
};

function recompute() {
  const d = decide();
  quality.detected = d.tier; quality.why = d.why;
  let auto = d.tier;
  if (quality.learnt && RANK[quality.learnt] < RANK[auto]) auto = quality.learnt;
  quality.auto = auto;
  const t = quality.forced || (quality.setting === 'auto' ? auto : quality.setting);
  quality.tier = t; quality.low = t === 'low'; quality.medium = t === 'medium'; quality.high = t === 'high';
  quality.p = PARAMS[t];
  // (round 6b, perf P) graphics drawn by the processor (no graphics chip at all, or a blocked one): on the low tier a
  // much smaller picture and a shorter view, since every pixel and every corner is worked out on the processor
  quality.software = /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render/i.test(info.gpu || '');
  if (quality.software && t === 'low') quality.p = Object.assign({}, PARAMS.low, SOFTWARE);
}
function apply() {
  const before = quality.tier;
  recompute();
  if (quality.tier === before) return;
  for (const fn of [...listeners]) { try { fn(quality, before); } catch (e) { console.warn('quality listener', e); } }
}

// start: the saved choice, a learnt step down, ?gfx=
{
  const s = store.get(KEY);
  if (s && RANK[s] !== undefined) quality.setting = s;
  // (a step down Auto took is kept for three days: a computer that was busy once is not held back for good)
  const l = String(store.get(LEARNT) || '').split('|');
  if (l[0] && RANK[l[0]] !== undefined && Date.now() - (+l[1] || 0) < 3 * 86400000) quality.learnt = l[0];
  const f = Q.get('gfx');
  if (f && RANK[f] !== undefined) quality.forced = f;
  recompute();
  quality.booted = quality.tier;
}
if (typeof window !== 'undefined') window.__carQuality = quality; // (for code that has no window.__car yet)
