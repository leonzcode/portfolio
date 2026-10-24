/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the ocean ones.

   Shipwrecks: a wooden sailing ship 9 wide and 28 long with a keel of logs,
   a rounded plank hull, a raised forecastle at the bow, a captain's cabin
   at the stern and two masts. The ship is first laid out as a small model
   (a list of cells), then turned into its variant: upright, upside down or
   lying on its side, whole or only the front or back half, sometimes with
   its masts snapped off and holes rotted through. It rests on the ocean
   floor a block or two into the silt, flooded. Three chests: supplies in
   the bow hold, the map in the cabin, the treasure in the hold under it.
   The beached kind is the same ship, upright, run aground at the shore
   with its lower rows in the sand and air above the sea.

   Ocean ruins: broken rooms of stone bricks (cold) or sandstone (warm) on
   the sea floor. A small ruin is one room with low walls and a gap or two,
   sometimes a pillar, an arch or part of a roof; a big ruin (three in ten)
   is a walled yard of rooms around a raised middle chamber, often with a
   cluster of small ruins scattered round it. Suspicious gravel or sand in
   the floors, the odd magma block, a drowned or two, and a lot of the
   stonework fallen away.

   Ocean monument: 58 x 58 and 23 tall, its floor at y 39 on prismarine
   legs. A low outer hall with two tall wings at the back, a gateway at the
   front, a raised middle storey with the penthouse on top, the gold core
   (eight gold blocks cased in dark prismarine) under it, wet sponge rooms,
   sea lanterns all round, three elder guardians (penthouse and wings) and
   guardians about. The whole inside is flooded.

   Every model is worked out from the plan's choices alone (passed in opts)
   and per-cell decay comes from a hash of the cell, so each chunk a box
   crosses draws the same thing in the same order.
--------------------------------------------------------------------------- */
import { NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { make, footprint, turned, rect, overlaps, rng } from './util.js?v=107';
import { BLOCKS } from '../../blocks.js?v=107';
import { JRand, mthSeed } from '../rand.js?v=107';

export const PLANS = {};

const SEA = 62;                 // the top water block

/* ------------------------------------------------------------ helpers -- */
// a well mixed number in [0, 1) for a cell (decay that does not depend on drawing order)
function noise(seed, x, y, z) {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(x | 0, 0x165667b1) ^ Math.imul(y | 0, 0x1b873593) ^ Math.imul(z | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// a block the sea floor is made of (kept when it sits in a hold or a room: silt)
function solidAt(g, x, y, z) {
  const b = g.get(x, y, z);
  return b !== 0 && BLOCKS[b] && BLOCKS[b].solid && !BLOCKS[b].fluid;
}
// a 32-bit seed for a plan's own random, from the start's random
const seed32 = r => r.nextInt();

// a model: cells by position, each [x, y, z, name, state]; OPEN is the inside (water below the sea, air above)
const OPEN = '#open';
class Model {
  constructor() { this.m = new Map(); this.chests = []; this.ents = []; }
  key(x, y, z) { return ((x + 256) * 1024 + (y + 256)) * 1024 + (z + 256); }
  set(x, y, z, name, state) { this.m.set(this.key(x, y, z), [x, y, z, name, state]); }
  get(x, y, z) { const c = this.m.get(this.key(x, y, z)); return c ? c[3] : null; }
  del(x, y, z) { this.m.delete(this.key(x, y, z)); }
  fill(x0, y0, z0, x1, y1, z1, name, state) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, name, state);
  }
  chest(x, y, z, table, f) { this.chests.push([x, y, z, table, f]); }
  bounds() {
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    const all = [...this.m.values(), ...this.chests];
    for (const c of all) {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      if (c[2] < z0) z0 = c[2]; if (c[2] > z1) z1 = c[2];
    }
    return { x0, y0, z0, x1, y1, z1 };
  }
  // a new model with every cell moved through f(x, y, z, name, state) -> [x, y, z, name, state] or null
  map(f, fc) {
    const o = new Model();
    for (const c of this.m.values()) { const n = f(...c); if (n) o.set(...n); }
    for (const c of this.chests) { const n = fc ? fc(...c) : c; if (n) o.chests.push(n); }
    o.ents = this.ents.slice();
    return o;
  }
  // moved so its smallest corner is at 0, 0, 0
  normal() {
    const b = this.bounds();
    const o = this.map((x, y, z, n, s) => [x - b.x0, y - b.y0, z - b.z0, n, s], (x, y, z, t, f) => [x - b.x0, y - b.y0, z - b.z0, t, f]);
    o.ents = this.ents.map(e => [e[0], e[1] - b.x0, e[2] - b.y0, e[3] - b.z0]);
    o.size = [b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, b.z1 - b.z0 + 1];
    return o;
  }
}
// draw a model: OPEN cells become water up to the sea (air above), but floor
// blocks already there at or under `silt` (world y) stay, filling the bottom
function drawModel(g, model, y0, silt) {
  for (const c of model.m.values()) {
    const [x, y, z, name, state] = c;
    if (name === OPEN) {
      const wy = y0 + y;
      if (wy <= silt && solidAt(g, x, y, z)) continue;
      g.set(x, y, z, wy <= SEA ? 'water' : 'air');
    } else {
      g.set(x, y, z, name, state);
      // a suspicious block on a ruin's floor holds the ruin's archaeology table (gravel the cold ruins', sand the warm
      // ones'); its loot seed drawn as the game's rule processor draws it, from a random of its place
      if ((name === 'suspicious_gravel' || name === 'suspicious_sand') && g.inside(x, y, z)) {
        const [X, Y, Z] = g.world(x, y, z), r = new JRand(mthSeed(X, Y, Z));
        r.nextFloat();
        g.wr.chest(X, Y, Z, name === 'suspicious_sand' ? 'archaeology/ocean_ruin_warm' : 'archaeology/ocean_ruin_cold', String(r.nextLong()));
      }
    }
  }
  if (model.feet) for (const [x, z, name] of model.feet) g.down(x, -1, z, name);
  for (const [x, y, z, table, f] of model.chests) g.chest(x, y, z, table, f);
  for (const [type, x, y, z] of model.ents) g.entity(type, x, y, z);
}
// a few models kept for the boxes that draw them chunk after chunk
const cache = new Map();
function cached(key, makeIt) {
  let m = cache.get(key);
  if (!m) {
    if (cache.size > 24) cache.clear();
    m = makeIt();
    cache.set(key, m);
  }
  return m;
}

/* ========================================================= shipwrecks == */
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'dark_oak', 'acacia'];
const SHIP_L = 28;
// half the width of the hull at deck height, along the ship (bow at z 0, bowsprit first)
const HW = z => (z < 2 ? -1 : z < 4 ? 1 : z < 6 ? 2 : z < 8 ? 3 : 4);
// the lowest row of the hull (the bow and stern rake up)
const BOT = z => (z === 2 ? 4 : z === 3 ? 3 : z === 4 ? 2 : z === 27 ? 3 : z === 26 ? 2 : 1);
// the deck: raised over the forecastle
const DECK = z => (z <= 7 ? 6 : 5);

