/* Freeride's rock faces, worked out in a module worker (2026-11-12, for "improving loading time"): the land made here
   as the page makes it (frland.js), the curtains' arrays from frrockgeo.js, posted back with their buffers handed
   over. main.js sends { low } as soon as it knows the graphics tier, and this starts on the faces at once; then
   { slabs } (frrock.js slabArrays: the jibs' rock slabs, made on the page with the rest of Freeride), which go in after
   the faces, as before; then it posts { r } (rockArrays' result) or { err }. On a slow processor this was about 3.7 s
   of the page's own start; here it runs beside it. */
import { Land } from './frland.js?v=26';
import { rockFaces, rockFinish } from './frrockgeo.js?v=26';

let faces = null, t0 = 0, failed = null;
onmessage = e => {
  const m = e.data || {};
  try {
    if ('low' in m) { t0 = performance.now(); faces = rockFaces(new Land(), !!m.low); return; }
    if (m.slabs) {
      if (failed) throw failed;
      const r = rockFinish(faces, m.slabs);
      r.ms = performance.now() - t0;
      const give = [];
      for (const A of [r.rock, r.snow]) if (A) give.push(A.p.buffer, A.n.buffer, A.i.buffer);
      if (r.cover) give.push(r.cover.a.buffer);
      postMessage({ r }, give);
    }
  } catch (err) { failed = err; if (m.slabs) postMessage({ err: String(err && err.message || err) }); }
};
