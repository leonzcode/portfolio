/* ---------------------------------------------------------------------------
   Leoncraft 2 - chunks kept between visits (used by the workers).

   The game keeps the chunks it has made on disk, so a world opens from them
   rather than being made again. So does this: every chunk a worker makes is
   squeezed (deflate, about a tenth of its size) and put in IndexedDB as it
   came from the generator, before anything the player changed (save.js
   keeps that, and it is put back on top as ever). Opening a world, the title
   screen's world, coming back from the Nether: the chunks round you are read
   back in a few milliseconds instead of made again.

   Keyed by the code's version stamp, the block table and the world's
   generator, dimension and seed, so a new version of the game (or of a
   generator) never reads chunks an older one made. Everything here fails
   quietly: no IndexedDB, no compression streams, a full disk all just mean
   chunks are made as before.
--------------------------------------------------------------------------- */
const DB = 'leoncraft2-chunks', STORE = 'c';
let dbp = null;
const usable = typeof indexedDB !== 'undefined' && typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
function db() {
  if (!usable) return Promise.resolve(null);
  return dbp || (dbp = new Promise(res => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { res(null); return; }
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
    r.onblocked = () => res(null);
  }));
}
const squeeze = (buf, how) => new Response(new Blob([buf]).stream().pipeThrough(how)).arrayBuffer();

/* A generated chunk into the store: blocks, meta and biomes in one buffer
   (deflated), its top and its structures beside it. Copied at once (the
   chunk's own arrays are about to be handed to the main thread), squeezed
   and written after. */
export function keepChunk(world, cx, cz, c, structs) {
  if (!usable) return;
  const n = c.blocks.length, raw = new Uint8Array(n * 3 + c.biome.length);
  raw.set(new Uint8Array(c.blocks.buffer, c.blocks.byteOffset, n * 2), 0);
  raw.set(c.meta, n * 2);
  raw.set(c.biome, n * 3);
  write(world + '|' + cx + ',' + cz, raw, n, c.top, structs);
}
/* Written a batch at a time, a few times a second: a write holds the store,
   and a world opening reads from it, so fewer and bigger writes keep those
   reads from waiting behind a queue of small ones. */
let batch = [], flushing = null;
async function write(key, raw, n, top, structs) {
  try {
    const z = await squeeze(raw, new CompressionStream('deflate'));
    batch.push([key, { z, n, top, s: structs || null }]);
    if (!flushing) flushing = setTimeout(flush, 400);
  } catch (e) { /* not kept: made again next time */ }
}
async function flush() {
  const d = await db(), list = batch;
  batch = []; flushing = null;
  if (!d || !list.length) return;
  try {
    const st = d.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const [key, rec] of list) st.put(rec, key);
  } catch (e) { /* not kept: made again next time */ }
}
/* The chunks of a list that are kept, each handed to found(cx, cz, chunk,
   structs) as it is unsqueezed, the list's own order (nearest first) a few
   at a time; absent(list) is told the ones not kept as soon as the store has
   answered, before any is unsqueezed, so they can be made meanwhile.
   Resolves with any that were kept but could not be read. */
export function readChunks(world, list, found, absent) {
  return db().then(d => new Promise(done => {
    if (!d) { absent(list); done([]); return; }
    const missing = [], failed = [], queue = [];
    let left = list.length, running = 0, read = false;
    const finish = () => { if (read && !running && !queue.length) done(failed); };
    const next = () => {
      while (running < 4 && queue.length) {
        const [x, z, r] = queue.shift();
        running++;
        squeeze(r.z, new DecompressionStream('deflate')).then(buf => {
          try {
            const raw = new Uint8Array(buf), n = r.n;
            const blocks = new Uint16Array(n), meta = new Uint8Array(n);
            new Uint8Array(blocks.buffer).set(raw.subarray(0, n * 2));
            meta.set(raw.subarray(n * 2, n * 3));
            found(x, z, { blocks, meta, biome: raw.slice(n * 3), top: r.top }, r.s);
          } catch (e) { failed.push([x, z]); }
        }, () => failed.push([x, z])).then(() => { running--; next(); finish(); });
      }
    };
    const got = (x, z, r) => {
      if (read) return;              // (the store failed part way through: every one of them is made instead)
      if (r) { queue.push([x, z, r]); next(); } else missing.push([x, z]);
      if (--left === 0) { read = true; absent(missing); finish(); }
    };
    try {
      if (!left) { read = true; absent(missing); finish(); return; }
      const st = d.transaction(STORE, 'readonly').objectStore(STORE);
      for (const [x, z] of list) {
        const q = st.get(world + '|' + x + ',' + z);
        q.onsuccess = () => got(x, z, q.result || null);
        q.onerror = () => got(x, z, null);
      }
    } catch (e) { if (!read) { read = true; queue.length = 0; absent(list); } finish(); }
  }));
}
// how many chunks of a list are kept (practice in the menus asks, before making what would only be read back)
export async function keptCount(world, list) {
  const d = await db();
  if (!d) return 0;
  return new Promise(res => {
    try {
      const st = d.transaction(STORE, 'readonly').objectStore(STORE);
      let left = list.length, n = 0;
      if (!left) { res(0); return; }
      for (const [x, z] of list) {
        const r = st.count(world + '|' + x + ',' + z);
        r.onsuccess = () => { if (r.result) n++; if (--left === 0) res(n); };
        r.onerror = () => { if (--left === 0) res(n); };
      }
    } catch (e) { res(0); }
  });
}
/* Once a visit: chunks of other versions of the game go, and if the store
   has grown past a limit it starts again (about 25 KB a chunk). */
export async function sweepChunks(prefix, limit) {
  const d = await db();
  if (!d) return;
  try {
    const st = d.transaction(STORE, 'readwrite').objectStore(STORE);
    // every key not under this version's prefix sorts before it or after all of its keys: two ranges, gone in two requests
    st.delete(IDBKeyRange.upperBound(prefix, true));
    st.delete(IDBKeyRange.lowerBound(prefix + '￿'));
    const r = st.count();
    r.onsuccess = () => { if (r.result > limit) st.clear(); };
  } catch (e) { /* tidied another time */ }
}
