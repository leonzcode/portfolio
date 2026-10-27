// Worker for overture.js: reads Overture Maps' buildings from the release's PMTiles archive on S3 (open to any
// page, range requests), so none of the fetching, unzipping or decoding runs on the page's thread.
//   in:  { id, lat, lon, radius, frame: { lat, lon }, release }      (release: the last one known, or null)
//   out: { id, res: { release, buildings: [...], parts: [...] } } or { id, error }
// Each record is in the local frame (geo.js project): { ov, osm, src, outer, holes, height, minHeight, levels,
// minLevel, roofShape, roofHeight, roofDirection, roofOrientation, colour, roofColour, material, roofMaterial, cls,
// subtype, part, building, hasParts }. osm is the OpenStreetMap record it came from ('w123' a way, 'r45' a
// relation) or null for footprints from other sources (src 'ms' Microsoft, 'google', 'esri', ...).
// Tiles are kept in the Cache Storage, so a second visit reads them from disk.
const STAC = 'https://stac.overturemaps.org/catalog.json';
const BASE = 'https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/';
const Z = 14;
const CACHE = 'car-overture-v1';

let archive = null; // { release, url, header, root }
const leaves = new Map(); // offset -> Promise<dir>

async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  const s = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
// (what is kept is trimmed now and then: another release's pieces go, then the oldest past MAX_KEEP)
const MAX_KEEP = 500;
let puts = 0;
async function trim(cache, url) {
  try {
    const keys = await cache.keys(), mine = keys.filter(k => k.url.startsWith(url));
    for (const k of keys) if (!k.url.startsWith(url)) await cache.delete(k);
    for (let i = 0; i < mine.length - MAX_KEEP; i++) await cache.delete(mine[i]);
  } catch (e) { /* the cache is a convenience */ }
}
async function range(url, off, len, keep) {
  // (the Cache Storage ignores a URL's fragment, so the range goes in the query: this key is never fetched)
  const key = url + '?bytes=' + off + '-' + len;
  let cache = null;
  if (keep) { try { cache = await caches.open(CACHE); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; } }
  let last = null;
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
      if (r.status !== 206 && r.status !== 200) throw new Error('overture ' + r.status);
      const b = new Uint8Array(await r.arrayBuffer());
      if (cache) { try { await cache.put(key, new Response(b)); if (puts++ % 40 === 0) trim(cache, url); } catch (e) {} }
      return b;
    } catch (e) { last = e; await new Promise(res => setTimeout(res, 300 * (tries + 1))); }
  }
  throw last;
}

// ---- PMTiles v3 ----
function u64(b, o) { let v = 0; for (let i = 7; i >= 0; i--) v = v * 256 + b[o + i]; return v; }
function readDir(buf) {
  let p = 0;
  const v = () => { let r = 0, s = 0, c; do { c = buf[p++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; };
  const n = v(), ids = new Array(n), run = new Array(n), len = new Array(n), off = new Array(n);
  let last = 0; for (let i = 0; i < n; i++) { last += v(); ids[i] = last; }
  for (let i = 0; i < n; i++) run[i] = v();
  for (let i = 0; i < n; i++) len[i] = v();
  for (let i = 0; i < n; i++) { const x = v(); off[i] = x === 0 && i > 0 ? off[i - 1] + len[i - 1] : x - 1; }
  return { ids, run, len, off };
}
function tileId(z, x, y) {
  let acc = 0; for (let t = 0; t < z; t++) acc += 4 ** t;
  let d = 0; const xy = [x, y];
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } const t = xy[0]; xy[0] = xy[1]; xy[1] = t; }
  }
  return acc + d;
}
function findEntry(D, id) {
  let lo = 0, hi = D.ids.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (D.ids[m] <= id) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}
async function openArchive(known) {
  if (archive) return archive;
  let release = null;
  try { const j = await (await fetch(STAC)).json(); release = j.latest || null; } catch (e) { release = null; }
  if (!release) release = known;
  if (!release) throw new Error('no Overture release');
  const url = BASE + release + '/buildings.pmtiles';
  const h = await range(url, 0, 16384, false);
  if (h[0] !== 0x50 || h[1] !== 0x4d || h[7] !== 3) throw new Error('not a PMTiles v3 archive');
  const header = { rootOff: u64(h, 8), rootLen: u64(h, 16), leafOff: u64(h, 40), dataOff: u64(h, 56), comp: h[97], tcomp: h[98], maxZ: h[101] };
  const rootRaw = h.subarray(header.rootOff, header.rootOff + header.rootLen);
  const root = readDir(header.comp === 2 ? await gunzip(rootRaw) : rootRaw);
  return (archive = { release, url, header, root });
}
async function getTile(A, z, x, y) {
  const id = tileId(z, x, y);
  let D = A.root;
  for (let depth = 0; depth < 4; depth++) {
    const k = findEntry(D, id); if (k < 0) return null;
    if (D.run[k] === 0) {
      const off = A.header.leafOff + D.off[k], len = D.len[k];
      if (!leaves.has(off)) leaves.set(off, range(A.url, off, len, true).then(b => A.header.comp === 2 ? gunzip(b) : b).then(readDir));
      D = await leaves.get(off);
      continue;
    }
    if (id >= D.ids[k] + D.run[k]) return null;
    const b = await range(A.url, A.header.dataOff + D.off[k], D.len[k], true);
    return A.header.tcomp === 2 ? gunzip(b) : b;
  }
  return null;
}

