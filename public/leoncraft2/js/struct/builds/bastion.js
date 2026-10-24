/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the bastion remnant, from our own design.

   A ruined piglin fortress of blackstone at y 33 in the Nether wastes and
   the crimson, warped and soul sand forests. Like the game's, it comes as
   one of four kinds, picked with the start (the same draw starts.js makes
   for the start's template):
     housing units  a square rampart round a courtyard of blackstone houses
                    in tiers, joined by bridges over their roofs
     hoglin stables a long rampart with a stair climbing its middle and
                    hoglins penned in stalls on both sides, three floors up
     treasure room  a tall hollow keep over a lava basin, a platform in its
                    middle on a basalt column: gold, the treasure chests and
                    two magma cube spawners
     bridge         a rampart with a piglin's face, its mouth spilling lava,
                    and a two-deck bridge on basalt legs to a small keep where
                    the bridge chest sits ringed with gold
   Every kind is polished blackstone bricks, blackstone and basalt, cracked
   and gilded here and there and broken in places, lit by soul lanterns on
   chains, with the game's chest tables (bastion_other, _hoglin_stable,
   _treasure, _bridge) and its mobs: piglins, piglin brutes and hoglins.

   The layout comes from ctx.r alone and the drawing from a hash of the
   frame position, so every chunk builds the same bastion.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { hash32 } from '../rand.js?v=107';

const PBB = 'polished_blackstone_bricks', CPBB = 'cracked_polished_blackstone_bricks', BS = 'blackstone', GBS = 'gilded_blackstone';
const PB = 'polished_blackstone', CHIS = 'chiseled_polished_blackstone', BAS = 'basalt', GOLD = 'gold_block';
const SLAB = 'polished_blackstone_brick_slab', STAIR = 'blackstone_stairs', WALL = 'polished_blackstone_brick_wall', BWALL = 'blackstone_wall';
const UP = { axis: 'y' }, LOW = { slab: 0 }, HIGH = { slab: 1 };
const TYPE = 'bastion_remnant';
const Y = 33;

/* A pen that wears what it lays, as the remnants are worn: a sixth of the
   bricks cracked, a few gone to plain blackstone and a very few gilded. */
function worn(g, seed) {
  const h = (x, y, z, k) => hash32(seed, x, y, z, k) / 4294967296;
  const o = Object.create(g);
  o.set = (x, y, z, n, st) => {
    if (n === PBB) { const v = h(x, y, z, 1); n = v < 0.17 ? CPBB : v < 0.23 ? BS : v < 0.235 ? GBS : PBB; }
    else if (n === BS) { if (h(x, y, z, 2) < 0.035) n = GBS; }
    g.set(x, y, z, n, st);
  };
  o.fill = (x0, y0, z0, x1, y1, z1, n, st) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) o.set(x, y, z, n, st);
  };
  o.h = h;
  return o;
}

