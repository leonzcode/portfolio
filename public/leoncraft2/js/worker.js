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
import { Gen, pickBiome } from './worldgen.js?v=107';
import { FlatGen } from './gen/flat.js?v=107';
import { meshColumn, setColours } from './mesher.js?v=107';
import { resolveTextures, BLOCKS } from './blocks.js?v=107';
import { forgetLooks } from './models.js?v=107';
import { forgetStates } from './sim/states.js?v=107';
import { biomeColours } from './biomes.js?v=107';
import { CH } from './world-const.js?v=107';
import { worldStructures, structureMessage } from './struct/hook.js?v=107';
import { keepChunk, readChunks, sweepChunks, keptCount, keepMesh, readMeshes } from './chunkcache.js?v=107';
import { lc1Mixed, lc1Suffix } from './lc1/mixed.js?v=107';

let G = null;                 // { VanillaGen, NetherGen, EndGen } once loaded
let loadingG = null;
const loadGens = () => loadingG || (loadingG = Promise.all([import('./gen/vanillagen.js?v=107'), import('./gen/nether.js?v=107'), import('./gen/end.js?v=107')])
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
let coloured = false;
// (a world brought over from the first Leoncraft has its own chunks of that one's terrain: lc1/mixed.js)
const nameOf = m => m.dim + '|' + m.generator + '|' + m.seed + (m.structures === false ? '|ns' : '') + lc1Suffix(m.lc1);
function make(m) {
  // each dimension has its own generator (js/dims.js); the Overworld is Minecraft's own for worlds
  // made as Vanilla Seed, the first generator for the rest
  const g = m.dim === 'the_nether' ? new G.NetherGen(m.seed) : m.dim === 'the_end' ? new G.EndGen(m.seed)
    : m.generator === 'vanilla' ? new G.VanillaGen(String(m.seed)) : /^flat:/.test(m.generator || '') ? new FlatGen(m.seed, m.generator.slice(5)) : new Gen(m.seed | 0);
  // structures read their biomes and heights from whichever generator this is (fortresses and
  // bastions in the Nether, end cities in the End)
  // (none at all in a world made with Generate Structures off)
  const s = m.structures === false ? null : worldStructures(m.generator === 'vanilla' ? String(m.seed) : m.seed | 0, g, m.dim || 'overworld');
  if (m.lc1) lc1Mixed(g, m);
  return { gen: g, structs: s, name: nameOf(m) };
}
// the dimension a /locate is for (struct/hook.js picks the same), as js/dims.js names it
function otherDim(m) {
  const d = m.dim || (m.kind === 'fortress' || m.kind === 'bastion_remnant' ? 'nether' : m.kind === 'end_city' ? 'end' : 'overworld');
  return d === 'nether' || d === 'the_nether' ? 'the_nether' : d === 'end' || d === 'the_end' ? 'the_end' : null;
}
// the Nether's or the End's generator and structures for the world this worker serves, made once per world
let otherWorlds = null;
function otherStructures(dim) {
  if (!serving || !G) return null;
  const [, generator, seed, ns] = serving.split('|');
  if (ns === 'ns') return null;
  const key = serving + '>' + dim;
  if (otherWorlds && otherWorlds.key === key) return otherWorlds;
  try {
    const sd = generator === 'vanilla' || !/^-?\d+$/.test(seed) ? seed : Number(seed);
    const g = dim === 'the_nether' ? new G.NetherGen(sd) : new G.EndGen(sd);
    const s = worldStructures(generator === 'vanilla' ? String(seed) : Number(seed) | 0, g, dim);
    otherWorlds = s ? { key, gen: g, structs: s } : null;
  } catch (e) { console.error('locate in', dim, e); otherWorlds = null; }
  return otherWorlds;
}
let shown = null;             // the page's texture list the blocks were last worked out from
function prepare(m) {
  if (m.manifest && resolved !== m.manifest.layers) {
    resolveTextures(m.manifest); resolved = m.manifest.layers; shown = m.manifest;
    // what the mesher kept from a list worked out before (the title's world made ahead, startPre) goes
    forgetLooks(); forgetStates();
  }
  if (m.colours) { setColours(m.colours); coloured = m.colours; }
}
// a short print of the biome colours, kept with each mesh (a resource pack's colours give another)
function colourPrint(c) {
  let h = 2166136261;
  for (const k of ['grass', 'leaf', 'water']) for (const v of c[k]) h = Math.imul(h ^ v, 16777619);
  return h >>> 0;
}
// the same biome colours (grass, leaves, water)
function sameColours(a, b) {
  if (!a || !b) return false;
  for (const k of ['grass', 'leaf', 'water']) {
    if (!a[k] || !b[k] || a[k].length !== b[k].length) return false;
    for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return false;
  }
  return true;
}

/* ---- the title screen's world, started on before it is asked for ----
   index.html sends each worker its share the moment the page opens, while
   the page's own code and textures are still loading and the workers would
   only wait. The thirteen columns the title waits for are shared out, each
   worker taking a few next to each other: it makes the chunks round them
   and meshes them, exactly as the world would ask, then makes its share of
   the rest of the ground the title opens on. Its first columns, cold, take
   several times as long as later ones (and with every worker at it the
   browser's compiler gets to them late), so this is also when its code
   becomes fast. The meshes are kept with the chunks (chunkcache.js), and on
   a later visit (warm: the title's chunks are kept too, and the world reads
   those back itself) they are read back instead, and nothing is made: the
   page is busy starting then, and a worker working beside it slows it.
   The title's world, when it starts, is told in the answer to its init what
   this worker holds (world.js asks this worker for those, and has them at
   once). The meshes are given only if the page's own texture list and
   colours, which come with the init, give the same blocks as the ones they
   were made with. Anything else that comes first (a world opened straight
   from a reload, say) ends it and they are let go. One chunk or one column
   a step, so a message waits at most that long. */
let pre = null;               // the work under way: { name, gen, structs, seed, centre, steps, made, meshes, look, opts }
let preMade = null;           // the chunks made ahead for the world being served, until asked for: "cx,cz" -> { c, extra }
let preMeshes = null;         // and its columns' meshes: "cx,cz" -> { out, keep, seed, opts, ids }
// (kept under world.js's own prefix for this version and block table, so they go when it is tidied)
const KEPT_AS = 'c' + (new URL(import.meta.url).searchParams.get('v') || '0') + '.' + BLOCKS.length;
const meshKey = (p, x, z) => KEPT_AS + '|title|' + p.name + '|' + ck(x, z) + '|' + (p.opts.fast ? 'f' : 'c') + (p.opts.flat ? 'f' : 's') + p.opts.blend;
function startPre(m) {
  const s = spareFor(m);
  const cx = Math.floor(m.at[0] / CH), cz = Math.floor(m.at[1] / CH);
  // (the Video Settings the columns are meshed with come with the message, read by index.html as settings.js worldOpts gives them)
  const o = m.opts || {}, opts = { fast: !!o.fast, blend: o.blend === undefined ? 2 : o.blend | 0, flat: !!o.flat };
  const plan = prePlan(cx, cz, m.r, m.i, m.n);
  title = { name: s.name, centre: [cx, cz], seed: m.seed | 0, opts };
  const p = pre = { name: s.name, gen: s.gen, structs: s.structs, seed: m.seed, centre: [cx, cz], steps: m.warm ? [] : plan, made: new Map(), meshes: new Map(), look: null, opts };
  if (m.warm) {
    const cols = plan.filter(e => e[0] === 'm');
    p.reading = true;
    readMeshes(cols.map(([, x, z]) => meshKey(p, x, z))).then(found => {
      p.reading = false;
      cols.forEach(([, x, z], j) => { const r = found[j]; if (r && r.out && r.ids) p.meshes.set(ck(x, z), { out: r.out, keep: r.keep, seed: p.seed | 0, opts, ids: r.ids, cf: r.cf }); });
      if (p.late) lateMeshes(p);
    });
  }
  // the texture list and the biome colours, for the mesher (the page asked for all three already: they come from the browser's cache)
  const tex = f => new URL('../textures/' + f + '?v=107', import.meta.url);
  const pixels = f => fetch(tex(f)).then(r => r.blob()).then(b => createImageBitmap(b)).then(img => {
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, img.width, img.height).data;
  });
  Promise.all([fetch(tex('manifest.json')).then(r => r.json()), pixels('colormap_grass.png'), pixels('colormap_foliage.png')]).then(([man, grass, foliage]) => {
    const colours = biomeColours(grass, foliage);
    // the faces this list gives every block, for the check; (it lacks the art the page adds to it, so its warning is not one)
    const warn = console.warn;
    console.warn = () => {};
    try { resolveTextures(man); } finally { console.warn = warn; }
    ownFaces = BLOCKS.map(faceSig);
    if (resolved === null) {
      resolved = -1;
      setColours(colours);
    } else {
      // (the page's own list came first: put back as it was)
      resolveTextures(shown); forgetLooks(); forgetStates();
    }
    p.look = { colours };
    if (pre === p) preNext(p);
    else if (p.late) lateMeshes(p);
  }).catch(e => { console.warn('title world ahead', e); });
  preNext(p);
}
/* Who makes what: the columns nearest first, each to the worker it adds the
   least work to; then the chunks of the ground no column needed, each to the
   worker with least to do. Every worker works the same plan out and takes
   its own part: ['c', x, z] a chunk, ['m', x, z] a column. */
