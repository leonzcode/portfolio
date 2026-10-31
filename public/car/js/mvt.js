// A second source of streets and buildings for when the Overpass API is slow or down: OpenFreeMap's vector tiles
// (OpenMapTiles schema, OpenStreetMap data, no key, served from a CDN). Fewer tags than Overpass (no lanes,
// hydrants or signals) but it answers in a second. Decodes Mapbox Vector Tiles itself and returns the same store
// shape as osm.js (roads with made-up node ids shared where lines meet, buildings with heights).
import { project } from './geo.js?v=49';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;
let template = null;

async function tileUrl() {
  if (!template) {
    const j = await (await fetch(TILEJSON)).json();
    template = j.tiles[0];
  }
  return template;
}

// ---- protobuf ----
class Pbf {
  constructor(buf) { this.b = new Uint8Array(buf); this.p = 0; this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength); }
  varint() { let r = 0, s = 0, c; do { c = this.b[this.p++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return r; }
  skip(t) { if (t === 0) this.varint(); else if (t === 1) this.p += 8; else if (t === 2) this.p += this.varint(); else if (t === 5) this.p += 4; }
  bytes() { const n = this.varint(), s = this.p; this.p += n; return [s, s + n]; }
  str() { const [a, b] = this.bytes(); return new TextDecoder().decode(this.b.subarray(a, b)); }
  packed() { const n = this.varint(), e = this.p + n, out = []; while (this.p < e) out.push(this.varint()); return out; }
}

function readTile(buf) {
  const p = new Pbf(buf), layers = {};
  while (p.p < p.b.length) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 3) { const [a, b] = p.bytes(); const L = readLayer(p, a, b); layers[L.name] = L; }
    else p.skip(t);
  }
  return layers;
}
function readLayer(p, start, end) {
  const L = { name: '', extent: 4096, keys: [], values: [], feats: [] };
  const save = p.p; p.p = start;
  while (p.p < end) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 1) L.name = p.str();
    else if (f === 2) { const [a, b] = p.bytes(); L.feats.push([a, b]); }
    else if (f === 3) L.keys.push(p.str());
    else if (f === 4) { const [a, b] = p.bytes(); L.values.push(readValue(p, a, b)); }
    else if (f === 5) L.extent = p.varint();
    else p.skip(t);
  }
  p.p = save;
  L.feature = i => readFeature(p, L, ...L.feats[i]);
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
  p.p = save;
  return v;
}
function readFeature(p, L, a, b) {
  const save = p.p; p.p = a;
  const F = { id: 0, props: {}, type: 0, geom: [] };
  while (p.p < b) {
    const tag = p.varint(), f = tag >> 3, t = tag & 7;
    if (f === 1) F.id = p.varint();
    else if (f === 2) { const tags = p.packed(); for (let i = 0; i + 1 < tags.length; i += 2) F.props[L.keys[tags[i]]] = L.values[tags[i + 1]]; }
    else if (f === 3) F.type = p.varint();
    else if (f === 4) F.geom = p.packed();
    else p.skip(t);
  }
  p.p = save;
  // decode geometry into rings / lines of [x, y] in tile units
  const parts = []; let cur = null, x = 0, y = 0;
  const g = F.geom;
  for (let i = 0; i < g.length;) {
    const c = g[i++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < n; k++) {
        const dx = g[i++], dy = g[i++];
        x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
        if (id === 1) { cur = [[x, y]]; parts.push(cur); } else cur.push([x, y]);
      }
    } else if (id === 7) { /* close path: rings are closed implicitly */ }
  }
  F.parts = parts;
  return F;
}

// ---- conversion ----
const HW = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'track', path: 'footway', busway: 'busway', raceway: 'raceway' };
const cache = new Map();

function tileToLatLon(tx, ty, px, py, ext) {
  const n = 2 ** Z, X = tx + px / ext, Y = ty + py / ext;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / n))) * 180 / Math.PI, X / n * 360 - 180];
}

