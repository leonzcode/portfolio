/* ---------------------------------------------------------------------------
   Leoncraft 2 - armour you can see, on the player and on the mobs.

     textures   textures/armor/<material>_layer_1.png (helmet, chestplate,
                boots) and <material>_layer_2.png (leggings), 64 x 32 in the
                usual humanoid layout, gathered into one sheet: a 64 x 64
                row per material, layer 1 over layer 2, and a last row for
                leather's undyed parts (leather_layer_2_overlay.png, the
                leggings' waist band, when the pack has it). Until they load
                (or if a file is missing) a plain stand-in of our own is drawn
                in its place, so armour always shows.
     shape      the game's armour model: the humanoid's boxes puffed out by
                a pixel on layer 1 (the helmet's outer hat box half a pixel
                more), by half a pixel for the leggings on layer 2; the left
                arm and leg mirror the right ones' picture.
     colour     leather takes its dye (undyed, the game's brown), with its
                overlay on top as it is; every other material is drawn as it
                is.
     glint      an enchanted piece shimmers: two layers of soft violet
                streaks drifting across at different angles, made from the
                noise texture (our own, not the game's glint picture).

   The player's armour is drawn by render/avatar.js with these boxes, the
   mobs' by entities/armorlayer.js through the mob atlas.
--------------------------------------------------------------------------- */
import { armorOf, ITEMS } from '../items.js?v=107';
const THREE = window.THREE;

/* the materials, in sheet order, with the file name each one's pictures go by */
export const ARMOR_MATS = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite', 'turtle', 'copper'];
const FILE = { golden: 'gold' };
export const ROW = {};
ARMOR_MATS.forEach((m, i) => { ROW[m] = i; });
// the row after the materials: the undyed parts of leather, drawn over the dyed piece
export const OVERLAY_ROW = ARMOR_MATS.length;
const OVERLAYS = { leather: [2] };
// and the elytra's (our own drawing, see elytraArt)
export const ELYTRA_ROW = OVERLAY_ROW + 1;
/* then one row per armour trim pattern (from a smithing table): our own
   designs, white where the trim is, coloured by its material when drawn */
export const TRIM_PATTERNS = ['sentry', 'dune', 'coast', 'wild', 'ward', 'eye', 'vex', 'tide', 'snout', 'rib', 'spire', 'wayfinder', 'shaper', 'silence', 'raiser', 'host', 'flow', 'bolt'];
const TRIM_ROW = ELYTRA_ROW + 1;
// each trim material's colour (an iron trim on iron armour, and so on, is drawn darker, as the game does)
const TRIM_COLOURS = {
  amethyst: 0x9a5cc6, copper: 0xb4684d, diamond: 0x6eecd2, emerald: 0x11a036, gold: 0xdeb12d, iron: 0xcecaca,
  lapis: 0x416e97, netherite: 0x625859, quartz: 0xe3d4c4, redstone: 0xb02e26, resin: 0xfc7812,
};
const SAME = { iron: 'iron', gold: 'golden', diamond: 'diamond', netherite: 'netherite', copper: 'copper' };
export const SHEET_W = 64, SHEET_H = 64 * (TRIM_ROW + TRIM_PATTERNS.length);
// leather with no dye on it
export const LEATHER = 0xa06540;

/* ---- the boxes ----
   Per piece (0 helmet, 1 chestplate, 2 leggings, 3 boots, 4 an elytra), per
   humanoid part by name: [x, y, z, w, h, d, u, v, inflate, mirror, pose], in
   the game's model units relative to the part's pivot (pixels, y down, -z
   the front), as in entities/mobmodels.js; pose, when there is one, is a
   box of its own pivot and turn on the part (the elytra's wings). The
   leggings' v is already moved down to layer 2. */
