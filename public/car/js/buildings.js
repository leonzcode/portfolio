// Buildings for the open world, from OSM building records (osm.js): every footprint extruded to its real height
// (height, else levels, else a guess by type and by how built up the area is), building:part pieces from their
// min_height, roofs flat, gabled, hipped, pyramidal or skillion, the roofs textured with the satellite picture
// right above them (so they show their real colours, AC units and skylights), the walls drawn by facade.js.
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
import { frame, project } from './geo.js?v=17';
import { patchBaked } from './baked.js?v=17';
import { makeFacadeMaterial, STYLE, GROUND, FACADE_TIME } from './facade.js?v=17';

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
  const alias = { lightgrey: 'lightgray', darkgrey: 'darkgray', cream: '#efe6cc', sand: '#d8c39a', brick: '#9a4a36', redbrick: '#9a4a36', stone: '#c8bea8', concrete: '#bdbab3', glass: '#5a6e7c', white: '#f0eee8', black: '#2a2a2a' };
  if (alias[s]) s = alias[s];
  if (s[0] === '#' || THREE.Color.NAMES[s] !== undefined) {
    try { _col.setStyle(s, THREE.SRGBColorSpace); return _col.clone(); } catch (e) { return null; }
  }
  return null;
}

// ---------- what each building is ----------
const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'terrace', 'cabin', 'farm', 'villa', 'static_caravan', 'houseboat', 'hut']);
const SMALL = new Set(['garage', 'garages', 'shed', 'carport', 'kiosk', 'hut', 'toilets', 'roof', 'service', 'transformer_tower', 'bunker', 'container', 'shelter']);
const SHOPS = new Set(['commercial', 'retail', 'mixed_use', 'supermarket', 'kiosk', 'shop', 'store', 'restaurant', 'hotel']);
const OFFICE = new Set(['office', 'bank', 'government']);
const WORKS = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'storage_tank', 'barn', 'farm_auxiliary', 'greenhouse', 'parking', 'garages', 'service']);
const CIVIC = new Set(['church', 'cathedral', 'chapel', 'mosque', 'temple', 'synagogue', 'shrine', 'civic', 'public', 'government', 'museum', 'townhall', 'courthouse', 'train_station', 'transportation']);
const FLATS = new Set(['apartments', 'residential', 'dormitory', 'flats']);

function region() {
  const la = frame.lat, lo = frame.lon;
  if (lo > -170 && lo < -50 && la > 14 && la < 72) return 'us';
  if (lo > -11 && lo < 2 && la > 49 && la < 61) return 'uk';
  if (lo > 129 && lo < 146 && la > 30 && la < 46) return 'jp';
  if (lo > -11 && lo < 40 && la > 35 && la < 71) return 'eu';
  return 'other';
}

// ---------- what a city's buildings look like ----------
// A building with no colour or material tags takes its city's look: the city by distance from its centre, else a
// region by a lat/lon box (the Alps also by height above the sea, per building).
const CITIES = [['paris', 48.8566, 2.3522, 12000], ['london', 51.5074, -0.1278, 16000], ['sf', 37.7749, -122.4194, 9000], ['nyc', 40.7400, -73.9900, 16000]];
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
const hex = (a) => a.map(h => new THREE.Color(h).multiplyScalar(0.62));
const LOOK_PAL = {
  hauss: hex(['#e3d9c3', '#d9ccb0', '#e6dcc8', '#d2c4a6', '#ddd2bb', '#d6cdb9']),
  portland: hex(['#e4dfd2', '#d9d3c3', '#ece8dd', '#d2ccbd']),
  lstock: hex(['#b39672', '#a88b66', '#bfa27c', '#9c8160', '#b09878', '#a99070']),
  lred: hex(['#9a5b45', '#8e4f3c', '#a3634b']),
  sf: hex(['#efe6cf', '#d6e6d6', '#f0e0a8', '#cfdfe9', '#efd5cf', '#f2efe8', '#e3e7d3', '#e9dcc5', '#d8d2e6', '#f3e2b8']),
  nycbrick: hex(['#8e4a36', '#7a4030', '#9b5a44', '#844634', '#a0604a', '#8a5240']),
  brownstone: hex(['#6b4a3a', '#7a5644', '#5f4234', '#735040']),
  nycstone: hex(['#b8b4ac', '#a6a29a', '#c4bfb3', '#9d9a94']),
  jpn: hex(['#e6e4de', '#d8d6d0', '#cfcac0', '#ebe8e0', '#d9cfbd', '#c9c9c6', '#e2ddd2', '#d4d0c4']),
  alpine: hex(['#efece4', '#ebe6d9', '#f2efe7', '#e6e0d0']),
  med: hex(['#f1ece0', '#e8d2a8', '#d9b98a', '#f3e7cf', '#ead9b8', '#e0c49a', '#f4f1ea']),
  render: hex(['#ece5d6', '#e3d8c2', '#e9e2d2', '#d9cdb5', '#efe9dc']),
};
// facade looks (aS.z, plus 10 for a wall with screens, 20 for a wall with a vertical sign)
export const LOOK = { NONE: 0, HAUSS: 1, SASH: 2, JAPAN: 3, ALPINE: 4, SF: 5 };