/* The whole ship upright: x 0..8 across (centre 4), y 0 the keel, z 0..27 bow to stern. */
function shipModel(o) {
  const m = new Model();
  const wd = o.wood;
  const P = wd + '_planks', LOG = wd + '_log', ST = wd + '_stairs', SL = wd + '_slab', FE = wd + '_fence', TD = wd + '_trapdoor';
  // keel
  for (let z = 3; z <= 26; z++) m.set(4, 0, z, LOG, { axis: 'z' });
  // hull, row by row along the ship
  for (let z = 2; z < SHIP_L; z++) {
    const hw = HW(z), b = BOT(z), dk = DECK(z);
    const top = z >= 20 ? 5 : dk;
    for (let y = b; y <= top; y++) {
      const hy = y === b ? Math.max(hw - 2, 0) : y === b + 1 ? Math.max(hw - 1, 0) : hw;
      for (let dx = -hy; dx <= hy; dx++) {
        const x = 4 + dx, edge = Math.abs(dx) === hy;
        if (z === 2 || z === SHIP_L - 1) m.set(x, y, z, P);                          // bow cap, transom
        else if (y === b) m.set(x, y, z, P);                                         // bottom
        else if (y === dk) m.set(x, y, z, P);                                        // deck (and its edge)
        else if (edge) m.set(x, y, z, y === 3 && hy === hw ? LOG : P, y === 3 && hy === hw ? { axis: 'z' } : 0);
        else m.set(x, y, z, OPEN);
      }
      // stairs where the hull rounds in, under the side above
      if (y <= b + 1 && z > 2 && z < SHIP_L - 1) {
        const hu = y === b ? Math.max(hw - 1, 0) : hw;
        if (hu > hy) {
          m.set(4 - hu, y, z, ST, { f: EAST, top: true });
          m.set(4 + hu, y, z, ST, { f: WEST, top: true });
        }
      }
    }
  }
  // the bow: a forecastle rail and the bowsprit
  for (let z = 2; z <= 7; z++) {
    const hw = HW(z);
    m.set(4 - hw, 7, z, FE); m.set(4 + hw, 7, z, FE);
    if (z === 2) m.set(4, 7, z, FE);
  }
  for (let dx = -3; dx <= 3; dx++) m.set(4 + dx, 6, 8, ST, { f: NORTH });                   // steps up to the forecastle
  m.set(4, 6, 1, LOG, { axis: 'z' }); m.set(4, 7, 0, LOG, { axis: 'z' });
  // the main deck's rail, the hatch and a bulkhead in the hold
  for (let z = 9; z <= 19; z++) { m.set(0, 6, z, z % 3 === 0 ? P : FE); m.set(8, 6, z, z % 3 === 0 ? P : FE); }
  for (const z of [14, 15]) for (const x of [3, 4]) m.set(x, 5, z, OPEN);
  m.set(5, 5, 14, TD, { f: WEST, open: true });
  for (let dx = -3; dx <= 3; dx++) for (let y = 2; y <= 4; y++) if (!(dx === 0 && y < 4)) m.set(4 + dx, y, 19, P);
  for (let dx = -2; dx <= 2; dx++) for (let y = 2; y <= 4; y++) if (!(dx === 0 && y < 4)) m.set(4 + dx, y, 8, P);
  // the captain's cabin at the stern
  for (let z = 20; z <= 27; z++) for (let y = 6; y <= 8; y++) for (let x = 0; x <= 8; x++) {
    const wall = x === 0 || x === 8 || z === 20 || z === 27;
    m.set(x, y, z, wall ? P : OPEN);
  }
  for (const z of [22, 24]) { m.set(0, 7, z, OPEN); m.set(8, 7, z, OPEN); }            // windows
  m.set(2, 7, 27, OPEN); m.set(6, 7, 27, OPEN);
  m.set(4, 6, 20, OPEN); m.set(4, 7, 20, OPEN);                                    // the door
  for (let x = 0; x <= 8; x++) for (let z = 20; z <= 27; z++) m.set(x, 9, z, P);   // its roof
  for (let x = 0; x <= 8; x++) { m.set(x, 9, 19, ST, { f: SOUTH, top: true }); m.set(x, 10, 27, FE); }
  for (let z = 20; z <= 27; z++) { m.set(0, 10, z, FE); m.set(8, 10, z, FE); }
  m.set(1, 6, 26, ST, { f: WEST }); m.set(7, 6, 26, SL, { slab: 1 });             // a seat and a table
  m.set(7, 6, 21, TD, { f: WEST, top: true });
  // masts, yards, a crow's nest; a snapped mast stops short
  const main = o.broken ? 7 + o.cut : 18, fore = o.broken ? 8 + (o.cut >> 1) : 14;
  for (let y = 2; y <= main; y++) m.set(4, y, 12, LOG);
  for (let y = 2; y <= fore; y++) m.set(4, y, 5, LOG);
  if (main >= 15) {
    for (let x = 1; x <= 7; x++) m.set(x, 15, 12, LOG, { axis: 'x' });
    m.set(1, 14, 12, FE); m.set(7, 14, 12, FE);
    for (let x = 3; x <= 5; x++) for (let z = 11; z <= 13; z++) if (x !== 4 || z !== 12) m.set(x, 16, z, SL, { slab: 0 });
  }
  if (main >= 11) for (let x = 2; x <= 6; x++) m.set(x, 11, 12, LOG, { axis: 'x' });
  if (fore >= 12) for (let x = 2; x <= 6; x++) m.set(x, 12, 5, LOG, { axis: 'x' });
  if (o.broken) for (let x = 1; x <= 7; x++) m.set(x, 6, 16, LOG, { axis: 'x' });   // the top half, fallen across the deck
  // chests
  m.chest(4, 2, 6, 'shipwreck_supply', SOUTH);
  m.chest(4, 6, 25, 'shipwreck_map', NORTH);
  m.chest(4, 2, 23, 'shipwreck_treasure', NORTH);
  return m;
}

