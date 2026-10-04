/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the hook into chunk generation (in the workers).

   worldStructures(seed, gen) makes, per world, the Structures that know
   where everything starts, reading biomes and heights from whichever
   generator the worker runs (see makeSource). build(chunk, cx, cz) then
   draws every structure piece reaching into a freshly generated chunk, adds
   the chunk's dungeons, and hands back what the game must know about them:
   chests (with their loot table and seed), spawners (with their mob) and
   entities to make once mobs exist.

   structureMessage answers the main thread's questions (/locate, what
   starts here, where the strongholds are).

   For the other dimensions: a Nether or End generator in a worker calls
   worldStructures(seed, netherGen, 'nether') (or 'end') once and
   build(chunk, cx, cz) after each chunk; fortresses, bastions and end
   cities then come out of the same code (fortress.js has the exact
   layout; bastions and end cities are our own designs, builds/).
--------------------------------------------------------------------------- */
import { Structures, makeSource } from './starts.js?v=12';
import { SETS, FAMILY } from './placement.js?v=12';
import { dungeons } from './dungeon.js?v=12';
import { BIOMES } from '../biomes.js?v=12';
import { pickBiome } from '../worldgen.js?v=12';
import { Y0, VOL } from '../world-const.js?v=12';

export function worldStructures(seed, gen, dim) {
  dim = dim || 'overworld';
  let S;
  try { S = new Structures(seed, makeSource(gen, BIOMES, dim === 'overworld' ? pickBiome : null, Y0, dim)); } catch (e) { console.error('structures', e); return null; }
  return {
    S,
    build(c, cx, cz) {
      let out = null;
      try {
        out = S.apply(c.blocks, c.meta, cx, cz, dim);
        if (dim === 'overworld') {
          const d = dungeons(S.seed, c.blocks, c.meta, cx, cz);
          if (d) {
            out = out || { chests: [], spawners: [], entities: [], structures: [] };
            out.chests.push(...d.chests); out.spawners.push(...d.spawners);
          }
        }
      } catch (e) { console.error('structures in chunk', cx, cz, e); }
      if (out) {
        for (let i = VOL - 1; i >= 0; i--) if (c.blocks[i]) { c.top = Math.max(c.top, i >> 8); break; }
        if (!out.chests.length && !out.spawners.length && !out.entities.length && !out.structures.length) out = null;
      }
      return out;
    },
  };
}

export function structureMessage(structs, m) {
  if (!structs) return { error: 'no structures' };
  const S = structs.S;
  try {
    switch (m.op) {
      case 'locate': {
        const kind = m.kind;
        const known = FAMILY[kind] || Object.values(SETS).some(s => s.list.some(e => e[0] === kind));
        if (!known) return { error: 'unknown structure ' + kind };
        return { found: S.nearest(kind, m.x, m.z, m.dim || (kind === 'fortress' || kind === 'bastion_remnant' ? 'nether' : kind === 'end_city' ? 'end' : 'overworld')) };
      }
      case 'in': return { list: S.structuresIn(m.cx, m.cz, m.dim).map(s => ({ type: s.type, cx: s.cx, cz: s.cz, x: s.x, y: s.y, z: s.z })) };
      case 'strongholds': return { list: S.strongholds(m.n || 3) };
      case 'pieces': {
        const s = S.startFor(m.set, m.cx, m.cz);
        return { list: s ? S.pieces(s).map(p => ({ type: p.type, box: p.box.toArray(), dir: p.dir })) : [] };
      }
    }
  } catch (e) { return { error: String(e && e.stack || e) }; }
  return { error: 'unknown op' };
}
