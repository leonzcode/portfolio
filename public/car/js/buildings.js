// Buildings for the open world, from OSM building records (osm.js, or the vector tiles of mvt.js) pieced together
// with Overture Maps' (overture.js: heights, floors, roof shapes and colours from more sources, and footprints OSM
// does not have): every footprint extruded to its real height (height, else levels, else a guess by type, region
// and how built up the area is), building:part pieces from their min_height, and its roof in its own shape: flat,
// gabled, hipped, half-hipped, pyramidal, skillion, gambrel, saltbox, round, mansard, dome, onion or cone, its ridge
// the way roof:direction / roof:orientation say, else the way the satellite picture shows (the two faces of a
// pitched roof catch the sun differently), else as houses are built there. Roofs are textured with the satellite
// picture right above them (their real colours), the walls drawn by facade.js with each building's own window
// layout, colours and features, chosen from its tags, else from its country, city, type and size. Houses get
// their chimneys, porches, dormers and bay windows where such houses have them; Manhattan's roofs their water
// towers; terraces are drawn as a row of houses.
//
//   const b = buildings.build(list, { groundAt, scene, world, collide, imagery, focus })
//   b.group            THREE.Group, added to scene (or world.root)
//   b.ready            Promise, resolved once every cell is built with its imagery
//   b.dispose()
//
// Meshes are merged per CELL x CELL metre square: one walls mesh (one shared material) and one roof mesh (its
// cell's imagery) a cell, so a square kilometre is a few dozen draw calls. Each footprint is a collision polygon,
// and the meshes go into world.extra so world.raycast hits them.
import * as THREE from 'three';
import { frame, project } from './geo.js?v=50';
import { patchBaked } from './baked.js?v=50';
import { makeFacadeMaterial, STYLE, GROUND, FACADE_TIME, FBIT } from './facade.js?v=50';
import overture from './overture.js?v=50';

export const CELL = 400;
const LV = 3.2;
const D2R = Math.PI / 180;

// ---------- small helpers ----------
function hashf(n, salt = 0) {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((n / 4294967296) | 0) + salt * 7919, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const area2 = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

function cleanRing(r) {
  const out = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push([p[0], p[1]]);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.05) out.pop();
  return out;
}

function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

// minimum-area bounding rectangle: centre, long axis A, short axis P, half length hl (along A), half width hw
function obb(ring) {
  const h = hull(ring);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz); if (l < 1e-6) continue;
    dx /= l; dz /= l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of h) { const u = p[0] * dx + p[1] * dz, v = -p[0] * dz + p[1] * dx; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const ar = (u1 - u0) * (v1 - v0);
    if (!best || ar < best.ar) best = { ar, dx, dz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { dx, dz, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const cx = cu * dx - cv * dz, cz = cu * dz + cv * dx;
  let A = [dx, dz], P = [-dz, dx], hl = (u1 - u0) / 2, hw = (v1 - v0) / 2;
  if (hw > hl) { [A, P] = [P, A]; [hl, hw] = [hw, hl]; }
  return { cx, cz, A, P, hl, hw, area: best.ar };
}
// the box of a ring along a given direction A (unit): its centre and half sizes, P the perpendicular
function boxAlong(ring, A) {
  const P = [-A[1], A[0]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of ring) { const u = p[0] * A[0] + p[1] * A[1], v = p[0] * P[0] + p[1] * P[1]; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { cx: cu * A[0] + cv * P[0], cz: cu * A[1] + cv * P[1], A, P, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2 };
}

// every vertex moved by d along its edges' outward normals (-dz, dx), mitred, capped at sharp corners
function offsetRing(r, d) {
  const n = r.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = r[(i - 1 + n) % n], p = r[i], b = r[(i + 1) % n];
    let ax = p[0] - a[0], az = p[1] - a[1], bx = b[0] - p[0], bz = b[1] - p[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    const n1x = -az / la, n1z = ax / la, n2x = -bz / lb, n2z = bx / lb;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out[i] = [p[0] + n1x * d, p[1] + n1z * d]; continue; }
    mx /= ml; mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.33, mx * n1x + mz * n1z));
    out[i] = [p[0] + mx * d * k, p[1] + mz * d * k];
  }
  return out;
}

// A ring moved w into the solid (the outer ring shrunk, a courtyard grown), or null where it would fold: an edge
// turning back or two edges crossing. For roofs that slope up from every wall (perimRoof).
function insetRing(ring, w, outer) {
  const n = ring.length, A0 = Math.abs(area2(ring));
  let r = offsetRing(ring, -w);
  if ((Math.abs(area2(r)) < A0) !== outer) r = offsetRing(ring, w);
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], a = r[i], b = r[(i + 1) % n];
    if ((q[0] - p[0]) * (b[0] - a[0]) + (q[1] - p[1]) * (b[1] - a[1]) <= 0) return null;
  }
  return r;
}
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}
// do any two edges of these rings cross (a ring's neighbouring edges aside)
function ringsCross(rings) {
  const E = [];
  rings.forEach((r, k) => { for (let i = 0; i < r.length; i++) E.push([r[i], r[(i + 1) % r.length], k, i, r.length]); });
  if (E.length > 400) return true;
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const a = E[i], b = E[j];
    if (a[2] === b[2] && (Math.abs(a[3] - b[3]) <= 1 || Math.abs(a[3] - b[3]) === a[4] - 1)) continue;
    if (segCross(a[0], a[1], b[0], b[1])) return true;
  }
  return false;
}
// the rings w in from a footprint's walls (and out from its courtyards'), or null
function perimRings(outer, holes, w) {
  const o = insetRing(outer, w, true); if (!o) return null;
  const hs = []; for (const h of holes) { const r = insetRing(h, w, false); if (!r) return null; hs.push(r); }
  if (Math.abs(area2(o)) < Math.abs(area2(outer)) * 0.12) return null;
  if (ringsCross([o, ...hs])) return null;
  for (const h of hs) for (const q of h) if (!inRing(q[0], q[1], o)) return null;
  return { o, hs };
}

// clip a ring by f(p) = g . p + c >= 0
function clip(ring, g, c) {
  const out = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const fp = g[0] * p[0] + g[1] * p[1] + c, fq = g[0] * q[0] + g[1] * q[1] + c;
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const s = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s]); }
  }
  return out;
}

function triangulate(outer, holes) {
  const c = outer.map(p => new THREE.Vector2(p[0], p[1]));
  const hs = (holes || []).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(c, hs); } catch (e) { tris = []; }
  const pts = c.concat(...hs);
  return { pts, tris };
}

const _col = new THREE.Color();
function parseColour(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase().replace(/[\s_-]/g, '');
  if (s === 'grey' || s === 'gray') s = 'gray';
  const alias = { lightgrey: 'lightgray', darkgrey: 'darkgray', cream: '#efe6cc', sand: '#d8c39a', brick: '#9a4a36', redbrick: '#9a4a36', stone: '#c8bea8', concrete: '#bdbab3', glass: '#5a6e7c', white: '#f0eee8', black: '#2a2a2a', beige: '#dccfb0', ochre: '#cc9a46', terracotta: '#b5573a', anthracite: '#3a3c3e', silver: '#b8b9b8', gold: '#c9a54a', bronze: '#7c5a3a', copper: '#7a8f7c', lightblue: '#b9cfe0', lightyellow: '#efe6b0', pink: '#e2b8b0' };
  if (alias[s]) s = alias[s];
  if (/^[0-9a-f]{6}$/.test(s)) s = '#' + s;
  if (s[0] === '#' || THREE.Color.NAMES[s] !== undefined) {
    try { _col.setStyle(s, THREE.SRGBColorSpace); return _col.clone(); } catch (e) { return null; }
  }
  return null;
}

// ---------- what each building is ----------
const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'semi', 'bungalow', 'terrace', 'cabin', 'farm', 'villa', 'static_caravan', 'houseboat', 'hut', 'townhouse', 'chalet']);
const SMALL = new Set(['garage', 'garages', 'shed', 'carport', 'kiosk', 'hut', 'toilets', 'roof', 'service', 'transformer_tower', 'bunker', 'container', 'shelter', 'outbuilding']);
const SHOPS = new Set(['commercial', 'retail', 'mixed_use', 'supermarket', 'kiosk', 'shop', 'store', 'restaurant', 'hotel']);
const OFFICE = new Set(['office', 'bank', 'government']);
const WORKS = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'storage_tank', 'barn', 'farm_auxiliary', 'greenhouse', 'parking', 'garages', 'service', 'cowshed', 'stable', 'agricultural']);
const CHURCH = new Set(['church', 'cathedral', 'chapel', 'religious']);
const CIVIC = new Set(['church', 'cathedral', 'chapel', 'mosque', 'temple', 'synagogue', 'shrine', 'civic', 'public', 'government', 'museum', 'townhall', 'courthouse', 'train_station', 'transportation', 'religious']);
const FLATS = new Set(['apartments', 'residential', 'dormitory', 'flats']);

function region() {
  const la = frame.lat, lo = frame.lon;
  if (lo > -170 && lo < -50 && la > 14 && la < 72) return 'us';
  if (lo > -11 && lo < 2 && la > 49 && la < 61) return 'uk';
  if (lo > 129 && lo < 146 && la > 30 && la < 46) return 'jp';
  if (lo > -11 && lo < 40 && la > 35 && la < 71) return 'eu';
  return 'other';
}
// a finer zone, for how houses are built there
function zoneOf(lat, lon) {
  if ((lat < 31.3 && lon > -118 && lon < -99) || (lat < 25.8 && lon > -118 && lon < -86)) return 'med'; // Mexico, Central America
  if (lon > -170 && lon < -50 && lat > 14 && lat < 72) {
    if (lon < -103) return 'usw';
    if (lat < 36.6) return 'uss';
    return 'usn';
  }
  if ((lat > 49.8 && lat < 59 && lon > -8.5 && lon < 2) || (lat > 51.3 && lat < 55.5 && lon > -10.6 && lon < -5.9)) return 'uk';
  if (lat > 30 && lat < 46 && lon > 129 && lon < 146) return 'jp';
  if (lat > 50.75 && lat < 53.6 && lon > 3.35 && lon < 7.25) return 'nl';
  if (lat > 49.5 && lat < 51.5 && lon > 2.5 && lon < 6.4) return 'be';
  if (lat > 45.6 && lat < 48.1 && lon > 5.8 && lon < 16.8) return 'alps';
  if (lat > 47 && lat < 55.1 && lon > 5.8 && lon < 19.5) return 'de';
  if (lat > 54.5 && lat < 71.5 && lon > 4 && lon < 32) return 'scand';
  if (lat > 42.3 && lat < 51.2 && lon > -5 && lon < 8.3) return 'fr';
  if (lat > 30 && lat < 46 && lon > -10 && lon < 36) return 'med';
  return 'other';
}

// ---------- what a city's buildings look like ----------
// A building with no colour or material tags takes its city's look: the city by distance from its centre, else a
// region by a lat/lon box (the Alps also by height above the sea, per building).
const CITIES = [['paris', 48.8566, 2.3522, 12000], ['london', 51.5074, -0.1278, 16000], ['sf', 37.7749, -122.4194, 9000], ['nyc', 40.7400, -73.9900, 16000], ['amsterdam', 52.3700, 4.8950, 5000]];
function cityOf(lat, lon) {
  for (const [n, la, lo, r] of CITIES) {
    const dx = (lon - lo) * 111320 * Math.cos(la * D2R), dz = (lat - la) * 110540;
    if (dx * dx + dz * dz < r * r) return n;
  }
  if (lat > 30 && lat < 46 && lon > 129 && lon < 146) return 'japan';
  if (lat > 45.6 && lat < 48.1 && lon > 5.8 && lon < 16.8) return 'alps';
  if (lat > 49.8 && lat < 59 && lon > -8.5 && lon < 2) return 'uk';
  if (lat > 42.3 && lat < 51.2 && lon > -5 && lon < 8.3) return 'france';
  if ((lat > 30 && lat < 44.5 && lon > -10 && lon < 36) || (lat > 15 && lat < 33 && lon > -118 && lon < -86)) return 'med';
  return null;
}
// the dense commercial cores whose fronts are covered in lit screens: [lat, lon, radius m]
// (and the share of street walls with a screen: nearly all of Times Square's, fewer round Shibuya's crossing,
// and whether a screen covers the whole front, as in Times Square)
const CORES = [[40.7580, -73.9855, 260, 0.85, true], [35.6595, 139.7005, 150, 0.4, false], [51.5101, -0.1342, 70, 0.6, false]];
// London's stucco quarters (Kensington, Notting Hill, Belgravia, Pimlico, Regent's Park): cream fronts, and
// Notting Hill's in pastels. [lat, lon, radius m, pastel]
const STUCCO_LDN = [[51.5160, -0.2040, 900, true], [51.4990, -0.1910, 1300, false], [51.4970, -0.1530, 800, false], [51.4890, -0.1370, 700, false], [51.5270, -0.1450, 600, false]];
const hex = (a) => a.map(h => new THREE.Color(h).multiplyScalar(0.62));
const LOOK_PAL = {
  hauss: hex(['#e3d9c3', '#d9ccb0', '#e6dcc8', '#d2c4a6', '#ddd2bb', '#d6cdb9']),
  portland: hex(['#e4dfd2', '#d9d3c3', '#ece8dd', '#d2ccbd']),
  lstock: hex(['#b39672', '#a88b66', '#bfa27c', '#9c8160', '#b09878', '#a99070']),
  lred: hex(['#9a5b45', '#8e4f3c', '#a3634b']),
  lstucco: hex(['#ecebe4', '#e8e4d6', '#efece3', '#e4dccb']),
  sf: hex(['#efe6cf', '#d6e6d6', '#f0e0a8', '#cfdfe9', '#efd5cf', '#f2efe8', '#e3e7d3', '#e9dcc5', '#d8d2e6', '#f3e2b8']),
  nycbrick: hex(['#8e4a36', '#7a4030', '#9b5a44', '#844634', '#a0604a', '#8a5240']),
  brownstone: hex(['#86614c', '#7d5a46', '#8f6c56', '#775442', '#93705a', '#6f5040']),
  painted: hex(['#e9e6de', '#d9d4c8', '#8a8f94', '#4a5660', '#c9b8a0', '#a85a48']),
  nycstone: hex(['#b8b4ac', '#a6a29a', '#c4bfb3', '#9d9a94']),
  jpn: hex(['#e6e4de', '#d8d6d0', '#cfcac0', '#ebe8e0', '#d9cfbd', '#c9c9c6', '#e2ddd2', '#d4d0c4']),
  jphouse: hex(['#ecebe6', '#cfcfcc', '#d6cbb6', '#8a7360', '#6d6e70', '#e6dfcc', '#b8ada0', '#a9a49c']),
  alpine: hex(['#efece4', '#ebe6d9', '#f2efe7', '#e6e0d0']),
  med: hex(['#f1ece0', '#e8d2a8', '#d9b98a', '#f3e7cf', '#ead9b8', '#e0c49a', '#f4f1ea']),
  render: hex(['#ece5d6', '#e3d8c2', '#e9e2d2', '#d9cdb5', '#efe9dc']),
  usSiding: hex(['#f2f1ec', '#e8dfc8', '#d8cbb0', '#c9cbc8', '#a9b6bf', '#b9c0a6', '#ecdca0', '#c8b394', '#8fa6b8', '#8e9c84', '#9a4b40', '#5f6266', '#f2f1ec', '#d9d6cc']),
  usStucco: hex(['#e9e0cc', '#ddd0b4', '#d6c4a2', '#cbb795', '#efe9dc', '#d9d4c8', '#c8bba3', '#e6d6bf', '#bfb8aa', '#e2d3b2']),
  usBrick: hex(['#9a4a3a', '#7d4b38', '#b08a66', '#a8603f', '#6b3e33', '#cdb48c', '#8c5a44', '#a07458']),
  limestone: hex(['#d6ccb4', '#cfc2a4', '#ddd3bb', '#c8bb9c']),
  nlBrick: hex(['#7a3f30', '#6a3d2e', '#9a4a33', '#5a3328', '#84452f', '#8a4a35', '#733a2a', '#934d36', '#6e3b2c', '#80412f', '#8d8b86', '#2e2e30', '#a8705a', '#b98a6e', '#c49c78', '#5e4a3c', '#e8e2d4', '#d9d6ce', '#9c7a62']),
  deRender: hex(['#efede6', '#ece2c6', '#ecd99a', '#e6c0a8', '#d7d6d0', '#dcc08a', '#e9c8c0', '#d0d8b8', '#f0ece2', '#e4ddcf']),
  deBrick: hex(['#9a4c38', '#8a4231', '#a65a40', '#7c4434']),
  scand: hex(['#8c2f22', '#d9b04a', '#eeeeea', '#b8bcbc', '#7d8b94', '#8c2f22', '#e8dcc0']),
  frHouse: hex(['#e9e2d0', '#d8cdb4', '#eeece6', '#cfccc4', '#e4d8bd', '#d9cbb0']),
};
// facade looks (aS.z, plus 10 for a wall with screens, 20 for a wall with a vertical sign)
export const LOOK = { NONE: 0, HAUSS: 1, SASH: 2, JAPAN: 3, ALPINE: 4, SF: 5 };

// the city's look for one building: style, palette, facade look and roof, changed on the plan in place
function applyCity(P, ctx) {
  const b = P.b, city = ctx.city, t = P.t;
  if (!city || b.material || P.church || P.jpTemple) return;
  // (a tagged colour still wins: wallColour takes it over any palette; the city's shapes and windows apply)
  const { H, area, r1, r2, r3, houseLike } = P;
  const tall = H > 45, dense = ctx.density > 0.25;
  const flatRoof = (force) => { if (!b.roofShape && (force || P.roofSrc !== 'img')) setShape(P, 'flat'); };
  // (a city look has its own windows: the zone's guesses go)
  const own = () => { P.F[0] = P.F[1] = P.F[2] = 0; P.bits &= ~(FBIT.RIBBON | FBIT.CROSS | FBIT.TIMBER | FBIT.SHUTTERS | 3); };
  if ((city === 'paris' || (city === 'france' && dense)) && !houseLike && H > 11 && H < 42) {
    // Haussmann blocks: cream limestone, tall windows, iron balconies, a zinc mansard roof with a dormer each bay
    own(); P.style = STYLE.STONE; P.palette = LOOK_PAL.hauss; P.look = LOOK.HAUSS;
    if (!b.roofShape && P.holes.length === 0 && area > 60) { setShape(P, 'mansard'); P.dormers = 'bays'; }
    P.zinc = true;
  } else if (city === 'paris' || city === 'france') {
    P.palette = houseLike ? LOOK_PAL.frHouse : LOOK_PAL.render;
    if (P.style !== STYLE.GLASS) P.style = houseLike ? STYLE.STUCCO : (r1 < 0.5 ? STYLE.STONE : STYLE.STUCCO);
  } else if (city === 'london' || city === 'uk') {
    // the West End and the City are mostly cream Portland stone and stucco fronts over shops, brick behind
    let central = false, stucco = null;
    if (city === 'london') {
      if (ctx.londonMid && !houseLike && H > 12) central = Math.hypot(P.cx - ctx.londonMid[0], P.cz - ctx.londonMid[1]) < 2500 && r2 < 0.7;
      for (const q of ctx.stuccoLdn) if (Math.hypot(P.cx - q[0], P.cz - q[1]) < q[2]) { stucco = q; break; }
    }
    if (!houseLike && (area > 1500 || H > 24 || central) && !tall) { P.style = STYLE.STONE; P.palette = LOOK_PAL.portland; }
    else if (stucco && !tall && H < 24 && r3 < (stucco[3] ? 0.85 : 0.6)) {
      // stucco terraces: cream or white fronts, sash windows with surrounds, each house painted on its own
      // (half of them stucco only on the lower two floors, London stock brick above)
      if (r5of(P) < 0.45) { P.style = STYLE.BRICK; P.palette = LOOK_PAL.lstock; P.bits |= FBIT.BASE2; } else { P.style = STYLE.STUCCO; P.palette = LOOK_PAL.lstucco; }
      P.look = LOOK.SASH; P.bits |= FBIT.SURROUND;
      if (stucco[3]) P.pastel = true;
      P.terrace = P.terrace || P.rowLike;
    } else if (!tall) { P.style = STYLE.BRICK; P.palette = r2 < 0.75 ? LOOK_PAL.lstock : LOOK_PAL.lred; P.look = LOOK.SASH; if (r1 < 0.45) P.bits |= FBIT.SURROUND; }
    // Victorian terraces: tall sashes, a painted stucco ground floor on most, a parapet hiding the roof's foot
    if (!tall && (houseLike || P.terrace || P.rowLike) && H < 16 && P.style === STYLE.BRICK) {
      if (r3 < 0.6) P.bits |= FBIT.BASE1;
      P.F[0] = 2.4 + r3 * 0.4; P.F[1] = 0.36; P.F[2] = 0.66; P.bits |= FBIT.WHITE;
      P.parapet = P.pitchedRoof && hashf(P.id, 150) < 0.75;
    }
  } else if (city === 'sf') {
    if (!tall && H < 18 && area < 900 && P.style !== STYLE.GLASS) {
      own(); P.style = STYLE.STUCCO; P.palette = LOOK_PAL.sf; P.look = LOOK.SF;
      // the Sunset and the Richmond (the avenues west of about -122.455): 1920s to 1950s stucco rows, flat behind a
      // parapet, a garage under each (the Victorians are further east)
      const lon = frame.lon + P.cx / (111320 * Math.cos(frame.lat * D2R)), lat = frame.lat - P.cz / 110574;
      P.avenues = lon < -122.455 && lat > 37.735 && lat < 37.79;
      if (r2 < 0.55 && !P.avenues) P.style = STYLE.WOOD; // (Victorians are wood, clapboard and shingle)
      if (dense || P.avenues) flatRoof(P.avenues);
    }
  } else if (city === 'nyc') {
    P.bits &= ~(FBIT.CROSS | FBIT.TIMBER);
    if (tall) {
      if (P.style !== STYLE.GLASS) P.style = r1 < 0.6 ? STYLE.GLASS : STYLE.STONE;
      if (P.style === STYLE.STONE) { P.palette = LOOK_PAL.nycstone; P.bits &= ~FBIT.RIBBON; }
    } else if (H < 21 && H >= 8 && area < 450 && (FLATS.has(t) || houseLike || t === 'yes' || t === 'terrace') && !b.shop && P.ground !== GROUND.SHOP && !OFFICE.has(t) && !ctx.midtown) {
      if (!b.roofShape) setShape(P, 'flat'); // (flat behind their cornices: a bright tar roof and its shade read as a pitch)
      // Brooklyn's and Harlem's row houses: brownstone, limestone or brick (some painted), a stoop up to a parlour
      // floor half a storey up, a cornice along the top
      const k = hashf(P.id, 140);
      if (k < 0.5) { P.style = STYLE.STONE; P.palette = LOOK_PAL.brownstone; }
      else if (k < 0.66) { P.style = STYLE.STONE; P.palette = LOOK_PAL.limestone; }
      else if (k < 0.86) { P.style = STYLE.BRICK; P.palette = LOOK_PAL.nycbrick; }
      else { P.style = STYLE.STUCCO; P.palette = LOOK_PAL.painted; }
      P.look = LOOK.SASH; P.bits |= FBIT.SURROUND | FBIT.WHITE; P.F[1] = 0.42; P.F[2] = 0.66;
      P.stoop = P.front >= 0 && P.frontLen >= 4.5; P.cornice = true; if (P.stoop) P.ground = GROUND.NONE;
    } else if (H < 26 && (FLATS.has(t) || houseLike || t === 'yes') && r2 < 0.35) {
      P.style = STYLE.STONE; P.palette = LOOK_PAL.brownstone; P.look = LOOK.SASH; P.bits |= FBIT.SURROUND;
    } else { P.style = STYLE.BRICK; P.palette = LOOK_PAL.nycbrick; if (r3 < 0.5) P.bits |= FBIT.SURROUND; P.cornice = H < 30 && r4of(P) < 0.6; }
    if (!tall) flatRoof();
    // tenements of five or six floors: a fire escape down the front; water tanks on the roofs of the taller ones
    if (P.style === STYLE.BRICK && P.H > 13 && P.H < 30 && r4of(P) < 0.6) P.fire = true;
    if (P.shape === 'flat' && P.H > 18 && P.H < 70 && area > 180 && area < 4000 && P.style !== STYLE.GLASS && hashf(P.id, 61) < 0.3) P.waterTower = true;
  } else if (city === 'japan') {
    if (!tall && P.style !== STYLE.GLASS) {
      own();
      if (houseLike) {
        P.style = r1 < 0.6 ? STYLE.STUCCO : STYLE.WOOD; P.palette = LOOK_PAL.jphouse; P.look = LOOK.JAPAN;
        // (a third are newer flat-roofed boxes, white or pale grey, with a water tank on the roof)
        if (!b.roofShape && P.roofSrc !== 'img' && hashf(P.id, 162) < 0.32) { setShape(P, 'flat'); P.style = STYLE.STUCCO; P.palette = hex(['#efeee9', '#e4e3de', '#d9d8d2', '#f2f0ea']); P.roofTank = area > 40; }
        if (P.rowLike) P.terrace = true;
      }
      else { P.style = r1 < 0.55 ? STYLE.CONCRETE : STYLE.BRICK; P.palette = LOOK_PAL.jpn; P.look = LOOK.JAPAN; }
    }
  } else if (city === 'alps') {
    if (P.elev > 700 && (houseLike || (H < 18 && area < 1200))) {
      // chalets: white render below, dark wood above, balconies, wide low roofs
      own(); P.style = STYLE.STUCCO; P.palette = LOOK_PAL.alpine; P.look = LOOK.ALPINE;
      if (!b.roofShape && P.holes.length === 0 && P.roofSrc !== 'img') { setShape(P, 'gabled'); P.pitch = 18 + r3 * 7; P.overhang = 1.0 + r1 * 0.5; }
    } else P.palette = LOOK_PAL.render;
  } else if (city === 'med') {
    if (P.style !== STYLE.GLASS) { P.style = STYLE.STUCCO; P.palette = LOOK_PAL.med; }
  } else if (city === 'amsterdam') {
    // canal houses: brick, tall windows in white frames, and a shaped gable to the street
    if (!tall && H < 26 && area < 700 && P.style !== STYLE.GLASS) {
      P.style = r2 < 0.82 ? STYLE.BRICK : STYLE.STUCCO; P.palette = P.style === STYLE.BRICK ? LOOK_PAL.nlBrick : LOOK_PAL.render;
      P.F[0] = 1.7 + r3 * 0.5; P.F[1] = 0.56; P.F[2] = 0.68; P.bits = (P.bits & ~3) | (r1 < 0.7 ? FBIT.WHITE : FBIT.BLACK) | FBIT.SURROUND;
      P.canal = true;
    }
  }
}
const r4of = (P) => hashf(P.id, 44);
const r5of = (P) => hashf(P.id, 45);

