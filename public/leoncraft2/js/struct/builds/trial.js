/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: trial chambers, our own design.

   A complex of tuff and copper deep underground. Rooms sit on a grid 30
   blocks apart around the start point and are joined by straight
   corridors; the plan grows the grid from the middle like a tree (a step
   from a room already placed, in a random direction), adds a loop or two,
   and then decides what each room is:
     the atrium     the hub: a tall hall with a spiral stair round a copper
                    pillar up to a balcony, the entrance chests, pots
     combat rooms   square halls with trial spawners on pedestals, a raised
                    walk round the walls and a grate over a lit pit
     vault rooms    the rooms furthest from the atrium: vaults on a dais
                    behind copper bars, one trial spawner on guard
     supply rooms   chests and shelves of barrels
     crossings      small rooms where corridors meet, a chest and barrels
   Corridors are five wide with tuff brick walls, polished tuff pilasters,
   copper grates in the floor over bulbs, and bulbs in the ceiling; some
   have a corridor chest.

   All rooms share one floor height (the start's y); the atrium rises
   highest. Randomness comes from ctx.r in the plan and from a hash of the
   frame position in drawing, so chunks agree; g.r is left to the chests.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { hash32 } from '../rand.js?v=107';

export const PLANS = {};

const TYPE = 'trial_chambers';
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
const SPACE = 30;              // between room centres
const GRID = 2;                // rooms from -GRID..GRID on each axis
const CW = 7, CH = 7;          // corridor: 5 inside, walls; floor, 5 of air, ceiling

const h01 = (s, x, z, k) => hash32(s, x, z, k | 0) / 4294967296;
const SIZE = { atrium: 25, combat: 17, vault: 11, supply: 11, cross: 9 };
const HEIGHT = { atrium: 19, combat: 11, vault: 8, supply: 7, cross: 7 };

/* ------------------------------------------------------------ drawing -- */
// a dispenser holding one of the chambers' dispenser tables (struct/lootdata.js), facing f
function dispenser(g, x, y, z, f, table) {
  g.set(x, y, z, 'dispenser', { f });
  if (!g.inside(x, y, z)) return;
  const [X, Y, Z] = g.world(x, y, z);
  g.wr.chest(X, Y, Z, table, String((X * 3129871) ^ (Z * 116129781) ^ Y));
}
// the shell every room shares: tuff brick walls, pilasters, a ceiling, doors
// 5 wide and 5 high in the middle of each side listed in o.doors
function shell(g, o) {
  const w = g.w, d = g.d, h = g.h, m = w >> 1;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const ex = x === 0 || x === w - 1, ez = z === 0 || z === d - 1;
    if (!ex && !ez) {
      g.set(x, 0, z, 'polished_tuff');
      g.air(x, 1, z, x, h - 2, z);
      g.set(x, h - 1, z, 'tuff_bricks');
      continue;
    }
    const along = ex ? z : x;
    const pil = ex && ez ? true : along % 4 === 0;
    for (let y = 0; y < h; y++) {
      let b = 'tuff_bricks';
      if (y === 0 || y === h - 1) b = 'polished_tuff';
      else if (pil) b = y === h - 2 ? 'chiseled_tuff' : 'polished_tuff';
      else if (y === 5) b = 'chiseled_tuff_bricks';
      g.set(x, y, z, b);
    }
  }
  // doors
  for (let f = 0; f < 4; f++) {
    if (!o.doors[f]) continue;
    for (let i = -2; i <= 2; i++) for (let y = 1; y <= 5; y++) {
      const x = f === NORTH || f === SOUTH ? m + i : f === EAST ? w - 1 : 0;
      const z = f === EAST || f === WEST ? m + i : f === SOUTH ? d - 1 : 0;
      g.set(x, y, z, 'air');
    }
    const x = f === NORTH || f === SOUTH ? m : f === EAST ? w - 1 : 0;
    const z = f === EAST || f === WEST ? m : f === SOUTH ? d - 1 : 0;
    g.set(x, 6, z, 'chiseled_tuff');
  }
  // ceiling grates and bulbs
  for (let x = 2; x < w - 2; x += 4) for (let z = 2; z < d - 2; z += 4) {
    g.set(x, h - 1, z, 'waxed_copper_bulb');
    if (x + 1 < w - 1) g.set(x + 1, h - 1, z, 'waxed_copper_grate');
    if (z + 1 < d - 1) g.set(x, h - 1, z + 1, 'waxed_copper_grate');
  }
}

