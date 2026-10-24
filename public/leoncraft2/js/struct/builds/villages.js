/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: villages, in the five styles (plains, desert,
   savanna, snowy, taiga).

   Laid out the way a 1.14+ village reads: a meeting point in the middle (a
   well with the bell hanging under its roof) on a square of path, two to
   four streets running out from it, sometimes a side street off one of
   them, and the buildings standing along both sides of each street with
   their doors on it. Buildings are picked by weight: small, medium and big
   houses (beds for the villagers), one of each job house at most (a job
   site block and that trade's chest), a temple, a library, small and large
   farms (farmland round a water channel, with wheat, carrots, potatoes or
   beetroots) and animal pens. Lamp posts fill the gaps along the streets.

   Every building measures the ground under its footprint when the plan is
   made: the floor goes at the middle height, foundations are filled down
   under it and the hillside cleared above, and a building on ground too
   steep or under water is left out. Street paths follow the ground column
   by column (planks where they cross water).

   The style only changes materials and roofs: gables of stairs in plains
   and taiga, low hipped roofs in savanna and snowy villages, and flat
   sandstone tops in the desert with open doorways.

   Villagers (one per bed), an iron golem by the well and a cat are left as
   entities.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { footprint, overlaps, door, bed, torch, gableZ, gableX, DX, DZ, rng } from './util.js?v=107';

export const PLANS = {};

/* ------------------------------------------------------------ styles -- */
const STYLES = {
  plains: {
    found: 'cobblestone', base: 'cobblestone', wall: 'oak_planks', frame: 'oak_log', floor: 'oak_planks', planks: 'oak_planks',
    roof: 'gable', stairs: 'oak_stairs', slab: 'oak_slab', door: 'oak_door', fence: 'oak_fence', gate: 'oak_fence_gate',
    window: 'glass_pane', trapdoor: 'oak_trapdoor', log: 'oak_log', beds: ['red', 'yellow', 'white', 'blue', 'light_blue'],
    loot: 'village/village_plains_house', crops: ['wheat', 'wheat', 'carrots', 'potatoes', 'beetroots'], pots: ['potted_dandelion', 'potted_poppy', 'potted_red_tulip'],
    well: { rim: 'cobblestone', wall: 'cobblestone', post: 'oak_fence', roof: 'cobblestone_slab' },
    lamp: ['oak_fence', 'oak_fence', 'white_wool'], lampLight: 'torches', carpet: 'red_carpet',
  },
  desert: {
    found: 'sandstone', base: 'cut_sandstone', wall: 'smooth_sandstone', frame: 'cut_sandstone', floor: 'smooth_sandstone', planks: 'smooth_sandstone',
    roof: 'flat', rim: 'smooth_sandstone_slab', stairs: 'sandstone_stairs', slab: 'smooth_sandstone_slab', door: null, fence: 'sandstone_wall', gate: null,
    window: 'glass_pane', trapdoor: 'jungle_trapdoor', log: 'cut_sandstone', beds: ['green', 'yellow', 'orange', 'lime', 'red'],
    loot: 'village/village_desert_house', crops: ['wheat', 'wheat', 'beetroots', 'potatoes'], pots: ['potted_cactus', 'potted_dead_bush'],
    accents: ['yellow_terracotta', 'orange_terracotta', 'green_terracotta', 'red_terracotta', 'white_terracotta'],
    well: { rim: 'cut_sandstone', wall: 'smooth_sandstone', post: 'sandstone_wall', roof: 'smooth_sandstone_slab' },
    lamp: ['smooth_sandstone', 'smooth_sandstone', 'chiseled_sandstone'], lampLight: 'torches', carpet: 'yellow_carpet',
  },
  savanna: {
    found: 'cobblestone', base: 'orange_terracotta', wall: 'acacia_planks', frame: 'acacia_log', floor: 'acacia_planks', planks: 'acacia_planks',
    roof: 'hip', hipLevels: 2, stairs: 'acacia_stairs', slab: 'acacia_slab', door: 'acacia_door', fence: 'acacia_fence', gate: 'acacia_fence_gate',
    window: 'glass_pane', trapdoor: 'acacia_trapdoor', log: 'acacia_log', beds: ['orange', 'yellow', 'red', 'white', 'lime'],
    loot: 'village/village_savanna_house', crops: ['wheat', 'wheat', 'carrots', 'potatoes', 'beetroots'], pots: ['potted_red_tulip', 'potted_dandelion'],
    bases: ['orange_terracotta', 'yellow_terracotta', 'white_terracotta', 'red_terracotta'],
    well: { rim: 'cobblestone', wall: 'orange_terracotta', post: 'acacia_fence', roof: 'acacia_slab' },
    lamp: ['acacia_fence', 'acacia_fence', 'acacia_log'], lampLight: 'torches', carpet: 'orange_carpet',
  },
  snowy: {
    found: 'stone_bricks', base: 'stone_bricks', wall: 'snow_block', frame: 'stripped_spruce_log', floor: 'spruce_planks', planks: 'spruce_planks',
    roof: 'hip', hipLevels: 9, stairs: 'spruce_stairs', slab: 'spruce_slab', door: 'spruce_door', fence: 'spruce_fence', gate: 'spruce_fence_gate',
    window: 'glass_pane', trapdoor: 'spruce_trapdoor', log: 'stripped_spruce_log', beds: ['white', 'light_blue', 'blue', 'cyan'],
    loot: 'village/village_snowy_house', crops: ['wheat', 'potatoes', 'beetroots'], pots: ['potted_fern', 'potted_spruce_sapling'],
    snowRoof: true,
    well: { rim: 'stone_bricks', wall: 'packed_ice', post: 'spruce_fence', roof: 'spruce_slab' },
    lamp: ['stone_bricks', 'spruce_fence', 'spruce_fence'], lampLight: 'lantern', carpet: 'light_blue_carpet',
  },
  taiga: {
    found: 'cobblestone', base: 'cobblestone', wall: 'spruce_planks', frame: 'spruce_log', floor: 'spruce_planks', planks: 'spruce_planks',
    roof: 'gable', stairs: 'spruce_stairs', slab: 'spruce_slab', door: 'spruce_door', fence: 'spruce_fence', gate: 'spruce_fence_gate',
    window: 'glass_pane', trapdoor: 'spruce_trapdoor', log: 'spruce_log', beds: ['red', 'brown', 'green', 'white'],
    loot: 'village/village_taiga_house', crops: ['wheat', 'potatoes', 'carrots', 'potatoes'], pots: ['potted_fern', 'potted_spruce_sapling'],
    mossy: true,
    well: { rim: 'mossy_cobblestone', wall: 'cobblestone', post: 'spruce_log', roof: 'spruce_slab' },
    lamp: ['spruce_fence', 'spruce_fence', 'spruce_log'], lampLight: 'hanging', carpet: 'brown_carpet',
  },
};

// job site block, its chest's loot table (null: no chest) and how the building is named
const JOBS = {
  armorer: ['blast_furnace', 'village/village_armorer'],
  butcher: ['smoker', 'village/village_butcher'],
  cartographer: ['cartography_table', 'village/village_cartographer'],
  farmer: ['composter', null],
  fisherman: ['barrel', null],
  fletcher: ['fletching_table', 'village/village_fletcher'],
  leatherworker: ['cauldron', 'village/village_tannery'],
  mason: ['stonecutter', 'village/village_mason'],
  shepherd: ['loom', 'village/village_shepherd'],
  toolsmith: ['smithing_table', 'village/village_toolsmith'],
  weaponsmith: ['grindstone', 'village/village_weaponsmith'],
};
const JOB_NAMES = Object.keys(JOBS);

// [kind, weight, most per village]
const KINDS = [
  ['small', 7, 99], ['medium', 5, 99], ['big', 2, 3], ['job', 9, 11], ['temple', 2, 1], ['library', 2, 1],
  ['farm_small', 4, 4], ['farm_large', 3, 3], ['pen', 2, 2],
];

/* ------------------------------------------------------------- plan -- */
for (const style of Object.keys(STYLES)) PLANS['village_' + style] = ctx => village(ctx, style);

function village(ctx, style) {
  // the top of the sea (a Superflat world's is far lower: struct/starts.js ctx.sea)
  const SEA1 = (ctx.sea !== undefined ? ctx.sea : 63) - 1;
  const S = STYLES[style];
  const r = ctx.r;
  const type = ctx.type;
  const cx = ctx.point.x, cz = ctx.point.z;
  // keep everything within six chunks of the start chunk (the limit is seven)
  const L = { x0: (ctx.cx - 6) * 16, x1: (ctx.cx + 7) * 16 - 1, z0: (ctx.cz - 6) * 16, z1: (ctx.cz + 7) * 16 - 1 };
  const within = q => q[0] >= L.x0 && q[2] <= L.x1 && q[1] >= L.z0 && q[3] <= L.z1;
  const roads = [], taken = [];      // rectangles [x0, z0, x1, z1] used by streets, and by everything else
  // a building may touch a street but keeps a block from other buildings
  const free = q => within(q) && !roads.some(t => overlaps(q, t, 0)) && !taken.some(t => overlaps(q, t, 1));
  const paths = [], builds = [], lamps = [];
  const used = {};
  let nBeds = 0;

  /* the meeting point: a square of path with the well in the middle */
  const P = 4;
  const plaza = [cx - P, cz - P, cx + P, cz + P];
  roads.push(plaza);
  paths.push(plaza);
  const gy = ctx.ground(cx, cz);
  const wellY = Math.max(gy, SEA1);
  builds.push(new Build(type, cx - 2, wellY - 3, cz - 2, 5, 9, 5, 0, drawWell, { S, base: 3 }));

  /* streets out from the middle of each side of the square */
  const dirs = [NORTH, EAST, SOUTH, WEST];
  for (let i = 3; i > 0; i--) { const j = r.nextInt(i + 1); const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t; }
  const nStreets = r.nextFloat() < 0.45 ? 4 : r.nextFloat() < 0.7 ? 3 : 2;
  const streets = [];
  for (let k = 0; k < nStreets; k++) {
    const d = dirs[k], len = r.between(20, 36);
    const s = street(cx + DX[d] * (P + 1), cz + DZ[d] * (P + 1), d, len);
    if (!s) continue;
    clipStreet(s);
    if (s.len < 8) continue;
    streets.push(s);
    roads.push(s.rect);
    paths.push(s.rect);
  }
  // side streets off the longer ones
  for (const s of streets.slice()) {
    if (s.len < 16 || r.nextFloat() < 0.35) continue;
    const at = r.between(6, s.len - 6);
    const side = r.nextBoolean() ? (s.d + 1) & 3 : (s.d + 3) & 3;
    const sx = s.x + DX[s.d] * at + DX[side] * 2, sz = s.z + DZ[s.d] * at + DZ[side] * 2;
    const b = street(sx, sz, side, r.between(10, 22));
    clipStreet(b);
    if (b.len < 8) continue;
    if (!free(b.rect)) continue;
    streets.push(b);
    roads.push(b.rect);
    paths.push(b.rect);
  }

  /* buildings along both sides of every street */
  for (const s of streets) {
    for (const sideTurn of [1, 3]) {
      const side = (s.d + sideTurn) & 3;          // the way out from the street to the building
      let t = 1;
      while (t < s.len - 2) {
        const kind = pickKind(r, used);
        const sz = sizeOf(kind, r);
        const placed = tryPlace(s, side, t, kind, sz);
        if (placed) { used[kind] = (used[kind] || 0) + 1; t += sz.w + r.between(1, 3); }
        else t += 2;
      }
    }
  }

  /* lamp posts in the gaps, every 9 or so blocks along each street */
  for (const s of streets) {
    for (let t = 3; t < s.len; t += 9) {
      const side = (s.d + (t % 18 < 9 ? 1 : 3)) & 3;
      const lx = s.x + DX[s.d] * t + DX[side] * 3, lz = s.z + DZ[s.d] * t + DZ[side] * 3;
      const q = [lx - 1, lz - 1, lx + 1, lz + 1];
      if (!free(q)) continue;
      taken.push(q);
      const y = ctx.ground(lx, lz);
      if (y < SEA1) continue;
      lamps.push(new Build(type, lx - 1, y, lz - 1, 3, 6, 3, 0, drawLamp, { S }));
    }
  }

  /* who lives here: the golem and a cat by the well */
  const golem = { type: 'iron_golem', x: cx + 3, z: cz + 1 };
  const cat = { type: 'cat', x: cx - 3, z: cz - 2 };
  const pathPieces = paths.map((q, i) => pathPiece(ctx, type, S, q, i === 0 ? [golem, cat] : null));
  return [...pathPieces, ...builds, ...lamps];

  /* ---- helpers, sharing the plan's state ---- */
  // a street 3 wide from (x, z) on its centre line, heading d for len blocks
  function street(x, z, d, len) {
    const x1 = x + DX[d] * (len - 1), z1 = z + DZ[d] * (len - 1);
    const s = { x, z, d, len };
    s.rect = rectOf(s);
    return s;
  }
  function rectOf(s) {
    const x1 = s.x + DX[s.d] * (s.len - 1), z1 = s.z + DZ[s.d] * (s.len - 1);
    const across = s.d === NORTH || s.d === SOUTH ? [1, 0] : [0, 1];
    return [Math.min(s.x, x1) - across[0], Math.min(s.z, z1) - across[1], Math.max(s.x, x1) + across[0], Math.max(s.z, z1) + across[1]];
  }
  // shorten a street so it stays inside the limit and stops before water
  function clipStreet(s) {
    while (s.len > 0) {
      s.rect = rectOf(s);
      const ex = s.x + DX[s.d] * (s.len - 1), ez = s.z + DZ[s.d] * (s.len - 1);
      if (within(s.rect) && ctx.ground(ex, ez) >= SEA1 - 1) break;
      s.len--;
    }
    s.rect = rectOf(s);
  }
  // put a building beside street s at t blocks along it, on side `side`; true if it fit
  function tryPlace(s, side, t, kind, sz) {
    const { w, d } = sz;
    // the frame's front (z = 0, facing north) turns to face the street: rot = the way from the building to the street
    const rot = (side + 2) & 3;
    const W = rot & 1 ? d : w, D = rot & 1 ? w : d;
    // the street's near edge, then the building just past it
    const ax = s.x + DX[s.d] * t, az = s.z + DZ[s.d] * t;            // the centre line at t
    const ex = ax + DX[side] * 2, ez = az + DZ[side] * 2;            // the first cell past the street
    // the building runs from t along the street for w blocks
    const fx = ex + DX[s.d] * (w - 1) + DX[side] * (d - 1), fz = ez + DZ[s.d] * (w - 1) + DZ[side] * (d - 1);
    const q = [Math.min(ex, fx), Math.min(ez, fz), Math.max(ex, fx), Math.max(ez, fz)];
    if (q[2] - q[0] + 1 !== W || q[3] - q[1] + 1 !== D) return false;
    if (!free(q)) return false;
    // the building may only touch its own street at the front, never block it
    const fp = footprint(ctx, q[0], q[1], W, D, 2);
    const steep = kind.startsWith('farm') || kind === 'pen' ? 3 : 4;
    if (fp.min < SEA1 || fp.max - fp.min > steep) return false;
    const y = fp.med;
    taken.push(q);
    const o = { S, kind, job: null, bedsAt: [], seed: (q[0] * 341873128 + q[1] * 132897987 + t) | 0 };
    if (kind === 'job') {
      const left = JOB_NAMES.filter(j => !used['job_' + j]);
      o.job = left.length ? left[r.nextInt(left.length)] : JOB_NAMES[r.nextInt(JOB_NAMES.length)];
      used['job_' + o.job] = 1;
    }
    o.iw = sz.iw; o.id = sz.id; o.floors = sz.floors;
    o.bedColour = S.beds[r.nextInt(S.beds.length)];
    o.base = S.bases ? S.bases[r.nextInt(S.bases.length)] : S.base;
    o.accent = S.accents ? S.accents[r.nextInt(S.accents.length)] : null;
    o.crop = [S.crops[r.nextInt(S.crops.length)], S.crops[r.nextInt(S.crops.length)]];
    o.age = [r.nextInt(8), r.nextInt(8)];
    o.pot = S.pots[r.nextInt(S.pots.length)];
    const draw = kind.startsWith('farm') ? drawFarm : kind === 'pen' ? drawPen : drawHouse;
    builds.push(new Build(type, q[0], y, q[1], w, 22, d, rot, draw, o));
    return true;
  }
}

function pickKind(r, used) {
  let total = 0;
  const ok = KINDS.filter(k => (used[k[0]] || 0) < k[2]);
  for (const k of ok) total += k[1];
  let n = r.nextInt(total);
  for (const k of ok) { if ((n -= k[1]) < 0) return k[0]; }
  return 'small';
}
// the box size (w along the street, d deep) of each kind, and the inside of a house
function sizeOf(kind, r) {
  let iw = 3, id = 3, floors = 1;
  switch (kind) {
    case 'small': iw = r.between(3, 4); id = r.between(3, 4); break;
    case 'medium': iw = r.between(5, 6); id = r.between(4, 5); break;
    case 'big': iw = r.between(5, 7); id = r.between(5, 6); floors = 2; break;
    case 'job': iw = r.between(4, 5); id = r.between(4, 5); break;
    case 'temple': iw = 5; id = 7; break;
    case 'library': iw = 7; id = 5; break;
    case 'farm_small': return { w: 7, d: 9 };
    case 'farm_large': return { w: 13, d: 9 };
    case 'pen': return { w: 7, d: 7 };
  }
  return { w: iw + 4, d: id + 4, iw, id, floors };
}

/* A strip of street: path on the ground of each column, measured now. */
function pathPiece(ctx, type, S, q, ents) {
  const w = q[2] - q[0] + 1, d = q[3] - q[1] + 1;
  const hs = new Array(w * d);
  let lo = 999;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) { const h = ctx.ground(q[0] + x, q[1] + z); hs[x * d + z] = h; if (h < lo) lo = h; }
  const sea1 = (ctx.sea !== undefined ? ctx.sea : 63) - 1;
  lo = Math.min(lo, sea1);
  const e = ents ? ents.map(a => ({ type: a.type, x: a.x - q[0], z: a.z - q[1] })) : null;
  return new Build(type, q[0], lo, q[1], w, 8, d, 0, drawPath, { hs, y0: lo, sea1, bridge: S.style === 'desert' ? 'smooth_sandstone' : S.planks, ents: e });
}
function drawPath(g, o) {
  for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) {
    const h = o.hs[x * g.d + z];
    if (h < o.sea1) { g.set(x, o.sea1 - o.y0, z, o.bridge); g.air(x, o.sea1 + 1 - o.y0, z, x, o.sea1 + 2 - o.y0, z); continue; }
    const y = h - o.y0;
    g.set(x, y, z, 'dirt_path');
    g.air(x, y + 1, z, x, y + 3, z);
  }
  if (o.ents) for (const e of o.ents) {
    const h = o.hs[e.x * g.d + e.z];
    g.entity(e.type, e.x, Math.max(h, o.sea1) + 1 - o.y0, e.z);
  }
}

