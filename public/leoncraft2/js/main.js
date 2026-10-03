/* ---------------------------------------------------------------------------
   Leoncraft 2 - start up and run.

   Loads the texture arrays, starts the renderer and the menus, and puts a
   world behind the title screen, turning slowly the way the classic title
   panorama does. Singleplayer -> a world from the list (or a new one) ->
   the loading screen while the ground around you is made -> the game.

   In the game: 20 ticks a second for the player, the water, mining and
   building, survival and the clock, and a frame drawn between ticks as
   often as the screen allows. Esc (or losing the mouse) opens the Game
   Menu; Save and Quit goes back to the title, leaving the world turning
   behind it. What changed in a world is kept in the browser (save.js).

   Keys (Controls in Options changes them): WASD, Space (twice to fly in
   creative), Shift sneak, Ctrl sprint, E inventory, Q or F5 the view, 1-9
   and the wheel for the hotbar, left click mine, right click place or use,
   middle click pick block, F1 hide the HUD, F3 details, [ and ] the clock,
   F7 render scale, F8 quality.
--------------------------------------------------------------------------- */
import { B, BLOCKS, resolveTextures, FLUID } from './blocks.js?v=5';
import { BIOMES, biomeColours } from './biomes.js?v=5';
import { pickBiome } from './worldgen.js?v=5';
import { World } from './world.js?v=5';
import { Fluids } from './fluids.js?v=5';
import { Player } from './player.js?v=5';
import { Renderer } from './render/renderer.js?v=5';
import { Overlay } from './render/overlay.js?v=5';
import { setSkin, setSkinPart, useDefaultSkin } from './render/avatar.js?v=5';
import { Packs, resolver, blockTextures, guiSheets, logoArt, skinUrl, colormaps } from './ui/pack.js?v=5';
import { SEA, Y0 } from './world-const.js?v=5';
import { Gui, Options } from './ui/gui.js?v=5';
import { TitleScreen, PauseScreen, LoadingScreen, DeathScreen, Worlds, setLogoArt } from './ui/menus.js?v=5';
import { ItemIcons } from './ui/icons.js?v=5';
import { Inventory, inventoryScreen } from './ui/inventory.js?v=5';
import { Hud } from './ui/hud.js?v=5';
import { Interactor } from './interact.js?v=5';
import { Survival } from './survival.js?v=5';
import { Save } from './save.js?v=5';
const THREE = window.THREE;

const $ = s => document.querySelector(s);
const status = (t, f) => { const el = $('#status'); if (el) el.textContent = t; const b = $('#bar'); if (b && f !== undefined) b.style.width = Math.round(f * 100) + '%'; };
const params = new URLSearchParams(location.search);
const MENU_SEED = 20261002;
/* Graphics, as in the game's Video Settings: Detailed (the full look: sun
   rays, soft shadows, clouds, reflections) or Fast (one pass, no shadow map,
   Minecraft's fast leaves, for old Chromebooks). A change takes effect when
   you leave Video Settings, and only if it really changed. The render scale
   also follows the frame rate on its own. */
const PRESETS = {
  fast: { rd: 4, scale: 0.55, ldr: true, shadows: 0, normals: false, fastLeaves: true, interSize: 128, uploadMs: 2, sky: 4, plantDist: 40, plantShadows: false },
  // water reflections, soft shadows, light rays and the sky kept whole; bloom off, a little less view, lighter clouds
  detailed: { rd: 5, shadowRes: 2048, shadowDist: 72, shadows: 2, scale: 0.85, vlSteps: 10, cloudSteps: 10, ssrSteps: 18, plantDist: 64, leafInDist: 32, leafInShadows: false, plantShadows: false, sky: 2, bloom: false, uploadMs: 3 },
};
// what the older settings become
const GRAPHICS_OF = { auto: 'detailed', potato: 'fast', low: 'detailed', medium: 'detailed', high: 'detailed', ultra: 'detailed', fast: 'fast', detailed: 'detailed' };
// software rendering (no graphics chip at all) starts on Fast; everything else on Detailed
function guessGraphics() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'fast';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /SwiftShader|llvmpipe|Software/i.test(name) ? 'fast' : 'detailed';
  } catch (e) { return 'detailed'; }
}
const options = new Options();
const chosen = GRAPHICS_OF[options.get('quality')] && options.get('quality') !== 'auto' ? GRAPHICS_OF[options.get('quality')] : null;
let QNAME = GRAPHICS_OF[params.get('q')] || chosen || guessGraphics();
const chosenByUser = !!(params.get('q') || chosen);
const QP = PRESETS[QNAME];
const RD = +(params.get('rd') || options.get('renderDistance') || QP.rd);

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
/* A texture array from a tall strip of 16 x 16 layers. With every block in
   the game the strip is over 20 000 pixels tall, more than many GPUs take in
   one upload, so it is cut into pieces of 128 layers (2048 pixels, the least
   any WebGL2 device allows) and each piece is put into its slice of the
   array. The bitmaps are decoded with nothing premultiplied or converted:
   the normal and material maps keep data in every channel. */