// a corridor along frame z: 5 wide inside, grates over bulbs, a chest maybe
function drawCorridor(g, o) {
  const L = g.d;
  for (let z = 0; z < L; z++) {
    const pil = z % 6 === 0;
    for (let x = 0; x < CW; x++) {
      if (x === 0 || x === CW - 1) {
        for (let y = 0; y < CH; y++) {
          let b = 'tuff_bricks';
          if (y === 0 || y === CH - 1) b = 'polished_tuff';
          else if (pil) b = y === CH - 2 ? 'chiseled_tuff' : 'polished_tuff';
          else if (y === 1) b = 'tuff_brick_slab';
          g.set(x, y, z, b, y === 1 && !pil ? { slab: 2 } : 0);
        }
        continue;
      }
      const grate = x >= 2 && x <= 4 && z % 6 >= 2 && z % 6 <= 3;
      g.set(x, -1, z, grate && x === 3 ? 'waxed_copper_bulb' : 'tuff');
      g.set(x, 0, z, grate ? 'waxed_copper_grate' : x === 1 || x === 5 ? 'polished_tuff' : z % 6 === 0 ? 'waxed_cut_copper' : 'tuff_bricks');
      g.air(x, 1, z, x, CH - 2, z);
      let c = 'tuff_bricks';
      if (x === 3 && z % 6 === 3) c = 'waxed_copper_bulb';
      else if (x >= 2 && x <= 4 && z % 6 === 3) c = 'waxed_oxidized_copper_grate';
      else if (pil) c = 'polished_tuff';
      g.set(x, CH - 1, z, c);
    }
    if (h01(o.s, o.k, z, 1) < 0.08 && z > 1 && z < L - 2 && !pil) g.set(h01(o.s, o.k, z, 2) < 0.5 ? 1 : 5, 1, z, 'decorated_pot');
  }
  if (o.chest && L > 4) {
    const z = L >> 1;
    g.set(5, 1, z, 'air');
    g.chest(5, 1, z, 'trial_chambers/corridor', WEST);
  }
  /* now and then an arrow trap: a string across the corridor between two hooks, and in the wall over the
     west hook's block a dispenser of arrows that fires across at head height when it is tripped (sim/tripwire.js) */
  if (o.trap && L > 8) {
    let z = 3 + Math.floor(h01(o.s, o.k, 0, 9) * (L - 6));
    if (z % 6 === 0 || (z % 6 >= 2 && z % 6 <= 3)) z = z - (z % 6) + 4;
    if (z >= L - 2) return;
    g.set(1, 1, z, 'tripwire_hook', { f: EAST });
    for (let x = 2; x <= 4; x++) g.set(x, 1, z, 'tripwire');
    g.set(5, 1, z, 'tripwire_hook', { f: WEST });
    dispenser(g, 0, 2, z, EAST, 'dispensers/trial_chambers/corridor');
  }
}

