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
   starts here, where the strongholds are, the biome at a block).

   For the other dimensions: a Nether or End generator in a worker calls
   worldStructures(seed, netherGen, 'nether') (or 'end') once and
   build(chunk, cx, cz) after each chunk; fortresses, bastions and end
   cities then come out of the same code (fortress.js has the exact
   layout; bastions and end cities are our own designs, builds/).
--------------------------------------------------------------------------- */
import { Structures, makeSource } from './starts.js?v=107';
import { SETS, FAMILY } from './placement.js?v=107';
import { dungeons } from './dungeon.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { pickBiome } from '../worldgen.js?v=107';
import { Y0, VOL } from '../world-const.js?v=107';
import { B, BLOCKS } from '../blocks.js?v=107';

export function worldStructures(seed, gen, dim) {
  // the worker names dimensions as js/dims.js does ('the_nether', 'the_end'); the structure sets say 'nether' and 'end'
  dim = dim === 'the_nether' ? 'nether' : dim === 'the_end' ? 'end' : dim || 'overworld';
  let S;
  try { S = new Structures(seed, makeSource(gen, BIOMES, dim === 'overworld' ? pickBiome : null, Y0, dim)); } catch (e) { console.error('structures', e); return null; }
  /* (the game's own world places its dungeons as the game does, among its
     features: gen/misc.js monster_room, whose chests and spawners come back
     with the chunk. Ours, from dungeon.js, are for the first generator only;
     both at once was twice the game's dungeons.) */
  const ownRooms = typeof gen.useStructures !== 'function';
  // the structures and dungeons of one chunk, drawn into its blocks
  const draw = (blocks, meta, cx, cz, mask) => {
    let out = null;
    try {
      out = S.apply(blocks, meta, cx, cz, dim, mask);
      if (dim === 'overworld' && ownRooms) {
        const d = dungeons(S.seed, blocks, meta, cx, cz, mask);
        if (d) {
          out = out || { chests: [], spawners: [], entities: [], structures: [] };
          out.chests.push(...d.chests); out.spawners.push(...d.spawners);
        }
      }
    } catch (e) { console.error('structures in chunk', cx, cz, e); }
    return out;
  };
  // A generator that decorates (the vanilla one) builds them into its terrain before the trees and
  // plants, as the game does, so nothing grows through a house or stands on a path; c.structs is
  // then what they left. Otherwise they are drawn over the finished chunk here.
  if (typeof gen.useStructures === 'function') gen.useStructures(draw);
  let mask = null;
  return {
    S,
    build(c, cx, cz) {
      let out;
      if (c.structs !== undefined) out = c.structs;
      else {
        // drawn over the finished chunk: what grew where the structure now stands goes
        mask = mask || new Uint8Array(VOL);
        out = draw(c.blocks, c.meta, cx, cz, mask);
        if (out) { settlePlants(c.blocks, c.meta, mask); mask.fill(0); }
      }
      if (out) {
        for (let i = VOL - 1; i >= 0; i--) if (c.blocks[i]) { c.top = Math.max(c.top, i >> 8); break; }
        if (!out.chests.length && !out.spawners.length && !out.entities.length && !out.structures.length) out = null;
      }
      return out;
    },
  };
}

/* A generator that does not build its structures into its terrain before
   its plants (the Nether's, the End's, the first one) has every plant in
   before a structure is drawn over the chunk, where the game grows them
   after: so a fungus could be left standing on a fortress's bricks or on
   the air of its corridor, a vine hanging from a ceiling the corridor took
   away, a chorus plant cut off from its island by an end city. Every plant
   next to a block the structure wrote (marked in mask) is checked, and one
   that could not grow there goes; then whatever stood on it or hung from it
   is checked in turn. */
const KIND = new Uint8Array(4096);        // 1 stands on soil, 2 on nylium or soil, 3 on sand or soil, 4 on any whole block,
                                          // 5 the top half of a tall plant, 6 hangs, 7 climbs, 8 chorus, 9 grows in water,
                                          // 10 the stem of a huge fungus