async function getTile(x, y) {
  const k = x + ',' + y;
  if (cache.has(k)) return cache.get(k);
  const pr = tileUrl().then(t => fetch(t.replace('{z}', Z).replace('{x}', x).replace('{y}', y))).then(r => { if (!r.ok) throw new Error('mvt ' + r.status); return r.arrayBuffer(); }).then(readTile);
  cache.set(k, pr);
  pr.catch(() => cache.delete(k));
  return pr;
}

const shoelace = r => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

// store with roads and buildings for a radius round lat/lon (local frame must already be set)
export async function load(lat, lon, radius = 700) {
  const n = 2 ** Z, la = lat * Math.PI / 180;
  const fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
  const tileM = 40075016 * Math.cos(la) / n, r = Math.ceil(radius / tileM + 0.5);
  const jobs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor(fx) + dx, y = Math.floor(fy) + dy;
    // only tiles that reach into the circle: the nearest point of the tile's square to the centre
    const nx = Math.max(x, Math.min(fx, x + 1)), ny = Math.max(y, Math.min(fy, y + 1));
    if (Math.hypot((nx - fx) * tileM, (ny - fy) * tileM) > radius) continue;
    jobs.push(getTile(x, y).then(L => ({ x, y, L })).catch(() => null));
  }
  const tiles = (await Promise.all(jobs)).filter(Boolean);
  const store = { nodes: new Map(), roads: [], buildings: [], barriers: [], lines: [], treeRows: [], areas: [], points: [], bbox: null, source: 'openfreemap' };
  const nodeAt = new Map();
  let nid = -1, wid = -1;
  const node = (x, z) => {
    const k = Math.round(x * 2) + ',' + Math.round(z * 2);
    let id = nodeAt.get(k);
    if (id === undefined) { id = nid--; nodeAt.set(k, id); store.nodes.set(id, { id, x, z, tags: null }); }
    return id;
  };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const shops = []; // (buildings) shop, cafe, pub and bank points: their building's ground floor is shop fronts
  // (buildings) the buildings' decoding gives the page its frames back every 8 ms (a dense tile took a few hundred)
  let tY = performance.now();
  const breathe = async () => { if (performance.now() - tY > 8) { await new Promise(r => setTimeout(r, 0)); tY = performance.now(); } };
  // street names live in their own layer: named lines, matched to the roads by nearness below
  const named = [], NG = new Map(), NCELL = 20;
  for (const { x, y, L } of tiles) {
    const TN = L.transportation_name; if (!TN) continue;
    const loc = (px, py) => { const [a, b] = tileToLatLon(x, y, px, py, TN.extent); return project(a, b); };
    for (let i = 0; i < TN.feats.length; i++) {
      if ((i & 31) === 0) await breathe(); // (terrain: the roads' names and lines give the frames back too)
      const F = TN.feature(i);
      if (F.type !== 2 || !F.props.name) continue;
      for (const part of F.parts) {
        const pts = part.map(([px, py]) => loc(px, py));
        for (let k = 1; k < pts.length; k++) {
          const sgm = { a: pts[k - 1], b: pts[k], name: F.props.name, ref: F.props.ref || null };
          const cx0 = Math.floor(Math.min(sgm.a[0], sgm.b[0]) / NCELL), cx1 = Math.floor(Math.max(sgm.a[0], sgm.b[0]) / NCELL);
          const cz0 = Math.floor(Math.min(sgm.a[1], sgm.b[1]) / NCELL), cz1 = Math.floor(Math.max(sgm.a[1], sgm.b[1]) / NCELL);
          if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 400) continue;
          for (let i2 = cx0; i2 <= cx1; i2++) for (let j2 = cz0; j2 <= cz1; j2++) { const kk = i2 + ',' + j2; let l = NG.get(kk); if (!l) NG.set(kk, l = []); l.push(sgm); }
        }
      }
    }
  }
  const nameAt = (x, z) => {
    let best = null, bd = 6;
    const l = NG.get(Math.floor(x / NCELL) + ',' + Math.floor(z / NCELL)); if (!l) return null;
    for (const g of l) {
      const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1], L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - g.a[0]) * dx + (z - g.a[1]) * dz) / L2)) : 0;
      const d = Math.hypot(x - g.a[0] - dx * t, z - g.a[1] - dz * t);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  };
  void named;
  for (const { x, y, L } of tiles) {
    const T = L.transportation, B = L.building;
    const ext = (T || B || { extent: 4096 }).extent;
    const loc = (px, py) => { const [a, b] = tileToLatLon(x, y, px, py, ext); return project(a, b); };
    const c0 = loc(0, 0), c1 = loc(ext, ext);
    x0 = Math.min(x0, c0[0], c1[0]); x1 = Math.max(x1, c0[0], c1[0]); z0 = Math.min(z0, c0[1], c1[1]); z1 = Math.max(z1, c0[1], c1[1]);
    if (T) for (let i = 0; i < T.feats.length; i++) {
      if ((i & 31) === 0) await breathe();
      const F = T.feature(i);
      if (F.type !== 2) continue;
      const pr = F.props, hw = HW[pr.class];
      if (!hw) continue;
      const tags = { highway: hw + (pr.ramp === 1 && /^(motorway|trunk|primary|secondary|tertiary)$/.test(hw) ? '_link' : '') };
      if (pr.subclass && pr.class === 'path') tags.highway = pr.subclass;
      if (pr.oneway === 1 || pr.oneway === -1) tags.oneway = pr.oneway === 1 ? 'yes' : '-1';
      if (pr.brunnel === 'bridge') tags.bridge = 'yes';
      if (pr.brunnel === 'tunnel') tags.tunnel = 'yes';
      if (pr.layer) tags.layer = String(pr.layer);
      if (pr.name) tags.name = pr.name;
      if (pr.surface) tags.surface = pr.surface;
      for (let part of F.parts) {
        // keep only what lies in the tile itself (tiles repeat a margin of their neighbours)
        part = clipLine(part, ext);
        for (const seg of part) {
          if (seg.length < 2) continue;
          const pts = seg.map(([px, py]) => loc(px, py));
          if (tags.oneway === '-1') { pts.reverse(); tags.oneway = 'yes'; }
          if (!tags.name) { const m = pts[(pts.length / 2) | 0], m2 = pts.length > 1 ? pts[Math.min(pts.length - 1, ((pts.length / 2) | 0) + 1)] : m; const g = nameAt((m[0] + m2[0]) / 2, (m[1] + m2[1]) / 2) || nameAt(m[0], m[1]); if (g) { tags.name = g.name; if (g.ref) tags.ref = g.ref; } }
          const onB = q => q[0] <= 1e-6 || q[1] <= 1e-6 || q[0] >= ext - 1e-6 || q[1] >= ext - 1e-6;
          store.roads.push({ id: wid--, nodes: pts.map(([a, b]) => node(a, b)), pts, tags: { ...tags }, highway: tags.highway, bS: onB(seg[0]), bE: onB(seg[seg.length - 1]) });
        }
      }
    }
    // water (sea, lakes, rivers): areas the trees and anything else can stay off
    const W = L.water;
    if (W) for (let i = 0; i < W.feats.length; i++) {
      if ((i & 31) === 0) await breathe();
      const F = W.feature(i);
      if (F.type !== 3) continue;
      let cur = null;
      for (const raw of F.parts) {
        const ring = raw.map(([px, py]) => loc(px, py));
        if (shoelace(raw) > 0) { if (shoelace(ring) > 0) ring.reverse(); cur = { id: wid--, kind: 'water', outer: ring, holes: [], tags: { natural: 'water', water: F.props.class || 'water' } }; store.areas.push(cur); }
        else if (cur) { if (shoelace(ring) < 0) ring.reverse(); cur.holes.push(ring); }
      }
    }
    if (B) for (let i = 0; i < B.feats.length; i++) {
      if ((i & 31) === 0) await breathe();
      const F = B.feature(i);
      if (F.type !== 3 || F.props.hide_3d) continue;
      // centre inside this tile only, so a building on a tile edge is taken once
      const rings = F.parts.map(r => r.map(([px, py]) => loc(px, py)));
      let cur = null;
      for (let k = 0; k < rings.length; k++) {
        const raw = F.parts[k], area = shoelace(raw); // exterior rings are positive in tile space (y down)
        if (area > 0) {
          let cx = 0, cy = 0; for (const [a, b] of raw) { cx += a; cy += b; } cx /= raw.length; cy /= raw.length;
          if (cx < 0 || cy < 0 || cx >= ext || cy >= ext) { cur = null; continue; }
          const outer = rings[k];
          if (shoelace(outer) > 0) outer.reverse();
          const h = num(F.props.render_height), mh = num(F.props.render_min_height) || 0;
          // (heightReal: the tiles' 5 m is their default for a building with no height; any other is from its tags)
          cur = { id: wid--, outer, holes: [], tags: {}, part: mh > 0, height: h, heightReal: h != null && Math.abs(h - 5) > 0.01, minHeight: mh, levels: null, minLevel: 0, roofShape: null, roofHeight: null, roofLevels: null, colour: F.props.colour || null, roofColour: null, material: null, roofMaterial: null, type: 'yes' };
          store.buildings.push(cur);
        } else if (cur) { const h = rings[k]; if (shoelace(h) < 0) h.reverse(); cur.holes.push(h); }
      }
    }
    // (buildings) the points of interest that make a ground floor a shop front
    const PO = L.poi;
    if (PO) for (let i = 0; i < PO.feats.length; i++) {
      if ((i & 63) === 0) await breathe();
      const F = PO.feature(i);
      if (F.type !== 1 || !SHOP_CLASS.test(F.props.class || '')) continue;
      for (const part of F.parts) for (const [px, py] of part) if (px >= 0 && py >= 0 && px < PO.extent && py < PO.extent) { const [a, b] = tileToLatLon(x, y, px, py, PO.extent); shops.push(project(a, b)); }
    }
  }
  try { markShops(shops, store.buildings); } catch (e) { /* shops are a nicety */ }
  // A road crossing a tile border comes as two lines, cut at the border in each tile's own coordinates, so their
  // ends miss each other by up to a metre or so: join each such end to the nearest one of the same kind from the
  // other side (else the two are separate dead ends, with a step between them and a gap in the lanes).
  {
    const ends = [], EG = new Map(), C = 4;
    for (const r of store.roads) for (const end of [0, 1]) {
      if (!(end ? r.bE : r.bS)) continue;
      const i = end ? r.pts.length - 1 : 0, p = r.pts[i], e = { r, i, x: p[0], z: p[1], done: false };
      ends.push(e);
      const k = Math.floor(p[0] / C) + ',' + Math.floor(p[1] / C); let l = EG.get(k); if (!l) EG.set(k, l = []); l.push(e);
    }
    for (const e of ends) {
      if (e.done) continue;
      let best = null, bd = 3;
      const ci = Math.floor(e.x / C), cj = Math.floor(e.z / C);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const o of EG.get(i + ',' + j) || []) {
        if (o === e || o.done || o.r === e.r || o.r.highway !== e.r.highway) continue;
        const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd) { bd = d; best = o; }
      }
      if (!best) continue;
      const mx = (e.x + best.x) / 2, mz = (e.z + best.z) / 2, id = e.r.nodes[e.i];
      for (const q of [e, best]) { q.r.pts[q.i] = [mx, mz]; q.r.nodes[q.i] = id; q.done = true; }
      const n = store.nodes.get(id); if (n) { n.x = mx; n.z = mz; }
    }
    for (const r of store.roads) { delete r.bS; delete r.bE; }
  }
  // only what is near the place asked for (a tile is about 2 km across)
  const [cx, cz] = project(lat, lon), R2 = (radius + 120) ** 2;
  const near = pts => pts.some(([a, b]) => (a - cx) ** 2 + (b - cz) ** 2 < R2);
  store.roads = store.roads.filter(r => near(r.pts));
  store.buildings = store.buildings.filter(b => near(b.outer));
  // a water polygon can be huge with no vertex near: keep any whose box reaches the circle
  store.areas = store.areas.filter(a => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [px, pz] of a.outer) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); } return cx > x0 - radius && cx < x1 + radius && cz > z0 - radius && cz < z1 + radius; });
  store.bbox = { x0: Math.max(x0, cx - radius), z0: Math.max(z0, cz - radius), x1: Math.min(x1, cx + radius), z1: Math.min(z1, cz + radius) };
  return store;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// (buildings) OpenMapTiles poi classes that are shops, cafes, pubs or banks
