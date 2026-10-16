/* ---------------------------------------------------------------------------
   Leoncraft 2 - Chameleon's paint (Leon Network, net/hub.js).

   A hider paints their own skin to blend into the map, as in the hide and
   seek painting games: the figure from the front and from behind, a palette,
   a brush and a fill for a whole body part. In the world, the Colour Picker
   takes a block's colour and the Block Stamp covers you in a block's own
   picture. The skin is a 64 x 64 canvas made from the one you wear (the old
   64 x 32 layout made whole, the outer layer cleared so the paint shows);
   each change is put on your model and sent to everyone as your skin for the
   game only (net.skinOverride), never kept as your skin setting.
--------------------------------------------------------------------------- */
import { Screen, Button, WHITE, GREY } from './gui.js?v=61';
import { BLOCKS } from '../blocks.js?v=61';

// the skin's parts in the 64 x 64 layout: every face of each, base layer only
export const PARTS = {
  head: [0, 0, 32, 16], body: [16, 16, 40, 32], rarm: [40, 16, 56, 32], rleg: [0, 16, 16, 32],
  larm: [32, 48, 48, 64], lleg: [16, 48, 32, 64],
};
// the outer layer (hat, jacket, sleeves, trousers): cleared for painting
const OUTER = [[32, 0, 64, 16], [16, 32, 40, 48], [40, 32, 56, 48], [0, 32, 16, 48], [48, 48, 64, 64], [0, 48, 16, 64]];

/* The figure as drawn on the screen, 16 x 32 a view: which skin pixel each of
   its pixels is (front: the right arm and leg on the viewer's left; back: the
   left ones are), and which part it belongs to. */
function texAt(back, fx, fy) {
  if (fy < 8) return fx >= 4 && fx < 12 ? [back ? 24 + fx - 4 : 8 + fx - 4, 8 + fy, 'head'] : null;
  if (fy < 20) {
    const y = fy - 8;
    if (fx < 4) return back ? [44 + fx, 52 + y, 'larm'] : [44 + fx, 20 + y, 'rarm'];
    if (fx < 12) return [back ? 32 + fx - 4 : 20 + fx - 4, 20 + y, 'body'];
    return back ? [52 + fx - 12, 20 + y, 'rarm'] : [36 + fx - 12, 52 + y, 'larm'];
  }
  const y = fy - 20;
  if (fx < 4 || fx >= 12) return null;
  if (fx < 8) return back ? [28 + fx - 4, 52 + y, 'lleg'] : [4 + fx - 4, 20 + y, 'rleg'];
  return back ? [12 + fx - 8, 20 + y, 'rleg'] : [20 + fx - 8, 52 + y, 'lleg'];
}

/* A skin (url or image) as a 64 x 64 canvas: the old layout's left arm and
   leg made from the right ones, the outer layer cleared. */
export function loadSkin64(url) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(im, 0, 0);
      if (im.height === 32) {
        const flip = (sx, sy, w, h, dx, dy) => { x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(im, sx, sy, w, h, 0, 0, w, h); x.restore(); };
        // each face of the right leg and arm, mirrored into the left's place
        for (const [sx, dx] of [[0, 16], [4, 20], [8, 24], [12, 28]]) { flip(sx, 20, 4, 12, dx, 52); flip(40 + sx, 20, 4, 12, 32 + (dx - 16), 52); }
        flip(4, 16, 4, 4, 20, 48); flip(8, 16, 4, 4, 24, 48); flip(44, 16, 4, 4, 36, 48); flip(48, 16, 4, 4, 40, 48);
      }
      for (const r of OUTER) x.clearRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      res(c);
    };
    im.onerror = () => res(null);
    im.src = url;
  });
}

