/* Buttermilk 2024 (X, round 12): what stands round the course. The map's own module for main.js (makeXgMap): the
   ground and course from m_xg.js, then its trees, the Summit Express chairlift on its real line (lift.js through
   wlift.js's turned frames), and dress(): the far mountains from the real elevation (the Elk Mountains, Aspen
   Mountain, the Roaring Fork valley), the base area's buildings, the highway and the airport's runway from
   OpenStreetMap (ODbL), and the venue as the photos show it: blue netting on blue poles along the course, black fabric
   round the outruns, black banners with plain words (no event, sponsor or brand marks), black lattice light towers
   along the pipe and the jump line, scaffold camera towers, the start tent and gate, the finish corral with its black
   railings, the dark arched lounge at the base, the big screen, a viewing deck, snowcats, blue pennants on the
   knuckles. Everything static is merged into a few meshes by material. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeXg, courseX, MAP_NAME, MAP_SUB, MAP_ID } from './m_xg.js?v=28';
import { height, ground } from './terrain.js?v=28';
import { planLift, liftHeights } from './lift.js?v=28';
import { WorldLifts } from './wlift.js?v=28';
import { snowUniforms, setRockSource } from './materials.js?v=28';
import { setSunPath } from './env.js?v=28';
import { fbm, simplex, smoothstep, clamp } from './noise.js?v=28';

export { MAP_NAME, MAP_SUB, MAP_ID };
const DATA = new URL('../data/' + MAP_ID + '/', import.meta.url);

// ---- the chairlift: the Summit Express, its real line from OpenStreetMap (bottom station 39.20540 N 106.86020 W, top
// 39.18261 N 106.87554 W), in a frame of its own as wlift.js plans a real lift
const ST_FRONT = 13.29;
const _Y = new THREE.Vector3(0, 1, 0);
class Frame2 {
  constructor(ox, oz, th) {
    this.ox = ox; this.oz = oz; this.th = th; this.c = Math.cos(th); this.s = Math.sin(th);
    this.M = new THREE.Matrix4().makeRotationY(th).setPosition(ox, 0, oz); this.Mi = this.M.clone().invert();
    this.q = new THREE.Quaternion().setFromAxisAngle(_Y, th); this.qi = this.q.clone().invert();
  }
  wx(x, z) { return this.ox + this.c * x + this.s * z; }
  wz(x, z) { return this.oz - this.s * x + this.c * z; }
  lx(x, z) { const dx = x - this.ox, dz = z - this.oz; return this.c * dx - this.s * dz; }
  lz(x, z) { const dx = x - this.ox, dz = z - this.oz; return this.s * dx + this.c * dz; }
  toW(v, out = v) { const x = v.x, z = v.z; out.set(this.wx(x, z), v.y, this.wz(x, z)); return out; }
  toL(v, out = v) { const x = v.x, z = v.z; out.set(this.lx(x, z), v.y, this.lz(x, z)); return out; }
}
const SUMMIT_EXPRESS = { name: 'Summit Express', bot: { x: -7.4, z: 71.6 }, top: { x: -624.5, z: -2722.3 } };
// its towers as OpenStreetMap has them (the line's nodes, in this frame): the planner puts a tower within 6 m of each,
// and more only where a span is too long for lift.js and the place is clear of the venue
const PYLONS = [[-21.4, 8.6], [-34.6, -51.7], [-53.5, -138.3], [-74.6, -234.8], [-92.0, -314.2], [-110.8, -398.2], [-133.9, -501.7], [-154.2, -592.2], [-178.2, -699.6], [-197.1, -784.4], [-228.0, -922.6], [-262.2, -1070.1], [-274.7, -1124.0], [-303.5, -1248.0], [-327.7, -1352.5], [-348.2, -1455.0], [-372.4, -1565.8], [-390.5, -1648.8], [-414.2, -1757.5], [-435.6, -1855.3], [-449.4, -1920.1], [-469.9, -2016.4], [-498.4, -2150.5], [-519.3, -2244.8], [-548.6, -2377.7], [-570.4, -2476.1], [-595.7, -2590.4]];
function planLiftLine(L, towerOk) {
  L.len = Math.hypot(L.top.x - L.bot.x, L.top.z - L.bot.z);
  const ux = (L.top.x - L.bot.x) / L.len, uz = (L.top.z - L.bot.z) / L.len, th = Math.atan2(-ux, -uz);
  const F = new Frame2(L.bot.x, L.bot.z, th);
  const fake = { height: () => -Infinity, heightTerrainOnly: () => -Infinity, surface: () => false, fences: [], kickers: [],
    liftLines: [{ x: 0, top: -L.len + ST_FRONT - 4, bot: -ST_FRONT + 4, name: L.name }],
    towerOk: (x, z) => towerOk(F.wx(x, z), F.wz(x, z)) };
  const lH = (x, z) => height(F.wx(x, z), F.wz(x, z)), lG = (x, z) => ground(F.wx(x, z), F.wz(x, z));
  liftHeights(lH, lG);
  let plan; try { plan = planLift(fake); } finally { liftHeights(); }
  plan.name = L.name; plan.ends = false;
  return { L, F, plan, fake, lH, lG };
}
// the end of the course takes you onto the lift, as on the other maps
class XgLifts extends WorldLifts {
  pastBottom(p) { return p.z > 58 && p.x > courseX(60) - 12 && p.x < courseX(60) + 28; }
  boardNow(sk) { return this.board(0, sk); }
  // (on the low tier the lift's 42 000 triangles are not drawn a second time into the shadow map: the course runs
  // beside the line, so its shadow stand-in was in every frame there)
  lod(cam) { super.lod(cam); if (this.q.tier === 'low') for (const l of this.lifts) if (l.shadow) l.shadow.visible = false; }
}

/* the sun as it is at Buttermilk in late January (the event's dates, 26 to 28 January): latitude 39.2 N, the sun's
   declination -18.9 deg, solar noon at 12:20 local standard time (longitude 106.86 W against the zone's 105, and the
   equation of time about -12.5 min); the game's clock is local time. Through env.js's hook (setSunPath, N's). */
