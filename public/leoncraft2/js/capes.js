/* ---------------------------------------------------------------------------
   Leoncraft 2 - our own capes (the Capes screen, ui/skinmenu.js).

   Every one is drawn here in code, pixel by pixel, onto the game's 64 x 32
   cape picture: nothing is copied from the game's capes or anyone else's.
   The cape is a box 10 wide, 16 tall and 1 thick, laid out on the picture as
   the game lays it out:

     (1, 0)  top edge, 10 x 1        (11, 0)  bottom edge, 10 x 1
     (0, 1)  right edge, 1 x 16      (1, 1)   outside, 10 x 16 (seen from behind)
     (11, 1) left edge, 1 x 16       (12, 1)  inside, 10 x 16 (the lining)

   A design gives the colour of each pixel of the outside (x 0..9 across,
   y 0..15 down from the shoulders) and the lining; the edges are the
   outside's own border, a shade darker.
--------------------------------------------------------------------------- */

// a little random generator, so the stars and snow fall the same way every time
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = c => (c >> 16) & 255, G = c => (c >> 8) & 255, B = c => c & 255;
const rgb = (r, g, b) => (Math.max(0, Math.min(255, Math.round(r))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(b)));
export const shade = (c, k) => rgb(R(c) * k, G(c) * k, B(c) * k);
export const mix = (a, b, t) => rgb(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);

// a plain cloth: two soft folds down the back and a darker hem
const cloth = base => (x, y) => {
  let c = base;
  if (x === 3 || x === 6) c = shade(c, 0.9);
  if (y === 0) c = shade(c, 1.08);
  if (y === 15) c = shade(c, 0.78);
  return c;
};
// a picture of 10 x 16 cells given as a table of points, filled in another colour
function inPoints(list) { const s = new Set(list.map(([x, y]) => x + ',' + y)); return (x, y) => s.has(x + ',' + y); }

/* The designs: [id, name, outside(x, y) -> colour, lining colour or (x, y) -> colour].
   The outside function is made once per drawing, so random ones stay put. */
