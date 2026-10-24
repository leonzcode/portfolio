/* ---------------------------------------------------------------------------
   Leoncraft 2 - the light levels in a block, as the game looks them up for
   something in it (the player's eyes, a dropped item's middle).

   The chunk's own light, sky * 16 + block, flooded in the workers along with
   its mesh (mesher.js), so light reaches under an overhang, round a corner
   and into a cave's mouth the way the game spreads it, a level less a block.
   A column not meshed yet has no light worked out: there it is open to the
   sky or not, by what is stacked over the block.

   src is anything with chunkAt(x, z) (a World, or the player model's own
   chunk cache); noSky is the Nether, which has no sky light at all.
--------------------------------------------------------------------------- */
import { OPACITY, OPAQUE } from './blocks.js?v=107';
import { H } from './world-const.js?v=107';

export function lightLevel(src, x, y, z, noSky) {
  const open = noSky ? 0 : 0xf0;
  if (y >= H) return open;
  if (y < 0) return 0;
  const c = src.chunkAt(x, z);
  if (!c) return open;
  const lx = x - c.cx * 16, lz = z - c.cz * 16;
  if (c.light) return y >= c.lightH ? open : c.light[(y << 8) | (lz << 4) | lx];
  if (noSky) return 0;
  let s = 15;
  for (let yy = y + 1; yy <= c.top && s > 0; yy++) { const b = c.blocks[(yy << 8) | (lz << 4) | lx]; if (b) s -= OPACITY[b]; }
  return Math.max(0, s) << 4;
}

/* The same for something whose middle has gone into a full block (pushed
   into a wall, the camera's body in spectator, an item landing in a block
   just put down): a full block holds no light, so the game would draw it
   black; this takes the brightest open block next to it instead. */
export function lightNear(src, x, y, z, noSky) {
  const c = src.chunkAt(x, z);
  if (!c || y < 0 || y >= H || !OPAQUE[c.blocks[(y << 8) | ((z - c.cz * 16) << 4) | (x - c.cx * 16)]]) return lightLevel(src, x, y, z, noSky);
  let sky = 0, bl = 0;
  for (const [dx, dy, dz] of NEXT) {
    const xx = x + dx, yy = y + dy, zz = z + dz, n = src.chunkAt(xx, zz);
    if (n && yy >= 0 && yy < H && OPAQUE[n.blocks[(yy << 8) | ((zz - n.cz * 16) << 4) | (xx - n.cx * 16)]]) continue;
    const v = lightLevel(src, xx, yy, zz, noSky);
    if ((v >> 4) > sky) sky = v >> 4;
    if ((v & 15) > bl) bl = v & 15;
  }
  return (sky << 4) | bl;
}
const NEXT = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