// the ship in its variant, normalised
function shipVariant(o) {
  let m = shipModel(o);
  const S = o.seed;
  // half a ship: a ragged break amidships
  if (o.part === 'front') m = m.map((x, y, z, n, s) => (z <= 12 || (z <= 15 && noise(S, x, y, z) < (16 - z) / 4) ? [x, y, z, n, s] : null), (x, y, z, t, f) => (z <= 12 ? [x, y, z, t, f] : null));
  else if (o.part === 'back') m = m.map((x, y, z, n, s) => (z >= 15 || (z >= 12 && noise(S, x, y, z) < (z - 11) / 4) ? [x, y, z, n, s] : null), (x, y, z, t, f) => (z >= 15 ? [x, y, z, t, f] : null));
  // rot: holes through the hull and deck (never the keel or the chests)
  if (o.decay > 0) m = m.map((x, y, z, n, s) => (y > 0 && !n.endsWith('_log') && noise(S + 7, x, y, z) < o.decay * (0.6 + y / 12) ? null : [x, y, z, n, s]));
  if (o.orient === 'upside') {
    // turned over onto its cabin roof: the masts are gone, all the rest flips
    m = m.map((x, y, z, n, s) => {
      if (y > 10) return null;
      if (s && typeof s === 'object' && (n.endsWith('_stairs') || n.endsWith('_trapdoor'))) s = Object.assign({}, s, { top: !s.top });
      else if (s && s.slab !== undefined) s = { slab: s.slab === 2 ? 2 : 1 - s.slab };
      return [x, 10 - y, z, n, s];
    }, (x, y, z, t, f) => [x, 10 - y, z, t, f]);
  } else if (o.orient === 'side') {
    // rolled onto its side: what was up runs across, stairs and slabs are just planks now
    const P = o.wood + '_planks';
    m = m.map((x, y, z, n, s) => {
      if (y > 11) return null;
      if (n.endsWith('_trapdoor')) return null;
      if (n.endsWith('_stairs') || n.endsWith('_slab')) { n = P; s = 0; }
      if (n.endsWith('_log')) s = { axis: !s || !s.axis || s.axis === 'y' ? 'x' : s.axis === 'x' ? 'y' : 'z' };
      return o.flip ? [y, x, z, n, s] : [11 - y, 8 - x, z, n, s];
    }, (x, y, z, t, f) => (o.flip ? [y, x, z, t, f] : [11 - y, 8 - x, z, t, f]));
  }
  return m.normal();
}

function shipwreck(ctx, beached) {
  const r = ctx.r;
  const o = {
    seed: seed32(r),
    wood: r.pick(WOODS),
    orient: 'upright', part: 'full', decay: 0, broken: false, cut: 0, flip: r.nextBoolean(),
  };
  const roll = r.nextFloat();
  if (!beached) o.orient = roll < 0.5 ? 'upright' : roll < 0.75 ? 'upside' : 'side';
  const pr = r.nextFloat();
  o.part = pr < 0.55 ? 'full' : pr < 0.78 ? 'front' : 'back';
  if (r.nextFloat() < 0.4) o.decay = 0.08 + r.nextFloat() * 0.08;
  o.broken = r.nextFloat() < 0.5;
  o.cut = r.nextInt(4);
  const rot = r.nextInt(4);
  const key = 'ship:' + JSON.stringify(o);
  const model = cached(key, () => shipVariant(o));
  const [w, h, d] = model.size;
  const [W, D] = turned(w, d, rot);
  const cx = ctx.point.x, cz = ctx.point.z;
  const fp = footprint(ctx, cx - (W >> 1), cz - (D >> 1), W, D, 2);
  const floor = beached ? Math.max(fp.med, SEA - 1) : fp.med;           // aground: the deck just clear of the sea
  const sink = beached ? 3 : o.orient === 'upside' ? 1 : 2;
  const y0 = floor - sink;
  const opts = { y0, silt: beached ? floor + 1 : floor, ship: o, key };
  return [make(ctx.type, cx, y0, cz, w, h, d, rot, (g, op) => {
    drawModel(g, cached(op.key, () => shipVariant(op.ship)), op.y0, op.silt);
  }, opts)];
}