const PAL = {
  [STYLE.BRICK]: ['#9a5b45', '#8a4c3a', '#a8664c', '#7d4636', '#b39672', '#a08262', '#6f4a3c', '#c19d7c', '#8f6a55'],
  [STYLE.CONCRETE]: ['#c9c5bd', '#b9b5ad', '#d6d0c4', '#a9a7a2', '#cfc6b4', '#bfb6a5', '#9c9a96', '#dcd8cf', '#8f8d88'],
  [STYLE.GLASS]: ['#7e8a90', '#5d666b', '#9aa3a8', '#3e464b', '#b4b8b8'],
  [STYLE.STUCCO]: ['#e6dfd0', '#ddd0b6', '#d9cba0', '#cdbb98', '#d9c6bb', '#c3cac9', '#e8e4dc', '#c8b292', '#b9a78c', '#d6d3c9', '#bfb6a6', '#a99f8f'],
  [STYLE.WOOD]: ['#e2dfd6', '#bcc3c3', '#9aabab', '#cbbf9d', '#aca58e', '#84939b', '#d6c8a8', '#8e9a82', '#cdc6b8', '#7d8a8f', '#b7a68a'],
  [STYLE.METAL]: ['#b4b8ba', '#a3a8a8', '#c8c6bc', '#8e9496', '#c2b8a4', '#d0d2cf'],
  [STYLE.STONE]: ['#cfc3a8', '#bfb39a', '#d8d0bc', '#a89c88', '#e0d8c6'],
};
const PAL_LIN = {};
// linear (Color stores linear), darkened: sunlit walls under a sun of 3 read about as bright as the photographs
for (const k in PAL) PAL_LIN[k] = PAL[k].map(h => new THREE.Color(h).multiplyScalar(0.62));

function materialStyle(m) {
  if (!m) return null;
  m = String(m).toLowerCase();
  if (/brick/.test(m)) return STYLE.BRICK;
  if (/glass|mirror/.test(m)) return STYLE.GLASS;
  if (/concrete|cement|reinforced|panel/.test(m)) return STYLE.CONCRETE;
  if (/plaster|stucco|render|adobe/.test(m)) return STYLE.STUCCO;
  if (/wood|timber|vinyl|siding|log/.test(m)) return STYLE.WOOD;
  if (/metal|steel|alumin|tin/.test(m)) return STYLE.METAL;
  if (/stone|granite|marble|sandstone|limestone/.test(m)) return STYLE.STONE;
  return null;
}

// a house's walls, by how houses are built in its zone (r a random number of the building)
function houseStyle(P, ctx, r) {
  const z = ctx.zone, old = P.b.year && P.b.year < 1940;
  switch (z) {
    case 'usw': return r < 0.68 ? [STYLE.STUCCO, LOOK_PAL.usStucco] : r < 0.94 ? [STYLE.WOOD, LOOK_PAL.usSiding] : [STYLE.BRICK, LOOK_PAL.usBrick];
    case 'uss': return r < 0.5 ? [STYLE.BRICK, LOOK_PAL.usBrick] : r < 0.82 ? [STYLE.WOOD, LOOK_PAL.usSiding] : r < 0.93 ? [STYLE.STONE, LOOK_PAL.limestone] : [STYLE.STUCCO, LOOK_PAL.usStucco];
    case 'usn': return r < (old ? 0.8 : 0.68) ? [STYLE.WOOD, LOOK_PAL.usSiding] : [STYLE.BRICK, LOOK_PAL.usBrick];
    case 'uk': return r < 0.7 ? [STYLE.BRICK, r < 0.45 ? LOOK_PAL.lred : LOOK_PAL.lstock] : [STYLE.STUCCO, LOOK_PAL.lstucco];
    case 'nl': case 'be': return r < 0.85 ? [STYLE.BRICK, LOOK_PAL.nlBrick] : [STYLE.STUCCO, LOOK_PAL.render];
    // (brick in the north, Hamburg to Berlin; render in the south)
    case 'de': return r < (frame.lat > 52.2 ? 0.5 : 0.94) ? [STYLE.STUCCO, LOOK_PAL.deRender] : [STYLE.BRICK, LOOK_PAL.deBrick];
    case 'alps': return [STYLE.STUCCO, LOOK_PAL.alpine];
    case 'scand': return r < 0.75 ? [STYLE.WOOD, LOOK_PAL.scand] : [STYLE.STUCCO, LOOK_PAL.render];
    case 'fr': return r < 0.75 ? [STYLE.STUCCO, LOOK_PAL.frHouse] : [STYLE.STONE, LOOK_PAL.limestone];
    case 'med': return [STYLE.STUCCO, LOOK_PAL.med];
    case 'jp': return r < 0.6 ? [STYLE.STUCCO, LOOK_PAL.jphouse] : [STYLE.WOOD, LOOK_PAL.jphouse];
    default: return r < 0.5 ? [STYLE.STUCCO, null] : [STYLE.BRICK, null];
  }
}

function pickStyle(P, ctx, r) {
  const b = P.b, t = P.t, reg = ctx.region, H = P.H, area = P.area;
  const ms = materialStyle(b.material);
  if (ms !== null) return ms;
  if (P.houseLike || HOUSE.has(t) || (t === 'residential' && area < 260)) { const [s, pal] = houseStyle(P, ctx, r); if (!P.palette && pal) P.palette = pal; return s; }
  if (WORKS.has(t) || SMALL.has(t)) return t === 'garage' || t === 'garages' || t === 'shed' ? (reg === 'uk' ? STYLE.BRICK : STYLE.STUCCO) : (t === 'barn' || t === 'stable' || t === 'cowshed' ? STYLE.WOOD : STYLE.METAL);
  if (CIVIC.has(t)) return r < 0.7 ? STYLE.STONE : STYLE.BRICK;
  // towers (a church's, a town hall's): slender and stone, never a glass office tower
  if (P.tower) return STYLE.STONE;
  if (H > 48) return r < 0.6 ? STYLE.GLASS : (r < 0.85 ? STYLE.CONCRETE : STYLE.STONE);
  if (OFFICE.has(t)) return H > 25 && r < 0.45 ? STYLE.GLASS : STYLE.CONCRETE;
  const z = ctx.zone;
  // the small older buildings of a European town (mapped as 'yes'): as its houses
  if (P.pitchedRoof && H < 20 && area < 900 && /^(de|nl|be|fr|alps|scand|uk)$/.test(z)) { const [s, pal] = houseStyle(P, ctx, r); if (!P.palette && pal) P.palette = pal; return s; }
  if (FLATS.has(t)) {
    if (reg === 'uk') return r < 0.65 ? STYLE.BRICK : (r < 0.85 ? STYLE.STUCCO : STYLE.CONCRETE);
    if (reg === 'jp') return r < 0.6 ? STYLE.CONCRETE : STYLE.STUCCO;
    if (reg === 'us') return r < 0.5 ? STYLE.STUCCO : (r < 0.8 ? STYLE.BRICK : STYLE.WOOD);
    if (z === 'nl' || z === 'be' || (z === 'de' && frame.lat > 52.2)) return r < 0.6 ? STYLE.BRICK : STYLE.STUCCO;
    if (z === 'de' || z === 'alps') return r < 0.85 ? STYLE.STUCCO : STYLE.CONCRETE;
    return r < 0.5 ? STYLE.STUCCO : STYLE.CONCRETE;
  }
  if (reg === 'uk') return r < 0.5 ? STYLE.BRICK : (r < 0.75 ? STYLE.STUCCO : STYLE.STONE);
  if (reg === 'jp') return r < 0.55 ? STYLE.CONCRETE : (r < 0.85 ? STYLE.STUCCO : STYLE.GLASS);
  if (reg === 'us') return H > 14 ? (r < 0.45 ? STYLE.CONCRETE : r < 0.75 ? STYLE.BRICK : STYLE.STONE) : (r < 0.45 ? STYLE.STUCCO : r < 0.75 ? STYLE.CONCRETE : STYLE.BRICK);
  if (z === 'nl') return r < 0.6 ? STYLE.BRICK : STYLE.CONCRETE;
  // (brick in the north of Germany; render and stone further south, in the Alps and in France: a red-brick block
  // stood on Rothenburg's market square)
  if ((z === 'de' && frame.lat <= 52.2) || z === 'alps' || z === 'fr') return r < 0.4 ? STYLE.CONCRETE : (r < 0.9 ? STYLE.STUCCO : STYLE.STONE);
  return r < 0.4 ? STYLE.CONCRETE : (r < 0.7 ? STYLE.STUCCO : STYLE.BRICK);
}

function pickGround(P, style, ctx, r) {
  const b = P.b, t = P.t, H = P.H;
  if (b.minHeight > 0.5 || P.minH > 0.5) return GROUND.NONE;
  // what the map says is on the ground floor first: shops, cafes, pubs and banks inside the outline
  if (b.shop && !P.houseLike) return GROUND.SHOP;
  if (b.shop && P.houseLike && P.area > 40) return GROUND.SHOP;
  if (HOUSE.has(t)) return GROUND.DOOR;
  if (SHOPS.has(t)) return GROUND.SHOP;
  if (WORKS.has(t)) return GROUND.ROLLUP;
  if (OFFICE.has(t) || style === STYLE.GLASS) return GROUND.LOBBY;
  if (CIVIC.has(t)) return GROUND.DOOR;
  // a built up centre: many street fronts are shops (few guessed where the map's own shops are known, none on
  // what Overture calls residential)
  if (b.subtype === 'residential' || ctx.city === 'sf' && P.area < 400) return FLATS.has(t) || ctx.density > 0.3 ? GROUND.DOOR : GROUND.NONE;
  const share = ctx.shopsKnown ? 0.1 : 0.7;
  // (a small building's door is a door, not an office lobby)
  // (homes are never shop fronts unless the map has a shop in them, nor a lobby unless they are big)
  const home = FLATS.has(t) || HOUSE.has(t);
  // (a canal house's ground floor is a front door and windows, as the map's shops aside most are)
  if ((ctx.zone === 'nl' || ctx.zone === 'be') && P.area < 260 && H < 24) return GROUND.DOOR;
  if (ctx.density > 0.35 && H > 7) return home ? (P.area < 700 ? GROUND.DOOR : GROUND.LOBBY) : r < share ? GROUND.SHOP : (P.area < 300 && H < 19 ? GROUND.DOOR : GROUND.LOBBY);
  if (FLATS.has(t)) return r < 0.3 && ctx.density > 0.2 && !ctx.shopsKnown ? GROUND.SHOP : GROUND.DOOR;
  return r < 0.4 ? GROUND.DOOR : GROUND.NONE;
}

// ---------- roofs ----------
const ROOF_NORM = {
  gabled: 'gabled', gable: 'gabled', hipped: 'hipped', hip: 'hipped', 'half-hipped': 'half-hipped', half_hipped: 'half-hipped', 'hipped-and-gabled': 'half-hipped',
  side_hipped: 'hipped', crosspitched: 'hipped', pyramidal: 'pyramidal', pyramid: 'pyramidal', skillion: 'skillion', lean_to: 'skillion', sawtooth: 'skillion',
  gambrel: 'gambrel', saltbox: 'saltbox', gabled_height_moved: 'saltbox', mansard: 'mansard', dome: 'dome', spherical: 'dome', onion: 'onion', cone: 'cone', conical: 'cone',
  round: 'round', flat: 'flat', butterfly: 'flat', many: 'flat', double_saltbox: 'gabled', quadruple_saltbox: 'hipped', dutch: 'hipped', pitched: 'gabled',
};
const RADIAL = new Set(['dome', 'onion', 'cone']);
// radial roofs: rings of (scale about the middle, height share)
const PROFILE = {
  dome: [[1, 0], [0.97, 0.26], [0.87, 0.5], [0.71, 0.71], [0.5, 0.87], [0.26, 0.97], [0, 1]],
  onion: [[1, 0], [1.13, 0.12], [1.18, 0.25], [1.1, 0.4], [0.86, 0.55], [0.55, 0.68], [0.28, 0.8], [0.12, 0.9], [0, 1]],
  cone: [[1, 0], [0, 1]],
};

function setShape(P, shape, across) {
  P.shape = shape;
  if (across !== undefined) P.across = across;
  P.ax = axesOf(P);
}
// the roof's axes: A along the ridge, P across it (down the slopes), from roof:direction, roof:orientation, the
// picture, or the long side
function axesOf(P) {
  const ob = P.ob, b = P.b;
  if (b.roofDirection != null && isFinite(b.roofDirection)) {
    const a = b.roofDirection * D2R, d = [Math.sin(a), -Math.cos(a)]; // the way the slope faces (local x east, z south)
    return boxAlong(P.outer, [-d[1], d[0]]);
  }
  if (P.across) return { cx: ob.cx, cz: ob.cz, A: ob.P, P: ob.A, hl: ob.hw, hw: ob.hl };
  return ob;
}
function pitchOf(P, ctx) {
  if (P.b.roofAngle && P.b.roofAngle > 3 && P.b.roofAngle < 80) return P.b.roofAngle;
  const z = ctx.zone, r = P.r3;
  const base = { usw: 22, uss: 25, usn: 33, uk: 38, nl: 47, be: 45, de: 44, alps: 24, scand: 34, fr: 36, med: 19, jp: 26 }[z] ?? 29;
  return base + (r - 0.5) * 9 - (P.houseLike ? 0 : 4);
}

// the roof's height over the eave: roofH * (1 - max_i t_i(p)), each t_i linear in p (x, z)
function roofTerms(P) {
  const shape = P.shape, X = P.ax || P.ob;
  if (!X || shape === 'flat' || shape === 'perim' || RADIAL.has(shape)) return null;
  const { cx, cz, A, hl, hw } = X, Pp = X.P;
  const lin = (gx, gz, k, s) => ({ g: [gx / s, gz / s], c: (-(gx * cx + gz * cz) - k) / s });
  switch (shape) {
    case 'gabled': return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw)];
    case 'hipped': case 'mansard': { const k = Math.max(0, hl - hw); return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw), lin(A[0], A[1], k, hw), lin(-A[0], -A[1], k, hw)]; }
    // (the hips only over the top third of the gable ends)
    case 'half-hipped': { const k = Math.max(0, hl - 0.35 * hw); return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw), lin(A[0], A[1], k, hw), lin(-A[0], -A[1], k, hw)]; }
    case 'pyramidal': return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw), lin(A[0], A[1], 0, hl), lin(-A[0], -A[1], 0, hl)];
    case 'skillion': {
      // downhill towards roof:direction when given (the axes' P then points that way), else either way
      const s = P.b.roofDirection != null ? 1 : (P.r3 < 0.5 ? 1 : -1);
      return [lin(-s * Pp[0], -s * Pp[1], -hw, 2 * hw)];
    }
    case 'gambrel': {
      // a steep lower slope over the outer 45% of each side, a shallow upper one: 1 - f is max(1.378 d - 0.378, 0.691 d)
      const out = [];
      for (const sg of [1, -1]) { out.push(lin(sg * Pp[0] * 1.378, sg * Pp[1] * 1.378, 0.378 * hw, hw)); out.push(lin(sg * Pp[0] * 0.691, sg * Pp[1] * 0.691, 0, hw)); }
      return out;
    }
    case 'saltbox': {
      const o = 0.32 * hw;
      return [lin(Pp[0], Pp[1], o, hw - o), lin(-Pp[0], -Pp[1], -o, hw + o)];
    }
    case 'round': {
      // a barrel vault: chords of 1 - sqrt(1 - d^2) on each side
      const D = [0, 0.45, 0.7, 0.86, 0.96, 1], f = d => 1 - Math.sqrt(Math.max(0, 1 - d * d)), out = [];
      for (const sg of [1, -1]) for (let i = 0; i + 1 < D.length; i++) {
        const m = (f(D[i + 1]) - f(D[i])) / (D[i + 1] - D[i]), c0 = f(D[i]) - m * D[i];
        out.push(lin(sg * Pp[0] * m, sg * Pp[1] * m, -c0 * hw, hw));
      }
      return out;
    }
  }
  return null;
}
const termAt = (t, x, z) => t.g[0] * x + t.g[1] * z + t.c;
// a mansard's steep band is about 1.7 m deep: past it the roof is flat
const mansardK = (P) => Math.max(1, (P.ax || P.ob).hw / 1.7);
function roofAt(P, terms, x, z, below = false) {
  if (!terms) return 0;
  let m = -Infinity;
  for (const t of terms) { const v = termAt(t, x, z); if (v > m) m = v; }
  if (P.shape === 'mansard') return P.roofH * Math.max(0, Math.min(1, (1 - m) * mansardK(P)));
  if (below) return P.roofH * Math.min(1, 1 - m);
  return P.roofH * Math.max(0, Math.min(1, 1 - m));
}
// a radial roof's height share at (x, z): by the distance from the middle against the ring's mean radius
function radialAt(P, x, z) {
  const prof = PROFILE[P.shape], d = Math.hypot(x - P.rc[0], z - P.rc[1]) / Math.max(0.5, P.rR);
  if (d >= prof[0][0]) return 0;
  for (let i = prof.length - 1; i > 0; i--) {
    // the profile's scale goes down as it rises (the onion's first rings go out first)
    const [sa, ha] = prof[i], [sb, hb] = prof[i - 1];
    if (d <= sb && d >= sa) return ha + (hb - ha) * (d - sa) / Math.max(1e-6, sb - sa);
  }
  return 1;
}

// ---------- the plan of one building ----------
// heights, roof and look of one record; null when it cannot be drawn
function plan(b, ctx) {
  let outer = cleanRing(b.outer || []);
  if (outer.length < 3) return null;
  if (area2(outer) > 0) outer.reverse();          // counter-clockwise from above (negative shoelace, z south)
  const area = -area2(outer);
  if (area < 3) return null;
  let holes = (b.holes || []).map(cleanRing).filter(h => h.length >= 3);
  holes = holes.map(h => (area2(h) < 0 ? h.slice().reverse() : h));
  const id = typeof b.id === 'number' ? b.id : hashf(String(b.id).length) * 1e9;
  const r1 = hashf(id, 1), r2 = hashf(id, 2), r3 = hashf(id, 3), r4 = hashf(id, 4), r5 = hashf(id, 5), r6 = hashf(id, 6);
  // (Overture's class for a record the map calls just 'yes'; its subtype as a last hint)
  let t = b.type || 'yes';
  if (t === 'yes' && b.subtype) t = { residential: 'residential', commercial: 'commercial', industrial: 'industrial', outbuilding: 'shed', agricultural: 'barn', religious: 'church', education: 'school', civic: 'civic', transportation: 'transportation' }[b.subtype] || 'yes';
  const ob = obb(outer);
  if (!ob) return null;
  let cx = 0, cz = 0; for (const p of outer) { cx += p[0]; cz += p[1]; } cx /= outer.length; cz /= outer.length;
  const rect = area / ob.area > 0.86;
  const tagH = b.height;
  const smallLow = area > 30 && area < 400 && (tagH == null || tagH < 10) && !(b.levels > 3);
  const houseLike = HOUSE.has(t) || (smallLow && ctx.density < 0.4 && /^(yes|residential|garage|shed|semidetached_house|detached|house|bungalow|cabin)$/.test(t));
  const P = { b, id, t, outer, holes, area, ob, cx, cz, rect, r1, r2, r3, r4, r5, r6, houseLike, look: 0, palette: null, bits: 0, F: [0, 0, 0, 0], roofSrc: null, across: false };
  const g0 = ctx.groundAt(outer[0][0], outer[0][1]);
  P.elev = g0 == null ? 0 : g0 + (frame.h || 0);
  // the front: the outer edge that faces the nearest road (else the longest)
  P.front = frontEdge(P, ctx);
  // a row of houses drawn as one outline (a terrace): long and shallow along its front
  if (P.front >= 0) {
    const p = outer[P.front], q = outer[(P.front + 1) % outer.length], fl = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const depth = area / Math.max(1, fl);
    P.frontLen = fl; P.depth = depth;
    P.rowLike = fl > 11 && depth > 6 && depth < 17 && fl > depth * 1.15 && area < 2500 && (houseLike || FLATS.has(t) || t === 'yes' || t === 'terrace');
  }
  P.terrace = t === 'terrace' || (P.rowLike && (ctx.zone === 'uk' || ctx.zone === 'nl' || ctx.zone === 'be') && (houseLike || t === 'yes' || FLATS.has(t)) && !(b.levels > 5));

  // roof shape: tagged, else pitched for houses and small low buildings, else a candidate the picture decides
  let shape = null;
  if (b.roofShape) { const k = String(b.roofShape).toLowerCase(); shape = ROOF_NORM[k] || (/gab|hip|pitch|sadd/.test(k) ? 'gabled' : 'flat'); P.roofSrc = 'tag'; }
  const eurOld = /^(de|nl|be|fr|alps|scand|uk|med)$/.test(ctx.zone);
  // a tower: tall over a small footprint (a church's or a town hall's, a campanile)
  const hEst = tagH ?? (b.levels ? b.levels * LV : null);
  P.tower = hEst != null && area < 260 && hEst > 22 && hEst > Math.sqrt(area) * 2.6 && !OFFICE.has(t) && !FLATS.has(t) && (eurOld || CIVIC.has(t) || t === 'church' || t === 'tower');
  const notBig = !SHOPS.has(t) && !OFFICE.has(t) && !(WORKS.has(t) && area > 1500) && !/^(school|hospital|university|college|stadium|train_station|parking)$/.test(t);
  if (!shape && (t === 'houseboat' || area < 12)) { shape = 'flat'; P.roofSrc = 'guess'; }
  if (!shape) {
    if (P.tower && eurOld) { shape = 'pyramidal'; P.spire = true; }
    // a narrow deep house of the Low Countries (a canal house): a gable to the street, its ridge running back
    else if ((ctx.zone === 'nl' || ctx.zone === 'be') && P.front >= 0 && P.frontLen < 10 && P.depth > P.frontLen * 1.2 && area < 450 && notBig && !(tagH > 30) && !P.rowLike) {
      shape = 'gabled'; P.cand = 'house';
      const p = outer[P.front], q = outer[(P.front + 1) % outer.length], fl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      P.across = Math.abs(((q[0] - p[0]) * ob.A[0] + (q[1] - p[1]) * ob.A[1]) / fl) > 0.7; // ridge at right angles to the front
    }
    else if (houseLike && area < 700 && area / ob.area > 0.55) { shape = guessHouseRoof(P, ctx); P.cand = 'house'; }
    // (churches and town halls of old towns: pitched more often than not; the picture decides)
    else if (eurOld && (CIVIC.has(t) || t === 'church') && area < 6000 && area / ob.area > 0.5) { shape = 'flat'; P.cand = 'maybe'; }
    else if (notBig && area > 25 && area < (eurOld ? (ctx.density > 0.25 ? 3000 : 1400) : 600) && (tagH == null || tagH < (eurOld ? 30 : 22)) && !(b.levels > (eurOld ? 7 : 5)) && area / ob.area > 0.5) { shape = 'flat'; P.cand = 'maybe'; }
    else shape = 'flat';
    P.roofSrc = 'guess';
  }
  if (holes.length && shape !== 'flat') shape = 'flat';
  if (b.roofOrientation) P.across = String(b.roofOrientation).toLowerCase() === 'across';
  setShape(P, shape);
  P.pitch = pitchOf(P, ctx);
  finish(P, ctx);
  return P;
}

