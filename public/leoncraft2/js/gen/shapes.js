/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: the features with shapes of their
   own, which the earlier rounds left out: coral trees and claws, icebergs,
   fossils, and the two placed from saved templates in 26.3's data, the
   desert well and the sulfur springs.

   None of this is the game's code, and no template of the game's is read:
   each shape is our own, drawn after what the wiki describes and the sizes
   the game's own pieces have (a fossil spine is 13 long, a skull 4 to 7
   across), from the same settings in the data (which block, which feature
   to call for each coral block, how many empty corners a fossil may have).
   So the reefs, bergs and bones stand where the data puts them and look
   like the game's, but are not block for block the same.

   Registered into FEATURES; templates by their name into TEMPLATES.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { FEATURES, strip, placePlaced, fluidOf, NOTE_TABLES, longHalves } from './features.js?v=107';
import { stateOf } from './states.js?v=107';

const MIN_Y = -64, MAX_Y = 319, SEA_LEVEL = 63;
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];          // north, east, south, west
const isAir = id => id === 0 || id === B.cave_air || id === B.void_air;
const isSolid = id => id !== 0 && BLOCKS[id].solid && !fluidOf(id);
function shuffle(list, r) {
  for (let j = list.length; j > 1; j--) { const k = r.nextInt(j); const t = list[j - 1]; list[j - 1] = list[k]; list[k] = t; }
  return list;
}
const cannot = () => {
  if (cannot.s) return cannot.s;
  const s = new Uint8Array(4096);
  for (const n of ['bedrock', 'spawner', 'chest', 'end_portal_frame', 'reinforced_deepslate', 'trial_spawner', 'vault', 'barrel'])
    if (B[n] !== undefined) s[B[n]] = 1;
  return (cannot.s = s);
};

/* ============================================================== corals == */
/* Each coral block is the feature the data hands over (a coral block of the
   reef's colour, then maybe a coral or a pickle on top and fans on its
   sides), called with its own filter: only into water, or a coral, with
   water over it. A tree and a claw only choose where those blocks go. */
const coral = (D, c, r, x, y, z) => placePlaced(D, c.feature, r, x, y, z);

// a trunk one to three high, then two to four branches climbing outwards from its top
FEATURES.coral_tree = (D, c, r, ox, oy, oz) => {
  let y = oy;
  const trunk = 1 + r.nextInt(3);
  for (let i = 0; i < trunk; i++) {
    if (!coral(D, c, r, ox, y, oz)) return i > 0;
    y++;
  }
  const dirs = shuffle([0, 1, 2, 3], r).slice(0, 2 + r.nextInt(3));
  for (const f of dirs) {
    let x = ox + DX[f], z = oz + DZ[f], by = y - 1, up = 0;
    const len = 2 + r.nextInt(5);
    for (let j = 0; j < len; j++) {
      if (!coral(D, c, r, x, by, z)) break;
      by++; up++;
      // a step outwards every second block, or now and then sooner
      if (up === 2 || r.nextFloat() < 0.25) { x += DX[f]; z += DZ[f]; up = 0; }
    }
  }
  return true;
};

// a block on the floor and two or three arms reaching out from it, bending up like fingers
FEATURES.coral_claw = (D, c, r, ox, oy, oz) => {
  if (!coral(D, c, r, ox, oy, oz)) return false;
  const dirs = shuffle([0, 1, 2, 3], r).slice(0, 2 + r.nextInt(2));
  for (const f of dirs) {
    let x = ox + DX[f], y = oy, z = oz + DZ[f];
    // along the floor first, sometimes with a kink to one side
    const along = 1 + r.nextInt(2), side = r.nextBoolean() ? (f + 1) & 3 : (f + 3) & 3, kink = r.nextInt(3) === 0;
    let ok = true;
    for (let j = 0; j < along && ok; j++) {
      ok = coral(D, c, r, x, y, z);
      if (kink && j === 0) { x += DX[side]; z += DZ[side]; } else { x += DX[f]; z += DZ[f]; }
    }
    if (!ok) continue;
    // then up and out, then straight up
    y++;
    const rise = 1 + r.nextInt(3);
    for (let j = 0; j < rise; j++) {
      if (!coral(D, c, r, x, y, z)) { ok = false; break; }
      y++;
      if (j === 0 && r.nextBoolean()) { x += DX[f]; z += DZ[f]; }
    }
  }
  return true;
};