PLANS.shipwreck = ctx => shipwreck(ctx, false);
PLANS.shipwreck_beached = ctx => shipwreck(ctx, true);

/* ======================================================= ocean ruins == */
const RUIN = {
  cold: {
    wall: ['stone_bricks', 'stone_bricks', 'stone_bricks', 'mossy_stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks'],
    accent: 'chiseled_stone_bricks', stairs: ['stone_brick_stairs', 'mossy_stone_brick_stairs'], slab: ['stone_brick_slab', 'mossy_stone_brick_slab'],
    top: 'mossy_stone_brick_wall', sus: 'suspicious_gravel', loose: 'gravel',
  },
  warm: {
    wall: ['sandstone', 'sandstone', 'sandstone', 'cut_sandstone', 'cut_sandstone', 'smooth_sandstone'],
    accent: 'chiseled_sandstone', stairs: ['sandstone_stairs', 'smooth_sandstone_stairs'], slab: ['sandstone_slab', 'cut_sandstone_slab'],
    top: 'sandstone_wall', sus: 'suspicious_sand', loose: 'sand',
  },
};
const SMALL_KINDS = ['room', 'room', 'house', 'arch', 'pillars'];

// the pen a ruin is laid out with: stone picked per cell, floors, walls, open insides
function ruinKit(o) {
  const m = new Model(), P = RUIN[o.style], S = o.seed;
  m.feet = [];
  const pickOf = (list, salt) => (x, y, z) => list[Math.floor(noise(S + salt, x, y, z) * list.length)];
  const k = {
    m, P,
    mat: pickOf(P.wall, 1), stairs: pickOf(P.stairs, 2), slab: pickOf(P.slab, 3),
    floor(x0, z0, x1, z1) {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        // the odd patch of loose gravel or sand among the flags
        m.set(x, 0, z, noise(S + 4, x, 0, z) < 0.12 ? P.loose : k.mat(x, 0, z));
        m.feet.push([x, z, k.mat(x, -1, z)]);
      }
    },
    wall(x0, y0, z0, x1, y1, z1) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) m.set(x, y, z, k.mat(x, y, z));
    },
    open(x0, y0, z0, x1, y1, z1) { m.fill(x0, y0, z0, x1, y1, z1, OPEN); },
    // a room: walls round a rectangle, open inside
    room(x0, z0, x1, z1, y0, y1) {
      k.open(x0 + 1, y0, z0 + 1, x1 - 1, y1, z1 - 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) { m.set(x, y, z0, k.mat(x, y, z0)); m.set(x, y, z1, k.mat(x, y, z1)); }
        for (let z = z0; z <= z1; z++) { m.set(x0, y, z, k.mat(x0, y, z)); m.set(x1, y, z, k.mat(x1, y, z)); }
      }
    },
  };
  return k;
}
// fallen stonework: more of it gone the higher it stood; floors keep most of theirs
function ruinDecay(m, o) {
  const p = 1 - o.integ;
  const out = m.map((x, y, z, n, s) => {
    if (n === OPEN) return [x, y, z, n, s];
    const q = y <= 0 ? p * 0.35 : p * (0.55 + y * 0.32);
    return noise(o.seed + 9, x, y, z) < q ? null : [x, y, z, n, s];
  });
  out.feet = m.feet;
  return out;
}
// a few cells of the floor turned to suspicious blocks and magma, away from the walls
function floorFinds(k, rnd, x0, z0, x1, z1, sus, magma) {
  for (let i = 0; i < sus; i++) k.m.set(rnd.between(x0, x1), 0, rnd.between(z0, z1), k.P.sus);
  for (let i = 0; i < magma; i++) k.m.set(rnd.between(x0, x1), 0, rnd.between(z0, z1), 'magma_block');
}

