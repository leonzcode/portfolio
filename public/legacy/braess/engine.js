'use strict';
/* =====================================================================
 * Braess's Paradox simulator: the computing half (no page, no map).
 *
 * Runs in three places with the same code: the page's own thread (when
 * workers are not allowed, e.g. opened from a file), Web Workers (the
 * closure tests run in parallel, one network copy a worker), and Node
 * (tests and the world scan).
 *
 * The model is the original simulator's, unchanged in what it computes:
 *  - roads from OpenStreetMap, split at junctions, largest strongly
 *    connected component;
 *  - trip ends from real land use on a grid anchored to geography,
 *    time-of-day volume and direction, gateways for through traffic;
 *  - Wardrop user equilibrium by conjugate Frank-Wolfe with BPR delays;
 *  - a road is a Braess road when closing it lowers total travel time,
 *    or speeds some OD pair by 1.5% or more without hurting the network.
 *
 * What is faster, with the same answers:
 *  - the shortest-path search marks labels by generation instead of
 *    clearing the whole distance array before every search;
 *  - the line search is a safeguarded Newton solve of the same equation
 *    the bisection solved (5 or so evaluations instead of 25, over only
 *    the links whose flow changes, and to a tighter tolerance);
 *  - closure tests are independent, so the page runs them on every core;
 *  - the scan tests a fixed number of the best candidates, so results no
 *    longer depend on how fast the visitor's computer is.
 * ===================================================================== */
(function (root) {

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function havKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
}
function flatKm(lat1, lon1, lat2, lon2) {
  const kx = Math.cos(lat1 * D2R) * 111.32, ky = 110.57;
  const dx = (lon2 - lon1) * kx, dy = (lat2 - lat1) * ky;
  return Math.sqrt(dx * dx + dy * dy);
}

/* --------------------------- traffic model --------------------------- */
// per class: free-flow speed km/h, capacity veh/h a lane, lanes a direction, drawn width
const ROAD = {
  motorway:       { s: 100, c: 1900, l: 2,   w: 5   },
  trunk:          { s: 80,  c: 1700, l: 2,   w: 4.5 },
  primary:        { s: 60,  c: 1000, l: 1.5, w: 4   },
  secondary:      { s: 50,  c: 850,  l: 1,   w: 3.5 },
  tertiary:       { s: 40,  c: 700,  l: 1,   w: 3   },
  unclassified:   { s: 40,  c: 600,  l: 1,   w: 2.5 },
  residential:    { s: 30,  c: 500,  l: 1,   w: 2.5 },
  living_street:  { s: 15,  c: 300,  l: 1,   w: 2   },
  motorway_link:  { s: 60,  c: 1500, l: 1,   w: 3   },
  trunk_link:     { s: 50,  c: 1200, l: 1,   w: 3   },
  primary_link:   { s: 45,  c: 900,  l: 1,   w: 3   },
  secondary_link: { s: 40,  c: 700,  l: 1,   w: 2.5 },
  tertiary_link:  { s: 35,  c: 600,  l: 1,   w: 2.5 },
};
const PROFILE = {
  wd: [0.10, 0.07, 0.05, 0.05, 0.08, 0.20, 0.50, 0.85, 1.00, 0.80, 0.65, 0.62,
       0.65, 0.66, 0.70, 0.80, 0.92, 1.00, 0.88, 0.62, 0.45, 0.35, 0.25, 0.15],
  we: [0.18, 0.12, 0.08, 0.05, 0.05, 0.08, 0.15, 0.25, 0.40, 0.55, 0.70, 0.80,
       0.85, 0.85, 0.82, 0.78, 0.75, 0.72, 0.68, 0.60, 0.50, 0.40, 0.30, 0.22],
};
function demandFactor(hour, prof) {
  const h0 = Math.floor(hour) % 24, h1 = (h0 + 1) % 24, f = hour - Math.floor(hour);
  return PROFILE[prof][h0] * (1 - f) + PROFILE[prof][h1] * f;
}
// +1 = morning pattern (homes produce, jobs attract), -1 = evening reverse
function dirFactor(hour, prof) {
  const am = Math.exp(-(((hour - 8.25) / 1.8) ** 2));
  const pm = Math.exp(-(((hour - 17.5) / 2.1) ** 2));
  return clamp((prof === 'we' ? 0.25 : 0.85) * (am - pm), -0.9, 0.9);
}
function parseMaxspeed(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase();
  if (s === 'none') return 130;
  if (s === 'walk') return 7;
  const v = parseFloat(s);
  if (!isFinite(v) || v <= 0) return null;
  return /mph/.test(s) ? v * 1.60934 : v;
}

/* --------------------------- Overpass queries ------------------------ */
function bboxOf(center, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(center.lat * D2R));
  return [center.lat - dLat, center.lng - dLon, center.lat + dLat, center.lng + dLon].map(v => v.toFixed(6)).join(',');
}
function roadsQuery(center, radiusM) {
  return `[out:json][timeout:60];way["highway"~"^(${Object.keys(ROAD).join('|')})$"]` +
    `(${bboxOf(center, radiusM)});(._;>;);out body;`;
}
const ACT_AMENITY = 'restaurant|cafe|fast_food|bar|pub|bank|pharmacy|school|college' +
  '|university|hospital|clinic|library|cinema|theatre|marketplace|townhall|post_office';
function activityQuery(center, radiusM) {
  const bb = bboxOf(center, radiusM);
  return `[out:json][timeout:60];(
node["shop"](${bb});
node["office"](${bb});
node["amenity"~"^(${ACT_AMENITY})$"](${bb});
way["building"~"^(office|commercial|retail|industrial|warehouse|supermarket)$"](${bb});
way["landuse"~"^(commercial|retail|industrial)$"](${bb});
);out center;`;
}
function activityWeight(t) {
  if (t.landuse) return t.landuse === 'industrial' ? 6 : 12;
  if (t.building) {
    if (t.building === 'office' || t.building === 'commercial') return 6;
    if (t.building === 'retail' || t.building === 'supermarket') return 5;
    return 3;
  }
  if (t.office) return 2;
  if (t.amenity) return /^(school|college|university|hospital)$/.test(t.amenity) ? 4 : 1.2;
  return 1;
}
function parseActivity(j) {
  const acts = [];
  for (const el of j.elements) {
    const la = el.lat !== undefined ? el.lat : el.center && el.center.lat;
    const lo = el.lon !== undefined ? el.lon : el.center && el.center.lon;
    if (la === undefined || lo === undefined || !el.tags) continue;
    acts.push({ lat: la, lon: lo, w: activityWeight(el.tags) });
  }
  return acts;
}