export const PIECE_BOXES = [
  { head: [[-4, -8, -4, 8, 8, 8, 0, 0, 1], [-4, -8, -4, 8, 8, 8, 32, 0, 1.5]] },
  {
    body: [[-4, 0, -2, 8, 12, 4, 16, 16, 1]],
    rightArm: [[-3, -2, -2, 4, 12, 4, 40, 16, 1]],
    leftArm: [[-1, -2, -2, 4, 12, 4, 40, 16, 1, true]],
  },
  {
    body: [[-4, 0, -2, 8, 12, 4, 16, 48, 0.5]],
    rightLeg: [[-2, 0, -2, 4, 12, 4, 0, 48, 0.5]],
    leftLeg: [[-2, 0, -2, 4, 12, 4, 0, 48, 0.5, true]],
  },
  {
    rightLeg: [[-2, 0, -2, 4, 12, 4, 0, 16, 1]],
    leftLeg: [[-2, 0, -2, 4, 12, 4, 0, 16, 1, true]],
  },
  /* the elytra: the game's two wings, 10 x 20 x 2 puffed out a pixel, hung
     from 5 pixels either side of the neck, 2 pixels behind the back, folded
     the way they hang when standing (15 degrees out at the bottom and
     15 back) */
  {
    body: [
      [-10, 0, 0, 10, 20, 2, 22, 0, 1, false, { pivot: [5, 0, 2], rot: [0.2617994, 0, -0.2617994] }],
      [0, 0, 0, 10, 20, 2, 22, 0, 1, true, { pivot: [-5, 0, 2], rot: [0.2617994, 0, 0.2617994] }],
    ],
  },
];
// the player model's parts, in render/avatar.js order
const AVATAR_PARTS = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

/* Does a stack shimmer: enchanted, or one of the things the game always
   shows with the glint. */
const ALWAYS_GLINT = new Set(['enchanted_golden_apple', 'experience_bottle', 'nether_star', 'end_crystal', 'written_book', 'debug_stick', 'enchanted_book']);
export function glints(stack) {
  if (!stack) return false;
  if (stack.ench) for (const k in stack.ench) return true;
  if (stack.lodestone) return true;
  const it = ITEMS[stack.id];
  return !!(it && ALWAYS_GLINT.has(it.name));
}

/* What one worn stack looks like: its row in the sheet, its colour, the row
   of its undyed overlay (or -1) and whether it shimmers; null for nothing, or
   for what is worn but is not armour to draw (a carved pumpkin, a mob head,
   an elytra). */
export function pieceLook(stack) {
  if (!stack) return null;
  const a = armorOf(stack.id);
  if (!a || ROW[a.material] === undefined) return null;
  const tint = a.material === 'leather' ? (typeof stack.color === 'number' ? stack.color : LEATHER) : 0xffffff;
  // a trim from a smithing table: its pattern's row and its material's colour
  let trim = null;
  if (stack.trim) {
    const i = TRIM_PATTERNS.indexOf(stack.trim[0]), c = TRIM_COLOURS[stack.trim[1]];
    if (i >= 0 && c !== undefined) trim = { row: TRIM_ROW + i, colour: SAME[stack.trim[1]] === a.material ? darker(c) : c };
  }
  return { row: ROW[a.material], material: a.material, tint, overlay: OVERLAYS[a.material] ? OVERLAY_ROW : -1, glint: glints(stack), trim };
}
const darker = c => (Math.round(((c >> 16) & 255) * 0.72) << 16) | (Math.round(((c >> 8) & 255) * 0.72) << 8) | Math.round((c & 255) * 0.72);

/* What an elytra in the chest slot looks like (piece 4), or null. */
export function elytraLook(stack) {
  const it = stack && ITEMS[stack.id];
  return it && it.name === 'elytra' ? { row: ELYTRA_ROW, glint: glints(stack) } : null;
}

/* ---- the sheet: one canvas, drawn once and again as each file lands ---- */
let sheet = null;
export function armorSheet() {
  if (sheet) return sheet;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W; canvas.height = SHEET_H;
  sheet = { canvas, version: 0, loaded: false };
  const g = canvas.getContext('2d');
  ARMOR_MATS.forEach((m, i) => standIn(g, m, i * 64));
  elytraArt(g, ELYTRA_ROW * 64);
  TRIM_PATTERNS.forEach((n, i) => trimArt(g, n, (TRIM_ROW + i) * 64));
  sheet.version++;
  const base = new URL('../../textures/armor/', import.meta.url).href;
  const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const jobs = [];
  ARMOR_MATS.forEach((m, i) => {
    for (const layer of [1, 2]) {
      if (m === 'turtle' && layer === 2) continue;
      jobs.push(load(base + (FILE[m] || m) + '_layer_' + layer + '.png?v=107').then(im => {
        if (!im) return;
        const y = i * 64 + (layer - 1) * 32;
        g.clearRect(0, y, 64, 32);
        g.imageSmoothingEnabled = false;
        // a high resolution pack picture is drawn down to 64 x 32
        g.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, 0, y, 64, 32);
        sheet.version++;
      }));
    }
  });
  for (const m in OVERLAYS) for (const layer of OVERLAYS[m]) {
    jobs.push(load(base + m + '_layer_' + layer + '_overlay.png?v=107').then(im => {
      if (!im) return;
      g.imageSmoothingEnabled = false;
      g.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, 0, OVERLAY_ROW * 64 + (layer - 1) * 32, 64, 32);
      sheet.version++;
    }));
  }
  Promise.all(jobs).then(() => { sheet.loaded = true; });
  return sheet;
}

