/* Leoncraft 2 - a worker: makes chunks and meshes them, off the main thread.

   Workers are kept for the whole visit (world.js): each world, dimension
   and the title screen's world sends an init with its seed, and the same
   worker, its code long since compiled and made fast, carries on.

   Minecraft's own worlds are made in stages (world.js, "staged"): the
   terrain of a chunk, then the features placed from it into the chunks
   round it, then the chunk put together from its terrain and the features
   that reach into it. Each stage is its own job, so any worker can do any
   of them with the pieces the main thread hands it, and no piece is made
   twice (one worker making a whole chunk alone needs the terrain of the 25
   round it).

   Minecraft's generators (the Overworld's, the Nether's, the End's) are
   more than half of a worker's code, so they are loaded only when a world
   first needs them: the title screen's world (the first generator) starts
   without waiting for them. */
import { Gen, pickBiome } from './worldgen.js?v=26';
import { FlatGen } from './gen/flat.js?v=26';
import { meshColumn, setColours } from './mesher.js?v=26';
import { resolveTextures } from './blocks.js?v=26';
import { worldStructures, structureMessage } from './struct/hook.js?v=26';
import { keepChunk, readChunks, sweepChunks, keptCount } from './chunkcache.js?v=26';

let G = null;                 // { VanillaGen, NetherGen, EndGen } once loaded
let loadingG = null;
const loadGens = () => loadingG || (loadingG = Promise.all([import('./gen/vanillagen.js?v=26'), import('./gen/nether.js?v=26'), import('./gen/end.js?v=26')])
  .then(([v, n, e]) => { G = { VanillaGen: v.VanillaGen, NetherGen: n.NetherGen, EndGen: e.EndGen }; }));
// whether a world (init or practice) needs one of Minecraft's generators
const needsG = m => m.dim === 'the_nether' || m.dim === 'the_end' || m.generator === 'vanilla';

let gen = null, structs = null;
let cacheKey = null;          // where this world's chunks are kept between visits (chunkcache.js), or null
let tag = 0;                  // the World this worker serves (world.js), sent back with chunks read back later
/* Generators made ahead, while the player was in the menus, for the worlds
   most likely to be opened next (the last one played, and the one a blank
   Create New World makes): the two practised last, by name. */
const spares = new Map();
function spareFor(m) {
  const k = nameOf(m);
  let s = spares.get(k);
  if (s) spares.delete(k); else s = make(m);
  spares.set(k, s);
  if (spares.size > 2) spares.delete(spares.keys().next().value);
  return s;
}
let resolved = null;
const nameOf = m => m.dim + '|' + m.generator + '|' + m.seed;
function make(m) {
  // each dimension has its own generator (js/dims.js); the Overworld is Minecraft's own for worlds
  // made as Vanilla Seed, the first generator for the rest
  const g = m.dim === 'the_nether' ? new G.NetherGen(m.seed) : m.dim === 'the_end' ? new G.EndGen(m.seed)
    : m.generator === 'vanilla' ? new G.VanillaGen(String(m.seed)) : /^flat:/.test(m.generator || '') ? new FlatGen(m.seed, m.generator.slice(5)) : new Gen(m.seed | 0);
  // structures read their biomes and heights from whichever generator this is (fortresses and
  // bastions in the Nether, end cities in the End)
  const s = worldStructures(m.generator === 'vanilla' ? String(m.seed) : m.seed | 0, g, m.dim || 'overworld');
  return { gen: g, structs: s, name: nameOf(m) };
}
function prepare(m) {
  if (m.manifest && resolved !== m.manifest.layers) { resolveTextures(m.manifest); resolved = m.manifest.layers; }
  if (m.colours) setColours(m.colours);
}
// a generator made in stages (Minecraft's own Overworld): terrain, then features, then the chunk
const staged = g => !!(g && g.protoCache && g.writeCache && g.decorator);
const ck = (x, z) => x + ',' + z;

/* While a generator's code loads, what comes after the message that needs
   it waits, and then goes in the order it came. */
let held = null;
self.onmessage = e => {
  if (held) { held.push(e.data); return; }
  handle(e.data);
};
/* A job that goes wrong says so ('failed'), so the world asks again instead
   of waiting for ever on an answer that never comes: a chunk that never
   loaded left a hole in the world, and its eight neighbours never drawn. */