/* A popular place's bundled data/<id>.json: nodes as a flat [lat, lon, ...]
   list (a node's id is its position), ways as [node positions, tags], land
   use as a flat [lat, lon, weight, ...] list. Back to Overpass's form. */
function unpackData(j) {
  if (!j || j.v !== 2) return j;
  const elements = [];
  for (let i = 0; i < j.nodes.length; i += 2) elements.push({ type: 'node', id: i / 2, lat: j.nodes[i], lon: j.nodes[i + 1] });
  j.ways.forEach((w, k) => elements.push({ type: 'way', id: k, nodes: w[0], tags: w[1] }));
  const acts = [];
  for (let i = 0; i < j.acts.length; i += 3) acts.push({ lat: j.acts[i], lon: j.acts[i + 1], w: j.acts[i + 2] });
  return { roads: { elements }, acts };
}

/* -------------------------- graph construction ----------------------- */
function buildNetwork(osm) {
  const nodesRaw = new Map();
  const ways = [];
  for (const el of osm.elements) {
    if (el.type === 'node') nodesRaw.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.tags && ROAD[el.tags.highway]) ways.push(el);
  }
  if (!ways.length) throw new Error('No drivable roads found here. Pick another spot.');
  const use = new Map();
  for (const w of ways) {
    w._nds = w.nodes.filter(id => nodesRaw.has(id));
    for (const id of w._nds) use.set(id, (use.get(id) || 0) + 1);
  }
  const segs = [];
  for (const w of ways) {
    const nds = w._nds;
    if (nds.length < 2) continue;
    const t = w.tags, road = ROAD[t.highway];
    let oneway = 0;
    if (t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true') oneway = 1;
    else if (t.oneway === '-1') oneway = -1;
    else if (t.junction === 'roundabout' || t.junction === 'circular') oneway = 1;
    else if ((t.highway === 'motorway' || t.highway === 'motorway_link') && t.oneway !== 'no') oneway = 1;
    const speed = parseMaxspeed(t.maxspeed) || road.s;
    let lanes = parseFloat(t.lanes);
    if (!isFinite(lanes) || lanes <= 0) lanes = null;
    const lanesPerDir = lanes ? (oneway !== 0 ? lanes : Math.max(1, lanes / 2)) : road.l;
    const cap = Math.max(200, road.c * lanesPerDir);
    const name = t.name || t.ref || ('unnamed ' + t.highway.replace('_', ' '));
    let start = 0;
    for (let i = 1; i < nds.length; i++) {
      const cut = (i === nds.length - 1) || (use.get(nds[i]) > 1);
      if (!cut) continue;
      const ids = nds.slice(start, i + 1);
      const pts = ids.map(id => nodesRaw.get(id));
      const cum = [0];
      let lenM = 0;
      for (let j = 1; j < pts.length; j++) {
        lenM += havKm(pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) * 1000;
        cum.push(lenM);
      }
      lenM = Math.max(lenM, 1);
      segs.push({ a: ids[0], b: ids[ids.length - 1], pts, cum, lenM, name, hw: t.highway, speed, cap, oneway, w: road.w, active: false, edges: [] });
      start = i;
    }
  }
  const rawIdx = new Map(), rawLat = [], rawLon = [];
  const idxOf = id => {
    let i = rawIdx.get(id);
    if (i === undefined) { i = rawLat.length; rawIdx.set(id, i); const p = nodesRaw.get(id); rawLat.push(p[0]); rawLon.push(p[1]); }
    return i;
  };
  const rawEdges = [];
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    const u = idxOf(s.a), v = idxOf(s.b);
    if (u === v) continue;
    if (s.oneway >= 0) rawEdges.push({ u, v, si, fwd: 1 });
    if (s.oneway <= 0) rawEdges.push({ u: v, v: u, si, fwd: 0 });
  }
  const nRaw = rawLat.length;
  if (nRaw < 10) throw new Error('Road network too small. Try a larger radius.');
  // largest strongly connected component (iterative Kosaraju)
  const outAdj = Array.from({ length: nRaw }, () => []), inAdj = Array.from({ length: nRaw }, () => []);
  for (const e of rawEdges) { outAdj[e.u].push(e.v); inAdj[e.v].push(e.u); }
  const order = [], vis = new Uint8Array(nRaw), stk = [], it = [];
  for (let s0 = 0; s0 < nRaw; s0++) {
    if (vis[s0]) continue;
    stk.push(s0); it.push(0); vis[s0] = 1;
    while (stk.length) {
      const v = stk[stk.length - 1];
      if (it[it.length - 1] < outAdj[v].length) {
        const u = outAdj[v][it[it.length - 1]++];
        if (!vis[u]) { vis[u] = 1; stk.push(u); it.push(0); }
      } else { order.push(v); stk.pop(); it.pop(); }
    }
  }
  const comp = new Int32Array(nRaw).fill(-1);
  let nc = 0, bestC = -1, bestSize = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const s0 = order[i];
    if (comp[s0] >= 0) continue;
    let size = 0;
    const st2 = [s0]; comp[s0] = nc;
    while (st2.length) { const v = st2.pop(); size++; for (const u of inAdj[v]) if (comp[u] < 0) { comp[u] = nc; st2.push(u); } }
    if (size > bestSize) { bestSize = size; bestC = nc; }
    nc++;
  }
  if (bestSize < 25) throw new Error('Connected road network too small. Try a larger radius.');
  const newIdx = new Int32Array(nRaw).fill(-1);
  let n = 0;
  for (let i = 0; i < nRaw; i++) if (comp[i] === bestC) newIdx[i] = n++;
  const lat = new Float64Array(n), lon = new Float64Array(n);
  for (let i = 0; i < nRaw; i++) if (newIdx[i] >= 0) { lat[newIdx[i]] = rawLat[i]; lon[newIdx[i]] = rawLon[i]; }
  const kept = rawEdges.filter(e => newIdx[e.u] >= 0 && newIdx[e.v] >= 0);
  const m = kept.length;
  const eFrom = new Int32Array(m), eTo = new Int32Array(m), eSeg = new Int32Array(m), eFwd = new Uint8Array(m);
  const eT0 = new Float64Array(m), eCap = new Float64Array(m), eLen = new Float64Array(m);
  kept.forEach((e, i) => {
    const s = segs[e.si];
    eFrom[i] = newIdx[e.u]; eTo[i] = newIdx[e.v]; eSeg[i] = e.si; eFwd[i] = e.fwd;
    eLen[i] = s.lenM / 1000;
    eT0[i] = Math.max(1e-6, eLen[i] / s.speed);
    eCap[i] = s.cap;
    s.active = true; s.edges.push(i);
  });
  const net = { n, m, lat, lon, eFrom, eTo, eSeg, eFwd, eT0, eCap, eLen, segs };
  finishCore(net);
  let cLat = 0, cLon = 0;
  for (let i = 0; i < n; i++) { cLat += lat[i]; cLon += lon[i]; }
  net.cLat = cLat / n; net.cLon = cLon / n;
  return net;
}
// the adjacency and the search's scratch memory (also rebuilt in a worker from the shared arrays)
function finishCore(net) {
  const { n, m, eFrom } = net;
  if (!net.adjStart) {
    const adjStart = new Int32Array(n + 1), adjEdge = new Int32Array(m);
    for (let i = 0; i < m; i++) adjStart[eFrom[i] + 1]++;
    for (let i = 0; i < n; i++) adjStart[i + 1] += adjStart[i];
    const fill = adjStart.slice(0, n);
    for (let i = 0; i < m; i++) adjEdge[fill[eFrom[i]]++] = i;
    net.adjStart = adjStart; net.adjEdge = adjEdge;
  }
  net.dist = new Float64Array(n); net.pred = new Int32Array(n);
  net.seen = new Int32Array(n); net.settled = new Int32Array(n); net.isTarget = new Int32Array(n);
  net.gen = 0; net.tgtGen = 0;
  net.heap = new MinHeap(Math.max(1024, m + 8));
  net.costWk = new Float64Array(m);
  return net;
}
// the part of a network the solver needs, as plain typed arrays (sent to workers)
function coreOf(net) {
  return { n: net.n, m: net.m, eFrom: net.eFrom, eTo: net.eTo, eT0: net.eT0, eCap: net.eCap, adjStart: net.adjStart, adjEdge: net.adjEdge };
}

