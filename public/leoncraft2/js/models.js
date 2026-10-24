/* ---------------------------------------------------------------------------
   Leoncraft 2 - block shapes that are not plain cubes.

   As in Minecraft, a shaped block is a few boxes. A box is
   { f: [x0, y0, z0], t: [x1, y1, z1] } in sixteenths of a block, and may
   carry `faces` (six texture layers, else the block's own), `uv` (a texture
   rectangle per face, else the box is projected onto the texture the way
   Minecraft's "uvlock" does) and `skip` (a bit per face left out). A model can
   also hold free quads { q: four corners in sixteenths, uv: [u0, v0, u1, v1],
   layer } for crossed planes: chains, crops, the plant in a pot.

   Face order everywhere: 0 +x (east), 1 -x (west), 2 +y, 3 -y, 4 +z (south), 5 -z (north).
   A horizontal facing is 0 north, 1 east, 2 south, 3 west; models are built
   facing north and turned.

   The block's state lives in the world's meta byte:
     slab        0 bottom, 1 top, 2 double
     stairs      bits 0-1 facing, bit 2 upside down (corners come from the neighbours)
     door        bits 0-1 facing, bit 2 open, bit 3 upper half, bit 4 hinge on the right
     trapdoor    bits 0-1 facing, bit 2 open, bit 3 in the top half
     gate        bits 0-1 facing, bit 2 open
     on a face   (button, ladder, wall torch, wall sign) bits 0-2: the face of
                 the cell it hangs from (3 floor, 2 ceiling, 0/1/4/5 walls)
     axis        0 up, 1 along x, 2 along z (logs, pillars, chains)
     facing      0-3 horizontal as above, 4 up, 5 down (observers, rods)
     lantern     bit 0 hanging
     bamboo      bit 0 age (thick), bit 3 stage (done growing), bits 4-5 leaves (0 none, 1 small, 2 large);
                 bit 2 is left over from when bamboo was a rod standing up (meta 4) and means nothing.
                 Drawn, bits 6-7 carry which of the game's four stalk models the spot picks (bambooVariant).
     candle/layer/pickle  bits 0-2 how many, less one
     tall plants, beds    bit 3 the upper half / the head
   Fences, walls, panes, rails and redstone work out their shape from their
   neighbours, as Minecraft does when it draws them.
--------------------------------------------------------------------------- */
import { burnable } from './flame.js?v=107';
import { SHELF_MODELS, shelfKey } from './shelfmushroom.js?v=107';

const box = (x0, y0, z0, x1, y1, z1, extra) => {
  const b = { f: [x0, y0, z0], t: [x1, y1, z1] };
  return extra ? Object.assign(b, extra) : b;
};

// one quarter turn clockwise seen from above moves each side face on: east -> south -> west -> north
const TURN_FACE = [4, 5, 2, 3, 1, 0];
const FACING_FACE = [5, 0, 4, 1];        // the face a horizontal facing points out of

function turnFaces(a, q) {
  if (!a) return a;
  let r = a;
  for (let i = 0; i < q; i++) { const n = r.slice(); for (let f = 0; f < 6; f++) n[TURN_FACE[f]] = r[f]; r = n; }
  return r;
}

/* ---- the picture on a face ----
   A face's `uv` is the texture rectangle [u0, v0, u1, v1] laid on it from the
   face's top left as you look at it from outside (u to the right, v down;
   the top with north up and the bottom with south up, as the game's default
   UV runs). A fifth entry 1 lays the same rectangle on turned: u down the
   face and v across it. Between them every way a picture can lie on a face
   (four turns, each mirrored or not) can be written. */
// the game's way to write a face: a rectangle and a turn of the picture clockwise, in degrees
export function faceUV(uv, rot) {
  const [u0, v0, u1, v1] = uv;
  switch ((((rot || 0) / 90) | 0) & 3) {
    case 1: return [u0, v1, u1, v0, 1];
    case 2: return [u1, v1, u0, v0];
    case 3: return [u1, v0, u0, v1, 1];
    default: return [u0, v0, u1, v1];
  }
}
// the same picture turned a further quarter clockwise on its face
const quarter = r => (r[4] ? [r[2], r[1], r[0], r[3]] : [r[0], r[3], r[2], r[1], 1]);
const quarters = (r, k) => { k &= 3; while (k--) r = quarter(r); return r; };
// the rectangle a face shows when it is given none: the box projected onto it
const FACE_TB = [[[2, -1], [1, -1]], [[2, 1], [1, -1]], [[0, 1], [2, 1]], [[0, 1], [2, -1]], [[0, 1], [1, -1]], [[0, -1], [1, -1]]];
function projected(b, f) {
  const [[kt, st], [kb, sb]] = FACE_TB[f];
  const a0 = st > 0 ? b.f[kt] : 16 - b.t[kt], a1 = st > 0 ? b.t[kt] : 16 - b.f[kt];
  const c0 = sb > 0 ? b.f[kb] : 16 - b.t[kb], c1 = sb > 0 ? b.t[kb] : 16 - b.f[kb];
  return [a0, c0, a1, c1];
}
/* A sheet with no thickness, written as the game writes one face of it: the box from f to t (flat across the
   face's own axis), which face (0-5), its uv rectangle and its texture layer. It is a free quad, seen from both
   sides, and each side shows the picture as that face lays it (the game's two faces of such an element do). */
export function sheet(f, t, face, uv, layer) {
  const [[kt, st], [kb, sb]] = FACE_TB[face], k = NORMAL[face].findIndex(v => v !== 0);
  const pt = (a, c) => {
    const p = [0, 0, 0];
    p[k] = NORMAL[face][k] > 0 ? t[k] : f[k];
    p[kt] = (st > 0) === (a === 1) ? t[kt] : f[kt];
    p[kb] = (sb > 0) === (c === 1) ? t[kb] : f[kb];
    return p;
  };
  // the free quad's corners run left bottom, right bottom, right top, left top
  return { q: [pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0)], uv, layer };
}
// boxes turned round the block's upright middle by deg (as sheets, which can stand at any angle)
function spinY(list, d, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), out = [];
  const tip = ([x, y, z]) => [8 + (x - 8) * c + (z - 8) * sn, y, 8 - (x - 8) * sn + (z - 8) * c];
  for (const b of list) for (let f = 0; f < 6; f++) {
    const q = sheet(b.f, b.t, f, b.uv ? b.uv[f] : [0, 0, 16, 16], (b.faces || d.faces)[f]);
    q.q = q.q.map(tip); out.push(q);
  }
  return out;
}
/* One element of a game block model as it is written: from, to, its faces by name ({ north: [uv, layer, turn],
   ... }, those left out not drawn) and, for a tilted one, its rotation { axis: 'x' | 'y' | 'z', angle (degrees),
   origin }. A level one is a box; a tilted one is its faces as sheets tipped about the origin. */
const FACE_NAMES = ['east', 'west', 'up', 'down', 'south', 'north'];
export function element(from, to, faces, rot) {
  const uv = [], layers = [];
  let skip = 0;
  FACE_NAMES.forEach((n, f) => {
    const fc = faces[n];
    if (!fc) { skip |= 1 << f; uv[f] = null; layers[f] = 0; return; }
    uv[f] = fc[2] ? faceUV(fc[0], fc[2]) : fc[0]; layers[f] = fc[1];
  });
  if (!rot || !rot.angle) return [box(from[0], from[1], from[2], to[0], to[1], to[2], { faces: layers, uv, skip })];
  const a = rot.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), [ox, oy, oz] = rot.origin;
  const tip = rot.axis === 'x' ? ([x, y, z]) => [x, oy + (y - oy) * c - (z - oz) * s, oz + (y - oy) * s + (z - oz) * c]
    : rot.axis === 'y' ? ([x, y, z]) => [ox + (x - ox) * c + (z - oz) * s, y, oz - (x - ox) * s + (z - oz) * c]
      : ([x, y, z]) => [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c, z];
  const out = [];
  FACE_NAMES.forEach((n, f) => {
    if (skip & (1 << f)) return;
    const fc = faces[n], q = sheet(from, to, f, fc[0], fc[1]), r = (((fc[2] || 0) / 90) | 0) & 3;
    // (a picture turned clockwise on its face: the sheet's corners hand it on a quarter at a time)
    if (r) q.q = q.q.map((p, i) => q.q[(i + 4 - r) & 3]);
    q.q = q.q.map(tip);
    out.push(q);
  });
  return out;
}
// a box with every face's rectangle written out, so it keeps its pictures however it is turned
export function fixUV(b) {
  if (b.q) return b;
  const uv = [];
  for (let f = 0; f < 6; f++) uv[f] = b.uv && b.uv[f] ? b.uv[f] : projected(b, f);
  return Object.assign({}, b, { uv });
}

// turn boxes (and quads) about the block's middle by quarter turns
// (a face with its own rectangle turns its picture with it, as the game's models do; one without keeps the
// picture the world gives it, as the game's "uvlock" does)
export function turn(list, q) {
  q = ((q % 4) + 4) % 4;
  if (!q) return list;
  return list.map(b => {
    if (b.q) {
      const q2 = b.q.map(p => { let [x, y, z] = p; for (let i = 0; i < q; i++) { const nx = 16 - z; z = x; x = nx; } return [x, y, z]; });
      return Object.assign({}, b, { q: q2 });
    }
    let [x0, y0, z0] = b.f, [x1, y1, z1] = b.t;
    for (let i = 0; i < q; i++) {
      // (x, z) -> (16 - z, x)
      const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;
      x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
    }
    const o = Object.assign({}, b, { f: [x0, y0, z0], t: [x1, y1, z1] });
    if (b.faces) o.faces = turnFaces(b.faces, q);
    if (b.uv) {
      o.uv = turnFaces(b.uv, q);
      // the top's picture turns with the box (clockwise seen from above), the bottom's the other way as seen from below
      if (o.uv[2]) o.uv[2] = quarters(o.uv[2], q);
      if (o.uv[3]) o.uv[3] = quarters(o.uv[3], 3 * q);
    }
    if (b.skip) { let s = 0; for (let f = 0; f < 6; f++) if (b.skip & (1 << f)) s |= 1 << turnFaces([0, 1, 2, 3, 4, 5], q).indexOf(f); o.skip = s; }
    return o;
  });
}
function flipY(list) {
  return list.map(b => {
    if (b.q) return Object.assign({}, b, { q: b.q.map(([x, y, z]) => [x, 16 - y, z]) });
    const o = Object.assign({}, b, { f: [b.f[0], 16 - b.t[1], b.f[2]], t: [b.t[0], 16 - b.f[1], b.t[2]] });
    const sw = a => { if (!a) return a; const n = a.slice(); n[2] = a[3]; n[3] = a[2]; return n; };
    if (b.faces) o.faces = sw(b.faces);
    if (b.uv) o.uv = sw(b.uv);
    return o;
  });
}
/* Turn a model the way the game's block states do: x quarter turns about the
   east-west line (each one takes north down and the top to the north), then
   y quarter turns about the upright (north to east). Every face takes its
   picture with it; a face with no rectangle of its own first gets the one
   it showed, so it turns as well. */
const NORMAL = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function spin(p, x, y, back) {
  let a = p[0] - 8, b = p[1] - 8, c = p[2] - 8;
  if (!back) {
    for (let i = 0; i < (x & 3); i++) [a, b, c] = [a, c, -b];
    for (let i = 0; i < (y & 3); i++) [a, b, c] = [-c, b, a];
  } else {
    for (let i = 0; i < (y & 3); i++) [a, b, c] = [c, b, -a];
    for (let i = 0; i < (x & 3); i++) [a, b, c] = [a, -c, b];
  }
  return [a + 8, b + 8, c + 8];
}
const faceOf = v => NORMAL.findIndex(n => Math.abs(n[0] - v[0]) + Math.abs(n[1] - v[1]) + Math.abs(n[2] - v[2]) < 1e-6);
// the point at (a, c) across face f of a box (a along the face's u, c along its v, 0..1)
function onFace(b, f, a, c) {
  const [[kt, st], [kb, sb]] = FACE_TB[f], p = [0, 0, 0], k = NORMAL[f].findIndex(v => v !== 0);
  p[k] = NORMAL[f][k] > 0 ? b.t[k] : b.f[k];
  p[kt] = st > 0 ? b.f[kt] + a * (b.t[kt] - b.f[kt]) : b.t[kt] - a * (b.t[kt] - b.f[kt]);
  p[kb] = sb > 0 ? b.f[kb] + c * (b.t[kb] - b.f[kb]) : b.t[kb] - c * (b.t[kb] - b.f[kb]);
  return p;
}
function acrossFace(b, f, p) {
  const [[kt, st], [kb, sb]] = FACE_TB[f];
  const wt = b.t[kt] - b.f[kt] || 1, wb = b.t[kb] - b.f[kb] || 1;
  return [st > 0 ? (p[kt] - b.f[kt]) / wt : (b.t[kt] - p[kt]) / wt, sb > 0 ? (p[kb] - b.f[kb]) / wb : (b.t[kb] - p[kb]) / wb];
}
const texAt = (r, a, c) => (r[4] ? [r[0] + c * (r[2] - r[0]), r[1] + a * (r[3] - r[1])] : [r[0] + a * (r[2] - r[0]), r[1] + c * (r[3] - r[1])]);
export function rotate(list, x, y) {
  x &= 3; y &= 3;
  if (!x && !y) return list;
  return list.map(b0 => {
    if (b0.q) return Object.assign({}, b0, { q: b0.q.map(p => spin(p, x, y)) });
    const b = fixUV(b0);
    const p0 = spin(b.f, x, y), p1 = spin(b.t, x, y);
    const o = Object.assign({}, b, { f: [0, 1, 2].map(k => Math.min(p0[k], p1[k])), t: [0, 1, 2].map(k => Math.max(p0[k], p1[k])) });
    const uv = [], faces = b.faces ? [] : undefined;
    let skip = 0;
    for (let f = 0; f < 6; f++) {
      const g = faceOf(spin(NORMAL[f].map(v => v + 8), x, y).map(v => v - 8));
      if (faces) faces[g] = b.faces[f];
      if (b.skip && (b.skip & (1 << f))) skip |= 1 << g;
      // where three corners of the turned face were on the old one, and so which part of the picture they show
      const at = (a, c) => { const [aa, cc] = acrossFace(b, f, spin(onFace(o, g, a, c), x, y, true)); return texAt(b.uv[f], aa, cc); };
      const P00 = at(0, 0), P10 = at(1, 0), P01 = at(0, 1);
      uv[g] = Math.abs(P10[1] - P00[1]) < 1e-6 && Math.abs(P01[0] - P00[0]) < 1e-6
        ? [P00[0], P00[1], P10[0], P01[1]] : [P00[0], P00[1], P01[0], P10[1], 1];
    }
    o.uv = uv;
    if (faces) o.faces = faces;
    if (b.skip) o.skip = skip;
    return o;
  });
}

/* A button (the game's button model: six by four, two pixels deep, one when pressed). Its meta: bits 0-2 the face
   of the cell it is on, bit 3 pressed, and on a floor or a ceiling bits 4-5 the way it faces (the way you looked
   when you put it there), which turns it and its picture with it; on a wall the picture stays put. */
