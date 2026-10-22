// Roads from OSM: asphalt ribbons with filled junctions, lane markings by country, crosswalks, stop lines, curbs,
// pavements (open world), a fast surface lookup for the car physics, and a directed lane graph for traffic.
//
//   await roads.build(osmData, opts)    (re)builds everything from the osm.js store. opts: { groundAt(x, z) (number
//        or null), scene, collide, world (its mode 'open' picks the median ground), sidewalks (true: draw pavements,
//        for the open world), groundPercentile (default 0.25, or 0.5 with world.mode 'open'), lat, lon (default:
//        the geo.js origin), lift (metres over the sampled ground, default 0.03) }. Yields to the frame loop
//        every ~8 ms; the old meshes and lookups stay live until the new ones are complete, then swap in one step.
//        Calls queue.
//   await roads.reheight(bbox)           re-samples heights inside {x0, z0, x1, z1} or a THREE.Box3 and rebuilds
//        the meshes there; lane objects are kept and their heights change in place. Waiting calls merge.
//   roads.surfaceAt(x, z, yHint?)        -> { h, onRoad, edge, curbH } (see surfaceAt)
//   roads.nearestLane(x, z, maxDist?, filter?) -> { lane, s, x, y, z, heading, dist } | null
//   roads.nearestRoadPoint(x, z)         -> { x, y, z, heading, lane } | null (on a lane centre, facing its traffic)
//   roads.nearestEdge(x, z, maxDist?)    -> { x, z, h, heading, dist, halfWidth, edge } | null (road centreline)
//   roads.graph                          { lanes: [], nodes: Map } (lane records described at buildGraph)
//   roads.signals                        Map node id -> signal group id (signal nodes and their junction nodes)
//   roads.signalGroups                   Map id -> { id, x, z, nodes, axis (deg 0..180), approaches: [{ heading
//        (travel direction, deg), x, z (stop line centre), px, pz (near-side curb at the stop line), fx, fz (near-side
//        curb just past the junction on the road straight ahead, or null), halfWidth, lanes, node, edge, toEnd, s }] }
//   roads.signs                          [{ id, kind: 'stop'|'give_way', x, z, heading, px, pz (post at the curb) }]
//   roads.leftHand, roads.style ({ region: 'us'|'uk'|'eu'|'jp'|'au'|'other', yellowCentre, ... }), roads.group
//   roads.dispose()
//
// Frame: geo.js local metres, +x east, +y up, +z south. Heading = degrees clockwise from north.
import * as THREE from 'three';
import { unproject } from './geo.js?v=18';

const BASE = new URL('../', import.meta.url).href; // public/car/
let LIFT = 0.03;
const CURB_H = 0.15, CURB_W = 0.3, STEP = 3, CELL = 8, TILE = 400;

// ---------------------------------------------------------------- region rules
const LHT_BOXES = [ // [lat0, lon0, lat1, lon1]
  [49.85, -8.2, 60.9, 1.8], [51.3, -10.7, 55.45, -5.4], // UK, Ireland
  [24, 122.9, 30.5, 131.5], [30.9, 129.6, 34.4, 132.1], [33.4, 132, 41.6, 142.1], [41.3, 139.3, 45.6, 146], // Japan
  [-44, 112, -10, 154], [-47.5, 166, -34, 179], // Australia, New Zealand
  [6, 68, 35.6, 92], [5.8, 79.5, 10, 82], [20.5, 88, 26.7, 92.7], [23.6, 60.8, 37, 77.8], [26.3, 80, 30.5, 88.2], // India, Sri Lanka, Bangladesh, Pakistan, Nepal
  [-35, 16, -15.5, 33], [-27, 30.2, -10.4, 41], // southern Africa, Mozambique
  [-11.8, 29, 5, 41.9], // Kenya, Tanzania, Uganda
  [5.6, 97.3, 20.5, 105.7], [0.8, 99.6, 7.4, 119.3], [-11, 95, 6, 141], [1.15, 103.6, 1.48, 104.1], // Thailand, Malaysia, Indonesia, Singapore
  [22.15, 113.83, 22.57, 114.45], [22.1, 113.52, 22.22, 113.6], // Hong Kong, Macau
];
function regionOf(lat, lon) {
  const inBox = (b) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
  const leftHand = LHT_BOXES.some(inBox);
  let region = 'other';
  if (lon > -170 && lon < -30 && lat > -56 && lat < 72) region = 'us';
  else if (inBox([49.85, -8.2, 60.9, 1.8]) || inBox([51.3, -10.7, 55.45, -5.4])) region = 'uk';
  else if (inBox([24, 122.9, 46, 146]) && leftHand) region = 'jp';
  else if (lat > 35 && lat < 72 && lon > -25 && lon < 45) region = 'eu';
  else if (inBox([-47.5, 112, -10, 179])) region = 'au';
  return { leftHand, region };
}
// Marking styles: dash/gap lengths in metres, line width.
const STYLES = {
  us: { yellowCentre: true, lw: 0.12, lane: [3, 9], centreDash: [3, 9], doubleCentre: true },
  uk: { yellowCentre: false, lw: 0.1, lane: [2, 7], centreDash: [4, 5], doubleCentre: false },
  eu: { yellowCentre: false, lw: 0.12, lane: [3, 6], centreDash: [3, 6], doubleCentre: false },
  jp: { yellowCentre: false, lw: 0.15, lane: [5, 5], centreDash: [5, 5], doubleCentre: false },
  au: { yellowCentre: false, lw: 0.1, lane: [3, 9], centreDash: [3, 9], doubleCentre: false },
  other: { yellowCentre: false, lw: 0.12, lane: [3, 6], centreDash: [3, 6], doubleCentre: false },
};

// ---------------------------------------------------------------- classes
// rank, lane width, default lanes (two-way total / one-way), default width when no lanes tag, speed km/h (us in mph)
const CLASSES = {
  motorway: { rank: 10, lw: 3.7, two: 4, one: 2, shoulder: 1.2, speed: 105, mph: 65 },
  motorway_link: { rank: 9, lw: 3.6, two: 2, one: 1, shoulder: 0.8, speed: 60, mph: 40 },
  trunk: { rank: 9, lw: 3.6, two: 4, one: 2, shoulder: 0.8, speed: 80, mph: 50 },
  trunk_link: { rank: 8, lw: 3.5, two: 2, one: 1, shoulder: 0.5, speed: 50, mph: 35 },
  primary: { rank: 8, lw: 3.5, two: 2, one: 2, shoulder: 0.5, speed: 50, mph: 35 },
  primary_link: { rank: 7, lw: 3.5, two: 2, one: 1, shoulder: 0.4, speed: 40, mph: 30 },
  secondary: { rank: 7, lw: 3.4, two: 2, one: 2, shoulder: 0.4, speed: 50, mph: 30 },
  secondary_link: { rank: 6, lw: 3.4, two: 2, one: 1, shoulder: 0.3, speed: 40, mph: 25 },
  tertiary: { rank: 6, lw: 3.3, two: 2, one: 1, shoulder: 0.4, speed: 40, mph: 25 },
  tertiary_link: { rank: 5, lw: 3.3, two: 2, one: 1, shoulder: 0.3, speed: 30, mph: 25 },
  unclassified: { rank: 4, lw: 3.0, two: 2, one: 1, shoulder: 0.3, speed: 40, mph: 25 },
  residential: { rank: 4, lw: 3.0, two: 2, one: 1, shoulder: 0, speed: 30, mph: 25, width: { us: 10, uk: 6.5, eu: 6.5, jp: 5, au: 8, other: 6.5 } },
  busway: { rank: 4, lw: 3.5, two: 2, one: 1, shoulder: 0.3, speed: 40, mph: 25 },
  road: { rank: 3, lw: 3.0, two: 2, one: 1, shoulder: 0, speed: 30, mph: 25 },
  living_street: { rank: 3, lw: 2.75, two: 2, one: 1, shoulder: 0, speed: 15, mph: 10, width: { us: 6, uk: 5, eu: 5, jp: 4, au: 5, other: 5 } },
  service: { rank: 2, lw: 3.0, two: 1, one: 1, shoulder: 0, speed: 20, mph: 15, width: { us: 5, uk: 4, eu: 4, jp: 3.5, au: 4.5, other: 4 } },
  raceway: { rank: 3, lw: 4, two: 2, one: 2, shoulder: 0, speed: 80, mph: 50 },
};
const URBAN_CURB = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk', 'trunk_link', 'busway']);
const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'grass', 'sand', 'mud', 'compacted', 'pebblestone', 'woodchips', 'grass_paver']);

const num = (v) => { if (v == null) return null; const m = /^\s*(-?[\d.]+)/.exec(String(v)); return m ? parseFloat(m[1]) : null; };
const yes = (v) => v != null && v !== 'no' && v !== 'false' && v !== '0';
function parseSpeed(v, region) {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|knots)?/.exec(v);
  if (!m) return null;
  const x = parseFloat(m[1]);
  return m[2] === 'mph' ? x * 1.609 : x;
}

// ---------------------------------------------------------------- state
const GROUP = new THREE.Group();
GROUP.name = 'roads';
// The working state (S) is built while the published one (LIVE) keeps answering surfaceAt, nearestLane... and its
// meshes stay drawn; publish() swaps them in one step.
function newState(prev) {
  return {
    groundAt: prev ? prev.groundAt : () => 0, scene: prev ? prev.scene : null, collide: prev ? prev.collide : null, renderer: prev ? prev.renderer : null,
    edges: [], nodes: new Map(), junctions: [], grid: new Map(), laneGrid: new Map(), edgeGrid: new Map(),
    segs: new Float64Array(0), trisA: new Float64Array(0), outlA: new Float64Array(0), pavA: new Float64Array(0),
    style: prev ? prev.style : STYLES.other, region: prev ? prev.region : 'other', leftHand: prev ? prev.leftHand : false,
    crossings: [], approaches: [], meshes: new Map(), toAdd: [], toRemove: [],
    graph: { lanes: [], nodes: new Map() }, signals: new Map(), signalGroups: new Map(), signs: [], group: GROUP,
  };
}
let S = newState(null), LIVE = S;
// yield to the frame loop every ~8 ms of work
let sliceT = 0;
let stage = '', slices = {}, busy = {};
const Y = async () => {
  const t = performance.now();
  if (t - sliceT > 8) {
    const d = t - sliceT; if (!slices[stage] || slices[stage] < d) slices[stage] = Math.round(d);
    busy[stage] = (busy[stage] || 0) + d;
    await new Promise(r => setTimeout(r, 0)); sliceT = performance.now();
  }
};
const TRACE = typeof location !== 'undefined' && /[?&]trace/.test(location.search);
const ST = (n) => { const t = performance.now(); busy[stage] = (busy[stage] || 0) + t - sliceT; sliceT = t; stage = n; if (TRACE) console.debug('[roads] ' + n); };

export let graph = { lanes: [], nodes: new Map() };
export let signals = new Map();
export let signalGroups = new Map();
export let signs = [];
export let leftHand = false;
export let style = { region: 'other', yellowCentre: false };

