/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the end city, from our own design.

   A city grows upward from a purpur house standing on the outer island:
   two or three storeys with end stone brick bands, a ladder in one corner
   and a roof with an overhang. A tower of square storeys rises from the
   roof, and a tower ends in a wider hat (a room with magenta windows, end
   rods on the corners and a stepped roof). Bridges of purpur with slab
   rails and end rods leave a tower's storeys, climb a few steps over the
   void and end at the next tower, which hangs at the bridge's height on a
   short point. Fat towers are the same with a wider shaft, and their hat is
   a loot room (two chests on pillars and a brewing stand).

   About half the cities also have the end ship: a purple hull moored at the
   end of a bridge from the highest tower, with a cabin at the stern, a mast
   with end rods, the dragon head on the bow and, in the hold under the deck,
   two chests and the elytra in an item frame. Shulkers sit in every tower
   top, in the house and on the ship.

   The layout is made in the plan from ctx.r alone (a bridge or a tower
   that would run into another piece or out of reach is left out), and no
   draw function takes from g.r, so every chunk builds the same city.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { DX, DZ, opp } from './util.js?v=107';

const PUR = 'purpur_block', PIL = 'purpur_pillar', ST = 'purpur_stairs', SL = 'purpur_slab';
const ESB = 'end_stone_bricks', GL = 'magenta_stained_glass', ROD = 'end_rod';
const SEG = 4;          // a tower storey: the floor and three of air
const HOUSE = 5;        // a storey of the house
const DECK = 6;         // the ship's deck, above its keel
const REACH = 8;        // chunks from the start chunk a piece may touch (starts.js)
const DIRS = [NORTH, EAST, SOUTH, WEST];
const UP = { axis: 'y' };

/* ------------------------------------------------------------ drawing -- */
// the outline of a rectangle at height y
function ring(g, x0, z0, x1, z1, y, name, state) {
  for (let x = x0; x <= x1; x++) { g.set(x, y, z0, name, state); g.set(x, y, z1, name, state); }
  for (let z = z0 + 1; z < z1; z++) { g.set(x0, y, z, name, state); g.set(x1, y, z, name, state); }
}
// the same in stairs whose tall backs face the middle: a roof's eaves, or upside down an overhang
function stairRing(g, x0, z0, x1, z1, y, top) {
  for (let x = x0; x <= x1; x++) { g.set(x, y, z0, ST, { f: SOUTH, top }); g.set(x, y, z1, ST, { f: NORTH, top }); }
  for (let z = z0 + 1; z < z1; z++) { g.set(x0, y, z, ST, { f: EAST, top }); g.set(x1, y, z, ST, { f: WEST, top }); }
}
// a cell on side f of the square a..b, t along that side
function side(f, a, b, t) {
  switch (f) { case NORTH: return [t, a]; case SOUTH: return [t, b]; case WEST: return [a, t]; default: return [b, t]; }
}
// a gap (doorway) or a window in side f of the square a..b: mid +- half along it, from y0 to y1
function opening(g, f, a, b, mid, half, y0, y1, name) {
  for (let t = mid - half; t <= mid + half; t++) {
    const [x, z] = side(f, a, b, t);
    g.fill(x, y0, z, x, y1, z, name || 'air');
  }
}
function corners(g, x0, z0, x1, z1, y0, y1, name, state) {
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) g.fill(x, y0, z, x, y1, z, name, state);
}

/* The house: 13 x 13 with its walls one in from the edge (the roof's
   overhang takes the outer ring). o: { n storeys, door side, guard } */