export function buttonModel(m, pressed) {
  const f = m & 7, h = pressed ? 1 : 2;
  if (f === 3 || f === 2) {
    const F = (m >> 4) & 3, e = [6, 14, 10, 14 + h], n = [5, 14, 11, 14 + h], t = [5, 6, 11, 10];
    const b = [box(5, 0, 6, 11, h, 10, { uv: [e, e, t, t, n, n] })];
    return f === 3 ? rotate(b, 0, F) : rotate(b, 2, (F + 2) & 3);
  }
  return turn([box(5, 6, 0, 11, 10, h)], sideFacing(f) || 0);
}
/* A shelf mushroom (meta bits 0-2 the face of its cell it hangs on, bit 3 large): the game's model for its size,
   built facing north (against the block to the south), turned to face away from what holds it. Each face shows its
   own layer, its piece of the picture in the layer's top left (render/shelfmushroom.js). */
const SHELF_TURN = { 4: 0, 1: 1, 5: 2, 0: 3 };
function shelfMushroom(d, m) {
  const s = (m >> 3) & 1, out = [];
  SHELF_MODELS[s].forEach(([from, to, faces], b) => {
    const fc = {};
    for (const f in faces) {
      const [u0, v0, u1, v1] = faces[f], a = Math.min(u0, u1), c = Math.min(v0, v1);
      fc[f] = [[(u0 - a) * 2, (v0 - c) * 2, (u1 - a) * 2, (v1 - c) * 2], d.L[shelfKey(s, b, f)]];
    }
    out.push(...element(from, to, fc));
  });
  return turn(out, SHELF_TURN[m & 7] || 0);
}
// stand a model built on the floor (support below) against another face of its cell
function hang(list, face) {
  if (face === 3) return list;
  if (face === 2) return flipY(list);
  // onto the north wall first: y -> z, z -> 16 - y (the floor becomes the wall at z = 0)
  const up = list.map(b => {
    if (b.q) return Object.assign({}, b, { q: b.q.map(([x, y, z]) => [x, 16 - z, y]) });
    return Object.assign({}, b, { f: [b.f[0], 16 - b.t[2], b.f[1]], t: [b.t[0], 16 - b.f[2], b.t[1]], faces: undefined, uv: undefined });
  });
  return turn(up, { 5: 0, 0: 1, 4: 2, 1: 3 }[face]);
}
const sideFacing = face => ({ 5: 0, 0: 1, 4: 2, 1: 3 })[face];

// a pair of crossed planes standing in a box, for chains, crops and potted plants
function crossed(x0, y0, z0, x1, y1, z1, layer, uv) {
  uv = uv || [0, 0, 16, 16];
  return [
    { q: [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], uv, layer },
    { q: [[x0, y0, z1], [x1, y0, z0], [x1, y1, z0], [x0, y1, z1]], uv, layer },
  ];
}
function hash(planes, layer, x0, x1, y0, y1) {
  // four planes in a # (crops); as the game's crop model lays them, the picture runs one way on the west and
  // south planes and the other way on the east and north ones, so the four read as one ring seen from outside
  const fw = [0, 0, 16, 16], bk = [16, 0, 0, 16], r = [];
  planes.forEach((p, k) => {
    r.push({ q: [[p, y0, x0], [p, y0, x1], [p, y1, x1], [p, y1, x0]], uv: k ? bk : fw, layer });
    r.push({ q: [[x0, y0, p], [x1, y0, p], [x1, y1, p], [x0, y1, p]], uv: k ? fw : bk, layer });
  });
  return r;
}

/* ---- who joins up with whom ---- */
// a full block fences, walls and panes join to: any solid cube (glass too), but not leaves and the game's exceptions
const NO_JOIN = /^(barrier|pumpkin|carved_pumpkin|jack_o_lantern|melon)$|shulker_box$/;
function full(n) { return n && n.d.shape === 'cube' && (n.d.pass === 'opaque' || (n.d.solid && !n.d.leaves)) && !NO_JOIN.test(n.d.name); }
function joins(d, n, kind) {
  if (!n) return false;
  const s = n.d.shape;
  if (kind === 'fence') {
    if (s === 'fence') return (n.d.name === 'nether_brick_fence') === (d.name === 'nether_brick_fence');
    if (s === 'gate') return true;
    return full(n);
  }
  if (kind === 'wall') return s === 'wall' || s === 'pane' || s === 'gate' || full(n);
  if (kind === 'pane') return s === 'pane' || s === 'wall' || full(n);
  return false;
}
const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];     // north, east, south, west
const isStairs = n => n && n.d.shape === 'stairs';

// a plane standing through (cx, cz) turned 45 degrees one way (dir 1) or the other (-1), half wide each side
// of the middle, from y0 to y1 (a lantern's handle, a candle's wick)
function diagonal(cx, cz, half, y0, y1, uv, layer, dir) {
  const k = half * Math.SQRT1_2;
  return { q: [[cx - k, y0, cz - dir * k], [cx + k, y0, cz + dir * k], [cx + k, y1, cz + dir * k], [cx - k, y1, cz - dir * k]], uv, layer };
}
// candles as the game stands them: [x, z of the middle, how tall] for one to four
const CANDLES = [[[8, 8, 6]], [[6, 8, 5], [10, 7, 6]], [[8, 10, 3], [6, 8, 5], [9, 7, 6]], [[7, 9, 3], [10, 9, 5], [6, 6, 5], [9, 6, 6]]];
function candleAt(cx, cz, h, L, y0 = 0) {
  const s = [0, 8, 2, 8 + h];
  return [box(cx - 1, y0, cz - 1, cx + 1, y0 + h, cz + 1, { faces: [L, L, L, L, L, L], uv: [s, s, [0, 6, 2, 8], [0, 14, 2, 16], s, s] }),
    diagonal(cx, cz, 0.5, y0 + h, y0 + h + 1, [0, 5, 1, 6], L, 1), diagonal(cx, cz, 0.5, y0 + h, y0 + h + 1, [0, 5, 1, 6], L, -1)];
}

const LOW_SLABS = { enchanting_table: 12, daylight_detector: 6, sculk_sensor: 8, calibrated_sculk_sensor: 8, sculk_shrieker: 8 };

/* ---- the bamboo fence and gate: their pictures hold the parts side by side, so each face is told which part
   it shows (the game's bamboo fence and gate models; the gate is built facing south) ---- */
const BAMBOO_SIDE = [
  y => box(7, y, 0, 9, y + 3, 9, { skip: 16, uv: [[4, 4, 13, 7], [4, 4, 13, 7], [13, 7, 15, 16], [13, 7, 15, 16], null, faceUV([13, 4, 15, 7], 180)] }),
  y => box(7, y, 7, 16, y + 3, 9, { skip: 2, uv: [[13, 4, 15, 7], null, faceUV([13, 7, 15, 16], 270), faceUV([13, 7, 15, 16], 90), [4, 4, 13, 7], [4, 4, 13, 7]] }),
  y => box(7, y, 7, 9, y + 3, 16, { skip: 32, uv: [[4, 4, 13, 7], [4, 4, 13, 7], [13, 7, 15, 16], [13, 7, 15, 16], [13, 4, 15, 7], null] }),
  y => box(0, y, 7, 9, y + 3, 9, { skip: 1, uv: [null, [15, 4, 13, 7], faceUV([13, 7, 15, 16], 270), faceUV([13, 7, 15, 16], 90), [4, 4, 13, 7], [4, 4, 13, 7]] }),
];
const BAMBOO_POSTS = () => [
  box(0, 5, 7, 2, 16, 9, { uv: [[14, 2, 16, 13], [14, 2, 16, 13], [14, 0, 16, 2], [16, 13, 14, 15], [14, 2, 16, 13], [14, 2, 16, 13]] }),
  box(14, 5, 7, 16, 16, 9, { uv: [[0, 2, 2, 13], [0, 2, 2, 13], [0, 0, 2, 2], [2, 13, 0, 15], [0, 2, 2, 13], [0, 2, 2, 13]] }),
];
function BAMBOO_GATE() {
  const n = null, rail = (x0, x1, y, u) => box(x0, y, 7, x1, y + 3, 9, { skip: 3, uv: [n, n, [u, 1, u + 4, 3], [u, 14, u + 4, 12], [u, 9, u + 4, 12], [u, 3, u + 4, 6]] });
  return BAMBOO_POSTS().concat([
    box(6, 6, 7, 8, 15, 9, { skip: 1, uv: [n, [8, 3, 10, 12], [8, 1, 10, 3], [8, 14, 10, 12], [6, 3, 8, 12], [8, 3, 10, 12]] }),
    box(8, 6, 7, 10, 15, 9, { skip: 2, uv: [[6, 3, 8, 12], n, [6, 1, 8, 3], [6, 14, 8, 12], [8, 3, 10, 12], [6, 3, 8, 12]] }),
    rail(2, 6, 6, 10), rail(2, 6, 12, 10), rail(10, 14, 6, 2), rail(10, 14, 12, 2),
  ]);
}
function BAMBOO_GATE_OPEN() {
  const n = null, f = faceUV;
  const leaf = (x0, a, b) => box(x0, 6, 13, x0 + 2, 15, 15, { uv: [a, a, b, [b[0], 14, b[2], 12], a, a] });
  const arm = (x0, y, e, w, u) => box(x0, y, 9, x0 + 2, y + 3, 13, { skip: 48, uv: [e, w, f([u, 1, u + 4, 3], 270), f([u, 12, u + 4, 14], 270), n, n] });
  return BAMBOO_POSTS().concat([
    leaf(0, [8, 3, 10, 12], [8, 1, 10, 3]), leaf(14, [6, 3, 8, 12], [6, 1, 8, 3]),
    arm(0, 6, [2, 9, 6, 12], [2, 3, 6, 6], 2), arm(0, 12, [2, 9, 6, 12], [2, 3, 6, 6], 2),
    arm(14, 6, [10, 9, 14, 12], [10, 3, 14, 6], 10), arm(14, 12, [10, 9, 14, 12], [14, 3, 10, 6], 10),
  ]);
}

/* A sculk shrieker (the game's model): the slab its soul sits in, the upper ring a pixel in from the edges with its
   inner walls, and the soul's picture on the slab inside (the brighter, faster one when it can summon a warden,
   meta bit 1; bit 0 is shrieking). */
function shrieker(d, m) {
  const L = d.L || {}, S = d.faces[0], T = d.faces[2], Bt = d.faces[3];
  const inner = m & 2 && L.innerOn !== undefined ? L.innerOn : L.inner !== undefined ? L.inner : T;
  const s8 = [0, 8, 16, 16], r1 = [1, 1, 15, 8], t = [1, 1, 15, 15];
  return [box(0, 0, 0, 16, 8, 16, { faces: [S, S, inner, Bt, S, S], uv: [s8, s8, [0, 0, 16, 16], [0, 0, 16, 16], s8, s8] }),
    box(1, 8, 1, 15, 15, 15, { faces: [S, S, T, S, S, S], skip: 1 << 3, uv: [r1, r1, t, null, r1, r1] }),
    // (the ring's inside, and its top seen from below)
    sheet([1, 14.98, 1], [15, 14.98, 15], 3, t, T), sheet([1, 8, 14.98], [15, 15, 14.98], 5, r1, S), sheet([1, 8, 1.02], [15, 15, 1.02], 4, r1, S),
    sheet([14.98, 8, 1], [14.98, 15, 15], 1, r1, S), sheet([1.02, 8, 1], [1.02, 15, 15], 0, r1, S)];
}

/* ---- iron and copper bars: since 26.1 the game draws them as sheets down the middle of the block (its bars
   models), not as thin boxes like a pane: a cross of two narrow sheets on their own, a sheet out to each side
   they join, its end against the neighbour and its top and bottom edges, and a short cap closing the far side
   when they join on one side only ---- */
function bars(d, n) {
  const L = d.faces[0], none = 63, only = f => none & ~(1 << f);
  /* the strips along the bottom and top (0.001 and 15.999, a nudge the mesh's half-pixel grid rounds away, so they lie
     on the face of the block under or over): left out against a full block there, as the game's cullface does, and
     the top ones where more bars stand on these (the bottom ones of those are the same strip) (mesher.js drawList) */
  const lo = s => Object.assign(s, { cull: 3 }), hi = s => Object.assign(s, { cull: 2 });
  const end = y => sheet([7, y, 7], [9, y, 9], 2, [7, 7, 9, 9], L);
  const r = [lo(end(0.001)), hi(end(15.999))];
  const side = () => [sheet([8, 0, 0], [8, 16, 8], 1, [16, 0, 8, 16], L),
    box(7, 0, 0, 9, 16, 0, { skip: only(5), uv: [null, null, null, null, null, [7, 0, 9, 16]] }),
    lo(sheet([7, 0.001, 0], [9, 0.001, 7], 2, [7, 0, 9, 7], L)), hi(sheet([7, 15.999, 0], [9, 15.999, 7], 2, [7, 0, 9, 7], L))];
  const sideAlt = () => [sheet([8, 0, 8], [8, 16, 16], 1, [8, 0, 0, 16], L),
    box(7, 0, 9, 9, 16, 16, { skip: 3 | 4 | 8 | 32, uv: [null, null, [7, 9, 9, 16], [9, 9, 7, 16], [7, 0, 9, 16], null] }),     // (its top and bottom are the sheets)
    lo(sheet([7, 0.001, 9], [9, 0.001, 16], 2, [7, 9, 9, 16], L)), hi(sheet([7, 15.999, 9], [9, 15.999, 16], 2, [7, 9, 9, 16], L))];
  const cap = () => [sheet([8, 0, 8], [8, 16, 9], 1, [8, 0, 7, 16], L), sheet([7, 0, 9], [9, 16, 9], 5, [9, 0, 7, 16], L)];
  const capAlt = () => [sheet([8, 0, 7], [8, 16, 8], 1, [8, 0, 9, 16], L), sheet([7, 0, 7], [9, 16, 7], 5, [7, 0, 9, 16], L)];
  const count = n.filter(Boolean).length;
  if (!count) r.push(sheet([8, 0, 7], [8, 16, 9], 1, [7, 0, 9, 16], L), sheet([7, 0, 8], [9, 16, 8], 5, [7, 0, 9, 16], L));
  if (count === 1) r.push(...(n[0] ? cap() : n[1] ? rotate(cap(), 0, 1) : n[2] ? capAlt() : rotate(capAlt(), 0, 1)));
  if (n[0]) r.push(...side());
  if (n[1]) r.push(...rotate(side(), 0, 1));
  if (n[2]) r.push(...sideAlt());
  if (n[3]) r.push(...rotate(sideAlt(), 0, 1));
  return r;
}

/* ---- doors: the four boards of the game's door models (shut or open, hinge left or right), as drawn facing
   east: the east, west, south and north faces, and the bottom (lower half) or the top (upper half) ---- */