function buttermilkSun(t, out = new THREE.Vector3()) {
  const lat = 39.2 * Math.PI / 180, dec = -18.9 * Math.PI / 180, H = (t - 12 - 20 / 60) * 15 * Math.PI / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H), el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;   // (from north, clockwise)
  const e = Math.sin(az) * Math.cos(el), n = Math.cos(az) * Math.cos(el), b = 40 * Math.PI / 180;
  out.set(-e * Math.cos(b) + n * Math.sin(b), sinEl, e * Math.sin(b) + n * Math.cos(b)).normalize();
  return { el: el * 180 / Math.PI, dir: out };
}

export async function makeXgMap(q, step) {
  setSunPath(buttermilkSun);
  const X = await makeXg(q, step);
  const { park, land, mtn } = X;
  const osm = await fetch(new URL('osm.json?v=28', DATA)).then(r => r.ok ? r.json() : null).catch(() => null) || { woods: [], buildings: [], roads: [], pistes: [] };
  X.osm = osm;
  // ---- where things may not stand: the course and its sides, the pipe and its decks, the base, the lift line
  const P = park.PIPE;
  const onCourse = (x, z, m = 0) => z > -440 - m && z < 70 + m && Math.abs(x - courseX(z)) < 24 + m;
  const onPipe = (x, z, m = 0) => { const L = park.pipeLocal(x, z); return L.s > -20 - m && L.s < P.len + 45 + m && Math.abs(L.u) < P.W + m; };
  X.onCourse = onCourse; X.onPipe = onPipe;
  const pyl = (x, z) => { let d = Infinity; for (const [px, pz] of PYLONS) d = Math.min(d, Math.hypot(x - px, z - pz)); return d; };
  const towerOk = (x, z) => pyl(x, z) < 6 || (pyl(x, z) > 30 && !onCourse(x, z, 6) && !onPipe(x, z, 5));
  // the chairlift's plan, and the flat pads under its stations in the park's height (before the terrain is built)
  const LP = planLiftLine(SUMMIT_EXPRESS, towerOk);
  const planned = { plans: [LP] };
  {
    const H = park.height.bind(park), HT = park.heightTerrainOnly.bind(park), SU = park.surface.bind(park), F = LP.F;
    const pad = (x, z, g, f) => { const lx = F.lx(x, z), lz = F.lz(x, z); if (Math.abs(lx) > 40) return -Infinity; return f(lx, lz, g); };
    park.height = (x, z, g) => { const a = H(x, z, g), b = pad(x, z, g, LP.fake.height); return b > a ? b : a; };
    park.heightTerrainOnly = (x, z, g) => { const a = HT(x, z, g), b = pad(x, z, g, LP.fake.heightTerrainOnly); return b > a ? b : a; };
    park.surface = (x, z) => SU(x, z) || (Math.abs(F.lx(x, z)) < 40 && LP.fake.surface(F.lx(x, z), F.lz(x, z)));
  }
  X.makeLift = (scene, q2) => new XgLifts(scene, planned, q2);
  /* the floodlights' rows for the night (env.js lampRows, read when the sky is made, before dress): along both pipe decks
     every 24 m and down the jump line's lift side every 35 m, where dress() stands its towers; as lamps with no tower
     of env.js's own (stationLamps), since dress() draws the venue's black lattice ones. One tower row has to be given,
     or env.js lays its own two rows down the old park's run: one lamp 60 km away, which lights nothing. */
  {
    const P = park.PIPE, edge = (s, side) => park.pipeAt(s, side * (P.W + 2.5));
    const pipeRow = side => { const a = edge(8, side), b = edge(32, side); return { x0: a.x, z0: a.z, dx: b.x - a.x, dz: b.z - a.z, n: Math.floor((P.len + 2) / 24) + 1, ax: -side * P.P.ux, az: -side * P.P.uz, h: 17, power: 170 }; };
    park.lightTowers = [{ x0: 0, z0: 60000, dx: 0, dz: 0, n: 1, ax: 1, az: 0, h: 11, power: 0 }];
    park.stationLamps = (park.stationLamps || []).concat([pipeRow(-1), pipeRow(1), { x0: courseX(-255) - 19, z0: -255, dx: 0, dz: 35, n: 8, ax: 1, az: 0, h: 19, power: 170 }]);
  }
  X.liftPlan = LP;
  // the lift's top: a start up the mountain, where the chair leaves you
  { const P2 = LP.plan, lx = P2.XL - 8, lz = P2.top.front + 10; park.starts.push({ name: 'Top of the Summit Express', x: LP.F.wx(lx, lz), z: LP.F.wz(lx, lz), v: 2, yaw: LP.F.th - 0.25 }); }

  // ---- the trees: conifers (the game's forest) where the real ground is wooded: off the runs (OpenStreetMap's run lines,
  // each cleared 18 to 30 m either side), off the venue, the base and the lift line, in clumps with glades; and on the
  // upper mountain inside OpenStreetMap's woods. Aspens (bare in January) are dress()'s, among them on the lower slopes.
  const pistes = osm.pistes.map(p => ({ p: p.p, w: /Road|Catwalk|Trail|Parkway|Ave|Lane/i.test(p.n) ? 9 : 24 }));
  const pisteGrid = new Map(), PG = 40;
  for (const pi of pistes) for (let i = 0; i < pi.p.length - 1; i++) {
    const [ax, az] = pi.p[i], [bx, bz] = pi.p[i + 1];
    for (let gx = Math.floor((Math.min(ax, bx) - 40) / PG); gx <= Math.floor((Math.max(ax, bx) + 40) / PG); gx++)
      for (let gz = Math.floor((Math.min(az, bz) - 40) / PG); gz <= Math.floor((Math.max(az, bz) + 40) / PG); gz++) {
        const k = gx * 10007 + gz; if (!pisteGrid.has(k)) pisteGrid.set(k, []); pisteGrid.get(k).push([ax, az, bx, bz, pi.w]);
      }
  }
  const onRun = (x, z, m = 0) => {
    const l = pisteGrid.get(Math.floor(x / PG) * 10007 + Math.floor(z / PG)); if (!l) return false;
    for (const [ax, az, bx, bz, w] of l) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < w + m + 6 * simplex(x * 0.03, z * 0.03)) return true;
    }
    return false;
  };
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const woods = osm.woods.map(p => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { p, x0, x1, z0, z1 }; });
  const inWoods = (x, z) => woods.some(w => x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1 && inPoly(x, z, w.p));
  const buildings = osm.buildings.map(b => { let cx = 0, cz = 0; for (const [x, z] of b.p) { cx += x; cz += z; } cx /= b.p.length; cz /= b.p.length; let r = 0; for (const [x, z] of b.p) r = Math.max(r, Math.hypot(x - cx, z - cz)); return Object.assign(b, { cx, cz, r }); });
  const nearBuilding = (x, z, m) => buildings.some(b => Math.hypot(x - b.cx, z - b.cz) < b.r + m);
  const lineF = LP.F, onLift = (x, z) => Math.abs(lineF.lx(x, z)) < 14 && lineF.lz(x, z) < 30 && lineF.lz(x, z) > -LP.L.len - 30;
  // the valley floor north of the base (the highway, the meadow, the golf course) and the base area itself are open
  const open = (x, z) => z > 40 + 30 * simplex(x * 0.01, 3) || (z > -60 && x > -170 && x < 140);
  const treeAt = (x, z, aspen) => {
    if (open(x, z) || onCourse(x, z, 10) || onPipe(x, z, 10) || onLift(x, z) || nearBuilding(x, z, 8)) return 0;
    const upper = z < -900;
    if (upper && !inWoods(x, z)) return 0;
    if (onRun(x, z, 0)) return 0;
    let d = smoothstep(-0.25, 0.25, fbm(x * 0.012 + 3, z * 0.012 - 2, 3));                // clumps
    d *= 0.35 + 0.65 * smoothstep(-0.4, 0.2, fbm(x * 0.004 - 7, z * 0.004 + 1, 2));       // glades
    // aspens on the lower slopes, conifers above them and in the gullies
    const y = ground(x, z), lowSlope = 1 - smoothstep(60, 220, y);
    const aspenShare = clamp(0.15 + 0.4 * lowSlope + 0.3 * fbm(x * 0.008 + 11, z * 0.008, 2), 0.05, 0.7);
    return d * (aspen ? aspenShare : 1 - aspenShare);
  };
  X.treeAt = treeAt;
  /* stands the photos show by the course (2024 corral photo 1852: tall spruces between the lift and the big air's
     landing; the 2023 photos: big spruces behind the top rail section and along the course's sides; summer aerial
     photos: a dark clump in the open slope at about (-31, -184)): [x, z, radius, how many] */
  const STANDS = [[-31, -184, 9, 16], [-30, -100, 7, 10], [-36, -40, 6, 6], [-34, -430, 14, 22], [24, -440, 12, 16], [-38, -300, 9, 10], [-40, -360, 10, 12], [36, -380, 9, 10], [40, -320, 8, 8]];
  mtn.trees = (max, r) => {
    const out = [];
    for (const [sx, sz, sr, n] of STANDS) for (let k = 0, t = 0; k < n && t < n * 8; t++) {
      const a = r() * 6.28, d = sr * Math.sqrt(r()), x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d;
      // (just clear of the graded course: 17 m either side of its line over the jumps, 23 over the rails)
      if ((z > -445 && z < 70 && Math.abs(x - courseX(z)) < (z > -250 ? 17 : 23) + 2) || onPipe(x, z, 4) || onLift(x, z)) continue;
      out.push({ x, y: ground(x, z) - 0.3, z, s: 14 + r() * 10, rot: r() * 6.28 }); k++;
    }
    for (let tries = 0; out.length < max && tries < max * 14; tries++) {
      // (most of them round the venue and the slopes in view from it; fewer up the mountain)
      const near = r() < 0.75, x = near ? -650 + r() * 1200 : -1250 + r() * 2500, z = near ? -900 + r() * 1000 : -1580 + r() * 2000;
      if (r() > treeAt(x, z, false)) continue;
      const y = ground(x, z);
      out.push({ x, y: y - 0.3, z, s: 9 + r() * 13, rot: r() * 6.28 });
    }
    return out;
  };
  /* the hills round the valley as they look in January (2023 photos 077, 078: their sunny slopes grey-brown with oak and
     sage brush through thin snow): the snow shader's rock field (materials.js, the steepness it reads) is made steeper
     on south-facing open slopes below 3000 m that are not runs or the venue, so its mottled grey-brown shows there in
     patches; the runs, the venue and the shady slopes stay snow */
  setRockSource((x, z) => ground(x, z), [0, 0], (x, z, ny) => {
    if (ny < 0.5 || (z > -470 && z < 110 && x > -70 && x < 95) || onRun(x, z, 4) || ground(x, z) + X.E0 > 3000) return ny;
    const gx = (ground(x + 6, z) - ground(x - 6, z)) / 12, gz = (ground(x, z + 6) - ground(x, z - 6)) / 12, st = Math.hypot(gx, gz);
    if (st < 0.08) return ny;
    const north = -gx * 0.643 - gz * 0.766, sunny = clamp(-north / st * 1.5, 0, 1) * smoothstep(0.08, 0.2, st);
    return sunny > 0 ? Math.min(ny, 1 - sunny * (0.3 + 0.14 * fbm(x * 0.02, z * 0.02, 2))) : ny;
  });
  X.dress = (scene, mats, q2) => dress(X, scene, mats, q2);
  return X;
}