/* ============================================================ icebergs == */
/* A berg of the configured block (packed ice, or blue ice for the rare
   blue ones) standing in the sea: a pointed or a rounded top up to about
   fifteen blocks out of the water (one in fifteen is a giant, to thirty),
   an oval waterline turned any way, and below the water a fatter body that
   rounds off before the sea floor. Some have snow blocks on their top, and
   the packed ones a few veins of blue ice inside. Only water, air, ice and
   snow are replaced: a berg never cuts into the land. */
FEATURES.iceberg = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const main = stateOf(strip(typeof c.state === 'string' ? c.state : (c.state && (c.state.Name || c.state.id)) || 'packed_ice')).id;
  const wl = SEA_LEVEL - 1;                      // the top block of the sea
  if (R.get(ox, wl, oz) !== B.water) return false;
  const snowy = r.nextDouble() > 0.7, round = r.nextInt(3) === 0, giant = r.nextInt(15) === 0;
  const H = giant ? 16 + r.nextInt(15) : 3 + r.nextInt(round ? 6 : 12);
  const Rw = Math.min(giant ? 9 + r.nextInt(5) : 4 + r.nextInt(5) + (H > 9 ? 2 : 0), 13);
  const depth = Math.max(3, Math.round(H * (0.6 + 0.5 * r.nextFloat())) + 2);
  const ang = r.nextFloat() * Math.PI, squash = 0.65 + 0.35 * r.nextFloat();
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // a ragged rim: eight lobes of their own size round the waterline
  const lobes = []; for (let i = 0; i < 8; i++) lobes.push((r.nextFloat() - 0.5) * 0.3);
  const lobe = a => { const t = (a / (Math.PI * 2) + 1) * 8, i = Math.floor(t) & 7, k = t - Math.floor(t); return lobes[i] * (1 - k) + lobes[(i + 1) & 7] * k; };
  const tip = [Math.round((r.nextFloat() - 0.5) * 2), Math.round((r.nextFloat() - 0.5) * 2)];   // a top a little off the middle
  const blueVein = main === B.packed_ice && B.blue_ice !== undefined;
  const ok = b => b === B.water || isAir(b) || b === B.ice || b === B.snow || b === B.snow_block || b === B.packed_ice;
  const rad = y => {
    if (y > wl) { const t = (y - wl) / H; return round ? Rw * Math.sqrt(Math.max(0, 1 - t * t)) : Rw * Math.pow(Math.max(0, 1 - t), 1.25); }
    const t = (wl - y) / depth;
    return Rw * 1.1 * Math.sqrt(Math.max(0, 1 - t * t));
  };
  let any = false;
  const tops = new Map();
  for (let y = wl - depth; y <= wl + H; y++) {
    const rr = rad(y);
    if (rr < 0.5) continue;
    // the pointed top leans towards its tip as it climbs
    const lean = y > wl ? (y - wl) / H : 0, cx = ox + tip[0] * lean * 2, cz = oz + tip[1] * lean * 2;
    const reach = Math.ceil(rr * 1.2) + 1;
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
      const x = Math.round(cx) + dx, z = Math.round(cz) + dz;
      const px = x - cx, pz = z - cz;
      const u = px * ca + pz * sa, v = (-px * sa + pz * ca) / squash;
      const d = Math.sqrt(u * u + v * v), lim = rr * (1 + lobe(Math.atan2(v, u)));
      if (d > lim) continue;
      const b = R.get(x, y, z);
      if (!ok(b)) continue;
      // below the water the berg stops at the sea floor
      if (y < wl && !(b === B.water || b === B.ice)) continue;
      let id = main;
      if (blueVein && y <= wl && lim - d > 2 && r.nextInt(12) === 0) id = B.blue_ice;
      R.set(x, y, z, id, 0);
      any = true;
      if (y > wl) { const k = x + ',' + z; if (!tops.has(k) || tops.get(k) < y) tops.set(k, y); }
    }
  }
  // snow on the top of each column above the water (two deep on the upper half of a tall one)
  if (snowy && B.snow_block !== undefined) for (const [k, y] of tops) {
    const [x, z] = k.split(',').map(Number);
    if (R.get(x, y, z) !== main) continue;
    R.set(x, y, z, B.snow_block, 0);
    if (y - wl > H / 2 && R.get(x, y - 1, z) === main && r.nextBoolean()) R.set(x, y - 1, z, B.snow_block, 0);
  }
  return any;
};

