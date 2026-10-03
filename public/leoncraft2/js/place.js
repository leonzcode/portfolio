/* ---------------------------------------------------------------------------
   Leoncraft 2 - placing, using and breaking blocks with a state.

   Minecraft decides a placed block's state from where you click and which
   way you look: stairs face away from you, a slab goes in the half you
   clicked, logs lie along the face you clicked, torches and signs go on the
   wall when you click a wall, doors take two blocks and hinge on the side of
   the click. The same rules are here, writing the state into the meta byte
   the way js/models.js reads it.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=2';
import { collisionBoxes } from './models.js?v=2';

const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];     // north, east, south, west
// the horizontal way you look: 0 north, 1 east, 2 south, 3 west
export function lookFacing(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
}
const faceOf = n => (n[0] === 1 ? 0 : n[0] === -1 ? 1 : n[1] === 1 ? 2 : n[1] === -1 ? 3 : n[2] === 1 ? 4 : 5);
const horizOf = n => (n[2] === -1 ? 0 : n[0] === 1 ? 1 : n[2] === 1 ? 2 : 3);
// the wall-hung version of a block (torch -> wall_torch, oak_sign -> oak_wall_sign...)
function wallVariant(name) {
  const tries = [name.replace(/torch$/, 'wall_torch'), name.replace(/_sign$/, '_wall_sign'), name.replace(/_hanging_sign$/, '_wall_hanging_sign'),
    name.replace(/_head$/, '_wall_head'), name.replace(/_skull$/, '_wall_skull'), name.replace(/_fan$/, '_wall_fan'), name.replace(/_banner$/, '_wall_banner')];
  for (const t of tries) if (t !== name && B[t] !== undefined) return B[t];
  return undefined;
}
const SUPPORTED = new Set(['cross', 'torch', 'rail', 'wire', 'crop', 'plate', 'thin', 'candle', 'snow', 'layer', 'button', 'pot', 'sign', 'head', 'lantern']);
const ON_WALL = new Set(['wall_torch', 'ladder', 'button', 'wall_sign', 'head']);

/* Work out what to place for a click. Returns a list of [x, y, z, id, meta]
   to set (empty when it cannot go there), given the world, the pick result,
   the block in hand and the player. */
export function placement(world, hit, id, player) {
  const out = [];
  if (!hit || !hit.face) return out;
  const n = hit.face;
  let d = BLOCKS[id];
  const hd = BLOCKS[hit.b];
  const hm = world.meta(hit.x, hit.y, hit.z);
  // stacking onto the same block: a slab into a double, one more candle, another layer of snow
  if (hit.b === id) {
    if (d.shape === 'slab' && ((hm === 0 && n[1] === 1) || (hm === 1 && n[1] === -1))) return [[hit.x, hit.y, hit.z, id, 2]];
    if (d.shape === 'candle' && (hm & 3) < 3) return [[hit.x, hit.y, hit.z, id, hm + 1]];
    if (d.shape === 'layer' && (hm & 7) < 7) return [[hit.x, hit.y, hit.z, id, hm + 1]];
  }
  let x = hit.x, y = hit.y, z = hit.z;
  // clicking on grass or snow replaces it, as in the game
  if (!hd.replaceable) { x += n[0]; y += n[1]; z += n[2]; }
  const cur = world.get(x, y, z), cm = world.meta(x, y, z);
  if (cur && cur === id && d.shape === 'slab' && cm !== 2) return [[x, y, z, id, 2]];
  if (cur && !BLOCKS[cur].replaceable) return out;
  const fy = hit.hit ? hit.hit[1] - Math.floor(hit.hit[1] - (n[1] === 1 ? 1e-6 : 0)) : 0.5;   // how high up the clicked face
  const upperHalf = n[1] === -1 || (n[1] === 0 && fy > 0.5);
  const look = lookFacing(player.yaw);
  const below = world.get(x, y - 1, z);
  const solidBelow = below && BLOCKS[below].solid;
  const support = faceOf([-n[0], -n[1], -n[2]]);       // the face of the new cell that touches what was clicked
  let m = 0;
  switch (d.shape) {
    case 'slab': m = upperHalf && !/campfire$/.test(d.name) ? 1 : 0; break;
    case 'stairs': m = look | (upperHalf ? 4 : 0); break;
    case 'gate': m = look; break;
    case 'anvil': m = look; break;
    case 'chest': m = (look + 2) & 3; break;
    case 'trapdoor':
      if (n[1] === 0) m = horizOf(n) | (fy > 0.5 ? 8 : 0);
      else m = ((look + 2) & 3) | (n[1] === -1 ? 8 : 0);
      break;
    case 'door': {
      if (!solidBelow || world.get(x, y + 1, z) && !BLOCKS[world.get(x, y + 1, z)].replaceable) return out;
      // the hinge goes on the side of the click, the way the game breaks a tie
      const r = DIRS[(look + 1) & 3], hx = hit.hit ? hit.hit[0] - x - 0.5 : 0, hz = hit.hit ? hit.hit[2] - z - 0.5 : 0;
      const right = hx * r[0] + hz * r[2] > 0 ? 16 : 0;
      return [[x, y, z, id, look | right], [x, y + 1, z, id, look | 8 | right]];
    }
    case 'bed': {
      const [dx, , dz] = DIRS[look];
      const hb = world.get(x + dx, y, z + dz);
      if (hb && !BLOCKS[hb].replaceable) return out;
      return [[x, y, z, id, look], [x + dx, y, z + dz, id, look | 8]];
    }
    case 'torch': case 'sign': case 'head': {
      if (n[1] === -1 && !(d.shape === 'sign' && d.hanging)) return out;
      if (n[1] === 0) {
        const wv = wallVariant(d.name);
        if (wv === undefined) { if (d.shape === 'head') { m = 8 | horizOf(n); break; } return out; }
        return [[x, y, z, wv, support]];
      }
      if (!solidBelow && !(d.shape === 'sign' && d.hanging)) return out;
      m = d.shape === 'torch' ? 0 : (look + 2) & 3;
      break;
    }
    case 'wall_torch': case 'wall_sign': case 'ladder':
      if (n[1] !== 0) return out;
      m = support; break;
    case 'button': m = support; break;
    case 'lantern': m = n[1] === -1 ? 1 : 0; break;
    case 'rod': m = n[1] === 1 ? 4 : n[1] === -1 ? 5 : horizOf(n); break;
    case 'chain': m = n[0] ? 1 : n[2] ? 2 : 0; break;
    case 'cross': case 'crop': case 'rail': case 'wire': case 'plate': case 'pot': case 'candle': case 'cake':
      if (!solidBelow) return out;
      if (d.tall) {
        const ab = world.get(x, y + 1, z);
        if (ab && !BLOCKS[ab].replaceable) return out;
        return [[x, y, z, id, 0], [x, y + 1, z, id, 8]];
      }
      break;
    case 'pad': if (FLUID[below] !== 1) return out; break;
    case 'cube':
      if (d.orient === 'axis') m = n[0] ? 1 : n[2] ? 2 : 0;
      else if (d.orient === 'horizontal') m = (look + 2) & 3;
      else if (d.orient === 'facing') m = player.pitch < -0.8 ? 4 : player.pitch > 0.8 ? 5 : (look + 2) & 3;
      break;
  }
  // the hand-made two-block plants (tall grass and friends)
  if (d.upper) {
    const ab = world.get(x, y + 1, z);
    if (ab && !BLOCKS[ab].replaceable) return out;
    if (!solidBelow) return out;
    return [[x, y, z, id, 0], [x, y + 1, z, B[d.upper], 0]];
  }
  // never inside the player
  const boxes = d.solid ? collisionBoxes(d, m, () => null) : null;
  if (boxes && player.occupies(x, y, z, boxes)) return out;
  return [[x, y, z, id, m]];
}