const DOOR_FACES = [
  [[16, 0, 0, 16], [0, 0, 16, 16], [0, 0, 3, 16], [3, 0, 0, 16]],     // shut, hinge left
  [[0, 0, 16, 16], [16, 0, 0, 16], [0, 0, 3, 16], [0, 0, 3, 16]],     // open, hinge left
  [[0, 0, 16, 16], [16, 0, 0, 16], [0, 0, 3, 16], [3, 0, 0, 16]],     // shut, hinge right
  [[16, 0, 0, 16], [0, 0, 16, 16], [3, 0, 0, 16], [3, 0, 0, 16]],     // open, hinge right
];
const DOOR_BOTTOMS = [faceUV([16, 13, 0, 16], 90), faceUV([0, 16, 16, 13], 90), faceUV([0, 13, 16, 16], 90), faceUV([16, 16, 0, 13], 90)];
const DOOR_TOPS = [faceUV([0, 3, 16, 0], 90), faceUV([0, 3, 16, 0], 270), faceUV([0, 0, 16, 3], 270), faceUV([0, 0, 16, 3], 90)];
// the trapdoors whose picture turns with them (the game's "orientable" trapdoor models)
const ORIENTED_TRAPDOOR = /^(acacia|bamboo|birch|cherry|crimson|jungle|mangrove|pale_oak|spruce|warped)_trapdoor$/;

/* ---- chests, built facing north (the latch on the north side) ----
   meta bits 0-1 facing, bits 2-3 which half of a large chest it is (1: the other half is clockwise of the
   facing, east of a north-facing chest; 2: anticlockwise). Two more marks: 256, the box without its lid (the
   mesher's, while sim/lids.js draws the lid moving), and 512, only the lid and its latch (what sim/lids.js
   moves). The lid is the top five pixels, from y 9 to 14, hinged along the back. */
export function chestParts(d, m) {
  const L = d.L || {}, side = d.faces[0], top = d.faces[2], bot = d.faces[3];
  const front = d.front !== undefined ? d.front : side, latch = L.latch !== undefined ? L.latch : front;
  const t = (m >> 2) & 3, half = t === 1 ? 1 : t === 2 ? -1 : 0;
  const base = !!(m & 256), lid = !base && !!(m & 512);
  const out = [];
  // the body from y0 to y1, its top showing the given layer
  const body = (y0, y1, topFace) => {
    if (!half) { out.push(box(1, y0, 1, 15, y1, 15, { faces: [side, side, topFace, bot, side, front] })); return; }
    /* One half of a large chest: its outer part shows the single chest's pictures as they fall (the edge at
       the outer end), the part at the join a stretch from inside them, so that the halves meet with no edge
       between them; the front is the plain side picture (the latch is its own box). */
    const o0 = half > 0 ? 1 : 8, o1 = half > 0 ? 8 : 15, i0 = half > 0 ? 8 : 0, i1 = half > 0 ? 16 : 8;
    const join = half > 0 ? 1 << 0 : 1 << 1, S = [side, side, topFace, bot, side, side];
    const sv = [4, 16 - y1, 12, 16 - y0], tv = [4, 1, 12, 15];
    out.push(box(o0, y0, 1, o1, y1, 15, { faces: S, skip: join }));
    out.push(box(i0, y0, 1, i1, y1, 15, { faces: S, skip: join | (half > 0 ? 1 << 1 : 1 << 0), uv: [null, null, tv, tv, sv, sv] }));
  };
  if (base) body(0, 10, bot);                 // open: the inside shows
  else if (lid) body(9, 14, top);
  else body(0, 14, top);
  if (base) return out;
  const L6 = [latch, latch, latch, latch, latch, latch];
  if (!half) out.push(box(7, 7, 0, 9, 11, 1, { faces: L6 }));
  else {
    // half the latch on each side of the join
    const x0 = half > 0 ? 15 : 0, u0 = half > 0 ? 7 : 8;
    out.push(box(x0, 7, 0, x0 + 1, 11, 1, { faces: L6, uv: [[7, 5, 8, 9], [8, 5, 9, 9], [7, 5, 9, 6], [7, 8, 9, 9], [u0, 5, u0 + 1, 9], [u0, 5, u0 + 1, 9]] }));
  }
  return out;
}

