/* (W, round 11, for Leon's "make the trees actually generate correctly and reflect actual runs from the ski resort" and
   "make the rock and cliff more accurate for real ski mountains") Any mountain's land cover from OpenStreetMap (ODbL,
   (c) OpenStreetMap contributors): woods and forests, scrub, lakes, bare rock, scree, glaciers, cliffs, single trees and
   tree rows, boulders, buildings and mapped halfpipes. No imports, so the bake tool (tools/ski/bake_world_land.cjs) runs
   this same file in Node.

   The query (landQuery) asks for those in a square round the place. build(elements, toLocal, box) turns an Overpass
   answer into the land object, everything in local metres (+x east, +z south):
     wood, scrub, water, rock (bare_rock), scree, glacier: polygons, each a list of rings [{x, z}, ...] taken together
       under the even-odd rule (a multipolygon's outer and inner rings), clipped to the box and simplified;
     cliff, rows: lines [{x, z}, ...] (a cliff's low side is on its right, as OpenStreetMap draws them);
     trees, stones: points [{x, z}]; buildings: [{x, z, r}] (r: half the building's bounding box's diagonal);
     pipes: { pts, area } (man_made=piste:halfpipe).
   encode / decode keep it small for the files shipped with the site (public/ski/data/world/<preset>.json): whole metres,
   each ring's points as differences from the one before. */

export const LAND_VERSION = 1;
export const LAND_HALF = 10000;            // (the square's half side round the place, metres)

/* the Overpass query: everything above inside the box (bb: "south,west,north,east"), in three parts (the areas and
   lines with their shapes, the points, the buildings' boxes); landQuery is all three in one request */
export function landQueryParts(bb) {
  const H = '[out:json][timeout:120][maxsize:268435456];';
  return [
    H + `(way["natural"~"^(wood|scrub|tree_row|cliff|bare_rock|scree|glacier|water|rock)$"](${bb});`
      + `relation["natural"~"^(wood|scrub|bare_rock|scree|glacier|water)$"](${bb});`
      + `way["landuse"="forest"](${bb});relation["landuse"="forest"](${bb});`
      + `way["man_made"="piste:halfpipe"](${bb}););out geom qt;`,
    H + `node["natural"~"^(tree|rock|stone|cliff)$"](${bb});out qt;`,
    H + `way["building"](${bb});out ids bb qt;`,
  ];
}
export function landQuery(bb) { const [a, b, c] = landQueryParts(bb); return a + b.slice(b.indexOf(';', b.indexOf('maxsize')) + 1) + c.slice(c.indexOf(';', c.indexOf('maxsize')) + 1); }
export function bboxOf(lat, lon, half = LAND_HALF) {
  const D = 111320, c = Math.cos(lat * Math.PI / 180);
  return [lat - half / D, lon - half / (D * c), lat + half / D, lon + half / (D * c)];
}

// ---- geometry helpers ------------------------------------------------------------------------------------------------
const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
// join a multipolygon's member ways into rings (by their shared end points); a chain that does not close within 60 m is
// dropped (a relation cut off by the query), a small gap closed
function rings(ways) {
  const open = ways.filter(w => w.length > 1).map(w => w.slice()), out = [];
  while (open.length) {
    let r = open.pop();
    for (let guard = 0; guard < 4000 && !same(r[0], r[r.length - 1]); guard++) {
      const end = r[r.length - 1];
      let k = open.findIndex(w => same(w[0], end)), rev = false;
      if (k < 0) { k = open.findIndex(w => same(w[w.length - 1], end)); rev = true; }
      if (k < 0) break;
      const w = open.splice(k, 1)[0]; if (rev) w.reverse();
      r = r.concat(w.slice(1));
    }
    out.push(r);
  }
  return out;
}
// Douglas-Peucker on local points
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]], t2 = tol * tol;
  while (st.length) {
    const [a, b] = st.pop(), A = pts[a], B = pts[b], dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1e-9;
    let far = -1, fd = t2;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i]; let t = ((p.x - A.x) * dx + (p.z - A.z) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = p.x - A.x - dx * t, ez = p.z - A.z - dz * t, d = ex * ex + ez * ez;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; st.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// a ring clipped to the box (Sutherland-Hodgman against each side)
function clipRing(pts, B) {
  let out = pts;
  const sides = [[p => p.x >= B.x0, (a, b) => ({ x: B.x0, z: a.z + (b.z - a.z) * (B.x0 - a.x) / (b.x - a.x) })],
    [p => p.x <= B.x1, (a, b) => ({ x: B.x1, z: a.z + (b.z - a.z) * (B.x1 - a.x) / (b.x - a.x) })],
    [p => p.z >= B.z0, (a, b) => ({ x: a.x + (b.x - a.x) * (B.z0 - a.z) / (b.z - a.z), z: B.z0 })],
    [p => p.z <= B.z1, (a, b) => ({ x: a.x + (b.x - a.x) * (B.z1 - a.z) / (b.z - a.z), z: B.z1 })]];
  for (const [ins, cut] of sides) {
    const src = out; out = [];
    if (!src.length) break;
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], ia = ins(a), ib = ins(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
  }
  return out;
}
// a line cut to the parts inside the box (with a point either side, so it reaches the edge)
function clipLine(pts, B) {
  const inB = p => p.x >= B.x0 && p.x <= B.x1 && p.z >= B.z0 && p.z <= B.z1, out = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    if (inB(pts[i]) || (i > 0 && inB(pts[i - 1])) || (i < pts.length - 1 && inB(pts[i + 1]))) { if (!cur) out.push(cur = []); cur.push(pts[i]); }
    else cur = null;
  }
  return out.filter(l => l.length > 1);
}
const area = r => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p.x * q.z - q.x * p.z; } return a / 2; };