/* ------------------------------------------------------- shared parts -- */
// thick walls round a rectangle, t thick, from y0 up to y1, with a crenellated top and basalt at the corners
function rampartRing(g, x0, z0, x1, z1, t, y0, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const inX = x >= x0 + t && x <= x1 - t, inZ = z >= z0 + t && z <= z1 - t;
    if (inX && inZ) continue;
    const corner = (x < x0 + t || x > x1 - t) && (z < z0 + t || z > z1 - t);
    g.set(x, y, z, corner ? BAS : y === y0 ? BS : y % 7 === 6 ? PB : PBB, corner ? UP : 0);
  }
  battlements(g, x0, z0, x1, z1, y1 + 1);
}
// the top of a wall: posts of blackstone wall every other block, slabs between
function battlements(g, x0, z0, x1, z1, y) {
  for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) if ((x + z) % 2 === 0) g.set(x, y, z, BWALL); else g.set(x, y, z, SLAB, LOW);
  for (let z = z0 + 1; z < z1; z++) for (const x of [x0, x1]) if ((x + z) % 2 === 0) g.set(x, y, z, BWALL); else g.set(x, y, z, SLAB, LOW);
}
// a soul lantern hanging on a chain of n links under the block at y
function hangLantern(g, x, y, z, n) {
  for (let k = 1; k <= n; k++) g.set(x, y - k, z, 'iron_chain', UP);
  g.set(x, y - n - 1, z, 'soul_lantern', { m: 1 });
}
// an opening w wide and h high through a wall on side f of a rectangle (an arch: its top corners kept)
function gate(g, f, x0, z0, x1, z1, t, mid, w, y0, h) {
  for (let i = -(w >> 1); i <= (w >> 1); i++) for (let k = 0; k < t; k++) for (let y = y0; y < y0 + h; y++) {
    if (y === y0 + h - 1 && Math.abs(i) === (w >> 1)) continue;
    const x = f === NORTH || f === SOUTH ? mid + i : f === WEST ? x0 + k : x1 - k;
    const z = f === EAST || f === WEST ? mid + i : f === NORTH ? z0 + k : z1 - k;
    g.set(x, y, z, 'air');
  }
}
// basalt legs (and the wall's foot) down to whatever is under the bastion: netherrack, or the bottom of the lava sea
function footings(g, x0, z0, x1, z1, step) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    if (!edge) continue;
    if (step && (x - x0) % step && (z - z0) % step && x !== x1 && z !== z1) continue;
    g.down(x, -1, z, BS);
  }
}
// a small blackstone house: walls of bricks, basalt corners, a door, windows, a flat roof with a parapet
function house(g, x0, y0, z0, s, hgt, door, o) {
  const x1 = x0 + s - 1, z1 = z0 + s - 1, m = s >> 1;
  for (let y = y0; y < y0 + hgt; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const ex = x === x0 || x === x1, ez = z === z0 || z === z1;
    if (y === y0) { g.set(x, y, z, ex || ez ? BS : PB); continue; }
    if (!ex && !ez) { g.set(x, y, z, 'air'); continue; }
    if (ex && ez) { g.set(x, y, z, BAS, UP); continue; }
    const along = ex ? z - z0 : x - x0;
    const win = y === y0 + 2 && (along === 2 || along === s - 3);
    g.set(x, y, z, win ? 'air' : PBB);
  }
  // roof and parapet
  g.fill(x0, y0 + hgt, z0, x1, y0 + hgt, z1, PB);
  battlements(g, x0, z0, x1, z1, y0 + hgt + 1);
  // the door
  const dx = door === EAST ? x1 : door === WEST ? x0 : x0 + m, dz = door === SOUTH ? z1 : door === NORTH ? z0 : z0 + m;
  g.set(dx, y0 + 1, dz, 'air'); g.set(dx, y0 + 2, dz, 'air');
  hangLantern(g, x0 + m, y0 + hgt, z0 + m, 1);
  if (o && o.chest) g.chest(x0 + 1, y0 + 1, z0 + 1, o.chest, SOUTH);
  if (o && o.gold) g.set(x0 + m, y0, z0 + m, GOLD);
}

/* ===================================================== housing units == */
/* 46 x 46: the rampart ring (3 thick, 20 high), gates north and south, and a
   3 x 3 grid of houses rising in tiers to the middle (one, two and three
   storeys), their roofs joined by slab bridges. */