/* The stand-in: flat colours with a little shading in the places armour
   covers (a helmet with a face opening, a chestplate with shoulder pads,
   a belt and trouser legs, boots). Our own, and only seen if a file is
   missing. */
const STAND_IN = {
  leather: [0xc6c6c6, 0x8c8c8c], chainmail: [0x9a9a9a, 0x5a5a5a], iron: [0xd8d8d8, 0x9a9a9a], golden: [0xf2d24b, 0xb8901e],
  diamond: [0x5fe0d6, 0x2a9c95], netherite: [0x4a4247, 0x2c2629], turtle: [0x4f9a3a, 0x2f6a22], copper: [0xd9875a, 0x9c5434],
};
function standIn(g, mat, y0) {
  const [hi, lo] = STAND_IN[mat];
  const col = (c, k) => 'rgb(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].map(v => Math.round(Math.min(255, v * k))).join(',') + ')';
  const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y0 + y, w, h); };
  // a face of a box: the main colour, a darker rim at its bottom and sides
  const face = (x, y, w, h) => {
    rect(x, y, w, h, col(hi, 1));
    rect(x, y + h - 1, w, 1, col(lo, 1));
    rect(x, y, 1, h, col(hi, 0.9)); rect(x + w - 1, y, 1, h, col(lo, 1.1));
  };
  // every side face of a box from row r0 to r1 (of its height), and its top if asked
  const box = (u, v, w, h, d, r0, r1, top) => {
    for (const [x, ww] of [[u, d], [u + d, w], [u + d + w, d], [u + 2 * d + w, w]]) face(x, v + d + r0, ww, r1 - r0);
    if (top) face(u + d, v, w, d);
  };
  // layer 1: the helmet, open at the face
  box(0, 0, 8, 8, 8, 0, 8, true);
  if (mat !== 'turtle') g.clearRect(9, y0 + 11, 6, 5); else g.clearRect(9, y0 + 12, 6, 4);
  if (mat === 'turtle') return;
  // the chestplate: the body, and the arms down to the elbow
  box(16, 16, 8, 12, 4, 0, 12, true);
  box(40, 16, 4, 12, 4, 0, 5, true);
  // the boots: the lowest four rows of the legs
  box(0, 16, 4, 12, 4, 8, 12, false);
  face(8, 16, 4, 4);
  // layer 2: the leggings, a belt on the body and the legs down to the boots
  box(16, 48, 8, 12, 4, 8, 12, false);
  box(0, 48, 4, 12, 4, 0, 9, true);
}

/* The elytra's picture, our own: the wing box's faces (from 22, 0: 10 x 20,
   2 deep) as a grey membrane with a faint violet cast, a lighter leading
   edge along the top, darker veins fanning down from the shoulder and a
   darker, ragged trailing edge. */
function elytraArt(g, y0) {
  const rnd = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let y = 0; y < 22; y++) for (let x = 22; x < 46; x++) {
    // where on the wing: across (0 at the body, 1 at the tip) and down
    const fx = x < 34 ? (x - 22) / 12 : (x - 34) / 12, fy = Math.max(0, y - 2) / 20;
    let v = 150 - fy * 34 - fx * 10 + (rnd() - 0.5) * 10;
    if (y < 2 || (y === 2)) v += 26;                                 // the top edge
    if (y >= 20) v -= 22;                                            // the trailing edge
    // veins: lines fanning from the top inner corner
    const vx = x < 34 ? x - 22 : 45 - x, a = Math.atan2(y + 1, vx + 1);
    if (Math.abs(Math.sin(a * 7)) < 0.18 && y > 3) v -= 24;
    const c = Math.max(40, Math.min(220, Math.round(v)));
    g.fillStyle = `rgb(${c - 6}, ${c - 8}, ${c + 6})`;
    g.fillRect(x, y0 + y, 1, 1);
  }
  // ragged tips along the bottom
  g.clearRect(22, y0 + 21, 24, 1);
  for (let x = 24; x < 46; x += 3) g.clearRect(x, y0 + 20, 1, 1);
}