/* -------------- demand model: land use on an anchored grid ------------ */
const CELL_LADDER = [500, 1000, 2000, 4000, 8000];
const RES_W = { residential: 1, living_street: 1, unclassified: 0.6, tertiary: 0.3,
  secondary: 0.12, secondary_link: 0.12, primary: 0.06, primary_link: 0.06,
  trunk: 0.02, trunk_link: 0.02, motorway: 0, motorway_link: 0 };
const GATE_W = { motorway: 3, trunk: 2.4, primary: 1.5, secondary: 0.9 };
function cellKeyOf(latV, lonV, dKm) {
  let c = CELL_LADDER[CELL_LADDER.length - 1];
  for (const s of CELL_LADDER) if (dKm * 1000 <= 2 * s) { c = s; break; }
  const kx = 111320 * Math.cos(Math.round(latV) * D2R);
  return c + ':' + Math.floor(latV * 110570 / c) + ':' + Math.floor(lonV * kx / c);
}
function nodeGridOf(net) {
  if (net.grid) return net.grid;
  const { n, lat, lon } = net;
  const kx = Math.cos(net.cLat * D2R) * 111.32, ky = 110.57;
  let lat0 = Infinity, lat1 = -Infinity, lon0 = Infinity, lon1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (lat[i] < lat0) lat0 = lat[i];
    if (lat[i] > lat1) lat1 = lat[i];
    if (lon[i] < lon0) lon0 = lon[i];
    if (lon[i] > lon1) lon1 = lon[i];
  }
  const wKm = Math.max((lon1 - lon0) * kx, 1e-3), hKm = Math.max((lat1 - lat0) * ky, 1e-3);
  const cell = Math.max(Math.sqrt(wKm * hKm / n), 0.03);
  const nx = Math.ceil(wKm / cell), ny = Math.ceil(hKm / cell);
  const cellOf = i => {
    const cx = Math.min(nx - 1, Math.floor((lon[i] - lon0) * kx / cell));
    const cy = Math.min(ny - 1, Math.floor((lat[i] - lat0) * ky / cell));
    return cy * nx + cx;
  };
  const start = new Int32Array(nx * ny + 1);
  for (let i = 0; i < n; i++) start[cellOf(i) + 1]++;
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const items = new Int32Array(n), fill = start.slice(0, nx * ny);
  for (let i = 0; i < n; i++) items[fill[cellOf(i)]++] = i;
  return net.grid = { kx, ky, lat0, lon0, cell, nx, ny, start, items };
}
function nearestNode(net, qLat, qLon) {
  const g = nodeGridOf(net), { lat, lon } = net;
  const cx = clamp(Math.floor((qLon - g.lon0) * g.kx / g.cell), 0, g.nx - 1);
  const cy = clamp(Math.floor((qLat - g.lat0) * g.ky / g.cell), 0, g.ny - 1);
  let bi = -1, bd = Infinity;
  const rMax = Math.max(g.nx, g.ny);
  for (let r = 0; r <= rMax; r++) {
    if (bi >= 0 && (r - 1) * g.cell > bd * 1.1) break;
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= g.ny) continue;
      const step = (y === cy - r || y === cy + r) ? 1 : 2 * r;
      for (let x = cx - r; x <= cx + r; x += step) {
        if (x < 0 || x >= g.nx) continue;
        const c = y * g.nx + x;
        for (let k = g.start[c]; k < g.start[c + 1]; k++) {
          const i = g.items[k];
          const dd = flatKm(lat[i], lon[i], qLat, qLon);
          if (dd < bd || (dd === bd && i < bi)) { bd = dd; bi = i; }
        }
      }
    }
  }
  return bi;
}
function buildDemandModel(net, center, radiusM, acts) {
  const { n, lat, lon, segs } = net;
  const cells = new Map(), nodeCell = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = nodeCell[i] = cellKeyOf(lat[i], lon[i], flatKm(lat[i], lon[i], center.lat, center.lng));
    let cl = cells.get(k);
    if (!cl) cells.set(k, cl = { latS: 0, lonS: 0, cnt: 0, P: 0, A: 0 });
    cl.latS += lat[i]; cl.lonS += lon[i]; cl.cnt++;
  }
  for (const s of segs) {
    if (!s.active) continue;
    const w = (RES_W[s.hw] !== undefined ? RES_W[s.hw] : 0.1) * s.lenM / 2000;
    if (w <= 0) continue;
    const e0 = s.edges[0];
    cells.get(nodeCell[net.eFrom[e0]]).P += w;
    cells.get(nodeCell[net.eTo[e0]]).P += w;
  }
  let nAct = 0;
  if (acts) for (const a of acts) {
    const d = flatKm(a.lat, a.lon, center.lat, center.lng);
    if (d * 1000 > radiusM * 1.05) continue;
    const cl = cells.get(cellKeyOf(a.lat, a.lon, d));
    if (cl) { cl.A += a.w; nAct++; }
  }
  let zl = [...cells.values()].map(cl => ({ cLat: cl.latS / cl.cnt, cLon: cl.lonS / cl.cnt, P: cl.P, A: cl.A + 0.25 * cl.P }))
    .filter(z => z.P + z.A > 1e-9);
  zl.sort((a, b) => (b.P + b.A) - (a.P + a.A));
  const MAXZ = 32;
  if (zl.length > MAXZ) {
    const keep = zl.slice(0, MAXZ);
    for (const d of zl.slice(MAXZ)) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < keep.length; i++) {
        const dd = flatKm(d.cLat, d.cLon, keep[i].cLat, keep[i].cLon);
        if (dd < bd) { bd = dd; bi = i; }
      }
      keep[bi].P += d.P; keep[bi].A += d.A;
    }
    zl = keep;
  }
  for (const z of zl) z.node = nearestNode(net, z.cLat, z.cLon);
  const gw = [];
  for (const s of segs) {
    if (!s.active || GATE_W[s.hw] === undefined) continue;
    const e0 = s.edges[0];
    for (const nd of [net.eFrom[e0], net.eTo[e0]]) {
      const d = flatKm(lat[nd], lon[nd], center.lat, center.lng);
      if (d * 1000 < radiusM * 0.86) continue;
      gw.push({ node: nd, w: GATE_W[s.hw] * s.cap / 1000, ang: Math.atan2(lat[nd] - center.lat, (lon[nd] - center.lng) * Math.cos(center.lat * D2R)) });
    }
  }
  gw.sort((a, b) => b.w - a.w);
  const gates = [];
  for (const g of gw) {
    const near = gates.find(h => { let da = Math.abs(h.ang - g.ang); if (da > Math.PI) da = 2 * Math.PI - da; return da < 0.3; });
    if (near) near.w += 0.3 * g.w;
    else if (gates.length < 10) gates.push({ node: g.node, w: g.w, ang: g.ang });
  }
  net.dz = { zones: zl, gates, nAct, hasAct: !!acts, radiusM };
}
// the OD matrix for a time of day, and the demand unit's calibration
function buildOD(net, hour, prof) {
  const { zones, gates, radiusM } = net.dz;
  const dir = dirFactor(hour, prof);
  const zs = new Map();
  const addEnd = (node, O, D, ext) => {
    let z = zs.get(node);
    if (!z) zs.set(node, z = { node, lat: net.lat[node], lon: net.lon[node], O: 0, D: 0, ext });
    z.O += O; z.D += D; z.ext = z.ext && ext;
  };
  for (const z of zones) addEnd(z.node, z.P * (1 + dir) / 2 + z.A * (1 - dir) / 2, z.A * (1 + dir) / 2 + z.P * (1 - dir) / 2, false);
  let intO = 0;
  for (const z of zs.values()) intO += z.O;
  let gwSum = 0;
  for (const g of gates) gwSum += g.w;
  const extShare = clamp(0.62 - 0.35 * radiusM / 10000, 0.22, 0.6);
  const gScale = gwSum > 0 ? (extShare / (1 - extShare)) * intO / gwSum : 0;
  for (const g of gates) addEnd(g.node, g.w * gScale, g.w * gScale, true);
  const list = [...zs.values()];
  const odOrigins = [];
  let numOD = 0;
  for (const o of list) {
    const dests = [], ws = [];
    for (const d of list) {
      if (d.node === o.node) continue;
      const dist = Math.max(flatKm(o.lat, o.lon, d.lat, d.lon), 0.3);
      let w;
      if (o.ext && d.ext) w = dist < 0.8 ? 0 : 0.85 * o.O * d.D;
      else if (o.ext || d.ext) w = o.O * d.D * Math.exp(-dist / 10);
      else w = o.O * d.D * Math.exp(-dist / 4);
      if (w <= 1e-12) continue;
      dests.push(d.node); ws.push(w);
    }
    if (dests.length) { odOrigins.push({ o: o.node, dests: Int32Array.from(dests), ws: Float64Array.from(ws) }); numOD += dests.length; }
  }
  let wSum = 0;
  for (const g of odOrigins) for (const w of g.ws) wSum += w;
  const f = numOD / Math.max(wSum, 1e-12);
  for (const g of odOrigins) for (let j = 0; j < g.ws.length; j++) g.ws[j] *= f;
  net.odOrigins = odOrigins;
  net.numOD = numOD;
  const unitFlow = new Float64Array(net.m);
  aon(net, net.eT0, null, 1, unitFlow);
  let rMax = 0;
  const used = [];
  for (let i = 0; i < net.m; i++) {
    const vc = unitFlow[i] / net.eCap[i];
    if (vc > 0) used.push(vc);
    if (vc > rMax) rMax = vc;
  }
  used.sort((a, b) => a - b);
  const p85 = used.length ? used[Math.floor(used.length * 0.85)] : rMax;
  net.unitRefVC = Math.max(p85, rMax / 3, 1e-9);
}

