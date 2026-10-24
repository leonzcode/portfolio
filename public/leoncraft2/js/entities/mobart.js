/* ---------------------------------------------------------------------------
   Leoncraft 2 - the mobs' textures, drawn here.

   No pack and no Mojang file: every mob's skin is painted by this script
   into one atlas at start-up, pixel by pixel, from a seeded random so it is
   the same every time. The colours and markings are chosen to read as the
   familiar animals and monsters (a green zombie in a teal shirt, a pink pig
   with a snout, a mottled creeper), the pixels are our own.

   The layout follows each model's boxes (mobmodels.js): a box of w x h x d
   at (u, v) has its top and bottom in the strip above, and its right side,
   front, left side and back in a row under them.

   Also here: the particle sheet (smoke puffs, crits, hearts, flames...).
--------------------------------------------------------------------------- */
import { ATLAS } from '../render/entitymesh.js?v=107';

/* ---- a little painting kit ---- */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
class Painter {
  constructor(img, ox, oy, seed, w = ATLAS, h = ATLAS) { this.img = img; this.ox = ox; this.oy = oy; this.r = rng(seed); this.w = w; this.h = h; this.over = null; }
  px(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    // never past its own texture (the atlas is packed tight: a speckle a row over would land on the texture under it)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) { const o = this.over || (this.over = [0, 0]); o[0] = Math.max(o[0], x + 1); o[1] = Math.max(o[1], y + 1); return; }
    const X = this.ox + x, Y = this.oy + y;
    if (X < 0 || Y < 0 || X >= ATLAS || Y >= ATLAS) return;
    const o = (Y * ATLAS + X) * 4, d = this.img.data;
    const [r, g, b] = typeof c === 'number' ? hex(c) : c;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
  }
  shade(c, k) { const [r, g, b] = typeof c === 'number' ? hex(c) : c; return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)].map(Math.round); }
  // a flat colour with a little per-pixel grain (amt 0..1)
  fill(x, y, w, h, c, amt = 0.08) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, this.shade(c, 1 + (this.r() - 0.5) * 2 * amt));
  }
  // random pixels of another colour
  speckle(x, y, w, h, c, p, amt = 0.06) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.r() < p) this.px(x + i, y + j, this.shade(c, 1 + (this.r() - 0.5) * 2 * amt));
  }
  // a mottled mix of several colours (a creeper's skin)
  mottle(x, y, w, h, cols, weights) {
    const tot = weights.reduce((a, b) => a + b, 0);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let r = this.r() * tot, k = 0;
      while (r > weights[k]) r -= weights[k++];
      this.px(x + i, y + j, cols[k]);
    }
  }
  clear(x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, 0, 0); }
  /* every face of a box: spec is a colour, or { all, top, bottom, front,
     back, right, left }, each a colour or a function (x, y, w, h) */
  box(u, v, w, h, d, spec, amt) {
    const F = {
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
    };
    const s = typeof spec === 'object' && !Array.isArray(spec) ? spec : { all: spec };
    for (const k in F) {
      const f = s[k] !== undefined ? s[k] : s.sides !== undefined && k !== 'top' && k !== 'bottom' ? s.sides : s.all;
      if (f === undefined) continue;
      const [x, y, ww, hh] = F[k];
      if (typeof f === 'function') f(x, y, ww, hh, k);
      else this.fill(x, y, ww, hh, f, amt);
    }
    return F;
  }
}

/* ---- where each texture sits in the atlas ----
   A skyline of 16 pixel columns: each texture goes where its bottom edge would be highest up (the leftmost of those),
   in the order the textures are painted, so it always comes out the same. (It was a grid of 64 x 64 cells, a tall
   texture taking every cell of the rows under it: two thirds of the atlas held a quarter of it in pictures, and the
   paintings at sixty-four pixels a block would not have fitted.) */
export const SLOTS = {};
const COL = 16;
let sky = null;
function slot(name, w, h) {
  const cols = ATLAS / COL, n = Math.ceil(w / COL);
  if (!sky) sky = new Int32Array(cols);
  let best = 0, bestY = Infinity;
  for (let x = 0; x + n <= cols; x++) {
    let y = 0;
    for (let i = 0; i < n; i++) if (sky[x + i] > y) y = sky[x + i];
    if (y < bestY) { bestY = y; best = x; }
  }
  const top = bestY + Math.ceil(h / COL) * COL;
  if (top > ATLAS) console.error('mob atlas full at', name);
  for (let i = 0; i < n; i++) sky[best + i] = top;
  SLOTS[name] = [best * COL, bestY];
  return SLOTS[name];
}

/* ---- the textures ---- */
const ART = {};
// shared: a humanoid face on a head at (u, v): eyes, a mouth
function eyes(p, fx, fy, col, pupil, y = 4) {
  p.px(fx + 1, fy + y, col); p.px(fx + 2, fy + y, pupil);
  p.px(fx + 5, fy + y, pupil); p.px(fx + 6, fy + y, col);
}