/* ---- the families: each takes the block's def, its meta and a neighbour lookup ---- */
export const SHAPES = {
  slab(d, m) {
    // the enchanting table is a slab of twelve sixteenths (its sides' lower twelve rows); a daylight detector six,
    // sculk sensors and shriekers eight: their meta is their power or state, never which half they are in
    const low = LOW_SLABS[d.name];
    if (low) {
      if (d.name === 'sculk_shrieker') return shrieker(d, m);
      const L = d.L || {}, cal = d.name === 'calibrated_sculk_sensor', s8 = [0, 8, 16, 16], t = [0, 0, 16, 16];
      const r = [d.L && d.L.tendril !== undefined ? box(0, 0, 0, 16, low, 16, { uv: [s8, s8, t, t, s8, s8] }) : box(0, 0, 0, 16, low, 16)];
      // a calibrated sensor's input side is its back (it faces the way you looked: meta bits 2-3)
      if (cal && L.input !== undefined) r[0].faces = [d.faces[0], d.faces[1], d.faces[2], d.faces[3], L.input, d.faces[5]];
      // a sculk sensor's four tendrils, standing at its corners turned 45 degrees (the game's model); while it is
      // active or cooling down (meta bits 0-1) they are the active ones
      const T = (m & 3) && L.tendrilOn !== undefined ? L.tendrilOn : L.tendril;
      if (T !== undefined) for (const [x, z, dir] of [[3, 3, 1], [13, 3, -1], [13, 13, 1], [3, 13, -1]]) r.push(diagonal(x, z, 4, 8, 16, [4, 8, 12, 16], T, dir));
      // and the calibrated one's amethyst, two crossed sheets standing out of its top
      if (cal && L.amethyst !== undefined) r.push(...crossed(0, 8, 0, 16, 20, 16, L.amethyst, [0, 4, 16, 16]));
      return cal ? turn(r, (m >> 2) & 3) : r;
    }
    const t = m & 3;
    if (t === 2) return [box(0, 0, 0, 16, 16, 16)];
    return t === 1 ? [box(0, 8, 0, 16, 16, 16)] : [box(0, 0, 0, 16, 8, 16)];
  },
  stairs(d, m, nb) {
    const F = m & 3, top = !!(m & 4);
    const same = n => isStairs(n) && !!(n.m & 4) === top;
    const at = f => nb(DIRS[f][0], 0, DIRS[f][2]);
    // Minecraft's rule: a stair behind turned across makes an outer corner, one in front an inner corner
    const ccw = (F + 3) & 3;
    const canTake = dir => { const n = at(dir); return !same(n) || (n.m & 3) !== F; };
    let shape = 'straight';
    const behind = at(F);
    if (same(behind) && ((behind.m & 3) & 1) !== (F & 1) && canTake(((behind.m & 3) + 2) & 3)) shape = (behind.m & 3) === ccw ? 'outer_left' : 'outer_right';
    else {
      const front = at((F + 2) & 3);
      if (same(front) && ((front.m & 3) & 1) !== (F & 1) && canTake(front.m & 3)) shape = (front.m & 3) === ccw ? 'inner_left' : 'inner_right';
    }
    // built facing north: the step's high part on the north side; right is east
    let up;
    if (shape === 'straight') up = [box(0, 8, 0, 16, 16, 8)];
    else if (shape === 'outer_right') up = [box(8, 8, 0, 16, 16, 8)];
    else if (shape === 'outer_left') up = [box(0, 8, 0, 8, 16, 8)];
    else if (shape === 'inner_right') up = [box(0, 8, 0, 16, 16, 8), box(8, 8, 8, 16, 16, 16)];
    else up = [box(0, 8, 0, 16, 16, 8), box(0, 8, 8, 8, 16, 16)];
    const b = [box(0, 0, 0, 16, 8, 16)].concat(turn(up, F));
    // upside down the game turns the whole model over, so its bottom texture is on top (sandstone's, for one)
    return top ? flipY(b.map(x => Object.assign(x, { faces: d.faces }))) : b;
  },
  fence(d, m, nb) {
    const bamboo = d.name === 'bamboo_fence';
    // (the bamboo fence has a picture of its own parts, laid on as its models lay it)
    const b = [bamboo ? box(6, 0, 6, 10, 16, 10, { uv: [[0, 0, 4, 16], [0, 0, 4, 16], [4, 0, 8, 4], [4, 0, 8, 4], [0, 0, 4, 16], [0, 0, 4, 16]] }) : box(6, 0, 6, 10, 16, 10)];
    for (let k = 0; k < 4; k++) {
      if (!joins(d, nb(DIRS[k][0], 0, DIRS[k][2]), 'fence')) continue;
      if (bamboo) b.push(BAMBOO_SIDE[k](12), BAMBOO_SIDE[k](6));
      else b.push(...turn([box(7, 12, 0, 9, 15, 6), box(7, 6, 0, 9, 9, 6)], k));
    }
    return b;
  },
  wall(d, m, nb) {
    const n = DIRS.map(v => joins(d, nb(v[0], 0, v[2]), 'wall'));
    const above = nb(0, 1, 0);
    const tall = !!(above && (above.d.shape !== 'none' && above.d.shape !== 'cross' && above.d.shape !== 'fluid'));
    const straight = (n[0] && n[2] && !n[1] && !n[3]) || (n[1] && n[3] && !n[0] && !n[2]);
    const b = [];
    if (!straight || tall && !(above.d.shape === 'wall' && straight)) b.push(box(4, 0, 4, 12, 16, 12));
    n.forEach((c, k) => { if (c) b.push(...turn([box(5, 0, 0, 11, tall ? 16 : 14, 8)], k)); });
    if (!b.length) b.push(box(4, 0, 4, 12, 16, 12));
    return b;
  },
  pane(d, m, nb) {
    const n = DIRS.map(v => joins(d, nb(v[0], 0, v[2]), 'pane'));
    if (/_bars$/.test(d.name)) return bars(d, n);
    // the glass on the broad sides; the thin edges, top and ends show the edge texture, as in the game; joined to
    // nothing, a pane is the post alone (the game's Java look), its sides a sliver of the glass
    const g = d.faces[0], e = d.L && d.L.top !== undefined ? d.L.top : g, s = [9, 0, 7, 16], t = [7, 0, 9, 16];
    // (the game's "noside" pieces: the north and west slivers one way, the east and south the other)
    const b = [box(7, 0, 7, 9, 16, 9, { faces: [g, g, e, e, g, g], uv: [t, s, null, null, t, s] })];
    for (let k = 0; k < 4; k++) if (n[k]) b.push(...turn([box(7, 0, 0, 9, 16, 7, { faces: [g, g, e, e, e, e] })], k));
    return b;
  },
  gate(d, m) {
    const F = m & 3, open = !!(m & 4);
    if (d.name === 'bamboo_fence_gate') return turn(open ? BAMBOO_GATE_OPEN() : BAMBOO_GATE(), (F + 2) & 3);
    const b = [box(0, 5, 7, 2, 16, 9), box(14, 5, 7, 16, 16, 9)];
    if (!open) b.push(box(6, 6, 7, 10, 15, 9), box(2, 6, 7, 6, 9, 9), box(2, 12, 7, 6, 15, 9), box(10, 6, 7, 14, 9, 9), box(10, 12, 7, 14, 15, 9));
    else b.push(box(0, 6, 1, 2, 15, 3), box(14, 6, 1, 16, 15, 3), box(0, 6, 3, 2, 9, 7), box(0, 12, 3, 2, 15, 7), box(14, 6, 3, 16, 9, 7), box(14, 12, 3, 16, 15, 7));
    return turn(b, F);
  },
  door(d, m) {
    const F = m & 3, open = !!(m & 4), upper = !!(m & 8), right = !!(m & 16);
    const faces = upper && d.facesUpper ? d.facesUpper : d.faces;
    /* The game's door: a board three pixels thick along the west side of the cell (its models face east), the
       picture laid on so it reads the same from both sides, then turned: shut, it fills the near side of the
       cell; open, it swings back against the hinge. */
    const k = (open ? 1 : 0) | (right ? 2 : 0), W = DOOR_FACES[k];
    const uv = [W[0], W[1], null, null, W[2], W[3]];
    if (upper) uv[2] = DOOR_TOPS[k]; else uv[3] = DOOR_BOTTOMS[k];
    const b = box(0, 0, 0, 3, 16, 16, { faces, uv: uv.map((r, f) => r || projected({ f: [0, 0, 0], t: [3, 16, 16] }, f)), skip: upper ? 1 << 3 : 1 << 2 });
    return turn([b], !open ? (F + 3) & 3 : right ? (F + 2) & 3 : F);
  },
  trapdoor(d, m) {
    const F = m & 3, open = !!(m & 4), top = !!(m & 8);
    /* As the game draws them: most keep their picture still, with a sliver of it upside down round the edges;
       the woods whose pictures have a way up (spruce, birch, jungle...) turn theirs with the trapdoor. */
    if (ORIENTED_TRAPDOOR.test(d.name)) {
      if (open) {
        const b = box(0, 0, 13, 16, 16, 16, { uv: [faceUV([0, 3, 16, 0], 90), faceUV([0, 0, 16, 3], 90), [0, 3, 16, 0], [0, 0, 16, 3], [0, 16, 16, 0], [0, 16, 16, 0]] });
        return top ? rotate([b], 2, F + 2) : turn([b], F);
      }
      const e = [0, 0, 16, 3], uv = [e, e, [0, 16, 16, 0], [0, 0, 16, 16], e, e];
      return turn([top ? box(0, 13, 0, 16, 16, 16, { uv }) : box(0, 0, 0, 16, 3, 16, { uv })], F);
    }
    if (open) return turn([box(0, 0, 13, 16, 16, 16, { uv: [[13, 0, 16, 16], [16, 0, 13, 16], [0, 16, 16, 13], [0, 13, 16, 16], [0, 0, 16, 16], [0, 0, 16, 16]] })], F);
    const e = [0, 16, 16, 13], f = [0, 0, 16, 16], uv = [e, e, f, f, e, e];
    return [top ? box(0, 13, 0, 16, 16, 16, { uv }) : box(0, 0, 0, 16, 3, 16, { uv })];
  },
  thin(d) { return [box(0, 0, 0, 16, d.h || 1, 16)]; },
  // a nether portal: a sheet four pixels thick across its axis (1 along x, 2 along z), no faces against itself or its frame
  portal(d, m, nb) {
    const shut = n => n && (n.d.shape === 'portal' || full(n));
    let skip = (shut(nb(0, 1, 0)) ? 4 : 0) | (shut(nb(0, -1, 0)) ? 8 : 0);
    if (m === 2) return [box(6, 0, 0, 10, 16, 16, { skip: skip | (shut(nb(0, 0, 1)) ? 16 : 0) | (shut(nb(0, 0, -1)) ? 32 : 0) })];
    return [box(0, 0, 6, 16, 16, 10, { skip: skip | (shut(nb(1, 0, 0)) ? 1 : 0) | (shut(nb(-1, 0, 0)) ? 2 : 0) })];
  },
  // an end portal frame, 13 pixels tall, with the eye of ender on top once one is put in (meta bit 2)
  end_frame(d, m) {
    const out = [box(0, 0, 0, 16, 13, 16)];
    if (m & 4) { const e = d.L && d.L.eye !== undefined ? d.L.eye : d.faces[2]; out.push(box(4, 13, 4, 12, 16, 12, { faces: [e, e, e, e, e, e] })); }
    return out;
  },
  plate(d) { return [box(1, 0, 1, 15, 1, 15)]; },
  // (a shelf mushroom is placed and held as a button is, and drawn as the game's model: shelfMushroom)
  button(d, m) { return d.name === 'shelf_mushroom' && d.L && d.L[shelfKey(0, 0, 'up')] > 0 ? shelfMushroom(d, m) : buttonModel(m, false); },
  // the game's ladder is a single sheet 0.8 of a pixel off the wall, the same picture from both sides
  ladder(d, m) { return turn([box(0, 0, 0.8, 16, 16, 0.8, { skip: 47, uv: [null, null, null, null, [0, 0, 16, 16], null] })], sideFacing(m & 7) || 0); },
  lantern(d, m) {
    // the game's lantern: the cage, its cap, and the handle (or the chain it hangs from) as two planes turned 45 degrees
    const h = m & 1 ? 1 : 0, L = d.faces[0];
    const side = [0, 2, 6, 9], cap = [1, 0, 5, 2];
    const uv = (s, t) => [s, s, t, t, s, s];
    const r = [
      box(5, h, 5, 11, 7 + h, 11, { uv: uv(side, [0, 9, 6, 15]) }),
      box(6, 7 + h, 6, 10, 9 + h, 10, { uv: uv(cap, [1, 10, 5, 14]) }),
    ];
    if (h) r.push(diagonal(8, 8, 1.5, 11, 15, [11, 1, 14, 5], L, 1), diagonal(8, 8, 1.5, 10, 16, [11, 6, 14, 12], L, -1));
    else r.push(diagonal(8, 8, 1.5, 9, 11, [11, 1, 14, 3], L, 1), diagonal(8, 8, 1.5, 9, 11, [11, 10, 14, 12], L, -1));
    return r;
  },
  chain(d, m) {
    const L = d.faces[0];
    let q = [{ q: [[6.5, 0, 8], [9.5, 0, 8], [9.5, 16, 8], [6.5, 16, 8]], uv: [0, 0, 3, 16], layer: L },
      { q: [[8, 0, 6.5], [8, 0, 9.5], [8, 16, 9.5], [8, 16, 6.5]], uv: [3, 0, 6, 16], layer: L }];
    const a = m & 3;
    if (a === 1) q = q.map(p => Object.assign({}, p, { q: p.q.map(([x, y, z]) => [y, x, z]) }));
    if (a === 2) q = q.map(p => Object.assign({}, p, { q: p.q.map(([x, y, z]) => [x, z, y]) }));
    return q;
  },
  rod(d, m) {
    const f = m & 7;
    if (d.orient !== 'facing') {
      // (bamboo's stalk)
      const b = [box(7, 0, 7, 9, 15, 9, { uv: [[0, 0, 2, 15], [0, 0, 2, 15], [2, 0, 4, 2], [2, 0, 4, 2], [0, 0, 2, 15], [0, 0, 2, 15]] }),
        box(6, 15, 6, 10, 16, 10, { uv: [[2, 2, 6, 3], [2, 2, 6, 3], [2, 2, 6, 6], [2, 2, 6, 6], [2, 2, 6, 3], [2, 2, 6, 3]] })];
      return f === 5 ? flipY(b) : f === 4 ? b : hang(b, FACING_FACE[((f & 3) + 2) & 3]);
    }
    /* The game's end rod (a foot and a white rod) and lightning rod (a rod under a cap), built standing up and
       turned the way they point, their pictures turning with them. */
    const b = /lightning_rod$/.test(d.name)
      ? [box(6, 12, 6, 10, 16, 10, { uv: [[0, 0, 4, 4], [0, 0, 4, 4], [4, 4, 0, 0], [0, 0, 4, 4], [0, 0, 4, 4], [0, 0, 4, 4]] }),
        box(7, 0, 7, 9, 12, 9, { skip: 1 << 2, uv: [[0, 4, 2, 16], [0, 4, 2, 16], [0, 0, 0, 0], [0, 4, 2, 6], [0, 4, 2, 16], [0, 4, 2, 16]] })]
      : [box(6, 0, 6, 10, 1, 10, { uv: [[2, 6, 6, 7], [2, 6, 6, 7], [2, 2, 6, 6], [6, 6, 2, 2], [2, 6, 6, 7], [2, 6, 6, 7]] }),
        box(7, 1, 7, 9, 16, 9, { skip: 1 << 3, uv: [[0, 0, 2, 15], [0, 0, 2, 15], [2, 0, 4, 2], [0, 0, 0, 0], [0, 0, 2, 15], [0, 0, 2, 15]] })];
    const [x, y] = LOOKS.ends.turns(f);
    return rotate(b, x, y);
  },
  candle(d, m) {
    // bits 0-1 how many less one, bit 2 lit (the lit texture's wick glows); where each stands and how tall, as the game has them
    const n = (m & 3) + 1, L = m & 4 && d.L && d.L.lit !== undefined ? d.L.lit : d.faces[0];
    const r = [];
    for (const [x, z, h] of CANDLES[n - 1]) r.push(...candleAt(x, z, h, L));
    return r;
  },
  pot(d) {
    // the game's flower pot: four walls a pixel thick round dirt four pixels deep
    const P = d.faces[0], dirt = d.L && d.L.inside !== undefined ? d.L.inside : P, S = [P, P, P, P, P, P];
    const r = [
      box(5, 0, 5, 6, 6, 11, { faces: S, uv: [[5, 10, 11, 16], [5, 10, 11, 16], [5, 5, 6, 11], [5, 5, 6, 11], [5, 10, 6, 16], [10, 10, 11, 16]] }),
      box(10, 0, 5, 11, 6, 11, { faces: S, uv: [[5, 10, 11, 16], [5, 10, 11, 16], [10, 5, 11, 11], [10, 5, 11, 11], [10, 10, 11, 16], [5, 10, 6, 16]] }),
      box(6, 0, 5, 10, 6, 6, { faces: S, skip: 3, uv: [null, null, [6, 5, 10, 6], [6, 10, 10, 11], [6, 10, 10, 16], [6, 10, 10, 16]] }),
      box(6, 0, 10, 10, 6, 11, { faces: S, skip: 3, uv: [null, null, [6, 10, 10, 11], [6, 5, 10, 6], [6, 10, 10, 16], [6, 10, 10, 16]] }),
      box(6, 0, 6, 10, 4, 10, { faces: [P, P, dirt, P, P, P], skip: 51, uv: [null, null, [6, 6, 10, 10], [6, 12, 10, 16], null, null] }),
    ];
    // the plant growing in it (the game's potted cactus, bamboo and azalea have models of their own)
    const L = d.L || {}, p = L.plant;
    if (p === undefined) return r;
    if (d.name === 'potted_cactus') {
      const s = [6, 0, 10, 11], T = L.cactusTop !== undefined ? L.cactusTop : p;
      r.push(box(6, 5, 6, 10, 16, 10, { faces: [p, p, T, p, p, p], skip: 1 << 3, uv: [s, s, [6, 6, 10, 10], null, s, s] }));
    } else if (d.name === 'potted_bamboo') {
      const s = [6, 0, 8, 16];
      r.push(box(7, 0, 7, 9, 16, 9, { faces: [p, p, p, p, p, p], skip: 1 << 3, uv: [s, s, [13, 0, 15, 2], null, s, s] }));
    } else if (L.bushTop !== undefined) {
      // an azalea: the bush, a box of sheets eight pixels across on its stem
      const T = L.bushTop, S = L.bushSide, a = [4, 5, 12, 13], b = [12, 5, 4, 13];
      r.push(sheet([4, 16, 4], [12, 16, 12], 2, [4, 4, 12, 12], T), sheet([4, 8, 4], [12, 16, 4], 5, a, S), sheet([4, 8, 12], [12, 16, 12], 4, a, S),
        sheet([4, 8, 4], [4, 16, 12], 1, a, S), sheet([12, 8, 4], [12, 16, 12], 0, a, S), ...crossed(2.6, 4, 2.6, 13.4, 16, 13.4, p, [0, 4, 16, 16]));
    } else r.push(...crossed(4.4, 4, 4.4, 11.6, 16, 11.6, p));
    return r;
  },
  cake(d, m) {
    // bits 0-2 the slices eaten (the cut side shows the inside); a candle cake has its candle on top (bit 2 lit)
    const L = d.L || {};
    if (L.candle === undefined) {
      const bites = Math.min(6, m & 7), F = d.faces;
      return [box(1 + 2 * bites, 0, 1, 15, 8, 15, bites && L.inside !== undefined ? { faces: [F[0], L.inside, F[2], F[3], F[4], F[5]] } : null)];
    }
    const c = m & 4 && L.candleLit !== undefined ? L.candleLit : L.candle;
    return [box(1, 0, 1, 15, 8, 15), ...candleAt(8, 8, 6, c, 8)];
  },
  // (every face's picture written out, so it turns with the chest as the game's chest model does)
  chest(d, m) { return turn(chestParts(d, m).map(fixUV), m & 3); },
  bed(d, m) {
    // two blocks, the head the way it faces; built facing north, so the head's far end is its north side
    const head = !!(m & 8), L = d.L || {};
    const legsAt = head ? [[0, 0], [13, 0]] : [[0, 13], [13, 13]];
    if (L.footTop === undefined) {
      // a bed with one picture for everything (straw): the picture projected onto the boxes
      const sf = d.faces[0], S = [sf, sf, sf, sf, sf, sf];
      return turn([box(0, 3, 0, 16, 9, 16, { skip: head ? 1 << 4 : 1 << 5 }), ...legsAt.map(([x, z]) => box(x, 0, z, x + 3, 3, z + 3, { faces: S }))], m & 3);
    }
    /* The game's bed is one picture folded round its boxes. The texture build cuts it into six layers per
       colour (tools/leoncraft2/build_textures.py, bed_spec): each half's top as it is; the two long sides of
       each half side by side (head_side, foot_side); both ends and a leg (head_end); the underside
       (foot_end). These rectangles fold each piece back onto its face as the game does: the pillow at the head
       end of the top and of both sides, the frame along the bottom of every side, the ends upright. */
    const top = head ? L.top : L.footTop, side = head ? L.side : L.footSide, ends = L.end, under = L.footEnd;
    const mat = box(0, 3, 0, 16, 9, 16, {
      faces: [side, side, top, under, ends, ends],
      uv: [[6, 16, 12, 0, 1], [6, 0, 0, 16, 1], [0, 0, 16, 16], [16, 16, 0, 0], [0, 12, 16, 6], [16, 6, 0, 0]],
      skip: head ? 1 << 4 : 1 << 5,
    });
    const E = [ends, ends, ends, ends, ends, ends], legUV = [[6, 12, 9, 15], [0, 12, 3, 15], [12, 12, 15, 15], [12, 12, 15, 15], [9, 12, 12, 15], [3, 12, 6, 15]];
    return turn([mat, ...legsAt.map(([x, z]) => box(x, 0, z, x + 3, 3, z + 3, { faces: E, uv: legUV }))], m & 3);
  },
  head(d, m) {
    const L = d.L || {};
    // the heavy core: half a block, its picture holding the sides below the top and the bottom (the game's model)
    if (d.name === 'heavy_core') { const s = [0, 8, 8, 16]; return [box(4, 0, 4, 12, 8, 12, { uv: [s, s, [0, 0, 8, 8], [8, 0, 16, 8], s, s] })]; }
    const fr = L.front !== undefined ? L.front : d.faces[0], bk = L.back !== undefined ? L.back : d.faces[0];
    // on a wall: the back against it, looking out
    if (d.wall || (m & 8)) return turn([box(4, 4, 0, 12, 12, 8, { faces: [d.faces[0], d.faces[1], d.faces[2], d.faces[3], fr, bk] })], sideFacing(m & 7) || 0);
    return turn([box(4, 0, 4, 12, 8, 12, { faces: [d.faces[0], d.faces[1], d.faces[2], d.faces[3], bk, fr] })], m & 3);
  },
  anvil(d, m) {
    /* The game's anvil model (it faces south as built): a foot, a narrow neck, the waist and the face on top,
       each face's picture from the anvil texture the way the model lays it, the top from the top texture. The
       meta is the way you looked when you put it down; the game's anvil faces a quarter clockwise of that. */
    const A = d.faces[0], T = d.faces[2], S = [A, A, A, A, A, A], f = faceUV;
    return turn([
      box(2, 0, 2, 14, 4, 14, { faces: S, uv: [f([4, 2, 0, 14], 270), f([0, 2, 4, 14], 90), f([2, 2, 14, 14], 180), f([2, 2, 14, 14], 180), [2, 12, 14, 16], [2, 12, 14, 16]] }),
      box(4, 4, 3, 12, 5, 13, { faces: S, skip: 1 << 3, uv: [f([5, 3, 4, 13], 270), f([4, 3, 5, 13], 90), f([4, 3, 12, 13], 180), null, [4, 11, 12, 12], [4, 11, 12, 12]] }),
      box(6, 5, 4, 10, 10, 12, { faces: S, skip: 12, uv: [f([10, 4, 5, 12], 270), f([5, 4, 10, 12], 90), null, null, [6, 6, 10, 11], [6, 6, 10, 11]] }),
      box(3, 10, 0, 13, 16, 16, { faces: [A, A, T, A, A, A], uv: [f([16, 0, 10, 16], 270), f([10, 0, 16, 16], 90), f([3, 0, 13, 16], 180), f([3, 0, 13, 16], 180), [3, 0, 13, 6], [3, 0, 13, 6]] }),
    ].map(fixUV), [2, 3, 0, 1][(m + 1) & 3]);
  },
  cactus() { return [box(1, 0, 1, 15, 16, 15)]; },
  /* Turtle eggs (the game's one to four egg models): each egg a small box with its own part of the picture;
     meta bits 0-1 how many, less one. */
  eggs(d, m) {
    const egg = (x0, y1, z0, w, top, side) => box(x0, 0, z0, x0 + w, y1, z0 + w, { uv: [side, side, top, top, side, side] });
    return [egg(5, 7, 4, 4, [0, 0, 4, 4], [1, 4, 5, 11]), egg(1, 5, 7, 4, [6, 7, 10, 11], [10, 10, 14, 15]),
      egg(11, 4, 7, 3, [5, 0, 8, 3], [8, 3, 11, 7]), egg(6, 4, 9, 4, [0, 11, 4, 15], [4, 11, 8, 15])].slice(0, (m & 3) + 1);
  },
  // a sniffer egg: fourteen by twelve and a block tall, each face its own picture (no facing in the game)
  sniffer_egg(d) {
    return [box(1, 0, 2, 15, 16, 14, { faces: [d.faces[0], d.faces[1], d.faces[2], d.faces[3], d.back !== undefined ? d.back : d.faces[4], d.front !== undefined ? d.front : d.faces[5]],
      uv: [[0, 0, 12, 16], [0, 0, 12, 16], [0, 0, 14, 12], [0, 0, 14, 12], [0, 0, 14, 16], [0, 0, 14, 16]] })];
  },
  /* A dried ghast (the game's model, built facing north): its body ten pixels square, and the tentacles, little
     boxes on three sides of it, turned to face you. */
  dried_ghast(d, m) {
    const S = d.faces[0], f = [0, 0, 10, 10], t = [S, S, S, S, S, S];
    const tent = (x0, z0, x1, z1) => box(x0, 0, z0, x1, 1, z1, { faces: t });
    return turn([box(3, 0, 3, 13, 10, 13, { faces: [d.faces[0], d.faces[1], d.faces[2], d.faces[3], d.back !== undefined ? d.back : S, d.front !== undefined ? d.front : S],
      uv: [f, f, faceUV(f, 180), [10, 0, 0, 10], f, f] }), tent(0, 5, 3, 7), tent(0, 9, 3, 11), tent(13, 5, 16, 7), tent(13, 9, 16, 11), tent(9, 13, 11, 16), tent(5, 13, 7, 16)], m & 3);
  },
  layer(d, m) { return [box(0, 0, 0, 16, 2 * ((m & 7) + 1), 16)]; },
  crop(d) { return hash([4, 12], d.faces[2], 0, 16, -1, 15); },
  sign(d, m) {
    // hanging signs hang under a block on two chains; banners are a flag on a pole
    if (d.hanging) return turn([box(1, 0, 7, 15, 10, 9), ...signChains(d, [3, 13], 'x')], m & 3);
    if (d.banner) return turn(bannerModel(d, 0), m & 3);
    // the game's sign: a board 16 by 8 and 4/3 thick standing on a post, its top a little over the block
    const bd = [0, 0, 16, 8], ps = [7, 8, 9, 16];
    const parts = [box(0, 9.33, 7.33, 16, 17.33, 8.67, { uv: [[7, 0, 8.5, 8], [7, 0, 8.5, 8], [0, 0, 16, 1.5], [0, 0, 16, 1.5], bd, bd] }),
      box(7.33, 0, 7.33, 8.67, 9.33, 8.67, { uv: [ps, ps, ps, ps, ps, ps] })];
    // the game's sixteen ways round: bits 0-1 the quarter, bits 2-3 how many sixteenths of a turn past it (clockwise)
    const k = (m >> 2) & 3;
    return turn(k ? spinY(parts, d, -k * 22.5) : parts, m & 3);
  },
  wall_sign(d, m) {
    if (d.banner) return turn(bannerModel(d, 1), sideFacing(m & 7) || 0);
    // a hanging sign on a wall sticks out from it, under a bar that runs out from the wall
    if (d.hanging) {
      const L = d.L && d.L.chain !== undefined ? d.L.chain : d.faces[0], bar = d.L && d.L.bar !== undefined ? d.L.bar : d.faces[0];
      return turn([box(7, 0, 1, 9, 10, 15), box(6, 14, 0, 10, 16, 16, { faces: [bar, bar, bar, bar, bar, bar] }), ...signChains(d, [3, 13], 'z', 14)], sideFacing(m & 7) || 0);
    }
    return turn([box(0, 4.5, 0, 16, 12.5, 1.5)], sideFacing(m & 7) || 0);
  },
  hanging_sign(d) { return [box(1, 0, 7, 15, 10, 9)]; },
  wall_torch(d, m) {
    // a torch leaning out from the wall at 22.5 degrees, as two crossed sprites (built on the north wall)
    const L = d.faces[2], F = sideFacing(m & 7) || 0;
    const c = Math.cos(Math.PI / 8), sn = Math.sin(Math.PI / 8), len = 14, w = 6;
    const B = [8, 2.5, 1.2], T = [8, 2.5 + len * c, 1.2 + len * sn];
    const q = [
      { q: [[B[0] - w, B[1], B[2]], [B[0] + w, B[1], B[2]], [T[0] + w, T[1], T[2]], [T[0] - w, T[1], T[2]]], uv: [0, 0, 16, 16], layer: L },
      { q: [[8, B[1] + w * sn, B[2] - w * c], [8, B[1] - w * sn, B[2] + w * c], [8, T[1] - w * sn, T[2] + w * c], [8, T[1] + w * sn, T[2] - w * c]], uv: [0, 0, 16, 16], layer: L },
    ];
    return turn(q, F);
  },
};

