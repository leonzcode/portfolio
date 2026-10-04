/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world on the main thread.

   Holds every loaded chunk (blocks, fluid levels, biomes), hands generation
   and meshing to a pool of workers nearest-first, meshes a column only once
   all eight around it exist (so its edges are right), drops chunks that fall
   out of range, and takes edits: a changed block remeshes its column, and
   the neighbouring one too when it sits on an edge.
--------------------------------------------------------------------------- */
import { CH, H, idx } from './world-const.js?v=9';
import { BLOCKS, FLUID } from './blocks.js?v=9';

export class World {
  constructor(opts) {
    this.seed = opts.seed;
    this.generator = opts.generator || 'classic';    // 'vanilla' (Minecraft's own worlds) or 'classic' (the first generator)
    this.renderDist = opts.renderDist;
    this.chunks = new Map();          // "cx,cz" -> chunk
    this.onMesh = opts.onMesh;
    this.fastLeaves = !!opts.fastLeaves;
    this.onDrop = opts.onDrop;
    // what changed from the generated terrain, kept so a saved world comes back (see save.js)
    this.edits = opts.edits || new Map();       // "cx,cz" -> Map(cell index -> block * 256 + meta)
    this.save = opts.save || null;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    this.busy = [];
    this.nextId = 1;
    this.waiting = new Map();          // job id -> resolver
    this.ready = Promise.all(Array.from({ length: n }, (_, i) => new Promise(res => {
      const w = new Worker(new URL('./worker.js?v=9', import.meta.url), { type: 'module' });
      w.onmessage = e => this.onMessage(i, e.data, res);
      w.onerror = e => console.error('worker', e.message || e);
      w.postMessage({ type: 'init', seed: this.seed, generator: this.generator, manifest: opts.manifest, colours: opts.colours });
      this.workers.push(w);
      this.busy.push(0);
    })));
    this.genQueue = new Set();
    this.meshQueue = new Set();
    this.inFlight = new Set();
    this.meshVersion = new Map();
    this.stats = { gen: 0, mesh: 0 };
  }
  key(cx, cz) { return cx + ',' + cz; }

  onMessage(i, m, initRes) {
    if (m.type === 'ready') { initRes(); return; }
    this.busy[i]--;
    if (m.type === 'gen') {
      const k = this.key(m.cx, m.cz);
      this.inFlight.delete('g' + k);
      if (!this.wanted(m.cx, m.cz)) return;
      const c = { cx: m.cx, cz: m.cz, blocks: m.blocks, meta: m.meta, biome: m.biome, top: m.top, meshed: false };
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
      if ((this.meshVersion.get(k) || 0) !== m.version) return;     // something changed since: a newer one is coming
      c.meshed = true;
      if (m.mesh.light) { c.light = m.mesh.light; c.lightH = m.mesh.lightH; }    // for mobs (js/entities)
      this.stats.mesh++;
      this.onMesh(m.cx, m.cz, m.mesh);
      return;
    }
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
  idlest() { let b = 0; for (let i = 1; i < this.busy.length; i++) if (this.busy[i] < this.busy[b]) b = i; return b; }

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
      for (const [k, c] of this.chunks) if (!this.wanted(c.cx, c.cz)) { this.chunks.delete(k); this.cgen = (this.cgen || 0) + 1; this.onDrop(c.cx, c.cz); }
      this.genList = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const k = this.key(pcx + dx, pcz + dz);
        if (!this.chunks.has(k)) this.genList.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
      }
      this.genList.sort((a, b) => a[0] - b[0]);
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
  sendMesh(cx, cz) {
    const k = this.key(cx, cz);
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
    const i = this.idlest(); this.busy[i]++;
    this.workers[i].postMessage({ type: 'mesh', cx, cz, chunks, tops, version: v, seed: this.seed, prev: new Int32Array(prev), fast: !!this.fastLeaves }, transfer);
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
    c.blocks[i] = b; c.meta[i] = m || 0;
    if (b && y > c.top) c.top = y;
    const ck = this.key(c.cx, c.cz);
    let ed = this.edits.get(ck);
    if (!ed) this.edits.set(ck, ed = new Map());
    ed.set(i, b * 256 + (m || 0));
    if (this.save) this.save.dirty.add(ck);
    if (!quiet) this.touch(x, z);
    if (this.onSet) this.onSet(x, y, z, b);       // falling sand and the like (js/entities)
    return true;
  }
  // remesh the column a block is in, and any neighbour whose edge it sits on
  touch(x, z) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    const lx = x - cx * CH, lz = z - cz * CH;
    this.dirty = this.dirty || new Set();
    this.dirty.add(this.key(cx, cz));
    if (lx === 0) this.dirty.add(this.key(cx - 1, cz));
    if (lx === 15) this.dirty.add(this.key(cx + 1, cz));
    if (lz === 0) this.dirty.add(this.key(cx, cz - 1));
    if (lz === 15) this.dirty.add(this.key(cx, cz + 1));
  }
  flush() {
    if (!this.dirty || !this.dirty.size) return;
    for (const k of this.dirty) {
      const [x, z] = k.split(',').map(Number);
      // a remesh while one is still out: the newer wins (see meshVersion)
      for (let dz = -1, ok = true; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(x + dx, z + dz))) ok = false;
      if (this.chunks.has(k)) this.sendMeshSoon(x, z);
    }
    this.dirty.clear();
  }
  sendMeshSoon(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) return;
    this.inFlight.delete('m' + this.key(cx, cz));
    this.sendMesh(cx, cz);
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
    this.genList = [];
    this.dead = true;
  }
}