// ---- Mapbox Vector Tile ----
const TD = new TextDecoder();
class Pbf {
  constructor(b) { this.b = b; this.p = 0; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  varint() { let r = 0, s = 0, c; do { c = this.b[this.p++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; }
  skip(t) { if (t === 0) this.varint(); else if (t === 1) this.p += 8; else if (t === 2) this.p += this.varint(); else if (t === 5) this.p += 4; }
  bytes() { const n = this.varint(), s = this.p; this.p += n; return [s, s + n]; }
  str() { const [a, b] = this.bytes(); return TD.decode(this.b.subarray(a, b)); }
  packed() { const n = this.varint(), e = this.p + n, out = []; while (this.p < e) out.push(this.varint()); return out; }
}
function readLayers(buf) {
  const p = new Pbf(buf), layers = {};
  while (p.p < p.b.length) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 3) { const [a, b] = p.bytes(); const L = readLayer(p, a, b); layers[L.name] = L; } else p.skip(t);
  }
  return layers;
}
function readLayer(p, start, end) {
  const L = { name: '', extent: 4096, keys: [], values: [], feats: [] }, save = p.p; p.p = start;
  while (p.p < end) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 1) L.name = p.str();
    else if (f === 2) { const [a, b] = p.bytes(); L.feats.push([a, b]); }
    else if (f === 3) L.keys.push(p.str());
    else if (f === 4) { const [a, b] = p.bytes(); L.values.push(readValue(p, a, b)); }
    else if (f === 5) L.extent = p.varint();
    else p.skip(t);
  }
  p.p = save; L.p = p;
  return L;
}
function readValue(p, a, b) {
  const save = p.p; p.p = a; let v = null;
  while (p.p < b) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 1) v = p.str();
    else if (f === 2) { v = p.dv.getFloat32(p.p, true); p.p += 4; }
    else if (f === 3) { v = p.dv.getFloat64(p.p, true); p.p += 8; }
    else if (f === 4 || f === 5) v = p.varint();
    else if (f === 6) { const n = p.varint(); v = (n % 2 ? -(n + 1) / 2 : n / 2); }
    else if (f === 7) v = !!p.varint();
    else p.skip(t);
  }
  p.p = save; return v;
}
function readFeature(L, i) {
  const p = L.p, [a, b] = L.feats[i], save = p.p; p.p = a;
  const props = {}; let type = 0, geom = null;
  while (p.p < b) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 2) { const tags = p.packed(); for (let k = 0; k + 1 < tags.length; k += 2) props[L.keys[tags[k]]] = L.values[tags[k + 1]]; }
    else if (f === 3) type = p.varint();
    else if (f === 4) geom = p.packed();
    else p.skip(t);
  }
  p.p = save;
  const rings = []; let cur = null, x = 0, y = 0;
  if (geom) for (let k = 0; k < geom.length;) {
    const c = geom[k++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) for (let j = 0; j < n; j++) {
      const dx = geom[k++], dy = geom[k++];
      x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
      if (id === 1) { cur = [[x, y]]; rings.push(cur); } else cur.push([x, y]);
    }
  }
  return { props, type, rings };
}

// ---- conversion ----
const D2R = Math.PI / 180, A_ = 6378137.0, F_ = 1 / 298.257223563, E2 = F_ * (2 - F_);
function projector(lat0, lon0) {
  const la = lat0 * D2R, s = Math.sin(la);
  const N = A_ / Math.sqrt(1 - E2 * s * s), M = A_ * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5), kx = D2R * N * Math.cos(la), kz = D2R * M;
  return (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz];
}
const SRC = { OpenStreetMap: 'osm', 'Microsoft ML Buildings': 'ms', 'Google Open Buildings': 'google', 'Esri Community Maps': 'esri', 'Instituto Geográfico Nacional (España)': 'ign' };
const shoelace = r => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function osmRef(props) {
  const s = props.sources;
  if (typeof s !== 'string') return null;
  const m = /"record_id":"([wr])(\d+)@/.exec(s) || /"record_id":"(?:way|relation)\/(\d+)/.exec(s);
  if (!m) return null;
  return m.length === 3 ? m[1] + m[2] : null;
}

