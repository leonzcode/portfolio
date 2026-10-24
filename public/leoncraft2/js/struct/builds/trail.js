/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: trail ruins, our own design.

   The ruins of an old settlement, buried: only the top of its tower shows
   above the ground of the taiga, birch forest or jungle it stands in. Under
   it, at the start's depth (15 under the surface), the tower's foot, and
   round it rooms and halls on roads of gravel and cobblestone, all of mud
   bricks or bricks banded with terracotta in one of five colourings, with a
   glazed terracotta floor here and there and the odd workstation (a loom,
   a grindstone, an anvil...). Everything is choked with gravel, as the
   game's ruins are, and some of that gravel is suspicious: brushed, it
   gives up the trail ruins' common finds, and in the room at the top of the
   tower their rare ones (sherds, armour trims, the Relic disc).

   Sizes follow the game's pieces (a tower 5 wide and up to 25 tall, rooms
   5, 7 and 9 across, halls 9 by 10 and 12 by 8). The layout comes from
   ctx.r alone; drawing takes from a hash of the frame position, so every
   chunk builds the same ruin.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { hash32 } from '../rand.js?v=107';
import { id } from '../piece.js?v=107';

export const PLANS = {};
const TYPE = 'trail_ruins';
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
// the five colourings: [brick, its stairs, its slab, main terracotta, band terracotta, accent, glazed]
const LOOKS = [
  ['mud_bricks', 'mud_brick_stairs', 'mud_brick_slab', 'blue_terracotta', 'red_terracotta', 'yellow_terracotta', 'yellow_glazed_terracotta'],
  ['mud_bricks', 'mud_brick_stairs', 'mud_brick_slab', 'cyan_terracotta', 'white_terracotta', 'light_gray_terracotta', 'light_gray_glazed_terracotta'],
  ['mud_bricks', 'mud_brick_stairs', 'mud_brick_slab', 'orange_terracotta', 'white_terracotta', 'yellow_terracotta', 'orange_glazed_terracotta'],
  ['bricks', 'brick_stairs', 'brick_slab', 'white_terracotta', 'light_gray_terracotta', 'blue_terracotta', 'light_blue_glazed_terracotta'],
  ['bricks', 'brick_stairs', 'brick_slab', 'gray_terracotta', 'red_terracotta', 'light_gray_terracotta', 'black_glazed_terracotta'],
];
const TOOLS = ['loom', 'grindstone', 'damaged_anvil', 'composter', 'cartography_table', 'cauldron', 'crafting_table', 'blast_furnace'];
const COMMON = 'archaeology/trail_ruins_common', RARE = 'archaeology/trail_ruins_rare';

const h01 = (s, x, y, z, k) => hash32(s, x, y, z, k | 0) / 4294967296;
// a suspicious gravel with its find (kept like a chest's loot, so the brush finds it: struct/spawners.js findAt)
function sus(g, x, y, z, table) {
  const [X, Y, Z] = g.world(x, y, z);
  if (!g.cb.inside(X, Y, Z)) return;
  const b = id('suspicious_gravel');
  if (!b) return;
  g.wr.set(X, Y, Z, b, 0);
  g.wr.chest(X, Y, Z, table, String(g.own(x, y, z).nextLong()));
}
// a wall cell: brick, with terracotta bands and patches, a few gone
function wallBlock(L, s, x, y, z) {
  const v = h01(s, x, y, z, 1);
  if (v < 0.06) return 'gravel';
  if (y === 2 || y === 5) return v < 0.6 ? L[4] : L[0];
  return v < 0.28 ? L[3] : v < 0.33 ? L[5] : L[0];
}
// gravel filling a room, a part of it suspicious (one in nine)
function fill(g, o, x0, y0, z0, x1, y1, z1, table) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (h01(o.s, x, y, z, 2) < 0.04) { g.set(x, y, z, 'air'); continue; }
    if (h01(o.s, x, y, z, 3) < 1 / 9) sus(g, x, y, z, table); else g.set(x, y, z, 'gravel');
  }
}

/* A room or hall: walls one thick, a floor of the brick with glazed tiles in
   the middle, gravel inside, a door gap towards the road (o.door), maybe a
   workstation half buried. */