const SHOP_CLASS = /^(shop|grocery|clothing_store|alcohol_shop|bakery|beer|cafe|restaurant|fast_food|bar|bank|pharmacy|ice_cream|hairdresser|jewelry|books|gift|mobile_phone|shoe|florist|furniture|hardware|laundry|music|optician|pet|sports|stationery|toys|car|bicycle|electronics|deli|butcher|chemist|cosmetics|wine|tobacco|newsagent|dry_cleaning)$/;
function markShops(shops, recs) {
  if (!shops.length || !recs.length) return;
  const G = 32, grid = new Map();
  for (const b of recs) {
    if (b.part) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.outer) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
    if ((x1 - x0) * (z1 - z0) > 250000) continue;
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) { const k = i + ',' + j; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(b); }
  }
  const inside = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], q = r[j]; if ((a[1] > z) !== (q[1] > z) && x < (q[0] - a[0]) * (z - a[1]) / (q[1] - a[1]) + a[0]) c = !c; } return c; };
  for (const [x, z] of shops) {
    const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)); if (!l) continue;
    for (const b of l) if (inside(x, z, b.outer)) { b.shop = true; b.shops = (b.shops || 0) + 1; break; }
  }
}

// a line cut to the tile square [0, ext], as one or more runs
function clipLine(pts, ext) {
  const inb = p => p[0] >= 0 && p[0] <= ext && p[1] >= 0 && p[1] <= ext;
  const out = []; let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (inb(p)) {
      if (!cur.length && i > 0) cur.push(edge(pts[i - 1], p, ext));
      cur.push(p);
    } else {
      if (cur.length) { cur.push(edge(pts[i - 1], p, ext)); out.push(cur); cur = []; }
      else if (i > 0) {
        // a segment that crosses the tile without a point inside
        const s = crossing(pts[i - 1], p, ext);
        if (s) out.push(s);
      }
    }
  }
  if (cur.length) out.push(cur);
  return out.filter(s => s.length >= 2);
}
function edge(a, b, ext) {
  // where segment a (inside) .. b (outside), or the other way, meets the square
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const clip = (p, q) => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
  if (clip(-dx, a[0]) && clip(dx, ext - a[0]) && clip(-dy, a[1]) && clip(dy, ext - a[1])) {
    const inA = a[0] >= 0 && a[0] <= ext && a[1] >= 0 && a[1] <= ext;
    const t = inA ? t1 : t0;
    return [a[0] + dx * t, a[1] + dy * t];
  }
  return inbClamp(b, ext);
}
function crossing(a, b, ext) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const clip = (p, q) => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
  if (!(clip(-dx, a[0]) && clip(dx, ext - a[0]) && clip(-dy, a[1]) && clip(dy, ext - a[1]))) return null;
  if (t1 - t0 < 1e-6) return null;
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}
const inbClamp = (p, ext) => [Math.min(ext, Math.max(0, p[0])), Math.min(ext, Math.max(0, p[1]))];
