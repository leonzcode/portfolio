/* ---------------------------------------------------------------------------
   Leoncraft 2 - the minimap, after Xaero's Minimap and its defaults.

   What Xaero's shows when it is first put in (its own default settings, read
   from the mod's config code: minimap_shape 0, minimap_frame 0, north locked
   off, minimap_compass_location 1, minimap_zoom 1, minimap_size auto, cave
   zoom 2, auto cave mode 2, cave depth 30, lighting on, undiscovered opacity
   50, radar main entity 0, the default radar categories), and so this:

     where           the top left corner: the module at 0, 0, the map 9 units
                     in, a unit being the mod's own scale (2 screen pixels up
                     to a 1500 pixel tall screen, then one more each 500)
     size            Auto: 130 units a 1080 screens' height, 55 to 250
     shape, frame    a square in a four unit bevelled frame: black outside,
                     lit grey on the top and left and shaded on the bottom and
                     right, a dark line inside (the Default frame's greys)
     turning         the map turns with you (Lock North off); over 180 units
                     a square map is always north up, as the mod's is
     the middle      a small crosshair, white arms on a cross that inverts
                     what is under it (Main Entity As: Crosshair); with north
                     up, the red arrow (0.8, 0.1, 0.1) at 1.5x pointing your
                     way, a faint black copy a unit above and below
     compass         N, E, S, W inside the map's edge (On Map), each on a
                     square of blue (#5555FF at 0x90), the letter white with a
                     blue shadow
     zoom            1: one block a half unit; cave mode zooms in twice
     radar           upright diamonds (at any turn) with a black rim, 9 half units across: players
                     white, every mob yellow (hostile or not), items red, all
                     other entities (arrows, boats, carts, orbs, paintings,
                     armour stands...) dark purple; names off; a mob more than
                     20 blocks above or below is left out (players never), one
                     more than 5 below is darker (the mod's height fade:
                     0.25 + 0.5 x level / 15), or fainter in cave mode
     under it        "x, y, z", white with a shadow, centred, 5 units under
                     the frame (split into "x, z" and "y" if wider than the
                     map); the biome line is off
     cave mode       on by itself when a 3 x 3 ceiling of solid blocks is over
                     your head out of the sky's light, at most once a second:
                     the map then shows, from just over your head (your head
                     + 3, or the ceiling if lower) 30 blocks down, the first
                     block under open space; the Nether is always like that
                     (its roof), the End's open islands are not
     lighting        each block lit as the mod lights it, (9 + the brighter of
                     its block light and its sky light by the time of day) / 24:
                     the night and caves dark, torches lit; the Nether at one
                     fixed sky level (2.4 of 15), the End at full brightness
     unknown         ground not loaded is black at half strength

   Block colours are the game's own map colours (maps.js MAP_RGB: the mod's
   "Vanilla" block colours), shaded by height as a map is. Each chunk is
   worked out once into a 16 x 16 piece of a big picture that wraps round (a
   ring of 64 x 64 chunks), and again only when its mesh changes (a block
   changed there), the slice changes (cave mode, a new height) or the light
   level changes (dusk, dawn); a few a frame, nearest first, in a fraction of
   a millisecond. Each frame the map itself is only that picture, turned by a
   CSS transform, plus the dots: it lives in its own elements over the game
   canvas and under the GUI's (the GUI's blur and darkening fall on it under
   a menu, as on the HUD), so neither the game nor the HUD is drawn for it.

   Options (Options, kept with the rest): minimap, minimapSize, minimapZoom,
   minimapNorth, minimapCoords, minimapEntities, minimapCave, minimapBiome,
   minimapLighting.
--------------------------------------------------------------------------- */
import { MAP_RGB, mapColourOf } from '../maps.js?v=39';
import { FLUID, BLOCKS, SOLID, OPACITY, MAX_ID } from '../blocks.js?v=39';
import { BIOMES } from '../biomes.js?v=39';
import { H, Y0 } from '../world-const.js?v=39';
import { lightLevel } from '../lightlevel.js?v=39';
import { skyLightFactor } from '../render/vanilla.js?v=39';
import { Button, CycleButton, WidgetRow, OptionsListScreen, onOff } from './gui.js?v=39';

const N = 64, S = N * 16;          // the ring: chunks across, and pixels
const MASK = N - 1;
// the map's side in the mod's units (auto: worked out from the screen, as the mod does)
export const MINIMAP_SIZES = ['auto', 70, 100, 130, 160, 190, 220, 250];
export const MINIMAP_ZOOMS = [1, 2, 3, 4, 5, 6];
// Xaero's default dot colours (Minecraft's chat colours: 15 white, 14 yellow, 12 red, 5 dark purple)
// and the categories' render order (lower first)
const DOT = { player: [0xFF, 0xFF, 0xFF, 6], hostile: [0xFF, 0xFF, 0x55, 3], mob: [0xFF, 0xFF, 0x55, 2], item: [0xFF, 0x55, 0x55, 1], other: [0xAA, 0x00, 0xAA, 0] };
const ARROW = 'rgb(204,26,26)';
const COMPASS_BG = 'rgba(85,85,255,0.565)', COMPASS_SHADOW = 0x5555FF;
// the Default frame, ring by ring from the outside: top and left, bottom and right, the two odd corners
const FRAME = [[0, 0, 0], [147, 71, 109], [93, 126, 112], [16, 43, 30]];
const HEIGHT_LIMIT = 20, FADE_FROM = 15;
const BUDGET = 0.25;               // ms a frame for working out chunks
const TOGGLE_MS = 1000;            // the mod's Cave Mode Toggle Timer
// the Nether's fixed sky level for the map (MinimapRenderer.getSunBrightness: its ambient light 0.1
// x 24 / 15, plus nothing from its sky light factor of 0)
const NETHER_SKY = Math.min(1, 0.1 * 24 / 15);

