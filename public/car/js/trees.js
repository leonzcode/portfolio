// Trees for the open world: OSM's trees (natural=tree nodes, tree rows, woods and parks) and the trees the
// satellite picture shows (dark, textured green outside buildings and roads, split into crowns at the peaks of a
// distance transform, so each crown is placed and sized where it really is). Drawn cheaply: crowns are clusters
// of leaf sprites that turn to face the camera (and the sun, for their shadows), palms are drooping frond cards,
// trunks are tapered prisms; every kind is one InstancedMesh, so all the trees are a handful of draw calls.
//
//   const t = trees.build(osmData or { points, areas, treeRows }, { groundAt, scene, imagery, collide,
//                         roadsMask, buildings, roads, centre: [x, z], radius, lean: [kx, kz] })
//   t.group, t.ready (Promise of stats), t.dispose()
import * as THREE from 'three';
import { frame } from './geo.js?v=48';
import { detect } from './treedetect.js?v=48';

const D2R = Math.PI / 180;
function hashf(n, salt = 0) {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const num = (v) => { if (v == null) return null; const m = /^\s*([\d.]+)/.exec(String(v)); return m ? parseFloat(m[1]) : null; };

// ---------- textures, drawn once ----------
let TEX = null;
const TEXMEAN = {};
function textures() {
  if (TEX) return TEX;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // a cluster of leaves, light in the middle, darker leaves behind
  const leaf = (dark) => {
    // (willReadFrequently: drawn on the CPU, so reading its mean colour back below waits for no graphics card; that
    // read took up to half a second on a busy GPU; perf)
    const c = mk(256, 256), g = c.getContext('2d', { willReadFrequently: true }), r = rng(dark ? 7 : 3);
    // clumps of leaves round the middle, so the sprite's edge is ragged rather than a disc
    const clumps = [];
    for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, d = i === 0 ? 0 : 30 + r() * 52; clumps.push([128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.9, 26 + r() * 22]); }
    for (let layer = 0; layer < 3; layer++) {
      const n = [900, 700, 500][layer];
      for (let i = 0; i < n; i++) {
        const cl = clumps[Math.floor(r() * clumps.length)];
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cl[2] * (1 - layer * 0.12);
        const x = cl[0] + Math.cos(a) * d, y = cl[1] + Math.sin(a) * d;
        if ((x - 128) ** 2 + (y - 128) ** 2 > 124 * 124) continue;
        const l = (dark ? 20 : 26) + layer * 9 + r() * 12 - (y - 128) * 0.04;
        const hue = dark ? 125 + r() * 25 : 78 + r() * 30;
        g.fillStyle = `hsl(${hue}, ${dark ? 22 : 30 + r() * 12}%, ${l}%)`;
        g.save(); g.translate(x, y); g.rotate(r() * Math.PI);
        g.beginPath();
        if (dark) g.ellipse(0, 0, 6 + r() * 4, 1.6, 0, 0, Math.PI * 2);
        else g.ellipse(0, 0, 3.5 + r() * 3, 2 + r() * 1.5, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  // a palm frond: a midrib with leaflets
  const frond = () => {
    const c = mk(256, 64), g = c.getContext('2d'), r = rng(11);
    g.strokeStyle = 'hsl(80, 30%, 30%)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(256, 32); g.stroke();
    for (let i = 0; i < 70; i++) {
      const x = 6 + i * 3.5, len = 28 * Math.sin(Math.min(1, x / 256) * Math.PI) + 4;
      for (const s of [-1, 1]) {
        g.strokeStyle = `hsl(${80 + r() * 25}, ${35 + r() * 15}%, ${22 + r() * 14}%)`; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 10, 32 + s * len * (0.8 + r() * 0.2)); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const bark = () => {
    const c = mk(64, 256), g = c.getContext('2d'), r = rng(5);
    g.fillStyle = '#5a4a3c'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${30 + r() * 60},${25 + r() * 45},${20 + r() * 35},0.5)`; g.fillRect(r() * 64, r() * 256, 1 + r() * 3, 6 + r() * 30); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  TEX = { broad: leaf(false), conifer: leaf(true), frond: frond(), bark: bark() };
  // mean linear colour of the opaque leaves, to turn a target colour into a tint
  for (const k of ['broad', 'conifer']) {
    const c = TEX[k].image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) { r += (d[i] / 255) ** 2.2; g += (d[i + 1] / 255) ** 2.2; b += (d[i + 2] / 255) ** 2.2; n++; }
    TEXMEAN[k] = [r / n, g / n, b / n];
  }
  return TEX;
}

// ---------- crown geometry: sprites around a unit crown, each turned to the view in the vertex shader ----------
function spriteCrown(kind) {
  const r = rng(kind === 'conifer' ? 21 : 13);
  const pos = [], nrm = [], corner = [], uv = [], idx = [], sid = [];
  const n = kind === 'conifer' ? 11 : 9;
  for (let i = 0; i < n; i++) {
    let x, y, z, s;
    if (kind === 'conifer') {
      // a cone: y from -1 (base) to 1 (tip), narrowing
      y = -0.9 + 1.7 * (i / (n - 1)) + (r() - 0.5) * 0.1;
      const w = 0.95 * (1 - (y + 1) / 2.05);
      const a = r() * Math.PI * 2; x = Math.cos(a) * w * 0.45; z = Math.sin(a) * w * 0.45;
      s = 0.3 + w * 0.85;
    } else {
      // a ball, mostly near its surface
      let d; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; d = Math.hypot(x, y, z); } while (d > 1 || d < 0.2);
      const k = (0.35 + 0.35 * r()) / d; x *= k; y *= k * 0.9; z *= k;
      s = 0.74 + r() * 0.3;
    }
    const rot = r() * Math.PI * 2;
    const nl = Math.hypot(x, y + 0.25, z) || 1;
    const base = pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const ca = Math.cos(rot), sa = Math.sin(rot);
      pos.push(x, y, z); nrm.push(x / nl, (y + 0.25) / nl, z / nl);
      corner.push((cx * ca - cy * sa) * s, (cx * sa + cy * ca) * s);
      uv.push((cx + 1) / 2, (cy + 1) / 2);
      sid.push(i);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aSid', new THREE.Float32BufferAttribute(sid, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.2);
  return g;
}

const SPRITE_VERT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
float spS = length( instanceMatrix[ 0 ].xyz );
#else
float spS = 1.0;
#endif
mvPosition = modelViewMatrix * mvPosition;
#ifdef SPRITE_LOD
// far away a crown is its first sprite, grown to cover it: a fraction of the overdraw
float spFar = smoothstep( 70.0, 120.0, -mvPosition.z );
float spK = aSid < 0.5 ? 1.0 + 0.7 * spFar : 1.0 - spFar;
#else
float spK = 1.0;
#endif
mvPosition.xy += aCorner * spS * spK;
gl_Position = projectionMatrix * mvPosition;
`;
function spritePatch(m, key, lod = true) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCorner;\nattribute float aSid;' + (lod ? '\n#define SPRITE_LOD' : ''))
      .replace('#include <project_vertex>', SPRITE_VERT);
    if (sh.fragmentShader.includes('#include <lights_fragment_end>')) {
      // light through the leaves: never quite black on the shaded side
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * 0.06;');
    }
  };
  m.customProgramCacheKey = () => 'sprite-' + key;
  return m;
}

function frondCrown() {
  // drooping fronds from the top, each a bent strip of three quads
  const pos = [], nrm = [], uv = [], idx = [];
  const n = 11, r = rng(9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.3, up = 0.5 - r() * 0.4, len = 1.0 + r() * 0.2;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const base = pos.length / 3;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, d = t * len, y = up * d - 0.9 * d * d;
      for (const s of [-1, 1]) {
        const w = 0.22 * Math.sin(Math.min(1, t * 1.1 + 0.08) * Math.PI) + 0.03;
        pos.push(dx * d + px * s * w, y, dz * d + pz * s * w);
        nrm.push(0, 1, 0);
        uv.push(t, s < 0 ? 0 : 1);
      }
    }
    for (let k = 0; k < 3; k++) { const b = base + k * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function trunkGeo() {
  // unit trunk: height 1 from y 0, radius 1 at the foot tapering to 0.6, six sides
  const g = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

// ---------- finding trees in the satellite picture: in a worker ----------
// treeworker.js fetches the tiles and runs treedetect.js off the page's thread; without workers the same code runs
// here on pixels from imagery.js.
let WORKER = null, jobN = 0;
const jobs = new Map();
function getWorker() {
  if (WORKER === false) return null;
  if (!WORKER) {
    try {
      WORKER = new Worker(new URL('./treeworker.js?v=48', import.meta.url), { type: 'module' });
      WORKER.onmessage = (e) => { const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.res); };
      WORKER.onerror = () => { WORKER = false; for (const j of jobs.values()) j.reject(new Error('worker failed')); jobs.clear(); };
    } catch (e) { WORKER = false; return null; }
  }
  return WORKER;
}
const RW = { motorway: 7, trunk: 7, primary: 6, secondary: 5, tertiary: 4.5, unclassified: 3.5, residential: 3.5, service: 2.2, living_street: 3, motorway_link: 3.5, trunk_link: 3.5, primary_link: 3.5, secondary_link: 3, tertiary_link: 3 };
async function detectBlock(imagery, box, opts) {
  const det = {
    core: opts.core, lean: opts.lean || [0, 0], idBase: opts.idBase || 0,
    buildings: (opts.buildings || []).map(b => b.outer),
    tall: (opts.buildings || []).map(b => ({ ring: b.outer, h: b.height ?? (b.levels ? b.levels * 3.2 : 0) })).filter(b => b.h > 20),
    water: (opts.areas || []).filter(a => a.kind === 'water' && a.outer).map(a => a.outer),
    roads: [],
  };
  for (const r of opts.roads || []) {
    const hw = RW[r.highway]; if (!hw || !r.pts) continue;
    const t = r.tags || {};
    if (t.tunnel && t.tunnel !== 'no') continue;
    det.roads.push({ pts: r.pts, half: (num(t.width) ? num(t.width) / 2 : hw * (num(t.lanes) ? Math.max(1, num(t.lanes)) / 2 : 1)) - 0.5 });
  }
  const zoom = opts.zoom ?? 18;
  const W = imagery.tileMap ? getWorker() : null;
  let res;
  if (W) {
    const id = ++jobN;
    res = await Promise.race([
      new Promise((resolve, reject) => { jobs.set(id, { resolve, reject }); W.postMessage({ id, job: { map: imagery.tileMap(box.x0, box.z0, box.x1, box.z1, zoom), opts: det } }); }),
      new Promise((_, rej) => setTimeout(() => { jobs.delete(id); rej(new Error('tree worker timeout')); }, 40000)),
    ]);
  } else {
    const px = await imagery.pixels(box.x0, box.z0, box.x1, box.z1, { zoom, slice: opts.slice });
    if (opts.slice) await opts.slice('pre');
    res = detect(px, det);
  }
  return res;
}

// ---------- species ----------
function kindOf(tags, h, region) {
  const t = tags || {};
  const g = String(t.genus || t.species || t.taxon || '').toLowerCase();
  if (/phoenix|washingtonia|syagrus|palm|trachycarpus|archontophoenix|butia|chamaerops/.test(g) || /palm/i.test(t['species:en'] || '')) return 'palm';
  if (t.leaf_type === 'needleleaved' || /pinus|picea|abies|cedrus|sequoia|cupressus|thuja|juniperus|taxus|pseudotsuga|metasequoia|cryptomeria|chamaecyparis/.test(g)) return 'conifer';
  if (t.leaf_type === 'broadleaved' || g) return 'broad';
  if (region === 'ca') return h < 0.03 ? 'palm' : h < 0.16 ? 'conifer' : 'broad';
  return h < 0.12 ? 'conifer' : 'broad';
}

// ---------- the public builder ----------
// The picture's crowns by block, kept for the visit: a rebuild over the same ground finds them done.
const BLOCK = 300, MARGIN = 16;
const blockCache = new Map(); // key -> Promise<{ list, has, dist } | null>
let retiring = [];            // groups of disposed builds, kept on screen until the next build is ready

export function build(src, opts = {}) {
  const { scene, imagery, collide } = opts;
  const groundAt = opts.groundAt || (() => 0);
  const parent = opts.parent || scene;
  const group = new THREE.Group(); group.name = 'trees'; group.matrixAutoUpdate = false; // (static: perf)
  const stats = { osmTrees: 0, rowTrees: 0, areaTrees: 0, imageTrees: 0, total: 0, blocks: 0, reusedBlocks: 0, ms: 0 };
  const objs = [], handles = [];
  let disposed = false, done = false;
  const adopted = retiring; retiring = [];
  const region = (frame.lon < -114 && frame.lon > -125 && frame.lat > 32 && frame.lat < 42) ? 'ca' : 'other';
  const S = src || {};
  const points = (S.points || []).filter(p => p.kind === 'tree');
  const rows = S.treeRows || [];
  const areas = S.areas || [];
  const buildingsList = opts.buildings || S.buildings || [];
  const roads = Array.isArray(opts.roads) ? opts.roads : (S.roads || []);
  // where no trunk may stand: on a carriageway, on a kerb or pavement, or within 1.5 m of a carriageway's edge
  // (roads.js), else the caller's mask
  let roadsMask = opts.roadsMask || null;
  if (!roadsMask && opts.roads && typeof opts.roads.surfaceAt === 'function') roadsMask = (x, z) => {
    const r = opts.roads.surfaceAt(x, z);
    return !!(r && (r.onRoad || r.curbH > 0 || (r.h != null && typeof r.edge === 'number' && r.edge < 1.5)));
  };
  // the tree line: about 3600 m up to 30 degrees of latitude, 90 m lower a degree past that (2100 m in the Alps,
  // 900 m at 60 degrees); trees thin out over the 400 m below it
  const alat = Math.abs(frame.lat), treeLine = alat <= 30 ? 3600 : Math.max(0, 3600 - 90 * (alat - 30));

  let t0 = performance.now();
  const slice = async (where) => { const d = performance.now() - t0; if (d > 8) { if (d > 40) (stats.slow || (stats.slow = [])).push((where || '?') + ':' + Math.round(d)); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } };

  const ready = (async () => {
    await null;
    const tStart = performance.now();
    const list = [];
    for (const p of points) {
      const t = p.tags || {};
      const hgt = num(t.height), dc = num(t.diameter_crown);
      list.push({ x: p.x, z: p.z, r: dc ? dc / 2 : null, h: hgt, tags: t, src: 'osm', id: p.id });
    }
    stats.osmTrees = list.length;
    for (const row of rows) {
      const pts = row.pts || [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 8));
        for (let s = 0; s < n; s++) list.push({ x: ax + (bx - ax) * s / n, z: az + (bz - az) * s / n, r: null, h: null, tags: row.tags, src: 'row', id: row.id * 31 + k * 7 + s });
        stats.rowTrees += n;
      }
    }
    // the box the trees may cover
    let box = null;
    if (opts.centre || opts.radius) {
      const c = opts.centre || [0, 0], R = opts.radius || 600;
      box = { x0: c[0] - R, z0: c[1] - R, x1: c[0] + R, z1: c[1] + R };
    } else if (S.bbox) box = { ...S.bbox };
    // the picture's crowns, block by block, nearest first
    const crowns = [], probes = [];
    if (imagery && imagery.pixels && box && opts.fromImagery !== false) {
      const cam = opts.world && opts.world.camera;
      const fx = opts.focus ? opts.focus[0] : cam ? cam.position.x : (box.x0 + box.x1) / 2, fz = opts.focus ? opts.focus[1] : cam ? cam.position.z : (box.z0 + box.z1) / 2;
      const B = opts.debug ? Math.max(box.x1 - box.x0, box.z1 - box.z0) : BLOCK;
      const blocks = [];
      for (let bz = Math.floor(box.z0 / B); bz * B < box.z1; bz++) for (let bx = Math.floor(box.x0 / B); bx * B < box.x1; bx++) blocks.push([bx, bz, Math.hypot((bx + 0.5) * B - fx, (bz + 0.5) * B - fz)]);
      blocks.sort((a, b) => a[2] - b[2]);
      const lean = opts.lean || [0, 0];
      if (opts.debug) { blocks.length = 0; blocks.push([0, 0, 0]); }
      for (const [bx, bz] of blocks) {
        if (disposed) return stats;
        const core = opts.debug ? { ...box } : { x0: Math.max(box.x0, bx * B), z0: Math.max(box.z0, bz * B), x1: Math.min(box.x1, (bx + 1) * B), z1: Math.min(box.z1, (bz + 1) * B) };
        if (core.x1 - core.x0 < 1 || core.z1 - core.z0 < 1) continue;
        const key = (opts.zoom ?? 18) + '|' + B + '|' + bx + ',' + bz + '|' + [core.x0, core.z0, core.x1, core.z1].map(v => Math.round(v)).join(',') + '|' + lean[0].toFixed(2) + ',' + lean[1].toFixed(2) + (opts.debug ? '|d' : '');
        let pr = blockCache.get(key);
        if (pr) stats.reusedBlocks++;
        else {
          const ob = { x0: core.x0 - MARGIN, z0: core.z0 - MARGIN, x1: core.x1 + MARGIN, z1: core.z1 + MARGIN };
          const inBox = (pts) => {
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
            return x1 > ob.x0 - 10 && x0 < ob.x1 + 10 && z1 > ob.z0 - 10 && z0 < ob.z1 + 10;
          };
          const bl = buildingsList.filter(b => b.outer && inBox(b.outer));
          const rl = roads.filter(r => r.pts && inBox(r.pts));
          const al = areas.filter(a => a.kind === 'water' && a.outer && inBox(a.outer));
          pr = detectBlock(imagery, ob, { ...opts, core, slice, buildings: bl, roads: rl, areas: al, idBase: (bx * 7919 + bz * 104729) * 1000003 })
            .catch(e => { console.warn('trees: imagery', e); return null; });
          blockCache.set(key, pr);
          pr.then(v => { if (!v) blockCache.delete(key); });
        }
        const res = await pr;
        t0 = performance.now();
        stats.blocks++;
        if (res) { for (const t of res.list) crowns.push(t); probes.push(core); stats.imageTrees += res.list.length; stats.canopyCells = (stats.canopyCells || 0) + res.canopyCells; }
        await slice('L496');
      }
    }
    if (disposed) return stats;
    // woods and parks: scattered where the picture could not say (no imagery)
    if (!probes.length) {
      for (const a of areas) {
        if (!a.outer || a.outer.length < 3) continue;
        const wood = a.kind === 'wood', park = a.kind === 'park';
        if (!wood && !park && a.kind !== 'scrub') continue;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const p of a.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
        if (box) { x0 = Math.max(x0, box.x0); z0 = Math.max(z0, box.z0); x1 = Math.min(x1, box.x1); z1 = Math.min(z1, box.z1); }
        if (x1 <= x0 || z1 <= z0) continue;
        const step = wood ? 7 : 15, r = rng((a.id | 0) + 99);
        for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
          const px = x + r() * step, pz = z + r() * step;
          if (!inRing(px, pz, a.outer)) continue;
          if (a.holes && a.holes.some(h => inRing(px, pz, h))) continue;
          if (park && r() > 0.45) continue;
          list.push({ x: px, z: pz, r: null, h: null, tags: a.tags, src: 'area', id: (px * 73856093) ^ (pz * 19349663) });
          stats.areaTrees++;
        }
        await slice('L520');
      }
    }
    // OSM trees take their crown size from the picture; the picture's crowns fill in where OSM has none
    if (probes.length) {
      const near = new Map(), GC = 6;
      for (const t of list) { const k = Math.floor(t.x / GC) + ',' + Math.floor(t.z / GC); if (!near.has(k)) near.set(k, []); near.get(k).push(t); }
      for (const t of crowns) {
        let clash = false;
        const kx = Math.floor(t.x / GC), kz = Math.floor(t.z / GC);
        for (let a = -1; a <= 1 && !clash; a++) for (let b = -1; b <= 1 && !clash; b++) {
          const l = near.get((kx + a) + ',' + (kz + b)); if (!l) continue;
          for (const o of l) if (Math.hypot(o.x - t.x, o.z - t.z) < Math.max(3.5, t.r * 0.8)) { clash = true; break; }
        }
        if (!clash) list.push({ x: t.x, z: t.z, r: t.r, h: null, tags: null, src: 'img', id: t.c, col: t.col });
        // an OSM tree standing in a crown the picture shows takes that crown's size and colour
        else for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const l = near.get((kx + a) + ',' + (kz + b)); if (!l) continue;
          for (const o of l) if (o.r == null && Math.hypot(o.x - t.x, o.z - t.z) < Math.max(3.5, t.r * 0.8)) { o.r = Math.max(1.5, Math.min(7, t.r)); o.col = o.col || t.col; }
        }
      }
      await slice('L540');
    }
    // buildings by 50 m cell, for 'inside' and 'how near'
    const bgrid = new Map(), GB = 50;
    for (const b of buildingsList) {
      if (!b.outer || b.outer.length < 3 || (b.minHeight || 0) > 3) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of b.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (let i = Math.floor(x0 / GB); i <= Math.floor(x1 / GB); i++) for (let j = Math.floor(z0 / GB); j <= Math.floor(z1 / GB); j++) { const k = i + ',' + j; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b); }
    }
    // distance to the nearest building wall (negative inside one), up to about 50 m
    const wallDist = (x, z) => {
      let d = 60;
      const ci = Math.floor(x / GB), cj = Math.floor(z / GB);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const l = bgrid.get(i + ',' + j); if (!l) continue;
        for (const b of l) {
          const r = b.outer, n = r.length;
          let m = Infinity;
          for (let k = 0; k < n; k++) {
            const p = r[k], q = r[(k + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1], L2 = dx * dx + dz * dz;
            const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / L2)) : 0;
            const e = Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t); if (e < m) m = e;
          }
          if (m < 60 && inRing(x, z, r)) return -m;
          if (m < d) d = m;
        }
      }
      return d;
    };
    await slice('bgrid');
    // OSM trees stand where they are mapped (only never inside a building); the picture's and the scattered ones
    // must clear roads, pavements and walls, stay under the tree line, and not crowd more than a park does
    const kept = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if ((i & 63) === 0) await slice('filter');
      const d = wallDist(t.x, t.z);
      if (t.src === 'osm' || t.src === 'row') { if (d > 0) kept.push(t); continue; }
      if (d < 1.0) { stats.dropWall = (stats.dropWall || 0) + 1; continue; }
      if (roadsMask) { let bad = false; try { bad = roadsMask(t.x, t.z); } catch (e) { bad = false; } if (bad) { stats.dropRoad = (stats.dropRoad || 0) + 1; continue; } }
      const g = groundAt(t.x, t.z);
      if (g != null) {
        const elev = g + (frame.h || 0);
        if (elev > treeLine - 400 * hashf(t.id | 0, 9)) { stats.dropHigh = (stats.dropHigh || 0) + 1; continue; }
      }
      // a crown does not reach through a wall
      if (t.r != null) t.r = Math.max(1.5, Math.min(t.r, d + 1.2));
      kept.push(t);
    }
    // at most 14 detected or scattered trees in a 30 m square (one a 64 m2: a park's plane trees, not a thicket)
    const cellN = new Map(), CAP = 14, GD = 30;
    const free = kept.filter(t => t.src === 'img' || t.src === 'area').sort((a, b) => (b.r || 3) - (a.r || 3));
    const dropSet = new Set();
    for (const t of free) {
      const k = Math.floor(t.x / GD) + ',' + Math.floor(t.z / GD), n = (cellN.get(k) || 0) + 1;
      cellN.set(k, n);
      if (n > CAP) dropSet.add(t);
    }
    stats.dropDense = dropSet.size;
    list.length = 0;
    for (const t of kept) if (!dropSet.has(t)) list.push(t);
    if (disposed) return stats;
    await makeMeshes(list);
    if (disposed) return stats;
    // the programs built off the main thread before the trees show (first time only, then they are cached)
    const renderer = opts.renderer || (opts.world && opts.world.renderer), cam = opts.camera || (opts.world && opts.world.camera);
    if (renderer && cam && renderer.compileAsync) { try { await renderer.compileAsync(group, cam, parent); } catch (e) {} }
    if (disposed) return stats;
    // swap: the new trees in, the old ones out, in one step
    parent.add(group);
    for (const g of adopted) g.release();
    done = true;
    stats.total = list.length;
    stats.ms = Math.round(performance.now() - tStart);
    return stats;
  })();

  async function makeMeshes(list) {
    const T = textures();
    const groups = { broad: [], conifer: [], palm: [] };
    for (let n = 0; n < list.length; n++) {
      const t = list[n];
      const h0 = hashf(t.id | 0, 1), h1 = hashf(t.id | 0, 2), h2 = hashf(t.id | 0, 3);
      const kind = kindOf(t.tags, h0, region);
      let r = t.r, H = t.h;
      if (kind === 'palm') { r = r || 2.6 + h1 * 1.2; H = H || 9 + h1 * 9; }
      else if (kind === 'conifer') { r = r || 2.2 + h1 * 1.8; H = H || Math.max(8, r * 3.2 + h2 * 4); }
      else { r = r || 2.6 + h1 * 2.2; H = H || r * 2.0 + 2.0 + h2 * 2; }
      r = Math.min(r, 9); H = Math.min(Math.max(H, r * 1.4), 45);
      // a broadleaf tree's crown starts at least about 2.5 m up its trunk, as street and park trees do (the leaf cards reach past the crown's radius; a height from the
      // picture's guess could be as little as 1.4 crowns across, which put the crown's foot under the ground: a bush)
      if (kind === 'broad') H = Math.min(Math.max(H, r * 2.3 + 2.6), 45);
      const g = groundAt(t.x, t.z);
      if (g == null) continue;
      groups[kind].push({ x: t.x, z: t.z, g, r, H, h1, h2, rot: h0 * Math.PI * 2, col: t.col || null });
      if ((n & 255) === 0) await slice('L585');
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const crownMat = (tex, key) => {
      const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
      spritePatch(m, key);
      return m;
    };
    const depthMat = (tex, key) => {
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42 });
      spritePatch(m, key + '-d', false);
      return m;
    };
    const addCrowns = async (kind, arr, geo, tex) => {
      if (!arr.length) return;
      const mesh = new THREE.InstancedMesh(geo, crownMat(tex, kind), arr.length);
      mesh.customDepthMaterial = depthMat(tex, kind);
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i], rc = t.r;
        // (a conifer's crown from about 2 m up its trunk: from 1.3 m, with the cards' overreach, it sat on the grass)
        const cy = kind === 'conifer' ? t.g + t.H * 0.5 + 1.4 : t.g + t.H - t.r * 0.92;
        dummy.position.set(t.x, cy, t.z);
        dummy.rotation.set(0, t.rot, 0);
        if (kind === 'conifer') dummy.scale.set(rc, (t.H * 0.86 - 1.6) / 2, rc);
        else dummy.scale.set(rc * (1.05 + t.h2 * 0.2), rc * (0.8 + t.h1 * 0.2), rc * (1.05 + t.h1 * 0.2));
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        if (t.col) {
          // match the picture: the crown's brightness, and its warmth (yellow, autumn red, olive) seen from
          // above; never its blue, which is the picture's shade, not the leaves
          const lin = (v) => Math.pow(v, 2.2);
          const m = kind === 'conifer' ? TEXMEAN.conifer : TEXMEAN.broad;
          const [r0, g0, b0] = t.col, lumI = 0.3 * lin(r0) + 0.59 * lin(g0) + 0.11 * lin(b0), lumT = 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2];
          const k = Math.min(1.7, Math.max(0.55, lumI / lumT * 1.25));
          const warm = Math.max(-0.15, Math.min(0.25, (r0 - g0) / Math.max(0.05, g0)));
          col.setRGB(k * (1 + warm * 0.9), k, k * (0.85 - Math.max(0, warm) * 0.5));
        } else if (kind === 'conifer') col.setRGB(0.6 + t.h1 * 0.2, 0.7 + t.h2 * 0.2, 0.62 + t.h1 * 0.15);
        else col.setRGB(0.7 + t.h1 * 0.3, 0.75 + t.h2 * 0.2, 0.55 + t.h2 * 0.25);
        mesh.setColorAt(i, col);
        if ((i & 511) === 0) await slice('L618');
      }
      // crowns cast shadows but do not take them (a shadow lookup on every leaf pixel costs more than it shows)
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.name = 'crowns ' + kind; mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      group.add(mesh); objs.push(mesh);
    };
    await addCrowns('broad', groups.broad, spriteCrown('broad'), T.broad);
    await addCrowns('conifer', groups.conifer, spriteCrown('conifer'), T.conifer);
    if (groups.palm.length) {
      const m = new THREE.MeshLambertMaterial({ map: T.frond, alphaTest: 0.4, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(frondCrown(), m, groups.palm.length);
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: T.frond, alphaTest: 0.4 });
      groups.palm.forEach((t, i) => {
        dummy.position.set(t.x, t.g + t.H, t.z); dummy.rotation.set(0, t.rot, 0); dummy.scale.set(t.r * 1.6, t.r * 1.1, t.r * 1.6);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        col.setRGB(0.85 + t.h1 * 0.3, 0.9 + t.h2 * 0.2, 0.8); mesh.setColorAt(i, col);
      });
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.name = 'palms'; mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      group.add(mesh); objs.push(mesh);
    }
    // trunks, all kinds in one mesh
    const all = [...groups.broad.map(t => ['b', t]), ...groups.conifer.map(t => ['c', t]), ...groups.palm.map(t => ['p', t])];
    if (all.length) {
      const m = new THREE.MeshLambertMaterial({ map: T.bark });
      const mesh = new THREE.InstancedMesh(trunkGeo(), m, all.length);
      for (let i = 0; i < all.length; i++) {
        const [k, t] = all[i];
        let rad, top;
        if (k === 'p') { rad = 0.22; top = t.H + 0.2; }
        else if (k === 'c') { rad = 0.12 + t.r * 0.05; top = t.H * 0.5; }
        else { rad = 0.1 + t.r * 0.045; top = t.H - t.r * 0.9; }
        dummy.position.set(t.x, t.g - 0.3, t.z); dummy.rotation.set(0, t.rot, 0); dummy.scale.set(rad, top + 0.3, rad);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        // (bark lighter than the picture alone: in shade it read near black)
        const v = 1.45 + t.h1 * 0.4;
        if (k === 'p') col.setRGB(1.0, 0.95, 0.85); else col.setRGB(v, v * 0.94, v * 0.88);
        mesh.setColorAt(i, col);
        if (collide && collide.addCircle && !disposed) { try { const h = collide.addCircle(t.x, t.z, Math.max(0.25, rad), t.g - 0.5, t.g + top, 'tree'); if (h != null) handles.push(h); } catch (e) {} }
        if ((i & 511) === 0) await slice('L657');
      }
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'trunks'; mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      group.add(mesh); objs.push(mesh);
    }
    stats.broad = groups.broad.length; stats.conifer = groups.conifer.length; stats.palm = groups.palm.length;
  }

  function release() {
    if (group.parent) group.parent.remove(group);
    for (const o of objs) { o.geometry.dispose(); o.material.dispose(); if (o.customDepthMaterial) o.customDepthMaterial.dispose(); o.dispose && o.dispose(); }
    objs.length = 0;
  }
  const self = { release };
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (collide && collide.remove) for (const h of handles) { try { collide.remove(h); } catch (e) {} }
    // what is on screen stays until the next build is ready (or none follows straight away)
    let keep;
    if (done) keep = [self];
    else { release(); keep = adopted; }
    retiring.push(...keep);
    setTimeout(() => {
      const left = retiring.filter(h => keep.includes(h));
      if (!left.length) return;
      retiring = retiring.filter(h => !keep.includes(h));
      for (const h of left) h.release();
    }, 0);
  }
  return { group, ready, dispose, stats };
}

export const trees = { build };
// the leaf, frond and bark pictures drawn in an idle moment after the module loads (the drop's network wait), not in
// the first trees build: drawing them is one block of 60 to 120 ms (perf)
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { try { textures(); } catch (e) {} }, { timeout: 5000 });
export default trees;
