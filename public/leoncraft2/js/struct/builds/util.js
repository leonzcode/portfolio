/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: small helpers shared by our structure designs.

   Reading the land: a plan measures the ground under a footprint once, in
   the plan function, and hands the height it picked to its boxes through
   opts, so every chunk a box crosses builds it at the same height.

   Placing boxes: make() is the Build constructor with the corner already
   worked out for a box centred on a point, and turned() gives the size of
   a footprint after a turn.

   Drawing: doors and beds are two blocks, a gable roof is rows of stairs
   meeting at a ridge, and the rest are tiny conveniences used everywhere.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { JRand } from '../rand.js?v=107';

export { Build, NORTH, EAST, SOUTH, WEST, JRand };

export const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
export const opp = f => (f + 2) & 3;
export const cw = f => (f + 1) & 3;
export const ccw = f => (f + 3) & 3;

/* ---------------------------------------------------------- the land -- */
// the ground under a w x d footprint from (x0, z0): lowest, highest, middle value and the mean
export function footprint(ctx, x0, z0, w, d, step) {
  step = step || 1;
  const hs = [];
  for (let x = x0; x < x0 + w; x += step) for (let z = z0; z < z0 + d; z += step) hs.push(ctx.ground(x, z));
  // always the far corners too
  hs.push(ctx.ground(x0 + w - 1, z0), ctx.ground(x0, z0 + d - 1), ctx.ground(x0 + w - 1, z0 + d - 1));
  hs.sort((a, b) => a - b);
  let sum = 0;
  for (const h of hs) sum += h;
  return { min: hs[0], max: hs[hs.length - 1], med: hs[hs.length >> 1], mean: Math.round(sum / hs.length) };
}
// the same, counting water as the top (the surface a thing floats on)
export function surfacePrint(ctx, x0, z0, w, d, step) {
  return footprint({ ground: (x, z) => ctx.surface(x, z) }, x0, z0, w, d, step);
}

/* --------------------------------------------------------------- boxes -- */
// the footprint (along x, along z) of a w x d box after rot quarter turns
export function turned(w, d, rot) { return rot & 1 ? [d, w] : [w, d]; }
// a Build whose turned footprint is centred on (cx, cz), standing on y0
export function make(type, cx, y0, cz, w, h, d, rot, draw, opts) {
  const [W, D] = turned(w, d, rot);
  return new Build(type, cx - (W >> 1), y0, cz - (D >> 1), w, h, d, rot, draw, opts);
}
// a Build from its turned corner (the same as new Build, kept for symmetry)
export function at(type, x0, y0, z0, w, h, d, rot, draw, opts) {
  return new Build(type, x0, y0, z0, w, h, d, rot, draw, opts);
}
// the world rectangle a Build covers, as [x0, z0, x1, z1]
export function rect(b) { return [b.box.x0, b.box.z0, b.box.x1, b.box.z1]; }
export function overlaps(a, b, gap) {
  gap = gap || 0;
  return a[0] - gap <= b[2] && a[2] + gap >= b[0] && a[1] - gap <= b[3] && a[3] + gap >= b[1];
}
// a random kept apart from the plan's: draw() may use it in any order without
// upsetting the per-chunk g.r (g.chest only takes from g.r inside its chunk)
export function rng(seed) { return new JRand(BigInt(seed | 0)); }

/* ------------------------------------------------------------- drawing -- */
// a door, both halves, facing f (the way you look when walking out of it)
export function door(g, x, y, z, name, f, right) {
  g.set(x, y, z, name, { f, right: !!right });
  g.set(x, y + 1, z, name, { f, upper: true, right: !!right });
}
// a bed with its foot at (x, y, z) and its head one step towards f
export function bed(g, x, y, z, colour, f) {
  const name = (colour || 'red') + '_bed';
  g.set(x, y, z, name, { f });
  g.set(x + DX[f], y, z + DZ[f], name, { f, head: true });
}
// a wall torch on the block behind it, facing f (out from the wall)
export function torch(g, x, y, z, f) { g.set(x, y, z, 'wall_torch', { f }); }
// a lantern standing (or hanging under a block)
export function lantern(g, x, y, z, hanging, soul) { g.set(x, y, z, soul ? 'soul_lantern' : 'lantern', hanging ? { m: 1 } : 0); }
// fill each column of a rectangle down to the ground (foundations)
export function footing(g, x0, z0, x1, z1, y, name) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) g.down(x, y, z, name);
}
/* A gable roof whose eaves run along z at x0 and x1 (overhang included),
   from z0 to z1: stairs climbing in from both sides starting at y, and on an
   odd width a ridge of slabs (or `ridge` blocks). The triangle under it is
   filled with `gable` at each z in `ends` (the end walls), if given. */
export function gableZ(g, x0, x1, z0, z1, y, stairs, ridge, gable, ends) {
  const w = x1 - x0 + 1, half = w >> 1;
  for (let i = 0; i < half; i++) {
    for (let z = z0; z <= z1; z++) {
      g.set(x0 + i, y + i, z, stairs, { f: EAST });
      g.set(x1 - i, y + i, z, stairs, { f: WEST });
    }
    if (gable && ends) for (const z of ends) for (let x = x0 + i + 1; x <= x1 - i - 1; x++) g.set(x, y + i, z, gable);
  }
  if (w & 1) for (let z = z0; z <= z1; z++) g.set(x0 + half, y + half, z, ridge || stairs.replace('_stairs', '_slab'), ridge ? 0 : { slab: 0 });
}
// the same with the eaves along x at z0 and z1, the ridge running along x
export function gableX(g, x0, x1, z0, z1, y, stairs, ridge, gable, ends) {
  const d = z1 - z0 + 1, half = d >> 1;
  for (let i = 0; i < half; i++) {
    for (let x = x0; x <= x1; x++) {
      g.set(x, y + i, z0 + i, stairs, { f: SOUTH });
      g.set(x, y + i, z1 - i, stairs, { f: NORTH });
    }
    if (gable && ends) for (const x of ends) for (let z = z0 + i + 1; z <= z1 - i - 1; z++) g.set(x, y + i, z, gable);
  }
  if (d & 1) for (let x = x0; x <= x1; x++) g.set(x, y + half, z0 + half, ridge || stairs.replace('_stairs', '_slab'), ridge ? 0 : { slab: 0 });
}
// scatter a block over a box with chance p (from a random of the caller's)
export function scatter(g, r, p, x0, y0, z0, x1, y1, z1, name, state) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++)
    if (r.nextFloat() < p) g.set(x, y, z, name, state);
}
// replace some of a box's existing non-air blocks (weathering, moss, cracks)
export function weather(g, r, p, x0, y0, z0, x1, y1, z1, from, to) {
  const list = Array.isArray(from) ? from : [from];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const roll = r.nextFloat();
    if (roll >= p) continue;
    for (let i = 0; i < list.length; i++) if (g.is(x, y, z, list[i])) { g.set(x, y, z, Array.isArray(to) ? to[i] : to); break; }
  }
}