/* ------------------------------------------------------- the well -- */
function drawWell(g, o) {
  const S = o.S, W = S.well, b = o.base;
  // the shaft: water three deep inside a lining, with the rim at ground level
  g.fill(0, b - 3, 0, 4, b - 1, 4, W.rim);
  g.fill(1, b - 2, 1, 3, b, 3, 'water');
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) {
    if (x > 0 && x < 4 && z > 0 && z < 4) continue;
    g.set(x, b, z, W.rim);
    g.set(x, b + 1, z, W.wall);
    g.down(x, b - 4, z, W.rim);
  }
  g.air(0, b + 2, 0, 4, b + 5, 4);
  // posts at the corners and the roof, the bell hanging under its middle
  for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) { g.set(x, b + 2, z, W.post, { axis: 'y' }); g.set(x, b + 3, z, W.post, { axis: 'y' }); }
  g.fill(0, b + 4, 0, 4, b + 4, 4, W.roof, { slab: 0 });
  g.set(2, b + 4, 2, W.rim);
  g.set(2, b + 3, 2, 'bell', { m: 1 });
  if (S.snowRoof) g.fill(0, b + 5, 0, 4, b + 5, 4, 'snow');
}

/* ------------------------------------------------------ lamp posts -- */
function drawLamp(g, o) {
  const S = o.S, [a, b, c] = S.lamp;
  g.air(0, 1, 0, 2, 5, 2);
  g.set(1, 1, 1, a, { axis: 'y' });
  g.set(1, 2, 1, b, { axis: 'y' });
  g.set(1, 3, 1, c, { axis: 'y' });
  if (S.lampLight === 'torches') {
    torch(g, 1, 3, 0, NORTH); torch(g, 2, 3, 1, EAST); torch(g, 1, 3, 2, SOUTH); torch(g, 0, 3, 1, WEST);
  } else if (S.lampLight === 'lantern') {
    g.set(1, 4, 1, 'lantern');
  } else {
    // a spruce arm with a lantern hanging from it
    g.set(1, 4, 1, S.fence);
    g.set(2, 4, 1, S.fence);
    g.set(2, 3, 1, 'lantern', { m: 1 });
  }
}