const biomeName = b => !b || !b.name ? '' : b.name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
// a block the cave slice sees through (air, torches, glass, grass...: nothing that shows on a map)
const open = b => !b || !mapColourOf(b);
const COMPASS = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]];
const rgbCss = (r, g, b) => 'rgb(' + r + ',' + g + ',' + b + ')';
// a block that makes a ceiling for cave mode: solid, and not see-through, leaves or a liquid (the mod's test)
let ROOF = null;
function roofTable() {
  ROOF = new Uint8Array(MAX_ID);
  for (let i = 1; i < BLOCKS.length; i++) {
    const d = BLOCKS[i];
    if (d && SOLID[i] && OPACITY[i] > 0 && !FLUID[i] && !/leaves|glass/.test(d.name)) ROOF[i] = 1;
  }
  return ROOF;
}

export class Minimap {
  constructor(gui, options) {
    this.gui = gui; this.o = options;
    this.ring = document.createElement('canvas');
    this.ring.width = this.ring.height = S;
    this.rctx = this.ring.getContext('2d', { alpha: true });
    this.img = this.rctx.createImageData(16, 16);
    this.owner = new Array(N * N).fill(null);    // the chunk object each slot shows
    this.ver = new Int32Array(N * N).fill(-1);   // its mesh version then
    this.mode = new Array(N * N).fill('');       // the slice and light level it was made for
    this.queue = []; this.scanT = 0;
    this.world = null; this.modeKey = 'S';
    this.cave = false; this.caveTop = 0; this.caveAt = ''; this.caveT = 0; this.toggledAt = -1e9;
    this.root = null; this.shown = false;
    this.cost = 0; this.tileMs = 0;            // ms a frame, eased (tests read them)
    this.heights = new Int16Array(16);
    this.zoom = 0; this.lastT = 0;
    this.weather = null;                       // the renderer's weatherState (main.js): rain dims the daylight
  }

  /* ---- the page elements ----
     root (fixed, top left)
       box     the map's square, clipping what turns inside it (unknown ground: black at half)
         turn  turned and moved by a CSS transform each frame (the compositor does it: nothing
               is drawn again for turning): the ground (view, one pixel a block, scaled up
               pixelated)
         dots  not turned: the radar's dots at their turned places, each sprite upright, as the
               mod turns only the ground's texture and works the dots' places out by sin and cos
               (so a diamond stays a diamond whichever way you face)
       stat    not turned: the frame and the lines under it (drawn when the size or a line changes)
       inv     the crosshair's inverting part (mix-blend-mode difference)
       dyn     over the map: the compass letters, the crosshair's arms or the arrow */
  ensure() {
    if (this.root) return;
    const mk = (tag, st) => { const e = document.createElement(tag); Object.assign(e.style, st); return e; };
    const at = { position: 'absolute', left: '0', top: '0' };
    this.root = mk('div', { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '4', display: 'none' });
    this.box = mk('div', { position: 'absolute', overflow: 'hidden', background: 'rgba(0,0,0,0.5)' });
    this.turn = mk('div', Object.assign({ transformOrigin: '0 0', willChange: 'transform' }, at));
    this.viewEl = mk('canvas', Object.assign({ imageRendering: 'pixelated' }, at));
    this.dotEl = mk('canvas', at);
    this.statEl = mk('canvas', at);
    this.invEl = mk('canvas', Object.assign({ mixBlendMode: 'difference' }, at));
    this.dynEl = mk('canvas', at);
    this.turn.append(this.viewEl);
    this.box.append(this.turn, this.dotEl);
    this.root.append(this.box, this.statEl, this.invEl, this.dynEl);
    this.vctx = this.viewEl.getContext('2d');
    this.dctx = this.dotEl.getContext('2d');
    this.sctx = this.statEl.getContext('2d');
    this.ictx = this.invEl.getContext('2d');
    this.yctx = this.dynEl.getContext('2d');
    document.body.appendChild(this.root);
  }
  hide() {
    if (this.shown && this.root) { this.root.style.display = 'none'; this.shown = false; }
  }
  // the mod's own scale (GuiUtils.getAutoUIScale): screen pixels a unit
  unit() {
    const dpr = window.devicePixelRatio || 1;
    const short = Math.round(Math.min(window.innerWidth, window.innerHeight) * dpr);
    return short >= 1500 ? Math.floor(short / 500) : 2;
  }
  // the map's side in units (MinimapConfigClientUtils.getAutoMinimapSize for Auto)
  sizeUnits(s) {
    const v = this.o.get('minimapSize');
    if (typeof v === 'number' && v >= 55) return Math.min(250, v);
    const dpr = window.devicePixelRatio || 1;
    const short = Math.round(Math.min(window.innerWidth, window.innerHeight) * dpr);
    return Math.min(Math.max(55, Math.floor(2 * Math.floor(short / s) * 130 / 1080)), 250);
  }
  // north up: asked for, or forced by a square map over 180 units
  northUp(size) { return !!this.o.get('minimapNorth') || size > 180; }