/* --------------------- shortest paths & assignment ------------------- */
class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) {
      const k2 = new Float64Array(this.n * 2), v2 = new Int32Array(this.n * 2);
      k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2;
    }
    const k = this.k, v = this.v;
    let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, val = v[0];
    const n = --this.n;
    if (n > 0) {
      const key = k[n], kv = v[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        let c = l;
        const r = l + 1;
        if (r < n && k[r] < k[l]) c = r;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = key; v[i] = kv;
    }
    return val;
  }
}
/* Targeted Dijkstra. dist[v] counts only when seen[v] === gen (an unseen
   node is at Infinity), and it is final once settled[v] === gen, so no
   array is cleared between searches. The search stops once every target
   is settled: every node on a shortest path to a settled target was
   settled before it, so what the callers read is what a full run gives.
   Closed links carry cost Infinity, which never relaxes a label. */
function dijkstra(net, src, cost, targets) {
  const { dist, pred, seen, settled, heap, adjStart, adjEdge, eTo } = net;
  const gen = ++net.gen;
  let isTarget = null, tgtGen = 0, waiting = 0;
  if (targets) {
    isTarget = net.isTarget; tgtGen = ++net.tgtGen;
    for (let j = 0; j < targets.length; j++) { const d = targets[j]; if (isTarget[d] !== tgtGen) { isTarget[d] = tgtGen; waiting++; } }
  }
  heap.clear();
  dist[src] = 0; pred[src] = -1; seen[src] = gen;
  heap.push(0, src);
  while (heap.n) {
    const v = heap.pop();
    if (settled[v] === gen) continue;
    settled[v] = gen;
    if (waiting && isTarget[v] === tgtGen && --waiting === 0) break;
    const dv = dist[v];
    for (let i = adjStart[v], end = adjStart[v + 1]; i < end; i++) {
      const e = adjEdge[i];
      const u = eTo[e], nd = dv + cost[e];
      if (nd < (seen[u] === gen ? dist[u] : Infinity)) { dist[u] = nd; pred[u] = e; seen[u] = gen; heap.push(nd, u); }
    }
  }
}
// all-or-nothing assignment; false if some OD pair cannot be reached
function aon(net, cost, enabled, demand, flows) {
  flows.fill(0);
  const { pred, eFrom, m } = net;
  let cw = cost;
  if (enabled) {
    cw = net.costWk;
    for (let e = 0; e < m; e++) cw[e] = enabled[e] ? cost[e] : Infinity;
  }
  for (const { o, dests, ws } of net.odOrigins) {
    dijkstra(net, o, cw, dests);
    for (let j = 0; j < dests.length; j++) {
      const d = dests[j];
      if (net.settled[d] !== net.gen) return false;
      const dem = demand * (ws ? ws[j] : 1);
      let v = d, guard = m + 5;
      while (v !== o && guard-- > 0) { const e = pred[v]; flows[e] += dem; v = eFrom[e]; }
      if (guard <= 0) return false;
    }
  }
  return true;
}
// beta 0.15: the BPR travel time; 0.75: the marginal social cost (system optimum)
function linkCosts(net, flows, out, beta) {
  const b = beta === undefined ? 0.15 : beta;
  const { m, eT0, eCap } = net;
  for (let e = 0; e < m; e++) { const r = flows[e] / eCap[e], r2 = r * r; out[e] = eT0[e] * (1 + b * r2 * r2); }
}
function tstt(net, flows) {
  const { m, eT0, eCap } = net;
  let s = 0;
  for (let e = 0; e < m; e++) { const r = flows[e] / eCap[e], r2 = r * r; s += flows[e] * eT0[e] * (1 + 0.15 * r2 * r2); }
  return s;
}
// every OD pair's equilibrium travel time (shortest path under the congested costs)
function odTimes(net, flows, enabled) {
  const c = new Float64Array(net.m);
  linkCosts(net, flows, c);
  if (enabled) for (let e = 0; e < net.m; e++) if (!enabled[e]) c[e] = Infinity;
  const out = [];
  for (const g of net.odOrigins) {
    dijkstra(net, g.o, c, g.dests);
    const row = new Float64Array(g.dests.length);
    for (let j = 0; j < g.dests.length; j++) row[j] = net.settled[g.dests[j]] === net.gen ? net.dist[g.dests[j]] : Infinity;
    out.push(row);
  }
  return out;
}