/* A banner at the game's size (its model is 2/3 scale): a flag 13 1/3 by 26 2/3 pixels on a crossbar, on a pole
   1 3/4 blocks tall; on a wall the pole is left out and it all hangs 5 pixels lower, the bar against the wall. */
function bannerModel(d, wall) {
  const W = d.faces[0], P = d.L && d.L.pole !== undefined ? d.L.pole : W;
  const pole = [P, P, P, P, P, P], flagUV = [[0, 0, 1, 16], [0, 0, 1, 16], [0, 0, 16, 1], [0, 0, 16, 1], [0, 0, 16, 16], [0, 0, 16, 16]];
  // (sway: the flag, which RIP Computer's shaders wave from its top, mesher.js drawList)
  if (wall) return [box(1.33, 23, 0.33, 14.67, 24.33, 1.67, { faces: pole }), box(1.33, -2.33, 1.67, 14.67, 24.33, 2.33, { uv: flagUV, sway: true })];
  return [box(7.33, 0, 7.33, 8.67, 28, 8.67, { faces: pole }), box(1.33, 28, 7.33, 14.67, 29.33, 8.67, { faces: pole }),
    box(1.33, 2.67, 6.67, 14.67, 29.33, 7.33, { uv: flagUV, sway: true })];
}
// the chains a hanging sign hangs from: a pair of crossed strips at each of two spots along the board
function signChains(d, at, along, top = 16) {
  const L = d.L && d.L.chain !== undefined ? d.L.chain : d.faces[0], r = [];
  for (const c of at) {
    const [x, z] = along === 'x' ? [c, 8] : [8, c];
    r.push({ q: [[x - 1.5, 10, z], [x + 1.5, 10, z], [x + 1.5, top, z], [x - 1.5, top, z]], uv: [0, 0, 3, top - 10], layer: L },
      { q: [[x, 10, z - 1.5], [x, 10, z + 1.5], [x, top, z + 1.5], [x, top, z - 1.5]], uv: [3, 0, 6, top - 10], layer: L });
  }
  return r;
}

/* ---- shapes worked out from the neighbours, drawn flat on the ground ---- */
const FLAT_UV = [0, 0, 16, 16];
function flat(layer, y, rot, uv) {
  // a quad lying on the ground, its texture turned a quarter at a time
  const c = [[0, y, 0], [16, y, 0], [16, y, 16], [0, y, 16]];
  const r = [0, 1, 2, 3].map(i => c[(i + rot) & 3]);
  return { q: [r[3], r[2], r[1], r[0]], uv: uv || FLAT_UV, layer, up: true };
}
SHAPES.rail = function (d, m, nb) {
  const rail = n => n && n.d.shape === 'rail';
  const c = DIRS.map(v => rail(nb(v[0], 0, v[2])) || rail(nb(v[0], -1, v[2])));
  const up = DIRS.map(v => rail(nb(v[0], 1, v[2])));
  const L = d.faces[2], corner = d.L && d.L.corner !== undefined ? d.L.corner : L;
  // curves only for the plain rail, as in the game
  if (corner !== L) {
    const pairs = [[2, 1, 0], [2, 3, 1], [0, 3, 2], [0, 1, 3]];   // south+east, south+west, north+west, north+east
    for (const [a, b, rot] of pairs) if (c[a] && c[b] && !c[(a + 2) & 3] && !c[(b + 2) & 3]) return [flat(corner, 1, rot)];
  }
  const ew = (c[1] || c[3]) && !(c[0] || c[2]);
  for (let k = 0; k < 4; k++) if (up[k] && (ew ? (k & 1) : !(k & 1))) {
    // up a slope towards the raised neighbour
    const q = flat(L, 1, ew ? 1 : 0);
    q.q = q.q.map(([x, y, z]) => [x, y + (k === 0 ? 16 - z : k === 2 ? z : k === 1 ? x : 16 - x), z]);
    return [q];
  }
  return [flat(L, 1, ew ? 1 : 0)];
};
SHAPES.wire = function (d, m, nb) {
  const joins = n => n && (n.d.shape === 'wire' || n.d.redstone);
  const c = DIRS.map(v => joins(nb(v[0], 0, v[2])) || joins(nb(v[0], -1, v[2])) || joins(nb(v[0], 1, v[2])));
  const dot = d.L && d.L.dot !== undefined ? d.L.dot : d.faces[2];
  const line = d.L && d.L.line !== undefined ? d.L.line : dot;
  const n = c.filter(Boolean).length, y = 0.25;
  if (n === 0) return [flat(dot, y, 0)];
  const ns = c[0] || c[2], ew = c[1] || c[3];
  if (ns && !ew) return [flat(line, y, 0)];
  if (ew && !ns) return [flat(line, y, 1)];
  // a crossing or a bend: the dot and a half line out to each joined side
  const r = [flat(dot, y, 0)];
  const halves = [[0, 0, 16, 8], [8, 0, 16, 16], [0, 8, 16, 16], [0, 0, 8, 16]];
  c.forEach((on, k) => {
    if (!on) return;
    const [x0, z0, x1, z1] = halves[k];
    const vertical = !(k & 1);
    const uv = vertical ? [0, z0, 16, z1] : [0, x0, 16, x1];
    // (a half step above the dot: the mesh keeps heights in half pixels, and in one plane the two flickered)
    const yl = y + (k & 1 ? 1 : 0.5);      // (east and west a step over north and south, which they cross)
    const q = { q: [[x0, yl, z1], [x1, yl, z1], [x1, yl, z0], [x0, yl, z0]], uv, layer: line, up: true };
    if (!vertical) q.q = [[x0, yl, z1], [x0, yl, z0], [x1, yl, z0], [x1, yl, z1]];
    r.push(q);
  });
  return r;
};
/* ---- vines: the faces a vine hangs on, in its meta ----
   bit 0 north, 1 east, 2 south, 3 west, 4 under the block above (the game's
   north/east/south/west/up). A side holds while the block that way has a
   whole face towards it, or while the vine above has that same side: so a
   vine hangs down a wall and on below its foot, a sheet in the air where the
   wall was, as the game's do. A vine whose meta has no faces (one kept
   before the faces were, or a structure's) takes them from what is round
   it, and below another vine, that vine's sides. */
export const VINE_UP = 16;
export const VINE_SIDES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];      // dx, dz, bit
// a whole face towards the vine (the game's isFaceFull of its collision; leaves count)
export const vineHolds = n => !!n && !!n.d && n.d.solid && n.d.shape === 'cube';
// the faces of a vine at nb(0, 0, 0) with meta m: its own, or worked out when it has none
export function vineFaces(m, nb) {
  if (m & 31) return m & 31;
  let f = 0;
  for (const [dx, dz, bit] of VINE_SIDES) if (vineHolds(nb(dx, 0, dz))) f |= bit;
  if (vineHolds(nb(0, 1, 0))) f |= VINE_UP;
  if (f) return f;
  // nothing to hold: below a vine, the sides of that one
  const a = nb(0, 1, 0);
  if (a && a.d.name === 'vine') {
    if (a.m & 15) return a.m & 15;
    for (const [dx, dz, bit] of VINE_SIDES) if (vineHolds(nb(dx, 1, dz))) f |= bit;
  }
  if (f) return f;
  // (a structure's vine beside stairs or a slab: against that, rather than flat in the air)
  for (const [dx, dz, bit] of VINE_SIDES) { const n = nb(dx, 0, dz); if (n && n.d.solid) f |= bit; }
  return f || VINE_UP;
}
SHAPES.vine = function (d, m, nb) {
  // the game's vine model: one plane 0.8 pixels in from each face it hangs on
  const r = [], L = d.faces[2], e = 0.8, f = vineFaces(m, nb);
  if (f & 1) r.push({ q: [[16, 0, e], [0, 0, e], [0, 16, e], [16, 16, e]], uv: FLAT_UV, layer: L });
  if (f & 4) r.push({ q: [[0, 0, 16 - e], [16, 0, 16 - e], [16, 16, 16 - e], [0, 16, 16 - e]], uv: FLAT_UV, layer: L });
  if (f & 2) r.push({ q: [[16 - e, 0, 16], [16 - e, 0, 0], [16 - e, 16, 0], [16 - e, 16, 16]], uv: FLAT_UV, layer: L });
  if (f & 8) r.push({ q: [[e, 0, 0], [e, 0, 16], [e, 16, 16], [e, 16, 0]], uv: FLAT_UV, layer: L });
  if (f & VINE_UP) r.push({ q: [[0, 16 - e, 16], [16, 16 - e, 16], [16, 16 - e, 0], [0, 16 - e, 0]], uv: FLAT_UV, layer: L });
  return r;
};

/* ---- glow lichen, sculk veins, resin clumps: a sheet on any of the six faces of their cell (the game's
   multiface blocks) ----
   meta bits 0 down, 1 up, 2 north, 3 south, 4 west, 5 east (the order gen/misc.js keeps faces in). One with none
   kept (an older save, a structure's vein) is on its floor when that is whole, else on the first whole face round
   it. A face holds while the block that way is whole (sim/plants.js). Each sheet sits half a pixel off its face
   (the game's 0.1 of a pixel is finer than the mesher keeps). */
export const MULTI_DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
export function multiFaces(m, nb) {
  if (m & 63) return m & 63;
  for (let i = 0; i < 6; i++) { const [dx, dy, dz] = MULTI_DIRS[i]; if (vineHolds(nb(dx, dy, dz))) return 1 << i; }
  return 1;
}
SHAPES.multiface = function (d, m, nb) {
  const r = [], L = d.faces[2], e = 0.5, f = multiFaces(m, nb);
  if (f & 1) r.push({ q: [[0, e, 0], [16, e, 0], [16, e, 16], [0, e, 16]], uv: FLAT_UV, layer: L });
  if (f & 2) r.push({ q: [[0, 16 - e, 16], [16, 16 - e, 16], [16, 16 - e, 0], [0, 16 - e, 0]], uv: FLAT_UV, layer: L });
  if (f & 4) r.push({ q: [[16, 0, e], [0, 0, e], [0, 16, e], [16, 16, e]], uv: FLAT_UV, layer: L });
  if (f & 8) r.push({ q: [[0, 0, 16 - e], [16, 0, 16 - e], [16, 16, 16 - e], [0, 16, 16 - e]], uv: FLAT_UV, layer: L });
  if (f & 16) r.push({ q: [[e, 0, 0], [e, 0, 16], [e, 16, 16], [e, 16, 0]], uv: FLAT_UV, layer: L });
  if (f & 32) r.push({ q: [[16 - e, 0, 16], [16 - e, 0, 0], [16 - e, 16, 0], [16 - e, 16, 16]], uv: FLAT_UV, layer: L });
  return r;
};

// the end portal frame: 13/16 tall, and the eye on top once one is in (bit 2 of the meta)
SHAPES.portal_frame = function (d, m) {
  // the game's frame model (it faces south as built), its top turning with it; the eye from our own art (js/dim/art.js)
  const L = d.L || {}, e = L.eye !== undefined ? L.eye : L.content !== undefined ? L.content : d.faces[2];
  const s = [0, 3, 16, 16], f = [0, 0, 16, 16];
  const r = [box(0, 0, 0, 16, 13, 16, { uv: [s, s, f, f, s, s] })];
  if (m & 4) r.push(box(4, 13, 4, 12, 16, 12, { faces: [e, e, e, e, e, e], skip: 1 << 3, uv: [[4, 0, 12, 3], [4, 0, 12, 3], [4, 4, 12, 12], [4, 4, 12, 12], [4, 0, 12, 3], [4, 0, 12, 3]] }));
  return turn(r, [2, 3, 0, 1][m & 3]);
};

