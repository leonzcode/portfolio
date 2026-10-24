/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the woodland mansion.

   Our own mansion, laid out the way the game lays out its own: on a grid of
   8 x 8 cells (walls on the grid lines, a 7 x 7 room inside each cell), up
   to three storeys of 7 blocks, each storey a little smaller than the one
   under it. Two corridors run the length of every floor, rooms of one or
   two cells open off them, and a straight grand staircase in the middle
   climbs from the entrance hall to the top floor with a landing on each.

   Outside it is the dark forest house everyone knows: a cobblestone plinth
   on a foundation that runs down to the ground, dark oak plank walls framed
   by dark oak logs (pillars at every cell corner, a beam along each floor),
   pairs of tall glass pane windows on birch sills, and a low roof of dark
   oak stairs with a wide flat top, the upper floors rising out of the
   roofs of the lower ones. A double door on a short flight of cobblestone
   steps is the way in.

   Rooms are bedrooms, libraries, dining rooms, storerooms and flower rooms,
   plus one each of the odd ones: the allay jail, the obsidian room with its
   lava pool, a chess room and a doorless secret room with a diamond block.
   Vindicators guard the rooms and corridors and every floor has an evoker.

   The plan picks every random thing (the shape of each floor, the rooms,
   their colours, the mobs) and passes it to the boxes, which are 16 x 16
   tiles of the house. Each tile replays the whole drawing through a pen
   that keeps only its own columns, so every tile (and every chunk) agrees.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { rng, door, DX, DZ } from './util.js?v=107';

export const PLANS = {};

const NX = 9, NZ = 6, MID = 4, STOREY = 7, LEVELS = 3, M = 3, TILE = 16;
const GX = 8 * NX + 1, GZ = 8 * NZ + 1;     // the grid in blocks, outer walls included
const LX = GX + 2 * M, LZ = GZ + 2 * M;     // plus a margin for the eaves and the front steps
const H = 1 + STOREY * LEVELS + 2;           // foundation layer to the top of the roof
const yF = L => 1 + STOREY * L;              // a storey's floor, in the box (0 is the foundation)

// what a cell is
const NONE = 0, CORR = 1, HALL = 2, STAIR = 3, ROOM = 4;
// what a wall line between two cells is
const E_NONE = 0, E_EXT = 1, E_WALL = 2, E_DOOR_N = 3, E_OPEN = 4, E_DOOR_S = 5;

const CARPETS = ['white', 'light_gray', 'red', 'blue', 'brown', 'gray', 'cyan', 'purple'];
const BEDS = ['white', 'red', 'light_gray', 'blue', 'brown', 'cyan'];
const POTS = ['potted_red_tulip', 'potted_dandelion', 'potted_poppy', 'potted_dark_oak_sapling', 'potted_allium',
  'potted_azure_bluet', 'potted_white_tulip', 'potted_fern', 'potted_blue_orchid', 'potted_oxeye_daisy'];
const FLOORS = {
  bedroom: 'birch_planks', library: 'dark_oak_planks', dining: 'oak_planks', storage: 'spruce_planks', flower: 'birch_planks',
  jail: 'cobblestone', lava: 'obsidian', secret: 'dark_oak_planks', chess: 'oak_planks',
};
const TYPES = ['bedroom', 'bedroom', 'bedroom', 'bedroom', 'bedroom', 'library', 'library', 'dining', 'dining', 'storage', 'storage', 'flower'];
const SPECIAL = ['jail', 'lava', 'secret', 'chess', 'library'];

