/* ---------------------------------------------------------------------------
   Leoncraft 2 - start up and run.

   Loads the texture arrays (straight to the GPU, every channel kept), starts
   the workers, finds somewhere good to stand (land, in a pretty biome, near
   water), waits for the ground around it, then runs the game: 20 ticks a
   second for the player, the water and the clock, and a frame drawn between
   ticks as often as the screen allows.

   Controls: WASD, mouse, Space (twice to fly), Shift, Ctrl or double W to
   sprint, left click to break, right click to place, middle click to pick,
   1-9 and the wheel for the hotbar, F1 to hide the HUD, F3 for the details,
   [ and ] to turn the clock, P to stop the sun, F7 for render scale.
--------------------------------------------------------------------------- */
import { B, BLOCKS, HOTBAR, resolveTextures, FLUID } from './blocks.js?v=1';
import { BIOMES, biomeColours } from './biomes.js?v=1';
import { pickBiome } from './worldgen.js?v=1';
import { World } from './world.js?v=1';
import { Fluids } from './fluids.js?v=1';
import { Player } from './player.js?v=1';
import { Hud } from './hud.js?v=1';
import { Renderer } from './render/renderer.js?v=1';
import { SEA, Y0 } from './world-const.js?v=1';
const THREE = window.THREE;

const $ = s => document.querySelector(s);
const status = t => { $('#status').textContent = t; };
const params = new URLSearchParams(location.search);
const SEED = +(params.get('seed') || 20261002);
/* Quality: how far you see and how much every effect works at. F8 cycles
   (and reloads); the render scale also follows the frame rate on its own. */
const PRESETS = {
  low: { rd: 6, shadowRes: 1024, shadowDist: 64, scale: 0.67, vlSteps: 8, cloudSteps: 10, ssrSteps: 12 },
  medium: { rd: 8, shadowRes: 2048, shadowDist: 96, scale: 0.85, vlSteps: 12, cloudSteps: 16, ssrSteps: 20 },
  high: { rd: 10, shadowRes: 2048, shadowDist: 112, scale: 1, vlSteps: 14, cloudSteps: 20, ssrSteps: 28 },
  ultra: { rd: 14, shadowRes: 4096, shadowDist: 160, scale: 1, vlSteps: 20, cloudSteps: 28, ssrSteps: 36 },
};
let QNAME = params.get('q') || (() => { try { return localStorage.getItem('lc2_quality'); } catch (e) { return null; } })() || 'high';
if (!PRESETS[QNAME]) QNAME = 'high';
const QP = PRESETS[QNAME];
const RD = +(params.get('rd') || QP.rd);

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
// a tall strip of 16 x 16 layers, uploaded as a texture array exactly as it is
function arrayTex(img, layers, filter) {
  const t = new THREE.DataArrayTexture(null, 16, 16, layers);
  t.image = { data: img, width: 16, height: 16, depth: layers };
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = filter || THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function pixels(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height).data;
}