function prePlan(cx, cz, r, me, n) {
  const cols = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dz * dz <= 4) cols.push([dx * dx + dz * dz, Math.atan2(dz, dx), cx + dx, cz + dz]);
  cols.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // (a worker's load: its chunks, and a column as three, about what meshing one takes against making a chunk)
  const mine = Array.from({ length: n }, () => ({ load: 0, has: new Set() }));
  const plans = Array.from({ length: n }, () => []);
  for (const [, , x, z] of cols) {
    let best = -1, bestLoad = 0;
    for (let w = 0; w < n; w++) {
      let load = mine[w].load + 3;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!mine[w].has.has(ck(x + dx, z + dz))) load++;
      if (best < 0 || load < bestLoad) { best = w; bestLoad = load; }
    }
    const w = mine[best];
    w.load = bestLoad;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = ck(x + dx, z + dz);
      if (!w.has.has(k)) { w.has.add(k); plans[best].push(['c', x + dx, z + dz]); }
    }
    plans[best].push(['m', x, z]);
  }
  const anyone = new Set();
  for (const w of mine) for (const k of w.has) anyone.add(k);
  const rest = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (!anyone.has(ck(cx + dx, cz + dz))) rest.push([dx * dx + dz * dz, cx + dx, cz + dz]);
  rest.sort((a, b) => a[0] - b[0]);
  for (const e of rest) {
    let best = 0;
    for (let w = 1; w < n; w++) if (mine[w].load < mine[best].load) best = w;
    mine[best].load++;
    plans[best].push(['c', e[1], e[2]]);
  }
  return plans[me];
}
// the next step, unless one is already waiting or there is nothing that can be done yet
function preNext(p) {
  if (p.queued || !p.steps.some(s => s[0] === 'c' || p.look)) return;
  p.queued = true;
  setTimeout(() => { p.queued = false; if (pre === p) preStep(p); }, 0);
}
function preStep(p) {
  // the next step that can be done: a column waits for the textures and colours (the chunks after it do not)
  const j = p.steps.findIndex(s => s[0] === 'c' || p.look);
  if (j < 0) return;
  const [kind, x, z] = p.steps.splice(j, 1)[0];
  try {
    if (kind === 'c') {
      const c = p.gen.generate(x, z);
      let extra = null;
      try { extra = p.structs ? p.structs.build(c, x, z) : null; } catch (e) { console.error('structures in ' + x + ',' + z, e); }
      p.made.set(ck(x, z), { c, extra });
    } else {
      // the column as world.js sendMesh asks for it (its chunks are only read), and the blocks in them
      const chunks = [], tops = [], ids = new Set();
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const e = p.made.get(ck(x + dx, z + dz));
        if (!e) throw new Error('a chunk missing');
        const c = e.c;
        chunks.push({ blocks: c.blocks, meta: c.meta, biome: c.biome }); tops.push(c.top);
        for (let i = 0, n = Math.min(c.blocks.length, (c.top + 1) * 256); i < n; i++) ids.add(c.blocks[i]);
      }
      const keep = Math.abs(x - p.centre[0]) <= 1 && Math.abs(z - p.centre[1]) <= 1;
      const out = meshColumn({ type: 'mesh', cx: x, cz: z, chunks, tops, version: 0, seed: p.seed | 0, prev: new Int32Array(0), fast: p.opts.fast, noSky: false,
        urgent: false, blend: p.opts.blend, flat: p.opts.flat, moving: [], keep, base: null, rows: null });
      const rec = { out, keep, seed: p.seed | 0, opts: p.opts, ids: Uint16Array.from(ids), cf: colourPrint(p.look.colours) };
      p.meshes.set(ck(x, z), rec);
      // kept for the next visit (copied into the store now, before the buffers go to the page)
      keepMesh(meshKey(p, x, z), { out, keep, ids: rec.ids, cf: rec.cf });
    }
  } catch (e) { /* made when asked for instead */ }
  preNext(p);
}
/* The title's world (as startPre was told it) and the world this worker
   serves now: a column the title waits for that the world had meshed here
   the usual way (the head start did not get to it) is kept as well, so the
   next visit has every one of them; with the print of the colours it was
   made with, so one made with a resource pack's is never given without it. */