// ---------------------------------------------------------------- materials
let MATS = null;
function texture(file, srgb) {
  const t = new THREE.TextureLoader().load(BASE + 'textures/roads/' + file + '?v=18');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const NOISE_GLSL = `
float rdHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rdNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rdHash(i), rdHash(i + vec2(1, 0)), f.x), mix(rdHash(i + vec2(0, 1)), rdHash(i + vec2(1, 1)), f.x), f.y); }
`;
function makeMaterials() {
  const asphalt = new THREE.MeshStandardMaterial({
    map: texture('clean_asphalt_diff_1k.jpg', true), normalMap: texture('clean_asphalt_nor_gl_1k.jpg'),
    roughnessMap: texture('clean_asphalt_rough_1k.jpg'), roughness: 1, metalness: 0,
    color: new THREE.Color(1.32, 1.32, 1.3), normalScale: new THREE.Vector2(0.8, 0.8),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  asphalt.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoad;\nvarying vec2 vWXZ;\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macro = 0.86 + 0.16 * rdNoise(vWXZ * 0.045) + 0.08 * rdNoise(vWXZ * 0.21 + 7.0) + 0.04 * rdNoise(vWXZ * 1.3);
        float track = 0.0;
        if (vRoad.y > 0.5 && abs(vRoad.x) < vRoad.z) {
          float f = fract(vRoad.x / vRoad.y);
          float w = 0.33 / vRoad.y;
          track = smoothstep(w, 0.0, abs(f - 0.24)) + smoothstep(w, 0.0, abs(f - 0.76));
          track *= 0.4 + 0.9 * rdNoise(vWXZ * 0.25) * rdNoise(vWXZ * 1.7 + 11.0);
          float oil = smoothstep(0.09, 0.0, abs(f - 0.5)) * (0.4 + 0.6 * rdNoise(vWXZ * 0.8 + 3.0));
          diffuseColor.rgb *= 1.0 - 0.10 * oil;
        }
        diffuseColor.rgb *= macro * (1.0 - 0.07 * clamp(track, 0.0, 1.0));
        float rdTrack = clamp(track, 0.0, 1.0);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= 1.0 - 0.18 * rdTrack;');
  };
  asphalt.customProgramCacheKey = () => 'roads-asphalt-1';

  const paint = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.62, metalness: 0,
    normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6,
  });
  paint.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wear = rdNoise(vWXZ * 3.1) * 0.6 + rdNoise(vWXZ * 13.0) * 0.4;
        float big = rdNoise(vWXZ * 0.12);
        if (wear < 0.08 + 0.2 * big * big) discard;
        diffuseColor.rgb *= 0.86 + 0.14 * rdNoise(vWXZ * 7.0);`);
  };
  paint.customProgramCacheKey = () => 'roads-paint-1';
  // normalMap needs uvs: paint geometry carries them (world xz / 2.1)

  const curb = new THREE.MeshStandardMaterial({
    map: texture('concrete_floor_02_diff_1k.jpg', true), normalMap: texture('concrete_floor_02_nor_gl_1k.jpg'),
    roughnessMap: texture('concrete_floor_02_rough_1k.jpg'), roughness: 1, color: new THREE.Color(1.15, 1.13, 1.08),
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  curb.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float cl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(vec3(cl), diffuseColor.rgb, 0.25) * vec3(0.8, 0.8, 0.82);`);
  };
  curb.customProgramCacheKey = () => 'roads-curb-1';
  curb.side = THREE.DoubleSide;
  const cmap = texture('concrete_floor_02_diff_1k.jpg', true), cnor = texture('concrete_floor_02_nor_gl_1k.jpg'), crough = texture('concrete_floor_02_rough_1k.jpg');
  for (const t of [cmap, cnor, crough]) t.repeat.set(0.5, 0.5);
  const pave = new THREE.MeshStandardMaterial({ map: cmap, normalMap: cnor, roughnessMap: crough, roughness: 1, color: new THREE.Color(1, 1, 1), normalScale: new THREE.Vector2(0.6, 0.6),
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
  pave.onBeforeCompile = (sh) => {
    const J = S.region === 'uk' ? [0.9, 0.6] : S.region === 'jp' ? [0.3, 0.3] : [1.5, 1.5];
    const jv = 'vec2(' + J[0].toFixed(2) + ', ' + J[1].toFixed(2) + ')';
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float pl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(vec3(0.27, 0.268, 0.258), vec3(pl) * vec3(0.58, 0.57, 0.55), 0.45);
      vec2 jsz = ${jv};
      vec2 jf = abs(fract(vMapUv * 2.0 / jsz) - 0.5) * jsz;
      float jl = min(0.5 * jsz.x - jf.x, 0.5 * jsz.y - jf.y);
      diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.006, 0.018, jl));`);
  };
  pave.customProgramCacheKey = () => 'roads-pave-' + S.region;
  MATS = { asphalt, paint, curb, pave };
}

// ---------------------------------------------------------------- geometry helpers
const lerp = (a, b, t) => a + (b - a) * t;
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

// Edge samples: px, pz, ps (arc length), ph (height), nx, nz (right normal), mk (miter scale)
function sampleEdge(e) {
  const P = e.pts, px = [], pz = [], ps = [], pv = [];
  let s = 0;
  px.push(P[0][0]); pz.push(P[0][1]); ps.push(0); pv.push(1);
  for (let i = 1; i < P.length; i++) {
    const ax = P[i - 1][0], az = P[i - 1][1], bx = P[i][0], bz = P[i][1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const n = Math.max(1, Math.ceil(L / STEP));
    for (let k = 1; k <= n; k++) { const t = k / n; px.push(ax + (bx - ax) * t); pz.push(az + (bz - az) * t); ps.push(s + L * t); pv.push(k === n ? 1 : 0); }
    s += L;
  }
  const N = px.length, nx = new Array(N), nz = new Array(N), mk = new Array(N);
  for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
    // segment normals either side
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { const dx = px[i] - px[i - 1], dz = pz[i] - pz[i - 1], l = Math.hypot(dx, dz) || 1; ax = -dz / l; az = dx / l; }
    if (i < N - 1) { const dx = px[i + 1] - px[i], dz = pz[i + 1] - pz[i], l = Math.hypot(dx, dz) || 1; bx = -dz / l; bz = dx / l; }
    if (i === 0) { ax = bx; az = bz; }
    if (i === N - 1) { bx = ax; bz = az; }
    let mx = ax + bx, mz = az + bz; const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = ax; mz = az; } else { mx /= ml; mz /= ml; }
    const c = mx * ax + mz * az;
    nx[i] = mx; nz[i] = mz; mk[i] = Math.min(2.5, 1 / Math.max(0.4, c));
    void i0; void i1;
  }
  e.px = px; e.pz = pz; e.ps = ps; e.pv = pv; e.nx = nx; e.nz = nz; e.mk = mk; e.len = s;
  e.ph = new Array(N).fill(0);
  e.pc = new Array(N).fill(0);
}
function findIdx(e, s) { // last index with ps <= s
  let lo = 0, hi = e.ps.length - 1;
  if (s <= 0) return 0; if (s >= e.len) return hi - 1 >= 0 ? hi - 1 : 0;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.ps[m] <= s) lo = m; else hi = m; }
  return lo;
}
function at(e, s) {
  const N = e.ps.length;
  if (N < 2) return { x: e.px[0], z: e.pz[0], h: e.ph[0], c: e.pc[0], nx: e.nx[0], nz: e.nz[0], mk: 1, tx: 1, tz: 0, s };
  s = Math.max(0, Math.min(e.len, s));
  const i = findIdx(e, s), j = Math.min(N - 1, i + 1);
  const L = e.ps[j] - e.ps[i], t = L > 1e-6 ? (s - e.ps[i]) / L : 0;
  const tx0 = e.px[j] - e.px[i], tz0 = e.pz[j] - e.pz[i], tl = Math.hypot(tx0, tz0) || 1;
  // interior points use the segment normal (no miter); vertices keep their miter
  let nx = -tz0 / tl, nz = tx0 / tl, mk = 1;
  if (t < 1e-4) { nx = e.nx[i]; nz = e.nz[i]; mk = e.mk[i]; } else if (t > 1 - 1e-4) { nx = e.nx[j]; nz = e.nz[j]; mk = e.mk[j]; }
  return { x: lerp(e.px[i], e.px[j], t), z: lerp(e.pz[i], e.pz[j], t), h: lerp(e.ph[i], e.ph[j], t), c: lerp(e.pc[i], e.pc[j], t), nx, nz, mk, tx: tx0 / tl, tz: tz0 / tl, s };
}
// Samples between sa and sb (inclusive ends), each { x, z, h, nx, nz, mk, s }
// Fewer samples for drawing: keep the way's own vertices (where it bends) and the samples the height profile needs
// (within 2 cm of a straight line between kept ones); at most maxGap metres apart.
function sliceLite(e, sa, sb, maxGap = 60) {
  const all = slice(e, sa, sb);
  if (all.length <= 2) return all;
  const out = [all[0]];
  let k0 = 0;
  for (let i = 1; i < all.length - 1; i++) {
    const p = all[i];
    const vtx = p.i != null && e.pv[p.i] && Math.abs(e.mk[p.i] - 1) > 1e-4 || (p.i != null && e.pv[p.i] && Math.abs(e.nx[p.i] * all[k0].nx + e.nz[p.i] * all[k0].nz) < 0.99995);
    let keep = vtx || all[i + 1].s - all[k0].s > maxGap;
    if (!keep) {
      const a = all[k0], b = all[i + 1], L = b.s - a.s;
      for (let j = k0 + 1; j <= i; j++) { const t = (all[j].s - a.s) / L; if (Math.abs(a.h + (b.h - a.h) * t - all[j].h) > 0.02 || Math.abs(a.c + (b.c - a.c) * t - all[j].c) * e.c.hw > 0.02) { keep = true; break; } }
    }
    if (keep) { out.push(p); k0 = i; }
  }
  out.push(all[all.length - 1]);
  return out;
}
function slice(e, sa, sb) {
  const out = [at(e, sa)];
  for (let i = 0; i < e.ps.length; i++) if (e.ps[i] > sa + 0.05 && e.ps[i] < sb - 0.05) out.push({ x: e.px[i], z: e.pz[i], h: e.ph[i], c: e.pc[i], nx: e.nx[i], nz: e.nz[i], mk: e.mk[i], s: e.ps[i], i });
  out.push(at(e, sb));
  return out;
}

// ---------------------------------------------------------------- mesh builders (per tile)
class Builder {
  constructor(withRoad, withUV) { this.pos = []; this.nrm = []; this.uv = []; this.road = []; this.col = []; this.idx = []; this.withRoad = withRoad; this.withUV = withUV; }
  v(x, y, z, u, v, road, col, n) {
    this.pos.push(x, y, z);
    if (n) this.nrm.push(n[0], n[1], n[2]); else this.nrm.push(0, 1, 0);
    if (this.withUV) this.uv.push(u, v);
    if (this.withRoad) this.road.push(road ? road[0] : 0, road ? road[1] : 0, road ? road[2] : 0);
    if (col) this.col.push(col[0], col[1], col[2]);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.idx.push(a, b, c); }
  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withRoad) g.setAttribute('aRoad', new THREE.Float32BufferAttribute(this.road, 3));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const TILES = new Map();
let DIRTY = null; // null: every tile; else a Set of 'i,j' tiles being rebuilt
const NULLB = { v() { return 0; }, quad() {}, tri() {} };
function tileB(kind, x, z) {
  const ij = Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
  if (DIRTY && !DIRTY.has(ij)) return NULLB;
  const key = kind + ':' + ij;
  let b = TILES.get(key);
  if (!b) { b = new Builder(kind === 'road', true); b.kind = kind; TILES.set(key, b); }
  return b;
}
const UVS = 1 / 2.1; // asphalt texture tile is 2.1 m

// ---------------------------------------------------------------- topology
function classify(w, region, dense = 0, twin = null, room = null) {
  const t = w.tags, hw = w.highway;
  const C = CLASSES[hw]; if (!C) return null;
  if (t.area === 'yes') return null;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') return null;
  if (t.surface && UNPAVED.has(t.surface)) return null;
  if (hw === 'service' && (t.service === 'driveway' || t.access === 'private') && !t.lanes) { /* keep, narrow */ }
  if (t.highway === 'construction' || t.construction) return null;
  // (elevated roads, layer 2 and up on bridges, were left out here: a terrain model and their ends alone put them
  // at ground height over the streets below. bridgeDecks now raises every deck over what it crosses, lowest layer
  // first, so they are kept)
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1' ||
    t.junction === 'roundabout' || t.junction === 'circular' || ((hw === 'motorway' || hw === 'motorway_link') && t.oneway !== 'no');
  const reverse = t.oneway === '-1';
  let lanes = num(t.lanes);
  let lf = num(t['lanes:forward']), lb = num(t['lanes:backward']);
  // no lanes and no width (vector tile data): a main road in a dense city is wide (Champs-Elysees, 7th Avenue)
  if (lanes == null && lf == null && lb == null && !num(t.width)) {
    const main = hw === 'trunk' || hw === 'primary';
    if (dense >= 2 && main) { if (oneway) lanes = 5; else { lf = 3; lb = 3; } }
    else if (dense >= 2 && hw === 'secondary') { if (oneway) lanes = 4; else { lf = 2; lb = 2; } }
    else if (dense >= 1 && main) { if (oneway) lanes = 3; else { lf = 2; lb = 2; } }
  }
  if (oneway) { lf = lanes || lf || C.one; lb = 0; }
  else {
    if (lanes && lf == null && lb == null) { lf = Math.ceil(lanes / 2); lb = Math.max(1, lanes - lf); }
    if (lf == null) lf = lb != null && lanes ? Math.max(1, lanes - lb) : Math.max(1, Math.ceil(C.two / 2));
    if (lb == null) lb = lanes ? Math.max(1, lanes - lf) : Math.max(1, Math.floor(C.two / 2));
    if (hw === 'service' && !lanes && !t['lanes:forward']) { lf = 1; lb = 1; }
  }
  if (reverse) { const x = lf; lf = lb; lb = x; }
  let nLanes = oneway ? lf : lf + lb;
  let lw = C.lw;
  let width = num(t.width) || num(t['width:carriageway']);
  if (width && (width < 2 || width > 50)) width = null;
  const hasLanesTag = lanes != null || t['lanes:forward'] != null;
  if (!width) {
    if (C.width && !hasLanesTag) width = C.width[region] || C.width.other;
    else width = nLanes * lw + 2 * C.shoulder;
    if (hw === 'service' && oneway && !hasLanesTag) width = Math.min(width, 3.5);
    if (hw === 'service' && t.service === 'parking_aisle') width = 5.5;
    if (hw === 'service' && t.service === 'driveway') width = 3.2;
  }
  // no wider than the street between its buildings allows, with a pavement each side (a guessed width in a narrow
  // old street otherwise puts the outer lanes inside the houses)
  if (room != null && !num(t.width) && !num(t['width:carriageway'])) {
    // (lanes given in the map stay; lanes guessed above for a dense centre give way)
    const mapped = num(t.lanes) != null || t['lanes:forward'] != null || t['lanes:backward'] != null;
    const pav = region === 'us' ? 2.4 : 1.9, cap = room - 2 * pav, least = mapped ? nLanes * 2.75 : (oneway ? 3.2 : 5.6);
    if (width > cap) {
      width = Math.max(least, cap);
      while (nLanes > 1 && width / nLanes < 2.9 && !mapped) { if (oneway) lf--; else if (lf >= lb) lf--; else lb--; nLanes--; }
    }
  }
  // one half of a dual carriageway: no wider than the gap to the other half (their ribbons must not overlap)
  if (twin != null && !num(t.width) && width > twin - 1) {
    width = Math.max(3.2, twin - 1);
    while (nLanes > 1 && width / nLanes < 3) { if (oneway) lf--; else if (lf >= lb) lf--; else lb--; nLanes--; }
  }
  let travel = Math.min(nLanes * lw, width - 0.3);
  if (travel / nLanes < 2.5) travel = width; // narrow road: lanes fill it
  lw = travel / nLanes;
  const speed = parseSpeed(t.maxspeed, region) || (region === 'us' ? C.mph * 1.609 : (region === 'uk' ? (C.rank >= 9 ? C.mph * 1.609 : (C.rank <= 4 ? 32 : 48)) : C.speed));
  const bridge = yes(t.bridge) && t.bridge !== 'no';
  const layer = num(t.layer) || 0;
  return {
    cls: hw, rank: C.rank + (bridge ? 0 : 0), oneway, reverse, lanesF: lf, lanesB: oneway ? 0 : lb, nLanes, lw, width, hw: width / 2, travel,
    speed: speed / 3.6, bridge, layer, sidewalk: t.sidewalk || t['sidewalk:both'] || null,
    sidewalkL: t['sidewalk:left'] || null, sidewalkR: t['sidewalk:right'] || null,
    swW: num(t['sidewalk:both:width']) || num(t['sidewalk:width']) || null, swWL: num(t['sidewalk:left:width']) || null, swWR: num(t['sidewalk:right:width']) || null,
    turnF: t['turn:lanes'] || t['turn:lanes:forward'] || null, turnB: t['turn:lanes:backward'] || null,
    hasLanesTag, roundabout: t.junction === 'roundabout' || t.junction === 'circular', link: /_link$/.test(hw),
  };
}

function compatible(a, b) {
  return a.cls === b.cls && a.oneway === b.oneway && Math.abs(a.width - b.width) < 0.3 && a.lanesF === b.lanesF && a.lanesB === b.lanesB &&
    a.bridge === b.bridge && a.layer === b.layer && a.curbKey === b.curbKey && a.urban === b.urban;
}

async function buildTopology(data) {
  const region = S.region;
  // urban test: building centroids on a 100 m grid
  const bgrid = new Map();
  for (const b of data.buildings || []) {
    const p = b.outer[0]; if (!p) continue;
    const k = Math.floor(p[0] / 100) + ',' + Math.floor(p[1] / 100);
    bgrid.set(k, (bgrid.get(k) || 0) + 1);
  }
  const countAt = (x, z) => {
    const cx = Math.floor(x / 100), cz = Math.floor(z / 100); let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += bgrid.get((cx + i) + ',' + (cz + j)) || 0;
    return n;
  };
  const urbanAt = (x, z) => countAt(x, z) >= 10;
  // building walls on a 20 m grid, for how much room a street has between its buildings
  const WG = 20, walls = new Map();
  for (const b of data.buildings || []) {
    if (!b.outer || b.outer.length < 3 || b.part || (b.minHeight || 0) > 2.5 || /roof|canopy|carport/.test(b.type || '')) continue;
    const P = b.outer;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[j], c = P[i], sg = [a[0], a[1], c[0], c[1]];
      for (let gx = Math.floor(Math.min(a[0], c[0]) / WG); gx <= Math.floor(Math.max(a[0], c[0]) / WG); gx++)
        for (let gz = Math.floor(Math.min(a[1], c[1]) / WG); gz <= Math.floor(Math.max(a[1], c[1]) / WG); gz++) { const k = gx * 73856093 ^ gz * 19349663; let l = walls.get(k); if (!l) walls.set(k, l = []); l.push(sg); }
    }
  }
  // distance from (x, z) along (dx, dz) to the first wall, up to 30 m
  const rayWall = (x, z, dx, dz) => {
    let best = 30; const seen = new Set();
    for (let d = 0; d <= 30; d += 10) {
      const k = Math.floor((x + dx * d) / WG) * 73856093 ^ Math.floor((z + dz * d) / WG) * 19349663;
      const l = walls.get(k); if (!l || seen.has(k)) continue; seen.add(k);
      for (const sg of l) {
        const ex = sg[2] - sg[0], ez = sg[3] - sg[1], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
        const qx = sg[0] - x, qz = sg[1] - z, t = (qx * ez - qz * ex) / den, u = (qx * dz - qz * dx) / den;
        if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
      }
    }
    return best;
  };
  // the room between buildings along a way: a low percentile of (left + right) over samples with walls both sides
  const roomOf = (pts) => {
    if (!walls.size || !pts || pts.length < 2) return null;
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const n = Math.min(40, Math.max(2, Math.floor(L / 10))), got = [], gl = [], gr = [];
    let k = 1, acc = 0;
    for (let m = 0; m < n; m++) {
      const s = L * (m + 0.5) / n;
      while (k < pts.length - 1 && acc + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) < s) { acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); k++; }
      const a = pts[k - 1], c = pts[k], sl = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, t = Math.max(0, Math.min(1, (s - acc) / sl));
      const x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t, tx = (c[0] - a[0]) / sl, tz = (c[1] - a[1]) / sl;
      // (left of the way's direction is (tz, -tx) here: +x east, +z south)
      const l = rayWall(x, z, tz, -tx), r = rayWall(x, z, -tz, tx);
      if (l < 30 && r < 30) got.push(l + r);
      if (l < 30) gl.push(l);
      if (r < 30) gr.push(r);
    }
    const pct = a => { if (a.length < 2 || a.length < n * 0.4) return null; a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.3)]; };
    const left = pct(gl), right = pct(gr);
    if (got.length < 2 || got.length < n * 0.25) return { room: null, left, right };
    got.sort((p, q) => p - q);
    return { room: got[Math.floor(got.length * 0.3)], left, right };
  };
  const nodePos = data.nodes || new Map();
  const twins = findTwins(data.roads || []);
  const ways = [];
  for (const w of data.roads || []) {
    await Y();
    // the busiest stretch of the way decides (a long avenue's middle may lie outside the loaded area)
    let nb = 0; if (w.pts && w.pts.length) for (let k = 0; k <= 8; k++) { const q = w.pts[Math.round(k / 8 * (w.pts.length - 1))]; nb = Math.max(nb, countAt(q[0], q[1])); }
    const rm = nb >= 10 ? roomOf(w.pts) : null;
    const c = classify(w, region, nb >= 40 ? 2 : nb >= 10 ? 1 : 0, twins.get(w.id) ?? null, rm ? rm.room : null); if (!c || w.nodes.length < 2) continue;
    let nodes = w.nodes.slice();
    if (c.reverse) nodes.reverse();
    const pts = []; const ids = [];
    for (const id of nodes) { const n = nodePos.get(id); if (n && (!ids.length || ids[ids.length - 1] !== id)) { pts.push([n.x, n.z]); ids.push(id); } }
    if (ids.length < 2) continue;
    const mid = pts[pts.length >> 1];
    c.urban = urbanAt(mid[0], mid[1]);
    const sw = c.sidewalk;
    const noSw = (v) => v === 'no' || v === 'none';
    let curbL = false, curbR = false;
    if (c.urban && URBAN_CURB.has(c.cls) || (sw && !noSw(sw))) {
      if (sw === 'left') curbL = true; else if (sw === 'right') curbR = true;
      else if (noSw(sw)) { curbL = curbR = false; } else { curbL = curbR = true; }
      if (c.sidewalkL) curbL = !noSw(c.sidewalkL); if (c.sidewalkR) curbR = !noSw(c.sidewalkR);
      if (c.cls === 'service' && !sw) curbL = curbR = false;
    }
    if (c.reverse) { const x = curbL; curbL = curbR; curbR = x; }
    if (c.roundabout) { curbL = curbR && c.urban; }
    c.curbL = curbL; c.curbR = curbR; c.curbKey = (curbL ? 1 : 0) + (curbR ? 2 : 0);
    const defW = c.rank >= 8 && c.urban ? 4.2 : c.rank >= 7 && c.urban ? 3.6 : region === 'jp' ? 2.0 : 2.4;
    const tagL = c.swWL || c.swW, tagR = c.swWR || c.swW;
    c.swWL = Math.max(1, Math.min(8, tagL || defW)); c.swWR = Math.max(1, Math.min(8, tagR || defW));
    // in a built-up street the pavement runs to the buildings (else a strip of bare satellite ground lies between)
    if (rm && c.urban) {
      if (!tagL && rm.left != null && rm.left - c.hw < 9) c.swWL = Math.max(c.swWL, Math.min(8, rm.left - c.hw - 0.2));
      if (!tagR && rm.right != null && rm.right - c.hw < 9) c.swWR = Math.max(c.swWR, Math.min(8, rm.right - c.hw - 0.2));
    }
    if (c.reverse) { const x = c.swWL; c.swWL = c.swWR; c.swWR = x; }
    ways.push({ id: w.id, tags: w.tags, wayDir: c.reverse ? -1 : 1, ids, pts, c });
  }
  // roads that cross on the same level without sharing a node (vector tiles lose some, OSM has errors) get a
  // junction where they cross, so the two surfaces meet at one height instead of overlapping
  const extra = joinCrossings(ways);
  // node occurrences
  const occ = new Map();
  for (const w of ways) w.ids.forEach((id, i) => {
    const isEnd = i === 0 || i === w.ids.length - 1;
    const o = occ.get(id) || { n: 0, ends: 0 }; o.n++; if (isEnd) o.ends++; occ.set(id, o);
  });
  // split ways at shared nodes
  let edges = [];
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.ids.length; i++) {
      const o = occ.get(w.ids[i]);
      const last = i === w.ids.length - 1;
      const closedLoopMid = w.ids[0] === w.ids[w.ids.length - 1] && i === Math.floor(w.ids.length / 2) && !last;
      if (o.n > 1 || last || closedLoopMid) {
        edges.push({ way: w, ids: w.ids.slice(start, i + 1), pts: w.pts.slice(start, i + 1), c: Object.assign({}, w.c), wayDir: w.wayDir });
        start = i;
      }
    }
  }
  // merge chains through degree-2 nodes with compatible attributes
  const ends = new Map(); // node -> [{e, atStart}]
  const addEnd = (e) => {
    for (const [id, atStart] of [[e.ids[0], true], [e.ids[e.ids.length - 1], false]]) {
      let l = ends.get(id); if (!l) ends.set(id, l = []); l.push({ e, atStart });
    }
  };
  edges.forEach(addEnd);
  const dead = new Set();
  for (const [id, l] of ends) {
    if (l.length !== 2) continue;
    const [A, B] = l; if (A.e === B.e || dead.has(A.e) || dead.has(B.e)) continue;
    const a = A.e, b = B.e;
    if (!compatible(a.c, b.c)) continue;
    // orient: a must end at id, b must start at id
    const flipOk = (e) => !e.c.oneway;
    let aa = a, bb = b;
    if (A.atStart) { if (!flipOk(aa)) { if (!B.atStart) { [aa, bb] = [b, a]; } else continue; } }
    // recompute after possible swap
    const aEndsHere = aa.ids[aa.ids.length - 1] === id, bStartsHere = bb.ids[0] === id;
    if (!aEndsHere) { if (!flipOk(aa)) continue; reverseEdge(aa); }
    if (!bStartsHere) { if (!flipOk(bb)) continue; reverseEdge(bb); }
    if (aa.ids[aa.ids.length - 1] !== id || bb.ids[0] !== id) continue;
    // merge bb into aa
    aa.ids = aa.ids.concat(bb.ids.slice(1)); aa.pts = aa.pts.concat(bb.pts.slice(1));
    dead.add(bb);
    // fix end lists for bb's far end
    const far = bb.ids[bb.ids.length - 1];
    const fl = ends.get(far);
    if (fl) for (const r of fl) if (r.e === bb) { r.e = aa; r.atStart = false; }
    for (const r of l) r.e = aa; // stale but harmless
    if (aa.ids[0] === aa.ids[aa.ids.length - 1]) { /* closed loop (roundabout) stays one edge */ }
  }
  edges = edges.filter(e => !dead.has(e));
  // a closed loop edge with no other connections: split in half so it has two junction-free ends that meet
  for (let i = 0; i < edges.length; i++) { edges[i].id = i; sampleEdge(edges[i]); await Y(); }
  // node table
  const nodes = new Map();
  for (const e of edges) {
    for (const [id, atStart] of [[e.ids[0], true], [e.ids[e.ids.length - 1], false]]) {
      let n = nodes.get(id);
      if (!n) { const p = nodePos.get(id) || extra.get(id); nodes.set(id, n = { id, x: p.x, z: p.z, ends: [], h: 0, tags: p.tags || null }); }
      n.ends.push({ e, atStart });
    }
  }
  S.edges = edges; S.nodes = nodes;
}
// Halves of dual carriageways: a one-way main road with another one-way road of the same class running the other
// way beside it. Returns way id -> distance between their centre lines (median along the way).
function findTwins(list) {
  const isOne = (w) => w.tags.oneway === 'yes' || w.tags.oneway === '1' || w.tags.oneway === 'true' || w.tags.oneway === '-1';
  const cand = list.filter(w => /^(motorway|trunk|primary|secondary|tertiary)$/.test(w.highway) && isOne(w) && w.pts && w.pts.length >= 2);
  const g = new Map(), C = 40, out = new Map();
  cand.forEach((w, wi) => { for (let i = 1; i < w.pts.length; i++) { const a = w.pts[i - 1], b = w.pts[i]; const k = Math.floor((a[0] + b[0]) / 2 / C) + ',' + Math.floor((a[1] + b[1]) / 2 / C); let l = g.get(k); if (!l) g.set(k, l = []); l.push([wi, i]); } });
  const dirOf = (w, i) => { const a = w.pts[i - 1], b = w.pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, s = w.tags.oneway === '-1' ? -1 : 1; return [s * (b[0] - a[0]) / l, s * (b[1] - a[1]) / l]; };
  cand.forEach((w) => {
    const ds = [], n = w.pts.length - 1, step = Math.max(1, Math.floor(n / 6));
    for (let i = 1; i <= n; i += step) {
      const a = w.pts[i - 1], b = w.pts[i], px = (a[0] + b[0]) / 2, pz = (a[1] + b[1]) / 2, d = dirOf(w, i);
      let best = Infinity;
      const ci = Math.floor(px / C), cj = Math.floor(pz / C);
      for (let x = ci - 1; x <= ci + 1; x++) for (let z = cj - 1; z <= cj + 1; z++) for (const [oi, k] of g.get(x + ',' + z) || []) {
        const o = cand[oi]; if (o === w || o.highway !== w.highway) continue;
        const q = dirOf(o, k); if (q[0] * d[0] + q[1] * d[1] > -0.8) continue;
        const u = o.pts[k - 1], v = o.pts[k], dx = v[0] - u[0], dz = v[1] - u[1], L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - u[0]) * dx + (pz - u[1]) * dz) / L2)) : 0;
        const dist = Math.hypot(px - u[0] - dx * t, pz - u[1] - dz * t);
        if (dist < best && dist < 40) best = dist;
      }
      if (best < Infinity) ds.push(best);
    }
    if (ds.length * 2 >= Math.ceil(n / step)) { ds.sort((p, q) => p - q); out.set(w.id, ds[ds.length >> 1]); }
  });
  return out;
}
let joinId = -9e12;
function joinCrossings(ways) {
  const extra = new Map(), grid = new Map(), C = 24;
  const level = (w) => w.c.bridge ? 'b' + w.c.layer : 'g';
  ways.forEach((w, wi) => {
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1], b = w.pts[i];
      const i0 = Math.floor(Math.min(a[0], b[0]) / C), i1 = Math.floor(Math.max(a[0], b[0]) / C), j0 = Math.floor(Math.min(a[1], b[1]) / C), j1 = Math.floor(Math.max(a[1], b[1]) / C);
      for (let x = i0; x <= i1; x++) for (let z = j0; z <= j1; z++) { const k = x + ',' + z; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push([wi, i]); }
    }
  });
  const cuts = ways.map(() => []), seen = new Set();
  for (const l of grid.values()) {
    for (let p = 0; p < l.length; p++) for (let q = p + 1; q < l.length; q++) {
      const [wa, ia] = l[p], [wb, ib] = l[q];
      if (wa === wb) continue;
      const key = wa < wb ? wa + ':' + ia + ':' + wb + ':' + ib : wb + ':' + ib + ':' + wa + ':' + ia;
      if (seen.has(key)) continue; seen.add(key);
      const A = ways[wa], B = ways[wb];
      if (level(A) !== level(B)) continue;
      const a0 = A.pts[ia - 1], a1 = A.pts[ia], b0 = B.pts[ib - 1], b1 = B.pts[ib];
      // segments sharing a node already meet
      if (A.ids[ia - 1] === B.ids[ib - 1] || A.ids[ia - 1] === B.ids[ib] || A.ids[ia] === B.ids[ib - 1] || A.ids[ia] === B.ids[ib]) continue;
      const rx = a1[0] - a0[0], rz = a1[1] - a0[1], sx = b1[0] - b0[0], sz = b1[1] - b0[1];
      const den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
      const qx = b0[0] - a0[0], qz = b0[1] - a0[1];
      const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
      if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
      const x = a0[0] + rx * t, z = a0[1] + rz * t;
      const id = joinId--;
      extra.set(id, { id, x, z, tags: null });
      cuts[wa].push([ia, t, id, x, z]); cuts[wb].push([ib, u, id, x, z]);
    }
  }
  ways.forEach((w, wi) => {
    const cs = cuts[wi]; if (!cs.length) return;
    cs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const ids = [w.ids[0]], pts = [w.pts[0]];
    let k = 0;
    for (let i = 1; i < w.pts.length; i++) {
      while (k < cs.length && cs[k][0] === i) { ids.push(cs[k][2]); pts.push([cs[k][3], cs[k][4]]); k++; }
      ids.push(w.ids[i]); pts.push(w.pts[i]);
    }
    w.ids = ids; w.pts = pts;
  });
  return extra;
}
function reverseEdge(e) {
  e.ids.reverse(); e.pts.reverse(); e.wayDir = -e.wayDir;
  const c = e.c; const x = c.lanesF; c.lanesF = c.lanesB; c.lanesB = x;
  const y = c.curbL; c.curbL = c.curbR; c.curbR = y;
  const w = c.swWL; c.swWL = c.swWR; c.swWR = w;
  const t = c.turnF; c.turnF = c.turnB; c.turnB = t;
}

// ---------------------------------------------------------------- junction shapes
function endInfo(n, end) {
  const e = end.e, look = Math.min(6, e.len * 0.5);
  const p0 = end.atStart ? at(e, 0) : at(e, e.len), p1 = end.atStart ? at(e, look) : at(e, e.len - look);
  let dx = p1.x - p0.x, dz = p1.z - p0.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  return { e, atStart: end.atStart, dx, dz, w: e.c.hw, ang: Math.atan2(dz, dx) };
}
async function buildJunctions() {
  const J = [];
  for (const n of S.nodes.values()) {
    for (const end of n.ends) { if (end.atStart) end.e.set0 = 0; else end.e.set1 = 0; }
  }
  for (const n of S.nodes.values()) {
    if (n.ends.length < 2) continue;
    await Y();
    const E = n.ends.map(end => endInfo(n, end)).sort((a, b) => a.ang - b.ang);
    const k = E.length;
    const urban = E.some(x => x.e.c.urban);
    const R = urban ? 2.5 : 4;
    for (const x of E) { x.need = 0; x.corner = false; }
    const pairs = [];
    for (let i = 0; i < k; i++) {
      const a = E[i], b = E[(i + 1) % k];
      let gap = b.ang - a.ang; if (gap <= 0) gap += Math.PI * 2;
      if (k === 2 && i === 1) gap = Math.PI * 2 - (E[1].ang - E[0].ang);
      const pr = { a, b, gap, c: null };
      if (Math.abs(gap - Math.PI) > 0.3 && gap < Math.PI) {
        // inner corner: intersect a's +side boundary with b's -side boundary
        const nax = -a.dz, naz = a.dx, nbx = b.dz, nbz = -b.dx;
        const rx = b.w * nbx - a.w * nax, rz = b.w * nbz - a.w * naz;
        const det = -a.dx * b.dz + b.dx * a.dz;
        const t = Math.abs(det) > 0.03 ? (-rx * b.dz + b.dx * rz) / det : Infinity, u = Math.abs(det) > 0.03 ? (a.dx * rz - a.dz * rx) / det : Infinity;
        const lim = Math.min(40, 3 * Math.max(a.w, b.w) + 10);
        if (t >= -0.5 && u >= -0.5 && t <= lim && u <= lim) {
          let tc = Math.max(0, t), uc = Math.max(0, u);
          // (a narrow road peeling off a wide one at a sharp angle used to tuck under it to keep the wide road's
          // markings; on hills the two diverge in height, so the whole fork is junction now)
          a.need = Math.max(a.need, tc); b.need = Math.max(b.need, uc);
          a.corner = b.corner = true;
          pr.c = [n.x + a.w * nax + tc * a.dx, n.z + a.w * naz + tc * a.dz]; pr.tc = tc; pr.uc = uc;
        } else {
          a.need = Math.max(a.need, Math.min(isFinite(t) ? Math.max(0, t) : 0, 2 * a.w));
          b.need = Math.max(b.need, Math.min(isFinite(u) ? Math.max(0, u) : 0, 2 * b.w));
        }
      }
      pairs.push(pr);
    }
    for (const x of E) {
      let sb = x.need + (x.corner ? R : 0.3);
      if (k > 2) sb = Math.max(sb, 1.0);
      const e = x.e, other = x.atStart ? (S.nodes.get(e.ids[e.ids.length - 1]).ends.length > 1) : (S.nodes.get(e.ids[0]).ends.length > 1);
      sb = Math.min(sb, other ? e.len * 0.5 : e.len - 0.5, 40);
      x.sb = Math.max(0.05, sb);
      if (x.atStart) e.set0 = x.sb; else e.set1 = x.sb;
    }
    J.push({ n, E, pairs, R });
  }
  // shrink setbacks that overlap on short edges
  for (const e of S.edges) {
    e.set0 = e.set0 || 0; e.set1 = e.set1 || 0;
    const tot = e.set0 + e.set1;
    if (tot > e.len - 0.1 && tot > 0) { const f = Math.max(0, e.len - 0.1) / tot; e.set0 *= f; e.set1 *= f; }
  }
  for (const j of J) for (const x of j.E) x.sb = x.atStart ? x.e.set0 : x.e.set1;
  S.junctions = J;
}

// Outline of a junction: [{x, z, h, curb}] where curb says the segment from this point to the next is a curb.
function junctionOutline(j) {
  const out = [];
  const { E, pairs, n } = j;
  const side = (x, plus) => { // point on x's boundary at its setback, plus side = toward next end
    const e = x.e, s = x.atStart ? x.sb : e.len - x.sb, p = at(e, s);
    const sgn = (x.atStart ? 1 : -1) * (plus ? 1 : -1);
    return { x: p.x + p.nx * p.mk * x.w * sgn, z: p.z + p.nz * p.mk * x.w * sgn, h: p.h + (p.c || 0) * p.mk * x.w * sgn };
  };
  const curbSide = (x, plus) => { const c = x.e.c; return (x.atStart === plus) ? c.curbR : c.curbL; };
  for (let i = 0; i < E.length; i++) {
    const a = E[i], b = E[(i + 1) % E.length], pr = pairs[i];
    const A = side(a, true), B = side(b, false);
    const am = side(a, false);
    // between two cut points the outline lies on the junction's plane (exact at both ends)
    const onPlane = (x, z, t) => n.plane ? planeAt(n, x, z) + lerp(A.h - planeAt(n, A.x, A.z), B.h - planeAt(n, B.x, B.z), t) : lerp(A.h, B.h, t);
    out.push({ ...am, curb: false, cut: true }); // across a's cut line
    const curb = curbSide(a, true) && curbSide(b, false);
    out.push({ ...A, curb });
    // corner from A to B
    if (pr.c && a.sb >= pr.tc - 0.05 && b.sb >= pr.uc - 0.05) {
      const C = pr.c, steps = 6;
      for (let s = 1; s < steps; s++) {
        const t = s / steps, u = 1 - t;
        const x = u * u * A.x + 2 * u * t * C[0] + t * t * B.x, z = u * u * A.z + 2 * u * t * C[1] + t * t * B.z;
        out.push({ x, z, h: onPlane(x, z, t), curb });
      }
    } else if (pr.gap > Math.PI + 0.3) {
      // outer side of a bend: arc around the node
      const r = Math.max(a.w, b.w);
      const a0 = Math.atan2(a.dx, -a.dz), a1 = Math.atan2(-b.dx, b.dz); // angles of a's + normal and b's - normal
      let da = a1 - a0; while (da < 0) da += Math.PI * 2; while (da > Math.PI * 2) da -= Math.PI * 2;
      const steps = Math.max(2, Math.ceil(da / 0.35));
      for (let s = 1; s < steps; s++) {
        const ang = a0 + da * s / steps;
        const x = n.x + Math.cos(ang) * r, z = n.z + Math.sin(ang) * r;
        out.push({ x, z, h: onPlane(x, z, s / steps), curb });
      }
    }
    // B is pushed as b's "minus" point at the next loop step
  }
  return out;
}

// ---------------------------------------------------------------- heights
function sampleGround(x, z) { const h = S.groundAt(x, z); return (h == null || !isFinite(h)) ? null : h; }
function pct(arr, p) { if (!arr.length) return null; arr.sort((a, b) => a - b); return arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1) + 0.5))]; }

function nodeHeight(n) {
  const r = Math.max(2, Math.max(...n.ends.map(x => x.e.c.hw)) * 0.8);
  const v = [];
  const g = sampleGround(n.x, n.z); if (g != null) v.push(g);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; const h = sampleGround(n.x + Math.cos(a) * r, n.z + Math.sin(a) * r); if (h != null) v.push(h); }
  return v.length ? pct(v, 0.3) : null;
}
function profileHeights(e) {
  const N = e.px.length, raw = new Array(N).fill(null), mid = new Array(N).fill(null);
  const w = e.c.hw * 0.8, offs = [-w, -w * 0.45, 0, w * 0.45, w];
  const open = S.smooth; // the open world's ground is a smooth terrain model: no cars or bumps to filter out
  for (let i = 0; i < N; i++) {
    const v = [];
    for (let k = 0; k < offs.length; k++) {
      const o = offs[k], h = sampleGround(e.px[i] + e.nx[i] * o, e.pz[i] + e.nz[i] * o);
      if (h != null) { v.push(h); if (k === 2) mid[i] = h; }
    }
    raw[i] = v.length ? pct(v, open ? 0.5 : S.pct) : null;
  }
  // fill gaps
  if (!raw.some(v => v != null)) return null;
  for (let i = 0; i < N; i++) if (raw[i] == null) {
    let a = i - 1; while (a >= 0 && raw[a] == null) a--; let b = i + 1; while (b < N && raw[b] == null) b++;
    raw[i] = a < 0 ? raw[b] : b >= N ? raw[a] : lerp(raw[a], raw[b], (i - a) / (b - a));
  }
  // photogrammetry: a robust window (30th percentile over +-6 m) takes out cars and bumps; then a gaussian
  let lo = raw;
  if (!open) {
    lo = new Array(N);
    for (let i = 0; i < N; i++) {
      const v = []; for (let k = i; k >= 0 && e.ps[i] - e.ps[k] <= 6; k--) v.push(raw[k]);
      for (let k = i + 1; k < N && e.ps[k] - e.ps[i] <= 6; k++) v.push(raw[k]);
      lo[i] = pct(v, 0.3);
    }
  }
  const out = new Array(N), R = open ? 14 : 7, R2 = open ? 72 : 18;
  for (let i = 0; i < N; i++) {
    let sw = 0, sh = 0;
    for (let k = i; k >= 0 && e.ps[i] - e.ps[k] <= R; k--) { const d = e.ps[i] - e.ps[k], wt = Math.exp(-d * d / R2); sw += wt; sh += wt * lo[k]; }
    for (let k = i + 1; k < N && e.ps[k] - e.ps[i] <= R; k++) { const d = e.ps[k] - e.ps[i], wt = Math.exp(-d * d / R2); sw += wt; sh += wt * lo[k]; }
    out[i] = sh / sw;
  }
  if (open) {
    // the long smoothing irons out bumps the terrain model has from buildings; it may not put the road more than
    // 1 m under the terrain smoothed over a few metres (the crest of a real hill)
    for (let i = 0; i < N; i++) {
      let sw = 0, sh = 0;
      for (let k = i; k >= 0 && e.ps[i] - e.ps[k] <= 4; k--) { const d = e.ps[i] - e.ps[k], wt = Math.exp(-d * d / 8); sw += wt; sh += wt * (mid[k] != null ? mid[k] : raw[k]); }
      for (let k = i + 1; k < N && e.ps[k] - e.ps[i] <= 4; k++) { const d = e.ps[k] - e.ps[i], wt = Math.exp(-d * d / 8); sw += wt; sh += wt * (mid[k] != null ? mid[k] : raw[k]); }
      const g = sh / sw - 1.0; if (out[i] < g) out[i] = g;
    }
  }
  return out;
}
// Overlapping ribbons of unconnected roads would fight in depth: lift each class a few millimetres apart.
const rankBias = (e) => e.c.rank * 0.004 + (e.c.bridge ? 0.02 : 0);
// Ground samples kept between builds (a rebuild as the car drives on mostly sees the same roads): road profiles
// by the edge's node list. A reheight re-samples its box and overwrites them.
const PCACHE = new Map();
const profAt = (e, s) => {
  const P = e.prof; if (!P) return null;
  const i = findIdx(e, s), j = Math.min(P.length - 1, i + 1), L = e.ps[j] - e.ps[i];
  return L > 1e-6 ? lerp(P[i], P[j], Math.max(0, Math.min(1, (s - e.ps[i]) / L))) : P[i];
};
const planeAt = (n, x, z) => n.plane ? n.plane[0] + n.plane[1] * (x - n.x) + n.plane[2] * (z - n.z) : n.h;

// A junction is a plane fitted through the roads that meet there (sampled just outside it, the bigger roads
// weighing more), so it slopes with the hill; every road blends from that plane at the junction's edge to its own
// profile over the next metres, so the road and the junction meet at exactly the same height.
function fitPlane(n) {
  let sw = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (const x of n.ends) {
    const e = x.e; if (e.c.bridge || !e.prof) continue;
    const wt = e.c.rank * e.c.rank;
    const sb = x.atStart ? e.set0 : e.set1;
    for (const d of [0, 3, 6, 9]) {
      const sl = sb + d; if (sl > e.len) break;
      const s = x.atStart ? sl : e.len - sl, p = at(e, s), h = profAt(e, s);
      const dx = p.x - n.x, dz = p.z - n.z;
      sw += wt; sx += wt * dx; sz += wt * dz; sh += wt * h; sxx += wt * dx * dx; szz += wt * dz * dz; sxz += wt * dx * dz; sxh += wt * dx * h; szh += wt * dz * h;
    }
  }
  if (sw <= 0) return null;
  // weighted least squares h = a + b dx + c dz, with a little ridge on the slopes for straight-through nodes
  const lam = 0.5 * sw;
  const M = [[sw, sx, sz], [sx, sxx + lam, sxz], [sz, sxz, szz + lam]], V = [sh, sxh, szh];
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M); if (Math.abs(D) < 1e-9) return [sh / sw, 0, 0];
  const col = (k) => M.map((r, i) => r.map((v, j) => j === k ? V[i] : v));
  let a = det3(col(0)) / D, b = det3(col(1)) / D, c = det3(col(2)) / D;
  const g = Math.hypot(b, c); if (g > 0.25) { b *= 0.25 / g; c *= 0.25 / g; a = (sh - b * sx - c * sz) / sw; }
  return [a, b, c];
}

async function computeHeights(bbox) {
  const inBox = (x, z, m = 30) => !bbox || (x >= bbox.x0 - m && x <= bbox.x1 + m && z >= bbox.z0 - m && z <= bbox.z1 + m);
  if (PCACHE.size > 20000) PCACHE.clear();
  const nodes = S.nodes;
  const edgeIn = (e) => {
    for (let i = 0; i < e.px.length; i += 4) if (inBox(e.px[i], e.pz[i])) return true;
    const n0 = nodes.get(e.ids[0]), n1 = nodes.get(e.ids[e.ids.length - 1]);
    return inBox(n0.x, n0.z) || inBox(n1.x, n1.z);
  };
  // 1. each road's own profile from the ground
  for (const e of S.edges) {
    if (e.c.bridge || !edgeIn(e)) continue;
    await Y();
    const key = e.ids.join(',') + ':' + e.px.length + ':' + e.c.width + (S.smooth ? 'o' : 'p');
    let prof = !bbox ? PCACHE.get(key) : undefined;
    if (!prof) { prof = profileHeights(e); if (prof) PCACHE.set(key, prof); }
    e.guessed = !prof;
    if (prof) e.prof = prof;
    else if (!e.prof) e.prof = null;
  }
  // 2. junction planes and node heights
  for (const n of nodes.values()) {
    if (!inBox(n.x, n.z, 60)) continue;
    await Y();
    // a bridge's own dead end (where the loaded data stops, often over a hill or water) does not anchor it
    n.anchor = n.ends.some(x => !x.e.c.bridge);
    if (!n.anchor) continue;
    n.plane = null;
    if (n.ends.length >= 2) {
      const pl = fitPlane(n);
      if (pl) { n.plane = pl; n.h = pl[0]; n.known = true; continue; }
    }
    const x = n.ends.find(x => !x.e.c.bridge && x.e.prof);
    if (x) { n.h = x.atStart ? x.e.prof[0] : x.e.prof[x.e.prof.length - 1]; n.known = true; }
    else { const g = sampleGround(n.x, n.z); if (g != null) { n.h = g; n.known = true; } else n.h = n.h || 0; }
  }
  // 2b. a terrain model with buildings in it (parts of Asia) or a bad patch can put two junctions of one street
  // 30 m apart over 50 m: pull such junctions towards each other until no road between junctions is steeper than
  // NET_GRADE (a few sweeps over the network), so the road climbs evenly and stays drivable
  for (let it = 0; it < 24; it++) {
    let moved = 0;
    for (const e of S.edges) {
      if (e.c.bridge) continue;
      const n0 = nodes.get(e.ids[0]), n1 = nodes.get(e.ids[e.ids.length - 1]);
      if (n0 === n1 || !n0.anchor || !n1.anchor) continue;
      const allowed = NET_GRADE * Math.max(1, e.len), d = n1.h - n0.h;
      if (Math.abs(d) <= allowed) continue;
      const ex = (Math.abs(d) - allowed) / 2 * Math.sign(d);
      const f0 = n0.ends.length === 1 ? 2 : 1, f1 = n1.ends.length === 1 ? 2 : 1; // a dead end gives way more
      n0.h += ex * f0 / (f0 + f1) * 2 * 0.5 * 1.0; n1.h -= ex * f1 / (f0 + f1) * 2 * 0.5 * 1.0;
      moved++;
    }
    if (!moved) break;
    await Y();
  }
  for (const n of nodes.values()) if (n.plane) n.plane[0] = n.h;
  // 2c. junctions whose shapes overlap (close crossings, dual carriageways) share one plane, so where their
  // polygons overlap both give the same height
  {
    const jn = [...nodes.values()].filter(n => n.plane && inBox(n.x, n.z, 120));
    const rad = (n) => { let r = 0; for (const x of n.ends) r = Math.max(r, (x.atStart ? x.e.set0 : x.e.set1) + x.e.c.hw); return r; };
    const par = new Map(jn.map(n => [n, n])), find = (n) => { while (par.get(n) !== n) { par.set(n, par.get(par.get(n))); n = par.get(n); } return n; };
    const g = new Map(), C = 40;
    for (const n of jn) { n._r = rad(n); const k = Math.floor(n.x / C) + ',' + Math.floor(n.z / C); let l = g.get(k); if (!l) g.set(k, l = []); l.push(n); }
    for (const n of jn) {
      const i0 = Math.floor(n.x / C), j0 = Math.floor(n.z / C);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const m of g.get(i + ',' + j) || []) {
        if (m === n) continue;
        if (Math.hypot(m.x - n.x, m.z - n.z) < n._r + m._r) { const a = find(n), b = find(m); if (a !== b) par.set(a, b); }
      }
    }
    const groups = new Map();
    for (const n of jn) { const r = find(n); let l = groups.get(r); if (!l) groups.set(r, l = []); l.push(n); }
    for (const l of groups.values()) {
      if (l.length < 2) continue;
      let cx = 0, cz = 0, b = 0, c = 0;
      for (const n of l) { cx += n.x; cz += n.z; b += n.plane[1]; c += n.plane[2]; }
      cx /= l.length; cz /= l.length; b /= l.length; c /= l.length;
      let a = 0; for (const n of l) a += n.h + b * (cx - n.x) + c * (cz - n.z); a /= l.length;
      for (const n of l) { n.plane = [a + b * (n.x - cx) + c * (n.z - cz), b, c]; n.h = n.plane[0]; }
    }
  }
  // 3. bridge-only nodes: inverse distance over anchors through the bridge network (linear along a chain)
  for (const n of nodes.values()) {
    if (n.anchor || !inBox(n.x, n.z, 60)) continue;
    n.plane = null;
    const dist = new Map([[n.id, 0]]), queue = [n.id], found = [], soft = [];
    const bb = S.data && S.data.bbox, inData = (m) => !bb || (m.x >= bb.x0 && m.x <= bb.x1 && m.z >= bb.z0 && m.z <= bb.z1);
    while (queue.length) {
      queue.sort((a, b) => dist.get(b) - dist.get(a));
      const id = queue.pop(), d = dist.get(id), m = nodes.get(id);
      if (m.anchor && id !== n.id) { found.push([m.h, d]); continue; }
      // a bridge's dead end inside the loaded area: its ground, used only if no road on the ground joins the bridge
      if (m.ends.length === 1) { const g = sampleGround(m.x, m.z); if (g != null) soft.push([g, d, inData(m)]); }
      for (const x of m.ends) {
        if (!x.e.c.bridge) continue;
        const o = x.atStart ? x.e.ids[x.e.ids.length - 1] : x.e.ids[0], nd = d + x.e.len;
        if (!dist.has(o) || dist.get(o) > nd) { dist.set(o, nd); queue.push(o); }
      }
    }
    if (found.length) { let a = 0, b = 0; for (const [h, d] of found) { a += h / Math.max(d, 1); b += 1 / Math.max(d, 1); } n.h = a / b; }
    else if (soft.length) {
      // a bridge no ground road joins (a long crossing cut off by the loaded area): one level deck at the
      // height of its end inside the loaded area (the highest such end if several: the other ends are where the
      // data was cut, over water or a valley, and their ground is far under the deck)
      const softIn = soft.filter(q => q[2]), pool = softIn.length ? softIn : soft;
      n.h = Math.max(...pool.map(q => q[0]));
    } else { const g = sampleGround(n.x, n.z); if (g != null) n.h = g; }
    // the height this node had when its bridge was first built in this drive, if it was: kept (deckMem)
    n.frozen = false;
    if (S.smooth) { const m = deckMem().get(deckKey(n)); if (m != null) { n.h = m; n.frozen = true; } }
  }
  // junctions by place, for roads that pass over a junction they do not belong to
  const jg = new Map(), JC = 40;
  for (const n of nodes.values()) {
    if (!n.plane || n.ends.length < 2) continue;
    if (n._r == null) { let r = 0; for (const x of n.ends) r = Math.max(r, (x.atStart ? x.e.set0 : x.e.set1) + x.e.c.hw); n._r = r; }
    const k = Math.floor(n.x / JC) + ',' + Math.floor(n.z / JC); let l = jg.get(k); if (!l) jg.set(k, l = []); l.push(n);
  }
  // 4. final heights: from the junction plane at each cut to the road's own profile
  for (const e of S.edges) {
    if (!edgeIn(e)) continue;
    await Y();
    const n0 = nodes.get(e.ids[0]), n1 = nodes.get(e.ids[e.ids.length - 1]);
    const N = e.px.length, bias = rankBias(e);
    if (e.c.bridge) {
      // straight between the planes of the junctions at its ends
      const h0 = planeAt(n0, e.px[0], e.pz[0]), h1 = planeAt(n1, e.px[N - 1], e.pz[N - 1]);
      for (let i = 0; i < N; i++) { e.ph[i] = lerp(h0, h1, e.len > 0 ? e.ps[i] / e.len : 0) + bias; e.pc[i] = 0; }
      continue;
    }
    const prof = e.prof || new Array(N).fill(lerp(n0.h, n1.h, 0.5));
    const s0 = e.set0, s1 = e.len - e.set1, room = Math.max(0, s1 - s0);
    const D = Math.max(0.01, Math.min(10, room / 2));
    const p0 = n0.ends.length >= 2 && n0.plane, p1 = n1.ends.length >= 2 && n1.plane;
    for (let i = 0; i < N; i++) {
      const s = e.ps[i];
      // a short link between two junctions runs straight from one plane to the other (its own patch of terrain
      // model is too short to follow)
      let h = (p0 && p1 && room < 14) ? lerp(planeAt(n0, e.px[i], e.pz[i]), planeAt(n1, e.px[i], e.pz[i]), Math.max(0, Math.min(1, (s - s0) / Math.max(0.01, room)))) : prof[i];
      let c = 0;
      if (p0) { const t = Math.max(0, Math.min(1, (s - s0) / D)), w = t * t * (3 - 2 * t); h = lerp(planeAt(n0, e.px[i], e.pz[i]), h, w); c += (1 - w) * (n0.plane[1] * e.nx[i] + n0.plane[2] * e.nz[i]); }
      if (p1) { const t = Math.max(0, Math.min(1, (s1 - s) / D)), w = t * t * (3 - 2 * t); h = lerp(planeAt(n1, e.px[i], e.pz[i]), h, w); c += (1 - w) * (n1.plane[1] * e.nx[i] + n1.plane[2] * e.nz[i]); }
      // a road running over (or beside) a junction it is not part of takes that junction's plane there, so the
      // two surfaces agree where they overlap
      const ci = Math.floor(e.px[i] / JC), cj = Math.floor(e.pz[i] / JC);
      for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) for (const n of jg.get(a + ',' + b) || []) {
        if (n === n0 || n === n1) continue;
        const d = Math.hypot(e.px[i] - n.x, e.pz[i] - n.z), r = n._r + e.c.hw;
        if (d >= r) continue;
        const t = Math.max(0, Math.min(1, (d - 0.55 * r) / (0.45 * r))), w = t * t * (3 - 2 * t);
        h = lerp(planeAt(n, e.px[i], e.pz[i]), h, w);
      }
      e.ph[i] = h; e.pc[i] = Math.max(-0.35, Math.min(0.35, c));
    }
    // no road steeper than MAX_GRADE between its junctions (a ramp into a garage, or a bad ground sample, would
    // otherwise be a wall for the car): relax towards both ends, the parts inside the junctions stay on the planes
    const fixed = (i) => (p0 && e.ps[i] <= s0) || (p1 && e.ps[i] >= s1);
    // when the two junctions are further apart in height than MAX_GRADE allows (a bad patch of terrain model, a
    // cliff), the road takes the grade it needs, evenly, rather than a step at one end
    let G = MAX_GRADE;
    let ia = -1, ib = N; for (let i = 0; i < N; i++) { if (fixed(i) && (!p1 || e.ps[i] <= s0)) ia = i; }
    for (let i = N - 1; i >= 0; i--) { if (fixed(i) && (!p0 || e.ps[i] >= s1)) ib = i; }
    if (ia >= 0 && ib < N && ib > ia) { const need = Math.abs(e.ph[ib] - e.ph[ia]) / Math.max(0.5, e.ps[ib] - e.ps[ia]); if (need * 1.15 > G) G = need * 1.15; }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < N; i++) if (!fixed(i)) { const g = G * (e.ps[i] - e.ps[i - 1]); e.ph[i] = Math.max(e.ph[i - 1] - g, Math.min(e.ph[i - 1] + g, e.ph[i])); }
      for (let i = N - 2; i >= 0; i--) if (!fixed(i)) { const g = G * (e.ps[i + 1] - e.ps[i]); e.ph[i] = Math.max(e.ph[i + 1] - g, Math.min(e.ph[i + 1] + g, e.ph[i])); }
    }
    // round the creases where the grade changes (the limit above leaves straight runs meeting at a kink, and a
    // coarse terrain model has its own): a triangular average over 8 m each way, twice, as a road's vertical curves
    // (in a built-up area outside the US the elevation model carries the buildings' tops, which make bumps in the
    // streets: a longer window there)
    const lumpy = e.c.urban && S.region !== 'us';
    if (N > 3) for (let pass = 0; pass < (lumpy ? 3 : 2); pass++) {
      const W = lumpy ? 18 : 8, q = e.ph.slice();
      let lo = 0, hi = 0;
      for (let i = 0; i < N; i++) {
        if (fixed(i)) continue;
        // (bounded by i itself: an unbounded walk hung the page on some Overpass data)
        while (lo < i && e.ps[lo] < e.ps[i] - W) lo++;
        if (hi < lo) hi = lo;
        while (hi + 1 < N && e.ps[hi + 1] <= e.ps[i] + W) hi++;
        let sw = 0, sh = 0;
        for (let j = lo; j <= hi; j++) { const w = 1 - Math.abs(e.ps[j] - e.ps[i]) / W; if (w > 0) { sw += w; sh += w * e.ph[j]; } }
        if (sw > 0) q[i] = sh / sw;
      }
      for (let i = 0; i < N; i++) e.ph[i] = q[i];
    }
    for (let i = 0; i < N; i++) e.ph[i] += bias;
  }
  // 5. bridge decks: raised over what they cross, the roads at their ends ramped up to meet them
  try { await bridgeDecks(edgeIn); } catch (err) { console.warn('bridge decks', err); }
}
const MAX_GRADE = 0.33, NET_GRADE = 0.25;

// ---------------------------------------------------------------- bridge decks
// A deck starts from the roads it joins at its ends and is raised over whatever it crosses: a road under it gets
// BR_CLEAR (4.8 m of headroom and the deck's own depth), the ground BR_GROUND, spread along the deck at BR_GRADE so
// it rises on a vertical curve. Where a deck has to stand higher than the road it starts from, and that road is the
// only one there, the road is ramped up to meet it (at BR_RAMP, steeper when it is short); a junction at a bridge's
// end stays where it is. Decks are worked out from the lowest layer up, so one over another clears it. In the
// photographed world the deck is read from the photographs (sampled from above) instead.
// The heights bridges' nodes (their ends, by place to the metre) were first given in this drive: later builds, as
// the area round the car is built again, reuse them, so a deck and the road on it never jump under a car (a long
// bridge's ends used to be worked out again from whichever roads were loaded at the time: 4.7 m on the Bay
// Bridge's approach). Only nodes not seen before are worked out; a new drop (another origin) starts afresh.
const DECK_MEM = new Map(); let DECK_ORIGIN = '';
const deckKey = (n) => Math.round(n.x) + ',' + Math.round(n.z);
function deckMem() {
  const o = unproject(0, 0), k = o.lat.toFixed(6) + ',' + o.lon.toFixed(6);
  if (k !== DECK_ORIGIN || DECK_MEM.size > 50000) { DECK_ORIGIN = k; DECK_MEM.clear(); }
  return DECK_MEM;
}
const BR_CLEAR = 5.6, BR_GROUND = 0.5, BR_GRADE = 0.06, BR_RAMP = 0.07, BR_RAMP_MAX = 0.12, BR_END = 12, BR_MAXH = 30;
async function bridgeDecks(edgeIn) {
  const nodes = S.nodes;
  const B = S.edges.filter(e => e.c.bridge && e.px && e.px.length >= 2 && edgeIn(e));
  if (!B.length) return;
  const nodeOf = (e, end) => nodes.get(end ? e.ids[e.ids.length - 1] : e.ids[0]);
  const anchored = (n) => n.ends.some(x => !x.e.c.bridge);
  const approach = (n) => { let a = null; for (const x of n.ends) if (!x.e.c.bridge) { if (a) return null; a = x; } return a; };
  if (!S.smooth) { for (const e of B) { await Y(); deckFromMesh(e, nodeOf(e, 0), nodeOf(e, 1)); } return; }
  // every road piece by place, for what passes under a deck
  const C = 24, grid = new Map();
  for (const f of S.edges) {
    if (!f.px || f.px.length < 2) continue;
    for (let j = 1; j < f.px.length; j++) gridAdd(grid, Math.min(f.px[j - 1], f.px[j]), Math.min(f.pz[j - 1], f.pz[j]), Math.max(f.px[j - 1], f.px[j]), Math.max(f.pz[j - 1], f.pz[j]), [f, j], C);
  }
  await Y();
  const layers = [...new Set(B.map(e => e.c.layer))].sort((a, b) => a - b);
  let raisedN = 0, crossN = 0;
  for (const layer of layers) {
    const group = B.filter(e => e.c.layer === layer), req = new Map(), raised = [];
    // what each deck has to clear, sample by sample
    for (const e of group) {
      await Y();
      const N = e.px.length, R = new Float64Array(N).fill(-Infinity), cr = [], seen = new Set();
      const ends = new Set([e.ids[0], e.ids[e.ids.length - 1]]);
      const n0 = nodeOf(e, 0), n1 = nodeOf(e, 1), L = Math.max(1e-3, e.len);
      const lin = (s) => lerp(planeAt(n0, e.px[0], e.pz[0]), planeAt(n1, e.px[N - 1], e.pz[N - 1]), s / L);
      for (let i = 1; i < N; i++) {
        const ax = e.px[i - 1], az = e.pz[i - 1], rx = e.px[i] - ax, rz = e.pz[i] - az;
        for (let gi = Math.floor(Math.min(ax, ax + rx) / C); gi <= Math.floor(Math.max(ax, ax + rx) / C); gi++) for (let gj = Math.floor(Math.min(az, az + rz) / C); gj <= Math.floor(Math.max(az, az + rz) / C); gj++) {
          const l = grid.get(gi * 73856093 ^ gj * 19349663); if (!l) continue;
          for (const [f, j] of l) {
            if (f === e || (f.c.bridge && f.c.layer >= layer)) continue;
            if (ends.has(f.ids[0]) || ends.has(f.ids[f.ids.length - 1])) continue; // a road joined to this one
            const key = f.id * 100000 + j; if (seen.has(key)) continue;
            const sx = f.px[j] - f.px[j - 1], sz = f.pz[j] - f.pz[j - 1], den = rx * sz - rz * sx;
            if (Math.abs(den) < 1e-9) continue;
            const qx = f.px[j - 1] - ax, qz = f.pz[j - 1] - az, t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            seen.add(key);
            const s = e.ps[i - 1] + (e.ps[i] - e.ps[i - 1]) * t, h = f.ph[j - 1] + (f.ph[j] - f.ph[j - 1]) * u + BR_CLEAR;
            if (h - lin(s) > BR_MAXH) continue; // a data error, not a road under the deck
            const sinA = Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(sx, sz) || 1);
            cr.push({ s, h, w: (f.c.hw + 1.5) / Math.max(0.3, sinA) });
          }
        }
      }
      crossN += cr.length;
      const a0 = anchored(n0), a1 = anchored(n1);
      for (let i = 0; i < N; i++) {
        const s = e.ps[i];
        let r = -Infinity;
        for (const c of cr) r = Math.max(r, c.h - Math.max(0, Math.abs(s - c.s) - c.w) * BR_GRADE);
        // the ground under it, away from where it meets the roads on the ground at its ends
        if ((!a0 || s > BR_END) && (!a1 || e.len - s > BR_END)) {
          const w = e.c.hw * 0.8; let g = -Infinity;
          for (const o of [-w, 0, w]) { const h = sampleGround(e.px[i] + e.nx[i] * o, e.pz[i] + e.nz[i] * o); if (h != null && h > g) g = h; }
          if (g > -Infinity && g + BR_GROUND - lin(s) < BR_MAXH) r = Math.max(r, g + BR_GROUND);
        }
        R[i] = r;
      }
      req.set(e, R);
    }
    // the ends: a node only bridges meet at rises as needed; a bridge's end on the ground rises (with a ramp on
    // the road before it) when that road is the only one there
    for (const e of group) for (const end of [0, 1]) {
      const n = nodeOf(e, end), R = req.get(e), other = nodeOf(e, 1 - end), mem = deckMem().get(deckKey(n));
      let need = R[end ? R.length - 1 : 0];
      // (never a deck steeper than BR_RAMP_MAX: a bridge's end on the ground rises to meet a high other end)
      if (anchored(n) && !anchored(other)) need = Math.max(need, other.h - BR_RAMP_MAX * e.len);
      // a height this node had in an earlier build of this drive is kept, whatever this build would make of it
      if (mem != null) { if (!anchored(n)) continue; need = mem; }
      if (!(need > -Infinity) || need <= n.h + 0.25) continue;
      if (!anchored(n)) { n.h = need; continue; }
      const a = approach(n); if (!a) continue;
      const f = a.e, far = a.atStart ? f.ph[f.ph.length - 1] : f.ph[0], want = Math.min(need, far + BR_RAMP_MAX * f.len);
      if (want <= n.h + 0.25) continue;
      n.h = want; if (n.plane) n.plane[0] = want;
      n.ramp = a; if (!raised.includes(n)) raised.push(n);
    }
    // the decks: straight between their ends, raised to what they must clear (never steeper than an end can
    // climb), then rounded
    for (const e of group) {
      await Y();
      const N = e.px.length, R = req.get(e), n0 = nodeOf(e, 0), n1 = nodeOf(e, 1), L = Math.max(1e-3, e.len), bias = rankBias(e);
      const h0 = planeAt(n0, e.px[0], e.pz[0]), h1 = planeAt(n1, e.px[N - 1], e.pz[N - 1]);
      const P = new Array(N);
      for (let i = 0; i < N; i++) {
        const s = e.ps[i], l = lerp(h0, h1, s / L);
        P[i] = Math.max(l, Math.min(R[i], h0 + BR_RAMP_MAX * s, h1 + BR_RAMP_MAX * (L - s)));
      }
      smoothProfile(e, P, 14, 2, (i) => e.ps[i] < 0.5 || e.ps[i] > L - 0.5);
      for (let i = 0; i < N; i++) { e.ph[i] = P[i] + bias; e.pc[i] = 0; }
    }
    // the ramps up to raised ends
    for (const n of raised) {
      const a = n.ramp, f = a.e, M = f.px.length;
      const far = a.atStart ? f.ph[M - 1] : f.ph[0];
      const G = Math.min(BR_RAMP_MAX, Math.max(BR_RAMP, (n.h - far) / Math.max(1, f.len) * 1.05));
      let reach = 0;
      for (let i = 0; i < M; i++) {
        const d = a.atStart ? f.ps[i] : f.len - f.ps[i], t = n.h + rankBias(f) - G * d;
        if (t > f.ph[i]) { f.ph[i] = t; if (d > reach) reach = d; }
      }
      // a vertical curve at the ramp's foot
      const P = f.ph.slice();
      smoothProfile(f, P, 10, 2, (i) => { const d = a.atStart ? f.ps[i] : f.len - f.ps[i]; return d < 0.5 || d > reach + 14 || (a.atStart ? f.len - f.ps[i] : f.ps[i]) < (a.atStart ? f.set1 : f.set0) + 0.5; });
      for (let i = 0; i < M; i++) f.ph[i] = Math.max(P[i], f.ph[i] - 0.4);
      f.ramp = (f.ramp || 0) | (a.atStart ? 1 : 2);
      raisedN++;
    }
  }
  // a node a higher layer raised (a deck of another layer joining it) after a lower deck was worked out from it:
  // that deck's end goes up to it, the rest of it following linearly (it was a step of metres)
  let mended = 0;
  for (const e of B) {
    const N = e.px.length, n0 = nodeOf(e, 0), n1 = nodeOf(e, 1), bias = rankBias(e), L = Math.max(1e-3, e.len);
    const d0 = planeAt(n0, e.px[0], e.pz[0]) + bias - e.ph[0], d1 = planeAt(n1, e.px[N - 1], e.pz[N - 1]) + bias - e.ph[N - 1];
    if (Math.abs(d0) < 0.05 && Math.abs(d1) < 0.05) continue;
    for (let i = 0; i < N; i++) { const t = e.ps[i] / L; e.ph[i] += d0 * (1 - t) + d1 * t; }
    mended++;
  }
  // the heights every bridge's ends were given, kept for later builds (only ones not known yet are added)
  const mem = deckMem();
  for (const e of B) for (const end of [0, 1]) { const n = nodeOf(e, end), k = deckKey(n); if (!mem.has(k) && Number.isFinite(n.h)) mem.set(k, n.h); }
  S.bridgeStats = { decks: B.length, crossings: crossN, ramps: raisedN, mended, remembered: mem.size };
}
// a triangular average over W metres each way, passes times, leaving the samples fixed(i) says
function smoothProfile(e, P, W, passes, fixed) {
  const N = P.length; if (N < 3) return;
  for (let pass = 0; pass < passes; pass++) {
    const q = P.slice();
    let lo = 0, hi = 0;
    for (let i = 0; i < N; i++) {
      if (fixed(i)) continue;
      while (lo < i && e.ps[lo] < e.ps[i] - W) lo++;
      if (hi < lo) hi = lo;
      while (hi + 1 < N && e.ps[hi + 1] <= e.ps[i] + W) hi++;
      let sw = 0, sh = 0;
      for (let j = lo; j <= hi; j++) { const w = 1 - Math.abs(e.ps[j] - e.ps[i]) / W; if (w > 0) { sw += w; sh += w * P[j]; } }
      if (sw > 0) q[i] = sh / sw;
    }
    for (let i = 0; i < N; i++) P[i] = q[i];
  }
}
// the photographed world: the deck where the photographs have it, sampled from just above the straight line
// between its ends (cars and lamp posts on it filtered out), blended into its ends' planes
function deckFromMesh(e, n0, n1) {
  const N = e.px.length, L = Math.max(1e-3, e.len), bias = rankBias(e);
  const h0 = planeAt(n0, e.px[0], e.pz[0]), h1 = planeAt(n1, e.px[N - 1], e.pz[N - 1]);
  const raw = new Array(N).fill(null), w = e.c.hw * 0.6;
  for (let i = 0; i < N; i++) {
    const l = lerp(h0, h1, e.ps[i] / L), v = [];
    for (const o of [-w, -w / 2, 0, w / 2, w]) {
      let h = null; try { h = S.groundAt(e.px[i] + e.nx[i] * o, e.pz[i] + e.nz[i] * o, l + 6); } catch (err) { h = null; }
      if (h != null && isFinite(h) && h > l - 3 && h < l + 6.5) v.push(h);
    }
    if (v.length >= 2) raw[i] = pct(v, 0.3);
  }
  if (!raw.some(v => v != null)) return;
  for (let i = 0; i < N; i++) if (raw[i] == null) {
    let a = i - 1; while (a >= 0 && raw[a] == null) a--; let b = i + 1; while (b < N && raw[b] == null) b++;
    raw[i] = a < 0 ? raw[b] : b >= N ? raw[a] : lerp(raw[a], raw[b], (i - a) / (b - a));
  }
  const P = raw.slice();
  smoothProfile(e, P, 7, 2, () => false);
  for (let i = 0; i < N; i++) {
    const s = e.ps[i], w0 = Math.min(1, s / 10), w1 = Math.min(1, (L - s) / 10), wt = Math.min(w0, w1);
    e.ph[i] = lerp(lerp(h0, h1, s / L), P[i], wt * wt * (3 - 2 * wt)) + bias; e.pc[i] = 0;
  }
}

// ---------------------------------------------------------------- crossings, stops, signals
function onEdgeAt(nodeId) { // [{ e, i (index in e.ids), s }]
  const out = [];
  for (const e of S.edges) {
    const i = e.ids.indexOf(nodeId);
    if (i > 0 && i < e.ids.length - 1) out.push({ e, i, s: arcOfNode(e, i) });
  }
  return out;
}
function arcOfNode(e, i) { let s = 0; for (let k = 1; k <= i; k++) s += Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]); return s; }

function findFeatures(data) {
  // interior node index: node id -> [{e, i}]
  const interior = new Map();
  for (const e of S.edges) for (let i = 1; i < e.ids.length - 1; i++) {
    let l = interior.get(e.ids[i]); if (!l) interior.set(e.ids[i], l = []); l.push({ e, i, s: arcOfNode(e, i) });
  }
  const crossings = [], approaches = [];
  const crossNode = new Set();
  const marked = (t) => {
    if (!t) return true;
    if (t.crossing === 'unmarked' || t.crossing === 'no' || t['crossing:markings'] === 'no' || t.crossing === 'informal') return false;
    return true;
  };
  const addCrossing = (id, t) => {
    if (crossNode.has(id)) return; crossNode.add(id);
    const l = interior.get(id);
    if (l) for (const r of l) crossings.push({ e: r.e, s: r.s, kind: (t && (t.crossing === 'zebra' || t.crossing_ref === 'zebra')) ? 'zebra' : 'marked', node: id });
  };
  for (const p of data.points || []) if (p.kind === 'crossing' && marked(p.tags)) addCrossing(p.id, p.tags);
  for (const w of data.roads || []) {
    const t = w.tags;
    if (!(t.footway === 'crossing' || t.cycleway === 'crossing' || t.path === 'crossing')) continue;
    if (!marked(t)) continue;
    for (const id of w.nodes) if (interior.has(id)) { const nt = data.nodes && data.nodes.get(id); if (!nt || !nt.tags || marked(nt.tags)) addCrossing(id, t); }
  }
  // stop / give way / signals
  const dirOf = (t) => {
    const v = t && (t.direction || t['traffic_signals:direction'] || t['traffic_sign:direction'] || t['stop:direction']);
    return v === 'forward' ? 1 : v === 'backward' ? -1 : v === 'both' ? 0 : null;
  };
  for (const p of data.points || []) {
    if (p.kind !== 'traffic_signals' && p.kind !== 'stop' && p.kind !== 'give_way') continue;
    const kind = p.kind === 'traffic_signals' ? 'signal' : p.kind;
    const jn = S.nodes.get(p.id);
    if (jn && jn.ends.length >= 2) {
      const minRank = Math.min(...jn.ends.map(x => x.e.c.rank));
      const all = kind === 'signal' || (p.tags && p.tags.stop === 'all') || jn.ends.every(x => x.e.c.rank === minRank);
      for (const x of jn.ends) {
        if (!all && x.e.c.rank !== minRank) continue;
        const towardEnd = !x.atStart; // traffic travelling toward this node
        if (towardEnd ? x.e.c.lanesF === 0 : x.e.c.lanesB === 0) continue;
        approaches.push({ e: x.e, toEnd: towardEnd, s: null, kind, node: p.id, junction: jn.id });
      }
      continue;
    }
    const l = interior.get(p.id);
    if (!l) continue;
    for (const r of l) {
      const e = r.e;
      let d = dirOf(p.tags);
      if (d != null && d !== 0) d *= e.wayDir; // way direction -> edge direction
      const n0 = S.nodes.get(e.ids[0]), n1 = S.nodes.get(e.ids[e.ids.length - 1]);
      const toEndDist = e.len - r.s, toStartDist = r.s;
      const list = [];
      if (d === 1) list.push(true); else if (d === -1) list.push(false);
      else if (d === 0) list.push(true, false);
      else {
        const jEnd = n1.ends.length > 2 ? toEndDist : Infinity, jStart = n0.ends.length > 2 ? toStartDist : Infinity;
        if (kind === 'signal' && Math.min(jEnd, jStart) > 30) list.push(true, false); // mid-block crossing signal
        else list.push(jEnd <= jStart);
      }
      for (const toEnd of list) {
        if (toEnd ? e.c.lanesF === 0 : e.c.lanesB === 0) continue;
        const jn2 = toEnd ? n1 : n0;
        approaches.push({ e, toEnd, s: r.s, kind, node: p.id, junction: (jn2.ends.length > 2 && Math.abs((toEnd ? toEndDist : toStartDist)) < 40) ? jn2.id : null });
      }
    }
  }
  // the vector tile store has no signal or stop nodes: infer them from the junctions (marked inferred)
  if (data.source === 'openfreemap' && !approaches.length) inferControls(approaches);
  const depth = S.style.region === 'jp' ? 4 : 3;
  // nor any crossings: a signalled junction has one across each road that meets it (marked inferred)
  if (data.source === 'openfreemap' && !crossings.length) {
    const seen = new Set();
    for (const a of approaches) {
      if (a.kind !== 'signal' || !a.e || a.e.c.rank >= 9) continue;
      const e = a.e, key = e.id + (a.toEnd ? 'e' : 's');
      if (seen.has(key) || e.len - e.set0 - e.set1 < depth + 8) continue;
      seen.add(key);
      crossings.push({ e, s: a.toEnd ? e.len - e.set1 : e.set0, kind: 'zebra', node: a.node, inferred: true });
    }
  }
  // where each crosswalk is drawn: [s0, s1] along its edge, clear of the junctions
  for (const cr of crossings) {
    const e = cr.e;
    let s = Math.max(e.set0 + 1.6, Math.min(e.len - e.set1 - 1.6 - depth, cr.s - depth / 2));
    if (e.len - e.set1 - e.set0 < depth + 0.4) s = (e.set0 + e.len - e.set1) / 2 - depth / 2;
    cr.s0 = s; cr.s1 = s + depth;
  }
  // stop line position along the edge
  for (const a of approaches) {
    const e = a.e;
    let s = a.s;
    const setb = a.toEnd ? e.set1 : e.set0;
    const lim0 = e.set0 + 0.5, lim1 = e.len - e.set1 - 0.5;
    if (s == null) s = a.toEnd ? e.len - setb - 1.0 : setb + 1.0;
    // a crosswalk between the line and the junction: stop before it
    for (const c of crossings) {
      if (c.e !== e) continue;
      if (a.toEnd) { if (c.s1 > s - 1.5 && c.s0 < e.len - setb + 1) s = Math.min(s, c.s0 - 1.0); }
      else if (c.s0 < s + 1.5 && c.s1 > setb - 1) s = Math.max(s, c.s1 + 1.0 + 0.45);
    }
    a.s = Math.max(lim0, Math.min(lim1, s));
  }
  S.crossings = crossings; S.approaches = approaches;
}

// Junction controls guessed from the road classes, for data with no signal or stop nodes (deterministic):
//  - signals where two or more tertiary-or-bigger roads meet with 4+ legs, or 3 legs of which two are primary or
//    secondary in town (no motorways);
//  - otherwise a minor road (residential, unclassified, living street, a service road over 30 m) meeting a
//    tertiary-or-bigger road stops (US, Canada, Australia: stop sign and line) or gives way (elsewhere).
function buildingsNear(x, z, r) {
  if (!S.bpolys) return 0;
  let n = 0;
  for (const b of S.bpolys) { const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; if (Math.abs(cx - x) < r && Math.abs(cz - z) < r && Math.hypot(cx - x, cz - z) < r) n++; }
  return n;
}
function inferControls(approaches) {
  const stopKind = (S.region === 'us' || S.region === 'au') ? 'stop' : 'give_way';
  for (const n of S.nodes.values()) {
    const legs = n.ends;
    if (legs.length < 3) continue;
    if (legs.some(x => x.e.c.rank >= 9 && /motorway/.test(x.e.c.cls))) continue;
    const major = legs.filter(x => x.e.c.rank >= 6).length, mainRoads = legs.filter(x => x.e.c.rank >= 7).length;
    const urban = legs.some(x => x.e.c.urban);
    const incoming = (x) => x.atStart ? x.e.c.lanesB > 0 : x.e.c.lanesF > 0;
    if (((legs.length >= 4 && major >= 2) || (legs.length === 3 && mainRoads >= 2 && urban)) && buildingsNear(n.x, n.z, 150) >= 25) {
      for (const x of legs) if (incoming(x)) approaches.push({ e: x.e, toEnd: !x.atStart, s: null, kind: 'signal', node: n.id, junction: n.id, inferred: true });
      continue;
    }
    if (!major) continue;
    for (const x of legs) {
      const c = x.e.c;
      if (c.rank >= 6 || !incoming(x)) continue;
      if (!(c.cls === 'residential' || c.cls === 'unclassified' || c.cls === 'living_street' || (c.cls === 'service' && x.e.len > 30))) continue;
      approaches.push({ e: x.e, toEnd: !x.atStart, s: null, kind: stopKind, node: n.id, junction: n.id, inferred: true });
    }
  }
}
function buildSignals() {
  const sigs = S.approaches.filter(a => a.kind === 'signal');
  // union nodes (signal nodes and their junctions) within 30 m
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const pos = new Map();
  for (const a of sigs) {
    add(a.node); const n = S.nodes.get(a.node) || (a.e && null);
    if (a.junction != null) union(a.node, a.junction);
  }
  const posOf = (id) => { const n = S.nodes.get(id); if (n) return [n.x, n.z]; for (const a of sigs) if (a.node === id) { const p = at(a.e, a.s); return [p.x, p.z]; } return null; };
  const ids = [...parent.keys()];
  for (const id of ids) pos.set(id, posOf(id));
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const p = pos.get(ids[i]), q = pos.get(ids[j]);
    if (p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 30) union(ids[i], ids[j]);
  }
  const groups = new Map(), sigMap = new Map();
  for (const a of sigs) {
    const g = find(a.node);
    let G = groups.get(g);
    if (!G) groups.set(g, G = { id: g, x: 0, z: 0, nodes: [], approaches: [], axis: 0, _n: 0, inferred: !!a.inferred });
    const p = at(a.e, a.s);
    const dirSign = a.toEnd ? 1 : -1;
    const tx = p.tz * 0, heading = (Math.atan2(p.tx * dirSign, -p.tz * dirSign) * 180 / Math.PI + 360) % 360;
    void tx;
    const lanes = a.toEnd ? a.e.c.lanesF : a.e.c.lanesB;
    // right curb at the stop line, relative to travel direction
    const rs = dirSign; // right normal of travel = edge right normal * dirSign
    const hw = a.e.c.hw;
    const ap = { heading, x: p.x, z: p.z, px: p.x + p.nx * rs * (hw + 0.6), pz: p.z + p.nz * rs * (hw + 0.6), halfWidth: hw, lanes, node: a.node, edge: a.e.id, toEnd: a.toEnd, s: a.s, inferred: !!a.inferred };
    if (S.leftHand) { ap.px = p.x - p.nx * rs * (hw + 0.6); ap.pz = p.z - p.nz * rs * (hw + 0.6); }
    // the far side: the near-side curb (right in right-hand traffic) of the road that continues straight across
    // the junction, just past it (fx, fz); null when nothing continues straight
    ap.fx = null; ap.fz = null;
    const J = S.nodes.get(a.toEnd ? a.e.ids[a.e.ids.length - 1] : a.e.ids[0]);
    if (J && J.ends.length >= 2) {
      const tx = p.tx * dirSign, tz = p.tz * dirSign;
      let best = null, bd = 0.82;
      for (const x of J.ends) {
        if (x.e === a.e) continue;
        const q = x.atStart ? at(x.e, Math.min(x.e.len, 6)) : at(x.e, Math.max(0, x.e.len - 6));
        let dx = q.x - J.x, dz = q.z - J.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const d = dx * tx + dz * tz;
        if (d > bd) { bd = d; best = x; }
      }
      if (best) {
        const e2 = best.e, s2 = best.atStart ? Math.min(e2.len, e2.set0 + 1.0) : Math.max(0, e2.len - e2.set1 - 1.0), q = at(e2, s2);
        const sgn = (best.atStart ? 1 : -1) * (S.leftHand ? -1 : 1), off = e2.c.hw + 0.6;
        ap.fx = q.x + q.nx * sgn * off; ap.fz = q.z + q.nz * sgn * off;
      }
    }
    G.approaches.push(ap);
    a.group = g; a.heading = heading;
    if (!G.nodes.includes(a.node)) G.nodes.push(a.node);
    if (a.junction != null && !G.nodes.includes(a.junction)) G.nodes.push(a.junction);
  }
  for (const G of groups.values()) {
    let sx = 0, sz = 0, n = 0;
    for (const id of G.nodes) { const p = pos.get(id) || posOf(id); if (p) { sx += p[0]; sz += p[1]; n++; } }
    G.x = n ? sx / n : G.approaches[0].x; G.z = n ? sz / n : G.approaches[0].z;
    // axis: the widest approach
    let best = null; for (const ap of G.approaches) if (!best || ap.halfWidth * 10 + ap.lanes > best.halfWidth * 10 + best.lanes) best = ap;
    G.axis = best ? best.heading % 180 : 0;
    delete G._n;
    for (const id of G.nodes) sigMap.set(id, G.id);
  }
  S.signalGroups = groups; S.signals = sigMap;
  // stop and give way signs
  const sg = [];
  for (const a of S.approaches) {
    if (a.kind === 'signal') continue;
    const p = at(a.e, a.s), dirSign = a.toEnd ? 1 : -1;
    const heading = (Math.atan2(p.tx * dirSign, -p.tz * dirSign) * 180 / Math.PI + 360) % 360;
    const side = S.leftHand ? -1 : 1, off = a.e.c.hw + 0.7;
    sg.push({ id: a.node, kind: a.kind, x: p.x, z: p.z, heading, px: p.x + p.nx * dirSign * side * off, pz: p.z + p.nz * dirSign * side * off, inferred: !!a.inferred, junction: a.junction });
  }
  // all-way stops: every road coming into the junction has a stop line (in the US an ALL WAY plaque goes under
  // each sign)
  const stopsAt = new Map();
  for (const a of S.approaches) if (a.kind === 'stop' && a.junction != null) stopsAt.set(a.junction, (stopsAt.get(a.junction) || 0) + 1);
  for (const s of sg) {
    if (s.kind !== 'stop' || s.junction == null) continue;
    const J = S.nodes.get(s.junction); if (!J) continue;
    let incoming = 0; for (const x of J.ends) if ((x.atStart ? x.e.c.lanesB : x.e.c.lanesF) > 0) incoming++;
    s.allWay = incoming >= 3 && (stopsAt.get(s.junction) || 0) >= incoming;
  }
  S.signs = sg;
}

// ---------------------------------------------------------------- meshes
const WHITE = [0.93, 0.93, 0.9], YELLOW = [0.95, 0.72, 0.12];

function emitRibbon(e, sa, sb) {
  if (sb - sa < 0.02) return;
  const pts = sliceLite(e, sa, sb), c = e.c, hw = c.hw;
  const road = (u) => [u, c.nLanes >= 1 && c.travel > 4 ? c.lw : 0, c.travel / 2];
  let prevL = -1, prevR = -1;
  const nrm = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], ds = b.s - a.s;
    const g = ds > 0.01 ? (b.h - a.h) / ds : 0, p = pts[i], tx = p.nz, tz = -p.nx, c = p.c || 0;
    const vx = -(g * tx + c * p.nx), vz = -(g * tz + c * p.nz), l = Math.sqrt(1 + vx * vx + vz * vz);
    return [vx / l, 1 / l, vz / l];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], o = hw * p.mk, y = p.h + LIFT;
    const B = tileB('road', p.x, p.z);
    if (i > 0 && B !== pts[i - 1].B) { // tile change: restart in this tile with the previous pair copied
      const q = pts[i - 1], oq = hw * q.mk, yq = q.h + LIFT, nq = nrm(i - 1), cq = (q.c || 0) * oq;
      prevL = B.v(q.x - q.nx * oq, yq - cq, q.z - q.nz * oq, (q.x - q.nx * oq) * UVS, (q.z - q.nz * oq) * UVS, road(-hw), null, nq);
      prevR = B.v(q.x + q.nx * oq, yq + cq, q.z + q.nz * oq, (q.x + q.nx * oq) * UVS, (q.z + q.nz * oq) * UVS, road(hw), null, nq);
    }
    p.B = B;
    const lx = p.x - p.nx * o, lz = p.z - p.nz * o, rx = p.x + p.nx * o, rz = p.z + p.nz * o, np = nrm(i);
    const cy = (p.c || 0) * o;
    const L = B.v(lx, y - cy, lz, lx * UVS, lz * UVS, road(-hw), null, np), Rr = B.v(rx, y + cy, rz, rx * UVS, rz * UVS, road(hw), null, np);
    if (i > 0) B.quad(prevL, L, Rr, prevR);
    prevL = L; prevR = Rr;
  }
}
// indices: quad(prevL, L, R, prevR) -> triangles (prevL, L, R), (prevL, R, prevR): counter-clockwise from above? we
// fix facing by making the material double sided off and checking winding below.

function emitJunction(j) {
  const ol = junctionOutline(j);
  if (ol.length < 3) return;
  j.outline = ol;
  const B = tileB('road', j.n.x, j.n.z);
  const v2 = ol.map(p => new THREE.Vector2(p.x, p.z));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (err) { return; }
  const base = ol.map(p => B.v(p.x, p.h + LIFT, p.z, p.x * UVS, p.z * UVS, [0, 0, 0]));
  const onBridge = j.E.every(x => x.e.c.bridge) ? 1 : 0; // a junction up on a bridge (surfaceAt can leave decks out)
  for (const t of tris) {
    const a = ol[t[0]], b = ol[t[1]], c = ol[t[2]];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (cross < 0) B.tri(base[t[0]], base[t[1]], base[t[2]]); else B.tri(base[t[0]], base[t[2]], base[t[1]]);
    S.tris.push(a.x, a.z, a.h + LIFT, b.x, b.z, b.h + LIFT, c.x, c.z, c.h + LIFT);
    S.triB.push(onBridge);
  }
  for (let i = 0; i < ol.length; i++) { const a = ol[i], b = ol[(i + 1) % ol.length]; S.outl.push(a.x, a.z, b.x, b.z, a.cut ? 0 : a.curb ? 2 : 1); }
}

// Markings: quads along an offset line
function emitLine(e, o, sa, sb, width, col, dash) {
  if (sb - sa < 0.3) return;
  const raw = [];
  if (!dash) raw.push([sa, sb]);
  else { const per = dash[0] + dash[1]; let s = sa + 0.5; while (s < sb) { raw.push([s, Math.min(sb, s + dash[0])]); s += per; } }
  const pieces = [];
  for (const [a, b] of raw) {
    const n = Math.max(1, Math.ceil((b - a) / 2));
    let ra = null;
    for (let k = 0; k < n; k++) {
      const u0 = a + (b - a) * k / n, u1 = a + (b - a) * (k + 1) / n, p = at(e, (u0 + u1) / 2);
      const off = onCarriageway(p.x + p.nx * o * p.mk, p.z + p.nz * o * p.mk, e.id);
      if (!off && ra == null) ra = u0;
      if (off && ra != null) { pieces.push([ra, u0]); ra = null; }
    }
    if (ra != null) pieces.push([ra, b]);
  }
  for (const [a, b] of pieces) {
    if (b - a < 0.2) continue;
    const pts = sliceLite(e, a, b);
    let pl = -1, pr = -1, PB = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], k = p.mk, y = p.h + (p.c || 0) * o * k + LIFT + 0.004;
      const B = tileB('paint', p.x, p.z);
      const vx = (q) => { const yq = q.h + (q.c || 0) * o * q.mk + LIFT + 0.004, cx = q.x + q.nx * o * q.mk, cz = q.z + q.nz * o * q.mk; const lx = cx - q.nx * width / 2, lz = cz - q.nz * width / 2, rx = cx + q.nx * width / 2, rz = cz + q.nz * width / 2; return [B.v(lx, yq, lz, lx * UVS, lz * UVS, null, col), B.v(rx, yq, rz, rx * UVS, rz * UVS, null, col)]; };
      if (PB && B !== PB) { const q = vx(pts[i - 1]); pl = q[0]; pr = q[1]; } // tile seam: restart in this tile
      const cx = p.x + p.nx * o * k, cz = p.z + p.nz * o * k;
      const lx = cx - p.nx * width / 2, lz = cz - p.nz * width / 2, rx = cx + p.nx * width / 2, rz = cz + p.nz * width / 2;
      const L = B.v(lx, y, lz, lx * UVS, lz * UVS, null, col), R = B.v(rx, y, rz, rx * UVS, rz * UVS, null, col);
      if (pl >= 0) B.quad(pl, L, R, pr);
      pl = L; pr = R; PB = B;
    }
  }
}
// A bar across the road at s from lateral o0 to o1, depth d along the road
function emitBar(e, s, o0, o1, d, col) {
  const p = at(e, s), q = at(e, Math.min(e.len, s + d));
  const B = tileB('paint', p.x, p.z), y0 = p.h + LIFT + 0.004, y1 = q.h + LIFT + 0.004;
  const P = (pp, o, y) => { const x = pp.x + pp.nx * o, z = pp.z + pp.nz * o; return B.v(x, y + (pp.c || 0) * o, z, x * UVS, z * UVS, null, col); };
  const a = P(p, o0, y0), b = P(q, o0, y1), c = P(q, o1, y1), dd = P(p, o1, y0);
  B.quad(a, b, c, dd);
}

function emitMarkings(e) {
  const c = e.c, st = S.style;
  const marked = c.rank >= 6 || c.hasLanesTag && c.rank >= 3 && c.cls !== 'service' && c.cls !== 'living_street';
  const s0 = e.set0 + 1.2, s1 = e.len - e.set1 - 1.2;
  let a0 = s0, a1 = s1;
  // stop lines cut the centre/lane lines at the stop position
  if (!marked && st.region === 'jp' && c.rank >= 3 && c.cls !== 'service' && c.width >= 4 && s1 - s0 > 1) {
    // Japanese streets: white edge lines even on small two-way streets, no centre line
    const inset = Math.min(0.6, c.width * 0.1);
    emitLine(e, -c.hw + inset, a0, a1, 0.15, WHITE, null); emitLine(e, c.hw - inset, a0, a1, 0.15, WHITE, null);
  }
  if (st.region === 'uk' && c.urban && c.rank <= 7 && c.rank >= 3 && s1 - s0 > 1) {
    // UK: double yellow lines along the kerb (no waiting at any time), the commonest marking in town
    for (const side of [-1, 1]) {
      if (side < 0 ? !c.curbL : !c.curbR) continue;
      const o = side * (c.hw - 0.2);
      emitLine(e, o, e.set0 + 0.2, e.len - e.set1 - 0.2, 0.08, YELLOW, null);
      emitLine(e, o - side * 0.18, e.set0 + 0.2, e.len - e.set1 - 0.2, 0.08, YELLOW, null);
    }
  }
  if (marked && s1 - s0 > 1) {
    const n = c.nLanes, lw = c.lw, T = c.travel;
    const bound = (k) => -T / 2 + k * lw;
    const leftCount = c.oneway ? 0 : (S.leftHand ? c.lanesF : c.lanesB);
    const yellow = st.yellowCentre ? YELLOW : WHITE;
    const W = st.lw;
    if (!c.oneway) {
      const o = bound(leftCount);
      const multi = c.nLanes >= 4;
      if (st.doubleCentre && (c.rank >= 6 || multi)) { emitLine(e, o - W, a0, a1, W, yellow, null); emitLine(e, o + W, a0, a1, W, yellow, null); }
      else if (st.region === 'us') emitLine(e, o, a0, a1, W, yellow, st.centreDash);
      else if (multi) emitLine(e, o, a0, a1, W * 1.2, WHITE, null);
      else emitLine(e, o, a0, a1, W, WHITE, st.centreDash);
    }
    for (let k = 1; k < n; k++) {
      if (!c.oneway && k === leftCount) continue;
      emitLine(e, bound(k), a0, a1, W, WHITE, c.rank >= 9 && st.region === 'us' ? [3, 9] : st.lane);
    }
    // edge lines: motorways and rural main roads
    if (c.rank >= 9 || (!c.urban && c.rank >= 6) || (st.region === 'jp' && c.width >= 5.5)) {
      const inset = Math.max(0, Math.min(0.3, (c.width - T) / 2));
      const oL = -c.hw + inset + W / 2, oR = c.hw - inset - W / 2;
      const leftCol = c.oneway && st.yellowCentre && c.rank >= 8 ? YELLOW : WHITE;
      if (S.leftHand) { emitLine(e, oL, a0, a1, W * 1.2, WHITE, null); emitLine(e, oR, a0, a1, W * 1.2, c.oneway ? WHITE : WHITE, null); }
      else { emitLine(e, oL, a0, a1, W * 1.2, leftCol, null); emitLine(e, oR, a0, a1, W * 1.2, WHITE, null); }
    }
  }
}
function emitCrossings() {
  const st = S.style;
  for (const cr of S.crossings) {
    const e = cr.e, c = e.c;
    const s = cr.s0, depth = cr.s1 - cr.s0;
    const bar = st.region === 'jp' ? 0.45 : 0.5, gap = st.region === 'jp' ? 0.45 : 0.55;
    const usable = c.width - 0.4;
    const nb = Math.max(1, Math.floor((usable + gap) / (bar + gap)));
    const span = nb * bar + (nb - 1) * gap;
    let o = -span / 2;
    for (let k = 0; k < nb; k++) { emitBar(e, s, o, o + bar, depth, WHITE); o += bar + gap; }
  }
}
// Turn arrows painted in lanes that have turn:lanes, a few metres before the stop line (or the lane's end).
// Shapes in the lane's frame: x to the right of travel, y forward, metres.
const ARROW = {
  stem: [[-0.08, 0], [0.08, 0], [0.08, 3.2], [-0.08, 3.2]],
  ahead: [[-0.3, 3.2], [0.3, 3.2], [0, 5.0]],
  bar: (sd) => [[0, 2.5], [0, 2.75], [sd * 0.75, 2.75], [sd * 0.75, 2.5]].map(p => [p[0], p[1]]),
  side: (sd) => [[sd * 0.75, 2.25], [sd * 0.75, 3.0], [sd * 1.35, 2.625]],
};
function emitArrows() {
  const G = S.graph; if (!G) return;
  for (const L of G.lanes) {
    if (L.kind !== 'road' || !L.turns || L.len < 18) continue;
    const t = L.turns;
    if (!t.left && !t.right && !t.through) continue;
    const e = S.edges[L.edge];
    const sEnd = L.stopS != null ? L.stopS : L.len;
    for (const back of [6, 22]) {
      const s0 = sEnd - back - 5; if (s0 < 2) continue;
      // lane point and direction at s0
      let k = 1; while (k < L.cum.length - 1 && L.cum[k] < s0) k++;
      const a = L.pts[k - 1], b = L.pts[k], seg = L.cum[k] - L.cum[k - 1] || 1, f = (s0 - L.cum[k - 1]) / seg;
      const ox = lerp(a.x, b.x, f), oz = lerp(a.z, b.z, f);
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const rx = -dz, rz = dx;
      const es = lerp(L._s[k - 1], L._s[k], f), q = at(e, es), y = q.h + (q.c || 0) * ((ox - q.x) * q.nx + (oz - q.z) * q.nz) + LIFT + 0.004;
      const B = tileB('paint', ox, oz);
      const poly = (pts) => {
        const ids = pts.map(p => { const x = ox + rx * p[0] + dx * p[1], z = oz + rz * p[0] + dz * p[1]; return B.v(x, y, z, x * UVS, z * UVS, null, WHITE); });
        if (ids.length === 4) B.quad(ids[0], ids[1], ids[2], ids[3]); else B.tri(ids[0], ids[1], ids[2]);
      };
      poly(ARROW.stem);
      if (t.through || (!t.left && !t.right)) poly(ARROW.ahead);
      for (const sd of [-1, 1]) {
        if (sd < 0 ? !t.left : !t.right) continue;
        poly(ARROW.bar(sd)); poly(ARROW.side(sd));
      }
    }
  }
}
function emitStopLines() {
  for (const a of S.approaches) {
    const e = a.e, c = e.c;
    const right = !S.leftHand;
    // travel lanes toward the junction occupy: one-way: all; two-way: the right half (relative to travel)
    let o0, o1;
    const T = c.travel, leftCount = c.oneway ? 0 : (S.leftHand ? c.lanesF : c.lanesB), bound = (k) => -T / 2 + k * c.lw;
    if (c.oneway) { o0 = -c.hw + 0.3; o1 = c.hw - 0.3; }
    else if (a.toEnd) { if (right) { o0 = bound(leftCount); o1 = c.hw - 0.3; } else { o0 = -c.hw + 0.3; o1 = bound(leftCount); } }
    else { if (right) { o0 = -c.hw + 0.3; o1 = bound(leftCount); } else { o0 = bound(leftCount); o1 = c.hw - 0.3; } }
    const d = a.kind === 'give_way' ? 0.3 : (S.style.region === 'us' ? 0.45 : 0.3);
    const s = a.toEnd ? a.s - d : a.s;
    if (a.kind === 'give_way') {
      // dashed transverse line (UK double: two rows)
      const rows = S.style.region === 'uk' ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const sr = a.toEnd ? s - r * 0.5 : s + r * 0.5;
        for (let o = o0; o < o1 - 0.2; o += 0.9) emitBar(e, sr, o, Math.min(o1, o + 0.6), 0.25, WHITE);
      }
    } else emitBar(e, s, o0, o1, d, WHITE);
  }
}
function emitCurbs(e) {
  const c = e.c;
  if (!c.curbL && !c.curbR && !c.bridge) return;
  const sa = e.set0, sb = e.len - e.set1;
  if (sb - sa < 0.3) return;
  const pts = sliceLite(e, sa, sb);
  for (const side of [-1, 1]) {
    if (side < 0 ? !c.curbL : !c.curbR) continue;
    const line = pts.map(p => ({ x: p.x + p.nx * side * c.hw * p.mk, z: p.z + p.nz * side * c.hw * p.mk, h: p.h + (p.c || 0) * side * c.hw * p.mk, nx: p.nx * side, nz: p.nz * side, mk: p.mk }));
    // (on a bridge the pavement is level across and no wider than its deck)
    if (c.bridge) emitCurbLine(line, Math.min(3.5, side < 0 ? c.swWL : c.swWR), e.id, true);
    else emitCurbLine(line, side < 0 ? c.swWL : c.swWR, e.id);
  }
  // a bridge side with no pavement: a ledge from the carriageway to the parapet (drawn, and driven on)
  if (c.bridge) for (const side of [-1, 1]) {
    if (side < 0 ? c.curbL : c.curbR) continue;
    const o0 = c.hw, o1 = side < 0 ? c.deckL : c.deckR, LH = 0.12;
    let prev = null;
    for (const p of pts) {
      const k = p.mk || 1, y = p.h + LIFT + (p.c || 0) * side * o0 * k;
      const ax = p.x + p.nx * side * o0 * k, az = p.z + p.nz * side * o0 * k, bx = p.x + p.nx * side * o1 * k, bz = p.z + p.nz * side * o1 * k;
      const B = tileB('curb', p.x, p.z), nf = [-p.nx * side, 0, -p.nz * side];
      const v = { B, a0: B.v(ax, y - 0.05, az, p.s * 0.5, 0, null, null, nf), a1: B.v(ax, y + LH, az, p.s * 0.5, 0.06, null, null, nf), t0: B.v(ax, y + LH, az, p.s * 0.5, 0.06), t1: B.v(bx, y + LH, bz, p.s * 0.5, 0.06 + (o1 - o0) * 0.5), x: ax, z: az, X: bx, Z: bz, y: y + LH };
      if (prev && prev.B === B) { B.quad(prev.a0, v.a0, v.a1, prev.a1); B.quad(prev.t0, v.t0, v.t1, prev.t1); }
      if (prev && S.sidewalks) S.pav.push(prev.x, prev.z, prev.y, v.x, v.z, v.y, v.X, v.Z, v.y, prev.x, prev.z, prev.y, v.X, v.Z, v.y, prev.X, prev.Z, prev.y);
      prev = v;
    }
  }
}
// line: [{x, z, h, nx, nz}] with n pointing away from the road
// line: [{x, z, h, nx, nz, mk}] along a carriageway edge, n pointing away from the road
function emitCurbLine(line0, paveW, edgeId = -1, flat = false) {
  if (line0.length < 2) return;
  const fine = [line0[0]];
  for (let i = 1; i < line0.length; i++) {
    const a = line0[i - 1], b = line0[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
    for (let k = 1; k <= n; k++) { const t = k / n; fine.push(k === n ? b : { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), h: lerp(a.h, b.h, t), nx: b.nx, nz: b.nz, mk: 1 }); }
  }
  let run = [fine[0]];
  const out = [];
  for (let i = 1; i < fine.length; i++) {
    const a = fine[i - 1], b = fine[i], mx = (a.x + b.x) / 2 + (a.nx + b.nx) * 0.075, mz = (a.z + b.z) / 2 + (a.nz + b.nz) * 0.075;
    if (onCarriageway(mx, mz, edgeId) || (edgeId >= 0 && onCarriageway(mx - (a.nx + b.nx) * 0.2, mz - (a.nz + b.nz) * 0.2, edgeId))) { if (run.length > 1) out.push(run); run = [b]; }
    else run.push(b);
  }
  if (run.length > 1) out.push(run);
  for (const r of out) emitCurbRun(r, paveW, flat);
}
function emitCurbRun(line, paveW, flat = false) {
  if (line.length < 2) return;
  let s = 0, prev = null;
  const verts = (B, p, s) => {
    const y0 = p.h + LIFT - 0.05, y1 = p.h + LIFT + CURB_H, y2 = p.h + LIFT - 0.25, k = p.mk || 1;
    const ox = p.x + p.nx * CURB_W * k, oz = p.z + p.nz * CURB_W * k;
    const u = s * 0.5;
    const nf = [-p.nx, 0, -p.nz], nb = [p.nx, 0, p.nz];
    return [
      B.v(p.x, y0, p.z, u, 0, null, null, nf), B.v(p.x + p.nx * 0.02, y1, p.z + p.nz * 0.02, u, 0.1, null, null, nf),
      B.v(p.x + p.nx * 0.02, y1, p.z + p.nz * 0.02, u, 0.1), B.v(ox, y1, oz, u, 0.25),
      B.v(ox, y1, oz, u, 0.25, null, null, nb), B.v(ox, y2, oz, u, 0.45, null, null, nb),
    ];
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const ds = i > 0 ? Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z) : 0;
    s += ds;
    const B = tileB('curb', p.x, p.z);
    if (prev && prev.B !== B) prev = { B, v: verts(B, line[i - 1], s - ds) }; // tile seam: restart in this tile
    const v = verts(B, p, s);
    if (prev) {
      const a = prev.v;
      B.quad(a[0], v[0], v[1], a[1]); B.quad(a[2], v[2], v[3], a[3]); B.quad(a[4], v[4], v[5], a[5]);
    }
    prev = { B, v };
  }
  if (paveW && S.sidewalks) S.paveLines.push({ line, w: paveW, flat });
}

// ---------------------------------------------------------------- pavements (open world only)
function buildingIndex(list) {
  const g = new Map(), polys = [];
  for (const b of list || []) {
    const r = b.outer; if (!r || r.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    if (x1 - x0 > 600 || z1 - z0 > 600) continue;
    const id = polys.length; polys.push({ r, x0, x1, z0, z1 });
    gridAdd(g, x0, z0, x1, z1, id, 32);
  }
  S.bgrid = g; S.bpolys = polys;
}
function inBuilding(x, z) {
  const l = S.bgrid && S.bgrid.get(gkey(x, z, 32)); if (!l) return false;
  for (const id of l) {
    const b = S.bpolys[id]; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const r = b.r; let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], q = r[j];
      if ((a[1] > z) !== (q[1] > z) && x < (q[0] - a[0]) * (z - a[1]) / (q[1] - a[1]) + a[0]) c = !c;
    }
    if (c) return true;
  }
  return false;
}
function onCarriageway(x, z, except = -1) {
  const l = S.grid.get(gkey(x, z, CELL)); if (!l) return false;
  const segs = S.segs, tris = S.trisA;
  for (const id of l) {
    if (id >= 1e9) continue;
    if (id >= 0) {
      if (segs[id + 8] === except) continue;
      const ax = segs[id], az = segs[id + 1], dx = segs[id + 2] - ax, dz = segs[id + 3] - az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < segs[id + 6] - 0.05) return true;
    } else {
      const i = -1 - id;
      const x0 = tris[i], z0 = tris[i + 1], x1 = tris[i + 3], z1 = tris[i + 4], x2 = tris[i + 6], z2 = tris[i + 7];
      const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2); if (Math.abs(det) < 1e-9) continue;
      const w0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det, w1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det;
      if (w0 > 0.01 && w1 > 0.01 && 1 - w0 - w1 > 0.01) return true;
    }
  }
  return false;
}
// A paved strip from the curb top outward; quads are dropped where they would lie on a carriageway or in a building.
function emitPavement(line0, W, flat = false) {
  // the curb line is sparse on straight runs: cut it to 4 m pieces so the trimming below can follow roads and walls
  const line = [line0[0]];
  for (let i = 1; i < line0.length; i++) {
    const a = line0[i - 1], b = line0[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      line.push(k === n ? b : { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), h: lerp(a.h, b.h, t), nx: b.nx, nz: b.nz, mk: 1 });
    }
  }
  // test each 4 m piece (trimmed where it would lie on a carriageway or in a building), then draw runs of pieces
  // with the same width as one quad
  const N = line.length - 1, W2 = new Float32Array(N), cum = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const a = line[i - 1], b = line[i], ds = Math.hypot(b.x - a.x, b.z - a.z);
    cum[i] = cum[i - 1] + ds;
    if (ds < 0.01) { W2[i - 1] = -1; continue; }
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, nx = (a.nx + b.nx) / 2, nz = (a.nz + b.nz) / 2;
    const test = (o) => onCarriageway(mx + nx * o, mz + nz * o) || inBuilding(mx + nx * o, mz + nz * o);
    let w = W;
    if (test(CURB_W + 0.3)) w = 0;
    else if (test(w - 0.2)) { w = Math.max(CURB_W + 0.5, Math.round(w * 0.55 * 10) / 10); if (test(w - 0.2)) w = 0; }
    W2[i - 1] = w;
  }
  let i = 0;
  while (i < N) {
    const w = W2[i];
    if (w <= 0) { i++; continue; }
    let j = i + 1;
    while (j < N && W2[j] === w && Math.abs(line[j].nx * line[i].nx + line[j].nz * line[i].nz) > 0.9999) j++;
    const a = line[i], b = line[j], ka = a.mk || 1, kb = b.mk || 1, sa = cum[i], sb = cum[j];
    const B = tileB('pave', (a.x + b.x) / 2, (a.z + b.z) / 2);
    const ya = a.h + LIFT + CURB_H, yb = b.h + LIFT + CURB_H;
    const pa = (o, p, k) => [p.x + p.nx * o * k, p.z + p.nz * o * k];
    const A0 = pa(CURB_W, a, ka), A1 = pa(CURB_W, b, kb), C0 = pa(w, a, ka), C1 = pa(w, b, kb);
    // the outer edge follows the ground (a pavement on a hillside slopes with it), never far from the kerb top
    // (at most 35 cm below the kerb across its width: a ground sample under a city's rooftops can be metres out,
    // and a pavement falling 1.2 m beside the road was a ditch that rolled the car)
    const outer = (C, y) => { if (flat) return y; const g = sampleGround(C[0], C[1]); return g == null ? y : Math.max(y - 0.35, Math.min(y + 0.4, g + 0.05)); };
    const oa = outer(C0, ya), ob = outer(C1, yb);
    const P = (p, o, y, k, u) => { const x = p.x + p.nx * o * k, z = p.z + p.nz * o * k; return B.v(x, y, z, u, o); };
    B.quad(P(a, CURB_W, ya, ka, sa), P(b, CURB_W, yb, kb, sb), P(b, w, ob, kb, sb), P(a, w, oa, ka, sa));
    const K = tileB('curb', (a.x + b.x) / 2, (a.z + b.z) / 2), sk = [(a.nx + b.nx) / 2, 0, (a.nz + b.nz) / 2];
    const Pn = (p, o, y, k, u, v) => { const x = p.x + p.nx * o * k, z = p.z + p.nz * o * k; return K.v(x, y, z, u * 0.5, v, null, null, sk); };
    K.quad(Pn(a, w, oa, ka, sa, 0), Pn(b, w, ob, kb, sb, 0), Pn(b, w, ob - 0.3, kb, sb, 0.15), Pn(a, w, oa - 0.3, ka, sa, 0.15)); // a low edge into the terrain
    S.pav.push(A0[0], A0[1], ya, A1[0], A1[1], yb, C1[0], C1[1], ob, A0[0], A0[1], ya, C1[0], C1[1], ob, C0[0], C0[1], oa);
    i = j;
  }
}
// Pedestrian areas (area:highway, highway=pedestrian areas) and separately mapped sidewalks, paved on the ground.
// a pavement near a road stands at about its kerb top: from 25 cm under it to 60 cm over it (the ground samples
// alone put some Paris pavements 1.7 m below the street)
// (the roads being built, not the live ones: their own index, made once a build)
function kerbClamp(x, z, h) {
  const C = 16;
  if (!S._kg) {
    S._kg = new Map();
    for (const e of S.edges) { if (!e.px || e.c.bridge) continue; for (let i = 1; i < e.px.length; i++) gridAdd(S._kg, Math.min(e.px[i - 1], e.px[i]) - 12, Math.min(e.pz[i - 1], e.pz[i]) - 12, Math.max(e.px[i - 1], e.px[i]) + 12, Math.max(e.pz[i - 1], e.pz[i]) + 12, [e, i], C); }
  }
  const l = S._kg.get(gkey(x, z, C)); if (!l) return h;
  let bd = 12, top = null;
  for (const [e, i] of l) {
    const ax = e.px[i - 1], az = e.pz[i - 1], dx = e.px[i] - ax, dz = e.pz[i] - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - e.c.hw;
    if (d < bd) { bd = d; top = e.ph[i - 1] + (e.ph[i] - e.ph[i - 1]) * t + LIFT + CURB_H; }
  }
  if (top == null || !Number.isFinite(top)) return h;
  return Math.max(top - 0.25, Math.min(top + 0.6, h));
}
async function emitPedAreas(dirty) {
  for (const a of S.data.areas || []) {
    if (a.kind !== 'pedestrian' && a.kind !== 'road_area') continue;
    await Y(); DIRTY = dirty;
    if (a.kind === 'road_area' && a.tags['area:highway'] !== 'footway' && a.tags['area:highway'] !== 'pedestrian') continue;
    const r = a.outer; if (!r || r.length < 3) continue;
    const ring = (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r;
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []); } catch (e) { continue; }
    // the area's triangles cut into pieces about 6 m across, each corner at its own ground and kerb height (a long
    // pavement mapped with few corners made triangles 200 m long, sloping straight between their corners and
    // metres under the street in between)
    const hAt = (x, z) => kerbClamp(x, z, (sampleGround(x, z) ?? 0) + 0.06);
    for (const t of tris) {
      const [A, Bq, Cq] = t.map(k => ring[k]);
      const Lm = Math.max(Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), Math.hypot(Cq[0] - A[0], Cq[1] - A[1]), Math.hypot(Cq[0] - Bq[0], Cq[1] - Bq[1]));
      const n = Math.max(1, Math.min(24, Math.ceil(Lm / 6)));
      const pt = (i, j) => { const x = A[0] + (Bq[0] - A[0]) * i / n + (Cq[0] - A[0]) * j / n, z = A[1] + (Bq[1] - A[1]) * i / n + (Cq[1] - A[1]) * j / n; return [x, z, hAt(x, z)]; };
      const grid = new Map(), at = (i, j) => { const k = i * 64 + j; let v = grid.get(k); if (!v) grid.set(k, v = pt(i, j)); return v; };
      const emit = (p0, p1, p2) => {
        const cx = (p0[0] + p1[0] + p2[0]) / 3, cz = (p0[1] + p1[1] + p2[1]) / 3;
        if (onCarriageway(cx, cz)) return;
        const B = tileB('pave', cx, cz);
        const ids = [p0, p1, p2].map(p => B.v(p[0], p[2], p[1], p[0], p[1]));
        B.tri(ids[0], ids[1], ids[2]);
        S.pav.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
      };
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
        emit(at(i, j), at(i + 1, j), at(i, j + 1));
        if (i + j + 2 <= n) emit(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
      }
      await Y(); DIRTY = dirty;
    }
  }
  for (const w of S.data.roads || []) {
    const t = w.tags;
    if (!(t.footway === 'sidewalk' || (w.highway === 'pedestrian' && t.area !== 'yes'))) continue;
    await Y(); DIRTY = dirty;
    if (t.tunnel && t.tunnel !== 'no') continue;
    const W = (num(t.width) || (w.highway === 'pedestrian' ? 5 : 2)) / 2;
    const P = w.pts; if (P.length < 2) continue;
    let u = 0;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1][0], az = P[i - 1][1], bx = P[i][0], bz = P[i][1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      const n = Math.ceil(L / 3), nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const u0 = u; u += L / n;
        if (onCarriageway(cx, cz) || inBuilding(cx, cz)) continue;
        const h0 = kerbClamp(x0, z0, (sampleGround(x0, z0) ?? 0) + 0.06), h1 = kerbClamp(x1, z1, (sampleGround(x1, z1) ?? 0) + 0.06);
        const B = tileB('pave', cx, cz);
        const q = [B.v(x0 - nx * W, h0, z0 - nz * W, u0, 0), B.v(x1 - nx * W, h1, z1 - nz * W, u, 0), B.v(x1 + nx * W, h1, z1 + nz * W, u, 2 * W), B.v(x0 + nx * W, h0, z0 + nz * W, u0, 2 * W)];
        B.quad(q[0], q[1], q[2], q[3]);
        S.pav.push(x0 - nx * W, z0 - nz * W, h0, x1 - nx * W, z1 - nz * W, h1, x1 + nx * W, z1 + nz * W, h1, x0 - nx * W, z0 - nz * W, h0, x1 + nx * W, z1 + nz * W, h1, x0 + nx * W, z0 + nz * W, h0);
      }
    }
  }
}

async function buildMeshes(bbox) {
  if (bbox) {
    DIRTY = new Set();
    for (let i = Math.floor((bbox.x0 - 60) / TILE); i <= Math.floor((bbox.x1 + 60) / TILE); i++)
      for (let j = Math.floor((bbox.z0 - 60) / TILE); j <= Math.floor((bbox.z1 + 60) / TILE); j++) DIRTY.add(i + ',' + j);
  } else DIRTY = null;
  const dirty = DIRTY;
  S.meshes = new Map(); S.toAdd = []; S.toRemove = [];
  for (const [key, m] of LIVE.meshes) {
    if (dirty && !dirty.has(key.split(':')[1])) S.meshes.set(key, m); else S.toRemove.push(m);
  }
  TILES.clear();
  S.tris = []; S.triB = []; S.outl = []; S.paveLines = []; S.pav = [];
  // a bridge's deck reaches past its carriageway: to the pavement's outer edge, or a ledge where it has none
  for (const e of S.edges) if (e.c.bridge) { const c = e.c; c.deckL = c.hw + (c.curbL ? Math.min(3.5, c.swWL) : 0.6); c.deckR = c.hw + (c.curbR ? Math.min(3.5, c.swWR) : 0.6); }
  for (const e of S.edges) { DIRTY = dirty; emitRibbon(e, e.set0, e.len - e.set1); await Y(); }
  DIRTY = dirty;
  ST('m-junctions');
  for (const j of S.junctions) { DIRTY = dirty; emitJunction(j); await Y(); }
  DIRTY = dirty; ST('m-index');
  await buildSurfaceIndex();
  DIRTY = dirty; ST('m-marks');
  for (const e of S.edges) { DIRTY = dirty; emitMarkings(e); await Y(); }
  DIRTY = dirty;
  ST('m-cross'); emitCrossings();
  emitStopLines(); await Y(); DIRTY = dirty; ST('m-arrows');
  emitArrows(); await Y(); DIRTY = dirty; ST('m-curbs');
  for (const e of S.edges) { DIRTY = dirty; emitCurbs(e); await Y(); }
  DIRTY = dirty;
  for (const j of S.junctions) {
    if (!j.outline) continue;
    const ol = j.outline;
    // corner curbs: runs of curb points (outline segments flagged curb)
    let run = [];
    const cw = j.E.reduce((m, x) => Math.max(m, Math.min(x.e.c.swWL, x.e.c.swWR)), 1.5);
    const flat = j.E.every(x => x.e.c.bridge);
    const flush = () => { if (run.length > 1) emitCurbLine(run, flat ? Math.min(3.5, cw) : cw, -1, flat); run = []; };
    for (let i = 0; i <= ol.length; i++) {
      const p = ol[i % ol.length], q = ol[(i + 1) % ol.length];
      if (p.curb) {
        // outward normal: right of travel along the outline (outline goes counter-clockwise in angle order)
        const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
        let nx = dz / l, nz = -dx / l;
        // make sure it points away from the junction node
        if ((p.x - j.n.x) * nx + (p.z - j.n.z) * nz < 0) { nx = -nx; nz = -nz; }
        run.push({ x: p.x, z: p.z, h: p.h, nx, nz });
      } else if (run.length) { run.push({ x: p.x, z: p.z, h: p.h, nx: run[run.length - 1].nx, nz: run[run.length - 1].nz }); flush(); }
    }
    flush();
  }
  await Y(); DIRTY = dirty; ST('m-pave');
  if (S.sidewalks) {
    for (const pl of S.paveLines) { DIRTY = dirty; emitPavement(pl.line, pl.w, pl.flat); await Y(); }
    DIRTY = dirty;
    ST('m-ped'); await emitPedAreas(dirty); await Y(); DIRTY = dirty; ST('m-pavgrid');
    const pav = new Float64Array(S.pav);
    for (let i = 0; i < pav.length; i += 9) {
      gridAdd(S.grid, Math.min(pav[i], pav[i + 3], pav[i + 6]), Math.min(pav[i + 1], pav[i + 4], pav[i + 7]), Math.max(pav[i], pav[i + 3], pav[i + 6]), Math.max(pav[i + 1], pav[i + 4], pav[i + 7]), 2e9 + i, CELL);
      if ((i % 9000) === 0) await Y();
    }
    S.pavA = pav;
  } else S.pavA = new Float64Array(0);
  ST('m-geom');
  const oldByKey = new Map();
  for (const m of S.toRemove) oldByKey.set(m.name.slice(6), m);
  for (const [key, b] of TILES) {
    await Y();
    if (!b.idx.length) continue;
    // a tile whose geometry came out the same as before keeps its old mesh (nothing to upload again)
    let sum = 0; const P = b.pos; for (let i = 0; i < P.length; i++) sum += P[i] * ((i % 13) + 1);
    for (let i = 0; i < b.col.length; i += 7) sum += b.col[i];
    const hash = P.length + ':' + b.idx.length + ':' + sum.toFixed(3);
    const old = oldByKey.get(key);
    if (old && old.userData.hash === hash) {
      S.toRemove.splice(S.toRemove.indexOf(old), 1);
      S.meshes.set(key, old);
      continue;
    }
    // fix winding per triangle so every face points up (roads, paint); curbs and pavements are double sided
    const g = b.geometry(); if (!g) continue;
    fixUp(g);
    const mat = b.kind === 'road' ? MATS.asphalt : b.kind === 'paint' ? MATS.paint : b.kind === 'pave' ? MATS.pave : MATS.curb;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = false;
    m.renderOrder = b.kind === 'paint' ? 2 : 1;
    m.name = 'roads-' + key; m.userData.hash = hash;
    S.meshes.set(key, m); S.toAdd.push(m);
  }
  DIRTY = null;
}
function fixUp(g) {
  // wind every triangle so its front faces the way its vertex normal points (up for roads, outward for curbs)
  const p = g.attributes.position.array, n = g.attributes.normal.array, idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[a] + cy * n[a + 1] + cz * n[a + 2] < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  g.index.needsUpdate = true;
}

// ---------------------------------------------------------------- surface lookup
function gridAdd(grid, x0, z0, x1, z1, id, cell) {
  const i0 = Math.floor(x0 / cell), i1 = Math.floor(x1 / cell), j0 = Math.floor(z0 / cell), j1 = Math.floor(z1 / cell);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = i * 73856093 ^ j * 19349663;
    let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id);
  }
}
const gkey = (x, z, cell) => Math.floor(x / cell) * 73856093 ^ Math.floor(z / cell) * 19349663;

async function buildSurfaceIndex() {
  // segment pieces: ax az bx bz ha hb hw flags(1 curbL, 2 curbR) edgeId
  const seg = [];
  for (const e of S.edges) {
    const sa = e.set0, sb = e.len - e.set1;
    if (sb - sa < 0.02) continue;
    const pts = sliceLite(e, sa, sb, 24);
    const fl = (e.c.curbL ? 1 : 0) | (e.c.curbR ? 2 : 0) | (e.c.bridge ? 4 : 0);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      seg.push(a.x, a.z, b.x, b.z, a.h + LIFT, b.h + LIFT, e.c.hw, fl, e.id, a.c || 0, b.c || 0);
    }
    await Y();
  }
  const segs = new Float64Array(seg), tris = new Float64Array(S.tris), outl = new Float64Array(S.outl);
  const grid = new Map();
  for (let i = 0; i < segs.length; i += 11) {
    const r = segs[i + 6] + CURB_W + 1;
    gridAdd(grid, Math.min(segs[i], segs[i + 2]) - r, Math.min(segs[i + 1], segs[i + 3]) - r, Math.max(segs[i], segs[i + 2]) + r, Math.max(segs[i + 1], segs[i + 3]) + r, i, CELL);
    if ((i % 4500) === 0) await Y();
  }
  for (let i = 0; i < tris.length; i += 9) {
    gridAdd(grid, Math.min(tris[i], tris[i + 3], tris[i + 6]) - 1, Math.min(tris[i + 1], tris[i + 4], tris[i + 7]) - 1,
      Math.max(tris[i], tris[i + 3], tris[i + 6]) + 1, Math.max(tris[i + 1], tris[i + 4], tris[i + 7]) + 1, -1 - i, CELL);
    if ((i % 4500) === 0) await Y();
  }
  for (let i = 0; i < outl.length; i += 5) {
    const r = CURB_W + 1;
    gridAdd(grid, Math.min(outl[i], outl[i + 2]) - r, Math.min(outl[i + 1], outl[i + 3]) - r, Math.max(outl[i], outl[i + 2]) + r, Math.max(outl[i + 1], outl[i + 3]) + r, 1e9 + i, CELL);
  }
  S.segs = segs; S.trisA = tris; S.outlA = outl; S.grid = grid; S.triBA = new Uint8Array(S.triB || []);
  // edge centreline grid for nearestEdge
  const eg = new Map();
  for (const e of S.edges) {
    for (let i = 1; i < e.px.length; i++) gridAdd(eg, Math.min(e.px[i - 1], e.px[i]), Math.min(e.pz[i - 1], e.pz[i]), Math.max(e.px[i - 1], e.px[i]), Math.max(e.pz[i - 1], e.pz[i]), e.id * 100000 + i, 32);
    await Y();
  }
  S.edgeGrid = eg;
}

const RES = { h: null, onRoad: false, edge: Infinity, curbH: 0, bridge: false, nearH: null, nearD: Infinity };
const SURF_CAND = [];
const LEVEL = 2.5; // with a hint, edges, kerbs and pavements further than this above or below it are another level
// surfaceAt(x, z, yHint?, skip?) -> { h, onRoad, edge, curbH, bridge }
//   bridge: the piece under the point is a bridge deck. skip: 1 leaves bridge decks out (what lies on the ground),
//   2 keeps the piece nearest the hint however far from it. nearH, nearD: off the road, the nearest piece on the
//   hint's level (its height extended to the point) and how far away it is.
//   With a hint, the edge, kerb and pavement found are on the hint's level (not a deck overhead or a road under it).
//   onRoad: inside a carriageway or junction. h: the road surface height there (with the lift), or on a curb the
//   curb top. edge: metres to the nearest carriageway edge (negative inside). curbH: 0.15 when the point is on a
//   curb top or a pavement (h already includes it), else 0. Off the road, curbs and pavements h is null: use
//   world.groundAt there. Where pieces overlap (bridges, forks on a hill),
//   yHint (the wheel's last height) picks the nearest one, and a deck more than 1.5 m from yHint is ignored. The returned object is reused: copy what you keep.
export function surfaceAt(x, z, yHint, skip = 0) {
  const r = RES; r.h = null; r.onRoad = false; r.edge = Infinity; r.curbH = 0; r.bridge = false; r.nearH = null; r.nearD = Infinity;
  const Lv = LIVE;
  const l = Lv.grid.get(gkey(x, z, CELL));
  if (!l) return r;
  const segs = Lv.segs, tris = Lv.trisA, outl = Lv.outlA, pav = Lv.pavA, triB = Lv.triBA;
  let bestH = null, bestInside = Infinity, nearH = null, nearEdge = Infinity, nearCurb = false, bestB = false;
  const level = (h) => yHint == null || Math.abs(h - yHint) < LEVEL;
  // where pieces overlap (bridges, forks on a hill) the one nearest the hint wins; with no hint the highest
  const pick = (h) => {
    if (bestH == null) return true;
    if (yHint == null) return h > bestH;
    return Math.abs(h - yHint) < Math.abs(bestH - yHint);
  };
  let inJunction = false;
  let pavH = null, triNearD = Infinity, triNearH = null;
  // every piece the point is in, with how deep inside it is: where two roads' ribbons overlap outside a junction
  // (wide avenues meeting at a shallow angle) at heights a little apart, the surface is their blend weighted by
  // depth, so neither piece's edge is a step
  const cand = SURF_CAND; cand.length = 0;
  let extH = null, extIn = Infinity;
  for (let k = 0; k < l.length; k++) {
    const id = l[k];
    if (id >= 2e9) {
      const i = id - 2e9;
      const x0 = pav[i], z0 = pav[i + 1], x1 = pav[i + 3], z1 = pav[i + 4], x2 = pav[i + 6], z2 = pav[i + 7];
      const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(det) < 1e-9) continue;
      const w0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det, w1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det, w2 = 1 - w0 - w1;
      if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
        // (a bridge's pavement over a pavement on the ground: the one on the hint's level)
        const ph = w0 * pav[i + 2] + w1 * pav[i + 5] + w2 * pav[i + 8];
        if (!level(ph)) continue;
        if (pavH == null || (yHint != null ? Math.abs(ph - yHint) < Math.abs(pavH - yHint) : ph > pavH)) pavH = ph;
      }
      continue;
    }
    if (id >= 1e9) continue;
    if (id >= 0) {
      if ((skip & 1) && (segs[id + 7] & 4)) continue;
      const ax = segs[id], az = segs[id + 1], bx = segs[id + 2], bz = segs[id + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + dx * tc, cz = az + dz * tc;
      const d = Math.hypot(x - cx, z - cz), hw = segs[id + 6];
      const lat = L2 > 0 ? ((x - cx) * -dz + (z - cz) * dx) / Math.sqrt(L2) : 0, cs = segs[id + 9] + (segs[id + 10] - segs[id + 9]) * tc;
      const h = segs[id + 4] + (segs[id + 5] - segs[id + 4]) * tc + cs * Math.max(-hw, Math.min(hw, lat));
      const ed = d - hw;
      // past either end of this piece only counts where the same road carries on there (the outside of a bend,
      // between two pieces), never past the road's own end
      const eid = segs[id + 8];
      const tlo = id >= 11 && segs[id - 3] === eid ? -Infinity : -0.02, thi = id + 11 < segs.length && segs[id + 19] === eid ? Infinity : 1.02;
      if (ed <= 0 && (t < -0.02 || t > 1.02) && t >= tlo && t <= thi) {
        // only a fallback: used when no piece covers the point properly (below)
        if (extH == null || (yHint != null ? Math.abs(h - yHint) < Math.abs(extH - yHint) : h > extH)) { extH = h; extIn = ed; }
      } else if (ed <= 0 && t >= -0.02 && t <= 1.02) {
        if (pick(h)) { bestH = h; bestB = (segs[id + 7] & 4) !== 0; }
        if (ed < bestInside) bestInside = ed;
        // depth also counts from the open end of a road's last piece (where its ribbon stops short of a junction)
        let dep = -ed;
        if (dep > 0.05 && L2 > 0) {
          const len = Math.sqrt(L2);
          if (id < 11 || segs[id - 3] !== eid) dep = Math.min(dep, Math.max(0, (t + 0.02) * len));
          if (id + 11 >= segs.length || segs[id + 19] !== eid) dep = Math.min(dep, Math.max(0, (1.02 - t) * len));
        }
        cand.push(h, dep, (segs[id + 7] & 4) ? 1 : 0);
      } else if (ed < nearEdge && t >= Math.min(tlo, -0.05) && t <= Math.max(thi, 1.05) && level(h)) {
        nearEdge = ed; nearH = h;
        const side = (x - ax) * dz - (z - az) * dx; // >0: left of a->b? (x right-handed in xz with z south)
        const fl = segs[id + 7];
        // right normal of a->b is (-dz, dx): point is on the right if (x-cx)*(-dz) + (z-cz)*dx > 0
        const right = (x - cx) * -dz + (z - cz) * dx > 0;
        nearCurb = right ? (fl & 2) !== 0 : (fl & 1) !== 0;
        void side;
      }
    } else {
      const i = -1 - id;
      if ((skip & 1) && triB && triB[i / 9]) continue;
      const x0 = tris[i], z0 = tris[i + 1], x1 = tris[i + 3], z1 = tris[i + 4], x2 = tris[i + 6], z2 = tris[i + 7];
      const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(det) < 1e-9) continue;
      const w0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det, w1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det, w2 = 1 - w0 - w1;
      if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
        const h = w0 * tris[i + 2] + w1 * tris[i + 5] + w2 * tris[i + 8];
        if (pick(h)) { bestH = h; bestB = !!(triB && triB[i / 9]); }
        inJunction = true;
        cand.push(h, -1, triB && triB[i / 9] ? 1 : 0); // a junction's depth comes from its outline, below
      } else if (w0 > -0.6 && w1 > -0.6 && w2 > -0.6) {
        // just outside a junction's piece: how far, and its plane's height there (r.nearH, for drive.ground)
        const A2 = Math.abs(det);
        let d = 0;
        if (w0 < 0) d = Math.max(d, -w0 * A2 / Math.hypot(x2 - x1, z2 - z1));
        if (w1 < 0) d = Math.max(d, -w1 * A2 / Math.hypot(x0 - x2, z0 - z2));
        if (w2 < 0) d = Math.max(d, -w2 * A2 / Math.hypot(x1 - x0, z1 - z0));
        const h = w0 * tris[i + 2] + w1 * tris[i + 5] + w2 * tris[i + 8];
        if (d < triNearD && level(h)) { triNearD = d; triNearH = h; }
      }
    }
  }
  // junction outline distances (curb segments count as edges)
  let olD = Infinity, olH = null, olCurb = false;
  for (let k = 0; k < l.length; k++) {
    const id = l[k]; if (id < 1e9) continue;
    const i = id - 1e9;
    if (!outl[i + 4]) continue; // cut lines continue into a road
    const ax = outl[i], az = outl[i + 1], bx = outl[i + 2], bz = outl[i + 3];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < olD) { olD = d; olCurb = outl[i + 4] === 2; }
  }
  // a road deck far above or below the wheel (another leg of a hairpin, a bridge overhead) is not this road
  // (skip 2: the nearest piece however far, for carrying a car with a road whose height changed)
  const far = (h) => yHint != null && Math.abs(h - yHint) > 1.5 && !(skip & 2);
  if (bestH != null && far(bestH)) { bestH = null; bestInside = Infinity; inJunction = false; }
  // the outside of a bend between two pieces of one road: the fallback, also when another road at another level
  // overlaps the point (it used to win there and then be dropped as too far from the wheel: a hole the car fell in)
  if (extH != null && !far(extH) && (bestH == null || (yHint != null && Math.abs(extH - yHint) + 0.3 < Math.abs(bestH - yHint)))) { bestH = extH; bestInside = extIn; inJunction = false; cand.length = 0; }
  if (bestH != null && cand.length > 3) {
    // pieces on the chosen level (within 0.8 m of it), each weighted by its depth inside, up to 3 m
    let sw = 0, sh = 0;
    // (never a deck with the road under it: a deck coming down low over a road beside it made steps of both)
    for (let k = 0; k < cand.length; k += 3) {
      const h = cand[k]; if (Math.abs(h - bestH) > 0.8 || (cand[k + 2] === 1) !== bestB) continue;
      const d = cand[k + 1] < 0 ? (olD === Infinity ? 3 : olD) : cand[k + 1];
      const w = Math.min(3, d) + 1e-3;
      sw += w; sh += w * h;
    }
    if (sw > 0) bestH = sh / sw;
  }
  if (bestH != null) {
    r.onRoad = true; r.h = bestH; r.bridge = bestB;
    // distances to the sides of the pieces are upper bounds of the depth inside the road: take the smallest
    const jd = olD === Infinity ? -CELL : -olD;
    r.edge = !inJunction ? bestInside : bestInside !== Infinity ? Math.max(bestInside, jd) : jd;
    return r;
  }
  // outside every road piece
  let ed = nearEdge, curb = nearCurb, h = nearH;
  if (olD < ed) { ed = olD; curb = olCurb; }
  r.edge = ed; r.h = null;
  // the nearest piece on this level and how far it is (a crack between pieces, a turn cutting a junction's corner)
  if (triNearD < nearEdge) { r.nearD = triNearD; r.nearH = triNearH; } else if (nearH != null) { r.nearD = Math.max(0, nearEdge); r.nearH = nearH; }
  if (curb && ed >= 0 && ed <= CURB_W && h != null) { r.curbH = CURB_H; r.h = h + CURB_H; }
  else if (pavH != null) {
    // next to a road its pavement is at its kerb top: a strip of another road's pavement lower down (two roads
    // at different heights side by side) was a ditch along the edge that rolled the car
    let ph = pavH;
    if (nearH != null && nearEdge < 4) ph = Math.max(nearH + CURB_H - 0.35, Math.min(nearH + CURB_H + 0.6, ph));
    r.curbH = CURB_H; r.h = ph;
  }
  return r;
}

export function nearestEdge(x, z, maxDist = 40) {
  let best = null, bd = maxDist;
  const cell = 32, ci = Math.floor(x / cell), cj = Math.floor(z / cell), R = Math.ceil(maxDist / cell);
  for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
    const l = LIVE.edgeGrid.get(i * 73856093 ^ j * 19349663); if (!l) continue;
    for (const id of l) {
      const e = LIVE.edges[Math.floor(id / 100000)], k = id % 100000; if (!e) continue;
      const ax = e.px[k - 1], az = e.pz[k - 1], bx = e.px[k], bz = e.pz[k];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      const cx = ax + dx * t, cz = az + dz * t, d = Math.hypot(x - cx, z - cz);
      if (d < bd) { bd = d; best = { x: cx, z: cz, h: lerp(e.ph[k - 1], e.ph[k], t) + LIFT, heading: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360, dist: d, halfWidth: e.c.hw, edge: e }; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- lane graph
// graph.lanes[i] = { id, kind: 'road'|'junction', pts: [{x,y,z}], cum: [arc], len, speed (m/s), next: [ids], prev: [ids],
//   edge (edge id, road lanes), dir (+1 along the OSM way's drawn direction... edge direction), order (0 = leftmost lane
//   relative to travel), count (lanes that way), node (junction lanes: node id), turn ('left'|'right'|'straight'|'uturn'),
//   from, to (junction lanes: lane ids), signal (group id controlling the end of a road lane, or null), stop ('stop'|
//   'give_way'|null), stopS (distance along the lane of the stop line), fromNode, toNode }
async function buildGraph() {
  const lanes = [];
  const T = (o) => o;
  const turnsOf = (str, n) => {
    if (!str) return null;
    const parts = str.split('|'); if (parts.length !== n) return null;
    return parts.map(p => { const s = new Set(p.split(';')); return { left: s.has('left') || s.has('slight_left') || s.has('sharp_left'), right: s.has('right') || s.has('slight_right') || s.has('sharp_right'), through: s.has('through') || s.has('none') || s.has('') || s.has('merge_to_left') || s.has('merge_to_right') }; });
  };
  for (const e of S.edges) {
    await Y();
    const c = e.c, sa = e.set0, sb = e.len - e.set1;
    e.lanes = { f: [], b: [] };
    if (sb - sa < 0.05) { /* still make lanes so connections chain */ }
    const pts = slice(e, sa, Math.max(sa + 0.05, sb));
    const T2 = c.travel, bound = (k) => -T2 / 2 + k * c.lw;
    const mk = (dir, idxs, turnStr) => {
      const n = idxs.length, turns = turnsOf(turnStr, n);
      idxs.forEach((k, order) => {
        const o = bound(k) + c.lw / 2;
        let P = pts.map(p => ({ x: p.x + p.nx * o * p.mk, y: p.h + (p.c || 0) * o * p.mk + LIFT, z: p.z + p.nz * o * p.mk }));
        let SS = pts.map(p => p.s);
        if (dir < 0) { P = P.reverse(); SS = SS.reverse(); }
        const L = { id: lanes.length, kind: 'road', pts: P, _s: SS, _o: o, speed: c.speed, next: [], prev: [], edge: e.id, dir, order, count: n, turns: turns ? turns[order] : null,
          fromNode: dir > 0 ? e.ids[0] : e.ids[e.ids.length - 1], toNode: dir > 0 ? e.ids[e.ids.length - 1] : e.ids[0], signal: null, stop: null, stopS: null };
        lanes.push(L); (dir > 0 ? e.lanes.f : e.lanes.b).push(L);
      });
    };
    const n = c.nLanes;
    if (c.oneway) mk(1, [...Array(n).keys()], c.turnF);
    else {
      // RHT: backward lanes on the left (indices 0..lanesB-1), forward on the right; LHT mirrored
      const left = S.leftHand ? c.lanesF : c.lanesB;
      const fIdx = [], bIdx = [];
      if (!S.leftHand) { for (let k = left; k < n; k++) fIdx.push(k); for (let k = left - 1; k >= 0; k--) bIdx.push(k); }
      else { for (let k = 0; k < left; k++) fIdx.push(k); for (let k = n - 1; k >= left; k--) bIdx.push(k); }
      // order: leftmost relative to travel first. Forward travel: left = smaller offset. Backward: left = larger offset.
      mk(1, fIdx, c.turnF); mk(-1, bIdx, c.turnB);
    }
  }
  const cumulate = (L) => { L.cum = [0]; for (let i = 1; i < L.pts.length; i++) L.cum.push(L.cum[i - 1] + Math.hypot(L.pts[i].x - L.pts[i - 1].x, L.pts[i].z - L.pts[i - 1].z)); L.len = L.cum[L.cum.length - 1]; };
  lanes.forEach(cumulate);
  // stops and signals on lane ends
  for (const a of S.approaches) {
    const list = a.toEnd ? a.e.lanes.f : a.e.lanes.b;
    for (const L of list) {
      const sOnLane = a.toEnd ? a.s - a.e.set0 : (a.e.len - a.e.set1) - a.s;
      if (a.kind === 'signal') { L.signal = a.group; L.signalNode = a.node; } else L.stop = a.kind;
      L.stopS = Math.max(0, Math.min(L.len, sOnLane));
    }
  }
  // junction connections
  const link = (A, B, turn, ang, nodeId) => {
    const p0 = A.pts[A.pts.length - 1], p1 = B.pts[0];
    const d0 = dirAt(A, true), d1 = dirAt(B, false);
    const ch = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (ch < 0.01 && turn === 'straight') { A.next.push(B.id); B.prev.push(A.id); return; }
    const k = turn === 'straight' ? ch / 3 : ch * 0.45;
    const c0x = p0.x + d0[0] * k, c0z = p0.z + d0[1] * k, c1x = p1.x - d1[0] * k, c1z = p1.z - d1[1] * k;
    const steps = Math.max(3, Math.min(14, Math.ceil(ch / 1.5)));
    const P = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      P.push({ x: u * u * u * p0.x + 3 * u * u * t * c0x + 3 * u * t * t * c1x + t * t * t * p1.x, y: lerp(p0.y, p1.y, t), z: u * u * u * p0.z + 3 * u * u * t * c0z + 3 * u * t * t * c1z + t * t * t * p1.z });
    }
    junctionY(P, S.nodes.get(nodeId));
    const J = { id: lanes.length, kind: 'junction', pts: P, speed: Math.min(A.speed, B.speed), next: [B.id], prev: [A.id], node: nodeId, turn, from: A.id, to: B.id, signal: A.signal, stop: null, stopS: null, order: 0, count: 1 };
    cumulate(J);
    if (turn !== 'straight' && ang) { const R = Math.max(3, J.len / (Math.abs(ang) * Math.PI / 180 || 1)); J.speed = Math.min(J.speed, Math.sqrt(2.5 * R)); }
    lanes.push(J); A.next.push(J.id); B.prev.push(J.id);
  };
  const dirAt = (L, end) => { const P = L.pts, n = P.length; const a = end ? P[Math.max(0, n - 2)] : P[0], b = end ? P[n - 1] : P[Math.min(n - 1, 1)]; const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  for (const n of S.nodes.values()) {
    await Y();
    const ins = [], outs = [];
    for (const x of n.ends) {
      const e = x.e;
      if (x.atStart) { if (e.lanes.b.length) ins.push(e.lanes.b); if (e.lanes.f.length) outs.push(e.lanes.f); }
      else { if (e.lanes.f.length) ins.push(e.lanes.f); if (e.lanes.b.length) outs.push(e.lanes.b); }
    }
    const deadEnd = n.ends.length === 1;
    for (const IN of ins) {
      const di = dirAt(IN[0], true);
      const moves = [];
      for (const OUT of outs) {
        const sameEdge = OUT[0].edge === IN[0].edge;
        const dO = dirAt(OUT[0], false);
        const cross = di[0] * dO[1] - di[1] * dO[0], dot = di[0] * dO[0] + di[1] * dO[1];
        const ang = Math.atan2(cross, dot) * 180 / Math.PI; // + = right turn
        let turn = Math.abs(ang) < 35 ? 'straight' : Math.abs(ang) > 155 ? 'uturn' : ang > 0 ? 'right' : 'left';
        if (sameEdge && !deadEnd && n.ends.length > 1) continue;
        if (turn === 'uturn' && !deadEnd && !(sameEdge && n.ends.length === 1)) { if (outs.length > 1) continue; }
        moves.push({ OUT, turn, ang });
      }
      // turn:lanes that do not match the geometry (or tags that leave no way on) fall back to plain rules
      for (let pass = 0; pass < 2; pass++) {
      const useTurns = pass === 0;
      if (!useTurns && IN.some(L => L.next.length)) break;
      const nIn = IN.length;
      for (const mv of moves) {
        const OUT = mv.OUT, nOut = OUT.length;
        let pairs = [];
        const allowed = (i) => {
          const t = IN[i].turns; if (!t) return null;
          if (mv.turn === 'left') return t.left; if (mv.turn === 'right') return t.right; if (mv.turn === 'straight') return t.through || (!t.left && !t.right); return i === 0;
        };
        const hasTurns = useTurns && IN.some(L => L.turns);
        if (hasTurns) {
          const ok = IN.map((L, i) => allowed(i)).map((v, i) => v == null ? false : v);
          const src = ok.map((v, i) => v ? i : -1).filter(i => i >= 0);
          if (!src.length) continue;
          src.forEach((i, k) => {
            let j;
            if (mv.turn === 'left' || mv.turn === 'uturn') j = Math.min(nOut - 1, k);
            else if (mv.turn === 'right') j = Math.max(0, nOut - src.length + k);
            else j = Math.max(0, Math.min(nOut - 1, Math.round(k * (nOut - 1) / Math.max(1, src.length - 1)) ));
            pairs.push([i, j]);
          });
        } else if (mv.turn === 'left' || mv.turn === 'uturn') pairs.push([0, 0]);
        else if (mv.turn === 'right') pairs.push([nIn - 1, nOut - 1]);
        else {
          for (let i = 0; i < nIn; i++) {
            let j = nIn === nOut ? i : nOut > nIn ? i + Math.floor((nOut - nIn) / 2) : Math.min(nOut - 1, Math.max(0, i - Math.floor((nIn - nOut) / 2)));
            pairs.push([i, Math.max(0, Math.min(nOut - 1, j))]);
          }
        }
        for (const [i, j] of pairs) link(IN[i], OUT[j], mv.turn, mv.ang, n.id);
      }
      }
      // a lane still leading nowhere (a turn lane whose turn the map does not have): follow its neighbour's way
      for (let i = 0; i < IN.length; i++) {
        if (IN[i].next.length) continue;
        let best = -1;
        for (let k = 0; k < IN.length; k++) if (IN[k].next.length && (best < 0 || Math.abs(k - i) < Math.abs(best - i))) best = k;
        if (best < 0) continue;
        const J0 = lanes[IN[best].next[0]], B = J0.kind === 'junction' ? lanes[J0.to] : J0;
        link(IN[i], B, J0.turn || 'straight', 0, n.id);
      }
    }
  }
  // a lane that leads nowhere (only a one-way road coming the other way): let traffic turn round
  for (const n of S.nodes.values()) {
    for (const x of n.ends) {
      const e = x.e, IN = x.atStart ? e.lanes.b : e.lanes.f, OUT = x.atStart ? e.lanes.f : e.lanes.b;
      if (!IN.length || !OUT.length || IN.some(L => L.next.length)) continue;
      const A = IN[0], B = OUT[0], p0 = A.pts[A.pts.length - 1], p1 = B.pts[0];
      const d0 = dirAt(A, true), r = Math.max(2, Math.hypot(p1.x - p0.x, p1.z - p0.z) / 2);
      const P = [];
      for (let s = 0; s <= 10; s++) {
        const t = s / 10, u = 1 - t, k = r * 1.4;
        const c0x = p0.x + d0[0] * k, c0z = p0.z + d0[1] * k, c1x = p1.x + d0[0] * k, c1z = p1.z + d0[1] * k;
        P.push({ x: u * u * u * p0.x + 3 * u * u * t * c0x + 3 * u * t * t * c1x + t * t * t * p1.x, y: lerp(p0.y, p1.y, t), z: u * u * u * p0.z + 3 * u * u * t * c0z + 3 * u * t * t * c1z + t * t * t * p1.z });
      }
      const J = { id: lanes.length, kind: 'junction', pts: P, speed: 3, next: [B.id], prev: [A.id], node: n.id, turn: 'uturn', from: A.id, to: B.id, signal: A.signal, stop: null, stopS: null, order: 0, count: 1 };
      cumulate(J); lanes.push(J); A.next.push(J.id); B.prev.push(J.id);
    }
  }
  const gn = new Map();
  for (const n of S.nodes.values()) gn.set(n.id, { id: n.id, x: n.x, z: n.z, y: n.h + LIFT, degree: n.ends.length, signal: S.signals.get(n.id) ?? null });
  S.graph = { lanes, nodes: gn };
  // lane grid
  const lg = new Map();
  for (const L of lanes) {
    for (let i = 1; i < L.pts.length; i++) {
      const a = L.pts[i - 1], b = L.pts[i];
      gridAdd(lg, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), L.id * 100000 + i, 16);
    }
    await Y();
  }
  S.laneGrid = lg;
  void T;
}

export function nearestLane(x, z, maxDist = 60, filter) {
  let best = null, bd = maxDist;
  const cell = 16, ci = Math.floor(x / cell), cj = Math.floor(z / cell), R = Math.ceil(maxDist / cell);
  for (let ring = 0; ring <= R; ring++) {
    for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
      const l = LIVE.laneGrid.get(i * 73856093 ^ j * 19349663); if (!l) continue;
      for (const id of l) {
        const L = LIVE.graph.lanes[Math.floor(id / 100000)], k = id % 100000; if (!L || (filter && !filter(L))) continue;
        const a = L.pts[k - 1], b = L.pts[k];
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
        const cx = a.x + dx * t, cz = a.z + dz * t, d = Math.hypot(x - cx, z - cz);
        if (d < bd) { bd = d; best = { lane: L, s: L.cum[k - 1] + Math.sqrt(L2) * t, x: cx, y: lerp(a.y, b.y, t), z: cz, heading: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360, dist: d }; }
      }
    }
    if (best && bd < (ring) * cell) break;
  }
  return best;
}
export function nearestRoadPoint(x, z) {
  const r = nearestLane(x, z, 400, L => L.kind === 'road' && L.len > 8) || nearestLane(x, z, 2000, L => L.kind === 'road');
  return r ? { x: r.x, y: r.y, z: r.z, heading: r.heading, lane: r.lane } : null;
}

// ---------------------------------------------------------------- build
async function doBuild(data, opts) {
  const t0 = performance.now();
  sliceT = performance.now();
  S = newState(LIVE);
  if (opts.groundAt) S.groundAt = opts.groundAt;
  if (opts.scene) S.scene = opts.scene;
  if (opts.collide) S.collide = opts.collide;
  S.sidewalks = opts.sidewalks === true;
  // the open world (drive.js passes sidewalks only there) stands on a smooth terrain model: median, no low filter
  S.smooth = S.sidewalks || !!(opts.world && opts.world.mode === 'open');
  LIFT = opts.lift != null ? opts.lift : 0.03;
  S.lift = LIFT;
  S.data = data;
  // photogrammetry has parked cars and bumps baked in: a low percentile; smooth terrain (the open world): the median
  S.pct = opts.groundPercentile != null ? opts.groundPercentile : (opts.world && opts.world.mode === 'open') ? 0.5 : 0.25;
  buildingIndex(data.buildings);
  let lat = opts.lat, lon = opts.lon;
  if (lat == null) { const ll = unproject(0, 0); lat = ll.lat; lon = ll.lon; }
  const reg = regionOf(lat, lon);
  S.leftHand = reg.leftHand; S.region = reg.region; S.style = Object.assign({ region: reg.region }, STYLES[reg.region] || STYLES.other);
  if (!MATS) makeMaterials();
  slices = {}; busy = {};
  ST('topology'); await buildTopology(data);
  ST('junctions'); await buildJunctions();
  ST('heights'); await computeHeights(null);
  await Y();
  ST('features'); findFeatures(data);
  buildSignals();
  await Y();
  ST('graph'); await buildGraph();
  ST('meshes'); await buildMeshes();
  ST('publish'); await Y();
  publish();
  ST('');
  roads.slices = slices; roads.busy = Object.fromEntries(Object.entries(busy).filter(([k]) => k).map(([k, v]) => [k, Math.round(v)]));
  roads.stats = { pending: S.edges.filter(e => e.guessed).length, edges: S.edges.length, junctions: S.junctions.length, lanes: S.graph.lanes.length, crossings: S.crossings.length, approaches: S.approaches.length, meshes: GROUP.children.length, ms: Math.round(performance.now() - t0) };
  return roads;
}
function publish() {
  for (const m of S.toRemove) { GROUP.remove(m); m.geometry.dispose(); }
  for (const m of S.toAdd) GROUP.add(m);
  S.toAdd = []; S.toRemove = [];
  LIVE = S;
  graph = S.graph; signals = S.signals; signalGroups = S.signalGroups; signs = S.signs; leftHand = S.leftHand; style = S.style;
  if (S.scene && !GROUP.parent) S.scene.add(GROUP);
  syncObject();
}
let chain = Promise.resolve(), pendingBox = null, pendingP = null;
// Builds (or rebuilds) everything from an osm.js store. The previous roads stay drawn and answer queries until the
// new ones are complete. Calls are queued.
export function build(data, opts = {}) {
  const p = chain.then(() => doBuild(data, opts));
  chain = p.catch(e => console.error('roads.build', e));
  return p;
}
// bbox: { x0, z0, x1, z1 } or a THREE.Box3 (as world's 'ground-changed' sends). Lane objects are kept (their
// heights change in place), so traffic holding lanes keeps working. Calls waiting in the queue are merged.
export function reheight(bbox) {
  let b = bbox || null;
  if (b && b.min) b = { x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z };
  if (pendingP) {
    if (pendingBox && b) pendingBox = { x0: Math.min(pendingBox.x0, b.x0), z0: Math.min(pendingBox.z0, b.z0), x1: Math.max(pendingBox.x1, b.x1), z1: Math.max(pendingBox.z1, b.z1) };
    else pendingBox = null;
    return pendingP;
  }
  pendingBox = b;
  const p = pendingP = chain.then(() => { const bb = pendingBox; pendingBox = null; pendingP = null; return doReheight(bb); });
  chain = p.catch(e => console.error('roads.reheight', e));
  return p;
}
async function doReheight(b) {
  if (!LIVE.edges.length) return;
  sliceT = performance.now();
  const L = LIVE;
  S = Object.assign(newState(L), {
    edges: L.edges, nodes: L.nodes, junctions: L.junctions, crossings: L.crossings, approaches: L.approaches, graph: L.graph,
    signals: L.signals, signalGroups: L.signalGroups, signs: L.signs, data: L.data, sidewalks: L.sidewalks, pct: L.pct, smooth: L.smooth,
    bgrid: L.bgrid, bpolys: L.bpolys, laneGrid: L.laneGrid, lift: L.lift,
  });
  await computeHeights(b);
  await buildMeshes(b);
  publish();
  updateLaneHeights();
  if (roads.stats) roads.stats.pending = S.edges.filter(e => e.guessed).length;
}
// A path across a junction follows the junction's plane, meeting its two lanes exactly at the ends.
function junctionY(P, n) {
  if (!n || !n.plane || P.length < 2) return;
  const a = P[0], b = P[P.length - 1], da = a.y - planeAt(n, a.x, a.z), db = b.y - planeAt(n, b.x, b.z);
  for (let k = 1; k < P.length - 1; k++) P[k].y = planeAt(n, P[k].x, P[k].z) + lerp(da, db, k / (P.length - 1));
}
function updateLaneHeights() {
  const G = S.graph;
  for (const L of G.lanes) {
    if (L.kind !== 'road') continue;
    const e = S.edges[L.edge];
    for (let k = 0; k < L.pts.length; k++) { const q = at(e, L._s[k]); L.pts[k].y = q.h + (q.c || 0) * L._o * q.mk + LIFT; }
  }
  for (const L of G.lanes) {
    if (L.kind !== 'junction') continue;
    const A = G.lanes[L.from], B = G.lanes[L.to], y0 = A.pts[A.pts.length - 1].y, y1 = B.pts[0].y, n = L.pts.length - 1;
    for (let k = 0; k <= n; k++) L.pts[k].y = lerp(y0, y1, k / n);
    junctionY(L.pts, S.nodes.get(L.node));
  }
  for (const n of G.nodes.values()) { const m = S.nodes.get(n.id); if (m) n.y = m.h + LIFT; }
}
export function dispose() {
  for (const m of [...GROUP.children]) { GROUP.remove(m); m.geometry.dispose(); }
  LIVE.meshes = new Map();
  if (GROUP.parent) GROUP.parent.remove(GROUP);
}
function syncObject() {
  roads.graph = graph; roads.signals = signals; roads.signalGroups = signalGroups; roads.signs = signs; roads.leftHand = leftHand; roads.style = style;
}
// debug: edges and junction internals
export function _debug() { return LIVE; }

export const roads = { build, reheight, surfaceAt, nearestLane, nearestRoadPoint, nearestEdge, dispose, group: GROUP, graph, signals, signalGroups, signs, leftHand, style, stats: null, _debug };
export default roads;
