/* ---------------------------------------------------------------------------
   Leoncraft 2 - item icons.

   Every block gets the little picture the inventory shows for it, made the
   way the classic game draws a block item in a 16 x 16 slot:

   - Cubes and shaped blocks (stairs, slabs, fences, walls, chests...) are
     drawn in 3D: orthographic, turned 30 degrees about X and 225 about Y,
     scaled to 0.625 of the slot (stairs, fences and walls use 135, as their
     models do). Each face is its 16 x 16 texture layer put through a 2D
     affine transform, back to front, with the top lit fully and the two
     sides shaded by the same two-light formula the game uses for items in
     the GUI. These are drawn at the GUI's real pixel size (16 x GUI scale),
     so edges are as sharp as the screen allows, and redrawn if the GUI
     scale changes.
   - Flat things (plants, torches, rails, panes, doors and signs with an
     item sprite, buckets) are the 16 x 16 sprite itself, which the GUI
     scales up pixel for pixel.

   Icons are made lazily, the first time something asks for one, into atlas
   canvases, and never all at once: draw() queues what is missing and
   pump(ms) makes as many as fit in a small time budget, so opening the
   search tab never freezes a frame. While anything is queued, `pending` is
   true and the screens keep redrawing until the icons land.

     const icons = new ItemIcons(albedoImage, { grassMap, foliageMap });
     icons.draw(gui, blockId, x, y);      // GUI pixels, top-left of the slot
--------------------------------------------------------------------------- */
import { DRAW, textureLayer } from '../items.js?v=107';
import { potionColour } from '../brewing.js?v=107';
import { trimPiece, applyTrim } from '../trims.js?v=107';

/* pictures coloured per stack: [the layer under, the layer over, which of the two takes the colour (0 the one
   under, 1 the one over)]. A potion's liquid goes under its bottle; dyed leather is its grey picture times the dye
   with the undyed parts over it; the wolf armour keeps its own picture with the dyed part over it, as in the game. */
const TINTED_PARTS = {
  potion: ['layer_potion_overlay', 'layer_potion', 0], splash_potion: ['layer_potion_overlay', 'layer_splash_potion', 0],
  lingering_potion: ['layer_potion_overlay', 'layer_lingering_potion', 0], tipped_arrow: ['layer_tipped_arrow_head', 'layer_tipped_arrow_base', 0],
  leather_helmet: ['layer_leather_helmet', 'layer_leather_helmet_overlay', 0],
  leather_chestplate: ['layer_leather_chestplate', 'layer_leather_chestplate_overlay', 0],
  leather_leggings: ['layer_leather_leggings', 'layer_leather_leggings_overlay', 0],
  leather_boots: ['layer_leather_boots', 'layer_leather_boots_overlay', 0],
  leather_horse_armor: ['layer_leather_horse_armor', 'layer_leather_horse_armor_overlay', 0],
  wolf_armor: ['wolf_armor', 'layer_wolf_armor_overlay', 1],
};
import { boxesOf } from '../models.js?v=107';

// face order and texture axes, exactly as the mesher lays textures on faces
const FACES = [
  { n: [1, 0, 0], t: [0, 0, -1], b: [0, -1, 0] },
  { n: [-1, 0, 0], t: [0, 0, 1], b: [0, -1, 0] },
  { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, 0, 1], t: [1, 0, 0], b: [0, -1, 0] },
  { n: [0, 0, -1], t: [-1, 0, 0], b: [0, -1, 0] },
];
const DEG = Math.PI / 180;

/* The game's GUI item lighting: two lights, 0.6 diffuse each plus 0.4
   ambient, in the space the item ends up in. These are the two light
   directions after the game's own setup for 3D items (worked out once). */
const L0 = [-0.93344, -0.26269, -0.24430], L1 = [-0.10357, -0.97661, 0.18845];

