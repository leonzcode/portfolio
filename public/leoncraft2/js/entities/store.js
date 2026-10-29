/* ---------------------------------------------------------------------------
   Leoncraft 2 - keeping each world's entities between visits.

   One record per world in its own IndexedDB database (the block changes in
   save.js are a separate store and stay as they are): the mobs, boats and
   arrows that were loaded, those kept from chunks that had unloaded, and
   which chunks have had their animals. Fails quietly, like save.js.
--------------------------------------------------------------------------- */
import { mainDb } from '../save.js?v=117';
/* (since v115 they are written with the world's own data, in save.js's store under '#ents:<id>', in the same
   transaction as the inventory and the chests (Save.commit); this database is only read for a world saved before) */
const DB = 'leoncraft2_entities', STORE = 'worlds', MAIN = 'chunks';
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(() => null);
  return dbp;
}
function mainGet(db, key) {
  return new Promise(res => {
    try {
      const q = db.transaction(MAIN, 'readonly').objectStore(MAIN).get(key);
      q.onsuccess = () => { try { res(q.result ? JSON.parse(q.result) : null); } catch (e) { res(null); } };
      q.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
export const EntityStore = {
  async load(id) {
    const m = await mainDb();
    if (m) { const v = await mainGet(m, '#ents:' + id); if (v) return v; }
    const db = await open();
    if (!db) return null;
    return new Promise(res => {
      try {
        const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        q.onsuccess = () => { try { res(q.result ? JSON.parse(q.result) : null); } catch (e) { res(null); } };
        q.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async save(id, data) {
    const db = await mainDb();
    if (!db) return;
    return new Promise(res => {
      try {
        const tx = db.transaction(MAIN, 'readwrite');
        tx.objectStore(MAIN).put(JSON.stringify(data), '#ents:' + id);
        tx.oncomplete = () => res(); tx.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  async remove(id) {
    const m = await mainDb();
    if (m) await new Promise(res => { try { const tx = m.transaction(MAIN, 'readwrite'); tx.objectStore(MAIN).delete('#ents:' + id); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch (e) { res(); } });
    const db = await open();
    if (!db) return;
    return new Promise(res => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => res(); tx.onerror = () => res();
      } catch (e) { res(); }
    });
  },
};