// a house's roof before the picture is read: by how houses are roofed in its zone, the ridge along the street
// where houses face it with their long side
function guessHouseRoof(P, ctx) {
  const z = ctx.zone, r = P.r2;
  const hip = { usw: 0.55, uss: 0.5, usn: 0.25, uk: 0.35, nl: 0.06, be: 0.1, de: 0.08, alps: 0.03, scand: 0.08, fr: 0.45, med: 0.5, jp: 0.5 }[z] ?? 0.4;
  let shape = !P.rect ? 'hipped' : r < hip ? 'hipped' : 'gabled';
  // a row of houses drawn as one outline: a ridge along the row when it is straight, else flat behind parapets
  // (and London's taller Victorian terraces hide their roofs behind parapets)
  if (P.rowLike || P.terrace) shape = P.rect && !(ctx.city === 'london' && P.b.levels >= 3) ? 'gabled' : 'flat';
  if (z === 'de' && shape === 'gabled' && P.r5 < 0.12) shape = 'half-hipped';
  if (z === 'usn' && shape === 'gabled' && P.r5 < 0.06) shape = 'gambrel';
  // which way the ridge runs: along the street (the usual), or gable to the street (row houses in SF, Amsterdam,
  // old German towns; a third of houses in the US North East)
  const gableToStreet = ctx.city === 'sf' || z === 'nl' || (z === 'de' && ctx.density > 0.3) || (z === 'usn' && P.r6 < 0.33) || (z === 'jp' && P.r6 < 0.4);
  if (P.front >= 0) {
    const p = P.outer[P.front], q = P.outer[(P.front + 1) % P.outer.length], fx = q[0] - p[0], fz = q[1] - p[1], fl = Math.hypot(fx, fz) || 1;
    const alongLong = Math.abs((fx * P.ob.A[0] + fz * P.ob.A[1]) / fl) > 0.7; // the front runs along the long side
    // ridge parallel to the front: along the long axis when the front is the long side
    P.across = gableToStreet ? alongLong : !alongLong;
  }
  return shape;
}

function frontEdge(P, ctx) {
  const outer = P.outer;
  let rp = null; try { rp = ctx.nearRoad ? ctx.nearRoad(P.cx, P.cz) : null; } catch (e) { rp = null; }
  let best = -Infinity, front = -1;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i], q = outer[(i + 1) % outer.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 2.5) continue;
    const nx = -dz / len, nz = dx / len;
    let sc = Math.min(len, 14) * 0.05;
    if (rp) { const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, rx = rp.x - mx, rz = rp.z - mz, rl = Math.hypot(rx, rz) || 1; sc += (nx * rx + nz * rz) / rl * 2 - rl * 0.01; }
    if (sc > best) { best = sc; front = i; }
  }
  P.roadDist = rp ? rp.dist : null;
  return front;
}

// heights from the roof (called again whenever the roof changes)
function finish(P, ctx) {
  const b = P.b, t = P.t, houseLike = P.houseLike, area = P.area, shape = P.shape, X = P.ax || P.ob;
  let minH = b.minHeight || (b.minLevel ? b.minLevel * LV : 0);
  let roofH = b.roofHeight ?? (b.roofLevels ? b.roofLevels * LV : null);
  if (roofH == null && shape !== 'flat') {
    const tp = Math.tan(clamp(P.pitch, 8, 65) * D2R);
    if (shape === 'skillion') roofH = Math.min(3, X.hw * 2 * Math.tan(12 * D2R));
    else if (shape === 'dome') roofH = Math.max(1.5, Math.min(X.hw, X.hl) * 0.9);
    else if (shape === 'onion') roofH = Math.max(2, Math.min(X.hw, X.hl) * 2.2);
    else if (shape === 'cone') roofH = Math.max(1.5, Math.min(X.hw, X.hl) * 1.7);
    else if (shape === 'round') roofH = X.hw * 0.55;
    else if (shape === 'mansard') roofH = null; // below, from the height
    else if (shape === 'perim') roofH = P.perimMan ? null : P.perimW * tp;
    else if (P.spire) roofH = Math.max(3, Math.min(X.hw, X.hl) * 2 * (1.1 + P.r3 * 0.9));
    else roofH = Math.min(houseLike ? 6.5 : 9, X.hw * tp * (shape === 'gambrel' ? 1.15 : 1));
  }
  if (shape === 'flat') roofH = 0;

  let H = b.height;
  let levels = b.levels;
  let realH = H != null && ((b.tags && b.tags.height != null) || b.heightReal);
  // (the vector tiles make a height of 3.66 m a floor where only the floors are known: no height at all)
  if (realH && levels && !(b.tags && b.tags.height != null) && Math.abs(H - levels * 3.66) < 0.6) { H = null; realH = false; }
  // the vector tiles give 5 m to every building they know no height for: for anything but a house that is no
  // height at all (half of a Paris block came out one storey tall), so guess it from the type and the area
  if (H === 5 && !realH && !houseLike && levels == null && !(b.tags && (b.tags.height || b.tags['building:levels']))) H = null;
  if ((shape === 'mansard' || shape === 'perim') && roofH == null) roofH = H != null ? clamp(H * 0.17, 3.0, 4.5) : levels ? 3.4 : 3.6;
  // a house whose only height is a vector tile's default (5 m) or a low guess: take it as the walls' height and
  // put the roof on top, one storey or two by how houses are built there
  if (houseLike && shape !== 'flat' && H != null && !realH && levels == null && b.roofHeight == null && H <= 7.5) {
    const two = { usw: 0.3, uss: 0.35, usn: 0.62, uk: 0.88, nl: 0.75, be: 0.7, de: 0.75, alps: 0.7, scand: 0.55, fr: 0.6, med: 0.55, jp: 0.85 }[ctx.zone] ?? 0.3;
    let eaveH = Math.abs(H - 5) < 0.01 ? (P.r4 < two && !(t === 'bungalow') ? (ctx.zone === 'uk' ? 6.1 : 5.6) : 3.1) : Math.max(2.8, H - 0.4);
    // (Tokyo's houses: one storey to three)
    if (ctx.zone === 'jp' && Math.abs(H - 5) < 0.01) { const k = hashf(P.id, 160); eaveH = k < 0.14 ? 3.1 : k < 0.7 ? 5.8 : 8.4; }
    H = eaveH + roofH;
  }
  if (ctx.zone === 'jp' && houseLike && shape === 'flat' && !realH && levels == null && H != null && Math.abs(H - 5) < 0.01) { const k = hashf(P.id, 160); H = k < 0.15 ? 3.2 : k < 0.7 ? 6.0 : 8.8; }
  // a measured height on a house is to the top of its roof: the roof takes its share of it, and leaves the walls
  // room for the floors the map says it has
  if (realH && shape !== 'flat' && roofH > 0) {
    const room = H - minH;
    if (roofH > room * 0.45) roofH = Math.max(room * 0.3, Math.min(roofH, room - 2.5));
    if (levels) { const need = levels * (houseLike ? 2.55 : 3.0) + 0.3; if (room - roofH < need) roofH = clamp(room - need, Math.min(roofH, 0.8), roofH); }
    // ...and a pitched roof over few floors takes what the floors leave (Rothenburg's town hall: three floors under a
    // steep roof, 30 m to the ridge, came out as eight floors of wall with a low roof)
    if (levels && levels <= 6 && !RADIAL.has(shape) && !/^(skillion|mansard|round|perim)$/.test(shape) && !/^(church|cathedral|chapel)$/.test(t)) {
      const most = levels * (houseLike ? 3.1 : 4.6) + 1.0;
      if (room - roofH > most) roofH = Math.min(room * 0.62, room - most);
    }
  }
  if (H == null && levels != null) H = levels * LV + (roofH || 0) + (levels > 0 && !HOUSE.has(t) ? 0.6 : 0);
  if (H == null) {
    let d;
    if (HOUSE.has(t)) d = t === 'bungalow' ? 4 : (t === 'terrace' ? 9 : 6.2) + (roofH || 0) * 0.5;
    else if (SMALL.has(t)) d = 3;
    else if (FLATS.has(t)) d = area < 200 ? 9 : 13;
    else if (SHOPS.has(t)) d = area > 3000 ? 8 : 10;
    else if (OFFICE.has(t)) d = 16;
    else if (WORKS.has(t)) d = 8;
    else if (P.jpTemple) d = 7 + P.r4 * 3;
    else if (CIVIC.has(t)) d = t === 'church' || t === 'cathedral' || P.church ? 16 : 11;
    else if (t === 'school' || t === 'university' || t === 'college' || t === 'hospital') d = 11;
    else d = houseLike ? 6.5 : 8;
    // no height and no levels in a dense centre: real buildings there are taller than the type suggests, by how big
    // their footprint is (a packed street of small houses stays low: Tokyo's, London's terraces)
    const jp = ctx.zone === 'jp';
    if (ctx.density > 0.25 && !HOUSE.has(t) && !SMALL.has(t) && area > 40) {
      let g;
      if (jp) { const k = hashf(P.id, 161); g = area < 110 ? [3.4, 6.3, 6.6, 9.2, 12][Math.floor(k * 5)] + P.r4 : area < 220 ? 8.5 + P.r4 * 3 + (k > 0.8 ? 6 : 0) : area < 500 ? 12 + P.r4 * 6 : 14 + ctx.density * 14 + P.r4 * 8; }
      else if (area < 130) g = 8.5 + P.r4 * 4 + ctx.density * 4;
      else if (area < 320) g = 10.5 + P.r4 * 5 + ctx.density * 6;
      else g = ctx.density > 0.4 ? 11 + ctx.density * 12 + P.r4 * 6 : 9 + P.r4 * 4;
      d = Math.max(d, g);
    }
    // (a pitched candidate in an old European town: a house's walls plus its roof)
    if (P.cand === 'maybe' && shape !== 'flat') d = Math.max(d, 6 + (roofH || 0));
    H = d;
  }
  // a roof on posts with no height of its own (toll plaza, petrol station canopy, carport): a slab the car fits under
  if (b.roofOnly && !(minH > 0.5)) { H = t === 'carport' ? 2.9 : Math.max(5.5, Math.min(H || 0, 9)); minH = H - (t === 'carport' ? 0.35 : 0.9); levels = 1; }
  // a houseboat is low and flat; a sliver of a footprint (a few square metres beside a building) a low box
  if (t === 'houseboat') { H = Math.min(H || 3, 3.2); levels = 1; roofH = 0; }
  if (area < 12 && !(realH && H > 4)) { H = Math.min(H || 2.6, 2.6); levels = 1; roofH = Math.min(roofH || 0, 0.8); }
  if (H <= minH + 0.5) H = minH + Math.max(2.5, (levels || 1) * LV);
  if (roofH > (H - minH) * 0.6 && !RADIAL.has(shape) && !P.spire) roofH = (H - minH) * 0.6;
  if (P.spire && roofH > (H - minH) * 0.55 && b.roofHeight == null && realH) roofH = (H - minH) * 0.55;
  if (RADIAL.has(shape) && roofH > (H - minH) * 0.85 && b.roofHeight == null) roofH = (H - minH) * 0.85;
  // (an Amsterdam house with a measured height and no floor count: four floors and a 3 m roof, not two under 7 m)
  if ((ctx.zone === 'nl' || ctx.zone === 'be') && levels == null && realH && shape !== 'flat' && roofH > Math.max(2.6, H * 0.3)) roofH = Math.max(2.6, H * 0.3);
  // (a roof guessed over a height that was the walls': on top of them)
  if (P.addRoof && !realH && roofH > 0) H += roofH;
  const eave = H - roofH;
  if (!levels) levels = Math.max(1, Math.round((eave - 0.5) / (ctx.zone === 'nl' || ctx.zone === 'be' ? 3.1 : houseLike ? 2.8 : 3.4)));
  // (a church's nave is one tall floor whatever the map counts)
  if (P.church) levels = 1;
  let fh = (eave - (b.minLevel ? b.minLevel * LV : 0) - 0.4) / Math.max(1, levels - (b.minLevel || 0));
  // (a one-storey house: its floor is its walls' height, low as a ranch house's are)
  if (levels <= 1 && houseLike && eave > 2.2 && eave < 4.5) fh = Math.max(2.0, eave - 0.3);
  else if (!(fh > (houseLike ? 2.2 : 2.5) && fh < 6)) fh = houseLike ? 2.9 : 3.4;
  if (P.tower) fh = Math.max(fh, 5.5);
  if (P.church) fh = Math.max(3, eave - 0.6);
  Object.assign(P, { minH, roofH, H, eave, levels, fh });
  P.pitchedRoof = shape !== 'flat';
}

// Big footprints nobody tagged and the picture did not read: in European towns their roofs mostly slope up from the
// street walls to a flat or narrow top (London's blocks and long terraces, German blocks; in Paris a mansard all
// round a courtyard block), not flat. A ring w in from the walls makes the slopes (perimRoof in emit).
const PERIM_ZONES = /^(uk|fr|de|nl|be|alps|scand|med)$/;
const NOT_PERIM = /^(school|hospital|university|college|stadium|train_station|parking|retail|supermarket|industrial|warehouse|garages|hangar|sports_hall|sports_centre|grandstand|factory|manufacture|office|bank)$/;
function perimGuess(P, ctx) {
  const b = P.b, t = P.t;
  // (Tokyo's small houses and shop houses: about half under hipped or gabled tile roofs, added over their floors)
  if (ctx.zone === 'jp' && P.shape === 'flat' && P.roofSrc === 'guess' && !b.roofShape && !P.roofTank && P.area > 25 && P.area < 220 && P.H < 12 && P.style !== STYLE.GLASS && hashf(P.id, 163) < 0.5) {
    setShape(P, P.rect && P.r2 < 0.45 ? 'gabled' : 'hipped'); P.pitch = 22 + P.r3 * 8; P.addRoof = true;
    return;
  }
  if (b.roofShape || P.roofSrc === 'tag' || P.roofSrc === 'img' || !PERIM_ZONES.test(ctx.zone)) return;
  if (P.style === STYLE.GLASS || P.core || P.tower || P.spire || P.minH > 0.5 || NOT_PERIM.test(t) || WORKS.has(t)) return;
  const paris = P.look === LOOK.HAUSS;
  if (P.area < (paris ? 300 : 250) || P.H > 34 || P.H < 6) return;
  if (paris) { if (!(P.shape === 'flat' || (P.shape === 'mansard' && !P.rect && P.area >= 750))) return; }
  else if (P.shape !== 'flat' || (SHOPS.has(t) && t !== 'mixed_use' && t !== 'hotel')) return;
  // (outside Paris a share stays flat, as modern blocks are)
  if (!paris && hashf(P.id, 120) > (ctx.zone === 'uk' || ctx.zone === 'fr' ? 0.85 : 0.7)) return;
  const w = paris ? 1.8 : clamp(Math.sqrt(P.area) * 0.18, 3, 5.5);
  if (!perimRings(P.outer, P.holes, w) && !perimRings(P.outer, P.holes, w * 0.6)) return;
  P.perimW = w; P.perimMan = paris; P.dormers = null; P.parisStacks = false;
  setShape(P, 'perim'); P.roofSrc = 'guess';
  (ctx.perims = (ctx.perims || 0) + 1);
}

// ---------- the look of one building: walls, windows, ground floor, the things on it ----------
function decorate(P, ctx) {
  const b = P.b, t = P.t, houseLike = P.houseLike, H = P.H, z = ctx.zone;
  const r1 = P.r1, r2 = P.r2, r3 = P.r3, r5 = P.r5;
  P.palette = null; P.look = 0; P.bits = 0; P.F = [0, 0, 0, 0]; P.fire = false; P.waterTower = false; P.canal = false; P.gableKind = null; P.pastel = false; P.dormers = null; P.zinc = false;
  P.addRoof = false; P.parapet = false; P.stoop = false; P.cornice = false; P.church = false; P.jpTemple = false; P.roofTank = false; P.avenues = false;
  P.overhang = houseLike && P.shape !== 'flat' && !RADIAL.has(P.shape) ? 0.35 + 0.2 * r1 : 0;
  let style = pickStyle(P, ctx, r1);
  P.style = style;
  let ground = houseLike && !(b.minHeight > 0.5) ? GROUND.HOUSE : pickGround(P, style, ctx, r2);
  // a house with a shop in it (a corner shop, a pub): shop fronts on its ground floor
  if (ground === GROUND.HOUSE && b.shop) ground = GROUND.SHOP;
  // (a row of houses: a front door to each)
  if (P.terrace && ground === GROUND.NONE) ground = GROUND.DOOR;
  P.ground = ground;
  if (style === STYLE.GLASS && H < 12) P.style = style = STYLE.CONCRETE;
  // sheds and warehouses are low: anything tall with a works or service tag is an office block in disguise
  if (style === STYLE.METAL && H > 18 && !materialStyle(b.material)) P.style = style = H > 48 && r1 < 0.5 ? STYLE.GLASS : STYLE.CONCRETE;
  P.colour = parseColour(b.colour);
  P.roofColour = parseColour(b.roofColour);

  // windows by how such buildings are built in the zone: [bay width, window width share, window height share]
  const F = P.F;
  if (houseLike) {
    if (/^us/.test(z)) { F[0] = 2.9 + r3 * 0.9; F[1] = 0.3 + r5 * 0.12; F[2] = 0.5; P.bits |= r2 < 0.85 ? FBIT.WHITE : FBIT.BLACK; if (r5 < (z === 'usn' ? 0.45 : z === 'uss' ? 0.28 : 0.05)) P.bits |= FBIT.SHUTTERS; }
    else if (z === 'uk') { F[0] = 2.3 + r3 * 0.4; F[1] = 0.42; F[2] = 0.58; P.bits |= FBIT.WHITE; P.look = P.look || LOOK.SASH; if (style === STYLE.BRICK && r5 < 0.4) P.bits |= FBIT.SURROUND; if (r6of(P) < 0.12) P.bits |= FBIT.ARCH; }
    else if (z === 'nl' || z === 'be') { F[0] = 1.9 + r3 * 0.4; F[1] = 0.46; F[2] = 0.72; P.bits |= FBIT.WHITE; }
    else if (z === 'de' || z === 'alps') { F[0] = 2.1 + r3 * 0.5; F[1] = 0.38; F[2] = 0.52; P.bits |= FBIT.WHITE | FBIT.CROSS; if (r5 < 0.25) P.bits |= FBIT.SHUTTERS; }
    else if (z === 'fr' || z === 'med') { F[0] = 2.5 + r3 * 0.5; F[1] = 0.38; F[2] = 0.58; P.bits |= (r2 < 0.7 ? FBIT.WHITE : FBIT.WOOD) | FBIT.CROSS; if (r5 < (z === 'med' ? 0.7 : 0.55)) P.bits |= FBIT.SHUTTERS; }
    else if (z === 'scand') { F[0] = 2.3 + r3 * 0.4; F[1] = 0.36; F[2] = 0.55; P.bits |= FBIT.WHITE | FBIT.CROSS; }
    else if (z === 'jp') { F[0] = 1.8 + r3 * 0.4; F[1] = 0.5; F[2] = 0.48; }
  } else if (P.pitchedRoof && H < 20 && /^(de|nl|be|fr|alps|scand)$/.test(z)) {
    // the town's older buildings: rows of smaller windows
    F[0] = 1.9 + r3 * 0.6; F[1] = z === 'nl' || z === 'be' ? 0.46 : 0.4; F[2] = z === 'nl' || z === 'be' ? 0.72 : 0.55; P.bits |= FBIT.WHITE | (z === 'nl' || z === 'be' ? 0 : FBIT.CROSS);
    if (z === 'de' && r5 < 0.2) P.bits |= FBIT.SHUTTERS;
    if ((z === 'fr' || z === 'med') && r5 < 0.5) P.bits |= FBIT.SHUTTERS;
  } else if (P.tower) { F[0] = 3.5 + r3; F[1] = 0.22; F[2] = 0.32; P.bits |= FBIT.ARCH;
  } else if (style === STYLE.CONCRETE && (OFFICE.has(t) || (H > 20 && !FLATS.has(t))) && r3 < 0.35) P.bits |= FBIT.RIBBON;
  else if (style === STYLE.BRICK && H < 30 && r5 < 0.35) P.bits |= FBIT.SURROUND;
  if ((z === 'med' || z === 'fr') && !houseLike && style === STYLE.STUCCO && H < 25 && r6of(P) < 0.55) P.bits |= FBIT.SHUTTERS;
  // half-timbered houses in Germany's old towns (above the ground floor, white infill)
  if (z === 'de' && P.pitchedRoof && H < 18 && P.area < 500 && (ctx.density > 0.28 || (b.year && b.year < 1850)) && hashf(P.id, 71) < 0.32 && !materialStyle(b.material)) {
    P.bits |= FBIT.TIMBER; P.style = STYLE.STUCCO; P.palette = hex(['#f0ece2', '#ece4d0', '#efe8d8']);
  }
  // churches and chapels: a nave of one tall floor under a steep roof along its length, a few tall arched windows,
  // stone or brick, a tower at the end towards the street where the footprint allows (towerChurch in extras); in
  // Japan a temple: low, under a hipped tiled roof
  P.church = CHURCH.has(t) && P.area >= 60 && P.area < 6000 && !P.tower && !P.spire && !(P.minH > 0.5) && !materialStyle(b.material);
  if (P.church && z === 'jp') { P.church = false; P.jpTemple = true; if (!b.roofShape) { setShape(P, 'hipped'); P.roofSrc = 'temple'; } P.style = STYLE.WOOD; P.palette = hex(['#6b4a33', '#8a6a4c', '#d8d0c0']); }
  else if (P.church) {
    P.style = (ctx.region === 'uk' || /^us/.test(z) || z === 'nl' || (z === 'de' && frame.lat > 52.2)) && r2 < 0.55 ? STYLE.BRICK : STYLE.STONE;
    P.palette = P.style === STYLE.BRICK ? hex(['#7a4434', '#8b5a42', '#6d4a3a', '#9a6a50']) : hex(['#a39b8a', '#b6ab92', '#8f8a80', '#c2b59a', '#9a8c74']);
    F[0] = clamp(Math.sqrt(P.area) * 0.22, 3.2, 5.5); F[1] = 0.3; F[2] = 0.7; P.bits = FBIT.ARCH | (r5 < 0.5 ? FBIT.SURROUND : 0); P.look = 0; P.ground = GROUND.NONE;
    if (!b.roofShape && !RADIAL.has(P.shape) && !P.holes.length) { setShape(P, 'gabled', false); P.roofSrc = 'church'; }
    P.pitch = 50 + (r3 - 0.5) * 8;
  }
  applyCity(P, ctx);
  // in a dense commercial core, the fronts facing the street carry lit screens
  P.core = 0; P.coreFull = false;
  if (ctx.cores.length && P.H > 10 && !houseLike) for (const c of ctx.cores) if (Math.hypot(P.cx - c[0], P.cz - c[1]) < c[2]) { P.core = c[3] ?? 0.6; P.coreFull = !!c[4]; break; }
  if (P.terrace && P.style !== STYLE.GLASS) { P.bits |= FBIT.PLOTS; if (ctx.zone === 'uk' && P.r4 < 0.3) P.bits |= FBIT.PLOT3; }
  if (P.pastel) P.bits |= FBIT.PASTEL;
  P.F[3] = P.bits;
}
// after the heights: the ground floor's height, and the things on houses
function fitOut(P, ctx) {
  const b = P.b, t = P.t, houseLike = P.houseLike, z = ctx.zone, ground = P.ground;
  // (a small shop's ground floor is lower: Tokyo's two-storey shop houses, a terrace's corner shop)
  const smallShop = ground === GROUND.SHOP && P.area < 250 && P.H < 12;
  let gh = ground === GROUND.SHOP ? Math.max(P.fh, smallShop ? 3.3 : 4.4) : ground === GROUND.LOBBY ? Math.max(P.fh, 5.0) : ground === GROUND.ROLLUP ? Math.max(P.fh, 5.2) : P.fh;
  if (gh > P.eave - 0.5) gh = Math.max(2.5, P.eave - 0.5);
  if (P.church) gh = 0.6;
  // (a row house's garden level: the parlour floor's windows start half a storey up, over the stoop)
  if (P.stoop) gh = clamp(P.fh * 0.5, 1.2, 1.7);
  P.gh = gh;
  // a house's garage (not in British terraces or Japan) and the things on houses that their zone's houses have
  P.garage = houseLike && P.area > 110 && ctx.region !== 'uk' && ctx.region !== 'jp' && t !== 'terrace' && !P.terrace && P.r3 < 0.8 && ctx.city !== 'sf' && /^us|^other/.test(z);
  // (the Sunset's and the Richmond's rows: a garage door under most houses, the front door beside it)
  if (P.avenues && P.front >= 0 && P.levels >= 2 && P.H < 14 && !b.shop && P.ground !== GROUND.SHOP && hashf(P.id, 170) < 0.8) { P.garage = true; P.ground = GROUND.HOUSE; }
  P.chimney = false; P.porch = false;
  if ((houseLike || (P.pitchedRoof && P.cand === 'maybe')) && P.pitchedRoof && !RADIAL.has(P.shape) && P.shape !== 'mansard' && P.shape !== 'skillion') {
    const ch = { usw: 0.25, uss: 0.35, usn: 0.55, uk: 0.92, nl: 0.45, be: 0.5, de: 0.55, alps: 0.4, scand: 0.5, fr: 0.5, med: 0.3, jp: 0 }[z] ?? 0.2;
    P.chimney = hashf(P.id, 81) < ch;
    if (houseLike && !P.terrace) P.porch = hashf(P.id, 82) < ({ usn: 0.45, uss: 0.3, usw: 0.12 }[z] || 0) && P.front >= 0;
    if (houseLike && !P.terrace && b.roofLevels >= 1) P.dormers = 'front';
    else if ((z === 'de' || z === 'uk' || z === 'usn' || z === 'fr') && P.roofH > 3.2 && hashf(P.id, 83) < 0.22) P.dormers = 'front';
  }
  // British houses: a bay window on the ground floor of most Victorian terraces and semis (a terrace drawn as one
  // outline was built as one, so all its houses or none: most Victorian ones up to four floors, as on Lancaster Road)
  P.ukBay = (houseLike || (P.terrace && P.levels <= 5)) && z === 'uk' && P.front >= 0 && P.style !== STYLE.GLASS && hashf(P.id, 84) < (P.terrace ? (P.levels <= 4 ? 0.85 : 0.5) : 0.5);
  // shaped gables to the street: the Low Countries' houses (stepped, neck and bell gables), and some in old German
  // towns (stepped); only where the ridge runs back from the street, so the gable is the front
  if (!P.canal && P.shape === 'gabled' && P.front >= 0 && P.H < 24 && (houseLike || P.cand)) {
    const ch = (z === 'nl' || z === 'be') ? 0.5 : (z === 'de' && ctx.density > 0.25) ? 0.22 : 0;
    if (hashf(P.id, 92) < ch) { P.canal = true; if (z === 'de') P.gableKind = 'step'; }
  }
  // Paris: the chimney stacks along a mansard's party walls
  P.parisStacks = P.look === LOOK.HAUSS && P.shape === 'mansard';
}
const r6of = (P) => P.r6;