/* Conjugate Frank-Wolfe (Mitradjieva & Lindberg 2013), the same fixed point
   and the same stopping rule (relative gap against the all-or-nothing best
   response) as the original. The step solves dObj/dlam = 0 on [0, 1] by
   Newton's method kept inside a shrinking bracket. x0 (optional) carries on
   from an earlier solve's flows instead of starting from an all-or-nothing
   assignment. Returns { flows, gap, iters } or null if a closure disconnects
   an OD pair. */
function equilibrium(net, demand, enabled, maxIter, gapTol, beta, warmCost, x0) {
  const b = beta === undefined ? 0.15 : beta;
  const m = net.m, eT0 = net.eT0, eCap = net.eCap;
  const x = new Float64Array(m), y = new Float64Array(m), s = new Float64Array(m), sPrev = new Float64Array(m), cost = new Float64Array(m);
  const act = new Int32Array(m), dlt = new Float64Array(m);
  if (x0) x.set(x0);
  else if (!aon(net, warmCost || eT0, enabled, demand, x)) return null;
  let gap = 1, iters = 0, haveS = false;
  for (let k = 0; k < maxIter; k++) {
    iters = k + 1;
    linkCosts(net, x, cost, b);
    if (!aon(net, cost, enabled, demand, y)) return null;
    let cx = 0, cy = 0;
    for (let e = 0; e < m; e++) { cx += x[e] * cost[e]; cy += y[e] * cost[e]; }
    gap = (cx - cy) / Math.max(cx, 1e-12);
    if (gap <= gapTol) break;
    if (haveS) {
      let N = 0, D = 0;
      for (let e = 0; e < m; e++) {
        const dp = sPrev[e] - x[e];
        if (dp === 0) continue;
        const r = x[e] / eCap[e];
        const H = eT0[e] * 4 * b * r * r * r / eCap[e];
        N += dp * H * (y[e] - x[e]);
        D += dp * H * (y[e] - sPrev[e]);
      }
      let al = D !== 0 ? N / D : 0;
      if (!(al >= 0)) al = 0;
      if (al > 0.98) al = 0.98;
      for (let e = 0; e < m; e++) s[e] = al * sPrev[e] + (1 - al) * y[e];
    } else s.set(y);
    // the links whose flow moves
    let na = 0;
    for (let e = 0; e < m; e++) { const de = s[e] - x[e]; if (de !== 0) { act[na] = e; dlt[na++] = de; } }
    // g(lam) = sum de * t(x + lam de), increasing in lam; its root on [0, 1]
    const g = lam => {
      let v = 0;
      for (let i = 0; i < na; i++) {
        const e = act[i], de = dlt[i], r = (x[e] + lam * de) / eCap[e], r2 = r * r;
        v += de * eT0[e] * (1 + b * r2 * r2);
      }
      return v;
    };
    let lam = 1;
    const g1 = g(1);
    if (g1 > 0) {
      let lo = 0, hi = 1, glo = g(0), ghi = g1;
      lam = glo < 0 ? clamp(-glo / (ghi - glo), 1e-12, 1 - 1e-12) : 0;
      for (let it = 0; it < 40 && lam > 0; it++) {
        let v = 0, dv = 0;
        for (let i = 0; i < na; i++) {
          const e = act[i], de = dlt[i], c = eCap[e], r = (x[e] + lam * de) / c, r2 = r * r;
          v += de * eT0[e] * (1 + b * r2 * r2);
          dv += de * de * eT0[e] * 4 * b * r2 * r / c;
        }
        if (v > 0) { hi = lam; ghi = v; } else { lo = lam; glo = v; }
        if (hi - lo < 1e-11) break;
        let nl = dv > 0 ? lam - v / dv : NaN;
        if (!(nl > lo && nl < hi)) nl = (lo + hi) / 2;
        if (Math.abs(nl - lam) < 1e-12) { lam = nl; break; }
        lam = nl;
      }
    }
    if (lam < 1e-9) break;
    for (let i = 0; i < na; i++) { const e = act[i]; x[e] += lam * dlt[i]; }
    sPrev.set(s); haveS = true;
  }
  return { flows: x, gap, iters };
}