ART.zombie = p => {
  const skin = 0x4e7a3a, dark = 0x3a5e2a, shirt = 0x2c9c9a, pants = 0x3a3c8c;
  // head
  p.box(0, 0, 8, 8, 8, { all: skin, top: (x, y, w, h) => { p.fill(x, y, w, h, 0x3d6a2c, 0.12); } }, 0.12);
  const fx = 8, fy = 8;
  p.fill(fx, fy, 8, 2, 0x3f6a2e, 0.1);              // brow shadow
  p.px(fx + 1, fy + 3, 0x101010); p.px(fx + 2, fy + 3, 0x101010); p.px(fx + 5, fy + 3, 0x101010); p.px(fx + 6, fy + 3, 0x101010);
  p.px(fx + 1, fy + 4, 0x223a18); p.px(fx + 2, fy + 4, 0x101010); p.px(fx + 5, fy + 4, 0x101010); p.px(fx + 6, fy + 4, 0x223a18);
  p.px(fx + 3, fy + 5, dark); p.px(fx + 4, fy + 5, dark);   // nose
  p.fill(fx + 2, fy + 6, 4, 1, 0x26401a, 0.05);       // mouth
  p.px(fx + 1, fy + 6, dark); p.px(fx + 6, fy + 6, dark);
  p.speckle(0, 8, 32, 8, dark, 0.12);
  p.clear(32, 0, 32, 16);
  // body: a torn teal shirt
  p.box(16, 16, 8, 12, 4, { all: shirt, top: shirt, bottom: shirt }, 0.1);
  p.speckle(20, 20, 8, 12, 0x22807e, 0.25);
  p.fill(20 + 2, 20 + 10, 3, 2, skin, 0.1);            // a tear at the hem
  // arms: skin, the shirt's sleeve at the top
  for (const [u, v] of [[40, 16], [32, 48]]) {
    p.box(u, v, 4, 12, 4, { all: skin }, 0.12);
    p.fill(u, v + 4, 16, 3, shirt, 0.1);
    p.fill(u + 4, v, 4, 4, shirt, 0.1);
    p.speckle(u, v + 7, 16, 9, dark, 0.15);
  }
  // legs: dark blue trousers, grey shoes
  for (const [u, v] of [[0, 16], [16, 48]]) {
    p.box(u, v, 4, 12, 4, { all: pants }, 0.1);
    p.fill(u, v + 4 + 9, 16, 3, 0x575757, 0.12);
    p.fill(u + 8, v, 4, 4, 0x4a4a4a, 0.1);
    p.speckle(u, v + 4, 16, 9, 0x2c2e70, 0.2);
  }
  p.clear(16, 32, 48, 16); p.clear(0, 32, 16, 16); p.clear(48, 48, 16, 16); p.clear(0, 48, 16, 16);
};
// a husk: the zombie's shape in sandy browns
ART.husk = p => {
  const skin = 0x9c8a62, dark = 0x7a6a48, shirt = 0x6f5c3d, pants = 0x5a4a32;
  p.box(0, 0, 8, 8, 8, { all: skin, top: 0x8a7852 }, 0.12);
  const fx = 8, fy = 8;
  p.fill(fx, fy, 8, 2, 0x847250, 0.08);
  for (const [dx, c] of [[1, 0x1a140c], [2, 0x1a140c], [5, 0x1a140c], [6, 0x1a140c]]) { p.px(fx + dx, fy + 3, c); p.px(fx + dx, fy + 4, c); }
  p.px(fx + 3, fy + 5, dark); p.px(fx + 4, fy + 5, dark);
  p.fill(fx + 2, fy + 6, 4, 1, 0x3e3220, 0.05);
  p.speckle(0, 8, 32, 8, dark, 0.15);
  p.clear(32, 0, 32, 16);
  p.box(16, 16, 8, 12, 4, shirt, 0.12);
  p.speckle(20, 20, 8, 12, 0x5a4a30, 0.3);
  for (const [u, v] of [[40, 16], [32, 48]]) { p.box(u, v, 4, 12, 4, skin, 0.12); p.fill(u, v + 4, 16, 3, shirt, 0.1); p.fill(u + 4, v, 4, 4, shirt); p.speckle(u, v + 7, 16, 9, dark, 0.2); }
  for (const [u, v] of [[0, 16], [16, 48]]) { p.box(u, v, 4, 12, 4, pants, 0.1); p.fill(u, v + 13, 16, 3, 0x3e3426, 0.1); p.fill(u + 8, v, 4, 4, 0x3e3426); }
  p.clear(16, 32, 48, 16); p.clear(0, 32, 16, 16); p.clear(48, 48, 16, 16); p.clear(0, 48, 16, 16);
};
// a drowned: blue-green and waterlogged, with glowing cyan eyes
ART.drowned = p => {
  const skin = 0x5f9c94, dark = 0x3f7a74, shirt = 0x6e8a4c, pants = 0x5a7a6a;
  p.box(0, 0, 8, 8, 8, { all: skin, top: 0x4a8a80 }, 0.14);
  const fx = 8, fy = 8;
  p.fill(fx, fy, 8, 2, 0x4c8a80, 0.08);
  for (const dx of [1, 2, 5, 6]) p.px(fx + dx, fy + 3, 0x6ff2ea);
  for (const dx of [1, 6]) p.px(fx + dx, fy + 4, 0x2a5a54);
  p.fill(fx + 2, fy + 6, 4, 1, 0x1e3e3a, 0.05);
  p.speckle(0, 8, 32, 8, dark, 0.2);
  p.clear(32, 0, 32, 16);
  p.box(16, 16, 8, 12, 4, shirt, 0.15);
  p.speckle(20, 20, 8, 12, 0x3e6a2c, 0.35);
  for (const [u, v] of [[40, 16], [32, 48]]) { p.box(u, v, 4, 12, 4, skin, 0.14); p.fill(u, v + 4, 16, 3, shirt, 0.1); p.speckle(u, v + 7, 16, 9, dark, 0.25); }
  for (const [u, v] of [[0, 16], [16, 48]]) { p.box(u, v, 4, 12, 4, pants, 0.14); p.speckle(u, v + 4, 16, 12, 0x3a5e50, 0.3); }
  p.clear(16, 32, 48, 16); p.clear(0, 32, 16, 16); p.clear(48, 48, 16, 16); p.clear(0, 48, 16, 16);
};
function bones(p, light, mid, dark) {
  // head: a skull, deep sockets, a nose hole and teeth
  p.box(0, 0, 8, 8, 8, { all: light, top: light }, 0.06);
  p.speckle(0, 0, 32, 16, mid, 0.18);
  const fx = 8, fy = 8;
  p.fill(fx + 1, fy + 3, 2, 2, 0x161616, 0.05); p.fill(fx + 5, fy + 3, 2, 2, 0x161616, 0.05);
  p.px(fx + 3, fy + 5, 0x2a2a2a); p.px(fx + 4, fy + 5, 0x2a2a2a);
  for (let i = 1; i < 7; i++) p.px(fx + i, fy + 6, i % 2 ? dark : light);
  p.fill(fx + 1, fy + 7, 6, 1, mid);
  p.clear(32, 0, 32, 16);
  // body: a spine and ribs
  p.clear(16, 16, 24, 16);
  const bx = 20, by = 20;
  p.fill(bx + 3, by, 2, 12, mid, 0.06);                       // spine at the front
  for (let r = 0; r < 4; r++) p.fill(bx, by + 1 + r * 2, 8, 1, light, 0.06);
  p.fill(bx, by + 10, 8, 2, light, 0.06);                     // hips
  p.fill(32, 20, 8, 12, 0, 0); p.clear(32, 20, 8, 12);
  p.fill(bx + 12 + 3, by, 2, 12, mid, 0.06);                  // the back: spine and ribs
  for (let r = 0; r < 4; r++) p.fill(bx + 12, by + 1 + r * 2, 8, 1, mid, 0.06);
  p.fill(bx + 12, by + 10, 8, 2, mid, 0.06);
  p.fill(16, 20, 4, 12, 0, 0); p.clear(16, 20, 4, 12); p.clear(28, 20, 4, 12);
  for (let r = 0; r < 4; r++) { p.fill(16, by + 1 + r * 2, 4, 1, light); p.fill(28, by + 1 + r * 2, 4, 1, light); }
  p.fill(20, 16, 8, 4, light); p.fill(28, 16, 8, 4, mid);
  // thin limbs
  p.box(40, 16, 2, 12, 2, { all: light, top: light }, 0.06);
  p.speckle(40, 18, 8, 12, mid, 0.25);
  p.box(0, 16, 2, 12, 2, { all: light }, 0.06);
  p.speckle(0, 18, 8, 12, mid, 0.25);
}
ART.skeleton = p => bones(p, 0xd2d2cc, 0xa8a8a0, 0x6a6a64);
// a stray: the skeleton's bones in a ragged pale-blue cloth
ART.stray = p => {
  bones(p, 0xc4cfd0, 0x96a4a6, 0x5e6a6c);
  p.speckle(20, 20, 8, 12, 0x6f8e96, 0.5);
  p.speckle(32, 20, 8, 12, 0x6f8e96, 0.5);
  p.fill(0, 26, 8, 6, 0x6a8890, 0.12);
};

