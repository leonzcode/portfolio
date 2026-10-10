/* ---------------------------------------------------------------------------
   Leoncraft 2 - the minimap, after Xaero's Minimap and its defaults.

   What Xaero's shows when it is first put in, and so what this shows:

     where           the top left corner, a little in from the edges
     shape           a square, opaque, with a thin dark frame
     turning         the map turns with you and the arrow points up (Lock
                     North off); with Lock North on, north stays up and the
                     arrow turns instead
     the arrow       red, at the middle, a little larger than the dots
     compass         N, E, S and W on the map's edge, where those directions are
     entity radar    dots with a dark rim: players white with their names over
                     them, mobs yellow (hostile and friendly alike: Xaero's
                     defaults give both the same yellow), dropped items red,
                     boats and minecarts purple; a dot well above or below you
                     is drawn fainter
     under it        the coordinates "x, y, z" (biome off, as in Xaero's)
     cave mode       automatic: with a roof over your head (a cave, a house)
                     the map shows a slice at your height, floors of the open
                     spaces round you, and rock black
     the Nether      always in cave mode, at your height (Xaero's does too);
                     the End shows its islands from above over the void

   What it is drawn from: the loaded chunks' top blocks, in the colours the
   game's own maps use (maps.js MAP_RGB: the 62 base colours in their four
   shades), shaded by height the way a map is (lighter where higher than the
   block north of it, darker where lower, water by its depth). Each chunk is
   worked out once into a 16 x 16 piece of a big picture that wraps round
   (a ring of 64 x 64 chunks), and again only when its mesh changes (a block
   changed there) or the slice changes (cave mode, a new height); a few a
   frame, nearest first, in a fraction of a millisecond. Each frame the map
   itself is only that picture drawn turned and scaled, plus the dots: it lives
   on its own small canvas under the GUI's (the GUI's blur and darkening fall
   on it under a menu, as on the HUD), so the HUD is never drawn again for it.

   Options (Options, kept with the rest): minimap, minimapSize, minimapZoom,
   minimapNorth, minimapCoords, minimapEntities, minimapCave, minimapBiome.
--------------------------------------------------------------------------- */
import { MAP_RGB, mapColourOf } from '../maps.js?v=39';
import { FLUID, BLOCKS } from '../blocks.js?v=39';
import { BIOMES } from '../biomes.js?v=39';
import { H, Y0 } from '../world-const.js?v=39';
import { Button, CycleButton, WidgetRow, OptionsListScreen, onOff } from './gui.js?v=39';

const N = 64, S = N * 16;          // the ring: chunks across, and pixels
const MASK = N - 1;
// map sizes in GUI pixels (auto: a quarter of the screen's short side, held to 60..100)
export const MINIMAP_SIZES = { auto: 0, small: 48, medium: 64, large: 88, huge: 112 };
const SIZE_NAMES = { auto: 'Auto', small: 'Small', medium: 'Medium', large: 'Large', huge: 'Huge' };
export const MINIMAP_ZOOMS = [1, 1.5, 2, 3, 4, 6];
// Xaero's default colours (Minecraft's chat colours by number: 15 white, 14 yellow, 12 red, 5 dark purple)
const COL = { player: '#FFFFFF', mob: '#FFFF55', hostile: '#FFFF55', item: '#FF5555', other: '#AA00AA' };
const ARROW = '#D02020';
const BUDGET = 0.35;               // ms a frame for working out chunks

const biomeName = b => !b || !b.name ? '' : b.name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
// a block the cave slice sees through (air, torches, glass...: nothing that shows on a map)
const open = b => !b || !mapColourOf(b);

export class Minimap {
  constructor(gui, options) {
    this.gui = gui; this.o = options;
    this.ring = document.createElement('canvas');
    this.ring.width = this.ring.height = S;
    this.rctx = this.ring.getContext('2d', { alpha: true });
    this.img = this.rctx.createImageData(16, 16);
    this.owner = new Array(N * N).fill(null);    // the chunk object each slot shows
    this.ver = new Int32Array(N * N).fill(-1);   // its mesh version then
    this.mode = new Array(N * N).fill('');       // the slice it was made for
    this.queue = []; this.scanT = 0;
    this.world = null; this.modeKey = 'S';
    this.cave = false; this.caveAt = '';
    this.el = null; this.shown = false;
    this.cost = 0; this.tileMs = 0;            // ms a frame, eased (tests read them)
    this.last = '';
    this.heights = new Int16Array(16);
  }

