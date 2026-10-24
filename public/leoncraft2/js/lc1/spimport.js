/* ---------------------------------------------------------------------------
   Leoncraft 2 - the first Leoncraft's own solo world, brought over.

   The first Leoncraft (/legacy/minecraft.html) is on this same site, so its
   save is in this browser's localStorage ('leoncraft_sp_world': its seed and
   what was changed, with the states of doors, beds, signs and the rest). The
   Select World screen offers it (ui/menus.js); bringing it over makes a new
   Leoncraft 2 world of its own, kept as any other (save.js: the changes per
   chunk in IndexedDB, the signs with the world's details, the paintings with
   its entities), whose chunks the first Leoncraft had changed are made by
   that one's own generator (lc1/mixed.js, entry.lc1). The first Leoncraft's
   save is only read, never changed.
--------------------------------------------------------------------------- */
import './lc1gen.js?v=107';
import './lc1convert.js?v=107';
import { B } from '../blocks.js?v=107';
import { Save } from '../save.js?v=107';
import { EntityStore } from '../entities/store.js?v=107';

const C = globalThis.LC1Convert;
// the first Leoncraft's solo save (minecraft.html SP_KEY); it never kept more than one
export const LC1_KEYS = ['leoncraft_sp_world'];

// the saves there are, readable: [{ key, seed, blocks }]
export function lc1Saves() {
  const out = [];
  for (const key of LC1_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const j = JSON.parse(raw);
      if (!j || typeof j.seed !== 'number') continue;
      out.push({ key, seed: j.seed >>> 0, blocks: j.blocks && typeof j.blocks === 'object' ? Object.keys(j.blocks).length : 0 });
    } catch (e) { /* not one */ }
  }
  return out;
}

/* Bring one over: the new world's entry (already in the list), and what came of it (the converter's report and the
   check that nothing is left hanging on nothing). worlds: ui/menus.js's Worlds. */
export async function importLC1(key, worlds, name) {
  const raw = localStorage.getItem(key);
  const W = C.readWorld(JSON.parse(raw), true);
  const R = C.convert(W);
  const now = Date.now();
  const id = 'w' + now.toString(36) + (Math.random() * 1e6 | 0).toString(36);
  const title = name || 'Leoncraft 1 World';
  const ids = [id, id + '~the_nether'];
  const missing = {};
  for (let d = 0; d < 2; d++) {
    const D = R.dims[d], edits = new Map();
    for (const [x, row, z, n, meta] of D.cells) {
      let b = n === 'air' ? 0 : B[n];
      if (b === undefined) { missing[n] = (missing[n] || 0) + 1; b = 0; }
      const k = Math.floor(x / 16) + ',' + Math.floor(z / 16);
      let m = edits.get(k);
      if (!m) edits.set(k, m = new Map());
      m.set((row << 8) | ((z & 15) << 4) | (x & 15), b * 256 + (meta & 255));
    }
    const save = new Save(ids[d]);
    await save.init();
    for (const k of edits.keys()) save.dirty.add(k);
    await save.flush(edits);
    if (D.signs.length) await save.writeExtra('details', D.signs);
    if (D.paintings.length) {
      const stored = {};
      for (const p of D.paintings) {
        const j = Object.assign({}, p); delete j.from;
        const k = Math.floor(j.p[0] / 16) + ',' + Math.floor(j.p[2] / 16);
        (stored[k] || (stored[k] = [])).push(j);
      }
      await EntityStore.save(ids[d], { v: 1, list: [], stored, pop: [], wt: null });
    }
  }
  const entry = {
    id, name: title, folder: worlds.folderName(title), seed: String(R.seed), generator: 'vanilla', lc1: R.lc1, spawn: R.spawn,
    mode: 'creative', difficulty: 'normal', cheats: true, created: now, lastPlayed: now, fromLc1: key,
  };
  worlds.add(entry);
  R.report.missing = missing;
  return { entry, report: R.report, check: R.check };
}