/* ---- the hollow blocks and the village things, from the game's own block models ---- */
// four walls two pixels thick round a hole, from y0 to the top: outside, inside and the rim each their own texture
function walls(y0, out, inn, rim, bottom) {
  const w = (x0, z0, x1, z1, f) => box(x0, y0, z0, x1, 16, z1, { faces: f });
  return [
    w(0, 0, 2, 16, [inn, out, rim, bottom, out, out]),
    w(14, 0, 16, 16, [out, inn, rim, bottom, out, out]),
    w(2, 0, 14, 2, [out, out, rim, bottom, inn, out]),
    w(2, 14, 14, 16, [out, out, rim, bottom, out, inn]),
  ];
}
const LVL = { 1: 9, 2: 12, 3: 15 };
SHAPES.cauldron = function (d, m) {
  const L = d.L || {}, S = d.faces[0], T = d.faces[2], Bt = d.faces[3], I = L.inside !== undefined ? L.inside : S;
  // (the undersides of the walls and of the floor show the inside, as in the game's model)
  const r = walls(3, S, I, T, I).map(b => Object.assign(b, { plain: true }));
  r.push(box(2, 3, 2, 14, 4, 14, { faces: [I, I, I, I, I, I], plain: true }));
  // the four feet: two little blocks at each corner
  for (const [x0, z0, x1, z1] of [[0, 0, 4, 2], [0, 2, 2, 4], [12, 0, 16, 2], [14, 2, 16, 4], [0, 14, 4, 16], [0, 12, 2, 14], [12, 14, 16, 16], [14, 12, 16, 14]])
    r.push(box(x0, 0, z0, x1, 3, z1, { faces: [S, S, Bt, Bt, S, S], plain: true }));
  // what it holds: water and powder snow by level (meta 1-3, 0 counts as full), lava always full
  if (L.content !== undefined) {
    const y = /lava/.test(d.name) ? 15 : LVL[(m & 3) || 3];
    const c = L.content;
    r.push(box(2, y, 2, 14, y, 14, { faces: [c, c, c, c, c, c], skip: 63 & ~(1 << 2) }));
  }
  return r;
};
SHAPES.composter = function (d, m) {
  const L = d.L || {}, S = d.faces[0], T = d.faces[2], Bt = d.faces[3];
  const r = walls(2, S, S, T, Bt);
  r.push(box(0, 0, 0, 16, 2, 16, { faces: [S, S, Bt, Bt, S, S] }));
  // the compost: a step of two pixels for each level, the finished heap nearly to the rim
  const lv = Math.min(8, m & 15);
  if (lv > 0) {
    const c = lv === 8 ? (L.ready !== undefined ? L.ready : Bt) : (L.compost !== undefined ? L.compost : Bt);
    const y = lv === 8 ? 15 : 1 + 2 * lv;
    r.push(box(2, y, 2, 14, y, 14, { faces: [c, c, c, c, c, c], skip: 63 & ~(1 << 2) }));
  }
  return r;
};
SHAPES.hopper = function (d, m) {
  /* The game's hopper: a rim round the open top, the floor of the bowl, the funnel and the spout: straight
     down (meta 4 or more), or out of a side towards where it passes things (that model turned to it). The
     undersides show the inside texture, as the game's do. */
  const L = d.L || {}, O = d.faces[0], T = d.faces[2], I = L.inside !== undefined ? L.inside : O;
  const f = m & 7;
  const r = [
    box(0, 10, 0, 16, 11, 16, { faces: [O, O, I, I, O, O] }),
    box(0, 11, 0, 2, 16, 16, { faces: [O, O, T, O, O, O], skip: 1 << 3 }), box(14, 11, 0, 16, 16, 16, { faces: [O, O, T, O, O, O], skip: 1 << 3 }),
    box(2, 11, 0, 14, 16, 2, { faces: [O, O, T, O, O, O], skip: 11 }), box(2, 11, 14, 14, 16, 16, { faces: [O, O, T, O, O, O], skip: 11 }),
    box(4, 4, 4, 12, 10, 12, { faces: [O, O, O, I, O, O], skip: 1 << 2 }),
    f >= 4 ? box(6, 0, 6, 10, 4, 10, { faces: [O, O, O, I, O, O], skip: 1 << 2 }) : box(6, 4, 0, 10, 8, 4, { faces: [O, O, O, I, O, O], skip: 1 << 4 }),
  ];
  return f >= 4 ? r : turn(r.map(fixUV), f);
};
// a campfire: four logs crossed in two layers over the embers, and the flames in two crossed planes
SHAPES.campfire = function (d, m) {
  const L = d.L || {}, lit = !(m & 4);
  // the game's campfire model (built facing south): the glowing faces are the lit log texture while it burns
  const log = L.side !== undefined ? L.side : d.faces[0], lt = lit && L.top !== undefined ? L.top : log, g = faceUV, n = [0, 0, 0, 0];
  // (put out, the crossing logs' undersides are the plain log's end of the picture)
  const under = lit ? [0, 4, 16, 8] : [0, 0, 16, 4];
  const r = [
    box(1, 0, 0, 5, 4, 16, { faces: [lt, log, log, log, log, log], uv: [[0, 1, 16, 5], [16, 0, 0, 4], g([0, 0, 16, 4], 90), g([0, 0, 16, 4], 90), [0, 4, 4, 8], [0, 4, 4, 8]] }),
    box(0, 3, 11, 16, 7, 15, { faces: [log, log, log, lt, lt, lt], uv: [[0, 4, 4, 8], [0, 4, 4, 8], g([0, 0, 16, 4], 180), under, [0, 0, 16, 4], [16, 0, 0, 4]] }),
    box(11, 0, 0, 15, 4, 16, { faces: [log, lt, log, log, log, log], uv: [[0, 0, 16, 4], [16, 1, 0, 5], g([0, 0, 16, 4], 90), g([0, 0, 16, 4], 90), [0, 4, 4, 8], [0, 4, 4, 8]] }),
    box(0, 3, 1, 16, 7, 5, { faces: [log, log, log, lt, lt, lt], uv: [[0, 4, 4, 8], [0, 4, 4, 8], g([0, 0, 16, 4], 180), under, [16, 0, 0, 4], [0, 0, 16, 4]] }),
    box(5, 0, 0, 11, 1, 16, { faces: [log, log, lt, log, log, log], skip: 3, uv: [n, n, g([0, 8, 16, 14], 90), g([0, 8, 16, 14], 90), [10, 15, 16, 16], [0, 15, 6, 16]] }),
  ];
  if (lit && L.fire !== undefined) r.push(...crossed(0.8, 1, 0.8, 15.2, 17, 15.2, L.fire));
  // the meta is the way it faces (the way you looked when you put it down)
  return turn(r, [2, 3, 0, 1][m & 3]);
};
// a bell: the bell itself (body and lip) and what holds it, by meta: bit 0 from the ceiling, bits 1-2 facing,
// bit 3 on one wall, bit 5 between two walls (bit 4 is power, kept by the redstone)
SHAPES.bell = function (d, m) {
  const L = d.L || {}, S = d.faces[0], T = d.faces[2], Bt = d.faces[3];
  const post = L.post !== undefined ? L.post : S, bar = L.bar !== undefined ? L.bar : S;
  const P = [post, post, post, post, post, post], R = [bar, bar, bar, bar, bar, bar];
  const body = [
    box(5, 6, 5, 11, 13, 11, { faces: [S, S, T, Bt, S, S], uv: [[1, 0, 7, 7], [1, 0, 7, 7], [1, 1, 7, 7], [1, 1, 7, 7], [1, 0, 7, 7], [1, 0, 7, 7]] }),
    box(4, 4, 4, 12, 6, 12, { faces: [S, S, T, Bt, S, S], uv: [[0, 7, 8, 9], [0, 7, 8, 9], [0, 0, 8, 8], [0, 0, 8, 8], [0, 7, 8, 9], [0, 7, 8, 9]] }),
  ];
  // (512: the bell alone, which swings when it rings, sim/lids.js; 256: everything but it)
  if (m & 512) return body;
  const r = m & 256 ? [] : body;
  // what holds it, as the game's bell_floor, bell_ceiling, bell_wall and bell_between_walls models lay their pictures,
  // turned the way it faces (the wall ones are built against the east wall)
  const F = (m >> 1) & 3, barUV = [null, null, [2, 3, 14, 5], [2, 3, 14, 5], [2, 3, 14, 5], [2, 2, 14, 4]];
  let hold;
  if (m & 1) hold = rotate([box(7, 13, 7, 9, 16, 9, { faces: R, skip: 1 << 3, uv: [[1, 2, 3, 5], [4, 2, 6, 5], [1, 3, 3, 5], null, [6, 2, 8, 5], [7, 2, 9, 5]] })], 0, F);
  else if (m & 40) {
    const end = [5, 4, 7, 6], u = barUV.slice(); u[0] = u[1] = end;
    hold = rotate([box(m & 32 ? 0 : 3, 13, 7, 16, 15, 9, { faces: R, uv: u })], 0, (F + 3) & 3);
  } else {
    const ps = [0, 1, 2, 16], pe = [0, 1, 4, 16], pt = [0, 0, 2, 4], post = x => box(x, 0, 6, x + 2, 16, 10, { faces: P, uv: [pe, pe, pt, pt, ps, ps] });
    hold = rotate([box(2, 13, 7, 14, 15, 9, { faces: R, skip: 3, uv: barUV }), post(0), post(14)], 0, F);
  }
  return r.concat(hold);
};
// an item frame: twelve pixels square and one thick against the face it hangs on (bits 0-2), drawn by details.js
SHAPES.frame = function (d, m) { return hang([box(2, 0, 2, 14, 1, 14, { hide: true })], m & 7); };
/* A lectern (the game's lectern model, facing north): a base two pixels thick, the post with its front, and the
   reading top tilted 22.5 degrees about the middle so it leans down to the front. */