  /* ---- once a frame ----
     game null: not playing (the title, a loading screen, travelling) */
  frame(game, feet, yaw, alpha) {
    // (whatever goes wrong here must never stop the frame it is called from)
    try { this.frame1(game, feet, yaw, alpha); } catch (e) { if (!this.warned) { this.warned = true; console.error(e); } }
  }
  frame1(game, feet, yaw, alpha) {
    const t0 = performance.now();
    const dt = this.lastT ? Math.min(0.25, (t0 - this.lastT) / 1000) : 0;
    this.lastT = t0;
    const g = this.gui, o = this.o;
    const on = !!game && o.get('minimap') && g.inGame && !g.hideHud && !(this.hud && this.hud.debug) && !!feet;
    if (!on) { this.hide(); return; }
    this.ensure();
    const world = game.world;
    if (world !== this.world) this.reset(world);
    this.tiles(game, feet, t0);
    const t1 = performance.now();
    this.draw(game, feet, yaw, alpha, dt);
    const t2 = performance.now(), P = this.parts || (this.parts = { tiles: 0, draw: 0, tilesMax: 0, drawMax: 0 });
    P.tiles = P.tiles * 0.95 + (t1 - t0) * 0.05; P.draw = P.draw * 0.95 + (t2 - t1) * 0.05;
    P.tilesMax = Math.max(P.tilesMax, t1 - t0); P.drawMax = Math.max(P.drawMax, t2 - t1);
    const ms = performance.now() - t0;
    this.cost = this.cost ? this.cost * 0.95 + ms * 0.05 : ms;
  }
  // a new world or dimension: the ring is emptied
  reset(world) {
    this.world = world;
    this.owner.fill(null); this.ver.fill(-1); this.mode.fill('');
    this.rctx.clearRect(0, 0, S, S);
    this.painted = (this.painted || 0) + 1;
    this.queue.length = 0; this.caveAt = ''; this.cave = false; this.toggledAt = -1e9; this.zoom = 0;
  }

