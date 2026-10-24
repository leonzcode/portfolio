/* ---------------------------------------------------------------------------
   Leoncraft 2 - nether portals and end portal frames.

   Nether portals, as the Minecraft Wiki describes them:
     a frame      obsidian round an empty inside 2 to 21 wide and 3 to 21
                  tall (outside 4 x 5 to 23 x 23), corners not needed
     lighting     fire inside a frame (flint and steel, a fire charge, fire
                  placed or spreading there) fills it with portal, along x
                  or along z, in the Overworld or the Nether only
     breaking     a portal whose frame is no longer whole goes out
     the way      the destination is the position x 8 or / 8 (y the same);
                  the nearest portal there (straight-line distance, y
                  included) within 128 blocks each way in the Overworld or 16
                  in the Nether is used, else one is built: on the nearest
                  spot within 16 blocks with 3 x 4 solid floor and 4 of air
                  above it, else 1 x 4, else hanging at the spot (y kept
                  between 70 and 10 below the top) on an obsidian ledge
   End portal frames take an eye of ender each (meta bit 2); twelve with eyes
   round a 3 x 3 space fill it with end portal.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';

const empty = b => b === 0 || b === B.fire || b === B.soul_fire || b === B.nether_portal;
const obs = b => b === B.obsidian;

/* The portal frame round an inside cell, along 'x' or 'z': { x, y, z, w, h, axis }
   (x, y, z the inside's lowest, first cell) or null. */
export function portalShape(world, x, y, z, axis) {
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0;
  const get = (a, b, c) => world.get(a, b, c);
  if (!empty(get(x, y, z))) return null;
  let by = y, n = 0;
  while (n++ < 22 && empty(get(x, by - 1, z))) by--;
  if (!obs(get(x, by - 1, z))) return null;
  let lx = x, lz = z; n = 0;
  while (n++ < 22 && empty(get(lx - dx, by, lz - dz))) { lx -= dx; lz -= dz; }
  if (!obs(get(lx - dx, by, lz - dz))) return null;
  let w = 0;
  while (w <= 21 && empty(get(lx + dx * w, by, lz + dz * w)) && obs(get(lx + dx * w, by - 1, lz + dz * w))) w++;
  if (w < 2 || w > 21 || !obs(get(lx + dx * w, by, lz + dz * w))) return null;
  let h = 0;
  rows: for (; h <= 21; h++) {
    if (!obs(get(lx - dx, by + h, lz - dz)) || !obs(get(lx + dx * w, by + h, lz + dz * w))) break;
    for (let i = 0; i < w; i++) if (!empty(get(lx + dx * i, by + h, lz + dz * i))) break rows;
  }
  if (h < 3 || h > 21) return null;
  for (let i = 0; i < w; i++) if (!obs(get(lx + dx * i, by + h, lz + dz * i))) return null;
  // the start cell must be inside what was found
  const along = axis === 'x' ? x - lx : z - lz;
  if (along < 0 || along >= w || y < by || y >= by + h) return null;
  return { x: lx, y: by, z: lz, w, h, axis };
}
export function shapeCells(s) {
  const out = [], dx = s.axis === 'x' ? 1 : 0, dz = s.axis === 'z' ? 1 : 0;
  for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) out.push([s.x + dx * i, s.y + j, s.z + dz * i]);
  return out;
}
// fill a frame with portal (meta: 1 along x, 2 along z)
export function lightShape(world, s) {
  for (const [x, y, z] of shapeCells(s)) world.set(x, y, z, B.nether_portal, s.axis === 'x' ? 1 : 2);
}
// fire at a cell: light a portal round it if there is a frame, along x first
export function tryLight(world, x, y, z) {
  for (const axis of ['x', 'z']) {
    const s = portalShape(world, x, y, z, axis);
    if (s) { lightShape(world, s); return s; }
  }
  return null;
}
// a portal block next to a change: still in a whole frame? if not, the portal goes out (returns the shape removed)
export function checkPortal(world, x, y, z) {
  if (world.get(x, y, z) !== B.nether_portal) return null;
  const axis = world.meta(x, y, z) === 2 ? 'z' : 'x';
  const s = portalShape(world, x, y, z, axis);
  if (s) return null;
  // flood the connected portal of the same axis
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0;
  const seen = new Set(), stack = [[x, y, z]], gone = [];
  while (stack.length && gone.length < 1000) {
    const [a, b, c] = stack.pop(), k = a + ',' + b + ',' + c;
    if (seen.has(k)) continue;
    seen.add(k);
    if (world.get(a, b, c) !== B.nether_portal) continue;
    world.set(a, b, c, 0, 0);
    gone.push([a, b, c]);
    stack.push([a + dx, b, c + dz], [a - dx, b, c - dz], [a, b + 1, c], [a, b - 1, c]);
  }
  return gone;
}

