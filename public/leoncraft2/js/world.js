/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world on the main thread.

   Holds every loaded chunk (blocks, fluid levels, biomes), hands generation
   and meshing to a pool of workers nearest-first, meshes a column only once
   all eight around it exist (so its edges are right), drops chunks that fall
   out of range, and takes edits: a changed block remeshes its column, and
   the neighbouring one too when it sits on an edge.
--------------------------------------------------------------------------- */
import { CH, H, idx } from './world-const.js?v=19';
import { BLOCKS, FLUID } from './blocks.js?v=19';

/* ---- the workers, kept for the whole visit ----
   A new worker is slow for its first seconds: its code is fetched, compiled
   and only made fast as it runs. So the same workers serve every world (the
   title screen's, each one played, each dimension), each World telling them
   its seed with an init, and they are started the moment the page opens
   (startWorkers), so their code loads while the textures do. */
const GEN_N = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
const POOL = [];
function newWorker() {
  const w = new Worker(new URL('./worker.js?v=19', import.meta.url), { type: 'module' });
  w.onerror = e => console.error('worker', e.message || e);
  return w;
}
let started = 0;
export function startWorkers() { while (started < GEN_N + 1) { POOL.push(newWorker()); started++; } }
/* What the workers made ahead in the menus (practise) for the world most
   likely to be opened next: its terrain and features round where the player
   will stand, taken by that World when it is made. */
let ahead = null;
/* Chunks are kept between visits (chunkcache.js) under the code's version
   stamp and the size of the block table: a new version never reads what an
   older one made. Tidied once a visit. */
const CACHE = 'c' + (new URL(import.meta.url).searchParams.get('v') || '0') + '.' + BLOCKS.length;
let swept = false;
let worlds = 0;                    // each World's number, on everything read back for it (see lookup)
const numKey = (cx, cz) => cx * 4194304 + cz;       // a chunk as one number (|cz| < 2 million)
/* Practice in the menus: every worker that has nothing to do makes the
   generator of the world likely to be opened next (spec: seed, generator,
   dim, manifest, colours, at: { x, z }) and the terrain and features round
   where the player will stand, so its code is compiled and fast, and that
   much of the world is already made, before Singleplayer is ever pressed. */
export function practise(spec, world) {
  const name = spec.dim + '|' + spec.generator + '|' + spec.seed;
  // nothing to do when it is already made, or is the very world behind the title (it is kept for you)
  if ((ahead && ahead.name === name) || (world && !world.dead && world.dim + '|' + world.generator + '|' + world.seed === name)) return;
  ahead = { name, protos: new Map(), writes: new Map(), drills: new Map() };
  const cx = Math.floor(spec.at.x / CH), cz = Math.floor(spec.at.z / CH);
  // the workers of the world on screen (the title's), between its own jobs, or else those waiting in the pool
  const ws = world && !world.dead ? world.workers.slice(0, world.genN) : POOL.slice(0, GEN_N);
  // each worker a different chunk's features (the one you stand in first) and the nine terrains it needs,
  // three at a time: the next part goes only when the last is back (keepAhead), and stops once a world is opened
  const centres = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const base = { type: 'practice', seed: spec.seed, generator: spec.generator, dim: spec.dim, manifest: spec.manifest, colours: spec.colours };
  ws.forEach((w, i) => {
    const [ox, oz] = centres[i % centres.length], x = cx + ox, z = cz + oz, terrain = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) terrain.push([x + dx, z + dz]);
    const parts = [terrain.slice(0, 3), terrain.slice(3, 6), terrain.slice(6), []].map((t, n) => Object.assign({}, base, { terrain: t, decorate: n === 2 ? [x, z] : null, mesh: n === 3 ? [x, z] : null }));
    if (!world || world.dead) w.onmessage = e => keepAhead(e.data, w);
    ahead.drills.set(w, parts);
    w.postMessage(parts.shift());
  });
}
// what practice made, kept for its world; and that worker's next part of it
function keepAhead(m, w) {
  if (m.type !== 'practised' || !ahead || ahead.name !== m.name) return;
  for (const t of m.out) {
    if (t[0] === 't') ahead.protos.set(numKey(t[1], t[2]), { cx: t[1], cz: t[2], blocks: t[3], meta: t[4], grid: t[5] });
    else ahead.writes.set(numKey(t[1], t[2]), { cx: t[1], cz: t[2], w: t[3] });
  }
  const parts = w && ahead.drills.get(w);
  if (parts && parts.length) w.postMessage(parts.shift());
}