const SOIL = new Uint8Array(4096), NYLIUM = new Uint8Array(4096), SANDY = new Uint8Array(4096);
{
  const mark = (arr, names, v = 1) => { for (const n of names) if (B[n] !== undefined) arr[B[n]] = v; };
  mark(SOIL, ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots', 'farmland']);
  for (let i = 0; i < 4096; i++) if (SOIL[i]) { NYLIUM[i] = 1; SANDY[i] = 1; }
  mark(NYLIUM, ['crimson_nylium', 'warped_nylium', 'soul_soil']);
  mark(SANDY, ['sand', 'red_sand', 'terracotta']);
  for (const d of BLOCKS) if (d && d.name.endsWith('_terracotta') && !d.name.includes('glazed')) SANDY[d.id] = 1;
  mark(KIND, ['short_grass', 'fern', 'tall_grass', 'large_fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
    'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower', 'sunflower', 'lilac', 'rose_bush',
    'peony', 'sweet_berry_bush', 'pink_petals', 'wildflowers', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling',
    'dark_oak_sapling', 'cherry_sapling', 'sugar_cane', 'bamboo'], 1);
  mark(KIND, ['crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'nether_sprouts'], 2);
  mark(KIND, ['dead_bush', 'cactus', 'short_dry_grass', 'tall_dry_grass'], 3);
  mark(KIND, ['brown_mushroom', 'red_mushroom', 'snow'], 4);
  for (const d of BLOCKS) if (d && d.lower && B[d.lower] !== undefined) KIND[d.id] = 5;
  mark(KIND, ['weeping_vines', 'weeping_vines_plant'], 6);
  mark(KIND, ['twisting_vines', 'twisting_vines_plant'], 7);
  mark(KIND, ['chorus_plant', 'chorus_flower'], 8);
  mark(KIND, ['seagrass', 'kelp', 'kelp_plant'], 9);
  mark(KIND, ['crimson_stem', 'warped_stem'], 10);
}
// what a huge fungus is made of, and a chorus plant
const FUNGUS = new Uint8Array(4096), CHORUS = new Uint8Array(4096);
{
  for (const n of ['crimson_stem', 'warped_stem', 'nether_wart_block', 'warped_wart_block', 'shroomlight', 'weeping_vines', 'weeping_vines_plant']) if (B[n] !== undefined) FUNGUS[B[n]] = 1;
  for (const n of ['chorus_plant', 'chorus_flower']) if (B[n] !== undefined) CHORUS[B[n]] = 1;
}
const whole = b => b !== 0 && BLOCKS[b] && BLOCKS[b].shape === 'cube' && BLOCKS[b].solid !== false && !BLOCKS[b].leaves;
function holds(blocks, i, b) {
  const below = i >= 256 ? blocks[i - 256] : 0, above = i + 256 < VOL ? blocks[i + 256] : 0;
  // the bottom half of a tall plant needs its top half
  const up = BLOCKS[b].upper;
  if (up && B[up] !== undefined && above !== B[up]) return false;
  switch (KIND[b]) {
    case 1: return SOIL[below] === 1 || below === b || (b === B.sugar_cane && SANDY[below] === 1);
    case 2: return NYLIUM[below] === 1;
    case 3: return SANDY[below] === 1 || below === b;
    case 4: return whole(below) || (b === B.snow && !!BLOCKS[below] && !!BLOCKS[below].leaves);
    case 5: return below === B[BLOCKS[b].lower];
    case 6: return above === B.weeping_vines_plant || above === B.weeping_vines || whole(above);
    case 7: return below === B.twisting_vines_plant || below === B.twisting_vines || whole(below);
    case 9: return whole(below) || below === B.kelp_plant;
  }
  return true;
}
/* A whole plant (a chorus plant, a huge fungus) a block belongs to, gone if
   no part of it still stands on what it grew from: end stone for a chorus
   plant, anything but air under a fungus's stem. */
function settleBody(blocks, meta, start, done, part, rooted) {
  const list = [start], seen = new Set([start]);
  let held = false;
  for (let k = 0; k < list.length && list.length < 4096; k++) {
    const i = list[k];
    if (rooted(blocks, i)) held = true;
    const x = i & 15, z = (i >> 4) & 15;
    for (const [j, ok] of [[i + 256, i + 256 < VOL], [i - 256, i >= 256], [i + 1, x < 15], [i - 1, x > 0], [i + 16, z < 15], [i - 16, z > 0]]) {
      if (!ok || seen.has(j) || !part[blocks[j]]) continue;
      seen.add(j); list.push(j);
    }
    // a plant reaching out of the chunk is judged whole by its other part
    if (x === 0 || x === 15 || z === 0 || z === 15) held = true;
  }
  for (const i of list) { done.add(i); if (!held) { blocks[i] = 0; meta[i] = 0; } }
}
const onEndStone = (blocks, i) => i >= 256 && blocks[i - 256] === B.end_stone;
const stemStands = (blocks, i) => (blocks[i] === B.crimson_stem || blocks[i] === B.warped_stem) && i >= 256 && blocks[i - 256] !== 0 && !FUNGUS[blocks[i - 256]];
function settlePlants(blocks, meta, mask) {
  const queue = [], done = new Set();
  for (let i = 0; i < VOL; i++) if (mask[i]) {
    if (i + 256 < VOL && !mask[i + 256] && KIND[blocks[i + 256]]) queue.push(i + 256);
    if (i >= 256 && !mask[i - 256] && KIND[blocks[i - 256]]) queue.push(i - 256);
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k], b = blocks[i];
    if (!KIND[b] || mask[i]) continue;
    if (KIND[b] === 8) { if (!done.has(i)) settleBody(blocks, meta, i, done, CHORUS, onEndStone); continue; }
    if (KIND[b] === 10) { if (!done.has(i) && i >= 256 && blocks[i - 256] === 0) settleBody(blocks, meta, i, done, FUNGUS, stemStands); continue; }
    if (holds(blocks, i, b)) continue;
    blocks[i] = KIND[b] === 9 ? B.water : 0; meta[i] = 0;
    if (i + 256 < VOL && KIND[blocks[i + 256]]) queue.push(i + 256);
    if (i >= 256 && KIND[blocks[i - 256]]) queue.push(i - 256);
  }
}

/* A world made with Generate Structures off has no Structures, but its
   generator still knows its biomes (the advancements' biome checks ask, see
   adv/game.js askBiome), and there is simply nothing to list: no strongholds
   for an eye of ender, nothing starting in a chunk. */
const bare = new WeakMap();
function bareSource(gen, dim) {
  let src = bare.get(gen);
  if (!src) {
    dim = dim === 'the_nether' ? 'nether' : dim === 'the_end' ? 'end' : dim === 'nether' || dim === 'end' ? dim : 'overworld';
    src = makeSource(gen, BIOMES, dim === 'overworld' ? pickBiome : null, Y0, dim);
    bare.set(gen, src);
  }
  return src;
}

export function structureMessage(structs, m, gen, dim) {
  if (!structs) {
    try {
      if (m.op === 'biome' && gen) { const src = bareSource(gen, dim); return { biome: src.biome ? src.biome(m.x, m.y, m.z) || null : null }; }
    } catch (e) { return { error: String(e && e.stack || e) }; }
    if (m.op === 'strongholds' || m.op === 'in' || m.op === 'pieces') return { list: [] };
    return { error: 'no structures' };
  }
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
      // the biome at a block (y in the game's terms), caves included, as the generator has it (the advancements' biome checks)
      case 'biome': return { biome: S.src && S.src.biome ? S.src.biome(m.x, m.y, m.z) || null : null };
      case 'pieces': {
        const s = S.startFor(m.set, m.cx, m.cz);
        return { list: s ? S.pieces(s).map(p => ({ type: p.type, box: p.box.toArray(), dir: p.dir })) : [] };
      }
    }
  } catch (e) { return { error: String(e && e.stack || e) }; }
  return { error: 'unknown op' };
}