// how a model sits in the slot: turn about Y (degrees), scale, offset in GUI pixels
const D_BLOCK = { ry: 225, s: 0.625, tx: 0, ty: 0 };
const D_135 = { ry: 135, s: 0.625, tx: 0, ty: 0 };
const D_BED = { ry: 160, s: 0.5325, tx: 0, ty: 1 };
const D_HEAD = { ry: 45, s: 1, tx: 0, ty: 3 };
// a shelf mushroom: the small model facing north, at the game's own gui display for it
const D_SHELF = { ry: 225, s: 1, tx: 3.25, ty: -3 };
// a candle: the game draws its picture full size; the little candle, drawn twice as big and lifted to the middle, comes close
const D_CANDLE = { ry: 225, s: 1.25, tx: 0, ty: 6 };
// rods (end rods, lightning rods) stand upright in the slot and in the hand, as the game's models have them
for (const d of DRAW) if (d && d.shape === 'rod' && d.iconMeta === undefined) d.iconMeta = 4;

// shapes shown as their flat sprite
const FLAT = new Set(['cross', 'torch', 'wall_torch', 'fluid', 'none', 'pad', 'vine', 'rail', 'wire', 'crop', 'pane', 'ladder', 'chain']);

const box = (x0, y0, z0, x1, y1, z1, extra) => Object.assign({ f: [x0, y0, z0], t: [x1, y1, z1] }, extra || null);
const FULL = [box(0, 0, 0, 16, 16, 16)];

// the matrix for a display: Rx(30) * Ry(ry), and each face's light and facing
function displayOf(disp) {
  if (disp.m) return disp;
  const a = 30 * DEG, b = disp.ry * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // rows of Rx * Ry
  disp.m = [cb, 0, sb, sa * sb, ca, -sa * cb, -ca * sb, sa, ca * cb];
  disp.light = []; disp.facing = [];
  for (let f = 0; f < 6; f++) {
    const n = FACES[f].n, m = disp.m;
    const x = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
    const y = m[3] * n[0] + m[4] * n[1] + m[5] * n[2];
    const z = m[6] * n[0] + m[7] * n[1] + m[8] * n[2];
    disp.facing[f] = z;
    // the GUI flips y; the lights live in that flipped space
    const ny = -y;
    const d0 = Math.max(0, x * L0[0] + ny * L0[1] + z * L0[2]);
    const d1 = Math.max(0, x * L1[0] + ny * L1[1] + z * L1[2]);
    disp.light[f] = Math.min(1, (d0 + d1) * 0.6 + 0.4);
  }
  return disp;
}