// the city's look for one building: style, palette, facade look and roof, changed on the plan in place
function applyCity(P, ctx) {
  const b = P.b, city = ctx.city, t = b.type || 'yes';
  if (!city || b.material || b.colour) return;
  const { H, area, r1, r2, r3, houseLike } = P;
  const tall = H > 45, dense = ctx.density > 0.25;
  const flatRoof = () => { if (!b.roofShape) { P.shape = 'flat'; P.eave = P.H; P.roofH = 0; P.overhang = 0; } };
  if ((city === 'paris' || (city === 'france' && dense)) && !houseLike && H > 11 && H < 42) {
    // Haussmann blocks: cream limestone, tall windows, iron balconies, a zinc mansard roof
    P.style = STYLE.STONE; P.palette = LOOK_PAL.hauss; P.look = LOOK.HAUSS;
    if (!b.roofShape && P.holes.length === 0 && area > 60) {
      P.shape = 'mansard'; P.roofH = Math.min(4.2, Math.max(3.2, P.H * 0.17)); P.eave = P.H - P.roofH; P.overhang = 0;
    }
  } else if (city === 'paris' || city === 'france') {
    P.palette = LOOK_PAL.render;
    if (P.style !== STYLE.GLASS) P.style = houseLike ? STYLE.STUCCO : (r1 < 0.5 ? STYLE.STONE : STYLE.STUCCO);
  } else if (city === 'london' || city === 'uk') {
    // the West End and the City are mostly cream Portland stone and stucco fronts over shops, brick behind
    let central = false;
    if (city === 'london' && ctx.londonMid && !houseLike && H > 12) {
      let cx = 0, cz = 0; for (const q of P.outer) { cx += q[0]; cz += q[1]; } cx /= P.outer.length; cz /= P.outer.length;
      central = Math.hypot(cx - ctx.londonMid[0], cz - ctx.londonMid[1]) < 2500 && r2 < 0.7;
    }
    if (!houseLike && (area > 1500 || H > 24 || central) && !tall) { P.style = STYLE.STONE; P.palette = LOOK_PAL.portland; }
    else if (!tall) { P.style = STYLE.BRICK; P.palette = r2 < 0.75 ? LOOK_PAL.lstock : LOOK_PAL.lred; P.look = LOOK.SASH; }
  } else if (city === 'sf') {
    if (!tall && H < 18 && area < 900 && P.style !== STYLE.GLASS) {
      P.style = STYLE.STUCCO; P.palette = LOOK_PAL.sf; P.look = LOOK.SF;
      if (dense) flatRoof();
    }
  } else if (city === 'nyc') {
    if (tall) {
      if (P.style !== STYLE.GLASS) P.style = r1 < 0.6 ? STYLE.GLASS : STYLE.STONE;
      if (P.style === STYLE.STONE) P.palette = LOOK_PAL.nycstone;
    } else if (H < 26 && (FLATS.has(t) || houseLike || t === 'yes') && r2 < 0.35) {
      P.style = STYLE.STONE; P.palette = LOOK_PAL.brownstone; P.look = LOOK.SASH;
    } else { P.style = STYLE.BRICK; P.palette = LOOK_PAL.nycbrick; }
    if (!tall) flatRoof();
  } else if (city === 'japan') {
    if (!tall && P.style !== STYLE.GLASS) { P.style = r1 < 0.55 ? STYLE.CONCRETE : STYLE.BRICK; P.palette = LOOK_PAL.jpn; P.look = LOOK.JAPAN; }
  } else if (city === 'alps') {
    if (P.elev > 700 && (houseLike || (H < 18 && area < 1200))) {
      // chalets: white render below, dark wood above, balconies, wide low roofs
      P.style = STYLE.STUCCO; P.palette = LOOK_PAL.alpine; P.look = LOOK.ALPINE;
      if (!b.roofShape && P.holes.length === 0) {
        P.shape = 'gabled'; P.roofH = Math.min(4.5, P.ob.hw * Math.tan((18 + r3 * 7) * D2R));
        P.eave = Math.max(P.minH + 2.8, P.H - P.roofH); P.H = P.eave + P.roofH; P.overhang = 1.0 + r1 * 0.5;
      }
    } else P.palette = LOOK_PAL.render;
  } else if (city === 'med') {
    if (P.style !== STYLE.GLASS) { P.style = STYLE.STUCCO; P.palette = LOOK_PAL.med; }
  }
}

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
  if (/concrete|cement|reinforced/.test(m)) return STYLE.CONCRETE;
  if (/plaster|stucco|render/.test(m)) return STYLE.STUCCO;
  if (/wood|timber|vinyl|siding/.test(m)) return STYLE.WOOD;
  if (/metal|steel|alumin|tin/.test(m)) return STYLE.METAL;
  if (/stone|granite|marble|sandstone|limestone/.test(m)) return STYLE.STONE;
  return null;
}