/* ============================================================= fossils == */
/* Bones of an old beast, buried: four spines (3, 5, 7 and 9 wide, 13 long,
   ribs every second block) and four skulls (4 to 7 across), made of bone
   blocks lying along their length, turned any way. A tenth of the bones go
   missing; in another tenth of the places coal ore has grown into them
   (diamond ore in the deep ones). A fossil is buried at least 15 blocks
   under the lowest sea or land floor over it, and not built where more than
   the allowed number of its box's eight corners would be air or water (so
   none hang in a cave). */
const SPINE = { 1: [3, 3], 2: [5, 4], 3: [7, 4], 4: [9, 5] };
const SKULL = { 1: [6, 5, 7], 2: [7, 5, 5], 3: [5, 4, 5], 4: [4, 4, 4] };
// the cells of a shape as [x, y, z, axis] (axis 0 x, 1 y, 2 z: how the bone lies), in a w x h x d box
function fossilCells(name) {
  const out = [];
  let m = /spine_(\d)/.exec(name);
  if (m) {
    const [w, h] = SPINE[m[1]], mid = w >> 1, top = h - 1;
    for (let z = 0; z < 13; z++) {
      out.push([mid, top, z, 2]);
      if (z % 2 === 0) continue;
      // a rib each side: out along the top, down the side, and in under the belly
      for (const s of [-1, 1]) {
        const xs = s < 0 ? 0 : w - 1;
        for (let k = 1; k < mid; k++) out.push([mid + s * k, top, z, 0]);
        for (let y = top - 1; y >= 1; y--) out.push([xs, y, z, 1]);
        if (w === 3) out.push([xs, 0, z, 1]);
        else if (w === 5) out.push([xs - s, 0, z, 0]);
        else for (let j = 0; j < 3; j++) out.push([xs - s * j, 0, z, 0]);
      }
    }
    return { w: SPINE[m[1]][0], h: SPINE[m[1]][1], d: 13, cells: out };
  }
  m = /skull_(\d)/.exec(name);
  const [w, h, d] = SKULL[m ? m[1] : 4];
  // a rounded head: a shell with eye holes on top of a narrower jaw
  const cx = (w - 1) / 2, cz = (d - 1) / 2;
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const ex = (x - cx) / (w / 2), ey = (y - (h - 1) / 2) / (h / 2), ez = (z - cz) / (d / 2);
    const e = ex * ex + ey * ey + ez * ez;
    if (e > 1.15) continue;
    // hollow inside
    if (e < 0.35 && h > 4) continue;
    // the eyes: two holes in the front at two thirds up
    if (z === 0 && y === h - 2 && (x === Math.floor(cx) - 1 || x === Math.ceil(cx) + 1)) continue;
    // the jaw is narrower at the bottom front
    if (y === 0 && z < d / 2 && Math.abs(x - cx) > w / 4) continue;
    out.push([x, y, z, z === 0 || z === d - 1 ? 2 : y === 0 || y === h - 1 ? 1 : 0]);
  }
  return { w, h, d, cells: out };
}
const FOSSIL_CACHE = new Map();
FEATURES.fossil = (D, c, r, ox, oy, oz) => {
  const R = D.region;
  const list = c.fossil_structures || [];
  if (!list.length || B.bone_block === undefined) return false;
  const k = r.nextInt(list.length), name = strip(list[k]);
  let shape = FOSSIL_CACHE.get(name);
  if (!shape) FOSSIL_CACHE.set(name, shape = fossilCells(name));
  const rot = r.nextInt(4);
  const W = rot & 1 ? shape.d : shape.w, Dd = rot & 1 ? shape.w : shape.d;
  // where the frame's (x, z) lands, turned about the box's corner
  const at = (x, z) => rot === 0 ? [x, z] : rot === 1 ? [shape.d - 1 - z, x] : rot === 2 ? [shape.w - 1 - x, shape.d - 1 - z] : [z, shape.w - 1 - x];
  // buried well under the lowest floor over it
  let low = MAX_Y;
  for (let x = 0; x < W; x++) for (let z = 0; z < Dd; z++) low = Math.min(low, R.height('OCEAN_FLOOR_WG', ox + x, oz + z));
  const y0 = Math.max(Math.min(oy, low - 15 - r.nextInt(10)), MIN_Y + 10);
  // too open a place: more empty corners than allowed
  let empty = 0;
  for (const [x, y, z] of [[0, 0, 0], [W - 1, 0, 0], [0, 0, Dd - 1], [W - 1, 0, Dd - 1]]) for (const yy of [y, shape.h - 1]) {
    const b = R.get(ox + x, y0 + yy, oz + z);
    if (isAir(b) || fluidOf(b)) empty++;
  }
  if (empty > (c.max_empty_corners_allowed ?? 4)) return false;
  const deep = /diamond/.test(strip(c.overlay_processors || ''));
  const ore = deep ? B.deepslate_diamond_ore : B.coal_ore;
  const cant = cannot();
  for (const [x, y, z, axis] of shape.cells) {
    const [tx, tz] = at(x, z), X = ox + tx, Y = y0 + y, Z = oz + tz;
    if (cant[R.get(X, Y, Z)]) continue;
    // a tenth of the bones gone; ore in a tenth of the places (whether the bone is there or not)
    const keep = r.nextFloat() < 0.9, oreHere = ore !== undefined && r.nextFloat() < 0.1;
    if (oreHere) { R.set(X, Y, Z, ore, 0); continue; }
    if (!keep) continue;
    // a bone lies along x or z, turned with the fossil (meta 0 up, 1 along x, 2 along z)
    const ax = axis === 1 ? 0 : ((axis === 0) !== ((rot & 1) === 1) ? 1 : 2);
    R.set(X, Y, Z, B.bone_block, ax);
  }
  return true;
};

