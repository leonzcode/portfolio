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
    try { this.db = await open(); } catch (e) { this.db = null; }
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
  // forget a whole world
  static async remove(worldId) {
    let db;
    try { db = await open(); } catch (e) { return; }
    const prefix = worldId + ':';
    await new Promise(res => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, prefix + '￿'));
        tx.oncomplete = () => res(); tx.onerror = () => res();
      } catch (e) { res(); }
    });
    try { localStorage.removeItem('lc2_world_' + worldId); } catch (e) {}
  }
  // the small record: where you are, the time, the inventory
  readState() { try { return JSON.parse(localStorage.getItem('lc2_world_' + this.id) || 'null'); } catch (e) { return null; } }
  writeState(s) { try { localStorage.setItem('lc2_world_' + this.id, JSON.stringify(s)); } catch (e) {} }
}
