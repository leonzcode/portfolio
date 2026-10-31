// Overture Maps buildings as a second source for the open map's buildings (buildings.js): Overture merges
// OpenStreetMap with Microsoft's, Google's and Esri's footprints and carries height, floors, roof shape and
// direction, facade and roof colours and materials where any source knows them. Read in a worker
// (overworker.js) from the release's PMTiles archive on S3 (Overture's own tiles, CORS open), tiles kept in the
// Cache Storage.
//
//   prefetch(lat, lon, radius)        start fetching round a place (drive.js, as soon as an area is asked for)
//   peek(x, z)                        the answer for the area round local (x, z) if it is in, else null
//   wait(x, z, ms)                    the same, waiting up to ms for one on its way
//   enrich(list, ov)                  fills what OSM's records leave empty from Overture's (never overrides a
//                                     tag OSM gives) and returns the footprints OSM does not have (other sources)
// Data: Overture Maps Foundation, ODbL (OSM-derived) and CDLA Permissive 2.0 / ODbL for the other sources.
import { frame, project, unproject } from './geo.js?v=50';

let W = null, seq = 0;
const pending = new Map();
const reqs = []; // { lat, lon, radius, x, z, fl, fo, promise, value }
const RKEY = 'car_ov_rel';

function worker() {
  if (W) return W;
  try {
    W = new Worker(new URL('./overworker.js?v=50', import.meta.url), { type: 'module' });
    W.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.error) p.rej(new Error(e.data.error)); else p.res(e.data.res); };
    W.onerror = (e) => { for (const p of pending.values()) p.rej(new Error('overture worker')); pending.clear(); W = null; };
  } catch (e) { W = null; }
  return W;
}

export function off() {
  try { return /[?&]noovt/.test(location.search) || localStorage.getItem('car_overture') === '0'; } catch (e) { return false; }
}

export function prefetch(lat, lon, radius = 700) {
  if (off()) return null;
  const fl = frame.lat, fo = frame.lon;
  // a request that already covers this circle in the same frame
  for (const r of reqs) if (r.fl === fl && r.fo === fo && dist(r.lat, r.lon, lat, lon) + radius <= r.radius + 80) return r.promise;
  const w = worker(); if (!w) return null;
  let release = null; try { release = localStorage.getItem(RKEY); } catch (e) {}
  const id = ++seq;
  const [x, z] = project(lat, lon);
  const r = { lat, lon, radius, x, z, fl, fo, value: null, t0: performance.now() };
  r.promise = new Promise((res, rej) => pending.set(id, { res, rej })).then(v => {
    r.value = v; r.ms = Math.round(performance.now() - r.t0);
    try { if (v.release) localStorage.setItem(RKEY, v.release); } catch (e) {}
    return v;
  }).catch(e => { console.warn('overture', e.message); r.failed = true; return null; });
  w.postMessage({ id, lat, lon, radius, frame: { lat: fl, lon: fo }, release });
  reqs.unshift(r); if (reqs.length > 6) reqs.length = 6;
  return r.promise;
}
function dist(la1, lo1, la2, lo2) { return Math.hypot((lo2 - lo1) * 111320 * Math.cos(la1 * Math.PI / 180), (la2 - la1) * 110540); }

function find(x, z) {
  for (const r of reqs) if (r.fl === frame.lat && r.fo === frame.lon && Math.hypot(r.x - x, r.z - z) < Math.max(250, r.radius * 0.5)) return r;
  return null;
}
export function peek(x, z) { const r = find(x, z); return r && r.value ? r.value : null; }
export async function wait(x, z, ms = 1500) {
  let r = find(x, z);
  if (!r) { if (off()) return null; const g = unproject(x, z); prefetch(g.lat, g.lon, 750); r = find(x, z); if (!r) return null; }
  if (r.value || r.failed) return r.value;
  return Promise.race([r.promise, new Promise(res => setTimeout(() => res(null), ms))]);
}
export function stats() { return reqs.map(r => ({ ms: r.ms, n: r.value ? r.value.buildings.length : null, parts: r.value ? r.value.parts.length : null, release: r.value && r.value.release, failed: !!r.failed })); }

// ---------- merging ----------
const area2 = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function centroid(r) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }
const FIELDS = ['levels', 'minLevel', 'roofShape', 'roofHeight', 'roofDirection', 'roofOrientation', 'colour', 'roofColour', 'material', 'roofMaterial'];
// Overture's roof shapes are OSM's words, but a few differ
const SHAPE = { 'half-hipped': 'half-hipped', half_hipped: 'half-hipped' };
const G = 24, GM = 12; // (GM: the grid of middles the same footprint is looked for in, 3 x 3 cells round one)