function drawUnits(g0, o) {
  const g = worn(g0, o.s), W = 46, top = 20;
  rampartRing(g, 0, 0, W - 1, W - 1, 3, 0, top);
  // the courtyard
  g.fill(3, 0, 3, W - 4, 0, W - 4, BS);
  g.air(3, 1, 3, W - 4, top + 6, W - 4);
  gate(g, SOUTH, 0, 0, W - 1, W - 1, 3, 23, 5, 1, 6);
  gate(g, NORTH, 0, 0, W - 1, W - 1, 3, 23, 3, 1, 4);
  // a walk along the inside of the wall at its top, with stairs up in the corner
  for (let i = 3; i <= W - 4; i++) for (const [x, z] of [[i, 3], [i, W - 4], [3, i], [W - 4, i]]) g.set(x, top - 1, z, SLAB, HIGH);
  for (let k = 0; k < top - 1; k++) g.set(4 + k, 1 + k, 4, STAIR, { f: EAST });
  footings(g, 0, 0, W - 1, W - 1, 4);
  // the houses: corners one storey, sides two, the middle three
  const at = [7, 19, 31], S = 9, H = 6;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const tiers = 1 + (i === 1 ? 1 : 0) + (j === 1 ? 1 : 0);
    const x0 = at[i], z0 = at[j];
    for (let t = 0; t < tiers; t++) {
      const chest = (i === 1 && j === 1 && t === 0) || (o.chests.includes(i * 3 + j) && t === tiers - 1) ? 'bastion_other' : null;
      house(g, x0, t * H, z0, S, H, j === 2 ? SOUTH : j === 0 ? NORTH : i === 0 ? WEST : EAST, { chest, gold: i === 1 && j === 1 && t === 1 });
      // stairs up the west side of a house to the storey above
      if (t + 1 < tiers) for (let k = 0; k < H; k++) g.set(x0 - 1, t * H + 1 + k, z0 + 1 + k, STAIR, { f: SOUTH });
    }
  }
  // slab bridges from the side houses' roofs (12) into the middle house's top storey, the parapets and walls opened for them
  for (const [f, x0, z0, x1, z1] of [[NORTH, 22, 16, 24, 18], [SOUTH, 22, 28, 24, 30], [WEST, 16, 22, 18, 24], [EAST, 28, 22, 30, 24]]) {
    g.fill(x0, 12, z0, x1, 12, z1, SLAB, LOW);
    for (let a = 0; a < 3; a++) {
      const x = f === WEST ? 15 : f === EAST ? 31 : x0 + a, z = f === NORTH ? 15 : f === SOUTH ? 31 : z0 + a;
      g.set(x, 13, z, 'air');
      const mx = f === WEST ? 19 : f === EAST ? 27 : x0 + a, mz = f === NORTH ? 19 : f === SOUTH ? 27 : z0 + a;
      g.set(mx, 13, mz, 'air'); g.set(mx, 14, mz, 'air');
    }
  }
  // gold set into the wall either side of the south gate, and a chest on the wall walk
  g.set(19, 3, W - 2, GOLD); g.set(27, 3, W - 2, GOLD);
  g.chest(W - 5, top, 5, 'bastion_other', WEST);
  // a lava fall down the inside of the north wall
  g.set(10, top - 2, 2, 'lava');
  // its people
  for (const [x, z] of [[12, 22], [22, 12], [33, 22], [22, 33], [16, 40], [30, 40]]) g.entity('piglin', x, 1, z);
  g.entity('piglin_brute', 22, 1, 22 - 7); g.entity('piglin_brute', 40, top, 22);
  g.entity('piglin', 22, 3 * H + 1, 22);
}

/* ===================================================== hoglin stables == */
/* 30 across, 48 long: the rampart (2 thick, 22 high), a stair six wide
   climbing the middle in five flights, and on each side three floors of
   stalls with a hoglin in most. */
function drawStables(g0, o) {
  const g = worn(g0, o.s), W = 30, D = 48, top = 22;
  rampartRing(g, 0, 0, W - 1, D - 1, 2, 0, top);
  g.fill(2, 0, 2, W - 3, 0, D - 3, BS);
  g.air(2, 1, 2, W - 3, top + 4, D - 3);
  gate(g, SOUTH, 0, 0, W - 1, D - 1, 2, 14, 5, 1, 5);
  footings(g, 0, 0, W - 1, D - 1, 4);
  // the stair: flights of four steps and four of landing, magma in the landings
  let y = 0;
  for (let z = D - 4, k = 0; z >= 4; z--, k++) {
    const step = (k % 8) < 4;
    if (step) y++;
    for (let x = 12; x <= 17; x++) {
      if (step) g.set(x, y, z, STAIR, { f: NORTH });
      else g.set(x, y, z, (x === 12 || x === 17) && (k % 8) === 6 ? 'magma_block' : PB);
      g.fill(x, Math.max(1, y - 3), z, x, y - 1, z, BS);
    }
    for (const x of [11, 18]) { g.fill(x, 1, z, x, y, z, BS); g.set(x, y + 1, z, BWALL); }
  }
  // basalt posts along the stair
  for (let z = 6; z < D - 4; z += 8) for (const x of [11, 18]) g.fill(x, 1, z, x, top - 4, z, BAS, UP);
  // the stalls: floors at 0, 6 and 12 on both sides, a stall every 8 blocks
  let hog = 0;
  for (const [a, b] of [[2, 10], [19, 27]]) for (const fy of [0, 6, 12]) {
    if (fy) g.fill(a, fy, 2, b, fy, D - 3, PBB);
    for (let z = 2; z < D - 2; z += 8) {
      // partitions and the stall's front rail
      for (let x = a; x <= b; x++) { g.set(x, fy + 1, z, BWALL); g.set(x, fy + 2, z, BWALL); }
      const front = a === 2 ? b : a;
      for (let zz = z + 1; zz < Math.min(z + 8, D - 2); zz++) if (zz !== z + 4) g.set(front, fy + 1, zz, WALL);
      if (z + 4 < D - 2 && hog < 9 && o.h(z, fy, a) < 0.75) { g.entity('hoglin', (a + b) >> 1, fy + 1, z + 4); hog++; }
      if (fy === 12) hangLantern(g, (a + b) >> 1, top - 2, z + 4, 2);
    }
  }
  // the stable chests at the far ends of the stalls, the others on the top floor, a gold block in a small stall
  g.chest(3, 1, D - 4, 'bastion_hoglin_stable', NORTH);
  g.chest(W - 4, 7, 3, 'bastion_hoglin_stable', SOUTH);
  g.chest(3, 13, 3, 'bastion_other', SOUTH);
  g.chest(W - 4, 13, D - 4, 'bastion_other', NORTH);
  g.set(W - 4, 1, 10, GOLD);
  for (const [x, yy, z] of [[14, 21, 6], [6, 13, 20], [23, 13, 28], [14, 1, D - 6]]) g.entity('piglin', x, yy, z);
  g.entity('piglin_brute', 15, 21, 5);
}