/* ------------------------------------------------------------- the plan -- */
PLANS.mansion = ctx => {
  const r = ctx.r, p = ctx.point, rot = (p.rot || 0) & 3;
  const ci = (i, j) => j * NX + i;

  // floor shapes: the ground floor loses a bite at some corners, the first
  // floor a little more, and the top floor is a block over the middle
  const cut0 = [r.nextInt(3), r.nextInt(3), r.nextInt(3), r.nextInt(3)];
  const cut1 = cut0.map(c => Math.min(3, c + r.nextInt(2)));
  const lo = 1 + r.nextInt(2), hi = NX - 2 - r.nextInt(2);
  const occ = [[], [], []];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const row = j === 0 ? 0 : j === NZ - 1 ? 2 : -1;
    const bitten = c => row >= 0 && (i < c[row] || i >= NX - c[row + 1]);
    occ[0][ci(i, j)] = bitten(cut0) ? 0 : 1;
    occ[1][ci(i, j)] = bitten(cut1) ? 0 : 1;
    occ[2][ci(i, j)] = j >= 1 && j <= NZ - 2 && i >= lo && i <= hi ? 1 : 0;
  }
  const kind = occ.map((o, L) => o.map((v, c) => {
    if (!v) return NONE;
    const i = c % NX, j = (c / NX) | 0;
    if (j === 1 || j === NZ - 2) return CORR;
    if (i === MID && (j === 2 || j === 3)) return STAIR;
    if (L === 0 && i === MID && j === 0) return HALL;
    return ROOM;
  }));

  // rooms: runs of room cells along each room row, cut into rooms of one or two cells
  const rooms = [];
  const roomOf = occ.map(o => o.map(() => -1));
  for (let L = 0; L < LEVELS; L++) for (const j of [0, 2, 3, NZ - 1]) {
    for (let i = 0; i < NX;) {
      if (kind[L][ci(i, j)] !== ROOM) { i++; continue; }
      const n = i + 1 < NX && kind[L][ci(i + 1, j)] === ROOM && r.nextFloat() < 0.45 ? 2 : 1;
      const rm = {
        L, i, j, n, south: j === 0 || j === NZ - 3, dc: n === 2 ? r.nextInt(2) : 0,
        type: TYPES[r.nextInt(TYPES.length)], seed: r.nextInt(),
        carpet: CARPETS[r.nextInt(CARPETS.length)] + '_carpet', bed: BEDS[r.nextInt(BEDS.length)] + '_bed',
        pot: POTS[r.nextInt(POTS.length)], chest: 0, mobs: [],
      };
      for (let k = 0; k < n; k++) roomOf[L][ci(i + k, j)] = rooms.length;
      rooms.push(rm);
      i += n;
    }
  }
  // one of each odd room, on distinct rooms
  const taken = new Set();
  for (const t of SPECIAL) {
    for (let tries = 0; tries < 20; tries++) {
      const k = r.nextInt(rooms.length);
      if (taken.has(k)) continue;
      taken.add(k); rooms[k].type = t; break;
    }
  }
  for (const rm of rooms) {
    rm.floor = FLOORS[rm.type];
    if (rm.type === 'bedroom') rm.chest = r.nextFloat() < 0.4 ? rm.n : 0;
    else if (rm.type === 'storage') rm.chest = 1 + r.nextInt(2);
    else if (rm.type === 'secret') rm.chest = 1;
    if (rm.type !== 'secret' && r.nextFloat() < 0.25) rm.mobs.push('vindicator');
  }
  // an evoker on every floor, and vindicators walking the corridors
  const guards = [];
  for (let L = 0; L < LEVELS; L++) {
    const on = rooms.filter(rm => rm.L === L && rm.type !== 'secret' && rm.type !== 'jail');
    if (on.length) on[r.nextInt(on.length)].mobs.push('evoker');
    const corr = [];
    kind[L].forEach((k, c) => { if (k === CORR) corr.push(c); });
    for (let n = 0; n < 2 && corr.length; n++) {
      const c = corr[r.nextInt(corr.length)];
      guards.push({ L, x: 8 * (c % NX) + 2 + r.nextInt(5), z: 8 * ((c / NX) | 0) + 4 });
    }
  }

  // the wall lines: vE[L][j * (NX + 1) + i] is the line x = 8i beside cell (i, j),
  // hE[L][j * NX + i] the line z = 8j above it
  const ek = (L, ca, cb) => {
    const ka = ca < 0 ? NONE : kind[L][ca], kb = cb < 0 ? NONE : kind[L][cb];
    if (!ka && !kb) return E_NONE;
    if (!ka || !kb) return E_EXT;
    if (ka === ROOM && kb === ROOM) return roomOf[L][ca] === roomOf[L][cb] ? E_OPEN : E_WALL;
    if (ka === ROOM || kb === ROOM) {
      const [rc, oc, ko] = ka === ROOM ? [ca, cb, kb] : [cb, ca, ka];
      const rm = rooms[roomOf[L][rc]];
      if (ko !== CORR || rm.type === 'secret') return E_WALL;
      const dcell = ci(rm.i + rm.dc, rm.j), ccell = ci(rm.i + rm.dc, rm.south ? rm.j + 1 : rm.j - 1);
      if (rc !== dcell || oc !== ccell) return E_WALL;
      return rm.south ? E_DOOR_S : E_DOOR_N;
    }
    if ((ka === HALL && kb !== CORR) || (kb === HALL && ka !== CORR)) return E_WALL;
    return E_OPEN;
  };
  const vE = [], hE = [];
  for (let L = 0; L < LEVELS; L++) {
    const v = [], h = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i <= NX; i++) v.push(ek(L, i > 0 ? ci(i - 1, j) : -1, i < NX ? ci(i, j) : -1));
    for (let j = 0; j <= NZ; j++) for (let i = 0; i < NX; i++) h.push(ek(L, j > 0 ? ci(i, j - 1) : -1, j < NZ ? ci(i, j) : -1));
    vE.push(v); hE.push(h);
  }

  // the boxes: 16 x 16 tiles of the house's frame, all turned with it
  const y0 = p.y + 1;
  const [W, D] = rot & 1 ? [LZ, LX] : [LX, LZ];
  const WX0 = p.x - (W >> 1), WZ0 = p.z - (D >> 1);
  const map = (lx, lz) => {
    switch (rot) {
      case 1: return [WX0 + LZ - 1 - lz, WZ0 + lx];
      case 2: return [WX0 + LX - 1 - lx, WZ0 + LZ - 1 - lz];
      case 3: return [WX0 + lz, WZ0 + LX - 1 - lx];
      default: return [WX0 + lx, WZ0 + lz];
    }
  };
  const m = { occ, kind, roomOf, rooms, vE, hE, guards };
  const out = [];
  for (let tz = 0; tz < LZ; tz += TILE) for (let tx = 0; tx < LX; tx += TILE) {
    const tw = Math.min(TILE, LX - tx), td = Math.min(TILE, LZ - tz);
    const a = map(tx, tz), b = map(tx + tw - 1, tz + td - 1);
    out.push(new Build('mansion', Math.min(a[0], b[0]), y0, Math.min(a[1], b[1]), tw, H, td, rot, drawTile, { t: [tx, tz, tw, td], m }));
  }
  return out;
};