  /* ---- the canvas ---- */
  ensure() {
    if (this.el) return;
    const c = this.el = document.createElement('canvas');
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '4', display: 'none' });
    this.ctx = c.getContext('2d');
    document.body.appendChild(c);
  }
  hide() {
    if (this.shown && this.el) { this.el.style.display = 'none'; this.shown = false; }
  }
  // the map's side in GUI pixels
  sizeGui() {
    const g = this.gui, k = this.o.get('minimapSize') || 'auto';
    const fixed = MINIMAP_SIZES[k];
    return fixed || Math.max(60, Math.min(100, Math.round(Math.min(g.width, g.height) * 0.25)));
  }

  /* ---- once a frame ----
     game null: not playing (the title, a loading screen, travelling) */
  frame(game, feet, yaw, alpha) {
    // (whatever goes wrong here must never stop the frame it is called from)
    try { this.frame1(game, feet, yaw, alpha); } catch (e) { if (!this.warned) { this.warned = true; console.error(e); } }
  }
  frame1(game, feet, yaw, alpha) {
    const t0 = performance.now();
    const g = this.gui, o = this.o;
    const on = !!game && o.get('minimap') && g.inGame && !g.hideHud && !(this.hud && this.hud.debug) && !!feet;
    if (!on) { this.hide(); return; }
    this.ensure();
    const world = game.world;
    if (world !== this.world) this.reset(world);
    this.tiles(game, feet, t0);
    this.draw(game, feet, yaw, alpha);
    const ms = performance.now() - t0;
    this.cost = this.cost ? this.cost * 0.95 + ms * 0.05 : ms;
  }
  // a new world or dimension: the ring is emptied
  reset(world) {
    this.world = world;
    this.owner.fill(null); this.ver.fill(-1); this.mode.fill('');
    this.rctx.clearRect(0, 0, S, S);
    this.queue.length = 0; this.caveAt = ''; this.last = '';
  }

  /* ---- which slice: the surface, or cave mode at your height ---- */
  slice(game, feet) {
    const w = game.world, bx = Math.floor(feet.x), by = Math.floor(feet.y), bz = Math.floor(feet.z);
    const where = bx + ',' + by + ',' + bz;
    if (where !== this.caveAt) {
      this.caveAt = where;
      const nether = w.dim === 'the_nether';
      let roof = false;
      if (nether) roof = true;
      else if (this.o.get('minimapCave') !== 'off') {
        // a roof: anything that blocks the sky above your head (not leaves: a tree is no cave)
        for (let y = by + 2; y < H; y++) { const b = w.get(bx, y, bz); if (b && BLOCKS[b].opacity >= 15 && !/leaves/.test(BLOCKS[b].name)) { roof = true; break; } }
      }
      this.cave = roof;
      this.caveTop = Math.min(H - 1, Math.max(1, by + 2));
    }
    return this.cave ? 'C' + this.caveTop : 'S';
  }

  /* ---- the chunks round you: each worked out when new, changed, or on another slice ---- */
  tiles(game, feet, t0) {
    const w = game.world, key = this.slice(game, feet);
    const changed = key !== this.modeKey;
    this.modeKey = key;
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
          if (this.owner[s]) { this.owner[s] = null; this.ver[s] = -1; this.mode[s] = ''; this.rctx.clearRect((cx & MASK) * 16, (cz & MASK) * 16, 16, 16); }
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
      this.paint(w, c, key);
      this.owner[s] = c; this.ver[s] = v; this.mode[s] = key;
      // a new chunk changes the shading of the row south of it (its pixels compare with this one's)
      if (fresh) { const s2 = ((cz + 1) & MASK) * N + (cx & MASK); if (this.owner[s2]) this.ver[s2] = -2; }
      made++;
      this.dirty = true;
    }
    if (made) this.tileMs = this.tileMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  // how far from the middle the map reaches, in blocks (to its corners)
  reach() { return this.sizeGui() * this.gui.scale * 0.5 * Math.SQRT2 / this.ppb(); }
  // device pixels a block
  ppb() {
    const z = +this.o.get('minimapZoom') || 2;
    return Math.max(0.25, z * this.gui.scale / 4);
  }

  /* ---- one chunk into its 16 x 16 slot ---- */
  paint(w, c, key) {
    const d = this.img.data, bl = c.blocks;
    const cave = key !== 'S', top = cave ? this.caveTop : 0;
    const hN = this.heights;
    // the heights of the row north of this chunk, for its first row's shading
    const n = w.chunkXZ(c.cx, c.cz - 1);
    for (let x = 0; x < 16; x++) {
      if (!n) { hN[x] = -1; continue; }
      const col = (15 << 4) | x;
      const p = cave ? this.caveCol(n.blocks, col, top) : this.surfCol(n.blocks, col, n.top);
      hN[x] = p < 0 ? -1 : (p >> 8);
    }
    const wx0 = c.cx * 16, wz0 = c.cz * 16;
    for (let x = 0; x < 16; x++) {
      let prevH = hN[x];
      for (let z = 0; z < 16; z++) {
        const col = (z << 4) | x, o = (z * 16 + x) * 4;
        const p = cave ? this.caveCol(bl, col, top) : this.surfCol(bl, col, c.top);
        if (p < 0) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 0; prevH = -1; continue; }
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
        d[o] = rgb >> 16; d[o + 1] = (rgb >> 8) & 255; d[o + 2] = rgb & 255; d[o + 3] = 255;
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
  /* The cave slice at height top (just over your head): through up to three
     blocks of ceiling, then down through the open space to its floor; rock
     all the way (a wall) or no floor within 64 is left black. */
  caveCol(bl, col, top) {
    let y = top, k = 0;
    while (k < 3 && y > 0 && !open(bl[(y << 8) | col])) { y--; k++; }
    if (!open(bl[(y << 8) | col])) return -1;
    const lo = Math.max(0, top - 64);
    while (y > lo && open(bl[(y << 8) | col])) y--;
    const b = bl[(y << 8) | col];
    if (open(b)) return -1;
    return (y << 8) | mapColourOf(b);
  }

  /* ---- drawing ---- */
  draw(game, feet, yaw, alpha) {
    const g = this.gui, o = this.o, sc = g.scale;
    const size = this.sizeGui(), side = size * sc;            // the map, in device pixels
    const margin = 4 * sc, pad = 1 * sc;                        // from the corner; the frame
    const coords = o.get('minimapCoords') !== false, biome = !!o.get('minimapBiome');
    const lines = [];
    if (coords) lines.push(Math.floor(feet.x) + ', ' + Math.floor(feet.y + Y0) + ', ' + Math.floor(feet.z));
    if (biome) lines.push(biomeName(BIOMES[game.world.biomeAt(Math.floor(feet.x), Math.floor(feet.z))]));
    // (the canvas reaches past the map on the right, for coordinate lines wider than it)
    const W = margin + side + pad * 2 + 48 * sc, Ht = margin + side + pad * 2 + (lines.length ? lines.length * 10 * sc + 2 * sc : 0);
    const el = this.el, dpr = window.devicePixelRatio || 1;
    if (el.width !== W || el.height !== Ht || this.dpr !== dpr) {
      el.width = W; el.height = Ht; this.dpr = dpr;
      el.style.width = (W / dpr) + 'px'; el.style.height = (Ht / dpr) + 'px';
      this.last = '';
    }
    if (!this.shown) { el.style.display = ''; this.shown = true; this.last = ''; }
    const north = !!o.get('minimapNorth');
    const ppb = this.ppb();
    // the dots, worked out first: the map is drawn again only when something on it moved
    const dots = o.get('minimapEntities') !== false ? this.dots(game, feet, alpha) : [];
    const sig = (feet.x * ppb).toFixed(1) + ',' + (feet.z * ppb).toFixed(1) + ',' + (north ? 'n' : yaw.toFixed(3)) + ',' + ppb + ',' + side + ',' + lines.join('|') + ',' + dots.sig;
    if (sig === this.last && !this.dirty) return;
    this.last = sig; this.dirty = false;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, Ht);
    const x0 = margin + pad, y0 = margin + pad, cx = x0 + side / 2, cy = y0 + side / 2;
    // the frame: a thin dark line round an opaque square (unknown ground is black)
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x0 - pad, y0 - pad, side + pad * 2, side + pad * 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(x0, y0, side, side);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, side, side); ctx.clip();
    ctx.translate(cx, cy);
    if (!north) ctx.rotate(yaw);
    ctx.scale(ppb, ppb);
    ctx.translate(-feet.x, -feet.z);
    ctx.imageSmoothingEnabled = !north && ppb < 3;
    // the ring's part round you, in up to four pieces where it wraps
    const R = side * 0.5 * Math.SQRT2 / ppb + 1;
    const bx0 = Math.floor(feet.x - R), bx1 = Math.ceil(feet.x + R), bz0 = Math.floor(feet.z - R), bz1 = Math.ceil(feet.z + R);
    const mod = v => ((v % S) + S) % S;
    for (let z = bz0; z < bz1;) {
      const tz = mod(z), hz = Math.min(bz1 - z, S - tz);
      for (let x = bx0; x < bx1;) {
        const tx = mod(x), wx = Math.min(bx1 - x, S - tx);
        ctx.drawImage(this.ring, tx, tz, wx, hz, x, z, wx, hz);
        x += wx;
      }
      z += hz;
    }
    ctx.restore();
    // the dots: rims first, then the colours over them
    const rot = !north, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const rad = Math.max(1.5, sc * 0.75);
    const place = (dx, dz) => rot ? [cx + (dx * cs - dz * sn) * ppb, cy + (dx * sn + dz * cs) * ppb] : [cx + dx * ppb, cy + dz * ppb];
    const inside = (x, y) => x >= x0 + rad && x <= x0 + side - rad && y >= y0 + rad && y <= y0 + side - rad;
    const names = [];
    for (const e of dots) {
      const [x, y] = place(e.dx, e.dz);
      if (!inside(x, y)) continue;
      ctx.globalAlpha = e.a;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, rad + Math.max(1, sc * 0.4), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.c;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      if (e.name) names.push([x, y, e.name, e.a]);
    }
    ctx.globalAlpha = 1;
    // your arrow: red with a dark rim, pointing up (or your way, with Lock North on)
    ctx.save();
    ctx.translate(cx, cy);
    if (north) ctx.rotate(-yaw);
    const a = sc * 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -3.5 * a); ctx.lineTo(2.6 * a, 2.8 * a); ctx.lineTo(0, 1.3 * a); ctx.lineTo(-2.6 * a, 2.8 * a); ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, sc * 0.6); ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.fillStyle = ARROW; ctx.fill();
    ctx.restore();
    // the compass letters on the edge, where each direction leaves the map
    const font = this.gui.font;
    if (font) {
      const fs = Math.max(1, Math.floor(sc / 2)) || 1;
      const half = side / 2 - 5 * fs;
      for (const [L, dx, dz] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
        let vx = rot ? dx * cs - dz * sn : dx, vy = rot ? dx * sn + dz * cs : dz;
        const k = half / Math.max(Math.abs(vx), Math.abs(vy));
        const tx = cx + vx * k, ty = cy + vy * k;
        ctx.setTransform(fs, 0, 0, fs, Math.round(tx - font.width(L) * fs / 2), Math.round(ty - 4 * fs));
        font.draw(ctx, L, 0, 0, 0xFFFFFF, true);
      }
      // other players' names over their dots, small
      for (const [x, y, nm, al] of names) {
        ctx.globalAlpha = al;
        ctx.setTransform(fs, 0, 0, fs, Math.round(x - font.width(nm) * fs / 2), Math.round(y - rad - 10 * fs));
        font.draw(ctx, nm, 0, 0, 0xFFFFFF, true);
      }
      ctx.globalAlpha = 1;
      // the lines under the map, centred, the HUD's own text
      ctx.setTransform(sc, 0, 0, sc, 0, 0);
      let ty = (y0 + side + pad) / sc + 2;
      for (const s of lines) {
        font.draw(ctx, s, Math.max(1, Math.round((cx / sc) - font.width(s) / 2)), ty, 0xFFFFFF, true);
        ty += 10;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /* ---- the entity radar: what is near, as Xaero's colours ---- */
  dots(game, feet, alpha) {
    const out = this._dots || (this._dots = []);
    out.length = 0;
    let sig = '';
    const reach = this.reach() + 2, fy = feet.y;
    const add = (x, y, z, c, name) => {
      const dx = x - feet.x, dz = z - feet.z;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) return;
      // well above or below you: fainter (Xaero's entity height)
      const dy = y - fy, a = Math.abs(dy) > 6 ? 0.45 : 1;
      out.push({ dx, dz, c, a, name });
      sig += ((x * 4) | 0) + ':' + ((z * 4) | 0) + ':' + a + ';';
    };
    const E = game.entities;
    if (E && E.list) {
      for (const e of E.list) {
        if (e.removed || e.dead) continue;
        const k = e.maxHealth !== undefined ? (e.constructor.HOSTILE ? 'hostile' : 'mob') : /Boat|Minecart/.test(e.constructor.name) ? 'other' : null;
        if (!k || !e.pos) continue;
        const p = e.prev || e.pos;
        add(p.x + (e.pos.x - p.x) * alpha, p.y + (e.pos.y - p.y) * alpha, p.z + (e.pos.z - p.z) * alpha, COL[k]);
      }
    }
    const D = game.drops;
    if (D && D.items) for (const it of D.items) if (it && it.pos && !it.removed) add(it.pos.x, it.pos.y, it.pos.z, COL.item);
    const P = game.net && game.net.players;
    if (P && P.list) {
      for (const r of P.list.values()) {
        if (!r.av || !r.P || !r.av.mesh || !r.av.mesh.visible) continue;
        add(r.P.pos.x, r.P.pos.y, r.P.pos.z, COL.player, r.name);
      }
    }
    out.sig = sig;
    return out;
  }
}