/* A small ruin, w x d: one broken room (sometimes with a roof), an arch, or a stand of pillars. */
function smallRuin(o) {
  const k = ruinKit(o), m = k.m, rnd = rng(o.seed);
  const w = o.w, d = o.d, h = o.wallH, cx = w >> 1;
  k.floor(0, 0, w - 1, d - 1);
  if (o.kind === 'room' || o.kind === 'house') {
    k.room(0, 0, w - 1, d - 1, 1, h);
    // a doorway in the front, a window in a side
    for (let y = 1; y <= 2; y++) { m.set(cx, y, d - 1, OPEN); if (w > 6) m.set(cx - 1, y, d - 1, OPEN); }
    m.set(w - 1, 2, d >> 1, OPEN);
    if (rnd.nextBoolean()) m.set(0, 2, d >> 1, OPEN);
    if (o.kind === 'house') {
      // a gable roof of stairs over the room, ridge along x, gable ends filled
      const half = d >> 1;
      for (let i = 0; i < half; i++) {
        for (let x = 0; x < w; x++) {
          m.set(x, h + 1 + i, i, k.stairs(x, h + 1 + i, i), { f: SOUTH });
          m.set(x, h + 1 + i, d - 1 - i, k.stairs(x, h + 1 + i, d - 1 - i), { f: NORTH });
        }
        for (const gx of [0, w - 1]) for (let z = i + 1; z < d - 1 - i; z++) m.set(gx, h + 1 + i, z, k.mat(gx, h + 1 + i, z));
        for (let x = 1; x < w - 1; x++) for (let z = i + 1; z < d - 1 - i; z++) m.set(x, h + 1 + i, z, OPEN);
      }
      if (d & 1) for (let x = 0; x < w; x++) m.set(x, h + 1 + half, half, k.slab(x, h + 1 + half, half), { slab: 0 });
    } else {
      // corner posts a course higher, capped, and a ledge here and there
      for (const [x, z] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]]) m.set(x, h + 1, z, k.P.accent);
      for (let x = 1; x < w - 1; x++) if (rnd.nextFloat() < 0.4) m.set(x, h, 1, k.slab(x, h, 1), { slab: 1 });
    }
    m.chest(1, 1, 1, 'underwater_ruin_small', SOUTH);
    floorFinds(k, rnd, 1, 1, w - 2, d - 2, 1 + rnd.nextInt(2), rnd.nextInt(2));
  } else if (o.kind === 'arch') {
    // two pillars carrying a lintel, low walls behind and in front
    const z = d >> 1;
    for (const x of [1, w - 2]) { k.wall(x, 1, z, x, 4, z); m.set(x, 5, z, k.P.accent); }
    for (let x = 2; x <= w - 3; x++) m.set(x, 5, z, k.mat(x, 5, z));
    k.open(2, 1, z, w - 3, 4, z);
    m.set(2, 4, z, k.stairs(2, 4, z), { f: WEST, top: true });
    m.set(w - 3, 4, z, k.stairs(w - 3, 4, z), { f: EAST, top: true });
    for (let x = 0; x < w; x++) { m.set(x, 1, 0, k.mat(x, 1, 0)); m.set(x, 1, d - 1, k.mat(x, 1, d - 1)); if (x !== cx) m.set(x, 2, 0, k.mat(x, 2, 0)); }
    for (let zz = 0; zz < d; zz++) { m.set(0, 1, zz, k.mat(0, 1, zz)); m.set(w - 1, 1, zz, k.mat(w - 1, 1, zz)); }
    m.chest(cx, 1, z + 1, 'underwater_ruin_small', NORTH);
    floorFinds(k, rnd, 1, 1, w - 2, d - 2, 1, 1);
  } else {
    // a stand of pillars of different heights, one fallen across the floor
    for (const [x, z] of [[1, 1], [w - 2, 1], [1, d - 2], [w - 2, d - 2]]) {
      const t = 2 + rnd.nextInt(h + 1);
      k.wall(x, 1, z, x, t, z);
      m.set(x, t + 1, z, k.P.accent);
    }
    const fz = d >> 1;
    for (let x = 2; x <= w - 3; x++) m.set(x, 1, fz, k.mat(x, 1, fz));
    for (let x = 0; x < w; x++) if (rnd.nextFloat() < 0.5) m.set(x, 1, 0, k.slab(x, 1, 0), { slab: 0 });
    m.chest(cx, 1, fz + 1, 'underwater_ruin_small', SOUTH);
    floorFinds(k, rnd, 1, 1, w - 2, d - 2, 2, 1);
  }
  if (o.drowned) m.ents.push(['drowned', cx, 1, d >> 1]);
  return ruinDecay(m, o);
}

/* A big ruin, s x s: a walled yard with corner towers, cross walls, and a
   raised chamber in the middle reached by steps. */
function bigRuin(o) {
  const k = ruinKit(o), m = k.m, rnd = rng(o.seed);
  const s = o.w, c0 = (s - 7) >> 1, c1 = c0 + 6, mid = c0 + 3;
  k.floor(0, 0, s - 1, s - 1);
  k.room(0, 0, s - 1, s - 1, 1, 4);
  k.open(1, 5, 1, s - 2, 6, s - 2);
  // gateways front and back, windows in the sides
  for (const z of [0, s - 1]) for (let x = mid - 1; x <= mid + 1; x++) for (let y = 1; y <= 3; y++) m.set(x, y, z, OPEN);
  for (const x of [0, s - 1]) for (const z of [3, s - 4]) m.set(x, 3, z, OPEN);
  // corner towers
  for (const [x0, z0] of [[0, 0], [s - 2, 0], [0, s - 2], [s - 2, s - 2]]) {
    k.wall(x0, 1, z0, x0 + 1, 6, z0 + 1);
    for (let x = x0; x <= x0 + 1; x++) for (let z = z0; z <= z0 + 1; z++) m.set(x, 7, z, (x + z) & 1 ? k.P.top : k.P.accent);
  }
  // cross walls from the chamber to the sides, each with a gap
  for (let x = 1; x < c0; x++) for (let y = 1; y <= 3; y++) m.set(x, y, mid, x === (c0 >> 1) && y < 3 ? OPEN : k.mat(x, y, mid));
  for (let x = c1 + 1; x < s - 1; x++) for (let y = 1; y <= 3; y++) m.set(x, y, mid, x === ((c1 + s) >> 1) && y < 3 ? OPEN : k.mat(x, y, mid));
  // the raised chamber
  k.wall(c0, 1, c0, c1, 2, c1);
  k.room(c0, c0, c1, c1, 3, 6);
  for (const [x, z] of [[c0, c0], [c1, c0], [c0, c1], [c1, c1]]) for (let y = 3; y <= 7; y++) m.set(x, y, z, k.P.accent);
  for (let x = c0 + 1; x < c1; x++) for (let z = c0 + 1; z < c1; z++) m.set(x, 7, z, k.slab(x, 7, z), { slab: 0 });
  for (let x = mid - 1; x <= mid + 1; x++) { m.set(x, 3, c0, OPEN); if (x === mid) m.set(x, 4, c0, OPEN); }
  m.set(mid - 1, 4, c0, k.stairs(mid - 1, 4, c0), { f: WEST, top: true });
  m.set(mid + 1, 4, c0, k.stairs(mid + 1, 4, c0), { f: EAST, top: true });
  // steps up to it
  for (let x = mid - 1; x <= mid + 1; x++) {
    m.set(x, 1, c0 - 2, k.stairs(x, 1, c0 - 2), { f: SOUTH });
    m.set(x, 1, c0 - 1, k.mat(x, 1, c0 - 1));
    m.set(x, 2, c0 - 1, k.stairs(x, 2, c0 - 1), { f: SOUTH });
  }
  m.chest(mid, 3, c1 - 1, 'underwater_ruin_big', NORTH);
  if (rnd.nextBoolean()) m.chest(1, 1, s - 2, 'underwater_ruin_small', NORTH);
  // finds in the yard floor (front strip and back strip)
  floorFinds(k, rnd, 1, 1, s - 2, c0 - 3, 2, 1);
  floorFinds(k, rnd, 1, c1 + 1, s - 2, s - 2, 2, 2);
  m.ents.push(['drowned', 2, 1, 2]);
  if (o.drowned) m.ents.push(['drowned', s - 3, 1, s - 3]);
  return ruinDecay(m, o);
}