function pickStyle(b, H, area, ctx, r) {
  const t = b.type, reg = ctx.region;
  const ms = materialStyle(b.material);
  if (ms !== null) return ms;
  if (b.houseLike || HOUSE.has(t) || (t === 'residential' && area < 260)) {
    if (reg === 'uk') return r < 0.75 ? STYLE.BRICK : STYLE.STUCCO;
    if (reg === 'us') return r < 0.55 ? STYLE.STUCCO : STYLE.WOOD;
    if (reg === 'jp') return r < 0.7 ? STYLE.STUCCO : STYLE.WOOD;
    return r < 0.5 ? STYLE.STUCCO : STYLE.BRICK;
  }
  if (WORKS.has(t) || SMALL.has(t)) return t === 'garage' || t === 'garages' || t === 'shed' ? (reg === 'uk' ? STYLE.BRICK : STYLE.STUCCO) : STYLE.METAL;
  if (CIVIC.has(t)) return r < 0.7 ? STYLE.STONE : STYLE.BRICK;
  if (H > 48) return r < 0.6 ? STYLE.GLASS : (r < 0.85 ? STYLE.CONCRETE : STYLE.STONE);
  if (OFFICE.has(t)) return H > 25 && r < 0.45 ? STYLE.GLASS : STYLE.CONCRETE;
  if (FLATS.has(t)) {
    if (reg === 'uk') return r < 0.65 ? STYLE.BRICK : (r < 0.85 ? STYLE.STUCCO : STYLE.CONCRETE);
    if (reg === 'jp') return r < 0.6 ? STYLE.CONCRETE : STYLE.STUCCO;
    if (reg === 'us') return r < 0.5 ? STYLE.STUCCO : (r < 0.8 ? STYLE.BRICK : STYLE.WOOD);
    return r < 0.5 ? STYLE.STUCCO : STYLE.CONCRETE;
  }
  if (reg === 'uk') return r < 0.5 ? STYLE.BRICK : (r < 0.75 ? STYLE.STUCCO : STYLE.STONE);
  if (reg === 'jp') return r < 0.55 ? STYLE.CONCRETE : (r < 0.85 ? STYLE.STUCCO : STYLE.GLASS);
  if (reg === 'us') return H > 14 ? (r < 0.45 ? STYLE.CONCRETE : r < 0.75 ? STYLE.BRICK : STYLE.STONE) : (r < 0.45 ? STYLE.STUCCO : r < 0.75 ? STYLE.CONCRETE : STYLE.BRICK);
  return r < 0.4 ? STYLE.CONCRETE : (r < 0.7 ? STYLE.STUCCO : STYLE.BRICK);
}

function pickGround(b, style, H, ctx, r) {
  const t = b.type;
  if (b.minH > 0.5) return GROUND.NONE;
  if (HOUSE.has(t)) return GROUND.DOOR;
  if (SHOPS.has(t)) return GROUND.SHOP;
  if (WORKS.has(t)) return GROUND.ROLLUP;
  if (OFFICE.has(t) || style === STYLE.GLASS) return GROUND.LOBBY;
  if (CIVIC.has(t)) return GROUND.DOOR;
  // a built up centre: most street fronts are shops
  if (ctx.density > 0.35 && H > 7) return r < 0.7 ? GROUND.SHOP : GROUND.LOBBY;
  if (FLATS.has(t)) return r < 0.3 && ctx.density > 0.2 ? GROUND.SHOP : GROUND.DOOR;
  return r < 0.4 ? GROUND.DOOR : GROUND.NONE;
}