/* ------------------------------------------------------------ the pens -- */
// a pen in the house's grid frame (x 0..GX-1, z 0..GZ-1) that only writes the tile's columns
function clipPen(g, t) {
  const ox = t[0] - M, oz = t[1] - M;
  const x0 = ox, z0 = oz, x1 = ox + t[2] - 1, z1 = oz + t[3] - 1;
  const ins = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  return {
    x0, z0, x1, z1,
    touches: (ax, az, bx, bz) => Math.min(ax, bx) <= x1 && Math.max(ax, bx) >= x0 && Math.min(az, bz) <= z1 && Math.max(az, bz) >= z0,
    set(x, y, z, n, s) { if (ins(x, z)) g.set(x - ox, y, z - oz, n, s); },
    fill(ax, ay, az, bx, by, bz, n, s) {
      const X0 = Math.max(Math.min(ax, bx), x0), X1 = Math.min(Math.max(ax, bx), x1);
      const Z0 = Math.max(Math.min(az, bz), z0), Z1 = Math.min(Math.max(az, bz), z1);
      if (X0 <= X1 && Z0 <= Z1) g.fill(X0 - ox, ay, Z0 - oz, X1 - ox, by, Z1 - oz, n, s);
    },
    down(x, y, z, n) { if (ins(x, z)) g.down(x - ox, y, z - oz, n); },
    chest(x, y, z, table, f) { if (ins(x, z)) g.chest(x - ox, y, z - oz, table, f); },
    entity(type, x, y, z, data) { if (ins(x, z)) g.entity(type, x - ox, y, z - oz, data); },
  };
}

