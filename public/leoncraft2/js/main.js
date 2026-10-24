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
   creative), Shift sneak, Ctrl or R sprint, C zoom, E inventory, Q or F5 the view, 1-9
   and the wheel for the hotbar, left click mine, right click place or use,
   middle click pick block, F1 hide the HUD, F3 details, [ and ] the clock,
   F7 render scale, F8 quality.
--------------------------------------------------------------------------- */
import { B, BLOCKS, resolveTextures, FLUID } from './blocks.js?v=107';
import { BIOMES, biomeColours } from './biomes.js?v=107';
import { searchSpawn } from './spawn.js?v=107';
import { parseSeed } from './gen/random.js?v=107';
import { World, startWorkers, practise } from './world.js?v=107';
import { Fluids } from './fluids.js?v=107';
import { Player } from './player.js?v=107';
import { Renderer } from './render/renderer.js?v=107';
import { Overlay } from './render/overlay.js?v=107';
import { setSkin, setSkinPart, setCape, useDefaultSkin } from './render/avatar.js?v=107';
import { Packs, resolver, blockTextures, guiSheets, logoArt, skinUrl, colormaps, composedTextures, itemStripFrom } from './ui/pack.js?v=107';
import { SEA, Y0 } from './world-const.js?v=107';
import { Gui, Options, lowEndDevice } from './ui/gui.js?v=107';
import { TitleScreen, PauseScreen, LoadingScreen, DeathScreen, ConfirmScreen, Worlds, setLogoArt, seedFrom } from './ui/menus.js?v=107';
import { Account } from './net/account.js?v=107';
import { LoginScreen } from './ui/account.js?v=107';
import { ItemIcons } from './ui/icons.js?v=107';
import { Inventory, inventoryScreen } from './ui/inventory.js?v=107';
import { Hud } from './ui/hud.js?v=107';
import { Interactor } from './interact.js?v=107';
import { QuickBlocks } from './quickblocks.js?v=107';
import { MAPS, isFilledMap } from './maps.js?v=107';
import { Save } from './save.js?v=107';
import { Chat, ChatScreen } from './ui/chat.js?v=107';
import { displayName, setItemNames, register, gameRule, execute } from './commands.js?v=107';
import { applyModeRules, ModeKeys } from './modes.js?v=107';
import { Particles } from './render/particles.js?v=107';
import { DRAW, setItemLayers, ITEMS, itemId, displayName as itemDisplay, itemName } from './items.js?v=107';
import { loadItemStrip, addItemPieces } from './itemtex.js?v=107';
import { setLayerPixels } from './render/blockmesh.js?v=107';
import { EntityStore } from './entities/store.js?v=107';
import { paintSome, primeAtlas } from './entities/mobart.js?v=107';
import { DIMS } from './dims.js?v=107';
import { addDimArt, endSkyTexture } from './dim/art.js?v=107';
import { VideoSettings } from './settings.js?v=107';
import { pickBiome } from './worldgen.js?v=107';
import { initSound, soundWorld, soundParts, soundTick, soundFrame, soundLeave } from './sound/game.js?v=107';
import { loadEntityArt } from './entities/packart.js?v=107';
import { ITEM_TEX } from './itemdata.js?v=107';
import { debugLines, F3_HELP } from './ui/debug.js?v=107';
import { Spin } from './render/screenfx.js?v=107';
import { Minimap } from './ui/minimap.js?v=107';
const THREE = window.THREE;
/* The game's own parts (js/parts.js: mobs, the simulation, the dimensions, the hands, advancements,
   statistics, the server code...) are not wanted by the title screen: they are loaded once it is up
   (loadParts), so a first visit loads 91 modules (about 600 KB) less before it. Each name below is
   the module's own, filled in when they come. */
let enchantDebug, Survival, survivalHooks, respawnPlayer, respawnSpot, Drops, dropItem, giveXp, Containers, Hands, Entities, Sim, Realms,
  structuresApi, Details, isSign, SignEditScreen, tickDials, dialInHotbar, setUse, deathPoint, setDeathPoint,
  MultiplayerScreen, DisconnectedScreen, ReconnectScreen, rejoin, advInit, advWorld, advParts, advTick, advState, advLeave, openAdvancements,
  statsWorld, statsTick, statsState, statsQuit, statsLeave, openStatistics, recipesWorld, recipesTick, recipesState, recipesLeave;
/* They come down all at once, as one import of parts.js would bring them, but run one line of parts.js
   at a time, in its order, with a frame drawn after any line that took a while: in one import the 91
   modules ran as a single long task while the title screen turned. (Each line imported in turn, the
   download became a chain of round trips, seconds long on a slow line.) Run in parts.js's order, every
   module runs in just the order one import of parts.js would run it. PART_STEPS is parts.js's own
   list; a line added there goes here too, in the same place (one only added there still loads, with
   parts.js at the end). */
const PART_STEPS = ['./enchanting.js?v=107', './survival.js?v=107', './life.js?v=107', './drops.js?v=107', './containers.js?v=107',
  './hands.js?v=107', './entities/manager.js?v=107', './sim/sim.js?v=107', './dim/realms.js?v=107', './struct/spawners.js?v=107',
  './details.js?v=107', './ui/sign.js?v=107', './dials.js?v=107', './ui/multiplayer.js?v=107', './adv/game.js?v=107',
  './stats.js?v=107', './recipes.js?v=107'];
// the next frame drawn (a page in the background draws none, and waits for nothing)
const breath = () => document.hidden ? Promise.resolve() : new Promise(res => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  requestAnimationFrame(go); setTimeout(go, 50);
});
const FETCHED = 'lc2: fetched, not run';
const script = src => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
async function importParts(tries) {
  const last = './parts.js?v=107' + (tries ? '&retry=' + tries : '');
  /* Everything down and linked first, nothing run: a module that imports them all, after one that
     throws. A module graph stops running at its first error, so the rest are left linked and waiting
     for the imports below. (Any other error is a real one: a module that could not be had.) */
  const stop = script('throw ' + JSON.stringify(FETCHED) + ';');
  const all = script([stop, ...PART_STEPS, last].map(s => 'import ' + JSON.stringify(new URL(s, import.meta.url).href) + ';').join('\n'));
  try { await import(all); } catch (e) { if (e !== FETCHED) throw e; } finally { URL.revokeObjectURL(stop); URL.revokeObjectURL(all); }
  let t = performance.now();
  for (const s of PART_STEPS) {
    await import(s);
    if (performance.now() - t > 4) { await breath(); t = performance.now(); }
  }
  return import(last);
}
/* If they cannot be had (the line dropped while they came down), they are asked for again, twice, a
   second or two apart, and then forgotten, so whatever wants them next asks afresh, and if that fails too
   it says so and offers a reload (partsFailed). Chrome keeps a module's failed download for the life of
   the page, failing the same address again at once without asking: parts.js is asked for under a new
   address each time, and a module under it that failed comes back only with a reload. */
let partsP = null;
const loadParts = () => partsP || (partsP = (async () => {
  for (let tries = 0; ; tries++) {
    try {
      const m = await importParts(tries);
      ({ enchantDebug, Survival, survivalHooks, respawnPlayer, respawnSpot, Drops, dropItem, giveXp, Containers, Hands, Entities, Sim, Realms,
        structuresApi, Details, isSign, SignEditScreen, tickDials, dialInHotbar, setUse, deathPoint, setDeathPoint,
        MultiplayerScreen, DisconnectedScreen, ReconnectScreen, rejoin, advInit, advWorld, advParts, advTick, advState, advLeave, openAdvancements,
        statsWorld, statsTick, statsState, statsQuit, statsLeave, openStatistics, recipesWorld, recipesTick, recipesState, recipesLeave } = m);
      return;
    } catch (e) {
      console.warn('the game\'s parts did not load (try ' + (tries + 1) + ')', e);
      if (tries >= 2) { partsP = null; throw e; }
      await new Promise(r => setTimeout(r, 1000 * (tries + 1)));
    }
  }
})());

const $ = s => document.querySelector(s);
const status = (t, f) => { const el = $('#status'); if (el) el.textContent = t; const b = $('#bar'); if (b && f !== undefined) b.style.width = Math.round(f * 100) + '%'; };
const params = new URLSearchParams(location.search);
const MK = n => performance.mark('lc2:' + n); // TEMPMARK
const MENU_SEED = 20261002;
// a world's seed as its generator wants it: the vanilla one takes the whole
// 64-bit seed (a decimal string), the first generator a 32-bit number
// a dimension's mobs are kept under the world's id, with the dimension added for the Nether and the End
const entityKey = (entry, dim) => entry.id + (!dim || dim === 'overworld' ? '' : '~' + dim);
const worldSeed = entry => (entry.generator === 'vanilla' ? String(entry.seed) : entry.seed | 0);
// the generator a world is made by: 'vanilla', a Superflat world's own 'flat:...' (gen/flat.js), else the first one
const genOf = entry => (entry.generator === 'vanilla' || /^flat:/.test(entry.generator || '') ? entry.generator : 'classic');
/* How the game looks is in Options: Video Settings (the game's own) and Shader
   Packs (Shaders ON, with the Shader Options, or OFF: the game as Minecraft
   itself draws it, render/vanilla.js). settings.js puts every change into
   effect at once, while you play; nothing is loaded again. */
// software rendering (no graphics chip at all) starts with no shaders; everything else with them
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
// ?q=: a Shaders level for this visit (tests), whatever was chosen: off low medium high rip, or fast (Off) and detailed (Medium)
const qParam = params.get('q');
if (qParam) options.data.shaderLevel = { fast: 'off', potato: 'off', detailed: 'medium', ultra: 'high' }[qParam] || qParam;
const video = new VideoSettings(options, guessGraphics() !== 'fast');
const LOOK = video.look();
const QNAME = () => video.shadersOn() ? 'shaders ' + video.level() : 'no shaders';
const RD = +(params.get('rd') || options.get('renderDistance') || 8);

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
async function strip(url, layers, keep) {
  const blob = await (await fetch(url)).blob();
  const full = await createImageBitmap(blob, RAW);
  const parts = [];
  for (let z = 0; z < layers; z += PIECE) {
    const n = Math.min(PIECE, layers - z);
    parts.push([z, n, await createImageBitmap(full, 0, z * 16, 16, n * 16, RAW)]);
  }
  // keep: the whole strip is wanted too (the albedo, for the item icons), so it is decoded only once
  if (keep) parts.full = full; else if (full.close) full.close();
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
    if (d.leaves || d.shape === 'cross' || d.shape === 'fire') for (const l of d.faces) soft.add(l);
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
  // read back on the CPU: a canvas the graphics card holds can stall a second while the card starts up
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height).data;
}