// ---- building helpers: geometry with colours in its vertices, merged by material ----------------------------------------
class Merge {
  constructor() { this.list = []; }
  add(g, colour, m) {
    g = g.index ? g.toNonIndexed() : g;
    if (m) g.applyMatrix4(m);
    const c = new THREE.Color(colour).convertSRGBToLinear(), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (g.attributes.uv && !this.uv) g.deleteAttribute('uv');
    this.list.push(g); return g;
  }
  box(x, y, z, sx, sy, sz, colour, ry = 0, rx = 0, rz = 0) { return this.add(new THREE.BoxGeometry(sx, sy, sz), colour, _m.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z)); }
  cyl(x, y, z, r0, r1, h, colour, seg = 8, ry = 0, rx = 0, rz = 0) { return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), colour, _m.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z)); }
  // a straight bar between two points
  bar(a, b, r, colour, seg = 5) {
    const d = _v.subVectors(b, a), L = d.length(); if (L < 1e-3) return;
    const g = new THREE.CylinderGeometry(r, r, L, seg, 1, true); g.translate(0, L / 2, 0);   // (open: its ends are never seen)
    _q.setFromUnitVectors(_Y, d.normalize()); _m.compose(a, _q, _s.set(1, 1, 1));
    return this.add(g, colour, _m);
  }
  mesh(material, name) {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false); this.list.length = 0; if (!g) return null;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
}
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- the far mountains: the far grid as one mesh, out to 32 km -------------------------------------------------------
function farMountains(X, q) {
  const G = X.GRIDS.far, h = X.grids.hr, low = q.tier === 'low', N = low ? 110 : 180;
  const pos = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array((N + 1) * (N + 1) * 3), idx = [];
  const span = (G.n - 1) * G.step;
  const at = (x, z) => { const fx = clamp((x - G.x0) / G.step, 0, G.n - 1.001), fz = clamp((z - G.z0) / G.step, 0, G.n - 1.001), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, n = G.n;
    return (h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx) * (1 - tz) + (h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx) * tz; };
  for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
    const x = G.x0 + span * i / N, z = G.z0 + span * j / N;
    pos[k * 3] = x; pos[k * 3 + 1] = at(x, z); pos[k * 3 + 2] = z;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  /* the colours as the valley looks in January (the 2023 build photos: the hills across the valley grey-brown with oak
     and sage brush through thin snow on their sunny sides, dark conifers on the shady ones, the Elk Mountains white over
     the tree line about 3500 m, their crests rock) */
  const nn = g.attributes.normal.array, c = new THREE.Color();
  const SNOW = new THREE.Color(0xeef2f7), BRUSH = new THREE.Color(0x8d8273), FOREST = new THREE.Color(0x2f3d33), ROCK = new THREE.Color(0x5f5a57), MEADOW = new THREE.Color(0xe2e5e8);
  for (let k = 0; k < pos.length / 3; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1] + X.E0, z = pos[k * 3 + 2], nx = nn[k * 3], ny = nn[k * 3 + 1], nz = nn[k * 3 + 2];
    const n = fbm(x * 0.0015, z * 0.0015, 2), steep = 1 - ny;
    // the way a slope faces, in the world: +x is north-west, +z north-east here (the frame turned 40 degrees)
    const north = nz * Math.cos(40 * Math.PI / 180) + nx * Math.sin(40 * Math.PI / 180), sunny = clamp(-north * 2.2, 0, 1);
    // (valley floors and gentle ground: snow; sunny slopes below about 3000 m: brush and grass through thin snow, grey
    // brown; shady slopes, and every side from about 2900 m to the tree line: conifers; over it snow, rock on the crests)
    c.copy(MEADOW);
    const flat = smoothstep(0.1, 0.03, steep), tl = 3450 + n * 120;
    if (y < tl) {
      c.lerp(BRUSH, sunny * (1 - flat) * (1 - smoothstep(2850, 3150, y + n * 100)) * 0.85);
      c.lerp(FOREST, (1 - flat * 0.85) * clamp((1 - sunny) * 0.9 + smoothstep(2800, 3100, y) * 0.6, 0, 1) * (0.6 + 0.35 * n) * (1 - smoothstep(tl - 150, tl, y)) * smoothstep(2250, 2380, y));
    } else c.copy(SNOW);
    c.lerp(ROCK, smoothstep(0.42, 0.62, steep + n * 0.1) * 0.85);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const far = low ? 2000 : 2600;
  m.onBeforeCompile = s => {
    s.uniforms.uHorizon = snowUniforms.uHorizon;
    // (sunk under the near ground the terrain draws round the camera, so the coarse grid never pokes through it)
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
transformed.y -= 30.0 * (1.0 - smoothstep(${(far - 300).toFixed(1)}, ${(far + 400).toFixed(1)}, length(wp.xz - cameraPosition.xz)));
vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uHorizon; varying vec3 vTW;').replace('#include <fog_fragment>', `#ifdef USE_FOG
  float dd = length(vTW - cameraPosition), kk = fogDensity / 0.00028;
  float hz = 1.0 - exp(-dd * 0.00004 * kk);
  hz = mix(hz, 1.0, (1.0 - smoothstep(-260.0, 120.0, vTW.y)) * 0.25 * smoothstep(3000.0, 9000.0, dd));
  vec3 fdir = normalize(vTW - cameraPosition);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uHorizon, vec2(atan(fdir.z, fdir.x) * 0.1591549 + 0.5, 0.5)).rgb, clamp(hz, 0.0, 1.0));