/* =========================================================== templates == */
/* The 26.3 data places two features from saved templates. Ours draws each
   by name (TEMPLATES[name](D, r, x, y, z, cfg)), centred on the spot. */
export const TEMPLATES = {};
FEATURES.template = (D, c, r, x, y, z) => {
  const list = c.templates || [];
  let tot = 0;
  for (const e of list) tot += e.weight || 1;
  if (!tot) return false;
  let k = r.nextInt(tot), pick = list[0];
  for (const e of list) { k -= e.weight || 1; if (k < 0) { pick = e; break; } }
  const name = strip(pick.data && pick.data.id ? pick.data.id : pick.data || '');
  // (a family of templates is drawn by one function: spring/sulfur_spring_small_1 by spring/sulfur_spring)
  const fn = TEMPLATES[name] || TEMPLATES[Object.keys(TEMPLATES).find(t => name.startsWith(t))];
  return fn ? fn(D, r, x, y, z, c, name) !== false : false;
};

/* The desert well: a 5 x 5 base of sandstone three deep, a cross of water
   in the middle of its top, a low wall round the edge with a slab in the
   middle of each side, a sandstone post at each corner of the middle and
   a roof of slabs on them with a full block in its middle. (The placement
   puts the spot two under the sand's top, as the game's template sits.) */
TEMPLATES['desert_well/well'] = (D, r, ox, oy, oz) => {
  const R = D.region, ss = B.sandstone, slab = stateOf('sandstone_slab');
  const y = oy + 2;               // the sand's top: the water's level
  for (let dy = -2; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) R.set(ox + dx, y + dy, oz + dz, ss, 0);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) R.set(ox + dx, y, oz + dz, B.water, 0);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) { R.set(ox + dx, y + 1, oz + dz, 0, 0); continue; }
    const mid = dx === 0 || dz === 0;
    R.set(ox + dx, y + 1, oz + dz, mid ? slab.id : ss, mid ? slab.meta : 0);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let k = 1; k <= 3; k++) R.set(ox + dx, y + k, oz + dz, ss, 0);
  for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) for (let k = 1; k <= 3; k++) R.set(ox + dx, y + k, oz + dz, 0, 0);
  R.set(ox, y + 1, oz, 0, 0); R.set(ox, y + 2, oz, 0, 0); R.set(ox, y + 3, oz, 0, 0);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx === 0 && dz === 0) R.set(ox, y + 4, oz, ss, 0);
    else R.set(ox + dx, y + 4, oz + dz, slab.id, slab.meta);
  }
  return true;
};
// one suspicious sand, under the well's water, holding the well's find
TEMPLATES['desert_well/suspicious_sand'] = (D, r, x, y, z) => {
  const R = D.region;
  if (B.suspicious_sand === undefined) return false;
  R.set(x, y, z, B.suspicious_sand, 0);
  const [hi, lo] = longHalves(r.nextLong());
  R.note(x, y, z, 1 + NOTE_TABLES.indexOf('archaeology/desert_well'), hi, lo);
  return true;
};