SHAPES.lectern = function (d, m) {
  const L = d.L || {}, P = d.faces[3], S = L.side !== undefined ? L.side : P, F = d.front !== undefined ? d.front : S, T = d.faces[2];
  const Bs = L.base !== undefined ? L.base : P, n = [0, 0, 0, 0];
  const r = [box(0, 0, 0, 16, 2, 16, { faces: [Bs, Bs, Bs, P, Bs, Bs], uv: [[0, 6, 16, 8], [0, 6, 16, 8], faceUV([0, 0, 16, 16], 180), [0, 0, 16, 16], [0, 6, 16, 8], [0, 14, 16, 16]] }),
    box(4, 2, 4, 12, 15, 12, { faces: [S, S, S, S, F, F], skip: 12, uv: [faceUV([2, 16, 15, 8], 90), faceUV([2, 8, 15, 16], 90), n, n, [8, 3, 16, 16], [0, 0, 8, 13]] }),
    // the tilted top: there to be bumped into and picked, drawn as the quads below
    box(0, 12, 2, 16, 16, 16, { hide: true })];
  const a = -Math.PI / 8, c = Math.cos(a), s = Math.sin(a);
  const R = ([x, y, z]) => [x, 8 + (y - 8) * c - (z - 8) * s, 8 + (y - 8) * s + (z - 8) * c];
  const x0 = 0.0125, x1 = 15.9875, y0 = 12, y1 = 16, z0 = 3, z1 = 16;
  const q = (pts, uv, layer) => r.push({ q: pts.map(R), uv, layer });
  // (each quad's picture as the game's model lays it: the top turned half round, the sides from the band below the edge)
  q([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [16, 1, 0, 14], T);          // up
  q([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [0, 13, 16, 0], P);          // down
  q([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, 16, 4], S);           // north (front)
  q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 4, 16, 8], S);           // south
  q([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [0, 4, 13, 8], S);           // east
  q([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [0, 4, 13, 8], S);           // west
  return turn(r, m & 3);
};
// a grindstone on the floor (facing north): the wheel between two pivots on dark oak legs
SHAPES.grindstone = function (d, m) {
  // the game's grindstone model (its pictures laid as that model lays them); it faces the way you looked when you
  // put it down, which is the way round from the meta (that stores the side towards you)
  const L = d.L || {}, side = d.faces[0], round = L.top !== undefined ? L.top : side, piv = d.front !== undefined ? d.front : side;
  const leg = L.leg !== undefined ? L.leg : piv, Pv = [piv, piv, piv, piv, piv, piv], Lg = [leg, leg, leg, leg, leg, leg];
  return turn([
    box(12, 0, 6, 14, 7, 10, { faces: Lg, skip: 1 << 2, uv: [[10, 16, 6, 9], [6, 9, 10, 16], [0, 0, 0, 0], [12, 6, 14, 10], [12, 9, 14, 16], [2, 9, 4, 16]] }),
    box(2, 0, 6, 4, 7, 10, { faces: Lg, skip: 1 << 2, uv: [[10, 16, 6, 9], [6, 9, 10, 16], [0, 0, 0, 0], [2, 6, 4, 10], [2, 9, 4, 16], [12, 9, 14, 16]] }),
    box(12, 7, 5, 14, 13, 11, { faces: Pv, skip: 1 << 1, uv: [[0, 0, 6, 6], [0, 0, 0, 0], [8, 0, 10, 6], [8, 0, 10, 6], [6, 0, 8, 6], [6, 0, 8, 6]] }),
    box(2, 7, 5, 4, 13, 11, { faces: Pv, skip: 1 << 0, uv: [[0, 0, 0, 0], [0, 0, 6, 6], [8, 0, 10, 6], [8, 0, 10, 6], [6, 0, 8, 6], [6, 0, 8, 6]] }),
    box(4, 4, 2, 12, 16, 14, { faces: [side, side, round, round, round, round], uv: [[0, 0, 12, 12], [0, 0, 12, 12], [0, 0, 8, 12], [0, 0, 8, 12], [0, 0, 8, 12], [0, 0, 8, 12]] }),
  ], (m + 2) & 3);
};
// the game's stonecutter: a block nine pixels tall with its saw blade standing across the middle, turned to face you
SHAPES.stonecutter = function (d, m) {
  const L = d.L || {}, saw = L.saw !== undefined ? L.saw : d.faces[0], s = [0, 7, 16, 16], f = [0, 0, 16, 16];
  // (the blade reads the same from both sides, its picture running from east to west)
  return turn([box(0, 0, 0, 16, 9, 16, { uv: [s, s, f, f, s, s] }), { q: [[1, 9, 8], [15, 9, 8], [15, 16, 8], [1, 16, 8]], uv: [15, 9, 1, 16], layer: saw }], m & 3);
};
// an enchanting table is twelve pixels tall
SHAPES.table = function (d) { return [box(0, 0, 0, 16, d.h || 12, 16)]; };
// a beacon: the glass case, the obsidian it stands on and the beacon inside (the game's model)
SHAPES.beacon = function (d) {
  const L = d.L || {}, G = d.faces[0], O = L.bottom !== undefined ? L.bottom : d.faces[3], C = L.top !== undefined ? L.top : d.faces[2];
  const f = [0, 0, 16, 16], o = [2, 13, 14, 16], c = [3, 2, 13, 13];
  return [box(0, 0, 0, 16, 16, 16, { faces: [G, G, G, G, G, G], uv: [f, f, f, f, f, f] }),
    box(2, 0.1, 2, 14, 3, 14, { faces: [O, O, O, O, O, O], uv: [o, o, [2, 2, 14, 14], [2, 2, 14, 14], o, o] }),
    box(3, 3, 3, 13, 14, 13, { faces: [C, C, C, C, C, C], uv: [c, c, [3, 3, 13, 13], [3, 3, 13, 13], c, c] })];
};
/* A shelf (the game's model, built facing north): a board three pixels thick against the wall behind, a ledge
   along its foot and one along its top, and the back between them. Its picture holds those parts side by side. */
SHAPES.shelf = function (d, m) {
  const n = [0, 0, 0, 0];
  return turn([
    box(0, 0, 13, 16, 16, 16, { skip: 32, uv: [[8, 0, 9.5, 8], [14.5, 0, 16, 8], [16, 5, 8, 3.5], [16, 6, 8, 4.5], [8, 0, 16, 8], n] }),
    box(0, 0, 11, 16, 4, 13, { skip: 16, uv: [[1.5, 6, 2.5, 8], [5.5, 6, 6.5, 8], [8, 3.5, 16, 4.5], [16, 4.5, 8, 3.5], n, [0, 6, 8, 8]] }),
    box(0, 12, 11, 16, 16, 13, { skip: 16, uv: [[1.5, 0, 2.5, 2], [5.5, 0, 6.5, 2], [16, 6, 8, 5], [8, 5, 16, 6], n, [0, 0, 8, 2]] }),
    box(0, 4, 13, 16, 12, 13, { skip: 31, uv: [n, n, n, n, n, [0, 2, 8, 6]] }),
  ], m & 3);
};
/* A chiseled bookshelf (the game's model, built facing north): the body with the shelf's sides and top, and its
   front in six slots, two rows of three, each its part of the picture with a book in it or empty (meta bits 2-7,
   slot 0 the top left as you face it; bits 0-1 the way it faces). */
const CHISEL_SLOTS = [[10, 16, 8, 16, 0], [5, 10, 8, 16, 6], [0, 5, 8, 16, 11], [10, 16, 0, 8, 0], [5, 10, 0, 8, 6], [0, 5, 0, 8, 11]];
SHAPES.chiseled = function (d, m) {
  const L = d.L || {}, full = L.occupied !== undefined ? L.occupied : d.front, empty = d.front !== undefined ? d.front : d.faces[0];
  const r = [box(0, 0, 0, 16, 16, 16, { skip: 1 << 5 })];
  CHISEL_SLOTS.forEach(([x0, x1, y0, y1, u], k) => {
    const v = 16 - y1, layer = m & (4 << k) ? full : empty, F = [0, 0, 0, 0, 0, layer];
    r.push(box(x0, y0, 0, x1, y1, 0, { faces: F, skip: 63 & ~(1 << 5), uv: [null, null, null, null, null, [u, v, u + (x1 - x0), v + (y1 - y0)]] }));
  });
  return turn(r, m & 3);
};
// a conduit not at work: its shell, six pixels square, floating in the middle of the block (an active one opens:
// sim/conduit.js draws it then, and the block leaves the shell out, meta + 256)
SHAPES.conduit = function (d, m) { const s = [5, 5, 11, 11]; return m & 256 ? [] : [box(5, 5, 5, 11, 11, 11, { uv: [s, s, s, s, s, s] })]; };
/* A decorated pot (the game's pot): the body fourteen pixels square and a block tall, each side the middle of
   its picture, then a narrow collar and the wider lip on top. */
SHAPES.vase = function (d, m) {
  // (while it wobbles the whole pot moves, drawn by sim/lids.js)
  if (m & 256) return [];
  const S = d.faces[0], T = d.L && d.L.base !== undefined ? d.L.base : S, s = [1, 0, 15, 16], t = [1, 1, 15, 15];
  return [box(1, 0, 1, 15, 16, 15, { faces: [S, S, T, T, S, S], uv: [s, s, t, t, s, s] }),
    box(5, 16, 5, 11, 17, 11, { faces: [S, S, S, S, S, S], skip: 12, uv: [[5, 0, 11, 1], [5, 0, 11, 1], null, null, [5, 0, 11, 1], [5, 0, 11, 1]] }),
    box(4, 17, 4, 12, 20, 12, { faces: [S, S, T, S, S, S], uv: [[4, 0, 12, 3], [4, 0, 12, 3], [4, 4, 12, 12], [4, 4, 12, 12], [4, 0, 12, 3], [4, 0, 12, 3]] })];
};
/* A brewing stand (the game's model): the rod, three stone feet, and three arms, sheets out from the rod to the
   east, the north-west and the south-west, each the bottle half of the picture while that slot holds a bottle
   (meta bits 0-2, kept by containers.js) and the empty arm half while it does not. */
SHAPES.brewing = function (d, m) {
  const L = d.L || {}, S = d.faces[0], base = L.base !== undefined ? L.base : S;
  const Bs = [base, base, base, base, base, base], rs = [7, 2, 9, 16], rt = [7, 7, 9, 9];
  const r = [box(7, 0, 7, 9, 14, 9, { faces: [S, S, S, S, S, S], uv: [rs, rs, rt, rt, rs, rs] }),
    box(9, 0, 5, 15, 2, 11, { faces: Bs, uv: [[5, 14, 11, 16], [5, 14, 11, 16], [9, 5, 15, 11], [9, 5, 15, 11], [9, 14, 15, 16], [9, 14, 15, 16]] }),
    box(1, 0, 1, 7, 2, 7, { faces: Bs, uv: [[1, 14, 7, 16], [1, 14, 7, 16], [1, 1, 7, 7], [1, 1, 7, 7], [1, 14, 7, 16], [1, 14, 7, 16]] }),
    box(1, 0, 9, 7, 2, 15, { faces: Bs, uv: [[9, 14, 15, 16], [9, 14, 15, 16], [1, 9, 7, 15], [1, 9, 7, 15], [1, 14, 7, 16], [1, 14, 7, 16]] })];
  r.push(sheet([8, 0, 8], [16, 16, 8], 5, m & 1 ? [0, 0, 8, 16] : [16, 0, 8, 16], S));
  // the other two arms point west and are turned 45 degrees either way about the rod
  for (const [bit, ang] of [[2, -Math.PI / 4], [4, Math.PI / 4]]) {
    const q = sheet([-0.41, 0, 8], [7.59, 16, 8], 5, m & bit ? [8, 0, 0, 16] : [8, 0, 16, 16], S), c = Math.cos(ang), sn = Math.sin(ang);
    q.q = q.q.map(([x, y, z]) => [8 + (x - 8) * c + (z - 8) * sn, y, 8 - (x - 8) * sn + (z - 8) * c]);
    r.push(q);
  }
  return r;
};

/* ---- fire, as the game's fire model draws it ----
   Its planes are a block and two fifths tall, the picture stretched up them.
   On something it stands on (a top face that holds, or a block that burns)
   it is four planes leaning across the middle, two each way, and one sheet
   against each side; with nothing under it, a sheet against each side that
   burns and two planes leaning down from a block above that burns (the
   game's north/east/south/west/up states, worked out from the neighbours as
   the game works them out). The planes were measured from the game's fire
   models: each turned 22.5 degrees about its own line and stretched by
   1 / cos 22.5, as the game's model "rescale" does (of the game's picks of
   each, by the block's place, the first is drawn: a model has no place
   here). Soul fire is always the floor kind. */
const turnPlane = (pts, axis, deg, o) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), k = 1 / Math.cos(Math.PI / 8);
  return pts.map(([x, y, z]) => {
    let px = x - o[0], py = y - o[1], pz = z - o[2];
    if (axis === 'x') { const ny = py * c - pz * sn, nz = py * sn + pz * c; py = ny * k; pz = nz * k; }
    else { const nx = px * c - py * sn, ny = px * sn + py * c; px = nx * k; py = ny * k; }
    return [px + o[0], py + o[1], pz + o[2]];
  });
};
const FH = 22.4, FO = [8, 8, 8];
const FIRE_FLOOR = [
  turnPlane([[0, 0, 8.8], [16, 0, 8.8], [16, FH, 8.8], [0, FH, 8.8]], 'x', -22.5, FO),
  turnPlane([[16, 0, 7.2], [0, 0, 7.2], [0, FH, 7.2], [16, FH, 7.2]], 'x', 22.5, FO),
  turnPlane([[8.8, 0, 0], [8.8, 0, 16], [8.8, FH, 16], [8.8, FH, 0]], 'z', -22.5, FO),
  turnPlane([[7.2, 0, 16], [7.2, 0, 0], [7.2, FH, 0], [7.2, FH, 16]], 'z', 22.5, FO),
];
// a sheet against each side: north, east, south, west (the game's side model turned 0, 90, 180, 270); the game's sits
// 0.01 of a pixel off the face, here half a pixel, the finest step the mesher keeps, so it never lies in the face itself
const FIRE_SIDE = [0, 1, 2, 3].map(r => [[0, 0, 0.5], [16, 0, 0.5], [16, FH, 0.5], [0, FH, 0.5]].map(([x, y, z]) => {
  for (let i = 0; i < r; i++) [x, z] = [16 - z, x];
  return [x, y, z];
}));
// hanging under a block that burns: leaning down from its east and west top edges (the game's fire_up)
const FIRE_UP = [
  turnPlane([[0, 16, 16], [16, 16, 16], [16, 16, 0], [0, 16, 0]], 'z', 22.5, [16, 16, 8]),
  turnPlane([[0, 16, 16], [16, 16, 16], [16, 16, 0], [0, 16, 0]], 'z', -22.5, [0, 16, 8]),
];
const FIRE_UV = [0, 0, 16, 16];
// what a fire stands on: a top face that holds (full blocks, top and double slabs, upside-down stairs)
const fireFloor = n => !!n && n.d.solid && (n.d.shape === 'cube' || (n.d.shape === 'slab' && (n.m & 3) >= 1) || (n.d.shape === 'stairs' && (n.m & 4) !== 0));
SHAPES.fire = function (d, m, nb) {
  const L = d.faces[2], r = [];
  const burns = n => !!n && burnable(n.d);
  const below = nb(0, -1, 0);
  let floor = d.name === 'soul_fire' || fireFloor(below) || burns(below);
  const side = floor ? [false, false, false, false] : [burns(nb(0, 0, -1)), burns(nb(1, 0, 0)), burns(nb(0, 0, 1)), burns(nb(-1, 0, 0))];
  const up = !floor && burns(nb(0, 1, 0));
  if (!up && !side.some(Boolean)) floor = true;
  if (floor) for (const q of FIRE_FLOOR) r.push({ q, uv: FIRE_UV, layer: L });
  for (let k = 0; k < 4; k++) if (floor || side[k]) r.push({ q: FIRE_SIDE[k], uv: FIRE_UV, layer: L });
  if (up) for (const q of FIRE_UP) r.push({ q, uv: FIRE_UV, layer: L });
  return r;
};

export const MODEL_SHAPES = new Set(Object.keys(SHAPES));

/* ---- full blocks that turn: which picture on which face, and which way up ----
   As the game's block models write them: the six faces of the block standing
   unturned (east, west, up, down, south, north: a texture by its part of the
   block's set, a turn of the picture clockwise, and whether it is mirrored
   top to bottom), and for each state the turns that stand it the way it
   faces (rotate() above). The mesher asks cubeLook() once per block and
   state: per face the texture layer and how its picture lies (0-3 quarter
   turns as the shaders turn it, plus 4 when it is mirrored left to right). */
const F_ = (part, rot, flip) => [part, rot || 0, flip ? 1 : 0];
const SIX = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 0]];          // facing north, east, south, west, up, down -> [x, y]
const FACING4 = [[0, 0], [0, 1], [0, 2], [0, 3]];
const LOOKS = {
  // a front on the north, the top turning with it (furnaces, looms, carved pumpkins, bee nests)
  orientable: { faces: [F_('side'), F_('side'), F_('top'), F_('bottom'), F_('side'), F_('front')], turns: m => FACING4[m & 3] },
  // one pattern, each face turned its own way, so four of them laid round a point make the game's rings
  glazed: { faces: [F_('side', 180), F_('side'), F_('side'), F_('side'), F_('side', 270), F_('side', 90)], turns: m => [0, [2, 3, 0, 1][m & 3]] },
  // pistons and command blocks: the sides' pictures point the way the front does
  pointing: { faces: [F_('side', 90), F_('side', 270), F_('side'), F_('side', 180), F_('back'), F_('front')], turns: m => SIX[Math.min(5, m & 7)] },
  observer: { faces: [F_('side'), F_('side'), F_('top', 0, 1), F_('top'), F_('back'), F_('front')], turns: m => SIX[Math.min(5, m & 7)] },
  // barrels and shulker boxes: the top is the end that faces
  ends: { faces: [F_('side'), F_('side'), F_('top'), F_('bottom'), F_('side'), F_('side')], turns: m => [[1, 0], [1, 1], [1, 2], [1, 3], [0, 0], [2, 0]][Math.min(5, m & 7)] },
  // (facing up, the game's crafter also says which way its top points: ours is always to the north)
  crafter: { faces: [F_('side'), F_('west'), F_('top', 180), F_('bottom'), F_('back'), F_('front')], turns: m => [[0, 0], [0, 1], [0, 2], [0, 3], [3, 2], [1, 0]][Math.min(5, m & 7)] },
  // logs and pillars lying down: the ends on the sides; most lying logs are drawn with the top turned half round
  column: { faces: [F_('side'), F_('side'), F_('top'), F_('bottom'), F_('side'), F_('side')], turns: m => [[0, 0], [1, 1], [1, 0]][m % 3] },
  columnFlat: { faces: m => [F_('side'), F_('side'), F_('top', m % 3 ? 180 : 0), F_('bottom'), F_('side'), F_('side')], turns: m => [[0, 0], [1, 1], [1, 0]][m % 3] },
  // bamboo blocks and cherry logs keep their pictures upright and turn only the faces' stripes along the block
  locked: {
    faces: m => (m % 3 === 1 ? [F_('top'), F_('top'), F_('side', 90), F_('side', 90), F_('side', 90), F_('side', 90)]
      : m % 3 === 2 ? [F_('side', 90), F_('side', 90), F_('side'), F_('side'), F_('top'), F_('top')]
        : [F_('side'), F_('side'), F_('top'), F_('bottom'), F_('side'), F_('side')]),
    turns: () => [0, 0],
  },
  // dispensers and droppers: as a furnace on the level, and their own front on the top when they face up or down
  dispenser: {
    faces: m => ((m & 7) >= 4 ? [F_('top'), F_('top'), F_('fv'), F_('top'), F_('top'), F_('top')]
      : [F_('side'), F_('side'), F_('top'), F_('top'), F_('side'), F_('front')]),
    turns: m => ((m & 7) === 5 ? [2, 0] : (m & 7) === 4 ? [0, 0] : FACING4[m & 3]),
  },
};
function lookOf(d) {
  const n = d.name;
  if (d.shape !== 'cube') return null;
  if (/_glazed_terracotta$/.test(n)) return LOOKS.glazed;
  if (d.orient === 'axis') {
    if (/^(stripped_)?(bamboo_block|cherry_log)$/.test(n)) return LOOKS.locked;
    return /(_log|^hay_block|^creaking_heart|^quartz_pillar|^purpur_pillar|_froglight)$/.test(n) ? LOOKS.columnFlat : LOOKS.column;
  }
  if (/^(sticky_)?piston$|command_block$/.test(n)) return LOOKS.pointing;
  if (n === 'observer') return LOOKS.observer;
  if (n === 'dispenser' || n === 'dropper') return LOOKS.dispenser;
  if (n === 'barrel' || /shulker_box$/.test(n)) return LOOKS.ends;
  if (n === 'crafter') return LOOKS.crafter;
  if (d.orient === 'horizontal' && /^(furnace|smoker|blast_furnace|loom|carved_pumpkin|jack_o_lantern|bee_nest|beehive|vault)$/.test(n)) return LOOKS.orientable;
  return null;
}
// the shaders' quarter turns of a face's picture, and a mirror before them: which one lays a rectangle as given
const LIE = [];
for (let c = 0; c < 8; c++) {
  LIE.push((s, t) => {
    if (c & 4) s = 1 - s;
    const r = c & 3;
    return r === 1 ? [1 - t, s] : r === 2 ? [1 - s, 1 - t] : r === 3 ? [t, 1 - s] : [s, t];
  });
}
function lieOf(r) {
  for (let c = 0; c < 8; c++) {
    let ok = true;
    for (const [s, t] of [[0, 0], [1, 0], [0, 1]]) {
      const [a, b] = LIE[c](s, t), [u, v] = texAt(r, s, t);
      if (Math.abs(a * 16 - u) > 1e-3 || Math.abs(b * 16 - v) > 1e-3) { ok = false; break; }
    }
    if (ok) return c;
  }
  return 0;
}
const LOOK_CACHE = new Map();
export function cubeLook(d, m) {
  const key = d.id * 256 + (m & 255);
  let v = LOOK_CACHE.get(key);
  if (v !== undefined) return v;
  v = null;
  const L = lookOf(d);
  if (L) {
    const part = p => {
      const T = d.L || {};
      switch (p) {
        // (an open barrel, meta bit 3, shows its open top)
        case 'top': return (m & 8) && T.topOpen !== undefined ? T.topOpen : T.top !== undefined ? T.top : T.end !== undefined ? T.end : d.faces[2];
        case 'bottom': return T.bottom !== undefined ? T.bottom : T.end !== undefined ? T.end : d.faces[3];
        case 'front': return d.front !== undefined ? d.front : d.faces[0];
        case 'back': return d.back !== undefined ? d.back : d.faces[0];
        case 'fv': return T.fv !== undefined ? T.fv : d.front !== undefined ? d.front : d.faces[2];
        case 'side': return d.faces[0];
        default: return T[p] !== undefined ? T[p] : d.faces[0];
      }
    };
    const spec = typeof L.faces === 'function' ? L.faces(m) : L.faces;
    const [x, y] = L.turns(m);
    const b = { f: [0, 0, 0], t: [16, 16, 16], faces: spec.map(s => part(s[0])),
      uv: spec.map(s => faceUV(s[2] ? [0, 16, 16, 0] : [0, 0, 16, 16], s[1])) };
    const o = rotate([b], x, y)[0];
    v = new Int32Array(12);
    for (let f = 0; f < 6; f++) { v[f * 2] = o.faces[f]; v[f * 2 + 1] = lieOf(o.uv[f]); }
  }
  LOOK_CACHE.set(key, v);
  return v;
}
export function hasCubeLook(d) { return !!lookOf(d); }
// the looks kept above let go, for when the blocks' textures are worked out again (a worker given the page's own list: worker.js prepare)
export function forgetLooks() { LOOK_CACHE.clear(); }