/* ------------------------------ Minimap Settings ------------------------------ */

export class MinimapSettingsScreen extends OptionsListScreen {
  constructor() { super('Minimap Settings'); }
  rows(list) {
    const o = this.options;
    const cyc = (label, key, values, format, tip) => {
      const b = new CycleButton(0, 0, 150, 20, label, { values, value: o.get(key), format, onChange: v => o.set(key, v) });
      if (tip) b.tooltip = tip;
      return b;
    };
    const tog = (label, key, tip) => cyc(label, key, [false, true], onOff, tip);
    const zooms = MINIMAP_ZOOMS;
    list.entries = [
      new WidgetRow(tog('Minimap', 'minimap'), cyc('Size', 'minimapSize', Object.keys(MINIMAP_SIZES), v => SIZE_NAMES[v])),
      new WidgetRow(cyc('Zoom', 'minimapZoom', zooms, v => v.toFixed(1) + 'x'),
        cyc('Lock North', 'minimapNorth', [false, true], onOff, 'ON: north stays at the top and your arrow turns. OFF: the map turns with you.')),
      new WidgetRow(tog('Display Coordinates', 'minimapCoords'), tog('Entity Radar', 'minimapEntities', 'Dots for players (white), mobs (yellow), items (red) and boats and minecarts (purple).')),
      new WidgetRow(cyc('Cave Mode', 'minimapCave', ['auto', 'off'], v => v === 'auto' ? 'Auto' : 'OFF', 'Auto: under a roof the map shows the open spaces at your height. The Nether is always shown this way.'),
        tog('Display Biome', 'minimapBiome')),
    ];
  }
}

// the Minimap button in the game menu, and its settings beside it
export function minimapButtons(x, y, w, o, gui) {
  const b = new CycleButton(x, y, w - 22, 20, 'Minimap', { values: [false, true], value: !!o.get('minimap'), format: onOff, onChange: v => o.set('minimap', v) });
  const s = new Button(x + w - 20, y, 20, 20, '...', () => gui.open(new MinimapSettingsScreen()));
  s.tooltip = 'Minimap Settings...';
  return [b, s];
}