function convert(L, tx, ty, proj, keep, part) {
  const out = [], ext = L.extent, n = 2 ** Z;
  const toLL = (px, py) => { const X = tx + px / ext, Y = ty + py / ext; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / n))) / D2R, X / n * 360 - 180]; };
  for (let i = 0; i < L.feats.length; i++) {
    const F = readFeature(L, i);
    if (F.type !== 3 || F.props.is_underground) continue;
    let cur = null;
    for (const raw of F.rings) {
      if (raw.length > 1 && raw[0][0] === raw[raw.length - 1][0] && raw[0][1] === raw[raw.length - 1][1]) raw.pop();
      if (raw.length < 3) continue;
      const a = shoelace(raw); // exterior rings are positive in tile space (y down)
      if (a > 0) {
        let cx = 0, cy = 0; for (const [px, py] of raw) { cx += px; cy += py; } cx /= raw.length; cy /= raw.length;
        // (a building on a tile's edge is in both tiles: taken from the one its middle is in)
        if (cx < 0 || cy < 0 || cx >= ext || cy >= ext) { cur = null; continue; }
        const outer = raw.map(([px, py]) => { const [la, lo] = toLL(px, py); return proj(la, lo); });
        if (!keep(outer)) { cur = null; continue; }
        if (shoelace(outer) > 0) outer.reverse();
        const P = F.props, gs = P['@geometry_source'];
        cur = {
          ov: P.id || null, osm: osmRef(P), src: SRC[gs] || (gs ? String(gs).toLowerCase().slice(0, 12) : null), hsrc: SRC[P['@height_source']] || null,
          outer, holes: [], part, building: P.building_id || null, hasParts: !!P.has_parts,
          height: num(P.height), minHeight: num(P.min_height), levels: num(P.num_floors), minLevel: num(P.min_floor),
          roofShape: P.roof_shape || null, roofHeight: num(P.roof_height), roofDirection: num(P.roof_direction), roofOrientation: P.roof_orientation || null,
          colour: P.facade_color || null, roofColour: P.roof_color || null, material: P.facade_material || null, roofMaterial: P.roof_material || null,
          cls: P.class || null, subtype: P.subtype || null, name: P['@name'] || null,
        };
        out.push(cur);
      } else if (cur) {
        const h = raw.map(([px, py]) => { const [la, lo] = toLL(px, py); return proj(la, lo); });
        if (shoelace(h) < 0) h.reverse();
        cur.holes.push(h);
      }
    }
  }
  return out;
}

async function load(job) {
  const A = await openArchive(job.release);
  const proj = projector(job.frame.lat, job.frame.lon);
  const n = 2 ** Z, la = job.lat * D2R;
  const fx = (job.lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
  const tileM = 40075016 * Math.cos(la) / n, r = Math.ceil(job.radius / tileM + 0.5);
  const [cx, cz] = proj(job.lat, job.lon), R2 = (job.radius + 60) ** 2;
  const keep = pts => { for (const p of pts) if ((p[0] - cx) ** 2 + (p[1] - cz) ** 2 < R2) return true; return false; };
  const jobs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor(fx) + dx, y = Math.floor(fy) + dy;
    const nx = Math.max(x, Math.min(fx, x + 1)), ny = Math.max(y, Math.min(fy, y + 1));
    if (Math.hypot((nx - fx) * tileM, (ny - fy) * tileM) > job.radius) continue;
    jobs.push(getTile(A, Z, x, y).then(b => ({ x, y, b })).catch(e => ({ x, y, err: String(e && e.message || e) })));
  }
  const buildings = [], parts = [], tiles = [];
  for (const t of await Promise.all(jobs)) {
    tiles.push(t.err ? t.x + '/' + t.y + ' ' + t.err : t.x + '/' + t.y + ' ' + (t.b ? t.b.length : 'none'));
    if (!t || !t.b) continue;
    const L = readLayers(t.b);
    if (L.building) for (const r of convert(L.building, t.x, t.y, proj, keep, false)) buildings.push(r);
    if (L.building_part) for (const r of convert(L.building_part, t.x, t.y, proj, keep, true)) parts.push(r);
  }
  return { release: A.release, buildings, parts, tiles };
}

self.onmessage = async (e) => {
  const { id } = e.data;
  try { self.postMessage({ id, res: await load(e.data) }); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