/* ===================================================== treasure room == */
/* A keep 38 x 38 and 48 high over a lava basin; on a basalt column in the
   middle a platform at y 20: gold under the treasure chests, a magma cube
   spawner on each side, slab bridges to ledges round the walls at 20 and
   32, the way in through the south wall at the lower ledge. */
function drawTreasure(g0, o) {
  const g = worn(g0, o.s), W = 38, top = 44, m = 18;
  rampartRing(g, 0, 0, W - 1, W - 1, 2, 0, top);
  // the roof, broken through in places
  for (let x = 2; x < W - 2; x++) for (let z = 2; z < W - 2; z++) if (g.h(x, top, z, 5) > 0.12) g.set(x, top, z, PBB);
  g.air(2, 1, 2, W - 3, top - 1, W - 3);
  // the basin: lava over a blackstone floor, magma round its rim
  g.fill(2, 0, 2, W - 3, 0, W - 3, BS);
  for (let x = 2; x < W - 2; x++) for (let z = 2; z < W - 2; z++) {
    const rim = x < 4 || x > W - 5 || z < 4 || z > W - 5;
    g.set(x, 1, z, rim ? 'magma_block' : 'lava');
  }
  footings(g, 0, 0, W - 1, W - 1, 6);
  // the column and the cone under the platform
  g.fill(m - 1, 1, m - 1, m, 19, m, BAS, UP);
  for (let k = 0; k < 4; k++) { const e = 3 - k; g.fill(m - 1 - e, 19 - k, m - 1 - e, m + e, 19 - k, m + e, k === 0 ? PBB : BS); }
  // the platform: bricks, gold in the middle, gilded blackstone
  const p0 = m - 5, p1 = m + 4;
  g.fill(p0, 20, p0, p1, 20, p1, PBB);
  g.fill(m - 2, 20, m - 2, m + 1, 20, m + 1, GOLD);
  for (const [x, z] of [[p0 + 1, p0 + 1], [p1 - 1, p0 + 1], [p0 + 1, p1 - 1], [p1 - 1, p1 - 1]]) g.set(x, 20, z, GBS);
  for (let x = p0; x <= p1; x++) for (const z of [p0, p1]) g.set(x, 21, z, (x & 1) ? SLAB : BWALL, (x & 1) ? LOW : 0);
  for (let z = p0 + 1; z < p1; z++) for (const x of [p0, p1]) g.set(x, 21, z, (z & 1) ? SLAB : BWALL, (z & 1) ? LOW : 0);
  g.chest(m - 1, 21, m, 'bastion_treasure', SOUTH);
  g.chest(m, 21, m - 1, 'bastion_treasure', NORTH);
  g.spawner(p0 + 2, 21, m, 'magma_cube');
  g.spawner(p1 - 2, 21, m - 1, 'magma_cube');
  for (const [x, z] of [[p0 + 2, p0 + 2], [p1 - 2, p1 - 2]]) for (let y = 22; y < top; y++) g.set(x, y, z, 'iron_chain', UP);
  // ledges round the walls at 20 and 32, and bridges out to them
  for (const ly of [20, 32]) {
    for (let i = 2; i < W - 2; i++) for (let k = 2; k <= 3; k++) for (const [x, z] of [[i, k], [i, W - 1 - k], [k, i], [W - 1 - k, i]]) g.set(x, ly, z, PBB);
    for (let i = 4; i < W - 4; i++) for (const [x, z] of [[i, 4], [i, W - 5], [4, i], [W - 5, i]]) g.set(x, ly + 1, z, BWALL);
  }
  for (let z = 4; z < p0; z++) for (let x = m - 1; x <= m + 1; x++) if (g.h(x, 20, z, 6) > 0.1) g.set(x, 20, z, SLAB, HIGH);
  for (let z = p1 + 1; z < W - 4; z++) for (let x = m - 1; x <= m + 1; x++) if (g.h(x, 20, z, 6) > 0.1) g.set(x, 20, z, SLAB, HIGH);
  for (let x = p1 + 1; x < W - 4; x++) for (let z = m - 1; z <= m + 1; z++) g.set(x, 32, z, SLAB, HIGH);
  for (let x = p1 + 1; x < W - 4; x++) g.set(x, 33, m - 2, BWALL);
  for (let x = m - 1; x <= m + 1; x++) { g.set(x, 21, 4, 'air'); g.set(x, 21, W - 5, 'air'); }
  for (let z = m - 1; z <= m + 1; z++) g.set(W - 5, 33, z, 'air');
  for (const [x, z] of [[p0 + 1, p1 - 2], [p1 - 1, p0 + 2]]) g.set(x, 21, z, 'soul_lantern');
  // the way in, and gold in the walls
  gate(g, SOUTH, 0, 0, W - 1, W - 1, 2, m, 3, 21, 4);
  for (let k = 0; k < 8; k++) { const x = 1 + Math.floor(g.h(k, 1, 1, 7) * (W - 2)), y = 6 + Math.floor(g.h(k, 2, 2, 8) * 30); g.set(x, y, k & 1 ? 0 : W - 1, GOLD); }
  g.chest(3, 21, 3, 'bastion_other', SOUTH);
  g.chest(W - 4, 33, W - 4, 'bastion_other', NORTH);
  for (const [x, y, z] of [[m - 3, 21, m + 3], [6, 21, W - 4], [W - 4, 33, 6], [3, 33, m]]) g.entity('piglin_brute', x, y, z);
  g.entity('piglin', m + 2, 21, m - 3); g.entity('piglin', W - 6, 21, 3);
}