function drawRoom(g, o) {
  const L = LOOKS[o.look], w = g.w, d = g.d, h = g.h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    if (y === 0) {
      const tile = !edge && Math.abs(x - (w >> 1)) <= 1 && Math.abs(z - (d >> 1)) <= 1 && o.glazed;
      g.set(x, 0, z, tile ? L[6] : edge ? L[0] : h01(o.s, x, 0, z, 4) < 0.3 ? 'packed_mud' : L[0], tile ? { f: (x + z) & 3 } : 0);
      continue;
    }
    if (edge) {
      // the walls broken off at a ragged height
      const top = h - 1 - Math.floor(h01(o.s, x, 0, z, 5) * 3);
      if (y <= top) g.set(x, y, z, wallBlock(L, o.s, x, y, z));
      else g.set(x, y, z, 'gravel');
    }
  }
  fill(g, o, 1, 1, 1, w - 2, h - 2, d - 2, COMMON);
  // the door
  const m = o.door === NORTH || o.door === SOUTH ? w >> 1 : d >> 1;
  for (let y = 1; y <= 2; y++) {
    const x = o.door === EAST ? w - 1 : o.door === WEST ? 0 : m, z = o.door === SOUTH ? d - 1 : o.door === NORTH ? 0 : m;
    g.set(x, y, z, 'gravel');
  }
  if (o.tool) g.set(1, 1, 1, o.tool, { f: SOUTH });
  // a lintel of stairs over the door, and a few slabs fallen
  if (h > 4) g.set(o.door === EAST ? w - 1 : o.door === WEST ? 0 : m, 3, o.door === SOUTH ? d - 1 : o.door === NORTH ? 0 : m, L[1], { f: o.door, top: true });
}

/* The tower: 5 x 5, from the buried floor up through the ground, a ladder
   up its inside, gravel to most of its height, and at the top (o.top above
   its foot) a small room whose suspicious gravel holds the rare finds. */
function drawTower(g, o) {
  const L = LOOKS[o.look], h = g.h;
  for (let y = 0; y < h; y++) for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) {
    const edge = x === 0 || z === 0 || x === 4 || z === 4;
    if (y === 0) { g.set(x, 0, z, L[0]); continue; }
    if (!edge) continue;
    // the very top is broken away
    if (y >= h - 2 && h01(o.s, x, y, z, 6) < 0.45) { g.set(x, y, z, 'air'); continue; }
    const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
    g.set(x, y, z, corner && y % 4 === 0 ? L[5] : wallBlock(L, o.s, x, y, z));
  }
  // inside: gravel up to the top room, a ladder against the north wall
  fill(g, o, 1, 1, 1, 3, h - 6, 3, COMMON);
  for (let y = 1; y <= h - 5; y++) g.set(2, y, 1, 'ladder', { f: SOUTH });
  // the top room: a floor, a window each side, two or three rare finds in a little gravel
  g.fill(1, h - 5, 1, 3, h - 5, 3, L[2], { slab: 0 });
  g.set(2, h - 5, 1, 'ladder', { f: SOUTH });
  for (let y = h - 4; y < h; y++) for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) g.set(x, y, z, 'air');
  for (const [x, z] of [[2, 0], [4, 2], [2, 4], [0, 2]]) g.set(x, h - 3, z, 'air');
  sus(g, 1, h - 4, 3, RARE); sus(g, 3, h - 4, 3, RARE);
  if (o.third) sus(g, 3, h - 4, 1, RARE);
  g.set(1, h - 4, 1, 'gravel');
  g.set(2, h - 4, 3, L[2], { slab: 0 });
}

// a road: five wide, gravel and cobblestone with bits of stone and stone bricks, a little suspicious gravel
function drawRoad(g, o) {
  for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) {
    const v = h01(o.s, x, 0, z, 7);
    if (v < 0.03) sus(g, x, 0, z, COMMON);
    else g.set(x, 0, z, v < 0.45 ? 'gravel' : v < 0.8 ? 'cobblestone' : v < 0.9 ? 'stone' : v < 0.96 ? 'stone_bricks' : 'cracked_stone_bricks');
    if (h01(o.s, x, 1, z, 8) < 0.15) g.set(x, 1, z, 'gravel');
  }
}