/* ---------------------------------------------------------- houses --
   Frame: the front is z = 0 (facing north, onto the street), x across.
   The walls stand one block in from the box on every side (the outer ring
   is the roof's overhang and the front step); y = 0 is the floor. */
function drawHouse(g, o) {
  const S = o.S, W = g.w, D = g.d;
  const x1 = 1, x2 = W - 2, z1 = 1, z2 = D - 2;
  const ix0 = x1 + 1, ix1 = x2 - 1, iz0 = z1 + 1, iz1 = z2 - 1;
  const temple = o.kind === 'temple';
  const floors = o.floors || 1;
  const wh = temple ? 6 : floors === 2 ? 7 : 3;
  const R = rng(o.seed);
  const wall = temple ? o.base === 'orange_terracotta' ? 'white_terracotta' : S.base : S.wall;
  const doorX = x1 + ((x2 - x1) >> 1);

  // the hillside out of the way, the floor and what holds it up
  g.air(0, 1, 0, W - 1, g.h - 1, D - 1);
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
    const edge = x === x1 || x === x2 || z === z1 || z === z2;
    g.set(x, 0, z, edge ? S.found : S.floor);
    g.down(x, -1, z, S.taiga ? 'cobblestone' : S.found);
  }
  // the step in front of the door
  g.set(doorX, 0, 0, S.found);
  g.down(doorX, -1, 0, S.found);

  // walls: a course of the base block, the wall above it, logs at the corners
  for (let y = 1; y <= wh; y++) {
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
      const edgeX = x === x1 || x === x2, edgeZ = z === z1 || z === z2;
      if (!edgeX && !edgeZ) continue;
      let b = y === 1 ? o.base : wall;
      if (edgeX && edgeZ) b = S.frame;
      else if (S.mossy && y === 1 && R.nextFloat() < 0.3) b = 'mossy_cobblestone';
      if (o.accent && y === wh && !(edgeX && edgeZ)) b = o.accent;
      g.set(x, y, z, b, { axis: 'y' });
    }
  }
  // windows along each wall at eye height (every other block), not at the corners or by the door
  const winRows = floors === 2 ? [2, 6] : temple ? [2, 3, 4] : [2];
  for (const y of winRows) {
    for (let x = x1 + 1; x < x2; x++) {
      if ((x - x1) % 2 === 0 && Math.abs(x - doorX) > 1) g.set(x, y, z1, S.window);
      if ((x - x1) % 2 === 0) g.set(x, y, z2, S.window);
    }
    for (let z = z1 + 1; z < z2; z++) if ((z - z1) % 2 === 0) { g.set(x1, y, z, S.window); g.set(x2, y, z, S.window); }
  }
  // the door
  if (S.door) door(g, doorX, 1, z1, S.door, NORTH);
  else g.air(doorX, 1, z1, doorX, 2, z1);
  torch(g, doorX + 1, 2, 0, NORTH);

  // an upper floor with a ladder up to it
  if (floors === 2) {
    g.fill(ix0, 4, iz0, ix1, 4, iz1, S.planks);
    for (let y = 1; y <= 4; y++) g.set(ix0, y, iz1, 'ladder', { f: NORTH });
    g.set(ix0, 5, iz1, 'air');
    g.set(ix0, 4, iz1, 'ladder', { f: NORTH });
  }

  roof(g, S, W, D, wh, o);

  // inside
  furnish(g, o, { ix0, ix1, iz0, iz1, doorX, floors, temple, R });
}