// list: the store's building records (osm.js / mvt.js shape), changed in place. Resolves to the records to add.
// (in slices of opts.budget ms, so the page's frames go on meanwhile)
export async function enrich(list, ov, opts = {}) {
  const st = { matched: 0, byId: 0, byShape: 0, filled: 0, heights: 0, added: 0, ms: 0, slices: 0 };
  if (!ov || !list) return { add: [], stats: st };
  const t0 = performance.now(), budget = opts.budget || 6;
  let ts = t0, work = 0;
  const pause = async () => { if (++work % 64) return; const now = performance.now(); if (now - ts > budget) { st.ms += now - ts; st.slices++; await new Promise(r => setTimeout(r, 0)); ts = performance.now(); } };
  const byOsm = new Map(), grid = new Map();
  const all = ov.buildings.concat(ov.parts);
  for (const o of all) {
    o._used = false;
    if (o.osm) byOsm.set(o.osm + (o.part ? 'p' : ''), o);
    const c = o._c || (o._c = centroid(o.outer)); if (o._a == null) o._a = Math.abs(area2(o.outer));
    const k = Math.floor(c[0] / GM) * 65536 + Math.floor(c[1] / GM); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(o);
    await pause();
  }
  const sgrid = new Map();
  for (const b of list) {
    if (!b || !b.outer || b.outer.length < 3) continue;
    await pause();
    let o = null;
    if (typeof b.id === 'number' && b.id > 0) {
      const key = (b.rel ? 'r' + b.rel : 'w' + b.id);
      o = byOsm.get(key + (b.part ? 'p' : '')) || byOsm.get(key + (b.part ? '' : 'p')) || null;
      if (o) st.byId++;
    }
    const c = centroid(b.outer), a = Math.abs(area2(b.outer));
    b._c = c;
    if (!o) {
      // the same footprint: each one's middle inside the other, of a like size
      const ci = Math.floor(c[0] / GM), cj = Math.floor(c[1] / GM);
      let best = null, bs = Infinity;
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const l = grid.get(i * 65536 + j); if (!l) continue;
        for (const q of l) {
          if (q._used) continue;
          const ratio = q._a / Math.max(1, a);
          if (ratio < 0.6 || ratio > 1.65) continue;
          if (!inRing(q._c[0], q._c[1], b.outer) || !inRing(c[0], c[1], q.outer)) continue;
          const s = Math.abs(Math.log(ratio)) + Math.hypot(q._c[0] - c[0], q._c[1] - c[1]) * 0.05 + (q.part === !!b.part ? 0 : 0.3);
          if (s < bs) { bs = s; best = q; }
        }
      }
      o = best; if (o) st.byShape++;
    }
    // the store's own grid, for the footprints that are not in it (below)
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.outer) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) { const k = i + ',' + j; let l = sgrid.get(k); if (!l) sgrid.set(k, l = []); l.push(b); }
    if (!o) continue;
    o._used = true; st.matched++;
    b.ovt = true;
    for (const f of FIELDS) if (b[f] == null && o[f] != null) { b[f] = f === 'roofShape' ? (SHAPE[o[f]] || o[f]) : o[f]; st.filled++; }
    if (b.type === 'yes' || !b.type) { if (o.cls) b.type = o.cls; }
    if (o.subtype && !b.subtype) b.subtype = o.subtype;
    if (o.name && !b.name) b.name = o.name;
    // the vector tiles' height is 5 m where they know none: Overture's (from any source) is better than that
    const tileDefault = b.height === 5 && b.levels == null && !(b.tags && (b.tags.height || b.tags['building:levels']));
    if (o.height != null && (b.height == null || tileDefault)) { b.height = o.height; b.heightReal = true; st.heights++; }
    if (o.minHeight != null && !(b.minHeight > 0)) b.minHeight = o.minHeight;
  }
  // footprints only the other sources have (Microsoft's, Google's...), where OSM has nothing
  const add = [];
  let k = 0;
  for (const o of ov.buildings) {
    await pause();
    if (o._used || !o.src || o.src === 'osm' || o.hasParts) continue;
    const [cx, cz] = o._c;
    const l = sgrid.get(Math.floor(cx / G) + ',' + Math.floor(cz / G)) || [];
    let hit = false;
    for (const b of l) { if (inRing(cx, cz, b.outer) || inRing(b._c[0], b._c[1], o.outer)) { hit = true; break; } }
    if (hit) continue;
    if (o._a < 12 || o._a > 20000) continue;
    add.push({
      id: 9e12 + (++k) + Math.round(Math.abs(cx) * 7 + Math.abs(cz) * 13) * 1000, outer: o.outer.map(p => [p[0], p[1]]), holes: o.holes, tags: {}, part: false, src: o.src, ovt: true,
      height: o.height, heightReal: o.height != null, minHeight: o.minHeight || 0, levels: o.levels, minLevel: o.minLevel || 0,
      roofShape: o.roofShape, roofHeight: o.roofHeight, roofLevels: null, roofDirection: o.roofDirection, roofOrientation: o.roofOrientation,
      colour: o.colour, roofColour: o.roofColour, material: o.material, roofMaterial: o.roofMaterial, type: o.cls || 'yes', subtype: o.subtype || null,
    });
  }
  st.added = add.length;
  st.ms = +(st.ms + performance.now() - ts).toFixed(1); st.wall = Math.round(performance.now() - t0);
  return { add, stats: st };
}

export const overture = { prefetch, peek, wait, enrich, stats, off };
export default overture;