/* ---------------------- the jobs a run is made of --------------------- */
// A worker (or the page alone) holds one network and one demand; jobs say what to close.
function closedMask(m, edges) {
  const en = new Uint8Array(m).fill(1);
  if (edges) for (const e of edges) en[e] = 0;
  return en;
}
/* job kinds:
     base     the user equilibrium with nothing closed, its costs and OD times
              (with x0: carried on from those flows to a tighter gap)
     so       the system optimum (marginal costs), warm from the base's costs
     scan     one closure, quick solve: the change in total travel time
     verify   one closure, precise solve: total change and the best OD gain
     combined several closures together, precise solve
     busy     the base for another hour's demand (job.od, job.demand), loosely:
              total travel time against free flow, for the hourly chart */
function runJob(ctx, job) {
  const net = ctx.net, m = net.m;
  if (job.kind === 'busy') {
    const keep = net.odOrigins;
    net.odOrigins = job.od;
    try {
      const r = equilibrium(net, job.demand, null, job.maxIter, job.tol);
      if (!r) return { ok: false };
      let t0 = 0;
      for (let e = 0; e < m; e++) t0 += r.flows[e] * net.eT0[e];
      return { ok: true, t: tstt(net, r.flows), t0 };
    } finally { net.odOrigins = keep; }
  }
  if (job.kind === 'base') {
    const r = equilibrium(net, ctx.demand, null, job.maxIter, job.tol, undefined, undefined, job.x0);
    if (!r) return { ok: false };
    const cost = new Float64Array(m);
    linkCosts(net, r.flows, cost);
    return { ok: true, flows: r.flows, cost, gap: r.gap, iters: r.iters, baseT: tstt(net, r.flows), odBase: odTimes(net, r.flows, null) };
  }
  if (job.kind === 'so') {
    const r = equilibrium(net, ctx.demand, null, job.maxIter, job.tol, 0.75, ctx.cost);
    return r ? { ok: true, t: tstt(net, r.flows), iters: r.iters } : { ok: false };
  }
  const en = closedMask(m, job.edges);
  const r = equilibrium(net, ctx.demand, en, job.maxIter, job.tol, undefined, ctx.cost);
  if (!r) return { ok: false };
  const t = tstt(net, r.flows), imp = (ctx.baseT - t) / ctx.baseT;
  if (job.kind === 'scan' || job.kind === 'combined') return { ok: true, t, imp, iters: r.iters, gap: r.gap };
  // verify: the best relative OD gain under the closure
  const c2 = new Float64Array(m);
  linkCosts(net, r.flows, c2);
  for (let e = 0; e < m; e++) if (!en[e]) c2[e] = Infinity;
  let odImp = -1, odFrom = -1, odTo = -1;
  for (let oi = 0; oi < net.odOrigins.length; oi++) {
    const g = net.odOrigins[oi];
    dijkstra(net, g.o, c2, g.dests);
    for (let j = 0; j < g.dests.length; j++) {
      if (g.ws && g.ws[j] < 0.5) continue;
      const d = g.dests[j];
      if (net.settled[d] !== net.gen) continue;
      const base = ctx.odBase[oi][j];
      const rel = (base - net.dist[d]) / Math.max(base, 1e-9);
      if (rel > odImp) { odImp = rel; odFrom = g.o; odTo = d; }
    }
  }
  return { ok: true, t, imp, iters: r.iters, gap: r.gap, odImp, odFrom, odTo };
}

/* ------------------------- the whole analysis ------------------------- */
/* Scan settings. The original tested as many candidates as fitted in 14 s
   on the visitor's computer (at least 16, at most 300), then checked the best
   8 (16 on small networks) precisely, at a looser tolerance on big ones. This
   tests a fixed number by network size, so every computer gets the same
   answer: the original's 300 up to 3000 links, then fewer as each test costs
   more (60 at least), which is still several times what fitted in 14 s. The
   best 24 (at most 6 of one street name; it was 2, which left real ones
   unchecked) are checked to a relative gap of 2e-5, not 1e-4 to 2e-4: solved
   to 1e-6 for reference on downtown San Francisco, the change in total travel
   time came out within 0.006 points on average at 2e-5, against 0.017 at
   1e-4, and borderline roads stopped flipping the wrong way. The base they
   are measured against is carried on to 5e-6 (on central Paris the base at
   1e-4 was 0.034% low, which moved every road's change by as much). */
function scanPlan(net, nCand) {
  const tight = net.m <= 1500;
  const count = net.m <= 3000 ? 300 : Math.max(60, Math.round(300 * 3000 / net.m));
  return {
    scanCount: Math.min(nCand, count),
    scanIter: 80, scanTol: 3e-4,
    vIter: 600, vTol: 2e-5,
    vSlots: 24, perName: 6,
    refineBand: 0.00015, rIter: 2500, rTol: 5e-6,
    // the base every change is measured against is solved at least as tightly as the closures
    bIter: 4000, bTol: 5e-6,
    tsttMin: tight ? 0.0004 : 0.0008,
    odMin: 0.015,
  };
}
/* Runs the analysis, with `pool.run(jobs)` doing the jobs (in parallel or
   not) once `pool.setBase(...)` has given every runner the base's costs.
   progress(fraction, text) is told how far it is. */
