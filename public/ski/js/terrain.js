// The mountain: a groomed run going downhill along +z (x across, y up), deep snow and valley walls beside it,
// and the park's features (park.js) on it. One height function serves the physics and the meshes:
//   height(x, z)       full surface (features included)
//   normal(x, z, out)  its normal
//   surface(x, z)      0 groomed, 1 deep snow, 2 park feature (packed)
// The terrain is drawn as a quadtree of patches (32 x 32 quads each, smaller patches near the camera), built a few a
// frame, with skirts hiding the seams between sizes. Features with their own meshes (kickers, the pipe) are left out
// of the patches (the ground under them is lowered a little) and drawn by park.js at finer spacing.
import * as THREE from 'three';
import { fbm, ridged, smoothstep, clamp } from './noise.js?v=14';

// ---- the run's long profile ----------------------------------------------------------------------------------------
// [z where it starts, pitch in degrees]
const SECTIONS = [
  [-900, 26], [-150, 10], [-55, 10], [12, 19], [42, 14], [395, 11], [640, 15], [700, 17], [890, 13],
  [960, 15], [1060, 11], [1150, 9], [1300, 5], [1420, 2], [1560, 0.5]
];
const Z0 = -900, Z1 = 2600, DZ = 0.5, NZ = Math.round((Z1 - Z0) / DZ) + 1;
const PITCH = new Float32Array(NZ), BASE = new Float32Array(NZ);
(function profile() {
  const raw = new Float32Array(NZ);
  let k = 0;
  for (let i = 0; i < NZ; i++) {
    const z = Z0 + i * DZ;
    while (k + 1 < SECTIONS.length && z >= SECTIONS[k + 1][0]) k++;
    raw[i] = SECTIONS[k][1] * Math.PI / 180;
  }
  // a 30 m box filter so pitch changes are smooth curves
  const W = Math.round(15 / DZ);
  for (let i = 0; i < NZ; i++) {
    let s = 0, n = 0;
    for (let j = i - W; j <= i + W; j++) { const jj = Math.max(0, Math.min(NZ - 1, j)); s += raw[jj]; n++; }
    PITCH[i] = s / n;
  }
  // integrate, with y = 0 at z = 0
  const i0 = Math.round((0 - Z0) / DZ);
  BASE[i0] = 0;
  for (let i = i0 + 1; i < NZ; i++) BASE[i] = BASE[i - 1] - Math.tan(PITCH[i]) * DZ;
  for (let i = i0 - 1; i >= 0; i--) BASE[i] = BASE[i + 1] + Math.tan(PITCH[i + 1]) * DZ;
})();
export function baseLine(z) {
  const f = (clamp(z, Z0, Z1) - Z0) / DZ, i = Math.min(NZ - 2, Math.floor(f)), t = f - i;
  return BASE[i] + (BASE[i + 1] - BASE[i]) * t;
}
export function pitchAt(z) { const i = Math.round((clamp(z, Z0, Z1) - Z0) / DZ); return PITCH[i]; }

// half width of the groomed run
export function runHalf(z) { return 46 + 10 * smoothstep(1250, 1450, z) - 8 * smoothstep(-80, -200, z); }

// a real mountain (dem.js) replaces the made-up valley when that map is chosen
let mtn = null;
export function setMountain(m) { mtn = m; }
export function onMountain() { return !!mtn; }

// the ground without features
export function ground(x, z) {
  if (mtn) return mtn.at(x, z) + 0.35 * fbm(x * 0.06, z * 0.06, 2) + 0.5 * Math.max(0, fbm(x * 0.11 + 4, z * 0.11, 2));
  const y0 = baseLine(z), W = runHalf(z), ax = Math.abs(x), d = ax - W;
  // gentle long undulations on the run, a slight crown, and the groomer's banks at its sides
  let y = y0 + 0.22 * fbm(x * 0.018 + 11, z * 0.014, 2) - 0.00018 * x * x;
  y += 0.38 * Math.exp(-(d - 0.6) * (d - 0.6) * 0.35);
  if (d > 0) {
    const s = smoothstep(0, 24, d);
    y += s * 1.6 * fbm(x * 0.03, z * 0.03, 3);           // drifts and pillows in the deep snow
    y += 0.05 * d + 0.0011 * d * d;                     // the valley rising
    y += smoothstep(80, 420, d) * 150 * ridged(x * 0.0032 + 3, z * 0.0032 - 7, 5);
  }
  if (z < -150) y += smoothstep(-150, -600, z) * 90 * ridged(x * 0.004 - 2, z * 0.004, 4);
  return y;
}