// the atrium: a tall hub, a spiral stair round a copper pillar to a balcony
function drawAtrium(g, o) {
  shell(g, o);
  const w = g.w, d = g.d, h = g.h, m = w >> 1, B = 8;     // balcony floor at y B
  // the floor: polished tuff with a copper ring and chiseled tuff rays
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
    const dx = Math.abs(x - m), dz = Math.abs(z - m), c = Math.max(dx, dz);
    let b = 'polished_tuff';
    if (c === 5) b = 'waxed_cut_copper';
    else if (dx === 0 || dz === 0 || dx === dz) b = 'chiseled_tuff';
    else if (c > 7 && ((x + z) & 1) === 0) b = 'tuff_bricks';
    g.set(x, 0, z, b);
  }
  // the balcony, three wide round the walls, railed with tuff brick walls
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
    const c = Math.min(x, z, w - 1 - x, d - 1 - z);
    if (c > 3) continue;
    g.set(x, B, z, c === 3 ? 'waxed_copper_grate' : 'polished_tuff');
    if (c === 3) g.set(x, B + 1, z, 'tuff_brick_wall');
  }
  // corbels under the balcony
  for (let i = 2; i < w - 2; i += 4) {
    for (const [x, z] of [[i, 3], [i, d - 4], [3, i], [w - 4, i]]) g.set(x, B - 1, z, 'tuff_brick_stairs', { top: true, f: x === 3 ? WEST : x === w - 4 ? EAST : z === 3 ? NORTH : SOUTH });
  }
  // the pillar and the spiral stair round it, one turn to the balcony
  g.fill(m, 1, m, m, h - 2, m, 'waxed_copper_block');
  for (let y = 3; y < h - 1; y += 4) g.set(m, y, m, 'waxed_copper_bulb');
  const ring = [[-1, -1, EAST], [0, -1, EAST], [1, -1, SOUTH], [1, 0, SOUTH], [1, 1, WEST], [0, 1, WEST], [-1, 1, NORTH], [-1, 0, NORTH]];
  ring.forEach(([dx, dz, f], i) => {
    g.set(m + dx, 1 + i, m + dz, 'tuff_brick_stairs', { f });
    if (i > 0) g.set(m + dx, i, m + dz, 'tuff_brick_stairs', { f: (f + 2) & 3, top: true });
  });
  // landing and a bridge north to the balcony
  g.fill(m - 1, B, m - 1, m - 1, B, m - 1, 'polished_tuff');
  for (let z = 4; z <= m - 1; z++) {
    g.fill(m - 2, B, z, m, B, z, z % 3 === 0 ? 'waxed_copper_grate' : 'polished_tuff');
    if (z < m - 1) { g.set(m - 3, B + 1, z, 'tuff_brick_wall'); g.set(m + 1, B + 1, z, 'tuff_brick_wall'); }
  }
  g.air(m - 2, B + 1, 3, m, B + 1, 3);
  // pots along the walls, and the entrance chests up on the balcony
  for (const [x, z] of [[2, 2], [w - 3, 2], [2, d - 3], [w - 3, d - 3], [2, m - 4], [w - 3, m + 4]]) g.set(x, 1, z, 'decorated_pot');
  g.set(2, B + 1, m + 3, 'decorated_pot');
  g.set(w - 3, B + 1, m - 3, 'decorated_pot');
  g.chest(2, B + 1, 2, 'trial_chambers/entrance', SOUTH);
  g.chest(w - 3, B + 1, d - 3, 'trial_chambers/entrance', NORTH);
}