PLANS.trail_ruins = ctx => {
  const r = ctx.r;
  // the start's own draws (starts.js point): its turn, then its template
  r.nextInt(4); r.nextInt(5);
  const p = ctx.point, y0 = p.y, s = r.nextInt(1 << 30), look = r.nextInt(5);
  // the tower stands at the start, its top a few blocks out of the ground
  const ground = ctx.surface(p.x, p.z);
  const towerH = Math.max(10, Math.min(28, ground - y0 + 5 + r.nextInt(4)));
  const out = [new Build(TYPE, p.x - 2, y0, p.z - 2, 5, towerH, 5, 0, drawTower, { s, look, third: r.nextInt(3) === 0 })];
  const taken = [[p.x - 3, p.z - 3, p.x + 3, p.z + 3]];
  const free = (x0, z0, x1, z1) => taken.every(t => x1 + 1 < t[0] || x0 - 1 > t[2] || z1 + 1 < t[1] || z0 - 1 > t[3]);
  // roads out from the tower in two to four directions, rooms along them
  const dirs = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = r.nextInt(i + 1), t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t; }
  const n = 2 + r.nextInt(3);
  const SIZES = [[5, 7, 5], [7, 7, 7], [7, 10, 7], [9, 6, 11], [9, 7, 10], [12, 7, 8], [5, 10, 5]];
  for (let k = 0; k < n; k++) {
    const f = dirs[k], len = 8 + r.nextInt(14);
    // the road, five wide, from the tower's side outwards
    const rx0 = f === EAST ? p.x + 3 : f === WEST ? p.x - 3 - len + 1 : p.x - 2, rz0 = f === SOUTH ? p.z + 3 : f === NORTH ? p.z - 3 - len + 1 : p.z - 2;
    const rw = f === EAST || f === WEST ? len : 5, rd = f === EAST || f === WEST ? 5 : len;
    out.push(new Build(TYPE, rx0, y0, rz0, rw, 2, rd, 0, drawRoad, { s: s + k }));
    taken.push([rx0, rz0, rx0 + rw - 1, rz0 + rd - 1]);
    // rooms along the road, on its sides and at its end
    for (let t = 0; t < 3; t++) {
      const [w, h, d] = SIZES[r.nextInt(SIZES.length)];
      const along = t === 2 ? len + 1 : 2 + r.nextInt(Math.max(1, len - 6));
      const side = t === 0 ? 1 : t === 1 ? -1 : 0;
      // the room's centre: beside the road (side) or past its end
      let cx, cz;
      if (f === EAST || f === WEST) {
        const ax = f === EAST ? p.x + 3 + along : p.x - 3 - along;
        cx = t === 2 ? ax + (f === EAST ? (w >> 1) : -(w >> 1)) : ax; cz = p.z + side * (3 + (d >> 1));
      } else {
        const az = f === SOUTH ? p.z + 3 + along : p.z - 3 - along;
        cz = t === 2 ? az + (f === SOUTH ? (d >> 1) : -(d >> 1)) : az; cx = p.x + side * (3 + (w >> 1));
      }
      const x0 = cx - (w >> 1), z0 = cz - (d >> 1), x1 = x0 + w - 1, z1 = z0 + d - 1;
      if (!free(x0, z0, x1, z1) || Math.abs(cx - p.x) > 44 || Math.abs(cz - p.z) > 44) { r.nextInt(8); continue; }
      taken.push([x0, z0, x1, z1]);
      // the door faces the road
      const door = side === 0 ? (f + 2) & 3 : (f === EAST || f === WEST) ? (side > 0 ? NORTH : SOUTH) : (side > 0 ? WEST : EAST);
      const tool = r.nextInt(3) === 0 ? TOOLS[r.nextInt(TOOLS.length)] : null;
      out.push(new Build(TYPE, x0, y0, z0, w, h, d, 0, drawRoom, { s: s + 31 * k + t, look, door, tool, glazed: r.nextBoolean() }));
    }
  }
  return out;
};
