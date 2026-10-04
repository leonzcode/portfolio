/* ---------------------------------------------------------------------------
   Leoncraft 2 - keeping each world's entities between visits.

   One record per world in its own IndexedDB database (the block changes in
   save.js are a separate store and stay as they are): the mobs, boats and
   arrows that were loaded, those kept from chunks that had unloaded, and
   which chunks have had their animals. Fails quietly, like save.js.
--------------------------------------------------------------------------- */
const DB = 'leoncraft2_entities', STORE = 'worlds';
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
export const EntityStore = {
  async load(id) {
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
    const db = await open();
    if (!db) return;
    return new Promise(res => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(JSON.stringify(data), id);
        tx.oncomplete = () => res(); tx.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  async remove(id) {
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