  /* ---- cave mode (MinimapWriter.getCaving, with the 3 x 3 ceiling of Auto Cave Mode's default) ----
     At your head's height every column of the 3 x 3 round you must be out of the sky's light and
     have a ceiling block somewhere over your head; the map then starts at your head + 3, or at the
     ceiling over you if that is lower. */
  caving(w, feet) {
    const bx = Math.floor(feet.x), bz = Math.floor(feet.z), y = Math.floor(feet.y) + 1, def = y + 3;
    if (y >= H || y < 0) return -1;
    const roof = ROOF || roofTable();
    let start = def;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = bx + dx, z = bz + dz, c = w.chunkAt(x, z);
      if (!c) return -1;
      if ((lightLevel(w, x, y, z, w.noSky) >> 4) >= 15) return -1;
      const col = ((z - c.cz * 16) << 4) | (x - c.cx * 16), bl = c.blocks, top = Math.min(H - 1, c.top);
      let found = -1;
      for (let i = y; i <= top; i++) if (roof[bl[(i << 8) | col]]) { found = i; break; }
      if (found < 0) return -1;
      if (dx === 0 && dz === 0) start = Math.min(found, def);
    }
    return start;
  }
  slice(game, feet, now) {
    const w = game.world, bx = Math.floor(feet.x), by = Math.floor(feet.y), bz = Math.floor(feet.z);
    const where = bx + ',' + by + ',' + bz;
    // (looked at again when you move a block, and twice a second for blocks changing round you)
    if (where !== this.caveAt || now - this.caveT > 500) {
      this.caveAt = where; this.caveT = now;
      const start = this.o.get('minimapCave') === 'off' ? -1 : this.caving(w, feet);
      const want = start >= 0;
      // the mod's toggle timer: on and off at most once a second, so a doorway does not flicker
      if (want !== this.cave && now - this.toggledAt >= TOGGLE_MS) { this.cave = want; this.toggledAt = now; }
      if (this.cave && want) this.caveTop = start;
      else if (this.cave && !this.caveTop) this.caveTop = Math.min(H - 1, by + 4);
    }
    return this.cave;
  }
  /* the light level the map is lit for (MinimapRenderer: (1 - the sun's brightness) x 4, 0 by day
     to 4 at night); none outside the Overworld, where the sky gives no light */
  lightStep(game) {
    if (this.o.get('minimapLighting') === false || this.world.dim !== 'overworld') return 0;
    const wx = this.weather || {}, rain = wx.rain || 0, thunder = wx.thunder || 0;
    const f = skyLightFactor(game.time) * (1 - rain * 5 / 16) * (1 - thunder * 5 / 16);
    const sun = Math.max(0, Math.min(1, (f - 0.24) / 0.76));
    return Math.floor((1 - sun) * 4);
  }

  /* ---- the chunks round you: each worked out when new, changed, or on another slice ---- */
  tiles(game, feet, t0) {
    const w = game.world, cave = this.slice(game, feet, t0), lv = this.lightStep(game);
    const key = (cave ? 'C' + this.caveTop : 'S') + 'L' + lv + (this.o.get('minimapLighting') === false ? 'x' : '');
    const changed = key !== this.modeKey;
    this.modeKey = key; this.level = lv;
    const pcx = Math.floor(feet.x) >> 4, pcz = Math.floor(feet.z) >> 4;
    // the chunks the map can show at all (its corners, turned, at this zoom), and one more
    const r = Math.min(N / 2 - 1, Math.ceil(this.reach() / 16) + 1);
    if (changed || ++this.scanT >= 4 || pcx !== this.qcx || pcz !== this.qcz) {
      this.scanT = 0; this.qcx = pcx; this.qcz = pcz;
      const q = this.queue; q.length = 0;
      const shown = w.shownVersion;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const cx = pcx + dx, cz = pcz + dz, s = (cz & MASK) * N + (cx & MASK);
        const c = w.chunkXZ(cx, cz);
        if (!c) {
          if (this.owner[s]) { this.owner[s] = null; this.ver[s] = -1; this.mode[s] = ''; this.rctx.clearRect((cx & MASK) * 16, (cz & MASK) * 16, 16, 16); this.painted = (this.painted || 0) + 1; }
          continue;
        }
        const v = shown ? shown.get(cx + ',' + cz) || 0 : 0;
        if (this.owner[s] !== c || this.ver[s] !== v || this.mode[s] !== key) q.push(dx * dx + dz * dz, cx, cz, v);
      }
      // nearest first
      if (q.length > 4) {
        const idx = [];
        for (let i = 0; i < q.length; i += 4) idx.push(i);
        idx.sort((a, b) => q[a] - q[b]);
        const out = [];
        for (const i of idx) out.push(q[i], q[i + 1], q[i + 2], q[i + 3]);
        this.queue = out;
      }
      this.qi = 0;
    }
    const q = this.queue;
    let made = 0;
    while (this.qi < q.length) {
      if (made && performance.now() - t0 > BUDGET) break;
      const cx = q[this.qi + 1], cz = q[this.qi + 2], v = q[this.qi + 3];
      this.qi += 4;
      const c = w.chunkXZ(cx, cz);
      if (!c) continue;
      const s = (cz & MASK) * N + (cx & MASK);
      const fresh = this.owner[s] !== c;
      this.paint(w, c, cave);
      this.owner[s] = c; this.ver[s] = v; this.mode[s] = key;
      // a new chunk changes the shading of the row south of it (its pixels compare with this one's)
      if (fresh) { const s2 = ((cz + 1) & MASK) * N + (cx & MASK); if (this.owner[s2]) this.ver[s2] = -2; }
      made++;
      this.painted = (this.painted || 0) + 1;
    }
    if (made) this.tileMs = this.tileMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  // how far from the middle the map reaches, in blocks (to its corners)
  reach() {
    const s = this.unit(), side = this.sizeUnits(s) * s;
    return side * 0.5 * Math.SQRT2 / this.ppb(s);
  }
  // screen pixels a block: zoom x half a unit (the eased zoom once drawing has started)
  ppb(s) { return (this.zoom || this.zoomTarget()) * s / 2; }
  // the zoom asked for, twice that in cave mode (at most 6)
  zoomTarget() {
    const z = Math.max(1, Math.min(6, +this.o.get('minimapZoom') || 1));
    return this.cave ? Math.min(6, Math.round(z * 2)) : z;
  }

  /* ---- one chunk into its 16 x 16 slot ---- */
  paint(w, c, cave) {
    const d = this.img.data, bl = c.blocks;
    const top = cave ? this.caveTop : 0;
    const hN = this.heights;
    // the heights of the row north of this chunk, for its first row's shading
    const n = w.chunkXZ(c.cx, c.cz - 1);
    for (let x = 0; x < 16; x++) {
      if (!n) { hN[x] = -1; continue; }
      const col = (15 << 4) | x;
      const p = cave ? this.caveCol(n.blocks, col, top) : this.surfCol(n.blocks, col, n.top);
      hN[x] = p < 0 ? -1 : (p >> 8);
    }
    /* the light (MinimapWriter): (9 + the brighter of the block light and the sky light by the time of
       day) / 24. The End is "end-like" (ambient light 0.25, and it flashes), so the mod turns its
       lighting off and draws it at full brightness; the Nether has no sky light, so every block gets
       one fixed sky level, the mod's sun brightness there: ambient x 24 / 15 (0.16, its sky light
       factor being 0) times 15 */
    const lit = this.o.get('minimapLighting') !== false && w.dim !== 'the_end';
    const skyOn = w.dim === 'overworld', fixedSky = skyOn ? 0 : NETHER_SKY * 15;
    const lv = this.level || 0, skyF = lv === 0 ? 1 : (4 - lv) / 4;
    const L = c.light, LH = c.lightH;
    const wx0 = c.cx * 16, wz0 = c.cz * 16;
    for (let x = 0; x < 16; x++) {
      let prevH = hN[x];
      for (let z = 0; z < 16; z++) {
        const col = (z << 4) | x, o = (z * 16 + x) * 4;
        const p = cave ? this.caveCol(bl, col, top) : this.surfCol(bl, col, c.top);
        // (nothing found in a loaded chunk: black; the mod draws no block there)
        if (p < 0) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255; prevH = -1; continue; }
        const h = p >> 8, base = p & 255;
        let shade;
        if (base === 12) {
          // water: darker the deeper, with a checkerboard between the bands (the game's map)
          let depth = 0, yy = h - 1;
          while (yy > 0 && depth < 16 && FLUID[bl[(yy << 8) | col]] === 1) { depth++; yy--; }
          const k = depth * 0.1 + ((wx0 + x + wz0 + z) & 1) * 0.2;
          shade = k < 0.5 ? 2 : k > 0.9 ? 0 : 1;
        } else {
          const k = prevH < 0 ? 0 : (h - prevH) * 0.8 + (((wx0 + x + wz0 + z) & 1) - 0.5) * 0.4;
          shade = k > 0.6 ? 2 : k < -0.6 ? 0 : 1;
        }
        const rgb = MAP_RGB[base * 4 + shade];
        let f = 1;
        if (lit) {
          // the light just over the block (the chunk's own, flooded with its mesh)
          const ly = h + 1;
          let sky, blk;
          if (ly >= H) { sky = 15; blk = 0; }
          else if (L) { if (ly >= LH) { sky = 15; blk = 0; } else { const v = L[(ly << 8) | col]; sky = v >> 4; blk = v & 15; } }
          else { sky = cave ? 0 : 15; blk = 0; }
          f = (9 + Math.max(skyOn ? skyF * sky : fixedSky, blk)) / 24;
        }
        d[o] = (rgb >> 16) * f; d[o + 1] = ((rgb >> 8) & 255) * f; d[o + 2] = (rgb & 255) * f; d[o + 3] = 255;
        prevH = h;
      }
    }
    this.rctx.putImageData(this.img, (c.cx & MASK) * 16, (c.cz & MASK) * 16);
  }
  // the top block that shows on a map: height * 256 + base colour, or -1
  surfCol(bl, col, top) {
    for (let y = Math.min(H - 1, (top === undefined ? H - 1 : top) + 1); y > 0; y--) {
      const b = bl[(y << 8) | col];
      if (!b) continue;
      const base = mapColourOf(b);
      if (base) return (y << 8) | base;
    }
    return -1;
  }
  /* The cave slice from height top, 30 blocks down (MinimapWriter.findBlock in cave mode): the
     first block under open space (a liquid shows at once); rock all the way is left black. */
  caveCol(bl, col, top) {
    const lo = Math.max(1, top - 29);
    let air = false;
    for (let y = top; y >= lo; y--) {
      const b = bl[(y << 8) | col];
      if (b && FLUID[b]) { const m = mapColourOf(b); if (m) return (y << 8) | m; }
      if (open(b)) { air = true; continue; }
      if (air) return (y << 8) | mapColourOf(b);
    }
    return -1;
  }

  /* ---- drawing ---- */
  draw(game, feet, yaw, alpha, dt) {
    const o = this.o, s = this.unit(), size = this.sizeUnits(s), side = size * s;
    const dpr = window.devicePixelRatio || 1, css = v => (v / dpr) + 'px';
    const font = this.gui.font;
    // the lines under it: "x, y, z", or "x, z" and "y" when wider than the map (the mod's coordinates)
    const lines = this._lines || (this._lines = []);
    lines.length = 0;
    if (o.get('minimapCoords') !== false) {
      const X = Math.floor(feet.x), Y = Math.floor(feet.y + Y0), Z = Math.floor(feet.z);
      const all = X + ', ' + Y + ', ' + Z;
      if (font && font.width(all) >= size) lines.push(X + ', ' + Z, '' + Y); else lines.push(all);
    }
    if (o.get('minimapBiome')) lines.push(biomeName(BIOMES[game.world.biomeAt(Math.floor(feet.x), Math.floor(feet.z))]));
    const x0 = 9 * s, y0 = 9 * s;                               // the map's corner, in screen pixels
    if (this.dpr !== dpr || this.side !== side || this.s !== s) {
      this.dpr = dpr; this.side = side; this.s = s;
      Object.assign(this.box.style, { left: css(x0), top: css(y0), width: css(side), height: css(side) });
      for (const e of [this.invEl, this.dynEl]) { e.width = e.height = side; Object.assign(e.style, { left: css(x0), top: css(y0), width: css(side), height: css(side) }); }
      this.dotEl.width = this.dotEl.height = side; Object.assign(this.dotEl.style, { width: css(side), height: css(side) });
      this.statKey = ''; this.viewKey = ''; this.dotKey = ''; this.dynKey = ''; this.invKey = '';
    }
    if (!this.shown) { this.root.style.display = ''; this.shown = true; this.statKey = ''; }
    const north = this.northUp(size);
    // the zoom eases to where it is going (cave mode zooms in), as the mod's does
    const zt = this.zoomTarget();
    if (!this.zoom) this.zoom = zt;
    else if (this.zoom !== zt) { const off = (zt - this.zoom) * Math.pow(0.8, dt * 60); this.zoom = Math.abs(off) < 0.01 ? zt : zt - off; }
    const ppb = this.zoom * s / 2;
    // the ground round you (copied again only when you cross a block or a chunk changed)
    this.view(feet, side * 0.5 * Math.SQRT2 / ppb + 2, ppb, dpr);
    /* the dots: each place turned about the middle as the ground is (the CSS rotate below: x' =
       x cos - y sin, y' = x sin + y cos), each sprite drawn upright there; drawn again only when
       a dot's place on the screen or its look changed */
    const dots = o.get('minimapEntities') !== false ? this.dots(game, feet, alpha, side * 0.5 * Math.SQRT2 / ppb + 2) : null;
    const cell = s / 2, hs = side / 2;
    const cos = north ? 1 : Math.cos(yaw), sin = north ? 0 : Math.sin(yaw);
    let dk = dots ? dots.n : -1;
    if (dots) {
      for (let i = 0; i < dots.n; i++) {
        const e = dots[i], spr = this.sprite(e.k, e.b, this.cave, cell);
        const px = e.dx * ppb, pz = e.dz * ppb;
        e.sx = Math.round(hs + px * cos - pz * sin - spr.width / 2);
        e.sy = Math.round(hs + px * sin + pz * cos - spr.height / 2);
        e.spr = spr;
        dk = (Math.imul(dk, 31) + e.sx * 7919 + e.sy * 104729 + spr.width) | 0;
        dk = (Math.imul(dk, 17) + (e.k.length * 37 + Math.round(e.b * 20))) | 0;
      }
    }
    dk = dk + ',' + side + ',' + (this.cave ? 1 : 0);
    if (dk !== this.dotKey) {
      this.dotKey = dk;
      const d = this.dctx;
      d.clearRect(0, 0, side, side);
      if (dots) for (let i = 0; i < dots.n; i++) { const e = dots[i]; d.drawImage(e.spr, e.sx, e.sy); }
    }
    // the turn: about the map's middle, by your yaw (none with north up), your place at the middle
    const tr = 'translate(' + css(side / 2) + ',' + css(side / 2) + ')' + (north ? '' : ' rotate(' + yaw.toFixed(4) + 'rad)') +
      ' translate(' + css(-(feet.x - this.vx0) * ppb) + ',' + css(-(feet.z - this.vz0) * ppb) + ')';
    if (tr !== this.trShown) { this.trShown = tr; this.turn.style.transform = tr; }
    // the frame and the lines under it
    const sk = side + ',' + s + ',' + lines.join('|') + ',' + (font ? 1 : 0);
    if (sk !== this.statKey) { this.statKey = sk; this.drawStatic(size, s, lines, font, css); }
    // the crosshair's inverting part (only with the map turning)
    const ik = north ? 'n' : 'c' + s;
    if (ik !== this.invKey) {
      this.invKey = ik;
      const c = this.ictx, h = side / 2, u = s / 2;
      c.clearRect(0, 0, side, side);
      if (!north) {
        c.fillStyle = '#fff';
        c.fillRect(h - 5 * u, h - u, 10 * u, 2 * u);
        c.fillRect(h - u, h + 3 * u, 2 * u, 2 * u);
        c.fillRect(h - u, h - 5 * u, 2 * u, 2 * u);
      }
    }
    // the compass letters, and the crosshair's arms or the arrow: drawn when you turned
    const yk = (north ? 'n' + yaw.toFixed(3) : yaw.toFixed(3)) + ',' + s + ',' + side + ',' + (font ? 1 : 0);
    if (yk !== this.dynKey) { this.dynKey = yk; this.drawDynamic(side, s, north, yaw, font); }
  }

  // the frame (the Default frame's four rings) and the lines under the map: drawn when they change
  drawStatic(size, s, lines, font, css) {
    const el = this.statEl, W = (size + 18) * s, Ht = (size + 18) * s + lines.length * 10 * s;
    if (el.width !== W || el.height !== Ht) { el.width = W; el.height = Ht; el.style.width = css(W); el.style.height = css(Ht); }
    const c = this.sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, Ht);
    c.imageSmoothingEnabled = false;
    // ring k: a square (size + 8 - 2k) units across from (5 + k, 5 + k)
    for (let k = 0; k < 4; k++) {
      const [lt, dk, cn] = FRAME[k];
      const a = (5 + k) * s, n = (size + 8 - 2 * k) * s, b = a + n - s;
      c.fillStyle = rgbCss(lt, lt, lt); c.fillRect(a, a, n, s); c.fillRect(a, a, s, n);
      c.fillStyle = rgbCss(dk, dk, dk); c.fillRect(a, b, n, s); c.fillRect(b, a, s, n);
      if (k) { c.fillStyle = rgbCss(cn, cn, cn); c.fillRect(b, a, s, s); c.fillRect(a, b, s, s); }
    }
    if (!font || !lines.length) return;
    // centred under the module, 5 units below the frame, white with the game's shadow
    let ty = size + 18;
    c.setTransform(s, 0, 0, s, 0, 0);
    for (const t of lines) { font.draw(c, t, Math.round((size + 18) / 2 - font.width(t) / 2), ty, 0xFFFFFF, true); ty += 10; }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  // the compass letters (On Map) and what marks you in the middle
  drawDynamic(side, s, north, yaw, font) {
    const c = this.yctx, h = side / 2, u = s / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, side, side);
    c.imageSmoothingEnabled = false;
    if (!north) {
      // the crosshair's white arms (its middle and ends invert what is under them: invEl)
      c.fillStyle = '#fff';
      c.fillRect(h + u, h - u, 2 * u, 2 * u); c.fillRect(h - 3 * u, h - u, 2 * u, 2 * u);
      c.fillRect(h - u, h + u, 2 * u, 2 * u); c.fillRect(h - u, h - 3 * u, 2 * u, 2 * u);
    } else {
      // the arrow, pointing your way, with a faint black copy a unit above and a darker one below
      const a = 0.375 * s;                                    // a texture pixel of the mod's arrow
      const path = () => {
        c.beginPath();
        c.moveTo(0, -18 * a); c.lineTo(13 * a, 6 * a); c.lineTo(0, 1 * a); c.lineTo(-13 * a, 6 * a); c.closePath();
      };
      for (const [dy, col, al] of [[-s, '#000', 0.3], [s, '#000', 0.5], [0, ARROW, 1]]) {
        c.setTransform(1, 0, 0, 1, h, h + dy);
        c.rotate(-yaw);
        c.globalAlpha = al; c.fillStyle = col; path(); c.fill();
      }
      c.globalAlpha = 1;
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (!font) return;
    // N, E, S, W where each direction leaves the map, a little inside its edge, on a blue square
    const cs = Math.ceil(s / 2), spec = h - 3.5 * s - 3 * cs;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const [L, dx, dz] of COMPASS) {
      const vx = north ? dx : dx * cos - dz * sin, vy = north ? dz : dx * sin + dz * cos;
      const k = spec / Math.max(Math.abs(vx), Math.abs(vy));
      const px = Math.round(h + vx * k - 1), py = Math.round(h + vy * k - 1);
      const halfW = Math.floor(font.width(L) / 2) - 1;
      c.setTransform(cs, 0, 0, cs, px, py);
      c.fillStyle = COMPASS_BG; c.fillRect(-4, -4, 9, 9);
      font.draw(c, L, -halfW + 1, -2, COMPASS_SHADOW, false);
      font.draw(c, L, -halfW, -3, 0xFFFFFF, false);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* a dot's picture: the mod's diamond, 9 half units across, the colour inside a black rim; darker
     (on the surface) or fainter (in cave mode) by the height fade; made once per look */
  sprite(k, b, cave, cell) {
    const key = k + b + (cave ? 'c' : 's') + cell, m = this.sprites || (this.sprites = new Map());
    let v = m.get(key);
    if (v) return v;
    const small = document.createElement('canvas'); small.width = small.height = 9;
    const g = small.getContext('2d'), id = g.createImageData(9, 9), px = id.data;
    const [r, gg, bb] = DOT[k];
    const f = cave ? 1 : b, al = cave ? b : 1;
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const dx = Math.abs(x - 4), dy = Math.abs(y - 4), sum = dx + dy, i = (y * 9 + x) * 4;
      if (sum > 5) continue;
      if (sum <= 3) { px[i] = r * f; px[i + 1] = gg * f; px[i + 2] = bb * f; } else px[i] = px[i + 1] = px[i + 2] = 0;
      px[i + 3] = 255 * al;
    }
    g.putImageData(id, 0, 0);
    const n = Math.max(1, Math.round(9 * cell));
    v = document.createElement('canvas'); v.width = v.height = n;
    const c2 = v.getContext('2d');
    c2.imageSmoothingEnabled = true;                    // the mod's Smooth Dots
    c2.drawImage(small, 0, 0, n, n);
    m.set(key, v);
    return v;
  }

  /* The ring's part round you, copied north-up into the ground's canvas, in
     up to four pieces where the ring wraps: copied again only when you cross
     a block or a chunk was worked out, never just for turning (the CSS
     transform turns it). Shown at ppb screen pixels a block, pixelated. */
  view(feet, R, ppb, dpr) {
    const n = Math.ceil(R) * 2 + 2, bx0 = Math.floor(feet.x) - (n >> 1), bz0 = Math.floor(feet.z) - (n >> 1);
    const v = this.viewEl;
    if (v.width !== n || this.viewPpb !== ppb || this.viewDpr !== dpr) {
      if (v.width !== n) { v.width = v.height = n; this.viewKey = ''; }
      this.viewPpb = ppb; this.viewDpr = dpr;
      v.style.width = v.style.height = (n * ppb / dpr) + 'px';
    }
    const key = bx0 + ',' + bz0 + ',' + this.painted + ',' + n;
    if (key === this.viewKey) return v;
    this.viewKey = key; this.vx0 = bx0; this.vz0 = bz0;
    const c = this.vctx, bx1 = bx0 + n, bz1 = bz0 + n;
    c.clearRect(0, 0, n, n);
    const mod = q => ((q % S) + S) % S;
    for (let z = bz0; z < bz1;) {
      const tz = mod(z), hz = Math.min(bz1 - z, S - tz);
      for (let x = bx0; x < bx1;) {
        const tx = mod(x), wx = Math.min(bx1 - x, S - tx);
        c.drawImage(this.ring, tx, tz, wx, hz, x - bx0, z - bz0, wx, hz);
        x += wx;
      }
      z += hz;
    }
    return v;
  }

  /* ---- the entity radar: what is near, in Xaero's default categories ---- */
  dots(game, feet, alpha, reach) {
    const out = this._dots || (this._dots = []);
    out.n = 0;
    let sig = 0;
    const fy = feet.y;
    const add = (x, y, z, k, unlimited) => {
      const dx = x - feet.x, dz = z - feet.z;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) return;
      // the height: left out past 20 blocks up or down (not players); darker from 5 blocks under you
      const off = fy - y;
      if (!unlimited && Math.abs(off) > HEIGHT_LIMIT) return;
      const level = Math.max(0, HEIGHT_LIMIT - off);
      const b = level <= FADE_FROM ? Math.round((0.25 + 0.5 * level / FADE_FROM) * 20) / 20 : 1;
      const r = out[out.n] || (out[out.n] = { dx: 0, dz: 0, k: '', b: 1, ord: 0 });
      out.n++;
      r.dx = dx; r.dz = dz; r.k = k; r.b = b; r.ord = DOT[k][3];
      sig = (Math.imul(sig, 31) + ((x * 4) | 0) * 7 + ((z * 4) | 0) * 13 + ((b * 20) | 0)) | 0;
    };
    const E = game.entities;
    if (E && E.list) {
      for (const e of E.list) {
        if (e.removed || e.dead || !e.pos) continue;
        // living things (but armour stands) are mobs, hostile or not; anything else is "other"
        const living = e.maxHealth !== undefined && e.constructor.name !== 'ArmorStand';
        const k = living ? (e.constructor.HOSTILE ? 'hostile' : 'mob') : 'other';
        const p = e.prev || e.pos;
        add(p.x + (e.pos.x - p.x) * alpha, p.y + (e.pos.y - p.y) * alpha, p.z + (e.pos.z - p.z) * alpha, k, false);
      }
    }
    const D = game.drops;
    if (D) {
      if (D.items) for (const it of D.items) if (it && it.pos && !it.removed) add(it.pos.x, it.pos.y, it.pos.z, 'item', false);
      // experience orbs are entities of their own in the game: "other"
      if (D.orbs) for (const ob of D.orbs) if (ob && ob.pos && !ob.gone) add(ob.pos.x, ob.pos.y, ob.pos.z, 'other', false);
    }
    const P = game.net && game.net.players;
    if (P && P.list) {
      for (const r of P.list.values()) {
        if (!r.av || !r.P || !r.av.mesh || !r.av.mesh.visible) continue;
        add(r.P.pos.x, r.P.pos.y, r.P.pos.z, 'player', true);
      }
    }
    // the categories' render order: other, items, mobs, hostile mobs, players on top
    if (out.n > 1) {
      const live = out.slice(0, out.n).sort((a, b) => a.ord - b.ord);
      for (let i = 0; i < live.length; i++) out[i] = live[i];
    }
    out.sig = sig + ':' + out.n;
    return out;
  }
}