/* elements: an Overpass answer's elements; toLocal(lat, lon) -> {x, z}; box {x0, z0, x1, z1} in local metres */
export function build(elements, toLocal, box) {
  const L = { v: LAND_VERSION, wood: [], scrub: [], water: [], rock: [], scree: [], glacier: [], cliff: [], rows: [], trees: [], stones: [], buildings: [], pipes: [] };
  const loc = g => g.map(p => toLocal(p.lat, p.lon));
  const big = { x0: box.x0 - 50, z0: box.z0 - 50, x1: box.x1 + 50, z1: box.z1 + 50 };
  const polyOf = (geoRings, tol) => {
    const rs = [];
    for (const g of geoRings) {
      if (g.length < 4) continue;
      const closed = same(g[0], g[g.length - 1]);
      let pts = loc(closed ? g.slice(0, -1) : g);
      if (!closed) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(a.x - b.x, a.z - b.z) > 60) continue; }
      // (nothing of it in the box: left out)
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
      if (x1 < big.x0 || x0 > big.x1 || z1 < big.z0 || z0 > big.z1) continue;
      if (x0 < big.x0 || x1 > big.x1 || z0 < big.z0 || z1 > big.z1) pts = clipRing(pts, big);
      pts = simplify(pts.concat([pts[0]]), tol).slice(0, -1);
      if (pts.length >= 3 && Math.abs(area(pts)) > 30) rs.push(pts);
    }
    return rs;
  };
  const TOL = { wood: 4, scrub: 4, water: 5, rock: 4, scree: 5, glacier: 5 };   // (how far a simplified outline may stray, m)
  const KIND = { wood: 'wood', forest: 'wood', scrub: 'scrub', water: 'water', bare_rock: 'rock', scree: 'scree', glacier: 'glacier', rock: 'rock' };
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node') {
      if (el.lat == null) continue;
      const p = toLocal(el.lat, el.lon);
      if (p.x < box.x0 || p.x > box.x1 || p.z < box.z0 || p.z > box.z1) continue;
      if (t.natural === 'tree') L.trees.push(p);
      else if (t.natural) L.stones.push(p);
      continue;
    }
    if (el.type === 'way' && el.bounds && !el.geometry) {       // (a building: its box)
      const a = toLocal(el.bounds.minlat, el.bounds.minlon), b = toLocal(el.bounds.maxlat, el.bounds.maxlon);
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) continue;
      L.buildings.push({ x, z, r: Math.min(80, Math.max(3, Math.hypot(b.x - a.x, b.z - a.z) / 2)) });
      continue;
    }
    const kind = t.man_made === 'piste:halfpipe' ? 'pipe' : t.landuse === 'forest' ? 'wood' : t.natural === 'cliff' ? 'cliff' : t.natural === 'tree_row' ? 'rows' : KIND[t.natural];
    if (!kind) continue;
    if (el.type === 'way') {
      const g = el.geometry; if (!g || g.length < 2) continue;
      if (kind === 'cliff' || kind === 'rows') { for (const l of clipLine(loc(g), box)) L[kind].push(simplify(l, 1.5)); continue; }
      if (kind === 'pipe') { L.pipes.push({ pts: loc(g), area: g.length > 3 && same(g[0], g[g.length - 1]) }); continue; }
      if (!same(g[0], g[g.length - 1])) continue;                 // (an open way is no area)
      const rs = polyOf([g], TOL[kind] || 4); if (rs.length) L[kind].push(rs);
    } else if (el.type === 'relation' && el.members) {
      const ways = el.members.filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === '')).map(m => m.geometry.filter(p => p && p.lat != null));
      const rs = polyOf(rings(ways), TOL[kind] || 4); if (rs.length) L[kind].push(rs);
    }
  }
  return trim(L, box);
}

/* keeping it small: woods and scrub under 200 square metres left out, outlines simplified again (7 m) where a place has
   very many points, and only the buildings within 40 m of a wood or scrub (those are the clearings that matter) */