ART.creeper = p => {
  const cols = [0x4ca83a, 0x3a8a2c, 0x6cc458, 0x2c6e22, 0xa8d8a0, 0x5a9a48];
  const w = [5, 4, 3, 2, 0.6, 3];
  p.mottle(0, 0, 32, 16, cols, w);
  p.mottle(16, 16, 24, 16, cols, w);
  p.mottle(0, 16, 16, 10, cols, w);
  const fx = 8, fy = 8, k = 0x0c0c0c, k2 = 0x1c2a18;
  // the face: two square eyes, the long mouth with its corners down
  p.fill(fx + 1, fy + 2, 2, 2, k, 0); p.fill(fx + 5, fy + 2, 2, 2, k, 0);
  p.px(fx + 1, fy + 3, k2); p.px(fx + 6, fy + 3, k2);
  p.fill(fx + 3, fy + 4, 2, 3, k, 0);
  p.fill(fx + 2, fy + 5, 1, 3, k, 0); p.fill(fx + 5, fy + 5, 1, 3, k, 0);
  p.px(fx + 3, fy + 7, k2); p.px(fx + 4, fy + 7, k2);
  p.clear(32, 0, 32, 16);
};

ART.spider = p => {
  const body = 0x352e28, dark = 0x221d19, hair = 0x4a4038, eye = 0xb81818;
  p.box(32, 4, 8, 8, 8, { all: body }, 0.12);                 // head
  p.speckle(32, 4, 32, 16, dark, 0.3);
  const fx = 40, fy = 12;
  // eight eyes: two big red ones and a row of small ones
  p.fill(fx + 1, fy + 3, 2, 2, eye, 0.08); p.fill(fx + 5, fy + 3, 2, 2, eye, 0.08);
  p.px(fx + 1, fy + 3, 0xe85050); p.px(fx + 5, fy + 3, 0xe85050);
  p.px(fx + 3, fy + 1, eye); p.px(fx + 4, fy + 1, eye);
  p.px(fx + 0, fy + 2, 0x8a1212); p.px(fx + 7, fy + 2, 0x8a1212);
  p.px(fx + 2, fy + 6, 0x141210); p.px(fx + 5, fy + 6, 0x141210);
  p.box(0, 0, 6, 6, 6, { all: dark }, 0.12);                  // neck
  p.box(0, 12, 10, 8, 12, { all: body, top: hair }, 0.12);    // abdomen
  p.speckle(0, 12, 44, 20, hair, 0.25);
  p.speckle(0, 12, 44, 20, dark, 0.2);
  // markings on the back
  p.fill(12 + 3, 12 + 2, 4, 1, 0x5a4e44); p.fill(12 + 4, 12 + 5, 2, 4, 0x5a4e44);
  p.box(18, 0, 16, 2, 2, { all: dark }, 0.15);                // legs
  p.speckle(18, 0, 36, 4, hair, 0.3);
};
ART.cave_spider = p => {
  ART.spider(p);
  // the cave spider: blue-green with the same red eyes
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const o = ((p.oy + y) * ATLAS + p.ox + x) * 4, d = p.img.data;
    if (!d[o + 3]) continue;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    if (r > 120 && g < 90) continue;          // the eyes stay red
    d[o] = r * 0.45; d[o + 1] = g * 0.9 + 14; d[o + 2] = b * 1.1 + 22;
  }
};