// ---------- the satellite picture: is the roof pitched, which way is its ridge ----------
// Samples the roof over its footprint and asks which split of them into faces explains the most of the picture's
// light and shade: two faces either side of a ridge along the long side or across it, four of a hipped roof, or
// none (flat). A pitched roof's faces are lit differently by the sun when the picture was taken.
function readRoof(P, at) {
  const ob = P.ob, out = [];
  let green = 0, tile = 0;
  const nu = clamp(Math.round(2 * ob.hl / 0.55), 6, 26), nv = clamp(Math.round(2 * ob.hw / 0.55), 4, 18);
  const su = Math.max(0.3, ob.hl - 0.45), sv = Math.max(0.3, ob.hw - 0.45);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = (-1 + (i + 0.5) * 2 / nu) * su, v = (-1 + (j + 0.5) * 2 / nv) * sv;
    const x = ob.cx + ob.A[0] * u + ob.P[0] * v, z = ob.cz + ob.A[1] * u + ob.P[1] * v;
    if (!inRing(x, z, P.outer)) continue;
    const c = at(x, z); if (!c) continue;
    out.push([u, v, 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]]);
    // (the share of it that is leaves: a tree over the roof hides its faces)
    if (c[1] > c[0] * 1.04 && c[1] > c[2] * 1.12) green++;
    // (and the share that is the red and orange of clay tiles: a tiled roof is a pitched one)
    if (c[0] > c[1] * 1.12 && c[0] > c[2] * 1.3 && c[0] > 70) tile++;
  }
  const n = out.length;
  if (n < 14) return null;
  if (green > n * 0.35) return { veg: true };
  let mean = 0; for (const s of out) mean += s[2]; mean /= n;
  let sst = 0; for (const s of out) sst += (s[2] - mean) ** 2;
  if (sst < 1e-6) return { flat: 1, std: 0 };
  const std = Math.sqrt(sst / n);
  const k = Math.max(0, ob.hl - ob.hw);
  const fit = (groupOf, kG) => {
    const sum = new Float64Array(kG), cnt = new Float64Array(kG), sq = new Float64Array(kG);
    let used = 0;
    for (const s of out) { const g = groupOf(s); if (g < 0) continue; sum[g] += s[2]; sq[g] += s[2] * s[2]; cnt[g]++; used++; }
    if (used < n * 0.6) return { r2: 0, diff: 0 };
    let ssw = 0, m0 = 0, ssAll = 0, mAll = 0;
    for (let g = 0; g < kG; g++) if (cnt[g]) { ssw += sq[g] - sum[g] * sum[g] / cnt[g]; mAll += sum[g]; }
    mAll /= used;
    for (const s of out) { const g = groupOf(s); if (g >= 0) ssAll += (s[2] - mAll) ** 2; }
    let lo = Infinity, hi = -Infinity;
    for (let g = 0; g < kG; g++) if (cnt[g] >= 3) { const m = sum[g] / cnt[g]; if (m < lo) lo = m; if (m > hi) hi = m; m0++; }
    if (m0 < 2 || ssAll < 1e-6) return { r2: 0, diff: 0 };
    const r2 = 1 - ssw / ssAll, adj = 1 - (1 - r2) * (used - 1) / Math.max(1, used - kG);
    return { r2: adj, diff: hi - lo };
  };
  const gap = 0.35;
  const along = fit(s => Math.abs(s[1]) < gap ? -1 : (s[1] > 0 ? 0 : 1), 2);   // ridge along A: faces either side in v
  const across = fit(s => Math.abs(s[0]) < gap ? -1 : (s[0] > 0 ? 0 : 1), 2);  // ridge along P
  const hip = fit(s => {
    const t = [s[1] / ob.hw, -s[1] / ob.hw, (s[0] - k) / ob.hw, (-s[0] - k) / ob.hw];
    let g = 0; for (let i = 1; i < 4; i++) if (t[i] > t[g]) g = i;
    return g;
  }, 4);
  return { along, across, hip, std, tile: tile / n };
}
// what the picture says, applied to the plan when it is sure enough
function roofFromPicture(P, at, ctx) {
  if (!P.cand || P.roofSrc === 'tag') return false;
  const R = readRoof(P, at);
  if (!R || R.veg) { if (R) P.read = { veg: 1 }; return false; }
  const best = Math.max(R.along ? R.along.r2 : 0, R.across ? R.across.r2 : 0, R.hip ? R.hip.r2 : 0);
  P.read = { a: +(R.along ? R.along.r2 : 0).toFixed(2), c: +(R.across ? R.across.r2 : 0).toFixed(2), h: +(R.hip ? R.hip.r2 : 0).toFixed(2), s: Math.round(R.std || 0) };
  // (a roof of clay tiles is pitched whatever the light did: only its shape and way are asked of the picture)
  const tiled = R.tile > 0.45;
  const sure = P.cand === 'house' || tiled ? 0.28 : 0.4, minDiff = P.cand === 'house' || tiled ? 9 : 14;
  P.read.t = +R.tile.toFixed(2);
  const us = /^us/.test(ctx.zone);
  if (!tiled && best < (P.cand === 'house' ? (us ? 0.05 : 0.1) : 0.16) && (R.std || 0) < (P.cand === 'house' && us ? 10 : 16)) {
    // even, without faces: a flat roof (a house with a flat roof, or a town building that is not pitched)
    if (P.cand === 'house' && !(P.area > 70)) return false;
    if (P.shape !== 'flat') { setShape(P, 'flat'); P.roofSrc = 'img'; return true; }
    return false;
  }
  if (best < sure) {
    if (!tiled || P.shape !== 'flat') return false;
    // tiles, but no clear faces: pitched the way such roofs mostly are
    setShape(P, P.rect ? 'gabled' : 'hipped', false); P.roofSrc = 'img'; return true;
  }
  let shape, across;
  const a = R.along, c = R.across, h = R.hip;
  if (h.r2 > Math.max(a.r2, c.r2) + 0.08 && h.diff > minDiff) { shape = P.rect || P.cand === 'house' ? 'hipped' : 'hipped'; across = false; }
  else if (a.r2 >= c.r2 && a.diff > minDiff) { shape = 'gabled'; across = false; }
  else if (c.r2 > a.r2 && c.diff > minDiff) { shape = 'gabled'; across = true; }
  else return false;
  // (a gable over a footprint that is no rectangle cuts it oddly: hipped there)
  if (shape === 'gabled' && !P.rect && P.area / P.ob.area < 0.75) shape = 'hipped';
  // a hipped roof on a long box can be either: keep a guessed half-hipped or gambrel where the faces agree
  if (shape === 'gabled' && (P.shape === 'gambrel' || P.shape === 'half-hipped' || P.shape === 'saltbox') && P.across === across) shape = P.shape;
  // (a British terrace house's ridge runs along the street whatever its narrow roof seemed to say)
  if (ctx.zone === 'uk' && P.houseLike && P.area < 160 && shape === 'gabled' && P.front >= 0) across = P.across;
  setShape(P, shape, across);
  P.roofSrc = 'img';
  return true;
}

// ---------- L, T and U shaped houses: rectangles, each with its own roof ----------
// A house that is no rectangle has wings, and each wing its own roof (cross gables, a hip meeting a gable): the
// footprint, where its corners are square, is cut into rectangles at its inside corners, and each is built as a
// wing of the house (same walls, eave, colours and windows), its roof over its own long side.
function simplifyRing(r) {
  let pts = r.slice();
  for (let pass = 0; pass < 4; pass++) {
    const out = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = out.length ? out[out.length - 1] : pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
      const ax = p[0] - a[0], az = p[1] - a[1], bx = b[0] - p[0], bz = b[1] - p[1], la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 0.45 || lb < 1e-6) continue;
      if ((ax * bx + az * bz) / (la * lb) > Math.cos(15 * D2R)) continue; // hardly a corner
      out.push(p);
    }
    const done = out.length === pts.length;
    if (out.length < 3) return pts;
    pts = out;
    if (done) break;
  }
  return pts;
}
function squareCorners(r) {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[(i - 1 + n) % n], p = r[i], b = r[(i + 1) % n];
    const ax = p[0] - a[0], az = p[1] - a[1], bx = b[0] - p[0], bz = b[1] - p[1];
    if (Math.abs(ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1) > 0.21) return false;
  }
  return true;
}
function splitOrtho(r, depth = 0) {
  if (r.length === 4) return [r];
  if (depth > 3 || r.length > 12 || r.length < 6 || !squareCorners(r)) return null;
  const n = r.length, sgn = area2(r) < 0 ? -1 : 1;
  let best = null;
  for (let k = 0; k < n; k++) {
    const a = r[(k - 1 + n) % n], p = r[k], b = r[(k + 1) % n];
    const cr = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
    if (cr * sgn >= 0) continue; // a convex corner
    for (const d of [[p[0] - a[0], p[1] - a[1]], [p[0] - b[0], p[1] - b[1]]]) {
      const dl = Math.hypot(d[0], d[1]); d[0] /= dl; d[1] /= dl;
      let tb = Infinity, jb = -1;
      for (let j = 0; j < n; j++) {
        if (j === k || (j + 1) % n === k) continue;
        const u = r[j], w = r[(j + 1) % n], ex = w[0] - u[0], ez = w[1] - u[1];
        const den = d[0] * ez - d[1] * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((u[0] - p[0]) * ez - (u[1] - p[1]) * ex) / den, sP = ((u[0] - p[0]) * d[1] - (u[1] - p[1]) * d[0]) / den;
        if (t > 0.05 && sP >= -1e-6 && sP <= 1 + 1e-6 && t < tb) { tb = t; jb = j; }
      }
      if (jb < 0) continue;
      const X = [p[0] + d[0] * tb, p[1] + d[1] * tb];
      const r1 = [], r2 = [];
      for (let i = k; ; i = (i + 1) % n) { r1.push(r[i]); if (i === jb) break; }
      r1.push(X);
      r2.push(X);
      for (let i = (jb + 1) % n; ; i = (i + 1) % n) { r2.push(r[i]); if (i === k) break; }
      const s1 = simplifyRing(r1), s2 = simplifyRing(r2);
      const w = Math.min(minSide(s1), minSide(s2));
      if (!best || w > best.w) best = { w, s1, s2 };
    }
  }
  if (!best) return null;
  const A = splitOrtho(best.s1, depth + 1), B = splitOrtho(best.s2, depth + 1);
  return A && B ? A.concat(B) : null;
}
// is (x, z) within d of the ring's outline
function onRing(x, z, r, d) {
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1;
    const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / L2, 0, 1);
    if (Math.hypot(a[0] + ex * t - x, a[1] + ez * t - z) < d) return true;
  }
  return false;
}
function minSide(r) { let m = Infinity; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; m = Math.min(m, Math.hypot(q[0] - p[0], q[1] - p[1])); } return m; }