const SHAPE_OK = (t) => !/^(garages|industrial|warehouse|commercial|retail|office|school|church|hospital)$/.test(t);
const ROOF_ALIAS = { gabled: 'gabled', gambrel: 'gabled', saltbox: 'gabled', round: 'gabled', 'half-hipped': 'hipped', hipped: 'hipped', mansard: 'hipped', side_hipped: 'hipped', pyramidal: 'pyramidal', dome: 'pyramidal', onion: 'pyramidal', cone: 'pyramidal', skillion: 'skillion', lean_to: 'skillion' };

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
  const r1 = hashf(id, 1), r2 = hashf(id, 2), r3 = hashf(id, 3), r4 = hashf(id, 4);
  const t = b.type || 'yes';
  const ob = obb(outer);
  if (!ob) return null;

  // roof shape: tagged, else pitched for houses and small low buildings away from dense centres (vector-tile
  // records come as type 'yes' with a height only): gabled along the long axis for rectangles, hipped otherwise
  let shape = b.roofShape ? (ROOF_ALIAS[b.roofShape] || 'flat') : null;
  const rect = area / ob.area > 0.86;
  const smallLow = area > 30 && area < 400 && (b.height == null || b.height < 10) && !(b.levels > 3);
  const houseLike = HOUSE.has(t) || (smallLow && ctx.density < 0.4 && /^(yes|residential|garage|shed|semidetached_house|detached|house|bungalow|cabin)$/.test(t));
  if (!shape) {
    if (houseLike && area < 600 && area / ob.area > 0.55 && SHAPE_OK(t)) shape = rect ? (r2 < 0.75 ? 'gabled' : 'hipped') : 'hipped';
    else shape = 'flat';
  }
  if (holes.length && shape !== 'flat') shape = 'flat';

  let minH = b.minHeight || (b.minLevel ? b.minLevel * LV : 0);
  let roofH = b.roofHeight ?? (b.roofLevels ? b.roofLevels * LV : null);
  const pitch = houseLike ? 25 + r3 * 10 : (ctx.region === 'us' ? 24 : 34) + (r3 - 0.5) * 10;
  if (roofH == null && shape !== 'flat') {
    if (shape === 'skillion') roofH = Math.min(3, ob.hw * 2 * Math.tan(12 * D2R));
    else roofH = Math.min(houseLike ? 5 : 7, ob.hw * Math.tan(pitch * D2R));
  }
  if (shape === 'flat') roofH = 0;

  let H = b.height;
  let levels = b.levels;
  // the vector tiles give 5 m to every building they know no height for: for anything but a house that is no
  // height at all (half of a Paris block came out one storey tall), so guess it from the type and the area
  if (H === 5 && !houseLike && levels == null && !(b.tags && (b.tags.height || b.tags['building:levels']))) H = null;
  // a house whose only height is a vector tile's default (5 m) or a low guess: take it as the walls' height and
  // put the roof on top, one storey or two
  if (houseLike && shape !== 'flat' && H != null && levels == null && b.roofHeight == null && H <= 7.5) {
    const eaveH = Math.abs(H - 5) < 0.01 ? (r4 < 0.7 ? 3.1 : 5.6) : Math.max(2.8, H - 0.4);
    H = eaveH + roofH;
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
    else if (CIVIC.has(t)) d = t === 'church' || t === 'cathedral' ? 16 : 11;
    else if (t === 'school' || t === 'university' || t === 'college' || t === 'hospital') d = 11;
    else d = houseLike ? 6.5 : 8;
    // no height and no levels in a dense centre: real buildings there are taller than the type suggests
    if (ctx.density > 0.4 && !HOUSE.has(t) && !SMALL.has(t) && area > 60) d = Math.max(d, 11 + ctx.density * 12 + r4 * 6);
    else if (ctx.density > 0.25 && !HOUSE.has(t) && !SMALL.has(t) && area > 60) d = Math.max(d, 9 + r4 * 4);
    H = d;
  }
  // a roof on posts with no height of its own (toll plaza, petrol station canopy, carport): a slab the car fits under
  if (b.roofOnly && !(minH > 0.5)) { H = t === 'carport' ? 2.9 : Math.max(5.5, Math.min(H || 0, 9)); minH = H - (t === 'carport' ? 0.35 : 0.9); levels = 1; }
  if (H <= minH + 0.5) H = minH + Math.max(2.5, (levels || 1) * LV);
  if (roofH > (H - minH) * 0.6) roofH = (H - minH) * 0.6;
  const eave = H - roofH;
  if (!levels) levels = Math.max(1, Math.round((eave - 0.5) / (houseLike ? 2.8 : 3.4)));
  let fh = (eave - (b.minLevel ? b.minLevel * LV : 0) - 0.4) / Math.max(1, levels - (b.minLevel || 0));
  if (!(fh > 2.5 && fh < 6)) fh = houseLike ? 2.9 : 3.4;
  let style = pickStyle({ ...b, houseLike }, H, area, ctx, r1);
  const ground = houseLike && !(b.minHeight > 0.5) ? GROUND.HOUSE : pickGround({ ...b, minH }, style, H, ctx, r2);
  let gh = ground === GROUND.SHOP ? Math.max(fh, 4.4) : ground === GROUND.LOBBY ? Math.max(fh, 5.0) : ground === GROUND.ROLLUP ? Math.max(fh, 5.2) : fh;
  if (gh > eave - 0.5) gh = Math.max(2.5, eave - 0.5);
  if (style === STYLE.GLASS && H < 12) style = STYLE.CONCRETE;
  // sheds and warehouses are low: anything tall with a works or service tag is an office block in disguise
  if (style === STYLE.METAL && H > 18 && !materialStyle(b.material)) style = H > 48 && r1 < 0.5 ? STYLE.GLASS : STYLE.CONCRETE;
  const colour = parseColour(b.colour);
  const roofColour = parseColour(b.roofColour);
  // Parts often share a facade (a tower flush with its podium, an outline drawn with its own part): two walls in
  // one plane facing the same way flicker against each other. Push every footprint out by its own few centimetres
  // (taller ones further), so no two buildings' walls are ever exactly coplanar.
  const eps = 0.012 + 0.0003 * Math.min(H, 400) + 0.014 * r4;
  const outer0 = outer;
  outer = offsetRing(outer, eps);
  holes = holes.map(h => offsetRing(h, eps));
  // houses: a slight overhang, a garage when there is room for one (not in British terraces)
  const overhang = houseLike && shape !== 'flat' ? 0.35 + 0.2 * r1 : 0;
  const garage = houseLike && area > 110 && ctx.region !== 'uk' && ctx.region !== 'jp' && t !== 'terrace' && r3 < 0.8 && ctx.city !== 'sf';
  const g0 = ctx.groundAt(outer[0][0], outer[0][1]);
  const P = { b, id, outer, outer0, holes, area, ob, shape, minH, roofH, H, eave, fh, gh, style, ground, colour, roofColour, r1, r2, r3, r4, levels, houseLike, overhang, garage, look: 0, palette: null, elev: g0 == null ? 0 : g0 + (frame.h || 0) };
  applyCity(P, ctx);
  // in a dense commercial core, the fronts facing the street carry lit screens
  if (ctx.cores.length && P.H > 10 && !houseLike) {
    let cx = 0, cz = 0; for (const p of outer) { cx += p[0]; cz += p[1]; } cx /= outer.length; cz /= outer.length;
    for (const c of ctx.cores) if (Math.hypot(cx - c[0], cz - c[1]) < c[2]) { P.core = c[3] ?? 0.6; P.coreFull = !!c[4]; break; }
  }
  return P;
}

// the roof's height over the eave: roofH * (1 - max_i t_i(p)), each t_i linear in p (x, z)
function roofTerms(P) {
  const { ob, shape } = P;
  const { cx, cz, A, Pp = ob.P, hl, hw } = { ...ob, Pp: ob.P };
  const lin = (gx, gz, k, s) => ({ g: [gx / s, gz / s], c: (-(gx * cx + gz * cz) - k) / s });
  if (shape === 'gabled') return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw)];
  if (shape === 'hipped' || shape === 'mansard') { const k = Math.max(0, hl - hw); return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw), lin(A[0], A[1], k, hw), lin(-A[0], -A[1], k, hw)]; }
  if (shape === 'pyramidal') return [lin(Pp[0], Pp[1], 0, hw), lin(-Pp[0], -Pp[1], 0, hw), lin(A[0], A[1], 0, hl), lin(-A[0], -A[1], 0, hl)];
  if (shape === 'skillion') { const s = P.r3 < 0.5 ? 1 : -1; const t = lin(s * Pp[0], s * Pp[1], -hw, 2 * hw); return [t]; }
  return null;
}
const termAt = (t, x, z) => t.g[0] * x + t.g[1] * z + t.c;
// a mansard's steep band is about 1.7 m deep: past it the roof is flat
const mansardK = (P) => Math.max(1, P.ob.hw / 1.7);
function roofAt(P, terms, x, z, below = false) {
  if (!terms) return 0;
  if (P.shape === 'mansard') { let m = -Infinity; for (const t of terms) { const v = termAt(t, x, z); if (v > m) m = v; } return P.roofH * Math.max(0, Math.min(1, (1 - m) * mansardK(P))); }
  if (below) { let m = -Infinity; for (const t of terms) { const v = termAt(t, x, z); if (v > m) m = v; } return P.roofH * Math.min(1, 1 - m); }
  let m = -Infinity;
  for (const t of terms) { const v = termAt(t, x, z); if (v > m) m = v; }
  return P.roofH * Math.max(0, Math.min(1, 1 - m));
}