// one ruin as a box centred on (cx, cz), its floor laid at the middle height of the sea bed under it
function ruinPiece(ctx, o, cx, cz, rot) {
  const [W, D] = turned(o.w, o.d, rot);
  const fp = footprint(ctx, cx - (W >> 1), cz - (D >> 1), W, D, 2);
  const y0 = fp.med;
  const key = 'ruin:' + JSON.stringify(o);
  return make(ctx.type, cx, y0, cz, o.w, o.h, o.d, rot, (g, op) => {
    drawModel(g, cached(op.key, () => (op.ruin.big ? bigRuin(op.ruin) : smallRuin(op.ruin))), op.y0, op.y0);
  }, { y0, ruin: o, key });
}
function smallOpts(r, style) {
  const kind = r.pick(SMALL_KINDS);
  const w = kind === 'arch' ? 5 + 2 * r.nextInt(2) : r.between(5, 8);
  const d = kind === 'arch' ? 5 : r.between(5, 8);
  const wallH = r.between(2, 4);
  const h = kind === 'house' ? wallH + 2 + (d >> 1) : wallH + 3;
  return { style, big: false, kind, w, d, h, wallH, seed: seed32(r), integ: 0.88 + r.nextFloat() * 0.04, drowned: r.nextFloat() < 0.3 };
}

function oceanRuin(ctx, style) {
  const r = ctx.r;
  const cx = ctx.point.x, cz = ctx.point.z;
  const pieces = [];
  if (r.nextFloat() < 0.3) {
    const s = r.between(13, 16);
    const o = { style, big: true, w: s, d: s, h: 8, seed: seed32(r), integ: 0.8 + r.nextFloat() * 0.04, drowned: r.nextBoolean() };
    pieces.push(ruinPiece(ctx, o, cx, cz, r.nextInt(4)));
    // most big ruins have a cluster of small ones scattered round them (kept inside the reach of 3 chunks)
    if (r.nextFloat() < 0.9) {
      const n = r.between(4, 8);
      for (let i = 0, tries = 0; i < n && tries < 40; tries++) {
        const so = smallOpts(r, style), rot = r.nextInt(4);
        const p = ruinPiece(ctx, so, cx + r.between(-26, 26), cz + r.between(-26, 26), rot);
        const b = p.box;
        if ((b.x0 >> 4) < ctx.cx - 3 || (b.x1 >> 4) > ctx.cx + 3 || (b.z0 >> 4) < ctx.cz - 3 || (b.z1 >> 4) > ctx.cz + 3) continue;
        if (pieces.some(q => overlaps(rect(q), rect(p), 3))) continue;
        pieces.push(p);
        i++;
      }
    }
  } else {
    pieces.push(ruinPiece(ctx, smallOpts(r, style), cx, cz, r.nextInt(4)));
  }
  return pieces;
}

PLANS.ocean_ruin_cold = ctx => oceanRuin(ctx, 'cold');
PLANS.ocean_ruin_warm = ctx => oceanRuin(ctx, 'warm');

/* ===================================================== ocean monument == */
/* The monument is big enough (77 000 cells) to keep in a typed grid rather
   than a list: 0 leaves the cell alone, 1 is flooded inside, 2 is outside
   (water only where the sea bed pokes into the box), the rest index a
   palette of blocks. Frame: x 0..57 across, z 0 the front (the gateway)
   to 57 the back, y 0 the floor slab. */
const MW = 58, MH = 23;
const G_OPEN = 1, G_CLEAR = 2;
class Grid {
  constructor(w, h, d) {
    this.w = w; this.h = h; this.d = d;
    this.c = new Uint16Array(w * h * d);
    this.pal = [null, null, null]; this.idx = new Map();
    this.legs = []; this.ents = [];
  }
  code(name, state) {
    const k = name + (state ? JSON.stringify(state) : '');
    let i = this.idx.get(k);
    if (i === undefined) { i = this.pal.length; this.pal.push([name, state || 0]); this.idx.set(k, i); }
    return i;
  }
  set(x, y, z, name, state) {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.d) return;
    this.c[(y * this.d + z) * this.w + x] = name === OPEN ? G_OPEN : this.code(name, state);
  }
  get(x, y, z) {
    const i = this.c[(y * this.d + z) * this.w + x];
    return i < 3 ? (i === G_OPEN ? OPEN : null) : this.pal[i][0];
  }
  fill(x0, y0, z0, x1, y1, z1, name, state) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, name, state);
  }
  // a building: walls of `wall` from y0 to y1 round x0..x1, z0..z1, flooded inside, a roof of `roof` on top at y1 + 1
  block(x0, y0, z0, x1, y1, z1, wall, roof) {
    this.fill(x0, y0, z0, x1, y1, z1, wall);
    this.fill(x0 + 1, y0, z0 + 1, x1 - 1, y1, z1 - 1, OPEN);
    if (roof) this.fill(x0, y1 + 1, z0, x1, y1 + 1, z1, roof);
  }
  // a band of trim round a block's walls at height y, with a sea lantern every `step`
  band(x0, z0, x1, z1, y, name, step) {
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) this.set(x, y, z, step && (x - x0) % step === step >> 1 ? 'sea_lantern' : name);
    for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) this.set(x, y, z, step && (z - z0) % step === step >> 1 ? 'sea_lantern' : name);
  }
  // stairs round the edge of a roof at height y, their tall side in, corners in dark prismarine
  rim(x0, z0, x1, z1, y, sides) {
    sides = sides || 'nesw';
    const S = 'prismarine_brick_stairs';
    if (sides.includes('n')) for (let x = x0; x <= x1; x++) this.set(x, y, z0, S, { f: SOUTH });
    if (sides.includes('s')) for (let x = x0; x <= x1; x++) this.set(x, y, z1, S, { f: NORTH });
    if (sides.includes('w')) for (let z = z0; z <= z1; z++) this.set(x0, y, z, S, { f: EAST });
    if (sides.includes('e')) for (let z = z0; z <= z1; z++) this.set(x1, y, z, S, { f: WEST });
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) this.set(x, y, z, 'dark_prismarine');
  }
}