function roof(g, S, W, D, wh, o) {
  if (S.roof === 'flat') {
    // a flat sandstone top with a low rim; bigger houses get a little room on the roof
    g.fill(1, wh + 1, 1, W - 2, wh + 1, D - 2, S.wall);
    for (let x = 1; x <= W - 2; x++) { g.set(x, wh + 2, 1, S.rim, { slab: 0 }); g.set(x, wh + 2, D - 2, S.rim, { slab: 0 }); }
    for (let z = 1; z <= D - 2; z++) { g.set(1, wh + 2, z, S.rim, { slab: 0 }); g.set(W - 2, wh + 2, z, S.rim, { slab: 0 }); }
    if (o.kind === 'big' || o.kind === 'temple') {
      const ax = 3, az = 3, bx = Math.min(W - 4, ax + 3), bz = Math.min(D - 4, az + 3);
      for (let y = wh + 2; y <= wh + 4; y++) g.hollow(ax, y, az, bx, y, bz, S.wall, 'air');
      g.fill(ax, wh + 5, az, bx, wh + 5, bz, S.base);
      g.air(ax + 1, wh + 2, az, ax + 1, wh + 3, az);
      g.air(ax + 1, wh + 1, az + 1, ax + 1, wh + 1, az + 1);
      g.set(ax + 1, wh + 2, bz - 1, o.accent || 'cut_sandstone');
    }
    return;
  }
  if (S.roof === 'hip') {
    hip(g, 0, W - 1, 0, D - 1, wh, S.stairs, S.slab, S.planks, S.hipLevels, S.snowRoof);
    return;
  }
  // gables along the longer side, the triangle ends filled with the wall's planks
  if (D >= W) gableZ(g, 0, W - 1, 0, D - 1, wh, S.stairs, null, S.planks, [1, D - 2]);
  else gableX(g, 0, W - 1, 0, D - 1, wh, S.stairs, null, S.planks, [1, W - 2]);
}