export class World {
  constructor(opts) {
    this.seed = opts.seed;
    this.generator = opts.generator || 'classic';    // 'vanilla' (Minecraft's own worlds) or 'classic' (the first generator)
    this.dim = opts.dim || 'overworld';        // js/dims.js: which generator the workers run
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
    const name = this.dim + '|' + this.generator + '|' + this.seed;
    // where this world's chunks are kept (opts.cache false: never)
    this.cacheKey = opts.cache === false ? null : CACHE + '|' + name;
    this.tag = ++worlds;
    this.lookingUp = new Set();       // "cx,cz" being read back from the kept chunks
    this.missing = new Map();         // "cx,cz" -> [cx, cz]: not kept, to be made
    if (ahead && ahead.name === name) { this.protos = ahead.protos; this.writesOf = ahead.writes; }
    ahead = null;
    startWorkers();
    this.ready = Promise.all(Array.from({ length: n + 1 }, (_, i) => new Promise(res => {
      const w = POOL.shift() || newWorker();
      this.live.push(false);
      w.onmessage = e => this.onMessage(i, e.data, res);
      w.postMessage({ type: 'init', seed: this.seed, generator: this.generator, dim: this.dim, manifest: opts.manifest, colours: opts.colours, cache: this.cacheKey, tag: this.tag });
      // once a visit, the edit worker tidies the kept chunks (old versions out)
      if (i === n && !swept) { swept = true; w.postMessage({ type: 'sweep', prefix: CACHE + '|', limit: 40000 }); }
      this.workers.push(w);
      this.busy.push(0);
    })));
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
    // practice finishing for this very world (it was opened while the workers were still at it)
    if (m.type === 'practised') { if (m.name === this.dim + '|' + this.generator + '|' + this.seed) this.takePractice(m.out); else keepAhead(m, this.dead ? null : this.workers[i]); return; }
    // anything else from before the init (a job of the world this worker served last) is not ours
    if (!this.live[i]) {
      if (m.type === 'ready') { this.live[i] = true; if (i < this.genN && m.staged) { this.staged = true; this.features = !!m.features; } initRes(); }
      return;
    }
    /* Chunks are read back from the kept ones in the background, so a worker
       can still be sending those of the world it served before: not ours. */
    if ((m.cached || m.type === 'looked') && m.tag !== this.tag) return;
    if (!m.cached) this.busy[i]--;
    if (m.back) this.giveBack(m.back);
    this.sched = true;                 // a worker is free: see what is next (schedule)
    if (m.type === 'terrain' || m.type === 'decorate') { this.onStage(m); return; }
    if (m.type === 'looked') {
      for (const [x, z] of m.missing) { const k = this.key(x, z); this.lookingUp.delete(k); this.missing.set(k, [x, z]); }
      return;
    }
    if (m.type === 'gen') {
      const k = this.key(m.cx, m.cz);
      this.inFlight.delete('g' + k);
      this.lookingUp.delete(k);
      if (!m.cached) this.missing.delete(k);
      if (!this.wanted(m.cx, m.cz)) return;
      const c = { cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, biome: m.biome, top: m.top, meshed: false, structs: m.structs || null };
      // put back whatever was changed here before
      const ed = this.edits.get(k);
      if (ed) for (const [cell, v] of ed) { c.blocks[cell] = v >> 8; c.meta[cell] = v & 255; if (v >> 8 && (cell >> 8) > c.top) c.top = cell >> 8; }
      this.chunks.set(k, c); this.byNum.set(((m.cx & 0x7fff) << 15) | (m.cz & 0x7fff), c); this.cgen = (this.cgen || 0) + 1;
      this.stats.gen++;
      // this chunk, and every neighbour it completes, can now be meshed
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.queueMesh(m.cx + dx, m.cz + dz);
      return;
    }
    if (m.type === 'mesh') {
      const k = this.key(m.cx, m.cz);
      this.inFlight.delete('m' + k);
      const c = this.chunks.get(k);
      if (!c) return;
      /* Any mesh newer than the one on screen is shown. (Waiting for the very
         last one sent made a block you broke wait behind the slower remeshes
         that terrain still loading round it keeps asking for.) */
      const shown = this.shownVersion || (this.shownVersion = new Map());
      if (m.version <= (shown.get(k) || 0)) return;
      shown.set(k, m.version);
      c.meshed = true;
      if (m.mesh.light) { c.light = m.mesh.light; c.lightH = m.mesh.lightH; }    // for mobs (js/entities)
      this.stats.mesh++;
      this.onMesh(m.cx, m.cz, m.mesh, m.urgent);
      // the columns round you keep their mesh (with the region's light), so an edit there remakes only its sections
      if (m.mesh.region && this.near(m.cx, m.cz)) this.meshCache.set(k, { version: m.version, mesh: m.mesh });
      else this.meshCache.delete(k);
      // what this mesh already has needs no remembering
      const log = this.rowLog.get(k);
      if (log) { let j = 0; for (const e of log) if (e[0] >= m.version) log[j++] = e; log.length = j; if (!j) this.rowLog.delete(k); }
      if (!this.warmed && m.cx === this.pcx && m.cz === this.pcz && this.meshCache.has(k)) this.warmEditWorker(m.cx, m.cz);
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
  /* The least busy worker. The one kept for your edits joins in while
     nothing can be edited (allHands: a loading screen, the title's world). */
  idlest() { const n = this.genN + (this.allHands ? 1 : 0); let b = 0; for (let i = 1; i < n; i++) if (this.busy[i] < this.busy[b]) b = i; return b; }

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
    const moved = pcx !== this.pcx || pcz !== this.pcz;
    this.pcx = pcx; this.pcz = pcz;
    const R = this.renderDist + 1;
    if (moved) {
      // forget what is too far, and line up what is missing, nearest first
      for (const [k, c] of this.chunks) if (!this.wanted(c.cx, c.cz)) { this.chunks.delete(k); this.byNum.delete(((c.cx & 0x7fff) << 15) | (c.cz & 0x7fff)); this.meshCache.delete(k); this.rowLog.delete(k); this.cgen = (this.cgen || 0) + 1; this.onDrop(c.cx, c.cz); }
      this.genList = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
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
    const cap = this.workers.length * 2;
    // meshes first (they are what you see), nearest first; a few a frame, so packing them never stalls one
    let sends = 0;
    if (this.meshQueue.size) {
      const list = [...this.meshQueue].map(k => { const [x, z] = k.split(',').map(Number); return [(x - pcx) ** 2 + (z - pcz) ** 2, x, z, k]; })
        .sort((a, b) => a[0] - b[0]);
      for (const [d, x, z, k] of list) {
        if (this.inFlightCount() >= cap || sends >= 2) break;
        if (this.inFlight.has('m' + k)) continue;
        sends++;
        if (d > this.renderDist * this.renderDist) { this.meshQueue.delete(k); continue; }
        this.meshQueue.delete(k);
        // a neighbour gone since it was queued: it is queued again when that one is back
        if (!this.around(x, z)) continue;
        this.sendMesh(x, z);
      }
    }
    if (this.staged) {
      if (moved || this.sched) this.schedule(cap);
      // what is no longer needed goes when you cross into another chunk, and once all round you is made
      if (moved) this.prunedAll = false;
      if (moved || (!this.prunedAll && this.genList.length === 0 && !this.stageIn.size)) { this.prune(); this.prunedAll = this.genList.length === 0; }
      return;
    }
    const L = this.genList;
    if (!L || !L.length || this.inFlightCount() >= cap) return;
    let j = 0;
    for (let n = 0; n < L.length; n++) {
      const e = L[n], x = e[1], z = e[2], k = this.key(x, z);
      if (this.chunks.has(k) || this.inFlight.has('g' + k)) continue;
      // still being read back from the kept chunks, or no worker free: later
      if (this.lookingUp.has(k) || this.inFlightCount() >= cap) { L[j++] = e; continue; }
      this.inFlight.add('g' + k);
      const i = this.idlest(); this.busy[i]++;
      this.workers[i].postMessage({ type: 'gen', cx: x, cz: z });
    }
    L.length = j;
  }
  /* The chunks newly wanted, asked of the kept ones first (one read for
     all of them, by whichever worker is free); what is not kept is made. */
  lookup() {
    for (const [k, [x, z]] of this.missing) if (!this.wanted(x, z)) this.missing.delete(k);
    if (!this.cacheKey) return;
    const list = [];
    for (const e of this.genList) {
      const k = this.key(e[1], e[2]);
      if (this.chunks.has(k) || this.missing.has(k) || this.lookingUp.has(k) || this.inFlight.has('g' + k)) continue;
      this.lookingUp.add(k); list.push([e[1], e[2]]);
    }
    if (!list.length) return;
    // a whole area (a world opening) is shared by every worker, nearest ones first in each; a few by the least busy
    const n = list.length > 16 ? this.genN : 1, parts = Array.from({ length: n }, () => []);
    list.forEach((e, j) => parts[j % n].push(e));
    for (const part of parts) { const i = this.idlest(); this.busy[i]++; this.workers[i].postMessage({ type: 'lookup', list: part }); }
    this.lookedAt = performance.now();
  }
  /* A read that never comes back (storage stuck or gone) must not hold the
     world up: after a few seconds whatever is still being read is made. */
  lookupStuck() {
    if (!this.lookingUp.size || performance.now() - this.lookedAt < 4000) return;
    console.warn('kept chunks not read back in time; making', this.lookingUp.size);
    for (const k of this.lookingUp) this.missing.set(k, k.split(',').map(Number));
    this.lookingUp.clear();
    this.sched = true;
  }
  inFlightCount() { return this.inFlight.size + this.stageIn.size; }

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
    const i = this.idlest(); this.busy[i]++;
    this.workers[i].postMessage({ type: 'terrain', cx: x, cz: z });
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
    this.stageIn.add(f * 4 + 2);
    const i = this.idlest(); this.busy[i]++;
    this.workers[i].postMessage({ type: 'decorate', cx: x, cz: z, protos }, transfer);
  }
  sendGen(x, z) {
    const k = this.key(x, z);
    const proto = this.protoCopy(this.protos.get(numKey(x, z)));
    const writes = [];
    if (this.features) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) writes.push([x + dx, z + dz, this.writesOf.get(numKey(x + dx, z + dz)).w]);
    this.inFlight.add('g' + k);
    const i = this.idlest(); this.busy[i]++;
    this.workers[i].postMessage({ type: 'gen', cx: x, cz: z, proto, writes }, [proto.blocks.buffer, proto.meta.buffer]);
  }
  onStage(m) {
    const f = numKey(m.cx, m.cz), dx = m.cx - this.pcx, dz = m.cz - this.pcz, R = this.renderDist + 4;
    this.stageIn.delete(f * 4 + (m.type === 'terrain' ? 1 : 2));
    if (dx * dx + dz * dz > R * R) return;          // you have gone on: not worth keeping
    if (m.type === 'terrain') this.protos.set(f, { cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, grid: m.grid });
    else this.writesOf.set(f, { cx: m.cx, cz: m.cz, w: m.writes });
  }
  takePractice(out) {
    for (const t of out) {
      if (t[0] === 't') this.protos.set(numKey(t[1], t[2]), { cx: t[1], cz: t[2], blocks: t[3], meta: t[4], grid: t[5] });
      else this.writesOf.set(numKey(t[1], t[2]), { cx: t[1], cz: t[2], w: t[3] });
    }
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
    const R = this.renderDist + 4, made = (x, z) => this.chunks.has(this.key(x, z));
    const far = p => (p.cx - this.pcx) ** 2 + (p.cz - this.pcz) ** 2 > R * R;
    for (const [f, p] of this.protos) {
      let all = true;
      for (let dz = -2; dz <= 2 && all; dz++) for (let dx = -2; dx <= 2; dx++) if (!made(p.cx + dx, p.cz + dz)) { all = false; break; }
      if (all || far(p)) this.protos.delete(f);
    }
    for (const [f, p] of this.writesOf) {
      let all = true;
      for (let dz = -1; dz <= 1 && all; dz++) for (let dx = -1; dx <= 1; dx++) if (!made(p.cx + dx, p.cz + dz)) { all = false; break; }
      if (all || far(p)) this.writesOf.delete(f);
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
    const i = urgent || (base && !this.busy[this.editW]) ? this.editW : this.idlest(); this.busy[i]++;
    this.workers[i].postMessage({ type: 'mesh', cx, cz, chunks, tops, version: v, seed: this.seed, prev: new Int32Array(prev), fast: !!this.fastLeaves, noSky: this.noSky, urgent: !!urgent,
      blend: this.blend, flat: this.flatLight,
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
    return true;
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
    const add = k => {
      D.add(k);
      // the rows changed, against the newest mesh sent (see rowLog)
      const v = this.meshVersion.get(k) || 0;
      let log = this.rowLog.get(k);
      if (!log) this.rowLog.set(k, log = []);
      const e = log.length ? log[log.length - 1] : null;
      if (e && e[0] === v) { if (lo < e[1]) e[1] = lo; if (hi > e[2]) e[2] = hi; }
      else log.push([v, lo, hi]);
    };
    add(this.key(cx, cz));
    if (lx === 0) add(this.key(cx - 1, cz));
    if (lx === 15) add(this.key(cx + 1, cz));
    if (lz === 0) add(this.key(cx, cz - 1));
    if (lz === 15) add(this.key(cx, cz + 1));
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
