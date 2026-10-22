// OpenStreetMap data from the Overpass API, parsed into the local frame (geo.js project: x east, z south, metres).
// Loaded by square cells of CELL metres in the local frame, so the world can stream cells as the car drives.
//
//   await osm.load(lat, lon, radius)  -> the merged store (everything loaded so far, see below)
//   await osm.loadCell(cx, cz)         -> what this cell added that no earlier cell had (same shape as the store)
//   osm.data                           -> the merged store
//   osm.cellOf(x, z)                   -> [cx, cz]
//
// Store shape (arrays, every way complete with all its nodes even past the cell edge):
//   nodes: Map id -> { id, x, z, tags|null }
//   roads:     [{ id, nodes:[ids], pts:[[x,z]...], tags, highway }]            every highway=* way (footways too)
//   buildings: [{ id, outer:[[x,z]...] (counter-clockwise from above, not closed), holes:[[[x,z]...]], tags, part,
//                 height (m|null), minHeight (m, 0), levels|null, minLevel (0), roofShape|null, roofHeight|null,
//                 roofLevels|null, colour|null, roofColour|null, material|null, roofMaterial|null, type }]
//                 Outlines that have building:part inside them are dropped (the parts are drawn).
//   bbox: { x0, z0, x1, z1 } of the loaded cells
//   barriers:  [{ id, kind, pts, closed, tags }]       barrier=* ways (fence, wall, hedge, guard_rail, retaining_wall...)
//   lines:     [{ id, kind:'line'|'minor_line', nodes, pts, tags }]   power lines (poles are in points)
//   treeRows:  [{ id, pts, tags }]
//   areas:     [{ id, kind, outer, holes, tags }]      parking, park, grass, water, wood, landuse, pedestrian areas
//   points:    [{ id, kind, x, z, tags }]  kind: fire_hydrant, street_lamp, traffic_signals, stop, give_way, crossing,
//              power_pole, power_tower, utility_pole, bench, waste_basket, bus_stop, tree, post_box, telephone,
//              bollard, gate, barrier (other barrier nodes), recycling, bicycle_parking, vending, mini_roundabout,
//              turning_circle, motorway_junction
import { project, unproject, frame } from './geo.js?v=17';

export const CELL = 500;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE_NAME = 'car-osm-v1';

function query(s, w, n, e) {
  const b = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  return `[out:json][timeout:90];
(
way["highway"]${b};
way["building"]${b};
way["building:part"]${b};
relation["type"="multipolygon"]["building"]${b};
relation["type"="building"]${b};
way["barrier"]${b};
way["power"~"^(line|minor_line)$"]${b};
way["natural"~"^(tree_row|water|wood|scrub|grassland)$"]${b};
way["amenity"="parking"]${b};
way["landuse"]${b};
way["leisure"~"^(park|garden|pitch|playground)$"]${b};
way["area:highway"]${b};
node["highway"~"^(traffic_signals|stop|give_way|crossing|street_lamp|bus_stop|mini_roundabout|turning_circle|motorway_junction)$"]${b};
node["crossing"]${b};
node["emergency"="fire_hydrant"]${b};
node["power"~"^(pole|tower)$"]${b};
node["man_made"="utility_pole"]${b};
node["amenity"~"^(bench|waste_basket|post_box|telephone|recycling|bicycle_parking|vending_machine)$"]${b};
node["natural"="tree"]${b};
node["barrier"]${b};
);
out body qt;
>;
out skel qt;`;
}

let fetcher = null;
// Tests can swap the network layer: fn(query) -> Promise<json>.
export function setFetcher(fn) { fetcher = fn; }

async function cachedGet(url) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); const hit = await cache.match(url); if (hit) return await hit.json(); } catch (e) { cache = null; }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 100000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    const json = JSON.parse(text);
    if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
    if (cache) { try { await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } })); } catch (e) {} }
    return json;
  } finally { clearTimeout(timer); }
}

// An override endpoint goes first: ?overpass=<url> on the page, or localStorage car_overpass.
function endpoints() {
  let o = null;
  try { o = new URLSearchParams(location.search).get('overpass'); } catch (e) {}
  if (!o) { try { o = localStorage.getItem('car_overpass'); } catch (e) {} }
  return o ? [o, ...ENDPOINTS] : ENDPOINTS;
}