#endif`);
  };
  m.customProgramCacheKey = () => 'xgfar' + far;
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'far mountains'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false; mesh.renderOrder = 1e5;
  return mesh;
}

// ---- dress: everything round the course -----------------------------------------------------------------------------------
function dress(X, scene, mats, q) {
  const { park, osm } = X, low = q.tier === 'low';
  const group = new THREE.Group(); group.name = 'venue';
  group.add(farMountains(X, q));
  const H = (x, z) => height(x, z), G0 = (x, z) => ground(x, z);
  const M = new Merge(), Mlit = new Merge();       // (Mlit: lamps' heads and the screen, unlit bright)
  // colours (sRGB): from the photos
  const BLACK = 0x18191c, DARK = 0x2a2d31, NET = 0x1f5fd6, POLE = 0x2a63d9, WOOD = 0x8a5e3c, STEEL = 0x9aa0a6, WHITE = 0xe9ecef, RED = 0xc8322b, GREY = 0x6d7278;

  // ---- light towers: black lattice masts about 18 m tall with a head of four to six floodlights (photos: the pipe's
  // both sides, and the big air's landing's two sides); the lamps' light at night from their rows (env.js stationLamps)
  const towers = [];
  const P = park.PIPE;
  const pipeEdge = (s, side) => park.pipeAt(s, side * (P.W + 2.5));
  for (let s = 8; s <= P.len + 10; s += 24) for (const side of [-1, 1]) towers.push(Object.assign(pipeEdge(s, side), { face: -side, pipe: true }));
  for (let z = -255; z <= -10; z += 35) towers.push({ x: courseX(z) - 19, z, face: 1 });
  // (slim triangular-ish truss: three-sided read from afar; the course's masts light grey as in the 2024 corral photo,
  // the pipe's black as the event's renderings draw them)
  const lattice = (x, z, h, col) => {
    const y0 = G0(x, z) - 0.3, w = 0.38;
    for (const [dx, dz] of [[-w, -w], [w, -w], [w, w], [-w, w]]) M.box(x + dx, y0 + h / 2, z + dz, 0.07, h, 0.07, col);
    for (let y = 1.2; y < h - 0.5; y += 2.2) for (const [ax, az, bx, bz] of [[-w, -w, w, -w], [w, -w, w, w], [w, w, -w, w], [-w, w, -w, -w]])
      M.bar(V(x + ax, y0 + y, z + az), V(x + bx, y0 + y + 1.5, z + bz), 0.025, col, 3);
  };
  for (const t of towers) {
    const h = t.pipe ? 17 : 19, col = t.pipe ? BLACK : 0xb4b8bd, ry = Math.atan2(t.face, 0), ca = Math.cos(ry), sa = Math.sin(ry);
    lattice(t.x, t.z, h, col);
    const y = G0(t.x, t.z) - 0.3 + h;
    // the head: a bar across with two rows of three floodlights, big lit rectangles aimed across the run
    M.box(t.x, y + 0.9, t.z, 3.4, 0.12, 0.12, col, ry); M.box(t.x, y + 0.05, t.z, 3.4, 0.12, 0.12, col, ry);
    for (const b of [0.3, 1.25]) for (const a of [-1.1, 0, 1.1]) { M.box(t.x + a * ca, y + b, t.z - a * sa, 0.95, 0.75, 0.22, 0x2a2c30, ry); Mlit.box(t.x + a * ca + 0.13 * t.face, y + b, t.z - a * sa, 0.85, 0.66, 0.04, 0xeef3f8, ry); }
  }
  // (their light at night: the rows makeXgMap gave env.js, the same places)

  // ---- fences: blue plastic netting on blue poles down both sides of the course (photos: 2023 build, 2024 corral), black
  // fabric round the outruns and the finish
  const netQuads = [], fabricQuads = [], pipeQuads = [];
  const fenceLine = (pts, list, h, poleCol, every = 3) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / every));
      for (let k = 0; k < n; k++) {
        const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
        const y0 = H(x0, z0), y1 = H(x1, z1);
        list.push([x0, y0, z0, x1, y1, z1, h]);
        M.cyl(x0, y0 + h / 2, z0, 0.03, 0.03, h + 0.3, poleCol, 5);
      }
    }
  };
  const side = (s, z0, z1, off) => { const p = []; for (let z = z0; z <= z1; z += 6) p.push([courseX(z) + s * (off(z)), z]); return p; };
  const half = z => 24 + 4 * smoothstep(-5, 25, z) - 4 * smoothstep(-270, -230, z);
  fenceLine(side(1, -430, 0, half), netQuads, 1.3, POLE);
  fenceLine(side(-1, -430, 0, half), netQuads, 1.3, POLE);
  // the finish: black fabric across the bottom and down its sides, the corral inside it
  const cx = courseX(40);
  fenceLine([[cx - 14, -8], [cx - 14, 62], [cx + 24, 62], [cx + 24, -8]], fabricQuads, 1.1, POLE, 2.5);
  // (black windscreen fabric down both sides of each jump's in-run and table, at its side's foot, as photo 083 shows)
  for (const k of park.kickers) if (/^Jump/.test(k.name)) for (const sg of [-1, 1]) {
    const pts = []; for (let z = k.z0 - 18; z <= k.K.z + 1; z += 4) { const hw = k.hwAt(Math.max(k.z0, z)) + Math.max(0.5, (k.rel(Math.max(k.z0 + 0.01, Math.min(z, k.K.z)), 0) || 0) / 1.05 + 1.2); pts.push([k.cxT + sg * hw, z]); }
    if (k.name.includes('(left)') && sg < 0 || k.name.includes('(right)') && sg > 0) continue;
    fenceLine(pts, fabricQuads, 1.2, POLE, 2.5);
  }
  // pipe's decks: black fabric along its outer edges
  for (const s of [-1, 1]) { const pts = []; for (let t = -10; t <= P.len + 40; t += 8) { const p = park.pipeAt(t, s * (P.W + 0.8)); pts.push([p.x, p.z]); } fenceLine(pts, pipeQuads, 1.0, BLACK, 4); }
  const quads = (list, mat, name, uvScale) => {
    // (mat null: the black fabric and the pipe decks' blue-violet banners in one mesh, the colour in each quad's 8th entry)
    const pos = [], uv = [], col = [], FAB = [new THREE.Color(0x141518).convertSRGBToLinear(), new THREE.Color(0x4f4ab8).convertSRGBToLinear()];
    for (const [x0, y0, z0, x1, y1, z1, h, ci = 0] of list) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      pos.push(x0, y0 + 0.1, z0, x1, y1 + 0.1, z1, x1, y1 + h, z1, x0, y0 + 0.1, z0, x1, y1 + h, z1, x0, y0 + h, z0);
      uv.push(0, 0, L * uvScale, 0, L * uvScale, h * uvScale, 0, 0, L * uvScale, h * uvScale, 0, h * uvScale);
      for (let k = 0; k < 6; k++) col.push(FAB[ci].r, FAB[ci].g, FAB[ci].b);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    if (!mat) { g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); }
    const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; m.castShadow = false; group.add(m);
  };
  // the net's picture: blue diamond mesh, see-through between the strands
  const netTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.strokeStyle = '#3d6cc4'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(64, 64); x.moveTo(64, 0); x.lineTo(0, 64); x.moveTo(-32, 32); x.lineTo(32, -32); x.moveTo(32, 96); x.lineTo(96, 32); x.moveTo(-32, 32); x.lineTo(32, 96); x.moveTo(32, -32); x.lineTo(96, 32); x.stroke();
    x.fillStyle = '#3d6cc4'; x.fillRect(0, 0, 64, 3); x.fillRect(0, 61, 64, 3);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  quads(netQuads, new THREE.MeshLambertMaterial({ map: netTex, alphaTest: 0.5, side: THREE.DoubleSide }), 'course netting', 7);
  quads(fabricQuads.concat(pipeQuads.map(q => q.concat(1))), null, 'fabric fences', 1);

  // ---- banners: black with plain white words and a blue stripe (the venue's are black; their words here are the map's own)
  const bannerTex = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
    const row = (i, text, bg = '#111317', fg = '#ffffff', stripe = '#2a63d9') => {
      const y = i * 128; x.fillStyle = bg; x.fillRect(0, y, 1024, 128); x.fillStyle = stripe; x.fillRect(0, y + 112, 1024, 10);
      x.font = '800 64px "Barlow Condensed", Arial Narrow, sans-serif'; x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 512, y + 58);
    };
    row(0, 'BUTTERMILK  2024'); row(1, 'START'); row(2, 'FINISH'); row(3, 'SLOPESTYLE   ·   SUPERPIPE');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const bannerPos = [], bannerUv = [];
  const banner = (x0, z0, x1, z1, y0, h, row) => {
    const ya = y0 ?? H(x0, z0) + 0.15, yb = y0 ?? H(x1, z1) + 0.15, v0 = 1 - (row + 1) / 4, v1 = 1 - row / 4;
    bannerPos.push(x0, ya, z0, x1, yb, z1, x1, yb + h, z1, x0, ya, z0, x1, yb + h, z1, x0, ya + h, z0);
    bannerUv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
  };
  // along the big air's landing, both sides, and round the corral (black banners, as along the 2024 landing)
  for (let z = -60; z < -2; z += 9) { const hw = 16; banner(courseX(z) + hw, z, courseX(z + 8) + hw, z + 8, undefined, 1.0, z % 18 === 0 ? 3 : 0); banner(courseX(z + 8) - hw, z + 8, courseX(z) - hw, z, undefined, 1.0, 0); }
  for (let x = cx - 7; x < cx + 22; x += 9.5) banner(x + 9, 61.8, x, 61.8, undefined, 1.0, 3);

  // ---- the start: a deck at the top, a black-roofed tent behind it, a gate with its banner
  {
    const z = -414, x = courseX(z), y = H(x, z);
    M.box(x, y + 1.3, z - 2, 10, 2.6, 6, 0xf1f2f4);                         // the tent's walls
    M.box(x, y + 2.9, z - 2, 10.6, 0.6, 6.6, BLACK);                          // its roof
    for (const s of [-1, 1]) M.box(x + s * 5, y + 1.6, z + 3.4, 0.2, 3.2, 0.2, BLACK);
    banner(x - 5, z + 3.5, x + 5, z + 3.5, y + 2.7, 1.0, 1); banner(x + 5, z + 3.45, x - 5, z + 3.45, y + 2.7, 1.0, 1);
    // the start wand: a bar across the start
    M.box(x, y + 0.75, z + 6, 3.2, 0.06, 0.06, RED);
  }
  // ---- camera towers: scaffold cubes draped black, a camera on top (photo: beside the first rail section)
  const camTower = (x, z, h = 4) => {
    const y = H(x, z);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) M.box(x + dx, y + h / 2, z + dz, 0.06, h, 0.06, STEEL);
    M.box(x, y + h * 0.55, z, 2.5, h * 0.9, 2.5, 0x141518);
    M.box(x, y + h + 0.05, z, 2.7, 0.1, 2.7, STEEL);
    M.box(x, y + h + 0.6, z, 0.35, 0.35, 0.7, BLACK); M.cyl(x, y + h + 0.3, z, 0.04, 0.04, 0.6, BLACK, 5);
  };
  camTower(courseX(-380) + 27, -380); camTower(courseX(-330) - 27, -330); camTower(courseX(-282) + 26, -282);
  camTower(courseX(-210) - 25, -210); camTower(courseX(-140) - 25, -140); camTower(courseX(-60) - 21, -75, 5);

  // ---- the finish: the corral's black railings (photo: black frames crossed with an X, a black top rail)
  for (let x = cx - 14; x < cx + 22; x += 2.5) {
    const z = 8, y = H(x + 1.25, z);
    M.box(x + 1.25, y + 1.1, z, 2.5, 0.06, 0.08, BLACK); M.box(x + 1.25, y + 0.12, z, 2.5, 0.05, 0.05, BLACK); M.box(x, y + 0.6, z, 0.06, 1.15, 0.06, BLACK);
    M.bar(V(x, y + 0.12, z), V(x + 2.5, y + 1.1, z), 0.02, BLACK, 3); M.bar(V(x + 2.5, y + 0.12, z), V(x, y + 1.1, z), 0.02, BLACK, 3);
  }
  // the judges' stand (not seen in any photo found: a scaffold stand with a cabin at the corral's lift side, estimated)
  { const x = cx - 28, z = 46, y = H(x, z); for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) M.box(x + dx, y + 1.6, z + dz, 0.08, 3.2, 0.08, STEEL); M.box(x, y + 3.25, z, 4.4, 0.15, 4.4, STEEL); M.box(x, y + 4.6, z, 4.2, 2.6, 4.2, 0x1c1e22); Mlit.box(x, y + 4.8, z - 2.12, 3.6, 1.0, 0.04, 0x9ec3e6); }
  // the dark arched lounge at the base (2023 and 2024 photos: an arched black fabric hall with a wooden front)
  {
    const x = 38, z = 34, y = H(x, z) - 0.2, R = 10, L = 18;
    const g = new THREE.CylinderGeometry(R, R, L, 18, 1, true, -Math.PI / 2, Math.PI); g.rotateX(-Math.PI / 2);   // (the half round on top, its length along z)
    g.scale(1, 0.85, 1); M.add(g, 0x15171b, _m.makeTranslation(x, y, z));
    M.box(x, y + 3.2, z - L / 2 - 0.1, 2 * R - 1, 6.4, 0.3, WOOD);              // its wooden front, facing the course
    Mlit.box(x, y + 6.8, z - L / 2 - 0.3, 8, 1.2, 0.1, 0xe8edf2);               // its lit sign board (no words)
  }
  // the big screen on its truss beside the corral, facing up the course
  { const x = cx - 30, z = 66, y = H(x, z); for (const s of [-1, 1]) M.box(x + s * 4.2, y + 4, z, 0.4, 8, 0.4, STEEL); M.box(x, y + 6, z, 9, 5.2, 0.5, BLACK); Mlit.box(x, y + 6, z - 0.27, 8.4, 4.7, 0.04, 0x8fb4d8); }
  // a viewing deck by the pipe's foot: black railings with blue panels (2024 photo, the stairs up to it)
  { const x = cx + 6, z = 78, y = H(x, z); M.box(x, y + 1.25, z, 14, 2.5, 7, DARK); for (let k = -6.5; k <= 6.5; k += 1) M.box(x + k, y + 3.0, z - 3.5, 0.05, 1.0, 0.05, BLACK); M.box(x, y + 3.5, z - 3.5, 14, 0.07, 0.07, BLACK); M.box(x, y + 2.9, z - 3.45, 14, 0.8, 0.03, POLE); }
  // snowcats parked beside the course and at the pipe's top (red cabs, grey bodies, black tracks, the blade raised)
  const snowcat = (x, z, ry) => {
    const y = H(x, z), c = Math.cos(ry), s = Math.sin(ry), at = (a, b) => [x + a * c + b * s, z - a * s + b * c];
    for (const t of [-1.6, 1.6]) { const [px, pz] = at(t, 0); M.box(px, y + 0.5, pz, 1.1, 1.0, 5.0, 0x1b1c1f, ry); }
    { const [px, pz] = at(0, 0.2); M.box(px, y + 1.35, pz, 3.2, 0.9, 4.0, 0x55595e, ry); }
    { const [px, pz] = at(0, 1.0); M.box(px, y + 2.3, pz, 2.4, 1.2, 1.9, RED, ry); }
    { const [px, pz] = at(0, 3.2); M.box(px, y + 0.9, pz, 4.4, 1.0, 0.25, 0x6a6e73, ry); }
  };
  snowcat(courseX(-300) - 34, -300, 0.4); snowcat(park.pipeAt(P.len + 30, P.W + 9).x, park.pipeAt(P.len + 30, P.W + 9).z, -0.3); snowcat(cx - 50, 30, 1.2);
  // blue pennants on the knuckles of the jumps and the rail decks, red marshal flags by the corral
  const flag = (x, z, colour) => { const y = H(x, z); M.cyl(x, y + 1.1, z, 0.025, 0.025, 2.2, BLACK, 5); M.box(x + 0.32, y + 1.9, z, 0.62, 0.42, 0.02, colour); };
  // (the knuckles' tall feather flags, photos 082, 083: a bent pole and a long narrow blue banner)
  const feather = (x, z) => { const y = H(x, z); M.cyl(x, y + 1.9, z, 0.025, 0.03, 3.8, 0x2a2d31, 5); M.box(x + 0.36, y + 2.4, z, 0.7, 2.6, 0.02, 0x2456c8); M.box(x + 0.3, y + 3.85, z, 0.55, 0.35, 0.02, 0x2456c8); };
  for (const k of park.kickers) for (const s of [-1, 1]) { const w = k.hwAt ? k.hwAt(k.K.z) : k.wD; feather(k.cxT + s * (w + 1.4), k.K.z); }
  for (const x of [cx - 10, cx + 2, cx + 14]) flag(x, 5, RED);

  // ---- the base area's buildings (OpenStreetMap footprints, heights from their tags or about two storeys), snow on top
  for (const b of osm.buildings) {
    if (Math.hypot(b.cx, b.cz - 60) > 900 || b.p.length < 3) continue;
    let ymin = Infinity; for (const [x, z] of b.p) ymin = Math.min(ymin, G0(x, z));
    const hh = b.h || (b.r > 25 ? 9 : 6.5);
    const shape = new THREE.Shape(b.p.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: hh, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, ymin - 1, 0);
    // (walls: wood and stone browns; roofs: snow)
    const wall = (b.k === 'residential' || b.k === 'apartments') ? 0x7a5a42 : (b.r > 30 ? 0x8b7a66 : 0x6e5440);
    M.add(g, wall);
    const top = new THREE.ShapeGeometry(shape); top.rotateX(-Math.PI / 2); top.translate(0, ymin - 1 + hh + 0.4, 0); M.add(top, 0xf4f6f8);
  }
  // ---- the roads (the highway along the valley, the base's roads) and the airport's runway across it, laid on the snow
  {
    const pos = [], W = { trunk: 7.5, primary: 7.5, secondary: 5, tertiary: 4.5, residential: 3.5, unclassified: 3.5, service: 2.6, runway: 30, taxiway: 9 };
    for (const r of osm.roads) {
      const w = W[r.k] || 0; if (!w) continue;
      let mz = 0, mx = 0; for (const q of r.p) { mz += q[1]; mx += q[0]; } mz /= r.p.length; mx /= r.p.length;
      if (Math.hypot(mx, mz) > 1400) continue;
      if (/service|track|unclassified/.test(r.k) && mz < 30 && mx > -500 && mx < 400) continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
        const nx = -(bz - az) / L * w, nz = (bx - ax) / L * w, n = Math.max(1, Math.ceil(L / 12));
        for (let k = 0; k < n; k++) {
          const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
          const p = (x, z) => [x, G0(x, z) + 0.12, z];
          const a = p(x0 + nx, z0 + nz), b = p(x0 - nx, z0 - nz), c = p(x1 - nx, z1 - nz), d = p(x1 + nx, z1 + nz);
          pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        }
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6a6e73, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
      m.name = 'roads'; m.matrixAutoUpdate = false; m.receiveShadow = true; group.add(m);
    }
  }
  // ---- aspens: groves of bare white trunks on the lower slopes (January), one instanced mesh
  {
    const one = new Merge();
    // (a tapering open trunk and four upswept branches, 34 triangles: a grove is many of them)
    one.add(new THREE.CylinderGeometry(0.05, 0.19, 9.4, 5, 1, true), 0xd9d6cf, _m.makeTranslation(0, 4.7, 0));
    for (let k = 0; k < 4; k++) { const a = k * 2.4, y = 4.4 + k * 0.9; one.bar(V(0, y, 0), V(Math.cos(a) * 1.5, y + 1.9, Math.sin(a) * 1.5), 0.04, 0xbdb8ae, 3); }
    const tg = mergeGeometries(one.list, false);
    const list = [], r = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(91);
    const max = low ? 650 : 1800;
    for (let tries = 0; list.length < max && tries < max * 14; tries++) {
      const x = -700 + r() * 1300, z = -950 + r() * 1100;
      if (r() > X.treeAt(x, z, true) * 1.4) continue;
      // (in groves: several close together)
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n && list.length < max; k++) { const xx = x + (r() - 0.5) * 8, zz = z + (r() - 0.5) * 8; if (X.treeAt(xx, zz, true) > 0) list.push([xx, G0(xx, zz) - 0.2, zz, 0.8 + r() * 0.7, r() * 6.28]); }
    }
    const im = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    list.forEach(([x, y, z, s, a], i) => im.setMatrixAt(i, _m.compose(V(x, y, z), _q.setFromAxisAngle(_Y, a), _s.set(s, s * (0.9 + 0.3 * ((i * 7) % 5) / 5), s))));
    im.instanceMatrix.needsUpdate = true; im.name = 'aspens'; im.castShadow = false; im.receiveShadow = false; im.matrixAutoUpdate = false; im.computeBoundingSphere();
    group.add(im);
    X.aspens = list;
  }
  // ---- the base village (the venue map: a music stage on the Inn's side, an award stage and lounges by the pipe's foot,
  // the festival's white tents and the entrance on the far side; places estimated from that map, sizes from photos)
  const tent = (x, z, w, d, ry = 0, colour = 0xf2f3f4) => {
    const y = G0(x, z);
    M.box(x, y + 1.3, z, w, 2.6, d, colour, ry);
    const roof = new THREE.ConeGeometry(Math.hypot(w, d) / 2, 1.8, 4, 1, true); roof.rotateY(Math.PI / 4); roof.scale(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414);
    M.add(roof, colour, _m.makeRotationY(ry).setPosition(x, y + 3.5, z));
  };
  for (const [x, z, w, d] of [[34, 72, 6, 6], [42, 72, 6, 6], [50, 76, 9, 6], [62, 84, 6, 6], [70, 90, 12, 8], [48, 100, 6, 6], [56, 104, 6, 6], [-48, 92, 8, 6], [-58, 96, 6, 6]]) tent(x, z, w, d, 0.15);
  // the music stage: a black box under a truss roof, facing the base
  { const x = -78, z = 74, y = G0(x, z); M.box(x, y + 1.0, z, 16, 2.0, 10, 0x1d1f23); for (const [dx, dz] of [[-8, -5], [8, -5], [-8, 5], [8, 5]]) M.box(x + dx, y + 5, z + dz, 0.4, 10, 0.4, STEEL); M.box(x, y + 10, z, 17, 0.6, 11, 0x2a2d31); M.box(x, y + 5.5, z + 5, 14, 7, 0.2, 0x111215); }
  // the award stage by the pipe's foot
  { const x = 46, z = 10, y = G0(x, z); M.box(x, y + 0.9, z, 10, 1.8, 6, 0x1d1f23); M.box(x, y + 4.5, z + 2.8, 10, 5.4, 0.3, 0x111215); }
  // ---- the crowd: people in winter clothes in the finish area behind the corral, along the pipe's foot and round the
  // base, one instanced mesh of a body and a head (a few dark and bright jackets, as in the photos)
  {
    const body = new Merge();
    body.add(new THREE.CylinderGeometry(0.2, 0.24, 1.25, 5, 1, true), 0xffffff, _m.makeTranslation(0, 0.62, 0));
    body.add(new THREE.SphereGeometry(0.13, 5, 3), 0xffffff, _m.makeTranslation(0, 1.42, 0));
    const pg = mergeGeometries(body.list, false);
    const spots = [], rr = (s => () => (s = (s * 48271) % 2147483647) / 2147483647)(7);
    const area = (x0, x1, z0, z1, n) => { for (let i = 0; i < n; i++) spots.push([x0 + rr() * (x1 - x0), z0 + rr() * (z1 - z0)]); };
    const n = low ? 1 : 2;
    area(cx - 6, cx + 22, 63, 76, 90 * n);            // (behind the finish, the corral's spectators)
    area(cx + 26, cx + 40, 0, 50, 40 * n);            // (along the pipe's foot)
    area(-70, -30, 60, 95, 40 * n); area(20, 80, 80, 120, 50 * n);
    const JACKETS = [0x1b1c20, 0x2b2f38, 0x3c2a24, 0x9e2b25, 0x1f4f8a, 0xd9d4c7, 0x4a5a3a, 0x222222, 0xe0a020];
    const im = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
    const col = new THREE.Color();
    spots.forEach(([x, z], i) => { im.setMatrixAt(i, _m.compose(V(x, G0(x, z) - 0.05, z), _q.setFromAxisAngle(_Y, rr() * 6.28), _s.set(1, 0.85 + rr() * 0.3, 1))); im.setColorAt(i, col.set(JACKETS[i % JACKETS.length])); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.name = 'crowd'; im.castShadow = false; im.matrixAutoUpdate = false; im.computeBoundingSphere(); group.add(im);
  }
  // (the cable camera's masts go in the venue's mesh: below)
  const camA = V(courseX(-250) - 20, H(courseX(-250) - 20, -250) + 24, -250), camB = V(courseX(45) - 20, H(courseX(45) - 20, 45) + 22, 45);
  for (const p of [camA, camB]) M.box(p.x, (p.y + G0(p.x, p.z)) / 2, p.z, 0.4, p.y - G0(p.x, p.z), 0.4, BLACK);
  const solid = M.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide }), 'venue');   // (both sides: the roofs from OpenStreetMap's outlines come out wound either way)
  if (solid) { solid.castShadow = false; solid.receiveShadow = true; group.add(solid); }
  const lit = Mlit.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), 'venue lamps');
  if (lit) group.add(lit);
  if (bannerPos.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(bannerPos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(bannerUv, 2)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: bannerTex, side: THREE.DoubleSide })); m.name = 'banners'; m.matrixAutoUpdate = false; group.add(m);
  }
  // the cable camera's two lines over the jump line, from a mast above the first jump to one by the corral
  {
    const a = camA, b = camB;
    const seg = []; for (const off of [-0.8, 0.8]) for (let i = 0; i < 24; i++) { const t0 = i / 24, t1 = (i + 1) / 24; const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1); p0.x += off; p1.x += off; p0.y -= Math.sin(Math.PI * t0) * 3; p1.y -= Math.sin(Math.PI * t1) * 3; seg.push(p0, p1); }
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x202226 })); l.name = 'cable cam'; l.matrixAutoUpdate = false; group.add(l);
  }
  for (const o of group.children) o.updateMatrixWorld(true);
  scene.add(group);
  return group;
}
