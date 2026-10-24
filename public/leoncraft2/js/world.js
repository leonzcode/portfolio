/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world on the main thread.

   Holds every loaded chunk (blocks, fluid levels, biomes), hands generation
   and meshing to a pool of workers nearest-first, meshes a column only once
   all eight around it exist (so its edges are right), drops chunks that fall
   out of range, and takes edits: a changed block remeshes its column, and
   the neighbouring one too when it sits on an edge.
--------------------------------------------------------------------------- */
import { CH, H, idx } from './world-const.js?v=107';
import { BLOCKS, FLUID } from './blocks.js?v=107';
import { searchSpawn } from './spawn.js?v=107';
import { settleEdges } from './edgevines.js?v=107';

/* RIP Computer's realism (render/realism.js) hears of every block taken away (gone: the world, where, what it was,
   what is there now) and every explosion (blast: where, its power; explosion.js, entities/explosion.js, net/events.js) */
export const WORLD_FX = { gone: null, blast: null };

/* ---- the workers, kept for the whole visit ----
   A new worker is slow for its first seconds: its code is fetched, compiled
   and only made fast as it runs. So the same workers serve every world (the
   title screen's, each one played, each dimension), each World telling them
   its seed with an init, and they are started the moment the page opens
   (startWorkers), so their code loads while the textures do. */
const GEN_N = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
const POOL = [];
function newWorker() {
  const w = new Worker(new URL('./worker.js?v=107', import.meta.url), { type: 'module' });
  w.onerror = e => console.error('worker', e.message || e);
  return w;
}
let started = 0;
export function startWorkers() {
  // the page starts them itself (index.html), so their code loads beside its own
  const early = self.__lc2Workers;
  if (early) { self.__lc2Workers = null; for (const w of early) if (started < GEN_N + 1) { w.onerror = e => console.error('worker', e.message || e); POOL.push(w); started++; } else w.terminate(); }
  while (started < GEN_N + 1) { POOL.push(newWorker()); started++; }
}
/* What the workers made ahead in the menus (practise) for the world most
   likely to be opened next: where a new one starts you, the terrain and
   features round where you will stand, taken by that World when it is made. */
let ahead = null;
/* Chunks are kept between visits (chunkcache.js) under the code's version
   stamp and the size of the block table: a new version never reads what an
   older one made. Tidied once a visit. */
const CACHE = 'c' + (new URL(import.meta.url).searchParams.get('v') || '0') + '.' + BLOCKS.length;
let swept = false;
/* Which worlds have chunks kept (their cache keys), remembered beside them:
   a world with none (the title's on a first visit, a world just made, a
   dimension never visited) does not wait on a read that can only come back
   empty (on a first visit that read alone took most of a second). */
const KEPT = 'lc2_kept';
function keptKeys() { try { const k = JSON.parse(localStorage.getItem(KEPT) || 'null'); return k && k.v === CACHE ? k.keys : []; } catch (e) { return []; } }
function noteKept(key) {
  try { const keys = keptKeys().filter(k => k !== key); keys.push(key); localStorage.setItem(KEPT, JSON.stringify({ v: CACHE, keys: keys.slice(-200) })); } catch (e) { /* read every time instead */ }
}
let worlds = 0;                    // each World's number, on everything read back for it (see lookup)
const numKey = (cx, cz) => cx * 4194304 + cz;       // a chunk as one number (|cz| < 2 million)
// the eight chunks round one by lightEdges' bits: west, east, north, south, then the corners
const EDGE_DX = [-1, 1, 0, 0, -1, 1, -1, 1], EDGE_DZ = [0, 0, -1, 1, -1, -1, 1, 1];
/* Practice in the menus: every worker the title's world has makes the world
   likely to be opened next (spec: seed, generator, dim, manifest, colours,
   and at: { x, z } where you will stand, or null for a new world). For a new
   one, where it starts you is looked for first (spawn.js, the search
   startGame would make, its columns shared out among the workers). Then the pieces the chunk you will stand in needs, nearest first: the
   terrain of the 49 chunks round it and the features of the 25 nearest, one
   piece a job, each worker handed its next as it gives one back, and last
   the mesher practised on that ground once by each. So the generator's code
   is compiled and fast, and the ground under you all but made, before
   Create New World or the world is ever pressed; the title's world waits
   meanwhile (practising). Typing a seed starts it again for that seed.
   then: a second world to practise once this one is done (the next new
   world, after the last one played); what the first made is kept too. */