async function analyze(net, demand, pool, progress, opts) {
  opts = opts || {};
  const say = progress || (() => {});
  const m = net.m;
  say(0.02, 'Computing the user equilibrium');
  const base0 = (await pool.run([{ kind: 'base', maxIter: 300, tol: 1e-4 }]))[0];
  if (!base0 || !base0.ok) throw new Error('Network is not routable. Try a larger radius.');
  let { flows, cost, baseT, odBase } = base0;
  await pool.setBase({ cost, baseT, odBase });
  const statsOf = (flows, cost) => net.segs.map(s => {
    if (!s.active) return null;
    let flow = 0, vc = 0, tMax = 0, vehH = 0;
    for (const e of s.edges) { flow += flows[e]; vc = Math.max(vc, flows[e] / net.eCap[e]); tMax = Math.max(tMax, cost[e]); vehH += flows[e] * cost[e]; }
    return { flow, vc, tMax, vehH };
  });
  let segStats = statsOf(flows, cost);
  // (the page can draw the traffic now: the rest only adds the Braess roads)
  if (opts.onBase) opts.onBase({ flows, cost, segStats, baseT, gap: base0.gap });
  // candidates by congestion externality f t'(f)
  const candidates = [];
  for (let si = 0; si < net.segs.length; si++) {
    const s = net.segs[si];
    if (!s.active || segStats[si].flow <= 5) continue;
    let ext = 0;
    for (const e of s.edges) { const r = flows[e] / net.eCap[e]; ext += net.eT0[e] * 0.6 * r * r * r * r * flows[e]; }
    candidates.push([si, ext]);
  }
  candidates.sort((a, b) => b[1] - a[1]);
  const plan = Object.assign(scanPlan(net, candidates.length), opts.plan || {});
  // stage 1, with the base carried on to its tight gap and the system optimum alongside
  say(0.1, `Testing ${plan.scanCount} road closures`);
  const jobs = [{ kind: 'base', x0: flows, maxIter: plan.bIter, tol: plan.bTol }, { kind: 'so', maxIter: 150, tol: 3e-4 }];
  const scanned = candidates.slice(0, plan.scanCount);
  for (const [si] of scanned) jobs.push({ kind: 'scan', si, edges: net.segs[si].edges, maxIter: plan.scanIter, tol: plan.scanTol });
  const res1 = await pool.run(jobs, (done, total) => say(0.1 + 0.62 * done / total, `Testing road closures (${Math.max(0, done - 2)} of ${plan.scanCount})`));
  const tight = res1[0];
  let baseGap = base0.gap, baseIters = base0.iters;
  if (tight && tight.ok) {
    ({ flows, cost, baseT, odBase } = tight);
    baseGap = tight.gap; baseIters = base0.iters + tight.iters;
    segStats = statsOf(flows, cost);
    await pool.setBase({ cost, baseT, odBase });
  }
  let waste = null;
  if (res1[1] && res1[1].ok && res1[1].t < baseT) waste = (baseT - res1[1].t) / baseT;
  const provisional = [];
  let bestScan = null;
  for (let i = 2; i < res1.length; i++) {
    const r = res1[i];
    if (!r || !r.ok) continue;
    const si = jobs[i].si, imp = (baseT - r.t) / baseT;
    if (bestScan === null || imp > bestScan.imp) bestScan = { si, imp };
    if (imp > -0.0008) provisional.push({ si, imp1: imp });
  }
  provisional.sort((a, b) => b.imp1 - a.imp1);
  // stage 2: the best survivors, solved precisely, at most two segments of one name
  const perName = new Map(), verifyList = [];
  for (const p of provisional) {
    const nm = net.segs[p.si].name, cnt = perName.get(nm) || 0;
    if (cnt >= plan.perName || verifyList.length >= plan.vSlots) continue;
    perName.set(nm, cnt + 1);
    verifyList.push(p);
  }
  say(0.74, `Checking the ${verifyList.length} best candidates precisely`);
  const res2 = await pool.run(verifyList.map(p => ({ kind: 'verify', si: p.si, edges: net.segs[p.si].edges, maxIter: plan.vIter, tol: plan.vTol })),
    (done, total) => say(0.74 + 0.16 * done / Math.max(total, 1), `Checking candidate ${done} of ${total}`));
  /* A result within the solver's error of a cut-off (about 0.006 points at
     2e-5) could fall either side of it, so those few are solved again to
     5e-6 before anything is called a Braess road. */
  const near = (v, cut, w) => Math.abs(v - cut) < w;
  const edge = [];
  verifyList.forEach((p, i) => {
    const r = res2[i];
    if (!r || !r.ok) return;
    if (near(r.imp, plan.tsttMin, plan.refineBand) || (r.odImp >= plan.odMin - 0.002 && near(r.imp, -0.0002, plan.refineBand)) ||
      (r.imp >= -0.0002 - plan.refineBand && near(r.odImp, plan.odMin, 0.002))) edge.push(i);
  });
  if (edge.length) {
    say(0.9, `Re-checking ${edge.length} close call${edge.length > 1 ? 's' : ''}`);
    const res3 = await pool.run(edge.map(i => ({ kind: 'verify', si: verifyList[i].si, edges: net.segs[verifyList[i].si].edges, maxIter: plan.rIter, tol: plan.rTol })));
    edge.forEach((i, k) => { if (res3[k] && res3[k].ok) res2[i] = Object.assign(res3[k], { refined: true }); });
  }
  const braess = [], scanLog = [];
  let nearMiss = bestScan;
  verifyList.forEach((p, i) => {
    const r = res2[i];
    if (!r || !r.ok) return;
    const s = net.segs[p.si];
    if (nearMiss === null || r.imp > nearMiss.imp) nearMiss = { si: p.si, imp: r.imp };
    const hitTSTT = r.imp >= plan.tsttMin && (baseT - r.t) > 0.1;
    const hitOD = r.odImp >= plan.odMin && r.imp >= -0.0002;
    scanLog.push({ si: p.si, name: s.name, imp1: p.imp1, imp: r.imp, odImp: r.odImp, hitTSTT, hitOD, refined: !!r.refined });
    if (hitTSTT || hitOD) braess.push({ si: p.si, imp: r.imp, saved: baseT - r.t, odImp: r.odImp, odFrom: r.odFrom, odTo: r.odTo, kind: hitTSTT ? 'tstt' : 'od' });
  });
  braess.sort((a, b) => b.imp - a.imp);
  const groups = new Map();
  for (const b of braess) {
    const s = net.segs[b.si];
    const key = s.name.startsWith('unnamed') ? '#' + b.si : s.name;
    if (!groups.has(key)) groups.set(key, { name: s.name, sis: [], best: b });
    const g = groups.get(key);
    g.sis.push(b.si);
    if (b.imp > g.best.imp) g.best = b;
  }
  const braessRoads = [...groups.values()].sort((a, b) => b.best.imp - a.best.imp);
  let combined = null;
  if (braess.length > 1) {
    say(0.93, 'Closing all of them together');
    const all = [];
    for (const b of braess) for (const e of net.segs[b.si].edges) all.push(e);
    const r = (await pool.run([{ kind: 'combined', edges: all, maxIter: plan.vIter, tol: plan.vTol }]))[0];
    if (r && r.ok && r.t < baseT) combined = { imp: (baseT - r.t) / baseT, saved: baseT - r.t };
  }
  let vehKm = 0;
  for (let e = 0; e < m; e++) vehKm += flows[e] * net.eLen[e];
  say(1, 'Done');
  return {
    flows, cost, segStats, braess, braessRoads, combined, waste, nearMiss, baseT, gap: baseGap, iters: baseIters,
    tested: scanned.length, candidates: candidates.length, scanLog, avgSpeed: vehKm / Math.max(baseT, 1e-9), totDemand: demand * net.numOD, plan,
  };
}
// everything up to the demand for a time of day, from Overpass answers
function prepare(osmRoads, acts, center, radiusM, hour, prof, mult) {
  const net = buildNetwork(osmRoads);
  buildDemandModel(net, center, radiusM, acts);
  buildOD(net, hour, prof);
  const factor = Math.max(demandFactor(hour, prof), 0.03);
  const demand = 0.9 * factor * mult / net.unitRefVC;
  return { net, demand, factor };
}