/* A sulfur spring: a round pool sunk into the ground, the water's top level
   with it, deepest in the middle, held in a shell of sulfur (walls stand
   out of a slope rather than let the water run), wet potent sulfur over
   the bottom of its deep middle and a low sulfur rim here and there.
   Small, medium, large and extra large are about 5, 8, 12 and 15 across. */
TEMPLATES['spring/sulfur_spring'] = (D, r, ox, oy, oz, c, name) => {
  const R = D.region;
  if (B.sulfur === undefined) return false;
  const size = /extra_large/.test(name) ? 3 : /large/.test(name) ? 2 : /medium/.test(name) ? 1 : 0;
  const rad = [2.4, 3.8, 5.6, 7.2][size] + r.nextFloat() * 0.8, depth = [2, 3, 4, 5][size] + r.nextInt(2);
  const top = oy + 7 - 1;             // the template sits seven under the spot; the water is level with the ground
  if (!isSolid(R.get(ox, top, oz))) return false;
  const potent = stateOf({ Name: 'potent_sulfur', Properties: { potent_sulfur_state: 'wet' } });
  const lobes = []; for (let i = 0; i < 6; i++) lobes.push((r.nextFloat() - 0.5) * 0.35);
  const edge = a => { const t = (a / (Math.PI * 2) + 1) * 6, i = Math.floor(t) % 6, k = t - Math.floor(t); return lobes[i] * (1 - k) + lobes[(i + 1) % 6] * k; };
  const water = new Map();
  const n = Math.ceil(rad * 1.25);
  for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
    const d = Math.hypot(dx, dz) / (rad * (1 + edge(Math.atan2(dz, dx))));
    if (d > 1) continue;
    const dd = Math.max(1, Math.round(depth * Math.sqrt(1 - d * d)));
    water.set(dx + ',' + dz, dd);
  }
  const cant = cannot();
  const put = (x, y, z, id, meta) => { if (!cant[R.get(x, y, z)]) R.set(x, y, z, id, meta || 0); };
  for (const [k, dd] of water) {
    const [dx, dz] = k.split(',').map(Number), x = ox + dx, z = oz + dz;
    for (let y = top; y > top - dd; y--) put(x, y, z, B.water, 0);
    // air over the pool (the ground it was sunk into)
    for (let y = top + 1; y <= top + 2; y++) if (isSolid(R.get(x, y, z))) put(x, y, z, 0, 0);
    // its floor: potent sulfur over the deep middle, sulfur elsewhere
    const floor = top - dd;
    if (dd >= depth - 1 && potent.id !== B.stone) put(x, floor, z, potent.id, potent.meta); else put(x, floor, z, B.sulfur, 0);
    put(x, floor - 1, z, B.sulfur, 0);
    // walls where the water meets anything that is not more of it
    for (let f = 0; f < 4; f++) {
      const nx = dx + DX[f], nz = dz + DZ[f];
      const nd = water.get(nx + ',' + nz) || 0;
      for (let y = top; y > top - dd; y--) {
        if (top - y < nd) continue;
        const b = R.get(ox + nx, y, oz + nz);
        if (b !== B.water) put(ox + nx, y, oz + nz, B.sulfur, 0);
      }
      // a low rim on the ground round the pool, here and there
      if (!nd && r.nextInt(3) === 0 && isAir(R.get(ox + nx, top + 1, oz + nz))) put(ox + nx, top + 1, oz + nz, B.sulfur, 0);
    }
  }
  return true;
};