ART.pig = p => {
  const pink = 0xeea0a0, light = 0xf6bcb8, dark = 0xd8888a, snout = 0xe48a92;
  p.box(0, 0, 8, 8, 8, pink, 0.06);
  p.speckle(0, 0, 32, 16, light, 0.15);
  const fx = 8, fy = 8;
  p.px(fx + 0, fy + 4, 0xffffff); p.px(fx + 1, fy + 4, 0x101010);
  p.px(fx + 6, fy + 4, 0x101010); p.px(fx + 7, fy + 4, 0xffffff);
  p.fill(fx + 0, fy + 3, 2, 1, dark); p.fill(fx + 6, fy + 3, 2, 1, dark);
  // the snout box: nostrils on its front
  p.box(16, 16, 4, 3, 1, snout, 0.05);
  p.px(17, 18, 0x9a4c58); p.px(19, 18, 0x9a4c58);
  p.box(28, 8, 10, 16, 8, pink, 0.06);
  p.speckle(28, 8, 36, 24, light, 0.12);
  p.speckle(28, 8, 36, 24, dark, 0.08);
  p.box(0, 16, 4, 6, 4, pink, 0.06);
  p.fill(0, 16 + 4 + 4, 16, 2, 0xb06a6a, 0.08);              // trotters
};
ART.pig_saddle = p => {
  // only the saddle: a brown leather seat over the back
  p.clear(0, 0, 64, 32);
  const bx = 28, by = 8, d = 8, w = 10;
  // the body box's front face is its back (the model is turned up)
  p.fill(bx + d, by + d + 4, w, 7, 0x7a4a24, 0.1);
  p.fill(bx + d, by + d + 4, w, 1, 0x5a3418);
  p.fill(bx + d + 3, by + d + 6, 4, 3, 0x9a6a3a, 0.08);
  p.fill(bx, by + d + 5, d, 3, 0x6a3e1e, 0.08); p.fill(bx + d + w, by + d + 5, d, 3, 0x6a3e1e, 0.08);
  p.px(bx + 3, by + d + 7, 0xb8b8b8); p.px(bx + d + w + 4, by + d + 7, 0xb8b8b8);
};