/* The trims, our own designs: each pattern a few strokes (bands, stripes,
   waves, frames, a diamond, zigzags, chevrons...) on the armour's faces in
   the humanoid layout, layer 1 (helmet, chestplate, boots) above layer 2
   (leggings). Only the parts that land on armour are ever drawn. */
const TRIMS = {
  sentry: [['chestBand', 24], ['helmBand', 9], ['legBand', 26], ['bootBand', 28]],
  dune: [['chestStripes'], ['helmBand', 14], ['legStripes', 0]],
  coast: [['chestWave', 26], ['legWave', 24], ['helmBand', 9]],
  wild: [['chestDiag'], ['legDiag', 0], ['helmDiag']],
  ward: [['chestFrame'], ['chestBar'], ['helmFrame'], ['legStripes', 0]],
  eye: [['chestDiamond'], ['helmDiamond'], ['bootBand', 29]],
  vex: [['chestZig', 22], ['legZig', 28], ['helmZig', 10]],
  tide: [['chestWave', 29], ['legWave', 28], ['bootBand', 30]],
  snout: [['chestBand', 30], ['helmBand', 15], ['chestDots', 22]],
  rib: [['chestRibs'], ['legRibs']],
  spire: [['chestBar'], ['helmBar'], ['legStripes', 1]],
  wayfinder: [['chestCross'], ['legDiag', 1]],
  shaper: [['chestCorners'], ['helmCorners'], ['legBand', 22]],
  silence: [['chestFrame'], ['chestDiamond'], ['helmFrame'], ['legBand', 22]],
  raiser: [['chestChevrons'], ['legChevrons']],
  host: [['chestFrame'], ['legFrame'], ['helmBand', 8]],
  flow: [['chestWave', 22], ['chestWave', 28], ['legWave', 26]],
  bolt: [['chestBolt'], ['legZig', 24], ['helmBand', 12]],
};
function trimArt(g, name, y0) {
  const px = (x, y, v) => { g.fillStyle = `rgb(${v}, ${v}, ${v})`; g.fillRect(x, y0 + y, 1, 1); };
  const P = (x, y) => px(x, y, 232), D = (x, y) => px(x, y, 176);
  const L2 = 32;   // layer 2 (the leggings) is below layer 1
  const both = (fx, y, f) => { f(fx, y); f(fx + 12, y); };   // the chest's front (20..27) and back (32..39)
  const M = {
    chestBand: r => { for (let x = 16; x < 40; x++) { P(x, r); D(x, r + 1); } },
    helmBand: r => { for (let x = 0; x < 32; x++) P(x, r); },
    legBand: r => { for (let x = 0; x < 16; x++) { P(x, L2 + r); D(x, L2 + r + 1); } },
    bootBand: r => { for (let x = 0; x < 16; x++) P(x, r); },
    chestStripes: () => { for (let y = 20; y < 32; y++) for (const x of [21, 24, 26]) both(x, y, P); },
    legStripes: k => { for (let y = 20; y < 32; y++) for (const x of [1, 5 + k, 9, 13 + k]) P(x, L2 + y); },
    chestWave: r => { for (let x = 16; x < 40; x++) P(x, r + Math.round(Math.sin(x * 0.8))); },
    legWave: r => { for (let x = 0; x < 16; x++) P(x, L2 + r + Math.round(Math.sin(x * 1.1))); },
    chestDiag: () => { for (let i = 0; i < 12; i++) both(20 + (i * 2 % 8), 20 + i, P); },
    legDiag: k => { for (let y = 20; y < 32; y++) { P(4 + ((y + k) % 4), L2 + y); P(12 + ((y + k) % 4), L2 + y); } },
    helmDiag: () => { for (let i = 0; i < 8; i++) { P(i, 8 + i); P(16 + i, 8 + i); P(24 + i, 8 + i); } },
    chestFrame: () => { for (let x = 20; x < 28; x++) { both(x, 20, P); both(x, 31, P); } for (let y = 20; y < 32; y++) { both(20, y, P); both(27, y, P); } },
    chestBar: () => { for (let y = 20; y < 32; y++) { both(23, y, P); both(24, y, D); } },
    helmFrame: () => { for (let x = 0; x < 32; x++) { P(x, 8); P(x, 15); } },
    helmBar: () => { for (let y = 0; y < 8; y++) P(12, y); for (let y = 8; y < 11; y++) { P(11, y); P(12, y); P(28, y); } },
    chestDiamond: () => { for (let y = 20; y < 32; y++) for (let x = 20; x < 28; x++) { const d = Math.abs(x - 23.5) + Math.abs(y - 25.5); if (d > 2 && d < 3.6) both(x, y, P); } },
    helmDiamond: () => { for (let y = 8; y < 12; y++) for (let x = 8; x < 16; x++) { const d = Math.abs(x - 11.5) + Math.abs(y - 9.5); if (d > 1 && d < 2.6) P(x, y); } },
    chestZig: r => { for (let x = 16; x < 40; x++) P(x, r + Math.abs((x % 4) - 2)); },
    legZig: r => { for (let x = 0; x < 16; x++) P(x, L2 + r + Math.abs((x % 4) - 2)); },
    helmZig: r => { for (let x = 0; x < 32; x++) P(x, r + Math.abs((x % 4) - 2)); },
    chestDots: r => { for (let x = 20; x < 28; x += 2) { both(x, r, P); both(x + 1, r + 2, P); } },
    chestRibs: () => { for (const r of [22, 25, 28]) for (let x = 21; x < 27; x++) { both(x, r, P); both(x, r + 1, D); } },
    legRibs: () => { for (const r of [23, 26, 29]) for (let x = 0; x < 16; x++) if (x % 4 !== 0) P(x, L2 + r); },
    chestCross: () => { for (let i = 0; i < 8; i++) { both(20 + i, 22 + i, P); both(27 - i, 22 + i, P); } },
    chestCorners: () => { for (const [x, y] of [[20, 20], [26, 20], [20, 30], [26, 30]]) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) both(x + a, y + b, P); },
    helmCorners: () => { for (const [x, y] of [[8, 8], [14, 8], [0, 8], [22, 8]]) for (const [a, b] of [[0, 0], [1, 0], [0, 1]]) P(x + a, y + b); },
    chestChevrons: () => { for (const k of [21, 25, 29]) for (let i = 0; i < 3; i++) { both(23 - i, k + i, P); both(24 + i, k + i, P); } },
    legChevrons: () => { for (const k of [22, 27]) for (const o of [4, 12]) { P(o + 1, L2 + k); P(o + 2, L2 + k); P(o, L2 + k + 1); P(o + 3, L2 + k + 1); } },
    legFrame: () => { for (let y = 20; y < 32; y++) for (const x of [4, 7, 12, 15]) P(x, L2 + y); },
    chestBolt: () => { const z = [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3]; for (let i = 0; i < 12; i++) both(22 + z[i], 20 + i, P); },
  };
  for (const [m, a] of TRIMS[name]) M[m](a);
}