/* A room's own frame: a along the room (0..A-1), b in from the wall with
   the door (0..6), y up from the floor. NORTH in it is away from the door
   and SOUTH towards it, whichever side of the room the door is on. */
function roomPen(g, rm, y0) {
  const x0 = 8 * rm.i + 1, zA = 8 * rm.j + 1, zB = 8 * rm.j + 7, S = rm.south;
  const X = a => x0 + a, Z = b => S ? zB - b : zA + b;
  const F = f => S || f === EAST || f === WEST ? f : (f + 2) & 3;
  const st = s => s && typeof s === 'object' && s.f !== undefined ? Object.assign({}, s, { f: F(s.f) }) : s;
  return {
    A: 8 * rm.n - 1, da: 8 * rm.dc + 3,
    set: (a, y, b, n, s) => g.set(X(a), y0 + y, Z(b), n, st(s)),
    fill: (a0, ya, b0, a1, yb, b1, n, s) => g.fill(X(a0), y0 + ya, Z(b0), X(a1), y0 + yb, Z(b1), n, st(s)),
    chest: (a, y, b, f) => g.chest(X(a), y0 + y, Z(b), 'woodland_mansion', F(f)),
    entity: (t, a, y, b) => g.entity(t, X(a), y0 + y, Z(b)),
  };
}