function drawHouse(g, o) {
  const top = o.n * HOUSE;
  for (let k = 0; k < o.n; k++) {
    const y = k * HOUSE;
    g.fill(1, y, 1, 11, y, 11, k ? PUR : ESB);
    ring(g, 1, 1, 11, 11, y, ESB);
    for (let yy = y + 1; yy < y + HOUSE; yy++) ring(g, 1, 1, 11, 11, yy, PUR);
    g.air(2, y + 1, 2, 10, y + HOUSE - 1, 10);
    for (const f of DIRS) for (const t of [4, 8]) opening(g, f, 1, 11, t, 0, y + 2, y + 3, GL);
    g.set(6, y + HOUSE - 1, 6, ROD, { down: true });
  }
  corners(g, 1, 1, 11, 11, 0, top - 1, PIL, UP);
  opening(g, o.door, 1, 11, 6, 1, 1, 3);
  // the roof, its overhang and a slab parapet with rods on the corners
  g.fill(1, top, 1, 11, top, 11, PUR);
  stairRing(g, 0, 0, 12, 12, top, true);
  ring(g, 0, 0, 12, 12, top + 1, SL, { slab: 0 });
  corners(g, 0, 0, 12, 12, top + 1, top + 1, ROD, { up: true });
  for (let y = 1; y <= top; y++) g.set(10, y, 10, 'ladder', { f: WEST });
  g.entity('shulker', o.guard ? 2 : 10, 1, 2);
}

/* A tower's shaft: S x S storeys, `base` rows of a point under it when it
   hangs off a bridge. o: { S, segs, base, doors: [{ f, s }], guard } */
function drawShaft(g, o) {
  const S = o.S, c = S >> 1, e = S - 1, b = o.base;
  for (let i = 1; i <= b && 2 * i <= e; i++) {
    g.fill(i, b - i, i, e - i, b - i, e - i, PUR);
    stairRing(g, i, i, e - i, e - i, b - i, true);
  }
  for (let s = 0; s < o.segs; s++) {
    const y = b + s * SEG;
    g.fill(0, y, 0, e, y, e, PUR);
    ring(g, 0, 0, e, e, y, ESB);
    for (let yy = y + 1; yy < y + SEG; yy++) ring(g, 0, 0, e, e, yy, PUR);
    g.air(1, y + 1, 1, e - 1, y + SEG - 1, e - 1);
    for (const f of DIRS) opening(g, f, 0, e, c, S > 7 ? 1 : 0, y + 1, y + 2, GL);
    g.set(c, y + SEG - 1, c, ROD, { down: true });
  }
  corners(g, 0, 0, e, e, b, b + o.segs * SEG - 1, PIL, UP);
  for (const d of o.doors) opening(g, d.f, 0, e, c, 1, b + d.s * SEG + 1, b + d.s * SEG + 3);
  for (let y = b + 1; y < b + o.segs * SEG; y++) g.set(e - 1, y, e - 1, 'ladder', { f: WEST });
  g.entity('shulker', 1, b + o.guard * SEG + 1, 1);
}

/* A tower's hat: (S + 4) square, a room with windows on a floor that
   overhangs the shaft, eaves stepping in, end rods on top. The ladder from
   the shaft comes up through its floor. o: { S, loot, guards } */
function drawHat(g, o) {
  const e = o.S + 3, c = e >> 1, L = o.S;
  g.fill(1, 0, 1, e - 1, 0, e - 1, PUR);
  stairRing(g, 0, 0, e, e, 0, true);
  for (let y = 1; y <= 4; y++) ring(g, 1, 1, e - 1, e - 1, y, PUR);
  g.air(2, 1, 2, e - 2, 4, e - 2);
  for (const f of DIRS) opening(g, f, 1, e - 1, c, 1, 2, 3, GL);
  corners(g, 1, 1, e - 1, e - 1, 1, 4, PIL, UP);
  ring(g, 0, 0, e, e, 1, SL, { slab: 0 });
  corners(g, 0, 0, e, e, 1, 1, ROD, { up: true });
  g.fill(1, 5, 1, e - 1, 5, e - 1, PUR);
  stairRing(g, 0, 0, e, e, 5, false);
  stairRing(g, 1, 1, e - 1, e - 1, 6, false);
  g.fill(2, 6, 2, e - 2, 6, e - 2, SL, { slab: 0 });
  corners(g, 1, 1, e - 1, e - 1, 6, 6, ROD, { up: true });
  g.set(c, 7, c, ROD, { up: true });
  g.set(c, 4, c, ROD, { down: true });
  g.set(L, 0, L, 'ladder', { f: WEST });
  g.entity('shulker', 2, 1, e - 2);
  if (o.guards > 1) g.entity('shulker', e - 2, 4, 2);
  if (o.loot) {
    g.set(3, 1, 2, PIL, UP); g.set(e - 3, 1, 2, PIL, UP);
    g.set(c, 1, 2, 'brewing_stand');
    g.chest(3, 2, 2, 'end_city_treasure', SOUTH);
    g.chest(e - 3, 2, 2, 'end_city_treasure', SOUTH);
  }
}