/* Right click on a block that does something: doors, trapdoors and gates
   open and shut (not the iron ones, which want redstone). True if it did. */
export function use(world, x, y, z) {
  const b = world.get(x, y, z);
  if (!b) return false;
  const d = BLOCKS[b], m = world.meta(x, y, z);
  if (/^iron_/.test(d.name)) return false;
  if (d.shape === 'door') {
    const lowerY = m & 8 ? y - 1 : y;
    for (const yy of [lowerY, lowerY + 1]) if (world.get(x, yy, z) === b) world.set(x, yy, z, b, world.meta(x, yy, z) ^ 4);
    return true;
  }
  if (d.shape === 'trapdoor' || d.shape === 'gate') { world.set(x, y, z, b, m ^ 4); return true; }
  return false;
}

/* Breaking: the block, its other half, and whatever stood on it or hung from it. */
export function breakAt(world, x, y, z) {
  const b = world.get(x, y, z);
  if (!b) return [];
  const d = BLOCKS[b], m = world.meta(x, y, z);
  const gone = [[x, y, z]];
  // the other half of a door, a bed or a tall plant
  if (d.shape === 'door' || (d.tall && d.shape === 'cross')) {
    const oy = m & 8 ? y - 1 : y + 1;
    if (world.get(x, oy, z) === b) gone.push([x, oy, z]);
  }
  if (d.shape === 'bed') {
    const [dx, , dz] = DIRS[m & 3], s = m & 8 ? -1 : 1;
    if (world.get(x + dx * s, y, z + dz * s) === b) gone.push([x + dx * s, y, z + dz * s]);
  }
  if (d.upper && world.get(x, y + 1, z) === B[d.upper]) gone.push([x, y + 1, z]);
  if (d.lower && world.get(x, y - 1, z) === B[d.lower]) gone.push([x, y - 1, z]);
  // what stood on top
  const above = world.get(x, y + 1, z);
  if (above && SUPPORTED.has(BLOCKS[above].shape) && !(BLOCKS[above].shape === 'lantern' && (world.meta(x, y + 1, z) & 1))) {
    gone.push([x, y + 1, z]);
    const ad = BLOCKS[above], am = world.meta(x, y + 1, z);
    if (ad.upper || (ad.tall && !(am & 8)) || (ad.shape === 'door' && !(am & 8))) gone.push([x, y + 2, z]);
  }
  // a hanging lantern underneath
  const under = world.get(x, y - 1, z);
  if (under && BLOCKS[under].shape === 'lantern' && (world.meta(x, y - 1, z) & 1)) gone.push([x, y - 1, z]);
  // things hung on its sides, facing out of it
  const sides = [[1, 0, 0, 1], [-1, 0, 0, 0], [0, 0, 1, 5], [0, 0, -1, 4]];   // offset, and the face of that cell touching this block
  for (const [dx, , dz, face] of sides) {
    const nbk = world.get(x + dx, y, z + dz);
    if (!nbk) continue;
    const nd = BLOCKS[nbk];
    if (!ON_WALL.has(nd.shape)) continue;
    const nm = world.meta(x + dx, y, z + dz);
    if (nd.shape === 'head' ? (nm & 8) && false : (nm & 7) === face) gone.push([x + dx, y, z + dz]);
  }
  return gone;
}