ART.cow = p => {
  const brown = 0x47352a, white = 0xe8e4dc, dark = 0x2e221a;
  p.box(0, 0, 8, 8, 6, brown, 0.08);
  // a white blaze down the face
  const fx = 6, fy = 6;
  p.fill(fx + 2, fy, 4, 8, white, 0.04); p.fill(fx + 1, fy + 5, 6, 3, white, 0.04);
  p.fill(fx + 2, fy + 6, 4, 2, 0xb89a90, 0.06);              // muzzle
  p.px(fx + 3, fy + 7, 0x5a3a34); p.px(fx + 4, fy + 7, 0x5a3a34);
  p.px(fx + 0, fy + 3, 0x101010); p.px(fx + 1, fy + 3, 0xffffff);
  p.px(fx + 6, fy + 3, 0xffffff); p.px(fx + 7, fy + 3, 0x101010);
  p.box(22, 0, 1, 3, 1, 0xd8d0c0, 0.05);                      // horns
  p.box(18, 4, 12, 18, 10, brown, 0.08);
  // white patches across the body
  const patches = [[20, 16, 6, 5], [34, 20, 7, 6], [44, 15, 5, 8], [52, 24, 6, 5], [24, 28, 8, 4], [40, 8, 5, 4]];
  for (const [x, y, w, h] of patches) { p.fill(x, y, w, h, white, 0.04); p.speckle(x - 1, y - 1, w + 2, h + 2, white, 0.35, 0.04); }
  p.speckle(18, 4, 44, 28, dark, 0.06);
  p.box(52, 0, 4, 6, 1, 0xe2a8a8, 0.06);                      // udder
  p.box(0, 16, 4, 12, 4, brown, 0.08);
  p.fill(0, 20 + 4, 16, 3, white, 0.04);
  p.fill(0, 20 + 10, 16, 2, 0x26201a, 0.06);                  // hooves
};

ART.sheep = p => {
  const face = 0xd8c6b2, dark = 0xb8a690, wool = 0xe9e9e9;
  p.box(0, 0, 6, 6, 8, face, 0.05);
  const fx = 8, fy = 8;
  p.px(fx + 0, fy + 2, 0xffffff); p.px(fx + 1, fy + 2, 0x101010);
  p.px(fx + 4, fy + 2, 0x101010); p.px(fx + 5, fy + 2, 0xffffff);
  p.fill(fx + 2, fy + 4, 2, 1, 0xc49a90); p.px(fx + 2, fy + 5, 0x8a6a62); p.px(fx + 3, fy + 5, 0x8a6a62);
  p.box(28, 8, 8, 16, 6, 0xd4c2ae, 0.06);                     // the shorn body
  p.box(0, 16, 4, 12, 4, face, 0.05);
  p.fill(0, 20 + 9, 16, 3, 0x6a5a4a, 0.06);
  p.speckle(0, 16, 16, 16, dark, 0.1);
  void wool;
};
ART.sheep_wool = p => {
  // white, grained: the dye colour multiplies it
  const g = (x, y, w, h) => { p.fill(x, y, w, h, 0xeeeeee, 0.05); p.speckle(x, y, w, h, 0xd2d2d2, 0.3, 0.04); p.speckle(x, y, w, h, 0xffffff, 0.15, 0.02); };
  p.box(0, 0, 6, 6, 6, { all: g });
  p.box(28, 8, 8, 16, 6, { all: g });
  p.box(0, 16, 4, 6, 4, { all: g });
};

ART.chicken = p => {
  const white = 0xf2f2f2, grey = 0xd0d0d0;
  p.box(0, 0, 4, 6, 3, white, 0.04);
  const fx = 3, fy = 3;
  p.px(fx + 0, fy + 1, 0x101010); p.px(fx + 3, fy + 1, 0x101010);
  p.box(14, 0, 4, 2, 2, 0xe8b030, 0.06);                      // beak
  p.box(14, 4, 2, 2, 2, 0xd02020, 0.06);                      // wattle
  p.box(0, 9, 6, 8, 6, white, 0.04);
  p.speckle(0, 9, 24, 14, grey, 0.15);
  p.box(26, 0, 3, 5, 3, 0xe89a2a, 0.06);                      // legs
  p.box(24, 13, 1, 4, 6, white, 0.04);                        // wings
  p.speckle(24, 13, 14, 10, grey, 0.2);
};

