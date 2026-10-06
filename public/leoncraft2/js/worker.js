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
import { Gen } from './worldgen.js?v=16';
import { meshColumn, setColours } from './mesher.js?v=16';
import { resolveTextures } from './blocks.js?v=16';
import { worldStructures, structureMessage } from './struct/hook.js?v=16';
import { keepChunk, readChunks, sweepChunks } from './chunkcache.js?v=16';

let G = null;                 // { VanillaGen, NetherGen, EndGen } once loaded
let loadingG = null;
const loadGens = () => loadingG || (loadingG = Promise.all([import('./gen/vanillagen.js?v=16'), import('./gen/nether.js?v=16'), import('./gen/end.js?v=16')])
  .then(([v, n, e]) => { G = { VanillaGen: v.VanillaGen, NetherGen: n.NetherGen, EndGen: e.EndGen }; }));
// whether a world (init or practice) needs one of Minecraft's generators
const needsG = m => m.dim === 'the_nether' || m.dim === 'the_end' || m.generator === 'vanilla';

let gen = null, structs = null;
let cacheKey = null;          // where this world's chunks are kept between visits (chunkcache.js), or null
// a generator made ahead, while the player was in the menus, for the world most likely to be opened next
let spare = null;
let resolved = null;
const nameOf = m => m.dim + '|' + m.generator + '|' + m.seed;
function make(m) {
  // each dimension has its own generator (js/dims.js); the Overworld is Minecraft's own for worlds
  // made as Vanilla Seed, the first generator for the rest
  const g = m.dim === 'the_nether' ? new G.NetherGen(m.seed) : m.dim === 'the_end' ? new G.EndGen(m.seed)
    : m.generator === 'vanilla' ? new G.VanillaGen(String(m.seed)) : new Gen(m.seed | 0);
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
function handle(m) {
  if ((m.type === 'init' || m.type === 'practice') && !G && needsG(m)) {
    held = [m];
    loadGens().then(() => { const q = held; held = null; for (const x of q) handle(x); },
      err => { console.error('generator code', err); const q = held; held = null; loadingG = null; for (const x of q) if (x !== m) handle(x); });
    return;
  }
  if (m.type === 'init') {
    prepare(m);
    if (spare && spare.name === nameOf(m)) { gen = spare.gen; structs = spare.structs; }
    else { const s = make(m); gen = s.gen; structs = s.structs; }
    spare = null;
    cacheKey = m.cache || null;
    self.postMessage({ type: 'ready', staged: staged(gen), features: staged(gen) && !!gen.decorator.features });
    return;
  }
  if (m.type === 'idle') {
    // back in the pool: let the last world's generator and everything it kept go
    gen = null; structs = null; cacheKey = null;
    return;
  }
  if (m.type === 'lookup') {
    // the chunks of the list kept from before, sent as if just made; then the ones still to make
    readChunks(cacheKey, m.list, (cx, cz, c, s) => {
      self.postMessage({ type: 'gen', cached: true, cx, cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top, structs: s }, [c.blocks.buffer, c.meta.buffer, c.biome.buffer]);
    }).then(missing => self.postMessage({ type: 'looked', missing, asked: m.list.length }));
    return;
  }
  if (m.type === 'sweep') { sweepChunks(m.prefix, m.limit); return; }
  if (m.type === 'practice') {
    /* Practice, in the menus: the generator for the world most likely to be
       opened next is made now, and its first chunks' terrain and features
       done once, so its code is compiled and fast by the time that world (or
       any other) is opened. What it made is handed back to be kept. */
    prepare(m);
    if (!spare || spare.name !== nameOf(m)) spare = make(m);
    const g = spare.gen, out = [];
    if (staged(g)) {
      for (const [x, z] of m.terrain || []) {
        const p = g.terrain(x, z);
        out.push(['t', x, z, p.blocks, p.meta, p.grid]);
      }
      if (m.decorate) {
        // its own terrain round the chunk to decorate, kept only for this
        for (const t of out) g.protoCache.set(ck(t[1], t[2]), { blocks: t[3], meta: t[4], grid: t[5], cx: t[1], cz: t[2] });
        const [x, z] = m.decorate;
        out.push(['d', x, z, writesOf(g, x, z)]);
        g.protoCache.clear(); g.writeCache.clear();
      }
    } else if (m.terrain && m.terrain.length) g.generate(m.terrain[0][0], m.terrain[0][1]);
    const transfer = [];
    for (const t of out) if (t[0] === 't') transfer.push(t[3].buffer, t[4].buffer);
    self.postMessage({ type: 'practised', name: spare.name, out }, transfer);
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
    const w = writesOf(gen, m.cx, m.cz);
    gen.protoCache.clear(); gen.writeCache.clear();
    self.postMessage({ type: 'decorate', cx: m.cx, cz: m.cz, writes: w }, w.map(e => e[1].buffer));
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
    const extra = structs ? structs.build(c, m.cx, m.cz) : null;      // the structures reaching into this chunk
    if (cacheKey) keepChunk(cacheKey, m.cx, m.cz, c, extra);
    self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top, structs: extra },
      [c.blocks.buffer, c.meta.buffer, c.biome.buffer]);
    return;
  }
  if (m.type === 'mesh') {
    const out = meshColumn(m);
    // practice only (world.js warmEditWorker): nothing to send back
    if (m.warm) { self.postMessage({ type: 'warmed' }); return; }
    const transfer = [];
    for (const k of ['opaque', 'cutout', 'translucent', 'fluid', 'plants', 'leafIn']) {
      const g = out[k];
      if (!g) continue;
      for (const a of g.attrs) transfer.push(a.buffer);
      transfer.push(g.index.buffer);
    }
    if (out.light) transfer.push(out.light.buffer);
    if (out.region) transfer.push(out.region.buffer);
    self.postMessage({ type: 'mesh', id: m.id, cx: m.cx, cz: m.cz, version: m.version, mesh: out, urgent: m.urgent }, transfer);
    return;
  }
  if (m.type === 'structures') {
    self.postMessage(Object.assign({ type: 'structures', id: m.id }, structureMessage(structs, m)));
    return;
  }
  if (m.type === 'surface') {
    // the ground height at a column, for finding somewhere to stand
    self.postMessage({ type: 'surface', id: m.id, y: gen.surfaceAt(m.x, m.z), biome: m.withBiome ? gen.climate(m.x, m.z) : null });
  }
}
// one chunk's feature writes, as [chunk 0..8 round it, Int32Array of cell, value pairs], taken out of the cache
function writesOf(g, x, z) {
  const w = g.writes(x, z);
  g.writeCache.delete(ck(x, z));
  return [...w];
}
