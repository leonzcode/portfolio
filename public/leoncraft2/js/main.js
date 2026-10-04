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
import { B, BLOCKS, resolveTextures, FLUID } from './blocks.js?v=10';
import { BIOMES, biomeColours } from './biomes.js?v=10';
import { pickBiome } from './worldgen.js?v=10';
import { parseSeed } from './gen/random.js?v=10';
import { World } from './world.js?v=10';
import { Fluids } from './fluids.js?v=10';
import { Player } from './player.js?v=10';
import { Renderer } from './render/renderer.js?v=10';
import { Overlay } from './render/overlay.js?v=10';
import { setSkin, setSkinPart, useDefaultSkin } from './render/avatar.js?v=10';
import { Packs, resolver, blockTextures, guiSheets, logoArt, skinUrl, colormaps } from './ui/pack.js?v=10';
import { SEA, Y0 } from './world-const.js?v=10';
import { Gui, Options } from './ui/gui.js?v=10';
import { TitleScreen, PauseScreen, LoadingScreen, DeathScreen, Worlds, setLogoArt } from './ui/menus.js?v=10';
import { ItemIcons } from './ui/icons.js?v=10';
import { Inventory, inventoryScreen } from './ui/inventory.js?v=10';
import { Hud } from './ui/hud.js?v=10';
import { Interactor } from './interact.js?v=10';
import { Survival } from './survival.js?v=10';
import { Save } from './save.js?v=10';
import { Chat, ChatScreen } from './ui/chat.js?v=10';
import { displayName, setItemNames, register } from './commands.js?v=10';
import { Particles } from './render/particles.js?v=10';
import { DRAW, setItemLayers, ITEMS, itemId, itemName, displayName as itemDisplay } from './items.js?v=10';
import { loadItemStrip, addItemPieces } from './itemtex.js?v=10';
import { Drops, dropItem, giveXp } from './drops.js?v=10';
import { Containers } from './containers.js?v=10';
import { Hands } from './hands.js?v=10';
import { setLayerPixels } from './render/blockmesh.js?v=10';
import { Entities } from './entities/manager.js?v=10';
import { EntityStore } from './entities/store.js?v=10';
import { Sim } from './sim/sim.js?v=10';
import { DIMS } from './dims.js?v=10';
import { Realms } from './dim/realms.js?v=10';
import { addDimArt, endSkyTexture } from './dim/art.js?v=10';
import { structuresApi } from './struct/spawners.js?v=10';
const THREE = window.THREE;

const $ = s => document.querySelector(s);
const status = (t, f) => { const el = $('#status'); if (el) el.textContent = t; const b = $('#bar'); if (b && f !== undefined) b.style.width = Math.round(f * 100) + '%'; };
const params = new URLSearchParams(location.search);
const MENU_SEED = 20261002;
// a world's seed as its generator wants it: the vanilla one takes the whole
// 64-bit seed (a decimal string), the first generator a 32-bit number
// a dimension's mobs are kept under the world's id, with the dimension added for the Nether and the End
const entityKey = (entry, dim) => entry.id + (!dim || dim === 'overworld' ? '' : '~' + dim);
const worldSeed = entry => (entry.generator === 'vanilla' ? String(entry.seed) : entry.seed | 0);
/* Graphics, as in the game's Video Settings: Detailed (the full look: sun
   rays, soft shadows, clouds, reflections) or Fast (the game with no shaders
   at all, as Minecraft itself draws it: render/vanilla.js). Both draw at the
   screen's full resolution. A change takes effect when you leave Video
   Settings, and only if it really changed. */
