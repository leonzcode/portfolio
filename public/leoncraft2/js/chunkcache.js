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
// the chunks of a list that are kept, each handed to found(cx, cz, chunk, structs) as it is read; resolves with the ones that are not
export async function readChunks(world, list, found) {
  const d = await db();
  if (!d) return list;
  const recs = await new Promise(res => {
    try {
      const st = d.transaction(STORE, 'readonly').objectStore(STORE), out = new Array(list.length);
      let left = list.length;
      if (!left) { res(out); return; }
      list.forEach(([x, z], i) => {
        const r = st.get(world + '|' + x + ',' + z);
        r.onsuccess = () => { out[i] = r.result || null; if (--left === 0) res(out); };
        r.onerror = () => { out[i] = null; if (--left === 0) res(out); };
      });
    } catch (e) { res(new Array(list.length).fill(null)); }
  });
  const missing = [];
  await Promise.all(list.map(async ([x, z], i) => {
    const r = recs[i];
    if (!r) { missing.push([x, z]); return; }
    try {
      const raw = new Uint8Array(await squeeze(r.z, new DecompressionStream('deflate'))), n = r.n;
      const blocks = new Uint16Array(n), meta = new Uint8Array(n);
      new Uint8Array(blocks.buffer).set(raw.subarray(0, n * 2));
      meta.set(raw.subarray(n * 2, n * 3));
      found(x, z, { blocks, meta, biome: raw.slice(n * 3), top: r.top }, r.s);
    } catch (e) { missing.push([x, z]); }
  }));
  return missing;
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