/* ---- the player's armour geometry: all four pieces, every vertex knowing
   its part (avatar order) and its piece, uv in sheet pixels within a row ---- */
function faceList(u, v, w, h, d) {
  return [
    [[0, 0, 1], [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]], [u + d, v + d, u + d + w, v + d + h]],
    [[0, 0, -1], [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]],
    [[-1, 0, 0], [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], [u, v + d, u + d, v + d + h]],
    [[1, 0, 0], [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]], [u + d + w, v + d, u + 2 * d + w, v + d + h]],
    [[0, 1, 0], [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [u + d, v, u + d + w, v + d]],
    [[0, -1, 0], [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], [u + d + w, v, u + d + 2 * w, v + d]],
  ];
}
export function avatarArmorGeometry() {
  const P = [], N = [], T = [], A = [], I = [], W = [];
  PIECE_BOXES.forEach((parts, piece) => {
    for (const name in parts) {
      const part = AVATAR_PARTS.indexOf(name);
      for (const [x0, y0, z0, w, h, d, u, v, inf, mirror, pose] of parts[name]) {
        // turned to y up, +z the front, as the skin's boxes are
        const cx = x0 + w / 2, cy = -(y0 + h / 2), cz = -(z0 + d / 2);
        const hx = w / 2 + inf, hy = h / 2 + inf, hz = d / 2 + inf;
        // a box with a pose of its own: turned about its pivot the game's way (z, then y, then x), in the game's axes
        const R = pose ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pose.rot[0], pose.rot[1], pose.rot[2], 'ZYX')) : null;
        // a posed box's vertices before the turn are kept, so the wings can be turned again (poseWings)
        const wing = pose ? { at: P.length / 3, pos: [], nrm: [], pivot: pose.pivot, sign: pose.rot[2] < 0 ? 1 : -1 } : null;
        if (wing) W.push(wing);
        const pv = new THREE.Vector3(), pn = new THREE.Vector3();
        const faces = faceList(u, v, w, h, d);
        if (mirror) { const t = faces[2][2]; faces[2][2] = faces[3][2]; faces[3][2] = t; }
        for (const [n, corners, r] of faces) {
          const v0 = P.length / 3;
          let UV = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
          if (mirror) UV = [UV[1], UV[0], UV[3], UV[2]];
          for (let k = 0; k < 4; k++) {
            const s = corners[k];
            if (R) {
              wing.pos.push(cx + s[0] * hx, -(cy + s[1] * hy), -(cz + s[2] * hz)); wing.nrm.push(n[0], -n[1], -n[2]);
              pv.set(cx + s[0] * hx, -(cy + s[1] * hy), -(cz + s[2] * hz)).applyMatrix4(R).add(pn.fromArray(pose.pivot));
              P.push(pv.x, -pv.y, -pv.z);
              pn.set(n[0], -n[1], -n[2]).applyMatrix4(R);
              N.push(pn.x, -pn.y, -pn.z);
            } else {
              P.push(cx + s[0] * hx, cy + s[1] * hy, cz + s[2] * hz);
              N.push(n[0], n[1], n[2]);
            }
            T.push(UV[k][0], UV[k][1]);
            A.push(part, piece);
          }
          I.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        }
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 2));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 64);
  g.userData.wings = W;
  return g;
}