/* What to draw for a block: { flat: layer, tint } or { boxes, disp, faces? }. */
function modelFor(d) {
  if (d.iconLayer !== undefined) return { flat: d.iconLayer, tint: !(typeof d.icon === 'string' && d.icon.startsWith('item_')) };
  const s = d.shape;
  if (!d.faces) return null;
  if (FLAT.has(s)) return { flat: s === 'pane' ? d.faces[0] : d.faces[2], tint: true };
  let boxes = null, disp = D_BLOCK;
  switch (s) {
    case 'cube': boxes = FULL; break;
    case 'snow': boxes = [box(0, 0, 0, 16, Math.max(1, (d.height || 0.125) * 16), 16)]; break;
    case 'stairs': boxes = boxesOf(d, d.iconMeta !== undefined ? d.iconMeta : 1); disp = D_135; break;
    // the game's own inventory models for these: two posts and two rails, a post and a side
    case 'fence': boxes = [box(6, 0, 0, 10, 16, 4), box(6, 0, 12, 10, 16, 16), box(7, 13, 0, 9, 15, 16), box(7, 5, 0, 9, 7, 16)]; disp = D_135; break;
    case 'wall': boxes = [box(4, 0, 4, 12, 16, 12), box(5, 0, 0, 11, 14, 16)]; disp = D_135; break;
    case 'button':
      if (d.name === 'shelf_mushroom' && d.L && d.L.sm00up > 0) { boxes = boxesOf(d, 4); disp = D_SHELF; break; }
      boxes = [box(5, 6, 6, 11, 10, 10)]; break;
    case 'chest': boxes = boxesOf(d, 1); break;           // the latch on the left face
    case 'bed': boxes = bedBoxes(d); disp = D_BED; break;
    case 'head': {
      // (a head's textures already sit where the 8 x 8 box projects onto them)
      const fc = d.faces.slice();
      if (d.front !== undefined) fc[1] = d.front;          // west: the face the game shows on the left
      if (d.back !== undefined) fc[0] = d.back;
      boxes = [box(4, 0, 4, 12, 8, 12, { faces: fc })];
      disp = D_HEAD;
      break;
    }
    default: {
      try { boxes = boxesOf(d, d.iconMeta || 0, () => null); } catch (e) { boxes = null; }
      if (s === 'candle') disp = D_CANDLE;
    }
  }
  if (boxes) boxes = boxes.filter(b => !b.q);
  if (!boxes || !boxes.length) return { flat: d.faces[0], tint: true };
  // a cube's front texture goes on its north face, as the game's models have it
  if (s === 'cube' && (d.front !== undefined || d.back !== undefined)) {
    const fc = d.faces.slice();
    if (d.front !== undefined) fc[5] = d.front;
    if (d.back !== undefined) fc[4] = d.back;
    boxes = [box(0, 0, 0, 16, 16, 16, { faces: fc })];
  }
  return { boxes, disp: displayOf(disp), cube: s === 'cube' };
}

// both halves of a bed lying along x, the pillow to the east (the left of the slot), centred on the slot's middle
function bedBoxes(d) {
  const head = boxesOf(d, 8 | 1) || [], foot = boxesOf(d, 1) || [];
  // moved, each box keeps the texture of where it was (o is the move)
  const shift = (list, dx) => list.filter(b => !b.q).map(b => Object.assign({}, b, { f: [b.f[0] + dx, b.f[1], b.f[2]], t: [b.t[0] + dx, b.t[1], b.t[2]], o: [dx, 0, 0] }));
  return shift(head, 8).concat(shift(foot, -8));
}

/* An atlas of equal cells across as many canvases as it needs. */
class Atlas {
  constructor(cell) {
    this.cell = cell;
    this.per = Math.max(1, Math.min(16, Math.floor(2048 / cell)));
    this.pages = [];
    this.n = 0;
  }
  alloc() {
    const per = this.per, i = this.n++, p = Math.floor(i / (per * per)), j = i % (per * per);
    let c = this.pages[p];
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = per * this.cell;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      this.pages[p] = c;
    }
    return { c, x: (j % per) * this.cell, y: Math.floor(j / per) * this.cell, w: this.cell };
  }
}

export class ItemIcons {
  /* albedo: the terrain strip (an Image, ImageBitmap or canvas, 16 px wide,
     one 16 x 16 layer under another). opts.grassMap / foliageMap: the colour
     map images (sampled where the game takes an item's default colour), or
     opts.colours = { grass, foliage, ... } as 0xRRGGBB. */
  constructor(albedo, opts = {}) {
    this.layers = Math.floor(albedo.height / 16);
    this.px = readStrip(albedo, this.layers);
    // the item pictures go on after the blocks, as in the texture array (see itemtex.js)
    if (opts.extra) {
      const n = Math.floor(opts.extra.height / 16), both = new Uint8ClampedArray((this.layers + n) * 1024);
      both.set(this.px, 0);
      both.set(readStrip(opts.extra, n), this.layers * 1024);
      this.px = both; this.layers += n;
    }
    const c = opts.colours || {};
    this.tints = {
      grass: c.grass ?? sampleMap(opts.grassMap) ?? 0x79C05A,
      foliage: c.foliage ?? sampleMap(opts.foliageMap) ?? 0x48B518,
      spruce: c.spruce ?? 0x619961,
      birch: c.birch ?? 0x80A755,
      water: c.water ?? 0x3F76E4,
      redstone: c.redstone ?? 0xFF0000,
    };
    this.flat = new Atlas(16);
    this.solid = null;          // the 3D atlas, at 16 x the GUI scale
    this.scale = 0;
    this.map = new Map();       // id -> entry { c, x, y, w } (ready), or { queued: true }
    this.queue = [];
    this.budget = opts.budget || 4;   // milliseconds of icon making per frame
    this._frame = -1; this._spent = 0;
    // one 16 x 16 face at a time is built here before it is drawn
    this.face = document.createElement('canvas');
    this.face.width = this.face.height = 16;
    this.fctx = this.face.getContext('2d');
    this.fimg = this.fctx.createImageData(16, 16);
  }