const PIECE = 128;
const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
async function strip(url, layers) {
  const blob = await (await fetch(url)).blob();
  const full = await createImageBitmap(blob, RAW);
  const parts = [];
  for (let z = 0; z < layers; z += PIECE) {
    const n = Math.min(PIECE, layers - z);
    parts.push([z, n, await createImageBitmap(full, 0, z * 16, 16, n * 16, RAW)]);
  }
  full.close && full.close();
  return parts;
}
function arrayTex(parts, layers, filter) {
  const t = new THREE.DataArrayTexture(null, 16, 16, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = filter || THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.source.dataReady = false;       // three.js makes the storage; the pieces go in below
  t.needsUpdate = true;
  t.pieces = parts;
  return t;
}
function uploadArray(r, t) {
  r.initTexture(t);
  const gl = r.getContext(), glTex = r.properties.get(t).__webglTexture;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  for (const [z, n, bmp] of t.pieces) { gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, z, 16, 16, n, gl.RGBA, gl.UNSIGNED_BYTE, bmp); bmp.close && bmp.close(); }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  t.pieces = null;
  r.resetState();
}
/* A resource pack's textures over ours, layer by layer: the albedo from the
   pack, a flat normal map and a plain material map (the generated ones were
   made for our textures), light from the pixels of blocks that glow. Returns
   a copy of the albedo strip with the same changes, for the item icons. */
function applyPackTextures(r, textures, manifest, packTex, alb) {
  const gl = r.getContext();
  const glow = new Set(), soft = new Set();
  for (const d of BLOCKS) {
    if (!d || !d.faces) continue;
    if (d.light) for (const l of d.faces.concat(d.front !== undefined ? [d.front] : [])) glow.add(l);
    if (d.leaves || d.shape === 'cross') for (const l of d.faces) soft.add(l);
  }
  const strip = document.createElement('canvas');
  strip.width = 16; strip.height = alb.height;
  const sg = strip.getContext('2d');
  sg.drawImage(alb, 0, 0);
  const cell = document.createElement('canvas'); cell.width = cell.height = 16;
  const cg = cell.getContext('2d', { willReadFrequently: true });
  const flat = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) flat.set([128, 128, 255, 255], i * 4);
  const spec = new Uint8Array(16 * 16 * 4);
  const put = (tex, layer, data) => {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.properties.get(tex).__webglTexture);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  };
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  for (const [name, frames] of packTex) {
    const e = manifest.textures[name];
    const layers = [];
    for (let f = 0; f < frames.length; f++) layers.push([e.layer + f, frames[f]]);
    for (const v of e.variants || []) layers.push([v, frames[0]]);
    for (const [layer, bmp] of layers) {
      put(textures.albedo, layer, bmp);
      sg.clearRect(0, layer * 16, 16, 16);
      sg.drawImage(bmp, 0, layer * 16);
      if (textures.normal.image && textures.normal.image.depth > 1) put(textures.normal, layer, flat);
      cg.clearRect(0, 0, 16, 16); cg.drawImage(bmp, 0, 0);
      const px = cg.getImageData(0, 0, 16, 16).data;
      const lit = glow.has(e.layer), sss = soft.has(e.layer) ? 190 : 0;
      for (let i = 0; i < 256; i++) {
        const lum = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
        spec[i * 4] = 40; spec[i * 4 + 1] = 10; spec[i * 4 + 2] = sss;
        spec[i * 4 + 3] = lit ? Math.round(Math.max(0, Math.min(1, (lum - 0.35) * 2.2)) * 255) : 0;
      }
      put(textures.spec, layer, spec);
    }
  }
  for (const t of [textures.albedo, textures.normal, textures.spec]) {
    if (!t.image || t.image.depth <= 1) continue;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.properties.get(t).__webglTexture);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  r.resetState();
  return strip;
}
// one flat normal-map layer, for the tier that never reads them
function flatNormals() {
  const t = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 128]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}
function pixels(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height).data;
}