const AHEAD_R = 3;                 // terrain within 3 chunks, features within 2: what your own chunk is put together from
let behind = null;                 // a world practised before the one under way, all done: kept for it all the same
export function practise(spec, world, then) {
  const name = spec.dim + '|' + spec.generator + '|' + spec.seed;
  // nothing to do when it is already made, or is the very world behind the title (it is kept for you)
  if ((ahead && ahead.name === name) || (behind && behind.name === name) || (world && !world.dead && world.dim + '|' + world.generator + '|' + world.seed === name)) {
    // (the world after it, once it is done, or at once when this one is already there)
    if (then && ahead && ahead.name === name) { ahead.then = then; if (done(ahead)) { ahead.then = null; practise(then, ahead.world); } }
    else if (then) practise(then, world);
    return;
  }
  // the workers of the world on screen (the title's, which waits meanwhile), or else those waiting in the pool
  const ws = world && !world.dead ? world.workers.slice() : POOL.slice(0, GEN_N + 1);
  if (world && !world.dead) world.yields = true;
  // the one under way, if it is all done, is kept beside the new one
  if (ahead && done(ahead)) behind = ahead;
  const a = ahead = { name, protos: new Map(), writes: new Map(), spawn: null, centre: null, staged: true, then: then || null, world,
    base: { type: 'practice', seed: spec.seed, generator: spec.generator, dim: spec.dim },
    asked: new Set(),               // pieces being made (chunk number * 4 + 1 terrain, + 2 features)
    failed: new Set(),              // pieces that came back with nothing (not asked for again)
    idle: new Set(), meshed: new Set(), ws, plan: null,
    searching: !spec.at, asks: new Map(), nextAsk: 1,
    surfQ: [],                      // the spawn search's columns not yet given to a worker (feed)
    surfaces: new Map() };          // and its answers, "x,z,biome?" -> { y, biome }: a World opened mid-search goes on from them
  /* A world played before: its chunks round you are most likely kept
     (chunkcache.js) and read back in a moment when it opens, so the first
     worker asks first, and the ground is made ahead only if they are not. */
  const nineAt = c => { const l = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) l.push([c[0] + dx, c[1] + dz]); return l; };
  if (spec.at) { a.centre = [Math.floor(spec.at.x / CH), Math.floor(spec.at.z / CH)]; a.probing = true; }
  ws.forEach((w, i) => {
    if (!world || world.dead) w.onmessage = e => keepAhead(e.data, w);
    // a worker may still be on a piece of the world practised before: this goes after it. Each makes the
    // generator (the textures and colours come once, with this); the first asks whether a world played before is kept
    w.postMessage(Object.assign({ manifest: spec.manifest, colours: spec.colours }, a.base, i || !a.centre ? {} : { probe: nineAt(a.centre), cache: CACHE + '|' + name }));
  });
  if (a.searching) {
    /* Each column goes to the next worker free for it (feed), not to each in turn: a ring of the search
       waits for its last column, and a worker still busy with the title's world (or loading the
       generator's code) held the whole search up, for most of a second at times. */
    searchSpawn(q => new Promise(res => {
      const id = a.nextAsk++, key = q.x + ',' + q.z + ',' + (q.withBiome ? 1 : 0);
      a.asks.set(id, r => { a.surfaces.set(key, r); res(r); });
      a.surfQ.push(Object.assign({ surface: [q.x, q.z, q.withBiome ? 1 : 0], id }, a.base));
      for (const x of [...a.idle]) { if (!a.surfQ.length) break; feed(a, x); }
    })).then(spawn => {
      // where the new world starts you: from here on, the ground round it
      a.searching = false; a.spawn = spawn; a.centre = [Math.floor(spawn.x / CH), Math.floor(spawn.z / CH)];
      for (const x of [...a.idle]) feed(a, x);
    }, e => { console.warn('spawn search', e); a.searching = false; });
  }
}
// whether practice still has work on the workers (the title's world waits meanwhile: World.yields)
const done = a => !a.searching && a.idle.size >= a.ws.length;
export function practising() { return !!ahead && !done(ahead); }
// the pieces round the centre, nearest first: [distance, x, z, stage (1 terrain, 2 features)]
function planOf(a) {
  const [cx, cz] = a.centre, plan = [];
  for (let dz = -AHEAD_R; dz <= AHEAD_R; dz++) for (let dx = -AHEAD_R; dx <= AHEAD_R; dx++) {
    const d = dx * dx + dz * dz, x = cx + dx, z = cz + dz;
    plan.push([d, x, z, 1]);
    if (Math.max(Math.abs(dx), Math.abs(dz)) < AHEAD_R) plan.push([d, x, z, 2]);
  }
  return plan.sort((p, q) => p[0] - q[0] || q[3] - p[3]);
}
// a worker's next piece of practice, or nothing left for it (it waits)
function feed(a, w) {
  if (a !== ahead) return;
  // a column for the spawn search, first
  if (a.surfQ.length) { a.idle.delete(w); w.postMessage(a.surfQ.shift()); return; }
  let msg = null;
  // (still looking for the spawn or asking what is kept)
  if (!a.centre || a.probing) { a.idle.add(w); return; }
  if (a.kept) { /* all of it kept: nothing to make */ }
  else if (a.staged) {
    const plan = a.plan || (a.plan = planOf(a));
    // the nearest features whose nine terrains are here, else the nearest terrain not asked for
    for (const [, x, z, st] of plan) {
      const f = numKey(x, z);
      if (st !== 2 || a.writes.has(f) || a.asked.has(f * 4 + 2) || a.failed.has(f * 4 + 2)) continue;
      let all = true;
      for (let tz = -1; tz <= 1 && all; tz++) for (let tx = -1; tx <= 1; tx++) if (!a.protos.has(numKey(x + tx, z + tz))) { all = false; break; }
      if (!all) continue;
      a.asked.add(f * 4 + 2);
      msg = { decorate: [x, z], protos: nine(a.protos, x, z) };
      break;
    }
    if (!msg) for (const [, x, z, st] of plan) {
      const f = numKey(x, z);
      if (st !== 1 || a.protos.has(f) || a.asked.has(f * 4 + 1) || a.failed.has(f * 4 + 1)) continue;
      a.asked.add(f * 4 + 1);
      msg = { terrain: [x, z] };
      break;
    }
    // everything round you made: the mesher practised on this ground, once by each worker
    if (!msg && !a.asked.size && !a.meshed.has(w) && a.writes.size) {
      a.meshed.add(w);
      msg = { mesh: a.centre, protos: nine(a.protos, a.centre[0], a.centre[1]) };
    }
  } else if (!a.meshed.has(w)) {
    // a generator not made in stages (the first one, the Nether's, the End's): a chunk made once, for the practice
    a.meshed.add(w);
    msg = { terrain: a.centre };
  }
  if (!msg) {
    a.idle.add(w);
    // all of it done: on to the world to practise next, if any
    if (done(a) && a.then) { const t = a.then; a.then = null; practise(t, a.world); }
    return;
  }
  a.idle.delete(w);
  const transfer = [];
  if (msg.protos) for (const p of msg.protos) transfer.push(p.blocks.buffer, p.meta.buffer);
  w.postMessage(Object.assign({}, a.base, msg), transfer);
}
// copies of the nine terrains round (x, z), for a job (the originals stay here for the next)
function nine(protos, x, z) {
  const out = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const p = protos.get(numKey(x + dx, z + dz));
    if (p) out.push({ cx: p.cx, cz: p.cz, blocks: p.blocks.slice(), meta: p.meta.slice(), grid: p.grid });
  }
  return out;
}
// what practice made, kept for its world; and that worker's next piece of it
function keepAhead(m, w) {
  const a = ahead;
  if (m.type !== 'practised' || !a || a.name !== m.name) return;
  // a column asked for by the spawn search
  if (m.surface) { const r = a.asks.get(m.id); a.asks.delete(m.id); if (r) r(m.surface); if (w) feed(a, w); return; }
  takeOut(a.protos, a.writes, m, a.asked);
  if (m.did && !m.out.length) a.failed.add(numKey(m.did[1], m.did[2]) * 4 + (m.did[0] === 't' ? 1 : 2));
  if (m.staged === false) a.staged = false;
  if (m.kept !== undefined && a.probing) {
    // the chunk you stand in and the eight round it all kept: nothing to make; else the ground round you
    a.probing = false; a.kept = m.kept >= 9;
  }
  if (w) feed(a, w);
  // what came back may be what the workers waiting were waiting for (the spawn, the nine terrains a chunk's features need)
  for (const x of [...a.idle]) if (x !== w) feed(a, x);
}
// practice's pieces into a world's (or ahead's) maps, and the piece asked for no longer being made (even if it failed)
function takeOut(protos, writes, m, asked) {
  for (const t of m.out) {
    const f = numKey(t[1], t[2]);
    if (t[0] === 't') protos.set(f, { cx: t[1], cz: t[2], blocks: t[3], meta: t[4], grid: t[5] });
    else writes.set(f, { cx: t[1], cz: t[2], w: t[3] });
  }
  if (m.did) asked.delete(numKey(m.did[1], m.did[2]) * 4 + (m.did[0] === 't' ? 1 : 2));
}

