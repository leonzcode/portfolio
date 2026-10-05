/* ---------------------------------------------------------------------------
   Leoncraft 2 - armour you can see, on the player and on the mobs.

     textures   textures/armor/<material>_layer_1.png (helmet, chestplate,
                boots) and <material>_layer_2.png (leggings), 64 x 32 in the
                usual humanoid layout, gathered into one sheet: a 64 x 64
                row per material, layer 1 over layer 2. Until they load (or
                if a file is missing) a plain stand-in of our own is drawn in
                its place, so armour always shows.
     shape      the game's armour model: the humanoid's boxes puffed out by
                a pixel on layer 1 (the helmet's outer hat box half a pixel
                more), by half a pixel for the leggings on layer 2; the left
                arm and leg mirror the right ones' picture.
     colour     leather takes its dye (undyed, the game's brown); every
                other material is drawn as it is.
     glint      an enchanted piece shimmers: two layers of soft violet
                streaks drifting across at different angles, made from the
                noise texture (our own, not the game's glint picture).

   The player's armour is drawn by render/avatar.js with these boxes, the
   mobs' by entities/armorlayer.js through the mob atlas.
--------------------------------------------------------------------------- */
import { armorOf, ITEMS } from '../items.js?v=14';
const THREE = window.THREE;

/* the materials, in sheet order, with the file name each one's pictures go by */
export const ARMOR_MATS = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite', 'turtle', 'copper'];
const FILE = { golden: 'gold' };
export const ROW = {};
ARMOR_MATS.forEach((m, i) => { ROW[m] = i; });
export const SHEET_W = 64, SHEET_H = 64 * ARMOR_MATS.length;
// leather with no dye on it
export const LEATHER = 0xa06540;

/* ---- the boxes ----
   Per piece (0 helmet, 1 chestplate, 2 leggings, 3 boots), per humanoid part
   by name: [x, y, z, w, h, d, u, v, inflate, mirror], in the game's model
   units relative to the part's pivot (pixels, y down, -z the front), as in
   entities/mobmodels.js. The leggings' v is already moved down to layer 2. */
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
];
// the player model's parts, in render/avatar.js order
const AVATAR_PARTS = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

/* Does a stack shimmer: enchanted, or one of the things the game always
   shows with the glint. */
const ALWAYS_GLINT = new Set(['enchanted_golden_apple', 'experience_bottle', 'nether_star', 'end_crystal', 'written_book', 'debug_stick', 'enchanted_book']);
export function glints(stack) {
  if (!stack) return false;
  if (stack.ench) for (const k in stack.ench) return true;
  const it = ITEMS[stack.id];
  return !!(it && ALWAYS_GLINT.has(it.name));
}

/* What one worn stack looks like: its row in the sheet, its colour and
   whether it shimmers; null for nothing, or for what is worn but is not
   armour to draw (a carved pumpkin, a mob head, an elytra). */
export function pieceLook(stack) {
  if (!stack) return null;
  const a = armorOf(stack.id);
  if (!a || ROW[a.material] === undefined) return null;
  const tint = a.material === 'leather' ? (typeof stack.color === 'number' ? stack.color : LEATHER) : 0xffffff;
  return { row: ROW[a.material], material: a.material, tint, glint: glints(stack) };
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
  sheet.version++;
  const base = new URL('../../textures/armor/', import.meta.url).href;
  const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const jobs = [];
  ARMOR_MATS.forEach((m, i) => {
    for (const layer of [1, 2]) {
      if (m === 'turtle' && layer === 2) continue;
      jobs.push(load(base + (FILE[m] || m) + '_layer_' + layer + '.png?v=14').then(im => {
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
  const P = [], N = [], T = [], A = [], I = [];
  PIECE_BOXES.forEach((parts, piece) => {
    for (const name in parts) {
      const part = AVATAR_PARTS.indexOf(name);
      for (const [x0, y0, z0, w, h, d, u, v, inf, mirror] of parts[name]) {
        // turned to y up, +z the front, as the skin's boxes are
        const cx = x0 + w / 2, cy = -(y0 + h / 2), cz = -(z0 + d / 2);
        const hx = w / 2 + inf, hy = h / 2 + inf, hz = d / 2 + inf;
        const faces = faceList(u, v, w, h, d);
        if (mirror) { const t = faces[2][2]; faces[2][2] = faces[3][2]; faces[3][2] = t; }
        for (const [n, corners, r] of faces) {
          const v0 = P.length / 3;
          let UV = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
          if (mirror) UV = [UV[1], UV[0], UV[3], UV[2]];
          for (let k = 0; k < 4; k++) {
            const s = corners[k];
            P.push(cx + s[0] * hx, cy + s[1] * hy, cz + s[2] * hz);
            N.push(n[0], n[1], n[2]);
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
  return g;
}

/* ---- the glint, for any shader that has uNoise (render/noisetex.js) ----
   p: the surface's texture coordinates in pixels; t: seconds. Stretched
   noise reads as long soft streaks; two layers cross at different angles
   and drift different ways. */
export const GLINT = /* glsl */`
vec3 glintAt(vec2 p, float t) {
  vec2 a = vec2(p.x * 0.985 + p.y * 0.174, -p.x * 0.174 + p.y * 0.985);
  vec2 b = vec2(p.x * 0.643 - p.y * 0.766, p.x * 0.766 + p.y * 0.643);
  float s = texture(uNoise, vec2(a.x * 0.004 + 0.13, a.y * 0.022 - t * 0.05)).r;
  float u = texture(uNoise, vec2(b.x * 0.004 + 0.61, b.y * 0.018 + t * 0.037)).a;
  float g = smoothstep(0.5, 0.95, s) * 0.9 + smoothstep(0.55, 0.95, u) * 0.7;
  return vec3(0.5, 0.25, 0.95) * g;
}`;