ART.villager = p => {
  const skin = 0xbd8b72, dark = 0x9c6e58, robe = 0x7a5034, robeD = 0x5e3c26;
  p.box(0, 0, 8, 10, 8, skin, 0.05);
  const fx = 8, fy = 8;
  p.fill(fx, fy + 3, 8, 1, 0x4a3426);                         // the unibrow
  p.px(fx + 1, fy + 4, 0xffffff); p.px(fx + 2, fy + 4, 0x2e6a2a); p.px(fx + 5, fy + 4, 0x2e6a2a); p.px(fx + 6, fy + 4, 0xffffff);
  p.fill(fx + 2, fy + 8, 4, 1, dark);
  p.fill(0, 0, 32, 2, 0x3a2a1e, 0.1); p.fill(8, 0, 8, 8, 0x4a3426, 0.1);   // hair on top
  p.clear(32, 0, 32, 20);
  p.box(24, 0, 2, 4, 2, 0xae7c64, 0.05);                      // nose
  p.box(16, 20, 8, 12, 6, robe, 0.08);
  p.box(0, 38, 8, 18, 6, robe, 0.08);
  p.speckle(0, 38, 28, 24, robeD, 0.15);
  p.box(44, 22, 4, 8, 4, robe, 0.08);
  p.fill(44 + 4, 22 + 4 + 5, 4, 3, skin);
  p.box(40, 38, 8, 4, 4, robe, 0.08);
  p.box(0, 22, 4, 12, 4, 0x4a3a2c, 0.1);
};
ART.zombie_villager = p => {
  ART.villager(p);
  // green skin, darker sockets
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const o = ((p.oy + y) * ATLAS + p.ox + x) * 4, d = p.img.data;
    if (!d[o + 3]) continue;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    if (r > g && r - b > 40 && g > 90) { d[o] = r * 0.42; d[o + 1] = g * 0.95; d[o + 2] = b * 0.5; }
  }
  p.box(44, 22, 4, 12, 4, 0x4e7a3a, 0.12);
  p.fill(44, 22 + 4, 16, 4, 0x7a5034, 0.08);
  p.fill(8 + 1, 8 + 4, 2, 1, 0x101010); p.fill(8 + 5, 8 + 4, 2, 1, 0x101010);
};
ART.witch = p => {
  ART.villager(p);
  p.fill(8 + 1, 8 + 4, 2, 1, 0x101010); p.px(8 + 2, 8 + 4, 0x6a1a8a); p.px(8 + 5, 8 + 4, 0x6a1a8a);
  p.box(16, 20, 8, 12, 6, 0x3a2050, 0.08);
  p.box(0, 38, 8, 18, 6, 0x3a2050, 0.08);
  p.speckle(0, 38, 28, 24, 0x2a1640, 0.2);
  p.box(44, 22, 4, 8, 4, 0x3a2050, 0.08);
  p.box(40, 38, 8, 4, 4, 0x3a2050, 0.08);
  const hat = 0x2a2a30;
  p.box(0, 64, 10, 2, 10, hat, 0.1); p.box(0, 76, 7, 4, 7, hat, 0.1); p.box(0, 87, 4, 4, 4, hat, 0.1); p.box(0, 95, 1, 2, 1, hat, 0.1);
  p.fill(0, 64 + 10, 40, 1, 0x4a8a2a);                        // a green band
  p.box(0, 0, 1, 1, 1, 0x4a8a3a);
};

/* ---- the atlas ---- */
const SIZES = {
  zombie: [64, 64], husk: [64, 64], drowned: [64, 64], skeleton: [64, 32], stray: [64, 32], creeper: [64, 32],
  spider: [64, 32], cave_spider: [64, 32], pig: [64, 32], pig_saddle: [64, 32], cow: [64, 32], sheep: [64, 32], sheep_wool: [64, 32],
  chicken: [64, 32], villager: [64, 64], zombie_villager: [64, 64], witch: [64, 128],
};
const EXTRA = [];
// more textures (entities/mobart2.js and later files) register here before the atlas is drawn
export function addArt(name, size, fn) { SIZES[name] = size; ART[name] = fn; EXTRA.push(name); }

/* Painting every mob takes a fifth of a second or more, and it comes out
   the same each time: so it is painted once a visit, a few textures at a
   time while the menus are open (paintSome, so no frame of the title or of
   a loading screen waits on it), and each atlas after (one per world and
   dimension, drawn on by armour layers) is a copy of those pixels. */