export class World {
  constructor(opts) {
    this.seed = opts.seed;
    this.generator = opts.generator || 'classic';    // 'vanilla' (Minecraft's own worlds) or 'classic' (the first generator)
    this.dim = opts.dim || 'overworld';        // js/dims.js: which generator the workers run
    this.structures = opts.structures !== false;   // Generate Structures (Create World): off, the workers build none
    // a world brought over from the first Leoncraft: its seed and the chunks made by its own generator (lc1/mixed.js)
    this.lc1 = opts.lc1 && opts.lc1.key ? opts.lc1 : null;
    this.noSky = this.dim === 'the_nether';     // no sky light at all there
    this.renderDist = opts.renderDist;
    this.chunks = new Map();          // "cx,cz" -> chunk
    this.byNum = new Map();           // the same by a number (chunkXZ), for lookups made thousands of times a tick
    this.onMesh = opts.onMesh;
    this.fastLeaves = !!opts.fastLeaves;
    // Video Settings the meshes are made with: Biome Blend (0 off to 7, 15 x 15) and Smooth Lighting
    this.blend = opts.blend === undefined ? 2 : opts.blend;
    this.flatLight = !!opts.flatLight;
    // Chunk Builder: 'threaded' (your own changes wait their turn), 'semi' (they are made at once), 'full' (so is every change next to you)
    this.builder = opts.builder || 'semi';
    this.onDrop = opts.onDrop;
    // what changed from the generated terrain, kept so a saved world comes back (see save.js)
    this.edits = opts.edits || new Map();       // "cx,cz" -> Map(cell index -> block * 256 + meta)
    this.save = opts.save || null;
    // blocks with a part being drawn moving instead (a chest's lid, a ringing bell: sim/lids.js), meshed without it
    this.moving = new Set();          // "x,y,z"
    const n = GEN_N;
    /* One more worker than that, kept for what you change yourself: a block
       you break or place is meshed again at once, never behind terrain being
       made (the generator can take a good fraction of a second a chunk). */
    this.genN = n; this.editW = n;
    this.workers = [];
    this.busy = [];
    this.live = [];                    // a worker answers for this world only once it has said it is ready
    this.nextId = 1;
    this.waiting = new Map();          // job id -> resolver
    // the stages of Minecraft's own worlds, kept until no chunk still to be made needs them (see schedule)
    this.protos = new Map();           // chunk number -> its terrain { cx, cz, blocks, meta, grid }
    this.writesOf = new Map();         // chunk number -> its features' writes { cx, cz, w: [[0..8, Int32Array], ...] }
    this.stageIn = new Set();          // chunk numbers * 4 + stage (1 terrain, 2 features) asked of a worker
    this.thrown = new Map();           // the same, -> times a piece came in too far away to keep since you last crossed a chunk (onStage)
    // (a world without structures is kept apart, and never takes chunks practised with them)
    const name = this.genName = this.dim + '|' + this.generator + '|' + this.seed + (this.structures ? '' : '|ns') + (this.lc1 ? '|' + this.lc1.key : '');
    // where this world's chunks are kept (opts.cache false: never)
    this.cacheKey = opts.cache === false ? null : CACHE + '|' + name;
    /* A world just created (opts.fresh), or one with nothing kept, has nothing
       to read back, so it does not wait on a read until it has let a chunk of
       its own go. */
    this.fresh = !!opts.fresh || (!!this.cacheKey && !keptKeys().includes(this.cacheKey));
    this.noted = false;
    this.tag = ++worlds;
    this.lookingUp = new Map();       // "cx,cz" being read back from the kept chunks -> when it was asked
    this.missing = new Map();         // "cx,cz" -> [cx, cz]: not kept, to be made
    /* What practice made for this very world is taken (and where it starts
       you, for a new one); pieces still being made for it are not asked for
       again, they come in as practice (takePractice). */
    this.spawnAhead = null;
    const pre = ahead && ahead.name === name ? ahead : behind && behind.name === name ? behind : null;
    this.surfacesAhead = pre ? pre.surfaces : null;
    if (pre) {
      this.protos = pre.protos; this.writesOf = pre.writes; this.spawnAhead = pre.spawn;
      for (const p of pre.asked) this.stageIn.add(p);
    }
    ahead = null; behind = null;
    startWorkers();
    /* Ready once the first of the workers making chunks is: the others join in
       as each finishes what it was doing (a piece of practice, say), and no
       job goes to one before it has (idlest). */
    let first;
    this.ready = new Promise(res => { first = res; });
    this.initMsg = { type: 'init', seed: this.seed, generator: this.generator, dim: this.dim, structures: this.structures, manifest: opts.manifest, colours: opts.colours, cache: this.cacheKey, tag: this.tag };
    if (this.lc1) this.initMsg.lc1 = this.lc1;
    /* Every job out, with when it went and to which worker ('g' and 'm' + "cx,cz"
       for a chunk and a mesh, 't' and 'd' + its number for a terrain and its
       features): one never answered is asked again (audit). */
    this.sentAt = new Map();
    this.fails = new Map();            // a job that went wrong in a worker: how many times, and when
    // the pieces practice is still making for this world, by no worker of ours (-1): given up on in time like the rest
    for (const p of this.stageIn) { const st = ((p % 4) + 4) % 4; this.sentAt.set((st === 1 ? 't' : 'd') + (p - st) / 4, [performance.now(), -1]); }
    for (let i = 0; i <= n; i++) {
      const w = POOL.shift() || newWorker();
      this.live.push(false);
      w.onmessage = e => this.onMessage(i, e.data, () => { if (i < n) first(); });
      w.postMessage(this.initMsg);
      // once a visit, the edit worker tidies the kept chunks (old versions out)
      // (a while after the page opens: it holds the store, and the first worlds' reads would wait behind it)
      if (i === n && !swept) { swept = true; setTimeout(() => w.postMessage({ type: 'sweep', prefix: CACHE + '|', limit: 40000 }), 15000); }
      this.workers.push(w);
      this.busy.push(0);
    }
    this.genQueue = new Set();
    this.meshQueue = new Set();
    this.inFlight = new Set();
    this.meshVersion = new Map();
    this.meshCache = new Map();       // "cx,cz" -> { version, mesh }: the last mesh of each column next to you
    /* The rows changed in each column, with the newest mesh version sent
       when they changed ("cx,cz" -> [[version, low row, high row], ...]): a
       mesh of a later version has them, an earlier one does not. So any edit
       next to you is made again on the kept mesh, from the rows changed since
       it, even while other remeshes of the column are on their way. */
    this.rowLog = new Map();
    this.stats = { gen: 0, mesh: 0 };
    /* The blocks a mesh job takes along are copied into buffers the workers hand
       back with the mesh, and used again: a fresh one for each of the nine chunks
       of every job (a megabyte a column) cost the main thread most of a
       millisecond in making and clearing new memory, two jobs a frame while the
       world loads. */
    this.pool = { b: [], m: [] };
  }
  // a buffer for a chunk's blocks (b) or states (m), whole-chunk sized, from those handed back if any
  takeBuf(k) { return this.pool[k].pop() || new ArrayBuffer(k === 'b' ? CH * CH * H * 2 : CH * CH * H); }
  giveBack(list) {
    if (!list) return;
    for (const buf of list) {
      const k = buf.byteLength === CH * CH * H * 2 ? 'b' : buf.byteLength === CH * CH * H ? 'm' : null;
      if (k && this.pool[k].length < 96) this.pool[k].push(buf);
    }
  }
  key(cx, cz) { return cx + ',' + cz; }
  /* The chunk at chunk coordinates, found without making a string: the
     simulation and the mobs look chunks up thousands of times a tick, and each
     "cx,cz" made was garbage. The number keeps 15 bits of each coordinate, so
     the chunk found is checked to be the one asked for. */
  chunkXZ(cx, cz) {
    const c = this.byNum.get(((cx & 0x7fff) << 15) | (cz & 0x7fff));
    return c !== undefined && c.cx === cx && c.cz === cz ? c : undefined;
  }
  // the column you are in and the eight round it: the ones you can reach to build in
  near(cx, cz) { return Math.abs(cx - this.pcx) <= 1 && Math.abs(cz - this.pcz) <= 1; }

  onMessage(i, m, initRes) {
    if (m.type === 'up') return;         // a worker's code loaded (index.html waits for it on a first visit)
    // practice finishing for this very world (it was opened while the workers were still at it)
    if (m.type === 'practised') { if (m.name === this.genName) this.takePractice(m); else keepAhead(m, this.dead ? null : this.workers[i]); return; }
    // columns of the title's world read back by a worker after it had answered its init (worker.js lateMeshes)
    if (m.type === 'premesh') {
      if (this.live[i]) for (const [x, z] of m.list) {
        const k = this.key(x, z), c = this.chunks.get(k);
        if (c && c.meshed || this.inFlight.has('m' + k)) continue;
        if (!this.preMeshAt || !this.preMeshAt.size) { this.preMeshAt = this.preMeshAt || new Map(); this.preMeshSince = performance.now(); }
        this.preMeshAt.set(k, i);
      }
      return;
    }
    // anything else from before the init (a job of the world this worker served last) is not ours
    if (!this.live[i]) {
      if (m.type === 'ready') {
        this.live[i] = true; if (i < this.genN && m.staged) { this.staged = true; this.features = !!m.features; }
        // chunks this worker made ahead (the title's world: worker.js startPre), and columns it meshed, asked of it and of no other
        if (m.pre) for (const [x, z] of m.pre) (this.preAt || (this.preAt = new Map())).set(this.key(x, z), i);
        if (m.preMesh) { if (!this.preMeshAt) this.preMeshSince = performance.now(); for (const [x, z] of m.preMesh) (this.preMeshAt || (this.preMeshAt = new Map())).set(this.key(x, z), i); }
        initRes();
      }
      return;
    }
    /* Chunks are read back from the kept ones in the background, so a worker
       can still be sending those of the world it served before: not ours. */
    if ((m.cached || m.type === 'looked') && m.tag !== this.tag) return;
    // (never below nothing: a job given up on as lost can still answer late)
    /* (a read of kept chunks says what is not kept at once, more: true, and
       is done only once it has sent every chunk it found, all of them
       unsqueezed on that worker meanwhile: a column meshed there waited on
       them, the one you stand in among them) */
    if (!m.cached && !m.more && this.busy[i] > 0) this.busy[i]--;
    if (m.back) this.giveBack(m.back);
    this.sched = true;                 // a worker is free: see what is next (schedule)
    if (m.type === 'failed') { this.onFailed(m); return; }
    if (m.type === 'terrain' || m.type === 'decorate') { this.sentAt.delete((m.type === 'terrain' ? 't' : 'd') + numKey(m.cx, m.cz)); this.onStage(m); return; }
    if (m.type === 'looked') {
      for (const [x, z] of m.missing) { const k = this.key(x, z); this.lookingUp.delete(k); this.missing.set(k, [x, z]); }
      return;
    }
    if (m.type === 'gen') {
      const k = this.key(m.cx, m.cz);
      this.inFlight.delete('g' + k);
      if (!m.cached) this.sentAt.delete('g' + k);
      this.lookingUp.delete(k);
      if (!m.cached) this.missing.delete(k);
      // its chunks are being kept from now on: the next visit reads them back
      if (!m.cached && this.cacheKey && !this.noted) { this.noted = true; noteKept(this.cacheKey); }
      if (!this.wanted(m.cx, m.cz)) return;
      /* already here (read back from the kept chunks and made too, after a read
         that came late; or asked again after a worker went quiet): the one here
         stays, with its mesh and whatever lives in it */
      if (this.chunks.has(k)) return;
      const c = { cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, biome: m.biome, top: m.top, meshed: false, structs: m.structs || null };
      // put back whatever was changed here before
      const ed = this.edits.get(k);
      if (ed) for (const [cell, v] of ed) { c.blocks[cell] = v >> 8; c.meta[cell] = v & 255; if (v >> 8 && (cell >> 8) > c.top) c.top = cell >> 8; }
      this.chunks.set(k, c); this.byNum.set(((m.cx & 0x7fff) << 15) | (m.cz & 0x7fff), c); this.cgen = (this.cgen || 0) + 1;
      this.stats.gen++;
      // vines and lichen along its edges, held by what the chunks beside it really have (edgevines.js)
      settleEdges(this, c);
      // this chunk, and every neighbour it completes, can now be meshed
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.queueMesh(m.cx + dx, m.cz + dz);
      return;
    }
    if (m.type === 'mesh') {
      const k = this.key(m.cx, m.cz);
      this.inFlight.delete('m' + k);
      this.sentAt.delete('m' + k + '#' + m.version);
      const c = this.chunks.get(k);
      if (!c) return;
      /* Any mesh newer than the one on screen is shown. (Waiting for the very
         last one sent made a block you broke wait behind the slower remeshes
         that terrain still loading round it keeps asking for.) */
      const shown = this.shownVersion || (this.shownVersion = new Map());
      if (m.version <= (shown.get(k) || 0)) return;
      shown.set(k, m.version);
      c.meshed = true;
      if (m.mesh.light) {
        // light that changed along the column's edges: the columns beside it were drawn with the old (lightEdges)
        if (c.light) this.lightEdges(m.cx, m.cz, c.light, c.lightH, m.mesh.light, m.mesh.lightH);
        c.light = m.mesh.light; c.lightH = m.mesh.lightH;    // (also for mobs: js/entities)
      }
      this.stats.mesh++;
      this.onMesh(m.cx, m.cz, m.mesh, m.urgent);
      // the columns round you keep their mesh (with the region's light), so an edit there remakes only its sections
      if (m.mesh.region && this.near(m.cx, m.cz)) this.meshCache.set(k, { version: m.version, mesh: m.mesh });
      else this.meshCache.delete(k);
      // what this mesh already has needs no remembering
      const log = this.rowLog.get(k);
      if (log) { let j = 0; for (const e of log) if (e[0] >= m.version) log[j++] = e; log.length = j; if (!j) this.rowLog.delete(k); }
      // (not while a loading screen waits: the edit worker is making the ground then, and the ground waited behind these)
      if (!this.warmed && !this.allHands && m.cx === this.pcx && m.cz === this.pcz && this.meshCache.has(k)) this.warmEditWorker(m.cx, m.cz);
      return;
    }
    if (m.type === 'warmed') return;
    const r = this.waiting.get(m.id);
    if (r) { this.waiting.delete(m.id); r(m); }
  }
  ask(msg) {
    return new Promise(res => {
      const id = this.nextId++;
      this.waiting.set(id, res);
      const i = this.idlest();
      this.busy[i]++;
      this.workers[i].postMessage(Object.assign({ id }, msg));
    });
  }
  /* The least busy worker of those ready. The one kept for your edits joins
     in while nothing can be edited (allHands: a loading screen, the title's world). */
  idlest() {
    const n = this.genN + (this.allHands ? 1 : 0);
    let b = -1;
    for (let i = 0; i < n; i++) if (this.live[i] && (b < 0 || this.busy[i] < this.busy[b])) b = i;
    return b < 0 ? 0 : b;
  }

