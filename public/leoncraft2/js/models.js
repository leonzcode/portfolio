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
     candle/layer/pickle  bits 0-2 how many, less one
     tall plants, beds    bit 3 the upper half / the head
   Fences, walls, panes, rails and redstone work out their shape from their
   neighbours, as Minecraft does when it draws them.
--------------------------------------------------------------------------- */

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
// turn boxes (and quads) about the block's middle by quarter turns
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
    if (b.uv) o.uv = turnFaces(b.uv, q);
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
  // four planes in a # (crops)
  const uv = [0, 0, 16, 16], r = [];
  for (const p of planes) {
    r.push({ q: [[p, y0, x0], [p, y0, x1], [p, y1, x1], [p, y1, x0]], uv, layer });
    r.push({ q: [[x0, y0, p], [x1, y0, p], [x1, y1, p], [x0, y1, p]], uv, layer });
  }
  return r;
}

/* ---- who joins up with whom ---- */
function full(n) { return n && n.d.shape === 'cube' && n.d.pass === 'opaque'; }
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

/* ---- the families: each takes the block's def, its meta and a neighbour lookup ---- */
export const SHAPES = {
  slab(d, m) {
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
    return top ? flipY(b) : b;
  },
  fence(d, m, nb) {
    const b = [box(6, 0, 6, 10, 16, 10)];
    for (let k = 0; k < 4; k++) {
      if (!joins(d, nb(DIRS[k][0], 0, DIRS[k][2]), 'fence')) continue;
      b.push(...turn([box(7, 12, 0, 9, 15, 6), box(7, 6, 0, 9, 9, 6)], k));
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
    const any = n.some(Boolean);
    // the glass on the broad sides; the thin edges, top and ends show the edge texture, as in the game
    const g = d.faces[0], e = d.L && d.L.top !== undefined ? d.L.top : g;
    const b = [box(7, 0, 7, 9, 16, 9, { faces: [g, g, e, e, g, g] })];
    for (let k = 0; k < 4; k++) if (n[k] || !any) b.push(...turn([box(7, 0, 0, 9, 16, 7, { faces: [g, g, e, e, e, e] })], k));
    return b;
  },
  gate(d, m) {
    const F = m & 3, open = !!(m & 4);
    const b = [box(0, 5, 7, 2, 16, 9), box(14, 5, 7, 16, 16, 9)];
    if (!open) b.push(box(6, 6, 7, 10, 15, 9), box(2, 6, 7, 6, 9, 9), box(2, 12, 7, 6, 15, 9), box(10, 6, 7, 14, 9, 9), box(10, 12, 7, 14, 15, 9));
    else b.push(box(0, 6, 1, 2, 15, 3), box(14, 6, 1, 16, 15, 3), box(0, 6, 3, 2, 9, 7), box(0, 12, 3, 2, 15, 7), box(14, 6, 3, 16, 9, 7), box(14, 12, 3, 16, 15, 7));
    return turn(b, F);
  },
  door(d, m) {
    const F = m & 3, open = !!(m & 4), upper = !!(m & 8), right = !!(m & 16);
    const faces = upper && d.facesUpper ? d.facesUpper : d.faces;
    // shut, it fills the near side; open, it swings back against the hinge
    const b = !open ? box(0, 0, 13, 16, 16, 16, { faces }) : right ? box(13, 0, 0, 16, 16, 16, { faces }) : box(0, 0, 0, 3, 16, 16, { faces });
    return turn([b], F);
  },
  trapdoor(d, m) {
    const F = m & 3, open = !!(m & 4), top = !!(m & 8);
    if (open) return turn([box(0, 0, 13, 16, 16, 16)], F);
    return [top ? box(0, 13, 0, 16, 16, 16) : box(0, 0, 0, 16, 3, 16)];
  },
  thin(d) { return [box(0, 0, 0, 16, d.h || 1, 16)]; },
  plate(d) { return [box(1, 0, 1, 15, 1, 15)]; },
  button(d, m) {
    const f = m & 7;
    if (f === 3) return [box(5, 0, 6, 11, 2, 10)];
    if (f === 2) return [box(5, 14, 6, 11, 16, 10)];
    return turn([box(5, 6, 0, 11, 10, 2)], sideFacing(f) || 0);
  },
  ladder(d, m) { return turn([box(0, 0, 0, 16, 16, 0.8, { skip: 1 << 5 })], sideFacing(m & 7) || 0); },
  lantern(d, m) {
    const h = m & 1 ? 1 : 0, L = d.faces[0];
    const side = [0, 2, 6, 9], cap = [1, 10, 5, 12];
    const uv = (s, t) => [s, s, t, t, s, s];
    const r = [
      box(5, h, 5, 11, 7 + h, 11, { uv: uv(side, [0, 9, 6, 15]) }),
      box(6, 7 + h, 6, 10, 9 + h, 10, { uv: uv(cap, [1, 10, 5, 14]) }),
    ];
    if (h) r.push(...crossed(6.5, 9 + h, 8, 9.5, 16, 8, L, [11, 1, 14, 6]).slice(0, 1), ...crossed(8, 9 + h, 6.5, 8, 16, 9.5, L, [11, 6, 14, 11]).slice(0, 1));
    else r.push({ q: [[6.5, 9, 8], [9.5, 9, 8], [9.5, 11, 8], [6.5, 11, 8]], uv: [11, 1, 14, 3], layer: L });
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
    const b = [box(7, 0, 7, 9, 15, 9, { uv: [[0, 0, 2, 15], [0, 0, 2, 15], [2, 0, 4, 2], [2, 0, 4, 2], [0, 0, 2, 15], [0, 0, 2, 15]] }),
      box(6, 15, 6, 10, 16, 10, { uv: [[2, 2, 6, 3], [2, 2, 6, 3], [2, 2, 6, 6], [2, 2, 6, 6], [2, 2, 6, 3], [2, 2, 6, 3]] })];
    const f = m & 7;
    if (f === 4) return b;
    if (f === 5) return flipY(b);
    // lying down, the tip pointing the way it faces (stood against the opposite side)
    return hang(b, FACING_FACE[((f & 3) + 2) & 3]);
  },
  candle(d, m) {
    const n = (m & 3) + 1, L = d.faces[0];
    const at = [[[8, 8]], [[6, 8], [10, 8]], [[6, 7], [10, 7], [8, 10]], [[6, 6], [10, 6], [6, 10], [10, 10]]][n - 1];
    const r = [];
    for (const [cx, cz] of at) {
      r.push(box(cx - 1, 0, cz - 1, cx + 1, 6, cz + 1, { uv: [[0, 8, 2, 14], [0, 8, 2, 14], [0, 6, 2, 8], [0, 6, 2, 8], [0, 8, 2, 14], [0, 8, 2, 14]] }));
      r.push({ q: [[cx - 0.5, 6, cz], [cx + 0.5, 6, cz], [cx + 0.5, 7, cz], [cx - 0.5, 7, cz]], uv: [0, 5, 1, 6], layer: L });
    }
    return r;
  },
  pot(d) {
    const r = [box(5, 0, 5, 11, 6, 11, d.L && d.L.inside !== undefined ? { faces: [d.faces[0], d.faces[1], d.L.inside, d.faces[3], d.faces[4], d.faces[5]] } : null)];
    // the plant growing in it
    if (d.L && d.L.plant !== undefined) {
      if (d.plantShape === 'cube') r.push(box(6, 6, 6, 10, 16, 10, { faces: [d.L.plant, d.L.plant, d.L.plant, d.L.plant, d.L.plant, d.L.plant] }));
      else r.push(...crossed(4.4, 4, 4.4, 11.6, 16, 11.6, d.L.plant));
    }
    return r;
  },
  cake(d) { return [box(1, 0, 1, 15, 8, 15)]; },
  chest(d, m) {
    const fc = d.faces.slice();
    if (d.front !== undefined) fc[5] = d.front;
    const latch = d.L && d.L.latch !== undefined ? d.L.latch : fc[5];
    return turn([box(1, 0, 1, 15, 14, 15, { faces: fc }), box(7, 7, 0, 9, 11, 1, { faces: [latch, latch, latch, latch, latch, latch] })], m & 3);
  },
  bed(d, m) {
    // two blocks, the head the way it faces; built facing north, so the head's far end is its north side
    const head = !!(m & 8), L = d.L || {};
    const pick = (a, b) => (a !== undefined ? a : b);
    const tf = head ? pick(L.top, d.faces[2]) : pick(L.footTop, d.faces[2]);
    const sf = head ? pick(L.side, d.faces[0]) : pick(L.footSide, d.faces[0]);
    const ef = head ? pick(L.end, sf) : pick(L.footEnd, sf);
    const faces = head ? [sf, sf, tf, d.faces[3], sf, ef] : [sf, sf, tf, d.faces[3], ef, sf];
    const mat = box(0, 3, 0, 16, 9, 16, { faces, skip: head ? 1 << 4 : 1 << 5 });
    const legs = head ? [box(0, 0, 0, 3, 3, 3), box(13, 0, 0, 16, 3, 3)] : [box(0, 0, 13, 3, 3, 16), box(13, 0, 13, 16, 3, 16)];
    return turn([mat, ...legs.map(l => Object.assign(l, { faces: [sf, sf, sf, sf, sf, sf] }))], m & 3);
  },
  head(d, m) {
    const L = d.L || {};
    const fr = L.front !== undefined ? L.front : d.faces[0], bk = L.back !== undefined ? L.back : d.faces[0];
    // on a wall: the back against it, looking out
    if (d.wall || (m & 8)) return turn([box(4, 4, 0, 12, 12, 8, { faces: [d.faces[0], d.faces[1], d.faces[2], d.faces[3], fr, bk] })], sideFacing(m & 7) || 0);
    return turn([box(4, 0, 4, 12, 8, 12, { faces: [d.faces[0], d.faces[1], d.faces[2], d.faces[3], bk, fr] })], m & 3);
  },
  anvil(d, m) {
    return turn([box(2, 0, 2, 14, 4, 14), box(4, 4, 3, 12, 5, 13), box(6, 5, 4, 10, 10, 12), box(3, 10, 0, 13, 16, 16)], (m & 3) + 1);
  },
  cactus() { return [box(1, 0, 1, 15, 16, 15)]; },
  layer(d, m) { return [box(0, 0, 0, 16, 2 * ((m & 7) + 1), 16)]; },
  crop(d) { return hash([4, 12], d.faces[2], 0, 16, -1, 15); },
  sign(d, m) {
    // hanging signs hang under a block; banners are a flag on a pole
    if (d.hanging) return turn([box(1, 0, 7, 15, 10, 9)], m & 3);
    if (d.banner) return turn([box(7.5, 0, 7.5, 8.5, 16, 8.5), box(2, 1, 7, 14, 16, 7.75)], m & 3);
    return turn([box(0, 8, 7.25, 16, 16, 8.75), box(7.25, 0, 7.25, 8.75, 8, 8.75)], m & 3);
  },
  wall_sign(d, m) {
    if (d.banner) return turn([box(2, 0, 0, 14, 15, 1)], sideFacing(m & 7) || 0);
    if (d.hanging) return turn([box(1, 0, 7, 15, 10, 9), box(0, 14, 0, 16, 16, 16)], sideFacing(m & 7) || 0);
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
    const q = { q: [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], uv, layer: line, up: true };
    if (!vertical) q.q = [[x0, y, z1], [x0, y, z0], [x1, y, z0], [x1, y, z1]];
    r.push(q);
  });
  return r;
};
SHAPES.vine = function (d, m, nb) {
  // on every side with something solid to hold on to, and under a solid block
  const r = [], L = d.faces[2], e = 0.8;
  const solid = n => n && n.d.solid && n.d.shape === 'cube';
  if (solid(nb(0, 0, -1))) r.push({ q: [[16, 0, e], [0, 0, e], [0, 16, e], [16, 16, e]], uv: FLAT_UV, layer: L });
  if (solid(nb(0, 0, 1))) r.push({ q: [[0, 0, 16 - e], [16, 0, 16 - e], [16, 16, 16 - e], [0, 16, 16 - e]], uv: FLAT_UV, layer: L });
  if (solid(nb(1, 0, 0))) r.push({ q: [[16 - e, 0, 16], [16 - e, 0, 0], [16 - e, 16, 0], [16 - e, 16, 16]], uv: FLAT_UV, layer: L });
  if (solid(nb(-1, 0, 0))) r.push({ q: [[e, 0, 0], [e, 0, 16], [e, 16, 16], [e, 16, 0]], uv: FLAT_UV, layer: L });
  if (!r.length || solid(nb(0, 1, 0))) r.push({ q: [[0, 16 - e, 16], [16, 16 - e, 16], [16, 16 - e, 0], [0, 16 - e, 0]], uv: FLAT_UV, layer: L });
  return r;
};