/* ------------------------------------------------------------ the rooms -- */
const FURNISH = {
  bedroom(p, rm) {
    for (let c = 0; c < rm.n; c++) {
      const a = 8 * c;
      p.fill(a + 1, 1, 1, a + 5, 1, 4, rm.carpet);
      p.set(a + 1, 1, 5, rm.bed, { f: NORTH });
      p.set(a + 1, 1, 6, rm.bed, { f: NORTH, head: true });
      p.set(a, 1, 6, 'bookshelf');
      p.set(a + 2, 1, 6, 'dark_oak_slab', { slab: 1 });
      p.set(a + 2, 2, 6, rm.pot);
      p.set(a + 6, 1, 6, 'crafting_table');
    }
    for (let c = 0; c < rm.chest; c++) p.chest(8 * c + 5, 1, 6, SOUTH);
  },
  library(p, rm) {
    const A = p.A;
    p.fill(1, 1, 0, A - 2, 1, 5, rm.carpet);
    p.fill(0, 1, 6, A - 1, 3, 6, 'bookshelf');
    p.fill(0, 1, 1, 0, 3, 5, 'bookshelf');
    p.fill(A - 1, 1, 1, A - 1, 3, 5, 'bookshelf');
    for (let c = 0; c < rm.n; c++) {
      const a = 8 * c + 3;
      p.fill(a - 1, 1, 3, a + 1, 1, 3, 'dark_oak_slab', { slab: 1 });
      p.set(a, 2, 3, rm.pot);
      p.set(a, 1, 4, 'dark_oak_stairs', { f: NORTH });
      p.set(a, 1, 5, 'lectern', { f: SOUTH });
    }
    if (rm.n === 2) p.fill(7, 1, 1, 7, 2, 4, 'bookshelf');
  },
  dining(p, rm) {
    const A = p.A;
    p.fill(0, 1, 1, A - 1, 1, 5, rm.carpet);
    p.fill(1, 1, 3, A - 2, 1, 3, 'dark_oak_slab', { slab: 1 });
    for (let a = 1; a <= A - 2; a += 2) {
      p.set(a, 1, 2, 'dark_oak_stairs', { f: SOUTH });
      p.set(a, 1, 4, 'dark_oak_stairs', { f: NORTH });
    }
    p.set(A >> 1, 2, 3, 'cake');
    p.set(1, 2, 3, rm.pot);
    p.set(A - 2, 2, 3, rm.pot);
    p.set(0, 1, 6, 'furnace', { f: SOUTH });
    p.set(A - 1, 1, 6, 'barrel');
  },
  storage(p, rm, rr) {
    const A = p.A;
    p.fill(2, 1, 6, A - 3, 1, 6, 'barrel');
    for (let a = 2; a <= A - 3; a++) if (rr.nextFloat() < 0.5) p.set(a, 2, 6, 'barrel');
    p.set(0, 1, 3, 'crafting_table');
    p.fill(A - 1, 1, 1, A - 1, 2, 1, 'hay_block');
    for (const [a, b] of [[0, 0], [A - 1, 0], [0, 6], [A - 1, 6]]) for (let y = 5; y <= 6; y++) if (rr.nextFloat() < 0.6) p.set(a, y, b, 'cobweb');
    p.chest(1, 1, 6, SOUTH);
    if (rm.chest > 1) p.chest(A - 2, 1, 6, SOUTH);
  },
  flower(p, rm, rr) {
    const A = p.A, c = A >> 1;
    p.fill(1, 1, 0, A - 2, 1, 5, 'moss_carpet');
    for (let a = 0; a < A; a++) { p.set(a, 1, 6, 'birch_slab', { slab: 1 }); p.set(a, 2, 6, POTS[rr.nextInt(POTS.length)]); }
    for (let b = 1; b <= 5; b++) for (const a of [0, A - 1]) { p.set(a, 1, b, 'birch_slab', { slab: 1 }); p.set(a, 2, b, POTS[rr.nextInt(POTS.length)]); }
    p.set(c, 1, 3, 'moss_block');
    p.set(c, 2, 3, 'flowering_azalea');
  },
  jail(p, rm, rr) {
    for (let c = 0; c < rm.n; c++) {
      const a = 8 * c;
      p.fill(a, 1, 4, a + 6, 6, 4, 'iron_bars');
      p.fill(a + 3, 1, 5, a + 3, 6, 6, 'iron_bars');
      p.set(a + 2, 6, 6, 'cobweb');
      p.entity('allay', a + 1, 1, 5);
      if (rr.nextFloat() < 0.5) p.entity('allay', a + 5, 1, 5);
    }
  },
  lava(p) {
    const A = p.A, c = A >> 1;
    p.fill(0, 1, 6, A - 1, 6, 6, 'obsidian');
    p.fill(0, 1, 1, 0, 6, 5, 'obsidian');
    p.fill(A - 1, 1, 1, A - 1, 6, 5, 'obsidian');
    p.fill(c - 2, 1, 1, c + 2, 1, 5, 'obsidian');
    p.fill(c - 1, 1, 2, c + 1, 1, 4, 'lava');
  },
  secret(p, rm, rr) {
    const A = p.A, c = A >> 1;
    for (let y = 1; y <= 6; y++) for (let a = 0; a < A; a++) for (let b = 0; b < 7; b++) if (rr.nextFloat() < 0.18) p.set(a, y, b, 'cobweb');
    p.set(c, 1, 3, 'dark_oak_log');
    p.set(c, 2, 3, 'diamond_block');
    p.chest(c, 1, 6, SOUTH);
  },
  chess(p, rm, rr) {
    const A = p.A;
    for (let a = 0; a < A; a++) for (let b = 0; b < 7; b++) p.set(a, 1, b, (a + b) & 1 ? 'black_carpet' : 'white_carpet');
    for (let a = 0; a < A; a++) {
      if (rr.nextFloat() < 0.5 && Math.abs(a - p.da) > 1) p.set(a, 1, 1, 'white_wool');
      if (rr.nextFloat() < 0.5) p.set(a, 1, 5, 'black_wool');
    }
  },
};