/* ------------------------ runners for the jobs ------------------------ */
// one runner on this thread (the fallback, and Node tests without workers)
function localPool(net, demand) {
  const ctx = { net, demand, cost: null, baseT: 0, odBase: null };
  const yieldNow = () => new Promise(r => setTimeout(r, 0));
  let closed = false;
  return {
    size: 1, ready: Promise.resolve(),
    async setBase(b) { Object.assign(ctx, b); },
    async run(jobs, onDone) {
      const out = [];
      for (let i = 0; i < jobs.length; i++) {
        if (closed) throw new Error('cancelled');
        out.push(runJob(ctx, jobs[i]));
        if (onDone) onDone(i + 1, jobs.length);
        await yieldNow();
      }
      return out;
    },
    close() { closed = true; },
  };
}
// what a worker needs to rebuild the network and the demand
function workerInit(net, demand) {
  return { core: coreOf(net), od: net.odOrigins, demand };
}
// inside a worker (browser or Node): messages in, results out
function serveWorker(post, onMessage) {
  let ctx = null;
  onMessage(msg => {
    if (msg.type === 'init') {
      const net = Object.assign({}, msg.core);
      finishCore(net);
      net.odOrigins = msg.od;
      ctx = { net, demand: msg.demand, cost: null, baseT: 0, odBase: null };
      post({ type: 'ready' });
    } else if (msg.type === 'base') {
      Object.assign(ctx, msg.base);
      post({ type: 'based' });
    } else if (msg.type === 'job') {
      let r;
      try { r = runJob(ctx, msg.job); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
      // (the base's own big arrays only go back for the base job)
      post({ type: 'done', id: msg.id, r });
    }
  });
}
/* A pool over worker-like objects: each has post(msg) and a handler set by
   listen(fn). Jobs go to whichever is free, so a slow closure does not hold
   the others up. */
function makePool(workers, net, demand) {
  let nextId = 1, closed = false;
  const waiting = new Map();
  for (const w of workers) w.listen(msg => { const k = msg.id || msg.type + w.n, cb = waiting.get(k); if (cb) { waiting.delete(k); cb.res(msg); } });
  const ask = (w, msg, key) => new Promise((res, rej) => {
    if (closed) return rej(new Error('cancelled'));
    waiting.set(key, { res, rej });
    w.post(msg);
  });
  const init = workerInit(net, demand);
  const ready = Promise.all(workers.map(w => ask(w, Object.assign({ type: 'init' }, init), 'ready' + w.n)));
  ready.catch(() => {});
  return {
    size: workers.length, ready,
    async setBase(b) { await ready; await Promise.all(workers.map(w => ask(w, { type: 'base', base: b }, 'based' + w.n))); },
    async run(jobs, onDone) {
      await ready;
      const out = new Array(jobs.length);
      let next = 0, done = 0;
      await Promise.all(workers.map(async w => {
        while (next < jobs.length) {
          const i = next++, id = nextId++;
          const msg = await ask(w, { type: 'job', id, job: jobs[i] }, id);
          out[i] = msg.r;
          done++;
          if (onDone) onDone(done, jobs.length);
        }
      }));
      return out;
    },
    // (stops the workers; anything still waiting fails with 'cancelled')
    close() {
      closed = true;
      for (const w of workers) if (w.end) w.end();
      for (const cb of waiting.values()) cb.rej(new Error('cancelled'));
      waiting.clear();
    },
  };
}

const API = {
  ROAD, PROFILE, demandFactor, dirFactor, parseMaxspeed, havKm, flatKm, clamp,
  bboxOf, roadsQuery, activityQuery, parseActivity, unpackData,
  buildNetwork, finishCore, coreOf, buildDemandModel, buildOD, nearestNode,
  MinHeap, dijkstra, aon, linkCosts, tstt, odTimes, equilibrium,
  runJob, scanPlan, analyze, prepare, localPool, workerInit, serveWorker, makePool,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.BraessEngine = API;

// a Web Worker that loaded this file with importScripts serves jobs
if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
  serveWorker(m => root.postMessage(m), fn => { root.onmessage = e => fn(e.data); });
}
})(typeof self !== 'undefined' ? self : this);