  /* The chunks to make, (dx, dz) from yours: every one next to a column within
     render distance, as a column is meshed only once all eight round it are
     here. (A circle one chunk wider missed sixteen of them, so twelve columns
     at the very edge, the one straight ahead among them, were never drawn.)
     With k = 2 it is every chunk whose features one of those needs, and with
     k = 3 every chunk whose terrain they need (a chunk's features are placed
     on the terrain of the nine round it). */
  inReach(dx, dz, k = 1) {
    const a = Math.max(Math.abs(dx) - k, 0), b = Math.max(Math.abs(dz) - k, 0), rd = this.renderDist;
    return a * a + b * b <= rd * rd;
  }
  /* A piece (terrain or features) too far from you to keep: past the circle
     kept for when you walk on, and not needed by any chunk still to make.
     (The circle alone, render distance + 4, left out the terrain the corner
     chunks need at 3, 5, 8, 9, 10 and most distances past 12: it came in, was
     thrown away and was asked for again, for ever, with every worker busy and
     the columns there never drawn.) */
  farPiece(cx, cz, terrain) {
    const dx = cx - this.pcx, dz = cz - this.pcz, R = this.renderDist + 4;
    return dx * dx + dz * dz > R * R && !this.inReach(dx, dz, terrain ? 3 : 2);
  }
  wanted(cx, cz) {
    const dx = cx - this.pcx, dz = cz - this.pcz;
    return dx * dx + dz * dz <= (this.renderDist + 2) * (this.renderDist + 2);
  }
  // the chunk and all eight round it are here
  around(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) return false;
    return true;
  }
  queueMesh(cx, cz) {
    const k = this.key(cx, cz);
    if (!this.chunks.has(k)) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) return;
    this.meshQueue.add(k);
  }

  /* ---- each frame: what to make next ---- */
  update(px, pz) {
    if (this.dead) return;            // left behind (the title's world while the next one loads)
    const pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH);
    // the edit worker's practice, once the loading screen has let it go (see the mesh answer)
    if (!this.warmed && !this.allHands && pcx === this.pcx && pcz === this.pcz && this.meshCache.has(this.key(pcx, pcz))) this.warmEditWorker(pcx, pcz);
    /* what to load is planned again when you cross into another chunk, when the
       render distance changes (a longer one asked for nothing new until you
       walked on; a shorter one let go of nothing), and when the check below
       (audit) finds a chunk nobody is making */
    const moved = pcx !== this.pcx || pcz !== this.pcz || this.renderDist !== this.planDist || this.replan;
    this.planDist = this.renderDist; this.replan = false;
    this.pcx = pcx; this.pcz = pcz;
    const R = this.renderDist + 1;
    if (moved) {
      this.thrown.clear();
      // forget what is too far, and line up what is missing, nearest first
      for (const [k, c] of this.chunks) if (!this.wanted(c.cx, c.cz)) { this.fresh = false; this.chunks.delete(k); this.byNum.delete(((c.cx & 0x7fff) << 15) | (c.cz & 0x7fff)); this.meshCache.delete(k); this.rowLog.delete(k); this.cgen = (this.cgen || 0) + 1; this.onDrop(c.cx, c.cz); }
      this.genList = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (!this.inReach(dx, dz)) continue;
        if (!this.chunkXZ(pcx + dx, pcz + dz)) this.genList.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
      }
      this.genList.sort((a, b) => a[0] - b[0]);
      this.lookup();
      // the columns now next to you get their mesh made again to keep (meshCache); the rest let theirs go
      for (const k of this.meshCache.keys()) { const [x, z] = k.split(',').map(Number); if (!this.near(x, z)) this.meshCache.delete(k); }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const k = this.key(pcx + dx, pcz + dz), c = this.chunks.get(k);
        if (c && c.meshed && !this.meshCache.has(k) && !this.inFlight.has('m' + k)) this.queueMesh(pcx + dx, pcz + dz);
      }
    }
    this.lookupStuck();
    const now = performance.now();
    if (moved || now - (this.auditAt || 0) > 1000) this.audit(now);
    /* (six deep while a loading screen or the title waits (focus) on a world made
       a chunk at a time, so a worker stays busy while the page is; a world made in
       stages stays at two, as its pieces wait on each other: deeper, the ones the
       chunk you stand in needs waited behind others in the workers' lines) */
    const deep = this.focus >= 0 && !this.staged ? 6 : 2, cap = this.workers.length * deep;
    // meshes first (they are what you see), nearest first; a few a frame, so packing them never stalls one
    /* (the nearest picked out of the line each time, rather than the whole line
       split into numbers and sorted every frame: with every worker busy that was
       all garbage, and nothing went out) */
    /* (more while a loading screen or the title waits for the ground round you
       (focus): no frame of play to keep smooth, and with the page busy loading,
       update can come round seldom, two at a time left the workers waiting) */
    let sends = 0;
    const most = this.focus >= 0 ? 8 : 2;
    /* (columns a worker meshed ahead go first, for a second at most: they come back at once, but sent
       after another column's mesh they waited in that worker's line behind it) */
    const preFirst = this.preMeshAt && this.preMeshAt.size && now - this.preMeshSince < 1000;
    while (this.meshQueue.size && sends < most && this.inFlightCount() < cap) {
      let best = null, bd = Infinity, bx = 0, bz = 0;
      for (const k of this.meshQueue) {
        if (this.inFlight.has('m' + k) || (preFirst && !this.preMeshAt.has(k))) continue;
        const c = this.chunks.get(k);
        if (!c) { this.meshQueue.delete(k); continue; }
        const d = (c.cx - pcx) * (c.cx - pcx) + (c.cz - pcz) * (c.cz - pcz);
        if (d < bd) { bd = d; best = k; bx = c.cx; bz = c.cz; }
      }
      if (best === null) break;
      /* The nearest is past what is drawn, so the rest are too: they wait in the
         line for you to come closer. (Taken out of it, a column that came in
         while you flew away was never meshed when you turned back, as nothing
         round it arrived again to put it back: a hole in the world.) */
      if (bd > this.renderDist * this.renderDist) break;
      sends++;
      this.meshQueue.delete(best);
      // a neighbour gone since it was queued: it is queued again when that one is back
      if (!this.around(bx, bz)) continue;
      this.sendMesh(bx, bz);
    }
    // the title's world makes one thing at a time while the workers practise on the world you are about to open (practise)
    const held = !!this.yields && practising();
    if (this.yielding && !held) this.sched = true;   // practice done: back to its own pace
    this.yielding = held;
    const gcap = held ? 1 : cap;
    if (this.staged) {
      if (moved || this.sched) this.schedule(gcap);
      // what is no longer needed goes when you cross into another chunk, and once all round you is made
      if (moved) this.prunedAll = false;
      if (moved || (!this.prunedAll && this.genList.length === 0 && !this.stageIn.size)) { this.prune(); this.prunedAll = this.genList.length === 0; }
      return;
    }
    const L = this.genList;
    const ahead = this.preAt && this.preAt.size;
    if (!L || !L.length || (this.inFlightCount() >= gcap && !ahead)) return;
    let j = 0;
    for (let n = 0; n < L.length; n++) {
      const e = L[n], x = e[1], z = e[2], k = this.key(x, z);
      if (this.chunks.has(k) || this.inFlight.has('g' + k)) continue;
      // one made ahead (the title's world: worker.js startPre) goes at once to the worker holding it, which answers at once
      const o = ahead ? this.preAt.get(k) : undefined;
      if (o !== undefined && this.live[o]) { this.preAt.delete(k); this.inFlight.add('g' + k); this.job(o, 'g' + k, { type: 'gen', cx: x, cz: z }); continue; }
      // still being read back from the kept chunks, no worker free, or a loading screen waiting on nearer ones (focus): later
      if (this.lookingUp.has(k) || this.inFlightCount() >= gcap || (this.focus >= 0 && Math.max(Math.abs(x - this.pcx), Math.abs(z - this.pcz)) > this.focus)) { L[j++] = e; continue; }
      // (never deeper on one worker than its share: while the others were still saying they were ready, the first got them all)
      const i = this.idlest();
      if (this.busy[i] >= deep) { L[j++] = e; continue; }
      this.inFlight.add('g' + k);
      this.job(i, 'g' + k, { type: 'gen', cx: x, cz: z });
    }
    L.length = j;
  }
  /* The chunks newly wanted, asked of the kept ones first (one read for
     all of them, by whichever worker is free); what is not kept is made. */
  lookup() {
    for (const [k, [x, z]] of this.missing) if (!this.wanted(x, z)) this.missing.delete(k);
    if (!this.cacheKey || this.fresh) return;
    const list = [];
    for (const e of this.genList) {
      const k = this.key(e[1], e[2]);
      if (this.chunks.has(k) || this.missing.has(k) || this.lookingUp.has(k) || this.inFlight.has('g' + k) || (this.preAt && this.preAt.has(k))) continue;
      if (!this.lookingUp.size) this.lookOldest = performance.now();
      this.lookingUp.set(k, performance.now()); list.push([e[1], e[2]]);
    }
    if (!list.length) return;
    // a whole area (a world opening) is shared by every worker, nearest ones first in each; a few by the least busy
    const n = list.length > 16 ? this.genN : 1, parts = Array.from({ length: n }, () => []);
    list.forEach((e, j) => parts[j % n].push(e));
    for (const part of parts) { const i = this.idlest(); this.busy[i]++; this.workers[i].postMessage({ type: 'lookup', list: part }); }
  }
  /* A read that never comes back (storage stuck or gone) must not hold the
     world up: after a few seconds whatever is still being read is made. */
  lookupStuck() {
    if (!this.lookingUp.size) return;
    // (each read's own clock: while you fly on, new reads kept a stuck one waiting for ever)
    const now = performance.now();
    if (now - this.lookOldest < 4000) return;
    let n = 0, oldest = Infinity;
    for (const [k, t] of this.lookingUp) {
      if (now - t < 4000) { if (t < oldest) oldest = t; continue; }
      this.lookingUp.delete(k); this.missing.set(k, k.split(',').map(Number)); n++;
    }
    this.lookOldest = oldest;
    if (n) { console.warn('kept chunks not read back in time; making', n); this.sched = true; }
  }
  inFlightCount() { return this.inFlight.size + this.stageIn.size; }
  // a job for worker i, remembered (sentAt) under what it makes
  job(i, key, msg, transfer) {
    this.busy[i]++;
    this.sentAt.set(key, [performance.now(), i]);
    if (transfer) this.workers[i].postMessage(msg, transfer); else this.workers[i].postMessage(msg);
  }

  /* ---- the check that nothing is forgotten, once a second and whenever you
     cross into another chunk: every column within render distance is drawn,
     or on its way. ----
     A column whose chunk and eight neighbours are here, with no mesh and none
     being made, goes back in the line. A chunk within reach that nobody is
     making plans the loading again. A job a worker never answered (it went
     wrong there, or the worker stopped) is asked again, of a fresh worker. */
  audit(now) {
    this.auditAt = now;
    const rd = this.renderDist, rd2 = rd * rd;
    for (const c of this.chunks.values()) {
      if (c.meshed) continue;
      const dx = c.cx - this.pcx, dz = c.cz - this.pcz;
      if (dx * dx + dz * dz > rd2) continue;
      const k = this.key(c.cx, c.cz);
      if (this.meshQueue.has(k) || this.inFlight.has('m' + k) || !this.around(c.cx, c.cz)) continue;
      const f = this.fails.get('m' + k);
      if (f && (f[0] >= 3 || now - f[1] < 2000)) continue;
      this.meshQueue.add(k);
      this.stats.rescued = (this.stats.rescued || 0) + 1;
    }
    // a chunk within reach, not here and not asked for, that the plan has lost
    if (this.genList && !this.replan) {
      const R = rd + 1;
      let lost = null;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (!this.inReach(dx, dz)) continue;
        const x = this.pcx + dx, z = this.pcz + dz;
        if (this.chunkXZ(x, z)) continue;
        const k = this.key(x, z);
        if (this.inFlight.has('g' + k) || this.lookingUp.has(k)) continue;
        (lost || (lost = [])).push(numKey(x, z));
      }
      if (lost) {
        const listed = new Set();
        for (const e of this.genList) listed.add(numKey(e[1], e[2]));
        if (lost.some(f => !listed.has(f))) { this.replan = true; this.stats.replans = (this.stats.replans || 0) + 1; }
      }
    }
    // a job not answered in half a minute is lost: its worker is started afresh and all it had is asked again
    // (a piece practice was making is simply asked again)
    let stuck = -1;
    for (const [key, [t, i]] of this.sentAt) {
      if (now - t <= 30000) continue;
      if (i < 0) { this.sentAt.delete(key); this.forget(key); this.sched = true; } else if (stuck < 0) stuck = i;
    }
    if (stuck >= 0) this.replaceWorker(stuck);
  }
  replaceWorker(i) {
    console.warn('a chunk worker stopped answering; starting it again');
    const old = this.workers[i];
    old.onmessage = null;
    old.terminate();
    const w = newWorker();
    this.live[i] = false; this.busy[i] = 0;
    w.onmessage = e => this.onMessage(i, e.data, () => {});
    w.postMessage(this.initMsg);
    this.workers[i] = w;
    for (const [key, [, j]] of this.sentAt) if (j === i) { this.sentAt.delete(key); this.forget(key); }
    if (i === this.editW) this.warmed = false;
    this.replan = true; this.sched = true;
    this.stats.restarts = (this.stats.restarts || 0) + 1;
  }
  // a job's marks taken off, so it is asked for again
  forget(key) {
    const kind = key[0], rest = key.slice(1);
    if (kind === 'g') this.inFlight.delete(key);
    else if (kind === 'm') { const k = rest.split('#')[0]; this.inFlight.delete('m' + k); this.meshCache.delete(k); const [x, z] = k.split(',').map(Number); this.queueMesh(x, z); }
    else if (kind === 't') this.stageIn.delete(+rest * 4 + 1);
    else if (kind === 'd') this.stageIn.delete(+rest * 4 + 2);
  }
  /* A job that went wrong in the worker (worker.js answers 'failed' rather than
     never answering): asked again a little later, three times at most. */
  onFailed(m) {
    const key = m.job === 'mesh' ? 'm' + this.key(m.cx, m.cz) : m.job === 'gen' ? 'g' + this.key(m.cx, m.cz) : (m.job === 'terrain' ? 't' : 'd') + numKey(m.cx, m.cz);
    this.sentAt.delete(m.job === 'mesh' ? key + '#' + m.version : key);
    const f = this.fails.get(key) || [0, 0];
    f[0]++; f[1] = performance.now();
    this.fails.set(key, f);
    if (f[0] === 3) console.warn('giving up on', m.job, m.cx, m.cz);
    if (m.job === 'mesh') { this.inFlight.delete(key); return; }      // (audit puts it back in the line)
    if (f[0] >= 3) return;                                           // (its marks stay: never asked again)
    this.forget(key);
  }

  /* ---- Minecraft's own worlds, in stages ----
     A chunk is put together (gen) from its own terrain and the features of
     the nine chunks round it; each of those features is placed against the
     terrain of the nine round it. So the chunks wanted, nearest first, ask
     for what they lack: the chunk itself once every piece is here, else the
     features whose terrain is all here, else the terrain still missing. Each
     piece is made once, by whichever worker is free, and kept here until
     every chunk round it is made (or it is far behind you). */
  schedule(cap) {
    this.sched = false;
    const list = this.genList;
    if (!list) return;
    /* (this runs whenever a worker answers, over every chunk still to make: no
       string is made for one until a job could go out for it, which with every
       worker busy is never) */
    let j = 0;
    for (let n = 0; n < list.length; n++) {
      const e = list[n], x = e[1], z = e[2];
      if (this.chunkXZ(x, z)) continue;
      list[j++] = e;                       // still to be made: stays in the list
      if (this.inFlightCount() >= cap) continue;
      const k = this.key(x, z);
      if (this.inFlight.has('g' + k) || this.lookingUp.has(k)) continue;
      // while a loading screen waits for the chunks round you (focus), nothing further away takes a worker
      if (this.focus >= 0 && Math.max(Math.abs(x - this.pcx), Math.abs(z - this.pcz)) > this.focus) continue;
      if (this.canGen(x, z)) { this.sendGen(x, z); continue; }
      if (!this.features) { this.askTerrain(x, z); continue; }
      for (let dz = -1; dz <= 1 && this.inFlightCount() < cap; dz++) for (let dx = -1; dx <= 1 && this.inFlightCount() < cap; dx++) {
        const fx = x + dx, fz = z + dz, f = numKey(fx, fz);
        if (this.writesOf.has(f) || this.stageIn.has(f * 4 + 2)) continue;
        let all = true;
        for (let tz = -1; tz <= 1; tz++) for (let tx = -1; tx <= 1; tx++) if (!this.protos.has(numKey(fx + tx, fz + tz))) { all = false; if (this.inFlightCount() < cap) this.askTerrain(fx + tx, fz + tz); }
        if (all) this.sendDecorate(fx, fz);
      }
    }
    list.length = j;
  }
  canGen(x, z) {
    if (!this.protos.has(numKey(x, z))) return false;
    if (this.features) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.writesOf.has(numKey(x + dx, z + dz))) return false;
    return true;
  }
  askTerrain(x, z) {
    const t = numKey(x, z);
    if (this.protos.has(t) || this.stageIn.has(t * 4 + 1)) return;
    this.stageIn.add(t * 4 + 1);
    this.job(this.idlest(), 't' + t, { type: 'terrain', cx: x, cz: z });
  }
  /* a chunk's terrain as a worker takes it: copied, for the original stays here for the other jobs that
     need it; into buffers the worker hands back when the job is done (see pool). Fresh ones each time, nine
     to a decoration, were three megabytes a job for the collector while a world loads. */
  protoCopy(p) {
    const blocks = new Uint16Array(this.takeBuf('b')), meta = new Uint8Array(this.takeBuf('m'));
    blocks.set(p.blocks); meta.set(p.meta);
    return { cx: p.cx, cz: p.cz, blocks, meta, grid: p.grid };
  }
  sendDecorate(x, z) {
    const f = numKey(x, z), protos = [], transfer = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const p = this.protoCopy(this.protos.get(numKey(x + dx, z + dz)));
      protos.push(p); transfer.push(p.blocks.buffer, p.meta.buffer);
    }
    /* and the biomes of the terrains just beyond them that are here already: a
       lake there gives way to a lake of the chunks next to this one, and working
       out where those go wants the biomes round them (gen/features.js LazyRegion) */
    const grids = [];
    for (let dz = -2; dz <= 1; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx >= -1 && dx <= 1 && dz >= -1) continue;
      const p = this.protos.get(numKey(x + dx, z + dz));
      if (p && p.grid) grids.push([x + dx, z + dz, p.grid]);
    }
    this.stageIn.add(f * 4 + 2);
    this.job(this.idlest(), 'd' + f, { type: 'decorate', cx: x, cz: z, protos, grids }, transfer);
  }
  sendGen(x, z) {
    const k = this.key(x, z);
    const proto = this.protoCopy(this.protos.get(numKey(x, z)));
    const writes = [];
    if (this.features) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) writes.push([x + dx, z + dz, this.writesOf.get(numKey(x + dx, z + dz)).w]);
    this.inFlight.add('g' + k);
    this.job(this.idlest(), 'g' + k, { type: 'gen', cx: x, cz: z, proto, writes }, [proto.blocks.buffer, proto.meta.buffer]);
  }
  onStage(m) {
    const f = numKey(m.cx, m.cz);
    const st = f * 4 + (m.type === 'terrain' ? 1 : 2);
    this.stageIn.delete(st);
    if (this.farPiece(m.cx, m.cz, m.type === 'terrain')) {
      /* you have gone on: not worth keeping. But a piece thrown away twice
         without you crossing into another chunk is one something here still
         asks for, so the third time it is kept (else it is made again and
         again for ever, the workers never idle and a column never drawn). */
      const n = (this.thrown.get(st) || 0) + 1;
      this.thrown.set(st, n);
      if (n < 3) return;
      if (n === 3) console.warn('a piece thrown away and asked for again; kept', m.type, m.cx - this.pcx, m.cz - this.pcz);
    }
    if (m.type === 'terrain') this.protos.set(f, { cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, grid: m.grid });
    else this.writesOf.set(f, { cx: m.cx, cz: m.cz, w: m.writes });
  }
  takePractice(m) {
    takeOut(this.protos, this.writesOf, m, this.stageIn);
    if (m.did) this.sentAt.delete((m.did[0] === 't' ? 't' : 'd') + numKey(m.did[1], m.did[2]));
    this.sched = true;
  }
  /* How far along a chunk is, as the loading screen's squares show it (the
     game's status colours, menus.js CHUNK_COLOURS): 0 nothing, 1 being
     made, 4 its terrain, 5 its features, 6 made, 7 drawn. */
  stateAt(cx, cz) {
    const c = this.chunks.get(this.key(cx, cz)), f = numKey(cx, cz);
    if (c) return c.meshed ? 7 : 6;
    if (this.writesOf.has(f)) return 5;
    if (this.protos.has(f)) return 4;
    return this.inFlight.has('g' + this.key(cx, cz)) || this.stageIn.has(f * 4 + 1) || this.stageIn.has(f * 4 + 2) ? 1 : 0;
  }
  /* Roughly how much of what the column (cx, cz) needs before it can be
     drawn is done, 0 to 1, for the loading screen: the chunks round it, and
     for a world made in stages the terrain and features they are made from
     (a chunk already made, or read back from the kept ones, counts as all
     of them). */
  readiness(cx, cz) {
    let done = 0, all = 0;
    const made = (x, z) => this.chunks.has(this.key(x, z));
    const ring = (r, has) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { all++; if (made(cx + dx, cz + dz) || (has && has(numKey(cx + dx, cz + dz)))) done++; } };
    if (this.staged) { ring(3, f => this.protos.has(f)); ring(2, f => this.writesOf.has(f)); }
    ring(1, null);
    all += 2;
    const own = this.chunks.get(this.key(cx, cz));
    if (own && own.meshed) done += 2;
    return done / all;
  }
  /* The pieces no chunk still to be made needs: the terrain with all 25
     chunks round it made, the features with all nine; and anything far
     behind you. What sits at the edge of what is loaded is kept, for when
     you walk on. */
  prune() {
    const made = (x, z) => this.chunkXZ(x, z) !== undefined;
    for (const [f, p] of this.protos) {
      let all = true;
      for (let dz = -2; dz <= 2 && all; dz++) for (let dx = -2; dx <= 2; dx++) if (!made(p.cx + dx, p.cz + dz)) { all = false; break; }
      if (all || this.farPiece(p.cx, p.cz, true)) this.protos.delete(f);
    }
    for (const [f, p] of this.writesOf) {
      let all = true;
      for (let dz = -1; dz <= 1 && all; dz++) for (let dx = -1; dx <= 1; dx++) if (!made(p.cx + dx, p.cz + dz)) { all = false; break; }
      if (all || this.farPiece(p.cx, p.cz, false)) this.writesOf.delete(f);
    }
  }
  sendMesh(cx, cz, urgent, edit) {
    const k = this.key(cx, cz);
    /* A block changed (edit) in a column next to you that has a kept mesh:
       only the sections round the rows changed since that mesh are made
       again, in place of the same ones in it (mesher.js). Copied, not handed
       over: it may still be on its way to the graphics card. Anything else
       (a neighbour arriving changes the column's edges) makes the whole
       column again, and the kept mesh is no longer one to build on. */
    const kept = edit ? this.meshCache.get(k) : null;
    let base = null, rows = null;
    if (kept) {
      let lo = H, hi = -1;
      for (const e of this.rowLog.get(k) || []) if (e[0] >= kept.version) { if (e[1] < lo) lo = e[1]; if (e[2] > hi) hi = e[2]; }
      if (hi >= 0) { base = kept.mesh; rows = [lo, hi]; }
    }
    if (!edit) this.meshCache.delete(k);
    const chunks = [], tops = [], transfer = [];
    let top = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) top = Math.max(top, this.chunks.get(this.key(cx + dx, cz + dz)).top);
    const ny = Math.min(H, top + 2);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(this.key(cx + dx, cz + dz));
      // only the part with anything in it, copied into buffers kept for it (see pool)
      const blocks = new Uint16Array(this.takeBuf('b'), 0, ny * 256), meta = new Uint8Array(this.takeBuf('m'), 0, ny * 256);
      blocks.set(c.blocks.subarray(0, ny * 256)); meta.set(c.meta.subarray(0, ny * 256));
      chunks.push({ blocks, meta, biome: c.biome });
      transfer.push(blocks.buffer, meta.buffer);      // handed over, not copied a second time
      tops.push(c.top);
    }
    // what the flowing water was, in the region's own coordinates (see the mesher)
    const prev = [];
    let ci = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++, ci++) {
      const c = this.chunks.get(this.key(cx + dx, cz + dz));
      if (!c.prev || !c.prev.size) continue;
      const ox = (dx + 1) * 16, oz = (dz + 1) * 16;
      for (const [i, [pb, pm]] of c.prev) {
        const y = i >> 8, z = (i >> 4) & 15, x = i & 15;
        if (y >= ny) continue;
        prev.push(y * 2304 + (oz + z) * 48 + ox + x, pb, pm);
      }
    }
    const own = this.chunks.get(k);
    if (own.prev) own.prev.clear();
    const v = (this.meshVersion.get(k) || 0) + 1;
    this.meshVersion.set(k, v);
    this.inFlight.add('m' + k);
    /* Your own edits to the worker kept for them, everything else to the least
       busy; but a small remesh next to you (the world changing by itself)
       goes to the edit worker too when it has nothing to do, so its code is
       always warm (cold, it took several times as long over your blocks). */
    // (a column meshed ahead, the title's world's, goes to the worker holding it, which answers at once)
    const o = this.preMeshAt && !urgent && !base ? this.preMeshAt.get(k) : undefined;
    if (o !== undefined) this.preMeshAt.delete(k);
    const i = o !== undefined && this.live[o] ? o : urgent || (base && !this.busy[this.editW]) ? this.editW : this.idlest();
    // the cells of this column whose moving part is drawn elsewhere (sim/lids.js), in the region's own numbering
    const moving = [];
    for (const key of this.moving) {
      const [x, y, z] = key.split(',').map(Number), lx = x - cx * CH, lz = z - cz * CH;
      if (lx >= 0 && lx < CH && lz >= 0 && lz < CH) moving.push(y * 2304 + (16 + lz) * 48 + 16 + lx);
    }
    this.job(i, 'm' + k + '#' + v, { type: 'mesh', cx, cz, chunks, tops, version: v, seed: this.seed, prev: new Int32Array(prev), fast: !!this.fastLeaves, noSky: this.noSky, urgent: !!urgent,
      blend: this.blend, flat: this.flatLight, moving,
      keep: this.near(cx, cz), base, rows: base ? rows : null }, transfer);
  }

  /* The edit worker meshes only when something changes next to you, so for
     your first blocks its code would still be cold (several times slower).
     Once the column you stand in has its kept mesh, it remakes a few rows of
     it a few times, for nothing but the practice. */
  warmEditWorker(cx, cz) {
    this.warmed = true;
    const kept = this.meshCache.get(this.key(cx, cz));
    let top = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = this.chunks.get(this.key(cx + dx, cz + dz)); if (!c) return; top = Math.max(top, c.top); }
    const ny = Math.min(H, top + 2);
    for (let n = 0; n < 4; n++) {
      const chunks = [], tops = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(this.key(cx + dx, cz + dz));
        chunks.push({ blocks: c.blocks.slice(0, ny * 256), meta: c.meta.slice(0, ny * 256), biome: c.biome });
        tops.push(c.top);
      }
      const y = Math.max(0, ny - 24 - n * 16);
      this.busy[this.editW]++;
      this.workers[this.editW].postMessage({ type: 'mesh', warm: true, cx, cz, chunks, tops, version: 0, seed: this.seed, prev: new Int32Array(0),
        fast: !!this.fastLeaves, noSky: this.noSky, keep: true, base: kept.mesh, rows: [y, y], blend: this.blend, flat: this.flatLight });
    }
  }

  /* ---- blocks ---- */
  /* The chunk a column is in. The last one asked for is remembered (almost
     every lookup is next to the one before), and forgotten whenever a chunk
     comes or goes, so no string key is built for it. */
  chunkAt(x, z) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    if (cx === this._cx && cz === this._cz && this._cg === this.cgen) return this._c;
    this._cx = cx; this._cz = cz; this._cg = this.cgen;
    return (this._c = this.chunkXZ(cx, cz));
  }
  get(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.blocks[idx(x - c.cx * CH, y, z - c.cz * CH)];
  }
  meta(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.meta[idx(x - c.cx * CH, y, z - c.cz * CH)];
  }
  loaded(x, z) { return !!this.chunkAt(x, z); }
  set(x, y, z, b, m, quiet) {
    if (y < 0 || y >= H) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const i = idx(x - c.cx * CH, y, z - c.cz * CH);
    if (c.blocks[i] === b && c.meta[i] === (m || 0)) return false;
    // a fluid change: keep what was here before, until the next mesh shows the new state
    if (FLUID[c.blocks[i]] || FLUID[b]) {
      c.prev = c.prev || new Map();
      if (!c.prev.has(i)) c.prev.set(i, [c.blocks[i], c.meta[i]]);
    }
    const was = c.blocks[i], wasM = c.meta[i];
    c.blocks[i] = b; c.meta[i] = m || 0;
    // (a count of the chunk's changes: what reads its blocks again only when they change, drops.js, can tell)
    c.ver = (c.ver | 0) + 1;
    if (b && y > c.top) c.top = y;
    const ck = this.key(c.cx, c.cz);
    let ed = this.edits.get(ck);
    if (!ed) this.edits.set(ck, ed = new Map());
    ed.set(i, b * 256 + (m || 0));
    if (this.save) this.save.dirty.add(ck);
    if (!quiet) this.touch(x, z, y);
    // everyone listening hears of every change: the simulation (sim/sim.js: block updates,
    // redstone, what grows) and the mobs (js/entities: falling sand and the like)
    if (this.onSet) this.onSet(x, y, z, was, wasM, b, m || 0);
    if (this.onSetE) this.onSetE(x, y, z, b);
    if (WORLD_FX.gone && was && was !== b) WORLD_FX.gone(this, x, y, z, was, b);
    return true;
  }
  // a block's moving part is drawn elsewhere from now on (on), or back in the block's own mesh (off)
  setMoving(x, y, z, on) {
    const k = x + ',' + y + ',' + z;
    if (on === this.moving.has(k)) return;
    if (on) this.moving.add(k); else this.moving.delete(k);
    this.touch(x, z, y);
  }
  // remesh the column a block is in, and any neighbour whose edge it sits on
  touch(x, z, y) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    const lx = x - cx * CH, lz = z - cz * CH;
    this.dirty = this.dirty || new Set();
    // your own edits (interact.js sets world.urgent while it works) go to the edit worker, with the rows they changed
    // (Chunk Builder: Threaded leaves them in turn; Fully Blocking makes anything next to you at once)
    const urgent = this.builder === 'threaded' ? false : this.urgent || (this.builder === 'full' && this.near(cx, cz));
    const D = urgent ? (this.urgentDirty || (this.urgentDirty = new Set())) : this.dirty;
    const lo = y === undefined ? 0 : y, hi = y === undefined ? H - 1 : y;
    const add = k => this.markRows(D, k, lo, hi);
    add(this.key(cx, cz));
    if (lx === 0) add(this.key(cx - 1, cz));
    if (lx === 15) add(this.key(cx + 1, cz));
    if (lz === 0) add(this.key(cx, cz - 1));
    if (lz === 15) add(this.key(cx, cz + 1));
  }
  // a column to mesh again (in the line D), with the rows changed, against the newest mesh sent (see rowLog)
  markRows(D, k, lo, hi) {
    D.add(k);
    const v = this.meshVersion.get(k) || 0;
    let log = this.rowLog.get(k);
    if (!log) this.rowLog.set(k, log = []);
    const e = log.length ? log[log.length - 1] : null;
    if (e && e[0] === v) { if (lo < e[1]) e[1] = lo; if (hi > e[2]) e[2] = hi; }
    else log.push([v, lo, hi]);
  }
  /* A torch near a chunk's edge lights the chunk beside it too, and that one
     was drawn with the light as it was (it was meshed again only when a block
     on the edge itself changed): a sharp dark line along the border, or a glow
     left behind when the torch was taken away. So when a column's new mesh has
     different light in a cell along its edge, the column on that side (and
     the one across a corner, whose corner faces take light from it) is made
     again, in turn, over the rows that changed. Its new light is looked at the
     same way, so a change goes on as far as it reaches and no further; the
     column that set it off is not made again for its own change (lightCause). */
  lightEdges(cx, cz, ol, oh, nl, nh) {
    const top = Math.max(oh || 0, nh), air = this.noSky ? 0 : 0xf0;
    let mask = 0, lo = H, hi = -1;
    for (let y = 0; y < top; y++) {
      const o = y < oh ? y << 8 : -1, n = y < nh ? y << 8 : -1;
      let row = 0;
      for (let t = 0; t < 16; t++) {
        // west (x 0), east (x 15), north (z 0), south (z 15); a corner cell also the chunk across that corner
        const w = t << 4, e = w | 15, nn = t, so = 240 | t;
        if ((o < 0 ? air : ol[o + w]) !== (n < 0 ? air : nl[n + w])) row |= 1 | (t === 0 ? 16 : t === 15 ? 64 : 0);
        if ((o < 0 ? air : ol[o + e]) !== (n < 0 ? air : nl[n + e])) row |= 2 | (t === 0 ? 32 : t === 15 ? 128 : 0);
        if ((o < 0 ? air : ol[o + nn]) !== (n < 0 ? air : nl[n + nn])) row |= 4;
        if ((o < 0 ? air : ol[o + so]) !== (n < 0 ? air : nl[n + so])) row |= 8;
      }
      if (row) { mask |= row; if (y < lo) lo = y; hi = y; }
    }
    if (!mask) return;
    const k = this.key(cx, cz), cause = this.lightCause && this.lightCause.get(k);
    if (cause) this.lightCause.delete(k);
    const D = this.dirty || (this.dirty = new Set()), C = this.lightCause || (this.lightCause = new Map());
    for (let b = 0; b < 8; b++) {
      if (!(mask & (1 << b))) continue;
      const dx = EDGE_DX[b], dz = EDGE_DZ[b], nk = this.key(cx + dx, cz + dz), c = this.chunks.get(nk);
      if (!c || !c.meshed || nk === cause) continue;
      C.set(nk, k);
      this.markRows(D, nk, Math.max(0, lo - 1), Math.min(H - 1, hi + 1));
    }
  }
  // your own edits go out the moment they are made (interact.js), not at the next frame
  flushUrgent() {
    if (!this.urgentDirty || !this.urgentDirty.size) return;
    for (const k of this.urgentDirty) {
      const [x, z] = k.split(',').map(Number);
      // whatever else changed in the column since its kept mesh goes in the same remesh (rowLog)
      if (this.dirty) this.dirty.delete(k);
      if (this.chunks.has(k)) this.sendMeshSoon(x, z, true, true);
    }
    this.urgentDirty.clear();
  }
  flush() {
    this.flushUrgent();
    if (!this.dirty || !this.dirty.size) return;
    for (const k of this.dirty) {
      const [x, z] = k.split(',').map(Number);
      // a remesh while one is still out: the newer wins (see meshVersion)
      if (this.chunks.has(k)) this.sendMeshSoon(x, z, false, true);
    }
    this.dirty.clear();
  }
  sendMeshSoon(cx, cz, urgent, edit) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) return;
    this.inFlight.delete('m' + this.key(cx, cz));
    this.sendMesh(cx, cz, urgent, edit);
  }
  /* The meshes made again with new Video Settings (See-Through Leaves, Smooth
     Lighting, Biome Blend): every column already made goes back in the line,
     nearest first, the old mesh staying on screen until its new one is in. */
  setMeshing(o) {
    let changed = false;
    if (o.fastLeaves !== undefined && !!o.fastLeaves !== this.fastLeaves) { this.fastLeaves = !!o.fastLeaves; changed = true; }
    if (o.blend !== undefined && o.blend !== this.blend) { this.blend = o.blend; changed = true; }
    if (o.flatLight !== undefined && !!o.flatLight !== this.flatLight) { this.flatLight = !!o.flatLight; changed = true; }
    if (!changed) return false;
    this.meshCache.clear();
    for (const c of this.chunks.values()) if (c.meshed) this.queueMesh(c.cx, c.cz);
    return true;
  }
  biomeAt(x, z) {
    const c = this.chunkAt(x, z);
    return c ? c.biome[((z - c.cz * CH) << 4) | (x - c.cx * CH)] : 0;
  }
  solidAt(x, y, z) { const b = this.get(x, y, z); return b && BLOCKS[b].solid; }
  // take on a saved world's changes while its chunks are already loaded (the title screen's world, reused)
  adoptEdits(edits, save) {
    this.edits = edits; this.save = save;
    // the title's world played: it no longer waits for practice
    this.yields = false;
    for (const [k, ed] of edits) {
      const c = this.chunks.get(k);
      if (!c) continue;
      for (const [cell, v] of ed) { c.blocks[cell] = v >> 8; c.meta[cell] = v & 255; if (v >> 8 && (cell >> 8) > c.top) c.top = cell >> 8; }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.queueMesh(c.cx + dx, c.cz + dz);
    }
  }
  // stop the workers and let everything go (leaving a world)
  destroy() {
    // the workers go back to the pool for the next world, let go of everything this one made
    for (const w of this.workers) { w.onmessage = e => keepAhead(e.data, null); w.postMessage({ type: 'idle' }); POOL.push(w); }
    this.workers = []; this.busy = [];
    this.protos = new Map(); this.writesOf = new Map(); this.stageIn.clear(); this.lookingUp.clear(); this.missing.clear();
    this.chunks.clear(); this.byNum.clear(); this.cgen = (this.cgen || 0) + 1; this.meshQueue.clear(); this.inFlight.clear();
    this.meshCache.clear();
    this.genList = [];
    this.pool = { b: [], m: [] };
    this.dead = true;
  }
}
