/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world on the main thread.

   Holds every loaded chunk (blocks, fluid levels, biomes), hands generation
   and meshing to a pool of workers nearest-first, meshes a column only once
   all eight around it exist (so its edges are right), drops chunks that fall
   out of range, and takes edits: a changed block remeshes its column, and
   the neighbouring one too when it sits on an edge.
--------------------------------------------------------------------------- */
import { CH, H, idx } from './world-const.js?v=14';
import { BLOCKS, FLUID } from './blocks.js?v=14';

export class World {
  constructor(opts) {
    this.seed = opts.seed;
    this.generator = opts.generator || 'classic';    // 'vanilla' (Minecraft's own worlds) or 'classic' (the first generator)
    this.dim = opts.dim || 'overworld';        // js/dims.js: which generator the workers run
    this.noSky = this.dim === 'the_nether';     // no sky light at all there
    this.renderDist = opts.renderDist;
    this.chunks = new Map();          // "cx,cz" -> chunk
    this.onMesh = opts.onMesh;
    this.fastLeaves = !!opts.fastLeaves;
    this.onDrop = opts.onDrop;
    // what changed from the generated terrain, kept so a saved world comes back (see save.js)
    this.edits = opts.edits || new Map();       // "cx,cz" -> Map(cell index -> block * 256 + meta)
    this.save = opts.save || null;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    /* One more worker than that, kept for what you change yourself: a block
       you break or place is meshed again at once, never behind terrain being
       made (the generator can take a good fraction of a second a chunk). */
    this.genN = n; this.editW = n;
    this.workers = [];
    this.busy = [];
    this.nextId = 1;
    this.waiting = new Map();          // job id -> resolver
    this.ready = Promise.all(Array.from({ length: n + 1 }, (_, i) => new Promise(res => {
      const w = new Worker(new URL('./worker.js?v=14', import.meta.url), { type: 'module' });
      w.onmessage = e => this.onMessage(i, e.data, res);
      w.onerror = e => console.error('worker', e.message || e);
      w.postMessage({ type: 'init', seed: this.seed, generator: this.generator, dim: this.dim, manifest: opts.manifest, colours: opts.colours });
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
  }
  key(cx, cz) { return cx + ',' + cz; }
  // the column you are in and the eight round it: the ones you can reach to build in
  near(cx, cz) { return Math.abs(cx - this.pcx) <= 1 && Math.abs(cz - this.pcz) <= 1; }

  onMessage(i, m, initRes) {
    if (m.type === 'ready') { initRes(); return; }
    this.busy[i]--;
    if (m.type === 'gen') {
      const k = this.key(m.cx, m.cz);
      this.inFlight.delete('g' + k);
      if (!this.wanted(m.cx, m.cz)) return;
      const c = { cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, biome: m.biome, top: m.top, meshed: false, structs: m.structs || null };
      // put back whatever was changed here before
      const ed = this.edits.get(k);
      if (ed) for (const [cell, v] of ed) { c.blocks[cell] = v >> 8; c.meta[cell] = v & 255; if (v >> 8 && (cell >> 8) > c.top) c.top = cell >> 8; }
      this.chunks.set(k, c); this.cgen = (this.cgen || 0) + 1;
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
  idlest() { let b = 0; for (let i = 1; i < this.genN; i++) if (this.busy[i] < this.busy[b]) b = i; return b; }

  wanted(cx, cz) {
    const dx = cx - this.pcx, dz = cz - this.pcz;
    return dx * dx + dz * dz <= (this.renderDist + 2) * (this.renderDist + 2);
  }
  queueMesh(cx, cz) {
    const k = this.key(cx, cz);
    if (!this.chunks.has(k)) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) return;
    this.meshQueue.add(k);
  }

  /* ---- each frame: what to make next ---- */
  update(px, pz) {
    const pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH);
    const moved = pcx !== this.pcx || pcz !== this.pcz;
    this.pcx = pcx; this.pcz = pcz;
    const R = this.renderDist + 1;
    if (moved) {
      // forget what is too far, and line up what is missing, nearest first
      for (const [k, c] of this.chunks) if (!this.wanted(c.cx, c.cz)) { this.chunks.delete(k); this.meshCache.delete(k); this.rowLog.delete(k); this.cgen = (this.cgen || 0) + 1; this.onDrop(c.cx, c.cz); }
      this.genList = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const k = this.key(pcx + dx, pcz + dz);
        if (!this.chunks.has(k)) this.genList.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
      }
      this.genList.sort((a, b) => a[0] - b[0]);
      // the columns now next to you get their mesh made again to keep (meshCache); the rest let theirs go
      for (const k of this.meshCache.keys()) { const [x, z] = k.split(',').map(Number); if (!this.near(x, z)) this.meshCache.delete(k); }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const k = this.key(pcx + dx, pcz + dz), c = this.chunks.get(k);
        if (c && c.meshed && !this.meshCache.has(k) && !this.inFlight.has('m' + k)) this.queueMesh(pcx + dx, pcz + dz);
      }
    }
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
        this.sendMesh(x, z);
      }
    }
    while (this.genList && this.genList.length && this.inFlightCount() < cap) {
      const [, x, z] = this.genList.shift();
      const k = this.key(x, z);
      if (this.chunks.has(k) || this.inFlight.has('g' + k)) continue;
      this.inFlight.add('g' + k);
      const i = this.idlest(); this.busy[i]++;
      this.workers[i].postMessage({ type: 'gen', cx: x, cz: z });
    }
  }
  inFlightCount() { return this.inFlight.size; }
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
      // only the part with anything in it, copied
      const blocks = c.blocks.slice(0, ny * 256), meta = c.meta.slice(0, ny * 256);
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
        fast: !!this.fastLeaves, noSky: this.noSky, keep: true, base: kept.mesh, rows: [y, y] });
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
    return (this._c = this.chunks.get(cx + ',' + cz));
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
    const urgent = this.urgent;
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
    for (const w of this.workers) w.terminate();
    this.workers = []; this.busy = [];
    this.chunks.clear(); this.cgen = (this.cgen || 0) + 1; this.meshQueue.clear(); this.inFlight.clear();
    this.meshCache.clear();
    this.genList = [];
    this.dead = true;
  }
}