/* ============================================================ bridge == */
/* 32 across, 63 long: the rampart with the face (z 0..15), the bridge on
   legs (16..46, two decks, top 18, bottom 11), the small keep at the far
   end (47..62) with the bridge chest ringed with gold. */
function drawBridge(g0, o) {
  const g = worn(g0, o.s);
  // the rampart
  const top = 30;
  rampartRing(g, 0, 0, 31, 15, 3, 0, top);
  g.fill(3, 0, 3, 28, 0, 12, BS);
  g.air(3, 1, 3, 28, top + 4, 12);
  footings(g, 0, 0, 31, 15, 5);
  // walkways inside at 6, 12, 18 and 24, round an open middle, with stairs between
  for (const wy of [6, 12, 18, 24]) {
    for (let x = 3; x <= 28; x++) for (let z = 3; z <= 12; z++) if (x < 7 || x > 24 || z < 5 || z > 10) g.set(x, wy, z, PBB);
    for (let k = 0; k < 6; k++) g.set(4 + k + (wy % 12 ? 14 : 0), wy - 5 + k, 4, STAIR, { f: EAST });
  }
  g.fill(7, 1, 5, 24, 1, 10, 'lava');
  // the face on the front (z 0): eyes of gold, a snout with nostrils, tusks, and the mouth spilling lava
  for (const ex of [8, 21]) { g.fill(ex, 20, 0, ex + 2, 22, 0, GOLD); g.fill(ex + 1, 21, 0, ex + 1, 21, 0, 'air'); }
  g.fill(12, 13, 0, 19, 17, 0, PB);
  g.fill(14, 15, 0, 14, 15, 1, 'air'); g.fill(17, 15, 0, 17, 15, 1, 'air');
  for (const tx of [9, 22]) g.fill(tx, 8, 0, tx, 11, 0, GBS);
  g.fill(11, 6, 0, 20, 9, 2, 'air');
  g.set(13, 10, 2, 'lava'); g.set(18, 10, 2, 'lava');
  // the ways out of the back of the rampart onto the two decks
  for (const wy of [11, 18]) g.fill(14, wy + 1, 12, 17, wy + 3, 15, 'air');
  // the bridge: legs, two decks with rails, broken here and there
  for (let z = 16; z <= 46; z++) {
    for (let x = 13; x <= 18; x++) {
      if (o.h(x, 18, z) > 0.08 || z < 18 || z > 44) g.set(x, 18, z, x === 13 || x === 18 ? PBB : SLAB, x === 13 || x === 18 ? 0 : HIGH);
      g.set(x, 11, z, PBB);
    }
    for (const x of [13, 18]) { g.set(x, 19, z, BWALL); g.set(x, 12, z, BWALL); }
    if ((z - 16) % 8 === 0) for (const x of [13, 18]) { g.fill(x, 0, z, x, 10, z, BAS, UP); g.down(x, -1, z, BAS, UP); }
  }
  // the keep at the far end
  rampartRing(g, 8, 47, 23, 62, 2, 0, 24);
  g.fill(10, 0, 49, 21, 0, 60, BS);
  g.air(10, 1, 49, 21, 27, 60);
  footings(g, 8, 47, 23, 62, 5);
  g.fill(10, 18, 49, 21, 18, 60, PBB);
  g.fill(10, 11, 49, 21, 11, 60, PBB);
  for (const wy of [11, 18]) g.fill(14, wy + 1, 47, 17, wy + 3, 48, 'air');
  // the bridge chest on a gold floor
  g.fill(14, 18, 53, 17, 18, 56, GOLD);
  g.chest(15, 19, 55, 'bastion_bridge', NORTH);
  hangLantern(g, 15, 24, 54, 2);
  g.chest(5, 7, 5, 'bastion_other', SOUTH);
  g.chest(26, 19, 10, 'bastion_other', WEST);
  g.chest(11, 12, 59, 'bastion_other', EAST);
  for (const [x, y, z] of [[5, 7, 8], [26, 13, 6], [6, 19, 11], [25, 25, 4], [15, 19, 30], [16, 12, 38], [12, 19, 58]]) g.entity('piglin', x, y, z);
  g.entity('piglin_brute', 16, 25, 8); g.entity('hoglin', 8, 1, 8); g.entity('hoglin', 22, 1, 4);
}

