// Round 6 (perf agent P): the graphics tier put to work, so the game runs on a Chromebook and any weak device.
// quality.js says what the tier is; this applies it: the resolution's range, shadows, clouds, the sky's reflection,
// how far the camera draws (with fog over the edge), the terrain tiles' detail and cache, and it hands the tier to
// the modules that read it (traffic, people, parked cars, props, trees, buildings). It also makes the Graphics
// section of the settings panel, an optional frame-rate counter, and keeps the page alive when the graphics card
// drops the drawing context (a Chromebook short of memory does that rather than slowing down).
import * as THREE from 'three';
import { quality } from './quality.js?v=52';
import { settings } from './settings.js?v=52';
import { bakedUniforms } from './baked.js?v=52';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const NAMES = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };

export function setupPerf(G) {
  const R = G.renderer, sky = G.sky, scene = G.scene, camera = G.camera, P = () => quality.p;
  G.settings = settings;
  const perf = G.perf = { quality, lost: 0, restored: 0 };

  // ---- texture sizes: what the models bring is made smaller as it loads (cars, people, signs, tiles), so the low tier
  // holds a quarter of the pictures in graphics memory (a car's and a person's 1024 px pictures at 512) ----
  capTextures(R, P);
  // ---- the mesh decoders: each loader (cars, people, a tileset) starts up to four workers, each with its own decoder
  // and its memory, which stays; one each on the low tier, two on medium ----
  try {
    const DP = DRACOLoader.prototype, gw = DP._getWorker;
    if (gw && !DP._perfLimit) {
      DP._perfLimit = true;
      DP._getWorker = function (...a) { const n = quality.low ? 1 : quality.medium ? 2 : 4; if (this.workerLimit > n && this.workerPool.length <= n) this.workerLimit = n; return gw.apply(this, a); };
    }
  } catch (e) {}

  // ---- shadows: decided at boot and at each drop (switching while driving would build every shader again) ----
  const shadowsNow = () => !!P().shadows;
  perf.shadowsOn = R.shadowMap.enabled;
  function applyShadows() {
    const on = shadowsNow();
    if (R.shadowMap.enabled !== on) { R.shadowMap.enabled = on; R.shadowMap.needsUpdate = true; }
    if (sky && sky.sun) {
      sky.sun.castShadow = on;
      const n = P().shadowSize || 2048;
      if (on && sky.sun.shadow.mapSize.x !== n) {
        sky.sun.shadow.mapSize.set(n, n);
        if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; }
      }
    }
    perf.shadowsOn = on;
  }
  // ---- what can change at any moment ----
  const FAR0 = camera.far, SKY0 = sky && sky.mesh ? sky.mesh.scale.x : 150000;
  function applyLive() {
    const p = P();
    // the camera's reach, and the sky box inside it (the sky's shader only reads directions)
    const far = Math.min(FAR0, p.cameraFar || FAR0);
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    if (sky && sky.mesh) sky.mesh.scale.setScalar(Math.min(SKY0, far * 0.55));
    if (sky && sky.clouds) sky.clouds.visible = p.clouds !== false;
    // the fine grain laid over the satellite ground near the camera (three more picture reads a pixel): not on low
    if (bakedUniforms.uDetailOn && bakedUniforms.uDetail && bakedUniforms.uDetail.value) bakedUniforms.uDetailOn.value = quality.low ? 0 : 1;
    // a smaller shadow map when it is on and the tier wants one (a render target: no shader is built)
    if (sky && sky.sun && sky.sun.castShadow && R.shadowMap.enabled) {
      const n = p.shadowSize || 2048;
      if (sky.sun.shadow.mapSize.x !== n) { sky.sun.shadow.mapSize.set(n, n); if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; } }
    }
    // the terrain tiles: coarser and a smaller cache on the low tier
    applyTiles();
    // fewer pedestrians from now on (peds.js reads its own max when it spawns)
    try { const PD = G.drive && G.drive.peds; if (PD && p.peds !== undefined && !/[?&]peds=/.test(location.search)) PD.max = Math.min(34, p.peds); } catch (e) {}
    // the props fade out sooner (props.js setReach: a share of their fade distances)
    try { const PR = G.drive && G.drive.mods && G.drive.mods.props; if (PR && PR.setReach && perf.reach !== p.propReach) { PR.setReach(p.propReach ?? 1); perf.reach = p.propReach; } } catch (e) {}
    capTextures(R, P);
  }
  function applyTiles() {
    const t = G.world && G.world.tiles;
    if (!t) return;
    const p = P(), google = G.world.mode === 'google';
    if (!google && !/[?&]err=/.test(location.search)) t.errorTarget = p.tilesError ?? 2;
    if (t.lruCache && p.tilesBytes) {
      const gb = 2 ** 30, max = p.tilesBytes * (google ? 1.75 : 1);
      if (!quality.high || google) { t.lruCache.maxBytesSize = max * gb; t.lruCache.minBytesSize = max * 0.7 * gb; }
      if (quality.low) { t.lruCache.minSize = Math.min(t.lruCache.minSize, 600); t.lruCache.maxSize = Math.min(t.lruCache.maxSize, 900); }
    }
  }
  perf.applyTiles = applyTiles;
  applyShadows(); applyLive();
  // the world's tiles are made at each start: tuned straight after
  if (G.world && G.world.start && !G.world._perfWrapped) {
    G.world._perfWrapped = true;
    const start = G.world.start.bind(G.world);
    G.world.start = async (...a) => { const r = await start(...a); try { applyTiles(); } catch (e) { console.warn('perf tiles', e); } return r; };
  }
  // a drop: the shadows switched now, before the scene's shaders are built behind the loading card
  const D = G.drive;
  // the drive's modules (props.js) come in later: the props' reach set once they are there
  if (D && D.loadMods && !D._perfMods) {
    D._perfMods = true;
    const lm = D.loadMods.bind(D);
    D.loadMods = async (...a) => { const r = await lm(...a); try { perf.reach = undefined; applyLive(); } catch (e) {} return r; };
  }
  // a car's lamp states (brake, reverse, signals, headlights: each a material of its own, cars.js lampMaterial) built
  // in the background as soon as the car is in: the first press of the brake built the brake lamps' program inside a
  // draw (0.3 s here, several seconds on a busy graphics card)
  if (D && D.setCar && !D._perfLamps) {
    D._perfLamps = true;
    const sc = D.setCar.bind(D);
    D.setCar = async (...a) => { const r = await sc(...a); try { warmLamps(D.car && D.car.rig, R, camera, scene); } catch (e) { console.warn('lamp warm-up', e); } return r; };
  }
  if (D && D.start && !D._perfWrapped) {
    D._perfWrapped = true;
    const start = D.start.bind(D);
    D.start = (...a) => { try { applyShadows(); applyLive(); } catch (e) { console.warn('perf drop', e); } return start(...a); };
  }
  quality.on((q, before) => {
    applyLive();
    if (G.drive && G.drive.hud && !perf.quietChange) G.drive.hud.flash('Graphics: ' + NAMES[q.tier]);
  });

  // ---- fog over the edge of what is drawn (the weather may make it thicker, never thinner than this) ----
  perf.frame = () => {
    const f = scene.fog, d = P().fog;
    if (f && d && f.isFogExp2 && f.density < d) f.density = d;
  };

  // ---- the frame-rate counter (Settings: Show frame rate) ----
  const fpsEl = document.createElement('div'); fpsEl.className = 'st-fps'; document.body.appendChild(fpsEl);
  let fpsOn = false; try { fpsOn = localStorage.getItem('car_fps') === '1' || /[?&]fps/.test(location.search); } catch (e) {}
  let fpsN = 0, fpsT = performance.now(), fpsWorst = 0, fpsLast = performance.now();
  perf.tick = now => {
    if (!fpsOn) return;
    const dt = now - fpsLast; fpsLast = now; fpsN++; if (dt > fpsWorst) fpsWorst = dt;
    if (now - fpsT >= 500) {
      const fps = fpsN * 1000 / (now - fpsT), pr = G.pixelRatio ? G.pixelRatio() : R.getPixelRatio();
      fpsEl.textContent = Math.round(fps) + ' fps · worst ' + Math.round(fpsWorst) + ' ms · ' + NAMES[quality.tier] + ' · ' + pr.toFixed(2) + 'x';
      fpsN = 0; fpsT = now; fpsWorst = 0;
    }
  };
  const showFps = on => { fpsOn = on; fpsEl.classList.toggle('on', on); try { localStorage.setItem('car_fps', on ? '1' : '0'); } catch (e) {} };
  showFps(fpsOn);

  // ---- the Graphics section of the settings panel ----
  settings.addSection('Graphics', (el, S) => {
    const seg = S.segmented(el, [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], quality.setting, v => {
      quality.set(v); refresh();
    }, 'Graphics quality');
    const line = S.text(el, '');
    const later = S.text(el, '');
    S.toggleRow(el, 'Show frame rate', fpsOn, showFps);
    function refresh() {
      seg.set(quality.forced ? quality.forced : quality.setting);
      const auto = quality.setting === 'auto' && !quality.forced;
      const why = quality.why.length ? ': ' + quality.why.join(', ') : '';
      line.innerHTML = quality.forced ? 'Set to <b>' + NAMES[quality.tier] + '</b> for this visit by the address.'
        : auto ? 'Auto picked <b>' + NAMES[quality.tier] + '</b>' + (why ? why.replace(/^: /, ' for this device (') + ')' : ' for this device') + '.'
        : 'Low is for Chromebooks, phones and older computers. High looks best on a fast computer.';
      // (round 6b) graphics drawn by the processor: say why the picture is so small
      if (quality.software && quality.low) line.innerHTML += ' This browser is drawing the graphics without the graphics chip, so Low draws a much smaller picture. Turning on hardware acceleration in the browser makes it look and run far better.';
      const notes = [];
      if (quality.p.shadows !== perf.shadowsOn) notes.push('shadows change at your next drop');
      if (!!quality.p.antialias !== !!quality.bootP().antialias) notes.push('smoother edges change when the page is next loaded');
      later.textContent = notes.length ? 'Some of this waits: ' + notes.join(', and ') + '.' : 'Low draws fewer cars, people and far-away things, with fog in the distance, so it runs smoothly on a Chromebook.';
    }
    return refresh;
  }, { order: 10, id: 'graphics' });

  // ---- the drawing context lost (out of graphics memory) and given back ----
  const cv = R.domElement;
  let box = null;
  const msg = (html, buttons) => {
    if (!box) { box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(32,33,36,.72);color:#e8eaed;font:15px/22px Roboto,system-ui,sans-serif;text-align:center;padding:24px;pointer-events:auto'; document.body.appendChild(box); }
    box.innerHTML = '<div style="max-width:420px">' + html + '</div>';
    box.style.display = 'flex';
    for (const [text, fn] of buttons || []) { const b = document.createElement('button'); b.textContent = text; b.style.cssText = 'margin-top:16px;border:0;border-radius:18px;padding:9px 20px;background:#8ab4f8;color:#202124;font:500 14px Roboto,system-ui;cursor:pointer'; b.onclick = fn; box.firstChild.appendChild(document.createElement('br')); box.firstChild.appendChild(b); }
  };
  const reloadHere = () => {
    try {
      const Dv = G.drive, u = new URL(location.href);
      if (Dv && Dv.active && Dv.car && G.toLatLon) {
        const F = Dv.onfoot && Dv.onfoot.active ? Dv.onfoot : null, o = F ? F.focus() : Dv.car.vehicle.origin(), g = G.toLatLon(o);
        u.searchParams.set('lat', g.lat.toFixed(6)); u.searchParams.set('lon', g.lon.toFixed(6)); u.searchParams.set('h', String(Math.round(F ? F.heading() : Dv.car.vehicle.heading)));
      }
      location.href = u.toString();
    } catch (e) { location.reload(); }
  };
  perf.reloadHere = reloadHere;
  let lostAt = 0, waitT = 0;
  cv.addEventListener('webglcontextlost', e => {
    e.preventDefault(); // (so the browser may give it back)
    perf.lost++; lostAt = performance.now();
    G.paused = true;
    // the next visit starts a tier lower; this one too, once the context is back
    perf.quietChange = true; try { if (quality.setting === 'auto') quality.stepDown('the graphics ran out of memory'); else if (!quality.low) quality.set('low'); } finally { perf.quietChange = false; }
    msg('The graphics card ran short of memory and stopped drawing.<br>Getting it back with lighter graphics...');
    clearTimeout(waitT);
    waitT = setTimeout(() => msg('The graphics did not come back by themselves.', [['Reload here', reloadHere]]), 6000);
  }, false);
  cv.addEventListener('webglcontextrestored', () => {
    perf.restored++; clearTimeout(waitT);
    // three.js sets itself up again and sends what it needs on the next draws (every shader is built again then)
    try { applyShadows(); applyLive(); } catch (e) {}
    // what lived only on the graphics card is gone: the sky's reflection, the street picture the cars reflect, the
    // road mask over the ground and the roof pictures; made again (the streets round the car are built again)
    try { if (sky && sky.makeEnv) sky.makeEnv(); } catch (e) { console.warn('restore sky', e); }
    try {
      const Dv = G.drive, C = Dv && Dv.mods && Dv.mods.cars, old = Dv && Dv.carEnv;
      if (C && C.makeEnvironment && old) C.makeEnvironment(R).then(t => (G.weather && G.weather.wrapEnv ? G.weather.wrapEnv(t) : t)).then(t => {
        Dv.carEnv = t;
        scene.traverse(o => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.envMap === old) { m.envMap = t; m.needsUpdate = true; } });
      }).catch(e => console.warn('restore car env', e));
      if (Dv && Dv.active && Dv.car && Dv.areaAt && !Dv.loadingArea) { const o = Dv.car.vehicle.origin(); Dv.areaAt = { x: o.x + 1e5, z: o.z }; }
    } catch (e) { console.warn('restore', e); }
    G.paused = !(G.drive && G.drive.active) ? G.paused : false;
    if (box) box.style.display = 'none';
    if (G.drive && G.drive.hud) G.drive.hud.note('The graphics were lost for a moment and are back, with lighter settings.', 7000);
    // a second loss within two minutes: reload at the same place rather than try again
    if (perf.lost > 1 && performance.now() - (perf.lastRestore || -1e9) < 120000) msg('The graphics keep running out of memory here.', [['Reload here', reloadHere]]);
    perf.lastRestore = performance.now();
  }, false);

  // ---- a new reflection for a material already drawn (the walls take the cars' street picture once it is made):
  // its program built in the background on a stand-in first, then swapped in, so the next draw finds it built ----
  const swapping = new WeakMap();
  perf.swapEnv = async (M, env) => {
    if (!M || !env) return;
    // (the low tier keeps the sky's reflection on the walls: no second build of the game's largest shader, which on a
    // weak graphics chip holds the whole graphics process for seconds even when built in the background)
    if (quality.low) return;
    if (M.envMap === env) return;
    swapping.set(M, env);
    // (a mesh that draws with it, for its geometry's attributes: the walls come a cell at a time after a build, so
    // this waits for the first one; set before any was there, the next walls drawn built the program in a draw)
    let mesh = null;
    for (let i = 0; i < 240 && !mesh; i++) {
      scene.traverse(o => { if (!mesh && o.isMesh && o.material === M && o.geometry) mesh = o; });
      if (!mesh) { await new Promise(r => setTimeout(r, 500)); if (swapping.get(M) !== env || M.envMap === env) return; }
    }
    if (mesh && R.compileAsync) {
      const c = M.clone(); c.onBeforeCompile = M.onBeforeCompile; c.customProgramCacheKey = M.customProgramCacheKey; c.userData = M.userData; c.envMap = env;
      const tmp = new THREE.Mesh(mesh.geometry, c); tmp.matrixAutoUpdate = false; tmp.matrixWorld.copy(mesh.matrixWorld);
      tmp.castShadow = mesh.castShadow; tmp.receiveShadow = mesh.receiveShadow;
      // (no swap until it is built: on a busy graphics card the walls' program can take tens of seconds, and swapped
      // before then the next draw waited for it; the walls keep the sky's reflection meanwhile)
      let built = false;
      try { built = await Promise.race([R.compileAsync(tmp, camera, scene).then(() => true), new Promise(r => setTimeout(() => r(false), 180000))]); } catch (e) {}
      if (!built) return;
    } else if (!mesh) return;
    if (swapping.get(M) !== env) return; // (another came meanwhile)
    M.envMap = env; M.needsUpdate = true;
  };

  // the same for everything under an object (the player's car, when the street picture comes after the car was
  // made: cars.js setEnvMap then changed every one of its materials at once, each built again inside the next draw)
  perf.envReady = async (root, env) => {
    if (!root || !env || !R.compileAsync) return;
    const g = new THREE.Group(), seen = new Set();
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || o.name === 'contact_shadow') return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !('envMap' in m) || m.envMap === env || seen.has(m)) continue;
        seen.add(m);
        const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; c.userData = m.userData; c.envMap = env;
        let t;
        if (o.isSkinnedMesh && o.skeleton) { t = new THREE.SkinnedMesh(o.geometry, c); t.bind(o.skeleton, o.bindMatrix); }
        else t = new THREE.Mesh(o.geometry, c);
        t.matrixAutoUpdate = false; t.matrixWorld.copy(o.matrixWorld); t.castShadow = o.castShadow; t.receiveShadow = o.receiveShadow;
        g.add(t);
      }
    });
    if (!g.children.length) return;
    try { await Promise.race([R.compileAsync(g, camera, scene), new Promise(r => setTimeout(r, 60000))]); } catch (e) {}
  };

  // ---- (round 6c) steady pacing, a test switch (?pace=1): when the frames cannot keep a steady 45 a second but can
  // keep 30, they are drawn at an even 30 (every second screen refresh); slower than that it lets go (an even 20 or 15
  // measured worse than an uneven 20) ----
  const PACE_Q = (location.search.match(/[?&]pace=(\d)/) || [])[1];
  let paceMs = 0, lastDraw = 0, paceT = 0, ivs = [], works = [], t0w = 0, paceWait = 0;
  // (off unless asked for: measured on Low at 4x CPU throttle it drew 32 and 29 frames a second against 36 and 34 without,
  // with no steadier spacing between them, so it stays a test switch)
  const paceOn = () => PACE_Q === '1';
  perf.pace = () => paceMs;
  perf.skip = now => {
    if (!paceOn() || !(G.drive && G.drive.active)) { paceMs = 0; return false; }
    if (paceMs && lastDraw && now - lastDraw < paceMs - 5) return true;
    if (lastDraw) { ivs.push(now - lastDraw); if (ivs.length > 90) ivs.shift(); }
    lastDraw = now; t0w = performance.now();
    if (now - paceT > 2000 && ivs.length >= 30) {
      paceT = now;
      const srt = a => a.slice().sort((x, y) => x - y), q = (a, k) => a[Math.min(a.length - 1, Math.floor(a.length * k))];
      const p80 = q(srt(ivs), 0.8), w80 = works.length ? q(srt(works), 0.8) : 0;
      // the slowest of the usual frames, rounded up to whole refreshes; down again when the work itself would fit
      let want = paceMs;
      if (!paceMs) want = p80 > 22 && p80 <= 38 && now > paceWait ? 33.3 : 0;
      else if (p80 > paceMs + 12) { want = 0; paceWait = now + 10000; } // (and not again for 10 s)
      else if (w80 < paceMs * 0.45) want = 0;
      if (want !== paceMs) { paceMs = want; ivs = []; works = []; }
    }
    return false;
  };
  perf.done = () => { if (!t0w) return; works.push(performance.now() - t0w); if (works.length > 90) works.shift(); t0w = 0; };

  // ---- a tier down by itself when the lowest resolution is still too slow (main.js autoScale) ----
  perf.tooSlow = (fps) => {
    const ok = quality.stepDown(Math.round(fps) + ' fps');
    return ok;
  };

  // the gear button on the drive's screen
  try { if (G.drive && G.drive.hud) settings.attachHud(G.drive.hud.el); } catch (e) { console.warn('settings button', e); }
  return perf;
}