// the wings of a house that is no rectangle, or null
function wings(P, ctx) {
  if (P.rect || P.terrace || P.rowLike || P.holes.length || !P.pitchedRoof || RADIAL.has(P.shape) || P.shape === 'mansard' || P.shape === 'perim' || P.shape === 'skillion' || P.shape === 'pyramidal') return null;
  if (!(P.houseLike || P.cand)) return null;
  const parts = splitOrtho(simplifyRing(P.outer));
  if (!parts || parts.length < 2 || parts.length > 4) return null;
  const fp = P.front >= 0 ? (() => { const a = P.outer[P.front], b = P.outer[(P.front + 1) % P.outer.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; })() : null;
  let biggest = 0;
  const out = parts.map((ring0) => {
    const ring = ring0.map(q => [q[0], q[1]]);
    if (area2(ring) > 0) ring.reverse();
    const area = -area2(ring), ob = obb(ring);
    let cx = 0, cz = 0; for (const q of ring) { cx += q[0]; cz += q[1]; } cx /= ring.length; cz /= ring.length;
    const C = { ...P, outer: ring, holes: [], area, ob, cx, cz, rect: true, across: false, children: null, wing: true, offset: false, parentOuter: P.outer };
    // its front: the parent's front edge runs along one of its sides
    let front = -1;
    if (fp) for (let j = 0; j < ring.length; j++) { const a = ring[j], b = ring[(j + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1; const t = clamp(((fp[0] - a[0]) * ex + (fp[1] - a[1]) * ez) / L2, 0, 1); if (Math.hypot(a[0] + ex * t - fp[0], a[1] + ez * t - fp[1]) < 0.6) { front = j; break; } }
    C.front = front;
    if (front < 0) { C.garage = false; C.porch = false; C.ukBay = false; C.dormers = null; }
    const small = Math.min(ob.hl, ob.hw) * 2 < 2.6 || area < 10;
    if (small) { C.shape = 'flat'; C.ax = ob; C.roofH = 0; C.eave = P.eave - 0.3; C.H = C.eave; C.chimney = false; C.dormers = null; C.pitchedRoof = false; }
    else {
      C.shape = P.shape === 'gambrel' || P.shape === 'saltbox' ? 'gabled' : P.shape; C.ax = ob;
      C.roofH = P.b.roofHeight ?? Math.min(P.houseLike ? 6.5 : 9, ob.hw * Math.tan(clamp(P.pitch, 8, 65) * D2R));
      C.H = C.eave + C.roofH; C.pitchedRoof = true;
    }
    if (area > biggest) biggest = area;
    return C;
  });
  for (const C of out) if (C.area < biggest) C.chimney = false;
  return out;
}

// ---------- geometry buffers ----------
const F0 = [0, 0, 0, 0];
class Buf {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.w = []; this.bb = []; this.s = []; this.f = []; this.idx = []; this.n = 0; this.F = F0; }
  v(x, y, z, nx, ny, nz, c, u, L, eave, gy, base, fh, gh, seed, style, ground, look = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(c.r, c.g, c.b);
    this.w.push(u, L, eave, gy); this.bb.push(base, fh, gh, seed); this.s.push(style, ground, look);
    const F = this.F; this.f.push(F[0], F[1], F[2], F[3]);
    return this.n++;
  }
  // a flat quad a..d (counter-clockwise seen from its front), for small things (chimneys, posts, dormers): no windows
  quad(a, b, c, d, n, col, style, base, top, F = F0) {
    const keep = this.F; this.F = F;
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], col, 0, L, top - base, base - 50, base, 3, 0, 1, style, 0);
    const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], col, L, L, top - base, base - 50, base, 3, 0, 1, style, 0);
    const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], col, L, L, top - base, base - 50, base, 3, 0, 1, style, 0);
    const i3 = d ? this.v(d[0], d[1], d[2], n[0], n[1], n[2], col, 0, L, top - base, base - 50, base, 3, 0, 1, style, 0) : -1;
    if (d) this.idx.push(i0, i1, i2, i0, i2, i3); else this.idx.push(i0, i1, i2);
    this.F = keep;
  }
  // a triangle (no windows)
  tri(a, b, c, n, col, style, base, top) { this.quad(a, b, c, null, n, col, style, base, top); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(this.w, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.bb, 4));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 3));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(this.f, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
class RoofBuf {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  v(x, y, z, c, uv) { this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.uv.push(uv[0], uv[1]); return this.n++; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// a box of the walls' kind (chimney, post, water tank's legs): centre, axis a (unit), half sizes, y0..y1
function box(W, cx, cz, a, ha, hb, y0, y1, col, style, top = true, topCol = null) {
  const p = [-a[1], a[0]];
  const C = (sa, sb, y) => [cx + a[0] * ha * sa + p[0] * hb * sb, y, cz + a[1] * ha * sa + p[1] * hb * sb];
  // (each face runs so that its outward normal is (-dz, dx) of its bottom edge, as the walls do)
  const faces = [[[1, 1], [1, -1], [a[0], 0, a[1]]], [[-1, 1], [1, 1], [p[0], 0, p[1]]], [[-1, -1], [-1, 1], [-a[0], 0, -a[1]]], [[1, -1], [-1, -1], [-p[0], 0, -p[1]]]];
  for (const [s0, s1, n] of faces) W.quad(C(s0[0], s0[1], y0), C(s1[0], s1[1], y0), C(s1[0], s1[1], y1), C(s0[0], s0[1], y1), n, col, style, y0, y1);
  if (top) W.quad(C(-1, -1, y1), C(-1, 1, y1), C(1, 1, y1), C(1, -1, y1), [0, 1, 0], topCol || col, STYLE.SOFFIT, y0, y1);
}

// one building into the buffers
function emit(P, ctx, W, R, img) {
  const { outer, holes, minH, H, eave, fh, gh, style, ground, id } = P;
  const ground0 = (x, z) => { const g = ctx.groundAt(x, z); return g == null || !isFinite(g) ? ctx.g0 : g; };
  let gmin = Infinity;
  for (const p of outer) { const g = ground0(p[0], p[1]); if (g < gmin) gmin = g; }
  const base = P.baseY ?? gmin;
  P.baseY = base;
  // a part of a bridge (a pier or abutment the map draws as a building) whose top is at the deck a lane runs over:
  // not drawn, it would stand in the road
  if (P.b.passY != null && isFinite(P.b.passY) && base + H < P.b.passY + 2) return;
  // (a bridge tower standing across a deck: drawn from 5.5 m over the deck, so the road passes under it)
  if (P.b.passY != null && isFinite(P.b.passY) && P.b.passY + 5.5 - base > minH && P.b.passY + 5.5 - base < eave - 3) P.minH = P.b.passY + 5.5 - base;
  const yBot = P.minH > 0.3 ? base + P.minH : gmin - 1.2;
  const terms = roofTerms(P);
  const yEave = base + eave;
  const seed = Math.floor(P.r4 * 997);   // a whole number: the shader hashes it
  const wc = P.wallColour;
  const lean = img ? img.lean : null;
  const uvOf = (x, z, y) => {
    if (!img) return [0, 0];
    let lx = x, lz = z;
    if (lean) { const hh = Math.max(0, y - base); lx += lean[0] * hh; lz += lean[1] * hh; }
    return [(lx - img.x0) / (img.x1 - img.x0), (lz - img.z0) / (img.z1 - img.z0)];
  };
  const rc = P.plainRoof || P.roofColour || P.fallbackRoof || WHITE;
  const Fb = P.F, Fplain = [Fb[0], Fb[1], Fb[2], Fb[3] & ~(FBIT.PLOTS | FBIT.FIRE | FBIT.PLOT3)];
  let fdx = 0, fdz = 0;
  if (P.front >= 0) { const p = outer[P.front], q = outer[(P.front + 1) % outer.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; fdx = (q[0] - p[0]) / l; fdz = (q[1] - p[1]) / l; }
  // a canal house's gable: its front wall rises over the roof in a stepped or a neck gable
  const gableFront = P.canal && P.front >= 0 && terms && (P.shape === 'gabled') && Math.abs(fdx * P.ax.A[0] + fdz * P.ax.A[1]) < 0.35;
  // walls, ring by ring
  for (const ring of [outer, ...holes]) {
    const n = ring.length;
    // points with the roof's kinks inserted on each edge
    const edges = [];
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ss = [0];
      if (terms && terms.length > 1) {
        for (let a = 0; a < terms.length; a++) for (let c = a + 1; c < terms.length; c++) {
          const fa = termAt(terms[a], p[0], p[1]) - termAt(terms[c], p[0], p[1]);
          const fb = termAt(terms[a], q[0], q[1]) - termAt(terms[c], q[0], q[1]);
          if ((fa > 0) !== (fb > 0) && Math.abs(fa - fb) > 1e-9) { const s = fa / (fa - fb); if (s > 0.001 && s < 0.999) ss.push(s); }
        }
      }
      if (terms && P.shape === 'mansard') {
        const lim = 1 - 1 / mansardK(P);
        for (const tm of terms) {
          const fa = termAt(tm, p[0], p[1]) - lim, fb = termAt(tm, q[0], q[1]) - lim;
          if ((fa > 0) !== (fb > 0) && Math.abs(fa - fb) > 1e-9) { const s = fa / (fa - fb); if (s > 0.001 && s < 0.999) ss.push(s); }
        }
      }
      // (and where the roof's edge crosses 0 or 1 over this edge: the walls' top then bends there)
      if (terms) for (const tm of terms) for (const lvl of [0, 1]) {
        const fa = termAt(tm, p[0], p[1]) - lvl, fb = termAt(tm, q[0], q[1]) - lvl;
        // (only where the term really changes along the edge: a long wall's own line wavers round 1 by millimetres)
        if ((fa > 0) !== (fb > 0) && Math.abs(fa - fb) > 0.03) { const s = fa / (fa - fb); if (s > 0.001 && s < 0.999) ss.push(s); }
      }
      ss.sort((x, y) => x - y);
      // keep only the real kinks of the walls' top (where the roof's height along the wall bends): a crossing of two
      // terms neither of which is the roof there splits nothing
      if (terms && ss.length > 1) {
        const hAt = (t) => roofAt(P, terms, p[0] + dx * t, p[1] + dz * t);
        const keep = [0];
        for (let j = 1; j < ss.length; j++) {
          const t = ss[j], dd = Math.min(0.02, t / 2, (1 - t) / 2) || 1e-4;
          if (Math.abs(hAt(t) * 2 - hAt(t - dd) - hAt(t + dd)) > 1e-3) keep.push(t);
        }
        ss.length = 0; for (const t of keep) ss.push(t);
      }
      ss.push(1);
      edges.push({ p, q, dx, dz, len, ss, ang: Math.atan2(dz, dx), i, ring });
    }
    const m = edges.length; if (m < 3) continue;
    // runs of nearly straight edges share one window layout
    const turn = (k) => { let d = edges[k].ang - edges[(k - 1 + m) % m].ang; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
    let s0 = 0; for (let k = 0; k < m; k++) if (turn(k) > 0.4) { s0 = k; break; }
    const runOf = new Array(m), uStart = new Array(m), runLen = [];
    let run = -1, acc = 0;
    for (let j = 0; j < m; j++) {
      const k = (s0 + j) % m;
      if (j === 0 || turn(k) > 0.4) { run++; runLen.push(0); acc = 0; }
      runOf[k] = run; uStart[k] = acc; acc += edges[k].len; runLen[run] = acc;
    }
    for (let k = 0; k < m; k++) {
      const e = edges[k], nx = -e.dz / e.len, nz = e.dx / e.len, L = runLen[runOf[k]];
      const isFront = e.ring === outer && e.i === P.front;
      // a house's front wall (towards the road) gets the door and the garage; its other walls plain windows
      const gk = ground === GROUND.HOUSE && isFront ? (P.garage ? GROUND.HOUSE_GARAGE : GROUND.HOUSE_FRONT) : ground;
      // a terrace's houses along its front and its back; a fire escape on the front
      const par = Math.abs((e.dx * fdx + e.dz * fdz) / e.len) > 0.8;
      W.F = (P.bits & FBIT.PLOTS) && par && e.len > 9 ? (isFront || !(P.bits & FBIT.FIRE) ? Fb : Fplain) : (isFront ? [Fb[0], Fb[1], Fb[2], Fb[3] & ~(FBIT.PLOTS | FBIT.PLOT3)] : Fplain);
      if (P.fire && isFront && e.len > 7) W.F = [W.F[0], W.F[1], W.F[2], W.F[3] | FBIT.FIRE];
      let lk = P.look || 0, screen = false;
      if (e.ring === outer && P.core && e.len >= 8) {
        // a core's street fronts: screens on any wall with a road just in front of it
        let rp = null; const mx = e.p[0] + e.dx / 2 + nx * 6, mz = e.p[1] + e.dz / 2 + nz * 6;
        try { rp = ctx.nearRoad ? ctx.nearRoad(mx, mz) : null; } catch (err) { rp = null; }
        if (rp && rp.dist < 22 && hashf(P.id, 300 + e.i) < P.core) { lk += P.coreFull ? 20 : 10; screen = true; }
      }
      if (!screen && e.ring === outer && P.look === LOOK.JAPAN && isFront && P.H > (ground === GROUND.SHOP ? 5.5 : 9) && P.H < 50 && e.len > 3.5 && P.r2 < 0.75 && !P.signed && !P.houseLike) {
        // a vertical sign standing out from the front, near one end: two faces, read from up and down the street
        P.signed = true;
        const sh = Math.min(P.eave - 1.0 - P.gh - 0.4, 14);
        if (sh > 1.6) {
          const at = P.r1 < 0.5 ? Math.min(1.2, e.len * 0.3) : e.len - Math.min(1.2, e.len * 0.3);
          const ex = e.dx / e.len, ez = e.dz / e.len;
          const x0 = e.p[0] + ex * at + nx * 0.05, z0 = e.p[1] + ez * at + nz * 0.05, x1 = x0 + nx * 0.95, z1 = z0 + nz * 0.95;
          const ya = base + P.gh + 0.4, yb = ya + sh, gy = ground0(x0, z0);
          for (const sd of [1, -1]) {
            const a0 = W.v(x0, ya, z0, ex * sd, 0, ez * sd, wc, 0, 0.95, eave, gy, base, fh, gh, seed, style, 0, P.look + 30);
            const a1 = W.v(x1, ya, z1, ex * sd, 0, ez * sd, wc, 0.95, 0.95, eave, gy, base, fh, gh, seed, style, 0, P.look + 30);
            const a2 = W.v(x1, yb, z1, ex * sd, 0, ez * sd, wc, 0.95, 0.95, eave, gy, base, fh, gh, seed, style, 0, P.look + 30);
            const a3 = W.v(x0, yb, z0, ex * sd, 0, ez * sd, wc, 0, 0.95, eave, gy, base, fh, gh, seed, style, 0, P.look + 30);
            // the face whose normal is +edge direction is wound one way, its back the other
            if (sd > 0) W.idx.push(a0, a2, a1, a0, a3, a2); else W.idx.push(a0, a1, a2, a0, a2, a3);
          }
        }
      }
      if (gableFront && isFront) { emitGableFront(P, e, k, uStart, L, W, base, yBot, yEave, terms, ground0, wc, seed, gk, lk); continue; }
      // (a wing's side against the next wing is inside the house up to the eave: only its gable above is drawn)
      let y0w = yBot;
      if (P.wing && P.parentOuter && !onRing(e.p[0] + e.dx / 2, e.p[1] + e.dz / 2, P.parentOuter, 0.35)) { if (!terms) continue; y0w = yEave - 0.25; }
      for (let j = 0; j + 1 < e.ss.length; j++) {
        const sa = e.ss[j], sb = e.ss[j + 1];
        // the ends are the ring's own vertices, bit for bit, so neighbouring walls share their corner exactly
        const ax = sa === 0 ? e.p[0] : e.p[0] + e.dx * sa, az = sa === 0 ? e.p[1] : e.p[1] + e.dz * sa;
        const bx = sb === 1 ? e.q[0] : e.p[0] + e.dx * sb, bz = sb === 1 ? e.q[1] : e.p[1] + e.dz * sb;
        const ta = yEave + roofAt(P, terms, ax, az), tb = yEave + roofAt(P, terms, bx, bz);
        const ga = ground0(ax, az), gb = ground0(bx, bz);
        const ua = uStart[k] + e.len * sa, ub = uStart[k] + e.len * sb;
        const eh = eave;
        if (ta - y0w < 0.02 && tb - y0w < 0.02) continue;
        const i0 = W.v(ax, y0w, az, nx, 0, nz, wc, ua, L, eh, ga, base, fh, gh, seed, style, gk, lk);
        const i1 = W.v(bx, y0w, bz, nx, 0, nz, wc, ub, L, eh, gb, base, fh, gh, seed, style, gk, lk);
        const i2 = W.v(bx, tb, bz, nx, 0, nz, wc, ub, L, eh, gb, base, fh, gh, seed, style, gk, lk);
        const i3 = W.v(ax, ta, az, nx, 0, nz, wc, ua, L, eh, ga, base, fh, gh, seed, style, gk, lk);
        W.idx.push(i0, i1, i2, i0, i2, i3);
      }
    }
  }
  W.F = Fplain;

  // San Francisco: bay windows on the front, from the first floor up to under the cornice
  if (P.look === LOOK.SF && P.front >= 0 && P.levels >= 2 && P.eave - P.gh > 2.5) {
    const p = outer[P.front], q = outer[(P.front + 1) % outer.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len >= 5.5) {
      const ex = dx / len, ez = dz / len;
      const centres = len >= 11 ? [len * 0.27, len * 0.73] : [P.r2 < 0.5 ? len * 0.3 : len * 0.7];
      for (const sc of centres) bayWindow(W, p, ex, ez, sc, len, base + P.gh, yEave - 0.35, 1.9, 0.75, ground0, wc, P, base, seed, LOOK.SF, 0);
    }
  }
  // British houses: a bay window on the ground floor, one a house along a terrace
  if (P.ukBay && P.front >= 0 && P.levels >= 1) {
    const p = outer[P.front], q = outer[(P.front + 1) % outer.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len >= 4.4) {
      const ex = dx / len, ez = dz / len, plot = (P.bits & FBIT.PLOTS) ? ((P.bits & FBIT.PLOT3) ? 3 : 2) * (P.F[0] || 2.5) : len;
      const nP = Math.max(1, Math.round(len / plot)), pw = len / nP;
      for (let k = 0; k < nP; k++) {
        // (opposite the house's door, which the shader puts at one end of its plot)
        const sc = k * pw + pw * (hashf(P.id + k, 85) < 0.5 ? 0.66 : 0.34);
        // (two floors high on the taller terraces)
        const top = P.levels >= 3 ? Math.min(P.gh + P.fh, P.eave - 0.5) : Math.min(P.gh, 3.0);
        // (painted white or cream, as most are)
        bayWindow(W, p, ex, ez, sc, len, base + 0.05, base + top - 0.15, 1.6, 0.65, ground0, BAY_WHITE, P, base, seed, LOOK.SASH, FBIT.ONE | FBIT.WHITE, true, P.levels >= 3);
      }
    }
  }
  // the underside of a raised part
  if (P.minH > 0.3) {
    const { pts, tris } = triangulate(outer, holes);
    const ids = pts.map(p => W.v(p.x, yBot, p.y, 0, -1, 0, wc, 0, 0, 0, -1e4, base, fh, gh, seed, STYLE.SOFFIT, 0));
    for (const t of tris) {
      const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
      const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // facing down: the opposite winding of a roof
      if (cr > 0) W.idx.push(ids[t[0]], ids[t[1]], ids[t[2]]); else W.idx.push(ids[t[0]], ids[t[2]], ids[t[1]]);
    }
  }

  // the roof
  const pushTris = (poly, hs, heightOf) => {
    const { pts, tris } = triangulate(poly, hs);
    const ids = pts.map(p => { const y = heightOf(p.x, p.y); return R.v(p.x, y, p.y, rc, uvOf(p.x, p.y, y)); });
    for (const t of tris) {
      const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
      const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // facing up (+y) with z south: counter-clockwise from above is a negative cross product here
      if (cr < 0) R.idx.push(ids[t[0]], ids[t[1]], ids[t[2]]); else R.idx.push(ids[t[0]], ids[t[2]], ids[t[1]]);
    }
  };
  if (RADIAL.has(P.shape)) {
    pushTris(outer, holes, () => yEave + 0.02);
    radialRoof(P, R, yEave, uvOf, rc);
  } else if (P.shape === 'perim') {
    // a roof up from every wall to a flat top: the rings w in, a strip from each wall's top to them
    const pr = perimRings(outer, holes, P.perimW) || perimRings(outer, holes, P.perimW * 0.6);
    const yTop = yEave + P.roofH;
    if (!pr) pushTris(outer, holes, () => yEave);
    else {
      const strip = (a, b) => {
        for (let i = 0, n = a.length; i < n; i++) {
          const j = (i + 1) % n, p0 = a[i], p1 = a[j], q0 = b[i], q1 = b[j];
          const ids = [[p0, yEave], [p1, yEave], [q1, yTop], [q0, yTop]].map(([q, y]) => R.v(q[0], y, q[1], rc, uvOf(q[0], q[1], y)));
          R.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        }
      };
      strip(outer, pr.o); holes.forEach((h, k) => strip(h, pr.hs[k]));
      pushTris(pr.o, pr.hs, () => yTop);
    }
  } else if (!terms) pushTris(outer, holes, () => base + H);
  else {
    const roofRing = P.overhang > 0 ? offsetRing(outer, P.overhang) : outer;
    for (let i = 0; i < terms.length; i++) {
      let poly = roofRing;
      for (let j = 0; j < terms.length && poly.length >= 3; j++) {
        if (j === i) continue;
        poly = clip(poly, [terms[i].g[0] - terms[j].g[0], terms[i].g[1] - terms[j].g[1]], terms[i].c - terms[j].c);
      }
      if (poly.length < 3) continue;
      if (P.shape === 'mansard') {
        const lim = 1 - 1 / mansardK(P), t = terms[i];
        const band = clip(poly, t.g, t.c - lim), top = clip(poly, [-t.g[0], -t.g[1]], lim - t.c);
        if (band.length >= 3) pushTris(band, [], (x, z) => yEave + roofAt(P, terms, x, z));
        if (top.length >= 3) pushTris(top, [], () => yEave + P.roofH);
      } else pushTris(poly, [], (x, z) => yEave + roofAt(P, terms, x, z, P.overhang > 0));
    }
  }
  const nx0 = W.idx.length;
  extras(P, ctx, W, R, terms, base, yEave, uvOf, rc, ground0);
  if (ctx.tri) ctx.tri.extra += (W.idx.length - nx0) / 3;
}
const WHITE = new THREE.Color(1, 1, 1);
const BAY_WHITE = new THREE.Color(0.56, 0.55, 0.52);
// awnings' cloth (sRGB): bottle green, burgundy, navy, black, red, sand, terracotta, slate blue, cream
const AWNING = ['#1f4a36', '#6a1e2a', '#1e2c4a', '#1b1b1d', '#8c1c1c', '#b3a27f', '#a4532a', '#3d5a73', '#c9c0a8'].map(h => new THREE.Color().setStyle(h, THREE.SRGBColorSpace).multiplyScalar(0.92));

// a canal house's front: the wall up to the eave as usual, then a shaped gable over the roof (stepped, neck or
// bell), strip by strip across the front, in the wall's own material
function emitGableFront(P, e, k, uStart, L, W, base, yBot, yEave, terms, ground0, wc, seed, gk, lk) {
  const nx = -e.dz / e.len, nz = e.dx / e.len, kind = P.gableKind || (P.r5 < 0.3 ? 'step' : P.r5 < 0.75 ? 'neck' : 'bell');
  const top = P.roofH + 0.7, n = kind === 'step' ? 10 : 16;
  const prof = (s) => {
    // s across the front 0..1; the gable's height over the eave
    const c = Math.abs(s - 0.5) * 2; // 0 at the middle, 1 at the corners
    if (kind === 'step') { const st = 5, k2 = Math.min(st - 1, Math.floor((1 - c) * st)); return top * (k2 + 1) / st * (c > 0.92 ? 0.2 : 1); }
    if (kind === 'neck') return c < 0.42 ? top : c < 0.6 ? top * (0.35 + 0.65 * (0.6 - c) / 0.18) : top * 0.35 * Math.max(0, (1 - c) / 0.4);
    return top * Math.pow(Math.max(0, 1 - c * c), 0.7);
  };
  const { fh, gh, style } = P, eh = P.eave;
  for (let j = 0; j < n; j++) {
    const sa = j / n, sb = (j + 1) / n;
    const ax = e.p[0] + e.dx * sa, az = e.p[1] + e.dz * sa, bx = e.p[0] + e.dx * sb, bz = e.p[1] + e.dz * sb;
    const ua = uStart[k] + e.len * sa, ub = uStart[k] + e.len * sb, ga = ground0(ax, az), gb = ground0(bx, bz);
    const h = Math.max(prof((sa + sb) / 2), roofAt(P, terms, (ax + bx) / 2, (az + bz) / 2) + 0.05);
    const y1 = yEave + h;
    const i0 = W.v(ax, yBot, az, nx, 0, nz, wc, ua, L, eh, ga, base, fh, gh, seed, style, gk, lk);
    const i1 = W.v(bx, yBot, bz, nx, 0, nz, wc, ub, L, eh, gb, base, fh, gh, seed, style, gk, lk);
    const i2 = W.v(bx, y1, bz, nx, 0, nz, wc, ub, L, eh, gb, base, fh, gh, seed, style, gk, lk);
    const i3 = W.v(ax, y1, az, nx, 0, nz, wc, ua, L, eh, ga, base, fh, gh, seed, style, gk, lk);
    W.idx.push(i0, i1, i2, i0, i2, i3);
  }
  // its coping: a white cornice band on top of each strip
  const cop = new THREE.Color(0.55, 0.55, 0.53);
  for (let j = 0; j < n; j++) {
    const sa = j / n, sb = (j + 1) / n;
    const ax = e.p[0] + e.dx * sa, az = e.p[1] + e.dz * sa, bx = e.p[0] + e.dx * sb, bz = e.p[1] + e.dz * sb;
    const h = Math.max(prof((sa + sb) / 2), roofAt(P, terms, (ax + bx) / 2, (az + bz) / 2) + 0.05), y1 = yEave + h;
    W.quad([ax, y1, az], [bx, y1, bz], [bx - nx * 0.3, y1, bz - nz * 0.3], [ax - nx * 0.3, y1, az - nz * 0.3], [0, 1, 0], cop, STYLE.SOFFIT, y1 - 1, y1);
  }
}

// a bay window standing out from a front: three faces and a top (and its underside when it starts up the wall)
function bayWindow(W, p, ex, ez, sc, len, y0, y1, fw, d, ground0, wc, P, base, seed, look, bits, roofTop = false, perFloor = false) {
  const nx = -ez, nz = ex, half = fw / 2 + d;
  if (sc - half < 0.3 || sc + half > len - 0.3 || y1 - y0 < 1.2) return;
  const cx = p[0] + ex * sc, cz = p[1] + ez * sc;
  const a0 = [cx - ex * half, cz - ez * half], a1 = [cx - ex * fw / 2 + nx * d, cz - ez * fw / 2 + nz * d];
  const a2 = [cx + ex * fw / 2 + nx * d, cz + ez * fw / 2 + nz * d], a3 = [cx + ex * half, cz + ez * half];
  const gy = ground0(cx, cz), keep = W.F;
  if (bits) W.F = [P.F[0], P.F[1], P.F[2], (P.F[3] & ~(FBIT.PLOTS | FBIT.PLOT3 | FBIT.FIRE)) | bits];
  // (one window a face; over two floors, one a face on each floor)
  const one = (bits & FBIT.ONE) && !perFloor;
  const fh = one ? y1 - y0 : P.fh, gh = one ? 0 : P.gh, bb = one ? y0 : base, eave = one ? y1 - y0 + 0.3 : P.eave;
  for (const [a, b] of [[a0, a1], [a1, a2], [a2, a3]]) {
    const fdx = b[0] - a[0], fdz = b[1] - a[1], fl = Math.hypot(fdx, fdz), fnx = -fdz / fl, fnz = fdx / fl;
    const i0 = W.v(a[0], y0, a[1], fnx, 0, fnz, wc, 0, fl, eave, gy, bb, fh, gh, seed, P.style, 0, look);
    const i1 = W.v(b[0], y0, b[1], fnx, 0, fnz, wc, fl, fl, eave, gy, bb, fh, gh, seed, P.style, 0, look);
    const i2 = W.v(b[0], y1, b[1], fnx, 0, fnz, wc, fl, fl, eave, gy, bb, fh, gh, seed, P.style, 0, look);
    const i3 = W.v(a[0], y1, a[1], fnx, 0, fnz, wc, 0, fl, eave, gy, bb, fh, gh, seed, P.style, 0, look);
    W.idx.push(i0, i1, i2, i0, i2, i3);
  }
  W.F = keep;
  // its top and its underside
  for (const [y, ny] of [[y1, 1], [y0, -1]]) {
    if (ny < 0 && y0 - gy < 0.4) continue;
    const ids = [a0, a1, a2, a3].map(a => W.v(a[0], y, a[1], 0, ny, 0, roofTop && ny > 0 ? (P.roofCol || wc) : wc, 0, 0, 0, -1e4, base, P.fh, P.gh, seed, roofTop && ny > 0 ? STYLE.ROOFING : STYLE.SOFFIT, 0));
    // the quad a0 a1 a2 a3 goes along the wall and out: wind it to face up or down
    if (ny > 0) W.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); else W.idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
  }
}

// a dome, an onion or a cone: rings from the eave to the top, scaled about the footprint's middle
function radialRoof(P, R, yEave, uvOf, rc) {
  const prof = PROFILE[P.shape], o = P.outer, c = [P.rc[0], P.rc[1]];
  let prev = null;
  for (let k = 0; k < prof.length; k++) {
    const [s, h] = prof[k], y = yEave + P.roofH * h;
    const ring = s > 0.001 ? o.map(p => { const x = c[0] + (p[0] - c[0]) * s, z = c[1] + (p[1] - c[1]) * s; return R.v(x, y, z, rc, uvOf(x, z, y)); }) : [R.v(c[0], y, c[1], rc, uvOf(c[0], c[1], y))];
    if (prev) {
      const n = o.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // the outer ring is counter-clockwise from above: up-facing triangles go a, b, c in this order
        if (ring.length === 1) R.idx.push(prev[i], prev[j], ring[0]);
        else R.idx.push(prev[i], prev[j], ring[i], prev[j], ring[j], ring[i]);
      }
    }
    prev = ring;
  }
}

// the things on a building: chimneys, a porch, dormers, a water tank
function extras(P, ctx, W, R, terms, base, yEave, uvOf, rc, ground0) {
  const roofCol = P.roofCol || new THREE.Color(0.2, 0.2, 0.21);
  const X = P.ax || P.ob;
  if (P.chimney && terms && P.roofH > 1.2) {
    // on the ridge near a gable end (British terraces: on every party wall)
    const brick = P.style === STYLE.BRICK ? P.wallColour : new THREE.Color().setRGB(0.42, 0.24, 0.17, THREE.SRGBColorSpace).multiplyScalar(0.62);
    const stucco = P.style === STYLE.STUCCO && hashf(P.id, 86) < 0.6;
    const col = stucco ? P.wallColour : brick, st = stucco ? STYLE.STUCCO : STYLE.BRICK;
    const ridgeY = yEave + P.roofH;
    const list = [];
    if (P.bits & FBIT.PLOTS) { const pw = ((P.bits & FBIT.PLOT3) ? 3 : 2) * (P.F[0] || 2.5), n = Math.max(1, Math.round(X.hl * 2 / pw)); for (let k = 1; k < n; k += 2) list.push(-X.hl + k * X.hl * 2 / n); }
    else list.push((hashf(P.id, 87) < 0.5 ? -1 : 1) * Math.max(0, X.hl - Math.min(1.2, X.hl * 0.3)));
    const w = P.bits & FBIT.PLOTS ? 0.5 : 0.35 + hashf(P.id, 88) * 0.2, dd = P.bits & FBIT.PLOTS ? 0.8 : 0.4;
    for (const u of list.slice(0, 12)) {
      const x = X.cx + X.A[0] * u, z = X.cz + X.A[1] * u;
      const y0 = yEave + roofAt(P, terms, x + X.P[0] * dd, z + X.P[1] * dd) - 0.2;
      box(W, x, z, X.A, w, dd, Math.min(y0, ridgeY - 0.3), ridgeY + 0.7 + hashf(P.id, 89) * 0.6, col, st, true, new THREE.Color(0.06, 0.06, 0.06));
    }
  }
  if (P.porch && P.front >= 0) {
    // a porch over the front door: a roof sloping off the wall on two or four posts
    const o = P.outer, p = o[P.front], q = o[(P.front + 1) % o.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len > 5) {
      const ex = dx / len, ez = dz / len, nx = -ez, nz = ex;
      const wide = hashf(P.id, 90) < 0.4, pw = wide ? len * 0.8 : Math.min(3.2, len * 0.35), d = wide ? 2.2 : 1.6;
      const c = wide ? len / 2 : len * (0.35 + 0.3 * hashf(P.seed0 || P.id, 91));
      const s0 = Math.max(0.3, c - pw / 2), s1 = Math.min(len - 0.3, c + pw / 2);
      const yTop = base + Math.min(P.fh, 3) + 0.05, yLow = yTop - 0.45;
      const A = [p[0] + ex * s0, yTop, p[1] + ez * s0], B = [p[0] + ex * s1, yTop, p[1] + ez * s1];
      const C = [B[0] + nx * d, yLow, B[2] + nz * d], D = [A[0] + nx * d, yLow, A[2] + nz * d];
      const sl = Math.hypot(d, 0.45), n = [nx * 0.45 / sl, d / sl, nz * 0.45 / sl];
      W.quad(D, C, B, A, n, roofCol, STYLE.ROOFING, yLow, yTop);
      W.quad(A, B, C, D, [-n[0], -n[1], -n[2]], new THREE.Color(0.5, 0.5, 0.48), STYLE.SOFFIT, yLow, yTop);
      const post = new THREE.Color(0.58, 0.58, 0.56), np = wide ? 4 : 2;
      for (let k = 0; k < np; k++) {
        const s = s0 + 0.15 + (s1 - s0 - 0.3) * k / (np - 1);
        const x = p[0] + ex * s + nx * (d - 0.15), z = p[1] + ez * s + nz * (d - 0.15), g = ground0(x, z);
        box(W, x, z, [ex, ez], 0.07, 0.07, g, yLow, post, STYLE.STUCCO, false);
      }
    }
  }
  const fr = P.front >= 0 ? (() => { const o = P.outer, p = o[P.front], q = o[(P.front + 1) % o.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1; return { p, q, len, ex: dx / len, ez: dz / len, nx: -dz / len, nz: dx / len }; })() : null;
  if (P.parapet && fr && terms && fr.len > 3) {
    // a parapet: the front wall carried 0.6 m past the eave, a coping on it
    const { p, q, nx, nz } = fr, y1 = yEave + 0.6;
    W.quad([p[0], yEave - 0.05, p[1]], [q[0], yEave - 0.05, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [nx, 0, nz], P.wallColour, P.style, yEave - 0.05, y1);
    W.quad([q[0], yEave - 0.05, q[1]], [p[0], yEave - 0.05, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [-nx, 0, -nz], P.wallColour, P.style, yEave - 0.05, y1);
    const cop = new THREE.Color(0.62, 0.61, 0.58), o = 0.12;
    W.quad([p[0] + nx * o, y1, p[1] + nz * o], [p[0] - nx * 0.25, y1, p[1] - nz * 0.25], [q[0] - nx * 0.25, y1, q[1] - nz * 0.25], [q[0] + nx * o, y1, q[1] + nz * o], [0, 1, 0], cop, STYLE.SOFFIT, y1 - 0.1, y1);
  }
  if (P.cornice && fr && fr.len > 3 && P.shape === 'flat') {
    // a cornice along the top of the front: a deep moulded band standing out 0.45 m (pressed metal or stone)
    const { p, q, len, ex, ez, nx, nz } = fr, mx = (p[0] + q[0]) / 2 + nx * 0.2, mz = (p[1] + q[1]) / 2 + nz * 0.2;
    const col = (P.r5 < 0.5 ? new THREE.Color(0.1, 0.09, 0.085) : P.wallColour.clone().multiplyScalar(0.8)).multiplyScalar(1 / 0.55);
    // (its face and its underside: four triangles)
    const o = 0.45, y0 = yEave - 0.75, y1 = yEave + 0.08, P0 = [p[0] - ex * 0.15, p[1] - ez * 0.15], Q0 = [q[0] + ex * 0.15, q[1] + ez * 0.15];
    W.quad([P0[0] + nx * o, y0, P0[1] + nz * o], [Q0[0] + nx * o, y0, Q0[1] + nz * o], [Q0[0] + nx * o, y1, Q0[1] + nz * o], [P0[0] + nx * o, y1, P0[1] + nz * o], [nx, 0, nz], col, STYLE.SOFFIT, y0, y1);
    W.quad([P0[0], y0, P0[1]], [Q0[0], y0, Q0[1]], [Q0[0] + nx * o, y0, Q0[1] + nz * o], [P0[0] + nx * o, y0, P0[1] + nz * o], [0, -1, 0], col, STYLE.SOFFIT, y0, y1);
  }
  if (P.stoop && fr && fr.len >= 4.5 && fr.len < 90) {
    // a stoop up to the parlour floor's door at one side of each house, the door at its top
    const { p, len, ex, ez, nx, nz } = fr, n = Math.max(1, Math.round(len / 6.2)), pw = len / n;
    const hT = base + P.gh, run = clamp(P.gh * 1.7, 1.8, 3.0), w2 = 0.8, sc = P.wallColour.clone().multiplyScalar(0.85), door = new THREE.Color(0.1, 0.06, 0.04).multiplyScalar(1 / 0.55);
    for (let k = 0; k < n; k++) {
      const c = k * pw + pw * (hashf(P.id + k, 141) < 0.5 ? 0.24 : 0.76);
      const at = (u, s, y) => [p[0] + ex * u + nx * s, y, p[1] + ez * u + nz * s];
      const g = ground0(p[0] + ex * c + nx * (1 + run), p[1] + ez * c + nz * (1 + run));
      const A0 = at(c - w2, 0, hT), A1 = at(c + w2, 0, hT), B0 = at(c - w2, 1.0, hT), B1 = at(c + w2, 1.0, hT), C0 = at(c - w2, 1.0 + run, g), C1 = at(c + w2, 1.0 + run, g);
      const sl = Math.hypot(run, hT - g) || 1, up = [nx * (hT - g) / sl, run / sl, nz * (hT - g) / sl];
      W.quad(B0, B1, A1, A0, [0, 1, 0], sc, STYLE.ROOFING, g, hT);
      W.quad(C0, C1, B1, B0, up, sc, STYLE.ROOFING, g, hT);
      for (const [u, sd] of [[c - w2, -1], [c + w2, 1]]) {
        const a = at(u, 0, g), b2 = at(u, 0, hT), d2 = at(u, 1.0, hT), e2 = at(u, 1.0 + run, g);
        // (wound as a wall whose bottom edge runs out from the wall on the left side, back to it on the right)
        if (sd < 0) W.quad(a, e2, d2, b2, [ex * sd, 0, ez * sd], sc, STYLE.SOFFIT, g, hT); else W.quad(b2, d2, e2, a, [ex * sd, 0, ez * sd], sc, STYLE.SOFFIT, g, hT);
      }
      const D0 = at(c - 0.55, 0.04, hT), D1 = at(c + 0.55, 0.04, hT), D2 = at(c + 0.55, 0.04, hT + 2.5), D3 = at(c - 0.55, 0.04, hT + 2.5);
      W.quad(D0, D1, D2, D3, [nx, 0, nz], door, STYLE.SOFFIT, hT, hT + 2.5);
    }
  }
  if (P.roofTank && P.shape === 'flat') {
    // a water tank on legs on a Japanese house's flat roof, near a corner
    const X = P.ax || P.ob, u = (X.hl - 1.0) * (P.r2 < 0.5 ? 1 : -1), v = (X.hw - 1.0) * (P.r3 < 0.5 ? 1 : -1);
    if (X.hl > 2 && X.hw > 2) { const x = X.cx + X.A[0] * u + X.P[0] * v, z = X.cz + X.A[1] * u + X.P[1] * v, y = base + P.H; box(W, x, z, X.A, 0.55, 0.5, y + 0.35, y + 1.25, new THREE.Color(0.6, 0.62, 0.62).multiplyScalar(1 / 0.55), STYLE.SOFFIT, true); }
  }
  if (P.church && P.area > 180 && P.H > 9) {
    // a church's tower at the end of its nave nearer the street, with a spire (slate, or copper gone green)
    const X = P.ax || P.ob, A = X.A, Q = [-A[1], A[0]], sz = clamp(X.hw * 1.1, 3.5, 7.5);
    if (X.hl > sz * 1.3) {
      const ends = [1, -1].map(sg => [X.cx + A[0] * sg * (X.hl - sz / 2), X.cz + A[1] * sg * (X.hl - sz / 2)]);
      let e = ends[hashf(P.id, 130) < 0.5 ? 0 : 1];
      if (ctx.nearRoad) { try { const d = ends.map(q => { const r = ctx.nearRoad(q[0], q[1]); return r ? r.dist : 1e9; }); e = d[0] <= d[1] ? ends[0] : ends[1]; } catch (er) { /* no roads */ } }
      if (inRing(e[0], e[1], P.outer)) {
        const top = base + P.H + 4 + P.r5 * 8, col = P.wallColour, Ft = [sz, 0.2, 0.36, FBIT.ONE | FBIT.ARCH], h2 = sz / 2;
        const C = (sa, sb, y) => [e[0] + A[0] * h2 * sa + Q[0] * h2 * sb, y, e[1] + A[1] * h2 * sa + Q[1] * h2 * sb];
        const faces = [[[1, 1], [1, -1], [A[0], 0, A[1]]], [[-1, 1], [1, 1], [Q[0], 0, Q[1]]], [[-1, -1], [-1, 1], [-A[0], 0, -A[1]]], [[1, -1], [-1, -1], [-Q[0], 0, -Q[1]]]];
        for (const [s0, s1, n] of faces) W.quad(C(s0[0], s0[1], base), C(s1[0], s1[1], base), C(s1[0], s1[1], top), C(s0[0], s0[1], top), n, col, P.style, base, top, Ft);
        // (a door in the tower's face towards the street, under its first window)
        { const sg = e === ends[0] ? 1 : -1, n = [A[0] * sg, A[1] * sg], d = [n[1], -n[0]], c = [e[0] + n[0] * (h2 + 0.03), e[1] + n[1] * (h2 + 0.03)], dc = new THREE.Color(0.16, 0.09, 0.05).multiplyScalar(1 / 0.55);
          W.quad([c[0] - d[0] * 0.8, base, c[1] - d[1] * 0.8], [c[0] + d[0] * 0.8, base, c[1] + d[1] * 0.8], [c[0] + d[0] * 0.8, base + 2.9, c[1] + d[1] * 0.8], [c[0] - d[0] * 0.8, base + 2.9, c[1] - d[1] * 0.8], [n[0], 0, n[1]], dc, STYLE.SOFFIT, base, base + 2.9); }
        const apex = [e[0], top + sz * (1.4 + P.r2), e[1]], sp = P.r3 < 0.3 ? new THREE.Color(0.2, 0.36, 0.3) : new THREE.Color(0.1, 0.1, 0.11);
        for (const [s0, s1, n] of faces) W.tri(C(s0[0], s0[1], top), C(s1[0], s1[1], top), apex, [n[0] * 0.8, 0.6, n[2] * 0.8], sp, STYLE.ROOFING, top, apex[1]);
      }
    }
  }
  if (P.ground === GROUND.SHOP && P.front >= 0 && !P.core && P.style !== STYLE.GLASS && P.gh >= 3.0 && P.H < 45) {
    // awnings over shop fronts (Paris cafés, Tokyo's shopping streets, New York's delis, London's shops): a sloping
    // cloth on the street side of some of the smaller shop buildings, one a shop where the front is long
    const share = { fr: 0.45, jp: 0.5, usn: 0.35, uk: 0.35, med: 0.5, de: 0.25, nl: 0.3, be: 0.3, alps: 0.25, scand: 0.15 }[ctx.zone] ?? 0.15;
    const o = P.outer, p = o[P.front], q = o[(P.front + 1) % o.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (hashf(P.id, 95) < share && len >= 3.5 && len < 70) {
      const ex = dx / len, ez = dz / len, nx = -ez, nz = ex, m = Math.min(0.7, len * 0.08);
      const n = len > 14 ? Math.max(2, Math.round((len - 2 * m) / 7)) : 1, sw = (len - 2 * m) / n;
      // (under the shop's sign band where the ground floor is tall enough, its valance always 2.2 m over the pavement)
      const d = 1.0 + 0.5 * hashf(P.id, 97), drop = 0.5 + 0.2 * hashf(P.id, 98);
      const yTop = base + Math.min(P.gh - 0.1, Math.max(P.gh - 1.0, 2.42 + drop)), yLow = yTop - drop, yVal = yLow - 0.22;
      const sl = Math.hypot(d, drop), up = [nx * drop / sl, d / sl, nz * drop / sl], dn = [-up[0], -up[1], -up[2]];
      const both = (a, b, c, e, nrm, col) => { W.quad(a, b, c, e, nrm, col, STYLE.SOFFIT, yVal, yTop); W.quad(e || c, e ? c : b, e ? b : a, e ? a : null, [-nrm[0], -nrm[1], -nrm[2]], col, STYLE.SOFFIT, yVal, yTop); };
      for (let k = 0; k < n; k++) {
        // (one colour a building, or a shop's own; the walls' shader shows a soffit at 0.55 of its colour)
        const ci = ((hashf(k > 0 && hashf(P.id + k, 99) < 0.5 ? P.id + k : P.id, 96) * AWNING.length) | 0) % AWNING.length;
        const c0 = AWNING[ci], top = c0.clone().multiplyScalar(1.8), under = c0.clone();
        const s0 = m + k * sw + 0.12, s1 = m + (k + 1) * sw - 0.12;
        const A = [p[0] + ex * s0, yTop, p[1] + ez * s0], B = [p[0] + ex * s1, yTop, p[1] + ez * s1];
        const C = [B[0] + nx * d, yLow, B[2] + nz * d], D = [A[0] + nx * d, yLow, A[2] + nz * d];
        W.quad(D, C, B, A, up, top, STYLE.SOFFIT, yVal, yTop);
        W.quad(A, B, C, D, dn, under, STYLE.SOFFIT, yVal, yTop);
        // the valance along its front, and the side flaps
        both([D[0], yVal, D[2]], [C[0], yVal, C[2]], C, D, [nx, 0, nz], top);
        both(A, D, [A[0], yLow, A[2]], null, [-ex, 0, -ez], top);
        both(B, [B[0], yLow, B[2]], C, null, [ex, 0, ez], top);
      }
    }
  }
  if (P.dormers && terms && P.front >= 0) {
    // dormers on the slope that faces the street (a mansard's: one a bay all along its fronts)
    const o = P.outer, edgesList = P.dormers === 'bays' ? o.map((_, i) => i) : [P.front];
    let made = 0;
    for (const ei of edgesList) {
      const p = o[ei], q = o[(ei + 1) % o.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < 4) continue;
      const ex = dx / len, ez = dz / len, nx = -ez, nz = ex;
      if (P.dormers === 'bays') { let rp = null; try { rp = ctx.nearRoad ? ctx.nearRoad(p[0] + dx / 2 + nx * 6, p[1] + dz / 2 + nz * 6) : null; } catch (e) {} if (!rp || rp.dist > 25) continue; }
      // (a mansard's every other bay: a dormer is a dozen triangles, and Paris has thousands of fronts)
      const step = P.dormers === 'bays' ? 5.0 : Math.max(2.8, len / 3), nD = P.dormers === 'bays' ? Math.floor((len - 1) / step) : Math.min(3, Math.max(1, Math.floor(len / 4.5)));
      for (let k = 0; k < nD && made < 10; k++) {
        const s = (len - (nD - 1) * step) / 2 + k * step;
        dormer(P, W, R, terms, p[0] + ex * s, p[1] + ez * s, ex, ez, nx, nz, yEave, roofCol, uvOf, rc);
        made++;
      }
    }
  }
  if (P.parisStacks && terms) {
    // a long stack on the top of each party wall (the walls that face no street), with its pots
    const o = P.outer, top = yEave + P.roofH, col = new THREE.Color().setRGB(0.62, 0.5, 0.42, THREE.SRGBColorSpace).multiplyScalar(0.62);
    let made = 0;
    for (let i = 0; i < o.length && made < 3; i++) {
      const p = o[i], q = o[(i + 1) % o.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < 6) continue;
      const ex = dx / len, ez = dz / len, nx = -ez, nz = ex;
      let rp = null; try { rp = ctx.nearRoad ? ctx.nearRoad(p[0] + dx / 2 + nx * 6, p[1] + dz / 2 + nz * 6) : null; } catch (e) {}
      if (rp && rp.dist < 14) continue; // a street front
      const hl = Math.min(len * 0.3, 4.5), c = [p[0] + dx / 2 - nx * 0.5, p[1] + dz / 2 - nz * 0.5];
      box(W, c[0], c[1], [ex, ez], hl, 0.35, top - 0.6, top + 1.1 + P.r2 * 0.5, col, STYLE.STUCCO, true, new THREE.Color(0.08, 0.07, 0.07));
      made++;
    }
  }
  if (P.waterTower) {
    // a timber water tank on steel legs, near one corner of the roof
    const X2 = P.ob, u = (P.r5 - 0.5) * X2.hl, v = (P.r6 - 0.5) * X2.hw;
    const cx = X2.cx + X2.A[0] * u + X2.P[0] * v, cz = X2.cz + X2.A[1] * u + X2.P[1] * v;
    if (inRing(cx, cz, P.outer)) {
      const y0 = base + P.H, legH = 3 + P.r1 * 2, r = 1.9 + P.r2 * 0.8, tH = 4.2 + P.r3 * 1.5;
      const iron = new THREE.Color(0.06, 0.06, 0.06);
      // (its legs as one dark frame of two crossed sheets each way: a tank is about 30 triangles)
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const e0 = [cx - dx * r * 0.62, y0, cz - dz * r * 0.62], e1 = [cx + dx * r * 0.62, y0, cz + dz * r * 0.62];
        W.quad(e0, e1, [e1[0], y0 + legH, e1[2]], [e0[0], y0 + legH, e0[2]], [-dz, 0, dx], iron, STYLE.METAL, y0, y0 + legH);
        W.quad(e1, e0, [e0[0], y0 + legH, e0[2]], [e1[0], y0 + legH, e1[2]], [dz, 0, -dx], iron, STYLE.METAL, y0, y0 + legH);
      }
      const wood = new THREE.Color().setRGB(0.36, 0.3, 0.24, THREE.SRGBColorSpace).multiplyScalar(0.62);
      const N = 8, ya = y0 + legH, yb = ya + tH;
      for (let i = 0; i < N; i++) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
        W.quad([cx + Math.cos(a1) * r, ya, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, ya, cz + Math.sin(a0) * r], [cx + Math.cos(a0) * r, yb, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, yb, cz + Math.sin(a1) * r], [Math.cos(am), 0, Math.sin(am)], wood, STYLE.WOOD, ya, yb);
        // its cone, in the roofing's dark
        const apex = [cx, yb + r * 0.55, cz];
        W.tri([cx + Math.cos(a1) * r * 1.05, yb, cz + Math.sin(a1) * r * 1.05], [cx + Math.cos(a0) * r * 1.05, yb, cz + Math.sin(a0) * r * 1.05], apex, [Math.cos(am) * 0.5, 0.86, Math.sin(am) * 0.5], new THREE.Color(0.07, 0.07, 0.07), STYLE.ROOFING, yb, apex[1]);
      }
    }
  }
}
// one dormer at (x, z) on the front slope: its face and window (the walls' material), two cheeks and a small roof
function dormer(P, W, R, terms, x, z, ex, ez, nx, nz, yEave, roofCol, uvOf, rc) {
  const hwid = 0.7, depthIn = 1.6;
  // the slope's height at the dormer's face (a little up from the eave) and further in
  const fx = x - nx * 0.6, fz = z - nz * 0.6;
  const yF = yEave + roofAt(P, terms, fx, fz), yIn = yEave + roofAt(P, terms, fx - nx * depthIn, fz - nz * depthIn);
  if (yIn - yF < 0.4) return;
  const y0 = yF, y1 = Math.min(yF + 1.6, yEave + P.roofH - 0.3); if (y1 - y0 < 1.0) return;
  const peak = y1 + 0.45;
  const L0 = [fx - ex * hwid, y0, fz - ez * hwid], R0 = [fx + ex * hwid, y0, fz + ez * hwid], R1 = [R0[0], y1, R0[2]], L1 = [L0[0], y1, L0[2]];
  const Fd = [0, 0.55, 0.62, (P.F[3] & 3) | FBIT.ONE];
  const keep = W.F; W.F = Fd;
  const wc = P.wallColour, seed = Math.floor(P.r4 * 997) + 3;
  const ia = W.v(L0[0], y0, L0[2], nx, 0, nz, wc, 0, 1.4, y1 - y0 + 0.4, y0 - 50, y0, y1 - y0, 0, seed, P.style === STYLE.GLASS ? STYLE.STUCCO : P.style, 0, P.look === LOOK.HAUSS ? LOOK.HAUSS : 0);
  const ib = W.v(R0[0], y0, R0[2], nx, 0, nz, wc, 1.4, 1.4, y1 - y0 + 0.4, y0 - 50, y0, y1 - y0, 0, seed, P.style === STYLE.GLASS ? STYLE.STUCCO : P.style, 0, P.look === LOOK.HAUSS ? LOOK.HAUSS : 0);
  const ic = W.v(R1[0], y1, R1[2], nx, 0, nz, wc, 1.4, 1.4, y1 - y0 + 0.4, y0 - 50, y0, y1 - y0, 0, seed, P.style === STYLE.GLASS ? STYLE.STUCCO : P.style, 0, P.look === LOOK.HAUSS ? LOOK.HAUSS : 0);
  const id = W.v(L1[0], y1, L1[2], nx, 0, nz, wc, 0, 1.4, y1 - y0 + 0.4, y0 - 50, y0, y1 - y0, 0, seed, P.style === STYLE.GLASS ? STYLE.STUCCO : P.style, 0, P.look === LOOK.HAUSS ? LOOK.HAUSS : 0);
  W.idx.push(ia, ib, ic, ia, ic, id);
  W.F = keep;
  // the cheeks: from the face back into the slope
  const back = (pt, y) => { const bx = pt[0] - nx * depthIn, bz = pt[2] - nz * depthIn; return [bx, Math.max(y, yEave + roofAt(P, terms, bx, bz)), bz]; };
  const cheek = P.zinc ? new THREE.Color(0.2, 0.21, 0.22) : roofCol;
  const LB = back(L1, y1), RB = back(R1, y1);
  W.tri(L0, L1, LB, [-ex, 0, -ez], cheek, STYLE.ROOFING, y0, y1);
  W.tri(R1, R0, RB, [ex, 0, ez], cheek, STYLE.ROOFING, y0, y1);
  // its roof: a small gable from the face back into the slope
  const PK = [fx, peak, fz], PB = [fx - nx * depthIn, peak, fz - nz * depthIn];
  const roofL = [L1[0] + nx * 0.12 - ex * 0.08, y1 - 0.05, L1[2] + nz * 0.12 - ez * 0.08], roofR = [R1[0] + nx * 0.12 + ex * 0.08, y1 - 0.05, R1[2] + nz * 0.12 + ez * 0.08];
  const LBk = [LB[0] - ex * 0.08, LB[1], LB[2] - ez * 0.08], RBk = [RB[0] + ex * 0.08, RB[1], RB[2] + ez * 0.08];
  W.quad(roofL, PK, PB, LBk, [-ex * 0.5, 0.86, -ez * 0.5], cheek, STYLE.ROOFING, y1, peak);
  W.quad(PK, roofR, RBk, PB, [ex * 0.5, 0.86, ez * 0.5], cheek, STYLE.ROOFING, y1, peak);
  // (the gable over the window, the face's own colour)
  W.tri(L1, R1, PK, [nx, 0, nz], wc, STYLE.SOFFIT, y1, peak);
}

function defaultRoof(P, ctx) {
  if (P.shape === 'flat') return new THREE.Color(0.32, 0.32, 0.31);
  const la = frame.lat, lo = frame.lon;
  const tiles = (la < 44 && la > 30 && lo > -10 && lo < 30) || (lo < -30 && lo > -120 && la < 30);
  if (tiles) return new THREE.Color().setRGB(0.55 + P.r2 * 0.1, 0.27, 0.18, THREE.SRGBColorSpace);
  return P.r2 < 0.6 ? new THREE.Color().setRGB(0.28, 0.28, 0.29, THREE.SRGBColorSpace) : new THREE.Color().setRGB(0.36, 0.3, 0.25, THREE.SRGBColorSpace);
}

// ---------- imagery: lean of tall buildings, roof colours ----------
const lum = (c) => c ? 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] : NaN;

// Satellite pictures are taken a little off vertical, so a tall roof is drawn shifted from its footprint by
// (height x a constant vector). Find that vector for the cell: the shift at which the roofs' outlines sit on the
// strongest edges in the picture. Nearby cells share the picture, so the first good answer is where the next
// cells start looking.
let LEAN_HINT = null;
async function estimateLean(plans, lumAt, slice) {
  const tall = plans.filter(P => P.H > 28 && P.area > 150).sort((a, b) => b.H - a.H).slice(0, 30);
  if (tall.length < 3) return null;
  const samples = [];
  for (const P of tall) {
    const r = P.outer, n = r.length, list = [];
    for (let i = 0; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < 4) continue;
      const nx = -dz / len, nz = dx / len, k = Math.max(1, Math.floor(len / 3));
      for (let j = 0; j < k; j++) { const s = (j + 0.5) / k; list.push([p[0] + dx * s, p[1] + dz * s, nx, nz]); }
    }
    while (list.length > 60) list.splice(Math.floor(list.length * 0.37) % list.length, 1);
    if (list.length) samples.push({ H: P.H, list });
  }
  const score = (kx, kz) => {
    let s = 0, c = 0;
    for (const B of samples) {
      const ox = kx * B.H, oz = kz * B.H;
      let sb = 0, cb = 0;
      for (const [x, z, nx, nz] of B.list) {
        const a = lumAt(x + ox - nx * 1.4, z + oz - nz * 1.4), b = lumAt(x + ox + nx * 1.4, z + oz + nz * 1.4);
        if (a !== a || b !== b) continue;
        sb += Math.abs(a - b); cb++;
      }
      if (cb) { s += sb / cb; c++; }
    }
    return c ? s / c : 0;
  };
  const s0 = score(0, 0);
  let best = [0, 0], bs = s0;
  // (a slice a try: a row of them was a 40 to 90 ms task in a dense core)
  const tryK = async (kx, kz) => { const s = score(kx, kz); if (s > bs) { bs = s; best = [kx, kz]; } await slice('lean'); };
  const hint = LEAN_HINT && LEAN_HINT.lat === frame.lat && LEAN_HINT.lon === frame.lon ? LEAN_HINT.k : null;
  if (hint) {
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) await tryK(hint[0] + a * 0.02, hint[1] + b * 0.02);
  } else {
    for (let kx = -0.6; kx <= 0.6001; kx += 0.1) for (let kz = -0.6; kz <= 0.6001; kz += 0.1) await tryK(kx, kz);
    for (const st of [0.03, 0.01]) {
      const [bx, bz] = best;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) await tryK(bx + a * st, bz + b * st);
    }
  }
  // only trust a clear improvement, well inside the range searched
  if (bs < s0 * 1.2 || Math.abs(best[0]) > 0.62 || Math.abs(best[1]) > 0.62) return null;
  if (bs > s0 * 1.25) LEAN_HINT = { lat: frame.lat, lon: frame.lon, k: best };
  return { k: best, gain: bs / Math.max(1e-6, s0) };
}