let title = null, serving = null;
function keepTitleMesh(m, out) {
  const dx = m.cx - title.centre[0], dz = m.cz - title.centre[1], o = title.opts;
  // (only with the colours the head start uses: a resource pack's would be kept as if they were the game's own)
  if (dx * dx + dz * dz > 4 || !coloured || !!m.keep !== (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) || (m.seed | 0) !== title.seed || m.noSky
    || !!m.fast !== o.fast || (m.blend === undefined ? 2 : m.blend) !== o.blend || !!m.flat !== o.flat || (m.prev && m.prev.length) || (m.moving && m.moving.length)) return;
  const ids = new Set();
  for (const ch of m.chunks) if (ch) for (let i = 0; i < ch.blocks.length; i++) ids.add(ch.blocks[i]);
  keepMesh(meshKey(title, m.cx, m.cz), { out, keep: !!m.keep, ids: Uint16Array.from(ids), cf: colourPrint(coloured) });
}
/* At the title's init: the meshes made ahead are given only if the page's
   own texture list (worked out here now) gives every block in them the same
   faces, and its colours are the same, as the ones they were made with. */
const faceSig = d => (d ? JSON.stringify([d.faces, d.L, d.facesUpper, d.front, d.back, d.overlay, d.snowy, d.variantLayers, d.topVariantLayers, d.iconLayer, d.anim]) : '');
let ownFaces = null;          // every block's faces as this worker's own list gave them (faceSig), kept for the check
function preCheck(p) {
  if (!p.meshes.size || !p.look || !ownFaces || resolved === -1 || !sameColours(p.look.colours, coloured)) return false;
  const print = colourPrint(p.look.colours);
  for (const r of p.meshes.values()) {
    if (r.cf !== print) return false;
    for (const id of r.ids) if (faceSig(BLOCKS[id]) !== ownFaces[id]) return false;
  }
  return true;
}
/* Meshes read back (a warm visit) after the title's init had already been
   answered: given now, if they pass, for the columns not yet asked for. */