/* ---- the terrain's own pictures, for the picker and the stamp ---- */
let TERRAIN = null;
function terrain() {
  if (TERRAIN) return TERRAIN;
  TERRAIN = { data: null };
  const im = new Image();
  im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); TERRAIN.data = x.getImageData(0, 0, im.width, im.height); };
  im.src = new URL('../../textures/terrain_albedo.png?v=61', import.meta.url).href;
  return TERRAIN;
}
terrain();
const TINTS = { grass: [0x91, 0xBD, 0x59], foliage: [0x77, 0xAB, 0x2F], birch: [0x80, 0xA7, 0x55], spruce: [0x61, 0x99, 0x61], water: [0x3F, 0x76, 0xE4] };
// face 0-5 (+x, -x, +y, -y, +z, -z) from a hit's normal
export const faceOfNormal = n => (!n ? 2 : n[0] > 0 ? 0 : n[0] < 0 ? 1 : n[1] > 0 ? 2 : n[1] < 0 ? 3 : n[2] > 0 ? 4 : 5);
// a block face's 16 x 16 picture as [r, g, b, a] rows, tinted as the world shows it (null until the terrain picture is in)
export function facePixels(id, face) {
  const T = terrain().data, d = BLOCKS[id];
  if (!T || !d || !d.faces) return null;
  const layer = d.faces[face] !== undefined ? d.faces[face] : d.faces[0];
  if (layer === undefined || (layer + 1) * 16 > T.height) return null;
  const tint = d.tint && TINTS[d.tint] && (face === 2 || d.tint !== 'grass' || d.name !== 'grass_block') ? TINTS[d.tint] : null;
  const out = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = ((layer * 16 + y) * T.width + x) * 4;
    const p = [T.data[i], T.data[i + 1], T.data[i + 2], T.data[i + 3]];
    if (tint) { p[0] = p[0] * tint[0] / 255; p[1] = p[1] * tint[1] / 255; p[2] = p[2] * tint[2] / 255; }
    out.push(p);
  }
  return out;
}
// the face's mean colour (of the pixels that show)
export function faceColour(id, face) {
  const px = facePixels(id, face);
  if (!px) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (const p of px) if (p[3] > 100) { r += p[0]; g += p[1]; b += p[2]; n++; }
  return n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n) : null;
}

/* The painter: the canvas being painted and the colour in hand. apply() is
   called after each change (it puts the skin on your model and sends it). */