function monumentModel(o) {
  const g = new Grid(MW, MH, MW), rnd = rng(o.seed);
  const PR = 'prismarine', PB = 'prismarine_bricks', DP = 'dark_prismarine', SL = 'sea_lantern';
  // the sea round it inside the box, and the floor slab
  g.c.fill(G_CLEAR, MW * MW, g.c.length);
  g.fill(0, 0, 0, MW - 1, 0, MW - 1, PB);
  for (let x = 0; x < MW; x += 3) for (const z of [0, MW - 1]) g.set(x, 0, z, DP);
  for (let z = 0; z < MW; z += 3) for (const x of [0, MW - 1]) g.set(x, 0, z, DP);
  // legs down to the sea bed: a 2 x 2 pillar every seven blocks
  for (let x = 0; x < MW; x++) for (let z = 0; z < MW; z++) {
    const lx = x % 7 < 2 || x >= MW - 2, lz = z % 7 < 2 || z >= MW - 2;
    if (lx && lz) g.legs.push([x, z]);
  }

  /* -- front halls, either side of the gateway: low, one storey -- */
  for (const [x0, x1] of [[0, 21], [36, 57]]) {
    g.block(x0, 1, 0, x1, 7, 21, PR, PB);
    g.band(x0, 0, x1, 21, 4, DP, 5);
    g.rim(x0, 0, x1, 21, 8, x0 === 0 ? 'nw' : 'ne');
    for (let x = x0 + 5; x < x1 - 2; x += 6) for (let z = 5; z < 20; z += 6) { g.fill(x, 1, z, x, 6, z, PB); g.set(x, 7, z, SL); }
    // doors through to the gateway hall
    g.fill(x0 === 0 ? 21 : 35, 1, 9, x0 === 0 ? 22 : 36, 3, 11, OPEN);
  }
  /* -- the gateway: a tall hall with a pitched roof and a framed arch -- */
  g.block(22, 1, 0, 35, 11, 21, PR, null);
  for (let i = 0; i < 7; i++) {
    g.fill(22 + i, 12 + i, 0, 22 + i, 12 + i, 21, 'prismarine_stairs', { f: EAST });
    g.fill(35 - i, 12 + i, 0, 35 - i, 12 + i, 21, 'prismarine_stairs', { f: WEST });
    if (i < 6) for (const z of [0, 21]) g.fill(23 + i, 12 + i, z, 34 - i, 12 + i, z, PB);
    g.fill(23 + i, 12 + i, 1, 34 - i, 12 + i, 20, OPEN);
  }
  g.fill(28, 18, 0, 29, 18, 21, DP);
  g.band(22, 0, 35, 21, 6, DP, 4);
  g.fill(24, 1, 0, 24, 9, 0, DP); g.fill(33, 1, 0, 33, 9, 0, DP); g.fill(24, 9, 0, 33, 9, 0, DP);
  g.fill(25, 1, 0, 32, 8, 0, OPEN);
  g.set(24, 10, 0, SL); g.set(33, 10, 0, SL);
  for (const x of [25, 32]) for (const z of [5, 10, 15]) { g.fill(x, 1, z, x, 11, z, PB); g.set(x, 6, z, SL); }

  /* -- the back: two wings and the main body between them -- */
  for (const [x0, x1] of [[0, 13], [44, 57]]) {
    g.block(x0, 1, 22, x1, 13, 57, PR, PB);
    g.band(x0, 22, x1, 57, 5, DP, 4);
    g.band(x0, 22, x1, 57, 10, PB, 0);
    g.rim(x0, 22, x1, 57, 14, x0 === 0 ? 'nws' : 'nes');
    // the wing's altar and its elder guardian
    const ax = x0 + 5;
    g.fill(ax, 1, 37, ax + 3, 1, 40, DP);
    g.fill(ax + 1, 2, 38, ax + 2, 3, 39, PB);
    for (const [x, z] of [[ax, 37], [ax + 3, 37], [ax, 40], [ax + 3, 40]]) g.fill(x, 2, z, x, 3, z, SL);
    g.fill(ax, 4, 37, ax + 3, 4, 40, DP);
    g.ents.push(['elder_guardian', ax + 1, 7, 38], ['guardian', ax + 1, 3, 28], ['guardian', ax + 2, 3, 50]);
    // a roof-top crest of dark prismarine with lanterns
    for (let z = 26; z <= 53; z += 1) g.set(x0 + 7 - (x0 === 0 ? 0 : 1), 15, z, z % 4 === 1 ? SL : DP);
    // doors into the body
    g.fill(x0 === 0 ? 13 : 43, 1, 38, x0 === 0 ? 14 : 44, 3, 40, OPEN);
    g.fill(x0 === 0 ? 13 : 43, 8, 31, x0 === 0 ? 14 : 44, 10, 33, OPEN);
  }
  g.block(14, 1, 22, 43, 13, 57, PR, PB);
  g.band(14, 22, 43, 57, 5, DP, 0);
  g.rim(14, 22, 43, 57, 14, 'ns');
  // two floors of rooms: walls every seven blocks with a doorway in each
  const xs = [14, 21, 28, 35, 43], zs = [22, 29, 36, 43, 50, 57];
  g.fill(15, 7, 23, 42, 7, 56, PB);
  for (const y0 of [1, 8]) {
    const y1 = y0 === 1 ? 6 : 13;
    for (const x of xs.slice(1, -1)) for (let z = 23; z <= 56; z++) for (let y = y0; y <= y1; y++) g.set(x, y, z, (z - 22) % 7 >= 2 && (z - 22) % 7 <= 4 && y < y0 + 3 ? OPEN : PB);
    for (const z of zs.slice(1, -1)) for (let x = 15; x <= 42; x++) for (let y = y0; y <= y1; y++) g.set(x, y, z, (x - 14) % 7 >= 2 && (x - 14) % 7 <= 4 && y < y0 + 3 ? OPEN : PB);
  }
  // the hall behind the gateway runs straight through the first row of rooms
  g.fill(22, 1, 23, 34, 6, 28, OPEN);
  g.fill(24, 1, 21, 33, 6, 22, OPEN);
  // shafts up through the middle floor
  for (const [x, z] of [[17, 25], [39, 25], [17, 53], [39, 53]]) g.fill(x, 7, z, x + 1, 7, z + 1, OPEN);
  // sponge rooms: three of the lower rooms with wet sponge across their ceilings
  const cells = [];
  for (let i = 0; i < 4; i++) for (let j = 1; j < 5; j++) if (!((i === 1 || i === 2) && j === 1)) cells.push([i, j]);
  for (let n = 0; n < 3; n++) {
    const [i, j] = cells.splice(rnd.nextInt(cells.length), 1)[0];
    const x0 = xs[i] + 1, x1 = xs[i + 1] - 1, z0 = zs[j] + 1, z1 = zs[j + 1] - 1;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (rnd.nextFloat() < 0.75) g.set(x, 6, z, 'wet_sponge');
    for (let k = 0; k < 4; k++) g.set(rnd.nextBoolean() ? x0 - 1 : x1 + 1, 4 + rnd.nextInt(2), rnd.between(z0, z1), 'wet_sponge');
  }
  // the core: eight gold blocks in a case of dark prismarine, in a dark room on the upper floor
  g.fill(22, 8, 36, 35, 13, 50, DP);
  g.fill(23, 8, 37, 34, 13, 49, OPEN);
  for (const z of [36, 50]) g.fill(27, 8, z, 30, 10, z, OPEN);
  for (const [x, z] of [[23, 37], [34, 37], [23, 49], [34, 49]]) { g.set(x, 8, z, SL); g.set(x, 13, z, SL); }
  g.fill(27, 9, 41, 30, 12, 44, DP);
  g.fill(28, 10, 42, 29, 11, 43, 'gold_block');
  for (const [x, z] of [[27, 41], [30, 41], [27, 44], [30, 44]]) g.set(x, 8, z, SL);
  g.ents.push(['guardian', 25, 10, 30], ['guardian', 18, 3, 40], ['guardian', 38, 10, 52]);

  /* -- the upper storey on the body's roof, and the penthouse on top of that -- */
  g.block(18, 15, 26, 39, 17, 53, PR, PB);
  g.band(18, 26, 39, 53, 16, DP, 5);
  g.rim(18, 26, 39, 53, 18);
  g.fill(26, 14, 30, 31, 14, 33, OPEN);                // a way down into the body
  g.block(22, 19, 32, 35, 21, 47, PB, PR);
  g.band(22, 32, 35, 47, 20, DP, 3);
  g.rim(22, 32, 35, 47, 22);
  for (const [x, z] of [[23, 33], [34, 33], [23, 46], [34, 46]]) g.fill(x, 19, z, x, 21, z, DP);
  g.fill(28, 18, 39, 29, 18, 40, OPEN);                // the penthouse floor opens to the storey below
  for (const [x, z] of [[24, 34], [33, 34], [24, 45], [33, 45]]) g.set(x, 18, z, SL);
  g.ents.push(['elder_guardian', 28, 19, 42], ['guardian', 22, 16, 28], ['guardian', 35, 16, 51]);

  // guardians about the gateway and the front halls
  g.ents.push(['guardian', 28, 3, 10], ['guardian', 29, 6, 17], ['guardian', 8, 3, 9], ['guardian', 49, 3, 12]);
  return g;
}

function drawGrid(g, grid) {
  const { w, h, d, c, pal } = grid;
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const i = c[(y * d + z) * w + x];
    if (i === 0) continue;
    if (i === G_OPEN) g.set(x, y, z, 'water');
    else if (i === G_CLEAR) { if (solidAt(g, x, y, z)) g.set(x, y, z, 'water'); }
    else g.set(x, y, z, pal[i][0], pal[i][1]);
  }
  for (const [x, z] of grid.legs) g.down(x, -1, z, 'prismarine');
  for (const [type, x, y, z] of grid.ents) g.entity(type, x, y, z);
}

PLANS.monument = ctx => {
  const r = ctx.r;
  const o = { seed: seed32(r) };
  const rot = r.nextInt(4);
  const y0 = SEA - MH;                                 // the floor at 39, the top at 61, as the game has it
  return [make('monument', ctx.x0 + 9, y0, ctx.z0 + 9, MW, MH, MW, rot, (g, op) => {
    drawGrid(g, cached('monument:' + op.seed, () => monumentModel(op)));
  }, o)];
};