// At most two Overpass requests at a time from this page, however many cells are asked for.
let active = 0; const waiting = [];
async function slot() { if (active < 2) { active++; return; } await new Promise(r => waiting.push(r)); active++; }
function release() { active--; const n = waiting.shift(); if (n) n(); }

async function overpass(q) {
  await slot();
  try { return await overpassOne(q); } finally { release(); }
}
async function overpassOne(q) {
  if (fetcher) return fetcher(q);
  let last = null;
  for (let round = 0; round < 2; round++) {
    for (const ep of endpoints()) {
      try { return await cachedGet(ep + '?data=' + encodeURIComponent(q)); }
      catch (e) { last = e; }
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  throw last || new Error('overpass failed');
}

// ---------- parsing ----------
const num = (v) => { if (v == null) return null; const m = /^\s*(-?[\d.]+)\s*(m|ft|')?/.exec(String(v)); if (!m) return null; const x = parseFloat(m[1]); return isFinite(x) ? (m[2] && m[2] !== 'm' ? x * 0.3048 : x) : null; };

const POINT_KIND = (t) => {
  if (t.highway === 'traffic_signals') return 'traffic_signals';
  if (t.highway === 'stop') return 'stop';
  if (t.highway === 'give_way') return 'give_way';
  if (t.highway === 'crossing' || (t.crossing && t.highway !== 'traffic_signals')) return 'crossing';
  if (t.highway === 'street_lamp') return 'street_lamp';
  if (t.highway === 'bus_stop') return 'bus_stop';
  if (t.highway === 'mini_roundabout' || t.highway === 'turning_circle' || t.highway === 'motorway_junction') return t.highway;
  if (t.emergency === 'fire_hydrant') return 'fire_hydrant';
  if (t.power === 'pole') return 'power_pole';
  if (t.power === 'tower') return 'power_tower';
  if (t.man_made === 'utility_pole') return 'utility_pole';
  if (t.natural === 'tree') return 'tree';
  if (t.amenity === 'bench') return 'bench';
  if (t.amenity === 'waste_basket') return 'waste_basket';
  if (t.amenity === 'post_box') return 'post_box';
  if (t.amenity === 'telephone') return 'telephone';
  if (t.amenity === 'recycling') return 'recycling';
  if (t.amenity === 'bicycle_parking') return 'bicycle_parking';
  if (t.amenity === 'vending_machine') return 'vending';
  if (t.barrier === 'bollard') return 'bollard';
  if (t.barrier === 'gate' || t.barrier === 'lift_gate' || t.barrier === 'swing_gate') return 'gate';
  if (t.barrier) return 'barrier';
  return null;
};

function areaKind(t) {
  if (t.amenity === 'parking') return 'parking';
  if (t['area:highway']) return 'road_area';
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'pedestrian';
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub') return 'scrub';
  if (t.natural === 'grassland' || t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green') return 'grass';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground') return 'park';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.landuse) return 'landuse:' + t.landuse;
  return null;
}

function buildingInfo(t) {
  const height = num(t.height), minHeight = num(t.min_height) || 0;
  const levels = num(t['building:levels']), minLevel = num(t['building:min_level']) || 0;
  return {
    height, minHeight, levels, minLevel,
    roofShape: t['roof:shape'] || null, roofHeight: num(t['roof:height']), roofLevels: num(t['roof:levels']),
    colour: t['building:colour'] || t.colour || null, roofColour: t['roof:colour'] || null,
    material: t['building:material'] || null, roofMaterial: t['roof:material'] || null,
    type: t.building || t['building:part'] || 'yes',
  };
}

// Rings: open (last point not repeated); outer counter-clockwise seen from above, holes clockwise. In (x, z) with
// z south, counter-clockwise from above is a negative shoelace sum.
const shoelace = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function ring(pts, ccw) {
  const r = pts.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if ((shoelace(r) < 0) !== ccw) r.reverse();
  return r;
}
function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// OSM 3D rule: an outline that has building:part inside it is not drawn, the parts are.
function dropCoveredOutlines(list) {
  const parts = list.filter(b => b.part);
  if (!parts.length) return list;
  const cen = parts.map(b => { let x = 0, z = 0; for (const p of b.outer) { x += p[0]; z += p[1]; } return [x / b.outer.length, z / b.outer.length]; });
  return list.filter(b => {
    if (b.part) return true;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of b.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (const c of cen) if (c[0] > x0 && c[0] < x1 && c[1] > z0 && c[1] < z1 && inRing(c[0], c[1], b.outer)) return false;
    return true;
  });
}

// Joins member ways into closed rings (lists of node ids).
function joinRings(wayLists) {
  const rings = [], open = wayLists.filter(w => w && w.length > 1).map(w => w.slice());
  while (open.length) {
    let cur = open.pop();
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const end = cur[cur.length - 1];
      let k = -1, rev = false;
      for (let i = 0; i < open.length; i++) {
        if (open[i][0] === end) { k = i; break; }
        if (open[i][open[i].length - 1] === end) { k = i; rev = true; break; }
      }
      if (k < 0) break;
      const nx = open.splice(k, 1)[0];
      if (rev) nx.reverse();
      cur = cur.concat(nx.slice(1));
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}

function emptyStore() {
  return { nodes: new Map(), roads: [], buildings: [], barriers: [], lines: [], treeRows: [], areas: [], points: [], bbox: null };
}

function parse(json, seen) {
  const out = emptyStore();
  const nodes = new Map(), ways = new Map(), rels = [];
  for (const el of json.elements || []) {
    if (el.type === 'node') {
      const prev = nodes.get(el.id);
      if (!prev || (el.tags && !prev.tags)) nodes.set(el.id, el);
    } else if (el.type === 'way') {
      const prev = ways.get(el.id);
      if (!prev || (el.tags && !prev.tags)) ways.set(el.id, el);
    } else if (el.type === 'relation') rels.push(el);
  }
  const P = new Map();
  for (const [id, n] of nodes) {
    const [x, z] = project(n.lat, n.lon);
    const rec = { id, x, z, tags: n.tags || null };
    P.set(id, rec); out.nodes.set(id, rec);
  }
  const ptsOf = (ids) => { const a = []; for (const id of ids) { const p = P.get(id); if (p) a.push([p.x, p.z]); } return a; };
  const fresh = (key) => { if (seen.has(key)) return false; seen.add(key); return true; };

  for (const n of nodes.values()) {
    if (!n.tags) continue;
    const kind = POINT_KIND(n.tags);
    if (!kind || !fresh('n' + n.id)) continue;
    const p = P.get(n.id);
    out.points.push({ id: n.id, kind, x: p.x, z: p.z, tags: n.tags });
  }
  for (const w of ways.values()) {
    const t = w.tags; if (!t || !w.nodes) continue;
    const closed = w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    if (t.highway && !(t.area === 'yes' && t.highway === 'pedestrian')) {
      if (fresh('w' + w.id)) out.roads.push({ id: w.id, nodes: w.nodes.slice(), pts: ptsOf(w.nodes), tags: t, highway: t.highway });
      continue;
    }
    if ((t.building || t['building:part']) && closed) {
      if (fresh('w' + w.id)) out.buildings.push({ id: w.id, outer: ring(ptsOf(w.nodes), true), holes: [], tags: t, part: !t.building && !!t['building:part'], ...buildingInfo(t) });
      continue;
    }
    if (t.barrier) {
      if (fresh('w' + w.id)) out.barriers.push({ id: w.id, kind: t.barrier, pts: ptsOf(w.nodes), nodes: w.nodes.slice(), closed, tags: t });
      continue;
    }
    if (t.power === 'line' || t.power === 'minor_line') {
      if (fresh('w' + w.id)) out.lines.push({ id: w.id, kind: t.power, nodes: w.nodes.slice(), pts: ptsOf(w.nodes), tags: t });
      continue;
    }
    if (t.natural === 'tree_row') {
      if (fresh('w' + w.id)) out.treeRows.push({ id: w.id, pts: ptsOf(w.nodes), tags: t });
      continue;
    }
    const ak = areaKind(t);
    if (ak && closed && fresh('w' + w.id)) out.areas.push({ id: w.id, kind: ak, outer: ptsOf(w.nodes), holes: [], tags: t });
  }
  for (const r of rels) {
    const t = r.tags || {};
    if (!t.building && t.type !== 'building') continue;
    if (t.type === 'building') continue; // type=building relations only group parts that are mapped on their own
    if (!fresh('r' + r.id)) continue;
    const outer = [], inner = [];
    for (const m of r.members || []) {
      if (m.type !== 'way') continue;
      const w = ways.get(m.ref); if (!w || !w.nodes) continue;
      (m.role === 'inner' ? inner : outer).push(w.nodes);
    }
    const oRings = joinRings(outer), iRings = joinRings(inner);
    oRings.forEach((rg, i) => {
      out.buildings.push({ id: r.id * 10 + i, rel: r.id, outer: ring(ptsOf(rg), true), holes: i === 0 ? iRings.map(h => ring(ptsOf(h), false)) : [], tags: t, part: false, ...buildingInfo(t) });
    });
  }
  out.buildings = dropCoveredOutlines(out.buildings.filter(b => b.outer.length >= 3));
  return out;
}

// ---------- store ----------
export const data = emptyStore();
const seen = new Set();
const cells = new Map(); // key -> Promise

export function cellOf(x, z) { return [Math.floor(x / CELL), Math.floor(z / CELL)]; }

function mergeInto(dst, src) {
  for (const [id, n] of src.nodes) { const p = dst.nodes.get(id); if (!p || (n.tags && !p.tags)) dst.nodes.set(id, n); }
  for (const k of ['roads', 'buildings', 'barriers', 'lines', 'treeRows', 'areas', 'points']) for (const e of src[k]) dst[k].push(e);
}

export function loadCell(cx, cz) {
  const key = frame.lat.toFixed(6) + ',' + frame.lon.toFixed(6) + ':' + cx + ',' + cz;
  if (cells.has(key)) return cells.get(key);
  const pr = (async () => {
    const a = unproject(cx * CELL, (cz + 1) * CELL), b = unproject((cx + 1) * CELL, cz * CELL); // sw, ne
    const json = await overpass(query(a.lat, a.lon, b.lat, b.lon));
    const part = parse(json, seen);
    part.cx = cx; part.cz = cz;
    part.bbox = { x0: cx * CELL, z0: cz * CELL, x1: (cx + 1) * CELL, z1: (cz + 1) * CELL };
    mergeInto(data, part);
    const bb = data.bbox;
    data.bbox = bb ? { x0: Math.min(bb.x0, part.bbox.x0), z0: Math.min(bb.z0, part.bbox.z0), x1: Math.max(bb.x1, part.bbox.x1), z1: Math.max(bb.z1, part.bbox.z1) } : { ...part.bbox };
    return part;
  })();
  pr.catch(() => cells.delete(key));
  cells.set(key, pr);
  return pr;
}

// Loads every cell touching the circle (two at a time, Overpass allows few slots per address).
export async function load(lat, lon, radius = 400) {
  const [x, z] = project(lat, lon);
  const list = [];
  const c0 = cellOf(x - radius, z - radius), c1 = cellOf(x + radius, z + radius);
  for (let cz = c0[1]; cz <= c1[1]; cz++) for (let cx = c0[0]; cx <= c1[0]; cx++) {
    const nx = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL)), nz = Math.max(cz * CELL, Math.min(z, (cz + 1) * CELL));
    if (Math.hypot(nx - x, nz - z) <= radius) list.push([cx, cz, Math.hypot((cx + 0.5) * CELL - x, (cz + 0.5) * CELL - z)]);
  }
  list.sort((p, q) => p[2] - q[2]);
  let i = 0;
  const worker = async () => { while (i < list.length) { const [cx, cz] = list[i++]; await loadCell(cx, cz); } };
  await Promise.all([worker(), worker()]);
  return data;
}

export function reset() {
  const e = emptyStore();
  for (const k of Object.keys(e)) data[k] = e[k];
  seen.clear(); cells.clear();
}

export const osm = { CELL, data, load, loadCell, cellOf, reset, setFetcher };
export default osm;