/* somewhere good to start: dry land in a green biome, with water in sight */
const GOOD = ['plains', 'forest', 'birch_forest', 'flower_forest', 'meadow', 'cherry_grove', 'sunflower_plains', 'taiga', 'dark_forest', 'old_growth_birch_forest', 'savanna', 'jungle', 'sparse_jungle'];
async function findSpawn(world) {
  const want = params.get('at') ? params.get('at').split(',').map(Number) : null;
  if (want) return { x: want[0], z: want[1] };
  for (let ring = 0; ring < 40; ring++) {
    const tries = [];
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = k / Math.max(1, ring * 6) * Math.PI * 2;
      tries.push([Math.round(Math.cos(a) * ring * 56), Math.round(Math.sin(a) * ring * 56)]);
    }
    const res = await Promise.all(tries.map(([x, z]) => world.ask({ type: 'surface', x, z, withBiome: true })));
    for (let i = 0; i < tries.length; i++) {
      const r = res[i];
      if (r.y < SEA + 1 || r.y > SEA + 30) continue;
      if (GOOD.indexOf(BIOMES[pickBiome(r.biome)].name) < 0) continue;
      const [x, z] = tries[i];
      const near = await Promise.all([[28, 0], [-28, 0], [0, 28], [0, -28], [20, 20], [-20, -20]].map(([dx, dz]) => world.ask({ type: 'surface', x: x + dx, z: z + dz })));
      if (near.some(n => n.y >= 0 && n.y < SEA) || ring > 25) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}
// the ground itself at a column, not the top of a tree
function groundY(world, x, z) {
  for (let y = 383; y > 0; y--) { const b = world.get(x, y, z); if (b && BLOCKS[b].solid && !BLOCKS[b].leaves && !BLOCKS[b].log) return y + 1; }
  return -1;
}

async function boot() {
  status('Loading textures…', 0.05);
  const base = new URL('../textures/', import.meta.url).href;
  // stamped like the code, so a rebuilt texture set always reaches the browser
  const TEX_V = '?v=5';
  const manifest = await (await fetch(base + 'manifest.json' + TEX_V)).json();
  let [alb, grass, foliage, moon] = await Promise.all(
    ['terrain_albedo.png', 'colormap_grass.png', 'colormap_foliage.png', 'environment_moon_phases.png'].map(f => loadImg(base + f + TEX_V)));
  // the potato tier draws no normal maps: it skips that file altogether (a third of the download)
  const withNormals = QP.normals !== false;
  const [albP, nrmP, spcP] = await Promise.all(['terrain_albedo.png', withNormals ? 'terrain_normal.png' : null, 'terrain_spec.png']
    .map(f => f ? strip(base + f + TEX_V, manifest.layers) : null));
  resolveTextures(manifest);
  // resource packs the player opened from their own computer (ui/pack.js): theirs first, ours underneath
  let find = null, packTex = null;
  try {
    const packs = await Packs.active();
    if (packs.length) {
      status('Loading resource packs…', 0.3);
      find = resolver(packs);
      const cm = await colormaps(find);
      if (cm.grass) grass = cm.grass;
      if (cm.foliage) foliage = cm.foliage;
      packTex = await blockTextures(find, manifest);
    }
  } catch (e) { console.warn('resource packs', e); find = null; packTex = null; }
  const colours = biomeColours(pixels(grass), pixels(foliage));
  const moonTex = new THREE.Texture(moon);
  moonTex.magFilter = THREE.NearestFilter; moonTex.minFilter = THREE.NearestFilter; moonTex.needsUpdate = true;
  const textures = {
    albedo: arrayTex(albP, manifest.layers, THREE.LinearMipmapLinearFilter),
    normal: nrmP ? arrayTex(nrmP, manifest.layers, THREE.LinearMipmapLinearFilter) : flatNormals(),
    spec: arrayTex(spcP, manifest.layers, THREE.LinearMipmapLinearFilter),
    manifest, moon: moonTex,
  };

  status('Starting the renderer…', 0.5);
  const canvas = $('#c');
  const rs = options.get('renderScale');
  const renderer = new Renderer(canvas, textures, Object.assign({}, QP, { renderDist: RD, scale: +(params.get('scale') || (rs !== 'auto' ? rs : QP.scale)) }));
  for (const t of [textures.albedo, textures.normal, textures.spec]) if (t.pieces) uploadArray(renderer.r, t);
  if (packTex && packTex.size) alb = applyPackTextures(renderer.r, textures, manifest, packTex, alb);
  const overlay = new Overlay(renderer.U, manifest);
  renderer.overlay = overlay;
  const fit = () => { renderer.resize(window.innerWidth, window.innerHeight); gui.resize(); };

  /* ---- the menus, and everything they ask of the game ---- */
  let game = null;                  // the world being played
  let menu = null;                  // the world turning behind the title screen
  let loading = null;               // { text, progress, chunks } while a world loads
  const hooks = {
    play: (entry, o) => startGame(entry, o && o.isNew),
    deleteWorld: w => Save.remove(w.id),
    quitToTitle: () => quitToTitle(),
    resume: () => lock(),
    respawn: () => respawn(),
    loadingProgress: () => loading || { text: 'Loading terrain...', progress: 0 },
    quit: () => { location.href = '/'; },
    // Done on the resource pack screen after a change: load everything again, back into the same world
    reloadResources: () => {
      saveGame().then(() => { try { sessionStorage.setItem('lc2_resume', game ? game.entry.id : ''); } catch (e) {} location.reload(); });
    },
    // leaving Video Settings: Detailed or Fast takes effect now, if it really changed
    applyGraphics: () => {
      const want = GRAPHICS_OF[options.get('quality')] || 'detailed';
      if (want === QNAME) return;
      saveGame().then(() => { try { sessionStorage.setItem('lc2_resume', game ? game.entry.id : ''); } catch (e) {} location.reload(); });
    },
    // the last screen closed in the game: take the mouse back
    closed: () => { if (game && !game.survival.dead) lock(); },
  };
  const gui = new Gui($('#gui'), { base: base + 'gui/', options, hooks, version: TEX_V });
  await gui.load();
  if (find) {
    try {
      await gui.loadSheet('container/creative_inventory/tabs').catch(() => null);
      const sheets = await guiSheets(find, { widgets: gui.sheets.get('widgets'), icons: gui.sheets.get('icons'), tabs: gui.sheets.get('container/creative_inventory/tabs') });
      for (const k in sheets) gui.setSheet(k, sheets[k]);
      setLogoArt(await logoArt(find));
      const sk = await skinUrl(find);
      if (sk) useDefaultSkin(sk);
    } catch (e) { console.warn('resource pack GUI', e); }
  }
  gui.lowEnd = QNAME === 'fast';
  window.addEventListener('resize', fit);
  fit();

  /* ---- item icons for the inventory and the hotbar (made a few at a time) ---- */
  const icons = new ItemIcons(alb, { grassMap: grass, foliageMap: foliage });
  let hud = null;                   // the hotbar, hearts and F3, made per world (js/ui/hud.js)

  /* ---- the world behind the title screen ---- */
  async function startMenu(seed) {
    const world = new World({
      seed, renderDist: Math.min(RD, 6), manifest, colours, fastLeaves: !!QP.fastLeaves,
      onMesh: (cx, cz, mesh) => renderer.setColumn(cx, cz, mesh),
      onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
    });
    await world.ready;
    const spawn = await findSpawn(world);
    menu = { world, x: spawn.x + 0.5, z: spawn.z + 0.5, y: null, yaw: Math.PI * 0.75, seed };
    // the ground round it first, so the title never opens on an empty sky
    await new Promise(res => {
      const t0 = performance.now();
      const wait = () => {
        world.update(menu.x, menu.z);
        let meshed = 0, need = 0;
        const pcx = Math.floor(menu.x / 16), pcz = Math.floor(menu.z / 16);
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dz * dz > 4) continue;
          need++; const c = world.chunks.get((pcx + dx) + ',' + (pcz + dz)); if (c && c.meshed) meshed++;
        }
        status('Building the world…', 0.7 + 0.3 * meshed / need);
        if (meshed >= need || performance.now() - t0 > 30000) res(); else setTimeout(wait, 60);
      };
      wait();
    });
  }
  status('Building the world…', 0.7);
  await startMenu(MENU_SEED);
  status('Building the world…', 1);
  $('#loading').hidden = true;
  gui.panorama = true;
  gui.setRoot(new TitleScreen());

  /* ---- playing a world ---- */
  async function startGame(entry, isNew) {
    loading = { text: 'Loading terrain...', progress: 0, chunks: [] };
    gui.setRoot(new LoadingScreen());
    const save = new Save(entry.id);
    await save.init();
    const edits = isNew ? new Map() : await save.loadEdits();
    const st = isNew ? null : save.readState();
    let world;
    if (menu && menu.seed === (entry.seed | 0)) {
      // the title screen's world is this one: keep what is already made
      world = menu.world;
      world.adoptEdits(edits, save);
    } else {
      if (menu) dropWorld(menu.world);
      world = new World({
        seed: entry.seed | 0, renderDist: RD, manifest, colours, fastLeaves: !!QP.fastLeaves, edits, save,
        onMesh: (cx, cz, mesh) => renderer.setColumn(cx, cz, mesh),
        onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
      });
      await world.ready;
    }
    menu = null;
    world.renderDist = RD;
    const spawn = st && st.spawn ? st.spawn : (entry.spawn || await findSpawn(world));
    const at = st && st.player ? st.player : null;
    const cx = at ? at.x : spawn.x, cz = at ? at.z : spawn.z;
    // wait for the ground round where you will stand
    await new Promise(res => {
      const t0 = performance.now();
      const wait = () => {
        world.update(cx, cz);
        world.flush();
        renderer.pumpUploads(8);
        let meshed = 0, need = 0;
        const pcx = Math.floor(cx / 16), pcz = Math.floor(cz / 16), ch = [];
        // only chunks inside the render distance are ever meshed: wait for those near you
        const R = Math.min(3, world.renderDist - 1);
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dz * dz > R * R) { ch.push([dx, dz, 0]); continue; }
          need++;
          const c = world.chunks.get((pcx + dx) + ',' + (pcz + dz));
          if (c && c.meshed) meshed++;
          ch.push([dx, dz, c ? (c.meshed ? 7 : 4) : world.inFlight.has('g' + (pcx + dx) + ',' + (pcz + dz)) ? 1 : 0]);
        }
        loading.progress = meshed / need; loading.chunks = ch;
        gui.markDirty();
        if (meshed >= need || performance.now() - t0 > 60000) res(); else setTimeout(wait, 50);
      };
      wait();
    });
    const player = new Player(world);
    if (at) {
      player.pos.set(at.x, at.y, at.z); player.yaw = at.yaw || 0; player.pitch = at.pitch || 0; player.flying = !!at.flying;
    } else {
      const gy = groundY(world, spawn.x, spawn.z);
      player.pos.set(spawn.x + 0.5, gy > 0 ? gy : 120, spawn.z + 0.5);
      player.yaw = Math.PI * 0.75;
    }
    player.prev.copy(player.pos);
    const mode = entry.mode === 'creative' ? 'creative' : 'survival';
    player.canFly = mode === 'creative';
    const fluids = new Fluids(world, (x, y, z, kind) => {
      if (kind === 1 && Math.random() < 0.3) renderer.inter.splash(x + 0.5, z + 0.5, 0.35, 1.5);
    });
    const inv = new Inventory({ mode });
    if (st && st.inventory) inv.fromJSON(st.inventory);
    else if (mode === 'creative') {
      // a new creative world starts with a few blocks to hand (the rest are under E)
      ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'oak_stairs', 'oak_door', 'lantern']
        .forEach((n, i) => { if (B[n] !== undefined) inv.slots[i] = { id: B[n], count: 1 }; });
      inv.changed();
    }
    const survival = new Survival();
    if (st && st.survival) survival.fromJSON(st.survival);
    const inter = new Interactor({
      world, player, fluids, renderer, overlay,
      hand: {
        id: () => inv.heldId(),
        used: () => { if (mode !== 'creative') inv.takeSelected(1); },
        got: id => inv.add(id, 1),
        swing: () => { renderer.swing = 1; },
      },
      onSplash: (x, z) => renderer.inter.splash(x, z, 0.8, 2.0),
    });
    inter.creative = mode === 'creative';
    game = { entry, world, player, fluids, inv, survival, inter, save, mode, spawn, time: st && st.time !== undefined ? st.time : 1500, saveT: 0 };
    hud = new Hud(inv, icons);
    gui.hud = hud;
    inv.on('held', id => renderer.setHeld(id, BLOCKS));
    held();
    Worlds.update(entry.id, { lastPlayed: Date.now(), spawn });
    loading = null;
    gui.panorama = false; gui.inGame = true;
    gui.closeAll();
    startedAt = performance.now();
    lock();
    // no mouse yet (the click that started this is long gone): the game menu, as when the window loses focus
    setTimeout(() => { if (game && !locked() && !gui.isOpen()) gui.open(new PauseScreen()); }, 600);
  }
  function held() { if (game) renderer.setHeld(game.inv.heldId(), BLOCKS); }
  function dropWorld(world) {
    for (const k of [...renderer.columns.keys()]) { const [x, z] = k.split(',').map(Number); renderer.dropColumn(x, z); }
    if (renderer.uploads) renderer.uploads.clear();
    world.destroy();
  }
  function stateOf() {
    const g = game, p = g.player;
    return { player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying }, time: g.time,
      inventory: g.inv.toJSON ? g.inv.toJSON() : null, survival: g.survival.toJSON(), spawn: g.spawn, mode: g.mode };
  }
  async function saveGame() {
    if (!game) return;
    game.save.writeState(stateOf());
    await game.save.flush(game.world.edits);
  }
  async function quitToTitle() {
    if (!game) return;
    const g = game;
    await saveGame();
    game = null;
    if (document.pointerLockElement) document.exitPointerLock();
    // the world you left keeps turning behind the title screen
    menu = { world: g.world, x: g.player.pos.x, z: g.player.pos.z, y: null, yaw: g.player.yaw, seed: g.entry.seed | 0 };
    g.world.save = null;
    overlay.set(0, 0, 0, null, -1);
    if (hud) { hud.dispose(); hud = null; gui.hud = null; }
    gui.inGame = false; gui.panorama = true;
    gui.setRoot(new TitleScreen());
  }
  function respawn() {
    if (!game) return;
    const g = game;
    g.survival.reset();
    const gy = groundY(g.world, g.spawn.x, g.spawn.z);
    g.player.pos.set(g.spawn.x + 0.5, gy > 0 ? gy : 120, g.spawn.z + 0.5);
    g.player.prev.copy(g.player.pos); g.player.vel.set(0, 0, 0);
    lock();
  }
  window.addEventListener('pagehide', () => { saveGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

  /* ---- input ---- */
  const locked = () => document.pointerLockElement === canvas;
  function lock() { if (game && !locked()) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }
  canvas.addEventListener('click', () => { if (game && !gui.isOpen()) lock(); });
  let wantInv = false;
  document.addEventListener('pointerlockchange', () => {
    if (locked()) return;
    for (const k in game ? game.player.keys : {}) game.player.keys[k] = false;
    if (game && game.inter) { game.inter.up(0); game.inter.up(2); }
    // losing the mouse in the game is Esc: the game menu (not when it went to the inventory)
    if (game && !gui.isOpen() && !wantInv && !game.survival.dead) gui.open(new PauseScreen());
    wantInv = false;
  });
  // MC's mouse: sensitivity s gives (0.6 s + 0.2)^3 x 8 x 0.15 degrees a pixel
  document.addEventListener('mousemove', e => {
    if (!locked() || !game) return;
    const s = options.get('sensitivity'), f = s * 0.6 + 0.2, k = f * f * f * 8 * 0.15 * Math.PI / 180;
    const inv = options.get('invertY') ? -1 : 1;
    game.player.yaw -= e.movementX * k;
    game.player.pitch = Math.max(-1.5605, Math.min(1.5605, game.player.pitch - e.movementY * k * inv));
  });
  // the player's own key names, from the bindings in Options
  const MOVE = { forward: 'w', left: 'a', back: 's', right: 'd', jump: ' ', sneak: 'shift', sprint: 'control' };
  const bindingOf = code => options.actionFor(code);
  let showDebug = false, timeRuns = true, autoScale = options.get('renderScale') === 'auto' && !params.get('scale');
  document.addEventListener('keydown', e => {
    if (!game || gui.isOpen()) return;
    const a = bindingOf(e.code);
    if (a === 'debug' || e.code === 'F3') { showDebug = !showDebug; if (!showDebug && hud) hud.setDebug(null); e.preventDefault(); return; }
    if (a === 'hideGui' || e.code === 'F1') { gui.hideHud = !gui.hideHud; gui.markDirty(); e.preventDefault(); return; }
    if (e.code === 'F7') { autoScale = false; renderer.opts.scale = renderer.opts.scale >= 1 ? 0.75 : renderer.opts.scale >= 0.75 ? 0.5 : 1; fit(); e.preventDefault(); return; }
    if (a === 'perspective' || e.code === 'F5') { if (!e.repeat) renderer.avatar.cycleView(); e.preventDefault(); return; }
    if (a === 'inventory') {
      e.preventDefault();
      wantInv = true;
      for (const k in game.player.keys) game.player.keys[k] = false;
      if (document.pointerLockElement) document.exitPointerLock();
      gui.open(inventoryScreen(game.inv, icons));
      return;
    }
    if (!locked()) return;
    if (a && a.startsWith('hotbar')) { game.inv.select(+a.slice(6) - 1); return; }
    if (e.code === 'BracketLeft') game.time -= 1000;
    if (e.code === 'BracketRight') game.time += 1000;
    if (e.code === 'KeyP' && !a) timeRuns = !timeRuns;
    if (a && MOVE[a]) { game.player.setKey(MOVE[a], true); e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    if (!game) return;
    const a = bindingOf(e.code);
    if (a && MOVE[a]) game.player.setKey(MOVE[a], false);
  });
  canvas.addEventListener('wheel', e => { if (game && locked()) game.inv.scroll(e.deltaY); }, { passive: true });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!game || !locked()) return;
    const g = game;
    if (e.button === 1) {
      e.preventDefault();
      const hit = g.inter.target;
      if (hit) { const d = BLOCKS[hit.b]; g.inv.pickBlock(d.lower ? B[d.lower] : hit.b); }
      return;
    }
    g.inter.down(e.button);
  });
  document.addEventListener('mouseup', e => { if (game) game.inter.up(e.button); });

  /* ---- options that take effect at once ---- */
  const applyOptions = () => {
    if (game) { game.player.baseFov = options.get('fov'); game.player.fovEffects = options.get('fovEffects'); game.player.bobbing = options.get('bobbing'); }
  };
  options.onChange((k, v) => {
    applyOptions();
    if (k === 'renderDistance' && v) { if (game) game.world.renderDist = v; }
    if (k === 'renderScale') { autoScale = v === 'auto'; if (v !== 'auto') { renderer.opts.scale = +v; fit(); } }
    if (k === 'skin') setSkin(v === 'default' ? new URL('../textures/skin/default.png?v=5', import.meta.url).href : v);
    if (k === 'skinParts' && v) for (const p in v) setSkinPart(p, v[p]);
  });

  /* ---- the loop ---- */
  let acc = 0, last = performance.now(), fps = 0, fpsT = 0, frames = 0, scaleTick = 0, slowFor = 0, steppedDown = false;
  let startedAt = performance.now();
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), eyeV = new THREE.Vector3();
  const tilt = 0.42;              // the sun's path leans south, so shadows are never straight down
  const sunAt = t => {
    const a = ((t % 24000) / 24000) * Math.PI * 2;
    sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    moonDir.copy(sunDir).negate();
  };
  let menuTime = 2000, menuAcc = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (game) playFrame(now, dt);
    else if (menu) {
      // the title world turns slowly: half the frames are plenty, and the menus stay quick
      menuAcc += dt;
      if (menuAcc >= 1 / 31) { menuFrame(menuAcc); menuAcc = 0; }
    }
    gui.frame(now);
    requestAnimationFrame(loop);
  }
  // the title screen: the world from where you stood, turning slowly
  function menuFrame(dt) {
    const m = menu, w = m.world;
    w.update(m.x, m.z);
    w.flush();
    // a little above the treetops, for a view like the classic title panorama
    if (m.y === null) { const gy = groundY(w, Math.floor(m.x), Math.floor(m.z)); if (gy > 0) m.y = Math.max(gy + 9, SEA + 14); }
    m.yaw += dt * 2 * Math.PI / 180 * 1.0;
    menuTime += dt * 2;
    sunAt(menuTime);
    eyeV.set(m.x, m.y === null ? 140 : m.y, m.z);
    renderer.render({
      time: menuTime / 20, sunDir, moonDir, feet: eyeV, eye: eyeV, yaw: m.yaw, pitch: -0.16, fov: 85,
      eyeInWater: false, skyAtEye: 1, moonPhase: 0, trample: 0, showHand: false, bob: null, waterTint: tintAt(w, eyeV), player: null, alpha: 0,
    }, dt);
  }
  function playFrame(now, dt) {
    const g = game, { world, player, fluids, inter, survival } = g;
    acc += dt;
    while (acc >= 0.05) {
      acc -= 0.05;
      player.tick();
      fluids.step();
      inter.tick();
      if (g.mode !== 'creative') {
        survival.tick(player);
        if (survival.dead && !gui.isOpen()) {
          if (document.pointerLockElement) document.exitPointerLock();
          gui.open(new DeathScreen());
        }
      }
      if (timeRuns) g.time += 1;
      for (const s of player.splashes.splice(0)) renderer.inter.splash(s[0], s[1], s[2], s[3]);
      // every ten seconds, what changed goes into the browser's storage
      if (++g.saveT >= 200) { g.saveT = 0; saveGame(); }
    }
    const alpha = acc / 0.05;
    world.update(player.pos.x, player.pos.z);
    world.flush();
    const v = player.view(alpha);
    inter.look(v.eye);
    sunAt(g.time);
    const eyeBlock = world.get(Math.floor(v.eye.x), Math.floor(v.eye.y), Math.floor(v.eye.z));
    const onGrass = player.onGround && !player.flying;
    renderer.render({
      time: (g.time + alpha) / 20, sunDir, moonDir, feet: v.feet, eye: v.eye, yaw: player.yaw, pitch: player.pitch,
      fov: player.fov, eyeInWater: FLUID[eyeBlock] === 1 || player.eyeInWater, skyAtEye: skyAt(world, v.eye),
      moonPhase: Math.floor(g.time / 24000) % 8, trample: onGrass ? 1 : 0, showHand: !gui.hideHud, bob: v.handBob,
      waterTint: tintAt(world, v.eye), player, alpha,
    }, dt);
    if (g.mode !== 'creative') hud.setStats(survival.stats());
    // no crosshair in third person, or with the HUD hidden
    const cross = renderer.avatar.view === 0 && !gui.hideHud;
    if (hud.crosshair !== cross) { hud.crosshair = cross; hud.markDirty(); }
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
      // keep it smooth: give up resolution before frame rate, and take it back when there is room
      if (autoScale && now - startedAt > 6000 && ++scaleTick % 4 === 0) {
        const s = renderer.opts.scale;
        const floor = QNAME === 'fast' ? 0.4 : 0.5;
        if (fps < 42 && s > floor) { renderer.opts.scale = Math.max(floor, +(s - 0.1).toFixed(2)); fit(); }
        else if (fps > 58 && s < QP.scale) { renderer.opts.scale = Math.min(QP.scale, +(s + 0.05).toFixed(2)); fit(); }
      }
      // the first half minute, on a guessed tier: still struggling at the lowest scale means one tier down, once
      slowFor = fps < 28 ? slowFor + 0.5 : 0;
      if (!chosenByUser && !steppedDown && now - startedAt < 25000 && slowFor >= 4 && renderer.opts.scale <= 0.55 && QNAME !== 'fast') {
        // a machine that cannot keep up even at the lowest scale goes to Fast, once
        steppedDown = true;
        options.set('quality', 'fast');
        try { sessionStorage.setItem('lc2_resume', g.entry.id); } catch (e) {}
        saveGame().then(() => location.reload());
      }
    }
    if (showDebug) {
      hud.camera = { yaw: player.yaw, pitch: player.pitch };
      const p = player.pos;
      const bn = BIOMES[world.biomeAt(Math.floor(p.x), Math.floor(p.z))];
      const t = inter.target;
      hud.setDebug([
        'Leoncraft 2 (' + QNAME + ')',
        fps + ' fps',
        '',
        'XYZ: ' + p.x.toFixed(3) + ' / ' + (p.y + Y0).toFixed(5) + ' / ' + p.z.toFixed(3),
        'Block: ' + Math.floor(p.x) + ' ' + Math.floor(p.y + Y0) + ' ' + Math.floor(p.z),
        'Chunk: ' + Math.floor(p.x / 16) + ' ' + Math.floor(p.z / 16) + ' (loaded ' + world.chunks.size + ', meshes ' + renderer.columns.size + ')',
        'Facing: ' + ['north', 'west', 'south', 'east'][((Math.round(player.yaw / (Math.PI / 2)) % 4) + 4) % 4],
        'Biome: ' + (bn ? bn.name : '?'),
        'Day ' + Math.floor(g.time / 24000) + ', time ' + (g.time % 24000) + (timeRuns ? '' : ' (stopped)'),
      ], [
        'Render ' + renderer.rw + 'x' + renderer.rh + ' (F7 scale)',
        'Distance ' + world.renderDist + ', graphics ' + QNAME,
        'Seed ' + (g.entry.seed | 0),
        'Fluids pending ' + fluids.pending.size,
        '',
        t ? 'Targeted Block: ' + t.x + ', ' + (t.y + Y0) + ', ' + t.z : '',
        t ? BLOCKS[t.b].name : '',
      ]);
    }
  }
  // how open to the sky the eye is (light level), for fog and light shafts underground
  function skyAt(world, eye) {
    let y = Math.floor(eye.y) + 1;
    const x = Math.floor(eye.x), z = Math.floor(eye.z);
    for (; y < 384; y++) { const b = world.get(x, y, z); if (b && BLOCKS[b].opacity >= 15) return 0.25; }
    return 1;
  }
  const tintCache = new THREE.Vector3(0.05, 0.18, 0.78);
  function tintAt(world, eye) {
    const b = BIOMES[world.biomeAt(Math.floor(eye.x), Math.floor(eye.z))];
    if (!b) return tintCache;
    const c = b.water;
    const lin = v => Math.pow(v / 255, 2.2);
    tintCache.set(lin(c >> 16), lin((c >> 8) & 255), lin(c & 255));
    return tintCache;
  }
  requestAnimationFrame(loop);
  window.__lc2 = {
    renderer, gui, options, B, BLOCKS,
    get game() { return game; }, get world() { return game ? game.world : menu && menu.world; }, get player() { return game && game.player; },
    get fluids() { return game && game.fluids; }, get inv() { return game && game.inv; }, hud,
    get time() { return game ? game.time : menuTime; }, set time(t) { if (game) game.time = t; else menuTime = t; },
    play: (seed, mode) => startGame(Worlds.add({ id: 'w' + Date.now().toString(36), name: 'Test World', folder: 'Test World', seed: seed || MENU_SEED, mode: mode || 'creative', created: Date.now(), lastPlayed: Date.now() }), true),
    isLeaf: b => !BLOCKS[b] || BLOCKS[b].leaves || BLOCKS[b].log || !BLOCKS[b].solid,
  };
  // after a quality change, straight back into the world you were in
  let resume = null;
  try { resume = sessionStorage.getItem('lc2_resume'); sessionStorage.removeItem('lc2_resume'); } catch (e) {}
  if (resume) { const w = Worlds.get(resume); if (w) startGame(w, false); }
}

boot().catch(e => { console.error(e); status('Something went wrong: ' + (e && e.message)); });