  get pending() { return this.queue.length > 0; }

  // the GUI scale changed: the 3D icons are redrawn at the new size, the flat ones stay
  setScale(scale) {
    scale = Math.max(1, scale | 0);
    if (scale === this.scale) return;
    this.scale = scale;
    this.solid = new Atlas(16 * scale);
    for (const [id, e] of this.map) if (e.solid) this.map.delete(id);
    this.queue.length = 0;
  }

  // queue ids ahead of time (a creative tab's contents, say)
  prewarm(ids) { for (const id of ids) this._entry(id); }

  _entry(id) {
    let e = this.map.get(id);
    if (!e) {
      e = { queued: true };
      this.map.set(id, e);
      this.queue.push(id);
    }
    return e;
  }

  /* Draws the icon for block `id` with its top-left at (x, y) in GUI pixels.
     Missing, it is made now if this frame still has icon time. Returns
     false while this one is not made yet (it is made in a later frame). */
  draw(g, id, x, y) {
    if (!id) return false;
    if (g.scale !== this.scale) this.setScale(g.scale);
    let e = this.map.get(id);
    if (!e || e.queued) {
      if (!e) e = this._entry(id);
      // one budget per frame, shared by every draw in it: this icon first, if there is time
      if (g.now !== this._frame) { this._frame = g.now; this._spent = 0; }
      if (this._spent >= this.budget) return false;
      const t0 = performance.now();
      const qi = this.queue.indexOf(id);
      if (qi >= 0) this.queue.splice(qi, 1);
      this._makeInto(id);
      this._spent += performance.now() - t0;
      e = this.map.get(id);
    }
    if (!e.c) return true;      // nothing to show for this block
    g.ctx.drawImage(e.c, e.x, e.y, e.w, e.w, x, y, 16, 16);
    return true;
  }

  /* A stack whose picture is coloured by what it holds or how it was dyed
     (potions, tipped arrows, dyed leather and wolf armour): made once per
     colour, kept with the flat icons. Undyed, it is the plain picture. */
  drawTinted(g, st, x, y) {
    const d = DRAW[st.id], parts = d && TINTED_PARTS[d.name];
    if (!parts) return this.draw(g, st.id, x, y);
    const col = st.potion ? potionColour(st) : st.color;
    if (typeof col !== 'number') return this.draw(g, st.id, x, y);
    const key = 't:' + d.name + ':' + col;
    let e = this.map.get(key);
    if (!e) {
      const under = textureLayer(parts[0]), over = textureLayer(parts[1]);
      if (under < 0 || over < 0) return this.draw(g, st.id, x, y);
      e = this.flat.alloc();
      this._fill(under, parts[2] ? -1 : col, 1, over, parts[2] ? col : -1);
      e.c.getContext('2d').putImageData(this.fimg, e.x, e.y);
      this.map.set(key, e);
    }
    g.ctx.drawImage(e.c, e.x, e.y, e.w, e.w, x, y, 16, 16);
    return true;
  }