/* A bridge, 5 wide, running out along +z from a doorway: a purpur deck,
   overhang stairs under its edges, slab rails with end rods, and stairs
   where it climbs. o.prof[z] = { y: the deck's rise there, step }. */
function drawBridge(g, o) {
  for (let z = 0; z < o.prof.length; z++) {
    const p = o.prof[z], y = 1 + p.y;
    g.set(0, y - 1, z, ST, { f: EAST, top: true });
    g.set(4, y - 1, z, ST, { f: WEST, top: true });
    g.fill(0, y, z, 4, y, z, PUR);
    if (p.step) {
      g.fill(1, y - 1, z, 3, y - 1, z, PUR);
      g.fill(1, y, z, 3, y, z, ST, { f: SOUTH });
      g.set(0, y + 1, z, ST, { f: SOUTH }); g.set(4, y + 1, z, ST, { f: SOUTH });
    } else if (z % 4 === 2) {
      g.set(0, y + 1, z, ROD, { up: true }); g.set(4, y + 1, z, ROD, { up: true });
    } else {
      g.set(0, y + 1, z, SL, { slab: 0 }); g.set(4, y + 1, z, SL, { slab: 0 });
    }
  }
}

/* The end ship, 11 x 22 x 27: stern at z 0 (where its bridge comes in),
   bow at z 26. The hull narrows to a keel and rises to the bow and stern. */
const KEEL = [3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6];
const beam = z => z <= 1 ? 3 + z : z <= 20 ? 5 : Math.max(0, 25 - z);
// how far the hull reaches either side of the middle at (y, z), or -1 where there is no hull
function hullW(y, z) {
  if (z < 0 || z > 26 || y < 0 || y > DECK || y < KEEL[z]) return -1;
  return Math.min(beam(z), y - KEEL[z] + 1);
}
function drawShip(g, o) {
  const C = 5;
  for (let z = 0; z < 27; z++) for (let y = 0; y <= DECK; y++) {
    const hw = hullW(y, z);
    for (let x = C - hw; x <= C + hw; x++) {
      const a = Math.abs(x - C);
      const edge = a === hw || hullW(y, z - 1) < a || hullW(y, z + 1) < a;
      if (y === DECK) {
        g.set(x, y, z, edge ? ESB : PUR);
        if (edge) g.set(x, y + 1, z, (x + z) % 5 === 2 ? ROD : SL, (x + z) % 5 === 2 ? { up: true } : { slab: 0 });
      } else g.set(x, y, z, edge || hullW(y - 1, z) < a ? PUR : 'air');
    }
  }
  // the hold: a floor, a bulkhead at each end, the hatch and its ladder
  for (let z = 3; z <= 20; z++) for (let y = 1; y < DECK; y++) {
    const hw = hullW(y, z);
    for (let x = C - hw + 1; x <= C + hw - 1; x++) {
      if (hullW(y - 1, z) < Math.abs(x - C)) continue;
      if (y === 1 || z === 3 || z === 20) g.set(x, y, z, PUR);
    }
  }
  for (let y = 2; y <= DECK; y++) g.set(C, y, 4, 'ladder', { f: SOUTH });
  g.set(C, 5, 10, ROD, { down: true }); g.set(C, 5, 16, ROD, { down: true });
  g.set(3, 2, 12, 'brewing_stand');
  // the cabin at the stern
  for (let y = 7; y <= 10; y++) ring(g, 2, 0, 8, 5, y, PUR);
  g.air(3, 7, 1, 7, 10, 4);
  corners(g, 2, 0, 8, 5, 7, 10, PIL, UP);
  g.fill(2, 11, 0, 8, 11, 5, PUR);
  corners(g, 2, 0, 8, 5, 12, 12, ROD, { up: true });
  g.air(4, 7, 0, 6, 9, 0);
  g.air(C, 7, 5, C, 8, 5);
  g.fill(2, 8, 2, 2, 9, 3, GL); g.fill(8, 8, 2, 8, 9, 3, GL);
  g.set(C, 10, 2, ROD, { down: true });
  // the mast and its yards
  g.fill(C, 7, 13, C, 20, 13, PIL, UP);
  g.fill(1, 12, 13, 9, 12, 13, PIL, { axis: 'x' });
  g.fill(2, 17, 13, 8, 17, 13, PIL, { axis: 'x' });
  for (const [x, y] of [[1, 13], [9, 13], [2, 18], [8, 18], [C, 21]]) g.set(x, y, 13, ROD, { up: true });
  // the dragon head on the bow, facing out over it
  g.set(C, DECK + 1, 26, 'dragon_head', (SOUTH + o.rot) & 3);
  g.entity('item_frame', C, 3, 19, { item: 'elytra', facing: (NORTH + o.rot) & 3 });
  g.entity('shulker', 3, DECK + 1, 9);
  g.entity('shulker', 7, DECK + 1, 18);
  g.entity('shulker', C, 2, 15);
  g.entity('shulker', 6, 7, 2);
  g.chest(3, 2, 5, 'end_city_treasure', SOUTH);
  g.chest(7, 2, 5, 'end_city_treasure', SOUTH);
}