async function boot() {
  status('Loading textures…');
  const base = new URL('../textures/', import.meta.url).href;
  // stamped like the code, so a rebuilt texture set always reaches the browser
  const TEX_V = '?v=1';
  const manifest = await (await fetch(base + 'manifest.json' + TEX_V)).json();
  const [alb, nrm, spc, grass, foliage, moon] = await Promise.all(
    ['terrain_albedo.png', 'terrain_normal.png', 'terrain_spec.png', 'colormap_grass.png', 'colormap_foliage.png', 'environment_moon_phases.png'].map(f => loadImg(base + f + TEX_V)));
  resolveTextures(manifest);
  const colours = biomeColours(pixels(grass), pixels(foliage));
  const moonTex = new THREE.Texture(moon);
  moonTex.magFilter = THREE.NearestFilter; moonTex.minFilter = THREE.NearestFilter; moonTex.needsUpdate = true;
  const textures = {
    albedo: arrayTex(alb, manifest.layers, THREE.LinearMipmapLinearFilter),
    normal: arrayTex(nrm, manifest.layers, THREE.LinearMipmapLinearFilter),
    spec: arrayTex(spc, manifest.layers, THREE.LinearMipmapLinearFilter),
    manifest, moon: moonTex,
  };

  status('Starting the renderer…');
  const canvas = $('#c');
  const renderer = new Renderer(canvas, textures, Object.assign({}, QP, { renderDist: RD, scale: +(params.get('scale') || QP.scale) }));
  const fit = () => renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', fit);
  fit();

  const world = new World({
    seed: SEED, renderDist: RD, manifest, colours,
    onMesh: (cx, cz, mesh) => renderer.setColumn(cx, cz, mesh),
    onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
  });
  await world.ready;

  // somewhere good to start: dry land in a green biome, with water in sight
  status('Finding somewhere to stand…');
  const good = ['plains', 'forest', 'birch_forest', 'flower_forest', 'meadow', 'cherry_grove', 'sunflower_plains', 'taiga', 'dark_forest', 'old_growth_birch_forest', 'savanna', 'jungle', 'sparse_jungle'];
  let spawn = null;
  const want = params.get('at') ? params.get('at').split(',').map(Number) : null;
  if (want) spawn = { x: want[0], z: want[1] };
  for (let ring = 0; !spawn && ring < 40; ring++) {
    const tries = [];
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = k / Math.max(1, ring * 6) * Math.PI * 2;
      tries.push([Math.round(Math.cos(a) * ring * 56), Math.round(Math.sin(a) * ring * 56)]);
    }
    const res = await Promise.all(tries.map(([x, z]) => world.ask({ type: 'surface', x, z, withBiome: true })));
    for (let i = 0; i < tries.length && !spawn; i++) {
      const r = res[i];
      if (r.y < SEA + 1 || r.y > SEA + 30) continue;
      const bn = BIOMES[pickBiome(r.biome)].name;
      if (good.indexOf(bn) < 0) continue;
      // water within reach, for the view
      const [x, z] = tries[i];
      const near = await Promise.all([[28, 0], [-28, 0], [0, 28], [0, -28], [20, 20], [-20, -20]].map(([dx, dz]) => world.ask({ type: 'surface', x: x + dx, z: z + dz })));
      if (near.some(n => n.y >= 0 && n.y < SEA) || ring > 25) spawn = { x, z };
    }
  }
  if (!spawn) spawn = { x: 0, z: 0 };

  const player = new Player(world);
  const fluids = new Fluids(world, (x, y, z, kind) => {
    if (kind === 1 && Math.random() < 0.3) renderer.inter.splash(x + 0.5, z + 0.5, 0.35, 1.5);
  });
  const hud = new Hud($('#hud'), alb, manifest);
  hud.setHotbar(HOTBAR.map(n => B[n]));
  hud.select(0);
  const held = () => renderer.setHeld(hud.block, BLOCKS);
  held();

  // wait for the ground under the spawn, then stand on it
  status('Building the world…');
  world.update(spawn.x, spawn.z);
  const groundY = () => {
    // the ground itself, not the top of a tree
    for (let y = 383; y > 0; y--) { const b = world.get(spawn.x, y, spawn.z); if (b && BLOCKS[b].solid && !BLOCKS[b].leaves && !BLOCKS[b].log) return y + 1; }
    return -1;
  };
  await new Promise(res => {
    const t0 = performance.now();
    const wait = () => {
      world.update(spawn.x, spawn.z);
      let meshed = 0, need = 0;
      const pcx = Math.floor(spawn.x / 16), pcz = Math.floor(spawn.z / 16);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { need++; const c = world.chunks.get((pcx + dx) + ',' + (pcz + dz)); if (c && c.meshed) meshed++; }
      status('Building the world… ' + Math.round(meshed / need * 100) + '%');
      if (meshed >= need || performance.now() - t0 > 60000) res(); else setTimeout(wait, 50);
    };
    wait();
  });
  const gy = groundY();
  player.pos.set(spawn.x + 0.5, gy > 0 ? gy : 120, spawn.z + 0.5);
  player.prev.copy(player.pos);
  player.yaw = Math.PI * 0.75;
  $('#loading').hidden = true;
  $('#start').hidden = false;

  /* ---- input ---- */
  const locked = () => document.pointerLockElement === canvas;
  canvas.addEventListener('click', () => { if (!locked()) canvas.requestPointerLock(); });
  $('#start').addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', () => { $('#start').hidden = locked(); });
  document.addEventListener('mousemove', e => {
    if (!locked()) return;
    player.yaw -= e.movementX * 0.0024;
    player.pitch = Math.max(-1.5605, Math.min(1.5605, player.pitch - e.movementY * 0.0024));
  });
  const keyName = e => e.key === ' ' ? ' ' : e.key.toLowerCase();
  let showHud = true, showDebug = false, timeRuns = true, autoScale = !params.get('scale');
  document.addEventListener('keydown', e => {
    if (e.key === 'F3') { showDebug = !showDebug; e.preventDefault(); return; }
    if (e.key === 'F1') { showHud = !showHud; $('#hud').hidden = !showHud; e.preventDefault(); return; }
    if (e.key === 'F7') { autoScale = false; renderer.opts.scale = renderer.opts.scale >= 1 ? 0.75 : renderer.opts.scale >= 0.75 ? 0.5 : 1; fit(); e.preventDefault(); return; }
    if (e.key === 'F8') {
      const names = Object.keys(PRESETS), next = names[(names.indexOf(QNAME) + 1) % names.length];
      try { localStorage.setItem('lc2_quality', next); } catch (err) {}
      location.reload(); e.preventDefault(); return;
    }
    if (!locked()) return;
    const k = keyName(e);
    if (k >= '1' && k <= '9') { hud.select(+k - 1); held(); }
    if (k === '[') worldTime -= 1000;
    if (k === ']') worldTime += 1000;
    if (k === 'p') timeRuns = !timeRuns;
    if (k === 'f') { player.flying = !player.flying; player.vel.y = 0; }
    player.setKey(k, true);
    if (k === ' ' || k === 'control') e.preventDefault();
  });
  document.addEventListener('keyup', e => player.setKey(keyName(e), false));
  canvas.addEventListener('wheel', e => { hud.select(hud.slot + Math.sign(e.deltaY)); held(); }, { passive: true });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!locked()) return;
    const v = player.view(1);
    const hit = player.pick(v.eye, 5);
    if (e.button === 0) { renderer.swing = 1; if (hit) breakBlock(hit.x, hit.y, hit.z, hit.b); }
    if (e.button === 1 && hit) { e.preventDefault(); const d = BLOCKS[hit.b]; hud.setSlot(d.lower ? B[d.lower] : hit.b); held(); }
    if (e.button === 2) { renderer.swing = 1; placeBlock(hit); }
  });
  function breakBlock(x, y, z, b) {
    const d = BLOCKS[b];
    world.set(x, y, z, 0, 0);
    // the other half of a tall plant, and whatever stood on this
    if (d.upper && world.get(x, y + 1, z) === B[d.upper]) world.set(x, y + 1, z, 0, 0);
    if (d.lower && world.get(x, y - 1, z) === B[d.lower]) world.set(x, y - 1, z, 0, 0);
    const above = world.get(x, y + 1, z);
    if (above && (BLOCKS[above].shape === 'cross' || BLOCKS[above].shape === 'snow' || BLOCKS[above].shape === 'torch')) {
      world.set(x, y + 1, z, 0, 0);
      if (BLOCKS[above].upper) world.set(x, y + 2, z, 0, 0);
    }
    // a water plant leaves its water behind
    if (d.waterlogged) world.set(x, y, z, B.water, 0);
    fluids.around(x, y, z);
  }
  function placeBlock(hit) {
    if (!hit || !hit.face) return;
    const id = hud.block;
    let x = hit.x, y = hit.y, z = hit.z;
    // clicking on grass or snow replaces it, as in the game
    if (!BLOCKS[hit.b].replaceable) { x += hit.face[0]; y += hit.face[1]; z += hit.face[2]; }
    const cur = world.get(x, y, z);
    if (cur && !BLOCKS[cur].replaceable) return;
    const d = BLOCKS[id];
    if (d.solid && player.occupies(x, y, z)) return;
    if (d.shape === 'torch' || d.shape === 'cross') { const below = world.get(x, y - 1, z); if (!below || !BLOCKS[below].solid) return; }
    world.set(x, y, z, id, 0);
    if (d.upper && !world.get(x, y + 1, z)) world.set(x, y + 1, z, B[d.upper], 0);
    if (FLUID[cur] === 1) renderer.inter.splash(x + 0.5, z + 0.5, 0.8, 2.0);
    fluids.around(x, y, z);
  }

  /* ---- the loop ---- */
  let worldTime = 1500;           // ticks into the day: morning
  let acc = 0, last = performance.now(), fps = 0, fpsT = 0, frames = 0, scaleTick = 0;
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const tilt = 0.42;              // the sun's path leans south, so shadows are never straight down
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= 0.05) {
      acc -= 0.05;
      player.tick();
      fluids.step();
      if (timeRuns) worldTime += 1;
      for (const s of player.splashes.splice(0)) renderer.inter.splash(s[0], s[1], s[2], s[3]);
    }
    const alpha = acc / 0.05;
    world.update(player.pos.x, player.pos.z);
    world.flush();
    const v = player.view(alpha);
    // the sun: up at 0, overhead at 6000, down at 12000, as in the game
    const a = ((worldTime % 24000) / 24000) * Math.PI * 2;
    sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    moonDir.copy(sunDir).negate();
    const eyeBlock = world.get(Math.floor(v.eye.x), Math.floor(v.eye.y), Math.floor(v.eye.z));
    const skyAtEye = skyAt(v.eye);
    const onGrass = player.onGround && !player.flying;
    renderer.render({
      time: (worldTime + alpha) / 20, sunDir, moonDir, feet: v.feet, eye: v.eye, yaw: player.yaw, pitch: player.pitch,
      fov: player.fov, eyeInWater: FLUID[eyeBlock] === 1 || player.eyeInWater, skyAtEye,
      moonPhase: Math.floor(worldTime / 24000) % 8, trample: onGrass ? 1 : 0, showHand: showHud, bob: v.handBob,
      waterTint: tintAt(v.eye),
    }, dt);
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
      // keep it smooth: give up resolution before frame rate, and take it back when there is room
      if (autoScale && now > 8000 && ++scaleTick % 4 === 0) {
        const s = renderer.opts.scale;
        if (fps < 42 && s > 0.5) { renderer.opts.scale = Math.max(0.5, +(s - 0.1).toFixed(2)); fit(); }
        else if (fps > 58 && s < QP.scale) { renderer.opts.scale = Math.min(QP.scale, +(s + 0.05).toFixed(2)); fit(); }
      }
    }
    if (showDebug) {
      const p = player.pos;
      const bn = BIOMES[world.biomeAt(Math.floor(p.x), Math.floor(p.z))];
      hud.showDebug(true, [
        'Leoncraft 2 (preview)  ' + fps + ' fps',
        'XYZ: ' + p.x.toFixed(2) + ' / ' + (p.y + Y0).toFixed(2) + ' / ' + p.z.toFixed(2),
        'Chunk: ' + Math.floor(p.x / 16) + ' ' + Math.floor(p.z / 16) + '   loaded ' + world.chunks.size + '   meshes ' + renderer.columns.size,
        'Biome: ' + (bn ? bn.name : '?'),
        'Time: ' + (worldTime % 24000) + (timeRuns ? '' : ' (stopped)') + '   seed ' + SEED,
        'Render ' + renderer.rw + 'x' + renderer.rh + ' (F7 scale)   distance ' + RD + '   quality ' + QNAME + ' (F8)',
        'Fluids pending: ' + fluids.pending.size,
      ]);
    } else hud.showDebug(false);
    requestAnimationFrame(loop);
  }
  // how open to the sky the eye is (light level), for fog and light shafts underground
  function skyAt(eye) {
    let y = Math.floor(eye.y) + 1;
    const x = Math.floor(eye.x), z = Math.floor(eye.z);
    for (; y < 384; y++) { const b = world.get(x, y, z); if (b && BLOCKS[b].opacity >= 15) return 0.25; }
    return 1;
  }
  const tintCache = new THREE.Vector3(0.05, 0.18, 0.78);
  function tintAt(eye) {
    const b = BIOMES[world.biomeAt(Math.floor(eye.x), Math.floor(eye.z))];
    if (!b) return tintCache;
    const c = b.water;
    const lin = v => Math.pow(v / 255, 2.2);
    tintCache.set(lin(c >> 16), lin((c >> 8) & 255), lin(c & 255));
    return tintCache;
  }
  requestAnimationFrame(loop);
  window.__lc2 = { world, player, renderer, fluids, hud, B, BLOCKS, get time() { return worldTime; }, set time(t) { worldTime = t; },
    isLeaf: b => !BLOCKS[b] || BLOCKS[b].leaves || BLOCKS[b].log || !BLOCKS[b].solid };
}

boot().catch(e => { console.error(e); status('Something went wrong: ' + (e && e.message)); });