/* ------------------------------------------------------------- drawing -- */
function drawTile(g, o) { drawMansion(clipPen(g, o.t), o.m); }

function drawMansion(g, m) {
  const { occ, kind, roomOf, rooms, vE, hE, guards } = m;
  const ci = (i, j) => j * NX + i;
  const has = (L, i, j) => i >= 0 && i < NX && j >= 0 && j < NZ && occ[L][ci(i, j)] === 1;
  // is block column (x, z) part of a cell of storey L, its walls included
  const inF = (L, x, z) => {
    const i = x >> 3, j = z >> 3, ex = (x & 7) === 0, ez = (z & 7) === 0;
    return has(L, i, j) || (ex && has(L, i - 1, j)) || (ez && has(L, i, j - 1)) || (ex && ez && has(L, i - 1, j - 1));
  };
  const top = (x, z) => inF(2, x, z) ? 2 : inF(1, x, z) ? 1 : inF(0, x, z) ? 0 : -1;
  const floorOf = (L, c) => kind[L][c] === ROOM ? rooms[roomOf[L][c]].floor : 'birch_planks';
  const cx0 = Math.max(-1, g.x0), cx1 = Math.min(GX, g.x1), cz0 = Math.max(-1, g.z0), cz1 = Math.min(GZ, g.z1);

  // the foundation: a cobblestone layer under the whole ground floor, down to the ground
  for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) if (inF(0, x, z)) {
    g.set(x, 0, z, 'cobblestone');
    g.down(x, -1, z, 'cobblestone');
  }

  for (let L = 0; L < LEVELS; L++) {
    const y = yF(L);
    // rooms cleared and floored
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const c = ci(i, j);
      if (!kind[L][c] || !g.touches(8 * i, 8 * j, 8 * i + 8, 8 * j + 8)) continue;
      g.fill(8 * i + 1, y + 1, 8 * j + 1, 8 * i + 7, y + 6, 8 * j + 7, 'air');
      g.fill(8 * i + 1, y, 8 * j + 1, 8 * i + 7, y, 8 * j + 7, floorOf(L, c));
    }
    // wall lines
    const edge = (horiz, i, j, e, ca) => {
      const P = k => horiz ? [8 * i + k, 8 * j] : [8 * i, 8 * j + k];
      const [ax, az] = P(1), [bx, bz] = P(7);
      if (!g.touches(ax, az, bx, bz)) return;
      if (e === E_EXT) {
        g.fill(ax, y, az, bx, y, bz, L ? 'dark_oak_log' : 'cobblestone', L ? { axis: horiz ? 'x' : 'z' } : 0);
        g.fill(ax, y + 1, az, bx, y + 6, bz, 'dark_oak_planks');
        if (L === 0 && horiz && j === 0 && i === MID) {
          // the front door: a pair of dark oak doors in a log frame
          for (const k of [2, 5]) { const [x, z] = P(k); g.fill(x, y + 1, z, x, y + 4, z, 'dark_oak_log'); }
          const [x3, z3] = P(3), [x4, z4] = P(4);
          door(g, x3, y + 1, z3, 'dark_oak_door', NORTH, false);
          door(g, x4, y + 1, z4, 'dark_oak_door', NORTH, true);
          g.fill(x3, y + 3, z3, x4, y + 3, z4, 'birch_planks');
        } else for (const k of [2, 3, 5, 6]) {
          const [x, z] = P(k);
          g.set(x, y + 1, z, 'birch_planks');
          g.fill(x, y + 2, z, x, y + 4, z, 'glass_pane');
        }
      } else if (e === E_OPEN) {
        g.fill(ax, y, az, bx, y, bz, floorOf(L, ca));
        g.fill(ax, y + 1, az, bx, y + 6, bz, 'air');
        const k1 = kind[L][ca];
        if (k1 === CORR || k1 === ROOM) g.fill(ax, y + 6, az, bx, y + 6, bz, 'dark_oak_log', { axis: horiz ? 'x' : 'z' });
        if (k1 === CORR && !horiz) g.fill(ax, y + 1, 8 * j + 3, ax, y + 1, 8 * j + 5, 'light_gray_carpet');
      } else {
        g.fill(ax, y, az, bx, y + 6, bz, 'dark_oak_planks');
        if (e === E_DOOR_N || e === E_DOOR_S) {
          const [x, z] = P(4);
          door(g, x, y + 1, z, 'dark_oak_door', e === E_DOOR_S ? SOUTH : NORTH, false);
        }
      }
    };
    for (let j = 0; j < NZ; j++) for (let i = 0; i <= NX; i++) {
      const e = vE[L][j * (NX + 1) + i];
      if (e) edge(false, i, j, e, i > 0 ? ci(i - 1, j) : ci(i, j));
    }
    for (let j = 0; j <= NZ; j++) for (let i = 0; i < NX; i++) {
      const e = hE[L][j * NX + i];
      if (e) edge(true, i, j, e, j > 0 ? ci(i, j - 1) : ci(i, j));
    }
    // pillars where wall lines meet
    const pv = (i, j) => j >= 0 && j < NZ ? vE[L][j * (NX + 1) + i] : 0;
    const ph = (i, j) => i >= 0 && i < NX ? hE[L][j * NX + i] : 0;
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const x = 8 * i, z = 8 * j;
      if (!g.touches(x, z, x, z)) continue;
      const es = [pv(i, j - 1), pv(i, j), ph(i - 1, j), ph(i, j)];
      if (!es.some(e => e)) continue;
      if (es.some(e => e && e !== E_OPEN)) {
        g.fill(x, y, z, x, y + 6, z, 'dark_oak_log');
        if (L === 0 && es.includes(E_EXT)) g.set(x, y, z, 'cobblestone');
      } else g.fill(x, y + 1, z, x, y + 6, z, 'air');
    }
    // what is in each cell
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const c = ci(i, j), k = kind[L][c];
      if (!k) continue;
      const x = 8 * i, z = 8 * j;
      if (k === CORR) {
        g.fill(x + 1, y + 1, z + 3, x + 7, y + 1, z + 5, 'light_gray_carpet');
        g.set(x + 4, y + 6, z + 4, 'lantern', { m: 1 });
      } else if (k === HALL) {
        g.fill(x + 3, y + 1, z + 1, x + 5, y + 1, z + 7, 'red_carpet');
        g.set(x + 1, y + 1, z + 1, 'potted_dark_oak_sapling');
        g.set(x + 7, y + 1, z + 1, 'potted_dark_oak_sapling');
        g.set(x + 4, y + 6, z + 4, 'lantern', { m: 1 });
      } else if (k === STAIR && j === 2) drawStairs(g, L, x, y);
      else if (k === ROOM && roomOf[L][c] >= 0 && rooms[roomOf[L][c]].i === i) {
        const rm = rooms[roomOf[L][c]];
        if (!g.touches(x, z, x + 8 * rm.n, z + 8)) continue;
        const p = roomPen(g, rm, y), rr = rng(rm.seed);
        for (let n = 0; n < rm.n; n++) p.set(8 * n + 3, 6, 3, 'lantern', { m: 1 });
        FURNISH[rm.type](p, rm, rr);
        rm.mobs.forEach((t, n) => p.entity(t, 2 + 4 * (n % 2), 1, 2));
      }
    }
    for (const gd of guards) if (gd.L === L) g.entity('vindicator', gd.x, y + 1, gd.z);
  }

  // the roofs: a beam on the wall, a row of stairs over it, a flat top, and eaves one block out
  for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) {
    const t = top(x, z);
    if (t >= 0) {
      const yR = yF(t) + STOREY;
      let d = -1, edgy = false;
      for (let f = 0; f < 4; f++) if (!inF(t, x + DX[f], z + DZ[f])) { if (d < 0) d = f; edgy = true; }
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (!inF(t, x + a, z + b)) edgy = true;
      if (!edgy) {
        g.fill(x, yR, z, x, yR + 1, z, 'dark_oak_planks');
      } else {
        const post = (x & 7) === 0 && (z & 7) === 0;
        g.set(x, yR, z, 'dark_oak_log', { axis: post ? 'y' : (z & 7) === 0 ? 'x' : 'z' });
        if (d < 0) g.set(x, yR + 1, z, 'dark_oak_planks');
        else g.set(x, yR + 1, z, 'dark_oak_stairs', { f: (d + 2) & 3 });
      }
    }
    for (let L = t + 1; L < LEVELS; L++) {
      let f = -1;
      for (let d = 0; d < 4 && f < 0; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (inF(L, nx, nz) && top(nx, nz) === L) f = d;
      }
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (f < 0 && inF(L, x + a, z + b) && top(x + a, z + b) === L) f = b < 0 ? NORTH : SOUTH;
      }
      if (f >= 0) g.set(x, yF(L) + STOREY, z, 'dark_oak_stairs', { f });
    }
  }

  // the front steps, with a lantern on a post either side
  const px = 8 * MID;
  g.fill(px + 1, 1, -3, px + 6, 5, -1, 'air');
  for (let x = px + 2; x <= px + 5; x++) {
    g.set(x, 1, -1, 'cobblestone_stairs', { f: SOUTH });
    g.set(x, 0, -1, 'cobblestone');
    g.down(x, -1, -1, 'cobblestone');
    g.set(x, 0, -2, 'cobblestone_stairs', { f: SOUTH });
    g.down(x, -1, -2, 'cobblestone');
  }
  for (const x of [px + 1, px + 6]) {
    g.set(x, 0, -1, 'cobblestone');
    g.down(x, -1, -1, 'cobblestone');
    g.set(x, 1, -1, 'cobblestone_wall');
    g.set(x, 2, -1, 'lantern');
  }
}