let park = null;           // set by park.js: { height(x, z, g) -> y or -Infinity, visualDip(x, z) -> metres, surface(x, z) }
export function setPark(p) { park = p; }

export function height(x, z) {
  const g = ground(x, z);
  if (!park) return g;
  const f = park.height(x, z, g);
  return f > g ? f : g;
}
// the height the terrain patches use: features with their own meshes left out, the ground under them lowered
export function visualHeight(x, z) {
  const g = ground(x, z);
  if (!park) return g;
  const f = park.heightTerrainOnly(x, z, g);
  return Math.max(g, f) - park.visualDip(x, z);
}
const E = 0.04;
export function normal(x, z, out = new THREE.Vector3()) {
  const hx = height(x + E, z) - height(x - E, z), hz = height(x, z + E) - height(x, z - E);
  return out.set(-hx, 2 * E, -hz).normalize();
}
// the normal from the snow behind a point along a travel direction: at a sharp lip this is the ramp's, not the
// average of the ramp and the back face
export function normalBehind(x, z, dx, dz, out = new THREE.Vector3()) {
  const l = Math.hypot(dx, dz);
  if (l < 1e-4) return normal(x, z, out);
  dx /= l; dz /= l;
  const e = 0.06, h0 = height(x, z), hb = height(x - dx * e, z - dz * e);
  const sx = -dz, sz = dx, h1 = height(x + sx * e, z + sz * e), h2 = height(x - sx * e, z - sz * e);
  const tx = dx * e, ty = h0 - hb, tz = dz * e;              // along the travel
  const ux = 2 * sx * e, uy = h1 - h2, uz = 2 * sz * e;      // across it
  out.set(uy * tz - uz * ty, uz * tx - ux * tz, ux * ty - uy * tx);
  if (out.y < 0) out.negate();
  return out.normalize();
}
export function surface(x, z) {
  if (mtn) return 1;
  if (park && park.surface(x, z)) return 2;
  return Math.abs(x) - runHalf(z) > 1.2 ? 1 : 0;
}