export function trim(L, box) {
  const ringsArea = rs => Math.abs(rs.reduce((s, r) => s + area(r), 0));
  for (const k of ['wood', 'scrub']) L[k] = L[k].filter(rs => ringsArea(rs) >= 200);
  const pts = L.wood.reduce((n, rs) => n + rs.reduce((m, r) => m + r.length, 0), 0);
  if (pts > 60000) for (const k of ['wood', 'scrub']) L[k] = L[k].map(rs => rs.map(r => simplify(r.concat([r[0]]), 7).slice(0, -1)).filter(r => r.length >= 3)).filter(rs => rs.length);
  // a 20 m raster of the woods (each polygon even-odd at the cells' middles), grown by 2 cells
  const C = 20, nx = Math.ceil((box.x1 - box.x0) / C), nz = Math.ceil((box.z1 - box.z0) / C), g = new Uint8Array(nx * nz);
  for (const rs of [...L.wood, ...L.scrub]) {
    let z0 = Infinity, z1 = -Infinity; for (const r of rs) for (const p of r) { if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
    const j0 = Math.max(0, Math.floor((z0 - box.z0) / C)), j1 = Math.min(nz - 1, Math.floor((z1 - box.z0) / C));
    for (let j = j0; j <= j1; j++) {
      const z = box.z0 + (j + 0.5) * C, xs = [];
      for (const r of rs) for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; if ((a.z <= z) !== (b.z <= z)) xs.push(a.x + (z - a.z) / (b.z - a.z) * (b.x - a.x)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - box.x0) / C - 0.5)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - box.x0) / C - 0.5)); i++) g[j * nx + i] = 1;
    }
  }
  const near = (x, z) => { const i0 = Math.floor((x - box.x0) / C), j0 = Math.floor((z - box.z0) / C); for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) if (i >= 0 && j >= 0 && i < nx && j < nz && g[j * nx + i]) return true; return false; };
  L.buildings = L.buildings.filter(b => near(b.x, b.z));
  return L;
}

// ---- small files: whole metres, each ring as differences ------------------------------------------------------------
const encLine = pts => { const o = []; let px = 0, pz = 0; for (const p of pts) { const x = Math.round(p.x), z = Math.round(p.z); o.push(x - px, z - pz); px = x; pz = z; } return o; };
const decLine = a => { const o = []; let x = 0, z = 0; for (let i = 0; i + 1 < a.length; i += 2) { x += a[i]; z += a[i + 1]; o.push({ x, z }); } return o; };
const POLYS = ['wood', 'scrub', 'water', 'rock', 'scree', 'glacier'];
export function encode(L, origin, extra = {}) {
  const o = Object.assign({ v: LAND_VERSION, o: origin, half: LAND_HALF, src: 'OpenStreetMap contributors, ODbL' }, extra);
  for (const k of POLYS) o[k] = L[k].map(rs => rs.map(encLine));
  o.cliff = L.cliff.map(encLine); o.rows = L.rows.map(encLine);
  o.trees = encLine(L.trees); o.stones = encLine(L.stones);
  o.bv = 2; o.buildings = []; { let px = 0, pz = 0; for (const b of L.buildings.slice().sort((a, b) => a.z - b.z || a.x - b.x)) { const x = Math.round(b.x), z = Math.round(b.z); o.buildings.push(x - px, z - pz, Math.round(b.r)); px = x; pz = z; } }
  o.pipes = L.pipes.map(p => ({ a: p.area ? 1 : 0, p: encLine(p.pts) }));
  return o;
}
/* the file back into the land object; shift(x, z) -> {x, z} turns the file's local metres (round its own origin, o) into
   this page's (the same origin for a built-in place: no shift) */
export function decode(o, shift = null) {
  const sh = shift ? (p => shift(p.x, p.z)) : (p => p);
  const L = { v: o.v, from: 'site' };
  for (const k of POLYS) L[k] = (o[k] || []).map(rs => rs.map(r => decLine(r).map(sh)));
  L.cliff = (o.cliff || []).map(l => decLine(l).map(sh)); L.rows = (o.rows || []).map(l => decLine(l).map(sh));
  L.trees = decLine(o.trees || []).map(sh); L.stones = decLine(o.stones || []).map(sh);
  L.buildings = []; { const b = o.buildings || []; let x = 0, z = 0; for (let i = 0; i + 2 < b.length; i += 3) { if (o.bv === 2) { x += b[i]; z += b[i + 1]; } else { x = b[i]; z = b[i + 1]; } const p = sh({ x, z }); L.buildings.push({ x: p.x, z: p.z, r: b[i + 2] }); } }
  L.pipes = (o.pipes || []).map(p => ({ area: !!p.a, pts: decLine(p.p).map(sh) }));
  return L;
}
// how much of each there is (for the notes and the tests)
export function landStats(L) {
  const s = {};
  for (const k of POLYS) { s[k] = L[k].length; s[k + 'Pts'] = L[k].reduce((n, rs) => n + rs.reduce((m, r) => m + r.length, 0), 0); }
  for (const k of ['cliff', 'rows', 'trees', 'stones', 'buildings', 'pipes']) s[k] = L[k].length;
  return s;
}