export class Painter {
  constructor(apply) { this.canvas = null; this.colour = 0x6B8E23; this.recent = []; this.apply = apply; this.base = null; }
  async start(url) { this.canvas = await loadSkin64(url); if (this.canvas) { this.base = document.createElement('canvas'); this.base.width = this.base.height = 64; this.base.getContext('2d').drawImage(this.canvas, 0, 0); this.apply(this.canvas); } }
  ctx() { return this.canvas && this.canvas.getContext('2d'); }
  setColour(c) { if (c === null || c === undefined) return; this.colour = c; this.recent = [c].concat(this.recent.filter(x => x !== c)).slice(0, 8); }
  css(c) { return '#' + c.toString(16).padStart(6, '0'); }
  dot(tx, ty) { const x = this.ctx(); if (!x) return; x.fillStyle = this.css(this.colour); x.fillRect(tx, ty, 1, 1); }
  fill(part) { const x = this.ctx(), r = PARTS[part]; if (!x || !r) return; x.fillStyle = this.css(this.colour); x.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }
  reset() { const x = this.ctx(); if (!x || !this.base) return; x.clearRect(0, 0, 64, 64); x.drawImage(this.base, 0, 0); this.apply(this.canvas); }
  // the block's picture over every part, tiled from each part's corner
  stamp(id, face) {
    const px = facePixels(id, face), x = this.ctx();
    if (!px || !x) return false;
    const img = x.getImageData(0, 0, 64, 64);
    for (const r of Object.values(PARTS)) for (let ty = r[1]; ty < r[3]; ty++) for (let tx = r[0]; tx < r[2]; tx++) {
      const p = px[((ty - r[1]) % 16) * 16 + ((tx - r[0]) % 16)], i = (ty * 64 + tx) * 4;
      if (p[3] < 100) continue;
      img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this.apply(this.canvas);
    return true;
  }
}

const PALETTE = [0xF9FFFE, 0x9D9D97, 0x474F52, 0x1D1D21, 0xB02E26, 0xF9801D, 0xFED83D, 0x80C71F, 0x5E7C16, 0x169C9C, 0x3AB3DA, 0x3C44AA, 0x8932B8, 0xC74EBD, 0xF38BAA, 0x835432];

export class PaintScreen extends Screen {
  constructor(painter) { super('Paint Yourself'); this.p = painter; this.tool = 'brush'; this.dirty = false; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.k = Math.max(2, Math.min(5, Math.floor((H - 64) / 32)));
    this.fy = 26; this.fx0 = Math.floor(W / 2) - 16 * this.k - 70; this.fx1 = this.fx0 + 16 * this.k + 8;
    this.px = this.fx1 + 16 * this.k + 14;
    const bx = this.px;
    this.brushB = this.add(new Button(bx, this.fy + 74, 70, 20, 'Brush', () => { this.tool = 'brush'; }));
    this.fillB = this.add(new Button(bx + 72, this.fy + 74, 70, 20, 'Fill Part', () => { this.tool = 'fill'; }, 'Click a body part to paint all of it'));
    this.add(new Button(bx, this.fy + 98, 142, 20, 'Start Again', () => this.p.reset(), 'Back to how you looked when the game began'));
    this.add(new Button(W / 2 - 100, H - 26, 200, 20, 'Done', () => g.back()));
  }
  figureAt(mx, my) {
    for (const [back, x0] of [[false, this.fx0], [true, this.fx1]]) {
      const fx = Math.floor((mx - x0) / this.k), fy = Math.floor((my - this.fy) / this.k);
      if (fx < 0 || fx >= 16 || fy < 0 || fy >= 32) continue;
      return texAt(back, fx, fy);
    }
    return null;
  }
  paintAt(mx, my) {
    const t = this.figureAt(mx, my);
    if (!t) return false;
    if (this.tool === 'fill') this.p.fill(t[2]); else this.p.dot(t[0], t[1]);
    this.dirty = true; this.gui.markDirty();
    return true;
  }
  paletteAt(mx, my) {
    const s = 14;
    for (let i = 0; i < 16; i++) { const x = this.px + (i % 8) * s, y = this.fy + 18 + Math.floor(i / 8) * s; if (mx >= x && mx < x + s - 2 && my >= y && my < y + s - 2) return PALETTE[i]; }
    for (let i = 0; i < this.p.recent.length; i++) { const x = this.px + i * s, y = this.fy + 54; if (mx >= x && mx < x + s - 2 && my >= y && my < y + s - 2) return this.p.recent[i]; }
    return null;
  }
  mouseClicked(mx, my, button) {
    const hit = super.mouseClicked(mx, my, button);
    if (hit) return hit;
    const c = this.paletteAt(mx, my);
    if (c !== null) { this.p.setColour(c); this.gui.markDirty(); return true; }
    if (this.paintAt(mx, my)) { this.painting = true; return true; }
    return null;
  }
  mouseDragged(mx, my, button) { if (this.painting && this.tool === 'brush') this.paintAt(mx, my); else super.mouseDragged(mx, my, button); }
  mouseReleased(mx, my, button) { this.painting = false; if (this.dirty) { this.dirty = false; this.p.apply(this.p.canvas); } super.mouseReleased(mx, my, button); }
  onClose() { if (this.dirty) { this.dirty = false; this.p.apply(this.p.canvas); } }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 8, WHITE);
    const c = g.ctx, sm = c.imageSmoothingEnabled, P = this.p, k = this.k;
    // the two figures, pixel by pixel from the canvas
    const img = P.canvas && P.canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
    for (const [back, x0] of [[false, this.fx0], [true, this.fx1]]) {
      g.fill(x0 - 2, this.fy - 2, x0 + 16 * k + 2, this.fy + 32 * k + 2, 0x60000000);
      if (!img) continue;
      for (let fy = 0; fy < 32; fy++) for (let fx = 0; fx < 16; fx++) {
        const t = texAt(back, fx, fy);
        if (!t) continue;
        const i = (t[1] * 64 + t[0]) * 4;
        if (img[i + 3] < 20) continue;
        c.fillStyle = 'rgb(' + img[i] + ',' + img[i + 1] + ',' + img[i + 2] + ')';
        c.fillRect(x0 + fx * k, this.fy + fy * k, k, k);
      }
      g.centered(back ? 'Back' : 'Front', x0 + 8 * k, this.fy + 32 * k + 4, GREY);
    }
    c.imageSmoothingEnabled = sm;
    // the colour in hand, the palette, the recent colours
    g.text('Colour', this.px, this.fy, GREY);
    g.fill(this.px + 40, this.fy - 1, this.px + 60, this.fy + 9, 0xFF000000 | P.colour);
    const s = 14;
    PALETTE.forEach((col, i) => { const x = this.px + (i % 8) * s, y = this.fy + 18 + Math.floor(i / 8) * s; g.fill(x, y, x + s - 2, y + s - 2, 0xFF000000 | col); if (col === P.colour) g.fill(x, y + s - 3, x + s - 2, y + s - 2, 0xFFFFFFFF); });
    g.text('Recent', this.px, this.fy + 46, GREY);
    P.recent.forEach((col, i) => { const x = this.px + i * s, y = this.fy + 54; g.fill(x, y, x + s - 2, y + s - 2, 0xFF000000 | col); });
    this.brushB.active = this.tool !== 'brush'; this.fillB.active = this.tool !== 'fill';
    const help = ['Colour Picker: right click a block', 'to take its colour.', 'Block Stamp: right click a block', 'to cover yourself in it.'];
    help.forEach((l, i) => g.text(l, this.px, this.fy + 124 + i * 10, GREY));
  }
}