const DESIGNS = [
  ['crimson', 'Crimson', () => cloth(0xB0202A), 0x6E1218],
  ['ocean', 'Ocean Blue', () => cloth(0x2A5DB0), 0x1A3A70],
  ['emerald', 'Emerald', () => cloth(0x2E9E4F), 0x1C6232],
  ['midnight', 'Midnight', () => { const f = cloth(0x26262E); return (x, y) => y === 14 ? 0x5A5A66 : f(x, y); }, 0x16161B],
  ['stripes', 'Stripes', () => (x, y) => shade((x >> 1) & 1 ? 0xF2F2F2 : 0x23356E, y === 15 ? 0.8 : 1), 0x1A2752],
  ['royal', 'Royal', () => {
    const gem = inPoints([[4, 5], [5, 5], [3, 6], [4, 6], [5, 6], [6, 6], [3, 7], [4, 7], [5, 7], [6, 7], [4, 8], [5, 8]]);
    return (x, y) => {
      if (x === 0 || x === 9 || y === 0 || y === 15) return (x + y) & 1 ? 0xE8B828 : 0xF6D25A;
      if (gem(x, y)) return x + y <= 10 ? 0xFFE27A : 0xD69A1C;
      return cloth(0x5B2A86)(x, y);
    };
  }, 0x3A1A58],
  ['starry', 'Starry Night', () => {
    const r = rng(7), stars = new Map();
    for (let i = 0; i < 12; i++) stars.set((r() * 10 | 0) + ',' + (r() * 16 | 0), r() < 0.3 ? 0xFFF2B0 : 0xFFFFFF);
    // a thin moon top right
    const moon = inPoints([[7, 1], [8, 1], [6, 2], [7, 2], [6, 3], [6, 4], [7, 4], [7, 5], [8, 5]]);
    return (x, y) => {
      if (moon(x, y)) return 0xF4EBC0;
      if (x >= 6 && x <= 8 && y >= 1 && y <= 5) return mix(0x0B1030, 0x2C3A7A, y / 15);
      const s = stars.get(x + ',' + y);
      if (s) return s;
      return mix(0x0B1030, 0x2C3A7A, y / 15);
    };
  }, 0x0B1030],
  ['flames', 'Flames', () => {
    const r = rng(21), tips = [];
    for (let x = 0; x < 10; x++) tips.push(4 + Math.round(3 * Math.sin(x * 1.3) + r() * 3));
    return (x, y) => {
      const depth = y - tips[x];
      if (depth < 0) return mix(0x1A0606, 0x3A0C08, y / 10);
      if (depth < 2) return 0xC4261A;
      if (depth < 5) return 0xEE6A1C;
      return depth < 8 ? 0xF8A82A : 0xFDE16A;
    };
  }, 0x2A0A05],
  ['waves', 'Waves', () => {
    const lift = [0, 1, 1, 0, -1, -1, 0, 1, 1, 0];
    return (x, y) => {
      const t = y + 1 + lift[x], band = Math.floor(t / 4);
      if (t % 4 === 0) return 0xE6F4FF;
      return band & 1 ? 0x2F7FC4 : 0x1C5A9A;
    };
  }, 0x184A78],
  ['checker', 'Checker', () => (x, y) => ((x >> 1) + (y >> 1)) & 1 ? 0xF0F0F0 : 0x202020, 0x303030],
  ['rainbow', 'Rainbow', () => {
    const bands = [0xD93A3A, 0xF08A24, 0xF5D33C, 0x4DB848, 0x3A6FD9, 0x8A3AD9];
    return (x, y) => shade(bands[Math.min(5, Math.floor(y * 6 / 16))], x === 0 || x === 9 ? 0.9 : 1);
  }, 0xE6E6E6],
  ['leonpixel', 'Leonpixel', () => {
    // a gold L in the middle of a gold frame
    const L = (x, y) => (x >= 3 && x <= 4 && y >= 3 && y <= 12) || (x >= 3 && x <= 7 && y >= 11 && y <= 12);
    return (x, y) => {
      if (x === 0 || x === 9 || y === 0 || y === 15) return 0xC8901C;
      if (L(x, y)) return (x === 3 || y === 11) && !(x === 4 && y === 12) ? 0xFFD866 : 0xF2B630;
      if (L(x - 1, y - 1)) return 0x0E121C;
      return mix(0x232B40, 0x171D2C, y / 15);
    };
  }, 0x121722],
  ['snowfall', 'Snowfall', () => {
    const r = rng(33), flakes = new Set();
    for (let i = 0; i < 14; i++) flakes.add((r() * 10 | 0) + ',' + (r() * 12 | 0));
    return (x, y) => {
      if (y >= 13 + (Math.sin(x * 1.1) > 0.3 ? 0 : 1)) return y === 15 ? 0xDDE8F2 : 0xFFFFFF;
      if (flakes.has(x + ',' + y)) return 0xFFFFFF;
      return mix(0x5E80AC, 0x9DB6D6, y / 15);
    };
  }, 0x506C90],
  ['forest', 'Forest', () => {
    // three pines on a hill under a pale sky
    const pine = (x, y, cx, top) => { const k = y - top; return k >= 0 && k < 10 && Math.abs(x - cx) <= Math.floor(k / 2.2); };
    return (x, y) => {
      if (y === 15) return 0x3E7A2A;
      if ((x === 2 || x === 7) && y >= 13) return 0x6A4422;
      if (pine(x, y, 2, 4) || pine(x, y, 7, 3)) return (x + y) % 3 ? 0x1F5A2E : 0x2C7A3E;
      if (pine(x, y, 5, 7)) return (x + y) % 3 ? 0x24683A : 0x338A48;
      return mix(0x8CC8EC, 0xDDEFF7, y / 14);
    };
  }, 0x1E4A28],
  ['sunset', 'Sunset', () => (x, y) => {
    if ((x - 4.5) ** 2 + (y - 10.5) ** 2 < 7.5 && y < 13) return y > 9 ? 0xFFC447 : 0xFFDE6A;
    if (y >= 13) return y === 13 ? 0xD9663A : 0x5A2A5A;
    return y < 6 ? mix(0x2B1B4F, 0xA0306E, y / 6) : mix(0xC2407A, 0xF59A3A, (y - 6) / 6);
  }, 0x2B1B4F],
  ['bumblebee', 'Bumblebee', () => (x, y) => (y >> 1) & 1 ? 0x1E1A16 : (x === 0 || x === 9 ? 0xE0A818 : 0xF5C22A), 0x1E1A16],
];

/* Puts a design's pixels on a 64 x 32 picture: outside(x, y) and the lining
   (a colour, or a function) for the inside; the edges from the outside. */
export function paintCape(ctx, outside, lining) {
  const img = ctx.createImageData(64, 32), d = img.data;
  const put = (x, y, c) => { const i = (y * 64 + x) * 4; d[i] = R(c); d[i + 1] = G(c); d[i + 2] = B(c); d[i + 3] = 255; };
  const inner = typeof lining === 'function' ? lining : () => lining;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 10; x++) {
    put(1 + x, 1 + y, outside(x, y));
    put(12 + x, 1 + y, inner(x, y));
  }
  for (let x = 0; x < 10; x++) { put(1 + x, 0, shade(outside(x, 0), 0.85)); put(11 + x, 0, shade(outside(x, 15), 0.85)); }
  for (let y = 0; y < 16; y++) { put(0, 1 + y, shade(outside(0, y), 0.8)); put(11, 1 + y, shade(outside(9, y), 0.8)); }
  ctx.putImageData(img, 0, 0);
}

export const CAPES = DESIGNS.map(([id, name, make, lining]) => ({ id, name, draw(ctx) { paintCape(ctx, make(), lining); } }));

// a cape of ours as a 64 x 32 PNG data URL (what the cape option keeps)
const URLS = new Map();
export function capeDataUrl(id) {
  if (URLS.has(id)) return URLS.get(id);
  const cape = CAPES.find(c => c.id === id);
  if (!cape) return '';
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  cape.draw(c.getContext('2d'));
  const url = c.toDataURL('image/png');
  URLS.set(id, url);
  return url;
}