/* somewhere good to start (spawn.js), asking the world's workers; ?at=x,z puts you there instead */
const atParam = () => (params.get('at') ? params.get('at').split(',').map(Number) : null);
const atXZ = () => { const a = atParam(); return a ? { x: a[0], z: a[1] } : null; };
async function findSpawn(world) {
  const want = atParam();
  if (want) return { x: want[0], z: want[1] };
  // (the columns practice already asked about, while the world was being chosen, are not asked again: world.js practise)
  const known = world.surfacesAhead;
  return searchSpawn(m => { const r = known && known.get(m.x + ',' + m.z + ',' + (m.withBiome ? 1 : 0)); return r ? Promise.resolve(r) : world.ask(m); });
}
/* Where you stand at the world's spawn, as the game finds it (its
   getOverworldRespawnPos and fudgeSpawnLocation): down a column from its
   top to the first block with a full top (a tree's leaves or log count: you
   may be put on a tree, never inside one), no spot over a fluid, with two
   blocks free to stand in; the nearest such column out to 10 blocks from
   the spawn. Was the ground under the trees, which put you inside a trunk
   in a forest, crawling. */
function standY(world, x, z) {
  for (let y = 383; y > 0; y--) {
    const b = world.get(x, y, z);
    if (!b) continue;
    const d = BLOCKS[b];
    if (d.fluid) return -1;
    if (d.solid && d.shape === 'cube') return y + 1;
  }
  return -1;
}
function spawnSpot(world, x, z) {
  const free = (xx, yy, zz) => { const b = world.get(xx, yy, zz); return !b || !BLOCKS[b].solid; };
  for (let r = 0; r <= 10; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const y = standY(world, x + dx, z + dz);
    if (y > 0 && free(x + dx, y, z + dz) && free(x + dx, y + 1, z + dz)) return { x: x + dx, y, z: z + dz };
  }
  return null;
}
// the ground itself at a column, not the top of a tree
function groundY(world, x, z) {
  for (let y = 383; y > 0; y--) { const b = world.get(x, y, z); if (b && BLOCKS[b].solid && !BLOCKS[b].leaves && !BLOCKS[b].log) return y + 1; }
  return -1;
}