function roofMean(P, at, lean) {
  const { ob } = P;
  let r = 0, g = 0, b = 0, c = 0;
  const off = lean ? [lean[0] * P.H, lean[1] * P.H] : [0, 0];
  for (let i = 0; i < 48 && c < 24; i++) {
    const u = (hashf(P.id, 10 + i) - 0.5) * 2 * ob.hl * 0.9, v = (hashf(P.id, 70 + i) - 0.5) * 2 * ob.hw * 0.9;
    const x = ob.cx + ob.A[0] * u + ob.P[0] * v, z = ob.cz + ob.A[1] * u + ob.P[1] * v;
    if (!inRing(x, z, P.outer)) continue;
    const s = at(x + off[0], z + off[1]); if (!s) continue;
    r += s[0]; g += s[1]; b += s[2]; c++;
  }
  return c ? [r / c / 255, g / c / 255, b / c / 255] : null;
}

// A leaning picture shows the faces that look towards the satellite, between each base and its shifted roof:
// the mean colour of those faces is the building's real wall colour.
function facadeMean(P, at, lean) {
  if (!lean || P.H < 9) return null;
  const kl = Math.hypot(lean[0], lean[1]);
  if (kl < 0.08) return null;
  const r = P.outer, n = r.length;
  let R = 0, G = 0, B = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 3) continue;
    const nx = -dz / len, nz = dx / len;
    // faces turned towards the satellite: against the shift
    if ((nx * lean[0] + nz * lean[1]) / kl > -0.35) continue;
    const m = Math.min(6, Math.floor(len / 3));
    for (let j = 0; j < m; j++) for (const f of [0.3, 0.5, 0.7, 0.85]) {
      const s = (j + 0.5) / m, h = P.minH + (P.eave - P.minH) * f;
      const x = p[0] + dx * s + lean[0] * h, z = p[1] + dz * s + lean[1] * h;
      const v = at(x, z); if (!v) continue;
      R += v[0]; G += v[1]; B += v[2]; c++;
    }
  }
  return c >= 8 ? [R / c / 255, G / c / 255, B / c / 255] : null;
}