// the grand staircase: storey L's flight up (if there is a storey above) and the well of the flight from below
function drawStairs(g, L, x, y) {
  const s0 = x + 3, s1 = x + 5;
  if (L > 0) {
    const zs = (L - 1) % 2 ? 26 : 17;
    g.fill(s0, y, zs, s1, y, zs + 5, 'air');
    g.fill(x + 2, y + 1, zs, x + 2, y + 1, zs + 5, 'dark_oak_fence');
    g.fill(x + 6, y + 1, zs, x + 6, y + 1, zs + 5, 'dark_oak_fence');
    g.fill(x + 2, y + 1, zs - 1, x + 6, y + 1, zs - 1, 'dark_oak_fence');
  }
  if (L + 1 < LEVELS) {
    const zs = L % 2 ? 26 : 17;
    for (let k = 0; k < 6; k++) {
      if (k) g.fill(s0, y + 1, zs + k, s1, y + k, zs + k, 'dark_oak_planks');
      g.fill(s0, y + 1 + k, zs + k, s1, y + 1 + k, zs + k, 'dark_oak_stairs', { f: SOUTH });
    }
  }
  g.set(x + 1, y + 6, 20, 'lantern', { m: 1 });
  g.set(x + 7, y + 6, 28, 'lantern', { m: 1 });
}