async function boot() {
  // the workers' code loads and compiles while the textures do (world.js)
  startWorkers();
  let game = null;                  // the world being played
  let menu = null;                  // the world turning behind the title screen
  let menuStart = null;             // that world being started (makeMenu)
  let loading = null;               // { text, progress, chunks } while a world loads
  /* After a graphics or resource pack change the page loads again straight
     back into the world you were in: no title world is made for it. */
  let resumeTo = null, resumeMp = null;
  try { const id = sessionStorage.getItem('lc2_resume'); sessionStorage.removeItem('lc2_resume'); if (id) { resumeTo = Worlds.get(id); if (!resumeTo && id.startsWith('mp-')) resumeMp = id.slice(3); } } catch (e) {}
  let rendererUp = false;           // the title's world is started before the renderer exists (makeMenu)
  const early = new Map();          // "cx,cz" -> [cx, cz, mesh] made before the renderer was
  status('Loading textures…', 0.05);
  const base = new URL('../textures/', import.meta.url).href;
  // stamped like the code, so a rebuilt texture set always reaches the browser
  const TEX_V = '?v=107';
  /* Everything is asked for at once. The title's world needs only the
     texture list and the two colour maps, so it starts being made as soon
     as those are in (makeMenu), while the big textures, the renderer and the
     menus load. */
  const manifestP = fetch(base + 'manifest.json' + TEX_V).then(r => r.json());
  // decoded off the main thread (an Image drawn to a canvas is decoded on it, and that can wait a second behind the big textures)
  const mapsP = Promise.all(['colormap_grass.png', 'colormap_foliage.png'].map(f => fetch(base + f + TEX_V).then(r => r.blob()).then(b => createImageBitmap(b))));
  const imgsP = Promise.all(['environment_moon_phases.png', 'environment_sun.png'].map(f => loadImg(base + f + TEX_V)));
  // resource packs the player opened from their own computer (ui/pack.js): theirs first, ours underneath
  const packsP = Packs.active().catch(e => { console.warn('resource packs', e); return []; });
  const manifest = await manifestP;
  MK('manifest');
  // normal maps only for a look that starts with them (a third of the download; render/looks.js fetches them later
  // if they are turned on); the material map always, so the shaders can be turned on at any time
  const withNormals = !!LOOK.normals;
  const stripsP = Promise.all(['terrain_albedo.png', withNormals ? 'terrain_normal.png' : null, 'terrain_spec.png']
    .map((f, i) => f ? strip(base + f + TEX_V, manifest.layers, i === 0) : null));
  // the pictures of the items that are not blocks, after the last block layer (itemtex.js)
  const itemStripP = loadItemStrip(base, TEX_V);
  // our own art for the Nether and the End (the portal swirl, the frame's eye, item icons) on extra layers
  const dimArt = addDimArt(manifest);
  resolveTextures(manifest);
  let [grass, foliage] = await mapsP;
  MK('maps');
  const packs = await packsP;
  // the paintings (ours, and a pack's) and a pack's mob skins, into the mobs' atlas (entities/packart.js)
  const entityArtP = loadEntityArt(base, TEX_V, packs).catch(e => console.warn('entity art', e));
  let colours = null;
  if (!packs.length) { colours = biomeColours(pixels(grass), pixels(foliage)); if (!resumeTo) menuStart = makeMenu(MENU_SEED); }
  /* The renderer is made now (once the title's world is started), with stand-ins for the three texture arrays, so
     that its shaders are built (warmUp) while the big textures come down and
     are decoded: three.js builds a program from the material alone. The
     arrays take the stand-ins' places below, before anything is drawn. On a
     first visit the shaders took the best part of a second to build, started
     only once every texture was in, and the title waited for them. */
  const [moon, sunImg] = await imgsP;
  const moonTex = new THREE.Texture(moon);
  moonTex.magFilter = THREE.NearestFilter; moonTex.minFilter = THREE.NearestFilter; moonTex.needsUpdate = true;
  const sunTex = new THREE.Texture(sunImg);
  sunTex.magFilter = THREE.NearestFilter; sunTex.minFilter = THREE.NearestFilter; sunTex.generateMipmaps = false; sunTex.needsUpdate = true;
  const textures = { albedo: flatNormals(), normal: flatNormals(), spec: flatNormals(), manifest, moon: moonTex, sun: sunTex, endSky: endSkyTexture() };
  MK('preRenderer');
  status('Starting the renderer…', 0.2);
  const canvas = $('#c');
  const rs = options.get('renderScale');
  const renderer = new Renderer(canvas, textures, Object.assign({}, LOOK, { renderDist: RD, scale: +(params.get('scale') || (rs !== 'auto' ? rs : 1)),
    brightness: options.get('brightness'), clouds: options.get('clouds') }));
  const overlay = new Overlay(renderer.U, manifest);
  renderer.overlay = overlay;
  // every shader set compiling now, in the background, so the title's first frame does not stop to build them
  const shadersBuilt = renderer.warmUp();
  MK('renderer');
  const [albP, nrmP, spcP] = await stripsP;
  MK('strips');
  const itemStrip = await itemStripP;
  MK('itemStrip');
  // a pack's item pictures over ours, before they go to the graphics card and the inventory
  if (packs.length) { try { const s = await itemStripFrom(resolver(packs), itemStrip, ITEM_TEX); if (s) itemStrip.bmp = s; } catch (e) { console.warn('resource pack items', e); } }
  const LAYERS = manifest.layers + await addItemPieces(itemStrip, manifest.layers, albP, nrmP, spcP);
  setItemLayers(manifest.layers);
  let find = null, packTex = null;
  try {
    if (packs.length) {
      status('Loading resource packs…', 0.3);
      find = resolver(packs);
      const cm = await colormaps(find);
      if (cm.grass) grass = cm.grass;
      if (cm.foliage) foliage = cm.foliage;
      packTex = await blockTextures(find, manifest);
      // chests, beds, shulker boxes and heads, cut from the pack's entity pictures
      for (const [k, v] of await composedTextures(find)) packTex.set(k, v);
    }
  } catch (e) { console.warn('resource packs', e); find = null; packTex = null; }
  await entityArtP;
  if (!colours) colours = biomeColours(pixels(grass), pixels(foliage));
  let alb = albP.full;
  // the arrays, in the stand-ins' places
  textures.albedo = arrayTex(albP, LAYERS, THREE.LinearMipmapLinearFilter);
  textures.normal = nrmP ? arrayTex(nrmP, LAYERS, THREE.LinearMipmapLinearFilter) : flatNormals();
  textures.spec = spcP ? arrayTex(spcP, LAYERS, THREE.LinearMipmapLinearFilter) : flatNormals();
  for (const t of [textures.albedo, textures.normal, textures.spec]) if (t.pieces) uploadArray(renderer.r, t);
  renderer.U.uAlbedo.value = textures.albedo; renderer.U.uNormalMap.value = textures.normal; renderer.U.uSpecMap.value = textures.spec;
  // (the shaders' table of what each texture is made of reads the material map: render/materials.js layerMatMaterial)
  const lm = renderer.layerMatMat;
  if (lm) { lm.uniforms.uSpecMap.value = textures.spec; lm.uniforms.uLayers.value = textures.spec.image ? textures.spec.image.depth : 0; }
  dimArt.upload(renderer.r, textures, alb);
  if (packTex && packTex.size) alb = applyPackTextures(renderer.r, textures, manifest, packTex, alb);
  renderer.colours = colours;
  alb = dimArt.extendStrip(alb);
  MK('textures');
  const fit = () => { renderer.resize(window.innerWidth, window.innerHeight); gui.resize(); };

  /* ---- the menus, and everything they ask of the game ---- */
  const hooks = {
    play: (entry, o) => startGame(entry, o && o.isNew),
    // Create New World: the seed it uses when left blank, and the world it would make, started ahead
    nextSeed: generator => nextSeed(generator),
    prepare: spec => prepareNew(spec),
    deleteWorld: w => { EntityStore.remove(w.id); return Save.remove(w.id); },
    quitToTitle: () => quitToTitle(),
    resume: () => lock(),
    // whether Esc in the game menu can take the mouse back (see keyMayLock)
    keyResumes: () => keyMayLock(),
    respawn: () => respawn(),
    // a hardcore death: back, as a spectator for good
    spectate: () => { if (!game) return; game.entry.mode = 'spectator'; Worlds.update(game.entry.id, { mode: 'spectator' }); respawn().then(() => setMode('spectator')); },
    // Open to LAN (ui/lan.js): the world's mode and commands, and starting it
    lan: () => game ? { mode: game.entry.mode || 'survival', cheats: chatCtx().cheats, open: !!game.lan } : null,
    startLan: (mode, cheats, port) => {
      gui.closeAll(); lock();
      game.lan = { cheats };
      if (mode !== game.mode) setMode(mode);
      chat.add('Local game hosted on port ' + port);
    },
    loadingProgress: () => loading || { text: 'Loading terrain...', progress: 0 },
    quit: () => { location.href = '/'; },
    // Done on the resource pack screen after a change: load everything again, back into the same world
    reloadResources: () => {
      saveGame().then(() => { try { sessionStorage.setItem('lc2_resume', game ? game.entry.id : ''); } catch (e) {} location.reload(); });
    },
    // (Video Settings and Shader Packs take effect as they change: settings.js)
    applyGraphics: () => {},
    shadersOn: () => video.shadersOn(),
    // the server list (ui/multiplayer.js), and whether the world being played is on a server (the game menu's Disconnect)
    multiplayer: () => parts().then(() => gui.open(new MultiplayerScreen()), () => partsFailed()),
    online: () => !!(game && game.net),
    // the last screen closed in the game: take the mouse back
    closed: () => { if (game && !game.survival.dead) lock(); },
    // the game menu's Advancements button (js/adv) and Statistics (js/stats.js)
    advancements: () => openAdvancements(),
    statistics: () => openStatistics(gui, icons),
  };
  const gui = new Gui($('#gui'), { base: base + 'gui/', options, hooks, version: TEX_V });
  // the minimap (ui/minimap.js): its own small canvas under the GUI's, drawn each frame you play
  const minimap = new Minimap(gui, options);
  // its block colours: each top face picture's mean, from the strip as loaded (a resource pack's too), with the biome tints
  minimap.textures(alb, renderer.colours);
  await gui.load();
  MK('gui');
  // music and sound (js/sound)
  initSound(options, gui);
  if (find) {
    try {
      await gui.loadSheet('container/creative_inventory/tabs').catch(() => null);
      const sheets = await guiSheets(find, { widgets: gui.sheets.get('widgets'), icons: gui.sheets.get('icons'), tabs: gui.sheets.get('container/creative_inventory/tabs'), load: n => gui.loadSheet(n) });
      for (const k in sheets) gui.setSheet(k, sheets[k]);
      setLogoArt(await logoArt(find));
      const sk = await skinUrl(find);
      if (sk) useDefaultSkin(sk);
    } catch (e) { console.warn('resource pack GUI', e); }
  }
  // Video Settings and Shader Packs, from now on put into effect as they change (settings.js)
  video.attach({ renderer, gui, normalsUrl: base + 'terrain_normal.png' + TEX_V, blockLayers: manifest.layers, packed: !!(packTex && packTex.size) });
  video.worldsFn = () => [game && game.world, menu && menu.world];
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
  /* The game's parts (loadParts), and the setting up they need from here: the advancements' toast,
     screen and /advancement (js/adv), and the structures' questions (struct/spawners.js). Asked for
     as soon as the title is up; a world waits for them only once its ground is made. */
  let partsUp = null, structures = null;
  const parts = () => partsUp || (partsUp = loadParts().then(() => {
    advInit({ gui, chat, icons, options, name: () => (game && game.net ? game.net.name : Account.name || 'Player') });
    // structures: /locate, strongholds for eyes of ender, chest loot, spawners (struct/spawners.js)
    structures = structuresApi(() => (game ? game.world : menu && menu.world), () => game && game.player);
    if (window.__lc2) window.__lc2.structures = structures;
    // (the mobs' modules add pictures of their own as they load: painted in the title's idle time too)
    paintIdle();
  }, e => { partsUp = null; throw e; }));
  /* The game's parts could not be had (loadParts): say so, and offer the reload that brings them,
     straight back into the world or server being opened (resume, as lc2_resume takes it). Over the
     loading screen of a world (inWorld) both buttons reload: the world is half made. */
  function partsFailed(resume, inWorld) {
    const s = new ConfirmScreen('Could not load the game', 'Part of the game did not download: the connection may have dropped. Reload the page to try again.',
      'Reload', inWorld ? 'Title Screen' : 'Back', yes => {
        if (!yes && !inWorld) { gui.back(); return; }
        try { if (yes && resume) sessionStorage.setItem('lc2_resume', resume); } catch (e) {}
        location.reload();
      });
    if (inWorld) gui.setRoot(s); else gui.open(s);
  }

  let hud = null;                   // the hotbar, hearts and F3, made per world (js/ui/hud.js)

  /* ---- the world behind the title screen ----
     Started (makeMenu) the moment the colours are known, while the big
     textures, the renderer and the menus are still loading: its chunks are
     read back or made meanwhile, and its meshes wait here until the
     renderer is up. Then startMenu waits for the ground round it. */
  async function makeMenu(seed) {
    const world = new World({
      seed, renderDist: Math.min(RD, 6), manifest, colours, ...video.worldOpts(),
      onMesh: (cx, cz, mesh, urgent) => { if (rendererUp) renderer.setColumn(cx, cz, mesh, urgent); else early.set(cx + ',' + cz, [cx, cz, mesh]); },
      onDrop: (cx, cz) => { if (rendererUp) renderer.dropColumn(cx, cz); else early.delete(cx + ',' + cz); },
    });
    world.allHands = true;            // nothing is ever edited in it: every worker makes it
    world.focus = 3;                  // and nothing further than the ground the title opens on, until that is drawn (startMenu)
    await world.ready;
    MK('menuReady');
    // the title's world stands in the same place every visit: found once, then remembered
    const K = 'lc2_menu_at', V = TEX_V + '|' + seed;
    let spawn = null;
    try { const c = JSON.parse(localStorage.getItem(K) || 'null'); if (c && c.v === V && !params.get('at')) spawn = c; } catch (e) {}
    // (where findSpawn puts the usual title world, worked out once: a first visit need not search 1807 columns for it;
    // index.html starts the workers on the chunks round it, so a change to MENU_SEED or this spot goes there too)
    if (!spawn && seed === MENU_SEED && !params.get('at')) spawn = { x: 1101, z: 771 };
    if (!spawn) { spawn = await findSpawn(world); try { localStorage.setItem(K, JSON.stringify({ v: V, x: spawn.x, z: spawn.z })); } catch (e) {} }
    MK('menuSpawn');
    menu = { world, x: spawn.x + 0.5, z: spawn.z + 0.5, y: null, yaw: Math.PI * 0.75, seed, generator: 'classic' };
    // kept going until startMenu takes over
    const pump = () => { if (rendererUp || !menu || menu.world !== world) return; world.update(menu.x, menu.z); setTimeout(pump, 16); };
    pump();
  }
  async function startMenu(seed) {
    await (menuStart || (menuStart = makeMenu(seed)));
    const world = menu.world;
    rendererUp = true;
    for (const [cx, cz, mesh] of early.values()) renderer.setColumn(cx, cz, mesh);
    early.clear();
    // the ground round it first, so the title never opens on an empty sky (focus, from makeMenu)
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
        if (meshed >= need || performance.now() - t0 > 30000) { world.focus = -1; res(); } else setTimeout(wait, 16);
      };
      wait();
    });
  }
  /* While you are in the menus, the workers practise on the world you are
     most likely to open next: the last one played, where you left it, or a
     new one when there is none. Its code is compiled and fast, and the
     ground under you partly made, before you press Singleplayer (world.js). */
  /* The seed a blank Create New World will use, drawn the first time it is
     wanted (the title's practice, the Create World screen) and kept until a
     world is made with it, so the world practised on is the one you get. */
  const rolled = {};
  const nextSeed = generator => (generator in rolled ? rolled[generator] : (rolled[generator] = generator === 'classic' ? seedFrom('') : parseSeed('')));
  // the Create World screen's seed and world type, made ahead while you choose (world.js practise)
  function prepareNew(spec) {
    if (game) return;
    practise({ seed: spec.seed, generator: spec.generator, dim: 'overworld', at: atXZ(), manifest, colours }, menu && menu.world);
  }
  function practiseNext() {
    // no world yet: the one a blank Create New World will make, found where it starts you; else that one after the last world played
    const fresh = { seed: nextSeed('vanilla'), generator: 'vanilla', dim: 'overworld', at: atXZ(), manifest, colours };
    let spec = fresh;
    try {
      const last = Worlds.list().sort((a, b) => (b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0))[0];
      const st = last ? new Save(last.id).readState() : null;
      const at = st && st.player ? st.player : last && last.spawn;
      if (at) spec = { seed: worldSeed(last), generator: genOf(last), dim: st && DIMS[st.dimension] ? st.dimension : 'overworld', at, manifest, colours };
    } catch (e) { /* the world list unreadable: practise on a new world */ }
    practise(spec, menu && menu.world, spec === fresh ? null : fresh);
  }
  /* The mobs' pictures (entities/mobart.js), painted a few at a time when
     the page has nothing else to do: in the menus, and on a loading screen
     between the workers' answers, so no frame and no chunk waits on them. */
  let paintLoop = false;
  function paintIdle() {
    if (paintLoop) return;
    paintLoop = true;
    // (a page never idle, the title's world drawing every frame, still gets a slice every 50 ms)
    const later = () => (window.requestIdleCallback ? requestIdleCallback(step, { timeout: 50 }) : setTimeout(step, 30));
    const step = d => { if (paintSome(d && !d.didTimeout ? Math.min(8, Math.max(3, d.timeRemaining() - 1)) : 8)) paintLoop = false; else later(); };
    later();
  }

  if (!resumeTo) {
    status('Building the world…', 0.7);
    await startMenu(MENU_SEED);
    MK('menuGround');
    // (the workers on the next world at once: the wait below is the graphics card's alone)
    practiseNext();
    // and the shaders done, so the title does not freeze on its first frame (never more than a few seconds)
    await Promise.race([shadersBuilt, new Promise(r => setTimeout(r, 4000))]);
    status('Building the world…', 1);
  }
  MK('title');
  $('#loading').hidden = true;
  // the game's own parts, from now on (a world opened straight from a reload asks for them itself;
  // if they fail, whatever wants them next says so)
  if (!resumeTo) parts().catch(() => {});
  gui.panorama = !resumeTo;
  // straight back into a world (below): its loading screen, with no title world or practice in the way
  if (!resumeTo) { gui.setRoot(new TitleScreen()); paintIdle(); }
  /* Your account (net/account.js): the session kept in this browser is checked
     with the server; with none, or one it no longer takes, the login screen
     comes up over the title before anything can be played (ui/account.js).
     With no answer, a kept session stands for singleplayer. */
  Account.check().then(ok => {
    if (ok || resumeTo || resumeMp) return;
    const top = gui.screen;
    if (top && top.constructor === TitleScreen) gui.open(new LoginScreen(null));
  });

  /* ---- playing a world ---- */
  async function startGame(entry, isNew) {
    loading = { text: 'Loading terrain...', progress: 0, chunks: [] };
    gui.setRoot(new LoadingScreen());
    const partsDone = parts();
    partsDone.catch(() => {});        // (waited for below, once the ground is made)
    // the mobs' pictures painted (what is left of them) while the workers make the ground, not after
    paintIdle();
    // on a server its changes come from the server, and only your own record stays in this browser (net/net.js)
    // a blank seed drawn ahead is used once: the next new world draws another
    if (isNew && rolled[entry.generator] === entry.seed) delete rolled[entry.generator];
    const mkSave = id => (entry.mp ? entry.mp.save(id) : new Save(id));
    const save = mkSave(entry.id);
    await save.init();
    const st = isNew ? null : save.readState();
    // the dimension you were in, and a save of its own for each (js/dims.js)
    const dim = st && st.dimension && DIMS[st.dimension] ? st.dimension : 'overworld';
    const saves = { overworld: save, the_nether: mkSave(entry.id + DIMS.the_nether.suffix), the_end: mkSave(entry.id + DIMS.the_end.suffix) };
    await saves.the_nether.init(); await saves.the_end.init();
    let world;
    const generator = genOf(entry);
    const seed = worldSeed(entry);
    // the title screen's world is this one: keep what is already made
    // (a world brought over from the first Leoncraft is made apart from any other of its seed: entry.lc1, lc1/mixed.js)
    const reuse = menu && menu.seed === seed && menu.generator === generator && (menu.world.dim || 'overworld') === dim && entry.structures !== false
      && ((menu.world.lc1 && menu.world.lc1.key) || '') === ((entry.lc1 && entry.lc1.key) || '');
    if (!reuse) {
      // made at once, so the workers set up its generator while what changed in it is read
      if (menu) dropWorld(menu.world);
      world = new World({
        seed, generator, dim, structures: entry.structures !== false, lc1: entry.lc1 || null, renderDist: renderer.opts.renderDist || RD, manifest, colours, ...video.worldOpts(), edits: new Map(), save: saves[dim], fresh: !!isNew,
        onMesh: (cx, cz, mesh, urgent) => renderer.setColumn(cx, cz, mesh, urgent),
        onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
      });
    }
    await Promise.all([save.init(), saves.the_nether.init(), saves.the_end.init()]);
    MK('sgSaves');
    const edits = isNew ? new Map() : await saves[dim].loadEdits();
    MK('sgEdits');
    if (reuse) { world = menu.world; world.adoptEdits(edits, saves[dim]); }
    else { world.edits = edits; await world.ready; }
    MK('sgWorldReady');
    menu = null;
    // (the render distance as it is now: RD is what it was when the page opened, before any change in Video Settings)
    world.renderDist = renderer.opts.renderDist || RD;
    // (a new world's spawn was usually found ahead, while the Create World screen was open)
    const spawn = st && st.spawn ? st.spawn : (entry.spawn || (dim === 'overworld' ? world.spawnAhead || await findSpawn(world) : { x: 0, z: 0 }));
    // where you last died in this world, for the recovery compass (js/dials.js)
    MK('sgSpawn');
    const at = st && st.player ? st.player : null;
    const cx = at ? at.x : spawn.x, cz = at ? at.z : spawn.z;
    /* Wait for the ground round where you will stand: the nine chunks round
       you made (where you stand is found in them), and then the one you stand
       in drawn. The world is put together and its first frames played (below)
       while that last mesh is still being made, not after it. */
    let made;
    const madeP = new Promise(res => { made = res; });
    const groundP = waitGround(world, cx, cz, false, made);
    await madeP;
    MK('sgMade');
    // (the game's parts: asked for when this began, and almost always in long before)
    try { await partsDone; } catch (e) { partsFailed(entry.id, true); return; }
    setDeathPoint(st && st.lastDeath);
    const player = new Player(world);
    if (at) {
      player.pos.set(at.x, at.y, at.z); player.yaw = at.yaw || 0; player.pitch = at.pitch || 0; player.flying = !!at.flying;
    } else {
      const s = spawnSpot(world, spawn.x, spawn.z), gy = groundY(world, spawn.x, spawn.z);
      if (s) player.pos.set(s.x + 0.5, s.y, s.z + 0.5); else player.pos.set(spawn.x + 0.5, gy > 0 ? gy : 120, spawn.z + 0.5);
      player.yaw = Math.PI * 0.75;
    }
    player.prev.copy(player.pos);
    // the game mode you were in when you left (a /gamemode lasts), or the world's own
    const want = st && st.mode ? st.mode : entry.mode;
    const mode = ['creative', 'adventure', 'spectator'].includes(want) ? want : 'survival';
    player.canFly = mode === 'creative' || mode === 'spectator';
    player.noclip = mode === 'spectator';
    if (mode === 'spectator') player.flying = true;
    // (water settling or spreading sends out no rings: the game has none, and in a lake or the sea they
    // came up as circles out of nowhere wherever the water evened itself out; splashes come from things falling in)
    const fluids = new Fluids(world);
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
    // difficulty, game rules, rain, the death message and the totem (life.js); the world's difficulty is the option's
    survival.hooks = survivalHooks(() => game, { options, chat, renderer });
    if (entry.difficulty && options.get('difficulty') !== entry.difficulty) options.set('difficulty', entry.difficulty);
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
    inter.spectator = mode === 'spectator';
    // (a saved inventory carries the mode it was saved in: the world's mode is the one that counts)
    inv.mode = mode === 'creative' ? 'creative' : 'survival';
    // block pieces when something breaks, and chips while mining
    if (!renderer.particles) renderer.particles = new Particles(renderer, world);
    else renderer.particles.setWorld(world);
    inter.onBreak = (x, y, z, b, boxes) => renderer.particles.blockBreak(x, y, z, b, boxes);
    inter.onHit = (x, y, z, face, b, box) => renderer.particles.blockHit(x, y, z, face, b, box);
    hands.inter = inter;
    inv.on('drop', s => hands.throwStack(s));
    // picking things up: into the inventory, experience into the bar (Mending repairs first)
    const collector = {
      // (a spectator picks nothing up)
      inv, get alive() { return !survival.dead && !(game && game.mode === 'spectator'); },
      addXp: n => survival.addXp(n),
      mendingRepair: n => hands.mend(n),
    };
    game = { entry, world, player, fluids, inv, survival, inter, save, saves, dim, mode, spawn, time: st && st.time !== undefined ? st.time : 1500, saveT: 0, hands, collector,
      // your /sethome homes in this world (commands.js; on a server the server keeps them)
      homes: st && st.homes && typeof st.homes === 'object' && !Array.isArray(st.homes) ? st.homes : {} };
    // FOV, FOV Effects and View Bobbing as set in Options, from the first frame
    applyOptions();
    // the world's maps (js/maps.js), kept with the Overworld's save
    MAPS.open(saves.overworld, isNew);
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
        if (g.details) { if (g.details.dirty) { g.details.dirty = false; await g.saves[g.partsDim].writeExtra('details', g.details.toJSON()); } g.details.dispose(); }
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
          itemName: id => itemName(id), damageHeld: (n, kind) => hands.wearHeld(n, kind), fillBucket: name => hands.fillHeld(name), trade: v => hands.trade(v),
          // screens and spilled stacks (a chest boat's chest)
          hands,
          // the dragon from a spawn egg flies with the End's own (dim/realms.js); commands, for a command block minecart
          realms: () => game && game.realms, commandCtx: () => (game ? chatCtx() : null) } });
      entities.fromJSON(isNew && !g.partsDim ? null : await EntityStore.load(entityKey(g.entry, d)));
      renderer.scene.add(entities.group);
      const sim = new Sim({ world: w, fluids: fl, player, inv, renderer, gui, game: g });
      if (keep.sim) sim.fromJSON(keep.sim);
      // sign text and the food on campfires (details.js)
      const details = new Details({ world: w, drops, renderer, gui });
      if (!isNew || g.partsDim) { try { const dd = await g.saves[d].readExtra('details'); if (dd) details.fromJSON(dd); } catch (e) {} }
      details.showAll();
      details.onEdit = (x, y, z, front) => editSign(x, y, z, front);
      details.creative = () => !!(game && game.mode === 'creative');
      details.entities = () => game && game.entities;
      inter.onPunch = hit => !!(game && game.details && game.details.punch(hit.x, hit.y, hit.z));
      details.daylight = () => { const t = (((game ? game.time : 6000) % 24000) + 24000) % 24000; return Math.min(1, Math.max(0.2, 0.5 + 2 * Math.cos(2 * Math.PI * (t / 24000 - 0.25)))); };
      Object.assign(g, { drops, containers, entities, sim, details });
      hands.details = details;
      g.partsDim = d;
      Object.assign(hands, { world: w, drops, containers, fluids: fl });
      containers.drops = drops;
      // hoppers and droppers fill and empty chest boats (js/entities)
      containers.entityAt = (x, y, z) => entities.containerAt(x, y, z);
      inter.entities = entities; entities.inter = inter; inter.sim = sim;
      // blocks put down drawn at once, before their column's new mesh comes (quickblocks.js)
      if (g.quick) g.quick.dispose();
      g.quick = w.quick = new QuickBlocks(renderer, w);
      if (renderer.particles) renderer.particles.setWorld(w);
      soundParts(g);
      advParts(g);
    };
    MK('sgPreAttach');
    await game.attach(world, fluids, dim, { drops: st && st.drops, sim: st && st.sim });
    // portals, the End and its dragon (js/dim/realms.js)
    const realms = new Realms({
      game: () => game, renderer, travel, spawnPoint: w => spawnPoint(w),
      // standing in a portal: the workers start on the other side (its generator, the ground where you come out: world.js practise)
      ahead: (dim, near) => { if (game && !game.net) practise({ seed: worldSeed(game.entry), generator: genOf(game.entry), dim, at: near, manifest, colours }, game.world); },
      give: (id, n) => inv.add(id, n),
      // the player's hit on the dragon or a crystal, by the combat rules (combat/combat.js)
      attackDamage: () => (game && game.entities ? game.entities.combat.strikeDamage() : 1),
    });
    realms.fromJSON(st && st.realms);
    game.realms = realms;
    realms.entered();
    inter.onUse = (h, id) => game.realms.use(h, id);
    inter.onUseAir = id => game.realms.useAir(id);
    inter.onAttack = target => game.realms.attack(game.eye || player.view(0).eye, target);
    inter.onBroken = (x, y, z, b) => game.realms.broken(x, y, z, b);
    soundWorld(game); soundParts(game);
    advWorld(game, st && st.advancements);
    statsWorld(game, st && st.stats); recipesWorld(game, st && st.recipes);
    hud = new Hud(inv, icons);
    gui.hud = hud;
    applyModeRules(game, mode, hud);
    // a map in the hand is drawn by the HUD, held up (js/maps.js): the arm shows bare
    inv.on('held', id => renderer.setHeld(isFilledMap(inv.slots[inv.selected]) ? 0 : id, DRAW));
    // the off hand and the armour are read from here; the hand dips with the attack cooldown
    renderer.wearer = { inv, cooldown: () => (game && game.entities ? game.entities.combat.cooldown() : 1) };
    // you in the inventory's black box, looking at the mouse (render/figure.js)
    inv.drawPlayer = (g, x, y, w, h, mx, my) => renderer.figure.draw(g, x, y, w, h, mx, my);
    // and a mount in its own screen (render/mobfigure.js)
    inv.drawMob = (g, x, y, w, h, mx, my, mob, size, drop) => renderer.figure.draw(g, x, y, w, h, mx, my, mob, size, drop);
    held();
    // a new world made with Bonus Chest on (bonus.js)
    if (isNew && entry.bonusChest && dim === 'overworld') import('./bonus.js?v=107').then(m => m.bonusChest(game, Math.floor(spawn.x), Math.floor(spawn.z))).catch(e => console.warn('bonus chest', e));
    Worlds.update(entry.id, { lastPlayed: Date.now(), spawn });
    // (the loading screen stays up over plain dirt for the first frames: below)
    gui.panorama = false;
    // every shader compiled now, not in the first frame that needs it (the first F5, the first drop)
    MK('sgPrePrecompile');
    renderer.precompile();
    MK('sgPrecompile');
    startedAt = performance.now();
    // every shader built now, in the background, not the first time its water, glass or mob comes into view
    renderer.warmUp([game.entities && game.entities.meshes && game.entities.meshes.mat]);
    // only now does the loop play it: until every part (items lying about, mobs, the
    // simulation, the dimensions) is in place, a frame would trip over the missing ones
    game.ready = true;
    MK('sgReady');
    // on a server: the other players, and everything that changes, from now on (net/net.js)
    if (entry.mp) {
      game.net = entry.mp;
      entry.mp.attach(game, { renderer, gui, chat, rule: r => gameRule(game, r), commandCtx: chatCtx,
        setDifficulty: d => { if (game) game.entry.difficulty = d; options.set('difficulty', d); },
        // (lost without a kick, a restart for an update or a dropped line: connecting again by itself, ui/multiplayer.js)
        disconnected: (reason, again) => quitToTitle().then(() => gui.open(again ? new ReconnectScreen(again, reason) : new DisconnectedScreen('Connection Lost', reason))) });
    }
    /* The first two frames are played behind the loading screen: everything in
       them runs for the first time (the browser compiles each part of the game
       as it is first used, the clouds and the like are made), which took a
       tenth of a second a frame and was felt as a stutter the moment the world
       appeared. Hidden here, the world opens on smooth frames. They are
       played while the chunk you stand in is still being drawn, so they
       seldom keep the world waiting: it opens the moment that is done. */
    await new Promise(res => { firstFrames = { left: 2, res }; setTimeout(res, 1500); });
    firstFrames = null;
    await groundP;
    MK('sgGround');
    MK('sgShown');
    loading = null;
    gui.inGame = true;
    gui.closeAll();
    lock();
    // no mouse yet (the click that started this is long gone): the game menu, as when the window loses focus
    setTimeout(() => { if (game && !locked() && !gui.isOpen()) gui.open(new PauseScreen()); }, 600);
  }
  function held() { if (game) renderer.setHeld(isFilledMap(game.inv.slots[game.inv.selected]) ? 0 : game.inv.heldId(), DRAW); }
  // a screen opened from the world (a chest, a crafting table): the mouse is let go without the game menu
  // writing on a sign: the screen with the side's words, then back into the sign (details.js)
  function editSign(x, y, z, front) {
    const g = game;
    if (!g || !g.details) return;
    const b = g.world.get(x, y, z), d = BLOCKS[b];
    if (!isSign(d)) return;
    const side = g.details.textOf(x, y, z, front) || { lines: ['', '', '', ''], colour: 'black' };
    openScreen(new SignEditScreen({ lines: side.lines, layer: d.faces[0], wall: d.shape === 'wall_sign' && !d.hanging, hanging: !!d.hanging,
      colour: 0, done: lines => { if (game === g) g.details.setText(x, y, z, front, lines); } }));
  }
  function openScreen(screen) {
    if (!game) return;
    wantInv = true;
    for (const k in game.player.keys) game.player.keys[k] = false;
    game.inter.up(0); game.inter.up(2);
    letGo();
    gui.open(screen);
  }
  /* Wait for the ground round (cx, cz) to be made and drawn, showing it on
     the loading screen. As in the game, which lets you in once the section
     you stand in is built: the chunk you stand in drawn, the eight round it
     made (so there is ground to stand and walk on); the rest comes in,
     nearest first, while you play. Checked every frame, so you are in the
     moment it is there. wide: the eight round it drawn too, so everything
     within two chunks is made (looking for somewhere to put a portal). */
  function waitGround(world, cx, cz, wide, made) {
    // nothing can be edited yet: the worker kept for edits helps make the ground, and only it is made
    world.allHands = true;
    world.focus = wide ? 2 : 1; world.sched = true;
    return new Promise(res => {
      const t0 = performance.now();
      const wait = () => {
        world.update(cx, cz);
        world.flush();
        renderer.pumpUploads(8);
        const pcx = Math.floor(cx / 16), pcz = Math.floor(cz / 16), ch = [];
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) ch.push([dx, dz, world.stateAt(pcx + dx, pcz + dz)]);
        let drawn = true;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!wide && (dx || dz)) continue;
          const c = world.chunks.get((pcx + dx) + ',' + (pcz + dz));
          if (!c || !c.meshed) drawn = false;
        }
        if (loading) { loading.progress = drawn ? 1 : world.readiness(pcx, pcz); loading.chunks = ch; }
        gui.markDirty();
        // made: told once the chunk you stand in and the eight round it are all made (before it is drawn)
        if (made) {
          let all = true;
          for (let dz = -1; dz <= 1 && all; dz++) for (let dx = -1; dx <= 1; dx++) if (!world.chunks.has((pcx + dx) + ',' + (pcz + dz))) { all = false; break; }
          if (all || drawn || performance.now() - t0 > 60000) { made(); made = null; }
        }
        if (drawn || performance.now() - t0 > 60000) { world.allHands = false; world.focus = -1; world.sched = true; res(); } else setTimeout(wait, 16);
      };
      wait();
    });
  }
  // where the world spawn puts you, on the ground
  function spawnPoint(world) {
    const g = game, s = spawnSpot(world, g.spawn.x, g.spawn.z), gy = groundY(world, g.spawn.x, g.spawn.z);
    return s ? { x: s.x + 0.5, y: s.y, z: s.z + 0.5 } : { x: g.spawn.x + 0.5, y: gy > 0 ? gy : 120, z: g.spawn.z + 0.5 };
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
      letGo();
      for (const k in g.player.keys) g.player.keys[k] = false;
      loading = { text: 'Loading terrain...', progress: 0, chunks: [] };
      gui.open(new LoadingScreen());
      MK('tvStart');
      await saveGame();
      MK('tvSaved');
      let world = g.world;
      if (dim !== g.dim) {
        dropWorld(g.world);
        const save = g.saves[dim];
        // made first, so the workers set up its generator while what changed there is read
        world = new World({
          seed: worldSeed(g.entry), generator: genOf(g.entry), dim, structures: g.entry.structures !== false, lc1: g.entry.lc1 || null,
          renderDist: renderer.opts.renderDist || RD, manifest, colours, ...video.worldOpts(), edits: new Map(), save,
          onMesh: (cx, cz, mesh, urgent) => renderer.setColumn(cx, cz, mesh, urgent),
          onDrop: (cx, cz) => renderer.dropColumn(cx, cz),
        });
        world.edits = await save.loadEdits();
        await world.ready;
        MK('tvWorld');
        // the ground round where you come out asked for now, while the dimension's parts are set up (attach)
        world.allHands = true; world.focus = 2; world.update(near.x, near.z); world.flush();
        g.world = world; g.dim = dim;
        g.player.w = world; g.inter.world = world;
        g.fluids = new Fluids(world);
        g.inter.fluids = g.fluids;
        g.player.voidY = DIMS[dim].minY;
        // the items, chests, mobs and simulation of the new dimension
        await g.attach(world, g.fluids, dim);
        g.realms.entered();
        MK('tvAttach');
      }
      await waitGround(world, near.x, near.z, true);
      MK('tvGround');
      const pos = await resolve(world);
      MK('tvResolved');
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
      drops: g.drops.toJSON(), hands: g.hands.toJSON(), sim: g.sim ? g.sim.toJSON() : null, dimension: g.dim, realms: g.realms ? g.realms.toJSON() : null,
      lastDeath: deathPoint(), advancements: advState(), stats: statsState(), recipes: recipesState(), homes: g.homes || {} };
  }
  async function saveGame() {
    if (!game) return;
    game.save.writeState(stateOf());
    MAPS.save();
    if (game.containers.dirty) { game.containers.dirty = false; game.saves[game.dim].writeExtra('containers', game.containers.toJSON()); }
    if (game.details && game.details.dirty) { game.details.dirty = false; game.saves[game.dim].writeExtra('details', game.details.toJSON()); }
    // (waited for as well: a page reloaded straight after, as Done on the resource packs does, could cut the write off
    // and lose what moved since the last save, a falling block among them)
    const ents = game.entities ? EntityStore.save(entityKey(game.entry, game.dim), game.entities.toJSON()) : null;
    // the world's changes go to its own dimension's save
    await game.saves[game.dim].flush(game.world.edits);
    if (ents) await ents;
  }
  async function quitToTitle() {
    if (!game) return;
    const g = game;
    statsQuit();
    await saveGame();
    if (g.net) { g.net.close(); g.net = null; }
    g.drops.dispose();
    if (g.details) g.details.dispose();
    if (g.quick) { g.quick.dispose(); if (g.world && g.world.quick === g.quick) g.world.quick = null; g.quick = null; }
    scope(false);
    game = null;
    soundLeave();
    advLeave(); statsLeave(); recipesLeave();
    if (g.entities) g.entities.dispose();
    if (g.sim) g.sim.dispose();
    if (g.realms) g.realms.dispose();
    letGo();
    // the world you left keeps turning behind the title screen
    menu = { world: g.world, x: g.player.pos.x, z: g.player.pos.z, y: null, yaw: g.player.yaw, seed: worldSeed(g.entry), generator: g.world.generator };
    g.world.save = null;
    overlay.set(0, 0, 0, null, -1);
    if (hud) { hud.dispose(); hud = null; gui.hud = null; }
    chat.lines.length = 0; chat.dirty = true;
    if (renderer.particles) renderer.particles.list.length = 0;
    gui.inGame = false; gui.panorama = true;
    gui.setRoot(new TitleScreen());
    practiseNext();
  }
  async function respawn() {
    if (!game || game.respawning) return;
    const g = game;
    if (g.entities) g.entities.dismount();
    // full health and food; experience kept only with keepInventory (survival.js)
    g.survival.respawn(gameRule(g, 'keepInventory'));
    g.spilled = false;
    // the player's bed or charged anchor if it still works, else the world spawn (life.js)
    g.respawning = true;
    try { await respawnPlayer(g, travel, { groundY, say: t => { if (g.sim && g.sim.msg) g.sim.msg.show(t); else chat.add(t); } }); }
    finally { g.respawning = false; }
    lock();
  }
  window.addEventListener('pagehide', () => { saveGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

  /* ---- input ---- */
  const locked = () => document.pointerLockElement === canvas;
  /* Taking the mouse back. When the game let it go itself (the inventory, a
     chest, chat, a dimension loading) it is taken back the moment the screen
     closes, as in the game. Only after you let it go (Esc, or the window
     losing it) does Chrome refuse it for a while, 1.25 seconds: then the
     request waits that long. A second request while one is pending fails, so
     one at a time, and if one still fails the game menu comes back so a click
     on Back to Game can try again. Raw Input (Mouse Settings, on by default as
     in the game) asks for the mouse's own movement, with no acceleration. */
  let unlockedAt = -1e9, lockPending = false, letGoOurselves = false, noRaw = false, promised = false;
  // the mouse was last let go by you or the browser, not the game (or never taken): Chrome wants a click for it then
  let userUnlocked = true;
  function letGo() { if (document.pointerLockElement) { letGoOurselves = true; document.exitPointerLock(); } }
  function lockFailed() { lockPending = false; if (game && !locked() && !gui.isOpen() && !game.survival.dead) gui.open(new PauseScreen()); }
  function requestLock() {
    const raw = options.get('rawInput') !== false && !noRaw;
    lockPending = true;
    let p = null;
    try { p = canvas.requestPointerLock(raw ? { unadjustedMovement: true } : undefined); } catch (e) { lockFailed(); return; }
    // an older browser answers with pointerlockchange or pointerlockerror only
    if (!p || !p.then) return;
    promised = true;
    p.then(() => { lockPending = false; }, err => {
      // no raw movement here: the ordinary lock, from now on
      if (raw && err && err.name === 'NotSupportedError') { noRaw = true; requestLock(); return; }
      lockFailed();
    });
  }
  function lock() {
    if (!game || locked() || lockPending) return;
    const wait = Math.max(0, 1300 - (performance.now() - unlockedAt));
    if (!wait) { if (!gui.isOpen()) requestLock(); return; }
    lockPending = true;
    setTimeout(() => {
      lockPending = false;
      if (!game || locked() || gui.isOpen()) return;
      requestLock();
    }, wait);
  }
  document.addEventListener('pointerlockerror', () => { if (!promised) lockFailed(); });
  canvas.addEventListener('click', () => { if (game && !gui.isOpen()) lock(); });
  /* Whether a key (Esc in the game menu) can take the mouse back. Chrome gives it
     back without a click only when the game let it go itself, in fullscreen, or
     within a few seconds of the last click or key it counts (Esc is not one).
     Otherwise the menu stays, rather than closing and coming back a moment later. */
  function keyMayLock() {
    const ua = navigator.userActivation;
    return !userUnlocked || !!document.fullscreenElement || !ua || ua.isActive;
  }
  let wantInv = false;
  /* zoom (C held): the view narrows to a quarter and the mouse turns slower to match, at once,
     the way OptiFine's zoom key does (eased, it took a fifth of a second to get there) */
  let zoomHeld = false, zoomF = 1;
  /* The spyglass, held to the eye with the use button: a tenth of the view and the mouse slowed with it, the
     world seen through a round glass (everything outside it black), the hand put away. */
  let scopeEl = null, scoped = false;
  function spyglassUp() {
    const g = game;
    if (!g || gui.isOpen() || !g.inter.useHeld) return false;
    return itemName(g.inv.heldId()) === 'spyglass' || (!g.inv.heldId() && g.inv.offhand && itemName(g.inv.offhand.id) === 'spyglass');
  }
  function scope(on) {
    if (on === scoped) return;
    scoped = on;
    if (!scopeEl) {
      scopeEl = document.createElement('div');
      scopeEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none;' +
        'background:radial-gradient(circle at center, transparent 0, transparent calc(min(50vw, 50vh) - 3px), rgba(0,0,0,0.75) calc(min(50vw, 50vh) - 2px), #000 min(50vw, 50vh))';
      canvas.parentNode.insertBefore(scopeEl, canvas.nextSibling);
    }
    scopeEl.style.display = on ? 'block' : 'none';
  }
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
    // the hands too: placing uses up the stack, breaking drops, tools wear (hands.js), and what each mode may do (modes.js)
    applyModeRules(g, m, hud);
    if (m === 'survival' || m === 'adventure') hud.setStats(g.survival.stats()); else hud.setStats(null);
    hud.markDirty();
  }
  const chatCtx = () => {
    const g = game;
    return {
      game: g, playerName: g.net ? g.net.name : Account.name || 'Player',
      // on a server what you say goes to everyone (net/net.js)
      sendChat: g.net ? t => g.net.chat(t) : null,
      // Allow Commands: as set when the world was made (creative worlds have it on unless turned off)
      cheats: !!(window.__lc2.cheats || (g.lan ? g.lan.cheats : g.entry.cheats !== undefined ? g.entry.cheats : g.entry.mode === 'creative')),
      say: (t, c, extra) => chat.add(t, c, extra),
      setMode,
      /* /home, /tpa and the like: to a place in any dimension; near you in this one, at once, as /tp does;
         further or in another, through the loading screen as a portal goes (travel), facing as you were there */
      goTo: (dim, x, y, z, yaw, pitch) => {
        const p = g.player;
        if (!DIMS[dim] || ![x, y, z].every(Number.isFinite) || (g.survival && g.survival.dead)) return;
        if (g.entities && g.entities.riding) g.entities.dismount();
        const face = () => { if (Number.isFinite(yaw)) p.yaw = yaw; if (Number.isFinite(pitch)) p.pitch = pitch; };
        if (dim === g.dim && Math.hypot(x - p.pos.x, z - p.pos.z) < 96) { p.pos.set(x, y, z); p.prev.copy(p.pos); p.vel.set(0, 0, 0); p.fallDistance = 0; face(); return; }
        travel(dim, () => ({ x, y, z, yaw: Number.isFinite(yaw) ? yaw : undefined }), { x, z }).then(face, () => {});
      },
      // (/home with no home yet: the world spawn, as Essentials' spawn-if-no-home sends you)
      goSpawn: () => { if (g.survival && g.survival.dead) return; if (g.entities && g.entities.riding) g.entities.dismount(); travel('overworld', w => spawnPoint(w), g.spawn); },
      // (/home bed: your respawn point, a bed, an anchor (no charge used) or a /spawnpoint; false when there is none or it is gone)
      goBed: () => {
        const sp = g.survival && g.survival.spawnPoint;
        if (!sp || !DIMS[sp.dim] || g.survival.dead) return false;
        const look = Object.assign({}, sp, { forced: sp.kind === 'anchor' ? true : sp.forced });
        if (sp.dim === g.dim && g.world.loaded(sp.x, sp.z)) {
          const at = respawnSpot(g.world, look, g.mode === 'creative');
          if (!at) return false;
          chatCtx().goTo(sp.dim, at.x, at.y, at.z, at.yaw);
          return true;
        }
        if (g.entities && g.entities.riding) g.entities.dismount();
        travel(sp.dim, w => respawnSpot(w, look, g.mode === 'creative') || { x: sp.x + 0.5, y: sp.y + 1, z: sp.z + 0.5 }, { x: sp.x, z: sp.z });
        return true;
      },
      // (a teleport takes you off what you ride, as in the game)
      teleport: (x, y, z) => { const p = g.player; if (g.entities && g.entities.riding) g.entities.dismount(); p.pos.set(x, y, z); p.prev.copy(p.pos); p.vel.set(0, 0, 0); p.fallDistance = 0; },
      give: (name, count, extra) => {
        // any item or block by its name (items.js knows both); extra: what its components set (enchantments, wear)
        const id = itemId(name) || (B[name] !== undefined && BLOCKS[B[name]] && BLOCKS[B[name]].item !== false ? B[name] : 0);
        if (!id) return null;
        if (extra && (extra.ench || extra.dmg)) for (let i = 0; i < count; i++) g.inv.addStack(Object.assign({ id, count: 1 }, extra.dmg ? { dmg: extra.dmg } : null, extra.ench ? { ench: Object.assign({}, extra.ench) } : null));
        else g.inv.add(id, count);
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
      kill: () => { if (g.mode === 'survival' || g.mode === 'adventure') g.survival.hurt(3.4e38, 'generic_kill'); else respawn(); },
      seed: () => g.entry.seed,
      blockChanged: () => {},
      setWeather: (w, ticks) => { const W = g.sim && g.sim.weather; if (W) W.set(w, ticks || 0); g.weather = { kind: w, ticks: ticks === null ? 6000 + Math.floor(Math.random() * 12000) : ticks }; },
      setDifficulty: d => { g.entry.difficulty = d; Worlds.update(g.entry.id, { difficulty: d }); options.set('difficulty', d); },
      dimension: () => g.dimension || 'overworld',
      xp: null,
    };
  };
  function openChat(start) {
    wantInv = true;
    for (const k in game.player.keys) game.player.keys[k] = false;
    letGo();
    gui.open(new ChatScreen(chat, chatCtx, start));
  }
  document.addEventListener('pointerlockchange', () => {
    if (locked()) { lockPending = false; return; }
    // let go by you or the browser, not by the game: Chrome will not give it back for a moment
    if (!letGoOurselves) unlockedAt = performance.now();
    userUnlocked = !letGoOurselves;
    letGoOurselves = false;
    zoomHeld = false;
    for (const k in game ? game.player.keys : {}) game.player.keys[k] = false;
    if (game && game.inter) { game.inter.up(0); game.inter.up(2); }
    keyButtons.clear(); fHeld = false;
    // losing the mouse in the game is Esc: the game menu (not when it went to the inventory)
    if (game && !gui.isOpen() && !wantInv && !game.survival.dead) gui.open(new PauseScreen());
    wantInv = false;
  });
  // MC's mouse: sensitivity s gives (0.6 s + 0.2)^3 x 8 x 0.15 degrees a pixel, and you can look straight up or down
  document.addEventListener('mousemove', e => {
    if (!locked() || !game) return;
    const s = options.get('sensitivity'), f = s * 0.6 + 0.2, k = f * f * f * 8 * 0.15 * Math.PI / 180 * zoomF;
    const inv = options.get('invertY') ? -1 : 1;
    game.player.yaw -= e.movementX * k;
    game.player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, game.player.pitch - e.movementY * k * inv));
  });
  // the player's own key names, from the bindings in Options
  const MOVE = { forward: 'w', left: 'a', back: 's', right: 'd', jump: ' ', sneak: 'shift', sprint: 'control' };
  const bindingOf = code => options.actionFor(code);
  const modeKeys = new ModeKeys({ gui, hud: () => hud, chat, icons, game: () => game, cheats: () => !!(game && chatCtx().cheats), run: line => execute(line, chatCtx()) });
  let showDebug = false, f3Held = false, f3Combo = false, timeRuns = true, autoScale = options.get('renderScale') === 'auto' && !params.get('scale');
  // a key bound to Attack/Destroy or Use Item/Place Block (G and H by default, as second keys) is that mouse button, held to keep going
  const KEY_BUTTON = { attack: 0, use: 2 }, keyButtons = new Map();
  // F (Swap Hands) held with 1 to 9 is F1 to F9, pressed and let go; F alone, let go with no number, still swaps hands
  let fHeld = false, fCombo = false;
  const fKey = n => { const code = 'F' + n, fake = { code, key: code, repeat: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault() {} }; onKeyDown(fake); onKeyUp(fake); };
  const onKeyDown = e => {
    if (!game || gui.isOpen()) return;
    const a = bindingOf(e.code) || (e.code === 'KeyR' ? 'sprint' : null);
    if (fHeld && /^Digit[1-9]$/.test(e.code)) { fCombo = true; e.preventDefault(); if (!e.repeat) fKey(+e.code.slice(5)); return; }
    if (a === 'swapOffhand' && !e.code.startsWith('Mouse') && game.mode !== 'spectator') { if (!e.repeat) { fHeld = true; fCombo = false; } e.preventDefault(); return; }
    // F3 opens the debug screen when it is let go, unless a key was pressed with it (F3 + H: advanced tooltips)
    if (a === 'debug' || e.code === 'F3') { if (!e.repeat) { f3Held = true; f3Combo = false; } e.preventDefault(); return; }
    if (f3Held && e.code === 'KeyH') {
      f3Combo = true;
      const v = !options.get('advancedTooltips');
      options.set('advancedTooltips', v);
      chat.add('§e§l[Debug]:§r Advanced tooltips: ' + (v ? 'shown' : 'hidden'));
      e.preventDefault(); return;
    }
    // F3 + Q: the list of F3 keys, in the chat as the game prints it
    if (f3Held && e.code === 'KeyQ') {
      f3Combo = true;
      if (!e.repeat) for (const l of F3_HELP) chat.add(l);
      e.preventDefault(); return;
    }
    // F3 + N: spectator and back; F3 + F4: the game mode switcher (modes.js)
    if (f3Held && (e.code === 'KeyN' || e.code === 'F4')) {
      f3Combo = true;
      if (!e.repeat) { if (e.code === 'KeyN') modeKeys.toggleSpectator(); else modeKeys.switcher(); }
      e.preventDefault(); return;
    }
    if (a === 'hideGui' || e.code === 'F1') { gui.hideHud = !gui.hideHud; gui.markDirty(); e.preventDefault(); return; }
    if (e.code === 'F7') { autoScale = false; renderer.opts.scale = renderer.opts.scale >= 1 ? 0.75 : renderer.opts.scale >= 0.75 ? 0.5 : 1; fit(); e.preventDefault(); return; }
    if (a === 'perspective' || e.code === 'F5') { if (!e.repeat) renderer.avatar.cycleView(); e.preventDefault(); return; }
    // L: the advancements (js/adv)
    if (a === 'advancements') {
      e.preventDefault();
      if (e.repeat) return;
      wantInv = true;
      for (const k in game.player.keys) game.player.keys[k] = false;
      letGo();
      if (!openAdvancements()) lock();
      return;
    }
    if (a === 'inventory') {
      e.preventDefault();
      // (a spectator has no inventory to open)
      if (game.mode === 'spectator') return;
      // riding a chest boat: its chest (js/entities)
      if (game.entities && game.entities.rideInventory()) return;
      wantInv = true;
      for (const k in game.player.keys) game.player.keys[k] = false;
      letGo();
      gui.open(inventoryScreen(game.inv, icons));
      return;
    }
    if (!locked()) return;
    /* Esc reaches the page only in fullscreen, where the game keeps it (ui/menus.js setFullscreen):
       the game menu, with the mouse let go by the game itself, so Back to Game or Esc again takes
       it back at once, as in the game. */
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) {
        wantInv = true; for (const k in game.player.keys) game.player.keys[k] = false; letGo();
        // (this Esc was the page's own, so the next one may close the menu straight away)
        const ps = new PauseScreen(); ps.openedAt = -1e9; gui.open(ps);
      }
      return;
    }
    // C, held: zoom in
    if (!a && e.code === 'KeyC') { zoomHeld = true; zoomF = 0.25; e.preventDefault(); return; }
    // chat: T, or / with the slash already typed
    if ((a === 'chat' || (!a && e.code === 'KeyT')) && !e.repeat) { e.preventDefault(); openChat(''); return; }
    if ((a === 'command' || e.key === '/') && !e.repeat) { e.preventDefault(); openChat('/'); return; }
    // (with Ctrl held to sprint, Ctrl+1 to 9 would otherwise change the browser's tab)
    if (a && a.startsWith('hotbar')) { if (game.mode !== 'spectator') game.inv.select(+a.slice(6) - 1); e.preventDefault(); return; }
    // Q throws one of the selected stack (Ctrl+Q all of it), F swaps it with the off hand
    if ((a === 'drop' || a === 'swapOffhand') && game.mode === 'spectator') { e.preventDefault(); return; }
    // a key bound to Attack/Destroy or Use Item/Place Block (G and H by default) works as that mouse button, held to keep mining or placing
    if (a && KEY_BUTTON[a] !== undefined && !e.code.startsWith('Mouse') && !f3Held && game.mode !== 'spectator') {
      e.preventDefault();
      if (!e.repeat && !keyButtons.has(e.code)) { keyButtons.set(e.code, KEY_BUTTON[a]); game.inter.down(KEY_BUTTON[a]); }
      return;
    }
    if (a === 'drop') { game.hands.dropSelected(e.ctrlKey || e.metaKey); e.preventDefault(); return; }
    if (a === 'swapOffhand') { const inv = game.inv, t = inv.slots[inv.selected]; inv.slots[inv.selected] = inv.offhand; inv.offhand = t; inv.changed(); e.preventDefault(); return; }
    if (e.code === 'BracketLeft') game.time -= 1000;
    if (e.code === 'BracketRight') game.time += 1000;
    if (e.code === 'KeyP' && !a) timeRuns = !timeRuns;
    if (a && MOVE[a]) { game.player.setKey(MOVE[a], true); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKeyDown);
  const onKeyUp = e => {
    if (e.code === 'KeyC') { zoomHeld = false; zoomF = 1; }
    if (!game) return;
    if (fHeld && bindingOf(e.code) === 'swapOffhand') { fHeld = false; if (!fCombo && !gui.isOpen() && game.mode !== 'spectator') { const inv = game.inv, t = inv.slots[inv.selected]; inv.slots[inv.selected] = inv.offhand; inv.offhand = t; inv.changed(); } return; }
    if (keyButtons.has(e.code)) { const b = keyButtons.get(e.code); keyButtons.delete(e.code); if (game.inter) game.inter.up(b); }
    const a = bindingOf(e.code) || (e.code === 'KeyR' ? 'sprint' : null);
    if (a === 'debug' || e.code === 'F3') { if (f3Held && !f3Combo && !gui.isOpen()) { showDebug = !showDebug; if (!showDebug && hud) hud.setDebug(null); } f3Held = false; modeKeys.release(); return; }
    if (a && MOVE[a]) game.player.setKey(MOVE[a], false);
  };
  document.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('wheel', e => {
    if (!game || !locked()) return;
    // a spectator's wheel is the flying speed (0 to 0.2, a 200th a notch, as in the game)
    if (game.mode === 'spectator') { const p = game.player; p.flySpeed = Math.max(0, Math.min(0.2, (p.flySpeed ?? 0.05) - Math.sign(e.deltaY) * 0.005)); return; }
    game.inv.scroll(e.deltaY);
  }, { passive: true });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!game || !locked()) return;
    const g = game;
    if (e.button === 1) {
      e.preventDefault();
      if (g.mode === 'spectator') return;
      const hit = g.inter.target, ent = g.inter.entityTarget;
      // an entity that has an item of its own (a boat: js/entities) gives that
      if (ent && ent.pickItem) { const id = itemId(ent.pickItem()); if (id) g.inv.pickBlock(id); return; }
      if (hit) { const d = BLOCKS[hit.b]; g.inv.pickBlock(d.lower ? B[d.lower] : hit.b); }
      return;
    }
    g.inter.down(e.button);
    // a click that opened a screen (a sign to write on) leaves the typing with it: the canvas does not take the focus back
    if (gui.isOpen()) e.preventDefault();
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
    // the difficulty button changes the world you are in
    if (k === 'difficulty' && game && v && game.entry.difficulty !== v) { game.entry.difficulty = v; Worlds.update(game.entry.id, { difficulty: v }); }
    if (k === 'clouds') renderer.opts.clouds = v;
    if (k === 'renderScale') { autoScale = v === 'auto'; if (v !== 'auto') { renderer.opts.scale = +v; fit(); } }
    if (k === 'skin') setSkin(v === 'default' ? new URL('../textures/skin/default.png?v=107', import.meta.url).href : v);
    if (k === 'skinParts' && v) for (const p in v) setSkinPart(p, v[p]);
    if (k === 'cape') setCape(v || '');
  });

  /* ---- the loop ---- */
  let acc = 0, last = performance.now(), fps = 0, fpsT = 0, frames = 0, scaleTick = 0;
  // Auto resolution: a new scale is put in at the start of the next frame, never after a frame is drawn (giving the canvas a size wipes it, and that frame went to the screen black); two slow or fast readings in a row to move, and no step up for 20 s after a step down, so it does not go back and forth
  let scaleWant = 0, scaleSlow = 0, scaleFast = 0, scaleDropAt = 0;
  // (a Chromebook or other small machine may go a little blurrier before it gives up frames)
  const LOW_END = lowEndDevice();
  const TILT = { roll: 0, tiltPitch: 0 }, NO_TILT = { roll: 0, tiltPitch: 0 };
  let startedAt = performance.now();
  let firstFrames = null;          // a world's first frames, played behind its loading screen (startGame): { left, res }
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), eyeV = new THREE.Vector3();
  const tilt = 0.42;              // the sun's path leans south, so shadows are never straight down
  /* where the sun is at tick t: the game's own curve (vanilla.js timeOfDay), so it rises at 23215 and sets at 12785 with
     the shaders on too (it went round at an even pace, setting at 12000: dusk came half a minute early and its shade was black) */
  const sunAt = t => {
    const d0 = (((t / 24000 - 0.25) % 1) + 1) % 1, c = (d0 * 2 + 0.5 - Math.cos(d0 * Math.PI) / 2) / 3;
    const a = Math.PI / 2 + c * Math.PI * 2;
    sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    moonDir.copy(sunDir).negate();
  };
  let menuTime = 2000, menuAcc = 0;
  /* Frames the graphics card has not finished. When it falls even a little
     behind the screen (Detailed on a modest card), the browser keeps handing
     it more and they queue up: everything you do then shows six or seven
     frames late, a tenth of a second and more. So no more than two frames
     are left with the card: while it is still busy with both, this one is
     not drawn (the game goes on all the same, and the next frame drawn shows
     it). One would leave the card idle between frames and halve the frame
     rate of a card that only just keeps up; two keeps it busy and the
     picture right behind your hands. ?frames=N tries another depth. */
  const gl = renderer.r.getContext();
  const fences = [];               // [fence, when it was set]
  // (VSync in Video Settings: two, or one; ?frames=N for a test)
  const inFlightOf = () => Math.max(1, +params.get('frames') || video.inFlight());
  let drawDt = 0;
  function cardBusy(now) {
    while (fences.length && gl.getSyncParameter(fences[0][0], gl.SYNC_STATUS) === gl.SIGNALED) gl.deleteSync(fences.shift()[0]);
    // a fence that never comes back (the context lost, a driver hiccup) must not stop the drawing
    if (fences.length && (now - fences[0][1] > 250 || gl.isContextLost())) { for (const f of fences) gl.deleteSync(f[0]); fences.length = 0; }
    return fences.length >= inFlightOf();
  }
  function drawn() { const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); if (s) fences.push([s, performance.now()]); }
  function loop(now) {
    // Max Framerate and Reduce FPS when (Video Settings): not this frame, the next (settings.js)
    if (video.hold(now)) { requestAnimationFrame(loop); gui.frame(now); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // the next frame is asked for first, so one that goes wrong never stops the game
    requestAnimationFrame(loop);
    if (scaleWant) { renderer.opts.scale = scaleWant; scaleWant = 0; fit(); }
    try {
      drawDt += dt;
      video.frame(game && game.ready ? game : null, dt);
      if (game && game.ready && !travelling) { playFrame(now, dt); if (firstFrames && --firstFrames.left <= 0) firstFrames.res(); }
      else {
        minimap.frame(null);
        drawDt = 0;
        // the title world turns slowly: half the frames are plenty, and the menus stay quick
        menuAcc += dt;
        if (menu && menuAcc >= 1 / 31 && !cardBusy(performance.now())) { menuFrame(menuAcc); menuAcc = 0; drawn(); }
      }
      soundFrame(game, renderer.camera, now);
    } catch (e) {
      if (!loop.warned) { loop.warned = true; console.error(e); }
    }
    gui.frame(now);
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
      const tick0 = performance.now();      // (F3's server line: how long a tick takes, on average)
      // riding: the keys go to the vehicle instead (js/entities)
      if (!(g.entities && g.entities.rideTick())) player.tick();
      fluids.step();
      g.sim.tick();
      inter.tick();
      if (renderer.particles) renderer.particles.tick();
      g.hands.tick();
      g.containers.tick();
      if (g.details) g.details.tick();
      if (g.entities) g.entities.tick();
      g.realms.tick();
      // the portal's and Nausea's wobble of the view (render/screenfx.js)
      (g.spin || (g.spin = new Spin())).tick(g.realms.portalTime, survival.effects.nausea ? survival.effects.nausea.ticks : null);
      if (g.mode === 'survival' || g.mode === 'adventure') {
        player.canSprint = survival.canSprint();
        player.effects = survival.effects;
        survival.tick(player);
      } else if (g.mode === 'creative') {
        // effects, and the void (survival.js)
        player.effects = survival.effects;
        survival.creativeTick(player);
      }
      if (g.mode !== 'spectator') {
        // a death: everything spills (not with keepInventory), then the death screen (or straight back, doImmediateRespawn)
        if (survival.dead && !g.spilled) { g.spilled = true; if (!gameRule(g, 'keepInventory')) g.hands.spillAll(); }
        if (survival.dead && !gui.isOpen() && !g.respawning) {
          if (gameRule(g, 'doImmediateRespawn')) respawn();
          else {
            letGo();
            gui.open(new DeathScreen({ message: survival.deathMessage, score: survival.score, hardcore: !!g.entry.hardcore }));
          }
        }
      }
      g.drops.tick(player, g.collector);
      // a compass needle or a clock face that moved is drawn again (js/dials.js), where one shows
      if (tickDials({ yaw: player.yaw, x: player.pos.x, z: player.pos.z, spawn: g.spawn, time: g.time, dim: g.dim, dead: survival.dead })) {
        if (gui.isOpen()) gui.markDirty();
        if (dialInHotbar(g.inv, itemName)) hud.markDirty();
      }
      // so is a bow being drawn or a crossbow being loaded
      const cu = g.entities ? g.entities.combat.use : null, cs = cu ? g.entities.combat.useStack(cu) : null;
      if (setUse(cu, cs, cs && cu.kind === 'crossbow' ? g.entities.combat.crossbowTicks(cs) : 0)) { hud.markDirty(); if (gui.isOpen()) gui.markDirty(); }
      if (timeRuns) g.time += 1;
      for (const s of player.splashes.splice(0)) renderer.inter.splash(s[0], s[1], s[2], s[3]);
      structures.spawners.tick(world, player);
      soundTick(g);
      advTick(g);
      statsTick(g); recipesTick(g);
      // on a server: where you are, and what came in from the others (net/net.js)
      if (g.net) g.net.tick(now - acc * 1000);
      // every ten seconds, what changed goes into the browser's storage
      if (++g.saveT >= 200) { g.saveT = 0; saveGame(); }
      g.tickMs = (g.tickMs || 0) * 0.95 + (performance.now() - tick0) * 0.05;
    }
    const alpha = acc / 0.05;
    world.update(player.pos.x, player.pos.z);
    world.flush();
    if (world.quick) world.quick.frame();
    const v = player.view(alpha);
    // (the outline from the eyes as the game's frame pick has them: between the ticks, at the pose's own height, no view bob)
    inter.look(player.pickEye ? player.pickEye(alpha) : v.eye);
    g.hands.alpha = alpha;
    g.drops.update(dt, alpha, player, renderer.camera);
    if (g.details) g.details.update();
    if (g.entities) g.entities.render(alpha);
    g.eye = v.eye;
    if (g.net) g.net.frame(now, dt, v.eye);
    // the other dimensions have no sun: Detailed's sky tables are left at midnight there
    const D = DIMS[g.dim];
    sunAt(D.fixedTime !== null ? 18000 : g.time);
    g.realms.frame(alpha, dt);
    // the dragon's bar (dim/realms.js), or a wither's (entities/mobs7.js)
    const boss = g.realms.boss || (g.entities && g.entities.boss) || null;
    if ((boss ? boss.progress : -1) !== (hud.boss ? hud.boss.progress : -1)) { hud.boss = boss ? Object.assign({}, boss) : null; hud.markDirty(); }
    // (in third person the arm goes up, but the view is not narrowed and there is no glass, as in the game)
    scope(spyglassUp() && renderer.avatar.view === 0);
    zoomF = scoped ? 0.1 : zoomHeld ? 0.25 : 1;
    /* the card still busy with the frames before: this one is not drawn (see cardBusy). Asked
       here, after the ticks, rather than as the frame starts: the card has had that much longer */
    if (!cardBusy(performance.now())) {
      const eyeBlock = world.get(Math.floor(v.eye.x), Math.floor(v.eye.y), Math.floor(v.eye.z));
      // (swimming presses the sea's plants aside too, RIP Computer's kelp and seagrass)
      const onGrass = (player.onGround || player.inWater) && !player.flying;
      renderer.render({
        time: (g.time + alpha) / 20, sunDir, moonDir, feet: v.feet, eye: v.eye, yaw: player.yaw, pitch: player.pitch,
        fov: v.fov * (g.entities ? g.entities.combat.fovScale(alpha) : 1) * zoomF, eyeInWater: FLUID[eyeBlock] === 1 || player.eyeInWater, skyAtEye: skyAt(world, v.eye),
        moonPhase: Math.floor(g.time / 24000) % 8, trample: onGrass ? 1 : 0, showHand: !gui.hideHud && !scoped && g.mode !== 'spectator' && !g.noHand, bob: g.hands.handBob(v.handBob),
        waterTint: tintAt(world, v.eye), player, alpha, effects: survival.effects,
        // hurt: the camera tilts and the model flashes red (combat/combat.js)
        tilt: g.entities && (g.mode === 'survival' || g.mode === 'adventure') ? g.entities.combat.tilt(alpha, video.tilt()) : null, hurt: !!(g.entities && g.entities.combat.hurtFlash()),
        biome: BIOMES[world.biomeAt(Math.floor(v.eye.x), Math.floor(v.eye.z))], eyeInLava: FLUID[eyeBlock] === 2, eyeInSnow: eyeBlock === B.powder_snow,
        dim: D, bossFog: g.realms.bossFog, horizon: /^flat:/.test(world.generator || '') ? 0 : 127, spin: g.spin ? g.spin.at(alpha) : null,
        // the screen tips when hurt and rolls a little in death (survival.js)
        ...(g.mode === 'survival' || g.mode === 'adventure' ? tiltState(survival.viewTilt(alpha, video.tilt())) : NO_TILT),
      }, Math.min(0.25, drawDt));
      drawDt = 0; drawn(); frames++;
    }
    minimap.hud = hud; minimap.weather = renderer.weatherState;
    minimap.frame(g, v.feet, player.yaw, alpha);
    if (g.mode === 'survival' || g.mode === 'adventure') hud.setStats(survival.stats());
    hud.setEffects(survival.effects);
    // no crosshair in third person, or with the HUD hidden
    // (a spectator has one only over a mob)
    const cross = renderer.avatar.view === 0 && !gui.hideHud && (g.mode !== 'spectator' || !!inter.entityTarget);
    if (hud.crosshair !== cross) { hud.crosshair = cross; hud.markDirty(); }
    // the attack indicator under it (js/entities)
    // (Attack Indicator in Video Settings: under the crosshair, beside the hotbar, or not at all)
    const am = video.attackMode();
    if (hud.attackMode !== am) { hud.attackMode = am; hud.attack = null; hud.markDirty(); }
    if (g.entities && am !== 'off') { const at = g.entities.combat.indicator(); if (Math.floor(at * 17) !== Math.floor((hud.attack === null || hud.attack === undefined ? 1 : hud.attack) * 17)) { hud.attack = at; hud.markDirty(); } }
    fpsT += dt;
    if (fpsT > 0.5) {
      fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
      // keep it smooth: give up resolution before frame rate, and take it back when there is room
      // (not over the frames a change of look costs, from the moment it is asked for: one slow frame then is no reason to blur the picture)
      if (autoScale && now - startedAt > 6000 && !renderer.lookPending && now - (renderer.lookAt || 0) > 3000 && ++scaleTick % 4 === 0) {
        const s = renderer.opts.scale;
        // never so low it blurs: three quarters of the screen, or half of a very sharp one
        const floor = (renderer.dpr || 1) > 1.4 ? 0.5 : LOW_END ? 0.6 : 0.75;
        scaleSlow = fps < 42 ? scaleSlow + 1 : 0; scaleFast = fps > 58 ? scaleFast + 1 : 0;
        if (scaleSlow >= 2 && s > floor) { scaleWant = Math.max(floor, +(s - 0.1).toFixed(2)); scaleSlow = 0; scaleDropAt = now; }
        else if (scaleFast >= 2 && s < 1 && now - scaleDropAt > 20000) { scaleWant = Math.min(1, +(s + 0.05).toFixed(2)); scaleFast = 0; }
      }
    }
    if (showDebug) {
      hud.camera = { yaw: player.yaw, pitch: player.pitch };
      // the game's F3 lines (ui/debug.js)
      const [dl, dr] = debugLines({ fps, g, player, world, renderer, inter, options, level: video.level(), Y0, timeRuns });
      hud.setDebug(dl, dr);
    }
  }
  function tiltState(t) { TILT.roll = t.roll; TILT.tiltPitch = t.pitch; return TILT; }
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
    structures,                     // (once the game's parts are in: parts())
    renderer, gui, options, B, BLOCKS, video, minimap,
    get game() { return game; }, get world() { return game ? game.world : menu && menu.world; }, get player() { return game && game.player; },
    get fluids() { return game && game.fluids; }, get inv() { return game && game.inv; }, hud, chat, cheats: false,
    command: line => { if (!game) return false; const ctx = chatCtx(); ctx.cheats = true; return import('./commands.js?v=107').then(m => m.execute(line, ctx)); },
    get drops() { return game && game.drops; }, get containers() { return game && game.containers; }, get hands() { return game && game.hands; },
    get survival() { return game && game.survival; },
    get enchanting() { return game && enchantDebug(game); },
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
    // for test harnesses: log in without typing (account.login(name, password) -> the server's answer; the login screen closes itself)
    account: {
      get name() { return Account.name; }, get ready() { return Account.ready; }, get admin() { return Account.admin; }, get session() { return Account.session; },
      login: async (name, password) => { const r = await Account.login(name, password); if (r.ok && gui.screen instanceof LoginScreen) gui.back(); return r; },
      create: async (name, password) => { const r = await Account.create(name, password); if (r.ok && gui.screen instanceof LoginScreen) gui.back(); return r; },
      logout: () => Account.logout(), check: () => Account.check(),
    },
  };
  // after a quality change, straight back into the world you were in
  if (resumeTo) startGame(resumeTo, false);
  // (a server's world comes back by joining it again: ui/multiplayer.js)
  else if (resumeMp) parts().then(() => rejoin(gui, resumeMp), () => partsFailed('mp-' + resumeMp));
}

boot().catch(e => { console.error(e); status('Something went wrong: ' + (e && e.message)); });