  /* A trimmed armour piece (js/trims.js): its picture (dyed, for leather)
     with the trim over it in the trim material's colours, made once per
     piece, trim and dye, kept with the flat icons. */
  drawTrimmed(g, st, x, y) {
    const d = DRAW[st.id];
    if (!d || !st.trim || !trimPiece(d.name)) return this.draw(g, st.id, x, y);
    const parts = TINTED_PARTS[d.name], col = typeof st.color === 'number' ? st.color : -1;
    const key = 'r:' + d.name + ':' + st.trim.join(':') + ':' + col;
    let e = this.map.get(key);
    if (!e) {
      if (parts && col >= 0) {
        const under = textureLayer(parts[0]), over = textureLayer(parts[1]);
        if (under < 0 || over < 0) return this.draw(g, st.id, x, y);
        this._fill(under, parts[2] ? -1 : col, 1, over, parts[2] ? col : -1);
      } else {
        const layer = textureLayer(d.name);
        if (layer < 0) return this.draw(g, st.id, x, y);
        this._fill(layer, -1, 1, -1, -1);
      }
      applyTrim(this.fimg.data, d.name, st.trim);
      e = this.flat.alloc();
      e.c.getContext('2d').putImageData(this.fimg, e.x, e.y);
      this.map.set(key, e);
    }
    g.ctx.drawImage(e.c, e.x, e.y, e.w, e.w, x, y, 16, 16);
    return true;
  }

  /* One named picture of the item strip (a frame of a compass or a clock,
     js/dials.js), made once and kept with the flat icons. False when the
     strip has no such picture. */
  drawLayer(g, name, x, y) {
    const key = 'l:' + name;
    let e = this.map.get(key);
    if (!e) {
      const layer = textureLayer(name);
      if (layer < 0) return false;
      e = this.flat.alloc();
      this._fill(layer, -1, 1, -1, -1);
      e.c.getContext('2d').putImageData(this.fimg, e.x, e.y);
      this.map.set(key, e);
    }
    g.ctx.drawImage(e.c, e.x, e.y, e.w, e.w, x, y, 16, 16);
    return true;
  }

  // the canvas region of a ready icon, or null (for the integrator's own drawing)
  get(id) { const e = this.map.get(id); return e && !e.queued ? e : null; }

  /* Makes queued icons until ms milliseconds have gone (always at least
     one). Returns true when it made any. */
  pump(ms = 4) {
    if (!this.queue.length) return false;
    if (!this.scale) this.setScale(1);
    const t0 = performance.now();
    let made = false;
    while (this.queue.length && (!made || performance.now() - t0 < ms)) {
      this._makeInto(this.queue.shift());
      made = true;
    }
    return made;
  }
  _makeInto(id) {
    let e = { c: null };
    try { e = this._make(id) || e; } catch (err) { console.warn('icon failed for', id, err); }
    this.map.set(id, e);
  }

  _make(id) {
    const d = DRAW[id];
    if (!d || !d.faces) return null;
    const m = modelFor(d);
    if (!m) return null;
    if (m.flat !== undefined) {
      const slot = this.flat.alloc();
      this._fill(m.flat, m.tint ? this._tintOf(d) : -1, 1, -1, -1);
      slot.c.getContext('2d').putImageData(this.fimg, slot.x, slot.y);
      return slot;
    }
    const slot = this.solid.alloc();
    slot.solid = true;
    this._draw3d(d, m, slot);
    return slot;
  }

  _tintOf(d) { return d.tint && this.tints[d.tint] !== undefined ? this.tints[d.tint] : -1; }