function lateMeshes(p) {
  if (p.reading || !p.look) return;          // (the other half still to come)
  p.late = false;
  if (serving !== p.name || !preCheck(p)) return;
  preMeshes = preMeshes || new Map();
  for (const [k, r] of p.meshes) preMeshes.set(k, r);
  self.postMessage({ type: 'premesh', list: [...p.meshes.keys()].map(k => k.split(',').map(Number)) });
}
// a generator made in stages (Minecraft's own Overworld): terrain, then features, then the chunk
const staged = g => !!(g && g.protoCache && g.writeCache && g.decorator);
const ck = (x, z) => x + ',' + z;

/* While a generator's code loads, what comes after the message that needs
   it waits, and then goes in the order it came. */
let held = null;
/* Messages are taken in turn, one each time round (a message to ourselves
   between them), so the ones that came in while a job ran are all seen
   before the next job starts: when a world is let go (idle, or the next
   world's init), the jobs still waiting for it are not done. A worker was
   kept on two of them (most of a fifth of a second) before it could start
   on the next world: going through a portal, or out of the title. */
const waiting = [];
const turn = new MessageChannel();
let turning = false;
turn.port2.onmessage = () => {
  turning = false;
  const m = waiting.shift();
  if (waiting.length) { turning = true; turn.port1.postMessage(0); }
  if (!m) return;
  if (held) held.push(m); else handle(m);
};
self.onmessage = e => {
  const m = e.data;
  if (m && (m.type === 'idle' || m.type === 'init')) for (let i = waiting.length - 1; i >= 0; i--) if (JOBS[waiting[i].type]) waiting.splice(i, 1);
  waiting.push(m);
  if (!turning) { turning = true; turn.port1.postMessage(0); }
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
  if (m.type === 'pregen') { startPre(m); return; }
  // the title's world made ahead (startPre): its own init takes what was made, anything else ends it
  let ahead = null;
  if (pre) { if (m.type === 'init' && nameOf(m) === pre.name) ahead = pre; pre = null; }
  if ((m.type === 'init' || m.type === 'practice') && !G && needsG(m)) {
    held = [m];
    loadGens().then(() => { const q = held; held = null; for (const x of q) handle(x); },
      err => { console.error('generator code', err); const q = held; held = null; loadingG = null; for (const x of q) if (x !== m) handle(x); });
    return;
  }
  if (m.type === 'init') {
    // (the meshes made ahead are kept only if they come out the same with the page's own textures and colours)
    prepare(m);
    const meshesOk = ahead ? preCheck(ahead) : false;
    // (a warm visit's meshes still being read back, or the check's own list not in yet, are given when they come: lateMeshes)
    if (ahead && !meshesOk && (ahead.reading || !ahead.look)) ahead.late = true;
    // (the world being left is kept as the one spare: coming back from the Nether, its generator need not be made again)
    const prev = gen && serving ? { gen, structs, name: serving } : null;
    const s = spares.get(nameOf(m)) || (prev && prev.name === nameOf(m) ? prev : null) || make(m);
    gen = s.gen; structs = s.structs;
    spares.clear();
    if (prev && prev.name !== nameOf(m)) spares.set(prev.name, prev);
    cacheKey = m.cache || null; tag = m.tag || 0; serving = nameOf(m);
    // the chunks made ahead for this very world, named in the answer so they are asked of this worker
    preMade = ahead && ahead.made.size ? ahead.made : null;
    preMeshes = meshesOk && ahead.meshes.size ? ahead.meshes : null;
    const coords = map => (map ? [...map.keys()].map(k => k.split(',').map(Number)) : null);
    self.postMessage({ type: 'ready', staged: staged(gen), features: staged(gen) && !!gen.decorator.features, pre: coords(preMade), preMesh: coords(preMeshes) });
    // (Minecraft's generators' code fetched and compiled now, behind the title's world, not when the next world is asked for)
    if (!G && !loadingG) setTimeout(() => { loadGens().catch(() => { loadingG = null; }); }, 0);
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
    }, missing => self.postMessage({ type: 'looked', tag: t, missing, more: true }))
      .then(failed => {
        if (failed.length) self.postMessage({ type: 'looked', tag: t, missing: failed, cached: true });
        // every chunk of the list sent: only now is this worker free again (world.js idlest)
        self.postMessage({ type: 'looked', tag: t, missing: [] });
      });
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
    // made ahead (the title's world, startPre): sent as it is
    const made = !m.proto && preMade ? preMade.get(ck(m.cx, m.cz)) : null;
    if (made) { preMade.delete(ck(m.cx, m.cz)); if (!preMade.size) preMade = null; }
    // staged: the chunk put together from the pieces handed in (its terrain, the features round it)
    if (m.proto) {
      gen.protoCache.set(ck(m.cx, m.cz), m.proto);
      for (const [x, z, list] of m.writes) gen.writeCache.set(ck(x, z), new Map(list));
    }
    const c = made ? made.c : gen.generate(m.cx, m.cz);
    if (m.proto) { gen.protoCache.clear(); gen.writeCache.clear(); }
    // the structures reaching into this chunk (one that cannot be built is left out, not the chunk)
    let extra = made ? made.extra : null;
    // (none in the first Leoncraft's own chunks of a world brought over from it)
    if (!made && !(gen.lc1Has && gen.lc1Has(m.cx, m.cz))) try { extra = structs ? structs.build(c, m.cx, m.cz) : null; } catch (e) { console.error('structures in ' + m.cx + ',' + m.cz, e); }
    if (cacheKey) keepChunk(cacheKey, m.cx, m.cz, c, extra);
    // (the terrain it was made from goes back to be used again, as a decoration's do; the chunk is a copy of it)
    const back = m.proto && m.proto.blocks.buffer !== c.blocks.buffer && m.proto.meta.buffer !== c.meta.buffer ? [m.proto.blocks.buffer, m.proto.meta.buffer] : [];
    self.postMessage({ type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: c.blocks, meta: c.meta, biome: c.biome, top: c.top, structs: extra, back },
      [c.blocks.buffer, c.meta.buffer, c.biome.buffer].concat(back));
    return;
  }
  if (m.type === 'mesh') {
    // a column meshed ahead (the title's world, startPre), if asked for with what it was made with
    const k = ck(m.cx, m.cz), ready = preMeshes && !m.base && !m.warm ? preMeshes.get(k) : null;
    if (ready) { preMeshes.delete(k); if (!preMeshes.size) preMeshes = null; }
    const same = ready && !!m.fast === ready.opts.fast && (m.blend === undefined ? 2 : m.blend) === ready.opts.blend && !!m.flat === ready.opts.flat
      && !!m.keep === ready.keep && !m.noSky && (m.seed | 0) === ready.seed && !(m.prev && m.prev.length) && !(m.moving && m.moving.length);
    const out = same ? ready.out : meshColumn(m);
    // one of the title's columns meshed here as the world asked, as the head start makes them: kept for the next visit too
    if (!same && !m.warm && !m.base && title && serving === title.name) keepTitleMesh(m, out);
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
    const here = serving ? serving.split('|')[0] : 'overworld';
    // a /locate of another dimension's structure (an end city asked for from the Overworld) is answered by that
    // dimension's own generator, so the End's island heights and biomes decide where the cities stand (this
    // world's own source has no endGround: every island read as 70 high, and the main island was let through)
    const other = m.op === 'locate' && structs ? otherDim(m) : null;
    if (other && other !== here) {
      const o = otherStructures(other);
      if (o) { self.postMessage(Object.assign({ type: 'structures', id: m.id }, structureMessage(o.structs, m, o.gen, other))); return; }
    }
    self.postMessage(Object.assign({ type: 'structures', id: m.id }, structureMessage(structs, m, gen, here)));
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
// this worker's code is all in: on a first visit the page waits for this before asking for its own (index.html)
self.postMessage({ type: 'up' });