// (walls are never darker than a dark brick: a front read from the picture in shade came out near black)
function wallColour(P, mean, face) {
  const c = wallColour0(P, mean, face);
  if (P.style === STYLE.GLASS) return c;
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, lo = 0.05;
  if (l < 0.004) { const pal = P.palette || PAL_LIN[P.style] || PAL_LIN[STYLE.CONCRETE]; return pal[Math.floor(P.r3 * pal.length) % pal.length].clone(); }
  if (l < lo) c.multiplyScalar(lo / l);
  return c;
}
function wallColour0(P, mean, face) {
  // (a front that came out the colour of the roof was most likely the roof, or the next one, seen through a wrong
  // lean: old towns' red tiles made red walls)
  if (face && mean && Math.abs(face[0] - mean[0]) + Math.abs(face[1] - mean[1]) + Math.abs(face[2] - mean[2]) < 0.12) face = null;
  if (face && !P.colour) {
    // the picture's colour (in light and shade as the satellite saw it), kept within what walls are
    const c = new THREE.Color().setRGB(face[0], face[1], face[2], THREE.SRGBColorSpace);
    const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // (a house's walls are small in the picture and mostly come out as its eaves and their shade: lighter, and
    // more of the palette's paint and siding)
    const house = P.houseLike, k = Math.min(house ? 2.4 : 1.6, Math.max(0.7, (house ? 0.42 : 0.3) / Math.max(0.02, l)));
    c.multiplyScalar(k * 0.85);
    const pal = P.palette || PAL_LIN[P.style] || PAL_LIN[STYLE.CONCRETE];
    // (a city's row houses keep more of their own stone, brick or paint)
    return c.lerp(pal[Math.floor(P.r3 * pal.length) % pal.length], P.stoop || P.parapet || P.church ? 0.8 : P.palette ? 0.55 : house ? 0.6 : 0.25);
  }
  if (P.colour) {
    // 'red' or 'yellow' in a tag means a red or yellow building, not paint straight from the tube
    const c = P.colour.clone(), l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    c.lerp(new THREE.Color(l, l, l), 0.45).multiplyScalar(0.62);
    return c;
  }
  const pal = P.palette || PAL_LIN[P.style] || PAL_LIN[STYLE.CONCRETE];
  let pick = pal[Math.floor(P.r3 * pal.length) % pal.length];
  if (mean && !P.palette) {
    // lean towards the roof's colour family: warm roofs, warm walls; light roofs, light walls
    const warm = mean[0] - mean[2], light = (mean[0] + mean[1] + mean[2]) / 3;
    let best = null, bs = Infinity;
    pal.forEach((c, i) => {
      const s = new THREE.Color().copy(c).convertLinearToSRGB();
      const cw = s.r - s.b, cl = (s.r + s.g + s.b) / 3;
      const sc = Math.abs(cw - warm) * 1.2 + Math.abs(cl - (0.35 + light * 0.7)) * 0.35 + hashf(P.id, 200 + i) * 0.5;
      if (sc < bs) { bs = sc; best = c; }
    });
    pick = best;
  }
  const c = pick.clone().multiplyScalar(0.92 + 0.16 * P.r4);
  return c;
}
// the roofing's colour for porches, dormers and bay tops: the roof's own (tagged, or the picture's mean)
function roofingColour(P, mean) {
  if (P.roofColour) return P.roofColour.clone().multiplyScalar(0.62);
  if (P.zinc) return new THREE.Color(0.17, 0.18, 0.19).multiplyScalar(0.8 + 0.4 * P.r5);
  if (mean) { const c = new THREE.Color().setRGB(mean[0], mean[1], mean[2], THREE.SRGBColorSpace); return c.multiplyScalar(0.85); }
  return new THREE.Color(0.12, 0.12, 0.125);
}

// ---------- the frame budget, the shared roof materials, the pictures' uploads ----------
// All the buildings' work shares one budget a frame (FRAME_BUDGET ms over every build and worker); past it, the
// work waits for the next animation frame.
const FRAME_BUDGET = 7; // (30 behind the loading card, where no frame is drawn)
const SCHED = { spent: 0, waiting: [], on: false, last: 0, dt: 16.7 };
// (a frame that waits on the graphics card leaves the page's thread idle: the budget grows with the frame's length,
// about 45% of it, from 7 to 25 ms)
// (tests: ?bcap=N sets the cap, for A/B runs of the build's speed against its frames)
const BCAP = (() => { try { const m = /[?&]bcap=(\d+)/.exec(location.search); return m ? +m[1] : 25; } catch (e) { return 25; } })();
// (round 6b, perf P: at most 5 ms a frame on the low tier, so a rebuild takes longer but the frames stay even)
const budget = () => behindCard() ? Math.max(30, BCAP) : (globalThis.__carQuality && globalThis.__carQuality.low) ? 5 : Math.max(FRAME_BUDGET, Math.min(BCAP, SCHED.dt * (BCAP > 25 ? 0.6 : 0.45)));
function nextFrame() {
  return new Promise(res => {
    SCHED.waiting.push(res);
    if (SCHED.on) return;
    SCHED.on = true;
    const go = (t) => { if (t && SCHED.last) SCHED.dt = SCHED.dt * 0.7 + Math.min(100, t - SCHED.last) * 0.3; SCHED.last = t || 0; SCHED.on = false; SCHED.spent = 0; const w = SCHED.waiting; SCHED.waiting = []; for (const f of w) f(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else setTimeout(go, 16);
  });
}
// the camera flying down after the loading card (camera.js swoop): nothing is shown, built or uploaded then
function flying() { try { const D = window.__car && window.__car.drive; return !!(D && !D.holdRender && D.cam && D.cam.introT > 0); } catch (e) { return false; } }
function behindCard() { try { const D = window.__car && window.__car.drive; return !!(D && D.holdRender); } catch (e) { return false; } }
// One material for every plain roof (its colours in the vertices), and a keeper of the pictured roofs' program
// (each cell's own material, with its picture, shares that program): never disposed, so never built again.
let ROOF_PLAIN = null, ROOF_KEEP = null, ROOF_KEEP_MESH = null;
const WARMED = new WeakSet(), COMPILING = new WeakMap();
function roofPlain() {
  if (ROOF_PLAIN) return ROOF_PLAIN;
  ROOF_PLAIN = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  patchBaked(ROOF_PLAIN); ROOF_PLAIN.shadowSide = THREE.DoubleSide;
  return ROOF_PLAIN;
}
function roofPictured(tex) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, map: tex, side: THREE.DoubleSide });
  patchBaked(m); m.shadowSide = THREE.DoubleSide;
  return m;
}
function roofKeeper() {
  if (ROOF_KEEP) return ROOF_KEEP;
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return (ROOF_KEEP = roofPictured(t));
}
// the pictures, one a frame (a frame that took over 40 ms is let by, up to six in a row), never while flying down
const UPQ = [];
export const UPLOADS = []; // (tests: [when, ms, width] of the last uploads)
if (typeof window !== 'undefined') window.__bldUploads = UPLOADS;
let upOn = false, upLast = 0, upSkip = 0;
// (round 6, perf P: and on the low tier, quality.js roofPics; the roofs keep their plain colour from the picture)
const NO_ROOFPIC = (() => { try { return /[?&]noroofpic/.test(location.search) || !!(globalThis.__carQuality && globalThis.__carQuality.p && globalThis.__carQuality.p.roofPics === false); } catch (e) { return false; } })();
function queueUpload(renderer, rec, roof, tex) {
  if (NO_ROOFPIC) { tex.dispose(); return; }
  const j = { renderer, rec, roof, tex, bitmap: undefined };
  // (the picture as an ImageBitmap, made off the frame: its strips are copied from it on the graphics card)
  if (!STRIP_CPU && typeof createImageBitmap === 'function' && tex.image) createImageBitmap(tex.image).then(b => { j.bitmap = b; }, () => { j.bitmap = null; });
  else j.bitmap = null;
  UPQ.push(j); if (!upOn) { upOn = true; requestAnimationFrame(upStep); }
}
// The pictures go up in strips (buildings agent, round 4): the texture's storage is made once (immutable, sRGB,
// every mip level), then about 512 KB of the picture's own pixels a frame (128 rows of a 1024 px picture) with
// texSubImage2D, the mip levels made after the last; the roof keeps its plain colour until then and gets the
// texture as a THREE.ExternalTexture. A whole picture in one upload (initTexture) held the graphics process up 100 to
// 180 ms, so the lead had held them back until the car stood still. A frame over 80 ms is let by, three in a row.
let UPJ = null, ANISO = undefined;
// (tests: ?striprows=N rows a strip, 0 the whole picture at once; ?stripcpu reads the pixels on the CPU instead of a bitmap)
const STRIP_ROWS = (() => { try { const m = /[?&]striprows=(\d+)/.exec(location.search); return m ? +m[1] : -1; } catch (e) { return -1; } })();
const STRIP_CPU = (() => { try { return /[?&]stripcpu/.test(location.search); } catch (e) { return false; } })();
function stripStart(j) {
  const R = j.renderer, gl = R && R.getContext ? R.getContext() : null, img = j.tex.image;
  if (!gl || typeof gl.texStorage2D !== 'function' || !R.state || !img || !img.getContext || !THREE.ExternalTexture) return null;
  const w = img.width, h = img.height;
  if (!(w > 1 && h > 1)) return null;
  const data = j.bitmap ? null : img.getContext('2d').getImageData(0, 0, w, h).data;
  const glTex = gl.createTexture();
  R.state.bindTexture(gl.TEXTURE_2D, glTex);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.SRGB8_ALPHA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (ANISO === undefined) ANISO = gl.getExtension('EXT_texture_filter_anisotropic') || null;
  if (ANISO) gl.texParameterf(gl.TEXTURE_2D, ANISO.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, R.capabilities.getMaxAnisotropy ? R.capabilities.getMaxAnisotropy() : 8));
  // (from a bitmap the whole picture in one copy on the graphics card: 0 to 1 ms here, where a sub-rectangle of one
  // took about 30 ms a strip and reading a canvas back for strips 120 to 170 ms; from CPU pixels 128 rows a frame)
  const strip = Math.max(16, Math.floor(131072 / w));
  return { j, gl, glTex, data, bitmap: j.bitmap || null, w, h, y: 0, rows: STRIP_ROWS > 0 ? STRIP_ROWS : STRIP_ROWS === 0 || j.bitmap ? h : strip };
}
// one strip; true when the picture is done (or its cell is gone)
function stripStep(U) {
  const { gl, j } = U, R = j.renderer;
  if (j.rec.dead) { gl.deleteTexture(U.glTex); j.tex.dispose(); if (U.bitmap) U.bitmap.close(); return true; }
  R.state.bindTexture(gl.TEXTURE_2D, U.glTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  const n = Math.min(U.rows, U.h - U.y);
  if (U.bitmap) {
    // (rows y to y + n of the bitmap: WebGL 2 takes a source's sub-rectangle from the unpack skip settings)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, U.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, U.y, U.w, n, gl.RGBA, gl.UNSIGNED_BYTE, U.bitmap);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, U.y, U.w, n, gl.RGBA, gl.UNSIGNED_BYTE, U.data, U.y * U.w * 4);
  U.y += n;
  if (U.y < U.h) return false;
  gl.generateMipmap(gl.TEXTURE_2D);
  if (U.bitmap) U.bitmap.close();
  const ext = new THREE.ExternalTexture(U.glTex);
  ext.colorSpace = THREE.SRGBColorSpace; ext.flipY = false; ext.userData.gl = gl; ext.userData.glTex = U.glTex;
  j.tex.dispose();
  const m = roofPictured(ext);
  j.roof.material = m; j.rec.mats.push(m); j.rec.textures.push(ext);
  return true;
}
// (while the car moves, a picture at most every 1.5 s and only after a quick frame: each still cost the graphics
// process a frame over 100 ms now and then, 11 in 75 s of driving in Times Square with 39 pictures sent freely)
function stillNow() { try { const D = window.__car && window.__car.drive; if (!D || D.holdRender) return true; return D.stillFor ? D.stillFor(1200) : true; } catch (e) { return true; } }
let upAt = 0;
/* (lead, v35) no roof picture goes up while the car moves, only standing still (stillNow) or behind the card: one every
   1.5 s while driving still stalled the graphics process. First 25 s after a drop, frames over 100 ms with them / without:
   SF 11 / 1 and 8 / 4, Paris 8 / 0 and 9 / 0. ?moveup brings them back for tests. */
const NO_MOVE_UP = (() => { try { return !/[?&]moveup/.test(location.search); } catch (e) { return true; } })();
function upStep(t) {
  const dt = upLast ? t - upLast : 16; upLast = t;
  if (!UPJ && !UPQ.length) { upOn = false; upLast = 0; return; }
  const go = UPJ || stillNow() || (!NO_MOVE_UP && t - upAt >= 1500 && dt < 25);
  if (go && !flying() && (dt < 80 || ++upSkip > 3)) {
    upSkip = 0;
    const tu = performance.now();
    try {
      // (the next picture waits for its bitmap)
      if (!UPJ && UPQ[0].bitmap !== undefined) {
        const j = UPQ.shift();
        if (j.rec.dead) j.tex.dispose();
        else {
          UPJ = stripStart(j);
          if (!UPJ) {
            // (no WebGL 2: the whole picture at once, as before)
            try { if (j.renderer && j.renderer.initTexture) j.renderer.initTexture(j.tex); } catch (e) {}
            const m = roofPictured(j.tex); j.roof.material = m; j.rec.mats.push(m); j.rec.textures.push(j.tex);
          }
        }
      }
      if (UPJ && stripStep(UPJ)) { UPLOADS.push([Math.round(t), Math.round(performance.now() - tu), UPJ.w, 'done']); UPJ = null; upAt = t; }
      else if (UPJ) UPLOADS.push([Math.round(t), Math.round(performance.now() - tu), UPJ.w]);
    } catch (e) { console.warn('roof picture', e); if (UPJ) { try { UPJ.gl.deleteTexture(UPJ.glTex); } catch (e2) {} UPJ = null; } }
    if (UPLOADS.length > 64) UPLOADS.shift();
  }
  requestAnimationFrame(upStep);
}

// ---------- the public builder ----------
// Cells built by any live build, by signature (cell and the ids in it): a rebuild reuses them as they are.
const built = new Map();     // sig -> { sig, meshes, mats, textures, refs: Set, n }
let retiring = [];           // handles disposed while a newer build may still be on its way
let WALL_MAT = null;
const wallMaterial = () => WALL_MAT || (WALL_MAT = makeFacadeMaterial());

function freeRec(rec, world) {
  rec.dead = true;
  for (const m of rec.meshes) {
    if (m.parent) m.parent.remove(m);
    if (m.geometry.disposeBoundsTree && m.geometry.boundsTree) m.geometry.disposeBoundsTree();
    m.geometry.dispose();
    if (world && world.extra) { const i = world.extra.indexOf(m); if (i >= 0) world.extra.splice(i, 1); }
  }
  for (const m of rec.mats) m.dispose();
  for (const t of rec.textures) { t.dispose(); if (t.userData && t.userData.glTex) { try { t.userData.gl.deleteTexture(t.userData.glTex); } catch (e) {} } }
  built.delete(rec.sig);
}

const DRIVE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$/;
function roadIndex(list) {
  const G = 64, grid = new Map();
  for (const r of list) {
    if (!r || !r.pts || !DRIVE.test(r.highway || (r.tags && r.tags.highway) || '')) continue;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k], b = r.pts[k + 1];
      for (let i = Math.floor(Math.min(a[0], b[0]) / G); i <= Math.floor(Math.max(a[0], b[0]) / G); i++)
        for (let j = Math.floor(Math.min(a[1], b[1]) / G); j <= Math.floor(Math.max(a[1], b[1]) / G); j++) {
          const key = i + ',' + j; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([a, b]);
        }
    }
  }
  return (x, z) => {
    let best = null, bd = Infinity;
    const ci = Math.floor(x / G), cj = Math.floor(z / G);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const l = grid.get(i + ',' + j); if (!l) continue;
      for (const [a, b] of l) {
        const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
        const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
        if (d < bd) { bd = d; best = { x: px, z: pz, dist: d }; }
      }
    }
    return best;
  };
}

// A building's heights for its collision and its roof (collide.js roofAt): the walls from its base (or the
// underside of an overhang) to the eave, the roof's height at any point over its plan
const ROOFS = new Map(); // building id -> its roof, for cells reused by a later build
function roofInfo(P) {
  if (P.children) {
    // a house of wings: the highest wing's roof over each point
    const subs = P.children.map(C => ({ C, info: roofInfo(C) }));
    const top = Math.max(...subs.map(q => q.info.top)), base = P.baseY;
    return { base, eave: base + P.eave, top, under: null, at: (x, z) => { let y = -Infinity; for (const q of subs) if (inRing(x, z, q.C.outer)) y = Math.max(y, q.info.at ? q.info.at(x, z) : q.info.top); return isFinite(y) ? y : base + P.eave; } };
  }
  const base = P.baseY, terms = roofTerms(P), eave = base + P.eave, top = base + P.H;
  const under = P.minH > 0.3 ? base + P.minH : null;
  let at = terms && P.shape !== 'flat' && P.roofH > 0.05 ? (x, z) => eave + roofAt(P, terms, x, z) : null;
  if (RADIAL.has(P.shape)) at = (x, z) => eave + P.roofH * radialAt(P, x, z);
  return { base, eave, top, under, at };
}
// (the walls block up to a metre under the roof's edge: a car landing on the roof dips a little into it on its
// springs, and was pushed sideways off the roof by its own building's wall)
function applyRoof(sh, info) { sh.roof = info; sh.y0 = info.under != null ? info.under : -1e4; sh.y1 = Math.max(info.eave - 1.0, (info.under != null ? info.under : info.base) + 1.6); }