// a hipped roof: rings of stairs stepping in, closed with slabs once it is narrow (or after `levels` rings)
function hip(g, x0, x1, z0, z1, y, stairs, slab, planks, levels, snow) {
  for (let i = 0; ; i++) {
    const a = x0 + i, b = x1 - i, c = z0 + i, d = z1 - i;
    if (b - a < 2 || d - c < 2 || i >= levels) {
      g.fill(a, y + i, c, b, y + i, d, slab, { slab: 0 });
      if (snow) g.fill(a, y + i + 1, c, b, y + i + 1, d, 'snow');
      return;
    }
    for (let x = a; x <= b; x++) { g.set(x, y + i, c, stairs, { f: SOUTH }); g.set(x, y + i, d, stairs, { f: NORTH }); }
    for (let z = c + 1; z < d; z++) { g.set(a, y + i, z, stairs, { f: EAST }); g.set(b, y + i, z, stairs, { f: WEST }); }
  }
}

function furnish(g, o, I) {
  const S = o.S, { ix0, ix1, iz0, iz1, doorX, R } = I;
  const beds = o.kind === 'small' ? 1 : o.kind === 'medium' ? 2 : o.kind === 'big' ? 3 : 0;
  // beds against the back wall, heads to the wall
  let placed = 0;
  for (let x = I.floors === 2 ? ix0 + 1 : ix0; x <= ix1 && placed < Math.min(beds, 2); x += 2) {
    bed(g, x, 1, iz1 - 1, o.bedColour, SOUTH);
    g.entity('villager', doorX, 1, iz0 + (placed & 1), { style: S.name, profession: 'none' });
    placed++;
  }
  if (beds === 3) {
    // the third bed upstairs
    bed(g, ix1, 5, iz0, o.bedColour, SOUTH);
    g.entity('villager', ix1 - 1, 5, iz0 + 1, { style: S.name, profession: 'none' });
    g.set(ix1, 5, iz1, 'crafting_table');
  }
  // light
  torch(g, ix0, 3, iz0 - 1 + 1, SOUTH);
  if (ix1 - ix0 >= 2) torch(g, ix1, 3, iz0, SOUTH);

  if (o.kind === 'temple') {
    // the altar at the back: a step, the brewing stand and the temple chest
    g.fill(ix0, 1, iz1, ix1, 1, iz1, S.found);
    g.set(doorX, 2, iz1, 'brewing_stand');
    g.set(doorX - 1, 2, iz1, 'candle', { m: 2 });
    g.set(doorX + 1, 2, iz1, 'candle', { m: 1 });
    g.chest(ix0, 1, iz1 - 1, 'village/village_temple', EAST);
    for (let z = iz0 + 1; z < iz1 - 1; z += 2) { g.set(ix0, 1, z, S.stairs === 'sandstone_stairs' ? 'sandstone_stairs' : S.stairs, { f: SOUTH }); g.set(ix1, 1, z, S.stairs, { f: SOUTH }); }
    g.entity('villager', doorX, 1, iz1 - 2, { style: S.name, profession: 'cleric' });
    return;
  }
  if (o.kind === 'library') {
    for (let x = ix0; x <= ix1; x++) { g.set(x, 1, iz1, 'bookshelf'); g.set(x, 2, iz1, 'bookshelf'); }
    for (let z = iz0 + 1; z < iz1; z++) { g.set(ix0, 1, z, 'bookshelf'); g.set(ix1, 1, z, 'bookshelf'); }
    g.set(doorX, 1, iz1 - 2, 'lectern', { f: NORTH });
    g.set(ix1 - 1, 1, iz0, S.carpet);
    g.entity('villager', doorX + 1, 1, iz0 + 1, { style: S.name, profession: 'librarian' });
    return;
  }
  if (o.kind === 'job') {
    const [block, loot] = JOBS[o.job];
    // the job site on the side wall, facing into the room; its chest in the back corner
    if (block === 'cauldron') g.set(ix1, 1, iz0 + 1, 'water_cauldron');
    else g.set(ix1, 1, iz0 + 1, block, { f: WEST });
    if (o.job === 'weaponsmith' || o.job === 'toolsmith' || o.job === 'armorer') g.set(ix1, 1, iz1 - 1 >= iz0 + 2 ? iz1 - 1 : iz1, 'furnace', { f: WEST });
    if (o.job === 'cartographer') g.set(ix0, 2, iz1, 'white_carpet');
    if (o.job === 'shepherd') g.set(ix0, 1, iz0 + 1, 'white_wool');
    if (o.job === 'farmer') g.set(ix0, 1, iz0 + 1, 'hay_block', { axis: 'y' });
    g.entity('villager', doorX, 1, iz0 + 1, { style: S.name, profession: o.job });
    g.set(ix0, 1, iz1, 'crafting_table');
    if (loot) g.chest(ix1, 1, iz1, loot, WEST);
    return;
  }
  // a house: a table and a pot, the house chest in a corner
  if (ix1 - ix0 >= 3) {
    g.set(ix1, 1, iz0 + 1 <= iz1 - 2 ? iz0 + 1 : iz0, S.fence);
    g.set(ix1, 2, iz0 + 1 <= iz1 - 2 ? iz0 + 1 : iz0, S.roof === 'flat' ? 'smooth_sandstone_slab' : S.slab.replace('_slab', '_pressure_plate').replace('smooth_sandstone_pressure_plate', 'stone_pressure_plate'));
  }
  if (beds < 3) g.set(ix0, 1, iz0, 'crafting_table');
  g.set(ix1, 1, iz0, o.pot);
  g.chest(ix1, 1, iz1, S.loot, WEST);
}