// a combat room: a raised walk round the walls, a grate over a lit pit in the
// middle and trial spawners on pedestals at the spots the plan chose
function drawCombat(g, o) {
  shell(g, o);
  const w = g.w, d = g.d, m = w >> 1;
  // the walk: two wide, one up, with steps down at the doors
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
    const c = Math.min(x, z, w - 1 - x, d - 1 - z);
    if (c <= 2) {
      g.set(x, 1, z, c === 2 ? 'polished_tuff_slab' : 'polished_tuff', c === 2 ? { slab: 0 } : 0);
    } else {
      const dx = Math.abs(x - m), dz = Math.abs(z - m);
      let b = ((x + z) & 1) ? 'tuff_bricks' : 'chiseled_tuff';
      if (Math.max(dx, dz) <= 1) b = 'waxed_copper_grate';
      else if (Math.max(dx, dz) === 4) b = 'waxed_cut_copper';
      g.set(x, 0, z, b);
    }
  }
  // the pit under the middle grate, lit by a bulb
  g.fill(m - 1, -2, m - 1, m + 1, -1, m + 1, 'air');
  g.fill(m - 1, -3, m - 1, m + 1, -3, m + 1, 'tuff_bricks');
  g.set(m, -3, m, 'waxed_copper_bulb');
  // the walk cut back at each door so it can be walked onto
  for (let f = 0; f < 4; f++) {
    if (!o.doors[f]) continue;
    for (let i = -2; i <= 2; i++) {
      const x = f === NORTH || f === SOUTH ? m + i : f === EAST ? w - 2 : 1;
      const z = f === EAST || f === WEST ? m + i : f === SOUTH ? d - 2 : 1;
      g.set(x, 1, z, 'polished_tuff_slab', { slab: 0 });
    }
  }
  // copper columns at the corners of the middle
  for (const [x, z] of [[4, 4], [w - 5, 4], [4, d - 5], [w - 5, d - 5]]) {
    g.fill(x, 1, z, x, g.h - 2, z, 'waxed_copper_block');
    g.set(x, 4, z, 'waxed_copper_bulb');
  }
  // spawners
  for (const [x, z] of o.spawners) { g.set(x, 1, z, 'chiseled_tuff'); g.set(x, 2, z, 'trial_spawner'); }
  // pots on the walk
  for (const [x, z] of [[1, 1], [w - 2, 1], [1, d - 2], [w - 2, d - 2]]) if (h01(o.s, x, z, 3) < 0.7) g.set(x, 2, z, 'decorated_pot');
  // two dispensers in the walls over the walk, facing in, with the chambers' things to throw
  for (const [x, z, f] of [[0, m, EAST], [w - 1, m, WEST], [m, 0, SOUTH], [m, d - 1, NORTH]]) {
    if (o.doors[f === EAST ? WEST : f === WEST ? EAST : f === SOUTH ? NORTH : SOUTH]) continue;
    if (h01(o.s, x, z, 4) < 0.5) dispenser(g, x, 3, z, f, 'dispensers/trial_chambers/chamber');
  }
}

// a vault room: two vaults on a dais behind copper bars, a spawner on guard
function drawVault(g, o) {
  shell(g, o);
  const w = g.w, d = g.d, m = w >> 1, f = o.back;    // the vaults stand against side `back`
  // work in a turned view: (a across, b from the back wall)
  const at = (a, b) => f === NORTH ? [a, b] : f === SOUTH ? [w - 1 - a, d - 1 - b] : f === EAST ? [w - 1 - b, a] : [b, d - 1 - a];
  const face = (f + 2) & 3;
  for (let a = 1; a < w - 1; a++) for (let b = 1; b <= 3; b++) {
    const [x, z] = at(a, b);
    g.set(x, 1, z, b === 3 ? 'polished_tuff_slab' : 'chiseled_tuff', b === 3 ? { slab: 0 } : 0);
  }
  for (let a = 1; a < w - 1; a++) {
    if (a === m) continue;
    const [x, z] = at(a, 3);
    g.set(x, 2, z, 'waxed_oxidized_copper_bars'); g.set(x, 3, z, 'waxed_oxidized_copper_bars');
  }
  for (const a of [m - 2, m + 2]) {
    const [x, z] = at(a, 1);
    g.set(x, 2, z, 'vault', { f: face });
    const [x2, z2] = at(a, 2);
    g.set(x2, 1, z2, 'waxed_copper_block');
  }
  const [lx, lz] = at(m, 1);
  g.set(lx, 2, lz, 'waxed_copper_bulb');
  const [sx, sz] = at(m, 6);
  g.set(sx, 1, sz, 'chiseled_tuff'); g.set(sx, 2, sz, 'trial_spawner');
  for (const [a, b] of [[1, d - 2], [w - 2, d - 2]]) { const [x, z] = at(a, b); g.set(x, 1, z, 'decorated_pot'); }
}