export const MODEL_SHAPES = new Set(Object.keys(SHAPES));

// the boxes (and quads) of a block in a given state; nb(dx, dy, dz) returns { d, m } or null
export function boxesOf(d, m, nb) {
  const fn = SHAPES[d.shape];
  return fn ? fn(d, m | 0, nb || (() => null)) : null;
}

/* ---- what you bump into, and what the crosshair outlines ----
   Boxes as [x0, y0, z0, x1, y1, z1] in blocks, relative to the block. */
const FULL = [[0, 0, 0, 1, 1, 1]];
const toBlocks = list => list.filter(b => !b.q).map(b => [b.f[0] / 16, b.f[1] / 16, b.f[2] / 16, b.t[0] / 16, b.t[1] / 16, b.t[2] / 16]);
export function collisionBoxes(d, m, nb) {
  if (!d.solid) return null;
  const s = d.shape;
  if (s === 'cube' || s === 'cactus') return FULL;
  if (s === 'gate' && (m & 4)) return null;
  if (!SHAPES[s] || s === 'rail' || s === 'wire' || s === 'vine' || s === 'chain') return s === 'chain' ? [[6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16]] : FULL;
  let b = toBlocks(SHAPES[s](d, m | 0, nb || (() => null)));
  // fences, walls and shut gates are a block and a half tall, so you cannot jump them
  if (s === 'fence' || s === 'wall' || s === 'gate') b = b.map(x => [x[0], 0, x[2], x[3], 1.5, x[5]]);
  return b.length ? b : null;
}
export function selectionBoxes(d, m, nb) {
  const s = d.shape;
  if (s === 'cube' || s === 'fluid') return FULL;
  if (s === 'cross' || s === 'pad') return d.shape === 'pad' ? [[1 / 16, 0, 1 / 16, 15 / 16, 1.5 / 16, 15 / 16]] : [[2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16]];
  if (s === 'torch') return [[6 / 16, 0, 6 / 16, 10 / 16, 10 / 16, 10 / 16]];
  if (s === 'snow') return [[0, 0, 0, 1, (d.height || 0.125), 1]];
  if (s === 'rail' || s === 'wire') return [[0, 0, 0, 1, 2 / 16, 1]];
  if (s === 'crop') return [[0, 0, 0, 1, 0.5, 1]];
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