/* -------------------------------------------------------------- layout -- */
// a Build running out along +z from (ax, az), centred across on it: frame SOUTH becomes world direction dir
function along(ax, y0, az, dir, w, h, d, draw, opts) {
  const rot = (dir + 2) & 3, hx = w >> 1;
  let px = hx, pz = 0;
  if (rot === 1) { px = d - 1; pz = hx; } else if (rot === 2) { px = w - 1 - hx; pz = d - 1; } else if (rot === 3) { px = 0; pz = w - 1 - hx; }
  opts.rot = rot;
  return new Build('end_city', ax - px, y0, az - pz, w, h, d, rot, draw, opts);
}

export function endCity(ctx) {
  const r = ctx.r, P = ctx.point;
  const lx = (ctx.cx - REACH) * 16, hx = (ctx.cx + REACH + 1) * 16 - 1;
  const lz = (ctx.cz - REACH) * 16, hz = (ctx.cz + REACH + 1) * 16 - 1;
  const out = [], boxes = [], towers = [];
  const hit = (a, b, m) => a.x0 - m <= b.x1 && a.x1 + m >= b.x0 && a.z0 - m <= b.z1 && a.z1 + m >= b.z0 && a.y0 - m <= b.y1 && a.y1 + m >= b.y0;
  const fits = (b, m) => b.x0 >= lx && b.x1 <= hx && b.z0 >= lz && b.z1 <= hz && b.y1 < 300 && !boxes.some(o => hit(o, b, m));
  const add = p => { out.push(p); boxes.push(p.box); };
  let fat = 0, bridges = 0;

  // a tower whose first storey's floor is at y0, its shaft's corner at (x0, z0)
  function tower(x0, z0, y0, S, segs, base, from) {
    const so = { S, segs, base, doors: [], guard: 1 + r.nextInt(segs - 1) };
    const ho = { S, loot: S > 7, guards: 1 + r.nextInt(2) };
    const shaft = new Build('end_city', x0, y0 - base, z0, S, segs * SEG + base, S, 0, drawShaft, so);
    const hat = new Build('end_city', x0 - 2, y0 + segs * SEG, z0 - 2, S + 4, 8, S + 4, 0, drawHat, ho);
    return { x0, z0, y0, S, segs, so, ho, shaft, hat, from };
  }
  function commitTower(t) { add(t.shaft); add(t.hat); towers.push(t); }

  // a bridge out of storey s of tower t towards f, and what is at its end; false if it does not fit
  function bridge(t, s, f, depth, ship) {
    const c = t.S >> 1, y = t.y0 + s * SEG;
    const ax = f === EAST ? t.x0 + t.S : f === WEST ? t.x0 - 1 : t.x0 + c;
    const az = f === SOUTH ? t.z0 + t.S : f === NORTH ? t.z0 - 1 : t.z0 + c;
    const flat1 = 2 + r.nextInt(3), rise = ship ? r.nextInt(3) : r.nextFloat() < 0.7 ? 3 + r.nextInt(6) : 0, flat2 = 2 + r.nextInt(4);
    const len = flat1 + rise + flat2, prof = [];
    let h = 0;
    for (let i = 0; i < len; i++) {
      const step = i >= flat1 && i < flat1 + rise;
      if (step) h++;
      prof.push({ y: h, step });
    }
    const br = along(ax, y - 1, az, f, 5, rise + 3, len, drawBridge, { prof });
    if (!fits(br.box, 0)) return false;
    const ex = ax + DX[f] * len, ez = az + DZ[f] * len, ey = y + rise;
    if (ship) {
      const sh = along(ex, ey - DECK, ez, f, 11, 22, 27, drawShip, {});
      if (!fits(sh.box, 1)) return false;
      add(br); add(sh);
      t.so.doors.push({ f, s });
      return true;
    }
    const S = depth >= 1 && fat < 2 && r.nextFloat() < 0.4 ? 11 : 7, segs = 3 + r.nextInt(3), k = S >> 1;
    const nt = tower(ex + DX[f] * k - k, ez + DZ[f] * k - k, ey, S, segs, 3, opp(f));
    if (!fits(nt.shaft.box, 1) || !fits(nt.hat.box, 1)) return false;
    add(br);
    t.so.doors.push({ f, s });
    nt.so.doors.push({ f: opp(f), s: 0 });
    commitTower(nt);
    if (S > 7) fat++;
    bridges++;
    grow(nt, depth + 1);
    return true;
  }
  // bridges out of a tower's storeys (never the top one, which the hat overhangs)
  function grow(t, depth) {
    for (let s = 1; s <= t.segs - 2; s++) {
      if (depth >= 3 || bridges >= 7) return;
      if (r.nextFloat() >= (depth ? 0.45 : 0.75)) continue;
      const order = DIRS.slice();
      for (let i = 3; i > 0; i--) { const j = r.nextInt(i + 1); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      for (const f of order) if (f !== t.from && bridge(t, s, f, depth, false)) break;
    }
  }

  // the house on the island, then the first tower on its roof
  const n = 2 + r.nextInt(2);
  const house = new Build('end_city', P.x - 6, P.y, P.z - 6, 13, n * HOUSE + 2, 13, 0, drawHouse, { n, door: (P.rot || 0) & 3, guard: r.nextBoolean() });
  add(house);
  const main = tower(P.x - 3, P.z - 3, P.y + n * HOUSE, 7, 4 + r.nextInt(3), 0, -1);
  main.so.doors.push({ f: SOUTH, s: 0 });
  out.push(main.shaft); out.push(main.hat);
  boxes.push(main.hat.box);
  towers.push(main);
  // the shaft sits in the house's roof: keep it out of the list until the house is checked against
  boxes.push({ x0: P.x - 3, y0: P.y + n * HOUSE + 2, z0: P.z - 3, x1: P.x + 3, y1: P.y + n * HOUSE + main.segs * SEG - 1, z1: P.z + 3 });
  const wantShip = r.nextBoolean();
  grow(main, 0);
  // the ship, moored off the highest tower that has room for it
  if (wantShip) {
    const list = towers.slice().sort((a, b) => (b.y0 + b.segs * SEG) - (a.y0 + a.segs * SEG));
    let done = false;
    for (const t of list) {
      for (const f of DIRS) if (f !== t.from && bridge(t, t.segs - 1, f, 9, true)) { done = true; break; }
      if (done) break;
    }
  }
  // without a fat tower the last tower out keeps the loot
  if (!fat) towers[towers.length - 1].ho.loot = true;
  return out;
}