/* Turn the elytra's wings in an avatarArmorGeometry, as the game's
   ElytraModel sets them: the left wing (x out from the body) by xRot, yRot,
   zRot about its pivot moved down by y pixels, the right wing the mirror
   (yRot and zRot negated). */
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _v = new THREE.Vector3();
export function poseWings(g, xRot, yRot, zRot, y) {
  const W = g.userData.wings;
  if (!W) return;
  const pa = g.attributes.position, na = g.attributes.normal;
  for (const w of W) {
    // the first box (sign 1) is the game's left wing
    _m.makeRotationFromEuler(_e.set(xRot, w.sign * yRot, w.sign * zRot, 'ZYX'));
    for (let i = 0, n = w.pos.length / 3; i < n; i++) {
      _v.fromArray(w.pos, i * 3).applyMatrix4(_m);
      pa.setXYZ(w.at + i, _v.x + w.pivot[0], -(_v.y + w.pivot[1] + y), -(_v.z + w.pivot[2]));
      _v.fromArray(w.nrm, i * 3).transformDirection(_m);
      na.setXYZ(w.at + i, _v.x, -_v.y, -_v.z);
    }
  }
  pa.needsUpdate = true; na.needsUpdate = true;
}

/* ---- the glint, for any shader that has uNoise (render/noisetex.js) ----
   p: the surface's texture coordinates in pixels; t: seconds. Stretched
   noise reads as long soft streaks; two layers cross at different angles
   and drift different ways. */
export const GLINT = /* glsl */`
uniform vec2 uGlint;    // Glint Speed and Glint Strength (Accessibility Settings): 0.5 and 0.75 are as it always was
vec3 glintAt(vec2 p, float t) {
  t *= uGlint.x * 2.0;
  vec2 a = vec2(p.x * 0.985 + p.y * 0.174, -p.x * 0.174 + p.y * 0.985);
  vec2 b = vec2(p.x * 0.643 - p.y * 0.766, p.x * 0.766 + p.y * 0.643);
  float s = texture(uNoise, vec2(a.x * 0.004 + 0.13, a.y * 0.022 - t * 0.05)).r;
  float u = texture(uNoise, vec2(b.x * 0.004 + 0.61, b.y * 0.018 + t * 0.037)).a;
  float g = smoothstep(0.5, 0.95, s) * 0.9 + smoothstep(0.55, 0.95, u) * 0.7;
  return vec3(0.5, 0.25, 0.95) * g * (uGlint.y / 0.75);
}
#ifdef GLINT_TONE
/* High and RIP: the shimmer put on the screen's own colour, as the game adds it (needs glsl.js TONEMAP).
   col is light still to be exposed by E and tone mapped; what comes back is the light that comes out
   on the screen as col does there with the shimmer added. Added as light it was lost in the tone
   curve's top in the sun (a faint shimmer on dull teal diamond) and glared in the dark */
vec3 glintOver(vec3 col, vec3 g, float E) {
  vec3 d = toSRGB(agx(col * E));
  return agxInverse(fromSRGB(min(d + g, vec3(0.97)))) / E;
}
#endif
`;