/* ------------------------------------------------------------ farms -- */
function drawFarm(g, o) {
  const S = o.S, W = g.w, D = g.d;
  const large = W > 9;
  g.air(0, 1, 0, W - 1, 4, D - 1);
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    const edge = x === 0 || x === W - 1 || z === 0 || z === D - 1;
    const water = !edge && (large ? x === 3 || x === 9 : x === 3);
    const divider = large && x === 6 && !edge;
    g.down(x, -1, z, 'dirt');
    if (edge || divider) { g.set(x, 0, z, S.log, { axis: edge && (z === 0 || z === D - 1) ? 'x' : 'z' }); continue; }
    if (water) { g.set(x, 0, z, 'water'); continue; }
    g.set(x, 0, z, 'farmland', { m: 7 });
    const half = x < 6 ? 0 : 1;
    g.set(x, 1, z, o.crop[half], { m: o.age[half] });
  }
  // (a dead bush cannot grow on the cut sandstone of the frame: it stands in a pot there)
  if (S.roof === 'flat') g.set(0, 1, 0, 'potted_dead_bush');
}
function drawPen(g, o) {
  const S = o.S, W = g.w, D = g.d;
  g.air(0, 1, 0, W - 1, 4, D - 1);
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    g.set(x, 0, z, S.roof === 'flat' ? 'sand' : 'grass_block');
    g.down(x, -1, z, 'dirt');
    if (x === 0 || x === W - 1 || z === 0 || z === D - 1) g.set(x, 1, z, S.fence);
  }
  const gx = W >> 1;
  if (S.gate) g.set(gx, 1, 0, S.gate, { f: NORTH });
  else g.set(gx, 1, 0, 'air');
  g.set(W - 2, 1, D - 2, 'hay_block', { axis: 'y' });
  g.set(W - 3, 1, D - 2, 'hay_block', { axis: 'x' });
  g.set(1, 1, D - 2, 'water_cauldron');
}

for (const k in STYLES) STYLES[k].name = k;
STYLES.taiga.taiga = true;
STYLES.desert.style = 'desert';