const JOBS = { terrain: 1, decorate: 1, gen: 1, mesh: 1 };
function handle(m) {
  try { work(m); } catch (e) {
    console.error('worker ' + m.type + ' ' + m.cx + ',' + m.cz, e);
    if (gen) { if (gen.protoCache) gen.protoCache.clear(); if (gen.writeCache) gen.writeCache.clear(); }
    if (JOBS[m.type] && !m.warm) self.postMessage({ type: 'failed', job: m.type, cx: m.cx, cz: m.cz, version: m.version });
  }
}
function work(m) {
  if ((m.type === 'init' || m.type === 'practice') && !G && needsG(m)) {
    held = [m];
    loadGens().then(() => { const q = held; held = null; for (const x of q) handle(x); },
      err => { console.error('generator code', err); const q = held; held = null; loadingG = null; for (const x of q) if (x !== m) handle(x); });
    return;
  }
  if (m.type === 'init') {
    prepare(m);
    const s = spares.get(nameOf(m)) || make(m);
    gen = s.gen; structs = s.structs;
    spares.clear();
    cacheKey = m.cache || null; tag = m.tag || 0;
    self.postMessage({ type: 'ready', staged: staged(gen), features: staged(gen) && !!gen.decorator.features });
    return;
  }
  if (m.type === 'idle') {
    // back in the pool: let the last world's generator and everything it kept go
    gen = null; structs = null; cacheKey = null; tag = 0;
    return;
  }
  if (m.type === 'lookup') {
    // the chunks of the list kept from before, sent as if just made, nearest first; the ones still to make as soon as
    // the store has answered (any kept but unreadable later, as a background answer: cached, so it frees no worker)
    const t = tag;
    readChunks(cacheKey, m.list, (cx, cz, c, s) => {
      self.postMessage({ type: 'gen', cached: true, tag: t, cx, cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top, structs: s }, [c.blocks.buffer, c.meta.buffer, c.biome.buffer]);
    }, missing => self.postMessage({ type: 'looked', tag: t, missing }))
      .then(failed => { if (failed.length) self.postMessage({ type: 'looked', tag: t, missing: failed, cached: true }); });
    return;
  }
  if (m.type === 'sweep') { sweepChunks(m.prefix, m.limit); return; }
  if (m.type === 'practice') {
    /* Practice, in the menus: the generator for the world most likely to be
       opened next is made now, and one piece of it at a time (world.js
       practise): a column for the search for where a new world starts you, a chunk's terrain, a chunk's
       features (from the nine terrains handed in), or the mesher run once on
       that ground. So its code is compiled and fast, and the ground round you
       made, by the time that world is opened; one piece at a time, so a world
       opened meanwhile never waits long behind it. What it made is handed
       back to be kept, with the piece it was (did), answered even if it
       failed, so nothing waits on it for ever. */
    prepare(m);
    // whether a world played before has its chunks round you kept (world.js asks before making them)
    if (m.probe) keptCount(m.cache, m.probe).then(kept => self.postMessage({ type: 'practised', name: nameOf(m), out: [], kept, did: null }));
    const spare = spareFor(m);
    if (m.probe) return;
    const g = spare.gen, name = spare.name, out = [];
    const did = m.terrain ? ['t', m.terrain[0], m.terrain[1]] : m.decorate ? ['d', m.decorate[0], m.decorate[1]] : null;
    if (m.surface) {
      // a column for the spawn search (world.js practise, spawn.js), as a 'surface' job answers it
      const [x, z, wb] = m.surface;
      self.postMessage({ type: 'practised', name, out, id: m.id, surface: { y: g.surfaceAt(x, z), biome: wb ? g.climate(x, z) : null }, did: null });
      return;
    }
    try {
      if (staged(g)) {
        if (m.terrain) {
          const p = g.terrain(m.terrain[0], m.terrain[1]);
          out.push(['t', m.terrain[0], m.terrain[1], p.blocks, p.meta, p.grid]);
        }
        if (m.decorate) {
          for (const p of m.protos) g.protoCache.set(ck(p.cx, p.cz), p);
          out.push(['d', m.decorate[0], m.decorate[1], writesOf(g, m.decorate[0], m.decorate[1])]);
        }
        if (m.mesh) {
          for (const p of m.protos) g.protoCache.set(ck(p.cx, p.cz), p);
          meshPractice(g, m.mesh[0], m.mesh[1]);
        }
        g.protoCache.clear(); g.writeCache.clear();
      } else if (m.terrain) g.generate(m.terrain[0], m.terrain[1]);
    } catch (e) { console.error('practice', e); out.length = 0; }
    const transfer = [];
    for (const t of out) {
      if (t[0] === 't') transfer.push(t[3].buffer, t[4].buffer);
      else for (const e of t[3]) transfer.push(e[1].buffer);
    }
    self.postMessage({ type: 'practised', name, out, staged: staged(g), did }, transfer);
    return;
  }
  if (m.type === 'terrain') {
    // a chunk's terrain alone (stage one), handed over to the main thread
    const k = ck(m.cx, m.cz);
    let p = gen.protoCache.get(k);
    if (p) gen.protoCache.delete(k); else p = gen.terrain(m.cx, m.cz);
    self.postMessage({ type: 'terrain', cx: m.cx, cz: m.cz, blocks: p.blocks, meta: p.meta, grid: p.grid }, [p.blocks.buffer, p.meta.buffer]);
    return;
  }
  if (m.type === 'decorate') {
    // the features of one chunk (stage two), placed against the terrain of the nine round it
    for (const p of m.protos) gen.protoCache.set(ck(p.cx, p.cz), p);
    // the biomes of the terrains round those, for the lake plans of the chunks next to this one
    if (m.grids && gen.decorator.keepGrid) for (const [x, z, g] of m.grids) gen.decorator.keepGrid(x, z, g);
    /* (a chunk whose features cannot be placed comes without them, rather
       than holding up the chunks round it for good) */
    let w;
    try { w = writesOf(gen, m.cx, m.cz); } catch (e) { console.error('features of ' + m.cx + ',' + m.cz, e); w = []; }
    gen.protoCache.clear(); gen.writeCache.clear();
    // the terrains' buffers go back with the answer, to be used for the next job (world.js pool)
    const back = [];
    for (const p of m.protos) back.push(p.blocks.buffer, p.meta.buffer);
    self.postMessage({ type: 'decorate', cx: m.cx, cz: m.cz, writes: w, back }, w.map(e => e[1].buffer).concat(back));
    return;
  }
  if (m.type === 'gen') {
    // staged: the chunk put together from the pieces handed in (its terrain, the features round it)
    if (m.proto) {
      gen.protoCache.set(ck(m.cx, m.cz), m.proto);
      for (const [x, z, list] of m.writes) gen.writeCache.set(ck(x, z), new Map(list));
    }
    const c = gen.generate(m.cx, m.cz);
    if (m.proto) { gen.protoCache.clear(); gen.writeCache.clear(); }
    // the structures reaching into this chunk (one that cannot be built is left out, not the chunk)
    let extra = null;
    try { extra = structs ? structs.build(c, m.cx, m.cz) : null; } catch (e) { console.error('structures in ' + m.cx + ',' + m.cz, e); }
    if (cacheKey) keepChunk(cacheKey, m.cx, m.cz, c, extra);
    // (the terrain it was made from goes back to be used again, as a decoration's do; the chunk is a copy of it)
    const back = m.proto && m.proto.blocks.buffer !== c.blocks.buffer && m.proto.meta.buffer !== c.meta.buffer ? [m.proto.blocks.buffer, m.proto.meta.buffer] : [];
    self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top, structs: extra, back },
      [c.blocks.buffer, c.meta.buffer, c.biome.buffer].concat(back));
    return;
  }
  if (m.type === 'mesh') {
    const out = meshColumn(m);
    // the chunks' buffers go back with the answer, to be used for the next job (world.js pool)
    const back = [];
    for (const ch of m.chunks) if (ch) back.push(ch.blocks.buffer, ch.meta.buffer);
    // practice only (world.js warmEditWorker): nothing to send back
    if (m.warm) { self.postMessage({ type: 'warmed', back }, back); return; }
    const transfer = back.slice();
    for (const k of ['opaque', 'cutout', 'translucent', 'fluid', 'plants', 'leafIn']) {
      const g = out[k];
      if (!g) continue;
      // (no indices: every mesh is drawn with the same ones, render/renderer.js quadIndex)
      for (const a of g.attrs) transfer.push(a.buffer);
    }
    if (out.light) transfer.push(out.light.buffer);
    if (out.region) transfer.push(out.region.buffer);
    self.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, version: m.version, mesh: out, urgent: m.urgent, back }, transfer);
    return;
  }
  if (m.type === 'structures') {
    self.postMessage(Object.assign({ type: 'structures', id: m.id }, structureMessage(structs, m)));
    return;
  }
  if (m.type === 'biomes') {
    // a grid of biome ids, n x n columns step apart from (x0, z0) at sea level (an explorer map's first look: maps.js previewBiomes)
    const n = m.n | 0, out = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = m.x0 + i * m.step, z = m.z0 + j * m.step;
      out[j * n + i] = typeof gen.noiseBiome === 'function' ? gen.noiseBiome(x >> 2, 16, z >> 2) : pickBiome(gen.climate(x, z));
    }
    self.postMessage({ type: 'biomes', id: m.id, ids: out }, [out.buffer]);
    return;
  }
  if (m.type === 'surface') {
    // the ground height at a column, for finding somewhere to stand
    self.postMessage({ type: 'surface', id: m.id, y: gen.surfaceAt(m.x, m.z), biome: m.withBiome ? gen.climate(m.x, m.z) : null, spawn: gen.spawnAt || null });
  }
}
/* The mesher practised on this kind of ground too (its stone, deepslate,
   ores and water take paths the title's world never does, and a cold first
   column took several times as long): the bare terrain round (x, z),
   meshed once and thrown away. */
function meshPractice(g, x, z) {
  const chunks = [], tops = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const p = g.protoCache.get(ck(x + dx, z + dz));
    if (!p) return;
    let top = p.blocks.length / 256 - 1;
    while (top > 0 && !p.blocks.subarray(top * 256, top * 256 + 256).some(b => b)) top--;
    chunks.push({ blocks: p.blocks.slice(0, (top + 2) * 256), meta: p.meta.slice(0, (top + 2) * 256), biome: new Uint8Array(256) });
    tops.push(top);
  }
  try { meshColumn({ type: 'mesh', cx: x, cz: z, chunks, tops, version: 0, seed: 0, prev: new Int32Array(0), fast: false, noSky: false, keep: true }); } catch (e) { /* practice only */ }
}
// one chunk's feature writes, as [chunk 0..8 round it, Int32Array of cell, value pairs], taken out of the cache
function writesOf(g, x, z) {
  const w = g.writes(x, z);
  g.writeCache.delete(ck(x, z));
  return [...w];
}