  /* Fills the scratch 16 x 16 with one layer, multiplied by a tint
     (0xRRGGBB, or -1 for none) and a brightness, with an optional overlay
     layer (the grass on a grass block's side) laid over it, tinted. */
  _fill(layer, tint, bright, overLayer, overTint) {
    const src = this.px, out = this.fimg.data;
    const o = (layer >= 0 && layer < this.layers ? layer : 0) * 1024;
    const tr = tint >= 0 ? (tint >> 16 & 255) / 255 : 1, tg = tint >= 0 ? (tint >> 8 & 255) / 255 : 1, tb = tint >= 0 ? (tint & 255) / 255 : 1;
    const hasOver = overLayer >= 0 && overLayer < this.layers, oo = overLayer * 1024;
    const vr = overTint >= 0 ? (overTint >> 16 & 255) / 255 : 1, vg = overTint >= 0 ? (overTint >> 8 & 255) / 255 : 1, vb = overTint >= 0 ? (overTint & 255) / 255 : 1;
    for (let i = 0; i < 1024; i += 4) {
      let r = src[o + i] * tr, g = src[o + i + 1] * tg, b = src[o + i + 2] * tb, a = src[o + i + 3];
      if (hasOver) {
        const oa = src[oo + i + 3] / 255;
        if (oa > 0) {
          r = r * (1 - oa) + src[oo + i] * vr * oa;
          g = g * (1 - oa) + src[oo + i + 1] * vg * oa;
          b = b * (1 - oa) + src[oo + i + 2] * vb * oa;
          a = Math.max(a, src[oo + i + 3]);
        }
      }
      out[i] = r * bright; out[i + 1] = g * bright; out[i + 2] = b * bright; out[i + 3] = a;
    }
  }