/* ---- blocks with a part that moves ----
   While sim/lids.js draws the moving part (a chest's lid, a shulker box's
   lid, a ringing bell), the mesher draws the rest from the def movingDef
   gives, with 256 added to the meta. With 512 the same shapes give only the
   moving part, built standing as the block does before it is turned to its
   facing (the hinge or pivot is easy to find there). */
const MOVING_DEF = new Map();
export function movingDef(d) {
  if (MOVING_DEF.has(d.id)) return MOVING_DEF.get(d.id);
  let v = null;
  if (d.shape === 'chest' || d.shape === 'bell' || d.shape === 'vase' || d.shape === 'conduit') v = d;
  else if (/shulker_box$/.test(d.name)) v = Object.assign(Object.create(d), { shape: 'shulker' });
  MOVING_DEF.set(d.id, v);
  return v;
}
// a shulker box opening up: the bottom eight pixels stay (their sides the box's lower band, the inside its floor)
// and the lid, twelve pixels from y 4, lifts off; built opening upwards, then turned the way it faces
SHAPES.shulker = function (d, m) {
  const L = d.L || {}, side = d.faces[0], top = L.top !== undefined ? L.top : d.faces[2], bot = L.bottom !== undefined ? L.bottom : d.faces[3];
  const S = [side, side, top, bot, side, side];
  const list = m & 512 ? [box(0, 4, 0, 16, 16, 16, { faces: S, uv: [[0, 0, 16, 12], [0, 0, 16, 12], [0, 0, 16, 16], [0, 0, 16, 16], [0, 0, 16, 12], [0, 0, 16, 12]] })]
    : [box(0, 0, 0, 16, 4, 16, { faces: S, skip: 1 << 2, uv: [[0, 12, 16, 16], [0, 12, 16, 16], null, [0, 0, 16, 16], [0, 12, 16, 16], [0, 12, 16, 16]] }),
      box(0, 4, 0, 16, 8, 16, { faces: [side, side, bot, bot, side, side], skip: 1 << 3, uv: [[0, 12, 16, 16], [0, 12, 16, 16], [0, 0, 16, 16], null, [0, 12, 16, 16], [0, 12, 16, 16]] })];
  if (m & 512) return list;
  const [x, y] = LOOKS.ends.turns(m);
  return rotate(list.map(fixUV), x, y);
};
MODEL_SHAPES.add('shulker');

/* ---- where a plant stands in its block: the game's random offset (BlockBehaviour.Properties.offsetType and
   Mth.getSeed, read from the 26.1.2 jar). XZ: up to a quarter block either way (pointed dripstone an eighth, its
   base's half width), in sixteen steps from the column's seed; XYZ also sinks it up to a fifth of a block. ---- */
export const OFFSET_XZ = ['mangrove_propagule', 'tall_seagrass', 'dandelion', 'golden_dandelion', 'torchflower', 'poppy', 'blue_orchid',
  'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'wither_rose',
  'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'pitcher_plant', 'bamboo_sapling',
  'bamboo', 'warped_roots', 'nether_sprouts', 'crimson_roots', 'pointed_dripstone', 'hanging_roots', 'open_eyeblossom', 'closed_eyeblossom'];
export const OFFSET_XYZ = ['short_grass', 'fern', 'short_dry_grass', 'tall_dry_grass', 'small_dripleaf'];
const MAX_OFFSET = { pointed_dripstone: 0.125 };
// Mth.getSeed(x, y, z), a Java long (BigInt)
export function javaPosSeed(x, y, z) {
  let l = BigInt(Math.imul(x | 0, 3129871)) ^ (BigInt(z | 0) * 116129781n) ^ BigInt(y | 0);
  l = BigInt.asIntN(64, l);
  l = BigInt.asIntN(64, l * l * 42317861n + l * 11n);
  return l >> 16n;
}
// [dx, dy, dz] in blocks for a block with d.offset ('xz' or 'xyz') at x, z (a double tall plant: its lower half's y does not matter)
export function blockOffset(d, x, z) {
  if (!d || !d.offset) return null;
  const s = javaPosSeed(x, 0, z), max = MAX_OFFSET[d.name] ?? 0.25;
  const c = v => Math.max(-max, Math.min(max, v));
  const dx = c((Number(s & 15n) / 15 - 0.5) * 0.5), dz = c((Number((s >> 8n) & 15n) / 15 - 0.5) * 0.5);
  const dy = d.offset === 'xyz' ? (Number((s >> 4n) & 15n) / 15 - 1) * 0.2 : 0;
  return [dx, dy, dz];
}
/* Which of a multipart's weighted models a spot picks: the section's random set to the block's seed, one nextLong
   for the multipart, that set again before the part's own nextInt (MultiPartModel.collectParts, a LegacyRandomSource) */
const LCG_M = 0x5DEECE66Dn, MASK48 = (1n << 48n) - 1n;
export function variantAt(x, y, z, n) {
  let seed = (javaPosSeed(x, y, z) ^ LCG_M) & MASK48;
  const next = bits => { seed = (seed * LCG_M + 0xBn) & MASK48; return Number(BigInt.asIntN(32, seed >> BigInt(48 - bits))); };
  const hi = next(32), lo = next(32);
  const l = BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo));
  seed = (l ^ LCG_M) & MASK48;
  if ((n & (n - 1)) === 0) return Number((BigInt(n) * BigInt(next(31))) >> 31n);
  let bits, val;
  do { bits = next(31); val = bits % n; } while (bits - val + (n - 1) < 0 || bits - val + (n - 1) > 2147483647);
  return val;
}
export const bambooVariant = (x, y, z) => variantAt(x, y, z, 4);

/* Bamboo, as the game's models: a stalk two pixels across (age 0) or three (age 1), in one of four models (each
   takes its sides from its own column of the picture: 0, 3, 6 or 9), its top and bottom from the picture's corner,
   with the small or large leaves as two flat planes 14.4 pixels wide crossing at the middle (bamboo*_age*.json,
   bamboo_small_leaves.json, bamboo_large_leaves.json in the 26.1.2 jar). */
function bambooModel(d, m) {
  const L = d.L || {}, thick = m & 1, leaves = (m >> 4) & 3, v = (m >> 6) & 3, u0 = v * 3;
  const r = [];
  if (thick) {
    const side = [u0, 0, u0 + 3, 16];
    r.push(box(6.5, 0, 6.5, 9.5, 16, 9.5, { uv: [side, side, [13, 0, 16, 3], [13, 4, 16, 7], side, side] }));
  } else {
    const side = [u0, 0, u0 + 2, 16];
    r.push(box(7, 0, 7, 9, 16, 9, { uv: [side, side, [13, 0, 15, 2], [13, 4, 15, 6], side, side] }));
  }
  const leafLayer = leaves === 2 ? L.large : leaves === 1 ? L.small : undefined;
  if (leafLayer !== undefined) {
    r.push({ q: [[0.8, 0, 8], [15.2, 0, 8], [15.2, 16, 8], [0.8, 16, 8]], uv: [0, 0, 16, 16], layer: leafLayer, plain: true });
    r.push({ q: [[8, 0, 15.2], [8, 0, 0.8], [8, 16, 0.8], [8, 16, 15.2]], uv: [0, 0, 16, 16], layer: leafLayer, plain: true });
  }
  return r;
}
SHAPES.bamboo = bambooModel;
MODEL_SHAPES.add('bamboo');

// the boxes (and quads) of a block in a given state; nb(dx, dy, dz) returns { d, m } or null
export function boxesOf(d, m, nb) {
  const fn = SHAPES[d.shape];
  return fn ? fn(d, m | 0, nb || (() => null)) : null;
}

/* ---- what you bump into, and what the crosshair outlines ----
   Boxes as [x0, y0, z0, x1, y1, z1] in blocks, relative to the block. */
const FULL = [[0, 0, 0, 1, 1, 1]];
const CACTUS = [[1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16]];
const toBlocks = list => list.filter(b => !b.q && b.f[1] !== b.t[1]).map(b => [b.f[0] / 16, b.f[1] / 16, b.f[2] / 16, b.t[0] / 16, b.t[1] / 16, b.t[2] / 16]);
const shiftBy = (list, o) => (o && list ? list.map(b => [b[0] + o[0], b[1] + o[1], b[2] + o[2], b[3] + o[0], b[4] + o[1], b[5] + o[2]]) : list);
// x, z (optional): where the block is, for the ones the game moves about in their block (blockOffset)
export function collisionBoxes(d, m, nb, x, z) {
  if (d.offset && x !== undefined) return shiftBy(collisionAt(d, m, nb), blockOffset(d, x, z));
  return collisionAt(d, m, nb);
}
// bamboo: three pixels across whatever its age (BambooStalkBlock COLLISION_SHAPE); outlined six across, ten with large leaves
const BAMBOO_HIT = [[6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16]];
const BAMBOO_SMALL = [[5 / 16, 0, 5 / 16, 11 / 16, 1, 11 / 16]], BAMBOO_LARGE = [[3 / 16, 0, 3 / 16, 13 / 16, 1, 13 / 16]];
function collisionAt(d, m, nb) {
  if (!d.solid) return null;
  const s = d.shape;
  if (s === 'bamboo') return BAMBOO_HIT;
  // a honey block is as narrow as a cactus, and as short
  if (d.name === 'honey_block') return CACTUS;
  if (s === 'cube') return FULL;
  // a cactus is a sixteenth narrower each side and 15/16 tall, so whatever leans on it is in its block (and hurt)
  if (s === 'cactus') return CACTUS;
  if (s === 'gate' && (m & 4)) return null;
  if (!SHAPES[s] || s === 'rail' || s === 'wire' || s === 'vine' || s === 'chain') return s === 'chain' ? [[6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16]] : FULL;
  let b = toBlocks(SHAPES[s](d, m | 0, nb || (() => null)));
  // fences, walls and shut gates are a block and a half tall, so you cannot jump them
  if (s === 'fence' || s === 'wall' || s === 'gate') b = b.map(x => [x[0], 0, x[2], x[3], 1.5, x[5]]);
  return b.length ? b : null;
}
export function selectionBoxes(d, m, nb, x, z) {
  if (d.offset && x !== undefined) return shiftBy(selectionAt(d, m, nb), blockOffset(d, x, z));
  return selectionAt(d, m, nb);
}
function selectionAt(d, m, nb) {
  const s = d.shape;
  if (s === 'bamboo') return ((m >> 4) & 3) === 2 ? BAMBOO_LARGE : BAMBOO_SMALL;
  if (s === 'cube' || s === 'fluid') return FULL;
  if (s === 'cross' || s === 'pad') return d.shape === 'pad' ? [[1 / 16, 0, 1 / 16, 15 / 16, 1.5 / 16, 15 / 16]] : [[2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16]];
  if (s === 'torch') return [[6 / 16, 0, 6 / 16, 10 / 16, 10 / 16, 10 / 16]];
  if (s === 'snow') return [[0, 0, 0, 1, ((m & 7) + 1) / 8, 1]];
  if (s === 'rail' || s === 'wire') return [[0, 0, 0, 1, 2 / 16, 1]];
  if (s === 'crop') return [[0, 0, 0, 1, 0.5, 1]];
  // fire is picked by a sixteenth at its foot, as the game's outline is
  if (s === 'fire') return [[0, 0, 0, 1, 1 / 16, 1]];
  if (!SHAPES[s]) return FULL;
  const list = SHAPES[s](d, m | 0, nb || (() => null));
  const b = toBlocks(list);
  if (b.length) return b;
  // only quads: the box around them, never thinner than a couple of pixels
  let x0 = 16, y0 = 16, z0 = 16, x1 = 0, y1 = 0, z1 = 0;
  for (const p of list) for (const [x, y, z] of p.q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
  const grow = (a, b2) => (b2 - a < 2 ? [Math.max(0, (a + b2) / 2 - 1), Math.min(16, (a + b2) / 2 + 1)] : [Math.max(0, a), Math.min(16, b2)]);
  const [gx0, gx1] = grow(x0, x1), [gy0, gy1] = grow(y0, y1), [gz0, gz1] = grow(z0, z1);
  return [[gx0 / 16, gy0 / 16, gz0 / 16, gx1 / 16, gy1 / 16, gz1 / 16]];
}