const PRESETS = {
  fast: { rd: 8, scale: 1, ldr: true, vanilla: true, shadows: 0, normals: false, spec: false, fastLeaves: false, interSize: 32, uploadMs: 3, plantDist: 136, leafInDist: 64, plantShadows: false },
  detailed: { rd: 8, shadowRes: 2048, shadowDist: 96, shadows: 2, scale: 1, fxaa: false, vlSteps: 10, cloudSteps: 14, ssrSteps: 18, plantDist: 80, leafInDist: 40, leafInShadows: false },
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
// Q throws and F5 turns the view, as in the game (older settings had the view on Q)
{ const k = options.get('keys'); if (k && k.perspective === 'KeyQ' && !k.drop) { options.setKey('drop', 'KeyQ'); options.setKey('perspective', 'F5'); } }
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
      if (textures.spec.image && textures.spec.image.depth > 1) put(textures.spec, layer, spec);
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
      // the vanilla generator answers with the biome itself, the first one with its climate
      const bid = typeof r.biome === 'number' ? r.biome : pickBiome(r.biome);
      if (GOOD.indexOf(BIOMES[bid].name) < 0) continue;
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
  const TEX_V = '?v=10';
  const manifest = await (await fetch(base + 'manifest.json' + TEX_V)).json();
  let [alb, grass, foliage, moon, sunImg] = await Promise.all(
    ['terrain_albedo.png', 'colormap_grass.png', 'colormap_foliage.png', 'environment_moon_phases.png', 'environment_sun.png'].map(f => loadImg(base + f + TEX_V)));
  // the potato tier draws no normal maps: it skips that file altogether (a third of the download)
  const withNormals = QP.normals !== false;
  const [albP, nrmP, spcP] = await Promise.all(['terrain_albedo.png', withNormals ? 'terrain_normal.png' : null, QP.spec !== false ? 'terrain_spec.png' : null]
    .map(f => f ? strip(base + f + TEX_V, manifest.layers) : null));
  // our own art for the Nether and the End (the portal swirl, the frame's eye, item icons) on extra layers
  const dimArt = addDimArt(manifest);
  resolveTextures(manifest);
  // the pictures of the items that are not blocks, after the last block layer (itemtex.js)
  const itemStrip = await loadItemStrip(base, TEX_V);
  const LAYERS = manifest.layers + await addItemPieces(itemStrip, manifest.layers, albP, nrmP, spcP);
  setItemLayers(manifest.layers);
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
  const sunTex = new THREE.Texture(sunImg);
  sunTex.magFilter = THREE.NearestFilter; sunTex.minFilter = THREE.NearestFilter; sunTex.generateMipmaps = false; sunTex.needsUpdate = true;
  const textures = {
    albedo: arrayTex(albP, LAYERS, THREE.LinearMipmapLinearFilter),
    normal: nrmP ? arrayTex(nrmP, LAYERS, THREE.LinearMipmapLinearFilter) : flatNormals(),
    spec: spcP ? arrayTex(spcP, LAYERS, THREE.LinearMipmapLinearFilter) : flatNormals(),
    manifest, moon: moonTex, sun: sunTex, endSky: endSkyTexture(),
  };

  status('Starting the renderer…', 0.5);
  const canvas = $('#c');
  const rs = options.get('renderScale');
  const renderer = new Renderer(canvas, textures, Object.assign({}, QP, { renderDist: RD, scale: +(params.get('scale') || (rs !== 'auto' ? rs : QP.scale)),
    brightness: options.get('brightness'), clouds: options.get('clouds') }));
  for (const t of [textures.albedo, textures.normal, textures.spec]) if (t.pieces) uploadArray(renderer.r, t);
  dimArt.upload(renderer.r, textures);
  if (packTex && packTex.size) alb = applyPackTextures(renderer.r, textures, manifest, packTex, alb);
  renderer.colours = colours;
  alb = dimArt.extendStrip(alb);
  const overlay = new Overlay(renderer.U, manifest);
  renderer.overlay = overlay;
  const fit = () => { renderer.resize(window.innerWidth, window.innerHeight); gui.resize(); };

  /* ---- the menus, and everything they ask of the game ---- */
  let game = null;                  // the world being played
  let menu = null;                  // the world turning behind the title screen
  let loading = null;               // { text, progress, chunks } while a world loads
  const hooks = {
    play: (entry, o) => startGame(entry, o && o.isNew),
    deleteWorld: w => { EntityStore.remove(w.id); return Save.remove(w.id); },
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

  // chat, over everything (js/ui/chat.js) and the commands typed into it (js/commands.js)
  const chat = new Chat();
  gui.overlays.push(chat);
  // /give offers every item and block by name
  setItemNames(() => ITEMS.filter(Boolean).map(it => it.name).concat(BLOCKS.filter(d => d && d.name && d.item !== false).map(d => d.name)));

  /* ---- item icons for the inventory and the hotbar (made a few at a time) ---- */
  const icons = new ItemIcons(alb, { grassMap: grass, foliageMap: foliage, extra: itemStrip.bmp });
  setLayerPixels(icons.px);          // flat items in the hand and on the ground get their thickness from these

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
    menu = { world, x: spawn.x + 0.5, z: spawn.z + 0.5, y: null, yaw: Math.PI * 0.75, seed, generator: 'classic' };
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
    const st = isNew ? null : save.readState();
    // the dimension you were in, and a save of its own for each (js/dims.js)
    const dim = st && st.dimension && DIMS[st.dimension] ? st.dimension : 'overworld';
    const saves = { overworld: save, the_nether: new Save(entry.id + DIMS.the_nether.suffix), the_end: new Save(entry.id + DIMS.the_end.suffix) };
    await saves.the_nether.init(); await saves.the_end.init();
    const edits = isNew ? new Map() : await saves[dim].loadEdits();
    let world;
    const generator = entry.generator === 'vanilla' ? 'vanilla' : 'classic';
    const seed = worldSeed(entry);
    if (menu && menu.seed === seed && menu.generator === generator && (menu.world.dim || 'overworld') === dim) {
      // the title screen's world is this one: keep what is already made
      world = menu.world;
      world.adoptEdits(edits, saves[dim]);
    } else {
      if (menu) dropWorld(menu.world);
      world = new World({
        seed, generator, dim, renderDist: RD, manifest, colours, fastLeaves: !!QP.fastLeaves, edits, save: saves[dim],
        onMesh: (cx, cz, mesh) => renderer.setColumn(cx, cz, mesh),
        onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
      });
      await world.ready;
    }
    menu = null;
    world.renderDist = RD;
    const spawn = st && st.spawn ? st.spawn : (entry.spawn || (dim === 'overworld' ? await findSpawn(world) : { x: 0, z: 0 }));
    const at = st && st.player ? st.player : null;
    const cx = at ? at.x : spawn.x, cz = at ? at.z : spawn.z;
    // wait for the ground round where you will stand
    await waitGround(world, cx, cz);
    const player = new Player(world);
    if (at) {
      player.pos.set(at.x, at.y, at.z); player.yaw = at.yaw || 0; player.pitch = at.pitch || 0; player.flying = !!at.flying;
    } else {
      const gy = groundY(world, spawn.x, spawn.z);
      player.pos.set(spawn.x + 0.5, gy > 0 ? gy : 120, spawn.z + 0.5);
      player.yaw = Math.PI * 0.75;
    }
    player.prev.copy(player.pos);
    // the game mode you were in when you left (a /gamemode lasts), or the world's own
    const want = st && st.mode ? st.mode : entry.mode;
    const mode = ['creative', 'adventure', 'spectator'].includes(want) ? want : 'survival';
    player.canFly = mode === 'creative' || mode === 'spectator';
    player.noclip = mode === 'spectator';
    if (mode === 'spectator') player.flying = true;
    const fluids = new Fluids(world, (x, y, z, kind) => {
      if (kind === 1 && Math.random() < 0.3) renderer.inter.splash(x + 0.5, z + 0.5, 0.35, 1.5);
    });
    const inv = new Inventory({ mode: mode === 'creative' ? 'creative' : 'survival' });
    if (st && st.inventory) inv.fromJSON(st.inventory);
    else if (mode === 'creative') {
      // a new creative world starts with a few blocks to hand (the rest are under E)
      ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'oak_stairs', 'oak_door', 'lantern']
        .forEach((n, i) => { if (B[n] !== undefined) inv.slots[i] = { id: B[n], count: 1 }; });
      inv.changed();
    }
    const survival = new Survival();
    if (st && st.survival) survival.fromJSON(st.survival);
    survival.inv = inv;
    player.voidY = DIMS[dim].minY;
    // what the hands do with items: mining, drops, eating, opening things (hands.js); its world's parts come from attach()
    const hands = new Hands({ world, player, inv, survival, drops: null, containers: null, fluids, gui, icons, mode, renderer, inter: null, open: s => openScreen(s) });
    if (st && st.hands) hands.fromJSON(st.hands);
    const inter = new Interactor({
      world, player, fluids, renderer, overlay,
      hand: hands.adapter(renderer),
      onSplash: (x, z) => renderer.inter.splash(x, z, 0.8, 2.0),
    });
    inter.creative = mode === 'creative';
    inter.adventure = mode === 'adventure' || mode === 'spectator';
    // block pieces when something breaks, and chips while mining
    if (!renderer.particles) renderer.particles = new Particles(renderer, world);
    else renderer.particles.setWorld(world);
    inter.onBreak = (x, y, z, b, boxes) => renderer.particles.blockBreak(x, y, z, b, boxes);
    inter.onHit = (x, y, z, face, b, box) => renderer.particles.blockHit(x, y, z, face, b, box);
    hands.inter = inter;
    inv.on('drop', s => hands.throwStack(s));
    // picking things up: into the inventory, experience into the bar (Mending repairs first)
    const collector = {
      inv, get alive() { return !survival.dead; },
      addXp: n => survival.addXp(n),
      mendingRepair: n => hands.mend(n),
    };
    game = { entry, world, player, fluids, inv, survival, inter, save, saves, dim, mode, spawn, time: st && st.time !== undefined ? st.time : 1500, saveT: 0, hands, collector };
    /* The things that live in one world, one dimension: items lying about and
       experience orbs (drops.js), chests and furnaces (containers.js), mobs,
       boats and arrows (js/entities), the world simulating itself (sim/sim.js).
       Made here for the world you start in, and again for the new one each
       time you change dimension (travel); the ones you leave are kept for when
       you come back (mobs and chests in that dimension's own save). */
    game.attach = async (w, fl, d, first) => {
      const g = game;
      if (g.partsDim) {
        g.dimKeep = g.dimKeep || {};
        g.dimKeep[g.partsDim] = { drops: g.drops.toJSON(), sim: g.sim ? g.sim.toJSON() : null };
        if (g.containers.dirty) { g.containers.dirty = false; await g.saves[g.partsDim].writeExtra('containers', g.containers.toJSON()); }
        EntityStore.save(entityKey(g.entry, g.partsDim), g.entities.toJSON());
        g.drops.dispose(); if (g.drops.group.parent) g.drops.group.parent.remove(g.drops.group);
        g.entities.dispose();
        g.sim.dispose();
      }
      const keep = (g.dimKeep && g.dimKeep[d]) || first || {};
      const drops = new Drops(w, renderer);
      renderer.scene.add(drops.group);
      if (keep.drops) drops.fromJSON(keep.drops);
      const containers = new Containers(w);
      if (!isNew || g.partsDim) { try { const c = await g.saves[d].readExtra('containers'); if (c) containers.fromJSON(c); } catch (e) {} }
      const entities = new Entities({ world: w, player, inv, survival, renderer, options, mode: g.mode, fluids: fl,
        hooks: { time: () => game ? game.time : 6000, onSplash: (x, z, s) => renderer.inter.splash(x, z, s, 2.0), spawnPoint: () => game && game.spawn,
          // what mobs drop goes through the items (drops.js): things on the ground, orbs of experience
          dropItem: (ww, x, y, z, name, n) => dropItem(ww, x, y, z, name, n), giveXp: (n, x, y, z) => giveXp(x, y, z, n),
          // what is in the hands, and its wear from hits, blocking and shearing (hands.js)
          itemName: id => itemName(id), damageHeld: (n, kind) => hands.wearHeld(n, kind), fillBucket: name => hands.fillHeld(name) } });
      entities.fromJSON(isNew && !g.partsDim ? null : await EntityStore.load(entityKey(g.entry, d)));
      renderer.scene.add(entities.group);
      const sim = new Sim({ world: w, fluids: fl, player, inv, renderer, gui, game: g });
      if (keep.sim) sim.fromJSON(keep.sim);
      Object.assign(g, { drops, containers, entities, sim });
      g.partsDim = d;
      Object.assign(hands, { world: w, drops, containers, fluids: fl });
      containers.drops = drops;
      inter.entities = entities; entities.inter = inter; inter.sim = sim;
      if (renderer.particles) renderer.particles.setWorld(w);
    };
    await game.attach(world, fluids, dim, { drops: st && st.drops, sim: st && st.sim });
    // portals, the End and its dragon (js/dim/realms.js)
    const realms = new Realms({
      game: () => game, renderer, travel, spawnPoint: w => spawnPoint(w),
      give: (id, n) => inv.add(id, n),
    });
    realms.fromJSON(st && st.realms);
    game.realms = realms;
    realms.entered();
    inter.onUse = (h, id) => game.realms.use(h, id);
    inter.onUseAir = id => game.realms.useAir(id);
    inter.onAttack = target => game.realms.attack(game.eye || player.view(0).eye, target);
    inter.onBroken = (x, y, z, b) => game.realms.broken(x, y, z, b);
    hud = new Hud(inv, icons);
    gui.hud = hud;
    inv.on('held', id => renderer.setHeld(id, DRAW));
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
  function held() { if (game) renderer.setHeld(game.inv.heldId(), DRAW); }
  // a screen opened from the world (a chest, a crafting table): the mouse is let go without the game menu
  function openScreen(screen) {
    if (!game) return;
    wantInv = true;
    for (const k in game.player.keys) game.player.keys[k] = false;
    game.inter.up(0); game.inter.up(2);
    if (document.pointerLockElement) document.exitPointerLock();
    gui.open(screen);
  }
  // wait for the ground round (cx, cz) to be made and drawn, showing it on the loading screen
  function waitGround(world, cx, cz) {
    return new Promise(res => {
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
        if (loading) { loading.progress = meshed / need; loading.chunks = ch; }
        gui.markDirty();
        if (meshed >= need || performance.now() - t0 > 60000) res(); else setTimeout(wait, 50);
      };
      wait();
    });
  }
  // where the world spawn puts you, on the ground
  function spawnPoint(world) {
    const g = game, gy = groundY(world, g.spawn.x, g.spawn.z);
    return { x: g.spawn.x + 0.5, y: gy > 0 ? gy : 120, z: g.spawn.z + 0.5 };
  }
  /* Going to another dimension (or far within one): the loading screen, what
     changed saved, the old world's meshes and workers let go, the new one's
     World made with its own generator and save, the ground round `near`
     loaded, then resolve(world) says where to stand ({ x, y, z, yaw }) and
     you are put there with no speed. Inventory, health and the rest stay. */
  let travelling = false;
  async function travel(dim, resolve, near) {
    const g = game;
    if (!g || travelling) return false;
    travelling = true;
    try {
      if (document.pointerLockElement) document.exitPointerLock();
      for (const k in g.player.keys) g.player.keys[k] = false;
      loading = { text: 'Loading terrain...', progress: 0, chunks: [] };
      gui.open(new LoadingScreen());
      await saveGame();
      let world = g.world;
      if (dim !== g.dim) {
        dropWorld(g.world);
        const save = g.saves[dim];
        const edits = await save.loadEdits();
        world = new World({
          seed: worldSeed(g.entry), generator: g.entry.generator === 'vanilla' ? 'vanilla' : 'classic', dim,
          renderDist: renderer.opts.renderDist || RD, manifest, colours, fastLeaves: !!QP.fastLeaves, edits, save,
          onMesh: (cx, cz, mesh) => renderer.setColumn(cx, cz, mesh),
          onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
        });
        await world.ready;
        g.world = world; g.dim = dim;
        g.player.w = world; g.inter.world = world;
        g.fluids = new Fluids(world, (x, y, z, kind) => { if (kind === 1 && Math.random() < 0.3) renderer.inter.splash(x + 0.5, z + 0.5, 0.35, 1.5); });
        g.inter.fluids = g.fluids;
        g.player.voidY = DIMS[dim].minY;
        // the items, chests, mobs and simulation of the new dimension
        await g.attach(world, g.fluids, dim);
        g.realms.entered();
      }
      await waitGround(world, near.x, near.z);
      const pos = await resolve(world);
      if (pos) {
        if (Math.hypot(pos.x - near.x, pos.z - near.z) > 24) await waitGround(world, pos.x, pos.z);
        const P = g.player;
        P.pos.set(pos.x, pos.y, pos.z); P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0;
        if (pos.yaw !== undefined) P.yaw = pos.yaw;
      }
      world.flush();
      return !!pos;
    } finally {
      loading = null;
      travelling = false;
      if (game === g) { gui.closeAll(); lock(); }
    }
  }
  function dropWorld(world) {
    for (const k of [...renderer.columns.keys()]) { const [x, z] = k.split(',').map(Number); renderer.dropColumn(x, z); }
    if (renderer.uploads) renderer.uploads.clear();
    world.destroy();
  }
  function stateOf() {
    const g = game, p = g.player;
    return { player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying }, time: g.time,
      inventory: g.inv.toJSON ? g.inv.toJSON() : null, survival: g.survival.toJSON(), spawn: g.spawn, mode: g.mode,
      drops: g.drops.toJSON(), hands: g.hands.toJSON(), sim: g.sim ? g.sim.toJSON() : null, dimension: g.dim, realms: g.realms ? g.realms.toJSON() : null };
  }
  async function saveGame() {
    if (!game) return;
    game.save.writeState(stateOf());
    if (game.containers.dirty) { game.containers.dirty = false; game.saves[game.dim].writeExtra('containers', game.containers.toJSON()); }
    if (game.entities) EntityStore.save(entityKey(game.entry, game.dim), game.entities.toJSON());
    // the world's changes go to its own dimension's save
    await game.saves[game.dim].flush(game.world.edits);
  }
  async function quitToTitle() {
    if (!game) return;
    const g = game;
    await saveGame();
    g.drops.dispose();
    game = null;
    if (g.entities) g.entities.dispose();
    if (g.sim) g.sim.dispose();
    if (g.realms) g.realms.dispose();
    if (document.pointerLockElement) document.exitPointerLock();
    // the world you left keeps turning behind the title screen
    menu = { world: g.world, x: g.player.pos.x, z: g.player.pos.z, y: null, yaw: g.player.yaw, seed: worldSeed(g.entry), generator: g.world.generator };
    g.world.save = null;
    overlay.set(0, 0, 0, null, -1);
    if (hud) { hud.dispose(); hud = null; gui.hud = null; }
    chat.lines.length = 0; chat.dirty = true;
    if (renderer.particles) renderer.particles.list.length = 0;
    gui.inGame = false; gui.panorama = true;
    gui.setRoot(new TitleScreen());
  }
  async function respawn() {
    if (!game) return;
    const g = game;
    if (g.entities) g.entities.dismount();
    g.survival.reset();
    g.spilled = false;
    // a charged respawn anchor in the Nether, else the world spawn, in whichever dimension that is
    const plan = g.realms.respawnPlan();
    if (plan.dim === 'the_nether') {
      const ok = await travel('the_nether', w => g.realms.anchorSpot(w), plan.anchor);
      if (ok) return;
    }
    if (g.dim !== 'overworld') { await travel('overworld', w => spawnPoint(w), g.spawn); return; }
    const gy = groundY(g.world, g.spawn.x, g.spawn.z);
    g.player.pos.set(g.spawn.x + 0.5, gy > 0 ? gy : 120, g.spawn.z + 0.5);
    g.player.prev.copy(g.player.pos); g.player.vel.set(0, 0, 0);
    lock();
  }
  window.addEventListener('pagehide', () => { saveGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

  /* ---- input ---- */
  const locked = () => document.pointerLockElement === canvas;
  /* Taking the mouse back. Chrome refuses for about a second after Esc let
     it go, and a second request while one is pending fails too, so: one at a
     time, held back until that second has passed, and if it still fails the
     game menu comes back so a click on Back to Game can try again. */
  let unlockedAt = -1e9, lockPending = false;
  function lockFailed() { if (game && !locked() && !gui.isOpen() && !game.survival.dead) gui.open(new PauseScreen()); }
  function lock() {
    if (!game || locked() || lockPending) return;
    lockPending = true;
    setTimeout(() => {
      lockPending = false;
      if (!game || locked() || gui.isOpen()) return;
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(lockFailed); } catch (e) { lockFailed(); }
    }, Math.max(0, 1100 - (performance.now() - unlockedAt)));
  }
  document.addEventListener('pointerlockerror', lockFailed);
  canvas.addEventListener('click', () => { if (game && !gui.isOpen()) lock(); });
  let wantInv = false;
  /* ---- chat and commands ---- */
  function setMode(m) {
    const g = game;
    g.mode = m;
    const p = g.player;
    p.canFly = m === 'creative' || m === 'spectator';
    p.noclip = m === 'spectator';
    if (m === 'spectator') p.flying = true; else if (!p.canFly) p.flying = false;
    g.inv.setMode(m === 'creative' ? 'creative' : 'survival');
    if (g.entities) g.entities.mode = m;           // mobs leave a creative or spectating player alone
    g.inter.creative = m === 'creative';
    g.inter.adventure = m === 'adventure' || m === 'spectator';
    if (m === 'survival' || m === 'adventure') hud.setStats(g.survival.stats()); else hud.setStats(null);
    hud.markDirty();
  }
  const chatCtx = () => {
    const g = game;
    return {
      game: g, playerName: 'Player',
      // Allow Commands: as set when the world was made (creative worlds have it on unless turned off)
      cheats: !!(window.__lc2.cheats || (g.entry.cheats !== undefined ? g.entry.cheats : g.entry.mode === 'creative')),
      say: (t, c) => chat.add(t, c),
      setMode,
      teleport: (x, y, z) => { const p = g.player; p.pos.set(x, y, z); p.prev.copy(p.pos); p.vel.set(0, 0, 0); p.fallDistance = 0; },
      give: (name, count) => {
        // any item or block by its name (items.js knows both)
        const id = itemId(name) || (B[name] !== undefined && BLOCKS[B[name]] && BLOCKS[B[name]].item !== false ? B[name] : 0);
        if (!id) return null;
        g.inv.add(id, count);
        return itemDisplay(id) || displayName(id);
      },
      clearInventory: name => {
        let n = 0;
        const want = name ? B[name] : undefined;
        const take = (arr) => { for (let i = 0; i < arr.length; i++) { const s = arr[i]; if (s && (want === undefined || s.id === want)) { n += s.count || 1; arr[i] = null; } } };
        take(g.inv.slots); if (g.inv.armor) take(g.inv.armor);
        if (g.inv.offhand && (want === undefined || g.inv.offhand.id === want)) { n += g.inv.offhand.count || 1; g.inv.offhand = null; }
        g.inv.changed();
        return n;
      },
      kill: () => { if (g.mode === 'survival' || g.mode === 'adventure') g.survival.hurt(1e9); else respawn(); },
      seed: () => g.entry.seed,
      blockChanged: () => {},
      setWeather: (w, ticks) => { g.weather = { kind: w, ticks: ticks === null ? 6000 + Math.floor(Math.random() * 12000) : ticks }; },
      setDifficulty: d => { g.entry.difficulty = d; Worlds.update(g.entry.id, { difficulty: d }); },
      dimension: () => g.dimension || 'overworld',
      xp: null,
    };
  };
  function openChat(start) {
    wantInv = true;
    for (const k in game.player.keys) game.player.keys[k] = false;
    if (document.pointerLockElement) document.exitPointerLock();
    gui.open(new ChatScreen(chat, chatCtx, start));
  }
  document.addEventListener('pointerlockchange', () => {
    if (locked()) return;
    unlockedAt = performance.now();
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
  let showDebug = false, f3Held = false, f3Combo = false, timeRuns = true, autoScale = options.get('renderScale') === 'auto' && !params.get('scale');
  document.addEventListener('keydown', e => {
    if (!game || gui.isOpen()) return;
    const a = bindingOf(e.code);
    // F3 opens the debug screen when it is let go, unless a key was pressed with it (F3 + H: advanced tooltips)
    if (a === 'debug' || e.code === 'F3') { if (!e.repeat) { f3Held = true; f3Combo = false; } e.preventDefault(); return; }
    if (f3Held && e.code === 'KeyH') {
      f3Combo = true;
      const v = !options.get('advancedTooltips');
      options.set('advancedTooltips', v);
      chat.add('§e§l[Debug]:§r Advanced tooltips: ' + (v ? 'shown' : 'hidden'));
      e.preventDefault(); return;
    }
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
    // chat: T, or / with the slash already typed
    if ((a === 'chat' || (!a && e.code === 'KeyT')) && !e.repeat) { e.preventDefault(); openChat(''); return; }
    if ((a === 'command' || e.key === '/') && !e.repeat) { e.preventDefault(); openChat('/'); return; }
    if (a && a.startsWith('hotbar')) { game.inv.select(+a.slice(6) - 1); return; }
    // Q throws one of the selected stack (Ctrl+Q all of it), F swaps it with the off hand
    if (a === 'drop') { game.hands.dropSelected(e.ctrlKey || e.metaKey); e.preventDefault(); return; }
    if (a === 'swapOffhand') { const inv = game.inv, t = inv.slots[inv.selected]; inv.slots[inv.selected] = inv.offhand; inv.offhand = t; inv.changed(); e.preventDefault(); return; }
    if (e.code === 'BracketLeft') game.time -= 1000;
    if (e.code === 'BracketRight') game.time += 1000;
    if (e.code === 'KeyP' && !a) timeRuns = !timeRuns;
    if (e.code === 'KeyB' && !a && game.mode === 'creative' && game.entities) game.entities.placeBoatAtCrosshair();
    if (a && MOVE[a]) { game.player.setKey(MOVE[a], true); e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    if (!game) return;
    const a = bindingOf(e.code);
    if (a === 'debug' || e.code === 'F3') { if (f3Held && !f3Combo && !gui.isOpen()) { showDebug = !showDebug; if (!showDebug && hud) hud.setDebug(null); } f3Held = false; return; }
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
    if (k === 'renderDistance' && v) { if (game) game.world.renderDist = v; renderer.opts.renderDist = v; }
    if (k === 'brightness') renderer.opts.brightness = v;
    if (k === 'clouds') renderer.opts.clouds = v;
    if (k === 'renderScale') { autoScale = v === 'auto'; if (v !== 'auto') { renderer.opts.scale = +v; fit(); } }
    if (k === 'skin') setSkin(v === 'default' ? new URL('../textures/skin/default.png?v=10', import.meta.url).href : v);
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
    if (game && !travelling) playFrame(now, dt);
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
      biome: BIOMES[w.biomeAt(Math.floor(eyeV.x), Math.floor(eyeV.z))], dim: DIMS[w.dim || 'overworld'],
    }, dt);
  }
  function playFrame(now, dt) {
    const g = game, { world, player, fluids, inter, survival } = g;
    acc += dt;
    while (acc >= 0.05) {
      acc -= 0.05;
      // riding: the keys go to the vehicle instead (js/entities)
      if (!(g.entities && g.entities.rideTick())) player.tick();
      fluids.step();
      g.sim.tick();
      inter.tick();
      if (renderer.particles) renderer.particles.tick();
      g.hands.tick();
      g.containers.tick();
      if (g.entities) g.entities.tick();
      g.realms.tick();
      if (g.mode === 'survival' || g.mode === 'adventure') {
        player.canSprint = survival.canSprint();
        player.effects = survival.effects;
        survival.tick(player);
        if (survival.dead && !g.spilled) { g.spilled = true; g.hands.spillAll(); }
        if (survival.dead && !gui.isOpen()) {
          if (document.pointerLockElement) document.exitPointerLock();
          gui.open(new DeathScreen());
        }
      }
      g.drops.tick(player, g.collector);
      if (timeRuns) g.time += 1;
      for (const s of player.splashes.splice(0)) renderer.inter.splash(s[0], s[1], s[2], s[3]);
      structures.spawners.tick(world, player);
      // every ten seconds, what changed goes into the browser's storage
      if (++g.saveT >= 200) { g.saveT = 0; saveGame(); }
    }
    const alpha = acc / 0.05;
    world.update(player.pos.x, player.pos.z);
    world.flush();
    const v = player.view(alpha);
    inter.look(v.eye);
    g.hands.alpha = alpha;
    g.drops.update(dt, alpha, player, renderer.camera);
    if (g.entities) g.entities.render(alpha);
    g.eye = v.eye;
    // the other dimensions have no sun: Detailed's sky tables are left at midnight there
    const D = DIMS[g.dim];
    sunAt(D.fixedTime !== null ? 18000 : g.time);
    g.realms.frame(alpha, dt);
    const boss = g.realms.boss;
    if ((boss ? boss.progress : -1) !== (hud.boss ? hud.boss.progress : -1)) { hud.boss = boss ? Object.assign({}, boss) : null; hud.markDirty(); }
    const eyeBlock = world.get(Math.floor(v.eye.x), Math.floor(v.eye.y), Math.floor(v.eye.z));
    const onGrass = player.onGround && !player.flying;
    renderer.render({
      time: (g.time + alpha) / 20, sunDir, moonDir, feet: v.feet, eye: v.eye, yaw: player.yaw, pitch: player.pitch,
      fov: player.fov, eyeInWater: FLUID[eyeBlock] === 1 || player.eyeInWater, skyAtEye: skyAt(world, v.eye),
      moonPhase: Math.floor(g.time / 24000) % 8, trample: onGrass ? 1 : 0, showHand: !gui.hideHud, bob: g.hands.handBob(v.handBob),
      waterTint: tintAt(world, v.eye), player, alpha,
      biome: BIOMES[world.biomeAt(Math.floor(v.eye.x), Math.floor(v.eye.z))], eyeInLava: FLUID[eyeBlock] === 2,
      dim: D, bossFog: g.realms.bossFog,
    }, dt);
    if (g.mode === 'survival' || g.mode === 'adventure') hud.setStats(survival.stats());
    // no crosshair in third person, or with the HUD hidden
    const cross = renderer.avatar.view === 0 && !gui.hideHud;
    if (hud.crosshair !== cross) { hud.crosshair = cross; hud.markDirty(); }
    // the attack indicator under it (js/entities)
    if (g.entities) { const at = g.entities.cooldown(); if (Math.floor(at * 17) !== Math.floor((hud.attack === null || hud.attack === undefined ? 1 : hud.attack) * 17)) { hud.attack = at; hud.markDirty(); } }
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
      // keep it smooth: give up resolution before frame rate, and take it back when there is room
      if (autoScale && now - startedAt > 6000 && ++scaleTick % 4 === 0) {
        const s = renderer.opts.scale;
        // never so low it blurs: three quarters of the screen, or half of a very sharp one
        const floor = (renderer.dpr || 1) > 1.4 ? 0.5 : 0.75;
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
        'Biome: ' + (bn ? bn.name : '?') + ' (' + g.dim + ')',
        'Day ' + Math.floor(g.time / 24000) + ', time ' + (g.time % 24000) + (timeRuns ? '' : ' (stopped)'),
        g.mode !== 'creative' ? 'Food ' + survival.food + ', saturation ' + survival.saturation.toFixed(1) + ', exhaustion ' + survival.exhaustion.toFixed(3) : '',
      ], [
        'Render ' + renderer.rw + 'x' + renderer.rh + ' (F7 scale)',
        'Distance ' + world.renderDist + ', graphics ' + QNAME,
        'Seed ' + worldSeed(g.entry) + (g.world.generator === 'vanilla' ? '' : ' (classic)'),
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
  // structures: /locate, strongholds for eyes of ender, chest loot, spawners (struct/spawners.js)
  const structures = structuresApi(() => (game ? game.world : menu && menu.world), () => game && game.player);
  // /locate structure <kind>: the game's search and its reply
  register('locate', {
    usage: 'structure <structure>',
    suggest: i => i === 0 ? ['structure'] : ['village', 'stronghold', 'fortress', 'mineshaft', 'monument', 'mansion', 'desert_pyramid', 'jungle_pyramid', 'swamp_hut', 'igloo', 'pillager_outpost', 'shipwreck', 'ocean_ruin', 'ruined_portal', 'buried_treasure', 'ancient_city', 'trial_chambers', 'bastion_remnant', 'end_city', 'trail_ruins'],
    run(args, ctx) {
      const kind = (args[0] === 'structure' ? args[1] : args[0] || '').replace(/^minecraft:/, '');
      if (!kind) throw new Error('Incomplete command');
      const p = ctx.game.player, x = Math.floor(p.pos.x), z = Math.floor(p.pos.z);
      structures.locate(kind, x, z).then(f => {
        if (!f) { ctx.say(`Could not find a structure of type "${kind}" nearby`, 0xFF5555); return; }
        const fx = f.x !== undefined ? f.x : f.bx !== undefined ? f.bx : f[0], fz = f.z !== undefined ? f.z : f.bz !== undefined ? f.bz : f[1];
        ctx.say(`The nearest minecraft:${f.type || kind} is at [${fx}, ~, ${fz}] (${Math.round(Math.hypot(fx - x, fz - z))} blocks away)`);
      }, e => ctx.say(`Could not find a structure of type "${kind}" nearby`, 0xFF5555));
    },
  });
  requestAnimationFrame(loop);
  window.__lc2 = {
    structures,
    renderer, gui, options, B, BLOCKS,
    get game() { return game; }, get world() { return game ? game.world : menu && menu.world; }, get player() { return game && game.player; },
    get fluids() { return game && game.fluids; }, get inv() { return game && game.inv; }, hud, chat, cheats: false,
    command: line => { if (!game) return false; const ctx = chatCtx(); ctx.cheats = true; return import('./commands.js?v=10').then(m => m.execute(line, ctx)); },
    get drops() { return game && game.drops; }, get containers() { return game && game.containers; }, get hands() { return game && game.hands; },
    get survival() { return game && game.survival; },
    get entities() { return game && game.entities; },
    get sim() { return game && game.sim; },
    get time() { return game ? game.time : menuTime; }, set time(t) { if (game) game.time = t; else menuTime = t; },
    // a test world without the menus; generator 'vanilla' (the default) or 'classic'
    play: (seed, mode, generator = 'vanilla') => startGame(Worlds.add({
      id: 'w' + Date.now().toString(36), name: 'Test World', folder: 'Test World',
      seed: generator === 'vanilla' ? parseSeed(seed == null ? '' : String(seed)) : (seed || MENU_SEED), generator,
      mode: mode || 'creative', created: Date.now(), lastPlayed: Date.now() }), true),
    get realms() { return game && game.realms; }, DIMS, travel: (dim, resolve, near) => travel(dim, resolve, near),
    isLeaf: b => !BLOCKS[b] || BLOCKS[b].leaves || BLOCKS[b].log || !BLOCKS[b].solid,
  };
  // after a quality change, straight back into the world you were in
  let resume = null;
  try { resume = sessionStorage.getItem('lc2_resume'); sessionStorage.removeItem('lc2_resume'); } catch (e) {}
  if (resume) { const w = Worlds.get(resume); if (w) startGame(w, false); }
}

boot().catch(e => { console.error(e); status('Something went wrong: ' + (e && e.message)); });