let painted = null;                // { n: how many textures, img }
let painting = null;               // the one under way: { n, names, i, img, seed }
function paintAtlas(ms) {
  const n = Object.keys(SIZES).length;
  // every atlas is packed from its first slot, or later ones run off the edge
  if (!painting || painting.n !== n) { sky = null; painting = { n, names: Object.keys(SIZES), i: 0, img: new ImageData(ATLAS, ATLAS), seed: 1 }; }
  const p = painting, t0 = performance.now();
  while (p.i < p.names.length) {
    const name = p.names[p.i++];
    const [w, h] = SIZES[name];
    const [x, y] = slot(name, w, h);
    const pt = new Painter(p.img, x, y, 0x9e3779b1 ^ (p.seed++ * 2654435761), w, h);
    try { ART[name](pt); } catch (e) { console.error('mob art', name, e); }
    if (pt.over) console.warn('mob art drew outside its slot', name, w + 'x' + h, 'reached', pt.over.join('x'));
    if (IMAGES.has(name)) blitImage(p.img, name, IMAGES.get(name));
    if (ms !== undefined && p.i < p.names.length && performance.now() - t0 > ms) return null;
  }
  painting = null;
  painted = { n, img: p.img };
  return painted;
}
const allPainted = () => painted && painted.n === Object.keys(SIZES).length;
export function primeAtlas() { if (!allPainted()) paintAtlas(); }

/* ---- pictures from files over the painted ones ----
   Our paintings (Pixel Perfection CE's, entities/packart.js) and what a
   player's own copy of the game gives (its paintings, and the skins of the
   mobs whose boxes take a picture the way ours do): an ImageData the size
   of the texture, drawn over its slot whenever the atlas is painted. */
const IMAGES = new Map();
function blitImage(img, name, src) {
  const at = SLOTS[name];
  if (!at) return;
  const [w, h] = SIZES[name], d = img.data, s = src.data, sw = src.width;
  for (let y = 0; y < Math.min(h, src.height); y++) for (let x = 0; x < Math.min(w, sw); x++) {
    const o = ((at[1] + y) * ATLAS + at[0] + x) * 4, i = (y * sw + x) * 4;
    d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = s[i + 3];
  }
}
export function setArtImage(name, src) {
  /* kept even before its texture is registered: the paintings' pictures arrive while the title is up, and the
     paintings themselves (entities/items2.js) come with the game's parts after it; the atlas is painted again
     then, with this drawn over it (paintAtlas) */
  IMAGES.set(name, src);
  if (SIZES[name] && painted && SLOTS[name]) blitImage(painted.img, name, src);
  return true;
}
export const artSize = name => SIZES[name] || null;
// where our own picture of a texture has pixels (1) and where it is clear (0): the parts its boxes use
export function artMask(name) {
  if (!SIZES[name]) return null;
  primeAtlas();
  const at = SLOTS[name], [w, h] = SIZES[name], d = painted.img.data, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = d[((at[1] + y) * ATLAS + at[0] + x) * 4 + 3] > 0 ? 1 : 0;
  return out;
}
export const artNames = () => Object.keys(SIZES);
// some more of it, for up to ms milliseconds: true once it is all painted
export function paintSome(ms) { return !!(allPainted() || paintAtlas(ms)); }
export function buildAtlas() {
  primeAtlas();
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  c.getContext('2d').putImageData(painted.img, 0, 0);
  return c;
}

/* ---- the particle sheet: 8 x 8 frames of 16 x 16 ----
   0-7 the smoke puff, big to small; 8 crit; 9 magic crit; 10 heart;
   11 angry cloud; 12 flame; 13 bubble; 14 splash drop; 15 the explosion
   puff; 16-19 the explosion frames; 20 note; 21 sparkle; 22 dust;
   24-25 runes (an enchanting table's); 26 soul flame; 27 a falling leaf;
   28-31 water drops. */