export function build(list, opts = {}) {
  const { scene, world, collide, imagery } = opts;
  const groundAt = opts.groundAt || (world ? (x, z) => world.groundAt(x, z) : () => 0);
  const parent = opts.parent || scene || (world && world.scene);
  const group = new THREE.Group(); group.name = 'buildings';
  group.matrixAutoUpdate = false; group.updateMatrix();
  const wallMat = opts.wallMaterial || wallMaterial();
  const ctx = { tri: { walls: 0, roofs: 0, extra: 0 }, groundAt, region: region(), zone: zoneOf(frame.lat, frame.lon), density: 0, g0: groundAt(0, 0) ?? 0, nearRoad: null, city: cityOf(frame.lat, frame.lon), cores: [], stuccoLdn: [] };
  // (Manhattan below 59th Street: offices and shops, not the row houses of Brooklyn and Harlem)
  ctx.midtown = frame.lat > 40.700 && frame.lat < 40.768 && frame.lon > -74.02 && frame.lon < -73.97;
  if (ctx.city === 'london') { ctx.londonMid = project(51.5125, -0.1330); for (const [la, lo, r, p] of STUCCO_LDN) { const [x, z] = project(la, lo); ctx.stuccoLdn.push([x, z, r, p]); } }
  for (const [la, lo, r, share, full] of CORES) { const [x, z] = project(la, lo); if (Math.hypot(x, z) < 6000) ctx.cores.push([x, z, r, share, full]); }
  // where the nearest road is (a house's front faces it): roads.js when given, else OSM road lines
  const RD = opts.roads;
  if (RD && !Array.isArray(RD) && typeof RD.nearestEdge === 'function') ctx.nearRoad = (x, z) => RD.nearestEdge(x, z, 80);
  else if (Array.isArray(RD) || Array.isArray(opts.roadList)) ctx.nearRoad = roadIndex(Array.isArray(RD) ? RD : opts.roadList);
  const recs = [], handles = [], shapeOf = new Map(); // shapeOf: building record -> its collision polygon
  let disposed = false, done = false;
  const stats = { buildings: 0, cells: 0, reused: 0, triangles: 0, lean: [], ms: 0, roofs: 0, pictureRoofs: 0, overture: null };
  // (triangles by kind: walls with their extras, the roofs, and of the walls' the extras alone)
  // older builds stay on screen until this one is ready, then go in one step
  const adopted = retiring; retiring = [];
  const progressive = !adopted.some(h => h.group.parent && h.group.children.length);
  if (progressive) parent.add(group);
  list = list || [];

  // collision now (cheap, no heights needed): every footprint the car can reach
  const addCollision = (b) => {
    // (a roof on posts never blocks: a canopy over a petrol station's pumps, a carport, whatever cell build it comes from)
    if (!collide || !collide.addPolygon || b.open || b.roofOnly || b.type === 'roof' || b.type === 'canopy' || b.type === 'carport' || !b.outer || b.outer.length < 3) return;
    // (until its heights are known (the cell's plan, below) a building blocks at any height; one that starts up in
    // the air (an overhang, a part on another) blocks nothing until then)
    const high = (b.minHeight || 0) > 3 || (b.minLevel || 0) > 1;
    try { const h = collide.addPolygon(b.outer.map(p => [p[0], p[1]]), high ? 1e4 : -1e4, 1e4, 'building'); if (h != null) { handles.push(h); shapeOf.set(b, h); } } catch (e) { /* collide not ready */ }
  };
  for (const b of list) addCollision(b);

  // Overture's records: what OSM's leave empty filled in, and the footprints only other sources have. Its answer
  // is usually in by now (drive.js asked for it with the streets); if not, a short wait, then without it.
  let lx0 = Infinity, lz0 = Infinity, lx1 = -Infinity, lz1 = -Infinity;
  for (const b of list) { const p = b.outer && b.outer[0]; if (p) { if (p[0] < lx0) lx0 = p[0]; if (p[0] > lx1) lx1 = p[0]; if (p[1] < lz0) lz0 = p[1]; if (p[1] > lz1) lz1 = p[1]; } }
  const mid = isFinite(lx0) ? [(lx0 + lx1) / 2, (lz0 + lz1) / 2] : (opts.focus || [0, 0]);
  const ovtP = opts.overture === false || overture.off() ? Promise.resolve(null) : (async () => {
    const t0 = performance.now();
    const ov = overture.peek(mid[0], mid[1]) || await overture.wait(mid[0], mid[1], opts.overtureWait ?? 1800);
    if (!ov || disposed) return null;
    const { add, stats: st } = await overture.enrich(list, ov, { budget: 6 });
    // (a footprint only another source has, lying on a road: a detection error, left out so it never blocks a lane)
    for (const b of add) {
      let cx = 0, cz = 0; for (const q of b.outer) { cx += q[0]; cz += q[1]; } cx /= b.outer.length; cz /= b.outer.length;
      let rp = null; try { rp = ctx.nearRoad ? ctx.nearRoad(cx, cz) : null; } catch (e) {}
      if (rp && rp.dist < Math.sqrt(Math.abs(area2(b.outer))) * 0.5 + 2) { st.offRoad = (st.offRoad || 0) + 1; continue; }
      list.push(b); addCollision(b);
    }
    st.wait = Math.round(performance.now() - t0);
    stats.overture = st;
    return st;
  })().catch(e => { console.warn('overture merge', e); return null; });

  const cam = (world && world.camera) || null;
  const focus = opts.focus || (cam ? [cam.position.x, cam.position.z] : [0, 0]);

  // a slice of work at a time, so the frame loop keeps running: each worker keeps its own clock, and all the
  // buildings' work together takes at most FRAME_BUDGET ms of a frame, then waits for the next animation frame
  const clock = () => {
    const k = { t0: performance.now(), cpu: 0, frames: 0 };
    k.reset = () => { k.t0 = performance.now(); };
    k.slice = async (where) => {
      const now = performance.now(), d = now - k.t0;
      SCHED.spent += d; k.t0 = now; k.cpu += d;
      if (d > 40) (stats.slow || (stats.slow = [])).push((where || '?') + ':' + Math.round(d));
      if (SCHED.spent > budget()) { k.frames++; await nextFrame(); k.t0 = performance.now(); }
    };
    return k;
  };

  // the walls' program and the roofs' two (plain, and with a picture) are built once for the whole visit (their
  // keepers are never disposed, so a rebuild never builds them again), off the main thread where the browser can,
  // and never while the camera flies down after the loading card
  const renderer = opts.renderer || (world && world.renderer);
  const warm = async (rec, k) => {
    if (!renderer || !cam || !renderer.compileAsync) return;
    const want = [];
    for (const m of rec.meshes) if (!WARMED.has(m.material)) want.push(m);
    if (!ROOF_KEEP_MESH) { ROOF_KEEP_MESH = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), roofKeeper()); ROOF_KEEP_MESH.name = 'roof keeper'; }
    if (!WARMED.has(ROOF_KEEP_MESH.material)) want.push(ROOF_KEEP_MESH);
    if (!want.length) return;
    while (flying()) await nextFrame();
    for (const m of want) {
      if (WARMED.has(m.material)) continue;
      const tc = performance.now();
      // (one compile a material however many workers ask)
      let pr = COMPILING.get(m.material);
      if (!pr) { pr = renderer.compileAsync(m, cam, parent).then(() => { WARMED.add(m.material); }, () => {}); COMPILING.set(m.material, pr); }
      await pr;
      (stats.compile || (stats.compile = [])).push(Math.round(performance.now() - tc));
    }
    k.reset();
  };
  // (the walls' and the plain roofs' programs asked for at once, on stand-ins with the cells' own shadow settings:
  // the walls' took 5 to 6 s to build here, and the first cells, made in 5 to 6 s, waited that long again for it)
  if (renderer && cam && renderer.compileAsync && !flying()) {
    const g = new THREE.PlaneGeometry(0.01, 0.01);
    for (const [mat, rs] of [[wallMat, true], [roofPlain(), false]]) {
      if (WARMED.has(mat) || COMPILING.has(mat)) continue;
      const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = rs;
      COMPILING.set(mat, renderer.compileAsync(m, cam, parent).then(() => { WARMED.add(mat); }, () => {}));
    }
  }
  const show = (rec) => {
    for (const m of rec.meshes) {
      group.add(m);
      if (world && world.extra && !world.extra.includes(m)) world.extra.push(m);
    }
  };
  // (as cells come in: one a frame, and none while the camera flies down; behind the loading card at once)
  const showSoon = async (rec) => {
    if (!behindCard()) { while (flying()) await nextFrame(); await nextFrame(); }
    if (!disposed && !rec.dead) show(rec);
  };

  let cells = null, order = null;
  const dist = (c) => Math.hypot((c.cx + 0.5) * CELL - focus[0], (c.cz + 0.5) * CELL - focus[1]);
  function makeCells() {
    // cells by centroid
    cells = new Map();
    for (const b of list) {
      if (!b || !b.outer || b.outer.length < 3) continue;
      let x = 0, z = 0; for (const p of b.outer) { x += p[0]; z += p[1]; } x /= b.outer.length; z /= b.outer.length;
      const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
      if (!cells.has(k)) cells.set(k, { key: k, cx: Math.floor(x / CELL), cz: Math.floor(z / CELL), list: [] });
      cells.get(k).list.push(b);
    }
    for (const c of cells.values()) {
      let a = 0; for (const b of c.list) a += Math.abs(area2(b.outer));
      c.density = Math.min(1, a / (CELL * CELL));
      // (what Overture added changes a cell: its tags go into the signature with the ids)
      // (round 6, agent T: a build that leaves the open tileset's buildings out keeps its cells apart from one that does not)
      c.sig = (typeof opts.realAt === 'function' ? 'v3r:' : 'v3:') + c.key + ':' + c.list.map(b => b.id + (b.ovt ? 'o' : '')).sort().join(',');
    }
    order = [...cells.values()].sort((a, b) => dist(a) - dist(b));
    ctx.shopsKnown = list.some(b => b.shop);
  }

  async function buildCell(c, k) {
    // (tests: when each cell started, waited for its picture's pixels, compiled and showed, in ms from the build's start)
    const T = { key: c.key, n: c.list.length, t0: Math.round(performance.now() - tStart), cpu0: k.cpu, fr0: k.frames }; (stats.cellT || (stats.cellT = [])).push(T);
    const old = built.get(c.sig);
    if (old) { old.refs.add(handle); recs.push(old); stats.reused++; stats.buildings += old.n; if (progressive) show(old); for (const b of c.list) { const sh = shapeOf.get(b), info = ROOFS.get(b.id); if (sh && info) applyRoof(sh, info); } return; }
    ctx.density = c.density;
    const plans = [];
    for (const b of c.list) {
      const tq = performance.now();
      const P = plan(b, ctx); if (P) { P.density = c.density; plans.push(P); }
      const dq = performance.now() - tq; if (dq > 20) (stats.slowPlan || (stats.slowPlan = [])).push([b.id, Math.round(dq), b.outer.length]);
      await k.slice('plan'); if (disposed) return;
    }
    if (!plans.length) return;
    // (round 6, agent T) the buildings an open 3D tileset already has (opentiles.js, drive.js ctx.realAt): planned for
    // their collision and roof as before, but not drawn, and no roof picture fetched for a cell of nothing but those
    let allReal = false;
    if (typeof opts.realAt === 'function') {
      try { for (const P of plans) { let sx = 0, sz = 0; for (const p of P.outer) { sx += p[0]; sz += p[1]; } P.real = !!opts.realAt(sx / P.outer.length, sz / P.outer.length); } } catch (e) { for (const P of plans) P.real = false; }
      allReal = plans.every(P => P.real);
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, hmax = 0;
    for (const P of plans) { for (const p of P.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } hmax = Math.max(hmax, P.H); }
    const pad = 2 + Math.min(70, hmax * 0.3);
    // The satellite picture in two parts: its pixels (z18 tiles, read on the CPU for the roofs' shapes, colours and
    // the lean) are waited for, 6 s at most; the picture itself is drawn on the roofs later, when its tiles are in,
    // uploaded one a frame (roofs are drawn in their own mean colour meanwhile)
    let img = null, pic = null;
    if (imagery && !allReal && (imagery.rectParts || imagery.rect)) {
      // the near cells at the picture's best, the rest at half (a quarter of the texture memory and upload)
      const zoom = opts.zoom ?? (dist(c) < 320 ? 19 : 18);
      // (1536 px at most: a 2048 px picture took up to a few hundred ms to upload on a busy card; lead: 1024 and 768
      // now, each upload is a stall of the graphics process, and a cell of about 300 m at 1024 px is still 0.3 m a pixel)
      const io = { zoom, maxSize: zoom >= 19 ? 1024 : 768, read: true, picture: !NO_ROOFPIC }; // (picture: round 6, perf P; none on the low tier)
      if (imagery.rectParts) {
        const parts = imagery.rectParts(x0 - pad, z0 - pad, x1 + pad, z1 + pad, io);
        img = { x0: parts.x0, z0: parts.z0, x1: parts.x1, z1: parts.z1, sample: null, lean: null };
        pic = parts.picture;
        const ts = performance.now();
        img.sample = await Promise.race([parts.sample, new Promise(r => setTimeout(() => r(null), opts.sampleTimeout ?? 6000))]);
        T.sample = Math.round(performance.now() - ts); T.got = !!img.sample;
      } else {
        try {
          const r = await Promise.race([imagery.rect(x0 - pad, z0 - pad, x1 + pad, z1 + pad, io), new Promise((_, rej) => setTimeout(() => rej(new Error('imagery timeout')), opts.imageryTimeout ?? 20000))]);
          img = { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, sample: r.sample, lean: null }; pic = Promise.resolve({ texture: r.texture });
        } catch (e) { img = null; }
      }
    }
    k.reset();
    if (disposed) { if (pic) pic.then(r => r && r.texture.dispose()); return; }
    let at = null;
    if (img && img.sample) {
      const tmp = [0, 0, 0];
      at = (x, z) => img.sample(x, z, tmp);
      const lumAt = (x, z) => { const c = img.sample(x, z, tmp); return c ? 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] : NaN; };
      // (round 6b, perf P: not on the low tier, which draws no roof pictures: a hundred or more scoring passes over the
      // picture for each cell of tall buildings, the longest task of a rebuild in Times Square)
      const L = (globalThis.__carQuality && globalThis.__carQuality.low) ? null : await estimateLean(plans, lumAt, k.slice);
      if (L) { img.lean = L.k; stats.lean.push({ cell: [c.cx, c.cz], k: L.k, gain: +L.gain.toFixed(2) }); }
      await k.slice('lean');
      // roofs nobody tagged: pitched or flat, and which way, from the picture over them
      for (const P of plans) {
        if (!P.cand) continue;
        ctx.density = c.density;
        if (roofFromPicture(P, at, ctx)) { stats.pictureRoofs++; P.pitch = pitchOf(P, ctx); finish(P, ctx); }
        await k.slice('roofs');
        if (disposed) { if (pic) pic.then(r => r && r.texture.dispose()); return; }
      }
    }
    const W = new Buf(), R = new RoofBuf();
    for (const P of plans) {
      const tp = performance.now();
      ctx.density = c.density;
      decorate(P, ctx);
      perimGuess(P, ctx);
      // (the city's look may have changed the roof: heights again)
      finish(P, ctx);
      fitOut(P, ctx);
      P.children = wings(P, ctx);
      const mean = at ? roofMean(P, at, img.lean) : null;
      const face = at && img.lean ? facadeMean(P, at, img.lean) : null;
      if (face) stats.faceColours = (stats.faceColours || 0) + 1;
      P.wallColour = wallColour(P, mean, face);
      P.roofCol = roofingColour(P, mean);
      P.fallbackRoof = mean ? new THREE.Color().setRGB(mean[0], mean[1], mean[2], THREE.SRGBColorSpace) : defaultRoof(P, ctx);
      // (the roofs' own colour until the picture is on them: a tagged roof colour, else the picture's mean)
      P.plainRoof = P.roofColour ? P.roofColour.clone().multiplyScalar(0.8) : P.fallbackRoof;
      if (RADIAL.has(P.shape)) { P.rc = [P.cx, P.cz]; let s = 0; for (const p of P.outer) s += Math.hypot(p[0] - P.cx, p[1] - P.cz); P.rR = s / P.outer.length; }
      // Parts often share a facade (a tower flush with its podium, an outline drawn with its own part): two walls in
      // one plane facing the same way flicker against each other. Push every footprint out by its own few centimetres
      // (taller ones further), so no two buildings' walls are ever exactly coplanar.
      const eps = 0.012 + 0.0003 * Math.min(P.H, 400) + 0.014 * P.r4;
      if (!P.offset) { P.outer = offsetRing(P.outer, eps); P.holes = P.holes.map(h => offsetRing(h, eps)); P.offset = true; P.ob = obb(P.outer) || P.ob; P.ax = axesOf(P); }
      const w0 = W.idx.length, r0 = R.idx.length;
      if (P.real) { stats.real = (stats.real || 0) + 1; } // (round 6, agent T: drawn by the open tileset)
      else if (P.children) {
        // the wings stand on the house's own base, with its colours
        let gmin = Infinity; for (const q of P.outer) { const g = ctx.groundAt(q[0], q[1]); gmin = Math.min(gmin, g == null || !isFinite(g) ? ctx.g0 : g); }
        P.baseY = gmin;
        for (const C of P.children) {
          Object.assign(C, { wallColour: P.wallColour, roofCol: P.roofCol, fallbackRoof: P.fallbackRoof, plainRoof: P.plainRoof, baseY: gmin });
          C.outer = offsetRing(C.outer, eps * 0.5); C.ob = obb(C.outer) || C.ob; C.ax = C.ob;
          emit(C, ctx, W, R, img);
        }
        stats.wings = (stats.wings || 0) + 1;
      } else emit(P, ctx, W, R, img);
      if (ctx.tri) { ctx.tri.walls += (W.idx.length - w0) / 3; ctx.tri.roofs += (R.idx.length - r0) / 3; }
      // (tests: window.__bldKeep = true keeps every plan, by id, in window.__bldPlans)
      if (typeof window !== 'undefined' && window.__bldKeep) { const K = window.__bldPlans || (window.__bldPlans = new Map()); K.set(P.b.id, P); }
      // its collision now has its real height (base to the walls' top) and a roof a car can stand on
      try { const sh = shapeOf.get(P.b); if (sh) { const info = roofInfo(P); if (ROOFS.size > 40000) ROOFS.clear(); ROOFS.set(P.b.id, info); applyRoof(sh, info); stats.roofs++; } } catch (e) { /* no roof: the wall stays full height */ }
      if (stats.shapes) stats.shapes[P.shape] = (stats.shapes[P.shape] || 0) + 1; else stats.shapes = { [P.shape]: 1 };
      const dt = performance.now() - tp;
      if (dt > 25) (stats.slowPlans || (stats.slowPlans = [])).push({ id: P.b.id, ms: Math.round(dt), shape: P.shape, n: P.outer.length, holes: P.holes.length, area: Math.round(P.area), t: P.t });
      await k.slice('emit');
      if (disposed) { if (pic) pic.then(r => r && r.texture.dispose()); return; }
    }
    // (round 6, agent T) nothing of ours to draw in this cell (every building in it is the open tileset's)
    if (!W.idx.length && !R.idx.length) {
      const rec = { sig: c.sig, meshes: [], mats: [], textures: [], refs: new Set([handle]), n: plans.length, dead: false };
      built.set(c.sig, rec); recs.push(rec); stats.buildings += plans.length; stats.cells++;
      if (pic) pic.then(r => r && r.texture.dispose());
      return;
    }
    const wg = W.geometry();
    await k.slice('walls geometry');
    const rg = R.geometry();
    const wm = new THREE.Mesh(wg, wallMat);
    wm.castShadow = true; wm.receiveShadow = true; wm.name = 'walls ' + c.key;
    wm.onBeforeRender = () => { FACADE_TIME.value = (performance.now() / 1000) % 3600; };
    const roof = new THREE.Mesh(rg, roofPlain());
    roof.castShadow = true; roof.receiveShadow = false; roof.name = 'roofs ' + c.key;
    const rec = { sig: c.sig, meshes: [wm, roof], mats: [], textures: [], refs: new Set([handle]), n: plans.length, dead: false };
    for (const m of rec.meshes) {
      m.matrixAutoUpdate = false; m.updateMatrix();
      await k.slice('bvh');
      if (m.geometry.computeBoundsTree) { try { m.geometry.computeBoundsTree({ maxLeafTris: 8 }); } catch (e) {} }
      stats.triangles += m.geometry.index.count / 3;
    }
    if (disposed) { freeRec(rec, world); if (pic) pic.then(r => r && r.texture.dispose()); return; }
    built.set(c.sig, rec);
    recs.push(rec);
    stats.buildings += plans.length;
    stats.cells++;
    T.made = Math.round(performance.now() - tStart); T.cpu = Math.round(k.cpu - T.cpu0); T.frames = k.frames - T.fr0; T.dt = Math.round(SCHED.dt); delete T.cpu0; delete T.fr0;
    await warm(rec, k);
    T.warm = Math.round(performance.now() - tStart);
    if (disposed) return;
    // the picture onto the roofs when it is in: uploaded one a frame, never while the camera flies down
    if (pic) pic.then(r => { if (!r) return; if (rec.dead) { r.texture.dispose(); return; } queueUpload(renderer, rec, roof, r.texture); });
    if (progressive) { await showSoon(rec); k.reset(); }
    T.shown = Math.round(performance.now() - tStart);
  }

  const tStart = performance.now();
  let qi = 0;
  const worker = async () => {
    const k = clock();
    await null; // the handle exists before any cell is looked at
    while (qi < order.length && !disposed) {
      const c = order[qi++];
      try { await buildCell(c, k); } catch (e) { console.warn('buildings: cell failed', e); }
      await k.slice('cell');
    }
  };
  const ready = ovtP.then(() => { if (disposed) return; const tm = performance.now(); makeCells(); stats.makeCells = Math.round(performance.now() - tm); return Promise.all([worker(), worker(), worker()]); }).then(async () => {
    if (disposed) return stats;
    // swap: the new set in, the old builds out, in one step (not while the camera flies down)
    if (!progressive) { if (!behindCard()) while (flying()) await nextFrame(); if (disposed) return stats; for (const r of recs) show(r); parent.add(group); }
    for (const h of adopted) h._release();
    done = true;
    stats.ms = Math.round(performance.now() - tStart);
    stats.tri = { walls: Math.round(ctx.tri.walls), roofs: Math.round(ctx.tri.roofs), extra: Math.round(ctx.tri.extra) };
    stats.perims = ctx.perims || 0;
    return stats;
  });

  // drop this build's hold on its cells; free the ones no other build uses
  function release() {
    if (group.parent) group.parent.remove(group);
    for (const r of recs) {
      r.refs.delete(handle);
      if (!r.refs.size) freeRec(r, world);
      else for (const m of r.meshes) if (m.parent === group) group.remove(m);
    }
    recs.length = 0;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (collide && collide.remove) for (const h of handles) { try { collide.remove(h); } catch (e) {} }
    // what is on screen stays until the next build is ready (or none follows straight away)
    let keep;
    if (done) keep = [handle];
    else {
      // never shown: let go of what it built so far, keep what it was going to replace
      for (const r of recs) { r.refs.delete(handle); if (!r.refs.size) freeRec(r, world); }
      recs.length = 0;
      if (group.parent) group.parent.remove(group);
      keep = adopted;
    }
    retiring.push(...keep);
    setTimeout(() => {
      const left = retiring.filter(h => keep.includes(h));
      if (!left.length) return;
      retiring = retiring.filter(h => !keep.includes(h));
      for (const h of left) h._release();
    }, 0);
  }
  const handle = { group, ready, dispose, stats, material: wallMat, _release: release };
  return handle;
}

export const buildings = { build, CELL };
export default buildings;