// a supply room: shelves of barrels along two walls, chests
function drawSupply(g, o) {
  shell(g, o);
  const w = g.w, d = g.d, m = w >> 1;
  const walls = [NORTH, EAST, SOUTH, WEST].filter(f => !o.doors[f]);
  const barrels = [], chests = [];
  for (const f of walls.slice(0, 2)) {
    for (let i = 2; i < (f === NORTH || f === SOUTH ? w : d) - 2; i++) {
      if (Math.abs(i - m) <= 0) continue;
      const x = f === NORTH || f === SOUTH ? i : f === EAST ? w - 2 : 1;
      const z = f === EAST || f === WEST ? i : f === SOUTH ? d - 2 : 1;
      if (i % 3 === 0) { g.set(x, 1, z, 'polished_tuff'); g.set(x, 2, z, 'polished_tuff'); g.set(x, 3, z, 'chiseled_tuff'); }
      else barrels.push([x, z]);
    }
    const x = f === NORTH || f === SOUTH ? m : f === EAST ? w - 2 : 1;
    const z = f === EAST || f === WEST ? m : f === SOUTH ? d - 2 : 1;
    chests.push([x, z, (f + 2) & 3]);
  }
  g.set(m, 0, m, 'waxed_copper_grate');
  for (const [x, z] of [[2, 2], [w - 3, d - 3]]) if (!barrels.some(b => b[0] === x && b[1] === z)) g.set(x, 1, z, 'decorated_pot');
  // every barrel on the floor holds something (the others the corridor table, as the game's decor barrels do);
  // the ones stacked on them are empty, as the barrels of the game's disposal corners are
  barrels.forEach(([x, z], i) => {
    g.barrel(x, 1, z, h01(o.s, x, z, 4) < 0.5 ? 'trial_chambers/intersection_barrel' : 'trial_chambers/corridor');
    if (i % 2 === 0) g.set(x, 2, z, 'barrel');
  });
  for (const [x, z, f] of chests) g.chest(x, 1, z, 'trial_chambers/supply', f);
}

// a crossing where corridors meet: a grate in the floor, a chest and barrels
function drawCross(g, o) {
  shell(g, o);
  const w = g.w, d = g.d, m = w >> 1;
  g.fill(m - 1, 0, m - 1, m + 1, 0, m + 1, 'waxed_copper_grate');
  g.set(m, -1, m, 'waxed_copper_bulb');
  g.set(m - 1, -1, m - 1, 'tuff'); g.set(m + 1, -1, m + 1, 'tuff');
  g.set(1, 1, 1, 'decorated_pot');
  g.barrel(w - 2, 1, d - 2, 'trial_chambers/intersection_barrel');
  g.barrel(w - 2, 1, 1, 'trial_chambers/intersection_barrel');
  g.chest(1, 1, d - 2, 'trial_chambers/intersection', NORTH);
}

