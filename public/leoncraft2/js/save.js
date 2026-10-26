/* ---------------------------------------------------------------------------
   Leoncraft 2 - keeping a world between visits.

   The terrain itself is never stored: the seed makes it again. What is kept
   is what changed: every block the player (or flowing water) set, per chunk,
   in IndexedDB, plus a small record per world in localStorage (where you
   stand, the time of day, the inventory, health). A chunk's changes are put
   back the moment it is generated, before it is ever drawn.

   Everything here fails quietly: a private window or blocked storage just
   means nothing is remembered.
--------------------------------------------------------------------------- */
const DB = 'leoncraft2', STORE = 'chunks';

// one connection for the visit, shared with entities/store.js (whose records now live here too: commit())
let shared = null;
export function mainDb() {
  if (!shared) shared = open().catch(() => null);
  return shared;
}
function open() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export class Save {
  constructor(worldId) {
    this.id = worldId;
    this.db = null;
    this.dirty = new Set();
  }
  async init() {
    try { this.db = await mainDb(); } catch (e) { this.db = null; }
  }
  // every changed chunk of this world: "cx,cz" -> Map(cell index -> block * 256 + meta)
  async loadEdits() {
    const out = new Map();
    if (!this.db) return out;
    const prefix = this.id + ':';
    await new Promise(res => {
      try {
        const tx = this.db.transaction(STORE, 'readonly');
        const range = IDBKeyRange.bound(prefix, prefix + '￿');
        const req = tx.objectStore(STORE).openCursor(range);
        req.onsuccess = () => {
          const c = req.result;
          if (!c) { res(); return; }
          const a = c.value, m = new Map();
          for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]);
          out.set(String(c.key).slice(prefix.length), m);
          c.continue();
        };
        req.onerror = () => res();
      } catch (e) { res(); }
    });
    return out;
  }
  // write the chunks that changed since the last save
  async flush(edits) {
    if (!this.db || !this.dirty.size) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    await new Promise(res => {
      try {
        const tx = this.db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        for (const k of keys) {
          const m = edits.get(k);
          if (!m || !m.size) { st.delete(this.id + ':' + k); continue; }
          const a = new Int32Array(m.size * 2);
          let i = 0;
          for (const [cell, v] of m) { a[i++] = cell; a[i++] = v; }
          st.put(a, this.id + ':' + k);
        }
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      } catch (e) { res(); }
    });
  }
  /* Everything one save writes, in one transaction: this dimension's block changes and records (chests, signs...),
     your own record (where you are, the inventory, health: the state) and the mobs, boats and carts, all kept or
     none. Written apart, a tab closed in the middle of a save kept the inventory but not the chest or the block
     its items came out of, or the other way round: the items twice. The state is put in localStorage only once
     this is done (main.js saveGame), and readKept prefers this copy. False when nothing could be written. */
  async commit({ edits, extras = [], state = null, stateId = this.id, ents = null }) {
    const db = this.db;
    if (!db) return false;
    const keys = [...this.dirty];
    this.dirty.clear();
    const back = () => { for (const k of keys) this.dirty.add(k); };
    return new Promise(res => {
      try {
        const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
        for (const k of keys) {
          const m = edits && edits.get(k);
          if (!m || !m.size) { st.delete(this.id + ':' + k); continue; }
          const a = new Int32Array(m.size * 2);
          let i = 0;
          for (const [cell, v] of m) { a[i++] = cell; a[i++] = v; }
          st.put(a, this.id + ':' + k);
        }
        for (const [name, v] of extras) st.put(JSON.stringify(v), '#' + name + ':' + this.id);
        if (state) st.put(JSON.stringify(state), '#state:' + stateId);
        if (ents) st.put(JSON.stringify(ents[1]), '#ents:' + ents[0]);
        tx.oncomplete = () => res(true);
        tx.onerror = tx.onabort = () => { back(); res(false); };
      } catch (e) { back(); res(false); }
    });
  }
  /* Your record as last saved: the copy kept with the world's own data (commit) unless the one in localStorage is
     newer (a save whose world part could not be written, or one made by a page from before commit, which writes
     no savedAt). */
  async readKept() {
    const ls = this.readState(), kept = this.db ? await this.readExtra('state') : null;
    if (!kept) return ls;
    if (!ls) return kept;
    if (ls.savedAt === undefined) return ls;
    return ls.savedAt > (kept.savedAt || 0) ? ls : kept;
  }
  // forget a whole world (and its Nether and End, kept as "<id>~the_nether" and "<id>~the_end")
  static async remove(worldId) {
    let db;
    try { db = await mainDb(); } catch (e) { return; }
    if (!db) return;
    for (const id of [worldId, worldId + '~the_nether', worldId + '~the_end']) {
      const prefix = id + ':';
      await new Promise(res => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, prefix + '￿'));
          for (const name of ['containers', 'details', 'state', 'ents', 'maps']) tx.objectStore(STORE).delete('#' + name + ':' + id);
          tx.oncomplete = () => res(); tx.onerror = () => res();
        } catch (e) { res(); }
      });
      try { localStorage.removeItem('lc2_world_' + id); } catch (e) {}
    }
  }
  /* A world's other records by name (the chests' and furnaces' contents),
     as JSON in the same store under '#name:world' (outside the chunk keys). */
  async readExtra(name) {
    if (!this.db) return null;
    return new Promise(res => {
      try {
        const req = this.db.transaction(STORE, 'readonly').objectStore(STORE).get('#' + name + ':' + this.id);
        req.onsuccess = () => { try { res(req.result ? JSON.parse(req.result) : null); } catch (e) { res(null); } };
        req.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async writeExtra(name, value) {
    if (!this.db) return;
    await new Promise(res => {
      try {
        const tx = this.db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(JSON.stringify(value), '#' + name + ':' + this.id);
        tx.oncomplete = () => res(); tx.onerror = () => res();
      } catch (e) { res(); }
    });
  }
  // the small record: where you are, the time, the inventory
  readState() { try { return JSON.parse(localStorage.getItem('lc2_world_' + this.id) || 'null'); } catch (e) { return null; } }
  writeState(s) { try { localStorage.setItem('lc2_world_' + this.id, JSON.stringify(s)); } catch (e) {} }
}
