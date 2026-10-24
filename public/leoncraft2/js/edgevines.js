/* ---------------------------------------------------------------------------
   Leoncraft 2 - vines and lichen along a chunk's edge.

   The world's making checks what a vine holds on to inside its own chunk
   only (vanillagen.js settle keeps a face that looks over the edge), and the
   trees of the chunk beside it that it planned for (features.js treePlan)
   can come out otherwise when that chunk is made, so now and then a vine is
   left on the face of a leaf that never grew: floating, until a random tick
   found it. So when a chunk arrives, the vines along each edge it shares
   with a chunk already here are looked at again by the game's rules: a side
   holds by a whole block that way or by the vine above having that side,
   the top by a whole block above; a vine with no face left goes, and the
   vines that hung from it are looked at in turn. Glow lichen, sculk veins
   and resin clumps the same, each face by a whole block. The blocks are
   changed as the world's making would have left them (no edit kept, no
   update sent), before any of these columns is drawn: a column is meshed
   only once all eight round it are here.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from './blocks.js?v=107';
import { CH, H } from './world-const.js?v=107';

const SIDES = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];        // dx, dz, vine bit (models.js VINE_SIDES)
const MDIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];   // models.js MULTI_DIRS
// what to look at: 1 a vine, 2 a multiface block
const KIND = new Uint8Array(65536);
if (B.vine !== undefined) KIND[B.vine] = 1;
for (const n of ['glow_lichen', 'sculk_vein', 'resin_clump']) if (B[n] !== undefined) KIND[B[n]] = 2;
const whole = b => { const d = b && BLOCKS[b]; return !!d && d.solid && d.shape === 'cube'; };

export function settleEdges(w, c) {
  const V = B.vine;
  if (V === undefined) return;
  const holds = (x, y, z) => !w.loaded(x, z) || whole(w.get(x, y, z));
  const put = (x, y, z, b, m) => {
    const k = w.chunkAt(x, z), i = (y << 8) | ((z - k.cz * CH) << 4) | (x - k.cx * CH);
    k.blocks[i] = b; k.meta[i] = m;
  };
  // a vine at x, y, z: the faces that still hold; with none it goes, and the one under it is looked at next
  const vine = (x, y, z) => {
    for (; y > 0 && w.get(x, y, z) === V; y--) {
      const m = w.meta(x, y, z) & 31;
      if (!m) return;                    // (a structure's vine keeps no faces: it is drawn against what is round it)
      const a = w.get(x, y + 1, z) === V ? (w.meta(x, y + 1, z) & 15) || 15 : 0;
      let k = 0;
      for (const [dx, dz, bit] of SIDES) if ((m & bit) && (holds(x + dx, y, z + dz) || (a & bit))) k |= bit;
      if ((m & 16) && holds(x, y + 1, z)) k |= 16;
      if (k === m) return;
      put(x, y, z, k ? V : 0, k);
    }
  };
  const multi = (x, y, z, id) => {
    const m = w.meta(x, y, z) & 63;
    if (!m) return;
    let k = 0;
    for (let d = 0; d < 6; d++) if ((m & (1 << d)) && holds(x + MDIRS[d][0], y + MDIRS[d][1], z + MDIRS[d][2])) k |= 1 << d;
    if (k !== m) put(x, y, z, k ? id : 0, k);
  };
  // one chunk's cells along an edge (lx or lz fixed) with a face on the chunk that way (fx, fz)
  const edge = (k, fx, fz) => {
    const x0 = k.cx * CH, z0 = k.cz * CH, top = Math.min(H - 1, k.top + 1), bl = k.blocks, me = k.meta;
    const vb = fx > 0 ? 2 : fx < 0 ? 8 : fz > 0 ? 4 : 1, mb = fx > 0 ? 32 : fx < 0 ? 16 : fz > 0 ? 8 : 4;
    for (let j = 0; j < CH; j++) {
      const lx = fx < 0 ? 0 : fx > 0 ? CH - 1 : j, lz = fz < 0 ? 0 : fz > 0 ? CH - 1 : j;
      for (let y = top, i = (top << 8) | (lz << 4) | lx; y > 0; y--, i -= 256) {
        const t = KIND[bl[i]];
        if (!t) continue;
        if (t === 1) { if (me[i] & vb) vine(x0 + lx, y, z0 + lz); }
        else if (me[i] & mb) multi(x0 + lx, y, z0 + lz, bl[i]);
      }
    }
  };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = w.chunkXZ(c.cx + dx, c.cz + dz);
    if (!n) continue;
    edge(c, dx, dz);
    edge(n, -dx, -dz);
  }
}