// ---- patches --------------------------------------------------------------------------------------------------------
const ROOT = { x0: -2048, z0: -1248, size: 4096 };
export class Terrain {
  constructor(scene, material, opts = {}) {
    this.scene = scene; this.mat = material;
    this.minLeaf = opts.minLeaf || 16;      // metres
    this.SEG = opts.seg || 24;               // quads along a patch's side
    this.K = opts.K || 1.7;                  // split when the camera is within K patch sizes
    this.group = new THREE.Group(); this.group.name = 'terrain'; scene.add(this.group);
    this.cache = new Map(); this.shown = new Set(); this.queue = [];
    this.budget = opts.budget || 4;          // ms a frame for building
    this.index = this.makeIndex();
    this.root = opts.root || ROOT;
    this.cam = new THREE.Vector3();
  }
  makeIndex() {
    const SEG = this.SEG, n = SEG + 1, idx = [];
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts: four strips of SEG quads after the grid's vertices
    const base = n * n;
    const edge = [];
    for (let i = 0; i <= SEG; i++) edge.push(i);                         // top row (z0)
    const e1 = []; for (let j = 0; j <= SEG; j++) e1.push(j * n + SEG);   // right column
    const e2 = []; for (let i = SEG; i >= 0; i--) e2.push(SEG * n + i);   // bottom row reversed
    const e3 = []; for (let j = SEG; j >= 0; j--) e3.push(j * n);        // left column reversed
    let k = base;
    for (const e of [edge, e1, e2, e3]) {
      for (let i = 0; i < e.length - 1; i++) {
        const a = e[i], b = e[i + 1], c = k + i, d = k + i + 1;
        idx.push(a, b, c, b, d, c);
      }
      k += e.length;
    }
    return idx;
  }
  build(key, x0, z0, size) {
    const SEG = this.SEG, n = SEG + 1, st = size / SEG, N = n + 2;
    // heights on the grid and one ring round it, for normals
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = visualHeight(x0 + (i - 1) * st, z0 + (j - 1) * st);
    const skirtN = 4 * n, vN = n * n + skirtN;
    const pos = new Float32Array(vN * 3), nor = new Float32Array(vN * 3), grm = new Float32Array(vN);
    let ymin = Infinity, ymax = -Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = j * n + i, h = H[(j + 1) * N + i + 1];
      const x = x0 + i * st, z = z0 + j * st;
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      const hx = H[(j + 1) * N + i + 2] - H[(j + 1) * N + i], hz = H[(j + 2) * N + i + 1] - H[j * N + i + 1];
      let nx = -hx, ny = 2 * st, nz = -hz; const l = Math.hypot(nx, ny, nz); nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
      const d = Math.abs(x) - runHalf(z);
      grm[v] = mtn ? 0 : 1 - smoothstep(-1.5, 1.5, d);
      if (h < ymin) ymin = h; if (h > ymax) ymax = h;
    }
    // skirts hang below the four edges
    const drop = Math.max(0.5, st * 2.5);
    const edges = [[], [], [], []];
    for (let i = 0; i <= SEG; i++) edges[0].push(i);
    for (let j = 0; j <= SEG; j++) edges[1].push(j * n + SEG);
    for (let i = SEG; i >= 0; i--) edges[2].push(SEG * n + i);
    for (let j = SEG; j >= 0; j--) edges[3].push(j * n);
    let k = n * n;
    for (const e of edges) for (const v of e) {
      pos[k * 3] = pos[v * 3]; pos[k * 3 + 1] = pos[v * 3 + 1] - drop; pos[k * 3 + 2] = pos[v * 3 + 2];
      nor[k * 3] = nor[v * 3]; nor[k * 3 + 1] = nor[v * 3 + 1]; nor[k * 3 + 2] = nor[v * 3 + 2]; grm[k] = grm[v];
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aGroom', new THREE.BufferAttribute(grm, 1));
    g.setIndex(this.index);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, ymin - drop, z0), new THREE.Vector3(x0 + size, ymax, z0 + size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, this.mat);
    m.receiveShadow = true; m.matrixAutoUpdate = false; m.frustumCulled = true;
    m.userData = { key, ymin, ymax, used: 0 };
    return m;
  }
  // choose the patches for the camera at cam; meshes not built yet are queued and their parent stays meanwhile
  update(cam, frame) {
    this.cam.copy(cam);
    const want = [];
    const visit = (x0, z0, size, lvl) => {
      const key = lvl + ':' + x0 + ':' + z0;
      const split = size > this.minLeaf && this.dist(x0, z0, size) < size * this.K;
      if (split) {
        const h = size / 2, kids = [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]];
        const ready = kids.every(([kx, kz]) => this.cache.has((lvl + 1) + ':' + kx + ':' + kz));
        if (ready || !this.cache.has(key)) { for (const [kx, kz] of kids) visit(kx, kz, h, lvl + 1); return; }
        for (const [kx, kz] of kids) { const kk = (lvl + 1) + ':' + kx + ':' + kz; if (!this.cache.has(kk)) this.queue.push([kk, kx, kz, h, this.dist(kx, kz, h)]); }
      }
      if (!this.cache.has(key)) this.queue.push([key, x0, z0, size, this.dist(x0, z0, size)]);
      else want.push(key);
    };
    this.queue.length = 0;
    visit(this.root.x0, this.root.z0, this.root.size, 0);
    // build nearest first within the budget
    if (this.queue.length) {
      const seen = new Set();
      this.queue.sort((a, b) => a[4] - b[4]);
      const t0 = performance.now();
      for (const q of this.queue) {
        if (seen.has(q[0])) continue; seen.add(q[0]);
        this.cache.set(q[0], this.build(q[0], q[1], q[2], q[3]));
        if (performance.now() - t0 > this.budget) break;
      }
    }
    const now = new Set(want);
    for (const k of this.shown) if (!now.has(k)) { const m = this.cache.get(k); if (m) this.group.remove(m); }
    for (const k of now) if (!this.shown.has(k)) { const m = this.cache.get(k); m.updateMatrix(); this.group.add(m); m.updateMatrixWorld(); }
    for (const k of now) this.cache.get(k).userData.used = frame;
    this.shown = now;
    if (this.cache.size > 900) this.trim(frame);
    return this.queue.length;
  }
  dist(x0, z0, size) {
    const c = this.cam;
    const dx = Math.max(x0 - c.x, 0, c.x - (x0 + size)), dz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
    const gy = ground(clamp(c.x, x0, x0 + size), clamp(c.z, z0, z0 + size));
    return Math.hypot(dx, dz, Math.max(0, Math.abs(c.y - gy) - 30) * 0.6);
  }
  trim(frame) {
    const list = [...this.cache.entries()].filter(([k]) => !this.shown.has(k)).sort((a, b) => a[1].userData.used - b[1].userData.used);
    for (let i = 0; i < list.length - 600; i++) { list[i][1].geometry.dispose(); this.cache.delete(list[i][0]); }
  }
  // build everything the camera at p needs now (behind the loading screen)
  warm(p) { const b = this.budget; this.budget = 1e9; for (let i = 0; i < 12; i++) if (!this.update(p, 0)) break; this.budget = b; }
}