/* ------------------------------ Minimap Settings ------------------------------ */

export class MinimapSettingsScreen extends OptionsListScreen {
  constructor() { super('Minimap Settings'); }
  rows(list) {
    const o = this.options;
    const cyc = (label, key, values, format, tip) => {
      let v = o.get(key);
      if (!values.includes(v)) v = values[0];
      const b = new CycleButton(0, 0, 150, 20, label, { values, value: v, format, onChange: v => o.set(key, v) });
      if (tip) b.tooltip = tip;
      return b;
    };
    // (an option left unset counts as its default: on for these, off for the rest)
    const tog = (label, key, tip) => { const b = cyc(label, key, [false, true], onOff, tip); if (o.get(key) === undefined) { b.value = true; b._msg(); } return b; };
    const off = (label, key, tip) => cyc(label, key, [false, true], onOff, tip);
    list.entries = [
      new WidgetRow(off('Minimap', 'minimap'), cyc('Size', 'minimapSize', MINIMAP_SIZES, v => v === 'auto' ? 'Auto' : String(v),
        'Size of the minimap frame. A square minimap stays north up when the size is greater than 180.')),
      new WidgetRow(cyc('Zoom', 'minimapZoom', MINIMAP_ZOOMS, v => String(v), 'The minimap zooms in twice as far again in cave mode.'),
        off('Lock Minimap North', 'minimapNorth', 'ON: north stays at the top and an arrow shows your way. OFF: the map turns with you.')),
      new WidgetRow(tog('Display Coordinates', 'minimapCoords'), tog('Entity Radar', 'minimapEntities', 'Dots for players (white), mobs (yellow), items (red) and other entities (purple).')),
      new WidgetRow(cyc('Auto Cave Mode', 'minimapCave', ['auto', 'off'], v => v === 'auto' ? '3x3 Ceiling' : 'OFF', 'Under a 3x3 ceiling the map shows the open spaces from just over your head down. The Nether is always shown this way.'),
        tog('Lighting', 'minimapLighting', 'The map darkens at night and in caves, and torches light it, as the world does.')),
      new WidgetRow(off('Display Current Biome', 'minimapBiome')),
    ];
    // a lone half-width button stays half width
    list.entries[4].children[0].wide = false;
  }
}

// the Minimap button in the game menu, and its settings beside it
export function minimapButtons(x, y, w, o, gui) {
  const b = new CycleButton(x, y, w - 22, 20, 'Minimap', { values: [false, true], value: !!o.get('minimap'), format: onOff, onChange: v => o.set('minimap', v) });
  const s = new Button(x + w - 20, y, 20, 20, '...', () => gui.open(new MinimapSettingsScreen()));
  s.tooltip = 'Minimap Settings...';
  return [b, s];
}