/* -------------------------------------------------------------- plan -- */
// a point of the bastion's own frame turned clockwise rot times (the way a Build turns its box)
const turn = (x, z, rot) => (rot === 0 ? [x, z] : rot === 1 ? [-z, x] : rot === 2 ? [-x, -z] : [z, -x]);
function piece(px, pz, rot, lx, lz, w, h, d, ly, draw, opts) {
  const c = [[lx, lz], [lx + w - 1, lz], [lx, lz + d - 1], [lx + w - 1, lz + d - 1]].map(([x, z]) => turn(x, z, rot));
  return new Build(TYPE, px + Math.min(...c.map(v => v[0])), Y + ly, pz + Math.min(...c.map(v => v[1])), w, h, d, rot, draw, opts);
}
export const PLANS = {};
PLANS.bastion_remnant = ctx => {
  const r = ctx.r;
  // the same draws starts.js made for this start: its turn, then which of the four start templates
  const rot = r.nextInt(4), kind = r.nextInt(4);
  const px = ctx.point.x, pz = ctx.point.z, s = r.nextInt(1 << 30);
  const opts = { s, kind, chests: [0, 2, 6, 8].filter(() => r.nextInt(3) === 0), h: (x, y, z) => hash32(s, x, y, z, 9) / 4294967296 };
  switch (kind) {
    case 0: return [piece(px, pz, rot, -23, -23, 46, 30, 46, 0, drawUnits, opts)];
    case 1: return [piece(px, pz, rot, -15, -24, 30, 28, 48, 0, drawStables, opts)];
    case 2: return [piece(px, pz, rot, -19, -19, 38, 48, 38, 0, drawTreasure, opts)];
    default: return [piece(px, pz, rot, -16, -16, 32, 36, 63, 0, drawBridge, opts)];
  }
};