/* --------------------------------------------------------------- plan -- */
PLANS.trial_chambers = ctx => {
  const r = ctx.r, Y = ctx.point.y, CX = ctx.point.x, CZ = ctx.point.z;
  const salt = r.nextInt(1 << 30);
  const key = (i, j) => i + ',' + j;
  const nodes = new Map(), list = [], edges = [];
  const node = (i, j, depth) => { const n = { i, j, depth, links: [false, false, false, false] }; nodes.set(key(i, j), n); list.push(n); return n; };
  const link = (a, b, f) => { a.links[f] = true; b.links[(f + 2) & 3] = true; edges.push([a, b, f]); };
  node(0, 0, 0);
  const want = 10 + r.nextInt(4);
  for (let tries = 0; list.length < want && tries < 500; tries++) {
    const a = list[r.nextInt(list.length)], f = r.nextInt(4);
    const i = a.i + DX[f], j = a.j + DZ[f];
    if (Math.abs(i) > GRID || Math.abs(j) > GRID || nodes.has(key(i, j))) continue;
    link(a, node(i, j, a.depth + 1), f);
  }
  // a loop or two
  for (let k = 0, made = 0; k < 40 && made < 2; k++) {
    const a = list[r.nextInt(list.length)], f = r.nextInt(4);
    const b = nodes.get(key(a.i + DX[f], a.j + DZ[f]));
    if (!b || a.links[f]) continue;
    link(a, b, f); made++;
  }
  // what each room is: the deepest two hold the vaults
  list[0].kind = 'atrium';
  const rest = list.slice(1).sort((a, b) => b.depth - a.depth || (a.i - b.i) || (a.j - b.j));
  rest.forEach((n, k) => { n.kind = k < 2 ? 'vault' : ''; });
  const open = rest.filter(n => !n.kind);
  for (let k = 0; k < 2 && open.length; k++) open.splice(r.nextInt(open.length), 1)[0].kind = 'supply';
  for (const n of rest) if (!n.kind) n.kind = n.links.filter(Boolean).length >= 3 && r.nextFloat() < 0.6 ? 'cross' : 'combat';

  const out = [];
  const centre = n => [CX + n.i * SPACE, CZ + n.j * SPACE];
  const half = n => SIZE[n.kind] >> 1;

  // corridors first, rooms carve their doors over them
  edges.forEach(([a, b, f], k) => {
    const [ax, az] = centre(a), [bx, bz] = centre(b);
    const lo = f === EAST || f === SOUTH ? a : b, hi = lo === a ? b : a;
    const [lx, lz] = centre(lo);
    const alongX = f === EAST || f === WEST;
    const start = (alongX ? lx : lz) + half(lo) + 1, end = (alongX ? centre(hi)[0] : centre(hi)[1]) - half(hi) - 1;
    const L = end - start + 1;
    if (L <= 0) return;
    const chest = r.nextFloat() < 0.35, trap = !chest && h01(salt, k, 1, 8) < 0.3;
    if (alongX) out.push(new Build(TYPE, start, Y, lz - (CW >> 1), CW, CH, L, 1, drawCorridor, { s: salt, k, chest, trap }));
    else out.push(new Build(TYPE, lx - (CW >> 1), Y, start, CW, CH, L, 0, drawCorridor, { s: salt, k, chest, trap }));
  });

  // rooms
  for (const n of list) {
    const s = SIZE[n.kind], [cx, cz] = centre(n), x0 = cx - (s >> 1), z0 = cz - (s >> 1);
    const opts = { s: salt + n.i * 7 + n.j * 131, doors: n.links.slice() };
    let draw;
    switch (n.kind) {
      case 'atrium': draw = drawAtrium; break;
      case 'combat': {
        draw = drawCombat;
        const m = s >> 1, spots = [[m - 4, m - 4], [m + 4, m - 4], [m - 4, m + 4], [m + 4, m + 4], [m, m - 5], [m, m + 5], [m - 5, m], [m + 5, m]];
        const k = 2 + r.nextInt(2), pick = [];
        while (pick.length < k) { const p = spots[r.nextInt(spots.length)]; if (!pick.includes(p)) pick.push(p); }
        // the copper columns stand at m +-4 corners, so a corner pick moves in a step
        opts.spawners = pick.map(([x, z]) => [x === m - 4 ? x + 1 : x === m + 4 ? x - 1 : x, z === m - 4 ? z + 1 : z === m + 4 ? z - 1 : z]);
        break;
      }
      case 'vault': draw = drawVault; opts.back = (n.links.indexOf(true) + 2) & 3; break;
      case 'supply': draw = drawSupply; break;
      default: draw = drawCross;
    }
    out.push(new Build(TYPE, x0, Y - 3, z0, s, HEIGHT[n.kind] + 3, s, 0, (g, o) => draw(shift(g, 3), o), opts));
  }
  return out;
};

// a pen whose y starts `dy` up the box, so a room can dig below its floor
function shift(g, dy) {
  return {
    w: g.w, d: g.d, h: g.h - dy, r: g.r,
    set: (x, y, z, n, st) => g.set(x, y + dy, z, n, st),
    fill: (x0, y0, z0, x1, y1, z1, n, st) => g.fill(x0, y0 + dy, z0, x1, y1 + dy, z1, n, st),
    air: (x0, y0, z0, x1, y1, z1) => g.air(x0, y0 + dy, z0, x1, y1 + dy, z1),
    get: (x, y, z) => g.get(x, y + dy, z),
    chest: (x, y, z, t, f) => g.chest(x, y + dy, z, t, f),
    barrel: (x, y, z, t) => g.barrel(x, y + dy, z, t),
    inside: (x, y, z) => g.inside(x, y + dy, z),
    world: (x, y, z) => g.world(x, y + dy, z),
    wr: g.wr,
  };
}