// ---------- geometry buffers ----------
class Buf {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.w = []; this.bb = []; this.s = []; this.idx = []; this.n = 0; }
  v(x, y, z, nx, ny, nz, c, u, L, eave, gy, base, fh, gh, seed, style, ground, look = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(c.r, c.g, c.b);
    this.w.push(u, L, eave, gy); this.bb.push(base, fh, gh, seed); this.s.push(style, ground, look);
    return this.n++;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(this.w, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.bb, 4));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 3));
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
  const rc = img ? WHITE : (P.roofColour || P.fallbackRoof);

  // the front: the outer edge that faces the nearest road (else the longest)
  if ((ground === GROUND.HOUSE || P.look === LOOK.SF || P.look === LOOK.JAPAN) && P.front === undefined) {
    let cx = 0, cz = 0; for (const p of outer) { cx += p[0]; cz += p[1]; } cx /= outer.length; cz /= outer.length;
    let rp = null; try { rp = ctx.nearRoad ? ctx.nearRoad(cx, cz) : null; } catch (e) { rp = null; }
    let best = -Infinity; P.front = 0;
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i], q = outer[(i + 1) % outer.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < 2.5) continue;
      const nx = -dz / len, nz = dx / len;
      let sc = Math.min(len, 14) * 0.05;
      if (rp) { const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, rx = rp.x - mx, rz = rp.z - mz, rl = Math.hypot(rx, rz) || 1; sc += (nx * rx + nz * rz) / rl * 2 - rl * 0.01; }
      if (sc > best) { best = sc; P.front = i; }
    }
  }
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
      ss.sort((x, y) => x - y); ss.push(1);
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
      // a house's front wall (towards the road) gets the door and the garage; its other walls plain windows
      const gk = ground === GROUND.HOUSE && e.ring === outer && e.i === P.front ? (P.garage ? GROUND.HOUSE_GARAGE : GROUND.HOUSE_FRONT) : ground;
      let lk = P.look || 0, screen = false;
      if (e.ring === outer && P.core && e.len >= 8) {
        // a core's street fronts: screens on any wall with a road just in front of it
        let rp = null; const mx = e.p[0] + e.dx / 2 + nx * 6, mz = e.p[1] + e.dz / 2 + nz * 6;
        try { rp = ctx.nearRoad ? ctx.nearRoad(mx, mz) : null; } catch (err) { rp = null; }
        if (rp && rp.dist < 22 && hashf(P.id, 300 + e.i) < P.core) { lk += P.coreFull ? 20 : 10; screen = true; }
      }
      if (!screen && e.ring === outer && P.look === LOOK.JAPAN && e.i === P.front && P.H > 9 && P.H < 50 && e.len > 3.5 && P.r2 < 0.75 && !P.signed) {
        // a vertical sign standing out from the front, near one end: two faces, read from up and down the street
        P.signed = true;
        const sh = Math.min(P.eave - 1.0 - P.gh - 0.4, 14);
        if (sh > 2.5) {
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
      for (let j = 0; j + 1 < e.ss.length; j++) {
        const sa = e.ss[j], sb = e.ss[j + 1];
        // the ends are the ring's own vertices, bit for bit, so neighbouring walls share their corner exactly
        const ax = sa === 0 ? e.p[0] : e.p[0] + e.dx * sa, az = sa === 0 ? e.p[1] : e.p[1] + e.dz * sa;
        const bx = sb === 1 ? e.q[0] : e.p[0] + e.dx * sb, bz = sb === 1 ? e.q[1] : e.p[1] + e.dz * sb;
        const ta = yEave + roofAt(P, terms, ax, az), tb = yEave + roofAt(P, terms, bx, bz);
        const ga = ground0(ax, az), gb = ground0(bx, bz);
        const ua = uStart[k] + e.len * sa, ub = uStart[k] + e.len * sb;
        const eh = eave;
        const i0 = W.v(ax, yBot, az, nx, 0, nz, wc, ua, L, eh, ga, base, fh, gh, seed, style, gk, lk);
        const i1 = W.v(bx, yBot, bz, nx, 0, nz, wc, ub, L, eh, gb, base, fh, gh, seed, style, gk, lk);
        const i2 = W.v(bx, tb, bz, nx, 0, nz, wc, ub, L, eh, gb, base, fh, gh, seed, style, gk, lk);
        const i3 = W.v(ax, ta, az, nx, 0, nz, wc, ua, L, eh, ga, base, fh, gh, seed, style, gk, lk);
        W.idx.push(i0, i1, i2, i0, i2, i3);
      }
    }
  }

  // San Francisco: bay windows on the front, from the first floor up to under the cornice
  if (P.look === LOOK.SF && P.front !== undefined && P.levels >= 2 && P.eave - P.gh > 2.5) {
    const p = outer[P.front], q = outer[(P.front + 1) % outer.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len >= 5.5) {
      const ex = dx / len, ez = dz / len, nx = -ez, nz = ex;
      const fw = 1.9, d = 0.75, half = fw / 2 + d;
      const centres = len >= 11 ? [len * 0.27, len * 0.73] : [P.r2 < 0.5 ? len * 0.3 : len * 0.7];
      const y0 = base + P.gh, y1 = yEave - 0.35;
      for (const sc of centres) {
        if (sc - half < 0.3 || sc + half > len - 0.3) continue;
        const cx = p[0] + ex * sc, cz = p[1] + ez * sc;
        const a0 = [cx - ex * half, cz - ez * half], a1 = [cx - ex * fw / 2 + nx * d, cz - ez * fw / 2 + nz * d];
        const a2 = [cx + ex * fw / 2 + nx * d, cz + ez * fw / 2 + nz * d], a3 = [cx + ex * half, cz + ez * half];
        const gy = ground0(cx, cz);
        for (const [a, b] of [[a0, a1], [a1, a2], [a2, a3]]) {
          const fdx = b[0] - a[0], fdz = b[1] - a[1], fl = Math.hypot(fdx, fdz), fnx = -fdz / fl, fnz = fdx / fl;
          const i0 = W.v(a[0], y0, a[1], fnx, 0, fnz, wc, 0, fl, eave, gy, base, fh, gh, seed, style, 0, LOOK.SF);
          const i1 = W.v(b[0], y0, b[1], fnx, 0, fnz, wc, fl, fl, eave, gy, base, fh, gh, seed, style, 0, LOOK.SF);
          const i2 = W.v(b[0], y1, b[1], fnx, 0, fnz, wc, fl, fl, eave, gy, base, fh, gh, seed, style, 0, LOOK.SF);
          const i3 = W.v(a[0], y1, a[1], fnx, 0, fnz, wc, 0, fl, eave, gy, base, fh, gh, seed, style, 0, LOOK.SF);
          W.idx.push(i0, i1, i2, i0, i2, i3);
        }
        // its top and its underside
        for (const [y, ny] of [[y1, 1], [y0, -1]]) {
          const ids = [a0, a1, a2, a3].map(a => W.v(a[0], y, a[1], 0, ny, 0, wc, 0, 0, 0, -1e4, base, fh, gh, seed, STYLE.SOFFIT, 0));
          // the quad a0 a1 a2 a3 goes along the wall and out: wind it to face up or down
          if (ny > 0) W.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); else W.idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
        }
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
  if (!terms) pushTris(outer, holes, () => base + H);
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
}
const WHITE = new THREE.Color(1, 1, 1);

function defaultRoof(P, ctx) {
  if (P.shape === 'flat') return new THREE.Color(0.32, 0.32, 0.31);
  const la = frame.lat, lo = frame.lon;
  const tiles = (la < 44 && la > 30 && lo > -10 && lo < 30) || (lo < -30 && lo > -120 && la < 30);
  if (tiles) return new THREE.Color().setRGB(0.55 + P.r2 * 0.1, 0.27, 0.18, THREE.SRGBColorSpace);
  return P.r2 < 0.6 ? new THREE.Color().setRGB(0.28, 0.28, 0.29, THREE.SRGBColorSpace) : new THREE.Color().setRGB(0.36, 0.3, 0.25, THREE.SRGBColorSpace);
}

// ---------- imagery: lean of tall buildings, roof colours ----------
function sampler(img) {
  const { data, w, h, x0, z0, x1, z1 } = img;
  const sx = w / (x1 - x0), sz = h / (z1 - z0);
  return (x, z) => {
    const i = Math.floor((x - x0) * sx), j = Math.floor((z - z0) * sz);
    if (i < 0 || j < 0 || i >= w || j >= h) return null;
    const k = (j * w + i) * 4;
    return [data[k], data[k + 1], data[k + 2]];
  };
}
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
  const tryK = (kx, kz) => { const s = score(kx, kz); if (s > bs) { bs = s; best = [kx, kz]; } };
  const hint = LEAN_HINT && LEAN_HINT.lat === frame.lat && LEAN_HINT.lon === frame.lon ? LEAN_HINT.k : null;
  if (hint) {
    for (let a = -3; a <= 3; a++) { for (let b = -3; b <= 3; b++) tryK(hint[0] + a * 0.02, hint[1] + b * 0.02); await slice('lean'); }
  } else {
    for (let kx = -0.6; kx <= 0.6001; kx += 0.1) { for (let kz = -0.6; kz <= 0.6001; kz += 0.1) tryK(kx, kz); await slice('lean'); }
    for (const st of [0.03, 0.01]) {
      const [bx, bz] = best;
      for (let a = -2; a <= 2; a++) { for (let b = -2; b <= 2; b++) tryK(bx + a * st, bz + b * st); await slice('lean'); }
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

function wallColour(P, mean, face) {
  if (face && !P.colour) {
    // the picture's colour (in light and shade as the satellite saw it), kept within what walls are
    const c = new THREE.Color().setRGB(face[0], face[1], face[2], THREE.SRGBColorSpace);
    const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // (a house's walls are small in the picture and mostly come out as its eaves and their shade: lighter, and
    // more of the palette's paint and siding)
    const house = P.houseLike, k = Math.min(house ? 2.4 : 1.6, Math.max(0.7, (house ? 0.42 : 0.3) / Math.max(0.02, l)));
    c.multiplyScalar(k * 0.85);
    const pal = P.palette || PAL_LIN[P.style] || PAL_LIN[STYLE.CONCRETE];
    return c.lerp(pal[Math.floor(P.r3 * pal.length) % pal.length], P.palette ? 0.55 : house ? 0.6 : 0.25);
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

// ---------- the public builder ----------
// Cells built by any live build, by signature (cell and the ids in it): a rebuild reuses them as they are.
const built = new Map();     // sig -> { sig, meshes, mats, textures, refs: Set, n }
let retiring = [];           // handles disposed while a newer build may still be on its way
let WALL_MAT = null;
const wallMaterial = () => WALL_MAT || (WALL_MAT = makeFacadeMaterial());

function freeRec(rec, world) {
  for (const m of rec.meshes) {
    if (m.parent) m.parent.remove(m);
    if (m.geometry.disposeBoundsTree && m.geometry.boundsTree) m.geometry.disposeBoundsTree();
    m.geometry.dispose();
    if (world && world.extra) { const i = world.extra.indexOf(m); if (i >= 0) world.extra.splice(i, 1); }
  }
  for (const m of rec.mats) m.dispose();
  for (const t of rec.textures) t.dispose();
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
  const base = P.baseY, terms = roofTerms(P), eave = base + P.eave, top = base + P.H;
  const under = P.minH > 0.3 ? base + P.minH : null;
  const at = terms && P.shape !== 'flat' && P.roofH > 0.05 ? (x, z) => eave + roofAt(P, terms, x, z) : null;
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
  const wallMat = opts.wallMaterial || wallMaterial();
  const ctx = { groundAt, region: region(), density: 0, g0: groundAt(0, 0) ?? 0, nearRoad: null, city: cityOf(frame.lat, frame.lon), cores: [] };
  if (ctx.city === 'london') ctx.londonMid = project(51.5125, -0.1330);
  for (const [la, lo, r, share, full] of CORES) { const [x, z] = project(la, lo); if (Math.hypot(x, z) < 6000) ctx.cores.push([x, z, r, share, full]); }
  // where the nearest road is (a house's front faces it): roads.js when given, else OSM road lines
  const RD = opts.roads;
  if (RD && !Array.isArray(RD) && typeof RD.nearestEdge === 'function') ctx.nearRoad = (x, z) => RD.nearestEdge(x, z, 80);
  else if (Array.isArray(RD) || Array.isArray(opts.roadList)) ctx.nearRoad = roadIndex(Array.isArray(RD) ? RD : opts.roadList);
  const recs = [], handles = [], shapeOf = new Map(); // shapeOf: building record -> its collision polygon
  let disposed = false, done = false;
  const stats = { buildings: 0, cells: 0, reused: 0, triangles: 0, lean: [], ms: 0 };
  // older builds stay on screen until this one is ready, then go in one step
  const adopted = retiring; retiring = [];
  const progressive = !adopted.some(h => h.group.parent && h.group.children.length);
  if (progressive) parent.add(group);

  // cells by centroid
  const cells = new Map();
  for (const b of list || []) {
    if (!b || !b.outer || b.outer.length < 3) continue;
    let x = 0, z = 0; for (const p of b.outer) { x += p[0]; z += p[1]; } x /= b.outer.length; z /= b.outer.length;
    const k = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    if (!cells.has(k)) cells.set(k, { key: k, cx: Math.floor(x / CELL), cz: Math.floor(z / CELL), list: [] });
    cells.get(k).list.push(b);
  }
  for (const c of cells.values()) {
    let a = 0; for (const b of c.list) a += Math.abs(area2(b.outer));
    c.density = Math.min(1, a / (CELL * CELL));
    c.sig = c.key + ':' + c.list.map(b => b.id).sort().join(',');
  }

  // collision now (cheap, no heights needed): every footprint the car can reach
  if (collide && collide.addPolygon) {
    for (const c of cells.values()) for (const b of c.list) {
      if (b.open) continue;
      // (until its heights are known (the cell's plan, below) a building blocks at any height; one that starts up in
      // the air (an overhang, a part on another) blocks nothing until then)
      const high = (b.minHeight || 0) > 3 || (b.minLevel || 0) > 1;
      try { const h = collide.addPolygon(b.outer.map(p => [p[0], p[1]]), high ? 1e4 : -1e4, 1e4, 'building'); if (h != null) { handles.push(h); shapeOf.set(b, h); } } catch (e) { /* collide not ready */ }
    }
  }

  const cam = (world && world.camera) || null;
  const focus = opts.focus || (cam ? [cam.position.x, cam.position.z] : [0, 0]);
  const dist = (c) => Math.hypot((c.cx + 0.5) * CELL - focus[0], (c.cz + 0.5) * CELL - focus[1]);
  const order = [...cells.values()].sort((a, b) => dist(a) - dist(b));

  // a slice of work at a time, so the frame loop keeps running
  let t0 = performance.now();
  const slice = async (where) => { const d = performance.now() - t0; if (d > 8) { if (d > 40) (stats.slow || (stats.slow = [])).push((where || '?') + ':' + Math.round(d)); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } };

  // build the shaders off the main thread (KHR_parallel_shader_compile) and upload the roof pictures one at a
  // time, before anything is shown: the facade program alone took seconds to build on the first frame
  const renderer = opts.renderer || (world && world.renderer);
  const warmed = new WeakSet();
  const warm = async (rec) => {
    if (!renderer || !cam) return;
    for (const m of rec.meshes) {
      if (warmed.has(m.material)) continue;
      warmed.add(m.material);
      const tc = performance.now();
      if (renderer.compileAsync) { try { await renderer.compileAsync(m, cam, parent); } catch (e) {} }
      (stats.compile || (stats.compile = [])).push(Math.round(performance.now() - tc));
      t0 = performance.now();
    }
    for (const t of rec.textures) {
      const tu = performance.now();
      if (renderer.initTexture) { try { renderer.initTexture(t); } catch (e) {} }
      stats.upload = Math.max(stats.upload || 0, Math.round(performance.now() - tu));
      await slice('upload');
    }
  };
  const show = (rec) => {
    for (const m of rec.meshes) {
      group.add(m);
      if (world && world.extra && !world.extra.includes(m)) world.extra.push(m);
    }
  };

  async function buildCell(c) {
    const old = built.get(c.sig);
    if (old) { old.refs.add(handle); recs.push(old); stats.reused++; stats.buildings += old.n; if (progressive) show(old); for (const b of c.list) { const sh = shapeOf.get(b), info = ROOFS.get(b.id); if (sh && info) applyRoof(sh, info); } return; }
    ctx.density = c.density;
    const plans = [];
    for (const b of c.list) { const P = plan(b, ctx); if (P) plans.push(P); await slice('L625'); if (disposed) return; }
    if (!plans.length) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, hmax = 0;
    for (const P of plans) { for (const p of P.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } hmax = Math.max(hmax, P.H); }
    const pad = 2 + Math.min(70, hmax * 0.3);
    let img = null;
    if (imagery && imagery.rect) {
      // the near cells at the picture's best, the rest at half (a quarter of the texture memory and upload)
      const zoom = opts.zoom ?? (dist(c) < 320 ? 19 : 18);
      try {
        img = await Promise.race([
          imagery.rect(x0 - pad, z0 - pad, x1 + pad, z1 + pad, { zoom, maxSize: zoom >= 19 ? 2048 : 1024, read: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('imagery timeout')), opts.imageryTimeout ?? 20000)),
        ]);
      } catch (e) { img = null; }
    }
    t0 = performance.now();
    if (disposed) { if (img) img.texture.dispose(); return; }
    let at = null;
    if (img && img.sample) {
      const tmp = [0, 0, 0];
      at = (x, z) => img.sample(x, z, tmp);
      const lumAt = (x, z) => { const c = img.sample(x, z, tmp); return c ? 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] : NaN; };
      const L = await estimateLean(plans, lumAt, slice);
      if (L) { img.lean = L.k; stats.lean.push({ cell: [c.cx, c.cz], k: L.k, gain: +L.gain.toFixed(2) }); }
      await slice('L647');
    }
    const W = new Buf(), R = new RoofBuf();
    for (const P of plans) {
      const mean = at ? roofMean(P, at, img.lean) : null;
      const face = at && img.lean ? facadeMean(P, at, img.lean) : null;
      if (face) stats.faceColours = (stats.faceColours || 0) + 1;
      P.wallColour = wallColour(P, mean, face);
      P.fallbackRoof = mean ? new THREE.Color().setRGB(mean[0], mean[1], mean[2], THREE.SRGBColorSpace) : defaultRoof(P, ctx);
      emit(P, ctx, W, R, img);
      // its collision now has its real height (base to the walls' top) and a roof a car can stand on
      try { const sh = shapeOf.get(P.b); if (sh) { const info = roofInfo(P); if (ROOFS.size > 40000) ROOFS.clear(); ROOFS.set(P.b.id, info); applyRoof(sh, info); stats.roofs = (stats.roofs || 0) + 1; } } catch (e) { /* no roof: the wall stays full height */ }
      await slice('L655');
      if (disposed) { if (img) img.texture.dispose(); return; }
    }
    const wg = W.geometry(), rg = R.geometry();
    const wm = new THREE.Mesh(wg, wallMat);
    wm.castShadow = true; wm.receiveShadow = true; wm.name = 'walls ' + c.key;
    wm.onBeforeRender = () => { FACADE_TIME.value = (performance.now() / 1000) % 3600; };
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, map: img ? img.texture : null, side: THREE.DoubleSide });
    patchBaked(rm);
    rm.shadowSide = THREE.DoubleSide;
    const roof = new THREE.Mesh(rg, rm);
    roof.castShadow = true; roof.receiveShadow = false; roof.name = 'roofs ' + c.key;
    const rec = { sig: c.sig, meshes: [wm, roof], mats: [rm], textures: img ? [img.texture] : [], refs: new Set([handle]), n: plans.length };
    for (const m of rec.meshes) {
      m.matrixAutoUpdate = false; m.updateMatrix();
      await slice('L670');
      if (m.geometry.computeBoundsTree) { try { m.geometry.computeBoundsTree({ maxLeafTris: 8 }); } catch (e) {} }
      stats.triangles += m.geometry.index.count / 3;
    }
    if (disposed) { freeRec(rec, world); return; }
    built.set(c.sig, rec);
    recs.push(rec);
    stats.buildings += plans.length;
    stats.cells++;
    await warm(rec);
    if (disposed) return;
    if (progressive) show(rec);
  }

  const tStart = performance.now();
  let qi = 0;
  const worker = async () => {
    await null; // the handle exists before any cell is looked at
    while (qi < order.length && !disposed) {
      const c = order[qi++];
      try { await buildCell(c); } catch (e) { console.warn('buildings: cell failed', e); }
      await slice('L689');
    }
  };
  const ready = Promise.all([worker(), worker(), worker()]).then(() => {
    if (disposed) return stats;
    // swap: the new set in, the old builds out, in one step
    if (!progressive) { for (const r of recs) show(r); parent.add(group); }
    for (const h of adopted) h._release();
    done = true;
    stats.ms = Math.round(performance.now() - tStart);
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
