/* ---------------------------------------------------------------------------
   Leoncraft 2 - a world brought over from the first Leoncraft (lc1convert.js),
   made in the workers: the chunks the first Leoncraft's world had changed
   (and the ones round its spawn) are its own terrain, made by its own
   generator (lc1gen.js) and lifted by Y_OFF, and every other chunk is
   Leoncraft 2's own from the world's seed.

   The generator of the world is wrapped (lc1Mixed): its terrain and features
   stages are left as they are, so the chunks beside the first Leoncraft's
   come out exactly as in any world of that seed, and only a whole chunk
   (generate) of the first Leoncraft's is put together differently: below
   its bedrock Leoncraft 2's own deep ground stays (no void shows from a
   cave next door), from its bedrock up its terrain, cell for cell, and in
   the Overworld nothing above it (Leoncraft 2's mountains would hang over
   it). In the Nether Leoncraft 2's netherrack stays above its roof.
   Leoncraft 2's structures are not built into its chunks (worker.js).

   The world's message carries lc1 = { seed, ow, ne, key } (genInfo); its
   key is in the world's name, so its chunks are cached apart (world.js).
--------------------------------------------------------------------------- */
import './lc1gen.js?v=107';
import './lc1convert.js?v=107';
import { B } from '../blocks.js?v=107';
import { BIO } from '../biomes.js?v=107';

const C = globalThis.LC1Convert, G = globalThis.LC1Gen;
const VOL = 384 * 256;
// each first Leoncraft id as the generator puts it down: Leoncraft 2's id and meta
let TID = null, TMETA = null, TFIX = null;
function tables() {
  if (TID) return;
  const n = C.NAMES.length + 1;
  TID = new Uint16Array(n); TMETA = new Uint8Array(n); TFIX = new Uint8Array(n);
  for (let id = 0; id < n; id++) {
    const [name, meta] = C.terrainName(id), b = B[name];
    TID[id] = b === undefined ? 0 : b; TMETA[id] = meta;
    if (C.T_FIX.has(id)) TFIX[id] = 1;
  }
}
const OVER_BIOME = { plains: 'plains', desert: 'desert', snow: 'snowy_plains' };
const NETHER_BIOME = { waste: 'nether_wastes', crimson: 'crimson_forest', warped: 'warped_forest', soul: 'soul_sand_valley', basalt: 'basalt_deltas' };

// the name a worker keeps a world under (worker.js nameOf, world.js genName): its first Leoncraft chunks' key
export const lc1Suffix = info => (info && info.key ? '|' + info.key : '');

export function lc1Mixed(gen, m) {
  const info = m.lc1;
  const dim = !m.dim || m.dim === 'overworld' ? 0 : m.dim === 'the_nether' ? 1 : -1;
  if (dim < 0 || !info || !gen || typeof gen.generate !== 'function') return gen;
  const set = C.parseSet(dim ? info.ne : info.ow);
  if (!set.size) return gen;
  tables();
  const lc1 = G.create(info.seed), off = C.Y_OFF[dim], top = C.LC1_TOP[dim];
  const has = (cx, cz) => set.has(cx + ',' + cz);
  // the world y the first Leoncraft's terrain takes (the Overworld: all of it above its bedrock)
  const yLo = off - 64, yHi = dim ? off + top - 64 : 1e9;
  const keepNote = y => y < yLo || y > yHi;
  const base = gen.generate.bind(gen);
  gen.lc1Has = has;
  gen.generate = (cx, cz) => {
    const c = base(cx, cz);
    if (!has(cx, cz)) return c;
    const data = dim ? lc1.nether(cx, cz) : lc1.chunk(cx, cz), blocks = c.blocks, meta = c.meta;
    for (let y = 0; y <= top; y++) {
      const row = (y + off) << 8, at = y << 8;
      for (let k = 0; k < 256; k++) {
        const id = data[at + k], i = row | k;
        if (TFIX[id]) {
          const name = C.terrainFix(id, y > 0 ? data[at - 256 + k] : 0, y < top ? data[at + 256 + k] : 0), b = B[name];
          blocks[i] = b === undefined ? TID[id] : b;
        } else blocks[i] = TID[id];
        meta[i] = TMETA[id];
      }
    }
    if (!dim) { blocks.fill(0, (top + off + 1) << 8, VOL); meta.fill(0, (top + off + 1) << 8, VOL); }
    // its biomes (the grass and the snow follow them)
    const names = dim ? NETHER_BIOME : OVER_BIOME;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = cx * 16 + x, wz = cz * 16 + z, b = BIO[names[dim ? lc1.netherBiome(wx, wz) : lc1.biomeAt(wx, wz)]];
      if (b !== undefined) c.biome[(z << 4) | x] = b;
    }
    let t = 0;
    for (let i = VOL - 1; i >= 0; i--) if (blocks[i]) { t = i >> 8; break; }
    c.top = t;
    // what Leoncraft 2's structures left for the game here, only where its own ground is still there
    if (c.structs) {
      const s = c.structs, out = {};
      for (const k in s) {
        if (!Array.isArray(s[k])) { out[k] = s[k]; continue; }
        out[k] = k === 'structures' ? s[k].filter(e => (e.boxes || []).every(b => b[4] < yLo || b[1] > yHi)) : s[k].filter(e => keepNote(e.y));
      }
      c.structs = out;
    }
    return c;
  };
  // the ground's height for the spawn search and the like (index y, as the generators answer it)
  if (!dim && typeof gen.surfaceAt === 'function') {
    const surf = gen.surfaceAt.bind(gen);
    gen.surfaceAt = (x, z) => (has(Math.floor(x / 16), Math.floor(z / 16)) ? Math.max(lc1.terrainHeight(x, z), G.SEA) + off : surf(x, z));
  }
  return gen;
}