  _draw3d(d, model, slot) {
    const disp = model.disp, M = disp.m, k = slot.w / 16;
    const ctx = slot.c.getContext('2d');
    ctx.save();
    ctx.beginPath(); ctx.rect(slot.x, slot.y, slot.w, slot.w); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    // a model point (sixteenths of a block) to device pixels in the cell
    const P = [0, 0, 0];
    const proj = (x, y, z) => {
      const vx = (x - 8) / 16, vy = (y - 8) / 16, vz = (z - 8) / 16;
      const sx = M[0] * vx + M[1] * vy + M[2] * vz;
      const sy = M[3] * vx + M[4] * vy + M[5] * vz;
      P[0] = slot.x + (8 + disp.tx + sx * 16 * disp.s) * k;
      P[1] = slot.y + (8 - disp.ty - sy * 16 * disp.s) * k;
      P[2] = M[6] * vx + M[7] * vy + M[8] * vz;
      return P;
    };
    // back to front by each box's middle
    const order = model.boxes.map(b => {
      proj((b.f[0] + b.t[0]) / 2, (b.f[1] + b.t[1]) / 2, (b.f[2] + b.t[2]) / 2);
      return { b, z: P[2] };
    }).sort((a, b) => a.z - b.z);
    const tint = this._tintOf(d), overlay = model.cube && d.overlay !== undefined ? d.overlay : -1;
    const PB = [0, 0, 0];
    for (const { b: bx } of order) {
      const faces = bx.faces || d.faces;
      for (let f = 0; f < 6; f++) {
        if (disp.facing[f] <= 1e-4) continue;              // facing away
        if (bx.skip && (bx.skip & (1 << f))) continue;
        const F = FACES[f], b0 = bx.f, b1 = bx.t;
        let kt = 0, kb = 0;
        for (let q = 0; q < 3; q++) { if (F.t[q]) kt = q; if (F.b[q]) kb = q; }
        // the face's corner at (u, v) in {0,1}, as the mesher finds it
        const corner = (u, v) => {
          for (let q = 0; q < 3; q++) {
            if (F.n[q]) PB[q] = F.n[q] > 0 ? b1[q] : b0[q];
            else if (q === kt) PB[q] = (F.t[q] > 0) === (u === 1) ? b1[q] : b0[q];
            else PB[q] = (F.b[q] > 0) === (v === 1) ? b1[q] : b0[q];
          }
          return PB;
        };
        const tex = (u, v) => {
          const c = corner(u, v);
          const uvr = bx.uv ? bx.uv[f] : null;
          if (uvr) return [u ? uvr[2] : uvr[0], v ? uvr[3] : uvr[1]];
          const pt = c[kt] - (bx.o ? bx.o[kt] : 0), pb = c[kb] - (bx.o ? bx.o[kb] : 0);
          return [F.t[kt] > 0 ? pt : 16 - pt, F.b[kb] > 0 ? pb : 16 - pb];
        };
        const c00 = corner(0, 0); const o = proj(c00[0], c00[1], c00[2]); const Ox = o[0], Oy = o[1];
        const c10 = corner(1, 0); const pu = proj(c10[0], c10[1], c10[2]); const Ux = pu[0] - Ox, Uy = pu[1] - Oy;
        const c01 = corner(0, 1); const pv = proj(c01[0], c01[1], c01[2]); const Vx = pv[0] - Ox, Vy = pv[1] - Oy;
        const [tu0, tv0] = tex(0, 0), [tu1] = tex(1, 0), [, tv1] = tex(0, 1);
        const du = tu1 - tu0, dv = tv1 - tv0;
        const lu = Math.hypot(Ux, Uy), lv = Math.hypot(Vx, Vy);
        if (Math.abs(du) < 1e-6 || Math.abs(dv) < 1e-6 || lu < 1e-3 || lv < 1e-3) continue;
        // grow each face half a pixel all round, so neighbouring faces leave no seam
        const eu = 0.5 / lu, ev = 0.5 / lv;
        const ox = Ox - Ux * eu - Vx * ev, oy = Oy - Uy * eu - Vy * ev;
        const a = Ux * (1 + 2 * eu) / du, bb = Uy * (1 + 2 * eu) / du;
        const c = Vx * (1 + 2 * ev) / dv, dd = Vy * (1 + 2 * ev) / dv;
        const side = f !== 2 && f !== 3;
        const layer = faces[f];
        if (overlay >= 0) this._fill(layer, f === 2 ? tint : -1, disp.light[f], side ? overlay : -1, tint);
        else this._fill(layer, tint, disp.light[f], -1, -1);
        this.fctx.putImageData(this.fimg, 0, 0);
        ctx.setTransform(a, bb, c, dd, ox - a * tu0 - c * tv0, oy - bb * tu0 - dd * tv0);
        const sx = Math.min(tu0, tu1), sy = Math.min(tv0, tv1);
        const sw = Math.abs(du), sh = Math.abs(dv);
        // keep the source inside the texture (a box poking past its block samples the edge)
        const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(16, sx + sw), y1 = Math.min(16, sy + sh);
        if (x1 - x0 > 1e-3 && y1 - y0 > 1e-3) ctx.drawImage(this.face, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.restore();
  }
}

// the strip's pixels, read in pieces (a single canvas that tall can fail)
function readStrip(img, layers) {
  const out = new Uint8ClampedArray(layers * 1024);
  const PIECE = 512;
  const c = document.createElement('canvas');
  c.width = 16; c.height = Math.min(layers, PIECE) * 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  for (let z = 0; z < layers; z += PIECE) {
    const n = Math.min(PIECE, layers - z);
    g.clearRect(0, 0, 16, c.height);
    g.drawImage(img, 0, z * 16, 16, n * 16, 0, 0, 16, n * 16);
    out.set(g.getImageData(0, 0, 16, n * 16).data, z * 1024);
  }
  return out;
}

// a colour map's colour where the game takes an item's default (temperature 0.5, rainfall 1)
function sampleMap(img) {
  if (!img || !img.width) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    const x = Math.floor(0.5 * (img.width - 1)), y = Math.floor(0.5 * (img.height - 1));
    g.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
    const p = g.getImageData(0, 0, 1, 1).data;
    return (p[0] << 16) | (p[1] << 8) | p[2];
  } catch (e) { return null; }
}
