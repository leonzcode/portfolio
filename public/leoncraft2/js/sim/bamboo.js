/* ---------------------------------------------------------------------------
   Leoncraft 2 - bamboo's state and growth, as the game's BambooStalkBlock
   (read from the 26.1.2 jar): random ticks, bone meal and placing it.

   Meta (models.js): bit 0 age (thick), bit 3 stage (it will grow no more),
   bits 4-5 leaves: 0 none, 1 small, 2 large. Bit 2 is left over from old
   saves (bamboo was a rod standing up, meta 4) and means nothing.

   Growing puts a block on top whose leaves depend on the two below: on a bare
   stalk small leaves; on one with leaves large ones, and then the one below
   steps down to small and the one under that to none, so a grown stalk ends
   in two large and one small. It is thick (age 1) when the stalk is thick or
   at least two tall, and done (stage 1) at 16 tall, or with a 1 in 4 chance
   from 11.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';

export const AGE = 1, STAGE = 8, LEAVES_SHIFT = 4;
export const NONE = 0, SMALL = 1, LARGE = 2;
export const leavesOf = m => (m >> LEAVES_SHIFT) & 3;
export const bambooMeta = (age, leaves, stage) => (age ? AGE : 0) | (stage ? STAGE : 0) | (leaves << LEAVES_SHIFT);
const withLeaves = (m, l) => (m & ~(3 << LEAVES_SHIFT) & ~4) | (l << LEAVES_SHIFT);

// how many bamboo blocks above / below (up to 16, as the game counts)
export function heightAbove(s, x, y, z) { let h = 0; while (h < 16 && s.get(x, y + h + 1, z) === B.bamboo) h++; return h; }
export function heightBelow(s, x, y, z) { let h = 0; while (h < 16 && s.get(x, y - h - 1, z) === B.bamboo) h++; return h; }

// growBamboo: a block on top of the one at x, y, z (meta m), the stalk `height` tall with it; rand() is 0..1
export function growBamboo(s, x, y, z, m, height, rand) {
  const b1 = s.get(x, y - 1, z), m1 = s.meta(x, y - 1, z), b2 = s.get(x, y - 2, z), m2 = s.meta(x, y - 2, z);
  let leaves = NONE;
  if (height >= 1) {
    if (b1 !== B.bamboo || leavesOf(m1) === NONE) leaves = SMALL;
    else {
      leaves = LARGE;
      if (b2 === B.bamboo) { s.set(x, y - 1, z, B.bamboo, withLeaves(m1, SMALL)); s.set(x, y - 2, z, B.bamboo, withLeaves(m2, NONE)); }
    }
  }
  const age = (m & AGE) || b2 === B.bamboo ? 1 : 0;
  const stage = (height >= 11 && rand() < 0.25) || height === 15 ? 1 : 0;
  s.set(x, y + 1, z, B.bamboo, bambooMeta(age, leaves, stage));
}

// a random tick: a 1 in 3 chance, with air and light 9 above, while the stalk is under 16
export function randomTick(s, x, y, z, m, rand, airAbove, lightAbove) {
  if (m & STAGE) return;
  if (Math.floor(rand() * 3) !== 0 || !airAbove || lightAbove < 9) return;
  const h = heightBelow(s, x, y, z) + 1;
  if (h < 16) growBamboo(s, x, y, z, m, h, rand);
}

// bone meal on any block of the stalk: one or two blocks on top, stopping at 16, a finished top or something above
export function boneMeal(s, x, y, z, rand, isAir) {
  let i = heightAbove(s, x, y, z), k = i + heightBelow(s, x, y, z) + 1;
  const n = 1 + Math.floor(rand() * 2);
  let made = false;
  for (let j = 0; j < n; j++) {
    const ty = y + i, tm = s.meta(x, ty, z);
    if (k >= 16 || (tm & STAGE) || !isAir(x, ty + 1, z)) break;
    growBamboo(s, x, ty, z, tm, k, rand);
    made = true; i++; k++;
  }
  return made;
}

/* What placing bamboo makes (getStateForPlacement): on a sapling a thin stalk, on bamboo one as thick as the
   block below, on other ground a stalk as thick as bamboo above it, else a sapling. [block, meta] */
export function placed(below, belowMeta, above, aboveMeta) {
  if (below === B.bamboo_sapling) return [B.bamboo, 0];
  if (below === B.bamboo) return [B.bamboo, (belowMeta & AGE) ? AGE : 0];
  if (above === B.bamboo) return [B.bamboo, aboveMeta & AGE];
  return [B.bamboo_sapling !== undefined ? B.bamboo_sapling : B.bamboo, 0];
}