/* ---- building a portal where none is found ---- */
const solidFloor = b => b && BLOCKS[b].solid && BLOCKS[b].shape === 'cube' && !BLOCKS[b].fluid;
const airy = b => b === 0 || (BLOCKS[b] && BLOCKS[b].replaceable && !BLOCKS[b].fluid);
// can a portal stand with its inside's first cell at (x, y, z)? depth 3 is the full 3 x 4 test, 1 the narrow one
function fits(world, x, y, z, axis, depth) {
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0, ax = dz, az = dx;     // along, and across
  const k0 = depth === 3 ? -1 : 0, k1 = depth === 3 ? 1 : 0;
  for (let i = -1; i <= 2; i++) for (let k = k0; k <= k1; k++) {
    const fx = x + dx * i + ax * k, fz = z + dz * i + az * k;
    if (!solidFloor(world.get(fx, y - 1, fz))) return false;
    for (let j = 0; j < 4; j++) if (!airy(world.get(fx, y + j, fz))) return false;
  }
  return true;
}
/* Find somewhere to build near (tx, ty, tz) within 16 blocks, between yLo
   and yHi (engine y): the nearest full fit, else the nearest narrow one. */
export function findBuildSpot(world, tx, ty, tz, axis, yLo, yHi) {
  let best = null, bd = 1e18, bestN = null, bdN = 1e18;
  for (let dz = -16; dz <= 16; dz++) for (let dx = -16; dx <= 16; dx++) {
    const x = tx + dx, z = tz + dz;
    if (!world.loaded(x, z) || !world.loaded(x + 3, z + 3) || !world.loaded(x - 3, z - 3)) continue;
    for (let y = yHi; y >= yLo; y--) {
      if (!airy(world.get(x, y, z)) || !solidFloor(world.get(x, y - 1, z))) continue;
      const d = dx * dx + dz * dz + (y - ty) * (y - ty);
      if (d < bd && fits(world, x, y, z, axis, 3)) { bd = d; best = [x, y, z]; }
      else if (!best && d < bdN && fits(world, x, y, z, axis, 1)) { bdN = d; bestN = [x, y, z]; }
    }
  }
  return best || bestN;
}
/* Build a 4 x 5 obsidian frame with a lit 2 x 3 inside, its inside's first
   cell at (x, y, z); `ledge` also lays obsidian under the sides and clears
   the air there (the hanging fallback). Returns the shape. */
export function buildPortal(world, x, y, z, axis, ledge) {
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0, ax = dz, az = dx;
  if (ledge) {
    for (let i = 0; i <= 1; i++) for (const k of [-1, 1]) {
      world.set(x + dx * i + ax * k, y - 1, z + dz * i + az * k, B.obsidian, 0);
      for (let j = 0; j < 3; j++) world.set(x + dx * i + ax * k, y + j, z + dz * i + az * k, 0, 0);
    }
  }
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const frame = i === -1 || i === 2 || j === -1 || j === 3;
    world.set(x + dx * i, y + j, z + dz * i, frame ? B.obsidian : B.nether_portal, frame ? 0 : axis === 'x' ? 1 : 2);
  }
  return { x, y, z, w: 2, h: 3, axis };
}

/* ---- end portal frames ---- */
// after an eye goes into the frame at (x, y, z): twelve frames with eyes round a 3 x 3 space light it
export function tryEndPortal(world, x, y, z) {
  const eye = (a, c) => world.get(a, y, c) === B.end_portal_frame && (world.meta(a, y, c) & 4);
  for (let cz = z - 2; cz <= z + 2; cz++) for (let cx = x - 2; cx <= x + 2; cx++) {
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) {
      if (!eye(cx + i, cz - 2) || !eye(cx + i, cz + 2) || !eye(cx - 2, cz + i) || !eye(cx + 2, cz + i)) ok = false;
    }
    if (!ok) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.set(cx + dx, y, cz + dz, B.end_portal, 0);
    return { x: cx, y, z: cz };
  }
  return null;
}
