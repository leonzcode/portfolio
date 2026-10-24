/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: dungeons (the game's monster rooms).

   Not a structure in the game but a feature: 10 tries a chunk anywhere
   from the bottom to the top of the world, and 4 more down in the
   deepslate. A try only becomes a room where the floor and ceiling are
   solid all over and the walls are open to a cave in 1 to 5 places, so
   dungeons turn up off caves. The room is 5 to 7 blocks each way inside
   (4 tall), cobblestone with a floor of mostly mossy cobblestone, a spawner
   in the middle (zombie half the time, skeleton or spider otherwise) and up
   to two chests against the walls.

   The rules are the game's (MonsterRoomFeature); the tries come from our
   own random, so dungeons are not where the real game would put them. Each
   room is kept inside its chunk, which the game does not need to do.

   Rooms are made with the structures, before any feature, so every block
   of one is marked in `mask` when it is given: the game places its lakes
   before its dungeons, so a lake never opens a room's floor there, and the
   few features made before the structures here keep off it the same way.
--------------------------------------------------------------------------- */
import { JRand, hash32 } from './rand.js?v=107';
import { B, BLOCKS } from '../blocks.js?v=107';
import { Y0, H, idx } from '../world-const.js?v=107';

const MOBS = ['skeleton', 'zombie', 'zombie', 'spider'];
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];

export function dungeons(seed, blocks, meta, cx, cz, mask) {
  const r = new JRand(BigInt(hash32(cx, cz, 0x6d6f6e)) ^ seed);
  const solid = (x, y, z) => { if (y < 0 || y >= H) return false; const b = blocks[idx(x, y, z)]; return b !== 0 && BLOCKS[b].solid && !BLOCKS[b].fluid; };
  const empty = (x, y, z) => y >= 0 && y < H && blocks[idx(x, y, z)] === 0;
  let top = 0;
  for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]) { top = i >> 8; break; }
  const out = { chests: [], spawners: [] };
  for (let n = 0; n < 14; n++) {
    const ox = 4 + r.nextInt(8), oz = 4 + r.nextInt(8);
    // (index y: the deep ones run from 6 above the bottom, y -58, to y -1)
    const oy = n < 10 ? r.nextInt(Math.max(1, top)) : 6 + r.nextInt(-1 - Y0 - 6 + 1);
    if (oy < 2 || oy > H - 6) continue;
    const j = r.nextInt(2) + 2, k = -j - 1, l = j + 1;
    const o = r.nextInt(2) + 2, p = -o - 1, q = o + 1;
    let holes = 0, ok = true;
    for (let x = k; x <= l && ok; x++) for (let y = -1; y <= 4 && ok; y++) for (let z = p; z <= q; z++) {
      const X = ox + x, Y = oy + y, Z = oz + z;
      const s = solid(X, Y, Z);
      if ((y === -1 || y === 4) && !s) { ok = false; break; }
      if ((x === k || x === l || z === p || z === q) && y === 0 && empty(X, Y, Z) && empty(X, Y + 1, Z)) holes++;
    }
    if (!ok || holes < 1 || holes > 5) continue;
    for (let x = k; x <= l; x++) for (let y = 3; y >= -1; y--) for (let z = p; z <= q; z++) {
      const X = ox + x, Y = oy + y, Z = oz + z, i = idx(X, Y, Z);
      if (x === k || y === -1 || z === p || x === l || y === 4 || z === q) {
        if (Y > 0 && !solid(X, Y - 1, Z)) { blocks[i] = 0; meta[i] = 0; if (mask) mask[i] = 1; continue; }
        if (!solid(X, Y, Z) || blocks[i] === B.chest) continue;
        blocks[i] = y === -1 && r.nextInt(4) !== 0 ? B.mossy_cobblestone : B.cobblestone; meta[i] = 0;
        if (mask) mask[i] = 1;
        continue;
      }
      if (blocks[i] === B.chest || blocks[i] === B.spawner) continue;
      blocks[i] = 0; meta[i] = 0;
      if (mask) mask[i] = 1;
    }
    for (let s = 0; s < 2; s++) for (let t = 0; t < 3; t++) {
      const u = ox + r.nextInt(j * 2 + 1) - j, w = oz + r.nextInt(o * 2 + 1) - o;
      if (!empty(u, oy, w)) continue;
      let walls = 0, face = 2;
      for (let d = 0; d < 4; d++) if (solid(u + DX[d], oy, w + DZ[d])) { walls++; face = (d + 2) & 3; }
      if (walls !== 1) continue;
      const i = idx(u, oy, w);
      blocks[i] = B.chest; meta[i] = face;
      if (mask) mask[i] = 1;
      out.chests.push({ x: cx * 16 + u, y: oy + Y0, z: cz * 16 + w, table: 'simple_dungeon', seed: String(r.nextLong()) });
      break;
    }
    const si = idx(ox, oy, oz);
    blocks[si] = B.spawner; meta[si] = 0;
    if (mask) mask[si] = 1;
    out.spawners.push({ x: cx * 16 + ox, y: oy + Y0, z: cz * 16 + oz, mob: MOBS[r.nextInt(4)] });
  }
  return out.spawners.length ? out : null;
}