export function buildSheet() {
  const S = 16, c = document.createElement('canvas');
  c.width = c.height = S * 8;
  const g = c.getContext('2d');
  const img = g.createImageData(S * 8, S * 8), d = img.data;
  const R = rng(77);
  const put = (f, x, y, v, a = 255) => {
    const X = (f % 8) * S + x, Y = Math.floor(f / 8) * S + y;
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (Y * S * 8 + X) * 4; d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; d[o + 3] = a;
  };
  const disc = (f, r, col, edge) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - 7.5, dy = y - 7.5, l = Math.hypot(dx, dy);
      if (l <= r) put(f, x, y, l > r - 1.2 && edge ? edge : col);
    }
  };
  // smoke: soft grey blobs in fat pixels, eight sizes
  for (let f = 0; f < 8; f++) {
    const r = 7 - f * 0.8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const l = Math.hypot(x - 3.5, y - 3.5) * 2;
      if (l > r) continue;
      const v = 255 - Math.round(R() * 40) - (l > r - 2 ? 30 : 0);
      for (let k = 0; k < 4; k++) put(f, x * 2 + (k & 1), y * 2 + (k >> 1), [v, v, v]);
    }
  }
  /* crit and magic crit: a little X-shaped spark in fat pixels, as small and
     sharp as the game's (ours: a white two-by-two middle, three steps out
     along each diagonal, greying to the tips); tinted where they are used */
  const spark = ['#......#', '.+....+.', '..*..*..', '...oo...', '...oo...', '..*..*..', '.+....+.', '#......#'];
  const shade = { o: [255, 255, 255], '*': [240, 240, 240], '+': [214, 214, 214], '#': [178, 178, 178] };
  for (const f of [8, 9]) spark.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') for (let q = 0; q < 4; q++) put(f, x * 2 + (q & 1), y * 2 + (q >> 1), shade[ch]);
  }));
  // heart
  const heart = ['..XX..XX..', '.XXXXXXXX.', 'XXXXXXXXXX', 'XXXXXXXXXX', '.XXXXXXXX.', '..XXXXXX..', '...XXXX...', '....XX....'];
  heart.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') put(10, x + 3, y + 4, y < 2 && x > 2 && x < 5 ? [255, 120, 120] : [220, 30, 40]); }));
  // angry cloud
  disc(11, 6, [60, 60, 60], [30, 30, 30]);
  // flame
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const w = (y / S) * 6 + 0.5, dx = Math.abs(x - 7.5);
    if (dx < w && y > 1 && R() > 0.08) put(12, x, y, y > 11 ? [255, 250, 200] : dx < w * 0.5 ? [255, 210, 60] : [240, 110, 20]);
  }
  // a falling leaf (tinted where it is used): a small leaf on a short stalk, a darker middle vein
  const leaf = ['....XX..', '...XXXX.', '..XXVXXX', '..XXVXX.', '.XXVXXX.', '.XVXXX..', '..XXX...', '.S......'];
  leaf.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') put(27, x + 4, y + 4, ch === 'X' ? [236, 236, 236] : ch === 'V' ? [190, 190, 190] : [150, 150, 150]); }));
  // soul flame: the same flame in a soul torch's blues
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const w = (y / S) * 6 + 0.5, dx = Math.abs(x - 7.5);
    if (dx < w && y > 1 && R() > 0.08) put(26, x, y, y > 11 ? [220, 255, 255] : dx < w * 0.5 ? [110, 230, 255] : [30, 150, 210]);
  }
  // bubble
  disc(13, 5, [200, 230, 255], [255, 255, 255]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const l = Math.hypot(x - 7.5, y - 7.5); if (l < 3.5) put(13, x, y, [0, 0, 0], 0); }
  // splash drop
  disc(14, 3, [120, 160, 255]);
  // explosion puff
  disc(15, 7.5, [255, 255, 255]);
  for (let f = 16; f < 20; f++) {
    const r = 7.5 - (f - 16) * 1.2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const l = Math.hypot(x - 7.5, y - 7.5); if (l <= r && R() > (f - 16) * 0.15) { const v = 255 - Math.round(R() * 60); put(f, x, y, [v, v, v]); } }
  }
  // note, sparkle, dust
  disc(20, 3, [255, 255, 255]); for (let y = 2; y < 10; y++) put(20, 10, y, [255, 255, 255]);
  for (let i = -3; i <= 3; i++) { put(21, 7 + i, 7, [255, 255, 255]); put(21, 7, 7 + i, [255, 255, 255]); }
  disc(22, 2.5, [255, 255, 255]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = Math.hypot(x - 7.5, y - 7.5);
    if (l <= 4.6) put(23, x, y, l > 3.4 ? [70, 90, 20] : l < 1.6 ? [255, 255, 255] : [230, 255, 140]);
  }
  // runes: two little marks of our own galactic alphabet
  const runes = [['.##....##.', '..#....#..', '..######..', '..#....#..', '.##....##.'], ['####..', '...#..', '..###.', '...#..', '####..']];
  runes.forEach((rows, k) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') { put(24 + k, x + 3, y * 2 + 3, [255, 255, 255]); put(24 + k, x + 3, y * 2 + 4, [255, 255, 255]); } })));
  /* 28-31 water drops (rain landing, a splash), our own: one little drop a
     frame, two or three fat pixels just right of the middle (a pale
     highlight on top, a deep water blue under it, a darker side),
     tipped a different way in each frame. As small as the game's drops look. */
  const drops = [[[5, 4, 0], [5, 5, 1], [6, 5, 2]], [[5, 5, 0], [5, 6, 1]], [[6, 4, 0], [6, 5, 1], [5, 5, 2]], [[5, 5, 1], [6, 5, 2]]];
  const blue = [[126, 166, 240], [44, 96, 216], [20, 64, 172]];
  drops.forEach((list, k) => list.forEach(([x, y, c]) => { for (let q = 0; q < 4; q++) put(28 + k, x * 2 + (q & 1), y * 2 + (q >> 1), blue[c]); }));
  g.putImageData(img, 0, 0);
  return c;
}
