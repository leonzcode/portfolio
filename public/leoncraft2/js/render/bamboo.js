/* ---------------------------------------------------------------------------
   Leoncraft 2 - bamboo's pictures, drawn in code (our own pixels, no game
   or pack files): the stalk and the small and large leaves.

   The stalk is laid out as the game's bamboo models read their picture
   (bamboo1_age0 ... bamboo4_age1 in the 26.1.2 jar): four columns three
   pixels wide at x 0, 3, 6 and 9, one for each of the four stalk models (a
   thin stalk shows the first two pixels of its column, a thick one all
   three), each with its joint at its own height; the top's cut end in the
   corner at 13..16 x 0..3 and the bottom's at 13..16 x 4..7. The leaves are
   pictures for the two flat planes of bamboo_small_leaves.json and
   bamboo_large_leaves.json, the stalk running up their middle.

   Colours are set to the game's mean colours for these pictures
   (tools/leoncraft2/data/vanilla_colour_stats.json: numbers only, no pixels).
   The pictures the packs ship were traced from the game's (the same shapes
   pixel for pixel), so they are not used.

     bambooLayers(add);    // dim/art.js addDimArt: the layers, filled at once
--------------------------------------------------------------------------- */

function h2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const img = () => new Uint8ClampedArray(16 * 16 * 4);
function px(a, x, y, rgb, alpha = 255) {
  if (x < 0 || y < 0 || x > 15 || y > 15) return;
  const o = (y * 16 + x) * 4;
  a[o] = rgb[0]; a[o + 1] = rgb[1]; a[o + 2] = rgb[2]; a[o + 3] = alpha;
}
const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));

// the stalk: light on the left, darkest on the right, a darker joint ring with a pale line over it
const STALK = [[120, 170, 53], [93, 144, 24], [70, 120, 14]];
const JOINT = [56, 96, 16], RIDGE = [146, 190, 74], PITH = [206, 216, 146];
const JOINTS = [[4, 13], [11], [2, 9], [7, 15]];
function stalk() {
  const a = img();
  for (let g = 0; g < 4; g++) {
    for (let y = 0; y < 16; y++) for (let k = 0; k < 3; k++) {
      const n = 0.94 + h2(g * 3 + k, y, 3) * 0.12;
      px(a, g * 3 + k, y, shade(STALK[k], n));
    }
    for (const j of JOINTS[g]) {
      for (let k = 0; k < 3; k++) { px(a, g * 3 + k, j, shade(JOINT, k === 0 ? 1.15 : k === 2 ? 0.85 : 1)); if (j > 0) px(a, g * 3 + k, j - 1, shade(RIDGE, k === 2 ? 0.8 : 1)); }
    }
  }
  // the cut ends: a green rim round pale pith (the thin stalk sees the top left 2 x 2)
  for (const y0 of [0, 4]) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const mid = x === 1 && y === 1;
    px(a, 13 + x, y0 + y, mid ? PITH : shade(STALK[1], y0 ? 0.85 : 1.05));
  }
  return a;
}

/* a leaf: from (ox, oy) out along (dx, dy) for len pixels, sagging by droop at the tip, w at its widest;
   lit along its upper edge, darker at the tip and underneath */
const LEAF = [72, 116, 26], LEAF_LIGHT = [112, 158, 46], LEAF_DARK = [46, 82, 18];
function leaf(a, ox, oy, dx, dy, len, w, droop, seed) {
  const l = Math.hypot(dx, dy); dx /= l; dy /= l;
  const got = new Set();
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const cx = ox + dx * len * t, cy = oy + dy * len * t + droop * t * t;
    const half = Math.max(0.35, w * 0.5 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)));
    for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y++) for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const ddx = x + 0.5 - cx, ddy = y + 0.5 - cy;
      if (ddx * ddx + ddy * ddy > half * half + 0.15) continue;
      const key = y * 16 + x;
      if (got.has(key)) continue;
      got.add(key);
      const upper = ddy < -0.2, tip = t > 0.8;
      let c = tip ? shade(LEAF, 0.85) : upper ? LEAF_LIGHT : ddy > 0.45 ? LEAF_DARK : LEAF;
      c = shade(c, 0.92 + h2(x, y, seed) * 0.16);
      px(a, x, y, c);
    }
  }
}
// [origin x, origin y, direction x, direction y, length, width, droop]
const SMALL = [
  [7.5, 1.5, -1, 0.35, 6, 2.2, 1.5], [8.5, 3, 1, 0.3, 6, 2.2, 1.5],
  [7.5, 6.5, -1, 0.25, 5, 2, 1.2], [8.5, 8, 1, 0.25, 4.5, 2, 1.2],
];
const LARGE = [
  [7.5, 0.5, -1, 0.15, 7, 2.6, 2], [8.5, 1, 1, 0.2, 7, 2.6, 2.2],
  [7.5, 4.5, -1, 0.35, 7, 2.6, 2.4], [8.5, 5.5, 1, 0.35, 7, 2.6, 2.4],
  [7.5, 9, -1, 0.4, 6.5, 2.4, 2.2], [8.5, 10, 1, 0.4, 6, 2.4, 2],
  [7.5, 12.5, -1, 0.3, 4.5, 2, 1.5], [8.5, 13, 1, 0.3, 4, 2, 1.4],
];
function leaves(list, seed) {
  const a = img();
  list.forEach((l, i) => leaf(a, ...l, seed + i));
  return a;
}

export function bambooLayers(add) {
  add('lc2_bamboo_stalk', [stalk()], 1, false);
  add('lc2_bamboo_small_leaves', [leaves(SMALL, 31)], 1, false);
  add('lc2_bamboo_large_leaves', [leaves(LARGE, 57)], 1, false);
}