// Every picture loaded through three's ImageBitmapLoader (what GLTFLoader uses in Chrome: the cars, the people, the
// props, a tileset's tiles) larger than the tier's texMax is scaled down as it arrives (off the page's thread, by the
// browser's own createImageBitmap) and the big one let go; and on the low tier three's own upload limit
// (maxTextureSize) is 1024, so any other picture (a canvas, an image) larger than that is scaled down when it is sent.
let capHooked = false, capNow = 0, capTiles = 0;
function capTextures(R, P) {
  const p = P(), cap = p.texMax && p.texMax < 4096 ? p.texMax : 0;
  capNow = cap; capTiles = p.tileTexMax && p.tileTexMax < 4096 ? p.tileTexMax : 0;
  try {
    if (R.capabilities) {
      if (R.capabilities._maxTex0 === undefined) R.capabilities._maxTex0 = R.capabilities.maxTextureSize;
      // (low only: the street names' 2048 picture and the road mask over the ground go to 1024)
      R.capabilities.maxTextureSize = quality.low ? Math.min(R.capabilities._maxTex0, 1024) : R.capabilities._maxTex0;
    }
  } catch (e) {}
  if (capHooked || !(cap || capTiles) || typeof createImageBitmap === 'undefined') return;
  capHooked = true;
  const L = THREE.ImageBitmapLoader && THREE.ImageBitmapLoader.prototype, load = L && L.load;
  if (!load) return;
  L.load = function (url, onLoad, onProgress, onError) {
    // (the game's own models load through three's default manager; a tileset's tiles through the tiles' own, which
    // keeps their pictures sharper on the medium tier: tileTexMax)
    // (round 6b: people's pictures at 256 on the low tier, through their own manager, people.js)
    const c = this.manager && this.manager.texCapKind === 'people' ? (quality.low ? 256 : capNow) : this.manager === THREE.DefaultLoadingManager ? capNow : capTiles;
    if (!c || !onLoad) return load.call(this, url, onLoad, onProgress, onError);
    return load.call(this, url, bmp => {
      const w = bmp && bmp.width, h = bmp && bmp.height;
      if (!w || !h || (w <= c && h <= c)) { onLoad(bmp); return; }
      const k = c / Math.max(w, h);
      createImageBitmap(bmp, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'medium', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
        .then(small => { if (!THREE.Cache.enabled) { try { bmp.close(); } catch (e) {} } onLoad(small); }, () => onLoad(bmp));
    }, onProgress, onError);
  };
}

// every lamp state of a car made and its shaders built in the background (see setupPerf)
const LAMPS_DONE = new WeakSet();
async function warmLamps(rig, R, camera, scene) {
  if (!rig || LAMPS_DONE.has(rig) || !Array.isArray(rig._lamps) || typeof rig._setLamps !== 'function' || !rig.state || !R.compileAsync) return;
  LAMPS_DONE.add(rig);
  const s = rig.state, save = { ...s }, blink = rig._blinkOn;
  const pairs = new Map(); // material -> a mesh it goes on
  const combos = [{ headlights: false, brake: 0, reverse: false, signal: 0 }, { headlights: true }, { brake: 1 }, { headlights: true, brake: 1 }, { reverse: true }, { signal: 2 }];
  try {
    for (const c of combos) {
      Object.assign(s, save, c); rig._blinkOn = true; rig._setLamps(true);
      for (const L of rig._lamps) for (const me of L.meshes || []) for (const m of [].concat(me.material)) if (m && !pairs.has(m)) pairs.set(m, me);
      if (rig._atlasBody) { const m = rig._atlasBody.material; if (m && !pairs.has(m)) pairs.set(m, rig._atlasBody); }
    }
  } finally { Object.assign(s, save); rig._blinkOn = blink; try { rig._setLamps(true); } catch (e) {} }
  // stand-ins with the lamp's own geometry and each state's material, compiled where the car is (its lights, fog,
  // environment), never drawn
  const g = new THREE.Group(); g.visible = true;
  for (const [m, me] of pairs) { const o = new THREE.Mesh(me.geometry, m); o.matrixAutoUpdate = false; o.matrixWorld.copy(me.matrixWorld); g.add(o); }
  try { await Promise.race([R.compileAsync(g, camera, scene), new Promise(r => setTimeout(r, 15000))]); } catch (e) {}
}
